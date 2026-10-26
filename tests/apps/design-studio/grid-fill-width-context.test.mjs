import { settleLoadedFont, recordFontPixelMismatch, loadedFontBrowserArgs } from "./fixtures/loaded-font.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { test } from "node:test";
import { fillContextSource } from "../../fixtures/design-studio-native-grid-intrinsic-vflow/fill-context.mjs";
import { createFigmaTransfer, importFigmaJson } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { gridFillHugContentHeight, nativeGridPlan } from "../../../apps/design-studio/app/grid.mjs";
import { applyAllAutoLayouts, applyAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";

const clone = (value) => structuredClone(value);
const stable = (value) => JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
  ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]])) : entry);
const tree = (document) => JSON.parse(serializeDesignDocument(document)).pages[0].children;
const indexTree = (roots) => {
  const parents = new WeakMap(), all = [];
  const visit = (node, parent) => { parents.set(node, parent); all.push(node); node.children?.forEach((child) => visit(child, node)); };
  roots.forEach((node) => visit(node, null));
  return { all, parentOf: (node) => parents.get(node) };
};
const measurement = {
  configure() {}, measure: (value) => ({ width: value.length * 5, bottom: 19, ink: { x: 0, y: 0, width: value.length * 5, height: 19 } }), fontAvailable: () => true,
};

test("native import and transfer prove an actual fixed→Fill→Fill owner chain without retaining proof flags", () => {
  const raw = fillContextSource(), before = clone(raw), imported = importFigmaJson(raw);
  assert.deepEqual(raw, before);
  assert.deepEqual(imported.warnings, []);
  assert.equal(imported.document.nodes.length, 27);
  assert.equal(imported.document.nodes.filter((node) => node.layout === "grid").length, 4);
  assert.deepEqual(createFigmaTransfer(imported.document).warnings, []);
  const roots = tree(imported.document), { all, parentOf } = indexTree(roots);
  for (const row of all.filter((node) => node.layout === "grid")) {
    const parent = parentOf(row);
    assert.equal(parent.layoutSizingHorizontal, "fill");
    assert.equal(gridFillHugContentHeight(row, row.children[1], row.children[1].children, parent), null, "measured Fill owner alone is not certification");
    assert.notEqual(gridFillHugContentHeight(row, row.children[1], row.children[1].children, parent, parentOf), null);
    assert.doesNotThrow(() => nativeGridPlan(row, parent, parentOf));
    assert.throws(() => nativeGridPlan(row, parent), /内在尺寸循环/u);
  }
  delete roots[0].layoutSizingHorizontal;
  assert.doesNotThrow(() => nativeGridPlan(all.find((node) => node.layout === "grid"), all.find((node) => node.name.endsWith("DL owner")), parentOf), "canonical default Fixed is accepted only at a real root");
  const serialized = serializeDesignDocument(imported.document);
  assert(!serialized.includes("resolvedWidth") && !serialized.includes("widthProof"));
});

