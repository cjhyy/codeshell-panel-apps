import type { PanelBridge } from "./host";
import { workspaceDocumentBackend } from "./editor/workspace-storage";

const DOCUMENTS = ["media.document.get", "media.document.set", "media.document.versions"];
const WORKSPACE = ["workspace.list", "workspace.readText", "workspace.writeText"];
const PROJECT_KEYS = ["cwd", "host", "appId"];
const LEGACY_KEYS = [...PROJECT_KEYS, "sessionId", "environmentId", "projectId"];
const sessionMethod = (method: string) =>
  method === "agent.submitPrompt" || method.startsWith("automations.");
function projectIdentity(scope: unknown): string | undefined {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return;
  const value = scope as Record<string, unknown>;
  if (value.version !== 1) return;
  const fields = [value.environmentId, value.projectId, value.rootId];
  if (
    fields.some(
      (field) =>
        typeof field !== "string" ||
        !field.trim() ||
        field.length > 256 ||
        /[\u0000-\u001f\u007f]/u.test(field),
    )
  )
    return;
  return JSON.stringify([1, ...fields]);
}
const scopeOf = (context: Record<string, unknown>, stable: boolean) =>
  JSON.stringify([
    ...(stable ? PROJECT_KEYS : LEGACY_KEYS).map((key) => context[key] ?? null),
    ...(stable ? [projectIdentity(context.projectScope) ?? null] : []),
  ]);
const SCOPE_CHANGED = "项目或存储权限已改变，请重新打开视频面板；旧工程未写入新项目";

/** Panel-local compatibility for its own project and task documents. The actual
 * Host still exposes only its reviewed workspace capabilities. Native desktop
 * documents pass through unchanged; no implicit migration between backends.
 */
