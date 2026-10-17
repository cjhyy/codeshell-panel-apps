import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gradientMatrix } from "../../../apps/design-studio/app/paint.mjs";
import {
  GRIDA_ENCODER_SOURCE_COMMIT,
  toGridaDocument,
} from "../../../scripts/design-renderer-compare/grida-scene.mjs";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const artifacts = resolve(repositoryRoot, "artifacts/design-renderer-compare");
const vendor = resolve(artifacts, "vendor/grida");
const sourceDirectory = resolve(artifacts, "encoder-source", GRIDA_ENCODER_SOURCE_COMMIT);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const originalImageId = "fixture image:#1";
const projectedImageId = "res://codeshell-images/fixture%20image%3A%231";
const closeTo = (actual, expected) => assert.ok(
  Math.abs(actual - expected) < 1e-5,
  `Expected ${actual} to be within 1e-5 of ${expected}`,
);
const base = (id, type, properties = {}) => ({
  id, name: id, type, x: 0, y: 0, width: 100, height: 40,
  fill: "#445566", stroke: "#112233", strokeWidth: 1.5, cornerRadius: 0,
  opacity: 1, rotation: 0, visible: true, locked: false, ...properties,
});
const gradient = {
  type: "GRADIENT_LINEAR", opacity: 0.75,
  handles: [{ x: 0.2, y: 0.1 }, { x: 0.9, y: 0.7 }, { x: 0.1, y: 0.8 }],
  stops: [{ position: 0, color: "#cc3300", opacity: 0.4 },
    { position: 0.8, color: "#0066ff", opacity: 1 }],
};

function fixture() {
  return {
    canvas: { width: 640, height: 480, background: "#fefefe" },
    nodes: [
      base("frame:root", "frame", { x: 100, y: 80, width: 400, height: 300,
        clipContent: true, cornerRadius: 10, opacity: 0.75, rotation: 12,
        shadow: { color: "#000000", opacity: 0.3, x: 2, y: 4, blur: 8 } }),
      base("frame:nested", "frame", { parentId: "frame:root", x: 130, y: 110,
        width: 200, height: 180, cornerRadius: 6, clipContent: false }),
      base("text:文字", "text", { parentId: "frame:nested", x: 145, y: 122,
        width: 150, height: 60, text: "Hello\n世界 👋", fontFamily: '"Roboto", sans-serif',
        fontSize: 20, fontWeight: 700, fontStyle: "italic", textAlign: "center",
        textDecoration: "underline", letterSpacing: 1.5, lineHeight: 1.4 }),
      base("rect:gradient", "rectangle", { parentId: "frame:nested", x: 155, y: 190,
        width: 140, height: 30, cornerRadius: 5,
        fillPaints: [{ type: "SOLID", color: "#abcdef", opacity: 0.2 }, gradient] }),
      base("image:1", "image", { parentId: "frame:root", x: 350, y: 120,
        width: 80, height: 60, imageRef: originalImageId, objectFit: "contain" }),
      base("text:system", "text", { parentId: "frame:nested", x: 150, y: 230,
        width: 100, height: 40, text: "System A\n字体", fontFamily: "Arial, sans-serif",
        fontSize: 16, fontWeight: 400, textAlign: "left", lineHeight: 1.2,
        opacity: 0.6 }),
    ],
  };
}

async function project(design = fixture()) {
  const rasterCalls = [];
  const result = await toGridaDocument(design, {
    registeredFontFamilies: new Set(["Roboto"]),
    resources: new Map([[originalImageId, { bytes: new Uint8Array([1, 2, 3]) }]]),
    rasterizeText: async (node) => {
      rasterCalls.push(node.id);
      // Cached image bounds are local to the original text layer, including ink padding.
      return { x: -3, y: -4, width: 106, height: 48, bytes: new Uint8Array([4, 5, 6]) };
    },
  });
  return { ...result, rasterCalls };
}