test("outer-only width and scoped nested copy edits survive Fill ancestors, save/reopen and current reparenting", () => {
  let document = importFigmaJson(fillContextSource()).document;
  const ids = document.nodes.map((node) => node.id);
  for (const [width, copy, expectedHeight] of [[1280, "07700 900457", 269], [768, "A\nB\nC\nD", 344], [768, "07700 900457", 269], [1280, "07700 900457", 269]]) {
    const root = document.nodes[0], body = document.nodes.find((node) => node.name === "Bounded Fill body control"), owner = document.nodes.find((node) => node.name.endsWith("DL owner")), phone = document.nodes.find((node) => node.name.endsWith("phone Text"));
    root.width = width;
    applyAutoLayouts(document.nodes, [root.id], { textMeasurer: measurement });
    phone.textSource = copy;
    for (const node of document.nodes.filter((node) => node.type === "frame" && node !== root)) node.height = 170;
    applyAutoLayouts(document.nodes, [phone.id], { textMeasurer: measurement });
    assert.equal(root.width, width);
    assert.deepEqual([body.width, owner.width, owner.x, owner.y, owner.height], [width, width - 60, 30, 30, expectedHeight]);
    assert.equal(body.height, expectedHeight + 60);
    assert.equal(phone.height, copy.includes("\n") ? 100 : 25);
    assert(document.nodes.filter((node) => node.layout === "grid").every((node) => node.width === width - 60));
    const saved = JSON.parse(serializeDesignDocument(document));
    document = normalizeDesignDocument(saved);
    applyAllAutoLayouts(document.nodes, { textMeasurer: measurement });
    assert.equal(stable(JSON.parse(serializeDesignDocument(document))), stable(saved));
    assert.deepEqual(document.nodes.map((node) => node.id), ids);
    assert.deepEqual(createFigmaTransfer(document).warnings, []);
  }
  // A new operation indexes the current parent relation after reparenting; no
  // successful earlier proof survives a Hug owner, missing owner or cycle.
  const owner = document.nodes.find((node) => node.name.endsWith("DL owner"));
  const body = document.nodes.find((node) => node.name === "Bounded Fill body control");
  const parentId = owner.parentId;
  const unresolved = { ...clone(body), id: "reparented-hug-owner", name: "Reparented Hug owner control", layoutSizingHorizontal: "hug" };
  document.nodes.splice(2, 0, unresolved);
  owner.parentId = unresolved.id;
  for (const current of [document, normalizeDesignDocument(JSON.parse(serializeDesignDocument(document)))])
    assert.equal(createFigmaTransfer(current).warnings.filter((warning) => warning.code === "grid-export").length, 4, "valid reparent/reopen retires the old successful width proof");
  owner.parentId = parentId;
  document.nodes.splice(document.nodes.indexOf(unresolved), 1);
  assert.deepEqual(createFigmaTransfer(document).warnings, [], "returning to the actual Fill chain is proved again");
  for (const edit of [() => { body.layoutSizingHorizontal = "hug"; }, () => { owner.parentId = "missing-owner"; }, () => { owner.parentId = owner.id; }]) {
    edit();
    const byId = new Map(document.nodes.map((node) => [node.id, node])), parentOf = (node) => node.parentId ? byId.get(node.parentId) : null;
    const row = document.nodes.find((node) => node.name.endsWith("row3")), cell = document.nodes.find((node) => node.name.endsWith("real-DD3"));
    assert.equal(gridFillHugContentHeight(row, cell, (node) => document.nodes.filter((entry) => entry.parentId === node.id), parentOf(row), parentOf), null);
    body.layoutSizingHorizontal = "fill"; owner.parentId = parentId;
  }
});

