import assert from "node:assert/strict";
import { test } from "node:test";
import {
  registerProductionTools,
  registerProjectReadTool,
} from "../apps/video-studio/src/production-tools";
import { createProject } from "../apps/video-studio/src/model";
import type { PanelBridge } from "../apps/video-studio/src/host";
import type { ProductionController } from "../apps/video-studio/src/production";

test("project reads stay synchronous while job and voice views preserve full results", async () => {
  let read!: (args?: Record<string, unknown>) => unknown;
  const snapshot = { project: createProject(), jobs: [{ id: "job-a", status: "succeeded" }] };
  const result = { jobs: [{ id: "job-a", status: "succeeded", result: { assetId: "audio-a" } }] };
  const catalog = {
    available: true,
    voices: [{ id: "reference" }],
    models: [{ id: "audio8-tts" }],
  };
  const calls: unknown[] = [];
  let finish!: (value: typeof result) => void;
  const waiting = new Promise<typeof result>((resolve) => {
    finish = resolve;
  });
  registerProjectReadTool(
    {
      registerTool(name, handler) {
        assert.equal(name, "read_video_project");
        read = handler;
        return () => {};
      },
    } as PanelBridge,
    {
      waitForJobs: (ids?: string[]) => {
        calls.push(ids);
        return waiting;
      },
      voices: async () => {
        calls.push("voices");
        return catalog;
      },
    } as unknown as ProductionController,
    () => snapshot,
  );

  assert.equal(read(), snapshot, "Existing UI reads must not become async");
  assert.equal(read({ view: "project" }), snapshot);
  assert.deepEqual(calls, [], "Project reads must not start a voice query or wait for jobs");
  const jobRead = read({ view: "jobs", jobIds: ["job-a"] });
  assert.equal(
    jobRead,
    waiting,
    "Preserve the controller's bounded wait rather than returning a stale summary",
  );
  finish(result);
  assert.deepEqual(await jobRead, result);
  assert.deepEqual(await read({ view: "voices" }), catalog);
  assert.deepEqual(calls, [["job-a"], "voices"]);
});

test("combined read rejects invalid views and task IDs before making a query", () => {
  let read!: (args: Record<string, unknown>) => unknown;
  let calls = 0;
  registerProjectReadTool(
    {
      registerTool(_name, handler) {
        read = handler;
        return () => {};
      },
    } as PanelBridge,
    {
      waitForJobs: () => {
        calls++;
      },
      voices: () => {
        calls++;
      },
    } as unknown as ProductionController,
    () => {
      calls++;
    },
  );
  for (const args of [
    { view: "other" },
    { view: [] },
    { view: "voices", jobIds: ["job-a"] },
    { jobIds: ["job-a"] },
    ...[[], [1], [""], ["x".repeat(129)], Array(51).fill("job-a"), "job-a"].map((jobIds) => ({
      view: "jobs",
      jobIds,
    })),
  ])
    assert.throws(() => read(args));
  assert.equal(calls, 0);
});

test("Agent voice tools support local cloning without losing the source reference or transcript", async () => {
  const registered = new Map<string, (args: Record<string, unknown>) => unknown>();
  const received: unknown[] = [];
  const bridge = {
    registerTool(name: string, handler: (args: Record<string, unknown>) => unknown) {
      registered.set(name, handler);
      return () => {};
    },
  } as PanelBridge;
  registerProductionTools(
    bridge,
    {
      setupTts: async (providerId: string) => received.push(providerId),
      createVoiceover: async (params: unknown) => received.push(params),
    } as unknown as ProductionController,
    {
      project: () => createProject(),
      requestToken: () => "request",
      assertRequest: (args) => assert.equal(args.requestToken, "request"),
      apply: async () => {
        throw Error("unused");
      },
      capture: async () => ({}),
    },
  );
  await registered.get("setup_video_tts")!({ requestToken: "request", providerId: "qwen3-tts" });
  await registered.get("create_video_voiceover")!({
    requestToken: "request",
    modelId: "qwen3-tts",
    voiceId: "reference",
    referenceAssetId: "project-reference",
    referenceText: "我录下的原话。",
    text: "接下来要读的新文案。",
  });
  assert.deepEqual(received, [
    "qwen3-tts",
    {
      text: "接下来要读的新文案。",
      modelId: "qwen3-tts",
      instructions: undefined,
      voiceId: "reference",
      rate: undefined,
      referenceAssetId: "project-reference",
      referenceText: "我录下的原话。",
    },
  ]);
  for (const extra of [{ referenceAssetId: 1 }, { referenceText: [] }])
    assert.throws(
      () =>
        registered.get("create_video_voiceover")!({
          requestToken: "request",
          text: "新文案",
          ...extra,
        }),
      /配音参数无效/,
    );
  assert.equal(received.length, 2, "Malformed voice references must never reach the controller");
});

