import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { browserPaintBoxes } from "../../../apps/design-studio/app/canvas/browser-paint-box.mjs";
import { pointToNodeSpace, pointFromNodeSpace, transformedNodeCornersInTree } from "../../../apps/design-studio/app/geometry.mjs";
import { hitTestCanvasNode } from "../../../apps/design-studio/app/canvas-interaction.mjs";

const shape = (id, extra = {}) => ({ id, type: "rectangle", x: 20.25, y: 25.25, width: 14.4, height: 9.4,
  rotation: 0, cornerRadius: 2.4, stroke: "transparent", strokeWidth: 0, ...extra });

test("browser paint boxes snap CSS layout edges before any device or view scaling", () => {
  const source = [shape("fill"), shape("ellipse", { type: "ellipse" }), shape("image", { type: "image" }),
    shape("clip", { type: "frame", layout: "none", clipContent: true, padding: 8 })];
  const before = JSON.stringify(source), result = browserPaintBoxes(source);
  for (const node of source) {
    const painted = result.nodes.get(node.id);
    assert.deepEqual([painted.x, painted.y, painted.width, painted.height], [20, 25, 15, 10]);
    assert.equal(painted.cornerRadius, 2.4); assert.notEqual(painted, node);
  }
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(result.stats, { input: 4, eligible: 4, changed: 4, fallback: 0, reasons: {} });
});

test("nested absolute origins quantize local components independently without snapping ancestors first", () => {
  const parent = shape("parent", { type: "frame", x: 100.35, y: 100.35, width: 100, height: 100, layout: "none", padding: 13 });
  const child = shape("child", { parentId: "parent", x: 100.5, y: 100.5 });
  const direct = shape("direct", { x: 100.5, y: 100.5 });
  const negativeLocal = shape("negative", { parentId: "parent", x: 90, y: 90 });
  const result = browserPaintBoxes([parent, child, direct, negativeLocal]);
  assert.equal(result.nodes.get("child").x, 100, "100.34375 + .140625 is below the paint half-pixel");
  assert.equal(result.nodes.get("direct").x, 101);
  assert.equal(result.nodes.get("negative").x, 90, "negative local offsets truncate toward zero before adding the parent");
  assert.equal(result.nodes.get("child").width, 15, "round the right edge, not the width in isolation");
});

test("absolute children may retain a fixed positioned layout parent's CSS origin", () => {
  const parent = shape("parent", { type: "frame", layout: "horizontal", x: 50.25, y: 20.25, width: 100, height: 100, padding: 20 });
  const absolute = shape("absolute", { parentId: "parent", layoutPositioning: "absolute", x: 55.5, y: 25.5 });
  const flow = shape("flow", { parentId: "parent" });
  const result = browserPaintBoxes([parent, absolute, flow]);
  assert.notEqual(result.nodes.get("absolute"), absolute);
  assert.equal(result.nodes.get("flow"), flow);
  assert.equal(result.fallbackReasons.get("flow"), "LAYOUT_MISMATCH");
});

test("unsafe constraints, transforms, borders and instance ancestry retain original references with reasons", () => {
  const cases = [
    ["rotated", { type: "frame", rotation: 1 }, "rotated-container"], ["sides", { strokeSides: [] }, "stroke-sides"],
    ["inside", { strokeAlign: "inside", stroke: "#111111", strokeWidth: 1 }, "inside-border"],
    ["fill", { layoutSizingHorizontal: "fill" }, "dynamic-size"],
    ["center", { constraintHorizontal: "center" }, "constraint"],
    ["left", { constraintLeft: 20 }, "constraint-offset"],
    ["margin", { layoutMarginBefore: "auto" }, "layout-margin"],
    ["text", { type: "text" }, "unsupported-type"],
    ["negative-world", { x: -.5 }, "negative-world-phase-unverified"],
  ];
  const nodes = cases.map(([id, extra]) => shape(id, extra));
  nodes.push(shape("component", { type: "component", layout: "none" }),
    shape("instance", { type: "instance", componentId: "component" }),
    shape("master-child", { parentId: "component" }), shape("rotated-child", { parentId: "rotated" }),
    shape("missing", { parentId: "absent" }), shape("cycle-a", { parentId: "cycle-b" }), shape("cycle-b", { parentId: "cycle-a" }));
  const result = browserPaintBoxes(nodes);
  for (const [id, , reason] of cases) {
    assert.equal(result.nodes.get(id), nodes.find(node => node.id === id));
    assert.equal(result.fallbackReasons.get(id), reason);
  }
  for (const id of ["component", "instance", "master-child", "rotated-child", "missing", "cycle-a", "cycle-b"]) {
    assert.equal(result.nodes.get(id), nodes.find(node => node.id === id));
    assert.ok(result.fallbackReasons.get(id));
  }
  assert.equal(result.stats.changed, 0);
});

