import assert from "node:assert/strict";
import { test } from "node:test";
import { textHtmlFiniteHangingTransport, textHtmlFiniteLineBoxNode } from "../../../apps/design-studio/app/text-line-box.mjs";
import { textRangeSourceSignature } from "../../../apps/design-studio/app/text-ranges.mjs";

/* Range-final batch (A). HTML export transports imported finite text at its hanging origin only under
 * frontend-export's finiteTextPaintOffset conditions; every other finite node is laid out by HTML as a plain
 * CSS line box at the element top. The GPU used the hanging transport for all of them (finite + typography
 * ranges ~6 device px high; finite text with layoutBaselineSource 1-2 device px off). One shared predicate. */
const text = (extra = {}) => ({ id: "t", type: "text", x: 20.3, y: 40.3, width: 200, height: 24, text: "Finite Hg", fontFamily: "Inter",
  fontSize: 14, fontWeight: 400, lineHeight: 1.2, layoutBaselineOffset: 3.5, ...extra });
const ranged = (ranges, extra = {}) => text({ textRanges: { version: 1, sourceSignature: textRangeSourceSignature("Finite Hg"), ranges }, ...extra });

test("the HTML hanging transport predicate mirrors frontend-export eligibility", () => {
  assert.equal(textHtmlFiniteHangingTransport(text()), true, "absolute, unrotated, uniform typography, no provenance");
  assert.equal(textHtmlFiniteHangingTransport(text({ layoutBaselineOffset: undefined })), false, "line-box text has no finite origin");
  assert.equal(textHtmlFiniteHangingTransport(text({ layoutBaselineSource: "html" })), false, "provenanced coordinates already describe a CSS line box");
  assert.equal(textHtmlFiniteHangingTransport(text({ rotation: 15 })), false);
  assert.equal(textHtmlFiniteHangingTransport(ranged([{ start: 0, end: 6, fontWeight: 700 }])), false, "typography ranges: HTML lays the text out as a line box");
  assert.equal(textHtmlFiniteHangingTransport(ranged([{ start: 0, end: 6, fill: "#b42318" }])), true, "fill-only ranges keep the transport");
  assert.equal(textHtmlFiniteHangingTransport(text({ constraintVertical: "center" })), false);
  assert.equal(textHtmlFiniteHangingTransport(text({ constraintTop: 4 })), false);
  assert.equal(textHtmlFiniteHangingTransport(text({ constraintVertical: "center", constraintTop: 4 }), { infiniteRoot: true }), true,
    "an exported infinite-workspace root is pinned to start constraints");
  assert.equal(textHtmlFiniteHangingTransport(text(), { parent: { type: "frame", layout: "grid" } }), false);
  assert.equal(textHtmlFiniteHangingTransport(text(), { parent: { type: "frame", layout: "vertical" } }), true);
  assert.equal(textHtmlFiniteHangingTransport(text(), { parent: { type: "frame", layout: "none" } }), true);
});

