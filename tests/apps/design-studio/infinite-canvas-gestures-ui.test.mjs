import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { fixture } from "./autosave-ui.fixture.mjs";
import { board, shape, infiniteViewport } from "./infinite-canvas.fixture.mjs";
import { canvasPoint, viewport, frames } from "./fixtures/canvas-test-observations.mjs";

function source(children) {
  return serializeDesignDocument(normalizeDesignDocument({ format: "codeshell.design", version: 3,
    name: "World coordinate safety", canvas: { mode: "infinite", width: 800, height: 600,
      background: "#e8e8e8" }, tokens: { colors: [] }, resources: [], activePageId: "page-1",
    pages: [{ id: "page-1", name: "World", children }] }));
}
async function setup(t, children = []) {
  const sourceOverrides = new Map();
  if (process.env.DESIGN_STUDIO_INFINITE_GESTURE_APP_JS)
    sourceOverrides.set("app.js", await readFile(process.env.DESIGN_STUDIO_INFINITE_GESTURE_APP_JS, "utf8"));
  const f = await fixture(t, { initialSource: source(children), sourceOverrides, gpu: true });
  await f.page.setViewportSize(infiniteViewport);
  await f.page.waitForFunction(() => document.querySelector("#stage-wrap")?.dataset.gpuActive === "true");
  await frames(f.page);
  return f;
}
const node = (f, id) => f.page.evaluate(id => window.tools.get_design_context({ node_id: id }).then(result => result.node), id);
const nodes = async f => normalizeDesignDocument((await f.page.evaluate(() => window.tools.get_design_context())).document).nodes;
async function select(f, id) {
  await f.page.locator(`#layers-list [data-id='${id}']`).click();
  await frames(f.page);
}
async function keyboardFocus(f) { await f.page.locator(".brand").click(); }
const near = (actual, expected) => assert(Math.abs(actual - expected) < 0.05, `${actual} != ${expected}`);

test("property position changes reject the whole frame move when a descendant exceeds the coordinate budget", async t => {
  const f = await setup(t, [board("frame", 999800, 40, "#ffffff", [
    shape("child", 999950, 90, 50, 50, "#ff0000"),
  ])]);
  const before = await nodes(f);
  await select(f, "frame");
  await f.page.locator("#prop-x").fill("999900");
  await f.page.locator("#prop-x").press("Tab");
  assert.deepEqual(await nodes(f), before);
  assert.equal(await f.page.locator("#prop-x").inputValue(), "999800");
  assert.deepEqual(f.errors, []);
});

test("pointer dragging rejects a frame and all descendants atomically at the world coordinate limit", async t => {
  const f = await setup(t, [board("frame", 999800, 40, "#ffffff", [
    shape("child", 999950, 90, 50, 50, "#ff0000"),
  ])]);
  const before = await nodes(f), v = await viewport(f.page);
  const p = await canvasPoint(f.page, { x: 999820, y: 60 });
  await f.page.mouse.move(p.x, p.y); await f.page.mouse.down();
  await f.page.mouse.move(p.x + 100 * v.zoom, p.y); await f.page.mouse.up();
  assert.deepEqual(await nodes(f), before);
  assert.deepEqual(f.errors, []);
});

test("keyboard nudges preserve every node when one moved descendant reaches the budget", async t => {
  const f = await setup(t, [board("frame", 999850, 40, "#ffffff", [
    shape("child", 1000000, 90, 50, 50, "#ff0000"),
  ])]);
  const before = await nodes(f);
  await select(f, "frame"); await keyboardFocus(f); await f.page.keyboard.press("ArrowRight");
  assert.deepEqual(await nodes(f), before);
  assert.deepEqual(f.errors, []);
});

test("nudges beneath a rotated ancestor keep the existing encoded-coordinate transform", async t => {
  const inner = board("inner", 999010, 999010, "#ffffff", [
    shape("child", 999020, 999020, 30, 30, "#ff0000"),
  ]);
  inner.width = 100; inner.height = 100; inner.rotation = 30;
  const outer = board("outer", 999000, 999000, "#ffffff", [inner]); outer.rotation = 90;
  const f = await setup(t, [outer]);
  await select(f, "inner"); await keyboardFocus(f); await f.page.keyboard.press("ArrowRight");
  const moved = await node(f, "inner"), child = await node(f, "child");
  near(moved.x, 999010); near(moved.y, 999009);
  near(child.x, 999020); near(child.y, 999019);
  assert.deepEqual(f.errors, []);
});

test("creation outside the coordinate budget leaves the document unchanged", async t => {
  const f = await setup(t);
  const stage = await f.page.locator("#stage").boundingBox();
  await f.page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await f.page.mouse.wheel(2000000, 0); await frames(f.page);
  await f.page.locator("[data-tool='rectangle']").click();
  await f.page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
  assert.equal((await nodes(f)).length, 0);
  assert.deepEqual(f.errors, []);
});

