import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { runProductionFidelity } from "../../../scripts/design-studio-production-fidelity.mjs";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
} from "../../../apps/design-studio/app/document.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";

const moduleSource = await readFile(
  new URL("../../../apps/design-studio/app/html-viewport-flow.mjs", import.meta.url),
  "utf8",
);
const fixture = (htmlCss = "overflow-y:scroll", bodyCss = "", content = "") =>
  `<!doctype html><style>html{${htmlCss}}body{margin:0;background:white;${bodyCss}}#fixture{height:480px;padding:20px;background:#eee}#child{height:100px;background:#2563eb}${content}</style><main id="fixture"><div id="child"></div></main>`;

async function relationBrowser(options = {}) {
  const browser = await chromium.launch({ args: ["--disable-gpu"], ...options });
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  let html;
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url === "https://viewport.test/")
      return route.fulfill({ contentType: "text/html", body: html });
    if (url === "https://viewport.test/flow.mjs")
      return route.fulfill({ contentType: "text/javascript", body: moduleSource });
    throw new Error(`Unexpected request: ${url}`);
  });
  const page = await context.newPage();
  return {
    close: () => browser.close(),
    async capture(source, width, { scroll = false, rootSelector = "#fixture" } = {}) {
      html = source;
      await page.setViewportSize({ width, height: 240 });
      await page.goto("https://viewport.test/");
      if (scroll) await page.evaluate(() => window.scrollTo(0, 20));
      return page.evaluate(async (selector) => {
        const { captureHtmlViewportRelation } = await import("/flow.mjs");
        const root = document.documentElement,
          style = getComputedStyle(root),
          selected = document.querySelector(selector), bounds = selected.getBoundingClientRect();
        return {
          relation: captureHtmlViewportRelation(selected),
          innerWidth,
          innerHeight,
          clientWidth: root.clientWidth,
          clientHeight: root.clientHeight,
          scrollX,
          scrollY,
          scrollWidth: root.scrollWidth,
          compatMode: document.compatMode,
          scrollingElement: document.scrollingElement?.tagName,
          overflow: [style.overflowX, style.overflowY],
          gutter: style.scrollbarGutter,
          bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        };
      }, rootSelector);
    },
  };
}

test("an unoffset standards document scroller preserves empty or reserved viewport gutters at both widths", async (t) => {
  const browser = await relationBrowser();
  t.after(() => browser.close());
  for (const width of [640, 400]) {
    for (const css of ["overflow-y:scroll", "overflow:auto",
      "overflow-y:scroll;scrollbar-gutter:stable", "overflow-y:scroll;scrollbar-gutter:stable both-edges"]) {
      const result = await browser.capture(fixture(css), width);
      assert.equal(result.compatMode, "CSS1Compat");
      assert.equal(result.scrollingElement, "HTML");
      assert.equal(result.clientWidth, width);
      assert.equal(result.clientHeight, 240);
      assert.equal(result.scrollWidth, result.bounds.width);
      assert.equal(result.relation.unsupported, undefined, JSON.stringify(result));
      assert.deepEqual([result.relation.left, result.relation.right],
        [result.bounds.x, width - result.bounds.x - result.bounds.width]);
    }
    for (const [label, source, options] of [
      ["custom gutter", fixture("overflow-y:scroll;scrollbar-gutter:stable", "", "::-webkit-scrollbar{width:16px}")],
      ["custom both-edge gutter", fixture("overflow-y:scroll;scrollbar-gutter:stable both-edges", "", "::-webkit-scrollbar{width:16px}")],
      ["gutter with a root max width", fixture("overflow-y:scroll;scrollbar-gutter:stable;max-width:300px")],
      ["gutter with a root min width", fixture("overflow-y:scroll;scrollbar-gutter:stable;min-width:700px")],
      ["gutter with a fixed root width", fixture("overflow-y:scroll;scrollbar-gutter:stable;width:300px")],
      ["gutter with relative root padding", fixture("overflow-y:scroll;scrollbar-gutter:stable;padding:2vw")],
      ["gutter with root translation", fixture("overflow-y:scroll;scrollbar-gutter:stable;translate:1px")],
      ["gutter with a canvas image", fixture("overflow-y:scroll;scrollbar-gutter:stable;background:linear-gradient(red,blue)")],
      ["hidden root clip", fixture("overflow:hidden")],
      ["explicit root clip", fixture("overflow:clip")],
      ["private body scroller", fixture("overflow-y:scroll", "height:200px;overflow:auto")],
      ["body clipping", fixture("overflow-y:scroll", "height:200px;overflow:hidden")],
      ["horizontal overflow", fixture("overflow-y:scroll", "", "#child{width:900px}")],
      ["nonzero root offset", fixture(), { scroll: true }],
      ["quirks document", fixture().replace("<!doctype html>", "")],
    ]) {
      const result = await browser.capture(source, width, options);
      assert(result.relation.unsupported, `${label} at ${width}: ${JSON.stringify(result)}`);
    }
  }
  // Playwright normally hides scrollbars. Explicitly retain a real classic
  // scrollbar so this checks consumed geometry rather than a mocked getter.
  const classic = await relationBrowser({ ignoreDefaultArgs: ["--hide-scrollbars"] });
  t.after(() => classic.close());
  for (const width of [640, 400]) for (const gutter of ["auto", "stable", "stable both-edges"]) {
    const result = await classic.capture(fixture(`overflow-y:scroll;scrollbar-gutter:${gutter}`, "",
      "::-webkit-scrollbar{width:16px}"), width);
    assert.equal(result.gutter, gutter);
    assert.equal(result.clientWidth, width - 16, "visible classic scrollbar consumes exactly its real 16px gutter");
    assert(result.relation.unsupported, JSON.stringify(result));
  }
});

