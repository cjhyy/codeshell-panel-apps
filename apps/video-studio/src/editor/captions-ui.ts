import type { CaptionController, CaptionControllerState } from "./caption-controller";
import { exportEditorSrt } from "./captions";
import type { EditorSession } from "./session";
import type { TextClip } from "./types";
export interface EditorCaptionsUIContext {
  session(): EditorSession;
  controller: CaptionController;
  select?(sequenceId: string, clipIds: string[]): void;
  seek?(tick: number): void | Promise<void>;
  onError?(error: Error): void;
  /** Explains why local transcription is unavailable, naming the missing piece. */
  transcriptionHint?(): string;
  /** Checks local transcription tools again and updates the controller capabilities. */
  recheckTranscription?(): Promise<void>;
}
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
const seconds = (tick: number) => (tick / 240000).toFixed(3);
/** Caption workbench uses the same authoritative session and never stores an editable project copy. */
export class EditorCaptionsUI {
  private readonly dialog = element("dialog");
  private readonly status = element("p");
  private readonly sourceList = element("div");
  private readonly rows = element("div");
  private readonly preview = element("section");
  private readonly candidateRows = element("div");
  private readonly applyButton = element("button", "应用预览");
  private readonly cancelButton = element("button", "取消任务 / 丢弃预览");
  private readonly generateButton = element("button", "生成所选声音字幕");
  private readonly recheckButton = element("button", "重新检测");
  private readonly transcriptionNote = element("p");
  private readonly translateButton = element("button", "预览翻译");
  private readonly file = element("input");
  private readonly track = element("select");
  private readonly language = element("input");
  private readonly mode = element("select");
  private readonly family = element("input");
  private readonly fontSize = element("input");
  private readonly animation = element("select");
  private readonly styleButton = element("button", "应用到所选字幕");
  private readonly disposers: Array<() => void> = [];
  private unwatch: (() => void) | undefined;
  private selected = new Set<string>();
  private sourceIds = new Set<string>();
  private sequenceId = "";
  private revision = "";
  private disposed = false;
  constructor(
    container: HTMLElement,
    private readonly context: EditorCaptionsUIContext,
  ) {
    this.dialog.className = "editor-captions";
    this.dialog.setAttribute("aria-label", "字幕工作台");
    const header = element("header"),
      close = element("button", "关闭字幕");
    header.append(element("h2", "字幕"), close);
    this.status.setAttribute("role", "status");
    this.status.className = "ec-status";
    const tools = element("section");
    tools.className = "ec-tools";
    const sources = element("details");
    sources.open = true;
    sources.append(element("summary", "声音来源"), this.sourceList);
    this.track.setAttribute("aria-label", "目标字幕轨");
    this.generateButton.dataset.captionGenerate = "";
    this.recheckButton.dataset.captionRecheck = "";
    this.recheckButton.hidden = true;
    this.transcriptionNote.className = "ec-note";
    this.transcriptionNote.hidden = true;
    tools.append(
      sources,
      this.track,
      this.generateButton,
      this.recheckButton,
      this.transcriptionNote,
    );
    this.file.type = "file";
    this.file.accept = ".srt,application/x-subrip,text/plain";
    this.file.hidden = true;
    this.file.dataset.captionSrtInput = "";
    const detachButton = element("button", "解除所选来源绑定");
    const importButton = element("button", "导入 SRT"),
      exportButton = element("button", "导出所选 SRT"),
      all = element("button", "全选字幕");
    tools.append(importButton, exportButton, all, this.file);
    tools.append(detachButton);
    detachButton.addEventListener("click", () =>
      this.run(() => context.controller.detach(this.sequenceId, [...this.selected])),
    );
    const styling = element("section");
    styling.className = "ec-style";
    this.family.value = "system-ui";
    this.family.setAttribute("aria-label", "字幕字体");
    this.family.placeholder = "字体名称";
    this.fontSize.type = "number";
    this.fontSize.min = "8";
    this.fontSize.max = "1000";
    this.fontSize.value = "48";
    this.fontSize.setAttribute("aria-label", "字幕字号");
    for (const [value, title] of [
      ["none", "无动画"],
      ["word-highlight", "逐字高亮"],
      ["fade", "淡入淡出"],
      ["typewriter", "打字机"],
      ["", "保留各自动画"],
    ]) {
      const option = element("option", title);
      option.value = value!;
      this.animation.append(option);
    }
    this.animation.setAttribute("aria-label", "字幕动画");
    styling.append(this.family, this.fontSize, this.animation, this.styleButton);
    const translation = element("section");
    translation.className = "ec-translate";
    this.language.value = "英语";
    this.language.setAttribute("aria-label", "目标语言");
    for (const [value, title] of [
      ["bilingual", "原文 + 译文"],
      ["translated", "仅译文"],
    ]) {
      const option = element("option", title);
      option.value = value!;
      this.mode.append(option);
    }
    this.mode.setAttribute("aria-label", "翻译显示方式");
    translation.append(this.language, this.mode, this.translateButton);
    this.rows.className = "ec-rows";
    this.rows.setAttribute("aria-label", "当前字幕");
    this.preview.className = "ec-preview";
    this.preview.hidden = true;
    this.candidateRows.className = "ec-candidates";
    this.preview.append(element("h3", "字幕预览"), this.candidateRows, this.applyButton);
    const body = element("div");
    body.className = "ec-body";
    body.append(tools, styling, translation, this.rows, this.preview);
    const footer = element("footer");
    footer.append(this.cancelButton);
    this.dialog.append(header, this.status, body, footer);
    container.append(this.dialog);
    for (const button of this.dialog.querySelectorAll("button")) button.type = "button";
    close.addEventListener("click", () => this.close());
    this.dialog.addEventListener("cancel", () => {
      context.controller.cancel();
    });
    this.cancelButton.addEventListener("click", () => context.controller.cancel());
    this.applyButton.addEventListener("click", () =>
      this.run(async () => {
        const ids = context.controller.getState().candidate?.rows.map((row) => row.id) ?? [];
        await context.controller.apply();
        if (this.disposed) return;
        this.selected = new Set(ids.filter((id) => this.captions().some((clip) => clip.id === id)));
        this.renderRows();
        this.selectionChanged();
      }),
    );
    this.generateButton.addEventListener("click", () =>
      this.run(() =>
        context.controller.generate({
          sequenceId: this.sequenceId,
          assetIds: [...this.sourceIds],
          ...(this.track.value ? { trackId: this.track.value } : {}),
          wordHighlight: this.animation.value === "word-highlight",
        }),
      ),
    );
    this.recheckButton.addEventListener("click", () =>
      this.run(async () => {
        this.recheckButton.disabled = true;
        try {
          await context.recheckTranscription?.();
        } finally {
          this.recheckButton.disabled = false;
          if (!this.disposed) this.renderState(context.controller.getState());
        }
      }),
    );
    this.translateButton.addEventListener("click", () =>
      this.run(() =>
        context.controller.translate({
          sequenceId: this.sequenceId,
          clipIds: [...this.selected],
          language: this.language.value,
          mode: this.mode.value as "bilingual" | "translated",
        }),
      ),
    );
    this.styleButton.addEventListener("click", () =>
      this.run(() =>
        context.controller.updateStyle(this.sequenceId, [...this.selected], {
          ...(this.family.value ? { fontFamily: this.family.value } : {}),
          ...(this.fontSize.value ? { fontSize: Number(this.fontSize.value) } : {}),
          ...(this.animation.value ? { animation: this.animation.value as any } : {}),
        }),
      ),
    );
    all.addEventListener("click", () => {
      this.selected = new Set(this.captions().map((clip) => clip.id));
      this.renderRows();
      this.selectionChanged();
    });
    importButton.addEventListener("click", () => this.file.click());
    this.file.addEventListener("change", () => {
      const chosen = this.file.files?.[0];
      this.file.value = "";
      if (chosen)
        this.run(async () => {
          const session = context.session(),
            identity = session.getState().identity,
            sequenceId = this.sequenceId;
          if (chosen.size > 4 * 1024 * 1024) throw new Error("SRT 文件超过4 MiB");
          const text = await chosen.text();
          if (this.disposed) return;
          if (
            context.session() !== session ||
            JSON.stringify(context.session().getState().identity) !== JSON.stringify(identity)
          )
            throw new Error("读取SRT期间工程已切换，请重新选择文件");
          context.controller.importSrt({
            sequenceId,
            text,
            ...(this.track.value ? { trackId: this.track.value } : {}),
          });
        });
    });
    exportButton.addEventListener("click", () =>
      this.run(async () => {
        if (!this.selected.size) throw new Error("请先选择字幕");
        const srt = exportEditorSrt(context.session().read(), this.sequenceId, [...this.selected]);
        const url = URL.createObjectURL(
          new Blob([srt], { type: "application/x-subrip;charset=utf-8" }),
        );
        const link = element("a");
        link.href = url;
        link.download = "字幕.srt";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }),
    );
    this.disposers.push(context.controller.subscribe((state) => this.renderState(state)));
  }
  private run(task: () => void | Promise<void>): void {
    void Promise.resolve()
      .then(task)
      .catch((error) => {
        if (this.disposed) return;
        this.status.textContent = (error as Error).message ?? String(error);
        this.context.onError?.(error instanceof Error ? error : new Error(String(error)));
      });
  }
  private captions(): TextClip[] {
    return (
      this.context
        .session()
        .read()
        .sequences.find((seq) => seq.id === this.sequenceId)
        ?.clips.filter((clip): clip is TextClip => clip.kind === "text" && clip.role === "subtitle")
        .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id)) ?? []
    );
  }
  private selectionChanged() {
    this.syncStyles();
    this.context.select?.(this.sequenceId, [...this.selected]);
  }
  private syncStyles() {
    const styles = this.captions()
      .filter((clip) => this.selected.has(clip.id))
      .map((clip) => clip.style);
    if (!styles.length) return;
    this.family.value = styles.every((style) => style.fontFamily === styles[0]!.fontFamily)
      ? styles[0]!.fontFamily
      : "";
    this.fontSize.value = styles.every((style) => style.fontSize === styles[0]!.fontSize)
      ? String(styles[0]!.fontSize)
      : "";
    this.animation.value = styles.every((style) => style.animation === styles[0]!.animation)
      ? styles[0]!.animation
      : "";
  }
  private renderRows() {
    const clips = this.captions();
    this.rows.replaceChildren();
    if (!clips.length) {
      this.rows.append(element("p", "还没有字幕。选择声音生成，或导入 SRT。"));
      return;
    }
    for (const clip of clips) {
      const row = element("article");
      row.className = "ec-row";
      row.dataset.captionId = clip.id;
      const checkbox = element("input");
      checkbox.type = "checkbox";
      checkbox.checked = this.selected.has(clip.id);
      checkbox.setAttribute("aria-label", `选择字幕 ${clip.text.slice(0, 30)}`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selected.add(clip.id);
        else this.selected.delete(clip.id);
        this.selectionChanged();
      });
      const seek = element(
        "button",
        `${seconds(clip.start)}–${seconds(clip.start + clip.duration)} 秒`,
      );
      seek.addEventListener("click", () =>
        this.run(async () => {
          await this.context.seek?.(clip.start);
          this.context.select?.(this.sequenceId, [clip.id]);
        }),
      );
      const input = element("textarea");
      input.value = clip.text;
      input.setAttribute("aria-label", "字幕文字");
      input.rows = Math.min(4, clip.text.split("\n").length + 1);
      const save = element("button", "保存文字");
      save.addEventListener("click", () =>
        this.run(() => this.context.controller.updateText(this.sequenceId, clip.id, input.value)),
      );
      const info = element(
        "small",
        clip.words.length
          ? `${clip.words.length} 个真实词时间 · 修改文字会清除旧词时间`
          : "无词时间，可使用普通字幕",
      );
      row.append(checkbox, seek, input, save, info);
      this.rows.append(row);
    }
  }
  private renderDocument(force = false) {
    if (this.disposed || !this.dialog.open) return;
    const identity = JSON.stringify(this.context.session().getState().identity);
    if (!force && identity === this.revision) return;
    this.revision = identity;
    const seq = this.context
      .session()
      .read()
      .sequences.find((seq) => seq.id === this.sequenceId);
    if (!seq) {
      this.close();
      return;
    }
    const clips = this.captions(),
      ids = new Set(clips.map((clip) => clip.id));
    this.selected = new Set([...this.selected].filter((id) => ids.has(id)));
    const chosenTrack = this.track.value;
    this.track.replaceChildren(element("option", "自动选择字幕轨"));
    this.track.options[0]!.value = "";
    for (const track of seq.tracks.filter((track) => track.kind === "text" && !track.locked)) {
      const option = element("option", track.name);
      option.value = track.id;
      this.track.append(option);
    }
    if ([...this.track.options].some((option) => option.value === chosenTrack))
      this.track.value = chosenTrack;
    this.sourceList.replaceChildren();
    try {
      const sources = this.context.controller.sources(this.sequenceId),
        unique = [...new Map(sources.map((source) => [source.assetId, source])).values()];
      this.sourceIds = new Set(
        [...this.sourceIds].filter((id) => unique.some((source) => source.assetId === id)),
      );
      if (force) this.sourceIds = new Set(unique.map((source) => source.assetId));
      for (const source of unique) {
        const label = element("label"),
          input = element("input");
        input.type = "checkbox";
        input.checked = this.sourceIds.has(source.assetId);
        input.dataset.captionSource = source.assetId;
        input.addEventListener("change", () => {
          if (input.checked) this.sourceIds.add(source.assetId);
          else this.sourceIds.delete(source.assetId);
        });
        label.append(input, document.createTextNode(source.name));
        this.sourceList.append(label);
      }
      if (!unique.length)
        this.sourceList.append(element("p", "当前没有可听见的声音；静音与定格段不会生成字幕。"));
    } catch (error) {
      this.sourceList.append(element("p", (error as Error).message));
    }
    this.renderRows();
    this.syncStyles();
  }
  private renderState(state: CaptionControllerState) {
    if (this.disposed) return;
    this.status.textContent =
      state.message + (state.total ? ` · ${state.completed}/${state.total}` : "");
    const busy = ["preparing", "transcribing", "translating", "applying"].includes(state.phase);
    this.generateButton.disabled = busy || !state.canTranscribe;
    this.translateButton.disabled = busy || !state.canTranslate;
    // An empty hint means local media support is unavailable, so installing tools cannot help.
    const hint = state.canTranscribe ? "" : (this.context.transcriptionHint?.() ?? "");
    this.generateButton.title = state.canTranscribe
      ? ""
      : hint || "当前环境未连接真实转写，可导入SRT";
    this.transcriptionNote.textContent = hint;
    this.transcriptionNote.hidden = !hint;
    this.recheckButton.hidden = !hint || !this.context.recheckTranscription;
    this.translateButton.title = state.canTranslate ? "" : "当前环境未连接翻译服务";
    this.styleButton.disabled = busy;
    this.applyButton.disabled = busy || !state.candidate?.operations.length;
    this.cancelButton.disabled = state.phase === "applying";
    this.preview.hidden = !state.candidate;
    this.candidateRows.replaceChildren();
    if (state.candidate) {
      for (const notice of state.candidate.notices) this.candidateRows.append(element("p", notice));
      for (const row of state.candidate.rows) {
        const item = element("article");
        item.className = "ec-candidate";
        item.append(
          element(
            "small",
            `${seconds(row.start)}–${seconds(row.start + row.duration)} 秒 · ${row.wordCount} 词`,
          ),
        );
        if (row.before !== undefined) item.append(element("p", `原文：${row.before}`));
        const text = element("p", row.text);
        text.className = "ec-result";
        item.append(text);
        this.candidateRows.append(item);
      }
    }
    this.renderDocument();
  }
  open(sequenceId = this.context.session().read().activeSequenceId) {
    if (this.disposed) throw new Error("字幕面板已关闭");
    this.sequenceId = sequenceId;
    this.selected = new Set(this.captions().map((clip) => clip.id));
    if (!this.dialog.open) this.dialog.showModal();
    this.renderDocument(true);
    this.unwatch?.();
    this.unwatch = this.context.session().subscribe(() => this.renderDocument());
  }
  close() {
    if (this.disposed) return;
    this.context.controller.cancel();
    this.unwatch?.();
    this.unwatch = undefined;
    this.dialog.close();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.context.controller.cancel();
    this.unwatch?.();
    for (const dispose of this.disposers.splice(0)) dispose();
    this.dialog.remove();
  }
}
