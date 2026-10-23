import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { figmaSourceNodes, createFigmaBinding, parseFigmaBinding, createFigmaPatch }
  from "../../../apps/design-studio/app/figma-binding.mjs";
import { prepareFigmaImport } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { MAX_FIGMA_SOURCE_BYTES } from "../../../apps/design-studio/app/figma-assets.mjs";
import { createNativeNotesExportCapture } from "../../../apps/design-studio/app/figma-plugin/notes-runtime.mjs";

const copy = value => structuredClone(value);
const box = { x: 0, y: 0, width: 100, height: 60 };
const matrix = [[1, 0, 0], [0, 1, 0]];
function leaf() {
  return { id: "1:3", type: "TEXT", characters: "A😀 link\nend", absoluteBoundingBox: { ...box },
    style: { fontFamily: "Inter", fontSize: 20, futureTypography: { enabled: true } },
    styles: { text: "S:1" }, fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
    // Synthetic raw metadata control, not a new SDK execution or active codec.
    codeshellNativeTextRanges: { version: 1, nodeId: "1:3", characters: "A😀 link\nend", restSignature: "raw-rest-signature",
      scalars: { hyperlink: { kind: "value", value: 1 }, fontStyle: { kind: "missing" } },
      segments: [{ start: 0, end: 12, characters: "A😀 link\nend", values: {
        lineHeight: { kind: "value", value: { unit: "PERCENT", value: 131.57999515533447 } },
        textDecorationOffset: { kind: "value", value: { unit: "PERCENT", value: 15.779999732971191 } },
      } }], rangeChecks: [{ start: 0, end: 12, values: { hyperlink: { kind: "value", value: 1 } } }] },
  };
}
function overlap() {
  const child = { id: "1:2", type: "FRAME", name: "Child", absoluteBoundingBox: { ...box },
    children: [leaf()], pluginData: { savedIntent: "original" }, futureAppearance: { order: ["a", "b"] } };
  const ancestor = { id: "1:1", type: "FRAME", name: "Ancestor", absoluteBoundingBox: { ...box }, children: [child] };
  return { format: "codeshell.figma.source", version: 1, name: "Own overlap fixture",
    nodes: { "1:1": { document: ancestor }, "1:2": { document: copy(child) } }, assets: {}, previews: {},
    selection: { pageId: "0:1", pageName: "Own page", roots: {
      "1:1": { parentId: "0:1", parentTransform: copy(matrix), absoluteTransform: copy(matrix), width: 100, height: 60 },
      "1:2": { parentId: "1:1", parentTransform: copy(matrix), absoluteTransform: copy(matrix), width: 100, height: 60 },
    } },
  };
}
const conflict = fn => assert.throws(fn, error => error.code === "FIGMA_SOURCE_DUPLICATE_ID_CONFLICT" && error.message.length < 300);
const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value;

test("identical selected ancestor/root overlap retains exact first raw objects and ignores only object key order", () => {
  const source = overlap(), original = source.nodes["1:1"].document.children[0], before = JSON.stringify(source);
  source.nodes["1:2"].document = reverseKeys(source.nodes["1:2"].document);
  const expected = JSON.stringify(source), nodes = figmaSourceNodes(source);
  assert.equal(nodes.size, 3); assert.equal(nodes.get("1:2"), original); assert.equal(nodes.get("1:3"), original.children[0]);
  assert.equal(JSON.stringify(source), expected); assert.notEqual(expected, before);
  const rootFirst = { ...source, nodes: { "1:2": source.nodes["1:2"], "1:1": source.nodes["1:1"] } };
  assert.equal(figmaSourceNodes(rootFirst).get("1:2"), source.nodes["1:2"].document);
});

