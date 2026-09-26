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
  let initial: { mode: "desktop" | "workspace" | "unsupported"; scope: string } | undefined;
  const modeOf = (context: Awaited<ReturnType<PanelBridge["getContext"]>>) => {
    const methods = context.availableMethods ?? [];
    if (DOCUMENTS.slice(0, 2).every((method) => methods.includes(method)))
      return "desktop" as const;
    if (WORKSPACE.every((method) => methods.includes(method))) return "workspace" as const;
    return "unsupported" as const;
  };
  async function checked() {
    const context = await raw.getContext();
    initial ??= { mode: modeOf(context), scope: scopeOf(context) };
    const bound = initial;
    if (scopeOf(context) !== bound.scope || modeOf(context) !== bound.mode)
      throw new Error("项目或存储权限已改变，请重新打开视频面板；旧工程未写入新项目");
    return { mode: bound.mode, context };
  }
  const backend = workspaceDocumentBackend({
    async call(method, params) {
      // Each mutation checks its destination. Reads are validated as one document
      // operation below, avoiding two extra remote round trips for every part.
      // The Host's bound grant still authorizes every individual file operation.
      if (method === "workspace.writeText") await checked();
      return raw.call(method, params);
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
