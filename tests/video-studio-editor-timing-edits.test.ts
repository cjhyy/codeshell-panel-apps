import assert from "node:assert/strict";
import test from "node:test";
import {
  planClipTiming,
  planTimelineArrangement,
  planTransition,
  planMagneticMove,
  planMagneticRemove,
} from "../apps/video-studio/src/editor/timing-edits";
import { setClipTimeMap } from "../apps/video-studio/src/editor/clip-edits";
import { applyEditorOperations } from "../apps/video-studio/src/editor/operations";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTextStyle,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import { EditorHistory } from "../apps/video-studio/src/editor/history";
import type { EditorDocument, MediaClip, TextClip } from "../apps/video-studio/src/editor/types";
import { validateEditorDocument } from "../apps/video-studio/src/editor/validation";
const T = 240000;
function fixture(): EditorDocument {
  const media = (id: string, start: number, trackId = "video"): MediaClip => ({
    id,
    kind: "media",
    label: id,
    trackId,
    start: start * T,
    duration: 4 * T,
    assetId: "asset",
    timeMap: {
      points: [
        { time: 0, source: 0 },
        { time: 4 * T, source: 4 * T },
      ],
    },
    audio: defaultAudioMix(),
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
  });
  const a = media("a", 0),
    b = media("b", 4),
    c = media("c", 8),
    sound = media("sound", 4, "audio");
  b.linkGroupId = "linked";
  sound.linkGroupId = "linked";
  a.transform.x = {
    keyframes: [
      { time: 0, value: 0, easing: "linear" },
      { time: 2 * T, value: 0.5, easing: "ease-in" },
      { time: 4 * T, value: 1, easing: "linear" },
    ],
  };
  const caption = (id: string, clipId: string, start: number): TextClip => ({
    id,
    kind: "text",
    label: id,
    trackId: "text",
    start: start * T,
    duration: 4 * T,
    text: "你好世界",
    role: "subtitle",
    style: defaultTextStyle(),
    words: [
      { text: "你好", start: 0, end: 2 * T },
      { text: "世界", start: 2 * T, end: 4 * T },
    ],
    sourceBinding: { clipId, sourceStart: 0, sourceEnd: 4 * T },
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
  });
  return validateEditorDocument({
    schemaVersion: 2,
    timebase: T,
    id: "project",
    name: "时序测试",
    revision: 7,
    activeSequenceId: "main",
    assets: [
      { id: "asset", kind: "video", name: "原片", duration: 20 * T, width: 1920, height: 1080 },
    ],
    exportProfiles: [],
    sequences: [
      {
        id: "main",
        name: "主序列",
        width: 1920,
        height: 1080,
        frameRate: { numerator: 30, denominator: 1 },
        timelineMode: "free",
        background: "#000000",
        tracks: [
          createTrack("video", "video"),
          createTrack("audio", "audio"),
          createTrack("text", "text"),
        ],
        clips: [a, b, c, sound, caption("ca", "a", 0), caption("cb", "b", 4)],
        transitions: [],
        markers: [],
      },
    ],
  });
}
const read = (document: EditorDocument, id: string) =>
  document.sequences[0]!.clips.find((clip) => clip.id === id)!;
const apply = (document: EditorDocument, operations: ReturnType<typeof planClipTiming>) =>
  applyEditorOperations(document, operations, document.revision);

test("constant speed ripples linked audio and bound captions once, rescales animation and forms one undo entry", () => {
  const before = fixture(),
    snapshot = structuredClone(before),
    history = new EditorHistory(before);
  const ops = planClipTiming(
    before,
    "main",
    ["a"],
    { kind: "speed", rate: 2, preservePitch: false },
    { ripple: true },
  );
  const after = history.apply(ops, history.revision, "变速");
  const result = history.read();
  assert.equal(result.revision, 8);
  assert.equal(read(result, "a").duration, 2 * T);
  assert.equal(read(result, "b").start, 2 * T);
  assert.equal(read(result, "sound").start, 2 * T);
  assert.equal(read(result, "cb").start, 2 * T);
  assert.equal(read(result, "c").start, 6 * T);
  assert.equal((read(result, "a") as MediaClip).audio.preservePitch, false);
  assert.equal((read(result, "ca") as TextClip).words[0]!.end, T);
  assert.equal((read(result, "a").transform.x as any).keyframes[1].time, T);
  history.undo();
  assert.equal(read(history.read(), "b").start, 4 * T);
  assert.equal(read(history.read(), "a").duration, 4 * T);
  assert.deepEqual(before, snapshot);
  void after;
});

