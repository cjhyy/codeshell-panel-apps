// Real Panel markup/controller, two browser contexts, controlled Host storage.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";
const root = fileURLToPath(new URL("../../../apps/quant-lab/app/", import.meta.url));

test("signal UI preserves another device, downloads conflicting/raw drafts, explicitly reloads and isolates projects", async () => {
  const browser = await chromium.launch();
  const records = new Map(),
    errors = [],
    calls = [],
    failures = new Map();
  const snapshot = (key) => {
    const value = records.get(key) ?? null;
    return {
      exists: value !== null,
      value: structuredClone(value),
      revision:
        value === null
          ? null
          : `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`,
    };
  };
  async function open(id, legacy = false) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 850 },
      acceptDownloads: true,
    });
    await context.exposeBinding("testHost", async (_source, method, params) => {
      calls.push({ id, method, params });
      if (["storage.getSnapshot", "storage.get"].includes(method)) {
        if (failures.get(id) === "read") throw Error("read unavailable");
        return method === "storage.get" ? snapshot(params.key).value : snapshot(params.key);
      }
      if (method === "storage.set") {
        records.set(params.key, structuredClone(params.value));
        return {};
      }
      assert.equal(method, "storage.compareAndSet");
      const updated = params.expectedRevision === snapshot(params.key).revision;
      if (updated) records.set(params.key, structuredClone(params.value));
      if (failures.get(id) === "lost") {
        failures.delete(id);
        throw Error("lost receipt");
      }
      return { updated, snapshot: snapshot(params.key) };
    });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== "https://panel.test") return route.abort();
      if (url.pathname === "/app.js")
        return route.fulfill({
          contentType: "text/javascript",
          body: `
        import {createSelectionSignalLabController} from './modules/selection-signal-lab.mjs';
        document.body.replaceChildren(document.querySelector('.selection-signal-lab'));
        window.project = 'A'; window.epoch = 0;
        const names = {mode:'mode',add:'add',export:'export',reset:'reset',conditions:'conditions',count:'count',summary:'summary',results:'results',status:'state',reload:'reload',backup:'backup',warning:'warning'};
        window.controller = createSelectionSignalLabController({ hostCall: window.testHost,
          storageKey: () => 'signal-' + window.project, currentEpoch: () => window.epoch,
          getContext: () => ({cwd:'/workspace', sessionId:window.project, availableMethods: ${JSON.stringify(legacy ? ["storage.get", "storage.set"] : ["storage.getSnapshot", "storage.compareAndSet"])} }),
          getSnapshot: () => null, onStock() {},
          elements: Object.fromEntries(Object.entries(names).map(([key,id]) => [key,document.getElementById('selection-signal-'+id)])) });
        window.switchProject = async () => { window.project = 'B'; window.epoch++; window.controller.reset(); await window.controller.load(); };
        await window.controller.load(); window.ready = true;
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
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("https://panel.test/");
    await page.waitForFunction(() => window.ready);
    return page;
  }
  const state = (page, text) =>
    page.locator("#selection-signal-state").filter({ hasText: text }).waitFor();
  const backup = async (page) => {
    const pending = page.waitForEvent("download");
    await page.locator("#selection-signal-backup").click();
    return JSON.parse(await readFile(await (await pending).path(), "utf8"));
  };
  try {
    const a = await open("a"),
      b = await open("b");
    await a.selectOption("#selection-signal-mode", "or");
    await state(a, "已保存");
    await b.locator("#selection-signal-add").click();
    await state(b, "其他页面或设备");
    assert.equal(records.get("signal-A").mode, "or");
    assert.equal(await b.locator("[data-signal-value]").count(), 4);
    const draft = await backup(b);
    assert.equal(draft.drafts[0].signal.conditions.length, 4);
    assert.equal(draft.drafts[0].sessionId, "A");
    failures.set("b", "read");
    await b.locator("#selection-signal-reload").click();
    await state(b, "读取失败");
    assert.equal(await b.locator("[data-signal-value]").count(), 4);
    failures.delete("b");
    await b.locator("#selection-signal-reload").click();
    await state(b, "按项目保存");
    assert.equal(await b.locator("#selection-signal-mode").inputValue(), "or");
    failures.set("b", "lost");
    await b.selectOption("#selection-signal-mode", "and");
    await state(b, "已保存");
    assert.equal(
      calls.filter((call) => call.id === "b" && call.method === "storage.compareAndSet").length,
      2,
    );
    await b.locator('[data-signal-value="0"]').fill("");
    await b.locator('[data-signal-value="0"]').press("Tab");
    await state(b, "有效阈值");
    await b.evaluate(() => window.switchProject());
    assert.equal(records.has("signal-B"), false);
    const switched = await backup(b);
    assert(
      switched.drafts.some((value) => value.sessionId === "A" && value.inputs[0][2] === ""),
      "Raw invalid input keeps its original project in the backup",
    );
    const bad = { version: 7, future: "must stay intact" };
    records.set("signal-A", bad);
    const invalid = await open("invalid");
    await state(invalid, "读取失败");
    await invalid.selectOption("#selection-signal-mode", "or");
    await state(invalid, "未保存");
    assert.deepEqual(records.get("signal-A"), bad);
    assert.deepEqual((await backup(invalid)).drafts[0].storedRecord, bad);
    records.delete("signal-A");
    const legacy = await open("legacy", true);
    assert.equal(await legacy.locator("#selection-signal-warning").isVisible(), true);
    await legacy.selectOption("#selection-signal-mode", "or");
    await state(legacy, "已保存");
    const output = await mkdtemp(join(tmpdir(), "quant-signal-ui-"));
    await invalid.screenshot({
      path: join(output, "preserved-invalid-record.png"),
      fullPage: true,
    });
    console.log(`Signal storage screenshot: ${output}/preserved-invalid-record.png`);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
