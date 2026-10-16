import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  importFigmaJson,
  prepareFigmaImport,
  createFigmaTransfer,
} from "../../../apps/design-studio/app/figma-bridge.mjs";
import { serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import {
  createFigmaBinding,
  createFigmaPatch,
} from "../../../apps/design-studio/app/figma-binding.mjs";

const code = await readFile(
  new URL("../../../apps/design-studio/app/figma-plugin/code.js", import.meta.url),
  "utf8",
);
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7S8AAAAASUVORK5CYII=";
const clone = (value) => JSON.parse(JSON.stringify(value));
const sha256Bytes = async (bytes) => createHash("sha256").update(bytes).digest("hex");
const rect = (id = "1:2", properties = {}) => ({
  id,
  type: "RECTANGLE",
  name: "Original",
  absoluteBoundingBox: { x: 30, y: 40, width: 100, height: 80 },
  fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
  ...properties,
});
const page = (children) => ({ id: "0:1", type: "CANVAS", name: "Home", children });

function harness(source = page([rect()])) {
  const all = new Map(),
    messages = [],
    fonts = new Set(),
    images = new Map(),
    undo = [],
    calls = [];
  let serial = 100,
    failName = null;
  function make(raw, parent = null) {
    const node = {
      raw: clone(raw),
      id: raw.id,
      type: raw.type === "CANVAS" ? "PAGE" : raw.type,
      name: raw.name,
      parent,
      children: [],
      selection: [],
      pluginData: {},
      width: raw.size?.x ?? raw.absoluteBoundingBox?.width ?? 100,
      height: raw.size?.y ?? raw.absoluteBoundingBox?.height ?? 100,
      relativeTransform: clone(
        raw.relativeTransform ?? [
          [1, 0, (raw.absoluteBoundingBox?.x ?? 0) - (parent?.raw.absoluteBoundingBox?.x ?? 0)],
          [0, 1, (raw.absoluteBoundingBox?.y ?? 0) - (parent?.raw.absoluteBoundingBox?.y ?? 0)],
        ],
      ),
      fills: clone(raw.fills ?? []),
      strokes: clone(raw.strokes ?? []),
      layoutMode: raw.layoutMode ?? "NONE",
      opacity: raw.opacity ?? 1,
      visible: raw.visible !== false,
      locked: raw.locked === true,
      isMask: raw.isMask === true,
      appendChild(child) {
        if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
        this.children.push(child);
        child.parent = this;
        child.removed = false;
      },
      insertChild(index, child) {
        if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
        this.children.splice(index, 0, child);
        child.parent = this;
        child.removed = false;
      },
      resize(width, height) {
        this.width = width;
        this.height = height;
      },
      setPluginData(key, value) {
        this.pluginData[key] = value;
      },
      remove() {
        this.removed = true;
        if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
      },
      async loadAsync() {},
      getRangeAllFontNames() {
        return this.fontName ? [this.fontName] : [];
      },
      async exportAsync(settings) {
        calls.push(["export", this.id, settings.format]);
        if (settings.format === "PNG") return new Uint8Array(Buffer.from(PNG, "base64"));
        if (settings.format === "SVG_STRING")
          return '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1Z"/></svg>';
        return { document: snapshot(this), components: {}, styles: {} };
      },
    };
    let name = raw.name;
    if (raw.absoluteBoundingBox) node.absoluteBoundingBox = clone(raw.absoluteBoundingBox);
    Object.defineProperty(node, "name", {
      enumerable: true,
      get: () => name,
      set: (value) => {
        if (value === failName) throw new Error("setter rejected");
        name = value;
      },
    });
    all.set(node.id, node);
    for (const child of raw.children ?? []) node.children.push(make(child, node));
    return node;
  }
  function snapshot(node) {
    const raw = clone(node.raw);
    raw.name = node.name;
    if (node.type !== "PAGE") {
      const multiply = (a, b) => [
        [
          a[0][0] * b[0][0] + a[0][1] * b[1][0],
          a[0][0] * b[0][1] + a[0][1] * b[1][1],
          a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2],
        ],
        [
          a[1][0] * b[0][0] + a[1][1] * b[1][0],
          a[1][0] * b[0][1] + a[1][1] * b[1][1],
          a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2],
        ],
      ];
      const absolute = (node) =>
        !node || node.type === "PAGE" || !node.relativeTransform
          ? [
              [1, 0, 0],
              [0, 1, 0],
            ]
          : multiply(absolute(node.parent), node.relativeTransform);
      const matrix = absolute(node),
        points = [
          [0, 0],
          [node.width, 0],
          [0, node.height],
          [node.width, node.height],
        ].map(([x, y]) => [
          matrix[0][0] * x + matrix[0][1] * y + matrix[0][2],
          matrix[1][0] * x + matrix[1][1] * y + matrix[1][2],
        ]),
        xs = points.map((point) => point[0]),
        ys = points.map((point) => point[1]);
      raw.absoluteBoundingBox = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      };
      raw.fills = clone(node.fills).map((paint) =>
        paint.type === "IMAGE" && paint.imageHash
          ? { ...paint, imageRef: paint.imageHash, imageHash: undefined }
          : paint,
      );
      if (node.raw.strokes) raw.strokes = clone(node.strokes);
      if (node.raw.relativeTransform) raw.relativeTransform = clone(node.relativeTransform);
      if (node.raw.size) raw.size = { x: node.width, y: node.height };
      for (const key of [
        "opacity",
        "visible",
        "locked",
        "layoutMode",
        "itemSpacing",
        "paddingTop",
        "paddingLeft",
        "paddingRight",
        "paddingBottom",
        "counterAxisAlignItems",
        "primaryAxisAlignItems",
        "cornerRadius",
        "strokeWeight",
        "effects",
        "characters",
      ])
        if (
          node.raw[key] !== undefined ||
          (!["opacity", "visible", "locked", "layoutMode"].includes(key) && node[key] !== undefined)
        )
          raw[key] = clone(node[key]);
    }
    if (node.raw.children || node.children.length)
      raw.children = node.children.filter((child) => !child.removed).map(snapshot);
    return raw;
  }
  const initial = make(source),
    root = {
      children: [initial],
      appendChild(node) {
        if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
        this.children.push(node);
        node.parent = this;
      },
    };
  initial.parent = root;
  const figma = {
    fileKey: "file-a",
    mixed: Symbol("mixed"),
    root,
    currentPage: initial,
    ui: {
      postMessage(message) {
        messages.push(clone(message));
      },
    },
    viewport: { scrollAndZoomIntoView() {} },
    showUI() {},
    async getNodeByIdAsync(id) {
      const node = all.get(id);
      return node?.removed ? null : (node ?? null);
    },
    async setCurrentPageAsync(node) {
      this.currentPage = node;
    },
    async loadFontAsync(font) {
      calls.push(["font", font.family, font.style]);
      fonts.add(JSON.stringify(font));
    },
    createPage() {
      const node = make({ id: `0:${++serial}`, type: "CANVAS", name: "Created", children: [] });
      root.appendChild(node);
      return node;
    },
    createImage(bytes) {
      assert.ok(bytes instanceof Uint8Array || ArrayBuffer.isView(bytes));
      const hash = `image-${images.size + 1}`;
      images.set(hash, new Uint8Array(bytes));
      calls.push(["image", hash]);
      return { hash };
    },
    getImageByHash(hash) {
      const bytes = images.get(hash);
      return bytes ? { getBytesAsync: async () => bytes } : null;
    },
    commitUndo() {
      undo.push(
        [...all.values()].map((node) => ({
          node,
          parent: node.parent,
          children: [...node.children],
          data: Object.fromEntries(
            Object.entries(node)
              .filter(
                ([key, value]) =>
                  !["children", "parent", "selection"].includes(key) && typeof value !== "function",
              )
              .map(([key, value]) => [key, clone(value)]),
          ),
        })),
      );
    },
    triggerUndo() {
      undo.pop();
      const entries = undo.at(-1);
      if (!entries) return;
      const known = new Set(entries.map((entry) => entry.node));
      for (const node of all.values())
        if (!known.has(node)) {
          node.removed = true;
          if (node.parent)
            node.parent.children = node.parent.children.filter((child) => child !== node);
        }
      for (const entry of entries) {
        Object.assign(entry.node, entry.data);
        entry.node.parent = entry.parent;
        entry.node.children = entry.children;
      }
      root.children = entries.filter((entry) => entry.parent === root).map((entry) => entry.node);
      calls.push(["undo"]);
    },
  };
  for (const [method, type] of [
    ["createFrame", "FRAME"],
    ["createRectangle", "RECTANGLE"],
    ["createEllipse", "ELLIPSE"],
    ["createText", "TEXT"],
  ])
    figma[method] = () => {
      const node = make({ id: `1:${++serial}`, type, name: "Created" });
      figma.currentPage.appendChild(node);
      return node;
    };
  vm.runInNewContext(code, { figma, __html__: "UI", Uint8Array, ArrayBuffer });
  return {
    figma,
    all,
    messages,
    calls,
    images,
    snapshot,
    failName(value) {
      failName = value;
    },
    send: (message) => figma.ui.onmessage(message),
  };
}

