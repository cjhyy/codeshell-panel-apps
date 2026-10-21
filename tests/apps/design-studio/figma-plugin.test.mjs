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
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { editDesignStrokeColor, editDesignStrokeAlignment, editDesignStrokeWidth } from "../../../apps/design-studio/app/stroke.mjs";
import { longFigmaSource } from "./fixtures/long-canvas.mjs";
import { measuredWrap, textMetricsSignature, textSourceMetricsSignature } from "../../../apps/design-studio/app/text-metrics.mjs";
import { plainFixture } from "./fixtures/figma-plugin-v3.mjs";
import { installNativeTextRangeSdkMock } from "./fixtures/native-text-sdk.mjs";

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

function harness(source = page([rect()]), { nativeTextLayout = false, nativeStrokes = false, nativeTextRanges = false, nativeImageLayout = false } = {}) {
  const all = new Map(),
    nativeRangeMocks = new WeakMap(), mixed = Symbol("mixed"),
    messages = [],
    fonts = new Set(),
    images = new Map(),
    undo = [],
    calls = [];
  let serial = 100,
    failName = null, failRangeName = null;
  let toRuntime = clone;
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
      ...(nativeTextRanges ? { effects: clone(raw.effects ?? []), blendMode: raw.blendMode ?? "PASS_THROUGH" } : {}),
      layoutMode: raw.layoutMode ?? "NONE",
      ...(raw.itemSpacing !== undefined ? { itemSpacing: raw.itemSpacing } : {}),
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
          this.height = this.nativeLines().length * (this.lineHeight.unit === "PIXELS"
            ? this.lineHeight.value : this.fontSize * this.lineHeight.value / 100);
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
        return toRuntime({ document: snapshot(this), components: {}, styles: {} });
      },
    };
    if (["RECTANGLE", "FRAME", "COMPONENT", "INSTANCE", "COMPONENT_SET", "SECTION"].includes(node.type)) {
      if (nativeStrokes) {
        const names=["Top","Right","Bottom","Left"];
        let weights=names.map(side=>raw[`stroke${side}Weight`]??raw.individualStrokeWeights?.[side.toLowerCase()]??raw.strokeWeight??0);
        names.forEach((side,i)=>Object.defineProperty(node,`stroke${side}Weight`,{get:()=>weights[i],set:v=>{weights[i]=v;}}));
        Object.defineProperty(node,"strokeWeight",{get:()=>weights.every(v=>v===weights[0])?weights[0]:undefined,set:v=>{weights=Array(4).fill(v);}});
        node.strokeAlign=raw.strokeAlign??"CENTER";
        if (["FRAME", "COMPONENT", "INSTANCE", "COMPONENT_SET"].includes(node.type)) {
          let included = raw.strokesIncludedInLayout ?? false;
          Object.defineProperty(node, "strokesIncludedInLayout", {
            get: () => included,
            set: (value) => {
              if (node.layoutMode === "NONE")
                throw new Error("Can only set strokesIncludedInLayout on nodes with layoutMode !== NONE");
              included = value;
            },
          });
        }
        for(const side of names)node[`padding${side}`]=raw[`padding${side}`]??0;
      }
      let radii = [...(raw.rectangleCornerRadii ?? Array(4).fill(raw.cornerRadius ?? 0))];
      for (const [index, key] of ["topLeftRadius", "topRightRadius", "bottomRightRadius", "bottomLeftRadius"].entries())
        Object.defineProperty(node, key, { enumerable: false, get: () => radii[index], set: (value) => { radii[index] = value; } });
      Object.defineProperty(node, "cornerRadius", { enumerable: false, get: () => radii.every((value) => value === radii[0]) ? radii[0] : undefined, set: (value) => { radii = Array(4).fill(value); } });
    }
    if (node.type === "TEXT") {
      if (nativeTextRanges) {
        node.rangeWrites = [];
        for (const method of ["setRangeHyperlink", "setRangeFills", "setRangeTextDecoration"])
          node[method] = (...args) => {
            calls.push([method, node.id]);
            if (method === failRangeName) throw new Error("Native range setter failed");
            node.rangeWrites.push([method, ...clone(args)]);
          };
      }
      if (nativeStrokes) { node.strokeWeight = raw.strokeWeight ?? 1; node.strokeAlign = raw.strokeAlign ?? "CENTER"; }
      node.characters = raw.characters ?? "";
      node.fontName = { family: raw.style?.fontFamily ?? "Inter", style: "Regular" };
      node.textAutoResize = raw.style?.textAutoResize ?? "NONE";
      node.textTruncation = raw.style?.textTruncation ?? "DISABLED";
      node.maxLines = raw.style?.maxLines ?? null;
      if (nativeTextLayout) {
        let size = raw.style?.fontSize ?? 12;
        let advance = raw.style?.lineHeightUnit === "PIXELS"
          ? { unit: "PIXELS", value: raw.style.lineHeightPx }
          : { unit: "PERCENT", value: raw.style?.lineHeightPercentFontSize ?? 120 };
        const refresh = () => {
          if (node.textAutoResize === "HEIGHT") node.height = node.nativeLines().length *
            (advance.unit === "PIXELS" ? advance.value : size * advance.value / 100);
        };
        Object.defineProperty(node, "fontSize", { enumerable: true, get: () => size,
          set: value => { size = value; refresh(); } });
        Object.defineProperty(node, "lineHeight", { enumerable: true, get: () => advance,
          set: value => { advance = value; refresh(); } });
      }
    }
    if (nativeImageLayout && ["RECTANGLE", "FRAME"].includes(node.type)) {
      for (const [axis, size, edges] of [["Horizontal", "width", ["Left", "Right"]], ["Vertical", "height", ["Top", "Bottom"]]]) {
        let mode = "FIXED";
        Object.defineProperty(node, `layoutSizing${axis}`, { get: () => mode, set: (value) => {
          mode = value;
          if (value === "FILL" && node.parent?.layoutMode !== "NONE") {
            const parent = node.parent;
            node[size] = parent[size] - edges.reduce((sum, edge) => sum + (parent[`padding${edge}`] ?? 0) +
              (parent.strokesIncludedInLayout && parent.strokeAlign === "INSIDE" ? parent[`stroke${edge}Weight`] ?? parent.strokeWeight ?? 0 : 0), 0);
          }
        } });
      }
      let align = "INHERIT";
      Object.defineProperty(node, "layoutAlign", { get: () => align, set: value => {
        align = value;
        if (value === "STRETCH") node[`layoutSizing${node.parent.layoutMode === "VERTICAL" ? "Horizontal" : "Vertical"}`] = "FILL";
      } });
    }
    if (nativeTextRanges && node.type === "TEXT")
      nativeRangeMocks.set(node, installNativeTextRangeSdkMock(node, { mixed, toRuntime: value => toRuntime(value) }));
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
      const currentFills = node.fills === mixed && nativeRangeMocks.has(node) ? [] : node.fills;
      raw.fills = clone(currentFills).map((paint) =>
        paint.type === "IMAGE" && paint.imageHash
          ? { ...paint, imageRef: paint.imageHash, imageHash: undefined }
          : paint,
      );
      if (nativeStrokes || node.raw.strokes) raw.strokes = clone(node.strokes);
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
    return nativeRangeMocks.has(node) ? nativeRangeMocks.get(node).projectRest(raw) : raw;
  }
  const initial = make(source),
    root = {
      id: "0:0", type: "DOCUMENT",
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
    pluginId: "test-codeshell-native-factory",
    mixed,
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
      const node = make({ id: `1:${++serial}`, type, name: "Created", ...(nativeStrokes && type === "FRAME" ? { strokesIncludedInLayout: true } : {}) });
      figma.currentPage.appendChild(node);
      return node;
    };
  const context = vm.createContext({ figma, __html__: "UI", Uint8Array, ArrayBuffer });
  const parseRuntime = vm.runInContext("JSON.parse", context);
  toRuntime = value => parseRuntime(JSON.stringify(value));
  // SDK value records belong to the plugin realm; cross-realm host objects
  // are deliberately refused by the production owned-data proof.
  for (const node of all.values()) for (const key of ["fills", "strokes", "effects", "fontName", "lineHeight", "letterSpacing"])
    if (node[key] && node[key] !== mixed) node[key] = toRuntime(node[key]);
  vm.runInContext(code, context);
  return {
    figma,
    all,
    messages,
    calls,
    images,
    snapshot,
    jsonRest: value => toRuntime(value),
    failName(value) {
      failName = value;
    },
    failRange(value) {
      failRangeName = value;
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

function rangeTransfer() {
  const doc = plainFixture(); doc.pages = [doc.pages[0]];
  const frame = doc.pages[0].children[0], text = frame.children[0], textSource = "A😀 linked\nend";
  Object.assign(frame, { layout: "vertical", width: 400, height: 120, alignItems: "start" });
  Object.assign(text, { text: "A😀\n linked\nend", textSource, textFlow: "wrap", width: 180, height: 48,
    fill: "#000000", layoutSizingHorizontal: "fill", layoutSizingVertical: "hug",
    textRanges: { version: 1, sourceSignature: JSON.stringify([textSource]),
      ranges: [{ start: 4, end: 10, fill: "#1d70b8", href: "https://example.com/" }] } });
  return createFigmaTransfer(doc);
}

async function notesFixture({ unsupportedChild = false } = {}) {
  const source = page([{ ...rect("1:2"), type: "FRAME", children: unsupportedChild
    ? [{ id: "1:3", type: "VECTOR", name: "Unmapped requirement" }] : [] }]);
  const runtime = harness(source), target = runtime.all.get("1:2");
  target.setPluginData("codeshellNotes", "req-signin");
  if (unsupportedChild) runtime.all.get("1:3").setPluginData("codeshellNotes", "req-unmapped");
  await runtime.send({ type: "export-json", scope: "page" });
  assert.equal(runtime.messages.at(-1).type, "exported", runtime.messages.at(-1).message);
  const exported = JSON.parse(runtime.messages.at(-1).content), imported = await prepareFigmaImport(exported, { sha256Bytes });
  return { runtime, target, exported, imported, binding: createFigmaBinding(imported) };
}

test("ordinary native notes survive production creator export canonical save/reopen without granting source authority", async () => {
  const source = importFigmaJson(page([rect()])).document;
  const value = JSON.stringify({ requirementIds: ["req-signin", "req-profile"], text: " A" + String.fromCodePoint(0x1f600) + String.fromCharCode(13, 10) + "B " });
  source.nodes[0].notes = value;
  const runtime = harness();
  await runtime.send({ type: "import-transfer", content: JSON.stringify(createFigmaTransfer(source)) });
  assert.equal(runtime.messages.at(-1).type, "imported", runtime.messages.at(-1).message);
  const target = runtime.figma.currentPage.children[0], before = clone(target.pluginData), selection = runtime.figma.currentPage.selection;
  assert.equal(target.getPluginData("codeshellNotes"), value);
  await runtime.send({ type: "export-json", scope: "page" });
  assert.equal(runtime.messages.at(-1).type, "exported", runtime.messages.at(-1).message);
  const exported = JSON.parse(runtime.messages.at(-1).content), imported = await prepareFigmaImport(exported, { sha256Bytes });
  assert.deepEqual(exported.nativeNotes.nodes[target.id].notes, { kind: "value", value });
  assert.equal(imported.document.nodes[0].notes, value);
  const saved = JSON.parse(serializeDesignDocument(imported.document));
  assert.equal(JSON.parse(serializeDesignDocument(saved)).pages[0].children[0].notes, value);
  assert.equal(createFigmaBinding(imported).source.nativeNotes.nodes[target.id].notes.value, value);
  assert.deepEqual(target.pluginData, before); assert.equal(runtime.figma.currentPage.selection, selection);
  assert.equal(imported.document.nodes[0].textRanges, undefined);
});

test("notes-only native patches synchronously replace and clear exact fresh notes", async () => {
  for (const next of ["req-local-change", "", undefined]) {
    const f = await notesFixture(), current = clone(f.imported.document);
    if (next === undefined) delete current.nodes[0].notes; else current.nodes[0].notes = next;
    const payload = createFigmaTransfer(current); payload.patch = createFigmaPatch(f.binding, current);
    const fontsBefore = f.runtime.calls.filter(call => call[0] === "font").length;
    await f.runtime.send({ type: "preview-patch", content: JSON.stringify(payload) });
    const preview = f.runtime.messages.at(-1); assert.equal(preview.type, "patch-preview", preview.message);
    assert.deepEqual(preview.conflicts, []);
    await f.runtime.send({ type: "apply-patch", token: preview.token });
    assert.equal(f.runtime.messages.at(-1).type, "patched", f.runtime.messages.at(-1).message);
    assert.equal(f.target.getPluginData("codeshellNotes"), next ?? "");
    assert.equal(f.runtime.calls.filter(call => call[0] === "font").length, fontsBefore);
  }
});

test("notes metadata refuses late REST changes and same-ID object replacement before any original write", async () => {
  for (const mutate of [f => f.target.setPluginData("codeshellNotes", "foreign-after-await"), f => {
    const replacement = { ...f.target, pluginData: clone(f.target.pluginData) };
    f.target.parent.children[0] = replacement; f.runtime.all.set(f.target.id, replacement);
  }, f => { f.target.parent.children.push(f.target); }]) {
    const f = await notesFixture(), current = clone(f.imported.document); current.nodes[0].notes = "local";
    const payload = createFigmaTransfer(current); payload.patch = createFigmaPatch(f.binding, current);
    const original = f.target.exportAsync; let writes = 0;
    f.target.exportAsync = async settings => { const value = await original.call(f.target, settings); if (settings.format === "JSON_REST_V1") mutate(f); return value; };
    const setter = f.target.setPluginData; f.target.setPluginData = function (...args) { writes++; return setter.apply(this, args); };
    await f.runtime.send({ type: "preview-patch", content: JSON.stringify(payload) });
    assert.equal(f.runtime.messages.at(-1).type, "error");
    // The fixture mutation writes once in the first case; the local patch never writes.
    assert.equal(writes, f.target.getPluginData("codeshellNotes") === "foreign-after-await" ? 1 : 0);
    assert.notEqual(f.target.getPluginData("codeshellNotes"), "local");
  }
});

test("notes-sensitive mixed font/create patches and legacy missing baselines refuse before writes", async () => {
  const f = await notesFixture(), current = clone(f.imported.document); current.nodes[0].notes = "local";
  const payload = createFigmaTransfer(current); payload.patch = createFigmaPatch(f.binding, current);
  const legacy = clone(payload); delete legacy.patch.nativeNotesBefore;
  await f.runtime.send({ type: "preview-patch", content: JSON.stringify(legacy) });
  assert.equal(f.runtime.messages.at(-1).type, "error"); assert.equal(f.target.getPluginData("codeshellNotes"), "req-signin");
  const mixed = clone(payload); mixed.patch.operations[0].changed.push("name"); mixed.patch.operations[0].after.name = "mixed";
  let fonts = 0; f.runtime.figma.loadFontAsync = async () => { fonts++; f.target.setPluginData("codeshellNotes", "late-font"); };
  await f.runtime.send({ type: "preview-patch", content: JSON.stringify(mixed) });
  assert.equal(f.runtime.messages.at(-1).type, "error"); assert.equal(fonts, 0); assert.equal(f.target.getPluginData("codeshellNotes"), "req-signin");
  const asyncCurrent = JSON.parse(serializeDesignDocument(f.imported.document)); asyncCurrent.pages[0].children[0].notes = "local";
  const newText = JSON.parse(serializeDesignDocument(importFigmaJson(page([rect("9:9", {
    type: "TEXT", characters: "Valid new text", style: { fontFamily: "Inter", fontSize: 24, fontWeight: 400 },
  })])).document)).pages[0].children[0];
  newText.id = "notes-created-text"; asyncCurrent.pages[0].children.push(newText);
  const asyncPayload = createFigmaTransfer(asyncCurrent); asyncPayload.patch = createFigmaPatch(f.binding, asyncCurrent);
  assert(asyncPayload.patch.operations.some(operation => operation.op === "create"));
  await f.runtime.send({ type: "preview-patch", content: JSON.stringify(asyncPayload) });
  assert.equal(f.runtime.messages.at(-1).type, "error"); assert.match(f.runtime.messages.at(-1).message, /mixed asynchronous/u);
  assert.equal(fonts, 0); assert.equal(f.target.getPluginData("codeshellNotes"), "req-signin");
  const source = clone(f.binding.source); delete source.nativeNotes;
  assert.throws(() => createFigmaPatch(createFigmaBinding({ ...f.imported, source }), current), error => error.code === "NATIVE_NOTES_BASELINE_REQUIRED");
});

test("notes-only update protects unmapped descendants even though ordinary update before omits children", async () => {
  const f = await notesFixture({ unsupportedChild: true }), current = clone(f.imported.document); current.nodes[0].notes = "local";
  const payload = createFigmaTransfer(current); payload.patch = createFigmaPatch(f.binding, current);
  assert.equal(payload.patch.operations[0].before.children, undefined);
  assert.deepEqual(payload.patch.nativeNotesBefore.nodes["1:2"].children, ["1:3"]);
  const original = f.target.exportAsync; let ownWrites = 0;
  f.target.exportAsync = async settings => { const value = await original.call(f.target, settings);
    if (settings.format === "JSON_REST_V1") f.runtime.all.get("1:3").setPluginData("codeshellNotes", "late-unmapped-change"); return value; };
  const setter = f.target.setPluginData; f.target.setPluginData = function (...args) { ownWrites++; return setter.apply(this, args); };
  await f.runtime.send({ type: "preview-patch", content: JSON.stringify(payload) });
  assert.equal(f.runtime.messages.at(-1).type, "error"); assert.equal(ownWrites, 0);
  assert.equal(f.target.getPluginData("codeshellNotes"), "req-signin");
  assert.equal(f.runtime.all.get("1:3").getPluginData("codeshellNotes"), "late-unmapped-change");
});

test("notes-only deletion protects complete unmapped descendant notes and remains explicitly confirmed", async () => {
  for (const conflict of [false, true]) {
    const f = await notesFixture({ unsupportedChild: true }), current = JSON.parse(serializeDesignDocument(f.imported.document));
    assert.equal(f.imported.document.nodes.length, 1, "unsupported descendant is not an editable canonical node");
    current.pages[0].children = [];
    const payload = createFigmaTransfer(current); payload.patch = createFigmaPatch(f.binding, current);
    assert.equal(payload.patch.nativeNotesBefore.nodes["1:3"].notes.value, "req-unmapped");
    await f.runtime.send({ type: "preview-patch", content: JSON.stringify(payload) });
    const preview = f.runtime.messages.at(-1); assert.equal(preview.type, "patch-preview", preview.message);
    if (conflict) f.runtime.all.get("1:3").setPluginData("codeshellNotes", "foreign-unmapped-note");
    await f.runtime.send({ type: "apply-patch", token: preview.token, allowDeletes: true });
    assert.equal(f.runtime.messages.at(-1).type, conflict ? "error" : "patched", f.runtime.messages.at(-1).message);
    assert.equal(f.target.removed === true, !conflict);
  }
});

test("notes metadata export rechecks non-Text notes and complete identity after preview awaits", async () => {
  for (const mutate of [node => node.setPluginData("codeshellNotes", "after-preview"), node => node.remove(), node => {
    node.parent.children[0] = { ...node }; }]) {
    const runtime = harness(page([rect("1:2", { isMask: true })])), target = runtime.all.get("1:2");
    target.setPluginData("codeshellNotes", "before-preview"); const original = target.exportAsync;
    target.exportAsync = async settings => { const value = await original.call(target, settings); if (settings.format === "SVG_STRING") mutate(target); return value; };
    await runtime.send({ type: "export-json", scope: "page" });
    assert.equal(runtime.messages.at(-1).type, "error");
    assert.match(runtime.messages.at(-1).message, /notes|Notes/u);
  }
});

test("notes metadata export refuses explicitly stale raw own-plugin notes without changing raw data", async () => {
  for (const changed of [false, true]) {
    const source = page([rect("1:2", { pluginData: { "test-codeshell-native-factory": { codeshellNotes: "raw-current" }, foreign: { codeshellNotes: "ignored" } } })]);
    const runtime = harness(source), target = runtime.all.get("1:2"); target.setPluginData("codeshellNotes", "raw-current");
    const rawBefore = JSON.stringify(target.raw.pluginData), root = runtime.figma.currentPage, original = root.exportAsync;
    root.exportAsync = async settings => { const value = await original.call(root, settings);
      if (changed && settings.format === "JSON_REST_V1") target.setPluginData("codeshellNotes", "new-current"); return value; };
    await runtime.send({ type: "export-json", scope: "page" });
    assert.equal(runtime.messages.at(-1).type, changed ? "error" : "exported", runtime.messages.at(-1).message);
    if (changed) assert.match(runtime.messages.at(-1).message, /contradict/u);
    assert.equal(JSON.stringify(target.raw.pluginData), rawBefore);
    assert.equal(target.getPluginData("codeshellNotes"), changed ? "new-current" : "raw-current");
  }
});

test("paint/link range creation preserves transfer data while original-node range patches remain blocked", async () => {
  const imported = await prepareFigmaImport(page([rect("1:2", {
    type: "TEXT", characters: "A link", style: { fontFamily: "Inter", fontSize: 24, fontWeight: 400 },
  })]));
  const binding = createFigmaBinding(imported), current = clone(imported.document);
  const text = current.nodes[0], source = text.textSource ?? text.text;
  text.textRanges = { version: 1, sourceSignature: JSON.stringify([source]), ranges: [{ start: 2, end: 6, fill: "#123456", href: "https://example.com/" }] };
  const before = JSON.stringify(current), originalBinding = JSON.stringify(binding);
  const unsupported = error => error.code === "TEXT_RANGES_NATIVE_UNSUPPORTED";
  const transfer = createFigmaTransfer(current);
  assert.deepEqual(transfer.pages[0].children[0].textRanges, text.textRanges);
  assert.throws(() => createFigmaPatch(binding, current), unsupported);
  const rangedBinding = createFigmaBinding({ ...imported, document: current }), cleared = clone(current);
  delete cleared.nodes[0].textRanges;
  assert.throws(() => createFigmaPatch(rangedBinding, cleared), unsupported);
  assert.equal(JSON.stringify(current), before);
  assert.equal(JSON.stringify(binding), originalBinding);
});

test("native raw packages cannot create unsupported decorated ranges or load fonts/pages before refusal", async () => {
  const transfer = fontTransfer([["Inter", 400, "A link"]]);
  const text = transfer.pages[0].children[0], source = text.textSource ?? text.text;
  text.textRanges = { version: 1, sourceSignature: JSON.stringify([source]), ranges: [{ start: 2, end: 6, fill: "#123456", textDecoration: "underline" }] };
  const runtime = harness(), before = runtime.figma.root.children.map(runtime.snapshot);
  await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "error");
  assert.match(runtime.messages.at(-1).message, /范围文字.*原生装饰/u);
  assert.deepEqual(runtime.figma.root.children.map(runtime.snapshot), before);
  assert.deepEqual(runtime.calls, []);
  assert.equal(runtime.all.size, 2);
});

test("native range creation uses one editable AUTO Text, complete characters and real range setters", async () => {
  const transfer = rangeTransfer(), runtime = harness(undefined, { nativeTextLayout: true, nativeTextRanges: true });
  const original = runtime.figma.root.children.map(runtime.snapshot);
  await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "imported", runtime.messages.at(-1).message);
  const created = runtime.figma.root.children.at(-1), frame = created.children[0], text = frame.children[0];
  assert.equal(frame.layoutMode, "VERTICAL");
  assert.equal(frame.children.length, 1);
  assert.equal(text.type, "TEXT");
  assert.equal(text.characters, "A😀 linked\nend");
  assert.equal(text.layoutPositioning, "AUTO");
  assert.equal(text.layoutSizingHorizontal, "FILL");
  assert.equal(text.layoutSizingVertical, "HUG");
  assert.equal(text.textAutoResize, "HEIGHT");
  assert.deepEqual(text.rangeWrites.map(write => write.slice(0, 3)), [
    ["setRangeHyperlink", 0, 4], ["setRangeFills", 0, 4], ["setRangeTextDecoration", 0, 4],
    ["setRangeHyperlink", 4, 10], ["setRangeFills", 4, 10], ["setRangeTextDecoration", 4, 10],
    ["setRangeHyperlink", 10, 14], ["setRangeFills", 10, 14], ["setRangeTextDecoration", 10, 14],
  ]);
  assert.deepEqual(text.rangeWrites[3][3], { type: "URL", value: "https://example.com/" });
  assert.deepEqual(text.rangeWrites[4][3][0].color, { r: 29 / 255, g: 112 / 255, b: 184 / 255 });
  const hint = JSON.parse(text.pluginData.codeshellTextRangeIntent);
  assert.equal(hint.fill, "#000000");
  assert.deepEqual(hint.textRanges, transfer.pages[0].children[0].children[0].textRanges);
  assert(runtime.calls.some(call => call[0] === "export" && call[1] === text.id && call[2] === "JSON_REST_V1"));
  assert.deepEqual(runtime.figma.root.children.slice(0, -1).map(runtime.snapshot), original);
});