test("Grida projection preserves source IDs, original text and nested geometry without changing the document", async () => {
  const design = fixture();
  const original = structuredClone(design);
  const { document, stats, rasterCalls, images } = await project(design);
  assert.deepEqual(design, original);
  assert.ok(design.nodes.every((node) => Object.hasOwn(document.nodes, node.id)));
  assert.equal(Object.keys(document.nodes).length, design.nodes.length + stats.auxiliaryNodes);
  assert.deepEqual(document.links["frame:root"], ["frame:nested", "image:1"]);
  assert.deepEqual(document.links["frame:nested"], ["text:文字", "rect:gradient", "text:system"]);
  const frame = document.nodes["frame:nested"];
  assert.equal(frame.layout_inset_left, 30);
  assert.equal(frame.layout_inset_top, 30);
  const text = document.nodes["text:文字"];
  assert.equal(text.layout_inset_left, 15);
  assert.equal(text.layout_inset_top, 12);
  assert.equal(text.text, original.nodes[2].text);
  assert.equal(text.font_family, "Roboto");
  assert.equal(text.font_weight, 700);
  assert.equal(text.font_style_italic, true);
  assert.equal(text.text_align, "center");
  assert.equal(text.text_decoration_line, "underline");
  assert.equal(text.line_height, 1.4);
  assert.equal(text.letter_spacing, 1.5 / 20);
  assert.equal(document.nodes["frame:root"].opacity, 0.75);
  assert.equal(document.nodes["frame:root"].rotation, 12);
  assert.equal(document.nodes["frame:root"].clips_content, true);
  assert.equal(document.nodes["frame:root"].fe_shadows[0].blur, 4);
  for (const id of ["frame:root", "frame:nested", "rect:gradient"])
    for (const corner of ["top_left", "top_right", "bottom_left", "bottom_right"])
      assert.equal(document.nodes[id][`rectangular_corner_radius_${corner}`],
        original.nodes.find((node) => node.id === id).cornerRadius);
  assert.deepEqual(rasterCalls, ["text:system"]);
  const [cacheId] = document.links["text:system"];
  assert.equal(document.nodes["text:system"].opacity, 0.6);
  assert.equal(document.nodes[cacheId].type, "rectangle");
  assert.equal(document.nodes[cacheId].layout_inset_left, -3);
  assert.equal(document.nodes[cacheId].layout_inset_top, -4);
  assert.equal(document.nodes[cacheId].opacity, 1);
  assert.equal(document.nodes[cacheId].rotation, 0);
  assert.equal(document.nodes[cacheId].fill_paints[0].src, images[0].id);
  assert.match(images[0].id, /^res:\/\//u);
  assert.equal(document.nodes["image:1"].fill_paints[0].src, projectedImageId);
  assert.deepEqual(images[0].bytes, new Uint8Array([4, 5, 6]));
  assert.equal(stats.nativeTextNodes, 1);
  assert.equal(stats.rasterTextFallback, 1);
  assert.equal(stats.nativeImageNodes, 1);
  assert.equal(stats.convertedSourceNodes, design.nodes.length);
  assert.equal(stats.unsupportedNodes, 0);
});

test("Grida projection retains reserved object IDs and avoids auxiliary ID collisions", async () => {
  const design = { canvas: fixture().canvas, nodes: [
    base("__proto__", "frame"),
    base("constructor", "rectangle", { parentId: "__proto__", x: 5 }),
    base("toString", "rectangle", { parentId: "__proto__", x: 10 }),
    base("__codeshell_compare_scene__", "rectangle"),
    base("__codeshell_compare_artboard__", "rectangle"),
  ] };
  const { document, stats } = await project(design);
  assert.ok(design.nodes.every((node) => Object.hasOwn(document.nodes, node.id)));
  assert.deepEqual(document.links["__proto__"], ["constructor", "toString"]);
  assert.equal(Object.keys(document.nodes).length, 7);
  assert.equal(stats.convertedSourceNodes, 5);
  assert.notEqual(document.scenes_ref[0], "__codeshell_compare_scene__");
});

test("Grida projection reports unavailable fonts and images without dropping the source layers", async () => {
  const source = fixture();
  const { document, stats } = await toGridaDocument(source);
  assert.ok(source.nodes.every((node) => Object.hasOwn(document.nodes, node.id)));
  assert.equal(stats.missingImages, 1);
  assert.equal(stats.nativeTextNodes, 0);
  assert.equal(stats.rasterTextFallback, 0);
  assert.equal(stats.unsupportedNodes, 2);
  assert.deepEqual(stats.unsupported.map(({ code }) => code).sort(),
    ["missing-font", "missing-font", "missing-image"].sort());
  await assert.rejects(toGridaDocument({ nodes: [source.nodes[0], source.nodes[0]] }),
    /Duplicate source node IDs/u);
});

test("prepared official encoder round-trips source IDs, hierarchy, text, gradients, effects and raster child resources", async (t) => {
  const modulePath = resolve(vendor, "grida-encoder.mjs");
  const metadataPath = resolve(vendor, "grida-encoder.metadata.json");
  try {
    await access(modulePath);
    await access(metadataPath);
    await access(resolve(sourceDirectory, "packages/grida-canvas-io/format.ts"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    t.skip("Run node scripts/design-renderer-compare/prepare-grida-encoder.mjs to prepare encoder artifacts before this offline round-trip test.");
    return;
  }
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  assert.equal(metadata.encoderSource.commit, GRIDA_ENCODER_SOURCE_COMMIT);
  assert.equal(sha256(await readFile(modulePath)), metadata.output.sha256);
  for (const source of metadata.sources)
    assert.equal(sha256(await readFile(resolve(sourceDirectory, source.path))), source.sha256,
      `Pinned source integrity: ${source.path}`);
  const { encode } = await import(pathToFileURL(modulePath).href);
  const { build } = await import("esbuild");
  const decoder = await build({
    stdin: {
      contents: `import { format } from ${JSON.stringify(resolve(sourceDirectory, "packages/grida-canvas-io/format.ts"))}; export const decode = format.document.decode.fromFlatbuffer;`,
      resolveDir: sourceDirectory,
    },
    bundle: true, write: false, format: "esm", platform: "neutral", minify: true,
    logLevel: "silent",
    alias: {
      "@grida/schema": resolve(sourceDirectory, "packages/grida-canvas-schema/index.ts"),
      "@grida/cg": resolve(sourceDirectory, "packages/grida-canvas-cg/index.ts"),
      "@grida/color": resolve(sourceDirectory, "packages/grida-canvas-color/index.ts"),
      "@grida/format": resolve(sourceDirectory, "packages/grida-format/src/index.ts"),
      flatbuffers: resolve(artifacts, "encoder-source/flatbuffers-25.9.23/package/mjs/flatbuffers.js"),
    },
  });
  const { decode } = await import(`data:text/javascript;base64,${Buffer.from(decoder.outputFiles[0].contents).toString("base64")}`);
  const design = fixture();
  const original = structuredClone(design);
  const { document, images, stats } = await project(design);
  const encoded = encode(document);
  assert.equal(Buffer.from(encoded.subarray(4, 8)).toString(), "GRID");
  const decoded = decode(encoded);
  assert.deepEqual(design, original);
  assert.deepEqual(Object.keys(decoded.nodes).sort(), Object.keys(document.nodes).sort());
  assert.equal(Object.keys(decoded.nodes).length, design.nodes.length + stats.auxiliaryNodes);
  for (const [parentId, children] of Object.entries(document.links))
    assert.deepEqual(decoded.links[parentId] ?? [], children, `Child order under ${parentId}`);
  for (const source of design.nodes) {
    const projected = document.nodes[source.id];
    const restored = decoded.nodes[source.id];
    assert.equal(restored.id, source.id);
    assert.equal(restored.name, source.name);
    closeTo(restored.layout_inset_left, projected.layout_inset_left);
    closeTo(restored.layout_inset_top, projected.layout_inset_top);
    closeTo(restored.layout_target_width, source.width);
    closeTo(restored.layout_target_height, source.height);
    closeTo(restored.opacity, source.opacity);
  }
  const text = decoded.nodes["text:文字"];
  assert.equal(text.text, original.nodes[2].text);
  assert.equal(text.font_family, "Roboto");
  assert.equal(text.font_weight, 700);
  assert.equal(text.font_style_italic, true);
  assert.equal(text.text_decoration_line, "underline");
  closeTo(text.line_height, 1.4);
  closeTo(text.letter_spacing, 1.5 / 20);
  const frame = decoded.nodes["frame:root"];
  assert.equal(frame.clips_content, true);
  closeTo(frame.rotation, 12);
  closeTo(frame.fe_shadows[0].blur, 4);
  closeTo(frame.fe_shadows[0].color.a, 0.3);
  closeTo(frame.stroke_width, 1.5);
  for (const id of ["frame:root", "frame:nested", "rect:gradient"])
    for (const corner of ["top_left", "top_right", "bottom_left", "bottom_right"])
      closeTo(decoded.nodes[id][`rectangular_corner_radius_${corner}`],
        original.nodes.find((node) => node.id === id).cornerRadius);
  const [basePaint, restoredGradient] = decoded.nodes["rect:gradient"].fill_paints;
  assert.equal(basePaint.type, "solid");
  closeTo(basePaint.color.a, 0.2);
  assert.equal(restoredGradient.type, "linear_gradient");
  closeTo(restoredGradient.opacity, gradient.opacity);
  const matrix = gradientMatrix(gradient.handles);
  restoredGradient.transform.forEach((row, y) => row.forEach((value, x) => closeTo(value, matrix[y][x])));
  restoredGradient.stops.forEach((stop, index) => {
    closeTo(stop.offset, gradient.stops[index].position);
    closeTo(stop.color.a, gradient.stops[index].opacity);
  });
  assert.equal(decoded.nodes["image:1"].type, "rectangle");
  assert.equal(decoded.nodes["image:1"].fill_paints[0].src, projectedImageId);
  assert.equal(decoded.nodes["image:1"].fill_paints[0].fit, "contain");
  const [cacheId] = decoded.links["text:system"];
  const cache = decoded.nodes[cacheId];
  assert.equal(cache.type, "rectangle");
  closeTo(cache.layout_inset_left, -3);
  closeTo(cache.layout_inset_top, -4);
  closeTo(cache.opacity, 1);
  assert.equal(cache.fill_paints[0].src, images[0].id);
});

test("Grida keeps an available but visually incompatible font on an explicit per-text fallback", async () => {
  const design = fixture();
  const original = structuredClone(design);
  const result = await toGridaDocument(design, {
    registeredFontFamilies: new Set(["Roboto"]),
    fontFallbackReasons: new Map([["Roboto", "Native alias glyph validation failed"]]),
    rasterizeText: async () => ({ x: -1, y: -2, width: 152, height: 64,
      bytes: new Uint8Array([1]) }),
  });
  assert.deepEqual(design, original);
  assert.equal(result.stats.nativeTextNodes, 0);
  assert.equal(result.stats.rasterTextFallback, 2);
  const issue = result.stats.unsupported.find((value) => value.nodeId === "text:文字");
  assert.equal(issue.code, "native-font-raster-cache");
  assert.equal(issue.message, "Native alias glyph validation failed");
  assert.ok(Object.hasOwn(result.document.nodes, "text:文字"));
  assert.equal(result.document.links["text:文字"].length, 1);
});