function patchTransfer(source, change, changed = ["name"]) {
  const result = importFigmaJson(source),
    baseline = JSON.parse(serializeDesignDocument(result.document));
  const beforeNode = clone(result.document.nodes[0]);
  change(result.document.nodes[0], result.document);
  const transfer = createFigmaTransfer(result.document);
  transfer.patch = {
    format: "codeshell.figma.patch",
    version: 1,
    fileKey: "file-a",
    mapping: result.mapping,
    pageMappings: result.pageMappings,
    baseline,
    operations: [
      {
        op: "update",
        sourceId: source.children[0].id,
        designId: beforeNode.id,
        before: clone(source.children[0]),
        baseline: beforeNode,
        after: clone(result.document.nodes[0]),
        changed,
        pageDesignId: result.document.activePageId,
        pageSourceId: source.id,
      },
    ],
  };
  return transfer;
}

test("plugin export captures official raw nodes, local image fill bytes and SVG/PNG fallback previews", async () => {
  const source = page([
    rect("1:2", { fills: [{ type: "IMAGE", imageRef: "photo", scaleMode: "FILL" }] }),
    rect("1:3", { type: "VECTOR", fillGeometry: [{ path: "M0 0L1 1Z" }] }),
  ]);
  const runtime = harness(source);
  runtime.all.get("1:2").fills = [{ type: "IMAGE", imageHash: "photo", scaleMode: "FILL" }];
  runtime.images.set("photo", new Uint8Array(Buffer.from(PNG, "base64")));
  await runtime.send({ type: "export-json", scope: "page" });
  assert.equal(runtime.messages.at(-1).type, "exported");
  const exported = JSON.parse(runtime.messages.at(-1).content);
  assert.equal(exported.format, "codeshell.figma.source");
  assert.equal(exported.fileKey, "file-a");
  assert.equal(exported.assets.photo.base64, PNG);
  assert.ok(exported.previews["1:3"].svg.includes("<path"));
  assert.equal(exported.nodes["0:1"].document.children[1].fillGeometry[0].path, "M0 0L1 1Z");
  const imported = await prepareFigmaImport(exported, { sha256Bytes });
  assert.deepEqual(
    imported.document.nodes.map((node) => node.type),
    ["image", "image"],
  );
  assert.equal(runtime.figma.root.children.length, 1);
});

