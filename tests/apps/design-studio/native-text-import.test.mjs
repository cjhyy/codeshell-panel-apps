import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { buildNativeTextRangeSource, importNativeTextRanges, nativeTextRangeSnapshot } from "../../../apps/design-studio/app/native-text-ranges-source.mjs";
import { admitNativeTextImport } from "../../../apps/design-studio/app/native-text-import.mjs";
import { buildNativeTextRangeHint } from "../../../apps/design-studio/app/native-text-range-hint.mjs";
import { nativeTextLineHeight } from "../../../apps/design-studio/app/text-line-height.mjs";
import { measureFigmaTextDocument } from "../../../apps/design-studio/app/text-metrics.mjs";
import { nativeTextContent } from "../../../apps/design-studio/app/text-content.mjs";
import { textRangeSourceSignature, replaceTextValue, projectTextRanges } from "../../../apps/design-studio/app/text-ranges.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";

const bytes = await readFile(new URL("../../fixtures/design-studio/native-text-field-matrix-1ed86d39.json", import.meta.url));
const fixture = JSON.parse(bytes), copy = value => structuredClone(value);
function source(index = 0) {
  const actual = fixture.cases[index], rest = copy(actual.rest);
  const built = buildNativeTextRangeSource({ rest, ...copy(actual.capture.observations) });
  assert.equal(built.status, "bound");
  return { rest, source: built.source };
}
function document(patch) {
  return normalizeDesignDocument({ format: "codeshell.design", version: 3, name: "Native import",
    canvas: { width: 640, height: 480, background: "#ffffff" }, tokens: { colors: [] }, resources: [],
    activePageId: "page-1", pages: [{ id: "page-1", name: "Page", children: [{
      id: "text-1", type: "text", name: "Text", x: 20, y: 20, width: 400, height: 80,
      stroke: "transparent", strokeWidth: 0, opacity: 1, rotation: 0, cornerRadius: 0,
      visible: true, locked: false, ...patch,
    }] }] });
}

test("retained actual4 SDK sources project native metrics through exact save/reopen without changing raw values or LF ranges", () => {
  for (let index = 0; index < fixture.cases.length; index++) {
    const input = source(index), before = JSON.stringify(input), snapshot = nativeTextRangeSnapshot(input.source);
    const result = admitNativeTextImport(input);
    assert.equal(result.status, index === 0 ? "uniform" : "admitted-intent");
    assert.equal(result.pixelsVerified, false);
    assert.equal(result.paintLinkOnly, true);
    assert.equal(result.ownMixedPreview, index === 1 || index === 3);
    const ratio = index === 3 ? 1.3157999515533447 : 1.2000000476837158;
    assert.equal(result.patch.lineHeight, ratio);
    assert.equal(nativeTextLineHeight(result.patch).value, input.source.scalars.lineHeight.value.value);
    const normalized = document(result.patch), serialized = serializeDesignDocument(normalized);
    const reopened = normalizeDesignDocument(JSON.parse(serialized));
    assert.equal(serializeDesignDocument(reopened), serialized);
    assert.equal(reopened.nodes[0].lineHeight, ratio);
    assert.equal(nativeTextLineHeight(reopened.nodes[0]).value, input.source.scalars.lineHeight.value.value);
    if (index === 1 || index === 3) assert.deepEqual(reopened.nodes[0].textRanges.ranges,
      [{ start: 4, end: 11, fill: "#1d70b8", href: "https://example.com/" }]);
    assert.equal(JSON.stringify(input), before);
    assert.equal(nativeTextRangeSnapshot(input.source), snapshot);
  }
});

test("bound partial catalogs and getter checks cannot mint production admission", () => {
  for (const mutate of [
    value => delete value.source.scalars.textStyleId,
    value => delete value.source.segments[0].values.textStyleId,
    value => value.source.rangeChecks = [],
    value => delete value.source.rangeChecks[0].values.hyperlink,
  ]) {
    const input = source(); mutate(input);
    // The old codec intentionally accepts some evidence subsets; production
    // admission must separately require the complete capture catalog.
    const old = importNativeTextRanges({ ...input, canonicalNode: fixture.cases[0].canonical });
    assert.equal(old.status, "uniform");
    assert.equal(admitNativeTextImport(input).status, "unsupported");
  }
});

