import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { normalizeDesignDocument, serializeDesignDocument, exportDesignSvg } from "../../../apps/design-studio/app/document.mjs";
import { textRangeSourceSignature } from "../../../apps/design-studio/app/text-ranges.mjs";

export function importedTextFixture() {
  return { format: "codeshell.design", version: 3, name: "Imported hanging compatibility",
    canvas: { width: 520, height: 320, background: "#ffffff" }, tokens: { colors: [] }, resources: [], activePageId: "page",
    pages: [{ id: "page", name: "Page", children: [0, 5.25, -3].map((offset, index) => ({
      id: `text-${index}`, type: "text", name: `Text ${index}`, x: 24.25, y: 20.75 + index * 90,
      width: 470, height: 80, fill: "#111111", stroke: "transparent", strokeWidth: 0,
      opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false,
      text: "Imported 中文 HMI\nSecond line", textSource: "Imported 中文 HMI\nSecond line",
      fontFamily: "Arial", fontSize: 20, fontWeight: 400, fontStyle: "normal", letterSpacing: .25,
      lineHeight: [1, 1.6, 2][index], textAlign: ["left", "center", "right"][index], layoutBaselineOffset: offset,
      ...(index === 1 ? { textRanges: { version: 1, sourceSignature: textRangeSourceSignature("Imported 中文 HMI\nSecond line"), ranges: [{ start: 0, end: 8, fill: "#cc2233" }] } } : {}),
    })) }] };
}
const sha256 = value => createHash("sha256").update(value).digest("hex");
// Digests produced by the immutable 7864c26b app source, before B1 changes.
const BASE_SVG_SHA256 = "72adbc656104555c7e50a0792d427d0865b93f07cb0fffa6a7e04d92105ed118";
const BASE_SERIALIZED_SHA256 = "05ea4b82296668cb28fabfabda31a6646f221ac9b25731981a2f94429286e39d";
test("finite positive, negative and zero offsets preserve the exact base SVG and serialized document", () => {
  const input = importedTextFixture(), original = JSON.stringify(input);
  const document = normalizeDesignDocument(input), saved = serializeDesignDocument(document);
  assert.equal(sha256(exportDesignSvg(document)), BASE_SVG_SHA256);
  assert.equal(sha256(saved), BASE_SERIALIZED_SHA256);
  assert.equal(serializeDesignDocument(normalizeDesignDocument(JSON.parse(saved))), saved);
  assert.equal(JSON.stringify(input), original);
});
