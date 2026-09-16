import assert from "node:assert/strict";
import test from "node:test";
import {
  audioEnhancementReceipt,
  planApplyAudioEnhancement,
  audioEnhancementSource,
  validateAudioEnhancementSettings,
  validateAudioEnhancementResult,
  enhancedEditorAsset,
} from "../apps/video-studio/src/editor/audio-enhancement";
import { createAudioEnhancementBridge } from "../apps/video-studio/src/editor/audio-enhancement-bridge";
import { createAudioEnhancementController } from "../apps/video-studio/src/editor/audio-enhancement-controller";
import { EditorSession } from "../apps/video-studio/src/editor/session";
import { applyEditorOperations } from "../apps/video-studio/src/editor/operations";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTransform,
  defaultTextStyle,
} from "../apps/video-studio/src/editor/defaults";
import { validateEditorDocument } from "../apps/video-studio/src/editor/validation";
import type { EditorDocument, MediaClip } from "../apps/video-studio/src/editor/types";
import { ProductionController } from "../apps/video-studio/src/production";
import { createProject, validateProject } from "../apps/video-studio/src/model";
const T = 240000,
  source = `asset-${"a".repeat(64)}`,
  settings = { preset: "balanced" as const, denoise: true, normalize: true };
function raw() {
  return {
    asset: {
      id: `asset-${"b".repeat(64)}`,
      sha256: "b".repeat(64),
      bytes: 960054,
      mimeType: "audio/wav",
    },
    inspection: {
      kind: "audio",
      durationSeconds: 480005 / 48000,
      audio: { sampleRate: 48000, channels: 1 },
    },
    provenance: {
      processor: "ffmpeg-audio-enhance",
      version: 1,
      sourceAssetId: source,
      ...settings,
    },
  };
}
function fixture(): EditorDocument {
  const clip: MediaClip = {
    id: "clip",
    kind: "media",
    assetId: "source",
    trackId: "v",
    label: "音源",
    start: 1001,
    duration: 2 * T,
    transform: {
      ...defaultTransform(),
      x: {
        keyframes: [
          { time: 0, value: 0 },
          { time: T, value: 0.2 },
          { time: 2 * T, value: 0.3 },
        ],
      },
    },
    color: defaultColorAdjustment(),
    blendMode: "normal",
    audio: {
      ...defaultAudioMix(),
      volume: {
        keyframes: [
          { time: 0, value: 0.5 },
          { time: 2 * T, value: 1 },
        ],
      },
      fadeIn: 1001,
      fadeOut: 2002,
      pan: 0.3,
    },
    timeMap: {
      points: [
        { time: 0, source: 6 * T },
        { time: T, source: 4 * T },
        { time: 2 * T, source: 5 * T },
      ],
    },
  };
  return validateEditorDocument({
    schemaVersion: 2,
    timebase: T,
    id: "enhance",
    revision: 0,
    name: "优化声音",
    activeSequenceId: "main",
    exportProfiles: [],
    assets: [
      { id: "source", kind: "video", name: "原始声音", duration: 10 * T, resourceId: source },
    ],
    sequences: [
      {
        id: "main",
        name: "主序列",
        width: 640,
        height: 360,
        frameRate: { numerator: 30000, denominator: 1001 },
        background: "#000000",
        timelineMode: "free",
        tracks: [createTrack("v", "video"), createTrack("t", "text")],
        clips: [
          clip,
          {
            id: "caption",
            kind: "text",
            role: "subtitle",
            trackId: "t",
            start: clip.start + T / 2,
            duration: T / 10,
            label: "字幕",
            text: "hello",
            style: defaultTextStyle(),
            words: [{ text: "hello", start: 0, end: T / 10 }],
            sourceBinding: {
              clipId: "clip",
              sourceStart: 4.8 * T,
              sourceEnd: 5 * T,
              provenance: { path: [], assetId: "source", start: 4.8 * T, end: 5 * T },
            },
            transform: defaultTransform(),
            color: defaultColorAdjustment(),
            blendMode: "normal",
          },
        ],
        transitions: [],
        markers: [],
      },
    ],
  });
}
const ids = () => {
  let n = 0;
  return () => `enhanced-${++n}`;
};
test("actual 48kHz native receipt preserves subframe samples and validates processing provenance", () => {
  const result = audioEnhancementReceipt(raw());
  assert.equal(result.duration, 10 * T + 25);
  assert.equal(result.sampleCount, 480005);
  assert.deepEqual(result.settings, settings);
  assert.throws(() =>
    audioEnhancementReceipt({
      ...raw(),
      provenance: { ...raw().provenance, processor: "equalizer" },
    }),
  );
  assert.throws(() =>
    audioEnhancementReceipt({
      ...raw(),
      inspection: { ...raw().inspection, durationSeconds: NaN },
    }),
  );
  assert.throws(
    () => validateAudioEnhancementSettings({ ...settings, denoise: false, normalize: false }),
    /请选择/,
  );
  assert.deepEqual(
    audioEnhancementReceipt({
      ...raw(),
      provenance: { ...raw().provenance, denoise: false, normalize: false },
    }).settings,
    { ...settings, denoise: false, normalize: false },
  );
  assert.throws(() => validateAudioEnhancementResult({ ...result, unknown: true }));
  assert.throws(() =>
    validateAudioEnhancementResult(Object.assign(Object.create({ inherited: true }), result)),
  );
  assert.throws(() => validateAudioEnhancementSettings({ ...settings, code: "evil" }));
});
test("selected clip optimization preserves reverse curve, audio automation, exact tick positions and bound words", () => {
  const doc = fixture(),
    original = structuredClone(doc),
    ops = planApplyAudioEnhancement(doc, "main", "clip", audioEnhancementReceipt(raw()), ids()),
    next = applyEditorOperations(doc, ops, 0),
    clips = next.sequences[0]!.clips;
  assert.deepEqual(doc, original);
  assert.deepEqual(
    clips.find((c) => c.id === "caption"),
    original.sequences[0]!.clips[1],
  );
  const sourceClip = clips.find((c) => c.id === "clip") as MediaClip,
    added = clips.find((c) => c.id !== "clip" && c.id !== "caption") as MediaClip;
  assert.equal(sourceClip.audio.volume, 0);
  assert.deepEqual(sourceClip.transform, (original.sequences[0]!.clips[0] as MediaClip).transform);
  assert.deepEqual(added.timeMap, sourceClip.timeMap);
  assert.deepEqual(added.audio, (original.sequences[0]!.clips[0] as MediaClip).audio);
  assert.equal(added.start, 1001);
  assert.equal(added.duration, 2 * T);
  assert.equal(next.assets[1]!.duration, 10 * T + 25);
  assert.equal(added.linkGroupId, sourceClip.linkGroupId);
});
test("leaf edits inside a nested sequence preserve wrapper mapping and other source instances", () => {
  const doc = fixture(),
    child = doc.sequences[0]!;
  child.id = "child";
  const parent = {
    ...structuredClone(child),
    id: "main",
    name: "主序列",
    clips: [
      {
        ...structuredClone(child.clips[0] as MediaClip),
        id: "wrapper",
        kind: "sequence" as const,
        sequenceId: "child",
        start: 789,
        duration: 2 * T + 1001,
        timeMap: {
          points: [
            { time: 0, source: 0 },
            { time: 2 * T + 1001, source: 2 * T + 1001 },
          ],
        },
      },
    ],
  };
  delete (parent.clips[0] as any).assetId;
  doc.sequences.unshift(parent);
  const before = validateEditorDocument(doc),
    next = applyEditorOperations(
      before,
      planApplyAudioEnhancement(before, "child", "clip", audioEnhancementReceipt(raw()), ids()),
      0,
    );
  assert.deepEqual(next.sequences[0], before.sequences[0]);
  assert.deepEqual(
    next.sequences[1]!.clips.find((c) => c.id === "caption"),
    before.sequences[1]!.clips[1],
  );
  assert.throws(() => audioEnhancementSource(before, "main", "wrapper"), /复合片段/);
});
test("locked tracks and missing source ranges reject atomically", () => {
  const doc = fixture(),
    result = audioEnhancementReceipt(raw());
  doc.sequences[0]!.tracks[0]!.locked = true;
  assert.throws(() => planApplyAudioEnhancement(doc, "main", "clip", result), /锁/);
  doc.sequences[0]!.tracks[0]!.locked = false;
  assert.throws(
    () =>
      planApplyAudioEnhancement(doc, "main", "clip", {
        ...result,
        duration: 3 * T,
        sampleCount: 3 * 48000,
      }),
    /完整源区间/,
  );
});
test("controller keeps one authority through save failure, retry, Undo and cancelled late native results", async () => {
  let stored = fixture(),
    revision = 1,
    fail = false;
  const session = await EditorSession.open(
    {
      read: async () => ({ data: stored, revision }),
      write: async (doc, base) => {
        assert.equal(base, revision);
        if (fail) throw new Error("磁盘失败");
        stored = structuredClone(doc);
        return { revision: ++revision };
      },
      backupLegacy: async () => {},
    },
    { autosaveDelayMs: 60000 },
  );
  let complete!: () => void,
    pending = false;
  const controller = createAudioEnhancementController({
    session: () => session,
    guard() {},
    idFactory: ids(),
    bridge: {
      dispose() {},
      enhance: async (_id: string, _duration: number, received: any, options: any) => {
        assert.deepEqual(received, settings);
        options.onTask({ id: "job" });
        if (pending)
          await new Promise<void>((resolve) => {
            complete = resolve;
          });
        return audioEnhancementReceipt(raw());
      },
    } as any,
    apply: (ops, identity, label) => session.dispatchDurable(ops, identity, label),
  });
  try {
    assert.deepEqual(await controller.startInBackground("main", "clip", settings), {
      taskId: "job",
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(controller.getState().phase, "preview");
    fail = true;
    await assert.rejects(controller.apply(), /磁盘失败/);
    assert.equal(session.read().revision, 0);
    assert.ok(controller.getState().candidate);
    fail = false;
    await controller.apply();
    assert.equal(session.read().sequences[0]!.clips.length, 3);
    session.undo();
    assert.deepEqual(session.read().sequences, fixture().sequences);
    pending = true;
    const work = controller.start("main", "clip", settings);
    controller.cancel();
    complete();
    await work;
    assert.equal(controller.getState().candidate, undefined);
  } finally {
    controller.dispose();
    await session.close({ save: false });
  }
});
test("SDK enhancer uses existing media runtime with authentic resource mapping and never sends project frame projections", async () => {
  let start: any;
  const job = {
    id: "native",
    entry: { name: "media-runtime" },
    input: { request: { action: "audio-enhance", params: { assetId: source } } },
    status: "succeeded",
    attempt: 1,
    createdAt: 1,
    updatedAt: 1,
    result: { result: raw() },
  };
  const bridge = createAudioEnhancementBridge({
    getContext: async () => ({
      cwd: "/project",
      availableMethods: ["tasks.start", "tasks.get", "tasks.cancel", "resources.get"],
      capabilities: { bridge: { maxCallsPerWindow: 1000 } },
    }),
    on: () => () => {},
    async call(method, params) {
      if (method === "tasks.start") {
        start = params;
        return job;
      }
      if (method === "tasks.get") return job;
      throw new Error(method);
    },
  });
  try {
    const result = await bridge.enhance(source, 10 * T + 25, settings);
    assert.equal(result.duration, 10 * T + 25);
    assert.equal(start.entry, "media-runtime");
    assert.equal(start.recovery, "retry");
    assert.deepEqual(start.input.request, {
      action: "audio-enhance",
      params: { assetId: source, ...settings },
      inputs: { [source]: "inputs/source.bin" },
    });
    assert.deepEqual(start.input.resources, [{ assetId: source, path: "inputs/source.bin" }]);
    assert.deepEqual(await bridge.resume("native", { sourceResourceId: source }), result);
  } finally {
    bridge.dispose();
  }
});
test("legacy enhancement completion uses the canonical receipt callback, retains failed publication and never projects an audio replacement", async () => {
  const legacy = validateProject({
    ...createProject(),
    assets: [{ id: "source", name: "原声", kind: "video", mediaId: source, durationFrames: 300 }],
    clips: [{ id: "clip", assetId: "source", inFrame: 0, outFrame: 300, volume: 1 }],
  });
  let document: any = null,
    revision = 0,
    fail = true,
    receipts = 0;
  const job = {
    id: "job-enhancement",
    type: "audio-enhance",
    status: "succeeded",
    createdAt: 1,
    updatedAt: 1,
    attempt: 1,
    result: raw(),
  };
  const controller = new ProductionController(
    {
      getContext: async () => ({}),
      registerTool: () => () => {},
      on: () => () => {},
      async call(method: string, params: any) {
        if (method === "media.status")
          return {
            persistent: true,
            ffmpeg: { available: true },
            transcription: { available: false },
            hyperframes: { available: false },
          };
        if (method === "media.document.get") return { data: document, revision };
        if (method === "media.document.set") {
          assert.equal(params.baseRevision, revision);
          document = structuredClone(params.data);
          return { revision: ++revision };
        }
        if (method === "media.jobs.list") return { jobs: [job] };
        if (method === "media.jobs.get" || method === "media.audio.enhance") return job;
        throw new Error(method);
      },
    } as any,
    {
      getProject: () => legacy,
      publishAssets: async () => assert.fail("canonical completion must not use legacy placement"),
      publishAudioEnhancement: async (projectId, result, context) => {
        receipts++;
        assert.equal(projectId, legacy.id);
        assert.equal(result.duration, 10 * T + 25);
        assert.equal(context.asset.durationFrames, 300);
        assert.equal(context.jobId, job.id);
        if (fail) throw new Error("保存失败");
      },
      changed() {},
    },
  );
  try {
    await controller.initialize();
    await controller.enhanceAudio("source", settings);
    await assert.rejects(controller.refresh(), /保存失败/);
    assert.match(controller.error, /保存失败/);
    assert.equal(
      Object.values(document.bindings).some((binding: any) => binding.consumed),
      false,
    );
    fail = false;
    await controller.refresh();
    assert.ok(receipts >= 2);
    assert.equal(
      Object.values(document.bindings).some((binding: any) => binding.consumed),
      true,
    );
    assert.equal(legacy.clips[0]!.volume, 1);
  } finally {
    controller.dispose();
  }
});

test("precise existing optimized asset is reused and ducking follows the derived track without changing other uses", () => {
  const doc = fixture(),
    seq = doc.sequences[0]!,
    result = audioEnhancementReceipt(raw());
  doc.assets.push(enhancedEditorAsset(result, "已优化", "existing"));
  seq.tracks.push(createTrack("bed", "audio"));
  const original = seq.clips[0] as MediaClip;
  seq.clips.push({
    ...structuredClone(original),
    id: "bed-clip",
    trackId: "bed",
    audio: {
      ...defaultAudioMix(),
      ducking: {
        sidechainTrackIds: ["v"],
        thresholdDb: -30,
        attenuationDb: 10,
        attack: 2400,
        release: 4800,
      },
    },
  });
  const before = structuredClone(doc),
    ops = planApplyAudioEnhancement(doc, "main", "clip", result, ids()),
    next = applyEditorOperations(doc, ops, 0),
    derived = next.sequences[0]!.clips.find(
      (c) => !before.sequences[0]!.clips.some((old) => old.id === c.id),
    ) as MediaClip;
  assert.equal(
    ops.some((op) => op.type === "asset.add"),
    false,
  );
  assert.equal(derived.assetId, "existing");
  assert.equal(next.assets[1]!.duration, 10 * T + 25);
  const bed = next.sequences[0]!.clips.find((c) => c.id === "bed-clip") as MediaClip;
  assert.deepEqual(bed.audio.ducking!.sidechainTrackIds, ["v", derived.trackId]);
  assert.deepEqual(bed.timeMap, original.timeMap);
  seq.tracks.find((t) => t.id === "bed")!.locked = true;
  assert.throws(() => planApplyAudioEnhancement(doc, "main", "clip", result, ids()), /锁|locked/);
  assert.equal((seq.clips[0] as MediaClip).audio.volume instanceof Object, true);
});