test("plugin imports local image resources into editable image-filled rectangles", async () => {
  const source = {
    format: "codeshell.figma.source",
    version: 1,
    name: "Photos",
    nodes: {
      "0:1": {
        document: page([
          rect("1:2", { fills: [{ type: "IMAGE", imageRef: "photo", scaleMode: "FILL" }] }),
        ]),
      },
    },
    assets: { photo: { mime: "image/png", base64: PNG } },
    previews: {},
  };
  const imported = await prepareFigmaImport(source, { sha256Bytes }),
    descriptor = imported.document.resources[0];
  const transfer = createFigmaTransfer(imported.document, {
      resources: { [descriptor.id]: { descriptor, base64: PNG } },
    }),
    runtime = harness();
  transfer.canvas.background = "#102030";
  await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "imported");
  const image = runtime.figma.root.children[1].children[0];
  assert.deepEqual(clone(runtime.figma.root.children[1].backgrounds), [
    { type: "SOLID", color: { r: 16 / 255, g: 32 / 255, b: 48 / 255 } },
  ]);
  assert.equal(image.type, "RECTANGLE");
  assert.equal(image.fills[0].type, "IMAGE");
  assert.equal(image.fills[0].scaleMode, "FILL");
  assert.deepEqual(
    [...runtime.images.get(image.fills[0].imageHash)],
    [...Buffer.from(PNG, "base64")],
  );
});

