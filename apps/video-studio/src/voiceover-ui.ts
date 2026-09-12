import { escapeHtml as esc, html } from "./icons";
import { button } from "./views";
import type { Asset, AudioClip } from "./model";
import type { ProductionController, VoiceCatalog, VoiceModel, VoicePreparation } from "./production";

type Voice = { id: string; name: string; language: string };
interface VoiceoverContext {
  changed(): void;
  projectId(): string;
  frame(): number;
  assertEditable(): void;
  queued(): void;
  captionText?(): string;
  assets?(): Asset[];
  fps?(): number;
  toast?(message: string): void;
}
const BROWSER_MODEL = "browser-speech";
const browserSpeech = (): SpeechSynthesis | undefined =>
  typeof window === "undefined" ? undefined : window.speechSynthesis;
const normalizeLanguage = (language: string) => language.replaceAll("_", "-");
function languageName(language: string): string {
  const normalized = normalizeLanguage(language);
  const known: Record<string, string> = {
    und: "多语言",
    "zh-CN": "中文 · 普通话",
    "zh-TW": "中文 · 台湾",
    "zh-HK": "中文 · 香港",
    "en-US": "英语 · 美国",
    "en-GB": "英语 · 英国",
    zh: "中文",
    en: "英语",
    ja: "日语",
    ko: "韩语",
  };
  if (known[normalized]) return known[normalized]!;
  try {
    return new Intl.DisplayNames(["zh-CN"], { type: "language" }).of(normalized) || normalized;
  } catch {
    return normalized || "未标注语言";
  }
}

