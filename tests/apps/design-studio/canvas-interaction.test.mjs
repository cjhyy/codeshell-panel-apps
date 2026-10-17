import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canvasNodeMatrix,
  canvasResizeHandles,
  hitTestCanvasHandle,
  hitTestCanvasNode,
} from "../../../apps/design-studio/app/canvas-interaction.mjs";

const node = (id, extra = {}) => ({
  id,
  type: "rectangle",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  visible: true,
  opacity: 1,
  rotation: 0,
  cornerRadius: 0,
  ...extra,
});
test("canvas hit testing respects front order, hidden ancestors, rotated clips and elliptical corners", () => {
  const back = node("back", { width: 300, height: 300 }),
    frame = node("frame", { type: "frame", x: 50, y: 50, clipContent: true });
  const child = node("child", { parentId: "frame", x: 100, y: 100, width: 150, height: 150 });
  const ellipse = node("ellipse", { type: "ellipse", x: 200, y: 20, width: 80, height: 80 });
  const design = { nodes: [back, frame, child, ellipse] };
  assert.equal(hitTestCanvasNode(design, { x: 120, y: 120 }).id, "child");
  assert.equal(hitTestCanvasNode(design, { x: 170, y: 170 }).id, "back");
  assert.equal(hitTestCanvasNode(design, { x: 201, y: 21 }).id, "back");
  assert.equal(hitTestCanvasNode(design, { x: 240, y: 60 }).id, "ellipse");
  frame.visible = false;
  assert.equal(hitTestCanvasNode(design, { x: 120, y: 120 }).id, "back");
  frame.visible = true;
  frame.rotation = 90;
  assert.equal(hitTestCanvasNode(design, { x: 70, y: 120 }).id, "child");
  assert.equal(hitTestCanvasNode(design, { x: 120, y: 170 }).id, "back");
});

test("canvas editor affine transform includes viewport, parent rotation and child origin", () => {
  const parent = node("parent", { rotation: 90 }),
    child = node("child", { parentId: "parent", x: 20, y: 30, width: 10, height: 10 });
  const [a, b, c, d, e, f] = canvasNodeMatrix(child, [parent, child], { x: 10, y: 20 }, 2);
  assert(Math.abs(a) < 1e-10 && Math.abs(d) < 1e-10);
  assert.equal(b, 2);
  assert.equal(c, -2);
  assert.equal(e, 150);
  assert.equal(f, 60);
});

test("canvas resize handles preserve screen hit size and disable rotated/locked resizing", () => {
  const n = node("n"),
    options = { zoom: 0.5, nodes: [n], tool: "select" };
  const handles = canvasResizeHandles(n, options);
  assert.equal(handles.length, 4);
  assert.equal(hitTestCanvasHandle({ x: 9, y: 9 }, handles, 0.5), "nw");
  assert.equal(hitTestCanvasHandle({ x: 20, y: 20 }, handles, 0.5), undefined);
  assert.equal(hitTestCanvasHandle({ x: 20, y: 20 }, handles, 0.5, true), "nw");
  assert.equal(canvasResizeHandles(n, { ...options, locked: true }).length, 0);
  n.rotation = 15;
  assert.equal(canvasResizeHandles(n, options).length, 0);
});
