import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import {
  designNodeToV3,
  inertDesignSvg,
} from "../../../apps/design-studio/app/design-node-adapter.mjs";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
} from "../../../apps/design-studio/app/document.mjs";
import { transformedNodeBoundsInTree } from "../../../apps/design-studio/app/geometry.mjs";
import { resolveDesignResource } from "../../../apps/design-studio/app/resource-store.mjs";
import { createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { cssLinearBackgroundPaints } from "../../../apps/design-studio/app/css-linear-gradient.mjs";
import { inverseGradientMatrix, sampleDesignFill } from "../../../apps/design-studio/app/paint.mjs";
import {
  createPortableDesign,
  planPortableDesign,
} from "../../../apps/design-studio/app/portable-backup.mjs";

const hash = async (value) => createHash("sha256").update(value).digest("hex");
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7S8AAAAASUVORK5CYII=";
const rgb = (r, g, b, a = 1) => ({ r, g, b, a });
const bounds = (x = 0, y = 0, width = 200, height = 100) => ({ x, y, width, height });
const base = (nodeType, properties = {}) => ({
  id: "random-upstream-id",
  name: nodeType,
  tag: nodeType === "text" ? "span" : "div",
  nodeType,
  bounds: bounds(),
  opacity: 1,
  visible: true,
  positioning: { mode: "static" },
  ...properties,
});
const container = (children = [], properties = {}) =>
  base("container", {
    layout: { display: "block", padding: { top: 0, right: 0, bottom: 0, left: 0 } },
    background: { layers: [] },
    overflow: "visible",
    children,
    ...properties,
  });
const text = (content = "Editable title", properties = {}) =>
  base("text", {
    content,
    bounds: bounds(5, 7, 140, 24),
    textStyle: {
      fontFamily: "Inter",
      fontSize: 20,
      fontWeight: 400,
      fontStyle: "normal",
      color: rgb(10, 20, 30),
      textAlign: "left",
      textDecoration: "none",
      lineHeight: { unit: "px", value: 24 },
      letterSpacing: { unit: "px", value: 0 },
    },
    ...properties,
  });
const allNodes = (result) => normalizeDesignDocument(result.document).nodes;
const codes = (result) => result.report.warnings.map((warning) => warning.code);
const options = { sha256Bytes: hash };

test("capture-local ownership callback retains original source objects across local block clones", async () => {
  const tree = container([container([text()])]), original = JSON.stringify(tree), pairs = new Map();
  const result = await designNodeToV3(tree, { ...options, onNode: (source, node) => pairs.set(source, node) });
  assert.equal(JSON.stringify(tree), original);
  assert.equal(pairs.size, 3);
  assert.equal(pairs.get(tree), result.document.pages[0].children[0]);
  assert.equal(pairs.get(tree.children[0]), pairs.get(tree).children[0]);
  assert.equal(pairs.get(tree.children[0].children[0]), pairs.get(tree).children[0].children[0]);
  assert(!serializeDesignDocument(normalizeDesignDocument(result.document)).includes("onNode"));
});

test("final upstream parent-relative bounds become page coordinates; random and duplicate upstream IDs never become design IDs", async () => {
  const tree = container(
    [
      container([text()], { bounds: bounds(20, 30) }),
      text("Fixed", { bounds: bounds(80, 90), positioning: { mode: "fixed" } }),
    ],
    { bounds: bounds(100, 200, 800, 600) },
  );
  const addSemantic = (node) => {
    node.semantic = { semanticId: "duplicate-semantic-id", cssSelector: ".card" };
    for (const child of node.children ?? []) addSemantic(child);
  };
  addSemantic(tree);
  const before = JSON.stringify(tree),
    result = await designNodeToV3(tree, options),
    nodes = allNodes(result);
  assert.deepEqual(
    nodes.map((node) => [node.x, node.y]),
    [
      [0, 0],
      [20, 30],
      [25, 37],
      [80, 90],
    ],
  );
  assert.equal(new Set(nodes.map((node) => node.id)).size, 4);
  assert.ok(nodes.every((node) => node.id.startsWith("html-")));
  assert.equal(JSON.stringify(tree), before);
  const changedIds = structuredClone(tree);
  const randomize = (node) => {
    node.id = String(Math.random());
    for (const child of node.children ?? []) randomize(child);
  };
  randomize(changedIds);
  const repeated = await designNodeToV3(changedIds, options);
  assert.deepEqual(result.document, repeated.document);
  assert.equal(JSON.parse(nodes[2].notes).semanticId, "duplicate-semantic-id");
});

test("CSS rotation uses the upstream transform anchor and v3 center rotation without applying scale twice", async () => {
  const tree = container(
    [
      text("Rotated", {
        bounds: bounds(100, 0, 40, 20),
        transform: { rotation: 90, scale: { x: 2, y: 2 }, matrix: [0, 2, -2, 0, 0, 0] },
      }),
    ],
    { bounds: bounds(0, 0, 400, 300) },
  );
  const nodes = allNodes(await designNodeToV3(tree, options)),
    node = nodes[1];
  assert.deepEqual([node.x, node.y, node.width, node.height, node.rotation], [70, 10, 40, 20, 90]);
  assert.deepEqual(transformedNodeBoundsInTree(nodes, node), {
    x: 80,
    y: 0,
    width: 20,
    height: 40,
  });
  const nested = container(
    [
      container([container([], { bounds: bounds(-30, 20, 20, 40) })], {
        bounds: bounds(120, 40, 100, 80),
        transform: { rotation: 90, matrix: [0, 1, -1, 0, 0, 0] },
      }),
    ],
    { bounds: bounds(0, 0, 400, 300) },
  );
  const result = await designNodeToV3(nested, options),
    nestedNodes = allNodes(result),
    child = nestedNodes[2];
  assert.deepEqual([child.x, child.y, child.width, child.height], [50, 60, 40, 20]);
  assert.deepEqual(transformedNodeBoundsInTree(nestedNodes, child), {
    x: 90,
    y: 60,
    width: 20,
    height: 40,
  });
  assert.equal(codes(result).filter((code) => code === "nested-transform-approximation").length, 1);
});

test("flex direction, wrap, padding, gaps and editable child sizing are represented directly", async () => {
  const tree = container([text("Flexible", { flexItem: { grow: 1, alignSelf: "flex-end" } })], {
    layout: {
      display: "flex",
      padding: { top: 8, right: 12, bottom: 16, left: 20 },
      flex: {
        direction: "row-reverse",
        wrap: "wrap",
        gap: { row: 9, column: 14 },
        justifyContent: "space-between",
        alignItems: "center",
        alignContent: "stretch",
      },
    },
  });
  const [frame, child] = allNodes(await designNodeToV3(tree, options));
  assert.deepEqual(
    [
      frame.layout,
      frame.layoutReverse,
      frame.layoutWrap,
      frame.gap,
      frame.rowGap,
      frame.paddingLeft,
    ],
    ["horizontal", true, "wrap", 14, 9, 20],
  );
  assert.equal(frame.justifyContent, "space-between");
  assert.equal(child.layoutSizingHorizontal, "fill");
  assert.equal(child.layoutAlignSelf, "end");
});

test("uniform and unequal pixel Grid remain editable; unsupported tracks and nonuniform CSS child margins keep measured geometry with diagnostics", async () => {
  const grid = {
    display: "grid",
    grid: {
      templateColumns: "100px 100px",
      templateRows: "40px 40px",
      gap: { row: 5, column: 10 },
    },
  };
  const result = await designNodeToV3(container([container()], { layout: grid }), options);
  assert.equal(allNodes(result)[0].layout, "grid");
  assert.equal(allNodes(result)[0].gridColumns, 2);
  const unequal = await designNodeToV3(
    container([container()], {
      layout: { ...grid, grid: { ...grid.grid, templateColumns: "100px 200px" } },
    }),
    options,
  );
  assert.equal(allNodes(unequal)[0].layout, "grid");
  assert.deepEqual(allNodes(unequal)[0].gridColumnSizes, [
    { type: "fixed", value: 100 },
    { type: "fixed", value: 200 },
  ]);
  const irregular = await designNodeToV3(
    container([text()], {
      layout: { ...grid, grid: { ...grid.grid, templateColumns: "minmax(20px,1fr) 100px" } },
    }),
    options,
  );
  assert.equal(allNodes(irregular)[0].layout, "none");
  assert.ok(codes(irregular).includes("grid-fixed-geometry"));
  const margins = await designNodeToV3(
    container([text("Margin", { margin: { left: 10 } }), text("Different margin")], {
      layout: { display: "flex", flex: { direction: "row" } },
    }),
    options,
  );
  assert.equal(allNodes(margins)[0].layout, "none");
  assert.ok(codes(margins).includes("layout-margin-fixed"));
});

test("captured CSS sizing keeps fixed cross sizes, flex fill, intrinsic hug and definite basis editable", async () => {
  const children = [
    container([], {
      bounds: bounds(12, 12, 100, 24),
      cssLayout: { width: "100px", height: "24px", "flex-basis": "auto" },
    }),
    container([], {
      bounds: bounds(120, 12, 168, 24),
      cssLayout: { width: "auto", height: "24px", "flex-basis": "0%" },
      flexItem: { grow: 1, shrink: 1, basis: 0, alignSelf: "auto" },
    }),
  ];
  const tree = container(children, {
    bounds: bounds(0, 0, 300, 100),
    cssLayout: { width: "100%", height: "100px" },
    layout: {
      display: "flex",
      padding: { top: 12, right: 12, bottom: 12, left: 12 },
      flex: { direction: "row", gap: { row: 0, column: 8 }, alignItems: "stretch" },
    },
  });
  const before = JSON.stringify(tree),
    result = await designNodeToV3(tree, options);
  const nodes = allNodes(result),
    [frame, fixed, fluid] = nodes;
  assert.equal(JSON.stringify(tree), before);
  assert.equal(frame.layoutSizingHorizontal, "fixed");
  assert.equal(fixed.layoutSizingVertical, "fixed");
  assert.equal(fixed.layoutAlignSelf, "start");
  assert.equal(fluid.layoutSizingHorizontal, "fill");
  assert.equal(fluid.layoutAlignSelf, "start");
  frame.width = 400;
  applyAllAutoLayouts(nodes);
  assert.deepEqual([fixed.x, fixed.y, fixed.width, fixed.height], [12, 12, 100, 24]);
  assert.deepEqual([fluid.x, fluid.y, fluid.width, fluid.height], [120, 12, 268, 24]);

  const intrinsic = container([], {
    cssLayout: { width: "fit-content", height: "auto", "flex-basis": "auto" },
    layout: { display: "inline-flex", flex: { direction: "row", alignItems: "start" } },
  });
  const hug = allNodes(await designNodeToV3(intrinsic, options))[0];
  assert.deepEqual([hug.layoutSizingHorizontal, hug.layoutSizingVertical], ["hug", "hug"]);
  const crossHug = allNodes(
    await designNodeToV3(
      container([intrinsic], {
        layout: { display: "flex", flex: { direction: "column", alignItems: "stretch" } },
      }),
      options,
    ),
  )[1];
  assert.equal(crossHug.layoutSizingHorizontal, "hug");
  assert.equal(crossHug.layoutAlignSelf, "start");
  const basis = structuredClone(intrinsic);
  basis.cssLayout["flex-basis"] = "80px";
  const basisNodes = allNodes(
    await designNodeToV3(
      container([basis], {
        layout: { display: "flex", flex: { direction: "row", alignItems: "start" } },
      }),
      options,
    ),
  );
  assert.equal(basisNodes[1].layoutSizingHorizontal, "fixed");
});

test("uniform nonnegative flex margins become padding and gaps without changing measured flow positions", async () => {
  const child = (x) =>
    container([], {
      bounds: bounds(x, 14, 40, 20),
      margin: { top: 4, right: 6, bottom: 4, left: 6 },
      cssLayout: { width: "40px", height: "20px" },
    });
  const tree = container([child(16), child(76)], {
    bounds: bounds(0, 0, 300, 100),
    layout: {
      display: "flex",
      padding: { top: 10, right: 10, bottom: 10, left: 10 },
      flex: { direction: "row", gap: { row: 0, column: 8 }, alignItems: "start" },
    },
  });
  const result = await designNodeToV3(tree, options),
    nodes = allNodes(result);
  assert.equal(codes(result).includes("layout-margin-fixed"), false);
  assert.equal(nodes[0].layout, "horizontal");
  assert.deepEqual(
    [nodes[0].paddingTop, nodes[0].paddingRight, nodes[0].columnGap, nodes[0].rowGap],
    [14, 16, 20, 8],
  );
  applyAllAutoLayouts(nodes);
  assert.deepEqual(
    nodes.slice(1).map(({ x, y, width, height }) => [x, y, width, height]),
    [
      [16, 14, 40, 20],
      [76, 14, 40, 20],
    ],
  );
  const transfer = createFigmaTransfer({ ...result.document, nodes });
  assert.equal(transfer.pages[0].children[0].layout, "horizontal");
  assert.equal(
    transfer.pages[0].children[0].children.some((node) => node.layoutPositioning === "absolute"),
    false,
  );
});

test("main-axis auto margins retain editable free space and out-of-flow margins do not disable flex", async () => {
  const tree = container(
    [
      container([], { bounds: bounds(0, 0, 50, 20) }),
      container([], {
        bounds: bounds(250, 0, 50, 20),
        margin: { left: 192 },
        cssLayout: { "margin-left": "auto" },
      }),
      container([], {
        bounds: bounds(20, 40, 10, 10),
        positioning: { mode: "absolute" },
        margin: { left: 5, top: 10 },
      }),
    ],
    {
      bounds: bounds(0, 0, 300, 100),
      layout: {
        display: "flex",
        flex: { direction: "row", gap: { row: 0, column: 8 }, alignItems: "start" },
      },
    },
  );
  const result = await designNodeToV3(tree, options),
    nodes = allNodes(result);
  assert.equal(codes(result).includes("layout-margin-fixed"), false);
  assert.equal(nodes[0].layout, "horizontal");
  assert.equal(nodes[2].layoutMarginBefore, "auto");
  nodes[0].width = 400;
  applyAllAutoLayouts(nodes);
  assert.deepEqual([nodes[1].x, nodes[2].x, nodes[3].x, nodes[3].y], [0, 350, 20, 40]);
});

test("viewport frame crops the first screen while preserving full editable content below it", async () => {
  const tree = container([text("Below fold", { bounds: bounds(10, 1500, 100, 30) })], {
    bounds: bounds(0, 0, 1440, 4000),
  });
  const result = await designNodeToV3(tree, {
    ...options,
    viewportWidth: 1440,
    viewportHeight: 900,
  });
  assert.deepEqual(result.document.canvas, { width: 1440, height: 900, background: "#ffffff" });
  const nodes = allNodes(result);
  assert.equal(nodes[0].id, "html-viewport");
  assert.equal(nodes[0].clipContent, true);
  assert.equal(nodes[1].height, 4000);
  assert.equal(nodes[2].y, 1500);
  const cropped = await designNodeToV3(tree, {
    ...options,
    captureBounds: { left: 10, top: 20, right: 210, bottom: 120 },
  });
  assert.deepEqual([allNodes(cropped)[1].x, allNodes(cropped)[1].y], [-10, -20]);
  await assert.rejects(
    () => designNodeToV3(tree, { viewportWidth: 20, viewportHeight: 900 }),
    /100–10000/u,
  );
});

test("local images deduplicate into verified resource plans and a complete single file, then export exact bytes to Figma", async () => {
  const image = () =>
    base("image", {
      imageData: { src: "photo.png", base64: `data:image/png;base64,${PNG}`, objectFit: "cover" },
    });
  const result = await designNodeToV3(container([image(), image()]), options);
  assert.equal(result.resourcePlans.length, 1);
  assert.equal(allNodes(result)[1].type, "image");
  assert.equal(allNodes(result)[1].imageRef, allNodes(result)[2].imageRef);
  assert.ok(!serializeDesignDocument(result.document).includes(PNG));
  const files = new Map(
    result.resourcePlans.flatMap((plan) => plan.parts.map((part) => [part.path, part.content])),
  );
  const readText = async (path) => files.get(path);
  const resource = await resolveDesignResource({
    descriptor: result.document.resources[0],
    readText,
    sha256Bytes: hash,
  });
  assert.equal(resource.base64, PNG);
  const portable = await createPortableDesign({
    document: normalizeDesignDocument(result.document),
    source: { workspaceRoot: null, sessionId: null, path: "designs/html.codesign.json" },
    readText,
    sha256Bytes: hash,
  });
  const restored = await planPortableDesign(portable, { sha256: hash, sha256Bytes: hash });
  assert.equal(restored.resourceCount, 1);
  assert.ok(portable.includes(PNG));
  const transfer = createFigmaTransfer(result.document, { resources: result.resourcePayloads });
  assert.equal(transfer.pages[0].children[0].children[0].type, "image");
  assert.equal(transfer.assets[result.document.resources[0].id].base64, PNG);
});

test("original sanitized data URL bytes take priority over the runtime's canvas-reencoded image", async () => {
  const reencoded =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const result = await designNodeToV3(
    container([
      base("image", {
        imageData: {
          src: `data:image/png;base64,${PNG}`,
          base64: `data:image/png;base64,${reencoded}`,
          objectFit: "contain",
        },
      }),
    ]),
    options,
  );
  assert.equal(result.resourcePayloads.values().next().value.base64, PNG);
  assert.equal(result.document.resources[0].sha256, await hash(Buffer.from(PNG, "base64")));
  const local = await designNodeToV3(
    container([base("image", { imageData: { src: "local/photo.png", base64: PNG } })]),
    options,
  );
  assert.equal(local.document.resources[0].mime, "image/png");
});

test("font bytes produce matched fontRef descriptors and survive the complete portable file", async () => {
  const bytes = Buffer.from("WOFF2 inert test bytes").toString("base64");
  const result = await designNodeToV3(container([text()]), {
    ...options,
    fonts: [{ family: "Inter", weight: 400, style: "normal", mime: "font/woff2", base64: bytes }],
  });
  const descriptor = result.document.resources[0],
    node = allNodes(result)[1];
  assert.equal(descriptor.kind, "font");
  assert.equal(node.fontRef, descriptor.id);
  assert.equal(result.resourcePayloads.get(descriptor.id).base64, bytes);
  const files = new Map(
    result.resourcePlans.flatMap((plan) => plan.parts.map((part) => [part.path, part.content])),
  );
  const portable = await createPortableDesign({
    document: normalizeDesignDocument(result.document),
    source: { workspaceRoot: null, sessionId: null, path: "designs/html.codesign.json" },
    readText: async (path) => files.get(path),
    sha256Bytes: hash,
  });
  assert.ok(portable.includes(bytes));
});

test("safe SVG source remains a visible self-contained resource and active/external SVG never enters a plan", async () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><defs><linearGradient id="g"><stop stop-color="red"/></linearGradient></defs><rect width="40" height="20" fill="url(#g)"/></svg>';
  const result = await designNodeToV3(container([base("svg", { svgContent: svg })]), options);
  assert.equal(allNodes(result)[1].type, "image");
  assert.equal(new TextDecoder().decode(result.resourcePayloads.values().next().value.bytes), svg);
  assert.ok(codes(result).includes("svg-image-resource"));
  for (const source of [
    "<svg><script>alert(1)</script></svg>",
    '<svg onload="alert(1)"/>',
    '<svg><use href="https://example.com/icon"/></svg>',
    "<!DOCTYPE svg><svg/>",
    '<svg><rect fill="url(https://example.com/pixel)"/></svg>',
    '<svg><use href="&#104;ttps://example.com"/></svg>',
  ]) {
    assert.throws(() => inertDesignSvg(source));
    const rejected = await designNodeToV3(
      container([base("svg", { svgContent: source })]),
      options,
    );
    assert.equal(rejected.resourcePlans.length, 0);
    assert.equal(allNodes(rejected)[1].type, "rectangle");
    assert.ok(codes(rejected).includes("invalid-svg"));
  }
});

