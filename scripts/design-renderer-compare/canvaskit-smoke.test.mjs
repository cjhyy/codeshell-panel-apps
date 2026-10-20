import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import {
  normalizeDesignDocument,
  exportDesignSvg,
} from "../../apps/design-studio/app/document.mjs";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const require = createRequire(import.meta.url);
const assets = process.env.CANVASKIT_ASSETS_DIR
  ? resolve(process.env.CANVASKIT_ASSETS_DIR)
  : dirname(require.resolve("canvaskit-wasm/bin/canvaskit.js"));
const node = (id, type, x, y, width, height, extra = {}) => ({
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
  ...(["frame", "component", "group"].includes(type)
    ? { layout: "none", gap: 0, padding: 0, alignItems: "start", justifyContent: "start" }
    : {}),
  ...extra,
});
function fixture() {
  return normalizeDesignDocument({
    format: "codeshell.design",
    version: 3,
    name: "CanvasKit smoke",
    canvas: { width: 400, height: 300, background: "#ffffff" },
    tokens: { colors: [] },
    resources: [
      {
        id: "roboto",
        kind: "font",
        mime: "font/ttf",
        bytes: 488584,
        sha256: "d7598e12c5dbef095ff8272cfc55da0250bd07fbdecbac8a530b9b277872a134",
        partCount: 2,
        family: "Roboto",
        weight: 700,
        style: "normal",
      },
      {
        id: "missing",
        kind: "image",
        mime: "image/png",
        bytes: 1,
        sha256: "0".repeat(64),
        partCount: 1,
      },
    ],
    activePageId: "page-1",
    pages: [
      {
        id: "page-1",
        name: "Main",
        children: [
          node("clip", "frame", 20, 20, 60, 60, {
            fill: "transparent",
            opacity: 0.5,
            clipContent: true,
            children: [
              node("alpha", "rectangle", 0, 0, 120, 120, { fill: "#ff0000", opacity: 0.5 }),
            ],
          }),
          node("rotate", "rectangle", 140, 20, 80, 20, { fill: "#0000ff", rotation: 90 }),
          node("gradient", "rectangle", 20, 140, 120, 40, {
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
          node("shadow", "rectangle", 200, 140, 40, 40, {
            fill: "#ffffff",
            shadow: { x: 10, y: 10, blur: 8, color: "#000000", opacity: 0.8 },
          }),
          node("text", "text", 20, 205, 120, 70, {
            text: "A\nB",
            fontFamily: "Roboto",
            fontRef: "roboto",
            fontSize: 24,
            fontWeight: 700,
            lineHeight: 1.3,
            textAlign: "left",
          }),
          node("missing-1", "image", 300, 20, 40, 40, { imageRef: "missing", objectFit: "cover" }),
          node("missing-2", "image", 300, 90, 40, 40, {
            imageRef: "missing",
            objectFit: "contain",
          }),
          node("system-text", "text", 170, 220, 100, 35, {
            text: "Arial",
            fontFamily: "Arial",
            fontSize: 20,
            fontWeight: 400,
            lineHeight: 1.2,
            textAlign: "left",
          }),
        ],
      },
    ],
  });
}
async function harness(run) {
  const server = createServer(async (request, response) => {
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:",
    );
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (pathname === "/") {
        response.setHeader("Content-Type", "text/html");
        response.end(
          '<!doctype html><style>body{margin:0}canvas{display:block}</style><canvas width="400" height="300"></canvas>',
        );
        return;
      }
      const base = pathname.startsWith("/vendor/") ? assets : root;
      const path = resolve(
        base,
        pathname.startsWith("/vendor/") ? pathname.slice(8) : pathname.slice(1),
      );
      if (!path.startsWith(`${base}${sep}`)) throw Error("Path escape");
      const bytes = await readFile(path);
      response.setHeader(
        "Content-Type",
        extname(path) === ".wasm"
          ? "application/wasm"
          : [".js", ".mjs"].includes(extname(path))
            ? "text/javascript"
            : "application/octet-stream",
      );
      response.end(bytes);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-webgl", "--enable-unsafe-swiftshader"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 320 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener("securitypolicyviolation", (event) =>
        window.cspViolations.push({
          directive: event.effectiveDirective,
          blocked: event.blockedURI,
        }),
      );
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => {
      const { createRenderer } =
        await import("/scripts/design-renderer-compare/canvaskit-adapter.mjs");
      window.renderer = await createRenderer({
        canvas: document.querySelector("canvas"),
        assetsBaseUrl: "/vendor/",
      });
    });
    await run(page);
    assert.deepEqual(errors, []);
    assert.deepEqual(
      await page.evaluate(() => window.cspViolations),
      [],
      "Wasm-specific CSP must suffice without arbitrary JS eval",
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
const pixel = (png, x, y) => [
  ...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3),
];
function near(actual, expected, tolerance = 5) {
  assert(
    actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance),
    `${actual} != ${expected}`,
  );
}
async function upload(page, design, resources) {
  await page.evaluate(
    async ({ design, resources }) => {
      window.scene = design;
      const map = new Map(
        resources.map(([id, resource]) => [
          id,
          { ...resource, bytes: new Uint8Array(resource.bytes) },
        ]),
      );
      await window.renderer.setScene(design, { resources: map });
      window.renderer.render({ pan: { x: 0, y: 0 }, zoom: 1 });
    },
    { design, resources },
  );
}

test("CanvasKit GPU display list preserves clipping, opacity, rotation, gradient, shadow, text and missing images", async () => {
  const design = fixture();
  const bytes = await readFile(resolve(root, "apps/design-studio/app/fonts/Roboto-Variable.ttf"));
  const resource = {
    mimeType: "font/ttf",
    bytes: [...bytes],
    descriptor: { id: "roboto", kind: "font", family: "Roboto", weight: 700, style: "normal" },
  };
  const original = JSON.stringify(design);
  await harness(async (page) => {
    await upload(page, design, [["roboto", resource]]);
    const stats = await page.evaluate(() => renderer.stats());
    assert.equal(stats.backend, "WebGL2");
    assert.equal(stats.missingImages, 2);
    assert.equal(stats.nativeTextNodes, 1);
    assert.equal(stats.rasterTextNodes, 1);
    assert.equal(stats.textLines, 3);
    assert.equal(stats.nativeMissingGlyphs, 0);
    assert.equal(stats.unrenderedTextLines, 0);
    assert.equal(stats.unsupportedCount, 1);
    assert.equal(stats.unsupported[0].code, "native-font-unavailable");
    const png = PNG.sync.read(await page.locator("canvas").screenshot());
    near(pixel(png, 50, 50), [255, 191, 191]);
    near(pixel(png, 90, 50), [255, 255, 255]);
    near(pixel(png, 180, 50), [0, 0, 255]);
    near(pixel(png, 145, 25), [255, 255, 255]);
    near(pixel(png, 80, 160), [129, 129, 129]);
    near(pixel(png, 320, 40), [255, 240, 243]);
    near(pixel(png, 320, 110), [255, 240, 243]);
    assert(pixel(png, 245, 185)[0] < 240, "blurred shadow must be rendered");
    for (const [x0, y0, x1, y1] of [
      [20, 205, 55, 235],
      [20, 236, 55, 268],
      [170, 220, 240, 250],
    ]) {
      let dark = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) if (pixel(png, x, y)[0] < 100) dark++;
      assert(dark > 20, `text line must have visible glyphs at ${x0},${y0}`);
    }
    await page.evaluate(() => renderer.render({ pan: { x: 20, y: 0 }, zoom: 1 }));
    const moved = PNG.sync.read(await page.locator("canvas").screenshot());
    near(pixel(moved, 70, 50), [255, 191, 191]);
    assert.equal(
      await page.evaluate(() => renderer.stats().pictureBuilds),
      1,
      "pan uses the existing SkPicture",
    );
    await page.evaluate(async () => {
      const changed = structuredClone(scene);
      changed.nodes.find((n) => n.id === "rotate").fill = "#00ff00";
      await renderer.setScene(changed);
      renderer.render({ pan: { x: 0, y: 0 }, zoom: 1 });
    });
    const edited = PNG.sync.read(await page.locator("canvas").screenshot());
    near(pixel(edited, 180, 50), [0, 255, 0]);
    assert.equal(
      await page.evaluate(() => renderer.stats().pictureBuilds),
      2,
      "a real edit rebuilds the display list",
    );
    assert.equal(
      await page.evaluate(() => JSON.stringify(scene)),
      original,
      "rendering must not mutate the document",
    );
    assert.equal(
      await page.evaluate(() => {
        try {
          renderer.resize(10000, 10000, 2);
          return false;
        } catch {
          return true;
        }
      }),
      true,
    );
    await page.evaluate(() => {
      renderer.dispose();
      renderer.dispose();
    });
    assert.equal(await page.evaluate(() => renderer.stats().disposed), true);
    assert.equal(
      await page.evaluate(() => {
        try {
          renderer.render();
          return false;
        } catch {
          return true;
        }
      }),
      true,
    );
  });
});

