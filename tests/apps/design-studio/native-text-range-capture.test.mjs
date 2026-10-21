import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import { captureNativeTextRangeObservations } from "../../../apps/design-studio/app/figma-plugin/text-range-capture.mjs";

const mixed = Symbol("native mixed");
const fields = ["fontName", "fills", "hyperlink", "textDecorationOffset"];
function fixture(characters = "A\u00a0😀\nlink") {
  const segments = [
    { start: 0, end: 5, characters: characters.slice(0, 5), fontName: { family: "Inter", style: "Regular" }, fills: [{ type: "SOLID", color: { r: Math.fround(26 / 255), g: 0, b: 1 } }], hyperlink: null, textDecorationOffset: null },
    { start: 5, end: characters.length, characters: characters.slice(5), fontName: { family: "Inter", style: "Regular" }, fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1 } }], hyperlink: { type: "URL", value: "https://example.com/" }, textDecorationOffset: { unit: "PERCENT", value: 15.779999732971191 } },
  ];
  const node = {
    type: "TEXT", characters, fontName: { family: "Inter", style: "Regular" }, fills: mixed, hyperlink: mixed,
    textDecorationOffset: mixed, hasMissingFont: false,
    getStyledTextSegments(requested) { assert.deepEqual(requested, fields); return segments; },
    getRangeHyperlink(start) { return start === 0 ? 1 : { type: "URL", value: "https://example.com/" }; },
    getRangeTextDecorationOffset(start) { return start === 0 ? null : { unit: "PERCENT", value: 15.779999732971191 }; },
    getRangeTextDecorationThickness() { throw Error("SDK unavailable"); },
  };
  return { node, segments };
}
const capture = node => captureNativeTextRangeObservations(node, mixed, { fields, scalarFields: ["hasMissingFont"] });

test("native capture keeps exact authored UTF16, floats, mixed/null/missing/error and numeric1 as owned data", () => {
  const { node, segments } = fixture(), before = JSON.stringify(segments);
  const result = capture(node);
  assert.equal(result.status, "captured");
  const { observations } = result;
  assert.equal(observations.characters, "A\u00a0😀\nlink");
  assert.deepEqual(observations.scalars.fills, { kind: "mixed" });
  assert.deepEqual(observations.scalars.hasMissingFont, { kind: "value", value: false });
  assert.deepEqual(observations.rangeChecks[0].values.hyperlink, { kind: "value", value: 1 });
  assert.deepEqual(observations.rangeChecks[0].values.textDecorationOffset, { kind: "value", value: null });
  assert.deepEqual(observations.rangeChecks[0].values.textDecorationStyle, { kind: "missing" });
  assert.deepEqual(observations.rangeChecks[0].values.textDecorationThickness, { kind: "error", message: "SDK unavailable" });
  assert.equal(observations.segments[1].values.textDecorationOffset.value.value, 15.779999732971191);
  assert.deepEqual(JSON.parse(JSON.stringify(observations)), observations);
  observations.segments[0].values.fills.value[0].color.r = 1;
  assert.equal(JSON.stringify(segments), before);
});

test("native capture never calls nested accessors/toJSON and records unsupported host values explicitly", () => {
  const { node, segments } = fixture();
  let called = 0;
  const bad = {};
  Object.defineProperty(bad, "color", { enumerable: true, get() { called++; return "red"; } });
  segments[0].fills = bad;
  segments[1].fills = { toJSON() { called++; return []; } };
  const result = capture(node);
  assert.equal(result.status, "captured");
  assert.equal(result.observations.segments[0].values.fills.kind, "error");
  assert.equal(result.observations.segments[1].values.fills.kind, "error");
  assert.equal(called, 0);
  assert.equal(captureNativeTextRangeObservations(node, undefined, { fields }).status, "unsupported");
});

test("native capture refuses gaps, overlap, wrong substrings, scalar splits and incomplete segment budgets atomically", () => {
  for (const change of [segments => segments[0].end = 3, segments => segments[1].start = 4,
    segments => segments[1].characters = "other", segments => segments[1].end = 99]) {
    const { node, segments } = fixture(); change(segments);
    const result = capture(node); assert.equal(result.status, "unsupported"); assert.equal(result.observations, undefined);
  }
  const split = fixture();
  split.node.getStyledTextSegments = () => [
    { start: 0, end: 3, characters: split.node.characters.slice(0, 3) },
    { start: 3, end: split.node.characters.length, characters: split.node.characters.slice(3) },
  ];
  assert.equal(capture(split.node).status, "unsupported");
  const excessive = fixture(); excessive.node.getStyledTextSegments = () => Array(257).fill({});
  assert.equal(capture(excessive.node).status, "unsupported");
  excessive.node.characters = "x".repeat(4001);
  assert.equal(capture(excessive.node).status, "unsupported");
});

