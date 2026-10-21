import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { buildNativeTextRangeSource, validateNativeTextRangeSource, importNativeTextRanges,
  nativeTextRangeSnapshot } from "../../../apps/design-studio/app/native-text-ranges-source.mjs";

const fixture = JSON.parse(await readFile(new URL("../../fixtures/design-studio/native-text-field-matrix-1ed86d39.json", import.meta.url)));
const copy = value => structuredClone(value), val = value => ({ kind: "value", value });
const input = entry => ({ rest: copy(entry.rest), ...copy(entry.capture.observations) });
const codes = result => result.diagnostics.map(note => note.code);
function bound(value) {
  const built = buildNativeTextRangeSource(value);
  assert.equal(built.status, "bound", JSON.stringify(built));
  return built;
}

test("actual1ed86d39 four complete sources bind and recover intent with exact native metric transport", () => {
  assert.equal(fixture.provenance.sourceSha256, "6c59ea3aaa84a46546c0dac30d7ebe4cbe5021509d1c470970f1ff4ff72f9c8c");
  assert.equal(fixture.cases.length, 4);
  for (const entry of fixture.cases) {
    const before = JSON.stringify(entry), value = input(entry), built = bound(value);
    assert.equal(entry.capture.status, "captured");
    assert.equal(entry.built.status, "invalid"); // Preserve the original research outcome.
    assert(codes(entry.built).includes("NATIVE_TEXT_RANGES_CAPTURE_RACE"));
    for (const field of ["characters", "scalars", "segments", "rangeChecks"])
      assert.deepEqual(built.source[field], entry.capture.observations[field]);
    assert.equal(value.rest.style.lineHeightPercentFontSize, Math.fround(built.source.scalars.lineHeight.value.value));
    assert.notEqual(value.rest.style.lineHeightPercentFontSize, built.source.scalars.lineHeight.value.value);
    for (const field of ["fontStyle", "listOptions", "indentation", "textStyleOverrides"]) {
      assert.deepEqual(built.source.scalars[field], { kind: "missing" });
      assert(built.source.segments.every(segment => segment.values[field].kind === "value"));
      assert(built.diagnostics.some(note => note.code === "NATIVE_TEXT_RANGES_SCALAR_OBSERVATION" && note.field === field));
    }
    const imported = importNativeTextRanges({ rest: value.rest, source: built.source, canonicalNode: entry.canonical });
    assert.equal(imported.status, entry.name === "plain20" ? "uniform" : "admitted-intent");
    assert.equal(imported.pixelsVerified, false);
    if (entry.variant.kind === "gap") assert.deepEqual(imported.textRanges.ranges,
      [{ start: 4, end: 11, fill: "#1d70b8", href: "https://example.com/" }]);
    assert.deepEqual(validateNativeTextRangeSource(value.rest, JSON.parse(JSON.stringify(built.source))).source, built.source);
    assert.equal(JSON.stringify(entry), before);
  }
});

test("REST PERCENT projection accepts only exact live or exact Float32 transport; units, pixels and other metrics stay strict", () => {
  const original = input(fixture.cases[0]);
  const exact = copy(original); exact.rest.style.lineHeightPercentFontSize = exact.scalars.lineHeight.value.value;
  bound(exact);
  for (const mutate of [
    value => value.rest.style.lineHeightPercentFontSize += 1e-8,
    value => value.rest.style.lineHeightPercentFontSize += 1,
    value => value.rest.style.fontSize++,
    value => value.rest.style.fontWeight = 500,
    value => value.rest.style.letterSpacing = .01,
    value => value.rest.style.textAlignHorizontal = "RIGHT",
    value => value.rest.style.lineHeightUnit = "PIXELS",
    value => { value.scalars.lineHeight.value.value = String(value.scalars.lineHeight.value.value);
      for (const segment of value.segments) segment.values.lineHeight.value.value = value.scalars.lineHeight.value.value; },
    value => { value.rest.style.lineHeightUnit = "PIXELS"; value.rest.style.lineHeightPx = Math.fround(24.1);
      value.scalars.lineHeight = val({ unit: "PIXELS", value: 24.1 });
      for (const segment of value.segments) segment.values.lineHeight = val({ unit: "PIXELS", value: 24.1 }); },
  ]) {
    const value = copy(original); mutate(value); const before = JSON.stringify(value);
    const result = buildNativeTextRangeSource(value);
    assert.equal(result.status, "invalid"); assert(codes(result).includes("NATIVE_TEXT_RANGES_CAPTURE_RACE"));
    assert.equal(result.source, undefined); assert.equal(JSON.stringify(value), before);
  }
});