/** Draft state stays here across tab renders; typing only updates adjacent DOM. */
export function createVoiceoverUI(production: ProductionController, context: VoiceoverContext) {
  let text = "",
    modelId = "",
    voiceId = "",
    language = "",
    instructions = "",
    rate = 1;
  let loading = false,
    submitting = false,
    error = "",
    notice = "";
  let catalog: VoiceCatalog | undefined;
  let browserVoices: SpeechSynthesisVoice[] = [];
  let textBeforeImport: string | undefined;
  let replacement: { projectId: string; clip: AudioClip } | undefined;
  let utterance: SpeechSynthesisUtterance | undefined;
  let previewing = false,
    previewMessage = "",
    previewVersion = 0;
  let disposed = false;
  let modelChosen = false;
  let referenceAssetId = "",
    referenceText = "",
    referenceProjectId = context.projectId();
  let previewStartTimer: ReturnType<typeof setTimeout> | undefined;

  function models(): VoiceModel[] {
    const hostModels = catalog?.models?.length
      ? catalog.models
      : catalog || production.enabled
        ? [
            {
              id: "macos-say",
              name: "macOS 系统配音",
              provider: "Apple",
              available: Boolean(catalog?.available ?? production.status.tts?.available),
              reason: catalog?.reason ?? production.status.tts?.reason,
              voices: catalog?.voices ?? [],
              defaultVoiceId: catalog?.defaultVoiceId,
              maxTextLength: 5000,
            },
          ]
        : [];
    const result: VoiceModel[] = [...hostModels];
    if (browserSpeech())
      result.push({
        id: BROWSER_MODEL,
        name: "浏览器语音 · 仅试听",
        provider: "当前浏览器",
        available: browserVoices.length > 0,
        reason: browserVoices.length ? undefined : "正在等待浏览器提供声音，可点击刷新重试。",
        voices: browserVoices.map((voice) => ({
          id: voice.voiceURI,
          name: voice.name,
          language: voice.lang,
        })),
        defaultVoiceId: browserVoices.find((voice) => voice.default)?.voiceURI,
        maxTextLength: 5000,
      });
    if (!production.enabled) {
      for (const [id, name, mode] of [
        ["edge-tts", "微软 Edge TTS", "online"],
        ["kokoro", "Kokoro 本地配音", "offline"],
        ["qwen3-tts", "Qwen3-TTS · 本人声音克隆", "offline"],
        ["audio8-tts", "Audio8 · 本人声音克隆", "offline"],
      ] as const)
        result.push({
          id,
          name,
          mode,
          provider: mode === "online" ? "在线语音" : "本地语音",
          available: false,
          voices: [],
          supportsVoiceCloning: ["qwen3-tts", "audio8-tts"].includes(id),
          maxTextLength: ["qwen3-tts", "audio8-tts"].includes(id) ? 2000 : 5000,
          reason: "桌面视频工作台可安装并生成；当前浏览器预览仅支持文案试听",
        });
    }
    return result;
  }
  function model(): VoiceModel | undefined {
    return models().find((item) => item.id === modelId);
  }
  function visibleVoices(): Voice[] {
    return (model()?.voices ?? []).filter(
      (voice) => !language || normalizeLanguage(voice.language).split("-")[0] === language,
    );
  }
  function selectDefault(): void {
    const all = models();
    if (!modelId)
      modelId =
        catalog?.defaultModelId ?? all.find((item) => item.available)?.id ?? all[0]?.id ?? "";
    if (!voiceId) {
      const current = model();
      voiceId = current?.defaultVoiceId ?? visibleVoices()[0]?.id ?? "";
    }
  }
  function maxLength(): number {
    return Math.max(1, Math.min(5000, model()?.maxTextLength ?? 5000));
  }
  function matchingPreviewVoice(): SpeechSynthesisVoice | undefined {
    const selected = model()?.voices.find((voice) => voice.id === voiceId);
    if (!selected) return undefined;
    return (
      browserVoices.find((voice) => voice.voiceURI === selected.id) ??
      browserVoices.find(
        (voice) =>
          voice.name === selected.name &&
          normalizeLanguage(voice.lang).toLowerCase() ===
            normalizeLanguage(selected.language).toLowerCase(),
      )
    );
  }
  function textValid(): boolean {
    return Boolean(text.trim()) && text.length <= maxLength();
  }
  function referenceAssets(): Asset[] {
    return (context.assets?.() ?? []).filter((asset) => asset.kind === "audio" && asset.mediaId);
  }
  function referenceValid(): boolean {
    return !referenceError();
  }
  function referenceError(): string {
    if (!model()?.supportsVoiceCloning) return "";
    const asset = referenceAssets().find((item) => item.id === referenceAssetId);
    const seconds = asset ? asset.durationFrames / (context.fps?.() ?? 30) : 0;
    if (referenceProjectId !== context.projectId() || !asset)
      return "请选择当前工程中已保存的本人录音。";
    if (seconds < 3 || seconds > 30)
      return `这段录音长 ${seconds.toFixed(1)} 秒，请使用 3–30 秒的参考录音。`;
    if (!referenceText.trim()) return "请填写这段参考录音实际说出的内容。";
    if (Array.from(referenceText).length > 1000) return "参考录音逐字稿最多 1000 字。";
    return "";
  }
  function referenceParams() {
    return model()?.supportsVoiceCloning
      ? { referenceAssetId, referenceText: referenceText.trim() }
      : {};
  }
  function canGenerate(): boolean {
    return (
      !loading &&
      !submitting &&
      production.enabled &&
      Boolean(model()?.available) &&
      modelId !== BROWSER_MODEL &&
      Boolean(model()?.voices.some((voice) => voice.id === voiceId)) &&
      textValid() &&
      referenceValid()
    );
  }
  function canPreview(): boolean {
    return !loading && !submitting && !previewing && textValid() && Boolean(matchingPreviewVoice());
  }
  function replacementActive(): boolean {
    return replacement?.projectId === context.projectId();
  }
  function estimate(): string {
    const value = text.trim();
    if (!value) return "填入文案后显示估时";
    const cjk = (value.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) ?? []).length;
    const words = (
      value.replace(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, " ").match(/[\p{L}\p{N}]+/gu) ??
      []
    ).length;
    const seconds = Math.max(1, Math.ceil((cjk / 4 + words / 2.5) / rate));
    return seconds < 60
      ? `约 ${seconds} 秒 · 估算`
      : `约 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒 · 估算`;
  }
  function generationLabel(): string {
    return submitting
      ? "正在提交…"
      : replacementActive()
        ? "重新生成并替换配音"
        : "生成配音并加入音轨";
  }
  function syncDraftUI(): void {
    if (typeof document === "undefined") return;
    const count = document.querySelector<HTMLElement>("#voiceover-count");
    if (count) {
      count.textContent = `${text.length} / ${maxLength()} 字符`;
      count.classList.toggle("over-limit", text.length > maxLength());
    }
    const estimated = document.querySelector<HTMLElement>("#voiceover-estimate");
    if (estimated) estimated.textContent = estimate();
    const generate = document.querySelector<HTMLButtonElement>('[data-action="create-voiceover"]');
    if (generate) {
      generate.disabled = !canGenerate();
      const label = generate.querySelector("span");
      if (label) label.textContent = generationLabel();
    }
    const sampleButton = document.querySelector<HTMLButtonElement>(
      '[data-action="sample-voiceover"]',
    );
    if (sampleButton) sampleButton.disabled = !canGenerate();
    const referenceStatus = document.querySelector<HTMLElement>("#voiceover-reference-status");
    if (referenceStatus)
      referenceStatus.textContent = referenceError() || "参考录音与逐字稿已填写，可生成短试听。";
    const preview = document.querySelector<HTMLButtonElement>('[data-action="preview-voiceover"]');
    if (preview) preview.disabled = !canPreview();
    const stop = document.querySelector<HTMLButtonElement>(
      '[data-action="stop-voiceover-preview"]',
    );
    if (stop) stop.disabled = !previewing;
    const status = document.querySelector<HTMLElement>("#voiceover-preview-status");
    if (status) status.textContent = previewMessage;
    const newMode = document.querySelector<HTMLButtonElement>('[data-action="new-voiceover"]');
    if (newMode) newMode.hidden = !replacementActive();
    const note = document.querySelector<HTMLElement>("#voiceover-notice");
    if (note) {
      note.textContent = notice;
      note.hidden = !notice;
    }
  }
  function stopPreview(): void {
    previewVersion++;
    const own = utterance;
    utterance = undefined;
    previewing = false;
    previewMessage = "";
    if (previewStartTimer) clearTimeout(previewStartTimer);
    previewStartTimer = undefined;
    if (own) {
      own.onend = null;
      own.onerror = null;
      own.onstart = null;
      browserSpeech()?.cancel();
    }
    syncDraftUI();
  }
  function refreshBrowserVoices(): void {
    if (disposed) return;
    browserVoices = browserSpeech()?.getVoices() ?? [];
    selectDefault();
    context.changed();
  }
  browserVoices = browserSpeech()?.getVoices() ?? [];
  browserSpeech()?.addEventListener("voiceschanged", refreshBrowserVoices);

  async function load(asset?: Asset, clip?: AudioClip): Promise<void> {
    if (asset?.speech) {
      stopPreview();
      const speech = asset.speech as Asset["speech"] & { modelId?: string; instructions?: string };
      text = speech.text;
      voiceId = speech.voiceId;
      rate = speech.rate;
      modelChosen = true;
      modelId = speech.modelId ?? (speech.engine === "macos-say" ? "macos-say" : speech.engine);
      instructions = speech.instructions ?? "";
      referenceProjectId = context.projectId();
      referenceAssetId =
        (context.assets?.() ?? []).find((item) => item.mediaId === asset.speech?.referenceAssetId)
          ?.id ?? "";
      referenceText = asset.speech.referenceText ?? "";
      language = "";
      textBeforeImport = undefined;
      replacement = clip
        ? { projectId: context.projectId(), clip: structuredClone(clip) }
        : undefined;
      notice = clip
        ? "正在修改这条配音。新音频完成后安全替换，旧源音频仍保留。"
        : "已载入生成文案，可以调整后重新配音。";
    }
    if (!production.enabled || loading) {
      selectDefault();
      context.changed();
      return;
    }
    await retry();
  }
  async function retry(): Promise<void> {
    if (loading) return;
    browserVoices = browserSpeech()?.getVoices() ?? [];
    if (!production.enabled) {
      selectDefault();
      context.changed();
      return;
    }
    loading = true;
    error = "";
    context.changed();
    try {
      catalog = (await production.voices()) as VoiceCatalog;
      if (!modelChosen) {
        modelId = catalog.defaultModelId ?? "macos-say";
        voiceId = "";
        language = "";
      }
      selectDefault();
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    } finally {
      loading = false;
      if (!disposed) context.changed();
    }
  }
  async function setup(): Promise<void> {
    if (!model()?.installable || !production.enabled) throw new Error("此模型不支持工作台安装");
    await production.setupTts(modelId);
    context.queued();
    context.toast?.("正在安装并验证配音引擎，可在任务页查看进度或取消；完成后刷新模型目录");
  }
  async function sample(): Promise<void> {
    if (submitting) return;
    if (!canGenerate()) throw new Error(referenceError() || "请先选择可用模型、声音并填写文案");
    context.assertEditable();
    const projectId = context.projectId();
    submitting = true;
    syncDraftUI();
    try {
      await production.prepareVoice({
        text: Array.from(text.trim()).slice(0, 120).join(""),
        modelId,
        voiceId,
        rate,
        ...referenceParams(),
        ...(model()?.supportsInstructions ? { instructions } : {}),
      });
      if (context.projectId() === projectId) {
        context.queued();
        context.toast?.("正在用所选模型生成前 120 字的试听音频；结果保存在素材库，不会加入音轨");
      }
    } finally {
      submitting = false;
      syncDraftUI();
    }
  }
  function setText(value: string): void {
    textBeforeImport = text;
    text = value;
    stopPreview();
    context.changed();
  }
  async function usePreparedVoice(value: VoicePreparation): Promise<void> {
    stopPreview();
    modelId = value.modelId;
    modelChosen = true;
    voiceId = "reference";
    language = "";
    referenceAssetId = value.referenceAssetId ?? "";
    referenceText = value.referenceText ?? "";
    referenceProjectId = context.projectId();
    replacement = undefined;
    notice = "已载入本人声音参考。可先生成短试听，确认后再配全文。";
    await retry();
  }
  function input(target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): boolean {
    if (target.id === "voiceover-text") {
      text = target.value;
      stopPreview();
      syncDraftUI();
    } else if (target.id === "voiceover-instructions") {
      instructions = target.value;
      syncDraftUI();
    } else if (target.id === "voiceover-reference") {
      referenceAssetId = target.value;
      referenceText = "";
      referenceProjectId = context.projectId();
      context.changed();
    } else if (target.id === "voiceover-reference-text") {
      referenceText = target.value;
      referenceProjectId = context.projectId();
      syncDraftUI();
    } else if (target.id === "voiceover-rate") {
      rate = Number(target.value);
      stopPreview();
      syncDraftUI();
    } else if (target.id === "voiceover-model") {
      stopPreview();
      modelId = target.value;
      modelChosen = true;
      voiceId = "";
      language = "";
      selectDefault();
      context.changed();
    } else if (target.id === "voiceover-language") {
      stopPreview();
      language = target.value;
      if (!visibleVoices().some((voice) => voice.id === voiceId))
        voiceId = visibleVoices()[0]?.id ?? "";
      context.changed();
    } else if (target.id === "voiceover-voice") {
      stopPreview();
      voiceId = target.value;
      syncDraftUI();
    } else return false;
    return true;
  }
  async function preview(): Promise<void> {
    const synth = browserSpeech(),
      voice = matchingPreviewVoice();
    if (!text.trim()) throw new Error("请先填写要试听的文案");
    if (!textValid()) throw new Error(`当前模型最多支持 ${maxLength()} 字符，请缩短文案`);
    if (!synth || !voice)
      throw new Error(
        "浏览器无法试听所选模型的声音。生成后可在任务中试听所选模型结果；也可切换浏览器语音，仅试听文案。",
      );
    stopPreview();
    const version = previewVersion;
    const next = new SpeechSynthesisUtterance(text.trim());
    next.voice = voice;
    next.lang = voice.lang;
    next.rate = rate;
    next.volume = 1;
    utterance = next;
    previewing = true;
    const startedMessage =
      modelId === BROWSER_MODEL
        ? "正在用浏览器声音试听文案；不会生成或保存音轨。"
        : "正在用浏览器匹配声音试听；实际生成以所选模型结果为准。";
    previewMessage = "正在准备浏览器试听…";
    next.onstart = () => {
      if (version !== previewVersion) return;
      if (previewStartTimer) clearTimeout(previewStartTimer);
      previewStartTimer = undefined;
      previewMessage = startedMessage;
      syncDraftUI();
    };
    previewStartTimer = setTimeout(() => {
      if (version !== previewVersion) return;
      stopPreview();
      previewMessage = "浏览器未启动试听，请重试或选择另一个实际声音。";
      syncDraftUI();
    }, 8000);
    next.onend = () => {
      if (version !== previewVersion) return;
      if (previewStartTimer) clearTimeout(previewStartTimer);
      previewStartTimer = undefined;
      utterance = undefined;
      previewing = false;
      previewMessage = "试听结束。点击生成后才会保存真实音频和音轨。";
      syncDraftUI();
    };
    next.onerror = (event) => {
      if (version !== previewVersion) return;
      if (previewStartTimer) clearTimeout(previewStartTimer);
      previewStartTimer = undefined;
      utterance = undefined;
      previewing = false;
      previewMessage = `试听未完成：${event.error}。可重试或使用内置示例。`;
      syncDraftUI();
    };
    synth.speak(next);
    syncDraftUI();
  }
  function importCaptions(): void {
    const value = context.captionText?.().trim();
    if (!value) throw new Error("当前工程没有可导入的字幕文案");
    stopPreview();
    textBeforeImport = text;
    text = value;
    notice = "已用当前字幕填入文案。可以继续修改，或撤回恢复导入前的草稿。";
    context.changed();
  }
  function undoTextImport(): void {
    if (textBeforeImport === undefined) return;
    stopPreview();
    text = textBeforeImport;
    textBeforeImport = undefined;
    notice = "已恢复导入字幕前的文案。";
    context.changed();
  }
  function resetReplacement(): void {
    replacement = undefined;
    notice = "保留当前文案，下一次生成将作为新配音加入。";
    syncDraftUI();
  }
  async function submit(): Promise<void> {
    if (submitting) return;
    context.assertEditable();
    if (!canGenerate())
      throw new Error(
        modelId === BROWSER_MODEL
          ? "浏览器声音只能试听文案。请选择可用的配音模型生成音轨。"
          : !textValid()
            ? `请填写 1–${maxLength()} 字符的配音文案`
            : !referenceValid()
              ? referenceError()
              : "所选模型或声音当前不可用，请刷新后重新选择",
      );
    if (replacement && !replacementActive())
      throw new Error("工程已切换，请重新选择要替换的配音，或作为新配音生成");
    stopPreview();
    const projectId = context.projectId();
    const placement = {
      startFrame: replacement?.clip.startFrame ?? context.frame(),
      attach: true,
      ...(replacement ? { replaceClip: structuredClone(replacement.clip) } : {}),
    };
    const params = {
      text,
      modelId,
      voiceId,
      rate,
      ...referenceParams(),
      ...(model()?.supportsInstructions ? { instructions: instructions.trim() } : {}),
    };
    submitting = true;
    error = "";
    context.changed();
    try {
      await production.createVoiceover(params, placement);
      if (context.projectId() === projectId) context.queued();
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
      throw reason;
    } finally {
      submitting = false;
      if (!disposed) context.changed();
    }
  }
  function render(): string {
    if (referenceProjectId !== context.projectId()) {
      referenceAssetId = "";
      referenceText = "";
      referenceProjectId = context.projectId();
    }
    selectDefault();
    const current = model(),
      all = models(),
      voices = visibleVoices();
    const languages = [
      ...new Set(
        (current?.voices ?? []).map((voice) => normalizeLanguage(voice.language).split("-")[0]!),
      ),
    ].sort();
    const browserOnly = modelId === BROWSER_MODEL;
    const rateOptions = [...new Set([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, rate])].sort(
      (a, b) => a - b,
    );
    return html`<div class="section-title">
        <h2>文字配音</h2>
        <span class="tiny-badge">VOICEOVER</span>
      </div>
      <p class="section-description voiceover-intro">
        选择模型，先生成短音频听效果。<br />满意后生成完整配音，加入独立音轨。
      </p>
      <section class="voiceover-section">
        <div class="voiceover-step">
          <span>01</span>
          <h3>模型与声音</h3>
          ${button("voiceover-retry", loading ? "读取中…" : "刷新", "undo", "text-button", loading)}
        </div>
        <label class="input-label"
          >配音模型<select id="voiceover-model" ${loading ? "disabled" : ""}>
            ${all.length
              ? all
                  .map(
                    (item) =>
                      `<option value="${esc(item.id)}" ${item.id === modelId ? "selected" : ""}>${esc(item.name)}${item.available ? "" : " · 不可用"}</option>`,
                  )
                  .join("")
              : '<option value="">当前没有可用模型</option>'}${modelId && !current
              ? `<option value="${esc(modelId)}" selected>已保存的模型 · 当前不可用</option>`
              : ""}
          </select></label
        >
        <p class="voiceover-model-note">
          ${current
            ? `${esc(current.provider)} · ${browserOnly ? "仅用于试听文案，不保存音频" : current.available ? "可生成并保存音轨" : esc(current.reason || "当前不可用，请更新或配置 CodeShell 桌面版后刷新")}`
            : "请选择实际可用的模型"}
        </p>
        ${current?.installable && production.enabled
          ? button(
              "setup-voiceover",
              current.available ? "重新检查并修复引擎" : "安装并验证引擎",
              "download",
              "quiet full",
              loading || current.state === "installing",
            )
          : ""}
        ${current?.mode
          ? `<p class="small muted">${current.mode === "offline" ? "所选模型在本机合成，不向语音服务发送文案。" : "在线语音：合成时需要联网，文案会发送给所选服务。"}</p>`
          : ""}
        ${production.enabled
          ? '<p class="small muted voiceover-model-hint">更多模型：在 CodeShell 设置 → 模型连接 → 文字配音中添加连接，然后刷新。可选硅基流动中文配音 · CosyVoice。</p>'
          : '<p class="small muted voiceover-model-hint">在线或本地音轨生成需要桌面面板；这里可试听浏览器提供的声音。</p>'}
        ${current?.supportsVoiceCloning
          ? html`<div class="voiceover-clone">
              <h3>用我自己的声音</h3>
              <p class="small muted">
                先在“自己录”录制 3–30
                秒清晰的本人声音并保存，或导入已有录音。本地声音合成不向语音服务上传参考录音或文稿。
                使用 AI 初始化或制作时，所选逐字稿与文案会交给当前 AI 连接处理。
              </p>
              <label class="input-label"
                >本人参考录音<select id="voiceover-reference">
                  <option value="">请选择已保存的录音</option>
                  ${referenceAssets()
                    .map(
                      (asset) =>
                        `<option value="${esc(asset.id)}" ${asset.id === referenceAssetId ? "selected" : ""}>${esc(asset.name)} · ${Math.round(asset.durationFrames / (context.fps?.() ?? 30))} 秒</option>`,
                    )
                    .join("")}
                </select></label
              >
              <label class="input-label"
                >参考录音逐字稿<textarea
                  id="voiceover-reference-text"
                  rows="3"
                  maxlength="1000"
                  placeholder="把这段参考录音里说的话原样填在这里；下方配音文案填写要新读的内容。"
                >
${esc(referenceText)}</textarea
                >
              </label>
              <p id="voiceover-reference-status" class="small muted" role="status">
                ${esc(referenceError() || "参考录音与逐字稿已填写，可生成短试听。")}
              </p>
              <p class="small muted">
                建议 10–20 秒、无背景音乐、正常语速。先生成短试听，确认发音和相似度后再生成全文。
              </p>
            </div>`
          : current?.id === "macos-say"
            ? '<p class="small muted">当前是系统朗读音色。想换声音，可选择 Edge / Kokoro 或已配置的在线模型；本人声音可选 Audio8 或 Qwen3-TTS。</p>'
            : ""}
        <div class="voiceover-selects">
          <label class="input-label"
            >语言<select id="voiceover-language" ${!languages.length || loading ? "disabled" : ""}>
              <option value="">全部语言</option>
              ${languages
                .map(
                  (value) =>
                    `<option value="${esc(value)}" ${value === language ? "selected" : ""}>${esc(languageName(value))}</option>`,
                )
                .join("")}
            </select></label
          ><label class="input-label"
            >声音<select id="voiceover-voice" ${!voices.length || loading ? "disabled" : ""}>
              ${voices.length
                ? voices
                    .map(
                      (voice) =>
                        `<option value="${esc(voice.id)}" ${voice.id === voiceId ? "selected" : ""}>${esc(voice.name)} · ${esc(languageName(voice.language))}</option>`,
                    )
                    .join("")
                : `<option value="">${loading ? "正在读取声音…" : "暂无匹配声音"}</option>`}${voiceId &&
              !voices.some((voice) => voice.id === voiceId)
                ? `<option value="${esc(voiceId)}" selected>已保存声音 · 当前不可用</option>`
                : ""}
            </select></label
          >
        </div>
      </section>
      <section class="voiceover-section">
        <div class="voiceover-step">
          <span>02</span>
          <h3>编辑文案</h3>
        </div>
        <div class="voiceover-draft-actions">
          ${button(
            "voiceover-from-captions",
            "从字幕填入文案",
            "text",
            "text-button",
            !context.captionText,
          )}${textBeforeImport !== undefined
            ? button("voiceover-undo-import", "撤回导入", "undo", "text-button")
            : ""}
        </div>
        <label class="input-label" for="voiceover-text">配音文案</label
        ><textarea
          id="voiceover-text"
          rows="7"
          maxlength="${maxLength()}"
          placeholder="写下你想说的话，例如：从想法，到成片。让每一帧，恰到好处。"
        >
${esc(text)}</textarea
        >
        <div class="voiceover-draft-meta">
          <span id="voiceover-count" class="${text.length > maxLength() ? "over-limit" : ""}"
            >${text.length} / ${maxLength()} 字符</span
          ><span id="voiceover-estimate">${estimate()}</span>
        </div>
        <p id="voiceover-notice" class="voiceover-notice" ${notice ? "" : "hidden"}>
          ${esc(notice)}
        </p>
        ${current?.supportsInstructions
          ? `<label class="input-label">表达方式（可选）<textarea id="voiceover-instructions" rows="2" maxlength="1000" placeholder="例如：自然、平静，像向朋友介绍。">${esc(instructions)}</textarea></label>`
          : ""}
        <label class="input-label"
          >语速<select id="voiceover-rate">
            ${rateOptions
              .map(
                (value) =>
                  `<option value="${value}" ${value === rate ? "selected" : ""}>${value}×${value === 1 ? " · 标准" : ""}</option>`,
              )
              .join("")}
          </select></label
        >
      </section>
      <section class="voiceover-section">
        <div class="voiceover-step">
          <span>03</span>
          <h3>试听与生成</h3>
        </div>
        ${production.enabled && !browserOnly
          ? button(
              "sample-voiceover",
              "试听所选声音 · 前 120 字",
              "play",
              "primary full",
              !canGenerate(),
            ) +
            '<p class="small muted">使用当前模型真实生成，完成后到制作任务中播放。试听音频保留在素材库。</p>'
          : ""}
        ${button("create-voiceover", generationLabel(), "volume", "full", !canGenerate())}
        ${replacementActive() ? button("new-voiceover", "作为新配音", "plus", "quiet full") : ""}
        <div class="voiceover-preview-actions">
          ${button(
            "preview-voiceover",
            "浏览器读稿 · 非模型效果",
            "play",
            "quiet",
            !canPreview(),
          )}${button("stop-voiceover-preview", "停止试听", "pause", "quiet", !previewing)}
        </div>
        <p id="voiceover-preview-status" class="voiceover-preview-status" role="status">
          ${esc(previewMessage)}
        </p>
        <p class="small muted">
          ${matchingPreviewVoice()
            ? "浏览器试听不会生成音轨；实际配音以模型生成结果为准。"
            : browserOnly
              ? "当前浏览器没有匹配的试听声音，请刷新或使用内置示例。"
              : "浏览器无法试听这个模型的声音。生成后可在任务中试听所选模型结果。"}
        </p>
        ${!production.enabled
          ? '<p class="host-required">浏览器可听内置示例旁白，也可用实际可用的浏览器声音试听文案。生成任意文案音轨，请在更新后的 CodeShell 面板中打开。</p>'
          : browserOnly
            ? '<p class="host-required">当前选择为试听专用模型。生成音轨，请切换到可用的配音模型。</p>'
            : current?.available
              ? `<p class="capability-note">${modelId === "macos-say" ? "macOS 系统音色，本机生成、无需账号。" : "使用所选模型生成音频。"}完整音频、文案、模型、声音与语速随工程保留。</p>`
              : `<p class="host-required">${esc(current?.reason || catalog?.reason || production.status.tts?.reason || "当前工作台尚未提供可用的配音模型，请更新 CodeShell 后刷新。")}</p>`}
        ${error ? `<p class="conflict">${esc(error)}</p>` : ""}
        <p class="small muted">时长仅为估算。画面短于生成配音时会提示，完整源音频仍会保留。</p>
        ${button("listen-demo", "听听示例工程", "play", "quiet full")}
      </section>`;
  }
  function dispose(): void {
    disposed = true;
    stopPreview();
    browserSpeech()?.removeEventListener("voiceschanged", refreshBrowserVoices);
  }
  return {
    setup,
    sample,
    setText,
    usePreparedVoice,
    load,
    retry,
    input,
    submit,
    preview,
    stopPreview,
    importCaptions,
    undoTextImport,
    resetReplacement,
    dispose,
    render,
  };
}
