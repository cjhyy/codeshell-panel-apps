import assert from "node:assert/strict";
import { chromium } from "playwright";
import { PNG } from "pngjs";

export const canvasMime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

export const launchCanvasBrowser = () =>
  chromium.launch({ headless: true, args: ["--enable-webgl", "--enable-unsafe-swiftshader"] });

// Register public tools while retaining the browser's local storage and offline Agent behavior.
export async function observeLocalTools(page) {
  await page.addInitScript(() => {
    window.tools = {};
    window.codeshellPanel = {
      registerTool(name, callback) {
        window.tools[name] = callback;
      },
    };
  });
}

export const tool = (page, name, args = {}) =>
  page.evaluate(({ name, args }) => window.tools[name](args), { name, args });
export const metadata = (page) => tool(page, "get_design_metadata");
export const readNode = async (page, id) =>
  (await tool(page, "get_design_context", { node_id: id })).node;

export async function frames(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

export async function gpuActive(page) {
  await page.waitForFunction(
    () => document.querySelector("#stage-wrap")?.dataset.gpuActive === "true",
  );
  assert.equal(await page.locator("#gpu-canvas").isVisible(), true);
  assert.equal(await page.locator("#stage-wrap svg").count(), 0);
  await frames(page);
}

export const viewport = (page) =>
  page.locator("#stage").evaluate((canvas) => {
    const m = canvas.getContext("2d").getTransform(),
      dpr = devicePixelRatio;
    return { zoom: m.a / dpr, pan: { x: m.e / dpr, y: m.f / dpr } };
  });

export async function canvasPoint(page, point) {
  const [v, box] = await Promise.all([viewport(page), page.locator("#stage").boundingBox()]);
  return { x: box.x + v.pan.x + point.x * v.zoom, y: box.y + v.pan.y + point.y * v.zoom };
}

export async function clickWorld(page, point, options) {
  const p = await canvasPoint(page, point);
  await page.mouse.click(p.x, p.y, options);
}

export const screenshot = async (page) =>
  PNG.sync.read(await page.locator("#gpu-canvas").screenshot());
export async function worldPixel(page, point) {
  const [v, shot, box] = await Promise.all([
    viewport(page),
    screenshot(page),
    page.locator("#gpu-canvas").boundingBox(),
  ]);
  const x = Math.round(((v.pan.x + point.x * v.zoom) * shot.width) / box.width);
  const y = Math.round(((v.pan.y + point.y * v.zoom) * shot.height) / box.height);
  assert.ok(
    x >= 0 && y >= 0 && x < shot.width && y < shot.height,
    `probe outside canvas: ${x},${y}`,
  );
  return [...shot.data.subarray((y * shot.width + x) * 4, (y * shot.width + x) * 4 + 4)];
}

export function nearColor(actual, expected, tolerance = 7) {
  assert.ok(
    expected.every((c, i) => Math.abs(actual[i] - c) <= tolerance),
    `expected ${expected}, received ${actual}`,
  );
}

export function rotatePoint(point, center, degrees) {
  const angle = (degrees * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  return {
    x: center.x + (point.x - center.x) * c - (point.y - center.y) * s,
    y: center.y + (point.x - center.x) * s + (point.y - center.y) * c,
  };
}

export async function handlePixels(page, point) {
  return page.locator("#stage").evaluate((canvas, point) => {
    const ctx = canvas.getContext("2d"),
      m = ctx.getTransform();
    const cx = Math.round(point.x * m.a + m.e),
      cy = Math.round(point.y * m.d + m.f);
    const radius = Math.ceil(9 * devicePixelRatio),
      size = radius * 2 + 1;
    const left = cx - radius,
      top = cy - radius;
    const data = ctx.getImageData(left, top, size, size).data;
    let x1 = Infinity,
      y1 = Infinity,
      x2 = -Infinity,
      y2 = -Infinity;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        if (
          data[i + 3] > 100 &&
          Math.abs(data[i] - 49) < 15 &&
          Math.abs(data[i + 1] - 95) < 15 &&
          Math.abs(data[i + 2] - 218) < 15
        ) {
          x1 = Math.min(x1, x);
          y1 = Math.min(y1, y);
          x2 = Math.max(x2, x);
          y2 = Math.max(y2, y);
        }
      }
    return Number.isFinite(x1)
      ? { width: (x2 - x1 + 1) / devicePixelRatio, height: (y2 - y1 + 1) / devicePixelRatio }
      : null;
  }, point);
}
