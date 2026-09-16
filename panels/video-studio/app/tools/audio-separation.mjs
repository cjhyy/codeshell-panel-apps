import { createRequire as __panelCreateRequire } from "node:module"; const require = __panelCreateRequire(import.meta.url);

// native/audio-separation.ts
import { isAbsolute } from "node:path";

// native/separation/runtime.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { open as open2, readFile, rename as rename2, rm as rm2, stat as stat2 } from "node:fs/promises";
import { join as join2 } from "node:path";

// native/process-runner.ts
import { spawn } from "node:child_process";
function mediaAbortError() {
  return Object.assign(new Error("Media processing was cancelled"), { name: "AbortError" });
}
async function runMediaProcess(executable, args, options) {
  if (options.signal.aborted) throw mediaAbortError();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"],
      // Keep every descendant in the Host-owned tool process group.
      detached: false,
      windowsHide: true
    });
    const stdout = [];
    let bytes2 = 0;
    let stderr = "";
    let progressBuffer = "";
    let lastProgress = 0;
    let failure;
    let spawnFailure;
    let pipeFailure;
    let exited = false;
    let inputFinished = !options.input;
    const inputController = new AbortController();
    let killTimer;
    let progressWork = Promise.resolve();
    let inputWork = Promise.resolve();
    const asError = (error) => error instanceof Error ? error : new Error(String(error));
    const kill = (signal) => {
      try {
        child.kill(signal);
      } catch {
      }
    };
    const stop = () => {
      inputController.abort();
      child.stdin?.destroy();
      if (exited) return;
      kill("SIGTERM");
      killTimer ??= setTimeout(() => kill("SIGKILL"), 1500);
      killTimer.unref();
    };
    const cleanup = () => {
      options.signal.removeEventListener("abort", stop);
      if (killTimer) clearTimeout(killTimer);
    };
    options.signal.addEventListener("abort", stop, { once: true });
    if (options.signal.aborted) stop();
    const consumeProgress = (text) => {
      if (options.durationSeconds && options.onProgress) {
        progressBuffer += text;
        const lines = progressBuffer.split(/\r?\n/);
        progressBuffer = (lines.pop() ?? "").slice(-4096);
        for (const line of lines) {
          const match = /^out_time_us=(\d+)$/.exec(line);
          if (!match || Date.now() - lastProgress < 150) continue;
          lastProgress = Date.now();
          const fraction = Math.min(0.999, Number(match[1]) / 1e6 / options.durationSeconds);
          progressWork = progressWork.then(async () => {
            await options.onProgress?.({ fraction });
          }).catch((error) => {
            failure = error instanceof Error ? error : new Error(String(error));
            stop();
          });
        }
      }
    };
    child.stdout.on("data", (chunk) => {
      try {
        if (options.onStdout) options.onStdout(chunk);
        else {
          bytes2 += chunk.length;
          if (bytes2 > (options.maxStdoutBytes ?? 4 * 1024 * 1024)) {
            failure = new Error("Media tool output exceeds its bounded result budget");
            stop();
            return;
          }
          stdout.push(chunk);
        }
        if (options.progressStream !== "stderr") consumeProgress(chunk.toString("utf8"));
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        stop();
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr = (stderr + text).slice(-128 * 1024);
      try {
        options.onStderr?.(text);
        if (options.progressStream === "stderr") consumeProgress(text);
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        stop();
      }
    });
    child.once("error", (error) => {
      spawnFailure = error;
      stop();
    });
    child.once("exit", () => {
      exited = true;
      inputController.abort();
      child.stdin?.destroy();
    });
    child.stdin?.on("error", (error) => {
      if (!inputController.signal.aborted) {
        pipeFailure = error;
        stop();
      }
    });
    child.once("close", async (code) => {
      exited = true;
      inputController.abort();
      try {
        await Promise.all([inputWork, progressWork]);
        if (options.signal.aborted) throw mediaAbortError();
        if (spawnFailure) throw spawnFailure;
        if (failure) throw failure;
        if (code !== 0)
          throw new Error(`${executable} exited with code ${code}: ${stderr.slice(-4e3)}`);
        if (pipeFailure) throw pipeFailure;
        if (!inputFinished)
          throw new Error(`${executable} exited before all media input was written`);
        resolve({ stdout: Buffer.concat(stdout), stderr });
      } catch (error) {
        reject(error);
      } finally {
        cleanup();
      }
    });
    if (options.input) {
      const input = options.input;
      const signal = inputController.signal;
      const write = (chunk) => new Promise((accept, decline) => {
        const aborted = () => {
          signal.removeEventListener("abort", aborted);
          decline(mediaAbortError());
        };
        const complete = (error) => {
          signal.removeEventListener("abort", aborted);
          if (error) decline(error);
          else accept();
        };
        signal.addEventListener("abort", aborted, { once: true });
        if (signal.aborted) return aborted();
        try {
          if (chunk) child.stdin.write(chunk, complete);
          else child.stdin.end(() => complete());
        } catch (error) {
          complete(asError(error));
        }
      });
      inputWork = (async () => {
        let iterator;
        let exhausted = false;
        try {
          if (signal.aborted) return;
          iterator = input(signal)[Symbol.asyncIterator]();
          while (!signal.aborted) {
            const next = await iterator.next();
            if (next.done) {
              exhausted = true;
              break;
            }
            if (signal.aborted) break;
            if (!(next.value instanceof Uint8Array))
              throw new Error("Media input must yield Uint8Array chunks");
            await write(next.value);
          }
          if (!signal.aborted && exhausted) {
            await write();
            inputFinished = true;
          }
        } catch (error) {
          if (!signal.aborted) {
            failure ??= asError(error);
            stop();
          }
        } finally {
          if (iterator && !exhausted) {
            try {
              await iterator.return?.();
            } catch (error) {
              failure ??= asError(error);
              stop();
            }
          }
        }
      })();
    }
  });
}

