import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { ProductionController } from "../apps/video-studio/src/production";
import { AutomaticProducer } from "../apps/video-studio/src/automatic";
import { createProject } from "../apps/video-studio/src/model";
import { canonicalRenderMediaJob } from "../apps/video-studio/src/editor/render-media-job";
import { createMediaTaskBridge } from "../apps/video-studio/src/media-task-bridge.ts";
import {
  createNdjsonDecoder,
  taskValue,
  createPanelRuntime,
} from "../apps/video-studio/src/sdk/panel-runtime.ts";
const sourceId = `asset-${"a".repeat(64)}`,
  outputId = `asset-${"b".repeat(64)}`,
  transcriptId = `asset-${"c".repeat(64)}`;
const inspection = {
  kind: "audio",
  durationSeconds: 4,
  bytes: 100,
  format: "wav",
  audio: { sampleRate: 48000, channels: 1, codec: "pcm_s16le" },
};
function fixture(legacyMethods: string[] = []) {
  const calls: any[] = [],
    documents = new Map<string, any>(),
    jobs = new Map<string, any>(),
    events = new Map<string, Set<(data: any) => void>>();
  let available = true,
    cwd = "/project-a";
  const methods = [
    "tasks.start",
    "tasks.get",
    "tasks.list",
    "tasks.cancel",
    "tasks.retry",
    "resources.get",
    "resources.read",
    "credentials.connections.list",
    ...legacyMethods,
  ];
  const connection = {
    id: "voice",
    catalogId: "service",
    tag: "speech",
    adapterKind: "openai",
    model: "tts-1",
    baseUrl: "https://example.com/v1",
    hasCredentials: true,
    entry: { tag: "speech" },
    preset: { params: [{ name: "voice", control: "enum", options: ["alloy"] }] },
    paramValues: {},
  };
  const asset = {
    id: sourceId,
    name: "reference.wav",
    mimeType: "audio/wav",
    bytes: 100,
    sha256: "a".repeat(64),
    createdAt: 1,
  };
  const raw = {
    getContext: async () => ({
      cwd,
      availableMethods: available ? methods : [],
      capabilities: {
        bridge: { maxCallsPerWindow: 10000 },
        tasks: { maxInputBytes: 2 * 1024 * 1024 + 8192 },
      },
    }),
    registerTool: () => () => {},
    on: (name: string, listener: (data: any) => void) => {
      const set = events.get(name) ?? new Set();
      set.add(listener);
      events.set(name, set);
      return () => {
        set.delete(listener);
      };
    },
    async call(method: string, params: any = {}) {
      calls.push({ method, params: structuredClone(params), cwd });
      if (method === "media.document.get")
        return structuredClone(
          documents.get(`${cwd}:${params.key}`) ?? { revision: 0, data: null },
        );
      if (method === "media.document.set") {
        const key = `${cwd}:${params.key}`,
          previous = documents.get(key) ?? { revision: 0 };
        assert.equal(params.baseRevision, previous.revision);
        const next = { revision: previous.revision + 1, data: structuredClone(params.data) };
        documents.set(key, next);
        return { revision: next.revision };
      }
      if (method === "credentials.connections.list")
        return { connections: [connection], defaults: { speech: "voice" } };
      if (method === "resources.get") return { asset: { ...asset, id: params.id } };
      if (method === "resources.read") {
        const bytes = Buffer.from(
          JSON.stringify({
            engine: "local-whisper",
            language: "zh",
            segments: [{ start: 0, end: 1, text: "真实转写", words: [] }],
          }),
        );
        return {
          assetId: params.assetId,
          offset: params.offset,
          totalBytes: bytes.length,
          dataBase64: bytes
            .subarray(params.offset, params.offset + params.length)
            .toString("base64"),
          eof: params.offset + params.length >= bytes.length,
        };
      }
      if (method === "tasks.start") {
        const request = params.input.request;
        let result: any = {};
        if (request.action === "status")
          result = {
            persistent: true,
            ffmpeg: { available: true },
            transcription: { available: true },
            hyperframes: { available: true },
            tts: { available: true },
          };
        else if (request.action === "voices")
          result = { available: true, voices: [], models: [], defaultModelId: "macos-say" };
        else if (request.action === "inspect")
          result = { assetId: request.params.assetId, inspection };
        else if (request.action === "prepare")
          result = { assetId: request.params.assetId, inspection, waveform: { peaks: [0.1] } };
        else if (request.action === "transcribe")
          result = {
            assetId: sourceId,
            transcript: { asset: { ...asset, id: transcriptId }, mimeType: "application/json" },
          };
        else if (request.action === "tts" || request.action === "tts-clone")
          result = { asset: { ...asset, id: outputId }, inspection, speech: request.params };
        const job = {
          id: randomUUID(),
          status: "succeeded",
          attempt: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          entry: { name: params.entry },
          input: params.input,
          result: { result, artifacts: [] },
        };
        jobs.set(job.id, job);
        return structuredClone(job);
      }
      if (method === "tasks.get") {
        if (!jobs.has(params.id)) throw new Error("not found");
        return structuredClone(jobs.get(params.id));
      }
      if (method === "tasks.list")
        return [...jobs.values()]
          .map(({ input, result, ...job }) => job)
          .slice(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 50));
      if (method === "tasks.retry") {
        const job = jobs.get(params.id);
        job.status = "queued";
        job.attempt++;
        return structuredClone(job);
      }
      if (method === "tasks.cancel") {
        const job = jobs.get(params.id);
        job.status = "cancelling";
        return structuredClone(job);
      }
      if (method === "media.jobs.list")
        return {
          jobs: [
            {
              id: "legacy-job",
              type: "tts",
              status: "succeeded",
              attempt: 1,
              createdAt: 5,
              updatedAt: 5,
            },
          ],
        };
      if (method === "media.jobs.recipe")
        return {
          id: params.id,
          type: "tts-managed",
          params: { providerId: "edge-tts", text: "旧任务", voiceId: "voice", rate: 1 },
        };
      if (method === "media.recording.finish") return { asset };
      throw new Error(`Unexpected Host business call: ${method}`);
    },
  };
  const wrapped = createMediaTaskBridge(raw);
  return {
    ...wrapped,
    calls,
    jobs,
    documents,
    emit(name: string, value: any) {
      events.get(name)?.forEach((listener) => listener(value));
    },
    setAvailable(value: boolean) {
      available = value;
    },
    setCwd(value: string) {
      cwd = value;
      events.get("context.changed")?.forEach((f) => f({ cwd }));
    },
    connection,
  };
}
test("restoring capabilities and managed assets does not start a native process", async () => {
  const f = fixture();
  try {
    const status = (await f.bridge.call("media.status", { probe: false })) as any;
    assert.equal(status.persistent, true);
    assert.equal(status.runtimeChecked, false);
    const restored = (await f.bridge.call("media.assets.get", {
      id: sourceId,
      inspect: false,
    })) as any;
    assert.equal(restored.asset.id, sourceId);
    assert.equal(restored.preparation, null);
    await f.bridge.call("media.jobs.list");
    assert.equal(
      f.calls.some((call) => ["tasks.start", "process.spawn"].includes(call.method)),
      false,
    );
    await f.bridge.call("media.status", { probe: true });
    assert.deepEqual(
      f.calls
        .filter((call) => call.method === "tasks.start")
        .map((call) => call.params.input.request.action),
      ["status"],
    );
  } finally {
    f.dispose();
  }
});

