import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";
import { canvasKitRangeTextRasterFallbackReason } from "../../../apps/design-studio/app/canvas/canvaskit-text.mjs";
import { textRangeSourceSignature } from "../../../apps/design-studio/app/text-ranges.mjs";

/* Range-decoration batch. HTML (Chromium 148 forced/emulated DSF2, Inter bytes, sizes 13/14/18/24) draws an auto
 * underline at paint baseline + max(1, ceil(th/2)) with thickness max(1, floor(th)), th = fontSize x layout scale / 10,
 * across the run's advance interval in the run's colour (also under a node-level underline). Range-final batch:
 * line-through fits P - A + round(2A/3 - th/2) (A = ascent at the layout size, unfloored th; Inter + Arial, 24/24
 * exact); system fonts underline on the raster; skip-ink is still not modelled (best fit p90 .66, worst 3.2 device px). */
const app = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));
const node = (text, ranges, extra = {}) => ({ id: extra.id ?? "copy", name: "copy", type: "text", x: 20.3, y: 20.3, width: 600, height: 80, text,
  fill: "#000000", stroke: "transparent", strokeWidth: 0, opacity: 1, rotation: 0, fontFamily: "Inter", fontRef: "inter", fontSize: 24,
  fontWeight: 400, lineHeight: 1.25, textAlign: "left", ...extra,
  ...(ranges ? { textRanges: { version: 1, sourceSignature: textRangeSourceSignature(text), ranges } } : {}) });

test("decoration and bidi fallback reasons: underline and line-through are raster-eligible; custom/RTL/mixed-typography line-through stay native with a reason", () => {
  assert.equal(canvasKitRangeTextRasterFallbackReason(node("Under line", [{ start: 6, end: 10, textDecoration: "underline" }])), null);
  assert.equal(canvasKitRangeTextRasterFallbackReason(node("Node line", [{ start: 5, end: 9, fill: "#b42318" }], { textDecoration: "underline" })), null);
  assert.equal(canvasKitRangeTextRasterFallbackReason(node("Strike this", [{ start: 7, end: 11, textDecoration: "line-through" }])), null, "range-final: line-through fitted");
  assert.equal(canvasKitRangeTextRasterFallbackReason(node("Strike this", [{ start: 7, end: 11, fontWeight: 700 }], { textDecoration: "line-through" })), "line-through-mixed-typography");
  assert.equal(canvasKitRangeTextRasterFallbackReason(node("Under line", [{ start: 6, end: 10, textDecoration: "underline", textUnderlineOffset: { unit: "em", value: 0.2 } }])), "decoration-custom");
  assert.equal(canvasKitRangeTextRasterFallbackReason(node("שלום world", [{ start: 5, end: 10, fill: "#b42318" }])), "bidi");
  // Range-final batch: strong RTL letters outside the BMP (Adlam U+1E900, Phoenician U+10900) are bidi too.
  assert.equal(canvasKitRangeTextRasterFallbackReason(node("\u{1E900}\u{1E901} world", [{ start: 5, end: 10, fill: "#b42318" }])), "bidi");
  assert.equal(canvasKitRangeTextRasterFallbackReason(node("\u{10900} world", [{ start: 3, end: 8, fill: "#b42318" }])), "bidi");
  // Negative controls: supplementary LTR/neutral characters (emoji, CJK Ext-B, Brahmi U+11005) are not.
  for (const text of ["\u{1F600} world", "\u{20000} world", "\u{11005} world"])
    assert.equal(canvasKitRangeTextRasterFallbackReason(node(text, [{ start: 3, end: 8, fill: "#b42318" }])), null, text);
});

