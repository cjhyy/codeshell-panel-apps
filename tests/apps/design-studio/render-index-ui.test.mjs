import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
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

async function fixture(t, document, { instrument = false } = {}) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1500, height: 960 } });
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
        contentType: {
          ".js": "text/javascript",
          ".mjs": "text/javascript",
          ".html": "text/html",
          ".css": "text/css",
        }[extname(file)],
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
  await page.waitForFunction(() => document.querySelector("#scene [data-node-id]"));
  return { page, errors };
}

test("a render-local index preserves ancestor rotation, clipping, opacity and locks", async (t) => {
  const { page, errors } = await fixture(t, documentFixture());
  const actual = await page
    .locator('#scene g[data-node-id="active-child"] > g > rect')
    .evaluate((element) => ({
      opacity: element.parentElement.getAttribute("opacity"),
      transform: element.parentElement.getAttribute("transform"),
      clip: element.parentElement.getAttribute("clip-path"),
      pointer: element.style.pointerEvents,
    }));
  assert.equal(actual.opacity, "0.3");
  assert.equal(actual.transform, "rotate(20 170 170) rotate(5 80 80)");
  assert.match(actual.clip, /^url\(#frame-clip-\d+\)$/u);
  assert.equal(actual.pointer, "visiblepainted");
  assert.equal(await page.locator('#scene [data-node-id="hidden-child"]').count(), 0);
  await page.locator('.layer-row[data-id="active-parent"]').click();
  await page.locator("#toggle-lock").click();
  await page.locator("#prop-opacity").fill("25");
  await page.locator("#prop-rotation").fill("40");
  const changed = await page
    .locator('#scene g[data-node-id="active-child"] > g > rect')
    .evaluate((element) => ({
      opacity: element.parentElement.getAttribute("opacity"),
      transform: element.parentElement.getAttribute("transform"),
      pointer: element.style.pointerEvents,
    }));
  assert.equal(changed.opacity, "0.15");
  assert.equal(changed.transform, "rotate(40 170 170) rotate(5 80 80)");
  assert.equal(changed.pointer, "all");
  assert.deepEqual(errors, []);
});

test("a detached cross-page component uses its own index and excludes the source's outside ancestors", async (t) => {
  const { page, errors } = await fixture(t, documentFixture());
  const actual = await page
    .locator('#scene [data-component-node-id="component-child"]')
    .evaluate((element) => ({
      opacity: element.closest("g[opacity]").getAttribute("opacity"),
      transform: element.closest("g[transform]").getAttribute("transform"),
      pointer: element.style.pointerEvents,
    }));
  assert.equal(actual.opacity, "0.4");
  assert.equal(actual.transform, "rotate(15 130 90) rotate(7 85 85)");
  assert.equal(actual.pointer, "all");
  assert.deepEqual(errors, []);
});

test("a 1208-layer real browser render builds one shared full index rather than one per node", async (t) => {
  const document = importFigmaJson(longFigmaSource()).document;
  const { page, errors } = await fixture(t, document, { instrument: true });
  const before = await page.evaluate(() => window.tools.get_design_metadata({}));
  await page.locator("#zoom-out").click();
  await page.locator("#zoom-in").click();
  const samples = await page.evaluate(() => window.__renderSamples);
  assert.ok(samples.length >= 3);
  assert.ok(
    samples.every((sample) => sample.fullMaps <= 8),
    JSON.stringify(samples),
  );
  assert.equal(await page.locator("#scene > g[data-node-id]").count(), 1208);
  const after = await page.evaluate(() => window.tools.get_design_metadata({}));
  assert.equal(after.stateRevision, before.stateRevision);
  assert.deepEqual(errors, []);
  t.diagnostic(`render samples: ${JSON.stringify(samples)}`);
});
