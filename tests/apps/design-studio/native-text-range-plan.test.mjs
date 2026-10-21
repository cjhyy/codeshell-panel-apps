import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { nativeTextRangePlan, MAX_NATIVE_TEXT_RANGE_RUNS } from "../../../apps/design-studio/app/native-text-range-plan.mjs";
import { textRangeSourceSignature, replaceTextRange } from "../../../apps/design-studio/app/text-ranges.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { plainFixture } from "./fixtures/figma-plugin-v3.mjs";

const node = (source = "ABCDE", ranges = [{ start: 1, end: 3, fill: "#ff0000" }]) => ({
  type: "text", text: source, fill: "#112233", fontSize: 20,
  textRanges: { version: 1, sourceSignature: textRangeSourceSignature(source), ranges },
});
function assertComplete(plan) {
  let cursor = 0;
  for (const run of plan.runs) {
    assert.equal(run.start, cursor); assert(run.end > run.start);
    assert(/^#[0-9a-f]{6}$/u.test(run.fill));
    assert.equal(Object.keys(run).sort().join(","), "end,fill,hyperlink,start");
    cursor = run.end;
  }
  assert.equal(cursor, plan.characters.length);
}
function rejected(value, code) {
  const before = structuredClone(value);
  assert.throws(() => nativeTextRangePlan(value), error => {
    assert.equal(typeof error.code, "string"); assert(error.code.length <= 100);
    assert(error.message.length <= 240);
    if (code) assert.equal(error.code, code);
    return true;
  });
  assert.deepEqual(value, before);
}

test("one Text gets complete source-indexed native fill/link runs including all inherited gaps", () => {
  const source = "A😀\u00a0BC\nD", value = node(source, [
    { start: 1, end: 3, fill: "#FF0000" },
    { start: 4, end: 6, href: "https://example.com/application?stage=1#details" },
  ]), before = structuredClone(value), plan = nativeTextRangePlan(value);
  assert.deepEqual(plan, { characters: source, runs: [
    { start: 0, end: 1, fill: "#112233", hyperlink: null },
    { start: 1, end: 3, fill: "#ff0000", hyperlink: null },
    { start: 3, end: 4, fill: "#112233", hyperlink: null },
    { start: 4, end: 6, fill: "#112233", hyperlink: { type: "URL", value: "https://example.com/application?stage=1#details" } },
    { start: 6, end: 8, fill: "#112233", hyperlink: null },
  ] });
  assertComplete(plan);
  assert.equal(plan.runs.map(run => plan.characters.slice(run.start, run.end)).join(""), source);
  assert.deepEqual(value, before);
});

test("explicit equal overrides remain separate from gaps; returned plans are owned and deterministic", () => {
  const value = node("ABCDE", [
    { start: 1, end: 2, fill: "#112233" },
    { start: 2, end: 3, textDecoration: "none" },
    { start: 3, end: 4, href: "mailto:person+case@example.com" },
  ]);
  Object.freeze(value.textRanges.ranges[2]); Object.freeze(value.textRanges.ranges);
  Object.freeze(value.textRanges); Object.freeze(value);
  const plan = nativeTextRangePlan(value), saved = JSON.stringify(plan);
  assert.deepEqual(plan.runs.map(run => [run.start, run.end]), [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]);
  plan.runs[3].hyperlink.value = "https://changed.example.com/";
  plan.runs[0].fill = "#ffffff"; plan.runs.pop();
  for (let i = 0; i < 4; i++) assert.equal(JSON.stringify(nativeTextRangePlan(value)), saved);
  assert.equal(value.textRanges.ranges[2].href, "mailto:person+case@example.com");
});

test("soft display LF never enter native characters and every authored LF/NBSP/scalar remains exact", () => {
  const source = "Alpha beta\n\n \u00a0😀 end ", value = node(source, [{ start: 6, end: 10, fill: "#ff0000" }]);
  value.textSource = source; value.textFlow = "wrap"; value.text = "Alpha \nbeta\n\n \u00a0😀 \nend ";
  const plan = nativeTextRangePlan(value);
  assert.equal(plan.characters, source); assertComplete(plan);
  assert.deepEqual(plan.runs.map(run => [run.start, run.end]), [[0, 6], [6, 10], [10, source.length]]);
  for (const display of [value.text.replace("beta", "Beta"), value.text.replace("\u00a0", " "), value.text.slice(0, -1)])
    rejected({ ...value, text: display }, "TEXT_RANGES_DISPLAY_MISMATCH");
  rejected({ ...value, textFlow: undefined }, "TEXT_RANGES_DISPLAY_MISMATCH");
});

test("uniform clearing and empty authored source produce complete base/null-link plans without inventing ranges", () => {
  const value = { type: "text", text: "A\n\nB\u00a0", fill: "#AABBCC" };
  assert.deepEqual(nativeTextRangePlan(value), { characters: value.text, runs: [{ start: 0, end: value.text.length, fill: "#aabbcc", hyperlink: null }] });
  assert.deepEqual(nativeTextRangePlan({ ...value, text: "" }), { characters: "", runs: [] });
  assert.deepEqual(nativeTextRangePlan(node("AB", [])), { characters: "AB", runs: [{ start: 0, end: 2, fill: "#112233", hyperlink: null }] });
});

test("unsupported decorations/paints/truncation and malformed/stale content fail atomically with bounded codes", () => {
  for (const change of [
    value => value.type = "rectangle",
    value => value.fill = "transparent", value => value.fill = "#123",
    value => value.fillPaints = [], value => value.fillPaints = [{ type: "solid", color: "#112233" }],
    value => value.textDecoration = "underline", value => value.textDecoration = "line-through",
    value => value.textDecorationThickness = { unit: "auto" }, value => value.textUnderlineOffset = { unit: "px", value: 1 },
    value => value.textDecorationSkipInk = "auto",
    value => value.textRanges.ranges[0].textDecoration = "underline",
    value => value.textRanges.ranges[0].textDecoration = "line-through",
    value => Object.assign(value.textRanges.ranges[0], { textDecoration: "underline", textUnderlineOffset: { unit: "em", value: .1578 } }),
    value => Object.assign(value.textRanges.ranges[0], { textDecoration: "underline", textDecorationThickness: { unit: "px", value: 1 } }),
    value => Object.assign(value.textRanges.ranges[0], { textDecoration: "underline", textDecorationSkipInk: "none" }),
    value => value.textOverflow = "ellipsis",
    value => value.textRanges.sourceSignature = '["stale"]',
    value => value.textSource = "other", value => value.textSource = 1,
    value => value.textRanges.ranges[0].fontWeight = 700,
    value => value.textRanges.ranges[0].start = .5,
    value => value.textRanges.ranges = Array(1),
    value => value.textRanges.ranges.push({ start: 2, end: 4, fill: "#123456" }),
    value => value.textRanges.ranges[0].fill = value.textRanges,
  ]) { const value = node(); change(value); rejected(value); }
  rejected(node("A😀B", [{ start: 1, end: 2, fill: "#123456" }]));
  rejected({ type: "text", text: "\ud800", fill: "#112233" });
  rejected(null, "TEXT_RANGES_NATIVE_INVALID_NODE");
  const inherited = node("ABCDE", [{ start: 0, end: 5, textDecoration: "none" }]);
  inherited.textDecoration = "underline"; rejected(inherited, "TEXT_RANGES_NATIVE_UNSUPPORTED_DECORATION");
});

test("native URL subset accepts literal HTTP(S)/bare mailto only and refuses actual fragment failure", () => {
  for (const href of ["https://example.com/a?b=c#d", "HTTP://example.com:8080/", "http://127.0.0.1/path", "mailto:person@example.com", "mailto:person+case@example.com"]) {
    const plan = nativeTextRangePlan(node("AB", [{ start: 0, end: 2, href }]));
    assert.equal(plan.runs[0].hyperlink.value, href);
  }
  for (const href of ["#", "#section", "tel:123", "/relative", "javascript:alert(1)", "data:text/plain,a",
    "https://user:pass@example.com/", "https://[:::]/", "https://[::1]/", "http://127.1/", "http://999.1.2.3/",
    "http://0x7f000001/", "http://0x/", "http://example.0xabc/", "http://0177.0.0.1/",
    "https://a-.example.com/", "https://example.com:70000/", "mailto:person", "mailto:person@example.com?subject=hello",
    "mailto:.person@example.com", "mailto:person..name@example.com", "mailto:person@a-.com"])
    rejected(node("AB", [{ start: 0, end: 2, href }]));
});

test("maximum range/gap budget remains complete; copy edits and save/reopen retain explicit inheritance", () => {
  const source = "x".repeat(130), ranges = Array.from({ length: 64 }, (_, index) => ({ start: index * 2 + 1, end: index * 2 + 2, fill: "#ff0000" }));
  const plan = nativeTextRangePlan(node(source, ranges)); assertComplete(plan);
  assert.equal(plan.runs.length, 129); assert.equal(plan.runs.length, MAX_NATIVE_TEXT_RANGE_RUNS);
  const escaped = node("\u0000".repeat(4000), [{ start: 0, end: 1, fill: "#ff0000" }]); escaped.textSource = escaped.text;
  assert.equal(nativeTextRangePlan(escaped).characters, escaped.text);
  rejected(node(source, [...ranges, { start: 129, end: 130, fill: "#ff0000" }]));
  const raw = plainFixture(), text = raw.pages[0].children[0].children[0];
  Object.assign(text, node("ABCDE", [{ start: 1, end: 2, fill: "#112233" }, { start: 3, end: 4, href: "https://example.com/" }]));
  const doc = normalizeDesignDocument(raw), current = doc.nodes.find(item => item.id === text.id);
  const saved = serializeDesignDocument(doc), reopened = normalizeDesignDocument(JSON.parse(saved)).nodes.find(item => item.id === text.id);
  assert.deepEqual(nativeTextRangePlan(reopened), nativeTextRangePlan(current));
  const scalarEdit = { ...reopened, fill: "#445566" }, changed = nativeTextRangePlan(scalarEdit);
  assert.equal(changed.runs[0].fill, "#445566"); assert.equal(changed.runs[1].fill, "#112233");
  const copied = replaceTextRange(scalarEdit, { start: 1, end: 2, text: "changed\n\n\u00a0", affinity: "after", expectedSourceSignature: scalarEdit.textRanges.sourceSignature });
  assertComplete(nativeTextRangePlan(copied)); assert.equal(nativeTextRangePlan(copied).characters, copied.textSource);
  assert.equal(serializeDesignDocument(doc), saved);
});

test("portable planner uses no DOM globals and never imports a native setter/runtime hook", async () => {
  const output = await build({ entryPoints: ["apps/design-studio/app/native-text-range-plan.mjs"], bundle: true, format: "iife", globalName: "NativeRanges", platform: "neutral", write: false, logLevel: "silent" });
  const value = node("A😀\nB", [{ start: 1, end: 3, href: "mailto:person@example.com" }]), context = { URL: undefined, TextEncoder: undefined, structuredClone: undefined, figma: undefined };
  runInNewContext(output.outputFiles[0].text + "\nglobalThis.result=NativeRanges.nativeTextRangePlan(JSON.parse(" + JSON.stringify(JSON.stringify(value)) + "));globalThis.globals=[typeof URL,typeof TextEncoder,typeof structuredClone,typeof figma];", context);
  assert.deepEqual([...context.globals], ["undefined", "undefined", "undefined", "undefined"]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.result)), nativeTextRangePlan(value));
  const source = await readFile(new URL("../../../apps/design-studio/app/native-text-range-plan.mjs", import.meta.url), "utf8");
  assert(!source.includes("setRange")); assert(!source.includes("assertNativeTextRangeBoundary"));
});

