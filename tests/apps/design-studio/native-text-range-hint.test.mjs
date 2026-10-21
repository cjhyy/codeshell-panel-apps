import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { buildNativeTextRangeHint, restoreNativeTextRangeHint, MAX_NATIVE_TEXT_RANGE_HINT_BYTES, MAX_NATIVE_PLUGIN_DATA_ENTRY_BYTES } from "../../../apps/design-studio/app/native-text-range-hint.mjs";
import { buildNativeTextRangeSource, importNativeTextRanges, nativeTextRangeSnapshot } from "../../../apps/design-studio/app/native-text-ranges-source.mjs";
import { nativeTextRangePlan } from "../../../apps/design-studio/app/native-text-range-plan.mjs";
import { textRangeSourceSignature } from "../../../apps/design-studio/app/text-ranges.mjs";

const val = value => ({ kind: "value", value }), copy = value => structuredClone(value);
const pluginId = "codeshell-design-bridge", key = "codeshellTextRangeIntent";
const payload = (text, ranges) => ({ version: 1, sourceSignature: textRangeSourceSignature(text), ranges });
const bytes = text => new TextEncoder().encode(text).length;
function paint(hex) {
  const channels = [1, 3, 5].map(index => Math.fround(parseInt(hex.slice(index, index + 2), 16) / 255));
  return [{ type: "SOLID", visible: true, opacity: 1, blendMode: "NORMAL", boundVariables: {}, color: { r: channels[0], g: channels[1], b: channels[2] } }];
}
function fixture({ text = "ABCD", pieces = [{ start: 0, end: text.length, fill: "#0000ff" }], getter = 1, id = "1:2" } = {}) {
  const canonicalNode = { type: "text", text, textSource: text, textFlow: "wrap", fill: pieces[0].fill,
    fontFamily: "Inter", fontSize: 24, fontWeight: 400, fontStyle: "normal", lineHeight: 30, lineHeightUnit: "pixels",
    letterSpacing: 0, textAlign: "left", textDecoration: "none" };
  const entries = { fontName: { family: "Inter", style: "Regular", variationSettings: { wght: 400, slnt: 0 } },
    fontSize: 24, fontWeight: 400, fontStyle: "REGULAR", lineHeight: { unit: "PIXELS", value: 30 },
    letterSpacing: { unit: "PIXELS", value: 0 }, fills: paint(pieces[0].fill), textDecoration: "NONE",
    textDecorationStyle: null, textDecorationOffset: null, textDecorationThickness: null, textDecorationColor: null, textDecorationSkipInk: null,
    hyperlink: null, textCase: "ORIGINAL", openTypeFeatures: {}, boundVariables: {}, textStyleOverrides: [], textStyleId: "", fillStyleId: "",
    listOptions: { type: "NONE" }, listSpacing: 0, indentation: 0, paragraphIndent: 0, paragraphSpacing: 0, textWrapStyle: "AUTO" };
  const values = () => Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, val(copy(value))]));
  const segments = pieces.map(piece => ({ start: piece.start, end: piece.end, characters: text.slice(piece.start, piece.end),
    values: { ...values(), fills: val(paint(piece.fill)), hyperlink: val(piece.href ? { type: "URL", value: piece.href } : null) } }));
  const scalars = values();
  for (const field of ["fills", "hyperlink"])
    scalars[field] = segments.every(segment => JSON.stringify(segment.values[field]) === JSON.stringify(segments[0].values[field]))
      ? copy(segments[0].values[field]) : { kind: "mixed" };
  Object.assign(scalars, { hasMissingFont: val(false), leadingTrim: val("NONE"), hangingPunctuation: val(false), hangingList: val(false),
    textAlignVertical: val("TOP"), textAlignHorizontal: val("LEFT"), textTruncation: val("DISABLED"), maxLines: val(null) });
  const rest = { id, type: "TEXT", characters: text, fills: paint(pieces[0].fill),
    style: { fontFamily: "Inter", fontStyle: "Regular", fontSize: 24, fontWeight: 400, lineHeightUnit: "PIXELS", lineHeightPx: 30, textDecoration: "NONE" },
    characterStyleOverrides: Array(text.length).fill(0), styleOverrideTable: {} };
  pieces.forEach((piece, index) => {
    rest.styleOverrideTable[index + 1] = { fills: paint(piece.fill), hyperlink: piece.href ? { type: "URL", url: piece.href } : null };
    rest.characterStyleOverrides.fill(index + 1, piece.start, piece.end);
  });
  const rangeChecks = pieces.map(piece => ({ start: piece.start, end: piece.end,
    values: { hyperlink: val(piece.href ? { type: "URL", value: piece.href } : getter) } }));
  const input = { rest, characters: text, scalars, segments, rangeChecks };
  const built = buildNativeTextRangeSource(input); assert.equal(built.status, "bound", JSON.stringify(built));
  return { rest, source: built.source, canonicalNode, input };
}
const author = (value, ranges, fill = "#000000") => ({ ...copy(value.canonicalNode), fill, textRanges: payload(value.rest.characters, ranges) });
const buildHint = (value, authorNode, options = {}) => buildNativeTextRangeHint({ rest: value.rest, source: value.source, authorNode, pluginId, key, ...options });
const restore = (value, hint, options = {}) => restoreNativeTextRangeHint({ rest: value.rest, source: value.source, canonicalNode: value.canonicalNode, hint, pluginId, key, ...options });
function refused(fn, code) {
  assert.throws(fn, error => {
    assert.equal(typeof error.code, "string"); assert(error.code.length < 100); assert(error.message.length <= 240);
    if (code) assert.equal(error.code, code);
    return true;
  });
}
function changed(value, edit) {
  const result = copy(value); edit(result.input);
  const built = buildNativeTextRangeSource(result.input); assert.equal(built.status, "bound", JSON.stringify(built));
  result.rest = result.input.rest; result.source = built.source;
  return result;
}