test("width context refuses unsupported or fabricated ancestry atomically and remains bounded", () => {
  for (const [label, edit] of [
    ["Hug root", (root) => { root.layoutSizingHorizontal = "hug"; }],
    ["Fill root without owner", (root) => { root.layoutSizingHorizontal = "fill"; }],
    ["manual parent", (_root, body) => { body.layout = "none"; }],
    ["horizontal parent", (_root, body) => { body.layout = "horizontal"; }],
    ["Grid parent", (_root, body) => { body.layout = "grid"; }],
    ["constraint", (_root, body) => { body.minWidth = 1; }],
    ["rotation", (_root, body) => { body.rotation = 1; }],
    ["hidden", (_root, body) => { body.visible = false; }],
    ["absolute", (_root, body) => { body.layoutPositioning = "absolute"; }],
    ["reverse", (_root, body) => { body.layoutReverse = true; }],
    ["wrap", (_root, body) => { body.layoutWrap = "wrap"; }],
    ["before margin", (_root, body) => { body.layoutMarginBefore = 1; }],
    ["negative gap", (_root, body) => { body.gap = -1; }],
    ["padding", (_root, body) => { body.paddingLeft = -1; }],
    ["unbounded padding", (_root, body) => { body.paddingLeft = Infinity; }],
    ["stroke", (_root, body) => { body.strokeWidth = 1; }],
    ["cross alignment", (_root, body) => { body.alignItems = "center"; }],
  ]) {
    const roots = tree(importFigmaJson(fillContextSource()).document), { all, parentOf } = indexTree(roots);
    const row = all.find((node) => node.name.endsWith("row3")), body = all.find((node) => node.name === "Bounded Fill body control");
    edit(roots[0], body);
    const before = clone(roots);
    assert.equal(gridFillHugContentHeight(row, row.children[1], row.children[1].children, parentOf(row), parentOf), null, label);
    assert.deepEqual(roots, before, label);
    assert.throws(() => nativeGridPlan(row, parentOf(row), parentOf), /内在尺寸循环/u, label);
  }
  const roots = tree(importFigmaJson(fillContextSource()).document), { all, parentOf } = indexTree(roots), row = all.find((node) => node.name.endsWith("row3"));
  assert.equal(gridFillHugContentHeight(row, row.children[1], row.children[1].children, roots[0], parentOf), null, "mismatched source parent cannot certify width");
  let owner = parentOf(row);
  const parents = new WeakMap(); parents.set(row, owner);
  for (let index = 0; index < 33; index++) {
    const next = { ...owner, id: `deep-${index}`, children: undefined, layoutSizingHorizontal: "fill" };
    parents.set(owner, next); owner = next;
  }
  owner.layoutSizingHorizontal = "fixed"; parents.set(owner, null);
  assert.equal(gridFillHugContentHeight(row, row.children[1], row.children[1].children, parentOf(row), (node) => parents.get(node)), null, "ancestor budget");
  parents.set(parentOf(row), parentOf(row));
  assert.equal(gridFillHugContentHeight(row, row.children[1], row.children[1].children, parentOf(row), (node) => parents.get(node)), null, "ancestor object cycle");
});

