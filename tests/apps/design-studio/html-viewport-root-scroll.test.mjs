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
    async capture(source, width, { scroll = false } = {}) {
      html = source;
      await page.setViewportSize({ width, height: 240 });
      await page.goto("https://viewport.test/");
      if (scroll) await page.evaluate(() => window.scrollTo(0, 20));
      return page.evaluate(async () => {
        const { captureHtmlViewportRelation } = await import("/flow.mjs");
        const root = document.documentElement,
          style = getComputedStyle(root),
          bounds = document.querySelector("#fixture").getBoundingClientRect();
        return {
          relation: captureHtmlViewportRelation(document.querySelector("#fixture")),
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
      });
    },
  };
}

test("only an unoffset standards-mode document scroller with no consumed gutter retains viewport flow at both widths", async (t) => {
  const browser = await relationBrowser();
  t.after(() => browser.close());
  for (const width of [640, 400]) {
    for (const css of ["overflow-y:scroll", "overflow:auto"]) {
      const result = await browser.capture(fixture(css), width);
      assert.equal(result.compatMode, "CSS1Compat");
      assert.equal(result.scrollingElement, "HTML");
      assert.equal(result.clientWidth, width);
      assert.equal(result.clientHeight, 240);
      assert.equal(result.scrollWidth, width);
      assert.equal(result.relation.unsupported, undefined, JSON.stringify(result));
      assert.deepEqual([result.relation.left, result.relation.right], [0, 0]);
    }
    for (const [label, source, options] of [
      ["stable gutter", fixture("overflow-y:scroll;scrollbar-gutter:stable")],
      ["both-edge gutters", fixture("overflow-y:scroll;scrollbar-gutter:stable both-edges")],
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
  for (const width of [640, 400]) {
    const result = await classic.capture(
      fixture("overflow-y:scroll", "", "::-webkit-scrollbar{width:16px}"),
      width,
    );
    assert.equal(result.gutter, "auto");
    assert.equal(
      result.clientWidth,
      width - 16,
      "classic scrollbar consumes a real 16px viewport gutter",
    );
    assert(result.relation.unsupported, JSON.stringify(result));
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

test("unsupported gutters and private clipping retain measured root geometry and honest narrow pixel failures", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-root-scroll-fixed-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const cases = [
    { id: "stable-gutter", source: fixture("overflow-y:scroll;scrollbar-gutter:stable") },
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
    if (observed.id === "stable-gutter") assert.deepEqual(initial, [0, 0]);
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
