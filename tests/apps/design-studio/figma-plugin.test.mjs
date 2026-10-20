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
import { longFigmaSource } from "./fixtures/long-canvas.mjs";
import { measuredWrap, textMetricsSignature, textSourceMetricsSignature } from "../../../apps/design-studio/app/text-metrics.mjs";

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

function harness(source = page([rect()]), { nativeTextLayout = false } = {}) {
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
        if (nativeTextLayout && this.type === "TEXT" && this.textAutoResize === "HEIGHT")
          this.height = this.nativeLines().length * this.fontSize * this.lineHeight.value / 100;
      },
      nativeLines() {
        return measuredWrap(this.characters ?? "", this.width / 10, (value) => ({ width: Array.from(value).length }));
      },
      resizeWithoutConstraints(width, height) {
        this.width = width;
        this.height = height;
      },
      setPluginData(key, value) {
        this.pluginData[key] = value;
      },
      getPluginData(key) {
        return this.pluginData[key] ?? "";
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
    if (["RECTANGLE", "FRAME", "COMPONENT", "INSTANCE", "COMPONENT_SET", "SECTION"].includes(node.type)) {
      let radii = [...(raw.rectangleCornerRadii ?? Array(4).fill(raw.cornerRadius ?? 0))];
      for (const [index, key] of ["topLeftRadius", "topRightRadius", "bottomRightRadius", "bottomLeftRadius"].entries())
        Object.defineProperty(node, key, { enumerable: false, get: () => radii[index], set: (value) => { radii[index] = value; } });
      Object.defineProperty(node, "cornerRadius", { enumerable: false, get: () => radii.every((value) => value === radii[0]) ? radii[0] : undefined, set: (value) => { radii = Array(4).fill(value); } });
    }
    if (node.type === "TEXT") {
      node.characters = raw.characters ?? "";
      node.fontName = { family: raw.style?.fontFamily ?? "Inter", style: "Regular" };
      node.textAutoResize = raw.style?.textAutoResize ?? "NONE";
      node.textTruncation = raw.style?.textTruncation ?? "DISABLED";
      node.maxLines = raw.style?.maxLines ?? null;
    }
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
          if (node[key] !== undefined) raw[key] = clone(node[key]);
    }
    if (node.topLeftRadius !== undefined) {
      raw.rectangleCornerRadii = [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius];
      if (raw.rectangleCornerRadii.every((value) => value === raw.rectangleCornerRadii[0])) raw.cornerRadius = raw.rectangleCornerRadii[0];
      else delete raw.cornerRadius;
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

function fontTransfer(fonts) {
  return createFigmaTransfer(
    importFigmaJson(
      page(
        fonts.map(([fontFamily, fontWeight, characters], index) =>
          rect(`2:${index}`, {
            type: "TEXT",
            characters,
            style: { fontFamily, fontWeight, fontSize: 24 },
          }),
        ),
      ),
    ).document,
  );
}

test("native Figma icon fonts use Solid/Regular styles rather than generic Black weights", async () => {
  const transfer = fontTransfer([
    ["Font Awesome 5 Free", 900, "\uf007"],
    ["Font Awesome 6 Free", 400, "\uf007"],
    ["Font Awesome 5 Brands", 400, "\uf099"],
    ["Font Awesome 6 Brands", 900, "\uf099"],
  ]);
  const runtime = harness();
  const load = runtime.figma.loadFontAsync.bind(runtime.figma);
  runtime.figma.loadFontAsync = async (font) => {
    if (!["Solid", "Regular"].includes(font.style)) throw Error("Font style does not exist");
    return load(font);
  };
  await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "imported");
  assert.deepEqual(
    runtime.calls.filter(([kind]) => kind === "font"),
    [
      ["font", "Font Awesome 5 Free", "Solid"],
      ["font", "Font Awesome 6 Free", "Regular"],
      ["font", "Font Awesome 5 Brands", "Regular"],
      ["font", "Font Awesome 6 Brands", "Regular"],
    ],
  );
  assert.ok(
    runtime.figma.root.children[1].children.every((node) =>
      node.fontName.family.startsWith("Font Awesome"),
    ),
  );
});

test("missing native icon fonts fail preflight before creating pages or substituting Inter", async () => {
  const runtime = harness(),
    before = runtime.figma.root.children.map(runtime.snapshot);
  const load = runtime.figma.loadFontAsync.bind(runtime.figma);
  runtime.figma.loadFontAsync = async (font) => {
    if (font.family.startsWith("Font Awesome")) throw Error("Not installed");
    return load(font);
  };
  await runtime.send({
    type: "import-transfer",
    content: JSON.stringify(
      fontTransfer([
        ["Roboto", 400, "A normal text node before the icon"],
        ["Font Awesome 6 Free", 900, "\ue586"],
      ]),
    ),
  });
  assert.equal(runtime.messages.at(-1).type, "error");
  assert.match(runtime.messages.at(-1).message, /不能回退到 Inter/u);
  assert.deepEqual(runtime.figma.root.children.map(runtime.snapshot), before);
  assert.equal(runtime.all.size, 2);
  assert.equal(
    runtime.calls.some(([kind, family]) => kind === "font" && family === "Inter"),
    false,
  );
});

