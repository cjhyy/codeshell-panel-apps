import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasAlignmentReason,
  planCanvasAlignment,
  type CanvasAlignment,
} from "../apps/video-studio/src/editor/canvas-alignment";
import { canvasTargetCorners, canvasTargets } from "../apps/video-studio/src/editor/canvas-edits";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import { evaluateAnimatedNumber } from "../apps/video-studio/src/editor/animation";
import { applyEditorOperations } from "../apps/video-studio/src/editor/operations";
import { EditorHistory } from "../apps/video-studio/src/editor/history";
import type { EditorDocument, MediaClip } from "../apps/video-studio/src/editor/types";

const tick = 36010;
const alignments: CanvasAlignment[] = ["left", "center-x", "right", "top", "center-y", "bottom"];
function fixture(): EditorDocument {
  const picture = (id: string, trackId: string): MediaClip => ({
    id,
    label: id,
    trackId,
    kind: "media",
    assetId: "image",
    start: 16003,
    duration: 80003,
    timeMap: {
      points: [
        { time: 0, source: 0 },
        { time: 80003, source: 0 },
      ],
    },
    audio: defaultAudioMix(),
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
  });
  const a = picture("a", "v1"),
    b = picture("b", "v2");
  Object.assign(a.transform, {
    x: 0.2,
    y: -0.14,
    scaleX: 0.37,
    scaleY: 0.43,
    rotation: 37,
    flipX: true,
    fit: "cover",
    crop: { left: 0.17, right: 0.08, top: 0.13, bottom: 0.09 },
  });
  Object.assign(b.transform, { x: -0.1, y: 0.25, scaleX: 0.4, scaleY: 0.3, rotation: -23 });
  return {
    schemaVersion: 2,
    timebase: 240000,
    id: "align",
    name: "对齐测试",
    revision: 0,
    activeSequenceId: "main",
    exportProfiles: [],
    assets: [
      { id: "image", name: "静态画面", kind: "image", duration: 0, width: 641, height: 359 },
    ],
    sequences: [
      {
        id: "main",
        name: "主序列",
        width: 321,
        height: 181,
        frameRate: { numerator: 30000, denominator: 1001 },
        background: "#00000000",
        timelineMode: "free",
        tracks: [createTrack("v1", "video"), createTrack("v2", "video")],
        clips: [a, b],
        transitions: [],
        markers: [],
      },
    ],
  };
}
function assertAligned(document: EditorDocument, alignment: CanvasAlignment) {
  const horizontal = ["left", "center-x", "right"].includes(alignment),
    axis = horizontal ? "x" : "y";
  for (const target of canvasTargets(document, "main", tick)) {
    const points = canvasTargetCorners(target).map((point) => point[axis]),
      minimum = Math.min(...points),
      maximum = Math.max(...points),
      dimension = horizontal ? target.canvas.width : target.canvas.height;
    const actual =
      alignment === "left" || alignment === "top"
        ? minimum
        : alignment === "right" || alignment === "bottom"
          ? maximum
          : (minimum + maximum) / 2;
    const expected =
      alignment === "left" || alignment === "top"
        ? 0
        : alignment === "right" || alignment === "bottom"
          ? dimension
          : dimension / 2;
    assert.ok(Math.abs(actual - expected) < 1e-7, `${alignment}: ${actual} vs ${expected}`);
  }
}

test("rotated and cropped images align independently as one reversible batch without source mutation", () => {
  for (const alignment of alignments) {
    const document = fixture(),
      before = structuredClone(document),
      history = new EditorHistory(document);
    const operations = planCanvasAlignment(document, "main", ["a", "b", "a"], tick, alignment);
    assert.equal(operations.length, 2);
    const after = history.apply(operations, history.revision, "对齐到画布");
    assertAligned(after, alignment);
    const axis = ["left", "center-x", "right"].includes(alignment) ? "x" : "y";
    for (let index = 0; index < 2; index++) {
      const transform = structuredClone(after.sequences[0]!.clips[index]!.transform);
      transform[axis] = before.sequences[0]!.clips[index]!.transform[axis];
      assert.deepEqual(transform, before.sequences[0]!.clips[index]!.transform);
    }
    assert.deepEqual(document, before);
    assert.deepEqual(history.undo().sequences, before.sequences);
    assertAligned(history.redo(), alignment);
  }
});

