import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { importFigmaJson, prepareFigmaImport, createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { createFigmaBinding, createFigmaPatch } from "../../../apps/design-studio/app/figma-binding.mjs";
import { gridFillHugContentHeight, nativeGridPlan } from "../../../apps/design-studio/app/grid.mjs";
import { applyAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
const fixture = JSON.parse(await readFile(new URL("../../fixtures/design-studio-native-padded-row-grid/native-source.json", import.meta.url)));
const stages = JSON.parse(await readFile(new URL("../../fixtures/design-studio-native-padded-row-grid/native-stages.json", import.meta.url)));
const clone = structuredClone;
const flat = (n) => [n, ...(n.children ?? []).flatMap(flat)];
const find = (source, name) => flat(source.document).find((node) => node.name === name);
const rowName = "govuk-affine-cellvpad10-rowbottom1-included preserved-row0";
const nested = (value) => JSON.parse(serializeDesignDocument(value)).pages.flatMap((page) => page.children.flatMap(flat));
const canonicalId = (id) => `figma-${id.replace(":", "-")}`;

test("actual native preserved row Grids retain full hierarchy, padding, included rule and unchanged binding", async () => {
  const imported = importFigmaJson(fixture), value = imported.document;
  assert.deepEqual(imported.warnings, []);
  assert.equal(value.nodes.length, 67);
  assert.equal(value.nodes.filter((n) => n.layout === "grid").length, 9);
  assert.equal(value.nodes.filter((n) => n.type === "text").length, 27);
  for (const nativeCase of stages[0].cases) {
    const owner = value.nodes.find((n) => n.id === canonicalId(nativeCase.parentId));
    assert.deepEqual([owner.layout, owner.layoutSizingHorizontal, owner.layoutSizingVertical], ["vertical", "fixed", "hug"]);
    assert.deepEqual(value.nodes.filter((n) => n.parentId === owner.id).map((n) => n.id), nativeCase.rowGridIds.map(canonicalId));
    const hierarchy = nested(value);
    for (const id of nativeCase.rowGridIds) {
      const row = hierarchy.find((n) => n.id === canonicalId(id));
      assert.deepEqual([row.layoutSizingHorizontal, row.layoutSizingVertical], ["fill", "hug"]);
      assert.throws(() => nativeGridPlan(row), /内在尺寸循环/u, "a snapshot width alone is not parent context");
      assert.doesNotThrow(() => nativeGridPlan(row, owner));
      for (const cell of row.children) {
        const text = cell.children[0];
        assert.equal(gridFillHugContentHeight(row, cell, cell.children, owner), text.height + cell.paddingTop + cell.paddingBottom);
      }
    }
    for (const observed of nativeCase.nodes) {
      const node = value.nodes.find((n) => n.id === canonicalId(observed.id));
      assert.deepEqual(Object.fromEntries(["x", "y", "width", "height"].map((k) => [k, node[k]])), observed.absoluteBoundingBox);
    }
  }
  assert(!createFigmaTransfer(value).warnings.some((w) => w.code === "grid-export"));
  const prepared = await prepareFigmaImport(fixture), binding = createFigmaBinding(prepared);
  const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(prepared.document)));
  assert.deepEqual(createFigmaPatch(binding, reopened).operations, []);
});