test("a range setter failure rolls back only owned new pages and leaves the original file untouched", async () => {
  const runtime = harness(undefined, { nativeTextRanges: true }), before = runtime.figma.root.children.map(runtime.snapshot), pageBefore = runtime.figma.currentPage;
  runtime.failRange("setRangeFills");
  await runtime.send({ type: "import-transfer", content: JSON.stringify(rangeTransfer()) });
  assert.equal(runtime.messages.at(-1).type, "error");
  assert.match(runtime.messages.at(-1).message, /Native range setter failed/u);
  assert.deepEqual(runtime.figma.root.children.map(runtime.snapshot), before);
  assert.equal(runtime.figma.currentPage, pageBefore);
  assert(runtime.calls.some(call => call[0] === "setRangeHyperlink"));
});

test("final native metadata is staged for every ranged Text and storage failure rolls back all owned pages", async () => {
  const transfer = rangeTransfer(), frame = transfer.pages[0].children[0];
  const secondFrame = clone(frame); secondFrame.id = "second-frame";
  secondFrame.children[0].id = "second-range"; secondFrame.children[0].name = "Second range";
  transfer.pages.push({ id: "second-page", name: "Second page", children: [secondFrame] });
  const runtime = harness(undefined, { nativeTextLayout: true, nativeTextRanges: true });
  const selection = [runtime.all.get("1:2")]; runtime.figma.currentPage.selection = selection;
  const before = runtime.figma.root.children.map(runtime.snapshot), currentPage = runtime.figma.currentPage;
  const createText = runtime.figma.createText, texts = [];
  runtime.figma.createText = () => {
    const node = createText(), save = node.setPluginData;
    texts.push(node);
    node.setPluginData = (key, value) => {
      if (key === "codeshellTextRangeIntent") {
        runtime.calls.push(["intent", node.id]);
        if (node === texts[1]) throw new Error("native intent storage failed");
      }
      save.call(node, key, value);
    };
    return node;
  };
  await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "error");
  assert.match(runtime.messages.at(-1).message, /native intent storage failed/u);
  assert.deepEqual(runtime.figma.root.children.map(runtime.snapshot), before);
  assert.equal(runtime.figma.currentPage, currentPage);
  assert.equal(currentPage.selection, selection);
  assert.equal(texts.length, 2);
  assert(texts[0].pluginData.codeshellTextRangeIntent);
  assert.equal(texts[1].pluginData.codeshellTextRangeIntent, undefined);
  assert(texts.every(node => node.parent.parent.removed));
  const firstHint = runtime.calls.findIndex(call => call[0] === "intent");
  assert.equal(runtime.calls.slice(0, firstHint).filter(call => call[0] === "export" && call[2] === "JSON_REST_V1").length, 2);
});

test("empty or styleless authored ranges create ordinary Text without requiring a nonempty author hint", async () => {
  for (const variant of ["empty-ranges", "styleless-range", "empty-source"]) {
    const transfer = rangeTransfer(), source = transfer.pages[0].children[0].children[0];
    source.textRanges.ranges = variant === "styleless-range" ? [{ start: 4, end: 10 }] : [];
    if (variant === "empty-source") {
      source.text = ""; source.textSource = ""; source.textRanges.sourceSignature = '[""]';
    }
    const runtime = harness(undefined, { nativeTextLayout: true, nativeTextRanges: true });
    await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
    assert.equal(runtime.messages.at(-1).type, "imported", `${variant}: ${runtime.messages.at(-1).message}`);
    const node = runtime.figma.root.children.at(-1).children[0].children[0];
    assert.equal(node.characters, source.textSource);
    assert.equal(node.pluginData.codeshellTextRangeIntent, undefined);
    assert.equal(runtime.calls.filter(call => call[0] === "export").length, 0);
  }
});

test("a later native export cannot alter an earlier raw range observation before metadata is saved", async () => {
  const transfer = rangeTransfer(), frame = transfer.pages[0].children[0];
  frame.children.push({ ...clone(frame.children[0]), id: "second-range", name: "Second range" });
  const runtime = harness(undefined, { nativeTextLayout: true, nativeTextRanges: true });
  const before = runtime.figma.root.children.map(runtime.snapshot), createText = runtime.figma.createText, texts = [];
  runtime.figma.createText = () => {
    const node = createText(), read = node.exportAsync;
    texts.push(node);
    node.exportAsync = async options => {
      if (node === texts[1]) {
        const earlier = texts[0], rangeHyperlink = earlier.getRangeHyperlink;
        earlier.getRangeHyperlink = (start, end) => {
          const value = rangeHyperlink(start, end);
          return value === 1 ? null : value;
        };
      }
      return read.call(node, options);
    };
    return node;
  };
  await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "error");
  assert.match(runtime.messages.at(-1).message, /最终读取期间发生变化/u);
  assert.deepEqual(runtime.figma.root.children.map(runtime.snapshot), before);
  assert(texts.every(node => node.pluginData.codeshellTextRangeIntent === undefined));
});

