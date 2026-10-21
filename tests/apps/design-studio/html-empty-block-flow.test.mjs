import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { runProductionFidelity, comparePixels } from "../../../scripts/design-studio-production-fidelity.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";
import { planHtmlBlockFlow } from "../../../apps/design-studio/app/html-block-flow.mjs";
import { designNodeToV3 } from "../../../apps/design-studio/app/design-node-adapter.mjs";

test("empty CSS blocks retain padding in real Fill layout, frontend, edit and reopen", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-empty-block-flow-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const html = '<main id="fixture"><div id="a"></div><div id="b"><!-- ordinary empty block --></div></main>';
  const css = '#fixture{display:flex;width:100%;height:240px;padding:8px;gap:12px;align-items:flex-start;background:#eeeeee}#a,#b{display:block;flex:1 1 0;min-width:0;height:100px;background:white}#a{padding:8px}#b{padding:20px}';
  const result = await runProductionFidelity({ output, resizeMode: "viewport-only", cases: [
    { id: "padding", html, css },
    { id: "inside-border", html, css: css + '#a{border:4px solid #dc2626}#b{border:8px solid #dc2626}' },
    { id: "maximum", html, css: css + '#a{max-width:200px}' },
    { id: "auto-height", html, css: css + '#a,#b{height:auto}' },
  ] });
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  t.after(() => browser.close());
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const expected = {
    padding: [[294, 318], [174, 198]],
    "inside-border": [[290, 322], [170, 202]],
    maximum: [[200, 412], [174, 198]],
    "auto-height": [[294, 318], [174, 198]],
  };
  for (const observed of result.cases) {
    assert(observed.comparisons.every((item) => item.changedPixels === 0), JSON.stringify(observed));
    for (const [mode, width, sizes] of [["imported", 640, expected[observed.id][0]], ["narrow", 400, expected[observed.id][1]]]) {
      const value = normalizeDesignDocument(JSON.parse(await readFile(join(output, observed.id, `${mode}.codesign.json`), "utf8")));
      const blocks = value.nodes.filter((node) => ["div#a", "div#b"].includes(node.name));
      assert.equal(blocks.length, 2);
      assert.deepEqual(blocks.map((node) => node.layout), ["vertical", "vertical"]);
      assert.deepEqual(blocks.map((node) => node.layoutSizingHorizontal), ["fill", "fill"]);
      assert.deepEqual(blocks.map((node) => node.width), sizes);
      assert.equal(value.nodes.length, 4, "recovery preserves real nodes without spacer children");
      assert(value.nodes.every((node) => node.layoutPositioning !== "absolute"));
      const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(value)));
      assert.equal(applyAllAutoLayouts(reopened.nodes), false, "reopen retains settled intrinsic insets");
      await page.setViewportSize({ width, height: 240 });
      await page.setContent(exportDesignFrontend(reopened));
      const reference = await readFile(join(output, observed.id, `${mode}-source.png`));
      assert.equal(comparePixels(reference, await page.screenshot()).metrics.changedPixels, 0, `${observed.id}/${mode}/frontend`);
      if (observed.id === "padding" && mode === "imported") {
        const first = reopened.nodes.find((node) => node.id === blocks[0].id);
        first.paddingLeft = 10; first.paddingRight = 10;
        applyAllAutoLayouts(reopened.nodes);
        assert.deepEqual(reopened.nodes.filter((node) => blocks.some((block) => block.id === node.id)).map((node) => node.width), [296, 316]);
        assert.equal(normalizeDesignDocument(JSON.parse(serializeDesignDocument(reopened))).nodes.find((node) => node.id === first.id).paddingLeft, 10);
      }
    }
  }
  assert.equal(result.passed, true);
  assert.deepEqual(result.blockedRequests, []);
  assert.deepEqual(result.browserErrors, []);
});

test("empty block recovery needs actual DOM evidence and preserves unsupported elements", () => {
  const source = {
    nodeType: "container", name: "empty", tag: "div", semantic: { semanticId: "empty" },
    bounds: { x: 0, y: 0, width: 100, height: 80 },
    layout: { display: "block", padding: { top: 8, right: 8, bottom: 8, left: 8 } },
    cssLayout: { position: "static", width: "auto", height: "80px" }, children: [],
    cssEmptyBlock: true,
  };
  assert(planHtmlBlockFlow(source));
  for (const change of [
    { cssEmptyBlock: undefined }, { cssEmptyBlock: false }, { cssEmptyBlock: "true" },
    { tag: "input" }, { tag: "canvas" }, { tag: "details" },
    { bounds: { ...source.bounds, height: 0 } },
    { cssLayout: { ...source.cssLayout, position: "absolute" } },
    { cssLayout: { ...source.cssLayout, position: "relative", top: "4px" } },
    { transform: { rotation: 1 } },
  ]) assert.equal(planHtmlBlockFlow({ ...source, ...change }), null, JSON.stringify(change));
  for (const changes of [
    { "aspect-ratio": "2 / 1" }, { "min-height": "50%" }, { "max-width": "calc(100% - 20px)" },
    { "padding-left": "5%" }, { contain: "size" }, { "content-visibility": "hidden" },
  ]) assert.match(planHtmlBlockFlow({ ...source, cssLayout: { ...source.cssLayout, ...changes } }).unsupported, /保留测量布局/u);
});

