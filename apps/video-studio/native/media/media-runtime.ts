import { createHash } from "node:crypto";
import { createAudio8TtsProvider } from "../providers/audio8.js";
import { createQwenTtsProvider } from "../providers/qwen.js";
import { acquireVoiceQueue } from "../queue.js";
import { resolveMediaConnections } from "./media-connections.js";
import { createReadStream } from "node:fs";
import { access, copyFile, lstat, mkdir, realpath, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import {
  createMediaJobProcessors,
  inspectMediaFile,
  type MediaProcessorOptions,
} from "./media-processors.js";
import { createAudioEnhanceProcessor } from "./media-audio-enhance.js";
import { createAudioExtractProcessor } from "./media-audio-extract.js";
import { createManagedTtsProviders } from "./media-tts-providers.js";
import {
  detectLocalTts,
  generateLocalTts,
  validateLocalTtsInput,
  type LocalTtsVoice,
} from "./media-tts.js";
import { generateOpenAiTts } from "./media-tts-openai.js";
import {
  createHyperframesAdapter,
  detectHyperframesRuntime,
  type HyperframesSceneParams,
} from "./hyperframes-adapter.js";
import { findCaptionBrowser, MediaCaptionRenderer } from "./media-caption-renderer.js";
import { mediaAbortError, runMediaProcess } from "./media-process-runner.js";
import { findExecutable, redactHomePath } from "./media-executables.js";
import type { MediaAsset, MediaJobContext, MediaJobProgress } from "./media-types.js";

export interface MediaConnection {
  description: {
    id: string;
    name: string;
    provider: string;
    available: boolean;
    reason?: string;
    voices: LocalTtsVoice[];
    defaultVoiceId?: string;
    maxTextLength: number;
    supportsInstructions: boolean;
  };
  connectionId: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  defaultRate: number;
  defaultInstructions?: string;
}
export const MEDIA_ACTIONS = [
  "status",
  "voices",
  "import",
  "inspect",
  "prepare",
  "proxy",
  "thumbnail",
  "waveform",
  "silence",
  "scenes",
  "transcribe",
  "render",
  "audio-extract",
  "audio-enhance",
  "tts",
  "tts-clone",
  "tts-setup",
  "scene",
] as const;
export interface NativeMediaRequest {
  action: (typeof MEDIA_ACTIONS)[number];
  params?: Record<string, unknown>;
  inputs?: Record<string, string>;
  publicConnections?: unknown;
}
export interface NativeMediaContext {
  jobDir: string;
  runtimeDir: string;
  scopeKey: string;
  jobId: string;
  signal: AbortSignal;
  reportProgress(progress: MediaJobProgress): void | Promise<void>;
  /** Read only from a Host sealed file; never accepted in request JSON or returned publicly. */
  connections?: MediaConnection[];
  defaultModelId?: string;
  /** Panel-owned/test configuration; never raw guest arguments. */
  tools?: {
    ffmpegPath?: string;
    ffprobePath?: string;
    whisperPath?: string;
    whisperModelPath?: string;
    browserPath?: string;
    cliPath?: string;
    nodePath?: string;
    uvPath?: string;
  };
}
export interface NativeMediaArtifact {
  file: string;
  role: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  assetId: string;
}
export interface NativeMediaResponse {
  result: any;
  artifacts: NativeMediaArtifact[];
}
class MediaRequestError extends Error {}
const MIME_EXTENSIONS: Record<string, string> = {
  "video/mp4": ".mp4",
  "audio/wav": ".wav",
  "audio/mp4": ".m4a",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "application/x-subrip": ".srt",
  "application/json": ".json",
  "text/html": ".html",
};
const EXTENSION_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".aiff": "audio/aiff",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
function object(raw: unknown): Record<string, any> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new MediaRequestError("媒体请求必须是对象");
  return raw as Record<string, any>;
}
function safeRelative(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    !value ||
    value
      .split("/")
      .some(
        (part) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(part) || part === "." || part === "..",
      ) ||
    /[\\:\0]/.test(value)
  )
    throw new MediaRequestError("素材须使用任务目录内的文件名");
  return value;
}
async function regularWithin(root: string, value: string) {
  safeRelative(value);
  let path = root;
  for (const part of value.split("/")) {
    path = join(path, part);
    if ((await lstat(path)).isSymbolicLink())
      throw new MediaRequestError("媒体文件不能使用符号链接");
  }
  const canonical = await realpath(path),
    info = await stat(canonical);
  if (!canonical.startsWith(root + sep) || !info.isFile())
    throw new MediaRequestError("素材不在当前任务目录内");
  return canonical;
}
async function hashFile(path: string, signal: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    if (signal.aborted) throw mediaAbortError();
    hash.update(chunk);
  }
  return hash.digest("hex");
}
function publicMessage(error: unknown): string {
  if (error instanceof MediaRequestError) return error.message;
  const message = redactHomePath(error instanceof Error ? error.message : String(error));
  if (
    !message ||
    message.length > 350 ||
    /(?:\/Users\/|\/home\/|\/tmp\/|\/private\/|[A-Z]:\\|https?:\/\/|Traceback|exited with code|ENOENT|EACCES|ENOSPC)/.test(
      message,
    )
  )
    return "媒体处理未完成，请检查本地依赖、素材和可用空间后重试";
  return message;
}
export function validateMediaRequest(raw: unknown): NativeMediaRequest {
  const value = object(raw);
  if (
    Object.keys(value).some(
      (key) => !["action", "params", "inputs", "publicConnections"].includes(key),
    ) ||
    !MEDIA_ACTIONS.includes(value.action)
  )
    throw new MediaRequestError("不支持的媒体任务");
  const params = value.params === undefined ? {} : object(value.params);
  const inputs = value.inputs === undefined ? {} : object(value.inputs);
  if (Object.keys(inputs).length > 1000) throw new MediaRequestError("一次任务的素材过多");
  for (const [id, file] of Object.entries(inputs)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(id))
      throw new MediaRequestError("素材标识无效");
    safeRelative(file);
  }
  if (
    value.publicConnections !== undefined &&
    value.action !== "status" &&
    value.action !== "voices"
  )
    throw new MediaRequestError("生成任务不能使用公开连接配置替代授权连接");
  return {
    action: value.action,
    params,
    inputs,
    ...(value.publicConnections === undefined
      ? {}
      : { publicConnections: value.publicConnections }),
  };
}
function safeConnectionDescription(connection: MediaConnection) {
  const d = connection.description;
  return {
    id: d.id,
    name: d.name,
    provider: d.provider,
    available: d.available,
    ...(d.reason ? { reason: d.reason } : {}),
    voices: d.voices.map((v) => ({ id: v.id, name: v.name, language: v.language })),
    defaultVoiceId: d.defaultVoiceId,
    maxTextLength: d.maxTextLength,
    supportsInstructions: d.supportsInstructions,
    mode: "online",
  };
}
export function validateMediaConnections(raw: unknown): MediaConnection[] {
  if (!Array.isArray(raw) || raw.length > 100) throw new MediaRequestError("配音连接配置无效");
  const ids = new Set<string>();
  for (const value of raw) {
    const c = object(value),
      d = object(c.description);
    if (
      [c.connectionId, c.model, c.baseUrl, c.apiKey, d.id, d.name, d.provider].some(
        (v) => typeof v !== "string" || v.length > 8192,
      ) ||
      !d.id ||
      ids.has(d.id) ||
      !Array.isArray(d.voices) ||
      d.voices.length > 2000 ||
      d.voices.some(
        (v: any) =>
          !v || [v.id, v.name, v.language].some((s) => typeof s !== "string" || s.length > 256),
      ) ||
      !Number.isInteger(d.maxTextLength) ||
      d.maxTextLength < 1 ||
      d.maxTextLength > 4096 ||
      typeof d.supportsInstructions !== "boolean" ||
      typeof d.available !== "boolean" ||
      !Number.isFinite(c.defaultRate) ||
      c.defaultRate < 0.5 ||
      c.defaultRate > 2
    )
      throw new MediaRequestError("配音连接配置无效");
    ids.add(d.id);
  }
  return raw;
}

