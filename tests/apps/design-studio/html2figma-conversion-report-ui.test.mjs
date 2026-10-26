import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { launchCanvasBrowser, canvasMime, observeLocalTools, metadata } from "./fixtures/canvas-test-observations.mjs";

const app = fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url));
const ready = () => ({ version: 1, ready: true, partial: false, errors: [], warnings: [] });
const root = (id, conversionReport) => ({ id, type: "FRAME", name: id, x: 0, y: 0, width: 100, height: 80, children: [],
  ...(conversionReport === undefined ? {} : { conversionReport }) });
async function toolbarAction(page, selector) {
  if (await page.locator("#compact-actions").getAttribute("open") === null)
    await page.locator("#compact-actions summary").click();
  await page.locator(selector).click();
}

async function fixture(t) {
  const browser = await launchCanvasBrowser(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } }), errors = [];
  page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => dialog.accept());
  await page.route("**/*", async route => {
    const url = new URL(route.request().url()), path = resolve(app, "." + url.pathname);
    if (url.origin !== "https://conversion-report.test" || !path.startsWith(resolve(app) + sep)) return route.abort();
    try { await route.fulfill({ body: await readFile(path), contentType: canvasMime[extname(path)] }); }
    catch { await route.fulfill({ status: 404, body: "missing" }); }
  });
  await observeLocalTools(page); await page.goto("https://conversion-report.test/index.html");
  await page.waitForFunction(() => !document.querySelector(".workspace").inert);
  const open = () => toolbarAction(page, "#open-figma-workflow");
  const choose = async input => {
    await page.locator("#figma-import-file").setInputFiles({ name: "conversion.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) });
    await page.waitForFunction(() => document.querySelector("#figma-workflow-dialog").getAttribute("aria-busy") === "false");
  };
  const apply = async () => {
    await page.locator("#figma-import-mode").selectOption("replace"); await page.locator("#figma-import-apply").click();
    await page.waitForFunction(() => document.querySelector("#figma-workflow-status").textContent.includes("已导入"));
    await page.locator("#figma-workflow-close").click();
  };
  await open(); await choose(root("Existing document")); await apply();
  return { page, errors, open, choose, apply };
}

for (const issue of ["incomplete batch", "nested report"]) test(`standard file import refuses ${issue} before changing the current document and permits a corrected retry`, async t => {
  const f = await fixture(t), before = await metadata(f.page);
  const input = issue === "incomplete batch"
    ? { nodes: [root("Complete first", ready()), root("Incomplete second", { version: 1, ready: false, partial: true,
      errors: [{ code: "GENERATED_GLYPH_UNOBSERVED", message: "No native generated glyph observation", sourceOffset: 3 }], warnings: [] })], conversionReport: ready() }
    : root("Ready parent", ready());
  if (issue === "nested report") input.children.push(root("Untrusted child", ready()));
  await f.open(); await f.choose(input);
  assert.equal(await f.page.locator("#figma-import-apply").isDisabled(), true);
  assert.match(await f.page.locator("#figma-workflow-status").textContent(), issue === "incomplete batch" ? /原生文字布局|glyph/u : /conversionReport/u);
  await f.page.locator("#figma-workflow-close").click();
  assert.deepEqual(await metadata(f.page), before, "rejected preparation must not change nodes, selection, page or state revision");
  await f.open(); await f.choose([root("Corrected first", ready()), root("Corrected second", ready())]);
  assert.match(await f.page.locator("#figma-import-preview").textContent(), /2 个可编辑图层/u);
  await f.apply(); assert.equal((await metadata(f.page)).layers.length, 2); assert.deepEqual(f.errors, []);
});