test("integral geometry reuses source references and does not quantize radii", () => {
  const node = shape("same", { x: -10, y: 20, width: 10, height: 9, cornerRadii: [1.6, 2.4, 3.3, 4.1] });
  const result = browserPaintBoxes([node]);
  assert.equal(result.nodes.get(node.id), node); assert.equal(result.stats.changed, 0);
  assert.equal(result.stats.eligible, 1);
});


test("per-item LayoutUnit replay exactly matches all 36 frozen Blink flex boxes", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/flex-layout-unit.json", import.meta.url)));
  const source = fixture.rows.map(row => row.node), before = JSON.stringify(source);
  const result = browserPaintBoxes(source);
  for (const { node, dom } of fixture.rows) {
    assert.deepEqual(result.layoutBoxes.get(node.id), dom, node.id);
    if (node.type !== "text") {
      const paint = result.nodes.get(node.id);
      assert.deepEqual([paint.x, paint.y, paint.width, paint.height],
        [Math.round(dom.x), Math.round(dom.y), Math.round(dom.x + dom.width) - Math.round(dom.x), Math.round(dom.y + dom.height) - Math.round(dom.y)], node.id);
    }
  }
  assert.equal(JSON.stringify(source), before);
  assert.equal(result.stats.eligible, 30);
  assert.deepEqual(result.stats.reasons, { "unsupported-type": 6 });
});

test("unsupported flex semantics have explicit fallback and never rewrite saved geometry", () => {
  for (const [extra, reason] of [[{ layout: "grid" }, "grid"], [{ layoutWrap: "wrap" }, "wrap"],
    [{ justifyContent: "space-between" }, "justify-content"], [{ rotation: 2 }, "rotated-container"],
    [{ layoutAlignSelf: "stretch" }, "self-alignment-unverified"]]) {
    const parent = shape("parent", { type: "frame", layout: "horizontal", ...extra });
    const child = shape("child", { parentId: "parent" });
    const result = browserPaintBoxes([parent, child]);
    assert.equal(result.nodes.get(parent.id), parent);
    assert.equal(result.fallbackReasons.get(parent.id), reason);
    assert.equal(result.fallbackReasons.get(child.id), `ancestor:${reason}`);
  }
  const parent = shape("p", { type: "frame", layout: "horizontal", width: 100, height: 50 });
  const fill = shape("grow", { parentId: "p", layoutSizingHorizontal: "fill" });
  const result = browserPaintBoxes([parent, fill]);
  assert.equal(result.fallbackReasons.get(fill.id), "main-axis-flex-grow");
  assert.equal(result.nodes.get(fill.id), fill);
});

test("rotated leaves round translation and local dimensions but retain the LayoutUnit center pivot", () => {
  const source = [shape("rotation", { x: 20.5, y: 25.3, width: 4.2, height: 1.19, rotation: -40 })];
  const before = JSON.stringify(source), result = browserPaintBoxes(source), node = result.nodes.get("rotation");
  assert.deepEqual([node.x, node.y, node.width, node.height], [21, 25, 4, 1]);
  assert.deepEqual(result.layoutBoxes.get("rotation"), { x: 20.5, y: 25.296875, width: 4.1875, height: 1.1875 });
  assert.deepEqual(result.rotationPivots.get("rotation"), { x: 23.09375, y: 25.59375 });
  assert.equal(node.cornerRadius, source[0].cornerRadius);
  assert.equal(JSON.stringify(source), before, "presentation geometry must never write author geometry");
});

