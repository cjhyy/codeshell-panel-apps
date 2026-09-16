import assert from "node:assert/strict";
import { test } from "node:test";
import { createProject, type Asset, type Project } from "../apps/video-studio/src/model";
import type {
  MediaJob,
  ProductionController,
  VoicePreparation,
  VoiceRequest,
} from "../apps/video-studio/src/production";
import {
  VOICE_LIBRARY_KEY,
  mergeVoiceLibrary,
  validateVoiceLibrary,
  type LibraryVoiceRecipe,
  type VoiceLibraryReference,
} from "../apps/video-studio/src/voice-library";
import {
  createVoicePreparationUI,
  validateVoiceRecipes,
  VOICE_SAMPLE_TEXT,
  VOICE_REFERENCE_TEXT,
} from "../apps/video-studio/src/voice-preparation-ui";

const media = (letter: string) => "asset-" + letter.repeat(64);
const reference: Asset = {
  id: "recording-project-id",
  mediaId: media("a"),
  kind: "audio",
  name: "我的录音.wav",
  durationFrames: 300,
};
const job = (id: string, type: string, status: MediaJob["status"] = "queued"): MediaJob => ({
  id,
  type,
  status,
  createdAt: 1,
  updatedAt: 1,
  attempt: 1,
});
function fixture(
  referenceContext: {
    assetUrl?(assetId: string): string | undefined;
    showAsset?(assetId: string): void | Promise<void>;
    ensureReference?(value: VoiceLibraryReference): Promise<Asset>;
    listVoices?(): Promise<LibraryVoiceRecipe[]>;
    saveVoice?(recipe: LibraryVoiceRecipe): Promise<LibraryVoiceRecipe>;
    importVoice?(
      recipeId: string,
    ): Promise<{ referenceMediaId: string; sampleMediaId: string; durationSeconds: number }>;
  } = {},
) {
  let project: Project = { ...createProject(), assets: [structuredClone(reference)] };
  let scope = "/workspace/a",
    failWrites = false,
    available = false;
  let missingEngine = false,
    catalogFailure = false,
    installable = true;
  let runtimeReason = "",
    catalogReason = "";
  let changes = 0;
  let catalogCalls = 0;
  let holdWrite: Promise<void> | undefined;
  let failUse = false;
  let recoverExtract: ((id: string) => Promise<void>) | undefined;
  const recoveries: string[] = [];
  const reconnected: VoiceLibraryReference[] = [];
  const storage = new Map<string, unknown>();
  const requests: VoiceRequest[] = [],
    extracts: unknown[][] = [],
    setups: string[] = [],
    used: VoicePreparation[] = [];
  const writes: { key: string; scope: string; projectId: string }[] = [];
  const jobs: MediaJob[] = [],
    allJobs = new Map<string, MediaJob>();
  const cancellations: string[] = [],
    retries: string[] = [];
  const production = {
    enabled: true,
    currentJobs: jobs,
    voices: async () => {
      catalogCalls++;
      if (catalogFailure) throw new Error("声音目录暂时无法连接");
      return {
        voices: [],
        reason: catalogReason,
        models: (missingEngine ? ["qwen3-tts"] : ["audio8-tts", "qwen3-tts"]).map((id) => ({
          id,
          name: id,
          available,
          installable,
          reason: runtimeReason,
          supportsVoiceCloning: true,
          voices: [{ id: "reference", name: "本人声音", language: "zh" }],
        })),
      };
    },
    setupTts: async (id: string) => {
      setups.push(id);
      const task = job("setup", "tts-setup");
      jobs.push(task);
      allJobs.set(task.id, task);
      return task;
    },
    prepareVoice: async (request: VoiceRequest) => {
      requests.push(structuredClone(request));
      const task = job("sample", "tts-clone");
      jobs.push(task);
      allJobs.set(task.id, task);
      return task;
    },
    extractReference: async (...args: unknown[]) => {
      extracts.push(args);
      const task = job("extract", "audio-extract");
      jobs.push(task);
      allJobs.set(task.id, task);
      return task;
    },
    recoverReference: async (id: string) => {
      recoveries.push(id);
      await recoverExtract?.(id);
    },
    cancel: async (id: string) => {
      cancellations.push(id);
      allJobs.get(id)!.status = "cancelled";
    },
    retry: async (id: string) => {
      retries.push(id);
      const previous = allJobs.get(id)!;
      const task = {
        ...previous,
        id: `${id}-retry-${retries.length}`,
        status: "queued" as const,
        attempt: previous.attempt + 1,
      };
      delete task.error;
      delete task.result;
      jobs.push(task);
      allJobs.set(task.id, task);
      return structuredClone(task);
    },
  } as unknown as ProductionController;
  const ui = createVoicePreparationUI(production, {
    project: () => project,
    scope: () => scope,
    read: async (key) => structuredClone(storage.get(key) ?? null),
    write: async (key, value) => {
      writes.push({ key, scope, projectId: project.id });
      if (holdWrite) await holdWrite;
      if (failWrites) throw new Error("模拟磁盘已满");
      storage.set(key, structuredClone(value));
    },
    getJob: async (id) => {
      const item = allJobs.get(id);
      if (!item) throw new Error("任务已不可用，请重新生成试听");
      return structuredClone(item);
    },
    changed() {
      changes++;
    },
    assertEditable() {},
    ensureReference: async (value) => {
      reconnected.push(structuredClone(value));
      const asset: Asset = {
        id: `connected-${project.id}`,
        mediaId: value.mediaId,
        name: value.name,
        kind: "audio",
        durationFrames: Math.round(value.durationSeconds * project.fps),
      };
      project.assets.push(asset);
      return asset;
    },
    ...referenceContext,
    toast() {},
    useVoice: async (value) => {
      if (failUse) throw new Error("测试：配音表单尚未载入");
      used.push(structuredClone(value));
    },
  });
  const input = (field: string, value: string, checked = false) =>
    ui.input({ id: `voice-prep-${field}`, value, checked } as HTMLInputElement);
  async function select() {
    input("model", "audio8-tts");
    input("reference", reference.id);
    input("transcript", "这是我本人录下的参考声音。");
    await ui.initialization();
  }
  function completeSample() {
    const request = requests.at(-1)!;
    const asset: Asset = {
      id: "sample-project-id",
      mediaId: media("b"),
      kind: "audio",
      name: "真实试听.wav",
      durationFrames: 210,
      speech: {
        text: request.text,
        modelId: request.modelId,
        voiceId: "reference",
        rate: 1,
        engine: "audio8-tts",
        referenceAssetId:
          project.assets.find((item) => item.id === request.referenceAssetId)?.mediaId ??
          reference.mediaId,
        referenceText: request.referenceText,
      },
    };
    project.assets.push(asset);
    const task = allJobs.get("sample")!;
    task.status = "succeeded";
    task.result = { asset: { id: asset.mediaId }, speech: asset.speech };
    return asset;
  }
  return {
    ui,
    input,
    select,
    completeSample,
    storage,
    requests,
    extracts,
    setups,
    used,
    jobs,
    allJobs,
    writes,
    cancellations,
    retries,
    recoveries,
    reconnected,
    recoverExtract: (callback: (id: string) => Promise<void>) => {
      recoverExtract = callback;
    },
    project: () => project,
    scope: () => scope,
    changes: () => changes,
    catalogCalls: () => catalogCalls,
    changeProject: (next = { ...createProject(), assets: [] as Asset[] }) => {
      project = next;
    },
    changeScope: () => {
      scope = "/workspace/b";
    },
    installed: () => {
      available = true;
    },
    missingEngine: (reason = "") => {
      missingEngine = true;
      catalogReason = reason;
    },
    unavailable: (reason: string) => {
      available = false;
      installable = false;
      runtimeReason = reason;
    },
    failCatalog: () => {
      catalogFailure = true;
    },
    failWrites: (value = true) => {
      failWrites = value;
    },
    failUse: (value = true) => {
      failUse = value;
    },
    holdWrites: (promise?: Promise<void>) => {
      holdWrite = promise;
    },
  };
}

