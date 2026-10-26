// H2F-INTEGRATION-005: same page identity/name must not hide layer-count edits.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { launchCanvasBrowser, canvasMime, metadata, readNode, observeLocalTools, frames } from "./fixtures/canvas-test-observations.mjs";

const root = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));
const input = count => ({ nodes: [{ type: "FRAME", id: "same-root", name: "Same canvas", x: 0, y: 0,
  width: 400, height: 240, fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
  children: Array.from({ length: count }, (_, index) => ({ type: "RECTANGLE", id: `leaf-${index}`,
    name: `Original shape ${index}`, x: 20 + index * 40, y: 30, width: 20, height: 24,
    fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }] })) }] });

async function fixture(t) {
  const browser = await launchCanvasBrowser(); t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await context.newPage(), errors = [], observations = [];
  page.setDefaultTimeout(10_000);
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", async route => {
    const url = new URL(route.request().url()), path = resolve(root, `.${url.pathname}`);
    if (url.origin !== "https://sidebar-count.test" || !path.startsWith(root + sep)) return route.abort();
    try { await route.fulfill({ body: await readFile(path), contentType: canvasMime[extname(path)] }); }
    catch { await route.fulfill({ status: 404, body: "missing" }); }
  });
  await observeLocalTools(page);
  await page.goto("https://sidebar-count.test/index.html");
  await page.waitForFunction(() => !document.querySelector(".workspace").inert);

  async function importReplace(count) {
    if(await page.locator("#compact-actions").getAttribute("open")===null)await page.locator("#compact-actions summary").click();await page.locator("#open-figma-workflow").click();
    await page.locator("#figma-import-file").setInputFiles({ name: "same-page.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(input(count))) });
    await page.waitForFunction(() => document.querySelector("#figma-workflow-dialog").getAttribute("aria-busy") === "false");
    assert.match(await page.locator("#figma-import-preview").textContent(), new RegExp(`${count + 1} 个可编辑图层`));
    await page.locator("#figma-import-mode").selectOption("replace");
    await page.locator("#figma-import-apply").click();
    await page.waitForFunction(() => document.querySelector("#figma-workflow-status").textContent.includes("已导入"));
    await page.locator("#figma-workflow-close").click();
    await frames(page);
  }

  async function observe(label) {
    const current = await metadata(page);
    const badges = await page.locator("#sidebar-pages-list .sidebar-page").evaluateAll(rows => rows.map(row => ({
      active: row.dataset.active, name: row.querySelector(".sidebar-page-name").textContent,
      count: row.querySelector(".sidebar-page-count").textContent,
    })));
    const value = { label, activePageId: current.activePageId, pages: current.pages, layerCount: current.layers.length, badges };
    observations.push(value);
    return value;
  }

  t.after(async () => {
    if (!process.env.DESIGN_STUDIO_QA_DIR) return;
    await mkdir(process.env.DESIGN_STUDIO_QA_DIR, { recursive: true });
    await writeFile(resolve(process.env.DESIGN_STUDIO_QA_DIR, `${t.name.includes("replacement") ? "replacement" : "ordinary-edits"}.json`),
      JSON.stringify({ case: "H2F-INTEGRATION-005", scope: "isolated production UI; no existing user storage or Figma", observations, errors }, null, 2));
  });
  return { page, errors, importReplace, observe };
}

function assertCount(value, expected, identity) {
  assert.equal(value.pages.length, 1);
  assert.deepEqual([value.activePageId, value.pages[0].id, value.pages[0].name], identity);
  assert.equal(value.pages[0].nodeCount, expected, "canonical metadata must confirm the actual document count");
  assert.equal(value.layerCount, expected, "the imported layers must remain complete independently of the badge");
  assert.deepEqual(value.badges, [{ active: "true", name: value.pages[0].name, count: String(expected) }], JSON.stringify(value));
}

test("same-id/name Figma replacement updates sidebar counts through undo and redo", async t => {
  const f = await fixture(t);
  await f.importReplace(1);
  const initial = await f.observe("initial two layers"), identity = [initial.activePageId, initial.pages[0].id, initial.pages[0].name];
  assertCount(initial, 2, identity);
  await f.importReplace(4);
  assertCount(await f.observe("replacement five layers"), 5, identity);
  const original = await readNode(f.page, "figma-node-leaf-3");
  assert.deepEqual([original.name, original.x, original.y, original.width, original.height], ["Original shape 3", 140, 30, 20, 24]);
  await f.page.locator("#stage").press("Control+z"); await frames(f.page);
  assertCount(await f.observe("undo replacement to two"), 2, identity);
  await f.page.locator("#stage").press("Control+Shift+z"); await frames(f.page);
  assertCount(await f.observe("redo replacement to five"), 5, identity);
  assert.deepEqual(f.errors, []);
});

test("ordinary duplicate/delete and empty-page undo/redo also refresh the same sidebar row", async t => {
  const f = await fixture(t);
  await f.importReplace(1);
  const initial = await f.observe("initial two layers"), identity = [initial.activePageId, initial.pages[0].id, initial.pages[0].name];
  assertCount(initial, 2, identity);
  await f.page.locator('#layers-list .layer-row[data-id="figma-node-leaf-0"]').click();
  await f.page.locator("#stage").press("Control+d"); await frames(f.page);
  assertCount(await f.observe("duplicate to three"), 3, identity);
  await f.page.locator("#stage").press("Delete"); await frames(f.page);
  assertCount(await f.observe("delete copy to two"), 2, identity);
  await f.page.locator("#stage").press("Control+a");
  await f.page.locator("#stage").press("Delete"); await frames(f.page);
  assertCount(await f.observe("empty same page"), 0, identity);
  await f.page.locator("#stage").press("Control+z"); await frames(f.page);
  assertCount(await f.observe("undo empty to two"), 2, identity);
  await f.page.locator("#stage").press("Control+Shift+z"); await frames(f.page);
  assertCount(await f.observe("redo empty to zero"), 0, identity);
  assert.deepEqual(f.errors, []);
});
