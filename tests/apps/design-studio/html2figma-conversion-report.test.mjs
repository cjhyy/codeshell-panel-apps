import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { importFigmaJson, normalizeHtml2FigmaJson, prepareFigmaImport } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { normalizeFigmaSource } from "../../../apps/design-studio/app/figma-assets.mjs";

const frame = (id = "root", extra = {}) => ({ id, type: "FRAME", name: id, x: 0, y: 0, width: 300, height: 200, children: [], ...extra });
const ready = () => ({ version: 1, ready: true, partial: false, errors: [], warnings: [] });
const incomplete = () => ({ version: 1, ready: false, partial: true,
  errors: [{ code: "GENERATED_GLYPH_UNOBSERVED", message: "Missing generated hyphen observation", sourceOffset: 3, sourcePath: [0, 1], nodeId: "text" }], warnings: [] });
const sha256Bytes = async bytes => createHash("sha256").update(bytes).digest("hex");

test("an incomplete root is rejected by sync, normalization and async preparation before resource side effects", async () => {
  const input = frame("partial", { conversionReport: incomplete() }), before = structuredClone(input);
  const expected = error => error.code === "CONVERSION_INCOMPLETE" && /原生文字布局|glyph/u.test(error.message);
  assert.throws(() => normalizeHtml2FigmaJson(input), expected);
  assert.throws(() => importFigmaJson(input), expected);
  let resources = 0;
  await assert.rejects(prepareFigmaImport(input, { sha256Bytes: async bytes => { resources++; return sha256Bytes(bytes); },
    readFontBytes: async () => { resources++; throw Error("must not prepare fonts"); } }), expected);
  assert.equal(resources, 0); assert.deepEqual(input, before);
});

test("every array design root report is legal and one incomplete root rejects the entire batch", async () => {
  const left = frame("left", { conversionReport: ready() }), right = frame("right", { conversionReport: ready() });
  right.conversionReport.warnings.push({ code: "OBSERVED", message: "Independent root proof", sourceOffset: 0, sourcePath: [] });
  for (const input of [[left, right], { nodes: [left, right] }, { nodes: [left, right], conversionReport: ready() }]) {
    const before = structuredClone(input), result = await prepareFigmaImport(input, { sha256Bytes });
    const roots = Object.values(result.source.nodes).map(entry => entry.document);
    assert.deepEqual(roots.map(root => root.conversionReport), [left.conversionReport, right.conversionReport]);
    assert.deepEqual(input, before);
    const bad = structuredClone(input), rootsIn = Array.isArray(bad) ? bad : bad.nodes;
    rootsIn[1].conversionReport = incomplete();
    assert.throws(() => importFigmaJson(bad), { code: "CONVERSION_INCOMPLETE" });
    await assert.rejects(prepareFigmaImport(bad, { sha256Bytes }), { code: "CONVERSION_INCOMPLETE" });
  }
});

test("valid envelope and per-root proof survive both normalization passes without masking one another", async () => {
  const envelope = ready(), rootReport = ready();
  envelope.warnings = [{ code: "ENVELOPE_PROOF", message: "Envelope" }];
  rootReport.warnings = [{ code: "ROOT_PROOF", message: "Root", nodeId: "root" }];
  const input = { nodes: [frame("root", { conversionReport: rootReport })], conversionReport: envelope };
  const normalized = normalizeHtml2FigmaJson(input), source = normalizeFigmaSource(normalized);
  assert.deepEqual(normalized.conversionReport, envelope); assert.deepEqual(source.conversionReport, envelope);
  assert.deepEqual(Object.values(source.nodes)[0].document.conversionReport, rootReport);
  assert.equal(importFigmaJson(source).document.nodes.length, 1);
  assert.deepEqual((await prepareFigmaImport(input, { sha256Bytes })).source.conversionReport, envelope);
  for (const bad of [{ ...input, conversionReport: incomplete() }, { ...input, nodes: [frame("root", { conversionReport: incomplete() })] }])
    assert.throws(() => importFigmaJson(bad), { code: "CONVERSION_INCOMPLETE" });
});

