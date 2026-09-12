import assert from "node:assert/strict";
import { test } from "node:test";
import { createProject, type Asset, type Project } from "../apps/video-studio/src/model";
import type { MediaJob, ProductionController, VoicePreparation, VoiceRequest } from "../apps/video-studio/src/production";
import { createVoicePreparationUI, validateVoiceRecipes, VOICE_SAMPLE_TEXT } from "../apps/video-studio/src/voice-preparation-ui";

const media = (letter: string) => "asset-" + letter.repeat(64);
const reference: Asset = { id: "recording-project-id", mediaId: media("a"), kind: "audio", name: "我的录音.wav", durationFrames: 300 };
const job = (id: string, type: string, status: MediaJob["status"] = "queued"): MediaJob => ({ id, type, status, createdAt: 1, updatedAt: 1, attempt: 1 });
function fixture() {
  let project: Project = { ...createProject(), assets: [structuredClone(reference)] };
  let scope = "/workspace/a", failWrites = false, available = false;
  let missingEngine = false, catalogFailure = false, installable = true;
  let runtimeReason = "", catalogReason = "";
  let changes = 0;
  let holdWrite: Promise<void> | undefined;
  const storage = new Map<string, unknown>();
  const requests: VoiceRequest[] = [], extracts: unknown[][] = [], setups: string[] = [], used: VoicePreparation[] = [];
  const writes: { key: string; scope: string; projectId: string }[] = [];
  const jobs: MediaJob[] = [], allJobs = new Map<string, MediaJob>();
  const production = {
    enabled: true,
    currentJobs: jobs,
    voices: async () => { if (catalogFailure) throw new Error("声音目录暂时无法连接"); return { voices: [], reason: catalogReason, models: (missingEngine ? ["qwen3-tts"] : ["audio8-tts", "qwen3-tts"]).map((id) => ({ id, name: id, available, installable, reason: runtimeReason, supportsVoiceCloning: true, voices: [{ id: "reference", name: "本人声音", language: "zh" }] })) }; },
    setupTts: async (id: string) => { setups.push(id); const task = job("setup", "tts-setup"); jobs.push(task); allJobs.set(task.id, task); return task; },
    prepareVoice: async (request: VoiceRequest) => { requests.push(structuredClone(request)); const task = job("sample", "tts-clone"); jobs.push(task); allJobs.set(task.id, task); return task; },
    extractReference: async (...args: unknown[]) => { extracts.push(args); const task = job("extract", "audio-extract"); jobs.push(task); allJobs.set(task.id, task); return task; },
  } as unknown as ProductionController;
  const ui = createVoicePreparationUI(production, {
    project: () => project, scope: () => scope,
    read: async (key) => structuredClone(storage.get(key) ?? null),
    write: async (key, value) => {
      writes.push({ key, scope, projectId: project.id });
      if (holdWrite) await holdWrite;
      if (failWrites) throw new Error("模拟磁盘已满");
      storage.set(key, structuredClone(value));
    },
    getJob: async (id) => { const item = allJobs.get(id); if (!item) throw new Error("任务已不可用，请重新生成试听"); return structuredClone(item); },
    changed() { changes++; }, assertEditable() {}, toast() {}, useVoice: async (value) => { used.push(structuredClone(value)); },
  });
  const input = (field: string, value: string, checked = false) => ui.input({ id: `voice-prep-${field}`, value, checked } as HTMLInputElement);
  async function select() {
    input("model", "audio8-tts"); input("reference", reference.id); input("transcript", "这是我本人录下的参考声音。");
    await ui.initialization();
  }
  function completeSample() {
    const request = requests.at(-1)!;
    const asset: Asset = { id: "sample-project-id", mediaId: media("b"), kind: "audio", name: "真实试听.wav", durationFrames: 210,
      speech: { text: request.text, modelId: request.modelId, voiceId: "reference", rate: 1, engine: "audio8-tts", referenceAssetId: reference.mediaId, referenceText: request.referenceText } };
    project.assets.push(asset);
    const task = allJobs.get("sample")!;
    task.status = "succeeded";
    task.result = { asset: { id: asset.mediaId }, speech: asset.speech };
    return asset;
  }
  return { ui, input, select, completeSample, storage, requests, extracts, setups, used, jobs, allJobs, writes,
    project: () => project, scope: () => scope,
    changes: () => changes,
    changeProject: (next = { ...createProject(), assets: [] as Asset[] }) => { project = next; },
    changeScope: () => { scope = "/workspace/b"; },
    installed: () => { available = true; },
    missingEngine: (reason = "") => { missingEngine = true; catalogReason = reason; },
    unavailable: (reason: string) => { available = false; installable = false; runtimeReason = reason; },
    failCatalog: () => { catalogFailure = true; },
    failWrites: (value = true) => { failWrites = value; },
    holdWrites: (promise?: Promise<void>) => { holdWrite = promise; },
  };
}

