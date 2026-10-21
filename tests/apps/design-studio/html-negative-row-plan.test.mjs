import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { planHtmlNegativeRow } from "../../../apps/design-studio/app/html-negative-row-plan.mjs";
import { planHtmlBlockFlow } from "../../../apps/design-studio/app/html-block-flow.mjs";
import { validateLayoutSpacing } from "../../../apps/design-studio/app/layout-spacing.mjs";

const load = async (width = 1280) => {
  const fixture = JSON.parse(await readFile(new URL(`../../fixtures/design-studio/html-negative-row-plan/features-${width}.json`, import.meta.url), "utf8"));
  const nodes = new Map(), tokens = new Map();
  const token = (id) => id === null ? null : tokens.get(id) ?? (tokens.set(id, {}), tokens.get(id));
  const visit = (node) => { nodes.set(node.id, node); for (const child of node.children ?? []) visit(child); };
  visit(fixture.root);
  const captures = new Map(fixture.captures.map(({ nodeId, ...value }) => [nodes.get(nodeId), { ...value,
    semantic: nodes.get(nodeId).semantic, element: token(value.element), parentElement: token(value.parentElement), children: value.children.map(token) }]));
  return { root: fixture.root, parent: nodes.get(fixture.parentId), row: nodes.get(fixture.rowId), captures, fixture };
};
const run = ({ root, parent, row, captures }) => planHtmlNegativeRow({ root, parent, row, captures });
const frozen = (value, seen = new Set()) => {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value); for (const item of Object.values(value)) frozen(item, seen); return Object.freeze(value);
};
const style = (value, node, key, next) => { value.captures.get(node).css[key] = next; if (Object.hasOwn(node.cssLayout, key)) node.cssLayout[key] = next; };

test("actual Features captures prove exact current source boxes, ownership and auto-margin decomposition at three widths", async () => {
  const expected = [
    [1280, 1140, 509.78125, 70, 1140, 79.390625, 1116, 382.390625, 358.390625],
    [768, 720, 919.875, 24, 720, 74.71875, 696, 797.15625, 773.15625],
    [400, 400, 1048, 0, null, 70.75, 376, 929.25, 905.25],
  ];
  for (const [width, parentWidth, parentHeight, auto, maximumWidth, y, rowWidth, rowHeight, netHeight] of expected) {
    const value = await load(width), before = JSON.stringify(value.root);
    frozen(value.root); for (const capture of value.captures.values()) frozen(capture);
    const plan = run(value);
    assert.equal(plan.status, "source-proven"); assert.equal(plan.activation, "blocked");
    assert.deepEqual(plan.dependencies, ["NATIVE_NEGATIVE_GAP_HUG_UNVERIFIED", "ROW_INNER_FLOW_UNCHANGED"]);
    assert.equal(plan.parent, value.parent); assert.equal(plan.row, value.row);
    assert.equal(plan.rowSourceId, value.row.id); assert.equal(plan.rowSemantic, value.row.semantic);
    assert.equal(plan.remove[0], value.parent.children[1]);
    assert.deepEqual(plan.retain, [value.parent.children[0], value.row]);
    assert.deepEqual(plan.resolved.row, { x: 12, y, width: rowWidth, height: rowHeight });
    assert.equal(plan.resolved.gap, -16); assert.equal(plan.resolved.parentWidth, parentWidth); assert.equal(plan.resolved.parentHeight, parentHeight);
    assert.deepEqual(plan.resolved.padding, { top: 48, right: 24, bottom: 48, left: 24 });
    assert.deepEqual(plan.resolved.rebasedPadding, { top: 48, right: 12, bottom: 48, left: 12 });
    assert.deepEqual(plan.resolved.headingInsets, { left: 12, right: 12 });
    assert.deepEqual(plan.resolved.placeholderContribution, { width: rowWidth - 24, height: netHeight });
    assert.deepEqual(plan.resolved.autoMargins, { left: auto, right: auto, ownerContentWidth: width, maximumWidth });
    assert.equal(JSON.stringify(value.root), before, "no source graph, identity, sizing or geometry mutation");
    assert.equal(value.fixture.sourcePixels.changed, 0); assert.equal(value.fixture.sourcePixels.max, 0);
    assert.equal(value.fixture.captureCallbackCount, 201, "corrects the earlier prose-only176 count; original capture receipt already says201");
  }
});

test("only the unique current pinned placeholder is removable; names, cloned identities and stale bounds are insufficient", async () => {
  const changes = [
    (v) => { v.parent.children[1].bounds.height += 1 / 1024; },
    (v) => { v.parent.children[1].bounds.width -= 1 / 1024; },
    (v) => { v.parent.children[1].bounds.x += 1 / 1024; },
    (v) => { v.parent.children[1].bounds.y -= 1 / 1024; },
    (v) => { v.parent.children[1].name = "other-placeholder"; },
    (v) => { v.parent.children[1].id = "foreign-placeholder"; },
    (v) => { v.parent.children[1].semantic = { semanticId: "real DOM node named neg-margin-placeholder" }; },
    (v) => { v.parent.children[1].children.push({ id: "foreign", bounds: { x: 0, y: 0 }, children: [] }); },
    (v) => { v.parent.children[1].background.layers.push({ color: "red" }); },
    (v) => { v.parent.children[1].opacity = 1; },
    (v) => { v.parent.children[1].border.top.width = 1; },
    (v) => { v.parent.children[1].effects.filters = []; },
    (v) => { v.parent.children[1].rawStyles = {}; },
    (v) => { v.parent.children[1].visible = false; },
    (v) => { v.parent.children[1].positioning.mode = "absolute"; },
    (v) => { v.parent.children.splice(1, 0, structuredClone(v.parent.children[1])); },
    (v) => { v.row = structuredClone(v.row); },
    (v) => { v.captures.get(v.row).semantic = structuredClone(v.row.semantic); },
    (v) => { v.row.semantic.semanticId = "foreign-row-id"; },
    (v) => { v.row.id = "foreign-source-id"; },
    (v) => { v.captures.get(v.row).bounds.x += 1 / 1024; },
    (v) => { v.captures.get(v.row).parentElement = {}; },
    (v) => { v.captures.get(v.parent).children.reverse(); },
    (v) => { v.captures.get(v.parent.children[0]).element = v.captures.get(v.row).element; },
    (v) => { const foreign = structuredClone(v.row); v.captures.set(foreign, { ...v.captures.get(v.row), semantic: foreign.semantic }); },
  ];
  for (const change of changes) {
    const value = await load(); change(value); const before = JSON.stringify(value.root);
    assert.equal(run(value).status, "unsupported", change.toString());
    assert.equal(JSON.stringify(value.root), before);
  }
});

