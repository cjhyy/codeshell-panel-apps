import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { build } from "esbuild";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
const root = fileURLToPath(new URL("../", import.meta.url));
let api, dir, input, cache, pcm;
const hash = (data) => createHash("sha256").update(data).digest("hex");
const ff = (args) => {
  const r = spawnSync("ffmpeg", ["-nostdin", "-v", "error", ...args], {
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(r.status, 0, r.stderr.toString());
  return r.stdout;
};
before(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "editor-waveform-")));
  cache = join(dir, "cache");
  pcm = join(dir, "pcm");
  await mkdir(cache);
  await mkdir(pcm);
  await build({
    stdin: {
      resolveDir: root,
      contents: `export * from './apps/video-studio/native/editor-runtime/waveform.ts';export * from './apps/video-studio/src/editor/waveform.ts';export * from './apps/video-studio/native/editor-runtime/runtime.ts';export * from './apps/video-studio/native/media/editor-audio-renderer.ts';export * from './apps/video-studio/src/editor/defaults.ts';export * from './apps/video-studio/src/editor/task-bridge.ts';`,
    },
    bundle: true,
    platform: "node",
    banner: {
      js: 'import { createRequire as __panelCreateRequire } from "node:module"; const require = __panelCreateRequire(import.meta.url);',
    },
    format: "esm",
    outfile: join(dir, "api.mjs"),
  });
  api = await import(pathToFileURL(join(dir, "api.mjs")));
  await build({
    stdin: {
      resolveDir: root,
      contents: `import {runEditorCli} from './apps/video-studio/native/editor-runtime/cli.ts';await runEditorCli({runtimeSource:'',runtimeSha:'${"0".repeat(64)}'});`,
    },
    bundle: true,
    platform: "node",
    banner: {
      js: 'import { createRequire as __panelCreateRequire } from "node:module"; const require = __panelCreateRequire(import.meta.url);',
    },
    format: "esm",
    outfile: join(dir, "cli.mjs"),
  });
  input = join(dir, "stereo.wav");
  ff([
    "-f",
    "lavfi",
    "-i",
    String.raw`aevalsrc=if(lt(t\,1)\,0\,0.5*sin(2*PI*1000*t))|-if(lt(t\,1)\,0\,0.5*sin(2*PI*1000*t)):s=48000:d=2`,
    "-c:a",
    "pcm_f32le",
    input,
  ]);
});
after(async () => rm(dir, { recursive: true, force: true }));
const options = () => ({
  input,
  cacheDir: cache,
  pcmCacheDir: pcm,
  sourceDuration: 480000,
  ffmpegPath: "ffmpeg",
  ffprobePath: "ffprobe",
  signal: new AbortController().signal,
});
test("real stereo PCM envelope preserves antiphase peaks, silence and RMS; cached repeat does not decode", async () => {
  const result = await api.analyzeEditorWaveform(options());
  assert.equal(result.reused, false);
  const stored = JSON.parse(await readFile(result.path, "utf8")),
    wave = api.decodeEditorWaveform(stored);
  assert.equal(wave.sampleCount, 96000);
  assert.equal(wave.data.length, 300);
  assert.deepEqual(api.waveformEnvelope(wave, 0, 240000), { min: 0, max: 0, rms: 0 });
  const envelope = api.waveformEnvelope(wave, 240000, 480000);
  assert.ok(Math.abs(envelope.max - 0.5) < 0.001);
  assert.ok(Math.abs(envelope.min + 0.5) < 0.001);
  assert.ok(Math.abs(envelope.rms - Math.SQRT1_2 * 0.5) < 0.001);
  assert.deepEqual(api.waveformEnvelope(wave, 480000, 240000), envelope);
  assert.deepEqual(api.waveformEnvelope(wave, 300000, 300000), { min: 0, max: 0, rms: 0 });
  const cached = await api.analyzeEditorWaveform({
    ...options(),
    ffprobePath: "/definitely/not-installed",
  });
  assert.equal(cached.reused, true);
  assert.equal(cached.path, result.path);
});
test("native analysis reuses complete existing export source PCM and rejects corrupt waveform cache", async () => {
  const local = join(dir, "second-cache");
  await mkdir(local);
  const version = spawnSync("ffmpeg", ["-hide_banner", "-version"]).stdout.toString();
  const sourceHash = hash(await readFile(input));
  const key = api.editorSourcePcmCacheKey(sourceHash, 480000, version);
  ff([
    "-i",
    input,
    "-ac",
    "2",
    "-ar",
    "48000",
    "-c:a",
    "pcm_f32le",
    "-f",
    "f32le",
    join(pcm, `${key}.f32`),
  ]);
  const result = await api.analyzeEditorWaveform({ ...options(), cacheDir: local });
  assert.equal(result.reusedPcm, true);
  await writeFile(result.path, "{}");
  await assert.rejects(api.analyzeEditorWaveform({ ...options(), cacheDir: local }), /波形数据/);
});
test("offset audio inserts real silence at video origin; video without audio is explicitly empty", async () => {
  const delayed = join(dir, "offset.mov");
  ff([
    "-f",
    "lavfi",
    "-i",
    "color=red:s=32x32:r=10:d=2",
    "-itsoffset",
    "0.5",
    "-i",
    input,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-c:v",
    "libx264",
    "-c:a",
    "pcm_f32le",
    delayed,
  ]);
  const result = await api.analyzeEditorWaveform({
    ...options(),
    input: delayed,
    sourceDuration: 600000,
  });
  const wave = api.decodeEditorWaveform(JSON.parse(await readFile(result.path, "utf8")));
  assert.deepEqual(api.waveformEnvelope(wave, 0, 350000), { min: 0, max: 0, rms: 0 });
  assert.ok(api.waveformEnvelope(wave, 380000, 500000).max > 0.49);
  const silent = join(dir, "silent.mp4");
  ff(["-f", "lavfi", "-i", "color=blue:s=32x32:r=10:d=0.2", "-an", "-c:v", "libx264", silent]);
  const no = await api.analyzeEditorWaveform({ ...options(), input: silent });
  const empty = api.decodeEditorWaveform(JSON.parse(await readFile(no.path, "utf8")));
  assert.equal(empty.hasAudio, false);
  assert.equal(empty.data.length, 0);
});
test("stream boundaries, malformed PCM and cancellation never publish partial cache", async () => {
  const accumulator = new api.WaveformAccumulator(),
    pcm = Buffer.alloc(8000);
  for (let i = 0; i < 2000; i++) pcm.writeFloatLE(i % 2 ? 0.25 : -0.5, i * 4);
  for (let i = 0; i < pcm.length; i += 13) accumulator.push(pcm.subarray(i, i + 13));
  const wave = api.decodeEditorWaveform(accumulator.finish("a".repeat(64)));
  assert.equal(wave.sampleCount, 1000);
  assert.ok(wave.data[0] < -16000);
  const incomplete = new api.WaveformAccumulator();
  incomplete.push(Buffer.alloc(3));
  assert.throws(() => incomplete.finish("a".repeat(64)), /完整采样/);
  const invalid = new api.WaveformAccumulator();
  const nan = Buffer.alloc(8);
  nan.writeFloatLE(NaN);
  assert.throws(() => invalid.push(nan), /无效采样/);
  const controller = new AbortController();
  controller.abort();
  const before = await readdir(cache);
  await assert.rejects(
    api.analyzeEditorWaveform({ ...options(), signal: controller.signal }),
    /cancel/i,
  );
  assert.deepEqual(await readdir(cache), before);
});
test("actual task publishes a small content-addressed waveform artifact and validates resource identity", async () => {
  const jobDir = join(dir, "job"),
    runtimeDir = join(dir, "runtime");
  await mkdir(jobDir);
  await mkdir(runtimeDir);
  await mkdir(join(jobDir, "inputs"));
  await writeFile(join(jobDir, "inputs", "resource-0.bin"), await readFile(input));
  const sourceHash = hash(await readFile(input));
  const context = {
    jobDir,
    runtimeDir,
    scopeKey: "c".repeat(64),
    jobId: "waveform-test",
    signal: new AbortController().signal,
    runtimeSource: "",
    runtimeSha: "0".repeat(64),
    reportProgress: () => {},
  };
  const response = await api.runEditorRequest(
    {
      action: "analyze-waveform",
      transferId: `editor-${randomUUID()}`,
      resourceIds: [`asset-${sourceHash}`],
      sourceDuration: 480000,
    },
    context,
  );
  assert.equal(response.artifacts.length, 1);
  const artifact = response.artifacts[0];
  assert.ok(artifact.bytes < 10000);
  assert.equal(artifact.assetId, `asset-${artifact.sha256}`);
  assert.equal(response.result.waveform.id, artifact.assetId);
  await assert.rejects(
    api.runEditorRequest(
      {
        action: "analyze-waveform",
        transferId: `editor-${randomUUID()}`,
        resourceIds: [`asset-${"f".repeat(64)}`],
        sourceDuration: 480000,
      },
      context,
    ),
    /资源编号/,
  );
});

