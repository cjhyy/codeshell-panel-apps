import { fileURLToPath } from "node:url";
import { isAbsolute } from "node:path";
import { runEditorRequest, type EditorRuntimeContext } from "./runtime.js";
import { EditorTaskError, record } from "./protocol.js";
import { sealed } from "./files.js";
import { combineAbortSignals } from "../signals.js";

/** Host seals both directories and supplies jobId/scopeKey; JSON supplies no paths or executable code. */
export async function runEditorCli(
  runtime: Pick<EditorRuntimeContext, "runtimeSource" | "runtimeSha">,
): Promise<void> {
  const controller = new AbortController(),
    cancel = () => controller.abort();
  process.once("SIGTERM", cancel);
  process.once("SIGINT", cancel);
  let outputBytes = 0,
    lastProgress = 0,
    lastStage = "";
  const emit = (value: unknown) => {
    const line = `${JSON.stringify(value)}\n`,
      bytes = Buffer.byteLength(line);
    if (bytes > 240 * 1024 || outputBytes + bytes > 3.5 * 1024 * 1024)
      throw new EditorTaskError("OUTPUT_LIMIT", "任务回执超过大小限制，请分批处理");
    outputBytes += bytes;
    process.stdout.write(line);
  };
  try {
    const args = process.argv.slice(2);
    if (
      args.length !== 4 ||
      new Set([args[0], args[2]]).size !== 2 ||
      [args[0], args[2]].some((flag) => !["--job-dir", "--runtime-dir"].includes(flag))
    )
      throw new EditorTaskError("INVALID_DIRECTORY", "此入口必须由主程序提供授权任务和运行目录");
    const argument = async (flag: string) => {
      const path = args[args.indexOf(flag) + 1];
      if (!path || !isAbsolute(path))
        throw new EditorTaskError("INVALID_DIRECTORY", "授权运行目录无效");
      return sealed(path);
    };
    const jobDir = await argument("--job-dir"),
      runtimeDir = await argument("--runtime-dir");
    const chunks: Buffer[] = [];
    let count = 0;
    for await (const chunk of process.stdin) {
      count += chunk.length;
      if (count > 2 * 1024 * 1024)
        throw new EditorTaskError("INPUT_LIMIT", "任务请求超过 2MiB 限制");
      chunks.push(Buffer.from(chunk));
    }
    const envelope = record(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
      [
        "action",
        "transferId",
        "documentHash",
        "sequenceId",
        "resourceIds",
        "confirmedReferences",
        "assetIds",
        "chunkIndex",
        "chunkCount",
        "byteLength",
        "dataBase64",
        "profile",
        "preparedAudio",
        "sourceDuration",
        "alignment",
        "bundleHash",
        "batchIndex",
        "scopeKey",
        "jobId",
      ],
      "主程序任务",
    );
    const { scopeKey, jobId, ...request } = envelope;
    const signal = combineAbortSignals([
      controller.signal,
      AbortSignal.timeout(2 * 60 * 60 * 1000),
    ]);
    const response = await runEditorRequest(request, {
      ...runtime,
      builtinNarrationPath: fileURLToPath(new URL("../demo-narration.mp3", import.meta.url)),
      jobDir,
      runtimeDir,
      scopeKey,
      jobId,
      signal,
      reportProgress: (value) => {
        const now = Date.now(),
          stage = value.stage ?? "";
        if (
          outputBytes > 3 * 1024 * 1024 ||
          (now - lastProgress < 500 && stage === lastStage && value.fraction !== 1)
        )
          return;
        lastProgress = now;
        lastStage = stage;
        emit({ type: "progress", progress: value });
      },
    });
    signal.throwIfAborted();
    emit({ type: "result", result: response });
  } catch (error) {
    const known = error instanceof EditorTaskError;
    const cancelled =
      controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
    const code = cancelled
      ? "CANCELLED"
      : known
        ? error.code
        : (error as NodeJS.ErrnoException)?.code === "ENOENT"
          ? "MISSING_DEPENDENCY_OR_INPUT"
          : "EDITOR_TASK_FAILED";
    const candidate = error instanceof Error ? error.message : "";
    const message = cancelled
      ? "编辑器任务已取消"
      : known
        ? error.message
        : candidate.length < 350 &&
            candidate &&
            !/(?:\/Users\/|\/home\/|\/tmp\/|\/private\/|[A-Z]:\\|https?:|ENOENT|EACCES|exited with code)/.test(
              candidate,
            )
          ? candidate
          : "编辑器处理未完成，请检查运行依赖、素材和任务状态后重试";
    emit({
      type: "error",
      code,
      message,
      retryable: cancelled || (known ? error.retryable : true),
    });
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGTERM", cancel);
    process.removeListener("SIGINT", cancel);
  }
}
