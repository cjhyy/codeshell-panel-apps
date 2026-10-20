import assert from "node:assert/strict";
import { test } from "node:test";
import { planHtmlBlockInsets, applyHtmlBlockInsets } from "../../../apps/design-studio/app/html-block-insets.mjs";
import { designNodeToV3 } from "../../../apps/design-studio/app/design-node-adapter.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";

const node = (id, type, name, geometry) => ({ id, type, name, ...geometry, fill: "transparent", stroke: "transparent", strokeWidth: 0,
  cornerRadius: 0, rotation: 0, opacity: 1, visible: true, locked: false });
const setup = () => {
  const source = { layout: { display: "block" }, cssLayout: { width: "200px" } };
  const parent = { ...node("parent", "frame", "Parent", { x: 0, y: 0, width: 200, height: 100 }), layout: "vertical", layoutSizingHorizontal: "fixed", paddingLeft: 20, paddingRight: 20 };
  const childSource = { cssLayout: { "margin-left": "-15px", "margin-right": "-15px" } };
  const row = { ...node("row", "frame", "Row", { x: 5, y: 10, width: 190, height: 20 }), layout: "horizontal", layoutSizingHorizontal: "fill" };
  const after = { ...node("after", "rectangle", "After", { x: 20, y: 35, width: 160, height: 20 }), layoutSizingHorizontal: "fill" };
  const block = { paddingLeft: 20, paddingRight: 20, entries: [{}, {}], items: [
    { source: childSource, original: row, bleed: { left: 15, right: 15 }, fill: true, gap: 0 },
    { source: { cssLayout: { "margin-left": "0px", "margin-right": "0px" } }, original: after, fill: true, gap: 5 },
  ] };
  parent.children = [row, after];
  return { source, parent, block };
};

test("positive-inset plans retain exact sources, asymmetric compensation and border floor", () => {
  const value = setup(), before = JSON.stringify(value);
  const plan = planHtmlBlockInsets(value.source, value.parent, value.block);
  assert.equal(JSON.stringify(value), before);
  assert.deepEqual([plan.paddingLeft, plan.paddingRight], [5, 5]);
  assert.deepEqual(plan.items.map((item) => [item.x, item.y, item.width, item.height, item.left, item.right, item.top]),
    [[5, 10, 190, 20, 0, 0, 0], [5, 30, 190, 25, 15, 15, 5]]);
  assert.deepEqual(JSON.parse(plan.items[0].notes).capturedMargins, ["-15px", "-15px"]);
  assert.ok(planHtmlBlockInsets(value.source, value.parent, value.block, { ancestorTransformed: true }).unsupported);
  value.source.border = { left: { width: 5 }, right: { width: 5 } };
  assert.ok(!planHtmlBlockInsets(value.source, value.parent, value.block).unsupported);
  value.source.border.left.width = 6;
  assert.match(planHtmlBlockInsets(value.source, value.parent, value.block).unsupported, /border inset/u);
  value.source.border.left.width = -1;
  assert.ok(planHtmlBlockInsets(value.source, value.parent, value.block).unsupported);
});

test("unproven sizing, overlap, source metadata and geometry refuse before mutation", () => {
  const changes = [
    (v) => { v.parent.layoutSizingHorizontal = "hug"; },
    (v) => { v.source.cssLayout.width = "50%"; },
    (v) => { v.source.cssLayout["margin-left"] = "auto"; },
    (v) => { v.block.items[1].fill = false; },
    (v) => { v.block.items[1].gap = -1; },
    (v) => { v.block.items[1].source.cssLayout["margin-right"] = "auto"; },
    (v) => { v.block.items[1].original.visible = false; },
    (v) => { v.block.items[1].original.layoutPositioning = "absolute"; },
    (v) => { v.block.entries.push({}); },
    (v) => { v.parent.children.push({ ...node("background-image", "image", "Background", { x: 0, y: 0, width: 200, height: 100 }), layoutPositioning: "absolute" }); },
    (v) => { v.block.items[1].original.x += 1; },
    (v) => { v.block.items[1].original.height = 19999; },
    (v) => { v.parent.notes = JSON.stringify({ unchanged: "a".repeat(1900) }); },
    (v) => { v.block.items[0].source.cssLayout["margin-left"] = " ".repeat(2100); },
  ];
  for (const change of changes) {
    const value = setup(); change(value); const before = JSON.stringify(value);
    assert.ok(planHtmlBlockInsets(value.source, value.parent, value.block).unsupported, change.toString());
    assert.equal(JSON.stringify(value), before);
  }
});