test("scoped Text copy edits settle padded real cells and all sibling row positions without stale heights", () => {
  const imported = importFigmaJson(fixture), value = imported.document;
  // This width-only measurer tests propagation. It is not a native font metric oracle.
  const measurement = { configure() {}, fontAvailable: () => true, measure: (text) => ({ width: text.length * 8, bottom: 16, ink: { x: 0, y: 0, width: text.length * 8, height: 16 } }) };
  for (const c of stages[0].cases) {
    const owner = value.nodes.find((n) => n.id === canonicalId(c.parentId));
    const rows = c.rowGridIds.map((id) => value.nodes.find((n) => n.id === canonicalId(id)));
    const text = value.nodes.find((n) => n.id === canonicalId(c.textIds[0]));
    for (const [copy, expectedTextHeight] of [["Alpha\nBeta", 40], ["Alpha\nBeta\nGamma\nDelta", 80], ["Alpha\nBeta", 40]]) {
      text.textSource = copy;
      rows.forEach((row) => { row.height = 170; value.nodes.filter((n) => n.parentId === row.id).forEach((cell) => { cell.height = 170; }); });
      applyAutoLayouts(value.nodes, [text.id], { textMeasurer: measurement });
      const padding = c.name.includes("cellvpad0") ? 0 : 20, rule = c.name.includes("rowbottom1") ? 1 : 0;
      assert.equal(text.height, expectedTextHeight);
      assert.equal(rows[0].height, expectedTextHeight + padding + rule);
      assert.equal(rows[1].y, rows[0].y + rows[0].height);
      assert.equal(rows[2].y, rows[1].y + rows[1].height);
      assert.equal(owner.height, rows.reduce((sum, row) => sum + row.height, 0));
      assert(value.nodes.filter((n) => n.parentId === rows[0].id).every((cell) => cell.height === expectedTextHeight + padding));
    }
  }
});

test("unproven width owners, cell padding/content and row stroke models do not qualify", () => {
  const value = importFigmaJson(fixture).document, hierarchy = nested(value), row = hierarchy.find((n) => n.name === rowName), owner = hierarchy.find((n) => n.children?.some((child) => child.id === row.id));
  assert(row && owner);
  for (const edit of [(p) => {p.layout = "horizontal";}, (p) => {p.layoutSizingHorizontal = "hug";}, (p) => {p.layoutSizingHorizontal = "fill";}, (p) => {p.rotation = 10;}, (p) => {p.layoutWrap = "wrap";}]) {
    const changed = clone(owner); edit(changed); assert.throws(() => nativeGridPlan(row, changed), /内在尺寸循环/u);
  }
  for (const edit of [(r) => {r.paddingBottom = 0;}, (r) => {r.strokeAlign = "center";}, (r) => {r.strokeAlign = "outside";}, (r) => {r.strokeSides[2].width = 2;}, (r) => {r.strokeSides[0].width = 1;}, (r) => {r.gridRows = 2; r.gridRowSizes.push({type:"hug"});}, (r) => {r.children[0].paddingTop = -1;}, (r) => {r.children[0].paddingBottom = Infinity;}, (r) => {r.children[0].children.push(clone(r.children[0].children[0]));}]) {
    const changed = clone(row); edit(changed); assert.throws(() => nativeGridPlan(changed, owner), /内在尺寸循环|HUG/u);
  }
  for (const flag of [false, undefined, null, "true"]) {
    const source = clone(fixture), rawRow = find(source, rowName);
    if (flag === undefined) delete rawRow.strokesIncludedInLayout; else rawRow.strokesIncludedInLayout = flag;
    // An excluded raw padding of1 must not be mistaken for an included physical inset.
    rawRow.paddingBottom = 1;
    const result = importFigmaJson(source), rejected = result.document.nodes.find((n) => n.name === rowName);
    assert.equal(rejected.layout, "none");
    assert(result.warnings.some((warning) => warning.code === (flag === false || flag === undefined ? "unsupported-grid" : "unsupported-stroke-layout")));
    assert.equal(result.document.nodes.filter((n) => n.layout === "grid").length, 8);
  }
});

