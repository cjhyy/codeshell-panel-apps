import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
} from "../../../apps/design-studio/app/document.mjs";

const root = resolve("apps/design-studio/app");
const path = "designs/viewport.codesign.json";
const base = {
  type: "rectangle",
  name: "Tile",
  width: 20,
  height: 20,
  fill: "#4f7cff",
  stroke: "transparent",
  strokeWidth: 0,
  rotation: 0,
  opacity: 1,
  cornerRadius: 0,
  visible: true,
  locked: false,
};
const content = serializeDesignDocument(
  normalizeDesignDocument({
    format: "codeshell.design",
    version: 3,
    name: "Large viewport",
    canvas: { width: 1200, height: 1000, background: "#ffffff" },
    tokens: { colors: [] },
    activePageId: "page-1",
    pages: [
      {
        id: "page-1",
        name: "Home",
        children: [
          {
            ...base,
            id: "board",
            type: "frame",
            name: "Board",
            x: 10,
            y: 10,
            width: 1150,
            height: 950,
            fill: "#ffffff",
            clipContent: false,
            layout: "none",
            gap: 0,
            padding: 0,
            alignItems: "start",
            justifyContent: "start",
            gridColumns: 1,
            children: Array.from({ length: 1000 }, (_, i) => ({
              ...base,
              id: `tile-${i}`,
              name: `Tile ${i}`,
              x: 30 + (i % 40) * 27,
              y: 40 + Math.floor(i / 40) * 30,
            })),
          },
        ],
      },
    ],
  }),
);

async function fixture(t) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url()),
      file = resolve(root, "." + url.pathname);
    if (url.origin !== "https://viewport.test" || !file.startsWith(root + sep))
      return route.abort();
    try {
      await route.fulfill({
        body: await readFile(file),
        contentType: {
          ".html": "text/html",
          ".js": "text/javascript",
          ".mjs": "text/javascript",
          ".css": "text/css",
          ".json": "application/json",
        }[extname(file)],
      });
    } catch {
      await route.fulfill({ status: 404, body: "missing" });
    }
  });
  await page.addInitScript(
    ({ path, content }) => {
      if (window.top === window)
        localStorage.setItem("codeshell-design-studio:file:" + path, content);
    },
    { path, content },
  );
  await page.goto("https://viewport.test/index.html");
  await page.waitForFunction(
    () =>
      !document.querySelector(".workspace").inert &&
      document.querySelector('[data-node-id="tile-999"]'),
  );
  await settle(page);
  return { page, errors };
}
async function settle(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
async function observe(page) {
  await page.evaluate(() => {
    window.viewportReferences = {
      visual: document.querySelector('#scene > g[data-node-id="tile-0"]'),
      row: document.querySelector('.layer-row[data-id="tile-0"]'),
      scene: document.querySelector("#scene"),
    };
    window.viewportMutations = { scene: 0, layers: 0 };
    for (const [key, selector] of [
      ["scene", "#scene"],
      ["layers", "#layers-list"],
    ]) {
      const target = document.querySelector(selector);
      if (target)
        new MutationObserver(
          (records) =>
            (window.viewportMutations[key] += records.filter((r) => r.type === "childList").length),
        ).observe(target, { childList: true });
    }
  });
}
async function assertRetained(page) {
  const state = await page.evaluate(() => ({
    sameVisual:
      window.viewportReferences.visual ===
      document.querySelector('#scene > g[data-node-id="tile-0"]'),
    sameRow:
      window.viewportReferences.row === document.querySelector('.layer-row[data-id="tile-0"]'),
    count: document.querySelectorAll("#scene > g[data-node-id]").length,
    mutations: window.viewportMutations,
    saved: localStorage.getItem("codeshell-design-studio:file:designs/viewport.codesign.json"),
  }));
  assert.equal(state.sameVisual, true);
  assert.equal(state.sameRow, true);
  assert.equal(state.count, 1001);
  assert.equal(state.mutations.scene, 0);
  assert.equal(state.mutations.layers, 0);
  assert.equal(state.saved, content);
}

test("large-document wheel pan and zoom retain design visuals and layer rows, including across label threshold", async (t) => {
  const { page, errors } = await fixture(t);
  await page.locator('.layer-row[data-id="tile-0"]').click();
  await settle(page);
  const handleBefore = await page.locator('#scene [data-handle="nw"]').boundingBox();
  assert.ok(handleBefore);
  await observe(page);
  const original = await page.locator("#scene").getAttribute("transform");
  await page
    .locator("#stage")
    .dispatchEvent("wheel", { deltaX: 15, deltaY: 40, clientX: 650, clientY: 350 });
  await settle(page);
  assert.notEqual(await page.locator("#scene").getAttribute("transform"), original);
  await assertRetained(page);
  for (let i = 0; i < 5; i++) {
    await page.locator("#zoom-out").click();
    await settle(page);
  }
  await assertRetained(page);
  for (let i = 0; i < 5; i++) {
    await page.locator("#zoom-in").click();
    await settle(page);
  }
  await assertRetained(page);
  const handleAfter = await page.locator('#scene [data-handle="nw"]').boundingBox();
  assert.ok(
    Math.abs(handleAfter.width - handleBefore.width) < 0.2,
    "resize handles retain their screen size",
  );
  assert.deepEqual(errors, []);
});

test("middle-button pan and cancelled hand gestures retain visuals and restore the original viewport", async (t) => {
  const { page, errors } = await fixture(t);
  await observe(page);
  const box = await page.locator("#stage").boundingBox(),
    start = await page.locator("#scene").getAttribute("transform");
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box.x + 250, box.y + 230, { steps: 6 });
  await page.mouse.up({ button: "middle" });
  await settle(page);
  assert.notEqual(await page.locator("#scene").getAttribute("transform"), start);
  await assertRetained(page);
  await page.locator('[data-tool="hand"]').click();
  await settle(page);
  const before = await page.locator("#scene").getAttribute("transform");
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 270);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await settle(page);
  assert.equal(await page.locator("#scene").getAttribute("transform"), before);
  await assertRetained(page);
  assert.deepEqual(errors, []);
});

test("panning never resurrects the selection badge of a hidden layer", async (t) => {
  const { page, errors } = await fixture(t);
  const row = page.locator('.layer-row[data-id="tile-0"]');
  await row.click();
  await row.locator(".layer-visibility").click();
  await settle(page);
  assert.equal(await page.locator("#selection-size").isHidden(), true);
  await page.locator("#stage").dispatchEvent("wheel", { deltaY: 25 });
  await settle(page);
  assert.equal(await page.locator("#selection-size").isHidden(), true);
  await page.locator("#zoom-in").click();
  await settle(page);
  assert.equal(await page.locator("#selection-size").isHidden(), true);
  assert.deepEqual(errors, []);
});

test("cancelling pan restores a selection changed by a keyboard command during the gesture", async (t) => {
  const { page, errors } = await fixture(t);
  await page.locator('.layer-row[data-id="tile-0"]').click();
  const box = await page.locator("#stage").boundingBox();
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down({ button: "middle" });
  await page.keyboard.press("Control+a");
  assert.equal(await page.locator('.layer-row[aria-selected="true"]').count(), 1001);
  await page.keyboard.press("Escape");
  await page.mouse.up({ button: "middle" });
  await settle(page);
  assert.equal(await page.locator('.layer-row[aria-selected="true"]').count(), 1);
  assert.equal(
    await page.locator('.layer-row[data-id="tile-0"]').getAttribute("aria-selected"),
    "true",
  );
  assert.equal(await page.locator('#scene [data-handle="nw"]').count(), 1);
  assert.deepEqual(errors, []);
});
