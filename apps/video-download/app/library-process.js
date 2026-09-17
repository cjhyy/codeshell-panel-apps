// Auxiliary read-only processes use retained receipts so output emitted before
// spawn resolves can never be mistaken for a download's progress.
export function createLibraryProcess(panel, { onBusy = () => {}, beforeStart = () => {} } = {}) {
  const ids = new Set();
  let active = 0,
    pendingStarts = 0,
    entryPromise;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function changed(delta) {
    active += delta;
    onBusy(active > 0);
  }
  async function run({
    executableHandle,
    entryHandle,
    directoryHandle,
    args = [],
    input,
    signal,
    timeout = 90_000,
  }) {
    beforeStart();
    changed(1);
    let id,
      done = false,
      cursor = 0,
      stdout = "",
      stderr = "";
    const cancel = () => {
      if (id) void panel.call("process.cancel", { processId: id }).catch(() => {});
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      if (signal?.aborted) throw new Error("已取消");
      pendingStarts++;
      let started;
      try {
        started = await panel.call("process.spawn", {
          executableHandle,
          directoryHandle,
          ...(entryHandle ? { entryHandle } : {}),
          args,
          ...(input === undefined ? {} : { stdin: "pipe" }),
        });
        if (!started?.processId) throw new Error("无法启动本地检查");
        id = started.processId;
        ids.add(id);
        if (ids.size > 500) ids.delete(ids.values().next().value);
      } finally {
        pendingStarts--;
      }
      if (signal?.aborted) throw new Error("已取消");
      if (input !== undefined) {
        const json = JSON.stringify(input);
        for (let offset = 0; offset < json.length; ) {
          let end = Math.min(json.length, offset + 4096);
          if (end < json.length && /[\uD800-\uDBFF]/.test(json[end - 1])) end--;
          if (signal?.aborted) throw new Error("已取消");
          await panel.call("process.write", { processId: id, text: json.slice(offset, end) });
          offset = end;
        }
        await panel.call("process.end", { processId: id });
      }
      const deadline = Date.now() + timeout;
      for (;;) {
        if (signal?.aborted) throw new Error("已取消");
        if (Date.now() > deadline) throw new Error("本地检查超时，请稍后重试");
        const receipt = await panel.call("process.get", {
          processId: id,
          afterSequence: cursor,
          limit: 128,
        });
        if (
          !receipt?.found ||
          receipt.processId !== id ||
          receipt.truncated ||
          !Array.isArray(receipt.events)
        )
          throw new Error("检查结果不完整，请重试");
        for (const event of receipt.events) {
          if (event.sequence !== cursor + 1) throw new Error("检查结果顺序异常，请重试");
          cursor = event.sequence;
          if (event.event === "process.output") {
            if (event.payload?.stream === "stdout") stdout += String(event.payload.text || "");
            else stderr += String(event.payload?.text || "");
            if (stdout.length + stderr.length > 4_000_000)
              throw new Error("检索结果过大，请缩小范围");
          }
        }
        if (receipt.status === "exited" && !receipt.hasMore) {
          done = true;
          return { code: receipt.code, stdout, stderr };
        }
        if (!receipt.hasMore) await sleep(180);
      }
    } finally {
      if (!done) cancel();
      signal?.removeEventListener("abort", cancel);
      changed(-1);
    }
  }
  async function entry() {
    if (!entryPromise)
      entryPromise = (async () => {
        const executable = await panel.call("process.find", { name: "node" });
        if (!executable?.available || !executable.handle)
          throw new Error("无法使用文件检查工具，请更新 CodeShell 后重试");
        const result = await panel.call("process.resolveEntry", {
          name: "download-library",
          executableHandle: executable.handle,
        });
        if (!result?.handle) throw new Error("无法校验下载记录工具，请更新面板");
        return { executableHandle: executable.handle, entryHandle: result.handle };
      })().catch((error) => {
        entryPromise = null;
        throw error;
      });
    return entryPromise;
  }
  return {
    run,
    get busy() {
      return active > 0;
    },
    ignores(payload) {
      return pendingStarts > 0 || ids.has(payload?.processId);
    },
    async files(directory, action, files, signal) {
      const handles = await entry();
      const result = await run({
        ...handles,
        directoryHandle: directory.handle,
        input: {
          action,
          files: files.map(({ path, bytes, modifiedAt }) => ({
            path,
            ...(Number.isSafeInteger(bytes) ? { bytes } : {}),
            ...(Number.isSafeInteger(modifiedAt) ? { modifiedAt } : {}),
          })),
        },
        signal,
        timeout: 30_000,
      });
      let response;
      try {
        response = JSON.parse(result.stdout);
      } catch {
        throw new Error("文件检查未返回有效结果");
      }
      if (result.code !== 0 || response.error) throw new Error(response.error || "文件检查失败");
      if (!Array.isArray(response.files) || response.files.length !== files.length)
        throw new Error("文件检查结果不完整");
      for (const [index, file] of response.files.entries()) {
        if (
          file?.path !== files[index].path ||
          !["present", "missing", "empty", "changed", "unavailable"].includes(file.status) ||
          (file.status === "present" &&
            (!Number.isSafeInteger(file.bytes) ||
              file.bytes <= 0 ||
              !Number.isSafeInteger(file.modifiedAt)))
        ) {
          throw new Error("文件检查结果与请求不匹配");
        }
      }
      return response.files;
    },
  };
}
