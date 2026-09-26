import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const repository = fileURLToPath(new URL("../", import.meta.url));

test(
  "editor media pool prepares independent decoded local frames",
  { timeout: 60000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "editor-media-pool-"));
    let browser, server;
    t.after(async () => {
      await browser?.close();
      server?.closeAllConnections();
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    });
    const source = join(directory, "colors.mp4");
    const generated = spawnSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=red:s=96x64:r=10:d=3",
        "-vf",
        "drawbox=x=0:y=0:w=iw:h=ih:color=lime:t=fill:enable='gte(t,1)*lt(t,2)',drawbox=x=0:y=0:w=iw:h=ih:color=blue:t=fill:enable='gte(t,2)'",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "10",
        "-movflags",
        "+faststart",
        source,
      ],
      { timeout: 15000, encoding: "utf8" },
    );
    assert.equal(generated.status, 0, generated.stderr || String(generated.error));
    const webm = join(directory, "colors.webm");
    const webmGenerated = spawnSync("ffmpeg", [
      "-nostdin", "-v", "error", "-i", source, "-r", "30000/1001",
      "-c:v", "libvpx-vp9", "-y", webm,
    ], { timeout: 15000, encoding: "utf8" });
    assert.equal(webmGenerated.status, 0, webmGenerated.stderr || String(webmGenerated.error));
    const delayedWebm = join(directory, "delayed-video.webm");
    const delayedGenerated = spawnSync("ffmpeg", [
      "-nostdin", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono",
      "-itsoffset", "0.08", "-i", source, "-map", "1:v", "-map", "0:a",
      "-c:v", "libvpx-vp9", "-c:a", "libopus", "-t", "3", "-y", delayedWebm,
    ], { timeout: 15000, encoding: "utf8" });
    assert.equal(delayedGenerated.status, 0, delayedGenerated.stderr || String(delayedGenerated.error));
    const alternating = join(directory, "alternating.mp4");
    const alternatingGenerated = spawnSync("ffmpeg", [
      "-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=red:s=96x64:r=30:d=1",
      "-vf", "drawbox=x=0:y=0:w=iw:h=ih:color=blue:t=fill:enable='mod(n,2)'",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", alternating,
    ], { timeout:15000, encoding:"utf8" });
    assert.equal(alternatingGenerated.status,0,alternatingGenerated.stderr || String(alternatingGenerated.error));
    const gif = join(directory, "animated.gif");
    const animation = spawnSync(
      "ffmpeg",
      ["-nostdin", "-v", "error", "-i", source, "-vf", "fps=10", "-loop", "0", "-y", gif],
      { timeout: 15000, encoding: "utf8" },
    );
    assert.equal(animation.status, 0, animation.stderr || String(animation.error));
    const bundle = await build({
      stdin: {
        resolveDir: repository,
        sourcefile: "editor-pool-fixture.ts",
        contents: `
    import { EditorMediaPool } from "./apps/video-studio/src/editor/media-pool.ts";
    import { defaultTransform, defaultColorAdjustment } from "./apps/video-studio/src/editor/defaults.ts";
    const layer = (id, seconds, assetId="video", assetKind="video") => ({kind:"media",instanceId:id,sequenceId:"main",clipId:id,trackId:id,localTime:0,assetId,assetKind,sourceTime:Math.round(seconds*240000),naturalWidth:96,naturalHeight:64,transform:defaultTransform(),color:defaultColorAdjustment(),blendMode:"normal"});
    const frame = (layers) => ({sequenceId:"main",time:0,width:96,height:64,background:"#000000",layers,audio:[]});
    const sample = (surface) => {const canvas=document.createElement("canvas");canvas.width=96;canvas.height=64;const ctx=canvas.getContext("2d");ctx.drawImage(surface,0,0,96,64);return [...ctx.getImageData(48,32,1,1).data];};
    const videos=[];
    const create=document.createElement.bind(document);
    document.createElement=(tag,...args)=>{const element=create(tag,...args);if(tag==="video")videos.push(element);return element;};
    window.poolTest={EditorMediaPool,layer,frame,sample,videos};
  `,
      },
      bundle: true,
      platform: "browser",
      target: "es2022",
      format: "esm",
      write: false,
      logLevel: "silent",
    });
    const image = new PNG({ width: 96, height: 64 });
    for (let offset = 0; offset < image.data.length; offset += 4) {
      image.data[offset] = 255;
      image.data[offset + 1] = 220;
      image.data[offset + 2] = 0;
      image.data[offset + 3] = 255;
    }
    const routes = new Map([
      ["/delayed-webm", { type: "video/webm", body: await readFile(delayedWebm) }],
      [
        "/",
        {
          type: "text/html",
          body: Buffer.from('<!doctype html><script type="module" src="/fixture.mjs"></script>'),
        },
      ],
      [
        "/fixture.mjs",
        { type: "text/javascript", body: Buffer.from(bundle.outputFiles[0].contents) },
      ],
      ["/video", { type: "video/mp4", body: await readFile(source) }],
      ["/webm", { type: "video/webm", body: await readFile(webm) }],
      ["/alternating", { type: "video/mp4", body: await readFile(alternating) }],
      ["/image", { type: "image/png", body: PNG.sync.write(image) }],
      ["/animated", { type: "image/gif", body: await readFile(gif) }],
      ["/bad", { type: "video/mp4", body: Buffer.from("invalid video bytes") }],
    ]);
    routes.set("/slow", { ...routes.get("/video"), delay: 250 });
    server = createServer((request, response) => {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (path === "/hang") return;
      const resource = routes.get(path),
        range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
      if (!resource) {
        response.writeHead(404);
        response.end();
        return;
      }
      const start = range ? Number(range[1]) : 0,
        end =
          range && range[2]
            ? Math.min(Number(range[2]), resource.body.length - 1)
            : resource.body.length - 1;
      if (start >= resource.body.length) {
        response.writeHead(416);
        response.end();
        return;
      }
      const bytes = resource.body.subarray(start, end + 1);
      response.writeHead(range ? 206 : 200, {
        "Content-Type": resource.type,
        "Content-Length": bytes.length,
        "Accept-Ranges": "bytes",
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${resource.body.length}` } : {}),
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; media-src 'self' blob:; img-src 'self' blob:; connect-src 'self' blob:; object-src 'none'",
      });
      if (resource.delay) setTimeout(() => response.end(bytes), resource.delay);
      else response.end(bytes);
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    async function pageTest(run) {
      const page = await browser.newPage();
      try {
        await page.goto(address);
        await page.waitForFunction(() => Boolean(window.poolTest));
        return await run(page);
      } finally {
        await page.close();
      }
    }
    function color(pixel, expected) {
      expected.forEach((channel, index) =>
        assert.ok(Math.abs(pixel[index] - channel) < 8, `${pixel} should be ${expected}`),
      );
      assert.equal(pixel[3], 255);
    }

    await t.test(
      "same source has independent decoders and concurrently draw-ready different times",
      async () => {
        const result = await pageTest((page) =>
          page.evaluate(async () => {
            const { EditorMediaPool, layer, frame, sample } = window.poolTest;
            let resolves = 0;
            const pool = new EditorMediaPool({
              resolveAsset: () => {
                resolves++;
                return "/video";
              },
              timeoutMs: 2000,
            });
            try {
              const surfaces = await pool.prepare(frame([layer("one", 0.25), layer("two", 2.25)]));
              return {
                first: sample(surfaces.get("one")),
                second: sample(surfaces.get("two")),
                distinct: surfaces.get("one") !== surfaces.get("two"),
                times: window.poolTest.videos.map((video) => video.currentTime),
                paused: window.poolTest.videos.every((video) => video.paused),
                resolves,
              };
            } finally {
              pool.dispose();
            }
          }),
        );
        color(result.first, [255, 0, 0]);
        color(result.second, [0, 0, 255]);
        assert.equal(result.distinct, true);
        assert.deepEqual(result.times, [0.25, 2.25]);
        assert.equal(result.paused, true);
        assert.equal(result.resolves, 1);
      },
    );

    await t.test(
      "reverse order and held frames seek the same instance without using playback as a clock",
      async () => {
        const result = await pageTest((page) =>
          page.evaluate(async () => {
            const { EditorMediaPool, layer, frame, sample } = window.poolTest;
            const pool = new EditorMediaPool({ resolveAsset: () => "/video", timeoutMs: 2000 });
            try {
              const pixels = [],
                elements = [];
              for (const time of [2.25, 1.25, 0.25, 0.25, 0]) {
                const surface = (await pool.prepare(frame([layer("reverse", time)]))).get(
                  "reverse",
                );
                elements.push(surface);
                pixels.push(sample(surface));
              }
              return {
                pixels,
                reused: window.poolTest.videos.length === 1 && elements[2] === elements[3],
                paused: window.poolTest.videos[0].paused,
              };
            } finally {
              pool.dispose();
            }
          }),
        );
        [
          [0, 0, 255],
          [0, 255, 0],
          [255, 0, 0],
          [255, 0, 0],
          [255, 0, 0],
        ].forEach((expected, index) => color(result.pixels[index], expected));
        assert.equal(result.reused, true);
        assert.equal(result.paused, true);
      },
    );

    await t.test(
      "successive output ticks inside one source frame still finish with drawable pixels",
      async () => {
        const result = await pageTest((page) =>
          page.evaluate(async () => {
            const { EditorMediaPool, layer, frame, sample } = window.poolTest;
            const pool = new EditorMediaPool({ resolveAsset: () => "/video", timeoutMs: 1000 });
            try {
              const pixels = [];
              for (const time of [0.2, 0.21, 0.22, 0.23, 0.22, 0.20000416666666667])
                pixels.push(
                  sample(
                    (await pool.prepare(frame([layer("same-frame", time)]))).get("same-frame"),
                  ),
                );
              return pixels;
            } finally {
              pool.dispose();
            }
          }),
        );
        result.forEach((pixel) => color(pixel, [255, 0, 0]));
      },
    );

    await t.test(
      "paused decoded frames remain drawable when compositor callbacks do not arrive",
      async () => {
        const result = await pageTest((page) =>
          page.evaluate(async () => {
            const { EditorMediaPool, layer, frame, sample } = window.poolTest;
            const prototype = HTMLVideoElement.prototype;
            const request = prototype.requestVideoFrameCallback;
            const cancel = prototype.cancelVideoFrameCallback;
            let callbackId = 0;
            // A compositor callback is not a seek-completion event. Paused/offscreen
            // decoders may have no newly presented frame, even after decoding succeeds.
            // Keep real Chromium seeking, readyState, and canvas pixel reads intact.
            prototype.requestVideoFrameCallback = () => ++callbackId;
            prototype.cancelVideoFrameCallback = () => {};
            const pool = new EditorMediaPool({ resolveAsset: () => "/video", timeoutMs: 1000 });
            try {
              const samples = [];
              for (const time of [0, 0.001, 0.002, 2.25, 2.251, 1.25, 0]) {
                const surface = (await pool.prepare(frame([layer("paused", time)]))).get("paused");
                samples.push({
                  pixel: sample(surface), time: window.poolTest.videos[0].currentTime, paused: window.poolTest.videos[0].paused,
                });
              }
              return samples;
            } finally {
              pool.dispose();
              prototype.requestVideoFrameCallback = request;
              prototype.cancelVideoFrameCallback = cancel;
            }
          }),
        );
        const channels = [
          [255, 0, 0], [255, 0, 0], [255, 0, 0], [0, 0, 255],
          [0, 0, 255], [0, 255, 0], [255, 0, 0],
        ];
        result.forEach((value, index) => {
          color(value.pixel, channels[index]);
          assert.equal(value.paused, true);
          assert.ok(Math.abs(value.time - [0, 0.001, 0.002, 2.25, 2.251, 1.25, 0][index]) < 0.00001);
        });
      },
    );

    await t.test(
      "stale decoded surfaces are retried and frozen frames are closed on replacement",
      async () => {
        const result = await pageTest((page) => page.evaluate(async () => {
          const { EditorMediaPool, layer, frame, sample } = window.poolTest;
          const NativeFrame = window.VideoFrame;
          const request = HTMLVideoElement.prototype.requestVideoFrameCallback;
          const cancel = HTMLVideoElement.prototype.cancelVideoFrameCallback;
          HTMLVideoElement.prototype.requestVideoFrameCallback = () => 1;
          HTMLVideoElement.prototype.cancelVideoFrameCallback = () => {};
          const pool = new EditorMediaPool({ resolveAsset: () => "/video", timeoutMs: 1000 });
          let saved;
          const stale = [];
          try {
            const first = (await pool.prepare(frame([layer("clip", 0.25)]))).get("clip");
            saved = first.clone();
            window.VideoFrame = function(source) {
              if (source instanceof HTMLVideoElement && source.currentTime > 2 && stale.length < 3) {
                const old = saved.clone();
                stale.push(old);
                return old;
              }
              return new NativeFrame(source);
            };
            const next = (await pool.prepare(frame([layer("clip", 2.25)]))).get("clip");
            const pixel = sample(next);
            const firstClosed = first.displayWidth === 0;
            const staleClosed = stale.length === 3 && stale.every(value => value.displayWidth === 0);
            pool.dispose();
            return { pixel, firstClosed, staleClosed, finalClosed: next.displayWidth === 0 };
          } finally {
            pool.dispose();
            saved?.close();
            window.VideoFrame = NativeFrame;
            HTMLVideoElement.prototype.requestVideoFrameCallback = request;
            HTMLVideoElement.prototype.cancelVideoFrameCallback = cancel;
          }
        }));
        color(result.pixel, [0, 0, 255]);
        assert.equal(result.firstClosed, true);
        assert.equal(result.staleClosed, true);
        assert.equal(result.finalClosed, true);
      },
    );

    await t.test(
      "an exact frame timestamp remains usable with zero duration and no presentation callbacks",
      async () => {
        const result = await pageTest((page) => page.evaluate(async () => {
          const { EditorMediaPool, layer, frame, sample } = window.poolTest;
          const NativeFrame = window.VideoFrame;
          const request = HTMLVideoElement.prototype.requestVideoFrameCallback;
          HTMLVideoElement.prototype.requestVideoFrameCallback = undefined;
          window.VideoFrame = function(source) {
            const captured = new NativeFrame(source);
            Object.defineProperty(captured, "duration", { value: 0 });
            return captured;
          };
          const pool = new EditorMediaPool({ resolveAsset: () => "/video", timeoutMs: 500 });
          try {
            const output = [];
            for (const time of [0, 2, 1])
              output.push(sample((await pool.prepare(frame([layer("clip", time)]))).get("clip")));
            return output;
          } finally {
            pool.dispose();
            window.VideoFrame = NativeFrame;
            HTMLVideoElement.prototype.requestVideoFrameCallback = request;
          }
        }));
        [[255, 0, 0], [0, 0, 255], [0, 255, 0]].forEach((expected, i) => color(result[i], expected));
      },
    );

    await t.test("WebM with audio before its first video frame can seek to the beginning", async () => {
      const result = await pageTest((page) => page.evaluate(async () => {
        const { EditorMediaPool, layer, frame, sample } = window.poolTest;
        const pool = new EditorMediaPool({ resolveAsset: () => "/delayed-webm", timeoutMs: 1000 });
        try {
          const first = (await pool.prepare(frame([layer("clip", 0)]))).get("clip");
          return { timestamp: first.timestamp, pixel: sample(first) };
        } finally { pool.dispose(); }
      }));
      assert.ok(result.timestamp > 0, "the fixture must retain the delayed video track");
      color(result.pixel, [255, 0, 0]);
    });

    await t.test("delayed initial WebM frame works with zero duration and no compositor callback", async () => {
      const result = await pageTest((page) => page.evaluate(async () => {
        const { EditorMediaPool, layer, frame, sample } = window.poolTest;
        const NativeFrame = window.VideoFrame;
        const callback = HTMLVideoElement.prototype.requestVideoFrameCallback;
        HTMLVideoElement.prototype.requestVideoFrameCallback = undefined;
        window.VideoFrame = function(source) {
          const captured = new NativeFrame(source);
          Object.defineProperty(captured, "duration", { value: 0 });
          return captured;
        };
        const pool = new EditorMediaPool({ resolveAsset: () => "/delayed-webm", timeoutMs: 1000 });
        try {
          const first = (await pool.prepare(frame([layer("clip", 0)]))).get("clip");
          return { timestamp: first.timestamp, pixel: sample(first) };
        } finally {
          pool.dispose(); window.VideoFrame = NativeFrame;
          HTMLVideoElement.prototype.requestVideoFrameCallback = callback;
        }
      }));
      assert.ok(result.timestamp > 0);
      color(result.pixel, [255, 0, 0]);
    });

    await t.test("remembering the delayed first frame never accepts a later stale picture at zero", async () => {
      const result = await pageTest((page) => page.evaluate(async () => {
        const { EditorMediaPool, layer, frame, sample } = window.poolTest;
        const NativeFrame = window.VideoFrame;
        const callback = HTMLVideoElement.prototype.requestVideoFrameCallback;
        HTMLVideoElement.prototype.requestVideoFrameCallback = undefined;
        const pool = new EditorMediaPool({ resolveAsset: () => "/delayed-webm", timeoutMs: 1000 });
        let saved; const stale = [];
        try {
          saved = (await pool.prepare(frame([layer("clip", 2.25)]))).get("clip").clone();
          window.VideoFrame = function(source) {
            if (source.currentTime === 0 && stale.length < 3) {
              const value = saved.clone(); stale.push(value); return value;
            }
            return new NativeFrame(source);
          };
          const picture = (await pool.prepare(frame([layer("clip", 0)]))).get("clip");
          return { pixel: sample(picture), rejected: stale.length, released: stale.every(f => f.displayWidth === 0) };
        } finally {
          pool.dispose(); saved?.close(); window.VideoFrame = NativeFrame;
          HTMLVideoElement.prototype.requestVideoFrameCallback = callback;
        }
      }));
      color(result.pixel, [255, 0, 0]);
      assert.equal(result.rejected, 3); assert.equal(result.released, true);
    });

    await t.test(
      "frames without a duration use a matching presentation receipt",
      async () => {
        const result = await pageTest((page) => page.evaluate(async () => {
          const { EditorMediaPool, layer, frame, sample } = window.poolTest;
          const NativeFrame = window.VideoFrame;
          window.VideoFrame = function(source) {
            const captured = new NativeFrame(source);
            Object.defineProperty(captured, "duration", { value: null });
            return captured;
          };
          const pool = new EditorMediaPool({ resolveAsset: () => "/video", timeoutMs: 2000 });
          try {
            const output = [];
            for (const time of [0, 2.25, 1.25])
              output.push(sample((await pool.prepare(frame([layer("clip", time)]))).get("clip")));
            return output;
          } finally {
            pool.dispose();
            window.VideoFrame = NativeFrame;
          }
        }));
        [[255, 0, 0], [0, 0, 255], [0, 255, 0]].forEach((expected, i) => color(result[i], expected));
      },
    );

    await t.test(
      "real NTSC WebM remains drawable across rounded-duration boundaries",
      async () => {
        const result = await pageTest((page) => page.evaluate(async () => {
          const { EditorMediaPool, layer, frame, sample } = window.poolTest;
          const pool = new EditorMediaPool({ resolveAsset: () => "/webm", timeoutMs: 2000 });
          try {
            const pixels = [];
            for (const time of [0, 0.5, 0.5005, 2.5, 1.5])
              pixels.push(sample((await pool.prepare(frame([layer("clip", time)]))).get("clip")));
            return pixels;
          } finally { pool.dispose(); }
        }));
        [[255,0,0], [255,0,0], [255,0,0], [0,0,255], [0,255,0]]
          .forEach((expected, i) => color(result[i], expected));
      },
    );

    await t.test(
      "a presentation receipt before seeked survives until the frozen WebM frame is ready",
      async () => {
        const result = await pageTest(page => page.evaluate(async () => {
          const { EditorMediaPool, layer, frame, sample } = window.poolTest;
          const prototype = HTMLVideoElement.prototype;
          const request = prototype.requestVideoFrameCallback;
          const cancel = prototype.cancelVideoFrameCallback;
          const pending = new Map();
          let nextId = 0, earlyReceipts = 0;
          // Deliver the real decoded timestamp just before the pool's seeked
          // listener. Readiness and presentation are independent notifications;
          // a receipt must not disappear merely because readiness arrives later.
          prototype.requestVideoFrameCallback = function(callback) {
            const video = this, id = ++nextId;
            const receive = () => {
              pending.delete(id);
              const captured = new VideoFrame(video);
              const mediaTime = captured.timestamp / 1_000_000;
              captured.close();
              Object.defineProperty(video, "seeking", { configurable: true, value: true });
              try {
                earlyReceipts++;
                callback(performance.now(), { mediaTime, presentationTime: performance.now() });
              }
              finally { delete video.seeking; }
            };
            pending.set(id, { video, receive });
            video.addEventListener("seeked", receive, { once: true });
            return id;
          };
          prototype.cancelVideoFrameCallback = id => {
            const entry = pending.get(id);
            if (entry) entry.video.removeEventListener("seeked", entry.receive);
            pending.delete(id);
          };
          const pool = new EditorMediaPool({ resolveAsset: () => "/webm", timeoutMs: 500 });
          try {
            const pixels = [];
            for (const time of [0.5005, 2.502, 1.5015])
              pixels.push(sample((await pool.prepare(frame([layer("clip", time)]))).get("clip")));
            return { pixels, earlyReceipts };
          } finally {
            pool.dispose();
            prototype.requestVideoFrameCallback = request;
            prototype.cancelVideoFrameCallback = cancel;
          }
        }));
        [[255,0,0], [0,0,255], [0,255,0]].forEach((expected, i) => color(result.pixels[i], expected));
        assert.equal(result.earlyReceipts, 3);
      },
    );

    await t.test(
      "a delayed pre-seek presentation receipt cannot authorize an old surface",
      async () => {
        const result = await pageTest(page => page.evaluate(async () => {
          const { EditorMediaPool, layer, frame } = window.poolTest;
          const NativeFrame = window.VideoFrame;
          const prototype = HTMLVideoElement.prototype;
          const request = prototype.requestVideoFrameCallback;
          const cancel = prototype.cancelVideoFrameCallback;
          const pool = new EditorMediaPool({ resolveAsset: () => "/video", timeoutMs: 200 });
          let saved, receiptTimer, requests = 0;
          const rejected = [];
          try {
            saved = (await pool.prepare(frame([layer("clip", 0.25)]))).get("clip").clone();
            window.VideoFrame = function() {
              const captured = saved.clone(); rejected.push(captured); return captured;
            };
            prototype.requestVideoFrameCallback = callback => {
              const id = ++requests;
              if (id === 1) receiptTimer = setTimeout(() => callback(performance.now(), {
                mediaTime: saved.timestamp / 1_000_000, presentationTime: 0,
              }), 20);
              return id;
            };
            prototype.cancelVideoFrameCallback = () => clearTimeout(receiptTimer);
            const code = await pool.prepare(frame([layer("clip", 2.25)])).then(
              () => "unexpected", error => error.code,
            );
            return { code, listeningAgain: requests > 1,
              closed: rejected.length > 0 && rejected.every(value => value.displayWidth === 0) };
          } finally {
            clearTimeout(receiptTimer); saved?.close(); pool.dispose();
            window.VideoFrame = NativeFrame;
            prototype.requestVideoFrameCallback = request;
            prototype.cancelVideoFrameCallback = cancel;
          }
        }));
        assert.deepEqual(result, { code: "timeout", listeningAgain: true, closed: true });
      },
    );

    await t.test(
      "a decoder stuck on an old frame reaches the deadline without publishing stale pixels",
      async () => {
        const result = await pageTest((page) => page.evaluate(async () => {
          const { EditorMediaPool, layer, frame } = window.poolTest;
          const NativeFrame = window.VideoFrame;
          const pool = new EditorMediaPool({ resolveAsset: () => "/video", timeoutMs: 200 });
          let saved;
          const rejected = [];
          try {
            saved = (await pool.prepare(frame([layer("clip", 0.25)]))).get("clip").clone();
            window.VideoFrame = function() { const value=saved.clone(); rejected.push(value); return value; };
            const code = await pool.prepare(frame([layer("clip", 2.25)])).then(
              () => "unexpected", error => error.code,
            );
            const count = rejected.length;
            await new Promise(resolve => setTimeout(resolve, 40));
            return { code, closed: rejected.every(value => value.displayWidth === 0),
              stopped: rejected.length === count, retried: count > 1,
              released: !window.poolTest.videos[0].hasAttribute("src") };
          } finally { saved?.close(); pool.dispose(); window.VideoFrame = NativeFrame; }
        }));
        assert.deepEqual(result, {code:"timeout", closed:true, stopped:true, retried:true, released:true});
      },
    );

    await t.test(
      "fractional microsecond frame boundaries select the intended 30 fps picture without callbacks",
      async () => {
        const result = await pageTest(page => page.evaluate(async () => {
          const {EditorMediaPool,layer,frame,sample} = window.poolTest;
          HTMLVideoElement.prototype.requestVideoFrameCallback = () => 1;
          HTMLVideoElement.prototype.cancelVideoFrameCallback = () => {};
          const pool = new EditorMediaPool({resolveAsset:()=>"/alternating",timeoutMs:1000});
          try {
            const pixels=[];
            for(const index of [0,1,2,25,26,27,29])
              pixels.push(sample((await pool.prepare(frame([layer("clip",index/30)]))).get("clip")));
            return pixels;
          } finally {pool.dispose();}
        }));
        [0,1,2,25,26,27,29].forEach((index,i)=>color(result[i],index%2 ? [0,0,255]:[255,0,0]));
      },
    );

    await t.test(
      "temporarily unavailable frame objects retry within the same deadline",
      async () => {
        const result = await pageTest(page => page.evaluate(async () => {
          const {EditorMediaPool,layer,frame,sample}=window.poolTest;
          const NativeFrame=window.VideoFrame;
          let attempts=0;
          window.VideoFrame=function(source){
            if(source.currentTime > 2 && ++attempts<=3)throw new DOMException("Current frame not yet available","InvalidStateError");
            return new NativeFrame(source);
          };
          const pool=new EditorMediaPool({resolveAsset:()=>"/video",timeoutMs:1000});
          try {return {pixel:sample((await pool.prepare(frame([layer("clip",2.25)]))).get("clip")),attempts};}
          finally {pool.dispose();window.VideoFrame=NativeFrame;}
        }));
        color(result.pixel,[0,0,255]);assert.equal(result.attempts,4);
      },
    );

    await t.test(
      "nested groups and transition endpoints include images and both video surfaces",
      async () => {
        const result = await pageTest((page) =>
          page.evaluate(async () => {
            const { EditorMediaPool, layer, frame, sample } = window.poolTest;
            const pool = new EditorMediaPool({
              resolveAsset: (id) => (id === "image" ? "/image" : "/video"),
              timeoutMs: 2000,
            });
            try {
              const nested = {
                kind: "group",
                instanceId: "nested",
                layers: [
                  layer("still", 0, "image", "image"),
                  {
                    kind: "transition",
                    from: layer("from", 0.25),
                    to: { kind: "group", layers: [layer("to", 2.25)] },
                  },
                ],
              };
              const surfaces = await pool.prepare(frame([nested]));
              return {
                ids: [...surfaces.keys()],
                pixels: [...surfaces.values()].map(sample),
                image: surfaces.get("still") instanceof ImageBitmap,
              };
            } finally {
              pool.dispose();
            }
          }),
        );
        assert.deepEqual(result.ids, ["still", "from", "to"]);
        assert.equal(result.image, true);
        color(result.pixels[0], [255, 220, 0]);
        color(result.pixels[1], [255, 0, 0]);
        color(result.pixels[2], [0, 0, 255]);
      },
    );

    await t.test(
      "animated image assets freeze the first frame and release their bitmap",
      async () => {
        const result = await pageTest((page) =>
          page.evaluate(async () => {
            const { EditorMediaPool, layer, frame, sample } = window.poolTest;
            const pool = new EditorMediaPool({ resolveAsset: () => "/animated", timeoutMs: 2000 });
            try {
              const bitmap = (await pool.prepare(frame([layer("gif", 0, "gif", "image")]))).get(
                "gif",
              );
              const before = sample(bitmap);
              await new Promise((resolve) => setTimeout(resolve, 1250));
              const after = sample(bitmap);
              const later = (await pool.prepare(frame([layer("gif", 8, "gif", "image")]))).get(
                "gif",
              );
              const reused = bitmap === later,
                laterPixel = sample(later);
              pool.reset();
              return {
                before,
                after,
                laterPixel,
                reused,
                width: bitmap.width,
                height: bitmap.height,
              };
            } finally {
              pool.dispose();
            }
          }),
        );
        color(result.before, [255, 0, 0]);
        color(result.after, [255, 0, 0]);
        color(result.laterPixel, [255, 0, 0]);
        assert.equal(result.reused, true);
        assert.equal(result.width, 0);
        assert.equal(result.height, 0);
      },
    );

    await t.test(
      "a bitmap that finishes after image preparation is cancelled is closed",
      async () => {
        const result = await pageTest((page) =>
          page.evaluate(async () => {
            const { EditorMediaPool, layer, frame } = window.poolTest;
            const original = window.createImageBitmap;
            let release, ready, bitmap;
            const began = new Promise((resolve) => {
              ready = resolve;
            });
            const gate = new Promise((resolve) => {
              release = resolve;
            });
            window.createImageBitmap = async (...args) => {
              bitmap = await original(...args);
              ready();
              await gate;
              return bitmap;
            };
            const pool = new EditorMediaPool({ resolveAsset: () => "/image", timeoutMs: 2000 });
            const controller = new AbortController();
            try {
              const preparing = pool
                .prepare(frame([layer("still", 0, "image", "image")]), controller.signal)
                .catch((error) => error.name);
              await began;
              controller.abort();
              const name = await preparing;
              release();
              await new Promise((resolve) => setTimeout(resolve, 0));
              return { name, width: bitmap.width, height: bitmap.height };
            } finally {
              window.createImageBitmap = original;
              pool.dispose();
            }
          }),
        );
        assert.deepEqual(result, { name: "AbortError", width: 0, height: 0 });
      },
    );

    await t.test(
      "inactive instances release decoders and borrowed URLs remain caller-owned",
      async () => {
        const result = await pageTest((page) =>
          page.evaluate(async () => {
            const { EditorMediaPool, layer, frame } = window.poolTest;
            const url = URL.createObjectURL(await (await fetch("/video")).blob());
            const pool = new EditorMediaPool({ resolveAsset: () => url, timeoutMs: 2000 });
            try {
              const first = await pool.prepare(frame([layer("one", 0.25), layer("two", 1.25)]));
              await pool.prepare(frame([layer("two", 1.25)]));
              const removed = !window.poolTest.videos[0].hasAttribute("src") && first.get("one").displayWidth === 0,
                kept = window.poolTest.videos[1].hasAttribute("src") && first.get("two").displayWidth > 0;
              pool.reset();
              return {
                removed,
                kept,
                reset: !window.poolTest.videos[1].hasAttribute("src") && first.get("two").displayWidth === 0,
                borrowedStillWorks: (await fetch(url)).ok,
              };
            } finally {
              pool.dispose();
              URL.revokeObjectURL(url);
            }
          }),
        );
        assert.deepEqual(result, {
          removed: true,
          kept: true,
          reset: true,
          borrowedStillWorks: true,
        });
      },
    );

    await t.test(
      "owned resource URL is retained for all active uses and revoked exactly once",
      async () => {
        const result = await pageTest((page) =>
          page.evaluate(async () => {
            const { EditorMediaPool, layer, frame } = window.poolTest;
            const url = URL.createObjectURL(await (await fetch("/video")).blob()),
              revoked = [];
            const original = URL.revokeObjectURL.bind(URL);
            URL.revokeObjectURL = (value) => {
              revoked.push(value);
              original(value);
            };
            const pool = new EditorMediaPool({
              resolveAsset: () => ({ url, owned: true }),
              timeoutMs: 2000,
            });
            await pool.prepare(
              frame([layer("one", 0.25, "first-asset"), layer("two", 1.25, "second-asset")]),
            );
            await pool.prepare(frame([layer("two", 1.25, "second-asset")]));
            const afterOne = revoked.length;
            await pool.prepare(frame([]));
            pool.dispose();
            return { afterOne, total: revoked.length, correct: revoked[0] === url };
          }),
        );
        assert.deepEqual(result, { afterOne: 0, total: 1, correct: true });
      },
    );

    await t.test(
      "newer request supersedes unresolved generation and late owned URLs are cleaned",
      async () => {
        const result = await pageTest((page) =>
          page.evaluate(async () => {
            const { EditorMediaPool, layer, frame, sample } = window.poolTest;
            const bytes = await (await fetch("/video")).blob(),
              revoked = [];
            const original = URL.revokeObjectURL.bind(URL);
            URL.revokeObjectURL = (value) => {
              revoked.push(value);
              original(value);
            };
            let resolveLate, lateUrl;
            const pool = new EditorMediaPool({
              resolveAsset: (id) =>
                id === "late"
                  ? new Promise((resolve) => {
                      resolveLate = resolve;
                    })
                  : "/video",
              timeoutMs: 2000,
            });
            try {
              const first = pool.prepare(frame([layer("old", 0.25, "late")])).then(
                () => "unexpected",
                (error) => error.code,
              );
              while (!resolveLate) await new Promise((resolve) => setTimeout(resolve, 0));
              const newer = pool.prepare(frame([layer("new", 2.25)]));
              lateUrl = URL.createObjectURL(bytes);
              resolveLate({ url: lateUrl, owned: true });
              const surfaces = await newer;
              return {
                first: await first,
                ids: [...surfaces.keys()],
                pixel: sample(surfaces.get("new")),
                lateCleaned: revoked.includes(lateUrl),
              };
            } finally {
              pool.dispose();
            }
          }),
        );
        assert.equal(result.first, "aborted");
        assert.deepEqual(result.ids, ["new"]);
        assert.equal(result.lateCleaned, true);
        color(result.pixel, [0, 0, 255]);
      },
    );

    await t.test(
      "abort releases existing decoders, reset permits reuse, and dispose rejects future work",
      async () => {
        const result = await pageTest((page) =>
          page.evaluate(async () => {
            const { EditorMediaPool, layer, frame, sample } = window.poolTest;
            const pool = new EditorMediaPool({ resolveAsset: () => "/video", timeoutMs: 2000 });
            const old = (await pool.prepare(frame([layer("one", 0.25)]))).get("one");
            const controller = new AbortController();
            const pending = pool.prepare(frame([layer("one", 2.25)]), controller.signal).then(
              () => "unexpected",
              (error) => error.code,
            );
            controller.abort();
            const code = await pending,
              released = !window.poolTest.videos[0].hasAttribute("src") && old.displayWidth === 0;
            pool.reset();
            const pixel = sample((await pool.prepare(frame([layer("one", 1.25)]))).get("one"));
            pool.dispose();
            const disposed = await pool.prepare(frame([])).then(
              () => "unexpected",
              (error) => error.code,
            );
            return { code, released, pixel, disposed };
          }),
        );
        assert.equal(result.code, "aborted");
        assert.equal(result.released, true);
        color(result.pixel, [0, 255, 0]);
        assert.equal(result.disposed, "disposed");
      },
    );

    await t.test(
      "supersession during real video loading releases old decoder and ignores late events",
      async () => {
        const result = await pageTest((page) =>
          page.evaluate(async () => {
            const { EditorMediaPool, layer, frame, sample } = window.poolTest;
            const created = [],
              original = document.createElement.bind(document);
            document.createElement = (...args) => {
              const element = original(...args);
              if (element instanceof HTMLVideoElement) created.push(element);
              return element;
            };
            const pool = new EditorMediaPool({
              resolveAsset: (id) => (id === "old" ? "/slow" : "/video"),
              timeoutMs: 2000,
            });
            try {
              const old = pool.prepare(frame([layer("clip", 0.25, "old")])).then(
                () => "unexpected",
                (error) => error.code,
              );
              while (!created[0]?.hasAttribute("src"))
                await new Promise((resolve) => setTimeout(resolve, 0));
              const current = (await pool.prepare(frame([layer("clip", 2.25)]))).get("clip");
              await new Promise((resolve) => setTimeout(resolve, 300));
              return {
                old: await old,
                released: !created[0].hasAttribute("src"),
                distinct: current !== created[0],
                pixel: sample(current),
              };
            } finally {
              pool.dispose();
            }
          }),
        );
        assert.equal(result.old, "aborted");
        assert.equal(result.released, true);
        assert.equal(result.distinct, true);
        color(result.pixel, [0, 0, 255]);
      },
    );

    await t.test(
      "seek completion alone cannot bypass missing decoded-frame readiness",
      async () => {
        const result = await pageTest((page) =>
          page.evaluate(async () => {
            const { EditorMediaPool, layer, frame } = window.poolTest;
            let sought = false,
              element;
            const original = document.createElement.bind(document);
            document.createElement = (...args) => {
              const created = original(...args);
              if (created instanceof HTMLVideoElement) {
                element = created;
                created.addEventListener("seeked", () => {
                  sought = true;
                  // Model an unavailable current frame, not a missing presentation
                  // callback: decoding readiness and presentation are distinct.
                  Object.defineProperty(created, "readyState", {
                    configurable: true,
                    get: () => HTMLMediaElement.HAVE_METADATA,
                  });
                });
              }
              return created;
            };
            const pool = new EditorMediaPool({ resolveAsset: () => "/video", timeoutMs: 150 });
            const code = await pool.prepare(frame([layer("one", 0.25)])).then(
              () => "unexpected",
              (error) => error.code,
            );
            pool.dispose();
            return { code, sought, released: !element.hasAttribute("src") };
          }),
        );
        assert.deepEqual(result, {
          code: "timeout",
          sought: true,
          released: true,
        });
      },
    );

    await t.test(
      "decode errors, real loading timeout, and source-end requests fail explicitly",
      async () => {
        const result = await pageTest((page) =>
          page.evaluate(async () => {
            const { EditorMediaPool, layer, frame } = window.poolTest;
            const errors = [];
            for (const [url, time] of [
              ["/bad", 0],
              ["/hang", 0],
              ["/video", 3],
            ]) {
              const pool = new EditorMediaPool({
                resolveAsset: () => url,
                timeoutMs: url === "/hang" ? 100 : 2000,
              });
              try {
                await pool.prepare(frame([layer("one", time)]));
                errors.push("unexpected");
              } catch (error) {
                errors.push(error.code);
              } finally {
                pool.dispose();
              }
            }
            return errors;
          }),
        );
        assert.deepEqual(result, ["decode", "timeout", "decode"]);
      },
    );

    await t.test(
      "capacity and conflicting instance requests reject without silently dropping layers",
      async () => {
        const result = await pageTest((page) =>
          page.evaluate(async () => {
            const { EditorMediaPool, layer, frame } = window.poolTest;
            let resolves = 0;
            const pool = new EditorMediaPool({
              resolveAsset: () => {
                resolves++;
                return "/video";
              },
              maxInstances: 1,
              timeoutMs: 2000,
            });
            try {
              const capacity = await pool
                .prepare(frame([layer("one", 0.25), layer("two", 1.25)]))
                .then(
                  () => "unexpected",
                  (error) => error.code,
                );
              const conflict = await pool
                .prepare(frame([layer("same", 0.25), layer("same", 1.25)]))
                .then(
                  () => "unexpected",
                  (error) => error.code,
                );
              const demo = await pool.prepare(frame([layer("demo", 0.25, "demo", "demo")]));
              const canvas = demo.get("demo");
              const demoIncluded =
                canvas instanceof HTMLCanvasElement && canvas.width === 96 && canvas.height === 64;
              pool.reset();
              return {
                capacity,
                conflict,
                resolves,
                demoIncluded,
                demoReleased: canvas.width === 0 && canvas.height === 0,
              };
            } finally {
              pool.dispose();
            }
          }),
        );
        assert.deepEqual(result, {
          capacity: "capacity",
          conflict: "conflict",
          resolves: 0,
          demoIncluded: true,
          demoReleased: true,
        });
      },
    );
  },
);
