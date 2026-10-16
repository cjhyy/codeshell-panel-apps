import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";
import {
  importFigmaJson,
  createFigmaTransfer,
  MAX_FIGMA_JSON_BYTES,
} from "../../../apps/design-studio/app/figma-bridge.mjs";
import { serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { transformedNodeBoundsInTree } from "../../../apps/design-studio/app/geometry.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";
import { auditDesignPages } from "../../../apps/design-studio/app/audit.mjs";

const solid = (r, g, b) => [{ type: "SOLID", color: { r, g, b } }];
const rect = (id = "1:2", props = {}) => ({
  id,
  type: "RECTANGLE",
  name: "Card",
  absoluteBoundingBox: { x: 30, y: 40, width: 120, height: 80 },
  fills: solid(1, 0, 0),
  ...props,
});
const canvas = (children, props = {}) => ({
  id: "0:1",
  type: "CANVAS",
  name: "Home",
  children,
  ...props,
});
const file = (children) => ({
  name: "Product",
  document: { id: "0:0", type: "DOCUMENT", children: [canvas(children)] },
});
const clone = (value) => JSON.parse(JSON.stringify(value));

test("Figma REST import preserves editable hierarchy, source IDs, absolute geometry, typography and auto layout", () => {
  const source = file([
    {
      ...rect("1:1"),
      type: "FRAME",
      name: "Layout",
      absoluteBoundingBox: { x: 20, y: 30, width: 500, height: 300 },
      layoutMode: "HORIZONTAL",
      layoutWrap: "WRAP",
      itemSpacing: 12,
      counterAxisSpacing: 18,
      paddingLeft: 24,
      primaryAxisAlignItems: "SPACE_BETWEEN",
      counterAxisAlignItems: "CENTER",
      clipsContent: true,
      children: [
        rect(),
        {
          ...rect("1:3"),
          type: "TEXT",
          characters: "Hello\n你好",
          absoluteBoundingBox: { x: 180, y: 50, width: 150, height: 60 },
          style: {
            fontFamily: "Inter",
            fontSize: 20,
            fontWeight: 600,
            lineHeightPx: 28,
            italic: true,
            letterSpacing: 1,
            textAlignHorizontal: "CENTER",
          },
          fills: solid(0, 0, 0),
          layoutSizingHorizontal: "FILL",
          layoutPositioning: "ABSOLUTE",
        },
      ],
    },
  ]);
  const before = JSON.stringify(source),
    result = importFigmaJson(source);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(result.stats, { pages: 1, importedNodes: 3, skippedNodes: 0, warningCount: 0 });
  assert.equal(result.document.name, "Product");
  const [frame, shape, text] = result.document.nodes;
  assert.equal(frame.id, "figma-1-1");
  assert.equal(shape.parentId, frame.id);
  assert.equal(text.parentId, frame.id);
  assert.deepEqual([shape.x, shape.y, shape.width, shape.height], [30, 40, 120, 80]);
  assert.deepEqual(
    [
      frame.layout,
      frame.layoutWrap,
      frame.gap,
      frame.rowGap,
      frame.paddingLeft,
      frame.alignItems,
      frame.justifyContent,
      frame.clipContent,
    ],
    ["horizontal", "wrap", 12, 18, 24, "center", "space-between", true],
  );
  assert.deepEqual(
    [
      text.fontFamily,
      text.fontSize,
      text.fontWeight,
      text.lineHeight,
      text.fontStyle,
      text.textAlign,
      text.layoutSizingHorizontal,
      text.layoutPositioning,
    ],
    ["Inter", 20, 600, 1.4, "italic", "center", "fill", "absolute"],
  );
  const transfer = createFigmaTransfer(result.document);
  assert.equal(transfer.format, "codeshell.figma.transfer");
  assert.equal(transfer.version, 1);
  assert.equal(transfer.pages[0].children[0].children[0].sourceId, "1:2");
  assert.equal(transfer.pages[0].children[0].children[0].parentId, undefined);
  assert.equal(
    serializeDesignDocument(importFigmaJson(source).document),
    serializeDesignDocument(result.document),
  );
});

test("all supported official JSON wrappers import consistently and ids remain globally unique", () => {
  const page = canvas([rect()]);
  for (const input of [
    page,
    { document: page },
    { type: "DOCUMENT", children: [page] },
    { nodes: { "0:1": { document: page } } },
  ])
    assert.equal(importFigmaJson(input).document.nodes[0].id, "figma-1-2");
  const selected = importFigmaJson({
    name: "Selection",
    nodes: { "1:2": { document: rect() }, "1:3": { document: rect("1:3") } },
  });
  assert.equal(selected.document.nodes.length, 2);
  const duplicated = importFigmaJson({
    type: "DOCUMENT",
    children: [page, canvas([rect()], { id: "0:2" })],
  });
  assert.deepEqual(
    duplicated.document.pages.map((entry) => entry.nodes[0].id),
    ["figma-1-2", "figma-1-2-2"],
  );
  assert.ok(duplicated.warnings.some((warning) => warning.code === "duplicate-source-id"));
});

test("rotated parent and nested children preserve their visual bounds in absolute-canvas coordinates", () => {
  const source = file([
    {
      ...rect("1:1"),
      type: "FRAME",
      size: { x: 200, y: 100 },
      relativeTransform: [
        [0, -1, 100],
        [1, 0, 100],
      ],
      absoluteBoundingBox: { x: 0, y: 100, width: 100, height: 200 },
      children: [
        {
          ...rect("1:2"),
          size: { x: 30, y: 20 },
          relativeTransform: [
            [1, 0, 10],
            [0, 1, 20],
          ],
          absoluteBoundingBox: { x: 60, y: 110, width: 20, height: 30 },
        },
      ],
    },
  ]);
  const result = importFigmaJson(source),
    [frame, child] = result.document.nodes;
  assert.equal(frame.rotation, 90);
  assert.deepEqual([frame.x, frame.y, child.x, child.y], [-50, 150, -40, 170]);
  assert.deepEqual(transformedNodeBoundsInTree(result.document.nodes, child), {
    x: 60,
    y: 110,
    width: 20,
    height: 30,
  });
});

test("unsupported content and paint fidelity is reported explicitly without retaining unsafe metadata", () => {
  const source = file([
    {
      ...rect(),
      fills: [{ type: "GRADIENT_LINEAR" }, { type: "IMAGE", imageRef: "secret" }],
      isMask: true,
      blendMode: "MULTIPLY",
      pluginData: { credentials: "never copy" },
      boundVariables: { fills: [{ id: "variable" }] },
    },
    { id: "2:1", type: "VECTOR", children: [rect("2:2")] },
    { ...rect("3:1"), type: "INSTANCE", children: [rect("3:2")] },
    {
      ...rect("4:1"),
      type: "TEXT",
      characters: "mixed",
      style: { fontSize: 999, fontWeight: 650, textAlignHorizontal: "JUSTIFIED" },
      characterStyleOverrides: [0, 1],
    },
  ]);
  const result = importFigmaJson(source);
  assert.equal(result.stats.importedNodes, 4);
  assert.equal(result.stats.skippedNodes, 2);
  for (const code of [
    "unsupported-paint",
    "unsupported-node",
    "unsupported-mask",
    "blend-mode",
    "variables-as-literals",
    "detached-component",
    "rich-text",
    "value-clamped",
    "justified-text",
  ])
    assert.ok(
      result.warnings.some((warning) => warning.code === code),
      code,
    );
  assert.equal(result.document.nodes[0].fill, "transparent");
  assert.ok(!JSON.stringify(createFigmaTransfer(result.document)).includes("credentials"));
});

test("negative Figma page origins move the entire subtree into a visible HTML canvas", () => {
  const result = importFigmaJson(
    file([
      {
        ...rect("1:1"),
        type: "FRAME",
        absoluteBoundingBox: { x: -300, y: -200, width: 300, height: 200 },
        children: [
          rect("1:2", { absoluteBoundingBox: { x: -270, y: -160, width: 120, height: 80 } }),
        ],
      },
    ]),
  );
  const [frame, child] = result.document.nodes;
  assert.deepEqual([frame.x, frame.y, child.x, child.y], [0, 0, 30, 40]);
  assert.ok(result.warnings.some((warning) => warning.code === "page-origin-normalized"));
  const frontend = exportDesignFrontend(JSON.parse(serializeDesignDocument(result.document)));
  assert.ok(frontend.includes("figma-1-2"));
  assert.match(frontend, /left:\s*30px/u);
  assert.doesNotMatch(frontend, /left:\s*-270px/u);
});

test("clipped offscreen descendants keep their geometry and mapping without moving the imported page", () => {
  const source = file([
    rect("1:1", {
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 1260, height: 1171 },
      clipsContent: true,
      children: [
        rect("1:2", {
          type: "FRAME",
          absoluteBoundingBox: { x: -9999, y: 50, width: 84, height: 22 },
          absoluteRenderBounds: null,
          children: [rect("1:3", { absoluteBoundingBox: { x: -9999, y: 50, width: 84, height: 22 } })],
        }),
        rect("1:4", { absoluteBoundingBox: { x: 18000, y: 100, width: 80, height: 80 } }),
        rect("1:5", { absoluteBoundingBox: { x: -50, y: 200, width: 100, height: 80 } }),
      ],
    }),
  ]);
  const original = JSON.stringify(source);
  const result = importFigmaJson(source);
  assert.equal(JSON.stringify(source), original);
  assert.deepEqual(result.document.canvas, { width: 1440, height: 1171, background: "#f5f5f2" });
  assert.equal(result.stats.importedNodes, 5);
  assert.equal(result.stats.skippedNodes, 0);
  assert.deepEqual(result.document.nodes.map((node) => node.x), [0, -9999, -9999, 18000, -50]);
  assert.equal(result.mapping.length, 5);
  assert.ok(result.mapping.every((entry) => entry.offsetX === 0 && entry.offsetY === 0));
  assert.ok(!result.warnings.some((warning) => ["page-origin-normalized", "canvas-extent"].includes(warning.code)));
  const issues = auditDesignPages(result.document);
  assert.ok(!issues.some((issue) => issue.code === "layout.canvas-overflow"));
  assert.ok(issues.some((issue) => issue.code === "layout.parent-overflow"));
});