test("rotation replay excludes leaf text, children, instances, referenced components and rotated ancestry", () => {
  const source = [
    shape("leaf", { rotation: 40 }),
    shape("parent", { type: "frame", rotation: 40 }),
    shape("nested", { parentId: "parent", rotation: -40 }),
    shape("non-container", { rotation: 40 }),
    shape("child", { parentId: "non-container" }),
    shape("master", { type: "component" }),
    shape("master-leaf", { parentId: "master", rotation: 40 }),
    shape("instance", { type: "instance", componentId: "master", rotation: 40 }),
    shape("text", { type: "text", rotation: 40 }),
  ];
  const result = browserPaintBoxes(source);
  assert.equal(result.rotationPivots.size, 1);
  assert(result.rotationPivots.has("leaf"));
  for (const id of ["parent", "nested", "non-container", "child", "master", "master-leaf", "instance", "text"])
    assert.equal(result.nodes.get(id), source.find(node => node.id === id), id);
  assert.equal(result.fallbackReasons.get("parent"), "rotated-container");
  assert.equal(result.fallbackReasons.get("nested"), "ancestor:rotated-container");
  assert.equal(result.fallbackReasons.get("non-container"), "rotated-container");
  assert.equal(result.fallbackReasons.get("master-leaf"), "ancestor:referenced-component");
  assert.equal(result.fallbackReasons.get("text"), "rotated");
});

test("presentation rotation uses one pivot for forward/inverse corners and clipped hit testing", () => {
  const source = [shape("clip", { type: "frame", x: 20.5, y: 20.5, width: 2, height: 8, cornerRadius: 0, clipContent: true, visible: true, opacity: 1 }),
    shape("leaf", { parentId: "clip", x: 20.8, y: 25.3, width: 4.2, height: 1.19, rotation: -40, cornerRadius: 0, visible: true, opacity: 1 })];
  const before = JSON.stringify(source), paint = browserPaintBoxes(source), nodes = [...paint.nodes.values()], leaf = paint.nodes.get("leaf");
  const index = new Map(nodes.map(node => [node.id, node])), local = { x: leaf.x + .05, y: leaf.y + .05 };
  const world = pointFromNodeSpace(nodes, leaf, local, index, paint.rotationPivots);
  const inverse = pointToNodeSpace(nodes, leaf, world, index, paint.rotationPivots);
  assert(Math.hypot(inverse.x - local.x, inverse.y - local.y) < 1e-12);
  assert.equal(hitTestCanvasNode({ nodes }, world, index, paint.rotationPivots)?.id, "leaf");
  assert.notEqual(hitTestCanvasNode({ nodes }, world, index)?.id, "leaf", "paint-box center is the wrong inverse");
  const corners = transformedNodeCornersInTree(nodes, leaf, index, paint.rotationPivots);
  assert.deepEqual(corners[0], pointFromNodeSpace(nodes, leaf, { x: leaf.x, y: leaf.y }, index, paint.rotationPivots));
  const outsideClip = pointFromNodeSpace(nodes, leaf, { x: leaf.x + leaf.width - .05, y: leaf.y + .5 }, index, paint.rotationPivots);
  assert(outsideClip.x > paint.nodes.get("clip").x + paint.nodes.get("clip").width);
  assert.notEqual(hitTestCanvasNode({ nodes }, outsideClip, index, paint.rotationPivots)?.id, "leaf");
  assert.equal(JSON.stringify(source), before);
});


test("stretch and cross-axis fill use quantized content size, with a strict saved-layout safety guard", () => {
  const parent = shape("p", { type: "frame", layout: "vertical", x: 20, y: 20, width: 10.4, height: 10.4, padding: .17 });
  const child = shape("c", { parentId: "p", x: 20.15625, y: 20.15625, width: 10.078125, height: 2.1, layoutSizingHorizontal: "fill" });
  const fill = browserPaintBoxes([parent, child]);
  assert.equal(fill.layoutBoxes.get("c").width, 10.078125);
  const stretch = browserPaintBoxes([{ ...parent, alignItems: "stretch" }, { ...child, layoutSizingHorizontal: "fixed" }]);
  assert.deepEqual(stretch.layoutBoxes.get("c"), fill.layoutBoxes.get("c"));
  const unsafe = { ...child, x: child.x + .25001 };
  const result = browserPaintBoxes([parent, unsafe]);
  assert.equal(result.fallbackReasons.get("c"), "LAYOUT_MISMATCH");
  assert.equal(result.nodes.get("c"), unsafe);
});