test("native capture rejects capture races and whole-call SDK failure without a partial source", () => {
  const race = fixture(); let reads = 0;
  Object.defineProperty(race.node, "characters", { get: () => ++reads === 1 ? "A\u00a0😀\nlink" : "changed" });
  const result = capture(race.node);
  assert.equal(result.status, "unsupported"); assert.equal(result.observations, undefined);
  assert.equal(result.diagnostics.at(-1).code, "NATIVE_TEXT_CAPTURE_RACE");
  const failure = fixture(); failure.node.getStyledTextSegments = () => { throw Error("Unsupported property"); };
  assert.equal(capture(failure.node).diagnostics.at(-1).code, "NATIVE_TEXT_CAPTURE_SEGMENTS");
});

test("native capture applies the complete UTF8 payload budget without truncating a styled suffix", () => {
  const { node, segments } = fixture();
  for (const segment of segments) segment.fontName = { family: "界".repeat(50000), style: "Regular" };
  const result = capture(node);
  assert.equal(result.status, "unsupported"); assert.equal(result.observations, undefined);
  assert.equal(result.diagnostics.at(-1).code, "NATIVE_TEXT_CAPTURE_BUDGET");
});

test("returned segment accessors and iterators never execute; foreign error accessors remain unread", () => {
  let calls = 0;
  for (const field of ["start", "fills"]) {
    const { node, segments } = fixture();
    Object.defineProperty(segments[0], field, { enumerable: true, get() { calls++; return 0; } });
    assert.equal(capture(node).status, "unsupported");
  }
  const iterator = fixture();
  iterator.segments[Symbol.iterator] = function* () { calls++; yield* []; };
  assert.equal(capture(iterator.node).status, "unsupported");
  const failure = fixture(), thrown = {};
  for (const field of ["message", "code"]) Object.defineProperty(thrown, field, { get() { calls++; return "budget"; } });
  failure.node.getRangeHyperlink = () => { throw thrown; };
  const result = capture(failure.node);
  assert.equal(result.status, "captured");
  assert.deepEqual(result.observations.rangeChecks[0].values.hyperlink, { kind: "error", message: "Native getter failed" });
  assert.equal(calls, 0);
});

test("an individual observation budget error refuses the whole source, while an SDK error with matching code remains an observation", () => {
  const excessive = fixture(); excessive.node.hyperlink = "x".repeat(256 * 1024 + 1);
  const result = capture(excessive.node);
  assert.equal(result.status, "unsupported"); assert.equal(result.observations, undefined);
  assert.equal(result.diagnostics.at(-1).code, "NATIVE_TEXT_CAPTURE_BUDGET");
  const sdk = fixture();
  sdk.node.getRangeHyperlink = () => { throw Object.assign(Error("Native budget message"), { code: "NATIVE_TEXT_CAPTURE_BUDGET" }); };
  const observed = capture(sdk.node);
  assert.equal(observed.status, "captured");
  assert.deepEqual(observed.observations.rangeChecks[0].values.hyperlink, { kind: "error", message: "Native budget message" });
  const repeated = fixture(); let suffixReads = 0;
  repeated.node.fontName = "x".repeat(140000);
  repeated.node.fills = "x".repeat(140000);
  Object.defineProperty(repeated.node, "hyperlink", { get() { suffixReads++; return null; } });
  assert.equal(capture(repeated.node).status, "unsupported");
  assert.equal(suffixReads, 0, "aggregate budget refuses before reading and serializing remaining values");
});

test("native capture works without DOM helpers and preserves an exact empty source", async () => {
  const source = await readFile(new URL("../../../apps/design-studio/app/figma-plugin/text-range-capture.mjs", import.meta.url), "utf8");
  const context = vm.createContext({ URL: undefined, TextEncoder: undefined, structuredClone: undefined });
  vm.runInContext(`${source.replace(/export /gu, "")}\nresult=captureNativeTextRangeObservations({type:'TEXT',characters:'',getStyledTextSegments:()=>[]},Symbol('mixed'),{fields:['fills']});`, context);
  assert.equal(context.result.status, "captured");
  assert.equal(context.result.observations.characters, "");
  assert.equal(context.result.observations.segments.length, 0);
  assert.equal(context.result.observations.scalars.fills.kind, "missing");
});
