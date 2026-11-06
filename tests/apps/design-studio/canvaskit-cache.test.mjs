import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { cssLinearBackgroundPaints } from "../../../apps/design-studio/app/css-linear-gradient.mjs";
import { symmetricPixelDifference, inkGeometry, geometryDifference, textGeometryFailures } from "./render-fidelity.metrics.mjs";
import { normalizeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { importFigmaJson } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { longFigmaSource } from "./fixtures/long-canvas.mjs";

const root = resolve(process.env.DESIGN_CACHE_APP_DIR ?? fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));
const origin = "https://canvaskit-cache.test";
const csp =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:";
const base = (id, type, x, y, width, height, extra = {}) => ({
  id,
  type,
  name: id,
  x,
  y,
  width,
  height,
  fill: "#000000",
  stroke: "transparent",
  strokeWidth: 0,
  opacity: 1,
  rotation: 0,
  cornerRadius: 0,
  visible: true,
  locked: false,
  ...extra,
});
const fixture = () => ({
  canvas: { width: 2400, height: 1800, background: "#ffffff" },
  resources: [],
  nodes: [
    base("clip", "frame", 980, 100, 160, 140, {
      fill: "transparent",
      opacity: 0.5,
      clipContent: true,
    }),
    base("alpha", "rectangle", 960, 80, 220, 200, {
      fill: "#ff0000",
      opacity: 0.5,
      parentId: "clip",
    }),
    base("gradient", "rectangle", 900, 300, 250, 100, {
      fillPaints: [
        {
          type: "GRADIENT_LINEAR",
          opacity: 1,
          handles: [
            { x: 0, y: 0.5 },
            { x: 1, y: 0.5 },
            { x: 0, y: 1 },
          ],
          stops: [
            { position: 0, color: "#000000", opacity: 1 },
            { position: 1, color: "#ffffff", opacity: 1 },
          ],
        },
      ],
    }),
    base("shadow", "rectangle", 980, 450, 100, 60, {
      fill: "#3366cc",
      shadow: { x: 18, y: 8, blur: 24, opacity: 0.7, color: "#000000" },
    }),
    base("rotate", "rectangle", 1450, 100, 100, 24, { fill: "#00cc00", rotation: 90 }),
    base("system-text", "text", 70, 350, 300, 40, {
      text: "Browser font glyphs", layoutBaselineOffset: 0, // Keep this tile-cache fixture on the historical master; phase coverage has dedicated tests.
      fontFamily: "Arial",
      fontSize: 24,
      fontWeight: 400,
      lineHeight: 1.3,
      textAlign: "left",
    }),
    base("native-text", "text", 70, 450, 300, 40, {
      text: "Native Roboto", layoutBaselineOffset: 0,
      fontFamily: "Roboto",
      fontRef: "roboto",
      fontSize: 24,
      fontWeight: 700,
      lineHeight: 1.3,
      textAlign: "left",
    }),
  ],
});

async function harness(t, { tileCacheEnabled = true, deviceTextSampling = true, width = 900, height = 600, dpr = 1, background } = {}) {
  const browser = await chromium.launch({
    args:
      process.platform === "darwin"
        ? ["--use-angle=metal"]
        : ["--enable-webgl", "--enable-unsafe-swiftshader"],
  });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
  const page = await context.newPage();
  const errors = [],
    blocked = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      blocked.push(url.href);
      return route.abort();
    }
    if (url.pathname === "/")
      return route.fulfill({
        body: '<!doctype html><body style="margin:0"><canvas></canvas></body>',
        contentType: "text/html",
        headers: { "Content-Security-Policy": csp },
      });
    const path = resolve(root, "." + decodeURIComponent(url.pathname));
    if (!path.startsWith(root + sep)) return route.abort();
    try {
      return route.fulfill({
        body: await readFile(path),
        contentType: {
          ".mjs": "text/javascript",
          ".js": "text/javascript",
          ".wasm": "application/wasm",
          ".ttf": "font/ttf",
        }[extname(path)],
        headers: { "Content-Security-Policy": csp },
      });
    } catch {
      return route.fulfill({ status: 404, body: "missing" });
    }
  });
  t.after(async () => {
    try {
      assert.deepEqual(errors, []);
      assert.deepEqual(blocked, []);
    } finally {
      await browser.close();
    }
  });
  await page.goto(origin);
  await page.evaluate(
    async ({ tileCacheEnabled, deviceTextSampling, width, height, dpr, background }) => {
      const { createRenderer } = await import("/canvas/canvaskit-renderer.mjs");
      window.renderer = await createRenderer({
        canvas: document.querySelector("canvas"),
        assetsBaseUrl: "/canvas/vendor/",
        tileCacheEnabled,
        deviceTextSampling,
        background,
      });
      renderer.resize(width, height, dpr);
    },
    { tileCacheEnabled, deviceTextSampling, width, height, dpr, background },
  );
  return page;
}
async function upload(page, design) {
  await page.evaluate(async (design) => {
    const bytes = new Uint8Array(await (await fetch("/fonts/Roboto-Variable.ttf")).arrayBuffer());
    const descriptor = {
      id: "roboto",
      kind: "font",
      family: "Roboto",
      weight: 700,
      style: "normal",
      sha256: "d7598e12c5dbef095ff8272cfc55da0250bd07fbdecbac8a530b9b277872a134",
    };
    window.resources = new Map([["roboto", { bytes, mimeType: "font/ttf", descriptor }]]);
    window.design = design;
    await renderer.setScene(design, { resources });
  }, design);
}

for (const dpr of [1, 2]) test(`retained canvas renderer recreation keeps CSS geometry at DPR ${dpr}`, async (t) => {
  const width = 900, height = 600, page = await harness(t, { width, height, dpr });
  const design = { canvas: { width: 1409, height: 1233, background: "#ffffff" }, resources: [], nodes: [
    base("page", "frame", 0, 0, 1409, 1233, { fill: "#ffffff", layout: "none" }),
    base("table", "frame", 106, 0, 1198, 1233, { fill: "transparent", parentId: "page", layout: "none" }),
    base("header", "rectangle", 106, 0, 600, 24, { fill: "#ff6600", parentId: "table" }),
  ] };
  const viewport = { pan: { x: 60, y: 40 }, zoom: 0.38 };
  await page.evaluate(async ({ design, viewport }) => { await renderer.setScene(design); renderer.render(viewport); }, { design, viewport });
  const initial = PNG.sync.read(await page.screenshot({ scale: "css" }));
  const geometry = await page.evaluate(async ({ design, viewport, width, height, dpr }) => {
    const canvas = document.querySelector("canvas"), before = canvas.getBoundingClientRect().toJSON();
    renderer.dispose();
    const { createRenderer } = await import("/canvas/canvaskit-renderer.mjs");
    window.renderer = await createRenderer({ canvas, assetsBaseUrl: "/canvas/vendor/" });
    renderer.resize(width, height, dpr);
    await renderer.setScene(design); renderer.render(viewport);
    return { before, after: canvas.getBoundingClientRect().toJSON(), backing: { width: canvas.width, height: canvas.height }, stats: renderer.stats() };
  }, { design, viewport, width, height, dpr });
  const recreated = PNG.sync.read(await page.screenshot({ scale: "css" }));
  function orangeBounds(image) {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4, [r, g, b] = image.data.subarray(offset, offset + 3);
      if (r > 230 && g > 75 && g < 130 && b < 35) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
    }
    return { left, top, width: right - left + 1, height: bottom - top + 1 };
  }
  const first = orangeBounds(initial), after = orangeBounds(recreated);
  t.diagnostic(JSON.stringify({ dpr, css: geometry.after, backing: geometry.backing, first, after }));
  assert.equal(geometry.after.width, width, "CSS width is independent of the retained backing store");
  assert.equal(geometry.after.height, height);
  assert.deepEqual(geometry.backing, { width: width * dpr, height: height * dpr });
  for (const [key, expected] of Object.entries({ left: viewport.pan.x + 106 * viewport.zoom, top: viewport.pan.y, width: 600 * viewport.zoom, height: 24 * viewport.zoom })) {
    assert.ok(Math.abs(first[key] - expected) < 1.1, `initial ${key}: ${first[key]} vs ${expected}`);
    assert.ok(Math.abs(after[key] - expected) < 1.1, `recreated ${key}: ${after[key]} vs ${expected}`);
  }
});
async function draw(page, viewport) {
  await page.evaluate((viewport) => renderer.render(viewport), viewport);
  return PNG.sync.read(await page.screenshot({ scale: "css" }));
}
const pixel = (png, x, y) => [
  ...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3),
];
const near = (actual, expected, tolerance = 5) =>
  assert.ok(
    actual.every((value, i) => Math.abs(value - expected[i]) <= tolerance),
    `${actual} != ${expected}`,
  );

