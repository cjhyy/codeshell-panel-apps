import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { normalizeDesignDocument } from "../../../apps/design-studio/app/document.mjs";

const app = new URL("../../../apps/design-studio/app/", import.meta.url);
const { repairDesignQuality } = process.env.DESIGN_STUDIO_INFINITE_QUALITY_SOURCE
  ? await import("data:text/javascript;base64," + Buffer.from((await readFile(
      process.env.DESIGN_STUDIO_INFINITE_QUALITY_SOURCE, "utf8")).replace(
        /from "(\.\/[^"]+)"/gu, (_, path) => `from "${new URL(path, app).href}"`)).toString("base64"))
  : await import("../../../apps/design-studio/app/quality-repair.mjs");
const node = (id, type, x, y, extra = {}) => ({ id, type, name: id, x, y,
  width: 100, height: 80, fill: "#ffffff", stroke: "transparent", strokeWidth: 0,
  opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false,
  ...(type === "frame" ? { layout: "none", gap: 0, padding: 0, alignItems: "start",
    justifyContent: "start", gridColumns: 1, clipContent: false } : {}), ...extra });
function fixture({ mode = "infinite", x = -250000, y = 300000, parent = {}, child = {} } = {}) {
  return normalizeDesignDocument({ format: "codeshell.design", version: 3,
    name: "Infinite repair case", canvas: { ...(mode ? { mode } : {}),
      width: 600, height: 400, background: "#ffffff" }, tokens: { colors: [] },
    activePageId: "page-1", pages: [{ id: "page-1", name: "Canvas", children: [
      node("frame", "frame", x, y, { ...parent, children: [
        node("child", "rectangle", x + 50, y + 20, { height: 40, fill: "#ff0000", ...child }),
      ] }),
    ] }] });
}

test("repair expands an unclipped distant frame without treating the old canvas as a global boundary", () => {
  const input = fixture(), before = JSON.stringify(input);
  const result = repairDesignQuality(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(result.changes.map(({ kind, nodeId }) => ({ kind, nodeId })),
    [{ kind: "fit-container", nodeId: "frame" }]);
  assert.deepEqual([result.document.nodes[0].x, result.document.nodes[0].y,
    result.document.nodes[0].width, result.document.nodes[0].height], [-250000, 300000, 150, 80]);
  assert.deepEqual(result.document.nodes[1], input.nodes[1]);
  assert.deepEqual(repairDesignQuality(result.document).changes, []);
});

test("infinite repair preserves clipped and locked frame boundaries", () => {
  for (const parent of [{ clipContent: true }, { locked: true }]) {
    const input = fixture({ parent });
    const result = repairDesignQuality(input);
    assert.deepEqual(result.changes, []);
    assert.deepEqual(result.document.nodes, input.nodes);
  }
});

test("infinite repair leaves an expansion beyond the coordinate budget unresolved", () => {
  const input = fixture({ x: -999990, y: 100000, child: { x: -1000000,
    shadow: { x: -50, y: 0, blur: 0, opacity: 1, color: "#000000" } } });
  const result = repairDesignQuality(input);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.document.nodes, input.nodes);
  assert(result.unresolved.some((issue) => issue.nodeId === "child"));
});

test("bounded repair retains its old global canvas boundary guard", () => {
  const input = fixture({ mode: null, x: -100, y: 100 });
  const result = repairDesignQuality(input);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.document.nodes, input.nodes);
  assert(result.unresolved.some((issue) => issue.code === "layout.canvas-overflow"));
});