test("unrelated job refreshes do not redraw editable voiceover fields; newly recovered sample proof still updates", async () => {
  const f = fixture(); f.installed(); await f.ui.load();
  const loaded = f.changes();
  await f.ui.refresh(); await f.ui.refresh();
  assert.equal(f.changes(), loaded, "No voice selection or job changes means no form replacement");
  await f.select(); await f.ui.action("voice-prep-sample"); f.completeSample();
  const beforeProof = f.changes();
  await f.ui.refresh();
  assert.ok(f.changes() > beforeProof, "A completed real sample must appear");
  const completed = f.changes();
  await f.ui.refresh(); await f.ui.refresh();
  assert.equal(f.changes(), completed, "Unchanged proof must not interrupt later text or IME input");
});

test("a missing local runtime catalog does not invent availability or require a provider-specific desktop update", async () => {
  const f = fixture(); f.missingEngine("面板本地声音运行环境无法启动：未找到 Node.js。"); await f.ui.load(); f.input("model", "audio8-tts");
  assert.match(f.ui.render(), /面板本地声音运行环境无法启动：未找到 Node.js/);
  assert.doesNotMatch(f.ui.render(), /更新桌面应用/);
  await f.ui.action("voice-prep-setup"); assert.equal(f.setups.length, 0);
  f.input("model", "qwen3-tts");
  await f.ui.action("voice-prep-setup"); assert.deepEqual(f.setups, ["qwen3-tts"]);
  f.input("model", "audio8-tts"); f.failCatalog(); await f.ui.action("voice-prep-retry");
  assert.match(f.ui.render(), /声音目录暂时无法连接/);
  assert.doesNotMatch(f.ui.render(), /更新桌面应用/);
});

test("both local engines show the actual runtime reason and prevent setup and synthesis when unsupported", async () => {
  for (const id of ["audio8-tts", "qwen3-tts"]) {
    const f = fixture(); f.unavailable("本地声音运行环境缺少 FFmpeg，请先安装。"); await f.ui.load(); await f.select(); f.input("model", id);
    assert.match(f.ui.render(), /本地声音运行环境缺少 FFmpeg，请先安装/);
    await f.ui.action("voice-prep-setup"); await f.ui.action("voice-prep-sample");
    assert.equal(f.setups.length, 0); assert.equal(f.requests.length, 0);
  }
});

test("a failed runtime refresh cannot reuse a stale ready model", async () => {
  const f = fixture(); f.installed(); await f.ui.load(); await f.select();
  f.failCatalog(); await f.ui.action("voice-prep-retry");
  assert.match(f.ui.render(), /声音目录暂时无法连接/);
  await f.ui.action("voice-prep-sample");
  assert.equal(f.requests.length, 0);
});

test("initialization can request installation without falsely claiming a personal voice is ready", async () => {
  const f = fixture(); await f.ui.load();
  assert.equal(await f.ui.initialization(), undefined);
  f.input("model", "audio8-tts");
  assert.deepEqual(await f.ui.initialization(), { modelId: "audio8-tts", sampleText: VOICE_SAMPLE_TEXT });
  assert.match(f.ui.render(), /尚未选择本人参考录音/);
  await f.ui.action("voice-prep-sample");
  assert.equal(f.requests.length, 0);
  await f.ui.action("voice-prep-setup");
  assert.deepEqual(f.setups, ["audio8-tts"]);
  f.installed(); f.allJobs.get("setup")!.status = "succeeded"; await f.ui.refresh();
  assert.match(f.ui.render(), /引擎：已安装/);
  assert.match(f.ui.render(), /声音：尚未验证/);
  assert.doesNotMatch(f.ui.render(), /保存为可复用声音/);
});

test("actual sample provenance and listener confirmation are required before a recipe is saved and reused", async () => {
  const f = fixture(); f.installed(); await f.ui.load(); await f.select();
  const before = structuredClone(f.project());
  await f.ui.action("voice-prep-sample");
  assert.deepEqual(f.requests, [{ text: VOICE_SAMPLE_TEXT, modelId: "audio8-tts", voiceId: "reference", rate: 1, referenceAssetId: reference.id, referenceText: "这是我本人录下的参考声音。" }]);
  assert.deepEqual(f.project(), before, "Submitting preparation does not edit picture or audio tracks");
  f.completeSample(); await f.ui.refresh();
  assert.match(f.ui.render(), /本人声音真实试听/);
  await f.ui.action("voice-prep-save");
  assert.match(f.ui.render(), /请先生成真实试听，并确认已听过/);
  f.input("confirmed", "", true); f.input("name", "我的自然中文");
  await f.ui.action("voice-prep-save");
  assert.match(f.ui.render(), /已保存「我的自然中文」/);
  const saved = [...f.storage.values()][0] as { recipes: { id: string; referenceMediaId: string; sampleMediaId: string }[] };
  assert.equal(saved.recipes[0]!.referenceMediaId, reference.mediaId);
  assert.equal(saved.recipes[0]!.sampleMediaId, media("b"));
  await f.ui.action("voice-prep-use", saved.recipes[0]!.id);
  assert.equal(f.used[0]!.referenceAssetId, reference.id);
  assert.deepEqual(f.project().clips, before.clips);
  assert.deepEqual(f.project().audioClips, before.audioClips);
});

