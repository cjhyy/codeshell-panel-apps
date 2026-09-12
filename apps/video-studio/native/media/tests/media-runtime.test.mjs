import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  copyFile,
  symlink,
  writeFile,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
const project = resolve(import.meta.dirname, "../../../../..");
let root, api, cli, source, sourceId;
const scopeKey = "a".repeat(64);
const ffmpegAvailable = ["ffmpeg", "ffprobe"].every(
  (name) => spawnSync(name, ["-version"], { stdio: "ignore" }).status === 0,
);
const mediaTest = ffmpegAvailable ? test : test.skip;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "video-native-media-"));
  const bundle = join(root, "runtime.mjs");
  cli = join(root, "cli.mjs");
  const common = { bundle: true, platform: "node", format: "esm", target: "node20" };
  await build({
    ...common,
    entryPoints: [join(project, "apps/video-studio/native/media/media-cli.ts")],
    outfile: bundle,
  });
  await build({
    ...common,
    entryPoints: [join(project, "apps/video-studio/native/media/cli.ts")],
    outfile: cli,
  });
  api = await import(pathToFileURL(bundle).href);
  if (ffmpegAvailable) {
    source = join(root, "source.mp4");
    const run = spawnSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=320x180:r=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "4",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      source,
    ]);
    assert.equal(run.status, 0, run.stderr.toString());
    sourceId = `asset-${createHash("sha256")
      .update(await readFile(source))
      .digest("hex")}`;
  }
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});
async function context(name, withSource = true) {
  const jobDir = join(root, name);
  await mkdir(join(jobDir, "inputs"), { recursive: true });
  if (withSource && source) await copyFile(source, join(jobDir, "inputs/source.mp4"));
  return {
    jobDir,
    runtimeDir: join(root, "runtime/media"),
    scopeKey,
    jobId: name,
    signal: new AbortController().signal,
    reportProgress: async () => {},
  };
}
function input(action, params = {}) {
  return { action, params, inputs: { [sourceId]: "inputs/source.mp4" } };
}
async function assertArtifacts(response, ctx) {
  const publicJson = JSON.stringify(response);
  assert.equal(publicJson.includes(root), false, "public result must not expose local paths");
  for (const artifact of response.artifacts) {
    assert.match(artifact.file, /^outputs\/[a-f0-9]{64}\.[a-z0-9]+$/);
    const bytes = await readFile(join(ctx.jobDir, artifact.file));
    assert.equal(artifact.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(artifact.assetId, `asset-${artifact.sha256}`);
    assert.equal(artifact.bytes, bytes.length);
  }
}
test("request validation rejects absolute/traversal inputs and untrusted configuration", () => {
  for (const file of [
    "/private/input.wav",
    "../input.wav",
    "inputs/../secret.wav",
    "inputs\\secret.wav",
    "https://example.com/input.wav",
  ])
    assert.throws(() => api.validateMediaRequest({ action: "inspect", inputs: { source: file } }));
  assert.throws(() => api.validateMediaRequest({ action: "tts", connections: [] }));
  assert.throws(() =>
    api.validateMediaRequest({ action: "tts", publicConnections: { connections: [] } }),
  );
});
test("generic connection mapping preserves stable speech IDs and hides secret in public mode", () => {
  const c = {
    id: "configured",
    catalogId: "speech-provider",
    tag: "speech",
    adapterKind: "openai",
    model: "tts-1",
    baseUrl: "https://example.com/v1",
    apiKey: "test-secret-only",
    hasCredentials: true,
    entry: { tag: "speech", displayName: "Provider" },
    preset: {
      label: "Speech",
      params: [
        { name: "voice", control: "enum", options: ["alloy", "nova"], default: "nova" },
        { name: "speed", default: 1 },
      ],
    },
    paramValues: {},
  };
  const expected = `speech-${createHash("sha256")
    .update(JSON.stringify([c.id, c.catalogId, c.model, c.baseUrl]))
    .digest("hex")
    .slice(0, 32)}`;
  const mapped = api.resolveMediaConnections({ connections: [c], defaults: { speech: c.id } });
  assert.equal(mapped.defaultModelId, expected);
  assert.equal(mapped.connections[0].description.defaultVoiceId, "nova");
  const publicOnly = api.resolveMediaConnections({ connections: [c] }, { publicOnly: true });
  assert.equal(publicOnly.connections[0].apiKey, "");
  assert.equal(JSON.stringify(publicOnly).includes(c.apiKey), false);
  const { apiKey, baseUrl, ...publicEntry } = c;
  publicEntry.fingerprint = expected.slice(7);
  publicEntry.paramValues = { instructions: "must-not-leak" };
  const redacted = api.resolveMediaConnections(
    { connections: [publicEntry] },
    { publicOnly: true },
  );
  assert.equal(redacted.connections[0].description.id, expected);
  assert.equal(redacted.connections[0].baseUrl, "");
  assert.equal(JSON.stringify(redacted).includes("must-not-leak"), false);
  assert.equal(
    api.resolveMediaConnections({ connections: [publicEntry] }).connections.length,
    0,
    "public catalog cannot authorize execution",
  );
});
mediaTest(
  "real prepare produces proxy, thumbnail, waveform, silence and scene results",
  async () => {
    const ctx = await context("prepare");
    const response = await api.runMediaRequest(input("prepare", { assetId: sourceId }), ctx);
    assert.equal(response.result.inspection.kind, "video");
    assert.ok(response.result.waveform.peaks.some((p) => p > 0));
    assert.ok(response.result.proxy.asset.id);
    assert.ok(response.result.thumbnail.asset.id);
    assert.equal(response.result.silence.detector, "ffmpeg-silencedetect");
    await assertArtifacts(response, ctx);
  },
);
mediaTest(
  "real extraction retains selected duration and enhancement validates complete audio",
  async () => {
    const extract = await context("extract");
    const result = await api.runMediaRequest(
      input("audio-extract", { assetId: sourceId, inFrame: 0, outFrame: 90, fps: 30 }),
      extract,
    );
    assert.ok(Math.abs(result.result.inspection.durationSeconds - 3) < 0.03);
    await assertArtifacts(result, extract);
    const enhance = await context("enhance");
    const processed = await api.runMediaRequest(
      input("audio-enhance", {
        assetId: sourceId,
        preset: "light",
        denoise: true,
        normalize: true,
      }),
      enhance,
    );
    assert.ok(Math.abs(processed.result.inspection.durationSeconds - 4) < 0.1);
    await assertArtifacts(processed, enhance);
  },
);
mediaTest("real video render includes Unicode captions through independent Chromium", async (t) => {
  const ctx = await context("render");
  const project = {
    schemaVersion: 1,
    revision: 3,
    fps: 30,
    width: 320,
    height: 180,
    assets: [{ id: sourceId, kind: "video" }],
    clips: [{ id: "clip", assetId: sourceId, inFrame: 0, outFrame: 90, volume: 0.6 }],
    captions: [{ id: "caption", text: "你好，真实字幕。", startFrame: 0, endFrame: 75 }],
    captionStyle: "bold",
    audioClips: [],
  };
  let result;
  try {
    result = await api.runMediaRequest(input("render", { project }), ctx);
  } catch (error) {
    // These generated fixtures have no user media or connection credentials.
    // Retain bounded native causes only in the test runner's failure diagnostics.
    for (let cause = error.cause, depth = 0; cause && depth < 3; cause = cause.cause, depth++)
      t.diagnostic(String(cause.message ?? cause).slice(0, 12288));
    throw error;
  }
  assert.equal(result.result.frames, 90);
  assert.ok(result.result.inspection.audio);
  assert.equal(result.result.subtitleMode, "burn");
  await assertArtifacts(result, ctx);
  assert.equal((await readdir(ctx.jobDir)).includes("work"), false);
});
mediaTest(
  "changed content, symlinks and cancellation fail without publishing partial outputs",
  async () => {
    const ctx = await context("invalid");
    await assert.rejects(
      api.runMediaRequest(
        {
          action: "inspect",
          params: { assetId: `asset-${"b".repeat(64)}` },
          inputs: { [`asset-${"b".repeat(64)}`]: "inputs/source.mp4" },
        },
        ctx,
      ),
      /内容已变化/,
    );
    const linked = await context("linked", false);
    await symlink(source, join(linked.jobDir, "inputs/link.mp4"));
    await assert.rejects(
      api.runMediaRequest(
        {
          action: "inspect",
          params: { assetId: sourceId },
          inputs: { [sourceId]: "inputs/link.mp4" },
        },
        linked,
      ),
      /符号链接/,
    );
    const cancelled = await context("cancelled"),
      controller = new AbortController();
    cancelled.signal = controller.signal;
    cancelled.reportProgress = async () => controller.abort();
    await assert.rejects(api.runMediaRequest(input("proxy", { assetId: sourceId }), cancelled), {
      name: "AbortError",
    });
    assert.equal((await readdir(cancelled.jobDir)).includes("outputs"), false);
  },
);
mediaTest("standalone CLI accepts stdin and sealed directories without eval", async () => {
  const ctx = await context("standalone");
  await mkdir(ctx.runtimeDir, { recursive: true });
  const request = { ...input("inspect", { assetId: sourceId }), scopeKey, jobId: ctx.jobId };
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [cli, "--job-dir", ctx.jobDir, "--runtime-dir", ctx.runtimeDir],
      { cwd: ctx.jobDir, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(request));
  });
  assert.equal(result.code, 0, result.stderr + result.stdout);
  const events = result.stdout.trim().split("\n").map(JSON.parse);
  assert.equal(events.at(-1).type, "result");
  assert.equal(events.at(-1).result.result.inspection.kind, "video");
  assert.equal(result.stdout.includes(ctx.jobDir), false);
});
(process.platform === "darwin" && ffmpegAvailable ? test : test.skip)(
  "real macOS speech produces reusable complete WAV metadata",
  async () => {
    const ctx = await context("system-speech", false);
    const response = await api.runMediaRequest(
      {
        action: "tts",
        params: {
          modelId: "macos-say",
          voiceId: "Tingting",
          text: "你好，这是面板媒体工具测试。",
          rate: 1,
        },
      },
      ctx,
    );
    assert.equal(response.result.speech.engine, "macos-say");
    assert.ok(response.result.inspection.durationSeconds > 1);
    assert.equal(response.result.inspection.audio.sampleRate, 48000);
    await assertArtifacts(response, ctx);
  },
);
mediaTest(
  "online speech uses sealed configuration, verifies actual WAV and never exposes credentials",
  async () => {
    const wav = join(root, "online-test.wav");
    assert.equal(
      spawnSync("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=350:sample_rate=48000",
        "-t",
        "0.6",
        "-c:a",
        "pcm_s16le",
        wav,
      ]).status,
      0,
    );
    const bytes = await readFile(wav);
    let received;
    const server = createServer(async (req, res) => {
      const parts = [];
      for await (const part of req) parts.push(part);
      received = {
        authorization: req.headers.authorization,
        url: req.url,
        body: JSON.parse(Buffer.concat(parts).toString()),
      };
      res.setHeader("Content-Type", "application/octet-stream");
      res.end(bytes);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const ctx = await context("online", false),
        id = "speech-configured";
      ctx.connections = [
        {
          description: {
            id,
            name: "Configured",
            provider: "Example",
            available: true,
            voices: [{ id: "alloy", name: "Alloy", language: "en" }],
            defaultVoiceId: "alloy",
            maxTextLength: 4096,
            supportsInstructions: false,
          },
          connectionId: "connection",
          model: "tts-1",
          baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
          apiKey: "test-credential",
          defaultRate: 1,
        },
      ];
      const response = await api.runMediaRequest(
        { action: "tts", params: { modelId: id, text: "Native media test." } },
        ctx,
      );
      assert.equal(received.authorization, "Bearer test-credential");
      assert.equal(received.url, "/v1/audio/speech");
      assert.equal(received.body.model, "tts-1");
      assert.equal(JSON.stringify(response).includes("test-credential"), false);
      await assertArtifacts(response, ctx);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