test("bundled FA5 aliases require the actual FA6 family even when older FA5 is installed", async () => {
  const transfer = fontTransfer([["Font Awesome 5 Free", 900, "\ue586"]]);
  transfer.pages[0].children[0].fontRef = "builtin-fa-solid-5-900-normal";
  const runtime = harness(),
    before = runtime.figma.root.children.map(runtime.snapshot);
  const attempted = [];
  runtime.figma.loadFontAsync = async (font) => {
    attempted.push([font.family, font.style]);
    if (font.family !== "Font Awesome 5 Free") throw Error("FA6 not installed");
  };
  await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "error");
  assert.match(runtime.messages.at(-1).message, /Font Awesome 6 Free Solid 不可用/u);
  assert.deepEqual(attempted, [["Font Awesome 6 Free", "Solid"]]);
  assert.deepEqual(runtime.figma.root.children.map(runtime.snapshot), before);
});

test("bundled FA6 aliases create editable text with every original character while external FA5 keeps its family", async () => {
  const transfer = fontTransfer([
    ["Font Awesome 5 Free", 900, "\uf007\ue586"],
    ["Font Awesome 5 Free", 400, "\uf007"],
    ["Font Awesome 5 Brands", 400, "\uf099"],
    ["Font Awesome 5 Free", 900, "\uf007"],
  ]);
  const texts = transfer.pages[0].children;
  texts[0].fontRef = "builtin-fa-solid-5-900-normal";
  texts[1].fontRef = "builtin-fa-regular-5-400-normal";
  texts[2].fontRef = "builtin-fa-brands-5-400-normal";
  texts[3].fontRef = "custom-fa5-font";
  const before = JSON.stringify(transfer),
    runtime = harness();
  await runtime.send({ type: "import-transfer", content: before });
  assert.equal(runtime.messages.at(-1).type, "imported");
  assert.equal(JSON.stringify(transfer), before);
  assert.deepEqual(
    runtime.figma.root.children[1].children.map((node) => [
      node.type,
      node.fontName.family,
      node.fontName.style,
      node.characters,
    ]),
    [
      ["TEXT", "Font Awesome 6 Free", "Solid", "\uf007\ue586"],
      ["TEXT", "Font Awesome 6 Free", "Regular", "\uf007"],
      ["TEXT", "Font Awesome 6 Brands", "Regular", "\uf099"],
      ["TEXT", "Font Awesome 5 Free", "Solid", "\uf007"],
    ],
  );
  assert.ok(runtime.messages.at(-1).warnings.some((warning) => warning.includes("6.7.2")));
});

test("BMP and supplementary private-use text never reuses a cached ordinary-text fallback", async () => {
  for (const text of ["\ue123", "\u{f0123}", "\u{100123}"]) {
    const runtime = harness(),
      before = runtime.figma.root.children.map(runtime.snapshot);
    const load = runtime.figma.loadFontAsync.bind(runtime.figma);
    runtime.figma.loadFontAsync = async (font) => {
      if (font.family === "Private Glyphs") throw Error("Not installed");
      return load(font);
    };
    await runtime.send({
      type: "import-transfer",
      content: JSON.stringify(
        fontTransfer([
          ["Private Glyphs", 400, "Ordinary text may report a fallback"],
          ["Private Glyphs", 400, text],
        ]),
      ),
    });
    assert.equal(runtime.messages.at(-1).type, "error");
    assert.match(runtime.messages.at(-1).message, /私用区文字不能回退/u);
    assert.deepEqual(runtime.figma.root.children.map(runtime.snapshot), before);
    assert.equal(runtime.all.size, 2);
  }
});

test("an available custom private-use font preserves its exact family and characters", async () => {
  const runtime = harness();
  await runtime.send({
    type: "import-transfer",
    content: JSON.stringify(fontTransfer([["Private Glyphs", 400, "\ue123\u{f0123}\u{100123}"]])),
  });
  assert.equal(runtime.messages.at(-1).type, "imported");
  const node = runtime.figma.root.children[1].children[0];
  assert.equal(node.fontName.family, "Private Glyphs");
  assert.equal(node.characters, "\ue123\u{f0123}\u{100123}");
});

test("native construction failure after font preflight removes only newly created pages", async () => {
  const runtime = harness(),
    before = runtime.figma.root.children.map(runtime.snapshot);
  const transfer = fontTransfer([["Font Awesome 6 Free", 900, "\ue586"]]);
  transfer.pages[0].children[0].name = "Rejected icon";
  runtime.failName("Rejected icon");
  await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "error");
  assert.match(runtime.messages.at(-1).message, /setter rejected/u);
  assert.deepEqual(runtime.figma.root.children.map(runtime.snapshot), before);
});

test("reviewed original-design Font Awesome weight changes load and apply the real Solid style", async () => {
  const source = page([
    rect("1:2", {
      type: "TEXT",
      characters: "\uf007",
      style: { fontFamily: "Font Awesome 5 Free", fontWeight: 400, fontSize: 24 },
    }),
  ]);
  const transfer = patchTransfer(
    source,
    (node) => {
      node.fontWeight = 900;
    },
    ["fontWeight"],
  );
  const runtime = harness(source),
    target = runtime.all.get("1:2");
  target.characters = "\uf007";
  target.fontName = { family: "Font Awesome 5 Free", style: "Regular" };
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  const preview = runtime.messages.at(-1);
  assert.equal(preview.type, "patch-preview");
  assert.deepEqual(preview.conflicts, []);
  await runtime.send({ type: "apply-patch", token: preview.token });
  assert.equal(runtime.messages.at(-1).type, "patched");
  assert.deepEqual(clone(target.fontName), { family: "Font Awesome 5 Free", style: "Solid" });
  assert.equal(
    runtime.calls.some(([kind, , style]) => kind === "font" && style === "Black"),
    false,
  );
});

