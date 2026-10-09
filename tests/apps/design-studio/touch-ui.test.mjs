import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url));

async function fixture(t, width = 390, touch = true) {
  const files = new Map(), records = new Map();
  const server = createServer(async (request, response) => {
    const path = resolve(root, `.${new URL(request.url, "http://test").pathname}`);
    if (!path.startsWith(root)) return response.writeHead(403).end();
    try {
      const bytes = await readFile(path.endsWith(sep) ? resolve(path, "index.html") : path);
      response.writeHead(200, {
        "content-type": { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" }[extname(path)] ?? "application/octet-stream",
      }).end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const context = await browser.newContext({
    viewport: { width, height: 844 }, hasTouch: touch, isMobile: touch,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.exposeFunction("hostBridge", async (method, params = {}) => {
    if (method === "workspace.info") return { cwd: "/test-project", name: "test-project" };
    if (method === "workspace.list") return { entries: [], truncated: false };
    if (method === "workspace.readText") {
      if (!files.has(params.path)) throw Error("file missing");
      return { content: files.get(params.path), modifiedAt: 1, revision: "test-revision" };
    }
    if (method === "workspace.writeText") {
      files.set(params.path, params.content);
      return { modifiedAt: 1, revision: "test-revision" };
    }
    if (method === "storage.get") return records.get(params.key) ?? null;
    if (method === "storage.set") return records.set(params.key, params.value), null;
    if (method === "storage.getSnapshot") return {
      exists: records.has(params.key), value: records.get(params.key) ?? null, revision: records.has(params.key) ? "stored" : null,
    };
    if (method === "storage.compareAndSet") {
      if (params.remove) records.delete(params.key);
      else records.set(params.key, params.value);
      return { updated: true, snapshot: { exists: !params.remove, value: params.value ?? null, revision: params.remove ? null : "stored" } };
    }
    throw Error(`Unsupported ${method}`);
  });
  await page.addInitScript(() => {
    window.tools = {};
    window.codeshellPanel = {
      getContext: async () => ({ cwd: "/test-project", trusted: true, busy: false, sessionId: "test", availableMethods: ["storage.getSnapshot", "storage.compareAndSet"] }),
      call: (method, params) => window.hostBridge(method, params),
      on: () => {},
      registerTool: (name, callback) => { window.tools[name] = callback; },
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.waitForFunction(() => !document.querySelector(".workspace").inert);
  const cdp = await context.newCDPSession(page);
  const sendTouch = async (type, points = []) => {
    await cdp.send("Input.dispatchTouchEvent", {
      type, touchPoints: points.map(point => ({ ...point, radiusX: 3, radiusY: 3 })),
    });
    await page.evaluate(() => new Promise(requestAnimationFrame));
  };
  const design = () => page.evaluate(() => window.tools.get_design_context({}));
  const menu = async action => {
    await page.locator("#compact-actions summary").tap();
    await page.locator(`[data-toolbar-action="${action}"]`).tap();
  };
  return { page, files, errors, sendTouch, design, menu };
}

async function drawRectangle(f) {
  await f.page.locator('[data-tool="rectangle"]').tap();
  const stage = await f.page.locator("#stage").boundingBox();
  const start = { x: stage.x + 65, y: stage.y + 120, id: 1 };
  await f.sendTouch("touchStart", [start]);
  await f.sendTouch("touchMove", [{ ...start, x: start.x + 110, y: start.y + 90 }]);
  await f.sendTouch("touchEnd");
  return f.page.locator("#stage [data-node-id]").first();
}

async function nodeCenter(node) {
  const box = await node.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
}

test("320–680px touch workspaces retain a usable canvas, drawers and every design action", async t => {
  for (const width of [320, 390, 620, 680]) {
    await t.test(`${width}px`, async t => {
      const f = await fixture(t, width);
      const stage = await f.page.locator("#stage").boundingBox();
      assert.ok(stage.width >= width - 50, `canvas was only ${stage.width}px wide`);
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth), width);
      await drawRectangle(f);
      await f.page.locator("#toggle-layers").tap();
      assert.equal(await f.page.locator("#layers-sidebar").isVisible(), true);
      await f.page.locator(".layer-visibility").tap();
      assert.equal(await f.page.locator(".layer-row").getAttribute("data-hidden"), "true");
      await f.page.locator(".layer-visibility").tap();
      await f.page.locator("#toggle-inspector").tap();
      assert.equal(await f.page.locator("#inspector").isVisible(), true);
      assert.equal(await f.page.locator("#layers-sidebar").isVisible(), false);
      await f.page.locator("#close-inspector").tap();
      assert.equal(await f.page.locator("#inspector").isVisible(), false);
      for (const [action, dialog] of [["open-files", "files-dialog"], ["open-html-import", "html-import-dialog"], ["open-shortcuts", "shortcuts-dialog"], ["portable-backup-open", "portable-backup-dialog"], ["run-audit", "audit-dialog"]]) {
        await f.menu(action);
        await f.page.locator(`#${dialog}[open]`).waitFor();
        await f.page.keyboard.press("Escape");
      }
      await f.menu("open-delivery");
      assert.equal(await f.page.locator('[data-tab="delivery"]').getAttribute("aria-selected"), "true");
      assert.equal(await f.page.locator("#inspector").isVisible(), true);
      await f.page.locator("#close-inspector").tap();
      await f.menu("export-svg");
      await f.page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("SVG 已导出"));
      assert.match(f.files.get("designs/design.svg"), /<svg/);
      assert.deepEqual(f.errors, []);
    });
  }
});

test("a second touch cannot move or finish the pointer that owns a drag", async t => {
  const f = await fixture(t);
  const node = await drawRectangle(f);
  const originalX = Number(await f.page.locator("#prop-x").inputValue());
  const first = await nodeCenter(node), second = { x: first.x + 60, y: first.y + 100, id: 2 };
  await f.sendTouch("touchStart", [first]);
  await f.sendTouch("touchStart", [first, second]);
  await f.sendTouch("touchMove", [first, { ...second, x: second.x + 60 }]);
  assert.equal(Number(await f.page.locator("#prop-x").inputValue()), originalX);
  await f.sendTouch("touchEnd", [{ ...second, x: second.x + 60 }]);
  await f.sendTouch("touchMove", [{ ...first, x: first.x + 70 }]);
  assert.notEqual(Number(await f.page.locator("#prop-x").inputValue()), originalX);
  await f.sendTouch("touchEnd");
  await f.page.locator("#stage").focus();
  await f.page.keyboard.press("Control+z");
  assert.equal(Number(await f.page.locator("#prop-x").inputValue()), originalX);
  assert.deepEqual(f.errors, []);
});

test("native touch cancellation rolls back create, move, resize and pan without adding undo history", async t => {
  const f = await fixture(t);
  const node = await drawRectangle(f);
  const before = await f.design();
  const center = await nodeCenter(node);
  const originalX = await f.page.locator("#prop-x").inputValue();
  await f.sendTouch("touchStart", [center]);
  await f.sendTouch("touchMove", [{ ...center, x: center.x + 50, y: center.y + 30 }]);
  assert.notEqual(await f.page.locator("#prop-x").inputValue(), originalX);
  await f.sendTouch("touchCancel");
  assert.deepEqual(await f.design(), before);

  const handle = await f.page.locator('[data-handle="se"]').last().boundingBox();
  const corner = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2, id: 1 };
  const originalWidth = await f.page.locator("#prop-width").inputValue();
  await f.sendTouch("touchStart", [corner]);
  await f.sendTouch("touchMove", [{ ...corner, x: corner.x + 30, y: corner.y + 40 }]);
  assert.notEqual(await f.page.locator("#prop-width").inputValue(), originalWidth);
  await f.sendTouch("touchCancel");
  assert.deepEqual(await f.design(), before);

  await f.page.locator('[data-tool="rectangle"]').tap();
  const creation = { x: center.x, y: center.y + 200, id: 1 };
  await f.sendTouch("touchStart", [creation]);
  await f.sendTouch("touchMove", [{ ...creation, x: creation.x + 50, y: creation.y + 30 }]);
  assert.equal(await f.page.locator("#stage rect[data-node-id]").count(), 2);
  await f.sendTouch("touchCancel");
  assert.deepEqual(await f.design(), before);

  const transform = await f.page.locator("#scene").getAttribute("transform");
  await f.page.locator('[data-tool="hand"]').tap();
  await f.sendTouch("touchStart", [center]);
  await f.sendTouch("touchMove", [{ ...center, x: center.x + 50, y: center.y + 30 }]);
  assert.notEqual(await f.page.locator("#scene").getAttribute("transform"), transform);
  await f.sendTouch("touchCancel");
  assert.equal(await f.page.locator("#scene").getAttribute("transform"), transform);
  await f.page.locator("#stage").focus();
  await f.page.keyboard.press("Control+z");
  assert.equal(await f.page.locator("#stage [data-node-id]").count(), 0);
  await drawRectangle(f);
  assert.equal(await f.page.locator("#stage rect[data-node-id]").count(), 1);
  assert.deepEqual(f.errors, []);
});

test("desktop keeps its visible tools and mouse gestures also roll back on lost capture", async t => {
  const f = await fixture(t, 1280, false);
  for (const selector of ["#open-files", "#open-html-import", "#open-delivery", "#export-svg", "#layers-sidebar", "#inspector"]) {
    assert.equal(await f.page.locator(selector).isVisible(), true);
  }
  assert.equal(await f.page.locator("#compact-actions").isVisible(), false);
  assert.equal(await f.page.locator("#toggle-layers").isVisible(), false);
  await f.page.locator('[data-tool="rectangle"]').click();
  const stage = await f.page.locator("#stage").boundingBox();
  await f.page.mouse.move(stage.x + 80, stage.y + 100);
  await f.page.mouse.down();
  await f.page.mouse.move(stage.x + 180, stage.y + 180);
  await f.page.evaluate(() => {
    const stage = document.querySelector("#stage");
    stage.releasePointerCapture(1);
  });
  await f.page.mouse.move(stage.x + 190, stage.y + 190);
  await f.page.mouse.up();
  assert.equal(await f.page.locator("#stage [data-node-id]").count(), 0);
  assert.deepEqual(f.errors, []);
});
