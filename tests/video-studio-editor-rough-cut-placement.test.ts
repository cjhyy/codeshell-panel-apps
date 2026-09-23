import assert from "node:assert/strict";
import test from "node:test";
import {
  findFreeTrack,
  planRoughCutPlacement,
} from "../apps/video-studio/src/editor/rough-cut-placement";
import { applyEditorOperations } from "../apps/video-studio/src/editor/operations";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import { projectLegacyView } from "../apps/video-studio/src/editor/legacy-adapter";
import type {
  EditorDocument,
  EditorSequence,
  MediaClip,
} from "../apps/video-studio/src/editor/types";
import { validateEditorDocument } from "../apps/video-studio/src/editor/validation";
import type { RoughCut } from "../apps/video-studio/src/model";

const T = 240000;
const F = 8000;
const TALK = 10 * T + 1234; // Real media: not a whole number of 30 fps frames.

function media(
  id: string,
  trackId: string,
  assetId: string,
  start: number,
  duration: number,
  source = 0,
): MediaClip {
  return {
    id,
    kind: "media",
    label: id,
    trackId,
    start,
    duration,
    assetId,
    timeMap: {
      points: [
        { time: 0, source },
        { time: duration, source: source + duration },
      ],
    },
    audio: defaultAudioMix(),
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
  };
}
function document(sequence: Partial<EditorSequence>): EditorDocument {
  return validateEditorDocument({
    schemaVersion: 2,
    timebase: T,
    id: "rough-cut-project",
    name: "粗剪放置",
    revision: 5,
    activeSequenceId: "main",
    exportProfiles: [],
    assets: [
      { id: "talk", name: "口播原片", kind: "video", duration: TALK, width: 1920, height: 1080 },
      { id: "clean", name: "优化声音", kind: "audio", duration: TALK },
      { id: "broll", name: "空镜", kind: "video", duration: 20 * T, width: 1920, height: 1080 },
      { id: "music", name: "音乐", kind: "audio", duration: 30 * T },
    ],
    sequences: [
      {
        id: "main",
        name: "主序列",
        width: 1920,
        height: 1080,
        frameRate: { numerator: 30, denominator: 1 },
        timelineMode: "free",
        background: "#000000",
        tracks: [createTrack("v1", "video"), createTrack("v2", "video"), createTrack("a1", "audio")],
        clips: [],
        transitions: [],
        markers: [],
        ...sequence,
      },
    ],
  });
}
const cut = (id: string, assetId: string, inFrame: number, outFrame: number): RoughCut => ({
  id,
  assetId,
  inFrame,
  outFrame,
  name: id,
  enabled: true,
});
let counter = 0;
const idFactory = (kind: "clip" | "track") => `${kind}-new-${++counter}`;
const apply = (doc: EditorDocument, operations: Parameters<typeof applyEditorOperations>[1]) =>
  applyEditorOperations(doc, operations, doc.revision).sequences[0]!;
const clip = (sequence: EditorSequence, id: string) =>
  sequence.clips.find((item) => item.id === id)!;
function assertNoOverlap(sequence: EditorSequence) {
  for (const a of sequence.clips)
    for (const b of sequence.clips)
      if (a.id < b.id && a.trackId === b.trackId)
        assert.ok(
          a.start + a.duration <= b.start || b.start + b.duration <= a.start,
          `${a.id} and ${b.id} overlap on ${a.trackId}`,
        );
}

test("placing at the playhead on real media keeps the source's true tail", () => {
  const doc = document({
    clips: [media("intro", "v1", "broll", 0, 2 * T), media("overlay", "v2", "broll", 0, 5 * T)],
  });
  assert.equal(
    projectLegacyView(doc).timelineComplete,
    false,
    "The old 30 fps view cannot represent this sequence",
  );
  const at = 2 * T + 17;
  const plan = planRoughCutPlacement(doc, "main", [cut("c1", "talk", 30, 300)], {
    at,
    idFactory,
  });
  assert.equal(plan.start, at);
  assert.equal(plan.clipIds.length, 1);
  const after = apply(doc, plan.operations);
  const placed = clip(after, plan.clipIds[0]!) as MediaClip;
  assert.equal(placed.trackId, "v1");
  assert.equal(placed.start, at);
  assert.equal(placed.assetId, "talk");
  assert.equal(placed.duration, TALK - 30 * F);
  assert.deepEqual(placed.timeMap.points, [
    { time: 0, source: 30 * F },
    { time: TALK - 30 * F, source: TALK },
  ]);
  assert.equal(placed.label, "口播原片");
  assert.deepEqual(placed.audio, defaultAudioMix());
  // An interior out point stays on its frame.
  const inner = planRoughCutPlacement(doc, "main", [cut("c2", "talk", 30, 90)], { at, idFactory });
  const innerClip = clip(apply(doc, inner.operations), inner.clipIds[0]!) as MediaClip;
  assert.deepEqual(innerClip.timeMap.points.at(-1), { time: 60 * F, source: 90 * F });
  assertNoOverlap(after);
});