test("native Figma creation accepts a bounded long canvas without losing any of its 1208 editable layers", async () => {
  const imported = importFigmaJson(longFigmaSource());
  const transfer = createFigmaTransfer(imported.document);
  const runtime = harness();
  await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "imported");
  const frame = runtime.figma.root.children[1].children[0];
  assert.equal(frame.height, 11322);
  assert.equal(frame.width, 4458);
  assert.equal(frame.children.length, 1207);
  const last = imported.document.nodes.at(-1);
  assert.equal(frame.children.at(-1).relativeTransform[1][2], last.y);
  assert.equal(frame.children.at(-1).name, last.name);
});

test("native Figma validation accepts the 20000px canvas edge and rejects a larger canvas before creating pages", async () => {
  const transfer = createFigmaTransfer(importFigmaJson(page([rect()])).document);
  transfer.canvas.width = 20000;
  transfer.canvas.height = 20000;
  const valid = harness();
  await valid.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(valid.messages.at(-1).type, "imported");
  transfer.canvas.height = 20001;
  const invalid = harness();
  await invalid.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(invalid.messages.at(-1).type, "error");
  assert.match(invalid.messages.at(-1).message, /画布尺寸/u);
  assert.equal(invalid.figma.root.children.length, 1);
});

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

async function generatedTranslation(mode = "drag") {
  const source = page([
    rect("1:1", {
      type: "FRAME",
      absoluteBoundingBox: { x: -100, y: -100, width: 300, height: 200 },
      children: [
        rect("1:2", {
          type: "FRAME",
          absoluteBoundingBox: { x: -70, y: -60, width: 150, height: 120 },
          children: [
            rect("1:3", {
              absoluteBoundingBox: { x: -50, y: -40, width: 50, height: 40 },
            }),
          ],
        }),
      ],
    }),
  ]);
  const imported = await prepareFigmaImport(source),
    binding = createFigmaBinding(imported);
  const current = structuredClone(imported.document);
  for (const node of mode === "hold" ? current.nodes.slice(0, 1) : current.nodes) {
    node.x += 20;
    node.y += 10;
  }
  if (mode === "local") {
    current.nodes[2].x += 7;
    current.nodes[2].y -= 3;
    current.nodes[2].fill = "#123456";
  }
  if (mode === "resize") current.nodes[0].width += 40;
  const transfer = createFigmaTransfer(current);
  transfer.patch = createFigmaPatch(binding, current);
  return { source, binding, current, transfer };
}

test("minimal generated parent translations apply the exact final geometry through the native Figma API", async () => {
  for (const mode of ["drag", "local", "hold", "resize"]) {
    const { source, binding, current, transfer } = await generatedTranslation(mode);
    const preserved = JSON.stringify(binding),
      runtime = harness(source);
    const expectedOperations = mode === "drag" ? 1 : mode === "resize" ? 3 : 2;
    assert.equal(transfer.patch.operations.length, expectedOperations, mode);
    await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
    const preview = runtime.messages.at(-1);
    assert.equal(preview.type, "patch-preview", mode);
    assert.deepEqual(preview.conflicts, [], mode);
    await runtime.send({ type: "apply-patch", token: preview.token });
    assert.equal(runtime.messages.at(-1).type, "patched", mode);
    for (const entry of binding.mapping) {
      const expected = current.nodes.find((node) => node.id === entry.designId);
      const actual = runtime.snapshot(runtime.all.get(entry.sourceId)).absoluteBoundingBox;
      assert.deepEqual(
        actual,
        {
          x: expected.x - entry.offsetX,
          y: expected.y - entry.offsetY,
          width: expected.width,
          height: expected.height,
        },
        `${mode}: ${entry.sourceId}`,
      );
    }
    assert.equal(JSON.stringify(binding), preserved);
    if (mode === "drag")
      assert.deepEqual(clone(runtime.all.get("1:3").relativeTransform), [
        [1, 0, 20],
        [0, 1, 20],
      ]);
  }
});

test("minimal parent updates preserve an external descendant move but still detect external parent geometry changes", async () => {
  const { source, transfer } = await generatedTranslation();
  const runtime = harness(source);
  runtime.all.get("1:3").relativeTransform[0][2] += 11;
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  const preview = runtime.messages.at(-1);
  assert.deepEqual(preview.conflicts, []);
  await runtime.send({ type: "apply-patch", token: preview.token });
  assert.equal(runtime.messages.at(-1).type, "patched");
  assert.equal(runtime.snapshot(runtime.all.get("1:3")).absoluteBoundingBox.x, -19);
  assert.equal(runtime.all.get("1:3").relativeTransform[0][2], 31);
  const changedParent = harness(source);
  changedParent.all.get("1:1").relativeTransform[0][2] += 2;
  await changedParent.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  assert.ok(changedParent.messages.at(-1).conflicts.length > 0);
  const token = changedParent.messages.at(-1).token;
  await changedParent.send({ type: "apply-patch", token });
  assert.equal(changedParent.messages.at(-1).type, "error");
  assert.equal(changedParent.all.get("1:1").relativeTransform[0][2], -98);
});