test("original-design patch requires explicit preview and preserves untouched gradients, variables and unknown raw properties", async () => {
  const source = page([
    rect("1:2", {
      fills: [
        {
          type: "GRADIENT_LINEAR",
          gradientStops: [{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } }],
        },
      ],
      boundVariables: { fills: [{ id: "v:1" }] },
      futureFigmaProperty: { retained: true },
    }),
  ]);
  const transfer = patchTransfer(source, (node) => {
      node.name = "Reviewed name";
    }),
    runtime = harness(source);
  await runtime.send({ type: "apply-patch", token: "invented" });
  assert.equal(runtime.messages.at(-1).type, "error");
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  const preview = runtime.messages.at(-1);
  assert.equal(preview.type, "patch-preview");
  assert.deepEqual(preview.conflicts, []);
  assert.equal(runtime.all.get("1:2").name, "Original");
  await runtime.send({ type: "apply-patch", token: preview.token });
  assert.equal(runtime.messages.at(-1).type, "patched");
  const raw = runtime.snapshot(runtime.all.get("1:2"));
  assert.equal(raw.name, "Reviewed name");
  assert.deepEqual(raw.fills, source.children[0].fills);
  assert.deepEqual(raw.boundVariables, source.children[0].boundVariables);
  assert.deepEqual(raw.futureFigmaProperty, { retained: true });
  assert.equal(runtime.figma.root.children.length, 1);
});

test("patch conflicts are checked both before preview and again immediately before applying", async () => {
  const source = page([rect()]),
    transfer = patchTransfer(source, (node) => {
      node.name = "Panel name";
    }),
    runtime = harness(source);
  runtime.all.get("1:2").name = "Figma edit";
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "patch-preview");
  assert.ok(runtime.messages.at(-1).conflicts.length);
  runtime.all.get("1:2").name = "Original";
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  const preview = runtime.messages.at(-1);
  runtime.all.get("1:2").name = "Changed after preview";
  await runtime.send({ type: "apply-patch", token: preview.token });
  assert.equal(runtime.messages.at(-1).type, "error");
  assert.equal(runtime.all.get("1:2").name, "Changed after preview");
  const wrongFile = clone(transfer);
  wrongFile.patch.fileKey = "another-file";
  await runtime.send({ type: "preview-patch", content: JSON.stringify(wrongFile) });
  assert.match(runtime.messages.at(-1).message, /文件不一致/);
});

test("deletions require unchanged raw subtree and an explicit reviewed-delete confirmation", async () => {
  const source = page([rect()]),
    result = importFigmaJson(source),
    transfer = createFigmaTransfer(result.document),
    runtime = harness(source);
  transfer.patch = {
    format: "codeshell.figma.patch",
    version: 1,
    fileKey: "file-a",
    operations: [
      { op: "delete", sourceId: "1:2", designId: "figma-1-2", before: source.children[0] },
    ],
  };
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  const first = runtime.messages.at(-1);
  assert.equal(first.deletions, 1);
  await runtime.send({ type: "apply-patch", token: first.token });
  assert.equal(runtime.messages.at(-1).type, "error");
  assert.equal(runtime.all.get("1:2").removed, undefined);
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  const second = runtime.messages.at(-1);
  await runtime.send({ type: "apply-patch", token: second.token, allowDeletes: true });
  assert.equal(runtime.messages.at(-1).type, "patched");
  assert.equal(runtime.all.get("1:2").removed, true);
});

