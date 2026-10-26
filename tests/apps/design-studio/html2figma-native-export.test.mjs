import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { importFigmaJson, prepareFigmaImport, normalizeHtml2FigmaJson } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { normalizeFigmaSource } from "../../../apps/design-studio/app/figma-assets.mjs";
import { createFigmaBinding, createFigmaPatch, parseFigmaBinding } from "../../../apps/design-studio/app/figma-binding.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { transformedNodeBoundsInTree } from "../../../apps/design-studio/app/geometry.mjs";

const bytes = await readFile(new URL("../../fixtures/design-studio-html2figma-json/native-production-export.v1.json", import.meta.url), "utf8");
const actual = JSON.parse(bytes);
const clone = () => structuredClone(actual);

test("actual production native export remains immutable and imports its two editable nodes", () => {
  const source = clone(), before = JSON.stringify(source), normalized = normalizeHtml2FigmaJson(source);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(normalized.exportReport, source.exportReport);
  const root = Object.values(normalized.nodes)[0].document;
  const originalFields = (node, source) => {
    for (const key of Object.keys(source)) {
      if (key === "children") source.children.forEach((child, index) => originalFields(node.children[index], child));
      else assert.deepEqual(node[key], source[key], key);
    }
  };
  originalFields(root, source.nodes[0]);
  assert.deepEqual(root.size, { x: 160, y: 80 });
  assert.deepEqual(root.children[0].size, { x: 60, y: 30 });
  const imported = importFigmaJson(source);
  assert.equal(imported.stats.importedNodes, 2);
  assert.equal(imported.stats.skippedNodes, 0);
  assert.deepEqual(imported.document.nodes.map(node => [node.type, node.x, node.y, node.width, node.height]),
    [["frame", 1060, 0, 160, 80], ["rectangle", 1200, 20, 60, 30]]);
  assert.equal(imported.document.nodes[0].clipContent, false);
});

test("native export warning survives preparation and the retained source packet", async () => {
  const source = clone(), prepared = await prepareFigmaImport(source);
  assert.deepEqual(prepared.source.exportReport, source.exportReport);
  assert.ok(prepared.warnings.some(warning => warning.code === "plugin-export-warning" &&
    warning.message === source.exportReport.warnings[0].message));
});

test("native transform and top-level Text fields keep their actual semantics", () => {
  const source = clone(), root = source.nodes[0];
  root.rotation = 90; root.relativeTransform = [[0, 1, 1060], [-1, 0, 0]];
  root.absoluteTransform = structuredClone(root.relativeTransform);
  root.absoluteBoundingBox = { x: 1060, y: -160, width: 80, height: 160 };
  root.children = [{ id: "native-text", type: "TEXT", name: "Native text", x: 10, y: 20, width: 100, height: 30,
    relativeTransform: [[1, 0, 10], [0, 1, 20]], absoluteBoundingBox: { x: 1080, y: -110, width: 30, height: 100 },
    absoluteTransform: [[0, 1, 1080], [-1, 0, -10]],
    characters: "AB", fontName: { family: "Arial", style: "Bold Italic" }, fontWeight: 700, fontSize: 19,
    lineHeight: { unit: "PIXELS", value: 27 }, letterSpacing: { unit: "PIXELS", value: 1.5 },
    fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
    styledTextSegments: [{ start: 0, end: 1, hyperlink: { type: "URL", value: "https://example.com/a" } },
      { start: 1, end: 2, hyperlink: null }] }];
  const before = JSON.stringify(source), normalized = normalizeHtml2FigmaJson(source), imported = importFigmaJson(source);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(Object.values(normalized.nodes)[0].document.relativeTransform, root.relativeTransform);
  const label = imported.document.nodes.find(node => node.type === "text");
  assert.deepEqual([label.fontFamily, label.fontSize, label.fontWeight, label.fontStyle, label.lineHeight, label.letterSpacing],
    ["Arial", 19, 700, "italic", 27, 1.5]);
  assert.equal(imported.document.nodes[0].rotation, -90);
  assert.equal(label.textRanges.ranges[0].href, "https://example.com/a");
});

test("mixed plugin/native roots never enter either format by a partial match", () => {
  const source = clone(); source.nodes.push({ id: "plugin-only", type: "RECTANGLE", x: 0, y: 0, width: 10, height: 10 });
  source.exportReport.nodes.selected = 2; source.exportReport.nodes.serialized = 3;
  assert.throws(() => importFigmaJson(source), /几何|格式/u);
});

