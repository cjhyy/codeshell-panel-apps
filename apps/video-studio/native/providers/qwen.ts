import { combineAbortSignals } from "../signals.js";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { totalmem } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { mediaAbortError, runMediaProcess } from "../process-runner.js";
import { validateLocalTtsInput, type LocalTtsVoice } from "../validation.js";
import type { ManagedTtsProviderStatus } from "../contracts.js";
import type { MediaJobContext } from "../contracts.js";
import { AUDIO_PROBE_MESSAGES, probeVoiceAudio } from "./audio-probe.js";

export interface QwenTtsOptions {
  /** Trusted Host configuration; never derive executable or runtime paths from panel input. */
  runtimeDir: string;
  uvPath?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
}
export interface QwenTtsInput {
  text: string;
  /** The Host must resolve an authorized asset ID before calling this provider. */
  referencePath: string;
  referenceText: string;
  rate: number;
}
export interface QwenTtsResult {
  path: string;
  mimeType: "audio/wav";
  engine: "qwen3-tts";
  voice: LocalTtsVoice;
  rate: number;
  durationSeconds: number;
  sampleRate: 48000;
  channels: 1;
  cached: false;
}
export type QwenTtsStatus = Omit<ManagedTtsProviderStatus, "id"> & { id: "qwen3-tts" };

const MODEL = "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit";
const REVISION = "50f45ef0047cde7e84c2ef04326acb8ada2436a7";
// Release API and a complete, local model were verified together on Apple Silicon.
const PACKAGES = [
  "mlx-audio==0.5.3",
  "mlx==0.32.2",
  "transformers==5.17.0",
  "huggingface-hub==1.31.0",
  "soundfile==0.14.0",
] as const;
const VOICE: LocalTtsVoice = { id: "reference", name: "我的声音 · 参考录音", language: "zh-CN" };
const MAX_SECONDS = 1800;
const MAX_BYTES = MAX_SECONDS * 48000 * 2 + 4096;
const FORMATS = "wav,aiff,mp3,flac,ogg,mov,matroska,webm,aac,amr";
const owners = new Set<string>();
const generationQueues = new Map<string, Promise<void>>();

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

// Both weight files are fixed by the publisher's LFS SHA-256, not just a model name.
const RESOURCES = [
  {
    path: "config.json",
    bytes: 5522,
    sha256: "b404fb6f99dac6f7a81f3a03af5675b131ecf9936ac75a7c9d75e54044600044",
  },
  {
    path: "generation_config.json",
    bytes: 245,
    sha256: "f1b90b4513f3b34c62851049e2492d7b4c5940daf1276f89c82b8ef04127f3aa",
  },
  {
    path: "merges.txt",
    bytes: 1671839,
    sha256: "599bab54075088774b1733fde865d5bd747cbcc7a547c5bc12610e874e26f5e3",
  },
  {
    path: "model.safetensors",
    bytes: 1304461214,
    sha256: "9488e7005cc0cf44f8804eb543668d0763bb1c649ce6f1eddc663519524b3182",
  },
  {
    path: "model.safetensors.index.json",
    bytes: 77731,
    sha256: "7829f1cc24f5cbd7d7a3ba888bb08c7cf52d82ba79a4f0f3756d41f8bf5e52b4",
  },
  {
    path: "preprocessor_config.json",
    bytes: 127,
    sha256: "efdde1022ea9d76928bf7a9cd53139138f5ba2e466e837f08f6105ab1af1c119",
  },
  {
    path: "speech_tokenizer/config.json",
    bytes: 2336,
    sha256: "ee65bb901c876664ab8707c487157aa1a6ee57c65969b28fb5ec9dc211e68167",
  },
  {
    path: "speech_tokenizer/configuration.json",
    bytes: 76,
    sha256: "6bc26d64eb5024b4d1dab5a52371958b429256d6c9d59787f1f5294a54e0cebd",
  },
  {
    path: "speech_tokenizer/model.safetensors",
    bytes: 682293092,
    sha256: "836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258",
  },
  {
    path: "speech_tokenizer/preprocessor_config.json",
    bytes: 234,
    sha256: "fcb3805e597e786d4067706e602f6688524640f8d3396790e2e09b5942fcbdfb",
  },
  {
    path: "tokenizer_config.json",
    bytes: 7344,
    sha256: "dc3c31c3bdaedd5016382bb3cbe07323026775ad51f5a4fb564505992ae4a670",
  },
  {
    path: "vocab.json",
    bytes: 2776833,
    sha256: "ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910",
  },
] as const;

