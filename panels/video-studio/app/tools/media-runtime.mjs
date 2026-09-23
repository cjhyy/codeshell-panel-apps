import { createRequire as __panelCreateRequire } from "node:module"; const require = __panelCreateRequire(import.meta.url);

// native/media/media-cli.ts
import { constants as constants4 } from "node:fs";
import { lstat as lstat3, mkdir as mkdir13, open as open5, realpath as realpath5 } from "node:fs/promises";
import { join as join14 } from "node:path";

// native/signals.ts
function combineAbortSignals(signals) {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const controller = new AbortController();
  const abort2 = () => {
    for (const signal of signals) signal.removeEventListener("abort", abort2);
    controller.abort();
  };
  for (const signal of signals) {
    if (signal.aborted) {
      abort2();
      break;
    }
    signal.addEventListener("abort", abort2, { once: true });
  }
  return controller.signal;
}

// native/media/media-runtime.ts
import { createHash as createHash9 } from "node:crypto";

// native/providers/audio8.ts
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
  writeFile
} from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";

// native/process-runner.ts
import { spawn } from "node:child_process";
function mediaAbortError() {
  return Object.assign(new Error("Media processing was cancelled"), { name: "AbortError" });
}
async function runMediaProcess(executable, args, options) {
  if (options.signal.aborted) throw mediaAbortError();
  return new Promise((resolve7, reject) => {
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"],
      // Keep every descendant in the Host-owned tool process group.
      detached: false,
      windowsHide: true
    });
    const stdout = [];
    let bytes = 0;
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
    const consumeProgress = (text2) => {
      if (options.durationSeconds && options.onProgress) {
        progressBuffer += text2;
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
          bytes += chunk.length;
          if (bytes > (options.maxStdoutBytes ?? 4 * 1024 * 1024)) {
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
      const text2 = chunk.toString("utf8");
      stderr = (stderr + text2).slice(-128 * 1024);
      try {
        options.onStderr?.(text2);
        if (options.progressStream === "stderr") consumeProgress(text2);
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
        resolve7({ stdout: Buffer.concat(stdout), stderr });
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

// native/validation.ts
function validateLocalTtsInput(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("配音参数必须是对象");
  const input = raw;
  if (typeof input.text !== "string") throw new Error("请输入配音文字");
  const text2 = input.text.replace(/\r\n?/g, "\n").trim();
  if (!text2 || Array.from(text2).length > 6e3) throw new Error("配音文字须为 1 至 6000 字");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text2) || /\[\[|\]\]/.test(text2))
    throw new Error("配音仅支持普通文字，不支持语音控制标记或控制字符");
  let voiceId;
  if (input.voiceId !== void 0) {
    if (typeof input.voiceId !== "string" || !input.voiceId.trim() || input.voiceId.length > 200)
      throw new Error("声音标识无效");
    voiceId = input.voiceId.trim();
  }
  const rate = input.rate === void 0 ? 1 : input.rate;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0.5 || rate > 2)
    throw new Error("语速须在 0.5 至 2 倍之间");
  return { text: text2, ...voiceId ? { voiceId } : {}, rate };
}

// native/providers/audio8-resources.ts
var AUDIO8_COMMIT = "07e40f5d0b03fc473635ef378654bfb581027ac3";
var AUDIO8_REVISION = "818569c6b832118ad68d61bbd873abe250fcd68a";
var AUDIO8_RESOURCES = [
  {
    kind: "code",
    path: "arktts_runtime/__init__.py",
    url: "https://raw.githubusercontent.com/Edge0-AI/Audio8_TTS/07e40f5d0b03fc473635ef378654bfb581027ac3/onnx_runtime/arktts_runtime/__init__.py",
    bytes: 155,
    sha256: "d92cf94702c27a68f61f3c2e93229e61613fcbecb24d4845b97605cd9accf06c"
  },
  {
    kind: "code",
    path: "arktts_runtime/runtime.py",
    url: "https://raw.githubusercontent.com/Edge0-AI/Audio8_TTS/07e40f5d0b03fc473635ef378654bfb581027ac3/onnx_runtime/arktts_runtime/runtime.py",
    bytes: 12148,
    sha256: "e0cab4f04d2138a5e49bcdb632aad777f270c1bc8dbbb810430d1b08843a917f"
  },
  {
    kind: "code",
    path: "arktts_runtime/prompt.py",
    url: "https://raw.githubusercontent.com/Edge0-AI/Audio8_TTS/07e40f5d0b03fc473635ef378654bfb581027ac3/onnx_runtime/arktts_runtime/prompt.py",
    bytes: 3204,
    sha256: "62df836597d88d05c7879fee5c1d2b3d864db4331aa58fd6641f2df93f377a04"
  },
  {
    kind: "code",
    path: "arktts_runtime/voices.py",
    url: "https://raw.githubusercontent.com/Edge0-AI/Audio8_TTS/07e40f5d0b03fc473635ef378654bfb581027ac3/onnx_runtime/arktts_runtime/voices.py",
    bytes: 1515,
    sha256: "71dbde111ff2536f57f11099e3be2b20ee6807390b126ccfe39d22a022088277"
  },
  {
    kind: "code",
    path: "arktts_runtime/registration.py",
    url: "https://raw.githubusercontent.com/Edge0-AI/Audio8_TTS/07e40f5d0b03fc473635ef378654bfb581027ac3/onnx_runtime/arktts_runtime/registration.py",
    bytes: 5919,
    sha256: "aadaffd6b3024408399af9de042afab312ba46892d7fd38af954ce182b7ec89f"
  },
  {
    kind: "code",
    path: "LICENSE",
    url: "https://raw.githubusercontent.com/Edge0-AI/Audio8_TTS/07e40f5d0b03fc473635ef378654bfb581027ac3/LICENSE",
    bytes: 11357,
    sha256: "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4"
  },
  {
    kind: "model",
    path: "codec_decoder_fp16.onnx",
    url: "https://huggingface.co/Edge0/Audio8-TTS-Preview-0.6B-ONNX-INT4/resolve/818569c6b832118ad68d61bbd873abe250fcd68a/codec_decoder_fp16.onnx",
    bytes: 594319,
    sha256: "6e379be31db6c1b0c111e0e3d2aeb10717ee96b197462b926de411e75a1fd019"
  },
  {
    kind: "model",
    path: "codec_decoder_fp16.onnx.data",
    url: "https://huggingface.co/Edge0/Audio8-TTS-Preview-0.6B-ONNX-INT4/resolve/818569c6b832118ad68d61bbd873abe250fcd68a/codec_decoder_fp16.onnx.data",
    bytes: 260741440,
    sha256: "18838f686aa7c1528fb69ec11e1ab404fdc4dc823d13219abfd4b327988527c0"
  },
  {
    kind: "model",
    path: "fast_ar_int4.onnx",
    url: "https://huggingface.co/Edge0/Audio8-TTS-Preview-0.6B-ONNX-INT4/resolve/818569c6b832118ad68d61bbd873abe250fcd68a/fast_ar_int4.onnx",
    bytes: 156318,
    sha256: "808c5a0c95c28d90337d925a9a8f6075f7ff8eb7b3080d2b34c4133479a6dc94"
  },
  {
    kind: "model",
    path: "fast_ar_int4.onnx.data",
    url: "https://huggingface.co/Edge0/Audio8-TTS-Preview-0.6B-ONNX-INT4/resolve/818569c6b832118ad68d61bbd873abe250fcd68a/fast_ar_int4.onnx.data",
    bytes: 35055104,
    sha256: "183be0c9f26b27c605b92a0875beb93f8f98b771f27f65cab133c73610868325"
  },
  {
    kind: "model",
    path: "registration/codec_encoder_fp16.onnx",
    url: "https://huggingface.co/Edge0/Audio8-TTS-Preview-0.6B-ONNX-INT4/resolve/818569c6b832118ad68d61bbd873abe250fcd68a/registration/codec_encoder_fp16.onnx",
    bytes: 940787,
    sha256: "e856d7999442cdc8f1f2ed0d2c055532cf359f0dd6d9a44fd4b98584c5d5dfa5"
  },
  {
    kind: "model",
    path: "registration/codec_encoder_fp16.onnx.data",
    url: "https://huggingface.co/Edge0/Audio8-TTS-Preview-0.6B-ONNX-INT4/resolve/818569c6b832118ad68d61bbd873abe250fcd68a/registration/codec_encoder_fp16.onnx.data",
    bytes: 414425088,
    sha256: "19c740fcc4d45aa2546e9ab86e31c6200955c4b0a139758296fbf1064bf009cd"
  },
  {
    kind: "model",
    path: "registration/registration_manifest.json",
    url: "https://huggingface.co/Edge0/Audio8-TTS-Preview-0.6B-ONNX-INT4/resolve/818569c6b832118ad68d61bbd873abe250fcd68a/registration/registration_manifest.json",
    bytes: 165,
    sha256: "36ef9d2f435f0f7b5ab66dc78a44411a24c0ab9e3a2c63738babe575747a584f"
  },
  {
    kind: "model",
    path: "runtime_manifest.json",
    url: "https://huggingface.co/Edge0/Audio8-TTS-Preview-0.6B-ONNX-INT4/resolve/818569c6b832118ad68d61bbd873abe250fcd68a/runtime_manifest.json",
    bytes: 1080,
    sha256: "6473ae7d0106a2e369e442c72a71d2d46d8fbd3fe18c80d80b1b46e4aa241930"
  },
  {
    kind: "model",
    path: "slow_ar_int4.onnx",
    url: "https://huggingface.co/Edge0/Audio8-TTS-Preview-0.6B-ONNX-INT4/resolve/818569c6b832118ad68d61bbd873abe250fcd68a/slow_ar_int4.onnx",
    bytes: 900218,
    sha256: "0cf7701d6da81f888b49ba6e752445d9786a9915ba30dcf084f7743bdda96834"
  },
  {
    kind: "model",
    path: "slow_ar_int4.onnx.data",
    url: "https://huggingface.co/Edge0/Audio8-TTS-Preview-0.6B-ONNX-INT4/resolve/818569c6b832118ad68d61bbd873abe250fcd68a/slow_ar_int4.onnx.data",
    bytes: 290267090,
    sha256: "bb217f654039692204386b7e5b74d98e9268863bb664a849aa123a9053d6c824"
  },
  {
    kind: "model",
    path: "tokenizer/tokenizer.json",
    url: "https://huggingface.co/Edge0/Audio8-TTS-Preview-0.6B-ONNX-INT4/resolve/818569c6b832118ad68d61bbd873abe250fcd68a/tokenizer/tokenizer.json",
    bytes: 12217872,
    sha256: "f24e08099d45a8adf3f52f5f0b03276e433bb9d689bb15fcbcc48ce58744588b"
  }
];

// native/providers/audio8-script.ts
var AUDIO8_SCRIPT = String.raw`
import gc, hashlib, json, os, socket, sys
from pathlib import Path
from importlib.metadata import version

os.umask(0o077)
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
def offline(*args, **kwargs):
    raise RuntimeError("Network access is disabled for local voice generation")
socket.socket.connect = offline
socket.socket.connect_ex = offline
socket.socket.sendto = offline
socket.create_connection = offline

request = json.loads(Path(sys.argv[1]).read_text())
def emit(value):
    print(json.dumps(value), flush=True)

if request["action"] == "probe":
    import numpy, onnxruntime, soundfile, scipy, tokenizers
    emit({"result": {"packages": [f"{name}=={version(name)}" for name in request["packageNames"]]}})
elif request["action"] == "generate":
    import numpy as np
    import soundfile as sf
    # -I excludes working-directory and user-site imports. Only this Host-owned code is added.
    sys.path.insert(0, request["codePath"])
    from arktts_runtime.registration import VoiceRegistration
    from arktts_runtime.runtime import ArkTtsRuntime

    model_path = Path(request["modelPath"])
    voices_path = Path(request["voicesPath"])
    voice = request["voiceName"]
    manifest = json.loads((model_path / "runtime_manifest.json").read_text())
    fingerprint = manifest["model_fingerprint"]
    reference_data = Path(request["referencePath"]).read_bytes()
    reference_sha = hashlib.sha256(reference_data).hexdigest()
    reference_text = " ".join(request["referenceText"].strip().split())

    def valid_voice():
        try:
            folder = voices_path / voice
            if (folder / "meta.json").stat().st_size > 16384 or (folder / "codes.npy").stat().st_size > 65536:
                return False
            meta = json.loads((folder / "meta.json").read_text())
            codes = np.load(folder / "codes.npy", allow_pickle=False)
            return (meta.get("model_fingerprint") == fingerprint
                    and meta.get("reference_text") == reference_text
                    and meta.get("source_sha256") == reference_sha
                    and codes.dtype == np.uint16 and codes.ndim == 2
                    and codes.shape[0] == manifest["num_codebooks"]
                    and 0 < codes.shape[1] <= 650
                    and int(codes.max()) < manifest["codebook_size"])
        except (OSError, ValueError, KeyError):
            return False

    cached_voice = valid_voice()
    if not cached_voice:
        emit({"progress": {"fraction": 0.16, "stage": "register"}})
        registration = VoiceRegistration(model_path / "registration", voices_path, fingerprint)
        registration.register(reference_data, "reference.wav", reference_text, voice, overwrite=True)
        del registration
        gc.collect()
        if not valid_voice():
            raise RuntimeError("Registered voice failed validation")
    del reference_data

    # Upstream iter_codes also returns when its context/token budget is exhausted. Track
    # the actual EOS decision so a truncated sentence cannot become a successful WAV.
    class CheckedRuntime(ArkTtsRuntime):
        saw_eos = False
        def _sample_semantic(self, *args, **kwargs):
            token = super()._sample_semantic(*args, **kwargs)
            if token == int(self.manifest["im_end_id"]):
                self.saw_eos = True
            return token

    model = CheckedRuntime(model_path, voices_path, threads=request["threads"])
    sample_rate = int(model.manifest["sample_rate"])
    pieces = request["pieces"]
    assert pieces and all(0 < len(piece) <= 150 for piece in pieces)
    samples = 0
    with sf.SoundFile(request["output"], mode="w", samplerate=sample_rate,
                      channels=1, subtype="PCM_16", format="WAV") as output:
        for index, text in enumerate(pieces):
            model.saw_eos = False
            frames = list(model.iter_codes(text=text, voice=voice, max_new_tokens=2048,
                                          temperature=0.3, top_p=0.9, top_k=50, seed=42))
            if not frames:
                emit({"failure": "empty-segment"})
                raise RuntimeError("Model produced no speech for a script segment")
            if not model.saw_eos:
                emit({"failure": "token-budget"})
                raise RuntimeError("Speech did not reach EOS before its token/context limit")
            audio = model.decode_codes(np.stack(frames, axis=1))
            if not audio.size or not np.isfinite(audio).all() or np.max(np.abs(audio)) < 0.0003:
                emit({"failure": "empty-segment"})
                raise RuntimeError("Model produced invalid or silent speech")
            samples += audio.size
            if samples > sample_rate * 1800:
                raise RuntimeError("Speech exceeds its duration budget")
            output.write(audio)
            if index + 1 < len(pieces):
                pause = np.zeros(round(sample_rate * 0.12), dtype=np.float32)
                samples += pause.size
                output.write(pause)
            emit({"progress": {"fraction": 0.2 + 0.6 * (index + 1) / len(pieces), "stage": "speech"}})
    emit({"result": {"sampleRate": sample_rate, "samples": samples, "cachedVoice": cached_voice}})
else:
    raise ValueError("Unsupported managed action")
`;

// native/providers/audio-probe.ts
var AUDIO_PROBE_MESSAGES = [
  "参考素材中没有可用音轨，请选择音频或带声音的视频",
  "无法解析这段声音，请先提取为 WAV 参考录音后重试",
  "暂时无法测量这段录音时长，请先提取为 WAV 参考录音后重试",
  "声音时长检查超时，请先裁剪或提取参考录音后重试"
];
var [NO_AUDIO, UNSUPPORTED, NO_DURATION, TIMEOUT] = AUDIO_PROBE_MESSAGES;
var number = (value) => {
  if (typeof value !== "string" && typeof value !== "number" || value === "") return;
  const result = Number(value);
  return Number.isFinite(result) ? result : void 0;
};
var duration = (value) => {
  const result = number(value);
  return result !== void 0 && result > 0 ? result : void 0;
};
async function probeVoiceAudio(path, signal, options) {
  const deadline = AbortSignal.timeout(15e3);
  const bounded2 = combineAbortSignals([signal, deadline]);
  const source = ["-protocol_whitelist", "file,pipe", "-format_whitelist", options.formats];
  try {
    const raw = await runMediaProcess(
      options.ffprobePath ?? "ffprobe",
      [
        "-v",
        "error",
        ...source,
        "-select_streams",
        "a:0",
        "-show_entries",
        "format=duration,start_time:stream=codec_name,sample_rate,channels,duration,start_time",
        "-of",
        "json",
        path
      ],
      { signal: bounded2, maxStdoutBytes: 64 * 1024 }
    );
    const data = JSON.parse(raw.stdout.toString("utf8"));
    const audio = data.streams?.[0];
    if (!audio) throw new Error(NO_AUDIO);
    let durationSeconds = duration(audio.duration) ?? duration(data.format?.duration);
    if (durationSeconds !== void 0) return { audio, durationSeconds };
    let pending = "", bytes = 0, packets = 0;
    let firstTime, lastTime, lastDelta = 0, lastEnd = -Infinity;
    const consume = (chunk) => {
      bytes += chunk.length;
      if (bytes > 4 * 1024 * 1024) throw new Error(NO_DURATION);
      const lines = (pending + chunk.toString("utf8")).split(/\r?\n/);
      pending = lines.pop() ?? "";
      if (pending.length > 4096) throw new Error(NO_DURATION);
      for (const line of lines) {
        if (!line.trim()) continue;
        if (++packets > 2e4) throw new Error(NO_DURATION);
        const fields = Object.fromEntries(line.split("|").map((part) => part.split("=")));
        const time = number(fields.pts_time) ?? number(fields.dts_time);
        if (time === void 0) continue;
        firstTime = firstTime === void 0 ? time : Math.min(firstTime, time);
        if (lastTime !== void 0 && time > lastTime) lastDelta = time - lastTime;
        lastTime = time;
        lastEnd = Math.max(lastEnd, time + (duration(fields.duration_time) ?? lastDelta));
      }
    };
    await runMediaProcess(
      options.ffprobePath ?? "ffprobe",
      [
        "-v",
        "error",
        ...source,
        "-select_streams",
        "a:0",
        "-read_intervals",
        "%+31",
        "-show_entries",
        "packet=pts_time,dts_time,duration_time",
        "-of",
        "compact=p=0:nk=0",
        path
      ],
      { signal: bounded2, onStdout: consume }
    );
    consume(Buffer.from("\n"));
    const origin = number(audio.start_time) ?? number(data.format?.start_time) ?? firstTime;
    durationSeconds = origin === void 0 ? void 0 : duration(lastEnd - origin);
    if (durationSeconds === void 0) throw new Error(NO_DURATION);
    return { audio, durationSeconds };
  } catch (error) {
    if (signal.aborted) throw mediaAbortError();
    if (deadline.aborted) throw new Error(TIMEOUT, { cause: error });
    if (error instanceof Error && AUDIO_PROBE_MESSAGES.includes(error.message)) throw error;
    throw new Error(UNSUPPORTED, { cause: error });
  }
}

// native/providers/audio8.ts
var PACKAGES = [
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
  "pycparser==3.0"
];
var VOICE = { id: "reference", name: "我的声音 · 参考录音", language: "zh-CN" };
var MAX_SECONDS = 1800;
var MAX_BYTES = MAX_SECONDS * 48e3 * 2 + 4096;
var FORMATS = "wav,aiff,mp3,flac,ogg,mov,matroska,webm,aac,amr";
var owners = /* @__PURE__ */ new Set();
var generationQueues = /* @__PURE__ */ new Map();
function splitAudio8Text(text2) {
  const pieces = [];
  for (const sentence of text2.split(/(?<=[。！？!?；;\n])/u)) {
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
function audio8VoiceCacheKey(scope, audioSha256, referenceText) {
  const hash2 = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const scopeKey = hash2([scope.appId, resolve(scope.projectPath)]);
  return {
    scopeKey,
    voiceName: hash2([
      "audio8-reference-v1",
      scopeKey,
      AUDIO8_COMMIT,
      AUDIO8_REVISION,
      audioSha256,
      referenceText
    ])
  };
}
async function acquireGeneration(dir, context, signal) {
  const pending = generationQueues.get(dir);
  const previous = pending ?? Promise.resolve();
  let release2;
  const gate = new Promise((resolve7) => {
    release2 = resolve7;
  });
  const tail = previous.then(() => gate);
  generationQueues.set(dir, tail);
  void tail.then(() => {
    if (generationQueues.get(dir) === tail) generationQueues.delete(dir);
  });
  try {
    if (pending)
      await context.reportProgress({ stage: "waiting", message: "等待上一段本地配音完成" });
    await new Promise((resolve7, reject) => {
      const abort2 = () => {
        signal.removeEventListener("abort", abort2);
        reject(mediaAbortError());
      };
      signal.addEventListener("abort", abort2, { once: true });
      void previous.then(() => {
        signal.removeEventListener("abort", abort2);
        resolve7();
      });
      if (signal.aborted) abort2();
    });
    if (signal.aborted) throw mediaAbortError();
    return release2;
  } catch (error) {
    release2();
    throw error;
  }
}
function validateAudio8TtsInput(raw) {
  const speech = validateLocalTtsInput(raw);
  const input = raw;
  if (Array.from(speech.text).length > 2e3) throw new Error("声音克隆每次最多支持 2000 字");
  if (!/[\p{L}\p{N}]/u.test(speech.text)) throw new Error("配音文字至少需要一个可朗读的字词");
  const reference = validateLocalTtsInput({ text: input.referenceText });
  if (Array.from(reference.text).length > 1e3 || !/[\p{L}\p{N}]/u.test(reference.text))
    throw new Error("请填写参考录音的逐字稿，最多 1000 字");
  if (typeof input.referencePath !== "string" || !isAbsolute(input.referencePath) || input.referencePath.includes("\0"))
    throw new Error("参考录音必须来自宿主已授权的本地素材");
  return {
    text: speech.text,
    referencePath: input.referencePath,
    referenceText: reference.text,
    rate: speech.rate
  };
}
var SCRIPT_HASH = createHash("sha256").update(AUDIO8_SCRIPT).digest("hex");
async function readJson(path) {
  if ((await stat(path)).size > 16 * 1024) throw new Error("Runtime metadata exceeds its budget");
  return JSON.parse(await readFile(path, "utf8"));
}
async function saveJson(path, value) {
  const partial = `${path}-${randomUUID()}.partial`;
  try {
    await writeFile(partial, JSON.stringify(value), { mode: 384 });
    await rename(partial, path);
  } finally {
    await rm(partial, { force: true });
  }
}
async function digest(path, signal) {
  const hash2 = createHash("sha256");
  for await (const chunk of createReadStream(path, { signal })) hash2.update(chunk);
  return hash2.digest("hex");
}
async function acquireSetupLock(path) {
  const candidate = `${path}-${randomUUID()}.candidate`;
  let published = false;
  try {
    await writeFile(candidate, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), {
      flag: "wx",
      mode: 384
    });
    try {
      await link(candidate, path);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const before = await stat(path);
      const existing = await readJson(path).catch(() => null);
      if (Number.isSafeInteger(existing?.pid) && existing.pid > 0) {
        let alive2 = false;
        try {
          process.kill(existing.pid, 0);
          alive2 = true;
        } catch (error2) {
          if (error2.code !== "ESRCH") alive2 = true;
        }
        if (alive2) throw new Error("另一个宿主正在准备本地声音服务", { cause: error });
      } else if (Date.now() - before.mtimeMs < 12e4) {
        throw new Error("本地声音准备锁正在初始化，请稍候再试", { cause: error });
      }
      const current = await stat(path);
      if (current.ino !== before.ino || current.mtimeMs !== before.mtimeMs || current.size !== before.size)
        throw new Error("声音准备锁已更新，请稍候再试", { cause: error });
      await rm(path);
      await link(candidate, path);
    }
    published = true;
  } finally {
    await rm(candidate, { force: true }).catch(async (error) => {
      if (published) await rm(path, { force: true }).catch(() => {
      });
      throw error;
    });
  }
}
async function cleanupSetup(paths, lockPath, signal) {
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
function createAudio8TtsProvider(options) {
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
  const env = (online = false) => {
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
      DO_NOT_TRACK: "1"
    };
  };
  async function status(signal) {
    if (signal?.aborted) throw mediaAbortError();
    const base = {
      id: "audio8-tts",
      name: "Audio8-TTS · 本人声音克隆",
      mode: "offline",
      state: "not-installed",
      available: false,
      installed: false,
      voices: [{ ...VOICE }],
      defaultVoiceId: VOICE.id,
      downloadBytes: 1250 * 1048576,
      requiredDiskBytes: 4 * 1024 ** 3
    };
    if (process.platform !== "darwin" || process.arch !== "arm64")
      return {
        ...base,
        state: "unavailable",
        reason: "本地声音克隆需要 Apple Silicon Mac（M 系列芯片）"
      };
    if (totalmem() < 4 * 1024 ** 3)
      return { ...base, state: "unavailable", reason: "本地声音克隆至少需要 4 GB 内存" };
    base.installed = await stat(python).then(
      (s) => s.isFile(),
      () => false
    );
    if (owners.has(dir))
      return { ...base, state: "installing", reason: "正在准备并验证本地声音克隆" };
    try {
      const manifest = await readJson(manifestPath);
      if (!base.installed || manifest.scriptHash !== SCRIPT_HASH || manifest.revision !== AUDIO8_REVISION || manifest.commit !== AUDIO8_COMMIT || JSON.stringify(manifest.packages) !== JSON.stringify(PACKAGES) || await readFile(script, "utf8") !== AUDIO8_SCRIPT)
        throw new Error("Incomplete runtime");
      for (const item of AUDIO8_RESOURCES)
        if ((await stat(join(dir, item.kind, item.path))).size !== item.bytes)
          throw new Error("Incomplete model");
      if (manifest.state !== "ready") throw new Error("Runtime not validated");
      return {
        ...base,
        state: "ready",
        available: true,
        verifiedAt: manifest.verifiedAt,
        version: PACKAGES.join("; ")
      };
    } catch {
      const failure = await readJson(failurePath).catch(() => null);
      const reason = typeof failure?.reason === "string" ? failure.reason : void 0;
      return {
        ...base,
        state: reason ? "failed" : base.installed ? "needs-setup" : "not-installed",
        reason: reason ?? "首次需下载约 1.2 GB；准备完成后，参考录音与配音均在本机处理"
      };
    }
  }
  async function execute(data, context, signal) {
    await mkdir(context.workDir, { recursive: true });
    const request = join(context.workDir, `audio8-request-${randomUUID()}.json`);
    await writeFile(
      request,
      JSON.stringify({ ...data, modelPath, codePath, threads: Math.min(5, cpus().length) }),
      { mode: 384 }
    );
    let pending = "";
    const decoder = new StringDecoder("utf8");
    let result;
    let failure;
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
              progress = progress.then(
                () => context.reportProgress({
                  fraction: value.progress.fraction,
                  stage: value.progress.stage === "register" ? "register" : "speech",
                  message: value.progress.stage === "register" ? "正在保存参考音色，后续配音会自动复用" : "正在本机生成你的声音"
                })
              );
              void progress.catch(() => {
              });
            }
          }
        }
      });
      await progress;
      if (!result) throw new Error("Audio8 runtime did not return a complete result");
      return result;
    } catch (error) {
      if (failure && !signal.aborted)
        throw new Error(
          failure === "token-budget" ? "部分配音未完整结束，请缩短参考逐字稿或文稿后重试" : "有一段文字未生成有效人声，请调整这段文稿后重试",
          { cause: error }
        );
      throw error;
    } finally {
      await progress.catch(() => {
      });
      await rm(request, { force: true });
    }
  }
  async function downloadResource2(resource, signal, report2) {
    const path = join(dir, resource.kind, resource.path);
    const valid = await stat(path).then(
      async (s) => s.size === resource.bytes && await digest(path, signal) === resource.sha256,
      () => false
    );
    if (valid) {
      await report2(resource.bytes);
      return;
    }
    await mkdir(resolve(path, ".."), { recursive: true, mode: 448 });
    const partial = `${path}-${randomUUID()}.partial`;
    const handle = await open(partial, "wx", 384);
    try {
      const response = await fetch(resource.url, { signal });
      if (!response.ok || !response.body || !response.url.startsWith("https://"))
        throw new Error("Audio8 resource download failed");
      const hash2 = createHash("sha256");
      let bytes = 0;
      let reportedAt = 0;
      const reader = response.body.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > resource.bytes) throw new Error("Audio8 download exceeds expected size");
          hash2.update(chunk.value);
          let offset = 0;
          while (offset < chunk.value.byteLength) {
            const written = await handle.write(chunk.value.subarray(offset));
            if (!written.bytesWritten) throw new Error("Audio8 download could not be saved");
            offset += written.bytesWritten;
          }
          if (Date.now() - reportedAt >= 1e3) {
            await report2(bytes);
            reportedAt = Date.now();
          }
        }
      } finally {
        await reader.cancel().catch(() => {
        });
      }
      if (bytes !== resource.bytes || hash2.digest("hex") !== resource.sha256)
        throw new Error("Audio8 resource integrity check failed");
      if (signal.aborted) throw mediaAbortError();
      await handle.close();
      await rename(partial, path);
      await report2(bytes);
    } finally {
      await handle.close().catch(() => {
      });
      await rm(partial, { force: true });
    }
  }
  async function verifyResources(signal, hashes) {
    for (const resource of AUDIO8_RESOURCES) {
      const path = join(dir, resource.kind, resource.path);
      if ((await stat(path)).size !== resource.bytes || hashes && "sha256" in resource && await digest(path, signal) !== resource.sha256)
        throw new Error("本地模型校验失败，请重新准备声音克隆");
    }
  }
  async function probe(path, signal, formats = FORMATS) {
    return probeVoiceAudio(path, signal, { ffprobePath: options.ffprobePath, formats });
  }
  async function audible(path, signal) {
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
        "-"
      ],
      { signal }
    );
    const match = /max_volume: ([-\d.]+) dB/.exec(raw.stderr);
    if (!match || Number(match[1]) < -70) throw new Error("录音中没有可听见的声音");
  }
  async function render(input, context, signal) {
    await mkdir(context.workDir, { recursive: true });
    await mkdir(context.outputDir, { recursive: true });
    const nonce = randomUUID();
    const reference = join(context.workDir, `audio8-reference-${nonce}.wav`);
    const raw = join(context.workDir, `audio8-raw-${nonce}.wav`);
    const partial = join(context.outputDir, `speech-${nonce}.partial.wav`);
    const output = join(context.outputDir, `speech-${nonce}.wav`);
    let complete = false;
    let voicesPath;
    let voiceName;
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
          reference
        ],
        { signal }
      );
      await audible(reference, signal);
      const cache = audio8VoiceCacheKey(
        context.scope,
        await digest(reference, signal),
        input.referenceText
      );
      voicesPath = join(dir, "voices", cache.scopeKey);
      voiceName = cache.voiceName;
      await mkdir(voicesPath, { recursive: true, mode: 448 });
      await context.reportProgress({
        fraction: 0.15,
        stage: "speech",
        message: "正在加载本地模型；首次生成可能需要几分钟"
      });
      await execute(
        {
          action: "generate",
          pieces: splitAudio8Text(input.text),
          referencePath: reference,
          referenceText: input.referenceText,
          voicesPath,
          voiceName,
          output: raw
        },
        context,
        signal
      );
      await context.reportProgress({
        fraction: 0.86,
        stage: "speech",
        message: "正在统一配音格式并检查声音"
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
          partial
        ],
        { signal }
      );
      const result = await probe(partial, signal, "wav");
      if (result.audio.codec_name !== "pcm_s16le" || Number(result.audio.sample_rate) !== 48e3 || result.audio.channels !== 1 || result.durationSeconds > MAX_SECONDS || (await stat(partial)).size >= MAX_BYTES)
        throw new Error("未生成合格的 48 kHz WAV 配音");
      await audible(partial, signal);
      if (signal.aborted) throw mediaAbortError();
      await rename(partial, output);
      await context.reportProgress({
        fraction: 1,
        stage: "ready",
        message: "已完成本地声音克隆配音"
      });
      if (signal.aborted) throw mediaAbortError();
      complete = true;
      return { path: output, durationSeconds: result.durationSeconds };
    } finally {
      const cleanup = [reference, raw, partial, ...!complete ? [output] : []].map((path) => ({
        path,
        recursive: false
      }));
      if (voicesPath && voiceName) {
        const incomplete = await readdir(voicesPath).catch(() => []);
        cleanup.push(
          ...incomplete.filter((name) => name.startsWith(`.${voiceName}.`)).map((name) => ({ path: join(voicesPath, name), recursive: true }))
        );
      }
      await Promise.all(cleanup.map(({ path, recursive }) => rm(path, { recursive, force: true })));
    }
  }
  async function setup(context) {
    if (context.signal.aborted) throw mediaAbortError();
    const initial = await status();
    if (initial.state === "unavailable") throw new Error(initial.reason);
    if (owners.has(dir) || generationQueues.has(dir))
      throw new Error("本地声音服务正在运行，请等待或取消当前任务");
    owners.add(dir);
    const deadline = AbortSignal.timeout(40 * 6e4);
    const signal = combineAbortSignals([context.signal, deadline]);
    const lockPath = join(dir, "setup.lock");
    let lock = false;
    const cleanup = [];
    try {
      await mkdir(dir, { recursive: true, mode: 448 });
      await acquireSetupLock(lockPath);
      lock = true;
      const disk = await statfs(dir);
      if (disk.bavail * disk.bsize < initial.requiredDiskBytes)
        throw new Error("空间不足，准备声音克隆至少需要 4 GB 可用空间");
      await Promise.all([
        runMediaProcess(options.ffmpegPath ?? "ffmpeg", ["-version"], { signal }),
        runMediaProcess(options.ffprobePath ?? "ffprobe", ["-version"], { signal })
      ]);
      await writeFile(script, AUDIO8_SCRIPT, { mode: 384 });
      await context.reportProgress({
        fraction: 0.02,
        stage: "setup",
        message: "准备独立 Python 环境与本地声音克隆，预计下载约 1.2 GB"
      });
      let installed = false;
      try {
        const probe2 = await execute(
          { action: "probe", packageNames: PACKAGES.map((p) => p.split("==")[0]) },
          context,
          signal
        );
        installed = JSON.stringify(probe2.packages) === JSON.stringify(PACKAGES);
      } catch (error) {
        if (signal.aborted) throw error;
      }
      if (!installed) {
        await runMediaProcess(
          options.uvPath ?? "uv",
          ["venv", "--clear", "--no-config", "--python", "3.12", join(dir, "venv")],
          { signal, env: env(true) }
        );
        await context.reportProgress({
          fraction: 0.08,
          stage: "install",
          message: "正在安装固定版本的本地推理依赖"
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
            ...PACKAGES
          ],
          { signal, env: env(true) }
        );
        const probe2 = await execute(
          { action: "probe", packageNames: PACKAGES.map((p) => p.split("==")[0]) },
          context,
          signal
        );
        if (JSON.stringify(probe2.packages) !== JSON.stringify(PACKAGES))
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
        for (const item of AUDIO8_RESOURCES) {
          const path = join(dir, item.kind, item.path);
          const valid = await stat(path).then(
            async (s) => s.size === item.bytes && (!("sha256" in item) || await digest(path, signal) === item.sha256),
            () => false
          );
          if (!valid) await rm(path, { force: true });
        }
        await context.reportProgress({
          fraction: 0.2,
          stage: "download",
          message: "正在下载固定版本的 Audio8 模型与声音编码器（约 1 GB）"
        });
        const total = AUDIO8_RESOURCES.reduce((sum, item) => sum + item.bytes, 0);
        let completed = 0;
        for (const item of AUDIO8_RESOURCES) {
          await downloadResource2(item, signal, async (bytes) => {
            const downloaded = completed + bytes;
            await context.reportProgress({
              fraction: 0.2 + 0.45 * downloaded / total,
              stage: "download",
              message: `正在下载 Audio8（${Math.floor(downloaded / 1048576)} / ${Math.ceil(total / 1048576)} MB）`
            });
          });
          completed += item.bytes;
        }
        await verifyResources(signal, true);
      }
      await context.reportProgress({
        fraction: 0.7,
        stage: "verify",
        message: "正在用系统测试音验证真实离线推理"
      });
      await mkdir(context.workDir, { recursive: true });
      const reference = join(context.workDir, `audio8-setup-${randomUUID()}.aiff`);
      const transcript = join(context.workDir, `audio8-setup-${randomUUID()}.txt`);
      cleanup.push(reference, transcript);
      const referenceText = "This is a local voice test. Clear speech helps prepare the audio model.";
      await writeFile(transcript, referenceText, { mode: 384 });
      await runMediaProcess("/usr/bin/say", ["-r", "165", "-f", transcript, "-o", reference], {
        signal
      });
      const sample = await render(
        { text: "你好，这是本地声音克隆测试。", referencePath: reference, referenceText, rate: 1 },
        { ...context, scope: { appId: "__audio8-setup", projectPath: dir } },
        signal
      );
      cleanup.push(sample.path);
      if (signal.aborted) throw mediaAbortError();
      await saveJson(manifestPath, {
        scriptHash: SCRIPT_HASH,
        revision: AUDIO8_REVISION,
        commit: AUDIO8_COMMIT,
        packages: PACKAGES,
        state: "ready",
        verifiedAt: Date.now()
      });
      await rm(failurePath, { force: true });
      await context.reportProgress({
        fraction: 1,
        stage: "ready",
        message: "本地声音克隆已通过真实离线推理验证"
      });
      if (signal.aborted) throw mediaAbortError();
    } catch (error) {
      if (!lock) {
        if (context.signal.aborted) throw mediaAbortError();
        const message = error instanceof Error ? error.message : "";
        const safe = [
          "本地声音准备锁正在初始化，请稍候再试",
          "另一个宿主正在准备本地声音服务",
          "声音准备锁已更新，请稍候再试"
        ];
        throw new Error(
          safe.includes(message) ? message : "Audio8 无法创建独立环境，请检查磁盘空间和目录权限",
          { cause: error }
        );
      }
      const reason = signal.aborted ? context.signal.aborted ? "声音克隆准备已取消，可以重新准备" : "声音克隆准备超时，请检查网络后重试" : "Audio8 声音克隆准备失败；需要 uv、FFmpeg、完整模型与可用空间，请检查网络和本机环境后重试";
      await saveJson(failurePath, { reason, at: Date.now() }).catch(() => {
      });
      await rm(manifestPath, { force: true }).catch(() => {
      });
      throw context.signal.aborted ? mediaAbortError() : new Error(reason, { cause: error });
    } finally {
      try {
        await cleanupSetup(cleanup, lock ? lockPath : void 0, context.signal);
      } finally {
        owners.delete(dir);
      }
    }
    return status();
  }
  async function generate(raw, context) {
    const input = validateAudio8TtsInput(raw);
    if (context.signal.aborted) throw mediaAbortError();
    const runtime = await status(context.signal);
    if (!runtime.available) throw new Error(runtime.reason ?? "请先准备本地声音克隆");
    if (owners.has(dir)) throw new Error("本地声音服务正在运行，请等待或取消当前任务");
    const deadline = AbortSignal.timeout(20 * 6e4);
    const signal = combineAbortSignals([context.signal, deadline]);
    let release2;
    try {
      release2 = await acquireGeneration(dir, context, signal);
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
        sampleRate: 48e3,
        channels: 1,
        cached: false
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
        "部分配音未完整结束，请缩短参考逐字稿或文稿后重试",
        "有一段文字未生成有效人声，请调整这段文稿后重试"
      ];
      throw new Error(
        safeMessages.includes(message) ? message : "本地声音生成失败，请检查参考素材与逐字稿，或缩短文稿后重试",
        { cause: error }
      );
    } finally {
      release2?.();
    }
  }
  return { status, setup, generate };
}

