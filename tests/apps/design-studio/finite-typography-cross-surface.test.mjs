import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";
import { normalizeDesignDocument, exportDesignSvg } from "../../../apps/design-studio/app/document.mjs";
import { measuredTextInkBounds, textMetricsSignature } from "../../../apps/design-studio/app/text-metrics.mjs";
import { textHtmlFiniteContextIn } from "../../../apps/design-studio/app/text-line-box.mjs";
import { qualityRepairVisibleBounds } from "../../../apps/design-studio/app/quality-repair.mjs";
import { textRangeSourceSignature } from "../../../apps/design-studio/app/text-ranges.mjs";

/* Cross-surface batch (review I1). Non-provenanced finite text with typography ranges is laid out by HTML as a
 * plain CSS line box (top = y, or y - offset in flow). Probe (Chromium 148, forced/emulated DSF2, receipts from the
 * browser measurer): DOM [54,76] / GPU [54,80] / SVG [50.7,72.9] for the top-level node; the flow node alike.
 * SVG kept the hanging receipt geometry, the GPU added each line's mixed-size ascent on top of the receipt's
 * baseline deltas, and ink/quality bounds certified the hanging receipt. All five surfaces now share one view. */
const app = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));

test("finite typography: GPU paint baselines and SVG y equal the exported HTML's DOM baselines; bounds follow the view; the provenanced control keeps its contract", async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 900, height: 500 }, deviceScaleFactor: 1 });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://cross-surface.test") return route.abort();
    if (url.pathname === "/" || url.pathname === "/html") return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><body style="margin:0">' });
    const path = resolve(app, "." + decodeURIComponent(url.pathname));
    if (!path.startsWith(app + sep)) return route.abort();
    return route.fulfill({ body: await readFile(path), contentType: { ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".woff2": "font/woff2" }[extname(path)] ?? "application/octet-stream" });
  });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("https://cross-surface.test");
  await page.addScriptTag({ url: "/canvas/vendor/canvaskit.js" });
  const built = await page.evaluate(async () => {
    const { normalizeDesignDocument, exportDesignSvg } = await import("/document.mjs");
    const { exportDesignFrontend } = await import("/frontend-export.mjs");
    const { measureFigmaTextDocument, createBrowserTextMeasurer, measuredTextInkBounds } = await import("/text-metrics.mjs");
    const { textHtmlFiniteContextIn, textHtmlFiniteLineBoxNode } = await import("/text-line-box.mjs");
    const { qualityRepairVisibleBounds } = await import("/quality-repair.mjs");
    const { textRangeSourceSignature } = await import("/text-ranges.mjs");
    const base = { name: "t", stroke: "transparent", strokeWidth: 0, opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false, type: "text",
      fontFamily: "Arial", fontSize: 14, fontWeight: 400, lineHeight: 1.3, textAlign: "left", fill: "#1f2328", width: 260, height: 50 };
    const ranged = (id, text, ranges, extra) => ({ ...base, id, text, ...extra, textRanges: { version: 1, sourceSignature: textRangeSourceSignature(text), ranges } });
    const frame = (id, extra) => ({ id, name: id, type: "frame", fill: "#ffffff", stroke: "transparent", strokeWidth: 0, opacity: 1, rotation: 0, cornerRadius: 0, visible: true,
      locked: false, layout: "none", layoutWrap: "none", gap: 0, padding: 0, alignItems: "start", justifyContent: "start", ...extra });
    const prov = ranged("prov-typo", "Prov bold\nsecond Big", [{ start: 5, end: 9, fontWeight: 700 }, { start: 17, end: 20, fontSize: 18 }], { x: 20.3, y: 140.3, layoutBaselineSource: "html" });
    { const m = createBrowserTextMeasurer(document); m.configure({ ...prov, layoutBaselineOffset: 0 });
      // The offset html-import would accept (its own measurer): y = top + offset.
      prov.layoutBaselineOffset = Math.round(m.lineBoxOffset({ ...prov, layoutBaselineOffset: 0 }) * 10000) / 10000; prov.y = Math.round((140.3 + prov.layoutBaselineOffset) * 10000) / 10000; }
    const doc = normalizeDesignDocument({ format: "codeshell.design", version: 3, name: "I1", canvas: { width: 800, height: 400, background: "#ffffff" }, tokens: { colors: [] }, resources: [],
      activePageId: "p", pages: [{ id: "p", name: "p", children: [
        ranged("top-typo", "Finite bold\nsecond Big", [{ start: 7, end: 11, fontWeight: 700 }, { start: 19, end: 22, fontSize: 18 }], { x: 20.3, y: 40.3, layoutBaselineOffset: 3.5 }),
        prov,
        frame("flow", { x: 400, y: 20, width: 300, height: 140, layout: "vertical", padding: 4, gap: 4, children: [
          ranged("flow-typo", "Flow bold\nnext Big", [{ start: 5, end: 9, fontWeight: 700 }, { start: 15, end: 18, fontSize: 18 }], { x: 404, y: 27.5, layoutBaselineOffset: 3.5 })] }),
      ] }] });
    await measureFigmaTextDocument(doc);
    const ids = ["top-typo", "prov-typo", "flow-typo"], byId = new Map(doc.nodes.map(n => [n.id, n])), diagnostics = [];
    const svg = exportDesignSvg(doc, { diagnostics });
    const svgY = Object.fromEntries(ids.map(id => [id, [...(svg.match(new RegExp(`data-node-id="${id}"[^]*?</g>`))?.[0] ?? "").matchAll(/<text x="[^"]*" y="([^"]*)"/g)].map(m => +m[1])]));
    const viewShift = Object.fromEntries(ids.map(id => { const n = byId.get(id); return [id, textHtmlFiniteLineBoxNode(n, textHtmlFiniteContextIn(byId, n, doc.canvas.mode)).y - n.y]; }));
    const ink = Object.fromEntries(ids.map(id => [id, measuredTextInkBounds(byId.get(id), textHtmlFiniteContextIn(byId, byId.get(id), doc.canvas.mode))]));
    const quality = Object.fromEntries(ids.map(id => [id, qualityRepairVisibleBounds(doc, byId.get(id), byId)]));
    return { doc, svgY, viewShift, ink, quality, diagnostics, html: exportDesignFrontend(doc),
      nodes: Object.fromEntries(ids.map(id => [id, { y: byId.get(id).y, x: byId.get(id).x, height: byId.get(id).height, width: byId.get(id).width, receipt: byId.get(id).textMetrics }])) };
  });
  const gpu = await page.evaluate(async doc => {
    const CK = await CanvasKitInit({ locateFile: f => "/canvas/vendor/" + f });
    const { createCanvasKitText } = await import("/canvas/canvaskit-text.mjs");
    const text = await createCanvasKitText({ CK, design: doc, resources: new Map(), document, fallbackFontUrls: new Map(),
      counters: { textLines: 0, rasterTextNodes: 0, nativeTextNodes: 0, gradientPaints: 0 }, unsupportedNode: () => {}, makePaint: () => new CK.Paint() });
    text.beginScene(doc, { layoutScale: 1 });
    try { return Object.fromEntries(["top-typo", "prov-typo", "flow-typo"].map(id => [id, text.rangePaintBaselines(doc.nodes.find(n => n.id === id))])); } finally { text.dispose(); }
  }, built.doc);
  const htmlPage = await context.newPage(); await htmlPage.goto("https://cross-surface.test/html");
  await htmlPage.setContent(built.html); await htmlPage.evaluate(() => document.fonts.ready);
  const dom = await htmlPage.evaluate(() => Object.fromEntries([["top-typo", "Finite "], ["prov-typo", "Prov "], ["flow-typo", "Flow "]].map(([id, first]) => {
    const el = [...document.querySelectorAll("body *")].filter(e => e.textContent.startsWith(first) && e.children.length).at(-1);
    const marker = () => { const m = document.createElement("span"); m.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline"; m.dataset.m = id; return m; };
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), texts = []; while (walker.nextNode()) texts.push(walker.currentNode);
    for (const t of texts) { const i = t.data.indexOf("\n"); if (i >= 0) { const rest = t.splitText(i); rest.parentNode.insertBefore(marker(), rest); } }
    el.append(marker());
    return [id, [...el.querySelectorAll(`[data-m="${id}"]`)].map(m => Math.round(m.getBoundingClientRect().top))];
  })));
  t.diagnostic(JSON.stringify({ dom, gpu, svg: built.svgY, ink: built.ink, viewShift: built.viewShift }));
  assert.deepEqual(errors, []);
  for (const id of ["top-typo", "flow-typo"]) {
    assert.deepEqual(gpu[id], dom[id], `${id}: GPU paint baselines = DOM`);
    assert.deepEqual(built.svgY[id].map(Math.round), dom[id], `${id}: SVG baselines = DOM`);
    assert.equal(built.ink[id], null, `${id}: the hanging receipt is not certified for a line-box view`);
    const n = built.nodes[id];
    assert.deepEqual(built.quality[id] && { y: built.quality[id].y, height: built.quality[id].height }, { y: n.y + built.viewShift[id], height: n.height },
      `${id}: quality-repair falls back to the node box at the view origin`);
  }
  assert.deepEqual(built.diagnostics, [], "browser metrics were available: no unmeasured diagnostic");
  // Provenanced control: unchanged contract (old SVG formula and receipt-certified bounds).
  const p = built.nodes["prov-typo"];
  assert.deepEqual(built.svgY["prov-typo"], p.receipt.lineOffsets.map(o => Math.round((p.y + o + p.receipt.alphabeticBaseline) * 100) / 100), "provenanced SVG: y + offsets + alphabeticBaseline");
  assert.notEqual(built.ink["prov-typo"], null, "provenanced receipt still certified");
  assert.deepEqual(gpu["prov-typo"], dom["prov-typo"], "provenanced GPU = DOM at DSF1");
});

