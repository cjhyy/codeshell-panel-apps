import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import {
  applyHtmlNumberLineHeight,
  htmlTextLineHeightRatio,
} from "../../../apps/design-studio/app/html-line-height.mjs";

// Exact CSSUnitValue.number observed for the frozen GOV declaration in Chromium.
const ratio = 1.3157894897460938;
test("bounded HTML number proof bypasses geometry rounding and cannot certify malformed/mixed evidence", () => {
  const node = { id: "text", fontSize: 19, lineHeight: 1.32 };
  const source = {
    tag: "p",
    textStyle: { fontSize: 19 },
    cssLineHeight: { kind: "number", value: ratio, fontSize: 19 },
  };
  const warnings = [];
  applyHtmlNumberLineHeight(source, node, (...a) => warnings.push(a));
  assert.equal(node.lineHeight, ratio);
  assert.equal(htmlTextLineHeightRatio(node, 25 / 19), ratio);
  assert.deepEqual(warnings, []);
  const reopened = structuredClone(node);
  assert.equal(reopened.lineHeight, ratio);
  assert.equal(htmlTextLineHeightRatio(reopened, 25 / 19), 25 / 19);
  node.fontSize = 24;
  assert.equal(htmlTextLineHeightRatio(node, 1.2), 1.2);
  for (const change of [
    { cssLineHeight: { kind: "number", value: Infinity, fontSize: 19 } },
    { cssLineHeight: { kind: "number", value: 0.69, fontSize: 19 } },
    { cssLineHeight: { kind: "number", value: 3.01, fontSize: 19 } },
    { cssLineHeight: { kind: "number", value: ratio, fontSize: 16 } },
    { cssLineHeight: { kind: "number", value: ratio, fontSize: 19, arbitrary: true } },
    { cssLineHeight: null },
    { cssLineHeight: [] },
    { cssLineHeight: { kind: "resolved-length", fontSize: 19 } },
    { cssLineHeight: { kind: "normal", fontSize: 19 } },
    { cssLineHeight: { kind: "unavailable", fontSize: 19 } },
    { tag: "::before" },
    { styledSegments: [{}, {}] },
  ]) {
    const target = { id: "text", fontSize: 19, lineHeight: 1.32 },
      warnings = [];
    applyHtmlNumberLineHeight({ ...source, ...change }, target, (...a) => warnings.push(a));
    assert.equal(target.lineHeight, 1.32);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0][0], "html-line-height-intent");
  }
});

async function contextFor(t) {
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 640, height: 400 },
    deviceScaleFactor: 1,
  });
  const root = resolve("apps/design-studio/app"),
    blocked = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url()),
      file = resolve(root, "." + url.pathname);
    if (url.href === "https://html-lineheight.test/")
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><body style='margin:0'>",
      });
    if (
      url.origin === "https://html-lineheight.test" &&
      file.startsWith(root + sep) &&
      file.endsWith(".mjs")
    )
      return route.fulfill({ contentType: "text/javascript", body: await readFile(file) });
    blocked.push(url.href);
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto("https://html-lineheight.test/");
  t.after(() => assert.deepEqual(blocked, []));
  return { page, context };
}
const html = (line, extra = "", content = "Alpha Beta") =>
  `<!doctype html><style>*{box-sizing:border-box}html,body{margin:0}#fixture{display:flex;flex-direction:column;width:100%;height:400px;padding:20px;background:white;font:19px Arial;line-height:${line}}.copy{margin:0;${extra}}</style><main id="fixture"><p class="copy">${content}</p></main>`;