// native/providers/qwen.ts
import { createHash as createHash2, randomUUID as randomUUID2 } from "node:crypto";
import { createReadStream as createReadStream2 } from "node:fs";
import { mkdir as mkdir2, open as open2, readFile as readFile2, rename as rename2, rm as rm2, stat as stat2, statfs as statfs2, writeFile as writeFile2 } from "node:fs/promises";
import { totalmem as totalmem2 } from "node:os";
import { isAbsolute as isAbsolute2, join as join2, resolve as resolve2 } from "node:path";
import { StringDecoder as StringDecoder2 } from "node:string_decoder";
var MODEL = "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit";
var REVISION = "50f45ef0047cde7e84c2ef04326acb8ada2436a7";
var PACKAGES2 = [
  "mlx-audio==0.5.3",
  "mlx==0.32.2",
  "transformers==5.17.0",
  "huggingface-hub==1.31.0",
  "soundfile==0.14.0"
];
var VOICE2 = { id: "reference", name: "我的声音 · 参考录音", language: "zh-CN" };
var MAX_SECONDS2 = 1800;
var MAX_BYTES2 = MAX_SECONDS2 * 48e3 * 2 + 4096;
var FORMATS2 = "wav,aiff,mp3,flac,ogg,mov,matroska,webm,aac,amr";
var owners2 = /* @__PURE__ */ new Set();
var generationQueues2 = /* @__PURE__ */ new Map();
async function acquireGeneration2(dir, context, signal) {
  const pending = generationQueues2.get(dir);
  const previous = pending ?? Promise.resolve();
  let release2;
  const gate = new Promise((resolve7) => {
    release2 = resolve7;
  });
  const tail = previous.then(() => gate);
  generationQueues2.set(dir, tail);
  void tail.then(() => {
    if (generationQueues2.get(dir) === tail) generationQueues2.delete(dir);
  });
  try {
    if (pending)
      await context.reportProgress({ stage: "waiting", message: "等待上一段本地配音完成" });
    await new Promise((resolve7, reject) => {
      const abort2 = () => {
        signal.removeEventListener("abort", abort2);
        reject(mediaAbortError());
      };
      signal.addEventListener("abort", abort2, { once: true });
      void previous.then(() => {
        signal.removeEventListener("abort", abort2);
        resolve7();
      });
      if (signal.aborted) abort2();
    });
    if (signal.aborted) throw mediaAbortError();
    return release2;
  } catch (error) {
    release2();
    throw error;
  }
}
var RESOURCES = [
  {
    path: "config.json",
    bytes: 5522,
    sha256: "b404fb6f99dac6f7a81f3a03af5675b131ecf9936ac75a7c9d75e54044600044"
  },
  {
    path: "generation_config.json",
    bytes: 245,
    sha256: "f1b90b4513f3b34c62851049e2492d7b4c5940daf1276f89c82b8ef04127f3aa"
  },
  {
    path: "merges.txt",
    bytes: 1671839,
    sha256: "599bab54075088774b1733fde865d5bd747cbcc7a547c5bc12610e874e26f5e3"
  },
  {
    path: "model.safetensors",
    bytes: 1304461214,
    sha256: "9488e7005cc0cf44f8804eb543668d0763bb1c649ce6f1eddc663519524b3182"
  },
  {
    path: "model.safetensors.index.json",
    bytes: 77731,
    sha256: "7829f1cc24f5cbd7d7a3ba888bb08c7cf52d82ba79a4f0f3756d41f8bf5e52b4"
  },
  {
    path: "preprocessor_config.json",
    bytes: 127,
    sha256: "efdde1022ea9d76928bf7a9cd53139138f5ba2e466e837f08f6105ab1af1c119"
  },
  {
    path: "speech_tokenizer/config.json",
    bytes: 2336,
    sha256: "ee65bb901c876664ab8707c487157aa1a6ee57c65969b28fb5ec9dc211e68167"
  },
  {
    path: "speech_tokenizer/configuration.json",
    bytes: 76,
    sha256: "6bc26d64eb5024b4d1dab5a52371958b429256d6c9d59787f1f5294a54e0cebd"
  },
  {
    path: "speech_tokenizer/model.safetensors",
    bytes: 682293092,
    sha256: "836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258"
  },
  {
    path: "speech_tokenizer/preprocessor_config.json",
    bytes: 234,
    sha256: "fcb3805e597e786d4067706e602f6688524640f8d3396790e2e09b5942fcbdfb"
  },
  {
    path: "tokenizer_config.json",
    bytes: 7344,
    sha256: "dc3c31c3bdaedd5016382bb3cbe07323026775ad51f5a4fb564505992ae4a670"
  },
  {
    path: "vocab.json",
    bytes: 2776833,
    sha256: "ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910"
  }
];
function validateQwenTtsInput(raw) {
  const speech = validateLocalTtsInput(raw);
  const input = raw;
  if (Array.from(speech.text).length > 2e3) throw new Error("声音克隆每次最多支持 2000 字");
  if (!/[\p{L}\p{N}]/u.test(speech.text)) throw new Error("配音文字至少需要一个可朗读的字词");
  const reference = validateLocalTtsInput({ text: input.referenceText });
  if (Array.from(reference.text).length > 1e3 || !/[\p{L}\p{N}]/u.test(reference.text))
    throw new Error("请填写参考录音的逐字稿，最多 1000 字");
  if (typeof input.referencePath !== "string" || !isAbsolute2(input.referencePath) || input.referencePath.includes("\0"))
    throw new Error("参考录音必须来自宿主已授权的本地素材");
  return {
    text: speech.text,
    referencePath: input.referencePath,
    referenceText: reference.text,
    rate: speech.rate
  };
}
var SCRIPT = String.raw`
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
var SCRIPT_HASH2 = createHash2("sha256").update(SCRIPT).digest("hex");
async function readJson2(path) {
  if ((await stat2(path)).size > 16 * 1024) throw new Error("Runtime metadata exceeds its budget");
  return JSON.parse(await readFile2(path, "utf8"));
}
async function saveJson2(path, value) {
  const partial = `${path}-${randomUUID2()}.partial`;
  try {
    await writeFile2(partial, JSON.stringify(value), { mode: 384 });
    await rename2(partial, path);
  } finally {
    await rm2(partial, { force: true });
  }
}
async function digest2(path, signal) {
  const hash2 = createHash2("sha256");
  for await (const chunk of createReadStream2(path, { signal })) hash2.update(chunk);
  return hash2.digest("hex");
}
function createQwenTtsProvider(options) {
  if (!isAbsolute2(options.runtimeDir))
    throw new Error("TTS runtimeDir must be an absolute Host path");
  const root = resolve2(options.runtimeDir);
  const dir = join2(root, "qwen3-tts");
  const python = join2(dir, "venv", "bin", "python");
  const script = join2(dir, "runner.py");
  const modelPath = join2(dir, "model");
  const manifestPath = join2(dir, "runtime.json");
  const failurePath = join2(dir, "failure.json");
  const env = (online = false) => {
    const clean = { ...process.env };
    for (const key of Object.keys(clean))
      if (/^(UV_|PIP_|PYTHON|VIRTUAL_ENV|CONDA|HF_|HUGGING|TRANSFORMERS_|MLX_)/i.test(key))
        delete clean[key];
    return {
      ...clean,
      UV_NO_CONFIG: "1",
      UV_CACHE_DIR: join2(root, "package-cache"),
      UV_PYTHON_INSTALL_DIR: join2(root, "python"),
      PYTHONNOUSERSITE: "1",
      HF_HOME: join2(dir, "hub-cache"),
      HF_HUB_DISABLE_IMPLICIT_TOKEN: "1",
      HF_HUB_DISABLE_TELEMETRY: "1",
      HF_HUB_OFFLINE: online ? "0" : "1",
      TRANSFORMERS_OFFLINE: online ? "0" : "1",
      DO_NOT_TRACK: "1"
    };
  };
  async function status(signal) {
    if (signal?.aborted) throw mediaAbortError();
    const base = {
      id: "qwen3-tts",
      name: "Qwen3-TTS · 本人声音克隆",
      mode: "offline",
      state: "not-installed",
      available: false,
      installed: false,
      voices: [{ ...VOICE2 }],
      defaultVoiceId: VOICE2.id,
      downloadBytes: 2400 * 1048576,
      requiredDiskBytes: 6 * 1024 ** 3
    };
    if (process.platform !== "darwin" || process.arch !== "arm64")
      return {
        ...base,
        state: "unavailable",
        reason: "本地声音克隆需要 Apple Silicon Mac（M 系列芯片）"
      };
    if (totalmem2() < 8 * 1024 ** 3)
      return { ...base, state: "unavailable", reason: "本地声音克隆至少需要 8 GB 内存" };
    base.installed = await stat2(python).then(
      (s) => s.isFile(),
      () => false
    );
    if (owners2.has(dir))
      return { ...base, state: "installing", reason: "正在准备并验证本地声音克隆" };
    try {
      const manifest = await readJson2(manifestPath);
      if (!base.installed || manifest.scriptHash !== SCRIPT_HASH2 || manifest.revision !== REVISION || JSON.stringify(manifest.packages) !== JSON.stringify(PACKAGES2) || await readFile2(script, "utf8") !== SCRIPT)
        throw new Error("Incomplete runtime");
      for (const item of RESOURCES)
        if ((await stat2(join2(modelPath, item.path))).size !== item.bytes)
          throw new Error("Incomplete model");
      if (manifest.state !== "ready") throw new Error("Runtime not validated");
      return {
        ...base,
        state: "ready",
        available: true,
        verifiedAt: manifest.verifiedAt,
        version: PACKAGES2.join("; ")
      };
    } catch {
      const failure = await readJson2(failurePath).catch(() => null);
      const reason = typeof failure?.reason === "string" ? failure.reason : void 0;
      return {
        ...base,
        state: reason ? "failed" : base.installed ? "needs-setup" : "not-installed",
        reason: reason ?? "首次需下载约 2.4 GB；准备完成后，参考录音与配音均在本机处理"
      };
    }
  }
  async function execute(data, context, signal) {
    await mkdir2(context.workDir, { recursive: true });
    const request = join2(context.workDir, `qwen-request-${randomUUID2()}.json`);
    await writeFile2(request, JSON.stringify({ ...data, modelPath }), { mode: 384 });
    let pending = "";
    const decoder = new StringDecoder2("utf8");
    let result;
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
              progress = progress.then(
                () => context.reportProgress({
                  fraction: value.progress.fraction,
                  stage: "speech",
                  message: "正在本机生成你的声音"
                })
              );
              void progress.catch(() => {
              });
            }
          }
        }
      });
      await progress;
      if (!result) throw new Error("Qwen runtime did not return a complete result");
      return result;
    } finally {
      await progress.catch(() => {
      });
      await rm2(request, { force: true });
    }
  }
  async function verifyResources(signal, hashes) {
    for (const resource of RESOURCES) {
      const path = join2(modelPath, resource.path);
      if ((await stat2(path)).size !== resource.bytes || hashes && "sha256" in resource && await digest2(path, signal) !== resource.sha256)
        throw new Error("本地模型校验失败，请重新准备声音克隆");
    }
  }
  async function probe(path, signal, formats = FORMATS2) {
    return probeVoiceAudio(path, signal, { ffprobePath: options.ffprobePath, formats });
  }
  async function audible(path, signal) {
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
        "-"
      ],
      { signal }
    );
    const match = /max_volume: ([-\d.]+) dB/.exec(raw.stderr);
    if (!match || Number(match[1]) < -70) throw new Error("录音中没有可听见的声音");
  }
  async function render(input, context, signal) {
    await mkdir2(context.workDir, { recursive: true });
    await mkdir2(context.outputDir, { recursive: true });
    const nonce = randomUUID2();
    const reference = join2(context.workDir, `qwen-reference-${nonce}.wav`);
    const raw = join2(context.workDir, `qwen-raw-${nonce}.wav`);
    const partial = join2(context.outputDir, `speech-${nonce}.partial.wav`);
    const output = join2(context.outputDir, `speech-${nonce}.wav`);
    let complete = false;
    try {
      const source = await stat2(input.referencePath);
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
          FORMATS2,
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
          reference
        ],
        { signal }
      );
      await audible(reference, signal);
      await context.reportProgress({
        fraction: 0.15,
        stage: "speech",
        message: "正在加载本地模型；首次生成可能需要几分钟"
      });
      await execute(
        {
          action: "generate",
          text: input.text,
          referencePath: reference,
          referenceText: input.referenceText,
          output: raw
        },
        context,
        signal
      );
      await context.reportProgress({
        fraction: 0.86,
        stage: "speech",
        message: "正在统一配音格式并检查声音"
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
          String(MAX_BYTES2),
          partial
        ],
        { signal }
      );
      const result = await probe(partial, signal, "wav");
      if (result.audio.codec_name !== "pcm_s16le" || Number(result.audio.sample_rate) !== 48e3 || result.audio.channels !== 1 || result.durationSeconds > MAX_SECONDS2 || (await stat2(partial)).size >= MAX_BYTES2)
        throw new Error("未生成合格的 48 kHz WAV 配音");
      await audible(partial, signal);
      if (signal.aborted) throw mediaAbortError();
      await rename2(partial, output);
      await context.reportProgress({
        fraction: 1,
        stage: "ready",
        message: "已完成本地声音克隆配音"
      });
      if (signal.aborted) throw mediaAbortError();
      complete = true;
      return { path: output, durationSeconds: result.durationSeconds };
    } finally {
      await Promise.all(
        [reference, raw, partial, ...!complete ? [output] : []].map(
          (path) => rm2(path, { force: true })
        )
      );
    }
  }
  async function setup(context) {
    if (context.signal.aborted) throw mediaAbortError();
    const initial = await status();
    if (initial.state === "unavailable") throw new Error(initial.reason);
    if (owners2.has(dir) || generationQueues2.has(dir))
      throw new Error("本地声音服务正在运行，请等待或取消当前任务");
    owners2.add(dir);
    const deadline = AbortSignal.timeout(40 * 6e4);
    const signal = combineAbortSignals([context.signal, deadline]);
    const lockPath = join2(dir, "setup.lock");
    let lock;
    const cleanup = [];
    try {
      await mkdir2(dir, { recursive: true });
      try {
        lock = await open2(lockPath, "wx", 384);
      } catch {
        const existing = await readJson2(lockPath).catch(() => null);
        if (!Number.isSafeInteger(existing?.pid) || existing.pid <= 0)
          throw new Error("本地声音准备锁正在初始化或需要宿主重启后检查");
        let alive2 = false;
        try {
          process.kill(existing.pid, 0);
          alive2 = true;
        } catch (error) {
          if (error.code !== "ESRCH") alive2 = true;
        }
        if (alive2) throw new Error("另一个宿主正在准备本地声音服务");
        await rm2(lockPath, { force: true });
        lock = await open2(lockPath, "wx", 384);
      }
      await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
      const disk = await statfs2(dir);
      if (disk.bavail * disk.bsize < initial.requiredDiskBytes)
        throw new Error("空间不足，准备声音克隆至少需要 6 GB 可用空间");
      await Promise.all([
        runMediaProcess(options.ffmpegPath ?? "ffmpeg", ["-version"], { signal }),
        runMediaProcess(options.ffprobePath ?? "ffprobe", ["-version"], { signal })
      ]);
      await writeFile2(script, SCRIPT, { mode: 384 });
      await context.reportProgress({
        fraction: 0.02,
        stage: "setup",
        message: "准备独立 Python 环境与本地声音克隆，预计下载约 2.4 GB"
      });
      let installed = false;
      try {
        const probe2 = await execute(
          { action: "probe", packageNames: PACKAGES2.map((p) => p.split("==")[0]) },
          context,
          signal
        );
        installed = JSON.stringify(probe2.packages) === JSON.stringify(PACKAGES2);
      } catch (error) {
        if (signal.aborted) throw error;
      }
      if (!installed) {
        await runMediaProcess(
          options.uvPath ?? "uv",
          ["venv", "--clear", "--no-config", "--python", "3.12", join2(dir, "venv")],
          { signal, env: env(true) }
        );
        await context.reportProgress({
          fraction: 0.08,
          stage: "install",
          message: "正在安装固定版本的本地推理依赖"
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
            ...PACKAGES2
          ],
          { signal, env: env(true) }
        );
        const probe2 = await execute(
          { action: "probe", packageNames: PACKAGES2.map((p) => p.split("==")[0]) },
          context,
          signal
        );
        if (JSON.stringify(probe2.packages) !== JSON.stringify(PACKAGES2))
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
        for (const item of RESOURCES) {
          const path = join2(modelPath, item.path);
          const valid = await stat2(path).then(
            async (s) => s.size === item.bytes && (!("sha256" in item) || await digest2(path, signal) === item.sha256),
            () => false
          );
          if (!valid) await rm2(path, { force: true });
        }
        await context.reportProgress({
          fraction: 0.2,
          stage: "download",
          message: "正在下载固定版本的 Qwen3 模型与声音编码器（约 2 GB）"
        });
        await execute(
          {
            action: "download",
            modelId: MODEL,
            revision: REVISION,
            files: RESOURCES.map((r) => r.path)
          },
          context,
          signal
        );
        await verifyResources(signal, true);
      }
      await context.reportProgress({
        fraction: 0.7,
        stage: "verify",
        message: "正在用系统测试音验证真实离线推理"
      });
      await mkdir2(context.workDir, { recursive: true });
      const reference = join2(context.workDir, `qwen-setup-${randomUUID2()}.aiff`);
      const transcript = join2(context.workDir, `qwen-setup-${randomUUID2()}.txt`);
      cleanup.push(reference, transcript);
      const referenceText = "This is a local voice test. Clear speech helps prepare the audio model.";
      await writeFile2(transcript, referenceText, { mode: 384 });
      await runMediaProcess("/usr/bin/say", ["-r", "165", "-f", transcript, "-o", reference], {
        signal
      });
      const sample = await render(
        { text: "你好，这是本地声音克隆测试。", referencePath: reference, referenceText, rate: 1 },
        context,
        signal
      );
      cleanup.push(sample.path);
      if (signal.aborted) throw mediaAbortError();
      await saveJson2(manifestPath, {
        scriptHash: SCRIPT_HASH2,
        revision: REVISION,
        packages: PACKAGES2,
        state: "ready",
        verifiedAt: Date.now()
      });
      await rm2(failurePath, { force: true });
      await context.reportProgress({
        fraction: 1,
        stage: "ready",
        message: "本地声音克隆已通过真实离线推理验证"
      });
    } catch (error) {
      if (!lock) throw error;
      const reason = signal.aborted ? context.signal.aborted ? "声音克隆准备已取消，可以重新准备" : "声音克隆准备超时，请检查网络后重试" : "Qwen3 声音克隆准备失败；需要 uv、FFmpeg、完整模型与可用空间，请检查网络和本机环境后重试";
      await saveJson2(failurePath, { reason, at: Date.now() }).catch(() => {
      });
      await rm2(manifestPath, { force: true });
      throw context.signal.aborted ? mediaAbortError() : new Error(reason, { cause: error });
    } finally {
      try {
        try {
          await Promise.all(cleanup.map((path) => rm2(path, { force: true })));
        } finally {
          if (lock) {
            try {
              await lock.close();
            } finally {
              await rm2(lockPath, { force: true });
            }
          }
        }
      } finally {
        owners2.delete(dir);
      }
    }
    return status();
  }
  async function generate(raw, context) {
    const input = validateQwenTtsInput(raw);
    if (context.signal.aborted) throw mediaAbortError();
    const runtime = await status(context.signal);
    if (!runtime.available) throw new Error(runtime.reason ?? "请先准备本地声音克隆");
    if (owners2.has(dir)) throw new Error("本地声音服务正在运行，请等待或取消当前任务");
    const deadline = AbortSignal.timeout(20 * 6e4);
    const signal = combineAbortSignals([context.signal, deadline]);
    let release2;
    try {
      release2 = await acquireGeneration2(dir, context, signal);
      try {
        await verifyResources(signal, true);
      } catch (error) {
        if (signal.aborted) throw error;
        const reason = "本地模型校验失败，请重新准备声音克隆";
        await saveJson2(failurePath, { reason, at: Date.now() });
        await rm2(manifestPath, { force: true });
        throw new Error(reason, { cause: error });
      }
      const result = await render(input, context, signal);
      return {
        ...result,
        mimeType: "audio/wav",
        engine: "qwen3-tts",
        voice: { ...VOICE2 },
        rate: input.rate,
        sampleRate: 48e3,
        channels: 1,
        cached: false
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
        "未生成合格的 48 kHz WAV 配音"
      ];
      throw new Error(
        safeMessages.includes(message) ? message : "本地声音生成失败，请检查参考素材与逐字稿，或缩短文稿后重试",
        { cause: error }
      );
    } finally {
      release2?.();
    }
  }
  return { status, setup, generate };
}

// native/queue.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { mkdir as mkdir3, readFile as readFile3, readdir as readdir2, rename as rename3, rm as rm3, writeFile as writeFile3 } from "node:fs/promises";
import { join as join3 } from "node:path";
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}
function pause(signal) {
  return new Promise((resolve7, reject) => {
    const abort2 = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort2);
      reject(mediaAbortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort2);
      resolve7();
    }, 150);
    signal.addEventListener("abort", abort2, { once: true });
    if (signal.aborted) abort2();
  });
}
async function acquireVoiceQueue(root, signal, waiting) {
  if (signal.aborted) throw mediaAbortError();
  await mkdir3(root, { recursive: true, mode: 448 });
  const identity = `${process.pid}-${randomUUID3()}`;
  const choosing = join3(root, `${identity}.choosing`);
  const ticketPath = join3(root, `${identity}.ticket`);
  const partial = join3(root, `${identity}.partial`);
  const release2 = async () => {
    await Promise.all([choosing, ticketPath, partial].map((path) => rm3(path, { force: true })));
  };
  async function peers() {
    const names = await readdir2(root);
    if (names.length > 4096) throw new Error("本地声音等待队列过长，请稍后重试");
    const entries = /* @__PURE__ */ new Map();
    for (const name of names) {
      const match = /^([1-9]\d*)-([a-f0-9-]{36})\.(choosing|ticket|partial)$/.exec(name);
      if (!match) continue;
      const pid = Number(match[1]);
      if (!Number.isSafeInteger(pid) || !alive(pid)) {
        await rm3(join3(root, name), { force: true });
        continue;
      }
      const id2 = `${match[1]}-${match[2]}`;
      const entry = entries.get(id2) ?? { choosing: false, ticket: 0 };
      if (match[3] === "choosing") entry.choosing = true;
      if (match[3] === "ticket") {
        try {
          const value = await readFile3(join3(root, name), "utf8");
          if (value.length > 32) throw new Error("invalid ticket");
          entry.ticket = Number(value);
          if (!Number.isSafeInteger(entry.ticket) || entry.ticket < 1)
            throw new Error("invalid ticket");
        } catch (error) {
          if (error.code === "ENOENT") continue;
          throw new Error("本地声音等待队列需要重试", { cause: error });
        }
      }
      entries.set(id2, entry);
    }
    return entries;
  }
  try {
    await writeFile3(choosing, "", { flag: "wx", mode: 384 });
    const existing = await peers();
    const ticket = Math.max(0, ...Array.from(existing.values(), (entry) => entry.ticket)) + 1;
    if (!Number.isSafeInteger(ticket)) throw new Error("本地声音等待队列需要重试");
    await writeFile3(partial, String(ticket), { flag: "wx", mode: 384 });
    await rename3(partial, ticketPath);
    await rm3(choosing);
    let reported = false;
    for (; ; ) {
      if (signal.aborted) throw mediaAbortError();
      const entries = await peers();
      const blocked = Array.from(entries).some(
        ([id2, entry]) => id2 !== identity && (entry.choosing || entry.ticket > 0 && (entry.ticket < ticket || entry.ticket === ticket && id2 < identity))
      );
      if (!blocked) return release2;
      if (!reported) {
        await waiting();
        reported = true;
      }
      await pause(signal);
    }
  } catch (error) {
    await release2();
    throw error;
  }
}

// native/media/media-connections.ts
import { createHash as createHash3 } from "node:crypto";
function resolveMediaConnections(raw, options = {}) {
  if (Array.isArray(raw)) {
    if (options.publicOnly) throw new Error("公开连接须使用通用目录格式");
    return { connections: validateMediaConnections(raw) };
  }
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.connections))
    throw new Error("配音连接配置无效");
  const value = raw;
  if (value.connections.length > 1e3) throw new Error("配音连接配置过多");
  const connections = [], seen = /* @__PURE__ */ new Set();
  for (const c of value.connections) {
    if (!c || c.tag !== "speech" || c.entry?.tag !== "speech" || c.adapterKind !== "openai" || typeof c.id !== "string" || seen.has(c.id) || typeof c.catalogId !== "string" || !c.preset || typeof c.model !== "string" || !c.model || (options.publicOnly ? !c.hasCredentials : typeof c.apiKey !== "string" || !c.apiKey.trim()))
      continue;
    seen.add(c.id);
    const fingerprint = typeof c.fingerprint === "string" && /^[a-f0-9]{32}$/.test(c.fingerprint) ? c.fingerprint : void 0;
    if (options.publicOnly && !fingerprint && typeof c.baseUrl !== "string") continue;
    if (!options.publicOnly) {
      if (typeof c.baseUrl !== "string") continue;
      let url;
      try {
        url = new URL(c.baseUrl);
      } catch {
        continue;
      }
      if (url.username || url.password || url.search || url.hash || !(url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
        continue;
    }
    const params = Array.isArray(c.preset.params) ? c.preset.params : [], values = c.paramValues ?? {};
    const voiceSpec = params.find((p) => p.name === "voice");
    const voiceIds = voiceSpec?.control === "enum" ? voiceSpec.options ?? [] : typeof values.voice === "string" ? [values.voice] : [];
    if (!Array.isArray(voiceIds)) continue;
    const voices = [...new Set(voiceIds)].filter((v) => typeof v === "string" && Boolean(v.trim()) && v.length <= 200).slice(0, 64).map((id3) => ({ id: id3, name: id3, language: "und" }));
    if (!voices.length) continue;
    const defaultVoiceId = values.voice ?? voiceSpec?.default ?? voices[0].id;
    if (!voices.some((v) => v.id === defaultVoiceId)) continue;
    const defaultRate = values.speed ?? params.find((p) => p.name === "speed")?.default ?? 1;
    if (typeof defaultRate !== "number" || !Number.isFinite(defaultRate) || defaultRate < 0.5 || defaultRate > 2)
      continue;
    const supportsInstructions = params.some((p) => p.name === "instructions") && !["tts-1", "tts-1-hd"].includes(c.model);
    const instructions = options.publicOnly ? void 0 : values.instructions;
    if (instructions !== void 0 && (typeof instructions !== "string" || instructions.length > 2e3 || instructions.trim() && !supportsInstructions))
      continue;
    const id2 = `speech-${options.publicOnly && fingerprint ? fingerprint : createHash3("sha256").update(JSON.stringify([c.id, c.catalogId, c.model, c.baseUrl])).digest("hex").slice(0, 32)}`;
    connections.push({
      description: {
        id: id2,
        name: `${c.id} · ${c.preset.label ?? c.model}`.slice(0, 256),
        provider: String(c.providerName ?? c.entry.displayName ?? c.entry.id ?? c.catalogId).slice(
          0,
          256
        ),
        available: true,
        voices,
        defaultVoiceId,
        maxTextLength: 4096,
        supportsInstructions
      },
      connectionId: c.id,
      model: c.model,
      baseUrl: options.publicOnly ? "" : c.baseUrl,
      apiKey: options.publicOnly ? "" : c.apiKey,
      defaultRate,
      ...instructions?.trim() ? { defaultInstructions: instructions.trim() } : {}
    });
  }
  const preferred = connections.find((c) => c.connectionId === value.defaults?.speech);
  return { connections, ...preferred ? { defaultModelId: preferred.description.id } : {} };
}

// native/media/media-runtime.ts
import { createReadStream as createReadStream6 } from "node:fs";
import { access as access4, copyFile as copyFile5, lstat as lstat2, mkdir as mkdir12, realpath as realpath4, rm as rm12, stat as stat9 } from "node:fs/promises";
import { homedir as homedir5 } from "node:os";
import { basename as basename3, extname, join as join13, relative as relative2, resolve as resolve6, sep as sep2 } from "node:path";

// native/media/media-processors.ts
import { createHash as createHash4, randomUUID as randomUUID4 } from "node:crypto";
import { copyFile, link as link2, mkdir as mkdir4, readFile as readFile4, realpath as realpath2, rename as rename4, stat as stat4, writeFile as writeFile4 } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { basename, isAbsolute as isAbsolute4, join as join5, resolve as resolve3 } from "node:path";

// native/media/media-executables.ts
import { constants } from "node:fs";
import { access, realpath, stat as stat3 } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute as isAbsolute3, join as join4 } from "node:path";
function executableSearchDirectories() {
  return [
    ...new Set(
      [
        ...(process.env.PATH ?? "").split(delimiter),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        join4(homedir(), ".local/bin")
      ].filter(isAbsolute3)
    )
  ];
}
async function findExecutable(name, explicit, directories = executableSearchDirectories()) {
  const choices = explicit ? [explicit] : directories.map((dir) => join4(dir, process.platform === "win32" ? `${name}.exe` : name));
  for (const path of choices) {
    try {
      await access(path, constants.X_OK);
      if ((await stat3(path)).isFile()) return await realpath(path);
    } catch {
    }
  }
  return void 0;
}
function redactHomePath(message) {
  const home = homedir().replace(/[\\/]+$/, "");
  if (!home) return message;
  const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return message.replace(new RegExp(`${escaped}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9_-])`, "g"), "~");
}
function containsAbsolutePath(message) {
  return /(?:^|[\s'"`(\[<=:：，,])\/[^\s/]|[A-Za-z]:\\/.test(message);
}

