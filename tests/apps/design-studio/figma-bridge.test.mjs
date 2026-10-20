import { normalizeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { nativeGridSource } from "../../fixtures/design-studio-native-grid/source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";
import {
  importFigmaJson,
  prepareFigmaImport,
  createFigmaTransfer,
  MAX_FIGMA_JSON_BYTES,
} from "../../../apps/design-studio/app/figma-bridge.mjs";
import { serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { transformedNodeBoundsInTree } from "../../../apps/design-studio/app/geometry.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";
import { auditDesignPages } from "../../../apps/design-studio/app/audit.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";

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

test("explicit null source render bounds preserve fully clipped branches without hiding accidental clipping", () => {
  const hiddenBranch = {
    ...rect("1:2"),
    type: "FRAME",
    absoluteRenderBounds: null,
    absoluteBoundingBox: { x: -9000, y: 30, width: 84, height: 22 },
    children: [
      {
        ...rect("1:3"),
        type: "TEXT",
        absoluteRenderBounds: null,
        characters: "Skip to content",
        absoluteBoundingBox: { x: -9000, y: 30, width: 84, height: 23 },
        style: { fontFamily: "Arial", fontSize: 14 },
      },
    ],
  };
  const parent = {
    ...rect("1:1"),
    type: "FRAME",
    clipsContent: true,
    absoluteBoundingBox: { x: 0, y: 0, width: 500, height: 100 },
    children: [hiddenBranch],
  };
  const raw = file([parent]),
    previous = JSON.stringify(raw);
  const result = importFigmaJson(raw);
  assert.equal(JSON.stringify(raw), previous);
  assert.equal(result.stats.importedNodes, 3);
  assert.equal(result.mapping.length, 3);
  assert.deepEqual(
    result.document.nodes.slice(1).map((n) => n.visible),
    [false, false],
  );
  assert.equal(auditDesignPages(result.document).filter((i) => i.blocking).length, 0);
  for (const renderBounds of [undefined, { x: 0, y: 0, width: 1, height: 1 }]) {
    const accidental = clone(raw);
    for (const node of [
      accidental.document.children[0].children[0].children[0],
      accidental.document.children[0].children[0].children[0].children[0],
    ])
      if (renderBounds === undefined) delete node.absoluteRenderBounds;
      else node.absoluteRenderBounds = renderBounds;
    const imported = importFigmaJson(accidental);
    assert.equal(imported.document.nodes[1].visible, true);
    assert.ok(auditDesignPages(imported.document).some((i) => i.blocking));
  }
});

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

test("legacy Figma auto layout sizing survives import and resizes children in flow", () => {
  for (const layoutMode of ["HORIZONTAL", "VERTICAL"]) {
    const horizontal = layoutMode === "HORIZONTAL";
    const source = file([
      {
        ...rect("1:1"),
        type: "FRAME",
        layoutMode,
        primaryAxisSizingMode: "FIXED",
        counterAxisSizingMode: "AUTO",
        absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 300 },
        itemSpacing: 10,
        children: [
          rect("1:2", { layoutGrow: 1 }),
          rect("1:3", { layoutAlign: "STRETCH" }),
          {
            ...rect("1:4"),
            type: "FRAME",
            layoutMode: horizontal ? "VERTICAL" : "HORIZONTAL",
            primaryAxisSizingMode: "AUTO",
            counterAxisSizingMode: "AUTO",
            layoutGrow: 1,
            children: [],
          },
        ],
      },
    ]);
    const before = JSON.stringify(source);
    const { document } = importFigmaJson(source);
    assert.equal(JSON.stringify(source), before);
    const [frame, growing, stretched, nested] = document.nodes;
    const main = horizontal ? "Horizontal" : "Vertical";
    const cross = horizontal ? "Vertical" : "Horizontal";
    assert.equal(frame[`layoutSizing${main}`], "fixed");
    assert.equal(frame[`layoutSizing${cross}`], "hug");
    assert.equal(growing[`layoutSizing${main}`], "fill");
    assert.equal(stretched[`layoutSizing${cross}`], "fill");
    assert.equal(nested[`layoutSizing${main}`], "fill");
    assert.equal(nested[`layoutSizing${cross}`], "hug");
    assert(document.nodes.slice(1).every((node) => node.layoutPositioning !== "absolute"));
    applyAllAutoLayouts(document.nodes);
    const size = horizontal ? "width" : "height";
    const beforeSize = growing[size];
    frame[size] += 100;
    applyAllAutoLayouts(document.nodes);
    assert(growing[size] > beforeSize, "fill children must respond to parent resize");
    const transfer = createFigmaTransfer(document);
    assert.equal(transfer.pages[0].children[0].children[0][`layoutSizing${main}`], "fill");
  }
});

test("modern sizing wins over legacy hints and absolute children do not inherit fill", () => {
  const { document } = importFigmaJson(
    file([
      {
        ...rect("1:1"),
        type: "FRAME",
        layoutMode: "HORIZONTAL",
        primaryAxisSizingMode: "AUTO",
        counterAxisSizingMode: "AUTO",
        layoutSizingHorizontal: "FIXED",
        children: [
          rect("1:2", {
            layoutGrow: 1,
            layoutAlign: "STRETCH",
            layoutSizingHorizontal: "FIXED",
            layoutSizingVertical: "FIXED",
          }),
          rect("1:3", {
            layoutGrow: 1,
            layoutAlign: "STRETCH",
            layoutPositioning: "ABSOLUTE",
          }),
          {
            ...rect("1:4"),
            type: "TEXT",
            characters: "Content grows",
            style: { fontSize: 16, textAutoResize: "WIDTH_AND_HEIGHT" },
          },
          {
            ...rect("1:5"),
            type: "TEXT",
            characters: "Fixed width, automatic height",
            style: { fontSize: 16, textAutoResize: "HEIGHT" },
          },
        ],
      },
    ]),
  );
  const [frame, modern, absolute, text, paragraph] = document.nodes;
  assert.equal(frame.layoutSizingHorizontal, "fixed");
  assert.equal(frame.layoutSizingVertical, "hug");
  assert.equal(modern.layoutSizingHorizontal, "fixed");
  assert.equal(modern.layoutSizingVertical, "fixed");
  assert.notEqual(modern.layoutAlignSelf, "stretch");
  assert.notEqual(absolute.layoutSizingHorizontal, "fill");
  assert.notEqual(absolute.layoutSizingVertical, "fill");
  assert.notEqual(absolute.layoutAlignSelf, "stretch");
  assert.equal(text.layoutSizingHorizontal, "hug");
  assert.equal(text.layoutSizingVertical, "hug");
  assert.equal(paragraph.layoutSizingHorizontal, "fixed");
  assert.equal(paragraph.layoutSizingVertical, "hug");
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

const advisoryTexts = (count) =>
  Array.from({ length: count }, (_, index) => ({
    ...rect(`10:${index + 1}`),
    type: "TEXT",
    characters: "Label",
    style: { fontSize: 14, fontFamily: "Fixture Sans", textAlignVertical: "CENTER" },
  }));

test("bounded import warnings keep late missing images and lost content before layout advisories", () => {
  const source = file([
    ...advisoryTexts(250),
    ...["20:1", "20:2"].map((id) =>
      rect(id, {
        fills: [{ type: "IMAGE", imageRef: `unavailable-${id}` }],
      }),
    ),
    ...Array.from({ length: 8 }, (_, index) => ({
      ...rect(`30:${index + 1}`),
      type: "TEXT",
      characters: "Rich copy",
      style: { fontSize: 14 },
      characterStyleOverrides: [0, 1],
    })),
    { ...rect("40:1"), type: "VECTOR" },
    rect("50:1", { effects: [{ type: "INNER_SHADOW", visible: true }] }),
  ]);
  const before = JSON.stringify(source);
  const result = importFigmaJson(source);
  assert.equal(JSON.stringify(source), before);
  assert.equal(result.stats.warningCount, 262);
  assert.deepEqual(
    Object.fromEntries(result.warningGroups.map(({ code, count }) => [code, count])),
    {
      "vertical-text": 250,
      "unsupported-paint": 2,
      "rich-text": 8,
      "unsupported-node": 1,
      "unsupported-effects": 1,
    },
  );
  // The existing UI renders only the first 20 details.
  const preview = result.warnings.slice(0, 20);
  assert.deepEqual(
    preview.slice(0, 2).map(({ code, nodeId }) => [code, nodeId]),
    [
      ["unsupported-paint", "20:1"],
      ["unsupported-paint", "20:2"],
    ],
  );
  assert.ok(preview.slice(0, 2).every(({ message }) => message.includes("IMAGE")));
  assert.equal(preview.filter(({ code }) => code === "rich-text").length, 8);
  assert.ok(preview.some(({ code, nodeId }) => code === "unsupported-node" && nodeId === "40:1"));
  assert.ok(
    preview.findIndex(({ code }) => code === "unsupported-effects") <
      preview.findIndex(({ code }) => code === "vertical-text"),
  );
  assert.equal(result.mapping.length, 261);
  assert.ok(result.mapping.some(({ sourceId }) => sourceId === "20:2"));
  assert.equal(result.warnings.length, 201); // 200 sampled details plus one summary.
  assert.deepEqual(result.warnings.at(-1), {
    code: "warnings-truncated",
    message: "另有 62 条兼容性提示未展开。",
  });
  assert.equal(
    result.warningGroups.reduce((sum, group) => sum + group.count, 0),
    262,
  );
  assert.deepEqual(importFigmaJson(source).warnings, result.warnings);
});

test("prepare adds font and plugin warnings to the same bounded sample and complete totals", async () => {
  const source = file(advisoryTexts(250));
  source.warnings = ["Plugin could not export an original image."];
  const before = JSON.stringify(source);
  const result = await prepareFigmaImport(source, {
    textMeasurer: {
      configure() {},
      measure() {
        return { width: 35, bottom: 12, ink: { x: 0, y: 0, width: 35, height: 12 } };
      },
      fontAvailable() {
        return false;
      },
    },
  });
  assert.equal(JSON.stringify(source), before);
  assert.equal(result.stats.warningCount, 252);
  assert.deepEqual(result.warningGroups, [
    { code: "vertical-text", count: 250 },
    { code: "font-fallback", count: 1 },
    { code: "plugin-export-warning", count: 1 },
  ]);
  assert.deepEqual(
    result.warnings.slice(0, 2).map(({ code }) => code),
    ["font-fallback", "plugin-export-warning"],
  );
  assert.equal(result.warnings[1].message, source.warnings[0]);
  assert.equal(result.warnings.length, 201);
  assert.equal(result.warnings.filter(({ code }) => code === "warnings-truncated").length, 1);
  assert.match(result.warnings.at(-1).message, /52/u);
  assert.equal(result.mapping.length, 250);
  assert.deepEqual(result.source.warnings, source.warnings);
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
          children: [
            rect("1:3", { absoluteBoundingBox: { x: -9999, y: 50, width: 84, height: 22 } }),
          ],
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
  assert.deepEqual(
    result.document.nodes.map((node) => node.x),
    [0, -9999, -9999, 18000, -50],
  );
  assert.equal(result.mapping.length, 5);
  assert.ok(result.mapping.every((entry) => entry.offsetX === 0 && entry.offsetY === 0));
  assert.ok(
    !result.warnings.some((warning) =>
      ["page-origin-normalized", "canvas-extent"].includes(warning.code),
    ),
  );
  const issues = auditDesignPages(result.document);
  assert.ok(!issues.some((issue) => issue.code === "layout.canvas-overflow"));
  assert.ok(issues.some((issue) => issue.code === "layout.parent-overflow"));
});

test("hidden, transparent and organizational bounds do not enlarge the visible Figma canvas", () => {
  const result = importFigmaJson(
    file([
      rect("1:1", {
        visible: false,
        absoluteBoundingBox: { x: -15000, y: -15000, width: 100, height: 100 },
      }),
      rect("1:2", {
        type: "FRAME",
        opacity: 0,
        absoluteBoundingBox: { x: 18000, y: 18000, width: 100, height: 100 },
        children: [
          rect("1:3", { absoluteBoundingBox: { x: -12000, y: -12000, width: 100, height: 100 } }),
        ],
      }),
      rect("1:4", {
        type: "GROUP",
        absoluteBoundingBox: { x: -9999, y: -9999, width: 12000, height: 12000 },
        children: [rect("1:5")],
      }),
    ]),
  );
  assert.equal(result.document.nodes.length, 5);
  assert.deepEqual(result.document.canvas, { width: 1440, height: 960, background: "#f5f5f2" });
  assert.ok(!result.warnings.some((warning) => warning.code === "page-origin-normalized"));
  assert.ok(
    !auditDesignPages(result.document).some((issue) => issue.code === "layout.canvas-overflow"),
  );
});

test("far-away visible content is normalized even when another root is hidden at the origin", () => {
  const result = importFigmaJson(
    file([
      rect("1:1", { visible: false, absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 } }),
      rect("1:2", { absoluteBoundingBox: { x: 20000, y: 20000, width: 120, height: 80 } }),
    ]),
  );
  assert.deepEqual(
    result.document.nodes.map((node) => [node.x, node.y]),
    [
      [-20000, -20000],
      [0, 0],
    ],
  );
  assert.deepEqual(
    result.mapping.map((entry) => [entry.offsetX, entry.offsetY]),
    [
      [-20000, -20000],
      [-20000, -20000],
    ],
  );
  assert.ok(!result.warnings.some((warning) => warning.code === "canvas-extent"));
});

test("rotated clipping ancestors keep offscreen descendants out of page-origin calculations", () => {
  const result = importFigmaJson(
    file([
      rect("1:1", {
        type: "FRAME",
        absoluteBoundingBox: { x: 50, y: 50, width: 282.8427, height: 282.8427 },
        size: { x: 200, y: 200 },
        rotation: Math.PI / 4,
        clipsContent: true,
        children: [
          rect("1:2", { absoluteBoundingBox: { x: -9999, y: 50, width: 84, height: 22 } }),
        ],
      }),
    ]),
  );
  assert.equal(result.document.nodes.length, 2);
  assert.deepEqual(result.document.canvas, { width: 1440, height: 960, background: "#f5f5f2" });
  assert.ok(result.mapping.every((entry) => entry.offsetX === 0 && entry.offsetY === 0));
  assert.ok(
    !auditDesignPages(result.document).some((issue) => issue.code === "layout.canvas-overflow"),
  );
});

test("canvas audits use visible clipped geometry while retaining real overflow and clipping diagnostics", () => {
  const result = importFigmaJson(
    file([
      rect("1:1", {
        type: "FRAME",
        absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
        clipsContent: true,
        children: [
          rect("1:2", {
            absoluteBoundingBox: { x: 180, y: 20, width: 80, height: 80 },
            effects: [
              {
                type: "DROP_SHADOW",
                color: { r: 0, g: 0, b: 0, a: 1 },
                offset: { x: 100, y: 0 },
                radius: 10,
              },
            ],
          }),
        ],
      }),
    ]),
  );
  result.document.canvas.width = 200;
  result.document.canvas.height = 200;
  let issues = auditDesignPages(result.document);
  assert.ok(
    !issues.some((issue) =>
      ["layout.canvas-overflow", "layout.effect-canvas-overflow"].includes(issue.code),
    ),
  );
  assert.ok(issues.some((issue) => issue.code === "layout.parent-overflow" && issue.blocking));
  result.document.nodes[0].clipContent = false;
  issues = auditDesignPages(result.document);
  assert.ok(
    issues.some((issue) => issue.code === "layout.canvas-overflow" && issue.nodeId === "figma-1-2"),
  );
  result.document.nodes[1].x = 100;
  result.document.nodes[1].width = 80;
  issues = auditDesignPages(result.document);
  assert.ok(
    issues.some(
      (issue) => issue.code === "layout.effect-canvas-overflow" && issue.nodeId === "figma-1-2",
    ),
  );
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

test("Figma transfer reports detached containers and notes while supported Grid stays editable", () => {
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
    ["container-as-frame", "notes-plugin-data"],
  );
  assert.equal(transfer.pages[0].children[0].notes, "Review with designer");
});

const pluginCode = await readFile(
  new URL("../../../apps/design-studio/app/figma-plugin/code.js", import.meta.url),
  "utf8",
);

function pluginHarness({
  missingFont = false,
  failFallback = false,
  failNode = false,
  nativeAutoLayout = false,
  nativeGrid = false,
} = {}) {
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
        if (nativeGrid && this.layoutMode === "GRID") {
          let cell = 0;
          while (
            this.children.some(
              (other) =>
                other !== child &&
                other.visible !== false &&
                other.gridRowAnchorIndex === Math.floor(cell / this.gridColumnCount) &&
                other.gridColumnAnchorIndex === cell % this.gridColumnCount,
            )
          )
            cell++;
          const requiredRows = Math.floor(cell / this.gridColumnCount) + 1;
          if (requiredRows > this.gridRowCount) this.gridRowCount = requiredRows;
          child.setGridChildPosition(
            Math.floor(cell / this.gridColumnCount),
            cell % this.gridColumnCount,
          );
        }
      },
      resize(width, height) {
        this.width = width;
        this.height = height;
      },
      resizeWithoutConstraints(width, height) {
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
    if (nativeGrid) {
      // Actual a4e5dd91 TEXT getters expose both legacy STRETCH and modern
      // cross-axis FILL. This capability mock must reflect that alias; it does
      // not implement text measurement or establish native glyph geometry.
      let gridChildAlignment = "INHERIT";
      Object.defineProperty(value, "layoutAlign", {
        get: () => gridChildAlignment,
        set: next => {
          gridChildAlignment = next;
          if (next === "STRETCH" && ["HORIZONTAL", "VERTICAL"].includes(value.parent?.layoutMode))
            value[value.parent.layoutMode === "VERTICAL" ? "layoutSizingHorizontal" : "layoutSizingVertical"] = "FILL";
        },
      });
      let gridMode = "NONE";
      Object.defineProperty(value, "layoutMode", {
        get: () => gridMode,
        set: (next) => {
          gridMode = next;
          if (next === "GRID") {
            assert.equal(
              value.children.length,
              0,
              "GRID must be configured empty to avoid occupied-cell span conflicts",
            );
            value.width = 100;
            value.height = 100;
          }
        },
      });
      let row = 0,
        column = 0;
      Object.defineProperties(value, {
        gridRowAnchorIndex: {
          get: () => (value.visible === false && value.parent?.layoutMode === "GRID" ? -1 : row),
        },
        gridColumnAnchorIndex: {
          get: () => (value.visible === false && value.parent?.layoutMode === "GRID" ? -1 : column),
        },
      });
      value.setGridChildPosition = (nextRow, nextColumn) => {
        assert.equal(value.parent.layoutMode, "GRID");
        assert.equal(
          value.parent.gridItemsPositioning,
          "MANUAL",
          "position setter throws in ROW_AUTO_FLOW",
        );
        assert(nextRow >= 0 && nextRow < value.parent.gridRowCount);
        assert(nextColumn >= 0 && nextColumn < value.parent.gridColumnCount);
        row = nextRow;
        column = nextColumn;
        calls.push(["grid-position", value.id, row, column]);
      };
      for (const [key, anchor, count] of [
        ["gridRowSpan", "gridRowAnchorIndex", "gridRowCount"],
        ["gridColumnSpan", "gridColumnAnchorIndex", "gridColumnCount"],
      ]) {
        let span = 1;
        Object.defineProperty(value, key, {
          get: () => span,
          set: (next) => {
            assert(value[anchor] + next <= value.parent[count], "span must fit authored tracks");
            const rows = key === "gridRowSpan" ? next : value.gridRowSpan;
            const columns = key === "gridColumnSpan" ? next : value.gridColumnSpan;
            for (const other of value.parent.children.filter(
              (child) =>
                child !== value &&
                child.visible !== false &&
                child.layoutPositioning !== "ABSOLUTE",
            )) {
              const overlaps =
                row < other.gridRowAnchorIndex + other.gridRowSpan &&
                row + rows > other.gridRowAnchorIndex &&
                column < other.gridColumnAnchorIndex + other.gridColumnSpan &&
                column + columns > other.gridColumnAnchorIndex;
              assert(!overlaps, "span setter rejects occupied cells");
            }
            span = next;
          },
        });
      }
      if (type === "FRAME") {
        // Current native Grid Frames expose the same active-only inclusion
        // setter and side weights as H/V Frames. This tests setter order, not
        // native text measurement or stroke-dependent row geometry.
        let included = true;
        Object.defineProperty(value, "strokesIncludedInLayout", {
          get: () => included,
          set: (next) => {
            assert.notEqual(value.layoutMode, "NONE");
            included = next;
          },
        });
        for (const side of ["Top", "Right", "Bottom", "Left"])
          value[`stroke${side}Weight`] = 0;
        value.gridAutoTracks = "NONE";
        value.gridItemsPositioning = "MANUAL";
        for (const axis of ["Row", "Column"]) {
          let count = 1,
            tracks = [];
          const track = () => {
            let kind = "FLEX",
              size = 1;
            return Object.defineProperties(
              {},
              {
                type: {
                  enumerable: true,
                  get: () => kind,
                  set: (next) => {
                    const sizing = axis === "Column" ? "Horizontal" : "Vertical";
                    assert(!(next === "FLEX" && value[`layoutSizing${sizing}`] === "HUG"));
                    kind = next;
                  },
                },
                value: {
                  enumerable: true,
                  get: () => size,
                  set: (next) => {
                    size = next;
                  },
                },
              },
            );
          };
          tracks.push(track());
          Object.defineProperty(value, `grid${axis}Count`, {
            get: () => count,
            set: (next) => {
              assert(
                !(axis === "Row" && value.gridAutoTracks === "ROWS"),
                "automatic row counts are readonly",
              );
              if (axis === "Row")
                for (const child of value.children.filter(
                  (child) => child.visible !== false && child.layoutPositioning !== "ABSOLUTE",
                ))
                  assert(
                    child.gridRowAnchorIndex + child.gridRowSpan <= next,
                    "occupied rows cannot be removed",
                  );
              count = next;
              tracks = Array.from({ length: count }, (_, i) => tracks[i] ?? track());
            },
          });
          Object.defineProperty(value, `grid${axis}Sizes`, {
            get: () => tracks,
            set: () =>
              assert.fail(
                "GridTrackSize values use live setters; array replacement is not supported",
              ),
          });
        }
      }
    }
    Object.defineProperty(value, "fontName", {
      get: () => fontName,
      set: (font) => {
        assert.ok(loaded.has(JSON.stringify(font)), "font must be loaded before assignment");
        fontName = font;
      },
    });
    if (nativeAutoLayout) {
      let mode = "NONE";
      Object.defineProperty(value, "layoutMode", {
        get: () => mode,
        set: (next) => {
          const activates = mode === "NONE" && ["HORIZONTAL", "VERTICAL"].includes(next);
          mode = next;
          if (!activates) return;
          // Native Figma enables primary-axis AUTO immediately, before the
          // plugin can assign FIXED, spacing or padding. This mutates geometry.
          value.primaryAxisSizingMode = "AUTO";
          const size = next === "HORIZONTAL" ? "width" : "height";
          const before = value[size];
          value[size] = value.children.reduce((total, child) => total + child[size], 0);
          calls.push(["native-auto-size", value.id, before, value[size]]);
        },
      });
      let alignment = "INHERIT";
      Object.defineProperty(value, "layoutAlign", {
        get: () => alignment,
        set: (next) => {
          alignment = next;
          if (next !== "STRETCH") return;
          const parent = value.parent;
          const horizontal = parent.layoutMode === "HORIZONTAL";
          const dimension = horizontal ? "height" : "width";
          const padding = horizontal ? ["Top", "Bottom"] : ["Left", "Right"];
          value[dimension] =
            parent[dimension] -
            padding.reduce((total, side) => total + (parent[`padding${side}`] ?? 0), 0);
        },
      });
    }
    for (const axis of ["Horizontal", "Vertical"]) {
      let sizing = "FIXED";
      Object.defineProperty(value, `layoutSizing${axis}`, {
        get: () => sizing,
        set: (next) => {
          if (next === "FILL") {
            assert.notEqual(value.parent?.layoutMode, "NONE", "FILL requires auto layout");
            assert.notEqual(value.layoutPositioning, "ABSOLUTE", "absolute child cannot FILL");
          }
          if (nativeAutoLayout && next === "FILL") {
            const parent = value.parent;
            const dimension = axis === "Horizontal" ? "width" : "height";
            const main = (parent.layoutMode === "HORIZONTAL") === (axis === "Horizontal");
            const padding = axis === "Horizontal" ? ["Left", "Right"] : ["Top", "Bottom"];
            const inner =
              parent[dimension] -
              padding.reduce((total, side) => total + (parent[`padding${side}`] ?? 0), 0);
            const siblings = parent.children.filter((child) => child !== value);
            value[dimension] = main
              ? inner -
                siblings.reduce((total, child) => total + child[dimension], 0) -
                (parent.itemSpacing ?? 0) * siblings.length
              : inner;
          } else if (nativeAutoLayout && next === "HUG" && value.children.length) {
            if (value.parent?.layoutMode === (axis === "Horizontal" ? "VERTICAL" : "HORIZONTAL"))
              value.layoutAlign = "INHERIT";
            const dimension = axis === "Horizontal" ? "width" : "height";
            const main = (value.layoutMode === "HORIZONTAL") === (axis === "Horizontal");
            const padding = axis === "Horizontal" ? ["Left", "Right"] : ["Top", "Bottom"];
            value[dimension] =
              padding.reduce((total, side) => total + (value[`padding${side}`] ?? 0), 0) +
              (main
                ? value.children.reduce((total, child) => total + child[dimension], 0) +
                  (value.itemSpacing ?? 0) * (value.children.length - 1)
                : Math.max(...value.children.map((child) => child[dimension])));
          }
          if (
            nativeGrid &&
            next === "FILL" &&
            value.visible !== false &&
            value.parent?.layoutMode === "GRID"
          ) {
            const parent = value.parent;
            const horizontal = axis === "Horizontal";
            const dimension = horizontal ? "width" : "height";
            const tracks = parent[horizontal ? "gridColumnSizes" : "gridRowSizes"];
            const gap = parent[horizontal ? "gridColumnGap" : "gridRowGap"];
            const padding = horizontal ? ["Left", "Right"] : ["Top", "Bottom"];
            const available =
              parent[dimension] -
              padding.reduce((sum, side) => sum + (parent[`padding${side}`] ?? 0), 0) -
              gap * (tracks.length - 1);
            const fixed = tracks
              .filter((track) => track.type === "FIXED")
              .reduce((sum, track) => sum + track.value, 0);
            const weight = tracks
              .filter((track) => track.type === "FLEX")
              .reduce((sum, track) => sum + track.value, 0);
            const sizes = tracks.map((track, index) =>
              track.type === "FIXED"
                ? track.value
                : track.type === "FLEX"
                  ? ((available - fixed) * track.value) / Math.max(1, weight)
                  : Math.max(
                      0,
                      ...parent.children
                        .filter(
                          (child) =>
                            child[horizontal ? "gridColumnAnchorIndex" : "gridRowAnchorIndex"] ===
                            index,
                        )
                        .map((child) => child[dimension]),
                    ),
            );
            const anchor = value[horizontal ? "gridColumnAnchorIndex" : "gridRowAnchorIndex"];
            const span = value[horizontal ? "gridColumnSpan" : "gridRowSpan"];
            value[dimension] =
              sizes.slice(anchor, anchor + span).reduce((a, b) => a + b, 0) + gap * (span - 1);
          }
          if (nativeGrid && next === "HUG" && value.layoutMode === "GRID") {
            const horizontal = axis === "Horizontal";
            const tracks = value[horizontal ? "gridColumnSizes" : "gridRowSizes"];
            assert(
              tracks.every((track) => track.type !== "FLEX"),
              "FLEX tracks cannot be HUG",
            );
            const dimension = horizontal ? "width" : "height";
            const gap = value[horizontal ? "gridColumnGap" : "gridRowGap"];
            value[dimension] =
              tracks.reduce(
                (sum, track, index) =>
                  sum +
                  (track.type === "FIXED"
                    ? track.value
                    : Math.max(
                        0,
                        ...value.children
                          .filter(
                            (child) =>
                              child[horizontal ? "gridColumnAnchorIndex" : "gridRowAnchorIndex"] ===
                              index,
                          )
                          .map((child) => child[dimension]),
                      )),
                0,
              ) +
              gap * (tracks.length - 1) +
              (value[horizontal ? "paddingLeft" : "paddingTop"] ?? 0) +
              (value[horizontal ? "paddingRight" : "paddingBottom"] ?? 0);
          }
          sizing = next;
        },
      });
    }
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

test("plugin keeps absolute overlays fixed while preserving flow fill and root hug sizing", async () => {
  const document = importFigmaJson(
    file([
      {
        ...rect("1:1"),
        type: "FRAME",
        layoutMode: "HORIZONTAL",
        layoutSizingHorizontal: "FIXED",
        layoutSizingVertical: "HUG",
        children: [
          rect("1:2", { layoutSizingHorizontal: "FILL" }),
          rect("1:3", {
            layoutPositioning: "ABSOLUTE",
            layoutSizingHorizontal: "FILL",
            layoutSizingVertical: "FILL",
          }),
        ],
      },
    ]),
  ).document;
  const runtime = pluginHarness();
  await runtime.send({
    type: "import-transfer",
    content: JSON.stringify(createFigmaTransfer(document)),
  });
  assert.equal(runtime.messages[0].type, "imported");
  const frame = runtime.pages[1].children[0];
  assert.equal(frame.layoutSizingVertical, "HUG");
  assert.equal(frame.children[0].layoutSizingHorizontal, "FILL");
  const overlay = frame.children[1];
  assert.equal(overlay.layoutPositioning, "ABSOLUTE");
  assert.equal(overlay.layoutSizingHorizontal, "FIXED");
  assert.equal(overlay.layoutSizingVertical, "FIXED");
  assert.equal(runtime.messages[0].warnings.length, 2);
  assert(runtime.messages[0].warnings.every((warning) => warning.includes("fill")));
});

test("native auto layout activation preserves the source size before resolving fill and hug", async () => {
  for (const layoutMode of ["HORIZONTAL", "VERTICAL"]) {
    for (const crossSizing of ["FIXED", "HUG"]) {
      const horizontal = layoutMode === "HORIZONTAL";
      const mainSize = horizontal ? "width" : "height";
      const crossSize = horizontal ? "height" : "width";
      const mainAxis = horizontal ? "Horizontal" : "Vertical";
      const crossAxis = horizontal ? "Vertical" : "Horizontal";
      const bounds = (main, cross) => ({ x: 0, y: 0, [mainSize]: main, [crossSize]: cross });
      const source = file([
        {
          ...rect("1:1"),
          type: "FRAME",
          layoutMode,
          absoluteBoundingBox: bounds(640, 240),
          [`layoutSizing${mainAxis}`]: "FIXED",
          [`layoutSizing${crossAxis}`]: crossSizing,
          itemSpacing: 16,
          paddingLeft: 20,
          paddingRight: 20,
          paddingTop: 20,
          paddingBottom: 20,
          children: [
            rect("1:2", { absoluteBoundingBox: bounds(100, 120) }),
            rect("1:3", {
              absoluteBoundingBox: bounds(484, 120),
              [`layoutSizing${mainAxis}`]: "FILL",
            }),
          ],
        },
      ]);
      const runtime = pluginHarness({ nativeAutoLayout: true });
      await runtime.send({
        type: "import-transfer",
        content: JSON.stringify(createFigmaTransfer(importFigmaJson(source).document)),
      });
      assert.equal(runtime.messages[0].type, "imported");
      const frame = runtime.pages[1].children[0];
      assert(
        runtime.calls.some(
          (call) => call[0] === "native-auto-size" && call[2] === 640 && call[3] === 584,
        ),
      );
      assert.equal(frame[mainSize], 640);
      assert.equal(frame[crossSize], crossSizing === "HUG" ? 160 : 240);
      assert.equal(frame.children[0][mainSize], 100);
      assert.equal(frame.children[1][mainSize], 484);
      assert.equal(frame.children[1][`layoutSizing${mainAxis}`], "FILL");
      assert.equal(frame[`layoutSizing${crossAxis}`], crossSizing);
      assert.equal(frame.children[1].layoutPositioning, "AUTO");
    }
  }
});

test("plugin stretch follows canonical layout sizing and keeps explicit CSS opt-outs", async () => {
  for (const layout of ["horizontal", "vertical"]) {
    for (const [sizing, self, positioning] of [
      ["fixed", "auto", "auto"],
      ["hug", "auto", "auto"],
      ["fixed", "start", "auto"],
      ["hug", "start", "auto"],
      ["fixed", "stretch", "auto"],
      ["hug", "stretch", "auto"],
      ["fixed", "auto", "absolute"],
      ["hug", "auto", "absolute"],
    ]) {
      const horizontal = layout === "horizontal";
      const mainSize = horizontal ? "width" : "height";
      const crossSize = horizontal ? "height" : "width";
      const crossAxis = horizontal ? "Vertical" : "Horizontal";
      const common = {
        x: 20,
        y: 20,
        fill: "#2563eb",
        stroke: "transparent",
        strokeWidth: 0,
        opacity: 1,
        rotation: 0,
        cornerRadius: 0,
        visible: true,
        locked: false,
      };
      const document = importFigmaJson(
        file([
          {
            ...rect("1:1"),
            type: "FRAME",
            layoutMode: horizontal ? "HORIZONTAL" : "VERTICAL",
            absoluteBoundingBox: { x: 0, y: 0, [mainSize]: 600, [crossSize]: 200 },
            paddingTop: 20,
            paddingRight: 20,
            paddingBottom: 20,
            paddingLeft: 20,
            children: [],
          },
        ]),
      ).document;
      document.nodes[0].alignItems = "stretch";
      document.nodes.push(
        {
          ...common,
          id: "child",
          type: "frame",
          name: "Child",
          parentId: document.nodes[0].id,
          [mainSize]: 100,
          [crossSize]: 40,
          layout: horizontal ? "horizontal" : "vertical",
          gap: 0,
          padding: 0,
          alignItems: "start",
          justifyContent: "start",
          [`layoutSizing${crossAxis}`]: sizing,
          layoutAlignSelf: self,
          layoutPositioning: positioning,
        },
        {
          ...common,
          id: "content",
          type: "rectangle",
          name: "Content",
          parentId: "child",
          [mainSize]: 10,
          [crossSize]: 20,
        },
      );
      const transfer = createFigmaTransfer(document);
      applyAllAutoLayouts(document.nodes);
      const expected = document.nodes.find((node) => node.id === "child");
      const runtime = pluginHarness({ nativeAutoLayout: true });
      await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
      assert.equal(runtime.messages[0].type, "imported");
      const child = runtime.pages[1].children[0].children[0];
      assert.equal(
        child[crossSize],
        expected[crossSize],
        `${layout} ${sizing} self:${self} positioning:${positioning}`,
      );
      assert.equal(child.layoutPositioning, positioning === "absolute" ? "ABSOLUTE" : "AUTO");
    }
  }
});

test("plugin inherited stretch respects explicit child alignment", async () => {
  for (const layoutMode of ["HORIZONTAL", "VERTICAL"]) {
    const document = importFigmaJson(
      file([
        {
          ...rect("1:1"),
          type: "FRAME",
          layoutMode,
          children: Array.from({ length: 6 }, (_, index) => rect(`1:${index + 2}`)),
        },
      ]),
    ).document;
    const [frame, inherited, fixed, start, center, stretch, absolute] = document.nodes;
    const crossAxis = layoutMode === "HORIZONTAL" ? "Vertical" : "Horizontal";
    frame.alignItems = "stretch";
    fixed[`layoutSizing${crossAxis}`] = "fixed";
    start.layoutAlignSelf = "start";
    center.layoutAlignSelf = "center";
    stretch.layoutAlignSelf = "stretch";
    absolute.layoutPositioning = "absolute";
    const runtime = pluginHarness();
    const transfer = createFigmaTransfer(document);
    await runtime.send({
      type: "import-transfer",
      content: JSON.stringify(transfer),
    });
    assert.equal(runtime.messages[0].type, "imported");
    const created = runtime.pages[1].children[0];
    assert.equal(created.counterAxisAlignItems, "MIN");
    for (const [source, alignment] of [
      [inherited, "STRETCH"],
      [fixed, "STRETCH"],
      [start, "INHERIT"],
      [center, "INHERIT"],
      [stretch, "STRETCH"],
      [absolute, "INHERIT"],
    ]) {
      const child = created.children.find((node) => node.pluginData.codeshellNodeId === source.id);
      assert.equal(child.layoutAlign, alignment);
    }
    assert.equal(created.children[1][`layoutSizing${crossAxis}`], "FIXED");
    assert(transfer.warnings.some((warning) => warning.code === "child-layout-export"));
  }
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

test("native Grid tracks, manual anchors, independent alignment and spans survive canonical save and editable Figma creation", async () => {
  const imported = importFigmaJson(nativeGridSource());
  assert(
    !imported.warnings.some((warning) =>
      ["grid-layout", "unsupported-grid"].includes(warning.code),
    ),
  );
  const saved = JSON.parse(serializeDesignDocument(imported.document));
  const frame = saved.pages[0].children[0];
  assert.equal(frame.layout, "grid");
  assert.equal(frame.gridColumns, 3);
  assert.equal(frame.gridRows, 2);
  assert.deepEqual(frame.gridColumnSizes, [
    { type: "fixed", value: 100 },
    { type: "flex", value: 1 },
    { type: "flex", value: 2 },
  ]);
  assert.deepEqual(frame.gridRowSizes, [{ type: "fixed", value: 40 }, { type: "hug" }]);
  assert.equal(frame.children[1].gridChildHorizontalAlign, "end");
  assert.equal(frame.children[1].gridChildVerticalAlign, "center");
  applyAllAutoLayouts(imported.document.nodes);
  assert.deepEqual(
    imported.document.nodes.slice(0, 4).map((node) => [node.x, node.y, node.width, node.height]),
    [
      [20, 30, 440, 128],
      [140, 40, 310, 40],
      [100, 50, 30, 20],
      [30, 88, 40, 60],
    ],
  );
  const html = exportDesignFrontend(saved);
  assert.match(html, /100px minmax\(0, 1fr\) minmax\(0, 2fr\)/u);
  assert.match(html, /40px fit-content\(100%\)/u);
  assert.match(html, /grid-column:\s*2 \/ span 2/u);
  const transfer = createFigmaTransfer(saved);
  assert(!transfer.warnings.some((warning) => warning.code === "grid-export"));
  const harness = pluginHarness({ nativeGrid: true });
  await harness.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(harness.messages.at(-1).type, "imported", JSON.stringify(harness.messages.at(-1)));
  const created = harness.pages[1].children[0];
  assert.equal(created.layoutMode, "GRID");
  assert.deepEqual(
    created.gridColumnSizes.map((track) => [track.type, track.value]),
    [
      ["FIXED", 100],
      ["FLEX", 1],
      ["FLEX", 2],
    ],
  );
  assert.equal(created.gridRowSizes[1].type, "HUG");
  assert.equal(created.gridItemsPositioning, "MANUAL");
  assert.equal(created.layoutSizingVertical, "HUG");
  assert.deepEqual([created.width, created.height], [440, 128]);
  const span = created.children[0];
  assert.deepEqual(
    [
      span.gridRowAnchorIndex,
      span.gridColumnAnchorIndex,
      span.gridColumnSpan,
      span.width,
      span.height,
    ],
    [0, 1, 2, 310, 40],
  );
  assert.equal(span.layoutPositioning, "AUTO");
  assert.equal(created.children[1].gridChildHorizontalAlign, "MAX");
  assert.equal(created.children[1].gridChildVerticalAlign, "CENTER");
  assert.equal(created.children[3].layoutSizingHorizontal, "HUG");
  assert.equal(created.children[3].characters, "Editable");
  assert.equal(created.children[3].type, "TEXT");
});

test("native row auto-flow configures spans in manual mode before restoring flow and automatic rows", async () => {
  const raw = nativeGridSource({ gridItemsPositioning: "ROW_AUTO_FLOW", gridAutoTracks: "ROWS" });
  const source = raw.document.children[0].children[0];
  source.children = source.children.slice(0, 3);
  const imported = importFigmaJson(raw);
  const harness = pluginHarness({ nativeGrid: true });
  await harness.send({
    type: "import-transfer",
    content: JSON.stringify(createFigmaTransfer(imported.document)),
  });
  assert.equal(harness.messages.at(-1).type, "imported", JSON.stringify(harness.messages.at(-1)));
  const created = harness.pages[1].children[0];
  assert.equal(created.gridItemsPositioning, "ROW_AUTO_FLOW");
  assert.equal(created.gridAutoTracks, "ROWS");
  assert.deepEqual(
    created.children.map((child) => [
      child.gridRowAnchorIndex,
      child.gridColumnAnchorIndex,
      child.gridColumnSpan,
    ]),
    [
      [0, 0, 2],
      [0, 2, 1],
      [1, 0, 1],
    ],
  );
});

test("native Grid export reads live track and child semantics even when JSON_REST_V1 omits them", async () => {
  const imported = importFigmaJson(nativeGridSource());
  const harness = pluginHarness({ nativeGrid: true });
  await harness.send({
    type: "import-transfer",
    content: JSON.stringify(createFigmaTransfer(imported.document)),
  });
  assert.equal(harness.messages.at(-1).type, "imported");
  const created = harness.pages[1].children[0];
  const rawNode = (node) => ({
    ...rect(node.id),
    type: node.type,
    name: node.name,
    absoluteBoundingBox: { x: 20, y: 30, width: node.width, height: node.height },
    ...(node.type === "TEXT"
      ? { characters: node.characters, style: { fontFamily: "Inter", fontSize: 16 } }
      : {}),
    ...(node.type === "FRAME" ? { children: node.children.map(rawNode) } : {}),
  });
  created.exportAsync = async () => ({ document: rawNode(created) });
  harness.figma.currentPage.selection = [created];
  await harness.send({ type: "export-json", scope: "selection" });
  assert.equal(harness.messages.at(-1).type, "exported", JSON.stringify(harness.messages.at(-1)));
  const exported = JSON.parse(harness.messages.at(-1).content);
  const native = exported.nodes[created.id].document;
  assert.equal(native.layoutMode, "GRID");
  assert.deepEqual(native.gridColumnSizes, [
    { type: "FIXED", value: 100 },
    { type: "FLEX", value: 1 },
    { type: "FLEX", value: 2 },
  ]);
  assert.deepEqual(native.gridRowSizes, [{ type: "FIXED", value: 40 }, { type: "HUG" }]);
  assert.equal(native.children[0].gridColumnAnchorIndex, 1);
  assert.equal(native.children[0].gridColumnSpan, 2);
  assert.equal(native.children[0].layoutSizingHorizontal, "FILL");
  assert.equal(importFigmaJson(exported).document.nodes[0].layout, "grid");
});

test("unsupported or malformed native Grid produces actionable diagnostics and preserves existing Figma pages", async () => {
  const imported = importFigmaJson(nativeGridSource());
  const transfer = createFigmaTransfer(imported.document);
  const oldFigma = pluginHarness();
  await oldFigma.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(oldFigma.messages.at(-1).type, "error");
  assert.match(oldFigma.messages.at(-1).message, /不支持原生 GRID API/u);
  assert.equal(oldFigma.pages.length, 1);
  const invalid = clone(transfer);
  invalid.pages[0].children[0].layoutSizingHorizontal = "hug";
  const native = pluginHarness({ nativeGrid: true });
  await native.send({ type: "import-transfer", content: JSON.stringify(invalid) });
  assert.equal(native.messages.at(-1).type, "error");
  assert.match(native.messages.at(-1).message, /HUG 容器不能包含 FLEX/u);
  assert.equal(native.pages.length, 1);
  const incomplete = nativeGridSource({ gridColumnSizes: undefined });
  const fallback = importFigmaJson(incomplete);
  assert.equal(fallback.document.nodes[0].layout, "none");
  assert(
    fallback.warnings.some(
      (warning) => warning.code === "unsupported-grid" && warning.message.includes("重新导出"),
    ),
  );
  const malformed = clone(transfer);
  malformed.pages[0].children[0].gridRowSizes[0].value = -1;
  await native.send({ type: "import-transfer", content: JSON.stringify(malformed) });
  assert.equal(native.messages.at(-1).type, "error");
  assert.equal(native.pages.length, 1);
});

test("an absolute Grid overlay cannot leave an extra row after temporary native auto placement", async () => {
  const raw = nativeGridSource({
    gridColumnCount: 1,
    gridRowCount: 1,
    gridColumnSizes: [{ type: "FIXED", value: 100 }],
    gridRowSizes: [{ type: "FIXED", value: 40 }],
    layoutSizingVertical: "FIXED",
  });
  const grid = raw.document.children[0].children[0];
  grid.children = [
    rect("33:1", { gridRowAnchorIndex: 0, gridColumnAnchorIndex: 0 }),
    rect("33:2", { layoutPositioning: "ABSOLUTE" }),
  ];
  const harness = pluginHarness({ nativeGrid: true });
  await harness.send({
    type: "import-transfer",
    content: JSON.stringify(createFigmaTransfer(importFigmaJson(raw).document)),
  });
  assert.equal(harness.messages.at(-1).type, "imported", JSON.stringify(harness.messages.at(-1)));
  const created = harness.pages[1].children[0];
  assert.equal(created.gridRowCount, 1);
  assert.equal(created.children[1].layoutPositioning, "ABSOLUTE");
});

test("published v3 and Host patch schemas accept bounded native Grid fields and reject malformed tracks", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const schema = JSON.parse(
    await readFile(
      new URL(
        "../../../apps/design-studio/app/formats/codeshell-design-v3.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const source = JSON.parse(serializeDesignDocument(importFigmaJson(nativeGridSource()).document));
  assert(validate(source), JSON.stringify(validate.errors));
  const invalid = clone(source);
  invalid.pages[0].children[0].gridColumnSizes[0].value = -1;
  assert.equal(validate(invalid), false);
  invalid.pages[0].children[0].gridColumnSizes[0] = { type: "hug", value: 1 };
  assert.equal(validate(invalid), false);
  const manifest = JSON.parse(
    await readFile(
      new URL("../../../apps/design-studio/.codeshell-panel/panel.json", import.meta.url),
      "utf8",
    ),
  );
  const tool = manifest.agent.tools.find((entry) => entry.name === "use_design");
  const { validateToolArgsStrict } = await import("@cjhyy/code-shell-core");
  const request = {
    expected_state_revision: "native-grid-test",
    operations: [
      {
        op: "update_node",
        node_id: "grid",
        changes: {
          gridColumns: 3,
          gridRows: 2,
          gridColumnSizes: source.pages[0].children[0].gridColumnSizes,
          gridItemsPositioning: "manual",
        },
      },
    ],
  };
  assert.equal(validateToolArgsStrict("use_design", request, tool.inputSchema), null);
  request.operations[0].changes.gridColumnSizes = null;
  assert.equal(validateToolArgsStrict("use_design", request, tool.inputSchema), null);
  request.operations[0].changes.gridColumnSizes = [{ type: "fixed", value: -1 }];
  assert.notEqual(validateToolArgsStrict("use_design", request, tool.inputSchema), null);
});

test("malformed manual Grid child spans fail before untrusted placement loops execute", () => {
  const baseline = JSON.parse(
    serializeDesignDocument(importFigmaJson(nativeGridSource()).document),
  );
  for (const value of [1e9, Infinity, -1, 1.5]) {
    const invalid = clone(baseline);
    invalid.pages[0].children[0].children[0].gridRowSpan = value;
    assert.throws(() => normalizeDesignDocument(invalid), /gridRowSpan/u);
  }
});

test("a spanning item crossing FLEX cannot inflate adjacent HUG tracks during reflow", () => {
  const raw = nativeGridSource({
    gridColumnCount: 2,
    gridRowCount: 2,
    absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 80 },
    layoutSizingVertical: "FIXED",
    gridColumnSizes: [{ type: "HUG" }, { type: "FLEX", value: 1 }],
    gridRowSizes: [
      { type: "FIXED", value: 40 },
      { type: "FIXED", value: 40 },
    ],
    gridColumnGap: 0,
    gridRowGap: 0,
    paddingLeft: 0,
    paddingRight: 0,
    paddingTop: 0,
    paddingBottom: 0,
  });
  const source = raw.document.children[0].children[0];
  source.children = [
    rect("44:1", {
      gridRowAnchorIndex: 0,
      gridColumnAnchorIndex: 0,
      gridColumnSpan: 2,
      absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 40 },
    }),
    rect("44:2", {
      gridRowAnchorIndex: 1,
      gridColumnAnchorIndex: 0,
      absoluteBoundingBox: { x: 0, y: 40, width: 60, height: 40 },
    }),
    rect("44:3", {
      gridRowAnchorIndex: 1,
      gridColumnAnchorIndex: 1,
      absoluteBoundingBox: { x: 60, y: 40, width: 20, height: 40 },
    }),
  ];
  const result = importFigmaJson(raw);
  assert.equal(result.document.nodes[0].layout, "grid");
  applyAllAutoLayouts(result.document.nodes);
  assert.equal(result.document.nodes[3].x, 60);
  source.children[0].layoutSizingHorizontal = "FILL";
  const cyclic = importFigmaJson(raw);
  assert.equal(cyclic.document.nodes[0].layout, "none");
  assert(
    cyclic.warnings.some(
      (warning) => warning.code === "unsupported-grid" && warning.message.includes("内在尺寸循环"),
    ),
  );
});

test("automatic rows grow after a canonical child edit and trim after deletion without changing track semantics", async () => {
  const document = JSON.parse(
    serializeDesignDocument(
      importFigmaJson(
        nativeGridSource({ gridItemsPositioning: "ROW_AUTO_FLOW", gridAutoTracks: "ROWS" }),
      ).document,
    ),
  );
  const grid = document.pages[0].children[0];
  const extra = {
    ...grid.children[2],
    id: "automatic-extra",
    name: "New row",
    height: 50,
    gridColumnSpan: 3,
  };
  delete extra.gridRowAnchorIndex;
  delete extra.gridColumnAnchorIndex;
  grid.children.push(extra);
  const transfer = createFigmaTransfer(document);
  assert(!transfer.warnings.some((warning) => warning.code === "grid-export"));
  const native = pluginHarness({ nativeGrid: true });
  await native.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(native.messages.at(-1).type, "imported", JSON.stringify(native.messages.at(-1)));
  const created = native.pages[1].children[0];
  assert.equal(created.gridRowCount, 3);
  assert.equal(created.gridRowSizes[2].type, "HUG");
  assert.equal(created.children.at(-1).gridRowAnchorIndex, 2);
  assert.equal(created.gridAutoTracks, "ROWS");
  assert.match(
    exportDesignFrontend(document),
    /grid-template-rows:40px fit-content\(100%\) fit-content\(100%\)/u,
  );
  grid.children.splice(2);
  const trimmed = pluginHarness({ nativeGrid: true });
  await trimmed.send({
    type: "import-transfer",
    content: JSON.stringify(createFigmaTransfer(document)),
  });
  assert.equal(trimmed.messages.at(-1).type, "imported", JSON.stringify(trimmed.messages.at(-1)));
  assert.equal(trimmed.pages[1].children[0].gridRowCount, 1);
  assert.match(exportDesignFrontend(document), /grid-template-rows:40px;/u);
});

test("overlapping HUG spans apply same-span contributions together and remain independent of layer order", () => {
  const raw = nativeGridSource({
    gridColumnCount: 3,
    gridRowCount: 3,
    absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 90 },
    layoutSizingVertical: "FIXED",
    gridColumnSizes: [{ type: "HUG" }, { type: "HUG" }, { type: "HUG" }],
    gridRowSizes: Array.from({ length: 3 }, () => ({ type: "FIXED", value: 30 })),
    gridColumnGap: 0,
    gridRowGap: 0,
    paddingLeft: 0,
    paddingRight: 0,
    paddingTop: 0,
    paddingBottom: 0,
  });
  const grid = raw.document.children[0].children[0];
  grid.children = [
    rect("55:1", {
      gridRowAnchorIndex: 0,
      gridColumnAnchorIndex: 0,
      gridColumnSpan: 2,
      absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 30 },
    }),
    rect("55:2", {
      gridRowAnchorIndex: 1,
      gridColumnAnchorIndex: 1,
      gridColumnSpan: 2,
      absoluteBoundingBox: { x: 150, y: 30, width: 200, height: 30 },
    }),
    ...[0, 1, 2].map((column) =>
      rect(`55:${column + 3}`, {
        gridRowAnchorIndex: 2,
        gridColumnAnchorIndex: column,
        absoluteBoundingBox: { x: column * 150, y: 60, width: 10, height: 30 },
      }),
    ),
  ];
  for (const reversed of [false, true]) {
    if (reversed) grid.children.reverse();
    const result = importFigmaJson(raw);
    assert.equal(result.document.nodes[0].layout, "grid");
    applyAllAutoLayouts(result.document.nodes);
    const positions = ["figma-55-3", "figma-55-4", "figma-55-5"].map(
      (id) => result.document.nodes.find((node) => node.id === id).x,
    );
    assert.deepEqual(positions, [0, 150, 300]);
  }
});

test("FLEX fractions totaling less than one preserve unused space rather than normalizing to full width", async () => {
  const raw = nativeGridSource({
    gridColumnCount: 2,
    gridRowCount: 1,
    absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 40 },
    layoutSizingVertical: "FIXED",
    gridColumnSizes: [
      { type: "FLEX", value: 0.25 },
      { type: "FLEX", value: 0.25 },
    ],
    gridRowSizes: [{ type: "FIXED", value: 40 }],
    gridColumnGap: 0,
    gridRowGap: 0,
    paddingLeft: 0,
    paddingRight: 0,
    paddingTop: 0,
    paddingBottom: 0,
  });
  raw.document.children[0].children[0].children = [0, 1].map((column) =>
    rect(`66:${column + 1}`, {
      layoutSizingHorizontal: "FILL",
      gridRowAnchorIndex: 0,
      gridColumnAnchorIndex: column,
      absoluteBoundingBox: { x: column * 100, y: 0, width: 100, height: 40 },
    }),
  );
  const result = importFigmaJson(raw);
  applyAllAutoLayouts(result.document.nodes);
  assert.deepEqual(
    result.document.nodes.slice(1).map((node) => [node.x, node.width]),
    [
      [0, 100],
      [100, 100],
    ],
  );
  const native = pluginHarness({ nativeGrid: true });
  await native.send({
    type: "import-transfer",
    content: JSON.stringify(createFigmaTransfer(result.document)),
  });
  assert.equal(native.messages.at(-1).type, "imported", JSON.stringify(native.messages.at(-1)));
  assert.deepEqual(
    native.pages[1].children[0].children.map((node) => node.width),
    [100, 100],
  );
});

test("official native hidden ROW_AUTO_FLOW JSON retains Grid and its hidden layer without sentinel anchors", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL(
        "../../fixtures/design-studio-native-grid/figma-hidden-row-flow.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const original = JSON.stringify(raw);
  const result = importFigmaJson(raw);
  assert.equal(
    JSON.stringify(raw),
    original,
    "raw source and its inactive native anchors stay untouched",
  );
  assert.equal(result.document.nodes.length, 5);
  const [grid, hidden, ...visible] = result.document.nodes;
  assert.equal(grid.layout, "grid");
  assert.equal(grid.gridRows, 1);
  assert.deepEqual(grid.gridRowSizes, [{ type: "fixed", value: 40 }]);
  assert.equal(hidden.visible, false);
  assert.equal(hidden.gridColumnSpan, 2);
  assert.equal(hidden.gridRowAnchorIndex, undefined);
  assert.equal(hidden.gridColumnAnchorIndex, undefined);
  assert(!result.warnings.some((warning) => warning.code === "unsupported-grid"));
  assert.equal(result.mapping.length, 5);
  const expected = visible.map((node) => [node.x, node.y, node.width, node.height]);
  applyAllAutoLayouts(result.document.nodes);
  assert.deepEqual(
    result.document.nodes.slice(2).map((node) => [node.x, node.y, node.width, node.height]),
    expected,
  );
  const saved = JSON.parse(serializeDesignDocument(result.document));
  assert.equal(normalizeDesignDocument(saved).nodes[0].layout, "grid");
  const prepared = await prepareFigmaImport(raw);
  assert.equal(prepared.document.nodes[0].layout, "grid");
  assert.equal(Object.values(prepared.source.nodes)[0].document.children[0].gridRowAnchorIndex, -1);
  assert.equal(prepared.document.nodes[1].gridRowAnchorIndex, undefined);
  const native = pluginHarness({ nativeGrid: true });
  await native.send({
    type: "import-transfer",
    content: JSON.stringify(createFigmaTransfer(saved)),
  });
  assert.equal(native.messages.at(-1).type, "imported", JSON.stringify(native.messages.at(-1)));
  const created = native.pages[1].children[0];
  assert.equal(created.children.length, 4);
  assert.equal(created.gridRowCount, 1);
  assert.equal(created.children[0].visible, false);
  assert.deepEqual(
    [created.children[0].gridRowAnchorIndex, created.children[0].gridColumnAnchorIndex],
    [-1, -1],
  );
  assert.equal(created.children[0].gridColumnSpan, 2);
});

test("hidden spanning Grid children preserve authored rows but do not create effective automatic rows", async () => {
  const raw = nativeGridSource({
    gridItemsPositioning: "ROW_AUTO_FLOW",
    gridAutoTracks: "ROWS",
    layoutSizingVertical: "FIXED",
    gridRowSizes: [
      { type: "FIXED", value: 40 },
      { type: "FIXED", value: 60 },
    ],
  });
  raw.document.children[0].children[0].children[0].visible = false;
  const result = importFigmaJson(raw);
  assert.equal(
    result.document.nodes[0].gridRows,
    2,
    "declared rows are retained while ROWS derives its active row count",
  );
  const transfer = createFigmaTransfer(result.document);
  assert.equal(transfer.pages[0].children[0].children.length, 4);
  const native = pluginHarness({ nativeGrid: true });
  await native.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(native.messages.at(-1).type, "imported", JSON.stringify(native.messages.at(-1)));
  const created = native.pages[1].children[0];
  assert.equal(created.gridRowCount, 1);
  assert.deepEqual(
    created.gridRowSizes.map((track) => [track.type, track.value]),
    [["FIXED", 40]],
  );
  assert.deepEqual(
    created.children
      .slice(1)
      .map((child) => [child.gridRowAnchorIndex, child.gridColumnAnchorIndex]),
    [
      [0, 0],
      [0, 1],
      [0, 2],
    ],
  );
  const sourceHidden = transfer.pages[0].children[0].children[0];
  assert.equal(created.children[0].visible, false);
  assert.equal(created.children[0].gridColumnSpan, 2);
  assert.deepEqual(clone(created.children[0].relativeTransform), [
    [1, 0, sourceHidden.x - result.document.nodes[0].x],
    [0, 1, sourceHidden.y - result.document.nodes[0].y],
  ]);
  for (const value of [1e9, Infinity, -1, 1.5]) {
    const invalid = clone(transfer);
    invalid.pages[0].children[0].children[0].gridRowSpan = value;
    const rejected = pluginHarness({ nativeGrid: true });
    await rejected.send({ type: "import-transfer", content: JSON.stringify(invalid) });
    assert.equal(rejected.messages.at(-1).type, "error");
    assert.equal(rejected.pages.length, 1, "invalid hidden fields fail before creating pages");
  }
});

test("actual nested fixed-content Grid survives production plugin preflight with its Fill modes", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL(
        "../../fixtures/design-studio-grid-intrinsic-height/native-source.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const imported = importFigmaJson(raw),
    transfer = createFigmaTransfer(imported.document);
  assert(!transfer.warnings.some((warning) => warning.code === "grid-export"));
  const runtime = pluginHarness({ nativeGrid: true });
  await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "imported", JSON.stringify(runtime.messages.at(-1)));
  const row = runtime.pages[1].children[0].children.find(
    (node) => node.name === "affine-HUG-cellFILL-container-last",
  );
  assert.equal(row.layoutMode, "GRID");
  assert.equal(row.layoutSizingVertical, "HUG");
  assert.equal(row.gridRowSizes[0].type, "HUG");
  assert.deepEqual(
    row.children.map((node) => [
      node.layoutMode,
      node.layoutSizingHorizontal,
      node.layoutSizingVertical,
    ]),
    Array(3).fill(["VERTICAL", "FILL", "FILL"]),
  );
  assert(
    row.children.every(
      (node) => node.children.length === 1 && node.children[0].layoutSizingVertical === "FIXED",
    ),
  );
  const cyclic = clone(transfer);
  cyclic.pages[0].children[0].children.find(
    (node) => node.name === "affine-HUG-cellFILL-container-last",
  ).children[0].children[0].layoutSizingVertical = "fill";
  const rejected = pluginHarness({ nativeGrid: true });
  await rejected.send({ type: "import-transfer", content: JSON.stringify(cyclic) });
  assert.equal(rejected.messages.at(-1).type, "error");
  assert.equal(
    rejected.pages.length,
    1,
    "unsupported intrinsic cycles fail before any page is created",
  );
});


test("actual plain Text Grid survives production preflight with full source and real Fill/Hug modes", async () => {
  const raw = JSON.parse(await readFile(new URL("../../fixtures/design-studio-grid-text-intrinsic-height/native-source.json", import.meta.url), "utf8"));
  const transfer = createFigmaTransfer(importFigmaJson(raw).document);
  assert(!transfer.warnings.some(warning => warning.code === "grid-export"));
  const runtime = pluginHarness({ nativeGrid: true });
  await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "imported", JSON.stringify(runtime.messages.at(-1)));
  for (const name of ["affine-HUG-cellFILL-container-first", "affine-HUG-cellFILL-container-last"]) {
    const row = runtime.pages[1].children[0].children.find(node => node.name === name);
    assert.equal(row.layoutMode, "GRID");
    assert.equal(row.layoutSizingVertical, "HUG");
    assert.equal(row.gridRowSizes[0].type, "HUG");
    assert.deepEqual(row.children.map(cell => [cell.layoutMode, cell.layoutSizingHorizontal, cell.layoutSizingVertical]), Array(3).fill(["VERTICAL", "FILL", "FILL"]));
    for (const cell of row.children) {
      assert.equal(cell.children.length, 1);
      const text = cell.children[0];
      assert.equal(text.type, "TEXT");
      assert.equal(text.layoutSizingHorizontal, "FILL");
      assert.equal(text.layoutSizingVertical, "HUG");
      assert.equal(text.textAutoResize, "HEIGHT");
      assert.equal(text.characters, cell === row.children[0] ? "Alpha\nBeta" : "Peer");
    }
  }
  for (const bad of [text => { text.layoutSizingVertical = "fill"; }, text => { delete text.textSource; }]) {
    const invalid = clone(transfer);
    bad(invalid.pages[0].children[0].children.find(node => node.name === "affine-HUG-cellFILL-container-last").children[0].children[0]);
    const rejected = pluginHarness({ nativeGrid: true });
    await rejected.send({ type: "import-transfer", content: JSON.stringify(invalid) });
    assert.equal(rejected.messages.at(-1).type, "error");
    assert.equal(rejected.pages.length, 1, "unproven Text dependency fails before creating pages");
  }
});

test("native padded intrinsic row Grid creation carries parent context and included bottom rule through preflight and finalization", async () => {
  const raw = JSON.parse(await readFile(new URL("../../fixtures/design-studio-native-padded-row-grid/native-source.json",import.meta.url)));
  const imported = importFigmaJson(raw), transfer = createFigmaTransfer(imported.document);
  assert.deepEqual(transfer.warnings, []);
  const runtime = pluginHarness({nativeGrid:true});
  await runtime.send({type:"import-transfer",content:JSON.stringify(transfer)});
  assert.equal(runtime.messages.at(-1).type,"imported",JSON.stringify(runtime.messages.at(-1)));
  const flattened = (node) => [node,...node.children.flatMap(flattened)];
  const created = flattened(runtime.pages[1]).filter((n)=>n.type!=="PAGE");
  assert.equal(created.length,67); assert.equal(created.filter((n)=>n.layoutMode==="GRID").length,9);
  for(const row of created.filter((n)=>n.layoutMode==="GRID")){
    assert.equal(row.parent.layoutMode,"VERTICAL");
    assert.deepEqual([row.layoutSizingHorizontal,row.layoutSizingVertical],["FILL","HUG"]);
    assert.equal(row.gridRowSizes[0].type,"HUG");
    assert.equal(row.children.length,3); assert.equal(row.strokesIncludedInLayout,row.name.includes("rowbottom1"));
    if(row.name.includes("rowbottom1")){
      assert.deepEqual([row.strokeTopWeight,row.strokeRightWeight,row.strokeBottomWeight,row.strokeLeftWeight],[0,0,1,0]);
      assert.equal(row.strokeAlign,"INSIDE"); assert.equal(row.paddingBottom,0,"physical bottom inset is included once, not duplicated in raw padding");
    }
    for(const cell of row.children){
      assert.deepEqual([cell.layoutSizingHorizontal,cell.layoutSizingVertical],["FILL","FILL"]);
      assert.equal(cell.children.length,1);
      const text=cell.children[0];
      assert.deepEqual([text.layoutSizingHorizontal,text.layoutSizingVertical,text.textAutoResize],["FILL","HUG","HEIGHT"]);
      assert.equal(text.lineHeight.unit,"PIXELS"); assert.equal(text.lineHeight.value,20);
    }
  }
  const invalid=structuredClone(transfer);invalid.pages[0].children[0].children[0].layoutSizingHorizontal="hug";
  const blocked=pluginHarness({nativeGrid:true});await blocked.send({type:"import-transfer",content:JSON.stringify(invalid)});
  assert.equal(blocked.messages.at(-1).type,"error");assert.equal(blocked.pages.length,1,"context cycle rejected before new native pages");
});

test("actual centered excluded row Grid configures explicit exclusion after activation with fractional real-cell insets", async () => {
  const raw=JSON.parse(await readFile(new URL("../../fixtures/design-studio-native-centered-row-grid/native-source.json",import.meta.url)));
  const imported=importFigmaJson(raw),transfer=createFigmaTransfer(imported.document);
  assert.deepEqual(imported.warnings,[]);assert.deepEqual(transfer.warnings,[]);
  const runtime=pluginHarness({nativeGrid:true});
  await runtime.send({type:"import-transfer",content:JSON.stringify(transfer)});
  assert.equal(runtime.messages.at(-1).type,"imported",JSON.stringify(runtime.messages.at(-1)));
  const flattened=n=>[n,...n.children.flatMap(flattened)],all=flattened(runtime.pages[1]);
  assert.equal(all.length,68);const rows=all.filter(n=>n.layoutMode==="GRID");assert.equal(rows.length,9);
  for(const row of rows){
    assert.equal(row.strokesIncludedInLayout,false,"fresh active Grid default true must be explicitly excluded");
    assert.equal(row.strokeAlign,"CENTER");assert.equal(row.paddingTop,0);assert.equal(row.paddingBottom,0);
    assert.deepEqual([row.layoutSizingHorizontal,row.layoutSizingVertical],["FILL","HUG"]);
    const rowIndex=Number(row.name.at(-1)),lastAbsent=row.name.includes("last-rule-absent")&&rowIndex===2;
    if(!lastAbsent)assert.deepEqual([row.strokeTopWeight,row.strokeRightWeight,row.strokeBottomWeight,row.strokeLeftWeight],[0,0,1,0]);
    for(const cell of row.children){assert.deepEqual([cell.layoutSizingHorizontal,cell.layoutSizingVertical],["FILL","FILL"]);assert.equal(cell.paddingTop,rowIndex===0?10:10.5);assert.equal(cell.paddingBottom,lastAbsent?10:10.5);assert.equal(cell.children.length,1);assert.deepEqual(clone(cell.children[0].lineHeight),{unit:"PIXELS",value:25});assert.equal(cell.children[0].layoutSizingVertical,"HUG");}
  }
});

test("actual multi-paragraph Grid preflight preserves real nested Auto Layout and rejects unproven descendants atomically", async () => {
  const raw = JSON.parse(await readFile(new URL("../../fixtures/design-studio-native-grid-intrinsic-vflow/native-source.json", import.meta.url)));
  const imported = importFigmaJson(raw), transfer = createFigmaTransfer(imported.document);
  assert.deepEqual(imported.warnings, []);
  assert.deepEqual(transfer.warnings, []);
  const runtime = pluginHarness({ nativeGrid: true });
  await runtime.send({ type: "import-transfer", content: JSON.stringify(transfer) });
  assert.equal(runtime.messages.at(-1).type, "imported", JSON.stringify(runtime.messages.at(-1)));
  const flatten = (node) => [node, ...(node.children ?? []).flatMap(flatten)];
  const all = flatten(runtime.pages[1]);
  assert.equal(all.length, 27);
  assert.equal(all.filter((node) => node.layoutMode === "GRID").length, 4);
  assert.equal(all.filter((node) => node.type === "TEXT").length, 9);
  const contact = all.find((node) => node.name.endsWith("real-DD3"));
  assert.deepEqual([contact.layoutMode, contact.layoutSizingHorizontal, contact.layoutSizingVertical], ["VERTICAL", "FILL", "FILL"]);
  assert.deepEqual([contact.paddingTop, contact.paddingBottom], [9.5, 10.5]);
  const [wrapper, secondP] = contact.children, firstP = wrapper.children[0], phone = firstP.children[0];
  assert(wrapper.name.endsWith("margin-wrapper"));
  assert(firstP.name.endsWith("real-P0"));
  assert(secondP.name.endsWith("real-P1"));
  assert.deepEqual([wrapper.paddingTop, wrapper.paddingBottom], [1, 10]);
  for (const node of [wrapper, firstP, secondP])
    assert.deepEqual([node.layoutMode, node.layoutSizingHorizontal, node.layoutSizingVertical, node.layoutPositioning], ["VERTICAL", "FILL", "HUG", "AUTO"]);
  assert.equal(phone.characters, "07700 900457");
  assert.equal(secondP.children[0].characters, "sarah.phillips@example.com");
  assert.deepEqual(clone(phone.lineHeight), { unit: "PIXELS", value: 25 });
  assert.deepEqual([phone.textAutoResize, phone.layoutSizingHorizontal, phone.layoutSizingVertical], ["HEIGHT", "FILL", "HUG"]);
  for (const edit of [
    (node) => { node.layoutSizingVertical = "fill"; },
    (node) => { node.layoutReverse = true; },
    (node) => { node.paddingTop = -1; },
    (node) => { delete node.children[0].children[0].textSource; },
  ]) {
    const invalid = clone(transfer), frames = invalid.pages[0].children.flatMap(flatten);
    edit(frames.find((node) => node.name.endsWith("margin-wrapper")));
    const rejected = pluginHarness({ nativeGrid: true });
    await rejected.send({ type: "import-transfer", content: JSON.stringify(invalid) });
    assert.equal(rejected.messages.at(-1).type, "error");
    assert.equal(rejected.pages.length, 1, "all nested dependency validation completes before creating a native page");
  }
});