test("failed patch requests undo of its own partial mutations", async () => {
  const source = page([rect("1:2"), rect("1:3")]),
    transfer = patchTransfer(source, (node) => {
      node.name = "First change";
    });
  transfer.patch.operations.push({
    ...clone(transfer.patch.operations[0]),
    sourceId: "1:3",
    designId: "figma-1-3",
    before: source.children[1],
    baseline: { ...transfer.patch.operations[0].baseline, id: "figma-1-3" },
    after: { ...transfer.patch.operations[0].after, id: "figma-1-3", name: "Rejected change" },
  });
  const runtime = harness(source);
  runtime.failName("Rejected change");
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  const preview = runtime.messages.at(-1);
  await runtime.send({ type: "apply-patch", token: preview.token });
  assert.equal(runtime.messages.at(-1).type, "error");
  assert.match(runtime.messages.at(-1).message, /撤销/);
  assert.equal(runtime.all.get("1:2").name, "Original");
  assert.ok(runtime.calls.some((call) => call[0] === "undo"));
});

test("moving a parent and its child updates local geometry once, preserving normalized page offsets", async () => {
  const source = page([
    rect("1:1", {
      type: "FRAME",
      absoluteBoundingBox: { x: -100, y: -100, width: 300, height: 200 },
      children: [rect("1:2", { absoluteBoundingBox: { x: -70, y: -60, width: 100, height: 80 } })],
    }),
  ]);
  const imported = importFigmaJson(source),
    baseline = JSON.parse(serializeDesignDocument(imported.document)),
    before = imported.document.nodes.map(clone);
  for (const node of imported.document.nodes) node.x += 20;
  const transfer = createFigmaTransfer(imported.document);
  transfer.patch = {
    format: "codeshell.figma.patch",
    version: 1,
    baseline,
    mapping: imported.mapping,
    pageMappings: imported.pageMappings,
    operations: before.map((node, index) => ({
      op: "update",
      sourceId: index ? "1:2" : "1:1",
      designId: node.id,
      before: index ? source.children[0].children[0] : source.children[0],
      baseline: node,
      after: clone(imported.document.nodes[index]),
      changed: ["x"],
    })),
  };
  const runtime = harness(source);
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  const preview = runtime.messages.at(-1);
  assert.deepEqual(preview.conflicts, []);
  await runtime.send({ type: "apply-patch", token: preview.token });
  assert.equal(runtime.messages.at(-1).type, "patched");
  assert.equal(runtime.all.get("1:1").relativeTransform[0][2], -80);
  assert.equal(runtime.all.get("1:2").relativeTransform[0][2], 30);
});

test("binding-generated page rename and preorder creation apply only after review", async () => {
  const source = {
    format: "codeshell.figma.source",
    version: 1,
    name: "Pages",
    fileKey: "file-a",
    nodes: { "0:1": { document: page([rect()]) } },
    assets: {},
    previews: {},
  };
  const imported = await prepareFigmaImport(source),
    binding = createFigmaBinding(imported),
    current = imported.document;
  current.pages[0].name = "Renamed home";
  const original = clone(current.nodes[0]);
  current.pages.push({
    id: "new-page",
    name: "New page",
    nodes: [
      {
        ...original,
        id: "new-frame",
        type: "frame",
        name: "New container",
        x: 10,
        y: 10,
        width: 400,
        height: 300,
        layout: "vertical",
        gap: 12,
        padding: 20,
        alignItems: "start",
        justifyContent: "start",
        clipContent: false,
      },
      { ...original, id: "new-child", name: "New child", parentId: "new-frame", x: 30, y: 30 },
    ],
    nodeCount: 2,
  });
  const transfer = createFigmaTransfer(current);
  transfer.patch = createFigmaPatch(binding, current);
  const runtime = harness(source.nodes["0:1"].document);
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  const preview = runtime.messages.at(-1);
  assert.equal(preview.type, "patch-preview");
  assert.deepEqual(preview.conflicts, []);
  await runtime.send({ type: "apply-patch", token: preview.token });
  assert.equal(runtime.messages.at(-1).type, "patched");
  assert.equal(runtime.figma.root.children[0].name, "Renamed home");
  assert.equal(runtime.figma.root.children[1].name, "New page");
  const frame = runtime.figma.root.children[1].children[0];
  assert.equal(frame.name, "New container");
  assert.equal(frame.children[0].name, "New child");
  assert.equal(frame.layoutMode, "VERTICAL");
});