test("CPU loaded-font frontend follows only the outer width and nested copy without canonical height repairs", async (t) => {
  const { chromium } = await import("playwright"), { PNG } = await import("pngjs");
  const browser = await chromium.launch({ args: loadedFontBrowserArgs() });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1360, height: 600 }, deviceScaleFactor: 1 });
  const root = resolve("apps/design-studio/app"), blocked = [], errors = [];
  const bytes = await readFile(resolve(root, "fonts/InterVariable.woff2"));
  const fontCss = `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${bytes.toString("base64")}) format('woff2');font-weight:100 900;font-style:normal;font-display:block}`;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url()), file = resolve(root, `.${url.pathname}`);
    if (url.href === "https://fill-context.test/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><style>${fontCss}</style>` });
    if (url.origin === "https://fill-context.test" && file.startsWith(root + sep) && file.endsWith(".mjs"))
      return route.fulfill({ contentType: "text/javascript", body: await readFile(file) });
    blocked.push(url.href); return route.abort();
  });
  const page = await context.newPage(), referencePage = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("https://fill-context.test/");
  const exported = await page.evaluate(async (source) => {
    const { importFigmaJson } = await import("/figma-bridge.mjs");
    const { serializeDesignDocument } = await import("/document.mjs");
    const { measureFigmaTextDocument, createBrowserTextMeasurer } = await import("/text-metrics.mjs");
    const { applyAllAutoLayouts } = await import("/layout.mjs");
    const { exportDesignFrontend } = await import("/frontend-export.mjs");
    const loaded = await document.fonts.load("400 19px Inter", "Contact details");
    if (!loaded.length || loaded.some((font) => font.status !== "loaded")) throw Error("Inter fixture font unavailable");
    const imported = importFigmaJson(source), value = imported.document, sourceNodes = new Map();
    const visit = (node) => { sourceNodes.set(node.id, node); node.children?.forEach(visit); };
    source.document.children.forEach(visit);
    await measureFigmaTextDocument(value, { nativeLineBoxes: true, sourceNodes, sourceIds: new Map(imported.mapping.map((entry) => [entry.designId, entry.sourceId])) });
    const measurement = createBrowserTextMeasurer();
    try { applyAllAutoLayouts(value.nodes, { textMeasurer: measurement }); } finally { measurement.close(); }
    // This explicitly separate stroke-free control exercises browser flow.
    // Actual centered-side paint remains an explicit unsupported CSS export.
    for (const node of value.nodes.filter((node) => node.layout === "grid")) {
      delete node.strokeSides; node.stroke = "transparent"; node.strokeWidth = 0;
    }
    value.canvas = { width: 1360, height: 600, background: "#ffffff" };
    return { html: exportDesignFrontend(JSON.parse(serializeDesignDocument(value))), rootId: value.nodes[0].id, phoneId: value.nodes.find((node) => node.name.endsWith("phone Text")).id };
  }, fillContextSource());
  const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const reference = (width, copy) => `<!doctype html><style>${fontCss}*{box-sizing:border-box}html,body{margin:0;background:white}.outer{display:flex;flex-direction:column;width:${width}px;height:600px}.body{display:flex;flex-direction:column;width:100%;padding:30px}.table{display:flex;flex-direction:column;width:100%;padding-bottom:.5px}.row{display:grid;grid-template-columns:minmax(0,.3fr) 32px minmax(0,.7fr) 8px;flex:none}.cell{display:flex;flex-direction:column;min-width:0;min-height:0;padding:10.5px 0;align-self:stretch}.key{grid-column:1/span 2;padding-right:20px}.value{grid-column:3/span 2}.row:first-child .cell{padding-top:10px}.contact{padding-top:9.5px}.wrapper{display:flex;flex-direction:column;padding:1px 0 10px;flex:none}.para{display:flex;flex-direction:column;flex:none}.text{width:100%;flex:none;font:400 19px/25px Inter;white-space:pre-wrap;overflow-wrap:anywhere;color:#334155}</style><div class="outer"><div class="body"><div class="table"><div class="row"><div class="cell key"><div class="text">Name</div></div><div class="cell value"><div class="text">Sarah Phillips</div></div></div><div class="row"><div class="cell key"><div class="text">Date of birth</div></div><div class="cell value"><div class="text">5 January 1978</div></div></div><div class="row"><div class="cell key"><div class="text">Address</div></div><div class="cell value"><div class="text">72 Guild Street\nLondon\nSE23 6FH</div></div></div><div class="row"><div class="cell key"><div class="text">Contact details</div></div><div class="cell value contact"><div class="wrapper"><div class="para"><div class="text">${escape(copy)}</div></div></div><div class="para"><div class="text">sarah.phillips@example.com</div></div></div></div></div></div></div>`;
  await page.setContent(exported.html.replace("<head>", `<head><style>${fontCss}</style>`));
  for (const [width, copy] of [[1280, "07700 900457"], [768, "A\nB\nC\nD"], [768, "07700 900457"], [768, "This editable paragraph wraps naturally after only its outer viewport becomes narrower, while its second paragraph keeps its original identity."], [1280, "07700 900457"]]) {
    await page.locator(`[data-codeshell-source-id="${exported.rootId}"]`).evaluate((node, width) => { node.style.width = `${width}px`; }, width);
    await page.locator(`[data-codeshell-source-id="${exported.phoneId}"]`).evaluate((node, copy) => { node.textContent = copy; }, copy);
    await page.evaluate(() => document.fonts.ready);
    await referencePage.setContent(reference(width, copy));
    await Promise.all([settleLoadedFont(page), settleLoadedFont(referencePage)]);
    const actualBytes = await page.screenshot(), expectedBytes = await referencePage.screenshot();
    await recordFontPixelMismatch(page, referencePage, actualBytes, expectedBytes, `fill-context-${width}-${copy.length}`);
    assert(PNG.sync.read(actualBytes).data.equals(PNG.sync.read(expectedBytes).data), `${width}/${JSON.stringify(copy)} strict independent frontend pixels`);
    const positions = await page.locator('.cs-node').evaluateAll((nodes) => nodes.slice(1).map((node) => getComputedStyle(node).position));
    assert(positions.every((value) => value !== "absolute"), "every preserved ordinary descendant remains in real browser flow");
  }
  await referencePage.close();
  assert.deepEqual(blocked, []); assert.deepEqual(errors, []);
});
