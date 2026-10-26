import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url));
const origin = "https://infinite-text.test";
const fontBytes = await readFile(resolve(root, "fonts/Roboto-Variable.ttf"));
const fontSHA = createHash("sha256").update(fontBytes).digest("hex");
const artifactDir = process.env.DESIGN_STUDIO_TEXT_BOUNDS_ARTIFACT_DIR;
const brokenRoot = process.env.DESIGN_STUDIO_TEXT_BOUNDS_BROKEN_ROOT;

export async function checkNaturalTextBounds(t) {
  const browser = await chromium.launch({ headless: true, args: ["--enable-webgl", "--enable-unsafe-swiftshader"] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 220 } });
  const errors = [], blocked = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { blocked.push(url.href); return route.abort(); }
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><body style="margin:0;background:white"><canvas></canvas></body>' });
    const path = resolve(root, `.${url.pathname}`);
    if (!path.startsWith(`${resolve(root)}${sep}`)) return route.abort();
    let source = path;
    if (brokenRoot && ["/document.mjs", "/canvas/canvaskit-renderer.mjs", "/text-metrics.mjs"].includes(url.pathname))
      source = resolve(brokenRoot, `.${url.pathname}`);
    try { return route.fulfill({ body: await readFile(source), contentType: {
      ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".ttf": "font/ttf",
    }[extname(path)] }); } catch { return route.fulfill({ status: 404, body: "missing" }); }
  });
  await page.goto(origin);
  const result = await page.evaluate(async ({ fontSHA, fontBase64, fontSize }) => {
    const { designPageBounds, exportDesignSvg } = await import("/document.mjs");
    const { textMetricsSignature } = await import("/text-metrics.mjs");
    const { createRenderer } = await import("/canvas/canvaskit-renderer.mjs");
    const bytes = new Uint8Array(await (await fetch("/fonts/Roboto-Variable.ttf")).arrayBuffer());
    const face = new FontFace("Roboto", bytes, { weight: "100 900" });
    await face.load(); document.fonts.add(face); await document.fonts.load(`${fontSize}px Roboto`);
    const descriptor = { id: "roboto", kind: "font", family: "Roboto", weight: 400, style: "normal", mime: "font/ttf", bytes: bytes.length, sha256: fontSHA, partCount: 1 };
    const resources = new Map([["roboto", { bytes, descriptor, mimeType: "font/ttf" }]]);
    const resourceDataUrls = new Map([["roboto", `data:font/ttf;base64,${fontBase64}`]]);
    const text = { id: "natural-copy", type: "text", name: "Natural copy", x: -400, y: 40, width: 100, height: 48,
      fill: "#000000", stroke: "transparent", strokeWidth: 0, rotation: 0, opacity: 1, visible: true, locked: false, cornerRadius: 0,
      text: "MMMMMMMMMMMMMMMMMMMM", fontFamily: "Roboto", fontRef: "roboto", fontSize, fontWeight: 400, lineHeight: 1.2, textAlign: "left" };
    const make = (node, mode = "infinite") => ({ format: "codeshell.design", version: 3, name: "Text bounds", canvas: { width: 800, height: 220, background: "#ffffff", ...(mode ? { mode } : {}) },
      tokens: { colors: [] }, resources: [descriptor], nodes: [node], activePageId: "page-1", pages: [{ id: "page-1", name: "Page", nodes: [node] }] });
    const measureCanvas = document.createElement("canvas"), ctx = measureCanvas.getContext("2d");
    ctx.font = `400 ${fontSize}px Roboto`; ctx.textBaseline = "hanging";
    const measured = ctx.measureText(text.text);
    const ink = { x: -measured.actualBoundingBoxLeft, y: -measured.actualBoundingBoxAscent,
      width: measured.actualBoundingBoxLeft + measured.actualBoundingBoxRight,
      height: measured.actualBoundingBoxAscent + measured.actualBoundingBoxDescent };
    const inkRight = text.x + ink.x + ink.width;
    const documentValue = make(text);
    const naturalBounds = designPageBounds(documentValue);
    const svg = exportDesignSvg(documentValue, { resourceDataUrls, maxBytes: 4 * 1024 * 1024 });
    async function imageInk(svg) {
      const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; await image.decode();
      const c = document.createElement("canvas"); c.width = image.width; c.height = image.height;
      const x = c.getContext("2d"); x.drawImage(image, 0, 0);
      const p = x.getImageData(0, 0, c.width, c.height).data;
      let right = 0, count = 0;
      for (let y = 0; y < c.height; y++) for (let px = 0; px < c.width; px++) {
        const i = (y * c.width + px) * 4;
        if (p[i + 3] > 100 && p[i] < 100 && p[i + 1] < 100 && p[i + 2] < 100) { right = Math.max(right, px); count++; }
      }
      return { width: c.width, height: c.height, right, count, png: c.toDataURL("image/png").split(",")[1] };
    }
    const naturalImage = await imageInk(svg);
    const controlImage = await imageInk(exportDesignSvg(documentValue, { resourceDataUrls, maxBytes: 4 * 1024 * 1024, bounds: { x: text.x, y: text.y - 10, width: Math.ceil(measured.width + 20), height: 70 } }));
    const measuredText = { ...text, textMetrics: { version: 1, signature: textMetricsSignature(text), lineWidths: [measured.width], lineInkBounds: [ink], height: ink.y + ink.height, fontAvailable: true } };
    const receiptBounds = designPageBounds(make(measuredText));
    const renderer = await createRenderer({ canvas: document.querySelector("canvas"), assetsBaseUrl: "/canvas/vendor/", background: "#ffffff", tileCacheEnabled: false });
    renderer.resize(800, 220, 1); await renderer.setScene(documentValue, { resources });
    renderer.render({ zoom: 1, pan: { x: 420, y: 0 } });
    const gpu = document.querySelector("canvas").toDataURL("image/png").split(",")[1];
    const stats = renderer.stats();
    // Paint outside a real clipping artboard must still disappear.
    const frame = { ...text, id: "clip", type: "frame", x: text.x, y: 20, width: 100, height: 100, fill: "transparent", clipContent: true };
    const clippedText = { ...text, parentId: frame.id };
    const clipped = { ...make(text), nodes: [frame, clippedText], pages: [{ id: "page-1", name: "Page", nodes: [frame, clippedText] }] };
    const clippedBounds = designPageBounds(clipped);
    await renderer.setScene(clipped, { resources }); renderer.render({ zoom: 1, pan: { x: 420, y: 0 } });
    const clippedGPU = document.querySelector("canvas").toDataURL("image/png").split(",")[1];
    renderer.dispose();
    return { fontSHA, ink, inkRight, measuredWidth: measured.width, naturalBounds, receiptBounds, clippedBounds,
      naturalImage, controlImage, gpu, clippedGPU, stats, unmodified: !text.textMetrics,
      boundedViewport: exportDesignSvg(make(text, null), { resourceDataUrls, maxBytes: 4 * 1024 * 1024 }).match(/viewBox="[^"]+"/u)[0] };
  }, { fontSHA, fontBase64: fontBytes.toString("base64"), fontSize: 32 });
  const { PNG } = await import("pngjs");
  const gpu = PNG.sync.read(Buffer.from(result.gpu, "base64"));
  const clippedGPU = PNG.sync.read(Buffer.from(result.clippedGPU, "base64"));
  function rightInk(image) {
    let right = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      if (image.data[i + 3] > 100 && image.data[i] < 100 && image.data[i + 1] < 100 && image.data[i + 2] < 100) right = Math.max(right, x);
    }
    return right;
  }
  result.gpuRight = rightInk(gpu); result.clippedGPURight = rightInk(clippedGPU);
  if (artifactDir) {
    await mkdir(artifactDir, { recursive: true });
    for (const [name, base64] of [["svg-natural", result.naturalImage.png], ["svg-control", result.controlImage.png], ["gpu-natural", result.gpu], ["gpu-clipped", result.clippedGPU]])
      await writeFile(resolve(artifactDir, `${name}.png`), Buffer.from(base64, "base64"));
    const { gpu: _gpu, clippedGPU: _clipped, naturalImage, controlImage, ...data } = result;
    await writeFile(resolve(artifactDir, "observations.json"), JSON.stringify({ ...data, naturalImage: { ...naturalImage, png: undefined }, controlImage: { ...controlImage, png: undefined } }, null, 2));
  }
  assert(result.measuredWidth > 450, JSON.stringify(result.ink));
  assert(result.controlImage.right > 450, "large viewport control contains the physical glyph tail");
  assert(result.naturalBounds.x + result.naturalBounds.width >= result.inkRight, JSON.stringify(result.naturalBounds));
  assert(result.receiptBounds.x + result.receiptBounds.width >= result.inkRight, JSON.stringify(result.receiptBounds));
  assert(result.naturalImage.right > 450, `SVG tail disappeared at ${result.naturalImage.right}`);
  assert(result.gpuRight > 450, `GPU tail disappeared at ${result.gpuRight}`);
  assert(result.clippedGPURight <= 120, `artboard clipping escaped at ${result.clippedGPURight}`);
  assert(result.clippedBounds.width <= 100);
  assert.equal(result.boundedViewport, 'viewBox="0 0 800 220"');
  assert.equal(result.unmodified, true);
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
}
