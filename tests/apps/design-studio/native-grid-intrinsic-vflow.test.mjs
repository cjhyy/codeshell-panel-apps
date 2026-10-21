import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { test } from "node:test";
import { createFigmaTransfer, importFigmaJson, prepareFigmaImport } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { createFigmaBinding, createFigmaPatch } from "../../../apps/design-studio/app/figma-binding.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { gridFillHugContentHeight, nativeGridPlan } from "../../../apps/design-studio/app/grid.mjs";
import { applyAllAutoLayouts, applyAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";

const fixture = new URL("../../fixtures/design-studio-native-grid-intrinsic-vflow/", import.meta.url);
const bytes = await readFile(new URL("native-source.json", fixture));
const actual = JSON.parse(bytes),
  stages = JSON.parse(await readFile(new URL("native-stages.json", fixture))),
  provenance = JSON.parse(await readFile(new URL("provenance.json", fixture))),
  residuals = JSON.parse(await readFile(new URL("native-residuals.json", fixture)));
const clone = (value) => structuredClone(value);
const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
const children = (document, node) => document.nodes.filter((child) => child.parentId === node.id);
const bySource = (document, sourceId) => document.nodes.find((node) => node.id === `figma-${sourceId.replace(":", "-")}`);
const snapshot = (document) => JSON.parse(serializeDesignDocument(document));
const stable = (value) => JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
  ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]])) : entry);
const nested = () => {
  const document = importFigmaJson(actual).document;
  const nodes = flatten(snapshot(document).pages[0].children);
  return { document, nodes, row: nodes.find((node) => node.name.endsWith("row3")), parent: nodes.find((node) => node.name.endsWith("DL owner")) };
};
// Explicit authored line breaks and a width-only fake measurer isolate dependency
// ordering. This does not stand in for the actual native font/PNG evidence.
const measurement = {
  configure() {},
  measure: (value) => ({ width: value.length * 5, bottom: 19, ink: { x: 0, y: 0, width: value.length * 5, height: 19 } }),
  fontAvailable: () => true,
};

test("actual multi-paragraph Grid source preserves all real layers and source-bound unchanged reopen", async () => {
  assert.equal(createHash("sha256").update(bytes).digest("hex"), provenance.sourceSha256);
  const before = clone(actual), imported = importFigmaJson(actual), document = imported.document;
  assert.deepEqual(actual, before);
  assert.deepEqual(imported.warnings, []);
  assert.equal(document.nodes.length, 26);
  assert.equal(document.nodes.filter((node) => node.layout === "grid").length, 4);
  assert.equal(document.nodes.filter((node) => node.type === "text").length, 9);
  assert.equal(document.nodes.filter((node) => node.name.includes("real-P")).length, 2);
  assert.deepEqual(createFigmaTransfer(document).warnings, []);
  for (const source of flatten(actual.document.children).filter((node) => node.type !== "CANVAS")) {
    const node = bySource(document, source.id);
    assert(node, source.id);
    assert.equal(node.name, source.name);
    assert.deepEqual(children(document, node).map((child) => child.id), (source.children ?? []).map((child) => `figma-${child.id.replace(":", "-")}`));
    if (node.type === "text") assert.equal(node.textSource, source.characters);
  }
  const prepared = await prepareFigmaImport(actual), reopened = normalizeDesignDocument(snapshot(prepared.document));
  assert.deepEqual(createFigmaPatch(createFigmaBinding(prepared), reopened).operations, []);
});