test("installed-style CLI accepts waveform action through its strict envelope and emits only a bounded artifact receipt", async () => {
  const jobDir = join(dir, "cli-job"),
    runtimeDir = join(dir, "cli-runtime");
  await mkdir(jobDir);
  await mkdir(runtimeDir);
  await mkdir(join(jobDir, "inputs"));
  await writeFile(join(jobDir, "inputs", "resource-0.bin"), await readFile(input));
  const request = {
    action: "analyze-waveform",
    transferId: `editor-${randomUUID()}`,
    resourceIds: [`asset-${hash(await readFile(input))}`],
    sourceDuration: 480000,
    scopeKey: "d".repeat(64),
    jobId: "cli-waveform",
  };
  const child = spawnSync(
    process.execPath,
    [join(dir, "cli.mjs"), "--job-dir", jobDir, "--runtime-dir", runtimeDir],
    { input: JSON.stringify(request), maxBuffer: 1024 * 1024, timeout: 30000 },
  );
  assert.equal(child.status, 0, child.stdout.toString() + child.stderr.toString());
  const events = child.stdout.toString().trim().split("\n").map(JSON.parse);
  const result = events.find((event) => event.type === "result");
  assert.equal(result.result.artifacts.length, 1);
  assert.ok(child.stdout.length < 10000);
  assert.equal(result.result.result.resourceId, request.resourceIds[0]);
});

