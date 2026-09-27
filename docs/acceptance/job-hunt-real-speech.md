# Job Hunt: real speech-model acceptance

This opt-in check runs the actual `interview-transcribe` native entry against a
local whisper.cpp CPU server. It uses the upstream public JFK sample, first as
WAV and then encoded as WebM/Opus. No account, API key, private recording or paid
service is required. This is separate from the offline mock-provider suite.

The check verifies:

- the selected audio connection reaches a real model through multipart HTTP;
- both formats produce recognizable speech, with matching resource/source receipts;
- stopping the provider and reopening the same task returns its durable result;
- the original audio bytes remain unchanged.

It does not prove Host credential grants, browser recording, cloud container/UI
execution, physical microphone behavior, Chinese recognition quality, production
concurrency or target-server deployment. Those require their respective acceptance
runs. English-only `tiny.en` is the small validation model, not the product's
mandatory model. Existing desktop speech processing is unchanged.

## Reproduce

Requirements: Node 22.16+, CMake, a C/C++ compiler, Git, curl and FFmpeg with Opus.
All model/server files stay outside the repository. The script refuses an existing
output directory and verifies both public input hashes before starting a server.
The server binds only to `127.0.0.1`, runs as the invoking user and stops after the
check (also on failure).

```sh
task_root="$(mktemp -d)"
git clone --depth 1 --branch v1.9.4 https://github.com/ggml-org/whisper.cpp.git "$task_root/whisper"
test "$(git -C "$task_root/whisper" rev-parse HEAD)" = 927cfce34f31707e17f2bff35c349632fb9e2c3a
cmake -S "$task_root/whisper" -B "$task_root/whisper/build" \
  -DGGML_METAL=OFF -DGGML_BLAS=OFF -DWHISPER_BUILD_TESTS=OFF -DCMAKE_BUILD_TYPE=Release
cmake --build "$task_root/whisper/build" --target whisper-server -j 2
curl -fL --retry 2 --max-time 180 -o "$task_root/ggml-tiny.en.bin" \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin
node scripts/verify-job-hunt-whisper.mjs \
  --server "$task_root/whisper/build/bin/whisper-server" \
  --model "$task_root/ggml-tiny.en.bin" \
  --fixture "$task_root/whisper/samples/jfk.wav" \
  --output "$task_root/evidence"
```

The GitHub workflow **Job Hunt real speech model** runs the same sequence on
Linux for pull requests that change the native entry or this verifier, and can
also be started manually after it reaches the default branch. Its artifact contains `acceptance.json` and `provider.log`; success is
reported only after actual inference and offline result recovery. It does not
publish packages, deploy services or change any user project.

`acceptance.json` records platform, model/binary/native-entry hashes, source-audio
hash, recognized text and individual elapsed times. Times are diagnostic evidence,
not a benchmark or a service performance promise. The generated connection file
contains an empty API key and an ephemeral loopback URL; it is not a Host-issued
authorization receipt.

## Pinned inputs

| Input | Identity |
| --- | --- |
| whisper.cpp | `v1.9.4`, commit `927cfce34f31707e17f2bff35c349632fb9e2c3a` |
| ggml tiny.en model SHA-256 | `921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f` |
| Public `samples/jfk.wav` SHA-256 | `59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e` |

The server's configurable inference route and FFmpeg conversion are documented
in the [upstream server guide](https://github.com/ggml-org/whisper.cpp/blob/927cfce34f31707e17f2bff35c349632fb9e2c3a/examples/server/README.md).
The model is from the [upstream model catalog](https://github.com/ggml-org/whisper.cpp/blob/927cfce34f31707e17f2bff35c349632fb9e2c3a/models/README.md).

## Observed result

On 2026-09-27, the production native entry passed on macOS arm64 with the above
model and public fixture: both WAV and WebM recognized the sample's “ask not” and
“country” phrases; the saved task results reopened with the provider stopped,
and original audio hashes stayed unchanged. Linux evidence is tracked by the
manual workflow, separately from this local observation.