test("full native blue override retains unused author black base and later clear returns black", () => {
  const value = fixture(), original = author(value, [{ start: 0, end: 4, fill: "#0000ff" }]), before = copy({ value, original });
  const hint = buildHint(value, original), patch = restore(value, JSON.stringify(hint));
  assert.deepEqual(Object.keys(patch).sort(), ["fill", "textRanges"]);
  assert.equal(patch.fill, "#000000"); assert.deepEqual(patch.textRanges, original.textRanges);
  const restored = { ...value.canonicalNode, ...patch };
  assert.equal(nativeTextRangePlan(restored).runs[0].fill, "#0000ff");
  delete restored.textRanges;
  assert.equal(nativeTextRangePlan(restored).runs[0].fill, "#000000");
  assert.deepEqual({ value, original }, before);
});

test("explicit same and NONE boundaries survive a single effective SDK segment; equality coalescing never edits payload", () => {
  const value = fixture({ pieces: [{ start: 0, end: 4, fill: "#000000" }] });
  const original = author(value, [{ start: 1, end: 2, fill: "#000000" }, { start: 2, end: 3, textDecoration: "none" }]);
  const hint = buildHint(value, original), patch = restore(value, hint);
  assert.deepEqual(hint.textRanges, original.textRanges);
  assert.deepEqual(patch.textRanges, original.textRanges);
  patch.textRanges.ranges[0].fill = "#ffffff"; hint.textRanges.ranges.pop();
  assert.deepEqual(restore(value, buildHint(value, original)).textRanges, original.textRanges);
});

test("known null segment plus raw getter1 proves intent without coercion; every changed observation invalidates the full snapshot", () => {
  const pieces = [{ start: 0, end: 1, fill: "#000000" }, { start: 1, end: 3, fill: "#0000ff", href: "https://example.com/" }, { start: 3, end: 4, fill: "#000000" }];
  const value = fixture({ pieces }), original = author(value, [{ start: 1, end: 3, fill: "#0000ff", href: "https://example.com/" }]);
  const hint = buildHint(value, original);
  assert.equal(value.source.rangeChecks[0].values.hyperlink.value, 1);
  assert.deepEqual(restore(value, hint).textRanges, original.textRanges);
  for (const replacement of [val(null), val(2), { kind: "missing" }, { kind: "error", message: "changed" }]) {
    const next = changed(value, input => input.rangeChecks[0].values.hyperlink = replacement);
    refused(() => restore(next, hint), "NATIVE_TEXT_RANGE_HINT_STALE");
  }
});