test("alignment bounds hold across deterministic source sizes, crop, fit, flips and rotations", () => {
  let seed = 1771;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let index = 0; index < 100; index++) {
    const document = fixture(),
      sequence = document.sequences[0]!;
    sequence.width = 201 + Math.floor(random() * 1000);
    sequence.height = 101 + Math.floor(random() * 800);
    document.assets[0]!.width = 100 + Math.floor(random() * 1200);
    document.assets[0]!.height = 100 + Math.floor(random() * 1000);
    for (const clip of sequence.clips)
      Object.assign(clip.transform, {
        x: random() * 2 - 1,
        y: random() * 2 - 1,
        scaleX: 0.1 + random(),
        scaleY: 0.1 + random(),
        rotation: random() * 720 - 360,
        flipX: random() > 0.5,
        flipY: random() > 0.5,
        fit: ["contain", "cover", "stretch"][index % 3],
        crop: {
          left: random() * 0.3,
          right: random() * 0.3,
          top: random() * 0.3,
          bottom: random() * 0.3,
        },
      });
    for (const alignment of alignments) {
      const operations = planCanvasAlignment(document, "main", ["a", "b"], tick, alignment);
      assertAligned(applyEditorOperations(document, operations, document.revision), alignment);
    }
  }
});

test("animated x and y preserve exact nonframe keys, unrelated easing and the untouched axis", () => {
  const document = fixture(),
    clip = document.sequences[0]!.clips[0]!,
    local = tick - clip.start;
  clip.transform.x = {
    keyframes: [
      { time: 0, value: -0.3, easing: "ease-in" },
      { time: 80003, value: 0.4, easing: "hold" },
    ],
  };
  clip.transform.y = {
    keyframes: [
      {
        time: 0,
        value: 0.3,
        easing: { type: "cubic-bezier", x1: 0.1, y1: -0.2, x2: 0.8, y2: 1.2 },
      },
      { time: local, value: 0.2, easing: "ease-out" },
      { time: 80003, value: -0.1, easing: "hold" },
    ],
  };
  const before = structuredClone(clip);
  const horizontal = applyEditorOperations(
    document,
    planCanvasAlignment(document, "main", ["a"], tick, "center-x"),
    0,
  );
  const x = horizontal.sequences[0]!.clips[0]!.transform.x;
  assert.equal(typeof x, "object");
  if (typeof x !== "object") throw Error("missing x keys");
  assert.deepEqual(
    x.keyframes.filter((key) => key.time !== local),
    (before.transform.x as typeof x).keyframes,
  );
  assert.ok(Math.abs(x.keyframes.find((key) => key.time === local)!.value) < 1e-10);
  assert.deepEqual(horizontal.sequences[0]!.clips[0]!.transform.y, before.transform.y);
  const vertical = applyEditorOperations(
    horizontal,
    planCanvasAlignment(horizontal, "main", ["a"], tick, "center-y"),
    horizontal.revision,
  );
  const y = vertical.sequences[0]!.clips[0]!.transform.y;
  if (typeof y !== "object") throw Error("missing y keys");
  assert.equal(y.keyframes.length, 3);
  assert.equal(y.keyframes.find((key) => key.time === local)!.easing, "ease-out");
  assert.ok(Math.abs(evaluateAnimatedNumber(y, local)) < 1e-10);
  assert.deepEqual(
    y.keyframes.filter((key) => key.time !== local),
    (before.transform.y as typeof y).keyframes.filter((key) => key.time !== local),
  );
  assert.deepEqual(vertical.sequences[0]!.clips[0]!.transform.x, x);
});

test("overshooting position curves align the resolved current picture rather than the unclamped value", () => {
  const document = fixture(),
    clip = document.sequences[0]!.clips[0]!;
  clip.transform.x = {
    keyframes: [
      { time: 0, value: 9, easing: { type: "cubic-bezier", x1: 0, y1: 4, x2: 1, y2: 4 } },
      { time: 80003, value: 10 },
    ],
  };
  assert.ok(evaluateAnimatedNumber(clip.transform.x, tick - clip.start) > 10);
  const next = applyEditorOperations(
    document,
    planCanvasAlignment(document, "main", ["a", "b"], tick, "center-x"),
    0,
  );
  assertAligned(next, "center-x");
});

