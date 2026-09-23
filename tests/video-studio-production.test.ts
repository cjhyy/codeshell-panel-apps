import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  createProject,
  validateProject,
  type Asset,
  type Project,
} from "../apps/video-studio/src/model.ts";
import {
  ProductionController,
  type ManagedAsset,
  type MediaJob,
  type PreparedMedia,
  type AutoProduction,
  validateVoicePreparation,
  type AssetPublication,
  TRANSCRIPTION_SETUP_MESSAGE,
  transcriptionSetupMessage,
} from "../apps/video-studio/src/production.ts";
import { AutomaticProducer } from "../apps/video-studio/src/automatic.ts";
import {
  narrationFingerprint,
} from "../apps/video-studio/src/narration.ts";
import type { PanelBridge, PanelTask } from "../apps/video-studio/src/host.ts";

const mediaId = `asset-${"a".repeat(64)}`;
const controllers = new Set<ProductionController>();
afterEach(() => {
  for (const controller of controllers) controller.dispose();
  controllers.clear();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 2));
  }
  assert.fail("condition did not settle");
}
function renderTask(id = crypto.randomUUID()) {
  return {
    id,
    entry: { name: "editor-runtime", sha256: "e".repeat(64) },
    input: { request: { action: "render", documentHash: "d".repeat(64), sequenceId: "main" } },
    recovery: "retry",
    status: "queued" as const,
    attempt: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

test("project restoration defers native checks until an explicit production request", async () => {
  const host = new FakeHost();
  host.handlers.set("media.status", ({ probe }) => ({
    persistent: true,
    runtimeChecked: probe,
    ffmpeg: { available: probe },
    transcription: { available: probe },
    hyperframes: { available: probe },
  }));
  const f = await fixture(host);
  await f.controller.restorePreparation(f.current);
  await f.controller.refresh();
  assert.equal(f.controller.enabled, true);
  assert.deepEqual(
    host.calls.filter((call) => call.method === "media.status").map((call) => call.params),
    [{ probe: false }],
  );
  assert.equal(
    host.calls.find((call) => call.method === "media.assets.get")?.params.inspect,
    false,
  );
  await f.controller.transcribe(["source"]);
  assert.equal(f.controller.status.transcription.available, true);
  assert.deepEqual(
    host.calls.filter((call) => call.method === "media.status").map((call) => call.params),
    [{ probe: false }, { probe: true }],
  );
});

test("transcription readiness keeps the missing piece and 重新检测 asks for a fresh probe", async () => {
  const host = new FakeHost();
  let transcription: unknown = { available: false, reason: "model-missing" };
  host.handlers.set("media.status", ({ probe }) => ({
    persistent: true,
    runtimeChecked: probe,
    ffmpeg: { available: true },
    transcription,
    hyperframes: { available: true },
  }));
  const f = await fixture(host);
  await assert.rejects(f.controller.transcribe(["source"]), (error: Error) => {
    assert.equal(error.message, transcriptionSetupMessage("model-missing"));
    assert.match(error.message, /缺少 base 模型 ~\/\.cache\/whisper\/base\.pt/);
    assert.match(error.message, /重新检测/);
    return true;
  });
  assert.equal(f.controller.status.transcription.reason, "model-missing");
  assert.match(transcriptionSetupMessage("executable-missing"), /未找到 whisper 命令/);
  assert.match(transcriptionSetupMessage("executable-failed"), /whisper 无法运行/);
  assert.equal(transcriptionSetupMessage(undefined), TRANSCRIPTION_SETUP_MESSAGE);
  assert.equal(
    TRANSCRIPTION_SETUP_MESSAGE,
    "本机语音转写未就绪：需要安装 openai-whisper（whisper 命令）并准备 base 模型 ~/.cache/whisper/base.pt。安装后点“重新检测”，或先导入 SRT。",
  );
  transcription = { available: false, reason: "not-a-known-reason" };
  await f.controller.refreshStatus({ fresh: true });
  assert.equal(f.controller.status.transcription.reason, undefined);
  transcription = { available: true };
  await f.controller.refreshStatus({ fresh: true });
  assert.equal(f.controller.status.transcription.available, true);
  assert.deepEqual(
    host.calls.filter((call) => call.method === "media.status").map((call) => call.params),
    [{ probe: false }, { probe: true }, { probe: true, fresh: true }, { probe: true, fresh: true }],
  );
});

test("setup copy fits each blocked flow and a fresh probe never joins an older pending one", async () => {
  assert.equal(
    transcriptionSetupMessage("model-missing", "再重试本人录音对齐；录音和草稿已保留"),
    "本机语音转写未就绪：缺少 base 模型 ~/.cache/whisper/base.pt。准备好模型后点“重新检测”，再重试本人录音对齐；录音和草稿已保留。",
  );
  assert.doesNotMatch(transcriptionSetupMessage(undefined, "再重试音频粗剪"), /SRT/);
  assert.match(
    transcriptionSetupMessage(undefined, "再重试音频粗剪"),
    /openai-whisper.*base 模型.*重新检测/,
  );
  const host = new FakeHost();
  const first = deferred<void>();
  let calls = 0;
  host.handlers.set("media.status", async ({ probe }) => {
    calls++;
    if (probe && calls === 2) await first.promise;
    return {
      persistent: true,
      ffmpeg: { available: true },
      transcription: { available: calls > 2 },
      hyperframes: { available: true },
    };
  });
  const f = await fixture(host);
  const stale = f.controller.refreshStatus();
  const fresh = f.controller.refreshStatus({ fresh: true });
  first.resolve();
  await Promise.all([stale, fresh]);
  assert.deepEqual(
    host.calls.filter((call) => call.method === "media.status").map((call) => call.params),
    [{ probe: false }, { probe: true }, { probe: true, fresh: true }],
  );
  assert.equal(f.controller.status.transcription.available, true);
});

test("render admission returns before storage or staging, deduplicates, and exposes only the eventual real job", async () => {
  const host = new FakeHost(),
    current = project(),
    storage = deferred<void>(),
    staging = deferred<void>();
  let starts = 0,
    options: any;
  const job = renderTask();
  const controller = new ProductionController(host, {
    getProject: () => current,
    publishAssets: async () => {},
    changed() {},
    renderCanonical: async (snapshot, control) => {
      starts++;
      options = control;
      assert.deepEqual(snapshot, current);
      await staging.promise;
      control?.assertCurrent?.();
      host.jobs.set(job.id, { ...job, type: "render" });
      return job;
    },
  });
  controllers.add(controller);
  await controller.initialize();
  await controller.setAuto({
    projectId: current.id,
    requestToken: "approved",
    runId: "run-1",
    prompt: "导出",
    attempts: 1,
    phase: "agent",
    startedAt: Date.now() - 1,
  });
  host.handlers.set("media.document.set", async (params) => {
    await storage.promise;
    assert.equal(params.baseRevision, host.revision);
    host.document = structuredClone(params.data);
    return { revision: ++host.revision };
  });
  const receipt = controller.startRender(current, "approved");
  assert.equal(receipt.status, "preparing");
  assert.equal(receipt.jobId, undefined);
  assert.equal(starts, 0, "Intent must persist before any native side effect");
  assert.deepEqual(controller.startRender(current, "approved"), receipt);
  const reading = await controller.waitForJobs([receipt.operationId]);
  assert.deepEqual(reading.jobs, []);
  assert.equal(reading.operations![0]!.operationId, receipt.operationId);
  assert.equal("requestToken" in reading.operations![0]!, false);
  storage.resolve();
  await until(() => starts === 1);
  await controller.setAuto({ ...controller.auto!, phase: "waiting" });
  const automatic = new AutomaticProducer(host, controller, {
    getProject: () => current,
    assertEditable() {},
    state() {},
  });
  await automatic.resume();
  assert.equal(
    host.calls.filter((call) => call.method === "agent.task.start").length,
    0,
    "Accepted staging must not start an extra agent round",
  );
  assert.doesNotThrow(
    () => options.assertCurrent(),
    "Normal agent completion may wait for the accepted render",
  );
  staging.resolve();
  await until(() => controller.currentJobs.some((item) => item.id === job.id));
  const submitted = await controller.waitForJobs([receipt.operationId]);
  assert.equal(submitted.operations![0]!.status, "submitted");
  assert.equal(submitted.operations![0]!.jobId, job.id);
  assert.equal(submitted.jobs[0]!.id, job.id);
  const direct = await controller.waitForJobs([job.id]);
  assert.equal(direct.jobs[0]!.id, job.id);
  assert.equal(
    direct.operations![0]!.operationId,
    receipt.operationId,
    "Actual render IDs also use the fast cached observation path",
  );
  assert.equal(controller.startRender(current, "approved").jobId, job.id);
  assert.equal(starts, 1);
});

test("cancelled, changed and failed admission never silently submit, and interrupted reload never duplicates", async () => {
  for (const mode of ["cancel", "revision", "run", "save"] as const) {
    const host = new FakeHost(),
      current = project(),
      gate = deferred<void>();
    let starts = 0,
      actual = 0;
    const controller = new ProductionController(host, {
      getProject: () => current,
      publishAssets: async () => {},
      changed() {},
      renderCanonical: async (_snapshot, options) => {
        starts++;
        await gate.promise;
        options?.assertCurrent?.();
        actual++;
        return renderTask();
      },
    });
    controllers.add(controller);
    await controller.initialize();
    await controller.setAuto({
      projectId: current.id,
      requestToken: "approved",
      runId: "run-1",
      prompt: "导出",
      attempts: 1,
      phase: "agent",
      startedAt: Date.now() - 1,
    });
    if (mode === "save")
      host.handlers.set("media.document.set", () => {
        throw Error("save failed");
      });
    const receipt = controller.startRender(current, "approved");
    if (mode !== "save") {
      await until(() => starts === 1);
      const interruptedDocument = structuredClone(host.document);
      const restoredHost = new FakeHost();
      restoredHost.document = interruptedDocument;
      const restored = new ProductionController(restoredHost, {
        getProject: () => current,
        publishAssets: async () => {},
        changed() {},
        renderCanonical: async () => {
          assert.fail("Never restart interrupted staging");
        },
      });
      controllers.add(restored);
      await restored.initialize();
      assert.equal(restored.startRender(current, "approved").status, "interrupted");
      if (mode === "cancel") {
        await controller.cancel(receipt.operationId);
        assert.equal(controller.renderSubmissions[0]!.status, "cancelling");
        assert.equal(controller.hasPendingRenderSubmission, true);
      }
      if (mode === "revision") current.revision++;
      if (mode === "run") await controller.setAuto({ ...controller.auto!, phase: "failed" });
    }
    gate.resolve();
    await until(() => controller.renderSubmissions[0]?.status === "failed");
    assert.equal(actual, 0);
    assert.equal(starts, mode === "save" ? 0 : 1);
    assert.match(controller.renderSubmissions[0]!.error!, /取消|变化|结束|save failed/);
  }
});

test("cancellation racing native admission keeps and cancels the actual job receipt", async () => {
  const host = new FakeHost(),
    current = project(),
    gate = deferred<void>(),
    job = renderTask();
  let started = false;
  host.handlers.set("media.jobs.cancel", ({ id }) => {
    assert.equal(id, job.id);
    return { ...job, status: "cancelled" };
  });
  const controller = new ProductionController(host, {
    getProject: () => current,
    publishAssets: async () => {},
    changed() {},
    renderCanonical: async () => {
      started = true;
      await gate.promise;
      host.jobs.set(job.id, { ...job, type: "render" });
      return job;
    },
  });
  controllers.add(controller);
  await controller.initialize();
  const receipt = controller.startRender(current, "approved");
  await until(() => started);
  await controller.cancel(receipt.operationId);
  gate.resolve();
  await until(() => host.calls.some((call) => call.method === "media.jobs.cancel"));
  assert.equal(controller.renderSubmissions[0]!.jobId, job.id);
  assert.equal(
    controller.renderSubmissions[0]!.status,
    "submitted",
    "An accepted native job remains a real job even after cancellation was requested",
  );
  assert.ok(controller.currentJobs.some((item) => item.id === job.id));
});

test("bounded render receipts retire finished admissions without losing real task bindings", async () => {
  const host = new FakeHost(),
    current = project(),
    gate = deferred<void>();
  const submissions = Array.from({ length: 100 }, (_, index) => ({
    accepted: true,
    operationId: `render-${crypto.randomUUID()}`,
    projectId: current.id,
    revision: 0,
    status: "submitted",
    createdAt: index,
    updatedAt: index,
    requestToken: `older-${index}`,
    jobId: `job-render-${index}`,
  }));
  host.document = {
    schemaVersion: 1,
    bindings: Object.fromEntries(
      submissions.map((item) => [
        `${item.jobId}:${current.id}`,
        { jobId: item.jobId, projectId: current.id, purpose: "render", consumed: true },
      ]),
    ),
    auto: null,
    renderSubmissions: submissions,
  };
  const controller = new ProductionController(host, {
    getProject: () => current,
    publishAssets: async () => {},
    changed() {},
    renderCanonical: async (_project, options) => {
      await gate.promise;
      options?.assertCurrent?.();
      return renderTask();
    },
  });
  controllers.add(controller);
  await controller.initialize();
  const receipt = controller.startRender(current, "current");
  assert.equal(controller.renderSubmissions.length, 100);
  assert.ok(controller.renderSubmissions.some((item) => item.operationId === receipt.operationId));
  assert.equal(
    controller.renderSubmissions.some((item) => item.operationId === submissions[0]!.operationId),
    false,
  );
  await until(() =>
    host.document.renderSubmissions.some((item: any) => item.operationId === receipt.operationId),
  );
  assert.equal(
    Object.keys(host.document.bindings).length,
    100,
    "Native jobs stay discoverable after old admission receipts are retired",
  );
  await controller.cancel(receipt.operationId);
  gate.resolve();
  await until(
    () =>
      controller.renderSubmissions.find((item) => item.operationId === receipt.operationId)
        ?.status === "failed",
  );
});
function project(id = "project-a"): Project {
  const value = createProject("测试制作");
  value.id = id;
  value.assets = [{ id: "source", name: "原片", kind: "video", mediaId, durationFrames: 300 }];
  value.clips = [{ id: "clip", assetId: "source", inFrame: 0, outFrame: 300, volume: 1 }];
  return validateProject(value);
}
function prepared(id = mediaId): PreparedMedia {
  return {
    assetId: id,
    inspection: {
      kind: "video",
      durationSeconds: 10,
      video: { width: 1920, height: 1080, displayWidth: 1920, displayHeight: 1080 },
      audio: { channels: 2 },
    },
  };
}
class FakeHost implements PanelBridge {
  document: any = null;
  revision = 0;
  writes = 0;
  jobs = new Map<string, MediaJob>();
  calls: { method: string; params: any }[] = [];
  handlers = new Map<string, (params: any) => unknown | Promise<unknown>>();
  getContext = async () => ({});
  registerTool = () => () => {};
  on = () => () => {};
  managed(id = mediaId): ManagedAsset {
    return { id, name: "原片.mp4", mimeType: "video/mp4", bytes: 1000, createdAt: 1 };
  }
  add(type: string, status: MediaJob["status"] = "queued", result?: unknown): MediaJob {
    const job: MediaJob = {
      id: `job-${this.jobs.size + 1}`,
      type,
      status,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      attempt: 1,
      ...(result === undefined ? {} : { result }),
    };
    this.jobs.set(job.id, job);
    return structuredClone(job);
  }
  async call(method: string, raw?: unknown): Promise<unknown> {
    const params = raw as any;
    this.calls.push({ method, params: structuredClone(params) });
    const handler = this.handlers.get(method);
    if (handler) return handler(params);
    if (method === "media.status")
      return {
        persistent: true,
        ffmpeg: { available: true },
        transcription: { available: true },
        hyperframes: { available: true },
      };
    if (method === "media.document.get")
      return { revision: this.revision, data: structuredClone(this.document) };
    if (method === "media.document.set") {
      assert.equal(params.baseRevision, this.revision);
      this.document = structuredClone(params.data);
      this.writes++;
      return { revision: ++this.revision };
    }
    if (method === "media.jobs.list")
      return {
        jobs: [...this.jobs.values()].map(({ result, ...summary }) => structuredClone(summary)),
      };
    if (method === "media.jobs.get") {
      const job = this.jobs.get(params.id);
      if (!job) throw new Error("missing job");
      return structuredClone(job);
    }
    if (method === "media.assets.get")
      return { asset: this.managed(params.id), preparation: prepared(params.id) };
    if (method === "media.prepare")
      return {
        jobs: params.assetIds.map((id: string) => this.add("prepare", "queued", prepared(id))),
      };
    if (method === "media.transcribe") return this.add("transcribe");
    if (method === "media.import")
      return this.add("import", "succeeded", { assets: [this.managed()] });
    if (method === "agent.task.start") return { id: "task-1", status: "running" };
    if (method === "agent.task.get") return { id: params.id, status: "running" };
    if (method === "agent.task.cancel") return {};
    throw new Error(`unhandled ${method}`);
  }
}
async function fixture(host = new FakeHost()) {
  let current = project();
  const published: { projectId: string; assets: Asset[]; options?: AssetPublication }[] = [];
  let changed = () => {};
  let beforePublish: (() => Promise<void>) | undefined;
  const controller = new ProductionController(host, {
    getProject: () => current,
    inspectImportedAsset: async (asset) => {
      const inspect = host.handlers.get("browser.inspect");
      return inspect
        ? ((await inspect(asset)) as PreparedMedia["inspection"])
        : prepared(asset.id).inspection;
    },
    changed: () => changed(),
    publishAssets: async (projectId, assets, options) => {
      await beforePublish?.();
      assert.equal(projectId, current.id, "never publish into a different project");
      published.push({
        projectId,
        assets: structuredClone(assets),
        ...(options ? { options: structuredClone(options) } : {}),
      });
      const merged = new Map(current.assets.map((asset) => [asset.id, asset]));
      for (const asset of assets) merged.set(asset.id, asset);
      current = validateProject({ ...current, assets: [...merged.values()] });
    },
  });
  controllers.add(controller);
  await controller.initialize();
  return {
    host,
    controller,
    published,
    get current() {
      return current;
    },
    set current(value: Project) {
      current = value;
    },
    changed(callback: () => void) {
      changed = callback;
    },
    beforePublish(callback?: () => Promise<void>) {
      beforePublish = callback;
    },
  };
}
function binding(host: FakeHost, id: string, projectId = "project-a") {
  return Object.values(host.document.bindings).find(
    (value: any) => value.jobId === id && value.projectId === projectId,
  ) as any;
}

test("unavailable media services preserve their failure reason without starting production", async () => {
  for (const [result, reason] of [
    [
      () => {
        throw new Error("当前项目未授权 media 权限");
      },
      /当前项目未授权 media 权限/,
    ],
    [() => ({ persistent: false }), /尚未提供持久媒体服务/],
  ] as const) {
    const host = new FakeHost();
    host.handlers.set("media.status", result);
    const f = await fixture(host);
    assert.equal(f.controller.enabled, false);
    assert.match(f.controller.error, /媒体服务/);
    assert.match(f.controller.error, /重新打开/);
    assert.match(f.controller.error, reason);
    assert.deepEqual(
      host.calls.map((call) => call.method),
      ["media.status"],
    );
    assert.equal(host.writes, 0, "capability failure must not write production state");
  }
});

test("malformed production bindings and automatic state preserve storage and block writes", async () => {
  for (const document of [
    { schemaVersion: 1, bindings: { "job-1": null }, auto: null },
    {
      schemaVersion: 1,
      bindings: { "job-1": { projectId: "project-a", purpose: "execute" } },
      auto: null,
    },
    {
      schemaVersion: 1,
      bindings: {},
      auto: {
        projectId: "project-a",
        prompt: "剪片",
        phase: "preparing",
        attempts: 4,
        startedAt: 1,
      },
    },
    {
      schemaVersion: 1,
      bindings: {},
      auto: {
        projectId: "project-a",
        prompt: "剪片",
        phase: "surprise",
        attempts: 0,
        startedAt: 1,
      },
    },
    {
      schemaVersion: 1,
      bindings: {},
      auto: {
        projectId: "project-a",
        prompt: "剪片",
        mode: "execute-anything",
        phase: "preparing",
        attempts: 0,
        startedAt: 1,
      },
    },
  ]) {
    const host = new FakeHost();
    host.document = structuredClone(document);
    host.revision = 1;
    const f = await fixture(host);
    assert.match(f.controller.error, /保留/);
    await assert.rejects(f.controller.prepare(["source"]), /保留/);
    assert.equal(host.writes, 0);
    assert.deepEqual(host.document, document);
  }
});

test("a completed prepare response is consumed automatically and reopening does not consume twice", async () => {
  const f = await fixture();
  const job = f.host.add("prepare", "succeeded", prepared());
  f.host.handlers.set("media.prepare", () => ({ jobs: [job] }));
  await f.controller.prepare(["source"]);
  await until(() => f.published.length === 1);
  await f.controller.refresh();
  assert.equal(binding(f.host, job.id).consumed, true);
  assert.equal(f.published[0]!.projectId, "project-a");
  f.controller.dispose();
  const reopened = await fixture(f.host);
  await reopened.controller.refresh();
  assert.equal(reopened.published.length, 0);
});

test("asset deletion stays gated through successful lookup, publication and durable consumption", async () => {
  const f = await fixture();
  const job = f.host.add("prepare", "queued", prepared());
  f.host.handlers.set("media.prepare", () => ({ jobs: [job] }));
  await f.controller.prepare(["source"]);
  await f.controller.refresh();
  assert.equal(f.controller.hasPendingAssetPublication, true);
  f.host.jobs.get(job.id)!.status = "running";
  await f.controller.refresh();
  assert.equal(f.controller.hasPendingAssetPublication, true);
  f.current = project("project-b");
  assert.equal(f.controller.hasPendingAssetPublication, false);
  f.current = project();

  const lookup = deferred<unknown>(),
    publication = deferred<void>(),
    receipt = deferred<void>();
  let lookupEntered = false,
    publicationEntered = false,
    receiptEntered = false;
  f.host.handlers.set("media.assets.get", () => {
    lookupEntered = true;
    return lookup.promise;
  });
  f.beforePublish(async () => {
    publicationEntered = true;
    await publication.promise;
  });
  f.host.handlers.set("media.document.set", async (params) => {
    if (Object.values(params.data.bindings).some((row: any) => row.consumed)) {
      receiptEntered = true;
      await receipt.promise;
    }
    assert.equal(params.baseRevision, f.host.revision);
    f.host.document = structuredClone(params.data);
    return { revision: ++f.host.revision };
  });
  f.host.jobs.get(job.id)!.status = "succeeded";
  const refreshing = f.controller.refresh();
  await until(() => lookupEntered);
  assert.equal(f.controller.pendingJobs.length, 0, "Successful work is no longer a running job");
  assert.equal(f.controller.hasPendingAssetPublication, true);
  lookup.resolve({ asset: f.host.managed() });
  await until(() => publicationEntered);
  assert.equal(f.controller.hasPendingAssetPublication, true);
  publication.resolve();
  await until(() => receiptEntered);
  assert.equal(f.published.length, 1);
  assert.equal(
    f.controller.hasPendingAssetPublication,
    true,
    "An unacknowledged consumption write cannot allow removal",
  );
  receipt.resolve();
  await refreshing;
  assert.equal(binding(f.host, job.id).consumed, true);
  assert.equal(f.controller.hasPendingAssetPublication, false);
});

test("concurrent import and prepare admissions remain scoped and gated until cancellation or failure settles", async () => {
  for (const method of ["media.import", "media.prepare"] as const) {
    const f = await fixture();
    const gates = [deferred<void>(), deferred<void>()];
    let called = 0;
    f.host.handlers.set(method, async () => {
      const index = called++;
      await gates[index]!.promise;
      if (index === 1) throw new Error("start rejected");
      return method === "media.import" ? { cancelled: true } : { jobs: [] };
    });
    const start = () =>
      method === "media.import" ? f.controller.importFiles() : f.controller.prepare(["source"]);
    const first = start();
    const second = assert.rejects(start(), /start rejected/);
    assert.equal(f.controller.currentJobs.length, 0);
    assert.equal(f.controller.hasPendingAssetPublication, true);
    f.current = project("project-b");
    assert.equal(f.controller.hasPendingAssetPublication, false);
    f.current = project();
    gates[0]!.resolve();
    await first;
    assert.equal(
      f.controller.hasPendingAssetPublication,
      true,
      "One settled request cannot clear another request's guard",
    );
    gates[1]!.resolve();
    await second;
    assert.equal(f.controller.hasPendingAssetPublication, false);
  }
});

test("an imported original remains pending while browser inspection awaits its publication", async () => {
  const f = await fixture();
  f.current = { ...createProject(), id: "project-a" };
  f.controller.status.ffmpeg.available = false;
  const inspection = deferred<PreparedMedia["inspection"]>();
  let entered = false;
  f.host.handlers.set("browser.inspect", () => {
    entered = true;
    return inspection.promise;
  });
  const result = await f.controller.importFiles();
  await until(() => entered);
  assert.equal(f.controller.pendingJobs.length, 0);
  assert.equal(f.controller.hasPendingAssetPublication, true);
  inspection.resolve(prepared().inspection);
  await f.controller.refresh();
  assert.equal(binding(f.host, result.job!.id).consumed, true);
  assert.equal(f.controller.hasPendingAssetPublication, false);
});

test("late managed-asset lookup cannot publish into a newly selected project", async () => {
  const f = await fixture();
  const job = f.host.add("prepare", "succeeded", prepared());
  f.host.handlers.set("media.prepare", () => ({ jobs: [job] }));
  const gate = deferred<unknown>();
  let entered = false;
  f.host.handlers.set("media.assets.get", () => {
    entered = true;
    return gate.promise;
  });
  await f.controller.prepare(["source"]);
  await until(() => entered);
  f.current = project("project-b");
  gate.resolve({ asset: f.host.managed() });
  await f.controller.refresh();
  assert.equal(f.published.length, 0);
  assert.equal(binding(f.host, job.id).consumed, undefined);
  f.host.handlers.delete("media.assets.get");
  f.current = project();
  await f.controller.refresh();
  assert.equal(f.published[0]!.projectId, "project-a");
});

test("the same managed job keeps independent consumption bindings in two projects", async () => {
  const f = await fixture();
  const job = f.host.add("prepare", "queued", prepared());
  f.host.handlers.set("media.prepare", () => ({
    jobs: [structuredClone(f.host.jobs.get(job.id))],
  }));
  await f.controller.prepare(["source"]);
  await f.controller.refresh();
  f.current = project("project-b");
  await f.controller.prepare(["source"]);
  await f.controller.refresh();
  f.host.jobs.get(job.id)!.status = "succeeded";
  await f.controller.refresh();
  assert.equal(binding(f.host, job.id, "project-b").consumed, true);
  assert.equal(binding(f.host, job.id).consumed, undefined);
  f.current = project();
  await f.controller.refresh();
  assert.deepEqual(
    f.published.map((value) => value.projectId),
    ["project-b", "project-a"],
  );
});

test("failed publication and failed consumption writes leave completed jobs retryable", async () => {
  const f = await fixture();
  const job = f.host.add("prepare", "succeeded", prepared());
  f.host.handlers.set("media.prepare", () => ({ jobs: [job] }));
  let failPublish = true;
  f.beforePublish(async () => {
    if (failPublish) throw new Error("project save failed");
  });
  await f.controller.prepare(["source"]);
  await assert.rejects(f.controller.refresh(), /project save failed/);
  assert.equal(binding(f.host, job.id).consumed, undefined);
  assert.equal(f.controller.hasPendingAssetPublication, true);
  failPublish = false;
  let failConsumed = true;
  f.host.handlers.set("media.document.set", (params) => {
    if (failConsumed && Object.values(params.data.bindings).some((value: any) => value.consumed))
      throw new Error("consumption save failed");
    assert.equal(params.baseRevision, f.host.revision);
    f.host.document = structuredClone(params.data);
    return { revision: ++f.host.revision };
  });
  await assert.rejects(f.controller.refresh(), /consumption save failed/);
  assert.equal(binding(f.host, job.id).consumed, undefined);
  assert.equal(f.controller.hasPendingAssetPublication, true);
  failConsumed = false;
  await f.controller.refresh();
  assert.equal(binding(f.host, job.id).consumed, true);
  assert.equal(f.current.assets.length, 1);
  assert.equal(f.controller.hasPendingAssetPublication, false);
});

test("import publishes its original before optional preparation and a reopened controller preserves its identity", async () => {
  const f = await fixture();
  f.current = { ...project(), assets: [], clips: [] };
  const imported = await f.controller.importFiles();
  await f.controller.refresh();
  assert.equal(binding(f.host, imported.job!.id).consumed, true);
  assert.equal(f.published.length, 1);
  assert.equal(f.current.assets[0]!.mediaId, mediaId);
  const original = structuredClone(f.current);
  const child = [...f.host.jobs.values()].find((job) => job.type === "prepare")!;
  child.status = "succeeded";
  f.controller.dispose();
  const reopened = await fixture(f.host);
  reopened.current = original;
  await reopened.controller.refresh();
  assert.equal(reopened.current.assets[0]!.mediaId, mediaId);
  assert.equal(reopened.current.assets[0]!.id, original.assets[0]!.id);
  assert.equal(reopened.current.assets.length, 1);
  assert.equal(binding(f.host, child.id).consumed, true);
});

test("missing preprocessing tools do not block publishing browser-decodable originals", async () => {
  const host = new FakeHost();
  host.handlers.set("media.status", () => ({
    persistent: true,
    ffmpeg: { available: false },
    transcription: { available: false },
    hyperframes: { available: false },
  }));
  const f = await fixture(host);
  f.current = { ...project(), assets: [], clips: [] };
  const imported = await f.controller.importFiles();
  await f.controller.refresh();
  assert.equal(f.current.assets[0]!.mediaId, mediaId);
  assert.equal(f.current.assets[0]!.durationFrames, 300);
  assert.equal(binding(host, imported.job!.id).consumed, true);
  assert.ok(!host.calls.some((call) => call.method === "media.prepare"));
  assert.match(f.controller.error, /原片已保留.*预处理工具尚未就绪/);
});

test("preparation submission failure leaves the durable original visible and does not replay import", async () => {
  const f = await fixture();
  f.current = { ...project(), assets: [], clips: [] };
  f.host.handlers.set("media.prepare", () => {
    throw new Error("测试：运行权限尚未授权");
  });
  const imported = await f.controller.importFiles();
  await f.controller.refresh();
  const saved = structuredClone(f.current);
  assert.equal(saved.assets[0]!.mediaId, mediaId);
  assert.equal(binding(f.host, imported.job!.id).consumed, true);
  assert.match(f.controller.error, /原片已保留.*测试：运行权限尚未授权/);
  await f.controller.refresh();
  assert.deepEqual(f.current, saved);
  assert.equal(f.published.length, 1);
  assert.equal(f.host.calls.filter((call) => call.method === "media.prepare").length, 1);
});

test("failed optional preparation retains original clips and rough-cut marks after reopening", async () => {
  const f = await fixture();
  f.current = {
    ...project(),
    roughCuts: [
      {
        id: "keep-source",
        assetId: "source",
        inFrame: 30,
        outFrame: 120,
        name: "保留段",
        enabled: true,
      },
    ],
  };
  const before = structuredClone(f.current);
  await f.controller.importFiles();
  await f.controller.refresh();
  const child = [...f.host.jobs.values()].find((job) => job.type === "prepare")!;
  child.status = "failed";
  child.error = { code: "PROCESSOR_FAILED", message: "测试：代理生成失败", retryable: true };
  f.controller.dispose();
  const reopened = await fixture(f.host);
  reopened.current = before;
  await reopened.controller.refresh();
  assert.deepEqual(reopened.current, before);
  assert.deepEqual(reopened.published, []);
  assert.match(reopened.controller.error, /原片已保留.*测试：代理生成失败/);
  assert.equal(binding(f.host, child.id).consumed, true);
});

test("unsupported browser formats still use native preparation before publishing", async () => {
  const f = await fixture();
  f.current = { ...project(), assets: [], clips: [] };
  f.host.handlers.set("browser.inspect", () => {
    throw new Error("不支持浏览器解码");
  });
  await f.controller.importFiles();
  await f.controller.refresh();
  assert.deepEqual(f.published, []);
  const child = [...f.host.jobs.values()].find((job) => job.type === "prepare")!;
  child.status = "succeeded";
  child.updatedAt++;
  await f.controller.refresh();
  assert.equal(f.current.assets[0]!.mediaId, mediaId);
});

test("interrupted import consumption reuses its published source and already tracked preparation", async () => {
  const f = await fixture();
  f.current = { ...project(), assets: [], clips: [] };
  let rejectConsumption = true;
  f.host.handlers.set("media.document.set", (params) => {
    if (
      rejectConsumption &&
      Object.values(params.data.bindings).some(
        (row: any) => row.purpose === "import" && row.consumed,
      )
    )
      throw new Error("测试：导入回执暂未保存");
    f.host.document = structuredClone(params.data);
    return { revision: ++f.host.revision };
  });
  const imported = await f.controller.importFiles();
  await assert.rejects(f.controller.refresh(), /导入回执暂未保存/);
  const saved = structuredClone(f.current);
  assert.equal(saved.assets[0]!.mediaId, mediaId);
  assert.equal(binding(f.host, imported.job!.id).consumed, undefined);
  rejectConsumption = false;
  f.controller.dispose();
  const reopened = await fixture(f.host);
  reopened.current = saved;
  await reopened.controller.refresh();
  assert.deepEqual(reopened.current, saved);
  assert.deepEqual(reopened.published, []);
  assert.equal(f.host.calls.filter((call) => call.method === "media.prepare").length, 1);
  assert.equal(binding(f.host, imported.job!.id).consumed, true);
});

test("failed original publication preserves an unconsumed import and starts no preparation", async () => {
  const f = await fixture();
  f.current = { ...project(), assets: [], clips: [] };
  f.beforePublish(async () => {
    throw new Error("测试：工程原片引用保存失败");
  });
  const imported = await f.controller.importFiles();
  await assert.rejects(f.controller.refresh(), /工程原片引用保存失败/);
  assert.deepEqual(f.current.assets, []);
  assert.deepEqual(f.published, []);
  assert.equal(binding(f.host, imported.job!.id).consumed, undefined);
  assert.ok(!f.host.calls.some((call) => call.method === "media.prepare"));
  f.beforePublish(undefined);
  await f.controller.refresh();
  assert.equal(f.current.assets[0]!.mediaId, mediaId);
  assert.equal(binding(f.host, imported.job!.id).consumed, true);
});

test("switching projects during original inspection leaves the import for its original project", async () => {
  const f = await fixture();
  const original = { ...project(), assets: [], clips: [] };
  f.current = original;
  f.host.handlers.set("browser.inspect", () => {
    f.current = project("other-project");
    return prepared().inspection;
  });
  const imported = await f.controller.importFiles();
  await f.controller.refresh();
  assert.deepEqual(f.published, []);
  assert.equal(binding(f.host, imported.job!.id).consumed, undefined);
  assert.ok(!f.host.calls.some((call) => call.method === "media.prepare"));
  f.host.handlers.delete("browser.inspect");
  f.current = original;
  await f.controller.refresh();
  assert.equal(f.current.assets[0]!.mediaId, mediaId);
});

test("recording upload returns its durable original even when preparation fails", async () => {
  const f = await fixture();
  const id = `asset-${"c".repeat(64)}`;
  const bytes = new Uint8Array([3, 8, 15, 21, 34, 55, 89]);
  const chunks: Uint8Array[] = [];
  f.host.handlers.set("media.recording.begin", (params) => {
    assert.equal(params.expectedBytes, bytes.length);
    assert.equal(params.mimeType, "audio/webm");
    return { sessionId: "recording-session", maxChunkBytes: 3 };
  });
  f.host.handlers.set("media.recording.write", (params) => {
    assert.equal(params.sessionId, "recording-session");
    assert.equal(params.sequence, chunks.length);
    assert.equal(
      params.offset,
      chunks.reduce((sum, chunk) => sum + chunk.length, 0),
    );
    chunks.push(Buffer.from(params.dataBase64, "base64"));
    return {};
  });
  f.host.handlers.set("media.recording.finish", () => ({
    asset: {
      id,
      name: "本人完整录音.webm",
      mimeType: "audio/webm",
      bytes: bytes.length,
      createdAt: 1,
    },
    inspection: { kind: "audio", durationSeconds: 47, audio: { channels: 1 } },
  }));
  f.host.handlers.set("media.prepare", () => {
    throw new Error("暂时无法预处理");
  });
  const progress: number[] = [];
  const originalClips = structuredClone(f.current.clips);
  const result = await f.controller.importRecording(
    new Blob([bytes], { type: "audio/webm" }),
    "本人完整录音.webm",
    (fraction) => progress.push(fraction),
  );
  assert.deepEqual([...Buffer.concat(chunks)], [...bytes]);
  assert.equal(result.id, id);
  assert.equal(result.kind, "audio");
  assert.equal(result.durationFrames, 47 * 30);
  assert.equal(f.current.assets.find((asset) => asset.id === id)?.durationFrames, 47 * 30);
  assert.equal(f.published.length, 1);
  assert.equal(progress.at(-1), 1);
  assert.match(f.controller.error, /暂时无法预处理/);
  assert.deepEqual(f.current.clips, originalClips);
  assert.deepEqual(f.current.audioClips, []);
  assert.equal(f.host.calls.filter(({ method }) => method === "media.recording.begin").length, 1);
  assert.equal(f.host.calls.filter(({ method }) => method === "media.recording.finish").length, 1);
  assert.equal(
    f.host.calls.some(({ method }) => method === "media.recording.cancel"),
    false,
  );
});

function automatic(f: Awaited<ReturnType<typeof fixture>>) {
  const states: { task: PanelTask | null; starting: boolean; message: string; token: string }[] =
    [];
  const producer = new AutomaticProducer(f.host, f.controller, {
    getProject: () => f.current,
    assertEditable() {},
    state(task, starting, message, token) {
      states.push({ task, starting, message, token });
    },
  });
  return { producer, states };
}
const starts = (host: FakeHost) => host.calls.filter((call) => call.method === "agent.task.start");

async function narratedProject(): Promise<Project> {
  let current = project();
  current.script = "先从海边出发，然后走进老街。";
  current.assets.push({
    id: "own-take",
    mediaId: `asset-${"b".repeat(64)}`,
    name: "本人录音",
    kind: "audio",
    durationFrames: 150,
  });
  // A confirmed draft and chosen take, as older versions saved them (30 fps view digest).
  current = validateProject(current);
  current.narration = {
    phase: "recorded",
    captionBasis: "draft",
    draftCaptionIds: [],
    approvedScript: current.script,
    approvedFingerprint: await narrationFingerprint(current),
    recordingAssetId: "own-take",
  };
  return validateProject(current);
}

function narrationRun(current: Project, phase: AutoProduction["phase"] = "agent"): AutoProduction {
  return {
    projectId: current.id,
    runId: "narration-run",
    mode: "narration",
    prompt: "用本人的录音继续完成",
    phase,
    attempts: 1,
    startedAt: 1,
    preparationJobIds: [],
    ...(phase === "agent" ? { taskId: "task-live", requestToken: "live-token" } : {}),
  };
}

test("draft uses its owning skill and rejects proposal, voice and export shortcuts", async () => {
  const f = await fixture();
  const original = structuredClone(f.current);
  const { producer } = automatic(f);
  await producer.start("二十条旅行素材和三点想法，先剪草稿，确认后我再口播", { mode: "draft" });
  assert.equal(starts(f.host).length, 1);
  assert.equal(starts(f.host)[0]!.params.skill, "video-studio:narration-workflow");
  assert.equal(starts(f.host)[0]!.params.key, "narration-workflow-draft");
  assert.match(starts(f.host)[0]!.params.prompt, /停下等用户确认/);
  assert.match(starts(f.host)[0]!.params.prompt, /不调用TTS或导出/);
  assert.ok(starts(f.host)[0]!.params.skills.includes("video-studio:editor-v2"));
  assert.match(starts(f.host)[0]!.params.prompt, /editor\.grant/);
  assert.match(starts(f.host)[0]!.params.prompt, /captions 的 add 步骤补充临时字幕/);
  assert.match(starts(f.host)[0]!.params.prompt, /set_video_script[^。]*自动生成估时的临时字幕/);
  assert.doesNotMatch(starts(f.host)[0]!.params.prompt, /旧 caption 操作|draft-narration-/);
  assert.doesNotMatch(starts(f.host)[0]!.params.prompt, /需要导出时统一调用/);
  assert.doesNotMatch(starts(f.host)[0]!.params.prompt, /只接受不改变本人录音依赖/);
  for (const name of [
    "prepare_video_assets",
    "apply_video_edit",
    "apply_editor_edit",
    "set_video_script",
    "create_video_scene",
  ])
    assert.doesNotThrow(() => producer.assertToolAllowed(name));
  for (const name of [
    "propose_video_edit",
    "create_video_voiceover",
    "render_video_project",
    "enhance_video_audio",
    "setup_video_tts",
    "finish_video_tts_setup",
    "unknown_write",
  ])
    assert.throws(() => producer.assertToolAllowed(name));
  assert.equal(f.host.calls.filter(({ method }) => method === "media.prepare").length, 0);
  assert.deepEqual(f.current, original);
  const id = f.controller.auto!.taskId!;
  await producer.finishForReview("草稿已保存，等待本人确认");
  await producer.handleTask({ id, status: "completed" });
  await producer.resume();
  assert.equal(f.controller.auto!.phase, "done");
  assert.equal(producer.requestToken, "");
  assert.equal(starts(f.host).length, 1);
});

test("unfinished draft cannot quietly enter another production round", async () => {
  const f = await fixture();
  f.host.handlers.set("agent.task.start", () => ({ id: "draft-incomplete", status: "completed" }));
  const { producer } = automatic(f);
  await producer.start("先做待确认草稿", { mode: "draft" });
  for (let index = 0; index < 3; index++) await producer.resume();
  assert.equal(starts(f.host).length, 1);
  assert.equal(f.controller.auto!.phase, "failed");
  assert.match(f.controller.auto!.message ?? "", /草稿尚未完整保存/);
});

test("narration locks before digest validation so double starts prepare only the selected recording once", async () => {
  const f = await fixture();
  f.current = await narratedProject();
  f.host.handlers.set("media.prepare", () => ({ jobs: [] }));
  const { producer } = automatic(f);
  f.changed(() => {
    void producer.resume();
  });
  const first = producer.start("把我的口播剪进去", { mode: "narration" });
  const duplicate = producer.start("把我的口播剪进去", { mode: "narration" });
  await Promise.all([first, duplicate]);
  assert.equal(starts(f.host).length, 1);
  assert.equal(starts(f.host)[0]!.params.key, "narration-workflow-narration");
  const narrationPrompt = starts(f.host)[0]!.params.prompt;
  assert.match(narrationPrompt, /editor 分支可以编排画面和本人录音/);
  assert.match(narrationPrompt, /改写文稿、改变画幅或替换本人录音素材的编辑会被拒绝/);
  assert.doesNotMatch(narrationPrompt, /录音编排与字幕对齐沿用旧 apply_video_edit/);
  assert.match(narrationPrompt, /需要导出时统一调用 render_video_project/);
  assert.doesNotMatch(narrationPrompt, /临时字幕仍用旧 caption 操作/);
  const preparation = f.host.calls.filter(({ method }) => method === "media.prepare");
  assert.equal(preparation.length, 1);
  assert.deepEqual(preparation[0]!.params.assetIds, [`asset-${"b".repeat(64)}`]);
  assert.equal(preparation[0]!.params.transcribe, true);
  for (const name of [
    "propose_video_edit",
    "set_video_script",
    "create_video_voiceover",
    "enhance_video_audio",
    "setup_video_tts",
    "render_video_project",
  ])
    assert.throws(() => producer.assertToolAllowed(name));
  for (const name of [
    "apply_video_edit",
    "apply_editor_edit",
    "prepare_video_assets",
    "create_video_scene",
  ])
    assert.doesNotThrow(() => producer.assertToolAllowed(name));
});

test("narration preflight rejects stale approval or unavailable transcription without submitting work", async () => {
  for (const problem of ["draft", "trim", "transcription"] as const) {
    const f = await fixture();
    f.current = await narratedProject();
    if (problem === "draft") f.current.narration!.phase = "review";
    if (problem === "trim") f.current.clips[0]!.outFrame--;
    if (problem === "transcription") f.controller.status.transcription.available = false;
    const { producer } = automatic(f);
    await assert.rejects(producer.start("本人录音后期", { mode: "narration" }));
    assert.equal(starts(f.host).length, 0);
    assert.equal(f.host.calls.filter(({ method }) => method === "media.prepare").length, 0);
    assert.equal(f.controller.auto, null);
    // A failed check must release the submission lock for another authorized workflow.
    await producer.start("先继续整理草稿", { mode: "draft" });
    assert.equal(starts(f.host).length, 1);
  }
});

test("editing during narration fingerprint validation prevents starting an old request", async () => {
  const f = await fixture();
  f.current = await narratedProject();
  const { producer } = automatic(f);
  const pending = producer.start("继续本人口播后期", { mode: "narration" });
  f.current = structuredClone(f.current);
  f.current.clips[0]!.outFrame--;
  f.current.revision++;
  await assert.rejects(pending, /检查期间工程已改变/);
  assert.equal(f.controller.auto, null);
  assert.equal(starts(f.host).length, 0);
  assert.equal(
    f.host.calls.some(({ method }) => method === "media.prepare"),
    false,
  );
});

test("reopened narration validates actual fingerprint before reconnecting or restarting", async () => {
  for (const phase of ["agent", "waiting"] as const) {
    const f = await fixture();
    f.current = await narratedProject();
    const saved = structuredClone(f.current);
    await f.controller.setAuto(narrationRun(f.current, phase));
    f.controller.dispose();
    const reopened = await fixture(f.host);
    reopened.current = saved;
    // Both saved phase and script still look approved; only the picture content has changed.
    reopened.current.clips[0]!.outFrame--;
    const { producer } = automatic(reopened);
    const offset = f.host.calls.length;
    await producer.resume();
    assert.equal(reopened.controller.auto!.phase, "failed");
    assert.equal(producer.requestToken, "");
    assert.match(reopened.controller.auto!.message ?? "", /重新确认/);
    assert.equal(
      f.host.calls.slice(offset).some(({ method }) => method.startsWith("agent.task.")),
      false,
    );
  }
});

test("valid saved alignment work reconnects while preserving original approval and source", async () => {
  const f = await fixture();
  f.current = await narratedProject();
  const originalApproval = f.current.narration!.approvedFingerprint;
  f.current.audioClips = [
    { id: "own-voice", assetId: "own-take", startFrame: 0, inFrame: 0, outFrame: 150, volume: 1 },
  ];
  f.current.narration!.alignmentFingerprint = await narrationFingerprint(f.current);
  await f.controller.setAuto(narrationRun(f.current));
  const saved = structuredClone(f.current);
  f.controller.dispose();
  const reopened = await fixture(f.host);
  reopened.current = saved;
  const { producer } = automatic(reopened);
  await producer.resume();
  assert.equal(reopened.controller.auto!.phase, "agent");
  assert.equal(producer.requestToken, "live-token");
  assert.equal(starts(f.host).length, 0);
  assert.equal(reopened.current.narration!.approvedFingerprint, originalApproval);
  assert.throws(() => producer.assertToolAllowed("render_video_project"));
  reopened.current.narration!.phase = "aligned";
  reopened.current.narration!.captionBasis = "recording";
  assert.doesNotThrow(() => producer.assertToolAllowed("render_video_project"));
});

test("narration rechecks approval after refreshing background jobs", async () => {
  const f = await fixture();
  f.current = await narratedProject();
  await f.controller.setAuto(narrationRun(f.current, "waiting"));
  f.host.handlers.set("media.jobs.list", () => {
    f.current.clips[0]!.outFrame--;
    return { jobs: [] };
  });
  const { producer } = automatic(f);
  await producer.resume();
  assert.equal(f.controller.auto!.phase, "failed");
  assert.equal(starts(f.host).length, 0);
});

test("late narration task completion rechecks content and cannot accept a stale export", async () => {
  const f = await fixture();
  f.current = await narratedProject();
  f.current.narration!.phase = "aligned";
  f.current.narration!.captionBasis = "recording";
  await f.controller.setAuto(narrationRun(f.current));
  const { producer } = automatic(f);
  f.current.clips[0]!.volume = 0;
  await producer.handleTask({ id: "task-live", status: "completed" });
  assert.equal(f.controller.auto!.phase, "failed");
  assert.equal(producer.requestToken, "");
  assert.match(f.controller.auto!.message ?? "", /重新确认/);
});

test("a completed export satisfies narration only after actual alignment state", async () => {
  for (const phase of ["agent", "waiting"] as const) {
    for (const aligned of [false, true]) {
      const f = await fixture();
      f.current = await narratedProject();
      if (aligned) {
        f.current.narration!.phase = "aligned";
        f.current.narration!.captionBasis = "recording";
      }
      await f.controller.setAuto(narrationRun(f.current, phase));
      f.host.handlers.set("media.render", () =>
        f.host.add("render", "succeeded", { video: { asset: f.host.managed() } }),
      );
      await f.controller.render(f.current);
      const { producer } = automatic(f);
      if (phase === "agent") await producer.handleTask({ id: "task-live", status: "completed" });
      else await producer.resume();
      assert.equal(f.controller.auto!.phase, aligned ? "done" : "failed");
      if (!aligned) assert.match(f.controller.auto!.message ?? "", /字幕对齐/);
      assert.equal(starts(f.host).length, 0);
    }
  }
});

test("restored draft cannot treat an existing render as its review checkpoint", async () => {
  const f = await fixture();
  f.host.handlers.set("media.render", () =>
    f.host.add("render", "succeeded", { video: { asset: f.host.managed() } }),
  );
  await f.controller.render(f.current);
  await f.controller.setAuto({ ...narrationRun(f.current, "waiting"), mode: "draft" });
  const { producer } = automatic(f);
  await producer.resume();
  assert.notEqual(f.controller.auto!.phase, "done");
  assert.equal(starts(f.host).length, 1);
  assert.equal(starts(f.host)[0]!.params.skill, "video-studio:narration-workflow");
});

test("initialization and workflow route actual skills without preparing every imported asset", async () => {
  for (const [mode, skill] of [
    ["initialize", "video-studio:video-init"],
    ["workflow", "video-studio:video-workflow"],
  ] as const) {
    const f = await fixture();
    f.current.assets.push({
      id: "picture",
      name: "补充画面",
      kind: "image",
      mediaId: `asset-${"b".repeat(64)}`,
      durationFrames: 150,
    });
    const original = structuredClone(f.current);
    const { producer } = automatic(f);
    await producer.start("按当前素材开展工作", { mode });
    const task = starts(f.host);
    assert.equal(task.length, 1);
    assert.equal(task[0]!.params.skill, skill);
    assert.equal(task[0]!.params.key, skill.slice("video-studio:".length));
    assert.ok(task[0]!.params.skills.includes("video-studio:tts-setup"));
    assert.ok(
      task[0]!.params.skills.includes(
        mode === "initialize" ? "video-studio:video-workflow" : "video-studio:video-init",
      ),
    );
    assert.equal(f.host.calls.filter(({ method }) => method === "media.prepare").length, 0);
    assert.equal(f.host.calls.filter(({ method }) => method === "media.transcribe").length, 0);
    assert.equal(producer.mode, mode);
    assert.equal(f.controller.auto?.mode, mode);
    assert.deepEqual(f.controller.auto?.preparationJobIds, []);
    assert.deepEqual(f.current, original);
    f.controller.dispose();
  }
});

test("reopened modes reconnect their active task without resubmitting preparation or an Agent", async () => {
  for (const mode of ["initialize", "workflow"] as const) {
    const f = await fixture();
    const { producer } = automatic(f);
    await producer.start("沿用素材和制作单", { mode });
    const prior = f.controller.auto!;
    f.controller.dispose();
    const reopened = await fixture(f.host);
    const resumed = automatic(reopened).producer;
    const callOffset = f.host.calls.length;
    await resumed.resume();
    assert.equal(resumed.mode, mode);
    assert.equal(reopened.controller.auto?.mode, mode);
    assert.equal(reopened.controller.auto?.taskId, prior.taskId);
    assert.equal(resumed.requestToken, prior.requestToken);
    const calls = f.host.calls.slice(callOffset);
    assert.equal(calls.filter(({ method }) => method === "agent.task.get").length, 1);
    assert.equal(calls.filter(({ method }) => method === "agent.task.start").length, 0);
    assert.equal(calls.filter(({ method }) => method === "media.prepare").length, 0);
    reopened.controller.dispose();
  }
});

test("legacy automation restores produce mode and keeps production skill routing", async () => {
  const f = await fixture();
  await f.controller.setAuto({
    projectId: f.current.id,
    prompt: "制作短片",
    phase: "preparing",
    attempts: 0,
    startedAt: 1,
    preparationJobIds: [],
  });
  f.controller.dispose();
  const reopened = await fixture(f.host);
  const { producer } = automatic(reopened);
  await producer.resume();
  assert.equal(producer.mode, "produce");
  assert.equal(starts(f.host).length, 1);
  assert.equal(starts(f.host)[0]!.params.skill, "video-studio:video-production");
  assert.equal(starts(f.host)[0]!.params.key, "video-production");
});

test("initialization only permits preparation and saving its production sheet", async () => {
  const f = await fixture();
  const { producer } = automatic(f);
  await producer.start("只整理素材并保存制作单", { mode: "initialize" });
  for (const name of [
    "prepare_video_assets",
    "setup_video_tts",
    "extract_video_reference",
    "prepare_video_voice",
    "apply_video_edit",
  ])
    assert.doesNotThrow(() => producer.assertToolAllowed(name));
  for (const name of [
    "finish_video_tts_setup",
    "enhance_video_audio",
    "set_video_script",
    "create_video_voiceover",
    "create_video_scene",
    "render_video_project",
    "apply_editor_edit",
    "unknown_write_tool",
  ])
    assert.throws(() => producer.assertToolAllowed(name));
  assert.doesNotMatch(starts(f.host)[0]!.params.prompt, /editor\.grant/);
  assert.equal(f.controller.currentJobs.length, 0);
  assert.equal(f.current.revision, 0);
  await producer.finishForReview();
  await producer.start("按制作单生成视频", { mode: "workflow" });
  const workflowPrompt = starts(f.host).at(-1)!.params.prompt;
  assert.match(workflowPrompt, /editor\.grant/);
  assert.match(workflowPrompt, /需要导出时统一调用 render_video_project/);
  assert.doesNotMatch(workflowPrompt, /只接受不改变本人录音依赖|临时字幕仍用旧 caption 操作/);
  for (const name of [
    "enhance_video_audio",
    "create_video_voiceover",
    "render_video_project",
    "apply_editor_edit",
  ])
    assert.doesNotThrow(() => producer.assertToolAllowed(name));
});

test("initialized completion survives late task events and reopening without a new production round", async () => {
  const f = await fixture();
  const { producer } = automatic(f);
  await producer.start("整理素材后结束", { mode: "initialize" });
  const taskId = f.controller.auto!.taskId!;
  await producer.finishForReview("制作单已保存");
  for (let index = 0; index < 3; index++) {
    await producer.handleTask({ id: taskId, status: "completed" });
    await producer.resume();
  }
  assert.equal(f.controller.auto?.phase, "done");
  assert.equal(producer.requestToken, "");
  assert.equal(starts(f.host).length, 1);
  f.controller.dispose();
  const reopened = await fixture(f.host);
  const restored = automatic(reopened).producer;
  await restored.resume();
  assert.equal(restored.mode, "initialize");
  assert.equal(restored.requestToken, "");
  assert.equal(reopened.controller.auto?.phase, "done");
  assert.equal(starts(f.host).length, 1);
});

test("initialization that completes without saving a sheet fails without entering editing rounds", async () => {
  const f = await fixture();
  f.host.handlers.set("agent.task.start", () => ({ id: "task-incomplete", status: "completed" }));
  const { producer } = automatic(f);
  await producer.start("初始化工程", { mode: "initialize" });
  for (let index = 0; index < 4; index++) await producer.resume();
  assert.equal(f.controller.auto?.phase, "failed");
  assert.equal(f.controller.auto?.attempts, 1);
  assert.ok(f.controller.auto?.message);
  assert.equal(producer.requestToken, "");
  assert.equal(starts(f.host).length, 1);
  assert.equal(f.controller.currentJobs.length, 0);
});

test("a restored initialization cannot mistake a completed export for a saved production sheet", async () => {
  const host = new FakeHost();
  const render = host.add("render", "succeeded", { video: { asset: host.managed() } });
  host.document = {
    schemaVersion: 1,
    bindings: {
      [`${render.id}:project-a`]: {
        jobId: render.id,
        projectId: "project-a",
        purpose: "render",
        createdAt: render.createdAt,
        consumed: true,
      },
    },
    auto: {
      projectId: "project-a",
      mode: "initialize",
      prompt: "初始化制作单",
      phase: "waiting",
      attempts: 1,
      startedAt: render.createdAt,
      preparationJobIds: [],
    },
  };
  host.revision = 1;
  const f = await fixture(host);
  const { producer } = automatic(f);
  await producer.resume();
  assert.notEqual(f.controller.auto?.phase, "done");
  assert.equal(f.controller.auto?.mode, "initialize");
  for (const task of starts(host)) assert.equal(task.params.skill, "video-studio:video-init");
});

test("automatic start locks reentrant callbacks until preparation is submitted and finished", async () => {
  const f = await fixture();
  const { producer } = automatic(f);
  f.changed(() => {
    void producer.resume();
  });
  const gate = deferred<unknown>();
  let preparing = false;
  f.host.handlers.set("media.prepare", () => {
    preparing = true;
    return gate.promise;
  });
  const pending = producer.start("剪成一个短片");
  await until(() => preparing);
  await producer.resume();
  assert.equal(starts(f.host).length, 0);
  const job = f.host.add("prepare", "queued", prepared());
  gate.resolve({ jobs: [job] });
  await pending;
  assert.equal(starts(f.host).length, 0);
  f.host.jobs.get(job.id)!.status = "succeeded";
  for (let i = 0; i < 5 && !starts(f.host).length; i++) {
    await f.controller.refresh();
    await producer.resume();
  }
  assert.equal(starts(f.host).length, 1);
  assert.equal(f.published.length, 1);
  assert.equal(starts(f.host)[0]!.params.skill, "video-studio:video-production");
  assert.deepEqual(starts(f.host)[0]!.params.toolNames, ["Panel"]);
  assert.equal(
    producer.isCurrentRequest({ projectId: f.current.id, requestToken: producer.requestToken }),
    true,
  );
});

test("cancelling during preparation prevents a late response from starting an Agent", async () => {
  const f = await fixture();
  const { producer } = automatic(f);
  const gate = deferred<unknown>();
  let entered = false;
  f.host.handlers.set("media.prepare", () => {
    entered = true;
    return gate.promise;
  });
  const pending = producer.start("制作");
  await until(() => entered);
  await producer.cancel();
  gate.resolve({ jobs: [] });
  await pending;
  await producer.resume();
  assert.equal(f.controller.auto?.phase, "failed");
  assert.equal(starts(f.host).length, 0);
});

test("late Agent start after switching project is cancelled and cannot gain a current edit token", async () => {
  const f = await fixture();
  f.current = { ...project(), assets: [], clips: [] };
  const { producer } = automatic(f);
  const gate = deferred<unknown>();
  let entered = false;
  f.host.handlers.set("agent.task.start", () => {
    entered = true;
    return gate.promise;
  });
  const pending = producer.start("制作");
  await until(() => entered);
  f.current = project("project-b");
  gate.resolve({ id: "task-late", status: "running" });
  await pending;
  assert.equal(producer.requestToken, "");
  assert.equal(
    f.host.calls.some(
      (call) => call.method === "agent.task.cancel" && call.params.id === "task-late",
    ),
    true,
  );
});

test("restored submission gaps fail closed and completed tasks never exceed three automatic rounds", async () => {
  const f = await fixture();
  f.current = { ...project(), assets: [], clips: [] };
  const { producer } = automatic(f);
  const run: AutoProduction = {
    projectId: f.current.id,
    prompt: "制作",
    phase: "agent",
    attempts: 1,
    startedAt: 1,
    requestToken: "interrupted",
  };
  await f.controller.setAuto(run);
  await producer.resume();
  assert.equal(f.controller.auto?.phase, "failed");
  assert.equal(starts(f.host).length, 0);
  f.host.handlers.set("agent.task.start", () => ({
    id: `task-${starts(f.host).length}`,
    status: "completed",
  }));
  await producer.start("完成短片");
  for (let i = 0; i < 8; i++) await producer.resume();
  assert.equal(starts(f.host).length, 3);
  assert.equal(f.controller.auto?.attempts, 3);
  assert.equal(f.controller.auto?.phase, "failed");
});

test("review-only completion ends automation without another round or an edit token", async () => {
  const f = await fixture();
  f.current = { ...project(), assets: [], clips: [] };
  const { producer, states } = automatic(f);
  await producer.start("只给方案，不执行");
  const id = f.controller.auto!.taskId!;
  await producer.finishForReview();
  await producer.handleTask({ id, status: "completed" });
  await producer.resume();
  assert.equal(f.controller.auto?.phase, "done");
  assert.equal(starts(f.host).length, 1);
  assert.equal(producer.requestToken, "");
  assert.equal(states.at(-1)!.starting, false);
});

test("restored running tasks reconnect without resubmission and unfinished preparation submission fails closed", async () => {
  const f = await fixture();
  const { producer } = automatic(f);
  await f.controller.setAuto({
    projectId: f.current.id,
    prompt: "制作",
    phase: "agent",
    attempts: 1,
    taskId: "task-live",
    requestToken: "live-token",
    startedAt: 1,
  });
  await producer.resume();
  assert.equal(starts(f.host).length, 0);
  assert.equal(
    f.host.calls.some((call) => call.method === "agent.task.get" && call.params.id === "task-live"),
    true,
  );
  assert.equal(producer.requestToken, "live-token");
  await f.controller.setAuto({
    projectId: f.current.id,
    prompt: "制作",
    phase: "preparing",
    attempts: 0,
    startedAt: 2,
  });
  await producer.resume();
  assert.equal(f.controller.auto?.phase, "failed");
  assert.match(f.controller.auto?.message ?? "", /素材准备提交时中断/);
  assert.equal(starts(f.host).length, 0);
});

test("a reused failed preparation older than the run prevents unprepared Agent execution", async () => {
  const f = await fixture();
  const { producer } = automatic(f);
  const job = f.host.add("prepare", "failed");
  job.createdAt = 1;
  job.error = { code: "decode", message: "source cannot be decoded", retryable: true };
  f.host.jobs.set(job.id, job);
  f.host.handlers.set("media.prepare", () => ({ jobs: [job] }));
  await producer.start("制作");
  assert.equal(f.controller.auto?.phase, "failed");
  assert.match(f.controller.auto?.message ?? "", /cannot be decoded/);
  assert.equal(starts(f.host).length, 0);
});

test("transcription captures all original source IDs before an asynchronous project switch", async () => {
  const f = await fixture();
  const secondId = `asset-${"b".repeat(64)}`;
  f.current.assets.push({
    id: "second",
    name: "第二段",
    kind: "audio",
    mediaId: secondId,
    durationFrames: 300,
  });
  const gate = deferred<MediaJob>();
  let calls = 0;
  f.host.handlers.set("media.transcribe", () => {
    calls++;
    return calls === 1 ? gate.promise : f.host.add("transcribe");
  });
  const pending = f.controller.transcribe(["source", "second"]);
  await until(() => calls === 1);
  f.current = project("project-b");
  gate.resolve(f.host.add("transcribe"));
  await pending;
  assert.deepEqual(
    f.host.calls
      .filter((call) => call.method === "media.transcribe")
      .map((call) => call.params.assetId),
    [mediaId, secondId],
  );
  assert.ok(
    Object.values(f.host.document.bindings).every((value: any) => value.projectId === "project-a"),
  );
});

test("legacy job-only bindings migrate without losing an unconsumed result", async () => {
  const host = new FakeHost();
  const job = host.add("prepare", "succeeded", prepared());
  host.document = {
    schemaVersion: 1,
    bindings: { [job.id]: { projectId: "project-a", purpose: "prepare", assetId: mediaId } },
    auto: null,
  };
  host.revision = 1;
  const f = await fixture(host);
  await f.controller.refresh();
  assert.equal(f.published.length, 1);
  assert.equal(binding(host, job.id).consumed, true);
});

test("terminal failure is acknowledged and unchanged successful results are reused during polling", async () => {
  const f = await fixture();
  const job = f.host.add("prepare", "queued", prepared());
  f.host.handlers.set("media.prepare", () => ({ jobs: [job] }));
  await f.controller.prepare(["source"]);
  await f.controller.refresh();
  f.host.jobs.get(job.id)!.status = "succeeded";
  await f.controller.refresh();
  const reads = f.host.calls.filter((call) => call.method === "media.jobs.get").length;
  const writes = f.host.writes;
  await f.controller.refresh();
  await f.controller.refresh();
  assert.equal(f.host.calls.filter((call) => call.method === "media.jobs.get").length, reads);
  assert.equal(f.host.writes, writes);
  assert.equal(f.published.length, 1);
  const failed = f.host.add("prepare", "failed");
  f.host.handlers.set("media.prepare", () => ({ jobs: [failed] }));
  await f.controller.prepare(["source"]);
  await f.controller.refresh();
  assert.equal(binding(f.host, failed.id).consumed, true);
  const terminalWrites = f.host.writes;
  await f.controller.refresh();
  assert.equal(f.host.writes, terminalWrites);
  assert.equal(f.controller.currentJobs.find((job) => job.id === failed.id)?.status, "failed");
});

test("initialization saves the selected Audio8 configuration and only samples its extracted reference, including after reopening", async () => {
  const f = await fixture();
  const voice = {
    modelId: "audio8-tts",
    referenceAssetId: "source",
    referenceText: "这是我的实际录音。",
    inFrame: 90,
    outFrame: 270,
    sampleText: "你好，这是我的声音试听。",
  };
  const original = structuredClone(f.current);
  await automatic(f).producer.start("初始化并准备自己的声音", { mode: "initialize", voice });
  assert.deepEqual(f.host.document.auto.voice, voice);
  assert.match(starts(f.host)[0]!.params.prompt, /prepare_video_voice/);
  assert.match(starts(f.host)[0]!.params.prompt, /"modelId":"audio8-tts"/);
  f.host.handlers.set("media.audio.extract", () => f.host.add("audio-extract"));
  const job = await f.controller.extractReference("source", 90, 270);
  assert.deepEqual(f.host.calls.find(({ method }) => method === "media.audio.extract")!.params, {
    assetId: mediaId,
    inFrame: 90,
    outFrame: 270,
    fps: 30,
  });
  assert.equal(f.published.length, 0);
  const referenceId = `asset-${"b".repeat(64)}`;
  Object.assign(f.host.jobs.get(job.id)!, {
    status: "succeeded",
    updatedAt: Date.now() + 1,
    result: {
      asset: {
        id: referenceId,
        name: "声音参考.wav",
        mimeType: "audio/wav",
        bytes: 200,
        createdAt: 1,
      },
      inspection: { kind: "audio", durationSeconds: 6, audio: { channels: 1 } },
    },
  });
  await f.controller.refresh();
  assert.equal(f.published.length, 1);
  assert.equal(f.published[0]!.options?.audioPlacement, undefined);
  assert.deepEqual(f.current.clips, original.clips);
  assert.deepEqual(f.current.audioClips, original.audioClips);
  assert.equal(binding(f.host, job.id).referenceResultId, referenceId);
  const saved = structuredClone(f.current);
  f.controller.dispose();
  const reopened = await fixture(f.host);
  reopened.current = saved;
  assert.deepEqual(reopened.controller.auto?.voice, voice);
  reopened.controller.status.tts = { available: true };
  reopened.host.handlers.set("media.tts", (params) =>
    reopened.host.add("tts-clone", "succeeded", {
      asset: {
        id: `asset-${"c".repeat(64)}`,
        name: "试听.wav",
        mimeType: "audio/wav",
        bytes: 400,
        createdAt: 2,
      },
      inspection: { kind: "audio", durationSeconds: 4, audio: { channels: 1 } },
      speech: { ...params, engine: "audio8-tts", rate: 1 },
    }),
  );
  const sample = await reopened.controller.prepareVoice({
    modelId: voice.modelId,
    voiceId: "reference",
    text: voice.sampleText,
    referenceAssetId: referenceId,
    referenceText: voice.referenceText,
    rate: 1,
  });
  await reopened.controller.refresh();
  assert.equal(binding(reopened.host, sample.id).attachAudio, false);
  assert.equal(reopened.published.at(-1)!.options?.audioPlacement, undefined);
  assert.equal(reopened.published.at(-1)!.assets[0]!.speech?.referenceAssetId, referenceId);
  assert.equal(reopened.published.at(-1)!.assets[0]!.speech?.modelId, "audio8-tts");
  assert.deepEqual(reopened.current.clips, original.clips);
  assert.deepEqual(reopened.current.audioClips, original.audioClips);
});

test("reference extraction rejects invalid or unselected ranges before Host submission", async () => {
  const f = await fixture();
  for (const [id, start, end] of [
    ["missing", 0, 180],
    ["source", -1, 180],
    ["source", 0.5, 180],
    ["source", 0, 89],
    ["source", 200, 301],
    ["source", 180, 180],
  ] as const)
    await assert.rejects(f.controller.extractReference(id, start, end));
  await automatic(f).producer.start("声音准备", {
    mode: "initialize",
    voice: { modelId: "audio8-tts", referenceAssetId: "source", inFrame: 90, outFrame: 270 },
  });
  await assert.rejects(f.controller.extractReference("source", 0, 180), /用户选定/);
  assert.equal(f.host.calls.filter(({ method }) => method === "media.audio.extract").length, 0);
});

async function extractedReference() {
  const f = await fixture();
  f.host.handlers.set("media.audio.extract", () => f.host.add("audio-extract"));
  const job = await f.controller.extractReference("source", 0, 180);
  await f.controller.refresh();
  Object.assign(f.host.jobs.get(job.id)!, {
    status: "succeeded",
    updatedAt: Date.now() + 100,
    result: {
      asset: {
        id: `asset-${"b".repeat(64)}`,
        name: "本人参考.wav",
        mimeType: "audio/wav",
        bytes: 200,
        createdAt: 1,
      },
      inspection: { kind: "audio", durationSeconds: 6, audio: { channels: 1 } },
    },
  });
  return { fixture: f, job };
}

test("completed reference publication is recoverable after a failed save and after its consumed asset is removed", async () => {
  const { fixture: f, job } = await extractedReference();
  f.beforePublish(async () => {
    throw new Error("保存失败：磁盘空间不足");
  });
  await assert.rejects(f.controller.refresh(), /磁盘空间不足/);
  assert.ok(!binding(f.host, job.id).consumed);
  f.beforePublish();
  await f.controller.recoverReference(job.id);
  assert.equal(binding(f.host, job.id).consumed, true);
  assert.equal(f.published.length, 1);
  assert.equal(f.published[0]!.options?.audioPlacement, undefined);
  const savedResult = f.current.assets.find((asset) => asset.kind === "audio")!;
  f.current = {
    ...f.current,
    assets: f.current.assets.filter((asset) => asset.id !== savedResult.id),
  };
  await f.controller.recoverReference(job.id);
  assert.equal(
    f.current.assets.find((asset) => asset.id === savedResult.id)?.mediaId,
    savedResult.mediaId,
  );
  assert.equal(f.current.audioClips.length, 0);
  assert.equal(f.host.calls.filter((call) => call.method === "media.audio.extract").length, 1);
  assert.equal(f.host.calls.filter((call) => call.method === "media.jobs.retry").length, 0);
});

test("reference recovery rejects foreign projects, non-reference jobs and changed or invalid results", async () => {
  const { fixture: f, job } = await extractedReference();
  f.current = project("project-b");
  await assert.rejects(f.controller.recoverReference(job.id), /不属于当前工程/);
  await assert.rejects(f.controller.recoverReference("unbound"), /不属于当前工程/);
  f.current = project();
  f.host.jobs.get(job.id)!.status = "queued";
  f.host.handlers.set("media.tts.setup", () => f.host.add("tts-setup"));
  const setup = await f.controller.setupTts("audio8-tts");
  await assert.rejects(f.controller.recoverReference(setup.id), /不属于当前工程/);
  f.host.jobs.get(job.id)!.status = "succeeded";
  const original = structuredClone(f.host.jobs.get(job.id)!.result) as any;
  for (const result of [
    undefined,
    { ...original, inspection: { kind: "audio", durationSeconds: 31 } },
    { ...original, asset: { ...original.asset, id: "unmanaged" } },
  ]) {
    f.host.jobs.get(job.id)!.result = result;
    await assert.rejects(f.controller.recoverReference(job.id), /有效且一致/);
  }
  assert.equal(f.published.length, 0);
  f.host.jobs.get(job.id)!.result = original;
  await f.controller.recoverReference(job.id);
  f.host.jobs.get(job.id)!.result = {
    ...original,
    asset: { ...original.asset, id: `asset-${"c".repeat(64)}` },
  };
  await assert.rejects(f.controller.recoverReference(job.id), /有效且一致/);
  assert.equal(f.published.length, 1);
});

test("reference recovery stops a delayed result when the project switches", async () => {
  const { fixture: f, job } = await extractedReference();
  const read = deferred<MediaJob>();
  f.host.handlers.set("media.jobs.get", () => read.promise);
  const recovery = f.controller.recoverReference(job.id);
  await until(() => f.host.calls.some((call) => call.method === "media.jobs.get"));
  f.current = project("project-b");
  read.resolve(structuredClone(f.host.jobs.get(job.id)!));
  await assert.rejects(recovery, /工程已切换/);
  assert.equal(f.published.length, 0);
  assert.ok(!binding(f.host, job.id).consumed);
});

test("older Host extraction support reports an actionable upgrade without masking other failures", async () => {
  const f = await fixture();
  const unsupported = new Error("Unsupported media method: media.audio.extract");
  f.host.handlers.set("media.audio.extract", () => {
    throw unsupported;
  });
  await assert.rejects(f.controller.extractReference("source", 0, 180), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(
      error.message,
      "当前桌面版本还不支持参考片段提取，请更新 CodeShell 桌面应用和视频面板后重试",
    );
    assert.equal(error.cause, unsupported);
    return true;
  });
  const denied = new Error("当前项目未授权 media 权限");
  f.host.handlers.set("media.audio.extract", () => {
    throw denied;
  });
  await assert.rejects(
    f.controller.extractReference("source", 0, 180),
    (error) => error === denied,
  );
  assert.equal(f.controller.currentJobs.length, 0);
  assert.equal(f.published.length, 0);
});

test("voice preparation enforces short samples and selected model, recording and transcript before generating", async () => {
  const f = await fixture();
  f.controller.status.tts = { available: true };
  f.current.assets.push({
    id: "my-reference",
    name: "本人录音",
    kind: "audio",
    mediaId: `asset-${"b".repeat(64)}`,
    durationFrames: 180,
  });
  const voice = {
    modelId: "audio8-tts",
    referenceAssetId: "my-reference",
    referenceText: "原话。",
    sampleText: "短试听。",
  };
  await automatic(f).producer.start("声音准备", { mode: "initialize", voice });
  const request = { ...voice, text: voice.sampleText, voiceId: "reference" };
  for (const change of [
    { text: "" },
    { text: "文".repeat(121) },
    { modelId: "qwen3-tts" },
    { referenceAssetId: "source" },
    { referenceText: "猜的内容" },
    { text: "非选定试听" },
  ])
    await assert.rejects(f.controller.prepareVoice({ ...request, ...change }));
  assert.equal(f.host.calls.filter(({ method }) => method === "media.tts").length, 0);
  await automatic(f).producer.finishForReview();
  f.host.handlers.set("media.tts", () => f.host.add("tts-clone"));
  await f.controller.prepareVoice({
    modelId: "audio8-tts",
    text: "𠮷".repeat(120),
    referenceAssetId: "my-reference",
    referenceText: "原话。",
    voiceId: "reference",
  });
  assert.equal(
    f.host.calls.filter(({ method }) => method === "media.tts").length,
    1,
    "sample limit counts Unicode characters",
  );
});

test("missing recording retains completed Audio8 installation and a failed preparation can still be documented", async () => {
  const f = await fixture();
  const { producer } = automatic(f);
  await producer.start("先准备Audio8", { mode: "initialize", voice: { modelId: "audio8-tts" } });
  f.host.handlers.set("media.tts.setup", () =>
    f.host.add("tts-setup", "succeeded", { available: true }),
  );
  await assert.rejects(f.controller.setupTts("qwen3-tts"), /用户选定/);
  const setup = await f.controller.setupTts("audio8-tts");
  await f.controller.refresh();
  assert.equal(binding(f.host, setup.id).consumed, true);
  await assert.rejects(
    f.controller.prepareVoice({ modelId: "audio8-tts", text: "短试听。", voiceId: "reference" }),
    /用户选定/,
  );
  assert.equal(f.host.jobs.get(setup.id)!.status, "succeeded");
  const failed = f.host.add("prepare", "failed");
  f.host.jobs.get(failed.id)!.error = {
    code: "PROCESSOR_FAILED",
    message: "缺少转写依赖",
    retryable: true,
  };
  await f.controller.setAuto({ ...f.controller.auto!, phase: "waiting" });
  await producer.resume();
  assert.equal(
    f.controller.auto?.phase,
    "agent",
    "initialization must be able to save concrete blockers after a failed background job",
  );
  assert.equal(starts(f.host).length, 2);
  assert.equal(f.host.calls.filter(({ method }) => method === "media.tts.setup").length, 1);
  assert.match(starts(f.host).at(-1)!.params.prompt, /保留已完成安装/);
});

test("voice configuration validation preserves incomplete selections but rejects unsafe persistence shapes", async () => {
  assert.deepEqual(validateVoicePreparation({ modelId: "audio8-tts" }), { modelId: "audio8-tts" });
  for (const value of [
    { modelId: "audio8-tts", uploadUrl: "https://example.test" },
    { modelId: "audio8-tts", inFrame: 0, outFrame: 180 },
    { modelId: "audio8-tts", referenceAssetId: "source", inFrame: 0 },
    { modelId: "audio8-tts", referenceText: "字".repeat(1001) },
    { modelId: "audio8-tts", sampleText: "字".repeat(121) },
  ])
    assert.throws(() => validateVoicePreparation(value));
  const f = await fixture();
  await automatic(f).producer.start("只准备安装", {
    mode: "initialize",
    voice: { modelId: "audio8-tts" },
  });
  f.controller.dispose();
  f.host.document.auto.voice.referenceText = [];
  const reopened = await fixture(f.host);
  assert.match(reopened.controller.error, /保留/);
  await assert.rejects(reopened.controller.prepare(["source"]), /保留/);
});

test("retrying a legacy job preserves project publication under its new durable task UUID after reload", async () => {
  const f = await fixture();
  const preparedJob = (await f.controller.prepare(["source"])).jobs[0]!;
  const original = f.host.jobs.get(preparedJob.id)!;
  original.status = "failed";
  original.error = { code: "FAILED", message: "旧运行中断", retryable: true };
  const nextId = "08fb411a-d959-4c58-9b99-f38e285d3997";
  f.host.handlers.set("media.jobs.retry", () => {
    const next: MediaJob = {
      ...original,
      id: nextId,
      status: "queued",
      error: undefined,
      createdAt: Date.now(),
      result: prepared(),
    };
    f.host.jobs.set(nextId, next);
    return structuredClone(next);
  });
  await f.controller.retry(original.id);
  assert.equal(binding(f.host, original.id), undefined);
  assert.equal(binding(f.host, nextId).purpose, "prepare");
  assert.equal(binding(f.host, nextId).projectId, "project-a");
  f.controller.dispose();
  const reopened = await fixture(f.host);
  await reopened.controller.refresh();
  assert.equal(
    reopened.controller.currentJobs.some((job) => job.id === nextId),
    true,
  );
  f.host.jobs.get(nextId)!.status = "succeeded";
  await reopened.controller.refresh();
  assert.equal(reopened.published.length, 1);
  assert.equal(reopened.published[0]!.projectId, "project-a");
  assert.equal(binding(f.host, nextId).consumed, true);
});

test("a request signal aborts when its automatic round ends, is replaced or is cancelled", async () => {
  const f = await fixture();
  const { producer } = automatic(f);
  await producer.start("按制作单生成视频", { mode: "workflow" });
  const token = producer.requestToken;
  assert.ok(token);
  assert.equal(producer.requestSignal("an-old-request").aborted, true);
  const signal = producer.requestSignal(token);
  assert.equal(signal.aborted, false);
  assert.equal(producer.requestSignal(token), signal, "One signal per request");
  await producer.finishForReview("方案已完成");
  assert.equal(signal.aborted, true);
  await producer.start("再做一版", { mode: "workflow" });
  const next = producer.requestSignal(producer.requestToken);
  assert.equal(next.aborted, false);
  await producer.cancel();
  assert.equal(next.aborted, true);
});