test("an existing layer inserted during a child await is never resized or deleted by import rollback", async () => {
  const runtime = harness(), originalPage = runtime.figma.currentPage, foreign = runtime.all.get("1:2");
  const before = { width: foreign.width, height: foreign.height, transform: clone(foreign.relativeTransform),
    data: clone(foreign.pluginData) };
  const createFrame = runtime.figma.createFrame;
  let enabled = false;
  runtime.figma.createFrame = () => {
    const node = createFrame(); let mode = node.layoutMode;
    Object.defineProperty(node, "layoutMode", { get: () => mode, set: value => {
      mode = value;
      if (value !== "NONE") { enabled = true; foreign.width -= 1; }
    } });
    return node;
  };
  const createText = runtime.figma.createText;
  runtime.figma.createText = () => {
    const node = createText(), save = node.setPluginData;
    node.setPluginData = (key, value) => {
      save.call(node, key, value);
      if (key === "codeshellNodeId") queueMicrotask(() => node.parent.insertChild(0, foreign));
    };
    return node;
  };
  await runtime.send({ type: "import-transfer", content: JSON.stringify(createFigmaTransfer(plainFixture())) });
  assert.equal(runtime.messages.at(-1).type, "error");
  assert.match(runtime.messages.at(-1).message, /外部图层.*已保留/u);
  assert.equal(runtime.figma.currentPage, originalPage);
  assert.equal(runtime.figma.root.children.length, 2);
  assert.equal(foreign.removed, false);
  assert.equal(foreign.parent.parent, runtime.figma.root.children[1]);
  assert.equal(enabled, false, "foreign descendants must be rejected before implicit Auto Layout resizing");
  assert.deepEqual({ width: foreign.width, height: foreign.height, transform: foreign.relativeTransform,
    data: foreign.pluginData }, before);
  for (const key of ["layoutPositioning", "layoutSizingHorizontal", "layoutSizingVertical", "layoutAlign"])
    assert.equal(foreign[key], undefined, key);
});

test("an owned Text moved to an existing page during await receives no later sizing or metadata writes", async () => {
  const runtime = harness(), originalPage = runtime.figma.currentPage;
  const createText = runtime.figma.createText;
  let moved;
  runtime.figma.createText = () => {
    const node = createText(), save = node.setPluginData;
    node.setPluginData = (key, value) => {
      save.call(node, key, value);
      if (key === "codeshellNodeId") queueMicrotask(() => { originalPage.appendChild(node); moved = node; });
    };
    return node;
  };
  await runtime.send({ type: "import-transfer", content: JSON.stringify(createFigmaTransfer(plainFixture())) });
  assert.equal(runtime.messages.at(-1).type, "error");
  assert.match(runtime.messages.at(-1).message, /图层顺序或内容.*发生变化/u);
  assert.equal(runtime.figma.root.children.length, 1);
  assert.equal(runtime.figma.currentPage, originalPage);
  assert.equal(moved.parent, originalPage);
  assert.equal(moved.removed, false);
  assert.equal(moved.textAutoResize, "NONE");
  assert.equal(moved.layoutSizingHorizontal, undefined);
  assert.equal(moved.layoutSizingVertical, undefined);
  assert.equal(moved.pluginData.codeshellTextRangeIntent, undefined);
});

test("raw native update clear and delete cannot hide staged ranges in either baseline snapshot", async () => {
  const source = page([rect("1:2", { type: "TEXT", characters: "A link", style: { fontFamily: "Inter", fontSize: 24, fontWeight: 400 } })]);
  for (const location of ["update", "delete", "whole-baseline"]) {
    const transfer = patchTransfer(source, node => { node.fontSize = 25; }, ["fontSize"]);
    const operation = transfer.patch.operations[0];
    const baseline = location === "whole-baseline" ? transfer.patch.baseline.pages[0].children[0] : operation.baseline;
    baseline.textRanges = { version: 1, sourceSignature: JSON.stringify([baseline.textSource ?? baseline.text]), ranges: [{ start: 2, end: 6, fill: "#123456" }] };
    baseline.name = "x".repeat(10000);
    if (location === "delete") { operation.op = "delete"; delete operation.after; }
    const runtime = harness(source), before = runtime.figma.root.children.map(runtime.snapshot);
    const fontBefore = runtime.all.get("1:2").fontSize;
    await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
    assert.equal(runtime.messages.at(-1).type, "error", location);
    assert.match(runtime.messages.at(-1).message, /范围文字.*已阻止互转/u, location);
    assert(runtime.messages.at(-1).message.length < 250, location);
    assert.deepEqual(runtime.figma.root.children.map(runtime.snapshot), before, location);
    assert.deepEqual(runtime.calls, [], location);
    assert.equal(runtime.all.get("1:2").fontSize, fontBefore, location);
  }
});

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
  assert.equal(runtime.messages.at(-1).type, "error", "legacy deletion has no fresh metadata baseline");
  assert.equal(runtime.all.get("1:2").removed, undefined);
  // Generate the positive fixture through the production VM exporter.
  await runtime.send({ type: "export-json", scope: "page" });
  assert.equal(runtime.messages.at(-1).type, "exported");
  const fresh = await prepareFigmaImport(JSON.parse(runtime.messages.at(-1).content), { sha256Bytes });
  const cleared = JSON.parse(serializeDesignDocument(fresh.document)); cleared.pages[0].children = [];
  const freshTransfer = createFigmaTransfer(cleared); freshTransfer.patch = createFigmaPatch(createFigmaBinding(fresh), cleared);
  await runtime.send({ type: "preview-patch", content: JSON.stringify(freshTransfer) });
  const first = runtime.messages.at(-1);
  assert.equal(first.deletions, 1);
  await runtime.send({ type: "apply-patch", token: first.token });
  assert.equal(runtime.messages.at(-1).type, "error");
  assert.equal(runtime.all.get("1:2").removed, undefined);
  await runtime.send({ type: "preview-patch", content: JSON.stringify(freshTransfer) });
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
  assert.throws(() => createFigmaPatch(binding, current), error => error.code === "NATIVE_NOTES_BASELINE_REQUIRED");
  const runtime = harness(source);
  await runtime.send({ type: "export-json", scope: "page" });
  const fresh = await prepareFigmaImport(JSON.parse(runtime.messages.at(-1).content), { sha256Bytes });
  const cleared = JSON.parse(serializeDesignDocument(fresh.document)); cleared.pages[0].children = [];
  const freshTransfer = createFigmaTransfer(cleared); freshTransfer.patch = createFigmaPatch(createFigmaBinding(fresh), cleared);
  assert.equal(freshTransfer.patch.operations[0].op, "delete");
  assert.equal(freshTransfer.patch.operations[0].before.children[0].children[0].id, "1:3");
  runtime.all.get("1:3").name = "External descendant edit";
  await runtime.send({ type: "preview-patch", content: JSON.stringify(freshTransfer) });
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

test("reorder resolves new sibling anchors without deletion while legacy mixed deletes refuse", async () => {
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
    assert.throws(() => createFigmaPatch(binding, current), error => error.code === "NATIVE_NOTES_BASELINE_REQUIRED", order.join(""));
    // Keep the original C; this positive now proves reorder/create without an
    // unsupported deletion hidden in the same asynchronous patch.
    current.nodes.unshift(clone(nodes.get("C")));
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
      ["C", ...order],
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

test("native signed main spacing creates editable nowrap stacks and guards incremental spacing edits", async () => {
  const original = page([{ ...rect("1:2"), type: "FRAME", layoutMode: "HORIZONTAL", layoutWrap: "NO_WRAP", itemSpacing: -16,
    itemReverseZIndex: false, primaryAxisSizingMode: "FIXED", counterAxisSizingMode: "AUTO", children: [
      rect("1:3", { absoluteBoundingBox: { x: 30, y: 40, width: 1, height: 1 } }),
      rect("1:4", { absoluteBoundingBox: { x: 30, y: 40, width: 100, height: 80 }, layoutSizingHorizontal: "FILL" }),
      rect("1:5", { absoluteBoundingBox: { x: 129, y: 40, width: 1, height: 1 } }),
    ] }]);
  const imported = importFigmaJson(original), transfer = createFigmaTransfer(imported.document), runtime = harness();
  await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "imported");
  const native = runtime.figma.root.children[1].children[0];
  assert.equal(native.layoutMode, "HORIZONTAL"); assert.equal(native.layoutWrap, "NO_WRAP");
  assert.equal(native.itemSpacing, -1); assert.equal(native.itemReverseZIndex, false);
  assert.ok(native.children.every((child) => child.layoutPositioning === "AUTO"));
  assert.equal(native.children[1].layoutSizingHorizontal, "FILL");
  await runtime.send({ type: "export-json", scope: "page" });
  const exported = runtime.messages.at(-1);
  assert.equal(exported.type, "exported");
  const raw = JSON.parse(exported.content).nodes[runtime.figma.currentPage.id].document.children[0];
  assert.equal(raw.itemSpacing, -1); assert.equal(raw.itemReverseZIndex, false);
  assert.equal(raw.children[1].layoutSizingHorizontal, "FILL");
  const update = patchTransfer(original, (node) => { node.gap = -0.5; }, ["gap"]), live = harness(original);
  await live.send({ type: "preview-patch", content: JSON.stringify(update) });
  const preview = live.messages.at(-1); assert.equal(preview.type, "patch-preview"); assert.deepEqual(preview.conflicts, []);
  await live.send({ type: "apply-patch", token: preview.token });
  assert.equal(live.messages.at(-1).type, "patched"); assert.equal(live.all.get("1:2").itemSpacing, -0.5);
  const conflict = harness(original); conflict.all.get("1:2").itemReverseZIndex = true;
  await conflict.send({ type: "preview-patch", content: JSON.stringify(update) });
  assert.equal(conflict.messages.at(-1).type, "error");
  assert.equal(conflict.all.get("1:2").itemSpacing, -16);
  for (const changes of [{ gap: -16 }, { layoutWrap: "wrap" }, { rowGap: -1 }, { layoutSizingHorizontal: "hug" }, { layoutReverse: true }]) {
    const invalid = clone(transfer); Object.assign(invalid.pages[0].children[0], changes);
    const rejected = harness(); await rejected.send({ type: "import-transfer", content: JSON.stringify(invalid) });
    assert.equal(rejected.messages.at(-1).type, "error", JSON.stringify(changes));
    assert.equal(rejected.figma.root.children.length, 1);
  }
});

test("rebased negative block margins create only native positive-inset Auto Layout frames", async () => {
  const { designNodeToV3 } = await import("../../../apps/design-studio/app/design-node-adapter.mjs");
  const row = { nodeType: "container", name: "Real row", semantic: { cssSelector: "#row" },
    bounds: { x: 5, y: 20, width: 630, height: 50 }, positioning: { mode: "absolute" }, layout: { display: "flex" }, children: [],
    cssLayout: { width: "auto", height: "50px", position: "static", "margin-left": "-15px", "margin-right": "-15px", "margin-top": "0px", "margin-bottom": "0px", "min-width": "auto", "max-width": "none" } };
  const source = { nodeType: "container", name: "Main", bounds: { x: 0, y: 0, width: 640, height: 240 },
    layout: { display: "block", padding: { top: 20, right: 20, bottom: 20, left: 20 } }, cssLayout: { width: "640px", height: "240px" }, children: [
      { nodeType: "container", name: "neg-margin-placeholder", opacity: 0, bounds: { x: 5, y: 20, width: 600, height: 50 }, layout: { display: "block" }, children: [] }, row,
      { nodeType: "container", name: "Real after", bounds: { x: 20, y: 70, width: 600, height: 20 }, layout: { display: "block" }, cssLayout: { width: "auto", height: "20px" }, children: [] },
    ] };
  const result = await designNodeToV3(source), transfer = createFigmaTransfer(result.document), runtime = harness(page([]));
  await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "imported");
  const main = runtime.figma.root.children[1].children[0];
  assert.deepEqual([main.paddingLeft, main.paddingRight], [5, 5]);
  assert.equal(main.layoutMode, "VERTICAL"); assert.equal(main.children.length, 2);
  const [realRow, compensation] = main.children;
  for (const wrapper of [compensation]) {
    assert.equal(wrapper.layoutMode, "VERTICAL"); assert.equal(wrapper.itemSpacing, 0);
    assert.equal(wrapper.layoutSizingHorizontal, "FILL"); assert.equal(wrapper.layoutSizingVertical, "HUG");
    assert.equal(wrapper.children.length, 1); assert.equal(wrapper.layoutPositioning, "AUTO");
    assert.equal(wrapper.children[0].layoutPositioning, "AUTO");
    assert.equal(wrapper.children[0].layoutSizingHorizontal, "FILL");
  }
  assert.deepEqual([compensation.paddingLeft, compensation.paddingRight], [15, 15]);
  assert.equal(realRow.getPluginData("codeshellNodeId"), "html-0-1");
  assert.equal(realRow.layoutPositioning, "AUTO"); assert.equal(realRow.layoutSizingHorizontal, "FILL");
  assert.equal(compensation.children[0].getPluginData("codeshellNodeId"), "html-0-2");
  assert.equal(realRow.width, 630); assert.equal(compensation.children[0].width, 600);
  assert.deepEqual(JSON.parse(main.getPluginData("codeshellNotes")).blockInsetRebase.original, [20, 20]);
});

test("inside per-side borders create real native stroke weights, preserve Auto Layout children and export actual values",async()=>{
  const source=page([rect("1:2",{type:"FRAME",layoutMode:"VERTICAL",strokeAlign:"INSIDE",individualStrokeWeights:{top:0,right:0,bottom:1,left:0},strokes:[{type:"SOLID",color:{r:29/255,g:112/255,b:184/255},opacity:.5}],children:[rect("1:3")]} )]);
  const imported=importFigmaJson(source),transfer=createFigmaTransfer(imported.document),runtime=harness(page([]),{nativeStrokes:true});
  await runtime.send({type:"import-transfer",content:JSON.stringify(transfer)});
  assert.equal(runtime.messages.at(-1).type,"imported");
  const created=runtime.figma.root.children[1].children[0];
  assert.equal(created.layoutMode,"VERTICAL");assert.equal(created.children.length,1,"no decorative children enter flow");
  assert.deepEqual([created.strokeTopWeight,created.strokeRightWeight,created.strokeBottomWeight,created.strokeLeftWeight],[0,0,1,0]);
  assert.equal(created.strokeAlign,"INSIDE");assert.equal(created.strokes[0].opacity,.5);assert.equal(created.strokesIncludedInLayout,false);
  created.strokeBottomWeight=3;
  runtime.figma.currentPage=created.parent;runtime.figma.currentPage.selection=[created];
  await runtime.send({type:"export-json",scope:"selection"});
  const exported=JSON.parse(runtime.messages.at(-1).content),reopened=importFigmaJson(exported);
  assert.equal(reopened.document.nodes[0].strokeSides[2].width,3);
  const invalid=clone(transfer);invalid.pages[0].children[0].strokeSides[0].width=101;
  const blocked=harness(page([]),{nativeStrokes:true});await blocked.send({type:"import-transfer",content:JSON.stringify(invalid)});
  assert.equal(blocked.messages.at(-1).type,"error");assert.equal(blocked.figma.root.children.length,1);
  const multi=clone(transfer);multi.pages[0].children[0].strokeSides[0].width=1;multi.pages[0].children[0].strokeSides[0].color="#ff0000";
  const rejected=harness(page([]),{nativeStrokes:true});await rejected.send({type:"import-transfer",content:JSON.stringify(multi)});
  assert.equal(rejected.messages.at(-1).type,"error");assert.match(rejected.messages.at(-1).message,/多色/u);assert.equal(rejected.figma.root.children.length,1);
});

