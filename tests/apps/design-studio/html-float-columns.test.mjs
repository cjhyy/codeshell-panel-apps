import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";
import {
  rationalFloatWidth,
  planHtmlFloatColumns,
  isHtmlEmptyClear,
} from "../../../apps/design-studio/app/html-float-columns.mjs";
import { designNodeToV3 } from "../../../apps/design-studio/app/design-node-adapter.mjs";
import {
  normalizeDesignDocument,
  exportDesignSvg,
} from "../../../apps/design-studio/app/document.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";
import {
  runProductionFidelity,
  comparePixels,
} from "../../../scripts/design-studio-production-fidelity.mjs";
const css = {
  width: "auto",
  height: "auto",
  display: "block",
  position: "static",
  top: "auto",
  right: "auto",
  bottom: "auto",
  left: "auto",
  float: "none",
  clear: "none",
  "shape-outside": "none",
  direction: "ltr",
  "writing-mode": "horizontal-tb",
  "column-count": "auto",
  "aspect-ratio": "auto",
  "z-index": "auto",
  "box-sizing": "border-box",
  "min-width": "auto",
  "max-width": "none",
  "min-height": "auto",
  "max-height": "none",
  "margin-top": "0px",
  "margin-right": "0px",
  "margin-bottom": "0px",
  "margin-left": "0px",
};
const emptyClear = () => ({
  nodeType: "container",
  tag: "::after",
  name: "::after",
  opacity: 1,
  bounds: { x: 0, y: 0, width: 600, height: 0 },
  layout: { display: "block" },
  children: [],
  rawStyles: {
    float: "none",
    clear: "both",
    content: '""',
    "outline-style": "none",
    "box-shadow": "none",
    filter: "none",
    "backdrop-filter": "none",
    "background-image": "none",
  },
  effects: { boxShadows: [], filters: undefined, backdropFilters: undefined, blendMode: "normal" },
});
function rawFixture(rootRelative = false) {
  const leaf = {
    nodeType: "container",
    id: "leaf",
    name: "leaf",
    bounds: { x: rootRelative ? 100 : 0, y: rootRelative ? 200 : 0, width: 400, height: 100 },
    layout: { display: "block" },
    cssLayout: { ...css, height: "100px" },
    children: [],
    semantic: { attributes: { id: "leaf" } },
  };
  const col = {
    nodeType: "container",
    id: "col",
    name: "col",
    bounds: { ...leaf.bounds },
    layout: { display: "block", float: "left" },
    cssLayout: { ...css, float: "left", width: "66.6667%" },
    children: [leaf],
    semantic: { attributes: { id: "col" } },
  };
  const clear = emptyClear();
  if (rootRelative) {
    clear.bounds.x = 100;
    clear.bounds.y = 200;
  }
  return {
    nodeType: "container",
    id: "root",
    name: "root",
    bounds: { x: 100, y: 200, width: 600, height: 100 },
    layout: { display: "block" },
    cssLayout: { ...css },
    children: [col, clear],
    semantic: { attributes: { id: "root" } },
  };
}
const byHtmlId = (doc, id) =>
  doc.nodes.find((n) => JSON.parse(n.notes ?? "{}").attributes?.id === id);

test("float fractions are bounded exact rational tracks rather than measured pixel proportions", () => {
  for (const [value, numerator, denominator] of [
    ["66.6667%", 2, 3],
    ["33.3333%", 1, 3],
    ["25%", 1, 4],
    ["4.16667%", 1, 24],
    ["100%", 1, 1],
  ])
    assert.deepEqual(rationalFloatWidth(value), { numerator, denominator });
  for (const value of [
    "0%",
    "-20%",
    "100.1%",
    "1.2345%",
    "calc(100% / 3)",
    "50px",
    "Infinity%",
    "1%",
    "1".repeat(10000) + "%",
  ])
    assert.throws(() => rationalFloatWidth(value));
});