test("binding-generated reparent uses local coordinates and retains the original node identity", async () => {
  const source = {
    format: "codeshell.figma.source",
    version: 1,
    name: "Reparent",
    fileKey: "file-a",
    nodes: {
      "0:1": {
        document: page([
          rect("1:1", {
            type: "FRAME",
            absoluteBoundingBox: { x: 200, y: 100, width: 400, height: 300 },
            children: [],
          }),
          rect("1:2"),
        ]),
      },
    },
    assets: {},
    previews: {},
  };
  const imported = await prepareFigmaImport(source),
    binding = createFigmaBinding(imported),
    current = imported.document;
  current.nodes[1].parentId = current.nodes[0].id;
  current.nodes[1].x = 220;
  current.nodes[1].y = 120;
  const transfer = createFigmaTransfer(current);
  transfer.patch = createFigmaPatch(binding, current);
  const runtime = harness(source.nodes["0:1"].document),
    original = runtime.all.get("1:2");
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  const preview = runtime.messages.at(-1);
  assert.equal(preview.type, "patch-preview");
  assert.deepEqual(preview.conflicts, []);
  await runtime.send({ type: "apply-patch", token: preview.token });
  assert.equal(runtime.messages.at(-1).type, "patched");
  assert.equal(original.parent.id, "1:1");
  assert.deepEqual(clone(original.relativeTransform), [
    [1, 0, 20],
    [0, 1, 20],
  ]);
});

test("layer reordering retains original identities and every untouched unsupported sibling", async () => {
  const source = {
    format: "codeshell.figma.source",
    version: 1,
    name: "Order",
    fileKey: "file-a",
    nodes: {
      "0:1": {
        document: page([
          rect("1:1", { name: "A" }),
          rect("1:99", { type: "VECTOR", name: "Untouched X", futureShape: { path: "unchanged" } }),
          rect("1:2", { name: "B" }),
        ]),
      },
    },
    assets: {},
    previews: {},
  };
  const imported = await prepareFigmaImport(source),
    binding = createFigmaBinding(imported);
  imported.document.nodes.reverse();
  const transfer = createFigmaTransfer(imported.document);
  transfer.patch = createFigmaPatch(binding, imported.document);
  const runtime = harness(source.nodes["0:1"].document),
    a = runtime.all.get("1:1"),
    b = runtime.all.get("1:2"),
    x = runtime.all.get("1:99");
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  const preview = runtime.messages.at(-1);
  assert.equal(preview.type, "patch-preview");
  assert.deepEqual(preview.conflicts, []);
  await runtime.send({ type: "apply-patch", token: preview.token });
  assert.equal(runtime.messages.at(-1).type, "patched");
  const children = runtime.figma.currentPage.children;
  assert.ok(children.indexOf(b) < children.indexOf(a));
  assert.equal(children.length, 3);
  assert.ok(children.includes(x));
  assert.equal(x.removed, undefined);
  assert.deepEqual(runtime.snapshot(x).futureShape, { path: "unchanged" });
});

