import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { importFigmaJson, prepareFigmaImport, normalizeHtml2FigmaJson } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { MAX_TEXT_RANGES, MAX_TEXT_RANGES_BYTES } from "../../../apps/design-studio/app/text-ranges.mjs";

const solid = (r, g, b) => [{ type: "SOLID", color: { r, g, b } }];
const style = () => ({ fontName: { family: "Arial", style: "Bold Italic" }, fontWeight: 700, fontSize: 14,
  fills: solid(1, 0, 0), textDecoration: "UNDERLINE", hyperlink: { type: "URL", value: "https://example.com/code" } });
const fixture = count => ({ type: "TEXT", id: "code", name: "Code", x: 0, y: 0, width: 800, height: 100,
  characters: "x".repeat(count), fontName: { family: "Inter", style: "Regular" }, fontWeight: 400, fontSize: 16,
  lineHeight: { unit: "PIXELS", value: 24 }, fills: solid(0, 0, 0), textDecoration: "NONE",
  styledTextSegments: Array.from({ length: count }, (_, i) => ({ start: i, end: i + 1, ...style() })) });
const sha256Bytes = async bytes => createHash("sha256").update(bytes).digest("hex");
const sourceText = source => Object.values(source.nodes)[0].document;

for (const count of [65, 96]) test(`${count} adjacent identical raw syntax runs coalesce losslessly into one editable Text`, async () => {
  const raw = fixture(count), before = JSON.stringify(raw), result = await prepareFigmaImport(raw, { sha256Bytes });
  assert.equal(JSON.stringify(raw), before);
  assert.equal(result.document.nodes.length, 1);
  const node = result.document.nodes[0];
  assert.equal(node.type, "text"); assert.equal(node.textSource, raw.characters);
  assert.deepEqual(node.textRanges.ranges, [{ start: 0, end: count, fontFamily: "Arial", fontSize: 14,
    fontWeight: 700, fontStyle: "italic", fill: "#ff0000", textDecoration: "underline", href: "https://example.com/code" }]);
  assert.deepEqual(sourceText(result.source).styledTextSegments, raw.styledTextSegments);
  const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(result.document)));
  assert.deepEqual(reopened.nodes[0].textRanges, node.textRanges);
});

test("coalescing never expands a hyperlink through an inherited gap or merges distinct admitted styles", () => {
  const raw = fixture(96); raw.styledTextSegments[48] = { start: 48, end: 49 };
  const result = importFigmaJson(raw), ranges = result.document.nodes[0].textRanges.ranges;
  assert.deepEqual(ranges.map(({ start, end, href }) => [start, end, href]), [
    [0, 48, "https://example.com/code"], [49, 96, "https://example.com/code"],
  ]);
  const distinct = fixture(65);
  distinct.styledTextSegments.forEach((range, index) => { range.hyperlink.value += `/${index}`; });
  assert.throws(() => importFigmaJson(distinct), { code: "TEXT_RANGES_INVALID" });
  const maximum = fixture(64);
  maximum.styledTextSegments.forEach((range, index) => { range.fontWeight = index % 2 ? 500 : 700; });
  assert.equal(importFigmaJson(maximum).document.nodes[0].textRanges.ranges.length, 64);
});

test("513 raw segments fail their independent count budget even when all styles could merge", () => {
  const raw = fixture(513), before = JSON.stringify(raw);
  assert.throws(() => importFigmaJson(raw), /512/u);
  assert.equal(JSON.stringify(raw), before);
});

test("raw UTF8 byte budget rejects before coalescing and canonical 32KiB remains enforced", () => {
  const raw = fixture(150); raw.styledTextSegments.forEach(range => { range.hyperlink.value = "https://example.com/" + "x".repeat(1800); });
  assert(new TextEncoder().encode(JSON.stringify(raw.styledTextSegments)).byteLength > 256 * 1024);
  assert.throws(() => importFigmaJson(raw), /256\s*KiB/u);
  const canonical = fixture(32);
  canonical.styledTextSegments.forEach((range, i) => { range.hyperlink.value = `https://example.com/${i}/` + "中".repeat(500); });
  assert(new TextEncoder().encode(JSON.stringify(canonical.styledTextSegments)).byteLength < 256 * 1024);
  assert.throws(() => importFigmaJson(canonical), { code: "TEXT_RANGES_INVALID" });
  assert.equal(MAX_TEXT_RANGES, 64); assert.equal(MAX_TEXT_RANGES_BYTES, 32 * 1024);
});

test("every raw range is validated before merging, including UTF16 boundaries and late overlap", () => {
  const unicode = fixture(96); unicode.characters = "😀".repeat(96);
  unicode.styledTextSegments.forEach((range, i) => { range.start = i * 2; range.end = i * 2 + 2; });
  const accepted = importFigmaJson(unicode).document.nodes[0];
  assert.equal(accepted.textSource, unicode.characters);
  assert.equal(accepted.textRanges.ranges[0].end, 192);
  unicode.styledTextSegments[95].start++;
  assert.throws(() => importFigmaJson(unicode), /UTF16/u);
  const overlap = fixture(96); overlap.styledTextSegments[95].start = 94;
  assert.throws(() => importFigmaJson(overlap), /styledTextSegments/u);
  assert.deepEqual(sourceText(normalizeHtml2FigmaJson(overlap)).styledTextSegments, overlap.styledTextSegments);
});