// native/editor-runtime/files.ts
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, realpath, rename, rm, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, relative, sep } from "node:path";

// src/editor/time.ts
var TICKS_PER_SECOND = 24e4;
var MAX_TICK = BigInt(Number.MAX_SAFE_INTEGER);

// src/editor/validation.ts
var MAX_EDITOR_TICK = 24 * 60 * 60 * TICKS_PER_SECOND;
var MAX_DOCUMENT_CHARACTERS = 16 * 1024 * 1024;

// src/editor/waveform.ts
var WAVEFORM_LIMITS = Object.freeze({
  bins: 65536,
  bytes: 768 * 1024,
  sampleRate: 48e3,
  seconds: 86400
});

// src/editor/task-bridge.ts
var EDITOR_TASK_LIMITS = Object.freeze({
  resourcesPerTask: 128,
  inputBytes: 2 * 1024 * 1024,
  documentBytes: 32 * 1024 * 1024,
  chunkBytes: 512 * 1024,
  snapshotResources: 1e4,
  proxiesPerTask: 120
});

// native/editor-runtime/protocol.ts
var EditorTaskError = class extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.name = "EditorTaskError";
  }
  code;
  retryable;
};
function record(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some((key) => typeof key !== "string" || !keys.includes(key)))
    throw new EditorTaskError("INVALID_REQUEST", `${label}包含无效或不支持的字段`);
  return value;
}
function resourceId(value) {
  if (typeof value !== "string" || !/^(?:asset|external)-[a-f0-9]{64}$/.test(value))
    throw new EditorTaskError("INVALID_REQUEST", "素材资源编号无效");
  return value;
}
function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max)
    throw new EditorTaskError("INVALID_REQUEST", "请求数量或范围无效");
  return Number(value);
}

