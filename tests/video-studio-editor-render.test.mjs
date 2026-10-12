import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { PNG } from "pngjs";
import { chromium } from "playwright";
import { createServer } from "node:http";

const root = fileURLToPath(new URL("../", import.meta.url));
let temporary, api, runtimeSource, videoPath;
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "video-editor-render-"));
  const runtime = await build({
    entryPoints: [join(root, "apps/video-studio/src/editor/render-entry.ts")],
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    write: false,
  });
  runtimeSource = runtime.outputFiles[0].text;
  const native = join(temporary, "renderer.mjs");
  await build({
    stdin: {
      contents: `export * from './apps/video-studio/native/media/editor-frame-renderer.ts'; export * from './apps/video-studio/native/media/editor-export.ts'; export {findCaptionBrowser} from './apps/video-studio/native/media/media-caption-renderer.ts'; export * from './apps/video-studio/src/editor/defaults.ts'; export * from './apps/video-studio/src/editor/time.ts'; export * from './apps/video-studio/src/editor/export-settings.ts';`,
      resolveDir: root,
    },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: native,
  });
  api = await import(pathToFileURL(native));
  videoPath = join(temporary, "red-blue.webm");
  // Encode exact RGB primaries losslessly. A lavfi YUV color source plus a
  // BT.601/709 conversion introduces platform-dependent fixture quantization.
  const rgb = Buffer.alloc(64 * 64 * 3 * 60);
  for (let frame = 0; frame < 60; frame++) {
    for (let pixel = 0; pixel < 64 * 64; pixel++) {
      rgb[(frame * 64 * 64 + pixel) * 3 + (frame < 30 ? 0 : 2)] = 255;
    }
  }
  const encoded = spawnSync(
    "ffmpeg",
    [
      "-v", "error", "-y",
      "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "64x64",
      "-framerate", "30", "-i", "pipe:0",
      "-vf", "format=gbrp", "-pix_fmt", "gbrp",
      "-c:v", "libvpx-vp9", "-lossless", "1",
      "-colorspace", "rgb", "-color_primaries", "bt709",
      "-color_trc", "iec61966-2-1", "-color_range", "pc",
      "-an", videoPath,
    ],
    { input: rgb, encoding: "utf8" },
  );
  assert.equal(encoded.status, 0, encoded.stderr);
  for (const [time, expected] of [[0, [255, 0, 0, 255]], [1.5, [0, 0, 255, 255]]]) {
    const decoded = spawnSync("ffmpeg", [
      "-v", "error", "-ss", String(time), "-i", videoPath,
      "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1",
    ]);
    assert.equal(decoded.status, 0, decoded.stderr.toString());
    near(pixel(decoded.stdout, 32, 32), expected, 1);
  }
});
after(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

function document() {
  return {
    schemaVersion: 2,
    timebase: 240000,
    id: "doc",
    name: "渲染检查",
    revision: 0,
    assets: [
      { id: "source", name: "红蓝测试片", kind: "video", duration: 480000, width: 64, height: 64 },
    ],
    sequences: [
      {
        id: "main",
        name: "主序列",
        width: 128,
        height: 64,
        frameRate: { numerator: 30, denominator: 1 },
        background: "#000000",
        timelineMode: "free",
        tracks: [
          api.createTrack("lower", "video"),
          api.createTrack("upper", "video"),
          api.createTrack("words", "text"),
        ],
        clips: [],
        transitions: [],
        markers: [],
      },
    ],
    activeSequenceId: "main",
    exportProfiles: [],
  };
}
const visual = () => ({
  transform: api.defaultTransform(),
  color: api.defaultColorAdjustment(),
  blendMode: "normal",
});
function clip(id, trackId, sourceStart = 0) {
  return {
    id,
    label: id,
    kind: "media",
    trackId,
    start: 0,
    duration: 240000,
    assetId: "source",
    timeMap: api.constantTimeMap(sourceStart, sourceStart + 240000).timeMap,
    audio: api.defaultAudioMix(),
    ...visual(),
  };
}
const profile = (overrides = {}) => ({
  ...api.createExportPresets()[0],
  width: 128,
  height: 64,
  ...overrides,
});
async function renderer(t, doc, extra = {}) {
  const workDir = await mkdtemp(join(temporary, "job-"));
  const instance = await api.EditorFrameRenderer.create({
    document: doc,
    sequenceId: "main",
    profile: profile(),
    mediaFiles: new Map([["source", { path: videoPath, mimeType: "video/webm" }]]),
    runtimeSource,
    workDir,
    signal: new AbortController().signal,
    ...extra,
  });
  t.after(() => instance.close());
  return { instance, workDir };
}
function pixel(bytes, x, y) {
  const png = PNG.sync.read(bytes);
  return [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)];
}
const near = (actual, expected, epsilon = 5) =>
  actual.forEach((value, i) =>
    assert.ok(Math.abs(value - expected[i]) <= epsilon, `${actual} != ${expected}`),
  );

