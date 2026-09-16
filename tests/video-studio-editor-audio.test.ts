import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compileAudioPlan,
  sampleAudioLane,
  TICKS_PER_AUDIO_SAMPLE,
} from "../apps/video-studio/src/editor/audio-plan";
import { prepareEvaluator } from "../apps/video-studio/src/editor/evaluate";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import { constantTimeMap, freezeTimeMap } from "../apps/video-studio/src/editor/time";
import type {
  EditorDocument,
  EditorSequence,
  MediaClip,
  MulticamClip,
  SequenceClip,
} from "../apps/video-studio/src/editor/types";

const visual = () => ({
  transform: defaultTransform(),
  color: defaultColorAdjustment(),
  blendMode: "normal" as const,
});
function media(id = "clip", duration = 1000, trackId = "video", assetId = "source"): MediaClip {
  return {
    id,
    kind: "media",
    label: id,
    trackId,
    start: 0,
    duration,
    assetId,
    timeMap: constantTimeMap(0, duration).timeMap,
    audio: defaultAudioMix(),
    ...visual(),
  };
}
function sequence(id = "main"): EditorSequence {
  return {
    id,
    name: id,
    width: 1280,
    height: 720,
    frameRate: { numerator: 30000, denominator: 1001 },
    background: "#000000",
    timelineMode: "free",
    tracks: [createTrack("video", "video"), createTrack("sound", "audio")],
    clips: [],
    transitions: [],
    markers: [],
  };
}
function document(...sequences: EditorSequence[]): EditorDocument {
  return {
    schemaVersion: 2,
    timebase: 240000,
    id: "doc",
    name: "Audio",
    revision: 0,
    assets: [
      { id: "source", name: "Source", kind: "video", duration: 10000, width: 1280, height: 720 },
      { id: "other", name: "Other", kind: "video", duration: 10000, width: 1280, height: 720 },
    ],
    sequences,
    activeSequenceId: sequences[0]!.id,
    exportProfiles: [],
  };
}
function nested(id: string, child: string, duration = 500): SequenceClip {
  return {
    id,
    kind: "sequence",
    label: id,
    sequenceId: child,
    trackId: "video",
    start: 0,
    duration,
    timeMap: constantTimeMap(0, duration).timeMap,
    audio: defaultAudioMix(),
    ...visual(),
  };
}
function assertParity(doc: EditorDocument): void {
  const plan = compileAudioPlan(doc, "main"),
    evaluator = prepareEvaluator(doc);
  for (let sample = 0; sample <= plan.sampleCount; sample++) {
    const expected = evaluator.evaluate("main", sample * TICKS_PER_AUDIO_SAMPLE).audio;
    const actual = plan.lanes.map((lane) => sampleAudioLane(lane, sample)).filter(Boolean);
    assert.deepEqual(actual, expected, `sample ${sample}`);
    for (const lane of plan.lanes) {
      const active = sampleAudioLane(lane, sample);
      const span = lane.spans.find(
        (range) => range.startSample <= sample && sample < range.endSample,
      );
      assert.equal(Boolean(span), Boolean(active), `span coverage at sample ${sample}`);
      if (span) assert.equal(span.playbackRate, active!.playbackRate);
    }
  }
}

test("audio plans use the 48k clock and ceil only the output boundary, independently of video fps", () => {
  const seq = sequence();
  seq.clips = [media("a", 1003)];
  const plan = compileAudioPlan(document(seq), "main");
  assert.equal(plan.sampleRate, 48000);
  assert.equal(plan.channels, 2);
  assert.equal(plan.sampleCount, 201);
  assert.equal(plan.duration, 1003);
  assert.equal(sampleAudioLane(plan.lanes[0]!, 200)!.sourceTime, 1000);
  assert.equal(sampleAudioLane(plan.lanes[0]!, 201), null);
  assertParity(document(seq));
});

test("same asset has independent instances, picture visibility never mutes audio, and real mute remains silent", () => {
  const seq = sequence(),
    first = media("a"),
    second = media("b", 1000, "sound");
  second.timeMap = constantTimeMap(2000, 3000).timeMap;
  seq.tracks[0]!.hidden = true;
  seq.tracks[0]!.locked = true;
  seq.tracks[1]!.muted = true;
  seq.clips = [first, second];
  assertParity(document(seq));
  const plan = compileAudioPlan(document(seq), "main");
  assert.equal(new Set(plan.lanes.map((lane) => lane.instanceId)).size, 2);
  assert.deepEqual(
    plan.lanes.map((lane) => sampleAudioLane(lane, 100)?.sourceTime),
    [500, 2500],
  );
  assert.deepEqual(
    plan.lanes.map((lane) => sampleAudioLane(lane, 100)?.gain),
    [1, 0],
  );
});

test("reverse at the source end excludes the first sample; hold and piecewise rates stay exact", () => {
  const seq = sequence(),
    clip = media();
  clip.timeMap = {
    points: [
      { time: 0, source: 10000 },
      { time: 253, source: 8000 },
      { time: 637, source: 8000 },
      { time: 1000, source: 8500 },
    ],
  };
  seq.clips = [clip];
  assertParity(document(seq));
  const lane = compileAudioPlan(document(seq), "main").lanes[0]!;
  assert.equal(sampleAudioLane(lane, 0), null);
  assert.equal(lane.spans[0]!.startSample, 1);
  assert.equal(sampleAudioLane(lane, 100)!.gain, 0);
  assert.deepEqual(
    lane.spans.map((span) => Math.sign(span.playbackRate)),
    [-1, 0, 1],
  );
});