test("GPU tile cache preserves nonzero-position gradients, ancestor clip/alpha and shadows across tile seams", async (t) => {
  const cached = await harness(t),
    reference = await harness(t, { tileCacheEnabled: false });
  const design = fixture();
  await upload(cached, design);
  await upload(reference, design);
  const viewport = { pan: { x: 0, y: 0 }, zoom: 0.5 };
  const actual = await draw(cached, viewport),
    expected = await draw(reference, viewport);
  for (const [x, y] of [
    [500, 80],
    [575, 80],
    [510, 170],
    [511, 170],
    [512, 170],
    [530, 170],
    [540, 240],
    [550, 260],
    [750, 65],
  ])
    near(pixel(actual, x, y), pixel(expected, x, y), 5);
  near(pixel(actual, 500, 80), [255, 191, 191]);
  near(pixel(actual, 575, 80), [255, 255, 255]);
  near(pixel(actual, 512, 170), [127, 127, 127], 8);
  const first = await cached.evaluate(() => renderer.stats());
  assert.equal(first.renderMode, "gpu-tiles");
  assert.ok(first.tileBuilds > 0);
  await draw(cached, viewport);
  const second = await cached.evaluate(() => renderer.stats());
  assert.equal(second.tileBuilds, first.tileBuilds);
  assert.ok(second.tileHits > first.tileHits);
  assert.equal(second.pictureBuilds, 1);
  assert.equal(second.inputNodes, design.nodes.length);
  assert.ok(second.tileCacheBytes <= second.tileCacheBudget.maxBytes);
});

test("CanvasKit invalidates resized CSS gradient pictures and matches freshly resolved native paints exactly", async (t) => {
  const page = await harness(t, { width: 640, height: 440 });
  const image =
    "linear-gradient(-45deg,rgba(255,0,0,.5) 20px,transparent),linear-gradient(to top right,rgb(0,0,255),rgb(0,255,0))";
  const source = cssLinearBackgroundPaints({ "background-image": image }, 640, 160);
  const design = (fillPaints, width, height, textPaints = fillPaints) => ({
    canvas: { width: 640, height: 440, background: "#ffffff" },
    resources: [],
    nodes: [
      base("responsive", "rectangle", 0, 0, width, height, { fillPaints }),
      base("responsive-text", "text", 0, 350, width, 60, {
        fillPaints: textPaints,
        text: "Gradient glyphs",
        fontFamily: "Roboto",
        fontRef: "roboto",
        fontSize: 36,
        fontWeight: 700,
        lineHeight: 1.2,
        textAlign: "left",
      }),
    ],
  });
  const viewport = { zoom: 1, pan: { x: 0, y: 0 } };
  await upload(page, design(source, 640, 160));
  await draw(page, viewport);
  for (const [width, height] of [
    [400, 160],
    [200, 320],
  ]) {
    await upload(page, design(source, width, height));
    const actual = await draw(page, viewport);
    const fresh = cssLinearBackgroundPaints({ "background-image": image }, width, height).map(
      ({ cssLinear, ...paint }) => paint,
    );
    const textFresh = cssLinearBackgroundPaints({ "background-image": image }, width, 60).map(
      ({ cssLinear, ...paint }) => paint,
    );
    await upload(page, design(fresh, width, height, textFresh));
    const expected = await draw(page, viewport);
    assert.deepEqual(
      actual.data,
      expected.data,
      "all GPU pixels agree with a fresh current-size CSS capture",
    );
    const frozen = source.map(({ cssLinear, ...paint }) => paint);
    await upload(page, design(frozen, width, height));
    const wrong = await draw(page, viewport);
    assert.notDeepEqual(
      actual.data,
      wrong.data,
      "the old normalized capture would visibly rotate/move stops",
    );
  }
});

test("live scene revisions reuse font providers and local node pictures while invalidating GPU tiles", async (t) => {
  const page = await harness(t),
    design = fixture();
  design.nodes.push(
    ...Array.from({ length: 1000 }, (_, i) =>
      base(
        `generated-${i}`,
        "rectangle",
        1500 + (i % 20) * 8,
        1000 + Math.floor(i / 20) * 8,
        4,
        4,
        { fill: "#336699" },
      ),
    ),
  );
  await upload(page, design);
  await draw(page, { zoom: 0.5, pan: { x: 0, y: 0 } });
  const before = await page.evaluate(() => renderer.stats());
  await page.evaluate(async () => {
    const next = structuredClone(design);
    next.nodes.forEach((node) => {
      node.x += 20;
      node.y += 10;
    });
    const nextResources = new Map(
      [...resources].map(([id, value]) => [id, { ...value, bytes: new Uint8Array(value.bytes) }]),
    );
    await renderer.setScene(next, { resources: nextResources });
    renderer.render({ zoom: 0.5, pan: { x: 0, y: 0 } });
  });
  const after = await page.evaluate(() => renderer.stats());
  assert.equal(after.resourceBuilds, 1);
  assert.equal(after.pictureBuilds, 2);
  assert.equal(after.nodePictureBuilds, before.nodePictureBuilds);
  assert.ok(after.nodePictureHits >= before.nodePictureHits + design.nodes.length);
  assert.ok(after.sceneRevision > before.sceneRevision);
  assert.ok(after.tileBuilds > before.tileBuilds);
  assert.equal(after.nativeTextNodes, 1);
  assert.equal(after.rasterTextNodes, 1);
  assert.equal(after.drawnNodes, design.nodes.length);
});

test("visible system-font text gains physical zoom resolution without rebuilding native glyphs; context loss throws", async (t) => {
  const page = await harness(t, { width: 700, height: 400, dpr: 2 });
  const design = fixture(); delete design.nodes.find(node => node.id === "system-text").layoutBaselineOffset;
  await upload(page, design);
  await draw(page, { zoom: 1, pan: { x: 0, y: 0 } });
  const before = await page.evaluate(() => renderer.stats());
  const png = await draw(page, { zoom: 4, pan: { x: -250, y: -1350 } });
  const after = await page.evaluate(() => renderer.stats());
  assert.equal(after.resourceBuilds, 1);
  assert.equal(after.textQualityBuilds, 0);
  assert.equal(after.nodePictureBuilds, before.nodePictureBuilds + 1);
  assert.equal(after.rasterNodeScales.find((entry) => entry.nodeId === "system-text").scale, 2);
  assert.equal(after.deviceRasterNodeScales.find((entry) => entry.nodeId === "system-text").scale, 8);
  assert.ok(after.rasterTextCacheBytes > before.rasterTextCacheBytes);
  assert.ok(after.rasterTextCacheBytes <= after.rasterTextCacheBudgetBytes);
  let dark = 0;
  for (let y = 20; y < 180; y++)
    for (let x = 20; x < 690; x++) if (pixel(png, x, y).every((value) => value < 80)) dark++;
  assert.ok(dark > 400, "high-zoom glyph ink remains visible");
  await page.evaluate(() => {
    document
      .querySelector("canvas")
      .getContext("webgl2")
      .getExtension("WEBGL_lose_context")
      .loseContext();
  });
  await page.waitForTimeout(30);
  assert.match(
    await page.evaluate(() => {
      try {
        renderer.render({ zoom: 1 });
      } catch (error) {
        return error.message;
      }
    }),
    /context lost/iu,
  );
});

test("GPU tile textures obey the LRU byte/pixel budget and scene/ancestor edits cannot reuse stale tiles", async (t) => {
  const page = await harness(t);
  await upload(page, fixture());
  await page.evaluate(() => {
    for (let i = 0; i < 24; i++) renderer.render({ zoom: 0.5, pan: { x: -i * 1024, y: 0 } });
    renderer.render({ zoom: 0.5, pan: { x: 0, y: 0 } });
  });
  let stats = await page.evaluate(() => renderer.stats());
  assert.ok(stats.tileEvictions > 0);
  assert.ok(stats.tileCacheBytes <= stats.tileCacheBudget.maxBytes);
  assert.ok(stats.tileCacheBytes / 4 <= stats.tileCacheBudget.maxPixels);
  assert.ok(stats.nodePictureCacheBytes <= stats.nodePictureCacheBudgetBytes);
  await page.evaluate(async () => {
    const next = structuredClone(design);
    next.nodes.find((node) => node.id === "clip").opacity = 1;
    await renderer.setScene(next, { resources });
    renderer.render({ zoom: 0.5, pan: { x: 0, y: 0 } });
  });
  const png = PNG.sync.read(await page.screenshot({ scale: "css" }));
  near(pixel(png, 500, 80), [255, 127, 127]);
  const changed = await page.evaluate(() => renderer.stats());
  assert.equal(changed.resourceBuilds, 1);
  assert.equal(changed.nodePictureBuilds, stats.nodePictureBuilds);
  assert.ok(changed.sceneRevision > stats.sceneRevision);
  assert.ok(changed.tileCacheBytes < stats.tileCacheBytes);
  await page.evaluate(async () => {
    const nextResources = new Map(
      [...resources].map(([id, value]) => [
        id,
        { ...value, descriptor: { ...value.descriptor, sha256: "new-content-revision" } },
      ]),
    );
    await renderer.setScene(design, { resources: nextResources });
  });
  assert.equal((await page.evaluate(() => renderer.stats())).resourceBuilds, 2);
});

