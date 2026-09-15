import { escapeHtml as esc, html } from "./icons";
import type { Asset, Project } from "./model";
import type { MediaJob, ProductionController, VoiceModel, VoicePreparation } from "./production";

export const VOICE_SAMPLE_TEXT = "你好，这是我的声音试听。我会用自然的语气，介绍今天的视频内容。";
export const VOICE_REFERENCE_TEXT =
  "你好，这是我平时说话的声音。今天阳光很好，我想慢慢分享一个小故事。希望接下来的每一句话，都清楚自然，让听到的人感到轻松。";
const engines = ["audio8-tts", "qwen3-tts"] as const;
const managedId = (value: unknown): value is string =>
  typeof value === "string" && /^(?:asset|external)-[a-f0-9]{64}$/.test(value);
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
  assetUrl?(assetId: string): string | undefined;
  showAsset?(assetId: string): void | Promise<void>;
  useVoice(value: VoicePreparation): Promise<void>;
  toast(message: string): void;
}
const empty = (scope: string, projectId: string): Document => ({
  schemaVersion: 1,
  scope,
  projectId,
  selection: null,
  recipes: [],
});

export function validateVoiceRecipes(value: unknown, scope: string, projectId: string): Document {
  const data = value as Document;
  const bad = () => {
    throw new Error("声音设置无法恢复，原记录已保留，请检查存储后重试。");
  };
  if (
    !data ||
    typeof data !== "object" ||
    data.schemaVersion !== 1 ||
    data.scope !== scope ||
    data.projectId !== projectId ||
    !Array.isArray(data.recipes) ||
    data.recipes.length > 20 ||
    Object.keys(data).some(
      (key) =>
        ![
          "schemaVersion",
          "scope",
          "projectId",
          "selection",
          "recipes",
          "pending",
          "sampleJobId",
        ].includes(key),
    )
  )
    bad();
  if (data.sampleJobId !== undefined && (!shortText(data.sampleJobId, 256) || !data.sampleJobId))
    bad();
  const selected = data.selection;
  if (
    selected !== null &&
    (!selected ||
      !engines.includes(selected.modelId as (typeof engines)[number]) ||
      Object.keys(selected).some(
        (key) => !["modelId", "referenceAssetId", "referenceText", "sampleText"].includes(key),
      ) ||
      (selected.referenceAssetId !== undefined && !shortText(selected.referenceAssetId, 256)) ||
      (selected.referenceText !== undefined && !shortText(selected.referenceText, 1000)) ||
      (selected.sampleText !== undefined && !shortText(selected.sampleText, 120)))
  )
    bad();
  const ids = new Set<string>();
  for (const recipe of data.recipes) {
    if (
      !recipe ||
      !shortText(recipe.id, 80) ||
      !recipe.id ||
      ids.has(recipe.id) ||
      !shortText(recipe.name, 80) ||
      !recipe.name.trim() ||
      !engines.includes(recipe.modelId as (typeof engines)[number]) ||
      !managedId(recipe.referenceMediaId) ||
      !managedId(recipe.sampleMediaId) ||
      !shortText(recipe.referenceText, 1000) ||
      !recipe.referenceText.trim() ||
      !shortText(recipe.sampleText, 120) ||
      !recipe.sampleText.trim() ||
      Object.keys(recipe).some(
        (key) =>
          ![
            "id",
            "name",
            "modelId",
            "referenceMediaId",
            "referenceText",
            "sampleMediaId",
            "sampleText",
          ].includes(key),
      )
    )
      bad();
    ids.add(recipe.id);
  }
  if (
    data.pending &&
    (!["extract", "sample", "setup"].includes(data.pending.kind) ||
      !shortText(data.pending.jobId, 256) ||
      !data.pending.jobId ||
      Object.keys(data.pending).some((key) => !["kind", "jobId"].includes(key)))
  )
    bad();
  return structuredClone(data);
}