test("magnetic insert snaps to a block boundary and shifts later linked blocks", () => {
  const p2 = media("p2", "v1", "broll", 2 * T, 3 * T, 2 * T),
    voice = media("p2-voice", "a1", "clean", 2 * T, 3 * T);
  p2.linkGroupId = "link-p2";
  voice.linkGroupId = "link-p2";
  const doc = document({
    timelineMode: "magnetic",
    magneticTrackId: "v1",
    clips: [media("p1", "v1", "broll", 0, 2 * T), p2, voice],
  });
  const plan = planRoughCutPlacement(doc, "main", [cut("c1", "broll", 0, 30)], {
    at: 2 * T + 10000,
    idFactory,
  });
  assert.equal(plan.start, 2 * T, "The playhead snaps to the nearest block boundary");
  const moves = plan.operations.filter((operation) => operation.type === "clip.move");
  assert.equal(moves.length, 1, "One move shifts the whole later block");
  const after = apply(doc, plan.operations);
  assert.equal(clip(after, "p1").start, 0);
  assert.equal(clip(after, "p2").start, 3 * T);
  assert.equal(clip(after, "p2-voice").start, 3 * T, "Linked audio follows its picture");
  const placed = clip(after, plan.clipIds[0]!);
  assert.equal(placed.trackId, "v1");
  assert.equal(placed.start, 2 * T);
  assertNoOverlap(after);

  const late = planRoughCutPlacement(doc, "main", [cut("c1", "broll", 0, 30)], {
    at: 4 * T,
    idFactory,
  });
  assert.equal(late.start, 5 * T, "Nearer to the end boundary");
  assert.equal(late.operations.filter((operation) => operation.type === "clip.move").length, 0);

  const locked = document({
    timelineMode: "magnetic",
    magneticTrackId: "v1",
    tracks: [{ ...createTrack("v1", "video"), locked: true }, createTrack("a1", "audio")],
    clips: [media("p1", "v1", "broll", 0, 2 * T)],
  });
  assert.throws(
    () => planRoughCutPlacement(locked, "main", [cut("c1", "broll", 0, 30)], { at: 0, idFactory }),
    /锁定/,
  );
});

test("free mode never overlaps an occupied track; it uses or creates a free one", () => {
  const doc = document({
    clips: [media("long", "v1", "broll", 0, 10 * T), media("short", "v2", "broll", 3 * T, T)],
  });
  const plan = planRoughCutPlacement(doc, "main", [cut("c1", "broll", 0, 60)], {
    at: 2 * T,
    videoTrackId: "v1",
    idFactory,
  });
  const added = plan.operations.find((operation) => operation.type === "track.add");
  assert.ok(added, "A new picture track is created when every picture track is occupied");
  const after = apply(doc, plan.operations);
  const placed = clip(after, plan.clipIds[0]!);
  assert.equal(placed.start, 2 * T);
  assert.ok(!["v1", "v2"].includes(placed.trackId));
  assertNoOverlap(after);

  const free = planRoughCutPlacement(doc, "main", [cut("c1", "broll", 0, 30)], {
    at: 5 * T,
    idFactory,
  });
  assert.equal(free.operations.filter((operation) => operation.type === "track.add").length, 0);
  assert.equal(clip(apply(doc, free.operations), free.clipIds[0]!).trackId, "v2");

  assert.deepEqual(findFreeTrack(doc.sequences[0]!, "video", 5 * T, T, idFactory), {
    trackId: "v2",
    operations: [],
  });
  const created = findFreeTrack(doc.sequences[0]!, "video", 0, 20 * T, idFactory);
  assert.equal(created.operations.length, 1);
  assert.equal(created.operations[0]!.type, "track.add");
});

test("mixed video and audio cuts land on separate cursors in list order", () => {
  const doc = document({});
  const plan = planRoughCutPlacement(
    doc,
    "main",
    [
      cut("v-a", "broll", 0, 30),
      cut("a-a", "music", 0, 60),
      cut("v-b", "broll", 60, 90),
      cut("a-b", "clean", 0, 30),
    ],
    { at: T, idFactory },
  );
  const after = apply(doc, plan.operations);
  const placed = plan.clipIds.map((id) => clip(after, id));
  assert.deepEqual(
    placed.map((item) => [item.trackId, item.start, item.duration]),
    [
      ["v1", T, T],
      ["a1", T, 2 * T],
      ["v1", 2 * T, T],
      ["a1", 3 * T, T],
    ],
  );
  assertNoOverlap(after);
  // Audio no longer needs to fit inside the picture.
  const audioOnly = planRoughCutPlacement(doc, "main", [cut("a", "music", 0, 900)], {
    at: 0,
    idFactory,
  });
  assert.equal(clip(apply(doc, audioOnly.operations), audioOnly.clipIds[0]!).duration, 30 * T);
});

