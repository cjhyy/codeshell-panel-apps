import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { runProductionFidelity } from "../../../scripts/design-studio-production-fidelity.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { designNodeToV3 } from "../../../apps/design-studio/app/design-node-adapter.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";

import { negativeMarginFixtures, negativeMarginResidualFixtures } from "../../fixtures/design-studio-negative-margins/source.mjs";

const bySelector = (document, selector) => document.nodes.find((node) => JSON.parse(node.notes ?? "{}").cssSelector === selector && node.type === "frame");
const flatten = (node) => [node, ...(node.children ?? []).flatMap(flatten)];

test("negative horizontal block margins preserve original identities and ownership in both coordinate spaces", async () => {
  const outputs = [];
  for (const rootRelative of [false, true]) {
    const bounds = { x: rootRelative ? 95 : -5, y: rootRelative ? 210 : 10, width: 210, height: 20 };
    const child = { nodeType: "container", name: "row", semantic: { cssSelector: "#row" }, bounds,
      positioning: { mode: "absolute" }, layout: { display: "flex" }, children: [], cssLayout: {
        width: "auto", height: "20px", position: "static", "margin-left": "-15px", "margin-right": "-15px",
        "margin-top": "0px", "margin-bottom": "0px", "min-width": "auto", "max-width": "none",
      } };
    const source = { nodeType: "container", name: "parent", bounds: { x: 100, y: 200, width: 200, height: 100 },
      layout: { display: "block", padding: { left: 10, right: 10, top: 10, bottom: 10 } },
      cssLayout: { width: "200px", height: "100px" }, children: [{ nodeType: "container", name: "neg-margin-placeholder", opacity: 0,
        bounds: { ...bounds, width: 180 }, layout: { display: "block" }, children: [] }, child] };
    const freeze = (value) => { for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child); return Object.freeze(value); };
    const before = JSON.stringify(source); freeze(source);
    const result = await designNodeToV3(source, { coordinateSpace: rootRelative ? "root-relative" : "parent-relative" });
    assert.equal(JSON.stringify(source), before);
    const document = normalizeDesignDocument(result.document), row = bySelector(document, "#row");
    assert.equal(row.id, "html-0-1"); assert.equal(row.layoutPositioning, undefined);
    const wrapper = document.nodes.find((node) => node.id === row.parentId);
    assert.deepEqual([wrapper.gap, wrapper.layoutSizingHorizontal, wrapper.layoutSizingVertical], [-16, "fill", "hug"]);
    applyAllAutoLayouts(document.nodes);
    assert.deepEqual([row.x, row.y, row.width], [-5, 10, 210]);
    document.nodes[0].width = 160; applyAllAutoLayouts(document.nodes);
    assert.deepEqual([row.x, row.y, row.width], [-5, 10, 170]);
    outputs.push(document.nodes.map(({ id, x, y, width, height }) => [id, x, y, width, height]));
    for (const changes of [{ width: "50%" }, { "max-width": "100%" }, { "margin-left": "-5%" }, { "margin-left": "-15" }, { "margin-top": "-4px" }, { "margin-right": "8px" }]) {
      const invalid = structuredClone(source); Object.assign(invalid.children[1].cssLayout, changes);
      const fallback = await designNodeToV3(invalid, { coordinateSpace: rootRelative ? "root-relative" : "parent-relative" });
      assert.ok(fallback.report.warnings.some((warning) => warning.code === "block-flow-fixed"), JSON.stringify(changes));
    }
    const duplicate = structuredClone(source); duplicate.children.unshift(structuredClone(source.children[0]));
    const refused = await designNodeToV3(duplicate, { coordinateSpace: rootRelative ? "root-relative" : "parent-relative" });
    assert.ok(refused.report.warnings.some((warning) => warning.code === "block-flow-fixed"));
  }
  assert.deepEqual(outputs[0], outputs[1]);
});