test("forged matching snapshot cannot authorize wrong paint/link or an unknown segment/current metric state", () => {
  const value = fixture(), original = author(value, [{ start: 0, end: 4, fill: "#0000ff" }]), hint = buildHint(value, original);
  const forged = copy(hint); forged.textRanges.ranges[0].fill = "#ff0000";
  const before = copy({ value, forged });
  refused(() => restore(value, forged), "NATIVE_TEXT_RANGE_HINT_EFFECTIVE");
  const callerRanges = { ...value.canonicalNode, textRanges: forged.textRanges };
  refused(() => restore(value, forged, { canonicalNode: callerRanges }), "NATIVE_TEXT_RANGE_HINT_EFFECTIVE");
  assert.deepEqual({ value, forged }, before);
  for (const replacement of [{ kind: "mixed" }, { kind: "missing" }, { kind: "error", message: "unknown" }, val(1)]) {
    const next = changed(value, input => { input.segments[0].values.hyperlink = replacement; input.scalars.hyperlink = { kind: "mixed" }; });
    const copiedSnapshot = { ...copy(hint), snapshot: nativeTextRangeSnapshot(next.source) };
    refused(() => restore(next, copiedSnapshot), "NATIVE_TEXT_RANGE_HINT_EFFECTIVE");
    refused(() => buildHint(next, original), "NATIVE_TEXT_RANGE_HINT_EFFECTIVE");
  }
  const custom = changed(value, input => {
    input.segments[0].values.textDecorationOffset = val({ unit: "PIXELS", value: 1 });
    input.scalars.textDecorationOffset = val({ unit: "PIXELS", value: 1 });
  });
  refused(() => restore(custom, { ...copy(hint), snapshot: nativeTextRangeSnapshot(custom.source) }), "NATIVE_TEXT_RANGE_HINT_EFFECTIVE");
});

test("source/display UTF16 is exact; stale/new identity/partial snapshot/partial payload refuse without a restored prefix", () => {
  const text = " A😀\u00a0B\n\nC ", value = fixture({ text }), original = author(value, [{ start: 0, end: text.length, fill: "#0000ff" }]);
  original.text = original.text.replace("B", "\nB");
  const hint = buildHint(value, original), patch = restore(value, hint);
  assert.equal(patch.textRanges.sourceSignature, textRangeSourceSignature(text));
  const restored = { ...value.canonicalNode, ...patch };
  assert.equal(nativeTextRangePlan(restored).characters, text);
  const foreign = fixture({ text, id: "new:identity" });
  refused(() => restore(foreign, hint), "NATIVE_TEXT_RANGE_HINT_STALE");
  refused(() => restore(value, { ...copy(hint), snapshot: hint.snapshot.slice(0, -1) }), "NATIVE_TEXT_RANGE_HINT_STALE");
  const partial = copy(hint); partial.textRanges.ranges[0].end--;
  refused(() => restore(value, partial), "NATIVE_TEXT_RANGE_HINT_EFFECTIVE");
  const stale = copy(value); stale.source.characters = "changed";
  refused(() => restore(stale, hint), "NATIVE_TEXT_RANGE_HINT_SOURCE");
  refused(() => restore(value, hint, { canonicalNode: { ...value.canonicalNode, text: value.canonicalNode.text.slice(1) } }));
});

