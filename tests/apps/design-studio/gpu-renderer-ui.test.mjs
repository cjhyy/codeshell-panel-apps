import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
} from "../../../apps/design-studio/app/document.mjs";

const root = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));
const origin = "https://gpu-renderer.test";
const path = "designs/gpu-renderer.codesign.json";
const csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; object-src 'none'; base-uri 'none'";
const hash = (value) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const node = (id, type, x, y, width, height, extra = {}) => ({
  id, type, name: id, x, y, width, height,
  fill: "#000000", stroke: "transparent", strokeWidth: 0,
  opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false,
  ...(["frame", "component", "group"].includes(type)
    ? { layout: "none", gap: 0, padding: 0, alignItems: "start", justifyContent: "start" }
    : {}),
  ...extra,
});

function designFixture({ large = false } = {}) {
  return normalizeDesignDocument({
    format: "codeshell.design", version: 3, name: "GPU editor fixture",
    canvas: { width: 1000, height: 700, background: "#ffffff" },
    tokens: { colors: [] }, resources: [], activePageId: "page-1",
    pages: [
      { id: "page-1", name: "Shapes", children: [
        node("red", "rectangle", 100, 100, 100, 80, { fill: "#ff0000" }),
        node("rotated", "rectangle", 330, 100, 100, 24, { fill: "#0000ff", rotation: 90 }),
        node("heading", "text", 120, 300, 280, 60, {
          text: "WWWWWW", fontFamily: "Arial", fontSize: 40, fontWeight: 700,
          lineHeight: 1.2, textAlign: "left",
        }),
        node("clip", "frame", 560, 100, 200, 130, {
          fill: "transparent", opacity: 0.5, clipContent: true,
          children: [node("orange", "rectangle", 520, 80, 300, 180, { fill: "#ff8000", opacity: 0.5 })],
        }),
        node("gradient", "rectangle", 350, 450, 120, 70, {
          fillPaints: [{ type: "GRADIENT_LINEAR", opacity: 1,
            handles: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, { x: 0, y: 1 }],
            stops: [{ position: 0, color: "#000000", opacity: 1 }, { position: 1, color: "#ffffff", opacity: 1 }],
          }],
        }),
        node("far", "ellipse", 760, 500, 100, 80, { fill: "#00cc00" }),
        ...(large ? Array.from({ length: 300 }, (_, i) =>
          node(`bulk-${i}`, "rectangle", 20 + i % 100, 650, 1, 1, { fill: "#777777" })) : []),
      ] },
      { id: "page-2", name: "Other colors", children: [
        node("cyan", "rectangle", 100, 100, 100, 80, { fill: "#00aaff" }),
        node("magenta", "ellipse", 760, 500, 100, 80, { fill: "#ff00ff" }),
      ] },
    ],
  });
}

