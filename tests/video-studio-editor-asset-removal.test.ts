import assert from "node:assert/strict";
import test from "node:test";
import { planEditorAssetRemoval } from "../apps/video-studio/src/editor/asset-removal";
import { applyEditorOperations } from "../apps/video-studio/src/editor/operations";
import { EditorHistory } from "../apps/video-studio/src/editor/history";
import { reconcileEditorProduction } from "../apps/video-studio/src/editor/production-guard";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTextStyle,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import { validateEditorDocument } from "../apps/video-studio/src/editor/validation";
import type {
  EditorDocument,
  EditorSequence,
  MediaClip,
  SequenceClip,
  TextClip,
  MulticamClip,
} from "../apps/video-studio/src/editor/types";
const T = 240000;
const visual = () => ({
  transform: defaultTransform(),
  color: defaultColorAdjustment(),
  blendMode: "normal" as const,
});
function media(id: string, assetId = "a", start = 0, duration = 4, trackId = "v"): MediaClip {
  return {
    id,
    kind: "media",
    label: id,
    trackId,
    start: start * T,
    duration: duration * T,
    assetId,
    ...visual(),
    audio: defaultAudioMix(),
    timeMap: {
      points: [
        { time: 0, source: 0 },
        { time: duration * T, source: duration * T },
      ],
    },
  };
}
function sequence(id: string, clips: EditorSequence["clips"]): EditorSequence {
  return {
    id,
    name: id,
    width: 640,
    height: 360,
    frameRate: { numerator: 30000, denominator: 1001 },
    background: "#000000",
    timelineMode: "magnetic",
    tracks: [
      createTrack("v", "video"),
      createTrack("overlay", "video"),
      createTrack("image", "video"),
      createTrack("audio", "audio"),
      createTrack("text", "text"),
    ],
    clips,
    transitions: [],
    markers: [],
  };
}
function caption(id: string, owner: string, start = 0, duration = 4, assetId = "a"): TextClip {
  return {
    id,
    kind: "text",
    role: "subtitle",
    label: id,
    trackId: "text",
    text: "来源字幕",
    start: start * T,
    duration: duration * T,
    words: [],
    style: defaultTextStyle(),
    ...visual(),
    sourceBinding: {
      clipId: owner,
      sourceStart: 0,
      sourceEnd: duration * T,
      provenance: { path: [], assetId, start: 0, end: duration * T },
    },
  };
}
function wrapper(
  id: string,
  sequenceId: string,
  start = 0,
  duration = 4,
  trackId = "v",
): SequenceClip {
  return {
    ...media(id, "a", start, duration, trackId),
    kind: "sequence",
    sequenceId,
  } as unknown as SequenceClip;
}
function nested(
  id: string,
  sequenceId: string,
  start = 0,
  duration = 4,
  trackId = "v",
): SequenceClip {
  const clip: any = wrapper(id, sequenceId, start, duration, trackId);
  delete clip.assetId;
  return clip;
}
function fixture(): EditorDocument {
  const a = media("a-main"),
    b = media("b-main", "b", 3),
    overlay = media("a-reverse", "a", 5, 3, "overlay"),
    freeze = media("image-hold", "image", 1, 6, "image");
  overlay.timeMap.points = [
    { time: 0, source: 8 * T },
    { time: 3 * T, source: 5 * T },
  ];
  freeze.timeMap.points = [
    { time: 0, source: 2 * T },
    { time: 6 * T, source: 2 * T },
  ];
  b.transform.x = {
    keyframes: [
      { time: 0, value: 0, easing: "linear" },
      { time: 4 * T, value: 0.3, easing: "ease-in" },
    ],
  };
  const main = sequence("main", [
    a,
    b,
    overlay,
    freeze,
    media("a-audio", "a", 2, 4, "audio"),
    caption("a-caption", "a-main"),
    caption("b-caption", "b-main", 3, 4, "b"),
  ]);
  main.transitions = [
    {
      id: "join",
      fromClipId: "a-main",
      toClipId: "b-main",
      start: 3 * T,
      duration: T,
      kind: "dissolve",
    },
  ];
  return validateEditorDocument({
    schemaVersion: 2,
    timebase: T,
    id: "asset-project",
    name: "完整工程",
    revision: 9,
    activeSequenceId: "main",
    exportProfiles: [],
    assets: [
      { id: "a", name: "原片A", kind: "video", duration: 20 * T },
      { id: "b", name: "原片B", kind: "video", duration: 20 * T },
      { id: "image", name: "图片", kind: "image", duration: 20 * T },
      { id: "voice", name: "旁白录音", kind: "audio", duration: 20 * T },
    ],
    sequences: [main],
  });
}
function apply(document: EditorDocument, ids: string[]) {
  const plan = planEditorAssetRemoval(document, ids);
  return { plan, after: applyEditorOperations(document, plan.operations, document.revision) };
}

