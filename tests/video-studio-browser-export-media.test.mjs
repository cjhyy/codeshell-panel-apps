import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url)),
  run = promisify(execFile);
const evidence =
  process.env.VIDEO_STUDIO_EXACT_EVIDENCE ??
  resolve(root, "artifacts/video-studio/exact-browser-duration");
let browser, directory, bundle, source, tailSource, videoSource;
before(async () => {
  directory = await mkdtemp(resolve(tmpdir(), "video-canonical-webm-"));
  const path = resolve(directory, "two-tones.wav");
  await run("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "aevalsrc='0.06*sin(2*PI*if(lt(n,14400),440,880)*n/48000)':s=48000:d=0.6",
    "-c:a",
    "pcm_s16le",
    path,
  ]);
  source = (await readFile(path)).toString("base64");
  const movie = resolve(directory, "owned-av.mp4");
  await run("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=160x90:r=30:d=0.6",
    "-i",
    path,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    movie,
  ]);
  videoSource = (await readFile(movie)).toString("base64");
  const tail = resolve(directory, "non-frame-tail.wav");
  await run("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-af",
    "atrim=end_sample=10003,aeval='if(gte(n,9600),val(0),0)'",
    "-c:a",
    "pcm_s16le",
    tail,
  ]);
  tailSource = (await readFile(tail)).toString("base64");
  bundle = (
    await build({
      stdin: {
        resolveDir: root,
        contents: `import * as exporter from './apps/video-studio/src/editor/browser-export'; import * as defaults from './apps/video-studio/src/editor/defaults'; import {migrateLegacyProject} from './apps/video-studio/src/editor/migration'; import {createProject} from './apps/video-studio/src/model'; window.api={...exporter,...defaults,migrateLegacyProject,createProject};`,
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      target: "chrome120",
    })
  ).outputFiles[0].text;
  browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
});
after(async () => {
  await browser?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function open(t) {
  const page = await browser.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, []);
  });
  await page.route("**/*", (route) => route.abort("blockedbyclient"));
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: bundle });
  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (value) => value.charCodeAt(0));
    const created = [],
      revoked = [],
      mediaDecoders = [],
      revocations = [],
      create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (value) => {
      const url = create(value);
      created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      revoked.push(url);
      revocations.push({
        url,
        remainingDecoders: mediaDecoders.filter((media) => media.getAttribute("src") === url)
          .length,
      });
      revoke(url);
    };
    const contexts = [],
      tracks = [],
      elements = [],
      stops = [],
      encoders = [];
    const sourceProperty = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      ...sourceProperty,
      set(value) {
        if (!mediaDecoders.includes(this)) mediaDecoders.push(this);
        sourceProperty.set.call(this, value);
      },
    });
    const NativeContext = AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(...args) {
        super(...args);
        contexts.push(this);
      }
      createMediaStreamDestination() {
        const destination = super.createMediaStreamDestination();
        tracks.push(...destination.stream.getTracks());
        return destination;
      }
      createMediaElementSource(media) {
        elements.push(media);
        return super.createMediaElementSource(media);
      }
    };
    const capture = HTMLCanvasElement.prototype.captureStream;
    HTMLCanvasElement.prototype.captureStream = function (...args) {
      const stream = capture.apply(this, args);
      tracks.push(...stream.getTracks());
      return stream;
    };
    const stop = MediaRecorder.prototype.stop;
    MediaRecorder.prototype.stop = function () {
      stops.push({
        time: performance.now(),
        state: this.state,
        tracks: this.stream.getTracks().map((track) => ({
          kind: track.kind,
          readyState: track.readyState,
          muted: track.muted,
          settings: track.getSettings(),
        })),
        elements: elements.map((media) => ({
          currentTime: media.currentTime,
          paused: media.paused,
          duration: media.duration,
        })),
      });
      return stop.call(this);
    };
    const start = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function (...args) {
      const record = { time: performance.now(), chunks: [] };
      encoders.push(record);
      this.addEventListener("dataavailable", (event) => record.chunks.push(event.data.size));
      return start.apply(this, args);
    };
    const sourceUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
    window.fixture = { sourceUrl, created, revoked, contexts, tracks, elements, stops, encoders };
    window.makeDocument = (volume = 1, overlap = false) => {
      const doc = api.migrateLegacyProject(api.createProject()),
        sequence = doc.sequences[0];
      sequence.width = 160;
      sequence.height = 90;
      sequence.tracks.push(
        api.createTrack("audio-one", "audio"),
        api.createTrack("audio-two", "audio"),
      );
      doc.assets = [{ id: "sound", kind: "audio", name: "真实双频声音", duration: 144000 }];
      const clip = (id, trackId, offset) => ({
        id,
        trackId,
        kind: "media",
        assetId: "sound",
        label: id,
        start: 0,
        duration: 72000,
        timeMap: {
          points: [
            { time: 0, source: offset },
            { time: 72000, source: offset + 72000 },
          ],
        },
        audio: { ...api.defaultAudioMix(), volume },
        transform: api.defaultTransform(),
        color: api.defaultColorAdjustment(),
        blendMode: "normal",
      });
      sequence.clips = [
        clip("first", "audio-one", 0),
        ...(overlap ? [clip("second", "audio-two", 72000)] : []),
      ];
      return doc;
    };
    window.cleanupReceipt = () => ({
      contexts: contexts.map((context) => context.state),
      tracks: tracks.map((track) => track.readyState),
      decodersReleased: elements.every((media) => !media.hasAttribute("src")),
      allMediaReleased: mediaDecoders.every((media) => !media.hasAttribute("src")),
      created: [...created],
      revoked: [...revoked],
      revocations: structuredClone(revocations),
      stops: structuredClone(stops),
      encoders: structuredClone(encoders),
    });
  }, source);
  return page;
}
async function pcm(bytes, name) {
  await mkdir(evidence, { recursive: true });
  const path = resolve(evidence, name);
  await writeFile(path, Buffer.from(bytes));
  const output = (
    await run(
      "ffmpeg",
      ["-v", "error", "-i", path, "-f", "f32le", "-ar", "48000", "-ac", "1", "pipe:1"],
      { encoding: "buffer" },
    )
  ).stdout;
  return new Float32Array(
    output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength),
  );
}
function clean(receipt) {
  assert.ok(
    receipt.contexts.every((state) => state === "closed"),
    JSON.stringify(receipt),
  );
  assert.ok(
    receipt.tracks.every((state) => state === "ended"),
    JSON.stringify(receipt),
  );
  assert.equal(receipt.decodersReleased, true);
  assert.equal(receipt.allMediaReleased, true);
}
test(
  "actual canonical WebM retains mute/gain and independent overlapping source decoders",
  { timeout: 60000 },
  async (t) => {
    const peaks = [];
    for (const volume of [0, 1, 2]) {
      const page = await open(t);
      const result = await page.evaluate(
        async ({ volume }) => {
          const document = makeDocument(volume),
            before = JSON.stringify(document),
            controller = new AbortController();
          try {
            const blob = await api.recordEditorSequence({
              document,
              sequenceId: document.activeSequenceId,
              resolveAsset: async () => fixture.sourceUrl,
              signal: controller.signal,
              assertCurrent() {},
            });
            return {
              bytes: [...new Uint8Array(await blob.arrayBuffer())],
              unchanged: JSON.stringify(document) === before,
              receipt: cleanupReceipt(),
            };
          } catch (error) {
            return { error: error.message, receipt: cleanupReceipt() };
          }
        },
        { volume },
      );
      assert.equal(result.error, undefined, JSON.stringify(result));
      clean(result.receipt);
      assert.equal(result.unchanged, true);
      assert.ok(
        !result.receipt.revoked.includes(result.receipt.created[0]),
        "The exporter must not revoke a borrowed source URL",
      );
      const samples = await pcm(result.bytes, `gain-${volume}.webm`);
      peaks.push(samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0));
    }
    assert.ok(peaks[0] < 0.0001, JSON.stringify(peaks));
    assert.ok(peaks[1] > 0.03, JSON.stringify(peaks));
    assert.ok(peaks[2] / peaks[1] > 1.7 && peaks[2] / peaks[1] < 2.3, JSON.stringify(peaks));
    const page = await open(t);
    const result = await page.evaluate(async () => {
      const document = makeDocument(1, true);
      const blob = await api.recordEditorSequence({
        document,
        sequenceId: document.activeSequenceId,
        resolveAsset: async () => fixture.sourceUrl,
        signal: new AbortController().signal,
        assertCurrent() {},
      });
      return {
        bytes: [...new Uint8Array(await blob.arrayBuffer())],
        receipt: cleanupReceipt(),
        decoders: fixture.elements.length,
      };
    });
    clean(result.receipt);
    assert.equal(result.decoders, 2);
    const samples = await pcm(result.bytes, "independent-overlap.webm");
    const power = (frequency) => {
      let real = 0,
        imaginary = 0;
      for (let i = 0; i < samples.length; i++) {
        real += samples[i] * Math.cos((2 * Math.PI * frequency * i) / 48000);
        imaginary += samples[i] * Math.sin((2 * Math.PI * frequency * i) / 48000);
      }
      return Math.hypot(real, imaginary) / samples.length;
    };
    assert.ok(
      power(440) > 0.005 && power(880) > 0.005,
      `Both actual mixed tones must survive: ${power(440)}, ${power(880)}`,
    );
  },
);

