import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  createEditorMediaImporter,
  type EditorSourceInspection,
} from "../apps/video-studio/src/editor/import-media";
import type { RuntimeBridge, RuntimeJob } from "../apps/video-studio/src/sdk/panel-runtime";
import type { SessionIdentity } from "../apps/video-studio/src/editor/session";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  let cwd = "/project",
    identity: SessionIdentity = { documentId: "document", generation: 1, revision: 0 };
  const calls: Array<{ method: string; params: any }> = [],
    resources = new Map<string, any>(),
    uploads = new Map<
      string,
      { bytes: Buffer[]; received: number; sequence: number; name: string; mimeType: string }
    >(),
    jobs = new Map<string, RuntimeJob>();
  let count = 0;
  const hooks: {
    begin?: () => void;
    write?: () => void;
    get?: () => void;
    inspect?: () => void;
    result?: (value: EditorSourceInspection) => void;
  } = {};
  const panel: RuntimeBridge = {
    getContext: async () => ({
      cwd,
      availableMethods: [
        "tasks.start",
        "tasks.get",
        "tasks.cancel",
        "tasks.retry",
        "resources.get",
        ...["begin", "write", "finish", "cancel"].map((name) => `resources.upload.${name}`),
      ],
      capabilities: {
        bridge: { maxCallsPerWindow: 10000, maxTransferCallsPerWindow: 10000 },
        tasks: { maxInputBytes: 2 * 1024 * 1024 },
      },
    }),
    on: () => () => {},
    async call(method, params: any) {
      calls.push({ method, params });
      if (method === "resources.upload.begin") {
        const sessionId = `upload-${String(++count).padStart(8, "0")}-0000-4000-8000-000000000000`;
        uploads.set(sessionId, {
          bytes: [],
          received: 0,
          sequence: 0,
          name: params.name,
          mimeType: params.mimeType,
        });
        hooks.begin?.();
        return {
          sessionId,
          state: "uploading",
          receivedBytes: 0,
          nextSequence: 0,
          maxChunkBytes: 32768,
          maxFileBytes: 20 * 1024 ** 3,
        };
      }
      if (method === "resources.upload.write") {
        const upload = uploads.get(params.sessionId)!;
        const bytes = Buffer.from(params.dataBase64, "base64");
        assert.equal(params.offset, upload.received);
        assert.equal(params.sequence, upload.sequence);
        upload.received += bytes.length;
        upload.sequence++;
        upload.bytes.push(bytes);
        hooks.write?.();
        return {
          sessionId: params.sessionId,
          state: "uploading",
          receivedBytes: upload.received,
          nextSequence: upload.sequence,
        };
      }
      if (method === "resources.upload.finish") {
        const upload = uploads.get(params.sessionId)!,
          bytes = Buffer.concat(upload.bytes),
          sha256 = sha(bytes),
          id = `asset-${sha256}`,
          asset = { id, sha256, bytes: bytes.length, name: upload.name, mimeType: upload.mimeType };
        resources.set(id, asset);
        return { asset };
      }
      if (method === "resources.upload.cancel")
        return { sessionId: params.sessionId, state: "cancelled" };
      if (method === "resources.get") {
        hooks.get?.();
        return { asset: resources.get(params.id) };
      }
      if (method === "tasks.start") {
        assert.equal(params.input.request.action, "inspect-source");
        const resourceId = params.input.request.resourceIds[0],
          resource = resources.get(resourceId)!;
        assert.deepEqual(params.input.resources, [
          { assetId: resourceId, path: "inputs/resource-0.bin" },
        ]);
        const result: EditorSourceInspection = {
          resourceId,
          sha256: resource.sha256,
          bytes: resource.bytes,
          kind: "video",
          duration: 56056,
          width: 64,
          height: 48,
          mimeType: "video/quicktime",
          inspection: {
            schemaVersion: 1,
            format: "mov,mp4,m4a,3gp,3g2,mj2",
            timing: {
              origin: { numerator: "0", denominator: "1" },
              duration: { numerator: "7007", denominator: "30000" },
              tickRounding: "nearest",
              basis: "decoded-frames",
            },
            video: { codec: "prores", frameRate: { numerator: 30000, denominator: 1001 } },
            compatibility: { preview: "native-proxy", export: "supported", limitations: [] },
          },
        };
        hooks.result?.(result);
        const job: RuntimeJob = {
          id: `job-${++count}`,
          status: "succeeded",
          attempt: 1,
          createdAt: 0,
          updatedAt: 0,
          result: { result },
        };
        jobs.set(job.id, job);
        hooks.inspect?.();
        return { job };
      }
      if (method === "tasks.get") return { job: jobs.get(params.id) };
      if (method === "tasks.cancel")
        return { job: { ...jobs.get(params.id), status: "cancelled" } };
      throw new Error(method);
    },
  };
  return {
    panel,
    calls,
    hooks,
    resources,
    identity: () => identity,
    setIdentity(value: SessionIdentity) {
      identity = value;
    },
    setCwd(value: string) {
      cwd = value;
    },
  };
}
test("raw ProRes import persists all bytes before native analysis and never quantizes to 30fps", async () => {
  const f = fixture(),
    file = new File([new Uint8Array(70001)], "original.mov", {
      type: "application/octet-stream",
      lastModified: 1234,
    });
  const importer = createEditorMediaImporter(f.panel, { getIdentity: f.identity });
  const result = await importer.importFiles([file]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.assets.length, 1);
  const asset = result.assets[0]!;
  assert.equal(asset.duration, 56056);
  assert.equal(asset.metadata?.bytes, file.size);
  assert.equal(asset.metadata?.lastModified, 1234);
  assert.equal(asset.metadata?.sourceMimeType, "application/octet-stream");
  assert.equal(asset.metadata?.mimeType, "video/quicktime");
  assert.equal(asset.fingerprint, asset.resourceId!.slice(6));
  assert.equal(asset.name, file.name);
  const methods = f.calls.map((item) => item.method);
  assert.ok(methods.indexOf("resources.upload.finish") < methods.indexOf("resources.get"));
  assert.ok(methods.indexOf("resources.get") < methods.indexOf("tasks.start"));
  assert.deepEqual(
    f.calls
      .filter((c) => c.method === "resources.upload.write")
      .map((c) => Buffer.from(c.params.dataBase64, "base64").length),
    [32768, 32768, 4465],
  );
  assert.equal(
    f.calls.some((c) => c.method.startsWith("media.")),
    false,
  );
  importer.dispose();
});
test("authorized resources retain native restrictions and use saved names without reuploading", async () => {
  const f = fixture(),
    sha256 = "a".repeat(64),
    id = `asset-${sha256}`;
  f.resources.set(id, {
    id,
    sha256,
    bytes: 5000,
    name: "HDR source.mov",
    mimeType: "video/quicktime",
  });
  f.hooks.result = (value) => {
    value.inspection.compatibility = {
      preview: "unsupported",
      export: "unsupported",
      limitations: [{ code: "UNSUPPORTED_HDR", message: "HDR needs an explicit SDR conversion" }],
    };
  };
  const importer = createEditorMediaImporter(f.panel, { getIdentity: f.identity });
  const result = await importer.importResources([{ id }]);
  assert.equal(result.assets[0]?.name, "HDR source.mov");
  assert.deepEqual(result.errors, []);
  assert.equal(
    (result.assets[0]?.metadata?.editorInspection as any).compatibility.limitations[0].code,
    "UNSUPPORTED_HDR",
  );
  assert.equal(
    f.calls.some((c) => c.method.startsWith("resources.upload")),
    false,
  );
  importer.dispose();
});
test("empty files and failed probes yield per-item errors without publishing assets", async () => {
  const f = fixture(),
    importer = createEditorMediaImporter(f.panel, { getIdentity: f.identity });
  const result = await importer.importFiles([
    new File([], "empty.mkv"),
    new File(["source"], "good.mkv"),
  ]);
  assert.equal(result.assets.length, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0]!.message, /为空/);
  assert.equal(f.calls.filter((c) => c.method === "resources.upload.begin").length, 1);
  f.hooks.result = (value) => {
    value.bytes++;
  };
  const bad = await importer.importFiles([new File(["invalid"], "bad.mov")]);
  assert.equal(bad.assets.length, 0);
  assert.equal(bad.errors.length, 1);
  assert.match(bad.errors[0]!.message, /内容不一致/);
  assert.ok(bad.errors[0]!.resourceId);
  importer.dispose();
});
test("session replacement after upload begin cancels the issued ticket", async () => {
  const f = fixture();
  f.hooks.begin = () => f.setIdentity({ documentId: "document", generation: 2, revision: 0 });
  const importer = createEditorMediaImporter(f.panel, { getIdentity: f.identity });
  await assert.rejects(importer.importFiles([new File(["x"], "source.mov")]), {
    name: "AbortError",
  });
  assert.ok(f.calls.some((c) => c.method === "resources.upload.cancel"));
  assert.equal(
    f.calls.some((c) => c.method === "resources.upload.write"),
    false,
  );
  importer.dispose();
});
test("ordinary editing revisions remain valid while project changes abort before inspection", async () => {
  const f = fixture();
  f.hooks.write = () => f.setIdentity({ ...f.identity(), revision: f.identity().revision + 1 });
  const importer = createEditorMediaImporter(f.panel, { getIdentity: f.identity });
  assert.equal((await importer.importFiles([new File(["x"], "source.mov")])).assets.length, 1);
  f.hooks.get = () => f.setCwd("/another");
  await assert.rejects(importer.importFiles([new File(["y"], "changed.mov")]), {
    name: "AbortError",
  });
  assert.equal(f.calls.filter((c) => c.method === "tasks.start").length, 1);
  importer.dispose();
});
test("abort and dispose both cancel unfinished uploads even while an IPC response arrives", async () => {
  for (const dispose of [false, true]) {
    const f = fixture(),
      controller = new AbortController();
    const importer = createEditorMediaImporter(f.panel, { getIdentity: f.identity });
    f.hooks.write = () => (dispose ? importer.dispose() : controller.abort());
    await assert.rejects(
      importer.importFiles([new File([new Uint8Array(70000)], "source.mov")], {
        signal: controller.signal,
      }),
      { name: "AbortError" },
    );
    assert.ok(f.calls.some((c) => c.method === "resources.upload.cancel"));
    assert.equal(
      f.calls.some((c) => c.method === "resources.upload.finish"),
      false,
    );
    importer.dispose();
  }
});
test("aborting a native inspection cancels its durable task and returns no stale asset", async () => {
  const f = fixture(),
    controller = new AbortController();
  f.hooks.inspect = () => controller.abort();
  const importer = createEditorMediaImporter(f.panel, { getIdentity: f.identity });
  await assert.rejects(
    importer.importFiles([new File(["x"], "source.mov")], { signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.ok(f.calls.some((c) => c.method === "tasks.cancel"));
  importer.dispose();
});
