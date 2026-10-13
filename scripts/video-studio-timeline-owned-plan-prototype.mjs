import { readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import {
  assertHistoricalResearchBaseline,
  historicalResearchUsage,
} from "./research/historical-video-studio.mjs";

// Historical baseline: b2ad2d20866dad9e51a88e8a279edc1cf41af001. Run with --help to restore it.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (process.argv.includes("--help")) {
  console.log(historicalResearchUsage("timeline-owned-plan"));
  process.exit(0);
}
assertHistoricalResearchBaseline("timeline-owned-plan", root);
const metrics = String.raw`
function prototypeMetrics() { return ((globalThis as any).__ownedPlanMetrics ??= { compileCalls: 0, compileMs: 0, hits: 0, misses: 0, prepareMs: 0 }); }
`;
const factory = String.raw`
import { compileAudioPlan as prototypeCompileAudioPlan } from "./audio-plan";
${metrics}
const prototypeSnapshots = new WeakSet<object>();
function prototypeFreeze(value: any): any {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) prototypeFreeze(child);
    Object.freeze(value);
  }
  return value;
}
export function prototypeIsTimelineSnapshot(value: any): boolean { return !!value && prototypeSnapshots.has(value); }
function prototypeCapability(initial: any): any {
  let state = initial;
  initial = undefined;
  const documentId = state.document.id, revision = state.document.revision, generation = state.generation, listeners = new Set<() => void>();
  function active() { if (!state) throw new Error("时间线快照已释放"); return state; }
  const cap = Object.freeze({
    documentId, revision, generation,
    onDispose(listener: () => void) {
      if (typeof listener !== "function") throw new Error("释放回调无效");
      if (!state) { listener(); return () => {}; }
      listeners.add(listener); return () => listeners.delete(listener);
    },
    evaluate(sequenceId: string, time: number) { return active().evaluator.evaluate(sequenceId, time); },
    stripInfo(sequenceId: string, ids: readonly string[]) {
      const doc = active().document, sequence = doc.sequences.find((item: any) => item.id === sequenceId);
      if (!sequence) throw new Error("时间轴序列不存在");
      const selected = new Set(ids);
      return {
        id: doc.id, revision: doc.revision,
        assets: doc.assets.map((asset: any) => ({ id: asset.id, kind: asset.kind, duration: asset.duration, resourceId: asset.resourceId, fingerprint: asset.fingerprint })),
        sequences: [{ id: sequence.id, width: sequence.width, height: sequence.height,
          tracks: sequence.tracks.map((track: any) => ({ id: track.id, kind: track.kind, hidden: track.hidden })),
          clips: sequence.clips.filter((clip: any) => selected.has(clip.id)).map((clip: any) => ({ id: clip.id, kind: clip.kind, start: clip.start, duration: clip.duration, trackId: clip.trackId, assetId: clip.assetId, ...(clip.audio ? { audio: { volume: structuredClone(clip.audio.volume) } } : {}) })),
        }],
      };
    },
    compileVisibleAudio(sequenceId: string, ids: readonly string[]) {
      const doc = active().document, selected = new Set(ids), start = performance.now(), counts = prototypeMetrics();
      counts.compileCalls++;
      try {
        const plan = prototypeCompileAudioPlan({ ...doc, sequences: doc.sequences.map((sequence: any) => sequence.id === sequenceId ? { ...sequence, clips: sequence.clips.filter((clip: any) => selected.has(clip.id) && ["media", "sequence", "multicam"].includes(clip.kind)), transitions: [] } : sequence) }, sequenceId, { maxLanes: 256 });
        // No plan is stored in the capability. Every caller receives independent mutable output.
        return structuredClone(plan.lanes);
      } finally { counts.compileMs += performance.now() - start; }
    },
    dispose() {
      if (!state) return; state = undefined; prototypeSnapshots.delete(cap);
      const pending = [...listeners]; listeners.clear();
      for (const listener of pending) { try { listener(); } catch {} }
    },
  });
  prototypeSnapshots.add(cap);
  return cap;
}
export function prototypePrepareTimelineSnapshot(value: unknown, identity?: { documentId: string; revision: number; generation: number }): any {
  const start = performance.now(), document = prototypeFreeze(validateEditorDocument(value));
  let generation = 0;
  if (identity) {
    const descriptors = Object.getOwnPropertyDescriptors(identity);
    if (["documentId", "revision", "generation"].some((key) => !descriptors[key] || !("value" in descriptors[key]))) throw new Error("时间线快照身份无效");
    const id = descriptors.documentId!.value, revision = descriptors.revision!.value;
    generation = descriptors.generation!.value;
    if (id !== document.id || revision !== document.revision || !Number.isSafeInteger(generation) || generation < 0) throw new Error("时间线快照身份不匹配");
  }
  const cap = prototypeCapability({ document, generation, evaluator: prototypeCreateEvaluator(document) });
  prototypeMetrics().prepareMs += performance.now() - start;
  return cap;
}
`;

