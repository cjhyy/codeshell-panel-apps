import assert from "node:assert/strict";
import test from "node:test";
import {
  planCreateMulticam,
  planMulticamCut,
  planMulticamSwitches,
  planRecordMulticamSwitches,
  planUpdateMulticamAngles,
} from "../apps/video-studio/src/editor/multicam-edits";
import { correlateAudioFeatures } from "../apps/video-studio/src/editor/audio-correlation";
import { createTrack } from "../apps/video-studio/src/editor/defaults";
import { applyEditorOperations } from "../apps/video-studio/src/editor/operations";
import { evaluateFrame } from "../apps/video-studio/src/editor/evaluate";
import { EditorHistory } from "../apps/video-studio/src/editor/history";
import type { EditorDocument, MulticamClip } from "../apps/video-studio/src/editor/types";
const T = 240000;
function fixture(): EditorDocument {
  return {
    schemaVersion: 2,
    timebase: T,
    id: "doc",
    name: "多机位",
    revision: 0,
    activeSequenceId: "main",
    exportProfiles: [],
    assets: [
      { id: "a", kind: "video", name: "正面", duration: 10 * T, width: 160, height: 90 },
      { id: "b", kind: "video", name: "侧面", duration: 9 * T, width: 160, height: 90 },
    ],
    sequences: [
      {
        id: "main",
        name: "节目",
        width: 160,
        height: 90,
        frameRate: { numerator: 30000, denominator: 1001 },
        background: "#000000",
        timelineMode: "free",
        tracks: [createTrack("v", "video")],
        clips: [],
        transitions: [],
        markers: [],
      },
    ],
  };
}
const apply = (doc: EditorDocument, ops: ReturnType<typeof planCreateMulticam>) =>
  applyEditorOperations(doc, ops, doc.revision);
test("group chooses common valid source interval with signed offsets and independent continuous master audio", () => {
  let doc = fixture();
  doc = apply(
    doc,
    planCreateMulticam(doc, "main", {
      assetIds: ["a", "b"],
      name: "双机位",
      at: 17,
      offsets: { a: 0, b: -T },
      audioAssetId: "a",
    }),
  );
  const clip = doc.sequences[0]!.clips[0] as MulticamClip;
  assert.equal(clip.start, 17);
  assert.equal(clip.duration, 9 * T);
  assert.deepEqual(clip.timeMap.points, [
    { time: 0, source: T },
    { time: 9 * T, source: 10 * T },
  ]);
  doc = apply(doc, planMulticamCut(doc, "main", clip.id, 2 * T, clip.angles[1]!.id));
  const frame = evaluateFrame(doc, "main", 3 * T + 17);
  assert.equal((frame.layers[0] as any).assetId, "b");
  assert.equal((frame.layers[0] as any).sourceTime, 3 * T);
  assert.equal(frame.audio[0]!.assetId, "a");
  assert.equal(frame.audio[0]!.sourceTime, 4 * T);
});
test("recorded switches replace only the recorded interval and stay one undo step", () => {
  let doc = fixture();
  doc = apply(doc, planCreateMulticam(doc, "main", { assetIds: ["a", "b"], name: "节目", at: 0 }));
  const clip = doc.sequences[0]!.clips[0] as MulticamClip,
    [a, b] = clip.angles;
  doc = apply(
    doc,
    planMulticamSwitches(doc, "main", clip.id, [
      { time: 0, angleId: a!.id },
      { time: T, angleId: b!.id },
      { time: 5 * T, angleId: a!.id },
      { time: 7 * T, angleId: b!.id },
    ]),
  );
  const history = new EditorHistory(doc);
  history.apply(
    planRecordMulticamSwitches(doc, "main", clip.id, 2 * T, 6 * T, [
      { time: 2 * T, angleId: a!.id },
      { time: 3 * T, angleId: b!.id },
      { time: 4 * T, angleId: a!.id },
    ]),
    doc.revision,
    "录制机位",
  );
  assert.deepEqual(
    (history.read().sequences[0]!.clips[0] as MulticamClip).switches.map((c) => c.time),
    [0, T, 2 * T, 3 * T, 4 * T, 7 * T],
  );
  history.undo();
  assert.deepEqual(
    (history.read().sequences[0]!.clips[0] as MulticamClip).switches,
    (doc.sequences[0]!.clips[0] as MulticamClip).switches,
  );
});
test("switch edits, manual offsets and master selection validate ranges, cycles of cut time and locks atomically", () => {
  let doc = fixture();
  doc = apply(doc, planCreateMulticam(doc, "main", { assetIds: ["a", "b"], name: "节目", at: 0 }));
  const clip = doc.sequences[0]!.clips[0] as MulticamClip;
  assert.throws(
    () =>
      planUpdateMulticamAngles(doc, "main", clip.id, {
        angles: clip.angles.map((a) => ({ ...a, offset: -T })),
      }),
    /超出/,
  );
  assert.throws(
    () => planMulticamSwitches(doc, "main", clip.id, [{ time: 1, angleId: clip.angles[0]!.id }]),
    /零时刻/,
  );
  assert.throws(
    () => planMulticamCut(doc, "main", clip.id, clip.duration, clip.angles[1]!.id),
    /位于/,
  );
  doc.sequences[0]!.tracks.find((t) => t.id === clip.trackId)!.locked = true;
  assert.throws(() => planMulticamCut(doc, "main", clip.id, T, clip.angles[1]!.id), /锁定/);
  const invalid = fixture();
  assert.throws(
    () =>
      planCreateMulticam(invalid, "main", {
        assetIds: ["a", "b"],
        name: "节目",
        at: 0,
        offsets: { b: 10 * T },
      }),
    /共同有效/,
  );
  assert.equal(invalid.revision, 0);
});
test("FFT normalized correlation finds positive/negative source offsets despite gain and exposes repeated or silent ambiguity", () => {
  let seed = 17;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const source = Float32Array.from({ length: 2400 }, () => random() * 3);
  const delayed = new Float32Array(2600);
  for (let i = 0; i < source.length; i++) delayed[i + 73] = source[i]! * 1.7 + 0.3;
  const positive = correlateAudioFeatures(source, delayed, 200);
  assert.equal(positive.lag, 73);
  assert.ok(positive.confidence > 0.999);
  assert.equal(positive.reliable, true);
  const negative = correlateAudioFeatures(delayed, source, 200);
  assert.equal(negative.lag, -73);
  assert.equal(negative.reliable, true);
  const silence = correlateAudioFeatures(new Float32Array(1000), new Float32Array(1000), 100);
  assert.equal(silence.reliable, false);
  const repeated = Float32Array.from({ length: 2400 }, (_, i) => 2 + Math.sin((i * Math.PI) / 20));
  assert.equal(correlateAudioFeatures(repeated, repeated, 200).reliable, false);
  const boundary = correlateAudioFeatures(source, delayed, 73);
  assert.equal(boundary.reliable, false);
  assert.match(boundary.reason!, /边界/);
});
