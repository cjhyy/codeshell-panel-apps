import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { normalizeDesignDocument, serializeDesignDocument, exportDesignSvg } from "../../../apps/design-studio/app/document.mjs";
import { importFigmaJson, prepareFigmaImport, createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { createFigmaBinding, createFigmaPatch } from "../../../apps/design-studio/app/figma-binding.mjs";
import { compareDesignDocuments } from "../../../apps/design-studio/app/design-compare.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";
import { clearInvalidStrokeLayoutExclusion } from "../../../apps/design-studio/app/stroke.mjs";
import { nativeGridSource } from "../../fixtures/design-studio-native-grid/source.mjs";
import { preparePluginFile } from "../../../apps/design-studio/app/figma-plugin/v3-input.mjs";

const fixture = JSON.parse(await readFile(new URL("../../fixtures/design-studio-native-content-fill.json", import.meta.url), "utf8"));
const saved = (value) => JSON.parse(serializeDesignDocument(value));
const imported = (entry) => importFigmaJson({ id: "0:1", type: "CANVAS", name: "Native content Fill", children: [structuredClone(entry.source)] });
const geometry = (value) => value.nodes.map(({ id, x, y, width, height }) => [id, x, y, width, height]);

test("actual native included/excluded H/V Frame Fill cases reflow without changing measured geometry", async () => {
  for (const entry of fixture.cases) {
    const result = imported(entry), value = result.document, before = geometry(value);
    const children = value.nodes.filter((node) => node.type === "frame" && node.parentId === value.nodes[0].id);
    assert.ok(children.every((node) => node.strokeLayoutExcluded === (entry.included ? undefined : true)), entry.name);
    assert.equal(applyAllAutoLayouts(value.nodes), false, entry.name);
    assert.deepEqual(geometry(value), before, entry.name);
    const reopened = normalizeDesignDocument(saved(value));
    assert.equal(applyAllAutoLayouts(reopened.nodes), false);
    assert.deepEqual(geometry(reopened), before);
    assert.equal(createFigmaTransfer(reopened).pages[0].children[0].children[0].strokeLayoutExcluded, entry.included ? undefined : true);
    const prepared = await preparePluginFile(serializeDesignDocument(reopened));
    assert.equal(prepared.transfer.pages[0].children[0].children[0].strokeLayoutExcluded, entry.included ? undefined : true);
    if (!entry.included) {
      const omitted = structuredClone(entry); const remove = (node) => { delete node.strokesIncludedInLayout; node.children?.forEach(remove); }; remove(omitted.source);
      assert.deepEqual(saved(imported(omitted).document), saved(value), "REST omission has its documented false meaning");
    }
  }
});

test("published schema/runtime/tool enforce only true on inside H/V Frame/Component sources", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const schema = JSON.parse(await readFile(new URL("../../../apps/design-studio/app/formats/codeshell-design-v3.schema.json", import.meta.url), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const source = saved(imported(fixture.cases[0]).document), node = source.pages[0].children[0].children[0];
  assert.equal(validate(source), true, JSON.stringify(validate.errors));
  for (const changes of [{ strokeLayoutExcluded: false }, { strokeLayoutExcluded: null }, { strokeLayoutExcluded: 1 }, { strokeLayoutExcluded: {} }, { layout: "none" }, { layout: "grid" }, { type: "group" }, { strokeAlign: "center" }, { strokeAlign: "outside" }]) {
    const invalid = structuredClone(source); Object.assign(invalid.pages[0].children[0].children[0], changes);
    assert.equal(validate(invalid), false, JSON.stringify(changes));
    assert.throws(() => normalizeDesignDocument(invalid), undefined, JSON.stringify(changes));
  }
  const zero = structuredClone(source); zero.pages[0].children[0].children[0].strokeSides.forEach((side) => { side.width = 0; });
  assert.equal(normalizeDesignDocument(zero).nodes[1].strokeLayoutExcluded, true);
  const component = structuredClone(source); component.pages[0].children[0].children[0].type = "component";
  assert.equal(validate(component), true, JSON.stringify(validate.errors));
  assert.equal(normalizeDesignDocument(component).nodes[1].strokeLayoutExcluded, true);
  const manifest = JSON.parse(await readFile(new URL("../../../apps/design-studio/.codeshell-panel/panel.json", import.meta.url), "utf8"));
  const rule = manifest.agent.tools.find((tool) => tool.name === "use_design").inputSchema;
  const { validateToolArgsStrict } = await import("@cjhyy/code-shell-core");
  for (const value of [true, null]) assert.equal(validateToolArgsStrict("use_design", { expected_state_revision: "stroke-layout", operations: [{ op: "update_node", node_id: node.id, changes: { strokeLayoutExcluded: value } }] }, rule), null);
  assert.notEqual(validateToolArgsStrict("use_design", { expected_state_revision: "stroke-layout", operations: [{ op: "update_node", node_id: node.id, changes: { strokeLayoutExcluded: false } }] }, rule), null);
});

test("source binding and comparison preserve provenance while invalidating it on layout/alignment edits", async () => {
  const entry = fixture.cases[0], result = await prepareFigmaImport({ id: "0:1", type: "CANVAS", name: "Native content Fill", children: [structuredClone(entry.source)] }), binding = createFigmaBinding(result);
  const node = result.document.nodes[1], original = saved(result.document);
  delete node.strokeLayoutExcluded;
  const patch = createFigmaPatch(binding, result.document);
  assert.ok(patch.operations.some((operation) => operation.changed?.includes("strokeLayoutExcluded")));
  assert.equal(compareDesignDocuments(original, saved(result.document)).passed, false);
  for (const changes of [{ layout: "none" }, { strokeAlign: "outside" }]) {
    const edited = { ...node, strokeLayoutExcluded: true, ...changes };
    clearInvalidStrokeLayoutExclusion(edited);
    assert.equal(edited.strokeLayoutExcluded, undefined);
  }
  for (const value of [null, 0, "false", {}]) {
    const raw = structuredClone(entry.source); raw.strokesIncludedInLayout = value;
    const unsupported = importFigmaJson(raw);
    assert.equal(unsupported.document.nodes[0].layout, "none");
    assert.ok(unsupported.warnings.some((warning) => warning.code === "unsupported-stroke-layout"));
  }
});

test("unsupported excluded Grid and mismatched native Fill models diagnose without rewriting measured geometry", () => {
  const grid = importFigmaJson(nativeGridSource({ strokesIncludedInLayout: false, strokeAlign: "INSIDE", strokeWeight: 4,
    strokes: [{ type: "SOLID", color: { r: .2, g: .4, b: .6 } }], paddingTop: 8, paddingRight: 8, paddingBottom: 8, paddingLeft: 8 }));
  assert.equal(grid.document.nodes[0].layout, "grid");
  assert.equal(grid.document.nodes[0].strokeLayoutExcluded, undefined);
  assert.ok(grid.warnings.some(warning => warning.code === "unsupported-stroke-layout"));
  const legacy = structuredClone(fixture.cases[0]); legacy.source.children[0].absoluteBoundingBox.width = 280;
  const result = imported(legacy);
  assert.equal(result.document.nodes[1].width, 280);
  assert.ok(result.warnings.some(warning => warning.code === "native-stroke-fill-model"));
  const unsupported = structuredClone(fixture.cases[0]);
  Object.assign(unsupported.source.children[0], { itemSpacing: -1, layoutWrap: "WRAP" });
  const fallback = imported(unsupported);
  assert.equal(fallback.document.nodes[1].layout, "none");
  assert.equal(fallback.document.nodes[1].strokeLayoutExcluded, undefined);
  assert.ok(fallback.warnings.some(warning => warning.code === "unsupported-negative-spacing"));
});

test("excluded inside stroke basis stays editable with exact independent CSS/SVG/frontend pixels", async () => {
  const browser = await chromium.launch();
  try {
    for (const entry of fixture.cases) for (const mainSize of entry.direction === "HORIZONTAL" ? [640, 400] : [320, 240]) {
      const value = imported(entry).document, parent = value.nodes[0], horizontal = entry.direction === "HORIZONTAL";
      const origin = { x: parent.x, y: parent.y };
      for (const node of value.nodes) { node.x -= origin.x; node.y -= origin.y; }
      parent[horizontal ? "width" : "height"] = mainSize;
      value.canvas.width = parent.width; value.canvas.height = parent.height; value.canvas.background = "#ffffff";
      applyAllAutoLayouts(value.nodes);
      const page = await browser.newPage({ viewport: { width: parent.width, height: parent.height }, deviceScaleFactor: 1 });
      const tile = (padding, stroke) => `<section style="flex:1 1 ${entry.included ? 0 : padding * 2 + stroke * 2}px;${horizontal ? "height:100px" : "width:160px"};padding:${padding - (entry.included ? 0 : stroke)}px;border:${stroke}px solid #dc2626;display:flex;flex-direction:${horizontal ? "row" : "column"};align-items:flex-start"><div style="flex:1 1 0;${horizontal ? "height:20px;min-width:0" : "width:20px;min-height:0"};background:#2563eb"></div></section>`;
      const reference = `<style>*{box-sizing:border-box}html,body{margin:0;background:white}main{display:flex;flex-direction:${horizontal ? "row" : "column"};width:${parent.width}px;height:${parent.height}px;padding:8px;gap:12px;align-items:flex-start;background:#f1f5f9}section{min-width:0;min-height:0}</style><main>${tile(8, 4)}${tile(20, 8)}</main>`;
      await page.setContent(reference); const expected = PNG.sync.read(await page.screenshot());
      for (const [mode, markup] of [["SVG", `<style>body{margin:0}svg{display:block}</style>${exportDesignSvg(value)}`], ["frontend", exportDesignFrontend(saved(value))]]) {
        await page.setContent(markup);
        assert.equal(Buffer.compare(PNG.sync.read(await page.screenshot()).data, expected.data), 0, `${entry.name}/${mainSize}/${mode}`);
      }
      await page.close();
    }
  } finally { await browser.close(); }
});