test("a fresh status request bypasses the short status cache", async () => {
  const f = fixture();
  try {
    await f.bridge.call("media.status", { probe: true });
    await f.bridge.call("media.status", { probe: true });
    await f.bridge.call("media.status", { probe: true, fresh: true });
    assert.equal(
      f.calls.filter(
        (call) => call.method === "tasks.start" && call.params.input.request.action === "status",
      ).length,
      2,
    );
  } finally {
    f.dispose();
  }
});

test("a fresh status request chains after a pending ordinary probe instead of joining it", async () => {
  const f = fixture();
  try {
    const stale = f.bridge.call("media.status", { probe: true });
    const fresh = f.bridge.call("media.status", { probe: true, fresh: true });
    const joined = f.bridge.call("media.status", { probe: true, fresh: true });
    await Promise.all([stale, fresh, joined]);
    assert.equal(
      f.calls.filter(
        (call) => call.method === "tasks.start" && call.params.input.request.action === "status",
      ).length,
      2,
    );
  } finally {
    f.dispose();
  }
});

test("all native media processing uses generic package tasks and directly materialized inputs", async () => {
  const f = fixture();
  try {
    await f.bridge.call("media.status");
    const prepared = (await f.bridge.call("media.prepare", { assetIds: [sourceId] })) as any;
    const done = (await f.bridge.call("media.jobs.get", { id: prepared.jobs[0].id })) as any;
    assert.equal(done.result.inspection.kind, "audio");
    const asset = (await f.bridge.call("media.assets.get", { id: sourceId })) as any;
    assert.equal(asset.preparation.waveform.peaks[0], 0.1);
    const speech = (await f.bridge.call("media.tts", {
      modelId: "audio8-tts",
      text: "你好",
      referenceAssetId: sourceId,
      referenceText: "原录音",
      voiceId: "reference",
      rate: 1,
    })) as any;
    assert.equal(speech.type, "tts-clone");
    const start = f.calls.filter((c) => c.method === "tasks.start").at(-1).params;
    assert.equal(start.entry, "media-runtime");
    assert.equal(start.input.request.action, "tts-clone");
    assert.deepEqual(start.input.resources, [{ assetId: sourceId, path: "inputs/source-0.bin" }]);
    assert.equal(
      f.calls.some((c) =>
        [
          "media.status",
          "media.prepare",
          "media.tts",
          "process.spawn",
          "media.assets.read",
        ].includes(c.method),
      ),
      false,
    );
  } finally {
    f.dispose();
  }
});
test("recording publication receives inspection from panel tool and transcript pages use generic resources", async () => {
  const f = fixture();
  try {
    const recorded = (await f.bridge.call("media.recording.finish", {
      sessionId: "recording",
    })) as any;
    assert.equal(recorded.inspection.durationSeconds, 4);
    const job = (await f.bridge.call("media.transcribe", { assetId: sourceId })) as any;
    await f.bridge.call("media.jobs.get", { id: job.id });
    const transcript = (await f.bridge.call("media.transcript", { assetId: sourceId })) as any;
    assert.equal(transcript.segments[0].text, "真实转写");
    assert.equal(transcript.total, 1);
    assert.equal(transcript.revision, transcriptId);
  } finally {
    f.dispose();
  }
});
test("online tasks authorize exactly the selected connection and require manual recovery", async () => {
  const f = fixture();
  try {
    const c = f.connection,
      modelId = `speech-${createHash("sha256")
        .update(JSON.stringify([c.id, c.catalogId, c.model, c.baseUrl]))
        .digest("hex")
        .slice(0, 32)}`;
    await f.bridge.call("media.tts", { modelId, text: "hello", voiceId: "alloy" });
    const request = f.calls.find((c) => c.method === "tasks.start").params;
    assert.deepEqual(request.input.connectionIds, ["voice"]);
    assert.equal(request.input.connectionArgument, "--connections-file");
    assert.equal(request.recovery, "manual");
    assert.equal("publicConnections" in request.input.request, false);
  } finally {
    f.dispose();
  }
});
test("legacy task retry rebuilds panel task and never invokes old Host processing", async () => {
  const f = fixture(["media.jobs.recipe"]);
  try {
    const job = (await f.bridge.call("media.jobs.retry", { id: "job-old" })) as any;
    assert.notEqual(job.id, "job-old");
    assert.equal(job.type, "tts-managed");
    assert.equal(
      f.calls.some((c) => c.method === "media.jobs.retry"),
      false,
    );
  } finally {
    f.dispose();
  }
});
test("older Hosts fail with an explicit generic API upgrade message", async () => {
  const f = fixture();
  f.setAvailable(false);
  try {
    await assert.rejects(f.bridge.call("media.status"), /通用本地任务或资源接口/);
    assert.equal(f.calls.length, 0);
  } finally {
    f.dispose();
  }
});
test("generic job states and split NDJSON are handled without treating cancellation acknowledgement as exit", () => {
  assert.equal(taskValue({ id: "id", status: "cancelling" }).status, "running");
  assert.equal(taskValue({ id: "id", status: "interrupted" }).error?.code, "INTERRUPTED");
  const values: unknown[] = [],
    decoder = createNdjsonDecoder((value) => values.push(value), 100);
  decoder.push('{"type":"pro');
  decoder.push('gress"}\n{"type":"result"}');
  decoder.finish();
  assert.deepEqual(values, [{ type: "progress" }, { type: "result" }]);
});

