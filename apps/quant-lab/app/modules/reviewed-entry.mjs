// The Host resolves the current project's selected and reviewed package. A
// missing method is a capability failure, never a reason to search HOME.
export async function reviewedEntry(hostCall, name, executableHandle) {
  let resolved;
  try { resolved = await hostCall("process.resolveEntry", { name, executableHandle }); }
  catch (cause) { throw new Error("当前 CodeShell 无法校验所选面板的执行入口；请更新 CodeShell。已保留本地快照。", { cause }); }
  if (typeof resolved?.handle !== "string") throw new Error("已授权执行入口不可用，请更新 CodeShell 或重新审查当前项目的面板授权");
  return resolved.handle;
}

const COLLECTORS = new Set(["fetch-holding-quotes", "build-market-pulse", "build-a-share-selection", "fetch-a-share-stock", "fetch-us-stock"]);
export async function collectionScopeArguments(context) {
  const proof = context?.projectScope;
  const fields = proof?.version === 1 && [proof.environmentId, proof.projectId, proof.rootId].every(value => typeof value === "string" && value.length)
    ? [1, proof.environmentId, proof.projectId, proof.rootId]
    : typeof context?.cwd === "string" && context.cwd.length ? [0, context.cwd.normalize("NFC")] : null;
  if (!fields) throw new Error("当前项目身份不可用，未启动行情采集");
  const identity = JSON.stringify([context.host ?? null, context.appId ?? "quant-lab", fields]);
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity)))].map(value => value.toString(16).padStart(2, "0")).join("");
  return ["--collector-scope", hash];
}

// Central production adapter: only handles returned by reviewed resolveEntry
// receive collector scope arguments. Session/execution IDs never fragment a
// project's deduplication key; the epoch still fences every asynchronous step.
export function createCollectorScopeBridge({ invoke, getContext, currentEpoch, getLibraryId = () => null, ensureLibraryId = getLibraryId }) {
  let epoch = currentEpoch();
  const entries = new Map();
  return async (method, params, intent) => {
    const expected = currentEpoch();
    if (epoch !== expected) { entries.clear(); epoch = expected; }
    const check = () => { if (currentEpoch() !== expected) throw new Error("项目已切换，未提交旧行情请求"); };
    if (method === "process.spawn" && COLLECTORS.has(entries.get(params.entryHandle))) {
      // A restored Watch/Stock page may never open the history module. Resolve
      // its one project selection record before every first collector spawn.
      const libraryId = await ensureLibraryId(); check();
      const scope = await collectionScopeArguments(getContext()); check();
      params = { ...params, args: [...params.args, ...scope, ...(libraryId ? ["--library-id", libraryId] : [])] };
    }
    check();
    const result = await invoke(method, params, intent); check();
    if (method === "process.resolveEntry" && COLLECTORS.has(params.name) && typeof result?.handle === "string") {
      if (entries.size >= 32) entries.delete(entries.keys().next().value);
      entries.set(result.handle, params.name);
    }
    return result;
  };
}