test("slowing with ripple supports final geometry while a free overlap fails atomically", () => {
  const before = fixture();
  assert.throws(() => planClipTiming(before, "main", ["a"], { kind: "speed", rate: 0.5 }), /重叠/);
  const after = apply(
    before,
    planClipTiming(before, "main", ["a"], { kind: "speed", rate: 0.5 }, { ripple: true }),
  );
  assert.equal(read(after, "a").duration, 8 * T);
  assert.equal(read(after, "b").start, 8 * T);
  assert.equal(read(after, "cb").start, 8 * T);
  assert.equal(read(after, "c").start, 12 * T);
  assert.equal(before.revision, 7);
});

test("explicit source/output points retime words nonlinearly and preserve eased decorations", () => {
  const before = fixture(),
    timeMap = {
      points: [
        { time: 0, source: 0 },
        { time: T, source: 2 * T },
        { time: 6 * T, source: 4 * T },
      ],
    };
  const after = apply(
    before,
    planClipTiming(before, "main", ["a"], { kind: "map", timeMap }, { ripple: true }),
  );
  assert.deepEqual((read(after, "a") as MediaClip).timeMap, timeMap);
  assert.equal((read(after, "ca") as TextClip).words[0]!.end, T);
  assert.equal((read(after, "ca") as TextClip).words[1]!.end, 6 * T - 1);
  assert.equal((read(after, "a").transform.x as any).keyframes[1].easing, "ease-in");
  assert.equal(read(after, "b").start, 6 * T);
  const alone = fixture();
  alone.sequences[0]!.clips = alone.sequences[0]!.clips.filter((clip) =>
    ["a", "ca"].includes(clip.id),
  );
  assert.equal(
    apply(alone, setClipTimeMap(alone, "main", "a", timeMap)).sequences[0]!.clips[0]!.duration,
    6 * T,
  );
  assert.throws(
    () =>
      setClipTimeMap(alone, "main", "a", {
        points: [
          { time: 0, source: 0 },
          { time: T, source: 21 * T },
        ],
      }),
    /素材时长/,
  );
});

test("reverse and freeze require explicit caption detachment and keep caption content intact", () => {
  const before = fixture();
  assert.throws(() => planClipTiming(before, "main", ["a"], { kind: "reverse" }), /解除字幕绑定/);
  const reversed = apply(
    before,
    planClipTiming(before, "main", ["a"], { kind: "reverse" }, { detachCaptions: true }),
  );
  assert.deepEqual(
    (read(reversed, "a") as MediaClip).timeMap.points.map((point) => point.source),
    [4 * T, 0],
  );
  assert.equal((read(reversed, "ca") as TextClip).sourceBinding, undefined);
  assert.equal((read(reversed, "ca") as TextClip).text, "你好世界");
  assert.equal(read(reversed, "ca").duration, 4 * T);
  const frozen = apply(
    before,
    planClipTiming(
      before,
      "main",
      ["a"],
      { kind: "freeze", time: T, duration: 2 * T },
      { detachCaptions: true, ripple: true },
    ),
  );
  assert.deepEqual(
    (read(frozen, "a") as MediaClip).timeMap.points.map((point) => point.source),
    [T, T],
  );
  assert.equal(read(frozen, "b").start, 2 * T);
});

test("one point map changes synchronized picture and linked audio together and rejects mismatched source mappings", () => {
  const before = fixture(),
    timeMap = {
      points: [
        { time: 0, source: 0 },
        { time: T, source: 2 * T },
        { time: 3 * T, source: 4 * T },
      ],
    };
  const after = apply(
    before,
    planClipTiming(before, "main", ["b"], { kind: "map", timeMap }, { ripple: true }),
  );
  assert.deepEqual((read(after, "b") as MediaClip).timeMap, timeMap);
  assert.deepEqual((read(after, "sound") as MediaClip).timeMap, timeMap);
  assert.equal(read(after, "c").start, 7 * T);
  (read(before, "sound") as MediaClip).timeMap.points[0]!.source = T;
  assert.throws(
    () => planClipTiming(before, "main", ["b"], { kind: "map", timeMap }, { ripple: true }),
    /不同步片段/,
  );
});

