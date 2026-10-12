import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const baseline = process.argv[2] ?? "fa6323a3083281b0da549c6d87a8441a906d3d7f";
const output = process.argv[3] ?? "/tmp/video-studio-evaluator-index-benchmark.json";
const source = execFileSync("git", ["show", `${baseline}:apps/video-studio/src/editor/evaluate.ts`], { cwd: root, encoding: "utf8" });
const entry = "export {prepareEvaluator,prepareTimelineSnapshot} from './apps/video-studio/src/editor/evaluate'; export * from './apps/video-studio/src/editor/defaults'; export {drawEvaluatedFrame} from './apps/video-studio/src/editor/compositor';";
const baselineBundle = await build({
  stdin: { contents: entry, resolveDir: root }, bundle: true, write: false,
  platform: "browser", format: "iife", globalName: "before",
  plugins: [{ name: "baseline-evaluator", setup(builder) {
    builder.onLoad({ filter: /\/editor\/evaluate\.ts$/ }, args => ({ contents: source, loader: "ts", resolveDir: fileURLToPath(new URL("../apps/video-studio/src/editor/", import.meta.url)) }));
  } }],
});
const candidateBundle = await build({ stdin: { contents: entry, resolveDir: root }, bundle: true, write: false, platform: "browser", format: "iife", globalName: "after" });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: baselineBundle.outputFiles[0].text });
  await page.addScriptTag({ content: candidateBundle.outputFiles[0].text });
  const results = await page.evaluate(() => {
    const median = samples => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
    const visual = () => ({ transform: before.defaultTransform(), color: before.defaultColorAdjustment(), blendMode: "normal" });
    const duration = 16000, overlap = 2000;
    function fixture(trackCount, joined, nested) {
      const main = { id: "main", name: "Main", width: 64, height: 36, frameRate: { numerator: 30000, denominator: 1001 }, background: "#123456", timelineMode: "free", tracks: Array.from({ length: trackCount }, (_, i) => before.createTrack(`track-${i}`, "video")), clips: [], transitions: [], markers: [] };
      for (let i = 0; i < 2000; i++) main.clips.push({ id: `clip-${i}`, label: `Clip ${i}`, kind: "media", trackId: `track-${Math.floor(i / 2) % trackCount}`, start: i * duration - (joined && i % 2 ? overlap : 0), duration, assetId: i % 2 ? "blue" : "red", timeMap: { points: [{ time: 0, source: 0 }, { time: duration, source: duration }] }, audio: before.defaultAudioMix(), ...visual() });
      const kinds = ["dissolve", "fade-black", "wipe-left", "wipe-right", "push-left", "push-right"];
      if (joined) for (let i = 0; i < 1000; i++) main.transitions.push({ id: `join-${i}`, fromClipId: `clip-${i * 2}`, toClipId: `clip-${i * 2 + 1}`, start: main.clips[i * 2 + 1].start, duration: overlap, kind: kinds[i % kinds.length] });
      const sequences = [main];
      if (nested) {
        main.id = "child";
        const nestedDuration = Math.max(...main.clips.map(clip => clip.start + clip.duration));
        sequences.unshift({ ...main, id: "main", tracks: [before.createTrack("parent", "video")], transitions: [], clips: [{ id: "nested", label: "Nested", kind: "sequence", trackId: "parent", start: 0, duration: nestedDuration, sequenceId: "child", timeMap: { points: [{ time: 0, source: 0 }, { time: nestedDuration, source: nestedDuration }] }, audio: before.defaultAudioMix(), ...visual() }] });
      }
      return { schemaVersion: 2, timebase: 240000, id: "index-bench", name: "Index bench", revision: 0, assets: ["red", "blue"].map(id => ({ id, name: id, kind: "video", duration, width: 64, height: 36 })), sequences, activeSequenceId: "main", exportProfiles: [] };
    }
    const samples = [];
    const sourceCanvases = new Map(["red", "blue"].map(color => { const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 36; canvas.getContext("2d").fillStyle = color; canvas.getContext("2d").fillRect(0, 0, 64, 36); return [color, canvas]; }));
    for (const [trackCount, joined, nested] of [[1, true, false], [3, false, false], [3, true, false], [128, false, false], [128, true, false], [128, true, true]]) {
      const input = fixture(trackCount, joined, nested), setup = { before: [], after: [] };
      for (let i = 0; i < 7; i++) for (const [key, api] of i % 2 ? [["after", after], ["before", before]] : [["before", before], ["after", after]]) { const start = performance.now(); api.prepareEvaluator(input); setup[key].push(performance.now() - start); }
      const evaluators = { before: before.prepareEvaluator(input), after: after.prepareEvaluator(input) };
      const ticks = Array.from({ length: 512 }, (_, i) => ((i * 313) % 1900) * duration + 123);
      const boundaries = joined ? Array.from({ length: 64 }, (_, i) => [0, 1, 999, 1999, 2000].map(delta => (i * 2 + 1) * duration - overlap + delta)).flat() : [];
      let framesEqual = 0, pixelsEqual = 0;
      const canvases = [document.createElement("canvas"), document.createElement("canvas")];
      for (const tick of [...ticks, ...boundaries]) {
        const oldFrame = evaluators.before.evaluate("main", tick), newFrame = evaluators.after.evaluate("main", tick);
        if (JSON.stringify(oldFrame) !== JSON.stringify(newFrame)) throw new Error(`frame mismatch ${trackCount}/${joined}/${nested}/${tick}`);
        framesEqual++;
        if (pixelsEqual < 48 && (boundaries.includes(tick) || !joined)) {
          const media = new Map();
          const collect = layer => { if (layer.kind === "media") media.set(layer.instanceId, sourceCanvases.get(layer.assetId)); else if (layer.kind === "group") layer.layers.forEach(collect); else if (layer.kind === "transition") { if (layer.from) collect(layer.from); if (layer.to) collect(layer.to); } };
          oldFrame.layers.forEach(collect);
          before.drawEvaluatedFrame(canvases[0], oldFrame, media); after.drawEvaluatedFrame(canvases[1], newFrame, media);
          const oldPixels = canvases[0].getContext("2d").getImageData(0, 0, 64, 36).data, newPixels = canvases[1].getContext("2d").getImageData(0, 0, 64, 36).data;
          if (oldPixels.some((value, index) => value !== newPixels[index])) throw new Error(`pixel mismatch at ${tick}`);
          pixelsEqual++;
        }
      }
      for (let i = 0; i < 512; i++) { evaluators.before.evaluate("main", ticks[i]); evaluators.after.evaluate("main", ticks[i]); }
      const batches = { before: [], after: [] };
      for (let i = 0; i < 11; i++) for (const key of i % 2 ? ["after", "before"] : ["before", "after"]) { const start = performance.now(); let checksum = 0; for (const tick of ticks) { const frame = evaluators[key].evaluate("main", tick); checksum += frame.layers.length + frame.audio.length; } batches[key].push({ ms: performance.now() - start, checksum }); }
      input.sequences.at(-1).transitions.length = 0;
      const isolated = JSON.stringify(evaluators.before.evaluate("main", 14001)) === JSON.stringify(evaluators.after.evaluate("main", 14001));
      samples.push({ trackCount, joined, nested, framesEqual, pixelsEqual, inputMutationIsolated: isolated, iterations: ticks.length, setup, setupMedianMs: { before: median(setup.before), after: median(setup.after) }, batches, medianPerFrameMs: { before: median(batches.before.map(value => value.ms / ticks.length)), after: median(batches.after.map(value => value.ms / ticks.length)) } });
    }
    return { samples, userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency };
  });
  assert.ok(results.samples.every(sample => sample.framesEqual > 0 && sample.pixelsEqual === 48 && sample.inputMutationIsolated));
  results.method = { baseline, sourceBlob: execFileSync("git", ["hash-object", "apps/video-studio/src/editor/evaluate.ts"], { cwd: root, encoding: "utf8" }).trim(), scriptBlob: execFileSync("git", ["hash-object", "scripts/bench-video-studio-evaluator.mjs"], { cwd: root, encoding: "utf8" }).trim(), at: new Date().toISOString(), note: "7 alternating setup samples; 512 warm calls per implementation; 11 alternating paired batches of 512 ordinary playback ticks; exact output equality also includes transition start/middle/end and six transition kinds, plus final compositor pixels. Evaluator-only, excluding decode/audio/UI/render timing; not preview FPS." };
  await writeFile(output, `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results.samples.map(({ trackCount, joined, nested, medianPerFrameMs, setupMedianMs, framesEqual, pixelsEqual }) => ({ trackCount, joined, nested, medianPerFrameMs, setupMedianMs, framesEqual, pixelsEqual })), null, 2));
} finally {
  await browser.close();
}