test("missing and invalid local image bytes are visible placeholders with explicit diagnostics, without any network fetch", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Adapter must never fetch");
  };
  try {
    const result = await designNodeToV3(
      container([
        base("image", { imageData: { src: "https://example.com/photo.png" } }),
        base("image", { imageData: { base64: "data:image/png;base64,YmFk" } }),
      ]),
      options,
    );
    assert.deepEqual(
      allNodes(result)
        .slice(1)
        .map((node) => node.type),
      ["rectangle", "rectangle"],
    );
    assert.ok(codes(result).includes("missing-image-bytes"));
    assert.ok(codes(result).includes("invalid-image"));
    assert.equal(result.resourcePlans.length, 0);
  } finally {
    globalThis.fetch = previous;
  }
});

test("CSS background and text alpha remain independent editable paints through save and Figma transfer", async () => {
  const heading = text("Free");
  heading.textStyle.color = rgb(33, 37, 41, 0.75);
  heading.opacity = 0.7;
  const result = await designNodeToV3(
    container([heading], {
      opacity: 0.6,
      background: { layers: [{ type: "color", color: rgb(33, 37, 41, 0.03) }] },
    }),
    options,
  );
  const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(result.document)));
  const [frame, label] = reopened.nodes;
  assert.equal(frame.opacity, 0.6);
  assert.equal(label.opacity, 0.7);
  assert.deepEqual(frame.fillPaints, [{ type: "SOLID", color: "#212529", opacity: 0.03 }]);
  assert.deepEqual(label.fillPaints, [{ type: "SOLID", color: "#212529", opacity: 0.75 }]);
  assert.equal(codes(result).includes("paint-alpha"), false);
  const native = createFigmaTransfer(reopened).pages[0].children[0];
  assert.deepEqual(native.fillPaints, frame.fillPaints);
  assert.deepEqual(native.children[0].fillPaints, label.fillPaints);
  assert.equal(native.layoutPositioning, undefined);
});