/** Resolve default tool names once so spawned tools also work when the app PATH lacks Homebrew. */
async function resolveMediaTools(
  tools: NativeMediaContext["tools"] = {},
): Promise<NonNullable<NativeMediaContext["tools"]>> {
  const resolved = { ...tools };
  for (const [key, name] of [
    ["ffmpegPath", "ffmpeg"],
    ["ffprobePath", "ffprobe"],
    ["whisperPath", "whisper"],
    ["uvPath", "uv"],
  ] as const) {
    if (resolved[key]) continue;
    const found = await findExecutable(name);
    if (found) resolved[key] = found;
  }
  return resolved;
}
export async function runMediaRequest(
  raw: NativeMediaRequest,
  options: NativeMediaContext,
): Promise<NativeMediaResponse> {
  const request = validateMediaRequest(raw),
    params = request.params ?? {};
  if (options.signal.aborted) throw mediaAbortError();
  if (
    !/^[a-f0-9]{64}$/.test(options.scopeKey) ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(options.jobId)
  )
    throw new MediaRequestError("媒体任务标识无效");
  const jobInfo = await lstat(options.jobDir);
  if (!jobInfo.isDirectory() || jobInfo.isSymbolicLink())
    throw new MediaRequestError("媒体任务目录无效");
  const root = await realpath(options.jobDir);
  await mkdir(options.runtimeDir, { recursive: true, mode: 0o700 });
  if ((await lstat(options.runtimeDir)).isSymbolicLink())
    throw new MediaRequestError("媒体运行目录无效");
  const runtime = await realpath(options.runtimeDir);
  options = { ...options, tools: await resolveMediaTools(options.tools) };
  const context: MediaJobContext = {
    scope: { appId: "video-studio", projectPath: options.scopeKey },
    jobId: options.jobId,
    attempt: 1,
    workDir: join(root, "work"),
    outputDir: join(root, "outputs"),
    cacheDir: join(runtime, "cache", options.scopeKey),
    signal: options.signal,
    reportProgress: async (progress) => {
      if (options.signal.aborted) throw mediaAbortError();
      await options.reportProgress({
        ...progress,
        ...(progress.message ? { message: publicMessage(new Error(progress.message)) } : {}),
      });
    },
  };
  for (const path of [context.workDir, context.outputDir, context.cacheDir]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    if ((await lstat(path)).isSymbolicLink()) throw new MediaRequestError("媒体工作目录无效");
  }
  const inputs = new Map<string, string>(),
    artifacts: NativeMediaArtifact[] = [];
  const assets = new Map<string, MediaAsset>();
  const caption = new MediaCaptionRenderer({ browserPath: options.tools?.browserPath });
  let succeeded = false;
  try {
    for (const [id, file] of Object.entries(request.inputs ?? {})) {
      const path = await regularWithin(root, file);
      if (/^asset-[a-f0-9]{64}$/.test(id) && id !== `asset-${await hashFile(path, context.signal)}`)
        throw new MediaRequestError("素材内容已变化，请重新导入");
      inputs.set(id, path);
    }
    const resolveAssetPath = async (_scope: unknown, id: string) => {
      const path = inputs.get(id);
      if (!path) throw new MediaRequestError("缺少本次任务授权的素材");
      return path;
    };
    const publish = async (
      path: string,
      mimeType: string,
      role = "artifact",
      name?: string,
    ): Promise<MediaAsset> => {
      if (context.signal.aborted) throw mediaAbortError();
      const canonical = await realpath(path);
      if (
        ![root, runtime].some((r) => canonical.startsWith(r + sep)) ||
        !(await stat(canonical)).isFile()
      )
        throw new MediaRequestError("媒体结果不在工具目录内");
      const sha256 = await hashFile(canonical, context.signal),
        bytes = (await stat(canonical)).size;
      if (bytes < 1 || bytes > 20 * 1024 ** 3) throw new MediaRequestError("媒体结果大小无效");
      const id = `asset-${sha256}`;
      if (assets.has(id)) return assets.get(id)!;
      const suffix =
        MIME_EXTENSIONS[mimeType] ??
        (/^\.[a-zA-Z0-9]{1,8}$/.test(extname(canonical)) ? extname(canonical) : ".bin");
      const target = join(context.outputDir, `${sha256}${suffix}`);
      if (target !== canonical) await copyFile(canonical, target);
      const asset: MediaAsset = {
        id,
        name: name ?? basename(canonical),
        mimeType,
        bytes,
        sha256,
        createdAt: Date.now(),
      };
      assets.set(id, asset);
      inputs.set(id, target);
      artifacts.push({
        file: relative(root, target).split(sep).join("/"),
        role,
        mimeType,
        bytes,
        sha256,
        assetId: id,
      });
      return asset;
    };
    const processorOptions: MediaProcessorOptions = {
      ...options.tools,
      resolveAssetPath,
      publishArtifact: (_scope, path, mimeType) => publish(path, mimeType),
      renderCaptionPng: (request, ctx) => caption.render(request, ctx),
    };
    const processors = createMediaJobProcessors(processorOptions);
    const managed = createManagedTtsProviders({
      runtimeDir: join(runtime, "tts"),
      ...options.tools,
    });
    // Retain the directory used by the previously shipped standalone voice tool.
    const voiceRuntime = resolve(runtime, "..");
    const cloneProviders = {
      "audio8-tts": createAudio8TtsProvider({ runtimeDir: voiceRuntime, ...options.tools }),
      "qwen3-tts": createQwenTtsProvider({ runtimeDir: voiceRuntime, ...options.tools }),
    };
    const queued = async <T>(id: string, work: () => Promise<T>): Promise<T> => {
      const release = await acquireVoiceQueue(
        join(voiceRuntime, ".queues", id),
        context.signal,
        () => context.reportProgress({ stage: "waiting", message: "等待上一段本地配音完成" }),
      );
      try {
        return await work();
      } finally {
        await release();
      }
    };
    const connections = validateMediaConnections(options.connections ?? []);
    const publicConfig =
      request.publicConnections === undefined
        ? { connections, defaultModelId: options.defaultModelId }
        : resolveMediaConnections(request.publicConnections, { publicOnly: true });
    const tool = async (command: string) =>
      runMediaProcess(command, ["-version"], {
        signal: context.signal,
        maxStdoutBytes: 65536,
      }).then(
        () => true,
        () => false,
      );
    const toolsAvailable = async () =>
      (
        await Promise.all([
          tool(options.tools?.ffmpegPath ?? "ffmpeg"),
          tool(options.tools?.ffprobePath ?? "ffprobe"),
        ])
      ).every(Boolean);
    const voices = async () => {
      const local = await detectLocalTts({ ...options.tools, signal: context.signal });
      const audioTools = await toolsAvailable();
      const models: any[] = [
        {
          id: "macos-say",
          name: "macOS 系统配音",
          provider: "macOS",
          available: local.available,
          reason: local.reason ? publicMessage(new Error(local.reason)) : undefined,
          voices: local.voices,
          defaultVoiceId: local.defaultVoiceId,
          maxTextLength: 6000,
          supportsInstructions: false,
          mode: "offline",
        },
      ];
      for (const id of ["edge-tts", "kokoro"] as const) {
        const found = await managed.status(id, context.signal);
        models.push({
          ...found,
          provider: id === "edge-tts" ? "Microsoft Edge 在线语音" : "Kokoro 本地模型",
          available: found.available && audioTools,
          reason: audioTools ? found.reason : "需要 FFmpeg 和 ffprobe 保存音频",
          installable: found.state !== "unavailable",
          maxTextLength: 6000,
          supportsInstructions: false,
        });
      }
      for (const [id, provider] of Object.entries(cloneProviders)) {
        const found = await provider.status(context.signal);
        models.push({
          ...found,
          provider: "video-studio",
          available: found.available && audioTools,
          reason: audioTools ? found.reason : "需要 FFmpeg 和 ffprobe 保存音频",
          installable: found.state !== "unavailable",
          maxTextLength: 2000,
          supportsInstructions: false,
          supportsVoiceCloning: true,
        });
      }
      models.push(
        ...publicConfig.connections.map(safeConnectionDescription).map((c) => ({
          ...c,
          available: c.available && audioTools,
          ...(!audioTools ? { reason: "在线配音需要 FFmpeg 和 ffprobe" } : {}),
        })),
      );
      const defaultModelId =
        [
          publicConfig.defaultModelId,
          ...publicConfig.connections.map((c) => c.description.id),
          "edge-tts",
          "kokoro",
          "macos-say",
        ].find((id) => models.some((m) => m.id === id && m.available)) ?? "macos-say";
      return {
        ...local,
        reason: local.reason ? publicMessage(new Error(local.reason)) : undefined,
        available: models.some((m) => m.available),
        models,
        defaultModelId,
      };
    };
    let result: any;
    if (request.action === "status") {
      const [ffmpeg, speech, hf, browser] = await Promise.all([
        toolsAvailable(),
        voices(),
        detectHyperframesRuntime(options.tools),
        options.tools?.browserPath ?? findCaptionBrowser(),
      ]);
      const whisperModel =
        options.tools?.whisperModelPath ?? join(homedir(), ".cache/whisper/base.pt");
      const whisperExecutable = await findExecutable("whisper", options.tools?.whisperPath);
      const whisperModelReady = await access(whisperModel).then(
        () => true,
        () => false,
      );
      let whisperReason: "executable-missing" | "model-missing" | "executable-failed" | undefined;
      if (!whisperExecutable) whisperReason = "executable-missing";
      else if (!whisperModelReady) whisperReason = "model-missing";
      else
        await runMediaProcess(whisperExecutable, ["--help"], {
          signal: context.signal,
          maxStdoutBytes: 65536,
        }).catch(() => {
          whisperReason = "executable-failed";
        });
      result = {
        apiVersion: 1,
        persistent: true,
        processors: [...MEDIA_ACTIONS],
        ffmpeg: { available: ffmpeg },
        transcription: {
          available: !whisperReason,
          engine: "local-whisper",
          model: basename(whisperModel, ".pt"),
          ...(whisperReason ? { reason: whisperReason } : {}),
        },
        hyperframes: {
          available: hf.available,
          version: hf.version,
          checks: hf.checks.map((c) => ({
            name: c.name,
            ok: c.ok,
            detail: c.name === "Chrome" && c.ok ? "已安装" : publicMessage(new Error(c.detail)),
          })),
        },
        captions: { available: Boolean(browser) },
        tts: {
          available: speech.available,
          engine: speech.engine,
          defaultModelId: speech.defaultModelId,
          defaultVoiceId: speech.defaultVoiceId,
          reason: speech.reason,
        },
      };
    } else if (request.action === "voices") result = await voices();
    else if (request.action === "tts-setup") {
      const id = params.providerId;
      if (!["edge-tts", "kokoro", "audio8-tts", "qwen3-tts"].includes(String(id)))
        throw new MediaRequestError("请选择支持安装的声音引擎");
      result = await queued<any>(id as string, () =>
        id === "audio8-tts" || id === "qwen3-tts"
          ? cloneProviders[id].setup(context)
          : managed.setup(id as any, context),
      );
    } else if (request.action === "tts" || request.action === "tts-clone") {
      const modelId = params.modelId ?? "macos-say";
      let rendered: any, input: any;
      if (request.action === "tts-clone" && modelId !== "audio8-tts" && modelId !== "qwen3-tts")
        throw new MediaRequestError("请选择支持本人声音的模型");
      if (modelId === "audio8-tts" || modelId === "qwen3-tts") {
        if (params.voiceId !== undefined && params.voiceId !== "reference")
          throw new MediaRequestError("本人声音须使用参考录音音色");
        if (params.instructions) throw new MediaRequestError("本人声音模型不支持额外风格指令");
        const referencePath = await resolveAssetPath(
          context.scope,
          String(params.referenceAssetId),
        );
        input = {
          text: params.text,
          referenceText: params.referenceText,
          referenceAssetId: params.referenceAssetId,
          rate: params.rate ?? 1,
          voiceId: "reference",
        };
        rendered = await queued<any>(modelId, () =>
          cloneProviders[modelId].generate(
            {
              text: input.text,
              referenceText: input.referenceText,
              referencePath,
              rate: input.rate,
            },
            context,
          ),
        );
      } else if (modelId === "macos-say") {
        input = validateLocalTtsInput({
          text: params.text,
          voiceId: params.voiceId,
          rate: params.rate,
        });
        rendered = await generateLocalTts(input, context, options.tools);
        input.voiceId = rendered.voice.id;
      } else if (modelId === "edge-tts" || modelId === "kokoro") {
        input = { text: params.text, voiceId: params.voiceId, rate: params.rate ?? 1 };
        rendered = await queued(modelId, () =>
          managed.generate({ ...input, providerId: modelId }, context),
        );
        input.voiceId = rendered.voice.id;
      } else {
        const selected = connections.find(
          (c) => c.description.id === modelId && c.description.available,
        );
        if (!selected) throw new MediaRequestError("此配音连接已更改或不可用，请重新选择");
        const text =
          typeof params.text === "string" ? params.text.replace(/\r\n?/g, "\n").trim() : "";
        if (
          !text ||
          Array.from(text).length > selected.description.maxTextLength ||
          /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
        )
          throw new MediaRequestError("配音文稿超出模型限制或包含无效字符");
        const voiceId = params.voiceId ?? selected.description.defaultVoiceId,
          instructions = params.instructions ?? selected.defaultInstructions;
        if (!selected.description.voices.some((voice) => voice.id === voiceId))
          throw new MediaRequestError("请选择此模型支持的声音");
        if (
          instructions !== undefined &&
          (typeof instructions !== "string" ||
            instructions.length > 2000 ||
            /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(instructions) ||
            (instructions.trim() && !selected.description.supportsInstructions))
        )
          throw new MediaRequestError("此模型不支持所填朗读风格指令");
        input = {
          text,
          voiceId,
          rate: params.rate ?? selected.defaultRate,
          ...(instructions ? { instructions } : {}),
        };
        rendered = await generateOpenAiTts({ ...input, model: selected.model }, context, {
          baseUrl: selected.baseUrl,
          apiKey: selected.apiKey,
          ...options.tools,
        });
      }
      const name = `配音-${Array.from(input.text)
        .slice(0, 24)
        .join("")
        .replace(/[\\/:*?"<>|\r\n]/g, " ")}.wav`;
      const asset = await publish(rendered.path, "audio/wav", "speech", name);
      result = {
        asset,
        inspection: await inspectMediaFile(rendered.path, context, processorOptions),
        speech: { ...input, modelId, engine: rendered.engine },
      };
    } else if (request.action === "audio-extract" || request.action === "audio-enhance") {
      const factory =
        request.action === "audio-extract"
          ? createAudioExtractProcessor
          : createAudioEnhanceProcessor;
      result = await factory({
        ...options.tools,
        resolveAssetPath,
        publishArtifact: (_scope, path, mimeType) =>
          publish(
            path,
            mimeType,
            request.action,
            request.action === "audio-extract" ? "本人声音参考片段.wav" : "优化后的原声.wav",
          ),
      }).run(params, context);
    } else if (request.action === "prepare") {
      const first = (await processors.inspect!.run(params, context)) as any;
      result = { assetId: first.assetId, inspection: first.inspection, preparedAt: Date.now() };
      const info = first.inspection;
      const kinds = [
        "thumbnail",
        ...(info.kind !== "image" ? ["proxy"] : []),
        ...(info.audio ? ["waveform", "silence"] : []),
        ...(info.kind === "video" ? ["scenes"] : []),
        ...(params.transcribe && info.audio ? ["transcribe"] : []),
      ];
      for (const [index, kind] of kinds.entries()) {
        const value = (await processors[kind]!.run(
          { assetId: params.assetId },
          {
            ...context,
            reportProgress: (p) =>
              context.reportProgress({
                ...p,
                stage: kind,
                fraction: (index + (p.fraction ?? 0)) / kinds.length,
              }),
          },
        )) as any;
        result[kind === "transcribe" ? "transcription" : kind] =
          kind === "proxy" || kind === "thumbnail" ? value[kind] : value;
      }
    } else if (request.action === "import") {
      const imported = [];
      for (const [id, path] of inputs) {
        const inspection = await inspectMediaFile(path, context, processorOptions);
        const name =
          typeof (params.names as any)?.[id] === "string"
            ? basename((params.names as any)[id])
            : basename(path);
        const asset = await publish(
          path,
          EXTENSION_MIME[extname(name).toLowerCase()] ??
            (inspection.kind === "image"
              ? "image/png"
              : inspection.kind === "audio"
                ? "audio/wav"
                : "video/mp4"),
          "source",
          name,
        );
        imported.push(asset);
      }
      result = { assets: imported };
    } else if (request.action === "scene") {
      const sceneParams = object(params.params ?? params) as HyperframesSceneParams;
      const adapter = createHyperframesAdapter({
        ...options.tools,
        workspaceRoot: join(context.workDir, "scenes"),
        cacheRoot: join(runtime, "scenes", options.scopeKey),
      });
      const hfContext = {
        signal: context.signal,
        onProgress: (p: { phase: string; message: string; progress?: number }) =>
          context.reportProgress({ stage: p.phase, message: p.message, fraction: p.progress }),
      };
      const scene = await adapter.createScene(sceneParams, hfContext),
        output = await adapter.render(scene, { ...hfContext, fps: 30 });
      const asset = await publish(
        output.artifactPath,
        "video/mp4",
        "scene",
        `${sceneParams.title}.mp4`,
      );
      const source = await publish(output.sourcePath, "text/html", "scene-source", "index.html"),
        config = await publish(
          output.paramsPath,
          "application/json",
          "scene-parameters",
          "scene.json",
        );
      result = {
        asset,
        scene: {
          params: sceneParams,
          contentHash: output.contentHash,
          cached: output.cached,
          rendererVersion: output.rendererVersion,
          source,
          config,
        },
        durationSeconds: output.durationSeconds,
        width: output.width,
        height: output.height,
      };
    } else result = await processors[request.action]!.run(params, context);
    const convert = async (value: any, role = "artifact"): Promise<any> => {
      if (!value || typeof value !== "object") return value;
      if (Array.isArray(value)) return Promise.all(value.map((v) => convert(v, role)));
      if (typeof value.path === "string" && typeof value.mimeType === "string") {
        const asset = await publish(value.path, value.mimeType, role);
        return {
          asset,
          file: artifacts.find((a) => a.assetId === asset.id)!.file,
          mimeType: value.mimeType,
          available: true,
        };
      }
      const output: Record<string, any> = {};
      for (const [key, child] of Object.entries(value)) {
        if (/^(?:path|artifactPath|sourcePath|projectDir|paramsPath|apiKey|baseUrl)$/.test(key))
          continue;
        output[key] =
          typeof child === "string" && ["reason", "message", "detail"].includes(key)
            ? publicMessage(new Error(child))
            : await convert(child, key);
      }
      return output;
    };
    const publicResult = await convert(result);
    if (context.signal.aborted) throw mediaAbortError();
    await context.reportProgress({ fraction: 1, stage: "complete" });
    if (context.signal.aborted) throw mediaAbortError();
    succeeded = true;
    return { result: publicResult, artifacts };
  } catch (error) {
    if (context.signal.aborted || (error instanceof Error && error.name === "AbortError"))
      throw mediaAbortError();
    throw new Error(publicMessage(error), { cause: error });
  } finally {
    await caption.close(context.jobId);
    await rm(context.workDir, { recursive: true, force: true }).catch(() => {});
    if (!succeeded) await rm(context.outputDir, { recursive: true, force: true }).catch(() => {});
  }
}