// native/editor-runtime/files.ts
function abort(signal) {
  if (signal.aborted) throw mediaAbortError();
}
async function sealed(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new EditorTaskError("INVALID_DIRECTORY", "任务目录不是授权的普通目录");
  return realpath(path);
}
async function directory(root, parts) {
  let path = root;
  for (const part of parts) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) || part === "." || part === "..")
      throw new EditorTaskError("INVALID_DIRECTORY", "任务子目录无效");
    path = join(path, part);
    await mkdir(path, { mode: 448 }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path)
      throw new EditorTaskError("INVALID_DIRECTORY", "任务子目录已变化");
  }
  return path;
}
async function regular(root, parts) {
  let path = root;
  for (const part of parts) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) || part === "." || part === "..")
      throw new EditorTaskError("INVALID_FILE", "任务文件名无效");
    path = join(path, part);
    if ((await lstat(path)).isSymbolicLink())
      throw new EditorTaskError("INVALID_FILE", "任务材料不能使用符号链接");
  }
  const canonical = await realpath(path);
  if (!canonical.startsWith(root + sep) || !(await stat(canonical)).isFile())
    throw new EditorTaskError("INVALID_FILE", "任务材料不在授权目录内");
  return canonical;
}
async function fileHash(path, signal) {
  abort(signal);
  const hash = createHash("sha256"), file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)), stream = file.createReadStream();
  const stop = () => stream.destroy(mediaAbortError());
  signal.addEventListener("abort", stop, { once: true });
  try {
    for await (const data of stream) {
      abort(signal);
      hash.update(data);
    }
    return hash.digest("hex");
  } finally {
    stream.destroy();
    await file.close();
    signal.removeEventListener("abort", stop);
  }
}
async function publish(root, path, extension, mimeType, role, signal) {
  abort(signal);
  const sha256 = await fileHash(path, signal), bytes2 = (await stat(path)).size;
  if (bytes2 < 1 || bytes2 > 20 * 1024 ** 3)
    throw new EditorTaskError("LIMIT_EXCEEDED", "输出文件超过当前资源接口的 20GiB 限制");
  const outputs = await directory(root, ["outputs"]), target = join(outputs, `${sha256}.${extension}`);
  if (path !== target)
    await copyFile(path, target, constants.COPYFILE_EXCL).catch(async (error) => {
      if (error.code !== "EEXIST" || await fileHash(await regular(outputs, [`${sha256}.${extension}`]), signal) !== sha256)
        throw error;
    });
  return {
    file: relative(root, target).split(sep).join("/"),
    role,
    name: `${role}.${extension}`,
    mimeType,
    bytes: bytes2,
    sha256,
    assetId: `asset-${sha256}`
  };
}

// src/editor/operations.ts
var BASE_CLIP_KEYS = ["trackId", "start", "duration", "label", "groupId", "linkGroupId"];
var VISUAL_KEYS = ["transform", "color", "blendMode", "mask"];
var CLIP_PATCH_KEYS = {
  media: [...BASE_CLIP_KEYS, ...VISUAL_KEYS, "assetId", "timeMap", "audio"],
  sequence: [...BASE_CLIP_KEYS, ...VISUAL_KEYS, "sequenceId", "timeMap", "audio"],
  multicam: [
    ...BASE_CLIP_KEYS,
    ...VISUAL_KEYS,
    "timeMap",
    "angles",
    "switches",
    "audioAngleId",
    "audio"
  ],
  text: [
    ...BASE_CLIP_KEYS,
    ...VISUAL_KEYS,
    "role",
    "text",
    "style",
    "words",
    "sourceBinding",
    "translation"
  ],
  shape: [...BASE_CLIP_KEYS, ...VISUAL_KEYS, "shape", "fill", "stroke", "strokeWidth"]
};

// src/editor/separation.ts
var SEPARATION_MODEL_ID = "uvr-mdx-kara-2-v1";
var SEPARATION_MODEL_SHA = "bf32e15105a09c0f7dddd2b67346146334d6f3ecb399ed7638eba2ab07cbf5f4";
var SEPARATION_MAX_SECONDS = 2 * 60 * 60;

