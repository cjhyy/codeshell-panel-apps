import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createFigmaBinding,
  createFigmaPatch,
  figmaSourceNodes,
  parseFigmaBinding,
  readFigmaBinding,
  registerFigmaBinding,
} from "../../../apps/design-studio/app/figma-binding.mjs";
import { prepareFigmaImport } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { longFigmaSource } from "./fixtures/long-canvas.mjs";
import { createNativeNotesExportCapture } from "../../../apps/design-studio/app/figma-plugin/notes-runtime.mjs";
const sha256 = async (value) => createHash("sha256").update(value).digest("hex");

function sourceWithMockObservedNotes(source) {
  // Explicit SDK mocks for the pure patch-shape positive controls below.
  // Legacy missing metadata is tested separately and is never inferred absent.
  const parent = { id: "0:0", type: "DOCUMENT", children: [], parent: null };
  const make = (raw, owner) => {
    const node = { id: raw.id, type: raw.type === "CANVAS" ? "PAGE" : raw.type, parent: owner,
      children: [], getPluginData: () => "" };
    node.children = (raw.children ?? []).map(child => make(child, node)); return node;
  };
  const rawRoots = Object.values(source.nodes).map(entry => entry.document), roots = rawRoots.map(raw => make(raw, parent));
  parent.children = roots;
  const capture = createNativeNotesExportCapture({ roots, pluginId: "binding-notes-sdk-mock" });
  roots.forEach((root, index) => capture.add(rawRoots[index], root));
  return { ...source, nativeNotes: capture.finalize() };
}

async function translationFixture(sourcePatch = () => {}) {
  const box = (x, y, width, height) => ({ x, y, width, height });
  const source = {
    fileKey: "file-a",
    document: {
      id: "0:1",
      type: "CANVAS",
      children: [
        {
          id: "1:1",
          type: "FRAME",
          name: "Parent",
          absoluteBoundingBox: box(-100, -80, 500, 400),
          children: [
            {
              id: "1:2",
              type: "FRAME",
              name: "Nested",
              absoluteBoundingBox: box(-80, -60, 300, 200),
              children: [
                {
                  id: "1:3",
                  type: "RECTANGLE",
                  name: "Child",
                  absoluteBoundingBox: box(-50, -30, 100, 80),
                },
              ],
            },
          ],
        },
      ],
    },
  };
  sourcePatch(source.document.children[0]);
  const imported = await prepareFigmaImport(source);
  return {
    imported,
    binding: createFigmaBinding(imported),
    current: structuredClone(imported.document),
  };
}

test("a three-level parent drag emits one mapped update without copying inherited descendant subtrees", async () => {
  const { binding, current } = await translationFixture();
  const preserved = JSON.stringify(binding);
  for (const node of current.nodes) {
    node.x += 150;
    node.y += 25;
  }
  const patch = createFigmaPatch(binding, current);
  assert.deepEqual(
    patch.operations.map(({ sourceId, changed }) => ({ sourceId, changed })),
    [{ sourceId: "1:1", changed: ["x", "y"] }],
  );
  assert.equal(JSON.stringify(binding), preserved);
  assert.deepEqual(patch.mapping, binding.mapping);
  assert.deepEqual(patch.pageMappings, binding.pageMappings);
});

test("inherited axes are omitted while real local movement, tiny edits and style changes remain", async () => {
  const { binding, current } = await translationFixture();
  for (const node of current.nodes) {
    node.x += 150;
    node.y += 25;
  }
  current.nodes[2].x += 0.00001;
  current.nodes[2].fill = "#123456";
  const patch = createFigmaPatch(binding, current);
  assert.deepEqual(
    patch.operations.map(({ sourceId, changed }) => ({ sourceId, changed })),
    [
      { sourceId: "1:1", changed: ["x", "y"] },
      { sourceId: "1:3", changed: ["x", "fill"] },
    ],
  );
});

test("a child held at its old absolute position retains the explicit counter-move relative to its parent", async () => {
  const { binding, current } = await translationFixture();
  current.nodes[0].x += 150;
  const patch = createFigmaPatch(binding, current);
  assert.deepEqual(
    patch.operations.map(({ sourceId, changed }) => ({ sourceId, changed })),
    [
      { sourceId: "1:1", changed: ["x"] },
      { sourceId: "1:2", changed: ["x"] },
    ],
  );
});

