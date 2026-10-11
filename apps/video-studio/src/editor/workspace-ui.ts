import { randomId } from "../ids.js";
import { escapeHtml as esc, icon } from "../icons";
import { EditorMarkers } from "./marker-ui";
import { EditorInspector } from "./inspector-ui";
import { EditorTimeline } from "./timeline-ui";
import { EditorPreview, type PreviewAudio } from "./preview";
import {
  EditorSession,
  sameIdentity,
  type SessionIdentity,
  type EditorSessionState,
} from "./session";
import {
  prepareTimelineSnapshot,
  isPreparedTimelineSnapshot,
  type PreparedTimelineSnapshot,
} from "./evaluate";
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
  ticksToFrame,
  ticksToSeconds,
  type Tick,
} from "./time";
import type { EditorMediaPoolOptions } from "./media-pool";
import { applyEditorOperations, type EditorOperation } from "./operations";
import { reconcileEditorProduction } from "./production-guard";
import type { EditorAsset, EditorClip, EditorDocument, EditorSequence } from "./types";
import { MAX_EDITOR_TICK, sequenceDuration } from "./validation";
import { findFreeTrack, planAppendPlacement, planTextPlacement } from "./placement";
import { EditorExportBatch } from "./export-batch";
import { exportRangeLabel, validateExportRange, type ExportRange } from "./export-range";
import { EditorTiming } from "./timing-ui";
import { EditorCanvas } from "./canvas-ui";
import { EditorSequences } from "./sequences-ui";
import { EditorMulticam, type EditorMulticamContext } from "./multicam-ui";
import type { EditorTimelineContext } from "./timeline-ui";
import { panelRuntimeErrorMessage } from "../sdk/panel-runtime";
import { audioMixWarning } from "./audio-mix-report";
import type { PreviewResolution } from "./compositor";
import { resolvePlayheadPosition } from "./playhead-position";

