import { combineAbortSignals } from "../signals.js";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { mediaAbortError, runMediaProcess } from "../process-runner.js";
import { validateLocalTtsInput, type LocalTtsVoice } from "../validation.js";
import type { ManagedTtsProviderStatus } from "../contracts.js";
import type { MediaJobContext, MediaScope } from "../contracts.js";
import {
  AUDIO8_RESOURCES as RESOURCES,
  AUDIO8_COMMIT as COMMIT,
  AUDIO8_REVISION as REVISION,
} from "./audio8-resources.js";
import { AUDIO8_SCRIPT as SCRIPT } from "./audio8-script.js";

export interface Audio8TtsOptions {
  /** Trusted Host configuration; never derive executable or runtime paths from panel input. */
  runtimeDir: string;
  uvPath?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
}
export interface Audio8TtsInput {
  text: string;
  /** The Host must resolve an authorized asset ID before calling this provider. */
  referencePath: string;
  referenceText: string;
  rate: number;
}
export interface Audio8TtsResult {
  path: string;
  mimeType: "audio/wav";
  engine: "audio8-tts";
  voice: LocalTtsVoice;
  rate: number;
  durationSeconds: number;
  sampleRate: 48000;
  channels: 1;
  cached: false;
}
export type Audio8TtsStatus = Omit<ManagedTtsProviderStatus, "id"> & { id: "audio8-tts" };

// Only CPU runtime dependencies: no web server, PyTorch, or implicit model hub client.
// tokenizers is intentionally installed without its unused hub dependency, as upstream does.
const PACKAGES = [
  "numpy==2.4.3",
  "onnxruntime==1.24.4",
  "soundfile==0.13.1",
  "scipy==1.17.1",
  "tokenizers==0.22.2",
  "flatbuffers==25.12.19",
  "packaging==26.3",
  "protobuf==7.36.1",
  "sympy==1.14.0",
  "mpmath==1.3.0",
  "cffi==2.1.1",
  "pycparser==3.0",
] as const;
const VOICE: LocalTtsVoice = { id: "reference", name: "我的声音 · 参考录音", language: "zh-CN" };
const MAX_SECONDS = 1800;
const MAX_BYTES = MAX_SECONDS * 48000 * 2 + 4096;
const FORMATS = "wav,aiff,mp3,flac,ogg,mov,matroska,webm,aac,amr";
const owners = new Set<string>();
const generationQueues = new Map<string, Promise<void>>();

/** Preserve punctuation and prefer word boundaries while respecting Python's Unicode limit. */
export function splitAudio8Text(text: string): string[] {
  const pieces: string[] = [];
  for (const sentence of text.split(/(?<=[。！？!?；;\n])/u)) {
    let characters = Array.from(sentence.trim());
    while (characters.length) {
      let boundary = Math.min(150, characters.length);
      if (characters.length > 150) {
        for (let index = boundary - 1; index >= 0; index--) {
          if (/[，,、：:\s]/u.test(characters[index])) {
            boundary = index + 1;
            break;
          }
        }
      }
      const piece = characters.slice(0, boundary).join("").trim();
      if (/[\p{L}\p{N}]/u.test(piece)) pieces.push(piece);
      characters = characters.slice(boundary);
    }
  }
  return pieces;
}

/** A path-free name; both the project binding and source content are part of its identity. */
export function audio8VoiceCacheKey(scope: MediaScope, audioSha256: string, referenceText: string) {
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const scopeKey = hash([scope.appId, resolve(scope.projectPath)]);
  return {
    scopeKey,
    voiceName: hash([
      "audio8-reference-v1",
      scopeKey,
      COMMIT,
      REVISION,
      audioSha256,
      referenceText,
    ]),
  };
}