/** This validates shape only. It does not grant access to referencePath. */
export function validateQwenTtsInput(raw: unknown): QwenTtsInput {
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

// User text and paths travel only through a private JSON file, never Python source or shell text.
const SCRIPT = String.raw`
import json, os, sys, socket, re
from pathlib import Path
from importlib.metadata import version

request = json.loads(Path(sys.argv[1]).read_text())
action = request["action"]
def emit(value):
    print(json.dumps(value), flush=True)

if action != "download":
    # Fail closed even if a future library attempts an implicit download.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    def offline(*args, **kwargs):
        raise RuntimeError("Network access is disabled for local voice generation")
    socket.socket.connect = offline
    socket.socket.connect_ex = offline
    socket.create_connection = offline

if action == "probe":
    from mlx_audio.tts.utils import load_model
    from mlx_audio.tts.models.qwen3_tts import Model
    import soundfile
    import inspect
    assert all(x in inspect.signature(Model.generate).parameters for x in ["ref_audio", "ref_text", "text"])
    emit({"result": {"packages": [f"{name}=={version(name)}" for name in request["packageNames"]]}})
elif action == "download":
    from huggingface_hub import snapshot_download
    snapshot_download(repo_id=request["modelId"], revision=request["revision"],
        local_dir=request["modelPath"], allow_patterns=request["files"],
        token=False, max_workers=2)
    emit({"result": {"downloaded": True}})
elif action == "generate":
    import mlx.core as mx
    import numpy as np
    import soundfile as sf
    from mlx_audio.tts.utils import load_model
    model_path = Path(request["modelPath"])
    assert model_path.is_absolute() and model_path.is_dir()
    model = load_model(str(model_path))
    assert model.tokenizer is not None and model.speech_tokenizer is not None
    assert model.speech_tokenizer.has_encoder and model.config.tts_model_type == "base"
    mx.random.seed(0)
    # Bound each decode so long scripts do not allocate a full-length waveform on the GPU.
    pieces = []
    for sentence in re.split(r"(?<=[。！？!?；;\n])", request["text"]):
        sentence = sentence.strip()
        while sentence:
            boundary = min(160, len(sentence))
            if len(sentence) > 160:
                breaks = list(re.finditer(r"[，,、：:\s]", sentence[:160]))
                if breaks:
                    boundary = breaks[-1].end()
            piece = sentence[:boundary].strip()
            if any(character.isalnum() for character in piece):
                pieces.append(piece)
            sentence = sentence[boundary:].strip()
    samples = 0
    with sf.SoundFile(request["output"], mode="w", samplerate=model.sample_rate,
                      channels=1, subtype="PCM_16", format="WAV") as output:
        for index, text in enumerate(pieces):
            before = samples
            for result in model.generate(text=text, ref_audio=request["referencePath"],
                ref_text=request["referenceText"], lang_code="auto", stream=False,
                temperature=0.7, max_tokens=2048, verbose=False):
                if result.token_count >= 2048:
                    raise RuntimeError("Speech reached its token budget; shorten the script and retry")
                audio = np.asarray(result.audio, dtype=np.float32).reshape(-1)
                if not audio.size or not np.isfinite(audio).all():
                    raise RuntimeError("Model returned invalid audio")
                samples += audio.size
                if samples > model.sample_rate * 1800:
                    raise RuntimeError("Generated speech exceeds its duration budget")
                output.write(audio)
            if samples == before:
                raise RuntimeError("Model did not generate speech for a script segment; retry this sentence")
            if index + 1 < len(pieces):
                pause = np.zeros(round(model.sample_rate * 0.12), dtype=np.float32)
                output.write(pause)
                samples += pause.size
            emit({"progress": {"fraction": 0.2 + 0.6 * (index + 1) / len(pieces)}})
    emit({"result": {"sampleRate": model.sample_rate, "samples": samples}})
else:
    raise ValueError("Unsupported managed action")
`;
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

export function createQwenTtsProvider(options: QwenTtsOptions) {
  if (!isAbsolute(options.runtimeDir))
    throw new Error("TTS runtimeDir must be an absolute Host path");
  const root = resolve(options.runtimeDir);
  const dir = join(root, "qwen3-tts");
  const python = join(dir, "venv", "bin", "python");
  const script = join(dir, "runner.py");
  const modelPath = join(dir, "model");
  const manifestPath = join(dir, "runtime.json");
  const failurePath = join(dir, "failure.json");
  const env = (online = false): NodeJS.ProcessEnv => {
    const clean = { ...process.env };
    for (const key of Object.keys(clean))
      if (/^(UV_|PIP_|PYTHON|VIRTUAL_ENV|CONDA|HF_|HUGGING|TRANSFORMERS_|MLX_)/i.test(key))
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

  async function status(signal?: AbortSignal): Promise<QwenTtsStatus> {
    if (signal?.aborted) throw mediaAbortError();
    const base: QwenTtsStatus = {
      id: "qwen3-tts",
      name: "Qwen3-TTS · 本人声音克隆",
      mode: "offline",
      state: "not-installed",
      available: false,
      installed: false,
      voices: [{ ...VOICE }],
      defaultVoiceId: VOICE.id,
      downloadBytes: 2400 * 1048576,
      requiredDiskBytes: 6 * 1024 ** 3,
    };
    if (process.platform !== "darwin" || process.arch !== "arm64")
      return {
        ...base,
        state: "unavailable",
        reason: "本地声音克隆需要 Apple Silicon Mac（M 系列芯片）",
      };
    if (totalmem() < 8 * 1024 ** 3)
      return { ...base, state: "unavailable", reason: "本地声音克隆至少需要 8 GB 内存" };
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
        JSON.stringify(manifest.packages) !== JSON.stringify(PACKAGES) ||
        (await readFile(script, "utf8")) !== SCRIPT
      )
        throw new Error("Incomplete runtime");
      for (const item of RESOURCES)
        if ((await stat(join(modelPath, item.path))).size !== item.bytes)
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
        reason: reason ?? "首次需下载约 2.4 GB；准备完成后，参考录音与配音均在本机处理",
      };
    }
  }

  async function execute(
    data: Record<string, unknown>,
    context: MediaJobContext,
    signal: AbortSignal,
  ) {
    await mkdir(context.workDir, { recursive: true });
    const request = join(context.workDir, `qwen-request-${randomUUID()}.json`);
    await writeFile(request, JSON.stringify({ ...data, modelPath }), { mode: 0o600 });
    let pending = "";
    const decoder = new StringDecoder("utf8");
    let result: any;
    let progress = Promise.resolve();
    try {
      await runMediaProcess(python, ["-I", script, request], {
        signal,
        env: env(data.action === "download"),
        onStdout(chunk) {
          pending += decoder.write(chunk);
          if (Buffer.byteLength(pending) > 256 * 1024)
            throw new Error("Qwen runtime response exceeds budget");
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
            if (typeof value.progress?.fraction === "number") {
              progress = progress.then(() =>
                context.reportProgress({
                  fraction: value.progress.fraction,
                  stage: "speech",
                  message: "正在本机生成你的声音",
                }),
              );
              void progress.catch(() => {});
            }
          }
        },
      });
      await progress;
      if (!result) throw new Error("Qwen runtime did not return a complete result");
      return result;
    } finally {
      await progress.catch(() => {});
      await rm(request, { force: true });
    }
  }

  async function verifyResources(signal: AbortSignal, hashes: boolean) {
    for (const resource of RESOURCES) {
      const path = join(modelPath, resource.path);
      if (
        (await stat(path)).size !== resource.bytes ||
        (hashes && "sha256" in resource && (await digest(path, signal)) !== resource.sha256)
      )
        throw new Error("本地模型校验失败，请重新准备声音克隆");
    }
  }
  async function probe(path: string, signal: AbortSignal, formats = FORMATS) {
    return probeVoiceAudio(path, signal, { ffprobePath: options.ffprobePath, formats });
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
  async function render(input: QwenTtsInput, context: MediaJobContext, signal: AbortSignal) {
    await mkdir(context.workDir, { recursive: true });
    await mkdir(context.outputDir, { recursive: true });
    const nonce = randomUUID();
    const reference = join(context.workDir, `qwen-reference-${nonce}.wav`);
    const raw = join(context.workDir, `qwen-raw-${nonce}.wav`);
    const partial = join(context.outputDir, `speech-${nonce}.partial.wav`);
    const output = join(context.outputDir, `speech-${nonce}.wav`);
    let complete = false;
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
          "24000",
          "-c:a",
          "pcm_s16le",
          reference,
        ],
        { signal },
      );
      await audible(reference, signal);
      await context.reportProgress({
        fraction: 0.15,
        stage: "speech",
        message: "正在加载本地模型；首次生成可能需要几分钟",
      });
      await execute(
        {
          action: "generate",
          text: input.text,
          referencePath: reference,
          referenceText: input.referenceText,
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
      await Promise.all(
        [reference, raw, partial, ...(!complete ? [output] : [])].map((path) =>
          rm(path, { force: true }),
        ),
      );
    }
  }

  async function setup(context: MediaJobContext): Promise<QwenTtsStatus> {
    if (context.signal.aborted) throw mediaAbortError();
    const initial = await status();
    if (initial.state === "unavailable") throw new Error(initial.reason);
    if (owners.has(dir) || generationQueues.has(dir))
      throw new Error("本地声音服务正在运行，请等待或取消当前任务");
    owners.add(dir);
    const deadline = AbortSignal.timeout(40 * 60_000);
    const signal = combineAbortSignals([context.signal, deadline]);
    const lockPath = join(dir, "setup.lock");
    let lock: Awaited<ReturnType<typeof open>> | undefined;
    const cleanup: string[] = [];
    try {
      await mkdir(dir, { recursive: true });
      try {
        lock = await open(lockPath, "wx", 0o600);
      } catch {
        const existing = await readJson(lockPath).catch(() => null);
        // An empty/fresh lock can be between exclusive creation and its PID write.
        // Only reclaim a fully parsed lock whose previous process is known to be gone.
        if (!Number.isSafeInteger(existing?.pid) || existing.pid <= 0)
          throw new Error("本地声音准备锁正在初始化或需要宿主重启后检查");
        let alive = false;
        try {
          process.kill(existing.pid, 0);
          alive = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") alive = true;
        }
        if (alive) throw new Error("另一个宿主正在准备本地声音服务");
        await rm(lockPath, { force: true });
        lock = await open(lockPath, "wx", 0o600);
      }
      await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
      const disk = await statfs(dir);
      if (disk.bavail * disk.bsize < initial.requiredDiskBytes)
        throw new Error("空间不足，准备声音克隆至少需要 6 GB 可用空间");
      await Promise.all([
        runMediaProcess(options.ffmpegPath ?? "ffmpeg", ["-version"], { signal }),
        runMediaProcess(options.ffprobePath ?? "ffprobe", ["-version"], { signal }),
      ]);
      await writeFile(script, SCRIPT, { mode: 0o600 });
      await context.reportProgress({
        fraction: 0.02,
        stage: "setup",
        message: "准备独立 Python 环境与本地声音克隆，预计下载约 2.4 GB",
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
          const path = join(modelPath, item.path);
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
          message: "正在下载固定版本的 Qwen3 模型与声音编码器（约 2 GB）",
        });
        await execute(
          {
            action: "download",
            modelId: MODEL,
            revision: REVISION,
            files: RESOURCES.map((r) => r.path),
          },
          context,
          signal,
        );
        await verifyResources(signal, true);
      }
      await context.reportProgress({
        fraction: 0.7,
        stage: "verify",
        message: "正在用系统测试音验证真实离线推理",
      });
      await mkdir(context.workDir, { recursive: true });
      const reference = join(context.workDir, `qwen-setup-${randomUUID()}.aiff`);
      const transcript = join(context.workDir, `qwen-setup-${randomUUID()}.txt`);
      cleanup.push(reference, transcript);
      const referenceText =
        "This is a local voice test. Clear speech helps prepare the audio model.";
      await writeFile(transcript, referenceText, { mode: 0o600 });
      await runMediaProcess("/usr/bin/say", ["-r", "165", "-f", transcript, "-o", reference], {
        signal,
      });
      const sample = await render(
        { text: "你好，这是本地声音克隆测试。", referencePath: reference, referenceText, rate: 1 },
        context,
        signal,
      );
      cleanup.push(sample.path);
      if (signal.aborted) throw mediaAbortError();
      await saveJson(manifestPath, {
        scriptHash: SCRIPT_HASH,
        revision: REVISION,
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
    } catch (error) {
      if (!lock) throw error;
      const reason = signal.aborted
        ? context.signal.aborted
          ? "声音克隆准备已取消，可以重新准备"
          : "声音克隆准备超时，请检查网络后重试"
        : "Qwen3 声音克隆准备失败；需要 uv、FFmpeg、完整模型与可用空间，请检查网络和本机环境后重试";
      await saveJson(failurePath, { reason, at: Date.now() }).catch(() => {});
      await rm(manifestPath, { force: true });
      throw context.signal.aborted ? mediaAbortError() : new Error(reason, { cause: error });
    } finally {
      try {
        try {
          await Promise.all(cleanup.map((path) => rm(path, { force: true })));
        } finally {
          if (lock) {
            try {
              await lock.close();
            } finally {
              await rm(lockPath, { force: true });
            }
          }
        }
      } finally {
        owners.delete(dir);
      }
    }
    return status();
  }

  async function generate(raw: QwenTtsInput, context: MediaJobContext): Promise<QwenTtsResult> {
    const input = validateQwenTtsInput(raw);
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
        engine: "qwen3-tts",
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
        ...AUDIO_PROBE_MESSAGES,
        "本地模型校验失败，请重新准备声音克隆",
        "参考录音须为 512 MB 以内的本地素材",
        "无法读取录音时长，请选择有效的音频或视频素材",
        "参考录音需要 3 至 30 秒，请先裁剪为一段清晰的人声",
        "录音中没有可听见的声音",
        "未生成合格的 48 kHz WAV 配音",
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