test("own HTML root constraints and authored relative or conditional insets cannot masquerade as fixed gutters", async (t) => {
  const browser = await relationBrowser();
  t.after(() => browser.close());
  const base = "overflow-y:scroll;scrollbar-gutter:stable;";
  for (const width of [640, 400]) for (const [label, source] of [
    ["fixed width", fixture(base + "width:300px")],
    ["max width", fixture(base + "max-width:300px")],
    ["min width", fixture(base + "min-width:300px")],
    ["viewport padding", fixture(base + "padding:2vw")],
    ["variable padding", fixture(base + "--inset:12px;padding:var(--inset)")],
    ["logical relative padding", fixture(base + "padding-inline:2vw")],
    ["conditional fixed padding", fixture(base, "", "@media(min-width:500px){html{padding:12px}}")],
    ["relative body margin", fixture(base, "margin-left:2vw")],
    ["relative selected margin", fixture(base, "", "#fixture{margin-left:2vw}")],
  ]) for (const rootSelector of ["html", "body", "#fixture"]) {
    // The relative selected-root margin is irrelevant when its full ancestor
    // subtree is captured; it is guarded when that selected root needs rebasing.
    if (label === "relative selected margin" && rootSelector !== "#fixture") continue;
    if (label === "relative body margin" && rootSelector === "html") continue;
    const result = await browser.capture(source, width, { rootSelector });
    assert(result.relation.unsupported, `${label}/${rootSelector}/${width}: ${JSON.stringify(result)}`);
  }
});

test("variable physical and logical box declarations cannot authorize a fixed gutter context before a breakpoint", async (t) => {
  const browser = await relationBrowser();
  t.after(() => browser.close());
  const base = "overflow-y:scroll;scrollbar-gutter:stable;";
  const cases = [
    ["width", "--size:auto;width:var(--size)", "--size:300px"],
    ["min-width", "--size:auto;min-width:var(--size)", "--size:300px"],
    ["max-width", "--size:none;max-width:var(--size)", "--size:300px"],
    ["left", "position:relative;--offset:0px;left:var(--offset)", "--offset:10px"],
    ["inset shorthand", "position:relative;--offset:0px;inset:var(--offset)", "--offset:10px"],
    ["overflow shorthand", "--over:scroll;overflow:var(--over)", "--over:hidden"],
    ["inline-size", "--size:auto;inline-size:var(--size)", "--size:300px"],
    ["conditional inline-size", "", "inline-size:300px"],
    ["conditional min-inline-size", "", "min-inline-size:300px"],
    ["conditional logical inset", "position:relative", "inset-inline-start:10px"],
    ["conditional writing direction", "", "direction:rtl"],
  ];
  for (const [label, initial, narrow] of cases) for (const width of [640, 400])
    for (const rootSelector of ["html", "body", "#fixture"]) {
      const source = fixture(base + initial, "", `@media(max-width:500px){html{${narrow}}}`);
      const observed = await browser.capture(source, width, { rootSelector });
      assert(observed.relation.unsupported, `${label}/${rootSelector}/${width}: ${JSON.stringify(observed)}`);
    }
});

