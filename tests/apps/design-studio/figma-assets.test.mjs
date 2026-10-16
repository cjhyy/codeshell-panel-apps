import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  prepareFigmaImport,
  createFigmaTransfer,
} from "../../../apps/design-studio/app/figma-bridge.mjs";
import {
  normalizeFigmaSource,
  normalizeFigmaAsset,
  decodeFigmaAsset,
} from "../../../apps/design-studio/app/figma-assets.mjs";
import { resolveDesignResource } from "../../../apps/design-studio/app/resource-store.mjs";

export const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7S8AAAAASUVORK5CYII=";
const sha256Bytes = async (bytes) => createHash("sha256").update(bytes).digest("hex");
const box = { x: -40, y: -20, width: 100, height: 80 };
const rectangle = (id, imageRef = "photo") => ({
  id,
  type: "RECTANGLE",
  name: "Photo",
  absoluteBoundingBox: box,
  fills: [{ type: "IMAGE", imageRef, scaleMode: "FILL" }],
});
const envelope = (
  children,
  assets = { photo: { mime: "image/png", base64: PNG } },
  previews = {},
) => ({
  format: "codeshell.figma.source",
  version: 1,
  fileKey: "source-file",
  name: "Asset round trip",
  nodes: { "0:1": { document: { id: "0:1", type: "CANVAS", name: "Home", children } } },
  assets,
  previews,
});

test("local image bytes import into verified resource parts and export back in a separate transfer asset table", async () => {
  const source = envelope([rectangle("1:2")]),
    before = JSON.stringify(source);
  const result = await prepareFigmaImport(JSON.stringify(source), { sha256Bytes });
  assert.equal(JSON.stringify(source), before);
  assert.equal(result.resourcePlans.length, 1);
  assert.equal(result.document.resources.length, 1);
  const image = result.document.nodes[0],
    descriptor = result.document.resources[0];
  assert.equal(image.type, "image");
  assert.equal(image.imageRef, descriptor.id);
  assert.equal(image.objectFit, "cover");
  assert.deepEqual([image.x, image.y], [0, 0]);
  assert.deepEqual(result.mapping, [
    {
      designId: "figma-1-2",
      sourceId: "1:2",
      pageId: "figma-0-1",
      sourcePageId: "0:1",
      offsetX: 40,
      offsetY: 20,
    },
  ]);
  assert.deepEqual(result.pageMappings, [
    { designId: "figma-0-1", sourceId: "0:1", offsetX: 40, offsetY: 20 },
  ]);
  assert.ok(!JSON.stringify(result.document).includes(PNG));
  const parts = new Map(result.resourcePlans[0].parts.map((part) => [part.path, part.content]));
  const resolved = await resolveDesignResource({
    descriptor,
    readText: async (path) => parts.get(path),
    sha256Bytes,
  });
  assert.equal(resolved.base64, PNG);
  const transfer = createFigmaTransfer(result.document, {
    resources: new Map([[descriptor.id, resolved]]),
  });
  assert.equal(transfer.pages[0].children[0].type, "image");
  assert.equal(transfer.assets[descriptor.id].base64, PNG);
  assert.throws(() => createFigmaTransfer(result.document), /缺少图片资源/);
});

test("complex vectors become visible local previews while unknown Figma data and SVG remain exact in source", async () => {
  const vector = {
    id: "2:1",
    type: "VECTOR",
    name: "Logo",
    absoluteBoundingBox: box,
    fills: [
      {
        type: "GRADIENT_LINEAR",
        gradientStops: [{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } }],
      },
    ],
    fillGeometry: [{ path: "M0 0L100 80Z", windingRule: "NONZERO" }],
    boundVariables: { fills: [{ id: "variable" }] },
    pluginData: { untouched: "preserved" },
  };
  const source = envelope(
    [vector],
    { logo: { mime: "image/png", base64: PNG } },
    {
      "2:1": {
        assetId: "logo",
        bounds: box,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1Z"/></svg>',
      },
    },
  );
  const result = await prepareFigmaImport(source, { sha256Bytes });
  assert.equal(result.document.nodes[0].type, "image");
  assert.equal(result.stats.skippedNodes, 0);
  assert.ok(result.warnings.some((warning) => warning.code === "visual-fallback"));
  assert.deepEqual(result.source.nodes["0:1"].document.children[0], vector);
  assert.equal(result.source.previews["2:1"].svg, source.previews["2:1"].svg);
  assert.equal(result.mapping[0].sourceId, "2:1");
});

test("identical assets deduplicate, missing assets remain explicit and invalid binary tables fail before planning writes", async () => {
  const result = await prepareFigmaImport(
    envelope([rectangle("1:1", "a"), rectangle("1:2", "b")], {
      a: { mime: "image/png", base64: PNG },
      b: { mime: "image/png", base64: PNG },
    }),
    { sha256Bytes },
  );
  assert.equal(result.resourcePlans.length, 1);
  assert.equal(result.document.nodes[0].imageRef, result.document.nodes[1].imageRef);
  const missing = await prepareFigmaImport(envelope([rectangle("1:1", "missing")], {}));
  assert.equal(missing.document.nodes[0].type, "rectangle");
  assert.ok(missing.warnings.some((warning) => warning.code === "unsupported-paint"));
  assert.throws(() => decodeFigmaAsset("https://remote.example/image.png"));
  assert.throws(() => normalizeFigmaAsset({ mime: "image/jpeg", base64: PNG }), /MIME/);
  await assert.rejects(prepareFigmaImport(envelope([rectangle("1:1")]), {}), /SHA-256/);
  assert.throws(
    () => normalizeFigmaSource(envelope([], {}, { logo: { assetId: "missing" } })),
    /本地资源/,
  );
});

test("Figma constraints import into responsive design fields under manual frames", async () => {
  const source = envelope(
    [
      {
        id: "1:1",
        type: "FRAME",
        name: "Container",
        absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
        children: [
          {
            id: "1:2",
            type: "RECTANGLE",
            name: "Anchored",
            absoluteBoundingBox: { x: 30, y: 40, width: 120, height: 80 },
            constraints: { horizontal: "STRETCH", vertical: "MAX" },
          },
        ],
      },
    ],
    {},
  );
  const result = await prepareFigmaImport(source);
  const child = result.document.nodes[1];
  assert.deepEqual(
    [
      child.layoutPositioning,
      child.constraintHorizontal,
      child.constraintVertical,
      child.constraintLeft,
      child.constraintRight,
      child.constraintBottom,
    ],
    ["absolute", "stretch", "end", 30, 250, 180],
  );
});
