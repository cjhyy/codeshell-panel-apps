import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { compareNativeTextRangeSources } from "../../../apps/design-studio/app/native-text-range-compare.mjs";
import { buildNativeTextRangeSource, nativeTextRangeSnapshot, MAX_NATIVE_TEXT_RANGE_SOURCE_BYTES }
  from "../../../apps/design-studio/app/native-text-ranges-source.mjs";

const fixture = JSON.parse(await readFile(new URL("../../fixtures/design-studio/native-text-field-matrix-1ed86d39.json", import.meta.url)));
const copy = value => structuredClone(value), val = value => ({ kind: "value", value });
const codes = result => result.diagnostics.map(note => note.code);
function rebind(rest) {
  const old = rest.codeshellNativeTextRanges;
  const built = buildNativeTextRangeSource({ rest, characters: old.characters,
    scalars: old.scalars, segments: old.segments, rangeChecks: old.rangeChecks });
  assert.equal(built.status, "bound", JSON.stringify(built));
  rest.codeshellNativeTextRanges = built.source;
  return rest;
}
function entry(index = 1) {
  const actual = fixture.cases[index], rest = copy(actual.rest);
  const built = buildNativeTextRangeSource({ rest, ...copy(actual.capture.observations) });
  assert.equal(built.status, "bound", JSON.stringify(built));
  rest.codeshellNativeTextRanges = built.source;
  return rest;
}
const compare = (expectedRest, currentRest = copy(expectedRest)) => compareNativeTextRangeSources({ expectedRest, currentRest });

test("all four complete actual SDK sources compare unchanged without mutation and report exact owned-node UTF8 bytes", () => {
  assert.equal(fixture.provenance.sourceSha256, "6c59ea3aaa84a46546c0dac30d7ebe4cbe5021509d1c470970f1ff4ff72f9c8c");
  for (let index = 0; index < fixture.cases.length; index++) {
    const expected = entry(index), current = copy(expected), before = JSON.stringify({ expected, current });
    const result = compare(expected, current);
    assert.equal(result.status, "unchanged", JSON.stringify(result)); assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.bytes, { expected: Buffer.byteLength(JSON.stringify(expected)),
      current: Buffer.byteLength(JSON.stringify(current)), total: 2 * Buffer.byteLength(JSON.stringify(expected)) });
    assert.equal(JSON.stringify({ expected, current }), before);
  }
});

test("equivalent override ID renumbering, trailing default zeros and redundant exact inherited fields preserve the projection", () => {
  const expected = entry(), current = copy(expected);
  current.styleOverrideTable = { 91: { ...current.styleOverrideTable[3], fontSize: current.style.fontSize } };
  current.characterStyleOverrides = current.characterStyleOverrides.map(id => id ? 91 : 0);
  while (current.characterStyleOverrides.length < Array.from(current.characters).length) current.characterStyleOverrides.push(0);
  rebind(current);
  assert.equal(nativeTextRangeSnapshot(expected.codeshellNativeTextRanges), nativeTextRangeSnapshot(current.codeshellNativeTextRanges));
  assert.equal(compare(expected, current).status, "unchanged");
  assert.equal(current.codeshellNativeTextRanges.segments[1].characters, "linked\n");
  assert.deepEqual([current.codeshellNativeTextRanges.segments[1].start, current.codeshellNativeTextRanges.segments[1].end], [4, 11]);
});

test("unknown base and effective override style keys cannot disappear behind equal SDK getters", () => {
  for (const place of ["base", "override", "unused"]) {
    const expected = entry();
    const get = rest => place === "base" ? rest.style : place === "override" ? rest.styleOverrideTable[3] : rest.styleOverrideTable[99];
    if (place === "unused") expected.styleOverrideTable[99] = {};
    get(expected).futureTypography = { axis: [1, 2], enabled: false }; rebind(expected);
    const current = copy(expected); get(current).futureTypography.axis[1] = 3; rebind(current);
    assert.equal(nativeTextRangeSnapshot(expected.codeshellNativeTextRanges), nativeTextRangeSnapshot(current.codeshellNativeTextRanges));
    const result = compare(expected, current);
    assert.equal(result.status, "changed"); assert.deepEqual(codes(result), ["NATIVE_TEXT_SOURCE_COMPARE_REST_STYLE_CHANGED"]);
  }
});

