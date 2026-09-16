import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateFrame, prepareEvaluator } from "../apps/video-studio/src/editor/evaluate";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTextStyle,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import { constantTimeMap, freezeTimeMap } from "../apps/video-studio/src/editor/time";
import type {
  EditorAsset,
  EditorDocument,
  EditorSequence,
  MediaClip,
  MulticamClip,
  SequenceClip,
  ShapeClip,
  TextClip,
} from "../apps/video-studio/src/editor/types";

const visual = () => ({
  transform: defaultTransform(),
  color: defaultColorAdjustment(),
  blendMode: "normal" as const,
});
function media(
  id: string,
  trackId = "picture",
  source = 0,
  duration = 1000,
  assetId = "source",
): MediaClip {
  return {
    id,
    label: id,
    kind: "media",
    trackId,
    start: 0,
    duration,
    assetId,
    timeMap: constantTimeMap(source, source + duration).timeMap,
    audio: defaultAudioMix(),
    ...visual(),
  };
}
function sequence(id = "main"): EditorSequence {
  return {
    id,
    name: id,
    width: 1920,
    height: 1080,
    frameRate: { numerator: 30, denominator: 1 },
    background: "#123456",
    timelineMode: "free",
    tracks: [
      createTrack("picture", "video"),
      createTrack("sound", "audio"),
      createTrack("words", "text"),
    ],
    clips: [],
    transitions: [],
    markers: [],
  };
}
function document(...sequences: EditorSequence[]): EditorDocument {
  const assets: EditorAsset[] = [
    { id: "source", name: "Camera A", kind: "video", duration: 10000, width: 1280, height: 720 },
    { id: "second", name: "Camera B", kind: "video", duration: 10000, width: 1080, height: 1920 },
    { id: "audio", name: "Audio", kind: "audio", duration: 10000 },
    { id: "image", name: "Still", kind: "image", duration: 0, width: 512, height: 512 },
  ];
  return {
    schemaVersion: 2,
    timebase: 240000,
    id: "doc",
    name: "Evaluator test",
    revision: 0,
    assets,
    sequences,
    activeSequenceId: sequences[0]!.id,
    exportProfiles: [],
  };
}
function nested(id: string, sequenceId: string, trackId = "picture"): SequenceClip {
  return {
    id,
    label: id,
    kind: "sequence",
    sequenceId,
    trackId,
    start: 0,
    duration: 500,
    timeMap: constantTimeMap(0, 1000, 2).timeMap,
    audio: defaultAudioMix(),
    ...visual(),
  };
}
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("same asset on separate tracks keeps distinct source time, instances, and bottom-to-top order", () => {
  const seq = sequence();
  seq.tracks.unshift(createTrack("lower", "video"));
  seq.clips = [media("upper", "picture", 2000), media("lower", "lower", 100)];
  const frame = evaluateFrame(document(seq), "main", 250);
  assert.deepEqual(
    frame.layers.map((layer) => layer.kind === "media" && [layer.clipId, layer.sourceTime]),
    [
      ["lower", 350],
      ["upper", 2250],
    ],
  );
  assert.equal(new Set(frame.layers.map((layer) => layer.instanceId)).size, 2);
  assert.equal(new Set(frame.audio.map((clip) => clip.instanceId)).size, 2);
  assert.deepEqual(
    frame.audio.map((clip) => clip.sourceTime),
    [350, 2250],
  );
  assert.equal(frame.width, 1920);
  assert.equal(frame.background, "#123456");
});

test("hidden affects picture, muted affects audio, and locked affects neither playback output", () => {
  const seq = sequence();
  seq.clips = [media("camera")];
  seq.tracks[0]!.locked = true;
  let frame = evaluateFrame(document(seq), "main", 100);
  assert.equal(frame.layers.length, 1);
  assert.equal(frame.audio[0]!.gain, 1);
  seq.tracks[0]!.hidden = true;
  frame = evaluateFrame(document(seq), "main", 100);
  assert.equal(frame.layers.length, 0);
  assert.equal(frame.audio[0]!.gain, 1);
  seq.tracks[0]!.hidden = false;
  seq.tracks[0]!.muted = true;
  frame = evaluateFrame(document(seq), "main", 100);
  assert.equal(frame.layers.length, 1);
  assert.equal(frame.audio[0]!.gain, 0);
  const sound = media("sound", "sound", 100, 1000, "audio");
  seq.clips.push(sound);
  seq.tracks[1]!.hidden = true;
  frame = evaluateFrame(document(seq), "main", 100);
  assert.equal(frame.audio.find((clip) => clip.clipId === "sound")!.gain, 1);
  assert.equal(frame.layers.length, 1);
});

