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
import { trackAuditionDocument, clipGainAuditionDocument } from "./audio-audition";
import { resolvePlayheadPosition } from "./playhead-position";

export interface EditorWorkspaceOptions {
  layout?: "standalone" | "embedded";
  /** View-only preference; the provider serializes saves across mounted workspaces. */
  previewQuality?: {
    load(): unknown | Promise<unknown>;
    save(value: PreviewResolution): unknown | Promise<unknown>;
  };
  showComposition?(): void;
  showInspector?(): void;
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
    purpose?: "audition",
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
  /** Download an already completed PNG; this does not export or mutate the project. */
  downloadFrame?(blob: Blob, name: string): void;
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

interface ViewReadScope {
  document: EditorDocument;
  identity: SessionIdentity;
  sequenceId: string;
  selected: string[];
  time: Tick;
}
interface ExportOpeningOwner {
  session: EditorSession;
  controller: AbortController;
  identity: SessionIdentity;
  sequenceId: string;
  selection: string;
  time: Tick;
  finishing: boolean;
}
interface FrameCaptureOwner {
  controller: AbortController;
  identity: SessionIdentity;
  sequenceId: string;
  selection: string;
  time: Tick;
  quality: string;
  finishing: boolean;
}

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
  private loopPlayback = false;
  private loopReplay?: symbol;
  private disposed = false;
  private previewQualityInteracted = false;
  private preparing?: AbortController;
  /** Task start can wait minutes without progress while the Host copies originals. */
  private preparationClock?: { started: number; timer: ReturnType<typeof setInterval> };
  private audio?: PreviewAudio;
  private soloTracks = new Set<string>();
  private auditionSequence = "";
  private gainAudition?: { clipId: string; volume: number; delta?: number; audio?: PreviewAudio };
  private auditionEpoch = 0;
  private gainOpening?: ExportOpeningOwner;
  private gainSeeking?: ExportOpeningOwner;
  /** Includes the session generation, so restoring the same revision cannot reuse old media. */
  private preparedRevision = "";
  private dialog?: HTMLDialogElement;
  private dialogAbort?: AbortController;
  private pendingExport = false;
  private exportOpening?: ExportOpeningOwner;
  private exportOpeningEpoch = 0;
  private exportComposition?: EventTarget;
  private frameCapture?: FrameCaptureOwner;
  private frameCaptureSize?: { width: number; height: number; duration: Tick };
  /** One detached document for a synchronous, read-only batch; never retained between batches. */
  private viewReadScope?: ViewReadScope;
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
      <section class="ew-viewer" aria-label="视频预览"><div class="ew-canvas-wrap"><canvas data-ew-canvas aria-label="当前画面"></canvas><p data-ew-preview-error hidden role="status"></p></div><p data-ew-font-warning hidden role="status"></p><p data-ew-audio-warning hidden role="status"></p><p data-ew-audition-status hidden role="status"></p><div class="ew-player">${button("play", "播放", 'aria-label="播放"')}${button("gain-audition", "调音试听", 'aria-pressed="false" title="选择固定音量的片段，准备后拖动音量线可实时试听"')}${button("clear-solo", "结束独轨试听", 'hidden')}${button("loop-playback", "循环播放", 'aria-pressed="false" title="播放到当前序列末尾后从头继续"')}<button type="button" data-ew-time data-ew-action="jump-playhead" aria-label="定位播放头" title="输入秒数或帧序号定位">00:00.00</button><input data-ew-seek type="range" min="0" max="0" value="0" step="1" aria-label="播放位置"><output data-ew-duration>00:00.00</output><span data-ew-fps></span><select data-ew-quality aria-label="预览质量" title="仅影响预览，工程和导出尺寸保持不变"><option value="1">原始质量</option><option value="0.5">1/2 质量</option><option value="0.25">1/4 质量</option></select>${options.downloadFrame ? button("save-frame", "保存已应用画面 PNG", 'aria-label="保存已应用画面 PNG"') : ""}</div></section>
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
    const read = () => this.readViewDocument();
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
      seek: async (time) => {
        const identity = { ...options.session.getState().identity }, sequenceId = this.sequenceId;
        await this.seek(time, true);
        if (!this.disposed && sameIdentity(identity, options.session.getState().identity) &&
          this.sequenceId === sequenceId && this.playhead === time) this.timeline.revealPlayhead();
      },
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
      beforeEdit: (signal) => this.inspector.finishFocusedField(signal) ?? true,
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
      soloTracks: () => this.soloTracks,
      toggleSolo: (trackId) => this.toggleSolo(trackId),
      previewGain: (clipId, volume) => {
        const audition = this.gainAudition;
        if (!audition || audition.clipId !== clipId || !audition.audio || !this.preview.playing) return false;
        audition.delta = volume - audition.volume;
        this.preview.setAuditionGain(audition.delta);
        return true;
      },
      endGainPreview: () => {
        if (this.gainAudition) this.gainAudition.delta = 0;
        this.preview.setAuditionGain(0);
      },
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
        this.cancelFrameCapture();
        if (JSON.stringify(this.selected) !== JSON.stringify(ids)) this.clearGainAudition();
        this.selected = ids;
        this.withReadSnapshot(() => {
          this.updateAuditionControls();
          this.inspector.render();
          this.timing.render();
          this.sequences.render();
          this.multicam?.render();
          this.canvasEditor?.render();
        });
      },
      selectedMarker: () => this.markers.selected,
      canTrimAtPlayhead: (time) => !this.disposed && this.visible && !this.sourcePreview && this.playhead === time,
      canEditText: (time) => {
        const state = options.session.getState();
        return state.phase === "ready" && !this.disposed && this.visible && !this.sourcePreview && this.playhead === time;
      },
      editText: (clipId, current) => {
        if (this.selected.length !== 1 || this.selected[0] !== clipId) return;
        const identity = { ...options.session.getState().identity }, sequenceId = this.sequenceId,
          time = this.playhead, selection = JSON.stringify(this.selected),
          owns = () => {
            const latest = options.session.getState().identity;
            return current() && !this.disposed && this.visible && !this.sourcePreview &&
              this.sequenceId === sequenceId && this.playhead === time &&
              JSON.stringify(this.selected) === selection && sameIdentity(identity, latest);
          };
        if (!owns()) return;
        options.showInspector?.();
        if (owns()) this.inspector.editText(owns);
      },
      beginMarker: (kind) => {
        if (this.disposed || !this.visible || this.sourcePreview) return;
        const identity = this.options.session.getState().identity, sequenceId = this.sequenceId,
          time = this.playhead, selection = JSON.stringify(this.selected);
        this.options.showInspector?.();
        const currentIdentity = this.options.session.getState().identity;
        if (this.disposed || !this.visible || this.sourcePreview || this.sequenceId !== sequenceId ||
          this.playhead !== time || JSON.stringify(this.selected) !== selection ||
          !sameIdentity(identity, currentIdentity)) return;
        const section = this.get("[data-ew-markers]");
        section.hidden = false;
        this.markers.beginShortcut(kind);
        if (!this.disposed) section.scrollIntoView({ block: "nearest" });
      },
      canNavigateMarkers: (time) => {
        const state = this.options.session.getState();
        return state.phase === "ready" && !this.disposed && this.visible && !this.sourcePreview && this.playhead === time;
      },
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
        const revision = this.revision,
          replay = this.loopPlayback && !this.preview.playing ? Symbol() : undefined;
        if (replay) this.loopReplay = replay;
        if (time !== this.playhead) { this.cancelExportOpening(); this.exactPlayhead = false; }
        this.playhead = time;
        this.timeline.updatePlayhead();
        this.updateTime();
        this.updateFrameCaptureControl();
        this.renderFrameViews();
        this.queueLoopReplay(time, revision, replay);
      },
      onPlaybackChange: (playing) => {
        this.timeline.setPlaybackActive(playing);
        this.updatePlayButton(playing);
      },
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
        this.cancelFrameCapture();
        if (JSON.stringify(this.selected) !== JSON.stringify(ids)) this.clearGainAudition();
        this.selected = ids;
        this.updateAuditionControls();
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
    window.addEventListener("keydown", this.exportEntryKeydown, true);
    window.addEventListener("blur", this.exportEntryBlur);
    container.addEventListener("pointerdown", this.exportEntryDown, true);
    container.addEventListener("compositionstart", this.exportCompositionStart, true);
    container.addEventListener("compositionend", this.exportCompositionEnd, true);
    window.addEventListener("keydown", this.frameCaptureKeydown, true);
    window.addEventListener("blur", this.frameCaptureBlur);
    container.addEventListener("pointerdown", this.frameCaptureDown, true);
    container.addEventListener("pointerdown", this.loopPlaybackDown, true);
    window.addEventListener("blur", this.cancelGainOpening);
    window.addEventListener("keydown", this.gainAuditionKeydown, true);
    container.addEventListener("pointerdown", this.activateComposition, true);
    if (options.layout === "embedded")
      for (const type of this.embeddedEvents)
        container.addEventListener(type, this.stopLegacyEvent);
    this.unsubscribe = options.session.subscribe((state) => this.refresh(state));
    void this.restorePreviewQuality();
  }
  private async restorePreviewQuality(): Promise<void> {
    try {
      const value = await this.options.previewQuality?.load();
      if (!this.disposed && !this.previewQualityInteracted && (value === 0.5 || value === 0.25))
        this.setPreviewQuality(value);
    } catch { /* A viewer preference must not prevent editing. */ }
  }
  private setPreviewQuality(value: PreviewResolution, remember = false): void {
    if (this.disposed || ![1, 0.5, 0.25].includes(value)) return;
    if (remember) {
      this.previewQualityInteracted = true;
      try {
        void Promise.resolve(this.options.previewQuality?.save(value)).catch(() => {});
      } catch { /* Storage is optional; the chosen preview quality still applies. */ }
    }
    this.cancelFrameCapture();
    this.get<HTMLSelectElement>("[data-ew-quality]").value = String(value);
    this.updateFrameCaptureControl();
    this.run(async () => {
      this.canvasEditor.cancel();
      this.cancelPreparation();
      try {
        const drawn = await this.preview.setResolution(value, this.playhead);
        if (drawn && !this.disposed && !this.preparing)
          this.get("[data-ew-preview-error]").hidden = true;
      } catch (error) {
        this.clearGainAudition();
        this.previewError(error);
        throw error;
      }
    });
  }

  private viewReadCurrent(scope: ViewReadScope): boolean {
    return (
      !this.disposed &&
      sameIdentity(scope.identity, this.options.session.getState().identity) &&
      scope.sequenceId === this.sequenceId &&
      scope.time === this.playhead &&
      scope.selected.length === this.selected.length &&
      scope.selected.every((id, index) => id === this.selected[index])
    );
  }
  private readViewDocument(): EditorDocument {
    const scope = this.viewReadScope;
    return scope && this.viewReadCurrent(scope) ? scope.document : this.options.session.read();
  }
  private withReadSnapshot(render: () => void): void {
    const identity = { ...this.options.session.getState().identity },
      sequenceId = this.sequenceId,
      selected = [...this.selected],
      time = this.playhead,
      document = this.options.session.read(),
      scope: ViewReadScope = { document, identity, sequenceId, selected, time },
      previous = this.viewReadScope;
    this.viewReadScope =
      document.id === identity.documentId &&
      document.revision === identity.revision &&
      this.viewReadCurrent(scope)
        ? scope
        : undefined;
    try {
      render();
    } finally {
      this.viewReadScope = previous;
    }
  }
  private renderFrameViews(): void {
    this.withReadSnapshot(() => {
      this.inspector.renderFrame();
      this.timing.render();
      this.sequences.render();
      this.canvasEditor?.render();
    });
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
    for (const [name, label, available, shortcut, actionLabel] of [
      ["undo", "撤销", state.canUndo, "⌘/Ctrl Z", state.undoLabel],
      ["redo", "重做", state.canRedo, "⇧ ⌘/Ctrl Z", state.redoLabel],
    ] as const) {
      const control = this.get<HTMLButtonElement>(`[data-ew-action="${name}"]`);
      control.disabled = !available || state.phase !== "ready";
      control.title = control.disabled
        ? `${label}（${state.phase !== "ready" ? "工程正在保存或切换，请稍候" : `没有可${label}的操作`}）`
        : `${label}${actionLabel ? `：${actionLabel}` : ""} · ${shortcut}`;
    }
    if (state.error?.stage === "commit") save.textContent = "候选保存失败，请重试原操作";
    this.get('[data-ew-action="retry-save"]').hidden =
      state.saveState !== "failed" || state.error?.stage === "commit";
    const opening = this.exportOpening;
    if (opening && (state.phase !== "ready" || !sameIdentity(opening.identity, state.identity, false) ||
        state.identity.revision !== opening.identity.revision &&
          (!opening.finishing || state.identity.revision !== opening.identity.revision + 1))) this.cancelExportOpening(opening);
    const capture = this.frameCapture;
    if (capture && (!sameIdentity(capture.identity, state.identity, false) ||
        (!capture.finishing && capture.identity.revision !== state.identity.revision))) this.cancelFrameCapture();
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
    if (opened || this.auditionSequence !== sequence.id) this.soloTracks.clear();
    else this.soloTracks = new Set([...this.soloTracks].filter((id) => sequence.tracks.some((track) => track.id === id && track.kind !== "text")));
    this.auditionSequence = sequence.id;
    if (this.frameCapture && this.frameCapture.sequenceId !== sequence.id) this.cancelFrameCapture();
    if (this.exportOpening && this.exportOpening.sequenceId !== sequence.id) this.cancelExportOpening();
    this.frameCaptureSize = { width: sequence.width, height: sequence.height, duration: sequenceDuration(sequence) };
    this.updateFrameCaptureControl();
    this.selected = this.selected.filter((id) => sequence.clips.some((clip) => clip.id === id));
    this.clearGainAudition(true);
    this.cancelPreparation();
    this.audio?.stream?.dispose();
    this.audio = undefined;
    this.preparedRevision = "";
    this.clearAudioWarning();
    this.preview.setDocument(this.auditionDocument(doc), sequence.id);
    this.updateAuditionControls();
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
    if (this.visible && !this.sourcePreview) this.run(() => this.frameCapture?.finishing || this.exportOpening?.finishing || this.gainOpening?.finishing
      ? this.preview.seek(this.playhead, { exact: this.exactPlayhead }) : this.seek(this.playhead));
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
    this.loopReplay = undefined;
    if (this.preparing) this.clearAudioWarning();
    this.preparing?.abort();
    this.preparing = undefined;
    this.clearPreparationStatus();
    this.preview?.pause();
    this.updatePlayButton(false);
  }
  private previewError(error: unknown): void {
    this.loopReplay = undefined;
    if (this.disposed) return;
    this.clearGainAudition();
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
    // Only the synchronous call that positions this audition may retain its opening owner.
    if (!this.gainOpening || this.gainSeeking !== this.gainOpening || time !== this.gainOpening.time || !exact)
      this.clearGainAudition();
    this.timeline.cancelTextNavigation();
    this.cancelExportOpening();
    if (this.disposed) return;
    this.cancelFrameCapture();
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
  private auditionDocument(document = this.options.session.read()): EditorDocument {
    return this.soloTracks.size ? trackAuditionDocument(document, this.sequenceId, this.soloTracks) : document;
  }
  private playbackSignature(): string {
    return `${this.revision}:${JSON.stringify([...this.soloTracks].sort())}`;
  }
  private updateAuditionControls(): void {
    if (this.disposed) return;
    const sequence = this.readViewDocument().sequences.find((item) => item.id === this.sequenceId)!,
      clip = sequence.clips.find((item) => item.id === this.selected[0]),
      control = this.get<HTMLButtonElement>('[data-ew-action="gain-audition"]');
    control.disabled = !this.options.prepareAudio || this.selected.length !== 1 || !clip || !("audio" in clip) || typeof clip.audio.volume !== "number";
    control.setAttribute("aria-pressed", String(Boolean(this.gainAudition)));
    control.textContent = this.gainAudition ? "结束调音试听" : "调音试听";
    this.get('[data-ew-action="clear-solo"]').hidden = !this.soloTracks.size;
    const names = sequence.tracks.filter((track) => this.soloTracks.has(track.id)).map((track) => track.name),
      output = this.get('[data-ew-audition-status]');
    output.textContent = [names.length ? `独轨试听：${names.join("、")}（保留轨道静音，不影响导出）` : "", this.gainAudition ? "调音试听：拖动所选片段音量线即可听效果，松开保存后用于导出，Esc 取消" : ""].filter(Boolean).join(" · ");
    output.hidden = !output.textContent;
  }
  private clearGainAudition(preserveOpening = false): void {
    if (!preserveOpening) { this.auditionEpoch++; this.gainOpening?.controller.abort(); this.gainOpening = undefined; }
    if (!this.gainAudition) return;
    this.cancelPreparation();
    this.gainAudition.audio?.stream?.dispose();
    this.gainAudition = undefined;
    this.updateAuditionControls();
  }
  private toggleSolo(trackId?: string): void {
    if (this.disposed || !this.visible || this.sourcePreview) return;
    if (trackId && !this.sequence().tracks.some((track) => track.id === trackId && track.kind !== "text")) return;
    this.clearGainAudition();
    this.cancelPreparation();
    if (!trackId) this.soloTracks.clear();
    else if (this.soloTracks.has(trackId)) this.soloTracks.delete(trackId);
    else this.soloTracks.add(trackId);
    this.audio?.stream?.dispose(); this.audio = undefined; this.preparedRevision = "";
    this.preview.setDocument(this.auditionDocument(), this.sequenceId);
    this.timeline.render();
    this.updateAuditionControls();
    this.run(() => this.seek(this.playhead));
  }
  private async toggleGainAudition(): Promise<void> {
    if (this.disposed || !this.visible || this.sourcePreview) return;
    if (this.gainOpening) { this.clearGainAudition(); return; }
    if (this.gainAudition) { this.clearGainAudition(); return; }
    if (this.exportComposition === document.activeElement) {
      this.options.onError(new Error("请完成文字输入后再调音试听")); return;
    }
    const epoch = ++this.auditionEpoch, session = this.options.session,
      sequenceId = this.sequenceId, selection = JSON.stringify(this.selected), time = this.playhead,
      identity = { ...session.getState().identity };
    if (epoch !== this.auditionEpoch || this.gainOpening || this.disposed || !this.visible || this.sourcePreview ||
      session !== this.options.session || sequenceId !== this.sequenceId || selection !== JSON.stringify(this.selected) || time !== this.playhead) return;
    const owner: ExportOpeningOwner = { session, identity, sequenceId, selection, time,
      controller: new AbortController(), finishing: true };
    this.gainOpening = owner;
    try {
      const ready = this.inspector.finishFocusedField(owner.controller.signal) ?? this.timeline.finishFocusedField(owner.controller.signal),
        asynchronous = ready !== undefined && typeof ready !== "boolean";
      if (!(ready === undefined || (typeof ready === "boolean" ? ready : await ready))) return;
      const latest = this.gainOpeningIdentity(owner, asynchronous);
      if (!latest) return;
      owner.identity = latest; owner.finishing = false;
      const doc = this.auditionDocument();
      if (!this.gainOpeningIdentity(owner) || doc.id !== latest.documentId || doc.revision !== latest.revision) return;
      if (this.selected.length !== 1) throw new Error("请选择一个固定音量的声音片段");
      const clipId = this.selected[0]!, candidate = clipGainAuditionDocument(doc, sequenceId, clipId),
        clip = doc.sequences.find((item) => item.id === sequenceId)!.clips.find((item) => item.id === clipId)!;
      if (owner.time < clip.start || owner.time >= clip.start + clip.duration) {
        owner.time = clip.start;
        this.gainSeeking = owner;
        let seek: Promise<void>;
        try { seek = this.seek(owner.time, true); }
        finally { if (this.gainSeeking === owner) this.gainSeeking = undefined; }
        await seek;
        if (!this.gainOpeningIdentity(owner)) return;
      }
      this.cancelPreparation();
      if (!this.gainOpeningIdentity(owner)) return;
      const audition = { clipId, volume: candidate.volume };
      this.gainAudition = audition;
      this.updateAuditionControls();
      if (!this.gainOpeningIdentity(owner) || this.gainAudition !== audition) return;
      await this.togglePlayback();
    } catch (error) {
      try { if (this.gainOpeningIdentity(owner)) this.options.onError(error); }
      catch { /* Superseded scope/read failures must not report into a new project. */ }
    } finally {
      if (this.gainOpening === owner) { this.gainOpening = undefined; owner.controller.abort(); }
    }
  }
  private gainOpeningIdentity(owner: ExportOpeningOwner, allowFieldRevision = false): SessionIdentity | undefined {
    const state = owner.session.getState();
    if (this.options.session !== owner.session || this.gainOpening !== owner || owner.controller.signal.aborted || this.disposed ||
      !this.visible || this.sourcePreview || state.phase !== "ready" || this.sequenceId !== owner.sequenceId ||
      this.playhead !== owner.time || JSON.stringify(this.selected) !== owner.selection || !sameIdentity(owner.identity, state.identity, false)) return;
    if (state.identity.revision === owner.identity.revision || allowFieldRevision && owner.finishing && state.identity.revision === owner.identity.revision + 1)
      return { ...state.identity };
  }
  async togglePlayback(): Promise<void> {
    if (this.disposed) return;
    this.loopReplay = undefined;
    this.previewQualityInteracted = true;
    this.cancelFrameCapture();
    if (this.preparing) {
      this.clearGainAudition();
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
    const doc = this.auditionDocument(),
      sequenceId = this.sequenceId,
      signature = this.playbackSignature(), audition = this.gainAudition;
    try {
      const preparedCurrent = this.preparedRevision === signature;
      if (!preparedCurrent) this.clearAudioWarning();
      const prepared = preparedCurrent
        ? this.audio
        : (this.audio ??
          (await this.options.prepareAudio?.(doc, sequenceId, controller.signal, (message) =>
            this.preparationStatus(controller, message),
            this.soloTracks.size ? "audition" : undefined,
          )));
      if (
        controller.signal.aborted ||
        signature !== this.playbackSignature() ||
        this.disposed ||
        !this.visible
      ) {
        if (prepared !== this.audio) prepared?.stream?.dispose();
        return;
      }
      this.audio = prepared;
      if (audition && !audition.audio) {
        const candidate = clipGainAuditionDocument(doc, sequenceId, audition.clipId);
        const stem = await this.options.prepareAudio?.(candidate.document, sequenceId, controller.signal,
          (message) => this.preparationStatus(controller, `正在准备调音试听 · ${message}`), "audition");
        if (controller.signal.aborted || audition !== this.gainAudition || signature !== this.playbackSignature() || this.disposed || !this.visible) {
          stem?.stream?.dispose(); return;
        }
        if (!stem) throw new Error("无法准备所选片段的调音试听声音");
        audition.audio = stem;
      }
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
        signature !== this.playbackSignature() ||
        this.disposed ||
        !this.visible
      )
        return;
      await this.preview.play(this.audio, audition?.audio ? { audio: audition.audio, gain: audition.delta ?? 0 } : undefined);
      if (
        !controller.signal.aborted &&
        signature === this.playbackSignature() &&
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
        this.clearGainAudition();
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
    if (!visible) this.cancelExportOpening();
    this.visible = visible;
    this.container.hidden = !visible;
    this.multicam?.setVisible(visible && !this.get("[data-ew-multicam]").hidden);
    this.updateFrameCaptureControl();
    if (!visible) {
      this.clearGainAudition();
      this.timeline.cancelTextNavigation();
      this.cancelFrameCapture();
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
    this.clearGainAudition();
    this.cancelPreparation();
    this.clearAudioWarning();
    this.audio?.stream?.dispose();
    this.audio = undefined;
    this.preparedRevision = "";
    // Resource URLs may change while the document identity stays exactly the same.
    this.preview.setDocument(this.auditionDocument(), this.sequenceId);
    this.timeline.refreshMedia();
    if (this.visible && !this.sourcePreview) this.run(() => this.seek(this.playhead));
  }
  /** Browsing source footage replaces the monitor, while the canonical timeline stays mounted. */
  setSourcePreview(active: boolean): void {
    if (this.sourcePreview === active || this.disposed) return;
    this.previewQualityInteracted = true;
    this.cancelExportOpening();
    this.clearGainAudition();
    this.sourcePreview = active;
    this.cancelFrameCapture();
    this.updateFrameCaptureControl();
    if (active) {
      this.timeline.cancelTextNavigation();
      this.cancelPreparation();
      this.clearAudioWarning();
      this.preview.pause();
    } else if (this.visible) this.run(() => this.seek(this.playhead));
  }
  private activateComposition = (): void => {
    this.previewQualityInteracted = true;
    if (this.sourcePreview) this.options.showComposition?.();
  };
  refreshTimelineMedia(): void {
    if (this.visible && !this.disposed) this.timeline.render();
  }
  selectClips(sequenceId: string, clipIds: string[]): void {
    if (this.disposed || sequenceId !== this.sequenceId) return;
    this.cancelExportOpening();
    this.cancelFrameCapture();
    this.canvasEditor.cancel();
    const existing = new Set(this.sequence().clips.map((clip) => clip.id));
    this.clearGainAudition();
    this.selected = [...new Set(clipIds)].filter((id) => existing.has(id));
    this.updateAuditionControls();
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
    this.updateAuditionControls();
    this.timeline.render();
    this.inspector.render();
    this.timing.render();
    this.activateComposition();
    this.run(() => this.seek(at, true));
    this.revealSelection();
  }
  private updateFrameCaptureControl(): void {
    const control = this.container.querySelector<HTMLButtonElement>('[data-ew-action="save-frame"]');
    if (!control || this.disposed) return;
    const size = this.frameCaptureSize, quality = Number(this.get<HTMLSelectElement>("[data-ew-quality]").value);
    control.disabled = !!this.frameCapture || !this.visible || this.sourcePreview || !size?.duration;
    control.textContent = this.frameCapture ? "正在保存…" : "保存已应用画面 PNG";
    control.title = this.sourcePreview ? "请返回成片预览后保存画面" : !size?.duration ? "当前序列没有可保存的片段" :
      `保存已应用画面 PNG · ${Math.max(1, Math.round(size.width * quality))} × ${Math.max(1, Math.round(size.height * quality))}（按预览质量）· 会暂停播放；结束位置保存最后一帧。未应用的时间调整不会自动应用。`;
  }
  private frameCaptureDown = (event: PointerEvent): void => {
    if (event.button === 0 && (event.target as Element).closest('[data-ew-action="save-frame"]'))
      event.preventDefault(); // Retain field drafts until their owned finisher has validated them.
  };
  private frameCaptureKeydown = (event: KeyboardEvent): void => {
    if (event.repeat && ["Enter", " "].includes(event.key) &&
        event.target instanceof Element && event.target.closest('[data-ew-action="save-frame"]')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "Escape" && this.frameCapture) {
      this.cancelFrameCapture();
      event.preventDefault();
      event.stopPropagation();
    }
  };
  private frameCaptureBlur = (): void => { this.cancelFrameCapture(); };
  private cancelFrameCapture(expected = this.frameCapture): void {
    if (!expected || this.frameCapture !== expected) return;
    this.frameCapture = undefined;
    expected.controller.abort();
    this.updateFrameCaptureControl();
  }
  private frameCaptureCurrent(owner: FrameCaptureOwner, allowFieldRevision = false): boolean {
    const identity = this.options.session.getState().identity;
    if (this.frameCapture !== owner || owner.controller.signal.aborted || this.disposed ||
        !this.visible || this.sourcePreview || this.sequenceId !== owner.sequenceId ||
        this.playhead !== owner.time || JSON.stringify(this.selected) !== owner.selection ||
        this.get<HTMLSelectElement>("[data-ew-quality]").value !== owner.quality) return false;
    return sameIdentity(owner.identity, identity, false) &&
      (identity.revision === owner.identity.revision ||
        (allowFieldRevision && identity.revision === owner.identity.revision + 1));
  }
  private async saveFrame(): Promise<void> {
    if (this.frameCapture || this.disposed || !this.visible || this.sourcePreview || !this.options.downloadFrame) return;
    this.canvasEditor.cancel();
    this.cancelPreparation();
    this.preview.pause();
    const identity = this.options.session.getState().identity;
    if (this.disposed || !this.visible || this.sourcePreview || this.frameCapture) return;
    const owner: FrameCaptureOwner = {
      controller: new AbortController(), identity,
      sequenceId: this.sequenceId, selection: JSON.stringify(this.selected), time: this.playhead,
      quality: this.get<HTMLSelectElement>("[data-ew-quality]").value, finishing: true,
    };
    this.frameCapture = owner;
    this.updateFrameCaptureControl();
    try {
      const ready = this.inspector.finishFocusedField(owner.controller.signal) ??
        this.timeline.finishFocusedField(owner.controller.signal);
      if (!(ready === undefined || (typeof ready === "boolean" ? ready : await ready)) ||
          !this.frameCaptureCurrent(owner, ready !== undefined)) return;
      owner.identity = this.options.session.getState().identity;
      owner.finishing = false;
      const document = this.options.session.read(), sequence = document.sequences.find((item) => item.id === owner.sequenceId);
      if (!this.frameCaptureCurrent(owner) || document.id !== owner.identity.documentId ||
          document.revision !== owner.identity.revision || !sequence) return;
      const duration = sequenceDuration(sequence);
      if (!duration) return;
      const name = [...`${document.name}_${sequence.name}`.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")].slice(0, 48).join("") || "成片";
      // The natural end has no frame at duration itself. Capture the last valid tick.
      owner.time = Math.min(owner.time, duration - 1);
      this.playhead = owner.time;
      this.exactPlayhead = true;
      this.updateTime();
      const frame = await this.preview.captureFrame(owner.time, owner.controller.signal);
      if (!this.frameCaptureCurrent(owner)) return;
      this.options.downloadFrame(frame.blob, `${name}_${ticksToSeconds(frame.time).toFixed(6)}s_t${frame.time}_${frame.width}x${frame.height}.png`);
    } catch (error) {
      if (this.frameCaptureCurrent(owner) && !(error instanceof DOMException && error.name === "AbortError"))
        this.options.onError(error);
    } finally {
      this.cancelFrameCapture(owner);
    }
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
  private cancelGainOpening = (): void => {
    if (!this.gainOpening) return;
    const preparing = !this.gainOpening.finishing;
    this.gainOpening.controller.abort(); this.gainOpening = undefined; this.auditionEpoch++;
    if (preparing) this.clearGainAudition();
  };
  private gainAuditionKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && (this.gainOpening || this.preparing && this.gainAudition)) {
      this.clearGainAudition(); this.cancelPreparation();
    }
  };
  private loopPlaybackDown = (event: PointerEvent): void => {
    if (event.button === 0 && event.isPrimary && event.target instanceof Element &&
      event.target.closest('[data-ew-action="loop-playback"],[data-ew-action="gain-audition"],[data-ew-action="clear-solo"]')) event.preventDefault();
  };
  private queueLoopReplay(time: Tick, revision: string, owner?: symbol): void {
    if (!owner || this.loopReplay !== owner) return;
    if (!this.loopPlayback || this.preview.playing || this.preparing || this.disposed ||
      !this.visible || this.sourcePreview || !time || revision !== this.revision) {
      this.loopReplay = undefined;
      return;
    }
    const duration = sequenceDuration(this.sequence());
    if (this.loopReplay !== owner) return;
    if (time !== duration || revision !== this.revision || this.playhead !== time ||
      !this.loopPlayback || this.preview.playing || this.preparing || this.disposed ||
      !this.visible || this.sourcePreview) {
      this.loopReplay = undefined;
      return;
    }
    queueMicrotask(() => {
      if (this.loopReplay !== owner) return;
      this.loopReplay = undefined;
      if (!this.loopPlayback || this.preview.playing || this.preparing || this.disposed ||
        !this.visible || this.sourcePreview || this.playhead !== time || revision !== this.revision) return;
      this.run(() => this.togglePlayback());
    });
  }
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
    if (target.matches("[data-ew-seek]")) {
      this.previewQualityInteracted = true;
      this.run(() => this.seek(Number(target.value)));
    }
    if (target.matches("[data-ew-search]")) {
      this.search = target.value;
      this.renderAssets();
    }
  };
  private change = (event: Event) => {
    const target = event.target as HTMLInputElement;
    if (target.matches("[data-ew-quality]"))
      this.setPreviewQuality(Number(target.value) as PreviewResolution, true);
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
    this.previewQualityInteracted = true;
    if (event.repeat && event.target instanceof Element &&
      event.target.closest('[data-ew-action="loop-playback"],[data-ew-action="gain-audition"],[data-ew-action="clear-solo"]') &&
      ["Enter", " ", "Spacebar"].includes(event.key)) event.preventDefault();
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
    if (action === "gain-audition") return this.toggleGainAudition();
    if (action === "clear-solo") { this.toggleSolo(); return; }
    if (action === "loop-playback") {
      this.loopReplay = undefined;
      this.loopPlayback = !this.loopPlayback;
      this.get('[data-ew-action="loop-playback"]').setAttribute("aria-pressed", String(this.loopPlayback));
      return;
    }
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
    if (action === "save-frame") return this.saveFrame();
    if (action === "play") { this.cancelFrameCapture(); return this.togglePlayback(); }
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
    if (action === "export") return this.beginExport();
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
    beforeOpen?: () => boolean,
  ): HTMLFormElement {
    if (beforeOpen && !beforeOpen()) throw new DOMException("导出入口已取消", "AbortError");
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
    if (beforeOpen && !beforeOpen()) { controller.abort(); throw new DOMException("导出入口已取消", "AbortError"); }
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
  private exportDialog(owner: ExportOpeningOwner): void {
    if (!this.options.exportSequence)
      throw new Error("请在已连接本地媒体任务的 CodeShell 视频面板中导出");
    if (this.pendingExport) throw new Error("导出任务正在提交，请稍候");
    const session = this.options.session, doc = session.read(),
      openedIdentity = this.exportOpeningIdentity(owner),
      sequence = doc.sequences.find((item) => item.id === owner.sequenceId);
    if (!openedIdentity || !sequence || doc.id !== openedIdentity.documentId || doc.revision !== openedIdentity.revision) return;
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
    if (!this.exportOpeningIdentity(owner)) return;
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
      </fieldset><fieldset><legend>导出范围</legend><label>范围<select name="range"><option value="">完整所选序列</option>${ranges.map((marker) => `<option value="${esc(marker.id)}"${marker.time + marker.duration > sequenceDuration(sequence) ? " disabled" : ""}>${esc(marker.name)} · ${exportRangeLabel({ start: marker.time, duration: marker.duration })}${marker.time + marker.duration > sequenceDuration(sequence) ? "（超出序列时长）" : ""}</option>`).join("")}</select></label><p>范围标记只导出当前序列的这一段。可先在“标记与范围”中添加范围。</p><p data-export-range-hint hidden>仅准备范围内可能出现的画面；普通原速音频按范围混音，已有完整混音可复用。自动闪避、变速音高等情况仍准备完整混音。首次仍需暂存完整序列素材，参与混音的素材声音仍完整解码。</p></fieldset><fieldset><legend>导出序列</legend>${doc.sequences.map((item) => `<label><input type="checkbox" name="sequences" value="${esc(item.id)}" ${item.id === sequence.id ? "checked" : ""} ${sequenceDuration(item) ? "" : "disabled"}>${esc(item.name)}${sequenceDuration(item) ? "" : "（空序列）"}</label>`).join("")}</fieldset>
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
      () => !!this.exportOpeningIdentity(owner),
    );
    if (!this.exportOpeningIdentity(owner)) {
      const staleDialog = form.closest("dialog");
      if (this.dialog === staleDialog) { this.dialogAbort?.abort(); this.dialog = undefined; }
      staleDialog?.remove();
      return;
    }
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
        const dialog = form.closest("dialog");
        if (batch || this.disposed || !form.isConnected || this.dialog !== dialog) return;
        assertSnapshot();
        if (!form.reportValidity()) return;
        this.options.assertEditable?.();
        assertSnapshot();
        const current = session.read();
        assertSnapshot();
        if (current.id !== doc.id || current.revision !== doc.revision)
          throw new Error("工程已变化，请重新打开导出设置");
        const profiles = remove
          ? current.exportProfiles.filter((item) => item.id !== input("preset").value)
          : [...current.exportProfiles, { ...readProfile(form), id: uid("export") }];
        const operations: EditorOperation[] = [{ type: "project.exportProfiles", profiles }],
          after = applyEditorOperations(current, operations, current.revision),
          reconciled = [...operations, ...reconcileEditorProduction(current, after)];
        assertSnapshot();
        if (this.disposed || !form.isConnected || this.dialog !== dialog) return;
        session.dispatch(
          reconciled,
          openedIdentity,
          remove ? "删除导出预设" : "保存导出预设",
        );
        if (this.dialog === dialog) dialog.close();
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
  private exportEntryDown = (event: PointerEvent): void => {
    if (event.target instanceof Element && event.target.closest('[data-ew-action="export"]')) {
      if (event.button === 0 && event.isPrimary && document.activeElement instanceof Element &&
          document.activeElement.closest("[data-ew-inspector],[data-ew-timeline]")) event.preventDefault();
    } else this.cancelExportOpening();
  };
  private exportCompositionStart = (event: CompositionEvent): void => { this.exportComposition = event.target ?? undefined; };
  private exportCompositionEnd = (event: CompositionEvent): void => {
    if (this.exportComposition === event.target) this.exportComposition = undefined;
  };
  private exportEntryKeydown = (event: KeyboardEvent): void => {
    if (event.repeat && ["Enter", " "].includes(event.key) && event.target instanceof Element &&
        event.target.closest('[data-ew-action="export"]')) event.preventDefault();
    if (event.key === "Escape" && this.exportOpening) {
      this.cancelExportOpening(); event.preventDefault(); event.stopPropagation();
    }
  };
  private exportEntryBlur = (): void => { this.cancelExportOpening(); };
  private cancelExportOpening(expected = this.exportOpening): void {
    if (!expected) { this.exportOpeningEpoch++; return; }
    if (this.exportOpening !== expected) return;
    this.exportOpeningEpoch++;
    this.exportOpening = undefined;
    expected.controller.abort();
  }
  private exportOpeningIdentity(owner: ExportOpeningOwner, allowFieldRevision = false): SessionIdentity | undefined {
    const state = owner.session.getState();
    if (this.options.session !== owner.session || this.exportOpening !== owner || owner.controller.signal.aborted || this.disposed ||
        !this.visible || this.sourcePreview || state.phase !== "ready" || this.sequenceId !== owner.sequenceId ||
        this.playhead !== owner.time || JSON.stringify(this.selected) !== owner.selection ||
        !sameIdentity(owner.identity, state.identity, false)) return;
    if (state.identity.revision === owner.identity.revision ||
        allowFieldRevision && state.identity.revision === owner.identity.revision + 1) return { ...state.identity };
  }
  private async beginExport(): Promise<void> {
    if (this.exportOpening || this.disposed || !this.visible || this.sourcePreview) return;
    if (this.exportComposition === document.activeElement) {
      this.options.onError(new Error("请完成文字输入后再导出"));
      return;
    }
    const epoch = ++this.exportOpeningEpoch, session = this.options.session,
      sequenceId = this.sequenceId, selection = JSON.stringify(this.selected), time = this.playhead,
      identity = { ...session.getState().identity };
    if (this.exportOpeningEpoch !== epoch || this.options.session !== session || this.exportOpening ||
        this.disposed || !this.visible || this.sourcePreview || this.sequenceId !== sequenceId ||
        this.playhead !== time || JSON.stringify(this.selected) !== selection) return;
    const owner: ExportOpeningOwner = { session, controller: new AbortController(), identity,
      sequenceId, selection, time, finishing: true };
    this.exportOpening = owner;
    try {
      const ready = this.inspector.finishFocusedField(owner.controller.signal) ??
        this.timeline.finishFocusedField(owner.controller.signal);
      const asynchronous = ready !== undefined && typeof ready !== "boolean";
      if (!(ready === undefined || (typeof ready === "boolean" ? ready : await ready))) return;
      const current = this.exportOpeningIdentity(owner, asynchronous);
      if (!current) return;
      owner.identity = current;
      owner.finishing = false;
      this.exportDialog(owner);
    } catch (error) {
      try { if (this.exportOpeningIdentity(owner)) this.options.onError(error); }
      catch { /* A failed or superseded scope read must not report into another project. */ }
    } finally { this.cancelExportOpening(owner); }
  }
  openExport(): void {
    this.run(() => this.beginExport());
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.clearGainAudition();
    this.disposed = true;
    this.cancelExportOpening();
    this.cancelFrameCapture();
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
    window.removeEventListener("keydown", this.exportEntryKeydown, true);
    window.removeEventListener("blur", this.exportEntryBlur);
    this.container.removeEventListener("pointerdown", this.exportEntryDown, true);
    this.container.removeEventListener("compositionstart", this.exportCompositionStart, true);
    this.container.removeEventListener("compositionend", this.exportCompositionEnd, true);
    window.removeEventListener("keydown", this.frameCaptureKeydown, true);
    window.removeEventListener("blur", this.frameCaptureBlur);
    this.container.removeEventListener("pointerdown", this.frameCaptureDown, true);
    this.container.removeEventListener("pointerdown", this.loopPlaybackDown, true);
    window.removeEventListener("blur", this.cancelGainOpening);
    window.removeEventListener("keydown", this.gainAuditionKeydown, true);
    this.container.removeEventListener("pointerdown", this.activateComposition, true);
    for (const type of this.embeddedEvents)
      this.container.removeEventListener(type, this.stopLegacyEvent);
    await this.preview.dispose();
    this.container.replaceChildren();
  }
}
