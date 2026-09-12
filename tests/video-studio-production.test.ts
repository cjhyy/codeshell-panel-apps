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
  transcriptCaptions,
  type ManagedAsset,
  type MediaJob,
  type PreparedMedia,
  type AutoProduction,
  validateVoicePreparation,
  type AssetPublication,
} from "../apps/video-studio/src/production.ts";
import { AutomaticProducer } from "../apps/video-studio/src/automatic.ts";
import {
  approveNarration,
  bindNarrationRecording,
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
  failConsumed = false;
  await f.controller.refresh();
  assert.equal(binding(f.host, job.id).consumed, true);
  assert.equal(f.current.assets.length, 1);
});

test("import completion queues preparation and a reopened controller consumes its eventual asset", async () => {
  const f = await fixture();
  f.current = { ...project(), assets: [], clips: [] };
  const imported = await f.controller.importFiles();
  await f.controller.refresh();
  assert.equal(binding(f.host, imported.job!.id).consumed, true);
  assert.equal(f.published.length, 0);
  const child = [...f.host.jobs.values()].find((job) => job.type === "prepare")!;
  child.status = "succeeded";
  f.controller.dispose();
  const reopened = await fixture(f.host);
  reopened.current = { ...project(), assets: [], clips: [] };
  await reopened.controller.refresh();
  assert.equal(reopened.current.assets[0]!.mediaId, mediaId);
  assert.equal(binding(f.host, child.id).consumed, true);
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
  const current = project();
  current.script = "先从海边出发，然后走进老街。";
  current.assets.push({
    id: "own-take",
    mediaId: `asset-${"b".repeat(64)}`,
    name: "本人录音",
    kind: "audio",
    durationFrames: 150,
  });
  current.narration = { phase: "review", captionBasis: "draft", draftCaptionIds: [] };
  return bindNarrationRecording(await approveNarration(current), "own-take");
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
  for (const name of [
    "prepare_video_assets",
    "apply_video_edit",
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
  for (const name of ["apply_video_edit", "prepare_video_assets", "create_video_scene"])
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
    "unknown_write_tool",
  ])
    assert.throws(() => producer.assertToolAllowed(name));
  assert.equal(f.controller.currentJobs.length, 0);
  assert.equal(f.current.revision, 0);
  await producer.finishForReview();
  await producer.start("按制作单生成视频", { mode: "workflow" });
  for (const name of ["enhance_video_audio", "create_video_voiceover", "render_video_project"])
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

test("Chinese word timings form readable captions and preserve source mapping across repeated trims", () => {
  const value = project();
  value.assets[0]!.durationFrames = 600;
  value.clips = [
    { id: "a", assetId: "source", inFrame: 90, outFrame: 300, volume: 1 },
    { id: "b", assetId: "source", inFrame: 0, outFrame: 150, volume: 1 },
  ];
  const words = Array.from({ length: 44 }, (_, index) => ({
    start: (index * 13.82) / 44,
    end: ((index + 1) * 13.82) / 44,
    text: "画面",
    probability: 0.99,
  }));
  const captions = transcriptCaptions(value, "source", [
    { start: 0, end: 13.82, text: words.map((word) => word.text).join(""), words },
  ]);
  assert.ok(captions.length >= 5);
  assert.ok(captions.every((caption) => [...caption.text].length <= 22));
  assert.ok(
    captions.every(
      (caption) =>
        caption.endFrame > caption.startFrame && caption.endFrame - caption.startFrame <= 120,
    ),
  );
  assert.equal(captions[0]!.startFrame, 0);
  assert.ok(captions.some((caption) => caption.startFrame === 210));
  const starts = new Set(words.map((word) => Math.round(word.start * 30)));
  for (const caption of captions.filter(
    (caption) => caption.startFrame > 0 && caption.startFrame < 210,
  ))
    assert.ok(starts.has(caption.startFrame + 90));
  const fallback = transcriptCaptions(project(), "source", [
    { start: 1, end: 8, text: "没有逐字时间就保留真实整段范围" },
  ]);
  assert.deepEqual(
    fallback.map(({ startFrame, endFrame, text }) => ({ startFrame, endFrame, text })),
    [{ startFrame: 30, endFrame: 240, text: "没有逐字时间就保留真实整段范围" }],
  );
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
