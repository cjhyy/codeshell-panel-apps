import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { runMediaProcess } from "../process-runner.js";
import { directory, sealed, regular, fileHash, publish } from "../editor-runtime/files.js";
import { record, resourceId, integer } from "../editor-runtime/protocol.js";
import {
  SEPARATION_MODEL_ID,
  SEPARATION_MODEL_SHA,
  SEPARATION_MAX_SECONDS,
  type SeparationCapability,
} from "../../src/editor/separation.js";
import { SEPARATION_PYTHON } from "./python.js";

// Public model bytes from the publisher's pinned release asset, verified 2026-09-16.
export const SEPARATION_MODEL = Object.freeze({
  filename: "UVR_MDXNET_KARA_2.onnx",
  url: "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR_MDXNET_KARA_2.onnx",
  bytes: 52786726,
  sha256: SEPARATION_MODEL_SHA,
  package: "audio-separator[cpu]==0.41.1",
});
export interface SeparationContext {
  jobDir: string;
  runtimeDir: string;
  signal: AbortSignal;
  reportProgress(value: {
    stage: string;
    message: string;
    fraction?: number;
  }): void | Promise<void>;
  /** Trusted native/test options only; never accepted from task JSON. */
  tools?: { uvPath?: string; ffmpegPath?: string; ffprobePath?: string };
}
export type SeparationRequest =
  | { action: "status" | "setup" }
  | { action: "separate"; resourceId: string; duration: number };