test("relative units, layout effects, positioned sources and unsupported ancestor/auto-margin contexts refuse", async () => {
  const changes = [
    (v) => { style(v, v.row, "margin-top", "calc(-24px)"); },
    (v) => { style(v, v.row, "margin-left", "-3%"); },
    (v) => { style(v, v.row, "margin-right", "auto"); },
    (v) => { style(v, v.row, "margin-bottom", "8px"); },
    (v) => { style(v, v.row, "margin-top", "-2px"); },
    (v) => { style(v, v.row, "position", "absolute"); },
    (v) => { style(v, v.row, "position", "relative"); },
    (v) => { style(v, v.row, "transform", "matrix(1,0,0,1,0,1)"); },
    (v) => { style(v, v.row, "scale", "2"); },
    (v) => { style(v, v.row, "rotate", "1deg"); },
    (v) => { style(v, v.row, "zoom", "2"); },
    (v) => { style(v, v.row, "overflow-x", "hidden"); },
    (v) => { style(v, v.parent, "box-shadow", "rgb(0,0,0) 1px 1px"); },
    (v) => { style(v, v.parent, "contain", "size"); },
    (v) => { style(v, v.parent, "height", "509.78125px"); },
    (v) => { style(v, v.row, "width", "100%"); },
    (v) => { style(v, v.row, "max-width", "1116px"); },
    (v) => { style(v, v.parent, "margin-right", "0px"); },
    (v) => { style(v, v.parent, "max-width", "50%"); },
    (v) => { style(v, v.parent, "padding-left", "5px"); v.parent.layout.padding.left = 5; },
    (v) => { style(v, v.root, "translate", "1px"); },
    (v) => { v.row.transform = { rotation: 10 }; },
    (v) => { v.row.visible = false; },
    (v) => { v.parent.visible = false; },
    (v) => { v.parent.children[0].visible = false; },
    (v) => { v.root.visible = false; },
    (v) => { style(v, v.row, "visibility", "hidden"); },
    (v) => { style(v, v.parent, "visibility", "hidden"); },
    (v) => { style(v, v.root, "visibility", "hidden"); },
    (v) => { v.captures.get(v.parent).nonblankDirectText = true; },
    (v) => { v.captures.get(v.row).beforeContent = "\"generated\""; },
    (v) => { v.parent.cssLayout["margin-left"] = "0px"; },
    (v) => { const wrapper = v.root.children[0].children[0]; wrapper.layout.padding.left = 69; },
    (v) => { const wrapper = v.root.children[0].children[0]; wrapper.name = "lookalike"; },
  ];
  for (const change of changes) {
    const value = await load(); change(value); const before = JSON.stringify(value.root);
    assert.equal(run(value).status, "unsupported", change.toString()); assert.equal(JSON.stringify(value.root), before);
  }
});

test("current object ownership, dense graph and count/depth budgets fail boundedly", async () => {
  assert.deepEqual(planHtmlNegativeRow(), { status: "unsupported", code: "INVALID_CAPTURE" });
  for (const kind of ["cycle", "alias", "duplicate-id", "sparse", "count", "depth"]) {
    const value = await load();
    if (kind === "cycle") value.row.children = [value.root];
    if (kind === "alias") value.row.children = [value.parent.children[0]];
    if (kind === "duplicate-id") value.row.children = [{ id: value.parent.id, bounds: { x: 0, y: 0 } }];
    if (kind === "sparse") value.row.children = Array(2);
    if (kind === "count") value.row.children = Array(10001);
    if (kind === "depth") { let inner = value.row; for (let i = 0; i < 32; i++) { const child = { id: `extra-${i}`, bounds: { x: 0, y: 0 }, children: [] }; inner.children = [child]; inner = child; } }
    assert.equal(run(value).status, "unsupported", kind);
  }
});

test("reopening a source projection preserves exact proof but never activates existing percentage/wrap or Hug guards", async () => {
  const value = await load(), reopened = await load();
  assert.deepEqual(run(value).resolved, run(reopened).resolved);
  assert.deepEqual([run(value).rowSourceId, run(value).parentSourceId], [run(reopened).rowSourceId, run(reopened).parentSourceId]);
  assert.ok(planHtmlBlockFlow(value.parent).unsupported, "existing adapter block planner remains closed");
  assert.throws(() => validateLayoutSpacing({ type: "frame", layout: "vertical", layoutSizingVertical: "hug", layoutWrap: "none", gap: -16 }), /Hug|HUG|hug/u);
  assert.equal(run(value).activation, "blocked");
});
