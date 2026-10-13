import { readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import {
  assertHistoricalResearchBaseline,
  historicalResearchUsage,
} from "./research/historical-video-studio.mjs";

// Historical baseline: b2ad2d20866dad9e51a88e8a279edc1cf41af001. Run with --help to restore it.
// This script rewrites only esbuild's in-memory input. Production modules remain untouched.
// Decision (Chromium, legal 5000 clips in [2000,2000,1000], 2026-10-12): do not ship either cache.
// Baseline same/cross-root medians 13.3/13.1ms; naive 0.2/13.1ms but accepts three malformed
// same-revision documents; descriptor-guarded 10.9/24.4ms, first draw 97.2 vs 57.7ms,
// and ~5.33MB extra private snapshot/key storage. Guarding preserves rejection but is a poor trade.
// Public compileAudioPlan is never changed. The naive mode deliberately demonstrates the unsafe
// identity-only cache and must not be treated as a proposed production implementation.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (process.argv.includes("--help")) {
  console.log(historicalResearchUsage("timeline-media-plan"));
  process.exit(0);
}
assertHistoricalResearchBaseline("timeline-media-plan", root);
const helpers = String.raw`
import { validateEditorDocument as prototypeValidate } from "./validation";
const prototypeMetrics = () => ((globalThis as any).__mediaPlanMetrics ??= { compileCalls: 0, compileMs: 0, hits: 0, misses: 0, guardCalls: 0, guardMs: 0, prepareMs: 0 });
function prototypeCompile(...args: Parameters<typeof originalCompileAudioPlan>) {
  const metrics = prototypeMetrics(), start = performance.now();
  metrics.compileCalls++;
  try { return originalCompileAudioPlan(...args); }
  finally { metrics.compileMs += performance.now() - start; }
}
function prototypeFreeze(value: any, keys: WeakMap<object, PropertyKey[]>): any {
  if (value && typeof value === "object") {
    const names = Reflect.ownKeys(value);
    keys.set(value, names);
    for (const name of names) prototypeFreeze(value[name], keys);
    Object.freeze(value);
  }
  return value;
}
// Check descriptors without invoking accessors or accepting hidden/symbol/extra properties.
// A match proves equality to a completely validated private snapshot, never a mutable tag.
function prototypeEqual(value: any, base: any, keys: WeakMap<object, PropertyKey[]>): boolean {
  if (!base || typeof base !== "object") return Object.is(value, base);
  if (!value || typeof value !== "object" || Array.isArray(value) !== Array.isArray(base)) return false;
  const array = Array.isArray(base), prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
  const names = keys.get(base)!;
  if (Reflect.ownKeys(value).length !== names.length) return false;
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !("value" in descriptor) || (!descriptor.enumerable && !(array && name === "length"))) return false;
    if (!prototypeEqual(descriptor.value, base[name], keys)) return false;
  }
  return true;
}
`;