test("clip-local keyframes resolve geometry, colors, audio volume, pan, pitch, and fades", () => {
  const seq = sequence(),
    clip = media("animated");
  clip.start = 300;
  clip.transform.x = {
    keyframes: [
      { time: 0, value: -1 },
      { time: 1000, value: 1 },
    ],
  };
  clip.color.exposure = {
    keyframes: [
      { time: 0, value: -2 },
      { time: 1000, value: 2 },
    ],
  };
  clip.audio.volume = {
    keyframes: [
      { time: 0, value: 0 },
      { time: 1000, value: 2 },
    ],
  };
  clip.audio.pan = 0.3;
  clip.audio.pitchSemitones = 5;
  clip.audio.fadeIn = 1000;
  clip.audio.fadeOut = 1000;
  seq.tracks[0]!.volume = 0.5;
  seq.tracks[0]!.pan = 0.2;
  seq.clips = [clip];
  const frame = evaluateFrame(document(seq), "main", 800),
    layer = frame.layers[0]!;
  assert.equal(layer.kind, "media");
  if (layer.kind !== "media") return;
  assert.equal(layer.localTime, 500);
  assert.equal(layer.transform.x, 0);
  assert.equal(layer.color.exposure, 0);
  assert.equal(layer.sourceTime, 500);
  assert.equal(frame.audio[0]!.gain, 0.125);
  assert.equal(frame.audio[0]!.fadeGain, 0.25);
  assert.equal(frame.audio[0]!.pan, 0.5);
  assert.equal(frame.audio[0]!.pitchSemitones, 5);
  assert.equal(evaluateFrame(document(seq), "main", 300).audio[0]!.gain, 0);
});

test("reverse and freeze maps retain their actual source coordinates and silent held audio", () => {
  const seq = sequence(),
    clip = media("reverse");
  clip.timeMap = constantTimeMap(4000, 3000).timeMap;
  seq.clips = [clip];
  let frame = evaluateFrame(document(seq), "main", 250);
  assert.equal(frame.layers[0]!.kind === "media" && frame.layers[0]!.sourceTime, 3750);
  assert.equal(frame.audio[0]!.playbackRate, -1);
  clip.timeMap = freezeTimeMap(4000, clip.duration);
  frame = evaluateFrame(document(seq), "main", 750);
  assert.equal(frame.layers[0]!.kind === "media" && frame.layers[0]!.sourceTime, 4000);
  assert.equal(frame.audio[0]!.playbackRate, 0);
  assert.equal(frame.audio[0]!.gain, 0);
});

test("overshooting keyframe curves respect physical property bounds after interpolation", () => {
  const seq = sequence(),
    clip = media("overshoot");
  const animated = (from: number, to: number) => ({
    keyframes: [
      {
        time: 0,
        value: from,
        easing: { type: "cubic-bezier" as const, x1: 0.2, y1: 4, x2: 0.8, y2: 4 },
      },
      { time: 1000, value: to },
    ],
  });
  clip.transform.opacity = animated(0, 1);
  clip.transform.scaleX = animated(100, 0);
  clip.color.contrast = animated(0, 4);
  clip.audio.volume = animated(0, 4);
  clip.audio.pan = animated(-1, 1);
  seq.clips = [clip];
  const frame = evaluateFrame(document(seq), "main", 500),
    layer = frame.layers[0]!;
  assert.equal(layer.kind, "media");
  if (layer.kind !== "media") return;
  assert.equal(layer.transform.opacity, 1);
  assert.equal(layer.transform.scaleX, 0);
  assert.equal(layer.color.contrast, 4);
  assert.equal(frame.audio[0]!.gain, 4);
  assert.equal(frame.audio[0]!.pan, 1);
});

test("transition midpoint is a single explicit blend operation with full endpoint opacity", () => {
  const seq = sequence(),
    from = media("from"),
    to = media("to", "picture", 2000);
  to.start = 800;
  seq.clips = [from, to];
  seq.transitions = [
    { id: "join", fromClipId: "from", toClipId: "to", start: 800, duration: 200, kind: "dissolve" },
  ];
  const frame = evaluateFrame(document(seq), "main", 900),
    layer = frame.layers[0]!;
  assert.equal(frame.layers.length, 1);
  assert.equal(layer.kind, "transition");
  if (layer.kind !== "transition") return;
  assert.equal(layer.transitionKind, "dissolve");
  assert.equal(layer.progress, 0.5);
  assert.equal(layer.from?.transform.opacity, 1);
  assert.equal(layer.to?.transform.opacity, 1);
  assert.equal(layer.from?.kind === "media" && layer.from.sourceTime, 900);
  assert.equal(layer.to?.kind === "media" && layer.to.sourceTime, 2100);
  const after = evaluateFrame(document(seq), "main", 1000);
  assert.equal(after.layers.length, 1);
  assert.equal(after.layers[0]!.kind === "media" && after.layers[0]!.clipId, "to");
});

