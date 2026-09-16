import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  planApplySeparation,
  separationSource,
  validateSeparationResult,
  SEPARATION_MODEL_ID,
  type SeparationResult,
} from "../apps/video-studio/src/editor/separation";
import { createSeparationController } from "../apps/video-studio/src/editor/separation-controller";
import { createAudioSeparationBridge } from "../apps/video-studio/src/editor/separation-bridge";
import { EditorSession } from "../apps/video-studio/src/editor/session";
import { applyEditorOperations } from "../apps/video-studio/src/editor/operations";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import { validateEditorDocument } from "../apps/video-studio/src/editor/validation";
import {
  validateSeparationRequest,
  runSeparationRequest,
  SEPARATION_MODEL,
} from "../apps/video-studio/native/separation/runtime";
import type { EditorDocument, MediaClip } from "../apps/video-studio/src/editor/types";
const T = 240000,
  assetId = `asset-${"a".repeat(64)}`;
function result(): SeparationResult {
  return {
    sourceResourceId: assetId,
    sourceSha256: "a".repeat(64),
    modelId: SEPARATION_MODEL_ID,
    modelSha256: SEPARATION_MODEL.sha256,
    sampleRate: 44100,
    sampleCount: 10 * 44100,
    durationSeconds: 10,
    stems: {
      vocals: {
        assetId: `asset-${"b".repeat(64)}`,
        sha256: "b".repeat(64),
        bytes: 3528080,
        mimeType: "audio/wav",
      },
      instrumental: {
        assetId: `asset-${"c".repeat(64)}`,
        sha256: "c".repeat(64),
        bytes: 3528080,
        mimeType: "audio/wav",
      },
    },
  };
}
function fixture(): EditorDocument {
  return validateEditorDocument({
    schemaVersion: 2,
    timebase: T,
    id: "separation",
    revision: 0,
    name: "分离",
    activeSequenceId: "main",
    exportProfiles: [],
    assets: [{ id: "source", name: "原片", kind: "video", duration: 10 * T, resourceId: assetId }],
    sequences: [
      {
        id: "main",
        name: "主序列",
        width: 640,
        height: 360,
        frameRate: { numerator: 30000, denominator: 1001 },
        background: "#000000",
        timelineMode: "free",
        tracks: [createTrack("v", "video")],
        clips: [
          {
            id: "clip",
            trackId: "v",
            kind: "media",
            assetId: "source",
            start: 12345,
            duration: 2 * T,
            label: "片段",
            transform: {
              ...defaultTransform(),
              x: {
                keyframes: [
                  { time: 0, value: 0 },
                  { time: 2 * T, value: 0.4 },
                ],
              },
            },
            color: defaultColorAdjustment(),
            blendMode: "normal",
            audio: {
              ...defaultAudioMix(),
              volume: {
                keyframes: [
                  { time: 0, value: 0.4 },
                  { time: 2 * T, value: 1 },
                ],
              },
              fadeIn: 1001,
              fadeOut: 2002,
            },
            timeMap: {
              points: [
                { time: 0, source: 6 * T },
                { time: T, source: 4 * T },
                { time: 2 * T, source: 5 * T },
              ],
            },
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
  return () => `added-${++n}`;
};
async function session() {
  let data = fixture(),
    revision = 1,
    fail = false;
  const value = await EditorSession.open(
    {
      read: async () => ({ data, revision }),
      write: async (doc, base) => {
        if (fail) throw new Error("保存失败");
        assert.equal(base, revision);
        data = structuredClone(doc);
        return { revision: ++revision };
      },
      backupLegacy: async () => {},
    },
    { autosaveDelayMs: 60000 },
  );
  return {
    value,
    fail: (v: boolean) => {
      fail = v;
    },
  };
}
test("separated tracks retain exact reverse/curve ticks, fades, automation and effective track mix", () => {
  const doc = fixture(),
    original = structuredClone(doc.sequences[0]!.clips[0]) as MediaClip;
  doc.sequences[0]!.tracks[0]!.volume = 0.65;
  doc.sequences[0]!.tracks[0]!.pan = -0.2;
  const ops = planApplySeparation(doc, "main", "clip", result(), "both", ids()),
    next = applyEditorOperations(doc, ops, 0),
    clips = next.sequences[0]!.clips as MediaClip[];
  assert.equal(next.revision, 1);
  assert.equal(clips.length, 3);
  assert.equal(doc.sequences[0]!.clips.length, 1);
  assert.deepEqual(clips[0]!.transform, original.transform);
  assert.equal(clips[0]!.audio.volume, 0);
  for (const clip of clips.slice(1)) {
    assert.equal(clip.start, 12345);
    assert.deepEqual(clip.timeMap, original.timeMap);
    assert.deepEqual(clip.audio, original.audio);
    assert.equal(clip.linkGroupId, clips[0]!.linkGroupId);
    const track = next.sequences[0]!.tracks.find((t) => t.id === clip.trackId)!;
    assert.equal(track.volume, 0.65);
    assert.equal(track.pan, -0.2);
  }
  assert.deepEqual(next.assets[0], doc.assets[0]);
  assert.equal(next.assets.length, 3);
});
test("single stem is an atomic durable step; failed save keeps candidate and original, retry and Undo restore everything", async () => {
  const { value, fail } = await session(),
    original = value.read();
  let calls = 0;
  const controller = createSeparationController({
    session: () => value,
    bridge: {
      dispose() {},
      separate: async () => {
        calls++;
        return result();
      },
    } as any,
    guard() {},
    apply: (ops, identity, label) => value.dispatchDurable(ops, identity, label),
    idFactory: ids(),
  });
  try {
    await controller.start("main", "clip");
    assert.equal(controller.getState().phase, "preview");
    assert.deepEqual(value.read(), original);
    fail(true);
    await assert.rejects(controller.apply("vocals"), /保存失败/);
    assert.deepEqual(value.read(), original);
    assert.ok(controller.getState().candidate);
    fail(false);
    await controller.apply("vocals");
    assert.equal(calls, 1);
    assert.equal(value.read().sequences[0]!.clips.length, 2);
    value.undo();
    const undone = value.read();
    assert.deepEqual(undone.assets, original.assets);
    assert.deepEqual(undone.sequences, original.sequences);
  } finally {
    controller.dispose();
    fail(false);
    await value.close({ save: false });
  }
});
test("dependent music ducking follows separated voice tracks and respects locked dependents atomically", () => {
  const doc = fixture(),
    sequence = doc.sequences[0]!;
  doc.assets.push({ id: "music", name: "背景音乐", kind: "audio", duration: 10 * T });
  sequence.tracks.push(createTrack("bed", "audio"));
  sequence.clips.push({
    ...(structuredClone(sequence.clips[0]!) as MediaClip),
    id: "bed-clip",
    assetId: "music",
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
  const next = applyEditorOperations(
    doc,
    planApplySeparation(doc, "main", "clip", result(), "both", ids()),
    0,
  );
  const added = next.sequences[0]!.clips.filter(
    (clip) => clip.id !== "clip" && clip.id !== "bed-clip",
  );
  assert.deepEqual(
    (next.sequences[0]!.clips.find((clip) => clip.id === "bed-clip") as MediaClip).audio.ducking!
      .sidechainTrackIds,
    ["v", ...added.map((clip) => clip.trackId)],
  );
  sequence.tracks.find((track) => track.id === "bed")!.locked = true;
  assert.throws(() => planApplySeparation(doc, "main", "clip", result(), "both", ids()), /锁/);
  assert.notEqual((sequence.clips[0]! as MediaClip).audio.volume, 0);
});
test("locked tracks, foreign receipts, incompatible lengths and nested wrappers reject before mutation", () => {
  const doc = fixture();
  doc.sequences[0]!.tracks[0]!.locked = true;
  assert.throws(() => separationSource(doc, "main", "clip"), /解锁/);
  doc.sequences[0]!.tracks[0]!.locked = false;
  const bad = result();
  bad.sourceResourceId = `asset-${"d".repeat(64)}`;
  bad.sourceSha256 = "d".repeat(64);
  assert.throws(() => planApplySeparation(doc, "main", "clip", bad, "vocals"), /不属于/);
  const short = result();
  short.sampleCount -= 441;
  short.durationSeconds = short.sampleCount / short.sampleRate;
  assert.throws(() => planApplySeparation(doc, "main", "clip", short, "vocals"), /长度/);
  assert.throws(() => separationSource(doc, "main", "missing"), /原始视频或音频/);
});
test("result and native request validation reject missing stems, paths, code, nonfinite ranges and extra setup arguments", () => {
  const good = result();
  assert.deepEqual(validateSeparationResult(good), good);
  good.stems.vocals.bytes = NaN;
  assert.throws(() => validateSeparationResult(good));
  assert.throws(() =>
    validateSeparationResult({ ...result(), stems: { vocals: result().stems.vocals } }),
  );
  for (const request of [
    { action: "setup", resourceId: assetId },
    { action: "separate", resourceId: "/tmp/source.wav", duration: T },
    { action: "separate", resourceId: assetId, duration: NaN },
    { action: "setup", python: "evil" },
    Object.assign(Object.create({ polluted: true }), { action: "status" }),
  ])
    assert.throws(() => validateSeparationRequest(request));
  assert.deepEqual(
    validateSeparationRequest({ action: "separate", resourceId: assetId, duration: T }),
    { action: "separate", resourceId: assetId, duration: T },
  );
});
test("missing native dependencies report unavailable without downloading or touching source files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "separation-status-"));
  try {
    const out = await runSeparationRequest(
      { action: "status" },
      {
        jobDir: dir,
        runtimeDir: dir,
        signal: new AbortController().signal,
        reportProgress() {},
        tools: { ffmpegPath: join(dir, "missing") },
      },
    );
    assert.equal(out.result.state, "unavailable");
    assert.deepEqual(out.artifacts, []);
    await assert.rejects(
      runSeparationRequest(
        { action: "status" },
        { jobDir: dir, runtimeDir: dir, signal: AbortSignal.abort(), reportProgress() {} },
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("cancellation and changed document discard late results even when the processor ignores abort", async () => {
  for (const stale of [false, true]) {
    const { value } = await session();
    let finish!: (value: SeparationResult) => void, signal: AbortSignal | undefined;
    const controller = createSeparationController({
      session: () => value,
      bridge: {
        dispose() {},
        separate: async (_id: string, _duration: number, options: any) => {
          signal = options.signal;
          return new Promise<SeparationResult>((resolve) => {
            finish = resolve;
          });
        },
      } as any,
      guard() {},
      apply: async () => assert.fail("must not apply"),
    });
    try {
      const pending = controller.start("main", "clip");
      if (stale)
        value.dispatch(
          [{ type: "project.rename", name: "新工程名" }],
          value.read().revision,
          "rename",
        );
      else controller.cancel();
      assert.equal(signal!.aborted, true);
      finish(result());
      await pending;
      assert.equal(controller.getState().phase, stale ? "stale" : "cancelled");
      assert.equal(controller.getState().candidate, undefined);
    } finally {
      controller.dispose();
      await value.close({ save: false });
    }
  }
});
test("session restore generation and production lock prevent consuming a stale result", async () => {
  const { value } = await session();
  let locked = false;
  const controller = createSeparationController({
    session: () => value,
    bridge: { dispose() {}, separate: async () => result() } as any,
    guard() {
      if (locked) throw new Error("录制中");
    },
    apply: async () => assert.fail("must not apply"),
  });
  try {
    await controller.start("main", "clip");
    locked = true;
    await assert.rejects(controller.apply("both"), /录制中/);
    assert.ok(controller.getState().candidate);
    locked = false;
    await value.replace(value.read(), { label: "restore" });
    assert.equal(controller.getState().phase, "stale");
    assert.equal(controller.getState().candidate, undefined);
  } finally {
    controller.dispose();
    await value.close({ save: false });
  }
});
test("SDK bridge uses existing durable task schema, authentic resource paths and unchanged high precision ticks", async () => {
  const calls: Array<{ method: string; params: any }> = [];
  let current: any;
  const bridge = createAudioSeparationBridge({
    getContext: async () => ({
      cwd: "/workspace",
      availableMethods: ["tasks.start", "tasks.get", "tasks.cancel", "resources.get"],
      capabilities: { bridge: { maxCallsPerWindow: 1000 } },
    }),
    on: () => () => {},
    async call(method, params: any) {
      calls.push({ method, params });
      if (method === "tasks.start") {
        current = {
          id: "job",
          entry: { name: "audio-separation" },
          status: "succeeded",
          attempt: 1,
          updatedAt: 1,
          createdAt: 1,
          input: { request: { action: "separate", resourceId: assetId } },
          result: { result: result() },
        };
        return current;
      }
      if (method === "tasks.get") return current;
      throw new Error(method);
    },
  });
  try {
    const out = await bridge.separate(assetId, 2402400);
    assert.deepEqual(out, result());
    const start = calls.find((c) => c.method === "tasks.start")!.params;
    assert.equal(start.entry, "audio-separation");
    assert.equal(start.recovery, "retry");
    assert.deepEqual(start.input.resources, [{ assetId, path: "inputs/source.bin" }]);
    assert.equal(start.input.request.duration, 2402400);
    assert.deepEqual(await bridge.resume("job"), result());
    current.entry.name = "editor-runtime";
    await assert.rejects(bridge.resume("job"), /不是/);
  } finally {
    bridge.dispose();
  }
});
test("background calls return only the newly accepted task receipt, keep processing and never auto apply", async () => {
  const { value } = await session();
  let finish!: (value: SeparationResult) => void;
  const controller = createSeparationController({
    session: () => value,
    bridge: {
      dispose() {},
      separate: async (_id: string, _duration: number, options: any) => {
        options.onTask({ id: "background-1" });
        return new Promise<SeparationResult>((resolve) => {
          finish = resolve;
        });
      },
    } as any,
    guard() {},
    apply: async () => assert.fail("must not apply"),
  });
  try {
    assert.deepEqual(await controller.startInBackground("main", "clip"), {
      taskId: "background-1",
    });
    assert.equal(controller.getState().phase, "running");
    await assert.rejects(controller.startInBackground("main", "clip"), /等待|取消/);
    assert.equal(value.read().revision, 0);
    finish(result());
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(controller.getState().phase, "preview");
    await assert.rejects(controller.startInBackground("main", "missing"), /原始视频或音频/);
    assert.equal(controller.getState().taskId, "background-1");
  } finally {
    controller.dispose();
    await value.close({ save: false });
  }
});
test("existing tasks page through unrelated history and only retry the selected source's reviewed entry", async () => {
  let retried = 0,
    offset = -1;
  const good = {
    id: "good",
    entry: { name: "audio-separation" },
    status: "failed",
    createdAt: 1,
    updatedAt: 1,
    attempt: 1,
    input: { request: { action: "separate", resourceId: assetId } },
    error: { retryable: true, message: "interrupted" },
  };
  const bridge = createAudioSeparationBridge({
    getContext: async () => ({
      cwd: "/w",
      availableMethods: ["tasks.list", "tasks.get", "tasks.retry", "resources.get"],
      capabilities: { bridge: { maxCallsPerWindow: 1000 } },
    }),
    on: () => () => {},
    async call(method, params: any) {
      if (method === "tasks.list") {
        offset = params.offset;
        return [
          { id: "unrelated", entry: { name: "editor-runtime" } },
          good,
          { ...good, id: "foreign" },
        ];
      }
      if (method === "tasks.get")
        return params.id === "foreign"
          ? {
              ...good,
              input: { request: { action: "separate", resourceId: `asset-${"d".repeat(64)}` } },
            }
          : retried
            ? { ...good, status: "succeeded", result: { result: result() } }
            : good;
      if (method === "tasks.retry") {
        retried++;
        return { ...good, status: "running", attempt: 2 };
      }
      throw new Error(method);
    },
  });
  try {
    const page = await bridge.list(assetId, 50);
    assert.equal(offset, 50);
    assert.deepEqual(
      page.jobs.map((j) => j.id),
      ["good"],
    );
    assert.equal(page.nextOffset, 53);
    assert.equal(page.complete, true);
    await assert.rejects(
      bridge.resume("foreign", { retry: true, sourceResourceId: assetId }),
      /不属于/,
    );
    assert.equal(retried, 0);
    assert.deepEqual(
      await bridge.resume("good", { retry: true, sourceResourceId: assetId }),
      result(),
    );
    assert.equal(retried, 1);
  } finally {
    bridge.dispose();
  }
});