test("bad author hints preserve independently recovered current intent and valid hints restore only fill/ranges", () => {
  const input = source(2), independent = admitNativeTextImport(input);
  const author = { ...fixture.cases[2].canonical, fill: "#ff0000", textRanges: independent.patch.textRanges };
  const hint = buildNativeTextRangeHint({ ...input, authorNode: author, pluginId: "native-import-test", key: "codeshellTextRangeIntent" });
  const restored = admitNativeTextImport({ ...input, hint, pluginId: "native-import-test" });
  assert.equal(restored.patch.fill, "#ff0000");
  assert.deepEqual(restored.patch.textRanges, author.textRanges);
  assert.equal(restored.patch.lineHeight, independent.patch.lineHeight);
  for (const bad of ["{bad", { ...hint, snapshot: "old" }, { ...hint, lineHeight: 1.2 },
    { ...hint, nodeId: "another" }, "x".repeat(65537), null]) {
    const result = admitNativeTextImport({ ...input, hint: bad, pluginId: "native-import-test" });
    assert.deepEqual(result.patch, independent.patch);
    assert.equal(result.status, independent.status);
    assert(result.diagnostics.some(note => note.code.includes("HINT")));
  }
  assert.deepEqual(admitNativeTextImport({ ...input, hint }).patch, independent.patch);
});

test("public data cannot suppress mask/paint fallback or revive reserved raw source lookalikes", () => {
  const input = source(1); assert.equal(admitNativeTextImport(input).ownMixedPreview, true);
  for (const restPatch of [
    { isMask: true }, { children: [{}] }, { children: null }, { blendMode: "MULTIPLY" },
    { strokes: [{ type: "SOLID", visible: true }] }, { effects: [{ type: "DROP_SHADOW" }] },
  ]) {
    const changed = { ...input, rest: { ...input.rest, ...restPatch } };
    assert.notEqual(admitNativeTextImport(changed).ownMixedPreview, true);
  }
  for (const key of ["codeshellNativeTextRanges", "codeshellNativeTextRangeHint", "codeshellTextRangeIntent", "nativeTextRanges"]) {
    const changed = { ...input, rest: { ...input.rest, [key]: input.source } };
    assert.equal(admitNativeTextImport(changed).status, "unsupported");
    assert.equal(admitNativeTextImport({ rest: changed.rest }).status, "unsupported");
  }
});