test("unsupported paints, mixed text, effects and geometry corrections are reported, never silently claimed as faithful", async () => {
  const styled = text("Mixed", {
    styledSegments: [{ start: 0, end: 5, text: "Mixed", style: { fontWeight: 700 } }],
  });
  const result = await designNodeToV3(
    container([styled], {
      background: {
        layers: [
          { type: "linear-gradient", angle: 45, stops: [{ position: 0, color: rgb(200, 10, 20) }] },
        ],
      },
      effects: {
        boxShadows: [{ inset: true, spreadRadius: 2 }],
        filters: [{ type: "blur", value: 4 }],
      },
      bounds: bounds(0, 0, 500, 200),
    }),
    options,
  );
  assert.equal(allNodes(result)[0].fill, "transparent");
  for (const code of [
    "unsupported-css-gradient",
    "rich-text-uniform",
    "unsupported-shadow-stack",
    "unsupported-effects",
  ])
    assert.ok(codes(result).includes(code), code);
  assert.equal(JSON.parse(allNodes(result)[1].notes).styledSegments[0].style.fontWeight, 700);
  assert.equal(allNodes(result)[0].shadow, undefined);
  assert.equal(allNodes(result)[0].shadowStack, undefined, "unsupported complete stacks never become a first-layer approximation");
});