test("full raw duplicate conflicts include appearance, unknown keys, style refs and complete nested source metadata", () => {
  for (const mutate of [
    node => { node.pluginData.savedIntent = "changed"; },
    node => { node.futureAppearance.order.reverse(); },
    node => { node.futureAppearance.optional = null; },
    node => { node.children[0].fills[0].color.g = .25; },
    node => { node.children[0].style.futureTypography.enabled = false; },
    node => { node.children[0].styles.text = "S:2"; },
    node => { node.children[0].codeshellNativeTextRanges.rangeChecks[0].values.hyperlink.value = null; },
    node => { node.children[0].codeshellNativeTextRanges.scalars.fontStyle = { kind: "error", message: "unavailable" }; },
    node => { node.children[0].codeshellNativeTextRanges.segments[0].values.lineHeight.value.value += 1e-7; },
    node => { delete node.children[0].codeshellNativeTextRanges; },
    node => { node.children.push({ id: "1:4", type: "VECTOR", futureGeometry: { vertices: [1, 2] } }); },
  ]) {
    const source = overlap(); mutate(source.nodes["1:2"].document); const before = JSON.stringify(source);
    conflict(() => figmaSourceNodes(source)); assert.equal(JSON.stringify(source), before);
  }
});

test("duplicate equality retains descendant order, property presence and unknown data instead of shallow matching", () => {
  for (const mutate of [
    node => { node.children.reverse(); },
    node => { delete node.futureAppearance; },
    node => { node.children[0].future = null; },
    node => { node.children[0].future = []; },
  ]) {
    const source = overlap(), parent = source.nodes["1:1"].document.children[0];
    parent.children.push({ id: "1:4", type: "VECTOR", children: [] });
    source.nodes["1:2"].document = copy(parent); mutate(source.nodes["1:2"].document);
    conflict(() => figmaSourceNodes(source));
  }
  const source = overlap(); source.nodes["1:3"] = { document: { ...copy(source.nodes["1:2"].document.children[0]), children: [] } };
  conflict(() => figmaSourceNodes(source));
});

test("identical data under conflicting parents or sibling positions refuses; detached overlapping roots remain valid", () => {
  const source = overlap(), child = copy(source.nodes["1:2"].document);
  source.nodes["2:1"] = { document: { id: "2:1", type: "FRAME", children: [child] } };
  assert.throws(() => figmaSourceNodes(source), error => error.code === "FIGMA_SOURCE_DUPLICATE_LOCATION_CONFLICT");
  const repeated = overlap(); repeated.nodes["1:1"].document.children.push(copy(repeated.nodes["1:1"].document.children[0]));
  assert.throws(() => figmaSourceNodes(repeated), error => error.code === "FIGMA_SOURCE_DUPLICATE_LOCATION_CONFLICT");
  const shared = overlap(); shared.nodes["1:2"].document = shared.nodes["1:1"].document.children[0];
  assert.equal(figmaSourceNodes(shared).size, 3); // Repeated references serialize as complete repeated data, not cycles.
});

async function bindingFixture() {
  const raw = { id: "1:2", type: "RECTANGLE", name: "Original", absoluteBoundingBox: { ...box },
    fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }], styles: { fill: "style-old" }, futurePaint: { blendBasis: "old" } };
  const imported = await prepareFigmaImport({ document: { id: "0:1", type: "CANVAS", name: "Own page", children: [raw] } });
  return { imported, raw: imported.source.nodes["0:1"].document.children[0] };
}
test("binding creation, reopen and patch planning reject conflicting overlap instead of silently choosing the first baseline", async () => {
  const { imported, raw } = await bindingFixture(), binding = createFigmaBinding(imported);
  const duplicate = copy(raw); duplicate.fills[0].color = { r: 0, g: 0, b: 1 }; duplicate.styles.fill = "style-new";
  duplicate.futurePaint.blendBasis = "new";
  imported.source.nodes["1:2"] = { document: duplicate };
  conflict(() => createFigmaBinding(imported));
  binding.source.nodes["1:2"] = { document: copy(duplicate) };
  conflict(() => parseFigmaBinding(binding)); conflict(() => parseFigmaBinding(JSON.stringify(binding)));
  const current = copy(imported.document); current.nodes[0].fill = "#00ff00";
  conflict(() => createFigmaPatch(binding, current));
});