test("explicit whitespace, NBSP, CRLF and empty sources survive measurement, edits and save/reopen", async () => {
  const base = admitNativeTextImport(source()).patch;
  const nbsp = String.fromCharCode(0xA0), crlf = String.fromCharCode(13, 10), lf = String.fromCharCode(10);
  assert.equal(nbsp.codePointAt(0), 0xA0);
  assert.deepEqual([...crlf].map(character => character.charCodeAt(0)), [13, 10]);
  const emoji = String.fromCodePoint(0x1F600);
  assert.deepEqual([emoji.charCodeAt(0), emoji.charCodeAt(1)], [0xD83D, 0xDE00]);
  const authoredMixed = "A" + emoji + crlf + "B" + lf + " ";
  assert.deepEqual([...authoredMixed].flatMap(character => character === emoji ? [0xD83D, 0xDE00] : [character.charCodeAt(0)]),
    [65, 0xD83D, 0xDE00, 13, 10, 66, 10, 32]);
  assert.equal(authoredMixed.indexOf(lf), 4); assert.equal(authoredMixed.lastIndexOf(lf), 6);
  for (const authored of ["    ", nbsp + nbsp, " " + crlf + " ", authoredMixed, ""]) {
    const patch = { ...base, text: authored, textSource: authored };
    if (authored.length) patch.textRanges = { version: 1, sourceSignature: textRangeSourceSignature(authored),
      ranges: [{ start: 0, end: authored.length, fill: "#1d70b8" }] };
    else { delete patch.textRanges; delete patch.textFlow; }
    const state = document(patch), node = state.nodes[0];
    node.width = 12; node.height = 1; node.layoutSizingVertical = "hug";
    const measured = await measureFigmaTextDocument(state, { sourceNodes: new Map([["sdk", { style: { textAutoResize: "HEIGHT" } }]]),
      sourceIds: new Map([[node.id, "sdk"]]), measurer: { configure() {}, fontAvailable: () => true,
        measure: text => ({ width: [...text].length * 8, bottom: 20,
          ink: { x: 0, y: 0, width: [...text].length * 8, height: 20 } }) } });
    assert.equal(measured.measured, 1);
    assert.equal(node.textSource, authored); assert.equal(nativeTextContent(node), authored);
    assert.equal(Object.hasOwn(node, "textSource"), true);
    assert.equal(node.textFlow, authored.length ? "wrap" : undefined);
    if (authored.length) {
      assert.equal(projectTextRanges(node).filter(run => run.kind === "source").map(run => run.text).join(""), authored);
      assert.deepEqual(node.textRanges.ranges, patch.textRanges.ranges);
    }
    assert(node.height >= 20);
    const saved = serializeDesignDocument(state), reopened = normalizeDesignDocument(JSON.parse(saved));
    assert.deepEqual(JSON.parse(serializeDesignDocument(reopened)), JSON.parse(saved));
    assert.equal(reopened.nodes[0].textSource, authored);
    const edited = replaceTextValue(reopened.nodes[0], " " + nbsp + " ");
    assert.equal(edited.textSource, " " + nbsp + " ");
    if (authored.length) assert.equal(edited.textFlow, "wrap");
    const cleared = replaceTextValue(edited, "");
    assert.equal(cleared.textSource, ""); assert.equal(Object.hasOwn(cleared, "textSource"), true);
    assert.equal(cleared.textFlow, undefined);
    assert.equal(document(cleared).nodes[0].textSource, "");
  }
  assert.throws(() => document({ ...base, text: " ", textSource: " ", textOverflow: "ellipsis" }), /文字属性/);
});

test("argument/accessor/toJSON inputs cannot execute hooks or hide the complete source budget", () => {
  let calls = 0;
  const input = source();
  const poisonous = { ...input.rest, unknown: "x".repeat(400000), toJSON() { calls++; return input.rest; } };
  assert.equal(admitNativeTextImport({ ...input, rest: poisonous }).status, "unsupported");
  const restAccessor = {};
  Object.defineProperty(restAccessor, "rest", { enumerable: true, get() { calls++; throw Error("Do not execute"); } });
  assert.doesNotThrow(() => assert.equal(admitNativeTextImport(restAccessor).status, "unsupported"));
  const nested = { ...input.rest };
  Object.defineProperty(nested, "unknown", { enumerable: true, get() { calls++; return 1; } });
  assert.equal(admitNativeTextImport({ ...input, rest: nested }).status, "unsupported");
  const baseline = admitNativeTextImport(input);
  const badHint = {}; Object.defineProperty(badHint, "snapshot", { enumerable: true, get() { calls++; return ""; } });
  assert.deepEqual(admitNativeTextImport({ ...input, hint: badHint, pluginId: "test" }).patch, baseline.patch);
  assert.equal(calls, 0);
});

