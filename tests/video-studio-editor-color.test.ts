import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultColorAdjustment } from "../apps/video-studio/src/editor/defaults";
import {
  applyColorToRgba,
  evaluateColorCurve,
  hasColorAdjustment,
  type ResolvedColorAdjustment,
} from "../apps/video-studio/src/editor/color";

const defaults = () => defaultColorAdjustment() as ResolvedColorAdjustment;
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