test("nested sequence retains its own canvas and applies source mapping plus ancestor audio gain", () => {
  const child = sequence("child"),
    childMedia = media("camera", "picture", 100);
  child.width = 640;
  child.height = 480;
  child.background = "#abcdef";
  childMedia.audio.volume = 0.5;
  childMedia.audio.pan = 0.1;
  childMedia.audio.pitchSemitones = 2;
  child.tracks[0]!.volume = 0.5;
  child.clips = [childMedia];
  const root = sequence(),
    parent = nested("nested", "child");
  parent.audio.volume = 0.8;
  parent.audio.pan = 0.2;
  parent.audio.pitchSemitones = 3;
  parent.audio.fadeIn = 500;
  parent.transform.scaleX = 0.5;
  root.tracks[0]!.volume = 0.5;
  root.clips = [parent];
  const frame = evaluateFrame(document(root, child), "main", 250),
    group = frame.layers[0]!;
  assert.equal(group.kind, "group");
  if (group.kind !== "group") return;
  assert.deepEqual(
    [group.width, group.height, group.background, group.sourceTime],
    [640, 480, "#abcdef", 500],
  );
  assert.equal(group.transform.scaleX, 0.5);
  const leaf = group.layers[0]!;
  assert.equal(leaf.kind === "media" && leaf.sourceTime, 600);
  near(frame.audio[0]!.gain, 0.05);
  near(frame.audio[0]!.pan, 0.3);
  assert.equal(frame.audio[0]!.pitchSemitones, 5);
  assert.equal(frame.audio[0]!.playbackRate, 2);
  assert.deepEqual(frame.audio[0]!.trackInstancePath, [
    "sequence:main/track:picture",
    "sequence:main/clip:nested/sequence:child/track:picture",
  ]);
  assert.ok(leaf.instanceId.includes("clip:nested/sequence:child/clip:camera"));
  root.tracks[0]!.hidden = true;
  const hidden = evaluateFrame(document(root, child), "main", 250);
  assert.equal(hidden.layers.length, 0);
  near(hidden.audio[0]!.gain, 0.05);
});

test("reused nested sequence instances do not share decoder or audio instance identifiers", () => {
  const child = sequence("child");
  child.clips = [media("camera")];
  const root = sequence();
  root.tracks.unshift(createTrack("lower", "video"));
  const first = nested("first", "child", "lower"),
    second = nested("second", "child");
  second.timeMap = constantTimeMap(200, 700).timeMap;
  root.clips = [first, second];
  const frame = evaluateFrame(document(root, child), "main", 100);
  assert.deepEqual(
    frame.audio.map((clip) => clip.sourceTime),
    [200, 300],
  );
  assert.equal(new Set(frame.audio.map((clip) => clip.instanceId)).size, 2);
  assert.equal(new Set(frame.audio.map((clip) => clip.trackInstanceId)).size, 2);
});

test("multicam switches picture with signed synchronization offsets and keeps continuous chosen audio", () => {
  const seq = sequence();
  const clip: MulticamClip = {
    id: "multicam",
    kind: "multicam",
    label: "Interview",
    trackId: "picture",
    start: 0,
    duration: 1000,
    timeMap: constantTimeMap(2000, 3000).timeMap,
    angles: [
      { id: "a", name: "A", assetId: "source", offset: 100 },
      { id: "b", name: "B", assetId: "second", offset: -200 },
    ],
    switches: [
      { time: 0, angleId: "a" },
      { time: 500, angleId: "b" },
    ],
    audioAngleId: "a",
    audio: defaultAudioMix(),
    ...visual(),
  };
  seq.clips = [clip];
  const evaluator = prepareEvaluator(document(seq));
  const before = evaluator.evaluate("main", 499),
    after = evaluator.evaluate("main", 500);
  assert.equal(before.layers[0]!.kind === "media" && before.layers[0]!.assetId, "source");
  assert.equal(after.layers[0]!.kind === "media" && after.layers[0]!.assetId, "second");
  assert.equal(after.layers[0]!.kind === "media" && after.layers[0]!.sourceTime, 2300);
  assert.deepEqual([before.audio[0]!.assetId, after.audio[0]!.assetId], ["source", "source"]);
  assert.deepEqual([before.audio[0]!.sourceTime, after.audio[0]!.sourceTime], [2599, 2600]);
  assert.equal(before.audio[0]!.instanceId, after.audio[0]!.instanceId);
});