test("production bridge preserves supplemental raw bytes through binding and bypasses only its own mixed Text preview", async () => {
  const { prepareFigmaImport } = await import("../../../apps/design-studio/app/figma-bridge.mjs");
  const { createFigmaBinding, parseFigmaBinding } = await import("../../../apps/design-studio/app/figma-binding.mjs");
  const input = source(1), id = input.rest.id;
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7S8AAAAASUVORK5CYII=";
  const envelope = rest => ({ nodes: { "0:1": { document: { id: "0:1", type: "CANVAS", children: [rest] } } },
    nativeTextRanges: { version: 1, nodes: { [id]: { source: input.source, hint: "stale-not-json" } } },
    assets: { preview: { mime: "image/png", base64: png } },
    previews: { [id]: { assetId: "preview", bounds: input.rest.absoluteBoundingBox } } });
  const options = { sha256Bytes: async bytes => createHash("sha256").update(bytes).digest("hex") };
  const retained = JSON.stringify(input.source), result = await prepareFigmaImport(envelope(input.rest), options);
  const node = result.document.nodes[0];
  assert.equal(node.type, "text"); assert.equal(node.textSource, input.rest.characters);
  assert(node.textRanges); assert.equal(node.lineHeight, input.source.scalars.lineHeight.value.value / 100);
  assert.equal(JSON.stringify(result.source.nativeTextRanges.nodes[id].source), retained);
  assert(result.source.previews[id]); assert(result.source.assets.preview, "raw fallback remains available");
  const binding = parseFigmaBinding(JSON.stringify(createFigmaBinding(result)));
  assert.equal(JSON.stringify(binding.source.nativeTextRanges.nodes[id].source), retained);
  const reopened = JSON.parse(serializeDesignDocument(result.document));
  assert.equal(reopened.pages[0].children[0].lineHeight, node.lineHeight);
  for (const mutate of [rest => rest.isMask = true,
    rest => rest.fills = [{ type: "GRADIENT_RADIAL", gradientStops: [] }],
    rest => rest.effects = [{ type: "DROP_SHADOW", visible: true }]]) {
    const rest = copy(input.rest); mutate(rest);
    const fallback = await prepareFigmaImport(envelope(rest), options);
    assert.equal(fallback.document.nodes[0].type, "image");
  }
  const ancestor = envelope({ id: "frame", type: "FRAME", isMask: true,
    absoluteBoundingBox: input.rest.absoluteBoundingBox, children: [input.rest] });
  ancestor.previews.frame = ancestor.previews[id];
  assert.equal((await prepareFigmaImport(ancestor, options)).document.nodes[0].type, "image");
  const malformed = envelope({ ...input.rest, children: {} });
  await assert.rejects(() => prepareFigmaImport(malformed, options), /children/u);
});

test("complete source envelope budget and descriptors apply before every supplemental public import route", async () => {
  const { normalizeFigmaSource } = await import("../../../apps/design-studio/app/figma-assets.mjs");
  const { importFigmaJson } = await import("../../../apps/design-studio/app/figma-bridge.mjs");
  const input = source(), id = input.rest.id;
  const envelope = { nodes: { [id]: { document: input.rest } },
    nativeTextRanges: { version: 1, nodes: { [id]: { source: input.source } } } };
  // A valid node has a small proof; only the aggregate unknown raw metadata
  // crosses16MiB. No hook may conceal those bytes.
  const huge = { ...copy(envelope), unknownRaw: "x".repeat(16 * 1024 * 1024) };
  assert.throws(() => normalizeFigmaSource(huge)); assert.throws(() => importFigmaJson(huge));
  let calls = 0;
  for (const value of [{ ...huge, toJSON() { calls++; return envelope; } },
    Object.defineProperty(copy(envelope), "nativeTextRanges", { enumerable: true, get() { calls++; return envelope.nativeTextRanges; } }),
    { ...copy(envelope), nested: Object.defineProperty({}, "payload", { enumerable: true, get() { calls++; return 1; } }) }]) {
    assert.throws(() => normalizeFigmaSource(value)); assert.throws(() => importFigmaJson(value));
  }
  assert.equal(calls, 0);
  const multibyte = { ...copy(envelope), unknownRaw: String.fromCodePoint(0x1f600).repeat(4 * 1024 * 1024) };
  assert(multibyte.unknownRaw.length < 16 * 1024 * 1024);
  assert.throws(() => normalizeFigmaSource(multibyte)); assert.throws(() => importFigmaJson(multibyte));
  const legacy = copy(envelope); delete legacy.nativeTextRanges;
  assert.equal(normalizeFigmaSource(legacy).nativeTextRanges, undefined);
  assert.doesNotThrow(() => importFigmaJson(legacy));
  for (const malformed of [null, {}, { version: 2, nodes: {} }, { version: 1, nodes: [] }]) {
    const invalid = { ...copy(envelope), nativeTextRanges: malformed };
    assert.throws(() => normalizeFigmaSource(invalid), error => error.code === "NATIVE_TEXT_IMPORT_TABLE");
    assert.throws(() => importFigmaJson(invalid), error => error.code === "NATIVE_TEXT_IMPORT_TABLE");
  }
  const overlap = copy(envelope); overlap.nodes.parent = { document: { id: "frame", type: "FRAME", children: [copy(input.rest)] } };
  overlap.nodes.parent.document.children[0].style.unknownFutureField = "different";
  assert.throws(() => importFigmaJson(overlap), error => error.code === "FIGMA_SOURCE_DUPLICATE_ID_CONFLICT");
  const orphan = copy(envelope); orphan.nativeTextRanges.nodes.orphan = orphan.nativeTextRanges.nodes[id];
  assert.throws(() => importFigmaJson(orphan), error => error.code === "NATIVE_TEXT_IMPORT_TABLE_OWNER");
});