test("hidden, transparent and organizational bounds do not enlarge the visible Figma canvas", () => {
  const result = importFigmaJson(file([
    rect("1:1", { visible: false, absoluteBoundingBox: { x: -15000, y: -15000, width: 100, height: 100 } }),
    rect("1:2", {
      type: "FRAME",
      opacity: 0,
      absoluteBoundingBox: { x: 18000, y: 18000, width: 100, height: 100 },
      children: [rect("1:3", { absoluteBoundingBox: { x: -12000, y: -12000, width: 100, height: 100 } })],
    }),
    rect("1:4", {
      type: "GROUP",
      absoluteBoundingBox: { x: -9999, y: -9999, width: 12000, height: 12000 },
      children: [rect("1:5")],
    }),
  ]));
  assert.equal(result.document.nodes.length, 5);
  assert.deepEqual(result.document.canvas, { width: 1440, height: 960, background: "#f5f5f2" });
  assert.ok(!result.warnings.some((warning) => warning.code === "page-origin-normalized"));
  assert.ok(!auditDesignPages(result.document).some((issue) => issue.code === "layout.canvas-overflow"));
});

test("far-away visible content is normalized even when another root is hidden at the origin", () => {
  const result = importFigmaJson(file([
    rect("1:1", { visible: false, absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 } }),
    rect("1:2", { absoluteBoundingBox: { x: 20000, y: 20000, width: 120, height: 80 } }),
  ]));
  assert.deepEqual(result.document.nodes.map((node) => [node.x, node.y]), [[-20000, -20000], [0, 0]]);
  assert.deepEqual(result.mapping.map((entry) => [entry.offsetX, entry.offsetY]), [[-20000, -20000], [-20000, -20000]]);
  assert.ok(!result.warnings.some((warning) => warning.code === "canvas-extent"));
});