test("SDK uses structured bridge errors, advertised limits and the actual process cursor", async () => {
  const calls: any[] = [];
  const sdk = createPanelRuntime({
    getContext: async () => ({
      availableMethods: ["process.get"],
      capabilities: {
        bridge: { maxParamsBytes: 128, maxCallsPerWindow: 10000, structuredErrors: true },
        tasks: { maxInputBytes: 2048 },
      },
    }),
    on: () => () => {},
    call: async () => {
      throw new Error("legacy call must not run");
    },
    callResult: async (method, params) => {
      calls.push({ method, params });
      if (method === "failure")
        return {
          ok: false,
          error: { code: "RATE_LIMITED", message: "稍后重试", retryAfterMs: 250 },
        };
      return { ok: true, value: { accepted: true } };
    },
  });
  try {
    await assert.rejects(
      sdk.call("failure"),
      (error: any) => error.code === "RATE_LIMITED" && error.retryAfterMs === 250,
    );
    await assert.rejects(
      sdk.call("ordinary", { text: "a".repeat(200) }),
      (error: any) => error.code === "PARAMS_TOO_LARGE",
    );
    await sdk.call("tasks.start", { text: "a".repeat(200) });
    await sdk.call("media.document.set", { text: "a".repeat(200) });
    await sdk.processOutput("process-1", 7);
    assert.deepEqual(calls.at(-1), {
      method: "process.get",
      params: { processId: "process-1", afterSequence: 7 },
    });
  } finally {
    sdk.dispose();
  }
});

