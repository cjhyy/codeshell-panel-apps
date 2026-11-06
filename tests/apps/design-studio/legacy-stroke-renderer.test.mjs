import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";
import { normalizeDesignDocument, exportDesignSvg } from "../../../apps/design-studio/app/document.mjs";
import { FIDELITY_THRESHOLDS, strokeScan, symmetricPixelDifference } from "./render-fidelity.metrics.mjs";

export const strokeNode = (id, type, extra = {}) => ({
  id, type, name: id, x: 20, y: 20, width: 120, height: 80,
  fill: "#ffffff", stroke: "#dc2626", strokeWidth: 4, opacity: 1,
  rotation: 0, cornerRadius: 0, visible: true, locked: false,
  ...(["frame", "component"].includes(type) ? {
    layout: "none", padding: 0, gap: 0, alignItems: "start", justifyContent: "start", children: [],
  } : {}),
  ...(type === "text" ? {
    text: "Outlined", fontFamily: "Arial", fontSize: 30, fontWeight: 400,
    lineHeight: 1.6, textAlign: "left", fill: "#ffffff",
  } : {}),
  ...extra,
});

export const strokeDocument = (children) => ({
  format: "codeshell.design", version: 3, name: "Legacy stroke regression",
  canvas: { width: 480, height: 240, background: "#ffffff" },
  tokens: { colors: [] }, resources: [], activePageId: "page",
  pages: [{ id: "page", name: "Page", children }],
});

const styleFor = (html, id) => html.match(new RegExp(`data-codeshell-id="${id}"[^>]*style="([^"]*)"`, "u"))[1];