test("resize, rotation, raw affine transforms and unmapped ancestors keep conservative explicit geometry", async () => {
  for (const kind of [
    "resize",
    "rotate",
    "raw-scale",
    "raw-rotation",
    "missing-map",
    "layout-sizing",
  ]) {
    const { binding, current } = await translationFixture((parent) => {
      if (kind === "raw-scale")
        parent.relativeTransform = [
          [2, 0, 0],
          [0, 1, 0],
        ];
      if (kind === "raw-rotation")
        parent.relativeTransform = [
          [0, -1, 0],
          [1, 0, 0],
        ];
    });
    for (const node of current.nodes) node.x += 150;
    if (kind === "resize") current.nodes[0].width += 50;
    if (kind === "rotate") current.nodes[0].rotation = 15;
    if (kind === "layout-sizing") current.nodes[0].layoutSizingHorizontal = "hug";
    if (kind === "missing-map")
      binding.mapping = binding.mapping.filter((entry) => entry.sourceId !== "1:2");
    const patch = createFigmaPatch(binding, current);
    assert.ok(patch.operations.find((op) => op.sourceId === "1:3")?.changed.includes("x"), kind);
  }
});

test("a 1208-layer board drag fits one source update while preserving all layers and the source mapping", async () => {
  const imported = await prepareFigmaImport(longFigmaSource()),
    binding = createFigmaBinding(imported);
  const current = structuredClone(imported.document);
  for (const node of current.nodes) node.x += 1000;
  const patch = createFigmaPatch(binding, current);
  assert.equal(patch.operations.length, 1);
  assert.equal(patch.operations[0].before.children, undefined);
  assert.equal(patch.operations[0].before.id, "1:0");
  assert.equal(patch.operations[0].before.type, "FRAME");
  assert.equal(figmaSourceNodes(binding.source).get("1:0").children.length, 1207);
  assert.equal(patch.baseline.pages[0].children[0].children.length, 1207);
  assert.equal(patch.mapping.length, 1208);
  assert.equal(current.nodes.length, 1208);
  assert.ok(Buffer.byteLength(JSON.stringify(patch)) < 2 * 1024 * 1024);
});

