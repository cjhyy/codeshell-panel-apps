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
  const source = text({ layoutBaselineSource: "html" });
  assert.deepEqual(textHtmlFiniteLineBoxNode(source), { ...source, y: 40.3 - 3.5, layoutBaselineOffset: undefined, layoutBaselineSource: undefined },
    "absolute provenanced text: CSS top = y - layoutBaselineOffset");
  const typo = ranged([{ start: 0, end: 6, fontWeight: 700 }]);
  assert.deepEqual(textHtmlFiniteLineBoxNode(typo), { ...typo, layoutBaselineOffset: undefined, layoutBaselineSource: undefined },
    "absolute unprovenanced text: CSS top = y");
  const flow = textHtmlFiniteLineBoxNode(typo, { parent: { type: "frame", layout: "vertical" } });
  assert.equal(flow.y, 40.3 - 3.5, "a flow-owned CSS box starts at y - layoutBaselineOffset");
  assert.equal(textHtmlFiniteLineBoxNode(typo, { parent: { type: "frame", layout: "vertical" } , }).layoutBaselineOffset, undefined);
  assert.equal(textHtmlFiniteLineBoxNode({ ...typo, layoutPositioning: "absolute" }, { parent: { type: "frame", layout: "vertical" } }).y, 40.3);
  assert.deepEqual(plain, before);
});