test("locked, hidden, inactive, masked, missing and unrenderable selections never produce partial batches", () => {
  for (const [mutate, reason] of [
    [
      (doc: EditorDocument) => {
        doc.sequences[0]!.tracks[1]!.locked = true;
      },
      /锁定/,
    ],
    [
      (doc: EditorDocument) => {
        doc.sequences[0]!.tracks[1]!.hidden = true;
      },
      /隐藏/,
    ],
    [
      (doc: EditorDocument) => {
        doc.sequences[0]!.clips[1]!.start = tick + 1;
      },
      /同时出现/,
    ],
    [
      (doc: EditorDocument) => {
        doc.sequences[0]!.clips[1]!.mask = {
          kind: "ellipse",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          rotation: 0,
          feather: 0,
          inverted: false,
        };
      },
      /蒙版/,
    ],
    [
      (doc: EditorDocument) => {
        doc.sequences[0]!.clips[1]!.transform.scaleX = 0;
      },
      /有效画面边框/,
    ],
    [
      (doc: EditorDocument) => {
        doc.sequences[0]!.clips[1]!.transform.scaleX = 100;
      },
      /超出允许范围/,
    ],
  ] as const) {
    const document = fixture();
    mutate(document);
    const before = structuredClone(document);
    assert.throws(() => planCanvasAlignment(document, "main", ["a", "b"], tick, "right"), reason);
    assert.deepEqual(document, before);
  }
  assert.match(canvasAlignmentReason(fixture(), "main", ["a", "missing"], tick), /已变化/);
  assert.throws(
    () => planCanvasAlignment(fixture(), "main", ["a", "missing"], tick, "left"),
    /已变化/,
  );
  assert.throws(() => planCanvasAlignment(fixture(), "main", ["a"], -1, "left"), /播放位置无效/);
});

test("nested sequence clips align their cropped and rotated child canvas without editing the child", () => {
  const document = fixture(),
    child = structuredClone(document.sequences[0]!);
  child.id = "child";
  child.width = 483;
  child.height = 257;
  document.sequences.push(child);
  const { assetId: _assetId, ...original } = document.sequences[0]!.clips[0]! as MediaClip;
  document.sequences[0]!.clips[0] = {
    ...original,
    kind: "sequence",
    sequenceId: "child",
    audio: defaultAudioMix(),
    timeMap: {
      points: [
        { time: 0, source: 16003 },
        { time: original.duration, source: 16003 },
      ],
    },
  };
  const next = applyEditorOperations(
    document,
    planCanvasAlignment(document, "main", ["a", "b"], tick, "bottom"),
    0,
  );
  assertAligned(next, "bottom");
  assert.deepEqual(next.sequences[1], child);
});

test("active transitions and audio selections explain why they cannot be aligned", () => {
  const document = fixture(),
    sequence = document.sequences[0]!,
    b = sequence.clips[1]! as MediaClip;
  b.trackId = "v1";
  b.start = 26003;
  sequence.transitions = [
    {
      id: "join",
      fromClipId: "a",
      toClipId: "b",
      start: 26003,
      duration: 70003,
      kind: "push-left",
    },
  ];
  assert.match(canvasAlignmentReason(document, "main", ["a", "b"], tick), /转场/);
  assert.throws(() => planCanvasAlignment(document, "main", ["a", "b"], tick, "left"), /转场/);
  sequence.transitions = [];
  b.trackId = "v2";
  sequence.tracks[1]!.kind = "audio";
  document.assets.push({ id: "audio", kind: "audio", name: "音频", duration: 200000 });
  b.assetId = "audio";
  assert.match(canvasAlignmentReason(document, "main", ["a", "b"], tick), /音频/);
  assert.throws(() => planCanvasAlignment(document, "main", ["a", "b"], tick, "left"), /音频/);
});

test("already aligned actions create no operations or animation keys", () => {
  const document = fixture();
  const next = applyEditorOperations(
    document,
    planCanvasAlignment(document, "main", ["a", "b"], tick, "left"),
    0,
  );
  assert.deepEqual(planCanvasAlignment(next, "main", ["a", "b"], tick, "left"), []);
});

test("lightweight eligibility reason changes at exact active and transition boundaries", () => {
  const document = fixture();
  assert.match(canvasAlignmentReason(document, "main", ["a"], 16002), /同时出现/);
  assert.equal(canvasAlignmentReason(document, "main", ["a"], 16003), "");
  assert.equal(canvasAlignmentReason(document, "main", ["a"], 96005), "");
  assert.match(canvasAlignmentReason(document, "main", ["a"], 96006), /同时出现/);
  const sequence = document.sequences[0]!,
    b = sequence.clips[1]!;
  b.trackId = "v1";
  b.start = 26003;
  sequence.transitions = [
    { id: "join", fromClipId: "a", toClipId: "b", start: 26003, duration: 70003, kind: "dissolve" },
  ];
  assert.equal(canvasAlignmentReason(document, "main", ["a"], 26002), "");
  assert.match(canvasAlignmentReason(document, "main", ["a"], 26003), /转场/);
  assert.match(canvasAlignmentReason(document, "main", ["a"], 96005), /转场/);
  assert.match(canvasAlignmentReason(document, "main", ["a"], 96006), /同时出现/);
});
