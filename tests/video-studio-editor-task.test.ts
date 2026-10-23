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
import {
  publicEditorErrorMessage,
  validateEditorRequest,
} from "../apps/video-studio/native/editor-runtime/protocol";
import { createExportPresets } from "../apps/video-studio/src/editor/export-settings";
import {
  audioMixWarning,
  exportAudioMixWarning,
} from "../apps/video-studio/src/editor/audio-mix-report";
const resource = (index: number) => `asset-${index.toString(16).padStart(64, "0")}`;
test("mix warnings validate actual measurement bounds and export snapshot identity", () => {
  const measurement = { sampleCount: 48000, peak: 1.2, samplesOverFullScale: 120 };
  assert.match(audioMixWarning(measurement), /\+1\.6 dBFS.*降低音轨或片段音量/);
  assert.equal(audioMixWarning({ sampleCount: 48000, peak: 1, samplesOverFullScale: 0 }), "");
  assert.equal(audioMixWarning({ sampleCount: 0, peak: 0, samplesOverFullScale: 0 }), "");
  for (const report of [
    { ...measurement, peak: NaN },
    { ...measurement, peak: Infinity },
    { ...measurement, sampleCount: 0 },
    { ...measurement, samplesOverFullScale: -1 },
    { ...measurement, samplesOverFullScale: 48001 },
    { ...measurement, samplesOverFullScale: 1.5 },
    { ...measurement, samplesOverFullScale: 0 },
    { ...measurement, peak: 0.4 },
  ])
    assert.throws(() => audioMixWarning(report), /混音测量结果无效/);
  const request = { documentHash: "a".repeat(64), sequenceId: "main" };
  const result = { verified: true, audioMix: { ...measurement, ...request } };
  assert.match(exportAudioMixWarning(result, request), /可能导致失真/);
  assert.equal(exportAudioMixWarning(result, { ...request, documentHash: "b".repeat(64) }), "");
  assert.equal(exportAudioMixWarning(result, { ...request, sequenceId: "other" }), "");
  assert.equal(exportAudioMixWarning({ ...result, verified: false }, request), "");
  assert.equal(
    exportAudioMixWarning({ ...result, audioMix: { ...result.audioMix, peak: NaN } }, request),
    "",
  );
});
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
function mock(references = new Map<string, unknown>(), directRead = false) {
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
        tasks: { maxInputBytes: 2 * 1024 * 1024, ...(directRead ? { directRead: true } : {}) },
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
      if (method === "resources.get") {
        const reference = references.get(params.id);
        if (!reference) throw new Error("Resource not found");
        return { asset: reference };
      }
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
test("range exports validate before staging, retain the original snapshot and separate render request keys", async () => {
  const m = mock(), bridge = createEditorTaskBridge(m.raw), doc = document(),
    profile = createExportPresets()[0]!;
  for (const range of [
    { start: 240000, duration: 1 }, { start: 0, duration: 0 },
    { start: -1, duration: 8000 }, { start: 0.5, duration: 8000 },
  ]) await assert.rejects(bridge.startExport(doc, "main", profile, { range }));
  assert.equal(m.calls.length, 0);
  const snapshot = await bridge.stage(doc, "main"),
    first = { start: 1, duration: 80080 }, second = { start: 80085, duration: 80080 };
  await bridge.startExport(doc, "main", profile, { snapshot, range: first });
  await bridge.startExport(doc, "main", profile, { snapshot, range: second });
  await bridge.render(snapshot, profile);
  await bridge.render(snapshot, profile, { range: first });
  const requests = m.calls.filter((call) => call.params?.input?.request?.action === "render").map((call) => call.params);
  assert.deepEqual(requests.map((item) => item.input.request.range), [first, second, undefined, first]);
  assert.equal(new Set(requests.map((item) => item.requestKey)).size, 3);
  assert.equal(requests[0].requestKey, requests[3].requestKey);
  assert.ok(requests.every((item) => item.input.request.documentHash === snapshot.documentHash && item.input.request.sequenceId === "main"));
  const prepared = { documentHash: snapshot.documentHash, sequenceId: "main", recipeHash: "b".repeat(64), assetId: resource(999), range: first };
  await bridge.render(snapshot, profile, { range: first, preparedAudio: prepared });
  await assert.rejects(bridge.render(snapshot, profile, { range: second, preparedAudio: prepared }), /不一致/);
  await assert.rejects(bridge.render(snapshot, profile, { preparedAudio: prepared }), /不一致/);
  assert.equal(doc.sequences.length, 1);
  bridge.dispose();
});
test("only render requests accept a strict positive tick range", () => {
  const render = { action: "render", transferId: "editor-00000000-0000-0000-0000-000000000000", documentHash: "a".repeat(64), sequenceId: "main", profile: createExportPresets()[0]! };
  assert.deepEqual(validateEditorRequest({ ...render, range: { start: 1, duration: 80080 } }).range, { start: 1, duration: 80080 });
  assert.equal(Object.hasOwn(validateEditorRequest(render), "range"), false);
  const range = { start: 1, duration: 80080 }, preparedAudio = {
    documentHash: render.documentHash, sequenceId: "main", recipeHash: "b".repeat(64), assetId: resource(999), range,
  };
  assert.deepEqual(validateEditorRequest({ ...render, range, preparedAudio }).preparedAudio?.range, range);
  assert.throws(() => validateEditorRequest({ ...render, preparedAudio }), /混音|声音/);
  assert.throws(() => validateEditorRequest({ ...render, range: { start: 2, duration: 80080 }, preparedAudio }), /混音|声音/);
  for (const range of [null, [], { start: 0, duration: 0 }, { start: -1, duration: 1 }, { start: 1.5, duration: 1 }, { start: 0, duration: 1, source: "hidden" }, { start: 0, duration: Number.MAX_SAFE_INTEGER }])
    assert.throws(() => validateEditorRequest({ ...render, range }));
  for (const action of ["prepare-audio", "prepare-video", "commit", "discard"])
    assert.throws(() => validateEditorRequest({
      action, transferId: render.transferId, documentHash: render.documentHash, sequenceId: "main",
      ...(action === "prepare-video" ? { assetIds: ["source"] } : {}),
      ...(action === "commit" ? { chunkCount: 1, byteLength: 100 } : {}),
      range: { start: 0, duration: 8000 },
    }));
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
    range: { start: 80085, duration: 80080 },
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
test("direct originals remain sealed per launch while library resources and old Hosts use copies", async () => {
  const external = `external-${"e".repeat(64)}`;
  for (const enabled of [true, false]) {
    const m = mock(new Map([[external, { id: external, bytes: 123, state: "available" }]]), enabled),
      bridge = createEditorTaskBridge(m.raw), d = document(2);
    d.assets[0]!.resourceId = external;
    const audio = await bridge.prepareAudioForPreview(d, "main");
    await bridge.prepareVideoForPreview(d, "main", { snapshot: audio.snapshot });
    await bridge.render(audio.snapshot, createExportPresets()[0]!);
    await bridge.discard(audio.snapshot);
    const starts = m.calls.filter((item) => item.method === "tasks.start").map((item) => item.params.input);
    for (const input of starts) {
      const reads = input.resources.filter((item: any) => item.access === "read");
      assert.equal(input.originalsArgument, reads.length ? "--originals" : undefined);
      assert.ok(reads.every((item: any) => item.assetId === external && item.path === `original-${external}`));
      assert.ok(input.resources.filter((item: any) => item.assetId.startsWith("asset-")).every((item: any) => !item.access));
      assert.ok(!JSON.stringify(input).includes("/absolute/"));
    }
    for (const action of ["commit", "prepare-audio", "prepare-video", "render"]) {
      const input = starts.find((item) => item.request.action === action)!;
      assert.equal(input.resources.some((item: any) => item.access === "read"), enabled, action);
    }
    const staged = starts.find((item) => item.request.action === "stage-resources")!;
    assert.ok(staged.resources.some((item: any) => item.assetId.startsWith("asset-") && !item.access));
    assert.deepEqual(audio.snapshot.directReadResourceIds, enabled ? [external] : undefined);
    const discarded = starts.find((item) => item.request.action === "discard")!;
    assert.deepEqual(discarded.resources, [], "cleanup remains independent of moved or revoked originals");
    assert.equal(discarded.originalsArgument, undefined);
    bridge.dispose();
  }
});
test("a closure above the Host direct-read resource limit keeps copied staging", async () => {
  const m = mock(new Map(), true), bridge = createEditorTaskBridge(m.raw), d = document(129);
  d.assets.forEach((asset, index) => { asset.resourceId = `external-${index.toString(16).padStart(64, "0")}`; });
  const snapshot = await bridge.stage(d, "main");
  assert.equal(snapshot.directReadResourceIds, undefined);
  assert.ok(m.calls.filter((item) => item.method === "tasks.start").every((item) =>
    !item.params.input.originalsArgument && item.params.input.resources.every((resource: any) => !resource.access)));
  bridge.dispose();
});
test("preview staging says originals are being copied before the Host copy, and only the video job is the preview task", async () => {
  const m = mock(),
    bridge = createEditorTaskBridge(m.raw),
    d = document(2),
    tasks: string[] = [],
    changed: string[] = [],
    progress: unknown[] = [];
  const actions = () =>
    m.calls.filter((c) => c.method === "tasks.start").map((c) => c.params.input.request.action);
  await bridge.prepareVideoForPreview(d, "main", {
    onTask: (job) => tasks.push(actions()[Number(job.id.slice(4)) - 1]),
    // A staging job's progress must never drive the fast-preview percentage.
    onJobChanged: (job) => changed.push(actions()[Number(job.id.slice(4)) - 1]),
    // The Host copies each original inside tasks.start, before it returns any job.
    onProgress: (value) =>
      progress.push({ ...value, copyStarted: actions().includes("stage-resources") }),
  });
  assert.deepEqual(tasks, ["prepare-video"]);
  assert.deepEqual(changed, ["prepare-video"]);
  assert.deepEqual(progress[0], {
    phase: "resources",
    completed: 0,
    total: 2,
    copyStarted: false,
  });
  bridge.dispose();
});
test("a saved external original is offered for reuse only after the Host confirms the reference", async () => {
  const external = (index: number) => `external-${index.toString(16).padStart(64, "0")}`;
  const references = new Map<string, unknown>([
    [external(1), { id: external(1), kind: "external", bytes: 10, state: "available" }],
    [external(2), { id: external(2), kind: "external", bytes: 20, state: "changed" }],
    [external(4), { id: external(4), kind: "external", bytes: 40, state: "missing" }],
  ]);
  const m = mock(references),
    bridge = createEditorTaskBridge(m.raw),
    d = document(5);
  // external(3) was forgotten by the Host; asset ids are content-addressed and need no check.
  for (const index of [1, 2, 3, 4]) d.assets[index]!.resourceId = external(index);
  await bridge.stage(d, "main");
  const status = m.calls.find((c) => c.params?.input?.request?.action === "stage-status")!.params
    .input.request;
  assert.deepEqual(status.confirmedReferences, [{ resourceId: external(1), bytes: 10 }]);
  assert.deepEqual(validateEditorRequest(status).confirmedReferences, status.confirmedReferences);
  assert.deepEqual(
    m.calls.filter((c) => c.method === "resources.get").map((c) => c.params.id),
    [external(1), external(2), external(3), external(4)],
  );
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

test("unexpected native errors reach the Guest only without local paths", () => {
  assert.equal(publicEditorErrorMessage("音频轨道数量超过限制"), "音频轨道数量超过限制");
  for (const message of [
    "EPERM: operation not permitted, lstat '/Volumes/T7/原片.mov'",
    "EIO: i/o error, open '/Volumes/T7/原片.mov'",
    "read failed for /media/user/disk/clip.mov",
    "read failed for /mnt/nas/clip.mov",
    "cannot open /var/folders/xy/T/clip.mov",
    "ENOENT: no such file or directory",
    "x".repeat(350),
    "",
  ])
    assert.equal(publicEditorErrorMessage(message), undefined, message);
});