test("proven float columns retain source identity and native Grid/ordinary inner flow for both coordinate contracts", async () => {
  const outputs = [];
  for (const rootRelative of [false, true]) {
    const source = rawFixture(rootRelative),
      before = structuredClone(source);
    const result = await designNodeToV3(source, {
      coordinateSpace: rootRelative ? "root-relative" : "parent-relative",
      includeViewport: false,
    });
    assert.deepEqual(source, before);
    const doc = normalizeDesignDocument(result.document),
      row = byHtmlId(doc, "root"),
      col = byHtmlId(doc, "col");
    assert.equal(row.layout, "grid");
    assert.equal(row.gridColumns, 3);
    assert.equal(row.children, undefined);
    assert.equal(col.layout, "vertical");
    assert.equal(col.layoutSizingHorizontal, "fill");
    assert.equal(col.gridColumnSpan, 2);
    assert.equal(col.gridColumnAnchorIndex, 0);
    assert.equal(doc.nodes.length, 3, "only the blank generated zero-height clear is removed");
    assert(result.report.warnings.some((w) => w.code === "float-flow-captured-state"));
    assert.equal(result.mapping.find((m) => m.sourceId === "col").path, "0.0");
    const transfer = createFigmaTransfer(doc),
      nativeRow = transfer.pages[0].children[0];
    assert.equal(nativeRow.layout, "grid");
    assert.equal(nativeRow.children.length, 1);
    assert.equal(nativeRow.children[0].layout, "vertical");
    assert.equal(nativeRow.children[0].children.length, 1);
    outputs.push(doc.nodes.map((n) => [n.id, n.x, n.y, n.width, n.height]));
  }
  assert.deepEqual(outputs[0], outputs[1]);
});

test("untrusted clear lookalikes, mixed text, constraints and irregular float packing retain diagnosed geometry", async () => {
  assert(isHtmlEmptyClear(emptyClear()));
  for (const changes of [
    { semantic: { attributes: { id: "real" } } },
    { bounds: { x: 0, y: 0, width: 600, height: 1 } },
    { background: { layers: [{ type: "color", color: { r: 1, g: 0, b: 0, a: 1 } }] } },
    { effects: { boxShadows: [{ blur: 5 }] } },
    { rawStyles: { ...emptyClear().rawStyles, "outline-style": "solid" } },
    { opacity: Infinity },
  ])
    assert.equal(isHtmlEmptyClear({ ...emptyClear(), ...changes }), false);
  const mutations = [
    (t) => delete t.children[0].cssLayout,
    (t) => (t.children[0].cssLayout["shape-outside"] = "circle(50%)"),
    (t) => (t.children[0].cssLayout.clear = "both"),
    (t) => (t.children[0].cssLayout["min-width"] = "100px"),
    (t) => (t.children[0].cssLayout["max-width"] = "90%"),
    (t) => (t.children[0].cssLayout["margin-left"] = "10px"),
    (t) => (t.children[0].cssLayout.position = "absolute"),
    (t) => (t.children[0].positioning = { mode: "absolute" }),
    (t) => (t.children[0].bounds.y = 1),
    (t) => (t.children[0].bounds.width = 410),
    (t) => {
      t.children[0].cssLayout["box-sizing"] = "content-box";
      t.children[0].layout.padding = { left: 10 };
    },
    (t) =>
      t.children.push({
        ...structuredClone(t.children[0]),
        id: "second",
        cssLayout: { ...t.children[0].cssLayout, float: "right" },
      }),
    (t) =>
      t.children.push({
        nodeType: "text",
        name: "inline",
        content: "Text wrapping around a float",
        bounds: { x: 400, y: 0, width: 200, height: 20 },
      }),
  ];
  for (const mutate of mutations) {
    const source = rawFixture();
    mutate(source);
    const plan = planHtmlFloatColumns(source);
    assert(plan.unsupported);
    if (source.children.some((n) => n.nodeType === "text")) continue;
    const result = await designNodeToV3(source, { includeViewport: false }),
      doc = normalizeDesignDocument(result.document);
    assert.equal(doc.nodes[0].layout, "none");
    assert(result.report.warnings.some((w) => w.code === "float-flow-fixed"));
    assert(doc.nodes.every((n) => n.gridColumnAnchorIndex === undefined));
  }
});

