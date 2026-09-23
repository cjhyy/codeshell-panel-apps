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
  type AssetPublication,
  type MediaJob,
  type ProductionCallbacks,
  type ProductionStatus,
} from "../apps/video-studio/src/production.ts";
import type {
  VoiceoverPublication,
  VoiceoverReplaceTarget,
} from "../apps/video-studio/src/editor/voiceover-publication.ts";
import { publishProductionAssets } from "../apps/video-studio/src/voiceover.ts";
import type { PanelBridge } from "../apps/video-studio/src/host.ts";

const speechId = `asset-${"b".repeat(64)}`;
const controllers = new Set<ProductionController>();
afterEach(() => {
  for (const controller of controllers) controller.dispose();
  controllers.clear();
});
function project(id = "project-a"): Project {
  return validateProject({
    ...createProject("配音测试"),
    id,
    assets: [{ id: "picture", name: "画面", kind: "image", durationFrames: 300 }],
    clips: [{ id: "clip", assetId: "picture", inFrame: 0, outFrame: 300, volume: 1 }],
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail("TTS state did not settle");
}
function speechResult(durationSeconds = 12.345) {
  return {
    asset: { id: speechId, name: "配音.wav", mimeType: "audio/wav", bytes: 48000, createdAt: 1 },
    inspection: { kind: "audio", durationSeconds, audio: { channels: 1, sampleRate: 24000 } },
    speech: {
      text: "这是实际合成的旁白文稿。",
      voiceId: "local:zh-CN",
      engine: "system-say",
      rate: 1.2,
    },
  };
}
class TtsHost implements PanelBridge {
  document: any = null;
  revision = 0;
  jobs = new Map<string, MediaJob>();
  calls: { method: string; params: any }[] = [];
  handlers = new Map<string, (params: any) => unknown | Promise<unknown>>();
  status: ProductionStatus = {
    persistent: true,
    ffmpeg: { available: true },
    transcription: { available: false },
    hyperframes: { available: false },
    tts: { available: true, engine: "system-say", defaultVoiceId: "local:zh-CN" },
  };
  getContext = async () => ({});
  registerTool = () => () => {};
  on = () => () => {};
  add(status: MediaJob["status"] = "succeeded", durationSeconds = 12.345): MediaJob {
    const job: MediaJob = {
      id: `job-tts-${this.jobs.size + 1}`,
      type: "tts",
      status,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      attempt: 1,
      ...(status === "succeeded" ? { result: speechResult(durationSeconds) } : {}),
    };
    this.jobs.set(job.id, job);
    return structuredClone(job);
  }
  async call(method: string, raw?: unknown): Promise<unknown> {
    const params = raw as any;
    this.calls.push({ method, params: structuredClone(params) });
    const handler = this.handlers.get(method);
    if (handler) return handler(params);
    if (method === "media.status") return structuredClone(this.status);
    if (method === "media.tts.voices")
      return {
        ...this.status.tts,
        voices: this.status.tts?.available
          ? [{ id: "local:zh-CN", name: "普通话", language: "zh-CN" }]
          : [],
      };
    if (method === "media.document.get")
      return { revision: this.revision, data: structuredClone(this.document) };
    if (method === "media.document.set") {
      assert.equal(params.baseRevision, this.revision);
      this.document = structuredClone(params.data);
      return { revision: ++this.revision };
    }
    if (method === "media.jobs.list")
      return {
        jobs: [...this.jobs.values()].map(({ result, ...summary }) => structuredClone(summary)),
      };
    if (method === "media.jobs.get") return structuredClone(this.jobs.get(params.id));
    if (method === "media.tts") return this.add();
    if (method === "media.assets.get") return { asset: speechResult().asset };
    throw new Error(`unexpected call: ${method}`);
  }
}
async function fixture(
  host = new TtsHost(),
  initial = project(),
  extra: Partial<ProductionCallbacks> = {},
) {
  let current = initial;
  const published: { projectId: string; assets: Asset[]; options?: AssetPublication }[] = [];
  const notices: string[] = [];
  const controller = new ProductionController(host, {
    getProject: () => current,
    changed: () => {},
    publishAssets: async (projectId, assets, options) => {
      assert.equal(projectId, current.id, "a late job must retain its original project");
      published.push(structuredClone({ projectId, assets, options }));
      const result = publishProductionAssets(current, assets, options);
      if (result.project) current = result.project;
      if (result.notice) notices.push(result.notice);
    },
    ...extra,
  });
  controllers.add(controller);
  await controller.initialize();
  return {
    host,
    controller,
    published,
    notices,
    get current() {
      return current;
    },
    set current(value: Project) {
      current = value;
    },
  };
}
function binding(host: TtsHost, jobId: string, projectId = "project-a") {
  return Object.values(host.document.bindings).find(
    (value: any) => value.jobId === jobId && value.projectId === projectId,
  ) as any;
}

test("completed speech publishes measured duration, synthesis metadata and unity-gain audio without discarding its source tail", async () => {
  const f = await fixture();
  const job = await f.controller.createVoiceover(
    { text: "  这是实际合成的旁白文稿。  ", rate: 1.2 },
    { startFrame: 270, attach: true },
  );
  await until(() => binding(f.host, job.id)?.consumed === true);
  const asset = f.current.assets.find((asset) => asset.mediaId === speechId)!;
  assert.equal(asset.kind, "audio");
  assert.equal(asset.durationFrames, Math.round(12.345 * 30));
  assert.deepEqual(asset.speech, speechResult().speech);
  assert.equal(asset.mimeType, "audio/wav");
  assert.deepEqual(f.current.audioClips, [
    {
      id: `voice-${job.id}`,
      assetId: asset.id,
      inFrame: 0,
      outFrame: 30,
      startFrame: 270,
      volume: 1,
    },
  ]);
  assert.match(f.notices[0]!, /完整配音.*保留.*画面只剩/);
  assert.deepEqual(f.host.calls.find((call) => call.method === "media.tts")!.params, {
    text: "这是实际合成的旁白文稿。",
    rate: 1.2,
  });
  assert.deepEqual(f.controller.preparations.get(speechId)?.transcription, {
    source: "synthesized-speech",
    text: speechResult().speech.text,
  });
  assert.equal(
    f.host.calls.some((call) => call.method === "media.transcribe"),
    false,
  );
});

test("Agent-created speech stays in the asset library until explicitly placed and needs no transcription engine", async () => {
  const f = await fixture();
  const catalog = await f.controller.voices();
  assert.equal(catalog.available, true);
  assert.equal(catalog.voices[0]!.language, "zh-CN");
  await f.controller.createVoiceover({ text: "给 Agent 的素材" });
  await until(() => f.published.length === 1);
  assert.equal(f.current.assets.filter((asset) => asset.mediaId === speechId).length, 1);
  assert.deepEqual(f.current.audioClips, []);
  assert.equal(f.published[0]!.options?.audioPlacement, undefined);
  assert.equal(f.controller.status.transcription.available, false);
});

test("late speech submission remains bound to its original project and placement", async () => {
  const f = await fixture();
  const response = deferred<MediaJob>();
  f.host.handlers.set("media.tts", () => response.promise);
  const submission = f.controller.createVoiceover(
    { text: "工程 A 的配音" },
    { startFrame: 60, attach: true },
  );
  f.current = project("project-b");
  const job = f.host.add();
  response.resolve(job);
  await submission;
  await f.controller.refresh();
  assert.equal(f.published.length, 0);
  assert.equal(binding(f.host, job.id, "project-a").startFrame, 60);
  assert.equal(binding(f.host, job.id, "project-b"), undefined);
  f.current = project();
  await f.controller.refresh();
  assert.equal(f.published.length, 1);
  assert.equal(f.published[0]!.projectId, "project-a");
  assert.equal(f.current.audioClips![0]!.startFrame, 60);
});

test("queued speech survives closing and is consumed once after reopening", async () => {
  const first = await fixture();
  const job = first.host.add("queued");
  first.host.handlers.set("media.tts", () => structuredClone(job));
  await first.controller.createVoiceover(
    { text: "关闭后继续合成" },
    { startFrame: 0, attach: true },
  );
  await first.controller.refresh();
  first.controller.dispose();
  first.host.jobs.set(job.id, {
    ...job,
    status: "succeeded",
    updatedAt: job.updatedAt + 1,
    result: speechResult(3.217),
  });
  const reopened = await fixture(first.host);
  await reopened.controller.refresh();
  await until(() => binding(first.host, job.id)?.consumed === true);
  assert.equal(reopened.published.length, 1);
  assert.equal(
    reopened.current.assets.find((asset) => asset.mediaId === speechId)!.durationFrames,
    97,
  );
  assert.equal(reopened.current.audioClips![0]!.outFrame, 97);
  const saved = structuredClone(reopened.current);
  await reopened.controller.refresh();
  assert.equal(reopened.published.length, 1);
  reopened.controller.dispose();
  const third = await fixture(first.host, saved);
  await third.controller.refresh();
  assert.equal(third.published.length, 0);
  assert.deepEqual(third.current, saved);
});

test("selected model and delivery instructions reach synthesis and survive source metadata roundtrip", async () => {
  const f = await fixture();
  const result = speechResult(2);
  Object.assign(result.speech, {
    modelId: "speech-connection-model",
    instructions: "平静、自然地讲述。",
  });
  f.host.handlers.set("media.tts", () => {
    const job = f.host.add();
    f.host.jobs.set(job.id, { ...job, result });
    return { ...job, result };
  });
  await f.controller.createVoiceover({
    text: "改好的文案",
    modelId: "speech-connection-model",
    voiceId: "coral",
    rate: 0.75,
    instructions: "平静、自然地讲述。",
  });
  await until(() => f.published.length === 1);
  assert.deepEqual(f.host.calls.find((call) => call.method === "media.tts")!.params, {
    text: "改好的文案",
    modelId: "speech-connection-model",
    voiceId: "coral",
    rate: 0.75,
    instructions: "平静、自然地讲述。",
  });
  const restored = validateProject(JSON.parse(JSON.stringify(f.current)));
  assert.deepEqual(
    restored.assets.find((asset) => asset.mediaId === speechId)?.speech,
    result.speech,
  );
});

const target = (): VoiceoverReplaceTarget => ({
  sequenceId: "sequence-main",
  clipId: "original",
  trackId: "voice-track",
  assetId: "old-voice",
  start: 240_001,
  duration: 1_200_777,
  timeMap: {
    points: [
      { time: 0, source: 120_000 },
      { time: 1_200_777, source: 1_320_777 },
    ],
  },
});

test("replacement intent survives restart and reaches the editor exactly as chosen", async () => {
  const received: VoiceoverPublication[] = [];
  const editor: Partial<ProductionCallbacks> = {
    verifyReplaceTarget: () => true,
    publishVoiceover: async (_projectId, _result, context) => {
      received.push(structuredClone(context));
    },
  };
  const first = await fixture(new TtsHost(), project(), editor);
  const job = first.host.add("queued");
  first.host.handlers.set("media.tts", () => structuredClone(job));
  const chosen = target();
  await first.controller.createVoiceover(
    { text: "修改后的旁白" },
    { startFrame: 30, attach: true, replaceTarget: chosen },
  );
  assert.deepEqual(binding(first.host, job.id).replaceTarget, target());
  chosen.start = 0;
  assert.equal(binding(first.host, job.id).replaceTarget.start, 240_001);
  first.controller.dispose();
  const result = speechResult(3);
  first.host.jobs.set(job.id, {
    ...job,
    status: "succeeded",
    result: { ...result, asset: { ...result.asset, sha256: "b".repeat(64) } },
  });
  const restored = await fixture(first.host, first.current, editor);
  await restored.controller.refresh();
  await until(() => binding(first.host, job.id)?.consumed === true);
  assert.deepEqual(
    received.map((context) => context.placement),
    [{ startFrame: 30, replaceTarget: target() }],
  );
  assert.equal(restored.published.length, 0, "only the editor replaces a clip in place");
});

test("without the editor a replacement result is kept in the library and never overlaid", async () => {
  const f = await fixture(new TtsHost(), project(), { verifyReplaceTarget: () => true });
  const job = f.host.add("succeeded", 3);
  f.host.handlers.set("media.tts", () => structuredClone(job));
  const before = structuredClone(f.current.audioClips);
  await f.controller.createVoiceover(
    { text: "修改后的旁白" },
    { startFrame: 30, attach: true, replaceTarget: target() },
  );
  await until(() => binding(f.host, job.id)?.consumed === true);
  assert.deepEqual(f.current.audioClips, before);
  assert.ok(f.current.assets.some((asset) => asset.mediaId === speechId));
});

test("a stale replacement selection is rejected before synthesis is queued", async () => {
  for (const extra of [{ verifyReplaceTarget: () => false }, {}]) {
    const f = await fixture(new TtsHost(), project(), extra);
    await assert.rejects(
      f.controller.createVoiceover(
        { text: "修改文案" },
        { startFrame: 0, attach: true, replaceTarget: target() },
      ),
      /原配音已被调整/,
    );
    assert.equal(
      f.host.calls.some((call) => call.method === "media.tts"),
      false,
    );
  }
});

test("replayed completed TTS jobs do not duplicate assets, audio clips or saved revisions", async () => {
  const f = await fixture();
  const job = f.host.add();
  f.host.handlers.set("media.tts", () => structuredClone(job));
  await f.controller.createVoiceover({ text: "相同任务回复" }, { startFrame: 0, attach: true });
  await until(() => binding(f.host, job.id)?.consumed === true);
  const saved = structuredClone(f.current);
  await f.controller.createVoiceover({ text: "相同任务回复" }, { startFrame: 0, attach: true });
  await until(() => binding(f.host, job.id)?.consumed === true);
  assert.deepEqual(f.current, saved);
  assert.equal(f.current.assets.filter((asset) => asset.mediaId === speechId).length, 1);
  assert.equal(f.current.audioClips!.length, 1);
});

test("unavailable TTS and invalid requests never enqueue a synthesis job", async () => {
  const host = new TtsHost();
  host.status.tts = { available: false, reason: "当前系统没有配音引擎" };
  const f = await fixture(host);
  await assert.rejects(f.controller.createVoiceover({ text: "你好" }), /没有配音引擎/);
  f.controller.status.tts = { available: true };
  for (const params of [
    { text: "  " },
    { text: "字".repeat(5001) },
    { text: "你好", rate: NaN },
    { text: "你好", rate: 0.4 },
    { text: "你好", rate: 2.1 },
  ])
    await assert.rejects(f.controller.createVoiceover(params), /文稿|速度/);
  for (const startFrame of [-1, 0.5, 2592001])
    await assert.rejects(
      f.controller.createVoiceover({ text: "你好" }, { startFrame, attach: true }),
      /位置无效/,
    );
  assert.equal(host.calls.filter((call) => call.method === "media.tts").length, 0);
});

test("saved speech metadata is strict JSON and rejects unusable voice descriptions", () => {
  const base = project();
  const speech: Asset = {
    id: "speech",
    name: "旁白",
    kind: "audio",
    mediaId: speechId,
    durationFrames: 100,
    speech: speechResult().speech,
  };
  const saved = validateProject({ ...base, assets: [...base.assets, speech] });
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(saved))), saved);
  for (const extra of [
    { rate: 0 },
    { rate: Infinity },
    { voiceId: "" },
    { engine: "" },
    { text: "" },
    { sourcePath: "/private/speech.wav" },
  ]) {
    assert.throws(
      () =>
        validateProject({
          ...base,
          assets: [...base.assets, { ...speech, speech: { ...speech.speech, ...extra } }],
        }),
      /配音|未知|不支持/,
    );
  }
});

