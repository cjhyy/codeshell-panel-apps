import assert from "node:assert/strict";
import { test } from "node:test";
import { textLineBoxAlphabeticOffset, textLineBoxBaselineY, textFiniteBaselineY } from "../../../apps/design-studio/app/text-line-box.mjs";
import { browserPaintBoxes, blinkLayoutScale } from "../../../apps/design-studio/app/canvas/browser-paint-box.mjs";
import { textLineHeightPixels } from "../../../apps/design-studio/app/text-line-height.mjs";

/* Recorded layout from the snap-grid probe (docs/acceptance/design-studio-snap-grid-probe-20261107.md):
 * E1 = Electron 33 / Chromium 130 at real DPR 2, E4 = Chromium 148 --force-device-scale-factor=2,
 * E3 = Chromium 148 Playwright-emulated DSF 2. World units are CSS px before the camera transform. */
const text = (id, x, y, extra) => ({ id, type: "text", x, y, width: 104, height: 20, text: "Hg", fontFamily: "Arial", fontSize: 14,
  fontWeight: 400, lineHeight: 1.2, textAlign: "left", fill: "#1f2328", stroke: "transparent", strokeWidth: 0, opacity: 1, rotation: 0, ...extra });
const arial = text("arial-button", 270, 70, { fontWeight: 600, lineHeight: 1.4 });
const menlo = text("menlo-prompt", 230.25, 70.5, { fontFamily: "Menlo, monospace", fontSize: 13, width: 22 });
// Canvas fontBoundingBox metrics measured in every environment (P2): at the layout font size.
const METRICS = { arial: { 1: { ascent: 13, descent: 3 }, 2: { ascent: 25, descent: 6 } }, menlo: { 1: { ascent: 12, descent: 3 }, 2: { ascent: 24, descent: 6 } } };
const rect = { id: "small-rect", type: "rectangle", x: 28.3, y: 120.4, width: 1.26, height: 7.2, rotation: 0, cornerRadius: 0, fill: "#686e67", stroke: "transparent", strokeWidth: 0 };
const strip = { id: "gray-strip", type: "rectangle", x: 50.6, y: 109.42, width: 9.6, height: 1.12, rotation: 45, cornerRadius: 0.56, fill: "#6b7280", stroke: "transparent", strokeWidth: 0 };

test("real-DSF line boxes reproduce the recorded DOM baselines (E1/E4: Arial 84.5, Menlo 82.5)", () => {
  const arialOffset = textLineBoxAlphabeticOffset(arial, METRICS.arial[2], 2);
  const menloOffset = textLineBoxAlphabeticOffset(menlo, METRICS.menlo[2], 2);
  assert.equal(arialOffset, 14.5, "floor((39.2 + 25 - 6) / 2) = 29 physical px");
  assert.equal(menloOffset, 12, "floor((31.2 + 24 - 6) / 2) = 24 physical px");
  assert.equal(textLineBoxBaselineY(arial, 0, arialOffset, { layoutScale: 2 }), 84.5);
  assert.equal(textLineBoxBaselineY(menlo, 0, menloOffset, { layoutScale: 2 }), 82.5);
  // Second line accumulates the physical LayoutUnit line height before rounding.
  assert.equal(textLineBoxBaselineY(arial, 1, arialOffset, { layoutScale: 2 }), 84.5 + 19.5);
  // A cached local picture keeps its original origin; only the delta is carried.
  assert.equal(textLineBoxBaselineY({ ...arial, y: 80 }, 0, arialOffset, { originY: 70, layoutScale: 2 }), 94.5);
});

