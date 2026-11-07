import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";
import { canvasKitRangeTextRasterEligible, canvasKitRangeTextRasterFallbackReason } from "../../../apps/design-studio/app/canvas/canvaskit-text.mjs";
import { textRangeSourceSignature } from "../../../apps/design-studio/app/text-ranges.mjs";

/* Range text (range-render batch). Real Host DPR2 / offline Chromium 148: ranged text drew through the native
 * CanvasKit paragraph (ink -17%..-22% against HTML), and one range whose glyphs the supplied font lacks
 * (CJK in Inter) threw TEXT_RANGES_UNSUPPORTED out of setScene, taking the whole GPU canvas to "error". */
const app = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));
const node = (text, ranges, extra = {}) => ({ id: extra.id ?? "copy", name: "copy", type: "text", x: 20.3, y: 20.3, width: 400, height: 60, text,
  fill: "#1f2328", stroke: "transparent", strokeWidth: 0, opacity: 1, rotation: 0, fontFamily: "Inter", fontRef: "inter", fontSize: 14,
  fontWeight: 400, lineHeight: 1.3, textAlign: "left", ...extra,
  ...(ranges ? { textRanges: { version: 1, sourceSignature: textRangeSourceSignature(text), ranges } } : {}) });

test("range raster eligibility: fill/link/typography (also finite) raster; custom decorations and paint stacks stay native with a reason", () => {
  assert.equal(canvasKitRangeTextRasterFallbackReason(node("Plain fill", [{ start: 6, end: 10, fill: "#b42318" }])), null);
  assert.equal(canvasKitRangeTextRasterFallbackReason(node("Plain link", [{ start: 6, end: 10, href: "https://example.invalid" }])), null);
  assert.equal(canvasKitRangeTextRasterFallbackReason(node("Bold Big italic", [{ start: 0, end: 4, fontWeight: 700 }, { start: 5, end: 8, fontSize: 18 },
    { start: 9, end: 15, fontStyle: "italic" }])), null);
  assert.equal(canvasKitRangeTextRasterFallbackReason(node("Finite fill", [{ start: 7, end: 11, fill: "#b42318" }], { layoutBaselineOffset: 3.5 })), null);
  // Range-decoration batch: auto underline is statically eligible (runtime checks skip-ink/system fonts); line-through is not.
  assert.equal(canvasKitRangeTextRasterFallbackReason(node("Under line", [{ start: 6, end: 10, textDecoration: "underline" }])), null);
  // Range-final batch: line-through is fitted per run; a node-level line-through over mixed typography is not.
  assert.equal(canvasKitRangeTextRasterFallbackReason(node("Under line", [{ start: 6, end: 10, fill: "#b42318" }], { textDecoration: "line-through" })), null);
  assert.equal(canvasKitRangeTextRasterFallbackReason(node("Under line", [{ start: 6, end: 10, fontSize: 18 }], { textDecoration: "line-through" })), "line-through-mixed-typography");
  assert.equal(canvasKitRangeTextRasterFallbackReason(node("Stack", [{ start: 0, end: 2, fill: "#b42318" }], { fillPaints: [{ type: "SOLID", color: "#000000", opacity: 1 }] })), "paint-stack-or-stroke");
  // Range-final batch: HTML lays finite + typography text out as a plain line box; the raster follows it.
  assert.equal(canvasKitRangeTextRasterFallbackReason(node("Finite big", [{ start: 7, end: 10, fontSize: 18 }], { layoutBaselineOffset: 3.5 })), null);
  assert.equal(canvasKitRangeTextRasterEligible(node("Plain text, no ranges")), false, "plain text keeps its existing path untouched");
});