test("content edits start a safe text plan before high zoom, and cross-page instance scaling upgrades source glyphs", async (t) => {
  const page = await harness(t, { width: 700, height: 400, dpr: 2 });
  const design = fixture(); delete design.nodes.find(node => node.id === "system-text").layoutBaselineOffset;
  await upload(page, design);
  await draw(page, { zoom: 4, pan: { x: -250, y: -1350 } });
  await page.evaluate(async () => {
    const next = structuredClone(design),
      text = next.nodes.find((node) => node.id === "system-text");
    text.text = "M".repeat(100);
    text.x = 5000;
    text.width = 2000;
    await renderer.setScene(next, { resources });
    renderer.render({ zoom: 4, pan: { x: -250, y: -1350 } });
  });
  let stats = await page.evaluate(() => renderer.stats());
  assert.equal(stats.rasterNodeScales.find((entry) => entry.nodeId === "system-text").scale, 2);
  assert.equal(stats.resourceBuilds, 1);
  const component = base("component", "component", 1000, 1000, 200, 100, { fill: "transparent" });
  const text = base("component-text", "text", 1000, 1010, 100, 30, {
    parentId: "component",
    text: "Source",
    fontFamily: "Arial",
    fontSize: 20,
    fontWeight: 400,
    lineHeight: 1.3,
    textAlign: "left",
  });
  const instance = base("instance", "instance", 10, 10, 400, 200, { componentId: "component" });
  await page.evaluate(
    async (next) => {
      await renderer.setScene(next, { resources });
      renderer.render({ zoom: 4, pan: { x: 0, y: 0 } });
    },
    {
      canvas: { width: 1000, height: 600, background: "#ffffff" },
      nodes: [instance],
      activePageId: "main",
      pages: [
        { id: "main", nodes: [instance] },
        { id: "components", nodes: [component, text] },
      ],
    },
  );
  stats = await page.evaluate(() => renderer.stats());
  assert.equal(stats.rasterNodeScales.find((entry) => entry.nodeId === "component-text").scale, 16);
  assert.equal(stats.resourceBuilds, 1);
  assert.equal(stats.unrenderedTextLines, 0);
  await page.evaluate(() => renderer.dispose());
});

const phaseFixture = () => ({
  canvas: { width: 700, height: 400, background: "#ffffff" }, resources: [],
  nodes: [base("phase-text", "text", 36, 41.41, 568, 30, {
    text: "Editable Auto Layout", fontFamily: "Arial", fontSize: 24, fontWeight: 700,
    fontStyle: "normal", lineHeight: 1.25, textAlign: "left", fill: "#0f172a",
  })],
});

for (const { dpr, zoom } of [{ dpr: 2, zoom: 1 }, { dpr: 1, zoom: 2 }])
test(`integer physical text phase ${dpr} DPR × ${zoom} zoom preserves native device coverage`, async t => {
  const page = await harness(t, { width: 700, height: 400, dpr, tileCacheEnabled: false });
  const design = phaseFixture();
  design.nodes[0].fontSize = 13; design.nodes[0].fontWeight = 400;
  design.nodes[0].lineHeight = 1.6; design.nodes[0].text = "HMI 中文\nHMI 中文";
  await upload(page, design);
  await draw(page, { zoom, pan: { x: 0, y: 0 } });
  const stats = await page.evaluate(() => renderer.stats());
  assert.equal(stats.deviceTextNodes, 1, "Retina and CSS 2x must use a device-phase raster");
  assert.equal(stats.deviceRasterNodeScales[0].scale, 2);
  const actual = PNG.sync.read(await page.screenshot({ scale: "device" }));
  const reference = await page.evaluate(async ({ dpr, zoom }) => {
    const { textLineBoxAlphabeticOffset, textLineBoxBaselineY } = await import("/text-line-box.mjs");
    const n = design.nodes[0], canvas = document.createElement("canvas");
    canvas.width = 700 * dpr; canvas.height = 400 * dpr;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr * zoom, dpr * zoom); ctx.font = 'normal 400 13px "Arial"';
    ctx.fontKerning = "normal"; ctx.letterSpacing = "0px"; ctx.textBaseline = "alphabetic";
    const m = ctx.measureText("Hg"), baseline = textLineBoxAlphabeticOffset(n, { ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent });
    ctx.fillStyle = n.fill;
    n.text.split("\n").forEach((line, i) => ctx.fillText(line, n.x, textLineBoxBaselineY(n, i, baseline)));
    return [...ctx.getImageData(0, 0, canvas.width, canvas.height).data];
  }, { dpr, zoom });
  let max = 0, error = 0;
  actual.data.forEach((value, i) => { const delta = Math.abs(value - reference[i]); max = Math.max(max, delta); error += delta; });
  t.diagnostic(JSON.stringify({ dpr, zoom, maxChannel: max, meanAbsoluteChannelError: error / reference.length, stats }));
  assert(max <= 1, `native coverage must not be interpolated: maximum channel difference ${max}`);
  await draw(page, { zoom, pan: { x: 10, y: 8 } });
  assert.equal((await page.evaluate(() => renderer.stats())).rasterTextCacheMisses, stats.rasterTextCacheMisses);
  assert(stats.rasterTextCacheBytes <= stats.rasterTextCacheBudgetBytes);
});

for (const { dpr, zoom } of [{ dpr: 1, zoom: 1 }, { dpr: 2, zoom: 1 }, { dpr: 1, zoom: 2 }])
test(`centered raster labels match actual HTML layout at ${dpr} DPR × ${zoom} zoom across cached world origins`, async t => {
  const page = await harness(t, { width: 850, height: 220, dpr, tileCacheEnabled: false, background: "#ffffff" });
  const output = resolve(process.env.DESIGN_CENTER_TEXT_EVIDENCE ?? ".tmp/render-fidelity-r002/center-gpu", `dpr${dpr}-zoom${zoom}`);
  await mkdir(output, { recursive: true });
  const font = await page.evaluate(async () => {
    const face = await new FontFace("CenterLabelFontProof", 'local("PingFangSC-Regular")').load();
    await document.fonts.ready;
    return { status: face.status };
  });
  assert.equal(font.status, "loaded", "the requested PingFang face must be available");
  const design = { canvas: { width: 600, height: 900, background: "#ffffff" }, resources: [], nodes: [
    base("center-label", "text", 244, 785.5, 124, 21, { text: "GitHub 仓库地址", fontFamily: "-apple-system, BlinkMacSystemFont, PingFang SC, sans-serif",
      fontSize: 13, fontWeight: 500, fontStyle: "normal", lineHeight: 1.6, textAlign: "center", fill: "#252824" }),
  ] };
  const results = [];
  for (const [name, x] of [["original", 244], ["integer-move", 245], ["negative-fraction", -88.499], ["negative-integer-move", -87.499], ["changed-fraction", -87.501]]) {
    design.nodes[0].x = x;
    const viewport = { zoom, pan: { x: x < 0 ? 160 * zoom : 0, y: -745 * zoom } };
    await upload(page, design);
    await page.evaluate(viewport => renderer.render(viewport), viewport);
    const stats = await page.evaluate(() => renderer.stats());
    assert.equal(stats.deviceTextNodes, 1);
    assert.equal(stats.rasterTextNodes, 1);
    assert.equal(stats.nativeTextNodes, 0);
    const actual = PNG.sync.read(await page.screenshot({ scale: "device", path: resolve(output, `${name}-gpu.png`) }));
    const dom = await page.evaluate(async ({ node, viewport }) => {
      const { designFontFamilyCss } = await import("/font-css.mjs");
      document.querySelector("canvas").style.visibility = "hidden";
      const main = document.createElement("main"); main.id = "center-html-reference";
      main.style.cssText = `position:absolute;left:0;top:0;transform-origin:0 0;transform:translate(${viewport.pan.x}px,${viewport.pan.y}px) scale(${viewport.zoom})`;
      const label = document.createElement("div");
      label.style.cssText = `position:absolute;left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px;white-space:pre;font:${node.fontWeight} ${node.fontSize}px/${node.fontSize*node.lineHeight}px ${designFontFamilyCss(node.fontFamily)};text-align:center;letter-spacing:0;color:${node.fill}`;
      label.textContent = node.text; main.append(label); document.body.append(main);
      await document.fonts.ready;
      const range = document.createRange(); range.selectNodeContents(label);
      const bounds = range.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    }, { node: design.nodes[0], viewport });
    const expected = PNG.sync.read(await page.screenshot({ scale: "device", path: resolve(output, `${name}-html.png`) }));
    await page.evaluate(() => {
      document.querySelector("#center-html-reference").remove();
      document.querySelector("canvas").style.visibility = "visible";
    });
    const scale = dpr * zoom, n = design.nodes[0];
    const roi = { x: (viewport.pan.x + n.x * zoom - 4 * zoom) * dpr, y: (viewport.pan.y + n.y * zoom - 4 * zoom) * dpr,
      width: (n.width + 8) * scale, height: (n.height + 8) * scale };
    const metric = symmetricPixelDifference(expected, actual, { roi });
    const geometry = geometryDifference(inkGeometry(expected, { roi, foreground: [37, 40, 36] }), inkGeometry(actual, { roi, foreground: [37, 40, 36] }));
    results.push({ name, x, viewport, dom, metric, geometry, geometryFailures: textGeometryFailures(geometry, { scale, align: "center" }), stats });
  }
  await writeFile(resolve(output, "metrics.json"), JSON.stringify({ dpr, zoom, font, results }, null, 2));
  const failures = results.filter(row => row.metric.mismatchRatio > .005 || row.metric.largestCluster > 6 || row.geometryFailures.length);
  assert.deepEqual(failures.map(row => ({ name: row.name, metric: row.metric, geometry: row.geometry, geometryFailures: row.geometryFailures })), [], "actual HTML pixel and geometry thresholds must hold without relaxing the cluster gate");
  for (const [before, after] of [[0, 1], [2, 3]])
    assert.equal(results[after].stats.rasterTextCacheMisses, results[before].stats.rasterTextCacheMisses, "integer moves preserve both glyph caches");
  for (const [before, after] of [[1, 2], [3, 4]])
    assert(results[after].stats.rasterTextCacheMisses >= results[before].stats.rasterTextCacheMisses + 2, "a changed layout origin invalidates both master and device glyph coverage");
  t.diagnostic(JSON.stringify({ output, dpr, zoom, cases: results.length, maxCluster: Math.max(...results.map(row => row.metric.largestCluster)) }));
});

