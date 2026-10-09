import type { PanelBridge } from "./host";
import { workspaceDocumentBackend } from "./editor/workspace-storage";

const DOCUMENTS = ["media.document.get", "media.document.set", "media.document.versions"];
const WORKSPACE = ["workspace.list", "workspace.readText", "workspace.writeText"];
const SCOPE_KEYS = ["cwd", "host", "appId", "sessionId", "environmentId", "projectId"];
const scopeOf = (context: Record<string, unknown>) =>
  JSON.stringify(SCOPE_KEYS.map((key) => context[key] ?? null));
const SCOPE_CHANGED = "项目或存储权限已改变，请重新打开视频面板；旧工程未写入新项目";

/** Panel-local compatibility for its own project and task documents. The actual
 * Host still exposes only its reviewed workspace capabilities. Native desktop
 * documents pass through unchanged; no implicit migration between backends.
 */
export function createWorkspaceDocumentBridge(
  raw: PanelBridge,
): PanelBridge & { assertActive(): void } {
  let initial: { mode: "desktop" | "workspace" | "unsupported"; scope: string } | undefined;
  let observed: Record<string, unknown> = {},
    invalidated = false;
  const modeOf = (context: Awaited<ReturnType<PanelBridge["getContext"]>>) => {
    const methods = context.availableMethods ?? [];
    if (DOCUMENTS.slice(0, 2).every((method) => methods.includes(method)))
      return "desktop" as const;
    if (WORKSPACE.every((method) => methods.includes(method))) return "workspace" as const;
    return "unsupported" as const;
  };
  const assertActive = () => {
    if (invalidated) throw new Error(SCOPE_CHANGED);
  };
  raw.on("context.changed", (payload) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
    const next = payload as Record<string, unknown>;
    // Observe the binding, not merely the path: distinct cloud projects can both
    // use /workspace. Once changed, returning to the old binding cannot revive work.
    if (
      SCOPE_KEYS.some(
        (key) =>
          Object.hasOwn(next, key) &&
          Object.hasOwn(observed, key) &&
          (next[key] ?? null) !== (observed[key] ?? null),
      )
    )
      invalidated = true;
    observed = { ...observed, ...next };
    if (
      initial &&
      (scopeOf(observed) !== initial.scope ||
        (Object.hasOwn(next, "availableMethods") && modeOf(observed) !== initial.mode))
    )
      invalidated = true;
  });
  async function checked() {
    assertActive();
    const context = await raw.getContext();
    assertActive();
    if (
      SCOPE_KEYS.some(
        (key) =>
          Object.hasOwn(observed, key) &&
          (observed[key] ?? null) !== ((context as Record<string, unknown>)[key] ?? null),
      )
    )
      invalidated = true;
    initial ??= { mode: modeOf(context), scope: scopeOf(context) };
    const bound = initial;
    if (scopeOf(context) !== bound.scope || modeOf(context) !== bound.mode) invalidated = true;
    assertActive();
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
    registerTool: (name, handler) => raw.registerTool(name, handler),
    on: (name, listener) => raw.on(name, listener),
    async call(method, input) {
      assertActive();
      if (!DOCUMENTS.includes(method)) {
        // The editor uses workspace methods directly as well as document aliases.
        if (!initial || method === "workspace.writeText") await checked();
        assertActive();
        const result = await raw.call(method, input);
        assertActive();
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
