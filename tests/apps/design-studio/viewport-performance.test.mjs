import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import {
  launchCanvasBrowser,
  canvasMime,
  gpuActive,
  observeLocalTools,
  viewport,
  handlePixels,
} from "./fixtures/canvas-test-observations.mjs";
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
  const browser = await launchCanvasBrowser();
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
      let body = await readFile(file);
      if (url.pathname === "/canvas/canvaskit-renderer.mjs")
        body = `${body.toString()}
const createRendererForViewportTest = createRenderer;
createRenderer = async (...args) => {
  window.viewportRendererCreates = (window.viewportRendererCreates ?? 0) + 1;
  const renderer = await createRendererForViewportTest(...args);
  return { ...renderer, setScene(...sceneArgs) {
    window.viewportSceneBuilds = (window.viewportSceneBuilds ?? 0) + 1;
    return renderer.setScene(...sceneArgs);
  }};
};`;
      await route.fulfill({
        body,
        contentType: canvasMime[extname(file)],
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
  await observeLocalTools(page);
  await page.goto("https://viewport.test/index.html");
  await page.waitForFunction(
    () =>
      !document.querySelector(".workspace").inert &&
      document.querySelector('.layer-row[data-id="tile-999"]'),
  );
  await gpuActive(page);
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
      visual: document.querySelector("#gpu-canvas"),
      row: document.querySelector('.layer-row[data-id="tile-0"]'),
      scene: document.querySelector("#stage"),
    };
    window.viewportMutations = { scene: 0, layers: 0 };
    window.viewportCloneCount = 0;
    window.viewportInitialBuilds = window.viewportSceneBuilds;
    window.viewportInitialCreates = window.viewportRendererCreates;
    const clone = window.structuredClone;
    window.structuredClone = (...args) => {
      window.viewportCloneCount++;
      return clone(...args);
    };
    for (const [key, selector] of [
      ["scene", "#stage-wrap"],
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
    sameVisual: window.viewportReferences.visual === document.querySelector("#gpu-canvas"),
    sameRow:
      window.viewportReferences.row === document.querySelector('.layer-row[data-id="tile-0"]'),
    sameOverlay: window.viewportReferences.scene === document.querySelector("#stage"),
    count: document.querySelectorAll(".layer-row[data-id]").length,
    clones: window.viewportCloneCount,
    builds: window.viewportSceneBuilds - window.viewportInitialBuilds,
    creates: window.viewportRendererCreates - window.viewportInitialCreates,
    mutations: window.viewportMutations,
    saved: localStorage.getItem("codeshell-design-studio:file:designs/viewport.codesign.json"),
  }));
  assert.equal(state.sameVisual, true);
  assert.equal(state.sameRow, true);
  assert.equal(state.sameOverlay, true);
  assert.equal(state.clones, 0, "viewport changes must not serialize or clone the design");
  assert.equal(state.builds, 0, "viewport changes must reuse the existing scene");
  assert.equal(state.creates, 0, "viewport changes must reuse the WebGL renderer");
  assert.equal(state.count, 1001);
  assert.equal(state.mutations.scene, 0);
  assert.equal(state.mutations.layers, 0);
  assert.equal(state.saved, content);
}

test("large-document wheel pan and zoom retain design visuals and layer rows, including across label threshold", async (t) => {
  const { page, errors } = await fixture(t);
  await page.locator('.layer-row[data-id="tile-0"]').click();
  await settle(page);
  const handleBefore = await handlePixels(page, { x: 30, y: 40 });
  assert.ok(handleBefore);
  await observe(page);
  const original = JSON.stringify(await viewport(page));
  await page
    .locator("#stage")
    .dispatchEvent("wheel", { deltaX: 15, deltaY: 40, clientX: 650, clientY: 350 });
  await settle(page);
  assert.notEqual(JSON.stringify(await viewport(page)), original);
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
  const handleAfter = await handlePixels(page, { x: 30, y: 40 });
  assert.ok(
    handleAfter && Math.abs(handleAfter.width - handleBefore.width) <= 1,
    "resize handles retain their screen size",
  );
  assert.deepEqual(errors, []);
});

test("middle-button pan and cancelled hand gestures retain visuals and restore the original viewport", async (t) => {
  const { page, errors } = await fixture(t);
  await observe(page);
  const box = await page.locator("#stage").boundingBox(),
    start = JSON.stringify(await viewport(page));
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box.x + 250, box.y + 230, { steps: 6 });
  await page.mouse.up({ button: "middle" });
  await settle(page);
  assert.notEqual(JSON.stringify(await viewport(page)), start);
  await assertRetained(page);
  await page.locator('[data-tool="hand"]').click();
  await settle(page);
  const before = JSON.stringify(await viewport(page));
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 270);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await settle(page);
  assert.equal(JSON.stringify(await viewport(page)), before);
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
  assert.ok(
    await handlePixels(page, { x: 30, y: 40 }),
    "the restored selection has a visible Canvas resize handle",
  );
  assert.deepEqual(errors, []);
});