test("source-bound side edits retain conflicts and native included-layout effective padding",async()=>{
  const source=page([rect("1:2",{type:"FRAME",layoutMode:"VERTICAL",strokeAlign:"INSIDE",strokesIncludedInLayout:true,paddingTop:8,paddingRight:8,paddingBottom:8,paddingLeft:8,individualStrokeWeights:{top:0,right:0,bottom:1,left:0},strokes:[{type:"SOLID",color:{r:.2,g:.4,b:.6}}],children:[]})]);
  const imported=await prepareFigmaImport(source),binding=createFigmaBinding(imported),node=imported.document.nodes[0];
  assert.equal(node.paddingBottom,9);node.strokeSides[2].width=3;
  const transfer=createFigmaTransfer(imported.document);transfer.patch=createFigmaPatch(binding,imported.document);
  const runtime=harness(source,{nativeStrokes:true});
  await runtime.send({type:"preview-patch",content:JSON.stringify(transfer)});
  const preview=runtime.messages.at(-1);assert.equal(preview.type,"patch-preview",JSON.stringify(preview));assert.deepEqual(preview.conflicts,[]);
  await runtime.send({type:"apply-patch",token:preview.token});assert.equal(runtime.messages.at(-1).type,"patched");
  const target=runtime.all.get("1:2");assert.equal(target.strokeBottomWeight,3);assert.equal(target.paddingBottom,6);assert.equal(target.strokesIncludedInLayout,true);assert.equal(target.paddingBottom+target.strokeBottomWeight,9);
  const concurrent=harness(source,{nativeStrokes:true});concurrent.all.get("1:2").strokeBottomWeight=2;
  await concurrent.send({type:"preview-patch",content:JSON.stringify(transfer)});assert(concurrent.messages.at(-1).conflicts.some(m=>m.includes("描边")));
  const padding=harness(source,{nativeStrokes:true});padding.all.get("1:2").paddingBottom=12;
  await padding.send({type:"preview-patch",content:JSON.stringify(transfer)});assert(padding.messages.at(-1).conflicts.some(m=>m.includes("paddingBottom")));
});


test("structured native square CENTER/OUTSIDE borders use sharp solid joins and diagnose unsupported source joins", async()=>{
  for(const align of ["CENTER","OUTSIDE"]){
    const source=page([rect("1:2",{strokeAlign:align,strokeWeight:8,strokes:[{type:"SOLID",color:{r:.2,g:.4,b:.6},opacity:.5}]})]);
    const imported=importFigmaJson(source),runtime=harness(page([]),{nativeStrokes:true});
    await runtime.send({type:"import-transfer",content:JSON.stringify(createFigmaTransfer(imported.document))});
    assert.equal(runtime.messages.at(-1).type,"imported");
    const created=runtime.figma.root.children[1].children[0];
    assert.equal(created.strokeAlign,align);assert.equal(created.strokeJoin,"MITER");assert.deepEqual(Array.from(created.dashPattern),[]);assert.equal(created.cornerRadius,0);
  }
  for(const unsupported of [{strokeJoin:"ROUND"},{strokeJoin:"BEVEL"},{strokeMiterLimit:1}]){
    const imported=importFigmaJson(page([rect("1:2",{strokeAlign:"OUTSIDE",strokeWeight:8,strokes:[{type:"SOLID",color:{r:.2,g:.4,b:.6}}],...unsupported})]));
    assert(imported.warnings.some(w=>w.code==="unsupported-native-border"));
    assert.equal(imported.document.nodes[0].strokeSides,undefined);
  }
});


test("included CENTER/OUTSIDE layout stays measured and blocks guessed source padding edits before mutation", async()=>{
  for(const strokeAlign of ["CENTER","OUTSIDE"]){
    const source=page([rect("1:2",{type:"FRAME",layoutMode:"VERTICAL",strokeAlign,strokesIncludedInLayout:true,strokeWeight:4,paddingTop:8,paddingRight:8,paddingBottom:8,paddingLeft:8,strokes:[{type:"SOLID",color:{r:.2,g:.4,b:.6}}],children:[rect("1:3",{absoluteBoundingBox:{x:25,y:35,width:40,height:20}})]})]);
    const imported=await prepareFigmaImport(source),node=imported.document.nodes[0];
    assert.equal(node.layout,"none");assert(imported.warnings.some(w=>w.code==="unsupported-stroke-layout"));
    assert.deepEqual([imported.document.nodes[1].x,imported.document.nodes[1].y],[25,35]);
    const binding=createFigmaBinding(imported);node.strokeSides[0].width=6;
    const transfer=createFigmaTransfer(imported.document);transfer.patch=createFigmaPatch(binding,imported.document);
    const runtime=harness(source,{nativeStrokes:true});await runtime.send({type:"preview-patch",content:JSON.stringify(transfer)});
    assert.equal(runtime.messages.at(-1).type,"error");assert.match(runtime.messages.at(-1).message,/INSIDE/u);
    assert.equal(runtime.all.get("1:2").strokeTopWeight,4);
  }
});


test("new native frames configure stroke inclusion only after Auto Layout becomes applicable", async () => {
  for (const layoutMode of ["HORIZONTAL", "VERTICAL", "NONE"]) {
    const source = page([rect("1:2", { type: "FRAME", layoutMode, children: [rect("1:3")] })]);
    const imported = importFigmaJson(source), runtime = harness(page([]), { nativeStrokes: true });
    await runtime.send({ type: "import-transfer", content: JSON.stringify(createFigmaTransfer(imported.document)) });
    assert.equal(runtime.messages.at(-1).type, "imported", `${layoutMode}: ${JSON.stringify(runtime.messages.at(-1))}`);
    const created = runtime.figma.root.children[1].children[0];
    assert.equal(created.layoutMode, layoutMode);
    assert.equal(created.children.length, 1);
    assert.equal(created.strokesIncludedInLayout, layoutMode === "NONE", "inactive freeform flag is left untouched; flow uses effective canonical padding");
  }
});

test("inactive freeform stroke inclusion does not create false source conflicts", async () => {
  const source = page([rect("1:2", { type: "FRAME", layoutMode: "NONE", strokeAlign: "CENTER", strokeWeight: 4,
    strokes: [{ type: "SOLID", color: { r: .2, g: .4, b: .6 } }], children: [] })]);
  const transfer = patchTransfer(source, (node) => { node.strokeWidth = 6; }, ["strokeWidth"]);
  const live = clone(source); live.children[0].strokesIncludedInLayout = true;
  const runtime = harness(live, { nativeStrokes: true });
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  const preview = runtime.messages.at(-1);
  assert.equal(preview.type, "patch-preview", JSON.stringify(preview));
  assert.deepEqual(preview.conflicts, []);
  await runtime.send({ type: "apply-patch", token: preview.token });
  assert.equal(runtime.messages.at(-1).type, "patched", JSON.stringify(runtime.messages.at(-1)));
  assert.equal(runtime.all.get("1:2").strokeWeight, 6);
  assert.equal(runtime.all.get("1:2").strokesIncludedInLayout, true);
});

test("empty or zero-width included strokes permit ordinary padding source edits", async () => {
  for (const strokes of [[], [{ type: "SOLID", color: { r: .2, g: .4, b: .6 } }]]) {
    const source = page([rect("1:2", { type: "FRAME", layoutMode: "VERTICAL", strokeAlign: "CENTER", strokesIncludedInLayout: true,
      strokeWeight: 0, strokes, paddingTop: 8, paddingRight: 8, paddingBottom: 8, paddingLeft: 8, children: [] })]);
    const transfer = patchTransfer(source, (node) => { node.paddingTop = 12; }, ["paddingTop"]);
    const runtime = harness(source, { nativeStrokes: true });
    await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
    const preview = runtime.messages.at(-1); assert.equal(preview.type, "patch-preview", JSON.stringify(preview));
    assert.deepEqual(preview.conflicts, []);
    await runtime.send({ type: "apply-patch", token: preview.token });
    assert.equal(runtime.messages.at(-1).type, "patched", JSON.stringify(runtime.messages.at(-1)));
    assert.equal(runtime.all.get("1:2").paddingTop, 12);
    assert.equal(runtime.all.get("1:2").strokesIncludedInLayout, true);
  }
});

test("source activation of freeform Auto Layout uses canonical effective padding", async () => {
  for (const weight of [0, 4]) {
    const source = page([rect("1:2", { type: "FRAME", layoutMode: "NONE", strokesIncludedInLayout: true, strokeAlign: "INSIDE",
      strokeWeight: weight, strokes: weight ? [{ type: "SOLID", color: { r: .2, g: .4, b: .6 } }] : [],
      paddingTop: 8, paddingRight: 8, paddingBottom: 8, paddingLeft: 8, children: [] })]);
    const imported = importFigmaJson(source);
    assert.equal(imported.document.nodes[0].paddingTop, 8, "an inactive flag must not inflate freeform padding");
    assert(!imported.warnings.some(w => w.code === "unsupported-stroke-layout"));
    const transfer = patchTransfer(source, (node) => { node.layout = "horizontal"; }, ["layout"]);
    const runtime = harness(source, { nativeStrokes: true });
    await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
    const preview = runtime.messages.at(-1); assert.equal(preview.type, "patch-preview", JSON.stringify(preview)); assert.deepEqual(preview.conflicts, []);
    await runtime.send({ type: "apply-patch", token: preview.token });
    assert.equal(runtime.messages.at(-1).type, "patched", JSON.stringify(runtime.messages.at(-1)));
    assert.equal(runtime.all.get("1:2").layoutMode, "HORIZONTAL");
    assert.equal(runtime.all.get("1:2").strokesIncludedInLayout, true, "an explicit latent true survives once Auto Layout makes its setter applicable");
    assert.equal(runtime.all.get("1:2").paddingTop, 8 - weight);
  }
});

test("new CSS inside copies include physical strokes while excluded native sources retain their flag", async () => {
  const source = page([rect("1:2", { type: "FRAME", layoutMode: "HORIZONTAL", strokeAlign: "INSIDE", strokeWeight: 4,
    strokes: [{ type: "SOLID", color: { r: .2, g: .4, b: .6 } }], paddingTop: 12, paddingRight: 12, paddingBottom: 12, paddingLeft: 12, children: [] })]);
  for (const excluded of [false, true]) {
    const value = importFigmaJson(source).document;
    if (!excluded) delete value.nodes[0].strokeLayoutExcluded;
    const runtime = harness(page([]), { nativeStrokes: true });
    await runtime.send({ type: "import-transfer", content: JSON.stringify(createFigmaTransfer(value)) });
    assert.equal(runtime.messages.at(-1).type, "imported", JSON.stringify(runtime.messages.at(-1)));
    const node = runtime.figma.root.children[1].children[0];
    assert.equal(node.strokesIncludedInLayout, !excluded);
    assert.equal(node.paddingTop, excluded ? 12 : 8);
    assert.equal(node.paddingTop + (excluded ? 0 : node.strokeTopWeight), 12);
  }
});

test("inclusion, stroke, and raw padding changes preflight together before any native writes", async () => {
  for (const originallyIncluded of [false, true]) {
    const source = page([rect("1:2", { type: "FRAME", layoutMode: "HORIZONTAL", strokeAlign: "INSIDE", strokeWeight: 4, strokesIncludedInLayout: originallyIncluded,
      strokes: [{ type: "SOLID", color: { r: .2, g: .4, b: .6 } }], paddingTop: 8, paddingRight: 8, paddingBottom: 8, paddingLeft: 8, children: [] })]);
    const imported = await prepareFigmaImport(source), binding = createFigmaBinding(imported), node = imported.document.nodes[0];
    node.strokeSides.forEach(side => { side.width = 8; });
    if (originallyIncluded) node.strokeLayoutExcluded = true;
    else delete node.strokeLayoutExcluded;
    for (const side of ["Top", "Right", "Bottom", "Left"]) node[`padding${side}`] = originallyIncluded ? 1 : 12;
    const transfer = createFigmaTransfer(imported.document); transfer.patch = createFigmaPatch(binding, imported.document);
    const runtime = harness(source, { nativeStrokes: true });
    await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
    const preview = runtime.messages.at(-1); assert.equal(preview.type, "patch-preview", JSON.stringify(preview)); assert.deepEqual(preview.conflicts, []);
    assert.equal(runtime.all.get("1:2").strokeWeight, 4, "preview performs no native writes");
    await runtime.send({ type: "apply-patch", token: preview.token });
    assert.equal(runtime.messages.at(-1).type, "patched", JSON.stringify(runtime.messages.at(-1)));
    const target = runtime.all.get("1:2");
    assert.equal(target.strokesIncludedInLayout, !originallyIncluded);
    assert.equal(target.strokeWeight, 8); assert.equal(target.paddingTop, originallyIncluded ? 1 : 4);
    for (const [field, value] of [["strokesIncludedInLayout", !originallyIncluded], ["paddingLeft", 30], ["strokeTopWeight", 6], ["layoutMode", "NONE"]]) {
      const concurrent = harness(source, { nativeStrokes: true }); concurrent.all.get("1:2")[field] = value;
      await concurrent.send({ type: "preview-patch", content: JSON.stringify(transfer) });
      assert.ok(concurrent.messages.at(-1).conflicts?.length, `${field}: ${JSON.stringify(concurrent.messages.at(-1))}`);
    }
  }
});

test("invalid final included padding and marker grammar reject before creating pages or applying source changes", async () => {
  const source = page([rect("1:2", { type: "FRAME", layoutMode: "HORIZONTAL", strokeAlign: "INSIDE", strokeWeight: 4,
    strokes: [{ type: "SOLID", color: { r: .2, g: .4, b: .6 } }], paddingTop: 8, paddingRight: 8, paddingBottom: 8, paddingLeft: 8, children: [] })]);
  const transfer = patchTransfer(source, (node) => { delete node.strokeLayoutExcluded; node.paddingTop = 1; }, ["strokeLayoutExcluded", "paddingTop"]);
  const runtime = harness(source, { nativeStrokes: true });
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "error"); assert.match(runtime.messages.at(-1).message, /缩进/u);
  assert.equal(runtime.all.get("1:2").paddingTop, 8); assert.equal(runtime.all.get("1:2").strokesIncludedInLayout, false);
  for (const marker of [false, null, 1, {}]) {
    const invalid = createFigmaTransfer(importFigmaJson(source).document); invalid.pages[0].children[0].strokeLayoutExcluded = marker;
    const rejected = harness(page([]), { nativeStrokes: true });
    await rejected.send({ type: "import-transfer", content: JSON.stringify(invalid) });
    assert.equal(rejected.messages.at(-1).type, "error"); assert.equal(rejected.figma.root.children.length, 1);
  }
});