test("partial native diagnostic exports remain rejected before normalization", () => {
  const source = clone(); source.exportReport.ready = false; source.exportReport.partial = true;
  source.exportReport.errors.push({ code: "UNSUPPORTED_LAYOUT_PROPERTY", path: "nodes[0]", message: "Native feature is unsupported" });
  assert.throws(() => importFigmaJson(source), /不完整|诊断|错误|报告/u);
});

test("native geometry aliases cannot contradict the retained source box", () => {
  const source = clone(); source.nodes[0].size = { x: 999, y: 80 };
  assert.throws(() => importFigmaJson(source), /几何|size|尺寸/u);
});

test("invalid native matrix or geometry-incomplete descendants are not coerced", () => {
  const malformed = clone(); malformed.nodes[0].relativeTransform = [[1, 0], [0, 1]];
  assert.throws(() => importFigmaJson(malformed), /几何|变换|matrix/u);
  const descendant = clone(); delete descendant.nodes[0].children[0].relativeTransform;
  delete descendant.nodes[0].children[0].absoluteBoundingBox;
  assert.throws(() => importFigmaJson(descendant), /几何|格式/u);
});

test("a report-free native array stays distinct from the established raw plugin format", () => {
  const source = clone(); delete source.exportReport;
  assert.throws(() => importFigmaJson(source), /完整相对几何/u);
  const oldPlugin = { type: "RECTANGLE", x: 2, y: 3, width: 10, height: 20, size: { x: 999, y: 999 } };
  assert.deepEqual(Object.values(normalizeHtml2FigmaJson(oldPlugin).nodes)[0].document.size, { x: 10, y: 20 });
});

test("native null bounds retain the complete local matrix and original measured size", () => {
  const source = clone(); source.nodes[0].absoluteBoundingBox = null;
  const normalized = normalizeHtml2FigmaJson(source), root = Object.values(normalized.nodes)[0].document;
  assert.equal(root.absoluteBoundingBox, null);
  assert.deepEqual(root.relativeTransform, source.nodes[0].relativeTransform);
  assert.deepEqual(root.size, { x: 160, y: 80 });
});

for (const [name, mutate] of [
  ["selected root count", source => source.exportReport.nodes.selected++],
  ["serialized descendant count", source => source.exportReport.nodes.serialized++],
  ["unsupported native node", source => source.exportReport.nodes.unsupported++],
  ["missing resource", source => { source.exportReport.images.references = 1; source.exportReport.images.resources = 1; }],
  ["failed image", source => { source.exportReport.images.references = 1; source.exportReport.images.resources = 1; source.exportReport.images.failed = 1; }],
  ["JSON budget", source => source.exportReport.json.budget = 1],
  ["fractional counter", source => source.exportReport.images.bytes = 0.5],
  ["diagnostic missing path", source => delete source.exportReport.warnings[0].path],
  ["declared error despite ready", source => source.exportReport.errors.push({ code: "FAIL", path: "nodes[0]", message: "Native API rejected the property" })],
  ["descendant report", source => source.nodes[0].children[0].exportReport = clone().exportReport],
]) test(`native admission rejects contradictory ${name} across direct and prepared paths`, async () => {
  const source = clone(); mutate(source);
  assert.throws(() => importFigmaJson(source), /报告|不完整/u);
  await assert.rejects(prepareFigmaImport(source), /报告|不完整/u);
});

test("retained source reports are checked again and cannot hide a later incomplete state", () => {
  const source = normalizeFigmaSource(normalizeHtml2FigmaJson(clone()));
  assert.deepEqual(source.exportReport, actual.exportReport);
  source.exportReport.ready = false; source.exportReport.partial = true;
  assert.throws(() => normalizeFigmaSource(source), /不完整/u);
  assert.throws(() => importFigmaJson(source), /不完整/u);
});

test("report accessors are rejected without invoking application code", () => {
  const source = clone(); let reads = 0;
  Object.defineProperty(source.exportReport, "ready", { enumerable: true, get() { reads++; return true; } });
  assert.throws(() => normalizeHtml2FigmaJson(source), /报告/u);
  assert.equal(reads, 0);
});

test("contradictory native translation and malformed absolute bounds are rejected", () => {
  const source = clone(); source.nodes[0].relativeTransform[0][2] = 1061;
  assert.throws(() => importFigmaJson(source), /几何/u);
  const invalidBox = clone(); invalidBox.nodes[0].absoluteBoundingBox.width = -1;
  assert.throws(() => importFigmaJson(invalidBox), /几何/u);
});

