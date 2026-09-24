// Real Panel markup/controller in two independent browsers; the Host storage
// contract is controlled here. This does not claim a physical phone or live market test.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../apps/quant-lab/app/", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "quant-storage-ui-"));
const records = new Map();
const calls = [];
const failures = new Map();
const browser = await chromium.launch({ headless: true });
const snapshot = (key) => {
  const exists = records.has(key);
  const value = exists ? structuredClone(records.get(key)) : null;
  return {
    exists,
    value,
    revision: exists
      ? `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
      : null,
  };
};
async function open(id, width, legacy = false) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    acceptDownloads: true,
  });
  await context.exposeBinding("testHost", async (_source, method, params) => {
    calls.push({ id, method, params });
    if (method === "storage.getSnapshot" || method === "storage.get") {
      if (failures.get(id) === "read") throw Error("test storage unavailable");
      return method === "storage.getSnapshot" ? snapshot(params.key) : snapshot(params.key).value;
    }
    if (method === "storage.compareAndSet") {
      const updated = params.expectedRevision === snapshot(params.key).revision;
      if (updated) records.set(params.key, structuredClone(params.value));
      if (failures.get(id) === "lost-response") {
        failures.delete(id);
        throw Error("test response lost");
      }
      return { updated, snapshot: snapshot(params.key) };
    }
    assert.equal(method, "storage.set");
    records.set(params.key, structuredClone(params.value));
    return true;
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://panel.test") return route.abort();
    if (url.pathname === "/app.js")
      return route.fulfill({
        contentType: "text/javascript",
        body: `
      import { createDataSourcesController } from './modules/data-sources-ui.mjs';
      window.epoch = 1;
      window.applied = 0;
      window.controller = createDataSourcesController({ hostCall: window.testHost,
        storageKey: () => 'source-' + window.epoch, currentEpoch: () => window.epoch,
        getContext: () => ({ availableMethods: ${JSON.stringify(legacy ? ["storage.get", "storage.set"] : ["storage.getSnapshot", "storage.compareAndSet"])} }),
        onApply: async () => { window.applied++; return {}; }, onHistory() {} });
      await window.controller.load();
      window.ready = true;
    `,
      });
    const path = resolve(root, "." + (url.pathname === "/" ? "/index.html" : url.pathname));
    if (!path.startsWith(root)) return route.abort();
    try {
      await route.fulfill({
        body: await readFile(path),
        contentType:
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".mjs": "text/javascript",
            ".css": "text/css",
          }[extname(path)] ?? "application/octet-stream",
      });
    } catch {
      await route.fulfill({ status: 404, body: "not found" });
    }
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto("https://panel.test/");
  await page.waitForFunction(() => window.ready);
  await page.click("#data-sources-open");
  return { context, page };
}
try {
  const desktop = await open("desktop", 1440);
  const phone = await open("phone", 390);
  await phone.page.selectOption("#sources-industry", "standard-json");
  await phone.page.fill("#sources-label", "手机草稿");
  await phone.page.fill("#sources-endpoint", "https://example.com/industries.json");
  await desktop.page.selectOption("#sources-industry", "eastmoney");
  await desktop.page.click("#sources-save");
  await desktop.page.waitForFunction(() => window.applied === 1);
  await phone.page.click("#sources-save");
  await phone.page.waitForFunction(() =>
    document.querySelector("#sources-state").textContent.includes("其他页面或设备"),
  );
  assert.equal(records.get("source-1").industry, "eastmoney");
  assert.equal(await phone.page.evaluate(() => window.applied), 0);
  assert.equal(await phone.page.locator("#sources-save").isDisabled(), true);
  assert.equal(await phone.page.locator("#sources-label").inputValue(), "手机草稿");
  await phone.page.click("#sources-close");
  await phone.page.click("#data-sources-open");
  assert.equal(
    await phone.page.locator("#sources-label").inputValue(),
    "手机草稿",
    "reopening cannot erase the conflicting draft",
  );
  const downloadPromise = phone.page.waitForEvent("download");
  await phone.page.click("#sources-backup");
  const download = await downloadPromise;
  assert.deepEqual(JSON.parse(await readFile(await download.path(), "utf8")), {
    industry: "standard-json",
    label: "手机草稿",
    endpoint: "https://example.com/industries.json",
  });
  const geometry = await phone.page.locator("#data-sources-dialog").evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewport: innerWidth,
      overflow: el.scrollWidth - el.clientWidth,
    };
  });
  assert(
    geometry.left >= 0 && geometry.right <= geometry.viewport && geometry.overflow <= 1,
    JSON.stringify(geometry),
  );
  await phone.page.screenshot({ path: join(output, "conflict-390.png") });
  failures.set("phone", "read");
  await phone.page.click("#sources-reload");
  await phone.page.waitForFunction(() =>
    document.querySelector("#sources-state").textContent.includes("配置读取失败"),
  );
  assert.equal(await phone.page.locator("#sources-label").inputValue(), "手机草稿");
  assert.equal(await phone.page.locator("#sources-save").isDisabled(), true);
  failures.delete("phone");
  await phone.page.click("#sources-reload");
  await phone.page.waitForFunction(() => !document.querySelector("#sources-save").disabled);
  assert.equal(await phone.page.locator("#sources-industry").inputValue(), "eastmoney");
  assert.equal(await phone.page.locator("#sources-recovery").isHidden(), true);
  assert.equal(
    await phone.page.evaluate(() => window.applied),
    0,
    "explicit reload reads without launching research",
  );
  failures.set("phone", "lost-response");
  await phone.page.selectOption("#sources-industry", "sina");
  await phone.page.click("#sources-save");
  await phone.page.waitForFunction(() => window.applied === 1);
  assert.equal(
    calls.filter((call) => call.id === "phone" && call.method === "storage.compareAndSet").length,
    2,
    "the lost response must be read back, not submitted a second time",
  );
  // A new device and a different project must not inherit local form state.
  const reopened = await open("reopened", 390);
  assert.equal(await reopened.page.locator("#sources-industry").inputValue(), "sina");
  await reopened.page.evaluate(async () => {
    window.epoch++;
    await window.controller.load();
  });
  assert.equal(await reopened.page.locator("#sources-industry").inputValue(), "auto");
  await reopened.page.selectOption("#sources-industry", "eastmoney");
  await reopened.page.click("#sources-save");
  await reopened.page.waitForFunction(() => window.applied === 1);
  assert.equal(records.get("source-1").industry, "sina");
  assert.equal(records.get("source-2").industry, "eastmoney");
  const legacy = await open("legacy", 390, true);
  assert.equal(await legacy.page.locator("#sources-storage-warning").isVisible(), true);
  await legacy.page.selectOption("#sources-industry", "auto");
  await legacy.page.click("#sources-save");
  await legacy.page.waitForFunction(() => window.applied === 1);
  assert.equal(
    calls.filter((call) => call.id === "legacy" && call.method === "storage.set").length,
    1,
  );
  console.log(
    `✓ Quant data-source two-device conflict, draft backup, reload failure/recovery, lost response, project isolation and legacy host; screenshots ${output}`,
  );
} finally {
  await browser.close();
}
