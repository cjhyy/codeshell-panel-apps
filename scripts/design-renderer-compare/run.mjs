import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve, sep, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const i = argv.indexOf(name);
  return i < 0 ? fallback : argv[i + 1];
};
const input = option("--input"),
  output = option("--output");
if (!input || !output)
  throw Error(
    "Usage: node scripts/design-renderer-compare/run.mjs --input /absolute/portable.json --output /new/output [--engines svg,grida,canvaskit] [--frames 180] [--repeats 3]",
  );
const frames = Number(option("--frames", "180")),
  repeats = Number(option("--repeats", "3"));
assert(Number.isInteger(frames) && frames >= 30 && frames <= 1200);
assert(Number.isInteger(repeats) && repeats >= 1 && repeats <= 10);
const engines = option("--engines", "svg,grida,canvaskit").split(",");
assert(engines.every((e) => ["svg", "grida", "canvaskit"].includes(e)));
const outputRoot = resolve(output);
await mkdir(outputRoot, { recursive: false });
const source = await readFile(resolve(input));
const inputSha256 = createHash("sha256").update(source).digest("hex");
const backup = JSON.parse(source);
assert.equal(backup.format, "codeshell.design.portable-backup");
const fixture = JSON.stringify({ document: backup.document, resources: backup.resources });
const vendor = resolve(option("--vendor", join(root, "artifacts/design-renderer-compare/vendor")));
const mime = {
  ".html": "text/html",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".png": "image/png",
};
const csp =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; object-src 'none'";
const report = {
  inputSha256,
  sourceName: backup.source?.path ?? null,
  viewport: { width: 1280, height: 900, dpr: 2 },
  frames,
  repeats,
  methodology:
    "Same saved design and bytes; warmed GPU renderers; sequential runs in a private Chromium profile with exact-origin intercepted local files. rAF intervals include browser scheduling/compositor effects; renderSubmit measures synchronous engine submission, not GPU completion or display photon latency. No writes to the source design.",
  results: [],
  errors: [],
};
const browser = await chromium.launch({
  args: process.platform === "darwin" ? ["--use-angle=metal"] : [],
});
function assertPainted(bytes, label) {
  const png = PNG.sync.read(bytes);
  const colors = new Set();
  let changed = 0;
  const background = [...png.data.subarray(0, 3)];
  for (let offset = 0; offset < png.data.length; offset += 16) {
    const [r, g, b] = png.data.subarray(offset, offset + 3);
    colors.add((r << 16) | (g << 8) | b);
    if (
      Math.max(
        Math.abs(r - background[0]),
        Math.abs(g - background[1]),
        Math.abs(b - background[2]),
      ) > 12
    )
      changed++;
  }
  assert(
    colors.size >= 32 && changed / ((png.width * png.height) / 4) > 0.01,
    `${label}: blank or incomplete rendered frame; timings are invalid`,
  );
  return {
    sampledColors: colors.size,
    nonBackgroundFraction: changed / ((png.width * png.height) / 4),
  };
}
report.chromiumVersion = browser.version();
try {
  const context = await browser.newContext({ viewport: report.viewport, deviceScaleFactor: 2 });
  await context.route("**/*", async (route) => {
    try {
      const url = new URL(route.request().url());
      if (url.origin !== "https://renderer.test") return route.abort();
      if (url.pathname === "/fixture.json")
        return route.fulfill({ body: fixture, contentType: "application/json" });
      let target, base;
      if (url.pathname.startsWith("/vendor/")) {
        base = vendor;
        target = resolve(base, url.pathname.slice(8));
      } else if (url.pathname.startsWith("/fonts/")) {
        base = join(root, "apps/design-studio/app/fonts");
        target = resolve(base, url.pathname.slice(7));
      } else if (
        url.pathname.startsWith("/scripts/design-renderer-compare/") ||
        url.pathname.startsWith("/apps/design-studio/app/")
      ) {
        base = root;
        target = resolve(base, "." + url.pathname);
      } else return route.abort();
      const actual = await realpath(target);
      if (!actual.startsWith((await realpath(base)) + sep)) return route.abort();
      if (!mime[extname(actual)]) return route.abort();
      const headers = {
        "Content-Security-Policy": csp,
        "X-Content-Type-Options": "nosniff",
        "Access-Control-Allow-Origin": "*",
      };
      return route.fulfill({
        body: await readFile(actual),
        contentType: mime[extname(actual)],
        headers,
      });
    } catch (error) {
      return route.fulfill({ status: 404, body: "Missing local fixture asset" });
    }
  });
  for (let repeat = 0; repeat < repeats; repeat++)
    for (const engine of repeat % 2 ? [...engines].reverse() : engines) {
      const page = await context.newPage();
      const errors = [],
        consoleErrors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text());
      });
      try {
        await page.goto(
          `https://renderer.test/scripts/design-renderer-compare/benchmark.html?engine=${engine}`,
        );
        await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
        const status = await page.evaluate(() => window.comparison.status());
        const driver = await page.evaluate(() => {
          const canvas = document.createElement("canvas"),
            gl = canvas.getContext("webgl2");
          if (!gl) return { webgl2: false };
          const e = gl.getExtension("WEBGL_debug_renderer_info");
          const r = {
            webgl2: true,
            vendor: e ? gl.getParameter(e.UNMASKED_VENDOR_WEBGL) : null,
            renderer: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
          };
          gl.getExtension("WEBGL_lose_context")?.loseContext();
          return r;
        });
        const scenarios = [
          { name: "overview-pan", kind: "pan", zoom: 0.07, focus: { x: 4280, y: 5600 } },
          { name: "detail-pan", kind: "pan", zoom: 0.8, focus: { x: 3000, y: 1000 } },
          { name: "detail-zoom", kind: "zoom", zoom: 0.8, focus: { x: 3000, y: 1000 } },
        ];
        for (const scenario of scenarios) {
          const result = await page.evaluate(async (s) => window.comparison.run(s), {
            ...scenario,
            frames,
          });
          await writeFile(
            join(outputRoot, `${engine}-${repeat}-${scenario.name}-samples.json`),
            JSON.stringify(result, null, 2) + "\n",
            { flag: "wx" },
          );
          const { samples, ...metrics } = result;
          const pixels = await page.screenshot();
          const coverage = assertPainted(pixels, `${engine}/${scenario.name}`);
          await writeFile(join(outputRoot, `${engine}-${repeat}-${scenario.name}.png`), pixels);
          report.results.push({
            repeat,
            scenario: scenario.name,
            driver,
            status,
            coverage,
            ...metrics,
          });
          console.log(
            JSON.stringify({
              engine,
              repeat,
              scenario: scenario.name,
              p95: metrics.intervalP95,
              submitP95: metrics.renderSubmitP95,
              over25: metrics.frameIntervalsOver25,
              stats: {
                inputNodes: metrics.stats?.inputNodes,
                visibleNodes: metrics.stats?.visibleNodes,
                drawnNodes: metrics.stats?.drawnNodes,
                nativeTextNodes: metrics.stats?.nativeTextNodes,
                rasterTextNodes: metrics.stats?.rasterTextNodes,
                unsupportedCount: metrics.stats?.unsupported?.length,
              },
            }),
          );
        }
        const views = [
          { name: "overview", zoom: 0.07, focus: { x: 4280, y: 5600 } },
          { name: "dota-header", zoom: 0.8, focus: { x: 3000, y: 1000 } },
          { name: "dota-middle", zoom: 0.8, focus: { x: 3000, y: 5200 } },
          { name: "inline-text", zoom: 1, focus: { x: 4250, y: 550 } },
          { name: "ruby", zoom: 0.9, focus: { x: 1850, y: 550 } },
        ];
        if (repeat === 0)
          for (const view of views) {
            await page.evaluate(
              (v) =>
                window.comparison.setViewport({
                  pan: {
                    x: innerWidth / 2 - v.focus.x * v.zoom,
                    y: innerHeight / 2 - v.focus.y * v.zoom,
                  },
                  zoom: v.zoom,
                }),
              view,
            );
            await page.evaluate(
              () =>
                new Promise((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(resolve)),
                ),
            );
            const pixels = await page.screenshot();
            assertPainted(pixels, `${engine}/${view.name}`);
            await writeFile(join(outputRoot, `${engine}-${view.name}.png`), pixels);
          }
        report.errors.push(
          ...errors.map((message) => ({ engine, repeat, type: "pageerror", message })),
          ...consoleErrors.map((message) => ({ engine, repeat, type: "console", message })),
        );
      } catch (error) {
        report.errors.push({
          engine,
          repeat,
          type: "fatal",
          message: error.stack ?? String(error),
        });
        console.log(JSON.stringify({ engine, repeat, error: error.message }));
      } finally {
        await page.close();
      }
    }
  await context.close();
} finally {
  await browser.close();
}
assert.equal(
  createHash("sha256")
    .update(await readFile(resolve(input)))
    .digest("hex"),
  inputSha256,
  "Source design changed during comparison",
);
await writeFile(join(outputRoot, "report.json"), JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
});
console.log(
  JSON.stringify({
    output: outputRoot,
    results: report.results.length,
    errors: report.errors.length,
  }),
);
