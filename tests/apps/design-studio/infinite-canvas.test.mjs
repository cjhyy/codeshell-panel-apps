import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { textMetricsSignature } from "../../../apps/design-studio/app/text-metrics.mjs";
import * as documentApi from "../../../apps/design-studio/app/document.mjs";
import { auditDesignPages } from "../../../apps/design-studio/app/audit.mjs";
import { createDesignIndexPersistencePlan, resolveDesignIndexDocument } from "../../../apps/design-studio/app/document-index.mjs";
import { createDesignPersistencePlan, resolveDesignPersistenceSource } from "../../../apps/design-studio/app/document-bundle.mjs";
import { prepareFigmaImport, createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { createFigmaBinding, createFigmaPatch } from "../../../apps/design-studio/app/figma-binding.mjs";
import { preparePluginFile } from "../../../apps/design-studio/app/figma-plugin/v3-input.mjs";
import { infiniteCanvasFixture, worldNode, distantFigmaSource } from "./fixtures/infinite-canvas.mjs";

const hash = async (text) => createHash("sha256").update(text).digest("hex");
const canonical = (input) => documentApi.serializeDesignDocument(documentApi.normalizeDesignDocument(input));

test("optional infinite mode preserves distant and negative board coordinates while bounded input remains strict", () => {
  const input = infiniteCanvasFixture({ distant: true });
  const document = documentApi.normalizeDesignDocument(input);
  assert.equal(document.canvas.mode, "infinite");
  assert.equal(document.nodes.find((node) => node.id === "board-right").x, 800000);
  assert.equal(documentApi.designCoordinateLimit(document.canvas), 1000000);
  assert.equal(documentApi.designCoordinateLimit({}), 20000);
  delete input.canvas.mode;
  assert.throws(() => documentApi.normalizeDesignDocument(input), /\.x/u);
  for (const mode of ["bounded", null, true, "forever"]) {
    input.canvas.mode = mode;
    assert.throws(() => documentApi.normalizeDesignDocument(input), /canvas.mode/u);
  }
  input.canvas.mode = "infinite";
  input.pages[0].children[1].x = 1000001;
  assert.throws(() => documentApi.normalizeDesignDocument(input), /\.x/u);
  input.pages[0].children[1].x = 800000;
  input.pages[0].children[1].width = 20001;
  assert.throws(() => documentApi.normalizeDesignDocument(input), /\.width/u);
});

test("bounded documents keep their exact canonical bytes and do not silently acquire workspace metadata", async () => {
  const input = infiniteCanvasFixture({ mode: null });
  const source = canonical(input);
  assert.equal(await hash(source), "e401216400cf0c2f4659577cd5a05204d10aa1b8d4c918fbd7579b1ec49ae903");
  assert.equal(Object.hasOwn(JSON.parse(source).canvas, "mode"), false);
  assert.equal(canonical(JSON.parse(source)), source);
  assert.deepEqual(documentApi.designPageBounds(documentApi.normalizeDesignDocument(input)), { x: 0, y: 0, width: 1280, height: 820 });
});

test("infinite page bounds include visible stroke and shadow, exclude hidden pixels, and honor artboard clipping", () => {
  const input = infiniteCanvasFixture();
  const document = documentApi.normalizeDesignDocument(input);
  const before = canonical(input);
  assert.deepEqual(documentApi.designPageBounds(document), { x: -664, y: -364, width: 2784, height: 1504 });
  assert.equal(documentApi.serializeDesignDocument(document), before);
  document.pages.push({ id: "empty", name: "Empty", nodes: [] });
  assert.deepEqual(documentApi.designPageBounds(document, { pageId: "empty" }), { x: 0, y: 0, width: 1280, height: 820 });
  assert.throws(() => documentApi.designPageBounds(document, { pageId: "missing" }), /页面/u);
});

test("SVG exports all artboards at negative origin without rebasing nodes or trimming effects", () => {
  const document = documentApi.normalizeDesignDocument(infiniteCanvasFixture());
  const before = documentApi.serializeDesignDocument(document);
  const svg = documentApi.exportDesignSvg(document);
  assert.match(svg, /width="2784" height="1504" viewBox="-664 -364 2784 1504"/u);
  assert.match(svg, /<rect x="-664" y="-364" width="2784" height="1504" fill="#f5f5f2"/u);
  assert.match(svg, /data-node-id="board-negative"/u);
  assert.match(svg, /data-node-id="board-right"/u);
  assert.equal(documentApi.serializeDesignDocument(document), before);
});

test("explicit SVG viewport retains negative padding, validates finite dimensions and keeps byte budgets", () => {
  const document = documentApi.normalizeDesignDocument(infiniteCanvasFixture());
  const bounds = { x: -700, y: -400, width: 100, height: 80 };
  const svg = documentApi.exportDesignSvg(document, { bounds });
  assert.match(svg, /width="100" height="80" viewBox="-700 -400 100 80"/u);
  assert.match(svg, /<rect x="-700" y="-400" width="100" height="80"/u);
  for (const invalid of [{ ...bounds, x: NaN }, { ...bounds, y: Infinity }, { ...bounds, width: 0 }, { ...bounds, height: -1 }])
    assert.throws(() => documentApi.exportDesignSvg(document, { bounds: invalid }), /bounds/u);
  assert.throws(() => documentApi.exportDesignSvg(document, { bounds, maxBytes: 100 }), /导出上限/u);
});

test("nested source and inactive live pages produce the same bounds without changing the active page", () => {
  const source = infiniteCanvasFixture();
  const document = documentApi.normalizeDesignDocument(source);
  assert.deepEqual(documentApi.designPageBounds(source), documentApi.designPageBounds(document));
  document.pages.push({ id: "elsewhere", name: "Elsewhere", nodes: [worldNode("elsewhere-node", { x: -900000, y: 700000 })] });
  assert.deepEqual(documentApi.designPageBounds(document, { pageId: "elsewhere" }), { x: -900000, y: 700000, width: 100, height: 80 });
  assert.equal(document.activePageId, "page-1");
});

test("infinite audit removes document overflow only and keeps artboard overflow and text checks", () => {
  const input = infiniteCanvasFixture();
  input.pages[0].children.push(worldNode("edge-effect", { x: 1260, y: 50, width: 20, height: 20,
    shadow: { color: "#000000", opacity: 0.5, x: 8, y: 0, blur: 8 } }));
  input.pages[0].children.push(worldNode("bad-text", { type: "text", x: 2200, y: -50, width: 20, height: 10,
    text: "Text still needs enough room", fontSize: 24, fontWeight: 400, lineHeight: 1.2, textAlign: "left" }));
  const infinite = auditDesignPages(documentApi.normalizeDesignDocument(input));
  assert.equal(infinite.some((issue) => ["layout.canvas-overflow", "layout.effect-canvas-overflow"].includes(issue.code)), false);
  assert.ok(infinite.some((issue) => issue.nodeId === "clipped-child" && /overflow/u.test(issue.code)));
  assert.ok(infinite.some((issue) => issue.nodeId === "bad-text" && /text/u.test(issue.code)));
  delete input.canvas.mode;
  const bounded = auditDesignPages(documentApi.normalizeDesignDocument(input));
  assert.ok(bounded.some((issue) => issue.code === "layout.canvas-overflow"));
  assert.ok(bounded.some((issue) => issue.code === "layout.effect-canvas-overflow"));
});

test("indexed and legacy bundle persistence round trip infinite mode with world coordinates", async () => {
  const document = documentApi.normalizeDesignDocument(infiniteCanvasFixture({ distant: true }));
  const source = documentApi.serializeDesignDocument(document);
  const plan = await createDesignIndexPersistencePlan({ document, sha256: hash });
  const parts = new Map(plan.parts.map((part) => [part.path, part.content]));
  const reopened = await resolveDesignIndexDocument({ primarySource: plan.primarySource, readText: async (path) => parts.get(path), sha256: hash });
  assert.equal(documentApi.serializeDesignDocument(reopened.document), source);
  const largeSource = `${source}${" ".repeat(400000)}`;
  const bundle = createDesignPersistencePlan({ source: largeSource, name: document.name, sha256: await hash(largeSource) });
  const chunks = new Map(bundle.parts.map((part) => [part.path, part.content]));
  const resolved = await resolveDesignPersistenceSource({ primarySource: bundle.primarySource, readText: async (path) => chunks.get(path), sha256: hash });
  assert.equal(canonical(JSON.parse(resolved.source)), source);
});

test("Figma infinite import keeps source positions and bindings; mode-only upgrade has no patch or misleading diagnostic", async () => {
  const source = distantFigmaSource();
  const before = JSON.stringify(source);
  const result = await prepareFigmaImport(source, { canvasMode: "infinite" });
  assert.equal(result.document.canvas.mode, "infinite");
  assert.deepEqual(result.document.nodes.map((node) => node.x), [-800000, -799980, 800000]);
  assert.ok(result.mapping.every((entry) => entry.offsetX === 0 && entry.offsetY === 0));
  assert.equal(result.warnings.some((warning) => ["canvas-extent", "page-origin-normalized", "number-clamped"].includes(warning.code)), false);
  assert.equal(JSON.stringify(source), before);
  const binding = createFigmaBinding(result);
  assert.deepEqual(createFigmaPatch(binding, result.document).operations, []);
  for (const node of result.document.nodes.filter((node) => node.id !== "figma-2-1")) node.x -= 100;
  const patch = createFigmaPatch(binding, result.document);
  assert.deepEqual(patch.operations.map((op) => op.sourceId), ["1:1"]);
  const legacy = await prepareFigmaImport({ type: "CANVAS", id: "0:1", children: [{ id: "1:1", type: "RECTANGLE", absoluteBoundingBox: { x: 10, y: 20, width: 100, height: 80 } }] });
  const oldBinding = createFigmaBinding(legacy);
  legacy.document.canvas.mode = "infinite";
  const modePatch = createFigmaPatch(oldBinding, legacy.document);
  assert.deepEqual(modePatch.operations, []);
  assert.deepEqual(modePatch.diagnostics, []);
});

test("plugin v3 file adapter retains infinite mode and distant positions in its Figma transfer", async () => {
  const input = infiniteCanvasFixture({ distant: true });
  const prepared = await preparePluginFile(JSON.stringify(input));
  assert.equal(prepared.transfer.canvas.mode, "infinite");
  assert.equal(prepared.transfer.pages[0].children[1].x, 800000);
  assert.equal(createFigmaTransfer(documentApi.normalizeDesignDocument(input)).stats.exportedNodes, 5);
});

test("self-contained plugin UI carries the same infinite codec and world-coordinate rules", async () => {
  const ui = await readFile(new URL("../../../apps/design-studio/app/figma-plugin/ui.html", import.meta.url), "utf8");
  const code = ui.split("<!-- BEGIN GENERATED V3 FILE ADAPTER -->")[1]
    .split("<!-- END GENERATED V3 FILE ADAPTER -->")[0].match(/<script>([\s\S]*)<\/script>/u)[1];
  const sandbox = { TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, atob, Map, Set, Blob, structuredClone };
  vm.runInNewContext(code, sandbox);
  const prepared = await sandbox.CodeShellFigmaFile.preparePluginFile(JSON.stringify(infiniteCanvasFixture({ distant: true })));
  assert.equal(prepared.transfer.canvas.mode, "infinite");
  assert.equal(prepared.transfer.pages[0].children[1].x, 800000);
});

test("published schema exposes infinite mode and separately bounds world positions and artboard dimensions", async () => {
  const schema = JSON.parse(await readFile(new URL("../../../apps/design-studio/app/formats/codeshell-design-v3.schema.json", import.meta.url), "utf8"));
  assert.deepEqual(schema.$defs.canvas.properties.mode, { const: "infinite" });
  assert.equal(schema.$defs.node.properties.x.maximum, 1000000);
  assert.equal(schema.$defs.node.properties.width.maximum, 20000);
  assert.equal(schema.$defs.boundedNode.allOf[1].properties.x.maximum, 20000);
  assert.ok(schema.allOf?.length);
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const source = infiniteCanvasFixture({ distant: true });
  assert.equal(validate(source), true, JSON.stringify(validate.errors));
  delete source.canvas.mode;
  assert.equal(validate(source), false);
  source.pages[0].children[1].x = 1800;
  assert.equal(validate(source), true, JSON.stringify(validate.errors));
  source.pages[0].children[0].children[0].x = -800000;
  assert.equal(validate(source), false, "bounded recursive descendants retain the old coordinate limit");
  source.canvas.mode = "infinite";
  assert.equal(validate(source), true, JSON.stringify(validate.errors));
  source.pages[0].children[0].children[0].x = -1000001;
  assert.equal(validate(source), false);
});

test("Host tool schema admits explicit infinite upgrades and world positions while rejecting oversized geometry", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../../apps/design-studio/.codeshell-panel/panel.json", import.meta.url), "utf8"));
  const tool = manifest.agent.tools.find(candidate => candidate.name === "use_design");
  const { validateToolArgsStrict } = await import("@cjhyy/code-shell-core");
  const request = { expected_state_revision: "schema-regression", save: false, operations: [
    { op: "set_document", changes: { canvas: { mode: "infinite" } } },
    { op: "update_node", node_id: "world-artboard", changes: { x: -1000000, y: 1000000 } },
  ] };
  assert.equal(validateToolArgsStrict("use_design", request, tool.inputSchema), null);
  request.operations[1].changes.x = -1000001;
  assert.notEqual(validateToolArgsStrict("use_design", request, tool.inputSchema), null);
  request.operations[1].changes = { width: 20001 };
  assert.notEqual(validateToolArgsStrict("use_design", request, tool.inputSchema), null);
  request.operations[1].changes = { x: -800000 };
  request.operations[0].changes.canvas.mode = "forever";
  assert.notEqual(validateToolArgsStrict("use_design", request, tool.inputSchema), null);
});

