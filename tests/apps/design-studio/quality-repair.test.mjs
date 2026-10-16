import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { repairDesignQuality } from "../../../apps/design-studio/app/quality-repair.mjs";
import {
  currentTextMetrics,
  textMetricsSignature,
} from "../../../apps/design-studio/app/text-metrics.mjs";

const node = (id, type, extra = {}) => ({
  id,
  type,
  name: id,
  x: 50,
  y: 50,
  width: 100,
  height: 40,
  fill: "#ffffff",
  stroke: "transparent",
  strokeWidth: 0,
  opacity: 1,
  rotation: 0,
  cornerRadius: 0,
  visible: true,
  locked: false,
  ...extra,
});
const text = (extra = {}) =>
  node("copy", "text", {
    x: 100,
    y: 60,
    width: 100,
    height: 20,
    text: "Readable",
    fontFamily: "Arial",
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.2,
    textAlign: "left",
    fill: "#cccccc",
    ...extra,
  });
const source = (extra = {}, copy = {}) =>
  normalizeDesignDocument({
    format: "codeshell.design",
    version: 3,
    name: "Quality repair",
    canvas: { width: 600, height: 400, background: "#ffffff" },
    tokens: { colors: [] },
    activePageId: "page-1",
    pages: [
      {
        id: "page-1",
        name: "Home",
        children: [
          node("card", "frame", {
            layout: "none",
            gap: 0,
            padding: 0,
            alignItems: "start",
            justifyContent: "start",
            gridColumns: 1,
            clipContent: false,
            ...extra,
            children: [text(copy)],
          }),
        ],
      },
    ],
  });

test("explicit repair preserves text and positions, fits an unclipped container and minimally adjusts foreground", () => {
  const input = source(),
    previous = JSON.stringify(input);
  const result = repairDesignQuality(input);
  assert.equal(JSON.stringify(input), previous);
  assert.equal(result.before.issueCount, 2);
  assert.equal(result.after.issueCount, 0);
  assert.deepEqual(
    result.changes.map((change) => change.kind),
    ["fit-container", "text-contrast"],
  );
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
  assert.ok(result.unresolved.some((issue) => issue.blocking));
});

test("repair keeps a gradient's stops and alpha rather than replacing artwork with a solid color", () => {
  const paints = [
    {
      type: "GRADIENT_LINEAR",
      opacity: 0.8,
      handles: [
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 },
        { x: 0, y: 1 },
      ],
      stops: [
        { position: 0, color: "#dddddd", opacity: 1 },
        { position: 1, color: "#eeeeee", opacity: 1 },
      ],
    },
  ];
  const result = repairDesignQuality(source({ width: 200 }, { fillPaints: paints }));
  assert.deepEqual(result.document.nodes[1].fillPaints, paints);
  assert.ok(result.unresolved.some((issue) => issue.code === "a11y.text-contrast"));
});

test("all visible siblings contribute to a fit, while hidden siblings leave the result stable", () => {
  const input = source({}, { fill: "#000000" });
  input.nodes.push(
    node("second", "rectangle", { parentId: "card", x: 300, y: 70, width: 80, height: 30 }),
  );
  input.nodes.push(
    node("hidden", "rectangle", { parentId: "card", x: 550, width: 40, visible: false }),
  );
  input.pages[0].nodes = input.nodes;
  const result = repairDesignQuality(input);
  assert.equal(result.document.nodes[0].x + result.document.nodes[0].width, 380);
  assert.equal(result.after.issueCount, 0);
  assert.deepEqual(repairDesignQuality(result.document).changes, []);
});

test("a locked ancestor protects descendant typography and nested containers", () => {
  const input = source({ locked: true }, { locked: false });
  const result = repairDesignQuality(input);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.document.nodes, input.nodes);
  assert.ok(result.unresolved.some((issue) => issue.code === "a11y.text-contrast"));
});

test("fitting below a rotated ancestor does not recenter the inherited transform", () => {
  const input = source({ rotation: 30 }, { fill: "#000000" });
  input.nodes.push(
    node("nested", "frame", {
      parentId: "card",
      x: 60,
      y: 60,
      layout: "none",
      gap: 0,
      padding: 0,
      alignItems: "start",
      justifyContent: "start",
      clipContent: false,
    }),
  );
  input.nodes[1].parentId = "nested";
  input.nodes[1].x = 200;
  input.pages[0].nodes = input.nodes;
  const result = repairDesignQuality(input);
  assert.ok(!result.changes.some((change) => change.kind === "fit-container"));
  for (const node of result.document.nodes) {
    const original = input.nodes.find((candidate) => candidate.id === node.id);
    for (const property of ["x", "y", "width", "height", "rotation"])
      assert.equal(node[property], original[property]);
  }
});

test("a fit reserves visible stroke and shadow extents and remains idempotent", () => {
  const input = source(
    {},
    {
      fill: "#000000",
      stroke: "#000000",
      strokeWidth: 2,
      shadow: { color: "#000000", opacity: 0.5, x: 20, y: 0, blur: 10 },
    },
  );
  const result = repairDesignQuality(input),
    [card, copy] = result.document.nodes;
  assert.ok(card.x + card.width >= copy.x + copy.width + 36);
  assert.ok(card.y <= copy.y - 16);
  assert.ok(card.y + card.height >= copy.y + copy.height + 16);
  assert.deepEqual(copy.shadow, input.nodes[1].shadow);
  assert.deepEqual(repairDesignQuality(result.document).changes, []);
});

test("valid ink receipts avoid padding a tall text box; parent resizing keeps receipts valid and stale text cannot reuse them", () => {
  const input = source({ width: 70 }, { fill: "#000000", height: 100 });
  const copy = input.nodes[1];
  copy.textMetrics = {
    version: 1,
    signature: textMetricsSignature(copy),
    lineWidths: [55],
    lineInkBounds: [{ x: 0, y: 2, width: 55, height: 14 }],
    height: 16,
    fontAvailable: true,
  };
  const result = repairDesignQuality(input);
  assert.equal(result.document.nodes[0].x + result.document.nodes[0].width, 155);
  assert.equal(result.document.nodes[0].height, 40);
  assert.ok(currentTextMetrics(result.document.nodes[1]));
  assert.equal(result.after.issueCount, 0);
  assert.deepEqual(repairDesignQuality(result.document).changes, []);
  result.document.nodes[1].text = "A much longer changed text value";
  assert.equal(currentTextMetrics(result.document.nodes[1]), null);
  assert.ok(
    repairDesignQuality(result.document).unresolved.some(
      (issue) => issue.code === "layout.text-width-overflow",
    ),
  );
});

test("container fitting never introduces a new painted frame outside the canvas", () => {
  const input = source({}, { fill: "#000000", x: 590 });
  const result = repairDesignQuality(input);
  assert.ok(
    result.unresolved.some(
      (issue) => issue.code === "layout.canvas-overflow" && issue.nodeId === "copy",
    ),
  );
  assert.ok(
    !result.unresolved.some(
      (issue) => issue.code === "layout.canvas-overflow" && issue.nodeId === "card",
    ),
  );
  assert.deepEqual(result.changes, []);
});

test("repair does not resize healthy containers merely because an unclipped shadow extends beyond them", () => {
  const input = source(
    {},
    {
      x: 60,
      width: 80,
      fill: "#000000",
      shadow: { color: "#000000", opacity: 0.5, x: 20, y: 0, blur: 10 },
    },
  );
  const result = repairDesignQuality(input);
  assert.equal(result.before.issueCount, 0);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.document.nodes, input.nodes);
});