test("retained CSS gradient units, angles and stop fixup map to editable paints rather than upstream unit guesses", () => {
  const gradient = (image, extra = {}, width = 200, height = 100) =>
    cssLinearBackgroundPaints({ "background-image": image, ...extra }, width, height).at(-1);
  const px = gradient("linear-gradient(rgb(0,0,0), rgb(255,255,255) 100px)", {}, 200, 400);
  assert.equal(px.stops[1].position, 0.25);
  assert.deepEqual(px.handles.slice(0, 2), [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }]);
  const sample = (paint, x, y) => sampleDesignFill({ fillPaints: [paint] }, { x, y });
  assert.equal(sample(px, 0.5, 0.125).red, 0.5);
  assert.equal(sample(px, 0.5, 0.5).red, 1);
  const angle = gradient("linear-gradient(45deg, rgb(0,0,0), rgb(255,255,255))");
  const [row] = inverseGradientMatrix(angle.handles);
  assert(Math.abs(row[0] / 200 + row[1] / 100) < 1e-12, "45° must project equally in physical pixels");
  assert(Math.abs(sample(angle, 0.5, 0.5).red - 0.5) < 1e-12);
  const corner = gradient("linear-gradient(to top right, rgb(0,0,0), rgb(255,255,255))");
  assert(Math.abs(sample(corner, 0, 0).red - 0.5) < 1e-12);
  assert(Math.abs(sample(corner, 1, 1).red - 0.5) < 1e-12);
  const fixed = gradient("linear-gradient(0.25turn, rgb(0,0,0) 60%, rgb(20,20,20), rgb(40,40,40) 20%, rgb(255,255,255))");
  assert.deepEqual(fixed.stops.map((stop) => stop.position), [0.6, 0.6, 0.6, 1]);
  const outside = gradient("linear-gradient(90deg, rgb(0,0,0) -100%, rgb(255,255,255) 200%)");
  assert.deepEqual(outside.stops.map((stop) => stop.position), [0, 1]);
  assert(Math.abs(sample(outside, 0.5, 0.5).red - 0.5) < 1e-12);
});

