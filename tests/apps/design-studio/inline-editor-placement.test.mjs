import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { inlineTextEditorPlacement, canvasNodeMatrix } from "../../../apps/design-studio/app/canvas-interaction.mjs";

/* Real Host, DPR2 (coverage-matrix, cov-dpr2-d): the editor was placed by one fractional matrix
 * (261.6, 206.6) and drew its glyphs 1 device px above the canvas/HTML text, whose node origin is laid
 * out (and snapped) before the camera transform. */
const node = { id: "inter-bytes", type: "text", x: 250.3, y: 44.3, width: 200, height: 28, rotation: 0 };
const map = (placement, [qx, qy]) => { const [a, b, c, d, e, f] = placement.matrix;
  const x = placement.left + qx, y = placement.top + qy; // transform-origin 0 0 at the laid-out box
  return [placement.left + a * qx + c * qy + e, placement.top + b * qx + d * qy + f, x, y]; };

test("axis-aligned editors take the node origin as layout left/top and only the camera as transform", () => {
  const pan = { x: 11.3, y: 162.3 };
  const placement = inlineTextEditorPlacement(canvasNodeMatrix(node, [node], pan, 1), pan, 1);
  assert.deepEqual([placement.left, placement.top], [250.3, 44.3]);
  assert.deepEqual(placement.matrix, [1, 0, 0, 1, 11.3, 162.3]);
  // Same screen mapping as before at any zoom: screen = pan + zoom * (origin + local).
  for (const zoom of [0.785, 2]) {
    const before = canvasNodeMatrix(node, [node], pan, zoom), placed = inlineTextEditorPlacement(before, pan, zoom);
    for (const local of [[0, 0], [37.5, 12.25], [200, 28]]) {
      const [sx, sy] = map(placed, local);
      assert.ok(Math.abs(sx - (before[4] + zoom * local[0])) < 1e-9 && Math.abs(sy - (before[5] + zoom * local[1])) < 1e-9);
    }
  }
});

test("rotated or skewed chains keep the existing single matrix", () => {
  const rotated = { ...node, rotation: 30 }, pan = { x: 11.3, y: 162.3 };
  const matrix = canvasNodeMatrix(rotated, [rotated], pan, 1);
  assert.deepEqual(inlineTextEditorPlacement(matrix, pan, 1), { left: 0, top: 0, matrix });
});

test("the editor uses the placement and the canvas/HTML font smoothing (not the app chrome's antialiased)", async () => {
  const app = await readFile(new URL("../../../apps/design-studio/app/app.js", import.meta.url), "utf8");
  assert.match(app, /inlineTextEditorPlacement\(matrix, pan, zoom\)/);
  const css = await readFile(new URL("../../../apps/design-studio/app/style.css", import.meta.url), "utf8");
  const rule = css.slice(css.indexOf(".inline-text-editor {"), css.indexOf("}", css.indexOf(".inline-text-editor {")));
  assert.match(rule, /-webkit-font-smoothing:\s*auto/);
});