test("stream compaction stays within 65,536 bins and preserves weighted RMS across merged bins", () => {
  const accumulator = new api.WaveformAccumulator(),
    block = Buffer.alloc(960 * 8);
  for (let offset = 0; offset < block.length; offset += 8) {
    block.writeFloatLE(-0.5, offset);
    block.writeFloatLE(0.25, offset + 4);
  }
  for (let bin = 0; bin < 65538; bin++) accumulator.push(block);
  const stored = accumulator.finish("e".repeat(64)),
    waveform = api.decodeEditorWaveform(stored);
  assert.equal(waveform.samplesPerBin, 1920);
  assert.equal(waveform.sampleCount, 65538 * 960);
  assert.equal(waveform.data.length, 32769 * 3);
  assert.ok(Buffer.byteLength(JSON.stringify(stored)) < api.WAVEFORM_LIMITS.bytes);
  const measured = api.waveformEnvelope(waveform, 0, waveform.sampleCount * 5);
  assert.ok(Math.abs(measured.min + 0.5) < 0.0001);
  assert.ok(Math.abs(measured.max - 0.25) < 0.0001);
  assert.ok(Math.abs(measured.rms - Math.sqrt((0.5 ** 2 + 0.25 ** 2) / 2)) < 0.0001);
});

test("canonical staged builtin narration resolves only the reviewed installed asset and produces real cached waveform", async () => {
  const runtimeDir = join(dir, "builtin-runtime");
  await mkdir(runtimeDir);
  const transferId = `editor-${randomUUID()}`,
    narration = join(root, "apps/video-studio/public/demo-narration.mp3");
  const asset = {
    id: "demo-narration-v1",
    name: "示例旁白 · 从想法，到成片。",
    kind: "audio",
    duration: 24 * 240000,
    metadata: { mimeType: "audio/mpeg" },
  };
  const document = {
    schemaVersion: 2,
    timebase: 240000,
    id: "builtin-doc",
    name: "Builtin",
    revision: 0,
    activeSequenceId: "main",
    exportProfiles: [],
    assets: [asset],
    sequences: [
      {
        id: "main",
        name: "Main",
        width: 64,
        height: 48,
        frameRate: { numerator: 30, denominator: 1 },
        background: "#000000",
        timelineMode: "free",
        tracks: [api.createTrack("a", "audio")],
        clips: [
          {
            id: "clip",
            kind: "media",
            label: "旁白",
            assetId: asset.id,
            trackId: "a",
            start: 0,
            duration: asset.duration,
            timeMap: {
              points: [
                { time: 0, source: 0 },
                { time: asset.duration, source: asset.duration },
              ],
            },
            audio: api.defaultAudioMix(),
            transform: api.defaultTransform(),
            color: api.defaultColorAdjustment(),
            blendMode: "normal",
          },
        ],
        transitions: [],
        markers: [],
      },
    ],
  };
  const selected = api.editorTaskDocument(document, "main");
  assert.deepEqual(selected.resourceIds, []);
  const bytes = Buffer.from(JSON.stringify(selected.document)),
    documentHash = hash(bytes);
  const invoke = async (request, builtinPath = narration) => {
    const jobDir = await mkdtemp(join(dir, "builtin-job-"));
    return api.runEditorRequest(
      { transferId, ...request },
      {
        jobDir,
        runtimeDir,
        scopeKey: "e".repeat(64),
        jobId: "builtin-job",
        signal: new AbortController().signal,
        runtimeSource: "",
        runtimeSha: "0".repeat(64),
        reportProgress: () => {},
        builtinNarrationPath: builtinPath,
      },
    );
  };
  await invoke({
    action: "stage-document",
    documentHash,
    chunkIndex: 0,
    chunkCount: 1,
    dataBase64: bytes.toString("base64"),
  });
  await invoke({
    action: "commit",
    documentHash,
    sequenceId: "main",
    chunkCount: 1,
    byteLength: bytes.length,
  });
  const response = await invoke({
    action: "analyze-asset-waveform",
    documentHash,
    sequenceId: "main",
    assetIds: [asset.id],
  });
  assert.equal(response.result.resourceId, `asset-${api.EDITOR_DEMO_NARRATION_SHA}`);
  assert.equal(response.result.assetId, asset.id);
  assert.equal(response.result.sourceHash, api.EDITOR_DEMO_NARRATION_SHA);
  assert.ok(response.result.waveform.bytes > 1000);
  assert.equal(response.result.reused, false);
  const again = await invoke({
    action: "analyze-asset-waveform",
    documentHash,
    sequenceId: "main",
    assetIds: [asset.id],
  });
  assert.equal(again.result.reused, true);
  await assert.rejects(
    invoke({
      action: "analyze-asset-waveform",
      documentHash,
      sequenceId: "main",
      assetIds: ["arbitrary-path"],
    }),
    /当前序列/,
  );
  // A new transfer cannot turn an arbitrary file into the fixed reviewed narration.
  const badRuntime = join(dir, "bad-builtin-runtime");
  await mkdir(badRuntime);
  const jobDir = await mkdtemp(join(dir, "bad-builtin-job-"));
  await assert.rejects(
    api.runEditorRequest(
      {
        action: "analyze-asset-waveform",
        transferId,
        documentHash,
        sequenceId: "main",
        assetIds: [asset.id],
        path: input,
      },
      {
        jobDir,
        runtimeDir: badRuntime,
        scopeKey: "e".repeat(64),
        jobId: "bad",
        signal: new AbortController().signal,
        runtimeSource: "",
        runtimeSha: "0".repeat(64),
        reportProgress: () => {},
        builtinNarrationPath: input,
      },
    ),
    /字段/,
  );
});

