import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { runProductionFidelity } from "../../../scripts/design-studio-production-fidelity.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { applyAllAutoLayouts, applyAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { preparePluginFile } from "../../../apps/design-studio/app/figma-plugin/v3-input.mjs";
import { createPortableDesign } from "../../../apps/design-studio/app/portable-backup.mjs";
import { consumeHtmlAutoMarginPlan } from "../../../apps/design-studio/app/html-auto-margin-distribution.mjs";

const source = (height = 300, extra = "", definite = false) => '<!doctype html><style>' +
  '*{box-sizing:border-box}html,body{margin:0;background:white}' +
  '#fixture{display:flex;flex-direction:column;align-items:stretch;justify-content:normal;width:100%;height:' + height + 'px;padding:20px;background:#e2e8f0}' +
  '#first{margin-bottom:auto}#last{margin-top:auto}' +
  '#first-leaf{height:40px;background:#2563eb}#middle-leaf{height:50px;background:#f97316}#last-leaf{height:60px;background:#16a34a}' +
  (definite ? '#first,#middle,#last{flex-shrink:0}#first{height:40px}#middle{height:50px}#last{height:60px}' : '') +
  extra + '</style><main id="fixture"><header id="first"><div id="first-leaf"></div></header><section id="middle"><div id="middle-leaf"></div></section><footer id="last"><div id="last-leaf"></div></footer></main>';
const byHtmlId = (document, id) => document.nodes.find(node => node.type === "frame" &&
  JSON.parse(node.notes ?? "{}").attributes?.id === id);
const reopen = document => normalizeDesignDocument(JSON.parse(serializeDesignDocument(document)));