test("CSS background stacks keep alpha and layer order and refuse unsupported interpolation or background geometry", () => {
  const style = (image, extra = {}) => ({ "background-image": image, ...extra });
  const paints = cssLinearBackgroundPaints(style(
    "linear-gradient(90deg, rgba(255,0,0,.5), transparent), linear-gradient(rgb(0,0,255), rgb(0,0,255))",
    { "background-color": "rgb(0,255,0)" },
  ), 200, 100);
  assert.equal(paints.length, 3);
  assert.deepEqual(paints[0], { type: "SOLID", color: "#00ff00", opacity: 1 });
  assert.equal(paints[1].stops[0].color, "#0000ff");
  assert.deepEqual(paints[2].stops.map(({ color, opacity }) => [color, opacity]), [["#ff0000", 0.5], ["#ff0000", 0]]);
  const internal = cssLinearBackgroundPaints(style("linear-gradient(rgb(255,0,0), transparent, rgb(0,0,255))"), 200, 100)[0];
  assert.deepEqual(internal.stops.map(({ position, color, opacity }) => [position, color, opacity]),
    [[0, "#ff0000", 1], [0.5, "#ff0000", 0], [0.5, "#0000ff", 0], [1, "#0000ff", 1]]);
  for (const image of [
    "radial-gradient(rgb(0,0,0), rgb(255,255,255))",
    "conic-gradient(rgb(0,0,0), rgb(255,255,255))",
    "repeating-linear-gradient(rgb(0,0,0), rgb(255,255,255))",
    "linear-gradient(in oklab, rgb(0,0,0), rgb(255,255,255))",
    "linear-gradient(rgb(0,0,0), 30%, rgb(255,255,255))",
    "linear-gradient(rgba(255,0,0,.5), rgba(0,0,255,.75))",
  ]) assert.throws(() => cssLinearBackgroundPaints(style(image), 200, 100), /未转换|无法/u, image);
  for (const extra of [{ "background-size": "100px 100px" }, { "background-blend-mode": "multiply" },
    { "background-position": "10px 0px" },
    { "background-clip": "padding-box" }, { "background-origin": "content-box" },
    { "border-top-width": "2px" }, { "background-attachment": "fixed" }])
    assert.throws(() => cssLinearBackgroundPaints(style("linear-gradient(rgb(0,0,0), rgb(255,255,255))", extra), 200, 100));
});