/** Reserve synchronously, then wait asynchronously so queued jobs remain cancellable. */
async function acquireGeneration(dir: string, context: MediaJobContext, signal: AbortSignal) {
  const pending = generationQueues.get(dir);
  const previous = pending ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  generationQueues.set(dir, tail);
  void tail.then(() => {
    if (generationQueues.get(dir) === tail) generationQueues.delete(dir);
  });
  try {
    if (pending)
      await context.reportProgress({ stage: "waiting", message: "等待上一段本地配音完成" });
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener("abort", abort);
        reject(mediaAbortError());
      };
      signal.addEventListener("abort", abort, { once: true });
      void previous.then(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      });
      if (signal.aborted) abort();
    });
    if (signal.aborted) throw mediaAbortError();
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

/** This validates shape only. It does not grant access to referencePath. */
export function validateAudio8TtsInput(raw: unknown): Audio8TtsInput {
  const speech = validateLocalTtsInput(raw);
  const input = raw as Record<string, unknown>;
  if (Array.from(speech.text).length > 2000) throw new Error("声音克隆每次最多支持 2000 字");
  if (!/[\p{L}\p{N}]/u.test(speech.text)) throw new Error("配音文字至少需要一个可朗读的字词");
  const reference = validateLocalTtsInput({ text: input.referenceText });
  if (Array.from(reference.text).length > 1000 || !/[\p{L}\p{N}]/u.test(reference.text))
    throw new Error("请填写参考录音的逐字稿，最多 1000 字");
  if (
    typeof input.referencePath !== "string" ||
    !isAbsolute(input.referencePath) ||
    input.referencePath.includes("\0")
  )
    throw new Error("参考录音必须来自宿主已授权的本地素材");
  return {
    text: speech.text,
    referencePath: input.referencePath,
    referenceText: reference.text,
    rate: speech.rate,
  };
}

const SCRIPT_HASH = createHash("sha256").update(SCRIPT).digest("hex");

async function readJson(path: string) {
  if ((await stat(path)).size > 16 * 1024) throw new Error("Runtime metadata exceeds its budget");
  return JSON.parse(await readFile(path, "utf8"));
}
async function saveJson(path: string, value: unknown) {
  const partial = `${path}-${randomUUID()}.partial`;
  try {
    await writeFile(partial, JSON.stringify(value), { mode: 0o600 });
    await rename(partial, path);
  } finally {
    await rm(partial, { force: true });
  }
}
async function digest(path: string, signal: AbortSignal) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  return hash.digest("hex");
}

async function acquireSetupLock(path: string) {
  const candidate = `${path}-${randomUUID()}.candidate`;
  let published = false;
  try {
    // Publish an already complete PID file atomically; a crash cannot leave a new empty lock.
    await writeFile(candidate, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), {
      flag: "wx",
      mode: 0o600,
    });
    try {
      await link(candidate, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const before = await stat(path);
      const existing = await readJson(path).catch(() => null);
      if (Number.isSafeInteger(existing?.pid) && existing.pid > 0) {
        let alive = false;
        try {
          process.kill(existing.pid, 0);
          alive = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") alive = true;
        }
        if (alive) throw new Error("另一个宿主正在准备本地声音服务", { cause: error });
      } else if (Date.now() - before.mtimeMs < 120_000) {
        // Protect another host's older create-then-write implementation during its initial window.
        throw new Error("本地声音准备锁正在初始化，请稍候再试", { cause: error });
      }
      const current = await stat(path);
      if (
        current.ino !== before.ino ||
        current.mtimeMs !== before.mtimeMs ||
        current.size !== before.size
      )
        throw new Error("声音准备锁已更新，请稍候再试", { cause: error });
      await rm(path);
      await link(candidate, path);
    }
    published = true;
  } finally {
    await rm(candidate, { force: true }).catch(async (error) => {
      if (published) await rm(path, { force: true }).catch(() => {});
      throw error;
    });
  }
}

