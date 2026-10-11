import assert from "node:assert/strict";
import { test } from "node:test";
import { createTrack, defaultAudioMix, defaultColorAdjustment, defaultTransform } from "../apps/video-studio/src/editor/defaults";
import { copyClipColor, pasteClipColor, resetClipColor } from "../apps/video-studio/src/editor/color-edits";
import { evaluateAnimatedNumber } from "../apps/video-studio/src/editor/animation";
import { applyEditorOperations } from "../apps/video-studio/src/editor/operations";
import { EditorHistory } from "../apps/video-studio/src/editor/history";
import type { EditorDocument, ShapeClip } from "../apps/video-studio/src/editor/types";
import {
  applyColorToRgba,
  evaluateColorCurve,
  hasColorAdjustment,
  type ResolvedColorAdjustment,
} from "../apps/video-studio/src/editor/color";

const defaults = () => defaultColorAdjustment() as ResolvedColorAdjustment;
function colorDocument(): EditorDocument {
  const shape = (id: string, start: number, duration: number): ShapeClip => ({
    id, label: id, kind: "shape", trackId: id, start, duration,
    transform: defaultTransform(), color: defaultColorAdjustment(), blendMode: "normal",
    shape: "rectangle", fill: "#a04020", stroke: "#00000000", strokeWidth: 0,
  });
  const a = shape("a", 0, 960000), b = shape("b", 240000, 480000), c = shape("c", 960000, 240000);
  a.color.exposure = { keyframes: [{ time: 0, value: 0, easing: "ease-in" }, { time: 960000, value: 2 }] };
  a.color.curves = [{ channel: "red", points: [{ x: 0, y: 0 }, { x: 0.4, y: 0.7 }, { x: 1, y: 1 }] }];
  a.color.hsl = [{ hue: 0, width: 60, hueShift: 30, saturation: 0.2, lightness: -0.1 }];
  b.color.exposure = { keyframes: [{ time: 0, value: -1, easing: { type: "cubic-bezier", x1: 0.1, y1: 0.2, x2: 0.7, y2: 0.8 } }, { time: 480000, value: -2, easing: "hold" }] };
  return {
    schemaVersion: 2, timebase: 240000, id: "colors", name: "调色复用", revision: 4,
    activeSequenceId: "main", exportProfiles: [], assets: [],
    sequences: [{ id: "main", name: "主序列", width: 320, height: 180,
      frameRate: { numerator: 30000, denominator: 1001 }, background: "#000000", timelineMode: "free",
      tracks: ["a", "b", "c"].map((id) => createTrack(id, "video")), clips: [a, b, c], transitions: [], markers: [] }],
  };
}
function grade(input: number[], settings: Partial<ResolvedColorAdjustment>) {
  const data = new Uint8ClampedArray(input);
  applyColorToRgba(data, { ...defaults(), ...settings });
  return [...data];
}

test("neutral grading is byte-identical, including transparent RGB data", () => {
  const input = [1, 2, 3, 0, 127, 128, 129, 128, 255, 255, 255, 255];
  assert.deepEqual(grade(input, {}), input);
  assert.equal(hasColorAdjustment(defaults()), false);
  const identity = {
    ...defaults(),
    curves: [
      {
        channel: "rgb" as const,
        points: [
          { x: 0, y: 0 },
          { x: 0.3, y: 0.3 },
          { x: 1, y: 1 },
        ],
      },
    ],
  };
  assert.equal(hasColorAdjustment(identity), false);
});

test("exposure, white balance and contrast change color while preserving straight alpha", () => {
  assert.deepEqual(grade([64, 64, 64, 123], { exposure: 1 }), [128, 128, 128, 123]);
  const warm = grade([128, 128, 128, 200], { temperature: 1 });
  assert.ok(warm[0]! > warm[1]! && warm[1]! > warm[2]!);
  assert.equal(warm[3], 200);
  assert.deepEqual(grade([20, 80, 160, 255], { contrast: 0 }), [128, 128, 128, 255]);
});

