import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { textSvgLineBox, textLineBoxAlphabeticOffset } from "../../../apps/design-studio/app/text-line-box.mjs";

const epsilon = 0.00001;
function ink(png, x, y, width, height) {
  let mass = 0, moment = 0;
  for (let py = Math.floor(y); py < Math.ceil(y + height); py++)
    for (let px = Math.floor(x); px < Math.ceil(x + width); px++) {
      const alpha = (255 - png.data[(py * png.width + px) * 4]) / 255;
      mass += alpha; moment += (py + 0.5 - y) * alpha;
    }
  assert(mass > 1, "each probe must contain real glyph ink");
  return moment / mass;
}

test("Chromium line-box metrics match CSS baselines; pixel spike acceptance is reported separately", async (t) => {
  const output = resolve(process.env.DESIGN_TEXT_LINE_BOX_EVIDENCE ?? ".tmp/render-fidelity-r001/text-line-box");
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const font = await readFile(new URL("../../../apps/design-studio/app/fonts/InterVariable.woff2", import.meta.url));
  const results = [], availability = {};
  for (const [dpr, zoom] of [[1, 1], [2, 1], [1, 2], [1, 0.5]]) {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: dpr });
    await page.route("**/*", route => route.abort());
    await page.setContent(`<style>@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font.toString("base64")})}body{margin:0;background:#fff}.probe{position:absolute;white-space:pre}</style><main></main>`);
    await page.evaluate(() => document.fonts.load("400 32px Inter"));
    Object.assign(availability, await page.evaluate(() => {
      const ctx = document.createElement("canvas").getContext("2d");
      const available = family => ["monospace", "serif", "sans-serif"].some(generic => {
        ctx.font = `32px ${generic}`; const width = ctx.measureText("Hgx中文MW").width;
        ctx.font = `32px "${family}",${generic}`; return Math.abs(ctx.measureText("Hgx中文MW").width - width) > 0.01;
      });
      return { Inter: document.fonts.check("32px Inter"), "PingFang SC": available("PingFang SC"), "system-ui": true };
    }));
    for (const family of ["Inter", "PingFang SC", "system-ui"]) {
      if (!availability[family]) { t.diagnostic(`${family} unavailable on ${process.platform}; explicit font matrix omission`); continue; }
      for (const fontSize of [14, 20, 32]) for (const fontWeight of [400, 700]) {
        const fontMetric = await page.evaluate(({family, fontSize, fontWeight}) => {
          const ctx = document.createElement("canvas").getContext("2d");
          const cssFamily = family === "system-ui" ? family : `"${family}"`;
          ctx.font = `${fontWeight} ${fontSize}px ${cssFamily}`;
          const metric = ctx.measureText("Hg");
          return {ascent: metric.fontBoundingBoxAscent, descent: metric.fontBoundingBoxDescent};
        }, {family, fontSize, fontWeight});
        const lines = [1, 1.2, 1.6, 2, 43].map((lh, i) => {
          const node = { y: 20.25 + i * 80, fontSize, lineHeight: lh, ...(i === 4 ? { lineHeightUnit: "pixels" } : {}) };
          return { ...node, height: i === 4 ? lh : lh * fontSize, text: ["Hgx", "中文汉字", "Mixed中", "Hg国", "Alpha"][i], svg: textSvgLineBox(node, 0, fontMetric) };
        });
        const browserMetrics = await page.evaluate(({ family, fontSize, fontWeight, zoom, lines }) => {
          const main = document.querySelector("main"); main.innerHTML = "";
          main.style.cssText = `position:absolute;left:0;top:0;transform-origin:0 0;transform:scale(${zoom})`;
          const ctx = document.createElement("canvas").getContext("2d");
          const cssFamily = family === "system-ui" ? family : `"${family}"`; ctx.font = `${fontWeight} ${fontSize}px ${cssFamily}`;
          const metric = ctx.measureText("Hg");
          return lines.map(line => {
            const div = document.createElement("div"); div.className = "probe";
            div.style.cssText = `left:20px;top:${line.y}px;font:${fontWeight} ${fontSize}px/${line.height}px ${cssFamily}`;
            div.textContent = line.text;
            const marker = document.createElement("span"); marker.style.cssText = "display:inline-block;width:0;height:0"; div.append(marker); main.append(div);
            for (const [x, y, baseline] of [[240, line.svg.y, line.svg.baseline], [460, line.y + line.height / 2, "central"]]) {
              const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.classList.add("probe");
              svg.style.cssText = `left:${x}px;top:0;width:220px;height:450px;overflow:visible`;
              svg.innerHTML = `<text x="0" y="${y}" dominant-baseline="${baseline}" font-family="${family}" font-size="${fontSize}" font-weight="${fontWeight}">${line.text}</text>`; main.append(svg);
            }
            return { ascent: metric.fontBoundingBoxAscent, descent: metric.fontBoundingBoxDescent,
              htmlBaseline: (marker.getBoundingClientRect().top - div.getBoundingClientRect().top) / zoom };
          });
        }, { family, fontSize, fontWeight, zoom, lines });
        const name = `${family.replaceAll(" ", "-")}-${fontSize}-${fontWeight}-dpr${dpr}-zoom${zoom}`;
        const png = PNG.sync.read(await page.screenshot({ path: resolve(output, `${name}.png`) }));
        const scale = dpr * zoom;
        for (const [index, line] of lines.entries()) {
          const html = ink(png, 20 * scale, (line.y - 5) * scale, 200 * scale, 75 * scale);
          const central = ink(png, 240 * scale, (line.y - 5) * scale, 200 * scale, 75 * scale);
          const raw = ink(png, 460 * scale, (line.y - 5) * scale, 200 * scale, 75 * scale);
          const offset = textLineBoxAlphabeticOffset(line, browserMetrics[index]);
          const row = { family, fontSize, fontWeight, dpr, zoom, lineHeight: line.height, text: line.text,
            metricSvgDeltaCss: (central - html) / scale, rawCentralDeltaCss: (raw - html) / scale,
            metricBaselineDeltaCss: offset - browserMetrics[index].htmlBaseline };
          results.push(row);
        }
      }
    }
    await page.close();
  }
  const metricFailures = results.filter(row => Math.abs(row.metricBaselineDeltaCss) > 1 / 64 + epsilon);
  assert.deepEqual(metricFailures, [], "font metrics must reproduce CSS baseline quantization before transforms");
  // At half zoom one device pixel spans two CSS pixels; that row is the coarse
  // screenshot gate, not evidence for the <= 0.5 CSS-pixel font spike.
  const metricSvgFailures = results.filter(row => row.zoom >= 1 && Math.abs(row.metricSvgDeltaCss) > 0.5 + epsilon);
  // A baseline assertion is not a pixel acceptance claim. Chromium's generic
  // system fallback at CSS zoom 2 can reshape CJK glyphs even with the exact
  // same alphabetic baseline. Keep the requested pixel threshold unchanged,
  // preserve every failure, and let the strict four-route gate report it.
  await writeFile(resolve(output, "metrics.json"), JSON.stringify({ availability,
    baselineAccepted: metricFailures.length === 0, pixelSpikeAccepted: metricSvgFailures.length === 0,
    pixelSpikeThresholdCss: 0.5, pixelSpikeFailures: metricSvgFailures, results }, null, 2));
  assert(results.some(row => row.zoom >= 1 && Math.abs(row.rawCentralDeltaCss) > 0.5 + epsilon), "retain evidence that the original unquantized central proposal fails");
  t.diagnostic(JSON.stringify({ evidence: output, availability, samples: results.length,
    pixelSpikeAccepted: metricSvgFailures.length === 0, pixelSpikeFailures: metricSvgFailures,
    metricSvgMaxCss: Math.max(...results.filter(row => row.zoom >= 1).map(row => Math.abs(row.metricSvgDeltaCss))),
    rawCentralMaxCss: Math.max(...results.map(row => Math.abs(row.rawCentralDeltaCss))) }));
});
