import assert from "node:assert/strict";
import { test } from "node:test";
import { canvasKitResourceTextRasterEligible, createCanvasKitText } from "../../../apps/design-studio/app/canvas/canvaskit-text.mjs";

const node = (extra = {}) => ({ id: "text", type: "text", text: "Inter sample", x: 10, y: 20, width: 300, height: 40,
  fontFamily: "Inter", fontRef: "inter", fontSize: 32, fontWeight: 400, lineHeight: 1.15, textAlign: "left",
  fill: "#000000", stroke: "transparent", strokeWidth: 0, ...extra });

test("resource raster admission preserves finite origins, ranges, decorations and stroked text native semantics", () => {
  assert(canvasKitResourceTextRasterEligible(node()));
  for (const extra of [{ layoutBaselineOffset: 0 }, { layoutBaselineOffset: -8 }, { textRanges: {} },
    { textDecoration: "underline" }, { textDecoration: "line-through" }, { stroke: "#000000", strokeWidth: 1 },
    { fillPaints: [{ type: "SOLID", color: "#000000", opacity: 1 }] }])
    assert.equal(canvasKitResourceTextRasterEligible(node(extra)), false, JSON.stringify(extra));
  assert(canvasKitResourceTextRasterEligible(node({ stroke: "transparent", strokeWidth: 1 })));
});

async function harness(t, nodes) {
  const faces = new Set(), loads = [], deletedImages = [];
  class Face { constructor(family, _bytes, descriptor) { Object.assign(this, descriptor, { family, status: "unloaded" }); }
    async load() { this.status = "loaded"; return this; } }
  const previousFace = Object.getOwnPropertyDescriptor(globalThis, "FontFace");
  Object.defineProperty(globalThis, "FontFace", { value: Face, configurable: true });
  t.after(() => previousFace ? Object.defineProperty(globalThis, "FontFace", previousFace) : delete globalThis.FontFace);
  const context = () => ({ font: "", textBaseline: "", scale() {}, translate() {}, fillText() {},
    measureText(text) { const size = Number(this.font.match(/ ([\d.]+)px/)?.[1] ?? 32); return {
      width: text.length * size * .5, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * size * .5,
      actualBoundingBoxAscent: size * .8, actualBoundingBoxDescent: size * .2, fontBoundingBoxAscent: size * .8, fontBoundingBoxDescent: size * .2 }; },
    getImageData(_x, _y, w, h) { return { data: new Uint8Array(w * h * 4) }; } });
  const document = { baseURI: "https://local.test/", createElement: () => ({ getContext: context }),
    fonts: { [Symbol.iterator]: () => faces[Symbol.iterator](), add: face => faces.add(face), delete: face => faces.delete(face),
      load: async (font, text) => { loads.push({ font, text }); }, ready: Promise.resolve() } };
  const paragraph = () => ({ layout() {}, getLongestLine: () => 100, getAlphabeticBaseline: () => 30, delete() {} });
  class Paint { delete() {} setAlphaf() {} }
  class Font { constructor(_face, size) { this.size = size; } getGlyphIDs(text) { return [...text].map(() => 1); }
    getMetrics() { return { ascent: -this.size * .8, descent: this.size * .2 }; } delete() {} }
  const CK = { TypefaceFontProvider: { Make: () => ({ registerFont() {}, delete() {} }) },
    Typeface: { MakeFreeTypeFaceFromData: () => ({ delete() {} }) }, Font, Paint,
    TextStyle: class { constructor(style) { Object.assign(this, style); } }, ParagraphStyle: class {},
    ParagraphBuilder: { MakeFromFontProvider: () => ({ addText() {}, pushPaintStyle() {}, build: paragraph, delete() {} }) },
    FontWeight: { Normal: 400 }, FontWidth: { Normal: 0 }, FontSlant: { Upright: 0 },
    ColorType: { RGBA_8888: 0 }, AlphaType: { Unpremul: 0 }, ColorSpace: { SRGB: 0 },
    FilterMode: { Nearest: 0, Linear: 1 }, MipmapMode: { None: 0 }, XYWHRect: (...args) => args,
    MakeImage: () => ({ delete() { deletedImages.push(true); } }) };
  const descriptor = { id: "inter", kind: "font", family: "Inter", weight: 400, style: "normal" };
  const design = { nodes, resources: [descriptor] }, counters = { textLines: 0, rasterTextNodes: 0, nativeTextNodes: 0 };
  const text = await createCanvasKitText({ CK, design, document, resources: new Map([["inter", { bytes: new Uint8Array(), descriptor }]]),
    fallbackFontUrls: new Map(), counters, unsupportedNode() {}, makePaint: () => new Paint() });
  t.after(() => text.dispose());
  const canvas = { drawImageRectOptions() {}, drawParagraph() {} };
  return { text, design, faces, loads, counters, canvas, deletedImages, Face };
}