test("rotated clipping ancestors keep offscreen descendants out of page-origin calculations", () => {
  const result = importFigmaJson(file([
    rect("1:1", {
      type: "FRAME",
      absoluteBoundingBox: { x: 50, y: 50, width: 282.8427, height: 282.8427 },
      size: { x: 200, y: 200 },
      rotation: Math.PI / 4,
      clipsContent: true,
      children: [rect("1:2", { absoluteBoundingBox: { x: -9999, y: 50, width: 84, height: 22 } })],
    }),
  ]));
  assert.equal(result.document.nodes.length, 2);
  assert.deepEqual(result.document.canvas, { width: 1440, height: 960, background: "#f5f5f2" });
  assert.ok(result.mapping.every((entry) => entry.offsetX === 0 && entry.offsetY === 0));
  assert.ok(!auditDesignPages(result.document).some((issue) => issue.code === "layout.canvas-overflow"));
});

test("canvas audits use visible clipped geometry while retaining real overflow and clipping diagnostics", () => {
  const result = importFigmaJson(file([
    rect("1:1", {
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
      clipsContent: true,
      children: [rect("1:2", {
        absoluteBoundingBox: { x: 180, y: 20, width: 80, height: 80 },
        effects: [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 1 }, offset: { x: 100, y: 0 }, radius: 10 }],
      })],
    }),
  ]));
  result.document.canvas.width = 200;
  result.document.canvas.height = 200;
  let issues = auditDesignPages(result.document);
  assert.ok(!issues.some((issue) => ["layout.canvas-overflow", "layout.effect-canvas-overflow"].includes(issue.code)));
  assert.ok(issues.some((issue) => issue.code === "layout.parent-overflow" && issue.blocking));
  result.document.nodes[0].clipContent = false;
  issues = auditDesignPages(result.document);
  assert.ok(issues.some((issue) => issue.code === "layout.canvas-overflow" && issue.nodeId === "figma-1-2"));
  result.document.nodes[1].x = 100;
  result.document.nodes[1].width = 80;
  issues = auditDesignPages(result.document);
  assert.ok(issues.some((issue) => issue.code === "layout.effect-canvas-overflow" && issue.nodeId === "figma-1-2"));
});