test("SDK explains stale installed tasks in Chinese and preserves structured and legacy error codes", async () => {
  for (const structured of [true, false]) {
    const stale = Object.assign(new Error("Installed tool task version or permissions changed"), {
      code: "PERMISSION_DENIED",
      retryAfterMs: 250,
    });
    const sdk = createPanelRuntime({
      getContext: async () => ({ availableMethods: ["tasks.start", "tasks.get", "resources.get"] }),
      on: () => () => {},
      call: async () => {
        throw stale;
      },
      ...(structured
        ? {
            callResult: async () => ({
              ok: false as const,
              error: { code: stale.code, message: stale.message, retryAfterMs: stale.retryAfterMs },
            }),
          }
        : {}),
    });
    try {
      await assert.rejects(sdk.start({ entry: "editor-runtime" }), (error: any) => {
        assert.equal(error.code, "PERMISSION_DENIED");
        assert.equal(error.retryAfterMs, 250);
        assert.match(error.message, /当前页面已过期/);
        assert.match(error.message, /确认工程已保存后，关闭并重新打开视频工作台/);
        assert.equal(error.cause.message, stale.message);
        return true;
      });
    } finally {
      sdk.dispose();
    }
  }
});

test("SDK names the Host methods that are missing instead of a generic upgrade notice", async () => {
  const sdk = createPanelRuntime({
    getContext: async () => ({ availableMethods: ["tasks.start", "tasks.get", "resources.get"] }),
    on: () => () => {},
    call: async () => undefined,
  });
  try {
    await assert.rejects(sdk.requireMethods(["resources.get", "media.export"]), (error: any) => {
      assert.match(error.message, /缺少通用本地任务或资源接口/);
      assert.match(error.message, /media\.export/);
      assert.doesNotMatch(error.message, /resources\.get/);
      return true;
    });
  } finally {
    sdk.dispose();
  }
});