export function createWorkspaceDocumentBridge(
  raw: PanelBridge,
): PanelBridge & { assertActive(method?: string): void } {
  let initial:
    | { mode: "desktop" | "workspace" | "unsupported"; scope: string; stable: boolean }
    | undefined;
  let observed: Record<string, unknown> = {},
    invalidated = false,
    sessionInvalidated = false;
  const modeOf = (context: Awaited<ReturnType<PanelBridge["getContext"]>>) => {
    const methods = context.availableMethods ?? [];
    if (DOCUMENTS.slice(0, 2).every((method) => methods.includes(method)))
      return "desktop" as const;
    if (WORKSPACE.every((method) => methods.includes(method))) return "workspace" as const;
    return "unsupported" as const;
  };
  const assertActive = (method = "") => {
    if (invalidated) throw new Error(SCOPE_CHANGED);
    if (sessionInvalidated && sessionMethod(method))
      throw Object.assign(
        new Error("当前会话已变化，请重新打开视频面板后再提交会话任务或修改自动化"),
        { code: "SESSION_CHANGED" },
      );
  };
  const observeSession = (next: Record<string, unknown>, complete = false) => {
    if (
      typeof observed.sessionId === "string" &&
      (complete || Object.hasOwn(next, "sessionId")) &&
      next.sessionId !== observed.sessionId
    )
      sessionInvalidated = true;
  };
  raw.on("context.changed", (payload) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
    const next = payload as Record<string, unknown>;
    // Observe the binding, not merely the path: distinct cloud projects can both
    // use /workspace. Once changed, returning to the old binding cannot revive work.
    observeSession(next);
    const stable = initial?.stable ?? Boolean(projectIdentity(observed.projectScope));
    if (
      (stable ? PROJECT_KEYS : LEGACY_KEYS).some(
        (key) =>
          Object.hasOwn(next, key) &&
          Object.hasOwn(observed, key) &&
          (next[key] ?? null) !== (observed[key] ?? null),
      )
    )
      invalidated = true;
    if (
      stable &&
      Object.hasOwn(next, "projectScope") &&
      projectIdentity(next.projectScope) !== projectIdentity(observed.projectScope)
    )
      invalidated = true;
    observed = { ...observed, ...next };
    if (
      initial &&
      (scopeOf(observed, initial.stable) !== initial.scope ||
        (Object.hasOwn(next, "availableMethods") && modeOf(observed) !== initial.mode))
    )
      invalidated = true;
  });
  async function checked(method = "") {
    assertActive(method);
    const context = await raw.getContext();
    assertActive(method);
    observeSession(context, true);
    const stable = initial?.stable ?? Boolean(projectIdentity(context.projectScope));
    if (
      (stable ? PROJECT_KEYS : LEGACY_KEYS).some(
        (key) =>
          Object.hasOwn(observed, key) &&
          (observed[key] ?? null) !== ((context as Record<string, unknown>)[key] ?? null),
      )
    )
      invalidated = true;
    if (
      stable &&
      projectIdentity(observed.projectScope) &&
      projectIdentity(context.projectScope) !== projectIdentity(observed.projectScope)
    )
      invalidated = true;
    initial ??= { mode: modeOf(context), scope: scopeOf(context, stable), stable };
    const bound = initial;
    if (scopeOf(context, bound.stable) !== bound.scope || modeOf(context) !== bound.mode)
      invalidated = true;
    assertActive(method);
    observed = { ...context };
    return { mode: bound.mode, context };
  }
  const backend = workspaceDocumentBackend({
    async call(method, params) {
      // Each mutation checks its destination. Reads are validated as one document
      // operation below, avoiding two extra remote round trips for every part.
      // The Host's bound grant still authorizes every individual file operation.
      if (method === "workspace.writeText") await checked();
      assertActive();
      const result = await raw.call(method, params);
      assertActive();
      return result;
    },
  });
  return {
    assertActive,
    async getContext() {
      const { mode, context } = await checked();
      return mode === "workspace"
        ? {
            ...context,
            availableMethods: [...new Set([...(context.availableMethods ?? []), ...DOCUMENTS])],
          }
        : context;
    },
    registerTool: (name, handler) =>
      raw.registerTool(name, (args) => {
        assertActive();
        let result: unknown;
        try {
          result = handler(args);
        } catch (error) {
          assertActive();
          throw error;
        }
        if (result && typeof (result as { then?: unknown }).then === "function")
          return Promise.resolve(result).then(
            (value) => {
              assertActive();
              return value;
            },
            (error) => {
              assertActive();
              throw error;
            },
          );
        assertActive();
        return result;
      }),
    on: (name, listener) => raw.on(name, listener),
    async call(method, input) {
      assertActive(method);
      if (!DOCUMENTS.includes(method)) {
        // The editor uses workspace methods directly as well as document aliases.
        if (!initial || method === "workspace.writeText" || sessionMethod(method))
          await checked(method);
        assertActive(method);
        const result = await raw.call(method, input);
        assertActive(method);
        return result;
      }
      const params = structuredClone(input) as
        | {
            key?: unknown;
            revision?: unknown;
            data?: unknown;
            baseRevision?: unknown;
            label?: unknown;
          }
        | undefined;
      const { mode } = await checked();
      if (mode !== "workspace") {
        const result = await raw.call(method, params);
        assertActive();
        return result;
      }
      if (!params || typeof params.key !== "string") throw new Error("工程存储键无效");
      let result: unknown;
      if (method === "media.document.get") {
        if (
          params.revision !== undefined &&
          (!Number.isSafeInteger(params.revision) || (params.revision as number) < 1)
        )
          throw new Error("工程历史版本无效");
        result = await backend.get(params.key, params.revision as number | undefined);
      } else if (method === "media.document.versions") {
        result = await backend.versions(params.key);
      } else {
        result = await backend.set(
          params.key,
          structuredClone(params.data),
          params.baseRevision as number,
          params.label as string,
        );
      }
      await checked();
      return result;
    },
  };
}
