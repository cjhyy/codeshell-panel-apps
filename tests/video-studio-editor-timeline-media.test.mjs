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
      contents: `export * from './apps/video-studio/src/editor/timeline-media.ts';export * from './apps/video-studio/src/editor/timeline-ui.ts';export * from './apps/video-studio/src/editor/defaults.ts';export * from './apps/video-studio/src/editor/waveform.ts';export * from './apps/video-studio/src/editor/audio-plan.ts';export {prepareTimelineSnapshot,isPreparedTimelineSnapshot} from './apps/video-studio/src/editor/evaluate.ts';export {EditorHistory} from './apps/video-studio/src/editor/history.ts';export {EditorWorkspace} from './apps/video-studio/src/editor/workspace-ui.ts';export {EditorSession} from './apps/video-studio/src/editor/session.ts';`,
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
      globalThis.timelineIdentity = () => ({
        documentId: doc.id,
        revision: doc.revision,
        generation: mediaGeneration,
      });
      globalThis.preparedDraw = async (
        snapshot,
        ids = ["a"],
        { sequenceId = "main", start = 0, end = 480000, width = 288, height = 32, identity } = {},
      ) => {
        const strips = ids.map((id) => {
          const canvas = document.createElement("canvas");
          canvas.dataset.clip = id;
          document.querySelector("#mount").appendChild(canvas);
          return { clipId: id, canvas, localStart: start, localEnd: end, width, height };
        });
        await media.renderPrepared(
          snapshot,
          sequenceId,
          strips,
          identity ?? {
            documentId: snapshot.documentId,
            revision: snapshot.revision,
            generation: snapshot.generation,
          },
        );
        return strips.map((strip) => strip.canvas.dataset.etMediaState);
      };
      globalThis.mountWorkspace = async ({ blocked = false } = {}) => {
        media.dispose();
        let storageRevision = 0;
        globalThis.timelineResource = sourceUrl;
        globalThis.timelineWave = wave;
        globalThis.timelineBlocked = blocked;
        globalThis.session = await api.EditorSession.open({
          read: async () => ({ data: structuredClone(doc), revision: 0 }),
          write: async () => ({ revision: ++storageRevision }),
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

test("prepared timeline rejects fake caps and stale identities while public rendering still rejects malformed documents", async () => {
  const result = await page.evaluate(async () => {
    const snapshot = api.prepareTimelineSnapshot(doc, timelineIdentity());
    let getterCalls = 0;
    const failures = [];
    for (const fake of [
      { ...snapshot },
      Object.create(snapshot),
      new Proxy(snapshot, {
        get() {
          getterCalls++;
          throw new Error("proxy");
        },
      }),
      {
        get documentId() {
          getterCalls++;
          throw new Error("getter");
        },
      },
    ]) {
      try {
        await media.renderPrepared(fake, "main", [], timelineIdentity());
        failures.push("accepted");
      } catch (error) {
        failures.push(error.message);
      }
    }
    for (const identity of [
      undefined,
      { ...timelineIdentity(), generation: 2 },
      { ...timelineIdentity(), revision: 1 },
      { ...timelineIdentity(), documentId: "other" },
    ]) {
      try {
        await media.renderPrepared(snapshot, "main", [], identity);
        failures.push("accepted");
      } catch (error) {
        failures.push(error.message);
      }
    }
    snapshot.dispose();
    const malformed = [];
    for (const kind of ["source", "missing", "getter"]) {
      reset();
      const inactive = structuredClone(doc.sequences[0]);
      inactive.id = "inactive";
      doc.sequences.push(inactive);
      await draw();
      if (kind === "source") inactive.clips[0].timeMap.points[1].source = 480001;
      if (kind === "missing") delete inactive.clips[0].trackId;
      if (kind === "getter")
        Object.defineProperty(inactive.clips[0], "duration", {
          enumerable: true,
          get() {
            getterCalls++;
            return 480000;
          },
        });
      document.querySelector("#mount").replaceChildren();
      await draw();
      malformed.push(document.querySelector("canvas").dataset.etMediaState);
    }
    return { failures, malformed, getterCalls };
  });
  assert.ok(result.failures.every((message) => /快照/.test(message)));
  assert.equal(result.failures.length, 8);
  assert.deepEqual(result.malformed, ["error", "error", "error"]);
  assert.equal(result.getterCalls, 0);
});

test("prepared timeline isolates caller data and reuses root sets across order, duplicate and viewport changes", async () => {
  const result = await page.evaluate(async () => {
    const other = structuredClone(doc.sequences[0].clips[0]);
    other.id = "b";
    other.start = 480000;
    doc.sequences[0].clips.push(other);
    const snapshot = api.prepareTimelineSnapshot(doc, timelineIdentity()),
      lanes = snapshot.compileVisibleAudio("main", ["a", "b"]),
      info = snapshot.stripInfo("main", ["a"]);
    lanes[0].stages[0].audio.volume = 0;
    lanes[0].spans.length = 0;
    info.sequences[0].clips[0].start = 9999;
    const first = await preparedDraw(snapshot, ["a", "b"]);
    document.querySelector("#mount").replaceChildren();
    doc.sequences[0].clips[0].timeMap.points[1].source = 480001;
    const second = await preparedDraw(snapshot, ["b", "a", "a"], { width: 216, start: 120000 });
    const color = pixel("a", 20, 8),
      fresh = snapshot.compileVisibleAudio("main", ["a"]);
    document.querySelector("#mount").replaceChildren();
    await draw();
    return {
      first,
      second,
      color,
      volume: fresh[0].stages[0].audio.volume,
      spans: fresh[0].spans.length,
      publicState: document.querySelector("canvas").dataset.etMediaState,
      active: api.isPreparedTimelineSnapshot(snapshot),
      waves: requests.filter((request) => request.kind === "audio").length,
    };
  });
  assert.deepEqual(result.first, ["ready", "ready"]);
  assert.deepEqual(result.second, ["ready", "ready", "ready"]);
  assert.ok(red(result.color));
  assert.equal(result.volume, 1);
  assert.ok(result.spans);
  assert.equal(result.publicState, "error");
  assert.equal(result.active, false);
  assert.equal(result.waves, 1);
});

test("prepared timeline retries failed waveforms and honors existing mutable loader options", async () => {
  const result = await page.evaluate(async () => {
    media.dispose();
    const snapshot = api.prepareTimelineSnapshot(doc, timelineIdentity());
    let enabled = false,
      loads = 0;
    const options = {
      resolveAsset: () => sourceUrl,
      canLoadWaveform: () => enabled,
      loadWaveform: async () => {
        if (++loads === 1) throw new Error("临时波形失败");
        return wave;
      },
      onError: (error) => errors.push(error.message),
    };
    media = new api.EditorTimelineMedia(options);
    const render = async () => {
      document.querySelector("#mount").replaceChildren();
      const state = await preparedDraw(snapshot, ["a"], { height: 48 });
      const data = document
        .querySelector("canvas")
        .getContext("2d")
        .getImageData(20, 0, 1, 48).data;
      let count = 0;
      for (let y = 27; y < 48; y++)
        if (data[y * 4] < 190 && data[y * 4 + 1] > 100 && data[y * 4 + 2] > 100) count++;
      return { state, loads, tonePixels: count };
    };
    const deferred = await render();
    enabled = true;
    const failed = await render(),
      retry = await render();
    options.loadWaveform = async () => {
      loads++;
      return reversedWave;
    };
    const changed = await render();
    enabled = false;
    const disabled = await render();
    enabled = true;
    const resumed = await render();
    return { deferred, failed, retry, changed, disabled, resumed, errors: [...errors] };
  });
  assert.deepEqual(result.deferred.state, ["ready"]);
  assert.equal(result.deferred.loads, 0);
  assert.deepEqual(result.failed.state, ["error"]);
  assert.deepEqual(result.retry.state, ["ready"]);
  assert.equal(result.retry.loads, 2);
  assert.equal(result.changed.loads, 3);
  assert.ok(result.changed.tonePixels > result.retry.tonePixels);
  assert.equal(result.disabled.loads, 3);
  assert.equal(result.resumed.loads, 3);
  assert.deepEqual(result.resumed.state, ["ready"]);
  assert.deepEqual(result.errors, ["临时波形失败"]);
});

test("prepared timeline retains partial nested lane budgets, retries failed plans and replaces same-id snapshots", async () => {
  const result = await page.evaluate(async () => {
    const nested = structuredClone(doc.sequences[0]);
    nested.id = "nested";
    nested.tracks = [api.createTrack("nested-audio", "audio")];
    nested.clips = Array.from({ length: 257 }, (_, index) => ({
      ...structuredClone(doc.sequences[0].clips[0]),
      id: "sound-" + index,
      trackId: "nested-audio",
      start: index * 480000,
    }));
    doc.sequences.push(nested);
    const root = {
      ...structuredClone(doc.sequences[0].clips[0]),
      id: "nested-root",
      kind: "sequence",
      sequenceId: "nested",
      start: 480000,
    };
    delete root.assetId;
    doc.sequences[0].clips.push(root);
    let snapshot = api.prepareTimelineSnapshot(doc, timelineIdentity());
    const render = async (id) => {
      document.querySelector("#mount").replaceChildren();
      return preparedDraw(snapshot, [id]);
    };
    const offscreen = await render("a"),
      excess = await render("nested-root"),
      retry = await render("nested-root"),
      back = await render("a");
    doc.sequences[1].clips.length = 1;
    doc.revision++;
    const old = snapshot;
    snapshot = api.prepareTimelineSnapshot(doc, timelineIdentity());
    const revision = await render("nested-root");
    const replaced = snapshot;
    doc.sequences[0].clips[0].timeMap.points = [
      { time: 0, source: 480000 },
      { time: 480000, source: 0 },
    ];
    snapshot = api.prepareTimelineSnapshot(doc, timelineIdentity());
    const sameIdentity = await render("a"),
      color = pixel("a", 20, 8);
    media.reset();
    return {
      offscreen,
      excess,
      retry,
      back,
      revision,
      sameIdentity,
      color,
      old: api.isPreparedTimelineSnapshot(old),
      replaced: api.isPreparedTimelineSnapshot(replaced),
      active: api.isPreparedTimelineSnapshot(snapshot),
      stats: media.stats,
    };
  });
  assert.deepEqual(result.offscreen, ["ready"]);
  assert.deepEqual(result.excess, ["error"]);
  assert.deepEqual(result.retry, ["error"]);
  assert.deepEqual(result.back, ["ready"]);
  assert.deepEqual(result.revision, ["ready"]);
  assert.deepEqual(result.sameIdentity, ["ready"]);
  assert.ok(blue(result.color));
  assert.equal(result.old, false);
  assert.equal(result.replaced, false);
  assert.equal(result.active, false);
  assert.deepEqual(result.stats, { thumbnails: 0, waveformBytes: 0, waveforms: 0 });
});

test("prepared timeline external disposal cancels pending resolver and reclaims only its late owned URL", async () => {
  const result = await page.evaluate(async () => {
    media.dispose();
    const old = api.prepareTimelineSnapshot(doc, timelineIdentity()),
      next = api.prepareTimelineSnapshot(doc, timelineIdentity());
    const url = URL.createObjectURL(
        new Blob([await (await fetch(sourceUrl)).arrayBuffer()], { type: "video/mp4" }),
      ),
      revoke = URL.revokeObjectURL.bind(URL),
      revoked = [];
    URL.revokeObjectURL = (value) => {
      revoked.push(value);
      revoke(value);
    };
    let release,
      calls = 0,
      signal;
    try {
      media = new api.EditorTimelineMedia({
        resolveAsset: (id, current) => {
          if (++calls === 1) {
            signal = current;
            return new Promise((resolve) => (release = resolve));
          }
          return sourceUrl.replace("source.mp4", "reversed.mp4");
        },
        onError: (error) => errors.push(error.message),
      });
      const pending = preparedDraw(old);
      while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
      old.dispose();
      document.querySelector("#mount").replaceChildren();
      const fresh = await preparedDraw(next);
      release({ url, owned: true });
      await pending;
      await new Promise((resolve) => setTimeout(resolve, 0));
      const color = pixel("a", 20, 8);
      let stale;
      try {
        await preparedDraw(old);
        stale = "accepted";
      } catch (error) {
        stale = error.message;
      }
      media.dispose();
      return {
        fresh,
        color,
        stale,
        aborted: signal.aborted,
        revoked: revoked.filter((value) => value === url).length,
        borrowed: revoked.includes(sourceUrl.replace("source.mp4", "reversed.mp4")),
        errors: [...errors],
        stats: media.stats,
        active: api.isPreparedTimelineSnapshot(next),
      };
    } finally {
      URL.revokeObjectURL = revoke;
      revoke(url);
    }
  });
  assert.deepEqual(result.fresh, ["ready"]);
  assert.ok(blue(result.color));
  assert.match(result.stale, /释放/);
  assert.equal(result.aborted, true);
  assert.equal(result.revoked, 1);
  assert.equal(result.borrowed, false);
  assert.deepEqual(result.errors, []);
  assert.equal(result.active, false);
  assert.deepEqual(result.stats, { thumbnails: 0, waveformBytes: 0, waveforms: 0 });
});

test("prepared timeline loader replacement cancels old pending waveform and ignores its late error", async () => {
  const result = await page.evaluate(async () => {
    media.dispose();
    const snapshot = api.prepareTimelineSnapshot(doc, timelineIdentity());
    let reject,
      calls = 0,
      signal;
    const options = {
      resolveAsset: () => sourceUrl,
      loadWaveform: (id, current) => {
        calls++;
        signal = current;
        return new Promise((resolve, fail) => (reject = fail));
      },
      onError: (error) => errors.push(error.message),
    };
    media = new api.EditorTimelineMedia(options);
    const pending = preparedDraw(snapshot, ["a"], { height: 48 });
    while (!reject) await new Promise((resolve) => setTimeout(resolve, 0));
    options.loadWaveform = async () => {
      calls++;
      return reversedWave;
    };
    document.querySelector("#mount").replaceChildren();
    const fresh = await preparedDraw(snapshot, ["a"], { height: 48 });
    const before = pixel("a", 20, 34);
    reject(new Error("旧加载迟到失败"));
    await pending;
    const after = pixel("a", 20, 34);
    return {
      fresh,
      before,
      after,
      aborted: signal.aborted,
      calls,
      errors: [...errors],
      stats: media.stats,
    };
  });
  assert.deepEqual(result.fresh, ["ready"]);
  assert.deepEqual(result.after, result.before);
  assert.equal(result.aborted, true);
  assert.equal(result.calls, 2);
  assert.equal(result.stats.waveforms, 1);
  assert.deepEqual(result.errors, []);
});

test("prepared timeline idle and synchronous canvas disposal cannot retain resources or publish ready", async () => {
  for (const phase of ["thumbnail", "audio", "idle"]) {
    const result = await page.evaluate(async (phase) => {
      reset();
      const snapshot = api.prepareTimelineSnapshot(doc, timelineIdentity()),
        next = api.prepareTimelineSnapshot(doc, timelineIdentity());
      let notifications = 0;
      snapshot.onDispose(() => {
        notifications++;
        throw new Error("用户监听失败");
      });
      snapshot.onDispose(() => {
        notifications++;
        snapshot.dispose();
      });
      const prototype = CanvasRenderingContext2D.prototype,
        key = phase === "thumbnail" ? "drawImage" : "stroke",
        original = prototype[key];
      let disposed = false;
      if (phase !== "idle")
        prototype[key] = function (...args) {
          if (!disposed && (phase === "thumbnail" || this.canvas.dataset.clip === "a")) {
            disposed = true;
            snapshot.dispose();
          }
          return original.apply(this, args);
        };
      let states;
      try {
        states = await preparedDraw(snapshot);
      } finally {
        prototype[key] = original;
      }
      if (phase === "idle") snapshot.dispose();
      const released = media.stats,
        active = api.isPreparedTimelineSnapshot(snapshot);
      document.querySelector("#mount").replaceChildren();
      const fresh = await preparedDraw(next);
      return {
        states,
        released,
        active,
        fresh,
        notifications,
        color: pixel("a", 20, 8),
        errors: [...errors],
      };
    }, phase);
    if (phase !== "idle") assert.notDeepEqual(result.states, ["ready"]);
    assert.deepEqual(result.released, { thumbnails: 0, waveformBytes: 0, waveforms: 0 });
    assert.equal(result.active, false);
    assert.equal(result.notifications, 2);
    assert.deepEqual(result.fresh, ["ready"]);
    assert.ok(red(result.color));
    assert.deepEqual(result.errors, []);
  }
});

test("prepared timeline reset cannot adopt a second cap reentrantly from a disposal observer", async () => {
  const result = await page.evaluate(async () => {
    const old = api.prepareTimelineSnapshot(doc, timelineIdentity()), next = api.prepareTimelineSnapshot(doc, timelineIdentity()), reentrant = api.prepareTimelineSnapshot(doc, timelineIdentity());
    await preparedDraw(old); let attempted;
    old.onDispose(() => { try { media.renderPrepared(reentrant, "main", [], timelineIdentity()); attempted = "accepted"; } catch (error) { attempted = error.message; } });
    document.querySelector("#mount").replaceChildren(); const state = await preparedDraw(next); media.reset();
    const active = api.isPreparedTimelineSnapshot(next); reentrant.dispose();
    return { attempted, state, active, stats: media.stats, errors: [...errors] };
  });
  assert.match(result.attempted, /重置/); assert.deepEqual(result.state, ["ready"]); assert.equal(result.active, false);
  assert.deepEqual(result.stats, { thumbnails: 0, waveformBytes: 0, waveforms: 0 }); assert.deepEqual(result.errors, []);
});

test("workspace prepared media restores same-id same-revision bytes and keeps public reads detached", async () => {
  await page.evaluate(() => mountWorkspace());
  await page.waitForFunction(
    () => document.querySelector('[data-et-clip="a"] canvas')?.dataset.etMediaState === "ready",
  );
  assert.ok(red(await page.evaluate(() => timelinePixel())));
  const identities = await page.evaluate(async () => {
    const before = session.getState().identity,
      next = session.read();
    next.sequences[0].clips[0].timeMap.points = [
      { time: 0, source: 480000 },
      { time: 480000, source: 0 },
    ];
    await session.replace({ ...next, id: "intermediate" });
    await session.replace(next);
    const detached = session.read();
    detached.sequences[0].clips[0].timeMap.points[0].source = 0;
    return {
      before,
      after: session.getState().identity,
      source: session.read().sequences[0].clips[0].timeMap.points[0].source,
    };
  });
  await page.waitForFunction(
    () => document.querySelector('[data-et-clip="a"] canvas')?.dataset.etMediaState === "ready",
  );
  assert.ok(blue(await page.evaluate(() => timelinePixel())));
  assert.equal(identities.after.documentId, identities.before.documentId);
  assert.equal(identities.after.revision, identities.before.revision);
  assert.notEqual(identities.after.generation, identities.before.generation);
  assert.equal(identities.source, 480000);
  assert.deepEqual(await page.evaluate(() => errors), []);
});

test("production prepared media benchmark separates same-root reuse from graph changes on 5000 legal clips", async (t) => {
  const results = [],
    cdp = await page.context().newCDPSession(page);
  const heap = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    return (await cdp.send("Runtime.getHeapUsage")).usedSize;
  };
  for (const prepared of [false, true]) {
    const result = await page.evaluate(async (prepared) => {
      reset();
      doc.id = "production-five-thousand";
      const template = structuredClone(doc.sequences[0]),
        clip = template.clips[0];
      doc.sequences = [];
      for (let offset = 0; offset < 5000; offset += 2000) {
        const sequence = structuredClone(template);
        sequence.id = offset ? "inactive-" + offset : "main";
        sequence.clips = Array.from({ length: Math.min(2000, 5000 - offset) }, (_, index) => ({
          ...structuredClone(clip),
          id: offset + index ? "clip-" + (offset + index) : "a",
          start: index * clip.duration,
        }));
        doc.sequences.push(sequence);
      }
      const beginning = performance.now();
      globalThis.benchmarkSnapshot = prepared
        ? api.prepareTimelineSnapshot(doc, timelineIdentity())
        : undefined;
      const factoryMs = performance.now() - beginning;
      const render = async (ids, options = {}) => {
        document.querySelector("#mount").replaceChildren();
        const start = performance.now();
        if (prepared) await preparedDraw(benchmarkSnapshot, ids, options);
        else {
          const strips = ids.map((clipId) => {
            const canvas = document.createElement("canvas");
            canvas.dataset.clip = clipId;
            document.querySelector("#mount").appendChild(canvas);
            return {
              clipId,
              canvas,
              localStart: options.start ?? 0,
              localEnd: 480000,
              width: options.width ?? 288,
              height: 32,
            };
          });
          await media.render(doc, options.sequenceId ?? "main", strips, timelineIdentity());
        }
        return performance.now() - start;
      };
      const firstMs = factoryMs + (await render(["a"]));
      await render(["clip-1"]);
      await render(["clip-2000"], { sequenceId: "inactive-2000" });
      await render(["a"]);
      const phases = [];
      for (const kind of ["same-roots", "cross-roots", "seq-switch"]) {
        const times = [];
        for (let index = 0; index < 32; index++) {
          const otherSequence = kind === "seq-switch" && index % 2,
            ids = otherSequence
              ? ["clip-2000"]
              : kind === "cross-roots" && index % 2
                ? ["clip-1"]
                : ["a"];
          times.push(
            await render(ids, {
              sequenceId: otherSequence ? "inactive-2000" : "main",
              ...(index % 2 ? {} : { width: 216, start: 120000 }),
            }),
          );
        }
        times.sort((a, b) => a - b);
        phases.push({ kind, medianMs: times[16], p95Ms: times[30] });
      }
      return {
        prepared,
        factoryMs,
        firstMs,
        phases,
        stats: media.stats,
        errors: [...errors],
        publicPlanProperty: Object.getOwnPropertyNames(media).some((name) =>
          /audioPlan|renderStrips/.test(name),
        ),
      };
    }, prepared);
    result.heldHeap = await heap();
    result.released = await page.evaluate(() => {
      media.reset();
      return { active: api.isPreparedTimelineSnapshot(benchmarkSnapshot), stats: media.stats };
    });
    result.resetHeap = await heap();
    await page.evaluate(() => media.dispose());
    result.disposedHeap = await heap();
    results.push(result);
    assert.deepEqual(result.errors, []);
    assert.equal(result.publicPlanProperty, false);
    assert.ok(result.stats.thumbnails <= 160);
    assert.equal(result.stats.waveforms, 1);
    assert.equal(result.released.active, false);
    assert.deepEqual(result.released.stats, { thumbnails: 0, waveformBytes: 0, waveforms: 0 });
  }
  t.diagnostic(JSON.stringify(results));
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


test("workspace batches strip geometry before canvas insertion through real scrolling, zoom and narrow layout", async () => {
  await page.evaluate(() => {
    const template = structuredClone(doc.sequences[0]),
      clip = template.clips[0];
    doc.sequences = [];
    for (let offset = 0; offset < 5000; offset += 2000) {
      const sequence = structuredClone(template);
      sequence.id = offset ? `inactive-${offset}` : "main";
      sequence.tracks = Array.from({ length: 32 }, (_, index) => ({
        ...api.createTrack(
          `track-${index}`,
          index % 3 === 0 ? "audio" : "video",
        ),
        hidden: index === 29,
        locked: index === 31,
      }));
      sequence.clips = Array.from(
        { length: Math.min(2000, 5000 - offset) },
        (_, index) => ({
          ...structuredClone(clip),
          id: offset + index ? `clip-${offset + index}` : "a",
          trackId: `track-${index % 32}`,
          start: Math.floor(index / 32) * clip.duration,
        }),
      );
      doc.sequences.push(sequence);
    }
    const rect = Element.prototype.getBoundingClientRect,
      height = Object.getOwnPropertyDescriptor(
        Element.prototype,
        "clientHeight",
      ),
      append = Node.prototype.appendChild,
      render = api.EditorTimelineMedia.prototype.renderPrepared;
    let batch = { reads: 0, appended: [], lateReads: [] };
    globalThis.stripProbe = { batches: [], current: [] };
    const measured = (node) => {
      if (!node.matches("[data-et-clip]")) return;
      batch.reads++;
      if (batch.appended.length) batch.lateReads.push(node.dataset.etClip);
    };
    Element.prototype.getBoundingClientRect = function (...args) {
      measured(this);
      return rect.apply(this, args);
    };
    Object.defineProperty(Element.prototype, "clientHeight", {
      ...height,
      get() {
        measured(this);
        return height.get.call(this);
      },
    });
    Node.prototype.appendChild = function (node) {
      if (
        node instanceof HTMLCanvasElement &&
        node.classList.contains("et-media-strip")
      )
        batch.appended.push(this.dataset.etClip);
      return append.call(this, node);
    };
    api.EditorTimelineMedia.prototype.renderPrepared = function (
      snapshot,
      sequenceId,
      strips,
      identity,
    ) {
      stripProbe.batches.push({
        ...batch,
        requested: strips.map((strip) => strip.clipId),
      });
      stripProbe.current = strips;
      batch = { reads: 0, appended: [], lateReads: [] };
      return render.call(this, snapshot, sequenceId, strips, identity);
    };
    stripProbe.restore = () => {
      Element.prototype.getBoundingClientRect = rect;
      Object.defineProperty(Element.prototype, "clientHeight", height);
      Node.prototype.appendChild = append;
      api.EditorTimelineMedia.prototype.renderPrepared = render;
    };
    stripProbe.inspect = () => {
      const sequence = session.read().sequences[0],
        clips = new Map(sequence.clips.map((clip) => [clip.id, clip])),
        tracks = new Map(sequence.tracks.map((track) => [track.id, track])),
        viewport = rect.call(document.querySelector(".et-scroll")),
        body = rect.call(document.querySelector(".et-body")),
        expected = [...document.querySelectorAll("[data-et-clip]")]
          .filter((node) => {
            const bounds = rect.call(node),
              clip = clips.get(node.dataset.etClip);
            return (
              !tracks.get(clip.trackId).hidden &&
              bounds.bottom > body.top &&
              bounds.top < body.bottom &&
              bounds.right > viewport.left &&
              bounds.left < viewport.right
            );
          })
          .slice(0, api.TIMELINE_MEDIA_LIMITS.strips)
          .map((node) => node.dataset.etClip);
      return {
        batches: stripProbe.batches,
        limit: api.TIMELINE_MEDIA_LIMITS.strips,
        expected,
        actual: [...document.querySelectorAll(".et-media-strip")].map(
          (canvas) => canvas.parentElement.dataset.etClip,
        ),
        strips: stripProbe.current.map((strip) => {
          const node = strip.canvas.parentElement,
            bounds = rect.call(node),
            clip = clips.get(strip.clipId),
            track = tracks.get(clip.trackId),
            pixels = strip.canvas
              .getContext("2d")
              .getImageData(0, 8, strip.canvas.width, 1).data;
          let picture = false;
          for (let index = 0; index < pixels.length; index += 4)
            if (
              (pixels[index] > 180 && pixels[index + 2] < 70) ||
              (pixels[index + 2] > 180 && pixels[index] < 70)
            )
              picture = true;
          return {
            id: strip.clipId,
            hidden: track.hidden,
            audio: track.kind === "audio",
            picture,
            left: parseFloat(strip.canvas.style.left),
            width: parseFloat(strip.canvas.style.width),
            expectedLeft: Math.max(bounds.left, viewport.left) - bounds.left,
            expectedWidth:
              Math.min(bounds.right, viewport.right) -
              Math.max(bounds.left, viewport.left),
            height: strip.height,
            expectedHeight: Math.max(
              16,
              Math.min(32, height.get.call(node) - 2),
            ),
            localStart: strip.localStart,
            localEnd: strip.localEnd,
            duration: clip.duration,
          };
        }),
      };
    };
  });
  try {
    await page.evaluate(() => mountWorkspace());
    const check = async () => {
      await page.waitForFunction(
        () =>
          stripProbe.current.length > 1 &&
          stripProbe.current.every(
            (strip) =>
              strip.canvas.isConnected &&
              strip.canvas.dataset.etMediaState === "ready",
          ),
      );
      const state = await page.evaluate(() => stripProbe.inspect());
      assert.deepEqual(state.actual, state.expected);
      assert.ok(state.strips.length > 1 && state.strips.length <= state.limit);
      for (const batch of state.batches) {
        assert.deepEqual(
          batch.lateReads,
          [],
          "All live geometry reads precede the first strip insertion",
        );
        assert.deepEqual(
          batch.appended,
          batch.requested,
          "DOM and media request order agree",
        );
        assert.ok(batch.reads >= batch.appended.length);
      }
      for (const strip of state.strips) {
        assert.equal(strip.hidden, false);
        assert.ok(Math.abs(strip.left - strip.expectedLeft) < 0.01);
        assert.ok(Math.abs(strip.width - strip.expectedWidth) < 0.01);
        assert.equal(strip.height, strip.expectedHeight);
        assert.ok(
          strip.localStart >= 0 &&
            strip.localStart < strip.localEnd &&
            strip.localEnd <= strip.duration,
        );
        assert.equal(
          strip.picture,
          !strip.audio,
          `${strip.id} shows its actual track kind`,
        );
      }
      await page.evaluate(() => {
        stripProbe.batches = [];
        stripProbe.current = [];
      });
      return state;
    };
    await check();
    await page.evaluate(() => {
      document.querySelector(".et-scroll").scrollLeft = 96;
    });
    await check();
    await page.evaluate(() => {
      document.querySelector(".et-body").scrollTop = 96;
    });
    await check();
    await page.locator('[data-et-action="zoom-in"]').click();
    await check();
    let crowded;
    for (let index = 0; index < 6; index++) {
      await page.locator('[data-et-action="zoom-out"]').click();
      crowded = await check();
    }
    assert.equal(
      crowded.strips.length,
      crowded.limit,
      "Dense visible media respects the strip budget",
    );
    await page.setViewportSize({ width: 390, height: 650 });
    await page.addStyleTag({ content: "#mount{width:390px}" });
    await check();
    assert.deepEqual(
      await page.evaluate(() => session.getState().identity.revision),
      0,
    );
    assert.deepEqual(await page.evaluate(() => errors), []);
  } finally {
    await page.evaluate(() => stripProbe.restore());
    await page.setViewportSize({ width: 900, height: 650 });
  }
});

test("owned workspace scrolling reads a legal 5000-clip document once and preserves real media", async () => {
  await page.evaluate(async () => {
    const template = structuredClone(doc.sequences[0]),
      clip = template.clips[0];
    doc.sequences = [];
    for (let offset = 0; offset < 5000; offset += 2000) {
      const sequence = structuredClone(template);
      sequence.id = offset ? `inactive-${offset}` : "main";
      sequence.tracks = Array.from({ length: 32 }, (_, index) =>
        api.createTrack(`track-${index}`, "video"),
      );
      sequence.clips = Array.from(
        { length: Math.min(2000, 5000 - offset) },
        (_, index) => ({
          ...structuredClone(clip),
          id: offset + index ? `clip-${offset + index}` : "a",
          trackId: `track-${index % 32}`,
          start: Math.floor(index / 32) * clip.duration,
        }),
      );
      doc.sequences.push(sequence);
    }
    await mountWorkspace();
  });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".et-media-strip")].length > 1 &&
      [...document.querySelectorAll(".et-media-strip")].every(
        (canvas) => canvas.dataset.etMediaState === "ready",
      ),
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.evaluate(() => {
    globalThis.scrollReads = 0;
    const read = session.read.bind(session);
    session.read = () => {
      scrollReads++;
      return read();
    };
  });
  for (const [kind, position] of [
    ["horizontal", 96],
    ["vertical", 96],
    ["horizontal", 192],
  ]) {
    await page.evaluate(
      ([kind, position]) => {
        scrollReads = 0;
        const node = document.querySelector(
          kind === "horizontal" ? ".et-scroll" : ".et-body",
        );
        if (kind === "horizontal") node.scrollLeft = position;
        else node.scrollTop = position;
      },
      [kind, position],
    );
    await page.waitForFunction(
      () =>
        scrollReads > 0 &&
        document.querySelectorAll(".et-media-strip").length > 1 &&
        [...document.querySelectorAll(".et-media-strip")].every(
          (canvas) => canvas.dataset.etMediaState === "ready",
        ),
    );
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const state = await page.evaluate(() => ({
      reads: scrollReads,
      top: document.querySelector(".et-body").scrollTop,
      strips: [...document.querySelectorAll(".et-media-strip")].map(
        (canvas) => {
          const pixels = canvas
            .getContext("2d")
            .getImageData(0, 8, canvas.width, 1).data;
          return {
            id: canvas.parentElement.dataset.etClip,
            width: canvas.width,
            ready: canvas.dataset.etMediaState === "ready",
            picture: Array.from(
              { length: canvas.width },
              (_, x) =>
                (pixels[x * 4] > 180 && pixels[x * 4 + 2] < 70) ||
                (pixels[x * 4 + 2] > 180 && pixels[x * 4] < 70),
            ).some(Boolean),
          };
        },
      ),
      errors: [...errors],
      identity: session.getState().identity,
    }));
    assert.equal(
      state.reads,
      1,
      `${kind} scroll at ${position} reads the whole document once`,
    );
    if (position === 192)
      assert.equal(
        state.top,
        96,
        "A restored vertical position does not schedule another read",
      );
    assert.ok(
      state.strips.length > 1 &&
        state.strips.every((strip) => strip.ready && strip.picture),
      JSON.stringify({ kind, position, strips: state.strips }),
    );
    assert.equal(state.identity.revision, 0);
    assert.deepEqual(state.errors, []);
  }
});

async function mountHandoffTimeline({ owned = true } = {}) {
  await page.evaluate(
    ({ owned }) => {
      media.dispose();
      const second = structuredClone(doc.sequences[0]);
      second.id = "second";
      doc.sequences.push(second);
      globalThis.handoff = {
        reads: 0,
        prepared: [],
        sequenceId: "main",
        selected: [],
        resource: sourceUrl,
        identity: timelineIdentity(),
        onRead: undefined,
        onSelect: undefined,
        change(mode) {
          if (mode === "sequence") this.sequenceId = "second";
          if (mode === "document") doc.id = "replaced";
          if (mode === "revision") doc.revision++;
          if (mode === "generation") this.identity.generation++;
          this.identity.documentId = doc.id;
          this.identity.revision = doc.revision;
          doc.sequences.find(
            (sequence) => sequence.id === this.sequenceId,
          ).clips[0].timeMap.points = [
            { time: 0, source: 480000 },
            { time: 480000, source: 0 },
          ];
        },
      };
      const context = {
        read: () => {
          handoff.reads++;
          const snapshot = structuredClone(doc),
            effect = handoff.onRead;
          handoff.onRead = undefined;
          effect?.();
          return snapshot;
        },
        identity: () => handoff.identity,
        selection: () => ({
          sequenceId: handoff.sequenceId,
          clipIds: [...handoff.selected],
        }),
        select: (ids) => {
          handoff.selected = ids;
          const effect = handoff.onSelect;
          handoff.onSelect = undefined;
          effect?.();
        },
        time: () => 0,
        seek: () => {},
        apply: () => {},
        onError: (error) => errors.push(error.message),
        media: {
          resolveAsset: () => handoff.resource,
          loadWaveform: async () => wave,
        },
        ...(owned
          ? {
              prepareMediaSnapshot: (document, identity) => {
                const sequence = document.sequences.find(
                  (sequence) => sequence.id === handoff.sequenceId,
                );
                handoff.prepared.push({
                  ...identity,
                  sequenceId: sequence.id,
                  source: sequence.clips[0].timeMap.points[0].source,
                });
                return api.prepareTimelineSnapshot(document, identity);
              },
            }
          : {}),
      };
      handoff.context = context;
      timeline = new api.EditorTimeline(
        document.querySelector("#mount"),
        context,
      );
    },
    { owned },
  );
  await page.waitForFunction(
    () =>
      document.querySelector('[data-et-clip="a"] canvas')?.dataset
        .etMediaState === "ready",
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.evaluate(() => {
    handoff.reads = 0;
    handoff.prepared = [];
  });
}
async function readHandoffResult() {
  await page.waitForFunction(
    () =>
      document.querySelector('[data-et-clip="a"] canvas')?.dataset
        .etMediaState === "ready",
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  return page.evaluate(() => ({
    reads: handoff.reads,
    prepared: handoff.prepared,
    identity: handoff.identity,
    pixel: timelinePixel(),
    errors: [...errors],
  }));
}

for (const phase of ["read", "selection", "raf"]) {
  for (const change of ["document", "revision", "generation", "sequence"]) {
    test(`owned render handoff re-reads after ${change} changes during ${phase}`, async () => {
      await mountHandoffTimeline();
      await page.evaluate(
        ({ phase, change }) => {
          if (phase === "read") handoff.onRead = () => handoff.change(change);
          if (phase === "selection") {
            handoff.selected = ["missing"];
            handoff.onSelect = () => handoff.change(change);
          }
          timeline.render();
          if (phase === "raf") handoff.change(change);
        },
        { phase, change },
      );
      const result = await readHandoffResult();
      assert.equal(result.reads, 2);
      assert.deepEqual(result.prepared, [
        {
          ...result.identity,
          sequenceId: change === "sequence" ? "second" : "main",
          source: 480000,
        },
      ]);
      assert.ok(blue(result.pixel));
      assert.deepEqual(result.errors, []);
    });
  }
}

test("identity alone does not opt a mutable public timeline into render handoff", async () => {
  await mountHandoffTimeline({ owned: false });
  await page.evaluate(() => {
    timeline.refreshMedia(); // Clear the previous evaluator before same-revision public changes.
    handoff.reads = 0;
    timeline.render();
    handoff.change("content");
  });
  const result = await readHandoffResult();
  assert.equal(result.reads, 2);
  assert.deepEqual(result.prepared, []);
  assert.ok(blue(result.pixel));
  assert.deepEqual(result.errors, []);
});

test("render handoff requires its owned hook and identity to remain present until RAF", async () => {
  for (const missing of ["prepareMediaSnapshot", "identity"]) {
    await page.evaluate(() => reset());
    await mountHandoffTimeline();
    await page.evaluate((missing) => {
      timeline.refreshMedia();
      handoff.reads = 0;
      timeline.render();
      delete handoff.context[missing];
      handoff.change("content");
    }, missing);
    const result = await readHandoffResult();
    assert.equal(result.reads, 2);
    assert.deepEqual(result.prepared, []);
    assert.ok(blue(result.pixel));
    assert.deepEqual(result.errors, []);
  }
});

test("owned render handoff preserves single-RAF behavior through reentry, refresh and disposal", async () => {
  await mountHandoffTimeline();
  await page.evaluate(() => {
    handoff.selected = ["missing"];
    handoff.onSelect = () => {
      handoff.change("generation");
      timeline.render();
    };
    timeline.render();
  });
  let result = await readHandoffResult();
  assert.equal(result.reads, 3);
  assert.equal(result.prepared.length, 1);
  assert.equal(result.prepared[0].generation, result.identity.generation);
  assert.ok(blue(result.pixel));
  assert.deepEqual(result.errors, []);
  await page.evaluate(() => {
    handoff.reads = 0;
    handoff.prepared = [];
    for (let index = 0; index < 5; index++) timeline.render();
  });
  result = await readHandoffResult();
  assert.equal(result.reads, 5);
  assert.equal(result.prepared.length, 1);
  await page.evaluate(() => {
    handoff.reads = 0;
    handoff.prepared = [];
    document.querySelector("#mount").style.height = "621px";
  });
  await page.waitForFunction(() => handoff.reads > 0);
  result = await readHandoffResult();
  assert.equal(
    result.reads,
    1,
    "A height-only ResizeObserver notification keeps its independent read",
  );
  assert.equal(result.prepared.length, 1);
  assert.ok(blue(result.pixel));
  await page.evaluate(() => {
    handoff.reads = 0;
    handoff.prepared = [];
    timeline.render();
    handoff.resource = sourceUrl.replace("source.mp4", "reversed.mp4");
    timeline.refreshMedia();
  });
  result = await readHandoffResult();
  assert.equal(result.reads, 2);
  assert.equal(result.prepared.length, 1);
  assert.ok(
    red(result.pixel),
    "Refresh cancels the handoff and decodes new reversed bytes with the reversed map",
  );
  await page.evaluate(() => {
    handoff.reads = 0;
    handoff.prepared = [];
    timeline.render();
    timeline.dispose();
    handoff.readsAtDispose = handoff.reads;
  });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      reads: handoff.reads,
      stopped: handoff.readsAtDispose,
      prepared: handoff.prepared,
      errors,
    })),
    { reads: 2, stopped: 2, prepared: [], errors: [] },
  );
  await page.evaluate(() => {
    document.querySelector("#mount").style.height = "";
  });
});