test("native text gradients retain world coordinates at a nonzero centered text position", async () => {
  const design = fixture();
  design.nodes = [
    node("gradient-text", "text", 100, 100, 240, 70, {
      text: "MMMMM",
      fontFamily: "Roboto",
      fontRef: "roboto",
      fontSize: 40,
      fontWeight: 700,
      lineHeight: 1.2,
      textAlign: "center",
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
            { position: 0, color: "#0000ff", opacity: 1 },
            { position: 1, color: "#ff0000", opacity: 1 },
          ],
        },
      ],
    }),
  ];
  const bytes = await readFile(resolve(root, "apps/design-studio/app/fonts/Roboto-Variable.ttf"));
  await harness(async (page) => {
    await upload(page, design, [
      ["roboto", { bytes: [...bytes], descriptor: design.resources[0] }],
    ]);
    assert.equal(await page.evaluate(() => renderer.stats().nativeTextNodes), 1);
    const png = PNG.sync.read(await page.locator("canvas").screenshot());
    let blue = 0,
      red = 0;
    for (let y = 100; y < 165; y++)
      for (let x = 100; x < 340; x++) {
        const [r, g, b] = pixel(png, x, y);
        if (x < 200 && b > r + 50 && g < 150) blue++;
        if (x > 245 && r > b + 50 && g < 150) red++;
      }
    assert(
      blue > 20 && red > 20,
      `Gradient text lost its coordinates: ${blue} blue / ${red} red pixels`,
    );
    await page.evaluate(() => renderer.dispose());
  });
});