test("cycles, unsupported nodes, excessive nesting and text limits fail clearly before any caller can persist data", async () => {
  const cyclic = container();
  cyclic.children.push(cyclic);
  await assert.rejects(() => designNodeToV3(cyclic, options), /循环/u);
  await assert.rejects(() => designNodeToV3({ nodeType: "canvas" }, options), /不支持/u);
  let deep = text();
  for (let index = 0; index < 33; index += 1) deep = container([deep]);
  await assert.rejects(() => designNodeToV3(deep, options), /32 层/u);
  await assert.rejects(() => designNodeToV3(container([text("x".repeat(4001))]), options), /4000/u);
});

test("real Chromium HTML → pinned original DesignNode → v3 retains nested positions, text, local PNG and SVG", async (t) => {
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const runtime = await readFile(
    new URL("../../../apps/design-studio/app/vendor/html2figma-browser.mjs", import.meta.url),
    "utf8",
  );
  await page.route("**/*", (route) => {
    if (route.request().url() === "https://adapter.test/runtime.mjs")
      return route.fulfill({ body: runtime, contentType: "text/javascript" });
    if (route.request().url() === "https://adapter.test/")
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><style>body{margin:0}#root{position:relative;width:400px;height:300px;font-family:Arial}h1{position:absolute;left:20px;top:10px;margin:0;font-size:30px;line-height:36px}#outer{position:absolute;left:40px;top:60px;width:200px;height:100px;background:rgb(230,240,250)}#inner{position:absolute;left:20px;top:30px;width:80px;height:20px;background:rgb(10,20,30)}img{position:absolute;left:20px;top:190px;width:24px;height:24px}svg{position:absolute;left:80px;top:190px}</style><main id="root"><h1>Heading <em>mixed</em></h1><div id="outer"><div id="inner"></div></div><img src="data:image/png;base64,${PNG}"><svg width="20" height="20" viewBox="0 0 20 20"><path d="M0 0L20 20" stroke="blue"/></svg></main>`,
      });
    return route.abort();
  });
  await page.goto("https://adapter.test/");
  const tree = await page.evaluate(async () => {
    await document.querySelector("img").decode();
    const { convertToDesignDSL } = await import("/runtime.mjs");
    return convertToDesignDSL(document.querySelector("#root"));
  });
  const result = await designNodeToV3(tree, {
    ...options,
    viewportWidth: 400,
    viewportHeight: 300,
  });
  const nodes = allNodes(result);
  const byHtmlId = (id) =>
    nodes.find((node) => node.notes && JSON.parse(node.notes).attributes?.id === id);
  assert.deepEqual([byHtmlId("outer").x, byHtmlId("outer").y], [40, 60]);
  assert.deepEqual([byHtmlId("inner").x, byHtmlId("inner").y], [60, 90]);
  assert.equal(byHtmlId("inner").fill, "#0a141e");
  assert.ok(
    nodes.some(
      (node) => node.type === "text" && node.text.includes("Heading") && node.fontSize === 30,
    ),
  );
  assert.equal(nodes.filter((node) => node.type === "image").length, 2);
  assert.ok(result.document.resources.some((resource) => resource.mime === "image/png"));
  assert.ok(result.document.resources.some((resource) => resource.mime === "image/svg+xml"));
  assert.ok(codes(result).includes("rich-text-uniform"));
  assert.ok(codes(result).includes("svg-image-resource"));
  const rotated = await page.evaluate(async () => {
    const outer = document.querySelector("#outer");
    outer.style.transformOrigin = "top left";
    outer.style.transform = "rotate(90deg)";
    const rect = document.querySelector("#inner").getBoundingClientRect();
    const { convertToDesignDSL } = await import("/runtime.mjs");
    return {
      tree: convertToDesignDSL(document.querySelector("#root")),
      measured: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });
  const rotatedResult = await designNodeToV3(rotated.tree, options),
    rotatedNodes = allNodes(rotatedResult);
  const inner = rotatedNodes.find(
    (node) => node.notes && JSON.parse(node.notes).attributes?.id === "inner",
  );
  const visual = transformedNodeBoundsInTree(rotatedNodes, inner);
  for (const key of ["x", "y", "width", "height"])
    assert.ok(
      Math.abs(visual[key] - rotated.measured[key]) < 0.05,
      `${key}: ${visual[key]} vs browser ${rotated.measured[key]}`,
    );
});