test(
  "shared owned source URLs remain valid until the last actual decoder is released",
  { timeout: 10000 },
  async (t) => {
    const page = await open(t);
    const result = await page.evaluate(async () => {
      const document = makeDocument(1, true),
        sequence = document.sequences[0];
      sequence.clips[0].duration = 36000;
      sequence.clips[0].timeMap.points[1] = { time: 36000, source: 36000 };
      const blob = await api.recordEditorSequence({
        document,
        sequenceId: sequence.id,
        resolveAsset: async () => ({ url: fixture.sourceUrl, owned: true }),
        signal: new AbortController().signal,
        assertCurrent() {},
      });
      return {
        bytes: [...new Uint8Array(await blob.arrayBuffer())],
        url: fixture.sourceUrl,
        receipt: cleanupReceipt(),
      };
    });
    clean(result.receipt);
    const revocations = result.receipt.revocations.filter((item) => item.url === result.url);
    assert.equal(revocations.length, 1);
    assert.equal(revocations[0].remainingDecoders, 0);
    const samples = await pcm(result.bytes, "shared-owned-overlap.webm");
    assert.ok(samples.some((value) => Math.abs(value) > 0.03));
  },
);

test(
  "one owned AV URL is revoked only after the actual picture and sound consumers release",
  { timeout: 10000 },
  async (t) => {
    const page = await open(t);
    const result = await page.evaluate(async (base64) => {
      const url = URL.createObjectURL(
        new Blob([Uint8Array.from(atob(base64), (value) => value.charCodeAt(0))], {
          type: "video/mp4",
        }),
      );
      const document = makeDocument();
      document.assets[0].kind = "video";
      document.assets[0].width = 160;
      document.assets[0].height = 90;
      document.sequences[0].tracks.find((track) => track.id === "audio-one").kind = "video";
      let requests = 0;
      const blob = await api.recordEditorSequence({
        document,
        sequenceId: document.activeSequenceId,
        resolveAsset: async () => {
          requests++;
          return { url, owned: true };
        },
        signal: new AbortController().signal,
        assertCurrent() {},
      });
      return {
        bytes: [...new Uint8Array(await blob.arrayBuffer())],
        url,
        requests,
        receipt: cleanupReceipt(),
      };
    }, videoSource);
    clean(result.receipt);
    assert.equal(result.requests, 2);
    const revocations = result.receipt.revocations.filter((item) => item.url === result.url);
    assert.equal(revocations.length, 1);
    assert.equal(revocations[0].remainingDecoders, 0);
    const samples = await pcm(result.bytes, "shared-owned-av.webm");
    assert.ok(samples.some((value) => Math.abs(value) > 0.03));
  },
);

