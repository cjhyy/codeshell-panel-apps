import assert from "node:assert/strict";
import test from "node:test";
import { planMarkerEdit } from "../apps/video-studio/src/editor/marker-edits";
import { createTrack } from "../apps/video-studio/src/editor/defaults";
import { applyEditorOperations } from "../apps/video-studio/src/editor/operations";
import { EditorHistory } from "../apps/video-studio/src/editor/history";
import type { EditorDocument } from "../apps/video-studio/src/editor/types";
import { MAX_EDITOR_TICK } from "../apps/video-studio/src/editor/validation";
const marker = () => ({
  id: "check",
  time: 8008,
  duration: 16016,
  name: "逐帧检查",
  note: "范围末端不包含",
  color: "#abc8",
});
const fixture = (): EditorDocument => ({
  schemaVersion: 2,
  timebase: 240000,
  id: "project",
  name: "标记测试",
  revision: 0,
  assets: [],
  exportProfiles: [],
  activeSequenceId: "main",
  sequences: [
    {
      id: "main",
      name: "主序列",
      width: 1920,
      height: 1080,
      frameRate: { numerator: 30000, denominator: 1001 },
      background: "#000",
      timelineMode: "free",
      tracks: [createTrack("v", "video")],
      clips: [],
      transitions: [],
      markers: [],
    },
  ],
});

test("range markers preserve exact NTSC ticks and opaque note/color through update, undo and redo", () => {
  const doc = fixture(),
    sequenceId = doc.activeSequenceId,
    before = structuredClone(doc);
  const history = new EditorHistory(doc);
  const plan = planMarkerEdit(doc, sequenceId, { action: "add", marker: marker() });
  history.apply(plan.operations, doc.revision);
  assert.deepEqual(doc, before);
  assert.deepEqual(history.read().sequences[0]!.markers, [marker()]);
  const current = history.read();
  const update = planMarkerEdit(current, sequenceId, {
    action: "update",
    markerId: "check",
    patch: { name: "保留精度", note: "第一行\n第二行" },
  });
  history.apply(update.operations, current.revision);
  assert.equal(history.read().sequences[0]!.markers[0]!.time, 8008);
  assert.equal(history.read().sequences[0]!.markers[0]!.duration, 16016);
  history.undo();
  assert.deepEqual(history.read().sequences[0]!.markers, [marker()]);
  history.redo();
  assert.equal(history.read().sequences[0]!.markers[0]!.name, "保留精度");
});
test("point, range and deletion operate independently of track locks and do not change sequence media duration", () => {
  let doc = fixture();
  doc.sequences[0]!.tracks.forEach((track) => (track.locked = true));
  const seq = doc.activeSequenceId,
    tracks = structuredClone(doc.sequences[0]!.tracks);
  for (const request of [
    { action: "add", marker: { ...marker(), time: MAX_EDITOR_TICK, duration: 0 } },
    { action: "update", markerId: "check", patch: { time: MAX_EDITOR_TICK - 1, duration: 1 } },
    { action: "remove", markerId: "check" },
  ] as const)
    doc = applyEditorOperations(doc, planMarkerEdit(doc, seq, request).operations, doc.revision);
  assert.deepEqual(doc.sequences[0]!.markers, []);
  assert.deepEqual(doc.sequences[0]!.tracks, tracks);
  assert.deepEqual(doc.sequences[0]!.clips, []);
});
test("invalid marker requests reject atomically without dropping unsupported serialized fields", () => {
  const doc = fixture(),
    seq = doc.activeSequenceId,
    before = structuredClone(doc);
  const invalid = [
    { action: "add", marker: { ...marker(), duration: -1 } },
    { action: "add", marker: { ...marker(), time: 0.5 } },
    { action: "add", marker: { ...marker(), time: MAX_EDITOR_TICK } },
    { action: "add", marker: { ...marker(), color: "red;display:none" } },
    { action: "add", marker: { ...marker(), name: "" } },
    { action: "add", marker: marker(), other: true },
    { action: "add", marker: { ...marker(), unsupported: true } },
    { action: "update", markerId: "absent", patch: { time: 0 } },
    { action: "remove", markerId: "absent" },
  ];
  for (const request of invalid) assert.throws(() => planMarkerEdit(doc, seq, request as never));
  let called = false;
  const dynamic = Object.defineProperty({}, "action", {
    enumerable: true,
    get() {
      called = true;
      return "add";
    },
  });
  assert.throws(() => planMarkerEdit(doc, seq, dynamic as never));
  assert.equal(called, false);
  assert.deepEqual(doc, before);
});
test("missing sequences and duplicate markers never replace a prior marker", () => {
  const doc = fixture(),
    seq = doc.activeSequenceId;
  const next = applyEditorOperations(
    doc,
    planMarkerEdit(doc, seq, { action: "add", marker: marker() }).operations,
    doc.revision,
  );
  assert.throws(() =>
    planMarkerEdit(next, seq, { action: "add", marker: { ...marker(), name: "不能覆盖" } }),
  );
  assert.throws(() => planMarkerEdit(next, "missing", { action: "remove", markerId: "check" }));
  assert.deepEqual(next.sequences[0]!.markers, [marker()]);
});