test("shallow generated update snapshots retain style concurrency guards without comparing descendants", async () => {
  const { source, binding } = await generatedTranslation();
  const current = importFigmaJson(source).document;
  current.nodes[0].fill = "#123456";
  const transfer = createFigmaTransfer(current);
  transfer.patch = createFigmaPatch(binding, current);
  assert.equal(transfer.patch.operations[0].before.children, undefined);
  const runtime = harness(source),
    target = runtime.all.get("1:1");
  target.fills = [{ type: "SOLID", color: { r: 0, g: 1, b: 0 } }];
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  assert.ok(runtime.messages.at(-1).conflicts.some((value) => value.includes("fills")));
  const token = runtime.messages.at(-1).token;
  await runtime.send({ type: "apply-patch", token });
  assert.equal(runtime.messages.at(-1).type, "error");
  assert.deepEqual(clone(target.fills), [{ type: "SOLID", color: { r: 0, g: 1, b: 0 } }]);
});

test("generated subtree deletes still reject an externally changed descendant before removing anything", async () => {
  const { source, binding } = await generatedTranslation();
  const current = importFigmaJson(source).document;
  current.nodes.splice(0);
  const transfer = createFigmaTransfer(current);
  transfer.patch = createFigmaPatch(binding, current);
  assert.equal(transfer.patch.operations[0].op, "delete");
  assert.equal(transfer.patch.operations[0].before.children[0].children[0].id, "1:3");
  const runtime = harness(source);
  runtime.all.get("1:3").name = "External descendant edit";
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  assert.ok(runtime.messages.at(-1).conflicts.length > 0);
  const token = runtime.messages.at(-1).token;
  await runtime.send({ type: "apply-patch", token, allowDeletes: true });
  assert.equal(runtime.messages.at(-1).type, "error");
  assert.equal(runtime.all.get("1:1").removed, undefined);
  assert.equal(runtime.all.get("1:3").name, "External descendant edit");
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

test("Bridge creates native editable linear-gradient text and layered fills without raster fallback", async () => {
  const gradient = {
    type: "GRADIENT_LINEAR",
    gradientHandlePositions: [
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
      { x: 0, y: 1 },
    ],
    gradientStops: [
      { position: 0, color: { r: 0, g: 0, b: 1, a: 1 } },
      { position: 1, color: { r: 1, g: 0, b: 0, a: 0.5 } },
    ],
  };
  const source = page([
    rect("1:2", {
      fills: [
        { type: "SOLID", color: { r: 1, g: 1, b: 1 } },
        { type: "SOLID", color: { r: 0.04, g: 0.05, b: 0.15 } },
      ],
    }),
    rect("1:3", {
      type: "TEXT",
      characters: "Gradient",
      fills: [gradient],
      style: { fontFamily: "Inter", fontSize: 20, fontWeight: 400, lineHeightPx: 24 },
    }),
  ]);
  const imported = importFigmaJson(source);
  const transfer = createFigmaTransfer(imported.document);
  const runtime = harness();
  await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "imported");
  const created = runtime.figma.root.children[1].children;
  assert.equal(created[0].fills.length, 2);
  assert.equal(created[0].fills[1].color.b, 38 / 255);
  assert.equal(created[1].type, "TEXT");
  assert.equal(created[1].characters, "Gradient");
  assert.equal(created[1].fills[0].type, "GRADIENT_LINEAR");
  assert.equal(created[1].fills[0].gradientStops[1].color.a, 0.5);
  const exportRuntime = harness(source);
  exportRuntime.all.get("1:3").characters = "Gradient";
  exportRuntime.all.get("1:3").fontName = { family: "Inter", style: "Regular" };
  await exportRuntime.send({ type: "export-json", scope: "page" });
  const exported = JSON.parse(exportRuntime.messages.at(-1).content);
  assert.equal(Object.keys(exported.previews).length, 0);
});

const authoredCopy = "Text wraps across ordinary block flow when the parent frame becomes narrower.";
const capturedCopy = "Text wraps across ordinary block flow when the parent frame \nbecomes narrower.";
function nativeTextFixture(characters = authoredCopy) {
  return page([{ id: "1:1", type: "FRAME", name: "Editable flow", layoutMode: "VERTICAL",
    absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 240 }, children: [{
      id: "1:2", type: "TEXT", name: "Editable copy", characters,
      absoluteBoundingBox: { x: 0, y: 0, width: 600, height: 48 },
      layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG",
      style: { fontFamily: "Arial", fontSize: 20, fontWeight: 400, lineHeightPx: 24, textAutoResize: "HEIGHT" },
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
    }] }]);
}
function recordWrappedCopy(node, display = capturedCopy) {
  node.text = display;
  const count = display.split("\n").length;
  node.textMetrics = { version: 1, signature: textMetricsSignature(node), sourceSignature: textSourceMetricsSignature(node),
    lineWidths: Array(count).fill(100), lineInkBounds: Array.from({ length: count }, () => ({ x: 0, y: 0, width: 100, height: 20 })),
    height: count * 24, fontAvailable: true };
}

test("production native creation keeps authored text characters and rewraps after native resize without browser soft newlines", async () => {
  const imported = importFigmaJson(nativeTextFixture());
  const text = imported.document.nodes.find((node) => node.type === "text");
  recordWrappedCopy(text);
  const transfer = createFigmaTransfer(imported.document), runtime = harness(page([]), { nativeTextLayout: true });
  await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "imported");
  const created = [...runtime.all.values()].find((node) => node.type === "TEXT");
  assert.equal(created.characters, authoredCopy);
  assert.equal(created.layoutSizingHorizontal, "FILL");
  assert.equal(created.layoutSizingVertical, "HUG");
  assert.equal(created.textAutoResize, "HEIGHT");
  created.resize(400, created.height);
  assert.equal(created.nativeLines().length, 2);
  assert.equal(measuredWrap(capturedCopy, 40, (value) => ({ width: value.length })).length, 3,
    "The previously exported hard newline would freeze an extra native line");
  assert.equal(created.height, 48);
  assert.equal(created.characters, authoredCopy);
  const explicit = "  original indentation  \n\n\tsecond line with trailing spaces  ";
  const preformatted = harness(page([]));
  await preformatted.send({ type: "import-transfer", content: JSON.stringify(createFigmaTransfer(importFigmaJson(nativeTextFixture(explicit)).document)) });
  assert.equal([...preformatted.all.values()].find((node) => node.type === "TEXT").characters, explicit);
});

