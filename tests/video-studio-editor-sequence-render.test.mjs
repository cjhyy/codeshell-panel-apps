import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { build } from "esbuild";
import { PNG } from "pngjs";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url)),
  T = 240000;
let temporary, api, runtimeSource, videoPath, audioPath;
function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "editor-sequence-render-"));
  const browser = await build({
    entryPoints: [join(root, "apps/video-studio/src/editor/render-entry.ts")],
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    write: false,
  });
  runtimeSource = browser.outputFiles[0].text;
  const native = join(temporary, "native.mjs");
  await build({
    stdin: {
      contents: `export * from './apps/video-studio/src/editor/sequence-edits';export * from './apps/video-studio/src/editor/defaults';export * from './apps/video-studio/src/editor/operations';export * from './apps/video-studio/src/editor/export-settings';export * from './apps/video-studio/native/media/editor-frame-renderer';export * from './apps/video-studio/native/media/editor-export';export * from './apps/video-studio/native/media/editor-audio-renderer';`,
      resolveDir: root,
    },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: native,
  });
  api = await import(pathToFileURL(native));
  videoPath = join(temporary, "source.webm");
  audioPath = join(temporary, "tone.wav");
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=96x64:r=30:d=2",
    "-c:v",
    "libvpx-vp9",
    "-lossless",
    "1",
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-an",
    videoPath,
  ]);
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=0.12*sin(2*PI*440*t)+0.08*sin(2*PI*773*t):s=48000:d=2",
    "-ac",
    "2",
    "-c:a",
    "pcm_f32le",
    audioPath,
  ]);
});
after(async () => {
  await rm(temporary, { recursive: true, force: true });
});
const visual = () => ({
  transform: api.defaultTransform(),
  color: api.defaultColorAdjustment(),
  blendMode: "normal",
});
function fixture() {
  const a = {
    id: "a",
    kind: "media",
    assetId: "video",
    trackId: "v",
    label: "A",
    start: T / 10 + 5,
    duration: T / 2,
    timeMap: {
      points: [
        { time: 0, source: 0 },
        { time: T / 4, source: (2 * T) / 5 },
        { time: T / 2, source: (7 * T) / 10 },
      ],
    },
    audio: { ...api.defaultAudioMix(), volume: 0 },
    ...visual(),
  };
  a.transform.opacity = 0.75;
  a.transform.x = {
    keyframes: [
      { time: 0, value: -0.1, easing: "linear" },
      { time: T / 2, value: 0.1, easing: "ease-in" },
    ],
  };
  a.color.exposure = 0.2;
  const b = {
    ...structuredClone(a),
    id: "b",
    label: "B",
    start: (9 * T) / 20 + 5,
    timeMap: {
      points: [
        { time: 0, source: (17 * T) / 10 },
        { time: T / 2, source: (12 * T) / 10 },
      ],
    },
  };
  b.transform.flipX = true;
  const sound = {
    ...structuredClone(a),
    id: "sound",
    label: "声音",
    assetId: "audio",
    trackId: "audio",
    audio: {
      ...api.defaultAudioMix(),
      preservePitch: false,
      volume: {
        keyframes: [
          { time: 0, value: 0.3, easing: "linear" },
          { time: T / 2, value: 0.8, easing: "linear" },
        ],
      },
      pan: -0.2,
    },
  };
  a.linkGroupId = sound.linkGroupId = "link";
  const caption = {
    id: "caption",
    kind: "text",
    role: "subtitle",
    label: "字幕",
    trackId: "t",
    start: a.start,
    duration: a.duration,
    text: "你好\n世界",
    style: {
      ...api.defaultTextStyle(),
      fontSize: 12,
      layout: "box",
      padding: 0,
      background: "#00000000",
    },
    words: [
      { text: "你好", start: 0, end: T / 4 },
      { text: "世界", start: T / 4, end: T / 2 },
    ],
    sourceBinding: { clipId: "a", sourceStart: 0, sourceEnd: (7 * T) / 10 },
    ...visual(),
  };
  caption.transform.y = 0.15;
  const background = {
    id: "background",
    kind: "shape",
    shape: "rectangle",
    fill: "#3050a0",
    stroke: "#00000000",
    strokeWidth: 0,
    trackId: "bg",
    label: "独立底图",
    start: 0,
    duration: T,
    ...visual(),
  };
  return {
    schemaVersion: 2,
    timebase: T,
    id: "doc",
    name: "复合输出对比",
    revision: 0,
    activeSequenceId: "main",
    exportProfiles: [],
    assets: [
      { id: "video", kind: "video", name: "测试画面", duration: 2 * T, width: 96, height: 64 },
      { id: "audio", kind: "audio", name: "真实声音", duration: 2 * T },
    ],
    sequences: [
      {
        id: "main",
        name: "主序列",
        width: 96,
        height: 64,
        frameRate: { numerator: 30000, denominator: 1001 },
        background: "#081020",
        timelineMode: "free",
        tracks: [
          api.createTrack("bg", "video"),
          api.createTrack("v", "video"),
          { ...api.createTrack("audio", "audio"), volume: 0.7, pan: 0.1 },
          api.createTrack("t", "text"),
        ],
        clips: [background, a, b, sound, caption],
        transitions: [
          {
            id: "cross",
            fromClipId: "a",
            toClipId: "b",
            start: b.start,
            duration: a.start + a.duration - b.start,
            kind: "dissolve",
          },
        ],
        markers: [],
      },
    ],
  };
}
const apply = (doc, plan) => api.applyEditorOperations(doc, plan.operations, doc.revision);
async function render(doc, name) {
  const workDir = await mkdtemp(join(temporary, `${name}-`)),
    signal = new AbortController().signal,
    audioFile = join(workDir, "mix.wav"),
    outputPath = join(workDir, "output.mp4");
  const audio = await api.renderEditorAudio({
    document: doc,
    sequenceId: "main",
    resolveAssetPath: (id) => (id === "video" ? videoPath : audioPath),
    ffmpegPath: "ffmpeg",
    ffprobePath: "ffprobe",
    workDir,
    cacheDir: join(temporary, "audio-cache"),
    outputPath: audioFile,
    signal,
  });
  const profile = {
    ...api.createExportPresets()[0],
    width: 96,
    height: 64,
    frameRate: { numerator: 30000, denominator: 1001 },
    quality: { mode: "quality", value: 100 },
  };
  const result = await api.exportEditorSequence({
    document: doc,
    sequenceId: "main",
    profile,
    mediaFiles: new Map([["video", { path: videoPath, mimeType: "video/webm" }]]),
    runtimeSource,
    workDir,
    audioFile,
    outputPath,
    signal,
  });
  const pixels = ffmpeg(["-i", outputPath, "-an", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]),
    samples = ffmpeg(["-i", audioFile, "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1"]);
  return { result, audio, pixels, samples };
}
test("real native NTSC export and PCM remain identical before compound creation and after unpack, including transparency, transitions, nonlinear/reverse source times and Chinese text", async () => {
  const doc = fixture(),
    plan = api.planCreateCompound(doc, "main", ["a"], { name: "开场复合" }),
    combined = apply(doc, plan),
    unpacked = apply(combined, api.planUnpackCompound(combined, "main", plan.clipIds[0]));
  const original = await render(doc, "original"),
    nested = await render(combined, "combined"),
    flat = await render(unpacked, "unpacked");
  assert.equal(original.result.frameCount, 30);
  assert.equal(nested.result.frameCount, 30);
  assert.equal(flat.result.frameCount, 30);
  assert.equal(
    nested.result.probe.streams.find((s) => s.codec_type === "video").avg_frame_rate,
    "30000/1001",
  );
  assert.equal(
    Buffer.compare(nested.samples, original.samples),
    0,
    compareBytes(nested.samples, original.samples, "compound PCM"),
  );
  assert.equal(
    Buffer.compare(flat.samples, original.samples),
    0,
    compareBytes(flat.samples, original.samples, "unpack PCM"),
  );
  const rawFrames = [];
  for (const document of [doc, combined]) {
    const renderer = await api.EditorFrameRenderer.create({
      document,
      sequenceId: "main",
      profile: { ...api.createExportPresets()[0], width: 96, height: 64 },
      mediaFiles: new Map([["video", { path: videoPath, mimeType: "video/webm" }]]),
      runtimeSource,
      workDir: await mkdtemp(join(temporary, "raw-")),
      signal: new AbortController().signal,
    });
    try {
      const frames = [];
      for (const tick of [32032, 80080, 120120, 160160, 200200])
        frames.push(PNG.sync.read(await renderer.render(tick)).data);
      rawFrames.push(Buffer.concat(frames));
    } finally {
      await renderer.close();
    }
  }
  assert.equal(
    Buffer.compare(rawFrames[0], rawFrames[1]),
    0,
    compareBytes(rawFrames[0], rawFrames[1], "unencoded RGBA"),
  );
  assert.equal(
    Buffer.compare(nested.pixels, original.pixels),
    0,
    compareBytes(nested.pixels, original.pixels, "compound RGB"),
  );
  assert.equal(
    Buffer.compare(flat.pixels, original.pixels),
    0,
    compareBytes(flat.pixels, original.pixels, "unpack RGB"),
  );
  assert.ok(original.audio.peak > 0.01);
  assert.equal(original.audio.sampleCount, 48000);
  assert.ok(original.pixels.some((v) => v > 150));
});