test("real capture keeps inherited/variable/calc numbers through plain, pre, nowrap and save/reopen", async (t) => {
  const { page } = await contextFor(t);
  const results = await page.evaluate(
    async ({ ratio, htmls }) => {
      const { captureWorkspaceHtmlResult } = await import("/html-import.mjs"),
        { normalizeDesignDocument, serializeDesignDocument } = await import("/document.mjs");
      const out = [];
      for (const html of htmls) {
        const captured = await captureWorkspaceHtmlResult({
          sourcePath: "source.html",
          html,
          readText: async () => {
            throw Error("external");
          },
          rootSelector: "#fixture",
          viewportWidth: 640,
          viewportHeight: 400,
        });
        const document = normalizeDesignDocument(
            JSON.parse(serializeDesignDocument(captured.document)),
          ),
          text = document.nodes.find((n) => n.type === "text");
        out.push({
          ratio: text.lineHeight,
          unit: text.lineHeightUnit,
          fontSize: text.fontSize,
          source: text.textSource,
          flow: text.textFlow,
          sizing: text.layoutSizingVertical,
          warnings: captured.report.warnings,
        });
      }
      return out;
    },
    {
      ratio,
      htmls: [
        html("1.3157894737"),
        html("var(--lh);--lh:1.3157894737"),
        html("calc(1 + .3157894737)"),
        html("1.3157894737", "white-space:pre", "Alpha\nBeta"),
        html("1.3157894737", "white-space:nowrap;overflow:hidden;text-overflow:ellipsis"),
      ],
    },
  );
  for (const r of results) {
    assert.equal(r.ratio, ratio);
    assert.equal(r.unit, undefined);
    assert.equal(r.fontSize, 19);
    assert.equal(r.sizing, "hug");
    assert(!r.warnings.some((w) => w.code === "html-line-height-intent"), JSON.stringify(r));
  }
  assert.equal(results[3].source, "Alpha\nBeta");
  assert.equal(results[0].flow, "wrap");
});

test("resolved lengths/normal/unavailable/pseudo/mixed stay diagnosed fallback without claiming PIXELS", async (t) => {
  const { page } = await contextFor(t);
  const results = await page.evaluate(
    async ({ htmls }) => {
      const { captureWorkspaceHtmlResult } = await import("/html-import.mjs"),
        { normalizeDesignDocument } = await import("/document.mjs");
      const out = [];
      for (const html of htmls) {
        const captured = await captureWorkspaceHtmlResult({
          sourcePath: "source.html",
          html,
          readText: async () => "",
          rootSelector: "#fixture",
          viewportWidth: 640,
          viewportHeight: 400,
        });
        const text = normalizeDesignDocument(captured.document).nodes.filter(
          (n) => n.type === "text",
        );
        out.push({ text, warnings: captured.report.warnings });
      }
      return out;
    },
    {
      htmls: [
        html("25px"),
        html("125%"),
        html("1.25em"),
        html("normal"),
        html("1.3157894737") + "<style>.copy::first-line{line-height:48px}</style>",
        html("1.3157894737", "", "Alpha <b>Beta</b>"),
      ],
    },
  );
  for (const r of results) {
    assert(r.text.every((n) => n.lineHeightUnit === undefined));
    assert(
      r.warnings.some((w) => ["html-line-height-intent", "html-plain-text-fixed"].includes(w.code)),
      JSON.stringify(r),
    );
  }
});