test("anchor end appends each kind after its target track", () => {
  const doc = document({
    clips: [media("picture", "v1", "broll", 0, 4 * T + 123), media("sound", "a1", "music", 0, T)],
  });
  const plan = planRoughCutPlacement(
    doc,
    "main",
    [cut("v", "broll", 0, 30), cut("a", "music", 0, 30)],
    { anchor: "end", at: 0, idFactory },
  );
  const after = apply(doc, plan.operations);
  assert.deepEqual(
    plan.clipIds.map((id) => [clip(after, id).trackId, clip(after, id).start]),
    [
      ["v1", 4 * T + 123],
      ["a1", T],
    ],
  );
  assert.equal(plan.start, 4 * T + 123);

  const magnetic = document({
    timelineMode: "magnetic",
    magneticTrackId: "v1",
    clips: [media("p1", "v1", "broll", 0, 2 * T), media("p2", "v1", "broll", 2 * T, T)],
  });
  const appended = planRoughCutPlacement(magnetic, "main", [cut("v", "broll", 0, 30)], {
    anchor: "end",
    idFactory,
  });
  assert.equal(appended.start, 3 * T);
  assert.equal(appended.operations.filter((operation) => operation.type === "clip.move").length, 0);
});

test("invalid selections are rejected before any change", () => {
  const doc = document({});
  const place = (cuts: RoughCut[]) =>
    planRoughCutPlacement(doc, "main", cuts, { at: 0, idFactory });
  assert.throws(() => place([]), /粗剪/);
  assert.throws(() => place([cut("x", "missing", 0, 30)]), /素材/);
  assert.throws(() => place([cut("x", "talk", 0, 301)]), /范围/);
  assert.throws(() => place([cut("x", "talk", 0, 30), cut("x", "talk", 30, 60)]), /重复/);
  assert.throws(
    () =>
      place(Array.from({ length: 1001 }, (_, index) => cut(`c${index}`, "broll", 0, 1))),
    /1000/,
  );
  const crowded = document({
    clips: Array.from({ length: 1999 }, (_, index) => media(`m${index}`, "v1", "broll", index, 1)),
  });
  assert.throws(
    () =>
      planRoughCutPlacement(
        crowded,
        "main",
        [cut("a", "broll", 0, 1), cut("b", "broll", 1, 2)],
        { anchor: "end", idFactory },
      ),
    /数量/,
  );
  assert.throws(
    () => planRoughCutPlacement(doc, "main", [cut("a", "broll", 0, 30)], { idFactory }),
    /播放头/,
  );
});

test("placement adds distinct clips in list order and never touches markers or other clips", () => {
  const doc = document({
    clips: [media("sound-late", "a1", "music", 5 * T, T), media("sound-early", "a1", "music", 0, T)],
  });
  const plan = planRoughCutPlacement(
    doc,
    "main",
    [cut("same-b", "broll", 30, 60), cut("same-a", "broll", 30, 60), cut("voice", "clean", 0, 30)],
    { anchor: "end", idFactory },
  );
  assert.ok(
    plan.operations.every((operation) => ["clip.add", "track.add"].includes(operation.type)),
    "Rough-cut markers stay in the production annotation; existing clips are untouched",
  );
  assert.equal(new Set(plan.clipIds).size, 3);
  const after = apply(doc, plan.operations);
  assert.deepEqual(
    plan.clipIds.map((id) => clip(after, id).start),
    [0, T, 6 * T],
    "Audio follows the latest endpoint even when stored clips are out of order",
  );
  assert.deepEqual(clip(after, "sound-late"), doc.sequences[0]!.clips[0]);
});

test("one thousand cuts are one transaction; the 24-hour limit is kept", () => {
  const many = validateEditorDocument({
    ...document({}),
    assets: Array.from({ length: 1000 }, (_, index) => ({
      id: `source-${index}`,
      name: `素材 ${index}`,
      kind: "video",
      duration: 2 * T,
    })),
  });
  const cuts = Array.from({ length: 1000 }, (_, index) =>
    cut(`selection-${index}`, `source-${index}`, 0, 30),
  );
  const plan = planRoughCutPlacement(many, "main", cuts, { at: 0, idFactory });
  const after = apply(many, plan.operations);
  assert.equal(after.clips.length, 1000);
  assert.deepEqual(
    plan.clipIds.map((id) => (clip(after, id) as MediaClip).assetId),
    cuts.map((item) => item.assetId),
  );
  const nearLimit = document({ clips: [media("late", "v1", "broll", 24 * 3600 * T - 3 * T, T)] });
  assert.throws(
    () =>
      planRoughCutPlacement(nearLimit, "main", [cut("c", "broll", 0, 90)], {
        anchor: "end",
        idFactory,
      }),
    /时长上限/,
  );
});
