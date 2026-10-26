import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launchCanvasBrowser, canvasCsp, canvasContentType, observeCanvasPage, assertCanvasClean,
  waitForCanvas, canvasNodes, assertCanvasNodePainted } from "./canvas-ui-fixture.mjs";

async function openToolbarMenu(page, method = "click") {
  if (await page.locator("#compact-actions").getAttribute("open") === null) {
    await page.locator("#compact-actions summary")[method]();
  }
}
async function toolbarAction(page, selector, method = "click") {
  await openToolbarMenu(page, method);
  await page.locator(selector)[method]();
}

const root = fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url));
const manifest = JSON.parse(await readFile(new URL("../../../apps/design-studio/.codeshell-panel/panel.json", import.meta.url)));

async function fixture(t, connected = false) {
  const browser = await launchCanvasBrowser();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => { try { await assertCanvasClean(page); } finally { await browser.close(); } });
  await observeCanvasPage(page, { offlineTools: !connected });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url()), path = resolve(root, `.${url.pathname}`);
    if (url.origin !== "https://panel.test" || !path.startsWith(root)) return route.abort();
    try { await route.fulfill({ body: await readFile(path), contentType: canvasContentType(path), headers: { "Content-Security-Policy": canvasCsp } }); }
    catch { await route.fulfill({ status: 404, body: "missing" }); }
  });
  if (connected) await page.addInitScript(({ permissions }) => {
    const records = new Map(), files = new Map();
    let listener;
    const context = { busy: false, trusted: true, capabilities: { packageAssets: { wasm: true, fetch: "package" } },
      ...(permissions.includes("context.workspace") ? { cwd: "/workspace" } : {}),
      ...(permissions.includes("context.session") ? { sessionId: "fixture-chat" } : {}),
      availableMethods: ["storage.get", "storage.set", "storage.delete", "workspace.info", "workspace.list", "workspace.readText", "workspace.writeText"],
    };
    window.submissions = [];
    window.tools = {};
    window.codeshellPanel = {
      getContext: async () => ({ ...context }),
      on(name, callback) { if (name === "context.changed") listener = callback; },
      registerTool(name, callback) { window.tools[name] = callback; },
      async call(method, params = {}) {
        if (method === "storage.get") return records.get(params.key) ?? null;
        if (method === "storage.set") { records.set(params.key, params.value); return null; }
        if (method === "storage.delete") { records.delete(params.key); return null; }
        if (method === "workspace.info") return { root: "/workspace", name: "Fixture" };
        if (method === "workspace.list") return { entries: [], truncated: false };
        if (method === "workspace.readText") { if (!files.has(params.path)) throw Error("file missing"); return { content: files.get(params.path), modifiedAt: 1, revision: "test" }; }
        if (method === "workspace.writeText") { files.set(params.path, params.content); return { modifiedAt: 1, revision: "test" }; }
        if (method === "agent.submitPrompt") { window.submissions.push(params); return { accepted: true }; }
        throw Error(`Unavailable ${method}`);
      },
    };
    window.connectAgent = () => { context.availableMethods.push("agent.submitPrompt"); listener?.({ ...context }); };
  }, { permissions: manifest.permissions });
  await page.goto("https://panel.test/index.html");
  await waitForCanvas(page);
  return { page, context, errors };
}

test("mobile browser design still creates, saves, exports SVG and downloads complete backups with an honest offline state", async t => {
  const f = await fixture(t);
  assert.match(await f.page.locator("#host-connection-state").textContent(), /浏览器本地模式/);
  assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth), 390);
  await f.page.locator('[data-tool="rectangle"]').tap();
  await f.page.waitForFunction(() => document.querySelector('[data-tool="rectangle"]').getAttribute("aria-pressed") === "true");
  const stage = await f.page.locator("#stage").boundingBox();
  assert.ok(stage.width >= 340 && stage.height >= 500);
  const cdp = await f.context.newCDPSession(f.page);
  await cdp.send("Input.synthesizeScrollGesture", { x: stage.x + 70, y: stage.y + 140, xDistance: 100, yDistance: 80, gestureSourceType: "touch", preventFling: true });
  assert.equal((await canvasNodes(f.page)).length, 1);
  await assertCanvasNodePainted(f.page, (await canvasNodes(f.page))[0]);
  await toolbarAction(f.page, "#save", "tap");
  await f.page.waitForFunction(() => document.querySelector("#save-state").textContent === "已保存");
  await toolbarAction(f.page, "#export-svg", "tap");
  await f.page.waitForFunction(() => document.querySelector("#toast").textContent.includes("SVG 已导出"));
  assert.match(await f.page.evaluate(async () => { const {createBrowserStore}=await import("/browser-store.mjs"); return (await createBrowserStore().call("workspace.readText",{path:"designs/design.svg"})).content; }), /<svg/);
  await toolbarAction(f.page, "#portable-backup-open", "tap");
  const downloading = f.page.waitForEvent("download");
  await f.page.locator("#portable-backup-export").tap();
  const backup = JSON.parse(await readFile(await (await downloading).path(), "utf8"));
  assert.equal(backup.format, "codeshell.design.portable-backup");
  await f.page.keyboard.press("Escape");
  await f.page.locator("#open-ai").tap();
  assert.equal(await f.page.locator("#submit-ai").isDisabled(), true);
  assert.match(await f.page.locator("#ai-context-state").textContent(), /未连接/);
  await f.page.keyboard.press("Escape");
  await f.page.reload();
  await waitForCanvas(f.page);
  assert.equal((await canvasNodes(f.page)).length, 1);
  await assertCanvasNodePainted(f.page, (await canvasNodes(f.page))[0]);
  assert.deepEqual(f.errors, []);
});

test("a connected Host lacking Agent capability preserves design actions and only enables real submission after capability discovery", async t => {
  assert.ok(manifest.permissions.includes("context.session"));
  const f = await fixture(t, true);
  assert.match(await f.page.locator("#host-connection-state").textContent(), /未提供可提交/);
  assert.equal(await f.page.locator("#save").isEnabled(), true);
  await f.page.locator("#open-ai").tap();
  assert.equal(await f.page.locator("#submit-ai").isDisabled(), true);
  assert.deepEqual(await f.page.evaluate(() => window.submissions), []);
  await f.page.evaluate(() => window.connectAgent());
  assert.equal(await f.page.locator("#submit-ai").isEnabled(), true);
  assert.equal(await f.page.locator("#host-connection-state").isVisible(), false);
  await f.page.locator("#ai-request").fill("核对这个空白设计的布局");
  await f.page.locator("#submit-ai").tap();
  await f.page.waitForFunction(() => window.submissions.length === 1);
  assert.deepEqual(f.errors, []);
});
