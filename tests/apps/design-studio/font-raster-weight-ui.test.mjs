import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { symmetricPixelDifference, inkGeometry, geometryDifference, textGeometryFailures } from "./render-fidelity.metrics.mjs";
import { fontRasterObservation, neutralTextColorObservation, fontComparisonRasterMode, fontComparisonRasterArgs } from "./font-raster-observation.mjs";

const app = resolve("apps/design-studio/app"), origin = "https://font-raster.test";
const node = (size, weight, index) => ({ id: `inter-${size}-${weight}`, type: "text", name: "Inter weight probe",
  x: 24, y: 12 + index * 45, width: 700, height: 42, text: "Inter Hg AV 0123", fontFamily: "Inter", fontRef: "inter",
  fontSize: size, fontWeight: weight, fontStyle: "normal", lineHeight: 1.15, textAlign: "left", fill: "#000000",
  stroke: "transparent", strokeWidth: 0, opacity: 1, rotation: 0, visible: true, locked: false, cornerRadius: 0 });

test("supplied Inter plain text matches HTML across weights 400/600/700, sizes 11–32, and DPR 1/2", async t => {
  const output = resolve(process.env.DESIGN_FONT_RASTER_EVIDENCE ?? ".tmp/render-fidelity-r003/font-weight");
  await mkdir(output, { recursive: true });
  const rasterMode = fontComparisonRasterMode();
  const browser = await chromium.launch({ args: [...(process.platform === "darwin" ? ["--use-angle=metal"] : ["--enable-webgl", "--enable-unsafe-swiftshader"]),
    ...fontComparisonRasterArgs(rasterMode)] });
  t.after(() => browser.close());
  const rows = [], states = [];
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 760, height: 1010 }, deviceScaleFactor: dpr });
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><body style="margin:0;background:white"><canvas></canvas><main hidden></main></body>' });
      const path = resolve(app, "." + url.pathname);
      if (!path.startsWith(app + sep)) return route.abort();
      const source = url.pathname === "/canvas/canvaskit-text.mjs" && process.env.DESIGN_FONT_NATIVE_SOURCE ? resolve(process.env.DESIGN_FONT_NATIVE_SOURCE) : path;
      return route.fulfill({ body: await readFile(source), contentType: { ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".woff2": "font/woff2" }[extname(path)] });
    });
    const page = await context.newPage();
    await page.goto(origin);
    await page.evaluate(async dpr => {
      const { createRenderer } = await import("/canvas/canvaskit-renderer.mjs");
      window.renderer = await createRenderer({ canvas: document.querySelector("canvas"), assetsBaseUrl: "/canvas/vendor/", background: "#ffffff" });
      renderer.resize(760, 1010, dpr);
      window.bytes = new Uint8Array(await (await fetch("/fonts/InterVariable.woff2")).arrayBuffer());
      const face = new FontFace("Inter", bytes, { weight: "100 900" }); await face.load(); document.fonts.add(face);
      window.descriptor = { id: "inter", kind: "font", family: "Inter", weight: 400, style: "normal" };
      window.resources = new Map([["inter", { bytes, descriptor, mimeType: "font/woff2" }]]);
    }, dpr);
    for (const weight of [400, 600, 700]) {
      const nodes = Array.from({ length: 22 }, (_, index) => node(index + 11, weight, index));
      const state = await page.evaluate(async nodes => {
        document.querySelector("canvas").hidden = false; document.querySelector("main").hidden = true;
        await renderer.setScene({ nodes, resources: [descriptor], canvas: { width: 760, height: 1010, background: "#ffffff" } }, { resources });
        renderer.render({ zoom: 1, pan: { x: 0, y: 0 } });
        return renderer.stats();
      }, nodes);
      states.push({ dpr, weight, stats: state });
      const gpu = PNG.sync.read(await page.screenshot({ path: resolve(output, `dpr${dpr}-w${weight}-gpu.png`) }));
      await page.evaluate(async nodes => {
        const main = document.querySelector("main"); main.replaceChildren(); main.hidden = false; document.querySelector("canvas").hidden = true;
        for (const node of nodes) { const div = document.createElement("div"); div.textContent = node.text;
          div.style.cssText = `position:absolute;left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px;font:${node.fontWeight} ${node.fontSize}px/1.15 Inter;white-space:pre;color:black`; main.append(div); }
        await document.fonts.ready;
      }, nodes);
      const html = PNG.sync.read(await page.screenshot({ path: resolve(output, `dpr${dpr}-w${weight}-html.png`) }));
      states.at(-1).fonts = await fontRasterObservation(page, "main > div");
      states.at(-1).colors = { gpu: neutralTextColorObservation(gpu), html: neutralTextColorObservation(html) };
      for (const value of nodes) {
        const roi = { x: 16 * dpr, y: (value.y - 1) * dpr, width: 720 * dpr, height: 44 * dpr };
        const actual = inkGeometry(gpu, { roi }), reference = inkGeometry(html, { roi });
        const delta = geometryDifference(reference, actual), pixels = symmetricPixelDifference(html, gpu, { roi });
        rows.push({ dpr, weight, fontSize: value.fontSize, actual, reference, delta, pixels,
          geometryFailures: textGeometryFailures(delta, { scale: dpr, align: "left" }), pixelPass: pixels.mismatchRatio <= .005 && pixels.largestCluster <= 6 });
      }
    }
    await context.close();
  }
  const summary = { samples: rows.length, geometryFailures: rows.filter(row => row.geometryFailures.length).length,
    pixelFailures: rows.filter(row => !row.pixelPass).length, maxMismatchRatio: Math.max(...rows.map(row => row.pixels.mismatchRatio)),
    maxCluster: Math.max(...rows.map(row => row.pixels.largestCluster)), maxAbsCentroid: Math.max(...rows.map(row => Math.abs(row.delta.centroidY))) };
  await writeFile(resolve(output, "metrics.json"), JSON.stringify({ summary, states, rows, rasterMode,
    textRasterArgs: fontComparisonRasterArgs(rasterMode), browserDefaultLcdCertification: "not-certified" }, null, 2));
  t.diagnostic(JSON.stringify({ output, summary }));
  if (rasterMode === "grayscale") assert(states.every(row => row.colors.gpu.nonNeutralPixels === 0 && row.colors.html.nonNeutralPixels === 0),
    "the grayscale comparison contract requires observed neutral black-text coverage in both paths, not merely a browser flag");
  assert.equal(rows.length, 132);
  assert.equal(summary.geometryFailures, 0);
  assert.equal(summary.pixelFailures, 0);
  assert(states.every(row => row.stats.rasterTextNodes === 22 && row.stats.nativeTextNodes === 0), "ordinary supplied Inter uses the loaded DOM alias raster path");
  assert(states.every(row => row.stats.fontLoadRequests === 1), "all 22 sizes share one font-load request");
});