test("device text coverage follows real browser pixel phase at physical 1x and integer pans reuse both master and device glyphs", async (t) => {
  const page = await harness(t, { width: 700, height: 400 });
  const control = await harness(t, { width: 700, height: 400, deviceTextSampling: false });
  const design = phaseFixture();
  await upload(page, design);
  await upload(control, design);
  const actual = await draw(page, { zoom: 1, pan: { x: 0, y: 0 } });
  const reference = await page.evaluate(async () => {
    const { textLineBoxAlphabeticOffset, textLineBoxBaselineY } = await import("/text-line-box.mjs");
    const reference = document.createElement("canvas");
    reference.width = 700; reference.height = 400;
    const ctx = reference.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 700, 400);
    ctx.font = 'normal 700 24px "Arial"'; ctx.fontKerning = "normal";
    ctx.textBaseline = "alphabetic"; ctx.letterSpacing = "0px";
    const n = design.nodes[0], m = ctx.measureText("Hg");
    const offset = textLineBoxAlphabeticOffset(n, { ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent });
    ctx.fillStyle = "#0f172a"; ctx.fillText(n.text, n.x, textLineBoxBaselineY(n, 0, offset));
    return [...ctx.getImageData(0, 0, 700, 400).data];
  });
  const exactError = (pixels) => pixels.reduce((sum, value, i) => sum + Math.abs(value - reference[i]), 0);
  const masterPixels = await draw(control, { zoom: 1, pan: { x: 0, y: 0 } });
  const deviceError = exactError(actual.data), masterError = exactError(masterPixels.data);
  t.diagnostic(`Browser reference exact RGBA absolute error: device ${deviceError}, master ${masterError}; no channel tolerance applied`);
  assert(deviceError < masterError, "device sampling must improve actual glyph coverage, including every channel difference");
  const before = await page.evaluate(() => renderer.stats());
  assert.equal(before.deviceTextNodes, 1);
  assert.equal(before.rasterNodeScales[0].scale, 2, "the master keeps its existing resolution");
  assert.equal(before.rasterTextImages, 2);
  await draw(page, { zoom: 1, pan: { x: 31, y: 19 } });
  const panned = await page.evaluate(() => renderer.stats());
  assert.equal(panned.rasterTextCacheMisses, before.rasterTextCacheMisses);
  assert.equal(panned.nodePictureBuilds, before.nodePictureBuilds);
  assert.equal(panned.deviceTextSamplingBuilds, before.deviceTextSamplingBuilds);
  for (const viewport of [
    { zoom: 1, pan: { x: 31.5, y: 19 } }, { zoom: 1.25, pan: { x: 0, y: 0 } },
    { zoom: 2, pan: { x: 0.25, y: 0 } }, { zoom: 4, pan: { x: 0.25, y: 0 } },
  ]) {
    await draw(page, viewport);
    const stats = await page.evaluate(() => renderer.stats());
    assert.equal(stats.deviceTextNodes, 1, "fractional transforms retain a bounded screen-phase variant");
    assert.equal(stats.deviceRasterNodeScales[0].scale, viewport.zoom);
  }
  const high = await page.evaluate(() => renderer.stats());
  assert.equal(high.rasterNodeScales[0].scale, 2);
  await draw(page, { zoom: 1, pan: { x: 0, y: 0 } });
  const restored = await page.evaluate(() => renderer.stats());
  assert.equal(restored.deviceTextNodes, 1);
  assert.equal(restored.rasterNodeScales[0].scale, 2);
  assert(restored.rasterTextCacheBytes <= restored.rasterTextCacheBudgetBytes);
  await page.evaluate(() => {
    for (let i = 0; i < 30; i++) renderer.render({ zoom: 1, pan: { x: i, y: 0 } });
  });
  const repeated = await page.evaluate(() => renderer.stats());
  assert.equal(repeated.rasterTextCacheMisses, restored.rasterTextCacheMisses);
  assert.equal(repeated.nodePictureBuilds, restored.nodePictureBuilds);
});

test("device glyph phases follow canonical moves while rotations fall back per node and translation instances retain their own phase", async (t) => {
  const page = await harness(t, { width: 700, height: 400 });
  const fresh = await harness(t, { width: 700, height: 400 });
  const design = phaseFixture();
  await upload(page, design);
  await draw(page, { zoom: 1 });
  const before = await page.evaluate(() => renderer.stats());
  design.nodes[0].x += 0.125; design.nodes[0].y += 0.25;
  await upload(page, design);
  await upload(fresh, design);
  assert.equal(Buffer.compare((await draw(page, { zoom: 1 })).data, (await draw(fresh, { zoom: 1 })).data), 0,
    "a moved fractional phase cannot reuse stale glyph coverage");
  const moved = await page.evaluate(() => renderer.stats());
  assert.equal(moved.rasterTextCacheMisses, before.rasterTextCacheMisses + 2,
    "crossing a CSS paint baseline changes both the local master and device phase");
  assert.equal(moved.rasterTextImages, 2, "the prior phase is replaced rather than accumulated");
  design.nodes[0].x += 1; design.nodes[0].y += 2;
  await upload(page, design);
  await draw(page, { zoom: 1 });
  const integerMove = await page.evaluate(() => renderer.stats());
  assert.equal(integerMove.rasterTextCacheMisses, moved.rasterTextCacheMisses);
  assert.equal(integerMove.nodePictureBuilds, moved.nodePictureBuilds);
  await page.evaluate(async () => {
    for (let i = 1; i <= 16; i++) {
      design.nodes[0].x = 36 + i / 32;
      await renderer.setScene(design, { resources });
      renderer.render({ zoom: 1 });
    }
  });
  const phases = await page.evaluate(() => renderer.stats());
  assert.equal(phases.deviceTextCacheVariants, 1);
  assert.equal(phases.rasterTextImages, 2, "many drag phases retain one master and one device variant");
  assert(phases.rasterTextCacheBytes <= phases.rasterTextCacheBudgetBytes);
  design.nodes.push({ ...design.nodes[0], id: "native", y: 130, fontFamily: "Roboto", fontRef: "roboto", layoutBaselineOffset: 0, text: "Native font bytes" });
  await upload(page, design);
  await draw(page, { zoom: 1 });
  const native = await page.evaluate(() => renderer.stats());
  assert.equal(native.nativeTextNodes, 1);
  assert.equal(native.deviceTextNodes, 1, "only the system font uses a device variant");
  assert.equal(native.rasterNodeScales.some((entry) => entry.nodeId === "native"), false);
  for (const kind of ["rotation", "instance"]) {
    const guarded = phaseFixture();
    const parent = base("parent", kind === "instance" ? "component" : "frame", 0, 0, 300, 200, { fill: "transparent", rotation: kind === "rotation" ? 15 : 0 });
    guarded.nodes[0].parentId = parent.id;
    guarded.nodes.unshift(parent);
    if (kind === "instance") guarded.nodes.push(base("instance", "instance", 330, 0, 300, 200, { componentId: parent.id }));
    await upload(page, guarded);
    await draw(page, { zoom: 1 });
    assert.equal((await page.evaluate(() => renderer.stats())).deviceTextNodes, kind === "rotation" ? 0 : 2, kind);
  }
  const dpr = await harness(t, { width: 700, height: 400, dpr: 2 });
  await upload(dpr, phaseFixture());
  await draw(dpr, { zoom: 0.5, pan: { x: 0.5, y: 0.5 } });
  assert.equal((await dpr.evaluate(() => renderer.stats())).deviceTextNodes, 1);
  await draw(dpr, { zoom: 0.5, pan: { x: 0.25, y: 0.5 } });
  assert.equal((await dpr.evaluate(() => renderer.stats())).deviceTextNodes, 1);
  await draw(dpr, { zoom: 1 });
  assert.equal((await dpr.evaluate(() => renderer.stats())).deviceTextNodes, 1);
});

