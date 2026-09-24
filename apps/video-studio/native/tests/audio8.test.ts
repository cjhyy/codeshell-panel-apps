import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAudio8TtsProvider,
  validateAudio8TtsInput,
  splitAudio8Text,
  audio8VoiceCacheKey,
} from "../providers/audio8.js";
import { runMediaProcess } from "../process-runner.js";
import type { MediaJobContext } from "../contracts.js";
let root = "";
let serial = 0;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "codeshell-audio8-"));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});
function context(controller = new AbortController()): MediaJobContext {
  const base = join(root, `job-${++serial}`);
  return {
    scope: { appId: "video-studio", projectPath: root },
    jobId: String(serial),
    attempt: 1,
    signal: controller.signal,
    workDir: join(base, "work"),
    outputDir: join(base, "output"),
    cacheDir: join(root, "cache"),
    reportProgress: async () => {},
  };
}
const input = {
  text: "你好，这是中文配音。",
  referencePath: "/host-authorized/reference.wav",
  referenceText: "参考录音逐字稿。",
  rate: 1,
};
test("Chinese and English scripts split without losing words or punctuation", () => {
  const chinese = "今天一起录制视频，".repeat(40) + "保留完整的句尾。";
  const pieces = splitAudio8Text(chinese);
  assert.strictEqual(pieces.join(""), chinese);
  assert.strictEqual(
    pieces.every((piece) => Array.from(piece).length <= 150),
    true,
  );
  assert.ok(pieces.at(-1).endsWith("保留完整的句尾。"));
  const english = "Keep the original words and a natural pause. ".repeat(20).trim();
  assert.strictEqual(splitAudio8Text(english).join(" "), english);
  assert.deepStrictEqual(splitAudio8Text("你好！\n再见。🙂"), ["你好！", "再见。"]);
  const astral = "𠮷".repeat(301);
  assert.deepStrictEqual(
    splitAudio8Text(astral).map((piece) => Array.from(piece).length),
    [150, 150, 1],
  );
});
test("voice profiles are scoped to the application, project, recording content, and transcript", () => {
  const scope = { appId: "video-studio", projectPath: "/host/project" };
  const first = audio8VoiceCacheKey(scope, "a".repeat(64), "原始逐字稿");
  assert.match(first.voiceName, /^[a-f0-9]{64}$/);
  assert.match(first.scopeKey, /^[a-f0-9]{64}$/);
  assert.deepStrictEqual(audio8VoiceCacheKey({ ...scope }, "a".repeat(64), "原始逐字稿"), first);
  for (const [otherScope, hash, text] of [
    [{ ...scope, appId: "other-app" }, "a".repeat(64), "原始逐字稿"],
    [{ ...scope, projectPath: "/host/other" }, "a".repeat(64), "原始逐字稿"],
    [scope, "b".repeat(64), "原始逐字稿"],
    [scope, "a".repeat(64), "修正后的逐字稿"],
  ] as const)
    assert.notStrictEqual(audio8VoiceCacheKey(otherScope, hash, text).voiceName, first.voiceName);
  assert.deepStrictEqual(
    audio8VoiceCacheKey(
      { ...scope, projectPath: "/host/project/../project" },
      "a".repeat(64),
      "原始逐字稿",
    ),
    first,
  );
});
test("clone input bounds Unicode text and reference transcripts without accepting runtime overrides", () => {
  assert.deepStrictEqual(
    validateAudio8TtsInput({
      ...input,
      text: "  你好\r\n测试  ",
      rate: 0.5,
      modelPath: "/untrusted",
      endpoint: "https://untrusted.invalid",
    }),
    { ...input, text: "你好\n测试", rate: 0.5 },
  );
  for (const update of [
    { text: "🙂。" },
    { text: "字".repeat(2001) },
    { referenceText: "字".repeat(1001) },
    { referenceText: "" },
    { referenceText: "[[rate 1]]" },
    { referenceText: "a\0b" },
    { referencePath: "https://example.com/audio.wav" },
    { referencePath: "relative.wav" },
    { referencePath: "/tmp/a\0b.wav" },
    { rate: NaN },
    { rate: 2.1 },
  ])
    assert.throws(() => validateAudio8TtsInput({ ...input, ...update }));
  assert.strictEqual(
    validateAudio8TtsInput({ ...input, text: "字".repeat(2000) }).text.length,
    2000,
  );
  assert.throws(
    () => createAudio8TtsProvider({ runtimeDir: "relative" }),
    (error: any) => error.message.includes("absolute"),
  );
});
test("status and pre-cancelled setup are offline reads and do not create an environment", async () => {
  const runtimeDir = join(root, "untouched");
  const api = createAudio8TtsProvider({ runtimeDir, uvPath: "/no-such-installer" });
  const status = await api.status();
  assert.strictEqual(status.id, "audio8-tts");
  assert.strictEqual(status.mode, "offline");
  assert.strictEqual(status.available, false);
  assert.strictEqual(status.installed, false);
  assert.strictEqual(status.voices[0].id, "reference");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(api.setup(context(controller)), { name: "AbortError" });
  await assert.rejects(api.generate(input, context()));
  await assert.rejects(readdir(runtimeDir));
});
describe(
  "Apple Silicon setup boundaries",
  { skip: process.platform !== "darwin" || process.arch !== "arm64" },
  () => {
    test("a failed prerequisite remains unavailable and releases both setup locks for retry", async () => {
      const runtimeDir = join(root, "no-tools");
      const api = createAudio8TtsProvider({ runtimeDir, ffmpegPath: "/missing-ffmpeg" });
      for (let attempt = 0; attempt < 2; attempt++) {
        await assert.rejects(api.setup(context()), (error: any) =>
          error.message.includes("准备失败"),
        );
        assert.strictEqual((await api.status()).state, "failed");
        assert.strictEqual((await api.status()).available, false);
        await assert.rejects(readFile(join(runtimeDir, "audio8-tts", "runtime.json")));
        await assert.rejects(readFile(join(runtimeDir, "audio8-tts", "setup.lock")));
      }
    });
    test("an initializing or live setup lock is never removed by a competing host", async () => {
      const runtimeDir = join(root, "locked");
      const dir = join(runtimeDir, "audio8-tts");
      await mkdir(dir, { recursive: true });
      const lockPath = join(dir, "setup.lock");
      const api = createAudio8TtsProvider({ runtimeDir });
      for (const content of [
        "",
        "{",
        JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
      ]) {
        await writeFile(lockPath, content);
        await assert.rejects(api.setup(context()));
        assert.strictEqual(await readFile(lockPath, "utf8"), content);
        await assert.rejects(readFile(join(dir, "failure.json")));
      }
    });
    test("an abandoned incomplete lock can recover while setup filesystem errors stay private", async () => {
      const runtimeDir = join(root, "orphan-lock");
      const dir = join(runtimeDir, "audio8-tts");
      await mkdir(dir, { recursive: true });
      const lockPath = join(dir, "setup.lock");
      await writeFile(lockPath, "{");
      const old = new Date(Date.now() - 180000);
      await utimes(lockPath, old, old);
      const api = createAudio8TtsProvider({ runtimeDir, ffmpegPath: "/missing-ffmpeg" });
      await assert.rejects(api.setup(context()), (error: any) =>
        error.message.includes("准备失败"),
      );
      assert.strictEqual((await api.status()).state, "failed");
      assert.deepStrictEqual(
        (await readdir(dir)).filter((name) => name.includes("lock")),
        [],
      );
      const blocked = join(root, "private-host-file");
      await writeFile(blocked, "not a directory");
      const unavailable = createAudio8TtsProvider({ runtimeDir: blocked });
      try {
        await unavailable.setup(context());
        throw new Error("setup unexpectedly succeeded");
      } catch (error) {
        assert.ok((error as Error).message.includes("无法创建独立环境"));
        assert.ok(!(error as Error).message.includes(blocked));
        assert.ok(!(error as Error).message.includes("ENOTDIR"));
      }
    });
    test(
      "cancelled installation removes requests, prevents concurrent setup, and strips injected package settings",
      { timeout: 10000 },
      async () => {
        const runtimeDir = join(root, "cancel-install");
        const installer = join(root, "uv-fixture");
        const started = join(root, "installer-started");
        // This test observes installer cancellation and environment filtering, not
        // the cold-start time of the machine's real FFmpeg / FFprobe binaries.
        const mediaProbe = join(root, "media-probe-fixture");
        await writeFile(mediaProbe, "#!/bin/sh\nexit 0\n");
        await chmod(mediaProbe, 0o700);
        await writeFile(
          installer,
          `#!/bin/sh\nprintf '%s' "$UV_EXTRA_INDEX_URL|$PIP_EXTRA_INDEX_URL|$PYTHONPATH|$HF_TOKEN|$HF_HOME" > '${started}'\nexec /bin/sleep 30\n`,
        );
        await chmod(installer, 0o700);
        const options = {
          runtimeDir,
          uvPath: installer,
          ffmpegPath: mediaProbe,
          ffprobePath: mediaProbe,
        };
        const api = createAudio8TtsProvider(options);
        const other = createAudio8TtsProvider(options);
        const controller = new AbortController();
        const job = context(controller);
        const keys = ["UV_EXTRA_INDEX_URL", "PIP_EXTRA_INDEX_URL", "PYTHONPATH", "HF_TOKEN"];
        const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
        for (const key of keys) process.env[key] = "not-forwarded";
        const pending = api.setup(job);
        try {
          for (let attempt = 0; attempt < 100; attempt++) {
            if (
              await readFile(started).then(
                () => true,
                () => false,
              )
            )
              break;
            await new Promise((resolve) => setTimeout(resolve, 30));
          }
          assert.strictEqual(
            await readFile(started, "utf8"),
            `||||${join(runtimeDir, "audio8-tts", "hub-cache")}`,
          );
          assert.strictEqual((await other.status()).state, "installing");
          await assert.rejects(other.setup(context()), (error: any) =>
            error.message.includes("正在运行"),
          );
          controller.abort();
          await assert.rejects(pending, { name: "AbortError" });
          assert.strictEqual((await api.status()).available, false);
          assert.ok((await api.status()).reason.includes("取消"));
          assert.deepStrictEqual(await readdir(job.workDir), []);
          await assert.rejects(readFile(join(runtimeDir, "audio8-tts", "setup.lock")));
        } finally {
          controller.abort();
          await pending.catch(() => {});
          for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }
      },
    );
  },
);
// Explicit opt-in: this suite uses an already prepared real model and never downloads one.
const runtimeDir = process.env.VIDEO_STUDIO_TEST_AUDIO8_RUNTIME;
const referencePath = process.env.VIDEO_STUDIO_TEST_AUDIO8_REFERENCE;
const referenceText = process.env.VIDEO_STUDIO_TEST_AUDIO8_TRANSCRIPT;
describe(
  "real offline Audio8 inference",
  { skip: !runtimeDir || !referencePath || !referenceText },
  () => {
    test(
      "Chinese sentences produce audible 48 kHz mono PCM and a complete, private job",
      { timeout: 240000 },
      async () => {
        const api = createAudio8TtsProvider({ runtimeDir: runtimeDir! });
        assert.strictEqual((await api.status()).available, true);
        const job = context();
        let registrations = 0;
        job.reportProgress = async (progress) => {
          if (progress.stage === "register") registrations++;
        };
        const result = await api.generate(
          {
            text: "你好，这是本地声音克隆测试。今天我们把想法变成视频，保留自然的停顿。",
            referencePath: referencePath!,
            referenceText: referenceText!,
            rate: 1,
          },
          job,
        );
        assert.ok(result.durationSeconds > 3);
        assert.strictEqual(result.sampleRate, 48000);
        assert.strictEqual(result.channels, 1);
        assert.strictEqual(result.cached, false);
        const pcm = await runMediaProcess(
          "ffmpeg",
          ["-v", "error", "-i", result.path, "-f", "f32le", "-ar", "48000", "-ac", "1", "pipe:1"],
          { signal: job.signal },
        );
        let energy = 0;
        for (let index = 0; index < pcm.stdout.length; index += 4)
          energy += pcm.stdout.readFloatLE(index) ** 2;
        assert.ok(Math.sqrt(energy / (pcm.stdout.length / 4)) > 0.005);
        assert.deepStrictEqual(await readdir(job.workDir), []);
        assert.strictEqual((await readdir(job.outputDir)).length, 1);
        const cancelled = new AbortController();
        const finalJob = context(cancelled);
        finalJob.reportProgress = async (progress) => {
          if (progress.stage === "register") registrations++;
          if (progress.fraction === 1) cancelled.abort();
        };
        await assert.rejects(
          api.generate(
            { ...input, referencePath: referencePath!, referenceText: referenceText! },
            finalJob,
          ),
          { name: "AbortError" },
        );
        assert.deepStrictEqual(await readdir(finalJob.workDir), []);
        assert.deepStrictEqual(await readdir(finalJob.outputDir), []);
        assert.strictEqual(registrations, 1);
        console.info(
          `Audio8 offline: ${result.durationSeconds.toFixed(3)}s, 48 kHz mono PCM, temporary input removed`,
        );
      },
    );
    test(
      "reference duration and silence fail before inference; active cancellation leaves no speech",
      { timeout: 30000 },
      async () => {
        const api = createAudio8TtsProvider({ runtimeDir: runtimeDir! });
        for (const seconds of [2, 31, 4]) {
          const invalid = join(root, `invalid-${seconds}.wav`);
          await runMediaProcess(
            "ffmpeg",
            [
              "-v",
              "error",
              "-f",
              "lavfi",
              "-i",
              "anullsrc=r=24000:cl=mono",
              "-t",
              String(seconds),
              invalid,
            ],
            { signal: new AbortController().signal },
          );
          await assert.rejects(
            api.generate({ ...input, referencePath: invalid }, context()),
            (error: any) => error.message.includes(seconds === 4 ? "没有可听见" : "3 至 30 秒"),
          );
        }
        const controller = new AbortController();
        const job = context(controller);
        job.reportProgress = async (progress) => {
          if (progress.stage === "speech") controller.abort();
        };
        await assert.rejects(
          api.generate(
            { ...input, referencePath: referencePath!, referenceText: referenceText! },
            job,
          ),
          { name: "AbortError" },
        );
        assert.deepStrictEqual(await readdir(job.workDir), []);
        assert.deepStrictEqual(await readdir(job.outputDir), []);
        assert.strictEqual((await api.status()).available, true);
      },
    );
    test(
      "a second local job waits and can cancel without interrupting the first or exposing paths",
      { timeout: 30000 },
      async () => {
        const api = createAudio8TtsProvider({ runtimeDir: runtimeDir! });
        const firstController = new AbortController();
        const firstJob = context(firstController);
        let entered!: () => void;
        const ready = new Promise<void>((resolve) => {
          entered = resolve;
        });
        let resume!: () => void;
        const paused = new Promise<void>((resolve) => {
          resume = resolve;
        });
        firstJob.reportProgress = async (progress) => {
          if (progress.stage === "speech") {
            entered();
            await paused;
          }
        };
        const clone = { ...input, referencePath: referencePath!, referenceText: referenceText! };
        const first = api.generate(clone, firstJob);
        const secondController = new AbortController();
        const secondJob = context(secondController);
        let waiting = false;
        secondJob.reportProgress = async (progress) => {
          if (progress.stage === "waiting") {
            waiting = true;
            secondController.abort();
          }
        };
        try {
          await ready;
          await assert.rejects(api.generate(clone, secondJob), { name: "AbortError" });
          assert.strictEqual(waiting, true);
          assert.strictEqual(firstController.signal.aborted, false);
          await assert.rejects(api.setup(context()), (error: any) =>
            error.message.includes("正在运行"),
          );
        } finally {
          firstController.abort();
          resume();
          await assert.rejects(first, { name: "AbortError" });
        }
        assert.deepStrictEqual(await readdir(firstJob.workDir), []);
        assert.deepStrictEqual(await readdir(firstJob.outputDir), []);
        const bad = join(root, "private-host-directory-unreadable.wav");
        await assert.rejects(
          api.generate({ ...clone, referencePath: bad }, context()),
          (error: any) => error.message.includes("本地声音生成失败"),
        );
        try {
          await api.generate({ ...clone, referencePath: bad }, context());
        } catch (error) {
          assert.ok(!(error as Error).message.includes(root));
          assert.ok(!(error as Error).message.includes("ENOENT"));
        }
      },
    );
    test(
      "an audible segment without EOS, or a missing later sentence, never publishes a WAV",
      { timeout: 30000 },
      async () => {
        // Reuse installed libraries and hash-verified model files, but replace inference in a
        // separate fixture process. This exercises the real wrapper AND provider error/cleanup.
        const fixture = join(root, "eos-fixture");
        const dir = join(fixture, "audio8-tts");
        const actual = join(runtimeDir!, "audio8-tts");
        const fakeCode = join(fixture, "stub-code");
        await mkdir(join(dir, "venv", "bin"), { recursive: true });
        await mkdir(join(fakeCode, "arktts_runtime"), { recursive: true });
        await symlink(join(actual, "model"), join(dir, "model"));
        await symlink(join(actual, "code"), join(dir, "code"));
        await copyFile(join(actual, "runtime.json"), join(dir, "runtime.json"));
        await copyFile(join(actual, "runner.py"), join(dir, "runner.py"));
        await writeFile(join(fakeCode, "arktts_runtime", "__init__.py"), "");
        await writeFile(
          join(fakeCode, "arktts_runtime", "registration.py"),
          `
import hashlib, json
from pathlib import Path
import numpy as np
class VoiceRegistration:
    def __init__(self, model_dir, voices_root, fingerprint):
        self.root = voices_root
        self.fingerprint = fingerprint
    def register(self, data, filename, text, name, overwrite):
        folder = self.root / name
        folder.mkdir(parents=True, exist_ok=True)
        np.save(folder / "codes.npy", np.zeros((10, 1), dtype=np.uint16))
        (folder / "meta.json").write_text(json.dumps({"model_fingerprint": self.fingerprint,
            "reference_text": text, "source_sha256": hashlib.sha256(data).hexdigest()}))
`,
        );
        await writeFile(
          join(fakeCode, "arktts_runtime", "runtime.py"),
          `
import json
import numpy as np
class ArkTtsRuntime:
    def __init__(self, model_path, voices_path, threads):
        self.manifest = json.loads((model_path / "runtime_manifest.json").read_text())
    def _sample_semantic(self, value):
        return value
    def iter_codes(self, text, **kwargs):
        if "空句" in text:
            self._sample_semantic(self.manifest["im_end_id"])
            return
        yield np.ones(10, dtype=np.int64)
        if "预算" not in text:
            self._sample_semantic(self.manifest["im_end_id"])
    def decode_codes(self, codes):
        return np.ones(4410, dtype=np.float32) * 0.2
`,
        );
        const bridge = join(fixture, "bridge.py");
        await writeFile(
          join(fixture, "fixture.json"),
          JSON.stringify({
            python: join(actual, "venv", "bin", "python"),
            codePath: fakeCode,
          }),
        );
        await writeFile(
          bridge,
          `
import json, os, sys
from pathlib import Path
fixture = json.loads((Path(__file__).parent / "fixture.json").read_text())
request = Path(sys.argv[-1])
data = json.loads(request.read_text())
data["codePath"] = fixture["codePath"]
request.write_text(json.dumps(data))
os.execv(fixture["python"], [fixture["python"], "-I", sys.argv[-2], str(request)])
`,
        );
        const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
        const python = join(dir, "venv", "bin", "python");
        await writeFile(
          python,
          `#!/bin/sh\nexec ${quote(join(actual, "venv", "bin", "python"))} -I ${quote(bridge)} "$@"\n`,
        );
        await chmod(python, 0o700);
        const api = createAudio8TtsProvider({ runtimeDir: fixture });
        assert.strictEqual((await api.status()).available, true);
        for (const [text, message] of [
          ["完整第一句。预算耗尽。", "未完整结束"],
          ["完整第一句。空句。", "未生成有效人声"],
        ]) {
          const job = context();
          await assert.rejects(
            api.generate(
              { ...input, text, referencePath: referencePath!, referenceText: referenceText! },
              job,
            ),
            (error: any) => error.message.includes(message),
          );
          assert.deepStrictEqual(await readdir(job.workDir), []);
          assert.deepStrictEqual(await readdir(job.outputDir), []);
        }
        const job = context();
        const result = await api.generate(
          {
            ...input,
            text: "完整句子。",
            referencePath: referencePath!,
            referenceText: referenceText!,
          },
          job,
        );
        assert.ok(Math.abs(result.durationSeconds - 0.1) < 10 ** -2);
        assert.strictEqual((await readdir(job.outputDir)).length, 1);
      },
    );
  },
);