test("range encoding uses the original frame clock, sample crop and NTSC duration, including an empty sample interval", async () => {
  const doc = document(), media = clip("range-source", "lower");
  media.duration = 480000;
  media.timeMap = api.constantTimeMap(0, 480000).timeMap;
  doc.sequences[0].clips.push(media);
  const before = structuredClone(doc), workDir = await mkdtemp(join(temporary, "range-export-")),
    audioFile = join(workDir, "full.wav");
  const audio = spawnSync("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "aevalsrc='0.2*sin(2*PI*440*t)|0.2*sin(2*PI*440*t)':s=48000:d=2", "-ac", "2", "-c:a", "pcm_f32le", audioFile]);
  assert.equal(audio.status, 0, audio.stderr.toString());
  for (const [index, range] of [
    { start: 264001, duration: 80080 },
    { start: 264001, duration: 1 },
  ].entries()) {
    const outputPath = join(workDir, `range-${index}.mov`),
      output = await api.exportEditorSequence({
        document: doc, sequenceId: "main", range,
        profile: profile({ container: "mov", videoCodec: "prores", audioCodec: "pcm", audioBitrate: 1536000, frameRate: { numerator: 30000, denominator: 1001 } }),
        mediaFiles: new Map([["source", { path: videoPath, mimeType: "video/webm" }]]),
        runtimeSource, workDir, audioFile, outputPath, signal: new AbortController().signal,
      });
    assert.equal(output.frameCount, index ? 1 : 10);
    assert.equal(output.durationSeconds, (index ? 1 : 10) * 1001 / 30000);
    assert.deepEqual(output.range, range);
    const frame = spawnSync("ffmpeg", ["-v", "error", "-i", outputPath, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"]);
    assert.equal(frame.status, 0, frame.stderr.toString());
    near(pixel(frame.stdout, 64, 32), [0, 0, 255, 255], 8);
    const pcm = spawnSync("ffmpeg", ["-v", "error", "-i", outputPath, "-map", "0:a:0", "-f", "f32le", "-c:a", "pcm_f32le", "pipe:1"]);
    assert.equal(pcm.status, 0, pcm.stderr.toString());
    assert.equal(pcm.stdout.length / 8, Math.ceil(output.durationSeconds * 48000));
    const measure = await api.measureEditorExportAudioRange({ audioFile, range, ffmpegPath: "ffmpeg", signal: new AbortController().signal });
    assert.equal(measure.sampleCount, index ? 0 : 16016);
    if (index) {
      assert.equal(measure.peak, 0);
      assert.ok(pcm.stdout.every((byte) => byte === 0), "An interval containing no original sample encodes a silent audio track");
    } else {
      assert.ok(measure.peak > 0.19 && measure.peak < 0.21);
      const firstSample = Math.ceil(range.start / 5),
        expected = 0.2 * Math.sin(2 * Math.PI * 440 * firstSample / 48000);
      assert.ok(Math.abs(pcm.stdout.readFloatLE(0) - expected) < 0.00004);
      for (let sample = 16016; sample < pcm.stdout.length / 8; sample++)
        assert.equal(pcm.stdout.readFloatLE(sample * 8), 0, "The rounded final frame is padded with silence");
    }
  }
  assert.deepEqual(doc, before);
});
test(
  "59.94 WebM verifies tiny tail ranges and a normal range after container frame-period quantization",
  { timeout: 60000 },
  async () => {
    const doc = document(),
      media = clip("webm-tail", "lower");
    media.duration = 480000;
    media.timeMap = api.constantTimeMap(0, 480000).timeMap;
    doc.sequences[0].clips.push(media);
    const workDir = await mkdtemp(join(temporary, "webm-range-")),
      audioFile = join(workDir, "full.wav");
    const audio = spawnSync("ffmpeg", [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc='0.2*sin(2*PI*440*t)|0.2*sin(2*PI*440*t)':s=48000:d=2",
      "-ac",
      "2",
      "-c:a",
      "pcm_f32le",
      audioFile,
    ]);
    assert.equal(audio.status, 0, audio.stderr.toString());
    const settings = profile({
      container: "webm",
      videoCodec: "vp9",
      audioCodec: "opus",
      frameRate: { numerator: 60000, denominator: 1001 },
    });
    for (const [index, range] of [
      { start: 479999, duration: 1 },
      { start: 479995, duration: 1 },
      { start: 240001, duration: 239999 },
    ].entries()) {
      const output = await api.exportEditorSequence({
        document: doc,
        sequenceId: "main",
        range,
        profile: settings,
        mediaFiles: new Map([["source", { path: videoPath, mimeType: "video/webm" }]]),
        runtimeSource,
        workDir,
        audioFile,
        outputPath: join(workDir, `tail-${index}.webm`),
        signal: new AbortController().signal,
      });
      assert.equal(output.frameCount, index < 2 ? 1 : 60);
      assert.deepEqual(output.range, range);
      const pcm = spawnSync("ffmpeg", [
        "-v",
        "error",
        "-i",
        output.path,
        "-map",
        "0:a:0",
        "-f",
        "f32le",
        "-c:a",
        "pcm_f32le",
        "pipe:1",
      ]);
      assert.equal(pcm.status, 0, pcm.stderr.toString());
      assert.ok(pcm.stdout.length > 0);
      if (!index)
        assert.ok(
          pcm.stdout.every((byte) => byte === 0),
          "A zero-sample range stays silent after Opus encoding",
        );
      const frame = spawnSync("ffmpeg", [
        "-v",
        "error",
        "-i",
        output.path,
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "pipe:1",
      ]);
      assert.equal(frame.status, 0, frame.stderr.toString());
      near(pixel(frame.stdout, 64, 32), [0, 0, 255, 255], 8);
    }
  },
);
test(
  "low-quality real-media previews match original native export composition and never change export dimensions",
  { timeout: 60000 },
  async (t) => {
    const doc = document(),
      rootSequence = doc.sequences[0];
    rootSequence.width = 640;
    rootSequence.height = 360;
    rootSequence.background = "#182a37";
    const child = {
      ...structuredClone(rootSequence),
      id: "child",
      width: 320,
      height: 180,
      clips: [],
    };
    const left = clip("left", "lower"),
      right = clip("right", "upper", 240000);
    for (const [item, sourceStart] of [
      [left, 0],
      [right, 240000],
    ]) {
      item.duration = 8000;
      item.timeMap = api.constantTimeMap(sourceStart, sourceStart + 8000).timeMap;
    }
    left.transform = { ...left.transform, fit: "stretch", scaleX: 0.5, x: -0.25 };
    right.transform = { ...right.transform, fit: "stretch", scaleX: 0.5, x: 0.25 };
    child.clips.push(left, right);
    doc.sequences.push(child);
    rootSequence.clips = [
      {
        id: "nested",
        label: "真实嵌套",
        kind: "sequence",
        sequenceId: "child",
        trackId: "lower",
        start: 0,
        duration: 8000,
        timeMap: api.constantTimeMap(0, 8000).timeMap,
        audio: api.defaultAudioMix(),
        ...visual(),
        transform: {
          ...api.defaultTransform(),
          scaleX: 0.8,
          scaleY: 0.8,
          x: 0.1,
          y: -0.05,
          rotation: 7,
        },
        mask: {
          kind: "rectangle",
          x: 0,
          y: 0,
          width: 0.9,
          height: 0.8,
          rotation: 0,
          feather: 0.03,
          inverted: false,
        },
      },
    ];
    const original = JSON.stringify(doc);
    const compiled = await build({
      stdin: {
        resolveDir: root,
        contents: `export {EditorPreview} from './apps/video-studio/src/editor/preview';`,
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      globalName: "qualityApi",
    });
    const source = await readFile(videoPath);
    const server = createServer((request, response) => {
      response.setHeader("Content-Type", request.url === "/source" ? "video/webm" : "text/html");
      if (request.url !== "/source") return response.end("<!doctype html><canvas></canvas>");
      response.setHeader("Accept-Ranges", "bytes");
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
      const start = range ? Number(range[1]) : 0,
        end = range?.[2] ? Number(range[2]) : source.length - 1;
      if (range) {
        response.statusCode = 206;
        response.setHeader("Content-Range", `bytes ${start}-${end}/${source.length}`);
      }
      response.setHeader("Content-Length", end - start + 1);
      response.end(source.subarray(start, end + 1));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const browserPath = await api.findCaptionBrowser(),
      browser = await chromium.launch({ headless: true, executablePath: browserPath });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.addScriptTag({ content: compiled.outputFiles[0].text });
    const previews = await page.evaluate(async (doc) => {
      const canvas = document.querySelector("canvas"),
        preview = new qualityApi.EditorPreview(canvas, {
          resolveAsset: () => new URL("/source", location.href).href,
        });
      preview.setDocument(doc);
      await preview.seek(0);
      const frames = [{ quality: 1, bytes: canvas.toDataURL().split(",")[1] }];
      for (const quality of [0.5, 0.25, 1]) {
        await preview.setResolution(quality);
        frames.push({ quality, bytes: canvas.toDataURL().split(",")[1] });
      }
      await preview.dispose();
      return frames;
    }, doc);
    const workDir = await mkdtemp(join(temporary, "quality-export-")),
      settings = profile({ width: 640, height: 360, quality: { mode: "quality", value: 100 } });
    const mediaFiles = new Map([["source", { path: videoPath, mimeType: "video/webm" }]]);
    const native = await api.EditorFrameRenderer.create({
      document: doc,
      sequenceId: "main",
      profile: settings,
      mediaFiles,
      runtimeSource,
      workDir,
      browserPath,
      signal: new AbortController().signal,
    });
    t.after(() => native.close());
    const originalFrame = PNG.sync.read(await native.render(0));
    await native.close();
    const originalPreview = PNG.sync.read(Buffer.from(previews[0].bytes, "base64"));
    assert.deepEqual([originalFrame.width, originalFrame.height], [640, 360]);
    assert.equal(Buffer.compare(originalFrame.data, originalPreview.data), 0);
    assert.equal(
      previews.at(-1).bytes,
      previews[0].bytes,
      "Restoring Original redraws identical full-resolution pixels",
    );
    const audioFile = join(workDir, "silence.wav"),
      outputPath = join(workDir, "quality.mp4");
    const silence = spawnSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=stereo",
      "-af",
      "atrim=end_sample=1600",
      "-c:a",
      "pcm_f32le",
      audioFile,
    ]);
    assert.equal(silence.status, 0, silence.stderr.toString());
    const exported = await api.exportEditorSequence({
      document: doc,
      sequenceId: "main",
      profile: settings,
      mediaFiles,
      runtimeSource,
      workDir,
      outputPath,
      audioFile,
      browserPath,
      signal: new AbortController().signal,
    });
    assert.equal(exported.frameCount, 1);
    const decoded = spawnSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      outputPath,
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-vcodec",
      "png",
      "pipe:1",
    ]);
    assert.equal(decoded.status, 0, decoded.stderr.toString());
    const movie = PNG.sync.read(decoded.stdout);
    assert.deepEqual([movie.width, movie.height], [640, 360]);
    for (const frame of previews) {
      const preview = PNG.sync.read(Buffer.from(frame.bytes, "base64"));
      assert.deepEqual([preview.width, preview.height], [640 * frame.quality, 360 * frame.quality]);
      for (const [x, y] of [
        [0.35, 0.5],
        [0.75, 0.5],
        [0.05, 0.05],
      ]) {
        const at = (image) => [
          ...image.data.subarray(
            (Math.floor(y * image.height) * image.width + Math.floor(x * image.width)) * 4,
            (Math.floor(y * image.height) * image.width + Math.floor(x * image.width)) * 4 + 4,
          ),
        ];
        near(at(preview), at(movie), 6);
      }
    }
    assert.equal(JSON.stringify(doc), original);
  },
);

test("native frame rendering independently seeks one source twice, including backwards seeks", async (t) => {
  const doc = document(),
    seq = doc.sequences[0];
  const left = clip("left", "lower"),
    right = clip("right", "upper", 240000);
  left.transform = { ...left.transform, fit: "stretch", scaleX: 0.5, x: -0.25 };
  right.transform = { ...right.transform, fit: "stretch", scaleX: 0.5, x: 0.25 };
  seq.clips.push(left, right);
  const { instance, workDir } = await renderer(t, doc);
  for (const time of [0, 180000, 8000]) {
    const bytes = await instance.render(time);
    near(pixel(bytes, 32, 32), [255, 0, 0, 255]);
    near(pixel(bytes, 96, 32), [0, 0, 255, 255]);
  }
  await assert.rejects(instance.render(240000), /超出序列/);
  // The server only exposes immutable registered files at unguessable routes.
  assert.equal((await fetch(instance.origin + "/etc/passwd")).status, 404);
  assert.equal(
    (
      await fetch(instance.origin + instance.base + "/media/0", {
        headers: { Origin: "https://example.invalid" },
      })
    ).status,
    403,
  );
  const range = await fetch(instance.origin + instance.base + "/media/0", {
    headers: { Range: "bytes=0-31" },
  });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 32);
  await instance.close();
  assert.deepEqual(await readdir(workDir), []);
});

test("native dissolve uses the same premultiplied endpoint blend and preserves export letterboxing", async (t) => {
  const doc = document(),
    seq = doc.sequences[0];
  const from = clip("from", "lower"),
    to = clip("to", "lower", 240000);
  from.transform.fit = to.transform.fit = "stretch";
  to.start = 120000;
  seq.clips.push(from, to);
  seq.transitions.push({
    id: "dissolve",
    fromClipId: "from",
    toClipId: "to",
    start: 120000,
    duration: 120000,
    kind: "dissolve",
  });
  const { instance } = await renderer(t, doc, { profile: profile({ width: 128, height: 128 }) });
  const bytes = await instance.render(180000);
  near(pixel(bytes, 64, 64), [128, 0, 128, 255]);
  near(pixel(bytes, 64, 10), [0, 0, 0, 255]);
});

test("native text, manual masks and grading reach rendered pixels and caption exclusion is honored", async (t) => {
  const doc = document(),
    seq = doc.sequences[0];
  const picture = clip("picture", "lower");
  picture.transform.fit = "stretch";
  picture.mask = {
    kind: "rectangle",
    x: -0.25,
    y: 0,
    width: 0.5,
    height: 1,
    rotation: 0,
    feather: 0,
    inverted: false,
  };
  picture.color.exposure = -1;
  const title = {
    id: "title",
    label: "字幕",
    kind: "text",
    role: "subtitle",
    trackId: "words",
    start: 0,
    duration: 240000,
    text: "你好\n世界",
    style: { ...api.defaultTextStyle(), fontSize: 16, color: "#ffffff" },
    words: [],
    ...visual(),
  };
  seq.clips.push(picture, title);
  const enabled = await renderer(t, doc);
  const omitted = await renderer(t, doc, { profile: profile({ includeCaptions: false }) });
  const a = await enabled.instance.render(0),
    b = await omitted.instance.render(0);
  near(pixel(b, 16, 32), [128, 0, 0, 255]);
  near(pixel(b, 112, 32), [0, 0, 0, 255]);
  assert.notDeepEqual(PNG.sync.read(a).data, PNG.sync.read(b).data);
});

test("missing media fails clearly and cancellation closes the independent renderer", async (t) => {
  const doc = document();
  doc.sequences[0].clips.push(clip("picture", "lower"));
  const missing = await renderer(t, doc, { mediaFiles: new Map() });
  await assert.rejects(missing.instance.render(0), /无法读取素材资源/);
  assert.deepEqual(await readdir(missing.workDir), []);
  const controller = new AbortController();
  const { instance, workDir } = await renderer(t, doc, { signal: controller.signal });
  controller.abort();
  await assert.rejects(instance.render(0), { name: "AbortError" });
  await instance.close();
  assert.deepEqual(await readdir(workDir), []);
});

test("programmatic demo scenes stay renderable without a media file", async (t) => {
  const doc = document();
  doc.assets[0] = {
    id: "source",
    name: "示例",
    kind: "demo",
    duration: 480000,
    width: 1280,
    height: 720,
  };
  doc.sequences[0].clips.push(clip("demo", "lower"));
  const { instance } = await renderer(t, doc, { mediaFiles: new Map() });
  const bytes = await instance.render(120000);
  assert(PNG.sync.read(bytes).data.some((value, i) => i % 4 !== 3 && value !== 0));
});

test("shared frames become a verified NTSC MP4 with stereo audio and no intermediate frame files", async (t) => {
  const doc = document(),
    picture = clip("picture", "lower");
  picture.transform.fit = "stretch";
  doc.sequences[0].clips.push(picture);
  const workDir = await mkdtemp(join(temporary, "export-"));
  const audioFile = join(workDir, "mix.wav"),
    outputPath = join(workDir, "result.mp4");
  const audio = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=1",
      "-ac",
      "2",
      "-c:a",
      "pcm_f32le",
      audioFile,
    ],
    { encoding: "utf8" },
  );
  assert.equal(audio.status, 0, audio.stderr);
  const progress = [];
  const result = await api.exportEditorSequence({
    document: doc,
    sequenceId: "main",
    profile: profile({ frameRate: { numerator: 30000, denominator: 1001 } }),
    mediaFiles: new Map([["source", { path: videoPath, mimeType: "video/webm" }]]),
    runtimeSource,
    workDir,
    audioFile,
    outputPath,
    signal: new AbortController().signal,
    onProgress: (value) => progress.push(value),
  });
  assert.equal(result.path, outputPath);
  assert.equal(result.frameCount, 30);
  assert.equal(result.durationSeconds, 1.001);
  assert.equal(
    result.probe.streams.find((stream) => stream.codec_type === "video").avg_frame_rate,
    "30000/1001",
  );
  assert.equal(result.probe.streams.find((stream) => stream.codec_type === "audio").channels, 2);
  assert.equal(progress.at(-1).phase, "verify");
  assert.deepEqual((await readdir(workDir)).sort(), ["mix.wav", "result.mp4"]);
  const extracted = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-i",
    outputPath,
    "-frames:v",
    "1",
    "-f",
    "image2pipe",
    "-vcodec",
    "png",
    "pipe:1",
  ]);
  assert.equal(extracted.status, 0, extracted.stderr.toString());
  near(pixel(extracted.stdout, 64, 32), [255, 0, 0, 255], 8);
});

