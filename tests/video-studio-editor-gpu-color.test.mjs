import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
let browser, source;

before(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { GpuColorGrader } from './apps/video-studio/src/editor/gpu-color'; import { applyColorToRgba } from './apps/video-studio/src/editor/color'; import { defaultColorAdjustment } from './apps/video-studio/src/editor/defaults'; globalThis.api = { GpuColorGrader, applyColorToRgba, defaultColorAdjustment };`,
      resolveDir: root,
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
  });
  source = bundle.outputFiles[0].text;
  browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
});
after(async () => {
  await browser?.close();
});

test("GPU preview grading matches the CPU grade within one rounding step for every adjustment kind", async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent("<body></body>");
  await page.addScriptTag({ content: source });
  const results = await page.evaluate(() => {
    const width = 96, height = 64, base = new ImageData(width, height);
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < base.data.length; i += 4) {
      base.data[i] = random() * 256;
      base.data[i + 1] = random() * 256;
      base.data[i + 2] = random() * 256;
      // Opaque, translucent and fully transparent pixels.
      base.data[i + 3] = i % 12 === 0 ? 0 : i % 8 === 0 ? 255 : 255;
    }
    const plain = api.defaultColorAdjustment(),
      cases = {
        basic: { ...plain, exposure: 0.4, brightness: -0.05, contrast: 1.2, temperature: 0.3, tint: -0.2 },
        curves: { ...plain, curves: [
          { channel: "rgb", points: [{ x: 0, y: 0.05 }, { x: 0.5, y: 0.6 }, { x: 1, y: 0.95 }] },
          { channel: "blue", points: [{ x: 0, y: 0 }, { x: 0.3, y: 0.2 }, { x: 1, y: 1 }] }] },
        saturation: { ...plain, saturation: 1.4, hue: 25, contrast: 0.9 },
        bands: { ...plain, saturation: 0.8, hsl: [
          { hue: 30, width: 60, hueShift: 15, saturation: 0.2, lightness: -0.1 },
          { hue: 220, width: 90, hueShift: -20, saturation: -0.3, lightness: 0.05 }] },
      };
    const grader = new api.GpuColorGrader(), output = {};
    for (const [name, color] of Object.entries(cases)) {
      const cpu = new ImageData(new Uint8ClampedArray(base.data), width, height);
      api.applyColorToRgba(cpu.data, color);
      const canvas = new OffscreenCanvas(width, height), context = canvas.getContext("2d");
      context.putImageData(base, 0, 0);
      const graded = grader.grade(context, color),
        gpu = context.getImageData(0, 0, width, height).data;
      let difference = 0, alpha = 0;
      for (let i = 0; i < gpu.length; i += 4) {
        if (cpu.data[i + 3] !== gpu[i + 3]) alpha++;
        if (cpu.data[i + 3] !== 255) continue;
        for (let channel = 0; channel < 3; channel++)
          difference = Math.max(difference, Math.abs(cpu.data[i + channel] - gpu[i + channel]));
      }
      output[name] = { graded, difference, alpha };
    }
    grader.dispose();
    return output;
  });
  for (const [name, result] of Object.entries(results)) {
    assert.equal(result.graded, true, `${name}: WebGL2 grading ran`);
    assert.equal(result.alpha, 0, `${name}: alpha is unchanged`);
    assert(result.difference <= 2, `${name}: max channel difference ${result.difference}`);
  }
});
