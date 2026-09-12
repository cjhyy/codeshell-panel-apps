import { escapeHtml as esc, html } from "./icons";
import type { Asset, Project } from "./model";
import type { MediaJob, ProductionController, VoiceModel, VoicePreparation } from "./production";

export const VOICE_SAMPLE_TEXT = "你好，这是我的声音试听。我会用自然的语气，介绍今天的视频内容。";
const engines = ["audio8-tts", "qwen3-tts"] as const;
const managedId = (value: unknown): value is string =>
  typeof value === "string" && /^asset-[a-f0-9]{64}$/.test(value);
const shortText = (value: unknown, max: number): value is string =>
  typeof value === "string" && Array.from(value).length <= max;
type Recipe = {
  id: string;
  name: string;
  modelId: string;
  referenceMediaId: string;
  referenceText: string;
  sampleMediaId: string;
  sampleText: string;
};
interface Document {
  schemaVersion: 1;
  scope: string;
  projectId: string;
  selection: VoicePreparation | null;
  recipes: Recipe[];
  sampleJobId?: string;
  pending?: { kind: "extract" | "sample" | "setup"; jobId: string };
}
interface Context {
  project(): Project;
  scope(): string;
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
  getJob(id: string): Promise<MediaJob>;
  changed(): void;
  assertEditable(): void;
  useVoice(value: VoicePreparation): Promise<void>;
  toast(message: string): void;
}
const empty = (scope: string, projectId: string): Document => ({
  schemaVersion: 1, scope, projectId, selection: null, recipes: [],
});

export function validateVoiceRecipes(value: unknown, scope: string, projectId: string): Document {
  const data = value as Document;
  const bad = () => { throw new Error("声音设置无法恢复，原记录已保留，请检查存储后重试。"); };
  if (!data || typeof data !== "object" || data.schemaVersion !== 1 ||
      data.scope !== scope || data.projectId !== projectId || !Array.isArray(data.recipes) ||
      data.recipes.length > 20 || Object.keys(data).some((key) =>
        !["schemaVersion", "scope", "projectId", "selection", "recipes", "pending", "sampleJobId"].includes(key))) bad();
  if (data.sampleJobId !== undefined && (!shortText(data.sampleJobId, 256) || !data.sampleJobId)) bad();
  const selected = data.selection;
  if (selected !== null && (!selected || !engines.includes(selected.modelId as typeof engines[number]) ||
      Object.keys(selected).some((key) => !["modelId", "referenceAssetId", "referenceText", "sampleText"].includes(key)) ||
      (selected.referenceAssetId !== undefined && !shortText(selected.referenceAssetId, 256)) ||
      (selected.referenceText !== undefined && !shortText(selected.referenceText, 1000)) ||
      (selected.sampleText !== undefined && !shortText(selected.sampleText, 120)))) bad();
  const ids = new Set<string>();
  for (const recipe of data.recipes) {
    if (!recipe || !shortText(recipe.id, 80) || !recipe.id || ids.has(recipe.id) ||
        !shortText(recipe.name, 80) || !recipe.name.trim() ||
        !engines.includes(recipe.modelId as typeof engines[number]) ||
        !managedId(recipe.referenceMediaId) || !managedId(recipe.sampleMediaId) ||
        !shortText(recipe.referenceText, 1000) || !recipe.referenceText.trim() ||
        !shortText(recipe.sampleText, 120) || !recipe.sampleText.trim() ||
        Object.keys(recipe).some((key) => !["id", "name", "modelId", "referenceMediaId", "referenceText", "sampleMediaId", "sampleText"].includes(key))) bad();
    ids.add(recipe.id);
  }
  if (data.pending && (!["extract", "sample", "setup"].includes(data.pending.kind) ||
      !shortText(data.pending.jobId, 256) || !data.pending.jobId ||
      Object.keys(data.pending).some((key) => !["kind", "jobId"].includes(key)))) bad();
  return structuredClone(data);
}

