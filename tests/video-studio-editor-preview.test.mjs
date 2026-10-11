import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
let browser, source;
test("font diagnostics include reachable offscreen text, remain non-blocking and clear when fonts change", async (t) => {
  const page = await pageFixture(t);
  const result = await page.evaluate(async () => {
    const missing = '"VideoStudio Missing, Font 731829", sans-serif';
    const seq = doc.sequences[0];
    const title = {
      id: "caption",
      kind: "text",
      role: "title",
      label: "未出现的文字",
      trackId: "text",
      start: 24000,
      duration: 48000,
      text: "提示字体",
      words: [],
      style: { ...api.defaultTextStyle(), fontFamily: missing },
      transform: api.defaultTransform(),
      color: api.defaultColorAdjustment(),
      blendMode: "normal",
    };
    const child = {
      ...structuredClone(seq),
      id: "child",
      tracks: [api.createTrack("text", "text")],
      clips: [title],
    };
    doc.sequences.push(child);
    seq.clips.push({
      id: "nested",
      kind: "sequence",
      sequenceId: "child",
      label: "复合",
      trackId: "video2",
      start: 0,
      duration: 72000,
      timeMap: {
        points: [
          { time: 0, source: 0 },
          { time: 72000, source: 72000 },
        ],
      },
      audio: api.defaultAudioMix(),
      transform: api.defaultTransform(),
      color: api.defaultColorAdjustment(),
      blendMode: "normal",
    });
    seq.tracks.push(api.createTrack("video2", "video"));
    preview.setDocument(doc);
    const warning = fontWarnings.at(-1);
    const count = fontWarnings.length;
    await preview.seek(0);
    await preview.seek(8000);
    const unchanged = fontWarnings.length === count;
    child.clips[0].style.fontFamily = "system-ui, sans-serif";
    doc.revision++;
    preview.setDocument(doc);
    const cleared = fontWarnings.at(-1);
    const known = api.unavailableFontFamilies("system-ui, sans-serif, monospace");
    await preview.dispose();
    const beforeDisposeEvent = fontWarnings.length;
    document.fonts.dispatchEvent(new Event("loadingdone"));
    return {
      warning,
      unchanged,
      cleared,
      known,
      noLate: fontWarnings.length === beforeDisposeEvent,
      errors,
    };
  });
  assert.equal(result.warning.length, 1);
  assert.equal(result.warning[0].family, "VideoStudio Missing, Font 731829");
  assert.deepEqual(result.warning[0].clipIds, ["caption"]);
  assert.match(result.warning[0].message, /可能缺少.*替代字体.*工程包不包含字体.*检测仅供参考/);
  assert.equal(result.unchanged, true);
  assert.deepEqual(result.cleared, []);
  assert.deepEqual(result.known, []);
  assert.equal(result.noLate, true);
  assert.deepEqual(result.errors, []);
});
before(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { EditorPreview } from './apps/video-studio/src/editor/preview'; import { EditorWorkspace } from './apps/video-studio/src/editor/workspace-ui'; import { EditorSession } from './apps/video-studio/src/editor/session'; import * as defaults from './apps/video-studio/src/editor/defaults'; import * as fonts from './apps/video-studio/src/editor/font-availability'; globalThis.api = { EditorPreview, EditorWorkspace, EditorSession, ...defaults, ...fonts };`,
      resolveDir: root,
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    write: false,
  });
  source = bundle.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});
async function pageFixture(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent('<canvas id="canvas"></canvas><button id="play">播放</button>');
  await page.addScriptTag({ content: source });
  await page.evaluate(() => {
    const visual = {
      transform: api.defaultTransform(),
      color: api.defaultColorAdjustment(),
      blendMode: "normal",
    };
    globalThis.doc = {
      schemaVersion: 2,
      timebase: 240000,
      id: "doc",
      name: "Preview",
      revision: 1,
      assets: [],
      activeSequenceId: "main",
      exportProfiles: [],
      sequences: [
        {
          id: "main",
          name: "Main",
          width: 128,
          height: 64,
          frameRate: { numerator: 30, denominator: 1 },
          background: "#000000",
          timelineMode: "free",
          tracks: [api.createTrack("video", "video"), api.createTrack("audio", "audio")],
          transitions: [],
          markers: [],
          clips: [
            {
              id: "shape",
              label: "矩形",
              kind: "shape",
              trackId: "video",
              start: 0,
              duration: 96000,
              shape: "rectangle",
              fill: "#ff0000",
              stroke: "#000000",
              strokeWidth: 0,
              ...visual,
              transform: {
                ...visual.transform,
                scaleX: 0.5,
                x: {
                  keyframes: [
                    { time: 0, value: -0.25, easing: "linear" },
                    { time: 88000, value: 0.25, easing: "linear" },
                  ],
                },
              },
            },
          ],
        },
      ],
    };
    globalThis.frames = [];
    globalThis.states = [];
    globalThis.errors = [];
    globalThis.preview = new api.EditorPreview(document.querySelector("canvas"), {
      resolveAsset: async () => {
        throw new Error("unexpected media access");
      },
      onFrame: (time) => frames.push(time),
      onPlaybackChange: (playing) => states.push(playing),
      onError: (error) => errors.push(String(error)),
      onWarning: (warnings) => (globalThis.fontWarnings ??= []).push(warnings),
    });
    preview.setDocument(doc);
    globalThis.pixel = (x, y) => [
      ...document.querySelector("canvas").getContext("2d").getImageData(x, y, 1, 1).data,
    ];
  });
  return page;
}

test("streamed twenty-minute audio seeks near the end and drives real Web Audio playback without loading its beginning", async (t) => {
  const page = await pageFixture(t);
  await page.evaluate(async () => {
    doc.sequences[0].clips[0].duration = 1200 * 240000;
    preview.setDocument(doc);
    await preview.seek(1199.8 * 240000);
    globalThis.ranges = [];
    const stream = {
      sampleRate: 48000,
      numberOfChannels: 2,
      sampleCount: 1200 * 48000,
      async read(start, count, signal) {
        if (signal.aborted) throw new DOMException("取消", "AbortError");
        ranges.push({ start, count });
        const left = Float32Array.from(
          { length: count },
          (_, i) => Math.sin(((start + i) * 2 * Math.PI * 440) / 48000) * 0.04,
        );
        return [left, left.slice()];
      },
      dispose() {},
    };
    document.querySelector("#play").onclick = () =>
      preview
        .play({ documentId: doc.id, revision: doc.revision, sequenceId: "main", stream })
        .catch((error) => errors.push(String(error)));
  });
  await page.locator("#play").click();
  await page.waitForFunction(() => !preview.playing && preview.time === 1200 * 240000);
  const result = await page.evaluate(() => ({ ranges, frames, states, errors }));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.states, [true, false]);
  assert.equal(result.ranges.length, 1);
  assert.equal(result.ranges[0].start, 1199.8 * 48000);
  assert.equal(result.ranges[0].count, 9600);
  assert.equal(result.frames.at(-1), 1200 * 240000);
  await page.evaluate(() => preview.dispose());
});

test("a slow streamed PCM block holds the visible playhead and resumes the same sample range", async (t) => {
  const page = await pageFixture(t);
  await page.evaluate(() => {
    doc.sequences[0].clips[0].duration = 4 * 240000;
    preview.setDocument(doc);
    globalThis.ranges = [];
    const stream = {
      sampleRate: 48000,
      numberOfChannels: 2,
      sampleCount: 4 * 48000,
      async read(start, count, signal) {
        ranges.push({ start, count });
        if (start) await new Promise((resolve) => (globalThis.releaseAudio = resolve));
        if (signal.aborted) throw new DOMException("取消", "AbortError");
        return [new Float32Array(count), new Float32Array(count)];
      },
      dispose() {},
    };
    document.querySelector("#play").onclick = () =>
      preview
        .play({ documentId: doc.id, revision: doc.revision, sequenceId: "main", stream })
        .catch((error) => errors.push(String(error)));
  });
  await page.locator("#play").click();
  await page.waitForFunction(() => preview.time === 2 * 240000);
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(() => preview.time), 2 * 240000);
  await page.evaluate(() => releaseAudio());
  await page.waitForFunction(() => preview.time > 2 * 240000);
  const result = await page.evaluate(() => ({ ranges, errors }));
  assert.deepEqual(result.ranges, [
    { start: 0, count: 96000 },
    { start: 96000, count: 96000 },
  ]);
  assert.deepEqual(result.errors, []);
  await page.evaluate(() => preview.pause());
  const stopped = await page.evaluate(() => preview.time);
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(() => preview.time), stopped);
  await page.evaluate(() => preview.dispose());
});

test("seek during a pending streamed start cancels the range and a late receipt cannot resume audio", async (t) => {
  const page = await pageFixture(t);
  await page.evaluate(() => {
    globalThis.streamSignal = null;
    const stream = {
      sampleRate: 48000,
      numberOfChannels: 2,
      sampleCount: 19200,
      read: async (start, count, signal) => {
        streamSignal = signal;
        await new Promise((resolve) => (globalThis.releaseAudio = resolve));
        return [new Float32Array(count), new Float32Array(count)];
      },
      dispose() {},
    };
    document.querySelector("#play").onclick = () =>
      preview
        .play({ documentId: doc.id, revision: doc.revision, sequenceId: "main", stream })
        .catch((error) => errors.push(String(error)));
  });
  await page.locator("#play").click();
  await page.waitForFunction(() => !!streamSignal);
  await page.evaluate(async () => {
    await preview.seek(8000);
    releaseAudio();
  });
  await page.waitForTimeout(80);
  assert.deepEqual(
    await page.evaluate(() => ({
      aborted: streamSignal.aborted,
      time: preview.time,
      playing: preview.playing,
      states,
      errors,
    })),
    { aborted: true, time: 8000, playing: false, states: [], errors: [] },
  );
  await page.evaluate(() => preview.dispose());
});

test("preview seek follows sequence frame ticks and evaluates the same animated canvas", async (t) => {
  const page = await pageFixture(t);
  const result = await page.evaluate(async () => {
    await preview.seek(0);
    const first = [pixel(24, 32), pixel(104, 32)];
    await preview.seek(95000);
    const last = [pixel(24, 32), pixel(104, 32)];
    return { first, last, time: preview.time, frames };
  });
  assert.deepEqual(result.first, [
    [255, 0, 0, 255],
    [0, 0, 0, 255],
  ]);
  assert.deepEqual(result.last, [
    [0, 0, 0, 255],
    [255, 0, 0, 255],
  ]);
  assert.equal(result.time, 88000);
});

test("master-clock playback reaches its final frame, replays, and pauses without hidden timers", async (t) => {
  const page = await pageFixture(t);
  await page.evaluate(() => preview.play());
  await page.waitForFunction(() => !preview.playing && preview.time === 96000);
  const finished = await page.evaluate(() => ({ frames, states, errors, last: pixel(104, 32) }));
  assert(finished.frames.length >= 3);
  assert(finished.frames.every((time, index) => index === 0 || time >= finished.frames[index - 1]));
  assert.deepEqual(finished.states, [true, false]);
  assert.deepEqual(finished.errors, []);
  assert.deepEqual(finished.last, [255, 0, 0, 255]);
  await page.evaluate(async () => {
    await preview.play();
    preview.pause();
  });
  const stopped = await page.evaluate(() => preview.time);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => preview.time), stopped);
  await page.evaluate(() => preview.dispose());
  assert.equal(await page.locator("canvas").evaluate((canvas) => canvas.width), 1);
});

test("audio playback requires the current prepared stereo mix and stale buffers cannot play", async (t) => {
  const page = await pageFixture(t);
  const errors = await page.evaluate(async () => {
    doc.assets.push({ id: "voice", name: "声音", kind: "audio", duration: 96000 });
    doc.sequences[0].clips.push({
      id: "voice-clip",
      label: "声音",
      kind: "media",
      trackId: "audio",
      start: 0,
      duration: 96000,
      assetId: "voice",
      timeMap: {
        points: [
          { time: 0, source: 0 },
          { time: 96000, source: 96000 },
        ],
      },
      transform: api.defaultTransform(),
      color: api.defaultColorAdjustment(),
      blendMode: "normal",
      audio: api.defaultAudioMix(),
    });
    preview.setDocument(doc);
    const failures = [];
    try {
      await preview.play();
    } catch (error) {
      failures.push(error.message);
    }
    globalThis.mix = {
      documentId: "doc",
      revision: 1,
      sequenceId: "main",
      buffer: new AudioBuffer({ length: 19200, sampleRate: 48000, numberOfChannels: 2 }),
    };
    try {
      await preview.play({ ...mix, revision: 0 });
    } catch (error) {
      failures.push(error.message);
    }
    document.querySelector("#play").onclick = () =>
      preview.play(mix).catch((error) => globalThis.errors.push(error.message));
    return failures;
  });
  assert.match(errors[0], /声音预览准备/);
  assert.match(errors[1], /版本不一致/);
  await page.getByRole("button", { name: "播放" }).click();
  await page.waitForFunction(() => !preview.playing && preview.time === 96000);
  assert.deepEqual(await page.evaluate(() => globalThis.errors), []);
  await page.evaluate(() => preview.dispose());
});

test("switching document invalidates playback and old snapshots cannot mutate the active preview", async (t) => {
  const page = await pageFixture(t);
  const result = await page.evaluate(async () => {
    await preview.play();
    const next = structuredClone(doc);
    next.revision++;
    next.sequences[0].clips[0].fill = "#0000ff";
    preview.setDocument(next);
    next.sequences[0].clips[0].fill = "#00ff00";
    await preview.seek(0);
    return { playing: preview.playing, pixel: pixel(24, 32) };
  });
  assert.deepEqual(result, { playing: false, pixel: [0, 0, 255, 255] });
});

test("rapid quality changes cancel old seek results and redraw the requested exact tick", async (t) => {
  const page = await pageFixture(t);
  await page.evaluate(async () => {
    await preview.dispose();
    const seq = doc.sequences[0];
    doc.assets = [
      { id: "image", name: "等待中的图片", kind: "image", duration: 0, width: 128, height: 64 },
    ];
    seq.clips = [
      {
        id: "picture",
        label: "图片",
        kind: "media",
        assetId: "image",
        trackId: "video",
        start: 0,
        duration: 96000,
        timeMap: {
          points: [
            { time: 0, source: 0 },
            { time: 96000, source: 0 },
          ],
        },
        audio: api.defaultAudioMix(),
        transform: api.defaultTransform(),
        color: api.defaultColorAdjustment(),
        blendMode: "normal",
      },
    ];
    globalThis.requests = [];
    globalThis.preview = new api.EditorPreview(document.querySelector("canvas"), {
      resolveAsset: (_id, signal) => new Promise((resolve) => requests.push({ resolve, signal })),
      onFrame: (time) => frames.push(time),
      onError: (error) => errors.push(String(error)),
    });
    preview.setDocument(doc);
    globalThis.oldSeek = preview.seek(8000);
  });
  await page.waitForFunction(() => requests.length === 1);
  await page.evaluate(() => {
    globalThis.half = preview.setResolution(0.5, 16003);
  });
  await page.waitForFunction(() => requests.length === 2);
  await page.evaluate(() => {
    globalThis.quarter = preview.setResolution(0.25, 16003);
  });
  await page.waitForFunction(() => requests.length === 3);
  const result = await page.evaluate(async () => {
    for (const [index, request] of requests.entries())
      request.resolve(
        "data:image/svg+xml," +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="64"><rect width="128" height="64" fill="${index === 2 ? "blue" : "red"}"/></svg>`,
          ),
      );
    const committed = await Promise.all([half, quarter]);
    await oldSeek;
    const canvas = document.querySelector("canvas");
    return {
      size: [canvas.width, canvas.height],
      time: preview.time,
      frames,
      aborted: requests.map((request) => request.signal.aborted),
      committed,
      pixel: pixel(16, 8),
      errors,
    };
  });
  assert.deepEqual(result.size, [32, 16]);
  assert.equal(result.time, 16003);
  assert.deepEqual(result.frames, [16003]);
  assert.deepEqual(result.aborted, [true, true, false]);
  assert.deepEqual(result.committed, [false, true]);
  assert.deepEqual(result.pixel, [0, 0, 255, 255]);
  assert.deepEqual(result.errors, []);
});