const source = (columns, extra = "", row = "") =>
  `<!doctype html><style>*{box-sizing:border-box}body{margin:0}#fixture{width:100%;height:240px;padding:20px;background:#eee}.row{${row}}.row::after{content:"";display:block;clear:both}.col{float:left;width:66.6666666667%;padding:0 15px}.content{height:100px;background:#2563eb}.col:nth-child(2) .content{background:#f97316}${extra}</style><main id="fixture"><div id="row" class="row">${columns}</div></main>`;
const col = '<section class="col"><div class="content"></div></section>';

test("real capture/save/resize and HTML export preserve rational float Grid, negative bleed and ordinary column flow", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-float-flow-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const cases = [
    { id: "two-thirds-bleed", source: source(col, "", "margin-left:-15px;margin-right:-15px") },
    { id: "quarter-right", source: source(col, ".col{float:right;width:25%}") },
    {
      id: "split-row",
      source: source(
        col + col,
        ".col:first-child{width:33.3333333333%}.col:nth-child(2){width:66.6666666667%}",
      ),
    },
    {
      id: "split-right-row",
      source: source(
        col + col,
        ".col{float:right}.col:first-child{width:33.3333333333%}.col:nth-child(2){width:66.6666666667%}",
      ),
    },
    { id: "flow-root", source: source(col, ".row{display:flow-root}.row::after{content:none}") },
  ];
  const report = await runProductionFidelity({ output, cases });
  assert.equal(
    report.passed,
    true,
    JSON.stringify(
      report.cases.map((c) => ({
        id: c.id,
        warnings: c.warnings,
        pixels: c.comparisons.map((x) => x.changedPixels),
      })),
    ),
  );
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 640, height: 240 } });
  await page.route("**/*", (r) => r.abort());
  for (const observed of report.cases) {
    assert.deepEqual(
      observed.comparisons.map((c) => c.changedPixels),
      [0, 0, 0],
    );
    assert.deepEqual(observed.semanticIssues, []);
    const doc = normalizeDesignDocument(
        JSON.parse(await readFile(join(output, observed.id, "imported.codesign.json"))),
      ),
      row = byHtmlId(doc, "row");
    assert.equal(row.layout, "grid");
    assert.equal(row.gridRows, 1);
    assert(!doc.nodes.some((n) => n.layoutPositioning === "absolute"));
    const children = doc.nodes.filter((n) => n.parentId === row.id);
    assert(children.every((n) => n.layout === "vertical" && n.layoutSizingHorizontal === "fill"));
    assert(children.every((n) => n.gridRowAnchorIndex === 0));
    assert(!doc.nodes.some((n) => n.name.includes("::after")));
    assert(observed.warnings.every((w) => w.code === "float-flow-captured-state"));
    const transfer = createFigmaTransfer(doc);
    const visit = (n) => (n.id === row.id ? n : (n.children ?? []).map(visit).find(Boolean));
    const nativeRow = transfer.pages.map((p) => p.children.map(visit).find(Boolean)).find(Boolean);
    assert.equal(nativeRow.layout, "grid");
    assert.equal(nativeRow.children.length, children.length);
    assert(nativeRow.children.every((n) => n.layoutPositioning !== "absolute"));
    for (const mode of ["imported", "narrow"]) {
      const file = mode === "imported" ? "imported.codesign.json" : "narrow.codesign.json";
      const design = JSON.parse(await readFile(join(output, observed.id, file)));
      await page.setViewportSize({ width: mode === "narrow" ? 400 : 640, height: 240 });
      await page.setContent(exportDesignFrontend(design));
      assert.equal(
        comparePixels(
          await readFile(join(output, observed.id, `${mode}-source.png`)),
          await page.screenshot(),
        ).metrics.changedPixels,
        0,
        `${observed.id} ${mode} HTML`,
      );
    }
  }
  const edited = normalizeDesignDocument(
    JSON.parse(await readFile(join(output, "two-thirds-bleed/imported.codesign.json"))),
  );
  const content = edited.nodes.find((n) =>
    JSON.parse(n.notes ?? "{}").classList?.includes("content"),
  );
  content.height = 140;
  applyAllAutoLayouts(edited.nodes);
  const row = byHtmlId(edited, "row");
  assert.equal(row.height, 140);
  assert.equal(edited.nodes.find((n) => n.parentId === row.id).height, 140);
  await page.setViewportSize({ width: 640, height: 240 });
  await page.setContent(cases[0].source.replace(".content{height:100px", ".content{height:140px"));
  const reference = await page.screenshot();
  await page.setContent("<style>body{margin:0}</style>" + exportDesignSvg(edited));
  assert.equal(
    comparePixels(reference, await page.screenshot()).metrics.changedPixels,
    0,
    "edited column height propagates through the HUG Grid row",
  );
});