test("padded separate row Grid stays strict in real font CSS, SVG, frontend, source edits and reopen", async (t) => {
  const { chromium } = await import("playwright"), { PNG } = await import("pngjs"), { resolve, sep } = await import("node:path");
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 760, height: 450 }, deviceScaleFactor: 1 });
  const root = resolve("apps/design-studio/app"), font = await readFile(resolve(root, "fonts/InterVariable.woff2"));
  const fontCss = `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font.toString("base64")}) format('woff2');font-weight:100 900;font-style:normal;font-display:block}`;
  const blocked = [], errors = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.href === "https://padded-grid.test/") return route.fulfill({contentType:"text/html",body:`<!doctype html><style>${fontCss}</style>`});
    const path = resolve(root, `.${url.pathname}`);
    if (url.origin === "https://padded-grid.test" && path.startsWith(root + sep) && path.endsWith(".mjs")) return route.fulfill({ contentType:"text/javascript", body:await readFile(path) });
    blocked.push(url.href); return route.abort();
  });
  const page = await context.newPage(); page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("https://padded-grid.test/");
  const records = await page.evaluate(async ({ fixture, fontCss }) => {
    const { importFigmaJson } = await import("/figma-bridge.mjs");
    const { serializeDesignDocument, normalizeDesignDocument, exportDesignSvg } = await import("/document.mjs");
    const { createBrowserTextMeasurer, measureFigmaTextDocument } = await import("/text-metrics.mjs");
    const { applyAutoLayouts, applyAllAutoLayouts } = await import("/layout.mjs");
    const { exportDesignFrontend } = await import("/frontend-export.mjs");
    const loaded = await document.fonts.load("400 16px Inter", "Alpha Beta"); if (!loaded.length) throw Error("Exact control font missing");
    const stable = (v) => JSON.stringify(v, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry) ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key,entry[key]])) : entry);
    const escape = (s) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const records = [];
    for (const ownerRaw of fixture.document.children[0].children) {
      const raw = structuredClone(fixture); raw.document.children = [structuredClone(ownerRaw)];
      const imported = importFigmaJson(raw), value = imported.document, owner = value.nodes[0];
      if (imported.warnings.length) throw Error(JSON.stringify(imported.warnings));
      const dx = 20-owner.x, dy = 20-owner.y; for (const node of value.nodes) { node.x += dx; node.y += dy; }
      value.canvas = { width:760,height:450,background:"#ffffff" };
      const rows = value.nodes.filter((node) => node.parentId === owner.id), firstCell = value.nodes.find((node) => node.parentId === rows[0].id), text = value.nodes.find((node) => node.parentId === firstCell.id);
      const sources = new Map(); const collect = (node) => { sources.set(node.id,node); node.children?.forEach(collect); }; raw.document.children.forEach(collect);
      await measureFigmaTextDocument(value, { nativeLineBoxes:true, sourceNodes:sources, sourceIds:new Map(imported.mapping.map((m) => [m.designId,m.sourceId])) });
      const measurement = createBrowserTextMeasurer();
      const vpad = owner.name.includes("cellvpad0") ? 0 : 10, ruled = owner.name.includes("rowbottom1");
      const reference = (width, copy) => {
        const rowContent = rows.map((row, index) => `<div class="row">${[0,1,2].map((col) => `<div class="cell c${col}"><div class="copy">${escape(col === 0 ? index === 0 ? copy : index === 1 ? "An editable table cell wraps its original sentence when the available width changes." : "Lower\nrow" : "Peer")}</div></div>`).join("")}</div>`).join("");
        return `<!doctype html><style>${fontCss}*{box-sizing:border-box}html,body{margin:0;width:760px;height:450px;background:white}.owner{position:absolute;left:20px;top:20px;width:${width}px;display:flex;flex-direction:column}.row{display:grid;grid-template-columns:minmax(0,.3fr) 32px minmax(0,.5fr) minmax(0,.2fr) 8px;grid-template-rows:fit-content(100%);width:100%;background:#e2e8f0;${ruled ? "border-bottom:1px solid #b1b4b6;" : ""}}.cell{display:flex;flex-direction:column;min-width:0;min-height:0;padding:${vpad}px 0}.c0{grid-column:1/span 2;padding-right:20px;background:#fecaca}.c1{grid-column:3;padding-right:20px;background:#bbf7d0}.c2{grid-column:4/span 2;background:#bfdbfe}.copy{flex:none;width:100%;font:400 16px/20px Inter;color:#334155;white-space:pre-wrap}</style><div class="owner">${rowContent}</div>`;
      };
      try {
        for (const [width, copy] of [[630,"Alpha\nBeta"],[630,"Alpha\nBeta\nGamma\nDelta"],[630,"Alpha\nBeta"],[390,"Alpha\nBeta"],[630,"Alpha\nBeta"]]) {
          owner.width = width; text.textSource = copy;
          rows.forEach((row) => { row.height=170; value.nodes.filter((n) => n.parentId === row.id).forEach((cell) => { cell.height=170; }); });
          applyAutoLayouts(value.nodes, [owner.id,text.id], { textMeasurer:measurement });
          const saved = serializeDesignDocument(value), reopened = normalizeDesignDocument(JSON.parse(saved)); applyAllAutoLayouts(reopened.nodes,{textMeasurer:measurement});
          records.push({ name:owner.name,width,copy,ownerId:owner.id,textId:text.id,reference:reference(width,copy),svg:exportDesignSvg(value),frontend:exportDesignFrontend(JSON.parse(saved)),height:owner.height,rowHeights:rows.map((row) => row.height),stable:stable(JSON.parse(saved))===stable(JSON.parse(serializeDesignDocument(reopened))),allFonts:value.nodes.filter((n) => n.type === "text").every((n) => n.textMetrics?.fontAvailable === true) });
        }
      } finally { measurement.close(); }
    }
    return records;
  }, { fixture,fontCss });
  for (const record of records) {
    assert.equal(record.stable,true,`${record.name}/reopen`); assert.equal(record.allFonts,true);
    await page.setContent(record.reference); await page.evaluate(() => document.fonts.ready);
    const boxes = await page.locator(".owner").evaluate((node) => ({height:node.getBoundingClientRect().height,rows:[...node.children].map((row) => row.getBoundingClientRect().height)}));
    assert.deepEqual(boxes,{height:record.height,rows:record.rowHeights},`${record.name}/${record.width}/CSS geometry`);
    const reference = PNG.sync.read(await page.screenshot());
    for (const [mode, html] of [["SVG",`<!doctype html><style>${fontCss}html,body{margin:0;background:white}svg{display:block}</style>${record.svg}`],["frontend",record.frontend.replace("<head>",`<head><style>${fontCss}</style>`)]]) {
      await page.setContent(html); await page.evaluate(() => document.fonts.ready); const pixels = PNG.sync.read(await page.screenshot());
      assert(pixels.data.equals(reference.data),`${record.name}/${record.width}/${mode}/${record.copy} strict pixels`);
    }
  }
  // A plain exported DOM edit must resolve its real row and owner height itself.
  for (const record of records.filter((r) => r.width === 630 && r.copy.includes("Gamma"))) {
    await page.setContent(record.frontend.replace("<head>",`<head><style>${fontCss}</style>`));
    const referencePage = await context.newPage();
    try {
      for (const width of [390,630]) {
        await page.locator(`[data-codeshell-source-id="${record.ownerId}"]`).evaluate((node,w) => {node.style.width=`${w}px`;},width);
        await page.locator(`[data-codeshell-source-id="${record.textId}"]`).evaluate((node) => {node.textContent="Alpha\nBeta";});
        const reference = records.find((r) => r.name===record.name && r.width===width && r.copy==="Alpha\nBeta");
        await referencePage.setContent(reference.reference); await Promise.all([page.evaluate(() => document.fonts.ready),referencePage.evaluate(() => document.fonts.ready)]);
        const pxA=PNG.sync.read(await page.screenshot()),pxB=PNG.sync.read(await referencePage.screenshot());
        assert(pxA.data.equals(pxB.data),`${record.name}/${width}/direct exported edit strict pixels`);
      }
    } finally {await referencePage.close();}
  }
  assert.deepEqual(blocked,[]); assert.deepEqual(errors,[]);
});
