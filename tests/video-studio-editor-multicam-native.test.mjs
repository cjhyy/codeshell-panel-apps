import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { build } from "esbuild";
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
let dir, api, source, target, silent, periodic, sourceId, targetId, runtimeSource, cameraA, cameraB;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function ff(args) {
  const result = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], {
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}
before(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "multicam-native-")));
  await build({
    stdin: {
      resolveDir: root,
      contents: `export * from './apps/video-studio/native/editor-runtime/multicam';export * from './apps/video-studio/native/editor-runtime/runtime';export * from './apps/video-studio/src/editor/task-bridge';export * from './apps/video-studio/src/editor/defaults';export * from './apps/video-studio/src/editor/multicam-edits';export * from './apps/video-studio/src/editor/clip-edits';export * from './apps/video-studio/src/editor/operations';export * from './apps/video-studio/src/editor/export-settings';export * from './apps/video-studio/native/media/editor-audio-renderer';export * from './apps/video-studio/native/media/editor-export';`,
    },
    bundle: true,
    platform: "node",
    format: "esm",
    banner: {
      js: 'import {createRequire} from "node:module"; const require=createRequire(import.meta.url);',
    },
    outfile: join(dir, "api.mjs"),
  });
  api = await import(pathToFileURL(join(dir, "api.mjs")));
  await build({
    stdin: {
      resolveDir: root,
      contents: `import {runEditorCli} from './apps/video-studio/native/editor-runtime/cli';await runEditorCli({runtimeSource:'',runtimeSha:'${"0".repeat(64)}'});`,
    },
    bundle: true,
    platform: "node",
    format: "esm",
    banner: {
      js: 'import {createRequire} from "node:module"; const require=createRequire(import.meta.url);',
    },
    outfile: join(dir, "cli.mjs"),
  });
  // Deterministic, non-repeating audible noise with changing loudness. Stereo channels are antiphase.
  let state = 47;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const frames = 8 * 48000,
    raw = Buffer.alloc(frames * 8);
  let level = 0.2;
  for (let i = 0; i < frames; i++) {
    if (i % 240 === 0) level = 0.03 + 0.25 * random();
    const sample = (random() - 0.5) * level;
    raw.writeFloatLE(sample, i * 8);
    raw.writeFloatLE(-sample, i * 8 + 4);
  }
  await writeFile(join(dir, "source.f32"), raw);
  source = join(dir, "source.wav");
  target = join(dir, "delayed.wav");
  silent = join(dir, "silent.wav");
  periodic = join(dir, "periodic.wav");
  ff([
    "-f",
    "f32le",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-i",
    join(dir, "source.f32"),
    "-c:a",
    "pcm_f32le",
    source,
  ]);
  ff(["-i", source, "-af", "adelay=375|375,volume=0.37", "-c:a", "pcm_f32le", target]);
  ff(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "8", "-c:a", "pcm_f32le", silent]);
  ff([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=8",
    "-ac",
    "2",
    "-c:a",
    "pcm_f32le",
    periodic,
  ]);
  sourceId = `asset-${sha(await readFile(source))}`;
  targetId = `asset-${sha(await readFile(target))}`;
  const browser = await build({
    entryPoints: [join(root, "apps/video-studio/src/editor/render-entry.ts")],
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
  });
  runtimeSource = browser.outputFiles[0].text;
  cameraA = join(dir, "camera-a.mp4");
  cameraB = join(dir, "camera-b.mp4");
  for (const [color, input, output, duration] of [
    ["red", source, cameraA, "8"],
    ["blue", target, cameraB, "8.375"],
  ])
    ff([
      "-f",
      "lavfi",
      "-i",
      `color=${color}:s=64x48:r=30:d=${duration}`,
      "-i",
      input,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "10",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      output,
    ]);
});
after(async () => rm(dir, { recursive: true, force: true }));
async function options(overrides = {}) {
  const cacheDir = join(dir, "cache"),
    pcmCacheDir = join(dir, "pcm");
  await mkdir(cacheDir, { recursive: true });
  await mkdir(pcmCacheDir, { recursive: true });
  return {
    sources: [
      { resourceId: sourceId, path: source, duration: 8 * 240000 },
      { resourceId: targetId, path: target, duration: 8.375 * 240000 },
    ],
    referenceResourceId: sourceId,
    windowSeconds: 8,
    maxOffsetSeconds: 2,
    cacheDir,
    pcmCacheDir,
    ffmpegPath: "ffmpeg",
    ffprobePath: "ffprobe",
    signal: new AbortController().signal,
    ...overrides,
  };
}
test("actual stereo sound correlation finds signed 375 ms delay despite gain and antiphase, caches verified feature data", async () => {
  const first = await api.alignEditorMulticam(await options()),
    match = first.results[1];
  assert.equal(match.offset, 0.375 * 240000);
  assert.equal(match.reliable, true);
  assert.ok(match.confidence > 0.99);
  assert.equal(match.precisionTicks, 1200);
  assert.equal(first.reused, false);
  const repeat = await api.alignEditorMulticam(await options({ ffprobePath: "/not-installed" }));
  assert.equal(repeat.reused, true);
  assert.deepEqual(repeat.results, first.results);
  const reverse = await api.alignEditorMulticam(await options({ referenceResourceId: targetId }));
  assert.equal(reverse.results[0].offset, -0.375 * 240000);
  assert.equal(reverse.results[0].reliable, true);
});
test("silent and repetitive real audio yield explicit uncertain results, never a successful automatic offset", async () => {
  for (const path of [silent, periodic]) {
    const id = `asset-${sha(await readFile(path))}`,
      a = await options({
        sources: [
          { resourceId: sourceId, path: source, duration: 8 * 240000 },
          { resourceId: id, path, duration: 8 * 240000 },
        ],
      }),
      result = await api.alignEditorMulticam(a);
    assert.equal(result.results[1].reliable, false);
    assert.ok(result.results[1].reason);
  }
});