// src/rough-cut.ts
var MAX_FRAMES = 24 * 60 * 60 * 30;

// src/model.ts
var FPS = 30;
var MAX_FRAMES2 = 24 * 60 * 60 * FPS;
function timelineDuration(project) {
  let cursor = 0;
  let duration2 = 0;
  for (const clip of project.clips) {
    const start = project.timelineMode === "free" ? clip.startFrame ?? cursor : cursor;
    cursor = start + clip.outFrame - clip.inFrame;
    duration2 = Math.max(duration2, cursor);
  }
  return duration2;
}
function timelineClips(project) {
  let cursor = 0;
  const result = project.clips.map((clip) => {
    const startFrame = project.timelineMode === "free" ? clip.startFrame ?? cursor : cursor;
    cursor = startFrame + clip.outFrame - clip.inFrame;
    return { ...clip, startFrame, endFrame: cursor };
  });
  return project.timelineMode === "free" ? result.sort((a, b) => a.startFrame - b.startFrame) : result;
}

// native/media/media-processors.ts
var MEDIA_PROCESSOR_CACHE_VERSION = 4;
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value;
}
function bounded(value, min, max, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`Invalid ${label}`);
  return value;
}
function integer(value, min, max, label) {
  const result = bounded(value, min, max, label);
  if (!Number.isSafeInteger(result)) throw new Error(`Invalid integer ${label}`);
  return result;
}
function id(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(value))
    throw new Error("Invalid asset ID");
  return value;
}
function ratio(value) {
  const parts = String(value ?? "").split("/").map(Number);
  const result = parts.length === 2 ? parts[0] / parts[1] : parts[0];
  return result && Number.isFinite(result) && result > 0 ? result : null;
}
function finiteDuration(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}
function hash(value) {
  return createHash4("sha256").update(JSON.stringify(value)).digest("hex");
}
function check(context) {
  if (context.signal.aborted) throw mediaAbortError();
}
async function writeJson(path, value) {
  const temporary = `${path}.${randomUUID4()}.tmp`;
  await writeFile4(temporary, JSON.stringify(value), { flag: "wx" });
  await rename4(temporary, path);
}
async function regularFile(path) {
  const canonical = await realpath2(path);
  if (!(await stat4(canonical)).isFile()) throw new Error("Media source must be a regular file");
  return canonical;
}
var sourceOptions = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  "mov,matroska,webm,avi,mp3,wav,aiff,flac,ogg,aac,png_pipe,jpeg_pipe,webp_pipe,bmp_pipe,tiff_pipe,gif,j2k_pipe"
];
async function executablePath(command) {
  if (isAbsolute4(command) || command.includes("/") || command.includes("\\"))
    return regularFile(resolve3(command));
  const found = await findExecutable(command);
  if (!found) throw new Error(`本机语音转写未就绪：未找到 ${command} 命令`);
  return found;
}
var missingModel = (path) => new Error(`本机语音转写未就绪：缺少 ${basename(path, ".pt")} 模型 ${redactHomePath(path)}`);
async function inspectMediaFile(path, context, options = {}) {
  path = await regularFile(path);
  const probe = options.ffprobePath ?? "ffprobe";
  const result = await runMediaProcess(
    probe,
    ["-v", "error", "-show_format", "-show_streams", "-of", "json", ...sourceOptions, path],
    { signal: context.signal }
  );
  const raw = JSON.parse(result.stdout.toString("utf8"));
  const video = raw.streams?.find(
    (stream) => stream.codec_type === "video" && !stream.disposition?.attached_pic
  );
  const audio = raw.streams?.find((stream) => stream.codec_type === "audio");
  if (!video && !audio) throw new Error("No supported video, image or audio stream found");
  let durationSeconds = finiteDuration(raw.format?.duration) ?? finiteDuration(video?.duration) ?? finiteDuration(audio?.duration);
  const image = video && !audio && !durationSeconds && /^(png|mjpeg|webp|bmp|tiff|gif|jpeg2000)$/.test(video.codec_name);
  if (!durationSeconds && !image) {
    let pending = "", lastEnd = 0;
    const streams = /* @__PURE__ */ new Map();
    const consume = (chunk) => {
      const lines = (pending + chunk.toString("utf8")).split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const fields = Object.fromEntries(line.split("|").map((part) => part.split("=")));
        const time = Number(fields.pts_time ?? fields.dts_time), stream = Number(fields.stream_index);
        if (!Number.isFinite(time) || !Number.isFinite(stream)) continue;
        const previous = streams.get(stream);
        const delta = previous && time > previous.time ? time - previous.time : previous?.delta ?? 0;
        streams.set(stream, { time, delta });
        const duration2 = finiteDuration(fields.duration_time) ?? delta;
        lastEnd = Math.max(lastEnd, time + duration2);
      }
    };
    await context.reportProgress({ stage: "inspect", message: "Measuring media packet duration" });
    await runMediaProcess(
      probe,
      [
        "-v",
        "error",
        "-show_entries",
        "packet=stream_index,pts_time,dts_time,duration_time",
        "-of",
        "compact=p=0:nk=0",
        ...sourceOptions,
        path
      ],
      { signal: context.signal, onStdout: consume }
    );
    consume(Buffer.from("\n"));
    const origin = Math.max(0, Number(raw.format?.start_time) || 0);
    durationSeconds = finiteDuration(lastEnd - origin);
    if (!durationSeconds) throw new Error("Media duration could not be measured from its packets");
  }
  const inspection = {
    kind: image ? "image" : video ? "video" : "audio",
    durationSeconds,
    bytes: (await stat4(path)).size,
    format: String(raw.format?.format_name ?? "unknown")
  };
  if (video) {
    const rotation = Number(
      video.side_data_list?.find((item) => Number.isFinite(item.rotation))?.rotation ?? video.tags?.rotate ?? 0
    );
    const rotated = Math.abs(Math.round(rotation / 90)) % 2 === 1;
    inspection.video = {
      codec: String(video.codec_name),
      width: Number(video.width),
      height: Number(video.height),
      displayWidth: Number(rotated ? video.height : video.width),
      displayHeight: Number(rotated ? video.width : video.height),
      rotation,
      pixelFormat: String(video.pix_fmt ?? "unknown"),
      frameRate: ratio(video.avg_frame_rate) ?? ratio(video.r_frame_rate),
      variableFrameRate: image ? false : null,
      sampledSeconds: 0
    };
    if (!image) {
      const frames = await runMediaProcess(
        probe,
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-read_intervals",
          "%+10",
          "-show_entries",
          "frame=best_effort_timestamp_time",
          "-of",
          "json",
          ...sourceOptions,
          path
        ],
        { signal: context.signal }
      );
      const times = (JSON.parse(frames.stdout.toString("utf8")).frames ?? []).map((frame) => Number(frame.best_effort_timestamp_time)).filter(Number.isFinite);
      const deltas = times.slice(1).map((time, index) => time - times[index]).filter((delta) => delta > 0);
      inspection.video.variableFrameRate = deltas.length > 1 ? Math.max(...deltas) - Math.min(...deltas) > 2e-3 : null;
      inspection.video.sampledSeconds = times.length > 1 ? times.at(-1) - times[0] : 0;
    }
  }
  if (audio)
    inspection.audio = {
      codec: String(audio.codec_name),
      channels: Number(audio.channels),
      sampleRate: Number(audio.sample_rate)
    };
  return inspection;
}
function captionsToSrt(captions, fps = 30) {
  const timestamp = (frame) => {
    const ms = Math.round(frame / fps * 1e3);
    return `${String(Math.floor(ms / 36e5)).padStart(2, "0")}:${String(Math.floor(ms / 6e4) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1e3) % 60).padStart(2, "0")},${String(ms % 1e3).padStart(3, "0")}`;
  };
  return [...captions].sort((a, b) => a.startFrame - b.startFrame).map(
    (caption, index) => `${index + 1}
${timestamp(caption.startFrame)} --> ${timestamp(caption.endFrame)}
${caption.text.replace(/\r\n?/g, "\n")}
`
  ).join("\n");
}
function renderProject(value) {
  const project = object(value, "project");
  if (project.schemaVersion !== 1 || project.fps !== 30)
    throw new Error("Only version 1, 30 fps projects are supported");
  if (project.timelineMode !== void 0 && project.timelineMode !== "magnetic" && project.timelineMode !== "free")
    throw new Error("Timeline mode must be magnetic or free");
  if (project.captionStyle !== void 0 && !["classic", "bold", "minimal"].includes(project.captionStyle))
    throw new Error("Caption style must be classic, bold or minimal");
  integer(project.width, 16, 8192, "width");
  integer(project.height, 16, 8192, "height");
  if (project.width % 2 || project.height % 2)
    throw new Error("MP4 canvas dimensions must be even");
  integer(project.revision, 0, Number.MAX_SAFE_INTEGER, "revision");
  if (!Array.isArray(project.assets) || !Array.isArray(project.clips) || !project.clips.length || project.clips.length > 2e3)
    throw new Error("Invalid render assets or clips");
  const assets = new Set(project.assets.map((asset) => id(asset.id)));
  if (assets.size !== project.assets.length) throw new Error("Duplicate render asset IDs");
  let frames = 0;
  const validateClip = (clip) => {
    if (!assets.has(id(clip.assetId))) throw new Error("A render clip references missing media");
    integer(clip.inFrame, 0, 30 * 86400, "clip inFrame");
    integer(clip.outFrame, clip.inFrame + 1, 30 * 86400, "clip outFrame");
    bounded(clip.volume, 0, 2, "clip volume");
    if (clip.crop || clip.zoom || clip.speed)
      throw new Error("This processor does not yet render crop, zoom or speed operations");
  };
  for (const clip of project.clips) {
    validateClip(clip);
    if (clip.startFrame !== void 0)
      integer(clip.startFrame, 0, 30 * 86400 - 1, "video startFrame");
    const startFrame = project.timelineMode === "free" ? clip.startFrame ?? frames : frames;
    if (startFrame < frames) throw new Error("Video clips must be ordered without overlap");
    frames = startFrame + clip.outFrame - clip.inFrame;
  }
  integer(frames, 1, 30 * 86400, "timeline duration");
  if (!Array.isArray(project.captions) || project.captions.length > 1e4)
    throw new Error("Invalid captions");
  for (const caption of project.captions) {
    integer(caption.startFrame, 0, frames - 1, "caption start");
    integer(caption.endFrame, caption.startFrame + 1, frames, "caption end");
    if (typeof caption.text !== "string" || !caption.text.trim() || caption.text.length > 4e3)
      throw new Error("Invalid caption text");
  }
  if (project.audioClips !== void 0) {
    if (!Array.isArray(project.audioClips) || project.audioClips.length > 64)
      throw new Error("At most 64 independent audio clips are supported");
    for (const clip of project.audioClips) {
      validateClip(clip);
      integer(clip.startFrame, 0, frames - 1, "audio startFrame");
    }
  }
  return project;
}
function createMediaJobProcessors(options) {
  const ffmpeg = options.ffmpegPath ?? "ffmpeg";
  let toolVersions;
  const source = async (input, context) => regularFile(await options.resolveAssetPath(context.scope, id(input.assetId)));
  const publish = async (path, mimeType, context) => options.publishArtifact ? { asset: await options.publishArtifact(context.scope, path, mimeType), mimeType } : { path, mimeType };
  const encode = (args, context, duration2, progress) => runMediaProcess(
    ffmpeg,
    ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats", ...args],
    {
      signal: context.signal,
      cwd: context.workDir,
      durationSeconds: duration2,
      onProgress: (update) => context.reportProgress({
        fraction: progress && update.fraction !== void 0 ? progress(update.fraction) : update.fraction
      })
    }
  );
  const cachedArtifactsExist = async (value, context) => {
    if (!value || typeof value !== "object") return true;
    const record = value;
    if (typeof record.path === "string" && typeof record.mimeType === "string") {
      return regularFile(record.path).then(
        () => true,
        () => false
      );
    }
    if (record.asset && typeof record.mimeType === "string") {
      const assetId = record.asset.id;
      if (typeof assetId !== "string") return false;
      return options.resolveAssetPath(context.scope, assetId).then(regularFile).then(
        () => true,
        () => false
      );
    }
    for (const child of Object.values(record))
      if (!await cachedArtifactsExist(child, context)) return false;
    return true;
  };
  const materializeCached = async (value, context) => {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      const items = [];
      for (const item of value) items.push(await materializeCached(item, context));
      return items;
    }
    const record = value;
    if (typeof record.path === "string" && typeof record.mimeType === "string") {
      const cached = await regularFile(record.path), directory = join5(context.workDir, "cached");
      await mkdir4(directory, { recursive: true });
      const target = join5(directory, `${randomUUID4()}-${basename(cached)}`);
      await link2(cached, target).catch(() => copyFile(cached, target));
      return { ...record, path: target };
    }
    const output = {};
    for (const [key, child] of Object.entries(record))
      output[key] = await materializeCached(child, context);
    return output;
  };
  const withJob = (kind, work) => ({
    recovery: "restart",
    async run(input, context) {
      check(context);
      await Promise.all(
        [context.workDir, context.outputDir, context.cacheDir].map(
          (path) => mkdir4(path, { recursive: true })
        )
      );
      await context.reportProgress({ fraction: 0, stage: kind });
      toolVersions ??= Promise.all(
        [ffmpeg, options.ffprobePath ?? "ffprobe"].map(async (tool) => {
          const result2 = await runMediaProcess(tool, ["-version"], {
            signal: AbortSignal.timeout(5e3)
          });
          return result2.stdout.toString("utf8").split("\n")[0] ?? tool;
        })
      ).catch((error) => {
        toolVersions = void 0;
        throw error;
      });
      let modelIdentity;
      if (kind === "transcribe") {
        const modelPath = options.whisperModelPath ?? join5(homedir2(), ".cache", "whisper", "base.pt");
        const info = await stat4(modelPath).catch(() => {
          throw missingModel(modelPath);
        });
        const whisperExecutable = await executablePath(options.whisperPath ?? "whisper");
        const executableInfo = await stat4(whisperExecutable);
        const shebang = (await readFile4(whisperExecutable, "utf8")).split("\n")[0] ?? "";
        const python = /^#!(\/[^\r\n ]*python[\d.]*)\s*$/.exec(shebang)?.[1];
        const version = python ? (await runMediaProcess(
          python,
          [
            "-c",
            "import importlib.metadata; print(importlib.metadata.version('openai-whisper'))"
          ],
          { signal: context.signal }
        )).stdout.toString("utf8").trim() : "wrapper";
        modelIdentity = {
          path: modelPath,
          bytes: info.size,
          modifiedAt: info.mtimeMs,
          executable: whisperExecutable,
          executableModifiedAt: executableInfo.mtimeMs,
          version
        };
      }
      const payload = object(input, `${kind} input`);
      if (kind === "render") {
        const project = renderProject(payload.project), mappings = payload.sources ?? {};
        for (const assetId of new Set(
          [...project.clips, ...project.audioClips ?? []].map((clip) => clip.assetId)
        ))
          await regularFile(
            await options.resolveAssetPath(context.scope, id(mappings[assetId] ?? assetId))
          );
      } else await source(payload, context);
      const cacheDirectory = options.cacheRoot ? await options.cacheRoot(context.scope) : context.cacheDir;
      await mkdir4(cacheDirectory, { recursive: true });
      const key = hash({
        processorVersion: MEDIA_PROCESSOR_CACHE_VERSION,
        scope: context.scope,
        kind,
        input,
        tools: await toolVersions,
        modelIdentity,
        captions: Boolean(options.renderCaptionPng)
      });
      const cachePath = join5(cacheDirectory, `${kind}-${key}.json`);
      try {
        const cached = JSON.parse(await readFile4(cachePath, "utf8"));
        if (cached.version === 1 && await cachedArtifactsExist(cached.result, context)) {
          check(context);
          const result2 = await materializeCached(cached.result, context);
          check(context);
          await context.reportProgress({ fraction: 1, stage: "cached" });
          return result2;
        }
      } catch {
      }
      check(context);
      const result = await work(payload, context);
      check(context);
      await writeJson(cachePath, {
        version: 1,
        kind,
        input,
        result,
        completedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      await context.reportProgress({ fraction: 1, stage: "complete" });
      return result;
    }
  });
  const handlers = {};
  handlers.inspect = withJob("inspect", async (input, context) => ({
    assetId: id(input.assetId),
    inspection: await inspectMediaFile(await source(input, context), context, options)
  }));
  handlers.proxy = withJob("proxy", async (input, context) => {
    const path = await source(input, context), info = await inspectMediaFile(path, context, options);
    const width = integer(input.maxWidth ?? 1280, 160, 3840, "proxy width");
    const output = join5(
      context.outputDir,
      `proxy-${randomUUID4()}.${info.kind === "audio" ? "m4a" : "mp4"}`
    );
    if (info.kind === "image") throw new Error("Still images do not require a playback proxy");
    await encode(
      [
        ...sourceOptions,
        "-i",
        path,
        ...info.video ? [
          "-map",
          "0:v:0",
          "-vf",
          `scale=w='trunc(min(${width},iw)/2)*2':h=-2,fps=30:eof_action=pass,tpad=stop_mode=clone:stop=-1,setsar=1`,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "24",
          "-pix_fmt",
          "yuv420p"
        ] : ["-vn"],
        "-map",
        "0:a:0?",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        ...info.durationSeconds ? ["-t", String(info.durationSeconds)] : [],
        output
      ],
      context,
      info.durationSeconds ?? void 0
    );
    return {
      assetId: id(input.assetId),
      inspection: info,
      proxy: await publish(output, info.kind === "audio" ? "audio/mp4" : "video/mp4", context)
    };
  });
  handlers.thumbnail = withJob("thumbnail", async (input, context) => {
    const path = await source(input, context), info = await inspectMediaFile(path, context, options);
    const output = join5(context.outputDir, `thumbnail-${randomUUID4()}.png`);
    const seconds = bounded(
      input.seconds ?? 0,
      0,
      Math.max(0, (info.durationSeconds ?? 86400) - 1e-3),
      "thumbnail position"
    );
    const width = integer(input.width ?? 480, 64, 1920, "thumbnail width");
    if (info.kind === "audio")
      await encode(
        [
          ...sourceOptions,
          "-i",
          path,
          "-filter_complex",
          `showwavespic=s=${width}x160:colors=0x8fd6ad`,
          "-frames:v",
          "1",
          output
        ],
        context,
        info.durationSeconds ?? void 0
      );
    else
      await encode(
        [
          "-ss",
          String(seconds),
          ...sourceOptions,
          "-i",
          path,
          "-vf",
          `scale=${width}:-2`,
          "-frames:v",
          "1",
          output
        ],
        context
      );
    return {
      assetId: id(input.assetId),
      seconds,
      thumbnail: await publish(output, "image/png", context)
    };
  });
  handlers.waveform = withJob("waveform", async (input, context) => {
    const path = await source(input, context), info = await inspectMediaFile(path, context, options);
    if (!info.audio || !info.durationSeconds)
      throw new Error("Waveforms require a finite audio stream");
    const points = integer(input.points ?? 1024, 32, 4096, "waveform points");
    const perBucket = Math.max(1, Math.ceil(info.durationSeconds * 8e3 / points));
    const peaks = [], rms = [];
    let pending = Buffer.alloc(0), samples = 0, peak = 0, sum = 0;
    const flush = () => {
      if (samples) {
        peaks.push(Number(peak.toFixed(5)));
        rms.push(Number(Math.sqrt(sum / samples).toFixed(5)));
      }
      samples = 0;
      peak = 0;
      sum = 0;
    };
    await runMediaProcess(
      ffmpeg,
      [
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-progress",
        "pipe:2",
        ...sourceOptions,
        "-i",
        path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "f32le",
        "pipe:1"
      ],
      {
        signal: context.signal,
        durationSeconds: info.durationSeconds,
        progressStream: "stderr",
        onProgress: (update) => context.reportProgress(update),
        onStdout(chunk) {
          const data = Buffer.concat([pending, chunk]), end = data.length - data.length % 4;
          for (let offset = 0; offset < end; offset += 4) {
            const value = data.readFloatLE(offset);
            peak = Math.max(peak, Math.abs(value));
            sum += value * value;
            samples++;
            if (samples >= perBucket) flush();
          }
          pending = data.subarray(end);
        }
      }
    );
    flush();
    return {
      assetId: id(input.assetId),
      durationSeconds: info.durationSeconds,
      sampleRate: 8e3,
      samplesPerPoint: perBucket,
      peaks,
      rms
    };
  });
  handlers.silence = withJob("silence", async (input, context) => {
    const path = await source(input, context), info = await inspectMediaFile(path, context, options);
    if (!info.audio || !info.durationSeconds)
      throw new Error("Silence detection requires a finite audio stream");
    const thresholdDb = bounded(input.thresholdDb ?? -35, -90, -5, "silence threshold"), minSeconds = bounded(input.minSeconds ?? 0.45, 0.05, 30, "silence minimum duration");
    let pending = "", start = null;
    const intervals = [];
    const consume = (chunk) => {
      pending += chunk;
      const lines = pending.split(/[\r\n]/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const begin = /silence_start:\s*([\d.]+)/.exec(line), end = /silence_end:\s*([\d.]+)/.exec(line);
        if (begin) start = Number(begin[1]);
        if (end && start !== null) {
          intervals.push({ start, end: Math.min(info.durationSeconds, Number(end[1])) });
          start = null;
        }
      }
    };
    await runMediaProcess(
      ffmpeg,
      [
        "-hide_banner",
        "-nostdin",
        "-progress",
        "pipe:1",
        ...sourceOptions,
        "-i",
        path,
        "-vn",
        "-af",
        `silencedetect=noise=${thresholdDb}dB:d=${minSeconds}`,
        "-f",
        "null",
        "-"
      ],
      {
        signal: context.signal,
        durationSeconds: info.durationSeconds ?? void 0,
        onProgress: (update) => context.reportProgress(update),
        onStderr: consume
      }
    );
    consume("\n");
    if (start !== null) intervals.push({ start, end: info.durationSeconds });
    const complete = {
      assetId: id(input.assetId),
      detector: "ffmpeg-silencedetect",
      thresholdDb,
      minSeconds,
      intervals
    };
    const analysisPath = join5(context.outputDir, `silence-${randomUUID4()}.json`);
    await writeJson(analysisPath, complete);
    return {
      ...complete,
      intervals: intervals.slice(0, 1024),
      totalCount: intervals.length,
      truncated: intervals.length > 1024,
      analysis: { path: analysisPath, mimeType: "application/json" }
    };
  });
  handlers.scenes = withJob("scenes", async (input, context) => {
    const path = await source(input, context), info = await inspectMediaFile(path, context, options);
    if (info.kind !== "video") throw new Error("Scene detection requires video");
    const threshold = bounded(input.threshold ?? 0.3, 0.01, 0.99, "scene threshold");
    const cuts = [];
    let pending = "";
    const consume = (chunk) => {
      pending += chunk;
      const lines = pending.split(/[\r\n]/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const match = /pts_time:([\d.]+)/.exec(line);
        if (match) cuts.push(Number(match[1]));
      }
    };
    await runMediaProcess(
      ffmpeg,
      [
        "-hide_banner",
        "-nostdin",
        "-progress",
        "pipe:1",
        ...sourceOptions,
        "-i",
        path,
        "-an",
        "-vf",
        `select='gt(scene,${threshold})',showinfo`,
        "-fps_mode",
        "vfr",
        "-f",
        "null",
        "-"
      ],
      {
        signal: context.signal,
        durationSeconds: info.durationSeconds ?? void 0,
        onProgress: (update) => context.reportProgress(update),
        onStderr: consume
      }
    );
    consume("\n");
    const complete = {
      assetId: id(input.assetId),
      detector: "ffmpeg-scene-change",
      threshold,
      cuts,
      durationSeconds: info.durationSeconds
    };
    const analysisPath = join5(context.outputDir, `scenes-${randomUUID4()}.json`);
    await writeJson(analysisPath, complete);
    return {
      ...complete,
      cuts: cuts.slice(0, 1024),
      totalCount: cuts.length,
      truncated: cuts.length > 1024,
      analysis: { path: analysisPath, mimeType: "application/json" }
    };
  });
  handlers.transcribe = withJob("transcribe", async (input, context) => {
    const path = await source(input, context), info = await inspectMediaFile(path, context, options);
    if (!info.audio || !info.durationSeconds)
      throw new Error("Transcription requires a finite audio stream");
    const language = input.language === void 0 || input.language === "auto" ? void 0 : String(input.language);
    if (language && !/^[a-z]{2,3}$/.test(language))
      throw new Error("Invalid transcription language");
    const configuredModel = options.whisperModelPath ?? join5(homedir2(), ".cache", "whisper", "base.pt");
    const modelPath = await regularFile(configuredModel).catch(() => {
      throw missingModel(configuredModel);
    });
    const audioPath = join5(context.workDir, "transcribe-source.wav");
    await encode(
      [
        ...sourceOptions,
        "-i",
        path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        audioPath
      ],
      context,
      info.durationSeconds,
      (fraction) => fraction * 0.1
    );
    await context.reportProgress({
      fraction: 0.1,
      stage: "transcribing",
      message: `Local Whisper ${basename(modelPath)}`
    });
    await runMediaProcess(
      options.whisperPath ?? "whisper",
      [
        audioPath,
        "--model",
        modelPath,
        "--device",
        "cpu",
        "--fp16",
        "False",
        "--word_timestamps",
        "True",
        "--output_format",
        "json",
        "--output_dir",
        context.outputDir,
        "--threads",
        "4",
        "--verbose",
        "False",
        ...language ? ["--language", language] : []
      ],
      { signal: context.signal, cwd: context.workDir }
    );
    const raw = JSON.parse(
      await readFile4(join5(context.outputDir, "transcribe-source.json"), "utf8")
    );
    if (!Array.isArray(raw.segments))
      throw new Error("Whisper did not produce a timestamped transcript");
    const segments = raw.segments.map((segment) => ({
      start: bounded(segment.start, 0, info.durationSeconds + 1, "transcript start"),
      end: bounded(segment.end, segment.start, info.durationSeconds + 1, "transcript end"),
      text: String(segment.text ?? ""),
      words: Array.isArray(segment.words) ? segment.words.map((word) => ({
        start: Number(word.start),
        end: Number(word.end),
        text: String(word.word),
        probability: Number(word.probability)
      })) : []
    }));
    const output = join5(context.outputDir, "transcript.srt");
    await writeFile4(
      output,
      captionsToSrt(
        segments.filter((segment) => segment.end > segment.start && segment.text.trim()).map((segment, index) => ({
          id: String(index),
          startFrame: Math.round(segment.start * 30),
          endFrame: Math.round(segment.end * 30),
          text: segment.text
        }))
      )
    );
    const transcriptPath = join5(context.outputDir, "transcript.json");
    const languageDetected = String(raw.language ?? language ?? "unknown");
    await writeJson(transcriptPath, {
      version: 1,
      assetId: id(input.assetId),
      engine: "local-whisper",
      model: basename(modelPath),
      language: languageDetected,
      durationSeconds: info.durationSeconds,
      text: String(raw.text ?? ""),
      segments
    });
    return {
      assetId: id(input.assetId),
      engine: "local-whisper",
      model: basename(modelPath),
      language: languageDetected,
      durationSeconds: info.durationSeconds,
      segmentCount: segments.length,
      wordCount: segments.reduce((total, segment) => total + segment.words.length, 0),
      transcript: { path: transcriptPath, mimeType: "application/json" },
      subtitles: (await stat4(output)).size ? await publish(output, "application/x-subrip", context) : null
    };
  });
  handlers.render = withJob("render", async (input, context) => {
    const project = renderProject(input.project);
    const mappings = input.sources === void 0 ? {} : object(input.sources, "source mappings");
    const sources = /* @__PURE__ */ new Map();
    const usedIds = new Set(
      [...project.clips, ...project.audioClips ?? []].map((clip) => clip.assetId)
    );
    for (const assetId of usedIds) {
      const path = await regularFile(
        await options.resolveAssetPath(context.scope, id(mappings[assetId] ?? assetId))
      );
      sources.set(assetId, { path, inspection: await inspectMediaFile(path, context, options) });
    }
    const frames = timelineDuration(project), duration2 = frames / 30;
    const subtitleMode = input.subtitleMode ?? "burn";
    if (!["burn", "soft", "none"].includes(subtitleMode)) throw new Error("Invalid subtitle mode");
    if (project.captions.length && subtitleMode === "burn" && !options.renderCaptionPng)
      throw new Error("Burned captions require the Host caption PNG renderer");
    const paths = [];
    const segments = [];
    let cursor = 0;
    for (const clip of timelineClips(project)) {
      if (clip.startFrame > cursor) segments.push({ frames: clip.startFrame - cursor });
      segments.push({ frames: clip.endFrame - clip.startFrame, clip });
      cursor = clip.endFrame;
    }
    let finishedFrames = 0;
    for (const [index, segment] of segments.entries()) {
      check(context);
      const clip = segment.clip, media = clip ? sources.get(clip.assetId) : void 0, seconds = segment.frames / 30;
      if (clip && media && media.inspection.kind !== "image" && (!media.inspection.durationSeconds || clip.outFrame / 30 > media.inspection.durationSeconds + 1 / 30))
        throw new Error("Clip range exceeds its source media duration");
      const output2 = join5(context.workDir, `segment-${index}.mkv`);
      const args2 = [];
      if (clip && media) {
        if (media.inspection.kind === "image")
          args2.push("-loop", "1", "-framerate", "30", ...sourceOptions, "-i", media.path);
        else args2.push("-ss", String(clip.inFrame / 30), ...sourceOptions, "-i", media.path);
      }
      if (!media?.inspection.video)
        args2.push(
          "-f",
          "lavfi",
          "-i",
          `color=c=${media ? "0x0a0e10" : "black"}:s=${project.width}x${project.height}:r=30`
        );
      if (!media?.inspection.audio) args2.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
      const videoInput = !media || media.inspection.video ? 0 : 1, audioInput = media?.inspection.audio ? 0 : media && !media.inspection.video ? 2 : 1;
      const filter = `[${videoInput}:v]scale=${project.width}:${project.height}:force_original_aspect_ratio=decrease,pad=${project.width}:${project.height}:(ow-iw)/2:(oh-ih)/2:color=0x0a0e10,setsar=1,fps=30:eof_action=pass,tpad=stop_mode=clone:stop=-1,setpts=PTS-STARTPTS[v];[${audioInput}:a]aresample=48000,volume=${clip?.volume ?? 1},apad,atrim=duration=${seconds},asetpts=PTS-STARTPTS[a]`;
      args2.push(
        "-filter_complex",
        filter,
        "-map",
        "[v]",
        "-map",
        "[a]",
        "-t",
        String(seconds),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "pcm_s16le",
        "-ar",
        "48000",
        "-ac",
        "2",
        output2
      );
      const base = finishedFrames;
      await encode(
        args2,
        context,
        seconds,
        (fraction) => (base + fraction * segment.frames) / frames * 0.7
      );
      finishedFrames += segment.frames;
      paths.push(output2);
    }
    const listPath = join5(context.workDir, "segments.txt");
    await writeFile4(
      listPath,
      paths.map((path) => `file '${path.replace(/'/g, "'\\''")}'`).join("\n")
    );
    const joined = join5(context.workDir, "joined.mkv");
    await encode(
      ["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", joined],
      context,
      duration2,
      (fraction) => 0.7 + fraction * 0.05
    );
    const prefix = `render-r${project.revision}-${randomUUID4()}`;
    const output = join5(context.outputDir, `${prefix}.mp4`), srt = join5(context.outputDir, `${prefix}.srt`);
    await writeFile4(srt, captionsToSrt(project.captions));
    const args = ["-i", joined], filters = [];
    let videoLabel = "0:v", audioLabel = "0:a", inputIndex = 1;
    if (project.captions.length && subtitleMode === "burn") {
      const boundaries = [
        .../* @__PURE__ */ new Set([
          0,
          frames,
          ...project.captions.flatMap((caption) => [caption.startFrame, caption.endFrame])
        ])
      ].sort((a, b) => a - b);
      const imageCache = /* @__PURE__ */ new Map();
      const captionSequence = ["ffconcat version 1.0"];
      let lastImage = "";
      for (let index = 0; index < boundaries.length - 1; index++) {
        const start = boundaries[index], end = boundaries[index + 1];
        const texts = project.captions.filter((caption) => caption.startFrame <= start && caption.endFrame > start).map((caption) => caption.text);
        check(context);
        const imageKey = hash(texts);
        let overlay = imageCache.get(imageKey);
        if (!overlay) {
          overlay = await regularFile(
            await options.renderCaptionPng(
              {
                width: project.width,
                height: project.height,
                texts,
                fontSize: Math.round(Math.min(project.width * 0.035, project.height * 0.05)),
                style: project.captionStyle ?? "classic"
              },
              context
            )
          );
          imageCache.set(imageKey, overlay);
        }
        captionSequence.push(
          `file '${overlay.replace(/'/g, "'\\''")}'`,
          "option framerate 30",
          `duration ${((end - start) / 30).toFixed(10)}`
        );
        lastImage = overlay;
      }
      captionSequence.push(`file '${lastImage.replace(/'/g, "'\\''")}'`, "option framerate 30");
      const captionList = join5(context.workDir, "captions.ffconcat");
      await writeFile4(captionList, captionSequence.join("\n"));
      args.push("-f", "concat", "-safe", "0", "-i", captionList);
      filters.push(
        `[${inputIndex}:v]fps=30,format=rgba[captiontrack]`,
        "[0:v][captiontrack]overlay=0:0:shortest=1[captioned]"
      );
      videoLabel = "captioned";
      inputIndex++;
    }
    if (project.audioClips?.length) {
      const labels = ["[0:a]"];
      for (const [index, clip] of project.audioClips.entries()) {
        const media = sources.get(clip.assetId);
        if (!media.inspection.audio || !media.inspection.durationSeconds || clip.outFrame / 30 > media.inspection.durationSeconds + 1 / 30)
          throw new Error("Invalid independent audio source range");
        args.push(
          "-ss",
          String(clip.inFrame / 30),
          "-t",
          String((clip.outFrame - clip.inFrame) / 30),
          ...sourceOptions,
          "-i",
          media.path
        );
        const delaySamples = clip.startFrame * (48e3 / 30), label = `music${index}`;
        filters.push(
          `[${inputIndex}:a]aresample=48000,asetpts=N/SR/TB,volume=${clip.volume},adelay=${delaySamples}S:all=1,asetpts=N/SR/TB,apad,atrim=duration=${duration2}[${label}]`
        );
        labels.push(`[${label}]`);
        inputIndex++;
      }
      filters.push(
        `${labels.join("")}amix=inputs=${labels.length}:duration=first:normalize=0[audio]`
      );
      audioLabel = "audio";
    }
    let subtitleInput;
    if (project.captions.length && subtitleMode === "soft") {
      subtitleInput = inputIndex;
      args.push("-i", srt);
    }
    if (filters.length) {
      const filterPath = join5(context.workDir, "composition.filter");
      await writeFile4(filterPath, filters.join(";"));
      args.push("-filter_complex_script", filterPath);
    }
    args.push(
      "-map",
      videoLabel === "0:v" ? videoLabel : `[${videoLabel}]`,
      "-map",
      audioLabel === "0:a" ? audioLabel : `[${audioLabel}]`
    );
    if (subtitleInput !== void 0) args.push("-map", `${subtitleInput}:s:0`, "-c:s", "mov_text");
    args.push(
      "-c:v",
      videoLabel === "0:v" ? "copy" : "libx264",
      ...videoLabel === "0:v" ? [] : ["-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"],
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-t",
      String(duration2),
      "-movflags",
      "+faststart",
      output
    );
    await encode(args, context, duration2, (fraction) => 0.75 + fraction * 0.24);
    const inspection = await inspectMediaFile(output, context, options);
    if (!inspection.video || !inspection.audio || !inspection.durationSeconds || Math.abs(inspection.durationSeconds - duration2) > Math.max(0.15, duration2 * 2e-3))
      throw new Error("Rendered MP4 failed duration or audio/video validation");
    return {
      revision: project.revision,
      frames,
      durationSeconds: inspection.durationSeconds,
      subtitleMode,
      inspection,
      video: await publish(output, "video/mp4", context),
      subtitles: project.captions.length ? await publish(srt, "application/x-subrip", context) : null
    };
  });
  return handlers;
}

// native/media/media-audio-enhance.ts
import { randomUUID as randomUUID5 } from "node:crypto";
import { mkdir as mkdir5, rename as rename5, rm as rm4 } from "node:fs/promises";
import { join as join6 } from "node:path";
function validateAudioEnhanceInput(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Audio enhancement parameters must be an object");
  const input = raw;
  if (Object.keys(input).some((key) => !["assetId", "preset", "denoise", "normalize"].includes(key)))
    throw new Error("Unsupported audio enhancement parameter");
  if (typeof input.assetId !== "string" || !/^(?:asset|external)-[a-f0-9]{64}$/.test(input.assetId))
    throw new Error("Select an authorized source asset");
  if (input.preset !== void 0 && input.preset !== "light" && input.preset !== "balanced")
    throw new Error("Audio enhancement preset must be light or balanced");
  for (const key of ["denoise", "normalize"])
    if (input[key] !== void 0 && typeof input[key] !== "boolean")
      throw new Error(`Invalid ${key} option`);
  return {
    assetId: input.assetId,
    preset: input.preset ?? "balanced",
    denoise: input.denoise !== false,
    normalize: input.normalize !== false
  };
}
var sourceOptions2 = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  "mov,matroska,webm,avi,mp3,wav,aiff,flac,ogg,aac"
];
function createAudioEnhanceProcessor(options) {
  const maxOutputBytes = options.maxOutputBytes ?? 20 * 1024 ** 3;
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 4096 || maxOutputBytes > 20 * 1024 ** 3)
    throw new Error("Invalid enhanced audio file budget");
  return {
    recovery: "restart",
    async run(raw, context) {
      const input = validateAudioEnhanceInput(raw);
      context.signal.throwIfAborted();
      const source = await options.resolveAssetPath(context.scope, input.assetId);
      const original = await inspectMediaFile(source, context, options);
      const duration2 = original.durationSeconds;
      if (!original.audio || !duration2 || duration2 > 24 * 60 * 60 || original.audio.channels < 1 || original.audio.channels > 8)
        throw new Error("Audio enhancement requires an audio stream up to 24 hours and 8 channels");
      if (Math.ceil(duration2 * 48e3) * original.audio.channels * 2 + 4096 > maxOutputBytes)
        throw new Error("Enhanced WAV would exceed the media file budget");
      await mkdir5(context.outputDir, { recursive: true });
      const temporary = join6(context.outputDir, `enhanced-${randomUUID5()}.partial.wav`);
      const output = join6(context.outputDir, `enhanced-${randomUUID5()}.wav`);
      const baseFilters = [
        // Keep the full source timeline, including a video whose audio begins late
        // or ends early. first_pts pads leading audio gaps and apad fills its tail.
        "aresample=48000:async=1:first_pts=0",
        `highpass=f=${input.preset === "light" ? 60 : 80}:p=2`,
        ...input.denoise ? [`afftdn=nr=${input.preset === "light" ? 6 : 12}:nf=-45:tn=1`] : [],
        "apad",
        `atrim=duration=${duration2}`
      ];
      const target = input.preset === "light" ? -18 : -16;
      const loudness = `loudnorm=I=${target}:TP=-1.5:LRA=11`;
      let normalization;
      try {
        if (input.normalize) {
          await context.reportProgress({
            stage: "measure",
            fraction: 0,
            message: "Measuring source loudness"
          });
          const measured = await runMediaProcess(
            options.ffmpegPath ?? "ffmpeg",
            [
              "-hide_banner",
              "-nostdin",
              ...sourceOptions2,
              "-i",
              source,
              "-map",
              "0:a:0",
              "-vn",
              "-sn",
              "-dn",
              "-af",
              [...baseFilters, `${loudness}:print_format=json`].join(","),
              "-f",
              "null",
              "-"
            ],
            { signal: context.signal, maxStdoutBytes: 64 * 1024 }
          );
          const block = measured.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0];
          if (!block) throw new Error("FFmpeg did not return measured loudness");
          const levels = JSON.parse(block);
          const fields = {
            measured_I: "input_i",
            measured_LRA: "input_lra",
            measured_TP: "input_tp",
            measured_thresh: "input_thresh",
            offset: "target_offset"
          };
          if (Object.values(fields).every((key) => Number.isFinite(Number(levels[key]))))
            normalization = `${loudness}:${Object.entries(fields).map(([name, key]) => `${name}=${Number(levels[key])}`).join(":")}:linear=true`;
        }
        await context.reportProgress({
          stage: "enhance",
          fraction: input.normalize ? 0.4 : 0,
          message: "Creating enhanced audio"
        });
        const filters = [
          ...baseFilters,
          ...normalization ? [normalization] : [],
          "alimiter=limit=0.891251:level=false:latency=true",
          "aresample=48000",
          "apad",
          `atrim=duration=${duration2}`
        ];
        await runMediaProcess(
          options.ffmpegPath ?? "ffmpeg",
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            ...sourceOptions2,
            "-i",
            source,
            "-map",
            "0:a:0",
            "-vn",
            "-sn",
            "-dn",
            "-af",
            filters.join(","),
            "-ar",
            "48000",
            "-ac",
            String(original.audio.channels),
            "-c:a",
            "pcm_s16le",
            "-rf64",
            "auto",
            "-map_metadata",
            "-1",
            "-progress",
            "pipe:1",
            "-nostats",
            "-n",
            temporary
          ],
          {
            signal: context.signal,
            durationSeconds: duration2,
            onProgress: (progress) => context.reportProgress({
              stage: "enhance",
              fraction: (input.normalize ? 0.4 : 0) + (progress.fraction ?? 0) * (input.normalize ? 0.55 : 0.95)
            })
          }
        );
        const inspection = await inspectMediaFile(temporary, context, options);
        if (inspection.kind !== "audio" || inspection.audio?.sampleRate !== 48e3 || inspection.audio.channels !== original.audio.channels || !inspection.durationSeconds || Math.abs(inspection.durationSeconds - duration2) > Math.max(1 / 30, duration2 * 1e-5))
          throw new Error("Enhanced audio did not preserve its source duration and channels");
        context.signal.throwIfAborted();
        await rename5(temporary, output);
        const asset = await options.publishArtifact(context.scope, output, "audio/wav", context);
        context.signal.throwIfAborted();
        await context.reportProgress({
          stage: "complete",
          fraction: 1,
          message: "Enhanced audio is ready"
        });
        return {
          asset,
          inspection,
          provenance: {
            sourceAssetId: input.assetId,
            preset: input.preset,
            denoise: input.denoise,
            normalize: input.normalize,
            processor: "ffmpeg-audio-enhance",
            version: 1
          }
        };
      } finally {
        await Promise.all(
          [temporary, output].map((path) => rm4(path, { force: true }).catch(() => {
          }))
        );
      }
    }
  };
}

