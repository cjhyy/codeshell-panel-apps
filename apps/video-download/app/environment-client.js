// Environment snapshots are data; executable grants are reacquired by each page.
export function createEnvironmentClient({ panel, processes, assertCurrent = () => {} }) {
  let handles;
  let closed = false;
  let tail = Promise.resolve();
  function current() {
    assertCurrent();
    if (closed) throw new Error("项目页面已关闭。");
  }
  async function read({ refresh = false, includeLatest = false } = {}) {
    const operation = tail
      .catch(() => {})
      .then(async () => {
        current();
        const directory = await panel.call("filesystem.getKnownDirectory", { name: "project" });
        current();
        if (!handles) {
          const executable = await panel.call("process.find", { name: "node" });
          current();
          if (!executable?.available || !executable.handle)
            throw new Error("未找到 Node 运行环境。");
          const entry = await panel.call("process.resolveEntry", {
            name: "download-environment",
            executableHandle: executable.handle,
          });
          current();
          if (!entry?.handle) throw new Error("无法校验环境检测工具，请更新面板。");
          handles = { executableHandle: executable.handle, entryHandle: entry.handle };
        }
        current();
        const receipt = await processes.run({
          ...handles,
          directoryHandle: directory.handle,
          input: { action: refresh ? "refresh" : "get", includeLatest },
          timeout: 70_000,
        });
        current();
        let envelope;
        try {
          envelope = JSON.parse(receipt.stdout);
        } catch {
          throw new Error("环境检测未返回有效结果。");
        }
        if (receipt.code !== 0 || !envelope?.ok)
          throw new Error(envelope?.error?.message || "环境检测失败。");
        if (
          envelope.format !== "mimi-download.environment" ||
          envelope.schemaVersion !== 1 ||
          !envelope.result?.dependencies ||
          typeof envelope.result.cached !== "boolean"
        )
          throw new Error("环境检测结果不完整。");
        return envelope.result;
      });
    tail = operation;
    return operation;
  }
  return {
    read,
    destroy() {
      closed = true;
      handles = null;
    },
  };
}