test("emulated DSF (layout scale 1) keeps the existing CSS-pixel line box exactly (E3: Arial 84, GPU Menlo 83)", () => {
  assert.equal(textLineBoxBaselineY(arial, 0, textLineBoxAlphabeticOffset(arial, METRICS.arial[1])), 84);
  assert.equal(textLineBoxBaselineY(menlo, 0, textLineBoxAlphabeticOffset(menlo, METRICS.menlo[1])), 83);
  // The default and explicit scale 1 are the legacy formula, bit for bit, across phases and line heights.
  const legacyOffset = (node, { ascent, descent }) => Math.floor((textLineHeightPixels(node) + Math.round(ascent) - Math.round(descent)) / 2);
  const legacyBaseline = (node, index, offset, originY = node.y) => Math.round(Math.trunc(originY * 64) / 64 + index * (Math.round(textLineHeightPixels(node) * 64) / 64) + offset) + (node.y - originY);
  for (const y of [-40.3, -0.01, 0, 0.25, 20.3, 70.5, 1033.77]) for (const lineHeight of [1, 1.15, 1.2, 1.4, 1.6]) for (const fontSize of [11, 13, 14, 32]) {
    const node = text("sweep", 0, y, { lineHeight, fontSize });
    const metrics = { ascent: fontSize * 0.905, descent: fontSize * 0.212 };
    const offset = legacyOffset(node, metrics);
    assert.equal(textLineBoxAlphabeticOffset(node, metrics), offset);
    assert.equal(textLineBoxAlphabeticOffset(node, metrics, 1), offset);
    for (const index of [0, 1, 5]) {
      assert.equal(textLineBoxBaselineY(node, index, offset), legacyBaseline(node, index, offset));
      assert.equal(textLineBoxBaselineY(node, index, offset, { layoutScale: 1 }), legacyBaseline(node, index, offset));
    }
  }
  // Finite imported text has no observed DSF dependency (E1/E3/E4 within 1/128); it stays unscaled.
  assert.equal(textFiniteBaselineY.length, 3);
});

test("real-DSF paint boxes snap on the 1/s CSS grid with a matching LayoutUnit pivot", () => {
  const result = browserPaintBoxes([rect, strip], { layoutScale: 2 });
  const r = result.nodes.get("small-rect");
  // Recorded E4 edges z1 77.599–79.607 / 261.601–275.603 device px = local 28.5–29.5 / 120.5–127.5.
  assert.deepEqual([r.x, r.y, r.width, r.height], [28.5, 120.5, 1, 7]);
  const s = result.nodes.get("gray-strip");
  assert.deepEqual([s.x, s.y, s.width, s.height], [50.5, 109.5, 9.5, 1]);
  assert.deepEqual(result.rotationPivots.get("gray-strip"), { x: 50.5 + 1228 / 256, y: 109.5 + 143 / 256 });
  assert.deepEqual(result.layoutBoxes.get("small-rect"), { x: 3622 / 128, y: 15411 / 128, width: 161 / 128, height: 921 / 128 });
  assert.equal(result.stats.fallback, 0);
});

test("layout scale 1 paint boxes are identical to the existing emulated/grid-1 result", () => {
  const nodes = [rect, strip, { ...rect, id: "neg", x: -3.3, y: -7.75 }, { ...rect, id: "frame", type: "frame", x: 100.35, y: 100.35, width: 100, height: 100, layout: "none" },
    { ...rect, id: "child", parentId: "frame", x: 100.5, y: 100.5 }];
  const legacy = browserPaintBoxes(nodes), explicit = browserPaintBoxes(nodes, { layoutScale: 1 });
  for (const key of ["stats", "fallbackReasons", "layoutBoxes", "rotationPivots"]) assert.deepEqual(explicit[key], legacy[key]);
  assert.deepEqual([...explicit.nodes], [...legacy.nodes]);
  const r = legacy.nodes.get("small-rect");
  assert.deepEqual([r.x, r.y, r.width, r.height], [28, 120, 2, 8], "E3 emulated: CSS-pixel edges");
  assert.throws(() => browserPaintBoxes(nodes, { layoutScale: 0 }), /layout scale/);
});

