/**
 * Experimental benchmark only. No application module or public API is modified.
 * The esbuild plugin extracts the existing private mutation/trim bodies in memory,
 * so the prototype exercises the same locks, captions and final graph validation.
 * Run: node scripts/video-studio-owned-preview-prototype.mjs
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const useStructuredClone = process.argv.includes("--structured-clone");
const freezeBase = !process.argv.includes("--unfrozen-base");
function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, `Prototype source anchor changed: ${before}`);
  return source.replace(before, after);
}
const prototype = {
  name: "owned-preview-prototype",
  setup(builder) {
    builder.onLoad({ filter: /editor\/operations\.ts$/ }, async ({ path }) => {
      let contents = await readFile(path, "utf8");
      contents = replaceOnce(contents,
        "  // Validation already deep-copies the entire JSON graph before reading it.\n  const next = validateEditorDocument(document);",
        `  return applyOperationsToDraft(document, validateEditorDocument(document), operations, baseRevision);
}
function applyOperationsToDraft(
  document: EditorDocument,
  next: EditorDocument,
  operations: readonly EditorOperation[],
  baseRevision: number,
): EditorDocument {
  "use strict";
  if (globalThis.__trace.probeBeforeWrite) document.sequences[0]!.clips[0]!.transform.x = 123;`);
      contents += `
function freezePreviewBase<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezePreviewBase(child);
    Object.freeze(value);
  }
  return value;
}
// Only called on our own validated, deeply frozen JSON graph, never on caller data.
function clonePreviewBase<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((child) => clonePreviewBase(child)) as T;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) result[key] = clonePreviewBase(value[key]);
  return result as T;
}
export function prepareEditorOperationPreview(value: EditorDocument) {
  let base: EditorDocument | undefined = ${freezeBase ? "freezePreviewBase(validateEditorDocument(value))" : "validateEditorDocument(value)"};
  const current = () => {
    if (!base) throw new Error("预览已释放");
    return base;
  };
  const copy = (document: EditorDocument) => {
    globalThis.__trace.ownedCopies = (globalThis.__trace.ownedCopies ?? 0) + 1;
    return ${useStructuredClone ? "structuredClone(document)" : "clonePreviewBase(document)"};
  };
  return Object.freeze({
    read: () => copy(current()),
    preview: (operations: readonly EditorOperation[]) => {
      const document = current();
      const result = applyOperationsToDraft(document, copy(document), operations, document.revision);
      if (base !== document) throw new Error("预览已释放");
      return result;
    },
    dispose: () => { base = undefined; },
  });
}
`;
      return { contents, loader: "ts" };
    });
    builder.onLoad({ filter: /editor\/clip-edits\.ts$/ }, async ({ path }) => {
      let contents = await readFile(path, "utf8");
      contents = replaceOnce(contents,
        'import { applyEditorOperations, type EditorClipPatch, type EditorOperation } from "./operations";',
        'import { applyEditorOperations, prepareEditorOperationPreview, type EditorClipPatch, type EditorOperation } from "./operations";');
      const start = contents.indexOf("export function trimClip("),
        end = contents.indexOf("\n/** Split the selected instance", start),
        original = contents.slice(start, end);
      assert(start >= 0 && end > start);
      let replacement = replaceOnce(original,
        "  const { document, sequence } = context(value, sequenceId),\n    before = findClip(sequence, clipId);",
        `  const { document, sequence } = context(value, sequenceId);
  const operations = trimOperations(sequence, sequenceId, clipId, localStart, localEnd);
  return operations.length ? finish(document, operations) : operations;
}
function trimOperations(
  sequence: EditorSequence,
  sequenceId: string,
  clipId: string,
  localStart: Tick,
  localEnd: Tick,
): EditorOperation[] {
  const before = findClip(sequence, clipId);`);
      replacement = replaceOnce(replacement,
        "  return finish(document, operations);",
        "  return operations;");
      contents = contents.slice(0, start) + replacement + contents.slice(end);
      contents += `
export function prepareClipTrim(value: EditorDocument, sequenceId: string, clipId: string) {
  const preview = prepareEditorOperationPreview(value);
  let sequence = preview.read().sequences.find((item) => item.id === sequenceId);
  if (!sequence) { preview.dispose(); throw new Error("时间线不存在，请刷新后重试"); }
  findClip(sequence, clipId);
  function freeze(value: any): void {
    if (!value || typeof value !== "object") return;
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  freeze(sequence);
  return Object.freeze({
    plan: (localStart: Tick, localEnd: Tick) => {
      if (!sequence) throw new Error("预览已释放");
      const operations = trimOperations(sequence, sequenceId, clipId, localStart, localEnd);
      preview.preview(operations);
      return structuredClone(operations);
    },
    dispose: () => { sequence = undefined; preview.dispose(); },
  });
}
`;
      return { contents, loader: "ts" };
    });
    builder.onLoad({ filter: /editor\/validation\.ts$/ }, async ({ path }) => {
      let contents = await readFile(path, "utf8");
      contents = replaceOnce(contents,
        "export function validateEditorDocument(value: unknown): EditorDocument {",
        "function originalValidate(value: unknown): EditorDocument {");
      contents += `
export function validateEditorDocument(value: unknown): EditorDocument {
  globalThis.__trace.validations++;
  return originalValidate(value);
}
`;
      return { contents, loader: "ts" };
    });
  },
};
const bundle = await build({
  stdin: {
    contents: `export * from './apps/video-studio/src/editor/defaults';
      export { applyEditorOperations, prepareEditorOperationPreview } from './apps/video-studio/src/editor/operations';
      export { trimClip, prepareClipTrim } from './apps/video-studio/src/editor/clip-edits';
      export { validateEditorDocument } from './apps/video-studio/src/editor/validation';`,
    resolveDir: root,
  },
  bundle: true, write: false, format: "iife", globalName: "api", platform: "browser",
  target: "chrome120", plugins: [prototype],
});
const browser = await chromium.launch({
  headless: true, args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"],
});
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: `globalThis.__frozenBase=${freezeBase};globalThis.__trace={validations:0};` + bundle.outputFiles[0].text });
  const result = await page.evaluate(() => {
    const assert = (condition, reason) => { if (!condition) throw new Error(reason); },
      same = (a, b) => JSON.stringify(a) === JSON.stringify(b),
      throws = (fn, pattern) => {
        try { fn(); } catch (error) {
          assert(pattern.test(error.message), `Wrong rejection: ${error.message}`);
          return;
        }
        throw new Error(`Missing rejection: ${pattern}`);
      };
    function fixture(count) {
      const document = {
        schemaVersion: 2, timebase: 240000, id: "large", name: "能力预览原型", revision: 3,
        assets: [{ id: "demo", kind: "demo", name: "测试视频", duration: 8000, width: 320, height: 180 }],
        sequences: [], activeSequenceId: "main", exportProfiles: [],
      };
      for (let offset = 0; offset < count; offset += 2000) document.sequences.push({
        id: offset ? `seq-${offset}` : "main", name: "序列", width: 320, height: 180,
        frameRate: { numerator: 30, denominator: 1 }, background: "#000000", timelineMode: "free",
        tracks: [api.createTrack("v", "video")], transitions: [], markers: [],
        clips: Array.from({ length: Math.min(2000, count - offset) }, (_, index) => ({
          id: `clip-${offset + index}`, trackId: "v", kind: "media", assetId: "demo", label: "视频",
          start: index * 16000, duration: 8000,
          timeMap: { points: [{ time: 0, source: 0 }, { time: 8000, source: 8000 }] },
          audio: api.defaultAudioMix(), transform: api.defaultTransform(),
          color: api.defaultColorAdjustment(), blendMode: "normal",
        })),
      });
      return api.validateEditorDocument(document);
    }
    const move = (delta = 4000) => [{ type: "clip.move", sequenceId: "main", clipIds: ["clip-0"], delta }],
      checks = [];
    const input = fixture(2), original = structuredClone(input), owned = api.prepareEditorOperationPreview(input);
    Object.freeze(input);
    input.sequences[0].tracks[0].locked = true;
    input.assets.length = 0;
    assert(same(owned.preview(move()), api.applyEditorOperations(original, move(), original.revision)), "Caller input escaped into base");
    throws(() => api.applyEditorOperations(input, move(), input.revision), /素材|来源/);
    checks.push("nested caller mutation after shallow freeze cannot alter the captured base; public apply still rejects malformed input");
    const read = owned.read(), output = owned.preview(move()), operations = move();
    read.sequences[0].tracks[0].locked = true;
    read.sequences[0].clips[0].timeMap.points[1].source = 999999;
    output.assets.length = 0;
    output.sequences[0].clips.length = 0;
    owned.preview(operations);
    operations[0].clipIds.push("missing");
    operations[0].delta = -999999;
    assert(same(owned.read(), original), "Read/result/operations alias poisoned the base");
    assert(same(owned.preview(move()), api.applyEditorOperations(original, move(), original.revision)), "Candidate reused prior mutable state");
    checks.push("read, result, operation arrays and nested time maps cannot poison later candidates");
    const trim = api.prepareClipTrim(original, "main", "clip-0"), first = trim.plan(1000, 7000);
    first[0].patch.timeMap.points[1].source = 999999;
    assert(same(trim.plan(1000, 7000), api.trimClip(original, "main", "clip-0", 1000, 7000)), "Returned trim operations poisoned geometry");
    checks.push("trim geometry is frozen and returned patch values are detached");
    let getterCalls = 0, reentrantResult;
    const transform = api.defaultTransform();
    Object.defineProperty(transform, "x", { enumerable: true, get() {
      getterCalls++;
      reentrantResult = owned.preview(move(2000));
      reentrantResult.sequences[0].tracks[0].locked = true;
      return 0;
    } });
    const reentrant = owned.preview([{ type: "clip.update", sequenceId: "main", clipId: "clip-0", patch: { transform } }]);
    assert(getterCalls === 1 && reentrant.sequences[0].clips[0].start === 0 && !owned.read().sequences[0].tracks[0].locked, "Nested getter reentrancy mutated the base");
    const disposing = api.defaultTransform();
    Object.defineProperty(disposing, "x", { enumerable: true, get() { owned.dispose(); return 0; } });
    throws(() => owned.preview([{ type: "clip.update", sequenceId: "main", clipId: "clip-0", patch: { transform: disposing } }]), /释放/);
    throws(() => owned.preview(move()), /释放/);
    throws(() => owned.read(), /释放/);
    trim.dispose();
    throws(() => trim.plan(1000, 7000), /释放/);
    checks.push("reentrant nested getters use independent drafts; reentrant disposal rejects the current result and future calls");
    const malformed = fixture(2);
    let unsafeCalls = 0;
    Object.defineProperty(malformed, "name", { enumerable: true, get() { unsafeCalls++; return "unsafe"; } });
    for (const create of [
      () => api.prepareEditorOperationPreview(malformed),
      () => api.prepareClipTrim(malformed, "main", "clip-0"),
      () => api.applyEditorOperations(malformed, [], malformed.revision),
      () => api.trimClip(malformed, "main", "clip-0", 1000, 7000),
    ]) throws(create, /访问器/);
    assert(unsafeCalls === 0, "Malformed document getter ran");
    checks.push("factories and unchanged public entry points reject accessor documents before evaluating them");
    const negativeZero = fixture(1);
    negativeZero.sequences[0].clips[0].transform.x = -0;
    negativeZero.assets[0].metadata = { z: -0, nested: { empty: [], none: null, disabled: false, chinese: "中文😀\n第二行" }, a: 1 };
    const negativePreview = api.prepareEditorOperationPreview(negativeZero);
    const copiedNumbers = negativePreview.read();
    assert(Object.is(copiedNumbers.sequences[0].clips[0].transform.x, -0) && Object.is(copiedNumbers.assets[0].metadata.z, -0), "Owned copy changed negative zero");
    assert(same(Object.keys(copiedNumbers.assets[0].metadata), Object.keys(negativeZero.assets[0].metadata)), "Owned copy reordered object keys");
    assert(same(copiedNumbers.assets[0].metadata, negativeZero.assets[0].metadata), "Owned copy changed empty arrays, null, booleans or Unicode");
    negativePreview.dispose();
    const undefinedData = fixture(1);
    undefinedData.assets[0].metadata = { omitted: undefined };
    throws(() => api.prepareEditorOperationPreview(undefinedData), /JSON/);
    checks.push("owned copying preserves negative zero, key order, empty arrays, null, booleans and Unicode; undefined is rejected rather than discarded");
    if (globalThis.__frozenBase) {
      const probe = api.prepareEditorOperationPreview(fixture(1));
      globalThis.__trace.probeBeforeWrite = true;
      throws(() => probe.preview(move()), /read only|只读|readonly/i);
      globalThis.__trace.probeBeforeWrite = false;
      assert(probe.read().sequences[0].clips[0].transform.x === 0, "Private base changed after attempted accidental write");
      probe.dispose();
      checks.push("an intentional deep write to before inside the strict private mutation core throws immediately");
    }
    const locked = fixture(2);
    locked.sequences[0].tracks[0].locked = true;
    const lockedPreview = api.prepareEditorOperationPreview(locked), lockedTrim = api.prepareClipTrim(locked, "main", "clip-0");
    throws(() => lockedPreview.preview(move()), /锁定/);
    throws(() => lockedTrim.plan(1000, 7000), /锁定/);
    const clean = api.prepareEditorOperationPreview(original);
    throws(() => clean.preview(move(12000)), /重叠|冲突/);
    throws(() => clean.preview([{ type: "clip.update", sequenceId: "main", clipId: "clip-0", patch: { timeMap: { points: [{ time: 0, source: 0 }, { time: 8000, source: 9000 }] } } }]), /素材|来源|超出/);
    assert(same(clean.read(), original), "Failed candidate mutated the base");
    checks.push("locks, collisions, source bounds and atomic failure still use the existing mutation core and final validator");
    const captioned = fixture(2), seq = captioned.sequences[0], owner = seq.clips[0];
    captioned.assets[0].kind = "video";
    seq.tracks.push(api.createTrack("t", "text"));
    seq.clips.push({
      id: "caption", kind: "text", trackId: "t", label: "字幕", role: "subtitle", start: 0, duration: 8000,
      text: "你好世界", words: [{ text: "你好", start: 0, end: 4000 }, { text: "世界", start: 4000, end: 8000 }],
      style: api.defaultTextStyle(), transform: api.defaultTransform(), color: api.defaultColorAdjustment(), blendMode: "normal",
      sourceBinding: { clipId: owner.id, sourceStart: 0, sourceEnd: 8000, provenance: { path: [], assetId: "demo", start: 0, end: 8000 } },
    });
    const validCaptions = api.validateEditorDocument(captioned), captionPreview = api.prepareEditorOperationPreview(validCaptions), captionTrim = api.prepareClipTrim(validCaptions, "main", "clip-0");
    assert(same(captionPreview.preview(move()), api.applyEditorOperations(validCaptions, move(), validCaptions.revision)), "Caption reconcile move parity failed");
    assert(same(captionTrim.plan(4000, 8000), api.trimClip(validCaptions, "main", "clip-0", 4000, 8000)), "Caption slicing parity failed");
    checks.push("source-bound caption movement/reconciliation and word slicing match the unchanged public planners");
    const nested = fixture(1), inner = nested.sequences[0], wrapper = structuredClone(inner.clips[0]);
    delete wrapper.assetId;
    wrapper.id = "wrapper"; wrapper.kind = "sequence"; wrapper.sequenceId = "main";
    nested.sequences.push({ ...structuredClone(inner), id: "outer", clips: [wrapper] });
    const validNested = api.validateEditorDocument(nested), nestedTrim = api.prepareClipTrim(validNested, "main", "clip-0");
    throws(() => nestedTrim.plan(1000, 7000), /映射|素材|来源|超出/);
    nestedTrim.dispose();
    checks.push("final validation still rejects a trim that invalidates another sequence's source range");
    for (const value of [lockedPreview, lockedTrim, clean, captionPreview, captionTrim]) value.dispose();
    const nativeClone = structuredClone;
    globalThis.structuredClone = (...args) => { globalThis.__trace.clones++; return nativeClone(...args); };
    const timings = [];
    function measure(count, name, run) {
      for (let index = 0; index < 3; index++) run();
      globalThis.__trace = { validations: 0, clones: 0, ownedCopies: 0 };
      const samples = [];
      for (let index = 0; index < 12; index++) {
        const started = performance.now(); run(); samples.push(performance.now() - started);
      }
      const result = { count, name, meanMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
        p95Ms: samples.toSorted((a, b) => a - b)[10], validations: __trace.validations / 12,
        clones: __trace.clones / 12, ownedCopies: __trace.ownedCopies / 12 };
      timings.push(result);
      return result;
    }
    const sizes = [];
    for (const count of [1000, 5000]) {
      const document = fixture(count), preview = api.prepareEditorOperationPreview(document), preparedTrim = api.prepareClipTrim(document, "main", "clip-0");
      assert(same(preview.preview(move()), api.applyEditorOperations(document, move(), document.revision)), "Large move parity failed");
      assert(same(preparedTrim.plan(1000, 7000), api.trimClip(document, "main", "clip-0", 1000, 7000)), "Large trim parity failed");
      sizes.push({ count, sequenceLengths: document.sequences.map((item) => item.clips.length),
        documentJsonBytes: new TextEncoder().encode(JSON.stringify(document)).length,
        trimGeometryJsonBytes: new TextEncoder().encode(JSON.stringify(document.sequences[0])).length,
      });
      measure(count, "prepareMove", () => api.prepareEditorOperationPreview(document).dispose());
      measure(count, "read", () => preview.read());
      measure(count, "prepareTrim", () => api.prepareClipTrim(document, "main", "clip-0").dispose());
      measure(count, "publicMove", () => api.applyEditorOperations(document, move(), document.revision));
      measure(count, "ownedMove", () => preview.preview(move()));
      measure(count, "publicTrim", () => api.trimClip(document, "main", "clip-0", 1000, 7000));
      measure(count, "ownedTrim", () => preparedTrim.plan(1000, 7000));
      preview.dispose(); preparedTrim.dispose();
    }
    globalThis.structuredClone = nativeClone;
    globalThis.__memoryFixture = fixture;
    return { checks, sizes, timings };
  });
  const cdp = await page.context().newCDPSession(page), heap = [];
  for (const count of [1000, 5000]) {
    await page.evaluate((count) => { globalThis.__heapDocument = __memoryFixture(count); }, count);
    for (const kind of ["move", "trim"]) {
      await cdp.send("HeapProfiler.collectGarbage");
      const before = (await cdp.send("Runtime.getHeapUsage")).usedSize;
      await page.evaluate((kind) => {
        globalThis.__heldCapabilities = Array.from({ length: 3 }, () => kind === "move"
          ? api.prepareEditorOperationPreview(__heapDocument)
          : api.prepareClipTrim(__heapDocument, "main", "clip-0"));
      }, kind);
      await cdp.send("HeapProfiler.collectGarbage");
      const held = (await cdp.send("Runtime.getHeapUsage")).usedSize;
      await page.evaluate(() => { __heldCapabilities.forEach((value) => value.dispose()); __heldCapabilities = undefined; });
      await cdp.send("HeapProfiler.collectGarbage");
      heap.push({ count, kind, heldBytesPerCapability: (held - before) / 3,
        afterDisposeDeltaBytes: (await cdp.send("Runtime.getHeapUsage")).usedSize - before });
    }
  }
  console.log(JSON.stringify({ copyStrategy: useStructuredClone ? "structuredClone" : "private JSON graph clone",
    frozenBase: freezeBase, ...result, heap }, null, 2));
} finally {
  await browser.close();
}