test("optional device variants yield their pixels to valid masters under the unchanged raster budget", async (t) => {
  const page = await harness(t, { width: 700, height: 400, tileCacheEnabled: false });
  const design = phaseFixture();
  design.nodes[0].text = "Coverage budget ".repeat(12);
  await upload(page, design);
  const master = await page.evaluate(() => renderer.stats());
  await draw(page, { zoom: 1 });
  assert.equal((await page.evaluate(() => renderer.stats())).deviceTextNodes, 1);
  const count = Math.floor(master.rasterTextCacheBudgetBytes / master.rasterTextCacheBytes);
  assert(count > 10 && count < 300);
  design.nodes = Array.from({ length: count }, (_, i) => ({ ...design.nodes[0], id: i ? `budget-${i}` : "phase-text" }));
  await upload(page, design);
  await draw(page, { zoom: 1 });
  const full = await page.evaluate(() => renderer.stats());
  assert.equal(full.rasterTextNodes, count);
  assert(full.deviceTextNodes < count, "optional variants cannot displace required masters");
  assert(full.deviceTextFallbacks.length > 0, "budget fallback must be observable");
  assert(full.deviceTextFallbacks.every(entry => entry.reason === "device-scene-raster-budget"));
  assert(full.rasterTextCacheBytes <= full.rasterTextCacheBudgetBytes);
  assert.equal(full.unrenderedTextLines, 0);
  await draw(page, { zoom: 2 });
  const allFallback = await page.evaluate(() => renderer.stats());
  assert.equal(allFallback.deviceTextNodes, 0, "no 2x variant fits beside the full master allocation");
  assert.equal(allFallback.deviceTextFallbacks.length, count, "all-fallback statistics remain visible without a picture rebuild");
  assert(allFallback.rasterTextCacheBytes <= allFallback.rasterTextCacheBudgetBytes);
});

test("integer device resolution falls back visibly when a per-line allocation exceeds its budget", async t => {
  const page = await harness(t, { width: 700, height: 400, tileCacheEnabled: false });
  const design = phaseFixture();
  design.nodes[0].text = "M".repeat(105);
  await upload(page, design);
  await draw(page, { zoom: 3 });
  const three = await page.evaluate(() => renderer.stats());
  assert.equal(three.deviceRasterNodeScales[0].scale, 3, "3x must not first allocate an oversized 4x master");
  await draw(page, { zoom: 4 });
  const four = await page.evaluate(() => renderer.stats());
  assert.equal(four.deviceTextNodes, 0);
  assert.deepEqual(four.deviceTextFallbacks, [{ nodeId: "phase-text", scale: 4, reason: "device-line-raster-budget" }]);
  assert.equal(four.rasterNodeScales[0].scale, 2);
  assert(four.rasterTextCacheBytes <= four.rasterTextCacheBudgetBytes);
});

test("integer pans retain offscreen device pictures and return trips do not rebuild the whole scene", async (t) => {
  const page = await harness(t, { width: 300, height: 200 });
  const design = phaseFixture();
  design.canvas.width = 2000;
  design.nodes = Array.from({ length: 5 }, (_, i) => ({ ...design.nodes[0], id: `phase-${i}`, x: 36 + i * 300 }));
  await upload(page, design);
  await draw(page, { zoom: 1, pan: { x: 0, y: 0 } });
  const before = await page.evaluate(() => renderer.stats());
  assert.equal(before.deviceTextNodes, 1);
  await draw(page, { zoom: 1, pan: { x: -300, y: 0 } });
  const entered = await page.evaluate(() => renderer.stats());
  assert.equal(entered.deviceTextNodes, 2, "the offscreen phase stays active until an actual invalidation");
  assert.equal(entered.deviceTextSamplingBuilds, before.deviceTextSamplingBuilds + 1);
  assert.equal(entered.rasterTextCacheMisses, before.rasterTextCacheMisses + 1, "only the newly visible text is rasterized");
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) renderer.render({ zoom: 1, pan: { x: i % 2 ? -300 : 0, y: 0 } });
  });
  const returned = await page.evaluate(() => renderer.stats());
  assert.equal(returned.sceneRevision, entered.sceneRevision);
  assert.equal(returned.nodePictureBuilds, entered.nodePictureBuilds);
  assert.equal(returned.deviceTextSamplingBuilds, entered.deviceTextSamplingBuilds);
  assert.equal(returned.rasterTextCacheMisses, entered.rasterTextCacheMisses);
  assert.equal(returned.tileBuilds, entered.tileBuilds);
});

test("native GPU per-corner shapes, ancestor clips and image clips retain asymmetric geometry and invalidate cached pictures", async (t) => {
  const cached = await harness(t, { width: 600, height: 240 }),
    direct = await harness(t, { tileCacheEnabled: false, width: 600, height: 240 });
  const design = {
    canvas: { width: 600, height: 240, background: "#ffffff" }, resources: [], nodes: [
      base("shape", "rectangle", 40, 40, 100, 100, { fill: "#2563eb", cornerRadius: 40, cornerRadii: [40, 0, 24, 8] }),
      base("clip", "frame", 200, 40, 100, 100, { fill: "transparent", clipContent: true, cornerRadius: 40, cornerRadii: [40, 0, 24, 8] }),
      base("child", "rectangle", 180, 20, 140, 140, { parentId: "clip", fill: "#f97316" }),
      base("image", "image", 360, 40, 100, 100, { fill: "transparent", imageRef: "pixel", objectFit: "fill", cornerRadius: 40, cornerRadii: [40, 0, 24, 8] }),
    ],
  };
  const png = new PNG({ width: 1, height: 1 }); png.data.set([255, 0, 255, 255]);
  const bytes = [...PNG.sync.write(png)];
  for (const page of [cached, direct]) await page.evaluate(async ({ design, bytes }) => {
    window.design = design;
    window.resources = new Map([["pixel", { bytes: new Uint8Array(bytes), mimeType: "image/png", descriptor: { id: "pixel", kind: "image", mime: "image/png" } }]]);
    await renderer.setScene(design, { resources });
  }, { design, bytes });
  for (const zoom of [1, 2]) {
    const viewport = { pan: { x: 0, y: 0 }, zoom };
    const actual = await draw(cached, viewport), expected = await draw(direct, viewport);
    t.diagnostic(`cached/direct asymmetric exact pixels at ${zoom}x: ${actual.data.equals(expected.data)}`);
    if (zoom === 1) {
      const reference = await cached.context().newPage();
      const dataUrl = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
      await reference.setContent(`<style>body{margin:0;background:white}.box{position:absolute;top:40px;width:100px;height:100px;border-radius:40px 0 24px 8px}#shape{left:40px;background:#2563eb}#clip{left:200px;overflow:hidden}#child{position:absolute;left:-20px;top:-20px;width:140px;height:140px;background:#f97316}img{left:360px}</style><div id="shape" class="box"></div><div id="clip" class="box"><div id="child"></div></div><img class="box" src="${dataUrl}">`);
      const css = PNG.sync.read(await reference.screenshot());
      let changed = 0, max = 0, total = 0;
      for (let i = 0; i < actual.data.length; i += 4) {
        let differs = false;
        for (let channel = 0; channel < 4; channel++) {
          const delta = Math.abs(actual.data[i + channel] - css.data[i + channel]);
          differs ||= delta > 0; max = Math.max(max, delta); total += delta;
        }
        if (differs) changed++;
      }
      t.diagnostic(`Native WebGL2 vs Chromium CSS exact pixels: ${changed}/${actual.width * actual.height}, max channel ${max}, mean RGBA ${total / actual.data.length}`);
      await reference.close();
    }

    if (zoom === 1) for (const [x, color] of [[40, [37, 99, 235]], [200, [249, 115, 22]], [360, [255, 0, 255]]]) {
      assert.deepEqual(pixel(expected, x + 1, 41), [255, 255, 255]);
      assert.deepEqual(pixel(expected, x + 98, 41), color);
      assert.deepEqual(pixel(actual, x + 1, 41), [255, 255, 255], "rounded top-left excludes ink");
      assert.deepEqual(pixel(actual, x + 98, 41), color, "square top-right retains ink");
      assert.deepEqual(pixel(actual, x + 50, 90), color, "interior retains ink");
      assert.deepEqual(pixel(actual, x + 98, 138), [255, 255, 255], "bottom-right independent radius excludes ink");
    }
  }
  const before = await cached.evaluate(() => renderer.stats());
  for (const page of [cached, direct]) await page.evaluate(async () => {
    const next = structuredClone(design); next.nodes[0].cornerRadii = [0, 40, 0, 24];
    await renderer.setScene(next, { resources });
  });
  const viewport = { pan: { x: 0, y: 0 }, zoom: 1 };
  const after = await draw(cached, viewport), control = await draw(direct, viewport);
  t.diagnostic(`edited cached/direct asymmetric exact pixels: ${after.data.equals(control.data)}`);
  assert.deepEqual(pixel(control, 41, 41), [37, 99, 235]);
  assert.deepEqual(pixel(control, 138, 41), [255, 255, 255]);
  assert.deepEqual(pixel(after, 41, 41), [37, 99, 235]);
  assert.deepEqual(pixel(after, 138, 41), [255, 255, 255]);
  const stats = await cached.evaluate(() => renderer.stats());
  assert.equal(stats.nodePictureBuilds, before.nodePictureBuilds + 1);
});


