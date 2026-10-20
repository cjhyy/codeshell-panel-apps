import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runProductionFidelity } from "../../../scripts/design-studio-production-fidelity.mjs";
import { designNodeToV3 } from "../../../apps/design-studio/app/design-node-adapter.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";

const source = () => ({ nodeType: "container", tag: "main", name: "Root",
  semantic: { semanticId: "root", cssSelector: "#fixture" },
  bounds: { x: 0, y: 0, width: 600, height: 100 },
  positioning: { mode: "static" },
  layout: { display: "flex", flex: { direction: "column", alignItems: "stretch", justifyContent: "start" } },
  cssLayout: { width: "auto", height: "100px", position: "static", "min-width": "0px", "max-width": "none",
    ...Object.fromEntries(["top", "right", "bottom", "left"].map((side) => [`margin-${side}`, "0px"])) }, children: [] });
const relation = { version: 1, x: 20, y: 12, width: 600, height: 100, left: 20, right: 20 };

test("viewport flow requires captured relationships and preserves source identity, legacy and crop contracts", async () => {
  const tree = source(), before = JSON.stringify(tree);
  const options = { viewportWidth: 640, viewportHeight: 240, viewportRelation: relation };
  const captured = await designNodeToV3(tree, options);
  assert.equal(JSON.stringify(tree), before);
  const value = normalizeDesignDocument(captured.document), [viewport, root] = value.nodes;
  assert.equal(viewport.layout, "vertical");
  assert.equal(root.layoutSizingHorizontal, "fill");
  assert.deepEqual([root.x, root.y, root.width], [20, 12, 600]);
  viewport.width = 400;
  applyAllAutoLayouts(value.nodes);
  assert.deepEqual([root.x, root.y, root.width], [20, 12, 360]);
  const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(value)));
  applyAllAutoLayouts(reopened.nodes);
  assert.deepEqual(reopened.nodes.map((node) => [node.id, node.x, node.y, node.width]),
    value.nodes.map((node) => [node.id, node.x, node.y, node.width]));
  assert.equal(captured.mapping[0].semanticId, "root");
  assert.equal(JSON.parse(root.notes).cssSelector, "#fixture");
  const legacy = normalizeDesignDocument((await designNodeToV3(tree, { viewportWidth: 640, viewportHeight: 240 })).document);
  assert.equal(legacy.nodes[0].layout, "none");
  assert.deepEqual([legacy.nodes[1].x, legacy.nodes[1].y], [0, 0]);
  const unwrapped = normalizeDesignDocument((await designNodeToV3(tree, { ...options, includeViewport: false })).document);
  assert.equal(unwrapped.nodes.some((node) => node.id === "html-viewport"), false);
  assert.deepEqual([unwrapped.nodes[0].x, unwrapped.nodes[0].y], [0, 0]);
  const fullHeight = structuredClone(tree);
  fullHeight.bounds = { x: 0, y: 0, width: 640, height: 240 };
  fullHeight.cssLayout.height = "100%";
  const fill = normalizeDesignDocument((await designNodeToV3(fullHeight, {
    ...options, viewportRelation: { ...relation, x: 0, y: 0, width: 640, height: 240,
      left: 0, right: 0, top: 0, bottom: 0, heightFromViewport: true },
  })).document);
  assert.equal(fill.nodes[1].layoutSizingVertical, "fill");
  fill.nodes[0].height = 360;
  applyAllAutoLayouts(fill.nodes);
  assert.equal(fill.nodes[1].height, 360);
  for (const unsupported of [
    { tree: { ...tree, cssLayout: { ...tree.cssLayout, width: "50%" } } },
    { tree: { ...tree, cssLayout: { ...tree.cssLayout, position: "absolute" } } },
    { tree: { ...tree, transform: { rotation: 12 } } },
    { viewportRelation: { ...relation, unsupported: "Selected nested root" } },
    { captureBounds: { left: 10, top: 5, right: 650, bottom: 245 } },
  ]) {
    const result = await designNodeToV3(unsupported.tree ?? tree, { ...options, ...unsupported });
    const document = normalizeDesignDocument(result.document);
    assert.equal(document.nodes[0].layout, "none");
    assert(result.report.warnings.some((warning) => warning.code === "viewport-flow-fixed"));
  }
});