// native/media/media-audio-extract.ts
import { randomUUID as randomUUID6 } from "node:crypto";
import { mkdir as mkdir6, rename as rename6, rm as rm5 } from "node:fs/promises";
import { join as join7 } from "node:path";
function validateAudioExtractInput(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("请选择要提取的本人录音片段");
  const input = raw;
  if (Object.keys(input).some((key) => !["assetId", "inFrame", "outFrame", "fps"].includes(key)))
    throw new Error("不支持此参考录音提取参数");
  if (typeof input.assetId !== "string" || !/^(?:asset|external)-[a-f0-9]{64}$/.test(input.assetId))
    throw new Error("请选择当前项目已保存的素材");
  for (const key of ["inFrame", "outFrame"])
    if (typeof input[key] !== "number" || !Number.isSafeInteger(input[key]) || input[key] < 0 || input[key] > 24 * 3600 * 30)
      throw new Error("参考片段的起止位置无效");
  if (input.fps !== 30) throw new Error("参考片段须使用 30 fps 时间基准");
  const inFrame = input.inFrame, outFrame = input.outFrame;
  if (outFrame - inFrame < 90 || outFrame - inFrame > 900)
    throw new Error("本人声音参考片段需要 3–30 秒");
  return { assetId: input.assetId, inFrame, outFrame, fps: 30 };
}
function createAudioExtractProcessor(options) {
  return {
    recovery: "restart",
    async run(raw, context) {
      const input = validateAudioExtractInput(raw);
      try {
        context.signal.throwIfAborted();
        const source = await options.resolveAssetPath(context.scope, input.assetId);
        const original = await inspectMediaFile(source, context, options);
        if (!original.audio || !original.durationSeconds || original.audio.channels < 1 || original.audio.channels > 8)
          throw new Error("这个素材没有可用的声音，请选择本人录音或带原声的视频");
        if (input.outFrame / 30 > original.durationSeconds + 1 / 60)
          throw new Error("参考片段超出原始素材时长，请重新选择起止位置");
        const duration2 = (input.outFrame - input.inFrame) / 30;
        await mkdir6(context.outputDir, { recursive: true });
        const temporary = join7(context.outputDir, `reference-${randomUUID6()}.partial.wav`);
        const output = join7(context.outputDir, `reference-${randomUUID6()}.wav`);
        try {
          await context.reportProgress({
            stage: "extract",
            fraction: 0,
            message: "正在提取选中的本人录音片段"
          });
          await runMediaProcess(
            options.ffmpegPath ?? "ffmpeg",
            [
              "-hide_banner",
              "-loglevel",
              "error",
              "-nostdin",
              "-protocol_whitelist",
              "file,pipe",
              "-format_whitelist",
              "mov,matroska,webm,avi,mp3,wav,aiff,flac,ogg,aac",
              "-ss",
              String(input.inFrame / 30),
              "-i",
              source,
              "-map",
              "0:a:0",
              "-vn",
              "-sn",
              "-dn",
              // Accurate input seeking avoids decoding hours before a late selection.
              // FFmpeg shifts source timestamps by the seek position. Keep any remaining
              // leading audio gap, then retain precisely 1600 samples per selected frame.
              "-af",
              [
                "aresample=48000:async=1:first_pts=0",
                "apad",
                `atrim=end_sample=${(input.outFrame - input.inFrame) * 1600}`,
                "asetpts=PTS-STARTPTS"
              ].join(","),
              "-t",
              String(duration2),
              "-ar",
              "48000",
              "-ac",
              "1",
              "-c:a",
              "pcm_s16le",
              "-map_metadata",
              "-1",
              "-progress",
              "pipe:1",
              "-nostats",
              "-n",
              temporary
            ],
            {
              signal: context.signal,
              durationSeconds: duration2,
              onProgress: (progress) => context.reportProgress({
                stage: "extract",
                fraction: (progress.fraction ?? 0) * 0.95
              })
            }
          );
          const inspection = await inspectMediaFile(temporary, context, options);
          if (inspection.kind !== "audio" || inspection.audio?.sampleRate !== 48e3 || inspection.audio.channels !== 1 || !inspection.durationSeconds || Math.abs(inspection.durationSeconds - duration2) > 1 / 48e3 + 1e-6)
            throw new Error("参考录音提取未保留完整片段，请重试");
          context.signal.throwIfAborted();
          await rename6(temporary, output);
          const asset = await options.publishArtifact(context.scope, output, "audio/wav", context);
          context.signal.throwIfAborted();
          await context.reportProgress({
            stage: "complete",
            fraction: 1,
            message: "参考录音片段已保存"
          });
          return {
            asset,
            inspection,
            provenance: {
              sourceAssetId: input.assetId,
              inFrame: input.inFrame,
              outFrame: input.outFrame,
              fps: 30,
              processor: "ffmpeg-audio-extract",
              version: 1
            }
          };
        } finally {
          await Promise.all(
            [temporary, output].map((path) => rm5(path, { force: true }).catch(() => {
            }))
          );
        }
      } catch (error) {
        if (context.signal.aborted) throw mediaAbortError();
        const message = error instanceof Error ? error.message : "";
        const publicMessages = [
          "这个素材没有可用的声音，请选择本人录音或带原声的视频",
          "参考片段超出原始素材时长，请重新选择起止位置",
          "参考录音提取未保留完整片段，请重试"
        ];
        throw new Error(
          publicMessages.includes(message) ? message : "参考录音提取失败，请检查素材是否可播放，以及本机音频处理工具是否就绪",
          { cause: error }
        );
      }
    }
  };
}