test("resource raster deduplicates font loads, invalidates late fonts, and falls back to native within its budget", async t => {
  const normal = node(), copy = node({ id: "copy", text: "Different characters" }), huge = node({ id: "huge", fontSize: 20000 });
  const h = await harness(t, [normal, copy, huge]);
  assert.equal(h.loads.length, 1, "one FontFaceSet load per family/style/weight, independent of node count and size");
  assert(h.loads[0].text.includes("D"), "dedup preserves the union of required characters");
  h.text.draw(h.canvas, normal);
  assert.equal(h.counters.rasterTextNodes, 1);
  assert.equal(h.counters.nativeTextNodes, 0);
  const before = h.text.stats(); assert(before.rasterTextImages > 0);
  assert.equal(h.text.beginScene(h.design), false);
  const late = new h.Face("LaterFont", new Uint8Array(), { weight: "400" });
  h.faces.add(late); await late.load();
  assert.equal(h.text.beginScene(h.design), true, "caller must rebuild retained pictures after late-font changes");
  assert.equal(h.text.stats().fontEpoch, 1);
  assert.equal(h.text.stats().rasterTextImages, 0);
  assert(h.deletedImages.length > 0);
  assert.equal(h.text.beginScene(h.design), false);
  h.text.draw(h.canvas, normal);
  h.text.draw(h.canvas, huge);
  const after = h.text.stats();
  assert.equal(h.counters.nativeTextNodes, 1, "oversized supplied text keeps native drawing available");
  assert.equal(after.resourceTextRasterFallbackCount, 1);
  assert.equal(after.resourceTextRasterFallbacks[0].nodeId, "huge");
  assert(after.rasterTextCacheBytes <= after.rasterTextCacheBudgetBytes);
});

test("finite resource text uses device coverage above 1x and restores native pixels at 1x", async t => {
  const finite = node({ layoutBaselineOffset: -3 }), huge = node({ id: "huge-finite", layoutBaselineOffset: 0, fontSize: 20000 });
  const h = await harness(t, [finite, huge]), before = JSON.stringify(h.design);
  h.text.draw(h.canvas, finite);
  assert.equal(h.counters.nativeTextNodes, 1);
  assert.equal(h.counters.rasterTextNodes, 0);
  const origins = new Map([[finite.id, { x: .25, y: .25 }]]);
  h.text.setDeviceSampling(origins, { scale: 1 });
  h.text.draw(h.canvas, finite);
  assert.equal(h.counters.nativeTextNodes, 2, "native <=1x baseline stays unchanged");
  h.text.setDeviceSampling(origins, { scale: 2 });
  h.text.draw(h.canvas, finite);
  assert.equal(h.counters.rasterTextNodes, 1, "same-family device image replaces native coverage above 1x");
  h.text.setDeviceSampling(origins, { scale: 1, retainOffscreen: true });
  h.text.draw(h.canvas, finite);
  assert.equal(h.counters.nativeTextNodes, 3, "returning to 1x removes the optional device variant");
  h.text.draw(h.canvas, huge);
  assert.equal(h.counters.nativeTextNodes, 4, "oversized optional finite device images preserve native fallback");
  assert.equal(h.text.stats().resourceTextRasterFallbacks[0].reason, "finite-device-raster-budget");
  assert.equal(JSON.stringify(h.design), before);
});