export function ownedPlanPrototypePlugin() {
  return {
    name: "owned-timeline-plan-research",
    setup(build) {
      build.onLoad({ filter: /[/\\](timeline-media|evaluate)\.ts$/ }, async ({ path }) => {
        let source = await readFile(path, "utf8");
        const replace = (before, after) => {
          if (!source.includes(before)) throw new Error(`Prototype anchor missing: ${before}`);
          source = source.replace(before, after);
        };
        if (path.endsWith("evaluate.ts")) {
          replace(
            "  const document: EditorDocument = validateEditorDocument(value);",
            "  return prototypeCreateEvaluator(validateEditorDocument(value));\n}\nfunction prototypeCreateEvaluator(document: EditorDocument): PreparedEvaluator {",
          );
          source += factory;
        } else {
          replace(
            'export type { EditorWaveform } from "./waveform";',
            `import { prototypeIsTimelineSnapshot } from "./evaluate";\n${metrics}\nexport type { EditorWaveform } from "./waveform";`,
          );
          replace(
            "  private disposed = false;",
            `
  private prototypeCap?: any;
  private prototypeCapUnsubscribe?: () => void;
  #prototypePlan?: { key: string; lanes: AudioPlanLane[] };
  private prototypeLoader?: any;
  private prototypeEnabled = false;
  prototypeDropPlan() { this.#prototypePlan = undefined; }
  prototypeState() { return { cap: !!this.prototypeCap, plan: !!this.#prototypePlan }; }
  private prototypeReleaseCap() { const cap = this.prototypeCap, unsubscribe = this.prototypeCapUnsubscribe; this.prototypeCap = undefined; this.prototypeCapUnsubscribe = undefined; this.#prototypePlan = undefined; unsubscribe?.(); cap?.dispose(); }
  private disposed = false;`,
          );
          replace(
            "  private clearCaches(): void {",
            "  private clearCaches(): void {\n    this.prototypeDropPlan();",
          );
          replace(
            "    this.clearCaches();\n  }\n  render(",
            `    this.clearCaches();\n    this.prototypeReleaseCap();\n  }
  render(document: EditorDocument, sequenceId: string, strips: readonly TimelineMediaStrip[], identity?: SessionIdentity): Promise<void> {
    if (this.prototypeCap) this.reset();
    return this.prototypeRenderCore(document, sequenceId, strips, identity);
  }
  prototypeRenderPrepared(cap: any, sequenceId: string, strips: readonly TimelineMediaStrip[], identity?: SessionIdentity): Promise<void> {
    if (!prototypeIsTimelineSnapshot(cap)) throw new Error("时间线快照无效或已释放");
    if (identity && (identity.documentId !== cap.documentId || identity.revision !== cap.revision || identity.generation !== cap.generation)) throw new Error("时间线快照身份不匹配");
    if (this.disposed) throw new Error("时间线媒体已释放");
    if (this.prototypeCap !== cap) {
      this.reset(); this.prototypeCap = cap;
      const release = () => { if (this.prototypeCap !== cap) return; this.prototypeReleaseCap(); this.cancel(); this.clearCaches(); };
      this.prototypeCapUnsubscribe = cap.onDispose(release);
    }
    const loader = this.options.loadWaveform, enabled = !!loader && this.options.canLoadWaveform?.() !== false;
    if (loader !== this.prototypeLoader || enabled !== this.prototypeEnabled) {
      this.prototypeDropPlan();
      if (loader !== this.prototypeLoader) { this.waveforms.clear(); this.waveformBytes = 0; }
      this.prototypeLoader = loader; this.prototypeEnabled = enabled;
    }
    const document = cap.stripInfo(sequenceId, strips.slice(0, TIMELINE_MEDIA_LIMITS.strips).map((strip) => strip.clipId));
    return this.prototypeRenderCore(document, sequenceId, strips, identity, cap);
  }
  private prototypeRenderCore(`,
          );
          replace(
            "    identity?: SessionIdentity,\n  ): Promise<void> {",
            '    identity?: SessionIdentity,\n    prepared?: any,\n  ): Promise<void> {\n    if (prepared && !prototypeIsTimelineSnapshot(prepared)) throw new Error("时间线快照无效或已释放");',
          );
          replace(
            "          this.evaluator = prepareEvaluator(document);",
            "          this.evaluator = prepared ?? prepareEvaluator(document);",
          );
          replace(
            "          this.options.canLoadWaveform?.() !== false &&",
            "          (prepared ? this.prototypeEnabled : this.options.canLoadWaveform?.() !== false) &&",
          );
          replace(
            "          try {\n            lanes = compileAudioPlan(",
            `          try {
            if (prepared) {
              const roots = sequence.clips.filter((clip) => selectedIds.has(clip.id) && ["media", "sequence", "multicam"].includes(clip.kind)).map((clip) => clip.id).sort();
              const planKey = JSON.stringify([this.documentKey, sequenceId, roots]);
              if (this.#prototypePlan?.key === planKey) {
                prototypeMetrics().hits++; lanes = this.#prototypePlan.lanes;
              } else {
                this.prototypeDropPlan(); prototypeMetrics().misses++;
                lanes = prepared.compileVisibleAudio(sequenceId, roots);
                aborted(controller.signal);
                this.#prototypePlan = { key: planKey, lanes };
              }
            } else {
              const begin = performance.now(); prototypeMetrics().compileCalls++;
              try { lanes = compileAudioPlan(`,
          );
          replace(
            "            ).lanes;\n          } catch (error)",
            "            ).lanes; } finally { prototypeMetrics().compileMs += performance.now() - begin; }\n            }\n          } catch (error)",
          );
          replace(
            "        this.compositor.draw(tile, small, media);",
            "        this.compositor.draw(tile, small, media);\n        if (signal.aborted) { disposeCanvas(tile); aborted(signal); }",
          );
          replace(
            "          this.drawAudio(strip, clip, clipLanes, available, picture);",
            "          this.drawAudio(strip, clip, clipLanes, available, picture);\n          aborted(controller.signal);",
          );
        }
        return { contents: source, loader: "ts" };
      });
    },
  };
}

