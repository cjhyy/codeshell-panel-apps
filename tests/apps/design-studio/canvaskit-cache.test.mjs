import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const root = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));
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
      text: "Browser font glyphs",
      fontFamily: "Arial",
      fontSize: 24,
      fontWeight: 400,
      lineHeight: 1.3,
      textAlign: "left",
    }),
    base("native-text", "text", 70, 450, 300, 40, {
      text: "Native Roboto",
      fontFamily: "Roboto",
      fontRef: "roboto",
      fontSize: 24,
      fontWeight: 700,
      lineHeight: 1.3,
      textAlign: "left",
    }),
  ],
});

async function harness(t, { tileCacheEnabled = true, width = 900, height = 600, dpr = 1 } = {}) {
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
    async ({ tileCacheEnabled, width, height, dpr }) => {
      const { createRenderer } = await import("/canvas/canvaskit-renderer.mjs");
      window.renderer = await createRenderer({
        canvas: document.querySelector("canvas"),
        assetsBaseUrl: "/canvas/vendor/",
        tileCacheEnabled,
      });
      renderer.resize(width, height, dpr);
    },
    { tileCacheEnabled, width, height, dpr },
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
  await upload(page, fixture());
  await draw(page, { zoom: 1, pan: { x: 0, y: 0 } });
  const before = await page.evaluate(() => renderer.stats());
  const png = await draw(page, { zoom: 4, pan: { x: -250, y: -1350 } });
  const after = await page.evaluate(() => renderer.stats());
  assert.equal(after.resourceBuilds, 1);
  assert.equal(after.textQualityBuilds, 1);
  assert.equal(after.nodePictureBuilds, before.nodePictureBuilds + 1);
  assert.equal(after.rasterNodeScales.find((entry) => entry.nodeId === "system-text").scale, 8);
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
  await upload(page, fixture());
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