test("creation at low zoom caps node dimensions without allocating an oversized design node", async t => {
  const f = await setup(t);
  const stage = await f.page.locator("#stage").boundingBox();
  const p = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };
  await f.page.mouse.move(p.x, p.y);
  await f.page.keyboard.down("Control"); await f.page.mouse.wheel(0, 3000); await f.page.keyboard.up("Control");
  await frames(f.page);
  assert((await viewport(f.page)).zoom <= 0.001);
  await f.page.locator("[data-tool='rectangle']").click();
  await f.page.mouse.move(p.x, p.y); await f.page.mouse.down();
  await f.page.mouse.move(p.x + 50, p.y + 40); await f.page.mouse.up();
  const [created] = await nodes(f);
  assert.equal(created.width, 20000); assert.equal(created.height, 20000);
  assert(Math.abs(created.x) <= 1000000 && Math.abs(created.y) <= 1000000);
  assert.deepEqual(f.errors, []);
});

test("resizing toward an out-of-budget origin retains the last valid rectangle", async t => {
  const original = shape("rectangle", -999990, 50, 100, 100, "#315fda");
  const f = await setup(t, [original]);
  await select(f, original.id);
  const p = await canvasPoint(f.page, { x: original.x, y: original.y }), v = await viewport(f.page);
  await f.page.mouse.move(p.x, p.y); await f.page.mouse.down();
  await f.page.mouse.move(p.x - 50 * v.zoom, p.y - 20 * v.zoom); await f.page.mouse.up();
  assert.deepEqual(await nodes(f), [original]);
  assert.deepEqual(f.errors, []);
});

test("auto-layout property changes roll back attributes and child geometry together without adding an invalid undo step", async t => {
  const frame = board("frame", 999800, 40, "#ffffff", [
    shape("child", 999810, 50, 50, 50, "#ff0000"),
  ]);
  frame.layout = "horizontal"; frame.padding = 10;
  const f = await setup(t, [frame]);
  await select(f, "frame");
  await f.page.locator("#prop-name").fill("Valid title");
  await f.page.locator("#prop-name").press("Tab");
  const before = await nodes(f);
  await f.page.locator("#prop-layout-padding").fill("900");
  await f.page.locator("#prop-layout-padding").press("Tab");
  assert.deepEqual(await nodes(f), before);
  assert.equal(await f.page.locator("#prop-layout-padding").inputValue(), "10");
  assert.match(await f.page.locator("#toast").textContent(), /范围|尺寸/u);
  await keyboardFocus(f); await f.page.keyboard.press("Control+z");
  assert.equal((await node(f, "frame")).name, "frame");
  assert.equal((await node(f, "frame")).padding, 10);
  assert.equal((await node(f, "child")).x, 999810);
  assert.deepEqual(f.errors, []);
});

test("a valid intermediate property edit remains undoable after a rejected edit in the same focus session", async t => {
  const frame = board("frame", 999800, 40, "#ffffff", [
    shape("child", 999810, 50, 50, 50, "#ff0000"),
  ]);
  frame.layout = "horizontal"; frame.padding = 10;
  const f = await setup(t, [frame]);
  await select(f, "frame");
  const padding = f.page.locator("#prop-layout-padding");
  await padding.fill("20");
  assert.equal((await node(f, "child")).x, 999820);
  await padding.fill("900");
  assert.equal((await node(f, "frame")).padding, 20);
  assert.equal((await node(f, "child")).x, 999820);
  await padding.press("Tab");
  await keyboardFocus(f); await f.page.keyboard.press("Control+z");
  assert.equal((await node(f, "frame")).padding, 10);
  assert.equal((await node(f, "child")).x, 999810);
  assert.deepEqual(f.errors, []);
});

test("resizing an auto-layout frame rejects the entire gesture when final reflow would move a child beyond the budget", async t => {
  const frame = board("frame", 999800, 40, "#ffffff", [
    shape("child", 999900, 40, 50, 50, "#ff0000"),
  ]);
  frame.width = 150; frame.layout = "horizontal"; frame.justifyContent = "end";
  const f = await setup(t, [frame]);
  await select(f, "frame");
  await f.page.locator("#prop-name").fill("Before rejected resize");
  await f.page.locator("#prop-name").press("Tab");
  const before = await nodes(f), v = await viewport(f.page);
  const p = await canvasPoint(f.page, { x: 999950, y: 240 });
  await f.page.mouse.move(p.x, p.y); await f.page.mouse.down();
  await f.page.mouse.move(p.x + 200 * v.zoom, p.y); await f.page.mouse.up();
  assert.deepEqual(await nodes(f), before);
  await keyboardFocus(f); await f.page.keyboard.press("Control+z");
  assert.equal((await node(f, "frame")).name, "frame");
  assert.equal((await node(f, "frame")).width, 150);
  assert.equal((await node(f, "child")).x, 999900);
  assert.deepEqual(f.errors, []);
});