test("unknown paint metadata and style references remain presence-aware REST conflict evidence", () => {
  for (const mutate of [
    rest => { rest.styles = { text: "S:2" }; },
    rest => { rest.textStyleId = "S:2"; },
    rest => { rest.fillStyleId = "F:2"; },
    rest => { rest.fills[0].futurePaintBehavior = { mode: "new" }; },
    rest => { rest.styleOverrideTable[3].fills[0].futurePaintBehavior = { mode: "new" }; },
    rest => { rest.style.futureOptional = null; },
  ]) {
    const expected = entry(), current = copy(expected); mutate(current); rebind(current);
    const result = compare(expected, current);
    assert.equal(result.status, "changed"); assert.deepEqual(codes(result), ["NATIVE_TEXT_SOURCE_COMPARE_REST_STYLE_CHANGED"]);
  }
  const expected = entry(), current = copy(expected);
  current.absoluteBoundingBox.x += 1; current.name += " renamed";
  assert.equal(compare(expected, current).status, "unchanged"); // This helper is only the text-source portion of preflight.
});

test("missing historical snapshots require recapture; current missing and malformed metadata are distinct refusals", () => {
  const expected = entry(), legacy = copy(expected); delete legacy.codeshellNativeTextRanges;
  let result = compare(legacy, expected);
  assert.equal(result.status, "snapshot-required"); assert.equal(result.diagnostics[0].side, "expected");
  assert.deepEqual(codes(result), ["NATIVE_TEXT_SOURCE_COMPARE_SNAPSHOT_REQUIRED"]);
  result = compare(expected, legacy);
  assert.equal(result.status, "invalid"); assert.equal(result.diagnostics[0].side, "current");
  assert.deepEqual(codes(result), ["NATIVE_TEXT_SOURCE_COMPARE_CURRENT_REQUIRED"]);
  const malformed = copy(expected); malformed.codeshellNativeTextRanges.version = 2;
  result = compare(malformed, expected);
  assert.equal(result.status, "invalid"); assert.deepEqual(codes(result), ["NATIVE_TEXT_SOURCE_COMPARE_SOURCE_INVALID"]);
});

test("each full snapshot validates against its own REST; stale source never matches by borrowing the other node", () => {
  const expected = entry(), current = copy(expected);
  current.style.futureStyle = 1; rebind(current);
  assert.equal(compare(expected, current).status, "changed");
  const stale = copy(current); stale.codeshellNativeTextRanges = copy(expected.codeshellNativeTextRanges);
  const result = compare(expected, stale);
  assert.equal(result.status, "stale"); assert.equal(result.diagnostics[0].side, "current");
  assert.deepEqual(codes(result), ["NATIVE_TEXT_SOURCE_COMPARE_SOURCE_STALE"]);
  const staleHistory = copy(expected); staleHistory.style.futureStyle = 1;
  assert.equal(compare(staleHistory, current).diagnostics[0].side, "expected");
});

test("complete field catalogs and matching getter intervals are required without inventing missing observations", () => {
  for (const remove of [
    source => { delete source.scalars.fontStyle; },
    source => { delete source.segments[0].values.textDecorationOffset; },
    source => { delete source.rangeChecks[0].values.hyperlink; },
    source => { source.rangeChecks.shift(); },
  ]) {
    const expected = entry(), incomplete = copy(expected); remove(incomplete.codeshellNativeTextRanges);
    assert.equal(compare(incomplete, expected).status, "snapshot-required");
    const result = compare(expected, incomplete);
    assert.equal(result.status, "invalid"); assert.deepEqual(codes(result), ["NATIVE_TEXT_SOURCE_COMPARE_CURRENT_REQUIRED"]);
  }
});

test("unknown getter numeric1, null, missing, mixed and errors remain exact conflict evidence", () => {
  const expected = entry(); assert.equal(expected.codeshellNativeTextRanges.rangeChecks[0].values.hyperlink.value, 1);
  for (const observation of [val(null), { kind: "missing" }, { kind: "mixed" }, { kind: "error", message: "SDK unavailable" }, val(2)]) {
    const current = copy(expected); current.codeshellNativeTextRanges.rangeChecks[0].values.hyperlink = observation; rebind(current);
    const result = compare(expected, current);
    assert.equal(result.status, "changed"); assert.deepEqual(codes(result), ["NATIVE_TEXT_SOURCE_COMPARE_SNAPSHOT_CHANGED"]);
  }
});