test("root viewport auto/scroll overflow preserves ordinary vertical Fill, save/reopen and exact outer-only resize pixels", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-root-scroll-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const cases = [
    { id: "scrolling-body", rootSelector: "body", source: fixture() },
    { id: "auto-main", source: fixture("overflow:auto", "margin:12px;padding:8px") },
    {
      id: "full-height-body",
      rootSelector: "body",
      source: fixture("overflow-y:scroll;height:100%", "height:100%"),
    },
  ];
  const result = await runProductionFidelity({ output, cases, resizeMode: "viewport-only" });
  assert.equal(result.passed, true, JSON.stringify(result.cases));
  for (const observed of result.cases) {
    assert.deepEqual(
      observed.comparisons.map((comparison) => comparison.changedPixels),
      [0, 0, 0],
      observed.id,
    );
    assert(
      !observed.warnings.some((warning) => warning.code === "viewport-flow-fixed"),
      JSON.stringify(observed),
    );
    const original = normalizeDesignDocument(
      JSON.parse(await readFile(join(output, observed.id, "imported.codesign.json"))),
    );
    const narrow = normalizeDesignDocument(
      JSON.parse(await readFile(join(output, observed.id, "narrow.codesign.json"))),
    );
    const root = original.nodes.find((node) => node.parentId === "html-viewport");
    const narrowed = narrow.nodes.find((node) => node.id === root.id);
    assert.equal(original.nodes[0].layout, "vertical");
    assert.equal(original.nodes[0].clipContent, true);
    assert.equal(root.layout, "vertical");
    assert.equal(root.layoutSizingHorizontal, "fill");
    assert.notEqual(root.layoutPositioning, "absolute");
    assert(narrowed.width < root.width);
    if (observed.id === "full-height-body") assert.equal(narrowed.layoutSizingVertical, "fill");
    const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(narrow)));
    applyAllAutoLayouts(reopened.nodes);
    assert.deepEqual(
      reopened.nodes.map((node) => [node.id, node.x, node.y, node.width, node.height]),
      narrow.nodes.map((node) => [node.id, node.x, node.y, node.width, node.height]),
    );
    const transfer = createFigmaTransfer(reopened);
    assert.equal(transfer.pages[0].children[0].layout, "vertical");
    assert.equal(transfer.pages[0].children[0].children[0].id, root.id);
    assert.equal(transfer.pages[0].children[0].children[0].layoutSizingHorizontal, "fill");
  }
});

test("custom gutters and private clipping retain measured root geometry and honest narrow pixel failures", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-root-scroll-fixed-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const cases = [
    { id: "custom-gutter", source: fixture("overflow-y:scroll;scrollbar-gutter:stable", "", "::-webkit-scrollbar{width:16px}") },
    {
      id: "body-private-clip",
      source: fixture("overflow-y:scroll", "height:200px;overflow:hidden"),
    },
  ];
  const reference = await relationBrowser();
  t.after(() => reference.close());
  const expectedBounds = new Map();
  for (const source of cases) {
    const measured = await reference.capture(source.source, 640);
    assert(measured.relation.unsupported, source.id);
    expectedBounds.set(source.id, measured.bounds);
  }
  const result = await runProductionFidelity({
    output,
    resizeMode: "viewport-only",
    recordOnly: true,
    cases,
  });
  assert.equal(result.passed, false);
  for (const observed of result.cases) {
    const initial = observed.comparisons.slice(0, 2).map((comparison) => comparison.changedPixels);
    if (observed.id === "custom-gutter") assert.deepEqual(initial, [0, 0]);
    else
      assert(
        initial.every((changedPixels) => changedPixels > 0),
        "the private ancestor clip is outside the selected subtree and remains an honest initial failure",
      );
    assert(observed.comparisons[2].changedPixels > 0, observed.id);
    assert(
      observed.warnings.some((warning) => warning.code === "viewport-flow-fixed"),
      observed.id,
    );
    for (const mode of ["imported", "narrow"]) {
      const document = normalizeDesignDocument(
        JSON.parse(await readFile(join(output, observed.id, `${mode}.codesign.json`))),
      );
      assert.equal(document.nodes[0].layout, "none");
      const root = document.nodes.find((node) => node.parentId === "html-viewport");
      // Stable gutters can consume real viewport space even with hidden
      // scrollbars. Both modes must retain the independently measured source
      // box rather than assume it spans all 640 viewport pixels.
      assert.deepEqual(
        { x: root.x, y: root.y, width: root.width, height: root.height },
        expectedBounds.get(observed.id),
      );
      assert.equal(document.nodes[0].width, mode === "imported" ? 640 : 400);
    }
  }
});