test("deletion covers free overlays, reverse maps, image holds and audio tracks without closing timeline gaps", () => {
  const doc = fixture(),
    before = structuredClone(doc),
    { plan, after } = apply(doc, ["a", "image", "a"]);
  assert.deepEqual(plan.usage.assetIds, ["a", "image"]);
  assert.equal(plan.usage.assetCount, 2);
  assert.equal(plan.usage.clipCount, 3);
  assert.equal(plan.usage.audioClipCount, 1);
  assert.equal(plan.usage.affectedCaptionCount, 1);
  assert.equal(plan.usage.transitionCount, 1);
  assert.equal(plan.usage.sequenceCount, 1);
  assert.equal(plan.usage.used, true);
  assert.deepEqual(
    after.sequences[0]!.clips,
    doc.sequences[0]!.clips.filter((clip) => ["b-main", "b-caption"].includes(clip.id)),
  );
  assert.deepEqual(after.sequences[0]!.transitions, []);
  assert.deepEqual(doc, before);
  assert.equal(after.revision, doc.revision + 1);
  assert.equal(after.sequences[0]!.clips[0]!.start, 3 * T);
});

test("all sequences and multicam angles are checked, including outer subtitle provenance through nested instances", () => {
  const doc = fixture();
  const child = sequence("child", [media("child-a", "a", 1, 2), media("child-kept", "b", 5, 5)]);
  const multicam: MulticamClip = {
    ...media("angles", "a", 0, 3),
    kind: "multicam",
    angles: [
      { id: "camera-a", name: "A", assetId: "a", offset: 0 },
      { id: "camera-b", name: "B", assetId: "b", offset: 0 },
    ],
    audioAngleId: "camera-b",
    switches: [{ time: 0, angleId: "camera-b" }],
  } as unknown as MulticamClip;
  delete (multicam as any).assetId;
  const multi = sequence("multi", [multicam, media("multi-kept", "b", 5, 5)]);
  const parent = sequence("parent", [
    nested("child-wrap", "child", 7, 4),
    nested("multi-wrap", "multi", 12, 4),
  ]);
  const outer = caption("outer-caption", "child-wrap", 8, 2);
  outer.sourceBinding!.sourceStart = T;
  outer.sourceBinding!.sourceEnd = 3 * T;
  outer.sourceBinding!.provenance!.path = ["child-a"];
  const otherAudio = caption("outer-multicam-caption", "multi-wrap", 12, 3, "b");
  otherAudio.sourceBinding!.provenance!.path = ["angles"];
  parent.clips.push(outer, otherAudio);
  doc.sequences.push(child, multi, parent);
  const valid = validateEditorDocument(doc),
    { plan, after } = apply(valid, ["a"]);
  assert.equal(plan.usage.clipCount, 4);
  assert.equal(plan.usage.multicamClipCount, 1);
  assert.equal(plan.usage.sequenceClipCount, 2);
  assert.equal(plan.usage.sequenceCount, 4);
  assert.equal(plan.usage.affectedCaptionCount, 3);
  assert.deepEqual(
    after.sequences.find((seq) => seq.id === "parent")!.clips,
    parent.clips.filter((clip) => clip.kind === "sequence"),
  );
  assert.equal(after.sequences.find((seq) => seq.id === "multi")!.clips[0]!.id, "multi-kept");
  assert.equal(after.sequences.find((seq) => seq.id === "child")!.clips[0]!.start, 5 * T);
});

test("deletion refuses a shortened or empty compound source instead of deleting or trimming its parent", () => {
  for (const keep of [false, true]) {
    const doc = fixture();
    const child = sequence("source", [
      ...(keep ? [media("kept", "b", 0, 2)] : []),
      media("tail", "a", 2, 3),
    ]);
    doc.sequences.push(child, sequence("parent", [nested("compound", "source", 5, 5)]));
    const valid = validateEditorDocument(doc),
      before = structuredClone(valid);
    assert.throws(() => planEditorAssetRemoval(valid, ["a"]), /复合片段.*source.*先移除或调整/);
    assert.deepEqual(valid, before);
  }
});

test("held nested source at the new end boundary also refuses deletion", () => {
  const doc = fixture(),
    child = sequence("source", [media("kept", "b", 0, 3), media("tail", "a", 3, 2)]);
  const held = nested("held", "source");
  held.timeMap.points = [
    { time: 0, source: 3 * T },
    { time: 4 * T, source: 3 * T },
  ];
  doc.sequences.push(child, sequence("parent", [held]));
  assert.throws(() => planEditorAssetRemoval(validateEditorDocument(doc), ["a"]), /先移除或调整/);
});