test("HTML capture preserves a four-pixel authored font through canonical save and Figma transfer", async () => {
  const source = text("Tiny author text", {
    textStyle: { ...text().textStyle, fontSize: 4, lineHeight: { unit: "px", value: 4.8 } },
  });
  const before = structuredClone(source), result = await designNodeToV3(source, options);
  assert.deepEqual(source, before);
  assert(!result.report.warnings.some(warning => warning.code === "bounded-number" && warning.message.startsWith("fontSize")));
  const document = normalizeDesignDocument(result.document), label = document.nodes[0];
  assert.deepEqual([label.fontSize, label.lineHeight, label.lineHeightUnit], [4, 1.2, undefined]);
  const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(document)));
  assert.equal(reopened.nodes[0].fontSize, 4);
  assert.equal(createFigmaTransfer(reopened).pages[0].children[0].fontSize, 4);
});


test("sub-one-pixel HTML font size keeps the adapter's explicit bounded-number diagnostic", async () => {
  const source = text("Unsupported tiny text", {
    textStyle: { ...text().textStyle, fontSize: 0.5, lineHeight: { unit: "px", value: 1 } },
  });
  const result = await designNodeToV3(source, options);
  assert.equal(allNodes(result)[0].fontSize, 1);
  assert(result.report.warnings.some(warning => warning.code === "bounded-number" && warning.message.startsWith("fontSize")));
  assert.equal(source.textStyle.fontSize, 0.5);
});
