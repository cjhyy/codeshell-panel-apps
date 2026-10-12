import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus } from "node:os";
import { build } from "esbuild";
import { chromium } from "playwright";

// Run on an idle machine: node scripts/bench-video-studio-color.mjs /tmp/color.json
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselineRef = "f72b04701349a29069439e4aa4505b39a2be9dd7";
const colorPath = "apps/video-studio/src/editor/color.ts";
const original = execFileSync("git", ["show", `${baselineRef}:${colorPath}`], { cwd: root, encoding: "utf8" });
const current = await readFile(resolve(root, colorPath), "utf8");
const sources = await Promise.all([["before", original], ["after", current]].map(async ([name, color]) => {
  const result = await build({
    stdin: { contents: `export * from './${colorPath}';
      export {FrameCompositor} from './apps/video-studio/src/editor/compositor';
      export {defaultTransform,defaultColorAdjustment} from './apps/video-studio/src/editor/defaults';`, resolveDir: root },
    bundle: true, write: false, format: "iife", globalName: name, platform: "browser", target: "chrome120",
    plugins: [{ name: "baseline-color", setup(builder) {
      builder.onLoad({ filter: /\/editor\/color\.ts$/ }, () => ({ contents: color, loader: "ts" }));
    } }],
  });
  return result.outputFiles[0].text;
}));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.text().startsWith("[color-bench]")) console.error(message.text());
  });
  for (const content of sources) await page.addScriptTag({ content });
  const result = await page.evaluate(() => {
    let randomSeed = 20261012;
    const random = () => { randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0; return randomSeed / 4294967296; };
    const neutral = () => ({ exposure: 0, brightness: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0, hue: 0, curves: [], hsl: [] });
    const curve = (channel, count = 16) => ({ channel, points: Array.from({ length: count }, (_, i) => ({ x: i / (count - 1), y: random() })) });
    const seed = (count, offset = 0) => {
      const bytes = new Uint8ClampedArray(count * 4 + offset).subarray(offset);
      for (let i = 0; i < count; i++) bytes.set([i & 255, (i * 73 + 31) & 255, (i * 151 + 79) & 255, [0, 1, 127, 255][Math.floor(i / 256) % 4]], i * 4);
      return bytes;
    };
    const cases = [neutral(), { ...neutral(), exposure: 1 }, { ...neutral(), contrast: 0 }, { ...neutral(), brightness: 1 }, { ...neutral(), brightness: -1 }];
    for (let i = 0; i < 500; i++) cases.push({ ...neutral(), exposure: random() * 20 - 10, brightness: random() * 2 - 1, contrast: random() * 4, temperature: random() * 2 - 1, tint: random() * 2 - 1,
      curves: ["rgb", "red", "green", "blue"].filter(() => random() > 0.3).map((channel) => curve(channel, [2, 3, 16, 256][i % 4])),
      ...(i % 5 === 0 ? { saturation: random() * 4, hue: random() * 720 - 360, hsl: [{ hue: random() * 360, width: random() * 359.999 + 0.001, hueShift: random() * 360 - 180, saturation: random() * 2 - 1, lightness: random() * 2 - 1 }] } : {}) });
    let pixelsChecked = 0;
    for (const [index, color] of cases.entries()) for (const count of [1, 257, 1023, 1024, 4096]) {
      const input = seed(count, index % 4), expected = input.slice(), actual = input.slice();
      before.applyColorToRgba(expected, color); after.applyColorToRgba(actual, color);
      for (let i = 0; i < expected.length; i++) if (actual[i] !== expected[i])
        throw new Error(`byte mismatch preset=${index} pixels=${count} byte=${i} before=${expected[i]} after=${actual[i]}`);
      pixelsChecked += count;
    }
    const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const measurePair = (old, next, samples = 11) => {
      for (let i = 0; i < 3; i++) { old(); next(); }
      const beforeMs = [], afterMs = [];
      for (let i = 0; i < samples; i++) {
        if (i % 2) { afterMs.push(next()); beforeMs.push(old()); }
        else { beforeMs.push(old()); afterMs.push(next()); }
      }
      return { samples, warmups: 3, beforeMedianMs: median(beforeMs), afterMedianMs: median(afterMs), beforeSamplesMs: beforeMs, afterSamplesMs: afterMs };
    };
    const presets = [
      ["basic", { ...neutral(), exposure: 0.35, brightness: -0.08, contrast: 1.2, temperature: 0.15, tint: -0.1 }],
      ["curves", { ...neutral(), exposure: 0.2, contrast: 1.1, curves: ["rgb", "red", "green", "blue"].map((channel) => curve(channel, 16)) }],
      ["saturation-control", { ...neutral(), exposure: 0.2, saturation: 0.7, contrast: 1.1 }],
    ];
    // Append after the original presets: their random curve inputs, order and 11 samples stay fixed.
    presets.push(
      ["hsl-6-bands", { ...neutral(), hsl: Array.from({ length: 6 }, (_, i) => ({
        hue: i * 60, width: 90, hueShift: 10, saturation: 0.12, lightness: -0.06,
      })) }, 5],
      ["hsl-24-bands-curves", { ...neutral(), exposure: 0.3, saturation: 1.2, hue: 15,
        curves: ["rgb", "red", "green", "blue"].map((channel) => curve(channel, 16)),
        hsl: Array.from({ length: 24 }, (_, i) => ({
          hue: i * 15, width: 45, hueShift: 10, saturation: 0.05, lightness: -0.02,
        })),
      }, 5],
    );
    const pixelTimings = [], compositorTimings = [];
    const source = document.createElement("canvas"); source.width = 1920; source.height = 1080;
    const context = source.getContext("2d"), gradient = context.createLinearGradient(0, 0, 1920, 1080);
    gradient.addColorStop(0, "#d46a34"); gradient.addColorStop(0.5, "#4b9b79"); gradient.addColorStop(1, "#326cc8");
    context.fillStyle = gradient; context.fillRect(0, 0, source.width, source.height);
    for (const [name, color, samples = 11] of presets) for (const [width, height] of [[1920, 1080], [3840, 2160]]) {
      if (name === "hsl-24-bands-curves" && width === 3840) continue;
      console.info(`[color-bench] ${name} ${width}x${height}: raw pixels, ${samples} paired samples`);
      const input = seed(width * height); for (let i = 3; i < input.length; i += 4) input[i] = 255;
      const pixelCall = (fn) => { const pixels = input.slice(), start = performance.now(); fn(pixels, color); return performance.now() - start; };
      pixelTimings.push({ name, width, height, ...measurePair(() => pixelCall(before.applyColorToRgba), () => pixelCall(after.applyColorToRgba), samples) });
      if (samples === 5) {
        const expected = input.slice(), actual = input.slice();
        before.applyColorToRgba(expected, color); after.applyColorToRgba(actual, color);
        if (actual.some((value, i) => value !== expected[i])) throw new Error(`HSL pixel byte mismatch ${name} ${width}x${height}`);
      }
      for (const quality of [1, 0.5, 0.25]) {
        console.info(`[color-bench] ${name} ${width}x${height}: compositor quality ${quality}, ${samples} paired samples`);
        const frame = { sequenceId: "main", time: 0, width, height, background: "#101719", audio: [], layers: [{
          kind: "media", instanceId: "picture", sequenceId: "main", clipId: "picture", trackId: "video", localTime: 0,
          assetId: "source", assetKind: "video", sourceTime: 0, naturalWidth: 1920, naturalHeight: 1080,
          blendMode: "normal", transform: before.defaultTransform(), color,
        }] };
        const media = new Map([["picture", source]]), old = new before.FrameCompositor(), next = new after.FrameCompositor(),
          oldCanvas = document.createElement("canvas"), nextCanvas = document.createElement("canvas");
        const draw = (compositor, canvas) => {
          const start = performance.now(); compositor.draw(canvas, frame, media, quality);
          return performance.now() - start;
        };
        compositorTimings.push({ name, width, height, quality, ...measurePair(() => draw(old, oldCanvas), () => draw(next, nextCanvas), samples) });
        const a = oldCanvas.getContext("2d").getImageData(0, 0, oldCanvas.width, oldCanvas.height).data,
          b = nextCanvas.getContext("2d").getImageData(0, 0, nextCanvas.width, nextCanvas.height).data;
        if (a.length !== b.length || a.some((value, i) => value !== b[i])) throw new Error(`compositor byte mismatch ${name} ${width}x${height} ${quality}`);
        old.dispose(); next.dispose(); oldCanvas.width = oldCanvas.height = nextCanvas.width = nextCanvas.height = 1;
      }
    }
    return { presetsCompared: cases.length, pixelsChecked, byteEquivalent: true, pixelTimings, compositorTimings };
  });
  const report = { measuredAt: new Date().toISOString(), baselineRef, candidateColorBlob: execFileSync("git", ["hash-object", colorPath], { cwd: root, encoding: "utf8" }).trim(),
    benchmarkScriptBlob: execFileSync("git", ["hash-object", fileURLToPath(import.meta.url)], { cwd: root, encoding: "utf8" }).trim(),
    randomSeed: 20261012,
    browser: browser.version(), system: { platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model },
    method: "Headless Chromium, paired alternating order, 3 warmups. The original basic/curves/saturation-control presets retain their inputs, order and 11 samples; appended legal 6-band HSL and 24-band HSL with curves use 5 samples. Both resolutions and all qualities run for 6 bands; 24 bands with curves are limited to 1080p to bound cost. Pixel buffer copies are outside timers. Compositor draws include synchronous grading/readback but exclude asset decoding, audio, UI and proxy preparation. Full final composite pixels are compared after each case; appended HSL raw pixels are also compared. Other CPU-heavy tests must be idle.", ...result };
  if (process.argv[2]) await writeFile(resolve(process.argv[2]), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, pixelTimings: result.pixelTimings.map(({ beforeSamplesMs, afterSamplesMs, ...row }) => row), compositorTimings: result.compositorTimings.map(({ beforeSamplesMs, afterSamplesMs, ...row }) => row) }, null, 2));
} finally { await browser.close(); }
