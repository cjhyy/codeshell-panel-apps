import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { normalizeDesignDocument } from "../../../apps/design-studio/app/document.mjs";

const root = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));
const origin = "https://infinite-browser.test";
const shape = (id, x, y, width, height, extra = {}) => ({ id, name: id, type: "rectangle", x, y,
  width, height, fill: "#ffffff", stroke: "transparent", strokeWidth: 0, opacity: 1,
  rotation: 0, cornerRadius: 0, visible: true, locked: false, ...extra });
const source = (children = [], infinite = true) => normalizeDesignDocument({ format: "codeshell.design",
  version: 3, name: "Browser world origin", canvas: { width: 200, height: 200,
    background: "#f8f8f8", ...(infinite ? { mode: "infinite" } : {}) }, tokens: { colors: [] },
  activePageId: "page", pages: [{ id: "page", name: "World", children }] });
async function fixture(t) {
  const browser = await chromium.launch({ headless: true, args: ["--disable-gpu"] });
  const page = await browser.newPage({ viewport: { width: 500, height: 400 }, deviceScaleFactor: 1 });
  const errors = [], blocked = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => { try { assert.deepEqual(errors, []); assert.deepEqual(blocked, []); }
    finally { await browser.close(); } });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { blocked.push(url.href); return route.abort(); }
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html",
      body: '<!doctype html><style>body{margin:0;background:#223344}#surface{position:absolute;inset:0}</style><div id="surface"></div>' });
    const path = resolve(root, "." + url.pathname);
    if (!path.startsWith(root + sep)) { blocked.push(url.href); return route.abort(); }
    const bytes = url.pathname === "/canvas/browser-renderer.mjs" && process.env.DESIGN_STUDIO_RELEASE_BROWSER_RENDERER_SOURCE
      ? await readFile(process.env.DESIGN_STUDIO_RELEASE_BROWSER_RENDERER_SOURCE) : await readFile(path);
    return route.fulfill({ body: bytes, contentType: { ".mjs": "text/javascript", ".js": "text/javascript",
      ".woff2": "font/woff2", ".ttf": "font/ttf" }[extname(path)] });
  });
  await page.goto(origin);
  await page.evaluate(async () => {
    const { createBrowserRenderer } = await import("/canvas/browser-renderer.mjs");
    window.renderer = createBrowserRenderer({ container: document.querySelector("#surface") });
    renderer.resize(500, 400);
  });
  return page;
}
async function upload(page, value, view = { pan: { x: 0, y: 0 }, zoom: 1 }) {
  return page.evaluate(async ({ value, view }) => {
    const raw = JSON.stringify(value); await renderer.setScene(value); renderer.render(view);
    return { geometry: [...renderer.geometry()], unchanged: raw === JSON.stringify(value) };
  }, { value, view });
}
async function pixels(page, name) {
  const bytes = await page.screenshot({ scale: "css" });
  if (process.env.DESIGN_STUDIO_RELEASE_BROWSER_EVIDENCE) {
    await mkdir(process.env.DESIGN_STUDIO_RELEASE_BROWSER_EVIDENCE, { recursive: true });
    await writeFile(resolve(process.env.DESIGN_STUDIO_RELEASE_BROWSER_EVIDENCE, `${name}.png`), bytes);
  }
  const png = PNG.sync.read(bytes);
  return (x, y) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
}

test("the live browser infinite page has a transparent workspace at the old origin", async t => {
  const page = await fixture(t); await upload(page, source());
  const pixel = await pixels(page, "empty-infinite");
  assert.deepEqual(pixel(50, 50), [34, 51, 68]);
});

test("negative infinite Frame geometry, hits and clip stay in canonical world coordinates", async t => {
  const page = await fixture(t), x = -48000, y = -32000;
  const frame = shape("frame", x, y, 240, 160, { type: "frame", clipContent: true,
    layout: "none", gap: 0, padding: 0, alignItems: "start", justifyContent: "start", children: [
      shape("child", x - 20, y + 20, 300, 80, { fill: "#24a35a" }),
    ] });
  const value = source([frame]);
  const result = await upload(page, value, { pan: { x: 100 - x, y: 100 - y }, zoom: 1 });
  const geometry = new Map(result.geometry), pixel = await pixels(page, "negative-frame");
  assert.deepEqual([geometry.get("frame").x, geometry.get("frame").y], [x, y]);
  assert.deepEqual([geometry.get("child").x, geometry.get("child").y], [x - 20, y + 20]);
  assert.deepEqual(pixel(140, 140), [36, 163, 90]);
  assert.deepEqual(pixel(95, 140), [34, 51, 68]);
  assert.deepEqual(pixel(350, 140), [34, 51, 68]);
  assert.equal(await page.evaluate(({ x, y }) => renderer.hitTest({ x: x + 40, y: y + 40 }), { x, y }), "child");
  assert.equal(await page.evaluate(({ x, y }) => renderer.hitTest({ x: x - 5, y: y + 40 }), { x, y }), null);
  assert(result.unchanged);
});

test("positive infinite CSS flow uses browser layout while retaining the authored root world origin", async t => {
  const page = await fixture(t), x = 65000, y = 45000;
  const frame = shape("frame", x, y, 240, 160, { type: "frame", layout: "horizontal",
    gap: 10, padding: 12, alignItems: "start", justifyContent: "start", children: [
      shape("child", 9000, 9000, 60, 40, { fill: "#315fda" }),
    ] });
  const result = await upload(page, source([frame]), { pan: { x: 100 - x, y: 100 - y }, zoom: 1 });
  const geometry = new Map(result.geometry), pixel = await pixels(page, "positive-flow");
  assert.deepEqual([geometry.get("frame").x, geometry.get("frame").y], [x, y]);
  assert.deepEqual([geometry.get("child").x, geometry.get("child").y], [x + 12, y + 12]);
  assert.deepEqual(pixel(130, 130), [49, 95, 218]);
  assert(result.unchanged);
});

test("bounded browser documents retain their finite painted page", async t => {
  const page = await fixture(t); await upload(page, source([], false), { pan: { x: 100, y: 100 }, zoom: 1 });
  const pixel = await pixels(page, "bounded-control");
  assert.deepEqual(pixel(150, 150), [248, 248, 248]);
  assert.deepEqual(pixel(50, 50), [34, 51, 68]);
});