test("leaving inside layout clears exclusion without using an inactive inclusion setter or stale padding projection", async () => {
  const source = page([rect("1:2", { type: "FRAME", layoutMode: "HORIZONTAL", strokeAlign: "INSIDE", strokeWeight: 4, strokesIncludedInLayout: true,
    strokes: [{ type: "SOLID", color: { r: .2, g: .4, b: .6 } }], paddingTop: 8, paddingRight: 8, paddingBottom: 8, paddingLeft: 8, children: [] })]);
  for (const mode of ["layout", "strokeAlign"]) {
    const transfer = patchTransfer(source, (node) => {
      node[mode] = mode === "layout" ? "none" : "center";
      node.paddingTop = 1;
    }, ["paddingTop", mode]);
    const runtime = harness(source, { nativeStrokes: true });
    await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
    const preview = runtime.messages.at(-1); assert.equal(preview.type, "patch-preview", JSON.stringify(preview)); assert.deepEqual(preview.conflicts, []);
    await runtime.send({ type: "apply-patch", token: preview.token });
    assert.equal(runtime.messages.at(-1).type, "patched", JSON.stringify(runtime.messages.at(-1)));
    const target = runtime.all.get("1:2"); assert.equal(target.paddingTop, 1);
    if (mode === "layout") assert.equal(target.layoutMode, "NONE");
    else { assert.equal(target.strokeAlign, "CENTER"); assert.equal(target.strokesIncludedInLayout, false); }
  }
});

test('native source-bound effective gaps preserve raw requests and reject clamp-threshold changes before mutation',async()=>{
  const original=page([{...rect('1:2'),type:'FRAME',layoutMode:'HORIZONTAL',layoutWrap:'NO_WRAP',itemSpacing:-16,itemReverseZIndex:false,
    primaryAxisSizingMode:'FIXED',counterAxisSizingMode:'FIXED',children:[
      rect('1:3',{absoluteBoundingBox:{x:30,y:40,width:1,height:1}}),
      rect('1:4',{absoluteBoundingBox:{x:30,y:40,width:100,height:80},layoutSizingHorizontal:'FILL'}),
      rect('1:5',{absoluteBoundingBox:{x:129,y:40,width:1,height:1}})]}]);
  const imported=await prepareFigmaImport(original),binding=createFigmaBinding(imported),style=clone(imported.document);
  style.nodes.find(node=>node.id==='figma-1-4').fill='#123456';
  const transfer=createFigmaTransfer(style);transfer.patch=createFigmaPatch(binding,style);
  const live=harness(original);await live.send({type:'preview-patch',content:JSON.stringify(transfer)});
  let preview=live.messages.at(-1);assert.equal(preview.type,'patch-preview',JSON.stringify(preview));
  await live.send({type:'apply-patch',token:preview.token});assert.equal(live.messages.at(-1).type,'patched');
  assert.equal(live.all.get('1:2').itemSpacing,-16,'style edit must not overwrite preserved native request');
  const changed=clone(imported.document);changed.nodes.find(node=>node.id==='figma-1-3').width=2;changed.nodes.find(node=>node.id==='figma-1-5').width=2;
  const compatible=clone(binding);Object.values(compatible.source.nodes)[0].document.children[0].itemSpacing=-1;
  const unsafe=createFigmaTransfer(changed);unsafe.patch=createFigmaPatch(compatible,changed);
  const blocked=harness(original),before=JSON.stringify(blocked.snapshot(blocked.figma.currentPage));
  await blocked.send({type:'preview-patch',content:JSON.stringify(unsafe)});
  assert.equal(blocked.messages.at(-1).type,'error');assert.match(blocked.messages.at(-1).message,/不能静默覆盖原始请求/u);
  assert.equal(JSON.stringify(blocked.snapshot(blocked.figma.currentPage)),before);
  changed.nodes.find(node=>node.id==='figma-1-2').gap=0;
  const explicit=createFigmaTransfer(changed);explicit.patch=createFigmaPatch(binding,changed);
  const concurrent=harness(original);concurrent.all.get('1:2').itemSpacing=-8;
  await concurrent.send({type:'preview-patch',content:JSON.stringify(explicit)});
  preview=concurrent.messages.at(-1);assert.equal(preview.type,'patch-preview');assert(preview.conflicts.some(value=>value.includes('itemSpacing')));
  assert.equal(concurrent.all.get('1:2').itemSpacing,-8);
  const independent=clone(original);independent.children[0].absoluteBoundingBox.width=400;
  independent.children[0].children.forEach((node,index)=>{node.absoluteBoundingBox={x:[30,74,370][index],y:40,width:[60,312,60][index],height:40};});
  const ordinary=await prepareFigmaImport(independent),ordinaryStyle=clone(ordinary.document);
  ordinaryStyle.nodes.find(node=>node.id==='figma-1-4').fill='#123456';
  const paintOnly=createFigmaTransfer(ordinaryStyle);paintOnly.patch=createFigmaPatch(createFigmaBinding(ordinary),ordinaryStyle);
  const external=harness(independent);external.all.get('1:2').itemSpacing=-32;
  external.all.get('1:4').width=344;external.all.get('1:4').relativeTransform[0][2]=28;
  await external.send({type:'preview-patch',content:JSON.stringify(paintOnly)});
  preview=external.messages.at(-1);assert.equal(preview.type,'patch-preview',JSON.stringify(preview));assert.deepEqual(preview.conflicts,[]);
  await external.send({type:'apply-patch',token:preview.token});assert.equal(external.messages.at(-1).type,'patched');
  assert.equal(external.all.get('1:2').itemSpacing,-32,'unrelated source gap edit remains untouched');
  assert.equal(external.all.get('1:4').width,344,'paint patch preserves independent native flow geometry');
});


test("padding and stroke provenance changes guard native negative-gap thresholds even when native Auto Layout owns geometry", async () => {
  const original = page([rect("1:2", { type: "FRAME", layoutMode: "HORIZONTAL", layoutWrap: "NO_WRAP", itemSpacing: -16,
    primaryAxisSizingMode: "FIXED", counterAxisSizingMode: "FIXED", absoluteBoundingBox: { x: 30, y: 40, width: 25, height: 80 }, children: [
      rect("1:3", { type: "FRAME", layoutMode: "HORIZONTAL", layoutSizingHorizontal: "FILL", children: [], absoluteBoundingBox: { x: 30, y: 40, width: 1, height: 20 } }),
      rect("1:4", { type: "FRAME", layoutMode: "HORIZONTAL", layoutSizingHorizontal: "FILL", children: [], absoluteBoundingBox: { x: 30, y: 40, width: 25, height: 20 },
        strokeAlign: "INSIDE", strokeWeight: 4, strokesIncludedInLayout: false, strokes: [{ type: "SOLID", color: { r: .2, g: .4, b: .6 } }],
        paddingTop: 8, paddingRight: 8, paddingBottom: 8, paddingLeft: 8 })] })]);
  const imported = await prepareFigmaImport(original), binding = createFigmaBinding(imported);
  assert.equal(imported.document.nodes[0].gap, -1);
  assert.equal(applyAllAutoLayouts(imported.document.nodes), false);
  for (const kind of ["marker", "strokeWidth", "strokeSides", "padding", "alignment"]) {
    const changed = clone(imported.document), node = changed.nodes.find(node => node.id === "figma-1-4");
    if (kind === "marker") delete node.strokeLayoutExcluded;
    if (kind === "strokeWidth") { node.strokeWidth = 0; node.strokeSides.forEach(side => { side.width = 0; }); }
    if (kind === "strokeSides") node.strokeSides.forEach(side => { side.width = 0; });
    if (kind === "padding") { node.paddingLeft = 4; node.paddingRight = 4; }
    if (kind === "alignment") { node.strokeAlign = "outside"; delete node.strokeLayoutExcluded; }
    applyAllAutoLayouts(changed.nodes);
    assert.deepEqual(changed.nodes.filter(node => node.parentId === changed.nodes[0].id).map(node => node.width), [5, 21], kind);
    const compatible = clone(binding); Object.values(compatible.source.nodes)[0].document.children[0].itemSpacing = -1;
    const transfer = createFigmaTransfer(changed); transfer.patch = createFigmaPatch(compatible, changed);
    // Native flow owns derived geometry: retaining semantic edits alone must still
    // preflight the final canonical outer boxes against the live raw gap request.
    transfer.patch.operations = transfer.patch.operations.map(operation => operation.op !== "update" ? operation :
      { ...operation, changed: operation.changed.filter(key => !["x", "y", "width", "height"].includes(key)) })
      .filter(operation => operation.op !== "update" || operation.changed.length);
    const runtime = harness(original, { nativeStrokes: true }), before = JSON.stringify(runtime.snapshot(runtime.figma.currentPage));
    await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
    assert.equal(runtime.messages.at(-1).type, "error", `${kind}: ${JSON.stringify(runtime.messages.at(-1))}`);
    assert.match(runtime.messages.at(-1).message, /不能静默覆盖原始请求/u, kind);
    assert.equal(JSON.stringify(runtime.snapshot(runtime.figma.currentPage)), before, kind);
  }
});

test("explicit negative gap and inclusion-weight-padding edits validate the complete final plan before writes", async () => {
  const fixture = JSON.parse(await readFile(new URL("../../fixtures/design-studio-native-content-fill.json", import.meta.url), "utf8"));
  const source = page([clone(fixture.cases[0].source)]), imported = await prepareFigmaImport(source), binding = createFigmaBinding(imported);
  const parent = imported.document.nodes[0], child = imported.document.nodes[1];
  parent.gap = -10; delete child.strokeLayoutExcluded;
  child.strokeSides.forEach(side => { side.width = 8; });
  for (const side of ["Top", "Right", "Bottom", "Left"]) child[`padding${side}`] = 12;
  applyAllAutoLayouts(imported.document.nodes);
  assert.equal(child.width, 301);
  const transfer = createFigmaTransfer(imported.document); transfer.patch = createFigmaPatch(binding, imported.document);
  const runtime = harness(source, { nativeStrokes: true });
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  const preview = runtime.messages.at(-1); assert.equal(preview.type, "patch-preview", JSON.stringify(preview)); assert.deepEqual(preview.conflicts, []);
  assert.equal(runtime.all.get(fixture.cases[0].source.id).itemSpacing, 12, "preview does not write gap");
  await runtime.send({ type: "apply-patch", token: preview.token });
  assert.equal(runtime.messages.at(-1).type, "patched", JSON.stringify(runtime.messages.at(-1)));
  assert.equal(runtime.all.get(fixture.cases[0].source.id).itemSpacing, -10);
  const nativeChild = runtime.all.get(fixture.cases[0].source.children[0].id);
  assert.equal(nativeChild.strokesIncludedInLayout, true); assert.equal(nativeChild.paddingLeft, 4); assert.equal(nativeChild.strokeLeftWeight, 8);
  child.paddingLeft = 1;
  const invalid = createFigmaTransfer(imported.document); invalid.patch = createFigmaPatch(binding, imported.document);
  const blocked = harness(source, { nativeStrokes: true }), before = JSON.stringify(blocked.snapshot(blocked.figma.currentPage));
  await blocked.send({ type: "preview-patch", content: JSON.stringify(invalid) });
  assert.equal(blocked.messages.at(-1).type, "error"); assert.match(blocked.messages.at(-1).message, /缩进/u);
  assert.equal(JSON.stringify(blocked.snapshot(blocked.figma.currentPage)), before);
});


test("stroke-side color alone preserves independent source negative-gap edits", async () => {
  const fixture = JSON.parse(await readFile(new URL("../../fixtures/design-studio-native-content-fill.json", import.meta.url), "utf8"));
  const source = page([clone(fixture.cases[0].source)]); source.children[0].itemSpacing = -10;
  const imported = await prepareFigmaImport(source), binding = createFigmaBinding(imported);
  imported.document.nodes[1].strokeSides.forEach(side => { side.color = "#123456"; });
  const transfer = createFigmaTransfer(imported.document); transfer.patch = createFigmaPatch(binding, imported.document);
  const runtime = harness(source, { nativeStrokes: true }); runtime.all.get(source.children[0].id).itemSpacing = -16;
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  const preview = runtime.messages.at(-1); assert.equal(preview.type, "patch-preview", JSON.stringify(preview)); assert.deepEqual(preview.conflicts, []);
  await runtime.send({ type: "apply-patch", token: preview.token });
  assert.equal(runtime.messages.at(-1).type, "patched"); assert.equal(runtime.all.get(source.children[0].id).itemSpacing, -16);
});

test("production Text create and reviewed patches preserve explicit pixel versus legacy percent units", async () => {
  for (const pixels of [true, false]) {
    const original = nativeTextFixture("Alpha\nBeta"), raw = original.children[0].children[0];
    Object.assign(raw.absoluteBoundingBox, { height: 40 });
    Object.assign(raw.style, { fontSize: 16, lineHeightPx: 20, lineHeightPercentFontSize: 125,
      lineHeightUnit: pixels ? "PIXELS" : "FONT_SIZE_%" });
    const prepared = await prepareFigmaImport(original), text = prepared.document.nodes.find(node => node.type === "text");
    assert.equal(text.lineHeightUnit, pixels ? "pixels" : undefined);
    const creation = harness(page([]), { nativeTextLayout: true });
    await creation.send({ type: "import-transfer", content: JSON.stringify(createFigmaTransfer(prepared.document)) });
    assert.equal(creation.messages.at(-1).type, "imported");
    const created = [...creation.all.values()].find(node => node.type === "TEXT");
    assert.deepEqual(clone(created.lineHeight), pixels ? { unit: "PIXELS", value: 20 } : { unit: "PERCENT", value: 125 });
    assert.equal(created.characters, "Alpha\nBeta");
    for (const size of [16, 24, 16]) {
      created.fontSize = size; created.resize(created.width, created.height);
      assert.equal(created.height, pixels ? 40 : size * 2.5);
    }
    const binding = createFigmaBinding(prepared);
    text.fontSize = 24; text.height = pixels ? 40 : 60;
    const transfer = createFigmaTransfer(prepared.document); transfer.patch = createFigmaPatch(binding, prepared.document);
    const runtime = harness(original, { nativeTextLayout: true }), target = runtime.all.get("1:2");
    target.fontSize = 16; target.lineHeight = pixels ? { unit: "PIXELS", value: 20 } : { unit: "PERCENT", value: 125 };
    await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
    const preview = runtime.messages.at(-1); assert.equal(preview.type, "patch-preview"); assert.deepEqual(preview.conflicts, []);
    await runtime.send({ type: "apply-patch", token: preview.token }); assert.equal(runtime.messages.at(-1).type, "patched");
    assert.equal(target.fontSize, 24); assert.equal(target.height, pixels ? 40 : 60);
    assert.deepEqual(clone(target.lineHeight), pixels ? { unit: "PIXELS", value: 20 } : { unit: "PERCENT", value: 125 });
    const concurrent = harness(original); concurrent.all.get("1:2").raw.style.lineHeightUnit = pixels ? "FONT_SIZE_%" : "PIXELS";
    await concurrent.send({ type: "preview-patch", content: JSON.stringify(transfer) });
    assert(concurrent.messages.at(-1).conflicts.some(message => message.includes("style")), "Same resolved pixels cannot hide concurrent unit edits");
  }
});