async function fixture(t, { capable = true, large = false } = {}) {
  // This is a correctness test. SwiftShader is allowed as the WebGL driver; no physical-GPU speed is claimed.
  const browser = await chromium.launch({ headless: true, args: ["--enable-webgl", "--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({ viewport: { width: 1500, height: 960 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const source = serializeDesignDocument(designFixture({ large }));
  const records = new Map(), calls = [], errors = [], vendorRequests = [], blockedRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(async () => {
    try {
      assert.deepEqual(errors, [], "uncaught browser errors");
      assert.deepEqual(blockedRequests, [], "all fixture requests stay in the exact package origin");
      assert.deepEqual(await page.evaluate(() => window.cspViolations), [], "Wasm-specific CSP must suffice without unsafe-eval");
      assert.equal(calls.filter((call) => call.method === "workspace.writeText").length, 0);
    } finally { await browser.close(); }
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (url.origin !== origin || !file.startsWith(root + sep)) {
      blockedRequests.push(url.href);
      return route.abort();
    }
    if (url.pathname.startsWith("/canvas/vendor/")) vendorRequests.push(url.pathname);
    try {
      await route.fulfill({ body: await readFile(file), headers: { "Content-Security-Policy": csp },
        contentType: { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript",
          ".css": "text/css", ".wasm": "application/wasm", ".ttf": "font/ttf", ".woff2": "font/woff2" }[extname(file)],
      });
    } catch {
      await route.fulfill({ status: 404, body: "missing", headers: { "Content-Security-Policy": csp } });
    }
  });
  await page.exposeFunction("hostBridge", async (method, params = {}) => {
    calls.push({ method, ...structuredClone(params) });
    const snapshot = () => ({ exists: records.has(params.key), value: records.get(params.key) ?? null,
      revision: records.has(params.key) ? hash(records.get(params.key)) : null });
    if (method === "workspace.info") return { root: "/gpu-fixture", cwd: "/gpu-fixture", name: "Fixture" };
    if (method === "workspace.list") return { entries: [], truncated: false };
    if (method === "workspace.readText") {
      if (params.path !== path) throw Error("ENOENT");
      return { content: source, modifiedAt: 1, revision: hash(source) };
    }
    // The source design is immutable. All recovery/preferences live in this in-memory fake Host.
    if (method === "workspace.writeText") throw Error("Test must not write the saved source design");
    if (method === "storage.get") return params.key.startsWith("lastPath.")
      ? { workspaceRoot: "/gpu-fixture", path } : records.get(params.key) ?? null;
    if (method === "storage.set") { records.set(params.key, structuredClone(params.value)); return null; }
    if (method === "storage.delete") { records.delete(params.key); return null; }
    if (method === "storage.getSnapshot") return snapshot();
    if (method === "storage.compareAndSet") {
      if (params.expectedRevision !== snapshot().revision) return { updated: false, snapshot: snapshot() };
      if (params.remove) records.delete(params.key); else records.set(params.key, structuredClone(params.value));
      return { updated: true, snapshot: snapshot() };
    }
    throw Error(`Unsupported ${method}`);
  });
  await page.addInitScript(({ capable }) => {
    window.tools = {};
    window.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      window.cspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI }));
    window.codeshellPanel = {
      getContext: async () => ({ trusted: true, busy: false, cwd: "/gpu-fixture", sessionId: "gpu-fixture",
        capabilities: { packageAssets: { wasm: capable, fetch: "package" } },
        availableMethods: ["workspace.info", "workspace.list", "workspace.readText", "workspace.writeText",
          "storage.get", "storage.set", "storage.delete", "storage.getSnapshot", "storage.compareAndSet"],
      }),
      on() {},
      registerTool(name, callback) { window.tools[name] = callback; },
      call: (method, params) => window.hostBridge(method, params),
    };
  }, { capable });
  await page.goto(`${origin}/index.html`);
  await page.waitForFunction(() => !document.querySelector(".workspace").inert &&
    Boolean(window.tools.get_design_metadata) && document.querySelector('#scene [data-node-id="red"]'));
  const f = { page, source, records, calls, errors, vendorRequests, blockedRequests };
  return f;
}

