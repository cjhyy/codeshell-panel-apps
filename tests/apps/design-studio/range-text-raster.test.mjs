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
test("software CanvasKit: non-transported finite typography paints exactly as its HTML line box; transported and provenanced plain finite text do not move", async t => {
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
    // Skip-ink batch: provenanced plain text keeps the measured-offset transport (import contract) = its transported twin.
    sourcePlain: [node("Source finite Hg", null, { id: "sp", layoutBaselineOffset: 1.7969, layoutBaselineSource: "html", lineHeight: 1.2, width: 300, height: 30 }),
      node("Source finite Hg", null, { id: "sl", layoutBaselineOffset: 1.7969, lineHeight: 1.2, width: 300, height: 30 })],
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
    assert.equal(result[name].differing, 0, `${name}: identical pixels to ${name === "typography" ? "the HTML line box" : "the contract transport"}`);
    assert.deepEqual(result[name].boundsA, result[name].boundsB, `${name}: identical content bounds`);
  }
  assert.ok(result.transported.differing > 0, "transported finite text keeps its hanging origin (negative control)");
  assert.deepEqual(result.fallbacks, [], "finite typography no longer falls back to the native paragraph");
});

/* Skip-ink batch (native line box). The native paragraph fallback placed every range line at the plain line box
 * (paintBaseline - paragraph baseline): with an 18px run on 14px text the whole line sat about a line higher than
 * HTML. It now uses the measured mixed-size line box (as the raster). A node-level line-through over a typography
 * range keeps the node native ("line-through-mixed-typography"); its paragraph baselines must equal the real HTML
 * paint baselines (DOM marker baseline, rounded to the layout pixel) of the same runs and line height. */
