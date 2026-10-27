import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";

const root = fileURLToPath(new URL("../", import.meta.url));
let browser, source, worklet, server, origin;

before(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { EditorPreview } from './apps/video-studio/src/editor/preview'; import { LiveAudioMixer } from './apps/video-studio/src/editor/live-audio'; import { compileAudioPlan } from './apps/video-studio/src/editor/audio-plan'; import { duckingCoefficients, duckingStep } from './apps/video-studio/src/editor/ducking'; import * as defaults from './apps/video-studio/src/editor/defaults'; globalThis.api = { EditorPreview, LiveAudioMixer, compileAudioPlan, duckingCoefficients, duckingStep, ...defaults };`,
      resolveDir: root,
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
  });
  source = bundle.outputFiles[0].text;
  // The packaged worklet is built like a browser entry: one self-contained script.
  const workletBundle = await build({
    entryPoints: [fileURLToPath(new URL("../apps/video-studio/src/editor/ducking-worklet.ts", import.meta.url))],
    bundle: true, platform: "browser", format: "iife", write: false,
  });
  worklet = workletBundle.outputFiles[0].text;
  browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  // AudioWorklet needs a secure context; a loopback origin is one.
  server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end('<!doctype html><canvas id="canvas"></canvas>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}/`;
});
after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

async function pageFixture(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.goto(origin);
  await page.addScriptTag({ content: source });
  await page.evaluate((worklet) => {
    globalThis.workletUrl = URL.createObjectURL(new Blob([worklet], { type: "text/javascript" }));
    const T = 240000, seconds = 4;
    // A same-origin stereo tone, so Web Audio may read the element's samples.
    globalThis.tone = (frequency) => {
    const seconds = 4, rate = 48000, frames = seconds * rate, bytes = new DataView(new ArrayBuffer(44 + frames * 4));
    const text = (offset, value) => [...value].forEach((char, i) => bytes.setUint8(offset + i, char.charCodeAt(0)));
    text(0, "RIFF"); bytes.setUint32(4, 36 + frames * 4, true); text(8, "WAVEfmt ");
    bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 2, true);
    bytes.setUint32(24, rate, true); bytes.setUint32(28, rate * 4, true); bytes.setUint16(32, 4, true);
    bytes.setUint16(34, 16, true); text(36, "data"); bytes.setUint32(40, frames * 4, true);
    for (let i = 0; i < frames; i++) {
      const value = Math.round(Math.sin((2 * Math.PI * frequency * i) / rate) * 0.5 * 32767);
      bytes.setInt16(44 + i * 4, value, true);
      bytes.setInt16(46 + i * 4, value, true);
    }
    return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
    };
    globalThis.toneUrl = tone(440);
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
  }, worklet);
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

test("the packaged ducking worklet produces the shared detector's envelope sample for sample", async (t) => {
  const page = await pageFixture(t);
  const result = await page.evaluate(async () => {
    const rate = 48000, length = rate, context = new OfflineAudioContext(2, length, rate);
    await context.audioWorklet.addModule(workletUrl);
    const input = context.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = input.getChannelData(channel);
      // Silence, a loud burst, then silence again: attack and release both run.
      for (let i = 0; i < length; i++) data[i] = i > 0.2 * rate && i < 0.5 * rate ? 0.5 * Math.sin(i / (channel ? 7 : 5)) : 0;
    }
    const request = { thresholdDb: -24, attenuationDb: 18, attack: 2400, release: 36000 },
      coefficients = api.duckingCoefficients(request),
      source = context.createBufferSource(),
      node = new AudioWorkletNode(context, "video-studio-ducking", {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        channelCount: 2, channelCountMode: "explicit", processorOptions: coefficients,
      });
    source.buffer = input;
    source.connect(node).connect(context.destination);
    source.start();
    const rendered = (await context.startRendering()).getChannelData(0),
      state = { power: 0, gain: 1 }, left = input.getChannelData(0), right = input.getChannelData(1);
    let difference = 0, minimum = 1;
    for (let i = 0; i < length; i++) {
      const expected = api.duckingStep(state, left[i], right[i], coefficients);
      difference = Math.max(difference, Math.abs(rendered[i] - Math.fround(expected)));
      minimum = Math.min(minimum, expected);
    }
    return { difference, minimum, attenuation: coefficients.attenuation };
  });
  assert(result.difference < 1e-6, `worklet differs by ${result.difference}`);
  assert(result.minimum < result.attenuation * 1.1, `the burst reaches the attenuation (${result.minimum})`);
});

