import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { importFigmaJson, createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { normalizeDesignDocument, serializeDesignDocument, exportDesignSvg } from "../../../apps/design-studio/app/document.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";

const clone = (node) => structuredClone(node);
const source = (layout = "HORIZONTAL", properties = {}) => ({ id: "0:1", type: "CANVAS", name: "Spacing", children: [{
  id: "1:1", type: "FRAME", name: "Stack", layoutMode: layout, itemSpacing: -16,
  primaryAxisSizingMode: "FIXED", counterAxisSizingMode: "FIXED", layoutWrap: "NO_WRAP", itemReverseZIndex: false,
  absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 120 },
  fills: [], children: [1, 2, 3].map((index) => ({ id: `1:${index + 1}`, type: "RECTANGLE", name: `Item ${index}`,
    absoluteBoundingBox: { x: 0, y: 0, width: 60, height: 40 }, fills: [{ type: "SOLID", color: { r: index === 1 ? 1 : 0, g: index === 2 ? 1 : 0, b: index === 3 ? 1 : 0 } }] })), ...properties,
}] });
const roundTrip = (value) => normalizeDesignDocument(JSON.parse(serializeDesignDocument(value)));

test("signed main spacing reflows nowrap H/V, excludes hidden and absolute nodes, and keeps auto margins", () => {
  for (const axis of ["HORIZONTAL", "VERTICAL"]) {
    const design = importFigmaJson(source(axis)).document;
    const parent = design.nodes[0], [first, second, last] = design.nodes.slice(1);
    if (axis === "HORIZONTAL") second.layoutSizingHorizontal = "fill";
    else second.layoutSizingVertical = "fill";
    design.nodes.push({ ...clone(first), id: "hidden", visible: false }, { ...clone(first), id: "overlay", layoutPositioning: "absolute" });
    applyAllAutoLayouts(design.nodes);
    const position = axis === "HORIZONTAL" ? "x" : "y", size = axis === "HORIZONTAL" ? "width" : "height";
    assert.equal(first[position], 0); assert.equal(second[position], first[size] - 16);
    assert.equal(second[size], parent[size] - first[size] - last[size] + 32);
    assert.equal(last[position] + last[size], parent[size]);
    assert.equal(roundTrip(design).nodes[0].gap, -16);
    assert.equal(createFigmaTransfer(design).pages[0].children[0].gap, -16);
    second[`layoutSizing${axis === "HORIZONTAL" ? "Horizontal" : "Vertical"}`] = "fixed";
    second[size] = 30; last.layoutMarginBefore = "auto";
    applyAllAutoLayouts(design.nodes);
    assert.equal(last[position] + last[size], parent[size]);
  }
  for (const width of [640, 400]) {
    const design = importFigmaJson(source()).document, [parent, a, real, b] = design.nodes;
    parent.width = width; parent.height = 40; parent.layoutSizingVertical = "hug";
    a.width = b.width = a.height = b.height = 1;
    real.layoutSizingHorizontal = "fill";
    applyAllAutoLayouts(design.nodes);
    assert.deepEqual([real.x, real.width, parent.height], [-15, width + 30, 40]);
  }
});

test("schema, normalizer, and public tool accept only bounded nowrap main spacing", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const schema = JSON.parse(await readFile(new URL("../../../apps/design-studio/app/formats/codeshell-design-v3.schema.json", import.meta.url), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const document = JSON.parse(serializeDesignDocument(importFigmaJson(source()).document));
  assert.ok(validate(document), JSON.stringify(validate.errors));
  for (const changes of [{ gap: -2001 }, { gap: Infinity }, { rowGap: -1 }, { layout: "grid" }, { layout: "none" }, { layoutWrap: "wrap" }, { layoutReverse: true }, { layoutSizingHorizontal: "hug" }]) {
    const invalid = clone(document); Object.assign(invalid.pages[0].children[0], changes);
    assert.equal(validate(invalid), false, JSON.stringify(changes));
    assert.throws(() => normalizeDesignDocument(invalid), undefined, JSON.stringify(changes));
  }
  const manifest = JSON.parse(await readFile(new URL("../../../apps/design-studio/.codeshell-panel/panel.json", import.meta.url), "utf8"));
  const { validateToolArgsStrict } = await import("@cjhyy/code-shell-core");
  assert.equal(validateToolArgsStrict("use_design", { expected_state_revision: "spacing", operations: [{ op: "update_node", node_id: "frame", changes: { gap: -16 } }] }, manifest.agent.tools.find((tool) => tool.name === "use_design").inputSchema), null);
});

test("unsupported native negative spacing retains geometry with an explicit diagnostic", () => {
  for (const changes of [{ layoutWrap: "WRAP" }, { primaryAxisSizingMode: "AUTO" }, { itemReverseZIndex: true }, { counterAxisSpacing: -1 }, { itemSpacing: -2001 }]) {
    const captured = importFigmaJson(source("HORIZONTAL", changes));
    assert.equal(captured.document.nodes[0].layout, "none", JSON.stringify(changes));
    assert.ok(captured.warnings.some((warning) => warning.code === "unsupported-negative-spacing"));
    assert.deepEqual(captured.document.nodes.slice(1).map(({ x, y, width, height }) => [x, y, width, height]), [[0, 0, 60, 40], [0, 0, 60, 40], [0, 0, 60, 40]]);
  }
});

test("negative main gaps export as real CSS margins with exact SVG pixels at640/400", async () => {
  const browser = await chromium.launch();
  try {
    for (const axis of ["HORIZONTAL", "VERTICAL"]) for (const justifyContent of ["start", "center", "end", "space-between"]) for (const width of [640, 400]) {
      const design = importFigmaJson(source(axis)).document, [parent, first, second, last] = design.nodes;
      design.canvas.width = width; design.canvas.height = 160; parent.width = width; parent.height = 160;
      parent.justifyContent = justifyContent;
      if (justifyContent === "start") second[axis === "HORIZONTAL" ? "layoutSizingHorizontal" : "layoutSizingVertical"] = "fill";
      design.nodes.push({ ...clone(first), id: "hidden", visible: false }, { ...clone(first), id: "overlay", visible: true, layoutPositioning: "absolute", x: 300, y: 100 });
      if (justifyContent === "end") last.layoutMarginBefore = "auto";
      applyAllAutoLayouts(design.nodes);
      const reopened = roundTrip(design), page = await browser.newPage({ viewport: { width, height: 160 } });
      await page.setContent(`<style>body{margin:0}svg{display:block}</style>${exportDesignSvg(reopened)}`); const svg = PNG.sync.read(await page.screenshot());
      const html = exportDesignFrontend(JSON.parse(serializeDesignDocument(reopened)));
      assert.doesNotMatch(html, /(?:row|column)-gap:-/u);
      await page.setContent(html); const css = PNG.sync.read(await page.screenshot());
      assert.equal(Buffer.compare(svg.data, css.data), 0, `${axis}/${justifyContent}/${width}`);
      await page.close();
    }
  } finally { await browser.close(); }
});