test("all Agent production writes reject missing or superseded request identity before queuing work", async () => {
  const registered = new Map<string, (args: Record<string, unknown>) => unknown>();
  const calls: string[] = [];
  const authorizedTools: string[] = [];
  let project = createProject(),
    token = "request-A";
  const old = { projectId: project.id, requestToken: token };
  const bridge = {
    registerTool(name: string, handler: (args: Record<string, unknown>) => unknown) {
      registered.set(name, handler);
      return () => {};
    },
  } as PanelBridge;
  const controller = {
    setupTts: async () => {
      calls.push("setup");
      return { id: "setup" };
    },
    enhanceAudio: async () => {
      calls.push("enhance");
      return { id: "enhance" };
    },
    prepare: async () => {
      calls.push("prepare");
      return { jobs: [] };
    },
    prepareVoice: async () => {
      calls.push("sample");
      return { id: "sample" };
    },
    extractReference: async () => {
      calls.push("reference");
      return { id: "reference" };
    },
    createVoiceover: async () => {
      calls.push("tts");
      return { id: "tts" };
    },
    createScene: async () => {
      calls.push("scene");
      return { id: "scene" };
    },
    startRender: () => {
      calls.push("render");
      return { id: "render" };
    },
  } as unknown as ProductionController;
  registerProductionTools(bridge, controller, {
    project: () => project,
    requestToken: () => token,
    assertRequest: (args, toolName) => {
      if (args.projectId !== project.id || args.requestToken !== token)
        throw Error("stale request");
      assert.equal(typeof toolName, "string");
      authorizedTools.push(toolName!);
    },
    apply: async () => {
      calls.push("apply");
      return { title: "保存制作单", explanation: "", operations: [], baseRevision: 0 };
    },
    capture: async () => ({}),
    setScript: async () => {
      calls.push("script");
      return {};
    },
    finishSetup: async () => {
      calls.push("finish-setup");
      return {};
    },
  });
  const requests = [
    { name: "prepare_video_assets", args: { assetIds: ["source"] } },
    { name: "prepare_video_voice", args: { text: "短试听", modelId: "audio8-tts" } },
    { name: "extract_video_reference", args: { assetId: "source", inFrame: 0, outFrame: 180 } },
    { name: "create_video_scene", args: { title: "场景" } },
    { name: "create_video_voiceover", args: { text: "真实旁白" } },
    { name: "render_video_project", args: { baseRevision: 0 } },
    { name: "setup_video_tts", args: { providerId: "kokoro" } },
    { name: "enhance_video_audio", args: { assetId: "source" } },
    { name: "set_video_script", args: { text: "改好的文稿", baseRevision: 0 } },
    { name: "finish_video_tts_setup", args: { jobId: "job-test" } },
    { name: "apply_video_edit", args: { baseRevision: 0, title: "保存制作单", operations: [] } },
  ];
  for (const { name, args } of requests)
    await assert.rejects(async () => registered.get(name)!(args), /stale request/);
  project = createProject();
  token = "request-B";
  for (const { name, args } of requests)
    await assert.rejects(async () => registered.get(name)!({ ...old, ...args }), /stale request/);
  assert.deepEqual(calls, []);
  for (const { name, args } of requests)
    await registered.get(name)!({ ...args, projectId: project.id, requestToken: token });
  assert.deepEqual(calls, [
    "prepare",
    "sample",
    "reference",
    "scene",
    "tts",
    "render",
    "setup",
    "enhance",
    "script",
    "finish-setup",
    "apply",
  ]);
  assert.deepEqual(
    authorizedTools,
    requests.map(({ name }) => name),
  );
});

test("tool scope rejection prevents every disallowed write before its handler or Host call", async () => {
  const registered = new Map<string, (args: Record<string, unknown>) => unknown>();
  const invoked: string[] = [];
  const bridge = {
    registerTool(name: string, handler: (args: Record<string, unknown>) => unknown) {
      registered.set(name, handler);
      return () => {};
    },
  } as PanelBridge;
  const record = (name: string) => async () => {
    invoked.push(name);
    return {};
  };
  const controller = {
    enhanceAudio: record("enhance"),
    createVoiceover: record("tts"),
    createScene: record("scene"),
    render: record("render"),
  } as unknown as ProductionController;
  const project = createProject();
  const allowed = new Set(["prepare_video_assets", "setup_video_tts", "apply_video_edit"]);
  registerProductionTools(bridge, controller, {
    project: () => project,
    requestToken: () => "initialization-request",
    assertRequest(args, toolName) {
      assert.equal(args.projectId, project.id);
      assert.equal(args.requestToken, "initialization-request");
      assert.ok(toolName);
      if (!allowed.has(toolName)) throw Error("initialization scope");
    },
    apply: async () => {
      throw Error("unused");
    },
    capture: async () => ({}),
    setScript: record("script"),
    finishSetup: record("finish-setup"),
  });
  const requests = [
    { name: "enhance_video_audio", args: { assetId: "source" } },
    { name: "set_video_script", args: { text: "口播文稿", baseRevision: 0 } },
    { name: "create_video_voiceover", args: { text: "真实旁白" } },
    { name: "create_video_scene", args: { title: "片头" } },
    { name: "render_video_project", args: { baseRevision: 0 } },
    { name: "finish_video_tts_setup", args: { jobId: "job-setup" } },
  ];
  for (const { name, args } of requests)
    await assert.rejects(
      async () =>
        registered.get(name)!({
          ...args,
          projectId: project.id,
          requestToken: "initialization-request",
        }),
      /initialization scope/,
    );
  assert.deepEqual(invoked, []);
});