test("reserved stable gutters use real viewport padding and Fill for HTML, body and selected main roots", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-stable-gutter-flow-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const reference = await relationBrowser();
  t.after(() => reference.close());
  const cases = [], expected = new Map();
  for (const both of [false, true]) for (const spaced of [false, true]) {
    const source = fixture(`overflow-y:scroll;scrollbar-gutter:stable${both ? " both-edges" : ""}${spaced ? ";padding:12px;margin:8px" : ""}`,
      spaced ? "margin:12px;padding:8px" : "");
    for (const rootSelector of ["#fixture", "body", "html"]) {
      const initial = (await reference.capture(source, 640, { rootSelector })).bounds;
      const narrow = (await reference.capture(source, 400, { rootSelector })).bounds;
      const id = `${both ? "both" : "stable"}-${spaced ? "spaced-" : ""}${rootSelector.replace("#", "")}`;
      cases.push({ id, rootSelector, source });
      expected.set(id, { initial, narrow });
    }
  }
  const result = await runProductionFidelity({ output, cases, width: 640, height: 700, narrowWidth: 400,
    resizeMode: "viewport-only" });
  assert.equal(result.passed, true, JSON.stringify(result.cases.map(item => ({ id: item.id,
    pixels: item.comparisons.map(value => value.changedPixels), warnings: item.warnings }))));
  for (const observed of result.cases) {
    assert(observed.comparisons.every(item => item.changedPixels === 0 && item.maximumChannelDelta === 0), observed.id);
    assert(!observed.warnings.some(warning => warning.code === "viewport-flow-fixed"), observed.id);
    const expectedBoxes = expected.get(observed.id);
    for (const mode of ["imported", "relayout", "narrow"]) {
      const document = normalizeDesignDocument(JSON.parse(await readFile(join(output, observed.id, `${mode}.codesign.json`))));
      const wrapper = document.nodes[0], root = document.nodes.find(node => node.parentId === wrapper.id);
      const original = expectedBoxes.initial, measured = mode === "narrow" ? expectedBoxes.narrow : original;
      assert.equal(wrapper.layout, "vertical");
      assert.equal(wrapper.paddingLeft, original.x);
      assert.equal(wrapper.paddingRight, 640 - original.x - original.width);
      assert.equal(root.layoutSizingHorizontal, "fill");
      assert.notEqual(root.layoutPositioning, "absolute");
      assert.deepEqual({ x: root.x, y: root.y, width: root.width, height: root.height }, measured);
      const restored = normalizeDesignDocument(JSON.parse(serializeDesignDocument(document)));
      applyAllAutoLayouts(restored.nodes);
      assert.equal(serializeDesignDocument(restored), serializeDesignDocument(document));
      const transfer = createFigmaTransfer(restored), frame = transfer.pages[0].children[0];
      assert.equal(frame.layout, "vertical");
      assert.equal(frame.paddingLeft, wrapper.paddingLeft);
      assert.equal(frame.paddingRight, wrapper.paddingRight);
      assert.equal(frame.children[0].id, root.id);
      assert.equal(frame.children[0].layoutSizingHorizontal, "fill");
    }
  }
});
