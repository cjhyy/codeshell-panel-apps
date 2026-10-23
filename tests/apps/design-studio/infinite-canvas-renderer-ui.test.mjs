import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const root = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));
const origin = "https://infinite-canvas-renderer.test";
const csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:";
const node = (id, x, y, extra = {}) => ({ id, name: id, type: "rectangle", x, y,
  width: 100, height: 100, fill: "#ffffff", stroke: "transparent", strokeWidth: 0,
  opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false, ...extra });
const design = (nodes = [], mode = "infinite") => ({
  canvas: { mode, width: 600, height: 400, background: "#f8f8f8" },
  resources: [], nodes, activePageId: "page-1", pages: [{ id: "page-1", name: "Canvas", nodes }],
});

async function fixture(t, { tileCacheEnabled = true } = {}) {
  const browser = await chromium.launch({ headless: true,
    args: ["--enable-webgl", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 500, height: 400 }, deviceScaleFactor: 1 });
  const errors = [], blocked = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { blocked.push(url.href); return route.abort(); }
    if (url.pathname === "/") return route.fulfill({
      body: '<!doctype html><body style="margin:0;background:#223344"><canvas></canvas></body>',
      contentType: "text/html", headers: { "Content-Security-Policy": csp },
    });
    const path = resolve(root, "." + decodeURIComponent(url.pathname));
    if (!path.startsWith(root + sep)) { blocked.push(url.href); return route.abort(); }
    try {
      const source = url.pathname === "/canvas/canvaskit-renderer.mjs" &&
        process.env.DESIGN_STUDIO_INFINITE_RENDERER_SOURCE
        ? await readFile(process.env.DESIGN_STUDIO_INFINITE_RENDERER_SOURCE) : await readFile(path);
      return route.fulfill({ body: source, contentType: {
        ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm",
        ".ttf": "font/ttf", ".woff2": "font/woff2",
      }[extname(path)], headers: { "Content-Security-Policy": csp } });
    } catch { return route.fulfill({ status: 404, body: "missing" }); }
  });
  t.after(async () => { try {
    assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
    assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
  } finally { await browser.close(); } });
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      window.cspViolations.push(event.effectiveDirective));
  });
  await page.goto(origin);
  await page.evaluate(async ({ tileCacheEnabled }) => {
    const { createRenderer } = await import("/canvas/canvaskit-renderer.mjs");
    window.renderer = await createRenderer({ canvas: document.querySelector("canvas"),
      assetsBaseUrl: "/canvas/vendor/", background: "transparent", tileCacheEnabled });
    renderer.resize(500, 400, 1);
  }, { tileCacheEnabled });
  return page;
}
async function upload(page, document) {
  await page.evaluate(async (document) => {
    window.scene = document;
    await renderer.setScene(document, { resources: new Map() });
  }, document);
}
async function draw(page, viewport, name) {
  await page.evaluate((viewport) => renderer.render(viewport), viewport);
  const bytes = await page.screenshot({ scale: "css" });
  if (process.env.DESIGN_STUDIO_INFINITE_GPU_ARTIFACT_DIR) {
    await mkdir(process.env.DESIGN_STUDIO_INFINITE_GPU_ARTIFACT_DIR, { recursive: true });
    await writeFile(resolve(process.env.DESIGN_STUDIO_INFINITE_GPU_ARTIFACT_DIR, `${name}.png`), bytes);
  }
  return PNG.sync.read(bytes);
}
function pixel(png, x, y) {
  return [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
}
function near(actual, expected) {
  assert(actual.every((channel, i) => Math.abs(channel - expected[i]) <= 3), `${actual} != ${expected}`);
}

test("infinite workspace stays transparent at the old canvas origin and after panning", async (t) => {
  const page = await fixture(t);
  await upload(page, design());
  const originShot = await draw(page, { zoom: 1, pan: { x: 0, y: 0 } }, "empty-origin");
  near(pixel(originShot, 50, 50), [34, 51, 68]);
  const distantShot = await draw(page, { zoom: 1, pan: { x: 400000, y: -400000 } }, "empty-distant");
  near(pixel(distantShot, 50, 50), [34, 51, 68]);
});

for (const direction of [-1, 1]) test(`infinite ${direction < 0 ? "negative" : "positive"} far frames render and retain clipping`, async (t) => {
  const page = await fixture(t), x = direction * 350000, y = direction * 450000;
  const frame = node("frame", x, y, { type: "frame", clipContent: true });
  const child = node("red", x + 50, y + 20, { parentId: frame.id, width: 100,
    height: 60, fill: "#ff0000" });
  const outside = node("blue", x + 200, y + 20, { width: 60, height: 60, fill: "#0000ff" });
  await upload(page, design([frame, child, outside]));
  const shot = await draw(page, { zoom: 1, pan: { x: 100 - x, y: 100 - y } }, `far-${direction}`);
  near(pixel(shot, 120, 120), [255, 255, 255]);
  near(pixel(shot, 180, 140), [255, 0, 0]);
  near(pixel(shot, 210, 140), [34, 51, 68]);
  near(pixel(shot, 320, 140), [0, 0, 255]);
  assert.equal((await page.evaluate(() => renderer.stats())).renderMode, "gpu-tiles");
  await page.evaluate(async () => {
    const next = structuredClone(scene);
    for (const node of next.nodes) { node.x += 2000; node.y -= 2000; }
    await renderer.setScene(next, { resources: new Map() });
  });
  const revised = await draw(page, { zoom: 1, pan: { x: 100 - x - 2000, y: 100 - y + 2000 } }, `far-${direction}-revision`);
  near(pixel(revised, 180, 140), [255, 0, 0]);
  near(pixel(revised, 210, 140), [34, 51, 68]);
});

test("bounded documents keep their painted artboard and outside workspace", async (t) => {
  const page = await fixture(t, { tileCacheEnabled: false });
  // Omitted mode remains the v3 legacy bounded contract.
  await upload(page, { ...design(), canvas: { width: 200, height: 200, background: "#f8f8f8" } });
  const shot = await draw(page, { zoom: 1, pan: { x: 100, y: 100 } }, "bounded-control");
  near(pixel(shot, 150, 150), [248, 248, 248]);
  near(pixel(shot, 50, 50), [34, 51, 68]);
});
