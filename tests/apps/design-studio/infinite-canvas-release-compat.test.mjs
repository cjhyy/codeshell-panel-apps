import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeDesignDocument, designPageBounds, exportDesignSvg } from "../../../apps/design-studio/app/document.mjs";
import { textRangeSourceSignature } from "../../../apps/design-studio/app/text-ranges.mjs";

const node = properties => ({ id: "world-node", type: "rectangle", name: "World node",
  x: -500, y: 300, width: 100, height: 80, fill: "transparent", stroke: "transparent",
  strokeWidth: 0, opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false,
  ...properties });
const document = child => normalizeDesignDocument({ format: "codeshell.design", version: 3,
  name: "Mainline and infinite canvas compatibility",
  canvas: { mode: "infinite", width: 800, height: 600, background: "#ffffff" },
  tokens: { colors: [] }, activePageId: "page-1",
  pages: [{ id: "page-1", name: "World", children: [child] }] });

test("infinite natural text bounds preserve mainline pixel line height rather than multiplying it by font size", () => {
  const value = document(node({ type: "text", fill: "#000000", text: "First\nSecond", height: 20,
    fontFamily: "Roboto", fontSize: 20, fontWeight: 400,
    lineHeight: 100, lineHeightUnit: "pixels", textAlign: "left" }));
  assert.deepEqual(designPageBounds(value), { x: -520, y: 280, width: 120, height: 160 });
  const svg = exportDesignSvg(value);
  assert.match(svg, /y="400"[^>]+>Second<\/text>/u);
  assert.match(svg, /viewBox="-520 280 120 160"/u);
});

test("infinite content bounds include transparent mainline surfaces painted only by independent outside strokes", () => {
  const value = document(node({ strokeAlign: "outside",
    strokeSides: Array.from({ length: 4 }, () => ({ width: 10, color: "#3366cc", opacity: 1 })) }));
  assert.deepEqual(designPageBounds(value), { x: -510, y: 290, width: 120, height: 100 });
  assert.match(exportDesignSvg(value), /#3366cc/u);
});

test("infinite content bounds include transparent CSS-box shadow stacks with their actual outer effect extent", () => {
  const value = document(node({ shadowStack: { basis: "css-box", layers: [
    { kind: "outer", color: "#000000", opacity: 0.5, x: 20, y: 0, blur: 10, spread: 0, visible: true },
  ] } }));
  assert.deepEqual(designPageBounds(value), { x: -515, y: 285, width: 150, height: 110 });
  assert.match(exportDesignSvg(value), /css-shadow-0/u);
});

test("infinite content bounds retain mainline text-range fill when the base text paint is transparent", () => {
  const text = "Range";
  const value = document(node({ type: "text", text, height: 30, fontFamily: "Roboto",
    fontSize: 20, fontWeight: 400, lineHeight: 1.2, textAlign: "left",
    textRanges: { version: 1, sourceSignature: textRangeSourceSignature(text), ranges: [
      { start: 0, end: text.length, fill: "#3366cc" },
    ] } }));
  const bounds = designPageBounds(value);
  assert.ok(bounds.x <= -500 && bounds.x + bounds.width >= -400, JSON.stringify(bounds));
  assert.match(exportDesignSvg(value), /fill:#3366cc/u);
});