export interface EditorWorkspaceOptions {
  layout?: "standalone" | "embedded";
  showComposition?(): void;
  showShortcuts?(): void | Promise<void>;
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
    range?: ExportRange,
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

const uid = (kind: string) => `${kind}-${randomId()}`;
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
  const value = Math.round(ticksToSeconds(tick) * 100);
  return `${Math.floor(value / 6000)
    .toString()
    .padStart(2, "0")}:${((value % 6000) / 100).toFixed(2).padStart(5, "0")}`;
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
  private documentIdentity = "";
  private playhead = 0;
  /** The playhead sits on an exact clip start (not a frame boundary) that re-seeks keep. */
  private exactPlayhead = false;
  private search = "";
  private visible = true;
  private sourcePreview = false;
  private disposed = false;
  private preparing?: AbortController;
  /** Task start can wait minutes without progress while the Host copies originals. */
  private preparationClock?: { started: number; timer: ReturnType<typeof setInterval> };
  private audio?: PreviewAudio;
  /** Includes the session generation, so restoring the same revision cannot reuse old media. */
  private preparedRevision = "";
  private dialog?: HTMLDialogElement;
  private dialogAbort?: AbortController;
  private pendingExport = false;
  /** Shared only during the synchronous, read-only view update for one preview frame. */
  private frameDocument?: EditorDocument;
  private timelineSnapshot?: PreparedTimelineSnapshot;
  private timelineSnapshotIdentity?: SessionIdentity;

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
      <section class="ew-viewer" aria-label="视频预览"><div class="ew-canvas-wrap"><canvas data-ew-canvas aria-label="当前画面"></canvas><p data-ew-preview-error hidden role="status"></p></div><p data-ew-font-warning hidden role="status"></p><p data-ew-audio-warning hidden role="status"></p><div class="ew-player">${button("play", "播放", 'aria-label="播放"')}<button type="button" data-ew-time data-ew-action="jump-playhead" aria-label="定位播放头" title="输入秒数或帧序号定位">00:00.00</button><input data-ew-seek type="range" min="0" max="0" value="0" step="1" aria-label="播放位置"><output data-ew-duration>00:00.00</output><span data-ew-fps></span><select data-ew-quality aria-label="预览质量" title="仅影响预览，工程和导出尺寸保持不变"><option value="1">原始质量</option><option value="0.5">1/2 质量</option><option value="0.25">1/4 质量</option></select></div></section>
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
    const read = () => this.frameDocument ?? options.session.read();
    const apply = (operations: EditorOperation[], label: string) => {
      this.apply(operations, label);
    };
    const editVoiceover = options.editVoiceover;
    this.inspector = new EditorInspector(this.get("[data-ew-inspector]"), {
      read,
      identity: () => options.session.getState().identity,
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
      identity: () => options.session.getState().identity,
      selection,
      apply,
      time: () => this.playhead,
      onError: options.onError,
    });
    this.sequences = new EditorSequences(this.get("[data-ew-sequences]"), {
      read,
      identity: () => options.session.getState().identity,
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
      seek: (time) => this.seek(time, true),
      onSelection: () => this.timeline?.render(),
      onError: options.onError,
    });
    this.timeline = new EditorTimeline(this.get("[data-ew-timeline]"), {
      beforeGesture: (signal) => this.inspector.finishFocusedField(signal) ?? true,
      read,
      identity: () => options.session.getState().identity,
      prepareMediaSnapshot: (document, identity) => this.prepareTimelineMedia(document, identity),
      selection,
      apply,
      applyClipboard: async (operations, label) => {
        this.options.assertEditable?.();
        const identity = options.session.getState().identity,
          before = options.session.read(),
          after = applyEditorOperations(before, operations, identity.revision);
        await options.session.dispatchDurable(
          [...operations, ...reconcileEditorProduction(before, after)],
          identity,
          label,
        );
      },
      time: () => this.playhead,
      seek: (time, exact) => this.seek(time, exact),
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
      addText: () => this.addText(),
      showShortcuts: options.showShortcuts,
      onError: options.onError,
    });
    this.preview = new EditorPreview(this.get<HTMLCanvasElement>("[data-ew-canvas]"), {
      resolveAsset: options.resolveAsset,
      onFrame: (time) => {
        if (time !== this.playhead) this.exactPlayhead = false;
        this.playhead = time;
        this.updateTime();
        this.timeline.updatePlayhead();
        this.renderFrameViews();
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
      beforeGesture: (signal) => this.inspector.finishFocusedField(signal) ?? this.timeline.finishFocusedField(signal) ?? true,
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
        document
          ? this.preview.previewDraft(document)
          : this.preview.seek(this.playhead, { exact: this.exactPlayhead }),
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

  private renderFrameViews(): void {
    const previous = this.frameDocument;
    this.frameDocument = this.options.session.read();
    try {
      this.inspector.renderFrame();
      this.timing.render();
      this.sequences.render();
      this.canvasEditor?.render();
    } finally {
      this.frameDocument = previous;
    }
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
  private releaseTimelineMedia(): void {
    const snapshot = this.timelineSnapshot;
    this.timelineSnapshot = undefined;
    this.timelineSnapshotIdentity = undefined;
    snapshot?.dispose();
  }
  private prepareTimelineMedia(
    document: EditorDocument,
    identity: SessionIdentity,
  ): PreparedTimelineSnapshot {
    if (!sameIdentity(identity, this.options.session.getState().identity))
      throw new Error("时间线工程已变更，请重试媒体预览");
    if (
      !sameIdentity(identity, this.timelineSnapshotIdentity) ||
      !isPreparedTimelineSnapshot(this.timelineSnapshot)
    ) {
      this.releaseTimelineMedia();
      this.timelineSnapshot = prepareTimelineSnapshot(document, identity);
      this.timelineSnapshotIdentity = { ...identity };
    }
    return this.timelineSnapshot;
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
    for (const [name, label, available, shortcut] of [
      ["undo", "撤销", state.canUndo, "⌘/Ctrl Z"],
      ["redo", "重做", state.canRedo, "⇧ ⌘/Ctrl Z"],
    ] as const) {
      const control = this.get<HTMLButtonElement>(`[data-ew-action="${name}"]`);
      control.disabled = !available || state.phase !== "ready";
      control.title = control.disabled
        ? `${label}（${state.phase !== "ready" ? "工程正在保存或切换，请稍候" : `没有可${label}的操作`}）`
        : `${label} · ${shortcut}`;
    }
    if (state.error?.stage === "commit") save.textContent = "候选保存失败，请重试原操作";
    this.get('[data-ew-action="retry-save"]').hidden =
      state.saveState !== "failed" || state.error?.stage === "commit";
    const signature = `${state.identity.documentId}:${state.identity.generation}:${state.identity.revision}`;
    if (signature === this.revision) return;
    this.releaseTimelineMedia();
    this.revision = signature;
    const documentIdentity = JSON.stringify([state.identity.documentId, state.identity.generation]),
      opened = this.documentIdentity !== documentIdentity;
    this.documentIdentity = documentIdentity;
    this.canvasEditor.refreshDocument();
    const doc = this.options.session.read();
    this.sequenceId = doc.activeSequenceId;
    const sequence = this.sequence();
    this.selected = this.selected.filter((id) => sequence.clips.some((clip) => clip.id === id));
    this.cancelPreparation();
    this.audio?.stream?.dispose();
    this.audio = undefined;
    this.preparedRevision = "";
    this.clearAudioWarning();
    this.preview.setDocument(doc, sequence.id);
    this.playhead = Math.min(this.playhead, Math.max(0, sequenceDuration(sequence) - 1));
    const name = this.get<HTMLInputElement>("[data-ew-project-name]");
    if (opened || document.activeElement !== name) name.value = doc.name;
    this.get("[data-ew-sequence]").innerHTML = doc.sequences
      .map(
        (s) =>
          `<option value="${esc(s.id)}" ${s.id === sequence.id ? "selected" : ""}>${esc(s.name)}</option>`,
      )
      .join("");
    this.get("[data-ew-duration]").textContent = timeLabel(sequenceDuration(sequence));
    this.get<HTMLButtonElement>("[data-ew-time]").disabled = !sequenceDuration(sequence);
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
    const control = this.get("[data-ew-time]"),
      label = timeLabel(this.playhead);
    control.textContent = label;
    control.setAttribute("aria-label", `定位播放头，当前 ${label}`);
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
    if (this.preparing) this.clearAudioWarning();
    this.preparing?.abort();
    this.preparing = undefined;
    this.clearPreparationStatus();
    this.preview?.pause();
    this.updatePlayButton(false);
  }
  private previewError(error: unknown): void {
    if (this.disposed) return;
    this.preparedRevision = "";
    this.audio?.stream?.dispose();
    this.audio = undefined;
    this.clearAudioWarning();
    const output = this.get("[data-ew-preview-error]");
    delete output.dataset.previewPreparing;
    delete output.dataset.audioBuffering;
    output.hidden = false;
    output.textContent = panelRuntimeErrorMessage(error);
  }
  private clearAudioWarning(): void {
    const output = this.get("[data-ew-audio-warning]");
    output.textContent = "";
    output.hidden = true;
  }
  private preparationStatus(controller: AbortController, message: string): void {
    if (this.disposed || this.preparing !== controller || controller.signal.aborted) return;
    this.preparationClock ??= {
      started: Date.now(),
      timer: setInterval(() => this.preparationElapsed(), 1000),
    };
    const output = this.get("[data-ew-preview-error]");
    delete output.dataset.audioBuffering;
    output.hidden = false;
    if (output.dataset.previewPreparing && output.firstChild?.textContent === message) return;
    output.dataset.previewPreparing = "true";
    // The status sentence is announced when it changes; the ticking wait time stays silent.
    const elapsed = document.createElement("span");
    elapsed.dataset.ewPreviewElapsed = "";
    elapsed.setAttribute("aria-hidden", "true");
    output.replaceChildren(
      message,
      elapsed,
      " 再次点击播放按钮可取消等待；已开始的素材复制可能仍会完成。",
    );
    this.preparationElapsed();
  }
  private preparationElapsed(): void {
    const clock = this.preparationClock,
      elapsed = this.container.querySelector("[data-ew-preview-elapsed]");
    if (!clock || !elapsed) return;
    const seconds = Math.floor((Date.now() - clock.started) / 1000),
      text =
        seconds < 5
          ? ""
          : `（已等待 ${seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, "0")} 秒`}）`;
    if (elapsed.textContent !== text) elapsed.textContent = text;
  }
  private clearPreparationStatus(): void {
    clearInterval(this.preparationClock?.timer);
    this.preparationClock = undefined;
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
  /**
   * `exact` keeps a tick between frames (a new clip's start) instead of showing the frame that
   * contains it, which would still be the previous clip. Re-seeking the same spot keeps it.
   */
  async seek(time: Tick, exact = this.exactPlayhead && time === this.playhead): Promise<void> {
    if (this.disposed) return;
    if (time === this.playhead) this.canvasEditor?.refreshDocument();
    else this.canvasEditor?.cancel();
    this.cancelPreparation();
    this.playhead = time;
    this.exactPlayhead = exact;
    this.updateTime();
    try {
      await this.preview.seek(time, { exact });
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
      const preparedCurrent = this.preparedRevision === signature;
      if (!preparedCurrent) this.clearAudioWarning();
      const prepared = preparedCurrent
        ? this.audio
        : (this.audio ??
          (await this.options.prepareAudio?.(doc, sequenceId, controller.signal, (message) =>
            this.preparationStatus(controller, message),
          )));
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
      // Validate the measurements before starting Web Audio, so a bad report cannot
      // leave playback running behind an error or publish a warning for another mix.
      const warning = this.audio?.mix ? audioMixWarning(this.audio.mix) : "";
      if (
        this.audio?.mix &&
        this.audio.mix.sampleCount !== (this.audio.stream?.sampleCount ?? this.audio.buffer?.length)
      )
        throw new Error("混音测量与声音长度不一致，请重新准备声音");
      this.preparationStatus(controller, "正在载入画面并同步声音…");
      // Natural completion reports the duration; a manual last-frame seek stays below it.
      const ended = this.playhead >= sequenceDuration(this.sequence());
      // Resource preparation may replace an incompatible source with a verified preview proxy.
      // Once that preparation played successfully, pause/resume keeps its decoders and mix.
      if (!preparedCurrent) this.preview.setDocument(doc, sequenceId);
      const target = ended ? 0 : this.playhead;
      if (this.preview.time !== target)
        await this.preview.seek(target, { exact: !ended && this.exactPlayhead });
      if (
        controller.signal.aborted ||
        signature !== this.revision ||
        this.disposed ||
        !this.visible
      )
        return;
      await this.preview.play(this.audio);
      if (
        !controller.signal.aborted &&
        signature === this.revision &&
        !this.disposed &&
        this.visible &&
        this.preview.playing
      ) {
        this.preparedRevision = signature;
        const output = this.get("[data-ew-audio-warning]");
        if (output.textContent !== warning) output.textContent = warning;
        output.hidden = !warning;
      }
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
    if (this.disposed) return;
    this.releaseTimelineMedia();
    this.cancelPreparation();
    this.clearAudioWarning();
    this.audio?.stream?.dispose();
    this.audio = undefined;
    this.preparedRevision = "";
    // Resource URLs may change while the document identity stays exactly the same.
    this.preview.setDocument(this.options.session.read(), this.sequenceId);
    this.timeline.refreshMedia();
    if (this.visible && !this.sourcePreview) this.run(() => this.seek(this.playhead));
  }
  /** Browsing source footage replaces the monitor, while the canonical timeline stays mounted. */
  setSourcePreview(active: boolean): void {
    if (this.sourcePreview === active || this.disposed) return;
    this.sourcePreview = active;
    if (active) {
      this.cancelPreparation();
      this.clearAudioWarning();
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
    if (id) this.timeline.reveal(id);
  }

  private track(
    kind: "video" | "audio" | "text",
    start: Tick,
    duration: Tick,
  ): { id: string; operations: EditorOperation[] } {
    const { trackId, operations } = findFreeTrack(this.sequence(), kind, start, duration, uid);
    return { id: trackId, operations };
  }
  /**
   * Adds material to the shown sequence. Without an explicit time or track (the material "+"),
   * picture continues the main picture track and sound the first audio track; `anchor:
   * "playhead"` inserts at the playhead on a free track instead. Drops pass their exact spot.
   */
  addAsset(
    assetId: string,
    placement: { at?: Tick; trackId?: string; anchor?: "end" | "playhead" } = {},
  ): void {
    const asset = this.options.session.read().assets.find((a) => a.id === assetId);
    if (!asset) throw new Error("素材已移除，请刷新后重试");
    const duration = asset.kind === "image" ? secondsToTicks(5) : asset.duration;
    if (!duration) throw new Error("素材长度尚未确认，请先完成素材准备");
    let kind: "video" | "audio" = asset.kind === "audio" ? "audio" : "video";
    const append =
      placement.at === undefined &&
      placement.trackId === undefined &&
      placement.anchor !== "playhead"
        ? planAppendPlacement(this.sequence(), kind, uid)
        : undefined;
    const at = append?.start ?? placement.at ?? this.playhead;
    if (!Number.isSafeInteger(at) || at < 0) throw new Error("片段落点必须是有效时间");
    if (!Number.isSafeInteger(at + duration)) throw new Error("片段落点超出时间范围");
    // Appending past the editor's time range would only fail later with a technical message.
    if (append && at + duration > MAX_EDITOR_TICK)
      throw new Error("加入素材后超出时长上限（24 小时）");
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
      append
        ? { at, trackId: append.trackId, operations: append.operations }
        : { at, ...(placement.trackId === undefined ? {} : { trackId: placement.trackId }) },
    );
  }
  /**
   * Adds a 3-second title at the playhead on a text track above every picture, then opens its
   * wording in the inspector.
   */
  addText(): void {
    const at = this.playhead,
      duration = secondsToTicks(3);
    const { trackId, operations } = planTextPlacement(this.sequence(), at, duration, uid);
    this.addClip(
      {
        kind: "text",
        role: "title",
        text: "输入文字",
        words: [],
        style: defaultTextStyle(),
        duration,
        label: "文字",
      },
      "text",
      { at, trackId, operations },
    );
    this.inspector.editText();
  }
  private addClip(
    value: Partial<EditorClip> & { duration: Tick; label: string },
    kind: "video" | "audio" | "text",
    placement: { at?: Tick; trackId?: string; operations?: EditorOperation[] } = {},
  ): void {
    const at = placement.at ?? this.playhead;
    const track = placement.trackId
      ? { id: placement.trackId, operations: placement.operations ?? [] }
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
    this.run(() => this.seek(at, true));
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
    // seek() pauses immediately and supersedes older decodes, so playback cannot move the thumb.
    if (target.matches("[data-ew-seek]")) this.run(() => this.seek(Number(target.value)));
    if (target.matches("[data-ew-search]")) {
      this.search = target.value;
      this.renderAssets();
    }
  };
  private change = (event: Event) => {
    const target = event.target as HTMLInputElement;
    if (target.matches("[data-ew-quality]"))
      this.run(async () => {
        this.canvasEditor.cancel();
        this.cancelPreparation();
        try {
          const drawn = await this.preview.setResolution(
            Number(target.value) as PreviewResolution,
            this.playhead,
          );
          if (drawn && !this.disposed && !this.preparing)
            this.get("[data-ew-preview-error]").hidden = true;
        } catch (error) {
          this.previewError(error);
          throw error;
        }
      });
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
      if (!event.repeat) this.run(() => this.togglePlayback());
    }
  };
  private async action(action: string): Promise<void> {
    if (action === "multicam") {
      const section = this.get("[data-ew-multicam]");
      section.hidden = !section.hidden;
      if (!section.hidden && !this.multicam)
        this.multicam = new EditorMulticam(section, {
          identity: () => this.options.session.getState().identity,
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
      this.addText();
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
    if (action === "jump-playhead") return this.playheadDialog();
    if (action === "export") return this.exportDialog();
  }
  private playheadDialog(): void {
    this.cancelPreparation();
    const sequence = this.sequence(),
      duration = sequenceDuration(sequence),
      identity = this.options.session.getState().identity,
      current = Math.min(this.playhead, Math.max(0, duration - 1));
    const owns = () => !this.disposed && this.sequenceId === sequence.id &&
      JSON.stringify(this.options.session.getState().identity) === JSON.stringify(identity);
    const form = this.form(
      "定位播放头",
      `<p>在「${esc(sequence.name)}」中定位；帧序号从 0 开始，按 ${formatFrameRate(sequence.frameRate)} fps 计算。</p><label>定位单位<select name="positionUnit" aria-label="定位单位"><option value="seconds">秒数</option><option value="frames">帧序号</option></select></label><label>定位位置<input name="position" type="number" min="0" step="any" value="${ticksToSeconds(current).toFixed(6)}" required></label><p data-position-hint>秒数支持小数。定位会暂停播放，不改变片段或选择。</p>`,
      async (form, signal) => {
        if (!owns()) throw new Error("工程或序列已变化，请重新打开定位设置");
        const data = new FormData(form),
          time = resolvePlayheadPosition(String(data.get("position")), String(data.get("positionUnit")), sequence.frameRate, duration);
        await this.seek(time, true);
        if (!signal.aborted && owns()) this.timeline.revealPlayhead();
      },
      "定位",
    );
    const input = form.querySelector<HTMLInputElement>('[name="position"]')!,
      unit = form.querySelector<HTMLSelectElement>('[name="positionUnit"]')!,
      hint = form.querySelector<HTMLElement>("[data-position-hint]")!;
    let previousUnit = unit.value;
    unit.addEventListener("change", () => {
      try {
        const target = resolvePlayheadPosition(input.value, previousUnit, sequence.frameRate, duration);
        input.value = unit.value === "frames"
          ? String(ticksToFrame(target, sequence.frameRate, "floor"))
          : ticksToSeconds(target).toFixed(6);
      } catch { /* Keep an invalid draft visible so the user can correct it. */ }
      previousUnit = unit.value;
      input.step = unit.value === "frames" ? "1" : "any";
      hint.textContent = unit.value === "frames"
        ? `帧序号从 0 开始；切换单位取输入时间所在帧。当前帧 ${ticksToFrame(current, sequence.frameRate, "floor")}，末帧 ${duration ? ticksToFrame(duration - 1, sequence.frameRate, "floor") : "无"}。定位会暂停播放。`
        : "秒数支持小数。定位会暂停播放，不改变片段或选择。";
    });
    input.focus();
    input.select();
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
    dialog.setAttribute("aria-labelledby", "ew-dialog-title");
    dialog.innerHTML = `<form><h2 id="ew-dialog-title">${esc(title)}</h2>${content}<p class="ew-form-error" role="alert"></p><footer><button type="button" data-ew-close>取消</button><button class="ew-primary" type="submit">${submitLabel}</button></footer></form>`;
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
    const submitForm = () => {
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
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitForm();
    });
    // An opaque Host iframe deliberately forbids native form submission. Handle
    // the activation before its default action, keeping validity and busy guards.
    form.querySelector('[type="submit"]')!.addEventListener("click", (event) => {
      event.preventDefault();
      submitForm();
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
      session = this.options.session,
      doc = session.read(),
      openedIdentity = session.getState().identity;
    const assertOwner = () => {
      const current = this.options.session.getState().identity;
      if (
        this.options.session !== session ||
        openedIdentity.documentId !== current.documentId ||
        openedIdentity.generation !== current.generation
      )
        throw new Error("工程已切换或恢复，请关闭并重新打开导出设置");
    };
    const assertSnapshot = () => {
      assertOwner();
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
    const ranges = sequence.markers.filter((marker) => marker.duration > 0);
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
    // The preview and submission read one selection, including range-only sequence ownership.
    const readSelection = (form: HTMLFormElement) => {
      const data = new FormData(form),
        profiles = presets.filter((item) => data.getAll("profiles").includes(item.id)),
        marker = ranges.find((item) => item.id === data.get("range"));
      if (data.has("custom")) profiles.unshift(readProfile(form));
      if (data.get("range") && !marker) throw new Error("所选导出范围已不存在");
      const sequenceIds = marker ? [sequence.id] : data.getAll("sequences").map(String),
        selectedSequences = sequenceIds.map((id) => {
          const item = doc.sequences.find((sequence) => sequence.id === id);
          if (!item) throw new Error("所选序列已不存在");
          if (!sequenceDuration(item)) throw new Error(`序列“${item.name}”没有可导出的内容`);
          return item;
        });
      if (!sequenceIds.length) throw new Error("请选择要导出的序列");
      if (new Set(sequenceIds).size !== sequenceIds.length) throw new Error("请选择不同的导出序列");
      if (!profiles.length) throw new Error("请选择上方设置或至少一种导出预设");
      if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length)
        throw new Error("请选择不同的导出预设");
      if (sequenceIds.length * profiles.length > 512)
        throw new Error("每批最多提交 512 个成片，请分批选择");
      const range = marker
        ? validateExportRange(
            { start: marker.time, duration: marker.duration },
            sequenceDuration(sequence),
          )
        : undefined;
      return { sequenceIds, selectedSequences, profiles, marker, range };
    };
    const form = this.form(
      "导出视频",
      `
      <section class="ew-export-summary"><strong>本次导出</strong><output data-export-summary role="status" aria-label="导出摘要"></output></section>
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
      </fieldset><fieldset><legend>导出范围</legend><label>范围<select name="range"><option value="">完整所选序列</option>${ranges.map((marker) => `<option value="${esc(marker.id)}"${marker.time + marker.duration > sequenceDuration(sequence) ? " disabled" : ""}>${esc(marker.name)} · ${timeLabel(marker.time)} — ${timeLabel(marker.time + marker.duration)}${marker.time + marker.duration > sequenceDuration(sequence) ? "（超出序列时长）" : ""}</option>`).join("")}</select></label><p>范围标记只导出当前序列的这一段。可先在“标记与范围”中添加范围。</p><p data-export-range-hint hidden>仍需准备完整序列的素材与声音，长序列可能需要较长时间。</p></fieldset><fieldset><legend>导出序列</legend>${doc.sequences.map((item) => `<label><input type="checkbox" name="sequences" value="${esc(item.id)}" ${item.id === sequence.id ? "checked" : ""} ${sequenceDuration(item) ? "" : "disabled"}>${esc(item.name)}${sequenceDuration(item) ? "" : "（空序列）"}</label>`).join("")}</fieldset>
      <fieldset><legend>批量输出格式</legend><label><input type="checkbox" name="custom" checked>使用上方设置</label>${presets.map((item) => `<label><input type="checkbox" name="profiles" value="${esc(item.id)}">${esc(item.name)} · ${item.width} × ${item.height} · ${item.videoCodec.toUpperCase()}</label>`).join("")}</fieldset>
      </fieldset><p data-export-progress role="status">每个所选序列都会按所选格式分别导出。</p>`,
      async (form, signal) => {
        this.pendingExport = true;
        const progressOutput = form.querySelector<HTMLElement>("[data-export-progress]")!;
        progressOutput.textContent = "正在保存工程并准备导出…";
        progressOutput.dataset.submitting = "true";
        try {
          assertOwner();
          if (!batch) {
            assertSnapshot();
            const selected = readSelection(form);
            const proposed = new EditorExportBatch(
              doc,
              selected.sequenceIds,
              selected.profiles,
              selected.range,
            );
            await this.options.session.flush();
            if (signal.aborted) return;
            assertSnapshot();
            batch = proposed;
            form.querySelector<HTMLFieldSetElement>("[data-export-settings]")!.disabled = true;
          }
          form.querySelector("[data-ew-close]")!.textContent = "取消剩余提交";
          await batch.submit(
            (document, sequenceId, profile, signal, range) => {
              assertOwner();
              return this.options.exportSequence!(document, sequenceId, profile, signal, range);
            },
            signal,
            (progress) => {
              if (!form.isConnected) return;
              progressOutput.textContent =
                `已提交 ${progress.completed}/${progress.total} · ${progress.sequence} · ${progress.profile}` +
                (progress.completed < progress.total
                  ? " · 正在准备导出素材并提交任务，大素材可能需要一些时间。取消仅停止剩余提交，已开始的素材复制可能仍会完成。"
                  : "");
            },
          );
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
    let rangeActive = false;
    let fullSequenceSelection = new Set([sequence.id]);
    const updateSummary = () => {
      if (batch) return;
      const summary = form.querySelector<HTMLElement>("[data-export-summary]")!;
      try {
        const invalid = [...form.elements].find(
          (field) =>
            (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) &&
            field.willValidate &&
            !field.validity.valid,
        ) as HTMLInputElement | HTMLSelectElement | undefined;
        if (invalid)
          throw new Error(
            `请检查${invalid.labels?.[0]?.firstChild?.textContent?.trim() || "导出设置"}`,
          );
        const selected = readSelection(form);
        summary.textContent = [
          `${selected.sequenceIds.length} 个序列：${selected.selectedSequences.map((item) => item.name).join("、")}`,
          selected.range
            ? `范围：${sequence.name} · ${selected.marker!.name} · ${exportRangeLabel(selected.range)}`
            : "范围：完整所选序列",
          "每个序列输出：",
          ...selected.profiles.map(
            (profile) =>
              `${profile.name} · ${profile.width} × ${profile.height} · ${profile.container.toUpperCase()} / ${profile.videoCodec.toUpperCase()} · ${formatFrameRate(profile.frameRate)} fps`,
          ),
          `共 ${selected.sequenceIds.length * selected.profiles.length} 个成片`,
        ].join("\n");
        delete summary.dataset.pending;
      } catch (error) {
        summary.textContent = `待补充：${error instanceof Error ? error.message : String(error)}`;
        summary.dataset.pending = "true";
      }
    };
    const updateControls = () => {
      const selectedRange = Boolean(input("range").value);
      const choices = [...form.querySelectorAll<HTMLInputElement>('input[name="sequences"]')];
      form.querySelector<HTMLElement>("[data-export-range-hint]")!.hidden = !selectedRange;
      if (selectedRange && !rangeActive)
        fullSequenceSelection = new Set(choices.filter((choice) => choice.checked).map((choice) => choice.value));
      for (const choice of choices) {
        if (selectedRange) choice.checked = choice.value === sequence.id;
        else if (rangeActive) choice.checked = fullSequenceSelection.has(choice.value);
        choice.disabled = selectedRange || !sequenceDuration(doc.sequences.find((item) => item.id === choice.value)!);
      }
      rangeActive = selectedRange;
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
      updateSummary();
    };
    form.addEventListener("input", updateSummary);
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
    this.releaseTimelineMedia();
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