test("scoped nested copy edits derive every Hug height and match all actual vertical stages exactly", () => {
  const document = importFigmaJson(actual).document, source = stages[0].cases[0];
  const parent = bySource(document, source.parentId), phone = bySource(document, source.growTextId);
  const originalOrder = document.nodes.map((node) => [node.id, node.parentId]);
  let strictHorizontalDifferences = 0;
  for (const stage of stages) {
    const expected = stage.cases[0];
    for (const node of document.nodes.filter((node) => node.type === "frame" && node.layout !== "none")) node.height = 170;
    if (stage.requested.kind === "width") parent.width = stage.requested.width;
    phone.textSource = expected.characters;
    applyAutoLayouts(document.nodes, [stage.requested.kind === "width" ? parent.id : phone.id], { textMeasurer: measurement });
    assert.deepEqual(document.nodes.map((node) => [node.id, node.parentId]), originalOrder);
    for (const [sourceId, [x, y, width, height]] of Object.entries(expected.boxes)) {
      const node = bySource(document, sourceId);
      assert.deepEqual([node.y, node.height], [y, height], `${stage.name}/${sourceId} actual vertical geometry`);
      if (stage.name === "04-width708") {
        strictHorizontalDifferences += Number(node.x !== x) + Number(node.width !== width);
      } else assert.deepEqual([node.x, node.width], [x, width], `${stage.name}/${sourceId} integer width geometry`);
    }
    const wrapper = bySource(document, source.marginWrapperId), firstP = bySource(document, source.paragraphIds[0]);
    const grown = stage.requested.copyKey === "grown";
    assert.deepEqual([parent.height, wrapper.height, firstP.height], grown ? [344, 111, 100] : [269, 36, 25]);
    assert.equal(phone.textSource, expected.characters);
    const saved = snapshot(document), reopened = normalizeDesignDocument(saved);
    applyAllAutoLayouts(reopened.nodes, { textMeasurer: measurement });
    assert.equal(stable(snapshot(reopened)), stable(saved), `${stage.name} reopen/reflow`);
    assert.deepEqual(createFigmaTransfer(reopened).warnings, []);
  }
  assert.equal(strictHorizontalDifferences, 0, "resolved Grid Float32 endpoints preserve every retained actual fractional column exactly");
  assert.equal(residuals.originalStrictGeometry, false);
});

test("nested/flat intrinsic height uses proven descendants, finite positive padding/gap and unchanged direct Rectangle control", () => {
  const { document, row, parent } = nested(), cell = row.children[1];
  assert.equal(gridFillHugContentHeight(row, cell, cell.children, parent), 81);
  const flatRow = document.nodes.find((node) => node.id === row.id), flatCell = document.nodes.find((node) => node.id === cell.id);
  assert.equal(gridFillHugContentHeight(flatRow, flatCell, (node) => children(document, node), document.nodes.find((node) => node.id === parent.id)), 81);
  cell.gap = 3;
  cell.children[0].gap = 4;
  cell.children[0].paddingTop = 2;
  cell.children[0].children[0].paddingBottom = 2;
  assert.equal(gridFillHugContentHeight(row, cell, cell.children, parent), 87);
  cell.children[0].layoutSizingHorizontal = "fixed";
  cell.children[0].layoutAlignSelf = "start";
  assert.equal(gridFillHugContentHeight(row, cell, cell.children, parent), 87);
  for (const node of [cell, cell.children[0], cell.children[0].children[0]]) node.height = 170;
  assert.equal(gridFillHugContentHeight(row, cell, cell.children, parent), 87, "old stretched wrapper heights are never intrinsic contributors");
  const rectangle = { id: "rectangle", type: "rectangle", height: 40, layoutSizingVertical: "fixed", layoutSizingHorizontal: "fill" };
  delete row.strokeSides; row.strokeWidth = 0; row.strokeAlign = "inside";
  cell.paddingTop = 0; cell.paddingBottom = 0; cell.gap = 0; cell.children = [rectangle];
  assert.equal(gridFillHugContentHeight(row, cell, cell.children, parent), 40);
  cell.children = [{ ...cell, id: "unproven", layoutSizingVertical: "hug", children: [rectangle] }];
  assert.equal(gridFillHugContentHeight(row, cell, cell.children, parent), null, "nested Rectangle was not proved by the paragraph receipt");
});