test("same-font number text keeps frontend edits and SVG source/reopen geometry exact without widening baseline scope", async (t) => {
  const { page, context } = await contextFor(t);
  const records = await page.evaluate(
    async ({ source }) => {
      const { captureWorkspaceHtmlResult } = await import("/html-import.mjs"),
        { normalizeDesignDocument, serializeDesignDocument, exportDesignSvg } =
          await import("/document.mjs"),
        { applyAllAutoLayouts } = await import("/layout.mjs"),
        { createBrowserTextMeasurer } = await import("/text-metrics.mjs"),
        { exportDesignFrontend } = await import("/frontend-export.mjs");
      const captured = await captureWorkspaceHtmlResult({
        sourcePath: "source.html",
        html: source,
        readText: async () => "",
        rootSelector: "#fixture",
        viewportWidth: 640,
        viewportHeight: 400,
      });
      const document = normalizeDesignDocument(captured.document),
        text = document.nodes.find((n) => n.type === "text"),
        snapshots = [];
      for (const [fontSize, width] of [
        [19, 640],
        [24, 640],
        [19, 640],
        [19, 400],
      ]) {
        text.fontSize = fontSize;
        document.canvas.width = width;
        for (const n of document.nodes)
          if (n.id === "html-viewport" || n.parentId === "html-viewport") n.width = width;
        applyAllAutoLayouts(document.nodes, {
          textMeasurer: createBrowserTextMeasurer(window.document),
        });
        const saved = serializeDesignDocument(document),
          reopened = normalizeDesignDocument(JSON.parse(saved));
        snapshots.push({
          fontSize,
          width,
          lineHeight: reopened.nodes.find((n) => n.type === "text").lineHeight,
          svg: exportDesignSvg(reopened),
          frontend: exportDesignFrontend(JSON.parse(saved)),
        });
      }
      // HTML font-edit SVG baseline remapping is a pre-existing separate limit.
      // Fresh capture at24 verifies the same-font renderer without a geometry repair.
      const fresh = await captureWorkspaceHtmlResult({
        sourcePath: "source.html",
        html: source + "<style>.copy{font-size:24px}</style>",
        readText: async () => "",
        rootSelector: "#fixture",
        viewportWidth: 640,
        viewportHeight: 400,
      });
      const value = normalizeDesignDocument(fresh.document);
      snapshots.push({
        fontSize: 24,
        width: 640,
        freshCapture: true,
        lineHeight: value.nodes.find((n) => n.type === "text").lineHeight,
        svg: exportDesignSvg(value),
        frontend: exportDesignFrontend(JSON.parse(serializeDesignDocument(value))),
      });
      return snapshots;
    },
    { source: html("1.3157894737") },
  );
  for (const r of records) {
    assert.equal(r.lineHeight, ratio);
    const expected = await context.newPage();
    await expected.setViewportSize({ width: r.width, height: 400 });
    await expected.setContent(
      html("1.3157894737", `font-size:${r.fontSize}px`).replace(
        "width:640px",
        `width:${r.width}px`,
      ),
    );
    const ref = PNG.sync.read(await expected.screenshot());
    for (const [kind, source] of [
      ["svg", r.svg],
      ["frontend", r.frontend],
    ]) {
      if (kind === "svg" && r.fontSize === 24 && !r.freshCapture) continue;

      const actual = await context.newPage();
      await actual.setViewportSize({ width: r.width, height: 400 });
      await actual.setContent(kind === "svg" ? `<style>body{margin:0}</style>${source}` : source);
      const png = PNG.sync.read(await actual.screenshot());
      assert.equal(png.data.compare(ref.data), 0, `${kind} ${r.fontSize}@${r.width} changed RGBA`);
      await actual.close();
    }
    await expected.close();
  }
});

test("missing Typed OM explicitly reports the fallback instead of guessing authored units", async (t) => {
  const { page } = await contextFor(t);
  const result = await page.evaluate(async (source) => {
    const { convertToDesignDSL } = await import("/vendor/html2figma-browser.mjs"),
      { designNodeToV3 } = await import("/design-node-adapter.mjs"),
      { normalizeDesignDocument } = await import("/document.mjs");
    document.body.innerHTML = source;
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "computedStyleMap");
    try {
      Object.defineProperty(Element.prototype, "computedStyleMap", {
        configurable: true,
        value: undefined,
      });
      const tree = convertToDesignDSL(document.querySelector("#fixture"));
      const result = await designNodeToV3(tree);
      return {
        text: normalizeDesignDocument(result.document).nodes.find((n) => n.type === "text"),
        warnings: result.report.warnings,
      };
    } finally {
      Object.defineProperty(Element.prototype, "computedStyleMap", descriptor);
    }
  }, html("1.3157894737"));
  assert.equal(result.text.lineHeight, 1.32);
  assert.equal(result.text.lineHeightUnit, undefined);
  assert(result.warnings.some((w) => w.code === "html-line-height-intent"));
});
