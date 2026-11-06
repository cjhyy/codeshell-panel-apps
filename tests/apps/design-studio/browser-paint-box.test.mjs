import assert from "node:assert/strict";
import { test } from "node:test";
import { browserPaintBoxes } from "../../../apps/design-studio/app/canvas/browser-paint-box.mjs";

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
  assert.equal(result.fallbackReasons.get("flow"), "flow-owned");
});

test("unsafe constraints, transforms, borders and instance ancestry retain original references with reasons", () => {
  const cases = [
    ["rotated", { rotation: 1 }, "rotated"], ["sides", { strokeSides: [] }, "stroke-sides"],
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
