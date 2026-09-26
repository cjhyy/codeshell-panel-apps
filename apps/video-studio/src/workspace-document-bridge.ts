import type { PanelBridge } from "./host";
import { workspaceDocumentBackend } from "./editor/workspace-storage";

const DOCUMENTS = ["media.document.get", "media.document.set", "media.document.versions"];
const WORKSPACE = ["workspace.list", "workspace.readText", "workspace.writeText"];
const scopeOf = (context: Record<string, unknown>) =>
  JSON.stringify([context.cwd, context.environmentId ?? null, context.projectId ?? null]);

/** Panel-local compatibility for its own project and task documents. The actual
 * Host still exposes only its reviewed workspace capabilities. Native desktop
 * documents pass through unchanged; no implicit migration between backends.
 */
export function createWorkspaceDocumentBridge(raw: PanelBridge): PanelBridge {
  let initial:
    | Promise<{ mode: "desktop" | "workspace" | "unsupported"; scope: string }>
    | undefined;
  const modeOf = (context: Awaited<ReturnType<PanelBridge["getContext"]>>) => {
    const methods = context.availableMethods ?? [];
    if (DOCUMENTS.slice(0, 2).every((method) => methods.includes(method)))
      return "desktop" as const;
    if (WORKSPACE.every((method) => methods.includes(method))) return "workspace" as const;
    return "unsupported" as const;
  };
  async function checked() {
    initial ??= raw
      .getContext()
      .then((context) => ({ mode: modeOf(context), scope: scopeOf(context) }));
    const bound = await initial,
      context = await raw.getContext();
    if (scopeOf(context) !== bound.scope || modeOf(context) !== bound.mode)
      throw new Error("项目或存储权限已改变，请重新打开视频面板；旧工程未写入新项目");
    return { mode: bound.mode, context };
  }
  const backend = workspaceDocumentBackend({
    async call(method, params) {
      await checked();
      const result = await raw.call(method, params);
      await checked();
      return result;
    },
  });
  return {
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
      if (!DOCUMENTS.includes(method)) return raw.call(method, input);
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
      if (mode !== "workspace") return raw.call(method, params);
      if (!params || typeof params.key !== "string") throw new Error("工程存储键无效");
      if (method === "media.document.get") {
        if (
          params.revision !== undefined &&
          (!Number.isSafeInteger(params.revision) || (params.revision as number) < 1)
        )
          throw new Error("工程历史版本无效");
        return backend.get(params.key, params.revision as number | undefined);
      }
      if (method === "media.document.versions") return backend.versions(params.key);
      return backend.set(
        params.key,
        structuredClone(params.data),
        params.baseRevision as number,
        params.label as string,
      );
    },
  };
}
