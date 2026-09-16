import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  createEditorTaskBridge,
  editorProjectDocument,
  type EditorProjectImportReceipt,
} from "../apps/video-studio/src/editor/task-bridge";
import type { EditorDocument } from "../apps/video-studio/src/editor/types";
import type { RuntimeBridge, RuntimeJob } from "../apps/video-studio/src/sdk/panel-runtime";
import { validateEditorRequest } from "../apps/video-studio/native/editor-runtime/protocol";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const digest = (i: number) => i.toString(16).padStart(64, "0");
function document(count = 129, large = false): EditorDocument {
  return {
    schemaVersion: 2,
    timebase: 240000,
    id: "full",
    name: "全部工程",
    revision: 7,
    assets: Array.from({ length: count }, (_, index) => ({
      id: `a-${index}`,
      name: `原片 ${index}`,
      kind: "audio",
      duration: 240000,
      resourceId: `external-${digest(index + 1)}`,
      metadata: { sourcePath: `/old-device/original-${index}.wav`, mimeType: "audio/wav" },
    })),
    sequences: ["main", "unused"].map((id) => ({
      id,
      name: id,
      width: 64,
      height: 64,
      frameRate: { numerator: 24000, denominator: 1001 },
      background: "#000000",
      timelineMode: "free",
      tracks: [],
      clips: [],
      transitions: [],
      markers: [],
    })),
    activeSequenceId: "main",
    exportProfiles: [],
    production: { note: large ? "完整元数据".repeat(220000) : "preserve" },
  };
}
function host(doc = document(), failPage = -1) {
  let cwd = "/project",
    count = 0,
    failures = 0;
  const calls: any[] = [],
    executedPages: number[] = [],
    requests = new Map<string, any>(),
    keys = new Map<string, RuntimeJob>(),
    jobs = new Map<string, RuntimeJob>(),
    chunks = new Map<number, Buffer>(),
    staged = new Set<string>();
  const manifest = {
    format: "mimi-video-project",
    formatVersion: 1,
    document: doc,
    media: doc.assets.map((asset, index) => ({
      sha256: digest(index + 1000),
      bytes: 100 + index,
      assetIds: [asset.id],
    })),
  };
  const data = Buffer.from(JSON.stringify(manifest)),
    manifestHash = sha(data),
    bundleHash = "e".repeat(64);
  const artifact = (sha256: string, bytes: number, mimeType: string) => ({
    id: `asset-${sha256}`,
    sha256,
    bytes,
    mimeType,
  });
  function execute(request: any): any {
    if (request.action === "stage-status")
      return {
        resourceIds: request.resourceIds.filter((id: string) => staged.has(id)),
        chunks: [...chunks.keys()],
      };
    if (request.action === "stage-resources") {
      request.resourceIds.forEach((id: string) => staged.add(id));
      return {};
    }
    if (request.action === "stage-document") {
      chunks.set(request.chunkIndex, Buffer.from(request.dataBase64, "base64"));
      return {};
    }
    if (request.action === "commit-project") {
      assert.deepEqual(JSON.parse(Buffer.concat([...chunks.values()]).toString()), doc);
      return {
        kind: "project",
        documentHash: request.documentHash,
        sequenceId: request.sequenceId,
      };
    }
    if (request.action === "export-project")
      return {
        documentHash: request.documentHash,
        formatVersion: 1,
        bundle: artifact(bundleHash, 999, "application/zip"),
      };
    if (["import-project", "project-import-status"].includes(request.action))
      return {
        transferId: request.transferId,
        sourceResourceId: `asset-${bundleHash}`,
        bundleHash,
        manifest: artifact(manifestHash, data.length, "application/json"),
        mediaCount: manifest.media.length,
      };
    if (request.action === "publish-project-media") {
      executedPages.push(request.batchIndex);
      if (request.batchIndex === failPage && failures++ === 0) throw new Error("暂时繁忙");
      return {
        transferId: request.transferId,
        bundleHash,
        batchIndex: request.batchIndex,
        media: manifest.media
          .slice(request.batchIndex * 120, request.batchIndex * 120 + 120)
          .map((item) => artifact(item.sha256, item.bytes, "audio/wav")),
      };
    }
    if (request.action === "discard-project-import")
      return { discarded: true, bundleHash, transferId: request.transferId };
    throw new Error(`unexpected ${request.action}`);
  }
  function finish(job: RuntimeJob, request: any) {
    try {
      job.result = { result: execute(request) };
      job.status = "succeeded";
      delete job.error;
    } catch (error) {
      job.status = "failed";
      job.error = { code: "BUSY", message: String(error), retryable: true };
    }
    return job;
  }
  const raw: RuntimeBridge = {
    getContext: async () => ({
      cwd,
      availableMethods: [
        "tasks.start",
        "tasks.get",
        "tasks.cancel",
        "tasks.retry",
        "resources.get",
        "resources.read",
      ],
      capabilities: {
        bridge: { maxCallsPerWindow: 100000, maxTransferCallsPerWindow: 100000 },
        tasks: { maxInputBytes: 2 * 1024 ** 2 },
      },
    }),
    on: () => () => {},
    async call(method, params: any) {
      calls.push({ method, params });
      if (method === "tasks.start") {
        const prior = params.requestKey && keys.get(params.requestKey);
        if (prior) return { job: structuredClone(prior) };
        const job: RuntimeJob = {
          id: `job-${++count}`,
          status: "queued",
          attempt: 1,
          createdAt: 0,
          updatedAt: 0,
        };
        jobs.set(job.id, job);
        requests.set(job.id, params.input.request);
        if (params.requestKey) keys.set(params.requestKey, job);
        // Fresh starts are queued; tasks.get performs first execution, matching real async Host behavior.
        return { job: structuredClone(job) };
      }
      if (method === "tasks.get") {
        const job = jobs.get(params.id)!;
        return {
          job: structuredClone(job.status === "queued" ? finish(job, requests.get(job.id)) : job),
        };
      }
      if (method === "tasks.retry") {
        const job = jobs.get(params.id)!;
        assert.ok(["failed", "cancelled"].includes(job.status));
        job.status = "queued";
        job.attempt++;
        return { job: structuredClone(job) };
      }
      if (method === "tasks.cancel") {
        const job = jobs.get(params.id)!;
        job.status = "cancelled";
        job.error = { code: "CANCELLED", message: "cancelled", retryable: true };
        return { job: structuredClone(job) };
      }
      if (method === "resources.read") {
        assert.equal(
          params.assetId,
          `asset-${manifestHash}`,
          "browser never reads original media bytes",
        );
        const part = data.subarray(params.offset, params.offset + params.length);
        return {
          assetId: params.assetId,
          offset: params.offset,
          totalBytes: data.length,
          eof: params.offset + part.length === data.length,
          dataBase64: part.toString("base64"),
        };
      }
      throw new Error(method);
    },
  };
  return {
    raw,
    calls,
    executedPages,
    data,
    manifest,
    bundleHash,
    setCwd: (value: string) => {
      cwd = value;
    },
  };
}
test("full project bundle stages unused sequences and 129 original assets in bounded requests without legacy timing rewrites", async () => {
  const doc = document(129, true),
    mock = host(doc),
    bridge = createEditorTaskBridge(mock.raw);
  assert.deepEqual(editorProjectDocument(doc).document, doc);
  const result = await bridge.exportProjectBundle(doc);
  assert.equal(result.snapshot.kind, "project");
  assert.equal(result.bundle.id, `asset-${mock.bundleHash}`);
  const starts = mock.calls.filter((call) => call.method === "tasks.start");
  assert.deepEqual(
    starts
      .filter((call) => call.params.input.request.action === "stage-resources")
      .map((call) => call.params.input.resources.length),
    [128, 1],
  );
  assert.ok(
    starts.filter((call) => call.params.input.request.action === "stage-document").length > 4,
  );
  assert.ok(starts.every((call) => Buffer.byteLength(JSON.stringify(call.params)) < 2 * 1024 ** 2));
  assert.deepEqual(
    doc.sequences.map((item) => item.id),
    ["main", "unused"],
  );
  bridge.dispose();
});
test("large manifest is read once per import in bounded chunks, then 120+9 publications map all resources", async () => {
  const mock = host(document(129, true)),
    bridge = createEditorTaskBridge(mock.raw);
  assert.ok(mock.data.length > 2 * 1024 ** 2);
  const imported = await bridge.importProjectBundle(`asset-${mock.bundleHash}`);
  assert.deepEqual(mock.executedPages, [0, 1]);
  assert.equal(imported.resources.length, 129);
  assert.deepEqual(imported.document.sequences, mock.manifest.document.sequences);
  assert.deepEqual(imported.document.production, mock.manifest.document.production);
  assert.equal(imported.document.assets[128]!.metadata!.sourcePath, "/old-device/original-128.wav");
  assert.equal(imported.document.assets[128]!.resourceId, `asset-${digest(1128)}`);
  const reads = mock.calls.filter((call) => call.method === "resources.read");
  assert.equal(
    reads.reduce((sum, call) => sum + call.params.length, 0),
    mock.data.length,
  );
  assert.ok(reads.every((call) => call.params.length <= 32768));
  await bridge.discardProjectImport(imported.receipt);
  assert.equal(
    mock.calls.filter(
      (call) => call.method.startsWith("resources.") && call.method !== "resources.read",
    ).length,
    0,
  );
  bridge.dispose();
});
test("failed media publication resumes the immutable import receipt, retries only failed jobs and never rematerializes the ZIP", async () => {
  const mock = host(document(), 1),
    bridge = createEditorTaskBridge(mock.raw);
  let receipt: EditorProjectImportReceipt | undefined;
  await assert.rejects(
    bridge.importProjectBundle(`asset-${mock.bundleHash}`, {
      onImportReceipt: (value) => {
        receipt = value;
      },
    }),
    /暂时繁忙/,
  );
  assert.ok(receipt);
  assert.deepEqual(mock.executedPages, [0, 1]);
  const imported = await bridge.importProjectBundle(`asset-${mock.bundleHash}`, { receipt });
  assert.equal(imported.resources.length, 129);
  assert.deepEqual(mock.executedPages, [0, 1, 1]);
  assert.equal(mock.calls.filter((call) => call.method === "tasks.retry").length, 1);
  const starts = mock.calls.filter((call) => call.method === "tasks.start");
  assert.equal(
    starts.filter((call) => call.params.input.request.action === "import-project").length,
    1,
  );
  const resumed = starts.find(
    (call) => call.params.input.request.action === "project-import-status",
  );
  assert.deepEqual(resumed.params.input.resources, []);
  assert.equal(resumed.params.requestKey, undefined);
  bridge.dispose();
});
test("cancel after first publication yields no replacement document and receipt continuation skips completed pages", async () => {
  const mock = host(),
    bridge = createEditorTaskBridge(mock.raw),
    controller = new AbortController();
  let receipt: EditorProjectImportReceipt | undefined;
  await assert.rejects(
    bridge.importProjectBundle(`asset-${mock.bundleHash}`, {
      signal: controller.signal,
      onImportReceipt: (value) => {
        receipt = value;
      },
      onProgress: () => controller.abort(),
    }),
    { name: "AbortError" },
  );
  assert.deepEqual(mock.executedPages, [0]);
  await bridge.importProjectBundle(`asset-${mock.bundleHash}`, { receipt });
  assert.deepEqual(mock.executedPages, [0, 1]);
  mock.setCwd("/different-project");
  await assert.rejects(
    bridge.importProjectBundle(`asset-${mock.bundleHash}`, { receipt }),
    /不属于/,
  );
  bridge.dispose();
});
test("native portable task requests accept only hashes, resource IDs and bounded batch indexes", () => {
  const transferId = "editor-00000000-0000-0000-0000-000000000000";
  assert.equal(
    validateEditorRequest({
      action: "publish-project-media",
      transferId,
      bundleHash: "a".repeat(64),
      batchIndex: 83,
    }).batchIndex,
    83,
  );
  for (const value of [
    { action: "import-project", transferId, resourceIds: [] },
    {
      action: "import-project",
      transferId,
      resourceIds: [`asset-${"a".repeat(64)}`],
      path: "/tmp/a.zip",
    },
    { action: "publish-project-media", transferId, bundleHash: "a".repeat(64), batchIndex: 84 },
    { action: "project-import-status", transferId, bundleHash: "../file" },
  ])
    assert.throws(() => validateEditorRequest(value));
});