test("legacy centered strokes never create a CSS border or change the containing block", () => {
  const document = strokeDocument([strokeNode("parent", "frame", {
    layout: "horizontal", padding: 12,
    children: [strokeNode("child", "rectangle", { x: 32, y: 32, width: 16, height: 16, strokeWidth: 0 })],
  })]);
  const before = JSON.stringify(document), style = styleFor(exportDesignFrontend(document), "parent");
  assert.doesNotMatch(style, /(?:^|;)border(?:-[a-z]+)?:/u);
  assert.match(style, /box-shadow:0 0 0 2px #dc2626,inset 0 0 0 2px #dc2626/u);
  assert.match(style, /padding-left:12px/u);
  assert.equal(JSON.stringify(document), before, "rendering must not rewrite saved geometry");
});

test("legacy centered stroke is painted before its existing outer shadow", () => {
  const html = exportDesignFrontend(strokeDocument([strokeNode("shape", "rectangle", {
    cornerRadius: 12, shadow: { color: "#000000", opacity: .25, x: 3, y: 5, blur: 8 },
  })]));
  assert.match(styleFor(html, "shape"), /box-shadow:0 0 0 2px #dc2626,inset 0 0 0 2px #dc2626,3px 5px 8px 2px rgba\(0,0,0,0\.25\)/u);
});

test("legacy text stroke outlines glyphs and keeps text shadow on glyphs", () => {
  const style = styleFor(exportDesignFrontend(strokeDocument([strokeNode("text", "text", {
    shadow: { color: "#000000", opacity: .25, x: 3, y: 5, blur: 8 },
  })])), "text");
  assert.match(style, /-webkit-text-stroke:4px #dc2626/u);
  assert.doesNotMatch(style, /(?:^|;)(?:border|box-shadow):/u);
  assert.match(style, /text-shadow:3px 5px 8px rgba\(0,0,0,0\.25\)/u);
});

test("explicit centered strokes retain fractional outside half widths without CSS outline quantization", () => {
  const style = styleFor(exportDesignFrontend(strokeDocument([strokeNode("center", "rectangle", {
    strokeAlign: "center", strokeWidth: 3,
  })])), "center");
  assert.doesNotMatch(style, /(?:^|;)outline:/u);
  assert.match(style, /box-shadow:0 0 0 1\.5px rgba\(220,38,38,1\),inset 0 0 0 1\.5px rgba\(220,38,38,1\)/u);
});

test("ordered CSS shadow stacks keep their supported inside-stroke contract", () => {
  const stack = { basis: "css-box", layers: [
    { kind: "inner", color: "#16a34a", opacity: 1, x: 8, y: 0, blur: 0, spread: 0, visible: true },
    { kind: "inner", color: "#2563eb", opacity: .5, x: 0, y: 8, blur: 0, spread: 0, visible: true },
  ] };
  const supported = strokeDocument([strokeNode("stack", "rectangle", { strokeAlign: "inside", shadowStack: stack })]);
  const style = styleFor(exportDesignFrontend(normalizeDesignDocument(supported)), "stack");
  assert.match(style, /border-top:4px solid rgba\(220,38,38,1\)/u);
  assert.match(style, /box-shadow:inset 8px 0px 0px 0px rgba\(22,163,74,1\),inset 0px 8px 0px 0px rgba\(37,99,235,0\.5\)/u);
  delete supported.pages[0].children[0].strokeAlign;
  assert.throws(() => normalizeDesignDocument(supported), /inside/u);
});

test("Chromium centered legacy stroke coverage and nested child edges match SVG at DPR 1 and 2", async t => {
  const browser = await chromium.launch({ args: ["--disable-gpu", "--disable-lcd-text"] });
  t.after(() => browser.close());
  for (const deviceScaleFactor of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 480, height: 240 }, deviceScaleFactor });
    try {
      for (const width of [1, 2, 3, 4]) for (const strokeAlign of [undefined, "center"]) {
        const document = strokeDocument([
          strokeNode("absolute", "frame", { strokeWidth: width, children: [
            strokeNode("absolute-child", "rectangle", { x: 32, y: 32, width: 16, height: 16, fill: "#2563eb", strokeWidth: 0 }),
          ] }),
          strokeNode("flow", "frame", { x: 180, layout: "horizontal", padding: 12, strokeWidth: width, children: [
            strokeNode("flow-child", "rectangle", { x: 192, y: 32, width: 16, height: 16, fill: "#2563eb", strokeWidth: 0 }),
          ] }),
          strokeNode("unfilled", "rectangle", { x: 340, width: 100, strokeWidth: width, fill: "transparent" }),
          strokeNode("clipped", "frame", { y: 140, height: 60, strokeWidth: width, clipContent: true, children: [
            strokeNode("clipped-child", "rectangle", { x: 10, y: 150, width: 40, height: 30, fill: "#2563eb", strokeWidth: 0 }),
          ] }),
        ]);
        if (strokeAlign) document.pages[0].children.forEach(node => { node.strokeAlign = strokeAlign; });
        await page.setContent(exportDesignFrontend(document));
        const bounds = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-codeshell-id]")].map(element => {
          const rect = element.getBoundingClientRect();
          return [element.dataset.codeshellId, { x: rect.x, y: rect.y, width: rect.width, height: rect.height, border: getComputedStyle(element).borderTopWidth }];
        })));
        assert.deepEqual(bounds["absolute-child"], { x: 32, y: 32, width: 16, height: 16, border: "0px" });
        assert.deepEqual(bounds["flow-child"], { x: 192, y: 32, width: 16, height: 16, border: "0px" });
        assert.equal(bounds.absolute.border, "0px");
        const actual = PNG.sync.read(await page.screenshot());
        await page.setContent(`<style>html,body{margin:0}svg{display:block}</style>${exportDesignSvg(normalizeDesignDocument(document))}`);
        const expected = PNG.sync.read(await page.screenshot());
        const scale = deviceScaleFactor;
        for (const shape of document.pages[0].children) {
          const options = { x: (shape.x + shape.width / 2) * scale, y: shape.y * scale, foreground: [220, 38, 38], halfWindow: 8 * scale };
          const referenceScan = strokeScan(expected, options), actualScan = strokeScan(actual, options);
          assert.ok(referenceScan && actualScan, "top stroke remains measurable");
          assert.ok(Math.abs(actualScan.centroid - referenceScan.centroid) <= FIDELITY_THRESHOLDS.strokeCentroid, "stroke centroid");
          assert.ok(Math.abs(actualScan.width - referenceScan.width) <= FIDELITY_THRESHOLDS.strokeWidth, "stroke width");
          const pixels = symmetricPixelDifference(expected, actual, { roi: {
            x: (shape.x - 5) * scale, y: (shape.y - 5) * scale,
            width: (shape.width + 10) * scale, height: (shape.height + 10) * scale,
          } });
          t.diagnostic(JSON.stringify({ shape: shape.id, width, strokeAlign: strokeAlign ?? "legacy", deviceScaleFactor, referenceScan, actualScan, pixels }));
          assert.ok(pixels.mismatchRatio <= FIDELITY_THRESHOLDS.shapeMismatchRatio, "CC shape pixel threshold");
          assert.ok(pixels.largestCluster <= FIDELITY_THRESHOLDS.largestCluster, "CC connected-cluster threshold");
        }
      }
    } finally { await page.close(); }
  }
});

test("Chromium legacy text stroke paints the same glyph fill/stroke order as SVG", async t => {
  const browser = await chromium.launch({ args: ["--disable-gpu", "--disable-lcd-text"] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 480, height: 240 }, deviceScaleFactor: 1 });
  const node = strokeNode("text", "text", { text: "HAMBURG", width: 300, fill: "#2563eb", fontSize: 40, lineHeight: 1.6 });
  await page.setContent(exportDesignFrontend(strokeDocument([node])));
  await page.evaluate(() => document.fonts.ready);
  const actual = PNG.sync.read(await page.screenshot());
  const baseline = await page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = "40px Arial";
    const metrics = ctx.measureText("HAMBURG");
    return (64 - metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2 + metrics.fontBoundingBoxAscent;
  });
  await page.setContent(`<style>html,body{margin:0;background:white}</style><svg width="480" height="240"><text x="20" y="${20 + baseline}" font-family="Arial" font-size="40" fill="#2563eb" stroke="#dc2626" stroke-width="4">HAMBURG</text></svg>`);
  const expected = PNG.sync.read(await page.screenshot());
  assert.equal(Buffer.compare(actual.data, expected.data), 0, "CSS glyph stroke must preserve SVG's fill-then-stroke paint order");
});
