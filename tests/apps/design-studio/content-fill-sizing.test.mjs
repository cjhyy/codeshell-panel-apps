import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importFigmaJson } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { runProductionFidelity } from "../../../scripts/design-studio-production-fidelity.mjs";

function design(axis = "horizontal", size = 640) {
  const source = { id: "0:1", type: "CANVAS", name: "Content Fill", children: [{
    id: "1:1", type: "FRAME", name: "Parent", layoutMode: axis.toUpperCase(),
    absoluteBoundingBox: { x: 0, y: 0, width: axis === "horizontal" ? size : 140, height: axis === "vertical" ? size : 140 },
    paddingTop: 8, paddingRight: 8, paddingBottom: 8, paddingLeft: 8, itemSpacing: 12,
    fills: [], children: [8, 20].map((padding, index) => ({
      id: `1:${index + 2}`, type: "FRAME", name: `Child ${index}`, layoutMode: "HORIZONTAL",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      layoutSizingHorizontal: axis === "horizontal" ? "FILL" : "FIXED",
      layoutSizingVertical: axis === "vertical" ? "FILL" : "FIXED",
      paddingTop: padding, paddingRight: padding, paddingBottom: padding, paddingLeft: padding,
      fills: [], children: [],
    })),
  }] };
  return importFigmaJson(source).document;
}

test("Fill siblings divide content space before restoring their own effective padding", () => {
  for (const axis of ["horizontal", "vertical"]) for (const size of [640, 400]) {
    const value = design(axis, size), [parent, first, second] = value.nodes;
    applyAllAutoLayouts(value.nodes);
    const dimension = axis === "horizontal" ? "width" : "height";
    const position = axis === "horizontal" ? "x" : "y";
    assert.deepEqual([first[dimension], second[dimension]], size === 640 ? [294, 318] : [174, 198]);
    assert.equal(first[dimension] - 16, second[dimension] - 40);
    assert.equal(first[position], 8);
    assert.equal(second[position] + second[dimension], parent[dimension] - 8);
    const saved = normalizeDesignDocument(JSON.parse(serializeDesignDocument(value)));
    assert.equal(applyAllAutoLayouts(saved.nodes), false, "save/reopen must retain the settled layout");
  }
});

test("content Fill redistribution honors outer min/max, asymmetric insets, and inactive children", () => {
  for (const axis of ["horizontal", "vertical"]) for (const [limit, amount, expected] of [["max", 200, [200, 412]], ["min", 320, [320, 292]]]) {
    const value = design(axis), [parent, first, second] = value.nodes;
    first[`${limit}${axis === "horizontal" ? "Width" : "Height"}`] = amount;
    value.nodes.push({ ...structuredClone(first), id: "hidden", visible: false }, { ...structuredClone(first), id: "absolute", layoutPositioning: "absolute" });
    applyAllAutoLayouts(value.nodes);
    const dimension = axis === "horizontal" ? "width" : "height";
    assert.deepEqual([first[dimension], second[dimension]], expected);
    assert.equal(first.parentId, parent.id);
  }
  const value = design(), [, first, second] = value.nodes;
  first.paddingLeft = 3; first.paddingRight = 13;
  second.paddingLeft = 7; second.paddingRight = 33;
  applyAllAutoLayouts(value.nodes);
  assert.deepEqual([first.width, second.width], [294, 318]);
  first.maxWidth = 0;
  assert.throws(() => normalizeDesignDocument(JSON.parse(serializeDesignDocument(value))), /maxWidth/u, "zero limits remain invalid rather than falling back to a default");
  const competing = design(), [, a, b] = competing.nodes;
  a.minWidth = 300; b.maxWidth = 100;
  applyAllAutoLayouts(competing.nodes);
  assert.deepEqual([a.width, b.width], [512, 100], "a minimum must remain flexible when the sibling maximum releases more space");
});

