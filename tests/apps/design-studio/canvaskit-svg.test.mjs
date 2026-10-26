import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { decodeCanvasKitImage } from "../../../apps/design-studio/app/canvas/image-decode.mjs";
import { inertDesignSvg } from "../../../apps/design-studio/app/svg-resource.mjs";
import { inertDesignSvg as adapterSvgAdmission } from "../../../apps/design-studio/app/design-node-adapter.mjs";

const voteSvg = '<svg height="32" viewBox="0 0 32 16" width="32" xmlns="http://www.w3.org/2000/svg"><path d="m2 27 14-29 14 29z" fill="#999"/></svg>';
const bytes = source => new TextEncoder().encode(source);

test("SVG admission is shared with the adapter, preserves inert bytes and rejects active/external inputs", async () => {
  assert.equal(adapterSvgAdmission, inertDesignSvg);
  assert.equal(inertDesignSvg(voteSvg), voteSvg);
  for (const svg of [
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/a.png"/></svg>',
    '<svg onload="alert(1)"></svg>', '<svg><script>1</script></svg>', '<svg><path fill="url(https://example.com/a.svg#x)"/></svg>',
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///private">]><svg>&x;</svg>',
  ]) assert.throws(() => inertDesignSvg(svg));
  const png = Uint8Array.of(137,80,78,71,13,10,26,10), original = png.slice(), decoded = {};
  const CK = { MakeImageFromEncoded: value => { assert.equal(value, png); return decoded; } };
  assert.deepEqual(await decodeCanvasKitImage(CK, { bytes: png, mimeType: "image/png" }), { image: decoded, svgPixels: 0 });
  assert.deepEqual(png, original);
  await assert.rejects(decodeCanvasKitImage(CK, { bytes: bytes(voteSvg), mimeType: "image/png" }), /MIME/);
  await assert.rejects(decodeCanvasKitImage(CK, { bytes: png, mimeType: "image/svg+xml" }), /MIME/);
});

async function fixture(t) {
  const browser = await chromium.launch({ args: process.platform === "darwin" ? ["--use-angle=metal"] : ["--enable-webgl", "--enable-unsafe-swiftshader"] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 160, height: 100 }, deviceScaleFactor: 1 });
  const root = resolve("apps/design-studio/app"), blocked = [], errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url()), file = resolve(root, "." + decodeURIComponent(url.pathname));
    if (url.origin !== "https://svg-image.test") { blocked.push(url.href); return route.abort(); }
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><style>body{margin:0;background:white}canvas{display:block}</style><canvas width="160" height="100"></canvas>' });
    if (!file.startsWith(root + sep)) return route.abort();
    return route.fulfill({ body: await readFile(file), contentType: { ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm" }[extname(file)] });
  });
  await page.goto("https://svg-image.test/"); return { page, blocked, errors };
}