test("oversized transfer JSON is rejected before it can be downloaded for the Figma plugin", () => {
  const source = file(
    Array.from({ length: 2100 }, (_, index) => ({
      ...rect(`1:${index + 1}`),
      type: "TEXT",
      characters: "x".repeat(4000),
    })),
  );
  const result = importFigmaJson(source);
  assert.throws(() => createFigmaTransfer(result.document), /超过 16 MiB/);
});

test("malformed, cyclic, excessively deep and oversized imports fail without producing a document", () => {
  for (const input of [
    "binary\0fig",
    {},
    { type: "DOCUMENT", children: [rect()] },
    canvas([], { children: null }),
    file([rect("bad", { children: [rect()] })]),
  ])
    assert.throws(() => importFigmaJson(input));
  const cycle = {};
  cycle.document = cycle;
  assert.throws(() => importFigmaJson(cycle), /包装层级/);
  const tree = rect("root", { type: "FRAME", children: [] });
  let cursor = tree;
  for (let index = 0; index < 34; index += 1) {
    const child = rect(`nested-${index}`, { type: "FRAME", children: [] });
    cursor.children.push(child);
    cursor = child;
  }
  assert.throws(() => importFigmaJson(file([tree])), /嵌套/);
  assert.throws(() => importFigmaJson(" ".repeat(MAX_FIGMA_JSON_BYTES + 1)), /16 MiB/);
  assert.throws(
    () =>
      importFigmaJson(
        file(Array.from({ length: 10001 }, (_, index) => ({ type: "VECTOR", id: `v:${index}` }))),
      ),
    /上限/,
  );
});

