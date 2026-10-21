import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";
import { build } from "esbuild";
import { designNodeToV3 } from "../../../apps/design-studio/app/design-node-adapter.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { runProductionFidelity } from "../../../scripts/design-studio-production-fidelity.mjs";

// The production runner shares this object; keep its internal launch CPU-only.
const launch = chromium.launch.bind(chromium);
chromium.launch = (options = {}) => launch({ ...options, args: [...(options.args ?? []), "--disable-gpu"] });
const runtime = await readFile(new URL("../../../apps/design-studio/app/vendor/html2figma-browser.mjs", import.meta.url), "utf8");
const root = fileURLToPath(new URL("../../../", import.meta.url));
const original = (await build({
  stdin: { contents: 'import {traverseDOM} from "./third-party/html2figma/upstream/packages/browser/traverser/core"; import {renderToDesignDSL} from "./third-party/html2figma/upstream/packages/browser/converter/convert"; export const convertOriginal = root => renderToDesignDSL(traverseDOM(root), {includeRawStyles:true,maxDepth:100});', resolveDir: root },
  bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
  alias: {
    "@html2figma/shared/utils": join(root, "third-party/html2figma/upstream/packages/shared/utils.ts"),
    "@html2figma/shared/css-utils": join(root, "third-party/html2figma/upstream/packages/shared/css-utils.ts"),
    "@html2figma/shared": join(root, "third-party/html2figma/integration/shared.ts"),
  },
})).outputFiles[0].text;
const fixture = (extra = "", markup = "") => `<!doctype html><style>html,body{margin:0;background:white}#fixture{width:100%;height:240px}table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{height:40px;width:50%;padding:0;border:0;border-bottom:2px solid #dc2626;background:#f1f5f9}${extra}</style><main id="fixture"><table><thead><tr><th id="a"></th><th id="b"></th></tr></thead><tbody><tr><td id="c">${markup}</td><td id="d"></td></tr><tr><td id="e"></td><td id="f"></td></tr></tbody></table></main>`;
const flatten = (node) => [node, ...(node.children ?? []).flatMap(flatten)];
const cells = (tree) => flatten(tree).filter((node) => ["td", "th"].includes(node.tag));

async function capture(page) {
  return page.evaluate(async ({ runtime, original }) => {
    const moduleUrl = URL.createObjectURL(new Blob([runtime], { type: "text/javascript" }));
    const originalUrl = URL.createObjectURL(new Blob([original], { type: "text/javascript" }));
    try {
      const { convertToDesignDSL } = await import(moduleUrl);
      const { convertOriginal } = await import(originalUrl);
      const before = document.documentElement.outerHTML;
      const tree = convertToDesignDSL(document.querySelector("#fixture"));
      return { tree, original: convertOriginal(document.querySelector("#fixture")), unchanged: before === document.documentElement.outerHTML,
        boxes: [...document.querySelectorAll("td,th")].map((element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return { id: element.id, x, y, width, height };
        }) };
    } finally { URL.revokeObjectURL(moduleUrl); URL.revokeObjectURL(originalUrl); }
  }, { runtime, original });
}

