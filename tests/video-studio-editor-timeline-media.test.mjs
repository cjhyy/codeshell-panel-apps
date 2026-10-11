import assert from "node:assert/strict";
import test, { before, after, beforeEach } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, realpath, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
let browser, page, server, dir, origin, waveform, reversedWaveform;
const root = fileURLToPath(new URL("../", import.meta.url));
const ff = (args) => {
  const r = spawnSync("ffmpeg", ["-nostdin", "-v", "error", ...args]);
  assert.equal(r.status, 0, r.stderr.toString());
};
before(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "timeline-media-")));
  const video = join(dir, "source.mp4");
  ff([
    "-f",
    "lavfi",
    "-i",
    "color=red:s=128x72:r=20:d=1",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=128x72:r=20:d=1",
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1:a=0[out]",
    "-map",
    "[out]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    video,
  ]);
  const audio = join(dir, "audio.wav");
  ff([
    "-f",
    "lavfi",
    "-i",
    String.raw`aevalsrc=if(lt(t\,1)\,0\,0.5*sin(2*PI*1000*t)):s=48000:d=2`,
    "-c:a",
    "pcm_f32le",
    audio,
  ]);
  const reversedVideo = join(dir, "reversed.mp4"),
    reversedAudio = join(dir, "reversed.wav");
  ff(["-i", video, "-vf", "reverse", "-c:v", "libx264", "-pix_fmt", "yuv420p", reversedVideo]);
  ff(["-i", audio, "-af", "areverse", "-c:a", "pcm_f32le", reversedAudio]);
  await mkdir(join(dir, "cache"));
  await mkdir(join(dir, "pcm"));
  await build({
    stdin: {
      resolveDir: root,
      contents: `export * from './apps/video-studio/native/editor-runtime/waveform.ts';export * from './apps/video-studio/native/editor-runtime/runtime.ts';`,
    },
    bundle: true,
    platform: "node",
    banner: {
      js: 'import {createRequire as __panelCreateRequire} from "node:module";const require=__panelCreateRequire(import.meta.url);',
    },
    format: "esm",
    outfile: join(dir, "native.mjs"),
  });
  const native = await import(pathToFileURL(join(dir, "native.mjs")));
  const result = await native.analyzeEditorWaveform({
    input: audio,
    sourceDuration: 480000,
    cacheDir: join(dir, "cache"),
    pcmCacheDir: join(dir, "pcm"),
    ffmpegPath: "ffmpeg",
    ffprobePath: "ffprobe",
    signal: new AbortController().signal,
  });
  waveform = JSON.parse(await readFile(result.path, "utf8"));
  const reversed = await native.analyzeEditorWaveform({
    input: reversedAudio,
    sourceDuration: 480000,
    cacheDir: join(dir, "cache"),
    pcmCacheDir: join(dir, "pcm"),
    ffmpegPath: "ffmpeg",
    ffprobePath: "ffprobe",
    signal: new AbortController().signal,
  });
  reversedWaveform = JSON.parse(await readFile(reversed.path, "utf8"));
  const prores = join(dir, "camera.mov");
  ff(["-i", video, "-c:v", "prores_ks", "-profile:v", "1", "-pix_fmt", "yuv422p10le", prores]);
  const sourceBytes = await readFile(prores),
    sourceHash = createHash("sha256").update(sourceBytes).digest("hex"),
    jobDir = join(dir, "proxy-job"),
    runtimeDir = join(dir, "runtime");
  await mkdir(jobDir);
  await mkdir(join(jobDir, "inputs"));
  await mkdir(runtimeDir);
  await writeFile(join(jobDir, "inputs", "resource-0.bin"), sourceBytes);
  const prepared = await native.runEditorRequest(
    {
      action: "prepare-source-video",
      transferId: `editor-${randomUUID()}`,
      resourceIds: [`asset-${sourceHash}`],
      sourceDuration: 480000,
    },
    {
      jobDir,
      runtimeDir,
      scopeKey: "e".repeat(64),
      jobId: "proxy-job",
      signal: new AbortController().signal,
      runtimeSource: "",
      runtimeSha: "0".repeat(64),
      reportProgress: () => {},
    },
  );
  const proxyBytes = await readFile(join(jobDir, prepared.artifacts[0].file));
  const originalBytes = await readFile(video);
  const reversedBytes = await readFile(reversedVideo);
  server = createServer((req, res) => {
    if (["/source.mp4", "/proxy.mp4", "/reversed.mp4"].includes(req.url)) {
      const bytes =
        req.url === "/proxy.mp4"
          ? proxyBytes
          : req.url === "/reversed.mp4"
            ? reversedBytes
            : originalBytes;
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Accept-Ranges", "bytes");
      const match = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
      if (match) {
        const start = Number(match[1]),
          end = match[2] ? Number(match[2]) : bytes.length - 1;
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
          "Content-Length": end - start + 1,
        });
        res.end(bytes.subarray(start, end + 1));
      } else {
        res.setHeader("Content-Length", bytes.length);
        res.end(bytes);
      }
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><html><body><main id="mount"></main></body></html>');
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const bundle = await build({
    stdin: {
      resolveDir: root,
      contents: `export * from './apps/video-studio/src/editor/timeline-media.ts';export * from './apps/video-studio/src/editor/timeline-ui.ts';export * from './apps/video-studio/src/editor/defaults.ts';export * from './apps/video-studio/src/editor/waveform.ts';export * from './apps/video-studio/src/editor/audio-plan.ts';export {EditorHistory} from './apps/video-studio/src/editor/history.ts';export {EditorWorkspace} from './apps/video-studio/src/editor/workspace-ui.ts';export {EditorSession} from './apps/video-studio/src/editor/session.ts';`,
    },
    bundle: true,
    format: "iife",
    globalName: "api",
    write: false,
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 900, height: 650 } });
  page.setDefaultTimeout(10000);
  await page.goto(origin);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.addStyleTag({
    content: `*{box-sizing:border-box}body{margin:0;background:#10151b}#mount{width:900px;height:620px}${(await Promise.all(["editor-timeline.css", "editor-workspace.css", "editor-inspector.css", "editor-timing.css", "editor-markers.css"].map((name) => readFile(join(root, "apps/video-studio/public", name), "utf8")))).join("\n")}`,
  });
  await page.evaluate(
    ({ origin, waveform, reversedWaveform }) => {
      globalThis.wave = api.decodeEditorWaveform(waveform);
      globalThis.reversedWave = api.decodeEditorWaveform(reversedWaveform);
      globalThis.sourceUrl = origin + "/source.mp4";
      globalThis.fixture = () => {
        const clip = (id, start = 0, trackId = "v") => ({
          id,
          kind: "media",
          label: id,
          assetId: "asset",
          start,
          duration: 480000,
          trackId,
          timeMap: {
            points: [
              { time: 0, source: 0 },
              { time: 480000, source: 480000 },
            ],
          },
          audio: api.defaultAudioMix(),
          transform: api.defaultTransform(),
          color: api.defaultColorAdjustment(),
          blendMode: "normal",
        });
        return {
          schemaVersion: 2,
          timebase: 240000,
          id: "doc",
          revision: 0,
          name: "媒体预览",
          activeSequenceId: "main",
          assets: [
            {
              id: "asset",
              name: "红蓝镜头",
              kind: "video",
              duration: 480000,
              width: 128,
              height: 72,
            },
          ],
          exportProfiles: [],
          sequences: [
            {
              id: "main",
              name: "主序列",
              width: 128,
              height: 72,
              frameRate: { numerator: 30, denominator: 1 },
              background: "#000000",
              timelineMode: "free",
              tracks: [api.createTrack("v", "video")],
              clips: [clip("a")],
              transitions: [],
              markers: [],
            },
          ],
        };
      };
      globalThis.reset = () => {
        globalThis.workspace?.dispose();
        globalThis.timeline?.dispose();
        globalThis.media?.dispose();
        document.querySelector("#mount").replaceChildren();
        document.querySelector("#mount").className = "";
        globalThis.doc = fixture();
        globalThis.mediaGeneration = 1;
        globalThis.requests = [];
        globalThis.errors = [];
        globalThis.media = new api.EditorTimelineMedia({
          resolveAsset: async (id, signal) => {
            requests.push({ kind: "video", id });
            return sourceUrl;
          },
          loadWaveform: async (id, signal) => {
            requests.push({ kind: "audio", id });
            return wave;
          },
          onError: (e) => errors.push(e.message),
        });
      };
      globalThis.draw = async (ids = ["a"], { width = 288, start = 0, end = 480000 } = {}) => {
        const strips = ids.map((id) => {
          const canvas = document.createElement("canvas");
          canvas.dataset.clip = id;
          document.querySelector("#mount").appendChild(canvas);
          return { clipId: id, canvas, localStart: start, localEnd: end, width, height: 32 };
        });
        await media.render(doc, "main", strips, {
          documentId: doc.id,
          generation: mediaGeneration,
          revision: doc.revision,
        });
        return strips.map((s) => s.canvas.dataset.etMediaState);
      };
      globalThis.pixel = (id, x, y) =>
        Array.from(
          document
            .querySelector(`canvas[data-clip="${id}"]`)
            .getContext("2d")
            .getImageData(x, y, 1, 1).data,
        );
      globalThis.mountWorkspace = async ({ blocked = false } = {}) => {
        media.dispose();
        globalThis.timelineResource = sourceUrl;
        globalThis.timelineWave = wave;
        globalThis.timelineBlocked = blocked;
        globalThis.session = await api.EditorSession.open({
          read: async () => ({ data: structuredClone(doc), revision: 0 }),
          write: async () => ({ revision: 1 }),
          backupLegacy: async () => {},
        });
        globalThis.workspace = new api.EditorWorkspace(document.querySelector("#mount"), {
          session,
          resolveAsset: () => sourceUrl,
          timelineMedia: {
            resolveAsset: () => {
              requests.push({ kind: "video", url: timelineResource });
              if (timelineBlocked) throw new Error("素材待重新连接");
              return timelineResource;
            },
            loadWaveform: async () => {
              requests.push({ kind: "audio" });
              if (timelineBlocked) throw new Error("波形素材待重新连接");
              return timelineWave;
            },
            onError: (error) => errors.push(error.message),
          },
          importMedia: () => {},
          openProject: () => {},
          newProject: () => {},
          downloadProject: () => {},
          showProduction: () => {},
          onError: (error) => errors.push(error.message),
        });
      };
      globalThis.timelinePixel = (x = 20, y = 8) =>
        Array.from(
          document
            .querySelector('[data-et-clip="a"] canvas')
            .getContext("2d")
            .getImageData(x, y, 1, 1).data,
        );
      globalThis.timelineWavePixels = () => {
        const canvas = document.querySelector('[data-et-clip="a"] canvas'),
          pixels = canvas.getContext("2d").getImageData(20, 0, 1, canvas.height).data;
        let count = 0;
        for (let y = Math.floor(canvas.height * 0.55); y < canvas.height; y++)
          if (pixels[y * 4] < 190 && pixels[y * 4 + 1] > 100 && pixels[y * 4 + 2] > 100) count++;
        return count;
      };
    },
    { origin, waveform, reversedWaveform },
  );
});
after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => page.evaluate(() => reset()));
const pixel = (id, x, y = 8) => page.evaluate(({ id, x, y }) => pixel(id, x, y), { id, x, y });
const red = (p) => p[0] > 180 && p[2] < 70,
  blue = (p) => p[2] > 180 && p[0] < 70;