function textInkCase({ rotation = 0, align = "left" } = {}) {
  const input = infiniteCanvasFixture();
  const text = worldNode("ink-copy", { type: "text", x: -400, y: 50, width: 100, height: 30,
    text: "MMMMMMMMMMMMMMMMMMMM", fontFamily: "Roboto", fontSize: 20,
    fontWeight: 400, lineHeight: 1.2, textAlign: align, rotation });
  text.textMetrics = { version: 1, signature: textMetricsSignature(text),
    lineWidths: [350], lineInkBounds: [{ x: -4, y: -3, width: 354, height: 25 }],
    height: 22, fontAvailable: true };
  input.pages[0].children = [text];
  return documentApi.normalizeDesignDocument(input);
}

test("infinite text ink uses valid receipts and original rotation pivots without altering bounded exports", () => {
  const document = textInkCase();
  assert.deepEqual(documentApi.designPageBounds(document), { x: -404, y: 47, width: 354, height: 33 });
  assert.deepEqual(documentApi.designPageBounds(textInkCase({ rotation: 90 })), { x: -365, y: 11, width: 33, height: 354 });
  assert.deepEqual(documentApi.designPageBounds(textInkCase({ align: "center" })), { x: -529, y: 47, width: 354, height: 33 });
  delete document.canvas.mode;
  assert.match(documentApi.exportDesignSvg(document), /viewBox="0 0 1280 820"/u);
});

test("unmeasured or stale text receipts cannot clip natural lines and infinite shadow filters include their ink", () => {
  const document = textInkCase();
  const node = document.nodes[0];
  node.text += "MMMMMMMMMMMMMMMMMMMM";
  const bounds = documentApi.designPageBounds(document);
  assert.ok(bounds.width >= 720, JSON.stringify(bounds));
  node.shadow = { x: 8, y: 0, blur: 8, opacity: 0.5, color: "#000000" };
  const svg = documentApi.exportDesignSvg(document);
  const filter = /<filter[^>]+x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/u.exec(svg);
  assert.ok(Number(filter[1]) + Number(filter[3]) >= bounds.x + bounds.width);
  assert.equal(node.textMetrics.lineWidths[0], 350, "bounds calculation never rewrites a stale receipt");
});