test("REST file/document and selected-node wrappers validate each actual design root report", () => {
  const root = { id: "rest", type: "FRAME", name: "REST", absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 80 }, children: [], conversionReport: ready() };
  for (const input of [root, { document: root }, { nodes: { selected: { document: root } } },
    { format: "codeshell.figma.source", version: 1, nodes: { selected: { document: root } }, conversionReport: ready() }]) {
    assert.equal(importFigmaJson(input).document.nodes.length, 1);
    const bad = structuredClone(input), owner = bad.document ?? bad.nodes?.selected.document ?? bad;
    owner.conversionReport = incomplete();
    assert.throws(() => importFigmaJson(bad), { code: "CONVERSION_INCOMPLETE" });
  }
});

test("reports inside children or unrelated metadata are invalid even beneath a ready root", () => {
  const child = frame("child", { conversionReport: ready() });
  for (const input of [frame("parent", { conversionReport: ready(), children: [child] }),
    [frame("parent", { children: [child] })], { nodes: [frame("parent", { children: [child] })], conversionReport: ready() },
    frame("parent", { sharedPluginData: { conversionReport: ready() } })])
    assert.throws(() => importFigmaJson(input), { code: "CONVERSION_REPORT_INVALID" });
});

test("present reports have exact fields, strict diagnostics and consistent readiness", () => {
  const invalid = [undefined, null, [], { ...ready(), version: "1" }, { ...ready(), ready: 1 },
    { ...ready(), partial: true }, { ...ready(), errors: {} }, { ...ready(), warnings: ["warning"] },
    { ...ready(), extra: false }, { ...ready(), warnings: [{ code: "W", message: "m", extra: 1 }] },
    { ...ready(), warnings: [{ code: "W", message: "m", sourceOffset: -1 }] },
    { ...ready(), warnings: [{ code: "W", message: "m", sourceOffset: 1.5 }] },
    { ...ready(), warnings: [{ code: "W", message: "m", sourcePath: ["0"] }] },
    { ...ready(), warnings: [{ code: "W", message: "m", sourcePath: [-1] }] },
    { ...ready(), warnings: [{ code: "W", message: "m", nodeId: 1 }] },
    { ...ready(), warnings: [{ code: " ", message: "m" }] },
    { ...ready(), warnings: [{ code: "W", message: " " }] },
    { ...ready(), warnings: [{ code: "W", message: "m", nodeId: " " }] }];
  for (const report of invalid) assert.throws(() => importFigmaJson(frame("invalid", { conversionReport: report })), { code: "CONVERSION_REPORT_INVALID" });
  assert.throws(() => importFigmaJson(frame("errors", { conversionReport: { ...ready(), errors: incomplete().errors } })), { code: "CONVERSION_INCOMPLETE" });
  assert.throws(() => importFigmaJson(frame("unobserved", { conversionReport: { ...incomplete(), errors: [] } })), { code: "CONVERSION_INCOMPLETE" });
  let getterCalls = 0; const report = ready(); Object.defineProperty(report, "ready", { enumerable: true, get() { getterCalls++; return true; } });
  assert.throws(() => importFigmaJson(frame("getter", { conversionReport: report })), { code: "CONVERSION_REPORT_INVALID" });
  assert.equal(getterCalls, 0);
});

test("legacy report-free shapes remain compatible and independently observed glyph Text never enters source characters", async () => {
  for (const input of [frame(), [frame()], { nodes: [frame()] }]) assert.equal(importFigmaJson(input).document.nodes.length, 1);
  const metadata = { kind: "hyphen", sourceOffset: 2, sourceText: "authentication", text: "-", observation: "cdp", sourcePath: [0] };
  const text = (id, characters, x) => ({ id, type: "TEXT", name: id, x, y: 20, width: 100, height: 24, characters,
    fontName: { family: "Roboto", style: "Regular" }, fontSize: 16, fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }] });
  for (const visibleGlyph of ["-", ""]) {
    const glyph = text("glyph", visibleGlyph, 120); glyph.sharedPluginData = { generatedText: JSON.stringify({ ...metadata, text: visibleGlyph }) };
    const input = frame("observed", { conversionReport: ready(), children: [text("source", "au\nthentication", 20), glyph] }), before = structuredClone(input);
    const result = await prepareFigmaImport(input, { sha256Bytes });
    assert.deepEqual(result.document.nodes.filter(node => node.type === "text").map(node => node.text), ["au\nthentication", visibleGlyph]);
    const original = Object.values(result.source.nodes)[0].document;
    assert.equal(original.children[1].sharedPluginData.generatedText, glyph.sharedPluginData.generatedText);
    assert.equal(original.children[0].characters, "au\nthentication"); assert.deepEqual(input, before);
  }
});