test("a native selected root under an unexported rotated parent uses its actual world transform", () => {
  const source = clone(), root = source.nodes[0], child = root.children[0];
  Object.assign(root, { x: 10, y: 20, rotation: 0, relativeTransform: [[1, 0, 10], [0, 1, 20]],
    absoluteTransform: [[0, -1, 400], [1, 0, 200]], absoluteBoundingBox: { x: 320, y: 200, width: 80, height: 160 } });
  child.absoluteTransform = [[0, -1, 380], [1, 0, 340]];
  child.absoluteBoundingBox = { x: 350, y: 340, width: 30, height: 60 };
  const result = importFigmaJson(source), nodes = result.document.nodes;
  assert.equal(nodes[0].rotation, 90);
  assert.equal(nodes[1].rotation, 0);
  assert.deepEqual(transformedNodeBoundsInTree(nodes, nodes[0]), root.absoluteBoundingBox);
  assert.deepEqual(transformedNodeBoundsInTree(nodes, nodes[1]), child.absoluteBoundingBox);
  assert.deepEqual(Object.values(normalizeHtml2FigmaJson(source).nodes)[0].document.relativeTransform, root.relativeTransform);
});

test("REST-shaped retained native exports obey the same geometry admission as the original array", () => {
  const source = normalizeFigmaSource(normalizeHtml2FigmaJson(clone()));
  Object.values(source.nodes)[0].document.size.x = 999;
  assert.throws(() => importFigmaJson(source), /几何|尺寸/u);
  assert.throws(() => normalizeFigmaSource(source), /几何|尺寸/u);
});

test("non-rigid native matrices remain an explicit unsupported import instead of a rotation approximation", () => {
  for (const matrix of [[[2, 0, 1060], [0, 1, 0]], [[-1, 0, 1060], [0, 1, 0]], [[1, 0.2, 1060], [0, 1, 0]]]) {
    const source = clone(); source.nodes[0].relativeTransform = matrix;
    assert.throws(() => importFigmaJson(source), /几何|变换|矩阵/u);
  }
});

for (const [name, mutate] of [
  ["image references without a resource", source => source.exportReport.images.references = 1],
  ["image bytes without an image", source => Object.assign(source.exportReport.images, { bytes: 1, payloadBytes: 1 })],
  ["zero measured width", source => source.nodes[0].children[0].width = 0],
  ["duplicate native ID", source => source.nodes[0].children[0].id = source.nodes[0].id],
]) test(`complete native source rejects ${name} before canonical repair`, async () => {
  const source = clone(); mutate(source);
  assert.throws(() => importFigmaJson(source), /报告|几何|ID/u);
  await assert.rejects(prepareFigmaImport(source), /报告|几何|ID/u);
});


test("native export and infinite canvas preserve far world placement and the original source matrices", async () => {
  const source = clone(), root = source.nodes[0], offsetX = 65000 - root.x, offsetY = -35000 - root.y;
  const moveWorld = node => {
    node.absoluteTransform[0][2] += offsetX; node.absoluteTransform[1][2] += offsetY;
    for (const key of ["absoluteBoundingBox", "absoluteRenderBounds"])
      if (node[key]) { node[key].x += offsetX; node[key].y += offsetY; }
    node.children?.forEach(moveWorld);
  };
  moveWorld(root);
  root.x += offsetX; root.y += offsetY;
  root.relativeTransform[0][2] += offsetX; root.relativeTransform[1][2] += offsetY;
  const before = structuredClone(source), prepared = await prepareFigmaImport(source, { canvasMode: "infinite" });
  assert.deepEqual(source, before);
  assert.equal(prepared.document.canvas.mode, "infinite");
  assert.deepEqual(prepared.document.nodes.map(node => [node.x, node.y, node.width, node.height]),
    [[65000, -35000, 160, 80], [65140, -34980, 60, 30]]);
  assert.equal(prepared.document.nodes[0].clipContent, false);
  assert.deepEqual(Object.values(prepared.source.nodes)[0].document.relativeTransform, root.relativeTransform);
  assert.deepEqual(Object.values(prepared.source.nodes)[0].document.children[0].absoluteTransform, root.children[0].absoluteTransform);
  assert.deepEqual(prepared.source.exportReport, source.exportReport);
  assert(!prepared.warnings.some(warning => ["bounded-number", "canvas-extent"].includes(warning.code)));
  const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(prepared.document)));
  assert.deepEqual(reopened.nodes, prepared.document.nodes);
  const binding = parseFigmaBinding(JSON.stringify(createFigmaBinding(prepared)));
  assert.deepEqual(binding.source.exportReport, source.exportReport);
  assert.deepEqual(createFigmaPatch(binding, reopened).operations, []);
});
