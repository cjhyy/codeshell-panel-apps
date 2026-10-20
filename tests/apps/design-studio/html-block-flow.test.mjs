import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProductionFidelity } from "../../../scripts/design-studio-production-fidelity.mjs";
import { normalizeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { designNodeToV3 } from "../../../apps/design-studio/app/design-node-adapter.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";

test("block recovery preserves source ownership and both coordinate contracts, and diagnoses floats", async () => {
  const source = (rootRelative) => ({
    nodeType: "container", name: "root", semantic: { attributes: { id: "root" } },
    bounds: { x: 100, y: 200, width: 200, height: 100 },
    cssLayout: { width: "200px", height: "100px" },
    layout: { display: "block", padding: { top: 10, right: 10, bottom: 10, left: 10 } },
    children: [{
      nodeType: "container", name: "child", semantic: { attributes: { id: "child" } },
      bounds: { x: rootRelative ? 110 : 10, y: rootRelative ? 210 : 10, width: 180, height: 20 },
      cssLayout: { width: "auto", height: "20px", float: "none" },
      layout: { display: "block" }, children: [],
    }],
  });
  const freeze = (value) => {
    for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child);
    return Object.freeze(value);
  };
  const outputs = [];
  for (const rootRelative of [false, true]) {
    const tree = freeze(source(rootRelative)), before = JSON.stringify(tree);
    const result = await designNodeToV3(tree, {
      coordinateSpace: rootRelative ? "root-relative" : "parent-relative",
    });
    assert.equal(JSON.stringify(tree), before);
    const value = normalizeDesignDocument(result.document);
    assert.equal(value.nodes[0].layout, "vertical");
    applyAllAutoLayouts(value.nodes);
    outputs.push(value.nodes.map((node) => [node.id, node.x, node.y, node.width, node.height]));
  }
  assert.deepEqual(outputs[0], outputs[1]);
  assert.deepEqual(outputs[0].map((node) => node.slice(1)), [[0, 0, 200, 100], [10, 10, 180, 20]]);
  const floated = source(false);
  floated.children[0].cssLayout.float = "left";
  const result = await designNodeToV3(floated);
  assert.equal(normalizeDesignDocument(result.document).nodes[0].layout, "none");
  assert(result.report.warnings.some((warning) => ["block-flow-fixed","float-flow-fixed"].includes(warning.code)));
});

test("ordinary block stacks retain collapsed margins, nested Hug/Fill and exact pixels after resize", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-block-flow-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const result = await runProductionFidelity({
    output,
    cases: [
      {
        id: "collapsed-margins",
        html: '<main id="fixture"><div id="first"></div><div id="second"></div><div id="last"></div></main>',
        css: "#fixture{display:block;width:100%;height:240px;padding:20px;background:#e2e8f0}#first{height:40px;margin-bottom:12px;background:#2563eb}#second{height:50px;margin-top:20px;margin-bottom:8px;background:#f97316}#last{height:30px;margin-top:4px;background:#16a34a}",
      },
      {
        id: "nested-text",
        html: '<main id="fixture"><section id="card"><h1>Editable blocks</h1><p id="copy">Text wraps across ordinary block flow when the parent frame becomes narrower.</p><div id="last"></div></section></main>',
        css: "#fixture{display:block;width:100%;height:240px;padding:20px;background:#e2e8f0}#card{padding:12px;background:white}h1,p{margin:0;font:20px/24px Arial}h1{margin-bottom:12px}p{margin-top:6px;margin-bottom:16px}#last{height:20px;background:#2563eb}",
      },
      {
        id: "block-auto-margins",
        html: '<main id="fixture"><section id="card"><div></div></section></main>',
        css: "#fixture{display:block;width:100%;height:240px;padding:20px;background:#e2e8f0}#card{width:100%;max-width:480px;height:80px;margin:0 auto;background:#2563eb}#card div{height:20px}",
      },
      {
        id: "block-auto-overflow",
        html: '<main id="fixture"><div id="card"></div></main>',
        css: "#fixture{display:block;width:100%;height:240px;padding:20px;background:#e2e8f0}#card{width:760px;height:80px;margin:0 auto;background:#2563eb}",
      },
    ],
  });
  for (const observed of result.cases) {
    assert.deepEqual(observed.semanticIssues, [], observed.id);
    assert.deepEqual(observed.warnings, [], observed.id);
    assert.ok(observed.comparisons.every((value) => value.changedPixels === 0),
      JSON.stringify({ id: observed.id, comparisons: observed.comparisons }));
    const design = normalizeDesignDocument(JSON.parse(
      await readFile(join(output, observed.id, "imported.codesign.json")),
    ));
    const byId = (id) => design.nodes.find((node) =>
      JSON.parse(node.notes ?? "{}").attributes?.id === id && node.type === "frame");
    assert.equal(byId("fixture").layout, "vertical");
    assert.ok(design.nodes.every((node) => node.layoutPositioning !== "absolute"));
    if (observed.id === "nested-text") {
      assert.equal(byId("card").layout, "vertical");
      assert.equal(byId("card").layoutSizingHorizontal, "fill");
      assert.equal(byId("card").layoutSizingVertical, "hug");
      assert.equal(byId("copy").layoutSizingVertical, "hug");
    }
  }
  assert.equal(result.passed, true);
});

test("relative-layer flow recovery keeps the original identity and requires a unique measured placeholder", async () => {
  const child = (id, y) => ({
    nodeType: "container", name: id, semantic: { attributes: { id } },
    bounds: { x: 10, y, width: 180, height: 20 },
    layout: { display: "block" }, cssLayout: { width: "auto", height: "20px" }, children: [],
  });
  const relative = child("relative", 10);
  relative.positioning = { mode: "absolute" };
  relative.cssLayout.position = "relative";
  const placeholder = { nodeType: "container", name: "z-index-placeholder", opacity: 0,
    bounds: { ...relative.bounds }, layout: { display: "block" }, children: [] };
  const source = { nodeType: "container", name: "root", bounds: { x: 0, y: 0, width: 200, height: 100 },
    cssLayout: { width: "200px", height: "100px" },
    layout: { display: "block", padding: { top: 10, right: 10, bottom: 10, left: 10 } },
    children: [placeholder, child("following", 40), relative] };
  const before = JSON.stringify(source);
  const captured = await designNodeToV3(source);
  assert.equal(JSON.stringify(source), before);
  const value = normalizeDesignDocument(captured.document);
  const recovered = value.nodes.find((node) => JSON.parse(node.notes ?? "{}").attributes?.id === "relative");
  assert.equal(recovered.id, "html-0-2");
  assert.notEqual(recovered.layoutPositioning, "absolute");
  applyAllAutoLayouts(value.nodes);
  assert.deepEqual([recovered.x, recovered.y, recovered.width, recovered.height], [10, 10, 180, 20]);
  assert.equal(value.nodes.some((node) => node.name === "z-index-placeholder"), false);
  const ambiguous = structuredClone(source);
  ambiguous.children.push(structuredClone(relative));
  const fallback = await designNodeToV3(ambiguous);
  assert(fallback.report.warnings.some((warning) => warning.code === "block-flow-fixed"));
  assert.equal(normalizeDesignDocument(fallback.document).nodes[0].layout, "none");
  const repeated = { ...source, children: [...source.children, relative] };
  await assert.rejects(() => designNodeToV3(repeated), /重复引用/u);
});