test("global hue and saturation operate on actual RGB pixels", () => {
  assert.deepEqual(grade([255, 0, 0, 255], { hue: 120 }), [0, 255, 0, 255]);
  assert.deepEqual(grade([255, 0, 0, 255], { hue: -120 }), [0, 0, 255, 255]);
  const gray = grade([210, 70, 30, 180], { saturation: 0 });
  assert.equal(gray[0], gray[1]);
  assert.equal(gray[1], gray[2]);
  assert.equal(gray[3], 180);
});

test("HSL bands affect selected hue with a smooth boundary and do not recolor unrelated hues", () => {
  const hsl = [{ hue: 0, width: 60, hueShift: 120, saturation: 0, lightness: 0 }];
  assert.deepEqual(
    grade([255, 0, 0, 255, 0, 0, 255, 255], { hsl }),
    [0, 255, 0, 255, 0, 0, 255, 255],
  );
  assert.deepEqual(grade([100, 100, 100, 255], { hsl }), [100, 100, 100, 255]);
});

test("master and individual channel curves interpolate and compose in a defined order", () => {
  assert.equal(
    evaluateColorCurve(
      [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.8 },
        { x: 1, y: 1 },
      ],
      0.25,
    ),
    0.4,
  );
  const invert = [
    { x: 0, y: 1 },
    { x: 1, y: 0 },
  ];
  assert.deepEqual(
    grade([0, 255, 128, 80], { curves: [{ channel: "red", points: invert }] }),
    [255, 255, 128, 80],
  );
  assert.deepEqual(
    grade([0, 255, 0, 255], {
      curves: [
        { channel: "rgb", points: invert },
        { channel: "red", points: invert },
      ],
    }),
    [0, 0, 255, 255],
  );
  assert.throws(() => applyColorToRgba(new Uint8ClampedArray([0, 1, 2]), defaults()));
});

test("color copies the exact current grade, clamps to boundaries and detaches curves and HSL", () => {
  const document = colorDocument(), before = structuredClone(document), clip = document.sequences[0]!.clips[0]!,
    sample = copyClipColor(document, "main", "a", 280013);
  assert.equal(sample.exposure, evaluateAnimatedNumber(clip.color.exposure, 280013));
  assert.deepEqual(sample.curves, clip.color.curves);
  assert.deepEqual(sample.hsl, clip.color.hsl);
  assert.equal(copyClipColor(document, "main", "b", 0).exposure, -1);
  assert.equal(copyClipColor(document, "main", "a", 2000000).exposure, 2);
  sample.curves[0]!.points[1]!.y = 0;
  sample.hsl[0]!.hueShift = 90;
  assert.deepEqual(document, before);
});

test("a color paste writes each target's exact current key, retains other keys and properties, and undoes once", () => {
  const document = colorDocument(), before = structuredClone(document), time = 280013,
    sample = copyClipColor(document, "main", "a", time), history = new EditorHistory(document),
    operations = pasteClipColor(document, "main", ["b", "c"], time, sample);
  history.apply(operations, document.revision, "粘贴当前调色");
  const after = history.read(), [a, b, c] = after.sequences[0]!.clips;
  assert.deepEqual(a, before.sequences[0]!.clips[0]);
  assert.equal(typeof b!.color.exposure, "object");
  if (typeof b!.color.exposure === "number") throw new Error("missing animation");
  const original = before.sequences[0]!.clips[1]!.color.exposure;
  if (typeof original === "number") throw new Error("missing fixture animation");
  assert.deepEqual(b!.color.exposure.keyframes[0], original.keyframes[0]);
  assert.deepEqual(b!.color.exposure.keyframes[2], original.keyframes[1]);
  assert.deepEqual(b!.color.exposure.keyframes[1], { time: 40013, value: sample.exposure, easing: "linear" });
  assert.equal(c!.color.exposure, sample.exposure);
  assert.deepEqual(b!.color.curves, sample.curves);
  assert.deepEqual(c!.color.hsl, sample.hsl);
  const originalB = structuredClone(before.sequences[0]!.clips[1]!); originalB.color = structuredClone(b!.color);
  assert.deepEqual(b, originalB, "only color changes");
  const sameTick = pasteClipColor(after, "main", ["b"], time, { ...sample, exposure: 0.8 });
  const again = applyEditorOperations(after, sameTick, after.revision).sequences[0]!.clips[1]!.color.exposure;
  if (typeof again === "number") throw new Error("missing animation");
  assert.equal(again.keyframes.length, 3);
  assert.equal(again.keyframes[1]!.value, 0.8);
  sample.curves[0]!.points[1]!.y = 0;
  assert.equal(b!.color.curves[0]!.points[1]!.y, 0.7);
  assert.deepEqual(document, before);
  history.undo();
  const undone = history.read(); undone.revision = before.revision;
  assert.deepEqual(undone, before);
  assert.equal(history.canUndo, false);
});

