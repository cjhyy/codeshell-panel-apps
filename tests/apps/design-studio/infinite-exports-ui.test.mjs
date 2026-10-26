import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { checkNaturalTextBounds } from "./infinite-text-bounds.fixture.mjs";
import {
  exportDesignFrontend,
  exportDesignPrototype,
  fixtureDocument,
  fixturePrototype,
} from "./infinite-exports.fixture.mjs";

async function browserFixture(t) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://**", (route) => route.abort());
  await page.route("http://**", (route) => route.abort());
  t.after(() => assert.deepEqual(errors, [], "exported page must run without browser errors"));
  return page;
}

async function retainScreenshot(page, name) {
  if (!process.env.DESIGN_STUDIO_EXPORT_EVIDENCE_DIR) return;
  const directory = resolve(process.env.DESIGN_STUDIO_EXPORT_EVIDENCE_DIR);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: true });
}

test("Chromium renders both distant artboards at their real size and keeps Frame child constraints", async (t) => {
  const page = await browserFixture(t);
  await page.setContent(exportDesignFrontend(fixtureDocument({ rootConstraints: true })));
  await retainScreenshot(page, "boards");
  const workspace = await page.locator("main").boundingBox();
  assert.deepEqual(workspace, { x: 0, y: 0, width: 5080, height: 2080 });
  const west = await page.locator('[data-codeshell-id="west-board"]').boundingBox();
  const east = await page.locator('[data-codeshell-id="east-board"]').boundingBox();
  const child = await page.locator('[data-codeshell-id="west-content"]').boundingBox();
  assert.deepEqual(west, { x: 0, y: 0, width: 320, height: 240 });
  assert.deepEqual(east, { x: 4800, y: 1900, width: 280, height: 180 });
  assert.deepEqual(child, { x: 20, y: 30, width: 270, height: 40 });
  await page.locator('[data-codeshell-id="east-board"]').scrollIntoViewIfNeeded();
  assert.equal(
    await page.locator('[data-codeshell-id="east-board"]').evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height / 2;
      return document.elementFromPoint(x, y) === element;
    }),
    true,
    "the board beyond the old document bounds must be painted and hit-testable",
  );
});

test("Chromium prototype navigation uses independent page extents after negative-origin export", async (t) => {
  const page = await browserFixture(t);
  await page.setContent(
    exportDesignPrototype(fixtureDocument(), { prototype: fixturePrototype() }),
  );
  const workspace = page.locator("main:not([hidden])");
  assert.equal(await workspace.getAttribute("data-codeshell-page-id"), "boards");
  assert.equal((await workspace.boundingBox()).width, 5080);
  const link = page.locator('[data-prototype-link="to-detail"]');
  await link.focus();
  await link.press("Enter");
  assert.equal(await workspace.getAttribute("data-codeshell-page-id"), "detail");
  assert.deepEqual(await workspace.boundingBox(), { x: 350, y: 52, width: 200, height: 100 });
  const board = await page.locator('[data-codeshell-id="detail-board"]').boundingBox();
  assert.deepEqual(board, { x: 350, y: 52, width: 200, height: 100 });
  await page.locator('[data-prototype-link="back"]').click();
  assert.equal(await workspace.getAttribute("data-codeshell-page-id"), "boards");
  assert.equal((await workspace.boundingBox()).width, 5080);
  await retainScreenshot(page, "prototype-boards");
});

test("Chromium bounded export keeps its legacy responsive document viewport", async (t) => {
  const page = await browserFixture(t);
  await page.setContent(exportDesignFrontend(fixtureDocument({ infinite: false })));
  assert.deepEqual(await page.locator("main").boundingBox(), {
    x: 0,
    y: 0,
    width: 900,
    height: 800,
  });
  assert.equal(await page.evaluate(() => document.body.scrollWidth), 900);
});

test("infinite natural text keeps actual Roboto ink beyond its node box in SVG and GPU while frame clipping remains effective", checkNaturalTextBounds);
