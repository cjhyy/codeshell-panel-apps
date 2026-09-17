import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright";

const css = fileURLToPath(new URL("../shared/panel-select.css", import.meta.url));
const script = fileURLToPath(new URL("../shared/panel-select.js", import.meta.url));
const root = fileURLToPath(new URL("../", import.meta.url));
let browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

test("each independently installed app carries the shared control", async () => {
  for (const directory of [
    "apps/design-studio/app",
    "apps/job-hunt-hq/app",
    "apps/quant-lab/app",
    "apps/video-download/app",
    "panels/video-studio/app",
  ]) {
    const html = await readFile(resolve(root, directory, "index.html"), "utf8");
    assert.match(html, /panel-select\.css/);
    assert.match(html, /panel-select\.js/);
    for (const asset of ["panel-select.css", "panel-select.js"]) {
      assert.deepEqual(
        await readFile(resolve(root, directory, asset)),
        await readFile(resolve(root, "shared", asset)),
        `${directory}/${asset} must match the shared source`,
      );
    }
  }
});

async function fixture(t) {
  const page = await browser.newPage({ viewport: { width: 540, height: 360 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, []);
  });
  await page.setContent(`
    <style>:root{--panel-select-surface:#202429;--panel-select-menu-surface:#1c2023;--panel-select-text:#e2e8e4;--panel-select-accent:#b8edc8;--panel-select-border:#555}body{background:#101214;color:#e2e8e4;font:13px sans-serif;padding:30px}select{width:180px}</style>
    <label for="first">格式</label>
    <select id="first"><option value="a">标准</option><option value="b" disabled>不可用</option><option value="c">高质量</option></select>
    <button id="outside">外部</button>
    <dialog id="dialog"><label for="inside">导出格式</label><select id="inside"><option value="mp4">MP4</option><option value="mov">MOV</option></select></dialog>
  `);
  await page.addStyleTag({ path: css });
  await page.addScriptTag({ path: script });
  await page.evaluate(() => {
    globalThis.changes = [];
    document.querySelector("#first").addEventListener("input", () => changes.push("input"));
    document.querySelector("#first").addEventListener("change", () => changes.push("change"));
  });
  return page;
}

test("pointer menu keeps native select value and event contract", async (t) => {
  const page = await fixture(t);
  await page.locator("#first").click();
  assert.equal(await page.locator(".panel-select-menu").count(), 1);
  assert.equal(await page.locator("#first").getAttribute("aria-expanded"), "true");
  await page.locator('[data-panel-select-index="1"]').dispatchEvent("pointerdown", { button: 0 });
  assert.equal(await page.locator("#first").inputValue(), "a");
  await page.locator('[data-panel-select-index="2"]').click();
  assert.equal(await page.locator("#first").inputValue(), "c");
  assert.deepEqual(await page.evaluate(() => changes), ["input", "change"]);
  assert.equal(await page.locator(".panel-select-menu").count(), 0);
  await page.locator("#first").click();
  await page.locator("#outside").click();
  assert.equal(await page.locator(".panel-select-menu").count(), 0);
});

test("keyboard and changed options use the same menu", async (t) => {
  const page = await fixture(t);
  await page.locator("#first").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator(".panel-select-menu").count(), 1);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#first").inputValue(), "c");
  await page.evaluate(() => {
    const select = document.createElement("select");
    select.id = "dynamic";
    select.innerHTML = '<option value="one">One</option>';
    document.body.append(select);
  });
  await page.locator("#dynamic").click();
  await page.evaluate(() => {
    document.querySelector("#dynamic").insertAdjacentHTML("beforeend", '<option value="two">Two</option>');
  });
  await page.locator('[data-panel-select-index="1"]').click();
  assert.equal(await page.locator("#dynamic").inputValue(), "two");
});

test("label activation and a second click toggle without opening a native popup", async (t) => {
  const page = await fixture(t);
  await page.locator('label[for="first"]').click();
  assert.equal(await page.locator(".panel-select-menu").count(), 1);
  await page.locator("#first").click();
  assert.equal(await page.locator(".panel-select-menu").count(), 0);
  await page.locator("#first").click();
  assert.equal(await page.locator(".panel-select-menu").count(), 1);
});

test("menu stays inside a modal dialog's top layer", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => document.querySelector("#dialog").showModal());
  await page.locator("#inside").click();
  assert.equal(await page.locator("dialog > .panel-select-menu").count(), 1);
  await page.locator('dialog [data-panel-select-index="1"]').click();
  assert.equal(await page.locator("#inside").inputValue(), "mov");
});
