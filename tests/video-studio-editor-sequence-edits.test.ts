import assert from "node:assert/strict";
import test from "node:test";
import {
  planCreateSequence,
  planDuplicateSequence,
  planRenameSequence,
  planRemoveSequence,
  planNestSequence,
  planCreateCompound,
  planUnpackCompound,
  type SequenceEditPlan,
} from "../apps/video-studio/src/editor/sequence-edits";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTextStyle,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import { applyEditorOperations } from "../apps/video-studio/src/editor/operations";
import { EditorHistory } from "../apps/video-studio/src/editor/history";
import { validateEditorDocument } from "../apps/video-studio/src/editor/validation";
import type {
  EditorDocument,
  EditorSequence,
  MediaClip,
  TextClip,
  SequenceClip,
} from "../apps/video-studio/src/editor/types";
const T = 240000;
const visual = () => ({
  transform: defaultTransform(),
  color: defaultColorAdjustment(),
  blendMode: "normal" as const,
});
const media = (id: string, start = T + 5, trackId = "v"): MediaClip => ({
  id,
  kind: "media",
  label: id,
  trackId,
  start,
  duration: 2 * T,
  assetId: "asset",
  ...visual(),
  audio: defaultAudioMix(),
  timeMap: {
    points: [
      { time: 0, source: 0 },
      { time: T, source: 2 * T },
      { time: 2 * T, source: 3 * T },
    ],
  },
});
function fixture(): EditorDocument {
  const a = media("a"),
    b = media("b", 2 * T + 5),
    sound = media("sound", T + 5, "a");
  a.linkGroupId = sound.linkGroupId = "link";
  a.transform.x = {
    keyframes: [
      { time: 0, value: 0, easing: "linear" },
      { time: T, value: 0.1, easing: { type: "cubic-bezier", x1: 0.1, y1: 0.2, x2: 0.7, y2: 0.9 } },
      { time: 2 * T, value: 0, easing: "ease-out" },
    ],
  };
  sound.audio.volume = {
    keyframes: [
      { time: 0, value: 0.3, easing: "linear" },
      { time: 2 * T, value: 0.7, easing: "linear" },
    ],
  };
  const caption: TextClip = {
    id: "caption",
    kind: "text",
    role: "subtitle",
    label: "字幕",
    trackId: "t",
    start: T + 5,
    duration: 2 * T,
    text: "你好\n世界",
    style: defaultTextStyle(),
    words: [
      { text: "你好", start: 0, end: T },
      { text: "世界", start: T, end: 2 * T },
    ],
    sourceBinding: {
      clipId: "a",
      sourceStart: 0,
      sourceEnd: 3 * T,
      provenance: { path: [], assetId: "asset", start: 0, end: 3 * T },
    },
    ...visual(),
  };
  return validateEditorDocument({
    schemaVersion: 2,
    timebase: T,
    id: "doc",
    name: "多序列",
    revision: 7,
    activeSequenceId: "main",
    assets: [
      { id: "asset", kind: "video", name: "素材", duration: 10 * T, width: 160, height: 90 },
    ],
    exportProfiles: [],
    sequences: [
      {
        id: "main",
        name: "主序列",
        width: 160,
        height: 90,
        frameRate: { numerator: 30000, denominator: 1001 },
        background: "#101820",
        timelineMode: "free",
        tracks: [
          createTrack("v", "video"),
          { ...createTrack("a", "audio"), volume: 0.7, pan: 0.2 },
          createTrack("t", "text"),
        ],
        clips: [a, b, sound, caption],
        transitions: [
          {
            id: "transition",
            fromClipId: "a",
            toClipId: "b",
            start: 2 * T + 5,
            duration: T,
            kind: "dissolve",
          },
        ],
        markers: [
          { id: "m", time: T + 7, duration: 0, name: "标记", note: "保留", color: "#ff3300" },
        ],
      },
    ],
  });
}
const apply = (doc: EditorDocument, plan: SequenceEditPlan) =>
  applyEditorOperations(doc, plan.operations, doc.revision);