test("cloned speech preserves its managed reference and Unicode transcript when saved and reopened", () => {
  const base = project();
  const referenceAssetId = `asset-${"c".repeat(64)}`;
  for (const referenceText of ["这是我的声音。\n请按录音中的内容逐字填写。", "🙂".repeat(1000)]) {
    const speech = {
      ...speechResult().speech,
      engine: "qwen3-tts",
      modelId: "qwen3-tts",
      referenceAssetId,
      referenceText,
    };
    const saved = validateProject({
      ...base,
      assets: [
        ...base.assets,
        {
          id: "cloned-speech",
          name: "本人旁白",
          kind: "audio",
          mediaId: speechId,
          durationFrames: 100,
          speech,
        },
      ],
    });
    const restored = validateProject(JSON.parse(JSON.stringify(saved)));
    assert.deepEqual(restored.assets.at(-1)?.speech, speech);
    assert.deepEqual(restored, saved);
    assert.notEqual(restored.assets.at(-1)?.speech, speech);
  }
});

test("cloned speech rejects incomplete references, non-managed IDs and invalid or excessive transcripts", () => {
  const base = project();
  const referenceAssetId = `asset-${"c".repeat(64)}`;
  const referenceText = "这是我的声音。";
  for (const extra of [
    { referenceAssetId },
    { referenceText },
    { referenceAssetId: null, referenceText },
    { referenceAssetId: "local-recording", referenceText },
    { referenceAssetId: "/private/reference.wav", referenceText },
    { referenceAssetId: `asset-${"c".repeat(63)}`, referenceText },
    { referenceAssetId: `asset-${"g".repeat(64)}`, referenceText },
    { referenceAssetId, referenceText: "" },
    { referenceAssetId, referenceText: " \n " },
    { referenceAssetId, referenceText: null },
    { referenceAssetId, referenceText: {} },
    { referenceAssetId, referenceText: "声音\u0000" },
    { referenceAssetId, referenceText: "字".repeat(1001) },
    { referenceAssetId, referenceText: "🙂".repeat(1001) },
  ]) {
    assert.throws(
      () =>
        validateProject({
          ...base,
          assets: [
            ...base.assets,
            {
              id: "cloned-speech",
              name: "本人旁白",
              kind: "audio",
              mediaId: speechId,
              durationFrames: 100,
              speech: { ...speechResult().speech, engine: "qwen3-tts", ...extra },
            },
          ],
        }),
      /参考录音|逐字稿|素材 ID/,
    );
  }
});