test("native patches ignore soft-wrap content changes, apply source edits, and retain character concurrency guards", async () => {
  const original = nativeTextFixture(), result = await prepareFigmaImport(original);
  const text = result.document.nodes.find((node) => node.type === "text");
  recordWrappedCopy(text);
  const binding = createFigmaBinding(result);
  recordWrappedCopy(text, "Text wraps across ordinary block flow \nwhen the parent frame becomes narrower.");
  const wrapOnly = createFigmaPatch(binding, result.document);
  assert.equal(wrapOnly.operations.length, 0, "Browser line wrapping is not a native character edit");
  text.textSource = "Edited authored content\n\nkeeps its explicit lines.";
  const transfer = createFigmaTransfer(result.document);
  transfer.patch = createFigmaPatch(binding, result.document);
  assert(transfer.patch.operations[0].changed.includes("text"));
  assert(transfer.patch.operations[0].changed.includes("textSource"));
  const runtime = harness(original);
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  const preview = runtime.messages.at(-1);
  assert.equal(preview.type, "patch-preview", preview.message);
  assert.deepEqual(preview.conflicts, []);
  await runtime.send({ type: "apply-patch", token: preview.token });
  assert.equal(runtime.messages.at(-1).type, "patched");
  assert.equal(runtime.all.get("1:2").characters, text.textSource);
  const concurrent = harness(original);
  concurrent.all.get("1:2").characters = "Externally edited original Figma content";
  await concurrent.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  assert(concurrent.messages.at(-1).conflicts.some((message) => message.includes("characters")));
});

test("native creation uses native truncation with full source, rejects malformed sources, and does not restore stale text", async () => {
  const result = importFigmaJson(nativeTextFixture("Full authored content remains editable"));
  const text = result.document.nodes.find((node) => node.type === "text");
  text.text = "Full authored…";
  text.textOverflow = "ellipsis";
  delete text.textFlow;
  text.layoutSizingVertical = "fixed";
  const runtime = harness(page([]));
  await runtime.send({ type: "import-transfer", content: JSON.stringify(createFigmaTransfer(result.document)) });
  const created = [...runtime.all.values()].find((node) => node.type === "TEXT");
  assert.equal(created.characters, text.textSource);
  assert.equal(created.textTruncation, "ENDING");
  assert.equal(created.maxLines, 1);
  await runtime.send({ type: "export-json", scope: "page" });
  const exported = JSON.parse(runtime.messages.at(-1).content);
  const restored = importFigmaJson(exported).document.nodes.find((node) => node.type === "text");
  assert.equal(restored.textSource, text.textSource);
  assert.equal(restored.textOverflow, "ellipsis");
  assert.equal(restored.textFlow, undefined);
  const stale = importFigmaJson(nativeTextFixture());
  const staleText = stale.document.nodes.find((node) => node.type === "text");
  recordWrappedCopy(staleText);
  staleText.text = "Edited visible text\nwith a hard line.";
  const changed = harness(page([]));
  await changed.send({ type: "import-transfer", content: JSON.stringify(createFigmaTransfer(stale.document)) });
  assert.equal([...changed.all.values()].find((node) => node.type === "TEXT").characters, staleText.text);
  for (const invalid of ["x".repeat(4001), { text: "not a string" }]) {
    const transfer = createFigmaTransfer(result.document);
    transfer.pages[0].children[0].children[0].textSource = invalid;
    const isolated = harness(page([]));
    await isolated.send({ type: "import-transfer", content: JSON.stringify(transfer) });
    assert.equal(isolated.messages.at(-1).type, "error");
    assert.equal(isolated.figma.root.children.length, 1);
  }
});

test("source-bound native truncation patches preserve authored characters and clear live export metadata", async () => {
  const source = nativeTextFixture("A full original label with editable authored characters");
  const raw = source.children[0].children[0];
  raw.style.textTruncation = "ENDING";
  raw.style.maxLines = 1;
  const result = await prepareFigmaImport(source);
  const binding = createFigmaBinding(result);
  const text = result.document.nodes.find((node) => node.type === "text");
  assert.equal(text.textOverflow, "ellipsis");
  delete text.textOverflow;
  const transfer = createFigmaTransfer(result.document);
  transfer.patch = createFigmaPatch(binding, result.document);
  const runtime = harness(source);
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  const preview = runtime.messages.at(-1);
  assert.equal(preview.type, "patch-preview", preview.message);
  assert.deepEqual(preview.conflicts, []);
  await runtime.send({ type: "apply-patch", token: preview.token });
  const actual = runtime.all.get("1:2");
  assert.equal(actual.characters, raw.characters);
  assert.equal(actual.textTruncation, "DISABLED");
  assert.equal(actual.maxLines, null);
  await runtime.send({ type: "export-json", scope: "page" });
  const exported = JSON.parse(runtime.messages.at(-1).content);
  const restored = importFigmaJson(exported).document.nodes.find((node) => node.type === "text");
  assert.equal(restored.textSource, raw.characters);
  assert.equal(restored.textOverflow, undefined);
});