test("only the outer viewport resizes ordinary roots with exact production pixels, editable Fill and saved geometry", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-viewport-flow-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const cases = [
    { id: "block-insets", source: '<!doctype html><style>body{margin:8px;padding:6px 10px;background:white}#fixture{height:150px;padding:12px;background:#e2e8f0}#child{height:50px;background:#2563eb}</style><main id="fixture"><div id="child"></div></main>' },
    { id: "content-box-auto", source: '<!doctype html><style>body{margin:13px;background:white}#fixture{height:100px;padding:10px;border:2px solid transparent;background:#e2e8f0}#child{height:40px;background:#2563eb}</style><main id="fixture"><div id="child"></div></main>' },
    { id: "flex-full", html: '<main id="fixture"><div id="left"></div><div id="fill"></div></main>', css: '#fixture{display:flex;width:100%;height:180px;padding:20px;gap:12px;background:#e2e8f0;align-items:start}#left{width:80px;height:60px;background:#2563eb}#fill{flex:1;height:60px;background:#f97316}' },
    { id: "grid-full", html: '<main id="fixture"><div></div><div></div></main>', css: '#fixture{display:grid;width:100%;height:180px;padding:20px;grid-template-columns:1fr 1fr;grid-template-rows:60px;gap:12px;background:#e2e8f0}#fixture div{background:#2563eb}' },
    { id: "fixed-centered-overflow", source: '<!doctype html><style>body{margin:12px;padding:8px;background:white}#fixture{width:480px;height:120px;margin:0 auto;background:#2563eb}</style><main id="fixture"></main>' },
    { id: "max-width-fill", html: '<main id="fixture"><div></div></main>', css: '#fixture{width:100%;max-width:480px;height:180px;margin:0 auto;padding:20px;background:#e2e8f0}#fixture div{height:50px;background:#2563eb}' },
    { id: "max-content-box-auto", source: '<!doctype html><style>body{margin:8px;background:white}#fixture{max-width:460px;height:100px;padding:10px;border:2px solid transparent;margin:12px auto;background:#e2e8f0}#child{height:40px;background:#2563eb}</style><main id="fixture"><div id="child"></div></main>' },
    { id: "fixed-end", source: '<!doctype html><style>body{margin:13px;background:white}#fixture{width:140px;height:100px;margin-left:auto;background:#2563eb}</style><main id="fixture"></main>' },
    { id: "min-width-overflow", html: '<main id="fixture"><div></div></main>', css: '#fixture{min-width:480px;height:160px;margin:0 auto;padding:20px;background:#e2e8f0}#fixture div{height:50px;background:#2563eb}' },
    { id: "nested-text", html: '<main id="fixture"><section><h1>Editable blocks</h1><p>Text wraps across ordinary block flow when the parent frame becomes narrower.</p></section></main>', css: '#fixture{width:100%;height:240px;padding:20px;background:#e2e8f0}section{padding:12px;background:white}h1,p{margin:0;font:20px/24px Arial}h1{margin-bottom:12px}' },
    { id: "html-root", rootSelector: "html", source: '<!doctype html><style>body{margin:8px;background:white}#fixture{height:120px;background:#2563eb}</style><main id="fixture"></main>' },
    { id: "body-root", rootSelector: "body", source: '<!doctype html><style>body{margin:8px;background:white}#fixture{height:120px;background:#2563eb}</style><main id="fixture"></main>' },
    { id: "viewport-height-body", rootSelector: "body", source: '<!doctype html><style>*{box-sizing:border-box}html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;padding:20px;background:white}#fixture{width:100%;max-width:300px;height:100px;background:#2563eb}</style><main id="fixture"></main>' },
  ];
  const result = await runProductionFidelity({ output, cases, resizeMode: "viewport-only" });
  assert.equal(result.resizeMode, "viewport-only");
  for (const observed of result.cases) {
    assert.deepEqual(observed.semanticIssues, [], observed.id);
    assert(!observed.warnings.some((warning) => warning.code === "viewport-flow-fixed"), JSON.stringify(observed));
    assert(observed.comparisons.every((comparison) => comparison.changedPixels === 0), JSON.stringify(observed));
    const original = normalizeDesignDocument(JSON.parse(await readFile(join(output, observed.id, "imported.codesign.json"), "utf8")));
    const narrow = normalizeDesignDocument(JSON.parse(await readFile(join(output, observed.id, "narrow.codesign.json"), "utf8")));
    const selector = cases.find((fixture) => fixture.id === observed.id).rootSelector ?? "#fixture";
    const root = (document) => document.nodes.find((node) => {
      const semantic = JSON.parse(node.notes ?? "{}");
      return ["html", "body"].includes(selector) ? semantic.tag === selector : semantic.cssSelector === selector;
    });
    assert.equal(original.nodes[0].layout, "vertical");
    assert.equal(original.nodes[0].clipContent, true);
    assert.equal(original.nodes[0].contentClipping, "intentional");
    assert.equal(narrow.nodes[0].width, 400);
    assert.equal(root(original).id, root(narrow).id);
    assert.notEqual(root(narrow).layoutPositioning, "absolute");
    if (observed.id === "viewport-height-body") assert.equal(root(narrow).layoutSizingVertical, "fill");
    if (!["fixed-centered-overflow", "fixed-end"].includes(observed.id)) {
      assert.equal(root(original).layoutSizingHorizontal, "fill");
      assert(root(narrow).width < root(original).width, observed.id);
    }
    const transfer = createFigmaTransfer(narrow), walk = (nodes) => nodes.flatMap((node) => [node, ...walk(node.children ?? [])]);
    const native = walk(transfer.pages[0].children).find((node) => node.id === root(narrow).id);
    assert.equal(native.layoutSizingHorizontal, root(narrow).layoutSizingHorizontal);
    assert.equal(native.width, root(narrow).width);
    assert.equal(native.layout, root(narrow).layout);
  }
  assert.equal(result.passed, true);
});

