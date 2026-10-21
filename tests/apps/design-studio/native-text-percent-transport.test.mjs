import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildNativeTextRangeSource, importNativeTextRanges, nativeTextRangeSnapshot }
  from "../../../apps/design-studio/app/native-text-ranges-source.mjs";
import { compareNativeTextRangeSources } from "../../../apps/design-studio/app/native-text-range-compare.mjs";
import { buildNativeTextRangeHint } from "../../../apps/design-studio/app/native-text-range-hint.mjs";
import { nativeTextLineHeight } from "../../../apps/design-studio/app/text-line-height.mjs";

const fixture = JSON.parse(await readFile(new URL("../../fixtures/design-studio/native-text-field-matrix-1ed86d39.json", import.meta.url), "utf8"));
const copy = value => structuredClone(value), val = value => ({ kind: "value", value });
const sha256 = value => createHash("sha256").update(value).digest("hex");
const codes = result => result.diagnostics.map(value => value.code);
function entry(index = 0) {
  const actual = fixture.cases[index];
  return { rest: copy(actual.rest), ...copy(actual.capture.observations), canonical: copy(actual.canonical) };
}
function bound(value) {
  const result = buildNativeTextRangeSource(value);
  assert.equal(result.status, "bound", JSON.stringify(result));
  return result.source;
}
function admission(value, canonical = value.canonical) {
  return importNativeTextRanges({ rest: value.rest, source: bound(value), canonicalNode: canonical });
}
// Synthetic inputs isolate a numerical transport boundary. These are not new
// SDK samples and do not simulate native glyphs or complete-writer LF behavior.
function setLine(value, observed, restUnit = observed.unit) {
  value.scalars.lineHeight = val(copy(observed));
  for (const segment of value.segments) segment.values.lineHeight = val(copy(observed));
  delete value.rest.style.lineHeightUnit;
  delete value.rest.style.lineHeightPercentFontSize;
  delete value.rest.style.lineHeightPx;
  if (restUnit === "PERCENT") Object.assign(value.rest.style,
    { lineHeightUnit: "FONT_SIZE_%", lineHeightPercentFontSize: Math.fround(observed.value) });
  if (restUnit === "PIXELS") Object.assign(value.rest.style, { lineHeightUnit: "PIXELS", lineHeightPx: observed.value });
  return value;
}
function adjacent(value, delta) {
  const buffer = new ArrayBuffer(8), view = new DataView(buffer);
  view.setFloat64(0, value); view.setBigUint64(0, view.getBigUint64(0) + BigInt(delta));
  return view.getFloat64(0);
}
function refused(value, canonical = value.canonical) {
  const before = JSON.stringify(value), result = admission(value, canonical);
  assert.equal(result.status, "unsupported", JSON.stringify(result));
  assert(codes(result).includes("NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS"));
  assert.equal(result.textRanges, undefined); assert.equal(result.pixelsVerified, false);
  assert.equal(JSON.stringify(value), before);
}