test("identical page/selected-child envelopes preserve full binding and update/delete snapshots", async () => {
  const { imported, raw } = await bindingFixture(); imported.source.nodes["1:2"] = { document: reverseKeys(copy(raw)) };
  const binding = createFigmaBinding(imported), before = JSON.stringify(binding), current = copy(imported.document);
  current.nodes[0].fill = "#00ff00";
  const update = createFigmaPatch(binding, current).operations[0];
  assert.equal(update.sourceId, "1:2"); assert.deepEqual(update.before.styles, { fill: "style-old" });
  assert.equal(update.before.futurePaint.blendBasis, "old");
  current.nodes.splice(0);
  assert.throws(() => createFigmaPatch(binding, current), error => error.code === "NATIVE_NOTES_BASELINE_REQUIRED");
  // Explicit own-plugin SDK mocks qualify only the new metadata positive;
  // the original legacy binding stays byte-identical and deletion stays refused.
  const document = { id: "0:0", type: "DOCUMENT", parent: null, children: [] };
  const page = { id: "0:1", type: "PAGE", parent: document, children: [], getPluginData: () => "" };
  const target = { id: "1:2", type: "RECTANGLE", parent: page, children: [], getPluginData: () => "" };
  page.children.push(target); document.children.push(page);
  const observed = createNativeNotesExportCapture({ roots: [page], pluginId: "overlap-notes-sdk-mock" });
  observed.add(binding.source.nodes["0:1"].document, page);
  observed.add(binding.source.nodes["1:2"].document, target);
  const fresh = copy(binding); fresh.source.nativeNotes = observed.finalize();
  assert.equal(createFigmaPatch(fresh, current).operations[0].before.futurePaint.blendBasis, "old");
  assert.equal(JSON.stringify(binding), before);
});

test("source accessors never execute before indexing, binding clone or reopen normalization", async () => {
  let invoked = 0;
  const getter = { enumerable: true, get() { invoked++; throw new Error("private source error"); } };
  const source = overlap(); Object.defineProperty(source.nodes["1:2"].document.children[0].style, "future", getter);
  assert.throws(() => figmaSourceNodes(source), error => error.code === "FIGMA_SOURCE_JSON_INVALID");
  const { imported } = await bindingFixture(), binding = createFigmaBinding(imported);
  Object.defineProperty(imported.source.nodes["0:1"].document.children[0], "future", getter);
  assert.throws(() => createFigmaBinding(imported), error => error.code === "FIGMA_SOURCE_JSON_INVALID");
  Object.defineProperty(binding.source.nodes["0:1"].document.children[0], "future", getter);
  assert.throws(() => parseFigmaBinding(binding), error => error.code === "FIGMA_SOURCE_JSON_INVALID");
  assert.equal(invoked, 0);
});

test("cycles, sparse/custom arrays, non-JSON fields and malformed children fail before any indexed result", () => {
  for (const mutate of [
    source => { source.nodes["1:2"].document.future = source; },
    source => { delete source.nodes["1:2"].document.children[0]; },
    source => { source.nodes["1:2"].document.children.extra = true; },
    source => { source.nodes["1:2"].document.future = NaN; },
    source => { source.nodes["1:2"].document.future = undefined; },
    source => { source.nodes["1:2"].document.future = () => 1; },
    source => { source.nodes["1:2"].document.future = new Date(); },
    source => { source.nodes["1:2"].document[Symbol("hidden")] = true; },
    source => Object.defineProperty(source.nodes["1:2"].document, "hidden", { value: true }),
  ]) {
    const source = overlap(); mutate(source);
    assert.throws(() => figmaSourceNodes(source), error => error.code === "FIGMA_SOURCE_JSON_INVALID" && !error.message.includes("private"));
  }
  const malformed = overlap(); malformed.nodes["1:2"].document.children = {};
  assert.throws(() => figmaSourceNodes(malformed));
});