test("actual unsupported viewport relationships keep measured roots and record strict resize failures honestly", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-viewport-unsupported-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const result = await runProductionFidelity({ output, resizeMode: "viewport-only", recordOnly: true,
    cases: [
      { id: "percent-root", source: '<!doctype html><style>body{margin:0;background:white}#fixture{width:50%;height:120px;background:#2563eb}</style><main id="fixture"></main>' },
      { id: "nested-selection", source: '<!doctype html><style>body{margin:0;background:white}section{padding:20px}#fixture{height:120px;background:#2563eb}</style><section><main id="fixture"></main></section>' },
      { id: "positioned-root", source: '<!doctype html><style>body{margin:0;background:white}#fixture{position:absolute;left:20px;top:10px;width:300px;height:120px;background:#2563eb}</style><main id="fixture"></main>' },
    ],
  });
  assert.equal(result.recordOnly, true);
  assert.equal(result.passed, false, "Recording cannot turn a real resize mismatch into a pass");
  for (const observed of result.cases) {
    assert(observed.warnings.some((warning) => warning.code === "viewport-flow-fixed"), observed.id);
    assert.equal(observed.comparisons[0].changedPixels, 0, observed.id);
    const saved = normalizeDesignDocument(JSON.parse(await readFile(join(output, observed.id, "narrow.codesign.json"), "utf8")));
    assert.equal(saved.nodes[0].layout, "none");
  }
  assert(result.cases[0].comparisons.find((comparison) => comparison.mode === "narrow").changedPixels > 0);
});
