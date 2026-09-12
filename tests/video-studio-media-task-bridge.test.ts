import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
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
function fixture() {
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
      if (method === "media.jobs.list") return { jobs: [] };
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
  const f = fixture();
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
    f.emit("tasks.changed", { id, status: "cancelling", attempt: 1, sequence: 1 });
    await flush();
    assert.equal(observed[0].type, "prepare");
    assert.equal(observed[0].status, "running");
    assert.match(observed[0].progress.message, /停止/);
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