function ids() {
  let n = 0;
  return (kind: string) => `${kind}-${++n}`;
}
function external(doc: EditorDocument): EditorDocument {
  const inner = doc.sequences[0]!,
    nest: SequenceClip = {
      id: "outer-instance",
      kind: "sequence",
      sequenceId: inner.id,
      label: "主序列实例",
      trackId: "ov",
      start: 0,
      duration: 4 * T + 5,
      timeMap: {
        points: [
          { time: 0, source: 0 },
          { time: 4 * T + 5, source: 4 * T + 5 },
        ],
      },
      audio: defaultAudioMix(),
      ...visual(),
    };
  const caption = structuredClone(inner.clips.find((c) => c.id === "caption") as TextClip);
  caption.id = "outer-caption";
  caption.trackId = "ot";
  caption.sourceBinding = {
    clipId: nest.id,
    sourceStart: T + 5,
    sourceEnd: 3 * T + 5,
    provenance: { path: ["a"], assetId: "asset", start: 0, end: 3 * T },
  };
  doc.sequences.push({
    ...structuredClone(inner),
    id: "outer",
    name: "外层",
    tracks: [createTrack("ov", "video"), createTrack("ot", "text")],
    clips: [nest, caption],
    transitions: [],
    markers: [],
  });
  return validateEditorDocument(doc);
}

test("create, rational-fps rename, nesting, active removal and all edits use one atomic revision", () => {
  const before = fixture();
  let doc = apply(
    before,
    planCreateSequence(before, {
      name: "竖版",
      width: 90,
      height: 160,
      frameRate: { numerator: 24000, denominator: 1001 },
      idFactory: ids(),
    }),
  );
  const newId = doc.activeSequenceId;
  assert.equal(doc.revision, 8);
  assert.deepEqual(doc.sequences[1]!.frameRate, { numerator: 24000, denominator: 1001 });
  doc = apply(doc, planRenameSequence(doc, newId, "独立竖版"));
  doc = apply(doc, planNestSequence(doc, newId, "main", { at: 12345 }));
  const nested = doc.sequences[1]!.clips[0] as SequenceClip;
  assert.equal(nested.start, 12345);
  assert.equal(nested.duration, 4 * T + 5);
  assert.throws(() => planRemoveSequence(doc, "main"), /引用/);
  doc = apply(doc, planRemoveSequence(doc, newId, "main"));
  assert.equal(doc.activeSequenceId, "main");
  assert.equal(doc.sequences.length, 1);
  assert.equal(before.revision, 7);
  assert.throws(() => planRemoveSequence(doc, "main"), /至少/);
});

test("deep duplicate remaps a shared nested DAG and provenance, preserving source maps, locks and data", () => {
  const doc = external(fixture()),
    outer = doc.sequences[1]!;
  outer.clips.push({ ...structuredClone(outer.clips[0]!), id: "outer-second", trackId: "ov2" });
  outer.tracks.push(createTrack("ov2", "video"));
  doc.sequences[0]!.tracks[0]!.locked = true;
  const snapshot = structuredClone(doc),
    plan = planDuplicateSequence(doc, "outer", { idFactory: ids() }),
    after = apply(doc, plan);
  assert.equal(after.sequences.length, 4);
  assert.deepEqual(doc, snapshot);
  const duplicate = after.sequences.find((s) => s.id === plan.sequenceId)!,
    nested = duplicate.clips.filter((c) => c.kind === "sequence") as SequenceClip[];
  assert.equal(nested[0]!.sequenceId, nested[1]!.sequenceId);
  assert.notEqual(nested[0]!.sequenceId, "main");
  const child = after.sequences.find((s) => s.id === nested[0]!.sequenceId)!;
  assert.deepEqual(child.frameRate, doc.sequences[0]!.frameRate);
  assert.equal(child.tracks[0]!.locked, true);
  const a = child.clips.find((c) => c.label === "a") as MediaClip,
    caption = duplicate.clips.find((c) => c.kind === "text") as TextClip;
  assert.deepEqual(a.timeMap, (doc.sequences[0]!.clips[0] as MediaClip).timeMap);
  assert.deepEqual(a.transform, doc.sequences[0]!.clips[0]!.transform);
  assert.deepEqual(caption.sourceBinding!.provenance!.path, [a.id]);
  assert.equal(caption.sourceBinding!.clipId, nested[0]!.id);
  assert.equal(child.transitions[0]!.fromClipId, a.id);
  assert.notEqual(child.markers[0]!.id, "m");
  assert.equal(after.assets.length, 1);
});