test("group timing edits apply to both picture and linked audio and locked dependencies block all edits", () => {
  const before = fixture(),
    after = apply(
      before,
      planClipTiming(before, "main", ["b"], { kind: "speed", rate: 2 }, { ripple: true }),
    );
  assert.equal(read(after, "b").duration, 2 * T);
  assert.equal(read(after, "sound").duration, 2 * T);
  assert.equal(read(after, "cb").duration, 2 * T);
  assert.equal(read(after, "c").start, 6 * T);
  before.sequences[0]!.tracks[1]!.locked = true;
  assert.throws(
    () => planClipTiming(before, "main", ["a"], { kind: "speed", rate: 2 }, { ripple: true }),
    /锁定/,
  );
  assert.throws(() => planClipTiming(before, "main", ["b"], { kind: "speed", rate: 2 }), /锁定/);
});

test("keep-left and keep-right preserve source trim, words, binding and no duplicate caption shifts", () => {
  const before = fixture();
  const left = apply(
    before,
    planClipTiming(before, "main", ["a"], { kind: "keep-left", time: 2 * T }, { ripple: true }),
  );
  assert.equal(read(left, "a").duration, 2 * T);
  assert.equal((read(left, "ca") as TextClip).text, "你好");
  assert.equal(read(left, "b").start, 2 * T);
  const right = apply(
    before,
    planClipTiming(before, "main", ["a"], { kind: "keep-right", time: 2 * T }, { ripple: true }),
  );
  assert.equal(read(right, "a").start, 0);
  assert.equal(read(right, "ca").start, 0);
  assert.equal((read(right, "ca") as TextClip).text, "世界");
  assert.equal((read(right, "a") as MediaClip).timeMap.points[0]!.source, 2 * T);
  assert.equal(read(right, "b").start, 2 * T);
});

test("ripple removal at a playhead boundary closes the removed first clip", () => {
  const before = fixture(),
    after = apply(
      before,
      planClipTiming(before, "main", ["a"], { kind: "keep-left", time: 0 }, { ripple: true }),
    );
  assert.equal(read(after, "a"), undefined);
  assert.equal(read(after, "ca"), undefined);
  assert.equal(read(after, "b").start, 0);
  assert.equal(read(after, "cb").start, 0);
  assert.equal(read(after, "sound").start, 0);
  assert.equal(read(after, "c").start, 4 * T);
});

test("trimming a selected bound caption never implicitly trims or moves its owner", () => {
  const before = fixture(),
    after = apply(
      before,
      planClipTiming(before, "main", ["ca"], { kind: "keep-right", time: 2 * T }, { ripple: true }),
    );
  assert.deepEqual(read(after, "a"), read(before, "a"));
  assert.deepEqual(read(after, "b"), read(before, "b"));
  assert.equal(read(after, "ca").start, 2 * T);
  assert.equal((read(after, "ca") as TextClip).text, "世界");
});

test("transition creation, adjustment and hard-cut removal retain source maps and move linked captions once", () => {
  let document = fixture();
  const original = (read(document, "b") as MediaClip).timeMap;
  document = apply(
    document,
    planTransition(document, "main", "a", "b", { id: "ab", kind: "dissolve", duration: T }),
  );
  assert.equal(read(document, "b").start, 3 * T);
  assert.equal(read(document, "sound").start, 3 * T);
  assert.equal(read(document, "cb").start, 3 * T);
  assert.equal(read(document, "c").start, 7 * T);
  assert.equal(document.sequences[0]!.transitions[0]!.duration, T);
  document = apply(
    document,
    planTransition(document, "main", "a", "b", {
      id: "ignored",
      kind: "push-right",
      duration: T / 2,
    }),
  );
  assert.equal(document.sequences[0]!.transitions[0]!.id, "ab");
  assert.equal(read(document, "b").start, 3.5 * T);
  assert.equal(document.sequences[0]!.transitions[0]!.kind, "push-right");
  document = apply(
    document,
    planTransition(document, "main", "a", "b", {
      id: "ab",
      kind: "push-right",
      duration: T / 2,
      remove: true,
    }),
  );
  assert.equal(document.sequences[0]!.transitions.length, 0);
  assert.equal(read(document, "b").start, 4 * T);
  assert.equal(read(document, "c").start, 8 * T);
  assert.deepEqual((read(document, "b") as MediaClip).timeMap, original);
});