test("alignment reuses complete existing export PCM without decoding either source again", async () => {
  const settings = await options(),
    version = spawnSync("ffmpeg", ["-hide_banner", "-version"]).stdout.toString();
  for (const source of settings.sources) {
    const hash = sha(await readFile(source.path)),
      key = api.editorSourcePcmCacheKey(hash, source.duration, version);
    ff([
      "-i",
      source.path,
      "-ac",
      "2",
      "-ar",
      "48000",
      "-f",
      "f32le",
      "-c:a",
      "pcm_f32le",
      join(settings.pcmCacheDir, `${key}.f32`),
    ]);
  }
  const cacheDir = await mkdtemp(join(dir, "reused-pcm-"));
  const result = await api.alignEditorMulticam({
    ...settings,
    cacheDir,
    ffprobePath: "/not-installed",
  });
  assert.equal(result.results[1].offset, 90000);
  assert.equal(result.results[1].reliable, true);
});
test("native task materializes only selected sources and validates hashes, cancellation and strict alignment fields", async () => {
  const job = await mkdtemp(join(dir, "job-")),
    runtime = join(dir, "runtime");
  await mkdir(join(job, "inputs"));
  await mkdir(runtime, { recursive: true });
  await copyFile(source, join(job, "inputs", "resource-0.bin"));
  await copyFile(target, join(job, "inputs", "resource-1.bin"));
  const request = {
      action: "align-multicam",
      transferId: `editor-${randomUUID()}`,
      resourceIds: [sourceId, targetId],
      alignment: {
        referenceResourceId: sourceId,
        windowSeconds: 8,
        maxOffsetSeconds: 2,
        sourceDurations: [8 * 240000, 8.375 * 240000],
      },
    },
    context = {
      jobDir: job,
      runtimeDir: runtime,
      scopeKey: "c".repeat(64),
      jobId: "job",
      signal: new AbortController().signal,
      runtimeSource: "",
      runtimeSha: "0".repeat(64),
      reportProgress: () => {},
    };
  const result = await api.runEditorRequest(request, context);
  assert.equal(result.result.results[1].offset, 0.375 * 240000);
  assert.deepEqual(result.artifacts, []);
  await assert.rejects(
    api.runEditorRequest(
      { ...request, alignment: { ...request.alignment, path: "/etc/passwd" } },
      context,
    ),
    /不支持/,
  );
  await assert.rejects(
    api.runEditorRequest(
      {
        ...request,
        resourceIds: [`asset-${"f".repeat(64)}`, targetId],
        alignment: { ...request.alignment, referenceResourceId: `asset-${"f".repeat(64)}` },
      },
      context,
    ),
    /内容/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(api.alignEditorMulticam(await options({ signal: controller.signal })), {
    name: "AbortError",
  });
  const envelope = { ...request, scopeKey: context.scopeKey, jobId: "cli-job" };
  const cli = spawnSync(
    process.execPath,
    [join(dir, "cli.mjs"), "--job-dir", job, "--runtime-dir", runtime],
    { input: JSON.stringify(envelope), encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
  );
  assert.equal(cli.status, 0, cli.stderr + cli.stdout);
  assert.match(cli.stdout, /"offset":90000/);
});

test("background bridge reuses one real native task for the same request identity and exposes its exact project origin", async () => {
  const paths = [cameraA, cameraB],
    resourceIds = await Promise.all(
      paths.map(async (path) => `asset-${sha(await readFile(path))}`),
    );
  const document = {
    schemaVersion: 2,
    timebase: 240000,
    id: "program",
    name: "访谈",
    revision: 3,
    activeSequenceId: "main",
    exportProfiles: [],
    assets: resourceIds.map((resourceId, index) => ({
      id: `camera-${index}`,
      kind: "video",
      name: `机位 ${index}`,
      duration: (index ? 8.375 : 8) * 240000,
      width: 64,
      height: 48,
      resourceId,
    })),
    sequences: [
      {
        id: "main",
        name: "节目",
        width: 64,
        height: 48,
        frameRate: { numerator: 30, denominator: 1 },
        background: "#000000",
        timelineMode: "free",
        tracks: [api.createTrack("v", "video")],
        clips: [],
        transitions: [],
        markers: [],
      },
    ],
  };
  const jobs = new Map(),
    work = [],
    tasks = [];
  let executions = 0;
  const runtimeDir = join(dir, "bridge-runtime");
  await mkdir(runtimeDir, { recursive: true });
  const raw = {
    getContext: async () => ({
      cwd: "/multicam-project",
      availableMethods: [
        "tasks.start",
        "tasks.get",
        "tasks.cancel",
        "tasks.retry",
        "resources.get",
      ],
      capabilities: {
        bridge: { maxCallsPerWindow: 10000 },
        tasks: { maxInputBytes: 2 * 1024 * 1024 },
      },
    }),
    on: () => () => {},
    call: async (method, params) => {
      if (method === "tasks.start") {
        if (jobs.has(params.requestKey)) return structuredClone(jobs.get(params.requestKey));
        const job = {
          id: `native-${++executions}`,
          status: "running",
          attempt: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        jobs.set(params.requestKey, job);
        const promise = (async () => {
          const jobDir = await mkdtemp(join(dir, "bridge-job-"));
          await mkdir(join(jobDir, "inputs"));
          for (const [index, input] of params.input.resources.entries()) {
            assert.equal(input.assetId, resourceIds[index]);
            await copyFile(paths[index], join(jobDir, input.path));
          }
          const output = await api.runEditorRequest(params.input.request, {
            jobDir,
            runtimeDir,
            scopeKey: "d".repeat(64),
            jobId: job.id,
            signal: new AbortController().signal,
            runtimeSource: "",
            runtimeSha: "0".repeat(64),
            reportProgress: () => {},
          });
          job.status = "succeeded";
          job.result = output;
        })();
        work.push(promise);
        return structuredClone(job);
      }
      if (method === "tasks.get")
        return structuredClone(
          [...jobs.values()].find((job) => job.id === (params.taskId ?? params.id)),
        );
      return {};
    },
  };
  const bridge = api.createEditorTaskBridge(raw);
  try {
    const options = {
      transferId: "editor-01234567-0123-4567-89ab-0123456789ab",
      windowSeconds: 8,
      maxOffsetSeconds: 2,
      onTask: (job) => tasks.push(job.id),
    };
    const first = await bridge.startMulticamAlignment(
        document,
        ["camera-0", "camera-1"],
        "camera-0",
        options,
      ),
      second = await bridge.startMulticamAlignment(
        document,
        ["camera-0", "camera-1"],
        "camera-0",
        options,
      );
    assert.equal(first.jobId, second.jobId);
    assert.equal(executions, 1);
    assert.equal(tasks.length, 2);
    await Promise.all(work);
    const result = await bridge.alignMulticamSources(
      document,
      ["camera-0", "camera-1"],
      "camera-0",
      options,
    );
    assert.equal(executions, 1);
    assert.equal(result.documentHash, first.documentHash);
    assert.equal(result.results[1].reliable, true);
    assert.ok(Math.abs(result.results[1].offset - 90000) <= 1200);
    assert.deepEqual([...jobs.values()][0].result.result.origin.assets, first.assets);
  } finally {
    bridge.dispose();
  }
});

test("recorded angle cuts export the actual red-blue-red picture while preserving every master PCM sample", async () => {
  let document = {
    schemaVersion: 2,
    timebase: 240000,
    id: "render",
    name: "切换输出",
    revision: 0,
    activeSequenceId: "main",
    exportProfiles: [],
    assets: [
      { id: "a", kind: "video", name: "正面", duration: 8 * 240000, width: 64, height: 48 },
      { id: "b", kind: "video", name: "侧面", duration: 8.375 * 240000, width: 64, height: 48 },
    ],
    sequences: [
      {
        id: "main",
        name: "节目",
        width: 64,
        height: 48,
        frameRate: { numerator: 30, denominator: 1 },
        background: "#000000",
        timelineMode: "free",
        tracks: [api.createTrack("v", "video")],
        clips: [],
        transitions: [],
        markers: [],
      },
    ],
  };
  const apply = (ops) => {
    document = api.applyEditorOperations(document, ops, document.revision);
  };
  apply(
    api.planCreateMulticam(document, "main", {
      assetIds: ["a", "b"],
      offsets: { b: 90000 },
      name: "节目机位",
      at: 0,
    }),
  );
  let clip = document.sequences[0].clips[0];
  apply(api.trimClip(document, "main", clip.id, 0, 240000));
  const before = structuredClone(document);
  clip = document.sequences[0].clips[0];
  apply(
    api.planRecordMulticamSwitches(document, "main", clip.id, 0, 240000, [
      { time: 0, angleId: clip.angles[0].id },
      { time: 72000, angleId: clip.angles[1].id },
      { time: 168000, angleId: clip.angles[0].id },
    ]),
  );
  const mixPaths = [];
  for (const doc of [before, document]) {
    const workDir = await mkdtemp(join(dir, "mix-")),
      outputPath = join(workDir, "mix.wav");
    await api.renderEditorAudio({
      document: doc,
      sequenceId: "main",
      resolveAssetPath: (id) => (id === "a" ? cameraA : cameraB),
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workDir,
      cacheDir: join(dir, "export-pcm"),
      outputPath,
      signal: new AbortController().signal,
    });
    mixPaths.push(outputPath);
  }
  const pcm = mixPaths.map((path) =>
    ff(["-i", path, "-f", "f32le", "-c:a", "pcm_f32le", "pipe:1"]),
  );
  assert.equal(
    Buffer.compare(pcm[0], pcm[1]),
    0,
    "switching picture must never change the master audio samples",
  );
  const workDir = await mkdtemp(join(dir, "export-")),
    outputPath = join(workDir, "program.mp4"),
    profile = {
      ...api.createExportPresets()[0],
      width: 64,
      height: 48,
      frameRate: { numerator: 30, denominator: 1 },
      quality: { mode: "quality", value: 100 },
    };
  const output = await api.exportEditorSequence({
    document,
    sequenceId: "main",
    profile,
    mediaFiles: new Map([
      ["a", { path: cameraA, mimeType: "video/mp4" }],
      ["b", { path: cameraB, mimeType: "video/mp4" }],
    ]),
    runtimeSource,
    workDir,
    audioFile: mixPaths[1],
    outputPath,
    signal: new AbortController().signal,
  });
  assert.equal(output.frameCount, 30);
  const pixels = ff(["-i", outputPath, "-an", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]),
    sample = (frame) => [
      ...pixels.subarray(
        (frame * 64 * 48 + 24 * 64 + 32) * 3,
        (frame * 64 * 48 + 24 * 64 + 32) * 3 + 3,
      ),
    ];
  for (const frame of [0, 8, 21, 29]) {
    const rgb = sample(frame);
    assert.ok(rgb[0] > 235 && rgb[2] < 15, `frame ${frame}: ${rgb}`);
  }
  for (const frame of [9, 15, 20]) {
    const rgb = sample(frame);
    assert.ok(rgb[2] > 235 && rgb[0] < 15, `frame ${frame}: ${rgb}`);
  }
});
