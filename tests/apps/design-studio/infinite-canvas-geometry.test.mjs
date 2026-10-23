import assert from "node:assert/strict";
import { test } from "node:test";
import { alignNodes, alignNodeTrees, distributeNodeTrees } from "../../../apps/design-studio/app/geometry.mjs";
import { createComponentInstance } from "../../../apps/design-studio/app/layout.mjs";
import { drawCanvasInteraction, hitTestCanvasNode } from "../../../apps/design-studio/app/canvas-interaction.mjs";

const canvas = { mode: "infinite", width: 1000, height: 700, background: "#e9edf4" };
const node = (id, extra = {}) => ({ id, name: id, type: "rectangle", x: -250000,
  y: 300000, width: 100, height: 80, visible: true, opacity: 1, rotation: 0,
  cornerRadius: 0, ...extra });

test("infinite root alignment has no global canvas edge, while bounded alignment stays unchanged", () => {
  const root = node("root"), before = structuredClone(root);
  assert.equal(alignNodes([root], "left", canvas), false);
  assert.deepEqual(root, before);
  assert.equal(alignNodeTrees([root], new Set([root.id]), "right", canvas), false);
  assert.deepEqual(root, before);
  assert.equal(alignNodeTrees([root], new Set([root.id]), "right", { width: 1000, height: 700 }), true);
  assert.equal(root.x, 900);
});

test("infinite child alignment uses its frame and multi-selection uses the selected roots", () => {
  const parent = node("parent", { type: "frame", width: 500, height: 400 });
  const child = node("child", { parentId: parent.id, x: parent.x + 20 });
  assert.equal(alignNodeTrees([parent, child], new Set([child.id]), "right", canvas), true);
  assert.equal(child.x, parent.x + 400);
  const other = node("other", { x: parent.x + 800 });
  assert.equal(alignNodeTrees([parent, child, other], new Set([parent.id, other.id]), "left", canvas), true);
  assert.equal(other.x, parent.x);
  assert.equal(child.x, parent.x + 400);
});

test("a purely organizational group is not an infinite artboard alignment boundary", () => {
  const group = node("group", { type: "group", width: 500 });
  const child = node("child", { parentId: group.id, x: group.x + 20 });
  const before = structuredClone(child);
  assert.equal(alignNodeTrees([group, child], new Set([child.id]), "left", canvas), false);
  assert.deepEqual(child, before);
});

test("infinite component instances stay beside a distant master and obey the coordinate budget", () => {
  const component = node("master", { type: "component", x: -350000, y: 450000 });
  const instance = createComponentInstance(component, "copy", 32, canvas);
  assert.deepEqual([instance.x, instance.y], [-349868, 450000]);
  const edge = createComponentInstance({ ...component, x: 1000000, y: 1000000 }, "edge", 32, canvas);
  assert.deepEqual([edge.x, edge.y], [999868, 1000000]);
  const bounded = createComponentInstance({ ...component, x: 900, y: 500 }, "bounded", 32,
    { width: 1000, height: 700 });
  assert.deepEqual([bounded.x, bounded.y], [900, 612]);
});

test("infinite snap guides span the visible world viewport rather than the old artboard", () => {
  const operations = [];
  const context = new Proxy({}, { get: (_, key) => (...values) => operations.push([key, ...values]),
    set: () => true });
  const element = { width: 800, height: 600, getContext: () => context };
  drawCanvasInteraction(element, { design: { canvas, nodes: [] }, selectedIds: new Set(),
    pan: { x: 200000, y: -300000 }, zoom: 2, dpr: 1, width: 800, height: 600,
    activeTool: "select", interaction: { kind: "move", guides: [
      { axis: "x", value: -99800 }, { axis: "y", value: 150100 },
    ] } });
  assert.deepEqual(operations.filter(([name]) => name === "moveTo" || name === "lineTo"), [
    ["moveTo", -99800, 150000], ["lineTo", -99800, 150300],
    ["moveTo", -100000, 150100], ["lineTo", -99600, 150100],
  ]);
});

test("far and negative frame children retain ancestor clip hit testing", () => {
  const frame = node("frame", { type: "frame", clipContent: true });
  const child = node("child", { x: frame.x - 20, y: frame.y - 20, width: 150,
    height: 120, parentId: frame.id });
  const design = { canvas, nodes: [frame, child] };
  assert.equal(hitTestCanvasNode(design, { x: frame.x + 50, y: frame.y + 40 })?.id, child.id);
  assert.equal(hitTestCanvasNode(design, { x: frame.x - 10, y: frame.y + 40 }), null);
});

test("infinite alignment rejects a move beyond the coordinate budget without partially moving the selection", () => {
  const wide = node("wide", { x: 1000000, width: 20000 });
  const small = node("small", { x: 999900, width: 10 });
  const nodes = [wide, small], before = structuredClone(nodes);
  assert.equal(alignNodeTrees(nodes, new Set(nodes.map(({ id }) => id)), "right", canvas), false);
  assert.deepEqual(nodes, before);
  assert.equal(alignNodes(nodes, "right", canvas), false);
  assert.deepEqual(nodes, before);
});

test("infinite distribution rejects an out-of-budget result atomically", () => {
  const nodes = [node("wide", { x: 1000000, width: 20000 }),
    node("middle", { x: 1000000, width: 1 }), node("last", { x: 1000000, width: 1 })];
  const before = structuredClone(nodes);
  assert.equal(distributeNodeTrees(nodes, new Set(nodes.map(({ id }) => id)), "horizontal", canvas), false);
  assert.deepEqual(nodes, before);
});

test("selected descendants of a selected grandparent move once through their root tree", () => {
  const root = node("root", { type: "frame", x: 100, y: 100, width: 300, height: 300 });
  const middle = node("middle", { type: "group", parentId: root.id, x: 120, y: 120 });
  const child = node("child", { parentId: middle.id, x: 140, y: 140 });
  const other = node("other", { x: 500, y: 100 });
  const nodes = [root, middle, child, other];
  assert.equal(alignNodeTrees(nodes, new Set([root.id, child.id, other.id]), "right", canvas), true);
  assert.deepEqual([root.x, middle.x, child.x, other.x], [300, 320, 340, 500]);
});