test("intrinsic paragraph admission rejects unsupported flow, cycles and budgets without mutating nodes", () => {
  const mutations = [
    ["owner Hug width", (_row, _cell, parent) => { parent.layoutSizingHorizontal = "hug"; }],
    ["owner min-width", (_row, _cell, parent) => { parent.minWidth = 1; }],
    ["row unresolved width", (row) => { row.layoutSizingHorizontal = "hug"; }],
    ["negative gap", (_row, cell) => { cell.gap = -1; }],
    ["nonfinite gap", (_row, cell) => { cell.children[0].gap = Infinity; }],
    ["negative padding", (_row, cell) => { cell.children[0].paddingBottom = -1; }],
    ["oversize padding", (_row, cell) => { cell.children[0].paddingBottom = 2001; }],
    ["Fill height", (_row, cell) => { cell.children[0].layoutSizingVertical = "fill"; }],
    ["Hug width", (_row, cell) => { cell.children[0].layoutSizingHorizontal = "hug"; }],
    ["hidden", (_row, cell) => { cell.children[0].visible = false; }],
    ["absolute", (_row, cell) => { cell.children[0].layoutPositioning = "absolute"; }],
    ["reverse", (_row, cell) => { cell.children[0].layoutReverse = true; }],
    ["wrap", (_row, cell) => { cell.children[0].layoutWrap = "wrap"; }],
    ["horizontal", (_row, cell) => { cell.children[0].layout = "horizontal"; }],
    ["minmax", (_row, cell) => { cell.children[0].maxHeight = 200; }],
    ["rotation", (_row, cell) => { cell.children[0].rotation = 1; }],
    ["distribution", (_row, cell) => { cell.children[0].justifyContent = "center"; }],
    ["cross alignment", (_row, cell) => { cell.children[0].alignItems = "center"; }],
    ["before margin", (_row, cell) => { cell.children[0].layoutMarginBefore = 1; }],
    ["stroke", (_row, cell) => { cell.children[0].strokeWidth = 1; }],
    ["sparse stroke", (_row, cell) => { cell.children[0].strokeSides = Array(4); }],
    ["empty", (_row, cell) => { cell.children[0].children = []; }],
    ["sparse children", (_row, cell) => { cell.children = Array(2); }],
    ["mixed direct content", (_row, cell) => { cell.children.push(clone(cell.children[1].children[0])); }],
    ["multiple direct Text", (_row, cell) => { cell.children = [clone(cell.children[1].children[0]), clone(cell.children[1].children[0])]; }],
    ["missing text source", (_row, cell) => { delete cell.children[0].children[0].children[0].textSource; }],
    ["ellipsis", (_row, cell) => { cell.children[0].children[0].children[0].textOverflow = "ellipsis"; }],
    ["unbounded line height", (_row, cell) => { cell.children[0].children[0].children[0].lineHeight = 200; }],
    ["height overflow", (_row, cell) => { cell.children[0].children[0].children[0].height = 20000; }],
    ["duplicate reference", (_row, cell) => { cell.children[1] = cell.children[0]; }],
    ["cycle", (_row, cell) => { cell.children[0].children = [cell]; }],
    ["child budget", (_row, cell) => { cell.children = Array.from({ length: 17 }, () => clone(cell.children[1])); }],
    ["node budget", (_row, cell) => { const p = cell.children[1]; cell.children = Array.from({ length: 16 }, () => clone(p)); }],
    ["depth budget", (_row, cell) => { const p = cell.children[1]; p.children = [{ ...clone(p), children: [{ ...clone(p), children: [{ ...clone(p) }] }] }]; }],
  ];
  for (const [label, mutate] of mutations) {
    const { row, parent } = nested(), cell = row.children[1];
    mutate(row, cell, parent);
    const before = clone({ row, parent });
    assert.equal(gridFillHugContentHeight(row, cell, cell.children, parent), null, label);
    assert.deepEqual({ row, parent }, before, `${label} mutation`);
    assert.throws(() => nativeGridPlan(row, parent), /内在尺寸循环|HUG 容器/u, label);
  }
});

test("nested source typography cannot qualify after lossy single-style conversion", () => {
  for (const [label, edit] of [
    ["mixed", (text) => { text.characterStyleOverrides = [1]; text.styleOverrideTable = { 1: { fontSize: 20 } }; }],
    ["list", (text) => { text.lineTypes = ["UNORDERED"]; }],
    ["indent", (text) => { text.lineIndentations = [1]; }],
    ["paragraph spacing", (text) => { text.style.paragraphSpacing = 10; }],
    ["paragraph indent", (text) => { text.style.paragraphIndent = 10; }],
    ["case", (text) => { text.style.textCase = "UPPER"; }],
    ["truncation", (text) => { text.style.textTruncation = "ENDING"; text.style.maxLines = 1; }],
    ["unknown unit", (text) => { text.style.lineHeightUnit = "UNKNOWN"; }],
  ]) {
    const raw = clone(actual), source = flatten(raw.document.children).find((node) => node.id === stages[0].cases[0].growTextId);
    edit(source);
    const before = clone(raw), imported = importFigmaJson(raw), row = bySource(imported.document, stages[0].cases[0].rowGridIds[3]);
    assert.deepEqual(raw, before);
    assert.equal(row.layout, "none", label);
    assert(imported.warnings.some((warning) => warning.code === "unsupported-grid"), label);
    assert.equal(bySource(imported.document, source.id).textSource, source.characters, label);
  }
});