test(
  "both adjacent non-frame tail tones survive a delayed second source preparation",
  { timeout: 30000 },
  async (t) => {
    const page = await open(t);
    const result = await page.evaluate(async (base64) => {
      const url = URL.createObjectURL(
        new Blob([Uint8Array.from(atob(base64), (value) => value.charCodeAt(0))], {
          type: "audio/wav",
        }),
      );
      const document = makeDocument(1, true),
        sequence = document.sequences[0];
      document.assets[0].duration = 50015;
      for (const [index, clip] of sequence.clips.entries()) {
        clip.start = index * 50015;
        clip.duration = 50015;
        clip.timeMap.points = [
          { time: 0, source: 0 },
          { time: 50015, source: 50015 },
        ];
      }
      let requests = 0;
      const blob = await api.recordEditorSequence({
        document,
        sequenceId: sequence.id,
        resolveAsset: async () => {
          if (++requests === 2) await new Promise((resolve) => setTimeout(resolve, 250));
          return url;
        },
        signal: new AbortController().signal,
        assertCurrent() {},
      });
      return {
        bytes: [...new Uint8Array(await blob.arrayBuffer())],
        requests,
        receipt: cleanupReceipt(),
      };
    }, tailSource);
    clean(result.receipt);
    assert.equal(result.requests, 2);
    const samples = await pcm(result.bytes, "delayed-adjacent-tails.webm");
    let bursts = 0,
      previous = -4801;
    for (let i = 0; i < samples.length; i++)
      if (Math.abs(samples[i]) > 0.005) {
        if (i - previous > 4800) bursts++;
        previous = i;
      }
    assert.equal(
      bursts,
      2,
      `Both actual tails must survive a 250ms preparation pause: ${JSON.stringify(result.receipt)}`,
    );
  },
);

