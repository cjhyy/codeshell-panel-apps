import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import http from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const vendor = "artifacts/design-renderer-compare/vendor/grida";
const csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:";
const mime = { ".mjs": "text/javascript", ".wasm": "application/wasm", ".ttf": "font/ttf" };

// Sample the compositor screenshot, rather than an already-cleared WebGL buffer.
async function sample(page, points, region = null) {
  const png = await page.screenshot({ scale: "css" });
  return page.evaluate(async ({ data, points, region }) => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
    const pixels = points.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]);
    let dark = 0;
    if (region) {
      const data = context.getImageData(...region).data;
      for (let i = 0; i < data.length; i += 4)
        if (data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80 && data[i + 3] > 0) dark++;
    }
    return { pixels, dark };
  }, { data: png.toString("base64"), points, region });
}

const settle = (page) => page.evaluate(() => new Promise((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))));

test("Grida presents loaded scenes, images and fonts after resize and repeated CSS-pixel pan/zoom", { timeout: 90_000 }, async (t) => {
  try { await access(resolve(root, vendor, "grida-runtime.mjs")); }
  catch { t.skip("Run prepare-grida.mjs to test the pinned real Wasm runtime"); return; }
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      response.setHeader("Content-Security-Policy", csp);
      if (url.pathname === "/") {
        response.setHeader("Content-Type", "text/html");
        response.end('<!doctype html><body style="margin:0;background:#eeeeee"><canvas id="canvas"></canvas></body>'); return;
      }
      const path = resolve(root, "." + decodeURIComponent(url.pathname));
      if (!path.startsWith(root + sep) || !mime[extname(path)]) throw Error("Unexpected fixture path");
      response.setHeader("Content-Type", mime[extname(path)]);
      response.end(await readFile(path));
    } catch { response.statusCode = 404; response.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: process.platform === "darwin" ? ["--use-angle=metal"] : [] });
  try {
    const page = await browser.newPage({ viewport: { width: 500, height: 350 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.route("**/*", (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.goto(origin);
    await page.evaluate(async ({ vendor }) => {
      const { createRenderer } = await import("/scripts/design-renderer-compare/grida-adapter.mjs");
      const font = new Uint8Array(await (await fetch("/apps/design-studio/app/fonts/Roboto-Variable.ttf")).arrayBuffer());
      const image = document.createElement("canvas"); image.width = image.height = 16;
      const context = image.getContext("2d"); context.fillStyle = "#0000ff"; context.fillRect(0, 0, 16, 16);
      const bytes = Uint8Array.from(atob(image.toDataURL().split(",")[1]), (c) => c.charCodeAt(0));
      const base = { visible: true, opacity: 1, rotation: 0, stroke: "transparent", strokeWidth: 0, fill: "#ff0000" };
      const resources = new Map([
        ["font", { bytes: font, descriptor: { kind: "font", family: "Roboto", id: "font" } }],
        ["image", { bytes, descriptor: { kind: "image", id: "image" } }],
      ]);
      window.renderer = await createRenderer({ canvas: document.querySelector("canvas"), assetsBaseUrl: `/${vendor}/` });
      await window.renderer.setScene({ canvas: { width: 500, height: 350, background: "#ffffff" }, nodes: [
        { ...base, id: "rect", type: "rectangle", x: 20, y: 20, width: 100, height: 80 },
        { ...base, id: "image", type: "image", x: 150, y: 50, width: 30, height: 30, imageRef: "image", objectFit: "cover" },
        { ...base, id: "text", type: "text", x: 20, y: 110, width: 90, height: 30, fill: "#000000", text: "Alive", fontFamily: "Roboto", fontSize: 20, fontWeight: 400, textAlign: "left", lineHeight: 1.3 },
      ] }, { resources });
      // The common benchmark loads the scene before resizing its backing store.
      window.renderer.resize(400, 300, 2);
      window.renderer.render({ pan: { x: 30, y: 40 }, zoom: 2 });
    }, { vendor });
    await settle(page);
    let actual = await sample(page, [[80, 90], [40, 70], [340, 150]], [70, 255, 160, 40]);
    assert.deepEqual(actual.pixels, [[255, 0, 0, 255], [255, 255, 255, 255], [0, 0, 255, 255]]);
    assert.ok(actual.dark > 25, "Native font glyphs survive backing-store reconstruction");
    await page.evaluate(async () => {
      for (let i = 0; i < 32; i++) await new Promise((resolve) => requestAnimationFrame(() => {
        window.renderer.render({ pan: { x: 25 + Math.sin(i) * 20, y: 10 }, zoom: 0.5 + (i % 3) * 0.1 }); resolve();
      }));
      window.renderer.render({ pan: { x: 25, y: 10 }, zoom: 0.5 });
    });
    await settle(page);
    actual = await sample(page, [[40, 30], [20, 30], [105, 40]], [35, 62, 45, 20]);
    assert.deepEqual(actual.pixels, [[255, 0, 0, 255], [238, 238, 238, 255], [0, 0, 255, 255]]);
    assert.ok(actual.dark > 5);
    await page.evaluate(() => {
      window.renderer.resize(500, 350, 1);
      window.renderer.render({ pan: { x: 25, y: 10 }, zoom: 0.5 });
      window.renderer.resize(500, 350, 1);
    });
    await settle(page);
    actual = await sample(page, [[40, 30], [105, 40]], [35, 62, 45, 20]);
    assert.deepEqual(actual.pixels, [[255, 0, 0, 255], [0, 0, 255, 255]]);
    assert.ok(actual.dark > 5);
    const stats = await page.evaluate(() => window.renderer.stats());
    assert.equal(stats.surfaceRebuilds, 2);
    assert.equal(stats.convertedSourceNodes, 3);
    assert.equal(stats.nativeTextNodes, 1);
    assert.deepEqual(errors, []);
    await page.evaluate(() => window.renderer.dispose());
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