/** Reusable voice recipes are bound to the workspace and project, separate from timeline edits. */
export function createVoicePreparationUI(production: ProductionController, context: Context) {
  let document = empty(context.scope(), context.project().id);
  let catalog: VoiceModel[] = [];
  let catalogLoaded = false;
  let catalogReason = "";
  let loaded = false, locked = false, busy = false;
  let refreshingVersion: number | undefined;
  let error = "", message = "", recipeName = "我的中文声音", confirmed = false;
  let version = 0;
  let saveQueue = Promise.resolve();
  const verifiedJobs = new Map<string, MediaJob>();
  const current = () => document.scope === context.scope() && document.projectId === context.project().id;
  const key = (id: string) => `video-studio-voice-preparation-${id}`;
  const selected = () => current() ? document.selection : null;
  const reference = () => context.project().assets.find((asset) => asset.id === selected()?.referenceAssetId && asset.kind === "audio" && managedId(asset.mediaId));
  const model = () => catalog.find((item) => item.id === selected()?.modelId);
  const engineReason = () => {
    if (!production.enabled || !catalogLoaded || !selected()) return "";
    const engine = model();
    if (!engine) return catalogReason || "面板本地声音运行环境尚未提供所选引擎，请刷新状态查看检查结果。";
    return engine.available ? "" : engine.reason || "所选声音引擎尚未准备完成，请安装并检查引擎。";
  };
  const sampleText = () => selected()?.sampleText ?? VOICE_SAMPLE_TEXT;
  const pendingJob = () => current() && document.pending
    ? production.currentJobs.find((job) => job.id === document.pending!.jobId) : undefined;
  function sample(): Asset | undefined {
    const selection = selected(), source = reference();
    if (!selection || !source) return undefined;
    return [...context.project().assets].reverse().find((asset) => asset.kind === "audio" && managedId(asset.mediaId) &&
      [...production.currentJobs, ...verifiedJobs.values()].some((job) => ["tts", "tts-clone", "tts-managed", "tts-online"].includes(job.type) && job.status === "succeeded" &&
        (job.result as { asset?: { id?: string } } | undefined)?.asset?.id === asset.mediaId) &&
      asset.speech?.modelId === selection.modelId && asset.speech.voiceId === "reference" &&
      asset.speech.referenceAssetId === source.mediaId && asset.speech.referenceText === selection.referenceText?.trim() &&
      asset.speech.text === sampleText().trim());
  }
  function referenceError(): string {
    if (!selected()) return "未选择声音准备，初始化将保留现有原声。";
    const asset = reference();
    if (!asset) return "尚未选择本人参考录音；可先安装引擎，声音还未准备完成。";
    const seconds = asset.durationFrames / context.project().fps;
    if (seconds < 3 || seconds > 30) return "参考录音需要 3–30 秒。长素材可在粗剪里提取一段。";
    if (!selected()?.referenceText?.trim()) return "请填写参考录音实际说出的内容，再生成试听。";
    if (Array.from(selected()!.referenceText!).length > 1000) return "参考逐字稿最多 1000 字。";
    return "";
  }
  function canSample(): boolean {
    return loaded && !locked && !busy && production.enabled && !!model()?.available && !referenceError() &&
      !!sampleText().trim() && Array.from(sampleText()).length <= 120;
  }
  async function persist(next = document): Promise<void> {
    if (!loaded || locked || !current()) throw new Error("声音设置尚未安全恢复，不能覆盖原记录。");
    const snapshot = validateVoiceRecipes(next, context.scope(), context.project().id);
    const ownVersion = version;
    const operation = saveQueue.catch(() => {}).then(() => {
      if (ownVersion !== version || snapshot.scope !== context.scope() || snapshot.projectId !== context.project().id)
        throw new Error("工程已切换，已停止写入原声音设置。");
      return context.write(key(snapshot.projectId), snapshot);
    });
    saveQueue = operation;
    await operation;
  }
  function report(reason: unknown): void {
    error = reason instanceof Error ? reason.message : String(reason);
    context.changed();
  }
  function saveDraft(): void {
    const ownVersion = version;
    void persist().catch((reason) => { if (ownVersion === version) report(reason); });
  }
  async function load(): Promise<void> {
    const ownVersion = ++version, projectId = context.project().id, scope = context.scope();
    loaded = false;
    locked = false;
    busy = false;
    error = "";
    message = "";
    confirmed = false;
    catalog = [];
    catalogLoaded = false;
    catalogReason = "";
    verifiedJobs.clear();
    document = empty(scope, projectId);
    try {
      await saveQueue.catch(() => {});
      const stored = await context.read(key(projectId));
      if (ownVersion !== version || projectId !== context.project().id || scope !== context.scope()) return;
      document = stored == null ? empty(scope, projectId) : validateVoiceRecipes(stored, scope, projectId);
      loaded = true;
    } catch (reason) {
      if (ownVersion !== version) return;
      locked = true;
      report(reason);
    }
    await refreshCatalog();
    if (ownVersion === version) await refresh();
    if (ownVersion === version) context.changed();
  }
  async function refreshCatalog(): Promise<void> {
    if (!production.enabled) return;
    const ownVersion = version;
    try {
      const next = await production.voices();
      if (ownVersion === version) { catalog = next.models ?? []; catalogLoaded = true; catalogReason = next.reason ?? ""; }
    } catch (reason) {
      if (ownVersion === version) { catalog = []; catalogLoaded = false; catalogReason = ""; report(reason); }
    }
  }
  async function run(work: () => Promise<void>): Promise<void> {
    if (busy) return;
    context.assertEditable();
    if (!loaded || locked || !current()) throw new Error("请先恢复当前工程的声音设置。");
    busy = true;
    error = "";
    const ownVersion = version;
    context.changed();
    try { await work(); }
    catch (reason) { if (ownVersion === version) report(reason); }
    finally { if (ownVersion === version) { busy = false; context.changed(); } }
  }
  async function track(kind: "extract" | "sample" | "setup", job: MediaJob, ownVersion: number): Promise<void> {
    if (ownVersion !== version || !current()) return;
    document.pending = { kind, jobId: job.id };
    if (kind === "sample") document.sampleJobId = job.id;
    await persist();
    message = kind === "extract" ? "正在提取真实参考音频；完成后可填写逐字稿。" : kind === "sample" ? "正在生成真实短句试听，不会加入成片。" : "正在安装并检查引擎；本人声音还需要参考录音和试听。";
    context.changed();
  }
  async function refresh(): Promise<void> {
    if (refreshingVersion === version || !loaded || !current()) return;
    const ownVersion = version;
    refreshingVersion = ownVersion;
    let proofChanged = false;
    try {
      const existingSample = sample();
      const existingJob = existingSample && production.currentJobs.find((job) => job.status === "succeeded" &&
        (job.result as { asset?: { id?: string } } | undefined)?.asset?.id === existingSample.mediaId);
      if (existingJob && document.sampleJobId !== existingJob.id) {
        document.sampleJobId = existingJob.id;
        verifiedJobs.set(existingJob.id, existingJob);
        proofChanged = true;
        await persist();
        if (ownVersion !== version || !current()) return;
      }
      if (document.sampleJobId && !verifiedJobs.has(document.sampleJobId)) {
        const proof = await context.getJob(document.sampleJobId);
        if (ownVersion !== version || !current()) return;
        if (proof.status === "succeeded" && proof.result) {
          verifiedJobs.set(proof.id, proof);
          proofChanged = true;
        }
      }
      const pending = document.pending;
      // Unrelated media polling must not replace focused fields or interrupt IME input.
      if (!pending) { if (proofChanged) context.changed(); return; }
      let job = pendingJob();
      if (!job || (job.status === "succeeded" && !job.result)) job = await context.getJob(pending.jobId);
      if (ownVersion !== version || !current()) return;
      if (["queued", "running"].includes(job.status)) return;
      if (job.status === "succeeded" && job.result) verifiedJobs.set(job.id, job);
      if (job.status !== "succeeded") {
        message = "";
        error = job.error?.message || (job.status === "cancelled" ? "准备已取消，可以重试。" : "声音准备失败，可以重试。");
      } else if (pending.kind === "extract") {
        const mediaId = (job.result as { asset?: { id?: string } } | undefined)?.asset?.id;
        const asset = context.project().assets.find((item) => item.mediaId === mediaId && item.kind === "audio");
        if (!asset) return; // Wait until the controller has durably published the actual extracted asset.
        document.selection = { modelId: selected()?.modelId || "audio8-tts", referenceAssetId: asset.id, referenceText: "", sampleText: VOICE_SAMPLE_TEXT };
        confirmed = false;
        message = "已提取并保存参考录音。请填写逐字稿，然后生成短句试听。";
      } else if (pending.kind === "setup") {
        await refreshCatalog();
        if (ownVersion !== version || !current()) return;
        message = "引擎检查完成。选择本人录音并生成短试听后，才能保存自己的声音。";
      } else {
        if (!sample()) return;
        message = "真实试听已生成。请播放并确认音色，再保存为可复用声音。";
      }
      if (ownVersion !== version || !current()) return;
      delete document.pending;
      await persist();
      if (pending.kind === "extract" && job.status === "succeeded") await context.useVoice(document.selection!);
      context.changed();
    } catch (reason) { if (ownVersion === version) report(reason); }
    finally { if (refreshingVersion === ownVersion) refreshingVersion = undefined; }
  }
  async function extract(assetId: string, inFrame: number, outFrame: number): Promise<void> {
    await run(async () => {
      const ownVersion = version;
      const job = await production.extractReference(assetId, inFrame, outFrame);
      await track("extract", job, ownVersion);
    });
  }
  async function initialization(): Promise<VoicePreparation | undefined> {
    if (!selected()) return undefined;
    const ownVersion = version;
    await persist();
    if (ownVersion !== version || !current()) throw new Error("工程已切换，请重新选择声音准备。");
    const value = selected()!;
    if (!reference()) return { modelId: value.modelId, sampleText: sampleText().trim() || VOICE_SAMPLE_TEXT };
    if (referenceError()) throw new Error(referenceError());
    return { modelId: value.modelId, referenceAssetId: reference()!.id, referenceText: value.referenceText!.trim(), sampleText: sampleText().trim() || VOICE_SAMPLE_TEXT };
  }
  function input(target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): boolean {
    if (!target.id.startsWith("voice-prep-")) return false;
    if (!loaded || locked || !current()) return true;
    const field = target.id.slice("voice-prep-".length);
    if (field === "confirmed") confirmed = (target as HTMLInputElement).checked;
    else if (field === "name") recipeName = target.value;
    else {
      confirmed = false;
      if (field === "model") {
        document.selection = engines.includes(target.value as typeof engines[number])
          ? { ...selected(), modelId: target.value, sampleText: sampleText() } : null;
      } else if (selected()) {
        if (field === "reference") { document.selection!.referenceAssetId = target.value; document.selection!.referenceText = ""; }
        else if (field === "transcript") document.selection!.referenceText = target.value;
        else if (field === "sample") document.selection!.sampleText = target.value;
        else return false;
      }
      saveDraft();
    }
    if (["model", "reference"].includes(field)) context.changed();
    else sync();
    return true;
  }
  function sync(): void {
    if (typeof window === "undefined") return;
    const sampleButton = window.document.querySelector<HTMLButtonElement>('[data-action="voice-prep-sample"]');
    if (sampleButton) sampleButton.disabled = !canSample();
    const save = window.document.querySelector<HTMLButtonElement>('[data-action="voice-prep-save"]');
    if (save) save.disabled = busy || !confirmed || !sample() || !recipeName.trim();
    const status = window.document.querySelector("[data-voice-prep-reference-status]");
    if (status) status.textContent = referenceError() || "参考已填写，可以生成短句试听。";
  }
  async function action(name: string, id?: string): Promise<boolean> {
    if (!name.startsWith("voice-prep-")) return false;
    await run(async () => {
      const ownVersion = version, value = selected();
      if (name === "voice-prep-retry") await refreshCatalog();
      else if (name === "voice-prep-setup") {
        if (!value || !model()?.installable || !production.enabled) throw new Error(engineReason() || "请先选择可安装的声音引擎。");
        await track("setup", await production.setupTts(value.modelId), ownVersion);
      } else if (name === "voice-prep-sample") {
        // run() sets busy; availability and reference validation remain authoritative here.
        if (!value || !production.enabled || !model()?.available || referenceError()) throw new Error(referenceError() || engineReason() || "请先安装并检查所选引擎。");
        const content = sampleText().trim();
        if (!content || Array.from(content).length > 120) throw new Error("试听文案需要 1–120 字。");
        await persist();
        if (ownVersion !== version || !current()) return;
        await track("sample", await production.prepareVoice({ text: content, modelId: value.modelId, voiceId: "reference", rate: 1, referenceAssetId: reference()!.id, referenceText: value.referenceText!.trim() }), ownVersion);
      } else if (name === "voice-prep-save") {
        const preview = sample(), source = reference();
        if (!value || !preview || !source || !confirmed) throw new Error("请先生成真实试听，并确认已听过且满意。");
        if (!recipeName.trim() || Array.from(recipeName).length > 80) throw new Error("请填写 1–80 字的声音名称。");
        if (document.recipes.length >= 20) throw new Error("当前工程最多保存 20 个声音。");
        const recipe: Recipe = { id: crypto.randomUUID(), name: recipeName.trim(), modelId: value.modelId, referenceMediaId: source.mediaId!, referenceText: value.referenceText!.trim(), sampleMediaId: preview.mediaId!, sampleText: sampleText().trim() };
        const next = { ...document, recipes: [...document.recipes, recipe] };
        await persist(next);
        if (ownVersion !== version) return;
        document = next;
        confirmed = false;
        message = `已保存「${recipe.name}」，可在当前工程反复使用。`;
      } else if (name === "voice-prep-use") {
        const recipe = document.recipes.find((item) => item.id === id);
        if (recipe) {
          const source = context.project().assets.find((asset) => asset.kind === "audio" && asset.mediaId === recipe.referenceMediaId);
          if (!source) throw new Error("这个声音的参考素材不在当前工程，请重新连接本人录音。");
          document.selection = { modelId: recipe.modelId, referenceAssetId: source.id, referenceText: recipe.referenceText, sampleText: recipe.sampleText };
          await persist();
          if (ownVersion !== version || !current()) return;
        }
        if (!selected() || referenceError()) throw new Error(referenceError() || "请先选择本人声音。");
        await context.useVoice(selected()!);
      }
    });
    return true;
  }
  function render(compact = false): string {
    const value = selected(), preview = sample(), job = pendingJob();
    const savedRecipe = current() && reference() ? document.recipes.find((recipe) => recipe.modelId === value?.modelId && recipe.referenceMediaId === reference()?.mediaId && recipe.referenceText === value?.referenceText?.trim()) : undefined;
    const unavailable = !production.enabled || !loaded || locked || busy;
    const models = engines.map((id) => catalog.find((item) => item.id === id) ?? { id, name: id === "audio8-tts" ? "Audio8 · 本人声音" : "Qwen3-TTS · 本人声音", available: false });
    return html`${compact ? `<details class="voice-preparation-disclosure" ${savedRecipe ? "" : "open"}><summary>${savedRecipe ? `我的声音：${esc(savedRecipe.name)} · 配方已保存` : "准备 / 管理本人声音"}</summary>` : ""}<section class="voice-preparation" aria-label="准备我的声音">
      <h3>准备我的声音 <span class="small muted">可选</span></h3>
      <p class="small muted">先检查引擎，再用本人录音生成短句试听。满意后命名保存，后续配音复用。</p>
      <label class="input-label">声音引擎<select id="voice-prep-model" ${unavailable ? "disabled" : ""}>
        <option value="">暂不准备，保留现有原声</option>${models.map((item) => `<option value="${item.id}" ${value?.modelId === item.id ? "selected" : ""}>${esc(item.name)} · ${item.available ? "已安装" : "待检查 / 安装"}</option>`).join("")}
      </select></label>
      ${engineReason() ? `<p class="capability-note" role="status">${esc(engineReason())}</p>` : ""}
      ${value ? html`<ol class="voice-preparation-steps"><li>引擎：${model()?.available ? "已安装" : "尚未就绪"}</li><li>参考：${referenceError() ? "待准备" : "已填写"}</li><li>声音：${savedRecipe ? `配方已保存 · ${esc(savedRecipe.name)}` : preview ? "已有真实试听，待确认 / 保存" : "尚未验证"}</li></ol>
        <div class="library-actions"><button data-action="voice-prep-setup" ${unavailable || !model()?.installable ? "disabled" : ""}>${model()?.available ? "检查 / 修复引擎" : "安装并检查引擎"}</button><button data-action="voice-prep-retry" ${unavailable ? "disabled" : ""}>刷新状态</button></div>
        <p class="small muted">初始化会准备本地声音引擎。请保持面板打开；关闭后任务会中断，重开可以重试。</p>
        <label class="input-label">本人参考录音<select id="voice-prep-reference" ${unavailable ? "disabled" : ""}><option value="">尚未选择录音</option>${context.project().assets.filter((asset) => asset.kind === "audio" && managedId(asset.mediaId)).map((asset) => `<option value="${esc(asset.id)}" ${asset.id === value.referenceAssetId ? "selected" : ""}>${esc(asset.name)} · ${(asset.durationFrames / context.project().fps).toFixed(1)} 秒</option>`).join("")}</select></label>
        <p class="small muted">用 3–30 秒清晰本人录音；也可在素材粗剪里标记一段，提取为参考音频。</p>
        <label class="input-label">参考录音逐字稿<textarea id="voice-prep-transcript" rows="3" maxlength="1000" placeholder="原样填写这段录音说的话。" ${unavailable ? "disabled" : ""}>${esc(value.referenceText ?? "")}</textarea></label>
        <p data-voice-prep-reference-status class="small muted">${esc(referenceError() || "参考已填写，可以生成短句试听。")}</p>
        <label class="input-label">短句试听文案<textarea id="voice-prep-sample" rows="2" maxlength="120" ${unavailable ? "disabled" : ""}>${esc(sampleText())}</textarea></label>
        <button class="primary full" data-action="voice-prep-sample" ${canSample() ? "" : "disabled"}>生成真实试听 · 不加入成片</button>
        ${preview ? `<audio class="voice-preparation-audio" controls preload="none" src="/media/${esc(preview.mediaId!)}" aria-label="本人声音真实试听"></audio><label class="voice-preparation-confirm"><input type="checkbox" id="voice-prep-confirmed" ${confirmed ? "checked" : ""}>我已听过，确认音色和发音可以复用</label><label class="input-label">声音名称<input id="voice-prep-name" maxlength="80" value="${esc(recipeName)}"></label><button class="full" data-action="voice-prep-save" ${busy || !confirmed ? "disabled" : ""}>保存为可复用声音</button>` : ""}
      ` : ""}
      ${document.recipes.length && current() ? `<div class="voice-preparation-recipes"><h4>当前工程已保存的声音</h4>${document.recipes.map((recipe) => `<button class="full" data-action="voice-prep-use" data-id="${esc(recipe.id)}">使用 ${esc(recipe.name)} · ${recipe.modelId === "audio8-tts" ? "Audio8" : "Qwen3-TTS"}</button>`).join("")}</div>` : ""}
      ${job && ["queued", "running"].includes(job.status) ? `<p class="small muted" role="status">${esc(job.progress?.message || "声音准备任务进行中，可在任务页取消。")}</p>` : ""}
      ${message ? `<p class="capability-note" role="status">${esc(message)}</p>` : ""}
      ${error ? `<p class="conflict" role="alert">${esc(error)}</p>` : ""}
      ${!production.enabled ? '<p class="host-required">声音准备需要 CodeShell 桌面的持久媒体服务。</p>' : ""}
    </section>${compact ? "</details>" : ""}`;
  }
  return { load, refresh, render, input, action, extract, initialization };
}
