import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createEditorTaskBridge,
  editorTaskDocument,
  EDITOR_TASK_LIMITS,
  isEditorDemoNarration,
} from "../apps/video-studio/src/editor/task-bridge";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import { constantTimeMap } from "../apps/video-studio/src/editor/time";
import type { EditorDocument, MediaClip } from "../apps/video-studio/src/editor/types";
import type { RuntimeBridge, RuntimeJob } from "../apps/video-studio/src/sdk/panel-runtime";
import { validateEditorRequest } from "../apps/video-studio/native/editor-runtime/protocol";
import { createExportPresets } from "../apps/video-studio/src/editor/export-settings";
const resource = (index: number) => `asset-${index.toString(16).padStart(64, "0")}`;
function document(count = 1): EditorDocument {
  return {
    schemaVersion: 2,
    timebase: 240000,
    id: "doc",
    name: "Tasks",
    revision: 0,
    assets: Array.from({ length: count }, (_, i) => ({
      id: `source-${i}`,
      name: `Source ${i}`,
      kind: "video",
      duration: 240000,
      width: 64,
      height: 64,
      resourceId: resource(i),
    })),
    activeSequenceId: "main",
    exportProfiles: [],
    sequences: [
      {
        id: "main",
        name: "Main",
        width: 64,
        height: 64,
        frameRate: { numerator: 30, denominator: 1 },
        background: "#000000",
        timelineMode: "free",
        tracks: [createTrack("video", "video")],
        markers: [],
        transitions: [],
        clips: Array.from(
          { length: count },
          (_, i) =>
            ({
              id: `clip-${i}`,
              label: "clip",
              kind: "media",
              assetId: `source-${i}`,
              trackId: "video",
              start: i * 240000,
              duration: 240000,
              timeMap: constantTimeMap(0, 240000).timeMap,
              audio: defaultAudioMix(),
              transform: defaultTransform(),
              color: defaultColorAdjustment(),
              blendMode: "normal",
            }) as MediaClip,
        ),
      },
    ],
  };
}
function mock() {
  let cwd = "/project",
    counter = 0;
  const calls: any[] = [],
    jobs = new Map<string, RuntimeJob>(),
    staged = new Set<string>(),
    chunks = new Set<number>();
  let committed: string | undefined;
  const raw: RuntimeBridge = {
    getContext: async () => ({
      cwd,
      availableMethods: [
        "tasks.start",
        "tasks.get",
        "tasks.cancel",
        "tasks.retry",
        "resources.get",
      ],
      capabilities: {
        tasks: { maxInputBytes: 2 * 1024 * 1024 },
        bridge: { maxCallsPerWindow: 10000 },
      },
    }),
    on: () => () => {},
    async call(method, params: any) {
      calls.push({ method, params });
      if (method === "tasks.start") {
        const r = params.input.request;
        let result: any;
        if (r.action === "stage-status")
          result = {
            resourceIds: r.resourceIds.filter((id: string) => staged.has(id)),
            chunks: [...chunks],
            ...(committed ? { committedDocumentHash: committed, sequenceId: "main" } : {}),
          };
        else if (r.action === "stage-resources") {
          r.resourceIds.forEach((id: string) => staged.add(id));
          result = {};
        } else if (r.action === "stage-document") {
          chunks.add(r.chunkIndex);
          result = {};
        } else if (r.action === "commit") {
          committed = r.documentHash;
          result = { documentHash: committed, sequenceId: r.sequenceId };
        } else if (r.action === "prepare-audio")
          result = {
            preparedAudio: {
              documentHash: r.documentHash,
              sequenceId: r.sequenceId,
              recipeHash: "b".repeat(64),
              assetId: resource(999),
            },
            audio: {
              id: resource(999),
              sha256: resource(999).slice(6),
              bytes: 48044,
              mimeType: "audio/wav",
            },
            sampleCount: 48000,
            peak: 0,
            samplesOverFullScale: 0,
            reused: false,
            report: { id: resource(998) },
          };
        else if (r.action === "prepare-video")
          result = {
            documentHash: r.documentHash,
            sequenceId: r.sequenceId,
            sources: r.assetIds.map((assetId: string) => ({
              assetId,
              proxy: {
                id: resource(997),
                sha256: resource(997).slice(6),
                bytes: 1000,
                mimeType: "video/mp4",
              },
              recipe: { width: 64, height: 64, sha256: resource(997).slice(6) },
            })),
          };
        const job: RuntimeJob = {
          id: `job-${++counter}`,
          status: "succeeded",
          attempt: 1,
          createdAt: 0,
          updatedAt: 0,
          result: { result },
        };
        jobs.set(job.id, job);
        return { job };
      }
      if (method === "tasks.get") return { job: jobs.get(params.id) };
      if (method === "tasks.cancel")
        return { job: { ...jobs.get(params.id), status: "cancelled" } };
      throw new Error(method);
    },
  };
  return {
    raw,
    calls,
    staged,
    chunks,
    setCwd(value: string) {
      cwd = value;
    },
    setCommitted(value: string) {
      committed = value;
    },
  };
}
test("task document preserves reachable nested sources and excludes unrelated sequences", () => {
  const d = document(2);
  const other = structuredClone(d.sequences[0]!);
  other.id = "unused";
  other.clips = [];
  d.sequences.push(other);
  d.sequences[0]!.clips.pop();
  const result = editorTaskDocument(d, "main");
  assert.deepEqual(result.resourceIds, [resource(0)]);
  assert.equal(result.document.sequences.length, 1);
  assert.equal(result.document.assets.length, 1);
  assert.equal(d.assets.length, 2);
  delete d.assets[0]!.resourceId;
  assert.throws(() => editorTaskDocument(d, "main"), /尚未保存/);
});
test("129 resources stage as bounded immutable batches and resumable status reads are fresh", async () => {
  const m = mock(),
    bridge = createEditorTaskBridge(m.raw),
    d = document(129);
  const snapshot = await bridge.stage(d, "main");
  const starts = m.calls.filter((c) => c.method === "tasks.start").map((c) => c.params);
  assert.deepEqual(
    starts
      .filter((c) => c.input.request.action === "stage-resources")
      .map((c) => c.input.resources.length),
    [128, 1],
  );
  for (const call of starts) {
    assert.ok(Buffer.byteLength(JSON.stringify(call)) < EDITOR_TASK_LIMITS.inputBytes);
    assert.equal(call.entry, "editor-runtime");
    assert.equal(call.input.request.scopeKey, undefined);
    assert.equal(call.input.request.jobId, undefined);
    assert.deepEqual(call.input.directoryArguments, [
      { argumentName: "--job-dir", directory: "job" },
      { argumentName: "--runtime-dir", directory: "app-data", path: "runtime/editor-v2" },
    ]);
    if (call.input.request.action === "stage-status") assert.equal(call.requestKey, undefined);
    else assert.match(call.requestKey, /editor-v2:[a-f0-9]{64}/);
  }
  const before = m.calls.length;
  await bridge.stage(d, "main", { transferId: snapshot.transferId });
  const resumed = m.calls
    .slice(before)
    .filter((c) => c.method === "tasks.start")
    .map((c) => c.params.input.request.action);
  assert.deepEqual(resumed, ["stage-status", "stage-status", "commit"]);
  bridge.dispose();
});
test("large canonical document travels as independent sub-2MiB requests", async () => {
  const m = mock(),
    bridge = createEditorTaskBridge(m.raw),
    d = document();
  d.production = { notes: Array.from({ length: 30 }, () => "文".repeat(35000)) };
  const snapshot = await bridge.stage(d, "main");
  assert.ok(snapshot.byteLength > 2 * 1024 * 1024);
  assert.ok(snapshot.chunkCount > 4);
  for (const c of m.calls.filter((c) => c.method === "tasks.start")) {
    assert.ok(Buffer.byteLength(JSON.stringify(c.params)) < 2 * 1024 * 1024);
    if (c.params.input.request.action === "stage-document")
      assert.ok(Buffer.from(c.params.input.request.dataBase64, "base64").length <= 512 * 1024);
  }
  bridge.dispose();
});
test("the final render guard runs after staging and prevents a revoked production from starting", async () => {
  const m = mock(),
    bridge = createEditorTaskBridge(m.raw);
  await assert.rejects(
    bridge.startExport(document(), "main", createExportPresets()[0]!, {
      beforeSubmit() {
        assert.ok(m.calls.some((call) => call.params?.input?.request?.action === "commit"));
        throw new Error("制作已取消");
      },
    }),
    /制作已取消/,
  );
  assert.equal(
    m.calls.filter((call) => call.params?.input?.request?.action === "render").length,
    0,
  );
  bridge.dispose();
});
test("a render task created during cancellation still returns its actual ID for owned cancellation", async () => {
  const m = mock(),
    abort = new AbortController(),
    original = m.raw.call;
  m.raw.call = async (method, params: any) => {
    const value = await original(method, params);
    if (method === "tasks.start" && params.input.request.action === "render") {
      abort.abort();
      m.setCwd("/new-project");
    }
    return value;
  };
  const bridge = createEditorTaskBridge(m.raw);
  const result = await bridge.startExport(document(), "main", createExportPresets()[0]!, {
    signal: abort.signal,
  });
  assert.match(result.job.id, /^job-/);
  assert.equal(abort.signal.aborted, true);
  assert.equal(
    m.calls.filter((call) => call.params?.input?.request?.action === "render").length,
    1,
  );
  bridge.dispose();
});
test("high-level preview exposes resource audio and shares frozen snapshot with video preparation", async () => {
  const m = mock(),
    bridge = createEditorTaskBridge(m.raw),
    d = document();
  const audio = await bridge.prepareAudioForPreview(d, "main");
  assert.equal(audio.audioResource.id, resource(999));
  assert.equal(audio.sampleCount, 48000);
  const videos = await bridge.prepareVideoForPreview(d, "main", { snapshot: audio.snapshot });
  assert.equal(videos.sources[0]?.assetId, "source-0");
  assert.equal(videos.sources[0]?.recipe.width, 64);
  d.revision++;
  await assert.rejects(
    bridge.prepareAudioForPreview(d, "main", { snapshot: audio.snapshot }),
    /当前工程/,
  );
  await assert.rejects(
    bridge.render(audio.snapshot, {} as any, {
      preparedAudio: { ...audio.preparedAudio, documentHash: "a".repeat(64) },
    }),
    /不一致/,
  );
  m.setCwd("/elsewhere");
  await assert.rejects(bridge.prepareAudio(audio.snapshot), { name: "AbortError" });
  bridge.dispose();
});
test("changed committed transfer, cancellation and unavailable Host methods fail clearly", async () => {
  const m = mock(),
    bridge = createEditorTaskBridge(m.raw);
  m.setCommitted("a".repeat(64));
  await assert.rejects(bridge.stage(document(), "main"), /快照已提交/);
  bridge.dispose();
  const n = mock(),
    other = createEditorTaskBridge(n.raw),
    signal = AbortSignal.abort();
  await assert.rejects(other.stage(document(), "main", { signal }), { name: "AbortError" });
  assert.equal(n.calls.length, 0);
  other.dispose();
  const unavailable = createEditorTaskBridge({
    ...n.raw,
    getContext: async () => ({ cwd: "/project", availableMethods: [] }),
  });
  await assert.rejects(unavailable.stage(document(), "main"), /缺少通用/);
  unavailable.dispose();
});
test("only exact built-in narration can omit a Host resource", () => {
  const d = document();
  d.assets[0] = {
    id: "demo-narration-v1",
    name: "示例旁白 · 从想法，到成片。",
    kind: "audio",
    duration: 24 * 240000,
    metadata: { mimeType: "audio/mpeg" },
  };
  d.sequences[0]!.tracks = [createTrack("video", "audio")];
  const clip = d.sequences[0]!.clips[0] as MediaClip;
  clip.assetId = d.assets[0]!.id;
  assert.equal(isEditorDemoNarration(d.assets[0]!), true);
  assert.deepEqual(editorTaskDocument(d, "main").resourceIds, []);
  d.assets[0]!.duration--;
  assert.throws(() => editorTaskDocument(d, "main"), /尚未保存/);
});
test("native request schema rejects paths, prototype fields, unsupported actions and oversized material lists", () => {
  const base = {
    action: "stage-status",
    transferId: "editor-00000000-0000-4000-8000-000000000000",
    documentHash: "a".repeat(64),
    resourceIds: [],
  };
  assert.equal(validateEditorRequest(base).action, "stage-status");
  for (const key of ["path", "ffmpegPath", "runtimeSource", "scopeKey", "jobId", "__proto__"]) {
    assert.throws(() => validateEditorRequest({ ...base, [key]: "/tmp/anything" }));
  }
  assert.throws(() =>
    validateEditorRequest({
      ...base,
      resourceIds: Array.from({ length: 129 }, (_, i) => resource(i)),
    }),
  );
  assert.throws(() => validateEditorRequest({ ...base, resourceIds: new Array(1) }));
  assert.throws(() => validateEditorRequest({ ...base, transferId: "../escape" }));
  assert.throws(() => validateEditorRequest({ ...base, action: "exec" }));
});
