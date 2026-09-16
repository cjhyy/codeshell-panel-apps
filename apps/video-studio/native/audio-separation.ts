import { isAbsolute } from "node:path";
import { runSeparationRequest } from "./separation/runtime.js";
import { record } from "./editor-runtime/protocol.js";
import { combineAbortSignals } from "./signals.js";

const controller = new AbortController(),
  cancel = () => controller.abort();
process.once("SIGTERM", cancel);
process.once("SIGINT", cancel);
let last = 0,
  lastStage = "",
  bytes = 0;
const emit = (value: unknown) => {
  const line = JSON.stringify(value) + "\n";
  bytes += Buffer.byteLength(line);
  if (bytes > 3.5 * 1024 * 1024) throw new Error("任务回执超过限制");
  process.stdout.write(line);
};
try {
  const args = process.argv.slice(2);
  if (
    args.length !== 4 ||
    new Set([args[0], args[2]]).size !== 2 ||
    [args[0], args[2]].some((flag) => !["--job-dir", "--runtime-dir"].includes(flag))
  )
    throw new Error("请从视频面板启动分离任务");
  const dir = (flag: string) => {
    const path = args[args.indexOf(flag) + 1];
    if (!path || !isAbsolute(path)) throw new Error("授权任务目录无效");
    return path;
  };
  const chunks: Buffer[] = [];
  let count = 0;
  for await (const chunk of process.stdin) {
    count += chunk.length;
    if (count > 65536) throw new Error("分离请求超过大小限制");
    chunks.push(Buffer.from(chunk));
  }
  const envelope = record(
    JSON.parse(Buffer.concat(chunks).toString()),
    ["action", "resourceId", "duration", "scopeKey", "jobId"],
    "分离任务",
  );
  if (
    typeof envelope.scopeKey !== "string" ||
    !/^[a-f0-9]{64}$/.test(envelope.scopeKey) ||
    typeof envelope.jobId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(envelope.jobId)
  )
    throw new Error("分离任务标识无效");
  const { scopeKey, jobId, ...request } = envelope;
  const signal = combineAbortSignals([controller.signal, AbortSignal.timeout(2 * 60 * 60 * 1000)]);
  const result = await runSeparationRequest(request, {
    jobDir: dir("--job-dir"),
    runtimeDir: dir("--runtime-dir"),
    signal,
    reportProgress(progress) {
      const now = Date.now();
      if (
        bytes > 3 * 1024 * 1024 ||
        (now - last < 500 && progress.stage === lastStage && progress.fraction !== 1)
      )
        return;
      last = now;
      lastStage = progress.stage;
      emit({ type: "progress", progress });
    },
  });
  signal.throwIfAborted();
  emit({ type: "result", result });
} catch (error) {
  const cancelled =
      controller.signal.aborted || (error instanceof Error && error.name === "AbortError"),
    raw = error instanceof Error ? error.message : "";
  const message = cancelled
    ? "分离任务已取消"
    : raw &&
        raw.length < 350 &&
        !/(?:\/Users\/|\/home\/|\/tmp\/|https?:|ENOENT|EACCES|exited with code)/.test(raw)
      ? raw
      : "本地分离未完成，请检查处理器与素材后重试";
  emit({
    type: "error",
    code: cancelled ? "CANCELLED" : "SEPARATION_FAILED",
    message,
    retryable: true,
  });
  process.exitCode = 1;
} finally {
  process.removeListener("SIGTERM", cancel);
  process.removeListener("SIGINT", cancel);
}