test("quiet restoration preserves voice drafts and defers shared library and engine checks until activation", async () => {
  let libraryCalls = 0;
  const f = fixture({
    listVoices: async () => {
      libraryCalls++;
      return [];
    },
  });
  await f.ui.load({ runtime: false });
  await f.select();
  const draft = await f.ui.initialization();
  await f.ui.load({ runtime: false });
  await f.ui.refresh();
  assert.equal(f.catalogCalls(), 0);
  assert.equal(libraryCalls, 0);
  assert.deepEqual(await f.ui.initialization(), draft);
  await f.ui.activate();
  assert.equal(f.catalogCalls(), 1);
  assert.equal(libraryCalls, 1);
  assert.deepEqual(await f.ui.initialization(), draft);
});

test("saved reference recording is playable and discoverable before or during model installation", async () => {
  const shown: string[] = [];
  const f = fixture({
    showAsset: (assetId) => {
      shown.push(assetId);
    },
  });
  await f.ui.load();
  await f.select();
  const beforeSetup = f.ui.render();
  assert.match(beforeSetup, /我的录音.wav/);
  assert.match(beforeSetup, /10\.0 秒 · 已保存到素材库/);
  assert.match(beforeSetup, /aria-label="本人参考原录音"/);
  assert.match(beforeSetup, new RegExp(`src="/media/${reference.mediaId}"`));
  assert.doesNotMatch(beforeSetup, /aria-label="本人声音真实试听"/);
  assert.equal(f.requests.length, 0);
  await f.ui.action("voice-prep-setup");
  assert.doesNotMatch(f.ui.render(), /href="#voice-guide-/);
  await f.ui.action("voice-prep-goto", "model");
  assert.doesNotMatch(f.ui.render(), /class="conflict"/);
  assert.match(f.ui.render(), /aria-label="本人参考原录音"/);
  assert.match(f.ui.render(), /data-action="voice-prep-show-reference">在素材库查看/);
  await f.ui.action("voice-prep-show-reference");
  assert.deepEqual(shown, [reference.id]);
  assert.deepEqual(f.setups, ["audio8-tts"]);
  assert.equal(f.requests.length, 0);
});

test("reference preview uses the connected URL and never falls back when the connection is missing", async () => {
  const urls = new Map([[reference.id, 'blob:reference-"<&']]);
  const shown: string[] = [];
  const f = fixture({
    assetUrl: (assetId) => urls.get(assetId),
    showAsset: (assetId) => {
      shown.push(assetId);
    },
  });
  await f.ui.load();
  await f.select();
  assert.match(f.ui.render(), /src="blob:reference-&quot;&lt;&amp;"/);
  assert.doesNotMatch(f.ui.render(), new RegExp(`/media/${reference.mediaId}`));
  urls.delete(reference.id);
  assert.match(f.ui.render(), /原录音尚未连接/);
  assert.doesNotMatch(f.ui.render(), /id="voice-prep-reference-audio"/);
  assert.doesNotMatch(f.ui.render(), new RegExp(`/media/${reference.mediaId}`));
  const second = {
    ...reference,
    id: "second-reference",
    mediaId: media("c"),
    name: "另一段录音.wav",
  };
  f.project().assets.push(second);
  urls.set(second.id, "blob:second-recording");
  f.input("reference", second.id);
  assert.match(f.ui.render(), /src="blob:second-recording"/);
  assert.doesNotMatch(f.ui.render(), /src="blob:reference/);
  await f.ui.action("voice-prep-show-reference");
  assert.deepEqual(shown, [second.id]);
});

test("unrelated job refreshes do not redraw editable voiceover fields; newly recovered sample proof still updates", async () => {
  const f = fixture();
  f.installed();
  await f.ui.load();
  const loaded = f.changes();
  await f.ui.refresh();
  await f.ui.refresh();
  assert.equal(f.changes(), loaded, "No voice selection or job changes means no form replacement");
  await f.select();
  await f.ui.action("voice-prep-sample");
  f.completeSample();
  const beforeProof = f.changes();
  await f.ui.refresh();
  assert.ok(f.changes() > beforeProof, "A completed real sample must appear");
  const completed = f.changes();
  await f.ui.refresh();
  await f.ui.refresh();
  assert.equal(
    f.changes(),
    completed,
    "Unchanged proof must not interrupt later text or IME input",
  );
});

test("a missing local runtime catalog does not invent availability or require a provider-specific desktop update", async () => {
  const f = fixture();
  f.missingEngine("面板本地声音运行环境无法启动：未找到 Node.js。");
  await f.ui.load();
  f.input("model", "audio8-tts");
  assert.match(f.ui.render(), /面板本地声音运行环境无法启动：未找到 Node.js/);
  assert.doesNotMatch(f.ui.render(), /更新桌面应用/);
  await f.ui.action("voice-prep-setup");
  assert.equal(f.setups.length, 0);
  f.input("model", "qwen3-tts");
  await f.ui.action("voice-prep-setup");
  assert.deepEqual(f.setups, ["qwen3-tts"]);
  f.input("model", "audio8-tts");
  f.failCatalog();
  await f.ui.action("voice-prep-retry");
  assert.match(f.ui.render(), /声音目录暂时无法连接/);
  assert.doesNotMatch(f.ui.render(), /更新桌面应用/);
});

test("both local engines show the actual runtime reason and prevent setup and synthesis when unsupported", async () => {
  for (const id of ["audio8-tts", "qwen3-tts"]) {
    const f = fixture();
    f.unavailable("本地声音运行环境缺少 FFmpeg，请先安装。");
    await f.ui.load();
    await f.select();
    f.input("model", id);
    assert.match(f.ui.render(), /本地声音运行环境缺少 FFmpeg，请先安装/);
    await f.ui.action("voice-prep-setup");
    await f.ui.action("voice-prep-sample");
    assert.equal(f.setups.length, 0);
    assert.equal(f.requests.length, 0);
  }
});

test("a failed runtime refresh cannot reuse a stale ready model", async () => {
  const f = fixture();
  f.installed();
  await f.ui.load();
  await f.select();
  f.failCatalog();
  await f.ui.action("voice-prep-retry");
  assert.match(f.ui.render(), /声音目录暂时无法连接/);
  await f.ui.action("voice-prep-sample");
  assert.equal(f.requests.length, 0);
});

test("initialization can request installation without falsely claiming a personal voice is ready", async () => {
  const f = fixture();
  await f.ui.load();
  assert.equal(await f.ui.initialization(), undefined);
  f.input("model", "audio8-tts");
  assert.deepEqual(await f.ui.initialization(), {
    modelId: "audio8-tts",
    sampleText: VOICE_SAMPLE_TEXT,
  });
  assert.match(f.ui.render(), /下一步：录一段本人声音/);
  await f.ui.action("voice-prep-sample");
  assert.equal(f.requests.length, 0);
  await f.ui.action("voice-prep-setup");
  assert.deepEqual(f.setups, ["audio8-tts"]);
  f.installed();
  f.allJobs.get("setup")!.status = "succeeded";
  await f.ui.refresh();
  assert.match(f.ui.render(), /引擎：已安装/);
  assert.match(f.ui.render(), /声音：尚未验证/);
  assert.doesNotMatch(f.ui.render(), /保存为可复用声音/);
});

test("actual sample provenance and listener confirmation are required before a recipe is saved and reused", async () => {
  const f = fixture();
  f.installed();
  await f.ui.load();
  await f.select();
  const before = structuredClone(f.project());
  await f.ui.action("voice-prep-sample");
  assert.deepEqual(f.requests, [
    {
      text: VOICE_SAMPLE_TEXT,
      modelId: "audio8-tts",
      voiceId: "reference",
      rate: 1,
      referenceAssetId: reference.id,
      referenceText: "这是我本人录下的参考声音。",
    },
  ]);
  assert.deepEqual(
    f.project(),
    before,
    "Submitting preparation does not edit picture or audio tracks",
  );
  f.completeSample();
  await f.ui.refresh();
  assert.match(f.ui.render(), /本人声音真实试听/);
  await f.ui.action("voice-prep-save");
  assert.match(f.ui.render(), /请先生成真实试听，并确认已听过/);
  f.input("confirmed", "", true);
  f.input("name", "我的自然中文");
  await f.ui.action("voice-prep-save");
  assert.match(f.ui.render(), /已保存「我的自然中文」/);
  const saved = f.storage.get(VOICE_LIBRARY_KEY) as {
    recipes: { id: string; referenceMediaId: string; sampleMediaId: string }[];
  };
  assert.equal(saved.recipes[0]!.referenceMediaId, reference.mediaId);
  assert.equal(saved.recipes[0]!.sampleMediaId, media("b"));
  await f.ui.action("voice-prep-use", saved.recipes[0]!.id);
  assert.equal(f.used[0]!.referenceAssetId, reference.id);
  assert.deepEqual(f.project().clips, before.clips);
  assert.deepEqual(f.project().audioClips, before.audioClips);
});

test("save failure keeps recipe uncommitted and allows a later successful retry", async () => {
  const f = fixture();
  f.installed();
  await f.ui.load();
  await f.select();
  await f.ui.action("voice-prep-sample");
  f.completeSample();
  await f.ui.refresh();
  f.input("confirmed", "", true);
  f.failWrites();
  await f.ui.action("voice-prep-save");
  assert.match(f.ui.render(), /模拟磁盘已满/);
  assert.doesNotMatch(f.ui.render(), /我的声音库/);
  assert.deepEqual(([...f.storage.values()][0] as { recipes: unknown[] }).recipes, []);
  f.failWrites(false);
  await f.ui.action("voice-prep-save");
  assert.match(f.ui.render(), /我的声音库/);
});

test("refresh restores recipe selection and gets an older sample job beyond the recent job window", async () => {
  const f = fixture();
  f.installed();
  await f.ui.load();
  await f.select();
  await f.ui.action("voice-prep-sample");
  f.completeSample();
  await f.ui.refresh();
  f.input("confirmed", "", true);
  await f.ui.action("voice-prep-save");
  f.jobs.splice(0);
  await f.ui.load();
  assert.match(f.ui.render(), /本人声音真实试听/);
  assert.match(f.ui.render(), /我的声音库/);
  assert.equal((await f.ui.initialization())!.referenceText, "这是我本人录下的参考声音。");
});

test("extract waits for the actual published audio before selecting it; old project completion cannot switch the new project", async () => {
  const f = fixture();
  await f.ui.load();
  await f.ui.extract("video-project-id", 30, 330);
  assert.deepEqual(f.extracts, [["video-project-id", 30, 330]]);
  const task = f.allJobs.get("extract")!;
  task.status = "succeeded";
  task.result = { asset: { id: media("c") }, inspection: { kind: "audio" } };
  await f.ui.refresh();
  assert.equal(f.used.length, 0);
  assert.match(f.ui.render(), /录音已截取，尚未保存到当前工程/);
  assert.match(f.ui.render(), /data-action="voice-prep-recover-extract"/);
  assert.match(f.ui.render(), /data-action="voice-prep-dismiss-extract"/);
  f.project().assets.push({
    id: "extracted-project-id",
    mediaId: media("c"),
    kind: "audio",
    name: "提取参考.wav",
    durationFrames: 300,
  });
  await f.ui.refresh();
  assert.deepEqual(f.used[0], {
    modelId: "audio8-tts",
    referenceAssetId: "extracted-project-id",
    referenceText: "",
    sampleText: VOICE_SAMPLE_TEXT,
  });
  await f.ui.extract("video-project-id", 30, 330);
  f.changeProject();
  await f.ui.load();
  task.status = "succeeded";
  await f.ui.refresh();
  assert.equal(f.used.length, 1);
  assert.equal(await f.ui.initialization(), undefined);
});

test("completed extraction can recover publication without starting another task, preserving failures until saved", async () => {
  const f = fixture();
  await f.ui.load();
  await f.ui.extract("video-project-id", 30, 330);
  const task = f.allJobs.get("extract")!;
  task.status = "succeeded";
  task.result = { asset: { id: media("c") }, inspection: { kind: "audio" } };
  await f.ui.refresh();
  f.recoverExtract(async () => {
    throw new Error("工程保存失败，磁盘空间不足");
  });
  await f.ui.action("voice-prep-recover-extract");
  assert.match(f.ui.render(), /工程保存失败，磁盘空间不足/);
  assert.match(f.ui.render(), /data-action="voice-prep-recover-extract"/);
  assert.equal(f.used.length, 0);
  f.recoverExtract(async () => {
    f.project().assets.push({
      id: "recovered",
      mediaId: media("c"),
      kind: "audio",
      name: "参考.wav",
      durationFrames: 300,
    });
  });
  await f.ui.action("voice-prep-recover-extract");
  assert.deepEqual(f.recoveries, ["extract", "extract"]);
  assert.equal(f.extracts.length, 1);
  assert.equal(f.used[0]?.referenceAssetId, "recovered");
  assert.doesNotMatch(f.ui.render(), /data-action="voice-prep-recover-extract"|工程保存失败/);
});

test("ending a completed extraction persists before unlocking and preserves its task and old project isolation", async () => {
  const f = fixture();
  await f.ui.load();
  await f.ui.extract("video-project-id", 30, 330);
  const task = f.allJobs.get("extract")!;
  task.status = "succeeded";
  task.result = { asset: { id: media("c") } };
  await f.ui.refresh();
  f.failWrites();
  await f.ui.action("voice-prep-dismiss-extract");
  assert.match(f.ui.render(), /模拟磁盘已满/);
  assert.match(f.ui.render(), /data-action="voice-prep-dismiss-extract"/);
  f.failWrites(false);
  await f.ui.action("voice-prep-dismiss-extract");
  assert.equal(task.status, "succeeded");
  assert.equal(f.cancellations.length, 0);
  assert.equal(f.used.length, 0);
  await f.ui.load();
  assert.doesNotMatch(f.ui.render(), /data-action="voice-prep-dismiss-extract"/);
  assert.equal(await f.ui.initialization(), undefined);
  f.changeProject();
  await f.ui.load();
  await f.ui.action("voice-prep-recover-extract");
  assert.equal(f.recoveries.length, 0);
  assert.equal(f.used.length, 0);
});

test("failed extraction settings save keeps pending recovery across reload until selection is durable", async () => {
  const f = fixture();
  await f.ui.load();
  await f.ui.extract("video-project-id", 30, 330);
  const task = f.allJobs.get("extract")!;
  task.status = "succeeded";
  task.result = { asset: { id: media("c") } };
  f.project().assets.push({
    id: "saved-reference",
    mediaId: media("c"),
    kind: "audio",
    name: "参考.wav",
    durationFrames: 300,
  });
  f.failWrites();
  await f.ui.refresh();
  assert.match(f.ui.render(), /模拟磁盘已满/);
  assert.match(f.ui.render(), /录音已保存，声音设置尚未保存/);
  assert.match(f.ui.render(), /data-action="voice-prep-recover-extract"/);
  assert.doesNotMatch(f.ui.render(), /正在提取真实参考音频|已提取并保存参考录音/);
  assert.equal(f.used.length, 0);
  const key = `video-studio-voice-preparation-${f.project().id}`;
  assert.deepEqual((f.storage.get(key) as any).pending, { kind: "extract", jobId: "extract" });
  assert.equal((f.storage.get(key) as any).selection, null);
  await f.ui.load();
  assert.match(f.ui.render(), /data-action="voice-prep-recover-extract"/);
  assert.equal(f.used.length, 0);
  f.failWrites(false);
  await f.ui.action("voice-prep-recover-extract");
  assert.equal(f.used[0]?.referenceAssetId, "saved-reference");
  assert.equal((f.storage.get(key) as any).selection.referenceAssetId, "saved-reference");
  assert.equal((f.storage.get(key) as any).pending, undefined);
  assert.doesNotMatch(f.ui.render(), /data-action="voice-prep-recover-extract"|模拟磁盘已满/);
  assert.equal(f.extracts.length, 1);
});

test("switching project during extraction settings save cannot apply its reference to the new project", async () => {
  const f = fixture();
  await f.ui.load();
  await f.ui.extract("video-project-id", 30, 330);
  const task = f.allJobs.get("extract")!;
  task.status = "succeeded";
  task.result = { asset: { id: media("c") } };
  f.project().assets.push({
    id: "saved-reference",
    mediaId: media("c"),
    kind: "audio",
    name: "参考.wav",
    durationFrames: 300,
  });
  let release!: () => void;
  f.holdWrites(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const refreshing = f.ui.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  f.changeProject();
  const loading = f.ui.load();
  release();
  f.holdWrites();
  await Promise.all([refreshing, loading]);
  assert.equal(f.used.length, 0);
  assert.equal(await f.ui.initialization(), undefined);
  assert.doesNotMatch(f.ui.render(), /已提取并保存参考录音/);
});

test("queued writes are stopped before a changed scope or project can receive them", async () => {
  const f = fixture();
  await f.ui.load();
  let release!: () => void;
  f.holdWrites(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  f.input("model", "audio8-tts");
  await new Promise((resolve) => setImmediate(resolve));
  f.input("reference", reference.id);
  f.changeProject();
  f.changeScope();
  const loading = f.ui.load();
  release();
  f.holdWrites();
  await loading;
  assert.equal(f.writes.length, 1, "The queued second snapshot never reaches the new Host binding");
  assert.equal(await f.ui.initialization(), undefined);
  assert.doesNotMatch(f.ui.render(), /我的声音库|工程已切换/);
});

test("malformed or cross-scope storage is locked without overwriting existing records", async () => {
  const f = fixture();
  const key = `video-studio-voice-preparation-${f.project().id}`;
  const corrupted = {
    schemaVersion: 1,
    scope: "/another-workspace",
    projectId: f.project().id,
    selection: null,
    recipes: [],
  };
  f.storage.set(key, corrupted);
  await f.ui.load();
  f.input("model", "audio8-tts");
  await f.ui.action("voice-prep-setup").catch(() => {});
  assert.match(f.ui.render(), /原记录已保留/);
  assert.deepEqual(f.storage.get(key), corrupted);
  assert.equal(f.writes.length, 0);
  assert.throws(() =>
    validateVoiceRecipes(
      {
        ...corrupted,
        scope: f.scope(),
        recipes: [{ id: "x", referenceMediaId: "/tmp/voice.wav" }],
      },
      f.scope(),
      f.project().id,
    ),
  );
});

test("a project JSON speech annotation alone cannot fabricate a verified audio sample", async () => {
  const f = fixture();
  f.installed();
  await f.ui.load();
  await f.select();
  f.requests.push({
    text: VOICE_SAMPLE_TEXT,
    modelId: "audio8-tts",
    referenceText: "这是我本人录下的参考声音。",
  });
  f.allJobs.set("sample", job("sample", "tts"));
  f.completeSample();
  f.allJobs.clear();
  f.jobs.splice(0);
  assert.doesNotMatch(f.ui.render(), /本人声音真实试听/);
  f.input("confirmed", "", true);
  await f.ui.action("voice-prep-save");
  assert.doesNotMatch(f.ui.render(), /我的声音库/);
});

test("creating a voice exposes three steps and selects an available engine without installing or recording", async () => {
  for (const qwenOnly of [false, true]) {
    const f = fixture();
    if (qwenOnly) {
      f.missingEngine();
      f.installed();
    }
    await f.ui.load();
    assert.equal(f.ui.preparing(), false);
    assert.match(f.ui.render(), /data-action="voice-prep-start"[^>]*>创建我的声音/);
    await f.ui.action("voice-prep-start");
    assert.equal(f.ui.preparing(), true);
    assert.equal((await f.ui.initialization())!.modelId, qwenOnly ? "qwen3-tts" : "audio8-tts");
    const markup = f.ui.render();
    for (const label of [
      "1. 提供本人录音",
      "2. 准备模型",
      "3. 试听并保存",
      "voice-reference-record",
      "voice-reference-import",
      "voice-reference-video",
    ])
      assert.ok(markup.includes(label), label);
    for (const step of ["reference", "model", "preview"]) {
      assert.match(markup, new RegExp(`data-action="voice-prep-goto"\\s+data-id="${step}"`));
      assert.ok(markup.includes(`aria-controls="voice-guide-${step}"`));
      assert.ok(markup.includes(`id="voice-guide-${step}" tabindex="-1"`));
    }
    assert.doesNotMatch(markup, /href="#voice-guide-/);
    assert.deepEqual(f.setups, []);
    assert.deepEqual(f.requests, []);
    assert.deepEqual(f.extracts, []);
    assert.doesNotMatch(markup, /关闭后任务会中断/);
  }
});

test("selecting a durable recording preserves the chosen engine and only explicit acknowledgement fills the reading script", async () => {
  const f = fixture();
  f.installed();
  await f.ui.load();
  await f.ui.action("voice-prep-start");
  await f.ui.action("voice-prep-reference-text");
  assert.equal((await f.ui.initialization())!.referenceText, undefined);
  f.input("model", "qwen3-tts");
  await f.ui.selectReference(reference.id);
  await assert.rejects(f.ui.initialization(), /实际说出的内容/);
  await f.ui.action("voice-prep-reference-text");
  const selected = await f.ui.initialization();
  assert.equal(selected!.modelId, "qwen3-tts");
  assert.equal(selected!.referenceText, VOICE_REFERENCE_TEXT);
  assert.ok(
    Array.from(VOICE_REFERENCE_TEXT).length >= 50 && Array.from(VOICE_REFERENCE_TEXT).length <= 80,
  );
  await f.ui.selectReference(reference.id);
  assert.equal((await f.ui.initialization())!.referenceText, VOICE_REFERENCE_TEXT);
  f.project().assets.push({ ...reference, id: "second-recording", mediaId: media("c") });
  await f.ui.selectReference("second-recording");
  await assert.rejects(f.ui.initialization(), /实际说出的内容/);
  await assert.rejects(f.ui.selectReference("missing-recording"), /已保存的本人参考录音/);
  assert.deepEqual(f.requests, []);
});

test("pending preparation locks configuration, prevents duplicate tasks, and cancels in place", async () => {
  const f = fixture();
  f.installed();
  await f.ui.load();
  await f.select();
  await f.ui.action("voice-prep-sample");
  const previous = [...f.storage.values()][0] as any;
  f.input("model", "qwen3-tts");
  f.input("reference", "other");
  f.input("transcript", "改写");
  await f.ui.action("voice-prep-sample");
  await f.ui.action("voice-prep-setup");
  await assert.rejects(f.ui.selectReference(reference.id), /正在进行/);
  assert.equal(f.requests.length, 1);
  assert.equal(f.setups.length, 0);
  assert.deepEqual(([...f.storage.values()][0] as any).selection, previous.selection);
  assert.match(f.ui.render(), /id="voice-prep-model" disabled/);
  assert.match(f.ui.render(), /data-action="voice-prep-cancel"/);
  await f.ui.action("voice-prep-cancel");
  assert.deepEqual(f.cancellations, ["sample"]);
  assert.match(f.ui.render(), /data-action="voice-prep-retry-job"/);
  assert.doesNotMatch(f.ui.render(), /id="voice-prep-model" disabled/);
});

test("failed preparation restores inline retry and follows a new task ID through real sample proof", async () => {
  const f = fixture();
  f.installed();
  await f.ui.load();
  await f.select();
  await f.ui.action("voice-prep-sample");
  const failed = f.allJobs.get("sample")!;
  failed.status = "failed";
  failed.error = { code: "TEST", message: "测试：生成中断", retryable: true };
  await f.ui.refresh();
  await f.ui.load();
  assert.match(f.ui.render(), /测试：生成中断/);
  assert.match(f.ui.render(), /重试这一步/);
  await f.ui.action("voice-prep-retry-job");
  assert.deepEqual(f.retries, ["sample"]);
  const stored = [...f.storage.values()][0] as any;
  assert.equal(stored.pending.jobId, "sample-retry-1");
  assert.equal(stored.sampleJobId, "sample-retry-1");
  const source = f.completeSample();
  const retried = f.allJobs.get("sample-retry-1")!;
  retried.status = "succeeded";
  retried.result = { asset: { id: source.mediaId }, speech: source.speech };
  f.jobs.splice(f.jobs.indexOf(failed), 1);
  f.allJobs.delete("sample");
  await f.ui.refresh();
  f.jobs.splice(0);
  await f.ui.load();
  assert.match(f.ui.render(), /本人声音真实试听/);
});

test("failed settings recovery has an enabled retry that reloads instead of overwriting", async () => {
  const f = fixture();
  const key = `video-studio-voice-preparation-${f.project().id}`;
  f.storage.set(key, { schemaVersion: 99 });
  await f.ui.load();
  assert.match(f.ui.render(), /data-action="voice-prep-retry"\s*>\s*重新恢复声音设置/);
  assert.equal(f.writes.length, 0);
  f.storage.delete(key);
  await f.ui.action("voice-prep-retry");
  await f.ui.action("voice-prep-start");
  assert.equal(f.ui.preparing(), true);
  assert.equal((await f.ui.initialization())!.modelId, "audio8-tts");
});

test("saving a verified voice applies it only after durable storage and retries use without duplicate recipes", async () => {
  const f = fixture();
  f.installed();
  await f.ui.load();
  await f.select();
  await f.ui.action("voice-prep-sample");
  f.completeSample();
  await f.ui.refresh();
  f.input("confirmed", "", true);
  f.failWrites();
  await f.ui.action("voice-prep-save");
  assert.deepEqual(f.used, []);
  assert.equal(f.ui.preparing(), true);
  f.failWrites(false);
  f.failUse();
  await f.ui.action("voice-prep-save");
  const saved = f.storage.get(VOICE_LIBRARY_KEY) as any;
  assert.equal(saved.recipes.length, 1);
  assert.equal(f.ui.preparing(), false);
  assert.match(f.ui.render(), /测试：配音表单尚未载入/);
  f.failUse(false);
  await f.ui.action("voice-prep-save");
  assert.equal((f.storage.get(VOICE_LIBRARY_KEY) as any).recipes.length, 1);
  assert.equal(f.used.length, 1);
  assert.equal(f.used[0]!.referenceAssetId, reference.id);
});

test("finished tasks awaiting durable publication show saving without allowing cancellation", async () => {
  const f = fixture();
  f.installed();
  await f.ui.load();
  await f.select();
  await f.ui.action("voice-prep-sample");
  f.allJobs.get("sample")!.status = "succeeded";
  f.allJobs.get("sample")!.result = { asset: { id: media("d") } };
  await f.ui.refresh();
  assert.match(f.ui.render(), /正在保存结果/);
  assert.doesNotMatch(f.ui.render(), /data-action="voice-prep-cancel"/);
  assert.match(f.ui.render(), /id="voice-prep-model" disabled/);
  await f.ui.action("voice-prep-cancel");
  assert.deepEqual(f.cancellations, []);
});

async function saveVerifiedVoice(f: ReturnType<typeof fixture>): Promise<LibraryVoiceRecipe> {
  f.installed();
  await f.ui.load();
  await f.select();
  await f.ui.action("voice-prep-sample");
  f.completeSample();
  await f.ui.refresh();
  f.input("confirmed", "", true);
  await f.ui.action("voice-prep-save");
  return validateVoiceLibrary(f.storage.get(VOICE_LIBRARY_KEY), f.scope()).recipes[0]!;
}

test("an extracted recording with no transcript has an explicit next step without synthesizing or filling guessed words", async () => {
  const f = fixture();
  await f.ui.load();
  await f.ui.selectReference(reference.id);
  assert.match(f.ui.render(), /填写这段录音的逐字稿/);
  assert.match(f.ui.render(), /录音已经选好。原样填入这段录音说的话/);
  assert.doesNotMatch(f.ui.render(), /尚未选择本人参考录音/);
  assert.equal(f.requests.length, 0);
  assert.equal(f.setups.length, 0);
  await assert.rejects(f.ui.initialization(), /实际说出的内容/);
});

test("a saved voice remains available in another project and reconnects only on explicit use at that project's frame rate", async () => {
  const f = fixture();
  const saved = await saveVerifiedVoice(f);
  const next = { ...createProject(), fps: 24, assets: [] as Asset[] };
  f.changeProject(next);
  await f.ui.load();
  assert.match(f.ui.render(), /我的声音库 · 多项目复用/);
  assert.match(f.ui.render(), /本工作空间的工程可用/);
  assert.equal(await f.ui.initialization(), undefined);
  assert.deepEqual(f.project().assets, []);
  assert.deepEqual(f.reconnected, []);
  assert.equal(f.requests.length, 1);
  const before = structuredClone(next);
  await f.ui.action("voice-prep-use", saved.id);
  assert.deepEqual(f.reconnected, [
    { mediaId: reference.mediaId, name: reference.name, durationSeconds: 10 },
  ]);
  assert.equal(f.project().assets[0]!.durationFrames, 240);
  assert.equal(f.used.at(-1)!.referenceAssetId, f.project().assets[0]!.id);
  assert.equal(f.used.at(-1)!.referenceText, "这是我本人录下的参考声音。");
  assert.deepEqual(f.project().clips, before.clips);
  assert.deepEqual(f.project().audioClips, before.audioClips);
  assert.equal(f.requests.length, 1, "Reusing a verified recipe does not regenerate its sample");
  assert.equal(f.ui.preparing(), false);
  await f.ui.load();
  assert.equal((await f.ui.initialization())!.referenceAssetId, f.project().assets[0]!.id);
});

test("legacy project recipes migrate to workspace storage without altering their project or inventing missing media", async () => {
  const f = fixture();
  const original = {
    schemaVersion: 1,
    scope: f.scope(),
    projectId: f.project().id,
    selection: null,
    recipes: [
      {
        id: "legacy-voice",
        name: "已确认的声音",
        modelId: "audio8-tts",
        referenceMediaId: reference.mediaId,
        referenceText: "这是本人实际说过的内容。",
        sampleMediaId: media("b"),
        sampleText: VOICE_SAMPLE_TEXT,
      },
    ],
  };
  const key = `video-studio-voice-preparation-${f.project().id}`;
  f.storage.set(key, structuredClone(original));
  await f.ui.load();
  const migrated = validateVoiceLibrary(f.storage.get(VOICE_LIBRARY_KEY), f.scope());
  assert.equal(migrated.recipes[0]!.id, "legacy-voice");
  assert.equal(migrated.recipes[0]!.referenceDurationSeconds, 10);
  assert.deepEqual(f.storage.get(key), original);
  assert.equal(f.requests.length, 0);
  assert.equal(f.used.length, 0);
  f.changeProject();
  await f.ui.load();
  assert.match(f.ui.render(), /使用 已确认的声音/);
});

test("an unreadable or cross-workspace voice library is preserved and cannot be silently replaced", async () => {
  for (const scope of ["/other-workspace", "/workspace/a"]) {
    const f = fixture();
    const invalid = {
      schemaVersion: 1,
      scope,
      recipes: [{ referenceMediaId: "/tmp/private.wav" }],
    };
    f.storage.set(VOICE_LIBRARY_KEY, invalid);
    await f.ui.load();
    assert.match(f.ui.render(), /声音库无法恢复，原记录已保留/);
    await assert.rejects(f.ui.action("voice-prep-start"), /先恢复/);
    assert.deepEqual(f.storage.get(VOICE_LIBRARY_KEY), invalid);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.reconnected, []);
  }
});

test("a failed reference reconnection preserves the saved voice and leaves the new project's selection untouched", async () => {
  const f = fixture({
    ensureReference: async () => {
      throw new Error("录音已被移动，请重新连接");
    },
  });
  const saved = await saveVerifiedVoice(f);
  f.changeProject();
  await f.ui.load();
  const before = structuredClone(f.storage.get(VOICE_LIBRARY_KEY));
  await f.ui.action("voice-prep-use", saved.id);
  assert.match(f.ui.render(), /录音已被移动，请重新连接/);
  assert.equal(await f.ui.initialization(), undefined);
  assert.equal(f.project().assets.length, 0);
  assert.deepEqual(f.storage.get(VOICE_LIBRARY_KEY), before);
  assert.equal(f.used.length, 1);
});

test("global voice saving requires a real confirmed sample and cross-workspace use imports fresh local media handles", async () => {
  const savedGlobally: LibraryVoiceRecipe[] = [];
  const imports: string[] = [];
  const f = fixture({
    listVoices: async () => structuredClone(savedGlobally),
    saveVoice: async (recipe) => {
      savedGlobally.push(structuredClone(recipe));
      return structuredClone(recipe);
    },
    importVoice: async (id) => {
      imports.push(id);
      return { referenceMediaId: media("c"), sampleMediaId: media("d"), durationSeconds: 10 };
    },
  });
  f.installed();
  await f.ui.load();
  await f.select();
  await f.ui.action("voice-prep-save");
  assert.equal(savedGlobally.length, 0);
  await f.ui.action("voice-prep-sample");
  f.completeSample();
  await f.ui.refresh();
  await f.ui.action("voice-prep-save");
  assert.equal(savedGlobally.length, 0);
  f.input("confirmed", "", true);
  await f.ui.action("voice-prep-save");
  assert.equal(savedGlobally.length, 1);
  assert.equal(savedGlobally[0]!.referenceDurationSeconds, 10);
  assert.match(f.ui.render(), /所有项目可用/);
  f.changeProject();
  f.changeScope();
  f.storage.clear();
  await f.ui.load();
  assert.match(f.ui.render(), /使用 我的中文声音/);
  assert.deepEqual(imports, [], "Listing global voices never imports another workspace's media");
  assert.equal(f.project().assets.length, 0);
  await f.ui.action("voice-prep-use", savedGlobally[0]!.id);
  assert.deepEqual(imports, [savedGlobally[0]!.id]);
  assert.equal(f.project().assets[0]!.mediaId, media("c"));
  assert.equal(f.reconnected[0]!.mediaId, media("c"));
  assert.equal(f.used.at(-1)!.referenceAssetId, f.project().assets[0]!.id);
  assert.equal(f.requests.length, 1);
  assert.equal(f.ui.preparing(), false);
});

test("failed global publication reports the failure and does not falsely claim a reusable voice was saved", async () => {
  const f = fixture({
    listVoices: async () => [],
    saveVoice: async () => {
      throw new Error("共享声音录音保存失败，请重试");
    },
  });
  f.installed();
  await f.ui.load();
  await f.select();
  await f.ui.action("voice-prep-sample");
  f.completeSample();
  await f.ui.refresh();
  f.input("confirmed", "", true);
  await f.ui.action("voice-prep-save");
  assert.match(f.ui.render(), /共享声音录音保存失败，请重试/);
  assert.doesNotMatch(f.ui.render(), /我的声音库 · 多项目复用/);
  assert.equal(f.storage.has(VOICE_LIBRARY_KEY), false);
  assert.equal(f.ui.preparing(), true);
  assert.deepEqual(f.used, []);
});

test("switching projects during global import cannot apply old media or voice settings to the new project", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const globalVoice: LibraryVoiceRecipe = {
    id: "global-voice",
    name: "我的共享声音",
    modelId: "audio8-tts",
    referenceMediaId: media("a"),
    referenceText: "录音中真实说出的内容。",
    sampleMediaId: media("b"),
    sampleText: VOICE_SAMPLE_TEXT,
    referenceName: reference.name,
    referenceDurationSeconds: 10,
  };
  const f = fixture({
    listVoices: async () => [globalVoice],
    importVoice: async () => {
      await held;
      return { referenceMediaId: media("c"), sampleMediaId: media("d"), durationSeconds: 10 };
    },
  });
  await f.ui.load();
  const using = f.ui.action("voice-prep-use", globalVoice.id);
  await new Promise((resolve) => setImmediate(resolve));
  f.changeProject();
  await f.ui.load();
  release();
  await using;
  assert.equal(await f.ui.initialization(), undefined);
  assert.equal(f.project().assets.length, 0);
  assert.deepEqual(f.reconnected, []);
  assert.deepEqual(f.used, []);
  assert.equal(f.storage.has(VOICE_LIBRARY_KEY), false);
});

test("importing an external reference into another project updates the saved local mapping and keeps the verified voice usable", async () => {
  const shared: LibraryVoiceRecipe[] = [];
  const f = fixture({
    listVoices: async () => structuredClone(shared),
    saveVoice: async (recipe) => {
      shared.push(structuredClone(recipe));
      return structuredClone(recipe);
    },
    importVoice: async () => ({
      referenceMediaId: media("c"),
      sampleMediaId: media("d"),
      durationSeconds: 10,
    }),
  });
  const externalId = "external-" + "a".repeat(64);
  f.project().assets[0]!.mediaId = externalId;
  const saved = await saveVerifiedVoice(f);
  assert.equal(saved.referenceMediaId, externalId);
  f.changeProject();
  await f.ui.load();
  await f.ui.action("voice-prep-use", saved.id);
  const local = validateVoiceLibrary(f.storage.get(VOICE_LIBRARY_KEY), f.scope()).recipes[0]!;
  assert.equal(local.id, saved.id);
  assert.equal(local.referenceMediaId, media("c"));
  assert.equal(local.sampleMediaId, media("d"));
  assert.equal(local.referenceText, saved.referenceText);
  assert.equal(f.project().assets[0]!.mediaId, media("c"));
  assert.equal(
    f.ui.preparing(),
    false,
    "A verified voice opens the full narration form after import",
  );
  assert.equal(f.used.at(-1)!.referenceAssetId, f.project().assets[0]!.id);
  assert.equal(f.requests.length, 1);
  assert.equal(
    shared[0]!.referenceMediaId,
    externalId,
    "Local remapping never rewrites the app-wide recipe",
  );
  assert.throws(
    () =>
      mergeVoiceLibrary(
        { schemaVersion: 1, scope: f.scope(), recipes: [saved] },
        [{ ...local, referenceText: "不同的录音逐字稿" }],
        true,
      ),
    /同编号的不同声音/,
  );
  await f.ui.load();
  assert.equal(f.ui.preparing(), false);
  assert.equal((await f.ui.initialization())!.referenceAssetId, f.project().assets[0]!.id);
});

test("explicit refresh discovers voices from another workspace while preserving the unfinished draft", async () => {
  const shared: LibraryVoiceRecipe[] = [];
  let listCalls = 0;
  let unavailable = false;
  const f = fixture({
    listVoices: async () => {
      listCalls++;
      if (unavailable) throw new Error("声音文件暂时无法读取");
      return structuredClone(shared);
    },
  });
  await f.ui.load();
  await f.select();
  const draft = await f.ui.initialization();
  const stored = structuredClone(f.storage.get(`video-studio-voice-preparation-${f.project().id}`));
  const available: LibraryVoiceRecipe = {
    id: "saved-in-another-workspace",
    name: "在另一工程准备的声音",
    modelId: "audio8-tts",
    referenceMediaId: media("c"),
    referenceName: "已确认录音.wav",
    referenceDurationSeconds: 10,
    referenceText: "另一工程中本人实际说出的录音内容。",
    sampleMediaId: media("d"),
    sampleText: VOICE_SAMPLE_TEXT,
  };
  shared.push(available);
  await f.ui.refresh();
  await f.ui.refresh();
  assert.equal(
    listCalls,
    1,
    "Background task polling does not repeatedly start native library reads",
  );
  assert.doesNotMatch(f.ui.render(), /在另一工程准备的声音/);
  await f.ui.action("voice-prep-retry");
  assert.equal(listCalls, 2);
  assert.match(f.ui.render(), /使用 在另一工程准备的声音/);
  assert.deepEqual(await f.ui.initialization(), draft);
  assert.deepEqual(f.storage.get(`video-studio-voice-preparation-${f.project().id}`), stored);
  unavailable = true;
  await f.ui.action("voice-prep-retry");
  assert.match(f.ui.render(), /声音库未刷新，已保留上次的声音和当前草稿/);
  assert.match(f.ui.render(), /使用 在另一工程准备的声音/);
  assert.deepEqual(await f.ui.initialization(), draft);
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.reconnected, []);
});