test("raw custom decoration and Float32 getter values cannot normalize to an equal snapshot", () => {
  const expected = entry(0), decorated = copy(expected), offset = val({ unit: "PERCENT", value: 15.779999732971191 });
  decorated.codeshellNativeTextRanges.scalars.textDecorationOffset = copy(offset);
  for (const segment of decorated.codeshellNativeTextRanges.segments) segment.values.textDecorationOffset = copy(offset);
  for (const check of decorated.codeshellNativeTextRanges.rangeChecks) check.values.textDecorationOffset = copy(offset);
  rebind(decorated);
  assert.deepEqual(codes(compare(expected, decorated)), ["NATIVE_TEXT_SOURCE_COMPARE_SNAPSHOT_CHANGED"]);
  const changed = copy(expected), native = changed.codeshellNativeTextRanges, raw = native.scalars.lineHeight.value.value + 1e-7;
  assert.equal(Math.fround(raw), expected.style.lineHeightPercentFontSize);
  native.scalars.lineHeight.value.value = raw;
  for (const segment of native.segments) segment.values.lineHeight.value.value = raw;
  rebind(changed);
  assert.deepEqual(codes(compare(expected, changed)), ["NATIVE_TEXT_SOURCE_COMPARE_SNAPSHOT_CHANGED"]);
});

test("same-value SDK segment splits conservatively conflict even when resolved REST styles are unchanged", () => {
  const expected = entry(0), current = copy(expected), source = current.codeshellNativeTextRanges;
  const first = source.segments[0], check = source.rangeChecks[0];
  source.segments = [{ ...copy(first), end: 4, characters: first.characters.slice(0, 4) },
    { ...copy(first), start: 4, characters: first.characters.slice(4) }];
  source.rangeChecks = [{ ...copy(check), end: 4 }, { ...copy(check), start: 4 }];
  rebind(current);
  const result = compare(expected, current);
  assert.equal(result.status, "changed"); assert.deepEqual(codes(result), ["NATIVE_TEXT_SOURCE_COMPARE_SNAPSHOT_CHANGED"]);
});

test("default0 uses inherited style, Unicode scalar indexing never guesses UTF16 and malformed unused styles refuse", () => {
  const expected = entry(), wrong = copy(expected);
  wrong.characterStyleOverrides = [0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3];
  const rebuilt = buildNativeTextRangeSource({ rest: wrong, characters: wrong.characters,
    ...Object.fromEntries(["scalars", "segments", "rangeChecks"].map(key => [key, wrong.codeshellNativeTextRanges[key]])) });
  assert.equal(rebuilt.status, "invalid");
  for (const table of [{ 99: null }, { futureId: { unknown: 1 } }, { "01": { unknown: 1 } }]) {
    const current = copy(expected); Object.assign(current.styleOverrideTable, table); rebind(current);
    const result = compare(expected, current); assert.equal(result.status, "invalid");
    assert.deepEqual(codes(result), ["NATIVE_TEXT_SOURCE_COMPARE_INVALID"]);
  }
  const withZero = copy(expected); withZero.styleOverrideTable[0] = { futureDefault: true }; rebind(withZero);
  assert.equal(compare(expected, withZero).status, "changed");
  for (const field of ["characterStyleOverrides", "styleOverrideTable"]) {
    const current = entry(0); current[field] = null; rebind(current);
    const result = compare(entry(0), current);
    assert.equal(result.status, "invalid"); assert.deepEqual(codes(result), ["NATIVE_TEXT_SOURCE_COMPARE_INVALID"]);
    assert.equal(result.diagnostics[0].side, "current");
  }
});