test("reorder preflight detects source sibling-order edits, including unknown siblings in explicit snapshots", async () => {
  const source = {
    format: "codeshell.figma.source",
    version: 1,
    name: "Order conflicts",
    fileKey: "file-a",
    nodes: {
      "0:1": { document: page([rect("1:1"), rect("1:99", { type: "VECTOR" }), rect("1:2")]) },
    },
    assets: {},
    previews: {},
  };
  const imported = await prepareFigmaImport(source),
    binding = createFigmaBinding(imported);
  imported.document.nodes.reverse();
  const transfer = createFigmaTransfer(imported.document);
  transfer.patch = createFigmaPatch(binding, imported.document);
  for (const operation of transfer.patch.operations)
    operation.beforeSiblingSourceIds = ["1:1", "1:99", "1:2"];
  const runtime = harness(source.nodes["0:1"].document);
  runtime.figma.currentPage.insertChild(0, runtime.all.get("1:99"));
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "patch-preview");
  assert.match(runtime.messages.at(-1).conflicts.join(" "), /顺序已变化/);
});

test("preview explicitly reports when a source file cannot be identified automatically", async () => {
  const source = page([rect()]),
    transfer = patchTransfer(source, (node) => {
      node.name = "Reviewed";
    }),
    runtime = harness(source);
  delete transfer.patch.fileKey;
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).identity.verified, false);
  assert.match(runtime.messages.at(-1).identity.message, /无法自动确认/);
});

test("nested selection exports real page context and updates geometry through a rotated original parent", async () => {
  const source = page([
    rect("1:1", {
      type: "FRAME",
      size: { x: 200, y: 100 },
      relativeTransform: [
        [0, -1, 100],
        [1, 0, 100],
      ],
      absoluteBoundingBox: { x: 0, y: 100, width: 100, height: 200 },
      children: [
        rect("1:2", {
          size: { x: 30, y: 20 },
          relativeTransform: [
            [1, 0, 10],
            [0, 1, 20],
          ],
          absoluteBoundingBox: { x: 60, y: 110, width: 20, height: 30 },
        }),
      ],
    }),
  ]);
  const runtime = harness(source);
  runtime.figma.currentPage.selection = [runtime.all.get("1:2")];
  await runtime.send({ type: "export-json", scope: "selection" });
  assert.equal(runtime.messages.at(-1).type, "exported");
  const exported = JSON.parse(runtime.messages.at(-1).content),
    imported = await prepareFigmaImport(exported),
    binding = createFigmaBinding(imported);
  assert.equal(imported.pageMappings[0].sourceId, "0:1");
  assert.equal(imported.pageMappings[0].partial, true);
  assert.equal(imported.mapping[0].sourceParentId, "1:1");
  assert.equal(imported.document.nodes[0].rotation, 90);
  imported.document.nodes[0].x += 20;
  const transfer = createFigmaTransfer(imported.document);
  transfer.patch = createFigmaPatch(binding, imported.document);
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  const preview = runtime.messages.at(-1);
  assert.equal(preview.type, "patch-preview");
  assert.deepEqual(preview.conflicts, []);
  await runtime.send({ type: "apply-patch", token: preview.token });
  assert.equal(runtime.messages.at(-1).type, "patched", runtime.messages.at(-1).message);
  assert.deepEqual(clone(runtime.all.get("1:2").relativeTransform), [
    [1, 0, 10],
    [0, 1, 0],
  ]);
  assert.equal(runtime.all.get("1:2").parent.id, "1:1");
});