test(
  "optional real portable design retains every input node and font glyph",
  { skip: !process.env.CANVASKIT_PORTABLE_FIXTURE },
  async (t) => {
    const raw = JSON.parse(await readFile(process.env.CANVASKIT_PORTABLE_FIXTURE, "utf8"));
    const design = normalizeDesignDocument(raw.document);
    const descriptors = new Map(design.resources.map((r) => [r.id, r]));
    const resources = raw.resources.map((r) => [
      r.id,
      {
        mimeType: descriptors.get(r.id).mime,
        descriptor: descriptors.get(r.id),
        bytes: [...Buffer.from(r.base64, "base64")],
      },
    ]);
    await harness(async (page) => {
      await upload(page, design, resources);
      const stats = await page.evaluate(() => renderer.stats());
      assert.equal(stats.inputNodes, design.nodes.length);
      assert.equal(stats.drawnNodes, stats.visibleNodes);
      assert.equal(
        stats.loadedFontResources,
        design.resources.filter((r) => r.kind === "font").length,
      );
      assert.equal(stats.unrenderedTextLines, 0);
      assert(stats.nativeTextNodes > 0);
      assert(stats.gradientPaints > 0);
      assert(stats.shadowNodes > 0);
      assert(
        stats.unsupported.every((item) =>
          ["native-font-unavailable", "native-missing-glyph"].includes(item.code),
        ),
      );
      assert(
        stats.unsupported.every(
          (item) =>
            !design.nodes.find((n) => n.id === item.nodeId)?.fontFamily?.includes("Awesome"),
        ),
        "Font Awesome icons must be native glyphs, never a generic fallback",
      );
      for (let i = 0; i < 4; i++)
        await page.evaluate(
          (i) => renderer.render({ pan: { x: -i * 20, y: -i * 50 }, zoom: 0.15 + i * 0.05 }),
          i,
        );
      assert.equal(await page.evaluate(() => renderer.stats().pictureBuilds), 1);
      const counts = Object.fromEntries(
        [...new Set(stats.unsupported.map((item) => item.code))].map((code) => [
          code,
          stats.unsupported.filter((item) => item.code === code).length,
        ]),
      );
      t.diagnostic(JSON.stringify({ ...stats, unsupported: counts }));
      if (process.env.CANVASKIT_SCREENSHOT_OUTPUT) {
        const output = resolve(process.env.CANVASKIT_SCREENSHOT_OUTPUT);
        if (!output.startsWith(`${resolve(root, "artifacts")}${sep}`))
          throw new Error("QA screenshot output must remain below ignored artifacts/");
        await page.evaluate(() => {
          renderer.resize(1060, 1430, 1);
          renderer.render({ pan: { x: 10, y: 10 }, zoom: 0.12 });
        });
        await mkdir(dirname(output), { recursive: true });
        await writeFile(output, await page.locator("canvas").screenshot());
      }
      await page.evaluate(() => renderer.dispose());
    });
  },
);

