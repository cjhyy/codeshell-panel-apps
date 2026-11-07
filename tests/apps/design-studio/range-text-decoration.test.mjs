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
 * across the run's advance interval in the run's colour (also under a node-level underline). Line-through has no
 * fit (ascent/x-height/strikeout metrics all miss by > .25 device px) and stays native; skip-ink is not modelled. */
const app = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));
const node = (text, ranges, extra = {}) => ({ id: extra.id ?? "copy", name: "copy", type: "text", x: 20.3, y: 20.3, width: 600, height: 80, text,
  fill: "#000000", stroke: "transparent", strokeWidth: 0, opacity: 1, rotation: 0, fontFamily: "Inter", fontRef: "inter", fontSize: 24,
  fontWeight: 400, lineHeight: 1.25, textAlign: "left", ...extra,
  ...(ranges ? { textRanges: { version: 1, sourceSignature: textRangeSourceSignature(text), ranges } } : {}) });

test("decoration and bidi fallback reasons: underline is raster-eligible, line-through/custom/RTL stay native with a reason", () => {
  assert.equal(canvasKitRangeTextRasterFallbackReason(node("Under line", [{ start: 6, end: 10, textDecoration: "underline" }])), null);
  assert.equal(canvasKitRangeTextRasterFallbackReason(node("Node line", [{ start: 5, end: 9, fill: "#b42318" }], { textDecoration: "underline" })), null);
  assert.equal(canvasKitRangeTextRasterFallbackReason(node("Strike this", [{ start: 7, end: 11, textDecoration: "line-through" }])), "line-through-unfitted");
  assert.equal(canvasKitRangeTextRasterFallbackReason(node("Under line", [{ start: 6, end: 10, textDecoration: "underline", textUnderlineOffset: { unit: "em", value: 0.2 } }])), "decoration-custom");
  assert.equal(canvasKitRangeTextRasterFallbackReason(node("שלום world", [{ start: 5, end: 10, fill: "#b42318" }])), "bidi");
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