test("task events normalize state, fetch terminal artifacts and omit internal checks", async () => {
  const f = fixture(),
    observed: any[] = [];
  f.bridge.on("media.job.changed", (job) => observed.push(job));
  const flush = async () => {
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };
  try {
    const prepared = (await f.bridge.call("media.prepare", { assetIds: [sourceId] })) as any;
    const id = prepared.jobs[0].id;
    f.jobs.get(id).status = "cancelling";
    f.emit("tasks.changed", { id, status: "cancelling", attempt: 1, sequence: 1 });
    await flush();
    assert.equal(observed[0].type, "prepare");
    assert.equal(observed[0].status, "running");
    assert.match(observed[0].progress.message, /停止/);
    f.jobs.get(id).status = "succeeded";
    f.emit("tasks.changed", { id, status: "succeeded", attempt: 1, sequence: 2 });
    await flush();
    assert.equal(observed[1].result.inspection.durationSeconds, 4);
    const asset = (await f.bridge.call("media.assets.get", { id: sourceId })) as any;
    assert.deepEqual(asset.preparation.waveform.peaks, [0.1]);
    await f.bridge.call("media.status");
    const internal = [...f.jobs.values()].find((job) => job.input.request.action === "status");
    f.emit("tasks.changed", { id: internal.id, status: "succeeded", sequence: 1 });
    await flush();
    assert.equal(observed.length, 2);
    const job = f.jobs.get(id);
    job.status = "interrupted";
    job.recovery = "manual";
    job.error = { code: "INTERRUPTED", message: "请检查远端结果", retryable: false };
    f.emit("tasks.changed", { id, status: "interrupted", sequence: 3 });
    await flush();
    assert.equal(observed[2].status, "failed");
    assert.equal(observed[2].error.retryable, false);
    await assert.rejects(f.bridge.call("media.jobs.retry", { id }), /不能自动重试/);
    assert.equal(
      f.calls.some((call) => call.method === "tasks.retry"),
      false,
    );
  } finally {
    f.dispose();
  }
});

test("public connection fingerprints authorize the selected model without exposing endpoints", async () => {
  const f = fixture();
  try {
    const fingerprint = "d".repeat(32);
    Object.assign(f.connection, { fingerprint });
    delete (f.connection as any).baseUrl;
    await f.bridge.call("media.tts", {
      modelId: `speech-${fingerprint}`,
      text: "你好",
      voiceId: "alloy",
    });
    const submitted = f.calls.find((call) => call.method === "tasks.start").params;
    assert.deepEqual(submitted.input.connectionIds, ["voice"]);
    assert.equal("baseUrl" in submitted.input.request, false);
  } finally {
    f.dispose();
  }
});

test("transcript paging reuses one immutable resource read, protects cached rows and clears on project switch", async () => {
  const f = fixture();
  try {
    const job = (await f.bridge.call("media.transcribe", { assetId: sourceId })) as any;
    await f.bridge.call("media.jobs.get", { id: job.id });
    const first = (await f.bridge.call("media.transcript", {
      assetId: sourceId,
      offset: 0,
      limit: 1,
    })) as any;
    first.segments[0].text = "caller mutation";
    const [again, tail] = (await Promise.all([
      f.bridge.call("media.transcript", { assetId: sourceId, offset: 0, limit: 1 }),
      f.bridge.call("media.transcript", { assetId: sourceId, offset: 1, limit: 1 }),
    ])) as any[];
    assert.equal(again.segments[0].text, "真实转写");
    assert.equal(tail.segments.length, 0);
    assert.equal(f.calls.filter((call) => call.method === "resources.read").length, 1);
    f.setCwd("/project-b");
    await assert.rejects(f.bridge.call("media.transcript", { assetId: sourceId }), /先准备/);
    f.setCwd("/project-a");
    await f.bridge.call("media.transcript", { assetId: sourceId });
    assert.equal(f.calls.filter((call) => call.method === "resources.read").length, 2);
  } finally {
    f.dispose();
  }
});