test("reorder resolves new sibling anchors across permutations while preserving unknown siblings and reviewed deletes", async () => {
  const source = {
    format: "codeshell.figma.source",
    version: 1,
    name: "Order permutations",
    fileKey: "file-a",
    nodes: {
      "0:1": {
        document: page([
          rect("1:1", { name: "A" }),
          rect("1:99", { type: "VECTOR", name: "Unknown X" }),
          rect("1:2", { name: "B" }),
          rect("1:3", { name: "C" }),
          rect("1:98", { type: "VECTOR", name: "Unknown Y" }),
          rect("1:4", { name: "D" }),
        ]),
      },
    },
    assets: {},
    previews: {},
  };
  const imported = await prepareFigmaImport(source),
    binding = createFigmaBinding(imported),
    nodes = new Map(imported.document.nodes.map((node) => [node.name, node]));
  const permutations = (values) =>
    values.length
      ? values.flatMap((value, index) =>
          permutations(values.filter((_, candidate) => candidate !== index)).map((tail) => [
            value,
            ...tail,
          ]),
        )
      : [[]];
  for (const order of permutations(["A", "B", "D", "N"])) {
    const current = clone(imported.document),
      added = { ...clone(nodes.get("A")), id: "new-sibling", name: "N" };
    current.nodes = order.map((name) => (name === "N" ? added : clone(nodes.get(name))));
    current.pages[0].nodes = current.nodes;
    const transfer = createFigmaTransfer(current);
    transfer.patch = createFigmaPatch(binding, current);
    const runtime = harness(source.nodes["0:1"].document);
    await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
    const preview = runtime.messages.at(-1);
    assert.equal(preview.type, "patch-preview", order.join(""));
    assert.deepEqual(preview.conflicts, [], order.join(""));
    await runtime.send({ type: "apply-patch", token: preview.token, allowDeletes: true });
    assert.equal(
      runtime.messages.at(-1).type,
      "patched",
      `${order.join("")}: ${runtime.messages.at(-1).message}`,
    );
    const actual = runtime.figma.currentPage.children;
    assert.deepEqual(
      actual.filter((node) => !node.name.startsWith("Unknown")).map((node) => node.name),
      order,
      order.join(""),
    );
    assert.ok(actual.includes(runtime.all.get("1:99")));
    assert.ok(actual.includes(runtime.all.get("1:98")));
  }
});

test("a directly selected complete v3 file creates all pages, editable text/layout and original image bytes", async () => {
  const { portableFixture, pixel } = await import("./fixtures/figma-plugin-v3.mjs");
  const { preparePluginFile } =
    await import("../../../apps/design-studio/app/figma-plugin/v3-input.mjs");
  const prepared = await preparePluginFile(JSON.stringify(await portableFixture()));
  const h = harness(page([]));
  await h.send({ type: "import-transfer", content: JSON.stringify(prepared.transfer) });
  assert.equal(h.messages.at(-1).type, "imported");
  assert.equal(h.messages.at(-1).pages, 2);
  assert.equal(h.messages.at(-1).nodes, 4);
  assert.equal(h.figma.root.children.length, 3);
  const title = [...h.all.values()].find((node) => node.characters === "Direct v3");
  assert.equal(title.type, "TEXT");
  assert.equal(title.parent.layoutMode, "HORIZONTAL");
  assert.equal(title.parent.itemSpacing, 12);
  assert(
    Object.values(title.pluginData).some((value) => value.includes("codeshell.html.semantic")),
  );
  assert.equal(h.images.size, 1);
  assert.deepEqual(Buffer.from([...h.images.values()][0]), Buffer.from(pixel, "base64"));
  assert.equal(h.figma.root.children[0].name, "Home");
  assert.equal(h.figma.root.children[0].children.length, 0);
});

test("main sandbox decodes multi-megabyte local image payloads without recursive Base64 validation", async () => {
  const { portableFixture, pixel } = await import("./fixtures/figma-plugin-v3.mjs");
  const { preparePluginFile } =
    await import("../../../apps/design-studio/app/figma-plugin/v3-input.mjs");
  const prepared = await preparePluginFile(JSON.stringify(await portableFixture()));
  // A valid PNG with inert trailing bytes exercises the transport size without
  // asking the mock Figma runtime to manufacture or render a large bitmap.
  const bytes = Buffer.concat([Buffer.from(pixel, "base64"), Buffer.alloc(3 * 1024 * 1024)]);
  prepared.transfer.assets.photo.base64 = bytes.toString("base64");
  const h = harness(page([]));
  await h.send({ type: "import-transfer", content: JSON.stringify(prepared.transfer) });
  assert.equal(h.messages.at(-1).type, "imported");
  assert.equal(h.images.size, 1);
  assert.deepEqual(Buffer.from([...h.images.values()][0]), bytes);
});
