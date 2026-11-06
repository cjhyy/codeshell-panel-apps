import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  launchCanvasBrowser,
  canvasMime,
  gpuActive,
  frames,
  metadata,
  viewport,
  readNode,
  canvasPoint,
  clickWorld,
  worldPixel,
  nearColor,
  rotatePoint,
} from "./fixtures/canvas-test-observations.mjs";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
} from "../../../apps/design-studio/app/document.mjs";
import { importFigmaJson } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { longFigmaSource } from "./fixtures/long-canvas.mjs";

const root = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));
const path = "designs/render-index.codesign.json";
const node = (id, type, x, y, width, height, extra = {}) => ({
  id,
  type,
  name: id,
  x,
  y,
  width,
  height,
  fill: ["group", "instance"].includes(type) ? "transparent" : "#555555",
  stroke: "transparent",
  strokeWidth: 0,
  opacity: 1,
  rotation: 0,
  cornerRadius: 0,
  visible: true,
  locked: false,
  ...(["frame", "component", "group"].includes(type)
    ? { layout: "none", gap: 0, padding: 0, alignItems: "start", justifyContent: "start" }
    : {}),
  ...extra,
});

function documentFixture() {
  return normalizeDesignDocument({
    format: "codeshell.design",
    version: 3,
    name: "Indexed render",
    canvas: { width: 1000, height: 600, background: "#ffffff" },
    tokens: { colors: [] },
    resources: [],
    activePageId: "page-1",
    pages: [
      {
        id: "page-1",
        name: "Active",
        children: [
          node("active-parent", "frame", 20, 20, 300, 300, {
            rotation: 20,
            opacity: 0.5,
            locked: true,
            clipContent: true,
            children: [
              node("active-child", "rectangle", 40, 60, 80, 40, { rotation: 5, opacity: 0.6 }),
              node("hidden-child", "rectangle", 80, 90, 30, 30, { visible: false }),
            ],
          }),
          node("instance", "instance", 500, 100, 200, 100, { componentId: "component" }),
        ],
      },
      {
        id: "page-2",
        name: "Components",
        children: [
          node("source-ancestor", "frame", 10, 20, 400, 300, {
            rotation: 30,
            opacity: 0.2,
            locked: true,
            visible: false,
            clipContent: true,
            children: [
              node("component", "component", 30, 40, 200, 100, {
                rotation: 15,
                opacity: 0.5,
                clipContent: true,
                children: [
                  node("component-child", "rectangle", 60, 70, 50, 30, {
                    opacity: 0.8,
                    rotation: 7,
                  }),
                ],
              }),
            ],
          }),
        ],
      },
    ],
  });
}