test("unopposed collapsed bottom rules survive real table capture, fresh resize and portable native inputs", async (t) => {
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 640, height: 240 } });
  await page.route("**/*", (route) => route.abort());
  await page.setContent(fixture());
  for (const width of [640, 400, 640]) {
    await page.setViewportSize({ width, height: 240 });
    const observed = await capture(page);
    assert.equal(observed.unchanged, true);
    const original = structuredClone(observed.tree);
    assert.deepEqual(cells(observed.tree).map((node) => node.semantic.attributes.id), ["a", "b", "c", "d", "e", "f"]);
    assert(cells(observed.tree).every((node) => node.cssTableBottomBorder.width === 2));
    assert(cells(observed.tree).every((node) => node.border.top.width === 0));
    assert.deepEqual(cells(observed.original).map((node) => node.border.bottom.width), [0, 0, 0, 0, 2, 2], "the unmodified pinned converter demonstrates the input loss");
    assert.deepEqual(cells(observed.tree).map((node) => node.border), cells(observed.original).map((node) => node.border), "the pinned layout border inputs remain unchanged");
    const geometry = (tree) => cells(tree).map((node) => [node.semantic.attributes.id, node.bounds]);
    assert.deepEqual(geometry(observed.tree), geometry(observed.original), "paint recovery cannot rewrite measured cell boxes or source order");
    const converted = await designNodeToV3(observed.tree);
    assert.deepEqual(observed.tree, original, "the adapter cannot mutate retained border inputs");
    const value = normalizeDesignDocument(JSON.parse(serializeDesignDocument(normalizeDesignDocument(converted.document))));
    const beforePaint = structuredClone(observed.tree);
    flatten(beforePaint).forEach((node) => { delete node.cssTableBottomBorder; });
    const baseline = normalizeDesignDocument((await designNodeToV3(beforePaint)).document);
    const layoutInputs = (document) => document.nodes.map((node) => [node.id, node.x, node.y, node.width, node.height,
      node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft, node.minHeight, node.minWidth,
      node.layout, node.layoutSizingHorizontal, node.layoutSizingVertical]);
    assert.deepEqual(layoutInputs(value), layoutInputs(baseline), "paint recovery cannot invent padding, minHeight or sizing changes");
    for (const node of value.nodes.filter((node) => /^(td|th)#/u.test(node.name))) {
      assert.deepEqual(node.strokeSides.map((side) => side.width), [0, 0, 2, 0]);
      assert.equal(node.strokeAlign, "center");
    }
    assert(converted.report.warnings.some((warning) => warning.code === "collapsed-border"));
    const transferred = createFigmaTransfer(value);
    const native = transferred.pages.flatMap((page) => page.children.flatMap(flatten)).filter((node) => /^(td|th)#/u.test(node.name));
    assert.equal(native.length, 6);
    assert(native.every((node) => node.strokeSides[2].width === 2));
    assert.equal(observed.boxes[0].width, width / 2);
  }
});

test("competing, hidden, transformed and complex table rules retain the existing fallback atomically", async (t) => {
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 640, height: 240 } });
  await page.route("**/*", (route) => route.abort());
  const variants = [
    ["opposing top", "#c{border-top:1px solid blue}"],
    ["side rule", "#d{border-left:1px solid blue}"],
    ["hidden side", "#c{border-top:1px hidden blue}"],
    ["table rule", "table{border-bottom:1px solid blue}"],
    ["section rule", "tbody{border-bottom:1px solid blue}"],
    ["row rule", "tr{border-bottom:1px solid blue}"],
    ["row display", "tr{display:block}"],
    ["group display", "tbody{display:block}"],
    ["alpha", "#c{border-bottom-color:rgba(255,0,0,.5)}"],
    ["dashed", "#c{border-bottom-style:dashed}"],
    ["transparent", "#c{border-bottom-color:transparent}"],
    ["own transform", "table{transform:scale(1.1)}"],
    ["ancestor transform", "#fixture{transform:scale(1.1)}"],
    ["individual transform", "table{scale:1.1}"],
    ["own zoom", "table{zoom:2}"],
    ["ancestor zoom", "#fixture{zoom:2}"],
    ["cell zoom", "#c{zoom:2}"],
    ["hidden cell", "#f{visibility:hidden}"],
    ["hidden row", "tbody tr:last-child{display:none}"],
    ["generated cell", '#c::before{content:"rule"}'],
    ["radius", "td{border-radius:4px}"],
    ["border image", "#c{border-image:linear-gradient(red,blue) 1}"],
    ["span", "", "", (source) => source.replace('id="c"', 'id="c" colspan="2"')],
    ["row span", "", "", (source) => source.replace('id="c"', 'id="c" rowspan="2"')],
    ["nested", "", '<table><tr><td>Nested</td></tr></table>'],
    ["caption", "", "", (source) => source.replace("<table>", "<table><caption>Caption</caption>")],
  ];
  for (const [name, css, markup, rewrite] of variants) {
    const source = fixture(css, markup);
    await page.setContent(rewrite ? rewrite(source) : source);
    const observed = await capture(page);
    assert.equal(observed.unchanged, true, name);
    const first = cells(observed.tree).find((node) => node.semantic?.attributes?.id === "a");
    assert(first, name);
    const borderInputs = (tree) => cells(tree).map((node) => [node.semantic?.attributes?.id, node.border]);
    assert.deepEqual(borderInputs(observed.tree), borderInputs(observed.original), `${name}: unsupported peers keep the exact pinned fallback without partial restoration`);
    assert(cells(observed.tree).every((node) => node.cssTableBottomBorder === undefined), name);
  }
  await page.setContent(fixture("table{border-collapse:separate;border-spacing:4px}"));
  assert(cells((await capture(page)).tree).every((node) => node.border.bottom.width === 2), "separate tables keep their original independent rules");
  await page.setContent(fixture("table{border-spacing:4px}"));
  assert(cells((await capture(page)).tree).every((node) => node.cssTableBottomBorder.width === 2), "collapse ignores the computed border-spacing instead of requiring zero CSS spacing");
});