test("production CanvasKit draws the exact HN SVG with browser intrinsic dimensions and retains original resources", async t => {
  const { page, blocked, errors } = await fixture(t);
  const result = await page.evaluate(async svg => {
    const { createRenderer } = await import("/canvas/canvaskit-renderer.mjs");
    const resourceBytes = new TextEncoder().encode(svg), original = [...resourceBytes];
    const resource = { bytes: resourceBytes, mimeType: "image/svg+xml", descriptor: { id: "vote", kind: "image", mime: "image/svg+xml" } };
    const node = { id: "arrow", name: "Vote", type: "image", imageRef: "vote", x: 20, y: 20, width: 32, height: 32,
      objectFit: "fill", fill: "transparent", stroke: "transparent", strokeWidth: 0, opacity: 1, visible: true, locked: false, rotation: 0, cornerRadius: 0 };
    const design = { canvas: { width: 160, height: 100, background: "#ffffff" }, nodes: [node], resources: [resource.descriptor] }, before = JSON.stringify(design);
    window.svgRenderer = await createRenderer({ canvas: document.querySelector("canvas"), assetsBaseUrl: "/canvas/vendor/", tileCacheEnabled: false });
    svgRenderer.resize(160, 100, 1); const resources = new Map([["vote", resource]]);
    await svgRenderer.setScene(design, { resources }); svgRenderer.render();
    const first = svgRenderer.stats();
    await svgRenderer.setScene(design, { resources }); svgRenderer.render();
    return { first, second: svgRenderer.stats(), unchanged: before === JSON.stringify(design) && JSON.stringify(original) === JSON.stringify([...resourceBytes]) };
  }, voteSvg);
  const actual = PNG.sync.read(await page.screenshot());
  await page.evaluate(() => svgRenderer.dispose());
  await page.setContent('<!doctype html><style>body{margin:0;background:white}canvas{position:absolute;left:20px;top:20px;width:32px;height:32px}</style><canvas width="32" height="32"></canvas>');
  await page.locator("canvas").evaluate(async (canvas, svg) => {
    const image = new Image(); image.src = "data:image/svg+xml;base64," + btoa(svg); await image.decode();
    canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight);
  }, voteSvg);
  const expected = PNG.sync.read(await page.screenshot());
  if (process.env.DESIGN_STUDIO_SVG_EVIDENCE) {
    await mkdir(process.env.DESIGN_STUDIO_SVG_EVIDENCE, { recursive: true });
    await writeFile(resolve(process.env.DESIGN_STUDIO_SVG_EVIDENCE, "source.png"), PNG.sync.write(expected));
    await writeFile(resolve(process.env.DESIGN_STUDIO_SVG_EVIDENCE, "canvaskit.png"), PNG.sync.write(actual));
    await writeFile(resolve(process.env.DESIGN_STUDIO_SVG_EVIDENCE, "report.json"), JSON.stringify(result, null, 2));
  }
  assert.equal(result.first.missingImages, 0); assert.equal(result.first.decodedImages, 1);
  assert(actual.data.equals(expected.data), "the GPU image preserves the browser-decoded resource pixels and intrinsic viewBox/aspect ratio");
  assert.equal(result.first.svgDecodedImages, 1); assert.equal(result.first.svgDecodedPixels, 1024);
  assert.equal(result.second.resourceBuilds, 1, "the unchanged SVG derivative is reused");
  assert.equal(result.unchanged, true); assert.deepEqual(result.first.unsupported, []);
  assert.deepEqual(blocked, []); assert.deepEqual(errors, []);
});

test("unsafe, mismatched and oversized SVGs remain diagnosed missing images without fetching resources", async t => {
  const { page, blocked, errors } = await fixture(t);
  const results = await page.evaluate(async () => {
    const { createRenderer } = await import("/canvas/canvaskit-renderer.mjs");
    const renderer = await createRenderer({ canvas: document.querySelector("canvas"), assetsBaseUrl: "/canvas/vendor/", tileCacheEnabled: false });
    const outputs = [];
    try {
      for (const [source, mimeType] of [
        ['<svg xmlns="http://www.w3.org/2000/svg"><use href="https://forbidden.test/remote.svg#x"/></svg>', "image/svg+xml"],
        ['<svg xmlns="http://www.w3.org/2000/svg" width="9000" height="32"><rect width="10" height="10"/></svg>', "image/svg+xml"],
        ['<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>', "image/png"],
      ]) {
        const node = { id: "arrow", name: "Vote", type: "image", imageRef: "vote", x: 20, y: 20, width: 32, height: 32, objectFit: "fill",
          fill: "transparent", stroke: "transparent", strokeWidth: 0, opacity: 1, visible: true, locked: false, rotation: 0, cornerRadius: 0 };
        await renderer.setScene({ canvas: { width: 160, height: 100, background: "#ffffff" }, nodes: [node], resources: [] }, {
          resources: new Map([["vote", { bytes: new TextEncoder().encode(source), mimeType }]]),
        });
        renderer.render(); outputs.push(renderer.stats());
      }
    } finally { renderer.dispose(); }
    return outputs;
  });
  for (const result of results) {
    assert.equal(result.missingImages, 1); assert.equal(result.svgDecodedImages, 0);
    assert.equal(result.unsupported[0].code, "image-decode");
    assert.match(result.unsupported[0].detail, /SVG/);
  }
  assert.deepEqual(blocked, []); assert.deepEqual(errors, []);
});