test("timing changes never silently discard existing transitions and explicit removal closes the overlap", () => {
  const before = fixture(),
    withTransition = apply(
      before,
      planTransition(before, "main", "a", "b", { id: "ab", kind: "fade-black", duration: T }),
    );
  assert.throws(
    () =>
      planClipTiming(withTransition, "main", ["a"], { kind: "speed", rate: 2 }, { ripple: true }),
    /明确选择/,
  );
  const after = apply(
    withTransition,
    planClipTiming(
      withTransition,
      "main",
      ["a"],
      { kind: "speed", rate: 2 },
      { ripple: true, removeTransitions: true },
    ),
  );
  assert.equal(after.sequences[0]!.transitions.length, 0);
  assert.equal(read(after, "b").start, 2 * T);
  assert.equal(read(after, "c").start, 6 * T);
});

test("transition ripple preserves another transition but conflicting linked endpoints fail without changes", () => {
  let document = fixture();
  document = apply(
    document,
    planTransition(document, "main", "b", "c", { id: "bc", kind: "wipe-left", duration: T }),
  );
  document = apply(
    document,
    planTransition(document, "main", "a", "b", { id: "ab", kind: "push-left", duration: T }),
  );
  assert.equal(document.sequences[0]!.transitions.length, 2);
  assert.equal(document.sequences[0]!.transitions.find((item) => item.id === "bc")!.start, 6 * T);
  const conflict = fixture();
  read(conflict, "a").groupId = "g";
  read(conflict, "b").groupId = "g";
  assert.throws(
    () => planTransition(conflict, "main", "a", "b", { id: "ab", kind: "dissolve", duration: T }),
    /不同位移/,
  );
  assert.throws(
    () => planTransition(fixture(), "main", "a", "c", { id: "ac", kind: "dissolve", duration: T }),
    /相邻/,
  );
  assert.throws(
    () =>
      planTransition(fixture(), "main", "a", "b", { id: "ab", kind: "dissolve", duration: 4 * T }),
    /短于/,
  );
});

test("magnetic compaction preserves transitions and all component offsets, modes can change without reordering", () => {
  let document = fixture();
  document = apply(
    document,
    planTransition(document, "main", "a", "b", { id: "ab", kind: "dissolve", duration: T }),
  );
  for (const clip of document.sequences[0]!.clips) clip.start += 2 * T;
  document.sequences[0]!.transitions[0]!.start += 2 * T;
  read(document, "c").start += T;
  const modeOnly = apply(document, planTimelineArrangement(document, "main", { mode: "magnetic" }));
  assert.equal(read(modeOnly, "a").start, 2 * T);
  const compact = apply(
    document,
    planTimelineArrangement(document, "main", {
      mode: "magnetic",
      trackId: "video",
      compact: true,
    }),
  );
  assert.equal(read(compact, "a").start, 0);
  assert.equal(read(compact, "b").start, 3 * T);
  assert.equal(read(compact, "cb").start, 3 * T);
  assert.equal(read(compact, "c").start, 7 * T);
  assert.equal(compact.sequences[0]!.transitions[0]!.start, 3 * T);
  assert.equal(compact.sequences[0]!.timelineMode, "magnetic");
});

test("compaction refuses contradictory group gaps, locked members and stale revision replay", () => {
  const before = fixture();
  read(before, "a").groupId = "g";
  read(before, "b").groupId = "g";
  read(before, "b").start += T;
  read(before, "c").start += T;
  assert.throws(
    () => planTimelineArrangement(before, "main", { mode: "magnetic", compact: true }),
    /不同位移/,
  );
  const locked = fixture();
  read(locked, "a").start += T;
  read(locked, "b").start += T;
  read(locked, "c").start += T;
  locked.sequences[0]!.tracks[2]!.locked = true;
  assert.throws(
    () => planTimelineArrangement(locked, "main", { mode: "magnetic", compact: true }),
    /锁定/,
  );
  const document = fixture(),
    ops = planClipTiming(document, "main", ["a"], { kind: "speed", rate: 2 }, { ripple: true });
  assert.throws(() => applyEditorOperations(document, ops, 6), /修订/);
});