test("four unchanged actual SDK sources admit exact ratio transport and retain all raw snapshots including linked LF", () => {
  const snapshots = ["0b9482088473993c58742449955d44d5a088887bdaa04911e8e4622e2ac11cc3",
    "f51355aeb2f2162c99a30bbd1eceb56b8929e96193d32e15ce7b66f6de074f7e",
    "bee3fc0fba0f56f1b1c0e81a188a913cb794a5c778ab8882976474f3e07c32b3",
    "15fa8c8280136e025435a4789f9892cd676808085e3ddcdf873ed8a25342b24e"];
  assert.equal(fixture.provenance.sourceSha256, "6c59ea3aaa84a46546c0dac30d7ebe4cbe5021509d1c470970f1ff4ff72f9c8c");
  for (let index = 0; index < fixture.cases.length; index++) {
    const value = entry(index), before = JSON.stringify(value), source = bound(value), signature = source.restSignature;
    assert.equal(sha256(nativeTextRangeSnapshot(source)), snapshots[index]);
    const requested = nativeTextLineHeight(value.canonical), observed = source.scalars.lineHeight.value;
    assert.equal(observed.value, Math.fround(requested.value / 100) * 100);
    const imported = importNativeTextRanges({ rest: value.rest, source, canonicalNode: value.canonical });
    assert.equal(imported.status, index === 0 ? "uniform" : "admitted-intent");
    assert.equal(imported.pixelsVerified, false);
    if (index === 1 || index === 3) assert.deepEqual(imported.textRanges.ranges,
      [{ start: 4, end: 11, fill: "#1d70b8", href: "https://example.com/" }]);
    if (index === 2) assert.deepEqual(imported.textRanges.ranges, [{ start: 0, end: 14, fill: "#1d70b8" }]);
    assert.equal(source.restSignature, signature); assert.equal(sha256(nativeTextRangeSnapshot(source)), snapshots[index]);
    assert.equal(JSON.stringify(value), before);
  }
});

test("legacy exact percentages remain supported while percent-first Float32 and adjacent Double values refuse", () => {
  for (const ratio of [1, 1.2, 1.3158]) {
    const value = entry(); value.canonical.lineHeight = ratio;
    setLine(value, { unit: "PERCENT", value: nativeTextLineHeight(value.canonical).value });
    assert.equal(admission(value).status, "uniform");
  }
  const value = entry(3), requested = nativeTextLineHeight(value.canonical).value, actual = value.scalars.lineHeight.value.value;
  const incorrect = [Math.fround(requested), Math.fround(Math.fround(requested) / 100) * 100,
    adjacent(actual, 1), adjacent(actual, -1)];
  for (const number of incorrect) {
    assert.notEqual(number, actual); assert.notEqual(number, requested);
    const changed = entry(3); setLine(changed, { unit: "PERCENT", value: number }); refused(changed);
  }
});

test("PIXELS stays exact, physical unit equivalence never substitutes, and invalid canonical units or envelopes refuse", () => {
  const pixels = entry(); Object.assign(pixels.canonical, { lineHeight: 24.1, lineHeightUnit: "pixels" });
  setLine(pixels, { unit: "PIXELS", value: 24.1 }); assert.equal(admission(pixels).status, "uniform");
  for (const value of [Math.fround(24.1), adjacent(24.1, 1), adjacent(24.1, -1)]) {
    const changed = copy(pixels); setLine(changed, { unit: "PIXELS", value }); refused(changed);
  }
  const percent = entry();
  refused(percent, { ...percent.canonical, lineHeight: 24, lineHeightUnit: "pixels" });
  const physical = entry(); setLine(physical, { unit: "PIXELS", value: 24 }); refused(physical);
  for (const change of [{ lineHeightUnit: null }, { lineHeightUnit: "PERCENT" }, { lineHeight: "1.2" },
    { lineHeight: 0.699999999 }, { lineHeight: 3.000000001 }]) refused(entry(), { ...entry().canonical, ...change });
  const lower = entry(); lower.canonical.lineHeight = .7;
  setLine(lower, { unit: "PERCENT", value: Math.fround(.7) * 100 });
  assert(lower.scalars.lineHeight.value.value < 70); assert.equal(admission(lower).status, "uniform");
  for (const observed of [{ unit: "FUTURE", value: 120 }, { unit: "PERCENT", value: "120" }, { unit: null, value: 120 }]) {
    const changed = entry(); setLine(changed, observed, null); refused(changed);
  }
  for (const number of [NaN, Infinity, -Infinity]) {
    const changed = entry(); setLine(changed, { unit: "PERCENT", value: number }, null);
    assert.equal(buildNativeTextRangeSource(changed).status, "invalid");
    const original = entry(), source = bound(original);
    assert.equal(importNativeTextRanges({ rest: original.rest, source,
      canonicalNode: { ...original.canonical, lineHeight: number } }).status, "unsupported");
  }
});