// native/media/media-tts-providers.ts
import { createHash as createHash6, randomUUID as randomUUID8 } from "node:crypto";
import { createReadStream as createReadStream4 } from "node:fs";
import {
  copyFile as copyFile3,
  mkdir as mkdir8,
  open as open3,
  readFile as readFile6,
  rename as rename8,
  rm as rm8,
  stat as stat6,
  statfs as statfs3,
  writeFile as writeFile6
} from "node:fs/promises";
import { totalmem as totalmem3 } from "node:os";
import { isAbsolute as isAbsolute5, join as join9, resolve as resolve4 } from "node:path";
import { StringDecoder as StringDecoder3 } from "node:string_decoder";

// native/media/media-tts-provider-script.ts
var MANAGED_TTS_SCRIPT = String.raw`
import asyncio, importlib.metadata, json, os, pathlib, re, socket, sys

request = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
provider = request["providerId"]
action = request["action"]
def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)

if provider == "edge-tts":
    import edge_tts
    async def edge():
        if action == "probe":
            emit({"result": {"version": importlib.metadata.version("edge-tts")}})
        elif action == "voices":
            voices = await edge_tts.list_voices()
            emit({"result": {"voices": [{"id": v["ShortName"], "name": v.get("FriendlyName", v["ShortName"]), "language": v["Locale"]} for v in voices]}})
        elif action == "generate":
            rate = f'{round((request["rate"] - 1) * 100):+d}%'
            speak = edge_tts.Communicate(request["text"], request["voiceId"], rate=rate)
            count = 0
            with open(request["output"], "wb") as output:
                async for chunk in speak.stream():
                    if chunk["type"] == "audio":
                        count += len(chunk["data"])
                        if count > 64 * 1024 * 1024:
                            raise ValueError("Audio exceeds its bounded download budget")
                        output.write(chunk["data"])
                        emit({"progress": {"stage": "speech", "message": "正在接收在线配音", "bytes": count}})
            emit({"result": {"bytes": count}})
        else:
            raise ValueError("Unsupported action")
    asyncio.run(edge())
elif provider == "kokoro":
    # Local generation must never silently fetch a model or contact an online provider.
    def offline(*args, **kwargs):
        raise RuntimeError("Kokoro synthesis is offline; network access is disabled")
    socket.create_connection = offline
    socket.socket.connect = offline
    socket.socket.connect_ex = offline
    import numpy as np
    import kokoro_onnx
    import soundfile as sf
    from misaki.zh import ZHG2P
    if action == "probe":
        emit({"result": {"version": importlib.metadata.version("kokoro-onnx"), "frontend": importlib.metadata.version("misaki")}})
    elif action == "voices":
        with np.load(request["voicesPath"], allow_pickle=False) as voices:
            supported = []
            for name in sorted(voices.files):
                language = "zh-CN" if name.startswith("z") else "en-US" if name.startswith("a") else "en-GB" if name.startswith("b") else None
                if language:
                    supported.append({"id": name, "name": name, "language": language})
            emit({"result": {"voices": supported}})
    elif action == "generate":
        import onnxruntime as ort
        from kokoro_onnx.tokenizer import Tokenizer
        config = ort.SessionOptions()
        config.intra_op_num_threads = min(4, os.cpu_count() or 1)
        config.inter_op_num_threads = 1
        session = ort.InferenceSession(request["modelPath"], sess_options=config, providers=["CPUExecutionProvider"])
        model = kokoro_onnx.Kokoro.from_session(session, request["voicesPath"])
        voice = request["voiceId"]
        segments = [s.strip() for s in re.split(r"(?<=[。！？.!?；;])|\n+", request["text"]) if s.strip()]
        parts = []
        frames = 0
        zh = ZHG2P() if voice.startswith("z") else None
        for index, segment in enumerate(segments):
            if zh:
                # Keep English insertions pronounceable instead of passing Latin letters as IPA.
                phonemes = ""
                for piece in re.findall(r"[A-Za-z][A-Za-z '\-]*|[^A-Za-z]+", segment):
                    phonemes += (model.tokenizer.phonemize(piece, "en-us") if re.match(r"[A-Za-z]", piece) else zh(piece)[0]) + " "
                samples, sr = model.create(phonemes, voice=voice, speed=request["rate"], is_phonemes=True)
            else:
                if re.search(r"[\u4e00-\u9fff]", segment):
                    raise ValueError("Choose a Chinese voice for Chinese text")
                samples, sr = model.create(segment, voice=voice, speed=request["rate"], lang="en-gb" if voice.startswith("b") else "en-us")
            frames += len(samples)
            if frames > 24000 * 1800:
                raise ValueError("Speech exceeds 30 minutes")
            parts.append(samples)
            emit({"progress": {"fraction": 0.1 + 0.7 * (index + 1) / len(segments), "stage": "speech", "message": "正在本地生成配音"}})
        if not parts:
            raise ValueError("No spoken text")
        audio = np.concatenate(parts)
        if not np.isfinite(audio).all() or np.max(np.abs(audio)) < 0.0001:
            raise ValueError("Speech output is empty or silent")
        sf.write(request["output"], audio, 24000, subtype="PCM_16")
        emit({"result": {"durationSeconds": len(audio) / 24000}})
    else:
        raise ValueError("Unsupported action")
else:
    raise ValueError("Unsupported provider")
`;

// native/media/media-tts-setup-cleanup.ts
import { rm as rm6 } from "node:fs/promises";
async function releaseManagedTtsSetupResources(lock, lockPath, sample, primaryFailure) {
  const failures = [];
  const attempt = async (cleanup) => {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  };
  if (lock) {
    await attempt(() => lock.close());
    await attempt(() => rm6(lockPath, { force: true }));
  }
  if (sample) await attempt(() => rm6(sample, { force: true }));
  if (failures.length === 0) return;
  if (primaryFailure) {
    primaryFailure.cause = new AggregateError(
      [...primaryFailure.cause === void 0 ? [] : [primaryFailure.cause], ...failures],
      "Managed speech setup failed and resource cleanup also failed"
    );
  } else {
    throw new AggregateError(failures, "Managed speech setup resource cleanup failed");
  }
}

// native/media/media-tts.ts
import { createHash as createHash5, randomUUID as randomUUID7 } from "node:crypto";
import { createReadStream as createReadStream3 } from "node:fs";
import { copyFile as copyFile2, mkdir as mkdir7, readFile as readFile5, rename as rename7, rm as rm7, stat as stat5, writeFile as writeFile5 } from "node:fs/promises";
import { release } from "node:os";
import { join as join8 } from "node:path";
var CACHE_VERSION = 1;
var MAX_AUDIO_SECONDS = 30 * 60;
var MAX_WAV_BYTES = MAX_AUDIO_SECONDS * 48e3 * 2 + 4096;
function validateLocalTtsInput2(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("配音参数必须是对象");
  const input = raw;
  if (typeof input.text !== "string") throw new Error("请输入配音文字");
  const text2 = input.text.replace(/\r\n?/g, "\n").trim();
  if (!text2 || Array.from(text2).length > 6e3) throw new Error("配音文字须为 1 至 6000 字");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text2) || /\[\[|\]\]/.test(text2))
    throw new Error("配音仅支持普通文字，不支持语音控制标记或控制字符");
  let voiceId;
  if (input.voiceId !== void 0) {
    if (typeof input.voiceId !== "string" || !input.voiceId.trim() || input.voiceId.length > 200)
      throw new Error("声音标识无效");
    voiceId = input.voiceId.trim();
  }
  const rate = input.rate === void 0 ? 1 : input.rate;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0.5 || rate > 2)
    throw new Error("语速须在 0.5 至 2 倍之间");
  return { text: text2, ...voiceId ? { voiceId } : {}, rate };
}
async function detectLocalTts(options = {}) {
  if (options.signal?.aborted) throw mediaAbortError();
  if (process.platform !== "darwin")
    return {
      available: false,
      engine: "unavailable",
      voices: [],
      reason: "当前内置配音使用 macOS 系统声音；此系统暂不支持本地配音"
    };
  const signal = options.signal ?? AbortSignal.timeout(1e4);
  const say = options.sayPath ?? "/usr/bin/say";
  try {
    const [listed, binary, ffmpeg, ffprobe] = await Promise.all([
      runMediaProcess(say, ["-v", "?"], { signal, maxStdoutBytes: 256 * 1024 }),
      stat5(say),
      runMediaProcess(options.ffmpegPath ?? "ffmpeg", ["-version"], { signal }),
      runMediaProcess(options.ffprobePath ?? "ffprobe", ["-version"], { signal })
    ]);
    const voices = [];
    for (const line of listed.stdout.toString("utf8").split(/\r?\n/)) {
      const match = /^(.+?)\s+([a-z]{2,3}_[A-Z0-9]{2,3})\s+#/.exec(line);
      if (match) voices.push({ id: match[1].trim(), name: match[1].trim(), language: match[2] });
    }
    if (!voices.length) throw new Error("未发现已安装的系统声音");
    const preferred = voices.find((voice) => voice.id === "Tingting") ?? voices.find((voice) => voice.language === "zh_CN") ?? voices.find((voice) => voice.id === "Samantha") ?? voices[0];
    return {
      available: true,
      engine: "macos-say",
      version: [
        `macOS-${release()}`,
        `say-${binary.size}-${binary.mtimeMs}`,
        ffmpeg.stdout.toString("utf8").split("\n")[0],
        ffprobe.stdout.toString("utf8").split("\n")[0]
      ].join("; "),
      voices,
      defaultVoiceId: preferred.id
    };
  } catch (error) {
    if (options.signal?.aborted) throw mediaAbortError();
    return {
      available: false,
      engine: "unavailable",
      voices: [],
      reason: `本地配音需要已安装的系统声音、FFmpeg 和 ffprobe：${error instanceof Error ? error.message : String(error)}`
    };
  }
}
async function digestFile(path, signal) {
  const hash2 = createHash5("sha256");
  for await (const chunk of createReadStream3(path, { signal })) hash2.update(chunk);
  return hash2.digest("hex");
}
async function inspectWav(path, signal, options) {
  const info = await stat5(path);
  if (!info.isFile() || info.size <= 44 || info.size > MAX_WAV_BYTES)
    throw new Error("系统未生成有效或大小合适的语音文件");
  const probe = await runMediaProcess(
    options.ffprobePath ?? "ffprobe",
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-format_whitelist",
      "wav",
      "-show_entries",
      "format=duration:stream=codec_type,codec_name,sample_rate,channels",
      "-of",
      "json",
      path
    ],
    { signal }
  );
  const result = JSON.parse(probe.stdout.toString("utf8"));
  const audio = result.streams?.find(
    (stream) => stream.codec_type === "audio"
  );
  const durationSeconds = Number(result.format?.duration);
  if (!audio || audio.codec_name !== "pcm_s16le" || Number(audio.sample_rate) !== 48e3 || audio.channels !== 1 || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_AUDIO_SECONDS)
    throw new Error("系统配音不是有效的 48kHz 单声道 WAV，或超过 30 分钟");
  return { durationSeconds, bytes: info.size };
}
async function generateLocalTts(raw, context, options = {}) {
  const input = validateLocalTtsInput2(raw);
  if (context.signal.aborted) throw mediaAbortError();
  const deadline = AbortSignal.timeout(18e4);
  const signal = AbortSignal.any([context.signal, deadline]);
  const runtime = await detectLocalTts({ ...options, signal });
  if (!runtime.available) throw new Error(runtime.reason);
  const voice = runtime.voices.find(
    (item) => item.id === (input.voiceId ?? runtime.defaultVoiceId)
  );
  if (!voice) throw new Error("所选声音未安装，请选择列表中的系统声音");
  const cacheKey = createHash5("sha256").update(
    JSON.stringify({
      version: CACHE_VERSION,
      runtime: runtime.version,
      voice,
      text: input.text,
      rate: input.rate
    })
  ).digest("hex");
  const nonce = randomUUID7();
  const output = join8(context.outputDir, `speech-${nonce}.wav`);
  const textPath = join8(context.workDir, `speech-${nonce}.txt`);
  const aiff = join8(context.workDir, `speech-${nonce}.aiff`);
  const partial = join8(context.outputDir, `speech-${nonce}.partial.wav`);
  const cacheWav = join8(context.cacheDir, `tts-${cacheKey}.wav`);
  const cacheJson = join8(context.cacheDir, `tts-${cacheKey}.json`);
  const cacheTemp = join8(context.cacheDir, `tts-${cacheKey}-${nonce}.tmp.wav`);
  const metadataTemp = join8(context.cacheDir, `tts-${cacheKey}-${nonce}.tmp.json`);
  let completed = false;
  try {
    for (const directory of [context.workDir, context.outputDir, context.cacheDir])
      await mkdir7(directory, { recursive: true });
    await context.reportProgress({
      fraction: 0.03,
      stage: "speech",
      message: "检查系统声音与配音缓存"
    });
    let cachedMetadata;
    try {
      if ((await stat5(cacheJson)).size > 4096) throw new Error("Oversized speech cache metadata");
      const cached = JSON.parse(await readFile5(cacheJson, "utf8"));
      const metadata2 = await inspectWav(cacheWav, signal, options);
      if (cached.version !== CACHE_VERSION || cached.cacheKey !== cacheKey || cached.bytes !== metadata2.bytes || cached.durationSeconds !== metadata2.durationSeconds || cached.sha256 !== await digestFile(cacheWav, signal))
        throw new Error("Stale speech cache");
      cachedMetadata = metadata2;
    } catch (error) {
      if (signal.aborted) throw error;
    }
    if (cachedMetadata) {
      await copyFile2(cacheWav, partial);
      if (signal.aborted) throw mediaAbortError();
      await rename7(partial, output);
      await context.reportProgress({
        fraction: 1,
        stage: "speech",
        message: "已复用相同文字的本地配音"
      });
      if (signal.aborted) throw mediaAbortError();
      completed = true;
      return {
        path: output,
        mimeType: "audio/wav",
        engine: "macos-say",
        voice,
        rate: input.rate,
        durationSeconds: cachedMetadata.durationSeconds,
        sampleRate: 48e3,
        channels: 1,
        cached: true,
        cacheKey
      };
    }
    await writeFile5(textPath, input.text, { encoding: "utf8", mode: 384, flag: "wx" });
    await context.reportProgress({
      fraction: 0.12,
      stage: "synthesize",
      message: `正在用 ${voice.name} 生成配音`
    });
    await runMediaProcess(
      options.sayPath ?? "/usr/bin/say",
      ["-v", voice.id, "-r", String(Math.round(175 * input.rate)), "-f", textPath, "-o", aiff],
      { signal }
    );
    await context.reportProgress({ fraction: 0.7, stage: "encode", message: "正在整理语音音轨" });
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
        "aiff",
        "-i",
        aiff,
        "-map",
        "0:a:0",
        "-vn",
        "-af",
        "loudnorm=I=-18:TP=-2:LRA=11",
        "-ar",
        "48000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        partial
      ],
      { signal }
    );
    const metadata = await inspectWav(partial, signal, options);
    const sha256 = await digestFile(partial, signal);
    await copyFile2(partial, cacheTemp);
    await writeFile5(
      metadataTemp,
      JSON.stringify({ version: CACHE_VERSION, cacheKey, sha256, ...metadata }),
      { mode: 384, flag: "wx" }
    );
    if (signal.aborted) throw mediaAbortError();
    await rename7(cacheTemp, cacheWav);
    await rename7(metadataTemp, cacheJson);
    await rename7(partial, output);
    await context.reportProgress({ fraction: 1, stage: "speech", message: "本地配音已生成" });
    if (signal.aborted) throw mediaAbortError();
    completed = true;
    return {
      path: output,
      mimeType: "audio/wav",
      engine: "macos-say",
      voice,
      rate: input.rate,
      durationSeconds: metadata.durationSeconds,
      sampleRate: 48e3,
      channels: 1,
      cached: false,
      cacheKey
    };
  } catch (error) {
    if (context.signal.aborted) throw mediaAbortError();
    if (deadline.aborted)
      throw new Error("系统配音超过 3 分钟处理时限，请缩短文字后重试", { cause: error });
    throw error;
  } finally {
    await Promise.all(
      [textPath, aiff, partial, cacheTemp, metadataTemp, ...completed ? [] : [output]].map(
        (path) => rm7(path, { force: true })
      )
    );
  }
}