/** Minimal DOM double: `layout(requestedPx, dpr)` is the engine's measured left of the probe child. */
function fakeDocument({ dpr, layout }) {
  const window = { devicePixelRatio: dpr }, created = [];
  const element = () => ({ style: {}, children: [], parent: null,
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } },
    remove() { this.removed = true; },
    getBoundingClientRect() { return { left: this.parent?.parent ? layout(Number.parseFloat(this.style.left), window.devicePixelRatio) : 0 }; } });
  const document = { defaultView: window, documentElement: element(), createElement() { const value = element(); created.push(value); return value; } };
  return { document, window, created };
}
const realLayout = (requested, dpr) => Math.floor(requested * 64 * dpr) / (64 * dpr);
const emulatedLayout = requested => Math.floor(requested * 64) / 64;

test("one offscreen DOM probe detects the layout scale; cached per DPR, re-probed on DPR change", () => {
  for (const [layout, expected] of [[realLayout, 2], [emulatedLayout, 1]]) {
    const fake = fakeDocument({ dpr: 2, layout });
    const profile = blinkLayoutScale(fake.document);
    assert.equal(profile.scale, expected);
    assert.equal(profile.quantum, expected === 2 ? 1 / 128 : 0);
    const probes = fake.created.length;
    assert.ok(probes > 0 && fake.created.every(node => !node.parent || node.removed || node.parent.removed), "the probe leaves no element behind");
    assert.equal(blinkLayoutScale(fake.document), profile, "no re-probe while the DPR is unchanged");
    assert.equal(fake.created.length, probes);
    fake.window.devicePixelRatio = 1;
    assert.equal(blinkLayoutScale(fake.document).scale, 1);
    assert.ok(fake.created.length > probes, "a DPR change invalidates the profile");
  }
  assert.equal(blinkLayoutScale(fakeDocument({ dpr: 1.5, layout: realLayout }).document).scale, 1.5);
  // Anything other than the two recorded quanta is not guessed: scale 1 with an explicit reason.
  const odd = blinkLayoutScale(fakeDocument({ dpr: 2, layout: () => 0.003 }).document);
  assert.deepEqual(odd, { scale: 1, dpr: 2, quantum: 0.003, reason: "unrecognized-layout-quantum" });
  assert.deepEqual(blinkLayoutScale(null), { scale: 1, dpr: 1, quantum: null, reason: "no-document" });
});

test("real-DSF finite text: CSS-authored element top, physical line box (recorded forced-DSF2 DOM 156.195 -> paint 156; emulated 157)", () => {
  // Coverage fixture node; Arial 14 metrics as measured in both modes (Canvas fontBoundingBox, hanging offset 10.4).
  const finite = text("finite-multiline", 250.3, 146.3, { width: 200, height: 48, lineHeight: 1.3, layoutBaselineOffset: 3.5, text: "Finite\nSecond" });
  const metrics = { ascent: 13, descent: 3, hangingToAlphabetic: 10.399999618530273 }, layoutMetrics = { ascent: 25, descent: 6 };
  // Element top 142.7 (frontend export: hanging origin minus the CSS alphabetic offset 14); Blink then lays the
  // line out at fontSize x 2: floor((36.4 + 25 - 6) / 2) = 27 physical -> DOM baseline 18265/128 + 13.5 = 156.195.
  assert.equal(textFiniteBaselineY(finite, 0, metrics, { layoutScale: 2, layoutMetrics }), 156);
  assert.equal(textFiniteBaselineY(finite, 1, metrics, { layoutScale: 2, layoutMetrics }), 174.5);
  // Emulated (scale 1) is the historical CSS replay, unchanged: 9132/64 + 14 -> 157; next line +1165/64 -> 175.
  assert.equal(textFiniteBaselineY(finite, 0, metrics), 157);
  assert.equal(textFiniteBaselineY(finite, 1, metrics, { layoutScale: 1, layoutMetrics: metrics }), 175);
  // A single-line case where CSS and physical leading agree (lh 1.2) moves only by the physical paint rounding.
  const single = text("finite", 20.25, 70.5, { width: 184, layoutBaselineOffset: 3.5 });
  assert.equal(textFiniteBaselineY(single, 0, metrics, { layoutScale: 2, layoutMetrics }) % 0.5, 0);
});
