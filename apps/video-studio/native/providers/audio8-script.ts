// This wrapper uses only the separately reviewed, hash-pinned ONNX runtime modules.
// Host-authorized paths and speech text arrive in a private JSON file, never Python source.
export const AUDIO8_SCRIPT = String.raw`
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