test("compound expands transitions, linked sound and bound captions, preserves all exact local timing, one undo", () => {
  const doc = fixture(),
    before = structuredClone(doc),
    history = new EditorHistory(doc),
    plan = planCreateCompound(doc, "main", ["a"], { name: "开场复合", idFactory: ids() });
  assert.deepEqual(new Set(plan.includedClipIds), new Set(["a", "b", "sound", "caption"]));
  history.apply(plan.operations, history.revision, "创建复合片段");
  const after = history.read(),
    parent = after.sequences[0]!,
    child = after.sequences.find((s) => s.id === plan.createdSequenceId)!;
  assert.equal(after.revision, 8);
  assert.equal(parent.clips.length, 1);
  assert.equal(parent.clips[0]!.start, T + 5);
  assert.equal(parent.clips[0]!.duration, 3 * T);
  assert.equal(child.background, "#00000000");
  assert.deepEqual(child.frameRate, doc.sequences[0]!.frameRate);
  assert.equal(child.clips[0]!.start, 0);
  assert.equal(child.transitions[0]!.start, T);
  assert.deepEqual(child.clips[0]!.transform, doc.sequences[0]!.clips[0]!.transform);
  assert.deepEqual(
    (child.clips[3] as TextClip).words,
    (doc.sequences[0]!.clips[3] as TextClip).words,
  );
  assert.deepEqual(parent.markers, doc.sequences[0]!.markers);
  assert.equal(child.markers.length, 0);
  assert.equal(child.tracks[1]!.volume, 0.7);
  history.undo();
  assert.deepEqual(history.read().sequences, before.sequences);
  history.redo();
  assert.equal(history.read().sequences.length, 2);
  assert.deepEqual(doc, before);
});

test("unpack copies original content and bindings back to exact positions, leaving reusable child intact", () => {
  const doc = fixture(),
    plan = planCreateCompound(doc, "main", ["a"], { name: "复合" }),
    combined = apply(doc, plan),
    unpack = planUnpackCompound(combined, "main", plan.clipIds[0]!);
  const after = apply(combined, unpack),
    clips = after.sequences[0]!.clips,
    child = combined.sequences[1]!;
  assert.equal(clips.length, 4);
  assert.deepEqual(after.sequences[1], child);
  const a = clips.find((c) => c.label === "a") as MediaClip,
    caption = clips.find((c) => c.kind === "text") as TextClip;
  assert.equal(a.start, T + 5);
  assert.deepEqual(a.timeMap, (doc.sequences[0]!.clips[0] as MediaClip).timeMap);
  assert.deepEqual(a.transform, doc.sequences[0]!.clips[0]!.transform);
  assert.equal(caption.sourceBinding!.clipId, a.id);
  assert.equal(caption.text, "你好\n世界");
  assert.equal(after.sequences[0]!.transitions[0]!.start, 2 * T + 5);
  assert.deepEqual(after.sequences[0]!.markers, doc.sequences[0]!.markers);
});

test("compound and unpack rewrite deeper external provenance without changing words or source range", () => {
  const doc = external(fixture()),
    original = doc.sequences[1]!.clips[1] as TextClip,
    plan = planCreateCompound(doc, "main", ["a"], { name: "复合" }),
    combined = apply(doc, plan);
  const bound = combined.sequences[1]!.clips[1] as TextClip;
  assert.deepEqual(bound.sourceBinding!.provenance!.path, [plan.clipIds[0], "a"]);
  assert.deepEqual(bound.words, original.words);
  assert.equal(bound.start, original.start);
  assert.equal(bound.duration, original.duration);
  const after = apply(combined, planUnpackCompound(combined, "main", plan.clipIds[0]!));
  const unpacked = after.sequences[1]!.clips[1] as TextClip,
    a = after.sequences[0]!.clips.find((c) => c.label === "a")!;
  assert.deepEqual(unpacked.sourceBinding!.provenance!.path, [a.id]);
  assert.deepEqual(unpacked.words, original.words);
  assert.equal(unpacked.sourceBinding!.provenance!.assetId, "asset");
});