test("synthetic wrappers preflight complete node and depth budgets transactionally", () => {
  for (const kind of ["count", "depth"]) {
    const { source, parent, block } = setup();
    let root = parent;
    if (kind === "depth") for (let i = 0; i < 30; i++) root = { ...node(`ancestor-${i}`, "frame", "Ancestor", { x: 0, y: 0, width: 200, height: 100 }), children: [root] };
    const before = JSON.stringify(root), warnings = [];
    assert.equal(applyHtmlBlockInsets([root], [{ source, node: parent, block }], node,
      (...args) => warnings.push(args), kind === "count" ? 4 : 10000), null);
    assert.equal(JSON.stringify(root), before);
    assert.deepEqual(warnings.map((item) => item[0]), ["block-bleed-native-unsupported"]);
  }
  const { source, parent, block } = setup(), originalRow = block.items[0].original;
  assert.equal(applyHtmlBlockInsets([parent], [{ source, node: parent, block }], node, () => {}), 5);
  assert.equal(parent.children[0].children[0], originalRow);
  assert.deepEqual([parent.paddingLeft, parent.paddingRight], [5, 5]);
});

test("adapter rebase keeps source identities and coordinates through resize/reopen in both coordinate contracts", async () => {
  const outputs = [];
  for (const rootRelative of [false, true]) {
    const bounds = (x, y, width, height) => ({ x: x + (rootRelative ? 100 : 0), y: y + (rootRelative ? 200 : 0), width, height });
    const row = { nodeType: "container", name: "row", semantic: { cssSelector: "#row" }, bounds: bounds(5, 10, 190, 20),
      positioning: { mode: "absolute" }, layout: { display: "flex" }, children: [], cssLayout: { width: "auto", height: "20px", position: "static",
        "margin-left": "-15px", "margin-right": "-15px", "margin-top": "0px", "margin-bottom": "0px", "min-width": "auto", "max-width": "none" } };
    const tree = { nodeType: "container", name: "parent", semantic: { cssSelector: "#parent" },
      bounds: { x: 100, y: 200, width: 200, height: 100 }, cssLayout: { width: "200px", height: "100px" },
      layout: { display: "block", padding: { left: 20, right: 20, top: 10, bottom: 10 } }, children: [
        { nodeType: "container", name: "neg-margin-placeholder", opacity: 0, bounds: bounds(5, 10, 160, 20), layout: { display: "block" }, children: [] }, row,
        { nodeType: "container", name: "after", semantic: { cssSelector: "#after" }, bounds: bounds(20, 35, 160, 20), layout: { display: "block" }, children: [], cssLayout: { width: "auto", height: "20px" } },
      ] };
    const freeze = (object) => { for (const value of Object.values(object)) if (value && typeof value === "object") freeze(value); return Object.freeze(object); };
    const before = JSON.stringify(tree); freeze(tree);
    const result = await designNodeToV3(tree, { coordinateSpace: rootRelative ? "root-relative" : "parent-relative" });
    assert.equal(JSON.stringify(tree), before);
    assert.ok(result.report.warnings.some((warning) => warning.code === "block-inset-rebased"));
    const value = normalizeDesignDocument(result.document), byId = (id) => value.nodes.find((child) => child.id === id);
    assert.deepEqual([byId("html-0-1").id, byId("html-0-2").id], ["html-0-1", "html-0-2"]);
    assert.deepEqual(result.mapping.map((entry) => entry.designId), ["html-0", "html-0-1", "html-0-2"]);
    assert.equal(result.report.stats.importedNodes, value.nodes.length);
    applyAllAutoLayouts(value.nodes);
    assert.deepEqual([byId("html-0-1").x, byId("html-0-1").y, byId("html-0-1").width], [5, 10, 190]);
    assert.deepEqual([byId("html-0-2").x, byId("html-0-2").y, byId("html-0-2").width], [20, 35, 160]);
    byId("html-0").width = 160; applyAllAutoLayouts(value.nodes);
    assert.deepEqual([byId("html-0-1").x, byId("html-0-1").width, byId("html-0-2").x, byId("html-0-2").width], [5, 150, 20, 120]);
    const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(value))); applyAllAutoLayouts(reopened.nodes);
    assert.deepEqual(reopened.nodes, value.nodes);
    assert.doesNotThrow(() => createFigmaTransfer(reopened));
    outputs.push(value.nodes.map(({ id, x, y, width, height }) => [id, x, y, width, height]));
  }
  assert.deepEqual(outputs[0], outputs[1]);
});
