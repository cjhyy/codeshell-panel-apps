import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import {
  mkdtemp,
  mkdir,
  copyFile,
  readFile,
  writeFile,
  readdir,
  rm,
  symlink,
  realpath,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { build } from "esbuild";
import { PNG } from "pngjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const scope = "c".repeat(64);
let temp, api, cli, runtimeDir, runtimeSource, runtimeSha, tone, prores;
const ff = (args) => {
  const r = spawnSync("ffmpeg", ["-nostdin", "-v", "error", ...args], {
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(r.status, 0, r.stderr?.toString() || String(r.error));
  return r.stdout;
};
before(async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), "editor-task-runtime-")));
  runtimeDir = join(temp, "appdata");
  await mkdir(runtimeDir);
  await mkdir(join(temp, "tools"));
  runtimeSource = (
    await build({
      entryPoints: [join(root, "apps/video-studio/src/editor/render-entry.ts")],
      bundle: true,
      platform: "browser",
      format: "iife",
      target: "es2022",
      write: false,
    })
  ).outputFiles[0].text;
  runtimeSha = sha(runtimeSource);
  cli = join(temp, "tools", "editor-runtime.mjs");
  await build({
    entryPoints: [join(root, "apps/video-studio/native/editor-runtime.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    },
    outfile: cli,
    plugins: [
      {
        name: "sealed-browser",
        setup(build) {
          build.onResolve({ filter: /^panel-browser:editor-renderer$/ }, () => ({
            path: "editor-renderer",
            namespace: "static",
          }));
          build.onLoad({ filter: /.*/, namespace: "static" }, () => ({
            contents: `export const source=${JSON.stringify(runtimeSource)};export const sha256=${JSON.stringify(runtimeSha)};`,
          }));
        },
      },
    ],
  });
  const bundle = join(temp, "api.mjs");
  await build({
    stdin: {
      resolveDir: root,
      contents: `export * from './apps/video-studio/src/editor/defaults.ts';export * from './apps/video-studio/src/editor/time.ts';export * from './apps/video-studio/src/editor/task-bridge.ts';export * from './apps/video-studio/src/editor/export-settings.ts';export * from './apps/video-studio/native/editor-runtime/runtime.ts';export * from './apps/video-studio/native/editor-runtime/proxy.ts';export * from './apps/video-studio/native/media/editor-frame-renderer.ts';`,
    },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    },
    outfile: bundle,
  });
  api = await import(pathToFileURL(bundle).href);
  await copyFile(
    join(root, "apps/video-studio/public/demo-narration.mp3"),
    join(temp, "demo-narration.mp3"),
  );
  tone = join(temp, "tone.wav");
  ff(["-f", "lavfi", "-i", "aevalsrc=0.2*sin(2*PI*440*t):s=48000:d=2", "-c:a", "pcm_f32le", tone]);
  prores = join(temp, "test-prores.mov");
  ff([
    "-f",
    "lavfi",
    "-i",
    "color=red:s=64x48:r=30000/1001:d=0.5",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=64x48:r=30000/1001:d=0.5",
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1:a=0[v]",
    "-map",
    "[v]",
    "-c:v",
    "prores_ks",
    "-profile:v",
    "3",
    "-pix_fmt",
    "yuv422p10le",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-colorspace",
    "bt709",
    prores,
  ]);
});
after(async () => {
  if (temp) await rm(temp, { recursive: true, force: true });
});
function document() {
  return {
    schemaVersion: 2,
    timebase: 240000,
    id: "doc",
    name: "CLI",
    revision: 0,
    assets: [
      { id: "demo-intro", name: "Demo", kind: "demo", duration: 240000, width: 64, height: 48 },
    ],
    activeSequenceId: "main",
    exportProfiles: [],
    sequences: [
      {
        id: "main",
        name: "Main",
        width: 64,
        height: 48,
        frameRate: { numerator: 30, denominator: 1 },
        background: "#000000",
        timelineMode: "free",
        tracks: [api.createTrack("video", "video"), api.createTrack("audio", "audio")],
        clips: [],
        transitions: [],
        markers: [],
      },
    ],
  };
}
function clip(assetId = "demo-intro", trackId = "video", duration = 120000) {
  return {
    id: `clip-${assetId}`,
    label: "Clip",
    kind: "media",
    assetId,
    trackId,
    start: 0,
    duration,
    timeMap: api.constantTimeMap(0, duration).timeMap,
    audio: api.defaultAudioMix(),
    transform: api.defaultTransform(),
    color: api.defaultColorAdjustment(),
    blendMode: "normal",
  };
}
const profile = () => ({
  ...api.createExportPresets()[0],
  width: 64,
  height: 48,
  frameRate: { numerator: 30, denominator: 1 },
});
async function call(request, inputs = [], extra = {}) {
  const jobDir = await mkdtemp(join(temp, "job-"));
  await mkdir(join(jobDir, "inputs"));
  for (let i = 0; i < inputs.length; i++)
    await copyFile(inputs[i], join(jobDir, "inputs", `resource-${i}.bin`));
  const child = spawn(process.execPath, [cli, "--job-dir", jobDir, "--runtime-dir", runtimeDir], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(JSON.stringify({ ...request, scopeKey: scope, jobId: `job-${randomUUID()}` }));
  const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  clearTimeout(timer);
  const messages = stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      assert.ok(Buffer.byteLength(line) < 256 * 1024);
      return JSON.parse(line);
    });
  if (!extra.fail) assert.equal(code, 0, JSON.stringify(messages) + stderr);
  const response = messages.find((item) => item.type === "result")?.result;
  if (response)
    for (const artifact of response.artifacts) {
      assert.ok(!artifact.file.includes(".."));
      const bytes = await readFile(join(jobDir, artifact.file));
      assert.equal(sha(bytes), artifact.sha256);
      assert.equal(bytes.length, artifact.bytes);
      assert.equal(artifact.assetId, `asset-${sha(bytes)}`);
    }
  return {
    code,
    jobDir,
    messages,
    response,
    result: response?.result,
    error: messages.find((item) => item.type === "error"),
  };
}
async function stage(d, paths = new Map()) {
  const selected = api.editorTaskDocument(d, "main"),
    bytes = Buffer.from(JSON.stringify(selected.document)),
    documentHash = sha(bytes),
    transferId = `editor-${randomUUID()}`;
  if (selected.resourceIds.length)
    await call(
      { action: "stage-resources", transferId, resourceIds: selected.resourceIds },
      selected.resourceIds.map((id) => paths.get(id)),
    );
  const chunkCount = Math.ceil(bytes.length / (512 * 1024));
  for (let i = 0; i < chunkCount; i++)
    await call({
      action: "stage-document",
      transferId,
      documentHash,
      chunkIndex: i,
      chunkCount,
      dataBase64: bytes.subarray(i * 512 * 1024, (i + 1) * 512 * 1024).toString("base64"),
    });
  await call({
    action: "commit",
    transferId,
    documentHash,
    sequenceId: "main",
    chunkCount,
    byteLength: bytes.length,
  });
  return { transferId, documentHash, sequenceId: "main" };
}
const artifactPath = (result, role) =>
  join(result.jobDir, result.response.artifacts.find((a) => a.role === role).file);