test(
  "cancel and replaced owner reject actual in-flight export and release all resources",
  { timeout: 60000 },
  async (t) => {
    for (const mode of [
      "cancel",
      "owner",
      "late-owned-source",
      "pending-source",
      "pending-owner",
      "pending-play",
      "encoder-error",
    ]) {
      const page = await open(t);
      const result = await page.evaluate(async (mode) => {
        const document = makeDocument(),
          before = JSON.stringify(document),
          controller = new AbortController();
        let current = true,
          error;
        const started = performance.now();
        if (mode === "encoder-error")
          window.MediaRecorder = class {
            static isTypeSupported() {
              return true;
            }
            constructor() {
              throw new Error("controlled encoder construction failure");
            }
          };
        if (mode === "pending-play") HTMLMediaElement.prototype.play = () => new Promise(() => {});
        const timer = ["cancel", "late-owned-source", "pending-source", "pending-play"].includes(
          mode,
        )
          ? setTimeout(() => controller.abort(), 80)
          : ["owner", "pending-owner"].includes(mode)
            ? setTimeout(() => {
                current = false;
              }, 80)
            : undefined;
        try {
          await api.recordEditorSequence({
            document,
            sequenceId: document.activeSequenceId,
            signal: controller.signal,
            assertCurrent() {
              if (!current) throw new Error("fixture owner changed");
            },
            resolveAsset: async () => {
              if (mode === "pending-source" || mode === "pending-owner")
                return new Promise(() => {});
              if (mode === "late-owned-source") {
                await new Promise((resolve) => setTimeout(resolve, 120));
                return { url: fixture.sourceUrl, owned: true };
              }
              return fixture.sourceUrl;
            },
          });
        } catch (failure) {
          error = failure.message;
        } finally {
          clearTimeout(timer);
        }
        const settledMilliseconds = performance.now() - started;
        if (mode === "late-owned-source") await new Promise((resolve) => setTimeout(resolve, 150));
        return {
          error,
          settledMilliseconds,
          unchanged: JSON.stringify(document) === before,
          receipt: cleanupReceipt(),
          sourceUrl: fixture.sourceUrl,
        };
      }, mode);
      assert.ok(result.error, `Expected ${mode} to fail`);
      assert.equal(result.unchanged, true);
      clean(result.receipt);
      assert.ok(
        result.settledMilliseconds < 1500,
        `Cancellation/owner change must not wait for the resolver or play Promise: ${mode}, ${JSON.stringify(result)}`,
      );
      if (mode === "late-owned-source")
        assert.ok(result.receipt.revoked.includes(result.sourceUrl));
      else assert.ok(!result.receipt.revoked.includes(result.sourceUrl));
    }
  },
);

test(
  "an actual source ending before its declared used range fails instead of replaying or hanging",
  { timeout: 10000 },
  async (t) => {
    const page = await open(t);
    const result = await page.evaluate(async () => {
      const document = makeDocument(),
        sequence = document.sequences[0];
      document.assets[0].duration = 480000;
      sequence.clips[0].duration = 480000;
      sequence.clips[0].timeMap.points[1] = { time: 480000, source: 480000 };
      const before = JSON.stringify(document),
        controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      let error;
      try {
        await api.recordEditorSequence({
          document,
          sequenceId: sequence.id,
          resolveAsset: async () => fixture.sourceUrl,
          signal: controller.signal,
          assertCurrent() {},
        });
      } catch (failure) {
        error = failure.message;
      } finally {
        clearTimeout(timeout);
      }
      return { error, unchanged: JSON.stringify(document) === before, receipt: cleanupReceipt() };
    });
    assert.match(result.error, /提前结束/);
    assert.equal(result.unchanged, true);
    clean(result.receipt);
  },
);
