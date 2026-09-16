import { runSyncRequest } from "./editor-sync/provider";
import { SnapshotSyncError } from "../src/editor/snapshot-sync";

/** The Host selects this reviewed entry and seals process.cwd() to the chosen directory handle. */
const controller = new AbortController();
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());
try {
  if (process.argv.length !== 2)
    throw new SnapshotSyncError("INVALID_REQUEST", "同步工具不接受命令行路径");
  const chunks: Buffer[] = [],
    maximum = 32 * 1024;
  let bytes = 0;
  for await (const part of process.stdin) {
    bytes += part.length;
    if (bytes > maximum) throw new SnapshotSyncError("LIMIT_EXCEEDED", "同步请求超过限制");
    chunks.push(part);
  }
  controller.signal.throwIfAborted();
  const request = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
  );
  const value = await runSyncRequest(process.cwd(), request, controller.signal),
    output = JSON.stringify({ ok: true, value });
  if (Buffer.byteLength(output) > 224 * 1024)
    throw new SnapshotSyncError("LIMIT_EXCEEDED", "同步结果超过通信限制，未返回不完整数据");
  process.stdout.write(`${output}\n`);
} catch (cause) {
  const code = controller.signal.aborted
    ? "CANCELLED"
    : cause instanceof SnapshotSyncError
      ? cause.code
      : (cause as NodeJS.ErrnoException).code === "ENOENT"
        ? "MISSING_OBJECT"
        : "SYNC_IO_ERROR";
  const message = controller.signal.aborted
    ? "同步已取消；已发布的不可变快照可以安全重试"
    : cause instanceof SnapshotSyncError
      ? cause.message
      : code === "MISSING_OBJECT"
        ? "同步文件尚未传到此设备，请等待或从另一台设备补回"
        : "同步目录暂时无法读取或写入，请检查授权、磁盘空间和下载状态";
  process.stdout.write(`${JSON.stringify({ ok: false, error: { code, message } })}\n`);
  process.exitCode = 1;
}