test("production Text unit transitions use explicit setters and invalid pixel transfer fails before creation", async () => {
  const original = nativeTextFixture("Alpha\nBeta"), raw = original.children[0].children[0];
  Object.assign(raw.style, { fontSize: 16, lineHeightPx: 20, lineHeightUnit: "PIXELS" });
  const prepared = await prepareFigmaImport(original), binding = createFigmaBinding(prepared), text = prepared.document.nodes.find(node => node.type === "text");
  delete text.lineHeightUnit; text.lineHeight = 1.25;
  const transfer = createFigmaTransfer(prepared.document); transfer.patch = createFigmaPatch(binding, prepared.document);
  assert(transfer.patch.operations.some(operation => operation.changed?.includes("lineHeightUnit")));
  const runtime = harness(original); await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  const preview = runtime.messages.at(-1); assert.equal(preview.type, "patch-preview"); assert.deepEqual(preview.conflicts, []);
  await runtime.send({ type: "apply-patch", token: preview.token }); assert.equal(runtime.messages.at(-1).type, "patched");
  assert.deepEqual(clone(runtime.all.get("1:2").lineHeight), { unit: "PERCENT", value: 125 });
  for (const change of [{ lineHeightUnit: "pixels", lineHeight: 721 }, { lineHeightUnit: "AUTO", lineHeight: 1.25 }]) {
    const invalid = createFigmaTransfer(prepared.document); Object.assign(invalid.pages[0].children[0].children[0], change);
    const target = harness(page([])); await target.send({ type: "import-transfer", content: JSON.stringify(invalid) });
    assert.equal(target.messages.at(-1).type, "error"); assert.equal([...target.all.values()].filter(node => node.type === "TEXT").length, 0);
  }
});

test("generated native runtime recognizes pixel9 provenance without erasing an authored explicit newline", async () => {
  for (const sourceEdit of [false, true]) {
    const imported = importFigmaJson(nativeTextFixture("Alpha Beta")), text = imported.document.nodes.find(node => node.type === "text");
    Object.assign(text, { fontSize: 16, lineHeight: 20, lineHeightUnit: "pixels", textSource: "Alpha Beta" });
    recordWrappedCopy(text, "Alpha \nBeta");
    assert.equal(JSON.parse(text.textMetrics.signature).length, 9);
    text.fontSize = 24;
    if (sourceEdit) text.textSource = "Edited source\nwith explicit LF";
    else text.text = "Alpha\n Beta";
    const runtime = harness(page([]));
    await runtime.send({ type: "import-transfer", content: JSON.stringify(createFigmaTransfer(imported.document)) });
    assert.equal(runtime.messages.at(-1).type, "imported");
    const created = [...runtime.all.values()].find(node => node.type === "TEXT");
    assert.equal(created.characters, sourceEdit ? "Edited source\nwith explicit LF" : "Alpha\n Beta");
    assert.deepEqual(clone(created.lineHeight), { unit: "PIXELS", value: 20 });
  }
});

test("CSS shadow native creation refuses unsupported masks before writes; opaque editable stacks restore only current metadata",async()=>{
  const imported=importFigmaJson(page([rect()])),shape=imported.document.nodes[0];
  shape.fill="#212529";shape.shadowStack={basis:"css-box",layers:[{kind:"inner",color:"#000000",opacity:.5,x:0,y:0,blur:80,spread:0,visible:true}]};
  const transfer=createFigmaTransfer(imported.document),creation=harness(page([]),{nativeStrokes:true});
  const invalid=clone(transfer);invalid.pages[0].children[0].fill="transparent";
  const before=JSON.stringify(creation.snapshot(creation.figma.currentPage));
  await creation.send({type:"import-transfer",content:JSON.stringify(invalid)});assert.equal(creation.messages.at(-1).type,"error");assert.match(creation.messages.at(-1).message,/蒙版/);assert.equal(JSON.stringify(creation.snapshot(creation.figma.currentPage)),before);assert.equal(creation.figma.root.children.length,1);
  await creation.send({type:"import-transfer",content:JSON.stringify(transfer)});assert.equal(creation.messages.at(-1).type,"imported");
  const target=creation.figma.currentPage.children[0];assert.equal(target.effects[0].type,"INNER_SHADOW");assert.equal(target.effects[0].radius,80);
  await creation.send({type:"export-json",scope:"page"});let source=JSON.parse(creation.messages.at(-1).content);
  let prepared=await prepareFigmaImport(source),binding=createFigmaBinding(prepared),node=prepared.document.nodes[0];
  assert.deepEqual(node.shadowStack,shape.shadowStack);assert.deepEqual(createFigmaPatch(binding,prepared.document).operations,[]);
  node.shadowStack.layers[0].blur=40;
  let update=createFigmaTransfer(prepared.document);update.patch=createFigmaPatch(binding,prepared.document);
  assert.deepEqual(update.patch.operations[0].changed,["shadowStack"]);
  await creation.send({type:"preview-patch",content:JSON.stringify(update)});let preview=creation.messages.at(-1);assert.equal(preview.type,"patch-preview",JSON.stringify(preview));assert.deepEqual(preview.conflicts,[]);
  await creation.send({type:"apply-patch",token:preview.token});assert.equal(creation.messages.at(-1).type,"patched");assert.equal(target.effects[0].radius,40);
  await creation.send({type:"export-json",scope:"page"});source=JSON.parse(creation.messages.at(-1).content);prepared=await prepareFigmaImport(source);binding=createFigmaBinding(prepared);node=prepared.document.nodes[0];assert.equal(node.shadowStack.layers[0].blur,40);
  node.width+=10;update=createFigmaTransfer(prepared.document);update.patch=createFigmaPatch(binding,prepared.document);
  target.strokes=[{type:"SOLID",color:{r:1,g:0,b:0}}];target.strokeWeight=1;
  await creation.send({type:"preview-patch",content:JSON.stringify(update)});preview=creation.messages.at(-1);assert.equal(preview.type,"patch-preview");assert(preview.conflicts.some(s=>/蒙版/.test(s)));assert.equal(target.width,node.width-10,"preview cannot write geometry");
  await creation.send({type:"export-json",scope:"page"});const diverged=await prepareFigmaImport(JSON.parse(creation.messages.at(-1).content));assert.equal(diverged.document.nodes[0].shadowStack,undefined,"stale native paint metadata never restores CSS intent");assert(diverged.warnings.length);
});

test("CSS stack removal plus legacy shadow replacement applies the final effect plan regardless of changed-key ordering",async()=>{
  const initial=importFigmaJson(page([rect()])),shape=initial.document.nodes[0];shape.shadowStack={basis:"css-box",layers:[{kind:"inner",color:"#000000",opacity:.5,x:0,y:0,blur:8,spread:0,visible:true}]};
  const runtime=harness(page([]),{nativeStrokes:true});await runtime.send({type:"import-transfer",content:JSON.stringify(createFigmaTransfer(initial.document))});assert.equal(runtime.messages.at(-1).type,"imported");
  const target=runtime.figma.currentPage.children[0];await runtime.send({type:"export-json",scope:"page"});const prepared=await prepareFigmaImport(JSON.parse(runtime.messages.at(-1).content)),binding=createFigmaBinding(prepared),node=prepared.document.nodes[0];delete node.shadowStack;node.shadow={color:"#000000",opacity:.4,x:2,y:3,blur:4};
  const update=createFigmaTransfer(prepared.document);update.patch=createFigmaPatch(binding,prepared.document);assert(update.patch.operations[0].changed.includes("shadow"));assert(update.patch.operations[0].changed.includes("shadowStack"));
  await runtime.send({type:"preview-patch",content:JSON.stringify(update)});const preview=runtime.messages.at(-1);assert.equal(preview.type,"patch-preview");assert.deepEqual(preview.conflicts,[]);await runtime.send({type:"apply-patch",token:preview.token});assert.equal(runtime.messages.at(-1).type,"patched");assert.equal(target.effects.length,1);assert.equal(target.effects[0].type,"DROP_SHADOW");assert.equal(target.effects[0].radius,4);
});


test("inactive native copies preserve exact empty paints, scalar/side widths and Text OUTSIDE without any NONE inclusion setter", async () => {
  const entries = [
    {
      type: "FRAME",
      layoutMode: "HORIZONTAL",
      strokeAlign: "INSIDE",
      strokeWeight: 1,
      strokesIncludedInLayout: true,
    },
    {
      type: "FRAME",
      layoutMode: "VERTICAL",
      strokeAlign: "OUTSIDE",
      strokeWeight: 2,
      strokesIncludedInLayout: false,
    },
    { type: "FRAME", layoutMode: "NONE", strokeAlign: "INSIDE", strokeWeight: 0 },
    {
      type: "RECTANGLE",
      strokeAlign: "OUTSIDE",
      individualStrokeWeights: { top: 1, right: 2, bottom: 3, left: 4 },
    },
    {
      type: "TEXT",
      strokeAlign: "OUTSIDE",
      strokeWeight: 1,
      characters: "Original characters",
      style: {
        fontFamily: "Arial",
        fontSize: 16,
        fontWeight: 400,
        lineHeightPx: 20,
        lineHeightUnit: "PIXELS",
      },
    },
  ];
  const source = page(
    entries.map((entry, index) =>
      rect(`2:${index}`, {
        ...entry,
        strokes: [],
        ...(entry.type === "FRAME" ? { children: [] } : {}),
        paddingTop: 8,
        paddingRight: 8,
        paddingBottom: 8,
        paddingLeft: 8,
      }),
    ),
  );
  const result = importFigmaJson(source),
    runtime = harness(page([]), { nativeStrokes: true });
  await runtime.send({
    type: "import-transfer",
    content: JSON.stringify(createFigmaTransfer(result.document)),
  });
  assert.equal(runtime.messages.at(-1).type, "imported", JSON.stringify(runtime.messages.at(-1)));
  const copied = runtime.figma.root.children[1].children;
  for (const [index, entry] of entries.entries()) {
    assert.equal(copied[index].strokes.length, 0);
    assert.equal(copied[index].strokeAlign, entry.strokeAlign);
    if (entry.strokeWeight !== undefined)
      assert.equal(copied[index].strokeWeight, entry.strokeWeight);
    if (entry.individualStrokeWeights)
      assert.deepEqual(
        [
          copied[index].strokeTopWeight,
          copied[index].strokeRightWeight,
          copied[index].strokeBottomWeight,
          copied[index].strokeLeftWeight,
        ],
        [1, 2, 3, 4],
      );
    if (entry.layoutMode && entry.layoutMode !== "NONE") {
      assert.equal(copied[index].strokesIncludedInLayout, entry.strokesIncludedInLayout);
      assert.equal(copied[index].paddingTop, 8);
    }
  }
  assert.equal(copied[4].characters, "Original characters");
});

test("inactive source activation/removal/width uses ordinary guarded patches and projects effective padding exactly once", async () => {
  for (const included of [true, false]) {
    let source = page([
      rect("1:2", {
        type: "FRAME",
        layoutMode: "VERTICAL",
        strokeAlign: "INSIDE",
        strokeWeight: 2,
        strokesIncludedInLayout: included,
        strokes: [],
        paddingTop: 8,
        paddingRight: 8,
        paddingBottom: 8,
        paddingLeft: 8,
        children: [],
      }),
    ]);
    const runtime = harness(source, { nativeStrokes: true });
    for (const action of [
      (node) => editDesignStrokeColor(node, "#123456"),
      (node) => editDesignStrokeColor(node, "transparent"),
      (node) => editDesignStrokeWidth(node, 4),
      (node) => editDesignStrokeColor(node, "#654321"),
    ]) {
      const result = await prepareFigmaImport(source),
        binding = createFigmaBinding(result),
        node = result.document.nodes[0];
      action(node);
      const transfer = createFigmaTransfer(result.document);
      transfer.patch = createFigmaPatch(binding, result.document);
      await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
      const preview = runtime.messages.at(-1);
      assert.equal(preview.type, "patch-preview", JSON.stringify(preview));
      assert.deepEqual(preview.conflicts, []);
      await runtime.send({ type: "apply-patch", token: preview.token });
      assert.equal(
        runtime.messages.at(-1).type,
        "patched",
        JSON.stringify(runtime.messages.at(-1)),
      );
      const live = runtime.all.get("1:2");
      assert.equal(live.paddingTop, 8);
      assert.equal(live.strokesIncludedInLayout, included);
      assert.equal(live.strokes.length, node.stroke === "transparent" ? 0 : 1);
      assert.equal(live.strokeWeight, node.nativeStrokeInactive?.strokeWeight ?? node.strokeWidth);
      await runtime.send({ type: "export-json", scope: "page" });
      source = JSON.parse(runtime.messages.at(-1).content).nodes[runtime.figma.currentPage.id]
        .document;
    }
  }
});

test("unknown inactive extras keep new copies blocked while unrelated source edits and NONE-to-flow transitions stay guarded", async () => {
  for (const extras of [
    { strokeJoin: "ROUND" },
    { strokeWeight: 1, individualStrokeWeights: { top: 1, right: 2, bottom: 3, left: 4 } },
  ]) {
    const source = page([
      rect("1:2", {
        type: "FRAME",
        layoutMode: "NONE",
        strokeAlign: "INSIDE",
        strokeWeight: 1,
        strokesIncludedInLayout: true,
        strokes: [],
        paddingTop: 0,
        paddingRight: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        children: [],
        ...extras,
      }),
    ]);
    const result = await prepareFigmaImport(source),
      binding = createFigmaBinding(result),
      node = result.document.nodes[0];
    assert.equal(node.nativeStrokeInactive.sourceOnly, true);
    node.layout = "vertical";
    const transfer = createFigmaTransfer(result.document);
    transfer.patch = createFigmaPatch(binding, result.document);
    const runtime = harness(source, { nativeStrokes: true });
    await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
    const preview = runtime.messages.at(-1);
    assert.equal(preview.type, "patch-preview", JSON.stringify(preview));
    if (extras.individualStrokeWeights)
      assert.ok(
        preview.conflicts.length,
        "inconsistent raw mixed scalar/tuple is never silently repaired",
      );
    else {
      assert.deepEqual(preview.conflicts, []);
      await runtime.send({ type: "apply-patch", token: preview.token });
      assert.equal(runtime.messages.at(-1).type, "patched");
      assert.equal(runtime.all.get("1:2").strokesIncludedInLayout, true);
    }
    assert.equal(node.nativeStrokeInactive.sourceOnly, true);
    const fresh = harness(page([]), { nativeStrokes: true });
    delete transfer.patch;
    await fresh.send({ type: "import-transfer", content: JSON.stringify(transfer) });
    assert.equal(fresh.messages.at(-1).type, "error");
    assert.equal(fresh.figma.root.children.length, 1);
    const before = clone(node);
    assert.throws(() => editDesignStrokeColor(node, "#123456"));
    assert.deepEqual(node, before);
  }
});