test("foreign accessors/serialization hooks never execute and foreign failures become bounded codes", () => {
  let calls = 0;
  for (const field of ["type", "text", "textSource", "fill", "textDecoration", "textOverflow", "textRanges"]) {
    const value = node();
    Object.defineProperty(value, field, { enumerable: true, get() { calls++; throw Error("x".repeat(9000)); } });
    assert.throws(() => nativeTextRangePlan(value), error => typeof error.code === "string" && error.message.length <= 240);
  }
  for (const field of ["fill", "start", "toJSON"]) {
    const value = node();
    Object.defineProperty(value.textRanges.ranges[0], field, { enumerable: true, get() { calls++; return "#ff0000"; } });
    assert.throws(() => nativeTextRangePlan(value), error => typeof error.code === "string" && error.message.length <= 240);
  }
  const serialization = node(); serialization.textRanges.toJSON = () => { calls++; return {}; };
  assert.throws(() => nativeTextRangePlan(serialization), error => error.code === "TEXT_RANGES_NATIVE_INVALID_SOURCE");
  const iterator = node(); iterator.textRanges.ranges[Symbol.iterator] = () => { calls++; throw Error("iterator"); };
  assert.throws(() => nativeTextRangePlan(iterator), error => error.code === "TEXT_RANGES_NATIVE_INVALID_SOURCE");
  const unrelated = node(); Object.defineProperty(unrelated, "unrelated", { get() { calls++; throw Error("unrelated"); } });
  assertComplete(nativeTextRangePlan(unrelated));
  const foreign = new Proxy({}, { getPrototypeOf() { throw Error("foreign".repeat(2000)); } });
  assert.throws(() => nativeTextRangePlan(foreign), error => error.code === "TEXT_RANGES_NATIVE_INVALID_SOURCE" && error.message.length <= 240);
  assert.equal(calls, 0);
});