test("CSS gradient native import retains bounded source and marks native resize intent inactive on official JSON roundtrip", async () => {
  const { cssLinearBackgroundPaints } =
    await import("../../../apps/design-studio/app/css-linear-gradient.mjs");
  const { designPaintsToFigma } = await import("../../../apps/design-studio/app/paint.mjs");
  const imported = importFigmaJson(
    page([
      rect("1:2", {
        absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 160 },
      }),
    ]),
  );
  const layer = imported.document.nodes[0];
  layer.fillPaints = cssLinearBackgroundPaints(
    { "background-image": "linear-gradient(45deg, rgb(255,0,0) 20px, rgb(0,0,255) 80%)" },
    640,
    160,
  );
  const transfer = createFigmaTransfer(imported.document),
    runtime = harness();
  await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "imported");
  assert(runtime.messages.at(-1).warnings.some((w) => w.includes("CSS")));
  const created = runtime.figma.root.children[1].children[0];
  assert.deepEqual(clone(created.fills), designPaintsToFigma(layer));
  assert.equal(
    JSON.parse(created.getPluginData("codeshellCssLinearSource")).paints[0].cssLinear.direction
      .angle,
    45,
  );
  runtime.figma.currentPage = created.parent;
  runtime.figma.currentPage.selection = [created];
  await runtime.send({ type: "export-json", scope: "selection" });
  const initial = JSON.parse(runtime.messages.at(-1).content);
  assert.equal(
    importFigmaJson(initial).document.nodes[0].fillPaints[0].cssLinear.sourceOnly,
    undefined,
  );
  created.resize(400, 160);
  await runtime.send({ type: "export-json", scope: "selection" });
  const exported = JSON.parse(runtime.messages.at(-1).content);
  assert(exported.nodes[created.id].document.codeshellCssLinearSource);
  const reopened = importFigmaJson(exported);
  assert.equal(reopened.document.nodes[0].fillPaints[0].cssLinear.sourceOnly, true);
  assert(reopened.warnings.some((w) => w.code === "css-gradient-native-source"));
  const invalid = clone(transfer);
  invalid.pages[0].children[0].fillPaints[0].cssLinear.positions[0].value = 20001;
  const rejected = harness();
  await rejected.send({ type: "import-transfer", content: JSON.stringify(invalid) });
  assert.equal(rejected.messages.at(-1).type, "error");
  assert.equal(
    rejected.figma.root.children.length,
    1,
    "descriptor rejected before native mutation",
  );
  const extreme = clone(transfer);
  extreme.pages[0].children[0].width = 1;
  extreme.pages[0].children[0].height = 20000;
  const bounded = harness();
  await bounded.send({ type: "import-transfer", content: JSON.stringify(extreme) });
  assert.equal(bounded.messages.at(-1).type, "error");
  assert.match(bounded.messages.at(-1).message, /±100/u);
  assert.equal(
    bounded.figma.root.children.length,
    1,
    "resolved native handle bounds are checked before mutation",
  );
});

test("reviewed CSS gradient resize recomputes current native geometry and guards concurrent paint edits", async () => {
  const { cssLinearBackgroundPaints } =
    await import("../../../apps/design-studio/app/css-linear-gradient.mjs");
  const { cssLinearSourceSnapshot, designPaintsToFigma } =
    await import("../../../apps/design-studio/app/paint.mjs");
  const fillPaints = cssLinearBackgroundPaints(
    { "background-image": "linear-gradient(45deg, rgb(255,0,0) 20px, rgb(0,0,255))" },
    640,
    160,
  );
  const canonical = { fillPaints, width: 640, height: 160 };
  const snapshot = cssLinearSourceSnapshot(canonical);
  const source = page([
    rect("1:2", {
      absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 160 },
      fills: designPaintsToFigma(canonical),
      codeshellCssLinearSource: snapshot,
    }),
  ]);
  const imported = await prepareFigmaImport(source),
    binding = createFigmaBinding(imported);
  imported.document.nodes[0].width = 400;
  const transfer = createFigmaTransfer(imported.document);
  transfer.patch = createFigmaPatch(binding, imported.document);
  const runtime = harness(source);
  runtime.all.get("1:2").setPluginData("codeshellCssLinearSource", JSON.stringify(snapshot));
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  const preview = runtime.messages.at(-1);
  assert.equal(preview.type, "patch-preview");
  assert.deepEqual(preview.conflicts, []);
  await runtime.send({ type: "apply-patch", token: preview.token });
  assert.equal(runtime.messages.at(-1).type, "patched");
  assert.deepEqual(
    clone(runtime.all.get("1:2").fills),
    designPaintsToFigma({ ...canonical, width: 400 }),
  );
  const concurrent = harness(source);
  concurrent.all.get("1:2").setPluginData("codeshellCssLinearSource", JSON.stringify(snapshot));
  concurrent.all.get("1:2").fills[0].gradientStops[0].color.r = 0.2;
  await concurrent.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  assert(concurrent.messages.at(-1).conflicts.some((message) => message.includes("fills")));
});