test("single-resource preparation converts actual ProRes and reuses the exact shared proxy cache without staging a project", async () => {
  const prores = join(dir, "camera.mov");
  ff([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=64x48:r=30:d=0.4",
    "-c:v",
    "prores_ks",
    "-profile:v",
    "1",
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
  const bytes = await readFile(prores),
    resourceId = `asset-${hash(bytes)}`,
    runtimeDir = join(dir, "source-runtime");
  await mkdir(runtimeDir);
  const invoke = async () => {
    const jobDir = await mkdtemp(join(dir, "source-job-"));
    await mkdir(join(jobDir, "inputs"));
    await writeFile(join(jobDir, "inputs", "resource-0.bin"), bytes);
    const request = {
      action: "prepare-source-video",
      transferId: `editor-${randomUUID()}`,
      resourceIds: [resourceId],
      sourceDuration: 96000,
      scopeKey: "f".repeat(64),
      jobId: "source-job",
    };
    const child = spawnSync(
      process.execPath,
      [join(dir, "cli.mjs"), "--job-dir", jobDir, "--runtime-dir", runtimeDir],
      { input: JSON.stringify(request), maxBuffer: 1024 * 1024, timeout: 30000 },
    );
    assert.equal(child.status, 0, child.stdout.toString() + child.stderr.toString());
    const event = child.stdout
      .toString()
      .trim()
      .split("\n")
      .map(JSON.parse)
      .find((event) => event.type === "result");
    return { ...event.result, jobDir };
  };
  const first = await invoke(),
    second = await invoke();
  assert.equal(first.result.resourceId, resourceId);
  assert.equal(first.result.sourceHash, hash(bytes));
  assert.equal(first.result.recipe.frameCount, 12);
  assert.equal(first.result.recipe.width, 64);
  assert.equal(first.result.recipe.height, 48);
  assert.equal(first.result.recipe.color.space, "bt709");
  assert.equal(first.result.proxy.id, second.result.proxy.id);
  assert.equal(first.result.recipe.recipeHash, second.result.recipe.recipeHash);
  const output = join(first.jobDir, first.artifacts[0].file);
  const probe = spawnSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_name",
    "-of",
    "json",
    output,
  ]);
  assert.equal(probe.status, 0, probe.stderr.toString());
  assert.equal(JSON.parse(probe.stdout).streams[0].codec_name, "vp9");
  const scope = join(runtimeDir, "scopes", "f".repeat(64));
  const transfers = await readdir(join(scope, "transfers"));
  for (const transfer of transfers)
    assert.ok(!(await readdir(join(scope, "transfers", transfer))).includes("manifest.json"));
});