function canonicalTask(status = "running") {
  return {
    id: "job-canonical",
    entry: { name: "editor-runtime" },
    input: {
      request: {
        action: "render",
        documentHash: "d".repeat(64),
        sequenceId: "main",
        transferId: "export-fixture",
      },
    },
    recovery: "retry",
    status,
    attempt: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    progress: { fraction: 0.25, stage: "render-video" },
    result: {
      result: {
        verified: true,
        frameCount: 300,
        durationSeconds: 10,
        video: {
          id: outputId,
          sha256: "b".repeat(64),
          bytes: 1024,
          mimeType: "video/mp4",
          name: "完整多轨.mp4",
        },
      },
    },
  };
}
test("canonical rendering maps only verified actual output and preserves cancellation/error states", () => {
  const job = canonicalTask();
  assert.equal(canonicalRenderMediaJob(job).status, "running");
  assert.equal(canonicalRenderMediaJob({ ...job, status: "cancelling" }).status, "running");
  const ready = canonicalRenderMediaJob({ ...job, status: "succeeded" });
  assert.equal(ready.type, "render");
  assert.equal((ready.result as any).video.asset.id, outputId);
  assert.equal((ready.result as any).video.id, outputId);
  assert.throws(
    () =>
      canonicalRenderMediaJob({
        ...job,
        status: "succeeded",
        result: { result: { ...job.result.result, verified: false } },
      }),
    /核验/,
  );
  assert.throws(() => canonicalRenderMediaJob({ ...job, entry: { name: "unrelated" } }), /新版/);
  assert.throws(
    () =>
      canonicalRenderMediaJob({
        ...job,
        status: "succeeded",
        result: {
          result: {
            ...job.result.result,
            video: { ...job.result.result.video, sha256: "c".repeat(64) },
          },
        },
      }),
    /核验/,
  );
  assert.equal(
    canonicalRenderMediaJob({
      ...job,
      status: "interrupted",
      error: { message: "任务中断", retryable: true },
    }).status,
    "failed",
  );
});
test("old production tracks, waits, cancels and retries the real canonical export and automatic completion sees the same artifact", async () => {
  const f = fixture(),
    project = createProject(),
    job = canonicalTask();
  f.jobs.set(job.id, job);
  let starts = 0;
  const controller = new ProductionController(f.bridge, {
    getProject: () => project,
    publishAssets: async () => assert.fail("render cannot publish projected media"),
    changed() {},
    renderCanonical: async (snapshot) => {
      starts++;
      assert.deepEqual(snapshot, project);
      return structuredClone(job) as any;
    },
  });
  try {
    await controller.initialize();
    const first = await controller.render(project);
    assert.equal(first.id, job.id);
    assert.equal(first.status, "running");
    assert.equal(first.type, "render");
    assert.equal(
      controller.pendingJobs.some((j) => j.id === job.id),
      true,
    );
    assert.equal(
      f.calls.some((c) => c.method === "tasks.start" && c.params.input.request.action === "render"),
      false,
      "legacy bridge must never start media-runtime render",
    );
    const page = (await f.bridge.call("media.jobs.list", {})) as any;
    assert.equal(page.jobs.find((j: any) => j.id === job.id).type, "render");
    await controller.cancel(job.id);
    assert.equal(
      controller.currentJobs.find((j) => j.id === job.id)!.status,
      "running",
      "cancel acknowledgement is not terminal",
    );
    job.status = "cancelled";
    job.updatedAt++;
    await controller.refresh();
    assert.equal(controller.pendingJobs.length, 0);
    const retried = await controller.retry(job.id);
    assert.equal(retried!.id, job.id);
    assert.equal(retried!.attempt, 2);
    assert.equal(retried!.status, "queued");
    assert.equal(starts, 1);
    job.status = "succeeded";
    job.updatedAt++;
    await controller.refresh();
    assert.equal(controller.latestExport!.id, outputId);
    assert.equal((await controller.waitForJobs([job.id])).jobs[0]!.status, "succeeded");
    await controller.setAuto({
      projectId: project.id,
      prompt: "制作完整工程",
      phase: "waiting",
      attempts: 1,
      startedAt: job.createdAt - 1,
    });
    const automatic = new AutomaticProducer(f.bridge, controller, {
      getProject: () => project,
      assertEditable() {},
      state() {},
    });
    await automatic.resume();
    assert.equal(controller.auto!.phase, "done");
    const restarted = new ProductionController(f.bridge, {
      getProject: () => project,
      publishAssets: async () => {},
      changed() {},
    });
    try {
      await restarted.initialize();
      await restarted.refresh();
      assert.equal(restarted.latestExport!.id, outputId);
    } finally {
      restarted.dispose();
    }
  } finally {
    controller.dispose();
    f.dispose();
  }
});
test("generic task ownership rejects foreign operations and discovers only reviewed export actions", async () => {
  const f = fixture(),
    canonical = canonicalTask("succeeded");
  f.jobs.set(canonical.id, canonical);
  const foreign = { ...canonical, id: "job-foreign", entry: { name: "unrelated-tool" } },
    prepare = {
      ...canonical,
      id: "job-editor-prepare",
      input: { request: { action: "prepare-audio" } },
    };
  f.jobs.set(foreign.id, foreign);
  f.jobs.set(prepare.id, prepare);
  try {
    const page = (await f.bridge.call("media.jobs.list", {})) as any;
    assert.deepEqual(
      page.jobs.map((j: any) => j.id),
      [canonical.id],
    );
    for (const method of ["media.jobs.get", "media.jobs.cancel", "media.jobs.retry"])
      for (const id of [foreign.id, prepare.id])
        await assert.rejects(f.bridge.call(method, { id }), /不属于/);
    assert.equal(
      f.calls.some((c) => ["tasks.cancel", "tasks.retry"].includes(c.method)),
      false,
    );
    const observed: any[] = [];
    f.bridge.on("media.job.changed", (value) => observed.push(value));
    f.emit("tasks.changed", { id: foreign.id, status: "succeeded", sequence: 1 });
    f.emit("tasks.changed", { id: canonical.id, status: "succeeded", sequence: 1 });
    for (let i = 0; i < 15; i++) await new Promise((r) => setTimeout(r, 0));
    assert.equal(observed.length, 1);
    assert.equal(observed[0].result.video.asset.id, outputId);
  } finally {
    f.dispose();
  }
});