test("nested reverse/ramp maps partition all child boundaries and retain scoped sidechain buses", () => {
  const root = sequence(),
    child = sequence("child"),
    leaf = media("voice", 997);
  leaf.start = 31;
  leaf.timeMap = {
    points: [
      { time: 0, source: 700 },
      { time: 419, source: 3500 },
      { time: 997, source: 1900 },
    ],
  };
  leaf.audio.ducking = {
    sidechainTrackIds: ["sound"],
    thresholdDb: -30,
    attenuationDb: 12,
    attack: 100,
    release: 200,
  };
  child.clips = [leaf];
  const parent = nested("nest", "child", 703);
  parent.timeMap = {
    points: [
      { time: 0, source: 1011 },
      { time: 351, source: 271 },
      { time: 703, source: 827 },
    ],
  };
  parent.audio.ducking = {
    sidechainTrackIds: ["sound"],
    thresholdDb: -24,
    attenuationDb: 8,
    attack: 50,
    release: 100,
  };
  root.clips = [parent];
  assertParity(document(root, child));
  const plan = compileAudioPlan(document(root, child), "main"),
    lane = plan.lanes[0]!;
  assert.equal(lane.duckingIds.length, 2);
  assert.deepEqual(
    plan.ducking.map((request) => request.sidechainTrackInstanceIds),
    [["sequence:main/track:sound"], ["sequence:main/clip:nest/sequence:child/track:sound"]],
  );
  assert.ok(lane.spans.length > 3);
});

test("nested animated gain, pan clamp, fades, pitch and preservePitch agree at every audio sample", () => {
  const root = sequence(),
    child = sequence("child"),
    leaf = media("voice");
  leaf.audio.volume = {
    keyframes: [
      { time: 0, value: 0.1, easing: { type: "cubic-bezier", x1: 0.1, y1: 4, x2: 0.9, y2: -2 } },
      { time: 1000, value: 1 },
    ],
  };
  leaf.audio.pan = {
    keyframes: [
      { time: 0, value: -1, easing: "ease-in-out" },
      { time: 1000, value: 1 },
    ],
  };
  leaf.audio.pitchSemitones = 5;
  leaf.audio.preservePitch = false;
  leaf.audio.fadeOut = 900;
  child.tracks[0]!.volume = 0.7;
  child.tracks[0]!.pan = 0.3;
  child.clips = [leaf];
  const parent = nested("nest", "child");
  parent.timeMap = constantTimeMap(0, 1000, 2).timeMap;
  parent.audio.volume = 0.7;
  parent.audio.pan = 0.9;
  parent.audio.pitchSemitones = -3;
  parent.audio.fadeIn = 500;
  root.clips = [parent];
  assertParity(document(root, child));
});

test("nested freeze has a stable source with explicitly silent audio", () => {
  const root = sequence(),
    child = sequence("child");
  child.clips = [media()];
  const parent = nested("nest", "child");
  parent.timeMap = freezeTimeMap(375, 500);
  root.clips = [parent];
  assertParity(document(root, child));
  const state = sampleAudioLane(compileAudioPlan(document(root, child), "main").lanes[0]!, 50)!;
  assert.equal(state.sourceTime, 375);
  assert.equal(state.playbackRate, 0);
  assert.equal(state.gain, 0);
});

test("multicam audio is the continuous selected master, independent of picture switch and with signed offset", () => {
  const root = sequence();
  const clip: MulticamClip = {
    id: "multi",
    kind: "multicam",
    label: "Multi",
    trackId: "video",
    start: 0,
    duration: 1000,
    timeMap: constantTimeMap(1000, 2000).timeMap,
    audio: defaultAudioMix(),
    ...visual(),
    angles: [
      { id: "a", name: "A", assetId: "source", offset: 100 },
      { id: "b", name: "B", assetId: "other", offset: -317 },
    ],
    switches: [
      { time: 0, angleId: "a" },
      { time: 411, angleId: "b" },
    ],
    audioAngleId: "b",
  };
  root.clips = [clip];
  assertParity(document(root));
  const lane = compileAudioPlan(document(root), "main").lanes[0]!;
  assert.equal(lane.assetId, "other");
  assert.equal(lane.angleId, "b");
  assert.equal(lane.spans.length, 1);
  assert.equal(sampleAudioLane(lane, 0)?.sourceTime, 683);
});

test("a prepared plan owns frozen data, rejects invalid graphs, and fails instead of dropping excess lanes", () => {
  const root = sequence();
  root.clips = [media()];
  const doc = document(root),
    plan = compileAudioPlan(doc, "main");
  (root.clips[0] as MediaClip).audio.volume = 0;
  assert.equal(sampleAudioLane(plan.lanes[0]!, 0)?.gain, 1);
  assert.ok(Object.isFrozen(plan.lanes[0]!.stages[0]!.audio));
  assert.throws(() => compileAudioPlan(doc, "absent"));
  assert.throws(() => compileAudioPlan({ ...doc, futureAudio: {} }, "main"));
  root.clips.push(media("second", 1000, "sound"));
  assert.throws(() => compileAudioPlan(doc, "main", { maxLanes: 1 }), /capacity/);
  assert.throws(() => sampleAudioLane(plan.lanes[0]!, -1));
});
