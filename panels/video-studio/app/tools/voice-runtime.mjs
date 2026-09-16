import { createRequire as __panelCreateRequire } from "node:module"; const require = __panelCreateRequire(import.meta.url);

// native/voice-runtime.ts
import { lstat as lstat2, mkdir as mkdir5, realpath as realpath2, rename as rename5, rm as rm5, stat as stat3 } from "node:fs/promises";
import { dirname as dirname2, join as join5 } from "node:path";

// native/signals.ts
function combineAbortSignals(signals) {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const controller = new AbortController();
  const abort = () => {
    for (const signal of signals) signal.removeEventListener("abort", abort);
    controller.abort();
  };
  for (const signal of signals) {
    if (signal.aborted) {
      abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

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
  return new Promise((resolve3, reject) => {
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
        resolve3({ stdout: Buffer.concat(stdout), stderr });
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
  const bounded = combineAbortSignals([signal, deadline]);
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
      { signal: bounded, maxStdoutBytes: 64 * 1024 }
    );
    const data = JSON.parse(raw.stdout.toString("utf8"));
    const audio2 = data.streams?.[0];
    if (!audio2) throw new Error(NO_AUDIO);
    let durationSeconds = duration(audio2.duration) ?? duration(data.format?.duration);
    if (durationSeconds !== void 0) return { audio: audio2, durationSeconds };
    let pending = "", bytes2 = 0, packets = 0;
    let firstTime, lastTime, lastDelta = 0, lastEnd = -Infinity;
    const consume = (chunk) => {
      bytes2 += chunk.length;
      if (bytes2 > 4 * 1024 * 1024) throw new Error(NO_DURATION);
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
      { signal: bounded, onStdout: consume }
    );
    consume(Buffer.from("\n"));
    const origin = number(audio2.start_time) ?? number(data.format?.start_time) ?? firstTime;
    durationSeconds = origin === void 0 ? void 0 : duration(lastEnd - origin);
    if (durationSeconds === void 0) throw new Error(NO_DURATION);
    return { audio: audio2, durationSeconds };
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
  const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const scopeKey = hash([scope.appId, resolve(scope.projectPath)]);
  return {
    scopeKey,
    voiceName: hash([
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
  let release;
  const gate = new Promise((resolve3) => {
    release = resolve3;
  });
  const tail = previous.then(() => gate);
  generationQueues.set(dir, tail);
  void tail.then(() => {
    if (generationQueues.get(dir) === tail) generationQueues.delete(dir);
  });
  try {
    if (pending)
      await context.reportProgress({ stage: "waiting", message: "等待上一段本地配音完成" });
    await new Promise((resolve3, reject) => {
      const abort = () => {
        signal.removeEventListener("abort", abort);
        reject(mediaAbortError());
      };
      signal.addEventListener("abort", abort, { once: true });
      void previous.then(() => {
        signal.removeEventListener("abort", abort);
        resolve3();
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
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  return hash.digest("hex");
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
    const request2 = join(context.workDir, `audio8-request-${randomUUID()}.json`);
    await writeFile(
      request2,
      JSON.stringify({ ...data, modelPath, codePath, threads: Math.min(5, cpus().length) }),
      { mode: 384 }
    );
    let pending = "";
    const decoder = new StringDecoder("utf8");
    let result;
    let failure;
    let progress = Promise.resolve();
    try {
      await runMediaProcess(python, ["-I", script, request2], {
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
      await rm(request2, { force: true });
    }
  }
  async function downloadResource(resource, signal, report) {
    const path = join(dir, resource.kind, resource.path);
    const valid = await stat(path).then(
      async (s) => s.size === resource.bytes && await digest(path, signal) === resource.sha256,
      () => false
    );
    if (valid) {
      await report(resource.bytes);
      return;
    }
    await mkdir(resolve(path, ".."), { recursive: true, mode: 448 });
    const partial = `${path}-${randomUUID()}.partial`;
    const handle = await open(partial, "wx", 384);
    try {
      const response = await fetch(resource.url, { signal });
      if (!response.ok || !response.body || !response.url.startsWith("https://"))
        throw new Error("Audio8 resource download failed");
      const hash = createHash("sha256");
      let bytes2 = 0;
      let reportedAt = 0;
      const reader = response.body.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes2 += chunk.value.byteLength;
          if (bytes2 > resource.bytes) throw new Error("Audio8 download exceeds expected size");
          hash.update(chunk.value);
          let offset = 0;
          while (offset < chunk.value.byteLength) {
            const written = await handle.write(chunk.value.subarray(offset));
            if (!written.bytesWritten) throw new Error("Audio8 download could not be saved");
            offset += written.bytesWritten;
          }
          if (Date.now() - reportedAt >= 1e3) {
            await report(bytes2);
            reportedAt = Date.now();
          }
        }
      } finally {
        await reader.cancel().catch(() => {
        });
      }
      if (bytes2 !== resource.bytes || hash.digest("hex") !== resource.sha256)
        throw new Error("Audio8 resource integrity check failed");
      if (signal.aborted) throw mediaAbortError();
      await handle.close();
      await rename(partial, path);
      await report(bytes2);
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
          await downloadResource(item, signal, async (bytes2) => {
            const downloaded = completed + bytes2;
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
    let release;
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
      release?.();
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
  let release;
  const gate = new Promise((resolve3) => {
    release = resolve3;
  });
  const tail = previous.then(() => gate);
  generationQueues2.set(dir, tail);
  void tail.then(() => {
    if (generationQueues2.get(dir) === tail) generationQueues2.delete(dir);
  });
  try {
    if (pending)
      await context.reportProgress({ stage: "waiting", message: "等待上一段本地配音完成" });
    await new Promise((resolve3, reject) => {
      const abort = () => {
        signal.removeEventListener("abort", abort);
        reject(mediaAbortError());
      };
      signal.addEventListener("abort", abort, { once: true });
      void previous.then(() => {
        signal.removeEventListener("abort", abort);
        resolve3();
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
  const hash = createHash2("sha256");
  for await (const chunk of createReadStream2(path, { signal })) hash.update(chunk);
  return hash.digest("hex");
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
    const request2 = join2(context.workDir, `qwen-request-${randomUUID2()}.json`);
    await writeFile2(request2, JSON.stringify({ ...data, modelPath }), { mode: 384 });
    let pending = "";
    const decoder = new StringDecoder2("utf8");
    let result;
    let progress = Promise.resolve();
    try {
      await runMediaProcess(python, ["-I", script, request2], {
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
      await rm2(request2, { force: true });
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
    let release;
    try {
      release = await acquireGeneration2(dir, context, signal);
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
      release?.();
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
  return new Promise((resolve3, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(mediaAbortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve3();
    }, 150);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
async function acquireVoiceQueue(root, signal, waiting) {
  if (signal.aborted) throw mediaAbortError();
  await mkdir3(root, { recursive: true, mode: 448 });
  const identity = `${process.pid}-${randomUUID3()}`;
  const choosing = join3(root, `${identity}.choosing`);
  const ticketPath = join3(root, `${identity}.ticket`);
  const partial = join3(root, `${identity}.partial`);
  const release = async () => {
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
      const id = `${match[1]}-${match[2]}`;
      const entry = entries.get(id) ?? { choosing: false, ticket: 0 };
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
      entries.set(id, entry);
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
        ([id, entry]) => id !== identity && (entry.choosing || entry.ticket > 0 && (entry.ticket < ticket || entry.ticket === ticket && id < identity))
      );
      if (!blocked) return release;
      if (!reported) {
        await waiting();
        reported = true;
      }
      await pause(signal);
    }
  } catch (error) {
    await release();
    throw error;
  }
}

// native/voice-library.ts
import { constants } from "node:fs";
import { createHash as createHash3, randomUUID as randomUUID4 } from "node:crypto";
import { lstat, mkdir as mkdir4, open as open3, readdir as readdir3, realpath, rename as rename4, rm as rm4 } from "node:fs/promises";
import { dirname, join as join4 } from "node:path";
var MAX_AUDIO = 16 * 1024 * 1024;
var MAX_VOICES = 20;
var HEX = /^[a-f0-9]{64}$/;
var UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
var ASSET = /^(?:asset|external)-[a-f0-9]{64}$/;
function check(ok, message = "声音库数据无效，原有声音已保留") {
  if (!ok) throw new Error(message);
}
function text(value, limit) {
  return typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}
function audio(value) {
  check(
    value && HEX.test(value.sha256) && Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= MAX_AUDIO
  );
  check(typeof value.mimeType === "string" && /^audio\/[a-z0-9.+-]{1,80}$/.test(value.mimeType));
  return { sha256: value.sha256, bytes: value.bytes, mimeType: value.mimeType };
}
function validateLibraryEntry(value) {
  const r = value?.recipe;
  check(value?.schemaVersion === 1 && r && text(r.id, 80));
  check(text(r.name, 80) && ["audio8-tts", "qwen3-tts"].includes(r.modelId));
  check(ASSET.test(r.referenceMediaId) && ASSET.test(r.sampleMediaId));
  check(text(r.referenceText, 1e3) && text(r.sampleText, 120) && text(r.referenceName, 256));
  check(
    Number.isFinite(r.referenceDurationSeconds) && r.referenceDurationSeconds >= 3 && r.referenceDurationSeconds <= 30
  );
  const recipe = {
    id: r.id,
    name: r.name,
    modelId: r.modelId,
    referenceMediaId: r.referenceMediaId,
    referenceText: r.referenceText,
    sampleMediaId: r.sampleMediaId,
    sampleText: r.sampleText,
    referenceName: r.referenceName,
    referenceDurationSeconds: r.referenceDurationSeconds
  };
  return {
    schemaVersion: 1,
    recipe,
    reference: audio(value.reference),
    sample: audio(value.sample)
  };
}
async function directory(root, parts, create = true) {
  let path = root;
  for (const part of parts) {
    check(/^[a-zA-Z0-9._-]+$/.test(part) && part !== "." && part !== "..");
    path = join4(path, part);
    if (create)
      await mkdir4(path, { mode: 448 }).catch((e) => {
        if (e.code !== "EEXIST") throw e;
      });
    const info = await lstat(path);
    check(info.isDirectory() && !info.isSymbolicLink(), "声音库目录无效，请检查后重试");
  }
  return path;
}
async function bytes(path, maximum) {
  const file = await open3(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    check(info.isFile() && info.size <= maximum);
    const result = await file.readFile();
    check(result.length === info.size && result.length <= maximum);
    return result;
  } finally {
    await file.close();
  }
}
async function json(path) {
  return JSON.parse((await bytes(path, 32 * 1024)).toString("utf8"));
}
async function writeJson(path, value) {
  const temporary = `${path}.${randomUUID4()}.partial`;
  const file = await open3(temporary, "wx", 384);
  try {
    try {
      await file.writeFile(JSON.stringify(value));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename4(temporary, path);
    const parent = await open3(dirname(path), "r").catch(() => void 0);
    try {
      await parent?.sync().catch(() => {
      });
    } finally {
      await parent?.close();
    }
  } finally {
    await rm4(temporary, { force: true });
  }
}
function digest3(value) {
  return createHash3("sha256").update(value).digest("hex");
}
function entryName(id) {
  return `${createHash3("sha256").update(id).digest("hex")}.json`;
}
function audioSignature(b) {
  return b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WAVE" || b.toString("ascii", 0, 3) === "ID3" || b.length >= 2 && b[0] === 255 && (b[1] & 224) === 224 || b.toString("ascii", 0, 4) === "OggS" || b.toString("ascii", 0, 4) === "fLaC" || b.length >= 12 && b.toString("ascii", 4, 8) === "ftyp" || b.length >= 4 && b.readUInt32BE(0) === 440786851;
}
async function verified(path, meta) {
  const data = await bytes(path, MAX_AUDIO);
  check(
    data.length === meta.bytes && digest3(data) === meta.sha256 && audioSignature(data),
    "声音文件不完整或校验失败，原有声音已保留"
  );
  return data;
}
async function runVoiceLibrary(raw, signal, appData = process.cwd()) {
  check(
    raw?.action === "library" && ["list", "begin", "write", "commit", "cancel", "get", "read"].includes(raw.operation)
  );
  signal.throwIfAborted();
  const root = await realpath(appData);
  const voices = await directory(root, ["voices"]);
  const entries = await directory(voices, ["entries"]);
  const blobs = await directory(voices, ["blobs"]);
  const staging = await directory(voices, ["staging"]);
  if (raw.operation === "list") {
    const names = (await readdir3(entries)).filter((name) => HEX.test(name.replace(/\.json$/, "")) && name.endsWith(".json")).sort();
    check(names.length <= MAX_VOICES, "声音库已达到容量限制");
    const result = [];
    for (const name of names) {
      signal.throwIfAborted();
      const entry2 = validateLibraryEntry(await json(join4(entries, name)));
      check(name === entryName(entry2.recipe.id));
      result.push(entry2.recipe);
    }
    return result;
  }
  if (raw.operation === "get" || raw.operation === "read") {
    check(text(raw.id, 80));
    const entry2 = validateLibraryEntry(await json(join4(entries, entryName(raw.id))));
    check(entry2.recipe.id === raw.id);
    if (raw.operation === "get") return entry2;
    check(raw.part === "reference" || raw.part === "sample");
    check(Number.isSafeInteger(raw.offset) && raw.offset >= 0);
    const meta = entry2[raw.part];
    check(raw.offset < meta.bytes);
    const file = await open3(join4(blobs, meta.sha256), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      check(info.isFile() && info.size === meta.bytes);
      const chunk = Buffer.alloc(Math.min(512 * 1024, meta.bytes - raw.offset));
      let offset = 0;
      while (offset < chunk.length) {
        const result = await file.read(chunk, offset, chunk.length - offset, raw.offset + offset);
        check(result.bytesRead > 0, "声音库文件不完整，请重新保存声音");
        offset += result.bytesRead;
      }
      return {
        ...meta,
        offset: raw.offset,
        dataBase64: chunk.toString("base64"),
        eof: raw.offset + chunk.length === meta.bytes
      };
    } finally {
      await file.close();
    }
  }
  check(UUID.test(raw.token));
  if (raw.operation === "begin") {
    const entry2 = validateLibraryEntry(raw.entry);
    const stage2 = join4(staging, raw.token);
    await mkdir4(stage2, { mode: 448 });
    await writeJson(join4(stage2, "entry.json"), entry2);
    return { token: raw.token };
  }
  if (raw.operation === "cancel") {
    await rm4(join4(staging, raw.token), { recursive: true, force: true });
    return { cancelled: true };
  }
  const stage = await directory(staging, [raw.token], false);
  const entry = validateLibraryEntry(await json(join4(stage, "entry.json")));
  if (raw.operation === "write") {
    check(raw.part === "reference" || raw.part === "sample");
    check(Number.isSafeInteger(raw.offset) && raw.offset >= 0);
    check(
      typeof raw.dataBase64 === "string" && raw.dataBase64.length <= 43692 && /^[A-Za-z0-9+/]*={0,2}$/.test(raw.dataBase64)
    );
    const data = Buffer.from(raw.dataBase64, "base64");
    check(data.length > 0 && data.length <= 32768 && data.toString("base64") === raw.dataBase64);
    const meta = entry[raw.part];
    check(raw.offset + data.length <= meta.bytes);
    const file = await open3(
      join4(stage, `${raw.part}.bin`),
      constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW,
      384
    );
    try {
      const info = await file.stat();
      check(info.isFile() && info.size === raw.offset);
      let offset = 0;
      while (offset < data.length) {
        const result = await file.write(data, offset, data.length - offset, raw.offset + offset);
        check(result.bytesWritten > 0);
        offset += result.bytesWritten;
      }
      return { offset: raw.offset + data.length };
    } finally {
      await file.close();
    }
  }
  const queue = await directory(voices, ["queue"]);
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(15e3)]);
  const release = await acquireVoiceQueue(queue, bounded, async () => {
  });
  try {
    let previous;
    try {
      previous = validateLibraryEntry(await json(join4(entries, entryName(entry.recipe.id))));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (previous) {
      check(
        JSON.stringify(previous) === JSON.stringify(entry),
        "同名声音记录已由另一个面板更新，请重新打开声音库"
      );
      await verified(join4(blobs, previous.reference.sha256), previous.reference);
      await verified(join4(blobs, previous.sample.sha256), previous.sample);
      return previous.recipe;
    }
    check(
      (await readdir3(entries)).filter((name) => name.endsWith(".json")).length < MAX_VOICES,
      "声音库最多保存 20 个声音"
    );
    for (const part of ["reference", "sample"]) {
      const meta = entry[part];
      const source = join4(stage, `${part}.bin`);
      await verified(source, meta);
      bounded.throwIfAborted();
      const destination = join4(blobs, meta.sha256);
      try {
        await verified(destination, meta);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await rename4(source, destination);
      }
    }
    bounded.throwIfAborted();
    await writeJson(join4(entries, entryName(entry.recipe.id)), entry);
    return entry.recipe;
  } finally {
    await release();
    await rm4(stage, { recursive: true, force: true });
  }
}

// native/voice-runtime.ts
var RequestError = class extends Error {
};
function validateVoiceRequest(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new RequestError("声音任务参数无效");
  const value = raw;
  const allowed = /* @__PURE__ */ new Set([
    "action",
    "engine",
    "scopeKey",
    "jobId",
    "text",
    "referenceText",
    "rate",
    "referenceFile"
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
  if (value.referenceFile !== void 0 && (typeof value.referenceFile !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.referenceFile) || value.referenceFile === "output.wav"))
    throw new RequestError("参考录音文件名无效");
  if (value.action === "generate" && typeof value.referenceFile !== "string")
    throw new RequestError("请先提供参考录音");
  if (value.text !== void 0 && (typeof value.text !== "string" || Array.from(value.text).length > 2e3))
    throw new RequestError("声音克隆每次最多支持 2000 字");
  if (value.referenceText !== void 0 && (typeof value.referenceText !== "string" || Array.from(value.referenceText).length > 1e3))
    throw new RequestError("参考录音逐字稿最多支持 1000 字");
  if (value.rate !== void 0 && (typeof value.rate !== "number" || !Number.isFinite(value.rate) || value.rate < 0.5 || value.rate > 2))
    throw new RequestError("语速须在 0.5 至 2 倍之间");
  return value;
}
async function directory2(root, parts, create) {
  let path = root;
  for (const part of parts) {
    path = join5(path, part);
    if (create)
      await mkdir5(path, { mode: 448 }).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
    const info = await lstat2(path).catch((error) => {
      if (!create && error.code === "ENOENT") return void 0;
      throw error;
    });
    if (info && (!info.isDirectory() || info.isSymbolicLink()))
      throw new RequestError("声音任务目录无效，请重新打开面板后重试");
  }
  return path;
}
var safeProviderMessages = /* @__PURE__ */ new Set([
  ...AUDIO_PROBE_MESSAGES,
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
  "Audio8 临时文件清理未完成，请检查目录权限后重试"
]);
function safeError(error, cancelled) {
  if (cancelled || error instanceof Error && error.name === "AbortError")
    return "本地声音任务已取消";
  if (error instanceof RequestError) return error.message;
  if (error instanceof Error && safeProviderMessages.has(error.message)) return error.message;
  return "本地声音任务未完成，请检查安装状态、参考录音和逐字稿后重试";
}
function publicStatus(status) {
  if (status.reason && (/[\/\\\r\n]/.test(status.reason) || status.reason.length > 500))
    return { ...status, reason: "本地声音环境需要重新准备，请在初始化中重试" };
  return status;
}
async function runCli(raw) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGTERM", abort);
  process.once("SIGINT", abort);
  const emit = (value) => {
    process.stdout.write(`${JSON.stringify(value)}
`);
  };
  let release;
  let published = "";
  try {
    if (raw?.action === "library") {
      emit({ type: "result", result: await runVoiceLibrary(raw, controller.signal) });
      return;
    }
    const request2 = validateVoiceRequest(raw);
    const root = await realpath2(process.cwd());
    const runtime = await directory2(root, ["runtime"], request2.action !== "status");
    await directory2(root, ["runtime", request2.engine], false);
    const provider = request2.engine === "audio8-tts" ? createAudio8TtsProvider({ runtimeDir: runtime }) : createQwenTtsProvider({ runtimeDir: runtime });
    if (request2.action === "status") {
      const result2 = await provider.status(controller.signal);
      emit({ type: "result", result: publicStatus(result2) });
      return;
    }
    const job = await directory2(root, ["jobs", request2.scopeKey, request2.jobId], true);
    const workDir = await directory2(job, ["work"], true);
    const outputDir = await directory2(job, ["rendered"], true);
    const signal = combineAbortSignals([
      controller.signal,
      AbortSignal.timeout(request2.action === "setup" ? 45 * 6e4 : 25 * 6e4)
    ]);
    const context = {
      scope: { appId: "video-studio", projectPath: join5(root, "scopes", request2.scopeKey) },
      jobId: request2.jobId,
      attempt: 1,
      signal,
      workDir,
      outputDir,
      cacheDir: join5(runtime, "cache", request2.scopeKey),
      reportProgress: async (progress) => {
        emit({ type: "progress", progress });
      }
    };
    const queue = await directory2(root, ["runtime", ".queues", request2.engine], true);
    release = await acquireVoiceQueue(
      queue,
      signal,
      () => context.reportProgress({ stage: "waiting", message: "等待上一段本地配音完成" })
    );
    if (request2.action === "setup") {
      emit({ type: "result", result: publicStatus(await provider.setup(context)) });
      return;
    }
    const referencePath = join5(job, request2.referenceFile);
    const reference = await lstat2(referencePath);
    if (!reference.isFile() || reference.isSymbolicLink() || dirname2(await realpath2(referencePath)) !== job)
      throw new RequestError("参考录音须来自当前声音任务");
    const validate = request2.engine === "audio8-tts" ? validateAudio8TtsInput : validateQwenTtsInput;
    const input = validate({
      text: request2.text,
      referenceText: request2.referenceText,
      rate: request2.rate,
      referencePath
    });
    await rm5(join5(job, "output.wav"), { force: true });
    const result = await provider.generate(input, context);
    if (signal.aborted) throw mediaAbortError();
    if (dirname2(await realpath2(result.path)) !== outputDir)
      throw new RequestError("配音结果未通过检查");
    const bytes2 = (await stat3(result.path)).size;
    published = join5(job, "output.wav");
    await rename5(result.path, published);
    if (signal.aborted) throw mediaAbortError();
    emit({
      type: "result",
      result: {
        engine: result.engine,
        file: "output.wav",
        bytes: bytes2,
        mimeType: result.mimeType,
        durationSeconds: result.durationSeconds,
        sampleRate: result.sampleRate,
        channels: result.channels,
        voice: result.voice,
        rate: result.rate,
        cached: result.cached
      }
    });
    published = "";
  } catch (error) {
    if (published) await rm5(published, { force: true }).catch(() => {
    });
    emit({ type: "error", message: safeError(error, controller.signal.aborted) });
    process.exitCode = 1;
  } finally {
    await release?.().catch(() => {
    });
    process.removeListener("SIGTERM", abort);
    process.removeListener("SIGINT", abort);
  }
}

// native/voice-cli.ts
var request;
try {
  request = JSON.parse(process.argv.slice(2).join("") || "null");
} catch {
  request = null;
}
await runCli(request);
