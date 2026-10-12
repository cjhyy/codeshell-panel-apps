import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repository = fileURLToPath(new URL("../", import.meta.url));
const S = 48000,
  T = 240000;
function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-nostdin", "-v", "error", ...args], {
    timeout: 20000,
    maxBuffer: 16 * 1024 ** 2,
  });
  assert.equal(result.status, 0, result.stderr?.toString() || String(result.error));
  return result.stdout;
}
function decode(path) {
  const buffer = ffmpeg([
    "-i",
    path,
    "-ac",
    "2",
    "-ar",
    String(S),
    "-c:a",
    "pcm_f32le",
    "-f",
    "f32le",
    "pipe:1",
  ]);
  return Array.from({ length: buffer.length / 4 }, (_, index) => buffer.readFloatLE(index * 4));
}
function rms(pcm, start, end, channel = 0) {
  let power = 0,
    count = 0;
  for (let sample = Math.round(start * S); sample < Math.round(end * S); sample++) {
    power += pcm[sample * 2 + channel] ** 2;
    count++;
  }
  return Math.sqrt(power / count);
}
function frequency(pcm, start, end, channel = 0) {
  let crossings = 0;
  for (let sample = Math.round(start * S) + 1; sample < Math.round(end * S); sample++)
    if (pcm[(sample - 1) * 2 + channel] <= 0 && pcm[sample * 2 + channel] > 0) crossings++;
  return crossings / (end - start);
}
const near = (actual, expected, tolerance) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected} ± ${tolerance}`);

test("live root-gain correction matches native PCM after nested, multicam and pitch-preserving retiming", { timeout: 60000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "editor-gain-audition-pcm-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bundle = join(directory, "api.mjs");
  await build({ stdin: { resolveDir: repository, contents: `
    export {renderEditorAudio} from './apps/video-studio/native/media/editor-audio-renderer';
    export {clipGainAuditionDocument} from './apps/video-studio/src/editor/audio-audition';
    export {createTrack,defaultAudioMix,defaultTransform,defaultColorAdjustment} from './apps/video-studio/src/editor/defaults';
  ` }, bundle: true, platform: "node", format: "esm", outfile: bundle, logLevel: "silent" });
  const api = await import(pathToFileURL(bundle)), tone = join(directory, "tone.mkv"), bed = join(directory, "bed.mkv");
  ffmpeg(["-f", "lavfi", "-i", "color=red:s=32x32:r=10:d=4", "-f", "lavfi", "-i", "aevalsrc=0.17*sin(2*PI*440*t)|0.13*sin(2*PI*733*t):s=48000:d=4", "-c:v", "ffv1", "-c:a", "pcm_f32le", "-y", tone]);
  ffmpeg(["-f", "lavfi", "-i", "color=blue:s=32x32:r=10:d=4", "-f", "lavfi", "-i", "aevalsrc=0.09*sin(2*PI*997*t)|0.11*sin(2*PI*191*t):s=48000:d=4", "-c:v", "ffv1", "-c:a", "pcm_f32le", "-y", bed]);
  const visual = () => ({ transform: api.defaultTransform(), color: api.defaultColorAdjustment(), blendMode: "normal" }),
    sequence = (id) => ({ id, name: id, width: 32, height: 32, frameRate: { numerator: 30000, denominator: 1001 }, background: "#000000", timelineMode: "free",
      tracks: [api.createTrack("v", "video"), api.createTrack("a", "audio")], clips: [], transitions: [], markers: [] }),
    media = (id, assetId = "tone", trackId = "v") => ({ id, label: id, kind: "media", assetId, trackId, start: 13, duration: T,
      timeMap: { points: [{ time: 0, source: 0 }, { time: T, source: T }] }, audio: api.defaultAudioMix(), ...visual() });
  let serial = 0;
  const render = async (document, range) => {
    const result = await api.renderEditorAudio({ document, sequenceId: "main", range, resolveAssetPath: (id) => id === "tone" ? tone : bed,
      ffmpegPath: "ffmpeg", ffprobePath: "ffprobe", workDir: join(directory, "work"), cacheDir: join(directory, "cache"),
      outputPath: join(directory, `mix-${++serial}.wav`), signal: new AbortController().signal });
    return { result, pcm: decode(result.path) };
  };
  for (const kind of ["media", "sequence", "multicam"]) {
    const root = sequence("main"), child = sequence("child"), leaf = media("leaf"), selected = media("selected"), other = media("other", "bed", "a");
    root.tracks[0].volume = 0.73; root.tracks[0].pan = -0.22;
    child.tracks[0].volume = 0.61; child.tracks[0].pan = 0.19;
    leaf.audio.volume = { keyframes: [{ time: 0, value: 0.3 }, { time: T, value: 1.2 }] };
    leaf.audio.pan = { keyframes: [{ time: 0, value: -0.3 }, { time: T, value: 0.7 }] };
    leaf.audio.fadeIn = 12013; leaf.audio.fadeOut = 20013;
    leaf.audio.pitchSemitones = 2; leaf.timeMap.points[1].source = 2*T;
    child.clips = [leaf];
    selected.audio.volume = kind === "media" ? 0 : 0.8;
    selected.audio.fadeIn = 20013; selected.audio.fadeOut = 12013; selected.audio.pan = 0.23;
    selected.audio.pitchSemitones = -3; selected.audio.preservePitch = kind !== "multicam";
    selected.timeMap = { points: [{ time: 0, source: T }, { time: T/2, source: 0 }, { time: T, source: T/2 }] };
    if (kind === "sequence") { selected.kind = kind; delete selected.assetId; selected.sequenceId = "child"; }
    if (kind === "multicam") {
      selected.kind = kind; delete selected.assetId;
      selected.angles = [{ id: "one", name: "one", assetId: "bed", offset: 13 }, { id: "two", name: "two", assetId: "tone", offset: 113 }];
      selected.switches = [{ time: 0, angleId: "one" }, { time: 40013, angleId: "two" }]; selected.audioAngleId = "two";
    }
    root.clips = [selected, other];
    const document = { schemaVersion: 2, timebase: T, id: `audition-${kind}`, name: "Audition", revision: 0, activeSequenceId: "main", exportProfiles: [],
      assets: [{ id: "tone", name: "Tone", kind: "video", width: 32, height: 32, duration: 4*T }, { id: "bed", name: "Bed", kind: "video", width: 32, height: 32, duration: 4*T }], sequences: [root, child] },
      before = structuredClone(document), unit = api.clipGainAuditionDocument(document, "main", selected.id),
      adjusted = structuredClone(document), target = 1.7;
    adjusted.sequences[0].clips[0].audio.volume = target;
    const full = await render(document), stem = await render(unit.document), changed = await render(adjusted);
    assert.equal(full.pcm.length, stem.pcm.length); assert.equal(full.pcm.length, changed.pcm.length);
    assert.ok(stem.pcm.some((value) => Math.abs(value) > 0.01), `${kind}: nonzero actual processed stem`);
    let maximum = 0;
    for (let index = 0; index < changed.pcm.length; index++) maximum = Math.max(maximum,
      Math.abs(full.pcm[index] + (target - unit.volume) * stem.pcm[index] - changed.pcm[index]));
    assert.ok(maximum < 1e-6, `${kind}: max native PCM correction difference ${maximum}`);
    t.diagnostic(`${kind}: maximum native PCM difference ${maximum}`);
    assert.ok(stem.result.processing.processedSpans > 0, "comparison must exercise actual FFmpeg time stretching/pitch processing");
    const range = { start: 40013, duration: 80080 }, partial = await render(unit.document, range);
    assert.equal(partial.result.rangeFallback, "stretch", "range export must preserve original unit-stem retiming phase");
    assert.deepEqual(partial.pcm, stem.pcm);
    if (kind === "media") {
      const safeUnit = structuredClone(unit.document), safeClip = safeUnit.sequences[0].clips[0];
      safeClip.audio.pitchSemitones = 0;
      safeClip.timeMap.points = [{ time: 0, source: 0 }, { time: T, source: T }];
      const safeFull = await render(safeUnit), safeRange = await render(safeUnit, range);
      assert.deepEqual(safeRange.result.range, range);
      assert.equal(safeRange.result.rangeFallback, undefined);
      assert.deepEqual(safeRange.pcm, safeFull.pcm.slice(Math.ceil(range.start / 5) * 2, Math.ceil((range.start + range.duration) / 5) * 2));
      assert.ok(safeRange.pcm.some((value) => Math.abs(value) > 0.01));
    }
    assert.deepEqual(document, before);
  }
});

test("bounded original-clock PCM skips unrelated sources and equals full mix samples through nested reverse, fades and animation", { timeout: 60000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "editor-range-pcm-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bundle = join(directory, "api.mjs");
  await build({ stdin: { resolveDir: repository, contents: `
    export {renderEditorAudio} from './apps/video-studio/native/media/editor-audio-renderer';
    export {createTrack,defaultAudioMix,defaultTransform,defaultColorAdjustment} from './apps/video-studio/src/editor/defaults';
  ` }, bundle: true, platform: "node", format: "esm", outfile: bundle, logLevel: "silent" });
  const api = await import(pathToFileURL(bundle)), tone = join(directory, "tone.wav"), unrelated = join(directory, "unrelated.wav");
  ffmpeg(["-f", "lavfi", "-i", "aevalsrc=0.2*sin(2*PI*440*t)|0.13*sin(2*PI*660*t):s=48000:d=3", "-c:a", "pcm_f32le", "-y", tone]);
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=997:sample_rate=48000:duration=1", "-c:a", "pcm_f32le", "-y", unrelated]);
  const visual = { transform: api.defaultTransform(), color: api.defaultColorAdjustment(), blendMode: "normal" },
    sequence = (id) => ({ id, name: id, width: 32, height: 32, frameRate: { numerator: 60000, denominator: 1001 }, background: "#000000", timelineMode: "free",
      tracks: [api.createTrack("a", "audio"), api.createTrack("b", "audio")], clips: [], transitions: [], markers: [] }),
    media = (id, start, duration, assetId = "tone") => ({ id, label: id, kind: "media", trackId: "a", assetId, start, duration,
      timeMap: { points: [{ time: 0, source: 0 }, { time: duration, source: duration }] }, audio: api.defaultAudioMix(), ...structuredClone(visual) }),
    root = sequence("main"), child = sequence("child"), leaf = media("leaf", T, T);
  leaf.timeMap = { points: [{ time: 0, source: 2*T }, { time: T, source: T }] };
  leaf.audio.volume = { keyframes: [{ time: 0, value: 0.2 }, { time: T, value: 0.9 }] };
  leaf.audio.pan = { keyframes: [{ time: 0, value: -0.4 }, { time: T, value: 0.5 }] };
  leaf.audio.fadeIn = 12013; leaf.audio.fadeOut = 40013;
  child.tracks[0].volume = 0.7; child.tracks[0].pan = -0.17; child.clips = [leaf];
  root.clips = [{ id: "nest", label: "nest", kind: "sequence", sequenceId: "child", trackId: "a", start: 8*T, duration: 2*T,
    timeMap: { points: [{ time: 0, source: 0 }, { time: 2*T, source: 2*T }] }, audio: { ...api.defaultAudioMix(), volume: 0.8, fadeIn: T + 13 }, ...visual },
    media("unrelated", 0, T, "unrelated")];
  const document = { schemaVersion: 2, timebase: T, id: "range", name: "Range", revision: 0, activeSequenceId: "main", exportProfiles: [],
    assets: [{ id: "tone", name: "tone", kind: "audio", duration: 3*T }, { id: "unrelated", name: "unrelated", kind: "audio", duration: T }], sequences: [root, child] },
    before = structuredClone(document), range = { start: 9*T + 13, duration: 80080 }, calls = [];
  let serial = 0;
  const render = (window, extra = {}) => api.renderEditorAudio({ document, sequenceId: "main", range: window,
    resolveAssetPath: (id) => { calls.push(id); if (window && Math.ceil((window.start + window.duration) / 5) > Math.ceil(window.start / 5) && id === "unrelated") throw new Error("Unrelated source must not decode"); return id === "tone" ? tone : unrelated; },
    ffmpegPath: "ffmpeg", ffprobePath: "ffprobe", workDir: join(directory, "work"), cacheDir: join(directory, "cache"),
    outputPath: join(directory, `mix-${++serial}.wav`), signal: new AbortController().signal, ...extra });
  const full = await render(), fullPCM = decode(full.path); calls.length = 0;
  const bounded = await render(range), pcm = decode(bounded.path), start = Math.ceil(range.start / 5), end = Math.ceil((range.start + range.duration) / 5);
  assert.deepEqual(bounded.range, range);
  assert.equal(bounded.sampleCount, end - start);
  assert.deepEqual(pcm, fullPCM.slice(start * 2, end * 2));
  assert.ok(pcm.some((sample) => Math.abs(sample) > 0.01), "actual nonzero reverse stereo PCM");
  assert.deepEqual(calls, ["tone"]);
  assert.ok(bounded.sampleCount < full.sampleCount / 20);
  const reused = await render(range);
  assert.equal(reused.assets[0].cacheHit, true);
  assert.deepEqual(decode(reused.path), pcm);
  const endpoint = { start: 10*T - 13, duration: 13 }, last = await render(endpoint);
  assert.deepEqual(decode(last.path), fullPCM.slice(Math.ceil(endpoint.start / 5) * 2));
  const subSample = await render({ start: 9*T + 1, duration: 1 });
  assert.equal(subSample.rangeFallback, "sub-sample");
  assert.equal(subSample.sampleCount, full.sampleCount);
  const controller = new AbortController(), cancelledPath = join(directory, "cancelled.wav");
  await assert.rejects(render(range, { outputPath: cancelledPath, signal: controller.signal,
    onProgress: ({ stage }) => { if (stage === "mix-audio") controller.abort(); } }), { name: "AbortError" });
  await assert.rejects(stat(cancelledPath), { code: "ENOENT" });
  assert.deepEqual(await readdir(join(directory, "work")), []);
  ffmpeg(["-f", "lavfi", "-i", "aevalsrc=0.11*sin(2*PI*997*t)|0.09*sin(2*PI*733*t):s=48000:d=3", "-c:a", "pcm_f32le", "-y", tone]);
  const changed = await render(range);
  assert.notEqual(changed.assets[0].sourceHash, bounded.assets[0].sourceHash);
  assert.equal(changed.assets[0].cacheHit, false);
  assert.notDeepEqual(decode(changed.path), pcm);
  assert.deepEqual(document, before);
});

test("ordinary video audio detachment retains actual PCM through track mix, ducking and nested retiming", { timeout: 60000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "editor-detach-pcm-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bundle = join(directory, "detach.mjs");
  await build({ stdin: { resolveDir: repository, contents: `
    export {renderEditorAudio} from './apps/video-studio/native/media/editor-audio-renderer';
    export {createTrack,defaultAudioMix,defaultTransform,defaultColorAdjustment} from './apps/video-studio/src/editor/defaults';
    export {planDetachOriginalAudio,planUnlinkAudio} from './apps/video-studio/src/editor/original-audio';
    export {applyEditorOperations} from './apps/video-studio/src/editor/operations';
    export {planClipAudioGain} from './apps/video-studio/src/editor/audio-gain-edits';
  ` }, bundle: true, platform: "node", format: "esm", outfile: bundle, logLevel: "silent" });
  const api = await import(pathToFileURL(bundle).href), video = join(directory, "original.mkv"), voice = join(directory, "voice.wav");
  ffmpeg(["-f", "lavfi", "-i", "color=red:s=32x32:r=10:d=4", "-f", "lavfi", "-i", `aevalsrc=0.2*sin(2*PI*440*t)|0.13*sin(2*PI*660*t):s=${S}:d=4`, "-c:v", "ffv1", "-c:a", "pcm_f32le", "-y", video]);
  ffmpeg(["-f", "lavfi", "-i", `aevalsrc=0.35*sin(2*PI*880*t)*between(t\\,0.5\\,1.5):s=${S}:d=4`, "-c:a", "pcm_f32le", "-y", voice]);
  const visual = () => ({ transform: api.defaultTransform(), color: api.defaultColorAdjustment(), blendMode: "normal" }),
    media = (id, trackId, assetId) => ({ id, label: id, trackId, kind: "media", assetId, start: 10013, duration: 2*T,
      timeMap: { points: [{ time: 0, source: 3*T }, { time: T, source: 2*T }, { time: 2*T, source: 2.5*T }] },
      audio: api.defaultAudioMix(), ...visual() }),
    sequence = (id) => ({ id, name: id, width: 32, height: 32, frameRate: { numerator: 30000, denominator: 1001 }, background: "#000000", timelineMode: "free",
      tracks: [api.createTrack("video", "video"), api.createTrack("voice", "audio"), api.createTrack("bed", "audio")], clips: [], transitions: [], markers: [] }),
    child = sequence("child"), source = media("source", "video", "video"), speaker = media("speaker", "voice", "voice"), bed = media("bed", "bed", "video"),
    ducking = (sidechainTrackIds) => ({ sidechainTrackIds, thresholdDb: -30, attenuationDb: 14, attack: 2000, release: 12000 });
  child.tracks[0].volume = 0.63; child.tracks[0].pan = -0.23;
  source.audio = { ...source.audio, volume: { keyframes: [{ time: 0, value: 0.3 }, { time: 2*T, value: 1.1 }] },
    pan: { keyframes: [{ time: 0, value: 0.15 }, { time: 2*T, value: 0.7 }] }, fadeIn: 20013, fadeOut: 40013,
    pitchSemitones: 2, preservePitch: true, ducking: ducking(["voice"]) };
  speaker.timeMap = { points: [{ time: 0, source: 0 }, { time: 2*T, source: 2*T }] };
  bed.audio.volume = 0.25; bed.audio.ducking = ducking(["video"]);
  // A second source-track clip must remain in the dependent sidechain bus.
  const neighbor = { ...media("neighbor", "video", "video"), start: 2*T+10013, duration: T,
    timeMap: { points: [{ time: 0, source: 0 }, { time: T, source: T }] } };
  child.clips = [source, speaker, bed, neighbor];
  const parent = sequence("parent");
  parent.tracks[0].volume = 0.8; parent.tracks[0].pan = 0.17;
  parent.clips = [{ id: "nested", label: "嵌套", kind: "sequence", trackId: "video", sequenceId: "child", start: 13,
    duration: 3*T, timeMap: { points: [{ time: 0, source: 0 }, { time: 3*T, source: 3*T }] }, audio: { ...api.defaultAudioMix(), fadeIn: 1000 }, ...visual() }];
  const document = { schemaVersion: 2, timebase: T, id: "detach", name: "原声", revision: 0, activeSequenceId: "child", exportProfiles: [],
    assets: [{ id: "video", name: "原片", kind: "video", duration: 4*T, resourceId: "original-video" }, { id: "voice", name: "说话", kind: "audio", duration: 4*T, resourceId: "voice-audio" }], sequences: [child, parent] };
  let serial = 0;
  const plan = api.planDetachOriginalAudio(document, "child", "source", () => `detach-${++serial}`),
    detached = api.applyEditorOperations(document, plan.operations, 0), paths = new Map([["video", video], ["voice", voice]]);
  const render = async (doc, sequenceId) => {
    const result = await api.renderEditorAudio({ document: doc, sequenceId, resolveAssetPath: (id) => paths.get(id),
      ffmpegPath: "ffmpeg", ffprobePath: "ffprobe", workDir: join(directory, "work"), cacheDir: join(directory, "cache"),
      outputPath: join(directory, `mix-${++serial}.wav`), signal: new AbortController().signal });
    return decode(result.path);
  };
  for (const id of ["child", "parent"]) {
    const before = await render(document, id), after = await render(detached, id);
    assert.equal(before.length, after.length);
    let maximum = 0;
    for (let index = 0; index < before.length; index++) maximum = Math.max(maximum, Math.abs(before[index] - after[index]));
    assert.ok(maximum < 1e-6, `${id}: maximum PCM difference ${maximum}`);
    assert.ok(rms(after, 0.2, 1.8) > 0.01, "equality must cover non-silent audio");
  }
  assert.deepEqual(detached.assets, document.assets);
  const unlinked = api.applyEditorOperations(detached, api.planUnlinkAudio(detached, "child", [plan.audioClipId]), 1),
    moved = api.applyEditorOperations(unlinked, [{ type: "clip.move", sequenceId: "child", clipIds: [plan.audioClipId], delta: 8000 }], 2);
  assert.equal(moved.sequences[0].clips.find((clip) => clip.id === "source").start, source.start);
  assert.equal(moved.sequences[0].clips.find((clip) => clip.id === plan.audioClipId).start, source.start + 8000);
  const fixed = structuredClone(detached), extracted = fixed.sequences[0].clips.find((clip) => clip.id === plan.audioClipId);
  extracted.audio.volume = 1;
  const gained = api.applyEditorOperations(fixed, api.planClipAudioGain(fixed, "child", extracted.id, 0.5), 1);
  assert.equal(gained.sequences[0].clips.find((clip) => clip.id === "source").audio.volume, 0);
  assert.equal(gained.sequences[0].clips.find((clip) => clip.id === extracted.id).audio.volume, 0.5);
  for (const doc of [fixed, gained]) {
    doc.sequences = [doc.sequences[0]];
    doc.sequences[0].clips = doc.sequences[0].clips.filter((clip) => clip.id === "source" || clip.id === extracted.id);
  }
  const unity = await render(fixed, "child"), half = await render(gained, "child");
  assert.equal(unity.length, half.length);
  for (let index = 0; index < unity.length; index++) near(half[index], unity[index] * 0.5, 1e-6);
  const muted = structuredClone(document); muted.sequences[0].tracks[0].muted = true;
  const mutedPlan = api.planDetachOriginalAudio(muted, "child", "source", () => `muted-${++serial}`),
    mutedAfter = api.applyEditorOperations(muted, mutedPlan.operations, 0),
    mutedPCM = await render(muted, "child"), mutedDetachedPCM = await render(mutedAfter, "child");
  assert.deepEqual(mutedDetachedPCM, mutedPCM, "muted source and its dry sidechain bus must remain silent");
});

test(
  "editor audio renders real local PCM for preview and export",
  { timeout: 120000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "editor-audio-pcm-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const bundle = join(directory, "audio.mjs");
    await build({
      stdin: {
        resolveDir: repository,
        sourcefile: "audio-fixture.ts",
        contents: `
    export {renderEditorAudio} from "./apps/video-studio/native/media/editor-audio-renderer.ts";
    export {createTrack,defaultAudioMix,defaultTransform,defaultColorAdjustment} from "./apps/video-studio/src/editor/defaults.ts";
    export {constantTimeMap,freezeTimeMap} from "./apps/video-studio/src/editor/time.ts";
    export {planClipAudioGain} from "./apps/video-studio/src/editor/audio-gain-edits.ts";
    export {applyEditorOperations} from "./apps/video-studio/src/editor/operations.ts";
    export {audioMixWarning} from "./apps/video-studio/src/editor/audio-mix-report.ts";
  `,
      },
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      logLevel: "silent",
    });
    const api = await import(pathToFileURL(bundle).href);
    const paths = new Map();
    for (const [id, expression] of [
      ["tone", "0.2*sin(2*PI*440*t)"],
      ["bed", "0.2*sin(2*PI*220*t)"],
      ["voice", "0.4*sin(2*PI*880*t)*between(t,1,2)"],
      ["silent", "0"],
      ["chirp", "0.2*sin(2*PI*(220*t+110*t*t))"],
    ]) {
      const path = join(directory, `${id}.wav`);
      ffmpeg([
        "-f",
        "lavfi",
        "-i",
        `aevalsrc='${expression}|${expression}':s=${S}:d=4`,
        "-c:a",
        "pcm_f32le",
        "-y",
        path,
      ]);
      paths.set(id, path);
    }
    const noAudio = join(directory, "no-audio.mp4");
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "color=black:s=32x32:r=10:d=4",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-y",
      noAudio,
    ]);
    paths.set("no-audio", noAudio);
    const offsetAudio = join(directory, "offset-audio.mp4");
    ffmpeg([
      "-i",
      noAudio,
      "-itsoffset",
      "0.75",
      "-i",
      paths.get("tone"),
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-t",
      "4",
      "-y",
      offsetAudio,
    ]);
    paths.set("offset-audio", offsetAudio);
    const visual = () => ({
      transform: api.defaultTransform(),
      color: api.defaultColorAdjustment(),
      blendMode: "normal",
    });
    const clip = (id = "clip", assetId = "tone", duration = 2 * T, trackId = "video") => ({
      id,
      label: id,
      kind: "media",
      trackId,
      start: 0,
      duration,
      assetId,
      timeMap: api.constantTimeMap(0, duration).timeMap,
      audio: api.defaultAudioMix(),
      ...visual(),
    });
    const sequence = (id = "main") => ({
      id,
      name: id,
      width: 1280,
      height: 720,
      frameRate: { numerator: 30000, denominator: 1001 },
      background: "#000000",
      timelineMode: "free",
      tracks: [api.createTrack("video", "audio"), api.createTrack("sound", "audio")],
      clips: [],
      transitions: [],
      markers: [],
    });
    const document = (...sequences) => ({
      schemaVersion: 2,
      timebase: T,
      id: "doc",
      name: "Audio",
      revision: 0,
      assets: [...paths.keys()].map((id) => ({
        id,
        name: id,
        kind: id === "no-audio" ? "video" : "audio",
        duration: 4 * T,
        ...(id === "no-audio" ? { width: 32, height: 32 } : {}),
      })),
      sequences,
      activeSequenceId: sequences[0].id,
      exportProfiles: [],
    });
    let renderIndex = 0;
    const options = (doc, extra = {}) => ({
      document: doc,
      sequenceId: "main",
      resolveAssetPath: (id) => paths.get(id),
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workDir: join(directory, "work"),
      cacheDir: join(directory, "cache"),
      outputPath: join(directory, "outputs", `mix-${++renderIndex}.wav`),
      signal: new AbortController().signal,
      ...extra,
    });
    const render = async (seq, extra = {}) => {
      const result = await api.renderEditorAudio(options(document(seq), extra));
      return { result, pcm: decode(result.path) };
    };

    await t.test(
      "unity PCM, exact output sample count, stereo center and amplitude survive",
      async () => {
        const seq = sequence();
        seq.clips = [clip("clip", "tone", 2 * T + 3)];
        const { result, pcm } = await render(seq);
        assert.equal(result.sampleCount, 2 * S + 1);
        assert.equal(pcm.length, result.sampleCount * 2);
        near(frequency(pcm, 0.2, 1.8), 440, 1);
        near(rms(pcm, 0.2, 1.8), 0.2 / Math.sqrt(2), 0.0001);
        assert.deepEqual(
          pcm.filter((_, i) => i % 2 === 0),
          pcm.filter((_, i) => i % 2 === 1),
        );
        assert.equal(result.samplesOverFullScale, 0);
        near(result.peak, 0.2, 1e-6);
      },
    );

    await t.test(
      "volume and pan keyframes, cubic easing and fades affect actual samples",
      async () => {
        const seq = sequence(),
          media = clip();
        media.audio.volume = {
          keyframes: [
            {
              time: 0,
              value: 0,
              easing: { type: "cubic-bezier", x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
            },
            { time: 2 * T, value: 1 },
          ],
        };
        media.audio.pan = {
          keyframes: [
            { time: 0, value: -1 },
            { time: 2 * T, value: 1 },
          ],
        };
        media.audio.fadeIn = T;
        media.audio.fadeOut = T;
        seq.clips = [media];
        const { pcm } = await render(seq);
        assert.ok(rms(pcm, 0.05, 0.1) < 0.001);
        assert.ok(rms(pcm, 0.2, 0.3, 0) > rms(pcm, 0.2, 0.3, 1) * 2);
        near(rms(pcm, 0.995, 1.005), (0.2 / Math.sqrt(2)) * 0.5, 0.003);
        assert.ok(rms(pcm, 1.8, 1.9, 1) > rms(pcm, 1.8, 1.9, 0) * 2);
        assert.ok(rms(pcm, 1.999, 2, 1) < 0.001);
      },
    );

    await t.test(
      "reverse reads actual source samples in descending order; freeze is explicitly silent",
      async () => {
        const seq = sequence(),
          media = clip("reverse", "chirp");
        media.timeMap = api.constantTimeMap(3 * T, T).timeMap;
        seq.clips = [media];
        const { pcm } = await render(seq),
          source = decode(paths.get("chirp"));
        for (const sample of [0, 1, 313, 9011, 24000, 65001, 95999])
          near(pcm[sample * 2], source[(3 * S - sample) * 2], 1e-7);
        media.timeMap = api.freezeTimeMap(T, 2 * T);
        const hold = await render(seq);
        assert.equal(hold.result.peak, 0);
        assert.ok(hold.pcm.every((value) => value === 0));
      },
    );

    await t.test(
      "2x speed preserves pitch when requested and changes it when disabled",
      async () => {
        const seq = sequence(),
          media = clip();
        media.timeMap = api.constantTimeMap(0, 4 * T, 2).timeMap;
        seq.clips = [media];
        const preserved = await render(seq);
        near(frequency(preserved.pcm, 0.3, 1.7), 440, 2);
        assert.equal(preserved.result.processing.processedSpans, 1);
        media.audio.preservePitch = false;
        const natural = await render(seq);
        near(frequency(natural.pcm, 0.3, 1.7), 880, 2);
        near(rms(natural.pcm, 0.3, 1.7), 0.2 / Math.sqrt(2), 0.003);
      },
    );

    await t.test(
      "independent octave pitch shifts preserve duration and reuse processed PCM",
      async () => {
        const seq = sequence(),
          media = clip();
        media.audio.pitchSemitones = 12;
        seq.clips = [media];
        const shifted = await render(seq);
        near(frequency(shifted.pcm, 0.3, 1.7), 880, 2);
        assert.equal(shifted.pcm.length, 2 * S * 2);
        const again = await render(seq);
        assert.equal(again.result.processing.spanCacheHits, 1);
        assert.ok(again.result.assets.every((asset) => asset.cacheHit));
        assert.deepEqual(again.pcm, shifted.pcm);
        media.audio.pitchSemitones = -12;
        const lowered = await render(seq);
        near(frequency(lowered.pcm, 0.3, 1.7), 220, 2);
      },
    );

    await t.test(
      "piecewise speed and reverse spans produce their own correct pitch and sample durations",
      async () => {
        const seq = sequence(),
          media = clip("curve", "tone", 3 * T);
        media.timeMap = {
          points: [
            { time: 0, source: 0 },
            { time: T, source: 2 * T },
            { time: 2 * T, source: (5 * T) / 2 },
            { time: 3 * T, source: (3 * T) / 2 },
          ],
        };
        media.audio.preservePitch = false;
        seq.clips = [media];
        const { pcm } = await render(seq);
        near(frequency(pcm, 0.2, 0.8), 880, 2);
        near(frequency(pcm, 1.2, 1.8), 220, 2);
        near(frequency(pcm, 2.2, 2.8), 440, 2);
        assert.equal(pcm.length, 3 * S * 2);
      },
    );

    await t.test(
      "real RMS sidechain lowers the bed and releases; muting that source removes the duck",
      async () => {
        const seq = sequence(),
          voice = clip("voice", "voice", 3 * T),
          bed = clip("bed", "bed", 3 * T, "sound");
        voice.audio.pan = 1;
        bed.audio.pan = -1;
        bed.audio.ducking = {
          sidechainTrackIds: ["video"],
          thresholdDb: -24,
          attenuationDb: 12,
          attack: 0.03 * T,
          release: 0.08 * T,
        };
        seq.clips = [voice, bed];
        const ducked = await render(seq);
        const baseline = rms(ducked.pcm, 0.4, 0.8),
          during = rms(ducked.pcm, 1.4, 1.8),
          recovered = rms(ducked.pcm, 2.7, 2.9);
        near(during / baseline, 10 ** (-12 / 20), 0.005);
        near(recovered / baseline, 1, 0.01);
        assert.equal(ducked.result.ducking.sidechain, "pre-ducking-scoped-bus");
        seq.tracks[0].muted = true;
        const muted = await render(seq);
        near(rms(muted.pcm, 1.4, 1.8) / rms(muted.pcm, 0.4, 0.8), 1, 0.001);
        seq.tracks[0].muted = false;
        voice.assetId = "silent";
        const silent = await render(seq);
        near(rms(silent.pcm, 1.4, 1.8) / rms(silent.pcm, 0.4, 0.8), 1, 0.001);
      },
    );

    await t.test("nested source time and parent gain affect actual audio", async () => {
      const root = sequence(),
        child = sequence("child"),
        media = clip("leaf", "tone", 4 * T);
      media.audio.volume = 0.5;
      child.clips = [media];
      const parent = {
        id: "nest",
        kind: "sequence",
        sequenceId: "child",
        label: "Nested",
        trackId: "video",
        start: 0,
        duration: 2 * T,
        timeMap: api.constantTimeMap(0, 4 * T, 2).timeMap,
        audio: { ...api.defaultAudioMix(), volume: 0.5, preservePitch: false },
        ...visual(),
      };
      root.clips = [parent];
      const result = await api.renderEditorAudio(options(document(root, child))),
        pcm = decode(result.path);
      near(frequency(pcm, 0.3, 1.7), 880, 2);
      near(rms(pcm, 0.3, 1.7), 0.05 / Math.sqrt(2), 0.002);
    });

    await t.test("multicam visual switches never interrupt the chosen master audio", async () => {
      const seq = sequence();
      seq.tracks[0].kind = "video";
      seq.clips = [
        {
          id: "multi",
          kind: "multicam",
          label: "Multi",
          trackId: "video",
          start: 0,
          duration: 2 * T,
          timeMap: api.constantTimeMap(0, 2 * T).timeMap,
          audio: api.defaultAudioMix(),
          ...visual(),
          angles: [
            { id: "a", name: "A", assetId: "tone", offset: 0 },
            { id: "b", name: "B", assetId: "bed", offset: T },
          ],
          switches: [
            { time: 0, angleId: "a" },
            { time: T, angleId: "b" },
          ],
          audioAngleId: "a",
        },
      ];
      // Schema multicam angles need video assets; these local WAV fixtures still contain the selected real sound stream.
      const doc = document(seq);
      for (const asset of doc.assets)
        if (["tone", "bed"].includes(asset.id))
          Object.assign(asset, { kind: "video", width: 1280, height: 720 });
      const result = await api.renderEditorAudio(options(doc)),
        pcm = decode(result.path);
      near(frequency(pcm, 0.2, 0.8), 440, 2);
      near(frequency(pcm, 1.2, 1.8), 440, 2);
      assert.deepEqual(
        result.assets.map((asset) => asset.assetId),
        ["tone"],
      );
    });

    await t.test(
      "actual no-audio video is reported, a false audio asset fails, and silence is never fabricated on failure",
      async () => {
        const seq = sequence();
        seq.clips = [clip("silent-video", "no-audio")];
        const video = await render(seq);
        assert.equal(video.result.assets[0].status, "no-audio-stream");
        assert.equal(video.result.peak, 0);
        const doc = document(seq);
        const asset = doc.assets.find((item) => item.id === "no-audio");
        asset.kind = "audio";
        delete asset.width;
        delete asset.height;
        await assert.rejects(api.renderEditorAudio(options(doc)), /no decodable audio stream/);
      },
    );

    await t.test(
      "cancellation releases temporary files and never publishes an incomplete WAV",
      async () => {
        const seq = sequence();
        seq.clips = [clip()];
        const controller = new AbortController();
        const args = options(document(seq), {
          signal: controller.signal,
          onProgress: ({ stage }) => {
            if (stage === "mix-audio") controller.abort();
          },
        });
        await assert.rejects(api.renderEditorAudio(args), (error) => error.name === "AbortError");
        await assert.rejects(stat(args.outputPath), { code: "ENOENT" });
        assert.deepEqual(await readdir(args.workDir), []);
        await assert.rejects(
          api.renderEditorAudio(options(document(seq), { maxPcmBytes: 8 })),
          /disk budget/,
        );
        await assert.rejects(
          api.renderEditorAudio(options(document(seq), { maxMixBytes: 8 })),
          /memory budget/,
        );
      },
    );

    await t.test(
      "empty timelines and a one-sample retimed clip keep their exact output bounds",
      async () => {
        const seq = sequence();
        const empty = await render(seq);
        assert.equal(empty.result.sampleCount, 0);
        assert.equal(empty.pcm.length, 0);
        const media = clip("tiny", "tone", 3);
        media.timeMap = {
          points: [
            { time: 0, source: T },
            { time: 3, source: T + 6 },
          ],
        };
        seq.clips = [media];
        const tiny = await render(seq);
        assert.equal(tiny.result.sampleCount, 1);
        assert.equal(tiny.pcm.length, 2);
        assert.ok(tiny.pcm.every(Number.isFinite));
      },
    );

    await t.test("a fixed clip gain edit scales real PCM and preserves pan, fades, pitch and ducking", async () => {
      const seq = sequence(), media = clip();
      media.audio = { ...media.audio, pan: -.4, fadeIn: T / 4, fadeOut: T / 2, pitchSemitones: 3,
        preservePitch: false, ducking: { sidechainTrackIds: ["sound"], thresholdDb: -24,
          attenuationDb: 8, attack: T / 100, release: T / 10 } };
      seq.clips = [media]; const doc = document(seq), original = await render(seq);
      const next = api.applyEditorOperations(doc, api.planClipAudioGain(doc, "main", media.id, .5), doc.revision),
        edited = await render(next.sequences[0]);
      assert.deepEqual(next.sequences[0].clips[0].audio, { ...media.audio, volume: .5 });
      assert.equal(edited.pcm.length, original.pcm.length);
      for (let sample = 0; sample < original.pcm.length; sample++) near(edited.pcm[sample], original.pcm[sample] * .5, 1e-6);
      near(edited.result.peak, original.result.peak * .5, 1e-6);
      assert.ok(rms(edited.pcm, .4, 1.4) > rms(edited.pcm, .4, 1.4, 1));
    });

    await t.test(
      "float WAV preserves chosen gain and reports overload instead of normalizing it",
      async () => {
        const seq = sequence(),
          media = clip();
        media.audio.volume = 4;
        seq.tracks[0].volume = 4;
        seq.clips = [media];
        const { result, pcm } = await render(seq);
        near(result.peak, 3.2, 0.0001);
        assert.ok(result.samplesOverFullScale > 0);
        near(rms(pcm, 0.2, 1.8), 3.2 / Math.sqrt(2), 0.001);
      },
    );

    await t.test(
      "muted and zero-gain tracks stay silent at 400 percent clip gain and restore the saved fades",
      async () => {
        const seq = sequence(), media = clip();
        media.audio.volume = 4;
        media.audio.fadeIn = T / 4;
        media.audio.fadeOut = T / 2;
        seq.clips = [media];
        const savedMix = structuredClone(media.audio);
        seq.tracks[0].muted = true;
        const muted = await render(seq);
        assert.equal(muted.result.peak, 0);
        assert.ok(muted.pcm.every((sample) => sample === 0));
        seq.tracks[0].muted = false;
        seq.tracks[0].volume = 0;
        const zero = await render(seq);
        assert.equal(zero.result.peak, 0);
        assert.ok(zero.pcm.every((sample) => sample === 0));
        seq.tracks[0].volume = 1;
        const restored = await render(seq);
        near(restored.result.peak, 0.8, 0.0001);
        near(rms(restored.pcm, 0.4, 1.4), 0.8 / Math.sqrt(2), 0.001);
        assert.ok(rms(restored.pcm, 0, 0.02) < rms(restored.pcm, 0.4, 0.5) / 10);
        assert.ok(rms(restored.pcm, 1.98, 2) < rms(restored.pcm, 0.4, 0.5) / 10);
        assert.deepEqual(media.audio, savedMix);
      },
    );

    await t.test(
      "two real sine tracks warn about overload and clear after lowering gain",
      async () => {
        const seq = sequence();
        seq.clips = [clip("first", "tone", 2 * T, "video"), clip("second", "tone", 2 * T, "sound")];
        for (const media of seq.clips) media.audio.volume = 3;
        const overloaded = await render(seq);
        near(overloaded.result.peak, 1.2, 0.0001);
        const measured = overloaded.pcm.reduce(
          (peak, sample) => Math.max(peak, Math.abs(sample)),
          0,
        );
        near(measured, overloaded.result.peak, 0.0001);
        assert.ok(overloaded.result.samplesOverFullScale > 0);
        assert.match(api.audioMixWarning(overloaded.result), /\+1\.6 dBFS.*降低音轨或片段音量/);
        assert.equal(seq.clips[0].audio.volume, 3, "A warning must preserve the chosen gain");
        for (const media of seq.clips) media.audio.volume = 1;
        const corrected = await render(seq);
        near(corrected.result.peak, 0.4, 0.0001);
        assert.equal(corrected.result.samplesOverFullScale, 0);
        assert.equal(api.audioMixWarning(corrected.result), "");
      },
    );

    await t.test(
      "container audio start timestamps retain real silence before a delayed sound stream",
      async () => {
        const seq = sequence();
        seq.clips = [clip("delayed", "offset-audio")];
        const { pcm } = await render(seq);
        assert.equal(rms(pcm, 0.1, 0.6), 0);
        near(frequency(pcm, 1, 1.8), 440, 2);
        near(rms(pcm, 1, 1.8), 0.2 / Math.sqrt(2), 0.005);
      },
    );

    await t.test(
      "audio outside a nested sequence trim never requests unused source files",
      async () => {
        const root = sequence(),
          child = sequence("child"),
          media = clip("outside", "tone", T);
        media.start = 2 * T;
        child.clips = [media];
        root.clips = [
          {
            id: "trim",
            kind: "sequence",
            label: "Trim",
            sequenceId: "child",
            trackId: "video",
            start: 0,
            duration: T,
            timeMap: api.constantTimeMap(0, T).timeMap,
            audio: api.defaultAudioMix(),
            ...visual(),
          },
        ];
        const result = await api.renderEditorAudio(
          options(document(root, child), {
            resolveAssetPath: () => {
              throw new Error("Unused audio must not be requested");
            },
          }),
        );
        assert.equal(result.peak, 0);
        assert.equal(result.sampleCount, S);
        assert.deepEqual(result.assets, []);
      },
    );

    await t.test("missing FFmpeg filters fail with a clear capability error", async () => {
      const executable = join(directory, "ffmpeg-without-atempo");
      await writeFile(
        executable,
        "#!/bin/sh\ncase \"$2\" in -version) echo fixture;; -filters) echo ' .. aresample A->A'; echo ' .. asetrate A->A'; echo ' .. atrim A->A';; esac\n",
        { mode: 0o755 },
      );
      const seq = sequence();
      seq.clips = [clip()];
      await assert.rejects(
        api.renderEditorAudio(options(document(seq), { ffmpegPath: executable })),
        /required atempo audio filter/,
      );
    });
  },
);