test("a desktop float breakpoint remains an explicit captured-state limitation, while separate mobile capture restores block flow", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-float-breakpoint-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const html = source(col, "@media(max-width:500px){.col{float:none;width:auto}}");
  const report = await runProductionFidelity({
    output,
    cases: [{ id: "breakpoint", source: html }],
    recordOnly: true,
  });
  assert.deepEqual(
    report.cases[0].comparisons.slice(0, 2).map((c) => c.changedPixels),
    [0, 0],
  );
  assert(report.cases[0].comparisons[2].changedPixels > 0);
  assert.equal(report.passed, false);
  assert(report.cases[0].warnings.some((w) => w.code === "float-flow-captured-state"));
  const mobile = await runProductionFidelity({
    output: join(output, "mobile"),
    width: 400,
    narrowWidth: 280,
    cases: [{ id: "mobile", source: html }],
  });
  assert.equal(mobile.passed, true);
  const doc = normalizeDesignDocument(
    JSON.parse(await readFile(join(output, "mobile/mobile/imported.codesign.json"))),
  );
  assert.equal(byHtmlId(doc, "row").layout, "vertical");
  assert(!doc.nodes.some((n) => n.name.includes("::after")));
});

test("late native-plan rejection restores child sizing and leaves its own nested Grid intact", async () => {
  const source = rawFixture();
  source.cssLayout.width = "max-content";
  const col = source.children[0];
  col.layout = {
    ...col.layout,
    display: "grid",
    grid: { templateColumns: "400px", templateRows: "100px", gap: { row: 0, column: 0 } },
  };
  Object.assign(col.cssLayout, {
    display: "grid",
    "grid-template-columns": "400px",
    "grid-template-rows": "100px",
    "justify-content": "start",
    "align-content": "start",
    "grid-auto-flow": "row",
    "justify-items": "stretch",
    "align-items": "start",
  });
  const result = await designNodeToV3(source, { includeViewport: false }),
    doc = normalizeDesignDocument(result.document),
    row = byHtmlId(doc, "root"),
    nested = byHtmlId(doc, "col");
  assert.equal(row.layout, "none");
  assert.equal(row.gridColumns, undefined);
  assert(result.report.warnings.some((w) => w.code === "float-flow-fixed"));
  assert(!result.report.warnings.some((w) => w.code === "float-flow-captured-state"));
  assert.equal(nested.layout, "grid");
  assert.equal(nested.gridColumns, 1);
  assert.deepEqual(nested.gridColumnSizes, [{ type: "fixed", value: 400 }]);
  assert.equal(nested.gridColumnAnchorIndex, undefined);
  assert.equal(nested.gridColumnSpan, undefined);
  assert.notEqual(nested.layoutSizingHorizontal, "fill");
  assert.equal(byHtmlId(doc, "leaf").gridColumnSpan, 1);
});