test("inactive raw width and absent-versus-explicit inclusion conflicts stop all patch writes", async () => {
  for (const field of ["strokeWeight", "strokesIncludedInLayout"]) {
    const source = page([
      rect("1:2", {
        type: "FRAME",
        layoutMode: "VERTICAL",
        strokeAlign: "INSIDE",
        strokeWeight: 1,
        strokes: [],
        paddingTop: 8,
        paddingRight: 8,
        paddingBottom: 8,
        paddingLeft: 8,
        children: [],
      }),
    ]);
    const transfer = patchTransfer(source, (node) => editDesignStrokeColor(node, "#123456"), [
      "stroke",
      "strokeWidth",
      "strokeAlign",
      "strokeSides",
      "strokeLayoutExcluded",
      "nativeStrokeInactive",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
    ]);
    const runtime = harness(source, { nativeStrokes: true });
    runtime.all.get("1:2")[field] = field === "strokeWeight" ? 2 : false;
    if (field === "strokesIncludedInLayout")
      runtime.all.get("1:2").raw.strokesIncludedInLayout = false;
    const before = JSON.stringify(runtime.snapshot(runtime.figma.currentPage));
    await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
    const preview = runtime.messages.at(-1);
    assert.equal(preview.type, "patch-preview");
    assert.ok(
      preview.conflicts.some((value) => value.includes("描边")),
      JSON.stringify(preview),
    );
    await runtime.send({ type: "apply-patch", token: preview.token });
    assert.equal(runtime.messages.at(-1).type, "error");
    assert.equal(JSON.stringify(runtime.snapshot(runtime.figma.currentPage)), before);
  }
});

test("untrusted patch fields cannot bypass inactive copy validation before any native creation", async () => {
  const result = importFigmaJson(
    page([
      rect("1:2", {
        type: "FRAME",
        layoutMode: "NONE",
        strokeAlign: "INSIDE",
        strokeWeight: 1,
        strokes: [],
        strokesIncludedInLayout: true,
        children: [],
      }),
    ]),
  );
  for (const patch of [true, {}, { format: "codeshell.figma.patch", version: 1, operations: [] }]) {
    const transfer = createFigmaTransfer(result.document);
    transfer.patch = patch;
    const runtime = harness(page([]), { nativeStrokes: true });
    await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
    assert.equal(runtime.messages.at(-1).type, "error");
    assert.equal(runtime.all.size, 1, "validation precedes createPage, not merely rollback");
  }
});

test("simultaneous source layout-and-stroke activation preserves original raw padding after becoming Auto Layout", async () => {
  const source = page([
    rect("1:2", {
      type: "FRAME",
      layoutMode: "NONE",
      strokeAlign: "INSIDE",
      strokeWeight: 4,
      strokesIncludedInLayout: true,
      strokes: [],
      paddingTop: 8,
      paddingRight: 8,
      paddingBottom: 8,
      paddingLeft: 8,
      children: [],
    }),
  ]);
  const result = await prepareFigmaImport(source),
    binding = createFigmaBinding(result),
    node = result.document.nodes[0];
  const { applyDesignStrokeEdits } = await import("../../../apps/design-studio/app/stroke.mjs");
  applyDesignStrokeEdits(node, { layout: "vertical", stroke: "#123456" });
  node.layout = "vertical";
  const transfer = createFigmaTransfer(result.document);
  transfer.patch = createFigmaPatch(binding, result.document);
  const runtime = harness(source, { nativeStrokes: true });
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  const preview = runtime.messages.at(-1);
  assert.equal(preview.type, "patch-preview", JSON.stringify(preview));
  assert.deepEqual(preview.conflicts, []);
  await runtime.send({ type: "apply-patch", token: preview.token });
  assert.equal(runtime.messages.at(-1).type, "patched", JSON.stringify(runtime.messages.at(-1)));
  const live = runtime.all.get("1:2");
  assert.equal(live.layoutMode, "VERTICAL");
  assert.equal(live.paddingTop, 8);
  assert.equal(live.strokesIncludedInLayout, true);
  assert.equal(live.strokes.length, 1);
  assert.equal(live.strokeWeight, 4);
});

test("removing unsupported painted raw style never fabricates clean reactivatable metadata", async () => {
  const source = page([
    rect("1:2", {
      strokeAlign: "OUTSIDE",
      strokeWeight: 2,
      strokeJoin: "ROUND",
      strokes: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
    }),
  ]);
  const result = await prepareFigmaImport(source),
    binding = createFigmaBinding(result);
  editDesignStrokeColor(result.document.nodes[0], "transparent");
  const transfer = createFigmaTransfer(result.document);
  transfer.patch = createFigmaPatch(binding, result.document);
  const runtime = harness(source, { nativeStrokes: true }),
    before = JSON.stringify(runtime.snapshot(runtime.figma.currentPage));
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "error");
  assert.match(runtime.messages.at(-1).message, /特殊/u);
  assert.equal(JSON.stringify(runtime.snapshot(runtime.figma.currentPage)), before);
});

test("removing already-painted native Text OUTSIDE cannot recapture its centered approximation as source intent", async () => {
  const source = page([
    rect("1:2", {
      type: "TEXT",
      characters: "Original text",
      style: {
        fontFamily: "Arial",
        fontSize: 16,
        fontWeight: 400,
        lineHeightPx: 20,
        lineHeightUnit: "PIXELS",
      },
      strokeAlign: "OUTSIDE",
      strokeWeight: 1,
      strokes: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
    }),
  ]);
  const result = await prepareFigmaImport(source),
    binding = createFigmaBinding(result);
  editDesignStrokeColor(result.document.nodes[0], "transparent");
  const transfer = createFigmaTransfer(result.document);
  transfer.patch = createFigmaPatch(binding, result.document);
  const runtime = harness(source, { nativeStrokes: true }),
    before = JSON.stringify(runtime.snapshot(runtime.figma.currentPage));
  await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "error");
  assert.match(runtime.messages.at(-1).message, /近似/u);
  assert.equal(JSON.stringify(runtime.snapshot(runtime.figma.currentPage)), before);
});


test("removing only sourceOnly metadata cannot erase unknown native style guards before a source patch", async () => {
  const source=page([rect("1:2",{type:"FRAME",layoutMode:"VERTICAL",strokeAlign:"INSIDE",strokeWeight:1,strokeJoin:"ROUND",strokes:[],paddingTop:8,paddingRight:8,paddingBottom:8,paddingLeft:8,children:[]})]);
  const result=await prepareFigmaImport(source),binding=createFigmaBinding(result);delete result.document.nodes[0].nativeStrokeInactive.sourceOnly;
  const transfer=createFigmaTransfer(result.document);transfer.patch=createFigmaPatch(binding,result.document);
  const runtime=harness(source,{nativeStrokes:true}),before=JSON.stringify(runtime.snapshot(runtime.figma.currentPage));
  await runtime.send({type:"preview-patch",content:JSON.stringify(transfer)});assert.equal(runtime.messages.at(-1).type,"error");assert.match(runtime.messages.at(-1).message,/保留标记/u);assert.equal(JSON.stringify(runtime.snapshot(runtime.figma.currentPage)),before);
});


test("sparse or undeclared CSS shadow intent cannot bypass current native mask preflight", async () => {
  for (const sparse of [true, false]) {
    const initial = importFigmaJson(page([rect()])), shape = initial.document.nodes[0];
    shape.fill = "#212529";
    shape.shadowStack = { basis: "css-box", layers: [{ kind: "inner", color: "#000000", opacity: .5, x: 0, y: 0, blur: 8, spread: 0, visible: true }] };
    const runtime = harness(page([]), { nativeStrokes: true });
    await runtime.send({ type: "import-transfer", content: JSON.stringify(createFigmaTransfer(initial.document)) });
    assert.equal(runtime.messages.at(-1).type, "imported");
    await runtime.send({ type: "export-json", scope: "page" });
    const imported = await prepareFigmaImport(JSON.parse(runtime.messages.at(-1).content));
    const binding = createFigmaBinding(imported), node = imported.document.nodes[0];
    node.width += 10;
    const transfer = createFigmaTransfer(imported.document);
    transfer.patch = createFigmaPatch(binding, imported.document);
    const operation = transfer.patch.operations[0];
    assert.deepEqual(operation.changed, ["width"]);
    if (sparse) {
      delete operation.baseline.shadowStack;
      delete operation.after.shadowStack;
      delete transfer.pages[0].children[0].shadowStack;
    } else {
      operation.after.shadowStack.layers[0].blur = 40;
      transfer.pages[0].children[0].shadowStack.layers[0].blur = 40;
    }
    const before = JSON.stringify(runtime.snapshot(runtime.figma.currentPage));
    await runtime.send({ type: "preview-patch", content: JSON.stringify(transfer) });
    const preview = runtime.messages.at(-1);
    if (sparse) {
      assert.equal(preview.type, "patch-preview");
      assert(preview.conflicts.some(message => /阴影蒙版意图/u.test(message)));
      await runtime.send({ type: "apply-patch", token: preview.token });
      assert.equal(runtime.messages.at(-1).type, "error");
    } else {
      assert.equal(preview.type, "error");
      assert.match(preview.message, /shadowStack 修改记录/u);
    }
    assert.equal(JSON.stringify(runtime.snapshot(runtime.figma.currentPage)), before);
  }
});

function imageBoxTransfer(width = 32) {
  const transfer = fontTransfer([]);
  const common = { x: 0, y: 0, rotation: 0, opacity: 1, fill: 'transparent', stroke: 'transparent', strokeWidth: 0, cornerRadius: 0, visible: true, locked: false };
  transfer.assets = { 'original-image': { mime: 'image/png', base64: PNG } };
  transfer.pages[0].children = [{ ...common, id: 'original-img', type: 'frame', name: 'img', width, height: 32,
    layout: 'vertical', layoutSizingHorizontal: 'fixed', layoutSizingVertical: 'fixed', gap: 0, padding: 1,
    alignItems: 'stretch', justifyContent: 'start', stroke: '#ffffff', strokeWidth: 1, strokeAlign: 'inside',
    children: [{ ...common, id: 'original-img-image-content', name: 'content', type: 'image', x: 1, y: 1,
      width: 30, height: 30, imageRef: 'original-image', objectFit: 'fill', layoutSizingHorizontal: 'fill', layoutSizingVertical: 'fill' }] }];
  return transfer;
}

test('editable image border Frame creates real inset Fill image with included native stroke', async () => {
  const runtime = harness(undefined, { nativeStrokes: true, nativeImageLayout: true });
  await runtime.send({ type: 'import-transfer', content: JSON.stringify(imageBoxTransfer()) });
  assert.equal(runtime.messages.at(-1).type, 'imported', JSON.stringify(runtime.messages.at(-1)));
  const outer = [...runtime.all.values()].find(node => node.getPluginData('codeshellNodeId') === 'original-img');
  const inner = outer.children[0];
  assert.equal(outer.layoutMode, 'VERTICAL'); assert.equal(outer.strokesIncludedInLayout, true);
  assert.equal(outer.paddingLeft, 0); assert.equal(outer.strokeLeftWeight, 1);
  assert.equal(inner.width, 30); assert.equal(inner.height, 30);
  assert.equal(inner.layoutSizingHorizontal, 'FILL'); assert.equal(inner.layoutSizingVertical, 'FILL');
  assert.equal(inner.fills[0].scaleMode, 'FILL'); assert.equal(inner.layoutPositioning, 'AUTO');
  assert.equal(runtime.images.size, 1);
});

test('native image fill rejects early unequal aspect and rolls back stale Fill boxes after parent layout', async () => {
  const early = imageBoxTransfer(); early.pages[0].children[0].children[0].width = 29;
  const rejected = harness(); const before = rejected.figma.root.children.map(rejected.snapshot);
  await rejected.send({ type: 'import-transfer', content: JSON.stringify(early) });
  assert.equal(rejected.messages.at(-1).type, 'error'); assert.match(rejected.messages.at(-1).message, /宽高比/u);
  assert.deepEqual(rejected.figma.root.children.map(rejected.snapshot), before);
  assert.deepEqual(rejected.calls, []);
  const stale = harness(undefined, { nativeStrokes: true, nativeImageLayout: true });
  const original = stale.figma.root.children.map(stale.snapshot);
  await stale.send({ type: 'import-transfer', content: JSON.stringify(imageBoxTransfer(62)) });
  assert.equal(stale.messages.at(-1).type, 'error'); assert.match(stale.messages.at(-1).message, /宽高比/u);
  assert.deepEqual(stale.figma.root.children.map(stale.snapshot), original);
  assert([...stale.all.values()].some(node => node.type === 'PAGE' && node.removed), 'only newly owned page was removed');
  for (const fit of ['cover', 'contain']) {
    const allowed = imageBoxTransfer(62); allowed.pages[0].children[0].children[0].objectFit = fit;
    const control = harness(undefined, { nativeStrokes: true, nativeImageLayout: true });
    await control.send({ type: 'import-transfer', content: JSON.stringify(allowed) });
    assert.equal(control.messages.at(-1).type, 'imported');
  }
});

test('existing SVG/WebP UI conversion retains fill intent and native preflight validates converted PNG bytes', async (t) => {
  const { chromium } = await import('playwright');
  const { portableFixture } = await import('./fixtures/figma-plugin-v3.mjs');
  const { preparePluginFile } = await import('../../../apps/design-studio/app/figma-plugin/v3-input.mjs');
  const { imageByteDimensions } = await import('../../../apps/design-studio/app/image-dimensions.mjs');
  const browser = await chromium.launch({ args: ['--disable-gpu'] }); t.after(() => browser.close());
  const ui = await readFile(new URL('../../../apps/design-studio/app/figma-plugin/ui.html', import.meta.url), 'utf8');
  const html = '<!doctype html><iframe id="plugin" src="/ui.html" style="width:800px;height:950px"></iframe><script>addEventListener("message",async e=>{if(!e.data?.pluginMessage)return;const reply=await runNativeImport(e.data.pluginMessage);document.querySelector("iframe").contentWindow.postMessage({pluginMessage:reply},"*")})</script>';
  const context = await browser.newContext();
  const external = []; await context.route('**/*', route => {
    const url = route.request().url();
    if (url === 'https://fill-conversion.test/') return route.fulfill({ contentType: 'text/html', body: html });
    if (url === 'https://fill-conversion.test/ui.html') return route.fulfill({ contentType: 'text/html', body: ui });
    external.push(url); return route.abort();
  });
  const page = await context.newPage(); let current, forwarded;
  await page.exposeFunction('runNativeImport', async message => {
    forwarded = JSON.parse(message.content); await current.send(message); return current.messages.at(-1);
  });
  await page.goto('https://fill-conversion.test/');
  await page.frameLocator('#plugin').locator('#paste-transfer-details > summary').click();
  const webp = await page.evaluate(() => { const c=document.createElement('canvas');c.width=c.height=30;return c.toDataURL('image/webp').split(',')[1]; });
  for (const [mime, base64] of [
    ['image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect width="30" height="30" fill="#123456"/></svg>').toString('base64')],
    ['image/webp', webp],
  ]) {
    const portable = await portableFixture({ imageMime: mime, imageBase64: base64 });
    const image = portable.document.pages[1].children[1]; image.objectFit = 'fill'; image.width = image.height = 100;
    const prepared = await preparePluginFile(JSON.stringify(portable));
    assert(prepared.warnings.some(warning => /PNG 后校验/u.test(warning)));
    assert.equal(prepared.transfer.assets.photo.base64, base64, 'bridge keeps exact original bytes');
    const unconverted = harness(); const before = unconverted.figma.root.children.map(unconverted.snapshot);
    await unconverted.send({ type: 'import-transfer', content: JSON.stringify(prepared.transfer) });
    assert.equal(unconverted.messages.at(-1).type, 'error'); assert.match(unconverted.messages.at(-1).message, /PNG、JPEG 或 GIF/u);
    assert.deepEqual(unconverted.figma.root.children.map(unconverted.snapshot), before); assert.deepEqual(unconverted.calls, []);
    current = harness(); forwarded = undefined;
    const frame = page.frameLocator('#plugin');
    await frame.locator('#paste-json').fill(JSON.stringify(portable)); await frame.locator('#load-pasted-json').click();
    await frame.locator('body[aria-busy="false"]').waitFor();
    assert.match(await frame.locator('#status').textContent(), /PNG 后校验/u);
    await frame.locator('#import').click();
    await frame.locator('body[aria-busy="false"]').waitFor();
    assert.match(await frame.locator('#status').textContent(), /已新增/u);
    assert.equal(forwarded.assets.photo.mime, 'image/png');
    const converted = new Uint8Array(Buffer.from(forwarded.assets.photo.base64, 'base64'));
    assert.deepEqual(imageByteDimensions(converted), { width: 30, height: 30 });
    assert.equal(forwarded.pages[1].children[1].objectFit, 'fill');
    assert.equal(current.messages.at(-1).type, 'imported');
  }
  assert.deepEqual(external, []);
});