// native/separation/python.ts
var SEPARATION_PYTHON = String.raw`
import sys, os, json, logging, socket
# The installer owns downloads. A missing weight or library never triggers network inference.
def offline(*args, **kwargs):
    raise RuntimeError("Audio separation inference is offline; use the explicit setup action")
socket.create_connection = offline
socket.socket.connect = offline
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
import numpy as np
import soundfile as sf
import torch
from audio_separator.separator import Separator
torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
MODEL = 'UVR_MDXNET_KARA_2.onnx'
DATA = {'compensate':1.065,'mdx_dim_f_set':2048,'mdx_dim_t_set':8,'mdx_n_fft_scale_set':5120,'primary_stem':'Instrumental','is_karaoke':True}
class LocalSeparator(Separator):
    def setup_accelerated_inferencing_device(self):
        self.torch_device_cpu = torch.device('cpu')
        self.torch_device = self.torch_device_cpu
        self.torch_device_mps = None
        self.onnx_execution_provider = ['CPUExecutionProvider']
    def download_file_if_not_exists(self, *args):
        return offline()
    def download_model_files(self, filename):
        if filename != MODEL: raise RuntimeError('Unsupported separation model')
        return MODEL, 'MDX', MODEL, os.path.join(self.model_file_dir, MODEL), None
    def load_model_data_using_hash(self, path):
        return DATA.copy()
source, models, output = sys.argv[1:4]
os.makedirs(output, exist_ok=True)
separator = LocalSeparator(log_level=logging.ERROR, model_file_dir=models, output_dir=output,
    output_format='WAV', normalization_threshold=1.0, amplification_threshold=0.0,
    sample_rate=44100, use_soundfile=True)
# Be explicit even if a future dependency changes its device setup hook.
separator.torch_device = torch.device('cpu')
separator.torch_device_cpu = torch.device('cpu')
separator.torch_device_mps = None
separator.onnx_execution_provider = ['CPUExecutionProvider']
separator.load_model(MODEL)
rate = 44100
with sf.SoundFile(source) as audio:
    if audio.samplerate != rate or audio.channels != 2: raise RuntimeError('Expected stereo 44.1kHz input')
    length = len(audio)
    # Bounded chunks have real context on both sides. Only their central portion is
    # retained, so adjacent chunks never add silence or change the sample count.
    step, context = 30 * rate, 2 * rate
    with sf.SoundFile(os.path.join(output,'vocals.wav'),'w',rate,2,subtype='FLOAT') as voice, \
         sf.SoundFile(os.path.join(output,'instrumental.wav'),'w',rate,2,subtype='FLOAT') as music:
        for start in range(0,length,step):
            end = min(length,start+step)
            lower, upper = max(0,start-context), min(length,end+context)
            audio.seek(lower)
            chunk = audio.read(upper-lower,dtype='float32',always_2d=True)
            path = os.path.join(output,'chunk.wav')
            sf.write(path,chunk,rate,subtype='FLOAT')
            files = separator.separate(path,{'Vocals':'chunk-vocals','Instrumental':'chunk-instrumental'})
            if len(files) != 2: raise RuntimeError('Separation failed to return both stems')
            for name, target in [('vocals',voice),('instrumental',music)]:
                samples, hz = sf.read(os.path.join(output,'chunk-'+name+'.wav'),dtype='float32',always_2d=True)
                if hz != rate or samples.shape != chunk.shape or not np.isfinite(samples).all():
                    raise RuntimeError('Invalid stem samples')
                target.write(samples[start-lower:end-lower])
                os.remove(os.path.join(output,'chunk-'+name+'.wav'))
            os.remove(path)
            print(json.dumps({'fraction':end/length}),flush=True)
print(json.dumps({'sampleRate':rate,'sampleCount':length}),flush=True)
`;