test("REST override ID renumbering stays independently bound; source hash or plugin flags do not supply authority", () => {
  const value = fixture(), original = author(value, [{ start: 0, end: 4, fill: "#0000ff" }]), hint = buildHint(value, original);
  const renumbered = changed(value, input => {
    input.rest.styleOverrideTable = { 9: input.rest.styleOverrideTable[1] };
    input.rest.characterStyleOverrides.fill(9);
  });
  assert.deepEqual(restore(renumbered, hint).textRanges, original.textRanges);
  for (const field of ["hash", "sourceOnly", "verified"]) refused(() => restore(value, { ...copy(hint), [field]: true }));
  refused(() => buildHint(value, { ...original, textRanges: undefined }), "NATIVE_TEXT_RANGE_HINT_NO_INTENT");
});

test("line-height units and font axes stay exact; Float32 percentage transport deliberately refuses without normalization", () => {
  function percent(value, ratio, reported) {
    const result = changed(value, input => {
      input.scalars.lineHeight = val({ unit: "PERCENT", value: reported });
      for (const segment of input.segments) segment.values.lineHeight = val({ unit: "PERCENT", value: reported });
      input.rest.style.lineHeightUnit = "FONT_SIZE_%";
      input.rest.style.lineHeightPercentFontSize = reported;
      delete input.rest.style.lineHeightPx;
    });
    result.canonicalNode.lineHeight = ratio;
    delete result.canonicalNode.lineHeightUnit;
    return result;
  }
  const value = fixture(), exact = percent(value, 1.2, 120);
  const exactAuthor = author(exact, [{ start: 0, end: 4, fill: "#0000ff" }]);
  assert.deepEqual(restore(exact, buildHint(exact, exactAuthor)).textRanges, exactAuthor.textRanges);

  const reported = Math.fround(131.58), transported = percent(value, 1.3158, reported);
  const transportedBefore = JSON.stringify(transported), transportedAuthor = author(transported, [{ start: 0, end: 4, fill: "#0000ff" }]);
  assert.notEqual(reported, transported.canonicalNode.lineHeight * 100);
  const imported = importNativeTextRanges({ rest: transported.rest, source: transported.source, canonicalNode: transported.canonicalNode });
  assert.equal(imported.status, "unsupported");
  assert(imported.diagnostics.some(note => note.code === "NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS"));
  refused(() => buildHint(transported, transportedAuthor), "NATIVE_TEXT_RANGE_HINT_EFFECTIVE");
  assert.equal(transported.source.segments[0].values.lineHeight.value.value, reported);
  assert.equal(JSON.stringify(transported), transportedBefore);

  const pixelsHint = buildHint(value, author(value, [{ start: 0, end: 4, fill: "#0000ff" }]));
  const samePhysicalHeight = percent(value, 1.25, 125);
  refused(() => restore(samePhysicalHeight, pixelsHint), "NATIVE_TEXT_RANGE_HINT_STALE");
  refused(() => buildHint(samePhysicalHeight, author(value, [{ start: 0, end: 4, fill: "#0000ff" }])), "NATIVE_TEXT_RANGE_HINT_EFFECTIVE");

  for (const variationSettings of [{ wght: 400, slnt: 8 }, { wght: 400, wdth: 100 }]) {
    const noncanonical = changed(value, input => {
      input.scalars.fontName.value.variationSettings = variationSettings;
      for (const segment of input.segments) segment.values.fontName.value.variationSettings = variationSettings;
    });
    refused(() => buildHint(noncanonical, author(value, [{ start: 0, end: 4, fill: "#0000ff" }])), "NATIVE_TEXT_RANGE_HINT_EFFECTIVE");
  }
  const noAxes = changed(value, input => {
    delete input.scalars.fontName.value.variationSettings;
    for (const segment of input.segments) delete segment.values.fontName.value.variationSettings;
  });
  assert.deepEqual(restore(noAxes, buildHint(noAxes, author(noAxes, [{ start: 0, end: 4, fill: "#0000ff" }]))).fill, "#000000");
  refused(() => restore(noAxes, pixelsHint), "NATIVE_TEXT_RANGE_HINT_STALE");
});