test("complete uniform paint/link evidence retains existing HUG Grid flow while incomplete or paragraph variants stay refused", async () => {
  const { importFigmaJson, createFigmaTransfer } = await import("../../../apps/design-studio/app/figma-bridge.mjs");
  const { applyAutoLayouts } = await import("../../../apps/design-studio/app/layout.mjs");
  const { nativeGridPlan } = await import("../../../apps/design-studio/app/grid.mjs");
  const actualTree = JSON.parse(await readFile(new URL("../../fixtures/design-studio-native-padded-row-grid/native-source.json", import.meta.url)));
  const flat = node => [node, ...(node.children ?? []).flatMap(flat)];
  // Synthetic composition of two retained sources, not a new native receipt.
  const sourceTree = copy(actualTree), nodes = flat(sourceTree.document), target = nodes.find(node => node.type === "TEXT");
  const row = nodes.find(node => node.layoutMode === "GRID"), actual = fixture.cases[1];
  for (const key of ["characters", "fills", "characterStyleOverrides", "styleOverrideTable", "style"])
    target[key] = copy(actual.rest[key]);
  target.lineTypes = ["NONE", "NONE"]; target.lineIndentations = [0, 0];
  const built = buildNativeTextRangeSource({ rest: target, ...copy(actual.capture.observations) });
  assert.equal(built.status, "bound");
  sourceTree.nativeTextRanges = { version: 1, nodes: { [target.id]: { source: built.source } } };
  const imported = importFigmaJson(sourceTree), id = raw => "figma-" + raw.replace(":", "-");
  const canonicalRow = imported.document.nodes.find(node => node.id === id(row.id));
  const canonicalText = imported.document.nodes.find(node => node.id === id(target.id));
  assert.equal(canonicalRow.layout, "grid"); assert.equal(canonicalRow.layoutSizingVertical, "hug");
  assert.equal(canonicalText.layoutSizingHorizontal, "fill"); assert.equal(canonicalText.layoutSizingVertical, "hug");
  assert(canonicalText.textRanges); assert.equal(canonicalText.lineHeight, built.source.scalars.lineHeight.value.value / 100);
  assert(!imported.warnings.some(note => note.message?.includes("原生 Grid 无法表示")));
  const owner = imported.document.nodes.find(node => node.id === canonicalRow.parentId);
  assert.doesNotThrow(() => nativeGridPlan(canonicalRow, owner));
  const before = canonicalText.height;
  const measurer = { configure() {}, fontAvailable: () => true,
    measure: text => ({ width: Array.from(text).length * 8, bottom: 20,
      ink: { x: 0, y: 0, width: Array.from(text).length * 8, height: 20 } }) };
  const nested = normalizeDesignDocument(JSON.parse(serializeDesignDocument(imported.document)));
  const nestedText = nested.nodes.find(node => node.id === canonicalText.id);
  const edited = replaceTextValue(nestedText, "A😀 linked\nend\nextra authored row");
  for (const key of Object.keys(nestedText)) if (!Object.hasOwn(edited, key)) delete nestedText[key];
  Object.assign(nestedText, edited);
  applyAutoLayouts(nested.nodes, [nestedText.id], { textMeasurer: measurer });
  assert(nestedText.height > before);
  assert.equal(nestedText.textSource, "A😀 linked\nend\nextra authored row");
  assert.equal(nested.nodes.find(node => node.id === canonicalRow.id).layout, "grid");
  assert(!createFigmaTransfer(nested).warnings.some(note => note.code === "grid-export"));
  for (const mutate of [tree => delete tree.nativeTextRanges.nodes[target.id].source.scalars.fontWeight,
    tree => flat(tree.document).find(node => node.id === target.id).lineTypes = ["BULLETED", "NONE"]]) {
    const refused = copy(sourceTree); mutate(refused);
    const result = importFigmaJson(refused);
    assert.equal(result.document.nodes.find(node => node.id === canonicalRow.id).layout, "none");
    assert(result.warnings.some(note => note.message?.includes("原生 Grid 无法表示")));
  }
});