test("save failure keeps recipe uncommitted and allows a later successful retry", async () => {
  const f = fixture(); f.installed(); await f.ui.load(); await f.select();
  await f.ui.action("voice-prep-sample"); f.completeSample(); await f.ui.refresh();
  f.input("confirmed", "", true); f.failWrites();
  await f.ui.action("voice-prep-save");
  assert.match(f.ui.render(), /模拟磁盘已满/);
  assert.doesNotMatch(f.ui.render(), /当前工程已保存的声音/);
  assert.deepEqual(([...f.storage.values()][0] as { recipes: unknown[] }).recipes, []);
  f.failWrites(false); await f.ui.action("voice-prep-save");
  assert.match(f.ui.render(), /当前工程已保存的声音/);
});

test("refresh restores recipe selection and gets an older sample job beyond the recent job window", async () => {
  const f = fixture(); f.installed(); await f.ui.load(); await f.select();
  await f.ui.action("voice-prep-sample"); f.completeSample(); await f.ui.refresh();
  f.input("confirmed", "", true); await f.ui.action("voice-prep-save");
  f.jobs.splice(0);
  await f.ui.load();
  assert.match(f.ui.render(), /本人声音真实试听/);
  assert.match(f.ui.render(), /当前工程已保存的声音/);
  assert.equal((await f.ui.initialization())!.referenceText, "这是我本人录下的参考声音。");
});

test("extract waits for the actual published audio before selecting it; old project completion cannot switch the new project", async () => {
  const f = fixture(); await f.ui.load();
  await f.ui.extract("video-project-id", 30, 330);
  assert.deepEqual(f.extracts, [["video-project-id", 30, 330]]);
  const task = f.allJobs.get("extract")!;
  task.status = "succeeded"; task.result = { asset: { id: media("c") }, inspection: { kind: "audio" } };
  await f.ui.refresh(); assert.equal(f.used.length, 0);
  f.project().assets.push({ id: "extracted-project-id", mediaId: media("c"), kind: "audio", name: "提取参考.wav", durationFrames: 300 });
  await f.ui.refresh();
  assert.deepEqual(f.used[0], { modelId: "audio8-tts", referenceAssetId: "extracted-project-id", referenceText: "", sampleText: VOICE_SAMPLE_TEXT });
  await f.ui.extract("video-project-id", 30, 330);
  f.changeProject(); await f.ui.load();
  task.status = "succeeded";
  await f.ui.refresh(); assert.equal(f.used.length, 1);
  assert.equal(await f.ui.initialization(), undefined);
});

test("queued writes are stopped before a changed scope or project can receive them", async () => {
  const f = fixture(); await f.ui.load();
  let release!: () => void;
  f.holdWrites(new Promise<void>((resolve) => { release = resolve; }));
  f.input("model", "audio8-tts");
  await new Promise((resolve) => setImmediate(resolve));
  f.input("reference", reference.id);
  f.changeProject(); f.changeScope();
  const loading = f.ui.load();
  release(); f.holdWrites(); await loading;
  assert.equal(f.writes.length, 1, "The queued second snapshot never reaches the new Host binding");
  assert.equal(await f.ui.initialization(), undefined);
  assert.doesNotMatch(f.ui.render(), /当前工程已保存的声音|工程已切换/);
});

test("malformed or cross-scope storage is locked without overwriting existing records", async () => {
  const f = fixture();
  const key = `video-studio-voice-preparation-${f.project().id}`;
  const corrupted = { schemaVersion: 1, scope: "/another-workspace", projectId: f.project().id, selection: null, recipes: [] };
  f.storage.set(key, corrupted); await f.ui.load();
  f.input("model", "audio8-tts"); await f.ui.action("voice-prep-setup").catch(() => {});
  assert.match(f.ui.render(), /原记录已保留/);
  assert.deepEqual(f.storage.get(key), corrupted);
  assert.equal(f.writes.length, 0);
  assert.throws(() => validateVoiceRecipes({ ...corrupted, scope: f.scope(), recipes: [{ id: "x", referenceMediaId: "/tmp/voice.wav" }] }, f.scope(), f.project().id));
});

test("a project JSON speech annotation alone cannot fabricate a verified audio sample", async () => {
  const f = fixture(); f.installed(); await f.ui.load(); await f.select();
  f.requests.push({ text: VOICE_SAMPLE_TEXT, modelId: "audio8-tts", referenceText: "这是我本人录下的参考声音。" });
  f.allJobs.set("sample", job("sample", "tts"));
  f.completeSample(); f.allJobs.clear(); f.jobs.splice(0);
  assert.doesNotMatch(f.ui.render(), /本人声音真实试听/);
  f.input("confirmed", "", true); await f.ui.action("voice-prep-save");
  assert.doesNotMatch(f.ui.render(), /当前工程已保存的声音/);
});