// native/media/media-tts-providers.ts
var VERSION = 1;
var SCRIPT_HASH3 = createHash6("sha256").update(MANAGED_TTS_SCRIPT).digest("hex");
var PACKAGES3 = {
  "edge-tts": ["edge-tts==7.2.8"],
  kokoro: ["kokoro-onnx==0.6.1", "misaki[zh]==0.9.4", "soundfile==0.14.0", "onnxruntime==1.29.0"]
};
var RESOURCES2 = [
  {
    name: "kokoro-v1.0.onnx",
    reuse: "models",
    bytes: 325532387,
    sha256: "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5"
  },
  {
    name: "voices-v1.0.bin",
    reuse: "voices",
    bytes: 28214398,
    sha256: "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d"
  }
];
var setupOwners = /* @__PURE__ */ new Set();
function validateManagedTtsProviderId(raw) {
  if (raw !== "edge-tts" && raw !== "kokoro")
    throw new Error("仅支持白名单中的 Edge TTS 或 Kokoro");
  return raw;
}
function validateManagedTtsInput(raw) {
  const normalized = validateLocalTtsInput2(raw);
  const providerId = validateManagedTtsProviderId(raw.providerId);
  if (!/[\p{L}\p{N}]/u.test(normalized.text)) throw new Error("配音文字至少需要一个可朗读的字词");
  return { providerId, ...normalized };
}
async function digest3(path, signal) {
  const hash2 = createHash6("sha256");
  for await (const chunk of createReadStream4(path, { signal })) hash2.update(chunk);
  return hash2.digest("hex");
}
async function jsonFile(path, maxBytes = 256 * 1024) {
  if ((await stat6(path)).size > maxBytes) throw new Error("Runtime metadata exceeds its budget");
  return JSON.parse(await readFile6(path, "utf8"));
}
async function atomicJson(path, value) {
  const temporary = `${path}-${randomUUID8()}.partial`;
  try {
    await writeFile6(temporary, JSON.stringify(value), { mode: 384 });
    await rename8(temporary, path);
  } finally {
    await rm8(temporary, { force: true });
  }
}
async function downloadResource(resource, target, context, signal) {
  let url = `https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/${resource.name}`;
  let response;
  for (let redirects = 0; redirects <= 4; redirects++) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || ![
      "github.com",
      "release-assets.githubusercontent.com",
      "objects.githubusercontent.com"
    ].includes(parsed.hostname))
      throw new Error("模型下载地址不在受信任的发布源内");
    response = await fetch(url, { signal, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("模型下载重定向无效");
      url = new URL(location, url).href;
    } else break;
  }
  if (!response?.ok || !response.body) throw new Error("模型下载失败，请检查网络后重试");
  const declared = Number(response.headers.get("content-length"));
  if (declared && declared !== resource.bytes) {
    await response.body.cancel();
    throw new Error("模型下载大小与固定版本不一致");
  }
  const partial = `${target}-${randomUUID8()}.partial`;
  const handle = await open3(partial, "wx", 384);
  const reader = response.body.getReader();
  let bytes = 0;
  let last = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > resource.bytes) throw new Error("模型下载超出固定大小预算");
      let written = 0;
      while (written < value.byteLength) {
        const chunk = await handle.write(value.subarray(written));
        if (!chunk.bytesWritten) throw new Error("模型文件写入失败");
        written += chunk.bytesWritten;
      }
      if (Date.now() - last > 250) {
        last = Date.now();
        await context.reportProgress({
          fraction: 0.3 + 0.35 * bytes / resource.bytes,
          stage: "download",
          message: `正在下载 ${resource.name}：${Math.round(bytes / 1048576)} / ${Math.round(resource.bytes / 1048576)} MB`
        });
      }
    }
    await handle.close();
    if (bytes !== resource.bytes || await digest3(partial, signal) !== resource.sha256)
      throw new Error("模型校验失败，未启用该资源");
    if (signal.aborted) throw mediaAbortError();
    await rename8(partial, target);
  } finally {
    await reader.cancel().catch(() => {
    });
    await handle.close().catch(() => {
    });
    await rm8(partial, { force: true });
  }
}
function createManagedTtsProviders(options) {
  if (!isAbsolute5(options.runtimeDir))
    throw new Error("TTS runtimeDir must be an absolute Host path");
  const root = resolve4(options.runtimeDir);
  const directory = (id2) => join9(root, id2);
  const python = (id2) => join9(directory(id2), "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const script = (id2) => join9(directory(id2), "runner.py");
  const manifestPath = (id2) => join9(directory(id2), "runtime.json");
  const isolatedEnvironment = () => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (/^(UV_|PIP_|PYTHON|VIRTUAL_ENV|CONDA|PHONEMIZER_ESPEAK_LIBRARY)/i.test(key))
        delete env[key];
    }
    return {
      ...env,
      UV_CACHE_DIR: join9(root, "package-cache"),
      UV_NO_CONFIG: "1",
      PYTHONNOUSERSITE: "1"
    };
  };
  function baseStatus(id2) {
    return {
      id: id2,
      name: id2 === "kokoro" ? "Kokoro 本地声音" : "Edge 在线声音（第三方客户端）",
      mode: id2 === "kokoro" ? "offline" : "online",
      state: "not-installed",
      available: false,
      installed: false,
      voices: [],
      downloadBytes: id2 === "kokoro" ? 550 * 1048576 : 25 * 1048576,
      requiredDiskBytes: id2 === "kokoro" ? 2 * 1024 ** 3 : 256 * 1048576
    };
  }
  async function loadManifest(id2) {
    const value = await jsonFile(manifestPath(id2));
    if (value.version !== VERSION || value.scriptHash !== SCRIPT_HASH3 || JSON.stringify(value.packages) !== JSON.stringify(PACKAGES3[id2]) || !Array.isArray(value.voices) || !value.voices.length || value.voices.length > 2e3 || value.voices.some(
      (v) => typeof v.id !== "string" || typeof v.name !== "string" || typeof v.language !== "string"
    ) || !value.voices.some((v) => v.id === value.defaultVoiceId))
      throw new Error("Stale runtime manifest");
    return value;
  }
  async function status(rawId, signal) {
    const id2 = validateManagedTtsProviderId(rawId);
    if (signal?.aborted) throw mediaAbortError();
    const result = baseStatus(id2);
    if (!["darwin", "linux"].includes(process.platform) || !["arm64", "x64"].includes(process.arch))
      return {
        ...result,
        state: "unavailable",
        reason: "当前安装器仅支持 macOS / Linux 的 ARM64 或 x64；请使用其他已配置声音"
      };
    if (id2 === "kokoro" && totalmem3() < 4 * 1024 ** 3)
      return { ...result, state: "unavailable", reason: "Kokoro 本地推理至少需要 4 GB 内存" };
    try {
      result.installed = (await stat6(python(id2))).isFile();
    } catch {
    }
    if (setupOwners.has(directory(id2)))
      return { ...result, state: "installing", reason: "正在准备并验证声音资源" };
    try {
      const manifest = await loadManifest(id2);
      if (!result.installed || await readFile6(script(id2), "utf8") !== MANAGED_TTS_SCRIPT)
        throw new Error("Incomplete runtime");
      if (id2 === "kokoro") {
        for (const resource of RESOURCES2)
          if ((await stat6(join9(directory(id2), resource.name))).size !== resource.bytes)
            throw new Error("Incomplete model");
      }
      return {
        ...result,
        state: manifest.state,
        available: manifest.state === "ready",
        voices: manifest.voices,
        defaultVoiceId: manifest.defaultVoiceId,
        reason: manifest.reason,
        verifiedAt: manifest.verifiedAt,
        version: PACKAGES3[id2].join("; ")
      };
    } catch {
      let reason;
      try {
        reason = (await jsonFile(join9(directory(id2), "failure.json"), 4096)).reason;
      } catch {
      }
      return {
        ...result,
        state: reason ? "failed" : result.installed ? "needs-setup" : "not-installed",
        reason: reason ?? "需要准备客户端与声音资源；完成短句验证后才能使用"
      };
    }
  }
  async function execute(id2, data, context, signal) {
    await mkdir8(context.workDir, { recursive: true });
    const requestPath = join9(context.workDir, `tts-request-${randomUUID8()}.json`);
    await writeFile6(
      requestPath,
      JSON.stringify({
        providerId: id2,
        modelPath: join9(directory(id2), RESOURCES2[0].name),
        voicesPath: join9(directory(id2), RESOURCES2[1].name),
        ...data
      }),
      { mode: 384 }
    );
    let buffer = "";
    const decoder = new StringDecoder3("utf8");
    let result;
    let last = 0;
    let progress = Promise.resolve();
    try {
      await runMediaProcess(python(id2), ["-I", script(id2), requestPath], {
        signal,
        env: isolatedEnvironment(),
        onStdout(chunk) {
          buffer += decoder.write(chunk);
          if (Buffer.byteLength(buffer) > 1024 * 1024)
            throw new Error("TTS runtime response exceeds budget");
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            let value;
            try {
              value = JSON.parse(line);
            } catch {
              continue;
            }
            if (value.result) result = value.result;
            if (value.progress && Date.now() - last > 250) {
              last = Date.now();
              const update = value.progress;
              progress = progress.then(
                () => context.reportProgress({
                  fraction: typeof update.fraction === "number" ? update.fraction : void 0,
                  stage: "speech",
                  message: id2 === "kokoro" ? "正在本地生成配音" : "正在接收在线配音"
                })
              );
              void progress.catch(() => {
              });
            }
          }
        }
      });
      await progress;
      if (!result) throw new Error("TTS runtime did not return a complete result");
      return result;
    } finally {
      await progress.catch(() => {
      });
      await rm8(requestPath, { force: true });
    }
  }
  async function checkTools(signal) {
    await Promise.all([
      runMediaProcess(options.ffmpegPath ?? "ffmpeg", ["-version"], { signal }),
      runMediaProcess(options.ffprobePath ?? "ffprobe", ["-version"], { signal })
    ]);
  }
  async function inspect(path, signal) {
    const size = (await stat6(path)).size;
    if (size < 44 || size > 1800 * 48e3 * 2 + 4096)
      throw new Error("配音音频为空或超出 30 分钟预算");
    const probe = await runMediaProcess(
      options.ffprobePath ?? "ffprobe",
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "wav",
        "-show_entries",
        "format=duration:stream=codec_name,sample_rate,channels",
        "-of",
        "json",
        path
      ],
      { signal }
    );
    const metadata = JSON.parse(probe.stdout.toString("utf8"));
    const audio = metadata.streams?.[0];
    const durationSeconds = Number(metadata.format?.duration);
    if (audio?.codec_name !== "pcm_s16le" || Number(audio.sample_rate) !== 48e3 || audio.channels !== 1 || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 1800)
      throw new Error("未生成合格的 48 kHz WAV 配音");
    const volume = await runMediaProcess(
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
        "-"
      ],
      { signal }
    );
    const peak = /max_volume: ([-\d.]+) dB/.exec(volume.stderr);
    if (!peak || Number(peak[1]) < -70) throw new Error("配音输出没有可听见的声音");
    return { durationSeconds, bytes: size };
  }
  async function render(id2, input, voice, context, signal) {
    await mkdir8(context.outputDir, { recursive: true });
    const nonce = randomUUID8();
    const raw = join9(context.workDir, `tts-${nonce}.${id2 === "kokoro" ? "wav" : "mp3"}`);
    const partial = join9(context.outputDir, `speech-${nonce}.partial.wav`);
    const output = join9(context.outputDir, `speech-${nonce}.wav`);
    let complete = false;
    try {
      await execute(
        id2,
        { action: "generate", text: input.text, voiceId: voice.id, rate: input.rate, output: raw },
        context,
        signal
      );
      await context.reportProgress({
        fraction: 0.86,
        stage: "speech",
        message: "正在统一音频格式并验证真实声音"
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
          id2 === "kokoro" ? "wav" : "mp3",
          "-i",
          raw,
          "-map",
          "0:a:0",
          "-vn",
          "-ac",
          "1",
          "-ar",
          "48000",
          "-c:a",
          "pcm_s16le",
          "-fs",
          String(1800 * 48e3 * 2 + 1048576),
          partial
        ],
        { signal }
      );
      const metadata = await inspect(partial, signal);
      if (signal.aborted) throw mediaAbortError();
      await rename8(partial, output);
      complete = true;
      return { path: output, ...metadata };
    } finally {
      await Promise.all([
        rm8(raw, { force: true }),
        rm8(partial, { force: true }),
        ...!complete ? [rm8(output, { force: true })] : []
      ]);
    }
  }
  async function resources(id2, context, signal) {
    if (id2 !== "kokoro") return;
    for (const resource of RESOURCES2) {
      const target = join9(directory(id2), resource.name);
      const valid = async (path) => {
        try {
          return (await stat6(path)).size === resource.bytes && await digest3(path, signal) === resource.sha256;
        } catch (error) {
          if (signal.aborted) throw error;
          return false;
        }
      };
      if (await valid(target)) continue;
      const candidates = options.reuseKokoroDir ? [
        join9(options.reuseKokoroDir, resource.reuse, resource.name),
        join9(options.reuseKokoroDir, resource.name)
      ] : [];
      let reuse;
      for (const candidate of candidates)
        if (await valid(candidate)) {
          reuse = candidate;
          break;
        }
      if (reuse) {
        await context.reportProgress({
          fraction: 0.55,
          stage: "resources",
          message: `正在复用已校验的 ${resource.name}`
        });
        await copyFile3(reuse, target);
      } else await downloadResource(resource, target, context, signal);
    }
  }
  async function setup(rawId, context) {
    const id2 = validateManagedTtsProviderId(rawId);
    if (context.signal.aborted) throw mediaAbortError();
    const initial = await status(id2);
    if (initial.state === "unavailable") throw new Error(initial.reason);
    const dir = directory(id2);
    if (setupOwners.has(dir)) throw new Error("这个声音服务正在准备，请等待当前任务或取消它");
    setupOwners.add(dir);
    const deadline = AbortSignal.timeout(20 * 6e4);
    const signal = AbortSignal.any([context.signal, deadline]);
    let lock;
    const lockPath = join9(dir, "setup.lock");
    let sample;
    let setupFailure;
    try {
      await mkdir8(dir, { recursive: true });
      try {
        lock = await open3(lockPath, "wx", 384);
      } catch {
        const existing = await jsonFile(lockPath, 4096).catch(() => null);
        let alive2 = false;
        if (Number.isSafeInteger(existing?.pid)) {
          try {
            process.kill(existing.pid, 0);
            alive2 = true;
          } catch {
          }
        }
        if (alive2) throw new Error("另一个宿主正在准备这个声音服务");
        await rm8(lockPath, { force: true });
        lock = await open3(lockPath, "wx", 384);
      }
      await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
      const disk = await statfs3(dir);
      if (disk.bavail * disk.bsize < initial.requiredDiskBytes)
        throw new Error(
          `空间不足，至少需要 ${Math.ceil(initial.requiredDiskBytes / 1024 ** 3)} GB 可用空间`
        );
      await checkTools(signal);
      await context.reportProgress({
        fraction: 0.02,
        stage: "setup",
        message: `准备独立 Python 环境；预计下载约 ${Math.ceil(initial.downloadBytes / 1048576)} MB，已有模型可复用`
      });
      await writeFile6(script(id2), MANAGED_TTS_SCRIPT, { mode: 384 });
      let installed = false;
      try {
        const version = await execute(id2, { action: "probe" }, context, signal);
        installed = version.version === (id2 === "kokoro" ? "0.6.1" : "7.2.8") && (id2 !== "kokoro" || version.frontend === "0.9.4");
      } catch (error) {
        if (signal.aborted) throw error;
      }
      if (!installed) {
        const uv = options.uvPath ?? "uv";
        await runMediaProcess(
          uv,
          [
            "venv",
            "--clear",
            "--no-config",
            "--python",
            options.pythonPath ?? "3.12",
            "--no-python-downloads",
            join9(dir, "venv")
          ],
          { signal, env: isolatedEnvironment() }
        );
        await context.reportProgress({
          fraction: 0.1,
          stage: "install",
          message: "正在安装固定版本的声音客户端与依赖"
        });
        await runMediaProcess(
          uv,
          [
            "pip",
            "install",
            "--no-config",
            "--python",
            python(id2),
            "--index-url",
            "https://pypi.org/simple",
            ...PACKAGES3[id2]
          ],
          { signal, env: isolatedEnvironment(), maxStdoutBytes: 2 * 1024 * 1024 }
        );
      }
      await resources(id2, context, signal);
      await context.reportProgress({
        fraction: 0.7,
        stage: "verify",
        message: id2 === "kokoro" ? "验证本地模型和中文声音" : "向在线服务获取实际可用声音"
      });
      const listed = await execute(id2, { action: "voices" }, context, signal);
      const voices = listed.voices;
      if (!Array.isArray(voices) || !voices.length || voices.length > 2e3)
        throw new Error("没有找到可使用的声音");
      const voice = voices.find((v) => v.id === (id2 === "kokoro" ? "zf_xiaobei" : "zh-CN-XiaoxiaoNeural")) ?? voices.find((v) => v.language === "zh-CN");
      if (!voice) throw new Error("没有找到可验证的中文声音");
      const validation = await render(
        id2,
        { providerId: id2, text: "你好，这是视频工作台的中文声音测试。", rate: 1 },
        voice,
        context,
        signal
      );
      sample = validation.path;
      if (signal.aborted) throw mediaAbortError();
      await atomicJson(manifestPath(id2), {
        version: VERSION,
        scriptHash: SCRIPT_HASH3,
        packages: PACKAGES3[id2],
        verifiedAt: Date.now(),
        voices,
        defaultVoiceId: voice.id,
        state: "ready"
      });
      await rm8(join9(dir, "failure.json"), { force: true });
      await context.reportProgress({
        fraction: 1,
        stage: "ready",
        message: "已通过真实中文配音验证，可以使用"
      });
    } catch (error) {
      if (!lock) {
        setupFailure = error instanceof Error ? error : new Error(String(error));
        throw setupFailure;
      }
      const reason = signal.aborted ? context.signal.aborted ? "声音准备已取消，可以重新准备" : "声音准备超时，请检查网络和运行环境后重试" : id2 === "edge-tts" ? "Edge 在线声音准备失败；需要 uv、Python 3.12、FFmpeg 及可访问的在线语音服务，可选择系统声音或本地 Kokoro" : "Kokoro 准备失败；需要 uv、Python 3.12、FFmpeg、可用依赖与完整模型，请检查网络和空间后重试";
      await atomicJson(join9(dir, "failure.json"), { reason, at: Date.now() }).catch(() => {
      });
      try {
        const manifest = await loadManifest(id2);
        await atomicJson(manifestPath(id2), { ...manifest, state: "failed", reason });
      } catch {
      }
      setupFailure = context.signal.aborted ? mediaAbortError() : new Error(reason, { cause: error });
      throw setupFailure;
    } finally {
      setupOwners.delete(dir);
      await releaseManagedTtsSetupResources(lock, lockPath, sample, setupFailure);
    }
    return status(id2);
  }
  async function generate(raw, context) {
    const input = validateManagedTtsInput(raw);
    const id2 = input.providerId;
    if (context.signal.aborted) throw mediaAbortError();
    const runtime = await status(id2, context.signal);
    if (!runtime.available) throw new Error(runtime.reason ?? "请先准备并验证所选声音服务");
    const voice = runtime.voices.find((v) => v.id === (input.voiceId ?? runtime.defaultVoiceId));
    if (!voice) throw new Error("所选声音不在已验证的声音列表中，请刷新声音服务");
    const deadline = AbortSignal.timeout(10 * 6e4);
    const signal = AbortSignal.any([context.signal, deadline]);
    await checkTools(signal);
    if (id2 === "kokoro") {
      for (const resource of RESOURCES2)
        if (await digest3(join9(directory(id2), resource.name), signal) !== resource.sha256) {
          const reason = "本地模型校验失败，请重新准备声音服务";
          const manifest = await loadManifest(id2);
          await atomicJson(manifestPath(id2), { ...manifest, state: "failed", reason });
          throw new Error(reason);
        }
    }
    const cacheKey = createHash6("sha256").update(
      JSON.stringify({
        version: VERSION,
        scriptHash: SCRIPT_HASH3,
        packages: PACKAGES3[id2],
        resources: id2 === "kokoro" ? RESOURCES2 : [],
        input: { ...input, voiceId: voice.id }
      })
    ).digest("hex");
    await mkdir8(context.cacheDir, { recursive: true });
    const cacheWav = join9(context.cacheDir, `speech-${cacheKey}.wav`);
    const cacheMeta = join9(context.cacheDir, `speech-${cacheKey}.json`);
    try {
      const cached = await jsonFile(cacheMeta, 4096);
      if (cached.cacheKey !== cacheKey || await digest3(cacheWav, signal) !== cached.sha256)
        throw new Error("Invalid speech cache");
      const metadata = await inspect(cacheWav, signal);
      await mkdir8(context.outputDir, { recursive: true });
      const output = join9(context.outputDir, `speech-${randomUUID8()}.wav`);
      await copyFile3(cacheWav, output);
      if (signal.aborted) {
        await rm8(output, { force: true });
        throw mediaAbortError();
      }
      await context.reportProgress({
        fraction: 1,
        stage: "speech",
        message: "已复用相同文案、声音和语速的配音"
      });
      return {
        path: output,
        mimeType: "audio/wav",
        engine: id2,
        voice,
        rate: input.rate,
        durationSeconds: metadata.durationSeconds,
        sampleRate: 48e3,
        channels: 1,
        cached: true
      };
    } catch (error) {
      if (signal.aborted) throw error;
    }
    try {
      const result = await render(id2, input, voice, context, signal);
      const temporary = `${cacheWav}-${randomUUID8()}.partial`;
      try {
        await copyFile3(result.path, temporary);
        await rename8(temporary, cacheWav);
        await atomicJson(cacheMeta, { cacheKey, sha256: await digest3(cacheWav, signal) });
      } finally {
        await rm8(temporary, { force: true });
      }
      await context.reportProgress({
        fraction: 1,
        stage: "speech",
        message: "配音已生成并验证，可以用于导出"
      });
      return {
        path: result.path,
        mimeType: "audio/wav",
        engine: id2,
        voice,
        rate: input.rate,
        durationSeconds: result.durationSeconds,
        sampleRate: 48e3,
        channels: 1,
        cached: false
      };
    } catch (error) {
      if (context.signal.aborted) throw mediaAbortError();
      const reason = id2 === "edge-tts" ? "Edge 在线配音失败，服务可能不可达；请重新验证或选择本地声音" : "Kokoro 本地配音失败，请检查文案语言和模型资源后重试";
      if (id2 === "edge-tts") {
        try {
          const manifest = await loadManifest(id2);
          await atomicJson(manifestPath(id2), { ...manifest, state: "failed", reason });
        } catch {
        }
      }
      throw new Error(reason, { cause: error });
    }
  }
  return { status, setup, generate };
}

