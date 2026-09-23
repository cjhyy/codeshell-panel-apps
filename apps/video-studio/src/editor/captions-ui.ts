import type { CaptionController, CaptionControllerState } from "./caption-controller";
import { exportEditorSrt, listCaptions } from "./captions";
import { CAPTION_PRESETS, currentCaptionPreset, type CaptionPreset } from "./caption-presets";
import { captionClipIdsForLegacyIds } from "./legacy-adapter";
import type { EditorSession } from "./session";
import { secondsToTicks, snapToFrame, type Tick } from "./time";
import type { EditorDocument, EditorSequence, TextClip } from "./types";
export interface EditorCaptionsUIContext {
  session(): EditorSession;
  controller: CaptionController;
  /** "inline" builds a panel section that {@link EditorCaptionsUI.mount} places into a host. */
  presentation?: "dialog" | "inline";
  /** Playhead of the shown sequence; enables “在播放头添加字幕”. */
  currentTime?(): Tick;
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
const APPROVED = new Set(["approved", "recorded", "aligned"]);
function narration(doc: EditorDocument): {
  phase: string;
  captionBasis: string;
  draftCaptionIds: string[];
} {
  const value = doc.production?.narration;
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { phase: "", captionBasis: "", draftCaptionIds: [] };
  return {
    phase: typeof value.phase === "string" ? value.phase : "",
    captionBasis: typeof value.captionBasis === "string" ? value.captionBasis : "",
    draftCaptionIds: Array.isArray(value.draftCaptionIds)
      ? value.draftCaptionIds.filter((id): id is string => typeof id === "string")
      : [],
  };
}
/** An untouched field keeps its exact, possibly off-frame, tick; a typed value snaps to a frame. */
function inputTick(input: HTMLInputElement, existing: Tick, sequence: EditorSequence): Tick {
  if (input.value === seconds(existing)) return existing;
  const value = Number(input.value);
  if (!input.value.trim() || !Number.isFinite(value) || value < 0)
    throw new Error("请输入有效的秒数");
  return snapToFrame(secondsToTicks(value), sequence.frameRate);
}
/** Caption workbench uses the same authoritative session and never stores an editable project copy. */
export class EditorCaptionsUI {
  private readonly inline: boolean;
  private readonly root: HTMLElement;
  private readonly status = element("p");
  private readonly narrationNote = element("p");
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
  private readonly preset = element("select");
  private readonly family = element("input");
  private readonly fontSize = element("input");
  private readonly animation = element("select");
  private readonly styleButton = element("button", "应用到所选字幕");
  private readonly newText = element("textarea");
  private readonly addButton = element("button", "在播放头添加字幕");
  private readonly exportButton = element("button", "导出所选 SRT");
  private readonly disposers: Array<() => void> = [];
  private unwatch: (() => void) | undefined;
  private selected = new Set<string>();
  private sourceIds = new Set<string>();
  private sequenceId = "";
  private revision = "";
  private opened = false;
  private disposed = false;
  private focused: HTMLElement | undefined;
  /** Unsaved row edits by clip ID; rows are rebuilt whenever the document changes. */
  private readonly drafts = new Map<string, { text?: string; start?: string; end?: string }>();
  constructor(
    container: HTMLElement,
    private readonly context: EditorCaptionsUIContext,
  ) {
    this.inline = context.presentation === "inline";
    this.root = element(this.inline ? "section" : "dialog");
    this.root.className = this.inline ? "editor-captions is-inline" : "editor-captions";
    this.root.setAttribute("aria-label", "字幕工作台");
    const header = element("header"),
      close = element("button", "关闭字幕");
    header.append(element("h2", "字幕"));
    if (!this.inline) header.append(close);
    this.status.setAttribute("role", "status");
    this.status.className = "ec-status";
    this.narrationNote.className = "ec-narration";
    this.narrationNote.hidden = true;
    const adding = element("section");
    adding.className = "ec-add";
    this.newText.rows = 2;
    this.newText.maxLength = 10000;
    this.newText.placeholder = "输入字幕文字";
    this.newText.setAttribute("aria-label", "新字幕文字");
    this.addButton.dataset.captionAdd = "";
    adding.append(this.newText, this.addButton);
    adding.hidden = !context.currentTime;
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
      all = element("button", "全选字幕");
    tools.append(importButton, this.exportButton, all, this.file);
    tools.append(detachButton);
    detachButton.addEventListener("click", () =>
      this.edit(() => context.controller.detach(this.sequenceId, [...this.selected])),
    );
    const presetRow = element("label");
    presetRow.className = "ec-preset";
    const presetEmpty = element("option", "自定义样式");
    presetEmpty.value = "";
    presetEmpty.disabled = true;
    this.preset.append(presetEmpty);
    for (const item of CAPTION_PRESETS) {
      const option = element("option", item.label);
      option.value = item.value;
      this.preset.append(option);
    }
    this.preset.setAttribute("aria-label", "字幕样式");
    presetRow.append(element("span", "字幕样式"), this.preset);
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
    body.append(
      this.narrationNote,
      presetRow,
      adding,
      this.rows,
      tools,
      this.preview,
      styling,
      translation,
    );
    const footer = element("footer");
    footer.append(this.cancelButton);
    this.root.append(header, this.status, body, footer);
    if (!this.inline) container.append(this.root);
    for (const button of this.root.querySelectorAll("button")) button.type = "button";
    close.addEventListener("click", () => this.close());
    this.root.addEventListener("cancel", () => {
      context.controller.cancel();
    });
    // Rebuilding the surrounding panel detaches this section; remember focus so mount() restores it.
    this.root.addEventListener("focusin", (event) => {
      this.focused = event.target instanceof HTMLElement ? event.target : undefined;
    });
    this.root.addEventListener("focusout", () =>
      queueMicrotask(() => {
        if (this.root.isConnected && !this.root.contains(document.activeElement))
          this.focused = undefined;
      }),
    );
    this.cancelButton.addEventListener("click", () => context.controller.cancel());
    this.applyButton.addEventListener("click", () =>
      this.edit(async () => {
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
      this.edit(() =>
        context.controller.updateStyle(this.sequenceId, [...this.selected], {
          ...(this.family.value ? { fontFamily: this.family.value } : {}),
          ...(this.fontSize.value ? { fontSize: Number(this.fontSize.value) } : {}),
          ...(this.animation.value ? { animation: this.animation.value as any } : {}),
        }),
      ),
    );
    this.preset.addEventListener("change", () => {
      const chosen = this.preset.value as CaptionPreset;
      if (chosen)
        this.edit(async () => {
          try {
            await context.controller.applyPreset(this.sequenceId, chosen);
          } finally {
            if (!this.disposed) this.syncPreset();
          }
        });
    });
    this.addButton.addEventListener("click", () =>
      this.edit(async () => {
        const seq = this.sequence();
        if (!seq || !context.currentTime) throw new Error("字幕时间线不存在");
        if (!this.newText.value.trim()) throw new Error("请先填写字幕文字");
        const id = await context.controller.add(this.sequenceId, {
          start: snapToFrame(context.currentTime(), seq.frameRate),
          text: this.newText.value,
          ...(this.track.value ? { trackId: this.track.value } : {}),
        });
        if (this.disposed) return;
        this.newText.value = "";
        if (id) this.selected.add(id);
        this.renderRows();
        this.selectionChanged();
      }),
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
    this.exportButton.addEventListener("click", () =>
      this.run(async () => {
        if (!this.selected.size) throw new Error("请先选择字幕");
        const doc = context.session().read(),
          srt = exportEditorSrt(doc, this.sequenceId, [...this.selected]);
        const url = URL.createObjectURL(
          new Blob([srt], { type: "application/x-subrip;charset=utf-8" }),
        );
        const link = element("a");
        link.href = url;
        link.download = `${doc.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_") || "字幕"}.srt`;
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
  /** A saved caption change may revoke an approved narration draft; say so right away. */
  private edit(task: () => Promise<unknown>): void {
    this.run(async () => {
      const before = narration(this.context.session().read()).phase;
      await task();
      if (this.disposed) return;
      const after = narration(this.context.session().read()).phase;
      if (APPROVED.has(before) && after === "review")
        this.status.textContent =
          "字幕已保存。口播草稿已回到待确认，请到「AI 制作」重新确认后再录音。";
      this.renderNarration();
    });
  }
  private sequence(): EditorSequence | undefined {
    return this.context
      .session()
      .read()
      .sequences.find((seq) => seq.id === this.sequenceId);
  }
  private captions(): TextClip[] {
    return this.sequence() ? listCaptions(this.context.session().read(), this.sequenceId) : [];
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
  private syncPreset() {
    const seq = this.sequence(),
      doc = this.context.session().read(),
      clips = this.captions();
    const preference = doc.production?.legacyCaptionStyle;
    this.preset.value =
      (seq && currentCaptionPreset(seq, clips)) ??
      (!clips.length && CAPTION_PRESETS.some((item) => item.value === preference)
        ? String(preference)
        : "");
  }
  private renderNarration() {
    const doc = this.context.session().read(),
      state = narration(doc);
    const notes: string[] = [];
    if (state.captionBasis === "draft" && this.draftIds(doc).size)
      notes.push(
        "当前含文案估时的临时字幕。确认草稿、录完本人声音后，会按真实口播重排正式字幕。",
      );
    if (APPROVED.has(state.phase))
      notes.push("口播草稿已确认：修改字幕文字、时间或删除字幕会让它回到待确认状态。");
    this.narrationNote.textContent = notes.join("");
    this.narrationNote.hidden = !notes.length;
  }
  private draftIds(doc: EditorDocument): Set<string> {
    return captionClipIdsForLegacyIds(doc, this.sequenceId, narration(doc).draftCaptionIds);
  }
  /** Keep what the user typed but has not saved, unless it now equals the saved value. */
  private draft(
    input: HTMLInputElement | HTMLTextAreaElement,
    clipId: string,
    field: "text" | "start" | "end",
    saved: string,
  ) {
    input.dataset.captionField = field;
    input.value = saved;
    const draft = this.drafts.get(clipId);
    if (draft?.[field] !== undefined && draft[field] !== saved) input.value = draft[field]!;
    else if (draft) delete draft[field];
    input.addEventListener("input", () => {
      this.drafts.set(clipId, { ...this.drafts.get(clipId), [field]: input.value });
    });
  }
  private saved(clipId: string, fields: Array<"text" | "start" | "end">) {
    const draft = this.drafts.get(clipId);
    if (!draft) return;
    for (const field of fields) delete draft[field];
    if (!Object.keys(draft).length) this.drafts.delete(clipId);
  }
  private renderRows() {
    const clips = this.captions(),
      seq = this.sequence(),
      drafts = this.draftIds(this.context.session().read());
    const active = document.activeElement;
    const focus =
      active instanceof HTMLElement && this.rows.contains(active) && active.dataset.captionField
        ? {
            clipId: active.closest<HTMLElement>("[data-caption-id]")?.dataset.captionId,
            field: active.dataset.captionField,
            range:
              active instanceof HTMLTextAreaElement
                ? ([active.selectionStart, active.selectionEnd] as const)
                : undefined,
          }
        : undefined;
    const alive = new Set(clips.map((clip) => clip.id));
    for (const id of this.drafts.keys()) if (!alive.has(id)) this.drafts.delete(id);
    this.rows.replaceChildren();
    this.exportButton.disabled = !clips.length;
    if (!clips.length || !seq) {
      this.rows.append(
        element(
          "p",
          this.context.currentTime
            ? "还没有字幕。在播放头添加、选择声音生成，或导入 SRT。"
            : "还没有字幕。选择声音生成，或导入 SRT。",
        ),
      );
      return;
    }
    for (const clip of clips) {
      const row = element("article");
      row.className = "ec-row";
      row.dataset.captionId = clip.id;
      const head = element("div");
      head.className = "ec-row-head";
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
      seek.type = "button";
      seek.className = "ec-seek";
      seek.addEventListener("click", () =>
        this.run(async () => {
          await this.context.seek?.(clip.start);
          this.context.select?.(this.sequenceId, [clip.id]);
        }),
      );
      head.append(checkbox, seek);
      if (drafts.has(clip.id)) {
        const badge = element("span", "临时字幕");
        badge.className = "ec-badge";
        badge.title = "按文案估时，录音后会按真实口播重排";
        head.append(badge);
      }
      const input = element("textarea");
      this.draft(input, clip.id, "text", clip.text);
      input.setAttribute("aria-label", "字幕文字");
      input.rows = Math.min(4, clip.text.split("\n").length + 1);
      const save = element("button", "保存文字");
      save.type = "button";
      save.addEventListener("click", () =>
        this.edit(async () => {
          await this.context.controller.updateText(this.sequenceId, clip.id, input.value);
          this.saved(clip.id, ["text"]);
        }),
      );
      const timing = element("div");
      timing.className = "ec-row-time";
      const field = (label: string, tick: Tick, name: "start" | "end") => {
        const wrapper = element("label"),
          value = element("input");
        value.type = "number";
        value.min = "0";
        value.step = "0.001";
        value.inputMode = "decimal";
        this.draft(value, clip.id, name, seconds(tick));
        wrapper.append(element("span", label), value);
        timing.append(wrapper);
        return value;
      };
      const start = field("开始（秒）", clip.start, "start"),
        end = field("结束（秒）", clip.start + clip.duration, "end");
      const saveTime = element("button", "保存时间"),
        remove = element("button", "删除");
      saveTime.type = remove.type = "button";
      remove.className = "ec-remove";
      remove.title = "删除这条字幕";
      saveTime.addEventListener("click", () =>
        this.edit(async () => {
          const current = this.sequence();
          if (!current) throw new Error("字幕时间线不存在");
          await this.context.controller.updateTiming(this.sequenceId, clip.id, {
            start: inputTick(start, clip.start, current),
            end: inputTick(end, clip.start + clip.duration, current),
          });
          this.saved(clip.id, ["start", "end"]);
        }),
      );
      remove.addEventListener("click", () =>
        this.edit(async () => {
          await this.context.controller.remove(this.sequenceId, [clip.id]);
          this.selected.delete(clip.id);
        }),
      );
      timing.append(saveTime, remove);
      const actions = element("div");
      actions.className = "ec-row-actions";
      actions.append(save);
      const info = element(
        "small",
        clip.words.length
          ? `${clip.words.length} 个真实词时间 · 修改文字会清除旧词时间`
          : "无词时间，可使用普通字幕",
      );
      row.append(head, input, actions, timing, info);
      this.rows.append(row);
    }
    if (!focus?.clipId) return;
    const target = [...this.rows.querySelectorAll<HTMLElement>("[data-caption-id]")]
      .find((row) => row.dataset.captionId === focus.clipId)
      ?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        `[data-caption-field="${focus.field}"]`,
      );
    target?.focus({ preventScroll: true });
    if (target instanceof HTMLTextAreaElement && focus.range?.[0] != null && focus.range[1] != null)
      target.setSelectionRange(focus.range[0], focus.range[1]);
  }
  private renderDocument(force = false) {
    if (this.disposed || !this.isOpen()) return;
    const identity = JSON.stringify(this.context.session().getState().identity);
    if (!force && identity === this.revision) return;
    this.revision = identity;
    const seq = this.sequence();
    if (!seq) {
      if (this.inline) {
        // The sequence was removed; follow the document's active sequence.
        this.sequenceId = this.context.session().read().activeSequenceId;
        this.selected.clear();
        this.renderDocument(true);
      } else this.close();
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
    this.syncPreset();
    this.renderNarration();
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
    this.addButton.disabled = busy;
    this.preset.disabled = busy;
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
  private isOpen(): boolean {
    return this.inline ? this.opened : (this.root as HTMLDialogElement).open;
  }
  /**
   * Inline only: place the one persistent section into a freshly rendered host. The section keeps
   * its drafts, preview and listeners; focus lost to the rebuild returns to the same control.
   */
  mount(host: HTMLElement) {
    if (this.disposed) throw new Error("字幕面板已关闭");
    if (!this.inline) throw new Error("字幕对话框不能嵌入面板");
    if (this.root.parentElement === host) return;
    const focused = this.focused && this.root.contains(this.focused) ? this.focused : undefined;
    const range =
      focused instanceof HTMLTextAreaElement ||
      (focused instanceof HTMLInputElement && ["text", "search"].includes(focused.type))
        ? ([focused.selectionStart, focused.selectionEnd, focused.selectionDirection] as const)
        : undefined;
    const lost = !document.activeElement || document.activeElement === document.body;
    host.append(this.root);
    if (!focused || !lost) return;
    focused.focus({ preventScroll: true });
    if (range && range[0] !== null && range[1] !== null)
      (focused as HTMLTextAreaElement).setSelectionRange(range[0], range[1], range[2] ?? "none");
  }
  open(sequenceId = this.context.session().read().activeSequenceId) {
    if (this.disposed) throw new Error("字幕面板已关闭");
    // Inline panels are reopened after every host render; keep selection for the same sequence.
    const reopened = this.inline && this.opened && sequenceId === this.sequenceId;
    this.sequenceId = sequenceId;
    if (!reopened) this.selected = new Set(this.captions().map((clip) => clip.id));
    if (this.inline) this.opened = true;
    else if (!(this.root as HTMLDialogElement).open) (this.root as HTMLDialogElement).showModal();
    this.renderDocument(!reopened);
    if (!reopened || !this.unwatch) {
      this.unwatch?.();
      this.unwatch = this.context.session().subscribe(() => this.renderDocument());
    }
  }
  close() {
    if (this.disposed) return;
    this.unwatch?.();
    this.unwatch = undefined;
    if (this.inline) {
      // Leaving the panel keeps running work and any preview for the user's return.
      this.opened = false;
      return;
    }
    this.context.controller.cancel();
    (this.root as HTMLDialogElement).close();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.context.controller.cancel();
    this.unwatch?.();
    for (const dispose of this.disposers.splice(0)) dispose();
    this.root.remove();
  }
}
