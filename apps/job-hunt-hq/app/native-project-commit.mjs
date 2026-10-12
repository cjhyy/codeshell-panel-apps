const ROOT_PATH = "job-hunt-panel.json";
const MAX_STAGE_BYTES = 384 * 1024;
const MAX_RECEIPT_CHARACTERS = 64 * 1024;
const handlePromises = new WeakMap();
const requiredMethods = [
  "workspace.writeText", "filesystem.getKnownDirectory", "process.find",
  "process.resolveEntry", "process.spawn", "process.write", "process.end", "process.get",
];

export function supportsNativeProjectCommit(context) {
  if (!Array.isArray(context?.availableMethods) ||
      !requiredMethods.every(method => context.availableMethods.includes(method))) return false;
  return !Array.isArray(context.permissions) ||
    ["workspace.write", "process"].every(permission => context.permissions.includes(permission));
}

function failure(message, code, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function generation() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `g-${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function contentRevision(content) {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return `sha256:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Publish only through the reviewed CLI, which owns the cross-process lock.
 * Staging is create-only. A missing process receipt must never cause an automatic
 * second spawn: the first process may already have replaced the project root.
 */
export async function commitNativeProjectSnapshot({
  content, expectedRevision, expectedModifiedAt, scope, handleCache, timeoutMs = 30_000,
}) {
  if (typeof content !== "string" || !content || new TextEncoder().encode(content).length > MAX_STAGE_BYTES)
    throw failure("项目快照内容无效或超过 384 KiB，请先分片。", "INVALID_SNAPSHOT");
  if (expectedRevision !== undefined && expectedRevision !== null &&
      (typeof expectedRevision !== "string" || !/^sha256:[0-9a-f]{64}$/.test(expectedRevision)))
    throw failure("项目快照缺少有效的版本校验。", "INVALID_REVISION");
  if (expectedModifiedAt !== undefined && expectedModifiedAt !== null &&
      (typeof expectedModifiedAt !== "number" || !Number.isFinite(expectedModifiedAt) || expectedModifiedAt < 0))
    throw failure("项目快照修改时间无效。", "INVALID_MODIFIED_AT");
  if (!scope || typeof scope.call !== "function" || typeof scope.check !== "function" ||
      !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000 ||
      (handleCache !== undefined && (!handleCache || typeof handleCache !== "object")))
    throw failure("项目快照提交上下文无效。", "INVALID_CONTEXT");
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== "function")
    throw failure("项目快照提交需要安全连接的校验能力。", "CRYPTO_UNAVAILABLE");

  const call = async (method, params) => {
    scope.check();
    const result = await scope.call(method, params);
    scope.check();
    return result;
  };
  scope.check();
  const revision = await contentRevision(content);
  scope.check();
  const size = new TextEncoder().encode(content).length;
  const stagedPath = `career-data/panel-commits/${generation()}.json`;
  await call("workspace.writeText", { path: stagedPath, content, expectedModifiedAt: null });
  // The caller may reuse one cache only within the same project/package/session
  // epoch. Host grants are still revalidated on spawn; no failed discovery sticks.
  let handles = handleCache && handlePromises.get(handleCache);
  if (!handles) {
    handles = (async () => {
      const directory = await call("filesystem.getKnownDirectory", { name: "project" });
      if (typeof directory?.handle !== "string" || !directory.handle)
        throw failure("无法获取当前项目的提交目录。", "PROJECT_DIRECTORY_UNAVAILABLE");
      const executable = await call("process.find", { name: "node" });
      if (executable?.available !== true || typeof executable.handle !== "string" || !executable.handle)
        throw failure("未找到 Node.js，项目尚未保存。请安装 Node.js 后重新打开面板。", "NODE_UNAVAILABLE");
      const entry = await call("process.resolveEntry", { name: "job-hunt-cli", executableHandle: executable.handle });
      if (typeof entry?.handle !== "string" || !entry.handle)
        throw failure("无法校验项目提交工具，请更新简历面板。", "ENTRY_UNAVAILABLE");
      return { directory, executable, entry };
    })();
    if (handleCache) {
      handlePromises.set(handleCache, handles);
      void handles.catch(() => {
        if (handlePromises.get(handleCache) === handles) handlePromises.delete(handleCache);
      });
    }
  }
  const { directory, executable, entry } = await handles;
  scope.check();

  const request = { operation: "snapshot.commit", input: {
    path: stagedPath,
    ...(expectedRevision === undefined && expectedModifiedAt != null ? {} : { expectedRevision: expectedRevision ?? null }),
    ...(expectedModifiedAt === undefined ? {} : { expectedModifiedAt }),
  } };
  let processId, stdout = "", stderr = "", cursor = 0;
  // Admission may succeed even if the spawn response is lost. Everything after
  // this boundary is uncertain until a complete terminal receipt is verified.
  try {
    const started = await call("process.spawn", {
      executableHandle: executable.handle, entryHandle: entry.handle,
      directoryHandle: directory.handle, args: [], stdin: "pipe",
    });
    if (typeof started?.processId !== "string" || !started.processId)
      throw failure("项目提交进程未返回有效标识。", "INVALID_PROCESS_RECEIPT");
    processId = started.processId;
    await call("process.write", { processId, text: JSON.stringify(request) });
    await call("process.end", { processId });
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (Date.now() >= deadline) throw failure("项目提交等待超时。", "COMMIT_TIMEOUT");
      const receipt = await call("process.get", { processId, afterSequence: cursor, limit: 128 });
      if (receipt?.found !== true || receipt.processId !== processId || receipt.truncated ||
          !Array.isArray(receipt.events) || !["running", "stopping", "exited"].includes(receipt.status))
        throw failure("项目提交回执缺失或不完整。", "INVALID_PROCESS_RECEIPT");
      for (const event of receipt.events) {
        if (event?.sequence !== cursor + 1 || !["process.output", "process.exit"].includes(event.event) ||
            event.payload?.processId !== processId)
          throw failure("项目提交输出顺序异常。", "INVALID_PROCESS_RECEIPT");
        cursor = event.sequence;
        if (event.event === "process.output") {
          if (typeof event.payload.text !== "string" || !["stdout", "stderr"].includes(event.payload.stream))
            throw failure("项目提交输出格式无效。", "INVALID_PROCESS_RECEIPT");
          if (event.payload.stream === "stdout") stdout += event.payload.text;
          else stderr += event.payload.text;
          if (stdout.length + stderr.length > MAX_RECEIPT_CHARACTERS)
            throw failure("项目提交回执过大。", "INVALID_PROCESS_RECEIPT");
        }
      }
      if (receipt.nextSequence !== cursor || !Number.isSafeInteger(receipt.sequence) ||
          receipt.sequence < cursor || typeof receipt.hasMore !== "boolean" ||
          receipt.hasMore !== (cursor < receipt.sequence) || (receipt.hasMore && !receipt.events.length))
        throw failure("项目提交回执游标无效。", "INVALID_PROCESS_RECEIPT");
      if (receipt.status === "exited" && !receipt.hasMore) {
        let response;
        try { response = JSON.parse(stdout); }
        catch { throw failure("项目提交未返回有效 JSON 回执。", "INVALID_PROCESS_RECEIPT"); }
        if (response?.ok === false && typeof response.error?.code === "string" && response.error.code &&
            response.error.code.length <= 100 && typeof response.error.message === "string" &&
            response.error.message && response.error.message.length <= 2000 && !receipt.signal) {
          throw failure(response.error.message, response.error.code, { outcomeUnknown: false });
        }
        if (receipt.code !== 0 || receipt.signal || response?.ok !== true ||
            response.result?.path !== ROOT_PATH || response.result.size !== size ||
            response.result.revision !== revision || typeof response.result.modifiedAt !== "number" ||
            !Number.isFinite(response.result.modifiedAt) || response.result.modifiedAt < 0)
          throw failure("项目提交结果未通过完整校验。", "INVALID_PROCESS_RECEIPT");
        return { path: ROOT_PATH, size, modifiedAt: response.result.modifiedAt, revision };
      }
      if (!receipt.hasMore) {
        await new Promise(resolve => setTimeout(resolve, Math.min(150, Math.max(1, deadline - Date.now()))));
        scope.check();
      }
    }
  } catch (error) {
    if (handleCache) handlePromises.delete(handleCache);
    if (error?.outcomeUnknown === false) {
      error.stagedPath = stagedPath;
      error.processId = processId;
      throw error;
    }
    throw failure("无法确认项目是否已经保存。请重新读取项目状态后再决定是否重试；不要直接重复提交。",
      error?.code || "COMMIT_OUTCOME_UNKNOWN", {
        outcomeUnknown: true, stagedPath, ...(processId ? { processId } : {}), cause: error,
      });
  }
}
