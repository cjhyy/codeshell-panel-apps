import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { extname } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { normalizeDesignDocument } from "../../../apps/design-studio/app/document.mjs";

export const canvasCsp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; object-src 'none'; base-uri 'none'";
export const canvasContentType = (path) => ({
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".wasm": "application/wasm", ".ttf": "font/ttf", ".woff2": "font/woff2",
}[extname(path)] ?? "application/octet-stream");

// A software WebGL driver is sufficient for interaction/pixel correctness, not performance claims.
export const launchCanvasBrowser = () => chromium.launch({ headless: true,
  args: ["--enable-webgl", "--enable-unsafe-swiftshader"] });

export async function observeCanvasPage(page, { offlineTools = false } = {}) {
  await page.addInitScript(({ offlineTools }) => {
    window.canvasCspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      window.canvasCspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI }));
    // Register public tools without a Host call/getContext. The app stays in browser-local mode.
    if (offlineTools) {
      window.tools = {};
      window.codeshellPanel = { registerTool(name, callback) { window.tools[name] = callback; } };
    }
  }, { offlineTools });
}

export async function assertCanvasClean(page) {
  assert.deepEqual(await page.evaluate(() => window.canvasCspViolations), [], "Wasm works under CSP without arbitrary JS eval");
}
export async function waitForCanvas(page) {
  await page.waitForFunction(() => !document.querySelector(".workspace").inert &&
    document.querySelector("#stage-wrap").dataset.gpuActive === "true", null, { timeout: 15000 });
  assert.equal(await page.locator("#stage").evaluate((element) => element instanceof HTMLCanvasElement && Boolean(element.getContext("2d"))), true);
  assert.equal(await page.locator("#stage-wrap svg").count(), 0, "the live scene and interactions use Canvas");
  await canvasFrames(page);
}
export const canvasFrames = (page) => page.evaluate(() => new Promise((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))));
export const canvasNode = (page, id) => page.evaluate(async (id) =>
  (await window.tools.get_design_context({ node_id: id })).node, id);
export async function canvasNodes(page) {
  const result = await page.evaluate(() => window.tools.get_design_context({}));
  return normalizeDesignDocument(result.document).nodes;
}
export async function waitCanvasText(page, id, text) {
  await page.waitForFunction(async ({ id, text }) => {
    if (document.querySelector(".workspace").inert || !window.tools?.get_design_context) return false;
    try { return (await window.tools.get_design_context({ node_id: id })).node.text === text; }
    catch { return false; }
  }, { id, text });
}
export const canvasTransform = (page) => page.locator("#stage").evaluate((canvas) => {
  const { a, b, c, d, e, f } = canvas.getContext("2d").getTransform();
  return [a, b, c, d, e, f];
});
export const canvasPoint = (page, x, y) => page.locator("#stage").evaluate((canvas, { x, y }) => {
  const bounds = canvas.getBoundingClientRect();
  const p = canvas.getContext("2d").getTransform().transformPoint(new DOMPoint(x, y));
  return { x: bounds.x + p.x * bounds.width / canvas.width,
    y: bounds.y + p.y * bounds.height / canvas.height, id: 1 };
}, { x, y });
export async function canvasNodeBounds(page, node) {
  const a = await canvasPoint(page, node.x, node.y), b = await canvasPoint(page, node.x + node.width, node.y + node.height);
  return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
}
export async function clickCanvasNode(page, id, { double = false } = {}) {
  const node = await canvasNode(page, id), p = await canvasPoint(page, node.x + node.width / 2, node.y + node.height / 2);
  if (double) await page.mouse.dblclick(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}
export async function assertCanvasNodePainted(page, node) {
  await waitForCanvas(page);
  const point = await canvasPoint(page, node.x + node.width / 2, node.y + node.height / 2);
  const bounds = await page.locator("#gpu-canvas").boundingBox();
  const png = PNG.sync.read(await page.locator("#gpu-canvas").screenshot());
  const x = Math.floor((point.x - bounds.x) * png.width / bounds.width);
  const y = Math.floor((point.y - bounds.y) * png.height / bounds.height);
  assert(x >= 0 && x < png.width && y >= 0 && y < png.height);
  const rgb = [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
  if (/^#[a-f\d]{6}$/iu.test(node.fill) && node.opacity === 1) {
    const expected = [1, 3, 5].map((offset) => parseInt(node.fill.slice(offset, offset + 2), 16));
    assert(rgb.every((value, i) => Math.abs(value - expected[i]) <= 8), `GPU node pixel ${rgb} != ${expected}`);
  } else assert(rgb.some((value) => value < 240), "the created layer has a painted GPU pixel");
}
export async function canvasOverlayChecksum(page) {
  return page.locator("#stage").evaluate((canvas) => {
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let i = 0; i < pixels.length; i++) sum = (sum + pixels[i] * (i % 13 + 1)) % 2147483647;
    return sum;
  });
}
export async function canvasSceneDigest(page) {
  await waitForCanvas(page);
  const png = PNG.sync.read(await page.locator("#gpu-canvas").screenshot());
  return createHash("sha256").update(png.data).digest("hex");
}