async function page(t) {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const value = await (await browser.newContext({ viewport: { width: 760, height: 260 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  value.on("pageerror", error => errors.push(error.message));
  await value.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://range-decoration.test") return route.abort();
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8">' });
    const path = resolve(app, "." + decodeURIComponent(url.pathname));
    if (!path.startsWith(app + sep)) return route.abort();
    return route.fulfill({ body: await readFile(path), contentType: { ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".woff2": "font/woff2" }[extname(path)] });
  });
  await value.goto("https://range-decoration.test");
  await value.addScriptTag({ url: "/canvas/vendor/canvaskit.js" });
  return { page: value, errors };
}

/** Draw nodes one by one on transparent 760x260 software surfaces; return RGBA per draw, counters, warnings, stats. */
const drawSource = async ({ nodes }) => {
  const CK = await CanvasKitInit({ locateFile: file => "/canvas/vendor/" + file });
  const { createCanvasKitText } = await import("/canvas/canvaskit-text.mjs");
  const bytes = new Uint8Array(await (await fetch("/fonts/InterVariable.woff2")).arrayBuffer());
  const design = { nodes, resources: [{ id: "inter", kind: "font", family: "Inter", weight: 400, style: "normal" }] };
  const resources = new Map([["inter", { bytes, mimeType: "font/woff2", descriptor: design.resources[0] }]]);
  const counters = { textLines: 0, rasterTextNodes: 0, nativeTextNodes: 0, gradientPaints: 0 }, warnings = [];
  const text = await createCanvasKitText({ CK, design, resources, document, fallbackFontUrls: new Map(), counters,
    unsupportedNode: (n, code) => warnings.push([n.id, code]),
    makePaint: (_n, fill) => { const paint = new CK.Paint(); paint.setAntiAlias(true); paint.setColor(CK.Color(...[1, 3, 5].map(i => parseInt(fill.color.slice(i, i + 2), 16)), 1)); return paint; } });
  const draws = [];
  try {
    for (const value of nodes) {
      const before = { ...counters }, surface = CK.MakeSurface(760, 260);
      let threw = null;
      try {
        surface.getCanvas().clear(CK.TRANSPARENT);
        try { text.draw(surface.getCanvas(), value); } catch (error) { threw = String(error.message); }
        surface.flush();
        const image = surface.makeImageSnapshot();
        try { draws.push({ id: value.id, threw, rgba: Array.from(image.readPixels(0, 0, { width: 760, height: 260, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB })),
          counters: Object.fromEntries(Object.entries(counters).map(([k, v]) => [k, v - (before[k] ?? 0)])) }); }
        finally { image.delete(); }
      } finally { surface.delete(); }
    }
    return { draws, warnings, stats: text.stats() };
  } finally { text.dispose(); }
};

test("I1: the range raster shapes AVATAR/office/e+combining/NBSP+LF once across colour boundaries: per-pixel alpha equals plain text", async t => {
  const { page: browserPage, errors } = await page(t);
  const cases = [["AVATAR", 1, 2], ["office", 2, 3], ["élan", 1, 2], ["A V\nExplicit LF", 2, 5]];
  // A same-colour range exercises every clip boundary and must leave coverage bit-identical. A different colour may
  // change glyph AA inside its run only (Skia's luminance-dependent text contrast, as in HTML), never the ink mask.
  const nodes = cases.flatMap(([text, start, end], index) => [node(text, null, { id: `plain-${index}` }), node(text, [{ start, end, fill: "#00a0ff" }], { id: `range-${index}` }),
    node(text, [{ start, end, fill: "#000000" }], { id: `same-${index}` })]);
  const result = await browserPage.evaluate(`(${drawSource})(${JSON.stringify({ nodes })})`);
  // Per line: the range's prefix-measured x interval on that line (null when the range does not reach it).
  const intervals = await browserPage.evaluate(cases => cases.map(([text, start, end]) => {
    const ctx = document.createElement("canvas").getContext("2d"); ctx.font = "400 24px Inter"; let offset = 0;
    return text.split("\n").map(line => { const from = Math.max(0, start - offset), to = Math.min(line.length, end - offset); offset += line.length + 1;
      return to > from ? [ctx.measureText(line.slice(0, from)).width, ctx.measureText(line.slice(0, to)).width] : null; });
  }), cases);
  assert.deepEqual(errors, []);
  for (const [index, [text]] of cases.entries()) {
    const plain = result.draws[index * 3], ranged = result.draws[index * 3 + 1], same = result.draws[index * 3 + 2];
    for (const draw of [plain, ranged, same]) assert.equal(draw.threw, null);
    for (const draw of [ranged, same]) {
      assert.equal(draw.counters.rangeRasterNodes, 1, `${text}: the new range raster path, not a native fallback`);
      assert.equal(draw.counters.nativeTextNodes ?? 0, 0);
    }
    let sameAlphaDiff = 0, maskDiff = 0, outsideAlphaDiff = 0, inked = 0, coloured = 0, colouredOutside = 0;
    for (let p = 0; p < plain.rgba.length; p += 4) {
      const x = (p / 4) % 760, y = Math.floor(p / 4 / 760), lineInterval = intervals[index][Math.min(intervals[index].length - 1, Math.max(0, Math.floor((y - 20.3) / 30)))];
      const inside = Boolean(lineInterval) && x >= Math.floor(20.3 + lineInterval[0]) - 1 && x <= Math.ceil(20.3 + lineInterval[1]) + 1;
      if (plain.rgba[p + 3] !== same.rgba[p + 3]) sameAlphaDiff++;
      if ((plain.rgba[p + 3] > 0) !== (ranged.rgba[p + 3] > 0)) maskDiff++;
      if (!inside && plain.rgba[p + 3] !== ranged.rgba[p + 3]) outsideAlphaDiff++;
      if (ranged.rgba[p + 3] > 0) inked++;
      if (ranged.rgba[p + 3] > 80 && ranged.rgba[p + 2] > 150) { coloured++; if (!inside) colouredOutside++; }
    }
    assert.equal(sameAlphaDiff, 0, `${text}: a same-colour range must leave coverage (alpha) bit-identical`);
    assert.equal(maskDiff, 0, `${text}: a colour range never changes which pixels carry ink`);
    assert.equal(outsideAlphaDiff, 0, `${text}: coverage outside the coloured run is bit-identical`);
    assert.ok(inked > 0);
    if (index !== 2) assert.ok(coloured > 0, `${text}: the range colour is present`);
    assert.equal(colouredOutside, 0, `${text}: the range colour stays inside its prefix-measured interval`);
  }
});

test("M1 and underline: a refusal on line 2 draws nothing of the node; a descender-free underline is rastered at the fitted rows in the run colour; a descender underline falls back natively in the run colour", async t => {
  const { page: browserPage, errors } = await page(t);
  const refused = node("First line fine\nSecond Face", [{ start: 16, end: 22, fontFamily: "Unprovided Face" }], { id: "refused" });
  const underline = node("Under line here", [{ start: 6, end: 10, textDecoration: "underline", fill: "#175cd3" }], { id: "underline" });
  const descender = node("Under gap here", [{ start: 6, end: 9, textDecoration: "underline", fill: "#175cd3" }], { id: "descender" });
  const result = await browserPage.evaluate(`(${drawSource})(${JSON.stringify({ nodes: [refused, underline, descender] })})`);
  assert.deepEqual(errors, []);
  const [r, u, d] = result.draws;
  assert.equal(r.threw, null);
  assert.equal(r.rgba.filter((_, i) => i % 4 === 3 && r.rgba[i] > 0).length, 0, "M1: no line of a refused node is drawn");
  assert.deepEqual(result.warnings.filter(([id]) => id === "refused"), [["refused", "text-ranges-unsupported"]]);
  // Underline: 24px at layout scale 1 -> th 2.4, gap ceil(1.2) = 2, thickness floor(2.4) = 2, rows baseline+2 .. baseline+3.
  assert.equal(u.counters.rangeRasterNodes, 1, "the underline node uses the range raster");
  const geometry = await browserPage.evaluate(() => { const ctx = document.createElement("canvas").getContext("2d"); ctx.font = "400 24px Inter";
    return { x0: ctx.measureText("Under ").width, x1: ctx.measureText("Under line").width }; });
  const rgbAt = (draw, x, y) => draw.rgba.slice((y * 760 + x) * 4, (y * 760 + x) * 4 + 4);
  const baselineRows = [];
  for (let y = 0; y < 80; y++) { const [rr, gg, bb, aa] = rgbAt(u, Math.round(20.3 + (geometry.x0 + geometry.x1) / 2), y); if (aa > 200 && bb > 150) baselineRows.push(y); }
  assert.ok(baselineRows.length >= 2, "an underline band exists under the range in its colour");
  const mid = rgbAt(u, Math.round(20.3 + (geometry.x0 + geometry.x1) / 2), baselineRows.at(-1));
  assert.ok(Math.hypot(mid[0] - 0x17, mid[1] - 0x5c, mid[2] - 0xd3) <= 16, `underline colour ${mid} is the run colour, not black`);
  const outside = rgbAt(u, Math.round(20.3 + geometry.x1 + 30), baselineRows.at(-1));
  assert.equal(outside[3], 0, "the underline stops at the run interval");
  assert.deepEqual(result.stats.rangeTextNativeFallbacks.find(entry => entry.nodeId === "descender"), { nodeId: "descender", reason: "underline-skip-ink" });
  assert.equal(d.counters.nativeTextNodes, 1, "skip-ink cases stay native (not modelled), explicitly");
  let blackUnderline = 0, blueUnderline = 0;
  for (let y = 30; y < 60; y++) for (let x = 100; x < 200; x++) { const [rr, gg, bb, aa] = rgbAt(d, x, y); if (aa > 200 && rr < 40 && gg < 40 && bb < 40) blackUnderline++; if (aa > 200 && bb > 150 && rr < 80) blueUnderline++; }
  assert.ok(blueUnderline > 0, "the native fallback decoration uses the run colour");
});

test("range-final: a system-font (Arial) underline rasters like a supplied font; underline endpoints land on raster pixels", async t => {
  const { page: browserPage, errors } = await page(t);
  // Record every underline fillRect in raster device space (transform a*x + e) before the renderer runs.
  await browserPage.evaluate(() => {
    window.__underlineRects = [];
    const fillRect = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
      const m = this.getTransform();
      window.__underlineRects.push({ fill: String(this.fillStyle), x0: m.a * x + m.e, x1: m.a * (x + w) + m.e });
      return fillRect.call(this, x, y, w, h);
    };
  });
  const arial = node("Arial under line", [{ start: 6, end: 11, textDecoration: "underline", fill: "#175cd3" }], { id: "arial", fontRef: undefined, fontFamily: "Arial" });
  const inter = node("Inter under line", [{ start: 6, end: 11, textDecoration: "underline", fill: "#175cd3" }], { id: "inter", x: 20.37 });
  const result = await browserPage.evaluate(`(${drawSource})(${JSON.stringify({ nodes: [arial, inter] })})`);
  const rects = await browserPage.evaluate(() => window.__underlineRects);
  assert.deepEqual(errors, []);
  const [a, i] = result.draws;
  assert.equal(a.threw, null);
  assert.equal(a.counters.rangeRasterNodes, 1, "the Arial underline node uses the range raster (was: underline-system-font, then refused by the native path)");
  assert.equal(result.stats.rangeTextNativeFallbacks.find(entry => entry.nodeId === "arial"), undefined);
  let blue = 0;
  for (let p = 0; p < a.rgba.length; p += 4) if (a.rgba[p + 3] > 200 && a.rgba[p + 2] > 150 && a.rgba[p] < 80) blue++;
  assert.ok(blue > 20, "the Arial run and its underline are drawn in the run colour");
  assert.equal(i.counters.rangeRasterNodes, 1);
  assert.ok(rects.length >= 2, "both underlines are drawn on the raster");
  for (const rect of rects) for (const edge of [rect.x0, rect.x1])
    assert.ok(Math.abs(edge - Math.round(edge)) < 1e-6, `underline edge ${edge} is on a raster pixel`);
});

test("range-final: line-through rasters at the fitted rows (P - A + round(2A/3 - th/2), thickness floor(th)) in the run colour", async t => {
  const { page: browserPage, errors } = await page(t);
  // Integer origin: the master raster rows land on surface rows. Same text, underline vs line-through on one run.
  const under = node("Strike this out", [{ start: 7, end: 11, textDecoration: "underline", fill: "#175cd3" }], { id: "under", x: 20, y: 20 });
  const strike = node("Strike this out", [{ start: 7, end: 11, textDecoration: "line-through", fill: "#175cd3" }], { id: "strike", x: 20, y: 20 });
  const plain = node("Strike this out", [{ start: 7, end: 11, fill: "#175cd3" }], { id: "plain", x: 20, y: 20 });
  const result = await browserPage.evaluate(`(${drawSource})(${JSON.stringify({ nodes: [under, strike, plain] })})`);
  const metrics = await browserPage.evaluate(async () => {
    // The renderer registers Inter under an alias: load the same bytes under a test family for the oracle metrics.
    const face = new FontFace("OracleInter", await (await fetch("/fonts/InterVariable.woff2")).arrayBuffer(), { weight: "100 900" });
    await face.load(); document.fonts.add(face);
    const ctx = document.createElement("canvas").getContext("2d"); ctx.font = '400 24px "OracleInter"'; ctx.fontKerning = "normal";
    return { A: ctx.measureText("Hg").fontBoundingBoxAscent, x0: ctx.measureText("Strike ").width, x1: ctx.measureText("Strike this").width }; });
  assert.deepEqual(errors, []);
  const [u, s, p] = result.draws;
  for (const draw of [u, s]) assert.equal(draw.counters.rangeRasterNodes, 1);
  assert.deepEqual(result.stats.rangeTextNativeFallbacks, []);
  // Rows a decoration adds over the undecorated node, inside the run interval (alpha gain > 128).
  const added = draw => { const rows = new Set(); let outside = 0;
    for (let y = 0; y < 120; y++) for (let x = 0; x < 760; x++) { const o = (y * 760 + x) * 4;
      if (draw.rgba[o + 3] - p.rgba[o + 3] > 128) { if (x > 20 + metrics.x0 + 1 && x < 20 + metrics.x1 - 1) rows.add(y); else if (x < 20 + metrics.x0 - 2 || x > 20 + metrics.x1 + 2) outside++; } }
    return { rows: [...rows].sort((a, b) => a - b), outside }; };
  const ur = added(u), sr = added(s);
  assert.equal(sr.outside, 0, "the line-through stops at the run interval");
  assert.equal(sr.rows.length, 2, `thickness floor(2.4) = 2 rows, got ${sr.rows}`);
  // Underline top = P + max(1, ceil(th/2)) = P + 2; line-through top = P - A + round(2A/3 - th/2).
  const expected = (Math.round(2 * metrics.A / 3 - 1.2) - metrics.A) - 2;
  assert.equal(sr.rows[0] - ur.rows[0], expected, `line-through ${sr.rows} vs underline ${ur.rows}, A ${metrics.A}`);
  const o = (sr.rows[0] * 760 + Math.round(20 + (metrics.x0 + metrics.x1) / 2)) * 4;
  assert.ok(Math.hypot(s.rgba[o] - 0x17, s.rgba[o + 1] - 0x5c, s.rgba[o + 2] - 0xd3) <= 16, "the run colour");
});
