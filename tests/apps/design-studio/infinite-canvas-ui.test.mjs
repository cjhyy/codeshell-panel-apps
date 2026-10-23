import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, initialPath } from "./autosave-ui.fixture.mjs";
import { canvasCaseSource, infiniteViewport } from "./infinite-canvas.fixture.mjs";
import { canvasPoint, viewport, frames, gpuActive } from "./fixtures/canvas-test-observations.mjs";

async function setup(t, options = {}) {
  const f = await fixture(t, {
    gpu: true,
    ...options,
    ...(process.env.DESIGN_STUDIO_INFINITE_OLD_ROOT ? { sourceRoot: process.env.DESIGN_STUDIO_INFINITE_OLD_ROOT } : {}),
  });
  await f.page.setViewportSize(infiniteViewport);
  await f.page.waitForFunction(() => Boolean(window.tools?.get_design_metadata));
  await frames(f.page);
  await gpuActive(f.page);
  return f;
}
const metadata = f => f.page.evaluate(() => window.tools.get_design_metadata());
const node = (f, id) => f.page.evaluate(id => window.tools.get_design_context({ node_id: id }).then(result => result.node), id);
async function saved(f) {
  await f.page.waitForFunction(() => document.querySelector("#save-state").textContent === "已保存", undefined, { timeout: 3500 });
}

test("new documents start on an infinite workspace with no global width or height controls", async t => {
  const f = await setup(t, { blank: true });
  assert.equal((await metadata(f)).canvas.mode, "infinite");
  assert.equal(await f.page.locator("#prop-canvas-width").isVisible(), false);
  assert.equal(await f.page.locator("#prop-canvas-height").isVisible(), false);
  assert.equal(await f.page.locator("#infinite-canvas-hint").isVisible(), true);
  assert.equal(await f.page.locator("#stage-wrap").getAttribute("data-canvas-mode"), "infinite");
  assert.deepEqual(f.errors, []);
});

test("legacy documents upgrade without wrapping or moving layers and the mode change can be undone", async t => {
  const original = canvasCaseSource({ infinite: false });
  const f = await setup(t, { initialSource: original });
  assert.equal((await metadata(f)).canvas.mode, undefined);
  await f.page.locator("#enable-infinite-canvas").click({ timeout: 1500 });
  await saved(f);
  const upgraded = JSON.parse(f.files.get(`/project/A:${initialPath}`));
  assert.equal(upgraded.canvas.mode, "infinite");
  assert.deepEqual(upgraded.pages, JSON.parse(original).pages);
  await f.page.locator(".brand").click(); await f.page.keyboard.press("Control+z");
  assert.equal((await metadata(f)).canvas.mode, undefined);
  await f.page.keyboard.press("Control+Shift+z"); await saved(f);
  await f.page.reload(); await f.page.waitForFunction(() => !document.querySelector(".workspace").inert);
  assert.equal((await metadata(f)).canvas.mode, "infinite");
  assert.deepEqual(JSON.parse(f.files.get(`/project/A:${initialPath}`)).pages, JSON.parse(original).pages);
  assert.deepEqual(f.errors, []);
});

test("independent artboards move with their children, save beyond the old boundary and fit distant positive and negative coordinates", async t => {
  const f = await setup(t, { initialSource: canvasCaseSource() });
  const start = await canvasPoint(f.page, { x: 55, y: 55 });
  const before = await viewport(f.page);
  await f.page.evaluate(() => {
    window.canvasGestureTrace = [];
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"])
      document.addEventListener(type, event => window.canvasGestureTrace.push({ type, target: event.target.id, x: event.clientX, y: event.clientY }), true);
  });
  await f.page.mouse.move(start.x, start.y); await f.page.mouse.down();
  await f.page.mouse.move(start.x + 80, start.y + 40, { steps: 4 }); await f.page.mouse.up();
  const moved = await node(f, "left-board"), child = await node(f, "left-child");
  assert.ok(Math.abs((moved.x - 40) - 80 / before.zoom) < 10, JSON.stringify({ moved, before, start, trace: await f.page.evaluate(() => window.canvasGestureTrace), metadata: await metadata(f) }));
  assert.equal(child.x - moved.x, 40); assert.equal(child.y - moved.y, 50);
  await f.page.locator("#prop-x").fill("-48000"); await f.page.locator("#prop-x").press("Tab");
  await f.page.locator("#prop-y").fill("-700"); await f.page.locator("#prop-y").press("Tab");
  await saved(f);
  const rightRow = f.page.locator("#layers-list [data-id='right-board']");
  await rightRow.click();
  await f.page.locator("#prop-x").fill("64000"); await f.page.locator("#prop-x").press("Tab");
  await saved(f);
  await f.page.locator("#zoom-value").click();
  const view = await viewport(f.page), box = await f.page.locator("#stage").boundingBox();
  for (const id of ["left-board", "right-board"]) {
    const b = await node(f, id);
    assert.ok(view.pan.x + b.x * view.zoom >= 0);
    assert.ok(view.pan.x + (b.x + b.width) * view.zoom <= box.width);
  }
  assert.ok(view.zoom < 0.1);
  assert.notEqual(await f.page.locator("#zoom-value").textContent(), "0%");
  await f.page.reload(); await f.page.waitForFunction(() => !document.querySelector(".workspace").inert);
  assert.equal((await node(f, "left-board")).x, -48000);
  assert.equal((await node(f, "right-board")).x, 64000);
  const audit = await f.page.evaluate(() => window.tools.validate_design());
  assert.equal(audit.issues.some(issue => ["layout.canvas-overflow", "layout.effect-canvas-overflow"].includes(issue.code)), false);
  assert.deepEqual(f.errors, []);
});

test("artboard screenshots retain negative-origin content and padding without allocating a world-sized bitmap", async t => {
  const f = await setup(t, { initialSource: canvasCaseSource({ far: true }) });
  const entire = await f.page.evaluate(() => window.tools.get_design_screenshot({ max_width: 1200 }));
  assert.ok(entire.bounds.x < 0 && entire.bounds.width > 100000);
  assert.ok(entire.width <= 1200 && entire.height <= 4096 && entire.width * entire.height <= 2_000_000);
  const shot = await f.page.evaluate(() => window.tools.get_design_screenshot({ node_id: "left-board", max_width: 320 }));
  assert.equal(shot.nodeId, "left-board");
  assert.ok(shot.bounds.x < -48000 && shot.bounds.y < -700);
  assert.ok(shot.width <= 320 && shot.width * shot.height <= 2_000_000);
  const color = await f.page.evaluate(async shot => {
    const image = new Image(); image.src = `data:${shot.mediaType};base64,${shot.data}`;
    await image.decode(); const c = document.createElement("canvas"); c.width = image.width; c.height = image.height;
    const ctx = c.getContext("2d"); ctx.drawImage(image, 0, 0);
    return [...ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data];
  }, shot);
  assert.ok(Math.abs(color[0] - 226) < 10 && color[1] < 70 && color[2] < 70 && color[3] === 255, String(color));
  assert.deepEqual(f.errors, []);
});
