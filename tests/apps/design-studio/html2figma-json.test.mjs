import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { importFigmaJson, prepareFigmaImport, normalizeHtml2FigmaJson } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { exportDesignSvg, serializeDesignDocument, normalizeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { createFigmaBinding, createFigmaPatch, parseFigmaBinding } from "../../../apps/design-studio/app/figma-binding.mjs";
import { transformedNodeBoundsInTree } from "../../../apps/design-studio/app/geometry.mjs";

const solid = (r, g, b) => [{ type: "SOLID", color: { r, g, b } }];
const rectangle = (id, extra = {}) => ({ id, name: id, type: "RECTANGLE", x: 20, y: 30, width: 100, height: 60, fills: solid(1, 0, 0), ...extra });
const text = (extra = {}) => rectangle("text", { type: "TEXT", width: 220, height: 60,
  characters: "Hello world", fontName: { family: "Arial", style: "Bold Italic" }, fontSize: 24,
  lineHeight: { value: 30, unit: "PIXELS" }, letterSpacing: { value: 5, unit: "PERCENT" },
  textAlignHorizontal: "CENTER", textDecoration: "UNDERLINE", ...extra });
const frame = (children, extra = {}) => rectangle("root", { type: "FRAME", x: 40, y: 50, width: 400, height: 300, children, ...extra });
const sha256Bytes = async (bytes) => createHash("sha256").update(bytes).digest("hex");

test("raw plugin FigmaJSON uses nested parent coordinates and complete top-level typography without mutation", () => {
  const raw = frame([frame([text()], { id: "inner", x: 12, y: 18, width: 300, height: 200 })]),
    before = JSON.stringify(raw), result = importFigmaJson(raw),
    [root, inner, label] = result.document.nodes;
  assert.equal(JSON.stringify(raw), before);
  assert.deepEqual([root.x, root.y, inner.x, inner.y, label.x, label.y], [40, 50, 52, 68, 72, 98]);
  assert.equal(label.parentId, inner.id);
  assert.deepEqual([label.fontFamily, label.fontSize, label.fontWeight, label.fontStyle], ["Arial", 24, 700, "italic"]);
  assert.deepEqual([label.lineHeight, label.lineHeightUnit, label.letterSpacing, label.textAlign, label.textDecoration], [30, "pixels", 1.2, "center", "underline"]);
  assert.equal(result.stats.warningCount, 0);
});

test("arrays and nodes-array wrappers admit plugin roots while REST geometry and style retain priority", () => {
  const plugin = rectangle("plugin");
  for (const input of [[plugin], { nodes: [plugin] }, JSON.stringify({ nodes: [plugin] })])
    assert.deepEqual(importFigmaJson(input).document.nodes.map((node) => [node.x, node.y]), [[20, 30]]);
  const official = { ...text(), absoluteBoundingBox: { x: 80, y: 90, width: 200, height: 60 },
    style: { fontFamily: "Inter", fontSize: 18, fontWeight: 500 } };
  assert.equal(normalizeHtml2FigmaJson(official), official);
  const label = importFigmaJson(official).document.nodes[0];
  assert.deepEqual([label.x, label.y, label.fontFamily, label.fontSize, label.fontWeight], [80, 90, "Inter", 18, 500]);
  assert.equal(importFigmaJson({ type: "FRAME", id: "rest-no-geometry", children: [] }).warnings[0].code, "missing-geometry");
});

test("plugin degrees use Figma counter-clockwise rotation and percent/auto line height", () => {
  const source = normalizeHtml2FigmaJson(rectangle("rotated", { rotation: 90 })),
    normalized = Object.values(source.nodes)[0].document;
  assert.ok(Math.abs(normalized.relativeTransform[1][0] + 1) < 1e-12);
  const rotated = importFigmaJson(rectangle("rotated", { rotation: 90 })).document.nodes[0];
  assert.equal(rotated.rotation, -90);
  assert.equal(rotated.width, 100);
  const percentage = importFigmaJson(text({ fontWeight: "600", lineHeight: { unit: "PERCENT", value: 150 } })).document.nodes[0];
  assert.equal(percentage.lineHeight, 1.5);
  assert.equal(percentage.fontWeight, 600);
  assert.equal(importFigmaJson(text({ lineHeight: { unit: "AUTO" } })).document.nodes[0].lineHeight, 1.2);
  const nested = importFigmaJson(frame([rectangle("rotated-child")], { x: 400, y: 600, rotation: 90 }));
  const child = nested.document.nodes[1], bounds = transformedNodeBoundsInTree(nested.document.nodes, child);
  for (const [key, expected] of Object.entries({ x: 430, y: 480, width: 60, height: 100 }))
    assert.ok(Math.abs(bounds[key] - expected) < 1e-8, `${key}: ${bounds[key]} vs ${expected}`);
});

test("plugin Auto Layout, absolute children, stroke and linear paint stack preserve supported fields", () => {
  const gradient = { type: "GRADIENT_LINEAR", gradientTransform: [[1, 0, 0], [0, 1, 0]],
    gradientStops: [{ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }] };
  const source = frame([rectangle("child", { x: 16, y: 16, layoutPositioning: "ABSOLUTE", layoutSizingHorizontal: "FIXED" })],
    { layoutMode: "HORIZONTAL", itemSpacing: 12, paddingLeft: 16, paddingTop: 16, primaryAxisAlignItems: "SPACE_BETWEEN",
      counterAxisAlignItems: "CENTER", layoutWrap: "WRAP", clipsContent: true,
      fills: [gradient], strokes: solid(0, 0, 1), strokeWeight: 2, strokeAlign: "CENTER" });
  const result = importFigmaJson(source), [root, child] = result.document.nodes;
  assert.deepEqual([root.layout, root.layoutWrap, root.gap, root.paddingLeft, root.paddingTop, root.justifyContent, root.alignItems, root.clipContent],
    ["horizontal", "wrap", 12, 16, 16, "space-between", "center", true]);
  assert.equal(root.fillPaints[0].type, "GRADIENT_LINEAR");
  assert.deepEqual([root.stroke, root.strokeWidth, child.layoutPositioning, child.layoutSizingHorizontal, child.x, child.y],
    ["#0000ff", 2, "absolute", "fixed", 56, 66]);
});

test("supported styledTextSegments become editable color/decoration/link ranges and survive saving", () => {
  const raw = text({ fontName: { family: "Arial", style: "Regular" }, fontSize: 16, textDecoration: "NONE",
    styledTextSegments: [{ start: 0, end: 5, fills: solid(0, 0, 1), textDecoration: "UNDERLINE", hyperlink: { type: "URL", value: "https://example.com/hello" } },
      { start: 6, end: 11, fills: solid(0, 0.5, 0) }] });
  const result = importFigmaJson(raw), label = result.document.nodes[0];
  assert.deepEqual(label.textRanges.ranges, [{ start: 0, end: 5, fill: "#0000ff", textDecoration: "underline", href: "https://example.com/hello" },
    { start: 6, end: 11, fill: "#008000" }]);
  const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(result.document)));
  assert.deepEqual(reopened.nodes[0].textRanges, label.textRanges);
  assert.match(exportDesignSvg(reopened), /#0000ff/u);
  assert.equal(result.warnings.length, 0);
});