// native/media/media-tts-openai.ts
import { randomUUID as randomUUID9 } from "node:crypto";
import { mkdir as mkdir9, open as open4, rename as rename9, rm as rm9, stat as stat7 } from "node:fs/promises";
import { join as join10 } from "node:path";
var MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
var MAX_DURATION_SECONDS = 600;
var WAV_TYPES = /* @__PURE__ */ new Set(["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"]);
var GENERIC_BINARY_TYPES = /* @__PURE__ */ new Set(["application/octet-stream", ""]);
var SpeechError = class extends Error {
};
function requestUrl(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new SpeechError("配音服务地址无效");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    throw new SpeechError(
      "配音服务须使用 HTTPS；本机兼容服务可使用回环 HTTP，地址不可包含凭据或查询参数"
    );
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/audio/speech`;
  return url;
}
function validateInput(input) {
  if (!input || typeof input.text !== "string" || !input.text.trim() || Array.from(input.text.trim()).length > 4096)
    throw new SpeechError("在线配音文稿须为 1 至 4096 字");
  for (const value of [input.model, input.voiceId])
    if (typeof value !== "string" || !value.trim() || value.length > 256 || /[\r\n\u0000]/.test(value))
      throw new SpeechError("配音模型或声音标识无效");
  if (!Number.isFinite(input.rate) || input.rate < 0.5 || input.rate > 2)
    throw new SpeechError("配音速度须在 0.5 至 2 倍之间");
  if (input.instructions !== void 0 && (typeof input.instructions !== "string" || Array.from(input.instructions).length > 4096))
    throw new SpeechError("声音风格说明不可超过 4096 字");
  return {
    ...input,
    text: input.text.trim(),
    model: input.model.trim(),
    voiceId: input.voiceId.trim()
  };
}
async function inspectWav2(path, signal, options) {
  const result = await runMediaProcess(
    options.ffprobePath ?? "ffprobe",
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-format_whitelist",
      "wav",
      "-show_entries",
      "format=duration:stream=codec_type,codec_name,sample_rate,channels",
      "-of",
      "json",
      path
    ],
    { signal }
  );
  const metadata = JSON.parse(result.stdout.toString("utf8"));
  const audio = metadata.streams?.find(
    (stream) => stream.codec_type === "audio"
  );
  const durationSeconds = Number(metadata.format?.duration);
  if (!audio || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_DURATION_SECONDS)
    throw new SpeechError("配音服务未返回有效音频，或音频超过 10 分钟");
  return {
    durationSeconds,
    sampleRate: Number(audio.sample_rate),
    channels: Number(audio.channels),
    codec: audio.codec_name
  };
}
async function saveResponse(response, path, signal, context) {
  if (!response.ok) {
    await response.body?.cancel().catch(() => void 0);
    throw new SpeechError(
      `配音服务请求失败（HTTP ${response.status}），请检查模型权限、额度或服务设置`
    );
  }
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const length = Number(response.headers.get("content-length")) || void 0;
  if (!WAV_TYPES.has(type) && !GENERIC_BINARY_TYPES.has(type) || !response.body) {
    await response.body?.cancel().catch(() => void 0);
    throw new SpeechError("配音服务未返回 WAV 音频");
  }
  if (length && (!Number.isSafeInteger(length) || length < 0 || length > MAX_RESPONSE_BYTES)) {
    await response.body.cancel().catch(() => void 0);
    throw new SpeechError("配音响应超过 64 MiB，已停止接收");
  }
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => void 0);
  };
  signal.addEventListener("abort", cancel, { once: true });
  let file;
  let bytes = 0, signature = Buffer.alloc(0), lastProgress = 0;
  try {
    file = await open4(path, "wx", 384);
    while (true) {
      if (signal.aborted) throw mediaAbortError();
      const { value, done } = await reader.read();
      if (signal.aborted) throw mediaAbortError();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new SpeechError("配音响应超过 64 MiB，已停止接收");
      if (signature.length < 12) {
        signature = Buffer.concat([
          signature,
          Buffer.from(value.subarray(0, 12 - signature.length))
        ]);
        if (signature.length === 12 && (signature.toString("ascii", 0, 4) !== "RIFF" || signature.toString("ascii", 8, 12) !== "WAVE"))
          throw new SpeechError("配音服务返回的数据不是 WAV 音频");
      }
      await file.writeFile(value);
      if (Date.now() - lastProgress >= 200) {
        lastProgress = Date.now();
        await context.reportProgress({
          stage: "speech-download",
          message: "正在接收生成的配音",
          ...length ? { fraction: Math.min(0.65, 0.1 + 0.55 * bytes / length) } : {}
        });
      }
    }
    if (bytes <= 44 || signature.length < 12 || length !== void 0 && bytes !== length)
      throw new SpeechError("配音服务返回的音频为空或不完整");
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => void 0);
    reader.releaseLock();
    await file?.close();
  }
}
async function generateOpenAiTts(raw, context, options) {
  const input = validateInput(raw), url = requestUrl(options.baseUrl);
  if (typeof options.apiKey !== "string" || !options.apiKey.trim() || /[\r\n]/.test(options.apiKey))
    throw new SpeechError("配音服务尚未配置有效凭据");
  const timeoutMs = options.timeoutMs ?? 18e4;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 6e5)
    throw new SpeechError("配音服务超时设置无效");
  if (context.signal.aborted) throw mediaAbortError();
  const deadline = AbortSignal.timeout(timeoutMs), signal = AbortSignal.any([context.signal, deadline]);
  const nonce = randomUUID9();
  const source = join10(context.workDir, `speech-response-${nonce}.wav`);
  const partial = join10(context.outputDir, `speech-${nonce}.partial.wav`);
  const output = join10(context.outputDir, `speech-${nonce}.wav`);
  let completed = false, failureMessage = "连接配音服务失败，请检查服务地址、凭据和网络";
  try {
    await mkdir9(context.workDir, { recursive: true });
    await mkdir9(context.outputDir, { recursive: true });
    await context.reportProgress({
      fraction: 0.03,
      stage: "synthesize",
      message: "正在请求所选模型生成配音"
    });
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        Accept: "audio/wav"
      },
      body: JSON.stringify({
        model: input.model,
        input: input.text,
        voice: input.voiceId,
        speed: input.rate,
        response_format: "wav",
        ...input.instructions?.trim() ? { instructions: input.instructions.trim() } : {}
      })
    });
    failureMessage = "接收配音失败，服务未返回完整可用的音频";
    await saveResponse(response, source, signal, context);
    failureMessage = "配音音频处理失败，请检查音频格式与本机 FFmpeg";
    await inspectWav2(source, signal, options);
    await context.reportProgress({
      fraction: 0.75,
      stage: "speech-encode",
      message: "正在整理配音音轨"
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
        source,
        "-map",
        "0:a:0",
        "-vn",
        "-t",
        String(MAX_DURATION_SECONDS + 1),
        "-ar",
        "48000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        partial
      ],
      { signal }
    );
    const metadata = await inspectWav2(partial, signal, options);
    if (metadata.sampleRate !== 48e3 || metadata.channels !== 1 || metadata.codec !== "pcm_s16le" || (await stat7(partial)).size > MAX_DURATION_SECONDS * 48e3 * 2 + 4096)
      throw new SpeechError("配音未能转换为有效的 48kHz 单声道 WAV");
    if (signal.aborted) throw mediaAbortError();
    await rename9(partial, output);
    await context.reportProgress({ fraction: 1, stage: "speech", message: "配音已生成" });
    if (signal.aborted) throw mediaAbortError();
    completed = true;
    return {
      path: output,
      mimeType: "audio/wav",
      engine: "openai-compatible",
      durationSeconds: metadata.durationSeconds,
      sampleRate: 48e3,
      channels: 1
    };
  } catch (error) {
    if (context.signal.aborted) throw mediaAbortError();
    if (deadline.aborted)
      throw new SpeechError("配音生成超时，已停止请求；请检查任务后再决定是否重试");
    if (error instanceof SpeechError) throw error;
    throw new SpeechError(failureMessage);
  } finally {
    await Promise.all(
      [source, partial, ...completed ? [] : [output]].map((path) => rm9(path, { force: true }))
    );
  }
}

// native/media/hyperframes-adapter.ts
import { spawn as spawn2 } from "node:child_process";
import { createHash as createHash7, randomUUID as randomUUID10 } from "node:crypto";
import { createReadStream as createReadStream5, constants as constants2 } from "node:fs";
import {
  access as access2,
  copyFile as copyFile4,
  lstat,
  mkdir as mkdir10,
  readFile as readFile7,
  readdir as readdir3,
  realpath as realpath3,
  rename as rename10,
  rm as rm10,
  stat as stat8,
  writeFile as writeFile7
} from "node:fs/promises";
import { homedir as homedir3 } from "node:os";
import { basename as basename2, delimiter as delimiter2, dirname, isAbsolute as isAbsolute6, join as join11, relative, resolve as resolve5, sep } from "node:path";
import { createServer } from "node:net";
var TEMPLATE_VERSION = 1;
var MAX_SOURCE_BYTES = 1024 * 1024 * 1024;
var MAX_SOURCE_FILES = 1e4;
var MAX_LOG_BYTES = 1024 * 1024;
var SKIP_DIRECTORIES = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  ".hyperframes",
  "renders",
  "snapshots",
  ".debug"
]);
var META_NAME = ".codeshell-hyperframes.json";
function abort(signal) {
  if (signal?.aborted) throw new DOMException("HyperFrames operation cancelled", "AbortError");
}
function report(ctx, event) {
  void Promise.resolve(ctx.onProgress?.(event)).catch(() => {
  });
}
function terminate(child) {
  if (!child.pid) return;
  try {
    child.kill("SIGTERM");
  } catch {
  }
  const timer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
    }
  }, 1500);
  timer.unref();
  child.once("close", () => clearTimeout(timer));
}
function executionEnvironment(runtime) {
  const paths = [runtime?.ffmpegPath, runtime?.ffprobePath, runtime?.nodePath].filter(Boolean).map((path) => dirname(path));
  return {
    ...process.env,
    PATH: [.../* @__PURE__ */ new Set([...paths, ...(process.env.PATH ?? "").split(delimiter2)])].join(delimiter2),
    ELECTRON_RUN_AS_NODE: "1",
    HYPERFRAMES_TELEMETRY_DISABLED: "1",
    DO_NOT_TRACK: "1",
    NO_COLOR: "1"
  };
}
async function run(executable, args, options = {}) {
  abort(options.signal);
  return new Promise((resolveRun, reject) => {
    const child = spawn2(executable, args, {
      cwd: options.cwd,
      env: executionEnvironment(options.runtime),
      shell: false,
      detached: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "", stderr = "", timedOut = false;
    const onAbort = () => terminate(child);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(
      () => {
        timedOut = true;
        terminate(child);
      },
      options.timeoutMs ?? 10 * 6e4
    );
    const collect = (chunk, stream) => {
      const message = chunk.toString();
      if (stream === "stdout") stdout = (stdout + message).slice(-MAX_LOG_BYTES);
      else stderr = (stderr + message).slice(-MAX_LOG_BYTES);
      const match = [...message.matchAll(/(?:^|\s)(\d{1,3}(?:\.\d+)?)%/g)].at(-1);
      if (options.phase && match) {
        const progress = Math.min(1, Number(match[1]) / 100);
        report(options, {
          phase: options.phase,
          message: `HyperFrames ${options.phase} ${Math.round(progress * 100)}%`,
          progress
        });
      }
    };
    child.stdout.on("data", (chunk) => collect(chunk, "stdout"));
    child.stderr.on("data", (chunk) => collect(chunk, "stderr"));
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (options.signal?.aborted)
        reject(new DOMException("HyperFrames operation cancelled", "AbortError"));
      else if (timedOut) reject(new Error("HyperFrames command timed out"));
      else if (code !== 0)
        reject(
          new Error(`HyperFrames command failed (${code}): ${(stderr || stdout).slice(-4e3)}`)
        );
      else resolveRun({ stdout, stderr });
    });
  });
}
async function discoverCli(options) {
  if (options.cliPath) {
    await access2(options.cliPath, constants2.R_OK);
    return realpath3(options.cliPath);
  }
  const candidates = [];
  if (options.projectDir)
    candidates.push(join11(options.projectDir, "node_modules/hyperframes/bin/hyperframes.mjs"));
  const global = await findExecutable("hyperframes");
  if (global) candidates.push(global);
  const cache = join11(homedir3(), ".npm/_npx");
  try {
    const entries = await readdir3(cache, { withFileTypes: true });
    for (const entry of entries.filter((entry2) => entry2.isDirectory()).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 100)) {
      candidates.push(join11(cache, entry.name, "node_modules/hyperframes/bin/hyperframes.mjs"));
    }
  } catch {
  }
  for (const path of candidates) {
    try {
      await access2(path, constants2.R_OK);
      return realpath3(path);
    } catch {
    }
  }
  return void 0;
}
async function detectHyperframesRuntime(options = {}) {
  const runtime = { available: false, checks: [] };
  runtime.nodePath = await findExecutable("node", options.nodePath);
  runtime.ffmpegPath = await findExecutable("ffmpeg", options.ffmpegPath);
  runtime.ffprobePath = await findExecutable("ffprobe", options.ffprobePath);
  try {
    runtime.cliPath = await discoverCli(options);
  } catch (error) {
    runtime.checks.push({ name: "HyperFrames", ok: false, detail: String(error) });
  }
  for (const [name, path, versionArgs] of [
    ["Node.js", runtime.nodePath, ["--version"]],
    ["FFmpeg", runtime.ffmpegPath, ["-version"]],
    ["FFprobe", runtime.ffprobePath, ["-version"]]
  ]) {
    try {
      if (!path) throw new Error(`${name} is not installed`);
      const result = await run(path, [...versionArgs], { runtime, timeoutMs: 15e3 });
      const version = result.stdout.split("\n")[0].trim();
      if (name === "Node.js") {
        runtime.nodeVersion = version;
        if (Number(version.replace(/^v/, "").split(".")[0]) < 22)
          throw new Error("Node.js 22 or newer is required");
      }
      runtime.checks.push({ name, ok: true, detail: version });
    } catch (error) {
      runtime.checks.push({ name, ok: false, detail: String(error) });
    }
  }
  if (runtime.cliPath && runtime.nodePath) {
    try {
      const result = await run(runtime.nodePath, [runtime.cliPath, "--version"], {
        runtime,
        timeoutMs: 2e4
      });
      runtime.version = result.stdout.trim();
      if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(runtime.version))
        throw new Error("Unrecognized HyperFrames version");
      runtime.checks.push({ name: "HyperFrames", ok: true, detail: runtime.version });
      const browser = await run(runtime.nodePath, [runtime.cliPath, "browser", "path"], {
        runtime,
        timeoutMs: 2e4
      });
      const browserPath = browser.stdout.trim().split("\n").at(-1);
      if (!isAbsolute6(browserPath)) throw new Error("Bundled Chrome is not available");
      await access2(browserPath, constants2.X_OK);
      runtime.browserPath = browserPath;
      runtime.checks.push({ name: "Chrome", ok: true, detail: browserPath });
    } catch (error) {
      runtime.checks.push({ name: "HyperFrames / Chrome", ok: false, detail: String(error) });
    }
  } else if (!runtime.checks.some((check2) => check2.name === "HyperFrames")) {
    runtime.checks.push({
      name: "HyperFrames",
      ok: false,
      detail: "Install HyperFrames with Node.js 22+, then install its bundled Chrome"
    });
  }
  runtime.available = runtime.checks.every((check2) => check2.ok) && Boolean(runtime.version && runtime.browserPath);
  return runtime;
}
function inside(root, path) {
  return path === root || path.startsWith(root + sep);
}
async function within(root, path) {
  const canonicalRoot = await realpath3(root);
  const canonical = await realpath3(resolve5(root, path));
  if (!inside(canonicalRoot, canonical))
    throw new Error("HyperFrames path is outside its authorized workspace");
  return canonical;
}
async function digestFile2(path) {
  const hash2 = createHash7("sha256");
  for await (const chunk of createReadStream5(path)) hash2.update(chunk);
  return hash2.digest("hex");
}
async function sourceFiles(projectDir) {
  const files = [];
  let total = 0;
  async function visit(dir) {
    for (const entry of (await readdir3(dir, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name)
    )) {
      if (SKIP_DIRECTORIES.has(entry.name) || entry.name === META_NAME || entry.name === ".DS_Store")
        continue;
      const path = join11(dir, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("HyperFrames source snapshots do not follow symbolic links");
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const size = (await lstat(path)).size;
        total += size;
        if (total > MAX_SOURCE_BYTES || files.length >= MAX_SOURCE_FILES)
          throw new Error("HyperFrames source exceeds the 1 GiB / 10,000 file import limit");
        files.push({
          path: relative(projectDir, path).split(sep).join("/"),
          hash: await digestFile2(path),
          size
        });
      } else throw new Error("HyperFrames sources must contain regular files");
    }
  }
  await visit(projectDir);
  return files;
}
function contentHash(value) {
  return createHash7("sha256").update(JSON.stringify(value)).digest("hex");
}
function text(value, max, field) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))
    throw new Error(`Invalid HyperFrames ${field}`);
  return value.trim();
}
function number2(value, min, max, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`Invalid HyperFrames ${field}`);
  return value;
}
function normalizeParams(params) {
  if (!params || !["chapter", "explainer"].includes(params.kind))
    throw new Error("Scene kind must be chapter or explainer");
  const width = number2(params.width ?? 1920, 320, 3840, "width"), height = number2(params.height ?? 1080, 180, 3840, "height");
  if (!Number.isInteger(width / 2) || !Number.isInteger(height / 2))
    throw new Error("MP4 scene dimensions must be even integers");
  const palette = params.palette ?? {
    background: "#142823",
    foreground: "#f2f4e9",
    accent: "#b5e3ac"
  };
  for (const value of Object.values(palette))
    if (!/^#[\da-fA-F]{6}$/.test(value))
      throw new Error("Scene palette requires six-digit hex colors");
  if (!palette.background || !palette.foreground || !palette.accent)
    throw new Error("Scene palette requires background, foreground and accent");
  if (params.bullets !== void 0 && (!Array.isArray(params.bullets) || params.bullets.length > 4))
    throw new Error("Explainer scenes support up to four points");
  return {
    kind: params.kind,
    title: text(params.title, 120, "title"),
    subtitle: params.subtitle ? text(params.subtitle, 240, "subtitle") : "",
    eyebrow: params.eyebrow ? text(params.eyebrow, 60, "eyebrow") : params.kind === "chapter" ? "CHAPTER" : "EXPLAINER",
    bullets: (params.bullets ?? []).map((line) => text(line, 140, "bullet")),
    durationSeconds: number2(params.durationSeconds ?? 4, 0.5, 60, "duration"),
    width,
    height,
    palette: { ...palette }
  };
}
function escape(value) {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );
}
function sceneHtml(p) {
  const unit = Math.min(p.width / 1280, p.height / 720);
  const titleSize = Math.round((p.kind === "explainer" ? 64 : 84) * unit);
  const points = p.kind === "explainer" ? p.bullets.map(
    (line, index) => `<li><span class="point-number">${String(index + 1).padStart(2, "0")}</span><span>${escape(line)}</span></li>`
  ).join("") : "";
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>${escape(p.title)}</title>
<meta name="viewport" content="width=${p.width}, height=${p.height}">
<style>
*{box-sizing:border-box}body{margin:0;background:${p.palette.background};color:${p.palette.foreground};font-family:system-ui,sans-serif}
#scene{position:relative;width:${p.width}px;height:${p.height}px;overflow:hidden} .clip{position:absolute;inset:0;padding:${Math.round(64 * unit)}px;display:flex;flex-direction:column;justify-content:center;gap:${Math.round(24 * unit)}px}
.eyebrow{font:600 ${Math.max(14, Math.round(18 * unit))}px ui-monospace,monospace;letter-spacing:.18em;color:${p.palette.accent};margin:0}h1{font-size:${titleSize}px;line-height:1.16;letter-spacing:-.035em;font-weight:750;margin:0;max-width:94%;overflow-wrap:anywhere} .subtitle{font-size:${Math.round(28 * unit)}px;line-height:1.5;max-width:88%;margin:0}ul{padding:0;margin:0;display:flex;flex-direction:column;gap:${Math.round(15 * unit)}px;list-style:none}li{display:flex;gap:${Math.round(22 * unit)}px;align-items:baseline;font-size:${Math.round(27 * unit)}px;line-height:1.45}.point-number{color:${p.palette.accent};font-family:monospace}.progress{position:absolute;left:0;bottom:0;width:100%;height:${Math.max(3, Math.round(5 * unit))}px;background:${p.palette.accent};transform-origin:left center}
</style></head><body><div id="scene" data-composition-id="scene" data-no-timeline data-width="${p.width}" data-height="${p.height}" data-duration="${p.durationSeconds}">
<section id="scene-content" class="clip" data-start="0" data-duration="${p.durationSeconds}" data-track-index="0"><p class="eyebrow">${escape(p.eyebrow)}</p><h1>${escape(p.title)}</h1>${p.subtitle ? `<p class="subtitle">${escape(p.subtitle)}</p>` : ""}${points ? `<ul>${points}</ul>` : ""}</section><div class="progress" data-layout-ignore="true"></div></div>
<script>
const duration=${p.durationSeconds * 1e3};
for(const [index,element] of [...document.querySelectorAll('.eyebrow,h1,.subtitle,li')].entries()){
const effect=element.animate([{opacity:0,transform:'translateY(18px)'},{opacity:1,transform:'translateY(0)'}],{duration:Math.min(550,duration*.22),delay:Math.min(index*100,duration*.3),fill:'both',iterations:1,easing:'cubic-bezier(.2,.7,.2,1)'});effect.pause();}
const progress=document.querySelector('.progress').animate([{transform:'scaleX(0)'},{transform:'scaleX(1)'}],{duration,fill:'both',iterations:1});progress.pause();
</script></body></html>
`;
}
async function inspectDirectory(projectDir, kind) {
  const sourcePath = join11(projectDir, "index.html");
  if ((await stat8(sourcePath)).size > 8 * 1024 * 1024)
    throw new Error("HyperFrames index.html exceeds 8 MiB");
  const html = await readFile7(sourcePath, "utf8");
  const root = /<[a-z][^>]*\bdata-composition-id\s*=\s*["'][^"']+["'][^>]*>/i.exec(html)?.[0];
  if (!root) throw new Error("index.html does not contain a HyperFrames composition root");
  const attr = (name) => {
    const value = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(root)?.[1];
    return value && Number.isFinite(Number(value)) ? Number(value) : void 0;
  };
  const files = await sourceFiles(projectDir);
  const externalUrls = /* @__PURE__ */ new Set();
  for (const file of files.filter(
    (file2) => /\.(html|css|js|mjs)$/i.test(file2.path) && file2.size <= 8 * 1024 * 1024
  )) {
    const source = await readFile7(join11(projectDir, file.path), "utf8");
    for (const match of source.matchAll(/https?:\/\/[^\s"'<>`)]+/g)) externalUrls.add(match[0]);
  }
  let pkg = {};
  try {
    pkg = JSON.parse(await readFile7(join11(projectDir, "package.json"), "utf8"));
  } catch {
  }
  const pin = Object.values(pkg.scripts ?? {}).join(" ").match(/hyperframes@(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/)?.[1];
  return {
    projectDir,
    sourcePath,
    paramsPath: join11(projectDir, META_NAME),
    contentHash: contentHash(files),
    kind,
    width: attr("data-width"),
    height: attr("data-height"),
    durationSeconds: attr("data-duration"),
    pinnedVersion: pin,
    externalUrls: [...externalUrls],
    packageDependencies: [
      .../* @__PURE__ */ new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {})
      ])
    ].sort()
  };
}
async function probeVideo(runtime, path, signal) {
  const result = await run(
    runtime.ffprobePath,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height,r_frame_rate:format=duration",
      "-of",
      "json",
      path
    ],
    { runtime, signal, timeoutMs: 3e4 }
  );
  const info = JSON.parse(result.stdout);
  const stream = info.streams?.[0];
  const durationSeconds = Number(info.format?.duration);
  if (!stream || stream.codec_name !== "h264" || !Number.isFinite(durationSeconds) || durationSeconds <= 0)
    throw new Error("HyperFrames output is not a valid H.264 MP4");
  const [n, d] = stream.r_frame_rate.split("/").map(Number);
  const fps = n / d;
  if (!Number.isFinite(fps) || fps <= 0 || !Number.isSafeInteger(stream.width) || !Number.isSafeInteger(stream.height) || stream.width <= 0 || stream.height <= 0)
    throw new Error("HyperFrames output has invalid video dimensions or frame rate");
  return { durationSeconds, width: stream.width, height: stream.height, fps };
}
function createHyperframesAdapter(options) {
  let runtimePromise;
  const runtime = async () => {
    runtimePromise ??= detectHyperframesRuntime(options);
    const found = await runtimePromise;
    if (!found.available)
      throw new Error(
        `HyperFrames is unavailable: ${found.checks.filter((check3) => !check3.ok).map((check3) => check3.detail).join("; ")}`
      );
    return found;
  };
  const cacheRoot = resolve5(options.cacheRoot);
  const prepare = async () => {
    await mkdir10(join11(cacheRoot, "sources"), { recursive: true });
    await mkdir10(join11(cacheRoot, "renders"), { recursive: true });
  };
  async function managed(source) {
    await prepare();
    const dir = await within(join11(cacheRoot, "sources"), source.projectDir);
    return inspectDirectory(dir, source.kind);
  }
  async function inspectProject(relativeDir) {
    if (typeof relativeDir !== "string" || !relativeDir || isAbsolute6(relativeDir))
      throw new Error("HyperFrames import requires a workspace-relative directory");
    const dir = await within(options.workspaceRoot, relativeDir);
    return inspectDirectory(dir, "imported");
  }
  async function createScene(params, ctx = {}) {
    abort(ctx.signal);
    await prepare();
    const p = normalizeParams(params), found = await runtime();
    const key = contentHash({ template: TEMPLATE_VERSION, params: p });
    const target = join11(cacheRoot, "sources", key);
    try {
      await access2(join11(target, META_NAME));
      return await inspectDirectory(target, "generated");
    } catch {
    }
    const temporary = join11(cacheRoot, "sources", `.tmp-${randomUUID10()}`);
    await mkdir10(temporary);
    try {
      await writeFile7(join11(temporary, "index.html"), sceneHtml(p));
      await writeFile7(
        join11(temporary, "hyperframes.json"),
        JSON.stringify({ skill: "general-video" }, null, 2)
      );
      await writeFile7(
        join11(temporary, "package.json"),
        JSON.stringify(
          {
            private: true,
            scripts: {
              check: `npx hyperframes@${found.version} check`,
              render: `npx hyperframes@${found.version} render`
            }
          },
          null,
          2
        )
      );
      await writeFile7(
        join11(temporary, META_NAME),
        JSON.stringify(
          { schemaVersion: 1, templateVersion: TEMPLATE_VERSION, kind: "generated", params: p },
          null,
          2
        )
      );
      abort(ctx.signal);
      await rename10(temporary, target).catch(async (error) => {
        if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY")
          throw error;
      });
      report(ctx, {
        phase: "inspect",
        message: "Parameterized HyperFrames source saved",
        progress: 1
      });
      return inspectDirectory(target, "generated");
    } finally {
      await rm10(temporary, { recursive: true, force: true });
    }
  }
  async function importProject(relativeDir, ctx = {}) {
    abort(ctx.signal);
    await prepare();
    const original = await inspectProject(relativeDir), files = await sourceFiles(original.projectDir);
    const target = join11(cacheRoot, "sources", original.contentHash);
    try {
      await access2(join11(target, META_NAME));
      return await inspectDirectory(target, "imported");
    } catch {
    }
    const temporary = join11(cacheRoot, "sources", `.tmp-${randomUUID10()}`);
    await mkdir10(temporary);
    try {
      for (const file of files) {
        abort(ctx.signal);
        await mkdir10(dirname(join11(temporary, file.path)), { recursive: true });
        await copyFile4(join11(original.projectDir, file.path), join11(temporary, file.path));
        if (await digestFile2(join11(temporary, file.path)) !== file.hash)
          throw new Error("HyperFrames source changed during import; retry the snapshot");
      }
      await writeFile7(
        join11(temporary, META_NAME),
        JSON.stringify(
          {
            schemaVersion: 1,
            kind: "imported",
            originalRelativeDir: relative(
              await realpath3(options.workspaceRoot),
              original.projectDir
            ),
            sourceHash: original.contentHash,
            files
          },
          null,
          2
        )
      );
      await rename10(temporary, target).catch((error) => {
        if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error;
      });
      return inspectDirectory(target, "imported");
    } finally {
      await rm10(temporary, { recursive: true, force: true });
    }
  }
  async function check2(source, ctx = {}) {
    const current = await managed(source), found = await runtime();
    report(ctx, {
      phase: "check",
      message: "Checking HyperFrames source, layout, motion and runtime",
      progress: 0
    });
    const result = await run(
      found.nodePath,
      [found.cliPath, "check", current.projectDir, "--json"],
      { ...ctx, runtime: found, phase: "check", timeoutMs: 18e4 }
    );
    const parsed = JSON.parse(result.stdout);
    if (parsed.ok !== true)
      throw new Error(`HyperFrames check did not pass: ${JSON.stringify(parsed).slice(-4e3)}`);
    await mkdir10(join11(current.projectDir, ".hyperframes"), { recursive: true });
    await writeFile7(
      join11(current.projectDir, ".hyperframes/codeshell-check.json"),
      JSON.stringify(parsed, null, 2)
    );
    report(ctx, { phase: "check", message: "HyperFrames checks passed", progress: 1 });
    return parsed;
  }
  async function render(source, ctx = {}) {
    abort(ctx.signal);
    const current = await managed(source), found = await runtime();
    const quality = ctx.quality ?? "standard", fps = ctx.fps ?? 30;
    if (!["draft", "standard", "high"].includes(quality) || ![24, 30, 60].includes(fps))
      throw new Error("Invalid HyperFrames render quality or fps");
    const key = contentHash({ source: current.contentHash, version: found.version, quality, fps });
    const directory = join11(cacheRoot, "renders", key), artifactPath = join11(directory, "scene.mp4"), manifestPath = join11(directory, "render.json");
    if (!current.externalUrls.length) {
      try {
        const stored = JSON.parse(await readFile7(manifestPath, "utf8"));
        if (stored.artifactHash === await digestFile2(artifactPath)) {
          const video = await probeVideo(found, artifactPath, ctx.signal);
          report(ctx, {
            phase: "cache",
            message: "Reused verified HyperFrames scene render",
            progress: 1
          });
          return {
            ...current,
            ...video,
            artifactPath,
            cached: true,
            format: "mp4",
            rendererVersion: found.version
          };
        }
      } catch {
        abort(ctx.signal);
      }
    }
    await check2(current, ctx);
    abort(ctx.signal);
    await mkdir10(directory, { recursive: true });
    const temporary = join11(directory, `.partial-${randomUUID10()}.mp4`);
    try {
      report(ctx, { phase: "render", message: "Rendering scene with HyperFrames", progress: 0 });
      await run(
        found.nodePath,
        [
          found.cliPath,
          "render",
          current.projectDir,
          "--output",
          temporary,
          "--format",
          "mp4",
          "--quality",
          quality,
          "--fps",
          String(fps),
          "--workers",
          "1",
          "--strict",
          "--no-best-effort"
        ],
        { ...ctx, runtime: found, phase: "render", timeoutMs: 30 * 6e4 }
      );
      abort(ctx.signal);
      const video = await probeVideo(found, temporary, ctx.signal);
      if (current.durationSeconds && Math.abs(video.durationSeconds - current.durationSeconds) > Math.max(0.15, 2 / fps))
        throw new Error("HyperFrames output duration does not match its source");
      if (current.width && video.width !== current.width || current.height && video.height !== current.height || Math.abs(video.fps - fps) > 0.01)
        throw new Error("HyperFrames output dimensions or frame rate do not match the request");
      const artifactHash = await digestFile2(temporary);
      if ((await managed(current)).contentHash !== current.contentHash)
        throw new Error("HyperFrames source changed during rendering; retry with the new source");
      await rename10(temporary, artifactPath);
      const result = {
        ...current,
        ...video,
        artifactPath,
        cached: false,
        format: "mp4",
        rendererVersion: found.version
      };
      const temporaryManifest = join11(directory, `.render-${randomUUID10()}.json`);
      await writeFile7(temporaryManifest, JSON.stringify({ ...result, artifactHash }, null, 2));
      await rename10(temporaryManifest, manifestPath);
      report(ctx, { phase: "render", message: "HyperFrames MP4 verified", progress: 1 });
      return result;
    } finally {
      await rm10(temporary, { force: true });
    }
  }
  async function preview(source, ctx = {}) {
    const current = await managed(source), found = await runtime();
    await check2(current, ctx);
    abort(ctx.signal);
    let port = ctx.port;
    if (port !== void 0 && (!Number.isInteger(port) || port < 1024 || port > 65535))
      throw new Error("Preview port must be between 1024 and 65535");
    if (!port)
      port = await new Promise((resolvePort, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          const chosen = typeof address === "object" && address ? address.port : 0;
          server.close((error2) => error2 ? reject(error2) : resolvePort(chosen));
        });
      });
    const url = `http://127.0.0.1:${port}/#project/${encodeURIComponent(basename2(current.projectDir))}`;
    const child = spawn2(
      found.nodePath,
      [
        found.cliPath,
        "preview",
        current.projectDir,
        "--foreground",
        "--json",
        "--no-open",
        "--port",
        String(port)
      ],
      {
        cwd: current.projectDir,
        env: executionEnvironment(found),
        shell: false,
        detached: false,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let closed = false, error, log = "";
    const closing = new Promise((resolveClose) => {
      child.once("close", () => {
        closed = true;
        resolveClose();
      });
    });
    child.once("error", (failure) => {
      error = failure;
    });
    child.stdout.on("data", (data) => {
      log = (log + data.toString()).slice(-4e3);
    });
    child.stderr.on("data", (data) => {
      log = (log + data.toString()).slice(-4e3);
    });
    const stop = async () => {
      if (!closed) terminate(child);
      await closing;
      ctx.signal?.removeEventListener("abort", stop);
    };
    ctx.signal?.addEventListener("abort", stop, { once: true });
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        abort(ctx.signal);
        if (closed || error) throw error ?? new Error(`HyperFrames preview stopped: ${log}`);
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(1e3) });
          if (response.ok) {
            report(ctx, { phase: "preview", message: "HyperFrames Studio is ready", progress: 1 });
            return { url, stop };
          }
        } catch {
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 200));
      }
      throw new Error(`HyperFrames preview did not start: ${log}`);
    } catch (failure) {
      await stop();
      throw failure;
    }
  }
  return {
    inspectProject,
    createScene,
    importProject,
    check: check2,
    render,
    preview,
    detectRuntime: () => detectHyperframesRuntime(options)
  };
}

// native/media/media-caption-renderer.ts
import { spawn as spawn3 } from "node:child_process";
import { createHash as createHash8 } from "node:crypto";
import { constants as constants3 } from "node:fs";
import { access as access3, mkdir as mkdir11, readdir as readdir4, rm as rm11, writeFile as writeFile8 } from "node:fs/promises";
import { homedir as homedir4 } from "node:os";
import { delimiter as delimiter3, dirname as dirname2, join as join12 } from "node:path";
function validateCaptionImageRequest(request) {
  if (!request || typeof request !== "object" || Object.keys(request).some(
    (key) => !["width", "height", "fontSize", "texts", "style"].includes(key)
  ))
    throw new Error("Invalid caption image request");
  if (request.style !== void 0 && !["classic", "bold", "minimal"].includes(request.style))
    throw new Error("Unsupported caption style");
  if (![request.width, request.height].every(
    (value) => Number.isSafeInteger(value) && value >= 16 && value <= 8192
  ) || !Number.isSafeInteger(request.fontSize) || request.fontSize < 1 || request.fontSize > 512 || !Array.isArray(request.texts) || request.texts.length > 1e4 || request.texts.some((text2) => typeof text2 !== "string" || text2.length > 4e3))
    throw new Error("Invalid caption image dimensions or text");
}
function drawCaptionPng(request) {
  const canvas = document.createElement("canvas");
  canvas.width = request.width;
  canvas.height = request.height;
  const ctx = canvas.getContext("2d");
  const { width: w, height: h, fontSize } = request;
  const style = request.style ?? "classic";
  if (!["classic", "bold", "minimal"].includes(style)) throw new Error("Unsupported caption style");
  ctx.save();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.font = `${style === "bold" ? 800 : style === "minimal" ? 500 : 600} ${fontSize}px system-ui`;
  ctx.textAlign = "center";
  const lines = [];
  outer: for (const text2 of request.texts) {
    let line = "";
    for (const char of text2) {
      if (char === "\n" || line && ctx.measureText(line + char).width > w * 0.85) {
        lines.push(line);
        if (lines.length === 4) break outer;
        line = char === "\n" ? "" : char;
      } else line += char;
    }
    if (line) lines.push(line);
    if (lines.length === 4) break;
  }
  const visible = lines.slice(0, 4), lineHeight = fontSize * 1.4;
  if (visible.length) {
    const y = h * 0.9 - visible.length * lineHeight;
    if (style === "classic") {
      const boxWidth = Math.min(
        w * 0.93,
        Math.max(...visible.map((line) => ctx.measureText(line).width)) + fontSize
      );
      ctx.fillStyle = "#050909b8";
      ctx.beginPath();
      ctx.roundRect(
        (w - boxWidth) / 2,
        y,
        boxWidth,
        visible.length * lineHeight + fontSize * 0.5,
        8
      );
      ctx.fill();
    } else if (style === "minimal") {
      ctx.shadowColor = "#000b";
      ctx.shadowBlur = Math.max(2, fontSize * 0.08);
      ctx.shadowOffsetY = Math.max(1, fontSize * 0.04);
    }
    ctx.fillStyle = style === "bold" ? "#ffe46b" : "#fff";
    if (style === "bold") {
      ctx.strokeStyle = "#101010";
      ctx.lineWidth = Math.max(2, fontSize * 0.12);
      ctx.lineJoin = "round";
    }
    visible.forEach((line, i) => {
      const baseline = y + lineHeight * (i + 1) - fontSize * 0.1;
      if (style === "bold") ctx.strokeText(line, w / 2, baseline);
      ctx.fillText(line, w / 2, baseline);
    });
  }
  ctx.restore();
  return canvas.toDataURL("image/png");
}
async function findCaptionBrowser() {
  const names = process.platform === "win32" ? ["chrome.exe", "msedge.exe"] : process.platform === "linux" ? ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"] : ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"];
  const directories = (process.env.PATH ?? "").split(delimiter3).filter(Boolean);
  const candidates = process.platform === "linux" ? names.flatMap((name) => directories.map((path) => join12(path, name))) : directories.flatMap((path) => names.map((name) => join12(path, name)));
  const home = homedir4();
  const localAppData = process.env.LOCALAPPDATA || join12(home, "AppData", "Local");
  if (process.platform === "win32") {
    const systemDrive = dirname2(process.env.SystemRoot || process.env.WINDIR || "C:\\Windows");
    for (const root of [
      localAppData,
      process.env.PROGRAMFILES || join12(systemDrive, "Program Files"),
      process.env["PROGRAMFILES(X86)"] || join12(systemDrive, "Program Files (x86)")
    ])
      candidates.push(
        join12(root, "Google", "Chrome", "Application", "chrome.exe"),
        join12(root, "Microsoft", "Edge", "Application", "msedge.exe")
      );
  }
  if (process.platform === "darwin")
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      join12(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    );
  const cacheRoots = process.platform === "win32" ? [join12(localAppData, "ms-playwright")] : [join12(home, "Library/Caches/ms-playwright"), join12(home, ".cache/ms-playwright")];
  for (const root of cacheRoots) {
    for (const name of await readdir4(root).catch(() => [])) {
      if (!/^chromium[-_]/.test(name)) continue;
      for (const binary of [
        "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome-linux/chrome",
        "chrome-linux64/chrome",
        "chrome-win/chrome.exe",
        "chrome-win64/chrome.exe"
      ])
        candidates.push(join12(root, name, binary));
    }
  }
  for (const path of candidates)
    if (await access3(path, constants3.X_OK).then(
      () => true,
      () => false
    ))
      return path;
  return void 0;
}
var CaptionBrowser = class {
  child;
  pending = /* @__PURE__ */ new Map();
  nextId = 0;
  buffer = Buffer.alloc(0);
  closed = false;
  closingStarted = false;
  closing;
  exited;
  diagnostic = new Error("浏览器未提供启动诊断");
  constructor(executable, profile) {
    this.child = spawn3(
      executable,
      [
        "--headless=new",
        "--remote-debugging-pipe",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--disable-extensions",
        `--user-data-dir=${profile}`,
        "about:blank"
      ],
      {
        detached: false,
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"]
      }
    );
    let stderr = Buffer.alloc(0);
    this.diagnostic.name = "CaptionBrowserDiagnostics";
    const updateDiagnostic = (exit = "") => {
      this.diagnostic.message = `Browser: ${executable}
${stderr.toString("utf8")}
${exit}`.slice(
        -12288
      );
    };
    updateDiagnostic();
    this.child.stderr.on("data", (chunk) => {
      stderr = Buffer.from(Buffer.concat([stderr, chunk]).subarray(-8192));
      updateDiagnostic();
    });
    this.child.stderr.on("error", () => {
    });
    this.exited = new Promise(
      (resolve7) => this.child.once("close", (code, signal) => {
        updateDiagnostic(`Exit code: ${code ?? "none"}; signal: ${signal ?? "none"}`);
        this.fail(this.failure("字幕绘制进程已停止"));
        resolve7();
      })
    );
    this.child.once("error", () => this.fail(this.failure("无法启动字幕绘制浏览器")));
    for (const pipe of [this.child.stdio[3], this.child.stdio[4]])
      pipe.on("error", (error) => {
        if (this.closingStarted && ["ECONNRESET", "EPIPE", "ERR_STREAM_DESTROYED"].includes(error.code ?? ""))
          return;
        this.fail(this.failure("字幕绘制连接已中断"));
        void this.close();
      });
    this.child.stdio[4].on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      if (this.buffer.length > 32 * 1024 * 1024) {
        this.fail(new Error("字幕图像超过大小限制"));
        void this.close();
        return;
      }
      let end;
      while ((end = this.buffer.indexOf(0)) >= 0) {
        const part = this.buffer.subarray(0, end);
        this.buffer = this.buffer.subarray(end + 1);
        let message;
        try {
          message = JSON.parse(part.toString("utf8"));
        } catch {
          this.fail(new Error("字幕绘制返回无效数据"));
          continue;
        }
        const entry = this.pending.get(message.id);
        if (!entry) continue;
        this.pending.delete(message.id);
        if (message.error) entry.reject(new Error("字幕绘制命令失败"));
        else entry.resolve(message.result);
      }
    });
  }
  failure(message) {
    if (this.diagnostic.message.includes("No usable sandbox"))
      message = "字幕浏览器的安全环境不可用，请安装或选择可用的系统版 Chrome 后重试";
    return new Error(message, { cause: this.diagnostic });
  }
  fail(error) {
    this.closed = true;
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }
  call(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error("字幕绘制进程已停止"));
    return new Promise((resolve7, reject) => {
      const id2 = ++this.nextId;
      this.pending.set(id2, { resolve: resolve7, reject });
      this.child.stdio[3].write(
        JSON.stringify({ id: id2, method, params, ...sessionId ? { sessionId } : {} }) + "\0",
        (error) => {
          if (error) {
            this.pending.delete(id2);
            reject(new Error("无法发送字幕绘制请求"));
          }
        }
      );
    });
  }
  close() {
    if (this.closing) return this.closing;
    this.closingStarted = true;
    this.fail(new Error("字幕绘制已取消"));
    this.closing = Promise.resolve().then(async () => {
      let timer;
      if (this.child.exitCode === null && this.child.signalCode === null) {
        this.child.kill("SIGTERM");
        timer = setTimeout(() => this.child.kill("SIGKILL"), 1500);
        timer.unref();
      }
      await this.exited;
      if (timer) clearTimeout(timer);
    });
    return this.closing;
  }
};
var MediaCaptionRenderer = class {
  constructor(options = {}) {
    this.options = options;
  }
  options;
  closing = /* @__PURE__ */ new Map();
  browsers = /* @__PURE__ */ new Map();
  close(jobId) {
    const pending = this.closing.get(jobId);
    if (pending) return pending;
    const entry = this.browsers.get(jobId);
    if (!entry) return Promise.resolve();
    this.browsers.delete(jobId);
    entry.signal.removeEventListener("abort", entry.onAbort);
    const operation = (async () => {
      await entry.browser.close();
      await rm11(entry.profile, { recursive: true, force: true }).catch(() => {
      });
    })().finally(() => {
      if (this.closing.get(jobId) === operation) this.closing.delete(jobId);
    });
    this.closing.set(jobId, operation);
    return operation;
  }
  async render(request, context) {
    validateCaptionImageRequest(request);
    await this.closing.get(context.jobId);
    if (context.signal.aborted) throw mediaAbortError();
    let entry = this.browsers.get(context.jobId);
    if (!entry) {
      const executable = this.options.browserPath ?? await findCaptionBrowser();
      if (!executable) throw new Error("字幕渲染需要已安装的 Chrome、Chromium 或 Edge 浏览器");
      const profile = join12(context.workDir, "caption-browser");
      await mkdir11(profile, { recursive: true, mode: 448 });
      const browser = new CaptionBrowser(executable, profile);
      const session = (async () => {
        const target = await browser.call("Target.createTarget", { url: "about:blank" });
        const result = await browser.call("Target.attachToTarget", {
          targetId: target.targetId,
          flatten: true
        });
        await browser.call("Network.enable", {}, result.sessionId);
        await browser.call("Network.setBlockedURLs", { urls: ["*"] }, result.sessionId);
        return result.sessionId;
      })();
      const onAbort = () => {
        void this.close(context.jobId);
      };
      entry = { browser, session, profile, onAbort, signal: context.signal };
      this.browsers.set(context.jobId, entry);
      context.signal.addEventListener("abort", onAbort, { once: true });
      if (context.signal.aborted) onAbort();
    }
    let timer;
    try {
      const rendered = await Promise.race([
        (async () => {
          const sessionId = await entry.session;
          const response = await entry.browser.call(
            "Runtime.evaluate",
            {
              expression: `(async()=>{await document.fonts.ready;return (${drawCaptionPng.toString()})(${JSON.stringify(request)})})()`,
              awaitPromise: true,
              returnByValue: true
            },
            sessionId
          );
          if (response.exceptionDetails) throw new Error("字幕绘制失败");
          return response.result?.value;
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            void this.close(context.jobId);
            reject(new Error("字幕绘制超时"));
          }, this.options.timeoutMs ?? 3e4);
        })
      ]);
      if (context.signal.aborted) throw mediaAbortError();
      if (typeof rendered !== "string" || !rendered.startsWith("data:image/png;base64,"))
        throw new Error("字幕绘制未返回 PNG");
      const path = join12(
        context.workDir,
        `caption-${createHash8("sha256").update(JSON.stringify(request)).digest("hex")}.png`
      );
      const bytes = Buffer.from(rendered.slice("data:image/png;base64,".length), "base64");
      if (bytes.length < 24 || bytes.readUInt32BE(16) !== request.width || bytes.readUInt32BE(20) !== request.height)
        throw new Error("字幕图像尺寸无效");
      await writeFile8(path, bytes, { signal: context.signal, mode: 384 });
      return path;
    } catch (error) {
      await this.close(context.jobId);
      if (context.signal.aborted) throw mediaAbortError();
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
};