test("non-transported finite text becomes the CSS line box HTML lays out, without mutating the document node", () => {
  const plain = text(), before = structuredClone(plain);
  assert.equal(textHtmlFiniteLineBoxNode(plain), plain, "transported finite text is returned untouched");
  const lineBox = text({ layoutBaselineOffset: undefined });
  assert.equal(textHtmlFiniteLineBoxNode(lineBox), lineBox);
  // Skip-ink batch: provenanced text (plain or typography) keeps the measured-offset transport: the import contract
  // makes it the DOM baseline (native line box and mixed-typography SVG pixel oracles).
  const source = text({ layoutBaselineSource: "html" });
  assert.equal(textHtmlFiniteLineBoxNode(source), source, "provenanced plain text keeps its contract transport");
  const sourceTypo = ranged([{ start: 0, end: 6, fontWeight: 700 }], { layoutBaselineSource: "native" });
  assert.equal(textHtmlFiniteLineBoxNode(sourceTypo), sourceTypo, "provenanced typography too");
  const typo = ranged([{ start: 0, end: 6, fontWeight: 700 }]);
  assert.deepEqual(textHtmlFiniteLineBoxNode(typo), { ...typo, layoutBaselineOffset: undefined, layoutBaselineSource: undefined },
    "absolute unprovenanced text: CSS top = y");
  const flow = textHtmlFiniteLineBoxNode(typo, { parent: { type: "frame", layout: "vertical" } });
  assert.equal(flow.y, 40.3 - 3.5, "a flow-owned CSS box starts at y - layoutBaselineOffset");
  assert.equal(textHtmlFiniteLineBoxNode(typo, { parent: { type: "frame", layout: "vertical" } , }).layoutBaselineOffset, undefined);
  assert.equal(textHtmlFiniteLineBoxNode({ ...typo, layoutPositioning: "absolute" }, { parent: { type: "frame", layout: "vertical" } }).y, 40.3);
  assert.deepEqual(plain, before);
});

/* Skip-ink batch (review I1/I2): SVG and derived ink bounds follow the same HTML view as the export and the GPU.
 * Predicted table: every value below is computed from the line-box formulas, never recorded from current output.
 * Metrics are supplied per node (ascent 13, descent 4, hanging-to-alphabetic 9.75); lh = 14 x 1.2 = 16.8. */
import { normalizeDesignDocument, exportDesignSvg } from "../../../apps/design-studio/app/document.mjs";
import { measuredTextInkBounds, textMetricsSignature } from "../../../apps/design-studio/app/text-metrics.mjs";
import { textFiniteBaselineY, textLineBoxAlphabeticOffset } from "../../../apps/design-studio/app/text-line-box.mjs";

const svgMetrics = { ascent: 13, descent: 4, hangingToAlphabetic: 9.75 };
const lh = 16.8, alpha = Math.floor((lh + 13 - 4) / 2); // CSS line box alphabetic offset = 12
const lineBoxY = (top, index) => Math.round(Math.trunc(top * 64) / 64 + index * Math.round(lh * 64) / 64 + alpha);
const base = { name: "t", stroke: "transparent", strokeWidth: 0, opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false, type: "text",
  width: 200, height: 40, fontFamily: "Inter", fontSize: 14, fontWeight: 400, lineHeight: 1.2, textAlign: "left", fill: "#000000" };
const frame = (id, extra) => ({ id, name: id, type: "frame", x: 0, y: 0, width: 600, height: 600, fill: "#ffffff", stroke: "transparent", strokeWidth: 0, opacity: 1,
  rotation: 0, cornerRadius: 0, visible: true, locked: false, layout: "none", layoutWrap: "none", gap: 0, padding: 0, alignItems: "start", justifyContent: "start", ...extra });