test("a foreign Grid sibling stays unchanged when nested creation resumes after await", async () => {
  // Retain one real row from the frozen native multi-P source. Native Grid API
  // and implicit ancestor reflow below are MOCKS, not new Figma execution.
  const actual = JSON.parse(await readFile(new URL("../../fixtures/design-studio-native-grid-intrinsic-vflow/native-source.json", import.meta.url), "utf8"));
  const transfer = createFigmaTransfer(importFigmaJson(actual).document);
  const owner = transfer.pages[0].children[0].children[0];
  owner.children = [owner.children[0]];
  const runtime = harness(undefined, { nativeStrokes: true }), foreign = runtime.all.get("1:2"), originalPage = runtime.figma.currentPage;
  const before = { width: foreign.width, height: foreign.height, transform: clone(foreign.relativeTransform), data: clone(foreign.pluginData) };
  let injected = false, indirectWrites = 0, texts = 0;
  const containsForeign = node => node === foreign || node.children.some(containsForeign);
  const createFrame = runtime.figma.createFrame;
  runtime.figma.createFrame = () => {
    const node = createFrame(); let mode = node.layoutMode;
    for (const [axis, key] of [["Row", "gridRowSizes"], ["Column", "gridColumnSizes"]]) {
      let count = 1; node[key] = [{ type: "FIXED", value: 1 }];
      Object.defineProperty(node, `grid${axis}Count`, { get: () => count, set: value => {
        count = value; node[key] = Array.from({ length: value }, () => ({ type: "FIXED", value: 1 }));
      } });
    }
    node.gridAutoTracks = "NONE"; node.gridItemsPositioning = "MANUAL";
    node.setGridChildPosition = function (row, column) { this.gridRowAnchorIndex = row; this.gridColumnAnchorIndex = column; };
    Object.defineProperty(node, "layoutMode", { get: () => mode, set: value => {
      mode = value;
      if (value === "NONE" || !injected) return;
      for (let ancestor = node; ancestor?.type !== "PAGE"; ancestor = ancestor?.parent) {
        if (ancestor?.layoutMode === "GRID" && containsForeign(ancestor)) {
          indirectWrites++; foreign.width = 1; break;
        }
      }
    } });
    return node;
  };
  const createText = runtime.figma.createText;
  runtime.figma.createText = () => {
    const node = createText(), save = node.setPluginData, number = ++texts;
    node.setPluginData = (key, value) => {
      save.call(node, key, value);
      if (key === "codeshellNodeId" && number === 2) queueMicrotask(() => {
        const grid = node.parent.parent;
        assert.equal(grid.layoutMode, "GRID");
        grid.children[0].appendChild(foreign); injected = true;
      });
    };
    return node;
  };
  await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(injected, true); assert.equal(texts, 2);
  assert.equal(runtime.messages.at(-1).type, "error");
  assert.match(runtime.messages.at(-1).message, /外部图层.*已保留/u);
  assert.equal(indirectWrites, 0, "no nested layout setter can trigger foreign ancestor reflow");
  assert.equal(foreign.removed, false); assert.equal(runtime.figma.currentPage, originalPage);
  assert.equal(runtime.figma.root.children.length, 2);
  assert.deepEqual({ width: foreign.width, height: foreign.height, transform: foreign.relativeTransform, data: foreign.pluginData }, before);
});

test("read-only production export captures complete Text ranges and reimports exact current intent with raw fallback retained", async () => {
  const runtime = harness(undefined, { nativeTextRanges: true, nativeTextLayout: true });
  await runtime.send({ type: "import-transfer", content: JSON.stringify(rangeTransfer()) });
  assert.equal(runtime.messages.at(-1).type, "imported", runtime.messages.at(-1).message);
  const frame = runtime.figma.currentPage.children[0], text = frame.children[0];
  text.absoluteBoundingBox = { x: 20, y: 20, width: text.width, height: text.height };
  const selection = runtime.figma.currentPage.selection, dataBefore = JSON.stringify(text.pluginData);
  const writesBefore = text.rangeWrites.length, pagesBefore = runtime.figma.root.children.length;
  await runtime.send({ type: "export-json", scope: "page" });
  assert.equal(runtime.messages.at(-1).type, "exported", runtime.messages.at(-1).message);
  const exported = JSON.parse(runtime.messages.at(-1).content), entry = exported.nativeTextRanges.nodes[text.id];
  assert.equal(exported.nativeTextRanges.pluginId, runtime.figma.pluginId);
  assert.equal(entry.source.characters, "A😀 linked\nend");
  assert.equal(entry.hint, text.pluginData.codeshellTextRangeIntent);
  assert(exported.previews[text.id], "the mixed-fill PNG remains available as raw fallback");
  assert.equal(text.rangeWrites.length, writesBefore); assert.equal(JSON.stringify(text.pluginData), dataBefore);
  assert.equal(runtime.figma.currentPage.selection, selection); assert.equal(runtime.figma.root.children.length, pagesBefore);
  const restored = await prepareFigmaImport(exported, { sha256Bytes: async bytes => createHash("sha256").update(bytes).digest("hex") });
  const canonical = restored.document.nodes.find(node => node.type === "text");
  assert(canonical); assert.equal(canonical.textSource, text.characters);
  assert.equal(canonical.lineHeight, text.lineHeight.value / 100);
  assert.deepEqual(canonical.textRanges.ranges, [{ start: 4, end: 10, fill: "#1d70b8", href: "https://example.com/" }]);
  assert.equal(JSON.stringify(restored.source.nativeTextRanges), JSON.stringify(exported.nativeTextRanges));
  const binding = createFigmaBinding(restored), baseline = JSON.parse(serializeDesignDocument(restored.document));
  assert.throws(() => createFigmaPatch(binding, baseline), error => error.code === "TEXT_RANGES_NATIVE_UNSUPPORTED");
});

test("production export rechecks earlier Text after preview awaits and never publishes stale supplemental data", async () => {
  for (const mutate of [text => text.getRangeHyperlink = () => null, text => text.isMask = true,
    (text, runtime) => text.effects = runtime.jsonRest([{ type: "DROP_SHADOW", visible: true }])]) {
    const runtime = harness(undefined, { nativeTextRanges: true, nativeTextLayout: true });
    await runtime.send({ type: "import-transfer", content: JSON.stringify(rangeTransfer()) });
    assert.equal(runtime.messages.at(-1).type, "imported", runtime.messages.at(-1).message);
    const text = runtime.figma.currentPage.children[0].children[0];
    text.absoluteBoundingBox = { x: 20, y: 20, width: text.width, height: text.height };
    const originalExport = text.exportAsync;
    text.exportAsync = async settings => {
      const response = await originalExport.call(text, settings);
      if (settings.format === "SVG_STRING") mutate(text, runtime);
      return response;
    };
    const writes = text.rangeWrites.length, data = JSON.stringify(text.pluginData);
    await runtime.send({ type: "export-json", scope: "page" });
    assert.equal(runtime.messages.at(-1).type, "error");
    assert.match(runtime.messages.at(-1).message, /changed|unavailable/u);
    assert.equal(text.rangeWrites.length, writes); assert.equal(JSON.stringify(text.pluginData), data);
  }
});

test("production export measures the whole16MiB envelope after individually bounded sources and raw hints", async () => {
  const original = rect("1:2", { type: "TEXT", characters: "Bounded current source", unknownFutureRaw: "x".repeat(100000),
    style: { fontFamily: "Inter", fontSize: 20, fontWeight: 400, lineHeightPercentFontSize: 120, lineHeightUnit: "FONT_SIZE_%", textAutoResize: "HEIGHT" } });
  const small = harness(page([original]), { nativeTextRanges: true, nativeTextLayout: true });
  small.all.get("1:2").pluginData.codeshellTextRangeIntent = "x".repeat(60000);
  await small.send({ type: "export-json", scope: "page" });
  assert.equal(small.messages.at(-1).type, "exported", small.messages.at(-1).message);
  const first = JSON.parse(small.messages.at(-1).content);
  assert(first.nativeTextRanges.nodes["1:2"].source);
  assert.equal(first.nativeTextRanges.nodes["1:2"].hint.length, 60000);
  const source = page(Array.from({ length: 100 }, (_, index) => ({ ...clone(original), id: `bulk:${index}` })));
  const large = harness(source, { nativeTextRanges: true, nativeTextLayout: true });
  for (const text of large.figma.currentPage.children) text.pluginData.codeshellTextRangeIntent = "x".repeat(60000);
  const pages = large.figma.root.children.length;
  await large.send({ type: "export-json", scope: "page" });
  assert.equal(large.messages.at(-1).type, "error");
  assert.match(large.messages.at(-1).message, /16 MiB/u);
  assert.equal(large.figma.root.children.length, pages);
  assert(!large.calls.some(call => call[0].startsWith("setRange")));
});

test("production selected Text refuses safe REST with an initially unsafe own or omitted ancestor SDK context", async () => {
  for (const ancestor of [false, true]) for (const property of ["isMask", "strokes", "effects", "blendMode"]) {
    const runtime = harness(undefined, { nativeTextRanges: true, nativeTextLayout: true });
    await runtime.send({ type: "import-transfer", content: JSON.stringify(rangeTransfer()) });
    assert.equal(runtime.messages.at(-1).type, "imported", runtime.messages.at(-1).message);
    const frame = runtime.figma.currentPage.children[0], text = frame.children[0], target = ancestor ? frame : text;
    text.absoluteBoundingBox = { x: 20, y: 20, width: text.width, height: text.height };
    runtime.figma.currentPage.selection = [text];
    const original = text.exportAsync, data = JSON.stringify(text.pluginData), writes = text.rangeWrites.length;
    text.exportAsync = async settings => {
      const response = await original.call(text, settings);
      if (settings.format === "JSON_REST_V1") target[property] = property === "isMask" ? true :
        property === "blendMode" ? "MULTIPLY" : runtime.jsonRest(property === "strokes"
          ? [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }] : [{ type: "DROP_SHADOW", visible: true }]);
      return response;
    };
    await runtime.send({ type: "export-json", scope: "selection" });
    assert.equal(runtime.messages.at(-1).type, "error");
    assert.match(runtime.messages.at(-1).message, /independent preview cause/u);
    assert.equal(text.rangeWrites.length, writes); assert.equal(JSON.stringify(text.pluginData), data);
    assert.equal(runtime.figma.currentPage.selection[0], text);
  }
});

test("production direct-Page selected Text keeps safe source but refuses an observed Page mask sibling", async () => {
  for (const masked of [false, true]) {
    const runtime = harness(undefined, { nativeTextRanges: true, nativeTextLayout: true });
    await runtime.send({ type: "import-transfer", content: JSON.stringify(rangeTransfer()) });
    assert.equal(runtime.messages.at(-1).type, "imported", runtime.messages.at(-1).message);
    const page = runtime.figma.currentPage, text = page.children[0].children[0];
    page.appendChild(text);
    const sibling = runtime.figma.createRectangle(); sibling.isMask = masked;
    text.absoluteBoundingBox = { x: 20, y: 20, width: text.width, height: text.height };
    page.selection = [text];
    const data = JSON.stringify(text.pluginData), writes = text.rangeWrites.length, pages = runtime.figma.root.children.length;
    await runtime.send({ type: "export-json", scope: "selection" });
    if (masked) {
      assert.equal(runtime.messages.at(-1).type, "error");
      assert.match(runtime.messages.at(-1).message, /known mask child/u);
    } else {
      assert.equal(runtime.messages.at(-1).type, "exported", runtime.messages.at(-1).message);
      const source = JSON.parse(runtime.messages.at(-1).content);
      assert(source.nativeTextRanges.nodes[text.id].source); assert(source.previews[text.id]);
    }
    assert.equal(text.rangeWrites.length, writes); assert.equal(JSON.stringify(text.pluginData), data);
    assert.equal(page.selection[0], text); assert.equal(runtime.figma.root.children.length, pages);
  }
});

test("new vertical distributed auto-margin transfers keep the existing native space-between setters", async () => {
  // VM setter/ownership coverage only; this does not simulate native gap math.
  for (const height of [300, 190, 140]) {
    const source = page([{
      id: "2:1", type: "FRAME", name: "Distributed column", layoutMode: "VERTICAL",
      primaryAxisAlignItems: "SPACE_BETWEEN", counterAxisAlignItems: "MIN",
      layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FIXED", itemSpacing: 0,
      paddingTop: 20, paddingRight: 20, paddingBottom: 20, paddingLeft: 20,
      absoluteBoundingBox: { x: 0, y: 0, width: 640, height },
      children: [40, 50, 60].map((extent, index) => ({
        id: "2:" + (index + 2), type: "FRAME", name: "Hug child " + index,
        layoutMode: "VERTICAL", layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG",
        primaryAxisSizingMode: "AUTO", counterAxisSizingMode: "FIXED",
        primaryAxisAlignItems: "MIN", counterAxisAlignItems: "MIN", itemSpacing: 0,
        absoluteBoundingBox: { x: 20, y: 20 + index * 70, width: 600, height: extent },
        children: [rect("3:" + index, {
          name: "Fixed content " + index, layoutSizingHorizontal: "FILL",
          absoluteBoundingBox: { x: 20, y: 20 + index * 70, width: 600, height: extent },
        })],
      })),
    }]);
    const imported = importFigmaJson(source), transfer = createFigmaTransfer(imported.document);
    const runtime = harness(source), original = runtime.figma.root.children[0];
    const before = runtime.snapshot(original);
    await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
    assert.equal(runtime.messages.at(-1).type, "imported");
    assert.deepEqual(runtime.snapshot(original), before);
    const created = runtime.figma.currentPage.children[0];
    assert.equal(created.layoutMode, "VERTICAL");
    assert.equal(created.primaryAxisAlignItems, "SPACE_BETWEEN");
    assert.equal(created.itemSpacing, 0);
    assert.deepEqual(created.children.map(node => node.name), ["Hug child 0", "Hug child 1", "Hug child 2"]);
    assert(created.children.every(node => node.layoutSizingHorizontal === "FILL" &&
      node.layoutSizingVertical === "HUG" && node.layoutPositioning !== "ABSOLUTE"));
  }
});