test("exact complete-envelope UTF8 budget, occurrence count and layer-depth bounds remain enforced", () => {
  const source = { format: "codeshell.figma.source", version: 1, nodes: { a: { document: { id: "1:1", type: "FRAME" } } }, padding: "" };
  source.padding = "x".repeat(MAX_FIGMA_SOURCE_BYTES - Buffer.byteLength(JSON.stringify(source)));
  assert.equal(Buffer.byteLength(JSON.stringify(source)), MAX_FIGMA_SOURCE_BYTES);
  assert.equal(figmaSourceNodes(source).size, 1);
  source.padding += "x";
  assert.throws(() => figmaSourceNodes(source), error => error.code === "FIGMA_SOURCE_BUDGET");
  source.padding = "é".repeat(MAX_FIGMA_SOURCE_BYTES / 2);
  assert.throws(() => figmaSourceNodes(source), error => error.code === "FIGMA_SOURCE_BUDGET");
  const many = { format: "codeshell.figma.source", version: 1, nodes: { a: { document: { id: "1:0", children: Array.from({ length: 60000 }, (_, i) => ({ id: `2:${i}` })) } } } };
  assert.throws(() => figmaSourceNodes(many), /超出上限/u);
  let deep = { id: "3:41" };
  for (let i = 40; i >= 0; i--) deep = { id: `3:${i}`, children: [deep] };
  assert.throws(() => figmaSourceNodes({ format: "codeshell.figma.source", version: 1, nodes: { a: { document: deep } } }), /超出上限/u);
  const hugeCollection = overlap(); hugeCollection.future = Array(1000001).fill(0);
  assert.throws(() => figmaSourceNodes(hugeCollection), error => error.code === "FIGMA_SOURCE_BUDGET");
  const deepMetadata = overlap(); let metadata = {};
  for (let index = 0; index < 130; index++) metadata = { nested: metadata };
  deepMetadata.future = metadata;
  assert.throws(() => figmaSourceNodes(deepMetadata), error => error.code === "FIGMA_SOURCE_BUDGET");
});

test("prototype-key raw JSON remains inert and every property survives identical overlap", () => {
  const source = overlap(), extra = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"future":1}}');
  source.nodes["1:1"].document.children[0].future = extra;
  source.nodes["1:2"].document.future = copy(extra);
  const indexed = figmaSourceNodes(source).get("1:2");
  assert.equal({}.polluted, undefined); assert.equal(Object.hasOwn(indexed.future, "__proto__"), true);
  assert.deepEqual(indexed.future, extra);
});

test("the exact raw-index helper body executes without DOM, URL, TextEncoder or structuredClone globals", async () => {
  const module = await readFile(new URL("../../../apps/design-studio/app/figma-binding.mjs", import.meta.url), "utf8");
  const start = module.indexOf("export function figmaSourceNodes("), end = module.indexOf("\nexport function createFigmaBinding(", start);
  assert(start > 0 && end > start);
  const helper = module.slice(start, end).replace(/^export /u, "");
  const context = vm.createContext({ sourceJson: JSON.stringify(overlap()) });
  vm.runInContext(`const MAX_FIGMA_SOURCE_BYTES=${MAX_FIGMA_SOURCE_BYTES};const id=value=>typeof value==='string'&&value.length>0&&value.length<=160&&!/[\\u0000-\\u001f\\u007f]/u.test(value);${helper};this.size=figmaSourceNodes(JSON.parse(sourceJson)).size;`, context);
  assert.equal(context.size, 3);
  assert.equal(vm.runInContext("[typeof document,typeof URL,typeof TextEncoder,typeof structuredClone].join('/')", context), "undefined/undefined/undefined/undefined");
});