test("live mixing ducks the music bed while the voice sounds and releases it after", async (t) => {
  const page = await pageFixture(t);
  const result = await page.evaluate(async () => {
    const T = 240000, doc = makeDoc(3), visual = doc.sequences[0].clips[1];
    doc.assets.push({ id: "bed", name: "Bed", kind: "audio", duration: 4 * T });
    doc.sequences[0].tracks.push(api.createTrack("music", "audio"));
    // Voice (1 kHz) for the first second; the 300 Hz bed ducks 20 dB under it.
    visual.duration = T;
    visual.timeMap = { points: [{ time: 0, source: 0 }, { time: T, source: T }] };
    doc.sequences[0].clips.push({ ...structuredClone(visual), id: "bed", label: "背景乐", assetId: "bed",
      trackId: "music", duration: 3 * T,
      timeMap: { points: [{ time: 0, source: 0 }, { time: 3 * T, source: 3 * T }] },
      audio: { ...api.defaultAudioMix(), ducking: { sidechainTrackIds: ["sound"], thresholdDb: -30,
        attenuationDb: 20, attack: 2400, release: 24000 } } });
    const context = new AudioContext({ sampleRate: 48000 });
    await context.resume();
    const analyser = context.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;
    const mixer = new api.LiveAudioMixer(context, {
      plan: api.compileAudioPlan(doc, "main"),
      sources: new Map([["tone", tone(1000)], ["bed", tone(300)]]), duckingModule: workletUrl,
    }, analyser);
    await mixer.prepare(0, new AbortController().signal);
    mixer.start(context.currentTime, 0);
    const bed = () => {
      const bins = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(bins);
      const at = Math.round(300 / (48000 / analyser.fftSize));
      return Math.max(...bins.slice(at - 2, at + 3));
    };
    await wait(600);
    const ducked = bed();
    await wait(1200);
    const released = bed();
    mixer.stop();
    await context.close();
    return { ducked, released };
  });
  const depth = result.released - result.ducked;
  assert(depth > 14 && depth < 26, `bed ducked by ${depth.toFixed(1)} dB (${result.ducked} → ${result.released})`);
});

test("an edited plan changes the level while playing without seeking the source", async (t) => {
  const page = await pageFixture(t);
  const result = await page.evaluate(async () => {
    const doc = makeDoc(3);
    const context = new AudioContext({ sampleRate: 48000 });
    await context.resume();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    const sources = new Map([["tone", toneUrl]]),
      mixer = new api.LiveAudioMixer(context, { plan: api.compileAudioPlan(doc, "main"), sources }, analyser);
    await mixer.prepare(0, new AbortController().signal);
    mixer.start(context.currentTime, 0);
    await wait(500);
    const loud = rms(analyser);
    let seeks = 0;
    created[0].addEventListener("seeking", () => seeks++);
    doc.sequences[0].clips[1].audio.volume = 0;
    mixer.update({ plan: api.compileAudioPlan(doc, "main"), sources });
    await wait(300);
    const quiet = rms(analyser), stillPlaying = !created[0].paused;
    mixer.stop();
    await context.close();
    return { loud, quiet, seeks, stillPlaying, elements: created.length };
  });
  assert(result.loud > 0.2, `audible ${result.loud}`);
  assert(result.quiet < 0.01, `edit reached silence ${result.quiet}`);
  assert.equal(result.seeks, 0);
  assert.equal(result.stillPlaying, true);
  assert.equal(result.elements, 1);
});

test("preview applies a sound edit in place and rejects an edit that changes the timeline length", async (t) => {
  const page = await pageFixture(t);
  const result = await page.evaluate(async () => {
    const T = 240000, doc = makeDoc(3), errors = [];
    const preview = new api.EditorPreview(document.querySelector("canvas"), {
      resolveAsset: async () => { throw new Error("unexpected picture media"); },
      onError: (error) => errors.push(String(error)),
    });
    preview.setDocument(doc);
    const sources = new Map([["tone", toneUrl]]),
      audio = (value) => ({ documentId: value.id, revision: value.revision, sequenceId: "main",
        live: { plan: api.compileAudioPlan(value, "main"), sources } });
    await preview.play(audio(doc));
    await wait(300);
    const quieter = structuredClone(doc);
    quieter.revision++;
    quieter.sequences[0].clips[1].audio.volume = 0.25;
    const applied = preview.updatePlayback(quieter, "main", audio(quieter));
    const playingAfterEdit = preview.playing, at = preview.time;
    await wait(200);
    const advanced = preview.time > at;
    const shorter = structuredClone(quieter);
    shorter.revision++;
    for (const clip of shorter.sequences[0].clips) clip.duration = 2 * T;
    shorter.sequences[0].clips[1].timeMap.points[1] = { time: 2 * T, source: 2 * T };
    const rejected = preview.updatePlayback(shorter, "main", audio(shorter));
    preview.pause();
    await preview.dispose();
    return { applied, playingAfterEdit, advanced, rejected, errors };
  });
  assert.deepEqual(result, { applied: true, playingAfterEdit: true, advanced: true, rejected: false, errors: [] });
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