const tests = String.raw`
globalThis.prototypeMode = process.env.OWNED_PLAN_MODE;
test("owned prototype benchmark", async (t) => {
  const result = await page.evaluate(async (mode) => {
    const base = fixture(), template = base.sequences[0], clip = template.clips[0];
    base.id = "legal-five-thousand"; base.sequences = [];
    for (let offset = 0; offset < 5000; offset += 2000) {
      const sequence = structuredClone(template); sequence.id = offset ? "inactive-" + offset : "main";
      sequence.clips = Array.from({ length: Math.min(2000, 5000 - offset) }, (_, index) => ({ ...structuredClone(clip), id: offset + index ? "clip-" + (offset + index) : "a", start: index * clip.duration }));
      base.sequences.push(sequence);
    }
    doc = base; media.reset();
    globalThis.ownedCap = undefined; globalThis.ownedIdentityKey = undefined;
    globalThis.drawOwned = async (ids = ["a"], { width = 288, start = 0, end = 480000, sequenceId = "main" } = {}) => {
      const strips = ids.map((id) => { const canvas = document.createElement("canvas"); canvas.dataset.clip = id; document.querySelector("#mount").appendChild(canvas); return { clipId: id, canvas, localStart: start, localEnd: end, width, height: 32 }; });
      const identity = { documentId: doc.id, revision: doc.revision, generation: mediaGeneration }, key = JSON.stringify(identity);
      if (mode === "owned") {
        if (!api.prototypeIsTimelineSnapshot(ownedCap) || ownedIdentityKey !== key) { ownedCap?.dispose(); ownedCap = api.prototypePrepareTimelineSnapshot(doc, { documentId: doc.id, revision: doc.revision, generation: mediaGeneration }); ownedIdentityKey = key; }
        await media.prototypeRenderPrepared(ownedCap, sequenceId, strips, identity);
      } else await media.render(doc, sequenceId, strips, identity);
    };
    const collect = async (ids, options = {}) => { document.querySelector("#mount").replaceChildren(); const start = performance.now(); await drawOwned(ids, options); return performance.now() - start; };
    globalThis.__ownedPlanMetrics = undefined;
    const firstMs = await collect(["a"]), firstMetrics = { ...__ownedPlanMetrics };
    await collect(["clip-1"]);
    await collect(["clip-2000"], { sequenceId: "inactive-2000" });
    await collect(["a"]);
    const phases = [];
    for (const kind of ["same-roots", "cross-roots", "seq-switch"]) {
      globalThis.__ownedPlanMetrics = undefined;
      const times = [];
      for (let index = 0; index < 32; index++) {
        const switchSeq = kind === "seq-switch" && index % 2;
        const ids = switchSeq ? ["clip-2000"] : kind === "cross-roots" && index % 2 ? ["clip-1"] : ["a"];
        times.push(await collect(ids, { ...(index % 2 ? {} : { width: 216, start: 120000, end: 480000 }), sequenceId: switchSeq ? "inactive-2000" : "main" }));
      }
      times.sort((a, b) => a - b);
      phases.push({ kind, medianMs: times[16], p95Ms: times[30], metrics: { ...__ownedPlanMetrics } });
    }
    return { firstMs, firstMetrics, phases, state: media.prototypeState(), stats: media.stats, errors: [...errors] };
  }, process.env.OWNED_PLAN_MODE);
  const cdp = await page.context().newCDPSession(page);
  const heap = async () => { await cdp.send("HeapProfiler.collectGarbage"); return (await cdp.send("Runtime.getHeapUsage")).usedSize; };
  const heldHeap = await heap();
  await page.evaluate(() => media.prototypeDropPlan());
  const releasedPlanHeap = await heap();
  await page.evaluate(() => media.reset());
  const resetHeap = await heap();
  const resetState = await page.evaluate(() => media.prototypeState());
  await page.evaluate(() => media.dispose());
  const disposedHeap = await heap();
  t.diagnostic(JSON.stringify({ mode: process.env.OWNED_PLAN_MODE, ...result, heap: { heldHeap, releasedPlanHeap, planBytes: heldHeap - releasedPlanHeap, resetHeap, disposedHeap }, resetState }));
  assert.deepEqual(result.errors, []);
  assert.ok(result.stats.thumbnails <= 160);
  if (process.env.OWNED_PLAN_MODE === "owned") {
    assert.equal(result.phases[0].metrics.hits, 32);
    assert.equal(result.phases[0].metrics.compileCalls, 0);
  }
  assert.deepEqual(resetState, { cap: false, plan: false });
});

test("owned prototype public rejection and fake capability boundaries", async (t) => {
  const results = [];
  for (const kind of ["source-bound", "missing-field", "getter"]) {
    const result = await page.evaluate(async (kind) => {
      reset();
      const inactive = structuredClone(doc.sequences[0]); inactive.id = "inactive"; doc.sequences.push(inactive);
      await draw();
      const target = doc.sequences[1].clips[0]; let getterCalls = 0;
      if (kind === "source-bound") target.timeMap.points[1].source = 480001;
      if (kind === "missing-field") delete target.trackId;
      if (kind === "getter") Object.defineProperty(target, "duration", { enumerable: true, configurable: true, get() { getterCalls++; return 480000; } });
      document.querySelector("#mount").replaceChildren(); await draw();
      let factoryError;
      try { api.prototypePrepareTimelineSnapshot(doc, { documentId: doc.id, revision: doc.revision, generation: mediaGeneration }); } catch (error) { factoryError = error.message; }
      return { kind, state: document.querySelector("canvas").dataset.etMediaState, getterCalls, factoryError };
    }, kind);
    assert.equal(result.state, "error"); assert.equal(result.getterCalls, 0); assert.ok(result.factoryError); results.push(result);
  }
  const fake = await page.evaluate(async () => {
    reset();
    const cap = api.prototypePrepareTimelineSnapshot(doc, { documentId: doc.id, revision: doc.revision, generation: mediaGeneration }), results = [];
    for (const impostor of [{ ...cap }, Object.create(cap), { documentId: doc.id, revision: doc.revision, evaluate: cap.evaluate, stripInfo: cap.stripInfo }]) {
      try { await media.prototypeRenderPrepared(impostor, "main", []); results.push("accepted"); } catch (error) { results.push(error.message); }
    }
    cap.dispose();
    try { await media.prototypeRenderPrepared(cap, "main", []); results.push("accepted-disposed"); } catch (error) { results.push(error.message); }
    return results;
  });
  assert.ok(fake.every((message) => /无效或已释放/.test(message)));
  t.diagnostic(JSON.stringify({ publicInputs: results, fake }));
});

test("owned prototype detached projections, caller mutation, and canonical root order", async () => {
  const result = await page.evaluate(async () => {
    const other = structuredClone(doc.sequences[0].clips[0]); other.id = "b"; other.start = 480000; doc.sequences[0].clips.push(other);
    const cap = api.prototypePrepareTimelineSnapshot(doc, { documentId: doc.id, revision: doc.revision, generation: mediaGeneration });
    const info = cap.stripInfo("main", ["a"]), plan = cap.compileVisibleAudio("main", ["a"]);
    info.sequences[0].clips[0].start = 999999; info.sequences[0].tracks[0].hidden = true; info.assets[0].duration = 1;
    plan[0].stages[0].audio.volume = 0; plan[0].spans.length = 0;
    doc.sequences[0].clips[0].timeMap.points[1].source = 480001;
    const independentInfo = cap.stripInfo("main", ["a"]), independentPlan = cap.compileVisibleAudio("main", ["a"]);
    const render = async (ids) => {
      document.querySelector("#mount").replaceChildren();
      const strips = ids.map((id) => { const canvas = document.createElement("canvas"); canvas.dataset.clip = id; document.querySelector("#mount").appendChild(canvas); return { clipId: id, canvas, localStart: 0, localEnd: 480000, width: 288, height: 32 }; });
      await media.prototypeRenderPrepared(cap, "main", strips, { documentId: cap.documentId, revision: cap.revision, generation: mediaGeneration });
      return strips.map((strip) => strip.canvas.dataset.etMediaState);
    };
    globalThis.__ownedPlanMetrics = undefined;
    const first = await render(["a", "b"]), second = await render(["b", "a", "a"]);
    return { first, second, info: independentInfo.sequences[0].clips[0].start, hidden: independentInfo.sequences[0].tracks[0].hidden, volume: independentPlan[0].stages[0].audio.volume, spans: independentPlan[0].spans.length, metrics: { ...__ownedPlanMetrics }, color: pixel("a", 20, 8) };
  });
  assert.deepEqual(result.first, ["ready", "ready"]); assert.deepEqual(result.second, ["ready", "ready", "ready"]);
  assert.equal(result.info, 0); assert.equal(result.hidden, false); assert.equal(result.volume, 1); assert.ok(result.spans > 0);
  assert.equal(result.metrics.compileCalls, 1); assert.equal(result.metrics.hits, 1); assert.ok(red(result.color));
});

test("owned prototype externally disposed pending resolver cannot publish or leak", async () => {
  const result = await page.evaluate(async () => {
    media.dispose();
    const oldCap = api.prototypePrepareTimelineSnapshot(doc, { documentId: doc.id, revision: doc.revision, generation: mediaGeneration }), nextCap = api.prototypePrepareTimelineSnapshot(doc, { documentId: doc.id, revision: doc.revision, generation: mediaGeneration });
    const oldUrl = URL.createObjectURL(new Blob([await (await fetch(sourceUrl)).arrayBuffer()], { type: "video/mp4" }));
    const revoke = URL.revokeObjectURL.bind(URL), revoked = [];
    URL.revokeObjectURL = (url) => { revoked.push(url); revoke(url); };
    let release, count = 0, signal;
    try {
      media = new api.EditorTimelineMedia({ resolveAsset: (id, current) => { if (++count === 1) { signal = current; return new Promise((resolve) => { release = resolve; }); } return sourceUrl.replace("source.mp4", "reversed.mp4"); }, onError: (error) => errors.push(error.message) });
      const strip = () => { const canvas = document.createElement("canvas"); canvas.dataset.clip = "a"; document.querySelector("#mount").appendChild(canvas); return { clipId: "a", canvas, localStart: 0, localEnd: 480000, width: 288, height: 32 }; };
      const oldStrip = strip(), old = media.prototypeRenderPrepared(oldCap, "main", [oldStrip]);
      while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
      oldCap.dispose();
      document.querySelector("#mount").replaceChildren(); const fresh = strip();
      await media.prototypeRenderPrepared(nextCap, "main", [fresh]);
      release({ url: oldUrl, owned: true }); await old; await new Promise((resolve) => setTimeout(resolve, 0));
      let stale;
      try { await media.prototypeRenderPrepared(oldCap, "main", []); stale = "accepted"; } catch (error) { stale = error.message; }
      const color = pixel("a", 20, 8), state = fresh.canvas.dataset.etMediaState, oldState = oldStrip.canvas.dataset.etMediaState;
      media.dispose();
      return { color, state, oldState, stale, aborted: signal.aborted, revoked: revoked.filter((url) => url === oldUrl).length, errors: [...errors], stats: media.stats, active: api.prototypeIsTimelineSnapshot(nextCap) };
    } finally { URL.revokeObjectURL = revoke; revoke(oldUrl); }
  });
  assert.ok(blue(result.color)); assert.equal(result.state, "ready"); assert.notEqual(result.oldState, "ready");
  assert.match(result.stale, /无效或已释放/); assert.equal(result.aborted, true); assert.equal(result.revoked, 1);
  assert.deepEqual(result.errors, []); assert.deepEqual(result.stats, { thumbnails: 0, waveformBytes: 0, waveforms: 0 }); assert.equal(result.active, false);
});

test("owned prototype current loader options, deferred loading, and failed waveform retry", async () => {
  const result = await page.evaluate(async () => {
    media.dispose();
    const cap = api.prototypePrepareTimelineSnapshot(doc, { documentId: doc.id, revision: doc.revision, generation: mediaGeneration });
    let enabled = false, loads = 0;
    const options = { resolveAsset: () => sourceUrl, canLoadWaveform: () => enabled,
      loadWaveform: async () => { if (++loads === 1) throw new Error("临时波形失败"); return wave; },
      onError: (error) => errors.push(error.message),
    };
    media = new api.EditorTimelineMedia(options);
    const drawCurrent = async () => {
      document.querySelector("#mount").replaceChildren();
      const canvas = document.createElement("canvas"); canvas.dataset.clip = "a"; document.querySelector("#mount").appendChild(canvas);
      await media.prototypeRenderPrepared(cap, "main", [{ clipId: "a", canvas, localStart: 0, localEnd: 480000, width: 288, height: 32 }]);
      const pixels = canvas.getContext("2d").getImageData(20, 0, 1, canvas.height).data;
      let wavePixels = 0;
      for (let y = 18; y < 32; y++) if (pixels[y * 4] < 190 && pixels[y * 4 + 1] > 100 && pixels[y * 4 + 2] > 100) wavePixels++;
      return { state: canvas.dataset.etMediaState, loads, wavePixels, metrics: { compileCalls: 0, ...__ownedPlanMetrics }, cache: media.prototypeState() };
    };
    globalThis.__ownedPlanMetrics = undefined;
    const deferred = await drawCurrent();
    enabled = true;
    const failed = await drawCurrent(), retry = await drawCurrent();
    options.loadWaveform = async () => { loads++; return reversedWave; };
    const changed = await drawCurrent();
    enabled = false;
    const disabled = await drawCurrent();
    enabled = true;
    const resumed = await drawCurrent();
    media.dispose();
    return { deferred, failed, retry, changed, disabled, resumed, errors: [...errors] };
  });
  assert.equal(result.deferred.state, "ready"); assert.equal(result.deferred.loads, 0); assert.equal(result.deferred.metrics.compileCalls, 0);
  assert.equal(result.failed.state, "error"); assert.equal(result.failed.loads, 1); assert.equal(result.failed.cache.plan, true);
  assert.equal(result.retry.state, "ready"); assert.equal(result.retry.loads, 2); assert.equal(result.retry.metrics.compileCalls, 1);
  assert.equal(result.changed.state, "ready"); assert.equal(result.changed.loads, 3); assert.equal(result.changed.metrics.compileCalls, 2);
  assert.ok(result.changed.wavePixels > result.retry.wavePixels);
  assert.equal(result.disabled.cache.plan, false); assert.equal(result.disabled.loads, 3);
  assert.equal(result.resumed.state, "ready"); assert.equal(result.resumed.loads, 3); assert.equal(result.resumed.metrics.compileCalls, 3);
  assert.deepEqual(result.errors, ["临时波形失败"]);
});

test("owned prototype visible roots keep the partial lane budget and do not cache failed plans", async () => {
  const result = await page.evaluate(async () => {
    const nested = structuredClone(doc.sequences[0]); nested.id = "nested"; nested.tracks = [api.createTrack("nested-audio", "audio")];
    nested.clips = Array.from({ length: 257 }, (_, index) => ({ ...structuredClone(doc.sequences[0].clips[0]), id: "sound-" + index, trackId: "nested-audio", start: index * 480000 }));
    doc.sequences.push(nested);
    const nestedClip = { ...structuredClone(doc.sequences[0].clips[0]), id: "nested-clip", kind: "sequence", sequenceId: "nested", start: 480000 }; delete nestedClip.assetId;
    doc.sequences[0].clips.push(nestedClip);
    let cap = api.prototypePrepareTimelineSnapshot(doc, { documentId: doc.id, revision: doc.revision, generation: mediaGeneration });
    const drawCurrent = async (id) => {
      document.querySelector("#mount").replaceChildren();
      const canvas = document.createElement("canvas"); canvas.dataset.clip = id; document.querySelector("#mount").appendChild(canvas);
      await media.prototypeRenderPrepared(cap, "main", [{ clipId: id, canvas, localStart: 0, localEnd: 480000, width: 288, height: 32 }]);
      return { state: canvas.dataset.etMediaState, cache: media.prototypeState(), metrics: { ...__ownedPlanMetrics } };
    };
    globalThis.__ownedPlanMetrics = undefined;
    const offscreen = await drawCurrent("a"), excess = await drawCurrent("nested-clip"), retry = await drawCurrent("nested-clip"), back = await drawCurrent("a");
    doc.sequences[1].clips.length = 1; doc.revision++;
    const old = cap; cap = api.prototypePrepareTimelineSnapshot(doc, { documentId: doc.id, revision: doc.revision, generation: mediaGeneration });
    const revision = await drawCurrent("nested-clip"), oldActive = api.prototypeIsTimelineSnapshot(old);
    doc.sequences[0].clips[0].timeMap.points = [{ time: 0, source: 480000 }, { time: 480000, source: 0 }];
    const sameIdentity = cap; cap = api.prototypePrepareTimelineSnapshot(doc, { documentId: doc.id, revision: doc.revision, generation: mediaGeneration });
    const generation = await drawCurrent("a"), color = pixel("a", 20, 8), sameActive = api.prototypeIsTimelineSnapshot(sameIdentity);
    media.reset();
    return { offscreen, excess, retry, back, revision, oldActive, generation, color, sameActive, reset: media.prototypeState(), stats: media.stats };
  });
  assert.equal(result.offscreen.state, "ready"); assert.equal(result.offscreen.metrics.compileCalls, 1);
  assert.equal(result.excess.state, "error"); assert.equal(result.excess.cache.plan, false); assert.equal(result.excess.metrics.compileCalls, 2);
  assert.equal(result.retry.state, "error"); assert.equal(result.retry.cache.plan, false); assert.equal(result.retry.metrics.compileCalls, 3);
  assert.equal(result.back.state, "ready"); assert.equal(result.back.metrics.compileCalls, 4);
  assert.equal(result.revision.state, "ready"); assert.equal(result.oldActive, false);
  assert.equal(result.generation.state, "ready"); assert.equal(result.sameActive, false); assert.ok(blue(result.color));
  assert.deepEqual(result.reset, { cap: false, plan: false }); assert.deepEqual(result.stats, { thumbnails: 0, waveformBytes: 0, waveforms: 0 });
});

test("owned prototype disposing while waveform pending cannot publish old audio or cache", async () => {
  const result = await page.evaluate(async () => {
    media.dispose();
    const oldCap = api.prototypePrepareTimelineSnapshot(doc, { documentId: doc.id, revision: doc.revision, generation: mediaGeneration }), nextCap = api.prototypePrepareTimelineSnapshot(doc, { documentId: doc.id, revision: doc.revision, generation: mediaGeneration });
    let release, count = 0, signal;
    media = new api.EditorTimelineMedia({ resolveAsset: () => sourceUrl, loadWaveform: (id, current) => { if (++count === 1) { signal = current; return new Promise((resolve) => release = resolve); } return Promise.resolve(reversedWave); }, onError: (error) => errors.push(error.message) });
    const strip = () => { const canvas = document.createElement("canvas"); canvas.dataset.clip = "a"; document.querySelector("#mount").appendChild(canvas); return { clipId: "a", canvas, localStart: 0, localEnd: 480000, width: 288, height: 48 }; };
    const oldStrip = strip(), pending = media.prototypeRenderPrepared(oldCap, "main", [oldStrip]);
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    oldCap.dispose(); document.querySelector("#mount").replaceChildren(); const nextStrip = strip();
    await media.prototypeRenderPrepared(nextCap, "main", [nextStrip]);
    release(wave); await pending;
    const pixels = nextStrip.canvas.getContext("2d").getImageData(20, 0, 1, 48).data;
    let wavePixels = 0; for (let y = 27; y < 48; y++) if (pixels[y * 4] < 190 && pixels[y * 4 + 1] > 100 && pixels[y * 4 + 2] > 100) wavePixels++;
    return { oldState: oldStrip.canvas.dataset.etMediaState, state: nextStrip.canvas.dataset.etMediaState, aborted: signal.aborted, count, wavePixels, stats: media.stats, errors: [...errors] };
  });
  assert.notEqual(result.oldState, "ready"); assert.equal(result.state, "ready"); assert.equal(result.aborted, true); assert.equal(result.count, 2); assert.ok(result.wavePixels >= 4);
  assert.equal(result.stats.waveforms, 1); assert.deepEqual(result.errors, []);
});

test("owned prototype synchronous drawing disposal cannot refill cache or publish ready", async () => {
  for (const phase of ["thumbnail", "audio"]) {
    const result = await page.evaluate(async (phase) => {
      reset();
      const cap = api.prototypePrepareTimelineSnapshot(doc, { documentId: doc.id, revision: doc.revision, generation: mediaGeneration }), next = api.prototypePrepareTimelineSnapshot(doc, { documentId: doc.id, revision: doc.revision, generation: mediaGeneration });
      const canvas = document.createElement("canvas"); canvas.dataset.clip = "a"; document.querySelector("#mount").appendChild(canvas);
      const strip = { clipId: "a", canvas, localStart: 0, localEnd: 480000, width: 288, height: 32 };
      const prototype = CanvasRenderingContext2D.prototype, key = phase === "thumbnail" ? "drawImage" : "stroke", original = prototype[key];
      let disposed = false;
      prototype[key] = function (...args) { if (!disposed && (phase === "thumbnail" || this.canvas === canvas)) { disposed = true; cap.dispose(); } return original.apply(this, args); };
      try { await media.prototypeRenderPrepared(cap, "main", [strip]); } finally { prototype[key] = original; }
      const after = { stats: media.stats, cache: media.prototypeState(), state: canvas.dataset.etMediaState, disposed };
      document.querySelector("#mount").replaceChildren();
      const fresh = document.createElement("canvas"); fresh.dataset.clip = "a"; document.querySelector("#mount").appendChild(fresh);
      await media.prototypeRenderPrepared(next, "main", [{ ...strip, canvas: fresh }]);
      return { after, next: fresh.dataset.etMediaState, color: pixel("a", 20, 8), errors: [...errors] };
    }, phase);
    assert.equal(result.after.disposed, true); assert.notEqual(result.after.state, "ready"); assert.deepEqual(result.after.cache, { cap: false, plan: false });
    assert.deepEqual(result.after.stats, { thumbnails: 0, waveformBytes: 0, waveforms: 0 });
    assert.equal(result.next, "ready"); assert.ok(red(result.color)); assert.deepEqual(result.errors, []);
  }
});

test("owned prototype idle external disposal releases renderer references and rejects every stale method", async () => {
  const result = await page.evaluate(async () => {
    const cap = api.prototypePrepareTimelineSnapshot(doc, { documentId: doc.id, revision: doc.revision, generation: mediaGeneration });
    const canvas = document.createElement("canvas"); document.querySelector("#mount").appendChild(canvas);
    await media.prototypeRenderPrepared(cap, "main", [{ clipId: "a", canvas, localStart: 0, localEnd: 480000, width: 288, height: 32 }]);
    const before = media.prototypeState(); cap.dispose();
    const methods = [];
    for (const call of [() => cap.stripInfo("main", ["a"]), () => cap.compileVisibleAudio("main", ["a"]), () => cap.evaluate("main", 0), () => media.prototypeRenderPrepared(cap, "main", [])]) {
      try { await call(); methods.push("accepted"); } catch (error) { methods.push(error.message); }
    }
    let getterCalls = 0;
    const impostor = { get documentId() { getterCalls++; throw new Error("不应读取伪造标识"); } };
    try { await media.prototypeRenderPrepared(impostor, "main", []); } catch {}
    const proxy = new Proxy(cap, { get() { getterCalls++; throw new Error("不应读取代理"); } });
    try { await media.prototypeRenderPrepared(proxy, "main", []); } catch {}
    return { before, after: media.prototypeState(), stats: media.stats, methods, getterCalls, errors: [...errors] };
  });
  assert.deepEqual(result.before, { cap: true, plan: true }); assert.deepEqual(result.after, { cap: false, plan: false });
  assert.deepEqual(result.stats, { thumbnails: 0, waveformBytes: 0, waveforms: 0 });
  assert.ok(result.methods.every((message) => /释放/.test(message))); assert.equal(result.getterCalls, 0); assert.deepEqual(result.errors, []);
});

test("owned prototype generation mismatch and hostile disposal observers cannot weaken ownership", async () => {
  const result = await page.evaluate(async () => {
    const identity = { documentId: doc.id, revision: doc.revision, generation: mediaGeneration }, cap = api.prototypePrepareTimelineSnapshot(doc, identity);
    identity.generation++; identity.revision++;
    let mismatch;
    try { await media.prototypeRenderPrepared(cap, "main", [], identity); mismatch = "accepted"; } catch (error) { mismatch = error.message; }
    let notifications = 0;
    cap.onDispose(() => { notifications++; throw new Error("用户释放监听失败"); });
    const canvas = document.createElement("canvas"); document.querySelector("#mount").appendChild(canvas);
    await media.prototypeRenderPrepared(cap, "main", [{ clipId: "a", canvas, localStart: 0, localEnd: 480000, width: 288, height: 32 }], { documentId: doc.id, revision: doc.revision, generation: mediaGeneration });
    cap.onDispose(() => { notifications++; cap.dispose(); });
    // A same-named ordinary property cannot replace the runtime-private cached plan.
    media.prototypePlan = { key: "hostile", lanes: [] };
    await media.prototypeRenderPrepared(cap, "main", [{ clipId: "a", canvas, localStart: 0, localEnd: 480000, width: 288, height: 32 }]);
    const ready = canvas.dataset.etMediaState;
    cap.dispose();
    return { mismatch, generation: cap.generation, notifications, ready, cache: media.prototypeState(), stats: media.stats, errors: [...errors] };
  });
  assert.match(result.mismatch, /身份不匹配/); assert.equal(result.generation, 1); assert.equal(result.notifications, 2); assert.equal(result.ready, "ready");
  assert.deepEqual(result.cache, { cap: false, plan: false }); assert.deepEqual(result.stats, { thumbnails: 0, waveformBytes: 0, waveforms: 0 }); assert.deepEqual(result.errors, []);
});
`;