test("software CanvasKit: the native range fallback puts mixed-size lines on the HTML line box", async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await (await browser.newContext({ viewport: { width: 400, height: 200 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://range-raster.test") return route.abort();
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><body style="margin:0">' });
    const path = resolve(app, "." + decodeURIComponent(url.pathname));
    if (!path.startsWith(app + sep)) return route.abort();
    return route.fulfill({ body: await readFile(path), contentType: { ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".woff2": "font/woff2" }[extname(path)] });
  });
  await page.goto("https://range-raster.test");
  await page.addScriptTag({ url: "/canvas/vendor/canvaskit.js" });
  // Line 1: 18px run on 14px; line 2: plain 14px; line 3: 24px run. y is fractional on purpose.
  const text = "Node Big under\nsecond line\nthird Huge one";
  const native = node(text, [{ start: 5, end: 8, fontSize: 18 }, { start: 33, end: 37, fontSize: 24 }],
    { id: "native", y: 20.3, width: 300, height: 90, textDecoration: "line-through" });
  const result = await page.evaluate(async value => {
    const face = new FontFace("OracleInter", await (await fetch("/fonts/InterVariable.woff2")).arrayBuffer(), { weight: "100 900" });
    await face.load(); document.fonts.add(face);
    // HTML oracle: the same runs in a CSS line box; a zero-size baseline-aligned marker at each line's end.
    const div = document.createElement("div");
    div.style.cssText = `position:absolute;left:${value.x}px;top:${value.y}px;white-space:pre;font:${value.fontSize}px/${value.lineHeight} "OracleInter"`;
    const marker = () => { const m = document.createElement("span"); m.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline"; m.className = "m"; return m; };
    const run = (t, size) => { const span = document.createElement("span"); if (size) span.style.fontSize = size + "px"; span.textContent = t; return span; };
    div.append(run("Node "), run("Big", 18), run(" under"), marker(), "\n", run("second line"), marker(), "\n", run("third "), run("Huge", 24), run(" one"), marker());
    document.body.append(div); await document.fonts.ready;
    const html = [...div.querySelectorAll(".m")].map(m => Math.round(m.getBoundingClientRect().top));
    const CK = await CanvasKitInit({ locateFile: file => "/canvas/vendor/" + file });
    const { createCanvasKitText } = await import("/canvas/canvaskit-text.mjs");
    const bytes = new Uint8Array(await (await fetch("/fonts/InterVariable.woff2")).arrayBuffer());
    const design = { nodes: [value], resources: [{ id: "inter", kind: "font", family: "Inter" }] };
    const resources = new Map([["inter", { bytes, mimeType: "font/woff2", descriptor: design.resources[0] }]]);
    const counters = { textLines: 0, rasterTextNodes: 0, nativeTextNodes: 0, gradientPaints: 0 }, warnings = [];
    const text = await createCanvasKitText({ CK, design, resources, document, fallbackFontUrls: new Map(), counters, unsupportedNode: (n, code) => warnings.push(code),
      makePaint: (_n, fill) => { const paint = new CK.Paint(); paint.setAntiAlias(true); paint.setColor(CK.Color(...[1, 3, 5].map(i => parseInt(fill.color.slice(i, i + 2), 16)), 1)); return paint; } });
    const native = [];
    try { text.draw({ drawParagraph(paragraph, x, y) { native.push(y + paragraph.getAlphabeticBaseline()); } }, value); }
    finally { var fallbacks = text.stats().rangeTextNativeFallbacks; text.dispose(); }
    return { html, native, fallbacks, warnings, counters };
  }, native);
  assert.deepEqual(errors, []);
  assert.deepEqual(result.fallbacks, [{ nodeId: "native", reason: "line-through-mixed-typography" }]);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.native.length, 3);
  result.native.forEach((y, line) => assert.ok(Math.abs(y - result.html[line]) <= 1e-6, `line ${line}: native paint baseline ${y} vs HTML ${result.html[line]}`));
});

/* Skip-ink batch (review I1/I2): provenanced finite typography keeps the measured-offset transport. The GPU baselines
 * (here on the native paragraph: node-level line-through over typography) equal the SVG typography geometry built from
 * the same receipt (transported origin + measured line offsets), rounded to the layout pixel like the paint. */
test("software CanvasKit: provenanced finite typography lines sit on the SVG typography baselines (transported origin + measured line offsets)", async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await (await browser.newContext({ viewport: { width: 400, height: 200 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://range-raster.test") return route.abort();
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><body style="margin:0">' });
    const path = resolve(app, "." + decodeURIComponent(url.pathname));
    if (!path.startsWith(app + sep)) return route.abort();
    return route.fulfill({ body: await readFile(path), contentType: { ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".woff2": "font/woff2" }[extname(path)] });
  });
  await page.goto("https://range-raster.test");
  await page.addScriptTag({ url: "/canvas/vendor/canvaskit.js" });
  const result = await page.evaluate(async () => {
    const CK = await CanvasKitInit({ locateFile: file => "/canvas/vendor/" + file });
    const { createCanvasKitText } = await import("/canvas/canvaskit-text.mjs");
    const { textRangeSourceSignature } = await import("/text-ranges.mjs");
    const { textMetricsSignature } = await import("/text-metrics.mjs");
    const { normalizeDesignDocument, exportDesignSvg } = await import("/document.mjs");
    const bytes = new Uint8Array(await (await fetch("/fonts/InterVariable.woff2")).arrayBuffer());
    const face = new FontFace("Inter", bytes.buffer.slice(0), { weight: "100 900" }); await face.load(); document.fonts.add(face);
    const ctx = document.createElement("canvas").getContext("2d"); ctx.font = "normal 400 14px Inter";
    ctx.textBaseline = "hanging"; const hanging = ctx.measureText("Hg"); ctx.textBaseline = "alphabetic"; const alphabetic = ctx.measureText("Hg");
    const h2a = alphabetic.actualBoundingBoxAscent - hanging.actualBoundingBoxAscent;
    const text = "Native Big one\nsecond line";
    const node = { id: "prov", name: "prov", type: "text", x: 20.3, y: 20.3, width: 300, height: 60, text, fill: "#1f2328", stroke: "transparent", strokeWidth: 0,
      opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false, fontFamily: "Inter", fontSize: 14, fontWeight: 400, lineHeight: 1.3, textAlign: "left",
      layoutBaselineOffset: 2.7969, layoutBaselineSource: "native", textDecoration: "line-through",
      textRanges: { version: 1, sourceSignature: textRangeSourceSignature(text), ranges: [{ start: 7, end: 10, fontSize: 18 }] } };
    node.textMetrics = { version: 1, signature: textMetricsSignature(node), lineWidths: [100, 80], lineInkBounds: [{ x: 0, y: 0, width: 100, height: 18 }, { x: 0, y: 0, width: 80, height: 18 }],
      height: 41.4, fontAvailable: true, alphabeticBaseline: h2a, lineHeights: [23.4, 18.2], lineOffsets: [0, 21.1] };
    const design = normalizeDesignDocument({ format: "codeshell.design", version: 3, name: "prov", canvas: { width: 400, height: 200, background: "#ffffff" }, tokens: { colors: [] },
      resources: [], activePageId: "p", pages: [{ id: "p", name: "p", children: [node] }] });
    const stored = design.nodes[0];
    const svg = exportDesignSvg(design), svgY = [...svg.matchAll(/<text x="[^"]*" y="([^"]*)"/g)].map(m => Number(m[1]));
    // The stored node (and its receipt signature) reaches the renderer unchanged: Inter resolves by family.
    const resources = new Map([["Inter", { bytes, mimeType: "font/woff2", descriptor: { id: "Inter", kind: "font", family: "Inter" } }]]);
    const counters = { textLines: 0, rasterTextNodes: 0, nativeTextNodes: 0, gradientPaints: 0 };
    const renderer = await createCanvasKitText({ CK, design: { nodes: [stored], resources: [{ id: "Inter", kind: "font", family: "Inter" }] }, resources, document,
      fallbackFontUrls: new Map(), counters, unsupportedNode: () => {}, makePaint: () => { const p = new CK.Paint(); p.setAntiAlias(true); return p; } });
    const gpu = [];
    try { renderer.draw({ drawParagraph(paragraph, _x, y) { gpu.push(y + paragraph.getAlphabeticBaseline()); } }, stored); }
    finally { var fallbacks = renderer.stats().rangeTextNativeFallbacks; renderer.dispose(); }
    return { svgY, gpu, fallbacks, receiptKept: JSON.stringify(stored.textMetrics.lineOffsets) };
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(result.fallbacks, [{ nodeId: "prov", reason: "line-through-mixed-typography" }]);
  assert.equal(result.receiptKept, "[0,21.1]");
  assert.equal(result.gpu.length, 2);
  result.gpu.forEach((y, line) => assert.ok(Math.abs(y - result.svgY[line]) <= 0.5, `line ${line}: GPU ${y} vs SVG ${result.svgY[line]}`));
});