test("uniform SDK font weight must preserve the observed named face or an explicit supported axis", () => {
  const input = source(), observations = copy(fixture.cases[0].capture.observations);
  input.rest.style.fontWeight = 700; observations.scalars.fontWeight.value = 700;
  for (const segment of observations.segments) segment.values.fontWeight.value = 700;
  const built = buildNativeTextRangeSource({ rest: input.rest, ...observations });
  assert.equal(built.status, "bound");
  assert.equal(admitNativeTextImport({ rest: input.rest, source: built.source }).status, "unsupported");
});

test("literal native family names cannot become CSS lists, stripped quotes or generic fallback before preview bypass", async () => {
  const { designFontFamilyCss } = await import("../../../apps/design-studio/app/font-css.mjs");
  const { prepareFigmaImport } = await import("../../../apps/design-studio/app/figma-bridge.mjs");
  assert.equal(designFontFamilyCss("Example, Family"), '"Example", "Family"');
  assert.equal(designFontFamilyCss('"Quoted Face"'), '"Quoted Face"');
  assert.equal(designFontFamilyCss("SeRiF"), "serif");
  for (const family of ["Example, Family", '"Quoted Face"', "'Quoted Face'", "serif", "SeRiF", "system-ui", "emoji", "Back\\slash"]) {
    const input = source(1), observations = copy(fixture.cases[1].capture.observations);
    input.rest.style.fontFamily = family; observations.scalars.fontName.value.family = family;
    for (const segment of observations.segments) segment.values.fontName.value.family = family;
    const built = buildNativeTextRangeSource({ rest: input.rest, ...observations });
    assert.equal(built.status, "bound");
    const before = JSON.stringify({ rest: input.rest, source: built.source });
    const result = admitNativeTextImport({ rest: input.rest, source: built.source });
    assert.equal(result.status, "unsupported"); assert.equal(result.ownMixedPreview, undefined);
    assert.equal(JSON.stringify({ rest: input.rest, source: built.source }), before);
    const id = input.rest.id;
    const envelope = { nodes: { "0:1": { document: { id: "0:1", type: "CANVAS", children: [input.rest] } } },
      nativeTextRanges: { version: 1, nodes: { [id]: { source: built.source } } },
      assets: { preview: { mime: "image/png", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7S8AAAAASUVORK5CYII=" } },
      previews: { [id]: { assetId: "preview", bounds: input.rest.absoluteBoundingBox } } };
    const imported = await prepareFigmaImport(envelope, { sha256Bytes: async bytes => createHash("sha256").update(bytes).digest("hex") });
    assert.equal(imported.document.nodes[0].type, "image");
    assert.equal(JSON.stringify(imported.source.nativeTextRanges.nodes[id].source), JSON.stringify(built.source));
    assert(imported.warnings.some(note => note.code === "native-text-source-unsupported"));
  }
});