test("selected fixed gain owns exactly one visible line while selection, automation and scrolling reuse real waveforms", async (t) => {
  const priorWidth = await page.evaluate(() => { const node = document.querySelector("#mount"), prior = node.style.width; node.style.width = "900px"; return prior; });
  t.after(() => page.evaluate((prior) => document.querySelector("#mount").style.width = prior, priorWidth));
  await page.evaluate(() => { const future = structuredClone(doc.sequences[0].clips[0]); future.id = "future"; future.start = 120 * 240000; doc.sequences[0].clips.push(future); return mountWorkspace(); });
  const ready = async () => page.waitForFunction(() => document.querySelector('[data-et-clip="a"] canvas')?.dataset.etMediaState === "ready");
  const yellow = () => page.evaluate(() => {
    const canvas = document.querySelector('[data-et-clip="a"] canvas'), pixels = canvas.getContext("2d").getImageData(40, 0, 1, canvas.height).data;
    let count = 0; for (let y = 0; y < canvas.height; y++) if (pixels[y * 4] > 150 && pixels[y * 4 + 1] > 150 && pixels[y * 4 + 2] > 80 && pixels[y * 4 + 2] < 190) count++;
    return count;
  });
  await page.evaluate(() => { workspace.timeline.context.select([]); workspace.timeline.render(); });
  await ready(); assert.ok(await yellow() > 0);
  await page.locator('[data-et-clip="a"]').click(); await ready();
  assert.equal(await yellow(), 0); assert.equal(await page.locator('[data-et-gain-line]').count(), 1);
  assert.ok(await page.evaluate(() => {
    const canvas = document.querySelector('[data-et-clip="a"] canvas'), pixels = canvas.getContext("2d").getImageData(Math.floor(canvas.width * .75), 0, 1, canvas.height).data;
    return Array.from({ length: canvas.height }, (_, y) => y).some((y) => pixels[y * 4] < 190 && pixels[y * 4 + 1] > 100 && pixels[y * 4 + 2] > 120);
  }));
  const waveRequests = await page.evaluate(() => requests.filter((request) => request.kind === "audio").length);
  await page.evaluate(() => workspace.timeline.render()); await ready(); assert.equal(await yellow(), 0);
  await page.locator(".et-scroll").evaluate((node) => node.scrollLeft = 20);
  await page.waitForFunction(() => document.querySelector(".et-scroll").scrollLeft === 20 && parseFloat(document.querySelector('[data-et-clip="a"] canvas')?.style.left ?? "0") > 10);
  await ready(); assert.equal(await yellow(), 0);
  await page.locator('[data-et-gain]').focus(); await page.keyboard.press("Escape"); await ready();
  assert.equal(await page.locator('[data-et-gain-line]').count(), 0); assert.ok(await yellow() > 0);
  await page.locator('[data-et-clip="a"]').click(); await ready();
  assert.equal(await page.evaluate(() => requests.filter((request) => request.kind === "audio").length), waveRequests);
  await page.evaluate(async () => { const clip = session.read().sequences[0].clips[0];
    await session.dispatch([{ type: "clip.update", sequenceId: "main", clipId: "a", patch: { audio: { ...clip.audio,
      volume: { keyframes: [{ time: 0, value: .5, easing: "linear" }, { time: 480000, value: 2, easing: "linear" }] } } } }], session.getState().identity, "音量自动化"); });
  await ready(); assert.equal(await page.locator('[data-et-gain]').count(), 0);
  assert.match(await page.locator('.et-gain-status').textContent(), /自动化/); assert.ok(await yellow() > 0);
  assert.deepEqual(await page.evaluate(() => errors), []);
});