test("production HTML negative margins rebase positive insets into native-safe editable flow", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-negative-margins-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const result = await runProductionFidelity({ output, cases: negativeMarginFixtures.filter((item) => item.id !== "clipped"), resizeMode: "viewport-only", height: 300 });
  for (const observed of result.cases) {
    assert.equal(observed.nativeTransfer.supported, true, observed.id);
    assert.equal(observed.semanticIssues.length, 0, JSON.stringify(observed));
    assert.ok(observed.warnings.some((warning) => warning.code === "block-inset-rebased"), observed.id);
    assert.ok(!observed.warnings.some((warning) => ["block-flow-fixed", "layout-margin-fixed", "viewport-flow-fixed"].includes(warning.code)), JSON.stringify(observed));
    assert.ok(observed.comparisons.every((comparison) => comparison.changedPixels === 0), JSON.stringify(observed));
    const original = normalizeDesignDocument(JSON.parse(await readFile(join(output, observed.id, "imported.codesign.json"), "utf8")));
    const narrow = normalizeDesignDocument(JSON.parse(await readFile(join(output, observed.id, "narrow.codesign.json"), "utf8")));
    const row = bySelector(original, "#row"), resized = bySelector(narrow, "#row");
    assert.equal(resized.id, row.id); assert.equal(row.layoutSizingHorizontal, "fill");
    assert.ok(original.nodes.every((node) => node.layoutPositioning !== "absolute"));
    const parent = bySelector(original, "#fixture"), wrapper = original.nodes.find((node) => node.id === row.parentId);
    assert.equal(wrapper.layout, "vertical"); assert.equal(wrapper.gap, 0);
    if (wrapper !== parent) {
      assert.equal(wrapper.clipContent, false);
      assert.equal(wrapper.layoutSizingHorizontal, "fill"); assert.equal(wrapper.layoutSizingVertical, "hug");
    }
    const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(narrow))); applyAllAutoLayouts(reopened.nodes);
    assert.deepEqual(reopened.nodes.map(({ id, x, y, width, height }) => [id, x, y, width, height]), narrow.nodes.map(({ id, x, y, width, height }) => [id, x, y, width, height]));
    const transfer = createFigmaTransfer(narrow);
    assert.ok(transfer.pages[0].children.every((node) => flatten(node).every((child) => child.gap === undefined || child.gap >= 0)));
    assert.equal(original.nodes.filter((node) => node.id.includes("-bleed-")).length, 0);
    const receipt = JSON.parse(parent.notes).blockInsetRebase;
    assert.deepEqual([parent.paddingLeft, parent.paddingRight], receipt.rebased);
    assert.deepEqual(receipt.original.map((value, index) => value - receipt.rebased[index]), receipt.bleed);
    if (observed.id === "symmetric") assert.deepEqual([row.width, resized.width, row.x, resized.x], [630, 390, 5, 5]);
    if (observed.id === "maximum") assert.deepEqual([row.width, resized.width], [480, 390]);
    if (observed.id === "minimum-overflow") assert.deepEqual([row.width, resized.width], [630, 480]);
    if (observed.id === "wrapped-row") assert.deepEqual([row.height, resized.height], [40, 90]);
  }
  assert.equal(result.passed, true);
  const unsupported = await runProductionFidelity({ output, cases: negativeMarginFixtures.filter((item) => item.id === "clipped"), resizeMode: "viewport-only", height: 300, recordOnly: true });
  assert.equal(unsupported.passed, false);
  assert.equal(unsupported.cases[0].nativeTransfer.supported, false);
  assert.ok(unsupported.cases[0].warnings.some((warning) => warning.code === "block-bleed-native-unsupported"));
  assert.ok(unsupported.cases[0].comparisons.every((comparison) => comparison.changedPixels === 0));
  // Edit authored text, resize only the outer frame, then save/reopen in the
  // actual browser measurer. Source HTML supplies an independent reference.
  // The editable CSS path independently consumes signed spacing as margins.
  const browser = await chromium.launch();
  try {
    for (const id of ["symmetric", "asymmetric", "small-margins", "maximum", "wrapped-row"]) for (const width of [640, 400]) {
      const page = await browser.newPage({ viewport: { width, height: 300 } });
      const design = JSON.parse(await readFile(join(output, id, width === 640 ? "imported.codesign.json" : "narrow.codesign.json"), "utf8"));
      await page.setContent(exportDesignFrontend(design));
      const actual = PNG.sync.read(await page.screenshot()), expected = PNG.sync.read(await readFile(join(output, id, width === 640 ? "imported-source.png" : "narrow-source.png")));
      assert.equal(Buffer.compare(actual.data, expected.data), 0, `${id}/${width} CSS pixels`);
      await page.close();
    }
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    const editedText = "The source stays editable. A longer replacement sentence must wrap inside the expanded negative-margin row and move the following block down when only the outer viewport is resized.";
    const sourceHtml = (await readFile(join(output, "editable-copy/source.html"), "utf8")).replace(/Editable ordinary text[^<]+/u, editedText);
    await page.setContent(sourceHtml); await page.evaluate(() => document.fonts.ready);
    const expected = PNG.sync.read(await page.screenshot());
    await page.route("https://negative-edit.test/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/") return route.fulfill({ body: "<!doctype html>" });
      if (!path.startsWith("/app/") || path.includes("..")) return route.abort();
      return route.fulfill({ contentType: "text/javascript", body: await readFile(resolve("apps/design-studio/app", path.slice(5))) });
    });
    await page.goto("https://negative-edit.test/");
    const edited = await page.evaluate(async ({ document, editedText }) => {
      const codec = await import("/app/document.mjs"), { applyAllAutoLayouts } = await import("/app/layout.mjs");
      const value = codec.normalizeDesignDocument(document);
      const text = value.nodes.find((node) => node.type === "text");
      text.text = text.textSource = editedText; delete text.textMetrics; delete text.textFlowWidth;
      value.canvas.width = 400; value.nodes.find((node) => node.id === "html-viewport").width = 400;
      applyAllAutoLayouts(value.nodes);
      const reopened = codec.normalizeDesignDocument(JSON.parse(codec.serializeDesignDocument(value)));
      applyAllAutoLayouts(reopened.nodes);
      return { document: JSON.parse(codec.serializeDesignDocument(reopened)), svg: codec.exportDesignSvg(reopened) };
    }, { document: JSON.parse(await readFile(join(output, "editable-copy/imported.codesign.json"), "utf8")), editedText });
    const reopened = normalizeDesignDocument(edited.document);
    assert.equal(reopened.nodes.find((node) => node.type === "text").textSource, editedText);
    assert.equal(bySelector(reopened, "#row").width, 390);
    await page.setContent(`<style>body{margin:0}svg{display:block}</style>${edited.svg}`);
    assert.equal(Buffer.compare(PNG.sync.read(await page.screenshot()).data, expected.data), 0, "source edit after outer-only resize");
    await page.close();
  } finally { await browser.close(); }
});