async function cleanupSetup(paths: string[], lockPath: string | undefined, signal: AbortSignal) {
  try {
    try {
      await Promise.all(paths.map((path) => rm(path, { force: true })));
    } finally {
      if (lockPath) await rm(lockPath, { force: true });
    }
  } catch (error) {
    if (signal.aborted) throw mediaAbortError();
    throw new Error("Audio8 临时文件清理未完成，请检查目录权限后重试", { cause: error });
  }
}

export function createAudio8TtsProvider(options: Audio8TtsOptions) {
  if (!isAbsolute(options.runtimeDir))
    throw new Error("TTS runtimeDir must be an absolute Host path");
  const root = resolve(options.runtimeDir);
  const dir = join(root, "audio8-tts");
  const python = join(dir, "venv", "bin", "python");
  const script = join(dir, "runner.py");
  const modelPath = join(dir, "model");
  const codePath = join(dir, "code");
  const manifestPath = join(dir, "runtime.json");
  const failurePath = join(dir, "failure.json");
  const env = (online = false): NodeJS.ProcessEnv => {
    const clean = { ...process.env };
    for (const key of Object.keys(clean))
      if (/^(UV_|PIP_|PYTHON|VIRTUAL_ENV|CONDA|HF_|HUGGING|TRANSFORMERS_|ARKTTS_|ORT_)/i.test(key))
        delete clean[key];
    return {
      ...clean,
      UV_NO_CONFIG: "1",
      UV_CACHE_DIR: join(root, "package-cache"),
      UV_PYTHON_INSTALL_DIR: join(root, "python"),
      PYTHONNOUSERSITE: "1",
      HF_HOME: join(dir, "hub-cache"),
      HF_HUB_DISABLE_IMPLICIT_TOKEN: "1",
      HF_HUB_DISABLE_TELEMETRY: "1",
      HF_HUB_OFFLINE: online ? "0" : "1",
      TRANSFORMERS_OFFLINE: online ? "0" : "1",
      DO_NOT_TRACK: "1",
    };
  };

  async function status(signal?: AbortSignal): Promise<Audio8TtsStatus> {
    if (signal?.aborted) throw mediaAbortError();
    const base: Audio8TtsStatus = {
      id: "audio8-tts",
      name: "Audio8-TTS · 本人声音克隆",
      mode: "offline",
      state: "not-installed",
      available: false,
      installed: false,
      voices: [{ ...VOICE }],
      defaultVoiceId: VOICE.id,
      downloadBytes: 1250 * 1048576,
      requiredDiskBytes: 4 * 1024 ** 3,
    };
    if (process.platform !== "darwin" || process.arch !== "arm64")
      return {
        ...base,
        state: "unavailable",
        reason: "本地声音克隆需要 Apple Silicon Mac（M 系列芯片）",
      };
    if (totalmem() < 4 * 1024 ** 3)
      return { ...base, state: "unavailable", reason: "本地声音克隆至少需要 4 GB 内存" };
    base.installed = await stat(python).then(
      (s) => s.isFile(),
      () => false,
    );
    if (owners.has(dir))
      return { ...base, state: "installing", reason: "正在准备并验证本地声音克隆" };
    try {
      const manifest = await readJson(manifestPath);
      if (
        !base.installed ||
        manifest.scriptHash !== SCRIPT_HASH ||
        manifest.revision !== REVISION ||
        manifest.commit !== COMMIT ||
        JSON.stringify(manifest.packages) !== JSON.stringify(PACKAGES) ||
        (await readFile(script, "utf8")) !== SCRIPT
      )
        throw new Error("Incomplete runtime");
      for (const item of RESOURCES)
        if ((await stat(join(dir, item.kind, item.path))).size !== item.bytes)
          throw new Error("Incomplete model");
      if (manifest.state !== "ready") throw new Error("Runtime not validated");
      return {
        ...base,
        state: "ready",
        available: true,
        verifiedAt: manifest.verifiedAt,
        version: PACKAGES.join("; "),
      };
    } catch {
      const failure = await readJson(failurePath).catch(() => null);
      const reason = typeof failure?.reason === "string" ? failure.reason : undefined;
      return {
        ...base,
        state: reason ? "failed" : base.installed ? "needs-setup" : "not-installed",
        reason: reason ?? "首次需下载约 1.2 GB；准备完成后，参考录音与配音均在本机处理",
      };
    }
  }

  async function execute(
    data: Record<string, unknown>,
    context: MediaJobContext,
    signal: AbortSignal,
  ) {
    await mkdir(context.workDir, { recursive: true });
    const request = join(context.workDir, `audio8-request-${randomUUID()}.json`);
    await writeFile(
      request,
      JSON.stringify({ ...data, modelPath, codePath, threads: Math.min(5, cpus().length) }),
      { mode: 0o600 },
    );
    let pending = "";
    const decoder = new StringDecoder("utf8");
    let result: any;
    let failure: string | undefined;
    let progress = Promise.resolve();
    try {
      await runMediaProcess(python, ["-I", script, request], {
        signal,
        env: env(),
        onStdout(chunk) {
          pending += decoder.write(chunk);
          if (Buffer.byteLength(pending) > 256 * 1024)
            throw new Error("Audio8 runtime response exceeds budget");
          const lines = pending.split("\n");
          pending = lines.pop() ?? "";
          for (const line of lines) {
            let value;
            try {
              value = JSON.parse(line);
            } catch {
              continue;
            }
            if (value.result) result = value.result;
            if (value.failure === "token-budget" || value.failure === "empty-segment")
              failure = value.failure;
            if (typeof value.progress?.fraction === "number") {
              progress = progress.then(() =>
                context.reportProgress({
                  fraction: value.progress.fraction,
                  stage: value.progress.stage === "register" ? "register" : "speech",
                  message:
                    value.progress.stage === "register"
                      ? "正在保存参考音色，后续配音会自动复用"
                      : "正在本机生成你的声音",
                }),
              );
              void progress.catch(() => {});
            }
          }
        },
      });
      await progress;
      if (!result) throw new Error("Audio8 runtime did not return a complete result");
      return result;
    } catch (error) {
      if (failure && !signal.aborted)
        throw new Error(
          failure === "token-budget"
            ? "部分配音未完整结束，请缩短参考逐字稿或文稿后重试"
            : "有一段文字未生成有效人声，请调整这段文稿后重试",
          { cause: error },
        );
      throw error;
    } finally {
      await progress.catch(() => {});
      await rm(request, { force: true });
    }
  }

  async function downloadResource(
    resource: (typeof RESOURCES)[number],
    signal: AbortSignal,
    report: (bytes: number) => Promise<void>,
  ) {
    const path = join(dir, resource.kind, resource.path);
    const valid = await stat(path).then(
      async (s) => s.size === resource.bytes && (await digest(path, signal)) === resource.sha256,
      () => false,
    );
    if (valid) {
      await report(resource.bytes);
      return;
    }
    await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
    const partial = `${path}-${randomUUID()}.partial`;
    const handle = await open(partial, "wx", 0o600);
    try {
      // URLs come solely from the reviewed manifest; no user-supplied repository or script URL.
      const response = await fetch(resource.url, { signal });
      if (!response.ok || !response.body || !response.url.startsWith("https://"))
        throw new Error("Audio8 resource download failed");
      const hash = createHash("sha256");
      let bytes = 0;
      let reportedAt = 0;
      const reader = response.body.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > resource.bytes) throw new Error("Audio8 download exceeds expected size");
          hash.update(chunk.value);
          let offset = 0;
          while (offset < chunk.value.byteLength) {
            const written = await handle.write(chunk.value.subarray(offset));
            if (!written.bytesWritten) throw new Error("Audio8 download could not be saved");
            offset += written.bytesWritten;
          }
          if (Date.now() - reportedAt >= 1000) {
            await report(bytes);
            reportedAt = Date.now();
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      if (bytes !== resource.bytes || hash.digest("hex") !== resource.sha256)
        throw new Error("Audio8 resource integrity check failed");
      if (signal.aborted) throw mediaAbortError();
      await handle.close();
      await rename(partial, path);
      await report(bytes);
    } finally {
      await handle.close().catch(() => {});
      await rm(partial, { force: true });
    }
  }

  async function verifyResources(signal: AbortSignal, hashes: boolean) {
    for (const resource of RESOURCES) {
      const path = join(dir, resource.kind, resource.path);
      if (
        (await stat(path)).size !== resource.bytes ||
        (hashes && "sha256" in resource && (await digest(path, signal)) !== resource.sha256)
      )
        throw new Error("本地模型校验失败，请重新准备声音克隆");
    }
  }
  async function probe(path: string, signal: AbortSignal, formats = FORMATS) {
    const raw = await runMediaProcess(
      options.ffprobePath ?? "ffprobe",
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        formats,
        "-select_streams",
        "a:0",
        "-show_entries",
        "format=duration:stream=codec_name,sample_rate,channels,duration",
        "-of",
        "json",
        path,
      ],
      { signal },
    );
    const data = JSON.parse(raw.stdout.toString("utf8"));
    const audio = data.streams?.[0];
    const durationSeconds = Number(audio?.duration ?? data.format?.duration);
    if (!audio || !Number.isFinite(durationSeconds) || durationSeconds <= 0)
      throw new Error("无法读取录音时长，请选择有效的音频或视频素材");
    return { audio, durationSeconds };
  }
  async function audible(path: string, signal: AbortSignal) {
    const raw = await runMediaProcess(
      options.ffmpegPath ?? "ffmpeg",
      [
        "-nostdin",
        "-v",
        "info",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "wav",
        "-i",
        path,
        "-af",
        "volumedetect",
        "-f",
        "null",
        "-",
      ],
      { signal },
    );
    const match = /max_volume: ([-\d.]+) dB/.exec(raw.stderr);
    if (!match || Number(match[1]) < -70) throw new Error("录音中没有可听见的声音");
  }
  async function render(input: Audio8TtsInput, context: MediaJobContext, signal: AbortSignal) {
    await mkdir(context.workDir, { recursive: true });
    await mkdir(context.outputDir, { recursive: true });
    const nonce = randomUUID();
    const reference = join(context.workDir, `audio8-reference-${nonce}.wav`);
    const raw = join(context.workDir, `audio8-raw-${nonce}.wav`);
    const partial = join(context.outputDir, `speech-${nonce}.partial.wav`);
    const output = join(context.outputDir, `speech-${nonce}.wav`);
    let complete = false;
    let voicesPath: string | undefined;
    let voiceName: string | undefined;
    try {
      const source = await stat(input.referencePath);
      if (!source.isFile() || source.size > 512 * 1024 ** 2)
        throw new Error("参考录音须为 512 MB 以内的本地素材");
      const meta = await probe(input.referencePath, signal);
      if (meta.durationSeconds < 3 || meta.durationSeconds > 30)
        throw new Error("参考录音需要 3 至 30 秒，请先裁剪为一段清晰的人声");
      await runMediaProcess(
        options.ffmpegPath ?? "ffmpeg",
        [
          "-nostdin",
          "-v",
          "error",
          "-y",
          "-protocol_whitelist",
          "file,pipe",
          "-format_whitelist",
          FORMATS,
          "-i",
          input.referencePath,
          "-map",
          "0:a:0",
          "-vn",
          "-sn",
          "-dn",
          "-t",
          "30.01",
          "-ac",
          "1",
          "-ar",
          "44100",
          "-c:a",
          "pcm_s16le",
          reference,
        ],
        { signal },
      );
      await audible(reference, signal);
      const cache = audio8VoiceCacheKey(
        context.scope,
        await digest(reference, signal),
        input.referenceText,
      );
      voicesPath = join(dir, "voices", cache.scopeKey);
      voiceName = cache.voiceName;
      await mkdir(voicesPath, { recursive: true, mode: 0o700 });
      await context.reportProgress({
        fraction: 0.15,
        stage: "speech",
        message: "正在加载本地模型；首次生成可能需要几分钟",
      });
      await execute(
        {
          action: "generate",
          pieces: splitAudio8Text(input.text),
          referencePath: reference,
          referenceText: input.referenceText,
          voicesPath,
          voiceName,
          output: raw,
        },
        context,
        signal,
      );
      await context.reportProgress({
        fraction: 0.86,
        stage: "speech",
        message: "正在统一配音格式并检查声音",
      });
      await runMediaProcess(
        options.ffmpegPath ?? "ffmpeg",
        [
          "-nostdin",
          "-v",
          "error",
          "-y",
          "-protocol_whitelist",
          "file,pipe",
          "-format_whitelist",
          "wav",
          "-i",
          raw,
          "-map",
          "0:a:0",
          "-vn",
          "-af",
          `atempo=${input.rate}`,
          "-ac",
          "1",
          "-ar",
          "48000",
          "-c:a",
          "pcm_s16le",
          "-fs",
          String(MAX_BYTES),
          partial,
        ],
        { signal },
      );
      const result = await probe(partial, signal, "wav");
      if (
        result.audio.codec_name !== "pcm_s16le" ||
        Number(result.audio.sample_rate) !== 48000 ||
        result.audio.channels !== 1 ||
        result.durationSeconds > MAX_SECONDS ||
        (await stat(partial)).size >= MAX_BYTES
      )
        throw new Error("未生成合格的 48 kHz WAV 配音");
      await audible(partial, signal);
      if (signal.aborted) throw mediaAbortError();
      await rename(partial, output);
      await context.reportProgress({
        fraction: 1,
        stage: "ready",
        message: "已完成本地声音克隆配音",
      });
      if (signal.aborted) throw mediaAbortError();
      complete = true;
      return { path: output, durationSeconds: result.durationSeconds };
    } finally {
      const cleanup = [reference, raw, partial, ...(!complete ? [output] : [])].map((path) => ({
        path,
        recursive: false,
      }));
      if (voicesPath && voiceName) {
        // SIGTERM can interrupt upstream between mkdtemp and atomic profile rename.
        const incomplete = await readdir(voicesPath).catch(() => []);
        cleanup.push(
          ...incomplete
            .filter((name) => name.startsWith(`.${voiceName}.`))
            .map((name) => ({ path: join(voicesPath!, name), recursive: true })),
        );
      }
      await Promise.all(cleanup.map(({ path, recursive }) => rm(path, { recursive, force: true })));
    }
  }

  async function setup(context: MediaJobContext): Promise<Audio8TtsStatus> {
    if (context.signal.aborted) throw mediaAbortError();
    const initial = await status();
    if (initial.state === "unavailable") throw new Error(initial.reason);
    if (owners.has(dir) || generationQueues.has(dir))
      throw new Error("本地声音服务正在运行，请等待或取消当前任务");
    owners.add(dir);
    const deadline = AbortSignal.timeout(40 * 60_000);
    const signal = combineAbortSignals([context.signal, deadline]);
    const lockPath = join(dir, "setup.lock");
    let lock = false;
    const cleanup: string[] = [];
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await acquireSetupLock(lockPath);
      lock = true;
      const disk = await statfs(dir);
      if (disk.bavail * disk.bsize < initial.requiredDiskBytes)
        throw new Error("空间不足，准备声音克隆至少需要 4 GB 可用空间");
      await Promise.all([
        runMediaProcess(options.ffmpegPath ?? "ffmpeg", ["-version"], { signal }),
        runMediaProcess(options.ffprobePath ?? "ffprobe", ["-version"], { signal }),
      ]);
      await writeFile(script, SCRIPT, { mode: 0o600 });
      await context.reportProgress({
        fraction: 0.02,
        stage: "setup",
        message: "准备独立 Python 环境与本地声音克隆，预计下载约 1.2 GB",
      });
      let installed = false;
      try {
        const probe = await execute(
          { action: "probe", packageNames: PACKAGES.map((p) => p.split("==")[0]) },
          context,
          signal,
        );
        installed = JSON.stringify(probe.packages) === JSON.stringify(PACKAGES);
      } catch (error) {
        if (signal.aborted) throw error;
      }
      if (!installed) {
        await runMediaProcess(
          options.uvPath ?? "uv",
          ["venv", "--clear", "--no-config", "--python", "3.12", join(dir, "venv")],
          { signal, env: env(true) },
        );
        await context.reportProgress({
          fraction: 0.08,
          stage: "install",
          message: "正在安装固定版本的本地推理依赖",
        });
        await runMediaProcess(
          options.uvPath ?? "uv",
          [
            "pip",
            "install",
            "--no-config",
            "--python",
            python,
            "--index-url",
            "https://pypi.org/simple",
            "--no-deps",
            "--only-binary",
            ":all:",
            ...PACKAGES,
          ],
          { signal, env: env(true) },
        );
        const probe = await execute(
          { action: "probe", packageNames: PACKAGES.map((p) => p.split("==")[0]) },
          context,
          signal,
        );
        if (JSON.stringify(probe.packages) !== JSON.stringify(PACKAGES))
          throw new Error("声音依赖版本验证失败");
      }
      let resourcesValid = false;
      try {
        await verifyResources(signal, true);
        resourcesValid = true;
      } catch (error) {
        if (signal.aborted) throw error;
      }
      if (!resourcesValid) {
        // Remove invalid complete files so the download client's cache cannot preserve corruption.
        for (const item of RESOURCES) {
          const path = join(dir, item.kind, item.path);
          const valid = await stat(path).then(
            async (s) =>
              s.size === item.bytes &&
              (!("sha256" in item) || (await digest(path, signal)) === item.sha256),
            () => false,
          );
          if (!valid) await rm(path, { force: true });
        }
        await context.reportProgress({
          fraction: 0.2,
          stage: "download",
          message: "正在下载固定版本的 Audio8 模型与声音编码器（约 1 GB）",
        });
        const total = RESOURCES.reduce((sum, item) => sum + item.bytes, 0);
        let completed = 0;
        for (const item of RESOURCES) {
          await downloadResource(item, signal, async (bytes) => {
            const downloaded = completed + bytes;
            await context.reportProgress({
              fraction: 0.2 + (0.45 * downloaded) / total,
              stage: "download",
              message: `正在下载 Audio8（${Math.floor(downloaded / 1048576)} / ${Math.ceil(total / 1048576)} MB）`,
            });
          });
          completed += item.bytes;
        }
        await verifyResources(signal, true);
      }
      await context.reportProgress({
        fraction: 0.7,
        stage: "verify",
        message: "正在用系统测试音验证真实离线推理",
      });
      await mkdir(context.workDir, { recursive: true });
      const reference = join(context.workDir, `audio8-setup-${randomUUID()}.aiff`);
      const transcript = join(context.workDir, `audio8-setup-${randomUUID()}.txt`);
      cleanup.push(reference, transcript);
      const referenceText =
        "This is a local voice test. Clear speech helps prepare the audio model.";
      await writeFile(transcript, referenceText, { mode: 0o600 });
      await runMediaProcess("/usr/bin/say", ["-r", "165", "-f", transcript, "-o", reference], {
        signal,
      });
      const sample = await render(
        { text: "你好，这是本地声音克隆测试。", referencePath: reference, referenceText, rate: 1 },
        { ...context, scope: { appId: "__audio8-setup", projectPath: dir } },
        signal,
      );
      cleanup.push(sample.path);
      if (signal.aborted) throw mediaAbortError();
      await saveJson(manifestPath, {
        scriptHash: SCRIPT_HASH,
        revision: REVISION,
        commit: COMMIT,
        packages: PACKAGES,
        state: "ready",
        verifiedAt: Date.now(),
      });
      await rm(failurePath, { force: true });
      await context.reportProgress({
        fraction: 1,
        stage: "ready",
        message: "本地声音克隆已通过真实离线推理验证",
      });
      if (signal.aborted) throw mediaAbortError();
    } catch (error) {
      if (!lock) {
        if (context.signal.aborted) throw mediaAbortError();
        const message = error instanceof Error ? error.message : "";
        const safe = [
          "本地声音准备锁正在初始化，请稍候再试",
          "另一个宿主正在准备本地声音服务",
          "声音准备锁已更新，请稍候再试",
        ];
        throw new Error(
          safe.includes(message) ? message : "Audio8 无法创建独立环境，请检查磁盘空间和目录权限",
          { cause: error },
        );
      }
      const reason = signal.aborted
        ? context.signal.aborted
          ? "声音克隆准备已取消，可以重新准备"
          : "声音克隆准备超时，请检查网络后重试"
        : "Audio8 声音克隆准备失败；需要 uv、FFmpeg、完整模型与可用空间，请检查网络和本机环境后重试";
      await saveJson(failurePath, { reason, at: Date.now() }).catch(() => {});
      await rm(manifestPath, { force: true }).catch(() => {});
      throw context.signal.aborted ? mediaAbortError() : new Error(reason, { cause: error });
    } finally {
      try {
        await cleanupSetup(cleanup, lock ? lockPath : undefined, context.signal);
      } finally {
        owners.delete(dir);
      }
    }
    return status();
  }

  async function generate(raw: Audio8TtsInput, context: MediaJobContext): Promise<Audio8TtsResult> {
    const input = validateAudio8TtsInput(raw);
    if (context.signal.aborted) throw mediaAbortError();
    const runtime = await status(context.signal);
    if (!runtime.available) throw new Error(runtime.reason ?? "请先准备本地声音克隆");
    if (owners.has(dir)) throw new Error("本地声音服务正在运行，请等待或取消当前任务");
    const deadline = AbortSignal.timeout(20 * 60_000);
    const signal = combineAbortSignals([context.signal, deadline]);
    let release: (() => void) | undefined;
    try {
      release = await acquireGeneration(dir, context, signal);
      try {
        await verifyResources(signal, true);
      } catch (error) {
        if (signal.aborted) throw error;
        const reason = "本地模型校验失败，请重新准备声音克隆";
        await saveJson(failurePath, { reason, at: Date.now() });
        await rm(manifestPath, { force: true });
        throw new Error(reason, { cause: error });
      }
      const result = await render(input, context, signal);
      return {
        ...result,
        mimeType: "audio/wav",
        engine: "audio8-tts",
        voice: { ...VOICE },
        rate: input.rate,
        sampleRate: 48000,
        channels: 1,
        cached: false,
      };
    } catch (error) {
      if (context.signal.aborted) throw mediaAbortError();
      if (deadline.aborted) throw new Error("本地声音生成超时，请缩短文稿后重试", { cause: error });
      const message = error instanceof Error ? error.message : "";
      const safeMessages = [
        "本地模型校验失败，请重新准备声音克隆",
        "参考录音须为 512 MB 以内的本地素材",
        "无法读取录音时长，请选择有效的音频或视频素材",
        "参考录音需要 3 至 30 秒，请先裁剪为一段清晰的人声",
        "录音中没有可听见的声音",
        "未生成合格的 48 kHz WAV 配音",
        "部分配音未完整结束，请缩短参考逐字稿或文稿后重试",
        "有一段文字未生成有效人声，请调整这段文稿后重试",
      ];
      // A job error crosses the panel bridge. Keep Python paths and tracebacks in Host-only cause.
      throw new Error(
        safeMessages.includes(message)
          ? message
          : "本地声音生成失败，请检查参考素材与逐字稿，或缩短文稿后重试",
        { cause: error },
      );
    } finally {
      release?.();
    }
  }
  return { status, setup, generate };
}