test("narrow builtin analysis goes from the real bridge through native staging with original identity and no unrelated resources", async () => {
  const asset = {
    id: "demo-narration-v1",
    name: "示例旁白 · 从想法，到成片。",
    kind: "audio",
    duration: 24 * 240000,
    metadata: { mimeType: "audio/mpeg" },
  };
  const document = {
    schemaVersion: 2,
    timebase: 240000,
    id: "builtin-doc",
    name: "Builtin",
    revision: 0,
    activeSequenceId: "main",
    exportProfiles: [],
    assets: [asset],
    sequences: [
      {
        id: "main",
        name: "Main",
        width: 64,
        height: 48,
        frameRate: { numerator: 30, denominator: 1 },
        background: "#000000",
        timelineMode: "free",
        tracks: [api.createTrack("a", "audio")],
        clips: [
          {
            id: "clip",
            kind: "media",
            label: "旁白",
            assetId: asset.id,
            trackId: "a",
            start: 0,
            duration: asset.duration,
            timeMap: {
              points: [
                { time: 0, source: 0 },
                { time: asset.duration, source: asset.duration },
              ],
            },
            audio: api.defaultAudioMix(),
            transform: api.defaultTransform(),
            color: api.defaultColorAdjustment(),
            blendMode: "normal",
          },
        ],
        transitions: [],
        markers: [],
      },
    ],
  };

  const before = JSON.stringify(document),
    runtimeDir = join(dir, "bridge-builtin-runtime");
  await mkdir(runtimeDir);
  const artifacts = new Map(),
    jobs = new Map(),
    calls = [];
  const bridge = api.createEditorTaskBridge({
    getContext: async () => ({
      cwd: "/waveform-origin",
      availableMethods: [
        "tasks.start",
        "tasks.get",
        "tasks.cancel",
        "tasks.retry",
        "resources.get",
        "resources.read",
      ],
      capabilities: { bridge: { maxCallsPerWindow: 10000 }, tasks: { maxInputBytes: 2097152 } },
    }),
    on: () => () => {},
    async call(method, params) {
      calls.push({ method, params });
      if (method === "tasks.start") {
        assert.deepEqual(params.input.resources, []);
        const jobDir = await mkdtemp(join(dir, "bridge-wave-job-")),
          id = `native-${randomUUID()}`;
        const response = await api.runEditorRequest(params.input.request, {
          jobDir,
          runtimeDir,
          scopeKey: hash(Buffer.from("/waveform-origin")),
          jobId: id,
          signal: new AbortController().signal,
          runtimeSource: "",
          runtimeSha: "0".repeat(64),
          reportProgress: () => {},
          builtinNarrationPath: join(root, "apps/video-studio/public/demo-narration.mp3"),
        });
        for (const artifact of response.artifacts)
          artifacts.set(artifact.assetId, await readFile(join(jobDir, artifact.file)));
        const job = {
          id,
          status: "succeeded",
          attempt: 1,
          createdAt: 0,
          updatedAt: 0,
          result: response,
        };
        jobs.set(id, job);
        return job;
      }
      if (method === "tasks.get") return jobs.get(params.id ?? params.jobId);
      if (method === "resources.read") {
        const bytes = artifacts.get(params.assetId);
        return {
          assetId: params.assetId,
          offset: params.offset,
          totalBytes: bytes.length,
          eof: params.offset + params.length === bytes.length,
          dataBase64: bytes
            .subarray(params.offset, params.offset + params.length)
            .toString("base64"),
        };
      }
      throw new Error(`Unexpected ${method}`);
    },
  });
  try {
    const result = await bridge.analyzeAssetWaveform(document, "main", asset.id);
    assert.equal(result.snapshot, undefined);
    assert.notEqual(result.analysisSnapshot.documentId, document.id);
    assert.equal(result.origin.documentId, document.id);
    assert.equal(result.origin.revision, document.revision);
    assert.equal(result.origin.sequenceId, "main");
    assert.equal(result.waveform.sourceHash, api.EDITOR_DEMO_NARRATION_SHA);
    assert.ok(result.waveform.data.some((value) => value !== 0));
    assert.equal(JSON.stringify(document), before);
    assert.ok(
      calls.every(
        (call) => call.method !== "tasks.start" || call.params.input.resources.length === 0,
      ),
    );
  } finally {
    bridge.dispose();
  }
});
