import { lstat, mkdir, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createAudio8TtsProvider, validateAudio8TtsInput } from "./providers/audio8.js";
import { createQwenTtsProvider, validateQwenTtsInput } from "./providers/qwen.js";
import { acquireVoiceQueue } from "./queue.js";
import { combineAbortSignals } from "./signals.js";
import { mediaAbortError } from "./process-runner.js";
import type { MediaJobContext } from "./contracts.js";

export interface VoiceRequest {
  action: "status" | "setup" | "generate";
  engine: "audio8-tts" | "qwen3-tts";
  scopeKey: string;
  jobId: string;
  text?: string;
  referenceText?: string;
  rate?: number;
  referenceFile?: string;
}
class RequestError extends Error {}

export function validateVoiceRequest(raw: unknown): VoiceRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new RequestError("声音任务参数无效");
  const value = raw as Record<string, unknown>;
  const allowed = new Set([
    "action",
    "engine",
    "scopeKey",
    "jobId",
    "text",
    "referenceText",
    "rate",
    "referenceFile",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new RequestError("声音任务包含不支持的参数");
  if (!["status", "setup", "generate"].includes(String(value.action)))
    throw new RequestError("声音任务类型无效");
  if (value.engine !== "audio8-tts" && value.engine !== "qwen3-tts")
    throw new RequestError("请选择支持的本地声音引擎");
  if (typeof value.scopeKey !== "string" || !/^[a-f0-9]{64}$/.test(value.scopeKey))
    throw new RequestError("声音任务工程标识无效");
  if (typeof value.jobId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.jobId))
    throw new RequestError("声音任务标识无效");
  if (
    value.referenceFile !== undefined &&
    (typeof value.referenceFile !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.referenceFile) ||
      value.referenceFile === "output.wav")
  )
    throw new RequestError("参考录音文件名无效");
  if (value.action === "generate" && typeof value.referenceFile !== "string")
    throw new RequestError("请先提供参考录音");
  if (
    value.text !== undefined &&
    (typeof value.text !== "string" || Array.from(value.text).length > 2000)
  )
    throw new RequestError("声音克隆每次最多支持 2000 字");
  if (
    value.referenceText !== undefined &&
    (typeof value.referenceText !== "string" || Array.from(value.referenceText).length > 1000)
  )
    throw new RequestError("参考录音逐字稿最多支持 1000 字");
  if (
    value.rate !== undefined &&
    (typeof value.rate !== "number" ||
      !Number.isFinite(value.rate) ||
      value.rate < 0.5 ||
      value.rate > 2)
  )
    throw new RequestError("语速须在 0.5 至 2 倍之间");
  return value as unknown as VoiceRequest;
}

async function directory(root: string, parts: string[], create: boolean) {
  let path = root;
  for (const part of parts) {
    path = join(path, part);
    if (create)
      await mkdir(path, { mode: 0o700 }).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
    const info = await lstat(path).catch((error) => {
      if (!create && error.code === "ENOENT") return undefined;
      throw error;
    });
    if (info && (!info.isDirectory() || info.isSymbolicLink()))
      throw new RequestError("声音任务目录无效，请重新打开面板后重试");
  }
  return path;
}

const safeProviderMessages = new Set([
  "请输入配音文字",
  "配音参数必须是对象",
  "配音文字须为 1 至 6000 字",
  "声音克隆每次最多支持 2000 字",
  "配音文字至少需要一个可朗读的字词",
  "请填写参考录音的逐字稿，最多 1000 字",
  "配音仅支持普通文字，不支持语音控制标记或控制字符",
  "语速须在 0.5 至 2 倍之间",
  "参考录音须为 512 MB 以内的本地素材",
  "无法读取录音时长，请选择有效的音频或视频素材",
  "参考录音需要 3 至 30 秒，请先裁剪为一段清晰的人声",
  "录音中没有可听见的声音",
  "部分配音未完整结束，请缩短参考逐字稿或文稿后重试",
  "有一段文字未生成有效人声，请调整这段文稿后重试",
  "本地模型校验失败，请重新准备声音克隆",
  "未生成合格的 48 kHz WAV 配音",
  "本地声音生成超时，请缩短文稿后重试",
  "本地声音生成失败，请检查参考素材与逐字稿，或缩短文稿后重试",
  "本地声音克隆需要 Apple Silicon Mac（M 系列芯片）",
  "本地声音克隆至少需要 4 GB 内存",
  "本地声音克隆至少需要 8 GB 内存",
  "声音克隆准备已取消，可以重新准备",
  "声音克隆准备超时，请检查网络后重试",
  "Audio8 声音克隆准备失败；需要 uv、FFmpeg、完整模型与可用空间，请检查网络和本机环境后重试",
  "Qwen3 声音克隆准备失败；需要 uv、FFmpeg、完整模型与可用空间，请检查网络和本机环境后重试",
  "Audio8 无法创建独立环境，请检查磁盘空间和目录权限",
  "Audio8 临时文件清理未完成，请检查目录权限后重试",
]);
function safeError(error: unknown, cancelled: boolean) {
  if (cancelled || (error instanceof Error && error.name === "AbortError"))
    return "本地声音任务已取消";
  if (error instanceof RequestError) return error.message;
  if (error instanceof Error && safeProviderMessages.has(error.message)) return error.message;
  return "本地声音任务未完成，请检查安装状态、参考录音和逐字稿后重试";
}

