import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
let browser, source;

before(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { EditorPreview } from './apps/video-studio/src/editor/preview'; import { LiveAudioMixer } from './apps/video-studio/src/editor/live-audio'; import { compileAudioPlan } from './apps/video-studio/src/editor/audio-plan'; import * as defaults from './apps/video-studio/src/editor/defaults'; globalThis.api = { EditorPreview, LiveAudioMixer, compileAudioPlan, ...defaults };`,
      resolveDir: root,
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
  });
  source = bundle.outputFiles[0].text;
  browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
});
after(async () => {
  await browser?.close();
});

async function pageFixture(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent('<canvas id="canvas"></canvas>');
  await page.addScriptTag({ content: source });
  await page.evaluate(() => {
    const T = 240000;
    // A same-origin 440 Hz stereo tone, so Web Audio may read the element's samples.
    const seconds = 4, rate = 48000, frames = seconds * rate, bytes = new DataView(new ArrayBuffer(44 + frames * 4));
    const text = (offset, value) => [...value].forEach((char, i) => bytes.setUint8(offset + i, char.charCodeAt(0)));
    text(0, "RIFF"); bytes.setUint32(4, 36 + frames * 4, true); text(8, "WAVEfmt ");
    bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 2, true);
    bytes.setUint32(24, rate, true); bytes.setUint32(28, rate * 4, true); bytes.setUint16(32, 4, true);
    bytes.setUint16(34, 16, true); text(36, "data"); bytes.setUint32(40, frames * 4, true);
    for (let i = 0; i < frames; i++) {
      const value = Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 0.5 * 32767);
      bytes.setInt16(44 + i * 4, value, true);
      bytes.setInt16(46 + i * 4, value, true);
    }
    globalThis.toneUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
    const visual = () => ({ transform: api.defaultTransform(), color: api.defaultColorAdjustment(), blendMode: "normal" });
    globalThis.makeDoc = (clipSeconds) => ({
      schemaVersion: 2, timebase: T, id: "doc", name: "Live", revision: 1, activeSequenceId: "main", exportProfiles: [],
      assets: [{ id: "tone", name: "Tone", kind: "audio", duration: seconds * T }],
      sequences: [{
        id: "main", name: "Main", width: 64, height: 32, frameRate: { numerator: 30, denominator: 1 },
        background: "#000000", timelineMode: "free", transitions: [], markers: [],
        tracks: [api.createTrack("video", "video"), api.createTrack("sound", "audio")],
        clips: [
          { id: "shape", label: "矩形", kind: "shape", trackId: "video", start: 0, duration: clipSeconds * T,
            shape: "rectangle", fill: "#ff0000", stroke: "#000000", strokeWidth: 0, ...visual() },
          { id: "voice", label: "声音", kind: "media", assetId: "tone", trackId: "sound", start: 0, duration: clipSeconds * T,
            timeMap: { points: [{ time: 0, source: 0 }, { time: clipSeconds * T, source: clipSeconds * T }] },
            audio: api.defaultAudioMix(), ...visual() },
        ],
      }],
    });
    globalThis.created = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!created.includes(this)) created.push(this);
      return play.call(this);
    };
    globalThis.rms = (analyser) => {
      const data = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);
      return Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
    };
    globalThis.wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  });
  return page;
}

test("live mixing follows clip volume automation and keeps the element on the sequence clock", async (t) => {
  const page = await pageFixture(t);
  const result = await page.evaluate(async () => {
    const T = 240000, doc = makeDoc(3);
    // Full level for the first second, silent from 1.2 s.
    doc.sequences[0].clips[1].audio.volume = {
      keyframes: [{ time: 0, value: 1, easing: "linear" }, { time: T, value: 1, easing: "linear" },
        { time: 1.2 * T, value: 0, easing: "linear" }],
    };
    const context = new AudioContext({ sampleRate: 48000 });
    await context.resume();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    const mixer = new api.LiveAudioMixer(context, {
      plan: api.compileAudioPlan(doc, "main"), sources: new Map([["tone", toneUrl]]),
    }, analyser);
    await mixer.prepare(0, new AbortController().signal);
    const origin = context.currentTime;
    mixer.start(origin, 0);
    await wait(600);
    const loud = rms(analyser), drift = Math.abs(created[0].currentTime - (context.currentTime - origin));
    await wait(1000);
    const quiet = rms(analyser);
    mixer.stop();
    await wait(100);
    const stopped = { paused: created.every((element) => element.paused), level: rms(analyser) };
    await context.close();
    return { loud, quiet, drift, stopped };
  });
  assert(result.loud > 0.2, `audible ${result.loud}`);
  assert(result.quiet < 0.01, `automation reached silence ${result.quiet}`);
  assert(result.drift < 0.1, `element follows the sequence clock (${result.drift}s)`);
  assert.equal(result.stopped.paused, true);
  assert(result.stopped.level < 0.01);
});

test("preview plays a live mix without prepared PCM, pauses its media and resumes from the playhead", async (t) => {
  const page = await pageFixture(t);
  const result = await page.evaluate(async () => {
    const T = 240000, doc = makeDoc(3), errors = [];
    const preview = new api.EditorPreview(document.querySelector("canvas"), {
      resolveAsset: async () => { throw new Error("unexpected picture media"); },
      onError: (error) => errors.push(String(error)),
    });
    preview.setDocument(doc);
    const live = { documentId: doc.id, revision: doc.revision, sequenceId: "main",
      live: { plan: api.compileAudioPlan(doc, "main"), sources: new Map([["tone", toneUrl]]) } };
    await preview.play(live);
    await wait(500);
    const first = { time: preview.time, playing: created.filter((element) => !element.paused).length };
    preview.pause();
    const paused = { time: preview.time, allPaused: created.every((element) => element.paused) };
    await wait(200);
    const held = preview.time;
    await preview.play(live);
    await wait(300);
    const resumed = { time: preview.time, offset: created.at(-1).currentTime - preview.time / T };
    preview.pause();
    await preview.dispose();
    return { first, paused, held, resumed, errors };
  });
  assert.deepEqual(result.errors, []);
  assert(result.first.time > 0.3 * 240000, `advanced ${result.first.time}`);
  assert.equal(result.first.playing, 1);
  assert.equal(result.paused.allPaused, true);
  assert.equal(result.held, result.paused.time);
  assert(result.resumed.time > result.paused.time);
  assert(Math.abs(result.resumed.offset) < 0.15, `media resumes at the playhead (${result.resumed.offset}s)`);
});
