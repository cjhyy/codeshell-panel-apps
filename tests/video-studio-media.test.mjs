import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const repository = fileURLToPath(new URL("../", import.meta.url));

// This fixture path exercises the same browser-only recording primitives on CI
// without requiring FFmpeg, external media downloads, or mocked media elements.
async function browserFixture(page) {
  return page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 90;
    document.body.append(canvas);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#d64e35";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const audio = new AudioContext();
    const destination = audio.createMediaStreamDestination();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = 440;
    gain.gain.value = 0.06;
    oscillator.connect(gain).connect(destination);
    await audio.resume();
    const stream = canvas.captureStream(30);
    destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
    const mimeType = ["video/webm;codecs=vp8,opus", "video/webm"].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    if (!mimeType) throw new Error("Chromium has no WebM encoder for the media test fixture");
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 250_000 });
    const chunks = [];
    const stopped = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = () => reject(new Error("Could not encode browser media fixture"));
    });
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    try {
      oscillator.start();
      recorder.start();
      const start = performance.now();
      while (performance.now() - start < 4_000) {
        const progress = (performance.now() - start) / 4_000;
        ctx.fillStyle = `hsl(${progress * 240}, 80%, 45%)`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "white";
        ctx.fillRect(Math.floor(progress * 130), 30, 20, 30);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      recorder.stop();
      await stopped;
      return Array.from(new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer()));
    } finally {
      if (recorder.state !== "inactive") recorder.stop();
      oscillator.stop();
      stream.getTracks().forEach((track) => track.stop());
      await audio.close();
      canvas.remove();
    }
  });
}

