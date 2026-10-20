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

async function harness(t, { tileCacheEnabled = true, deviceTextSampling = true, width = 900, height = 600, dpr = 1 } = {}) {
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
    async ({ tileCacheEnabled, deviceTextSampling, width, height, dpr }) => {
      const { createRenderer } = await import("/canvas/canvaskit-renderer.mjs");
      window.renderer = await createRenderer({
        canvas: document.querySelector("canvas"),
        assetsBaseUrl: "/canvas/vendor/",
        tileCacheEnabled,
        deviceTextSampling,
      });
      renderer.resize(width, height, dpr);
    },
    { tileCacheEnabled, deviceTextSampling, width, height, dpr },
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

const phaseFixture = () => ({
  canvas: { width: 700, height: 400, background: "#ffffff" }, resources: [],
  nodes: [base("phase-text", "text", 36, 41.41, 568, 30, {
    text: "Editable Auto Layout", fontFamily: "Arial", fontSize: 24, fontWeight: 700,
    fontStyle: "normal", lineHeight: 1.25, textAlign: "left", fill: "#0f172a",
  })],
});

test("device text coverage follows real browser pixel phase at physical 1x and integer pans reuse both master and device glyphs", async (t) => {
  const page = await harness(t, { width: 700, height: 400 });
  const control = await harness(t, { width: 700, height: 400, deviceTextSampling: false });
  const design = phaseFixture();
  await upload(page, design);
  await upload(control, design);
  const actual = await draw(page, { zoom: 1, pan: { x: 0, y: 0 } });
  const reference = await page.evaluate(() => {
    const reference = document.createElement("canvas");
    reference.width = 700; reference.height = 400;
    const ctx = reference.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 700, 400);
    ctx.font = 'normal 700 24px "Arial"'; ctx.fontKerning = "normal";
    ctx.textBaseline = "hanging"; ctx.letterSpacing = "0px";
    ctx.fillStyle = "#0f172a"; ctx.fillText("Editable Auto Layout", 36, 41.41);
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
    { zoom: 2, pan: { x: 0, y: 0 } }, { zoom: 4, pan: { x: 0, y: 0 } },
  ]) {
    const fallback = await draw(page, viewport), expected = await draw(control, viewport);
    assert.equal(Buffer.compare(fallback.data, expected.data), 0, "non-device transforms must retain the existing master pixels");
    assert.equal((await page.evaluate(() => renderer.stats())).deviceTextNodes, 0);
  }
  const high = await page.evaluate(() => renderer.stats());
  assert.equal(high.rasterNodeScales[0].scale, 4);
  await draw(page, { zoom: 1, pan: { x: 0, y: 0 } });
  const restored = await page.evaluate(() => renderer.stats());
  assert.equal(restored.deviceTextNodes, 1);
  assert.equal(restored.rasterNodeScales[0].scale, 4);
  assert(restored.rasterTextCacheBytes <= restored.rasterTextCacheBudgetBytes);
  await page.evaluate(() => {
    for (let i = 0; i < 30; i++) renderer.render({ zoom: 1, pan: { x: i, y: 0 } });
  });
  const repeated = await page.evaluate(() => renderer.stats());
  assert.equal(repeated.rasterTextCacheMisses, restored.rasterTextCacheMisses);
  assert.equal(repeated.nodePictureBuilds, restored.nodePictureBuilds);
});

test("device glyph phases follow canonical moves while rotations, instances and fractional DPR pans select masters", async (t) => {
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
  assert.equal(moved.rasterTextCacheMisses, before.rasterTextCacheMisses + 1);
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
  design.nodes.push({ ...design.nodes[0], id: "native", y: 130, fontFamily: "Roboto", fontRef: "roboto", text: "Native font bytes" });
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
    assert.equal((await page.evaluate(() => renderer.stats())).deviceTextNodes, 0, kind);
  }
  const dpr = await harness(t, { width: 700, height: 400, dpr: 2 });
  await upload(dpr, phaseFixture());
  await draw(dpr, { zoom: 0.5, pan: { x: 0.5, y: 0.5 } });
  assert.equal((await dpr.evaluate(() => renderer.stats())).deviceTextNodes, 1);
  await draw(dpr, { zoom: 0.5, pan: { x: 0.25, y: 0.5 } });
  assert.equal((await dpr.evaluate(() => renderer.stats())).deviceTextNodes, 0);
  await draw(dpr, { zoom: 1 });
  assert.equal((await dpr.evaluate(() => renderer.stats())).deviceTextNodes, 0);
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
  assert(full.rasterTextCacheBytes <= full.rasterTextCacheBudgetBytes);
  assert.equal(full.unrenderedTextLines, 0);
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