test("color samples match displayed clamps for positive and negative easing overshoot", () => {
  for (const [property, min, max] of [
    ["exposure", -10, 10], ["brightness", -1, 1], ["contrast", 0, 4], ["saturation", 0, 4],
    ["temperature", -1, 1], ["tint", -1, 1], ["hue", -360, 360],
  ] as const) for (const direction of [1, -1]) {
    const document = colorDocument(), clip = document.sequences[0]!.clips[0]!;
    clip.color[property] = { keyframes: [
      { time: 0, value: direction > 0 ? min : max, easing: { type: "cubic-bezier", x1: 1 / 3, y1: 4, x2: 2 / 3, y2: 4 } },
      { time: 100, value: direction > 0 ? max : min },
    ] };
    const sample = copyClipColor(document, "main", "a", 50);
    assert.equal(sample[property], direction > 0 ? max : min);
    const after = applyEditorOperations(document, pasteClipColor(document, "main", ["c"], 50, sample), document.revision);
    assert.equal(after.sequences[0]!.clips[2]!.color[property], sample[property]);
  }
});

test("explicit color reset clears all color animation, curves and HSL atomically and restores with one undo", () => {
  const before = colorDocument(), history = new EditorHistory(before), operations = resetClipColor(before, "main", ["a", "b"]);
  history.apply(operations, before.revision, "重置全部调色");
  for (const clip of history.read().sequences[0]!.clips.slice(0, 2)) assert.deepEqual(clip.color, defaultColorAdjustment());
  history.undo();
  const undone = history.read(); undone.revision = before.revision;
  assert.deepEqual(undone, before);
});

test("invalid, locked and audio targets reject the whole color batch without mutating input", () => {
  const document = colorDocument(), sample = copyClipColor(document, "main", "a", 0), before = structuredClone(document);
  for (const ids of [[], ["b", "b"], ["b", "missing"]]) assert.throws(() => pasteClipColor(document, "main", ids, 0, sample), /请选择|不存在/);
  assert.throws(() => pasteClipColor(document, "main", ["b"], 0.5, sample), /整数/);
  assert.throws(() => pasteClipColor(document, "main", ["b"], 0, { ...sample, exposure: document.sequences[0]!.clips[0]!.color.exposure }), /动画/);
  let getters = 0;
  const malformed = { ...sample };
  Object.defineProperty(malformed, "exposure", { enumerable: true, get() { getters++; return 1; } });
  assert.throws(() => pasteClipColor(document, "main", ["b"], 0, malformed), /访问器/);
  assert.equal(getters, 0);
  assert.deepEqual(document, before);
  const locked = structuredClone(document); locked.sequences[0]!.tracks[1]!.locked = true;
  assert.throws(() => pasteClipColor(locked, "main", ["a", "b"], 0, sample), /锁定/);
  assert.throws(() => resetClipColor(locked, "main", ["a", "b"]), /锁定/);
  const audio = structuredClone(document), sequence = audio.sequences[0]!;
  audio.assets.push({ id: "sound", name: "声音", kind: "audio", duration: 240000 });
  sequence.tracks.push(createTrack("audio", "audio"));
  sequence.clips.push({ id: "sound", label: "声音", kind: "media", trackId: "audio", assetId: "sound", start: 0, duration: 240000,
    transform: defaultTransform(), color: defaultColorAdjustment(), blendMode: "normal", audio: defaultAudioMix(),
    timeMap: { points: [{ time: 0, source: 0 }, { time: 240000, source: 240000 }] } });
  assert.throws(() => copyClipColor(audio, "main", "sound", 0), /声音/);
  assert.throws(() => pasteClipColor(audio, "main", ["a", "sound"], 0, sample), /声音/);
  assert.throws(() => resetClipColor(audio, "main", ["a", "sound"]), /声音/);
});
