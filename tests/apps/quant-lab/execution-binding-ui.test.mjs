import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../../apps/quant-lab/app/", import.meta.url));
const manifest = JSON.parse(await readFile(new URL("../../../apps/quant-lab/.codeshell-panel/panel.json", import.meta.url)));

async function fixture(t, { offline = false, deferInitial = false, width = 390 } = {}) {
  const server = createServer(async (request, response) => {
    const path = resolve(root, `.${new URL(request.url, "http://test").pathname}`);
    if (!path.startsWith(root)) return response.writeHead(403).end();
    try {
      response.writeHead(200, { "content-type": { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" }[extname(path)] ?? "application/octet-stream" }).end(await readFile(path));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage(), errors = [], calls = [], projects = new Map();
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  let revision = 0, holdWrite, holdRead;
  const project = id => {
    if (!projects.has(id)) projects.set(id, new Map());
    return projects.get(id);
  };
  if (!offline) {
    await page.exposeFunction("testHost", async (binding, method, params = {}) => {
      calls.push({ ...binding, method, params });
      const records = project(binding.project);
      if (params.key?.startsWith("configuration.") && !records.has(params.key)) records.set(params.key, {
        value: { workspaceRoot: "/workspace", strategy: { type: "sma-cross", fast: binding.project === "A" ? 17 : 9, slow: 50 }, future: binding.project }, revision: `sha256:${(++revision).toString(16).padStart(64, "0")}`,
      });
      const snapshot = () => records.has(params.key) ? { exists: true, ...structuredClone(records.get(params.key)) } : { exists: false, value: null, revision: null };
      if (method === "storage.getSnapshot") return snapshot();
      if (method === "storage.get") return snapshot().value;
      if (method === "storage.set") { records.set(params.key, { value: params.value, revision: `sha256:${(++revision).toString(16).padStart(64, "0")}` }); return null; }
      if (method === "storage.compareAndSet") {
        if (holdWrite && params.key.startsWith("configuration.")) { const held = holdWrite; holdWrite = null; held.started(); await held.pending; }
        const updated = snapshot().revision === params.expectedRevision;
        if (updated) records.set(params.key, { value: params.value, revision: `sha256:${(++revision).toString(16).padStart(64, "0")}` });
        return { updated, snapshot: snapshot() };
      }
      if (method === "workspace.info") return { root: "/workspace", name: binding.project };
      if (method === "workspace.list") return { entries: [], truncated: false };
      if (method === "workspace.readText") {
        if (holdRead && params.path === "data/old.csv") { const held = holdRead; holdRead = null; held.started(); return held.pending; }
        throw Error("file missing");
      }
      if (method === "automations.list" || method === "agent.task.list") return [];
      throw Error(`Fixture does not provide ${method}`);
    });
    await page.addInitScript(({ permissions, deferInitial }) => {
      let binding = { project: "A", sessionId: "chat-A" }, listener;
      const projectedContext = () => ({ busy: false, visible: false,
        ...(permissions.includes("context.workspace") ? { cwd: "/workspace", trusted: true } : {}),
        ...(permissions.includes("context.session") && binding.sessionId ? { sessionId: binding.sessionId } : {}),
        availableMethods: ["storage.get", "storage.set", "storage.getSnapshot", "storage.compareAndSet", "workspace.info", "workspace.list", "workspace.readText"],
      });
      window.__quantLabTestHostCallLimits = { maxCalls: 10000, backgroundCalls: 10000, windowMs: 10 };
      window.codeshellPanel = {
        getContext: async () => { const captured = projectedContext(); if (deferInitial) await new Promise(resolve => { window.releaseInitial = resolve; }); return captured; },
        call: (method, params) => window.testHost({ ...binding }, method, params),
        on: (name, callback) => { if (name === "context.changed") listener = callback; },
        registerTool() {},
      };
      window.switchExecution = (sessionId, project = "A") => { binding = { sessionId, project }; listener?.(projectedContext()); };
    }, { permissions: manifest.permissions, deferInitial });
  }
  await page.goto(`${origin}/index.html`);
  if (!deferInitial) await page.waitForFunction(() => document.querySelector("#run-state").textContent === "已完成", null, { timeout: 10000 }).catch(error => {
    error.message += `\nInitialization errors: ${JSON.stringify(errors)}; latest calls: ${JSON.stringify(calls.slice(-8))}`;
    throw error;
  });
  const hold = kind => {
    let release, started;
    const pending = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { started = resolve; });
    if (kind === "write") holdWrite = { pending, started }; else holdRead = { pending, started };
    return { release, ready };
  };
  return { page, calls, projects, errors, hold };
}

const configWrites = f => f.calls.filter(call => call.method === "storage.compareAndSet" && call.params.key.startsWith("configuration."));
const parameter = (page, value) => page.waitForFunction(value => document.querySelector("#fast-period").value === value && !document.querySelector("#fast-period").disabled, String(value));

test("same-path execution switches detach queued writes and retain downloadable drafts without changing project storage keys", { timeout: 20000 }, async t => {
  assert.ok(manifest.permissions.includes("context.session"), "fixture must use the actual granted context projection");
  const f = await fixture(t);
  await f.page.locator('[data-module-tab="research"]').tap();
  const pending = f.hold("write");
  await f.page.locator("#fast-period").fill("18");
  await pending.ready;
  await f.page.locator("#fast-period").fill("19");
  await f.page.evaluate(() => window.switchExecution("chat-B", "B"));
  await parameter(f.page, 9);
  pending.release();
  await f.page.locator('[data-module-tab="research"]').tap();
  const download = f.page.waitForEvent("download");
  await f.page.locator("#backtest-storage-backup").tap();
  const backup = JSON.parse(await readFile(await (await download).path(), "utf8"));
  assert.equal(backup.sessionId, "chat-B");
  assert.equal(backup.fields.fastPeriod, "9");
  assert.equal(backup.retainedDrafts[0].sessionId, "chat-A");
  assert.equal(backup.retainedDrafts[0].fields.fastPeriod, "19");
  await f.page.locator("#backtest-storage-draft").selectOption(JSON.stringify(["/workspace", "chat-A"]));
  const retainedDownload = f.page.waitForEvent("download");
  await f.page.locator("#backtest-storage-backup").tap();
  const retainedBackup = await readFile(await (await retainedDownload).path());
  assert.equal(JSON.parse(retainedBackup).fields.fastPeriod, "19");
  assert.equal(JSON.parse(retainedBackup).sessionId, "chat-A");
  assert.equal(configWrites(f).length, 1, "the queued second old-chat edit must never reach the new binding");
  await f.page.evaluate(() => window.switchExecution("chat-C", "A"));
  await parameter(f.page, 18);
  assert.equal(configWrites(f).length, 1, "a new chat reopens the same committed project settings without rewriting");
  await f.page.evaluate(() => window.switchExecution("chat-A", "A"));
  await parameter(f.page, 19);
  assert.match(await f.page.locator("#backtest-storage-status").textContent(), /未确认草稿/);
  await f.page.evaluate(() => window.switchExecution(null, "A"));
  await parameter(f.page, 18);
  assert.equal(configWrites(f).length, 1, "omitting the cleared session must detach its unconfirmed draft");
  assert.equal(new Set(f.calls.filter(call => call.params.key?.startsWith("configuration.")).map(call => call.params.key)).size, 1);
  await f.page.reload();
  await parameter(f.page, 18);
  await f.page.locator("#backtest-storage-file").setInputFiles({ name: "retained-draft.json", mimeType: "application/json", buffer: retainedBackup });
  await parameter(f.page, 19);
  await f.page.waitForFunction(() => document.querySelector("#backtest-storage-status").textContent.includes("已与项目记录一致"));
  assert.equal(configWrites(f).length, 2, "a selected retained backup remains explicitly importable after the page closes");
  assert.deepEqual(f.errors, []);
});

test("late CSV responses cannot replace the next same-path project's dataset or issue its metadata read", { timeout: 20000 }, async t => {
  const f = await fixture(t);
  await f.page.locator('[data-module-tab="research"]').tap();
  await f.page.locator("#research-advanced-loader summary").tap();
  await f.page.locator("#data-path").fill("data/old.csv");
  const pending = f.hold("read");
  await f.page.locator("#load-data").tap();
  await pending.ready;
  await f.page.evaluate(() => window.switchExecution("chat-B", "B"));
  await parameter(f.page, 9);
  pending.release({ content: "date,open,high,low,close,volume\n2025-01-02,10,11,9,10,100\n", modifiedAt: 1 });
  await f.page.locator('[data-module-tab="research"]').tap();
  assert.equal(await f.page.locator("#instrument-name").textContent(), "合成演示行情");
  assert.equal(f.calls.some(call => call.project === "B" && call.params.path?.includes("old")), false);
  assert.deepEqual(f.errors, []);
});

test("new context events win over a stale initial getContext even when cwd is identical", { timeout: 20000 }, async t => {
  const f = await fixture(t, { deferInitial: true });
  await f.page.waitForFunction(() => Boolean(window.releaseInitial));
  await f.page.evaluate(() => { window.switchExecution("chat-B", "B"); window.switchExecution("chat-C", "B"); window.releaseInitial(); });
  await parameter(f.page, 9);
  await f.page.waitForFunction(() => document.querySelector("#run-state").textContent === "已完成");
  const reads = f.calls.filter(call => call.method === "storage.getSnapshot" && call.params.key.startsWith("configuration."));
  assert.deepEqual(reads.map(call => [call.project, call.sessionId]), [["B", "chat-C"]]);
  assert.deepEqual(f.errors, []);
});

for (const width of [320, 390]) test(`${width}px browser-only research really saves strategy, report and exports locally while Agent submission stays unavailable`, { timeout: 20000 }, async t => {
  const f = await fixture(t, { offline: true, width });
  assert.match(await f.page.locator("#host-connection-state").textContent(), /浏览器本地模式/);
  await f.page.locator('[data-module-tab="research"]').tap();
  await f.page.locator("#fast-period").fill("12");
  await f.page.locator("#run-backtest").tap();
  await f.page.locator("#save-strategy").tap();
  await f.page.waitForFunction(() => document.querySelector("#toast").textContent.includes("策略已保存"));
  await f.page.locator("#save-report").tap();
  await f.page.waitForFunction(() => document.querySelector("#toast").textContent.includes("报告已保存"));
  for (const id of ["save-strategy", "save-report", "export-backtest", "run-backtest"]) {
    const box = await f.page.locator(`#${id}`).boundingBox();
    assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= width, `${id} must fit as a touch control`);
  }
  assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth), width);
  if (process.env.PANEL_BUSINESS_SCREENSHOTS === "1")
    await f.page.locator(".desk-header").screenshot({ path: `/tmp/panel-quant-mobile-${width}.png` });
  await f.page.locator("#export-backtest").tap();
  await f.page.waitForFunction(() => document.querySelector("#toast").textContent.includes("回测结果已直接导出"));
  const files = await f.page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.includes(":file:"))));
  assert.ok(Object.entries(files).some(([key, value]) => key.endsWith(".csv") && value.includes("configuration_fingerprint")));
  assert.ok(Object.entries(files).some(([key, value]) => key.endsWith(".quant.json") && JSON.parse(value).strategy.fast === 12));
  assert.ok(Object.entries(files).some(([key, value]) => key.endsWith(".md") && value.includes("## Methodology and limitations")));
  await f.page.locator("#ask-agent").tap();
  assert.equal(await f.page.locator("#submit-agent").isDisabled(), true);
  assert.match(await f.page.locator("#agent-state").textContent(), /未连接/);
  await f.page.keyboard.press("Escape");
  const download = f.page.waitForEvent("download");
  await f.page.locator("#backtest-storage-backup").tap();
  assert.equal(JSON.parse(await readFile(await (await download).path(), "utf8")).fields.fastPeriod, "12");
  await f.page.reload();
  await parameter(f.page, 12);
  assert.deepEqual(f.errors, []);
});