// native/media/media-runtime.ts
var MEDIA_ACTIONS = [
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
  "scene"
];
var MediaRequestError = class extends Error {
};
var MIME_EXTENSIONS = {
  "video/mp4": ".mp4",
  "audio/wav": ".wav",
  "audio/mp4": ".m4a",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "application/x-subrip": ".srt",
  "application/json": ".json",
  "text/html": ".html"
};
var EXTENSION_MIME = {
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
  ".webp": "image/webp"
};
function object2(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new MediaRequestError("媒体请求必须是对象");
  return raw;
}
function safeRelative(value) {
  if (typeof value !== "string" || value.length > 512 || !value || value.split("/").some(
    (part) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(part) || part === "." || part === ".."
  ) || /[\\:\0]/.test(value))
    throw new MediaRequestError("素材须使用任务目录内的文件名");
  return value;
}
async function regularWithin(root, value) {
  safeRelative(value);
  let path = root;
  for (const part of value.split("/")) {
    path = join13(path, part);
    if ((await lstat2(path)).isSymbolicLink())
      throw new MediaRequestError("媒体文件不能使用符号链接");
  }
  const canonical = await realpath4(path), info = await stat9(canonical);
  if (!canonical.startsWith(root + sep2) || !info.isFile())
    throw new MediaRequestError("素材不在当前任务目录内");
  return canonical;
}
async function hashFile(path, signal) {
  const hash2 = createHash9("sha256");
  for await (const chunk of createReadStream6(path)) {
    if (signal.aborted) throw mediaAbortError();
    hash2.update(chunk);
  }
  return hash2.digest("hex");
}
function publicMessage(error) {
  if (error instanceof MediaRequestError) return error.message;
  const message = redactHomePath(error instanceof Error ? error.message : String(error));
  if (!message || message.length > 350 || /(?:\/Users\/|\/home\/|\/tmp\/|\/private\/|[A-Z]:\\|https?:\/\/|Traceback|exited with code|ENOENT|EACCES|ENOSPC)/.test(
    message
  ))
    return "媒体处理未完成，请检查本地依赖、素材和可用空间后重试";
  return message;
}
function validateMediaRequest(raw) {
  const value = object2(raw);
  if (Object.keys(value).some(
    (key) => !["action", "params", "inputs", "publicConnections"].includes(key)
  ) || !MEDIA_ACTIONS.includes(value.action))
    throw new MediaRequestError("不支持的媒体任务");
  const params = value.params === void 0 ? {} : object2(value.params);
  const inputs = value.inputs === void 0 ? {} : object2(value.inputs);
  if (Object.keys(inputs).length > 1e3) throw new MediaRequestError("一次任务的素材过多");
  for (const [id2, file] of Object.entries(inputs)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(id2))
      throw new MediaRequestError("素材标识无效");
    safeRelative(file);
  }
  if (value.publicConnections !== void 0 && value.action !== "status" && value.action !== "voices")
    throw new MediaRequestError("生成任务不能使用公开连接配置替代授权连接");
  return {
    action: value.action,
    params,
    inputs,
    ...value.publicConnections === void 0 ? {} : { publicConnections: value.publicConnections }
  };
}
function safeConnectionDescription(connection) {
  const d = connection.description;
  return {
    id: d.id,
    name: d.name,
    provider: d.provider,
    available: d.available,
    ...d.reason ? { reason: d.reason } : {},
    voices: d.voices.map((v) => ({ id: v.id, name: v.name, language: v.language })),
    defaultVoiceId: d.defaultVoiceId,
    maxTextLength: d.maxTextLength,
    supportsInstructions: d.supportsInstructions,
    mode: "online"
  };
}
function validateMediaConnections(raw) {
  if (!Array.isArray(raw) || raw.length > 100) throw new MediaRequestError("配音连接配置无效");
  const ids = /* @__PURE__ */ new Set();
  for (const value of raw) {
    const c = object2(value), d = object2(c.description);
    if ([c.connectionId, c.model, c.baseUrl, c.apiKey, d.id, d.name, d.provider].some(
      (v) => typeof v !== "string" || v.length > 8192
    ) || !d.id || ids.has(d.id) || !Array.isArray(d.voices) || d.voices.length > 2e3 || d.voices.some(
      (v) => !v || [v.id, v.name, v.language].some((s) => typeof s !== "string" || s.length > 256)
    ) || !Number.isInteger(d.maxTextLength) || d.maxTextLength < 1 || d.maxTextLength > 4096 || typeof d.supportsInstructions !== "boolean" || typeof d.available !== "boolean" || !Number.isFinite(c.defaultRate) || c.defaultRate < 0.5 || c.defaultRate > 2)
      throw new MediaRequestError("配音连接配置无效");
    ids.add(d.id);
  }
  return raw;
}
async function resolveMediaTools(tools = {}, directories) {
  const resolved = { ...tools };
  for (const [key, name] of [
    ["ffmpegPath", "ffmpeg"],
    ["ffprobePath", "ffprobe"],
    ["whisperPath", "whisper"],
    ["uvPath", "uv"]
  ]) {
    if (resolved[key]) continue;
    const found = await findExecutable(name, void 0, directories);
    if (found) resolved[key] = found;
  }
  return resolved;
}
async function runMediaRequest(raw, options) {
  const request = validateMediaRequest(raw), params = request.params ?? {};
  if (options.signal.aborted) throw mediaAbortError();
  if (!/^[a-f0-9]{64}$/.test(options.scopeKey) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(options.jobId))
    throw new MediaRequestError("媒体任务标识无效");
  const jobInfo = await lstat2(options.jobDir);
  if (!jobInfo.isDirectory() || jobInfo.isSymbolicLink())
    throw new MediaRequestError("媒体任务目录无效");
  const root = await realpath4(options.jobDir);
  await mkdir12(options.runtimeDir, { recursive: true, mode: 448 });
  if ((await lstat2(options.runtimeDir)).isSymbolicLink())
    throw new MediaRequestError("媒体运行目录无效");
  const runtime = await realpath4(options.runtimeDir);
  options = {
    ...options,
    tools: await resolveMediaTools(options.tools, options.toolSearchDirectories)
  };
  const context = {
    scope: { appId: "video-studio", projectPath: options.scopeKey },
    jobId: options.jobId,
    attempt: 1,
    workDir: join13(root, "work"),
    outputDir: join13(root, "outputs"),
    cacheDir: join13(runtime, "cache", options.scopeKey),
    signal: options.signal,
    reportProgress: async (progress) => {
      if (options.signal.aborted) throw mediaAbortError();
      await options.reportProgress({
        ...progress,
        ...progress.message ? { message: publicMessage(new Error(progress.message)) } : {}
      });
    }
  };
  for (const path of [context.workDir, context.outputDir, context.cacheDir]) {
    await mkdir12(path, { recursive: true, mode: 448 });
    if ((await lstat2(path)).isSymbolicLink()) throw new MediaRequestError("媒体工作目录无效");
  }
  const inputs = /* @__PURE__ */ new Map(), artifacts = [];
  const assets = /* @__PURE__ */ new Map();
  const caption = new MediaCaptionRenderer({ browserPath: options.tools?.browserPath });
  let succeeded = false;
  try {
    for (const [id2, file] of Object.entries(request.inputs ?? {})) {
      const path = await regularWithin(root, file);
      if (/^asset-[a-f0-9]{64}$/.test(id2) && id2 !== `asset-${await hashFile(path, context.signal)}`)
        throw new MediaRequestError("素材内容已变化，请重新导入");
      inputs.set(id2, path);
    }
    const resolveAssetPath = async (_scope, id2) => {
      const path = inputs.get(id2);
      if (!path) throw new MediaRequestError("缺少本次任务授权的素材");
      return path;
    };
    const publish = async (path, mimeType, role = "artifact", name) => {
      if (context.signal.aborted) throw mediaAbortError();
      const canonical = await realpath4(path);
      if (![root, runtime].some((r) => canonical.startsWith(r + sep2)) || !(await stat9(canonical)).isFile())
        throw new MediaRequestError("媒体结果不在工具目录内");
      const sha256 = await hashFile(canonical, context.signal), bytes = (await stat9(canonical)).size;
      if (bytes < 1 || bytes > 20 * 1024 ** 3) throw new MediaRequestError("媒体结果大小无效");
      const id2 = `asset-${sha256}`;
      if (assets.has(id2)) return assets.get(id2);
      const suffix = MIME_EXTENSIONS[mimeType] ?? (/^\.[a-zA-Z0-9]{1,8}$/.test(extname(canonical)) ? extname(canonical) : ".bin");
      const target = join13(context.outputDir, `${sha256}${suffix}`);
      if (target !== canonical) await copyFile5(canonical, target);
      const asset = {
        id: id2,
        name: name ?? basename3(canonical),
        mimeType,
        bytes,
        sha256,
        createdAt: Date.now()
      };
      assets.set(id2, asset);
      inputs.set(id2, target);
      artifacts.push({
        file: relative2(root, target).split(sep2).join("/"),
        role,
        mimeType,
        bytes,
        sha256,
        assetId: id2
      });
      return asset;
    };
    const processorOptions = {
      ...options.tools,
      resolveAssetPath,
      publishArtifact: (_scope, path, mimeType) => publish(path, mimeType),
      renderCaptionPng: (request2, ctx) => caption.render(request2, ctx)
    };
    const processors = createMediaJobProcessors(processorOptions);
    const managed = createManagedTtsProviders({
      runtimeDir: join13(runtime, "tts"),
      ...options.tools
    });
    const voiceRuntime = resolve6(runtime, "..");
    const cloneProviders = {
      "audio8-tts": createAudio8TtsProvider({ runtimeDir: voiceRuntime, ...options.tools }),
      "qwen3-tts": createQwenTtsProvider({ runtimeDir: voiceRuntime, ...options.tools })
    };
    const queued = async (id2, work) => {
      const release2 = await acquireVoiceQueue(
        join13(voiceRuntime, ".queues", id2),
        context.signal,
        () => context.reportProgress({ stage: "waiting", message: "等待上一段本地配音完成" })
      );
      try {
        return await work();
      } finally {
        await release2();
      }
    };
    const connections = validateMediaConnections(options.connections ?? []);
    const publicConfig = request.publicConnections === void 0 ? { connections, defaultModelId: options.defaultModelId } : resolveMediaConnections(request.publicConnections, { publicOnly: true });
    const tool = async (command) => runMediaProcess(command, ["-version"], {
      signal: context.signal,
      maxStdoutBytes: 65536
    }).then(
      () => true,
      () => false
    );
    const toolsAvailable = async () => (await Promise.all([
      tool(options.tools?.ffmpegPath ?? "ffmpeg"),
      tool(options.tools?.ffprobePath ?? "ffprobe")
    ])).every(Boolean);
    const voices = async () => {
      const local = await detectLocalTts({ ...options.tools, signal: context.signal });
      const audioTools = await toolsAvailable();
      const models = [
        {
          id: "macos-say",
          name: "macOS 系统配音",
          provider: "macOS",
          available: local.available,
          reason: local.reason ? publicMessage(new Error(local.reason)) : void 0,
          voices: local.voices,
          defaultVoiceId: local.defaultVoiceId,
          maxTextLength: 6e3,
          supportsInstructions: false,
          mode: "offline"
        }
      ];
      for (const id2 of ["edge-tts", "kokoro"]) {
        const found = await managed.status(id2, context.signal);
        models.push({
          ...found,
          provider: id2 === "edge-tts" ? "Microsoft Edge 在线语音" : "Kokoro 本地模型",
          available: found.available && audioTools,
          reason: audioTools ? found.reason : "需要 FFmpeg 和 ffprobe 保存音频",
          installable: found.state !== "unavailable",
          maxTextLength: 6e3,
          supportsInstructions: false
        });
      }
      for (const [id2, provider] of Object.entries(cloneProviders)) {
        const found = await provider.status(context.signal);
        models.push({
          ...found,
          provider: "video-studio",
          available: found.available && audioTools,
          reason: audioTools ? found.reason : "需要 FFmpeg 和 ffprobe 保存音频",
          installable: found.state !== "unavailable",
          maxTextLength: 2e3,
          supportsInstructions: false,
          supportsVoiceCloning: true
        });
      }
      models.push(
        ...publicConfig.connections.map(safeConnectionDescription).map((c) => ({
          ...c,
          available: c.available && audioTools,
          ...!audioTools ? { reason: "在线配音需要 FFmpeg 和 ffprobe" } : {}
        }))
      );
      const defaultModelId = [
        publicConfig.defaultModelId,
        ...publicConfig.connections.map((c) => c.description.id),
        "edge-tts",
        "kokoro",
        "macos-say"
      ].find((id2) => models.some((m) => m.id === id2 && m.available)) ?? "macos-say";
      return {
        ...local,
        reason: local.reason ? publicMessage(new Error(local.reason)) : void 0,
        available: models.some((m) => m.available),
        models,
        defaultModelId
      };
    };
    let result;
    if (request.action === "status") {
      const [ffmpeg, speech, hf, browser] = await Promise.all([
        toolsAvailable(),
        voices(),
        detectHyperframesRuntime(options.tools),
        options.tools?.browserPath ?? findCaptionBrowser()
      ]);
      const whisperModel = options.tools?.whisperModelPath ?? join13(homedir5(), ".cache/whisper/base.pt");
      const whisperExecutable = await findExecutable(
        "whisper",
        options.tools?.whisperPath,
        options.toolSearchDirectories
      );
      const whisperModelReady = await access4(whisperModel).then(
        () => true,
        () => false
      );
      let whisperReason;
      let whisperAvailable = false;
      if (!whisperExecutable && whisperModelReady) whisperReason = "executable-missing";
      else if (whisperExecutable && !whisperModelReady) whisperReason = "model-missing";
      else if (whisperExecutable)
        whisperAvailable = await runMediaProcess(whisperExecutable, ["--help"], {
          signal: context.signal,
          maxStdoutBytes: 65536
        }).then(
          () => true,
          () => {
            whisperReason = "executable-failed";
            return false;
          }
        );
      result = {
        apiVersion: 1,
        persistent: true,
        processors: [...MEDIA_ACTIONS],
        ffmpeg: { available: ffmpeg },
        transcription: {
          available: whisperAvailable,
          engine: "local-whisper",
          model: basename3(whisperModel, ".pt"),
          ...whisperReason ? { reason: whisperReason } : {}
        },
        hyperframes: {
          available: hf.available,
          version: hf.version,
          checks: hf.checks.map((c) => ({
            name: c.name,
            ok: c.ok,
            detail: c.name === "Chrome" && c.ok ? "已安装" : publicMessage(new Error(c.detail))
          }))
        },
        captions: { available: Boolean(browser) },
        tts: {
          available: speech.available,
          engine: speech.engine,
          defaultModelId: speech.defaultModelId,
          defaultVoiceId: speech.defaultVoiceId,
          reason: speech.reason
        }
      };
    } else if (request.action === "voices") result = await voices();
    else if (request.action === "tts-setup") {
      const id2 = params.providerId;
      if (!["edge-tts", "kokoro", "audio8-tts", "qwen3-tts"].includes(String(id2)))
        throw new MediaRequestError("请选择支持安装的声音引擎");
      result = await queued(
        id2,
        () => id2 === "audio8-tts" || id2 === "qwen3-tts" ? cloneProviders[id2].setup(context) : managed.setup(id2, context)
      );
    } else if (request.action === "tts" || request.action === "tts-clone") {
      const modelId = params.modelId ?? "macos-say";
      let rendered, input;
      if (request.action === "tts-clone" && modelId !== "audio8-tts" && modelId !== "qwen3-tts")
        throw new MediaRequestError("请选择支持本人声音的模型");
      if (modelId === "audio8-tts" || modelId === "qwen3-tts") {
        if (params.voiceId !== void 0 && params.voiceId !== "reference")
          throw new MediaRequestError("本人声音须使用参考录音音色");
        if (params.instructions) throw new MediaRequestError("本人声音模型不支持额外风格指令");
        const referencePath = await resolveAssetPath(
          context.scope,
          String(params.referenceAssetId)
        );
        input = {
          text: params.text,
          referenceText: params.referenceText,
          referenceAssetId: params.referenceAssetId,
          rate: params.rate ?? 1,
          voiceId: "reference"
        };
        rendered = await queued(
          modelId,
          () => cloneProviders[modelId].generate(
            {
              text: input.text,
              referenceText: input.referenceText,
              referencePath,
              rate: input.rate
            },
            context
          )
        );
      } else if (modelId === "macos-say") {
        input = validateLocalTtsInput2({
          text: params.text,
          voiceId: params.voiceId,
          rate: params.rate
        });
        rendered = await generateLocalTts(input, context, options.tools);
        input.voiceId = rendered.voice.id;
      } else if (modelId === "edge-tts" || modelId === "kokoro") {
        input = { text: params.text, voiceId: params.voiceId, rate: params.rate ?? 1 };
        rendered = await queued(
          modelId,
          () => managed.generate({ ...input, providerId: modelId }, context)
        );
        input.voiceId = rendered.voice.id;
      } else {
        const selected = connections.find(
          (c) => c.description.id === modelId && c.description.available
        );
        if (!selected) throw new MediaRequestError("此配音连接已更改或不可用，请重新选择");
        const text2 = typeof params.text === "string" ? params.text.replace(/\r\n?/g, "\n").trim() : "";
        if (!text2 || Array.from(text2).length > selected.description.maxTextLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text2))
          throw new MediaRequestError("配音文稿超出模型限制或包含无效字符");
        const voiceId = params.voiceId ?? selected.description.defaultVoiceId, instructions = params.instructions ?? selected.defaultInstructions;
        if (!selected.description.voices.some((voice) => voice.id === voiceId))
          throw new MediaRequestError("请选择此模型支持的声音");
        if (instructions !== void 0 && (typeof instructions !== "string" || instructions.length > 2e3 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(instructions) || instructions.trim() && !selected.description.supportsInstructions))
          throw new MediaRequestError("此模型不支持所填朗读风格指令");
        input = {
          text: text2,
          voiceId,
          rate: params.rate ?? selected.defaultRate,
          ...instructions ? { instructions } : {}
        };
        rendered = await generateOpenAiTts({ ...input, model: selected.model }, context, {
          baseUrl: selected.baseUrl,
          apiKey: selected.apiKey,
          ...options.tools
        });
      }
      const name = `配音-${Array.from(input.text).slice(0, 24).join("").replace(/[\\/:*?"<>|\r\n]/g, " ")}.wav`;
      const asset = await publish(rendered.path, "audio/wav", "speech", name);
      result = {
        asset,
        inspection: await inspectMediaFile(rendered.path, context, processorOptions),
        speech: { ...input, modelId, engine: rendered.engine }
      };
    } else if (request.action === "audio-extract" || request.action === "audio-enhance") {
      const factory = request.action === "audio-extract" ? createAudioExtractProcessor : createAudioEnhanceProcessor;
      result = await factory({
        ...options.tools,
        resolveAssetPath,
        publishArtifact: (_scope, path, mimeType) => publish(
          path,
          mimeType,
          request.action,
          request.action === "audio-extract" ? "本人声音参考片段.wav" : "优化后的原声.wav"
        )
      }).run(params, context);
    } else if (request.action === "prepare") {
      const first = await processors.inspect.run(params, context);
      result = { assetId: first.assetId, inspection: first.inspection, preparedAt: Date.now() };
      const info = first.inspection;
      const kinds = [
        "thumbnail",
        ...info.kind !== "image" ? ["proxy"] : [],
        ...info.audio ? ["waveform", "silence"] : [],
        ...info.kind === "video" ? ["scenes"] : [],
        ...params.transcribe && info.audio ? ["transcribe"] : []
      ];
      for (const [index, kind] of kinds.entries()) {
        const value = await processors[kind].run(
          { assetId: params.assetId },
          {
            ...context,
            reportProgress: (p) => context.reportProgress({
              ...p,
              stage: kind,
              fraction: (index + (p.fraction ?? 0)) / kinds.length
            })
          }
        );
        result[kind === "transcribe" ? "transcription" : kind] = kind === "proxy" || kind === "thumbnail" ? value[kind] : value;
      }
    } else if (request.action === "import") {
      const imported = [];
      for (const [id2, path] of inputs) {
        const inspection = await inspectMediaFile(path, context, processorOptions);
        const name = typeof params.names?.[id2] === "string" ? basename3(params.names[id2]) : basename3(path);
        const asset = await publish(
          path,
          EXTENSION_MIME[extname(name).toLowerCase()] ?? (inspection.kind === "image" ? "image/png" : inspection.kind === "audio" ? "audio/wav" : "video/mp4"),
          "source",
          name
        );
        imported.push(asset);
      }
      result = { assets: imported };
    } else if (request.action === "scene") {
      const sceneParams = object2(params.params ?? params);
      const adapter = createHyperframesAdapter({
        ...options.tools,
        workspaceRoot: join13(context.workDir, "scenes"),
        cacheRoot: join13(runtime, "scenes", options.scopeKey)
      });
      const hfContext = {
        signal: context.signal,
        onProgress: (p) => context.reportProgress({ stage: p.phase, message: p.message, fraction: p.progress })
      };
      const scene = await adapter.createScene(sceneParams, hfContext), output = await adapter.render(scene, { ...hfContext, fps: 30 });
      const asset = await publish(
        output.artifactPath,
        "video/mp4",
        "scene",
        `${sceneParams.title}.mp4`
      );
      const source = await publish(output.sourcePath, "text/html", "scene-source", "index.html"), config = await publish(
        output.paramsPath,
        "application/json",
        "scene-parameters",
        "scene.json"
      );
      result = {
        asset,
        scene: {
          params: sceneParams,
          contentHash: output.contentHash,
          cached: output.cached,
          rendererVersion: output.rendererVersion,
          source,
          config
        },
        durationSeconds: output.durationSeconds,
        width: output.width,
        height: output.height
      };
    } else result = await processors[request.action].run(params, context);
    const convert = async (value, role = "artifact") => {
      if (!value || typeof value !== "object") return value;
      if (Array.isArray(value)) return Promise.all(value.map((v) => convert(v, role)));
      if (typeof value.path === "string" && typeof value.mimeType === "string") {
        const asset = await publish(value.path, value.mimeType, role);
        return {
          asset,
          file: artifacts.find((a) => a.assetId === asset.id).file,
          mimeType: value.mimeType,
          available: true
        };
      }
      const output = {};
      for (const [key, child] of Object.entries(value)) {
        if (/^(?:path|artifactPath|sourcePath|projectDir|paramsPath|apiKey|baseUrl)$/.test(key))
          continue;
        output[key] = typeof child === "string" && ["reason", "message", "detail"].includes(key) ? publicMessage(new Error(child)) : await convert(child, key);
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
    if (context.signal.aborted || error instanceof Error && error.name === "AbortError")
      throw mediaAbortError();
    throw new Error(publicMessage(error), { cause: error });
  } finally {
    await caption.close(context.jobId);
    await rm12(context.workDir, { recursive: true, force: true }).catch(() => {
    });
    if (!succeeded) await rm12(context.outputDir, { recursive: true, force: true }).catch(() => {
    });
  }
}

// native/media/media-cli.ts
async function privateDirectory(root, parts) {
  let path = root;
  for (const part of parts) {
    path = join14(path, part);
    await mkdir13(path, { mode: 448 }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    const info = await lstat3(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("媒体任务目录无效");
  }
  return path;
}
async function sealedConnections() {
  const index = process.argv.indexOf("--connections-file");
  if (index < 0) return { connections: [] };
  const path = process.argv[index + 1];
  if (!path) throw new Error("配音连接配置不可用");
  const file = await open5(path, constants4.O_RDONLY | (constants4.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 2 * 1024 * 1024 || info.nlink !== 1 || process.platform !== "win32" && info.mode & 63)
      throw new Error("配音连接配置不可用");
    let parsed;
    try {
      parsed = JSON.parse(await file.readFile("utf8"));
    } catch {
      throw new Error("配音连接配置不可用");
    }
    return resolveMediaConnections(parsed);
  } finally {
    await file.close();
  }
}
async function runCli(raw) {
  if (raw === void 0) {
    let bytes = 0;
    const chunks = [];
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) {
        process.stdout.write(
          JSON.stringify({ type: "error", message: "媒体请求超过大小限制" }) + "\n"
        );
        process.exitCode = 1;
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    try {
      raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      process.stdout.write(JSON.stringify({ type: "error", message: "媒体请求格式无效" }) + "\n");
      process.exitCode = 1;
      return;
    }
  }
  const controller = new AbortController(), abort2 = () => controller.abort();
  process.once("SIGTERM", abort2);
  process.once("SIGINT", abort2);
  const emit = (value) => {
    process.stdout.write(JSON.stringify(value) + "\n");
  };
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("媒体请求无效");
    const value = raw;
    if (Object.keys(value).some(
      (key) => !["action", "params", "inputs", "publicConnections", "scopeKey", "jobId"].includes(key)
    ))
      throw new Error("媒体请求包含不支持的字段");
    const { scopeKey, jobId, ...input } = value;
    if (typeof scopeKey !== "string" || !/^[a-f0-9]{64}$/.test(scopeKey) || typeof jobId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(jobId))
      throw new Error("媒体任务标识无效");
    const request = validateMediaRequest(input);
    const cwd = process.cwd();
    if ((await lstat3(cwd)).isSymbolicLink()) throw new Error("媒体数据目录无效");
    const root = await realpath5(cwd);
    const sealedDirectory = async (flag, fallback) => {
      const index = process.argv.indexOf(flag);
      if (index < 0) return fallback();
      const path = process.argv[index + 1];
      if (!path || !path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path))
        throw new Error("媒体运行目录无效");
      const info = await lstat3(path);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("媒体运行目录无效");
      return realpath5(path);
    };
    const jobDir = await sealedDirectory(
      "--job-dir",
      () => privateDirectory(root, ["jobs", scopeKey, jobId])
    );
    const runtimeDir = await sealedDirectory(
      "--runtime-dir",
      () => privateDirectory(root, ["runtime", "media"])
    );
    const config = await sealedConnections();
    const signal = combineAbortSignals([
      controller.signal,
      AbortSignal.timeout(request.action === "tts-setup" ? 45 * 6e4 : 2 * 60 * 6e4)
    ]);
    const result = await runMediaRequest(request, {
      jobDir,
      runtimeDir,
      scopeKey,
      jobId,
      signal,
      ...config,
      reportProgress: async (progress) => emit({ type: "progress", progress })
    });
    if (signal.aborted) throw new Error("媒体任务已取消");
    emit({ type: "result", result });
  } catch (error) {
    const reason = error instanceof Error ? redactHomePath(error.message) : "";
    const message = controller.signal.aborted ? "媒体任务已取消" : reason && reason.length <= 350 && !/https?:/.test(reason) && !containsAbsolutePath(reason) ? reason : "媒体工具未完成，请检查依赖、素材和任务状态后重试";
    emit({ type: "error", message });
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGTERM", abort2);
    process.removeListener("SIGINT", abort2);
  }
}

// native/media/cli.ts
await runCli();