test("unpacking an opaque child canvas preserves the actual background layer", async (t) => {
  const doc = fixture();
  doc.sequences[0].clips = doc.sequences[0].clips.filter((c) => c.id === "background");
  doc.sequences[0].transitions = [];
  const child = {
    ...structuredClone(doc.sequences[0]),
    id: "child",
    name: "彩色子序列",
    background: "#e05020",
    tracks: [api.createTrack("cv", "video")],
    clips: [
      {
        ...structuredClone(doc.sequences[0].clips[0]),
        id: "small",
        trackId: "cv",
        fill: "#50c080",
        transform: { ...api.defaultTransform(), scaleX: 0.5, scaleY: 0.5 },
      },
    ],
  };
  doc.sequences.push(child);
  const nestedPlan = api.planNestSequence(doc, "main", "child", { at: 0 }),
    nested = apply(doc, nestedPlan),
    unpacked = apply(nested, api.planUnpackCompound(nested, "main", nestedPlan.clipIds[0]));
  const images = [];
  for (const document of [nested, unpacked]) {
    const workDir = await mkdtemp(join(temporary, "background-")),
      renderer = await api.EditorFrameRenderer.create({
        document,
        sequenceId: "main",
        profile: { ...api.createExportPresets()[0], width: 96, height: 64 },
        mediaFiles: new Map(),
        runtimeSource,
        workDir,
        signal: new AbortController().signal,
      });
    t.after(() => renderer.close());
    images.push(await renderer.render(0));
    await renderer.close();
  }
  assert.deepEqual(images[0], images[1]);
});

function compareBytes(a, b, label) {
  let maximum = 0,
    count = 0,
    first = -1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const delta = Math.abs(a[i] - b[i]);
    if (delta) {
      count++;
      if (first < 0) first = i;
      maximum = Math.max(maximum, delta);
    }
  }
  return `${label}: lengths ${a.length}/${b.length}, max byte error ${maximum}, changed ${count}, first ${first}`;
}