test("software CanvasKit + Canvas2D: missing CJK glyphs render by browser fallback, refusals stay per node, range edits invalidate the raster", async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await (await browser.newContext({ viewport: { width: 760, height: 350 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://range-raster.test") return route.abort();
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8">' });
    const path = resolve(app, "." + decodeURIComponent(url.pathname));
    if (!path.startsWith(app + sep)) return route.abort();
    return route.fulfill({ body: await readFile(path), contentType: { ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".woff2": "font/woff2" }[extname(path)] });
  });
  await page.goto("https://range-raster.test");
  await page.addScriptTag({ url: "/canvas/vendor/canvaskit.js" });
  const cjk = node("Inter 中文 mixed 字形", [{ start: 6, end: 8, fill: "#b42318" }]);
  const refused = node("Under line here", [{ start: 6, end: 10, textDecoration: "underline", textUnderlineOffset: { unit: "em", value: 0.2 } }], { id: "refused", y: 60.3 });
  const neighbour = node("Neighbour plain", null, { id: "neighbour", y: 100.3 });
  const result = await page.evaluate(async ({ cjk, refused, neighbour }) => {
    const CK = await CanvasKitInit({ locateFile: file => "/canvas/vendor/" + file });
    const { createCanvasKitText } = await import("/canvas/canvaskit-text.mjs");
    const bytes = new Uint8Array(await (await fetch("/fonts/InterVariable.woff2")).arrayBuffer());
    const design = { nodes: [cjk, refused, neighbour], resources: [{ id: "inter", kind: "font", family: "Inter" }] };
    const resources = new Map([["inter", { bytes, mimeType: "font/woff2", descriptor: design.resources[0] }]]);
    const counters = { textLines: 0, rasterTextNodes: 0, nativeTextNodes: 0, gradientPaints: 0 }, warnings = [];
    const text = await createCanvasKitText({ CK, design, resources, document, fallbackFontUrls: new Map(), counters,
      unsupportedNode: (n, code) => warnings.push([n.id, code]),
      makePaint: (_n, fill) => { const paint = new CK.Paint(); paint.setAntiAlias(true); paint.setColor(CK.Color(...[1, 3, 5].map(i => parseInt(fill.color.slice(i, i + 2), 16)), 1)); return paint; } });
    const ink = (surface, x0, y0, x1, y1) => {
      const image = surface.makeImageSnapshot();
      try {
        const px = image.readPixels(0, 0, { width: 760, height: 350, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB });
        let mass = 0, red = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * 760 + x) * 4, d = 255 * 3 - px[o] - px[o + 1] - px[o + 2]; mass += d; if (px[o] > px[o + 2] + 60) red++; }
        return { mass, red };
      } finally { image.delete(); }
    };
    const out = {};
    try {
      const surface = CK.MakeSurface(760, 350), canvas = surface.getCanvas();
      canvas.clear(CK.WHITE);
      let threw = null;
      for (const value of design.nodes) try { text.draw(canvas, value); } catch (error) { threw = String(error.message); }
      surface.flush();
      // CJK range lies at x ~ 50..80 (Inter advance of "Inter "); red fill is its range.
      out.cjkInk = ink(surface, 45, 2, 85, 40); out.refusedInk = ink(surface, 15, 45, 300, 75); out.neighbourInk = ink(surface, 15, 85, 300, 120);
      out.threw = threw; out.warnings = warnings; out.counters = { ...counters }; out.stats = text.stats();
      const missesBefore = out.stats.rasterTextCacheMisses;
      // Same text, different range fill: the raster must be rebuilt (signature carries the range semantics).
      const recoloured = { ...cjk, textRanges: { ...cjk.textRanges, ranges: [{ start: 6, end: 8, fill: "#175cd3" }] } };
      text.beginScene({ nodes: [recoloured, refused, neighbour] });
      canvas.clear(CK.WHITE); text.draw(canvas, recoloured); surface.flush();
      out.recolouredMisses = text.stats().rasterTextCacheMisses - missesBefore;
      out.recolouredRed = ink(surface, 45, 2, 85, 40).red;
      surface.delete();
    } finally { text.dispose(); }
    return out;
  }, { cjk, refused, neighbour });
  assert.deepEqual(errors, []);
  assert.equal(result.threw, null, "no draw throws: a refused range node never fails the scene");
  assert.ok(result.cjkInk.mass > 0 && result.cjkInk.red > 0, "CJK glyphs absent from Inter render (browser fallback) in their range colour");
  assert.equal(result.counters.rangeRasterNodes, 1, "the CJK range node uses the range raster");
  assert.equal(result.counters.nativeTextNodes, 0, "the refused decoration node is refused before any native drawing");
  assert.deepEqual(result.warnings, [["refused", "text-ranges-unsupported"]], "only the refused node is reported");
  assert.equal(result.refusedInk.mass, 0, "the refused node is not drawn");
  assert.ok(result.neighbourInk.mass > 0, "its neighbour still draws");
  assert.ok(result.stats.unrenderedTextLines >= 1);
  assert.deepEqual(result.stats.rangeTextNativeFallbacks, [{ nodeId: "refused", reason: "decoration-custom" }]);
  assert.ok(result.recolouredMisses >= 1, "a range fill edit invalidates the cached raster");
  assert.equal(result.recolouredRed, 0, "the recoloured range no longer shows the old fill");
});