test("cross-page instances detach source ancestors and preserve nested rotated clip/opacity like SVG", async () => {
  const design = normalizeDesignDocument({
    format: "codeshell.design",
    version: 3,
    name: "Instance",
    canvas: { width: 400, height: 300, background: "#ffffff" },
    tokens: { colors: [] },
    resources: [],
    activePageId: "page-1",
    pages: [
      {
        id: "page-1",
        name: "Main",
        children: [
          node("active-parent", "frame", 70, 50, 250, 200, {
            rotation: -10,
            clipContent: true,
            fill: "transparent",
            opacity: 0.7,
            children: [
              node("instance", "instance", 100, 100, 200, 100, {
                fill: "transparent",
                componentId: "component",
                rotation: 20,
                opacity: 0.6,
              }),
            ],
          }),
        ],
      },
      {
        id: "page-2",
        name: "Library",
        children: [
          node("source-parent", "frame", 0, 0, 300, 300, {
            rotation: 60,
            visible: false,
            opacity: 0.1,
            clipContent: true,
            children: [
              node("component", "component", 60, 60, 100, 50, {
                fill: "#0000ff",
                rotation: 15,
                opacity: 0.5,
                clipContent: true,
                children: [
                  node("component-child", "rectangle", 20, 20, 160, 100, {
                    fill: "#ff0000",
                    opacity: 0.8,
                    rotation: 7,
                  }),
                ],
              }),
            ],
          }),
        ],
      },
    ],
  });
  await harness(async (page) => {
    await upload(page, design, []);
    const stats = await page.evaluate(() => renderer.stats());
    assert.equal(stats.instanceNodes, 1);
    assert.equal(stats.unsupportedCount, 0);
    const actual = PNG.sync.read(await page.locator("canvas").screenshot());
    await page.evaluate(async (svg) => {
      const image = new Image();
      image.id = "reference";
      image.width = 400;
      image.height = 300;
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      document.body.append(image);
      await image.decode();
    }, exportDesignSvg(design));
    const expected = PNG.sync.read(await page.locator("#reference").screenshot());
    let difference = 0,
      painted = 0;
    for (let i = 0; i < actual.data.length; i += 4) {
      for (let c = 0; c < 3; c++) difference += Math.abs(actual.data[i + c] - expected.data[i + c]);
      if (actual.data[i] < 240 || actual.data[i + 1] < 240 || actual.data[i + 2] < 240) painted++;
    }
    assert(painted > 1000, "the hidden source page must still materialize its visible instance");
    assert(
      difference / (400 * 300 * 3) < 0.8,
      `CanvasKit/SVG rotation+clip+opacity pixel mean error ${difference / (400 * 300 * 3)}`,
    );
    await page.evaluate(() => renderer.dispose());
  });
});