// native/separation/runtime.ts
var SEPARATION_MODEL = Object.freeze({
  filename: "UVR_MDXNET_KARA_2.onnx",
  url: "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR_MDXNET_KARA_2.onnx",
  bytes: 52786726,
  sha256: SEPARATION_MODEL_SHA,
  package: "audio-separator[cpu]==0.41.1"
});
function validateSeparationRequest(raw) {
  const value = record(raw, ["action", "resourceId", "duration"], "人声分离请求");
  if (value.action === "separate")
    return {
      action: "separate",
      resourceId: resourceId(value.resourceId),
      duration: integer(value.duration, 1, SEPARATION_MAX_SECONDS * 24e4)
    };
  if (!["status", "setup"].includes(value.action) || value.resourceId !== void 0 || value.duration !== void 0)
    throw new Error("人声分离请求无效");
  return { action: value.action };
}
var python = (root) => join2(root, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
async function probe(root, ctx) {
  try {
    const model = await regular(root, [SEPARATION_MODEL.filename]);
    if ((await stat2(model)).size !== SEPARATION_MODEL.bytes || await fileHash(model, ctx.signal) !== SEPARATION_MODEL.sha256)
      return false;
    const output = await runMediaProcess(
      python(root),
      [
        "-I",
        "-c",
        "import importlib.metadata as m; import onnxruntime,numpy,soundfile; from audio_separator.separator.architectures.mdx_separator import MDXSeparator; assert m.version('audio-separator')=='0.41.1'; assert m.version('librosa')=='0.11.0'; assert m.version('audioread')=='3.0.1'; print('ready')"
      ],
      { signal: ctx.signal, maxStdoutBytes: 4096 }
    );
    return output.stdout.toString().trim() === "ready";
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    return false;
  }
}
async function commandAvailable(command, ctx) {
  try {
    await runMediaProcess(command, ["-version"], { signal: ctx.signal, maxStdoutBytes: 64 * 1024 });
    return true;
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    return false;
  }
}
async function status(root, ctx) {
  const base = { modelId: SEPARATION_MODEL_ID, canInstall: false };
  if (!await commandAvailable(ctx.tools?.ffmpegPath ?? "ffmpeg", ctx) || !await commandAvailable(ctx.tools?.ffprobePath ?? "ffprobe", ctx))
    return { ...base, state: "unavailable", message: "请先安装 FFmpeg 与 ffprobe，再准备人声分离" };
  if (await probe(root, ctx))
    return { ...base, state: "ready", message: "本地分离模型已就绪，处理时无需联网" };
  let available = true;
  try {
    await runMediaProcess(ctx.tools?.uvPath ?? "uv", ["--version"], {
      signal: ctx.signal,
      maxStdoutBytes: 4096
    });
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    available = false;
  }
  return {
    ...base,
    state: available ? "not-installed" : "unavailable",
    canInstall: available,
    message: available ? "首次使用需下载约 51 MiB 的模型及 Python 处理依赖；点击安装后开始" : "请先安装 uv，再准备本地分离模型"
  };
}
async function download(root, ctx) {
  const path = join2(root, SEPARATION_MODEL.filename), partial = `${path}.partial`;
  const response = await fetch(SEPARATION_MODEL.url, { signal: ctx.signal });
  if (!response.ok || !response.body) throw new Error("分离模型下载失败，请稍后重试");
  const stream = response.body.getReader(), file = await open2(partial, "wx", 384);
  let bytes2 = 0;
  try {
    for (; ; ) {
      const { value, done } = await stream.read();
      if (done) break;
      ctx.signal.throwIfAborted();
      bytes2 += value.byteLength;
      if (bytes2 > SEPARATION_MODEL.bytes) throw new Error("分离模型大小不匹配");
      let position = 0;
      while (position < value.byteLength) {
        const written = await file.write(value, position, value.byteLength - position);
        if (!written.bytesWritten) throw new Error("模型文件写入失败");
        position += written.bytesWritten;
      }
      await ctx.reportProgress({
        stage: "download",
        fraction: bytes2 / SEPARATION_MODEL.bytes,
        message: "正在下载公开的分离模型"
      });
    }
    await file.sync();
  } finally {
    await file.close();
    await stream.cancel().catch(() => {
    });
  }
  if (bytes2 !== SEPARATION_MODEL.bytes || await fileHash(partial, ctx.signal) !== SEPARATION_MODEL.sha256)
    throw new Error("分离模型校验失败，请重新安装");
  await rename2(partial, path);
}
async function setup(runtime, root, ctx) {
  const lockPath = join2(runtime, "setup.lock");
  let lock;
  try {
    lock = await open2(lockPath, "wx", 384);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let alive = true;
    try {
      const pid = Number(await readFile(lockPath, "utf8"));
      if (!Number.isSafeInteger(pid) || pid < 1) throw new Error();
      process.kill(pid, 0);
    } catch (e) {
      if (e.code === "ESRCH") alive = false;
    }
    if (alive) throw new Error("另一个安装任务仍在进行，请等待它结束");
    await rm2(lockPath, { force: true });
    lock = await open2(lockPath, "wx", 384);
  }
  await lock.writeFile(String(process.pid));
  const staging = await directory(runtime, [`setup-${randomUUID2()}`]);
  try {
    if (await probe(root, ctx)) return await status(root, ctx);
    const capabilities = await status(root, ctx);
    if (!capabilities.canInstall) throw new Error(capabilities.message);
    const env = {
      ...process.env,
      UV_CACHE_DIR: join2(runtime, "package-cache"),
      UV_PYTHON_INSTALL_DIR: join2(runtime, "python"),
      UV_LINK_MODE: "copy",
      UV_NO_PROGRESS: "1"
    };
    await ctx.reportProgress({ stage: "install", message: "正在准备独立 Python 与分离处理器" });
    await runMediaProcess(
      ctx.tools?.uvPath ?? "uv",
      ["venv", "--python", "3.12", join2(staging, "venv")],
      { signal: ctx.signal, env, maxStdoutBytes: 64 * 1024 }
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
        "librosa==0.11.0"
      ],
      { signal: ctx.signal, env, maxStdoutBytes: 64 * 1024 }
    );
    await download(staging, ctx);
    if (!await probe(staging, ctx)) throw new Error("处理器安装验证失败，请重试");
    ctx.signal.throwIfAborted();
    await rm2(root, { recursive: true, force: true });
    await rename2(staging, root);
    return await status(root, ctx);
  } finally {
    await rm2(staging, { recursive: true, force: true });
    await lock.close();
    await rm2(lockPath, { force: true });
  }
}
async function inspect(path, ctx) {
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
      path
    ],
    { signal: ctx.signal, maxStdoutBytes: 32768 }
  );
  const data = JSON.parse(output.stdout.toString()), audio = data.streams?.find((stream) => stream.codec_type === "audio");
  if (!audio || !Number.isFinite(Number(data.format?.duration)))
    throw new Error("素材没有可处理的声音");
  return {
    duration: Number(data.format.duration),
    rate: Number(audio.sample_rate),
    channels: Number(audio.channels)
  };
}
async function runSeparationRequest(raw, ctx) {
  const request = validateSeparationRequest(raw);
  ctx.signal.throwIfAborted();
  const job = await sealed(ctx.jobDir), runtime = await sealed(ctx.runtimeDir), root = join2(runtime, "v1");
  if (request.action === "status") return { result: await status(root, ctx), artifacts: [] };
  if (request.action === "setup") return { result: await setup(runtime, root, ctx), artifacts: [] };
  const ready = await status(root, ctx);
  if (ready.state !== "ready") throw new Error(ready.message);
  const source = await regular(job, ["inputs", "source.bin"]), original = await inspect(source, ctx), duration = request.duration / 24e4;
  const sourceHash = await fileHash(source, ctx.signal);
  if (request.resourceId.startsWith("asset-") && request.resourceId !== `asset-${sourceHash}`)
    throw new Error("原素材内容校验不匹配，请重新连接素材");
  if (Math.abs(original.duration - duration) > 0.1)
    throw new Error("原素材时长已变化，请重新导入后再处理");
  if (original.channels < 1 || original.channels > 8)
    throw new Error("人声分离支持 1 到 8 声道的素材");
  const work = await directory(job, [`separate-${randomUUID2()}`]), input = join2(work, "input.wav"), sampleCount = Math.ceil(duration * 44100);
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
        input
      ],
      { signal: ctx.signal, maxStdoutBytes: 4096 }
    );
    await ctx.reportProgress({ stage: "separate", fraction: 0, message: "正在分离人声与伴奏" });
    let pending = "", latest = 0, progressWork = Promise.resolve();
    await runMediaProcess(python(root), ["-I", "-c", SEPARATION_PYTHON, input, root, work], {
      signal: ctx.signal,
      maxStdoutBytes: 128 * 1024,
      onStdout(chunk) {
        pending += chunk.toString();
        const lines = pending.split(/\r?\n/);
        pending = lines.pop();
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
                message: "正在分离人声与伴奏"
              });
            });
            void progressWork.catch(() => {
            });
          }
        }
      }
    });
    await progressWork;
    const artifacts = [];
    for (const role of ["vocals", "instrumental"]) {
      const path = await regular(work, [`${role}.wav`]), check = await inspect(path, ctx);
      if (check.rate !== 44100 || check.channels !== 2 || Math.abs(check.duration - sampleCount / 44100) > 1 / 44100)
        throw new Error("分离产物采样与原素材不一致，未应用任何修改");
      artifacts.push(await publish(job, path, "wav", "audio/wav", role, ctx.signal));
    }
    ctx.signal.throwIfAborted();
    const stem = (index) => {
      const a = artifacts[index];
      return {
        assetId: a.assetId,
        sha256: a.sha256,
        bytes: a.bytes,
        mimeType: "audio/wav"
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
        stems: { vocals: stem(0), instrumental: stem(1) }
      },
      artifacts
    };
  } finally {
    await rm2(work, { recursive: true, force: true });
  }
}

