# Real cloud interview speech fixture

This test-only bundle builds whisper.cpp v1.9.4 for the Debian Bookworm project
runtime. CPU inference, pinned source commit, checked tiny.en weights and the
public upstream JFK fixture make real-model cloud acceptance independent of
private credentials. `--output` exports files; nothing is published or installed
in a user project by this build.

```sh
docker build --output type=local,dest=/tmp/codeshell-speech-fixture \
  -f scripts/fixtures/interview-whisper/Dockerfile .
```

The Host acceptance harness can copy the bundle into a disposable project
container's temporary storage, keep its executable in that disposable project's
workspace (the `/tmp` mount stays non-executable), start the loopback provider,
and feed `jfk.wav` to Chromium's
synthetic microphone. The normal runtime image and Panel package do not contain
these weights or a new default model. Project stop/start clears that temporary
provider, so recovery must use the already persisted transcript.

The English-only model ignores the current UI language hint; this is explicit
fixture behavior and does not validate Chinese recognition. The English fixture tests transport, selected connection delivery, actual
inference and durable task behavior. It does not measure Chinese recognition
quality or physical microphone quality. The slow cancellation endpoint remains
controlled so cancellation has a deterministic in-flight request.

Upstream: [whisper.cpp pinned source](https://github.com/ggml-org/whisper.cpp/tree/927cfce34f31707e17f2bff35c349632fb9e2c3a).