test("task lists ask the Host for old media jobs only when it advertises them", async () => {
  const modern = fixture();
  try {
    for (let round = 0; round < 3; round++) {
      const page = (await modern.bridge.call("media.jobs.list", { limit: 50 })) as any;
      assert.equal(
        page.jobs.some((job: any) => job.id === "legacy-job"),
        false,
      );
    }
    assert.equal(
      modern.calls.some((call) => call.method.startsWith("media.jobs.")),
      false,
      "No unadvertised media.jobs.* request reaches the Host",
    );
    await assert.rejects(modern.bridge.call("media.jobs.get", { id: "legacy-job" }), /not found/);
    assert.equal(
      modern.calls.some((call) => call.method === "media.jobs.get"),
      false,
    );
  } finally {
    modern.dispose();
  }
  const legacy = fixture(["media.jobs.list"]);
  try {
    const page = (await legacy.bridge.call("media.jobs.list", { limit: 50 })) as any;
    assert.equal(
      page.jobs.some((job: any) => job.id === "legacy-job"),
      true,
    );
  } finally {
    legacy.dispose();
  }
});

test("unreadable or incompatible media journals never fall back to an empty writable task list", async () => {
  const recipe = { id: "saved-job", action: "prepare", type: "prepare" };
  for (const value of [
    { revision: 2, data: { schemaVersion: 2, recipes: [recipe] } },
    { revision: 2, data: { schemaVersion: 1, recipes: [{ ...recipe, unknown: true }] } },
    { revision: 2, data: { schemaVersion: 1, recipes: [recipe, recipe] } },
    {
      revision: 2,
      data: { schemaVersion: 1, recipes: [{ id: "", action: "prepare", type: "prepare" }] },
    },
    {
      revision: 2,
      data: {
        schemaVersion: 1,
        recipes: Array.from({ length: 501 }, (_, i) => ({ ...recipe, id: `job-${i}` })),
      },
    },
    { revision: 0, data: { schemaVersion: 1, recipes: [] } },
    { revision: 2, data: null },
  ]) {
    const f = fixture();
    const key = "/project-a:video-studio-native-media-v1";
    f.documents.set(key, structuredClone(value));
    try {
      await assert.rejects(
        f.bridge.call("media.prepare", { assetIds: [sourceId] }),
        /媒体任务记录/,
      );
      assert.deepEqual(f.documents.get(key), value);
      assert.equal(
        f.calls.some((c) => c.method === "tasks.start" || c.method === "media.document.set"),
        false,
      );
    } finally {
      f.dispose();
    }
  }
});