test("actual REST scalar indices retain UTF16 range boundaries, trailing defaults and authored LF without shifting color/link", () => {
  for (const entry of fixture.cases.filter(value => value.variant.kind === "gap")) {
    const value = input(entry), built = bound(value), middle = built.source.segments[1];
    assert.equal(value.characters, "A😀 linked\nend"); assert.equal(value.characters.length, 14);
    assert.equal(Array.from(value.characters).length, 13);
    assert.deepEqual([middle.start, middle.end, middle.characters], [4, 11, "linked\n"]);
    assert.deepEqual(value.rest.characterStyleOverrides, [0, 0, 0, 3, 3, 3, 3, 3, 3, 3]);
    assert.equal(built.source.rangeChecks[0].values.hyperlink.value, 1);
    assert.equal(middle.values.hyperlink.value.value, "https://example.com/");
    // Wrong UTF16-indexed REST arrays were the prior test-fixture assumption.
    const wrong = copy(value);
    wrong.rest.characterStyleOverrides = [0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3];
    assert(codes(buildNativeTextRangeSource(wrong)).includes("NATIVE_TEXT_RANGES_CAPTURE_RACE"));
    const tooLong = copy(value); tooLong.rest.characterStyleOverrides = Array(14).fill(0);
    assert.equal(buildNativeTextRangeSource(tooLong).status, "invalid");
    const wrongTail = copy(value); wrongTail.rest.characterStyleOverrides.push(3);
    assert(codes(buildNativeTextRangeSource(wrongTail)).includes("NATIVE_TEXT_RANGES_CAPTURE_RACE"));
  }
});

test("synthetic scalar-index control counts combining marks, NBSP and LF individually while surrogate pairs remain one REST entry", () => {
  for (const selected of [0, 1, 2, 3, 4, 5, 6]) {
    const value = input(fixture.cases[0]), blue = fixture.cases[1].capture.observations.segments[1].values;
    value.characters = value.rest.characters = "😀A\u0301\u00a0🧑\nZ";
    const original = value.segments[0].values; let offset = 0;
    value.segments = Array.from(value.characters, (character, index) => {
      const start = offset; offset += character.length;
      return { start, end: offset, characters: character, values: copy(index === selected ? blue : original) };
    });
    value.rangeChecks = []; value.scalars.fills = { kind: "mixed" }; value.scalars.hyperlink = { kind: "mixed" };
    value.rest.characterStyleOverrides = Array.from(value.characters, (_, index) => index === selected ? 3 : 0);
    value.rest.styleOverrideTable = copy(fixture.cases[1].rest.styleOverrideTable);
    const built = bound(value);
    assert.deepEqual(built.source.segments.map(segment => [segment.start, segment.end]), [[0, 2], [2, 3], [3, 4], [4, 5], [5, 7], [7, 8], [8, 9]]);
    assert.equal(built.source.segments[selected].values.hyperlink.value.value, "https://example.com/");
    const wrong = copy(value); wrong.rest.characterStyleOverrides = Array.from(value.characters, (_, index) => index === (selected + 1) % 7 ? 3 : 0);
    assert(codes(buildNativeTextRangeSource(wrong)).includes("NATIVE_TEXT_RANGES_CAPTURE_RACE"));
  }
});

test("transport projection never normalizes snapshot evidence or grants changed raw metrics canonical authority", () => {
  const value = input(fixture.cases[0]), first = bound(value);
  const changed = copy(value), raw = changed.scalars.lineHeight.value.value + 1e-7;
  assert.equal(Math.fround(raw), value.rest.style.lineHeightPercentFontSize);
  changed.scalars.lineHeight.value.value = raw;
  for (const segment of changed.segments) segment.values.lineHeight.value.value = raw;
  const second = bound(changed);
  assert.equal(second.source.scalars.lineHeight.value.value, raw);
  assert.notEqual(nativeTextRangeSnapshot(first.source), nativeTextRangeSnapshot(second.source));
  const imported = importNativeTextRanges({ rest: changed.rest, source: second.source, canonicalNode: fixture.cases[0].canonical });
  assert.equal(imported.status, "unsupported"); assert(codes(imported).includes("NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS"));
});