test("native GPU inside side borders preserve zero edges, alpha corners and edited cached pictures", async (t) => {
  const cached = await harness(t, { width: 600, height: 240 }),
    direct = await harness(t, { tileCacheEnabled: false, width: 600, height: 240 });
  const side = (width, opacity = 1) => ({ width, color: "#1d70b8", opacity });
  const design = { canvas: { width: 600, height: 240, background: "#ffffff" }, resources: [], nodes: [
    base("bottom", "rectangle", 40, 40, 100, 100, { fill: "#ffffff", strokeAlign: "inside", strokeSides: [side(0), side(0), side(1), side(0)] }),
    base("alpha", "frame", 200, 40, 100, 100, { fill: "#ffffff", strokeAlign: "inside", strokeSides: Array.from({ length: 4 }, () => side(4, 0.5)) }),
    base("unequal", "rectangle", 360, 40, 100, 100, { fill: "#ffffff", strokeAlign: "inside", strokeSides: [side(2), side(4), side(6), side(8)] }),
  ] };
  for (const page of [cached, direct]) await upload(page, design);
  const viewport = { pan: { x: 0, y: 0 }, zoom: 1 };
  const actual = await draw(cached, viewport), expected = await draw(direct, viewport);
  assert.equal(actual.data.equals(expected.data), true, "tile and direct border pixels agree");
  for (const png of [actual, expected]) {
    assert.deepEqual(pixel(png, 40, 40), [255, 255, 255], "zero top and left edges stay unpainted");
    assert.deepEqual(pixel(png, 80, 139), [29, 112, 184]);
    near(pixel(png, 200, 40), [142, 184, 220], 1);
    assert.deepEqual(pixel(png, 200, 40), pixel(png, 240, 40), "border corner alpha applies once");
    assert.deepEqual(pixel(png, 360, 80), [29, 112, 184]);
    assert.deepEqual(pixel(png, 370, 80), [255, 255, 255]);
  }
  const before = await cached.evaluate(() => renderer.stats());
  design.nodes[0].width = 160;
  design.nodes[0].strokeSides[2] = { width: 3, color: "#ff0000", opacity: 1 };
  for (const page of [cached, direct]) await upload(page, design);
  const edited = await draw(cached, viewport), control = await draw(direct, viewport);
  assert.equal(edited.data.equals(control.data), true);
  assert.deepEqual(pixel(edited, 198, 138), [255, 0, 0]);
  assert.deepEqual(pixel(edited, 198, 135), [255, 255, 255]);
  assert.equal((await cached.evaluate(() => renderer.stats())).nodePictureBuilds, before.nodePictureBuilds + 1);
});

test("CSS geometric shadow stacks keep transparent fill, colored order, border phase and cached repaint editable",async t=>{
  const page=await harness(t,{width:640,height:240});
  const layers=[{kind:"inner",color:"#dc2626",opacity:1,x:12,y:0,blur:0,spread:0,visible:true},{kind:"inner",color:"#2563eb",opacity:1,x:0,y:12,blur:0,spread:0,visible:true}];
  const design={canvas:{width:640,height:240,background:"#ffffff"},resources:[],nodes:[base("masked","rectangle",30,30,160,100,{fill:"transparent",stroke:"#16a34a",strokeWidth:4,strokeAlign:"inside",strokeSides:Array.from({length:4},()=>({width:4,color:"#16a34a",opacity:1})),shadowStack:{basis:"css-box",layers}})]};
  const viewport={zoom:1,pan:{x:0,y:0}};await upload(page,design);let image=await draw(page,viewport);
  for(const [x,y,color] of [[31,50,[22,163,74]],[38,38,[220,38,38]],[60,38,[37,99,235]],[60,70,[255,255,255]],[28,38,[255,255,255]]])assert.deepEqual(pixel(image,x,y),color);
  const first=await page.evaluate(()=>renderer.stats());
  design.nodes[0].shadowStack.layers.reverse();await upload(page,design);image=await draw(page,viewport);assert.deepEqual(pixel(image,38,38),[37,99,235]);
  const second=await page.evaluate(()=>renderer.stats());assert.equal(second.nodePictureBuilds,first.nodePictureBuilds+1);
  await draw(page,{zoom:1,pan:{x:32,y:0}});const pan=await page.evaluate(()=>renderer.stats());assert.equal(pan.nodePictureBuilds,second.nodePictureBuilds);
  design.nodes[0].shadowStack.layers[0].visible=false;await upload(page,design);image=await draw(page,viewport);assert.deepEqual(pixel(image,38,38),[220,38,38]);assert.deepEqual(pixel(image,60,38),[255,255,255]);
  design.nodes[0].shadowStack.layers[0]={...layers[0],kind:"outer",color:"#2563eb",visible:true,x:-10,y:0,blur:8};await upload(page,design);image=await draw(page,viewport);assert.notDeepEqual(pixel(image,18,70),[255,255,255],"blurred outer mask survives raw-picture culling");assert.deepEqual(pixel(image,60,70),[255,255,255],"outer knockout never colors the transparent box interior");
  const blur=await page.evaluate(()=>renderer.stats());assert(blur.unsupported.some(issue=>issue.code==="css-shadow-raster-kernel"),"kernel parity remains explicitly unverified");
});


for (const { dpr, zoom, pan } of [
  {dpr:2,zoom:1,pan:{x:-3.25,y:0}},
  {dpr:1,zoom:.66,pan:{x:17.125,y:8.375}},
  {dpr:1,zoom:2,pan:{x:.25,y:.5}},
]) test(`fractional viewport ${dpr} DPR / ${zoom} zoom uses actual screen phase beside component instances`, async t => {
  const page = await harness(t, {width:1500,height:700,dpr,tileCacheEnabled:true,background:"#ffffff"});
  const design = phaseFixture(); design.canvas.width=1500; design.canvas.height=700;
  design.nodes[0].x=36.375;design.nodes[0].y=41.41;
  design.nodes[0].fontSize=20;
  const component=base("phase-component","component",30.125,110.25,310,100,{fill:"transparent",layout:"none"});
  const child={...design.nodes[0],id:"phase-child",x:40.375,y:128.41,width:280,parentId:component.id};
  const instance=base("phase-instance","instance",420.375,200.75,310,100,{componentId:component.id});
  design.nodes.push(component,child,instance);
  const source=JSON.stringify(design), viewport={zoom,pan};
  await upload(page,design); await page.evaluate(viewport=>renderer.render(viewport),viewport);
  const output=resolve(process.env.DESIGN_TRANSFORM_EVIDENCE??".tmp/render-fidelity-r003/transform",`dpr${dpr}-zoom${zoom}`);
  await mkdir(output,{recursive:true});
  const actual=PNG.sync.read(await page.screenshot({scale:"device",path:resolve(output,"gpu.png")}));
  const stats=await page.evaluate(()=>renderer.stats());
  await page.evaluate(async({design,viewport})=>{
    const {renderDesignFrontendPage,designFrontendCss}=await import("/frontend-export.mjs");
    design={...design,format:"codeshell.design",version:3,name:"Phase fixture",activePageId:"main",pages:[{id:"main",name:"Main",nodes:design.nodes}]};
    document.querySelector("canvas").style.visibility="hidden";
    const wrapper=document.createElement("div");wrapper.id="phase-html";
    wrapper.style.cssText=`position:absolute;left:0;top:0;width:1500px;height:700px;transform-origin:0 0;transform:translate(${viewport.pan.x}px,${viewport.pan.y}px) scale(${viewport.zoom})`;
    wrapper.innerHTML=`<style>${designFrontendCss(design)}.cs-page{margin:0!important}</style>${renderDesignFrontendPage(design)}`;
    document.body.append(wrapper);await document.fonts.ready;
  },{design,viewport});
  const expected=PNG.sync.read(await page.screenshot({scale:"device",path:resolve(output,"html.png")}));
  const nodes=[design.nodes[0],child,{...child,id:"instance-text",x:child.x+instance.x-component.x,y:child.y+instance.y-component.y}];
  const rows=nodes.map(n=>{
    const scale=dpr*zoom,roi={x:(pan.x+(n.x-3)*zoom)*dpr,y:(pan.y+(n.y-3)*zoom)*dpr,width:(n.width+6)*scale,height:(n.height+6)*scale};
    const pixel=symmetricPixelDifference(expected,actual,{roi});
    const geometry=geometryDifference(inkGeometry(expected,{roi,foreground:[15,23,42]}),inkGeometry(actual,{roi,foreground:[15,23,42]}));
    return {id:n.id,pixel,geometry,failures:textGeometryFailures(geometry,{scale,align:"left"})};
  });
  await writeFile(resolve(output,"metrics.json"),JSON.stringify({dpr,zoom,pan,rows,stats},null,2));
  assert.equal(JSON.stringify(design),source,"viewport sampling must not write design geometry");
  assert.deepEqual(rows.filter(row=>row.failures.length||row.pixel.mismatchRatio>.005||row.pixel.largestCluster>6),[],"fractional pan/fit-view and translation instances keep strict text geometry and pixels");
  assert(stats.deviceTextNodes>=2,"an instance cannot disable unrelated text device sampling");
  assert(stats.rasterTextCacheBytes<=stats.rasterTextCacheBudgetBytes);
});