test("unsupported empty intrinsic sizing retains measured geometry through reflow", async () => {
  for (const [height, sizing] of [[200, { "aspect-ratio": "2 / 1" }], [120, { "min-height": "50%" }]]) {
    const source = { nodeType: "container", name: "ratio", tag: "div", semantic: { semanticId: "ratio" },
      bounds: { x: 0, y: 0, width: 400, height }, layout: { display: "block" },
      cssLayout: { width: "400px", height: "auto", ...sizing }, cssEmptyBlock: true, children: [] };
    const imported = await designNodeToV3(source, { includeViewport: false });
    const value = normalizeDesignDocument(imported.document);
    assert.equal(value.nodes[0].layout, "none");
    applyAllAutoLayouts(value.nodes);
    assert.equal(value.nodes[0].height, height);
    assert(imported.report.warnings.some((item) => item.code === "block-flow-fixed"));
  }
});

test("capture distinguishes truly empty DOM from discarded whitespace and generated content", async (t) => {
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const sourceRoot = fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.href === "https://empty.test/")
      return route.fulfill({ contentType: "text/html", body: "<!doctype html>" });
    if (url.origin === "https://empty.test" && url.pathname.startsWith("/app/") && url.pathname.endsWith(".mjs")) {
      const path = resolve(sourceRoot, url.pathname.slice(5));
      if (path.startsWith(sourceRoot)) return route.fulfill({ contentType: "text/javascript", body: await readFile(path) });
    }
    return route.abort();
  });
  await page.goto("https://empty.test/");
  await page.setContent('<style>div,p,pre{display:block;height:30px;margin:0}#generated::before{content:" "}#nonbreaking{white-space:normal}#ratio{width:400px;height:auto;aspect-ratio:2/1}#relative-min{height:auto;min-height:50%}#percent-pad{padding:5%}#contained{contain:size;contain-intrinsic-size:100px 120px;height:auto}</style><main id="fixture" style="height:240px"><div id="empty"></div><div id="comment"><!-- comment --></div><div id="collapsed"> \n </div><div id="generated"></div><div id="nonbreaking">\u00a0</div><pre id="pre">\n\n</pre><p id="text">Actual text</p><div id="ratio"></div><div id="relative-min"></div><div id="percent-pad"></div><div id="contained"></div></main>');
  const flags = await page.evaluate(async () => {
    const { convertToDesignDSL } = await import("/app/vendor/html2figma-browser.mjs");
    const tree = convertToDesignDSL(document.querySelector("#fixture"));
    const result = {};
    const visit = (node) => {
      if (node.nodeType === "container" && node.semantic?.attributes?.id)
        result[node.semantic.attributes.id] = node.cssEmptyBlock === true;
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
    return result;
  });
  for (const id of ["empty", "comment", "collapsed"]) assert.equal(flags[id], true, id);
  for (const id of ["generated", "nonbreaking", "pre", "text"]) assert.equal(flags[id], false, id);
  const fallback = await page.evaluate(async () => {
    const { captureWorkspaceHtmlResult } = await import("/app/html-import.mjs");
    const { normalizeDesignDocument } = await import("/app/document.mjs");
    const { applyAllAutoLayouts } = await import("/app/layout.mjs");
    const ids = ["ratio", "relative-min", "percent-pad", "contained"];
    const html = document.documentElement.outerHTML;
    const measured = Object.fromEntries(ids.map((id) => [id, document.getElementById(id).getBoundingClientRect().height]));
    const captured = await captureWorkspaceHtmlResult({ html, sourcePath: "empty.html", readText: async () => "",
      rootSelector: "#fixture", viewportWidth: 1280, viewportHeight: 720 });
    const value = normalizeDesignDocument(captured.document);
    const records = () => Object.fromEntries(ids.map((id) => {
      const node = value.nodes.find((item) => { try { return JSON.parse(item.notes).attributes?.id === id; } catch { return false; } });
      return [id, { height: node.height, layout: node.layout }];
    }));
    const before = records(); applyAllAutoLayouts(value.nodes);
    return { measured, before, after: records(), warnings: captured.report.warnings };
  });
  assert.deepEqual(fallback.before, fallback.after);
  for (const id of Object.keys(fallback.measured)) {
    assert.equal(fallback.after[id].layout, "none", id);
    assert(Math.abs(fallback.after[id].height - fallback.measured[id]) <= .01, id);
  }
  assert(fallback.warnings.filter((item) => item.code === "block-flow-fixed").length >= 4);
});