test("reviewed HUG text gradients resolve after native typography setters and guard concurrent paints", async () => {
  const { cssLinearBackgroundPaints } = await import("../../../apps/design-studio/app/css-linear-gradient.mjs");
  const { cssLinearSourceSnapshot, designPaintsToFigma } = await import("../../../apps/design-studio/app/paint.mjs");
  const fillPaints = cssLinearBackgroundPaints({ "background-image": "linear-gradient(45deg,rgb(255,0,0),rgb(0,0,255))" }, 200, 24);
  const original = { fillPaints, width: 200, height: 24 }, sourceData = cssLinearSourceSnapshot(original);
  const source = page([rect("1:2", { type: "TEXT", characters: "Gradient", absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 24 },
    style: { fontFamily: "Arial", fontSize: 20, fontWeight: 400, lineHeightPx: 24, textAutoResize: "HEIGHT" },
    fills: designPaintsToFigma(original), codeshellCssLinearSource: sourceData })]);
  for (const change of [{ fontSize: 32, height: 38.4 }, { lineHeight: 2, height: 40 }]) {
    const imported = await prepareFigmaImport(source), binding = createFigmaBinding(imported);
    Object.assign(imported.document.nodes[0], change);
    const transfer = createFigmaTransfer(imported.document); transfer.patch = createFigmaPatch(binding, imported.document);
    const runtime = harness(source), target = runtime.all.get("1:2");
    target.setPluginData("codeshellCssLinearSource", JSON.stringify(sourceData));
    let size = 20, lineHeight = { unit: "PERCENT", value: 120 };
    Object.defineProperty(target, "fontSize", { get: () => size, set(value) { size = value; this.height = size * lineHeight.value / 100; } });
    Object.defineProperty(target, "lineHeight", { get: () => lineHeight, set(value) { lineHeight = value; this.height = size * value.value / 100; } });
    target.resize = function(width) { this.width = width; this.height = size * lineHeight.value / 100; };
    await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
    const preview = runtime.messages.at(-1); assert.equal(preview.type, "patch-preview"); assert.deepEqual(preview.conflicts, []);
    await runtime.send({ type: "apply-patch", token: preview.token }); assert.equal(runtime.messages.at(-1).type, "patched");
    assert.equal(target.height, change.height);
    assert.deepEqual(clone(target.fills), designPaintsToFigma({ ...original, height: change.height }));
    assert.equal(JSON.parse(target.getPluginData("codeshellCssLinearSource")).height, change.height);
  }
  const imported = await prepareFigmaImport(source), binding = createFigmaBinding(imported);
  imported.document.nodes[0].fontSize = 32;
  const transfer = createFigmaTransfer(imported.document); transfer.patch = createFigmaPatch(binding, imported.document);
  const concurrent = harness(source); concurrent.all.get("1:2").setPluginData("codeshellCssLinearSource", JSON.stringify(sourceData));
  concurrent.all.get("1:2").fills[0].gradientStops[0].color.r = 0.2;
  await concurrent.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  assert(concurrent.messages.at(-1).conflicts.some(message => message.includes("fills")));
});

test("independent circular corners use native editable properties and export live values", async () => {
  const source = page([rect("1:2", { rectangleCornerRadii: [8, 24, 0, 16] })]);
  const imported = importFigmaJson(source), transfer = createFigmaTransfer(imported.document);
  const runtime = harness();
  await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "imported");
  const created = runtime.figma.root.children[1].children[0];
  assert.deepEqual([created.topLeftRadius, created.topRightRadius, created.bottomRightRadius, created.bottomLeftRadius], [8, 24, 0, 16]);
  created.topRightRadius = 30;
  runtime.figma.currentPage = runtime.figma.root.children[1];
  runtime.figma.currentPage.selection = [created];
  await runtime.send({ type: "export-json", scope: "selection" });
  assert.equal(runtime.messages.at(-1).type, "exported");
  const exported = JSON.parse(runtime.messages.at(-1).content);
  assert.deepEqual(exported.nodes[created.id].document.rectangleCornerRadii, [8, 30, 0, 16]);
  assert.deepEqual(importFigmaJson(exported).document.nodes[0].cornerRadii, [8, 30, 0, 16]);
  for (const invalid of [[1, 2, 3], [1, 2, 3, -1], [1, 2, 3, 10000]]) {
    const invalidTransfer = clone(transfer); invalidTransfer.pages[0].children[0].cornerRadii = invalid;
    const isolated = harness();
    await isolated.send({ type: "import-transfer", content: JSON.stringify(invalidTransfer) });
    assert.equal(isolated.messages.at(-1).type, "error");
    assert.equal(isolated.figma.root.children.length, 1);
  }
});

test("reviewed corner edits retain conflict guards and update native radii atomically", async () => {
  const source = page([rect("1:2", { rectangleCornerRadii: [8, 24, 0, 16] })]);
  const result = await prepareFigmaImport(source), binding = createFigmaBinding(result);
  result.document.nodes[0].cornerRadii = [4, 12, 20, 28];
  const transfer = createFigmaTransfer(result.document);
  transfer.patch = createFigmaPatch(binding, result.document);
  assert.ok(transfer.patch.operations[0].changed.includes("cornerRadii"));
  const runtime = harness(source);
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  let preview = runtime.messages.at(-1); assert.equal(preview.type, "patch-preview"); assert.deepEqual(preview.conflicts, []);
  await runtime.send({ type: "apply-patch", token: preview.token });
  assert.equal(runtime.messages.at(-1).type, "patched");
  const node = runtime.all.get("1:2");
  assert.deepEqual([node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius], [4, 12, 20, 28]);
  const concurrent = harness(source), external = concurrent.all.get("1:2");
  [external.topLeftRadius, external.topRightRadius, external.bottomRightRadius, external.bottomLeftRadius] = [9, 24, 0, 16];
  await concurrent.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  preview = concurrent.messages.at(-1);
  assert.equal(preview.type, "patch-preview"); assert.ok(preview.conflicts.length > 0);
});