test(
  "Video Studio imports, previews and records real local media",
  { timeout: 60_000 },
  async (t) => {
    const filter = process.env.VIDEO_STUDIO_MEDIA_TEST;
    const mediaTest = (name, ...args) =>
      filter && !new RegExp(filter).test(name)
        ? t.test(name, { skip: true }, () => {})
        : t.test(name, ...args);
    const directory = await mkdtemp(join(tmpdir(), "video-studio-media-"));
    let browser;
    let server;
    t.after(async () => {
      await browser?.close();
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    });

    const bundlePath = join(directory, "media.mjs");
    await build({
      stdin: {
        contents:
          'import * as media from "./apps/video-studio/src/media.ts"; import * as model from "./apps/video-studio/src/model.ts"; import * as demo from "./apps/video-studio/src/demo.ts"; window.videoMedia = { ...media, ...model, ...demo };',
        resolveDir: repository,
        sourcefile: "media-test-entry.js",
      },
      outfile: bundlePath,
      bundle: true,
      platform: "browser",
      format: "esm",
      target: "es2022",
      logLevel: "silent",
    });
    const routes = new Map([
      [
        "/",
        {
          type: "text/html",
          body: Buffer.from(
            '<!doctype html><html><body><input type="file" id="fixture"><canvas id="preview"></canvas><script type="module" src="/media.mjs"></script></body></html>',
          ),
        },
      ],
      ["/media.mjs", { type: "text/javascript", body: await readFile(bundlePath) }],
    ]);
    routes.set("/demo-narration.mp3", {
      type: "audio/mpeg",
      body: await readFile(join(repository, "apps/video-studio/public/demo-narration.mp3")),
    });
    server = createServer((request, response) => {
      const asset = routes.get(new URL(request.url ?? "/", "http://localhost").pathname);
      const range = asset && /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
      const start = range ? Number(range[1]) : 0;
      const end = range
        ? Math.min(asset.body.length - 1, range[2] ? Number(range[2]) : asset.body.length - 1)
        : asset?.body.length - 1;
      const body = asset ? asset.body.subarray(start, end + 1) : Buffer.from("Not found");
      response.writeHead(asset ? (range ? 206 : 200) : 404, {
        "Accept-Ranges": "bytes",
        "Content-Length": body.length,
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${asset.body.length}` } : {}),
        "Content-Type": asset?.type ?? "text/plain",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'none'; object-src 'none'",
        "Cache-Control": "no-store",
      });
      if (asset?.delay) setTimeout(() => response.end(body), asset.delay);
      else response.end(body);
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
      headless: true,
      args: ["--autoplay-policy=no-user-gesture-required"],
    });

    let fixturePath = join(directory, "source.mp4");
    const generated =
      process.env.VIDEO_STUDIO_BROWSER_FIXTURE === "1"
        ? null
        : spawnSync(
            "ffmpeg",
            [
              "-hide_banner",
              "-loglevel",
              "error",
              "-y",
              "-f",
              "lavfi",
              "-i",
              "testsrc2=s=160x90:r=30:d=4",
              "-f",
              "lavfi",
              "-i",
              "sine=frequency=440:sample_rate=48000:duration=4",
              "-c:v",
              "libx264",
              "-pix_fmt",
              "yuv420p",
              "-c:a",
              "aac",
              "-shortest",
              "-movflags",
              "+faststart",
              fixturePath,
            ],
            { timeout: 15_000, stdio: "pipe" },
          );
    if (generated?.status !== 0) {
      fixturePath = join(directory, "source.webm");
      const page = await browser.newPage();
      try {
        await page.goto(address);
        await writeFile(fixturePath, Buffer.from(await browserFixture(page)));
      } finally {
        await page.close();
      }
      t.diagnostic(
        "Source fixture: browser MediaRecorder with an oscillator audio track; no media tests skipped.",
      );
    } else t.diagnostic("Source fixture: locally generated MP4 with AAC audio.");

    routes.set("/media/managed-source", {
      type: fixturePath.endsWith(".webm") ? "video/webm" : "video/mp4",
      body: await readFile(fixturePath),
    });

    routes.set("/media/slow-source", { ...routes.get("/media/managed-source"), delay: 300 });
    routes.set(`/media/external-${"e".repeat(64)}`, routes.get("/media/managed-source"));
    const picture = new PNG({ width: 160, height: 90 });
    for (let offset = 0; offset < picture.data.length; offset += 4) {
      picture.data[offset] = 30;
      picture.data[offset + 1] = 140;
      picture.data[offset + 2] = 220;
      picture.data[offset + 3] = 255;
    }
    const imageBytes = PNG.sync.write(picture);
    routes.set("/media/managed-image", { type: "image/png", body: imageBytes });
    routes.set(`/media/external-${"f".repeat(64)}`, routes.get("/media/managed-image"));

    async function withMediaPage(run) {
      const page = await browser.newPage();
      try {
        await page.goto(address);
        await page.waitForFunction(() => Boolean(window.videoMedia));
        await page.locator("#fixture").setInputFiles(fixturePath);
        return await run(page);
      } finally {
        await page.close();
      }
    }

    await mediaTest(
      "bounds decoder sources while restoring 118 videos, sampling and importing concurrently",
      async () => {
        const result = await withMediaPage((page) =>
          page.evaluate(async () => {
            const { MediaLibrary, createProject, captureAssetFrame, renderFrame } =
              window.videoMedia;
            const library = new MediaLibrary();
            const videos = new Set();
            const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
            let starts = 0,
              peak = 0;
            const attached = () => [...videos].filter((video) => video.hasAttribute("src")).length;
            Object.defineProperty(HTMLMediaElement.prototype, "src", {
              ...descriptor,
              set(value) {
                descriptor.set.call(this, value);
                if (this instanceof HTMLVideoElement) {
                  videos.add(this);
                  starts++;
                  peak = Math.max(peak, attached());
                }
              },
            });
            try {
              const base = {
                kind: "video",
                name: "4K original",
                width: 3840,
                height: 2160,
                durationFrames: 120,
                mediaId: "managed-source",
                thumbnailId: "managed-image",
              };
              const assets = Array.from({ length: 118 }, (_, i) => ({
                ...base,
                id: `video-${i}`,
                thumbnailId: i === 0 ? "managed-image" : undefined,
              }));
              await Promise.all(assets.map((asset) => library.connectManaged(asset)));
              const cold = {
                count: library.items.size,
                starts,
                active: attached(),
                cover: library.items.get("video-0").thumbnail,
                duration: library.items.get("video-0").duration,
                width: library.items.get("video-0").width,
              };
              await library.import(document.querySelector("#fixture").files[0], assets[0], {
                defer: true,
              });
              const cached = {
                starts,
                active: attached(),
                duration: library.items.get("video-0").duration,
              };
              const project = createProject();
              project.width = 160;
              project.height = 90;
              project.assets = assets;
              project.clips = [
                { id: "first", assetId: "video-0", inFrame: 0, outFrame: 30, volume: 1 },
                { id: "second", assetId: "video-117", inFrame: 30, outFrame: 60, volume: 1 },
              ];
              await library.seek(project, 15);
              const first = {
                active: attached(),
                time: library.items.get("video-0").element.currentTime,
              };
              await library.seek(project, 45);
              const canvas = document.querySelector("#preview");
              renderFrame(canvas, project, library, 45);
              const second = {
                active: attached(),
                time: library.items.get("video-117").element.currentTime,
                oldReady: library.items.get("video-0").element.readyState,
                picture: canvas
                  .getContext("2d")
                  .getImageData(0, 0, 160, 90)
                  .data.some((value, index) => index % 4 !== 3 && value > 40),
              };
              const samples = await Promise.all(
                [0.5, 1.5, 2.5].map((time) => captureAssetFrame(library, "video-2", time)),
              );
              const sampled = {
                active: attached(),
                peak,
                sizes: samples.map((sample) => sample.data.length),
                previewTime: library.items.get("video-117").element.currentTime,
              };
              const beforeCovers = starts;
              let cardVisible = true;
              const pendingCovers = Promise.all([
                ...[2, 2, 3, 4].map((id) => library.ensureThumbnail(`video-${id}`)),
                library.ensureThumbnail("video-5", () => cardVisible),
              ]);
              cardVisible = false;
              const covers = await pendingCovers;
              const visibleCovers = {
                starts: starts - beforeCovers,
                active: attached(),
                peak,
                pictures: covers.slice(0, 4).every((cover) => cover?.startsWith("data:image/jpeg")),
                skipped: covers[4] === undefined,
                shared: covers[0] === covers[1],
                previewTime: library.items.get("video-117").element.currentTime,
              };
              let previousCard = true;
              const staleCover = library.ensureThumbnail("video-6", () => previousCard);
              previousCard = false;
              const freshCover = library.ensureThumbnail("video-6", () => true);
              const [stale, fresh] = await Promise.all([staleCover, freshCover]);
              const replacedCard = {
                stale: stale === undefined,
                fresh: fresh?.startsWith("data:image/jpeg") === true,
              };
              const imported = await Promise.all([
                ...Array.from({ length: 4 }, () =>
                  library.import(document.querySelector("#fixture").files[0]),
                ),
                library.inspectManaged(
                  { id: "managed-source", name: "managed", mimeType: "video/mp4", bytes: 1000 },
                  "managed.mp4",
                  1,
                ),
              ]);
              const afterImports = {
                active: attached(),
                peak,
                covers: imported.every((asset) =>
                  library.items.get(asset.id).thumbnail?.startsWith("data:image/jpeg"),
                ),
                metadata: imported.every(
                  (asset) => asset.durationFrames > 90 && asset.width === 160,
                ),
                dormant: imported.every(
                  (asset) => !library.items.get(asset.id).element.hasAttribute("src"),
                ),
              };
              library.suspend();
              const stopped = {
                active: attached(),
                count: library.items.size,
                missing: library.missing(project).length,
              };
              await library.seek(project, 15);
              const resumed = {
                active: attached(),
                time: library.items.get("video-0").element.currentTime,
              };
              return {
                cold,
                cached,
                first,
                second,
                sampled,
                visibleCovers,
                replacedCard,
                afterImports,
                stopped,
                resumed,
              };
            } finally {
              library.clear();
              Object.defineProperty(HTMLMediaElement.prototype, "src", descriptor);
            }
          }),
        );
        assert.deepEqual(result.cold, {
          count: 118,
          starts: 0,
          active: 0,
          cover: "/media/managed-image",
          duration: 4,
          width: 3840,
        });
        assert.deepEqual(result.cached, { starts: 0, active: 0, duration: 4 });
        assert.deepEqual(result.replacedCard, { stale: true, fresh: true });
        assert.equal(result.first.active, 1);
        assert.ok(Math.abs(result.first.time - 0.5) < 0.02);
        assert.equal(result.second.active, 1);
        assert.equal(result.second.oldReady, 0);
        assert.equal(result.second.picture, true);
        assert.ok(Math.abs(result.second.time - 1.5) < 0.02);
        assert.equal(result.sampled.active, 1);
        assert.equal(result.sampled.peak, 2);
        assert.ok(result.sampled.sizes.every((bytes) => bytes > 500));
        assert.ok(Math.abs(result.sampled.previewTime - 1.5) < 0.02);
        assert.deepEqual(result.visibleCovers, {
          starts: 3,
          active: 1,
          peak: 2,
          pictures: true,
          skipped: true,
          shared: true,
          previewTime: result.sampled.previewTime,
        });
        assert.deepEqual(result.afterImports, {
          active: 1,
          peak: 2,
          covers: true,
          metadata: true,
          dormant: true,
        });
        assert.deepEqual(result.stopped, { active: 0, count: 123, missing: 0 });
        assert.equal(result.resumed.active, 1);
        assert.ok(Math.abs(result.resumed.time - 0.5) < 0.02);
      },
    );

    await mediaTest(
      "paused source previews use verified frozen frames and release them after replacement or suspension",
      async () => {
        const result = await withMediaPage((page) =>
          page.evaluate(async () => {
            const { MediaLibrary, createProject, renderFrame } = window.videoMedia;
            const library = new MediaLibrary();
            const project = createProject();
            project.width = 160;
            project.height = 90;
            const asset = {
              id: "source",
              kind: "video",
              name: "source",
              mediaId: "managed-source",
              durationFrames: 120,
              width: 160,
              height: 90,
            };
            project.assets = [asset];
            project.clips = [
              { id: "clip", assetId: asset.id, inFrame: 0, outFrame: 120, volume: 1 },
            ];
            const canvas = document.querySelector("#preview");
            const draw = CanvasRenderingContext2D.prototype.drawImage;
            let mutableReads = 0;
            // A decoded paused video's mutable surface can lag behind seeking.
            // Keep real decode/seek and all VideoFrame reads; make direct preview
            // reads black so the legacy path cannot pass by compositor timing luck.
            CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
              if (this.canvas === canvas && source instanceof HTMLVideoElement) {
                mutableReads++;
                this.fillStyle = "black";
                this.fillRect(0, 0, canvas.width, canvas.height);
                return;
              }
              return draw.call(this, source, ...args);
            };
            try {
              await library.connectManaged(asset);
              await library.seek(project, 30);
              const first = library.items.get(asset.id).videoFrame;
              renderFrame(canvas, project, library, 30);
              const pixels = canvas
                .getContext("2d")
                .getImageData(0, 0, canvas.width, canvas.height).data;
              const colors = new Set();
              for (let i = 0; i < pixels.length; i += 400)
                colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
              await library.seek(project, 60);
              const second = library.items.get(asset.id).videoFrame;
              const replaced = Boolean(
                first && first.displayWidth === 0 && second?.displayWidth > 0,
              );
              library.suspend();
              return {
                mutableReads,
                colors: colors.size,
                replaced,
                released: Boolean(second && second.displayWidth === 0),
              };
            } finally {
              library.clear();
              CanvasRenderingContext2D.prototype.drawImage = draw;
            }
          }),
        );
        assert.ok(result.colors > 20, JSON.stringify(result));
        assert.deepEqual(
          { ...result, colors: undefined },
          {
            mutableReads: 0,
            colors: undefined,
            replaced: true,
            released: true,
          },
        );
      },
    );

    await mediaTest(
      "playback reconnects video audio and follows both trimmed sources after eviction",
      async () => {
        const result = await withMediaPage((page) =>
          page.evaluate(async () => {
            const { MediaLibrary, createProject, playSequence } = window.videoMedia;
            const library = new MediaLibrary();
            const project = createProject();
            const assets = ["left", "right"].map((id) => ({
              id,
              kind: "video",
              name: id,
              mediaId: "managed-source",
              durationFrames: 120,
              width: 160,
              height: 90,
            }));
            project.width = 160;
            project.height = 90;
            project.assets = assets;
            project.clips = [
              { id: "one", assetId: "left", inFrame: 30, outFrame: 42, volume: 0.3 },
              { id: "two", assetId: "right", inFrame: 60, outFrame: 72, volume: 0.7 },
            ];
            const runs = [];
            try {
              await Promise.all(assets.map((asset) => library.connectManaged(asset)));
              for (let iteration = 0; iteration < 2; iteration++) {
                const segments = [];
                let lastFrame;
                await playSequence(
                  project,
                  library,
                  document.querySelector("#preview"),
                  0,
                  new AbortController().signal,
                  (frame) => {
                    lastFrame = frame;
                  },
                  {
                    async onReady() {
                      const beforeAudioTime = library.audio.currentTime;
                      // A running AudioContext can still be waiting for its first
                      // hardware quantum. Wall time alone does not prove that the
                      // scheduled gain has been rendered; observe its own clock.
                      const deadline = performance.now() + 1000;
                      while (library.audio.currentTime <= beforeAudioTime) {
                        if (performance.now() >= deadline)
                          throw new Error(
                            `Audio rendering clock did not advance: ${library.audio.state}`,
                          );
                        await new Promise((resolve) => setTimeout(resolve, 5));
                      }
                      const active = [...library.items].filter(([, item]) =>
                        item.element.hasAttribute("src"),
                      );
                      segments.push(
                        active.map(([id, item]) => ({
                          id,
                          time: item.element.currentTime,
                          gain: item.gain.gain.value,
                          connected: item.audioConnected,
                          audioState: library.audio.state,
                          audioTime: library.audio.currentTime,
                          beforeAudioTime,
                          paused: item.element.paused,
                          readyState: item.element.readyState,
                        })),
                      );
                    },
                  },
                );
                runs.push({
                  segments,
                  lastFrame,
                  leftDetached: !library.items.get("left").audioConnected,
                  activeCount: [...library.items.values()].filter((item) =>
                    item.element.hasAttribute("src"),
                  ).length,
                });
              }
              return runs;
            } finally {
              library.clear();
              await library.audio?.close();
            }
          }),
        );
        for (const run of result) {
          assert.equal(run.lastFrame, 24);
          assert.equal(run.leftDetached, true);
          assert.equal(run.activeCount, 1);
          assert.equal(run.segments.length, 2);
          for (const [index, entries] of run.segments.entries()) {
            assert.equal(entries.length, 1);
            assert.equal(entries[0].id, index ? "right" : "left");
            assert.ok(Math.abs(entries[0].time - (index ? 2 : 1)) < 0.2);
            assert.ok(Math.abs(entries[0].gain - (index ? 0.7 : 0.3)) < 0.001, JSON.stringify(run));
            assert.equal(entries[0].connected, true);
          }
        }
      },
    );

    await mediaTest(
      "suspending a pending decoder cancels it and permits a fresh seek",
      async () => {
        const result = await withMediaPage((page) =>
          page.evaluate(async () => {
            const { MediaLibrary, createProject } = window.videoMedia;
            const library = new MediaLibrary();
            const project = createProject();
            const asset = {
              id: "slow",
              kind: "video",
              name: "slow",
              durationFrames: 120,
              mediaId: "slow-source",
              width: 160,
              height: 90,
            };
            project.assets = [asset];
            project.clips = [
              { id: "clip", assetId: asset.id, inFrame: 0, outFrame: 90, volume: 1 },
            ];
            try {
              await library.connectManaged(asset);
              const pending = library.seek(project, 15).then(
                () => false,
                () => true,
              );
              await new Promise((resolve) => setTimeout(resolve, 20));
              library.suspend();
              const rejected = await pending;
              const released = !library.items.get(asset.id).element.hasAttribute("src");
              await library.seek(project, 30);
              return { rejected, released, time: library.items.get(asset.id).element.currentTime };
            } finally {
              library.clear();
            }
          }),
        );
        assert.equal(result.rejected, true);
        assert.equal(result.released, true);
        assert.ok(Math.abs(result.time - 1) < 0.02);
      },
    );

    await mediaTest(
      "replacing a source aborts its pending thumbnail without blocking a fresh decoder",
      async () => {
        const result = await withMediaPage((page) =>
          page.evaluate(async () => {
            const { MediaLibrary, createProject } = window.videoMedia;
            const library = new MediaLibrary();
            const asset = {
              id: "replace-cover",
              kind: "video",
              name: "replace-cover",
              durationFrames: 120,
              mediaId: "slow-source",
              width: 160,
              height: 90,
            };
            try {
              await library.connectManaged(asset);
              const old = library.items.get(asset.id);
              const pending = library.ensureThumbnail(asset.id).then(
                () => "resolved",
                () => "cancelled",
              );
              await new Promise((resolve) => setTimeout(resolve, 20));
              await library.connectManaged({ ...asset, mediaId: "managed-source" });
              const settled = await Promise.race([
                pending,
                new Promise((resolve) => setTimeout(() => resolve("blocked"), 100)),
              ]);
              const project = createProject();
              project.assets = [asset];
              project.clips = [
                { id: "clip", assetId: asset.id, inFrame: 0, outFrame: 90, volume: 1 },
              ];
              await library.seek(project, 30);
              return {
                settled,
                replaced: old !== library.items.get(asset.id),
                time: library.items.get(asset.id).element.currentTime,
              };
            } finally {
              library.clear();
            }
          }),
        );
        assert.equal(
          result.settled,
          "cancelled",
          "An invalidated optional cover must release the serial decoder immediately",
        );
        assert.equal(result.replaced, true);
        assert.ok(Math.abs(result.time - 1) < 0.02);
      },
    );

    await mediaTest("reads real metadata and seeks the decoded source before drawing", async () => {
      const result = await withMediaPage((page) =>
        page.evaluate(async () => {
          const { MediaLibrary, createProject, renderFrame } = window.videoMedia;
          const library = new MediaLibrary();
          try {
            const asset = await library.import(document.querySelector("#fixture").files[0]);
            const project = createProject();
            project.width = 160;
            project.height = 90;
            project.assets = [asset];
            project.clips = [
              { id: "clip", assetId: asset.id, inFrame: 0, outFrame: 90, volume: 1 },
            ];
            await library.seek(project, 45);
            const canvas = document.querySelector("#preview");
            renderFrame(canvas, project, library, 45);
            const pixels = canvas.getContext("2d").getImageData(0, 0, 160, 90).data;
            return {
              kind: asset.kind,
              width: asset.width,
              height: asset.height,
              frames: asset.durationFrames,
              time: library.items.get(asset.id).element.currentTime,
              hasPicture: pixels.some((value, index) => index % 4 !== 3 && value > 40),
            };
          } finally {
            library.clear();
          }
        }),
      );
      assert.equal(result.kind, "video");
      assert.equal(result.width, 160);
      assert.equal(result.height, 90);
      assert.ok(result.frames >= 110 && result.frames <= 140, JSON.stringify(result));
      assert.ok(Math.abs(result.time - 1.5) < 1 / 30, JSON.stringify(result));
      assert.equal(result.hasPicture, true);
    });

    await mediaTest(
      "restores video covers on first use and image covers immediately, including stale thumbnail IDs",
      async () => {
        const result = await withMediaPage((page) =>
          page.evaluate(
            async (imageBytes) => {
              const { MediaLibrary, createProject } = window.videoMedia;
              const snapshots = [];
              async function inspect(mode, library, asset) {
                const item = library.items.get(asset.id);
                if (!item?.thumbnail) return { mode, missing: true };
                const image = new Image();
                image.src = item.thumbnail;
                await image.decode();
                const canvas = document.createElement("canvas");
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                canvas.getContext("2d").drawImage(image, 0, 0);
                const pixels = canvas
                  .getContext("2d")
                  .getImageData(0, 0, canvas.width, canvas.height).data;
                return {
                  mode,
                  jpeg: item.thumbnail.startsWith("data:image/jpeg;base64,"),
                  width: image.naturalWidth,
                  height: image.naturalHeight,
                  picture: pixels.some((value, index) => index % 4 !== 3 && value > 40),
                  paused: !(item.element instanceof HTMLMediaElement) || item.element.paused,
                  time: item.element instanceof HTMLMediaElement ? item.element.currentTime : 0,
                };
              }
              for (const [kind, file] of [
                ["video", document.querySelector("#fixture").files[0]],
                [
                  "image",
                  new File([new Uint8Array(imageBytes)], "picture.png", { type: "image/png" }),
                ],
              ]) {
                const browser = new MediaLibrary();
                let base;
                try {
                  base = await browser.import(file);
                  snapshots.push(await inspect(`${kind}:browser`, browser, base));
                  browser.clear();
                  // The cache-restoration entry point receives the saved File plus asset metadata.
                  await browser.import(file, JSON.parse(JSON.stringify(base)));
                  snapshots.push(await inspect(`${kind}:cached-file`, browser, base));
                } finally {
                  browser.clear();
                }
                const sourceId = kind === "video" ? "managed-source" : "managed-image";
                const cases = [
                  ["copied", { mediaId: sourceId }],
                  [
                    "reference",
                    { mediaId: `external-${(kind === "video" ? "e" : "f").repeat(64)}` },
                  ],
                  ["stale-thumbnail", { mediaId: sourceId, thumbnailId: "missing-cover" }],
                  ...(kind === "video"
                    ? [
                        [
                          "proxy",
                          {
                            mediaId: "missing-original",
                            proxyId: sourceId,
                            thumbnailId: "missing-cover",
                          },
                        ],
                      ]
                    : [["legacy-thumbnail-only", { thumbnailId: sourceId }]]),
                ];
                for (const [mode, source] of cases) {
                  const library = new MediaLibrary();
                  const restored = JSON.parse(JSON.stringify({ ...base, ...source }));
                  try {
                    await library.connectManaged(restored);
                    if (kind === "video") {
                      const project = createProject();
                      project.assets = [restored];
                      project.clips = [
                        { id: "cover", assetId: restored.id, inFrame: 0, outFrame: 60, volume: 1 },
                      ];
                      await library.seek(project, 0);
                    }
                    snapshots.push(await inspect(`${kind}:${mode}`, library, restored));
                  } finally {
                    library.clear();
                  }
                }
              }
              return snapshots;
            },
            [...imageBytes],
          ),
        );
        assert.equal(result.length, 12);
        for (const snapshot of result) {
          assert.equal(snapshot.missing, undefined, snapshot.mode);
          assert.equal(snapshot.jpeg, true, snapshot.mode);
          assert.equal(snapshot.width, 320, snapshot.mode);
          assert.equal(snapshot.height, 180, snapshot.mode);
          assert.equal(snapshot.picture, true, snapshot.mode);
          assert.equal(snapshot.paused, true, snapshot.mode);
          assert.equal(snapshot.time, 0, snapshot.mode);
        }
      },
    );

    await mediaTest(
      "a seeked source is not published until its real frame notification arrives",
      async () => {
        const result = await withMediaPage((page) =>
          page.evaluate(async () => {
            const { MediaLibrary } = window.videoMedia;
            const prototype = HTMLVideoElement.prototype;
            const request = prototype.requestVideoFrameCallback;
            const library = new MediaLibrary();
            let decoder, deliver, notify;
            const notified = new Promise((resolve) => {
              notify = resolve;
            });
            prototype.requestVideoFrameCallback = function (callback) {
              decoder = this;
              return request.call(this, (...args) => {
                // Keep the real decoded frame, but deliver its notification late.
                deliver = () => callback(...args);
                notify();
              });
            };
            try {
              const pending = library.import(document.querySelector("#fixture").files[0]);
              await notified;
              if (decoder.seeking)
                await new Promise((resolve) =>
                  decoder.addEventListener("seeked", resolve, { once: true }),
                );
              const before = {
                published: library.items.size,
                connected: decoder.isConnected,
                paused: decoder.paused,
                time: decoder.currentTime,
              };
              deliver();
              const asset = await pending;
              const item = library.items.get(asset.id);
              return {
                before,
                jpeg: item.thumbnail?.startsWith("data:image/jpeg;base64,"),
                paused: item.element.paused,
                time: item.element.currentTime,
              };
            } finally {
              prototype.requestVideoFrameCallback = request;
              library.clear();
            }
          }),
        );
        assert.deepEqual(result.before, { published: 0, connected: false, paused: true, time: 0 });
        assert.equal(result.jpeg, true);
        assert.equal(result.paused, true);
        assert.equal(result.time, 0);
      },
    );

    await mediaTest(
      "optional frame waits fall back without the API and clean up errors, timeout and cancellation",
      async () => {
        const results = await withMediaPage((page) =>
          page.evaluate(async () => {
            const { MediaLibrary } = window.videoMedia;
            const prototype = HTMLVideoElement.prototype;
            const request = prototype.requestVideoFrameCallback;
            const cancel = prototype.cancelVideoFrameCallback;
            const results = [];
            try {
              for (const mode of ["absent", "throw", "error", "timeout", "cancel"]) {
                const library = new MediaLibrary();
                let cancelled = 0,
                  requested;
                const requestSeen = new Promise((resolve) => {
                  requested = resolve;
                });
                prototype.requestVideoFrameCallback =
                  mode === "absent"
                    ? undefined
                    : function () {
                        requested();
                        if (mode === "throw") throw new Error("frame notifications unavailable");
                        if (mode === "error")
                          queueMicrotask(() => this.dispatchEvent(new Event("error")));
                        return 999_999;
                      };
                prototype.cancelVideoFrameCallback = function (handle) {
                  cancelled++;
                  cancel.call(this, handle);
                };
                const start = performance.now();
                try {
                  const pending = library.import(document.querySelector("#fixture").files[0]).then(
                    (asset) => ({ asset }),
                    (error) => ({ error: String(error) }),
                  );
                  if (mode === "cancel") {
                    await requestSeen;
                    library.clear();
                  }
                  const outcome = await pending;
                  const item = outcome.asset && library.items.get(outcome.asset.id);
                  if (item?.element.seeking)
                    await new Promise((resolve) =>
                      item.element.addEventListener("seeked", resolve, { once: true }),
                    );
                  results.push({
                    mode,
                    cancelled,
                    elapsed: performance.now() - start,
                    error: outcome.error,
                    count: library.items.size,
                    thumbnail: !!item?.thumbnail,
                    paused: item?.element.paused,
                    time: item?.element.currentTime,
                    ready: item?.element.readyState,
                  });
                } finally {
                  library.clear();
                }
              }
            } finally {
              prototype.requestVideoFrameCallback = request;
              prototype.cancelVideoFrameCallback = cancel;
            }
            return results;
          }),
        );
        for (const result of results) {
          assert.ok(result.elapsed < 3000, JSON.stringify(result));
          if (result.mode === "cancel") {
            assert.match(result.error, /素材读取已取消/);
            assert.equal(result.count, 0);
          } else {
            assert.equal(result.error, undefined, result.mode);
            assert.equal(result.count, 1, result.mode);
            assert.equal(result.thumbnail, result.mode === "absent", result.mode);
            assert.equal(result.paused, true, result.mode);
            assert.equal(result.time, 0, result.mode);
            assert.equal(result.ready, 0, "import releases its decoder after retaining the cover");
          }
          assert.equal(
            result.cancelled,
            ["error", "timeout", "cancel"].includes(result.mode) ? 1 : 0,
            result.mode,
          );
        }
      },
    );

    await mediaTest(
      "a real black WebM first frame is a valid cover and stays paused at zero",
      async () => {
        const result = await withMediaPage((page) =>
          page.evaluate(async () => {
            const { MediaLibrary } = window.videoMedia;
            const source = document.createElement("canvas");
            source.width = 160;
            source.height = 90;
            const ctx = source.getContext("2d");
            ctx.fillStyle = "black";
            ctx.fillRect(0, 0, 160, 90);
            const stream = source.captureStream(30);
            const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
            const chunks = [];
            recorder.ondataavailable = (event) => {
              if (event.data.size) chunks.push(event.data);
            };
            const stopped = new Promise((resolve) => {
              recorder.onstop = resolve;
            });
            const library = new MediaLibrary();
            try {
              recorder.start();
              for (let i = 0; i < 6; i++) {
                ctx.fillRect(0, 0, 160, 90);
                await new Promise((resolve) => setTimeout(resolve, 35));
              }
              recorder.stop();
              await stopped;
              const asset = await library.import(
                new File(chunks, "black.webm", { type: "video/webm" }),
              );
              const item = library.items.get(asset.id);
              const image = new Image();
              image.src = item.thumbnail;
              await image.decode();
              ctx.drawImage(image, 0, 0, 160, 90);
              const pixels = ctx.getImageData(0, 0, 160, 90).data;
              return {
                jpeg: item.thumbnail.startsWith("data:image/jpeg;base64,"),
                black: pixels.every((value, index) => index % 4 === 3 || value < 8),
                frames: asset.durationFrames,
                paused: item.element.paused,
                time: item.element.currentTime,
              };
            } finally {
              if (recorder.state !== "inactive") recorder.stop();
              stream.getTracks().forEach((track) => track.stop());
              library.clear();
            }
          }),
        );
        assert.equal(result.jpeg, true);
        assert.equal(result.black, true);
        assert.ok(result.frames > 1);
        assert.equal(result.paused, true);
        assert.equal(result.time, 0);
      },
    );

    await mediaTest(
      "lazy recovery for another asset leaves the active source player and ownership untouched",
      async () => {
        const result = await withMediaPage((page) =>
          page.evaluate(async () => {
            const { MediaLibrary, createProject } = window.videoMedia;
            const library = new MediaLibrary();
            try {
              const asset = await library.import(document.querySelector("#fixture").files[0]);
              asset.mediaId = "managed-source";
              await library.connectManaged(asset);
              const project = createProject();
              project.assets = [asset];
              project.clips = [
                { id: "clip", assetId: asset.id, inFrame: 0, outFrame: 90, volume: 1 },
              ];
              await library.seek(project, 30);
              const item = library.items.get(asset.id);
              const element = item.element;
              let seekEvents = 0;
              element.addEventListener("seeking", () => {
                seekEvents++;
              });
              element.muted = true;
              await element.play();
              const owner = library.claimPlayback();
              const before = element.currentTime;
              await library.connectManaged({ ...asset, thumbnailId: "missing-cover" });
              await library.connectManaged({
                ...asset,
                id: "other-asset",
                thumbnailId: "missing-cover",
              });
              return {
                before,
                after: element.currentTime,
                paused: element.paused,
                seekEvents,
                sameElement: library.items.get(asset.id) === item,
                ownsPlayback: library.ownsPlayback(owner),
                otherDormant: !library.items.get("other-asset").element.hasAttribute("src"),
              };
            } finally {
              library.clear();
            }
          }),
        );
        assert.ok(result.after >= result.before, JSON.stringify(result));
        assert.equal(result.paused, false);
        assert.equal(result.seekEvents, 0);
        assert.equal(result.sameElement, true);
        assert.equal(result.ownsPlayback, true);
        assert.equal(result.otherDormant, true);
      },
    );

    await mediaTest(
      "trimmed and reordered media keep early source clocks inside each timeline segment",
      { timeout: 15_000 },
      async () => {
        const result = await withMediaPage((page) =>
          page.evaluate(async () => {
            const { MediaLibrary, createProject, playSequence, formatTime } = window.videoMedia;
            const runs = [];
            for (const independentAudio of [false, true]) {
              const library = new MediaLibrary();
              const controller = new AbortController();
              const voices = new Map();
              const createVoice = library.createAudioVoice.bind(library);
              library.createAudioVoice = async (assetId) => {
                const voice = await createVoice(assetId);
                voices.set(voices.size, voice.element);
                return voice;
              };
              const timer = setTimeout(() => controller.abort(), 8_000);
              try {
                const asset = await library.import(document.querySelector("#fixture").files[0]);
                const project = createProject();
                const demo = { id: "backdrop", name: "Backdrop", kind: "demo", durationFrames: 90 };
                project.width = 160;
                project.height = 90;
                project.assets = independentAudio ? [asset, demo] : [asset];
                // Later source material appears first, with a nonzero source in point
                // in both segments. Independent voices exercise the narration clock.
                const inPoints = [60, 30];
                project.clips = inPoints.map((inFrame, index) => ({
                  id: `picture-${index}`,
                  assetId: independentAudio ? demo.id : asset.id,
                  inFrame,
                  outFrame: inFrame + 18,
                  volume: independentAudio ? 0 : 1,
                }));
                project.audioClips = independentAudio
                  ? inPoints.map((inFrame, index) => ({
                      id: `voice-${index}`,
                      assetId: asset.id,
                      startFrame: index * 18,
                      inFrame,
                      outFrame: inFrame + 18,
                      volume: 1,
                    }))
                  : [];
                project.captions = [];
                const frames = [],
                  earlySamples = [],
                  afterSeek = [],
                  plays = [];
                let segment = -1,
                  resumeClock;
                await playSequence(
                  project,
                  library,
                  document.querySelector("#preview"),
                  0,
                  controller.signal,
                  (frame) => {
                    formatTime(frame); // Keep the real strict timecode contract exercised.
                    frames.push(frame);
                    if (resumeClock) {
                      afterSeek.push(frame);
                      plays.push(resumeClock.play());
                      resumeClock = undefined;
                    }
                    if (segment >= 0 && frame < segment * 18)
                      throw new Error(`Playback escaped segment ${segment}: ${frame}`);
                  },
                  {
                    onReady: async () => {
                      segment++;
                      const element = independentAudio
                        ? voices.get(segment)
                        : library.items.get(asset.id).element;
                      // Use real decoded media and a real seek, with a 5 ms early
                      // source clock (within the production seek tolerance). Pausing
                      // here makes the boundary deterministic without mocking time.
                      element.pause();
                      await new Promise((resolve, reject) => {
                        element.addEventListener("seeked", resolve, { once: true });
                        element.addEventListener("error", reject, { once: true });
                        element.currentTime = inPoints[segment] / 30 - 0.005;
                      });
                      earlySamples.push(
                        segment * 18 + Math.floor(element.currentTime * 30) - inPoints[segment],
                      );
                      resumeClock = element;
                    },
                  },
                );
                await Promise.all(plays);
                runs.push({
                  independentAudio,
                  earlySamples,
                  afterSeek,
                  finalFrame: frames.at(-1),
                  aborted: controller.signal.aborted,
                });
              } finally {
                clearTimeout(timer);
                controller.abort();
                library.clear();
                await library.audio?.close();
              }
            }
            return runs;
          }),
        );
        for (const run of result) {
          assert.deepEqual(run.earlySamples, [-1, 17], JSON.stringify(run));
          assert.deepEqual(run.afterSeek, [0, 18], JSON.stringify(run));
          assert.equal(run.finalFrame, 36, JSON.stringify(run));
          assert.equal(run.aborted, false, "Playback must still reach the end using its raw clock");
        }
      },
    );

    await mediaTest(
      "an aborted playback finishing late cannot pause or update its replacement",
      { timeout: 15_000 },
      async () => {
        const result = await withMediaPage((page) =>
          page.evaluate(async () => {
            const { MediaLibrary, createProject, playSequence } = window.videoMedia;
            const library = new MediaLibrary();
            const firstController = new AbortController(),
              secondController = new AbortController();
            let releaseFirst, firstStarted, secondStarted;
            const held = new Promise((resolve) => {
              releaseFirst = resolve;
            });
            const entered = new Promise((resolve) => {
              firstStarted = resolve;
            });
            const advancing = new Promise((resolve) => {
              secondStarted = resolve;
            });
            const firstFrames = [],
              secondFrames = [];
            let first, second;
            try {
              const asset = await library.import(document.querySelector("#fixture").files[0]);
              const project = createProject();
              project.width = 160;
              project.height = 90;
              project.assets = [asset];
              project.clips = [
                { id: "clip", assetId: asset.id, inFrame: 0, outFrame: 90, volume: 1 },
              ];
              const canvas = document.querySelector("#preview");
              first = playSequence(
                project,
                library,
                canvas,
                0,
                firstController.signal,
                (frame) => firstFrames.push(frame),
                {
                  onReady: async () => {
                    firstStarted();
                    await held;
                  },
                },
              );
              await entered;
              firstController.abort();
              library.pause(); // Same immediate stop action as the user pressing pause.
              const firstCountAtAbort = firstFrames.length;
              second = playSequence(
                project,
                library,
                canvas,
                0,
                secondController.signal,
                (frame) => {
                  secondFrames.push(frame);
                  if (frame >= 4) secondStarted();
                },
              );
              await Promise.race([
                advancing,
                new Promise((_, reject) =>
                  setTimeout(
                    () => reject(new Error("Replacement playback did not advance")),
                    5_000,
                  ),
                ),
              ]);
              const beforeCleanup = secondFrames.at(-1);
              releaseFirst();
              await first;
              await new Promise((resolve) => setTimeout(resolve, 300));
              return {
                firstCountAtAbort,
                firstCountAfterCleanup: firstFrames.length,
                beforeCleanup,
                afterCleanup: secondFrames.at(-1),
                replacementPaused: library.items.get(asset.id).element.paused,
              };
            } finally {
              firstController.abort();
              secondController.abort();
              releaseFirst();
              await Promise.allSettled([first, second]);
              library.clear();
              await library.audio?.close();
            }
          }),
        );
        assert.ok(
          result.firstCountAtAbort > 0,
          "The original playback never reached a real decoded frame",
        );
        assert.equal(result.firstCountAfterCleanup, result.firstCountAtAbort);
        assert.equal(result.replacementPaused, false, JSON.stringify(result));
        assert.ok(result.afterCleanup >= result.beforeCleanup + 4, JSON.stringify(result));
      },
    );

    await mediaTest(
      "encoder construction failure stops only its real canvas video tracks",
      async () => {
        const result = await withMediaPage((page) =>
          page.evaluate(async () => {
            const { MediaLibrary, createProject, recordSequence } = window.videoMedia;
            const library = new MediaLibrary();
            const NativeRecorder = window.MediaRecorder;
            let videoTracks = [],
              audioTracks = [];
            try {
              const asset = await library.import(document.querySelector("#fixture").files[0]);
              const project = createProject();
              project.width = 160;
              project.height = 90;
              project.assets = [asset];
              project.clips = [
                { id: "clip", assetId: asset.id, inFrame: 0, outFrame: 30, volume: 1 },
              ];
              // Only the constructor failure is injected. Its input is the real
              // canvas capture stream and shared Web Audio destination from production.
              window.MediaRecorder = new Proxy(NativeRecorder, {
                construct(_target, [stream]) {
                  videoTracks = stream.getVideoTracks();
                  audioTracks = stream.getAudioTracks();
                  throw new DOMException(
                    "Injected encoder allocation failure",
                    "NotSupportedError",
                  );
                },
              });
              try {
                await recordSequence(project, library, new AbortController().signal, () => {});
                return { rejected: false };
              } catch (error) {
                return {
                  rejected: true,
                  name: error.name,
                  videoStates: videoTracks.map((track) => track.readyState),
                  audioStates: audioTracks.map((track) => track.readyState),
                  audioIsShared: audioTracks[0] === library.destination.stream.getAudioTracks()[0],
                };
              }
            } finally {
              window.MediaRecorder = NativeRecorder;
              library.clear();
              await library.audio?.close();
            }
          }),
        );
        assert.equal(result.rejected, true);
        assert.equal(result.name, "NotSupportedError");
        assert.deepEqual(result.videoStates, ["ended"]);
        assert.deepEqual(result.audioStates, ["live"]);
        assert.equal(result.audioIsShared, true);
      },
    );

    await mediaTest(
      "exports audible WebM, supports 0/1/2 gains, reimports it, and excludes seek waits",
      { timeout: 30_000 },
      async () => {
        const result = await withMediaPage((page) =>
          page.evaluate(async () => {
            const { MediaLibrary, createProject, recordSequence } = window.videoMedia;
            // Inject latency around the real seek, then still decode, play and record
            // actual files. This makes accidental inclusion of seek waits observable.
            class SlowSeekingLibrary extends MediaLibrary {
              async seek(project, frame) {
                if (frame > 0) await new Promise((resolve) => setTimeout(resolve, 600));
                await super.seek(project, frame);
              }
            }
            const library = new SlowSeekingLibrary();
            const restored = new MediaLibrary();
            const analysis = new AudioContext();
            try {
              const asset = await library.import(document.querySelector("#fixture").files[0]);
              const project = createProject();
              project.width = 160;
              project.height = 90;
              project.assets = [asset];
              project.clips = [0, 1, 2].map((volume, index) => ({
                id: `clip-${index}`,
                assetId: asset.id,
                inFrame: index * 30,
                outFrame: index * 30 + 24,
                volume,
              }));
              // Leave the preview at a different point before export; recording must
              // seek back to the first clip rather than retaining its current state.
              await library.seek(project, 48);
              const started = performance.now();
              let finalFrame = -1;
              const output = await recordSequence(
                project,
                library,
                new AbortController().signal,
                (frame) => {
                  finalFrame = frame;
                },
              );
              const wallSeconds = (performance.now() - started) / 1_000;
              const imported = await restored.import(
                new File([output], "roundtrip.webm", { type: "video/webm" }),
              );
              const decoded = await analysis.decodeAudioData(await output.arrayBuffer());
              const samples = decoded.getChannelData(0);
              const rms = (start, end) => {
                const from = Math.floor(start * decoded.sampleRate),
                  to = Math.min(samples.length, Math.floor(end * decoded.sampleRate));
                let sum = 0;
                for (let index = from; index < to; index++) sum += samples[index] ** 2;
                return Math.sqrt(sum / Math.max(1, to - from));
              };
              return {
                bytes: output.size,
                type: output.type,
                finalFrame,
                wallSeconds,
                importedWidth: imported.width,
                importedHeight: imported.height,
                importedSeconds: imported.durationFrames / 30,
                restoredTime: restored.items.get(imported.id).element.currentTime,
                audioChannels: decoded.numberOfChannels,
                audioSeconds: decoded.duration,
                muted: rms(0.25, 0.55),
                normal: rms(1.05, 1.35),
                doubled: rms(1.85, 2.15),
                sourcePaused: library.items.get(asset.id).element.paused,
              };
            } finally {
              library.clear();
              restored.clear();
              await library.audio?.close();
              await restored.audio?.close();
              await analysis.close();
            }
          }),
        );
        assert.ok(result.bytes > 1_000, JSON.stringify(result));
        assert.match(result.type, /^video\/webm/);
        assert.equal(result.finalFrame, 72);
        assert.equal(result.importedWidth, 160);
        assert.equal(result.importedHeight, 90);
        assert.ok(Math.abs(result.restoredTime) < 0.02, JSON.stringify(result));
        assert.ok(result.audioChannels >= 1);
        assert.ok(result.normal > 0.005, `Source audio is missing: ${JSON.stringify(result)}`);
        assert.ok(
          result.muted < 0.001,
          `Gain 0 did not mute the source: ${JSON.stringify(result)}`,
        );
        assert.ok(
          result.doubled / result.normal > 1.65 && result.doubled / result.normal < 2.35,
          `Gain 2 did not amplify source audio: ${JSON.stringify(result)}`,
        );
        assert.ok(
          result.importedSeconds >= 2.2 && result.importedSeconds < 3.0,
          JSON.stringify(result),
        );
        assert.ok(result.audioSeconds >= 2.2 && result.audioSeconds < 3.0, JSON.stringify(result));
        assert.ok(
          result.wallSeconds >= 3.4,
          `Latency fixture did not run: ${JSON.stringify(result)}`,
        );
        assert.ok(
          result.wallSeconds - result.importedSeconds > 0.8,
          `Seek waits leaked into export: ${JSON.stringify(result)}`,
        );
        assert.equal(result.sourcePaused, true);
        t.diagnostic(
          `Recorded 2.4 s: video ${result.importedSeconds.toFixed(3)} s, audio ${result.audioSeconds.toFixed(3)} s; wall ${result.wallSeconds.toFixed(3)} s including 1.2 s of seek waits.`,
        );
      },
    );

    await mediaTest(
      "reconnects managed media and captures a real JPEG without seeking the preview",
      async () => {
        const result = await withMediaPage((page) =>
          page.evaluate(async () => {
            const { MediaLibrary, createProject, captureAssetFrame } = window.videoMedia;
            const importing = new MediaLibrary(),
              library = new MediaLibrary();
            try {
              const asset = await importing.import(document.querySelector("#fixture").files[0]);
              asset.mediaId = "managed-source";
              importing.clear();
              await library.connectManaged(asset);
              const project = createProject();
              project.assets = [asset];
              project.clips = [
                { id: "clip", assetId: asset.id, inFrame: 0, outFrame: 90, volume: 1 },
              ];
              await library.seek(project, 30);
              const before = library.items.get(asset.id).element.currentTime;
              const capture = await captureAssetFrame(library, asset.id, 2.5);
              const after = library.items.get(asset.id).element.currentTime;
              const image = new Image();
              await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = reject;
                image.src = `data:${capture.mediaType};base64,${capture.data}`;
              });
              const canvas = document.createElement("canvas");
              canvas.width = image.naturalWidth;
              canvas.height = image.naturalHeight;
              canvas.getContext("2d").drawImage(image, 0, 0);
              const pixels = canvas
                .getContext("2d")
                .getImageData(0, 0, canvas.width, canvas.height).data;
              return {
                before,
                after,
                fileIsAbsent: !library.items.get(asset.id).file,
                width: capture.width,
                height: capture.height,
                bytes: capture.data.length,
                jpeg: capture.data.startsWith("/9j/"),
                pixels: pixels.some((value, index) => index % 4 !== 3 && value > 40),
              };
            } finally {
              importing.clear();
              library.clear();
            }
          }),
        );
        assert.equal(result.fileIsAbsent, true);
        assert.ok(
          Math.abs(result.before - 1) < 0.02 && Math.abs(result.after - result.before) < 0.001,
          JSON.stringify(result),
        );
        assert.equal(result.width, 160);
        assert.equal(result.height, 90);
        assert.ok(result.bytes > 500 && result.bytes < 200000);
        assert.equal(result.jpeg, true);
        assert.equal(result.pixels, true);
      },
    );

    await mediaTest(
      "clearing the project rejects stale managed decoding without replacing the new project",
      async () => {
        const result = await withMediaPage((page) =>
          page.evaluate(async () => {
            const { MediaLibrary } = window.videoMedia;
            const library = new MediaLibrary();
            try {
              const asset = await library.import(document.querySelector("#fixture").files[0]);
              const old = { ...asset, id: "old-project", mediaId: "slow-source" };
              const current = { ...asset, id: "new-project", mediaId: "managed-source" };
              const pending = library.connectManaged(old, { inspect: true }).then(
                () => false,
                () => true,
              );
              library.clear();
              await library.connectManaged(current);
              const rejected = await pending;
              return {
                rejected,
                oldPresent: library.items.has(old.id),
                currentPresent: library.items.has(current.id),
                width: library.items.get(current.id).width,
                count: library.items.size,
              };
            } finally {
              library.clear();
            }
          }),
        );
        assert.equal(result.rejected, true);
        assert.equal(result.oldPresent, false);
        assert.equal(result.currentPresent, true);
        assert.equal(result.width, 160);
        assert.equal(result.count, 1);
      },
    );

    await mediaTest(
      "free timeline gaps stay black, preserve time, and retain independent audio in WebM",
      { timeout: 15_000 },
      async () => {
        const result = await withMediaPage((page) =>
          page.evaluate(async () => {
            const { MediaLibrary, createProject, recordSequence, renderFrame } = window.videoMedia;
            const library = new MediaLibrary();
            const restored = new MediaLibrary();
            const decoder = new AudioContext();
            try {
              const asset = await library.import(document.querySelector("#fixture").files[0]);
              const project = createProject();
              project.width = 160;
              project.height = 90;
              project.timelineMode = "free";
              project.assets = [asset];
              project.captions = [];
              project.clips = [
                {
                  id: "first",
                  assetId: asset.id,
                  startFrame: 15,
                  inFrame: 0,
                  outFrame: 15,
                  volume: 0.5,
                },
                {
                  id: "second",
                  assetId: asset.id,
                  startFrame: 60,
                  inFrame: 60,
                  outFrame: 75,
                  volume: 0.5,
                },
              ];
              project.audioClips = [
                {
                  id: "voice",
                  assetId: asset.id,
                  startFrame: 30,
                  inFrame: 30,
                  outFrame: 60,
                  volume: 0.6,
                },
              ];
              const canvas = document.querySelector("#preview");
              const black = () =>
                canvas
                  .getContext("2d")
                  .getImageData(0, 0, 160, 90)
                  .data.every((value, index) => index % 4 === 3 || value < 3);
              let leading = false,
                internal = false,
                gapSourcePaused = false,
                finalFrame = -1;
              const output = await recordSequence(
                project,
                library,
                new AbortController().signal,
                (frame) => {
                  finalFrame = frame;
                  renderFrame(canvas, project, library, frame);
                  if (frame >= 4 && frame < 12) leading ||= black();
                  if (frame >= 36 && frame < 48) {
                    internal ||= black();
                    gapSourcePaused ||= library.items.get(asset.id).element.paused;
                  }
                },
              );
              const audio = await decoder.decodeAudioData(await output.arrayBuffer());
              const samples = audio.getChannelData(0);
              const rms = (start, end) => {
                let energy = 0,
                  count = 0;
                for (
                  let i = Math.floor(start * audio.sampleRate);
                  i < Math.min(samples.length, end * audio.sampleRate);
                  i++
                ) {
                  energy += samples[i] ** 2;
                  count++;
                }
                return Math.sqrt(energy / Math.max(1, count));
              };
              const imported = await restored.import(
                new File([output], "gaps.webm", { type: "video/webm" }),
              );
              const decodedProject = createProject();
              decodedProject.width = 160;
              decodedProject.height = 90;
              decodedProject.assets = [imported];
              decodedProject.captions = [];
              decodedProject.audioClips = [];
              decodedProject.clips = [
                {
                  id: "rendered",
                  assetId: imported.id,
                  inFrame: 0,
                  outFrame: imported.durationFrames,
                  volume: 1,
                },
              ];
              const encodedBlack = [];
              for (const frame of [6, 42]) {
                await restored.seek(decodedProject, frame);
                renderFrame(canvas, decodedProject, restored, frame);
                encodedBlack.push(black());
              }
              return {
                leading,
                internal,
                gapSourcePaused,
                finalFrame,
                encodedBlack,
                duration: audio.duration,
                importedSeconds: imported.durationFrames / 30,
                silent: rms(0.12, 0.32),
                first: rms(0.65, 0.85),
                voice: rms(1.3, 1.65),
                second: rms(2.1, 2.3),
              };
            } finally {
              library.clear();
              restored.clear();
              await library.audio?.close();
              await restored.audio?.close();
              await decoder.close();
            }
          }),
        );
        assert.equal(result.finalFrame, 75, JSON.stringify(result));
        assert.equal(result.leading, true);
        assert.equal(result.internal, true);
        assert.equal(result.gapSourcePaused, true);
        assert.deepEqual(result.encodedBlack, [true, true]);
        assert.ok(Math.abs(result.duration - 2.5) < 0.2, JSON.stringify(result));
        assert.ok(Math.abs(result.importedSeconds - 2.5) < 0.2, JSON.stringify(result));
        assert.ok(result.silent < 0.0001, JSON.stringify(result));
        assert.ok(
          result.first > 0.005 && result.voice > 0.005 && result.second > 0.005,
          JSON.stringify(result),
        );
      },
    );

    await mediaTest(
      "records overlapping independent audio clips from one asset at their own source times",
      { timeout: 20000 },
      async () => {
        const result = await withMediaPage((page) =>
          page.evaluate(async () => {
            const { MediaLibrary, createProject, recordSequence } = window.videoMedia;
            class ObservedLibrary extends MediaLibrary {
              created = [];
              async createAudioVoice(id) {
                const voice = await super.createAudioVoice(id);
                this.created.push(voice);
                return voice;
              }
            }
            const library = new ObservedLibrary(),
              decoder = new AudioContext();
            try {
              const asset = await library.import(document.querySelector("#fixture").files[0]);
              const project = createProject();
              project.width = 160;
              project.height = 90;
              project.assets = [asset];
              project.clips = [
                { id: "main", assetId: asset.id, inFrame: 0, outFrame: 72, volume: 0 },
              ];
              project.audioClips = [
                {
                  id: "first",
                  assetId: asset.id,
                  startFrame: 12,
                  inFrame: 0,
                  outFrame: 30,
                  volume: 1,
                },
                {
                  id: "second",
                  assetId: asset.id,
                  startFrame: 24,
                  inFrame: 0,
                  outFrame: 30,
                  volume: 0.4,
                },
              ];
              let overlap;
              const output = await recordSequence(
                project,
                library,
                new AbortController().signal,
                (frame) => {
                  if (!overlap && frame >= 31 && frame < 40 && library.created.length === 2) {
                    const [a, b] = library.created.map((voice) => voice.element);
                    overlap = {
                      separate: a !== b && a !== library.items.get(asset.id).element,
                      playing: !a.paused && !b.paused,
                      delta: a.currentTime - b.currentTime,
                    };
                  }
                },
              );
              const audio = await decoder.decodeAudioData(await output.arrayBuffer()),
                samples = audio.getChannelData(0);
              const rms = (start, end) => {
                let sum = 0,
                  count = 0;
                for (
                  let i = Math.floor(start * audio.sampleRate);
                  i < Math.min(samples.length, end * audio.sampleRate);
                  i++
                ) {
                  sum += samples[i] ** 2;
                  count++;
                }
                return Math.sqrt(sum / Math.max(1, count));
              };
              return {
                overlap,
                before: rms(0.1, 0.25),
                first: rms(0.6, 0.7),
                second: rms(1.55, 1.7),
                after: rms(2.1, 2.25),
                duration: audio.duration,
                released: library.created.every(
                  (voice) => voice.element.paused && !voice.element.getAttribute("src"),
                ),
              };
            } finally {
              library.clear();
              await library.audio?.close();
              await decoder.close();
            }
          }),
        );
        assert.equal(result.overlap?.separate, true, JSON.stringify(result));
        assert.equal(result.overlap?.playing, true, JSON.stringify(result));
        assert.ok(result.overlap.delta > 0.3 && result.overlap.delta < 0.5, JSON.stringify(result));
        assert.ok(result.before < 0.001 && result.after < 0.001, JSON.stringify(result));
        assert.ok(result.first > 0.005 && result.second > 0.002, JSON.stringify(result));
        assert.ok(result.duration > 2.2 && result.duration < 3, JSON.stringify(result));
        assert.equal(result.released, true);
      },
    );

    await mediaTest(
      "bundled narration reconnects and produces audible browser WebM",
      { timeout: 12000 },
      async () => {
        const result = await withMediaPage((page) =>
          page.evaluate(async () => {
            const {
              MediaLibrary,
              createNarratedDemoProject,
              isDemoNarration,
              recordSequence,
              validateProject,
            } = window.videoMedia;
            const library = new MediaLibrary(),
              decoder = new AudioContext();
            try {
              const demo = createNarratedDemoProject(),
                asset = demo.assets.find(isDemoNarration);
              await library.connectBuiltin(asset);
              const sourceDuration = library.items.get(asset.id).element.duration;
              const project = validateProject({
                ...demo,
                width: 160,
                height: 90,
                clips: [{ ...demo.clips[0], outFrame: 90 }],
                audioClips: [{ ...demo.audioClips[0], outFrame: 90 }],
                captions: [],
              });
              const blob = await recordSequence(
                project,
                library,
                new AbortController().signal,
                () => {},
              );
              const decoded = await decoder.decodeAudioData(await blob.arrayBuffer()),
                samples = decoded.getChannelData(0);
              let energy = 0;
              for (const sample of samples) energy += sample * sample;
              return {
                sourceDuration,
                missing: library.missing(project).length,
                duration: decoded.duration,
                rms: Math.sqrt(energy / samples.length),
              };
            } finally {
              library.clear();
              await library.audio?.close();
              await decoder.close();
            }
          }),
        );
        assert.equal(result.sourceDuration, 24);
        assert.equal(result.missing, 0);
        assert.ok(result.duration > 2.9 && result.duration < 3.6, JSON.stringify(result));
        assert.ok(result.rms > 0.015, JSON.stringify(result));
      },
    );

    await mediaTest(
      "rejects export when the engineering data references an unconnected source",
      async () => {
        const result = await withMediaPage((page) =>
          page.evaluate(async () => {
            const { MediaLibrary, createProject, recordSequence } = window.videoMedia;
            const importing = new MediaLibrary();
            try {
              const asset = await importing.import(document.querySelector("#fixture").files[0]);
              const project = createProject();
              project.assets = [asset];
              project.clips = [
                { id: "clip", assetId: asset.id, inFrame: 0, outFrame: 30, volume: 1 },
              ];
              const disconnected = new MediaLibrary();
              try {
                await recordSequence(project, disconnected, new AbortController().signal, () => {});
                return { rejected: false };
              } catch (error) {
                return {
                  rejected: true,
                  message: error.message,
                  audioStarted: Boolean(disconnected.audio),
                };
              }
            } finally {
              importing.clear();
            }
          }),
        );
        assert.equal(result.rejected, true);
        assert.match(result.message, /缺失素材/);
        assert.equal(result.audioStarted, false);
      },
    );
  },
);