async function fixture(t, document, { instrument = false, dpr = 1 } = {}) {
  const browser = await launchCanvasBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1500, height: 960 }, deviceScaleFactor: dpr });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url()),
      file = resolve(root, `.${url.pathname}`);
    if (url.origin !== "https://render.test" || !file.startsWith(root + sep)) return route.abort();
    try {
      let body = await readFile(file);
      if (instrument && url.pathname === "/app.js")
        body = `${body.toString()}\nconst originalRenderSceneForTest = renderScene;
renderScene = function (...args) {
  window.__rendering = true;
  window.__fullMaps = 0;
  const started = performance.now();
  try { return originalRenderSceneForTest(...args); }
  finally {
    window.__rendering = false;
    (window.__renderSamples ??= []).push({ fullMaps: window.__fullMaps, ms: performance.now() - started });
  }
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
    ({ source, path, instrument, count }) => {
      if (instrument) {
        const NativeMap = window.Map;
        window.Map = class extends NativeMap {
          constructor(values) {
            super(values);
            if (window.__rendering && Array.isArray(values) && values.length === count)
              window.__fullMaps += 1;
          }
        };
      }
      const records = new Map();
      window.tools = {};
      window.codeshellPanel = {
        getContext: async () => ({
          trusted: true,
          capabilities: { packageAssets: { wasm: true } },
          busy: false,
          cwd: "/fixture",
          sessionId: "render-fixture",
          availableMethods: [
            "workspace.info",
            "workspace.list",
            "workspace.readText",
            "storage.get",
            "storage.set",
            "storage.getSnapshot",
            "storage.compareAndSet",
          ],
        }),
        on() {},
        registerTool(name, callback) {
          window.tools[name] = callback;
        },
        async call(method, params = {}) {
          if (method === "workspace.info") return { root: "/fixture", name: "Fixture" };
          if (method === "workspace.list") return { entries: [], truncated: false };
          if (method === "workspace.readText") {
            if (params.path !== path) throw Error("ENOENT");
            return { content: source, modifiedAt: 1, revision: "fixture" };
          }
          if (method === "storage.get")
            return params.key.startsWith("lastPath.")
              ? { workspaceRoot: "/fixture", path }
              : (records.get(params.key) ?? null);
          if (method === "storage.set") {
            records.set(params.key, params.value);
            return null;
          }
          if (method === "storage.getSnapshot")
            return { exists: false, value: null, revision: null };
          if (method === "storage.compareAndSet") {
            records.set(params.key, params.value);
            return {
              updated: true,
              snapshot: { exists: true, value: params.value, revision: "saved" },
            };
          }
          throw Error(`Unavailable ${method}`);
        },
      };
    },
    { source: serializeDesignDocument(document), path, instrument, count: document.nodes.length },
  );
  await page.goto("https://render.test/index.html");
  await page.waitForFunction(
    () => !document.querySelector(".workspace").inert && Boolean(window.tools.get_design_metadata),
  );
  await gpuActive(page);
  return { page, errors };
}

test("a render-local index preserves ancestor rotation, clipping, opacity and locks", async (t) => {
  const { page, errors } = await fixture(t, documentFixture());
  const parent = await readNode(page, "active-parent"),
    child = await readNode(page, "active-child");
  assert.equal(parent.clipContent, true);
  assert.equal(parent.rotation, 20);
  assert.equal(child.rotation, 5);
  assert.equal(parent.opacity * child.opacity, 0.3);
  const center = rotatePoint({ x: 80, y: 80 }, { x: 170, y: 170 }, 20);
  nearColor(await worldPixel(page, center), [145, 145, 145]);
  const hiddenCenter = rotatePoint({ x: 95, y: 105 }, { x: 170, y: 170 }, 20);
  assert.equal((await readNode(page, "hidden-child")).visible, false);
  nearColor(await worldPixel(page, hiddenCenter), [170, 170, 170]);
  await clickWorld(page, center);
  assert.deepEqual((await metadata(page)).selection, ["active-child"]);
  const lockedPoint = await canvasPoint(page, center);
  await page.mouse.move(lockedPoint.x, lockedPoint.y);
  await page.mouse.down();
  await page.mouse.move(lockedPoint.x + 30, lockedPoint.y + 20, { steps: 3 });
  await page.mouse.up();
  assert.equal((await readNode(page, "active-child")).x, child.x);
  assert.equal((await readNode(page, "active-child")).y, child.y);
  await page.locator('.layer-row[data-id="active-parent"]').click();
  await page.locator("#toggle-lock").click();
  await page.locator("#prop-opacity").fill("25");
  await page.locator("#prop-rotation").fill("40");
  await page.locator("#prop-rotation").press("Tab");
  await gpuActive(page);
  const changed = await readNode(page, "active-parent");
  assert.equal(changed.rotation, 40);
  assert.equal(changed.opacity * child.opacity, 0.15);
  const moved = rotatePoint({ x: 80, y: 80 }, { x: 170, y: 170 }, 40);
  nearColor(await worldPixel(page, moved), [193, 193, 193]);
  await clickWorld(page, moved);
  assert.deepEqual((await metadata(page)).selection, ["active-child"]);
  const unlockedPoint = await canvasPoint(page, moved);
  await page.mouse.move(unlockedPoint.x, unlockedPoint.y);
  await page.mouse.down();
  await page.mouse.move(unlockedPoint.x + 30, unlockedPoint.y + 20, { steps: 3 });
  await page.mouse.up();
  assert.notEqual((await readNode(page, "active-child")).x, child.x);
  await page.locator("#stage").press("Control+z");
  assert.equal((await readNode(page, "active-child")).x, child.x);
  // Shrinking the clip must hide the protruding child, including hit testing.
  await page.locator('.layer-row[data-id="active-parent"]').click();
  await page.locator("#prop-width").fill("30");
  await gpuActive(page);
  assert.equal((await readNode(page, "active-parent")).width, 30);
  const clipped = rotatePoint({ x: 80, y: 80 }, { x: 35, y: 170 }, 40);
  nearColor(await worldPixel(page, clipped), [255, 255, 255]);
  await page.locator("#prop-width").press("Tab");
  await clickWorld(page, clipped);
  assert.ok(!(await metadata(page)).selection.includes("active-child"));
  assert.deepEqual(errors, []);
});

test("a detached cross-page component uses its own index and excludes the source's outside ancestors", async (t) => {
  const { page, errors } = await fixture(t, documentFixture(), { dpr: 2 });
  const ancestor = await readNode(page, "source-ancestor");
  assert.equal(ancestor.visible, false);
  assert.equal(ancestor.locked, true);
  const childCenter = rotatePoint({ x: 85, y: 85 }, { x: 130, y: 90 }, 15);
  const renderedCenter = { x: childCenter.x + 470, y: childCenter.y + 60 };
  nearColor(await worldPixel(page, renderedCenter), [136, 136, 136]);
  await clickWorld(page, renderedCenter);
  assert.deepEqual((await metadata(page)).selection, ["instance"]);
  assert.equal(await page.locator("#prop-x").isDisabled(), false);
  await page.evaluate(() => {
    window.addEventListener("wheel", (event) => {
      window.__instanceWheel = { deltaX: event.deltaX, isTrusted: event.isTrusted };
    }, { capture: true });
    const strokeRect = CanvasRenderingContext2D.prototype.strokeRect;
    CanvasRenderingContext2D.prototype.strokeRect = function (x, y, width, height) {
      if (this.canvas.id === "stage" && this.strokeStyle === "#4f7cff") {
        const m = this.getTransform();
        window.__instanceOverlay = {
          x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f,
          width: m.a * width, height: m.d * height,
        };
      }
      return strokeRect.call(this, x, y, width, height);
    };
  });
  const before = await viewport(page);
  const pointer = await canvasPoint(page, renderedCenter);
  await page.mouse.move(pointer.x, pointer.y);
  // Chromium scales the CDP wheel input by DPR; assert the actual trusted DOM event.
  await page.mouse.wheel(3.25 * 2, 0);
  await page.waitForFunction((x) => Math.abs(
    document.querySelector("#stage").getContext("2d").getTransform().e / devicePixelRatio - x + 3.25,
  ) < 0.01, before.pan.x);
  await frames(page);
  await clickWorld(page, renderedCenter);
  await frames(page);
  nearColor(await worldPixel(page, renderedCenter), [136, 136, 136]);
  assert.deepEqual((await metadata(page)).selection, ["instance"]);
  const after = await viewport(page);
  const proof = await page.evaluate(() => ({ wheel: window.__instanceWheel, overlay: window.__instanceOverlay }));
  assert.deepEqual(proof.wheel, { deltaX: 3.25, isTrusted: true });
  assert.ok(Math.abs(after.pan.x - before.pan.x + 3.25) < 0.01);
  const expected = {
    x: (500 * after.zoom + after.pan.x) * 2,
    y: (100 * after.zoom + after.pan.y) * 2,
    width: 200 * after.zoom * 2, height: 100 * after.zoom * 2,
  };
  assert.ok(proof.overlay, "selected instance must draw an overlay");
  const maximumDeviceDelta = Math.max(...Object.keys(expected).map((key) => Math.abs(expected[key] - proof.overlay[key])));
  assert.ok(maximumDeviceDelta <= 0.5, JSON.stringify({ ...proof, expected, maximumDeviceDelta }));
  if (process.env.DESIGN_INSTANCE_EVIDENCE) {
    const folder = resolve(process.env.DESIGN_INSTANCE_EVIDENCE);
    await mkdir(folder, { recursive: true });
    await page.screenshot({ path: resolve(folder, "dpr2-fractional-instance-gui.png") });
    await writeFile(resolve(folder, "report.json"), JSON.stringify({ before, after, ...proof, expected, maximumDeviceDelta }, null, 2));
  }
  assert.deepEqual(errors, []);
});

test("a 1208-layer real browser render builds one shared full index rather than one per node", async (t) => {
  const document = importFigmaJson(longFigmaSource()).document;
  const { page, errors } = await fixture(t, document, { instrument: true });
  const before = await page.evaluate(() => window.tools.get_design_metadata({}));
  // Grid toggles repaint interaction chrome while preserving the document revision.
  await page.locator("#toggle-grid").click();
  await page.locator("#toggle-grid").click();
  const samples = await page.evaluate(() => window.__renderSamples);
  assert.ok(samples.length >= 3);
  assert.ok(
    samples.every((sample) => sample.fullMaps <= 8),
    JSON.stringify(samples),
  );
  assert.equal((await metadata(page)).layers.length, 1208);
  await gpuActive(page);
  const view = await viewport(page),
    box = await page.locator("#stage").boundingBox();
  const middleRow = Math.max(
    0,
    Math.min(75, Math.round(((box.height / 2 - view.pan.y) / view.zoom - 44) / 144)),
  );
  nearColor(await worldPixel(page, { x: 71, y: 44 + middleRow * 144 }), [26, 77, 179], 12);
  const after = await page.evaluate(() => window.tools.get_design_metadata({}));
  assert.equal(after.stateRevision, before.stateRevision);
  assert.deepEqual(errors, []);
  t.diagnostic(`render samples: ${JSON.stringify(samples)}`);
});