test("full UTF8 hint budget and actual pluginId/key overhead refuse atomically; getter errors remain complete observations", () => {
  const value = fixture(), original = author(value, [{ start: 0, end: 4, fill: "#0000ff" }]), hint = buildHint(value, original);
  const limitId = "x".repeat(MAX_NATIVE_PLUGIN_DATA_ENTRY_BYTES - bytes(JSON.stringify(hint)) - bytes(key));
  assert.deepEqual(buildHint(value, original, { pluginId: limitId }), hint);
  refused(() => buildHint(value, original, { pluginId: limitId + "x" }), "NATIVE_TEXT_RANGE_HINT_BUDGET");
  const extra = count => changed(value, input => {
    input.rangeChecks.push(...Array.from({ length: count }, () => ({ start: 0, end: 4,
      values: { textDecorationOffset: { kind: "error", message: "界".repeat(500) } } })));
  });
  assert.deepEqual(restore(extra(1), buildHint(extra(1), original)).textRanges, original.textRanges);
  refused(() => buildHint(extra(50), original), "NATIVE_TEXT_RANGE_HINT_BUDGET");
  const padded = " ".repeat(MAX_NATIVE_TEXT_RANGE_HINT_BYTES) + JSON.stringify(hint);
  refused(() => restore(value, padded), "NATIVE_TEXT_RANGE_HINT_BUDGET");
});

test("source/hint/accessor/serialization/prototype inputs cannot execute or expand authority", () => {
  const value = fixture(), original = author(value, [{ start: 0, end: 4, fill: "#0000ff" }]), hint = buildHint(value, original);
  let calls = 0;
  for (const field of ["characters", "restSignature", "hash"]) {
    const source = copy(value.source); Object.defineProperty(source, field, { enumerable: true, get() { calls++; throw Error("x".repeat(9000)); } });
    refused(() => buildHint(value, original, { source }));
  }
  for (const field of ["snapshot", "textRanges", "hash"]) {
    const candidate = copy(hint); Object.defineProperty(candidate, field, { enumerable: true, get() { calls++; return hint[field]; } });
    refused(() => restore(value, candidate));
  }
  const serialization = copy(hint); serialization.toJSON = () => { calls++; return hint; };
  refused(() => restore(value, serialization));
  const cycle = copy(hint); cycle.textRanges.ranges[0].fill = cycle;
  refused(() => restore(value, cycle));
  const proxy = new Proxy({}, { getPrototypeOf() { throw Error("foreign".repeat(2000)); } });
  refused(() => restore(value, proxy));
  assert.equal(calls, 0);
});

test("portable VM restores only owned fill/ranges with no DOM globals or SDK hooks", async () => {
  const output = await build({ entryPoints: ["apps/design-studio/app/native-text-range-hint.mjs"], bundle: true, format: "iife", globalName: "Hints", platform: "neutral", write: false, logLevel: "silent" });
  const value = fixture(), authorNode = author(value, [{ start: 0, end: 4, fill: "#0000ff" }]);
  const context = { URL: undefined, TextEncoder: undefined, structuredClone: undefined, figma: undefined };
  const input = { rest: value.rest, source: value.source, authorNode, pluginId, key };
  runInNewContext(output.outputFiles[0].text + "\nconst input=JSON.parse(" + JSON.stringify(JSON.stringify(input)) + ");const hint=Hints.buildNativeTextRangeHint(input);globalThis.patch=Hints.restoreNativeTextRangeHint({rest:input.rest,source:input.source,canonicalNode:JSON.parse(" + JSON.stringify(JSON.stringify(value.canonicalNode)) + "),hint,pluginId:input.pluginId,key:input.key});globalThis.globals=[typeof URL,typeof TextEncoder,typeof structuredClone,typeof figma];", context);
  assert.deepEqual([...context.globals], ["undefined", "undefined", "undefined", "undefined"]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.patch)), { fill: "#000000", textRanges: authorNode.textRanges });
  context.patch.textRanges.ranges[0].fill = "#ffffff";
  assert.equal(authorNode.textRanges.ranges[0].fill, "#0000ff");
});