export function validateSeparationRequest(raw: unknown): SeparationRequest {
  const value = record(raw, ["action", "resourceId", "duration"], "人声分离请求");
  if (value.action === "separate")
    return {
      action: "separate",
      resourceId: resourceId(value.resourceId),
      duration: integer(value.duration, 1, SEPARATION_MAX_SECONDS * 240000),
    };
  if (
    !["status", "setup"].includes(value.action) ||
    value.resourceId !== undefined ||
    value.duration !== undefined
  )
    throw new Error("人声分离请求无效");
  return { action: value.action };
}
const python = (root: string) =>
  join(root, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
async function probe(root: string, ctx: SeparationContext): Promise<boolean> {
  try {
    const model = await regular(root, [SEPARATION_MODEL.filename]);
    if (
      (await stat(model)).size !== SEPARATION_MODEL.bytes ||
      (await fileHash(model, ctx.signal)) !== SEPARATION_MODEL.sha256
    )
      return false;
    const output = await runMediaProcess(
      python(root),
      [
        "-I",
        "-c",
        "import importlib.metadata as m; import onnxruntime,numpy,soundfile; from audio_separator.separator.architectures.mdx_separator import MDXSeparator; assert m.version('audio-separator')=='0.41.1'; assert m.version('librosa')=='0.11.0'; assert m.version('audioread')=='3.0.1'; print('ready')",
      ],
      { signal: ctx.signal, maxStdoutBytes: 4096 },
    );
    return output.stdout.toString().trim() === "ready";
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    return false;
  }
}
async function commandAvailable(command: string, ctx: SeparationContext) {
  try {
    await runMediaProcess(command, ["-version"], { signal: ctx.signal, maxStdoutBytes: 64 * 1024 });
    return true;
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    return false;
  }
}
async function status(root: string, ctx: SeparationContext): Promise<SeparationCapability> {
  const base = { modelId: SEPARATION_MODEL_ID, canInstall: false };
  if (
    !(await commandAvailable(ctx.tools?.ffmpegPath ?? "ffmpeg", ctx)) ||
    !(await commandAvailable(ctx.tools?.ffprobePath ?? "ffprobe", ctx))
  )
    return { ...base, state: "unavailable", message: "请先安装 FFmpeg 与 ffprobe，再准备人声分离" };
  if (await probe(root, ctx))
    return { ...base, state: "ready", message: "本地分离模型已就绪，处理时无需联网" };
  let available = true;
  try {
    await runMediaProcess(ctx.tools?.uvPath ?? "uv", ["--version"], {
      signal: ctx.signal,
      maxStdoutBytes: 4096,
    });
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    available = false;
  }
  return {
    ...base,
    state: available ? "not-installed" : "unavailable",
    canInstall: available,
    message: available
      ? "首次使用需下载约 51 MiB 的模型及 Python 处理依赖；点击安装后开始"
      : "请先安装 uv，再准备本地分离模型",
  };
}
async function download(root: string, ctx: SeparationContext) {
  const path = join(root, SEPARATION_MODEL.filename),
    partial = `${path}.partial`;
  const response = await fetch(SEPARATION_MODEL.url, { signal: ctx.signal });
  if (!response.ok || !response.body) throw new Error("分离模型下载失败，请稍后重试");
  const stream = response.body.getReader(),
    file = await open(partial, "wx", 0o600);
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await stream.read();
      if (done) break;
      ctx.signal.throwIfAborted();
      bytes += value.byteLength;
      if (bytes > SEPARATION_MODEL.bytes) throw new Error("分离模型大小不匹配");
      let position = 0;
      while (position < value.byteLength) {
        const written = await file.write(value, position, value.byteLength - position);
        if (!written.bytesWritten) throw new Error("模型文件写入失败");
        position += written.bytesWritten;
      }
      await ctx.reportProgress({
        stage: "download",
        fraction: bytes / SEPARATION_MODEL.bytes,
        message: "正在下载公开的分离模型",
      });
    }
    await file.sync();
  } finally {
    await file.close();
    await stream.cancel().catch(() => {});
  }
  if (
    bytes !== SEPARATION_MODEL.bytes ||
    (await fileHash(partial, ctx.signal)) !== SEPARATION_MODEL.sha256
  )
    throw new Error("分离模型校验失败，请重新安装");
  await rename(partial, path);
}
async function setup(runtime: string, root: string, ctx: SeparationContext) {
  const lockPath = join(runtime, "setup.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let alive = true;
    try {
      const pid = Number(await readFile(lockPath, "utf8"));
      if (!Number.isSafeInteger(pid) || pid < 1) throw new Error();
      process.kill(pid, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ESRCH") alive = false;
    }
    if (alive) throw new Error("另一个安装任务仍在进行，请等待它结束");
    await rm(lockPath, { force: true });
    lock = await open(lockPath, "wx", 0o600);
  }
  await lock.writeFile(String(process.pid));
  const staging = await directory(runtime, [`setup-${randomUUID()}`]);
  try {
    if (await probe(root, ctx)) return await status(root, ctx);
    const capabilities = await status(root, ctx);
    if (!capabilities.canInstall) throw new Error(capabilities.message);
    const env = {
      ...process.env,
      UV_CACHE_DIR: join(runtime, "package-cache"),
      UV_PYTHON_INSTALL_DIR: join(runtime, "python"),
      UV_LINK_MODE: "copy",
      UV_NO_PROGRESS: "1",
    };
    await ctx.reportProgress({ stage: "install", message: "正在准备独立 Python 与分离处理器" });
    await runMediaProcess(
      ctx.tools?.uvPath ?? "uv",
      ["venv", "--python", "3.12", join(staging, "venv")],
      { signal: ctx.signal, env, maxStdoutBytes: 64 * 1024 },
    );
    await runMediaProcess(
      ctx.tools?.uvPath ?? "uv",
      [
        "pip",
        "install",
        "--python",
        python(staging),
        SEPARATION_MODEL.package,
        "audioread==3.0.1",
        "librosa==0.11.0",
      ],
      { signal: ctx.signal, env, maxStdoutBytes: 64 * 1024 },
    );
    await download(staging, ctx);
    if (!(await probe(staging, ctx))) throw new Error("处理器安装验证失败，请重试");
    ctx.signal.throwIfAborted();
    await rm(root, { recursive: true, force: true });
    await rename(staging, root);
    return await status(root, ctx);
  } finally {
    await rm(staging, { recursive: true, force: true });
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
async function inspect(path: string, ctx: SeparationContext) {
  const output = await runMediaProcess(
    ctx.tools?.ffprobePath ?? "ffprobe",
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-show_entries",
      "format=duration:stream=codec_type,sample_rate,channels,duration,duration_ts,time_base",
      "-of",
      "json",
      path,
    ],
    { signal: ctx.signal, maxStdoutBytes: 32768 },
  );
  const data = JSON.parse(output.stdout.toString()),
    audio = data.streams?.find((stream: any) => stream.codec_type === "audio");
  if (!audio || !Number.isFinite(Number(data.format?.duration)))
    throw new Error("素材没有可处理的声音");
  return {
    duration: Number(data.format.duration),
    rate: Number(audio.sample_rate),
    channels: Number(audio.channels),
  };
}
export async function runSeparationRequest(raw: unknown, ctx: SeparationContext) {
  const request = validateSeparationRequest(raw);
  ctx.signal.throwIfAborted();
  const job = await sealed(ctx.jobDir),
    runtime = await sealed(ctx.runtimeDir),
    root = join(runtime, "v1");
  if (request.action === "status") return { result: await status(root, ctx), artifacts: [] };
  if (request.action === "setup") return { result: await setup(runtime, root, ctx), artifacts: [] };
  const ready = await status(root, ctx);
  if (ready.state !== "ready") throw new Error(ready.message);
  const source = await regular(job, ["inputs", "source.bin"]),
    original = await inspect(source, ctx),
    duration = request.duration / 240000;
  const sourceHash = await fileHash(source, ctx.signal);
  if (request.resourceId.startsWith("asset-") && request.resourceId !== `asset-${sourceHash}`)
    throw new Error("原素材内容校验不匹配，请重新连接素材");
  if (Math.abs(original.duration - duration) > 0.1)
    throw new Error("原素材时长已变化，请重新导入后再处理");
  if (original.channels < 1 || original.channels > 8)
    throw new Error("人声分离支持 1 到 8 声道的素材");
  const work = await directory(job, [`separate-${randomUUID()}`]),
    input = join(work, "input.wav"),
    sampleCount = Math.ceil(duration * 44100);
  try {
    await ctx.reportProgress({ stage: "decode", fraction: 0, message: "正在准备原始音频" });
    await runMediaProcess(
      ctx.tools?.ffmpegPath ?? "ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "mov,matroska,webm,avi,mp3,wav,aiff,flac,ogg,aac",
        "-i",
        source,
        "-map",
        "0:a:0",
        "-vn",
        "-af",
        `aresample=44100:async=1:first_pts=0,apad,atrim=end_sample=${sampleCount}`,
        "-ar",
        "44100",
        "-ac",
        "2",
        "-c:a",
        "pcm_f32le",
        "-n",
        input,
      ],
      { signal: ctx.signal, maxStdoutBytes: 4096 },
    );
    await ctx.reportProgress({ stage: "separate", fraction: 0, message: "正在分离人声与伴奏" });
    let pending = "",
      latest = 0,
      progressWork = Promise.resolve();
    await runMediaProcess(python(root), ["-I", "-c", SEPARATION_PYTHON, input, root, work], {
      signal: ctx.signal,
      maxStdoutBytes: 128 * 1024,
      onStdout(chunk) {
        pending += chunk.toString();
        const lines = pending.split(/\r?\n/);
        pending = lines.pop()!;
        if (pending.length > 8192) throw new Error("分离任务输出过长");
        for (const line of lines) {
          let value;
          try {
            value = JSON.parse(line);
          } catch {
            continue;
          }
          if (Number.isFinite(value.fraction) && value.fraction >= latest && value.fraction <= 1) {
            latest = value.fraction;
            const fraction = latest;
            progressWork = progressWork.then(async () => {
              await ctx.reportProgress({
                stage: "separate",
                fraction,
                message: "正在分离人声与伴奏",
              });
            });
            void progressWork.catch(() => {});
          }
        }
      },
    });
    await progressWork;
    const artifacts = [];
    for (const role of ["vocals", "instrumental"] as const) {
      const path = await regular(work, [`${role}.wav`]),
        check = await inspect(path, ctx);
      if (
        check.rate !== 44100 ||
        check.channels !== 2 ||
        Math.abs(check.duration - sampleCount / 44100) > 1 / 44100
      )
        throw new Error("分离产物采样与原素材不一致，未应用任何修改");
      artifacts.push(await publish(job, path, "wav", "audio/wav", role, ctx.signal));
    }
    ctx.signal.throwIfAborted();
    const stem = (index: number) => {
      const a = artifacts[index]!;
      return {
        assetId: a.assetId,
        sha256: a.sha256,
        bytes: a.bytes,
        mimeType: "audio/wav" as const,
      };
    };
    return {
      result: {
        sourceResourceId: request.resourceId,
        sourceSha256: sourceHash,
        modelId: SEPARATION_MODEL_ID,
        modelSha256: SEPARATION_MODEL.sha256,
        sampleRate: 44100,
        sampleCount,
        durationSeconds: sampleCount / 44100,
        stems: { vocals: stem(0), instrumental: stem(1) },
      },
      artifacts,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