test("magnetic picture moves insert whole blocks and keyboard movement swaps the neighboring block", () => {
  const before = fixture();
  const after = apply(before, planMagneticMove(before, "main", ["a"], { delta: 8 * T }));
  assert.equal(read(after, "b").start, 0);
  assert.equal(read(after, "sound").start, 0);
  assert.equal(read(after, "cb").start, 0);
  assert.equal(read(after, "a").start, 4 * T);
  assert.equal(read(after, "ca").start, 4 * T);
  assert.equal(read(after, "c").start, 8 * T);
  const keyboard = apply(
    before,
    planMagneticMove(before, "main", ["a"], { delta: 8000, direction: "next" }),
  );
  assert.deepEqual(keyboard, after);
  const back = apply(
    keyboard,
    planMagneticMove(keyboard, "main", ["a"], { delta: -8000, direction: "previous" }),
  );
  assert.equal(read(back, "a").start, 0);
  assert.equal(read(back, "b").start, 4 * T);
});

test("magnetic drag moves a connected transition block while delete removes only the chosen source and attached effect", () => {
  const initial = fixture(),
    before = apply(
      initial,
      planTransition(initial, "main", "a", "b", { id: "ab", kind: "dissolve", duration: T }),
    );
  const after = apply(before, planMagneticMove(before, "main", ["a"], { delta: 12 * T }));
  assert.equal(read(after, "c").start, 0);
  assert.equal(read(after, "a").start, 4 * T);
  assert.equal(read(after, "b").start, 7 * T);
  assert.equal(read(after, "sound").start, 7 * T);
  assert.equal(read(after, "ca").start, 4 * T);
  assert.equal(after.sequences[0]!.transitions[0]!.start, 7 * T);
  const removed = apply(before, planMagneticRemove(before, "main", ["a"]));
  assert.equal(read(removed, "a"), undefined);
  assert.equal(read(removed, "ca"), undefined);
  assert.equal(read(removed, "b").start, 0);
  assert.equal(read(removed, "sound").start, 0);
  assert.equal(read(removed, "c").start, 4 * T);
  assert.equal(removed.sequences[0]!.transitions.length, 0);
});

test("magnetic deletion closes all removed linked source slots and preserves unrelated caption owners", () => {
  const before = fixture(),
    after = apply(before, planMagneticRemove(before, "main", ["b"]));
  for (const id of ["b", "sound", "cb"]) assert.equal(read(after, id), undefined);
  assert.equal(read(after, "c").start, 4 * T);
  assert.equal(read(after, "a").start, 0);
  const captionOnly = apply(before, planMagneticRemove(before, "main", ["ca"]));
  assert.deepEqual(read(captionOnly, "a"), read(before, "a"));
  assert.deepEqual(read(captionOnly, "b"), read(before, "b"));
  assert.equal(read(captionOnly, "ca"), undefined);
});

test("cross-track magnetic insertion preserves relative companion tracks and source-bound captions", () => {
  const before = fixture();
  before.sequences[0]!.tracks.splice(1, 0, createTrack("v2", "video"), createTrack("v3", "video"));
  const overlay = structuredClone(read(before, "a")) as MediaClip;
  overlay.id = "overlay";
  overlay.trackId = "v2";
  overlay.start = T;
  overlay.groupId = "g";
  read(before, "a").groupId = "g";
  before.sequences[0]!.clips.push(overlay);
  const after = apply(before, planMagneticMove(before, "main", ["a"], { delta: 0, trackId: "v2" }));
  assert.equal(read(after, "a").trackId, "v2");
  assert.equal(read(after, "overlay").trackId, "v3");
  assert.equal(read(after, "overlay").start, T);
  assert.equal(read(after, "ca").trackId, "text");
  assert.equal(read(after, "b").start, 0);
  assert.equal(read(after, "sound").start, 0);
  assert.equal(read(after, "c").start, 4 * T);
});

test("magnetic operations reject locked affected dependencies and leave audio-only frame nudges independent", () => {
  const before = fixture();
  before.sequences[0]!.tracks[1]!.locked = true;
  assert.throws(() => planMagneticMove(before, "main", ["a"], { delta: 8 * T }), /锁定/);
  assert.throws(() => planMagneticRemove(before, "main", ["a"]), /锁定/);
  const audio = fixture();
  delete read(audio, "b").linkGroupId;
  delete read(audio, "sound").linkGroupId;
  const moved = apply(
    audio,
    planMagneticMove(audio, "main", ["sound"], { delta: 8000, direction: "next" }),
  );
  assert.equal(read(moved, "sound").start, 4 * T + 8000);
  assert.deepEqual(read(moved, "b"), read(audio, "b"));
});