test("mixed font size and named faces remain one editable Text with explicit typography ranges", () => {
  const raw = text({ styledTextSegments: [{ start: 0, end: 5, fontSize: 10.6667, fontName: { family: "Inter", style: "Medium" }, fills: solid(0, 0, 1) }] });
  const result = importFigmaJson(raw), label = result.document.nodes[0];
  assert.deepEqual(label.textRanges.ranges[0], { start: 0, end: 5, fontFamily: "Inter", fontSize: 10.6667, fontWeight: 500, fontStyle: "normal", fill: "#0000ff" });
  assert.equal(result.warnings.length, 0);
  assert.equal(result.document.nodes.length, 1);
});

test("unsupported range line height is reported rather than silently claimed preserved; invalid ranges fail", () => {
  const raw = text({ styledTextSegments: [{ start: 0, end: 5, lineHeight: { unit: "PIXELS", value: 64 }, fills: solid(0, 0, 1) }] });
  const result = importFigmaJson(raw);
  assert.equal(result.document.nodes[0].fontSize, 24);
  assert.equal(result.document.nodes[0].textRanges.ranges[0].fill, "#0000ff");
  assert.equal(result.warnings[0].code, "rich-text");
  assert.deepEqual(Object.values(normalizeHtml2FigmaJson(raw).nodes)[0].document.styledTextSegments, raw.styledTextSegments);
  for (const segments of [[{ start: -1, end: 3 }], [{ start: 0, end: 12 }], [{ start: 0, end: 5 }, { start: 4, end: 7 }]])
    assert.throws(() => importFigmaJson(text({ styledTextSegments: segments })), /styledTextSegments/u);
  assert.throws(() => importFigmaJson(text({ characters: "😀a", styledTextSegments: [{ start: 1, end: 2 }] })), /UTF16/u);
});