test("only update snapshots omit descendants; deletes retain the complete original subtree", async () => {
  const { binding, current } = await translationFixture();
  current.nodes[0].fill = "#123456";
  const update = createFigmaPatch(binding, current).operations[0];
  assert.equal(update.before.children, undefined);
  assert.equal(update.before.id, "1:1");
  assert.equal(update.before.type, "FRAME");
  current.nodes.splice(0);
  assert.throws(() => createFigmaPatch(binding, current), error => error.code === "NATIVE_NOTES_BASELINE_REQUIRED");
  binding.source = sourceWithMockObservedNotes(binding.source);
  const deletion = createFigmaPatch(binding, current).operations.find((op) => op.op === "delete");
  assert.equal(deletion.before.children[0].children[0].id, "1:3");
});
const rectangle = (id, x = 0) => ({
  id,
  type: "rectangle",
  name: id,
  x,
  y: 0,
  width: 100,
  height: 100,
  fill: "#ffffff",
  stroke: "transparent",
  strokeWidth: 0,
  opacity: 1,
  rotation: 0,
  cornerRadius: 0,
  visible: true,
  locked: false,
});
function fixture() {
  const node = rectangle("figma-1-2");
  const document = {
    format: "codeshell.design",
    version: 3,
    name: "Example",
    canvas: { width: 800, height: 600, background: "#ffffff" },
    tokens: { colors: [] },
    resources: [],
    activePageId: "figma-0-1",
    pages: [{ id: "figma-0-1", name: "Page", children: [node] }],
  };
  const raw = {
    id: "1:2",
    type: "RECTANGLE",
    name: "Source",
    absoluteBoundingBox: { x: -100, y: 0, width: 100, height: 100 },
    boundVariables: { fill: { id: "variable:1" } },
    fills: [{ type: "GRADIENT_LINEAR", gradientStops: [] }],
  };
  const source = {
    format: "codeshell.figma.source",
    version: 1,
    name: "Original",
    nodes: {
      "0:1": {
        document: {
          id: "0:1",
          type: "CANVAS",
          name: "Page",
          children: [
            raw,
            { id: "1:3", type: "VECTOR", vectorNetwork: { vertices: [{ x: 1, y: 2 }] } },
          ],
        },
      },
    },
  };
  const binding = createFigmaBinding({
    source,
    document,
    mapping: [
      {
        designId: node.id,
        sourceId: raw.id,
        pageId: "figma-0-1",
        sourcePageId: "0:1",
        offsetX: 100,
        offsetY: 0,
      },
    ],
    pageMappings: [{ designId: "figma-0-1", sourceId: "0:1", offsetX: 100, offsetY: 0 }],
  });
  return { document, source, binding };
}
test("a source binding retains unknown vectors, gradients and variables while a patch changes only explicit edited properties", () => {
  const f = fixture(),
    current = structuredClone(f.document);
  assert.equal(createFigmaPatch(f.binding, current).operations.length, 0);
  current.pages[0].children[0].x = 25;
  const patch = createFigmaPatch(f.binding, current);
  assert.deepEqual(patch.operations[0].changed, ["x"]);
  assert.equal(patch.operations[0].before.boundVariables.fill.id, "variable:1");
  assert.equal(f.binding.source.nodes["0:1"].document.children[1].type, "VECTOR");
  assert.deepEqual(f.binding.source, f.source);
});
test("explicit creates and mapped deletes never treat unrepresented source nodes as deleted", () => {
  const f = fixture(),
    current = structuredClone(f.document);
  current.pages[0].children = [rectangle("new-card", 40)];
  assert.throws(() => createFigmaPatch(f.binding, current), error => error.code === "NATIVE_NOTES_BASELINE_REQUIRED");
  f.binding.source = sourceWithMockObservedNotes(f.binding.source);
  const patch = createFigmaPatch(f.binding, current);
  assert.deepEqual(
    patch.operations.map((op) => op.op),
    ["create", "delete"],
  );
  assert.equal(patch.operations[1].sourceId, "1:2");
  assert.ok(!patch.operations.some((op) => op.sourceId === "1:3"));
});
test("source indexes register before design commit and select the matching prior version after failed saves", async () => {
  const f = fixture(),
    files = new Map();
  let version = 0;
  const call = async (method, params) => {
    if (method.endsWith("readText")) {
      const found = files.get(params.path);
      if (!found) throw Object.assign(Error("missing"), { code: "ENOENT" });
      return { ...found, path: params.path };
    }
    const prior = files.get(params.path);
    if (
      (params.expectedModifiedAt === null && prior) ||
      (params.expectedRevision && params.expectedRevision !== prior?.revision)
    )
      throw Error("conflict");
    const result = { content: params.content, revision: `v${++version}`, modifiedAt: version };
    files.set(params.path, result);
    return result;
  };
  const options = {
    path: "designs/example.codesign.json",
    binding: f.binding,
    call,
    check() {},
    sha256,
  };
  await registerFigmaBinding({ ...options, sourceContent: "saved version one" });
  const second = structuredClone(f.binding);
  second.source.name = "Version two";
  await registerFigmaBinding({
    ...options,
    binding: second,
    sourceContent: "uncommitted version two",
  });
  const old = await readFigmaBinding({ ...options, sourceContent: "saved version one" });
  assert.equal(old.source.name, "Original");
  const next = await readFigmaBinding({ ...options, sourceContent: "uncommitted version two" });
  assert.equal(next.source.name, "Version two");
  await assert.rejects(
    readFigmaBinding({ ...options, sourceContent: "unrelated modified bytes" }),
    /版本/,
  );
});
test("a null source entry survives save, failed save and reload without erasing older Figma mappings", async () => {
  const f = fixture(),
    files = new Map();
  let version = 0;
  const call = async (method, params) => {
    if (method.endsWith("readText")) {
      const found = files.get(params.path);
      if (!found) throw Object.assign(Error("missing"), { code: "ENOENT" });
      return found;
    }
    const prior = files.get(params.path);
    if (
      (params.expectedModifiedAt === null && prior) ||
      (params.expectedRevision && params.expectedRevision !== prior?.revision)
    )
      throw Error("conflict");
    const result = { content: params.content, revision: `v${++version}`, modifiedAt: version };
    files.set(params.path, result);
    return result;
  };
  const options = { path: "designs/example.codesign.json", call, check() {}, sha256 };
  await registerFigmaBinding({ ...options, binding: null, sourceContent: "ordinary" });
  assert.equal(files.size, 0);
  await registerFigmaBinding({ ...options, binding: f.binding, sourceContent: "imported" });
  await registerFigmaBinding({ ...options, binding: null, sourceContent: "ordinary" });
  assert.equal(await readFigmaBinding({ ...options, sourceContent: "ordinary" }), null);
  assert.equal(
    (await readFigmaBinding({ ...options, sourceContent: "imported" })).source.name,
    "Original",
  );
});