test("locked media and indirectly bound subtitle tracks reject the entire operation without unlocking", () => {
  const direct = fixture();
  direct.sequences[0]!.tracks.find((track) => track.id === "overlay")!.locked = true;
  assert.throws(() => planEditorAssetRemoval(direct, ["a"]), /main.*画面.*锁定/);
  const doc = fixture(),
    child = sequence("child", [media("leaf", "a", 0, 2), media("kept", "b", 5, 5)]),
    outer = sequence("outer", [nested("compound", "child", 0, 4)]);
  const bound = caption("outside", "compound", 0, 2);
  bound.sourceBinding!.provenance!.path = ["leaf"];
  outer.clips.push(bound);
  outer.tracks.find((track) => track.id === "text")!.locked = true;
  doc.sequences.push(child, outer);
  const valid = validateEditorDocument(doc);
  assert.throws(() => planEditorAssetRemoval(valid, ["a"]), /outer.*文字.*锁定/);
  assert.equal(valid.assets.length, 4);
  assert.equal(outer.tracks.at(-1)!.locked, true);
});

test("production source references are cleaned while approval reconciliation remains one atomic undo", () => {
  const doc = fixture();
  doc.production = {
    script: "保留文稿",
    roughCuts: [
      { id: "r-a", assetId: "a" },
      { id: "r-b", assetId: "b" },
    ],
    workflow: {
      name: "原计划",
      sources: [
        { assetId: "a", purpose: "参考" },
        { assetId: "b", purpose: "保留" },
      ],
    },
    narration: {
      phase: "aligned",
      captionBasis: "recording",
      recordingAssetId: "a",
      draftCaptionIds: ["draft"],
      approvedScript: "已审核",
      approvedFingerprint: "reviewed",
      alignmentFingerprint: "aligned",
    },
    custom: { keep: true },
  };
  const recorded = caption("recorded-narration-1", "b-main", 3, 4, "b");
  delete recorded.sourceBinding;
  doc.sequences[0]!.clips.push(recorded);
  const before = validateEditorDocument(doc),
    plan = planEditorAssetRemoval(before, ["a"]),
    draft = applyEditorOperations(before, plan.operations, before.revision);
  const ops = [...plan.operations, ...reconcileEditorProduction(before, draft)];
  const history = new EditorHistory(before);
  history.apply(ops, before.revision, "删除素材");
  const after = history.read();
  assert.equal(plan.usage.roughCutCount, 1);
  assert.equal(plan.usage.workflowSourceCount, 1);
  assert.equal(plan.usage.narrationRecording, true);
  assert.equal(plan.usage.affectedCaptionCount, 2);
  assert.deepEqual(after.production!.roughCuts, [{ id: "r-b", assetId: "b" }]);
  assert.deepEqual((after.production!.workflow as any).sources, [
    { assetId: "b", purpose: "保留" },
  ]);
  assert.deepEqual(after.production!.custom, { keep: true });
  assert.equal((after.production!.narration as any).recordingAssetId, undefined);
  assert.equal((after.production!.narration as any).approvedFingerprint, undefined);
  assert.equal(after.revision, before.revision + 1);
  history.undo();
  assert.deepEqual(history.read().sequences, before.sequences);
  assert.deepEqual(history.read().assets, before.assets);
  assert.deepEqual(history.read().production, before.production);
  history.redo();
  assert.deepEqual(history.read().sequences, after.sequences);
});

test("unused media, empty requests and unknown IDs do not affect other project data", () => {
  const doc = fixture(),
    empty = planEditorAssetRemoval(doc, []);
  assert.deepEqual(empty.operations, []);
  assert.equal(empty.usage.used, false);
  const { plan, after } = apply(doc, ["voice"]);
  assert.equal(plan.usage.used, false);
  assert.equal(plan.operations.length, 1);
  assert.deepEqual(after.sequences, doc.sequences);
  assert.throws(() => planEditorAssetRemoval(doc, ["missing"]), /不在当前工程/);
  assert.throws(() => planEditorAssetRemoval(doc, ["../unsafe"]), /ID 无效/);
  assert.throws(() => applyEditorOperations(after, plan.operations, doc.revision), /工程已更新/);
});

test("source-bound titles are counted while unrelated grouped clips remain untouched", () => {
  const doc = fixture(),
    title = caption("bound-title", "a-main");
  title.role = "title";
  doc.sequences[0]!.clips.push(title);
  for (const clip of doc.sequences[0]!.clips.filter((clip) =>
    ["a-main", "b-main"].includes(clip.id),
  ))
    clip.groupId = "shared";
  const { plan, after } = apply(doc, ["a"]);
  assert.equal(plan.usage.affectedTextClipCount, 2);
  assert.equal(plan.usage.affectedCaptionCount, 1);
  assert.deepEqual(
    after.sequences[0]!.clips.find((clip) => clip.id === "b-main"),
    doc.sequences[0]!.clips.find((clip) => clip.id === "b-main"),
  );
  assert.ok(!after.sequences[0]!.clips.some((clip) => clip.id === "bound-title"));
});