test("one current vertical auto-margin line preserves exact pixels, intrinsic growth and portable native intent", async t => {
  const output = await mkdtemp(join(tmpdir(), "html-distributed-auto-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const fixtures = [
    ["hug-positive", 300, false], ["hug-zero", 190, false],
    ["hug-overflow", 140, false], ["fixed-nonshrinking", 300, true],
    ["two-slots", 300, false, "#middle{margin-top:auto;margin-bottom:auto}"],
  ];
  const result = await runProductionFidelity({
    output, cases: fixtures.map(([id, height, definite, extra = ""]) => ({ id, source: source(height, extra, definite) })),
    width: 640, height: 360, narrowWidth: 400, recordOnly: true,
  });
  assert.equal(result.passed, true, JSON.stringify(result.cases.map(item => item.semanticIssues)));
  for (const [id, height, definite] of fixtures) {
    const observed = result.cases.find(item => item.id === id);
    assert(observed.warnings.some(warning => warning.code === "auto-margin-distribution"), id);
    assert(!observed.warnings.some(warning => warning.code === "layout-margin-fixed"), id);
    assert(observed.comparisons.every(item => item.changedPixels === 0 && item.maximumChannelDelta === 0), id);
    assert(observed.flowAudits.every(item => item.failures === 0 && item.unresolved === 0), id);
    const document = normalizeDesignDocument(JSON.parse(await readFile(join(output, id, "imported.codesign.json"))));
    const parent = byHtmlId(document, "fixture"), first = byHtmlId(document, "first");
    const middle = byHtmlId(document, "middle"), last = byHtmlId(document, "last");
    const children = [first, middle, last];
    assert.equal(parent.layout, "vertical");
    assert.equal(parent.justifyContent, "space-between");
    assert.deepEqual([parent.gap, parent.rowGap, parent.layoutWrap], [0, 0, "none"]);
    assert.deepEqual(children.map(node => [node.layoutSizingHorizontal, node.layoutSizingVertical]),
      Array.from({ length: 3 }, () => ["fill", definite ? "fixed" : "hug"]));
    assert(children.every(node => node.parentId === parent.id && !node.layoutMarginBefore &&
      node.layoutPositioning !== "absolute"));
    assert.deepEqual(children.map(node => node.y), height === 300 ? [20, 115, 220] : [20, 60, 110]);
    const identities = document.nodes.map(node => [node.id, node.parentId, node.notes]);
    if (!definite) {
      const leaf = byHtmlId(document, "first-leaf");
      parent.height = 300;
      for (const current of [80, 40, 80, 40]) {
        leaf.height = current;
        applyAutoLayouts(document.nodes, [first.id]);
        assert.equal(first.height, current);
        assert.deepEqual(children.map(node => node.y), current === 80 ? [20, 135, 220] : [20, 115, 220]);
      }
    }
    for (const extent of [300, 190, 140, 300]) {
      parent.height = extent;
      applyAllAutoLayouts(document.nodes);
      assert.deepEqual(children.map(node => node.y), extent === 300 ? [20, 115, 220] : [20, 60, 110]);
      assert.deepEqual(document.nodes.map(node => [node.id, node.parentId, node.notes]), identities);
    }
    const saved = serializeDesignDocument(document), restored = reopen(document);
    applyAllAutoLayouts(restored.nodes);
    assert.equal(serializeDesignDocument(restored), saved);
    const portable = await createPortableDesign({
      document: restored, source: { workspaceRoot: "/fixture", sessionId: "auto-margin", path: "scene.codesign.json" },
      readText: async () => { throw new Error("No resources"); },
    });
    const prepared = await preparePluginFile(portable), transfer = prepared.transfer.pages[0].children
      .flatMap(node => [node, ...(node.children ?? [])]).find(node => node.id === parent.id);
    assert(transfer);
    assert.equal(transfer.justifyContent, "space-between");
    assert.equal(transfer.layout, "vertical");
    assert.deepEqual(transfer.children.map(node => node.id), children.map(node => node.id));
    assert(transfer.children.every(node => !node.layoutMarginBefore && node.layoutSizingHorizontal === "fill"));
  }
});

test("fallback alignment, unequal/end autos, shrink/percentage sizes and excluded participants keep their existing guard", async t => {
  const output = await mkdtemp(join(tmpdir(), "html-distributed-auto-negative-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const controls = [
    ["center-overflow", "#fixture{justify-content:center}"],
    ["end-overflow", "#fixture{justify-content:flex-end}"],
    ["unequal-slots", "#middle{margin-top:auto}"],
    ["leading-auto", "#first{margin-top:auto}"],
    ["trailing-auto", "#last{margin-bottom:auto}"],
    ["fixed-gap", "#fixture{row-gap:2px}"],
    ["fixed-main-margin", "#middle{margin-top:4px}"],
    ["definite-shrink", "#first{height:200px;min-height:0;flex-shrink:1}"],
    ["percentage-nonshrinking", "#first{height:100%;flex-shrink:0}"],
    ["growing-child", "#middle{flex-grow:1}"],
    ["main-minimum", "#fixture{min-height:300px}"],
    ["child-minimum", "#first{min-height:80px}"],
    ["fixed-flex-basis", "#first{flex-basis:40px}"],
    ["hidden-element", "#middle{display:none}"],
    ["invisible-element", "#middle{visibility:hidden}"],
    ["absolute-element", "#middle{position:absolute}"],
    ["reordered-element", "#last{order:-1}"],
    ["generated-element", "#fixture::before{content:'generated'}"],
    ["cross-auto-margin", "#middle{margin-left:auto}"],
    ["wrapping", "#fixture{flex-wrap:wrap}"],
    ["reverse", "#fixture{flex-direction:column-reverse}"],
    ["transformed-owner", "#fixture{transform:translateY(1px)}"],
  ];
  const result = await runProductionFidelity({
    output, cases: controls.map(([id, css]) => ({ id, source: source(140, css) })),
    width: 640, height: 360, narrowWidth: 400, recordOnly: true,
  });
  for (const [id] of controls) {
    const observed = result.cases.find(item => item.id === id);
    assert(observed, id);
    assert(!observed.warnings.some(warning => warning.code === "auto-margin-distribution"), id);
    const document = normalizeDesignDocument(JSON.parse(await readFile(join(output, id, "imported.codesign.json"))));
    assert.notEqual(byHtmlId(document, "fixture").justifyContent, "space-between", id);
  }
  assert.equal(consumeHtmlAutoMarginPlan({ source: {}, items: [] }, {}, { children: [] }), null,
    "saved JSON cannot mint a live capture plan");
});


test("rounded CSSOM margin-wrapper metadata does not replace exact fractional DOM distribution", async t => {
  const output = await mkdtemp(join(tmpdir(), "html-distributed-auto-fraction-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const result = await runProductionFidelity({
    output, cases: [{ id: "fractional", source: source(300, "#middle-leaf{height:50.21875px}") }],
    width: 640, height: 360, narrowWidth: 400, recordOnly: true,
  });
  const observed = result.cases[0];
  assert(observed.warnings.some(warning => warning.code === "auto-margin-distribution"));
  // Fractional colored rectangle edges retain the renderer's known strict
  // pixel differences. Saved canonical geometry rounds to two decimals; the
  // live-capture test below separately proves full-precision DOM slot algebra.
  assert(observed.flowAudits.every(item => item.failures === 0 && item.unresolved === 0));
  for (const mode of ["imported", "relayout", "narrow"]) {
    const document = normalizeDesignDocument(JSON.parse(await readFile(join(output, "fractional", mode + ".codesign.json"))));
    const parent = byHtmlId(document, "fixture"), children = ["first", "middle", "last"].map(id => byHtmlId(document, id));
    assert.equal(parent.justifyContent, "space-between");
    assert.deepEqual(children.map(node => node.y), [20, 114.89, 220]);
    assert.deepEqual(children.map(node => node.height), [40, 50.22, 60]);
  }
});


test("one live CSSOM serialization validates fractional wrappers and rejects nearby padding/placement changes", async t => {
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 768, height: 360 }, deviceScaleFactor: 1 });
  const modules = new Map(await Promise.all([
    ["/vendor.mjs", "../../../apps/design-studio/app/vendor/html2figma-browser.mjs"],
    ["/proof.mjs", "../../../apps/design-studio/app/html-auto-margin-distribution.mjs"],
  ].map(async ([url, file]) => [url, await readFile(new URL(file, import.meta.url), "utf8")])));
  await context.route("**/*", route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ contentType: path === "/" ? "text/html" : "text/javascript",
      body: path === "/" ? source(300, "#middle-leaf{height:50.21875px}") : modules.get(path) });
  });
  const page = await context.newPage();
  await page.goto("https://auto-margin.test/");
  const results = await page.evaluate(async () => {
    const { convertToDesignDSL } = await import("/vendor.mjs");
    const { createHtmlAutoMarginCapture, consumeHtmlAutoMarginPlan } = await import("/proof.mjs");
    return ["original", "padding-plus", "padding-minus", "size-plus", "size-minus", "placement-plus", "placement-minus"].map(mode => {
      const elements = new Map(), root = document.querySelector("#fixture");
      const tree = convertToDesignDSL(root, { onElement: (id, element) => elements.set(id, element) });
      const wrapper = tree.children.find(node => node.name === "margin-wrapper");
      if (!wrapper) throw new Error("Missing upstream wrapper");
      const delta = mode.endsWith("minus") ? -0.0001 : 0.0001;
      if (mode.startsWith("padding")) wrapper.layout.padding.bottom += delta;
      if (mode.startsWith("size")) wrapper.bounds.height += delta;
      if (mode.startsWith("placement")) {
        const originalChildY = wrapper.bounds.y + wrapper.children[0].bounds.y;
        wrapper.bounds.y += delta;
        wrapper.children[0].bounds.y = originalChildY - wrapper.bounds.y;
      }
      const plan = createHtmlAutoMarginCapture({ tree, root, elements, ambiguousElements: new WeakSet() })(tree);
      const serialized = getComputedStyle(root.children[0]).marginBottom;
      const exactUsed = (root.getBoundingClientRect().height - 40 -
        [...root.children].reduce((sum, node) => sum + node.getBoundingClientRect().height, 0)) / 2;
      if (mode !== "original") return { mode, unsupported: plan?.unsupported };
      const current = { ...tree, children: tree.children.map(node => node.name !== "margin-wrapper" ? node :
        { ...node.children[0], bounds: { ...node.children[0].bounds,
          x: node.bounds.x + node.children[0].bounds.x, y: node.bounds.y + node.children[0].bounds.y } }) };
      return { mode, accepted: Boolean(consumeHtmlAutoMarginPlan(plan, tree, current)),
        reused: Boolean(consumeHtmlAutoMarginPlan(plan, tree, current)), serialized, exactUsed,
        pinnedPadding: wrapper.layout.padding.bottom };
    });
  });
  assert.deepEqual(results[0], { mode: "original", accepted: true, reused: false,
    serialized: "54.8906px", exactUsed: 54.890625, pinnedPadding: 54.8906 });
  assert(results.slice(1).every(item => item.unsupported === "margin-wrapper-proof"));
});