/* Range-final batch (A): finite text HTML does not transport at its hanging origin is drawn as the CSS line
 * box HTML lays out (textHtmlFiniteLineBoxNode), pixel for pixel; transported finite text keeps its origin. */
test("software CanvasKit: non-transported finite text paints exactly as its HTML line box; transported finite text does not move", async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await (await browser.newContext({ viewport: { width: 400, height: 200 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://range-raster.test") return route.abort();
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8">' });
    const path = resolve(app, "." + decodeURIComponent(url.pathname));
    if (!path.startsWith(app + sep)) return route.abort();
    return route.fulfill({ body: await readFile(path), contentType: { ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".woff2": "font/woff2" }[extname(path)] });
  });
  await page.goto("https://range-raster.test");
  await page.addScriptTag({ url: "/canvas/vendor/canvaskit.js" });
  const pairs = {
    typography: [node("Finite Bold text", [{ start: 7, end: 11, fontWeight: 700 }], { id: "tf", layoutBaselineOffset: 3.5, width: 300, height: 30 }),
      node("Finite Bold text", [{ start: 7, end: 11, fontWeight: 700 }], { id: "tl", width: 300, height: 30 })],
    sourcePlain: [node("Source finite Hg", null, { id: "sp", layoutBaselineOffset: 3.5, layoutBaselineSource: "html", lineHeight: 1.2, width: 300, height: 30 }),
      node("Source finite Hg", null, { id: "sl", y: 20.3 - 3.5, lineHeight: 1.2, width: 300, height: 30 })],
    transported: [node("Hanging finite Hg", null, { id: "hp", layoutBaselineOffset: 3.5, lineHeight: 1.2, width: 300, height: 30 }),
      node("Hanging finite Hg", null, { id: "hl", lineHeight: 1.2, width: 300, height: 30 })],
  };
  const result = await page.evaluate(async pairs => {
    const CK = await CanvasKitInit({ locateFile: file => "/canvas/vendor/" + file });
    const { createCanvasKitText } = await import("/canvas/canvaskit-text.mjs");
    const bytes = new Uint8Array(await (await fetch("/fonts/InterVariable.woff2")).arrayBuffer());
    const design = { nodes: Object.values(pairs).flat(), resources: [{ id: "inter", kind: "font", family: "Inter" }] };
    const resources = new Map([["inter", { bytes, mimeType: "font/woff2", descriptor: design.resources[0] }]]);
    const counters = { textLines: 0, rasterTextNodes: 0, nativeTextNodes: 0, gradientPaints: 0 };
    const text = await createCanvasKitText({ CK, design, resources, document, fallbackFontUrls: new Map(), counters, unsupportedNode: () => {},
      makePaint: (_n, fill) => { const paint = new CK.Paint(); paint.setAntiAlias(true); paint.setColor(CK.Color(...[1, 3, 5].map(i => parseInt(fill.color.slice(i, i + 2), 16)), 1)); return paint; } });
    const surface = CK.MakeSurface(400, 200), canvas = surface.getCanvas();
    const pixels = value => {
      canvas.clear(CK.WHITE); text.draw(canvas, value); surface.flush();
      const image = surface.makeImageSnapshot();
      try { return Array.from(image.readPixels(0, 0, { width: 400, height: 200, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB })); }
      finally { image.delete(); }
    };
    const out = {};
    try {
      for (const [name, [finite, lineBox]] of Object.entries(pairs)) {
        const a = pixels(finite), b = pixels(lineBox);
        let differing = 0, ink = 0;
        for (let i = 0; i < a.length; i += 4) { if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) differing++; if (a[i] < 250) ink++; }
        const boundsA = text.contentBounds(finite), boundsB = text.contentBounds(lineBox);
        out[name] = { differing, ink, boundsA, boundsB };
      }
      out.fallbacks = text.stats().rangeTextNativeFallbacks;
    } finally { surface.delete(); text.dispose(); }
    return out;
  }, pairs);
  assert.deepEqual(errors, []);
  for (const name of ["typography", "sourcePlain"]) {
    assert.ok(result[name].ink > 100, `${name}: drawn`);
    assert.equal(result[name].differing, 0, `${name}: identical pixels to the HTML line box`);
    assert.deepEqual(result[name].boundsA, result[name].boundsB, `${name}: identical content bounds`);
  }
  assert.ok(result.transported.differing > 0, "transported finite text keeps its hanging origin (negative control)");
  assert.deepEqual(result.fallbacks, [], "finite typography no longer falls back to the native paragraph");
});
