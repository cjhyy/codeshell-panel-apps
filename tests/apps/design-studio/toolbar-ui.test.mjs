import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { launchCanvasBrowser, canvasCsp, canvasContentType } from "./canvas-ui-fixture.mjs";

const root = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));

async function fixture(t, width = 1200) {
  const browser = await launchCanvasBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    const path = resolve(root, `.${url.pathname}`);
    if (url.origin !== "https://panel.test" || !path.startsWith(root + sep)) return route.abort();
    try {
      await route.fulfill({ body: await readFile(path), contentType: canvasContentType(path),
        headers: { "Content-Security-Policy": canvasCsp } });
    } catch { await route.fulfill({ status: 404, body: "missing" }); }
  });
  await page.goto("https://panel.test/index.html");
  await page.locator("#open-figma-workflow").waitFor({ state: "attached" });
  await page.locator("#open-prototype-editor").waitFor({ state: "attached" });
  return { page, errors };
}

test("document identity and save status stay visible while occasional actions live in More", async t => {
  const { page, errors } = await fixture(t);
  for (const width of [1200, 800, 390]) {
    await page.setViewportSize({ width, height: 800 });
    if (process.env.DESIGN_STUDIO_TOOLBAR_CAPTURE) {
      await page.screenshot({ path: `${process.env.DESIGN_STUDIO_TOOLBAR_CAPTURE}/toolbar-${width}.png` });
      await writeFile(`${process.env.DESIGN_STUDIO_TOOLBAR_CAPTURE}/toolbar-${width}.html`, await page.content());
    }
    assert.equal(await page.locator("#open-files").isVisible(), true, `document switcher at ${width}`);
    assert.equal(await page.locator("#document-title").isVisible(), true, `document title at ${width}`);
    assert.equal(await page.locator("#save-state").isVisible(), true, `save state at ${width}`);
    for (const id of ["open-delivery", "open-ai", "compact-actions"])
      assert.equal(await page.locator(`#${id}`).isVisible(), true, `${id} at ${width}`);
    assert.deepEqual(await page.locator(".top-actions > button").filter({ visible: true }).evaluateAll(buttons => buttons.map(button => button.id)),
      width > 680 ? ["open-delivery", "open-ai"] : ["open-delivery", "open-ai", "toggle-inspector"]);
    for (const id of ["save", "open-html-import", "open-figma-workflow", "export-svg", "run-audit", "portable-backup-open", "open-shortcuts", "document-path"])
      assert.equal(await page.locator(`#${id}`).isVisible(), false, `${id} should be in closed More at ${width}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    const boxes = await page.locator("#open-files, #save-state, .top-actions").evaluateAll(elements =>
      elements.map(element => { const b = element.getBoundingClientRect(); return { x: b.x, right: b.right }; }));
    assert.ok(boxes.every(box => box.x >= 0 && box.right <= width), `toolbar fits at ${width}`);
  }
  assert.deepEqual(errors, []);
});

test("More supports keyboard navigation, Escape, outside click, and original command buttons", async t => {
  const { page, errors } = await fixture(t, 800);
  const trigger = page.locator("#compact-actions summary");
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.locator("#compact-actions").getAttribute("open"), "");
  assert.equal(await trigger.getAttribute("aria-expanded"), "true");
  assert.equal(await page.evaluate(() => document.activeElement.id), "save");
  if (process.env.DESIGN_STUDIO_TOOLBAR_CAPTURE)
    await page.screenshot({ path: `${process.env.DESIGN_STUDIO_TOOLBAR_CAPTURE}/toolbar-menu-800.png` });
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement.id), "save-as");
  await page.keyboard.press("End");
  assert.equal(await page.evaluate(() => document.activeElement.id), "open-shortcuts");
  await page.keyboard.press("Home");
  assert.equal(await page.evaluate(() => document.activeElement.id), "save");
  await page.locator("#document-path").focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement.id), "document-path", "path input keeps normal editing keys");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#compact-actions").getAttribute("open"), null);
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
  await trigger.click();
  await page.locator("#document-path").focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.locator("#compact-actions").getAttribute("open"), null, "tabbing out closes More");
  await trigger.click();
  await page.locator(".brand").click();
  assert.equal(await page.locator("#compact-actions").getAttribute("open"), null);

  for (const [id, dialog] of [["open-html-import", "html-import-dialog"],
    ["open-figma-workflow", "figma-workflow-dialog"], ["portable-backup-open", "portable-backup-dialog"],
    ["open-shortcuts", "shortcuts-dialog"], ["save-as", "save-as-dialog"]]) {
    await trigger.click();
    assert.equal(await page.locator(`#${id}`).isVisible(), true);
    await page.locator(`#${id}`).click();
    await page.locator(`#${dialog}[open]`).waitFor();
    assert.equal(await page.locator("#compact-actions").getAttribute("open"), null);
    await page.keyboard.press("Escape");
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
  }
  assert.deepEqual(errors, []);
});

test("page controls belong to the page sidebar and More does not duplicate its commands", async t => {
  const { page } = await fixture(t);
  assert.equal(await page.locator(".sidebar-pages #active-page").count(), 1);
  assert.equal(await page.locator(".topbar #active-page").count(), 0);
  assert.equal(await page.locator(".sidebar-pages #add-page").count(), 1);
  assert.equal(await page.locator(".sidebar-pages #manage-pages").count(), 1);
  assert.equal(await page.locator("#sidebar-add-page").isVisible(), false);
  await page.locator("#compact-actions summary").click();
  for (const id of ["save-as", "open-figma-workflow"])
    assert.equal(await page.locator(`.compact-actions-list #${id}, .compact-actions-list [data-toolbar-action="${id}"]`).filter({ visible: true }).count(), 1);
});