test("loaded FontFace invalidates retained glyph pictures on render without a document edit", async t => {
  const page=await harness(t,{width:700,height:200,tileCacheEnabled:false,background:"#ffffff"});
  const design=phaseFixture(); design.nodes[0].fontFamily='"LatePhaseFont", Arial, sans-serif';
  await upload(page,design); const before=await draw(page,{zoom:1});
  const first=await page.evaluate(()=>renderer.stats());
  await page.evaluate(async()=>{
    const bytes=await(await fetch("/fonts/InterVariable.woff2")).arrayBuffer();
    const face=await new FontFace("LatePhaseFont",bytes,{weight:"100 900"}).load();
    document.fonts.add(face);renderer.render({zoom:1});
  });
  const actual=PNG.sync.read(await page.screenshot({scale:"css"}));
  const after=await page.evaluate(()=>renderer.stats());
  assert(after.nodePictureBuilds>first.nodePictureBuilds);
  assert.notEqual(Buffer.compare(before.data,actual.data),0,"late font must replace previously painted fallback glyphs");
  await upload(page,design);const refreshed=await draw(page,{zoom:1});
  assert.equal(Buffer.compare(actual.data,refreshed.data),0,"render-only invalidation agrees with explicit scene refresh");
  assert(after.nodePictureCacheBytes<=after.nodePictureCacheBudgetBytes);
  assert(after.rasterTextCacheBytes<=after.rasterTextCacheBudgetBytes);
});

for(const {dpr,zoom} of [{dpr:1,zoom:1},{dpr:2,zoom:1},{dpr:1,zoom:2}])
test(`absolute fractional fill boxes and clip use Blink edges at ${dpr} DPR / ${zoom} zoom`,async t=>{
  const page=await harness(t,{width:700,height:350,dpr,tileCacheEnabled:false,background:"#ffffff"});
  const design={canvas:{width:700,height:350,background:"#ffffff"},resources:[],nodes:[
    base("stop-square","rectangle",20.5,20.5,14.4,14.4),
    base("ellipse","ellipse",60.75,20.25,14.4,10.4),
    base("nested","frame",100.35,20.35,50,50,{fill:"transparent",layout:"none"}),
    base("nested-fill","rectangle",100.5,20.5,14.4,14.4,{parentId:"nested"}),
    base("clip","frame",170.5,20.5,14.4,14.4,{fill:"transparent",layout:"none",clipContent:true,cornerRadius:2.4}),
    base("clip-ink","rectangle",160,10,40,40,{parentId:"clip"}),
  ]};
  const source=JSON.stringify(design);await upload(page,design);await page.evaluate(zoom=>renderer.render({zoom}),zoom);
  const output=resolve(process.env.DESIGN_BOX_EVIDENCE??".tmp/render-fidelity-r003/box",`dpr${dpr}-zoom${zoom}`);await mkdir(output,{recursive:true});
  const actual=PNG.sync.read(await page.screenshot({path:resolve(output,"gpu.png"),scale:"device"}));
  const stats=await page.evaluate(()=>renderer.stats());
  await page.evaluate(async({design,zoom})=>{
    const {renderDesignFrontendPage,designFrontendCss}=await import("/frontend-export.mjs");
    design={...design,format:"codeshell.design",version:3,name:"Box fixture",activePageId:"main",pages:[{id:"main",name:"Main",nodes:design.nodes}]};
    document.querySelector("canvas").style.visibility="hidden";
    const wrapper=document.createElement("div");wrapper.style.cssText=`position:absolute;left:0;top:0;width:700px;height:350px;transform-origin:0 0;transform:scale(${zoom})`;
    wrapper.innerHTML=`<style>${designFrontendCss(design)}.cs-page{margin:0!important}</style>${renderDesignFrontendPage(design)}`;document.body.append(wrapper);
  },{design,zoom});
  const expected=PNG.sync.read(await page.screenshot({path:resolve(output,"html.png"),scale:"device"}));
  const {shapeGeometryFailures,shapePixelQualification}=await import("./render-fidelity.metrics.mjs");
  const rows=design.nodes.filter(n=>["stop-square","ellipse","nested-fill","clip"].includes(n.id)).map(n=>{
    const scale=dpr*zoom,roi={x:(n.x-4)*scale,y:(n.y-4)*scale,width:(n.width+8)*scale,height:(n.height+8)*scale};
    const delta=geometryDifference(inkGeometry(expected,{roi}),inkGeometry(actual,{roi})),failures=shapeGeometryFailures(delta);
    return{id:n.id,delta,failures,pixel:shapePixelQualification(expected,actual,{roi,geometryPassed:failures.length===0})};
  });
  await writeFile(resolve(output,"metrics.json"),JSON.stringify({dpr,zoom,rows,stats},null,2));
  assert.equal(JSON.stringify(design),source);
  assert.deepEqual(rows.filter(row=>row.failures.length),[],"all filled boxes and clipping must pass strict geometry");
  // Ellipse AA remains a reported strict visual residual in the full harness.
  assert.deepEqual(rows.filter(row=>row.id!=="ellipse"&&!row.pixel.rawPass&&!row.pixel.qualified),[]);
});

test("presentation boxes preserve the detached master opacity contract in external instances",async t=>{
  const page=await harness(t,{width:700,height:250,tileCacheEnabled:false,background:"#ffffff"});
  const design={canvas:{width:700,height:250,background:"#ffffff"},resources:[],nodes:[
    base("source-parent","frame",20,20,180,180,{fill:"transparent",opacity:.5,layout:"none"}),
    base("master","component",30,30,80,60,{fill:"transparent",opacity:.6,parentId:"source-parent",layout:"none"}),
    base("blue","rectangle",40,40,20,20,{fill:"#0000ff",parentId:"master"}),
    base("outside","instance",350,30,80,60,{componentId:"master",fill:"transparent"}),
  ]};
  await upload(page,design);const pixels=await draw(page,{zoom:1});
  near(pixel(pixels,45,45),[179,179,255],2);
  near(pixel(pixels,365,45),[102,102,255],2);
});