test(
  "installed CLI stages, mixes 48k audio, renders verified video and reuses the exact prepared mix",
  { timeout: 120000 },
  async () => {
    const d = document();
    d.sequences[0].clips.push(clip());
    const resourceId = `asset-${sha(await readFile(tone))}`;
    d.assets.push({ id: "tone", name: "Tone", kind: "audio", duration: 480000, resourceId });
    d.sequences[0].clips.push(clip("tone", "audio"));
    const snapshot = await stage(d, new Map([[resourceId, tone]]));
    const prepared = await call({ action: "prepare-audio", ...snapshot });
    assert.equal(prepared.result.sampleCount, 24000);
    assert.equal(prepared.result.audio.mimeType, "audio/wav");
    const pcm = ff([
      "-i",
      artifactPath(prepared, "editor-preview-audio"),
      "-f",
      "f32le",
      "-c:a",
      "pcm_f32le",
      "pipe:1",
    ]);
    let crossing = 0;
    for (let i = 1001; i < 23000; i++)
      if (pcm.readFloatLE((i - 1) * 8) <= 0 && pcm.readFloatLE(i * 8) > 0) crossing++;
    assert.ok(Math.abs(crossing / (22000 / 48000) - 440) < 4);
    const rendered = await call({
      action: "render",
      ...snapshot,
      profile: profile(),
      preparedAudio: prepared.result.preparedAudio,
    });
    assert.equal(rendered.result.verified, true);
    assert.equal(rendered.result.reusedAudio, true);
    assert.equal(rendered.result.audio.id, prepared.result.audio.id);
    assert.equal(rendered.result.frameCount, 15);
    const probe = spawnSync("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-of",
      "json",
      artifactPath(rendered, "editor-video"),
    ]);
    const streams = JSON.parse(probe.stdout).streams;
    assert.equal(streams.find((s) => s.codec_type === "video").codec_name, "h264");
    assert.equal(streams.find((s) => s.codec_type === "audio").sample_rate, "48000");
    assert.ok(rendered.messages.some((m) => m.type === "progress"));
    assert.equal(JSON.stringify(rendered.response).includes(temp), false);
    assert.ok(!(await readdir(rendered.jobDir)).some((name) => name.startsWith("work-")));
    const mismatch = await call(
      {
        action: "render",
        ...snapshot,
        profile: profile(),
        preparedAudio: { ...prepared.result.preparedAudio, recipeHash: "a".repeat(64) },
      },
      [],
      { fail: true },
    );
    assert.equal(mismatch.error.code, "MIX_MISMATCH");
    assert.equal((await readdir(mismatch.jobDir)).includes("outputs"), false);
  },
);
test(
  "installed built-in narration is hash checked and genuinely audible without Host materialization",
  { timeout: 60000 },
  async () => {
    const d = document();
    d.assets = [
      {
        id: "demo-narration-v1",
        name: "示例旁白 · 从想法，到成片。",
        kind: "audio",
        duration: 24 * 240000,
        metadata: { mimeType: "audio/mpeg" },
      },
    ];
    d.sequences[0].clips = [clip("demo-narration-v1", "audio", 240000)];
    const snapshot = await stage(d);
    const prepared = await call({ action: "prepare-audio", ...snapshot });
    assert.equal(prepared.result.sampleCount, 48000);
    assert.ok(prepared.result.peak > 0.01);
  },
);
test(
  "fast SDR preview retains NTSC timestamps and is frame-seekable in the shared Chromium renderer",
  { timeout: 120000 },
  async (t) => {
    const d = document(),
      resourceId = `asset-${sha(await readFile(prores))}`;
    d.assets = [
      {
        id: "source",
        name: "ProRes",
        kind: "video",
        duration: 240000,
        width: 64,
        height: 48,
        resourceId,
      },
    ];
    d.sequences[0].clips = [clip("source", "video", 240000)];
    const snapshot = await stage(d, new Map([[resourceId, prores]]));
    const prepared = await call({ action: "prepare-video", ...snapshot, assetIds: ["source"] });
    const source = prepared.result.sources[0];
    assert.equal(source.recipe.color.sourceBitDepth, 10);
    assert.equal(source.recipe.frameCount, 30);
    assert.equal(source.recipe.width, 64);
    assert.equal(source.recipe.height, 48);
    const path = artifactPath(prepared, "editor-video-source"),
      workDir = await mkdtemp(join(temp, "frames-"));
    const previewStream = JSON.parse(
      spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_streams", "-of", "json", path]).stdout,
    ).streams[0];
    assert.equal(previewStream.codec_name, "h264");
    assert.equal(previewStream.pix_fmt, "yuv420p");
    const renderer = await api.EditorFrameRenderer.create({
      document: d,
      sequenceId: "main",
      profile: profile(),
      mediaFiles: new Map([["source", { path, mimeType: "video/mp4" }]]),
      runtimeSource,
      workDir,
      signal: new AbortController().signal,
    });
    t.after(() => renderer.close());
    for (const [tick, channel] of [
      [0, 0],
      [180000, 2],
      [8008, 0],
    ]) {
      const png = PNG.sync.read(await renderer.render(tick)),
        offset = (24 * png.width + 32) * 4;
      assert.ok(
        png.data[offset + channel] > 200,
        `${tick}: ${[...png.data.subarray(offset, offset + 4)]}`,
      );
    }
    await renderer.close();
    const rendered = await call({ action: "render", ...snapshot, profile: profile() });
    assert.equal(rendered.result.verified, true);
  },
);
test("staging rejects changed material, invalid directories, unsupported JSON fields and corrupt documents", async () => {
  const transferId = `editor-${randomUUID()}`,
    bytes = Buffer.from("material"),
    path = join(temp, "material.bin");
  await writeFile(path, bytes);
  const wrong = await call(
    { action: "stage-resources", transferId, resourceIds: [`asset-${"a".repeat(64)}`] },
    [path],
    { fail: true },
  );
  assert.equal(wrong.error.code, "SOURCE_CHANGED");
  const bad = await call(
    {
      action: "stage-status",
      transferId,
      documentHash: "a".repeat(64),
      resourceIds: [],
      ffmpegPath: "/tmp/code",
    },
    [],
    { fail: true },
  );
  assert.equal(bad.error.code, "INVALID_REQUEST");
  const noArgs = spawnSync(process.execPath, [cli], { input: "{}", encoding: "utf8" });
  assert.equal(noArgs.status, 1);
  assert.equal(JSON.parse(noArgs.stdout.trim()).code, "INVALID_DIRECTORY");
  const d = document();
  d.sequences[0].clips = [clip()];
  const snapshot = await stage(d);
  const manifest = join(
    runtimeDir,
    "scopes",
    scope,
    "transfers",
    snapshot.transferId,
    "manifest.json",
  );
  const value = JSON.parse(await readFile(manifest));
  value.document.name = "Changed";
  await writeFile(manifest, JSON.stringify(value));
  const changed = await call({ action: "prepare-audio", ...snapshot }, [], { fail: true });
  assert.equal(changed.error.code, "SNAPSHOT_MISMATCH");
  const discarded = await call({ action: "discard", ...snapshot });
  assert.equal(discarded.result.discarded, true);
  const status = await call(
    {
      action: "stage-status",
      transferId: snapshot.transferId,
      documentHash: snapshot.documentHash,
      resourceIds: [],
    },
    [],
    { fail: true },
  );
  assert.equal(status.error.code, "TRANSFER_DISCARDED");
});
test("native staging rejects symbolic material paths", async () => {
  const jobDir = await mkdtemp(join(temp, "symlink-job-"));
  await mkdir(join(jobDir, "inputs"));
  await symlink(tone, join(jobDir, "inputs", "resource-0.bin"));
  await assert.rejects(
    api.runEditorRequest(
      {
        action: "stage-resources",
        transferId: `editor-${randomUUID()}`,
        resourceIds: [`asset-${sha(await readFile(tone))}`],
      },
      {
        jobDir,
        runtimeDir,
        scopeKey: scope,
        jobId: "test",
        signal: new AbortController().signal,
        runtimeSource,
        runtimeSha,
        reportProgress() {},
      },
    ),
    /符号链接/,
  );
});
test(
  "compatible proxies retain VFR frames, display rotation and non-square pixel geometry",
  { timeout: 60000 },
  async () => {
    const vfr = join(temp, "vfr.mp4"),
      rotated = join(temp, "rotated.mp4");
    ff([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=32x24:r=30:d=1",
      "-vf",
      "select='not(eq(mod(n,3),1))',setsar=2/1",
      "-fps_mode",
      "passthrough",
      "-c:v",
      "libx264",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-colorspace",
      "bt709",
      vfr,
    ]);
    ff(["-display_rotation:v:0", "90", "-i", vfr, "-c", "copy", rotated]);
    const cacheDir = await mkdtemp(join(temp, "proxy-cache-")),
      workDir = await mkdtemp(join(temp, "proxy-work-"));
    const context = {
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      cacheDir,
      workDir,
      ffmpegVersion: "test-fixture",
      signal: new AbortController().signal,
    };
    const proxy = await api.prepareEditorProxy(rotated, sha(await readFile(rotated)), context);
    assert.equal(proxy.width, 24);
    assert.equal(proxy.height, 64);
    assert.equal(proxy.frameCount, 20);
    const meta = JSON.parse(
      spawnSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", proxy.path]).stdout,
    ).streams[0];
    assert.equal(meta.codec_name, "vp9");
    assert.equal(meta.sample_aspect_ratio, "1:1");
    assert.equal(meta.width, 24);
    assert.equal(meta.height, 64);
    assert.ok(!meta.side_data_list?.some((item) => item.rotation));
    const d = document(),
      resourceId = `asset-${sha(await readFile(rotated))}`;
    d.assets = [
      {
        id: "source",
        name: "Rotated",
        kind: "video",
        duration: 240000,
        width: 32,
        height: 24,
        resourceId,
      },
    ];
    d.sequences[0].clips = [clip("source")];
    const snapshot = await stage(d, new Map([[resourceId, rotated]]));
    const bad = await call({ action: "render", ...snapshot, profile: profile() }, [], {
      fail: true,
    });
    assert.equal(bad.error.code, "SOURCE_GEOMETRY_MISMATCH");
  },
);
test(
  "HDR and alpha video fail explicitly instead of silently changing picture meaning",
  { timeout: 60000 },
  async () => {
    const hdr = join(temp, "hdr.mp4"),
      alpha = join(temp, "alpha.mov");
    ff([
      "-f",
      "lavfi",
      "-i",
      "color=white:s=32x32:r=30:d=0.1",
      "-c:v",
      "libx264",
      "-color_primaries",
      "bt2020",
      "-color_trc",
      "smpte2084",
      "-colorspace",
      "bt2020nc",
      hdr,
    ]);
    ff([
      "-f",
      "lavfi",
      "-i",
      "color=red@0.5:s=32x32:r=30:d=0.1,format=argb",
      "-c:v",
      "qtrle",
      alpha,
    ]);
    const context = {
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      cacheDir: await mkdtemp(join(temp, "unsupported-cache-")),
      workDir: await mkdtemp(join(temp, "unsupported-work-")),
      ffmpegVersion: "test-fixture",
      signal: new AbortController().signal,
    };
    await assert.rejects(api.prepareEditorProxy(hdr, sha(await readFile(hdr)), context), {
      code: "UNSUPPORTED_HDR",
    });
    await assert.rejects(api.prepareEditorProxy(alpha, sha(await readFile(alpha)), context), {
      code: "UNSUPPORTED_ALPHA_VIDEO",
    });
  },
);
test(
  "SIGTERM cancels the real renderer, removes unpublished files and retains resumable staging",
  { timeout: 60000 },
  async () => {
    const d = document();
    d.assets[0].duration = 6 * 240000;
    d.sequences[0].clips = [clip("demo-intro", "video", 6 * 240000)];
    const snapshot = await stage(d);
    const jobDir = await mkdtemp(join(temp, "cancel-job-")),
      child = spawn(process.execPath, [cli, "--job-dir", jobDir, "--runtime-dir", runtimeDir], {
        stdio: ["pipe", "pipe", "pipe"],
      });
    let stdout = "",
      sent = false;
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (!sent && stdout.includes('"stage":"render-video"')) {
        sent = true;
        child.kill("SIGTERM");
      }
    });
    child.stdin.end(
      JSON.stringify({
        action: "render",
        ...snapshot,
        profile: profile(),
        scopeKey: scope,
        jobId: "cancel-test",
      }),
    );
    const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
    const code = await new Promise((resolve, reject) => {
      child.once("exit", resolve);
      child.once("error", reject);
    });
    clearTimeout(timer);
    assert.equal(sent, true);
    assert.equal(code, 1, stdout);
    const messages = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(messages.at(-1).code, "CANCELLED");
    assert.equal(
      messages.some((m) => m.type === "result"),
      false,
    );
    assert.deepEqual(await readdir(jobDir), []);
    const status = await call({
      action: "stage-status",
      transferId: snapshot.transferId,
      documentHash: snapshot.documentHash,
      resourceIds: [],
    });
    assert.equal(status.result.committedDocumentHash, snapshot.documentHash);
    assert.deepEqual(status.result.chunks, [0]);
  },
);
test(
  "inspect-source publishes exact source ticks for NTSC ProRes, short WAV and static images",
  { timeout: 60000 },
  async () => {
    const ntsc = join(temp, "seven-frames.mov"),
      short = join(temp, "1001-samples.wav"),
      png = join(temp, "static.png");
    ff([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=64x48:r=30000/1001",
      "-frames:v",
      "7",
      "-c:v",
      "prores_ks",
      "-pix_fmt",
      "yuv422p10le",
      ntsc,
    ]);
    ff([
      "-f",
      "lavfi",
      "-i",
      "sine=f=440:r=48000",
      "-af",
      "atrim=end_sample=1001",
      "-c:a",
      "pcm_f32le",
      short,
    ]);
    const pixels = new PNG({ width: 17, height: 13 });
    pixels.data.fill(255);
    await writeFile(png, PNG.sync.write(pixels));
    for (const [path, kind, duration] of [
      [ntsc, "video", 7 * 8008],
      [short, "audio", 1001 * 5],
      [png, "image", 0],
    ]) {
      const resourceId = `asset-${sha(await readFile(path))}`;
      const inspected = await call(
        {
          action: "inspect-source",
          transferId: `editor-${randomUUID()}`,
          resourceIds: [resourceId],
        },
        [path],
      );
      assert.equal(inspected.result.kind, kind);
      assert.equal(inspected.result.duration, duration, JSON.stringify(inspected.result));
      assert.equal(inspected.result.sha256, resourceId.slice(6));
      assert.equal(inspected.result.bytes, (await readFile(path)).length);
      assert.equal(inspected.response.artifacts.length, 0);
      assert.equal(inspected.result.inspection.timing.tickRounding, "nearest");
      if (kind === "video") {
        assert.deepEqual(inspected.result.inspection.video.frameRate, {
          numerator: 30000,
          denominator: 1001,
        });
        assert.equal(inspected.result.inspection.video.frameCount, 7);
        assert.equal(inspected.result.inspection.compatibility.preview, "native-proxy");
      }
      if (kind === "image") {
        assert.equal(inspected.result.width, 17);
        assert.equal(inspected.result.height, 13);
        assert.equal(inspected.result.inspection.compatibility.preview, "static-image");
      }
    }
  },
);
test(
  "inspect-source finds ffprobe outside the app PATH through the shared tool search",
  { timeout: 60000 },
  async () => {
    const real = spawnSync("sh", ["-c", "command -v ffprobe"]).stdout.toString().trim();
    assert.ok(real, "ffprobe must be installed for native inspection tests");
    const shims = join(temp, "tool-shims");
    await mkdir(shims, { recursive: true });
    await writeFile(join(shims, "ffprobe"), `#!/bin/sh\nexec "${real}" "$@"\n`, { mode: 0o755 });
    const jobDir = await mkdtemp(join(temp, "job-"));
    await mkdir(join(jobDir, "inputs"));
    await copyFile(tone, join(jobDir, "inputs", "resource-0.bin"));
    const saved = process.env.PATH;
    process.env.PATH = "/nonexistent-video-studio-bin";
    try {
      const response = await api.runEditorRequest(
        {
          action: "inspect-source",
          transferId: `editor-${randomUUID()}`,
          resourceIds: [`asset-${sha(await readFile(tone))}`],
        },
        {
          jobDir,
          runtimeDir,
          scopeKey: scope,
          jobId: `job-${randomUUID()}`,
          signal: new AbortController().signal,
          runtimeSource,
          runtimeSha,
          reportProgress() {},
          toolSearchDirectories: [shims],
        },
      );
      assert.equal(response.result.kind, "audio");
    } finally {
      process.env.PATH = saved;
    }
  },
);
test(
  "inspect-source accepts MKV and preserves real VFR and rotated display geometry",
  { timeout: 60000 },
  async () => {
    const mkv = join(temp, "inspect-vfr.mkv"),
      base = join(temp, "inspect-sar.mp4"),
      rotated = join(temp, "inspect-sar-rotated.mp4");
    ff([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=32x24:r=30:d=1",
      "-vf",
      "select='not(eq(mod(n,3),1))'",
      "-fps_mode",
      "passthrough",
      "-c:v",
      "libx264",
      mkv,
    ]);
    ff([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=32x24:r=30:d=0.2",
      "-vf",
      "setsar=2/1",
      "-c:v",
      "libx264",
      base,
    ]);
    ff(["-display_rotation:v:0", "90", "-i", base, "-c", "copy", rotated]);
    const inspect = async (path) => {
      const resourceId = `asset-${sha(await readFile(path))}`;
      return (
        await call(
          {
            action: "inspect-source",
            transferId: `editor-${randomUUID()}`,
            resourceIds: [resourceId],
          },
          [path],
        )
      ).result;
    };
    const variable = await inspect(mkv);
    assert.equal(variable.kind, "video");
    assert.equal(variable.inspection.video.variableFrameRate, true);
    assert.equal(variable.inspection.video.frameCount, 20);
    assert.equal(variable.inspection.timing.basis, "decoded-frames");
    assert.ok(variable.duration > 230000 && variable.duration <= 240000);
    const display = await inspect(rotated);
    assert.equal(display.width, 24);
    assert.equal(display.height, 64);
    assert.equal(Math.abs(display.inspection.video.rotation), 90);
    assert.deepEqual(display.inspection.video.sampleAspectRatio, {
      numerator: "2",
      denominator: "1",
    });
  },
);
test(
  "inspect-source retains unsupported HDR and alpha as readable compatibility limitations",
  { timeout: 60000 },
  async () => {
    const hdr = join(temp, "inspect-hdr.mp4"),
      alpha = join(temp, "inspect-alpha.mov");
    ff([
      "-f",
      "lavfi",
      "-i",
      "color=white:s=32x32:r=30:d=0.1",
      "-c:v",
      "libx264",
      "-color_primaries",
      "bt2020",
      "-color_trc",
      "smpte2084",
      "-colorspace",
      "bt2020nc",
      hdr,
    ]);
    ff([
      "-f",
      "lavfi",
      "-i",
      "color=red@0.5:s=32x32:r=30:d=0.1,format=argb",
      "-c:v",
      "qtrle",
      alpha,
    ]);
    for (const [path, code] of [
      [hdr, "UNSUPPORTED_HDR"],
      [alpha, "UNSUPPORTED_ALPHA_VIDEO"],
    ]) {
      const id = `asset-${sha(await readFile(path))}`;
      const result = (
        await call(
          { action: "inspect-source", transferId: `editor-${randomUUID()}`, resourceIds: [id] },
          [path],
        )
      ).result;
      assert.equal(result.kind, "video");
      assert.equal(result.inspection.compatibility.preview, "unsupported");
      assert.equal(result.inspection.compatibility.export, "unsupported");
      assert.ok(
        result.inspection.compatibility.limitations.some(
          (item) => item.code === code && item.message.length > 5,
        ),
      );
    }
  },
);
test("source inspection cannot alter a staged snapshot and rejects undecodable bytes", async () => {
  const d = document();
  d.sequences[0].clips = [clip()];
  const snapshot = await stage(d);
  const id = `asset-${sha(await readFile(tone))}`;
  await call({ action: "inspect-source", transferId: snapshot.transferId, resourceIds: [id] }, [
    tone,
  ]);
  const status = await call({
    action: "stage-status",
    transferId: snapshot.transferId,
    documentHash: snapshot.documentHash,
    resourceIds: [],
  });
  assert.equal(status.result.committedDocumentHash, snapshot.documentHash);
  const invalid = join(temp, "invalid-media.bin");
  await writeFile(invalid, "Not media");
  const resourceId = `asset-${sha(await readFile(invalid))}`;
  const failed = await call(
    { action: "inspect-source", transferId: `editor-${randomUUID()}`, resourceIds: [resourceId] },
    [invalid],
    { fail: true },
  );
  assert.notEqual(failed.code, 0);
  assert.equal(failed.response, undefined);
});
test(
  "inspection respects AAC container padding and the installed MP3 gapless endpoint",
  { timeout: 60000 },
  async () => {
    const aac = join(temp, "short-aac.m4a");
    ff([
      "-f",
      "lavfi",
      "-i",
      "sine=f=440:r=48000",
      "-af",
      "atrim=end_sample=1001",
      "-c:a",
      "aac",
      aac,
    ]);
    const probe = JSON.parse(
      spawnSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", aac]).stdout,
    ).streams[0];
    const expected = Math.round(
      ((Number(probe.duration_ts) * Number(probe.time_base.split("/")[0])) /
        Number(probe.time_base.split("/")[1])) *
        240000,
    );
    const inspect = async (path) =>
      (
        await call(
          {
            action: "inspect-source",
            transferId: `editor-${randomUUID()}`,
            resourceIds: [`asset-${sha(await readFile(path))}`],
          },
          [path],
        )
      ).result;
    assert.equal((await inspect(aac)).duration, expected);
    assert.equal((await inspect(join(temp, "demo-narration.mp3"))).duration, 24 * 240000);
  },
);