test("render waits for narration validation and rejects a cancelled request after the check", async () => {
  const registered = new Map<string, (args: Record<string, unknown>) => unknown>();
  const bridge = {
    registerTool(name: string, handler: (args: Record<string, unknown>) => unknown) {
      registered.set(name, handler);
      return () => {};
    },
  } as PanelBridge;
  const project = createProject();
  let token = "approved",
    rendered = 0;
  let release!: () => void;
  let rejectValidation = false;
  const checking = new Promise<void>((resolve) => {
    release = resolve;
  });
  registerProductionTools(
    bridge,
    {
      startRender: () => {
        rendered++;
      },
    } as unknown as ProductionController,
    {
      project: () => project,
      requestToken: () => token,
      assertRequest(args) {
        if (args.requestToken !== token) throw Error("stale request");
      },
      validateRender: async () => {
        await checking;
        if (rejectValidation) throw Error("narration mismatch");
      },
      apply: async () => {
        throw Error("unused");
      },
      capture: async () => ({}),
    },
  );
  const args = { projectId: project.id, baseRevision: project.revision, requestToken: token };
  const pending = registered.get("render_video_project")!(args) as Promise<unknown>;
  assert.equal(rendered, 0);
  token = "cancelled";
  release();
  await assert.rejects(pending, /stale request/);
  assert.equal(rendered, 0);
  rejectValidation = true;
  await assert.rejects(
    async () => registered.get("render_video_project")!({ ...args, requestToken: token }),
    /narration mismatch/,
  );
  assert.equal(rendered, 0);
  rejectValidation = false;
  await registered.get("render_video_project")!({ ...args, requestToken: token });
  assert.equal(rendered, 1);
});

test("Audio8 setup, bounded sample and reference extraction are actual registered tools with preserved arguments", async () => {
  const registered = new Map<string, (args: Record<string, unknown>) => unknown>();
  const received: unknown[] = [];
  registerProductionTools(
    {
      registerTool(name, handler) {
        registered.set(name, handler);
        return () => {};
      },
    } as PanelBridge,
    {
      setupTts: async (id: string) => received.push(id),
      prepareVoice: async (params: unknown) => received.push(params),
      extractReference: async (...params: unknown[]) => received.push(params),
    } as unknown as ProductionController,
    {
      project: () => createProject(),
      requestToken: () => "request",
      assertRequest: (args) => assert.equal(args.requestToken, "request"),
      apply: async () => {
        throw Error("unused");
      },
      capture: async () => ({}),
    },
  );
  const identity = { projectId: "project", requestToken: "request" };
  await registered.get("setup_video_tts")!({ ...identity, providerId: "audio8-tts" });
  await registered.get("extract_video_reference")!({
    ...identity,
    assetId: "original",
    inFrame: 300,
    outFrame: 600,
  });
  await registered.get("prepare_video_voice")!({
    ...identity,
    modelId: "audio8-tts",
    voiceId: "reference",
    referenceAssetId: "extracted",
    referenceText: "录音原话。",
    text: "试听文稿。",
    rate: 1,
  });
  assert.deepEqual(received, [
    "audio8-tts",
    ["original", 300, 600],
    {
      modelId: "audio8-tts",
      voiceId: "reference",
      referenceAssetId: "extracted",
      referenceText: "录音原话。",
      text: "试听文稿。",
      rate: 1,
      instructions: undefined,
    },
  ]);
  for (const args of [
    { ...identity, assetId: "source", inFrame: 0.5, outFrame: 300 },
    { ...identity, assetId: 3, inFrame: 0, outFrame: 300 },
  ])
    assert.throws(() => registered.get("extract_video_reference")!(args), /整数帧/);
  assert.throws(
    () =>
      registered.get("prepare_video_voice")!({
        ...identity,
        modelId: "audio8-tts",
        text: "文稿",
        referenceText: [],
      }),
    /配音参数/,
  );
  assert.equal(received.length, 3);
});