async function active(page, expected = true, reason) {
  await page.waitForFunction(({ expected, reason }) =>
    document.querySelector("#stage-wrap").dataset.gpuActive === String(expected) &&
    (!reason || document.querySelector("#renderer-state").title.includes(reason)), { expected, reason });
  assert.equal(await page.locator("#gpu-canvas").isVisible(), expected);
}
async function enableGpu(page) {
  await page.locator("#canvas-renderer").selectOption("gpu");
  await active(page);
}
async function shot(page) { return PNG.sync.read(await page.locator("#gpu-canvas").screenshot()); }
async function screenPoint(page, x, y) {
  return page.evaluate(({ x, y }) => {
    const p = new DOMPoint(x, y).matrixTransform(document.querySelector("#scene").getScreenCTM());
    const bounds = document.querySelector("#gpu-canvas").getBoundingClientRect();
    return { x: p.x, y: p.y, px: Math.round(p.x - bounds.x), py: Math.round(p.y - bounds.y) };
  }, { x, y });
}
const pixel = (png, x, y) => {
  assert(x >= 0 && x < png.width && y >= 0 && y < png.height, `pixel ${x},${y} is within ${png.width}x${png.height}`);
  return [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
};
function near(actual, expected, tolerance = 6) {
  assert(actual.every((value, i) => Math.abs(value - expected[i]) <= tolerance), `${actual} != ${expected}`);
}
async function at(page, png, x, y) {
  const point = await screenPoint(page, x, y);
  return pixel(png, point.px, point.py);
}
async function textInk(page, png) {
  const a = await screenPoint(page, 120, 300), b = await screenPoint(page, 400, 360);
  let count = 0;
  for (let y = a.py; y < b.py; y++) for (let x = a.px; x < b.px; x++)
    if (pixel(png, x, y).every((value) => value < 100)) count++;
  return count;
}
async function readNode(page, id) {
  return page.evaluate(async (id) => (await window.tools.get_design_context({ node_id: id })).node, id);
}

test("the real GPU scene preserves shapes, clipped alpha, rotation, gradient and text under strict CSP", async (t) => {
  const f = await fixture(t);
  await enableGpu(f.page);
  assert(f.vendorRequests.includes("/canvas/vendor/canvaskit.js"));
  assert(f.vendorRequests.includes("/canvas/vendor/canvaskit.wasm"));
  assert.equal(await f.page.locator("#gpu-canvas").evaluate((canvas) => Boolean(canvas.getContext("webgl2"))), true);
  const png = await shot(f.page);
  near(await at(f.page, png, 150, 140), [255, 0, 0]);
  near(await at(f.page, png, 380, 140), [0, 0, 255]);
  near(await at(f.page, png, 335, 105), [255, 255, 255]);
  near(await at(f.page, png, 600, 150), [255, 223, 191]);
  near(await at(f.page, png, 540, 150), [255, 255, 255]);
  near(await at(f.page, png, 410, 480), [128, 128, 128], 10);
  near(await at(f.page, png, 810, 540), [0, 204, 0]);
  assert(await textInk(f.page, png) > 300, "the complete heading has real glyph pixels");
  assert.equal(await f.page.locator('#scene [data-text-node-id="heading"]').textContent(), "WWWWWW");
});

test("SVG selection, dragging, inline text and undo update the real GPU picture", async (t) => {
  const { page } = await fixture(t);
  await enableGpu(page);
  await page.locator("#toggle-snap").click();
  await page.locator('.layer-row[data-id="red"]').click();
  assert.equal(await page.locator("#scene [data-scene-overlay] [data-handle]").count(), 4);
  const start = await screenPoint(page, 150, 140);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 150, start.y, { steps: 5 });
  await active(page, false, "editing");
  await page.mouse.up();
  await active(page);
  const moved = await readNode(page, "red");
  assert(moved.x > 200, `drag changed the model x: ${moved.x}`);
  const dragged = await shot(page);
  near(await at(page, dragged, 150, 140), [255, 255, 255]);
  near(await at(page, dragged, moved.x + 50, moved.y + 40), [255, 0, 0]);
  await page.locator("#stage").press("Control+z");
  await active(page);
  assert.equal((await readNode(page, "red")).x, 100);
  near(await at(page, await shot(page), 150, 140), [255, 0, 0]);

  const originalInk = await textInk(page, await shot(page));
  await page.locator('[data-text-node-id="heading"]').dblclick();
  await active(page, false, "editing");
  const editor = page.locator("#inline-text-editor");
  await editor.fill("I");
  await editor.press("Control+Enter");
  await active(page);
  assert.equal((await readNode(page, "heading")).text, "I");
  const changedInk = await textInk(page, await shot(page));
  assert(changedInk > 5 && changedInk < originalInk / 3, `${originalInk} heading pixels became ${changedInk}`);
  await page.locator("#stage").press("Control+z");
  await active(page);
  assert.equal((await readNode(page, "heading")).text, "WWWWWW");
  assert(await textInk(page, await shot(page)) > originalInk * 0.9, "undo restores GPU glyphs");
});