test("cloning maps a project reference to its Host managed ID and preserves the returned recipe", async () => {
  const referenceAssetId = `asset-${"c".repeat(64)}`;
  const initial = project();
  initial.assets.push({
    id: "my-recording",
    name: "本人录音",
    kind: "audio",
    mediaId: referenceAssetId,
    durationFrames: 3 * initial.fps,
  });
  const f = await fixture(new TtsHost(), initial);
  const result = speechResult(2);
  Object.assign(result.speech, {
    modelId: "qwen3-tts",
    engine: "qwen3-tts",
    voiceId: "reference",
    referenceAssetId,
    referenceText: "这是我的声音。",
  });
  f.host.handlers.set("media.tts", () => {
    const job = f.host.add();
    f.host.jobs.set(job.id, { ...job, result });
    return { ...job, result };
  });
  await f.controller.createVoiceover({
    modelId: "qwen3-tts",
    text: " 使用本人的声音朗读。 ",
    voiceId: "reference",
    referenceAssetId: "my-recording",
    referenceText: " 这是我的声音。 ",
  });
  assert.deepEqual(f.host.calls.find((call) => call.method === "media.tts")?.params, {
    modelId: "qwen3-tts",
    text: "使用本人的声音朗读。",
    voiceId: "reference",
    referenceAssetId,
    referenceText: "这是我的声音。",
  });
  await until(() => f.published.length === 1);
  const restored = validateProject(JSON.parse(JSON.stringify(f.current)));
  assert.deepEqual(
    restored.assets.find((asset) => asset.mediaId === speechId)?.speech,
    result.speech,
  );
});