test("uniform REST corner baselines do not falsely conflict and clearing a tuple resets all SDK corners", async () => {
  for (const original of [{ cornerRadius: 8 }, { rectangleCornerRadii: [8, 24, 0, 16] }]) {
    const source = page([rect("1:2", original)]);
    const result = await prepareFigmaImport(source), binding = createFigmaBinding(result);
    result.document.nodes[0].cornerRadius = 12;
    delete result.document.nodes[0].cornerRadii;
    const transfer = createFigmaTransfer(result.document); transfer.patch = createFigmaPatch(binding, result.document);
    const runtime = harness(source);
    await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
    const preview = runtime.messages.at(-1);
    assert.equal(preview.type, "patch-preview"); assert.deepEqual(preview.conflicts, []);
    await runtime.send({ type: "apply-patch", token: preview.token });
    assert.equal(runtime.messages.at(-1).type, "patched");
    const node = runtime.all.get("1:2");
    assert.deepEqual([node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius], [12, 12, 12, 12]);
  }
});


test("absolute native text creation projects a canonical hanging origin back to its line box", async () => {
  const input = page([rect("1:2", { type: "TEXT", characters: "Native line box", absoluteBoundingBox: { x: 30, y: 40, width: 100, height: 24 }, style: { fontFamily: "Arial", fontSize: 20, fontWeight: 400, lineHeightPx: 24, textAutoResize: "HEIGHT" } })]);
  const result = importFigmaJson(input);
  const node = result.document.nodes[0];
  node.layoutBaselineOffset = 7.125;
  node.y += node.layoutBaselineOffset;
  const runtime = harness();
  await runtime.send({ type: "import-transfer", content: JSON.stringify(createFigmaTransfer(result.document)) });
  assert.equal(runtime.messages.at(-1).type, "imported");
  const native = runtime.figma.root.children[1].children[0];
  assert.equal(native.relativeTransform[0][2], 30);
  assert.equal(native.relativeTransform[1][2], 40);
  assert.equal(native.height, 24);
});


test("font baseline metadata changes preserve the native line-box position and emit no geometry update", async () => {
  const input = page([rect("1:2", { type: "TEXT", characters: "Baseline", absoluteBoundingBox: { x: 30, y: 40, width: 200, height: 24 }, style: { fontFamily: "Arial", fontSize: 20, fontWeight: 400, lineHeightPx: 24, textAutoResize: "HEIGHT" } })]);
  const result = await prepareFigmaImport(input);
  const node = result.document.nodes[0];
  node.layoutBaselineOffset = 4.59; node.y += 4.59;
  const binding = createFigmaBinding(result);
  node.fontFamily = "Courier New"; node.layoutBaselineOffset = 3.41; node.y = 43.41;
  const transfer = createFigmaTransfer(result.document); transfer.patch = createFigmaPatch(binding, result.document);
  assert.equal(transfer.patch.operations.length, 1);
  const operation = transfer.patch.operations[0];
  assert.deepEqual(operation.changed, ["fontFamily"]);
  assert.ok(!operation.changed.some((key) => ["x", "y", "width", "height", "rotation"].includes(key)));
  const runtime = harness(input);
  runtime.all.get("1:2").characters = "Baseline";
  runtime.all.get("1:2").fontName = { family: "Arial", style: "Regular" };
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  const preview = runtime.messages.at(-1); assert.equal(preview.type, "patch-preview", JSON.stringify(preview)); assert.deepEqual(preview.conflicts, []);
  await runtime.send({ type: "apply-patch", token: preview.token });
  assert.equal(runtime.messages.at(-1).type, "patched");
  const native = runtime.all.get("1:2");
  assert.equal(native.relativeTransform[1][2], 40);
  assert.equal(native.fontName.family, "Courier New");
});

test("logical native text y ignores cancellation noise but preserves actual motion", async () => {
  const input = page([rect("1:2", { type: "TEXT", characters: "Fractional", absoluteBoundingBox: { x: 30, y: 0.1, width: 200, height: 24 }, style: { fontFamily: "Arial", fontSize: 20, fontWeight: 400, lineHeightPx: 24, textAutoResize: "HEIGHT" } })]);
  const result = await prepareFigmaImport(input);
  const node = result.document.nodes[0]; node.y = 2.8; node.layoutBaselineOffset = 2.7;
  const binding = createFigmaBinding(result);
  node.y = 3.5; node.layoutBaselineOffset = 3.4;
  assert.equal(createFigmaPatch(binding, result.document).operations.length, 0, "baseline-only metadata has no native update");
  node.fontFamily = "Courier New";
  const patch = createFigmaPatch(binding, result.document);
  assert.ok(!patch.operations[0].changed.includes("y"));
  node.y += 0.01;
  assert.ok(createFigmaPatch(binding, result.document).operations[0].changed.includes("y"));
});

test("outgoing own-rotated hanging text diagnoses the unsupported native origin mapping", () => {
  const result = importFigmaJson(page([rect("1:2", { type: "TEXT", characters: "Rotated", style: { fontFamily: "Arial", fontSize: 20, fontWeight: 400, lineHeightPx: 24 } })]));
  Object.assign(result.document.nodes[0], { rotation: 30, layoutBaselineOffset: 4.59 });
  const transfer = createFigmaTransfer(result.document);
  assert.ok(transfer.warnings.some((warning) => warning.code === "text-baseline-export"));
});
