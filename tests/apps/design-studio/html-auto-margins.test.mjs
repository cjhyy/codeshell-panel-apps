import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProductionFidelity } from "../../../scripts/design-studio-production-fidelity.mjs";
import { normalizeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { designNodeToV3 } from "../../../apps/design-studio/app/design-node-adapter.mjs";

test("auto-margin wrapper recovery preserves coordinate contracts and validates the original graph", async () => {
  const child = {
    nodeType: "container",
    name: "item",
    tag: "div",
    bounds: { x: 25, y: 37, width: 120, height: 80 },
    semantic: { attributes: { id: "item" } },
    layout: { display: "block" },
    children: [],
    cssLayout: {
      "margin-left": "auto",
      "margin-right": "0px",
      "margin-top": "0px",
      "margin-bottom": "0px",
    },
  };
  const wrapper = {
    nodeType: "container",
    name: "margin-wrapper",
    tag: "div",
    bounds: { x: 20, y: 30, width: 200, height: 100 },
    layout: { display: "flex", flex: { direction: "row" } },
    children: [child],
  };
  const root = {
    nodeType: "container",
    name: "root",
    tag: "main",
    bounds: { x: 0, y: 0, width: 400, height: 240 },
    layout: { display: "flex", flex: { direction: "row" } },
    children: [wrapper],
  };
  const before = JSON.stringify(root);
  for (const [coordinateSpace, expected] of [
    ["parent-relative", [45, 67]],
    ["root-relative", [25, 37]],
  ]) {
    const result = await designNodeToV3(root, { coordinateSpace });
    const node = normalizeDesignDocument(result.document).nodes.find(
      (value) => JSON.parse(value.notes ?? "{}").attributes?.id === "item",
    );
    assert.deepEqual([node.x, node.y], expected);
  }
  assert.equal(JSON.stringify(root), before);
  await assert.rejects(designNodeToV3({ ...root, children: [wrapper, wrapper] }), /重复引用/u);
  let nested = child;
  for (let i = 0; i < 33; i++) nested = { ...wrapper, children: [nested] };
  await assert.rejects(designNodeToV3(nested), /超过 32 层/u);
});

test("CSS flex auto margins retain native alignment and exact pixels after resize", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-auto-margins-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const cases = [
    ["both-axes", "row", "margin:auto", "center", "center"],
    ["main-before", "row", "margin-left:auto", "end", "start"],
    ["main-after", "row", "margin-right:auto", "start", "start"],
    ["cross-before", "row", "margin-top:auto", "start", "end"],
    ["cross-after", "row", "margin-bottom:auto", "start", "start"],
    ["reverse-both", "row-reverse", "margin:auto", "center", "center"],
    ["reverse-before", "row-reverse", "margin-left:auto", "start", "start"],
    ["column-both", "column", "margin:auto", "center", "center"],
    ["column-cross-before", "column", "margin-left:auto", "start", "end"],
    ["bounded-fill", "row", "margin:auto;width:100%;max-width:320px", "center", "center"],
    [
      "cross-overflow-both",
      "row",
      "margin-top:auto;margin-bottom:auto;height:300px",
      "start",
      "center",
    ],
    ["cross-overflow-before", "row", "margin-top:auto;height:300px", "start", "end"],
    ["column-cross-overflow", "column", "margin-left:auto;width:700px", "start", "end"],
    ["cross-fill", "row", "margin-top:auto;margin-bottom:auto;height:100%", "start", "center"],
  ];
  const result = await runProductionFidelity({
    output,
    cases: cases.map(([id, direction, margin]) => ({
      id,
      source: `<!doctype html><style>*{box-sizing:border-box}html,body{margin:0;background:white}#fixture{display:flex;flex-direction:${direction};align-items:stretch;justify-content:space-between;width:100%;height:240px;padding:20px;background:#e2e8f0}#item{width:120px;height:80px;background:#2563eb;${margin}}</style><main id="fixture"><div id="item"></div></main>`,
    })),
  });
  for (const [id, direction, margin, justify, align] of cases) {
    const observed = result.cases.find((value) => value.id === id);
    assert.deepEqual(observed.semanticIssues, [], id);
    assert.equal(
      observed.warnings.some((value) => value.code === "layout-margin-fixed"),
      false,
      id,
    );
    assert.ok(
      observed.comparisons.every((value) => value.changedPixels === 0),
      JSON.stringify({ id, comparisons: observed.comparisons }),
    );
    const design = normalizeDesignDocument(
      JSON.parse(await readFile(join(output, id, "imported.codesign.json"))),
    );
    const parent = design.nodes.find(
      (node) => JSON.parse(node.notes ?? "{}").attributes?.id === "fixture",
    );
    const child = design.nodes.find(
      (node) => JSON.parse(node.notes ?? "{}").attributes?.id === "item",
    );
    assert.equal(parent.layout, direction.startsWith("row") ? "horizontal" : "vertical", id);
    if (
      (margin.includes("left") && direction === "column") ||
      margin.startsWith("margin:auto") ||
      margin.includes("top") ||
      margin.includes("bottom")
    ) {
      const wrapper = design.nodes.find((node) => node.id === child.parentId);
      assert.equal(wrapper.layout, direction.startsWith("row") ? "vertical" : "horizontal", id);
      assert.equal(wrapper.justifyContent, align, id);
      assert.equal(
        wrapper.layoutSizingVertical,
        direction.startsWith("row") ? "fill" : child.layoutSizingVertical,
        id,
      );
      assert.equal(child.layoutAlignSelf, "start", id);
    }
    if (
      margin.startsWith("margin:auto") ||
      (direction.startsWith("row") && /left|right/u.test(margin))
    )
      assert.equal(parent.justifyContent, justify, id);
    if (id === "bounded-fill") {
      assert.equal(child.layoutSizingHorizontal, "fill");
      assert.equal(child.maxWidth, 320);
    }
    assert.notEqual(child.layoutPositioning, "absolute", id);
    assert.notEqual(child.layoutMarginBefore, "auto", id);
  }
  assert.equal(result.passed, true);
});