test("direct wrapper provenance is rebound before wrapper removal, so owned outside subtitles survive", () => {
  const doc = fixture(),
    plan = planCreateCompound(doc, "main", ["a"], { name: "复合" }),
    combined = apply(doc, plan),
    parent = combined.sequences[0]!;
  const caption = structuredClone(
    combined.sequences[1]!.clips.find((c) => c.kind === "text") as TextClip,
  );
  caption.id = "outside-caption";
  caption.trackId = "t";
  caption.start += T + 5;
  caption.sourceBinding = {
    clipId: plan.clipIds[0]!,
    sourceStart: 0,
    sourceEnd: 2 * T,
    provenance: { path: ["a"], assetId: "asset", start: 0, end: 3 * T },
  };
  parent.clips.push(caption);
  const after = apply(combined, planUnpackCompound(combined, "main", plan.clipIds[0]!)),
    result = after.sequences[0]!.clips.find((c) => c.id === caption.id) as TextClip;
  assert.ok(result);
  assert.deepEqual(result.words, caption.words);
  assert.deepEqual(result.sourceBinding!.provenance!.path, []);
  assert.notEqual(result.sourceBinding!.clipId, plan.clipIds[0]);
});

test("locks on expanded sources, outside captions, unpacked content and destinations cannot be bypassed", () => {
  const doc = fixture();
  doc.sequences[0]!.tracks[1]!.locked = true;
  assert.throws(() => planCreateCompound(doc, "main", ["a"], { name: "复合" }), /锁定/);
  const ext = external(fixture());
  ext.sequences[1]!.tracks[1]!.locked = true;
  assert.throws(() => planCreateCompound(ext, "main", ["a"], { name: "复合" }), /锁定/);
  const clean = fixture(),
    plan = planCreateCompound(clean, "main", ["a"], { name: "复合" }),
    combined = apply(clean, plan);
  combined.sequences[1]!.tracks[0]!.locked = true;
  assert.throws(() => planUnpackCompound(combined, "main", plan.clipIds[0]!), /锁定/);
  assert.throws(() => planNestSequence(doc, "main", "main", { at: 0 }), /循环|环/);
});

test("overlapping stack gaps, blend dependencies and ducking crossings are explicit atomic restrictions", () => {
  const doc = fixture(),
    snapshot = structuredClone(doc);
  doc.sequences[0]!.tracks.splice(2, 0, createTrack("middle", "video"));
  doc.sequences[0]!.clips.push(media("middle", T + 5, "middle"));
  assert.throws(() => planCreateCompound(doc, "main", ["a"], { name: "复合" }), /叠放顺序/);
  const blend = structuredClone(snapshot);
  blend.sequences[0]!.clips[0]!.blendMode = "multiply";
  assert.throws(() => planCreateCompound(blend, "main", ["a"], { name: "复合" }), /混合模式/);
  const duck = structuredClone(snapshot);
  duck.sequences[0]!.tracks.push(createTrack("music", "audio"));
  const music = media("music", 0, "music");
  music.audio.ducking = {
    sidechainTrackIds: ["a"],
    thresholdDb: -25,
    attenuationDb: 10,
    attack: 1000,
    release: 1000,
  };
  duck.sequences[0]!.clips.push(music);
  assert.throws(() => planCreateCompound(duck, "main", ["a"], { name: "复合" }), /压低音量/);
});

test("unpack rejects retiming, trimming, effects and canvas changes rather than flattening inaccurately", () => {
  const doc = fixture(),
    plan = planCreateCompound(doc, "main", ["a"], { name: "复合" }),
    combined = apply(doc, plan);
  for (const change of [
    (c: SequenceClip) => {
      c.transform.x = 0.1;
    },
    (c: SequenceClip) => {
      c.timeMap.points[0]!.source = T;
    },
    (c: SequenceClip) => {
      c.audio.volume = 0.5;
    },
  ]) {
    const next = structuredClone(combined);
    change(next.sequences[0]!.clips[0] as SequenceClip);
    assert.throws(() => planUnpackCompound(next, "main", plan.clipIds[0]!), /效果|裁剪|变速/);
  }
  const sized = structuredClone(combined);
  sized.sequences[1]!.width = 180;
  assert.throws(() => planUnpackCompound(sized, "main", plan.clipIds[0]!), /画布/);
});

test("plans reject stale transactions, invalid new identifiers and reference cycles without mutation", () => {
  const doc = external(fixture()),
    snapshot = structuredClone(doc),
    plan = planDuplicateSequence(doc, "main");
  assert.throws(() => applyEditorOperations(doc, plan.operations, doc.revision - 1), /版本|修订/);
  assert.throws(() => planDuplicateSequence(doc, "main", { idFactory: () => "asset" }), /重复/);
  assert.throws(() => planNestSequence(doc, "main", "outer", { at: 0 }), /环/);
  assert.deepEqual(doc, snapshot);
});