/** Reusable voice recipes are bound to the workspace and project, separate from timeline edits. */
export function createVoicePreparationUI(production: ProductionController, context: Context) {
  let document = empty(context.scope(), context.project().id);
  let catalog: VoiceModel[] = [];
  let catalogLoaded = false;
  let catalogReason = "";
  let loaded = false,
    locked = false,
    busy = false;
  let refreshingVersion: number | undefined;
  let error = "",
    message = "",
    recipeName = "我的中文声音",
    confirmed = false;
  let version = 0;
  let saveQueue = Promise.resolve();
  const verifiedJobs = new Map<string, MediaJob>();
  const observedJobs = new Map<string, MediaJob>();
  const current = () =>
    document.scope === context.scope() && document.projectId === context.project().id;
  const key = (id: string) => `video-studio-voice-preparation-${id}`;
  const selected = () => (current() ? document.selection : null);
  const reference = () =>
    context
      .project()
      .assets.find(
        (asset) =>
          asset.id === selected()?.referenceAssetId &&
          asset.kind === "audio" &&
          managedId(asset.mediaId),
      );
  const model = () => catalog.find((item) => item.id === selected()?.modelId);
  const engineReason = () => {
    if (!production.enabled || !catalogLoaded || !selected()) return "";
    const engine = model();
    if (!engine)
      return catalogReason || "面板本地声音运行环境尚未提供所选引擎，请刷新状态查看检查结果。";
    return engine.available ? "" : engine.reason || "所选声音引擎尚未准备完成，请安装并检查引擎。";
  };
  const sampleText = () => selected()?.sampleText ?? VOICE_SAMPLE_TEXT;
  const pendingJob = () =>
    current() && document.pending
      ? (production.currentJobs.find((job) => job.id === document.pending!.jobId) ??
        observedJobs.get(document.pending.jobId))
      : undefined;
  const working = () =>
    current() &&
    !!document.pending &&
    !["failed", "cancelled"].includes(pendingJob()?.status ?? "queued");
  const defaultModel = () =>
    engines.find((id) => catalog.some((item) => item.id === id && item.available)) ?? "audio8-tts";
  const savedRecipe = () =>
    current() && reference()
      ? document.recipes.find(
          (recipe) =>
            recipe.modelId === selected()?.modelId &&
            recipe.referenceMediaId === reference()?.mediaId &&
            recipe.referenceText === selected()?.referenceText?.trim(),
        )
      : undefined;
  const preparing = () => !!selected() && !savedRecipe();
  function observe(job: MediaJob): boolean {
    const previous = observedJobs.get(job.id);
    observedJobs.set(job.id, structuredClone(job));
    return JSON.stringify(previous) !== JSON.stringify(job);
  }
  function sample(): Asset | undefined {
    const selection = selected(),
      source = reference();
    if (!selection || !source) return undefined;
    return [...context.project().assets]
      .reverse()
      .find(
        (asset) =>
          asset.kind === "audio" &&
          managedId(asset.mediaId) &&
          [...production.currentJobs, ...verifiedJobs.values()].some(
            (job) =>
              ["tts", "tts-clone", "tts-managed", "tts-online"].includes(job.type) &&
              job.status === "succeeded" &&
              (job.result as { asset?: { id?: string } } | undefined)?.asset?.id === asset.mediaId,
          ) &&
          asset.speech?.modelId === selection.modelId &&
          asset.speech.voiceId === "reference" &&
          asset.speech.referenceAssetId === source.mediaId &&
          asset.speech.referenceText === selection.referenceText?.trim() &&
          asset.speech.text === sampleText().trim(),
      );
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
    return (
      loaded &&
      !locked &&
      !busy &&
      !working() &&
      production.enabled &&
      !!model()?.available &&
      !referenceError() &&
      !!sampleText().trim() &&
      Array.from(sampleText()).length <= 120
    );
  }
  function nextStep(): string {
    if (!selected()) return "点击创建，跟着三步完成自己的声音。";
    if (working()) return "正在处理这一步，完成后会继续显示下一步。";
    if (referenceError()) return referenceError();
    if (!model()?.available) return "录音已准备好，请安装并检查声音模型。";
    const recipe = savedRecipe();
    if (recipe) return `「${recipe.name}」已保存，可以用于当前工程的配音。`;
    return sample()
      ? "试听已生成。听过后确认发音和音色，再保存并用于配音。"
      : "录音和模型已就绪，点击生成真实试听。";
  }
  async function persist(next = document): Promise<void> {
    if (!loaded || locked || !current()) throw new Error("声音设置尚未安全恢复，不能覆盖原记录。");
    const snapshot = validateVoiceRecipes(next, context.scope(), context.project().id);
    const ownVersion = version;
    const operation = saveQueue
      .catch(() => {})
      .then(() => {
        if (
          ownVersion !== version ||
          snapshot.scope !== context.scope() ||
          snapshot.projectId !== context.project().id
        )
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
    void persist().catch((reason) => {
      if (ownVersion === version) report(reason);
    });
  }
  async function load(): Promise<void> {
    const ownVersion = ++version,
      projectId = context.project().id,
      scope = context.scope();
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
    observedJobs.clear();
    document = empty(scope, projectId);
    try {
      await saveQueue.catch(() => {});
      const stored = await context.read(key(projectId));
      if (ownVersion !== version || projectId !== context.project().id || scope !== context.scope())
        return;
      document =
        stored == null ? empty(scope, projectId) : validateVoiceRecipes(stored, scope, projectId);
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
      if (ownVersion === version) {
        catalog = next.models ?? [];
        catalogLoaded = true;
        catalogReason = next.reason ?? "";
      }
    } catch (reason) {
      if (ownVersion === version) {
        catalog = [];
        catalogLoaded = false;
        catalogReason = "";
        report(reason);
      }
    }
  }
  async function run(work: () => Promise<void>, propagate = false): Promise<void> {
    if (busy) return;
    context.assertEditable();
    if (!loaded || locked || !current()) throw new Error("请先恢复当前工程的声音设置。");
    busy = true;
    error = "";
    const ownVersion = version;
    context.changed();
    try {
      await work();
    } catch (reason) {
      if (ownVersion === version) report(reason);
      if (propagate) throw reason;
    } finally {
      if (ownVersion === version) {
        busy = false;
        context.changed();
      }
    }
  }
  async function track(
    kind: "extract" | "sample" | "setup",
    job: MediaJob,
    ownVersion: number,
  ): Promise<void> {
    if (ownVersion !== version || !current()) return;
    document.pending = { kind, jobId: job.id };
    observe(job);
    if (kind === "sample") document.sampleJobId = job.id;
    await persist();
    message =
      kind === "extract"
        ? "正在提取真实参考音频；完成后可填写逐字稿。"
        : kind === "sample"
          ? "正在生成真实短句试听，不会加入成片。"
          : "正在安装并检查引擎；本人声音还需要参考录音和试听。";
    context.changed();
  }
  async function refresh(): Promise<void> {
    if (refreshingVersion === version || !loaded || !current()) return;
    const ownVersion = version;
    refreshingVersion = ownVersion;
    let proofChanged = false;
    try {
      const existingSample = sample();
      const existingJob =
        existingSample &&
        production.currentJobs.find(
          (job) =>
            job.status === "succeeded" &&
            (job.result as { asset?: { id?: string } } | undefined)?.asset?.id ===
              existingSample.mediaId,
        );
      if (existingJob && document.sampleJobId !== existingJob.id) {
        document.sampleJobId = existingJob.id;
        verifiedJobs.set(existingJob.id, existingJob);
        proofChanged = true;
        await persist();
        if (ownVersion !== version || !current()) return;
      }
      if (
        document.sampleJobId &&
        !verifiedJobs.has(document.sampleJobId) &&
        !observedJobs.has(document.sampleJobId)
      ) {
        const proof = await context.getJob(document.sampleJobId);
        if (ownVersion !== version || !current()) return;
        observe(proof);
        if (proof.status === "succeeded" && proof.result) {
          verifiedJobs.set(proof.id, proof);
          proofChanged = true;
        }
      }
      const pending = document.pending;
      // Unrelated media polling must not replace focused fields or interrupt IME input.
      if (!pending) {
        if (proofChanged) context.changed();
        return;
      }
      let job = pendingJob();
      if (!job || (job.status === "succeeded" && !job.result))
        job = await context.getJob(pending.jobId);
      if (ownVersion !== version || !current()) return;
      const changed = observe(job);
      if (["queued", "running"].includes(job.status)) {
        if (changed) context.changed();
        return;
      }
      if (job.status === "succeeded" && job.result) verifiedJobs.set(job.id, job);
      if (job.status !== "succeeded") {
        message = "";
        error =
          job.error?.message ||
          (job.status === "cancelled" ? "准备已取消，可以重试。" : "声音准备失败，可以重试。");
        if (changed) context.changed();
        return;
      } else if (pending.kind === "extract") {
        const mediaId = (job.result as { asset?: { id?: string } } | undefined)?.asset?.id;
        const asset = context
          .project()
          .assets.find((item) => item.mediaId === mediaId && item.kind === "audio");
        if (!asset) return; // Wait until the controller has durably published the actual extracted asset.
        document.selection = {
          modelId: selected()?.modelId || "audio8-tts",
          referenceAssetId: asset.id,
          referenceText: "",
          sampleText: VOICE_SAMPLE_TEXT,
        };
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
      if (pending.kind === "extract" && job.status === "succeeded")
        await context.useVoice(document.selection!);
      context.changed();
    } catch (reason) {
      if (ownVersion === version) report(reason);
    } finally {
      if (refreshingVersion === ownVersion) refreshingVersion = undefined;
    }
  }
  async function extract(assetId: string, inFrame: number, outFrame: number): Promise<void> {
    await run(async () => {
      if (working()) throw new Error("声音准备任务正在进行，请等待完成或先取消。");
      const ownVersion = version;
      const job = await production.extractReference(assetId, inFrame, outFrame);
      await track("extract", job, ownVersion);
    });
  }
  async function selectReference(assetId: string): Promise<void> {
    if (busy) throw new Error("声音设置正在保存，请稍候。");
    await run(async () => {
      if (working()) throw new Error("声音准备任务正在进行，请等待完成或先取消。");
      const source = context
        .project()
        .assets.find(
          (asset) => asset.id === assetId && asset.kind === "audio" && managedId(asset.mediaId),
        );
      if (!source) throw new Error("请选择当前工程中已保存的本人参考录音。");
      const ownVersion = version;
      const next = structuredClone(document);
      next.selection = {
        modelId: selected()?.modelId ?? defaultModel(),
        referenceAssetId: source.id,
        referenceText:
          selected()?.referenceAssetId === source.id ? (selected()?.referenceText ?? "") : "",
        sampleText: sampleText(),
      };
      delete next.pending;
      await persist(next);
      if (ownVersion !== version || !current()) throw new Error("工程已切换，未选择旧工程录音。");
      document = next;
      confirmed = false;
      message = "本人录音已选入。请确认逐字稿，再准备模型和生成试听。";
    }, true);
  }
  async function initialization(): Promise<VoicePreparation | undefined> {
    if (!selected()) return undefined;
    if (working()) throw new Error("声音准备任务正在进行，请等待完成后再初始化制作单。");
    const ownVersion = version;
    await persist();
    if (ownVersion !== version || !current()) throw new Error("工程已切换，请重新选择声音准备。");
    const value = selected()!;
    if (!reference())
      return { modelId: value.modelId, sampleText: sampleText().trim() || VOICE_SAMPLE_TEXT };
    if (referenceError()) throw new Error(referenceError());
    return {
      modelId: value.modelId,
      referenceAssetId: reference()!.id,
      referenceText: value.referenceText!.trim(),
      sampleText: sampleText().trim() || VOICE_SAMPLE_TEXT,
    };
  }
  function input(target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): boolean {
    if (!target.id.startsWith("voice-prep-")) return false;
    if (!loaded || locked || !current() || busy || working()) return true;
    const field = target.id.slice("voice-prep-".length);
    if (field === "confirmed") confirmed = (target as HTMLInputElement).checked;
    else if (field === "name") recipeName = target.value;
    else {
      confirmed = false;
      delete document.pending;
      if (field === "model") {
        document.selection = engines.includes(target.value as (typeof engines)[number])
          ? { ...selected(), modelId: target.value, sampleText: sampleText() }
          : null;
      } else if (selected()) {
        if (field === "reference") {
          document.selection!.referenceAssetId = target.value;
          document.selection!.referenceText = "";
        } else if (field === "transcript") document.selection!.referenceText = target.value;
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
    const sampleButton = window.document.querySelector<HTMLButtonElement>(
      '[data-action="voice-prep-sample"]',
    );
    if (sampleButton) sampleButton.disabled = !canSample();
    const save = window.document.querySelector<HTMLButtonElement>(
      '[data-action="voice-prep-save"]',
    );
    if (save) save.disabled = busy || working() || !confirmed || !sample() || !recipeName.trim();
    const status = window.document.querySelector("[data-voice-prep-reference-status]");
    if (status) status.textContent = referenceError() || "参考已填写，可以生成短句试听。";
    const next = window.document.querySelector("[data-voice-guide-next]");
    if (next) next.textContent = nextStep();
    const referenceState = window.document.querySelector("[data-voice-guide-reference]");
    if (referenceState) referenceState.textContent = referenceError() ? "待准备" : "已填写";
  }
  async function action(name: string, id?: string): Promise<boolean> {
    if (!name.startsWith("voice-prep-")) return false;
    if (name === "voice-prep-goto") {
      if (!["reference", "model", "preview"].includes(id ?? "")) return true;
      if (typeof window === "undefined") return true;
      const step = window.document.getElementById(`voice-guide-${id}`);
      step?.scrollIntoView({ block: "start" });
      step?.focus({ preventScroll: true });
      return true;
    }
    if (name === "voice-prep-show-reference") {
      try {
        const source = reference();
        if (!source || !context.showAsset) throw new Error("请先选择已保存的本人参考录音。");
        await context.showAsset(source.id);
      } catch (reason) {
        report(reason);
      }
      return true;
    }
    if (name === "voice-prep-retry" && (!loaded || locked)) {
      await load();
      return true;
    }
    await run(async () => {
      const ownVersion = version,
        value = selected();
      if (name === "voice-prep-retry") {
        await refreshCatalog();
        if (ownVersion === version) await refresh();
      } else if (name === "voice-prep-cancel") {
        if (!document.pending || !working() || pendingJob()?.status === "succeeded") return;
        await production.cancel(document.pending.jobId);
        if (ownVersion !== version || !current()) return;
        await refresh();
      } else if (name === "voice-prep-retry-job") {
        const pending = document.pending,
          job = pendingJob();
        if (!pending || !job || !["failed", "cancelled"].includes(job.status))
          throw new Error("请先刷新准备任务的状态。");
        const retried = await production.retry(pending.jobId);
        if (ownVersion !== version || !current()) return;
        const next = retried ?? (await context.getJob(pending.jobId));
        if (ownVersion !== version || !current()) return;
        await track(pending.kind, next, ownVersion);
      } else {
        if (working()) throw new Error("声音准备任务正在进行，请等待完成或先取消。");
        if (name === "voice-prep-start") {
          if (!value) {
            const next = {
              ...document,
              selection: { modelId: defaultModel(), sampleText: VOICE_SAMPLE_TEXT },
            };
            await persist(next);
            if (ownVersion !== version || !current()) return;
            document = next;
          }
          message = "先准备一段参考录音，再按提示继续。";
        } else if (name === "voice-prep-reference-text") {
          if (!value || !reference())
            throw new Error("请先录制或选择本人录音，再确认实际读出的内容。");
          const next = {
            ...document,
            selection: { ...value, referenceText: VOICE_REFERENCE_TEXT },
          };
          delete next.pending;
          await persist(next);
          if (ownVersion !== version || !current()) return;
          document = next;
          confirmed = false;
          message = "已填入朗读稿；如果录音有改词或漏字，请按实际内容修改。";
        } else if (name === "voice-prep-setup") {
          if (!value || !model()?.installable || !production.enabled)
            throw new Error(engineReason() || "请先选择可安装的声音引擎。");
          await track("setup", await production.setupTts(value.modelId), ownVersion);
        } else if (name === "voice-prep-sample") {
          // run() sets busy; availability and reference validation remain authoritative here.
          if (!value || !production.enabled || !model()?.available || referenceError())
            throw new Error(referenceError() || engineReason() || "请先安装并检查所选引擎。");
          const content = sampleText().trim();
          if (!content || Array.from(content).length > 120)
            throw new Error("试听文案需要 1–120 字。");
          await persist();
          if (ownVersion !== version || !current()) return;
          await track(
            "sample",
            await production.prepareVoice({
              text: content,
              modelId: value.modelId,
              voiceId: "reference",
              rate: 1,
              referenceAssetId: reference()!.id,
              referenceText: value.referenceText!.trim(),
            }),
            ownVersion,
          );
        } else if (name === "voice-prep-save") {
          const preview = sample(),
            source = reference();
          const existing = savedRecipe();
          if (!value || !preview || !source || (!confirmed && !existing))
            throw new Error("请先生成真实试听，并确认已听过且满意。");
          if (!recipeName.trim() || Array.from(recipeName).length > 80)
            throw new Error("请填写 1–80 字的声音名称。");
          if (!existing && document.recipes.length >= 20)
            throw new Error("当前工程最多保存 20 个声音。");
          const recipe: Recipe = existing ?? {
            id: crypto.randomUUID(),
            name: recipeName.trim(),
            modelId: value.modelId,
            referenceMediaId: source.mediaId!,
            referenceText: value.referenceText!.trim(),
            sampleMediaId: preview.mediaId!,
            sampleText: sampleText().trim(),
          };
          const next = {
            ...document,
            recipes: existing ? document.recipes : [...document.recipes, recipe],
          };
          await persist(next);
          if (ownVersion !== version || !current()) return;
          document = next;
          message = `已保存「${recipe.name}」，可在当前工程反复使用。`;
          await context.useVoice(selected()!);
          if (ownVersion !== version || !current()) return;
          confirmed = false;
          message = `已保存「${recipe.name}」并用于配音，现在可以填写要新读的文案。`;
        } else if (name === "voice-prep-use") {
          const recipe = document.recipes.find((item) => item.id === id);
          if (recipe) {
            const source = context
              .project()
              .assets.find(
                (asset) => asset.kind === "audio" && asset.mediaId === recipe.referenceMediaId,
              );
            if (!source) throw new Error("这个声音的参考素材不在当前工程，请重新连接本人录音。");
            document.selection = {
              modelId: recipe.modelId,
              referenceAssetId: source.id,
              referenceText: recipe.referenceText,
              sampleText: recipe.sampleText,
            };
            await persist();
            if (ownVersion !== version || !current()) return;
          }
          if (!selected() || referenceError())
            throw new Error(referenceError() || "请先选择本人声音。");
          await context.useVoice(selected()!);
        }
      }
    });
    return true;
  }
  function render(compact = false): string {
    const value = selected(),
      source = reference(),
      preview = sample(),
      job = pendingJob(),
      recipe = savedRecipe();
    const referenceUrl = source
      ? context.assetUrl
        ? context.assetUrl(source.id)
        : `/media/${source.mediaId!}`
      : undefined;
    const unavailable = !production.enabled || !loaded || locked || busy;
    const controlsLocked = unavailable || working();
    const models = engines.map(
      (id) =>
        catalog.find((item) => item.id === id) ?? {
          id,
          name: id === "audio8-tts" ? "Audio8 · 本人声音" : "Qwen3-TTS · 本人声音",
          available: false,
        },
    );
    const modelSelect = `<label class="input-label">声音引擎<select id="voice-prep-model" ${controlsLocked ? "disabled" : ""}>
      <option value="">暂不准备，保留现有原声</option>${models.map((item) => `<option value="${item.id}" ${value?.modelId === item.id ? "selected" : ""}>${esc(item.name)} · ${item.available ? "已安装" : "待检查 / 安装"}</option>`).join("")}
    </select></label>`;
    const next = nextStep();
    const progress = Math.round(Math.max(0, Math.min(1, job?.progress?.fraction ?? 0)) * 100);
    const retryable =
      job &&
      (job.status === "cancelled" || (job.status === "failed" && job.error?.retryable !== false));
    return html`${compact
        ? `<details class="voice-preparation-disclosure" ${recipe ? "" : "open"}><summary>${recipe ? `我的声音：${esc(recipe.name)} · 配方已保存` : "创建 / 管理我的声音"}</summary>`
        : ""}
      <section class="voice-preparation voice-guide" aria-label="准备我的声音">
        <h3>准备我的声音</h3>
        <p class="small muted">
          提供本人录音 → 准备模型 → 试听并保存。只需准备一次，当前工程可反复使用。
        </p>
        ${!value
          ? `<button class="primary full" data-action="voice-prep-start" ${unavailable ? "disabled" : ""}>创建我的声音</button><p class="small muted">先准备一段参考录音，再按提示继续。</p>${modelSelect}`
          : ""}
        <p class="voice-guide-next" data-voice-guide-next role="status">${esc(next)}</p>
        ${value
          ? html`
              <ol class="voice-guide-nav" aria-label="声音准备步骤">
                <li>
                  <button
                    type="button"
                    data-action="voice-prep-goto"
                    data-id="reference"
                    aria-controls="voice-guide-reference"
                  >
                    提供本人录音
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    data-action="voice-prep-goto"
                    data-id="model"
                    aria-controls="voice-guide-model"
                  >
                    准备模型
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    data-action="voice-prep-goto"
                    data-id="preview"
                    aria-controls="voice-guide-preview"
                  >
                    试听并保存
                  </button>
                </li>
              </ol>
              <section class="voice-guide-step" id="voice-guide-reference" tabindex="-1">
                <h4>1. 提供本人录音</h4>
                <p class="small muted">
                  参考：<span data-voice-guide-reference
                    >${referenceError() ? "待准备" : "已填写"}</span
                  >。使用 3–30 秒清晰的本人声音，建议 10–20 秒、没有背景音乐。
                </p>
                <div class="voice-reference-actions">
                  <button data-action="voice-reference-record" ${controlsLocked ? "disabled" : ""}>
                    录我的声音
                  </button>
                  <button data-action="voice-reference-import" ${controlsLocked ? "disabled" : ""}>
                    导入已有录音
                  </button>
                  <button data-action="voice-reference-video" ${controlsLocked ? "disabled" : ""}>
                    从视频截取
                  </button>
                </div>
                <label class="input-label"
                  >本人参考录音<select
                    id="voice-prep-reference"
                    ${controlsLocked ? "disabled" : ""}
                  >
                    <option value="">尚未选择录音</option>
                    ${context
                      .project()
                      .assets.filter((asset) => asset.kind === "audio" && managedId(asset.mediaId))
                      .map(
                        (asset) =>
                          `<option value="${esc(asset.id)}" ${asset.id === value.referenceAssetId ? "selected" : ""}>${esc(asset.name)} · ${(asset.durationFrames / context.project().fps).toFixed(1)} 秒</option>`,
                      )
                      .join("")}
                  </select></label
                >
                ${source
                  ? `<div class="voice-preparation-reference" data-voice-reference-asset="${esc(source.id)}">
                    <p class="small"><strong>${esc(source.name)}</strong></p>
                    <p class="small muted">${(source.durationFrames / context.project().fps).toFixed(1)} 秒 · 已保存到素材库</p>
                    <p class="small muted">原录音 · 可直接试听，无需安装声音模型。</p>
                    ${
                      referenceUrl
                        ? `<audio id="voice-prep-reference-audio" class="voice-preparation-reference-audio" controls preload="none" src="${esc(referenceUrl)}" data-reference-asset="${esc(source.id)}" aria-label="本人参考原录音"></audio>`
                        : '<p class="capability-note" data-voice-reference-unavailable role="status">原录音尚未连接，请在素材库重新连接后试听。</p>'
                    }
                    ${context.showAsset ? '<button class="quiet full" data-action="voice-prep-show-reference">在素材库查看</button>' : ""}
                  </div>`
                  : ""}
                <p class="small muted">可以照读这段话，也可以使用自己的内容：</p>
                <blockquote>${esc(VOICE_REFERENCE_TEXT)}</blockquote>
                <button
                  class="quiet full"
                  data-action="voice-prep-reference-text"
                  ${controlsLocked || !reference() ? "disabled" : ""}
                >
                  这就是录音里的内容
                </button>
                <label class="input-label"
                  >参考录音逐字稿<textarea
                    id="voice-prep-transcript"
                    rows="3"
                    maxlength="1000"
                    placeholder="原样填写这段录音说的话；有改词或漏字请一起修改。"
                    ${controlsLocked ? "disabled" : ""}
                  >
${esc(value.referenceText ?? "")}</textarea
                  >
                </label>
                <p data-voice-prep-reference-status class="small muted">
                  ${esc(referenceError() || "参考已填写，可以继续准备模型和生成短句试听。")}
                </p>
              </section>
              <section class="voice-guide-step" id="voice-guide-model" tabindex="-1">
                <h4>2. 准备模型</h4>
                <p class="small muted">
                  引擎：${model()?.available
                    ? "已安装，可以生成声音"
                    : "尚未就绪，首次需要安装并检查"}。本地合成不向语音服务发送参考录音。
                </p>
                ${modelSelect}
                ${engineReason()
                  ? `<p class="capability-note" role="status">${esc(engineReason())}</p>`
                  : ""}
                <button
                  class="full"
                  data-action="voice-prep-setup"
                  ${controlsLocked || !model()?.installable ? "disabled" : ""}
                >
                  ${model()?.available ? "检查 / 修复引擎" : "安装并检查引擎"}
                </button>
                <p class="small muted">
                  关闭面板后，已排队任务仍会继续；重新打开可恢复进度。主程序重启导致的中断会保留状态，可在这里重试。
                </p>
              </section>
              <section class="voice-guide-step" id="voice-guide-preview" tabindex="-1">
                <h4>3. 试听并保存</h4>
                <p class="small muted">
                  声音：${recipe
                    ? `配方已保存 · ${esc(recipe.name)}`
                    : preview
                      ? "已有真实试听，待确认 / 保存"
                      : "尚未验证"}。试听不会加入成片。
                </p>
                <label class="input-label"
                  >短句试听文案<textarea
                    id="voice-prep-sample"
                    rows="2"
                    maxlength="120"
                    ${controlsLocked ? "disabled" : ""}
                  >
${esc(sampleText())}</textarea
                  >
                </label>
                <button
                  class="primary full"
                  data-action="voice-prep-sample"
                  ${canSample() ? "" : "disabled"}
                >
                  生成真实试听 · 不加入成片
                </button>
                ${preview
                  ? `<audio class="voice-preparation-audio" controls preload="none" src="/media/${esc(preview.mediaId!)}" aria-label="本人声音真实试听"></audio><label class="voice-preparation-confirm"><input type="checkbox" id="voice-prep-confirmed" ${confirmed ? "checked" : ""} ${controlsLocked ? "disabled" : ""}>我已听过，确认音色和发音可以复用</label><label class="input-label">声音名称<input id="voice-prep-name" maxlength="80" value="${esc(recipeName)}" ${controlsLocked ? "disabled" : ""}></label><button class="full" data-action="voice-prep-save" ${controlsLocked || !confirmed ? "disabled" : ""}>保存并用于配音</button>`
                  : ""}
              </section>
            `
          : ""}
        ${document.pending
          ? `<div class="voice-guide-progress" role="status">${working() ? (job?.status === "succeeded" ? "<p>生成已完成，正在保存结果，请稍候。</p>" : `<p>${esc(job?.progress?.message || "声音准备任务进行中，正在恢复进度。")}</p><progress max="100" value="${progress}"></progress><p>${progress}%</p><button data-action="voice-prep-cancel" ${unavailable ? "disabled" : ""}>取消准备</button>`) : `<p>${esc(job?.error?.message || (job?.status === "cancelled" ? "准备已取消。" : "这一步未完成。"))}</p>${retryable ? `<button data-action="voice-prep-retry-job" ${unavailable ? "disabled" : ""}>重试这一步</button>` : ""}`}</div>`
          : ""}
        <button class="quiet full" data-action="voice-prep-retry" ${busy ? "disabled" : ""}>
          ${locked || !loaded ? "重新恢复声音设置" : "刷新状态"}
        </button>
        ${document.recipes.length && current()
          ? `<div class="voice-preparation-recipes"><h4>当前工程已保存的声音</h4>${document.recipes.map((item) => `<button class="full" data-action="voice-prep-use" data-id="${esc(item.id)}" ${controlsLocked ? "disabled" : ""}>使用 ${esc(item.name)} · ${item.modelId === "audio8-tts" ? "Audio8" : "Qwen3-TTS"}</button>`).join("")}</div>`
          : ""}
        ${message ? `<p class="capability-note" role="status">${esc(message)}</p>` : ""}
        ${error ? `<p class="conflict" role="alert">${esc(error)}</p>` : ""}
        ${!production.enabled
          ? '<p class="host-required">声音准备需要 CodeShell 桌面的持久媒体服务。</p>'
          : ""}
      </section>
      ${compact ? "</details>" : ""}`;
  }
  return {
    load,
    refresh,
    render,
    input,
    action,
    extract,
    initialization,
    selectReference,
    preparing,
  };
}