// One sequence exercises real fractional phases; timing is reported, never gated.
// Optional personal input is read only and is never required by the offline suite.
test("fractional viewport gestures reuse cached text until one 150ms device-phase settle", async t => {
  const output = resolve(process.env.DESIGN_PERF_EVIDENCE ?? ".tmp/render-fidelity-r004/perf/cache");
  await mkdir(output, { recursive: true });
  const small = phaseFixture();
  small.nodes.push(base("perf-master", "component", 20.125, 110.25, 300, 70, { fill: "transparent", layout: "none" }),
    { ...small.nodes[0], id: "perf-master-text", x: 30.375, y: 126.41, width: 280, parentId: "perf-master" },
    base("perf-instance", "instance", 360.375, 190.75, 300, 70, { componentId: "perf-master", fill: "transparent" }));
  const cases = [{ id: "fractional-instance", design: small }];
  if (process.env.DESIGN_PERF_REAL_FIXTURE) {
    const portable = JSON.parse(await readFile(process.env.DESIGN_PERF_REAL_FIXTURE, "utf8"));
    assert.equal(portable.resources.length, 0, "this bounded performance input has no external resources");
    const document = normalizeDesignDocument(portable.document);
    for (const page of document.pages) cases.push({ id: `real-${page.id}`, design: { ...document, activePageId: page.id, nodes: page.nodes } });
    const original = importFigmaJson(longFigmaSource()).document;
    assert.equal(original.nodes.length, 1208);
    cases.push({ id: "long-1208-original", design: original });
    // The existing 1208-layer fixture contains no text. Preserve that control,
    // then derive a same-count text/instance stress case to make raster counts useful.
    const stress = structuredClone(original);
    stress.nodes = stress.nodes.map((node, i) => i && i % 4 === 0 ? { ...node, type: "text", text: `Fractional text ${i}`, fontFamily: "Arial", fontSize: 13,
      fontWeight: 400, fontStyle: "normal", lineHeight: 1.2, textAlign: "left", fill: "#0f172a" } : node);
    stress.nodes[1] = { ...stress.nodes[1], type: "component", fill: "transparent", layout: "none" };
    stress.nodes[2] = { ...stress.nodes[4], id: stress.nodes[2].id, x: stress.nodes[1].x + 3.375, y: stress.nodes[1].y + 2.41, parentId: stress.nodes[1].id };
    stress.nodes[3] = { ...stress.nodes[3], type: "instance", componentId: stress.nodes[1].id, fill: "transparent" };
    cases.push({ id: "long-1208-text-instance-stress", design: stress });
  }
  const page = await harness(t, { width: 1500, height: 1000, dpr: 2, tileCacheEnabled: false, background: "#ffffff" });
  const rows = [];
  for (const item of cases) {
    await upload(page, item.design);
    const source = JSON.stringify(item.design);
    const row = await page.evaluate(async ({ id, design }) => {
      const view = { zoom: 1, pan: { x: 44, y: 44 } };
      renderer.render(view);
      const pick = () => {
        const s = renderer.stats();
        return { observedAtMs: performance.now(), deviceTextSamplingBuilds: s.deviceTextSamplingBuilds, rasterTextCacheMisses: s.rasterTextCacheMisses,
          textQualityBuilds: s.textQualityBuilds, nodePictureBuilds: s.nodePictureBuilds, deviceTextNodes: s.deviceTextNodes,
          rasterTextCacheBytes: s.rasterTextCacheBytes, rasterTextCacheBudgetBytes: s.rasterTextCacheBudgetBytes, renderedFrames: s.renderedFrames,
          asynchronousRenderError: s.asynchronousRenderError };
      };
      const initial = pick(), frames = [];
      for (let frame = 0; frame < 80; frame++) {
        await new Promise(requestAnimationFrame);
        if (frame < 60) { view.pan.x -= .375; view.pan.y -= .1875; }
        else {
          const next = view.zoom * Math.exp(-.75 * .006), ratio = next / view.zoom;
          view.pan.x = 400 - (400 - view.pan.x) * ratio; view.pan.y = 300 - (300 - view.pan.y) * ratio;
          view.zoom = next;
        }
        const started = performance.now();
        renderer.render({ ...view, interactive: true });
        const renderMs = performance.now() - started;
        // A chrome/selection repaint during the same gesture must retain deferral.
        if (frame === 25) renderer.render(view);
        frames.push({ frame, kind: frame < 60 ? "fractional-trackpad" : "ctrl-zoom", pan: { ...view.pan }, zoom: view.zoom, renderMs, ...pick() });
      }
      const beforeSettle = pick();
      await new Promise(done => setTimeout(done, 210));
      const settled = pick();
      renderer.render(view);
      const afterRedraw = pick();
      const timings = frames.map(frame => frame.renderMs).sort((a, b) => a - b);
      return { id, layerCount: design.nodes.length, textCount: design.nodes.filter(n => n.type === "text").length,
        instanceCount: design.nodes.filter(n => n.type === "instance").length, dpr: 2, initial, frames, beforeSettle, settled, afterRedraw,
        finalView: view, p50RenderMs: timings[Math.floor(timings.length * .5)], p95RenderMs: timings[Math.floor(timings.length * .95)],
        timingScope: "synchronous renderer.render CPU time including text preparation; excludes GPU completion/presentation" };
    }, item);
    rows.push(row);
    await writeFile(resolve(output, "frames.json"), JSON.stringify(rows, null, 2));
    assert.equal(JSON.stringify(item.design), source);
  }
  t.diagnostic(JSON.stringify(rows.map(({ id, layerCount, textCount, instanceCount, initial, beforeSettle, settled, p50RenderMs, p95RenderMs }) =>
    ({ id, layerCount, textCount, instanceCount, gestureBuilds: beforeSettle.deviceTextSamplingBuilds - initial.deviceTextSamplingBuilds,
      gestureRasterMisses: beforeSettle.rasterTextCacheMisses - initial.rasterTextCacheMisses,
      settleBuilds: settled.deviceTextSamplingBuilds - beforeSettle.deviceTextSamplingBuilds, p50RenderMs, p95RenderMs }))));
  for (const row of rows) {
    assert.equal(row.beforeSettle.deviceTextSamplingBuilds, row.initial.deviceTextSamplingBuilds, `${row.id}: gesture must not rebuild screen-phase pictures`);
    assert.equal(row.beforeSettle.rasterTextCacheMisses, row.initial.rasterTextCacheMisses, `${row.id}: gesture must reuse glyph images`);
    assert.equal(row.beforeSettle.textQualityBuilds, row.initial.textQualityBuilds, `${row.id}: instances must not upgrade masters per gesture frame`);
    assert(row.settled.deviceTextSamplingBuilds - row.beforeSettle.deviceTextSamplingBuilds <= 1, `${row.id}: at most one settle rebuild`);
    assert.equal(row.afterRedraw.deviceTextSamplingBuilds, row.settled.deviceTextSamplingBuilds);
    assert.equal(row.afterRedraw.rasterTextCacheMisses, row.settled.rasterTextCacheMisses);
    assert.equal(row.settled.asynchronousRenderError, null);
    assert(row.frames.every(frame => frame.rasterTextCacheBytes <= frame.rasterTextCacheBudgetBytes));
    if (row.id === "fractional-instance") assert(row.settled.deviceTextNodes >= 3, "translation-instance and ordinary text regain precise static sampling");
  }
  // Settled Retina output must be exactly the normal static rendering at the
  // final view, rather than permanently retaining the motion-time resampling.
  await upload(page, small);
  await page.evaluate(() => { renderer.render({ zoom: 1, pan: { x: .375, y: .1875 } }); renderer.render({ zoom: 1, pan: { x: 3.625, y: 2.3125 }, interactive: true }); });
  await page.waitForTimeout(210);
  const settledPixels = await page.screenshot({ scale: "device", path: resolve(output, "settled-retina.png") });
  const fresh = await harness(t, { width: 1500, height: 1000, dpr: 2, tileCacheEnabled: false, background: "#ffffff" });
  await upload(fresh, small);
  await fresh.evaluate(() => renderer.render({ zoom: 1, pan: { x: 3.625, y: 2.3125 } }));
  const staticPixels = await fresh.screenshot({ scale: "device", path: resolve(output, "static-retina.png") });
  assert.equal(Buffer.compare(settledPixels, staticPixels), 0, "settled device-phase text exactly matches a fresh Retina render");
  await page.evaluate(() => { renderer.render({ zoom: 1.01, pan: { x: 4.125, y: 3.1875 }, interactive: true }); renderer.dispose(); });
  await page.waitForTimeout(210);
});

test("gesture idle callbacks cancel on scene/size changes and report asynchronous raster failures", async t => {
  const page = await harness(t, { width: 700, height: 400, dpr: 2, tileCacheEnabled: false });
  const small = phaseFixture();
  await upload(page, small);
  const huge = phaseFixture();
  huge.nodes[0].x = 0; huge.nodes[0].y = 0; huge.nodes[0].parentId = "huge-master";
  huge.nodes.push(base("huge-master", "component", 0, 0, 700, 400, { fill: "transparent", layout: "none" }),
    base("huge-instance", "instance", 0, 0, 70000, 40000, { fill: "transparent", componentId: "huge-master" }));
  await page.evaluate(async huge => {
    renderer.dispose();
    const { createRenderer } = await import("/canvas/canvaskit-renderer.mjs");
    window.idleErrors = [];
    window.renderer = await createRenderer({ canvas: document.querySelector("canvas"), assetsBaseUrl: "/canvas/vendor/", tileCacheEnabled: false,
      onError: error => idleErrors.push(error.message) });
    renderer.resize(700, 400, 2);
    await renderer.setScene(huge);
    renderer.render({ interactive: true });
  }, huge);
  await page.waitForTimeout(210);
  const failed = await page.evaluate(() => ({ errors: idleErrors, stats: renderer.stats() }));
  assert.equal(failed.errors.length, 1);
  assert.match(failed.errors[0], /bounded.*raster budget/);
  assert.equal(failed.stats.asynchronousRenderError, failed.errors[0]);
  assert(await page.evaluate(() => { try { renderer.render(); return false; } catch { return true; } }), "the failure cannot be read as a successful next frame");
  await page.evaluate(async ({ huge, small }) => {
    // A new scene clears the old failure and cancels the old camera callback.
    await renderer.setScene(huge); renderer.render({ interactive: true });
    await renderer.setScene(small); renderer.render();
  }, { huge, small });
  const sceneFrames = await page.evaluate(() => renderer.stats().renderedFrames);
  await page.waitForTimeout(210);
  assert.equal(await page.evaluate(() => renderer.stats().renderedFrames), sceneFrames);
  await page.evaluate(() => { renderer.render({ zoom: 1.01, interactive: true }); renderer.resize(699, 399, 2); renderer.render(); });
  const resizedFrames = await page.evaluate(() => renderer.stats().renderedFrames);
  await page.waitForTimeout(210);
  assert.equal(await page.evaluate(() => renderer.stats().renderedFrames), resizedFrames);
  assert.equal(await page.evaluate(() => idleErrors.length), 1);
  assert.equal(await page.evaluate(() => renderer.stats().asynchronousRenderError), null);
});