test("Figma transfer reports detached containers, notes and unsupported layout instead of claiming losslessness", () => {
  const result = importFigmaJson(file([{ ...rect("1:1"), type: "FRAME", children: [rect()] }]));
  const parent = result.document.nodes[0];
  parent.type = "group";
  parent.fill = "transparent";
  parent.layout = "grid";
  parent.notes = "Review with designer";
  delete parent.clipContent;
  const transfer = createFigmaTransfer(result.document);
  assert.equal(transfer.stats.exportedNodes, 2);
  assert.deepEqual(
    transfer.warnings.map((entry) => entry.code),
    ["container-as-frame", "grid-export", "notes-plugin-data"],
  );
  assert.equal(transfer.pages[0].children[0].notes, "Review with designer");
});

const pluginCode = await readFile(
  new URL("../../../apps/design-studio/app/figma-plugin/code.js", import.meta.url),
  "utf8",
);

function pluginHarness({ missingFont = false, failFallback = false, failNode = false } = {}) {
  const messages = [],
    pages = [],
    loaded = new Set(),
    calls = [],
    removed = [];
  let serial = 0,
    nodeCreations = 0;
  function node(type, id = `plugin:${++serial}`) {
    let fontName;
    const value = {
      id,
      type,
      children: [],
      pluginData: {},
      selection: [],
      parent: null,
      layoutMode: "NONE",
      name: type,
      appendChild(child) {
        if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
        this.children.push(child);
        child.parent = this;
      },
      resize(width, height) {
        this.width = width;
        this.height = height;
      },
      setPluginData(key, data) {
        this.pluginData[key] = data;
      },
      remove() {
        removed.push(this);
        const index = pages.indexOf(this);
        if (index >= 0) pages.splice(index, 1);
      },
      async loadAsync() {
        calls.push(["load", id]);
      },
      async exportAsync(settings) {
        calls.push(["export", id, settings.format]);
        return {
          document: type === "PAGE" ? canvas([rect()], { id }) : rect(id),
          components: {},
          styles: {},
        };
      },
    };
    Object.defineProperty(value, "fontName", {
      get: () => fontName,
      set: (font) => {
        assert.ok(loaded.has(JSON.stringify(font)), "font must be loaded before assignment");
        fontName = font;
      },
    });
    return value;
  }
  const existing = node("PAGE", "existing");
  existing.name = "Original page";
  pages.push(existing);
  const originalNode = node("RECTANGLE", "original");
  existing.appendChild(originalNode);
  const figma = {
    currentPage: existing,
    root: { children: pages },
    viewport: {
      scrollAndZoomIntoView(nodes) {
        calls.push(["viewport", nodes.length]);
      },
    },
    ui: {
      postMessage(message) {
        messages.push(clone(message));
      },
    },
    showUI() {},
    createPage() {
      const page = node("PAGE");
      pages.push(page);
      return page;
    },
    async setCurrentPageAsync(page) {
      figma.currentPage = page;
    },
    async loadFontAsync(font) {
      calls.push(["font", font.family, font.style]);
      if (failFallback || (missingFont && font.family !== "Inter"))
        throw new Error("font unavailable");
      loaded.add(JSON.stringify(font));
    },
  };
  for (const [method, type] of [
    ["createFrame", "FRAME"],
    ["createText", "TEXT"],
    ["createRectangle", "RECTANGLE"],
    ["createEllipse", "ELLIPSE"],
  ])
    figma[method] = () => {
      if (failNode && ++nodeCreations === 2) throw new Error("construction failed");
      const created = node(type);
      figma.currentPage.appendChild(created);
      return created;
    };
  vm.runInNewContext(pluginCode, { figma, __html__: "local UI" });
  return {
    figma,
    existing,
    originalNode,
    pages,
    messages,
    calls,
    removed,
    send: (message) => figma.ui.onmessage(message),
  };
}