test("binding validation rejects mismatched page origins, source pages and fabricated selection parent transforms", () => {
  const f = fixture();
  for (const mutate of [
    (value) => {
      value.mapping[0].offsetX = NaN;
    },
    (value) => {
      value.mapping[0].offsetX = 101;
    },
    (value) => {
      value.mapping[0].pageId = "wrong-page";
    },
    (value) => {
      value.mapping[0].sourcePageId = "wrong-source";
    },
    (value) => {
      value.pageMappings[0].sourceId = "1:2";
    },
    (value) => {
      value.pageMappings[0].partial = "true";
    },
    (value) => {
      value.mapping[0].selectionRoot = true;
      value.mapping[0].sourceParentId = "parent";
      value.mapping[0].sourceParentTransform = [
        [1, 0, 0],
        [0, 1, 0],
      ];
    },
  ]) {
    const binding = structuredClone(f.binding);
    mutate(binding);
    assert.throws(() => parseFigmaBinding(binding));
  }
});

test("constraint and advanced supported layout edits appear in patches, while unsupported and canvas edits are diagnosed", async () => {
  const source = {
    format: "codeshell.figma.source",
    version: 1,
    name: "Constraints",
    nodes: {
      "0:1": {
        document: {
          id: "0:1",
          type: "CANVAS",
          name: "Page",
          children: [
            {
              id: "1:1",
              type: "FRAME",
              name: "Frame",
              absoluteBoundingBox: { x: 0, y: 0, width: 600, height: 400 },
              children: [
                {
                  id: "1:2",
                  type: "RECTANGLE",
                  name: "Card",
                  absoluteBoundingBox: { x: 20, y: 30, width: 100, height: 80 },
                  constraints: { horizontal: "MIN", vertical: "MIN" },
                },
              ],
            },
          ],
        },
      },
    },
    assets: {},
    previews: {},
  };
  const imported = await prepareFigmaImport(source),
    binding = createFigmaBinding(imported),
    current = imported.document;
  current.nodes[0].alignContent = "space-between";
  current.nodes[1].constraintHorizontal = "end";
  current.nodes[1].constraintVertical = "scale";
  current.nodes[1].constraintBaseHeight = 500;
  current.nodes[1].layoutMarginBefore = "auto";
  current.canvas.background = "#102030";
  const patch = createFigmaPatch(binding, current),
    child = patch.operations.find((op) => op.sourceId === "1:2");
  assert.ok(child.changed.includes("constraintHorizontal"));
  assert.ok(child.changed.includes("constraintVertical"));
  assert.ok(child.changed.includes("constraintBaseHeight"));
  assert.ok(patch.operations.find((op) => op.sourceId === "1:1").changed.includes("alignContent"));
  assert.ok(patch.diagnostics.some((item) => item.message.includes("layoutMarginBefore")));
  assert.ok(patch.diagnostics.some((item) => item.message.includes("画布")));
});

test("edits to synthesized unmapped layers are reported instead of silently omitted", () => {
  const f = fixture(),
    binding = structuredClone(f.binding);
  binding.baseline.pages[0].children.push(rectangle("synthetic-image"));
  const current = structuredClone(binding.baseline);
  current.pages[0].children[1].opacity = 0.5;
  const patch = createFigmaPatch(binding, current);
  assert.equal(patch.operations.length, 0);
  assert.ok(
    patch.diagnostics.some(
      (item) => item.designId === "synthetic-image" && item.message.includes("没有独立"),
    ),
  );
});

test("empty imported pages retain finite origins through source bindings", async () => {
  const result = await prepareFigmaImport({
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        { id: "0:1", type: "CANVAS", name: "Empty", children: [] },
        { id: "0:2", type: "CANVAS", name: "Also empty", children: [] },
      ],
    },
  });
  assert.deepEqual(
    result.pageMappings.map((page) => [page.offsetX, page.offsetY]),
    [
      [0, 0],
      [0, 0],
    ],
  );
  assert.equal(createFigmaBinding(result).pageMappings.length, 2);
  assert.ok(!result.warnings.some((warning) => warning.code === "page-origin-normalized"));
});
