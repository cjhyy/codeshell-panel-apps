import { escapeHtml as esc, icon } from "../icons";
import { EditorMarkers } from "./marker-ui";
import { EditorInspector } from "./inspector-ui";
import { EditorTimeline } from "./timeline-ui";
import { EditorPreview, type PreviewAudio } from "./preview";
import { EditorSession, type EditorSessionState } from "./session";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTextStyle,
  defaultTransform,
} from "./defaults";
import { createExportPresets, validateExportProfile, type ExportProfile } from "./export-settings";
import {
  constantTimeMap,
  formatFrameRate,
  freezeTimeMap,
  secondsToTicks,
  ticksToSeconds,
  type Tick,
} from "./time";
import type { EditorMediaPoolOptions } from "./media-pool";
import { applyEditorOperations, type EditorOperation } from "./operations";
import { reconcileEditorProduction } from "./production-guard";
import type { EditorAsset, EditorClip, EditorDocument, EditorSequence } from "./types";
import { sequenceDuration } from "./validation";
import { findFreeTrack } from "./rough-cut-placement";
import { EditorExportBatch } from "./export-batch";
import { EditorTiming } from "./timing-ui";
import { EditorCanvas } from "./canvas-ui";
import { EditorSequences } from "./sequences-ui";
import { EditorMulticam, type EditorMulticamContext } from "./multicam-ui";
import type { EditorTimelineContext } from "./timeline-ui";
import { panelRuntimeErrorMessage } from "../sdk/panel-runtime";

export interface EditorWorkspaceOptions {
  layout?: "standalone" | "embedded";
  showComposition?(): void;
  session: EditorSession;
  assertEditable?(): void;
  resolveAsset: EditorMediaPoolOptions["resolveAsset"];
  timelineMedia?: EditorTimelineContext["media"];
  alignMulticamSources?: EditorMulticamContext["alignSources"];
  prepareAudio?(
    document: EditorDocument,
    sequenceId: string,
    signal: AbortSignal,
    onProgress?: (message: string) => void,
  ): Promise<PreviewAudio | undefined>;
  exportSequence?(
    document: EditorDocument,
    sequenceId: string,
    profile: ExportProfile,
    signal: AbortSignal,
  ): Promise<void>;
  importMedia(): void | Promise<void>;
  openProject(): void | Promise<void>;
  newProject(): void | Promise<void>;
  downloadProject(document: EditorDocument): void | Promise<void>;
  packProject?(): void | Promise<void>;
  importProjectBundle?(): void | Promise<void>;
  syncProject?(): void | Promise<void>;
  showCaptions?(sequenceId: string): void | Promise<void>;
  showSeparation?(sequenceId: string, clipId: string): void | Promise<void>;
  showAudioEnhancement?(sequenceId: string, clipId: string): void | Promise<void>;
  /** Regenerate a generated voice clip's script and replace that clip in place. */
  editVoiceover?(sequenceId: string, clipId: string): void | Promise<void>;
  showProduction(tab: string): void | Promise<void>;
  onError(error: unknown): void;
}

const uid = (kind: string) => `${kind}-${crypto.randomUUID()}`;
function assetLimitations(asset: EditorAsset): string[] {
  const inspection = asset.metadata?.editorInspection;
  if (!inspection || typeof inspection !== "object" || Array.isArray(inspection)) return [];
  const compatibility = inspection.compatibility;
  if (!compatibility || typeof compatibility !== "object" || Array.isArray(compatibility))
    return [];
  return Array.isArray(compatibility.limitations)
    ? compatibility.limitations.flatMap((item) =>
        item && typeof item === "object" && !Array.isArray(item) && typeof item.message === "string"
          ? [item.message]
          : [],
      )
    : [];
}
const button = (action: string, label: string, extra = "") =>
  `<button type="button" data-ew-action="${action}" ${extra}>${label}</button>`;
const timeLabel = (tick: Tick) => {
  const value = ticksToSeconds(tick);
  return `${Math.floor(value / 60)
    .toString()
    .padStart(2, "0")}:${(value % 60).toFixed(2).padStart(5, "0")}`;
};