test("fractional CSS paint edges remain an explicit strict failure without rounding geometry or tolerances", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-negative-fractional-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const report = await runProductionFidelity({ output, cases: negativeMarginResidualFixtures, resizeMode: "viewport-only", height: 300, recordOnly: true });
  assert.equal(report.passed, false); assert.equal(report.recordOnly, true);
  assert.deepEqual(report.cases[0].comparisons.map((item) => [item.changedPixels, item.maximumChannelDelta, item.passed]), [[100, 95, false], [100, 95, false], [100, 95, false]]);
  for (const mode of ["imported", "narrow"]) {
    const design = normalizeDesignDocument(JSON.parse(await readFile(join(output, "fractional-paint-boundary", `${mode}.codesign.json`), "utf8")));
    const row = bySelector(design, "#row"), cells = design.nodes.filter((node) => node.parentId === row.id);
    assert.deepEqual(cells.map((node) => node.width), mode === "imported" ? [296.5, 296.5] : [176.5, 176.5]);
  }
});


test("negative-margin boundary plans diagnose unsupported expansion before constructing synthetic nodes", async () => {
  for (const [width, bleed, supported] of [[200, 1999, true], [200, 2000, false], [19990, 10, false]]) {
    const child = { nodeType: "container", name: "bounded row", semantic: { cssSelector: "#row" },
      bounds: { x: -bleed, y: 0, width: width + 2 * bleed, height: 20 }, positioning: { mode: "absolute" },
      cssLayout: { width: "auto", height: "20px", position: "static", "margin-left": `${bleed * -1}px`, "margin-right": `${bleed * -1}px`,
        "margin-top": "0px", "margin-bottom": "0px", "min-width": "auto", "max-width": "none" }, layout: { display: "flex" }, children: [] };
    const tree = { nodeType: "container", name: "bounded parent", bounds: { x: 0, y: 0, width, height: 100 },
      cssLayout: { width: `${width}px`, height: "100px" }, layout: { display: "block" }, children: [
        { nodeType: "container", name: "neg-margin-placeholder", opacity: 0,
          bounds: { x: -bleed, y: 0, width, height: 20 }, layout: { display: "block" }, children: [] }, child] };
    const before = JSON.stringify(tree), result = await designNodeToV3(tree);
    assert.equal(JSON.stringify(tree), before);
    const document = normalizeDesignDocument(result.document), row = bySelector(document, "#row");
    assert.equal(row.id, "html-0-1");
    assert.equal(document.nodes.some((node) => node.id.endsWith("-horizontal-bleed")), supported);
    if (supported) assert.equal(document.nodes.find((node) => node.id.endsWith("-horizontal-bleed")).gap, -2000);
    else assert.ok(result.report.warnings.some((warning) => warning.code === "block-flow-fixed"));
    applyAllAutoLayouts(document.nodes);
    assert.doesNotThrow(() => normalizeDesignDocument(JSON.parse(serializeDesignDocument(document))));
  }
});