test("finite typography SVG without browser font metrics keeps the receipt geometry and reports TEXT_LINE_BOX_SVG_UNMEASURED", () => {
  const text = "Finite bold\nsecond Big";
  const node = { id: "t", name: "t", type: "text", x: 20.3, y: 40.3, width: 260, height: 50, text, fill: "#000000", stroke: "transparent", strokeWidth: 0, opacity: 1,
    rotation: 0, cornerRadius: 0, visible: true, locked: false, fontFamily: "Arial", fontSize: 14, fontWeight: 400, lineHeight: 1.3, textAlign: "left", layoutBaselineOffset: 3.5,
    textRanges: { version: 1, sourceSignature: textRangeSourceSignature(text), ranges: [{ start: 7, end: 11, fontWeight: 700 }, { start: 19, end: 22, fontSize: 18 }] } };
  node.textMetrics = { version: 1, signature: textMetricsSignature(node), lineWidths: [80, 75], lineInkBounds: [{ x: 0, y: -2, width: 80, height: 16 }, { x: 0, y: -2, width: 75, height: 20 }],
    height: 44, fontAvailable: true, alphabeticBaseline: 10.4, lineHeights: [18.2, 23.4], lineOffsets: [0, 22.8] };
  const doc = normalizeDesignDocument({ format: "codeshell.design", version: 3, name: "n", canvas: { width: 400, height: 200, background: "#ffffff" }, tokens: { colors: [] }, resources: [],
    activePageId: "p", pages: [{ id: "p", name: "p", children: [node] }] });
  const diagnostics = [], svg = exportDesignSvg(doc, { diagnostics });
  assert.deepEqual([...svg.matchAll(/<text x="[^"]*" y="([^"]*)"/g)].map(m => +m[1]), [50.7, 73.5], "receipt geometry kept (no silent re-placement)");
  assert.deepEqual(diagnostics, [{ code: "TEXT_LINE_BOX_SVG_UNMEASURED", nodeId: "t" }]);
  const stored = doc.nodes[0], byId = new Map(doc.nodes.map(n => [n.id, n]));
  assert.equal(measuredTextInkBounds(stored, textHtmlFiniteContextIn(byId, stored, doc.canvas.mode)), null);
  assert.deepEqual(qualityRepairVisibleBounds(doc, stored, byId), { x: 20.3, y: 40.3, width: 260, height: 50 }, "absolute: view top = y");
  assert.deepEqual(stored.textMetrics.lineOffsets, [0, 22.8], "receipt unchanged");
});
