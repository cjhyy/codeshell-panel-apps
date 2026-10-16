import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { chromium } from "playwright";
import { prepareFigmaImport } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { auditDesignPages } from "../../../apps/design-studio/app/audit.mjs";
import { normalizeDesignState, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { currentTextMetrics } from "../../../apps/design-studio/app/text-metrics.mjs";

const source = (text, { width = 100, height = 100, autoResize = "HEIGHT", family = "Arial" } = {}) => ({
  type: "CANVAS", id: "0:1", name: "Text fixture", children: [{
    type: "TEXT", id: "1:1", name: "Measured copy", characters: text,
    absoluteBoundingBox: { x: 10, y: 10, width, height },
    fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
    style: { fontFamily: family, fontSize: 20, fontWeight: 400, lineHeightPx: 28, textAutoResize: autoResize },
  }],
});

async function browserFixture(t) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const root = resolve("apps/design-studio/app");
  await page.route("https://metrics.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") return route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" });
    const file = resolve(root, `.${path}`);
    if (!file.startsWith(root + sep)) return route.abort();
    try { await route.fulfill({ contentType: "text/javascript", body: await readFile(file) }); }
    catch { await route.fulfill({ status: 404, body: "missing" }); }
  });
  await page.goto("https://metrics.test/");
  return page;
}

test("Node imports retain conservative checks until a real browser measurement exists", async () => {
  const result = await prepareFigmaImport(source("MMMMMMMMMMMM", { width: 20 }));
  assert.equal(result.textMeasurement.measured, 0);
  assert.equal(result.document.nodes[0].textMetrics, undefined);
  assert.ok(auditDesignPages(result.document).some((issue) => issue.code === "layout.text-width-overflow"));
});

test("browser soft wrapping retains every source character and agrees with the exported SVG", async (t) => {
  const page = await browserFixture(t);
  const original = "An editable paragraph with  two spaces, 中文换行 and explicit\nsecond line.";
  const result = await page.evaluate(async (input) => {
    const { prepareFigmaImport } = await import("/figma-bridge.mjs");
    const { exportDesignSvg } = await import("/document.mjs");
    const result = await prepareFigmaImport(input);
    document.body.innerHTML = exportDesignSvg(result.document);
    const widths = [...document.querySelectorAll("svg text")].map((node) => node.getComputedTextLength());
    return { result, widths };
  }, source(original, { width: 135 }));
  const node = result.result.document.nodes[0];
  assert.equal(node.textSource, original);
  assert.equal(node.text.replaceAll("\n", ""), original.replaceAll("\n", ""));
  assert.ok(node.text.split("\n").length > 2);
  assert.equal(node.textMetrics.fontAvailable, true);
  assert.ok(result.widths.every((width) => width <= node.width + 0.5));
  assert.ok(!auditDesignPages(result.result.document).some((issue) => issue.code.startsWith("layout.text-")));
  assert.ok(currentTextMetrics(node));
  const reopened = normalizeDesignState(result.result.document);
  assert.ok(currentTextMetrics(reopened.nodes[0]));
  assert.ok(serializeDesignDocument(reopened).includes('"textMetrics"'));
});

test("hug text uses real width and ink height; shrinking or editing still produces audit failures", async (t) => {
  const page = await browserFixture(t);
  const result = await page.evaluate(async (input) => {
    const { prepareFigmaImport } = await import("/figma-bridge.mjs");
    const { exportDesignSvg } = await import("/document.mjs");
    const result = await prepareFigmaImport(input);
    document.body.innerHTML = exportDesignSvg(result.document);
    const text = document.querySelector("svg text");
    const bounds = text.getBBox();
    return { result, inkBottom: bounds.y + bounds.height };
  }, source("Welcome to text measurement!", { width: 1, height: 1, autoResize: "WIDTH_AND_HEIGHT" }));
  const documentValue = result.result.document, node = documentValue.nodes[0];
  assert.equal(node.text, node.textSource);
  assert.equal(node.textFlow, undefined);
  assert.ok(node.width > 100);
  assert.ok(node.y + node.height + 0.01 >= result.inkBottom);
  assert.ok(!auditDesignPages(documentValue).some((issue) => issue.code.startsWith("layout.text-")));
  const originalNode = structuredClone(node);
  node.width = 20;
  node.height = 1;
  let issues = auditDesignPages(documentValue);
  assert.ok(issues.some((issue) => issue.code === "layout.text-width-overflow"));
  assert.ok(issues.some((issue) => issue.code === "layout.text-overflow"));
  node.text += " Much longer changed content";
  assert.equal(currentTextMetrics(node), null);
  issues = auditDesignPages(documentValue);
  assert.ok(issues.some((issue) => issue.code === "layout.text-width-overflow"));
  for (const property of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight"]) {
    const copy = structuredClone(originalNode);
    copy[property] = typeof copy[property] === "number" ? copy[property] + 1 : "changed";
    assert.equal(currentTextMetrics(copy), null, property);
  }
});

test("parent checks distinguish a tall text box from actual hanging-baseline ink escaping its parent", async (t) => {
  const page = await browserFixture(t);
  const input = source("Short text", { width: 140, height: 100 });
  input.children = [{ type: "FRAME", id: "1:2", name: "Text owner", clipsContent: false,
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 50 }, children: input.children }];
  const result = await page.evaluate(async (input) => {
    const { prepareFigmaImport } = await import("/figma-bridge.mjs");
    return prepareFigmaImport(input);
  }, input);
  const node = result.document.nodes.find((node) => node.type === "text");
  assert.equal(node.height, 100);
  assert.ok(!auditDesignPages(result.document).some((issue) => issue.nodeId === node.id && issue.code === "layout.parent-overflow"));
  node.y = 40;
  assert.ok(auditDesignPages(result.document).some((issue) => issue.nodeId === node.id && issue.code === "layout.parent-overflow"));
});

test("missing fonts are reported and an oversized single glyph stays a real error", async (t) => {
  const page = await browserFixture(t);
  const result = await page.evaluate(async (input) => {
    const { prepareFigmaImport } = await import("/figma-bridge.mjs");
    return prepareFigmaImport(input);
  }, source("W", { width: 1, height: 100, autoResize: "NONE", family: "Deliberately Missing Fixture Font" }));
  const node = result.document.nodes[0];
  assert.equal(node.width, 1);
  assert.equal(node.textMetrics.fontAvailable, false);
  assert.ok(result.warnings.some((warning) => warning.code === "font-fallback"));
  assert.ok(auditDesignPages(result.document).some((issue) => issue.code === "layout.text-width-overflow"));
});

test("malformed measurement receipts cannot enter a normalized document", async () => {
  const result = await prepareFigmaImport(source("Text"));
  for (const receipt of [null, {}, { version: 1, signature: "x", lineWidths: [NaN], height: 20, fontAvailable: true },
    { version: 1, signature: "x", lineWidths: [20], height: -1, fontAvailable: true }]) {
    const documentValue = structuredClone(result.document);
    documentValue.nodes[0].textMetrics = receipt;
    documentValue.pages[0].nodes = documentValue.nodes;
    assert.throws(() => normalizeDesignState(documentValue), /文字属性无效/u);
  }
});