test("subtitle words use end-exclusive local timing and text/shape properties survive resolution", () => {
  const seq = sequence();
  const text: TextClip = {
    id: "words",
    kind: "text",
    label: "Text",
    trackId: "words",
    start: 100,
    duration: 1000,
    text: "你好世界",
    role: "subtitle",
    words: [
      { text: "你好", start: 0, end: 500 },
      { text: "世界", start: 500, end: 1000 },
    ],
    style: { ...defaultTextStyle(), animation: "word-highlight", fontSize: 72, color: "#ffcc00" },
    ...visual(),
  };
  const shape: ShapeClip = {
    id: "shape",
    kind: "shape",
    label: "Box",
    trackId: "picture",
    start: 0,
    duration: 1100,
    shape: "rectangle",
    fill: "#ffffff",
    stroke: "#000000",
    strokeWidth: 2,
    ...visual(),
  };
  seq.clips = [text, shape];
  const frame = evaluateFrame(document(seq), "main", 600);
  assert.equal(frame.layers[0]!.kind, "shape");
  const layer = frame.layers[1]!;
  assert.equal(layer.kind, "text");
  if (layer.kind !== "text") return;
  assert.deepEqual(layer.activeWordIndices, [1]);
  assert.equal(layer.style.fontSize, 72);
  assert.equal(layer.animationProgress, 0.5);
  assert.equal(frame.audio.length, 0);
});

test("source end and clip end are exclusive while still images with zero media duration render", () => {
  const seq = sequence(),
    reverse = media("reverse");
  reverse.timeMap = constantTimeMap(10000, 9000).timeMap;
  seq.clips = [reverse];
  const evaluator = prepareEvaluator(document(seq));
  assert.deepEqual(evaluator.evaluate("main", 0).layers, []);
  assert.deepEqual(evaluator.evaluate("main", 0).audio, []);
  assert.equal(evaluator.evaluate("main", 1).layers.length, 1);
  assert.deepEqual(evaluator.evaluate("main", 1000).layers, []);
  const still = media("still", "picture", 0, 1000, "image");
  still.timeMap = freezeTimeMap(0, 1000);
  seq.clips = [still];
  assert.equal(evaluateFrame(document(seq), "main", 500).layers.length, 1);
});

test("ducking remains a request for analyzed sidechain activity and does not fabricate attenuation", () => {
  const seq = sequence(),
    bed = media("bed", "sound", 0, 1000, "audio");
  bed.audio.ducking = {
    sidechainTrackIds: ["picture"],
    thresholdDb: -30,
    attenuationDb: 12,
    attack: 10,
    release: 20,
  };
  seq.clips = [media("camera"), bed];
  const frame = evaluateFrame(document(seq), "main", 500),
    audio = frame.audio.find((clip) => clip.clipId === "bed")!;
  assert.equal(audio.gain, 1);
  assert.deepEqual(audio.ducking[0]!.sidechainTrackInstanceIds, ["sequence:main/track:picture"]);
  assert.equal(audio.ducking[0]!.attenuationDb, 12);
  assert.equal(audio.ducking[0]!.sequenceTime, 500);
});

test("prepared evaluator owns a validated copy and never leaks mutable source records", () => {
  const seq = sequence(),
    clip = media("camera");
  seq.clips = [clip];
  const doc = document(seq),
    evaluator = prepareEvaluator(doc);
  clip.transform.x = 5;
  doc.sequences[0]!.background = "#000000";
  const first = evaluator.evaluate("main", 100),
    layer = first.layers[0]!;
  assert.equal(first.background, "#123456");
  if (layer.kind === "media") {
    assert.equal(layer.transform.x, 0);
    layer.transform.crop.left = 0.5;
  }
  const second = evaluator.evaluate("main", 100).layers[0]!;
  assert.equal(second.kind === "media" && second.transform.crop.left, 0);
  assert.throws(() => evaluator.evaluate("missing", 100));
  assert.throws(() => evaluator.evaluate("main", -1));
  assert.throws(() => prepareEvaluator({ ...doc, futureTimeline: [] }));
});