test("malformed or unbound table paint hints are diagnosed without changing existing paint or layout", async (t) => {
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage(); await page.setContent(fixture());
  const source = (await capture(page)).tree;
  for (const mutate of [
    (node) => { node.cssTableBottomBorder.width = Infinity; },
    (node) => { node.cssTableBottomBorder.width = -1; },
    (node) => { node.cssTableBottomBorder.width = 101; },
    (node) => { node.cssTableBottomBorder.style = "hidden"; },
    (node) => { node.cssTableBottomBorder.color.a = 0.5; },
    (node) => { node.cssTableBottomBorder.color.r = 300; },
    (node) => { node.cssTableBottomBorder.path = "M0 0"; },
    (node) => { node.cssTableBottomBorder = null; },
    (node) => { delete node.semantic.semanticId; },
    (node) => { node.tag = "div"; },
    (node) => { node.cssLayout.display = "block"; },
    (node) => { node.cssLayout["border-collapse"] = "separate"; },
    (node) => { node.border.left.width = 1; },
    (node) => { node.border.left.width = NaN; },
    (node) => { delete node.border.left; },
  ]) {
    const changed = structuredClone(source), node = cells(changed)[0]; mutate(node);
    const baseline = structuredClone(changed);
    // The tag-negative control ceases to be a cell; locate its original slot.
    const baselineNode = flatten(baseline).find((candidate) => candidate.semantic?.attributes?.id === "a");
    delete baselineNode.cssTableBottomBorder;
    const before = structuredClone(changed), actual = await designNodeToV3(changed), expected = await designNodeToV3(baseline);
    assert.deepEqual(changed, before);
    assert.deepEqual(actual.document, expected.document);
    assert(actual.report.warnings.some((warning) => warning.code === "unsupported-css-table-border"));
  }
});

test("production capture keeps every original collapsed bottom side and retains the layout diagnostic", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-table-border-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const report = await runProductionFidelity({ output, cases: [{ id: "bottom-only", source: fixture() }], resizeMode: "viewport-only", recordOnly: true });
  const observed = report.cases[0];
  assert(observed.warnings.some((warning) => warning.code === "collapsed-border"));
  for (const mode of ["imported", "relayout", "narrow"]) {
    const value = normalizeDesignDocument(JSON.parse(await readFile(join(output, "bottom-only", `${mode}.codesign.json`))));
    const actual = value.nodes.filter((node) => /^(td|th)#/u.test(node.name));
    assert.equal(actual.length, 6);
    assert(actual.every((node) => node.strokeSides[2].width === 2));
  }
  assert.deepEqual(report.blockedRequests, []);
  assert.deepEqual(report.browserErrors, []);
  t.diagnostic(JSON.stringify(observed.comparisons));
});
