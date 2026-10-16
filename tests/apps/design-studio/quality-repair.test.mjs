import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { repairDesignQuality } from "../../../apps/design-studio/app/quality-repair.mjs";

const node = (id, type, extra = {}) => ({ id, type, name: id, x: 50, y: 50,
  width: 100, height: 40, fill: "#ffffff", stroke: "transparent", strokeWidth: 0,
  opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false, ...extra });
const text = (extra = {}) => node("copy", "text", { x: 100, y: 60, width: 100, height: 20,
  text: "Readable", fontFamily: "Arial", fontSize: 14, fontWeight: 400,
  lineHeight: 1.2, textAlign: "left", fill: "#cccccc", ...extra });
const source = (extra = {}, copy = {}) => normalizeDesignDocument({ format: "codeshell.design",
  version: 3, name: "Quality repair", canvas: { width: 600, height: 400, background: "#ffffff" },
  tokens: { colors: [] }, activePageId: "page-1", pages: [{ id: "page-1", name: "Home", children: [
    node("card", "frame", { layout: "none", gap: 0, padding: 0, alignItems: "start",
      justifyContent: "start", gridColumns: 1, clipContent: false, ...extra, children: [text(copy)] }),
  ] }] });

test("explicit repair preserves text and positions, fits an unclipped container and minimally adjusts foreground", () => {
  const input = source(), previous = JSON.stringify(input);
  const result = repairDesignQuality(input);
  assert.equal(JSON.stringify(input), previous);
  assert.equal(result.before.issueCount, 2);
  assert.equal(result.after.issueCount, 0);
  assert.deepEqual(result.changes.map(change => change.kind), ["fit-container", "text-contrast"]);
  const [card, copy] = result.document.nodes;
  assert.equal(card.width, 150);
  assert.deepEqual([copy.x, copy.y, copy.text, copy.fontSize], [100, 60, "Readable", 14]);
  assert.notEqual(copy.fill, "#000000");
  assert.ok(result.changes[1].ratioAfter >= 4.495);
  assert.equal(repairDesignQuality(result.document).changes.length, 0);
});

test("repair leaves intentional clipping and locked content to the user and reports unresolved issues", () => {
  const input = source({ clipContent: true, locked: true }, { locked: true });
  const result = repairDesignQuality(input);
  assert.equal(result.changes.length, 0);
  assert.equal(result.document.nodes[0].width, 100);
  assert.ok(result.unresolved.some(issue => issue.blocking));
});

test("repair keeps a gradient's stops and alpha rather than replacing artwork with a solid color", () => {
  const paints = [{ type: "GRADIENT_LINEAR", opacity: 0.8,
    handles: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, { x: 0, y: 1 }],
    stops: [{ position: 0, color: "#dddddd", opacity: 1 }, { position: 1, color: "#eeeeee", opacity: 1 }] }];
  const result = repairDesignQuality(source({ width: 200 }, { fillPaints: paints }));
  assert.deepEqual(result.document.nodes[1].fillPaints, paints);
  assert.ok(result.unresolved.some(issue => issue.code === "a11y.text-contrast"));
});