test("loaded-font nested paragraphs wrap, shrink and reopen with independently measured browser flow", async (t) => {
  const { chromium } = await import("playwright"), { PNG } = await import("pngjs");
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1360, height: 600 }, deviceScaleFactor: 1 });
  const root = resolve("apps/design-studio/app"), blocked = [], errors = [];
  const fontBytes = await readFile(resolve(root, "fonts/InterVariable.woff2"));
  const fontCss = `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${fontBytes.toString("base64")}) format('woff2');font-weight:100 900;font-style:normal;font-display:block}`;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url()), file = resolve(root, `.${url.pathname}`);
    if (url.href === "https://intrinsic-flow.test/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><style>${fontCss}body{margin:0;background:white}</style>` });
    if (url.origin === "https://intrinsic-flow.test" && file.startsWith(root + sep) && file.endsWith(".mjs"))
      return route.fulfill({ contentType: "text/javascript", body: await readFile(file) });
    blocked.push(url.href); return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("https://intrinsic-flow.test/");
  const records = await page.evaluate(async ({ actual }) => {
    const { importFigmaJson, createFigmaTransfer } = await import("/figma-bridge.mjs");
    const { normalizeDesignDocument, serializeDesignDocument, exportDesignSvg } = await import("/document.mjs");
    const { createBrowserTextMeasurer, measureFigmaTextDocument } = await import("/text-metrics.mjs");
    const { applyAutoLayouts, applyAllAutoLayouts } = await import("/layout.mjs");
    const { exportDesignFrontend } = await import("/frontend-export.mjs");
    const loaded = await document.fonts.load("400 19px Inter", "Contact details");
    if (!loaded.length || loaded.some((font) => font.status !== "loaded")) throw Error("Inter fixture face unavailable");
    const imported = importFigmaJson(actual), value = imported.document, sources = new Map();
    const visit = (node) => { sources.set(node.id, node); node.children?.forEach(visit); };
    actual.document.children.forEach(visit);
    await measureFigmaTextDocument(value, { nativeLineBoxes: true, sourceNodes: sources, sourceIds: new Map(imported.mapping.map((entry) => [entry.designId, entry.sourceId])) });
    const parent = value.nodes.find((node) => node.name.endsWith("DL owner")), phone = value.nodes.find((node) => node.name.endsWith("phone Text"));
    const measurement = createBrowserTextMeasurer(), records = [];
    const natural = "This original editable paragraph has enough words to wrap naturally as its containing table becomes narrower, while the second real paragraph remains a separate child.";
    try {
      for (const [width, copy] of [[1220, "07700 900457"], [1220, "07700 900457\nLine two\nLine three\nLine four"], [1220, "07700 900457"], [708, "07700 900457"], [1220, "07700 900457"], [1220, natural], [708, natural], [1220, natural]]) {
        parent.width = width; phone.textSource = copy;
        for (const node of value.nodes.filter((node) => node.type === "frame" && node.layout !== "none")) node.height = 170;
        applyAutoLayouts(value.nodes, [parent.id, phone.id], { textMeasurer: measurement });
        const saved = serializeDesignDocument(value), reopened = normalizeDesignDocument(JSON.parse(saved));
        applyAllAutoLayouts(reopened.nodes, { textMeasurer: measurement });
        const boxes = value.nodes.filter((node) => node.name.endsWith("DL owner") || /row\d$|real-P\d$|margin-wrapper$/u.test(node.name)).map((node) => ({ name: node.name, y: node.y, height: node.height }));
        let frontendError;
        try { exportDesignFrontend(JSON.parse(saved)); } catch (error) { frontendError = error.message; }
        // A separate stroke-free control exercises ordinary exported paragraph
        // flow. The actual centered-rule fixture remains unmodified/refused.
        const withoutRules = normalizeDesignDocument(JSON.parse(saved));
        for (const node of withoutRules.nodes.filter((node) => node.layout === "grid")) {
          delete node.strokeSides; node.stroke = "transparent"; node.strokeWidth = 0;
        }
        records.push({ width, copy, boxes, parentId: parent.id, phoneId: phone.id, svg: exportDesignSvg(value), saved, reopened: serializeDesignDocument(reopened), source: phone.textSource, transferWarnings: createFigmaTransfer(value).warnings, frontendError, frontendWithoutRules: exportDesignFrontend(withoutRules) });
      }
    } finally { measurement.close(); }
    return records;
  }, { actual });
  const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const reference = (width, copy) => `<!doctype html><style>${fontCss}*{box-sizing:border-box}html,body{margin:0;width:1360px;height:600px;background:white}.owner{position:absolute;left:40px;top:40px;width:${width}px;display:flex;flex-direction:column;padding-bottom:.5px}.row{position:relative;display:grid;grid-template-columns:minmax(0,.3fr) 32px minmax(0,.7fr) 8px;flex:none}.row:after{content:'';position:absolute;left:0;right:0;bottom:-.5px;height:1px;background:#cecece;pointer-events:none}.cell{display:flex;flex-direction:column;min-width:0;min-height:0;padding:10.5px 0;align-self:stretch}.key{grid-column:1/span 2;padding-right:20px}.value{grid-column:3/span 2}.row:first-child .cell{padding-top:10px}.text{width:100%;font:400 19px/25px Inter;white-space:pre-wrap;color:#334155;flex:none}.contact{padding-top:9.5px}.wrapper{display:flex;flex-direction:column;padding:1px 0 10px;flex:none}.para{display:flex;flex-direction:column;flex:none}</style><div class="owner"><div class="row"><div class="cell key"><div class="text">Name</div></div><div class="cell value"><div class="text">Sarah Phillips</div></div></div><div class="row"><div class="cell key"><div class="text">Date of birth</div></div><div class="cell value"><div class="text">5 January 1978</div></div></div><div class="row"><div class="cell key"><div class="text">Address</div></div><div class="cell value"><div class="text">72 Guild Street\nLondon\nSE23 6FH</div></div></div><div class="row"><div class="cell key"><div class="text">Contact details</div></div><div class="cell value contact"><div class="wrapper"><div class="para"><div class="text">${escape(copy)}</div></div></div><div class="para"><div class="text">sarah.phillips@example.com</div></div></div></div></div>`;
  for (const record of records) {
    assert.equal(stable(JSON.parse(record.saved)), stable(JSON.parse(record.reopened)), `${record.width}/reopen`);
    assert.equal(record.source, record.copy);
    assert.deepEqual(record.transferWarnings, []);
    assert.match(record.frontendError, /非内侧的独立侧边/u, "existing centered-side CSS paint refusal stays explicit");
    await page.setContent(reference(record.width, record.copy));
    await page.evaluate(() => document.fonts.ready);
    const boxes = await page.evaluate(() => [...document.querySelectorAll(".owner,.row,.wrapper,.para")].map((node) => {
      const box = node.getBoundingClientRect(); return { y: box.y, height: box.height };
    }));
    assert.deepEqual(record.boxes.map(({ y, height }) => ({ y, height })), boxes, `${record.width}/${JSON.stringify(record.copy)} independent vertical flow`);
    // Full SVG/browser pixels are checked at the proven integer columns. Native
    // narrow track quantization and CSS subpixel columns are separate receipts.
    if (record.width === 1220) {
      const expected = PNG.sync.read(await page.screenshot());
      await page.setContent(`<!doctype html><style>${fontCss}html,body{margin:0;background:white}svg{display:block}</style>${record.svg}`);
      await page.evaluate(() => document.fonts.ready);
      const rendered = PNG.sync.read(await page.screenshot());
      assert(rendered.data.equals(expected.data), `${record.width}/${JSON.stringify(record.copy)} strict SVG pixels`);
    }
    await page.setContent(reference(record.width, record.copy).replace("background:#cecece;pointer-events:none", "display:none;pointer-events:none"));
    await page.evaluate(() => document.fonts.ready);
    const noRuleReference = PNG.sync.read(await page.screenshot());
    await page.setContent(record.frontendWithoutRules.replace("<head>", `<head><style>${fontCss}</style>`));
    await page.evaluate(() => document.fonts.ready);
    assert(PNG.sync.read(await page.screenshot()).data.equals(noRuleReference.data), `${record.width}/${JSON.stringify(record.copy)} independent stroke-free frontend pixels`);
  }
  const final = records.at(-1), referencePage = await context.newPage();
  try {
    await page.setContent(final.frontendWithoutRules.replace("<head>", `<head><style>${fontCss}</style>`));
    for (const [width, copy] of [[708, "07700 900457\nLine two\nLine three\nLine four"], [708, "07700 900457"], [708, final.copy], [1220, final.copy]]) {
      await page.locator(`[data-codeshell-source-id="${final.parentId}"]`).evaluate((node, width) => { node.style.width = `${width}px`; }, width);
      await page.locator(`[data-codeshell-source-id="${final.phoneId}"]`).evaluate((node, copy) => { node.textContent = copy; }, copy);
      await page.evaluate(() => document.fonts.ready);
      await referencePage.setContent(reference(width, copy).replace("background:#cecece;pointer-events:none", "display:none;pointer-events:none"));
      await referencePage.evaluate(() => document.fonts.ready);
      assert(PNG.sync.read(await page.screenshot()).data.equals(PNG.sync.read(await referencePage.screenshot()).data), `${width}/${JSON.stringify(copy)} exported DOM copy/outer-owner resize without height repairs`);
    }
  } finally { await referencePage.close(); }
  assert.deepEqual(blocked, []); assert.deepEqual(errors, []);
});