test("owned JSON rejects accessors, holes, cycles, symbols and unsupported prototypes without invoking getters", () => {
  let invoked = 0;
  const getter = { enumerable: true, get() { invoked++; throw new Error("private secret must not escape"); } };
  const expected = entry();
  const input = { currentRest: expected }; Object.defineProperty(input, "expectedRest", getter);
  assert.equal(compareNativeTextRangeSources(input).status, "invalid");
  for (const mutate of [
    rest => Object.defineProperty(rest, "id", getter),
    rest => Object.defineProperty(rest.style, "future", getter),
    rest => { delete rest.characterStyleOverrides[0]; },
    rest => { rest.loop = rest; },
    rest => { rest[Symbol("private")] = 1; },
    rest => { rest.style = new Date(); },
    rest => { rest.fills.extra = true; },
    rest => Object.defineProperty(rest, "hidden", { value: true }),
    rest => { delete rest.id; },
    rest => { rest.id = ""; },
    rest => { delete rest.characters; },
    rest => { rest.characters = "x".repeat(4001); },
  ]) {
    const current = copy(expected); mutate(current); const result = compare(expected, current);
    assert.equal(result.status, "invalid"); assert.equal(result.diagnostics.length, 1);
    assert(result.diagnostics[0].message.length < 180); assert(!JSON.stringify(result).includes("private secret"));
  }
  assert.equal(invoked, 0);
});

test("whole nodes including ignored fields share an exact UTF8 budget and prototype-key data stays inert", () => {
  const expected = entry(), inert = copy(expected);
  inert.style.future = JSON.parse('{"__proto__":{"polluted":true},"constructor":"inert"}'); rebind(inert);
  assert.equal(compare(inert).status, "unchanged"); assert.equal({}.polluted, undefined);
  const current = copy(expected); current.unrelated = "é".repeat(MAX_NATIVE_TEXT_RANGE_SOURCE_BYTES / 2);
  const before = JSON.stringify(current), result = compare(expected, current);
  assert.equal(result.status, "invalid"); assert.deepEqual(codes(result), ["NATIVE_TEXT_SOURCE_COMPARE_BUDGET"]);
  assert.equal(JSON.stringify(current), before);
  const exact = copy(expected); exact.paddingForBudget = "";
  exact.paddingForBudget = "x".repeat(MAX_NATIVE_TEXT_RANGE_SOURCE_BYTES - Buffer.byteLength(JSON.stringify(exact)));
  assert.equal(Buffer.byteLength(JSON.stringify(exact)), MAX_NATIVE_TEXT_RANGE_SOURCE_BYTES);
  assert.equal(compare(exact).status, "unchanged");
  exact.paddingForBudget += "x";
  assert.deepEqual(codes(compare(exact)), ["NATIVE_TEXT_SOURCE_COMPARE_BUDGET"]);
});

test("the complete comparison executes in a native-like VM without DOM, URL, TextEncoder or structuredClone", async () => {
  const root = new URL("../../../apps/design-studio/app/", import.meta.url);
  const core = (await readFile(new URL("text-ranges.mjs", root), "utf8")).replaceAll(/^export /gm, "");
  const source = (await readFile(new URL("native-text-ranges-source.mjs", root), "utf8"))
    .replace(/^import .*;\n/mu, "").replaceAll(/^export /gm, "");
  const module = (await readFile(new URL("native-text-range-compare.mjs", root), "utf8"))
    .replace(/^import [\s\S]*?;\n/u, "").replaceAll(/^export /gm, "");
  const context = vm.createContext({ inputJson: JSON.stringify({ expectedRest: entry(), currentRest: entry() }) });
  vm.runInContext(`Object.assign(this,(()=>{${core};return {textRangeSourceSignature,validateTextRanges,isSafeTextRangeHref};})());`, context);
  vm.runInContext(`Object.assign(this,(()=>{${source};return {MAX_NATIVE_TEXT_RANGE_SOURCE_BYTES,NATIVE_TEXT_RANGE_FIELDS,NATIVE_TEXT_RANGE_SCALAR_ONLY_FIELDS,validateNativeTextRangeSource,nativeTextRangeSnapshot};})());`, context);
  vm.runInContext(`(()=>{${module};this.result=compareNativeTextRangeSources(JSON.parse(inputJson));})();`, context);
  assert.equal(context.result.status, "unchanged");
  assert.equal(vm.runInContext("[typeof document,typeof URL,typeof TextEncoder,typeof structuredClone,typeof figma].join('/')", context),
    "undefined/undefined/undefined/undefined/undefined");
});