test("plugin exports official direct JSON_REST_V1 shape and only selected roots, without writing existing data", async () => {
  const harness = pluginHarness();
  await harness.send({ type: "export-json", scope: "page" });
  assert.equal(harness.messages[0].type, "exported");
  const value = JSON.parse(harness.messages[0].content);
  assert.equal(value.nodes.existing.document.type, "CANVAS");
  assert.equal(importFigmaJson(value).document.nodes.length, 1);
  assert.deepEqual(harness.calls.slice(0, 2), [
    ["load", "existing"],
    ["export", "existing", "JSON_REST_V1"],
  ]);
  harness.existing.selection = [harness.originalNode];
  await harness.send({ type: "export-json", scope: "selection" });
  assert.equal(harness.messages[1].type, "exported");
  assert.equal(harness.pages.length, 1);
  assert.equal(harness.existing.name, "Original page");
  assert.deepEqual(harness.originalNode.pluginData, {});
});

test("plugin creates new editable pages, loads fonts before editing text and reports missing-font fallback", async () => {
  const source = file([
    {
      ...rect("1:1"),
      type: "FRAME",
      layoutMode: "VERTICAL",
      itemSpacing: 8,
      children: [
        {
          ...rect("1:2"),
          type: "TEXT",
          characters: "Editable",
          style: { fontFamily: "Unavailable family", fontSize: 20, fontWeight: 400 },
        },
      ],
    },
  ]);
  const transfer = createFigmaTransfer(importFigmaJson(source).document),
    harness = pluginHarness({ missingFont: true });
  await harness.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(harness.messages[0].type, "imported");
  assert.equal(harness.pages.length, 2);
  assert.equal(harness.existing.children[0], harness.originalNode);
  const frame = harness.pages[1].children[0],
    text = frame.children[0];
  assert.equal(frame.type, "FRAME");
  assert.equal(frame.layoutMode, "VERTICAL");
  assert.equal(frame.itemSpacing, 8);
  assert.equal(text.characters, "Editable");
  assert.equal(text.fontName.family, "Inter");
  assert.equal(text.pluginData.codeshellNodeId, "figma-1-2");
  assert.equal(text.pluginData.figmaSourceId, "1:2");
  assert.ok(harness.messages[0].warnings.some((warning) => warning.includes("Inter Regular")));
});

test("plugin validates every page before writes and rolls back only pages owned by a failed import", async () => {
  const valid = createFigmaTransfer(importFigmaJson(file([rect(), rect("1:3")])).document),
    invalid = clone(valid);
  invalid.pages.push({
    id: "second",
    name: "Invalid page",
    children: [{ ...invalid.pages[0].children[0], id: "invalid", width: Infinity }],
  });
  const harness = pluginHarness();
  await harness.send({ type: "import-transfer", content: JSON.stringify(invalid) });
  assert.equal(harness.messages[0].type, "error");
  assert.equal(harness.pages.length, 1);
  assert.equal(harness.removed.length, 0);
  const failure = pluginHarness({ failNode: true });
  await failure.send({ type: "import-transfer", content: JSON.stringify(valid) });
  assert.equal(failure.messages[0].type, "error");
  assert.equal(failure.pages.length, 1);
  assert.equal(failure.pages[0], failure.existing);
  assert.equal(failure.removed.length, 1);
});

test("plugin manifests local-only access and surfaces empty selections and fallback-font failure", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../../../apps/design-studio/app/figma-plugin/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(manifest.networkAccess.allowedDomains, ["none"]);
  const harness = pluginHarness();
  await harness.send({ type: "export-json", scope: "selection" });
  assert.equal(harness.messages[0].type, "error");
  const failure = pluginHarness({ failFallback: true });
  const transfer = createFigmaTransfer(
    importFigmaJson(
      file([{ ...rect(), type: "TEXT", characters: "Font", style: { fontFamily: "Missing" } }]),
    ).document,
  );
  await failure.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(failure.messages[0].type, "error");
  assert.equal(failure.pages.length, 1);
});