export function mediaPlanPrototypePlugin(mode) {
  if (!["baseline", "naive", "guarded"].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
  return {
    name: "timeline-media-plan-prototype",
    setup(build) {
      build.onLoad({ filter: /[/\\]timeline-media\.ts$/ }, async ({ path }) => {
        let source = await readFile(path, "utf8");
        const replace = (before, after) => {
          if (!source.includes(before))
            throw new Error(`Prototype source anchor missing: ${before}`);
          source = source.replace(before, after);
        };
        replace(
          "import { compileAudioPlan,",
          "import { compileAudioPlan as originalCompileAudioPlan,",
        );
        replace(
          'export type { EditorWaveform } from "./waveform";',
          helpers + '\nexport type { EditorWaveform } from "./waveform";',
        );
        replace("lanes = compileAudioPlan(", "lanes = prototypeCompile(");
        if (mode !== "baseline") {
          replace(
            "  private disposed = false;",
            `
  private prototypeLastPlan?: { key: string; lanes: AudioPlanLane[] };
  private prototypeBase?: { key: string; document: EditorDocument; keys: WeakMap<object, PropertyKey[]> };
  prototypeDropPlan(): void { this.prototypeLastPlan = undefined; this.prototypeBase = undefined; }
  prototypeCacheState() { return { plan: !!this.prototypeLastPlan, base: !!this.prototypeBase }; }
  private disposed = false;`,
          );
          replace(
            "  private clearCaches(): void {",
            "  private clearCaches(): void {\n    this.prototypeDropPlan();",
          );
          if (mode === "guarded") {
            replace(
              "    document: EditorDocument,\n    sequenceId:",
              "    input: EditorDocument,\n    sequenceId:",
            );
            replace(
              "    this.cancel();\n    if (this.disposed)",
              "    let document = input;\n    this.cancel();\n    if (this.disposed)",
            );
            // Run ownership/verification after lifecycle invalidation, but before reading graph data.
            replace(
              "        const key = JSON.stringify([lifetimeKey, document.revision]);",
              `
        const key = JSON.stringify([lifetimeKey, document.revision]);
        const metrics = prototypeMetrics(), guardStart = performance.now();
        metrics.guardCalls++;
        const match = this.prototypeBase?.key === key && prototypeEqual(document, this.prototypeBase.document, this.prototypeBase.keys);
        metrics.guardMs += performance.now() - guardStart;
        if (!match) {
          const prepareStart = performance.now(), keys = new WeakMap<object, PropertyKey[]>();
          this.prototypeBase = { key, document: prototypeFreeze(prototypeValidate(document), keys), keys };
          this.prototypeLastPlan = undefined;
          metrics.prepareMs += performance.now() - prepareStart;
        }
        document = this.prototypeBase!.document;`,
            );
            // The strip geometry must use the owned snapshot, too, not the caller's object.
            replace(
              "        const sequence = document.sequences.find((item) => item.id === sequenceId);",
              "        let sequence = document.sequences.find((item) => item.id === sequenceId);",
            );
            replace(
              "        const selectedIds = new Set(requests.map((strip) => strip.clipId));",
              "        sequence = document.sequences.find((item) => item.id === sequenceId)!;\n        const selectedIds = new Set(requests.map((strip) => strip.clipId));",
            );
          }
          replace(
            "          try {\n            lanes = prototypeCompile(",
            `
          try {
            const rootIds = sequence.clips.filter((clip) => selectedIds.has(clip.id) && ["media", "sequence", "multicam"].includes(clip.kind)).map((clip) => clip.id).sort();
            const cacheKey = JSON.stringify([this.documentKey, sequenceId, rootIds]);
            if (this.prototypeLastPlan?.key === cacheKey) {
              prototypeMetrics().hits++;
              lanes = this.prototypeLastPlan.lanes;
            } else {
              prototypeMetrics().misses++;
              lanes = prototypeCompile(`,
          );
          replace(
            "            ).lanes;\n          } catch (error)",
            "            ).lanes;\n              this.prototypeLastPlan = { key: cacheKey, lanes };\n            }\n          } catch (error)",
          );
        }
        return { contents: source, loader: "ts" };
      });
    },
  };
}

const prototypeTests = String.raw`
test("prototype warm plan measurements", async (t) => {
  const result = await page.evaluate(async () => {
    const base = fixture(), template = base.sequences[0], clip = template.clips[0];
    base.id = "legal-five-thousand";
    base.sequences = [];
    for (let offset = 0; offset < 5000; offset += 2000) {
      const sequence = structuredClone(template);
      sequence.id = offset ? "inactive-" + offset : "main";
      sequence.clips = Array.from({ length: Math.min(2000, 5000 - offset) }, (_, index) => ({ ...structuredClone(clip), id: offset + index ? "clip-" + (offset + index) : "a", start: index * clip.duration }));
      base.sequences.push(sequence);
    }
    doc = base;
    media.reset();
    const collect = async (ids, options = {}) => {
      document.querySelector("#mount").replaceChildren();
      const start = performance.now();
      await draw(ids, options);
      return performance.now() - start;
    };
    globalThis.__mediaPlanMetrics = undefined;
    const firstMs = await collect(["a"]), firstMetrics = { ...__mediaPlanMetrics };
    // Warm pixel tiles for both roots before timing boundary crossings.
    await collect(["clip-1"]);
    await collect(["a"]);
    const phases = [];
    for (const kind of ["same-roots", "cross-roots"]) {
      globalThis.__mediaPlanMetrics = undefined;
      const times = [];
      for (let index = 0; index < 32; index++) {
        const ids = kind === "cross-roots" && index % 2 ? ["clip-1"] : ["a"];
        times.push(await collect(ids, index % 2 ? {} : { width: 216, start: 120000, end: 480000 }));
      }
      times.sort((a, b) => a - b);
      phases.push({ kind, medianMs: times[16], p95Ms: times[30], metrics: { ...__mediaPlanMetrics } });
    }
    return { sequenceClips: doc.sequences.map((sequence) => sequence.clips.length), firstMs, firstMetrics, phases, cache: media.prototypeCacheState?.(), stats: media.stats, errors: [...errors] };
  });
  const cdp = await page.context().newCDPSession(page);
  const heap = async () => { await cdp.send("HeapProfiler.collectGarbage"); return (await cdp.send("Runtime.getHeapUsage")).usedSize; };
  const heldHeap = await heap();
  await page.evaluate(() => media.prototypeDropPlan?.());
  const releasedPlanHeap = await heap();
  await page.evaluate(() => media.reset());
  const resetHeap = await heap();
  const resetState = await page.evaluate(() => media.prototypeCacheState?.() ?? null);
  await page.evaluate(() => media.dispose());
  const disposedHeap = await heap();
  t.diagnostic(JSON.stringify({ mode: process.env.MEDIA_PLAN_PROTOTYPE_MODE, ...result, heap: { heldHeap, releasedPlanHeap, planBytes: heldHeap - releasedPlanHeap, resetHeap, disposedHeap }, resetState }));
  assert.deepEqual(result.errors, []);
  assert.ok(result.stats.thumbnails <= 160);
  assert.equal(result.stats.waveforms, 1);
  if (process.env.MEDIA_PLAN_PROTOTYPE_MODE !== "baseline") {
    assert.equal(result.phases[0].metrics.compileCalls, 0);
    assert.equal(result.phases[0].metrics.hits, 32);
    assert.equal(result.phases[1].metrics.compileCalls, 31);
    assert.deepEqual(resetState, { plan: false, base: false });
  }
});

test("prototype mutable caller counterexamples", async (t) => {
  const results = [];
  for (const kind of ["source-bound", "missing-field", "getter"]) {
    const result = await page.evaluate(async (kind) => {
      reset();
      const inactive = structuredClone(doc.sequences[0]);
      inactive.id = "inactive";
      doc.sequences.push(inactive);
      await draw();
      let getterCalls = 0;
      const target = doc.sequences[1].clips[0];
      if (kind === "source-bound") target.timeMap.points[1].source = 480001;
      if (kind === "missing-field") delete target.trackId;
      if (kind === "getter") Object.defineProperty(target, "duration", { enumerable: true, configurable: true, get() { getterCalls++; return 480000; } });
      document.querySelector("#mount").replaceChildren();
      await draw();
      return { kind, state: document.querySelector("canvas").dataset.etMediaState, errors: [...errors], getterCalls };
    }, kind);
    results.push(result);
    assert.equal(result.getterCalls, 0, "Accessors must never execute during the reuse guard");
    assert.equal(result.state, process.env.MEDIA_PLAN_PROTOTYPE_MODE === "naive" ? "ready" : "error");
  }
  t.diagnostic(JSON.stringify({ mode: process.env.MEDIA_PLAN_PROTOTYPE_MODE, counterexamples: results }));
});

test("prototype lifecycle and lane budget counterexamples", async (t) => {
  const result = await page.evaluate(async () => {
    const nested = structuredClone(doc.sequences[0]);
    nested.id = "nested";
    nested.clips = [];
    nested.tracks = [api.createTrack("nested-audio", "audio")];
    for (let index = 0; index < 257; index++) {
      nested.clips.push({ ...structuredClone(doc.sequences[0].clips[0]), id: "sound-" + index, trackId: "nested-audio", start: index * 480000 });
    }
    doc.sequences.push(nested);
    const nestedClip = { ...structuredClone(doc.sequences[0].clips[0]), id: "nested-clip", kind: "sequence", sequenceId: "nested", start: 480000 };
    delete nestedClip.assetId;
    doc.sequences[0].clips.push(nestedClip);
    await draw();
    const visible = document.querySelector("canvas").dataset.etMediaState;
    document.querySelector("#mount").replaceChildren();
    await draw(["nested-clip"]);
    const excess = document.querySelector("canvas").dataset.etMediaState;
    doc.sequences[1].clips = [doc.sequences[1].clips[0]];
    doc.revision++;
    document.querySelector("#mount").replaceChildren();
    await draw(["nested-clip"]);
    const nextRevision = document.querySelector("canvas").dataset.etMediaState;
    mediaGeneration++;
    media.reset();
    const resetState = media.prototypeCacheState?.() ?? null;
    document.querySelector("#mount").replaceChildren();
    await draw();
    media.dispose();
    return { visible, excess, nextRevision, resetState, disposedState: media.prototypeCacheState?.() ?? null, stats: media.stats };
  });
  assert.equal(result.visible, "ready", "Offscreen nested roots do not consume the 256-lane budget");
  assert.equal(result.excess, "error");
  assert.equal(result.nextRevision, "ready");
  assert.deepEqual(result.stats, { thumbnails: 0, waveformBytes: 0, waveforms: 0 });
  if (process.env.MEDIA_PLAN_PROTOTYPE_MODE !== "baseline") {
    assert.deepEqual(result.resetState, { plan: false, base: false });
    assert.deepEqual(result.disposedState, { plan: false, base: false });
  }
  t.diagnostic(JSON.stringify({ mode: process.env.MEDIA_PLAN_PROTOTYPE_MODE, lifecycle: result }));
});
`;

async function run() {
  const original = await readFile(
    join(root, "tests/video-studio-editor-timeline-media.test.mjs"),
    "utf8",
  );
  const anchor = '    format: "iife",\n    globalName: "api",';
  if (!original.includes(anchor)) throw new Error("Browser bundle anchor changed");
  const source =
    `import {mediaPlanPrototypePlugin} from '../scripts/video-studio-timeline-media-plan-prototype.mjs';\n` +
    original.replace(
      anchor,
      "    plugins: [mediaPlanPrototypePlugin(process.env.MEDIA_PLAN_PROTOTYPE_MODE)],\n" + anchor,
    ) +
    prototypeTests;
  const file = join(root, `tests/.timeline-media-plan-prototype-${process.pid}.test.mjs`);
  await writeFile(file, source);
  try {
    for (const mode of process.argv.slice(2).length
      ? process.argv.slice(2)
      : ["baseline", "naive", "guarded"]) {
      const status = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--test", "--test-name-pattern=prototype ", file], {
          cwd: root,
          env: { ...process.env, MEDIA_PLAN_PROTOTYPE_MODE: mode },
          stdio: "inherit",
        });
        child.on("error", reject);
        child.on("exit", resolve);
      });
      if (status !== 0) throw new Error(`${mode} prototype tests failed (${status})`);
    }
  } finally {
    await rm(file, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