test("invalid cloning requests fail before Host submission", async () => {
  const initial = project();
  initial.assets.push({
    id: "my-recording",
    name: "本人录音",
    kind: "audio",
    mediaId: `asset-${"c".repeat(64)}`,
    durationFrames: 10 * initial.fps,
  });
  const f = await fixture(new TtsHost(), initial);
  const params = {
    modelId: "qwen3-tts",
    text: "使用本人的声音朗读。",
    voiceId: "reference",
    referenceAssetId: "my-recording",
    referenceText: "这是我的声音。",
  };
  for (const extra of [
    { referenceAssetId: undefined },
    { referenceAssetId: "unknown-recording" },
    { referenceAssetId: "picture" },
    { referenceText: undefined },
    { referenceText: " \n " },
    { referenceText: "🙂".repeat(1001) },
    { text: "字".repeat(2001) },
    { text: "🙂".repeat(2001) },
    { modelId: "edge-tts" },
    { modelId: undefined },
  ]) {
    await assert.rejects(f.controller.createVoiceover({ ...params, ...extra }), /录音|逐字稿|2000/);
  }
  const reference = f.current.assets.find((asset) => asset.id === "my-recording")!;
  // Use the nearest representable frames outside the 3–30 second limits.
  for (const durationFrames of [Math.floor(2.99 * initial.fps), Math.ceil(30.01 * initial.fps)]) {
    reference.durationFrames = durationFrames;
    await assert.rejects(f.controller.createVoiceover(params), /3–30/);
  }
  reference.durationFrames = 10 * initial.fps;
  delete reference.mediaId;
  await assert.rejects(f.controller.createVoiceover(params), /素材库/);
  assert.equal(f.host.calls.filter((call) => call.method === "media.tts").length, 0);
});
