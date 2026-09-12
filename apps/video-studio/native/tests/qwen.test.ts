import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQwenTtsProvider, validateQwenTtsInput } from "../providers/qwen.js";
import { runMediaProcess } from "../process-runner.js";
import type { MediaJobContext } from "../contracts.js";
let root = "";
let serial = 0;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "codeshell-qwen-"));
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
test("clone input bounds Unicode text and reference transcripts without accepting runtime overrides", () => {
  assert.deepStrictEqual(
    validateQwenTtsInput({
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
    assert.throws(() => validateQwenTtsInput({ ...input, ...update }));
  assert.strictEqual(validateQwenTtsInput({ ...input, text: "字".repeat(2000) }).text.length, 2000);
  assert.throws(
    () => createQwenTtsProvider({ runtimeDir: "relative" }),
    (error: any) => error.message.includes("absolute"),
  );
});
test("status and pre-cancelled setup are offline reads and do not create an environment", async () => {
  const runtimeDir = join(root, "untouched");
  const api = createQwenTtsProvider({ runtimeDir, uvPath: "/no-such-installer" });
  const status = await api.status();
  assert.strictEqual(status.id, "qwen3-tts");
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
      const api = createQwenTtsProvider({ runtimeDir, ffmpegPath: "/missing-ffmpeg" });
      for (let attempt = 0; attempt < 2; attempt++) {
        await assert.rejects(api.setup(context()), (error: any) =>
          error.message.includes("准备失败"),
        );
        assert.strictEqual((await api.status()).state, "failed");
        assert.strictEqual((await api.status()).available, false);
        await assert.rejects(readFile(join(runtimeDir, "qwen3-tts", "runtime.json")));
        await assert.rejects(readFile(join(runtimeDir, "qwen3-tts", "setup.lock")));
      }
    });
    test("an initializing or live setup lock is never removed by a competing host", async () => {
      const runtimeDir = join(root, "locked");
      const dir = join(runtimeDir, "qwen3-tts");
      await mkdir(dir, { recursive: true });
      const lockPath = join(dir, "setup.lock");
      const api = createQwenTtsProvider({ runtimeDir });
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
    test(
      "cancelled installation removes requests, prevents concurrent setup, and strips injected package settings",
      { timeout: 10000 },
      async () => {
        const runtimeDir = join(root, "cancel-install");
        const installer = join(root, "uv-fixture");
        const started = join(root, "installer-started");
        await writeFile(
          installer,
          `#!/bin/sh\nprintf '%s' "$UV_EXTRA_INDEX_URL|$PIP_EXTRA_INDEX_URL|$PYTHONPATH|$HF_TOKEN|$HF_HOME" > '${started}'\nexec /bin/sleep 30\n`,
        );
        await chmod(installer, 0o700);
        const api = createQwenTtsProvider({ runtimeDir, uvPath: installer });
        const other = createQwenTtsProvider({ runtimeDir, uvPath: installer });
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
            `||||${join(runtimeDir, "qwen3-tts", "hub-cache")}`,
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
          await assert.rejects(readFile(join(runtimeDir, "qwen3-tts", "setup.lock")));
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
const runtimeDir = process.env.VIDEO_STUDIO_TEST_QWEN_RUNTIME;
const referencePath = process.env.VIDEO_STUDIO_TEST_QWEN_REFERENCE;
const referenceText = process.env.VIDEO_STUDIO_TEST_QWEN_TRANSCRIPT;
describe(
  "real offline Qwen inference",
  { skip: !runtimeDir || !referencePath || !referenceText },
  () => {
    test(
      "Chinese sentences produce audible 48 kHz mono PCM and a complete, private job",
      { timeout: 120000 },
      async () => {
        const api = createQwenTtsProvider({ runtimeDir: runtimeDir! });
        assert.strictEqual((await api.status()).available, true);
        const job = context();
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
        console.info(
          `Qwen offline: ${result.durationSeconds.toFixed(3)}s, 48 kHz mono PCM, temporary input removed`,
        );
      },
    );
    test(
      "reference duration and silence fail before inference; active cancellation leaves no speech",
      { timeout: 30000 },
      async () => {
        const api = createQwenTtsProvider({ runtimeDir: runtimeDir! });
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
        const api = createQwenTtsProvider({ runtimeDir: runtimeDir! });
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
  },
);