test("resuming reuses a committed frame but redraws a pointer draft before playback", async (t) => {
  const page = await pageFixture(t);
  const result = await page.evaluate(async () => {
    await preview.seek(0);
    const committedFrames = frames.length;
    await preview.play();
    preview.pause();
    const resumedFrames = frames.length;
    const draft = structuredClone(doc);
    draft.sequences[0].clips[0].fill = "#0000ff";
    await preview.previewDraft(draft);
    const draftPixel = pixel(24, 32);
    await preview.play();
    preview.pause();
    return { committedFrames, resumedFrames, draftPixel, committedPixel: pixel(24, 32), errors };
  });
  assert.equal(result.resumedFrames, result.committedFrames);
  assert.deepEqual(result.draftPixel, [0, 0, 255, 255]);
  assert.deepEqual(result.committedPixel, [255, 0, 0, 255]);
  assert.deepEqual(result.errors, []);
});

test(
  "workspace resume retains real video decoders only for the prepared session identity",
  { timeout: 60000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "video-studio-resume-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const videos = [];
    for (const color of ["lime", "blue"]) {
      const path = join(directory, `${color}.mp4`);
      const generated = spawnSync(
        "ffmpeg",
        [
          "-nostdin",
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          `color=${color}:s=96x64:r=30:d=3`,
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-g",
          "30",
          "-movflags",
          "+faststart",
          "-y",
          path,
        ],
        { timeout: 15000, encoding: "utf8" },
      );
      assert.equal(generated.status, 0, generated.stderr || String(generated.error));
      videos.push([...(await readFile(path))]);
    }
    async function realWorkspace(t) {
      const page = await pageFixture(t);
      await page.evaluate(async (videos) => {
        await preview.dispose();
        document.body.innerHTML = '<main id="workspace"></main>';
        const urls = videos.map((bytes) =>
          URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "video/mp4" })),
        );
        const createdVideos = [];
        const create = document.createElement.bind(document);
        document.createElement = (tag, ...args) => {
          const node = create(tag, ...args);
          if (tag === "video") createdVideos.push(node);
          return node;
        };
        const value = structuredClone(doc);
        const seq = value.sequences[0];
        seq.width = 96;
        seq.height = 64;
        value.assets = [
          {
            id: "video",
            name: "真实视频",
            kind: "video",
            duration: 720000,
            width: 96,
            height: 64,
            resourceId: "original",
          },
        ];
        seq.clips = [
          {
            id: "clip",
            kind: "media",
            label: "真实视频",
            trackId: "video",
            assetId: "video",
            start: 0,
            duration: 720000,
            timeMap: {
              points: [
                { time: 0, source: 0 },
                { time: 720000, source: 720000 },
              ],
            },
            audio: { ...api.defaultAudioMix(), volume: 0 },
            transform: api.defaultTransform(),
            color: api.defaultColorAdjustment(),
            blendMode: "normal",
          },
        ];
        value.sequences.push({ ...structuredClone(seq), id: "second", name: "第二序列" });
        let stored = value,
          storageRevision = 1,
          sourceIndex = 0,
          proxyIndex,
          preparations = 0,
          resolves = 0;
        const session = await api.EditorSession.open(
          {
            read: async () => ({ data: stored, revision: storageRevision }),
            write: async (data) => {
              stored = structuredClone(data);
              return { revision: ++storageRevision };
            },
            backupLegacy: async () => {},
          },
          { autosaveDelayMs: 60000 },
        );
        const workspaceErrors = [];
        const workspace = new api.EditorWorkspace(document.querySelector("#workspace"), {
          session,
          resolveAsset: () => {
            resolves++;
            return urls[sourceIndex];
          },
          prepareAudio: async () => {
            preparations++;
            if (proxyIndex !== undefined) sourceIndex = proxyIndex;
            return undefined;
          },
          importMedia() {},
          openProject() {},
          newProject() {},
          downloadProject() {},
          showProduction() {},
          onError: (error) => workspaceErrors.push(String(error)),
        });
        globalThis.mediaFixture = {
          workspace,
          session,
          counts: () => ({ videos: createdVideos.length, preparations, resolves }),
          setProxy: (index) => {
            proxyIndex = index;
          },
          reconnect: () => {
            sourceIndex = 1;
            workspace.refreshMedia();
          },
          rebind: () => {
            sourceIndex = 1;
            session.dispatch(
              [{ type: "asset.update", assetId: "video", patch: { resourceId: "replacement" } }],
              session.getState().identity,
              "替换素材",
            );
          },
          pixel: () => [
            ...document
              .querySelector("[data-ew-canvas]")
              .getContext("2d")
              .getImageData(
                Math.floor(document.querySelector("[data-ew-canvas]").width / 2),
                Math.floor(document.querySelector("[data-ew-canvas]").height / 2),
                1,
                1,
              ).data,
          ],
          errors: workspaceErrors,
        };
        await workspace.seek(288000);
      }, videos);
      return page;
    }
    const dominant = (pixel, channel) => {
      assert.ok(
        pixel[channel] > 240 && pixel[(channel + 1) % 3] < 8 && pixel[(channel + 2) % 3] < 8,
        `${pixel} must have channel ${channel}`,
      );
      assert.equal(pixel[3], 255);
    };
    await t.test(
      "silent video pauses and resumes without preparing again or reopening its decoder",
      async (t) => {
        const page = await realWorkspace(t);
        const result = await page.evaluate(async () => {
          const f = mediaFixture;
          await f.workspace.togglePlayback();
          await f.workspace.togglePlayback();
          const first = f.counts();
          for (let i = 0; i < 3; i++) {
            await f.workspace.togglePlayback();
            await f.workspace.togglePlayback();
          }
          return {
            first,
            resumed: f.counts(),
            pixel: f.pixel(),
            playing: f.workspace.playing,
            errors: f.errors,
          };
        });
        assert.equal(result.first.preparations, 1);
        assert.deepEqual(result.resumed, result.first);
        dominant(result.pixel, 1);
        assert.equal(result.playing, false);
        assert.deepEqual(result.errors, []);
      },
    );
    await t.test(
      "first preparation reloads a newly bound proxy before drawing its pixels",
      async (t) => {
        const page = await realWorkspace(t);
        const result = await page.evaluate(async () => {
          const f = mediaFixture,
            before = f.pixel();
          f.setProxy(1);
          await f.workspace.togglePlayback();
          await f.workspace.togglePlayback();
          return { before, after: f.pixel(), counts: f.counts(), errors: f.errors };
        });
        dominant(result.before, 1);
        dominant(result.after, 2);
        assert.equal(result.counts.preparations, 1);
        assert.deepEqual(result.errors, []);
      },
    );
    await t.test("same-revision media reconnection discards old decoders and prepared audio", async (t) => {
      const page = await realWorkspace(t);
      const result = await page.evaluate(async () => {
        const f = mediaFixture;
        await f.workspace.togglePlayback();
        await f.workspace.togglePlayback();
        const before = f.counts(),
          identity = f.session.getState().identity;
        f.reconnect();
        await f.workspace.seek(288000);
        const reconnected = f.pixel();
        await f.workspace.togglePlayback();
        await f.workspace.togglePlayback();
        return {
          before,
          after: f.counts(),
          identity,
          nextIdentity: f.session.getState().identity,
          reconnected,
          pixel: f.pixel(),
          errors: f.errors,
        };
      });
      assert.deepEqual(result.nextIdentity, result.identity);
      assert.equal(result.after.preparations, 2);
      assert.ok(result.after.videos > result.before.videos);
      assert.ok(result.after.resolves > result.before.resolves);
      dominant(result.reconnected, 2);
      dominant(result.pixel, 2);
      assert.deepEqual(result.errors, []);
    });
    await t.test(
      "quality changes pause real video, redraw exact ticks and reuse prepared decoders without history edits",
      async (t) => {
        const page = await realWorkspace(t);
        const before = await page.evaluate(async () => {
          await mediaFixture.workspace.togglePlayback();
          await mediaFixture.workspace.togglePlayback();
          await mediaFixture.workspace.seek(288003, true);
          return {
            counts: mediaFixture.counts(),
            doc: mediaFixture.session.read(),
            time: mediaFixture.workspace.currentTime(),
          };
        });
        for (const [value, width, height] of [
          ["0.5", 48, 32],
          ["0.25", 24, 16],
          ["1", 96, 64],
        ]) {
          await page.getByLabel("预览质量", { exact: true }).selectOption(value);
          await page.waitForFunction(
            ({ width, height }) => {
              const canvas = document.querySelector("[data-ew-canvas]");
              return canvas.width === width && canvas.height === height;
            },
            { width, height },
          );
          const current = await page.evaluate(() => ({
            counts: mediaFixture.counts(),
            doc: mediaFixture.session.read(),
            time: mediaFixture.workspace.currentTime(),
            pixel: mediaFixture.pixel(),
            playing: mediaFixture.workspace.playing,
            errors: mediaFixture.errors,
          }));
          assert.deepEqual(current.counts, before.counts);
          assert.deepEqual(current.doc, before.doc);
          assert.equal(current.time, before.time);
          assert.equal(current.playing, false);
          dominant(current.pixel, 1);
          assert.deepEqual(current.errors, []);
        }
        await page.evaluate(() => mediaFixture.workspace.togglePlayback());
        await page.getByLabel("预览质量", { exact: true }).selectOption("0.25");
        await page.waitForFunction(() => !mediaFixture.workspace.playing);
        assert.deepEqual(await page.evaluate(() => mediaFixture.counts()), before.counts);
      },
    );
    for (const change of ["asset", "generation", "sequence"]) {
      await t.test(
        `${change} changes invalidate prepared media and cannot reuse a previous decoder`,
        async (t) => {
          const page = await realWorkspace(t);
          const result = await page.evaluate(async (change) => {
            const f = mediaFixture;
            await f.workspace.togglePlayback();
            await f.workspace.togglePlayback();
            const before = f.counts(),
              identity = f.session.getState().identity;
            if (change === "asset") f.rebind();
            else if (change === "generation") await f.session.replace(f.session.read());
            else
              f.session.dispatch(
                [{ type: "sequence.activate", sequenceId: "second" }],
                f.session.getState().identity,
                "切换序列",
              );
            await f.workspace.seek(288000);
            await f.workspace.togglePlayback();
            await f.workspace.togglePlayback();
            return {
              before,
              after: f.counts(),
              identity,
              nextIdentity: f.session.getState().identity,
              pixel: f.pixel(),
              errors: f.errors,
            };
          }, change);
          assert.equal(result.after.preparations, 2);
          assert.ok(result.after.videos > result.before.videos);
          assert.ok(result.after.resolves > result.before.resolves);
          if (change === "generation") {
            assert.ok(result.nextIdentity.revision > result.identity.revision);
            assert.notEqual(result.identity.generation, result.nextIdentity.generation);
          }
          dominant(result.pixel, change === "asset" ? 2 : 1);
          assert.deepEqual(result.errors, []);
        },
      );
    }
  },
);