test("short exports drain the complete audible mix and retain exactly the produced frames", async () => {
  for (const frames of [1, 30, 75]) {
    const doc = document();
    doc.assets = [];
    doc.sequences[0].clips = [{
      id: "title", label: "title", kind: "text", role: "title", trackId: "words",
      start: 0, duration: frames * 8000, text: "Audio", words: [],
      style: api.defaultTextStyle(), ...visual(),
    }];
    const workDir = await mkdtemp(join(temporary, "audio-drain-"));
    const audioFile = join(workDir, "mix.wav");
    const sampleCount = frames * 1600;
    const tone = spawnSync("ffmpeg", [
      "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-af", `atrim=end_sample=${sampleCount}`, "-ac", "2", "-c:a", "pcm_f32le", audioFile,
    ]);
    assert.equal(tone.status, 0, tone.stderr.toString());
    const result = await api.exportEditorSequence({
      document: doc, sequenceId: "main", profile: profile(), mediaFiles: new Map(),
      runtimeSource, workDir, audioFile, outputPath: join(workDir, "result.mp4"),
      signal: new AbortController().signal,
    });
    const video = result.probe.streams.find((stream) => stream.codec_type === "video");
    const audio = result.probe.streams.find((stream) => stream.codec_type === "audio");
    assert.equal(Number(video.nb_frames), frames);
    assert.ok(Math.abs(Number(audio.duration) - frames / 30) < 0.001);
    const decoded = spawnSync("ffmpeg", [
      "-v", "error", "-i", result.path, "-map", "0:a:0", "-f", "f32le",
      "-ar", "48000", "-ac", "2", "pipe:1",
    ]);
    assert.equal(decoded.status, 0, decoded.stderr.toString());
    assert.ok(decoded.stdout.length >= sampleCount * 8, "The entire mix must be decodable");
    // AAC may pad the last packet. Inspect the end of the intended content,
    // not padding, and require audible samples rather than just an audio header.
    let energy = 0;
    for (let i = sampleCount - 800; i < sampleCount; i++)
      energy += decoded.stdout.readFloatLE(i * 8) ** 2;
    assert.ok(Math.sqrt(energy / 800) > 0.03, "The final audio must not be lost or silent");
    assert.deepEqual((await readdir(workDir)).sort(), ["mix.wav", "result.mp4"]);
  }
});