test("async UI preparation stores embedded images and SVG resources and preserves complete plugin input", async () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const raw = frame([rectangle("image", { fills: [{ type: "IMAGE", scaleMode: "FIT", _pendingImageUrl: "https://example.com/photo.png" }], imageMetadata: { base64: png } }),
    rectangle("vector", { type: "SVG", svgContent: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="red"/></svg>' })]);
  const result = await prepareFigmaImport(raw, { sha256Bytes });
  assert.equal(result.document.nodes.filter((node) => node.type === "image").length, 2);
  assert.deepEqual(result.document.resources.map((resource) => resource.mime).sort(), ["image/png", "image/svg+xml"]);
  assert.equal(result.resourcePlans.length, 2);
  const source = Object.values(result.source.nodes)[0].document;
  assert.equal(source.children[0].imageMetadata.base64, png);
  assert.match(source.children[1].svgContent, /<svg/u);
  assert.ok(result.warnings.some((warning) => warning.code === "plugin-export-warning"));
});

test("raw plugin normalization bounds malformed, cyclic and mixed-format trees", () => {
  assert.throws(() => importFigmaJson({ nodes: [] }), /html2figma/u);
  assert.throws(() => importFigmaJson({ nodes: [rectangle("a"), { type: "FRAME", absoluteBoundingBox: {} }] }), /完整相对几何/u);
  assert.throws(() => importFigmaJson(frame([{ type: "TEXT" }])), /图层几何/u);
  const raw = frame([]); raw.children.push(raw);
  assert.throws(() => importFigmaJson(raw), /循环/u);
});

test("no-op visual ranges are omitted and relative links resolve only against an explicit source URL", () => {
  const source = text({ fontName: { family: "Arial", style: "Regular" }, fontSize: 16,
    styledTextSegments: [{ start: 0, end: 5, fills: solid(1, 0, 0), textDecoration: "UNDERLINE" }] });
  assert.equal(importFigmaJson(source).document.nodes[0].textRanges, undefined);
  const linked = text({ styledTextSegments: [{ start: 0, end: 5, hyperlink: { type: "URL", value: "item?id=123" } }] });
  const withoutBase = importFigmaJson(linked);
  assert.equal(withoutBase.document.nodes[0].textRanges, undefined);
  assert.equal(withoutBase.warnings[0].code, "html2figma-link");
  const withBase = importFigmaJson({ nodes: [linked], sourceUrl: "https://news.ycombinator.com/" });
  assert.equal(withBase.document.nodes[0].textRanges.ranges[0].href, "https://news.ycombinator.com/item?id=123");
  assert.equal(linked.styledTextSegments[0].hyperlink.value, "item?id=123");
  assert.throws(() => importFigmaJson({ nodes: [linked], sourceUrl: "file:///etc/passwd" }), /sourceUrl/u);
});

test("explicit full font assets become exact resource faces and retained source, with no family substitution", async () => {
  const bytes = await readFile(new URL("../../../apps/design-studio/app/fonts/InterVariable.woff2", import.meta.url));
  const fontAssets = { "private-inter": { family: "Inter", weight: 400, style: "normal", mime: "font/woff2", base64: bytes.toString("base64") } };
  const input = { nodes: [frame([text({ id: "matched", name: "matched", fontName: { family: "Inter", style: "Regular" }, fontWeight: 400 }),
    text({ id: "wrong-weight", name: "wrong-weight", fontName: { family: "Inter", style: "Bold" }, fontWeight: 700 }),
    text({ id: "other-family", name: "other-family", fontName: { family: "Arial", style: "Regular" }, fontWeight: 400 })])], fontAssets };
  const result = await prepareFigmaImport(input, { sha256Bytes });
  assert.equal(result.document.nodes.find((node) => node.name === "matched").fontRef, "html2figma-private-inter");
  assert.equal(result.document.nodes.find((node) => node.name === "wrong-weight").fontRef, undefined);
  assert.equal(result.document.nodes.find((node) => node.name === "other-family").fontRef, undefined);
  const font = result.document.resources[0];
  assert.deepEqual([font.kind, font.family, font.weight, font.style, font.sha256], ["font", "Inter", 400, "normal", await sha256Bytes(bytes)]);
  assert.deepEqual(Object.values(result.source.nodes)[0].document.codeshellHtml2FigmaFontAssets, fontAssets);
  assert.equal(result.resourcePlans[0].parts.map((part) => part.content).join(""), bytes.toString("base64"));
  await assert.rejects(prepareFigmaImport({ ...input, fontAssets: { "../font": fontAssets["private-inter"] } }, { sha256Bytes }), /fontAssets/u);
});


test("raw plugin imports retain far negative world coordinates in infinite mode through binding and reopen", async () => {
  const source = frame([rectangle("child", { x: 12, y: 18 })], { x: 65000, y: -35000 });
  const before = structuredClone(source), prepared = await prepareFigmaImport(source, { canvasMode: "infinite" });
  assert.deepEqual(source, before);
  assert.equal(prepared.document.canvas.mode, "infinite");
  assert.deepEqual(prepared.document.nodes.map(node => [node.x, node.y]), [[65000, -35000], [65012, -34982]]);
  assert(!prepared.warnings.some(warning => ["bounded-number", "canvas-extent"].includes(warning.code)));
  const retained = Object.values(prepared.source.nodes)[0].document;
  assert.deepEqual(retained.relativeTransform, [[1, 0, 65000], [0, 1, -35000]]);
  const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(prepared.document)));
  assert.deepEqual(reopened.nodes, prepared.document.nodes);
  const binding = parseFigmaBinding(JSON.stringify(createFigmaBinding(prepared)));
  assert.deepEqual(Object.values(binding.source.nodes)[0].document.relativeTransform, retained.relativeTransform);
  assert.deepEqual(createFigmaPatch(binding, reopened).operations, []);
});