test("page changes replace the GPU scene and zoom/SVG choices preserve the SVG editor", async (t) => {
  const { page, records } = await fixture(t);
  await enableGpu(page);
  await page.locator("#active-page").selectOption("page-2");
  await page.waitForFunction(() => document.querySelector('#scene [data-node-id="cyan"]'));
  await active(page);
  assert.equal((await page.evaluate(() => window.tools.get_design_metadata({}))).activePageId, "page-2");
  const other = await shot(page);
  near(await at(page, other, 150, 140), [0, 170, 255]);
  near(await at(page, other, 810, 540), [255, 0, 255]);
  assert.equal(await page.locator('#scene [data-node-id="red"]').count(), 0);
  await page.locator("#active-page").selectOption("page-1");
  await page.waitForFunction(() => document.querySelector('#scene [data-node-id="red"]'));
  await active(page);
  near(await at(page, await shot(page), 150, 140), [255, 0, 0]);
  while (parseFloat(await page.locator("#zoom-value").textContent()) <= 100)
    await page.locator("#zoom-in").click();
  await active(page, false, "zoom-limit");
  assert.equal(await page.locator('#scene > [data-node-id="red"]').evaluate((el) => getComputedStyle(el).opacity), "1");
  await page.locator("#zoom-out").click();
  await active(page);
  await page.locator("#canvas-renderer").selectOption("svg");
  await active(page, false, "svg");
  await page.locator('.layer-row[data-id="heading"]').click();
  await page.locator("#stage").press("Enter");
  await page.locator("#inline-text-editor").fill("SVG remains editable");
  await page.locator("#inline-text-editor").press("Control+Enter");
  assert.equal((await readNode(page, "heading")).text, "SVG remains editable");
  assert([...records.values()].some((value) => value?.canvasRendererMode === "svg"), "renderer preference is persisted in fake Host storage");
});

test("an unavailable Wasm capability never fetches CanvasKit, including automatic large-scene mode", async (t) => {
  const f = await fixture(t, { capable: false, large: true });
  await active(f.page, false, "wasm-unavailable");
  await f.page.locator("#canvas-renderer").selectOption("gpu");
  await active(f.page, false, "wasm-unavailable");
  assert.deepEqual(f.vendorRequests, [], "neither CanvasKit JS nor Wasm is fetched without Host capability");
  await f.page.locator('.layer-row[data-id="red"]').click();
  assert.equal(await f.page.locator("#scene [data-scene-overlay] [data-handle]").count(), 4);
  assert.equal(await f.page.locator('#scene > [data-node-id="red"]').evaluate((el) => getComputedStyle(el).opacity), "1");
});

test("a real WebGL context loss restores SVG and auto zoom never silently retries the failed renderer", async (t) => {
  const { page, vendorRequests } = await fixture(t, { large: true });
  assert.equal(await page.locator("#canvas-renderer").inputValue(), "auto");
  await active(page);
  assert.equal(await page.locator("#gpu-canvas").evaluate((canvas) => {
    const extension = canvas.getContext("webgl2").getExtension("WEBGL_lose_context");
    if (!extension) return false;
    extension.loseContext();
    return true;
  }), true, "the WebGL driver must support a real context-loss event");
  await active(page, false, "context-lost");
  assert.equal(await page.locator('#scene > [data-node-id="red"]').evaluate((el) => getComputedStyle(el).opacity), "1");
  const requestsBeforeZoom = vendorRequests.length;
  while (parseFloat(await page.locator("#zoom-value").textContent()) <= 100)
    await page.locator("#zoom-in").click();
  await active(page, false, "svg");
  await page.locator("#zoom-out").click();
  await active(page, false, "svg");
  assert.equal(vendorRequests.length, requestsBeforeZoom, "automatic zoom mode changes must not retry a failed GPU context");
  await page.locator('.layer-row[data-id="heading"]').click();
  await page.locator("#stage").press("Enter");
  await page.locator("#inline-text-editor").fill("After loss");
  await page.locator("#inline-text-editor").press("Control+Enter");
  assert.equal((await readNode(page, "heading")).text, "After loss");
  await page.locator("#stage").press("Control+z");
  assert.equal((await readNode(page, "heading")).text, "WWWWWW");
  await page.locator("#canvas-renderer").selectOption("svg");
  await active(page, false, "svg");
});