// native/signals.ts
function combineAbortSignals(signals) {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const controller2 = new AbortController();
  const abort2 = () => {
    for (const signal of signals) signal.removeEventListener("abort", abort2);
    controller2.abort();
  };
  for (const signal of signals) {
    if (signal.aborted) {
      abort2();
      break;
    }
    signal.addEventListener("abort", abort2, { once: true });
  }
  return controller2.signal;
}

// native/audio-separation.ts
var controller = new AbortController();
var cancel = () => controller.abort();
process.once("SIGTERM", cancel);
process.once("SIGINT", cancel);
var last = 0;
var lastStage = "";
var bytes = 0;
var emit = (value) => {
  const line = JSON.stringify(value) + "\n";
  bytes += Buffer.byteLength(line);
  if (bytes > 3.5 * 1024 * 1024) throw new Error("任务回执超过限制");
  process.stdout.write(line);
};
try {
  const args = process.argv.slice(2);
  if (args.length !== 4 || (/* @__PURE__ */ new Set([args[0], args[2]])).size !== 2 || [args[0], args[2]].some((flag) => !["--job-dir", "--runtime-dir"].includes(flag)))
    throw new Error("请从视频面板启动分离任务");
  const dir = (flag) => {
    const path = args[args.indexOf(flag) + 1];
    if (!path || !isAbsolute(path)) throw new Error("授权任务目录无效");
    return path;
  };
  const chunks = [];
  let count = 0;
  for await (const chunk of process.stdin) {
    count += chunk.length;
    if (count > 65536) throw new Error("分离请求超过大小限制");
    chunks.push(Buffer.from(chunk));
  }
  const envelope = record(
    JSON.parse(Buffer.concat(chunks).toString()),
    ["action", "resourceId", "duration", "scopeKey", "jobId"],
    "分离任务"
  );
  if (typeof envelope.scopeKey !== "string" || !/^[a-f0-9]{64}$/.test(envelope.scopeKey) || typeof envelope.jobId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(envelope.jobId))
    throw new Error("分离任务标识无效");
  const { scopeKey, jobId, ...request } = envelope;
  const signal = combineAbortSignals([controller.signal, AbortSignal.timeout(2 * 60 * 60 * 1e3)]);
  const result = await runSeparationRequest(request, {
    jobDir: dir("--job-dir"),
    runtimeDir: dir("--runtime-dir"),
    signal,
    reportProgress(progress) {
      const now = Date.now();
      if (bytes > 3 * 1024 * 1024 || now - last < 500 && progress.stage === lastStage && progress.fraction !== 1)
        return;
      last = now;
      lastStage = progress.stage;
      emit({ type: "progress", progress });
    }
  });
  signal.throwIfAborted();
  emit({ type: "result", result });
} catch (error) {
  const cancelled = controller.signal.aborted || error instanceof Error && error.name === "AbortError", raw = error instanceof Error ? error.message : "";
  const message = cancelled ? "分离任务已取消" : raw && raw.length < 350 && !/(?:\/Users\/|\/home\/|\/tmp\/|https?:|ENOENT|EACCES|exited with code)/.test(raw) ? raw : "本地分离未完成，请检查处理器与素材后重试";
  emit({
    type: "error",
    code: cancelled ? "CANCELLED" : "SEPARATION_FAILED",
    message,
    retryable: true
  });
  process.exitCode = 1;
} finally {
  process.removeListener("SIGTERM", cancel);
  process.removeListener("SIGINT", cancel);
}
