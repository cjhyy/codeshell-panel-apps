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

test("grading is byte-identical across image chunk sizes and unaligned buffer views", () => {
  const points = Array.from({ length: 256 }, (_, index) => ({
    x: index / 255, y: ((index * 73 + 31) % 256) / 255,
  }));
  const presets: Partial<ResolvedColorAdjustment>[] = [
    { exposure: 1 },
    { brightness: -0.314159, contrast: 1.7, temperature: 0.27, tint: -0.88 },
    { exposure: -10, contrast: 4, brightness: -1 },
    { exposure: 10, contrast: 0, brightness: 0.002 },
    { curves: ["rgb", "red", "green", "blue"].map((channel) => ({
      channel: channel as "rgb" | "red" | "green" | "blue", points,
    })) },
    { exposure: 0.23, curves: [{ channel: "rgb", points: [
      { x: 0, y: 0.1 }, { x: 0.5, y: 0.2 }, { x: 1, y: 0.8 },
    ] }, { channel: "red", points: [{ x: 0, y: 1 }, { x: 1, y: 0 }] }] },
    { hue: 120, saturation: 0.7 },
    { hsl: [{ hue: 0, width: 0.001, hueShift: 180, saturation: 1, lightness: -0.2 }] },
  ];
  for (const settings of presets) for (const count of [1023, 1024, 4096]) {
    const color = { ...defaults(), ...settings }, beforeColor = structuredClone(color),
      storage = new Uint8ClampedArray(count * 4 + 11).fill(77),
      pixels = storage.subarray(5, 5 + count * 4);
    // Every channel sees all byte values under transparent, faint and opaque alpha.
    for (let index = 0; index < count; index++) pixels.set([
      index % 256, (index * 73 + 31) % 256, (index * 151 + 79) % 256,
      [0, 1, 127, 255][Math.floor(index / 256) % 4]!,
    ], index * 4);
    const input = pixels.slice();
    applyColorToRgba(pixels, color);
    for (const chunkSize of [1, 73, 257]) {
      const chunked = input.slice();
      for (let index = 0; index < count; index += chunkSize)
        applyColorToRgba(chunked.subarray(index * 4, Math.min(count, index + chunkSize) * 4), color);
      assert.deepEqual(pixels, chunked, `grade must not depend on a ${chunkSize}-pixel chunk boundary`);
    }
    assert.deepEqual([...storage.subarray(0, 5)], Array(5).fill(77));
    assert.deepEqual([...storage.subarray(5 + count * 4)], Array(6).fill(77));
    assert.deepEqual(color, beforeColor);
  }
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

// Captured from the scalar color.ts at f72b047, before either grading optimization.
const hslReferenceRgb = [[255,0,0],[255,255,0],[0,255,0],[0,255,255],[0,0,255],[255,0,255],[255,0,1],[255,1,0],[127,128,129],[128,128,128],[0,0,0],[255,255,255],[1,0,0],[0,1,0],[0,0,1],[129,64,32],[25,50,200],[73,254,199],[254,73,199],[199,73,254]];
const hslReferenceCases: Array<{ name: string; settings: Partial<ResolvedColorAdjustment>; expected: string }> = [
  { name: "global hue and saturation", settings: {"hue":-360,"saturation":0.7,"exposure":0.23,"brightness":-0.1,"contrast":1.15,"temperature":0.1,"tint":-0.3,"curves":[{"channel":"rgb","points":[{"x":0,"y":0.1},{"x":0.4,"y":0.7},{"x":1,"y":0.85}]},{"channel":"red","points":[{"x":0,"y":1},{"x":0.5,"y":0.2},{"x":1,"y":0}]}]},
    expected: "/wAAABNTUwETU1N/E1NT////AAATz1MBE89TfxPPU/8A/wAAes9TAXrPU396z1P/AP//AHrPzwF6z89/es/P/wAA/wB6U88BelPPf3pTz///AP8AE1PPARNTz38TU8///wABABNTUwETU1N/E1NT//8BAAATU1MBE1NTfxNTU/9/gIEAHLu4ARy7uH8cu7j/gICAABy7twEcu7d/HLu3/wAAAADWGhoB1hoaf9YaGv////8AD9nZAQ/Z2X8P2dn/AQAAANYaGgHWGhp/1hoa/wABAADWGhoB1hoaf9YaGv8AAAEA1hoaAdYaGn/WGhr/gUAgAB5oNgEeaDZ/Hmg2/xkyyACKZcYBimXGf4plxv9J/scAKtHJASrRyX8q0cn//knHABKfyQESn8l/Ep/J/8dJ/gAVn9EBFZ/RfxWf0f8=" },
  { name: "zero and full-turn seam", settings: {"hue":360,"saturation":1.1,"hsl":[{"hue":0,"width":360,"hueShift":120,"saturation":0.17,"lightness":-0.06},{"hue":360,"width":0.001,"hueShift":-180,"saturation":1,"lightness":-0.2}],"curves":[{"channel":"rgb","points":[{"x":0,"y":0.1},{"x":0.4,"y":0.7},{"x":1,"y":0.85}]},{"channel":"red","points":[{"x":0,"y":1},{"x":0.5,"y":0.2},{"x":1,"y":0}]}]},
    expected: "/wAAAB0auAEdGrh/HRq4////AADW07YB1tO2f9bTtv8A/wAA1te4AdbXuH/W17j/AP//ANbZ2QHW2dl/1tnZ/wAA/wAcGtcBHBrXfxwa1///AP8AErYaARK2Gn8Sthr//wABANTRGgHU0Rp/1NEa//8BAADW0RsB1tEbf9bRG/9/gIEAHLm5ARy5uX8cubn/gICAABy5uQEcubl/HLm5/wAAAADWGhoB1hoaf9YaGv////8AD9nZAQ/Z2X8P2dn/AQAAANYaGgHWGhp/1hoa/wABAADWGhoB1hoaf9YaGv8AAAEA1hoaAdYaGn/WGhr/gUAgALu3VwG7t1d/u7dX/xkyyABLLM0BSyzNf0sszf9J/scAMdnNATHZzX8x2c3//knHABDZXQEQ2V1/ENld/8dJ/gAPaogBD2qIfw9qiP8=" },
  { name: "minimum-width bands", settings: {"hsl":[{"hue":0,"width":0.001,"hueShift":-180,"saturation":-1,"lightness":-1},{"hue":60,"width":0.001,"hueShift":180,"saturation":1,"lightness":1},{"hue":120,"width":0.001,"hueShift":-180,"saturation":-1,"lightness":-1},{"hue":180,"width":0.001,"hueShift":180,"saturation":1,"lightness":1},{"hue":240,"width":0.001,"hueShift":-180,"saturation":-1,"lightness":-1},{"hue":300,"width":0.001,"hueShift":180,"saturation":1,"lightness":1},{"hue":360,"width":0.001,"hueShift":-180,"saturation":-1,"lightness":-1}]},
    expected: "/wAAAAAAAAEAAAB/AAAA////AAD///8B////f/////8A/wAAAAAAAQAAAH8AAAD/AP//AP///wH///9//////wAA/wAAAAABAAAAfwAAAP//AP8A////Af///3///////wABAP8AAQH/AAF//wAB//8BAAD/AQAB/wEAf/8BAP9/gIEAf4CBAX+AgX9/gIH/gICAAICAgAGAgIB/gICA/wAAAAAAAAABAAAAfwAAAP////8A////Af///3//////AQAAAAAAAAEAAAB/AAAA/wABAAAAAAABAAAAfwAAAP8AAAEAAAAAAQAAAH8AAAD/gUAgAIFAIAGBQCB/gUAg/xkyyAAZMsgBGTLIfxkyyP9J/scASf7HAUn+x39J/sf//knHAP5JxwH+Scd//knH/8dJ/gDHSf4Bx0n+f8dJ/v8=" },
  { name: "band endpoints", settings: {"hsl":[{"hue":30,"width":60,"hueShift":120,"saturation":0.17,"lightness":-0.06},{"hue":330,"width":60,"hueShift":-120,"saturation":0.17,"lightness":-0.06}],"curves":[{"channel":"rgb","points":[{"x":0,"y":0.1},{"x":0.4,"y":0.7},{"x":1,"y":0.85}]},{"channel":"red","points":[{"x":0,"y":1},{"x":0.5,"y":0.2},{"x":1,"y":0}]}]},
    expected: "/wAAAA8aGgEPGhp/Dxoa////AAAP2RoBD9kafw/ZGv8A/wAA1tkaAdbZGn/W2Rr/AP//ANbZ2QHW2dl/1tnZ/wAA/wDWGtkB1hrZf9Ya2f//AP8ADxrZAQ8a2X8PGtn//wABAA8aGwEPGht/Dxob//8BAAAPGxoBDxsafw8bGv9/gIEAHLm5ARy5uX8cubn/gICAABy5uQEcubl/HLm5/wAAAADWGhoB1hoaf9YaGv////8AD9nZAQ/Z2X8P2dn/AQAAANQaGgHUGhp/1Boa/wABAADWGxoB1hsaf9YbGv8AAAEA1hobAdYaG3/WGhv/gUAgAHu3NgF7tzZ/e7c2/xkyyACaZMsBmmTLf5pky/9J/scAMNnLATDZy38w2cv//knHAFpw2QFacNl/WnDZ/8dJ/gAVh9kBFYfZfxWH2f8=" },
  { name: "legacy negative turns", settings: {"hsl":[{"hue":-720,"width":60,"hueShift":120,"saturation":0.17,"lightness":-0.06},{"hue":-1e-10,"width":60,"hueShift":120,"saturation":0.17,"lightness":-0.06}]},
    expected: "/wAAAAAAwgEAAMJ/AADC////AAD//wAB//8Af///AP8A/wAAAP8AAQD/AH8A/wD/AP//AAD//wEA//9/AP///wAA/wAAAP8BAAD/fwAA////AP8A/wD/Af8A/3//AP///wABAAABwgEAAcJ/AAHC//8BAAABAMIBAQDCfwEAwv9/gIEAf4CBAX+AgX9/gIH/gICAAICAgAGAgIB/gICA/wAAAAAAAAABAAAAfwAAAP////8A////Af///3//////AQAAAAAAAAEAAAB/AAAA/wABAAAAAQABAAEAfwABAP8AAAEAAAABAQAAAX8AAAH/gUAgAFZ7FgFWexZ/VnsW/xkyyAAZMsgBGTLIfxkyyP9J/scASf7HAUn+x39J/sf//knHAP5JxwH+Scd//knH/8dJ/gDHSf4Bx0n+f8dJ/v8=" },
  { name: "legacy positive turns", settings: {"hsl":[{"hue":720,"width":60,"hueShift":120,"saturation":0.17,"lightness":-0.06},{"hue":1080,"width":60,"hueShift":120,"saturation":0.17,"lightness":-0.06}]},
    expected: "/wAAAAAAwgEAAMJ/AADC////AAD//wAB//8Af///AP8A/wAAAP8AAQD/AH8A/wD/AP//AAD//wEA//9/AP///wAA/wAAAP8BAAD/fwAA////AP8A/wD/Af8A/3//AP///wABAAABwgEAAcJ/AAHC//8BAAABAMIBAQDCfwEAwv9/gIEAf4CBAX+AgX9/gIH/gICAAICAgAGAgIB/gICA/wAAAAAAAAABAAAAfwAAAP////8A////Af///3//////AQAAAAAAAAEAAAB/AAAA/wABAAAAAQABAAEAfwABAP8AAAEAAAABAQAAAX8AAAH/gUAgAFZ7FgFWexZ/VnsW/xkyyAAZMsgBGTLIfxkyyP9J/scASf7HAUn+x39J/sf//knHAP5JxwH+Scd//knH/8dJ/gDHSf4Bx0n+f8dJ/v8=" },
  { name: "legacy just beyond full turn", settings: {"hsl":[{"hue":360.00000000000006,"width":60,"hueShift":120,"saturation":0.17,"lightness":-0.06}]},
    expected: "/wAAAADgAAEA4AB/AOAA////AAD//wAB//8Af///AP8A/wAAAP8AAQD/AH8A/wD/AP//AAD//wEA//9/AP///wAA/wAAAP8BAAD/fwAA////AP8A/wD/Af8A/3//AP///wABAAHgAAEB4AB/AeAA//8BAAAA4AEBAOABfwDgAf9/gIEAf4CBAX+AgX9/gIH/gICAAICAgAGAgIB/gICA/wAAAAAAAAABAAAAfwAAAP////8A////Af///3//////AQAAAAAAAAEAAAB/AAAA/wABAAAAAQABAAEAfwABAP8AAAEAAAABAQAAAX8AAAH/gUAgAH5vGwF+bxt/fm8b/xkyyAAZMsgBGTLIfxkyyP9J/scASf7HAUn+x39J/sf//knHAP5JxwH+Scd//knH/8dJ/gDHSf4Bx0n+f8dJ/v8=" },
  { name: "legacy NaN hue", settings: {"hsl":[{"hue":NaN,"width":60,"hueShift":120,"saturation":0.17,"lightness":-0.06}],"curves":[{"channel":"rgb","points":[{"x":0,"y":0.1},{"x":0.4,"y":0.7},{"x":1,"y":0.85}]},{"channel":"red","points":[{"x":0,"y":1},{"x":0.5,"y":0.2},{"x":1,"y":0}]}]},
    expected: "/wAAAAAAAAEAAAB/AAAA////AAAAAAABAAAAfwAAAP8A/wAAAAAAAQAAAH8AAAD/AP//AAAAAAEAAAB/AAAA/wAA/wAAAAABAAAAfwAAAP//AP8AAAAAAQAAAH8AAAD//wABAAAAAAEAAAB/AAAA//8BAAAAAAABAAAAfwAAAP9/gIEAAAAAAQAAAH8AAAD/gICAABy5uQEcubl/HLm5/wAAAADWGhoB1hoaf9YaGv////8AD9nZAQ/Z2X8P2dn/AQAAAAAAAAEAAAB/AAAA/wABAAAAAAABAAAAfwAAAP8AAAEAAAAAAQAAAH8AAAD/gUAgAAAAAAEAAAB/AAAA/xkyyAAAAAABAAAAfwAAAP9J/scAAAAAAQAAAH8AAAD//knHAAAAAAEAAAB/AAAA/8dJ/gAAAAABAAAAfwAAAP8=" },
];

test("HSL grading retains scalar reference bytes at wrap, alpha and image-size boundaries", () => {
  const sample = Uint8ClampedArray.from(hslReferenceRgb.flatMap((rgb) =>
    [0, 1, 127, 255].flatMap((alpha) => [...rgb, alpha])));
  for (const entry of hslReferenceCases) for (const count of [80, 1023, 1024, 4096]) {
    const color = { ...defaults(), ...entry.settings }, beforeColor = structuredClone(color),
      reference = Buffer.from(entry.expected, "base64"),
      storage = new Uint8ClampedArray(count * 4 + 7).fill(77),
      pixels = storage.subarray(3, 3 + count * 4);
    for (let index = 0; index < pixels.length; index++) pixels[index] = sample[index % sample.length]!;
    applyColorToRgba(pixels, color);
    for (let index = 0; index < pixels.length; index++)
      assert.equal(pixels[index], reference[index % reference.length], entry.name + " byte " + index);
    assert.deepEqual([...storage.subarray(0, 3)], [77, 77, 77]);
    assert.deepEqual([...storage.subarray(3 + count * 4)], [77, 77, 77, 77]);
    assert.deepEqual(color, beforeColor);
  }
});

test("grading reads mutable curves and bounded-band eligibility anew on every call", () => {
  const color = { ...defaults(), ...structuredClone(hslReferenceCases[1]!.settings) },
    sample = Uint8ClampedArray.from(hslReferenceRgb.flatMap((rgb) => [...rgb, 255]));
  const first = sample.slice();
  applyColorToRgba(first, color);
  color.hsl[0]!.hue = 720;
  color.hsl[0]!.hueShift = -90;
  color.curves[0]!.points[1]!.y = 0.1;
  color.curves[1]!.points = [{ x: 0, y: 0.3 }, { x: 1, y: 0.9 }];
  const changed = sample.slice(), fresh = sample.slice();
  applyColorToRgba(changed, color);
  applyColorToRgba(fresh, structuredClone(color));
  assert.notDeepEqual(changed, first);
  assert.deepEqual(changed, fresh);
  color.hsl[0]!.hue = 0;
  const boundedAgain = sample.slice(), freshAgain = sample.slice();
  applyColorToRgba(boundedAgain, color);
  applyColorToRgba(freshAgain, structuredClone(color));
  assert.deepEqual(boundedAgain, freshAgain);
});