for (const width of [280, 390]) {
  test(`track height view enlarges real thumbnails and waveform with one fixed gain line at ${width}px`, async (t) => {
    await page.setViewportSize({ width, height: 750 });
    t.after(async () => {
      await page.setViewportSize({ width: 900, height: 650 });
      await page.evaluate(() => { document.querySelector("#mount").style.width = "900px"; document.body.style.padding = "0"; });
    });
    await page.evaluate((width) => {
      media.dispose(); document.querySelector("#mount").style.width = `${width - 16}px`; document.body.style.padding = "8px";
      const seq = doc.sequences[0], voice = structuredClone(seq.clips[0]);
      seq.tracks = [api.createTrack("v", "video", "画面"), api.createTrack("audio", "audio", "口播")];
      doc.assets.push({ id: "voice-asset", name: "真实波形", kind: "audio", duration: 480000 });
      voice.id = "voice"; voice.label = "口播"; voice.assetId = "voice-asset"; voice.trackId = "audio"; seq.clips.push(voice);
      globalThis.editorHistory = new api.EditorHistory(doc); globalThis.heightSelection = ["a", "voice"];
      timeline = new api.EditorTimeline(document.querySelector("#mount"), {
        read: () => editorHistory.read(), identity: () => ({ documentId: doc.id, revision: editorHistory.revision, generation: 1 }),
        selection: () => ({ sequenceId: "main", clipIds: [...heightSelection] }), select: (ids) => heightSelection = [...ids],
        time: () => 13, seek: () => {}, apply: (ops) => editorHistory.apply(ops, editorHistory.revision), onError: (error) => errors.push(error.message),
        media: { resolveAsset: () => sourceUrl, loadWaveform: async (id) => { requests.push({ kind: "audio", id }); return wave; } },
      });
      globalThis.heightView = () => {
        const clip = document.querySelector('[data-et-clip="voice"]'), canvas = clip.querySelector("canvas"),
          label = clip.querySelector(".et-clip-label").getBoundingClientRect(), strip = canvas.getBoundingClientRect(),
          area = clip.querySelector(".et-gain-lines"), line = area.firstElementChild,
          data = canvas.getContext("2d").getImageData(Math.floor(canvas.width * .75), 0, 1, canvas.height).data;
        let ymin = canvas.height, ymax = -1, yellow = 0;
        for (let y = 0; y < canvas.height; y++) {
          const [r, g, b] = data.subarray(y * 4, y * 4 + 3);
          if (r < 190 && g > 100 && b > 150) { ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
          if (r > 150 && g > 150 && b > 80 && b < 190) yellow++;
        }
        return { row: clip.parentElement.offsetHeight, clip: clip.offsetHeight, media: canvas.height, waveform: ymax - ymin + 1,
          labelOverlap: Math.max(0, Math.min(label.bottom, strip.bottom) - Math.max(label.top, strip.top)),
          alignment: Math.abs(clip.parentElement.getBoundingClientRect().top - document.querySelector('[data-track-head="audio"]').getBoundingClientRect().top),
          gainArea: area.offsetHeight, gainBottom: parseFloat(getComputedStyle(line).bottom), yellow };
      };
    }, width);
    const ready = (height) => page.waitForFunction((height) => {
      const canvases = [...document.querySelectorAll("canvas.et-media-strip")];
      return canvases.length === 2 && canvases.every((canvas) => canvas.dataset.etMediaState === "ready" && canvas.height === height);
    }, height);
    await ready(32);
    const buttonBounds = await page.getByRole("button", { name: "加高轨道", exact: true }).boundingBox(), followBounds = await page.getByRole("button", { name: "播放跟随", exact: true }).boundingBox();
    assert.ok(buttonBounds.width >= 56 && buttonBounds.x >= followBounds.x + followBounds.width, "The labeled view control must remain readable and reachable at narrow widths");
    const before = await page.evaluate(() => editorHistory.read()), compact = await page.evaluate(() => heightView()),
      requestsBefore = await page.evaluate(() => requests.filter((request) => request.kind === "audio").length);
    assert.equal(compact.row, 48); assert.equal(compact.clip, 39); assert.equal(compact.gainArea, 32); assert.equal(compact.gainBottom, 9);
    assert.equal(compact.yellow, 0);
    await page.getByRole("button", { name: "加高轨道", exact: true }).click(); await ready(48);
    const tall = await page.evaluate(() => heightView());
    assert.equal(tall.row, 80); assert.equal(tall.clip, 71); assert.equal(tall.alignment, 0); assert.equal(tall.labelOverlap, 0);
    assert.equal(tall.gainArea, 48); assert.equal(tall.gainBottom, 13); assert.equal(tall.yellow, 0);
    assert.ok(tall.waveform > compact.waveform, JSON.stringify({ compact, tall }));
    assert.ok(red(await page.evaluate(() => timelinePixel(20, 8))), "The taller strip contains decoded source pixels");
    assert.equal(await page.locator("[data-et-gain-line]").count(), 2, "One selected fixed line per clip");
    if (process.env.VIDEO_STUDIO_TRACK_HEIGHT_SCREENSHOT_DIR)
      await page.screenshot({ path: join(process.env.VIDEO_STUDIO_TRACK_HEIGHT_SCREENSHOT_DIR, `video-studio-track-height-formal-${width}.png`) });
    await page.getByRole("button", { name: "加高轨道", exact: true }).click(); await ready(32);
    assert.deepEqual(await page.evaluate(() => heightView()), compact);
    assert.deepEqual(await page.evaluate(() => editorHistory.read()), before);
    assert.deepEqual(await page.evaluate(() => heightSelection), ["a", "voice"]);
    assert.equal(await page.evaluate(() => requests.filter((request) => request.kind === "audio").length), requestsBefore, "Height changes reuse source waveforms");
    assert.deepEqual(await page.evaluate(() => errors), []);
  });
}