function publicStatus<T extends { reason?: string }>(status: T): T {
  if (status.reason && (/[\/\\\r\n]/.test(status.reason) || status.reason.length > 500))
    return { ...status, reason: "本地声音环境需要重新准备，请在初始化中重试" };
  return status;
}

/** One request per Host tool invocation. No repository, Electron, or CodeShell runtime dependency. */
export async function runCli(raw: unknown): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGTERM", abort);
  process.once("SIGINT", abort);
  const emit = (value: unknown) => {
    process.stdout.write(`${JSON.stringify(value)}\n`);
  };
  let release: (() => Promise<void>) | undefined;
  let published = "";
  try {
    const request = validateVoiceRequest(raw);
    const root = await realpath(process.cwd());
    const runtime = await directory(root, ["runtime"], request.action !== "status");
    await directory(root, ["runtime", request.engine], false);
    const provider =
      request.engine === "audio8-tts"
        ? createAudio8TtsProvider({ runtimeDir: runtime })
        : createQwenTtsProvider({ runtimeDir: runtime });
    if (request.action === "status") {
      const result = await provider.status(controller.signal);
      emit({ type: "result", result: publicStatus(result) });
      return;
    }
    const job = await directory(root, ["jobs", request.scopeKey, request.jobId], true);
    const workDir = await directory(job, ["work"], true);
    const outputDir = await directory(job, ["rendered"], true);
    const signal = combineAbortSignals([
      controller.signal,
      AbortSignal.timeout(request.action === "setup" ? 45 * 60_000 : 25 * 60_000),
    ]);
    const context: MediaJobContext = {
      scope: { appId: "video-studio", projectPath: join(root, "scopes", request.scopeKey) },
      jobId: request.jobId,
      attempt: 1,
      signal,
      workDir,
      outputDir,
      cacheDir: join(runtime, "cache", request.scopeKey),
      reportProgress: async (progress) => {
        emit({ type: "progress", progress });
      },
    };
    const queue = await directory(root, ["runtime", ".queues", request.engine], true);
    release = await acquireVoiceQueue(queue, signal, () =>
      context.reportProgress({ stage: "waiting", message: "等待上一段本地配音完成" }),
    );
    if (request.action === "setup") {
      emit({ type: "result", result: publicStatus(await provider.setup(context)) });
      return;
    }
    const referencePath = join(job, request.referenceFile!);
    const reference = await lstat(referencePath);
    if (
      !reference.isFile() ||
      reference.isSymbolicLink() ||
      dirname(await realpath(referencePath)) !== job
    )
      throw new RequestError("参考录音须来自当前声音任务");
    const validate =
      request.engine === "audio8-tts" ? validateAudio8TtsInput : validateQwenTtsInput;
    const input = validate({
      text: request.text,
      referenceText: request.referenceText,
      rate: request.rate,
      referencePath,
    });
    await rm(join(job, "output.wav"), { force: true });
    const result = await provider.generate(input, context);
    if (signal.aborted) throw mediaAbortError();
    if (dirname(await realpath(result.path)) !== outputDir)
      throw new RequestError("配音结果未通过检查");
    const bytes = (await stat(result.path)).size;
    published = join(job, "output.wav");
    await rename(result.path, published);
    if (signal.aborted) throw mediaAbortError();
    emit({
      type: "result",
      result: {
        engine: result.engine,
        file: "output.wav",
        bytes,
        mimeType: result.mimeType,
        durationSeconds: result.durationSeconds,
        sampleRate: result.sampleRate,
        channels: result.channels,
        voice: result.voice,
        rate: result.rate,
        cached: result.cached,
      },
    });
    published = "";
  } catch (error) {
    if (published) await rm(published, { force: true }).catch(() => {});
    emit({ type: "error", message: safeError(error, controller.signal.aborted) });
    process.exitCode = 1;
  } finally {
    await release?.().catch(() => {});
    process.removeListener("SIGTERM", abort);
    process.removeListener("SIGINT", abort);
  }
}