async function run() {
  const original = await readFile(
    join(root, "tests/video-studio-editor-timeline-media.test.mjs"),
    "utf8",
  );
  const anchor = '    format: "iife",\n    globalName: "api",';
  if (!original.includes(anchor)) throw new Error("Browser fixture anchor changed");
  let source =
    `import {ownedPlanPrototypePlugin} from '../scripts/video-studio-timeline-owned-plan-prototype.mjs';\n` +
    original.replace(anchor, "    plugins: [ownedPlanPrototypePlugin()],\n" + anchor);
  source = source.replace(
    "export {EditorSession} from './apps/video-studio/src/editor/session.ts';",
    "export {EditorSession} from './apps/video-studio/src/editor/session.ts';export {prototypePrepareTimelineSnapshot,prototypeIsTimelineSnapshot} from './apps/video-studio/src/editor/evaluate.ts';",
  );
  source += tests;
  const file = join(root, `tests/.timeline-owned-plan-prototype-${process.pid}.test.mjs`);
  await writeFile(file, source);
  try {
    for (const mode of process.argv.slice(2).length
      ? process.argv.slice(2)
      : ["baseline", "owned"]) {
      const status = await new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ["--test", "--test-name-pattern=owned prototype", file],
          { cwd: root, env: { ...process.env, OWNED_PLAN_MODE: mode }, stdio: "inherit" },
        );
        child.on("error", reject);
        child.on("exit", resolve);
      });
      if (status !== 0) throw new Error(`${mode} prototype failed (${status})`);
    }
  } finally {
    await rm(file, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