const svgYs = (svg, id) => [...(svg.match(new RegExp(`data-node-id="${id}"[^]*?</g>`))?.[0] ?? "").matchAll(/<text x="[^"]*" y="([^"]*)"/g)].map(m => Number(m[1]));

test("SVG text uses the HTML view: predicted per-branch baselines (transported and provenanced unchanged; rotated/constrained/grid/flow-typography as line boxes)", () => {
  const typoText = "Finite Bold";
  const typoReceiptNode = { ...base, id: "flow-typo", text: typoText, textRanges: { version: 1, sourceSignature: textRangeSourceSignature(typoText), ranges: [{ start: 7, end: 11, fontWeight: 700 }] } };
  const typoReceipt = { version: 1, signature: textMetricsSignature(typoReceiptNode), lineWidths: [80], lineInkBounds: [{ x: 0, y: 2, width: 80, height: 14 }], height: 16.8,
    fontAvailable: true, alphabeticBaseline: 12.5, lineHeights: [16.8], lineOffsets: [0] };
  const design = normalizeDesignDocument({ format: "codeshell.design", version: 3, name: "I1", canvas: { width: 600, height: 600, background: "#ffffff" }, tokens: { colors: [] },
    activePageId: "p", pages: [{ id: "p", name: "p", children: [frame("abs", { children: [
      { ...base, id: "transported", x: 20, y: 40.3, text: "Hanging Hg", layoutBaselineOffset: 3.5 },
      { ...base, id: "source", x: 20, y: 80.3, text: "Source Hg", layoutBaselineOffset: 3.5, layoutBaselineSource: "html" },
      { ...base, id: "source-multi", x: 20, y: 120.3, text: "One\nTwo Hg", layoutBaselineOffset: 3.5, layoutBaselineSource: "html", height: 50 },
      { ...base, id: "rotated", x: 20, y: 180.3, text: "Rotated", layoutBaselineOffset: 3.5, rotation: 15 },
      { ...base, id: "centered", x: 20, y: 220.3, text: "Centered", layoutBaselineOffset: 3.5, layoutPositioning: "absolute", constraintHorizontal: "start", constraintVertical: "center" },
    ] }), frame("grid", { y: 300, height: 100, layout: "grid", gridColumns: 1, gridRows: 1, gridColumnSizes: [{ type: "flex", value: 1 }], gridRowSizes: [{ type: "hug" }],
      columnGap: 0, rowGap: 0, children: [{ ...base, id: "grid-text", x: 0, y: 300.3, text: "Grid", layoutBaselineOffset: 3.5 }] }),
    frame("flow", { y: 420, height: 160, layout: "vertical", children: [
      { ...base, id: "flow-source", x: 0, y: 423.5, text: "Flow\nsource", layoutBaselineOffset: 3.5, layoutBaselineSource: "html", height: 40 },
      { ...typoReceiptNode, x: 0, y: 467.5, layoutBaselineOffset: 3.5, textMetrics: typoReceipt },
    ] })] }] });
  const byId = new Map(design.nodes.map(n => [n.id, n]));
  const ids = ["transported", "source", "source-multi", "rotated", "centered", "grid-text", "flow-source", "flow-typo"];
  // flow-typo has a bold run: a plain value only measures the node's own font (SVG warning egress fix), so its runs
  // get a per-run resolver (same metrics for every run here); the plain-value case is unmeasured (svg-warning-egress).
  const svg = exportDesignSvg(design, { textLineBoxMetrics: new Map(ids.map(id => [id, id === "flow-typo" ? () => svgMetrics : svgMetrics])) });
  const table = ids.map(id => { const n = byId.get(id), lines = String(n.text).split("\n").length;
    // Layout-owned boxes (vertical flow and grid cells alike) start at y - offset. Provenanced plain text keeps the
    // contract transport (unchanged output): source, source-multi and flow-source are negative controls.
    const transport = ["transported", "source", "source-multi", "flow-source"].includes(id);
    // Cross-surface batch (review I1): non-provenanced flow typography is the HTML line box at y - offset, with the
    // mixed-font line box (supplied metrics: alpha floor((16.8 + 13 - 4) / 2) = 12), as GPU and DOM: 467.5 - 3.5 + 12 -> 476.
    const shift = ["grid-text", "flow-typo"].includes(id) ? 3.5 : 0;
    const old = id === "flow-typo" ? [n.y + 12.5] : Array.from({ length: lines }, (_, i) => textFiniteBaselineY(n, i, svgMetrics));
    const predicted = transport ? old : Array.from({ length: lines }, (_, i) => lineBoxY(n.y - shift, i));
    return { id, y: n.y, shift, old, predicted, actual: svgYs(svg, id) }; });
  for (const row of table) assert.deepEqual(row.actual.map(v => Math.round(v * 1000) / 1000), row.predicted.map(v => Math.round(v * 1000) / 1000), JSON.stringify(row));
  assert.equal(textLineBoxAlphabeticOffset({ ...base, lineHeight: 1.2 }, svgMetrics), alpha);
});

test("an infinite-canvas root keeps the hanging transport in SVG even with a non-start constraint (export pins roots to start)", () => {
  const design = normalizeDesignDocument({ format: "codeshell.design", version: 3, name: "I1 infinite", canvas: { width: 600, height: 300, background: "#ffffff", mode: "infinite" },
    tokens: { colors: [] }, activePageId: "p", pages: [{ id: "p", name: "p", children: [{ ...base, id: "root", x: 20, y: 40.3, text: "Root Hg", layoutBaselineOffset: 3.5, layoutPositioning: "absolute", constraintHorizontal: "start", constraintVertical: "center" }] }] });
  const n = design.nodes.find(node => node.id === "root");
  const svg = exportDesignSvg(design, { textLineBoxMetrics: new Map([["root", svgMetrics]]) });
  assert.deepEqual(svgYs(svg, "root"), [textFiniteBaselineY(n, 0, svgMetrics)]);
});

test("derived ink bounds per branch: transported/provenanced receipts keep their origin; line-box views (plain or typography) are not certified", () => {
  const receipt = node => ({ version: 1, signature: textMetricsSignature(node), lineWidths: [60], lineInkBounds: [{ x: 0, y: 2, width: 60, height: 14 }], height: 16.8, fontAvailable: true });
  const plain = { ...base, id: "a", x: 0, y: 40.3, text: "Ink Hg", layoutBaselineOffset: 3.5 };
  const transported = { ...plain, textMetrics: receipt(plain) };
  assert.deepEqual(measuredTextInkBounds(transported), { x: 0, y: 2, width: 60, height: 14 }, "transported: unchanged");
  const source = { ...plain, layoutBaselineSource: "html" };
  assert.deepEqual(measuredTextInkBounds({ ...source, textMetrics: receipt(source) }), { x: 0, y: 2, width: 60, height: 14 },
    "provenanced: the import measured layoutBaselineOffset = line-box offset of the hanging origin, so the receipt origin is the HTML one");
  const rotated = { ...plain, rotation: 15 };
  assert.equal(measuredTextInkBounds({ ...rotated, textMetrics: receipt(rotated) }), null, "rotated, unprovenanced: no line-box metrics in a hanging receipt");
  assert.equal(measuredTextInkBounds({ ...plain, textMetrics: receipt(plain) }, { parent: { type: "frame", layout: "grid" } }), null, "grid child: likewise");
  const typoText = "Ink Hg";
  const typo = { ...plain, textRanges: { version: 1, sourceSignature: textRangeSourceSignature(typoText), ranges: [{ start: 0, end: 3, fontWeight: 700 }] } };
  const typoReceipt = { ...receipt(typo), alphabeticBaseline: 12.5, lineHeights: [16.8], lineOffsets: [0] };
  // Cross-surface batch (review I1): a finite typography receipt is measured at the hanging origin; HTML/GPU/SVG paint
  // the line box, so the receipt geometry is not certified (callers estimate at the view origin).
  assert.equal(measuredTextInkBounds({ ...typo, textMetrics: typoReceipt }), null, "absolute typography: line-box view, receipt not certified");
  assert.equal(measuredTextInkBounds({ ...typo, textMetrics: typoReceipt }, { parent: { type: "frame", layout: "vertical" } }), null, "flow typography likewise");
  const provTypo = { ...typo, layoutBaselineSource: "html" };
  assert.deepEqual(measuredTextInkBounds({ ...provTypo, textMetrics: { ...typoReceipt, signature: textMetricsSignature(provTypo) } }), { x: 0, y: 2, width: 60, height: 14 },
    "provenanced typography keeps its contract receipt (negative control)");
  assert.deepEqual(transported.textMetrics.lineInkBounds, [{ x: 0, y: 2, width: 60, height: 14 }], "receipts are never rewritten");
});