/** The shell only keeps selection and view state; every edit belongs to its injected session. */
export class EditorWorkspace {
  private readonly preview: EditorPreview;
  private readonly inspector: EditorInspector;
  private readonly timing: EditorTiming;
  private readonly markers: EditorMarkers;
  private readonly timeline: EditorTimeline;
  private readonly canvasEditor: EditorCanvas;
  private readonly sequences: EditorSequences;
  private multicam?: EditorMulticam;
  private readonly unsubscribe: () => void;
  private selected: string[] = [];
  private sequenceId: string;
  private revision = "";
  private playhead = 0;
  private search = "";
  private visible = true;
  private sourcePreview = false;
  private disposed = false;
  private preparing?: AbortController;
  private audio?: PreviewAudio;
  private dialog?: HTMLDialogElement;
  private dialogAbort?: AbortController;
  private pendingExport = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: EditorWorkspaceOptions,
  ) {
    this.sequenceId = options.session.read().activeSequenceId;
    container.classList.add("editor-workspace");
    container.classList.toggle("editor-workspace-embedded", options.layout === "embedded");
    container.innerHTML = `<header class="ew-header"><strong>Mimi 视频工作台</strong><input class="ew-project-name" data-ew-project-name aria-label="工程名称"><span data-ew-save role="status"></span><div class="ew-header-actions">${button("new", "新建")}${button("open", "打开")}${button("download", "工程备份")}${options.packProject ? button("pack-project", "打包工程") : ""}${options.importProjectBundle ? button("import-project-bundle", "打开工程包") : ""}${options.syncProject ? button("sync-project", "工程同步") : ""}${button("production", "制作与录音")}${button("export", "导出", 'class="ew-primary"')}</div></header>
      <nav class="ew-tools" aria-label="工程操作">${button("undo", "撤销")}${button("redo", "重做")}<label>序列 <select data-ew-sequence aria-label="当前序列"></select></label>${button("new-sequence", "新序列")}${button("sequence-settings", "画布与帧率")}${button("sequences", "序列与复合")}${button("multicam", "多机位")}<span class="ew-spacer"></span>${button("marker", "标记与范围")}${button("retry-save", "重试保存", "hidden")}</nav>
      <div class="ew-main"><aside class="ew-library" aria-label="素材与创作"><div class="ew-library-top"><h2>素材</h2>${button("import", "导入素材")}</div><input data-ew-search type="search" placeholder="搜索素材" aria-label="搜索素材"><div class="ew-create">${button("title", "文字")}${button("rectangle", "矩形")}${button("ellipse", "圆形")}</div><div class="ew-assets" data-ew-assets></div><div class="ew-production-links">${button("captions", "语音字幕")}${options.showSeparation ? button("separate", "人声与伴奏分离") : ""}${options.showAudioEnhancement ? button("enhance-audio", "降噪与响度") : ""}${button("voiceover", "配音")}${button("recording", "录音与录屏")}${button("roughcut", "AI 粗剪")}</div></aside>
      <section class="ew-viewer" aria-label="视频预览"><div class="ew-canvas-wrap"><canvas data-ew-canvas aria-label="当前画面"></canvas><p data-ew-preview-error hidden role="status"></p></div><p data-ew-font-warning hidden role="status"></p><div class="ew-player">${button("play", "播放", 'aria-label="播放"')}<output data-ew-time>00:00.00</output><input data-ew-seek type="range" min="0" max="0" value="0" step="1" aria-label="播放位置"><output data-ew-duration>00:00.00</output><span data-ew-fps></span></div></section>
      <aside class="ew-properties"><div data-ew-inspector></div><div data-ew-timing></div><div data-ew-sequences hidden></div><div data-ew-multicam hidden></div><div data-ew-markers hidden></div></aside></div><section data-ew-timeline></section>`;
    if (options.layout === "embedded") {
      for (const [action, glyph] of [
        ["undo", "undo"],
        ["redo", "redo"],
        ["new-sequence", "plus"],
        ["marker", "clock"],
      ]) {
        const control = this.get<HTMLButtonElement>(`[data-ew-action="${action}"]`);
        const label = control.textContent ?? "";
        control.setAttribute("aria-label", label);
        control.title = label;
        control.classList.add("ew-icon-button");
        control.innerHTML = icon(glyph!, 16);
      }
      const play = this.get<HTMLButtonElement>('[data-ew-action="play"]');
      play.classList.add("ew-icon-button");
      play.innerHTML = icon("play", 16);
      play.title = "播放 · 空格";
      const more = document.createElement("details");
      more.className = "ew-more";
      const summary = document.createElement("summary");
      summary.textContent = "更多工具";
      const contents = document.createElement("div");
      contents.className = "ew-more-actions";
      contents.append(this.get(".ew-create"));
      for (const action of [
        "captions",
        "separate",
        "enhance-audio",
        "pack-project",
        "import-project-bundle",
        "sync-project",
      ]) {
        const control = container.querySelector(`[data-ew-action="${action}"]`);
        if (control) contents.append(control);
      }
      more.append(summary, contents);
      this.get(".ew-tools").append(more);
    }
    const selection = () => ({ sequenceId: this.sequenceId, clipIds: [...this.selected] });
    const read = () => options.session.read();
    const apply = (operations: EditorOperation[], label: string) => {
      this.apply(operations, label);
    };
    const editVoiceover = options.editVoiceover;
    this.inspector = new EditorInspector(this.get("[data-ew-inspector]"), {
      read,
      selection,
      apply,
      time: () => this.playhead,
      onError: options.onError,
      ...(editVoiceover
        ? {
            editVoiceover: async (sequenceId: string, clipId: string) => {
              this.preview.pause();
              this.cancelPreparation();
              await editVoiceover(sequenceId, clipId);
            },
          }
        : {}),
    });
    this.timing = new EditorTiming(this.get("[data-ew-timing]"), {
      read,
      selection,
      apply,
      time: () => this.playhead,
      onError: options.onError,
    });
    this.sequences = new EditorSequences(this.get("[data-ew-sequences]"), {
      read,
      selection,
      apply,
      time: () => this.playhead,
      select: ({ sequenceId, clipIds }) => this.selectClips(sequenceId, clipIds),
      activate: (sequenceId) => {
        this.selectClips(sequenceId, []);
        this.run(() => this.seek(0));
      },
      onError: options.onError,
    });
    this.markers = new EditorMarkers(this.get("[data-ew-markers]"), {
      read,
      selection,
      apply,
      identity: () => options.session.getState().identity,
      time: () => this.playhead,
      seek: (time) => this.seek(time),
      onSelection: () => this.timeline?.render(),
      onError: options.onError,
    });
    this.timeline = new EditorTimeline(this.get("[data-ew-timeline]"), {
      read,
      identity: () => options.session.getState().identity,
      selection,
      apply,
      time: () => this.playhead,
      seek: (time) => this.seek(time),
      select: (ids) => {
        this.selected = ids;
        this.inspector.render();
        this.timing.render();
        this.sequences.render();
        this.multicam?.render();
        this.canvasEditor?.render();
      },
      selectedMarker: () => this.markers.selected,
      selectMarker: (id) => {
        const section = this.get("[data-ew-markers]");
        section.hidden = false;
        this.markers.select(id);
        section.scrollIntoView({ block: "nearest" });
      },
      media: options.timelineMedia,
      addAsset: (assetId, placement) => this.addAsset(assetId, placement),
      onError: options.onError,
    });
    this.preview = new EditorPreview(this.get<HTMLCanvasElement>("[data-ew-canvas]"), {
      resolveAsset: options.resolveAsset,
      onFrame: (time) => {
        this.playhead = time;
        this.updateTime();
        this.timeline.updatePlayhead();
        this.inspector.render();
        this.timing.render();
        this.sequences.render();
        this.canvasEditor?.render();
      },
      onPlaybackChange: (playing) => this.updatePlayButton(playing),
      onBuffering: (buffering) => {
        if (this.disposed || this.preparing) return;
        const output = this.get("[data-ew-preview-error]");
        if (buffering) {
          output.dataset.audioBuffering = "true";
          output.textContent = "正在缓冲声音，画面会在声音就绪后继续";
          output.hidden = false;
        } else if (output.dataset.audioBuffering) {
          delete output.dataset.audioBuffering;
          output.hidden = true;
        }
      },
      onWarning: (warnings) => {
        if (this.disposed) return;
        const output = this.get("[data-ew-font-warning]");
        output.textContent =
          warnings
            .slice(0, 3)
            .map((warning) => warning.message)
            .join("\n") +
          (warnings.length > 3
            ? `\n另有 ${warnings.length - 3} 种字体可能缺失，可在文字属性中查看。`
            : "");
        output.hidden = warnings.length === 0;
      },
      onError: (error) => this.previewError(error),
    });
    this.canvasEditor = new EditorCanvas(this.get<HTMLCanvasElement>("[data-ew-canvas]"), {
      read,
      identity: () => options.session.getState().identity,
      selection,
      time: () => this.playhead,
      select: (ids) => {
        this.selected = ids;
        this.timeline.render();
        this.inspector.render();
        this.timing.render();
        this.sequences.render();
        this.multicam?.render();
      },
      assertEditable: options.assertEditable,
      pause: () => this.cancelPreparation(),
      apply,
      draft: (document) =>
        document ? this.preview.previewDraft(document) : this.preview.seek(this.playhead),
      onError: options.onError,
    });
    container.addEventListener("click", this.click);
    container.addEventListener("change", this.change);
    container.addEventListener("input", this.input);
    container.addEventListener("keydown", this.keydown);
    container.addEventListener("pointerdown", this.activateComposition, true);
    if (options.layout === "embedded")
      for (const type of this.embeddedEvents)
        container.addEventListener(type, this.stopLegacyEvent);
    this.unsubscribe = options.session.subscribe((state) => this.refresh(state));
  }

  private get<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.container.querySelector<T>(selector)!;
  }
  private sequence(): EditorSequence {
    return this.options.session.read().sequences.find((s) => s.id === this.sequenceId)!;
  }
  private run(work: () => unknown | Promise<unknown>): void {
    try {
      void Promise.resolve(work()).catch((error) => this.options.onError(error));
    } catch (error) {
      this.options.onError(error);
    }
  }
  private apply(operations: EditorOperation[], label: string): void {
    this.options.assertEditable?.();
    const before = this.options.session.read();
    const after = applyEditorOperations(before, operations, before.revision);
    this.options.session.dispatch(
      [...operations, ...reconcileEditorProduction(before, after)],
      this.options.session.getState().identity,
      label,
    );
  }
  private refresh(state: EditorSessionState): void {
    if (this.disposed) return;
    const save = this.get("[data-ew-save]");
    save.textContent = (
      {
        saved: "已保存",
        pending: "等待保存",
        saving: "保存中…",
        failed: "保存失败",
        conflict: "版本冲突",
      } as const
    )[state.saveState];
    save.title = state.error?.message ?? "";
    this.get<HTMLButtonElement>('[data-ew-action="undo"]').disabled =
      !state.canUndo || state.phase !== "ready";
    this.get<HTMLButtonElement>('[data-ew-action="redo"]').disabled =
      !state.canRedo || state.phase !== "ready";
    if (state.error?.stage === "commit") save.textContent = "候选保存失败，请重试原操作";
    this.get('[data-ew-action="retry-save"]').hidden =
      state.saveState !== "failed" || state.error?.stage === "commit";
    const signature = `${state.identity.documentId}:${state.identity.generation}:${state.identity.revision}`;
    if (signature === this.revision) return;
    this.revision = signature;
    this.canvasEditor.cancel();
    const doc = this.options.session.read();
    this.sequenceId = doc.activeSequenceId;
    const sequence = this.sequence();
    this.selected = this.selected.filter((id) => sequence.clips.some((clip) => clip.id === id));
    this.cancelPreparation();
    this.audio?.stream?.dispose();
    this.audio = undefined;
    this.preview.setDocument(doc, sequence.id);
    this.playhead = Math.min(this.playhead, Math.max(0, sequenceDuration(sequence) - 1));
    const name = this.get<HTMLInputElement>("[data-ew-project-name]");
    if (document.activeElement !== name) name.value = doc.name;
    this.get("[data-ew-sequence]").innerHTML = doc.sequences
      .map(
        (s) =>
          `<option value="${esc(s.id)}" ${s.id === sequence.id ? "selected" : ""}>${esc(s.name)}</option>`,
      )
      .join("");
    this.get("[data-ew-duration]").textContent = timeLabel(sequenceDuration(sequence));
    this.get<HTMLInputElement>("[data-ew-seek]").max = String(
      Math.max(0, sequenceDuration(sequence) - 1),
    );
    this.get("[data-ew-fps]").textContent = `${formatFrameRate(sequence.frameRate)} fps`;
    this.renderAssets();
    this.inspector.render();
    this.timing.render();
    this.sequences.render();
    this.multicam?.render();
    this.markers.render();
    this.timeline.render();
    this.canvasEditor.render();
    this.updateTime();
    if (this.visible && !this.sourcePreview) this.run(() => this.seek(this.playhead));
  }

  private renderAssets(): void {
    const assets = this.options.session
      .read()
      .assets.filter((asset) =>
        asset.name.toLocaleLowerCase().includes(this.search.toLocaleLowerCase()),
      );
    this.get("[data-ew-assets]").innerHTML = assets.length
      ? assets
          .map(
            (asset) =>
              `<button type="button" data-ew-asset="${esc(asset.id)}" title="加入时间轴：${esc(asset.name)}"><span class="ew-asset-kind">${({ video: "视频", audio: "音频", image: "图片", demo: "示例" } as const)[asset.kind]}</span><strong>${esc(asset.name)}</strong><small>${asset.kind === "image" ? "静态画面" : timeLabel(asset.duration)} · 点击加入</small>${assetLimitations(
                asset,
              )
                .map((message) => `<small class="ew-asset-limitation">${esc(message)}</small>`)
                .join("")}</button>`,
          )
          .join("")
      : '<p class="ew-empty">导入视频、音频或图片后，点击素材加入当前序列。</p>';
  }
  private updateTime(): void {
    this.get("[data-ew-time]").textContent = timeLabel(this.playhead);
    this.get<HTMLInputElement>("[data-ew-seek]").value = String(this.playhead);
  }
  private updatePlayButton(playing: boolean): void {
    if (this.disposed) return;
    const button = this.get<HTMLButtonElement>('[data-ew-action="play"]');
    const label = this.preparing ? "取消播放准备" : playing ? "暂停" : "播放";
    if (this.options.layout === "embedded")
      button.innerHTML = icon(this.preparing ? "close" : playing ? "pause" : "play", 16);
    else button.textContent = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-busy", String(Boolean(this.preparing)));
    button.title = `${label} · 空格`;
  }
  private cancelPreparation(): void {
    this.preparing?.abort();
    this.preparing = undefined;
    this.clearPreparationStatus();
    this.preview?.pause();
    this.updatePlayButton(false);
  }
  private previewError(error: unknown): void {
    if (this.disposed) return;
    const output = this.get("[data-ew-preview-error]");
    delete output.dataset.previewPreparing;
    delete output.dataset.audioBuffering;
    output.hidden = false;
    output.textContent = panelRuntimeErrorMessage(error);
  }
  private preparationStatus(controller: AbortController, message: string): void {
    if (this.disposed || this.preparing !== controller || controller.signal.aborted) return;
    const output = this.get("[data-ew-preview-error]");
    delete output.dataset.audioBuffering;
    output.dataset.previewPreparing = "true";
    output.textContent = `${message} 再次点击播放按钮可取消等待；已开始的素材复制可能仍会完成。`;
    output.hidden = false;
  }
  private clearPreparationStatus(): void {
    const output = this.get("[data-ew-preview-error]");
    if (!output?.dataset.previewPreparing) return;
    delete output.dataset.previewPreparing;
    output.textContent = "";
    output.hidden = true;
  }
  get playing(): boolean {
    return this.preview.playing;
  }
  /** Current playhead of the shown sequence, in exact ticks. */
  currentTime(): Tick {
    return this.playhead;
  }
  async seek(time: Tick): Promise<void> {
    if (this.disposed) return;
    this.canvasEditor?.cancel();
    this.cancelPreparation();
    this.playhead = time;
    this.updateTime();
    try {
      await this.preview.seek(time);
      if (!this.disposed && !this.preparing) this.get("[data-ew-preview-error]").hidden = true;
    } catch (error) {
      this.previewError(error);
    }
  }
  async togglePlayback(): Promise<void> {
    if (this.disposed) return;
    if (this.preparing) {
      this.cancelPreparation();
      return;
    }
    if (this.preview.playing) {
      this.preview.pause();
      return;
    }
    const controller = new AbortController();
    this.preparing = controller;
    this.updatePlayButton(false);
    this.preparationStatus(controller, "正在准备播放素材，首次准备可能需要一些时间。");
    const doc = this.options.session.read(),
      sequenceId = this.sequenceId,
      signature = this.revision;
    try {
      const prepared =
        this.audio ??
        (await this.options.prepareAudio?.(doc, sequenceId, controller.signal, (message) =>
          this.preparationStatus(controller, message),
        ));
      if (
        controller.signal.aborted ||
        signature !== this.revision ||
        this.disposed ||
        !this.visible
      ) {
        if (prepared !== this.audio) prepared?.stream?.dispose();
        return;
      }
      this.audio = prepared;
      this.preparationStatus(controller, "正在载入画面并同步声音…");
      // Resource preparation may replace an incompatible source with a verified preview proxy.
      this.preview.setDocument(doc, sequenceId);
      await this.preview.seek(this.playhead);
      if (
        controller.signal.aborted ||
        signature !== this.revision ||
        this.disposed ||
        !this.visible
      )
        return;
      await this.preview.play(this.audio);
      if (!this.disposed) this.get("[data-ew-preview-error]").hidden = true;
    } catch (error) {
      if (!controller.signal.aborted) {
        this.previewError(error);
        throw error;
      }
    } finally {
      if (this.preparing === controller) {
        this.preparing = undefined;
        this.clearPreparationStatus();
      }
      this.updatePlayButton(this.preview.playing);
    }
  }
  setVisible(visible: boolean): void {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    this.container.hidden = !visible;
    this.multicam?.setVisible(visible && !this.get("[data-ew-multicam]").hidden);
    if (!visible) {
      this.canvasEditor.cancel();
      this.cancelPreparation();
      this.preview.pause();
    } else {
      this.timeline.render();
      if (!this.sourcePreview) this.run(() => this.seek(this.playhead));
    }
  }
  /** Called after an imported/reconnected resource becomes available without a document edit. */
  refreshMedia(): void {
    if (this.visible && !this.sourcePreview) this.run(() => this.seek(this.playhead));
  }
  /** Browsing source footage replaces the monitor, while the canonical timeline stays mounted. */
  setSourcePreview(active: boolean): void {
    if (this.sourcePreview === active || this.disposed) return;
    this.sourcePreview = active;
    if (active) {
      this.cancelPreparation();
      this.preview.pause();
    } else if (this.visible) this.run(() => this.seek(this.playhead));
  }
  private activateComposition = (): void => {
    if (this.sourcePreview) this.options.showComposition?.();
  };
  refreshTimelineMedia(): void {
    if (this.visible && !this.disposed) this.timeline.render();
  }
  selectClips(sequenceId: string, clipIds: string[]): void {
    if (this.disposed || sequenceId !== this.sequenceId) return;
    this.canvasEditor.cancel();
    const existing = new Set(this.sequence().clips.map((clip) => clip.id));
    this.selected = [...new Set(clipIds)].filter((id) => existing.has(id));
    this.timeline.render();
    this.inspector.render();
    this.timing.render();
    this.sequences.render();
    this.multicam?.render();
    this.canvasEditor.render();
  }
  getSelection(): { sequenceId: string; clipIds: string[] } {
    return { sequenceId: this.sequenceId, clipIds: [...this.selected] };
  }
  getPlayhead(): Tick {
    return this.playhead;
  }
  revealSelection(): void {
    const id = this.selected[0];
    if (id)
      this.container
        .querySelector<HTMLElement>(`[data-et-clip="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  private track(
    kind: "video" | "audio" | "text",
    start: Tick,
    duration: Tick,
  ): { id: string; operations: EditorOperation[] } {
    const { trackId, operations } = findFreeTrack(this.sequence(), kind, start, duration, uid);
    return { id: trackId, operations };
  }
  addAsset(assetId: string, placement: { at?: Tick; trackId?: string } = {}): void {
    const asset = this.options.session.read().assets.find((a) => a.id === assetId);
    if (!asset) throw new Error("素材已移除，请刷新后重试");
    const at = placement.at ?? this.playhead;
    if (!Number.isSafeInteger(at) || at < 0) throw new Error("片段落点必须是有效时间");
    const duration = asset.kind === "image" ? secondsToTicks(5) : asset.duration;
    if (!duration) throw new Error("素材长度尚未确认，请先完成素材准备");
    if (!Number.isSafeInteger(at + duration)) throw new Error("片段落点超出时间范围");
    let kind: "video" | "audio" = asset.kind === "audio" ? "audio" : "video";
    if (placement.trackId !== undefined) {
      const sequence = this.sequence();
      const track = sequence.tracks.find((track) => track.id === placement.trackId);
      if (!track) throw new Error("目标轨道已不存在");
      if (track.locked) throw new Error("目标轨道已锁定，请先解锁");
      if (
        track.kind === "text" ||
        (asset.kind === "audio"
          ? track.kind !== "audio"
          : asset.kind !== "video" && track.kind !== "video")
      )
        throw new Error("素材类型与目标轨道不匹配");
      if (
        sequence.clips.some(
          (clip) =>
            clip.trackId === track.id &&
            clip.start < at + duration &&
            clip.start + clip.duration > at,
        )
      )
        throw new Error("目标位置已有片段，请选择空白位置或其他轨道");
      kind = track.kind;
    }
    this.addClip(
      {
        kind: "media",
        assetId,
        timeMap:
          asset.kind === "image"
            ? freezeTimeMap(0, duration)
            : constantTimeMap(0, duration, 1).timeMap,
        audio: defaultAudioMix(),
        duration,
        label: asset.name,
      },
      kind,
      { ...placement, at },
    );
  }
  private addClip(
    value: Partial<EditorClip> & { duration: Tick; label: string },
    kind: "video" | "audio" | "text",
    placement: { at?: Tick; trackId?: string } = {},
  ): void {
    const at = placement.at ?? this.playhead;
    const track = placement.trackId
      ? { id: placement.trackId, operations: [] }
      : this.track(kind, at, value.duration);
    const clip = {
      id: uid("clip"),
      start: at,
      trackId: track.id,
      transform: defaultTransform(),
      color: defaultColorAdjustment(),
      blendMode: "normal",
      ...value,
    } as EditorClip;
    this.apply(
      [...track.operations, { type: "clip.add", sequenceId: this.sequenceId, clip }],
      "添加片段",
    );
    this.selected = [clip.id];
    this.timeline.render();
    this.inspector.render();
    this.timing.render();
    this.activateComposition();
    this.run(() => this.seek(at));
    this.revealSelection();
  }
  private click = (event: MouseEvent) => {
    const target = (event.target as Element).closest<HTMLElement>(
      "[data-ew-action],[data-ew-asset]",
    );
    if (!target) return;
    const menu = target.closest<HTMLDetailsElement>(".ew-more");
    if (menu) menu.open = false;
    if (target.dataset.ewAsset) {
      this.run(() => this.addAsset(target.dataset.ewAsset!));
      return;
    }
    this.run(() => this.action(target.dataset.ewAction!));
  };
  private readonly embeddedEvents = [
    "click",
    "input",
    "change",
    "keydown",
    "pointerdown",
    "pointermove",
    "pointerup",
    "pointercancel",
    "dragstart",
    "dragover",
    "drop",
    "contextmenu",
  ];
  /** The surrounding production shell owns a separate set of legacy gesture handlers. */
  private stopLegacyEvent = (event: Event): void => {
    event.stopPropagation();
  };
  private input = (event: Event) => {
    const target = event.target as HTMLInputElement;
    if (target.matches("[data-ew-search]")) {
      this.search = target.value;
      this.renderAssets();
    }
  };
  private change = (event: Event) => {
    const target = event.target as HTMLInputElement;
    if (target.matches("[data-ew-seek]")) this.run(() => this.seek(Number(target.value)));
    if (target.matches("[data-ew-project-name]"))
      this.run(() => this.apply([{ type: "project.rename", name: target.value }], "工程重命名"));
    if (target.matches("[data-ew-sequence]"))
      this.run(() =>
        this.apply([{ type: "sequence.activate", sequenceId: target.value }], "切换序列"),
      );
  };
  /** Shell shortcuts share the same guards as controls inside the editor. */
  handleShortcut(event: KeyboardEvent): void {
    if (this.visible && !this.disposed) this.keydown(event);
  }
  private keydown = (event: KeyboardEvent) => {
    if (
      (event.target as Element).closest(
        "input,textarea,select,button,[contenteditable=true],dialog",
      )
    )
      return;
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.stopPropagation();
      this.run(() => this.action(event.shiftKey ? "redo" : "undo"));
    } else if (event.code === "Space" && !(event.target as Element).closest("[data-et-clip]")) {
      event.preventDefault();
      event.stopPropagation();
      this.run(() => this.togglePlayback());
    }
  };
  private async action(action: string): Promise<void> {
    if (action === "multicam") {
      const section = this.get("[data-ew-multicam]");
      section.hidden = !section.hidden;
      if (!section.hidden && !this.multicam)
        this.multicam = new EditorMulticam(section, {
          read: () => this.options.session.read(),
          selection: () => ({ sequenceId: this.sequenceId, clipIds: [...this.selected] }),
          time: () => this.playhead,
          apply: (operations, label) => this.apply(operations, label),
          select: ({ sequenceId, clipIds }) => this.selectClips(sequenceId, clipIds),
          resolveAsset: this.options.resolveAsset,
          alignSources: this.options.alignMulticamSources,
          play: async () => {
            if (!this.preview.playing) await this.togglePlayback();
          },
          pause: () => {
            this.cancelPreparation();
            this.preview.pause();
          },
          playing: () => this.preview.playing,
          onError: this.options.onError,
        });
      this.multicam?.setVisible(this.visible && !section.hidden);
      if (!section.hidden) {
        this.multicam?.render();
        section.scrollIntoView({ block: "nearest" });
      }
      return;
    }
    if (action === "sequences") {
      const section = this.get("[data-ew-sequences]");
      section.hidden = !section.hidden;
      if (!section.hidden) {
        this.sequences.render();
        this.multicam?.render();
        section.scrollIntoView({ block: "nearest" });
      }
      return;
    }
    if (action === "captions" && this.options.showCaptions) {
      this.canvasEditor.cancel();
      this.cancelPreparation();
      await this.options.showCaptions(this.sequenceId);
      return;
    }
    if (
      (action === "separate" && this.options.showSeparation) ||
      (action === "enhance-audio" && this.options.showAudioEnhancement)
    ) {
      if (this.selected.length !== 1)
        throw new Error("请先在时间线上选择一个含声音的视频或音频片段");
      const clip = this.sequence().clips.find((item) => item.id === this.selected[0]);
      if (clip?.kind !== "media")
        throw new Error("请选择视频或音频片段；复合片段请进入子序列后选择");
      const asset = this.options.session.read().assets.find((item) => item.id === clip.assetId);
      if (asset?.kind !== "video" && asset?.kind !== "audio")
        throw new Error("声音处理需要真实的视频或音频素材");
      this.canvasEditor.cancel();
      this.cancelPreparation();
      this.preview.pause();
      await (
        action === "separate" ? this.options.showSeparation! : this.options.showAudioEnhancement!
      )(this.sequenceId, clip.id);
      return;
    }
    if (action === "pack-project") {
      await this.options.packProject?.();
      return;
    }
    if (action === "import-project-bundle") {
      await this.options.importProjectBundle?.();
      return;
    }
    if (action === "sync-project") {
      this.canvasEditor.cancel();
      this.cancelPreparation();
      this.preview.pause();
      await this.options.syncProject?.();
      return;
    }
    if (action === "play") return this.togglePlayback();
    if (action === "undo") {
      this.options.assertEditable?.();
      this.options.session.undo();
      return;
    }
    if (action === "redo") {
      this.options.assertEditable?.();
      this.options.session.redo();
      return;
    }
    if (action === "retry-save") return this.options.session.flush();
    if (action === "import") {
      await this.options.importMedia();
      return;
    }
    if (action === "open") {
      await this.options.openProject();
      return;
    }
    if (action === "new") {
      await this.options.newProject();
      return;
    }
    if (action === "download") {
      await this.options.downloadProject(this.options.session.read());
      return;
    }
    if (["production", "captions", "voiceover", "recording", "roughcut"].includes(action)) {
      this.preview.pause();
      this.cancelPreparation();
      await this.options.showProduction(action === "production" ? "ai" : action);
      return;
    }
    if (action === "title") {
      this.addClip(
        {
          kind: "text",
          role: "title",
          text: "输入文字",
          words: [],
          style: defaultTextStyle(),
          duration: secondsToTicks(5),
          label: "文字",
        },
        "text",
      );
      return;
    }
    if (action === "rectangle" || action === "ellipse") {
      this.addClip(
        {
          kind: "shape",
          shape: action,
          fill: "#8fe8ca",
          stroke: "#ffffff",
          strokeWidth: 0,
          duration: secondsToTicks(5),
          label: action === "rectangle" ? "矩形" : "圆形",
          transform: { ...defaultTransform(), scaleX: 0.3, scaleY: 0.3 },
        },
        "video",
      );
      return;
    }
    if (action === "marker") {
      const section = this.get("[data-ew-markers]");
      section.hidden = !section.hidden;
      if (!section.hidden) {
        this.markers.render();
        section.scrollIntoView({ block: "nearest" });
      }
      return;
    }
    if (action === "new-sequence" || action === "sequence-settings")
      return this.sequenceDialog(action === "new-sequence");
    if (action === "export") return this.exportDialog();
  }
  private form(
    title: string,
    content: string,
    submit: (form: HTMLFormElement, signal: AbortSignal) => void | Promise<void>,
    submitLabel = "保存",
    frozenRetry?: () => boolean,
  ): HTMLFormElement {
    this.dialogAbort?.abort();
    this.dialog?.remove();
    const controller = new AbortController();
    this.dialogAbort = controller;
    const dialog = document.createElement("dialog");
    dialog.className = "ew-dialog";
    dialog.innerHTML = `<form><h2>${esc(title)}</h2>${content}<p class="ew-form-error" role="alert"></p><footer><button type="button" data-ew-close>取消</button><button class="ew-primary" type="submit">${submitLabel}</button></footer></form>`;
    const form = dialog.querySelector<HTMLFormElement>("form")!;
    const identity = this.options.session.getState().identity;
    let pending = false;
    dialog.querySelector("[data-ew-close]")!.addEventListener("click", () => {
      controller.abort();
      dialog.close();
    });
    dialog.addEventListener("cancel", () => controller.abort());
    dialog.addEventListener("close", () => {
      controller.abort();
      dialog.remove();
      if (this.dialog === dialog) this.dialog = undefined;
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (pending || !form.reportValidity()) return;
      pending = true;
      form.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled = true;
      this.run(async () => {
        try {
          const current = this.options.session.getState().identity;
          if (!frozenRetry?.() && JSON.stringify(identity) !== JSON.stringify(current))
            throw new Error("工程已变化，请重新打开此设置");
          await submit(form, controller.signal);
          if (!controller.signal.aborted && dialog.isConnected) dialog.close();
        } catch (error) {
          if (controller.signal.aborted || !dialog.isConnected) return;
          form.querySelector(".ew-form-error")!.textContent = panelRuntimeErrorMessage(error);
        } finally {
          pending = false;
          if (dialog.isConnected)
            form.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled = false;
        }
      });
    });
    this.container.append(dialog);
    this.dialog = dialog;
    dialog.showModal();
    return form;
  }
  private sequenceDialog(create: boolean): void {
    const sequence = this.sequence();
    this.form(
      create ? "新建序列" : "画布与帧率",
      `<label>序列名称<input name="name" value="${esc(create ? "新序列" : sequence.name)}" maxlength="200" required></label><div class="ew-form-row"><label>宽度<input name="width" type="number" min="16" max="8192" step="2" value="${sequence.width}" required></label><label>高度<input name="height" type="number" min="16" max="8192" step="2" value="${sequence.height}" required></label></div><label>帧率<select name="rate">${this.rateOptions(sequence.frameRate)}</select></label><label>背景<input name="background" type="color" value="${esc(sequence.background.slice(0, 7))}"></label>`,
      (form) => {
        const data = new FormData(form),
          [numerator, denominator] = String(data.get("rate")).split("/").map(Number);
        const settings = {
          width: Number(data.get("width")),
          height: Number(data.get("height")),
          frameRate: { numerator: numerator!, denominator: denominator! },
          background: String(data.get("background")),
        };
        if (create) {
          const created: EditorSequence = {
            id: uid("sequence"),
            name: String(data.get("name")),
            ...settings,
            timelineMode: "free",
            tracks: [
              createTrack(uid("track"), "video"),
              createTrack(uid("track"), "audio"),
              createTrack(uid("track"), "text"),
            ],
            clips: [],
            transitions: [],
            markers: [],
          };
          this.apply(
            [
              { type: "sequence.add", sequence: created },
              { type: "sequence.activate", sequenceId: created.id },
            ],
            "新建序列",
          );
        } else
          this.apply(
            [
              { type: "sequence.rename", sequenceId: sequence.id, name: String(data.get("name")) },
              { type: "sequence.update", sequenceId: sequence.id, patch: settings },
            ],
            "调整画布与帧率",
          );
      },
    );
  }
  private rateOptions(rate: { numerator: number; denominator: number }): string {
    const selected = `${rate.numerator}/${rate.denominator}`;
    const rates = [
      "24000/1001",
      "24/1",
      "25/1",
      "30000/1001",
      "30/1",
      "48/1",
      "50/1",
      "60000/1001",
      "60/1",
    ];
    if (!rates.includes(selected)) rates.push(selected);
    return rates
      .map((value) => {
        const [n, d] = value.split("/").map(Number);
        return `<option value="${value}" ${value === selected ? "selected" : ""}>${Number((n! / d!).toFixed(3))}</option>`;
      })
      .join("");
  }
  private exportDialog(): void {
    if (!this.options.exportSequence)
      throw new Error("请在已连接本地媒体任务的 CodeShell 视频面板中导出");
    if (this.pendingExport) throw new Error("导出任务正在提交，请稍候");
    const sequence = this.sequence(),
      doc = this.options.session.read(),
      openedIdentity = this.options.session.getState().identity;
    const assertSnapshot = () => {
      if (
        JSON.stringify(openedIdentity) !== JSON.stringify(this.options.session.getState().identity)
      )
        throw new Error("工程已变化，请关闭并重新打开导出设置");
    };
    const presets = [
      ...new Map(
        [...createExportPresets(), ...doc.exportProfiles].map((item) => [item.id, item]),
      ).values(),
    ];
    const preset = presets[0]!;
    let batch: EditorExportBatch | undefined;
    const readProfile = (form: HTMLFormElement) => {
      const data = new FormData(form),
        [numerator, denominator] = String(data.get("rate")).split("/").map(Number),
        [container, videoCodec, audioCodec] = String(data.get("format")).split(":");
      return validateExportProfile({
        ...preset,
        id: "interactive-custom-export",
        name: String(data.get("presetName")),
        width: Number(data.get("width")),
        height: Number(data.get("height")),
        frameRate: { numerator, denominator },
        container,
        videoCodec,
        audioCodec,
        audioBitrate:
          audioCodec === "pcm" ? 1536000 : Math.round(Number(data.get("audioBitrate")) * 1000),
        quality:
          data.get("qualityMode") === "bitrate"
            ? {
                mode: "bitrate",
                bitsPerSecond: Math.round(Number(data.get("videoBitrate")) * 1000000),
              }
            : { mode: "quality", value: Number(data.get("quality")) },
        includeCaptions: data.has("captions"),
      });
    };
    const form = this.form(
      "导出视频",
      `
      <fieldset data-export-settings><legend>成片设置</legend><fieldset data-export-custom>
      <label>载入预设<select name="preset"><option value="">自定义</option>${presets.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("")}</select></label>
      <label>预设名称<input name="presetName" maxlength="200" value="自定义导出" required></label>
      <div class="ew-form-row"><label>宽度<input name="width" type="number" min="16" max="8192" step="2" value="${sequence.width}" required></label><label>高度<input name="height" type="number" min="16" max="8192" step="2" value="${sequence.height}" required></label></div>
      <label>帧率<select name="rate">${this.rateOptions(sequence.frameRate)}</select></label>
      <label>格式<select name="format"><option value="mp4:h264:aac">MP4 · H.264</option><option value="mp4:hevc:aac">MP4 · HEVC</option><option value="webm:vp9:opus">WebM · VP9</option><option value="mov:prores:pcm">MOV · ProRes</option><option value="mov:h264:aac">MOV · H.264</option><option value="mov:hevc:aac">MOV · HEVC</option></select></label>
      <label>视频控制<select name="qualityMode"><option value="quality">画面质量</option><option value="bitrate">目标码率</option></select></label>
      <label data-export-quality>视频质量（0—100）<input name="quality" type="number" min="0" max="100" value="62" required></label>
      <label data-export-bitrate hidden>视频码率（Mbps）<input name="videoBitrate" type="number" min="0.1" max="500" step="0.001" value="12" required disabled></label>
      <label data-export-audio>音频码率（kbps）<input name="audioBitrate" type="number" min="32" max="512" step="1" value="192" required></label>
      <p data-export-pcm hidden>PCM 音频：48 kHz · 16 位 · 立体声</p>
      <label><input name="captions" type="checkbox" checked>包含字幕</label>
      <div class="ew-form-row"><button type="button" data-save-export-preset>保存为工程预设</button><button type="button" data-remove-export-preset disabled>删除所选工程预设</button></div>
      </fieldset><fieldset><legend>导出序列</legend>${doc.sequences.map((item) => `<label><input type="checkbox" name="sequences" value="${esc(item.id)}" ${item.id === sequence.id ? "checked" : ""} ${sequenceDuration(item) ? "" : "disabled"}>${esc(item.name)}${sequenceDuration(item) ? "" : "（空序列）"}</label>`).join("")}</fieldset>
      <fieldset><legend>批量输出格式</legend><label><input type="checkbox" name="custom" checked>使用上方设置</label>${presets.map((item) => `<label><input type="checkbox" name="profiles" value="${esc(item.id)}">${esc(item.name)} · ${item.width} × ${item.height} · ${item.videoCodec.toUpperCase()}</label>`).join("")}</fieldset>
      </fieldset><p data-export-progress role="status">每个所选序列都会按所选格式分别导出。</p>`,
      async (form, signal) => {
        this.pendingExport = true;
        const progressOutput = form.querySelector<HTMLElement>("[data-export-progress]")!;
        progressOutput.textContent = "正在保存工程并准备导出…";
        progressOutput.dataset.submitting = "true";
        try {
          if (!batch) {
            assertSnapshot();
            const data = new FormData(form),
              profiles = presets.filter((item) => data.getAll("profiles").includes(item.id));
            if (data.has("custom")) profiles.unshift(readProfile(form));
            const proposed = new EditorExportBatch(
              doc,
              data.getAll("sequences").map(String),
              profiles,
            );
            await this.options.session.flush();
            if (signal.aborted) return;
            assertSnapshot();
            batch = proposed;
            form.querySelector<HTMLFieldSetElement>("[data-export-settings]")!.disabled = true;
          }
          form.querySelector("[data-ew-close]")!.textContent = "取消剩余提交";
          await batch.submit(this.options.exportSequence!, signal, (progress) => {
            if (!form.isConnected) return;
            progressOutput.textContent =
              `已提交 ${progress.completed}/${progress.total} · ${progress.sequence} · ${progress.profile}` +
              (progress.completed < progress.total
                ? " · 正在准备导出素材并提交任务，大素材可能需要一些时间。取消仅停止剩余提交，已开始的素材复制可能仍会完成。"
                : "");
          });
        } catch (error) {
          if (form.isConnected && !signal.aborted)
            progressOutput.textContent = batch
              ? `提交已停止 · 已提交 ${batch.progress.completed}/${batch.progress.total}`
              : "导出尚未提交";
          throw error;
        } finally {
          delete progressOutput.dataset.submitting;
          this.pendingExport = false;
        }
      },
      "开始导出",
      () => Boolean(batch),
    );
    const input = <T extends HTMLInputElement | HTMLSelectElement = HTMLInputElement>(
      name: string,
    ) => form.elements.namedItem(name) as T;
    const updateControls = () => {
      form.querySelector<HTMLFieldSetElement>("[data-export-custom]")!.disabled =
        !input("custom").checked;
      const pcm = input("format").value === "mov:prores:pcm";
      const mode = input<HTMLSelectElement>("qualityMode");
      mode.querySelector<HTMLOptionElement>('[value="bitrate"]')!.disabled = pcm;
      if (pcm) mode.value = "quality";
      const bitrate = mode.value === "bitrate";
      form.querySelector<HTMLElement>("[data-export-quality]")!.hidden = bitrate;
      form.querySelector<HTMLElement>("[data-export-bitrate]")!.hidden = !bitrate;
      input("quality").disabled = bitrate;
      input("videoBitrate").disabled = !bitrate;
      input("audioBitrate").disabled = pcm;
      input("audioBitrate").max = input("format").value.startsWith("webm") ? "510" : "512";
      form.querySelector<HTMLElement>("[data-export-audio]")!.hidden = pcm;
      form.querySelector<HTMLElement>("[data-export-pcm]")!.hidden = !pcm;
      form.querySelector<HTMLButtonElement>("[data-remove-export-preset]")!.disabled =
        !doc.exportProfiles.some((item) => item.id === input("preset").value);
    };
    form.addEventListener("change", (event) => {
      if ((event.target as HTMLElement).getAttribute("name") === "preset") {
        const chosen = presets.find((item) => item.id === input("preset").value);
        if (chosen) {
          input("presetName").value = chosen.name;
          input("width").value = String(chosen.width);
          input("height").value = String(chosen.height);
          input("rate").innerHTML = this.rateOptions(chosen.frameRate);
          input("format").value = `${chosen.container}:${chosen.videoCodec}:${chosen.audioCodec}`;
          input("qualityMode").value = chosen.quality.mode;
          if (chosen.quality.mode === "quality")
            input("quality").value = String(chosen.quality.value);
          else input("videoBitrate").value = String(chosen.quality.bitsPerSecond / 1000000);
          input("audioBitrate").value = String(chosen.audioBitrate / 1000);
          input("captions").checked = chosen.includeCaptions;
        }
      }
      updateControls();
    });
    const modifyPresets = (remove: boolean) => {
      try {
        if (batch || !form.reportValidity()) return;
        const current = this.options.session.read();
        if (current.id !== doc.id || current.revision !== doc.revision)
          throw new Error("工程已变化，请重新打开导出设置");
        const profiles = remove
          ? current.exportProfiles.filter((item) => item.id !== input("preset").value)
          : [...current.exportProfiles, { ...readProfile(form), id: uid("export") }];
        this.apply(
          [{ type: "project.exportProfiles", profiles }],
          remove ? "删除导出预设" : "保存导出预设",
        );
        this.dialog?.close();
      } catch (error) {
        form.querySelector(".ew-form-error")!.textContent =
          error instanceof Error ? error.message : String(error);
      }
    };
    form
      .querySelector("[data-save-export-preset]")!
      .addEventListener("click", () => modifyPresets(false));
    form
      .querySelector("[data-remove-export-preset]")!
      .addEventListener("click", () => modifyPresets(true));
    updateControls();
  }
  openExport(): void {
    this.run(() => this.exportDialog());
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.cancelPreparation();
    this.audio?.stream?.dispose();
    this.audio = undefined;
    this.dialogAbort?.abort();
    this.dialog?.remove();
    this.timeline.dispose();
    this.inspector.dispose();
    this.timing.dispose();
    this.markers.dispose();
    this.canvasEditor.dispose();
    this.sequences.dispose();
    this.multicam?.dispose();
    this.container.removeEventListener("click", this.click);
    this.container.removeEventListener("change", this.change);
    this.container.removeEventListener("input", this.input);
    this.container.removeEventListener("keydown", this.keydown);
    this.container.removeEventListener("pointerdown", this.activateComposition, true);
    for (const type of this.embeddedEvents)
      this.container.removeEventListener(type, this.stopLegacyEvent);
    await this.preview.dispose();
    this.container.replaceChildren();
  }
}