test("canonical bucket mismatches refuse without fitting four-decimal bridge ratios or inferring authored metrics", () => {
  const arbitrary = entry(), requestedRatio = 1.23456789;
  arbitrary.canonical.lineHeight = requestedRatio;
  setLine(arbitrary, { unit: "PERCENT", value: Math.fround(requestedRatio * 100 / 100) * 100 });
  assert.equal(admission(arbitrary).status, "uniform");
  refused(arbitrary, { ...arbitrary.canonical, lineHeight: 1.2346 });
  refused(entry(), { ...entry().canonical, lineHeight: 1.200001 });
  const blue = entry(2), source = bound(blue);
  for (const ratio of [1.2, 1.200000001]) {
    const canonical = { ...blue.canonical, lineHeight: ratio, textRanges: { version: 1,
      sourceSignature: JSON.stringify([blue.characters]), ranges: [{ start: 0, end: 14, fill: "#1d70b8" }] } };
    assert.equal(admission(blue, canonical).status, "admitted-intent");
    const hint = buildNativeTextRangeHint({ rest: blue.rest, source, authorNode: canonical,
      pluginId: "transport-test", key: "codeshellTextRangeIntent" });
    assert.deepEqual(Object.keys(hint).sort(), ["fill", "nodeId", "snapshot", "textRanges", "version"]);
  }
});

test("raw uniformity and snapshot conflicts stay exact even for individually admissible transport forms", () => {
  const mixed = entry(1), transport = mixed.scalars.lineHeight.value.value;
  mixed.scalars.lineHeight = { kind: "mixed" };
  for (const [index, segment] of mixed.segments.entries()) segment.values.lineHeight = val({ unit: "PERCENT", value: index === 1 ? transport : 120 });
  mixed.rest.style.lineHeightPercentFontSize = 120;
  Object.assign(mixed.rest.styleOverrideTable[3], { lineHeightUnit: "FONT_SIZE_%", lineHeightPercentFontSize: Math.fround(transport) });
  refused(mixed);
  const original = entry(), changed = entry(), raw = adjacent(changed.scalars.lineHeight.value.value, 1);
  setLine(changed, { unit: "PERCENT", value: raw });
  const firstSource = bound(original), secondSource = bound(changed);
  assert.notEqual(nativeTextRangeSnapshot(firstSource), nativeTextRangeSnapshot(secondSource));
  const result = compareNativeTextRangeSources({ expectedRest: { ...original.rest, codeshellNativeTextRanges: firstSource },
    currentRest: { ...changed.rest, codeshellNativeTextRanges: secondSource } });
  assert.equal(result.status, "changed"); assert(codes(result).includes("NATIVE_TEXT_SOURCE_COMPARE_SNAPSHOT_CHANGED"));
});

test("native percentage corroboration does not relax font axes, spacing, alignment, shaping or decoration gates", () => {
  for (const change of [{ fontFamily: "Other" }, { fontSize: 20.000001 }, { fontWeight: 700 }, { fontStyle: "italic" },
    { letterSpacing: 0.000001 }, { textAlign: "right" }]) refused(entry(), { ...entry().canonical, ...change });
  for (const [field, value] of [["fontName", { family: "Inter", style: "Regular", variationSettings: { wght: 400, slnt: 8 } }],
    ["openTypeFeatures", { liga: 0 }], ["textDecorationOffset", { unit: "PERCENT", value: 15.779999732971191 }]]) {
    const changed = entry(); changed.scalars[field] = val(copy(value));
    for (const segment of changed.segments) segment.values[field] = val(copy(value));
    for (const check of changed.rangeChecks) if (Object.hasOwn(check.values, field)) check.values[field] = val(copy(value));
    const result = admission(changed);
    assert.equal(result.status, "unsupported"); assert.equal(result.textRanges, undefined); assert.equal(result.pixelsVerified, false);
  }
});