test("physical Auto Layout padding floors outer size without rewriting authored maximums", () => {
  for (const axis of ["horizontal", "vertical"]) {
    const dimension = axis === "horizontal" ? "width" : "height", maximum = axis === "horizontal" ? "maxWidth" : "maxHeight";
    const value = design(axis), [, first, second] = value.nodes;
    second[maximum] = 1;
    applyAllAutoLayouts(value.nodes);
    assert.deepEqual([first[dimension], second[dimension]], [572, 40]);
    assert.equal(second[maximum], 1);
    first[maximum] = 1;
    applyAllAutoLayouts(value.nodes);
    assert.deepEqual([first[dimension], second[dimension]], [16, 40]);
    const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(value)));
    assert.equal(reopened.nodes[2][maximum], 1);
    assert.equal(applyAllAutoLayouts(reopened.nodes), false);
    delete first[maximum]; delete second[maximum]; value.nodes[0][dimension] = 60;
    applyAllAutoLayouts(value.nodes);
    assert.deepEqual([first[dimension], second[dimension]], [16, 40], "padding overflows rather than becoming negative content");
    first[`layoutSizing${axis === "horizontal" ? "Horizontal" : "Vertical"}`] = "fixed";
    first[dimension] = 1;
    applyAllAutoLayouts(value.nodes);
    assert.equal(first[dimension], 16, "fixed Auto Layout boxes also retain their physical padding");
    first[dimension] = 20000; first[maximum] = 20000;
    second.visible = false;
    applyAllAutoLayouts(value.nodes);
    assert.equal(first[dimension], 20000);
    assert.doesNotThrow(() => normalizeDesignDocument(JSON.parse(serializeDesignDocument(value))));
  }
});

test("inside borders on leaf rectangles contribute their verified CSS content basis", () => {
  for (const axis of ["horizontal", "vertical"]) {
    const value = design(axis), [, first, second] = value.nodes;
    for (const [node, strokeWidth] of [[first, 4], [second, 8]]) {
      Object.assign(node, { type: "rectangle", stroke: "#dc2626", strokeWidth, strokeAlign: "inside" });
      for (const key of ["layout", "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]) delete node[key];
    }
    applyAllAutoLayouts(value.nodes);
    const dimension = axis === "horizontal" ? "width" : "height";
    assert.deepEqual([first[dimension], second[dimension]], [302, 310]);
    for (const node of [first, second]) node.strokeAlign = "outside";
    applyAllAutoLayouts(value.nodes);
    assert.deepEqual([first[dimension], second[dimension]], [306, 306]);
  }
});

test("production HTML unequal Fill padding and borders stay exact through viewport resize and reopen", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "content-fill-sizing-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const html = '<main id="fixture"><section id="a" class="tile"><div class="inner"></div></section><section id="b" class="tile"><div class="inner"></div></section></main>';
  const css = '#fixture{display:flex;width:100%;height:140px;padding:8px;gap:12px;align-items:flex-start;justify-content:flex-start;background:#f1f5f9}.tile{display:flex;flex:1 1 0;min-width:0;height:100px;align-items:flex-start;justify-content:flex-start;background:#f1f5f9}.inner{flex:1 1 0;min-width:0;height:20px;background:#2563eb}#a{padding:8px}#b{padding:20px}';
  const result = await runProductionFidelity({ output, resizeMode: "viewport-only", cases: [
    { id: "padding", html, css },
    { id: "padding-and-border", html, css: css + '#a{border:4px solid #dc2626}#b{border:8px solid #dc2626}' },
    { id: "maximum", html, css: css + '#a{max-width:200px}' },
    { id: "minimum", html, css: css + '#a{min-width:320px}' },
    { id: "physical-floor", html, css: css + '#a{background:#bae6fd}#b{max-width:1px;background:#fecaca}.inner{display:none}' },
  ] });
  assert.equal(result.passed, true, JSON.stringify(result.cases));
  for (const observed of result.cases) {
    assert.ok(observed.comparisons.every((comparison) => comparison.changedPixels === 0));
    const imported = normalizeDesignDocument(JSON.parse(await readFile(join(output, observed.id, "imported.codesign.json"), "utf8")));
    const narrow = normalizeDesignDocument(JSON.parse(await readFile(join(output, observed.id, "narrow.codesign.json"), "utf8")));
    const children = (value) => value.nodes.filter((node) => ["section#a", "section#b"].includes(node.name));
    const expected = { padding: [174, 198], "padding-and-border": [170, 202], maximum: [174, 198], minimum: [320, 52], "physical-floor": [332, 40] };
    assert.deepEqual(children(narrow).map((node) => node.width), expected[observed.id]);
    assert.ok(children(imported).every((node) => node.layoutSizingHorizontal === "fill"));
    assert.ok(narrow.nodes.every((node) => node.layoutPositioning !== "absolute"));
    const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(narrow)));
    assert.equal(applyAllAutoLayouts(reopened.nodes), false);
    assert.deepEqual(children(reopened).map((node) => node.width), children(narrow).map((node) => node.width));
  }
});