test("keyword styles persist through real IndexedDB undo/reopen and interactive preview matches native frames and encoded video", async (t) => {
  const doc = document();
  doc.assets = [];
  const seq = doc.sequences[0];
  seq.width = 320;
  seq.height = 180;
  seq.clips = [
    {
      id: "title",
      label: "关键词字幕",
      kind: "text",
      role: "subtitle",
      trackId: "words",
      start: 0,
      duration: 240000,
      text: "重点 其他\n重点",
      words: [
        { text: "重点", start: 0, end: 120000 },
        { text: "其他", start: 120000, end: 240000 },
      ],
      style: {
        ...api.defaultTextStyle(),
        fontSize: 32,
        strokeWidth: 0,
        highlightColor: "#00ffff",
        animation: "word-highlight",
      },
      ...visual(),
    },
  ];
  const compiled = await build({
    stdin: {
      contents: `export {EditorPreview} from './apps/video-studio/src/editor/preview'; export {EditorSession} from './apps/video-studio/src/editor/session'; export {createEditorHostStorage} from './apps/video-studio/src/editor/host-storage'; export {planCaptionStyle} from './apps/video-studio/src/editor/captions';`,
      resolveDir: root,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    globalName: "keywordApi",
  });
  const server = createServer((_req, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><canvas id="preview"></canvas>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browserPath = await api.findCaptionBrowser();
  const browser = await chromium.launch({ headless: true, executablePath: browserPath });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.addScriptTag({ content: compiled.outputFiles[0].text });
  const persisted = await page.evaluate(async (doc) => {
    const storage = keywordApi.createEditorHostStorage(undefined, {
      persistent: true,
      scopeKey: "keywords",
    });
    let session = await keywordApi.EditorSession.open(storage, {
      initialDocument: doc,
      autosaveDelayMs: 60000,
    });
    const patch = { keywords: [{ text: "重点", color: "#ffff00" }] };
    await session.dispatchDurable(
      keywordApi.planCaptionStyle(session.read(), "main", ["title"], patch),
      session.getState().identity,
      "强调关键词",
    );
    session.undo();
    const removed = session.read().sequences[0].clips[0].style.keywords === undefined;
    session.redo();
    await session.close();
    session = await keywordApi.EditorSession.open(
      keywordApi.createEditorHostStorage(undefined, { persistent: true, scopeKey: "keywords" }),
    );
    const restored = session.read();
    const canvas = document.querySelector("canvas");
    const preview = new keywordApi.EditorPreview(canvas, {
      resolveAsset: () => {
        throw new Error("No media expected");
      },
    });
    preview.setDocument(restored);
    const frames = [];
    for (const time of [24000, 168000]) {
      await preview.seek(time);
      frames.push(canvas.toDataURL("image/png").split(",")[1]);
    }
    preview.dispose();
    await session.close();
    return { restored, frames, removed };
  }, doc);
  assert.equal(persisted.removed, true);
  assert.deepEqual(persisted.restored.sequences[0].clips[0].style.keywords, [
    { text: "重点", color: "#ffff00" },
  ]);
  const workDir = await mkdtemp(join(temporary, "keywords-")),
    settings = profile({ width: 320, height: 180, quality: { mode: "quality", value: 100 } });
  const native = await api.EditorFrameRenderer.create({
    document: persisted.restored,
    sequenceId: "main",
    profile: settings,
    mediaFiles: new Map(),
    runtimeSource,
    workDir,
    signal: new AbortController().signal,
    browserPath,
  });
  t.after(() => native.close());
  for (const [index, time] of [24000, 168000].entries()) {
    const rendered = PNG.sync.read(await native.render(time));
    const preview = PNG.sync.read(Buffer.from(persisted.frames[index], "base64"));
    assert.equal(
      Buffer.compare(rendered.data, preview.data),
      0,
      "Interactive preview and independent native renderer must share exact keyword pixels",
    );
  }
  await native.close();
  const outputPath = join(workDir, "keywords.mp4");
  const audioFile = join(workDir, "silent.wav");
  const silence = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=48000:cl=stereo",
    "-t",
    "1",
    "-c:a",
    "pcm_f32le",
    audioFile,
  ]);
  assert.equal(silence.status, 0, silence.stderr.toString());
  const exported = await api.exportEditorSequence({
    document: persisted.restored,
    sequenceId: "main",
    profile: settings,
    mediaFiles: new Map(),
    runtimeSource,
    workDir,
    outputPath,
    audioFile,
    browserPath,
    signal: new AbortController().signal,
  });
  assert.equal(exported.frameCount, 30);
  for (const time of [0.1, 0.7]) {
    const decoded = spawnSync("ffmpeg", [
      "-v",
      "error",
      "-ss",
      String(time),
      "-i",
      outputPath,
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-vcodec",
      "png",
      "pipe:1",
    ]);
    assert.equal(decoded.status, 0, decoded.stderr.toString());
    const data = PNG.sync.read(decoded.stdout).data;
    let yellow = 0,
      cyan = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 210 && data[i + 1] > 210 && data[i + 2] < 40) yellow++;
      if (data[i] < 40 && data[i + 1] > 210 && data[i + 2] > 210) cyan++;
    }
    assert.ok(
      yellow > 40 && cyan > 40,
      `Decoded ${time}s keyword and active-word colors: ${yellow}, ${cyan}`,
    );
  }
});

test("cancelling streamed encoding removes its incomplete output and closes render resources", async () => {
  const doc = document();
  doc.sequences[0].clips.push(clip("picture", "lower"));
  const workDir = await mkdtemp(join(temporary, "cancel-export-"));
  const audioFile = join(workDir, "mix.wav");
  const audio = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=stereo",
      "-t",
      "1",
      "-c:a",
      "pcm_s16le",
      audioFile,
    ],
    { encoding: "utf8" },
  );
  assert.equal(audio.status, 0, audio.stderr);
  for (const range of [undefined, { start: 80085, duration: 80080 }]) {
    const controller = new AbortController();
    await assert.rejects(
      api.exportEditorSequence({
        document: doc,
        sequenceId: "main",
        range,
        profile: profile(),
        mediaFiles: new Map([["source", { path: videoPath, mimeType: "video/webm" }]]),
        runtimeSource,
        workDir,
        audioFile,
        outputPath: join(workDir, "cancelled.mp4"),
        signal: controller.signal,
        onProgress(value) {
          if (value.phase === "render" && value.completedFrames === 2) controller.abort();
        },
      }),
      { name: "AbortError" },
    );
    assert.deepEqual(await readdir(workDir), ["mix.wav"]);
  }
});