test("actual source thumbnails sample across the visible clip and distinguish same-source instances", async () => {
  const states = await page.evaluate(async () => {
    const b = structuredClone(doc.sequences[0].clips[0]);
    b.id = "b";
    b.trackId = "v2";
    b.timeMap.points = [
      { time: 0, source: 480000 },
      { time: 480000, source: 0 },
    ];
    doc.sequences[0].tracks.push(api.createTrack("v2", "video"));
    doc.sequences[0].clips.push(b);
    return draw(["a", "b"]);
  });
  assert.deepEqual(states, ["ready", "ready"], JSON.stringify(await page.evaluate(() => errors)));
  assert.ok(red(await pixel("a", 20)));
  assert.ok(blue(await pixel("a", 230)));
  assert.ok(blue(await pixel("b", 20)));
  assert.ok(red(await pixel("b", 230)));
  assert.deepEqual(await page.evaluate(() => errors), []);
});
test("piecewise speed and freeze map visible source frames, while hold audio envelope is silent", async () => {
  await page.evaluate(async () => {
    doc.sequences[0].clips[0].timeMap.points = [
      { time: 0, source: 0 },
      { time: 120000, source: 360000 },
      { time: 480000, source: 360000 },
    ];
    await draw();
  });
  assert.ok(red(await pixel("a", 20)));
  assert.ok(blue(await pixel("a", 100)));
  assert.ok(blue(await pixel("a", 250)));
  const y = await page.evaluate(() => {
    const lane = api.compileAudioPlan(doc, "main").lanes[0];
    return [
      api.timelineWaveformEnvelope(lane, wave, 0, 100000),
      api.timelineWaveformEnvelope(lane, wave, 130000, 470000),
    ];
  });
  assert.ok(y[0].max > 0.34);
  assert.deepEqual(y[1], { min: 0, max: 0 });
});
test("real decoded audio maps silence and tone through reverse, and visible volume keyframes use 0–400 percent", async () => {
  await page.evaluate(async () => {
    doc.assets[0].kind = "audio";
    delete doc.assets[0].width;
    delete doc.assets[0].height;
    doc.sequences[0].tracks[0].kind = "audio";
    const clip = doc.sequences[0].clips[0];
    clip.timeMap.points = [
      { time: 0, source: 480000 },
      { time: 480000, source: 0 },
    ];
    clip.audio.volume = {
      keyframes: [
        { time: 0, value: 0, easing: "linear" },
        { time: 480000, value: 4, easing: "linear" },
      ],
    };
    await draw();
  });
  const values = await page.evaluate(() => {
    const lane = api.compileAudioPlan(doc, "main").lanes[0];
    return [
      api.timelineWaveformEnvelope(lane, wave, 0, 200000),
      api.timelineWaveformEnvelope(lane, wave, 280000, 480000),
    ];
  });
  assert.ok(values[0].max > 0.34);
  assert.deepEqual(values[1], { min: 0, max: 0 });
  const left = await pixel("a", 30, 12),
    right = await pixel("a", 250, 12);
  assert.ok(left[2] > 120 && left[3] > 0);
  assert.equal(right[3], 0);
  for (const [x, y] of [
    [0, 30],
    [144, 16],
    [287, 2],
  ]) {
    const color = await pixel("a", x, y);
    assert.ok(color[0] > 140 && color[1] > 140, JSON.stringify({ x, y, color }));
  }
});
test("thumbnail caching is bounded and overlapping visible-window scroll reuses decoded tiles", async () => {
  await page.evaluate(async () => {
    await draw();
    globalThis.before = media.stats;
    await draw(["a"], { width: 216, start: 120000, end: 480000 });
  });
  assert.equal(await page.evaluate(() => media.stats.thumbnails), 4);
  assert.equal(await page.evaluate(() => requests.filter((r) => r.kind === "audio").length), 1);
  await page.evaluate(async () => {
    for (let i = 0; i < 6; i++)
      await draw(["a"], { width: 2048, start: i * 100, end: 480000 - i * 100 });
  });
  assert.ok((await page.evaluate(() => media.stats.thumbnails)) <= 160);
});
test("restoring a same-id same-revision document refreshes real thumbnail pixels", async () => {
  await page.evaluate(async () => {
    await draw();
    globalThis.beforeRestore = pixel("a", 20, 8);
    document.querySelector("#mount").replaceChildren();
    doc = fixture();
    mediaGeneration++;
    doc.sequences[0].clips[0].timeMap.points = [
      { time: 0, source: 480000 },
      { time: 480000, source: 0 },
    ];
    await draw();
  });
  assert.ok(red(await page.evaluate(() => beforeRestore)));
  assert.ok(blue(await pixel("a", 20)), JSON.stringify(await pixel("a", 20)));
  assert.ok(red(await pixel("a", 230)));
  assert.equal(
    await page.evaluate(() => requests.filter((request) => request.kind === "audio").length),
    2,
  );
  await page.evaluate(async () => {
    document.querySelector("#mount").replaceChildren();
    await draw(["a"], { width: 144 });
  });
  assert.ok(blue(await pixel("a", 20)), "An uncached zoom must use the replacement evaluator");
});
test("real timeline passes the open generation when restoring the same document revision", async () => {
  await page.evaluate(() => {
    media.dispose();
    timeline = new api.EditorTimeline(document.querySelector("#mount"), {
      read: () => structuredClone(doc),
      identity: () => ({ documentId: doc.id, revision: doc.revision, generation: mediaGeneration }),
      selection: () => ({ sequenceId: "main", clipIds: [] }),
      select: () => {},
      time: () => 0,
      seek: () => {},
      apply: () => {},
      onError: (error) => errors.push(error.message),
      media: { resolveAsset: () => sourceUrl, loadWaveform: async () => wave },
    });
  });
  await page.waitForFunction(
    () => document.querySelector('[data-et-clip="a"] canvas')?.dataset.etMediaState === "ready",
  );
  assert.ok(red(await page.evaluate(() => timelinePixel())));
  await page.evaluate(() => {
    doc = fixture();
    doc.sequences[0].clips[0].timeMap.points = [
      { time: 0, source: 480000 },
      { time: 480000, source: 0 },
    ];
    mediaGeneration++;
    timeline.render();
  });
  await page.waitForFunction(
    () => document.querySelector('[data-et-clip="a"] canvas')?.dataset.etMediaState === "ready",
  );
  assert.ok(blue(await page.evaluate(() => timelinePixel())));
  assert.deepEqual(await page.evaluate(() => errors), []);
});
test("same-generation workspace media refresh replaces real source pixels and waveform without an edit", async () => {
  await page.evaluate(() => mountWorkspace());
  await page.waitForFunction(
    () => document.querySelector('[data-et-clip="a"] canvas')?.dataset.etMediaState === "ready",
  );
  assert.ok(red(await page.evaluate(() => timelinePixel())));
  const originalWavePixels = await page.evaluate(() => timelineWavePixels());
  const identity = await page.evaluate(() => session.getState().identity);
  await page.evaluate(async () => {
    await workspace.seek(8000);
    await workspace.seek(0);
  });
  assert.equal(
    await page.evaluate(() => requests.filter((request) => request.kind === "audio").length),
    1,
  );
  await page.evaluate(() => {
    timelineResource = sourceUrl.replace("source.mp4", "reversed.mp4");
    timelineWave = reversedWave;
    workspace.refreshMedia();
  });
  await page.waitForFunction(
    () =>
      requests.filter((request) => request.kind === "audio").length === 2 &&
      document.querySelector('[data-et-clip="a"] canvas')?.dataset.etMediaState === "ready",
  );
  assert.ok(blue(await page.evaluate(() => timelinePixel())));
  assert.ok(
    (await page.evaluate(() => timelineWavePixels())) > originalWavePixels,
    "Reconnected reversed audio starts with a real tone envelope",
  );
  assert.deepEqual(await page.evaluate(() => session.getState().identity), identity);
  assert.deepEqual(await page.evaluate(() => errors), []);
});
test("reconnecting media retries failed visible timeline strips while the workspace stays paused", async () => {
  await page.evaluate(() => mountWorkspace({ blocked: true }));
  await page.waitForFunction(
    () => document.querySelector('[data-et-clip="a"] canvas')?.dataset.etMediaState === "error",
  );
  assert.match(await page.locator('[data-et-clip="a"] canvas').getAttribute("title"), /重新连接/);
  await page.evaluate(() => {
    timelineBlocked = false;
    workspace.refreshMedia();
  });
  await page.waitForFunction(
    () => document.querySelector('[data-et-clip="a"] canvas')?.dataset.etMediaState === "ready",
  );
  assert.ok(red(await page.evaluate(() => timelinePixel())));
  assert.doesNotMatch(
    await page.locator('[data-et-clip="a"] canvas').getAttribute("title"),
    /重新连接/,
  );
  assert.equal(await page.locator('[data-ew-action="play"]').getAttribute("aria-label"), "播放");
});
test("sequence switching and zoom preserve correct per-sequence pixels and reuse the source waveform", async () => {
  const result = await page.evaluate(async () => {
    const child = structuredClone(doc.sequences[0]);
    child.id = "other";
    child.clips[0].timeMap.points = [
      { time: 0, source: 480000 },
      { time: 480000, source: 0 },
    ];
    doc.sequences.push(child);
    const colors = [];
    for (let index = 0; index < 12; index++) {
      document.querySelector("#mount").replaceChildren();
      const canvas = document.createElement("canvas");
      canvas.dataset.clip = "a";
      document.querySelector("#mount").appendChild(canvas);
      await media.render(
        doc,
        index % 2 ? "other" : "main",
        [
          {
            clipId: "a",
            canvas,
            localStart: 0,
            localEnd: 480000,
            width: index % 3 ? 288 : 144,
            height: 32,
          },
        ],
        { documentId: doc.id, revision: doc.revision, generation: mediaGeneration },
      );
      colors.push(pixel("a", 20, 8));
    }
    return {
      colors,
      waveforms: requests.filter((request) => request.kind === "audio").length,
      stats: media.stats,
      errors: [...errors],
    };
  });
  for (const [index, color] of result.colors.entries())
    assert.ok(index % 2 ? blue(color) : red(color));
  assert.equal(result.waveforms, 1);
  assert.ok(result.stats.thumbnails <= 160);
  assert.deepEqual(result.errors, []);
});
test("nested sequence thumbnails and waveform maps use child source time, not the parent asset", async () => {
  await page.evaluate(async () => {
    const child = structuredClone(doc.sequences[0]);
    child.id = "child";
    child.name = "嵌套";
    doc.sequences.push(child);
    const nested = doc.sequences[0].clips[0];
    nested.kind = "sequence";
    nested.sequenceId = "child";
    delete nested.assetId;
    nested.timeMap.points = [
      { time: 0, source: 480000 },
      { time: 480000, source: 0 },
    ];
    await draw();
  });
  assert.ok(blue(await pixel("a", 20)));
  assert.ok(red(await pixel("a", 230)));
  assert.deepEqual(await page.evaluate(() => errors), []);
});
test("superseding and disposal abort pending media and prevent stale canvas publication", async () => {
  const result = await page.evaluate(async () => {
    media.dispose();
    let release;
    globalThis.abortedSignals = [];
    media = new api.EditorTimelineMedia({
      resolveAsset: async (id, signal) => {
        abortedSignals.push(signal);
        await new Promise((resolve) => (release = resolve));
        return sourceUrl;
      },
    });
    const old = draw();
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    const empty = media.render(doc, "main", []);
    release();
    await Promise.all([old, empty]);
    const stats = media.stats;
    media.dispose();
    return {
      aborted: abortedSignals.every((s) => s.aborted),
      stats,
      state: document.querySelector("canvas").dataset.etMediaState,
    };
  });
  assert.equal(result.aborted, true);
  assert.equal(result.stats.thumbnails, 0);
  assert.notEqual(result.state, "ready");
});
test("real timeline only allocates visible media strips, skips hidden tracks, and preserves locked tracks", async () => {
  await page.evaluate(() => {
    media.dispose();
    const seq = doc.sequences[0];
    seq.tracks[0].locked = true;
    for (let i = 1; i < 80; i++) {
      seq.tracks.push(api.createTrack(`v${i}`, "video"));
      const clip = structuredClone(seq.clips[0]);
      clip.id = `clip${i}`;
      clip.trackId = `v${i}`;
      seq.clips.push(clip);
    }
    seq.tracks.at(-1).hidden = true;
    globalThis.editorHistory = new api.EditorHistory(doc);
    timeline = new api.EditorTimeline(document.querySelector("#mount"), {
      read: () => editorHistory.read(),
      selection: () => ({ sequenceId: "main", clipIds: [] }),
      select: () => {},
      time: () => 0,
      seek: () => {},
      apply: (ops) => editorHistory.apply(ops, editorHistory.revision, "edit"),
      onError: (e) => errors.push(e.message),
      media: {
        resolveAsset: async () => {
          requests.push("video");
          return sourceUrl;
        },
        loadWaveform: async () => {
          requests.push("audio");
          return wave;
        },
      },
    });
  });
  await page.waitForFunction(
    () => document.querySelectorAll('canvas[data-et-media-state="ready"]').length > 0,
  );
  // At most one strip per lane the timeline body shows, never one per clip of all 80 tracks.
  const visibleLanes = () =>
    page.evaluate(() => {
      const body = document.querySelector(".et-body").getBoundingClientRect();
      return [...document.querySelectorAll(".et-lane")].filter((lane) => {
        const rect = lane.getBoundingClientRect();
        return rect.bottom > body.top && rect.top < body.bottom;
      }).length;
    });
  const stripCount = () => page.locator("canvas.et-media-strip").count();
  assert.ok((await stripCount()) <= (await visibleLanes()) && (await stripCount()) < 16);
  assert.equal(await page.locator('[data-et-clip="clip79"] canvas').count(), 0);
  if (process.env.VIDEO_STUDIO_TIMELINE_MEDIA_SCREENSHOT) {
    await page.evaluate(() => {
      const slider = document.querySelector("[data-et-zoom]");
      slider.value = "2.5";
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() =>
      [...document.querySelectorAll("canvas.et-media-strip")].every(
        (canvas) => canvas.dataset.etMediaState === "ready",
      ),
    );
    await page.locator("#mount").screenshot({ path: "/tmp/video-studio-timeline-media.png" });
  }
  await page.evaluate(() => {
    document.querySelector(".et-body").scrollTop = 100000;
  });
  await page.waitForFunction(() =>
    document.querySelector('[data-et-clip="a"] canvas[data-et-media-state="ready"]'),
  );
  assert.ok((await stripCount()) <= (await visibleLanes()) && (await stripCount()) < 16);
  assert.equal(await page.evaluate(() => editorHistory.revision), 0);
  assert.equal(await page.evaluate(() => editorHistory.read().sequences[0].tracks[0].locked), true);
});
test("missing media produces explicit visible status and no fake wave", async () => {
  await page.evaluate(async () => {
    media.dispose();
    media = new api.EditorTimelineMedia({
      resolveAsset: () => {
        throw new Error("素材待重新关联");
      },
      loadWaveform: async () => {
        throw new Error("波形分析失败");
      },
    });
    await draw();
  });
  assert.equal(await page.locator("canvas").getAttribute("data-et-media-state"), "error");
  assert.match(await page.locator("canvas").getAttribute("aria-label"), /波形分析失败/);
});

test("late waveform completion after cancellation cannot block a new viewport or populate its cache", async () => {
  const result = await page.evaluate(async () => {
    media.dispose();
    let release;
    media = new api.EditorTimelineMedia({
      loadWaveform: async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const first = draw();
    for (let i = 0; !release && i < 100; i++)
      await new Promise((resolve) => setTimeout(resolve, 0));
    if (!release) throw new Error("Waveform request did not begin");
    await media.render(doc, "main", []);
    await first;
    release(wave);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { stats: media.stats, state: document.querySelector("canvas").dataset.etMediaState };
  });
  assert.equal(result.stats.waveforms, 0);
  assert.notEqual(result.state, "ready");
});

test("media reset fences late owned URLs and errors while preserving a new borrowed resource", async () => {
  for (const late of ["owned", "error"]) {
    const result = await page.evaluate(async (late) => {
      media.dispose();
      document.querySelector("#mount").replaceChildren();
      const bytes = await (await fetch(sourceUrl)).arrayBuffer(),
        replacement = await (
          await fetch(sourceUrl.replace("source.mp4", "reversed.mp4"))
        ).arrayBuffer();
      const oldUrl = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" })),
        nextUrl = URL.createObjectURL(new Blob([replacement], { type: "video/mp4" }));
      const revoke = URL.revokeObjectURL.bind(URL),
        revoked = [];
      URL.revokeObjectURL = (url) => {
        revoked.push(url);
        revoke(url);
      };
      let release,
        reject,
        calls = 0,
        oldSignal;
      try {
        media = new api.EditorTimelineMedia({
          resolveAsset: (id, signal) => {
            if (++calls === 1) {
              oldSignal = signal;
              return new Promise((resolve, fail) => {
                release = resolve;
                reject = fail;
              });
            }
            return { url: nextUrl, owned: false };
          },
          onError: (error) => errors.push(error.message),
        });
        const old = draw();
        while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
        media.reset();
        mediaGeneration++;
        document.querySelector("#mount").replaceChildren();
        await draw();
        if (late === "owned") release({ url: oldUrl, owned: true });
        else reject(new Error("旧工程的解码失败"));
        await old;
        await new Promise((resolve) => setTimeout(resolve, 0));
        const current = pixel("a", 20, 8),
          state = document.querySelector("canvas").dataset.etMediaState;
        media.dispose();
        return {
          current,
          state,
          oldAborted: oldSignal.aborted,
          revokedOld: revoked.filter((url) => url === oldUrl).length,
          revokedNext: revoked.includes(nextUrl),
          errors: [...errors],
          stats: media.stats,
        };
      } finally {
        URL.revokeObjectURL = revoke;
        revoke(oldUrl);
        revoke(nextUrl);
      }
    }, late);
    assert.ok(blue(result.current));
    assert.equal(result.state, "ready");
    assert.equal(result.oldAborted, true);
    assert.equal(result.revokedOld, late === "owned" ? 1 : 0);
    assert.equal(result.revokedNext, false);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.stats, { thumbnails: 0, waveformBytes: 0, waveforms: 0 });
  }
});

test("late old-generation waveform cannot replace a fresh real waveform cache", async () => {
  const result = await page.evaluate(async () => {
    media.dispose();
    doc.assets[0].kind = "audio";
    doc.sequences[0].tracks[0].kind = "audio";
    let release,
      calls = 0,
      oldSignal;
    media = new api.EditorTimelineMedia({
      loadWaveform: (id, signal) => {
        if (++calls === 1) {
          oldSignal = signal;
          return new Promise((resolve) => {
            release = resolve;
          });
        }
        return Promise.resolve(reversedWave);
      },
      onError: (error) => errors.push(error.message),
    });
    const old = draw();
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    media.reset();
    mediaGeneration++;
    document.querySelector("#mount").replaceChildren();
    await draw();
    const fresh = pixel("a", 20, 12);
    release(wave);
    await old;
    document.querySelector("#mount").replaceChildren();
    await draw();
    return {
      fresh,
      after: pixel("a", 20, 12),
      calls,
      oldAborted: oldSignal.aborted,
      stats: media.stats,
      errors: [...errors],
    };
  });
  assert.ok(result.fresh[3] > 0, "The generated reversed audio is audible at the first second");
  assert.deepEqual(result.after, result.fresh);
  assert.equal(result.calls, 2);
  assert.equal(result.oldAborted, true);
  assert.equal(result.stats.waveforms, 1);
  assert.deepEqual(result.errors, []);
});

test("real media scroll cache stays bounded for legal 1000 and 5000 clip projects", async (t) => {
  const measurements = await page.evaluate(async () => {
    const measurements = [];
    for (const count of [1000, 5000]) {
      doc = fixture();
      doc.id = `legal-${count}`;
      const template = structuredClone(doc.sequences[0]),
        clip = structuredClone(template.clips[0]);
      doc.sequences = [];
      for (let offset = 0; offset < count; offset += 2000) {
        const sequence = structuredClone(template);
        sequence.id = offset ? `inactive-${offset}` : "main";
        sequence.clips = Array.from({ length: Math.min(2000, count - offset) }, (_, index) => ({
          ...structuredClone(clip),
          id: offset + index ? `clip-${offset + index}` : "a",
          start: index * clip.duration,
        }));
        doc.sequences.push(sequence);
      }
      media.reset();
      requests = [];
      const first = performance.now();
      await draw();
      const firstMs = performance.now() - first,
        samples = [];
      for (let i = 0; i < 16; i++) {
        document.querySelector("#mount").replaceChildren();
        const start = performance.now();
        await draw(["a"], i % 2 ? {} : { width: 216, start: 120000, end: 480000 });
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      measurements.push({
        clips: count,
        sequenceClips: doc.sequences.map((sequence) => sequence.clips.length),
        firstMs,
        scrollMedianMs: samples[8],
        scrollP95Ms: samples[15],
        stats: media.stats,
        videoRequests: requests.filter((request) => request.kind === "video").length,
        waveformRequests: requests.filter((request) => request.kind === "audio").length,
      });
    }
    return measurements;
  });
  t.diagnostic(JSON.stringify(measurements));
  for (const measured of measurements) {
    assert.ok(measured.sequenceClips.every((count) => count <= 2000));
    assert.equal(measured.stats.thumbnails, 4);
    assert.equal(measured.stats.waveforms, 1);
    assert.equal(measured.waveformRequests, 1);
    assert.equal(measured.videoRequests, 1);
  }
  assert.deepEqual(await page.evaluate(() => errors), []);
});

test("changed asset fingerprints reject stale waveform results even when the logical asset ID is unchanged", async () => {
  await page.evaluate(async () => {
    doc.assets[0].fingerprint = "f".repeat(64);
    await draw();
  });
  assert.equal(await page.locator("canvas").getAttribute("data-et-media-state"), "error");
  assert.match(await page.locator("canvas").getAttribute("title"), /当前素材不匹配/);
});

test("actual ProRes passes the single-source native proxy task and the timeline decodes its distinct frames", async () => {
  await page.evaluate(async () => {
    media.dispose();
    media = new api.EditorTimelineMedia({
      resolveAsset: () => sourceUrl.replace("source.mp4", "proxy.mp4"),
      onError: (error) => errors.push(error.message),
    });
    await draw();
  });
  assert.deepEqual(await page.evaluate(() => errors), []);
  assert.ok(red(await pixel("a", 20)));
  assert.ok(blue(await pixel("a", 230)));
  assert.equal(await page.locator("canvas").getAttribute("data-et-media-state"), "ready");
});
