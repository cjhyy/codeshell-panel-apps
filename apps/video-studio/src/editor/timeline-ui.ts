import { randomId } from "../ids.js";
import { planClipAudioFade, type AudioFadeSide } from "./audio-fade-edits";
import { planClipAudioGain } from "./audio-gain-edits";
import { originalAudioReason, planDetachOriginalAudio, planUnlinkAudio } from "./original-audio";
import {
  EditorTimelineMedia,
  TIMELINE_MEDIA_LIMITS,
  type EditorTimelineMediaOptions,
  type TimelineMediaStrip,
} from "./timeline-media";
import { escapeHtml as esc, icon as sharedIcon } from "../icons";
import { createTrack } from "./defaults";
import {
  copyClips,
  planSplitClips,
  prepareClipTrim,
  trimClip,
  groupClips,
  ungroupClips,
  type ClipClipboard,
  type ClipTrimPreview,
} from "./clip-edits";
import { planCutClips, duplicateClipsInPlace } from "./clipboard-edits";
import { planTimelinePaste } from "./timeline-paste";
import { dragReadoutRange, dragReadoutSeconds } from "./timeline-drag-readout";
import {
  applyEditorOperations,
  prepareEditorOperationPreview,
  type EditorOperation,
  type EditorOperationPreview,
} from "./operations";
import { frameToTicks, ticksToFrame, ticksToSeconds, secondsToTicks, type Tick } from "./time";
import type { EditorClip, EditorDocument, EditorSequence, EditorTrack } from "./types";
import { sameIdentity, type SessionIdentity } from "./session";
import type { PreparedTimelineSnapshot } from "./evaluate";
import { sequenceDuration } from "./validation";
import {
  magneticMovementIds,
  isMagneticTrack,
  planMagneticMove,
  planMagneticRemove,
  planClipTiming,
  planTimelineArrangement,
} from "./timing-edits";

export interface EditorTimelineContext {
  media?: EditorTimelineMediaOptions;
  read(): EditorDocument;
  identity?(): SessionIdentity;
  /** Explicitly opts a session-owned context into immutable timeline media snapshots. */
  prepareMediaSnapshot?(
    document: EditorDocument,
    identity: SessionIdentity,
  ): PreparedTimelineSnapshot;
  selection(): { sequenceId: string; clipIds: string[] };
  select(clipIds: string[]): void;
  /** Finish an owned focused field before changing selection or taking a drag snapshot. */
  soloTracks?(): ReadonlySet<string>;
  toggleSolo?(trackId: string): void;
  previewGain?(clipId: string, volume: number): boolean;
  endGainPreview?(): void;
  beforeGesture?(signal: AbortSignal): boolean | Promise<boolean>;
  selectedMarker?(): string | undefined;
  selectMarker?(markerId: string): void;
  /** Navigation must still belong to the visible composition and captured clock. */
  canNavigateMarkers?(time: Tick): boolean;
  /** Open a marker draft; the parent owns its form and explicit save. */
  beginMarker?(kind: "point" | "range"): void;
  /** Whether composition trimming is still available at the captured playhead. */
  canTrimAtPlayhead?(time: Tick): boolean;
  time(): Tick;
  seek(time: Tick, exact?: boolean): void | Promise<void>;
  apply(operations: EditorOperation[], label: string): void | Promise<void>;
  /** Persist destructive clipboard edits before consuming their copy snapshot or selection. */
  applyClipboard?(operations: EditorOperation[], label: string): Promise<void>;
  addAsset?(assetId: string, placement: { at: Tick; trackId: string }): void | Promise<void>;
  /** Adds a visible title at the playhead; shown as the 添加文字 tool when provided. */
  addText?(): void | Promise<void>;
  /** View-only access to one saved text clip; the parent expands its inspector. */
  editText?(clipId: string, current: () => boolean): void;
  canEditText?(time: Tick): boolean;
  showShortcuts?(): void | Promise<void>;
  onError(error: unknown): void;
}
type Drag = {
  kind: "move" | "left" | "right" | "seek" | "box" | "fadeIn" | "fadeOut" | "gain";
  pointerId: number;
  x: number;
  y: number;
  scroll: number;
  verticalScroll: number;
  lastX: number;
  lastY: number;
  documentId: string;
  revision: number;
  generation?: number;
  sequenceId: string;
  document: EditorDocument;
  sequence: EditorSequence;
  clip?: EditorClip;
  ids: string[];
  targetTrack?: string;
  delta: Tick;
  gain?: number;
  time: Tick;
  moved: boolean;
  additive: boolean;
  textClick?: Tick;
  altKey: boolean;
  movePreview?: EditorOperationPreview;
  trimPreview?: ClipTrimPreview;
  fadePreview?: EditorOperationPreview;
  plan?: { key: string; operations?: EditorOperation[]; error?: unknown; reason?: string };
};
type RenderedMediaScope = {
  document: EditorDocument;
  sequence: EditorSequence;
  identity: SessionIdentity;
};
const uid = (kind: string) => `${kind}-${randomId()}`;
/** Plain explanation shown when a magnetic move lands where it started. */
const MAGNETIC_MOVE_NOTICE =
  "磁吸模式下，主画面轨的片段会自动首尾相接，拖动只改变先后顺序，不能向后留空。要把片段放到任意位置，请在时间轴工具栏切换到「自由」。";
const TIMELINE_MODES = [
  [
    "magnetic",
    "磁吸",
    "磁吸：主画面轨上的片段自动首尾相接，拖动只调整先后顺序，删除后自动补齐空隙。切换时会把主画面轨的空隙收拢，可撤销。",
  ],
  ["free", "自由", "自由：片段可以放在任意位置，允许留空；同一轨道上的片段不能重叠。"],
] as const;
const editableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && !!target.closest("input,textarea,select,[contenteditable=true]");
const TRACK_INPUTS = "[data-et-track-name],[data-et-track-mix]";
const TRACK_BUTTONS = "[data-et-toggle],[data-et-up],[data-et-down],[data-et-delete-track],[data-et-delete-confirm],[data-et-delete-cancel]";
type TrackInputOwner = {
  documentId: string;
  generation?: number;
  sequenceId: string;
  trackId: string;
  kind: EditorTrack["kind"];
};
type GesturePointer = Pick<PointerEvent, "pointerId" | "clientX" | "clientY" | "altKey">;
type ViewPan = { pointerId: number; x: number; y: number; left: number; top: number; scope: string };
type GestureIntent = {
  pointer: GesturePointer;
  kind: Drag["kind"];
  clipId?: string;
  clipKind?: EditorClip["kind"];
  trackId?: string;
  additive: boolean;
  textClick?: Tick;
  scroll: number;
  verticalScroll: number;
};
type PendingTrackGesture = {
  owner?: TrackInputOwner;
  field?: {
    controller: AbortController;
    identity: { documentId: string; revision: number; generation?: number };
    selection: string;
    time: Tick;
    viewport: string;
  };
  intent: GestureIntent;
  last: GesturePointer;
  up?: GesturePointer;
};
const CONTROL_ACTIONS = [
  "split",
  "delete",
  "copy",
  "cut",
  "paste",
  "duplicate",
  "group",
  "ungroup",
  "fit",
  "fit-selection",
  "zoom-in",
  "zoom-out",
  "shortcuts",
  "add-text",
  "track-video",
  "track-audio",
  "track-text",
] as const;
type ControlIntent =
  | { kind: "menu"; clipId: string; x: number; y: number }
  | { kind: "action"; action: (typeof CONTROL_ACTIONS)[number] }
  | { kind: "mode"; mode: "free" | "magnetic" }
  | {
      kind: "track";
      owner: TrackInputOwner;
      operation: "toggle" | "up" | "down" | "delete-track" | "delete-confirm" | "delete-cancel";
      toggle?: "locked" | "hidden" | "muted" | "solo";
    };
type PendingControl = {
  field: NonNullable<PendingTrackGesture["field"]>;
  intent: ControlIntent;
  pointerId: number;
  up?: boolean;
  ready?: boolean;
  applying?: boolean;
};
type TextNavigation = { clipId: string; field: NonNullable<PendingTrackGesture["field"]>; exact?: boolean };
type FadeOwner = {
  documentId: string;
  revision: number;
  generation?: number;
  sequenceId: string;
  clipId: string;
  side: AudioFadeSide;
};
const gainPercent = (volume: number) => Number((volume * 100).toFixed(2));
const gainText = (volume: number) => `${gainPercent(volume)}% · ${volume === 0 ? "−∞" : (20 * Math.log10(volume)).toFixed(1)} dB`;
const gesturePointer = (event: GesturePointer): GesturePointer => ({
  pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, altKey: event.altKey,
});
const lastFrameTime = (sequence: EditorSequence) =>
  frameToTicks(
    ticksToFrame(Math.max(0, sequenceDuration(sequence) - 1), sequence.frameRate, "floor"),
    sequence.frameRate,
  );
const stamp = (time: Tick) => {
  const value = ticksToSeconds(time);
  return `${Math.floor(value / 60)}:${(value % 60).toFixed(value < 10 ? 2 : 1).padStart(value < 10 ? 5 : 4, "0")}`;
};

// The timeline shares the shell's line icons; editing-only controls stay local to this view.
const timelineIcons: Record<string, string> = {
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  paste: '<path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 12h8M8 16h6"/>',
  duplicate: '<rect x="3" y="3" width="12" height="12" rx="2"/><path d="M9 15v4a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-4M7 9h4M9 7v4"/>',
  group: '<rect x="3" y="3" width="18" height="18" rx="3" stroke-dasharray="2 3"/><rect x="7" y="7" width="5" height="5" rx="1"/><rect x="12" y="12" width="5" height="5" rx="1"/>',
  ungroup: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="m14 10 7-7M15 3h6v6M3 15v6h6m-6 0 7-7"/>',
  snap: '<path d="M5 3v10a7 7 0 0 0 14 0V3h-4v10a3 3 0 0 1-6 0V3zM5 7h4m6 0h4"/>',
  locked: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  unlocked: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2M12 14v3"/>',
  visible: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  hidden: '<path d="m3 3 18 18M10.6 5.1A12 12 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3.1 3.9M6.1 6.1A19 19 0 0 0 2 12s3.5 7 10 7a13 13 0 0 0 5.9-1.9M10 10a3 3 0 0 0 4 4"/>',
  muted: '<path d="m11 4-6 5H2v6h3l6 5zM16 9l6 6m0-6-6 6"/>',
  audio: '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="17" cy="16" rx="3" ry="3"/>',
  title: '<path d="M4 5h16M12 5v15M8 20h8M4 5v3m16-3v3"/>',
  up: '<path d="m6 14 6-6 6 6"/>',
};
/** Text and caption clips read as their first line of wording; other clips keep their name. */
function clipLabel(clip: EditorClip): string {
  if (clip.kind !== "text") return clip.label || "未命名片段";
  const line = clip.text
    .split("\n")
    .map((item) => item.trim())
    .find(Boolean);
  if (!line) return "文字";
  const characters = [...line];
  return characters.length > 24 ? `${characters.slice(0, 24).join("")}…` : line;
}
const timelineIcon = (name: string, size = 16) =>
  timelineIcons[name]
    ? `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${timelineIcons[name]}</svg>`
    : sharedIcon(name, size);

/** A view of the parent's single document. All gestures commit one command batch. */
export class EditorTimeline {
  private media: EditorTimelineMedia;
  private mediaFrame?: number;
  private resizeObserver?: ResizeObserver;
  private renderedWidth = 0;
  private scale = 64;
  private snapping = true;
  private trackHeight: 48 | 80 = 48;
  private followPlayback = true;
  private playbackActive = false;
  private followSuspended = false;
  /** One persistent live region; rendering keeps the node so text changes are announced. */
  private readonly notice = globalThis.document.createElement("p");
  /** Stable, non-live feedback: pointer motion must not queue screen reader announcements. */
  private readonly dragReadout = globalThis.document.createElement("div");
  private clipboard?: { payload: ClipClipboard; documentId: string; generation?: number };
  private clipboardPending = false;
  private markerNavigationPending?: { cancelled: boolean; target?: Tick };
  private trimShortcutPending?: { cancelled: boolean };
  private drag?: Drag;
  private viewPan?: ViewPan;
  private panRelease?: number;
  private gestureSerial = 0;
  private dragPlanFrame?: number;
  private destroyed = false;
  private replacingControls = false;
  private readonly trackInputs = new WeakMap<HTMLInputElement, TrackInputOwner>();
  private currentTrackInputs = new WeakSet<HTMLInputElement>();
  private readonly trackButtons = new WeakMap<HTMLButtonElement, TrackInputOwner>();
  private currentTrackButtons = new WeakSet<HTMLButtonElement>();
  private trackControlPending = false;
  private pendingTrackGesture?: PendingTrackGesture;
  private canvasFieldFinish?: object;
  private pendingControl?: PendingControl;
  private audioEdit?: { field: NonNullable<PendingTrackGesture["field"]>; applying: boolean; prepared: boolean };
  private textNavigation?: TextNavigation;
  private lastTextClick?: { clipId: string; scope: string; x: number; y: number; at: number };
  private suppressedControlClick?: number;
  private suppressContextMenu = false;
  private readonly gainOwners = new WeakMap<HTMLElement, Omit<FadeOwner, "side">>();
  private currentGainControls = new WeakSet<HTMLElement>();
  private readonly fadeOwners = new WeakMap<HTMLElement, FadeOwner>();
  private currentFadeControls = new WeakSet<HTMLElement>();
  private fadePending = false;
  private box?: HTMLElement;
  private scrollPosition = 0;
  private verticalPosition = 0;
  private autoScrollFrame: number | undefined;
  private autoScrollTime = 0;
  private autoScrollRemainder = { x: 0, y: 0 };
  /** A track whose deletion waits for confirmation because it still holds clips. */
  private confirmTrack?: {
    trackId: string;
    documentId: string;
    revision: number;
    sequenceId: string;
    generation?: number;
  };
  private menu?: {
    element: HTMLElement;
    lifetime: AbortController;
    documentId: string;
    revision: number;
    generation?: number;
    sequenceId: string;
    clipId: string;
    selected: string[];
    time: Tick;
  };
  constructor(
    private readonly container: HTMLElement,
    private readonly context: EditorTimelineContext,
  ) {
    this.media = new EditorTimelineMedia(context.media);
    this.notice.className = "et-notice";
    this.notice.setAttribute("role", "status");
    this.dragReadout.className = "et-drag-readout";
    this.dragReadout.hidden = true;
    this.dragReadout.setAttribute("role", "group");
    this.dragReadout.setAttribute("aria-label", "拖动片段读数");
    this.dragReadout.innerHTML = "<span>开始 <b></b></span><span>结束 <b></b></span><span>时长 <b></b></span><span><i></i> <b></b></span>";
    container.classList.add("editor-timeline");
    container.tabIndex = 0;
    container.setAttribute("aria-label", "剪辑时间轴");
    container.addEventListener("focusin", this.gainFocus);
    container.addEventListener("click", this.click);
    container.addEventListener("change", this.change);
    container.addEventListener("change", this.replacementChange, true);
    container.addEventListener("input", this.input);
    container.addEventListener("wheel", this.wheel, { passive: false });
    container.addEventListener("keydown", this.keydown);
    container.addEventListener("keyup", this.keyup);
    container.addEventListener("pointerdown", this.pointerdown);
    container.addEventListener("pointermove", this.pointermove);
    container.addEventListener("pointerup", this.pointerup);
    container.addEventListener("pointercancel", this.cancelPointer);
    container.addEventListener("lostpointercapture", this.cancelPointer);
    window.addEventListener("blur", this.interrupt);
    globalThis.document.addEventListener("visibilitychange", this.interrupt);
    globalThis.document.addEventListener("keydown", this.panEscape, true);
    globalThis.document.addEventListener("pointerdown", this.panReleaseDefault, true);
    globalThis.document.addEventListener("pointerup", this.panReleaseDefault, true);
    container.addEventListener("dragover", this.dragover);
    container.addEventListener("drop", this.drop);
    container.addEventListener("contextmenu", this.contextmenu);
    globalThis.document.addEventListener("keydown", this.clearTextClick, true);
    globalThis.document.addEventListener("pointerdown", this.textNavigationPointer, true);
    this.render();
    this.resizeObserver = new ResizeObserver(() => {
      const width = container.clientWidth;
      const pan = this.viewPan;
      if (pan && !this.panCurrent(pan)) this.cancelPan(pan);
      if (!this.destroyed && !this.drag && width > 0 && width !== this.renderedWidth)
        this.render({ preserveToolbar: true });
      else this.scheduleMedia();
    });
    this.resizeObserver.observe(container);
  }
  private current() {
    const document = this.context.read(),
      selection = this.context.selection();
    const sequence = document.sequences.find((item) => item.id === selection.sequenceId);
    if (!sequence) throw new Error("当前时间线不存在");
    return { document, sequence, selected: new Set(selection.clipIds) };
  }
  private run(work: () => void | Promise<void>) {
    try {
      void Promise.resolve(work()).catch((error) => this.context.onError(error));
    } catch (error) {
      this.context.onError(error);
    }
  }
  private async apply(operations: EditorOperation[], label: string) {
    this.notice.textContent = "";
    await this.context.apply(operations, label);
    this.render();
  }
  /** Magnetic moves that land where they started commit nothing; say why instead of staying silent. */
  private async applyMagneticMove(operations: EditorOperation[], label: string) {
    if (operations.length) return this.apply(operations, label);
    this.render();
    this.notice.textContent = MAGNETIC_MOVE_NOTICE;
  }
  private select(ids: Iterable<string>) {
    this.context.select([...ids]);
    this.render();
  }
  private clearStaleClipboard(document: EditorDocument): void {
    if (
      this.clipboard &&
      (this.clipboard.documentId !== document.id ||
        this.clipboard.generation !== this.context.identity?.().generation)
    ) {
      this.clipboard = undefined;
      this.notice.textContent = "";
    }
  }
  private async applyClipboard(
    operations: EditorOperation[],
    label: string,
    scope: { documentId: string; sequenceId: string; revision: number; generation?: number },
    committed: () => void,
  ): Promise<void> {
    if (this.clipboardPending) return;
    const current = (before = false) => {
      if (this.destroyed) return false;
      const { document, sequence } = this.current();
      return (
        document.id === scope.documentId &&
        (!before || document.revision === scope.revision) &&
        sequence.id === scope.sequenceId &&
        this.context.identity?.().generation === scope.generation
      );
    };
    this.clipboardPending = true;
    this.render();
    try {
      if (!current(true)) throw new Error("工程或序列已变化，请重新操作剪贴板");
      this.notice.textContent = "";
      await (this.context.applyClipboard ?? this.context.apply)(operations, label);
      if (current()) committed();
    } finally {
      this.clipboardPending = false;
      this.render();
    }
  }
  private expanded(sequence: EditorSequence, ids: Iterable<string>): Set<string> {
    const selected = new Set(ids);
    for (;;) {
      const before = selected.size;
      const chosen = sequence.clips.filter((clip) => selected.has(clip.id));
      const groups = new Set(chosen.map((clip) => clip.groupId).filter(Boolean));
      const links = new Set(chosen.map((clip) => clip.linkGroupId).filter(Boolean));
      for (const clip of sequence.clips)
        if (
          (clip.groupId && groups.has(clip.groupId)) ||
          (clip.linkGroupId && links.has(clip.linkGroupId))
        )
          selected.add(clip.id);
      if (before === selected.size) return selected;
    }
  }
  private viewport() {
    return this.container.querySelector<HTMLElement>(".et-scroll")!;
  }
  private trackInputCurrent(input: HTMLInputElement): boolean {
    const owner = this.trackInputs.get(input);
    if (this.destroyed || !owner || !this.currentTrackInputs.has(input) || !this.container.contains(input)) return false;
    return this.trackOwnerCurrent(owner);
  }
  private trackOwnerCurrent(owner: TrackInputOwner): boolean {
    if (this.destroyed) return false;
    const { document, sequence } = this.current();
    return document.id === owner.documentId && sequence.id === owner.sequenceId &&
      this.context.identity?.().generation === owner.generation &&
      sequence.tracks.some((track) => track.id === owner.trackId && track.kind === owner.kind);
  }
  private replacementChange = (event: Event): void => {
    if (this.replacingControls && event.target instanceof HTMLInputElement && event.target.matches(TRACK_INPUTS))
      event.stopImmediatePropagation();
  };
  /** Keep the focused input and every ancestor connected, including during native IME composition. */
  private patchFocusedTrackHead(current: HTMLElement, next: HTMLElement, focused: HTMLInputElement, replacement: HTMLInputElement): void {
    for (const attribute of [...current.attributes])
      if (!(current === focused && attribute.name === "value") && !next.hasAttribute(attribute.name))
        current.removeAttribute(attribute.name);
    for (const attribute of [...next.attributes])
      if (!(current === focused && attribute.name === "value")) current.setAttribute(attribute.name, attribute.value);
    if (current === focused) {
      if (replacement.disabled) focused.value = replacement.value;
      return;
    }
    const branch = [...current.children].find((child) => child.contains(focused)) as HTMLElement,
      nextBranch = [...next.children].find((child) => child.contains(replacement)) as HTMLElement;
    this.patchFocusedTrackHead(branch, nextBranch, focused, replacement);
    const children = [...next.childNodes], pivot = children.indexOf(nextBranch);
    for (const child of [...current.childNodes]) if (child !== branch) child.remove();
    for (const child of children.slice(0, pivot)) current.insertBefore(child, branch);
    for (const child of children.slice(pivot + 1)) current.append(child);
  }
  private retainTrackInput(markup: string, focused: HTMLInputElement, preserveToolbar: boolean): boolean {
    const next = globalThis.document.createElement("div");
    next.innerHTML = markup;
    const oldHead = focused.closest<HTMLElement>("[data-track-head]")!,
      oldHeads = oldHead.parentElement!,
      nextHeads = next.querySelector<HTMLElement>(".et-track-heads")!,
      nextHead = nextHeads.querySelector<HTMLElement>(`[data-track-head="${CSS.escape(oldHead.dataset.trackHead!)}"]`)!,
      selector = focused.dataset.etTrackName
        ? `[data-et-track-name="${CSS.escape(focused.dataset.etTrackName)}"]`
        : `[data-et-track-id="${CSS.escape(focused.dataset.etTrackId!)}"][data-et-track-mix="${focused.dataset.etTrackMix}"]`,
      nextInput = nextHead.querySelector<HTMLInputElement>(selector);
    if (!nextInput) return false;
    this.patchFocusedTrackHead(oldHead, nextHead, focused, nextInput);
    const children = [...nextHeads.childNodes], pivot = children.indexOf(nextHead);
    for (const child of [...oldHeads.childNodes]) if (child !== oldHead) child.remove();
    for (const child of children.slice(0, pivot)) oldHeads.insertBefore(child, oldHead);
    for (const child of children.slice(pivot + 1)) oldHeads.append(child);
    this.container.querySelector(".et-scroll")!.replaceWith(next.querySelector(".et-scroll")!);
    if (!preserveToolbar)
      this.container.querySelector(".et-toolbar")!.replaceWith(next.querySelector(".et-toolbar")!);
    if (nextInput.disabled)
      this.notice.textContent = "轨道已锁定，未提交的轨道输入已取消，请解锁后重新编辑";
    return true;
  }
  render(options: { preserveToolbar?: boolean; scrollLeft?: number } = {}): void {
    if (this.lastTextClick && this.lastTextClick.scope !== this.textClickScope()) this.clearTextClick();
    const textNavigation = this.textNavigation;
    if (textNavigation && !this.textNavigationCurrent(textNavigation)) this.cancelTextNavigation(textNavigation);
    this.cancelMarkerNavigation();
    const renderedAudioEdit = this.audioEdit;
    // A synchronous view update revokes a shortcut even if a getter returns its older value.
    if (this.trimShortcutPending) this.trimShortcutPending.cancelled = true;
    if (this.destroyed || this.replacingControls) return;
    const pan = this.viewPan;
    if (pan && !this.panCurrent(pan)) this.cancelPan(pan);
    this.media.cancel();
    const focused = globalThis.document.activeElement;
    const focusedClip =
      focused instanceof HTMLElement
        ? focused.closest<HTMLElement>("[data-et-clip]")?.dataset.etClip
        : undefined;
    const focusedFade = focused instanceof HTMLElement ? focused.dataset.etFade : undefined;
    const focusedGain = focused instanceof HTMLElement && focused.hasAttribute("data-et-gain");
    const renderIdentityValue = this.context.identity?.(), renderIdentity = renderIdentityValue ? { ...renderIdentityValue } : undefined;
    const restoreFocus = focused instanceof HTMLElement && this.container.contains(focused);
    // Only the explicit session-owned hook permits holding this detached read until RAF.
    const before = this.context.prepareMediaSnapshot && this.context.identity?.(),
      identity = before ? { ...before } : undefined,
      sequenceId = identity ? this.context.selection().sequenceId : undefined;
    const { document: project, sequence, selected } = this.current();
    if (this.audioEdit !== renderedAudioEdit) return;
    const audioEdit = renderedAudioEdit;
    if (audioEdit && !audioEdit.applying && !this.fieldScopeCurrent(audioEdit.field, audioEdit.prepared) && this.audioEdit === audioEdit)
      this.cancelAudioEdit();
    const candidate =
      identity && sequenceId === sequence.id ? { document: project, sequence, identity } : undefined;
    const mediaScope = candidate && this.mediaScopeCurrent(candidate) ? candidate : undefined;
    if (
      this.pendingControl &&
      !this.pendingControl.applying &&
      !this.fieldScopeCurrent(this.pendingControl.field)
    )
      this.cancelControl();
    this.clearStaleClipboard(project);
    const audibleAssets = new Set(project.assets.filter((asset) => asset.kind === "audio" || asset.kind === "video").map((asset) => asset.id));
    if (this.pendingTrackGesture && (this.pendingTrackGesture.owner
      ? !this.trackOwnerCurrent(this.pendingTrackGesture.owner) : !this.fieldGestureCurrent(this.pendingTrackGesture)))
      this.cancelTrackGesture();
    if (
      this.drag && (
        project.id !== this.drag.documentId || project.revision !== this.drag.revision ||
        this.context.identity?.().generation !== this.drag.generation || sequence.id !== this.drag.sequenceId
      )
    ) {
      this.cancel();
      this.context.onError(new Error("工程已变化，请重新拖动片段"));
    }
    if (this.confirmTrack && !this.trackConfirmationCurrent(project, sequence))
      this.confirmTrack = undefined;
    if (this.menu && !this.menuCurrent()) this.closeMenu();
    for (const id of selected)
      if (!sequence.clips.some((clip) => clip.id === id)) selected.delete(id);
    if (selected.size !== this.context.selection().clipIds.length)
      this.context.select([...selected]);
    const existing = this.container.querySelector<HTMLElement>(".et-scroll");
    if (options.scrollLeft !== undefined) this.scrollPosition = options.scrollLeft;
    else if (existing) this.scrollPosition = existing.scrollLeft;
    this.verticalPosition =
      this.container.querySelector<HTMLElement>(".et-body")?.scrollTop ?? this.verticalPosition;
    this.renderedWidth = this.container.clientWidth;
    const duration = Math.max(
        sequenceDuration(sequence),
        ...sequence.markers.map((marker) => marker.time + marker.duration),
      ),
      viewportWidth = Math.ceil(
        existing?.getBoundingClientRect().width || Math.max(1, this.renderedWidth - 176),
      );
    this.scale = Math.min(this.scale, 12000000 / Math.max(1, ticksToSeconds(duration)));
    const width = Math.max(viewportWidth, ticksToSeconds(duration) * this.scale + 150);
    this.scrollPosition = Math.max(0, Math.min(this.scrollPosition, width - viewportWidth));
    const left = this.scrollPosition,
      right = left + viewportWidth;
    let step = 1;
    const candidates = [
      1 / 60,
      1 / 30,
      0.1,
      0.2,
      0.5,
      1,
      2,
      5,
      10,
      20,
      30,
      60,
      120,
      300,
      600,
      1800,
      3600,
    ];
    step = candidates.find((value) => value * this.scale >= 64) ?? 3600;
    const ticks: string[] = [];
    for (
      let seconds = Math.max(0, Math.floor(left / this.scale / step) * step);
      seconds * this.scale <= right + 100;
      seconds += step
    ) {
      const time = frameToTicks(
        ticksToFrame(secondsToTicks(seconds), sequence.frameRate),
        sequence.frameRate,
      );
      ticks.push(`<span style="left:${ticksToSeconds(time) * this.scale}px">${stamp(time)}</span>`);
      if (ticks.length > 300) break;
    }
    const button = (
      action: string,
      label: string,
      icon: string,
      disabled = false,
      shortcut?: string,
      text = false,
      reason?: string,
      announce = false,
    ) => {
      // Split and delete stay focusable while unavailable so their reason can be announced.
      const soft = announce && disabled && reason;
      const state = soft
        ? ` aria-disabled="true" aria-describedby="et-${action}-reason"`
        : disabled
          ? " disabled"
          : "";
      return `<button type="button" data-et-action="${action}" class="et-tool${text ? " et-tool-labeled" : ""}" aria-label="${label}" title="${label}${shortcut ? ` · ${shortcut}` : ""}${disabled && reason ? `（${reason}）` : ""}"${state}>${timelineIcon(icon)}${text ? `<span>${label}</span>` : ""}</button>${soft ? `<span id="et-${action}-reason" class="disabled-reason" hidden>${reason}</span>` : ""}`;
    };
    const needSelection = "先选择片段";
    // Track creation sits in the sticky corner so it stays reachable however many tracks exist.
    const addTrack = (action: string, label: string, icon: string) =>
      `<button type="button" data-et-action="${action}" class="et-tool" aria-label="${label}" title="${label}">${timelineIcon("plus", 10)}${timelineIcon(icon, 13)}<span class="et-add-label">${label}</span></button>`;
    const markup = `<div class="et-toolbar" role="toolbar" aria-label="时间轴工具">
        <button type="button" class="et-tool et-follow" data-et-follow aria-label="播放跟随" aria-pressed="${this.followPlayback}"><span>播放跟随</span></button>
        <button type="button" class="et-tool" data-et-track-height aria-label="加高轨道" aria-pressed="${this.trackHeight === 80}"${this.trackHeightBlocked() ? " disabled" : ""}>加高轨道</button>
        ${this.context.addText ? `<div class="et-tool-group" role="group" aria-label="添加">${button("add-text", "添加文字", "title", false, undefined, true)}</div>` : ""}
        <div class="et-tool-group" role="group" aria-label="片段编辑">${button("split", "切分", "cut", !selected.size, "S", false, "先选择一个片段", true)}${button("delete", "删除", "trash", !selected.size, "⌫", false, needSelection, true)}</div>
        <div class="et-tool-group" role="group" aria-label="复制与分组">${button("copy", "复制", "copy", !selected.size || this.clipboardPending, "⌘/Ctrl C", false, this.clipboardPending ? "正在保存剪贴板操作" : needSelection)}${button("cut", "剪切", "cut", !selected.size || this.clipboardPending, "⌘/Ctrl X", false, this.clipboardPending ? "正在保存剪贴板操作" : needSelection)}${button("paste", "粘贴", "paste", !this.clipboard || this.clipboardPending, "⌘/Ctrl V · 粘贴到播放头；跨序列按第 N 条同类轨道对应", false, this.clipboardPending ? "正在保存剪贴板操作" : "先复制片段")}${button("duplicate", "原位复制", "duplicate", !selected.size || this.clipboardPending, "⌘/Ctrl D · 为副本新建平行轨", false, this.clipboardPending ? "正在保存剪贴板操作" : needSelection)}${button("group", "分组", "group", selected.size < 2, "⌘/Ctrl G", false, "至少选择两个片段")}${button("ungroup", "解组", "ungroup", !selected.size, "⇧ ⌘/Ctrl G", false, needSelection)}</div>
        <div class="et-tool-group et-mode" role="group" aria-label="时间线模式">${TIMELINE_MODES.map(([mode, label, title]) => {
          const blocked =
            mode === "magnetic" &&
            sequence.timelineMode !== "magnetic" &&
            !sequence.tracks.some((track) => track.kind === "video");
          return `<button type="button" data-et-mode="${mode}" aria-pressed="${sequence.timelineMode === mode}" title="${blocked ? "磁吸需要画面轨：序列里还没有画面轨，先添加画面轨" : title}"${blocked ? " disabled" : ""}>${label}</button>`;
        }).join("")}</div>
        <label class="et-snap" title="吸附 · 自动对齐片段边缘 · N"><input type="checkbox" data-et-snap aria-label="吸附" ${this.snapping ? "checked" : ""}>${timelineIcon("snap")}<span>吸附</span></label>
        <output class="et-selection-status" aria-live="polite">${selected.size ? `已选 ${selected.size} 个片段` : ""}</output>
        <span class="et-spacer"></span>
        <div class="et-zoom-tools" role="group" aria-label="时间轴视图">${button("fit", "适合窗口", "fit", false, "Shift+Z")}${button("fit-selection", "适合所选片段", "fit", !selected.size, "Shift+F", true)}${button("zoom-out", "缩小时间轴", "minus", false, "−")}<label class="et-zoom" title="时间轴缩放 · Ctrl/⌘ + 滚轮"><input data-et-zoom type="range" min="-2" max="3" step="0.05" value="${Math.log10(this.scale)}" aria-label="时间轴缩放"></label>${button("zoom-in", "放大时间轴", "plus", false, "+")}${this.context.showShortcuts ? button("shortcuts", "剪辑快捷键", "keyboard", false, "?") : ""}</div>
      </div>
      <div class="et-body"><div class="et-track-heads"><div class="et-track-top"><span>轨道</span><span class="et-track-count">${sequence.tracks.length}</span><div class="et-add" role="group" aria-label="添加轨道">${addTrack("track-video", "新建画面轨", "film")}${addTrack("track-audio", "新建声音轨", "audio")}${addTrack("track-text", "新建文字轨", "title")}</div></div>${sequence.tracks
        .slice()
        .reverse()
        .map((track, index) => {
          const kindIcon = { video: "film", audio: "audio", text: "title" }[track.kind];
          const toggle = (key: "locked" | "hidden" | "muted", label: string, glyph: string) =>
            `<button type="button" data-et-track="${esc(track.id)}" data-et-toggle="${key}" aria-label="${label}${esc(track.name)}" title="${label}${esc(track.name)}${key !== "locked" && track.locked ? "（轨道已锁定，先解锁）" : ""}" aria-pressed="${track[key]}"${key !== "locked" && track.locked ? " disabled" : ""}>${timelineIcon(glyph, 14)}</button>`;
          // The magnetic main track anchors the timeline; the operation layer refuses to remove it.
          const deleteBlocked = track.locked
            ? "轨道已锁定，先解锁再删除"
            : track.id === sequence.magneticTrackId
              ? "这是磁吸主轨，不能删除"
              : "";
          const mix = `<div class="et-track-mix">${track.kind !== "text" ? `<label>音量<input type="number" min="0" max="400" step="any" value="${track.volume * 100}" data-et-track-id="${esc(track.id)}" data-et-track-mix="volume" aria-label="${esc(track.name)} 音量百分比" title="轨道音量（%）${track.locked ? "（轨道已锁定，先解锁）" : ""}"${track.locked ? " disabled" : ""}></label><label>声像<input type="number" min="-100" max="100" step="any" value="${track.pan * 100}" data-et-track-id="${esc(track.id)}" data-et-track-mix="pan" aria-label="${esc(track.name)} 声像" title="左 -100 · 居中 0 · 右 100${track.locked ? "（轨道已锁定，先解锁）" : ""}"${track.locked ? " disabled" : ""}></label>` : ""}<span class="et-spacer"></span><button type="button" data-et-up="${esc(track.id)}" aria-label="上移${esc(track.name)}" title="上移轨道${index === 0 ? "（已在最上方）" : ""}"${index === 0 ? " disabled" : ""}>${timelineIcon("up", 14)}</button><button type="button" data-et-down="${esc(track.id)}" aria-label="下移${esc(track.name)}" title="下移轨道${index === sequence.tracks.length - 1 ? "（已在最下方）" : ""}"${index === sequence.tracks.length - 1 ? " disabled" : ""}>${timelineIcon("down", 14)}</button><button type="button" data-et-delete-track="${esc(track.id)}" aria-label="删除轨道${esc(track.name)}" title="${deleteBlocked || "删除轨道"}"${deleteBlocked ? " disabled" : ""}>${timelineIcon("trash", 14)}</button></div>`;
          return `<div class="et-track-head et-track-${track.kind}${track.locked ? " is-locked" : ""}${track.hidden ? " is-hidden" : ""}" data-track-head="${esc(track.id)}">
            <div class="et-track-title"><span class="et-track-kind" title="${{ video: "画面轨道", audio: "声音轨道", text: "文字轨道" }[track.kind]}">${timelineIcon(kindIcon, 14)}</span><input value="${esc(track.name)}" data-et-track-name="${esc(track.id)}" aria-label="轨道名称 ${esc(track.name)}" title="重命名轨道"><span class="et-track-controls">${toggle("locked", track.locked ? "解锁" : "锁定", track.locked ? "locked" : "unlocked")}${toggle("hidden", track.hidden ? "显示" : "隐藏", track.hidden ? "hidden" : "visible")}${toggle("muted", track.muted ? "取消静音" : "静音", track.muted ? "muted" : "volume")}${track.kind !== "text" && this.context.toggleSolo ? `<button type="button" data-et-track="${esc(track.id)}" data-et-toggle="solo" aria-label="独轨试听${esc(track.name)}" title="独轨试听${esc(track.name)} · 可同时选择多轨 · 保留轨道静音 · 不影响导出" aria-pressed="${!!this.context.soloTracks?.().has(track.id)}">S</button>` : ""}</span></div>
            ${this.trackConfirmation(project, sequence, track) || mix}
          </div>`;
        })
        .join("")}</div>
      <div class="et-scroll"><div class="et-content" style="width:${width}px"><div class="et-ruler" aria-label="时间刻度" style="--et-ruler-step:${step * this.scale / 4}px">${ticks.join("")}</div><div class="et-marker-lane" aria-label="标记范围">${sequence.markers
        .filter(
          (marker) =>
            ticksToSeconds(marker.time + marker.duration) * this.scale >= left - 30 &&
            ticksToSeconds(marker.time) * this.scale <= right + 30,
        )
        .map(
          (marker) =>
            `<button type="button" class="et-marker${marker.duration ? " et-marker-range" : ""}${this.context.selectedMarker?.() === marker.id ? " selected" : ""}" style="left:${ticksToSeconds(marker.time) * this.scale}px;${marker.duration ? `width:${Math.max(6, ticksToSeconds(marker.duration) * this.scale)}px;` : ""}--marker-color:${esc(marker.color)}" data-et-marker="${esc(marker.id)}" aria-pressed="${this.context.selectedMarker?.() === marker.id}" aria-label="${marker.duration ? "范围" : "标记"} ${esc(marker.name)}" title="${esc(marker.name)} · ${stamp(marker.time)}${marker.duration ? ` — ${stamp(marker.time + marker.duration)}` : ""}${marker.note ? ` · ${esc(marker.note)}` : ""}">${marker.duration ? "↔" : "◆"}<span>${esc(marker.name)}</span></button>`,
        )
        .join("")}</div>${sequence.tracks
        .slice()
        .reverse()
        .map(
          (track) =>
            `<div class="et-lane et-lane-${track.kind}${track.locked ? " locked" : ""}${track.hidden ? " is-hidden" : ""}" data-et-lane="${esc(track.id)}" aria-label="${esc(track.name)}">${sequence.clips
              .filter(
                (clip) =>
                  clip.trackId === track.id &&
                  ((this.drag &&
                    !["box", "seek"].includes(this.drag.kind) &&
                    this.drag.ids.includes(clip.id)) ||
                    (ticksToSeconds(clip.start + clip.duration) * this.scale >= left - 200 &&
                      ticksToSeconds(clip.start) * this.scale <= right + 200)),
              )
              .map(
                (clip) =>
                  `<div role="option" aria-selected="${selected.has(clip.id)}" tabindex="0" class="et-clip et-${clip.kind} et-clip-${track.kind}${selected.has(clip.id) ? " selected" : ""}" data-et-clip="${esc(clip.id)}" style="left:${ticksToSeconds(clip.start) * this.scale}px;width:${Math.max(3, ticksToSeconds(clip.duration) * this.scale)}px" title="${esc(clipLabel(clip))} · ${stamp(clip.start)} — ${stamp(clip.start + clip.duration)}${clip.kind === "text" && this.context.editText ? " · 双击编辑文字" : ""}"><span class="et-edge left" data-et-edge="left" aria-label="裁剪开头"></span><span class="et-clip-label">${esc(clipLabel(clip))}</span>${clip.groupId ? '<span class="et-group">▣</span>' : ""}${selected.has(clip.id) ? this.fadeMarkup(clip, track, audibleAssets) + this.gainMarkup(clip, track, audibleAssets, left, right) : ""}<span class="et-edge right" data-et-edge="right" aria-label="裁剪结尾"></span></div>`,
              )
              .join("")}</div>`,
        )
        .join(
          "",
        )}<div class="et-playhead" style="left:${ticksToSeconds(this.context.time()) * this.scale}px"><i></i></div></div></div></div>`;
    const focusedTrack = focused instanceof HTMLInputElement && focused.matches(TRACK_INPUTS) &&
      this.trackInputCurrent(focused) ? focused : undefined,
      oldHeads = this.container.querySelector<HTMLElement>(".et-track-heads"),
      headIds = [...(oldHeads?.querySelectorAll<HTMLElement>("[data-track-head]") ?? [])].map((head) => head.dataset.trackHead),
      preserveTrack = focusedTrack && headIds.join("\0") === sequence.tracks.slice().reverse().map((track) => track.id).join("\0");
    // Removing or disabling a focused native input can synchronously fire change. It must
    // never commit an old draft while a restored project or another sequence is rendering.
    let retainedTrack = false;
    this.replacingControls = true;
    try {
      if (preserveTrack)
        retainedTrack = this.retainTrackInput(markup, focusedTrack, !!options.preserveToolbar);
      if (!retainedTrack) {
        if (options.preserveToolbar && this.container.querySelector(".et-toolbar")) {
          // A native range drag must keep its original input and pointer ownership alive.
          // Only the time viewport changes during zoom; toolbar state is unchanged.
          const next = globalThis.document.createElement("div");
          next.innerHTML = markup;
          this.container.querySelector(".et-body")!.replaceWith(next.querySelector(".et-body")!);
        } else this.container.innerHTML = markup;
      }
      if (options.preserveToolbar)
        this.container.querySelector<HTMLInputElement>("[data-et-zoom]")!.value = String(Math.log10(this.scale));
      if (this.trackControlPending || this.pendingTrackGesture || this.canvasFieldFinish)
        for (const control of this.container.querySelectorAll<HTMLInputElement | HTMLButtonElement>(`${TRACK_INPUTS},${TRACK_BUTTONS}`))
          control.disabled = true;
      if (this.pendingTrackGesture)
        for (const control of this.container.querySelectorAll<HTMLInputElement | HTMLButtonElement>('[data-et-zoom],[data-et-action="fit"],[data-et-action="fit-selection"],[data-et-action="zoom-in"],[data-et-action="zoom-out"]'))
          control.disabled = true;
    } finally {
      this.replacingControls = false;
    }
    if (focusedTrack && !retainedTrack)
      this.notice.textContent = "轨道结构已变化，未提交的轨道输入已取消，请重新编辑";
    const trackInputs = this.container.querySelectorAll<HTMLInputElement>(TRACK_INPUTS);
    this.currentTrackInputs = new WeakSet(trackInputs);
    for (const input of trackInputs) {
      if (this.trackInputs.has(input)) continue;
      const trackId = input.dataset.etTrackName ?? input.dataset.etTrackId!,
        track = sequence.tracks.find((item) => item.id === trackId)!;
      this.trackInputs.set(input, { documentId: project.id, generation: this.context.identity?.().generation,
        sequenceId: sequence.id, trackId, kind: track.kind });
    }
    const trackButtons = this.container.querySelectorAll<HTMLButtonElement>(TRACK_BUTTONS);
    this.currentTrackButtons = new WeakSet(trackButtons);
    for (const button of trackButtons) {
      if (this.trackButtons.has(button)) continue;
      const trackId = button.closest<HTMLElement>("[data-track-head]")!.dataset.trackHead!,
        track = sequence.tracks.find((item) => item.id === trackId)!;
      this.trackButtons.set(button, { documentId: project.id, generation: this.context.identity?.().generation,
        sequenceId: sequence.id, trackId, kind: track.kind });
    }
    const fades = this.container.querySelectorAll<HTMLElement>("[data-et-fade]");
    this.currentFadeControls = new WeakSet(fades);
    for (const control of fades) this.fadeOwners.set(control, {
      documentId: project.id, revision: project.revision, generation: renderIdentity?.generation,
      sequenceId: sequence.id, clipId: control.closest<HTMLElement>("[data-et-clip]")!.dataset.etClip!,
      side: control.dataset.etFade as AudioFadeSide,
    });
    const gains = this.container.querySelectorAll<HTMLElement>("[data-et-gain]");
    this.currentGainControls = new WeakSet(gains);
    for (const control of gains) this.gainOwners.set(control, {
      documentId: project.id, revision: project.revision, generation: renderIdentity?.generation,
      sequenceId: sequence.id, clipId: control.closest<HTMLElement>("[data-et-clip]")!.dataset.etClip!,
    });
    this.container.querySelector(".et-toolbar")!.after(this.notice);
    this.notice.after(this.dragReadout);
    const scroll = this.viewport();
    scroll.scrollLeft = this.scrollPosition;
    // Store the browser's clamped, rounded position before its queued scroll event.
    this.scrollPosition = scroll.scrollLeft;
    this.container.querySelector<HTMLElement>(".et-body")!.scrollTop = this.verticalPosition;
    scroll.addEventListener(
      "scroll",
      () => {
        // A scroll event queued for a scroller this render replaced still fires after it is
        // detached, where scrollLeft reads 0. Rendering for it would queue the next stale event.
        if (scroll !== this.viewport() || scroll.scrollLeft === this.scrollPosition) return;
        this.clearTextClick();
        if (this.playbackActive) this.suspendPlaybackFollow();
        this.scrollPosition = scroll.scrollLeft;
        if (!this.drag) this.render({ preserveToolbar: true });
      },
      { passive: true },
    );
    this.container
      .querySelector<HTMLElement>(".et-body")!
      .addEventListener("scroll", this.syncVerticalScroll, { passive: true });
    this.syncVerticalPosition(this.container.querySelector<HTMLElement>(".et-body")!);
    this.scheduleMedia(mediaScope);
    this.updateFollowControl();
    this.updateTrackHeightControl();
    if (this.drag?.kind === "box") this.createBox();
    if (restoreFocus && !(focused instanceof HTMLElement && focused.isConnected)) {
      const next = focusedClip
        ? this.container.querySelector<HTMLElement>(`[data-et-clip="${CSS.escape(focusedClip)}"]${focusedFade ? ` [data-et-fade="${CSS.escape(focusedFade)}"]` : focusedGain ? " [data-et-gain]" : ""}`)
        : undefined;
      (next ?? this.container).focus({ preventScroll: true });
    }
  }
  private syncVerticalScroll = (): void => {
    const body = this.container.querySelector<HTMLElement>(".et-body");
    // Restoring a replaced body's scrollTop queues an event for an already-rendered view.
    if (!body || body.scrollTop === this.verticalPosition) return;
    this.clearTextClick();
    this.syncVerticalPosition(body);
    this.scheduleMedia();
  };
  private syncVerticalPosition(body: HTMLElement): void {
    this.verticalPosition = body.scrollTop;
    // The inner horizontal scroller is a separate sticky containing block. Keep only
    // its time header fixed to the outer vertical viewport without shifting clip lanes.
    this.container.style.setProperty("--et-scroll-y", `${this.verticalPosition}px`);
  }
  private mediaScopeCurrent(scope: RenderedMediaScope): boolean {
    return (
      !!this.context.prepareMediaSnapshot &&
      scope.document.id === scope.identity.documentId &&
      scope.document.revision === scope.identity.revision &&
      sameIdentity(scope.identity, this.context.identity?.()) &&
      scope.sequence.id === this.context.selection().sequenceId
    );
  }
  private scheduleMedia = (rendered?: RenderedMediaScope): void => {
    if (this.destroyed) return;
    const scope = rendered && this.mediaScopeCurrent(rendered) ? rendered : undefined;
    this.media.cancel();
    if (this.mediaFrame !== undefined) cancelAnimationFrame(this.mediaFrame);
    this.mediaFrame = requestAnimationFrame(() => {
      this.mediaFrame = undefined;
      if (this.destroyed) return;
      const { document, sequence } = scope && this.mediaScopeCurrent(scope) ? scope : this.current();
      const viewport = this.viewport().getBoundingClientRect(),
        body = this.container.querySelector<HTMLElement>(".et-body")!.getBoundingClientRect();
      const strips: TimelineMediaStrip[] = [];
      const attachments: { node: HTMLElement; canvas: HTMLCanvasElement }[] = [];
      this.container
        .querySelectorAll<HTMLCanvasElement>("canvas.et-media-strip")
        .forEach((canvas) => canvas.remove());
      for (const node of this.container.querySelectorAll<HTMLElement>("[data-et-clip]")) {
        if (strips.length >= TIMELINE_MEDIA_LIMITS.strips) break;
        const clip = sequence.clips.find((clip) => clip.id === node.dataset.etClip)!;
        const track = sequence.tracks.find((track) => track.id === clip.trackId)!;
        if (track.hidden || !["media", "sequence", "multicam"].includes(clip.kind)) continue;
        const bounds = node.getBoundingClientRect();
        if (
          bounds.bottom <= body.top ||
          bounds.top >= body.bottom ||
          bounds.right <= viewport.left ||
          bounds.left >= viewport.right
        )
          continue;
        const left = Math.max(bounds.left, viewport.left),
          right = Math.min(bounds.right, viewport.right);
        const localStart = Math.max(0, Math.floor(((left - bounds.left) / this.scale) * 240000));
        const localEnd = Math.min(
          clip.duration,
          Math.ceil(((right - bounds.left) / this.scale) * 240000),
        );
        if (localStart >= localEnd) continue;
        const canvas = globalThis.document.createElement("canvas");
        canvas.className = "et-media-strip";
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", `${clip.label} · 缩略图、源音频包络和音量关键帧`);
        const stripHeight = Math.max(16, Math.min(this.trackHeight === 80 ? 48 : 32, node.clientHeight - 2));
        Object.assign(canvas.style, {
          left: `${left - bounds.left}px`,
          width: `${right - left}px`,
          height: `${stripHeight}px`,
        });
        attachments.push({ node, canvas });
        strips.push({
          clipId: clip.id,
          canvas,
          localStart,
          localEnd,
          width: right - left,
          height: stripHeight,
          hideVolumeLine: !!node.querySelector("[data-et-gain-line]"),
        });
      }
      // Measure every clip before inserting strips so each next bounds read does not
      // force styles to update after the preceding canvas changed the live DOM.
      for (const { node, canvas } of attachments) node.appendChild(canvas);
      const identity = this.context.identity?.();
      try {
        const snapshot = identity && this.context.prepareMediaSnapshot?.(document, identity);
        void (snapshot
          ? this.media.renderPrepared(snapshot, sequence.id, strips, identity!)
          : this.media.render(document, sequence.id, strips, identity));
      } catch (error) {
        this.context.onError(error);
      }
    });
  };
  /** Retry visible media after resource bytes or availability change without an edit. */
  refreshMedia(): void {
    if (this.destroyed) return;
    this.media.reset();
    this.scheduleMedia();
  }
  /** Scrolls a clip into view, drawing it first when it lies outside the drawn time window. */
  reveal(clipId: string): void {
    const clip = this.current().sequence.clips.find((item) => item.id === clipId);
    const viewport = this.container.querySelector<HTMLElement>(".et-scroll");
    if (!clip || !viewport) return;
    const start = ticksToSeconds(clip.start) * this.scale;
    if (start < viewport.scrollLeft || start > viewport.scrollLeft + viewport.clientWidth - 40) {
      viewport.scrollLeft = Math.max(0, start - 40);
      this.render();
    }
    this.container
      .querySelector<HTMLElement>(`[data-et-clip="${CSS.escape(clipId)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  updatePlayhead(): void {
    if (this.trimShortcutPending) this.trimShortcutPending.cancelled = true;
    const navigation = this.markerNavigationPending, time = this.context.time();
    if (navigation && time !== navigation.target) this.cancelMarkerNavigation(navigation);
    const x = ticksToSeconds(time) * this.scale;
    if (
      this.playbackActive && this.followPlayback && !this.followSuspended &&
      !this.drag && !this.viewPan && !this.audioEdit && !this.textNavigation && !this.menu && !this.confirmTrack && !this.pendingControl &&
      !this.pendingTrackGesture && !this.canvasFieldFinish && !this.trackControlPending &&
      !this.fadePending && !this.clipboardPending && !editableTarget(globalThis.document.activeElement)
    ) {
      // Read the viewport before writing the moving line. A page turn puts the clock
      // well inside the next page, so ordinary playback never re-renders each frame.
      const viewport = this.viewport(), left = viewport.scrollLeft, width = viewport.clientWidth;
      if (left !== this.scrollPosition) this.suspendPlaybackFollow();
      else if (width > 0 && (x < left || x >= left + width - Math.min(24, width / 8))) {
        this.render({ preserveToolbar: true, scrollLeft: Math.max(0, x - width / 4) });
        return;
      }
    }
    const line = this.container.querySelector<HTMLElement>(".et-playhead");
    if (line) line.style.left = `${x}px`;
  }
  /** Playback following changes only the view; seeking and pausing keep its position. */
  setPlaybackActive(playing: boolean): void {
    if (this.destroyed) return;
    if (playing && !this.playbackActive) {
      // Finish a scroll queued by the previous playback episode before resuming.
      // Rendering also updates the virtual window and detaches its stale scroller.
      const viewport = this.viewport();
      if (viewport.scrollLeft !== this.scrollPosition)
        this.render({ preserveToolbar: true, scrollLeft: viewport.scrollLeft });
      this.followSuspended = false;
    }
    this.playbackActive = playing;
    this.updateFollowControl();
  }
  private suspendPlaybackFollow(): void {
    if (!this.followPlayback || this.followSuspended) return;
    this.followSuspended = true;
    this.updateFollowControl();
  }
  private updateFollowControl(): void {
    const control = this.container.querySelector<HTMLButtonElement>("[data-et-follow]");
    if (!control) return;
    const suspended = this.followPlayback && this.followSuspended;
    control.setAttribute("aria-pressed", String(this.followPlayback));
    control.setAttribute("aria-label", suspended ? "恢复播放跟随" : "播放跟随");
    control.querySelector("span")!.textContent = suspended ? "恢复跟随" : "播放跟随";
    control.title = suspended
      ? "手动横滚已暂停本轮跟随；点击恢复，或暂停后再次播放"
      : this.followPlayback
        ? "播放头越界时自动翻页；手动横滚可暂停本轮跟随"
        : "开启播放跟随；只影响时间轴视图";
  }
  private trackHeightBlocked(): boolean {
    return !!(this.destroyed || this.drag || this.viewPan || this.audioEdit || this.textNavigation || this.pendingControl || this.pendingTrackGesture ||
      this.trackControlPending || this.canvasFieldFinish || this.fadePending || this.clipboardPending);
  }
  private updateTrackHeightControl(): void {
    const control = this.container.querySelector<HTMLButtonElement>("[data-et-track-height]");
    if (!control) return;
    control.disabled = this.trackHeightBlocked();
    control.setAttribute("aria-pressed", String(this.trackHeight === 80));
    control.title = this.trackHeight === 80
      ? "当前为加高轨道；点击恢复紧凑视图。只调整显示，不改变工程"
      : "加高轨道，放大缩略图和源音频包络。只调整显示，不改变工程";
  }
  private toggleTrackHeight(): void {
    if (this.trackHeightBlocked()) return;
    const body = this.container.querySelector<HTMLElement>(".et-body")!;
    const position = body.scrollTop / this.trackHeight;
    this.trackHeight = this.trackHeight === 48 ? 80 : 48;
    this.container.classList.toggle("et-tall-tracks", this.trackHeight === 80);
    // Preserve the top track and its visible fraction; the browser clamps short timelines.
    body.scrollTop = position * this.trackHeight;
    this.syncVerticalPosition(body);
    this.updateTrackHeightControl();
    // Keep every focused field and native IME node connected. Only media strips redraw.
    this.scheduleMedia();
  }
  /** Keyboard navigation reveals the current result without changing the document or selection. */
  private async seekVisible(time: Tick, exact = false): Promise<void> {
    await this.context.seek(time, exact);
    this.revealPlayhead();
  }
  /** Reveal the current clock without changing selection, zoom or document history. */
  revealPlayhead(): void {
    if (this.destroyed) return;
    this.revealTime(this.context.time());
  }
  private revealTime(time: Tick): void {
    if (this.destroyed) return;
    const viewport = this.viewport(),
      x = ticksToSeconds(time) * this.scale,
      margin = Math.min(40, viewport.clientWidth / 4);
    if (x < viewport.scrollLeft + margin || x > viewport.scrollLeft + viewport.clientWidth - margin) {
      viewport.scrollLeft = Math.max(
        0,
        x - (x < viewport.scrollLeft + margin ? margin : viewport.clientWidth - margin),
      );
      this.render();
    }
  }
  private click = (event: MouseEvent) => {
    if (
      this.suppressedControlClick !== undefined &&
      event.detail > 0 &&
      (!(event instanceof PointerEvent) || event.pointerId === this.suppressedControlClick)
    ) {
      this.suppressedControlClick = undefined;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (this.pendingControl) {
      event.preventDefault();
      return;
    }
    const target = event.target instanceof HTMLElement ? event.target : undefined;
    if (!target) return;
    if (target.closest("[data-et-track-height]")) {
      this.toggleTrackHeight();
      return;
    }
    if (target.closest("[data-et-follow]")) {
      this.followPlayback = !this.followPlayback || this.followSuspended;
      this.followSuspended = false;
      this.updateFollowControl();
      this.updatePlayhead();
      return;
    }
    const control = target.closest<HTMLElement>("[data-et-action]");
    const action = control?.dataset.etAction;
    if (action) {
      if (control!.getAttribute("aria-disabled") !== "true") this.run(() => this.action(action));
      return;
    }
    const mode = target.closest<HTMLElement>("[data-et-mode]")?.dataset.etMode;
    if (mode === "magnetic" || mode === "free") {
      this.run(() => this.setMode(mode));
      return;
    }
    const trackButton = target.closest<HTMLButtonElement>(TRACK_BUTTONS);
    if (trackButton) {
      this.run(() => this.trackControl(trackButton));
      return;
    }
    const marker = target.closest<HTMLElement>("[data-et-marker]");
    if (marker)
      this.run(() => {
        const value = this.current().sequence.markers.find(
          (item) => item.id === marker.dataset.etMarker,
        );
        if (!value) return;
        if (this.context.selectMarker) this.context.selectMarker(value.id);
        else return this.context.seek(value.time);
      });
  };
  private change = (event: Event) => {
    const target = event.target as HTMLInputElement;
    if (target.matches(TRACK_INPUTS)) {
      if (this.replacingControls || this.trackControlPending || this.pendingTrackGesture || this.canvasFieldFinish || !this.trackInputCurrent(target)) return;
      this.run(async () => {
        const edit = this.trackInputEdit(target);
        if (edit) await this.apply([edit.operation], edit.label);
      });
      return;
    }
    if (target.matches("[data-et-snap]")) this.snapping = target.checked;
    if (target.matches("[data-et-zoom]")) {
      this.zoom(10 ** Number(target.value));
    }
  };
  private trackInputEdit(input: HTMLInputElement): { operation: EditorOperation; label: string } | undefined {
    if (!this.trackInputCurrent(input)) return;
    const { sequence } = this.current(), trackId = input.dataset.etTrackName ?? input.dataset.etTrackId!,
      track = sequence.tracks.find((item) => item.id === trackId)!;
    let patch: { name: string } | { volume: number } | { pan: number }, label: string;
    if (input.dataset.etTrackName) {
      if (input.value === track.name) return;
      patch = { name: input.value };
      label = "重命名轨道";
    } else {
      if (!input.value.trim() || !Number.isFinite(input.valueAsNumber) || !input.checkValidity())
        throw new Error("轨道音量必须为 0–400%，声像必须在左 100 到右 100 之间");
      const key = input.dataset.etTrackMix as "volume" | "pan", value = input.valueAsNumber / 100;
      if (track[key] === value) return;
      patch = { [key]: value } as { volume: number } | { pan: number };
      label = key === "volume" ? "调整轨道音量" : "调整轨道声像";
    }
    return { operation: { type: "track.update", sequenceId: sequence.id, trackId, patch }, label };
  }
  /** The canvas may finish one owned track field before taking its gesture snapshot. */
  finishFocusedField(signal: AbortSignal): boolean | Promise<boolean> | undefined {
    const input = globalThis.document.activeElement;
    if (!(input instanceof HTMLInputElement) || !input.matches(TRACK_INPUTS) || !this.container.contains(input)) return;
    if (!this.trackInputCurrent(input) || this.trackControlPending || this.pendingTrackGesture || this.canvasFieldFinish) return false;
    try { if (!this.trackInputEdit(input)) return true; } catch { /* The owned finisher reports and retains invalid input. */ }
    return this.finishCanvasField(input, signal);
  }
  private async finishCanvasField(input: HTMLInputElement, signal: AbortSignal): Promise<boolean> {
    const owner = this.trackInputs.get(input)!, revision = this.current().document.revision,
      selection = JSON.stringify(this.context.selection()), time = this.context.time(), token = {},
      selector = input.dataset.etTrackName ? `[data-et-track-name="${CSS.escape(input.dataset.etTrackName)}"]`
        : `[data-et-track-id="${CSS.escape(input.dataset.etTrackId!)}"][data-et-track-mix="${input.dataset.etTrackMix}"]`,
      current = (expected?: number) => !signal.aborted && this.trackOwnerCurrent(owner) && this.context.time() === time &&
        JSON.stringify(this.context.selection()) === selection && (expected === undefined || this.current().document.revision === expected);
    let value = input.value, saved = false;
    const abort = () => { if (this.canvasFieldFinish === token) { this.canvasFieldFinish = undefined; this.render(); } };
    this.canvasFieldFinish = token;
    signal.addEventListener("abort", abort, { once: true });
    try {
      this.replacingControls = true;
      try { input.blur(); } finally { this.replacingControls = false; }
      value = input.value;
      await Promise.resolve();
      if (!current(revision)) return false;
      const edit = this.trackInputEdit(input);
      this.render();
      if (edit) await this.apply([edit.operation], edit.label);
      saved = true;
      return current(revision + Number(!!edit));
    } catch (error) {
      if (current()) {
        this.context.onError(error);
        this.notice.textContent = error instanceof Error ? error.message : String(error);
      }
      return false;
    } finally {
      signal.removeEventListener("abort", abort);
      if (this.canvasFieldFinish === token) this.canvasFieldFinish = undefined;
      if (!this.destroyed) this.render();
      if (!saved && current(revision)) {
        const field = this.container.querySelector<HTMLInputElement>(selector);
        if (field && !field.disabled) { field.value = value; field.focus({ preventScroll: true }); }
      }
    }
  }
  /** Preserve the user's two explicit edits even when the first render replaces the clicked button. */
  private async trackControl(button: HTMLButtonElement): Promise<void> {
    const owner = this.trackButtons.get(button);
    if (this.trackControlPending || this.pendingTrackGesture || this.canvasFieldFinish || button.disabled || !owner || !this.currentTrackButtons.has(button) ||
      !this.container.contains(button)) return;
    if (!this.trackOwnerCurrent(owner)) {
      this.render();
      if (button.dataset.etDeleteConfirm) this.notice.textContent = "工程或序列已变化，请重新确认删除轨道";
      return;
    }
    const { document, sequence } = this.current(), data = { ...button.dataset },
      key = data.etToggle as "locked" | "hidden" | "muted" | "solo" | undefined,
      desired = key && key !== "solo" ? !sequence.tracks.find((track) => track.id === owner.trackId)![key] : undefined,
      confirmed = !!data.etDeleteConfirm && this.trackConfirmationCurrent(document, sequence, owner.trackId),
      input = globalThis.document.activeElement instanceof HTMLInputElement &&
        globalThis.document.activeElement.matches(TRACK_INPUTS) ? globalThis.document.activeElement : undefined,
      draft = input && this.trackInputCurrent(input) ? {
        value: input.value,
        selector: input.dataset.etTrackName ? `[data-et-track-name="${CSS.escape(input.dataset.etTrackName)}"]`
          : `[data-et-track-id="${CSS.escape(input.dataset.etTrackId!)}"][data-et-track-mix="${input.dataset.etTrackMix}"]`,
      } : undefined;
    let draftSaved = false, edit: ReturnType<EditorTimeline["trackInputEdit"]>;
    try {
      if (input && draft) {
        // Finish native IME and blur without its change handler racing the captured intent.
        this.replacingControls = true;
        try { input.blur(); } finally { this.replacingControls = false; }
        draft.value = input.value;
        edit = this.trackInputEdit(input);
      }
      this.trackControlPending = true;
      this.render();
      if (edit) await this.apply([edit.operation], edit.label);
      draftSaved = true;
      if (!this.trackOwnerCurrent(owner)) return;
      const current = this.current(), track = current.sequence.tracks.find((item) => item.id === owner.trackId)!;
      if (track.locked && key !== "locked" && key !== "solo" && !Object.hasOwn(data, "etDeleteCancel"))
        throw new Error("轨道已锁定，请先解锁再操作");
      if (key === "solo") this.context.toggleSolo?.(owner.trackId);
      else if (key) {
        if (track[key] !== desired)
          await this.apply([{ type: "track.update", sequenceId: owner.sequenceId, trackId: owner.trackId, patch: { [key]: desired } }], "调整轨道");
      } else if (Object.hasOwn(data, "etDeleteCancel")) this.confirmTrack = undefined;
      else if (data.etDeleteTrack || data.etDeleteConfirm) {
        if (confirmed && edit && current.document.revision === document.revision + 1)
          this.confirmTrack = { trackId: owner.trackId, documentId: owner.documentId, generation: owner.generation,
            sequenceId: owner.sequenceId, revision: current.document.revision };
        await this.removeTrack(owner.trackId, !!data.etDeleteConfirm);
      } else {
        const ids = current.sequence.tracks.map((item) => item.id), from = ids.indexOf(owner.trackId),
          to = from + (data.etUp ? 1 : -1);
        if (to < 0 || to >= ids.length) return;
        [ids[from], ids[to]] = [ids[to]!, ids[from]!];
        await this.apply([{ type: "track.reorder", sequenceId: owner.sequenceId, trackIds: ids }], "轨道排序");
      }
    } catch (error) {
      if (this.trackOwnerCurrent(owner)) {
        this.context.onError(error);
        this.notice.textContent = error instanceof Error ? error.message : String(error);
      }
    } finally {
      this.trackControlPending = false;
      this.render();
      if (!draftSaved && draft && this.trackOwnerCurrent(owner)) {
        const field = this.container.querySelector<HTMLInputElement>(draft.selector);
        if (field && !field.disabled) { field.value = draft.value; field.focus({ preventScroll: true }); }
      }
      if (data.etDeleteTrack && this.trackOwnerCurrent(owner) && this.confirmTrack?.trackId === owner.trackId)
        this.container.querySelector<HTMLButtonElement>(`[data-et-delete-confirm="${CSS.escape(owner.trackId)}"]`)?.focus({ preventScroll: true });
    }
  }
  private input = (event: Event): void => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.matches("[data-et-zoom]"))
      this.zoom(10 ** Number(target.value));
  };
  /** Keep the visible playhead in place, or the viewport's middle when it is off screen. */
  private zoom(scale: number, offset?: number): void {
    if (this.drag || this.pendingTrackGesture || this.destroyed || !Number.isFinite(scale)) return;
    const viewport = this.viewport(),
      { sequence } = this.current(),
      duration = Math.max(
        sequenceDuration(sequence),
        ...sequence.markers.map((marker) => marker.time + marker.duration),
      ),
      next = Math.min(1000, 12000000 / Math.max(1, ticksToSeconds(duration)), Math.max(0.01, scale));
    if (next === this.scale) {
      // A long sequence can reach its pixel limit before the range reaches its end.
      this.container.querySelector<HTMLInputElement>("[data-et-zoom]")!.value = String(
        Math.log10(this.scale),
      );
      return;
    }
    const playhead = ticksToSeconds(this.context.time()) * this.scale - viewport.scrollLeft,
      anchor =
        offset ??
        (playhead >= 0 && playhead <= viewport.clientWidth ? playhead : viewport.clientWidth / 2),
      time = (viewport.scrollLeft + anchor) / this.scale;
    this.scale = next;
    this.render({ preserveToolbar: true, scrollLeft: time * next - anchor });
  }
  private wheel = (event: WheelEvent): void => {
    this.clearTextClick();
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(".et-scroll")) return;
    if (this.viewPan) { event.preventDefault(); return; }
    const viewport = this.viewport();
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      if (this.drag || this.menu) return;
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1,
        delta = (event.deltaY || event.deltaX) * units,
        offset = Math.max(
          0,
          Math.min(viewport.clientWidth, event.clientX - viewport.getBoundingClientRect().left),
        );
      this.zoom(this.scale * Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.002), offset);
    } else if (event.shiftKey && !this.drag) {
      // Browsers may already convert Shift+wheel to deltaX; handle either representation.
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1;
      const delta = (event.deltaX || event.deltaY) * units;
      if (!delta || viewport.scrollWidth <= viewport.clientWidth) return;
      event.preventDefault();
      viewport.scrollLeft += delta;
    }
  };
  private trackConfirmationCurrent(
    document: EditorDocument,
    sequence: EditorSequence,
    trackId?: string,
  ): boolean {
    const pending = this.confirmTrack;
    return (
      !!pending &&
      (trackId === undefined || pending.trackId === trackId) &&
      pending.documentId === document.id &&
      pending.revision === document.revision &&
      pending.sequenceId === sequence.id &&
      pending.generation === this.context.identity?.().generation &&
      sequence.tracks.some((track) => track.id === pending.trackId)
    );
  }
  private trackConfirmation(
    document: EditorDocument,
    sequence: EditorSequence,
    track: EditorTrack,
  ): string {
    if (!this.trackConfirmationCurrent(document, sequence, track.id)) return "";
    const count = sequence.clips.filter((clip) => clip.trackId === track.id).length;
    return `<div class="et-track-confirm" role="alert"><span>删除轨道和 ${count} 个片段？</span><button type="button" class="danger" data-et-delete-confirm="${esc(track.id)}">删除</button><button type="button" data-et-delete-cancel>取消</button></div>`;
  }
  /** Empty tracks go at once; a track with clips asks first. Either way it is one undo step. */
  private async removeTrack(trackId: string, confirmed: boolean): Promise<void> {
    const { document, sequence } = this.current();
    const track = sequence.tracks.find((item) => item.id === trackId);
    if (!track) return;
    if (confirmed && !this.trackConfirmationCurrent(document, sequence, trackId)) {
      this.confirmTrack = undefined;
      this.render();
      this.notice.textContent = "工程或序列已变化，请重新确认删除轨道";
      return;
    }
    const count = sequence.clips.filter((clip) => clip.trackId === trackId).length;
    if (count && !confirmed) {
      this.confirmTrack = {
        trackId,
        documentId: document.id,
        revision: document.revision,
        sequenceId: sequence.id,
        generation: this.context.identity?.().generation,
      };
      this.render();
      this.container
        .querySelector<HTMLElement>(`[data-et-delete-confirm="${CSS.escape(trackId)}"]`)
        ?.focus({ preventScroll: true });
      return;
    }
    this.confirmTrack = undefined;
    await this.apply(
      [
        {
          type: "track.remove",
          sequenceId: sequence.id,
          trackId,
          ...(count ? { removeClips: true } : {}),
        },
      ],
      "删除轨道",
    );
  }
  /** The same planner as the timing panel: turning magnetic on closes the main picture track's gaps. */
  private async setMode(mode: "magnetic" | "free"): Promise<void> {
    const { document, sequence } = this.current();
    if (sequence.timelineMode === mode) return;
    await this.apply(
      planTimelineArrangement(document, sequence.id, { mode, compact: mode === "magnetic" }),
      "切换时间线排列",
    );
  }
  private cancelAudioEdit(): void {
    const pending = this.audioEdit;
    this.audioEdit = undefined;
    pending?.field.controller.abort();
    this.updateTrackHeightControl();
  }
  private async editOriginalAudio(action: "detach-audio" | "unlink-audio", expected?: NonNullable<EditorTimeline["menu"]>): Promise<void> {
    if (this.destroyed || this.audioEdit || this.viewPan || this.textNavigation || this.drag || this.pendingControl || this.pendingTrackGesture ||
      this.clipboardPending || this.trackControlPending || this.canvasFieldFinish || this.fadePending) return;
    const identity = this.context.identity?.(), selection = this.context.selection(), time = this.context.time(),
      ids = [...selection.clipIds], signature = JSON.stringify(selection),
      document = identity ? undefined : this.current().document;
    if (expected && (expected.documentId !== (identity?.documentId ?? document!.id) ||
      expected.revision !== (identity?.revision ?? document!.revision) || expected.generation !== identity?.generation ||
      expected.sequenceId !== selection.sequenceId || expected.selected.length !== ids.length ||
      !expected.selected.every((id) => ids.includes(id)))) return;
    const pending = { applying: false, prepared: false, field: { controller: new AbortController(), identity: {
      documentId: identity?.documentId ?? document!.id, revision: identity?.revision ?? document!.revision,
      generation: identity?.generation }, selection: signature, time, viewport: this.gestureViewport() } };
    this.audioEdit = pending;
    this.updateTrackHeightControl();
    const current = () => {
      const valid = this.fieldScopeCurrent(pending.field, pending.prepared), available = this.context.canTrimAtPlayhead?.(time) ?? true;
      return valid && available && this.audioEdit === pending && !pending.field.controller.signal.aborted;
    };
    try {
      if (!current()) return;
      const signal = pending.field.controller.signal,
        ready = this.finishFocusedField(signal) ?? this.context.beforeGesture?.(signal) ?? true,
        accepted = ready instanceof Promise ? await ready : ready;
      if (!accepted || !current()) return;
      const before = this.context.identity?.(), scope = before ? { ...before } : undefined,
        fresh = this.current();
      if (!current() || fresh.sequence.id !== selection.sequenceId ||
        (scope && (fresh.document.id !== scope.documentId || fresh.document.revision !== scope.revision))) return;
      pending.field.identity.revision = fresh.document.revision;
      pending.prepared = true;
      const plan = action === "detach-audio"
        ? planDetachOriginalAudio(fresh.document, fresh.sequence.id, ids.length === 1 ? ids[0]! : "", () => uid("audio"))
        : { operations: planUnlinkAudio(fresh.document, fresh.sequence.id, ids), audioClipId: undefined },
        after = this.context.identity?.();
      if (!current() || (scope && !sameIdentity(scope, after))) return;
      pending.applying = true;
      await (this.context.applyClipboard ?? this.context.apply)(plan.operations,
        action === "detach-audio" ? "分离原声" : "解除音画链接");
      pending.field.identity.revision = fresh.document.revision + 1;
      pending.applying = false;
      const latest = this.context.identity?.(), selected = this.context.selection(), clock = this.context.time(),
        available = this.context.canTrimAtPlayhead?.(time) ?? true;
      if (!current() || !available || clock !== time ||
        JSON.stringify(selected) !== signature || (scope && (latest?.documentId !== scope.documentId ||
          latest.generation !== scope.generation || latest.revision !== scope.revision + 1))) return;
      this.select([plan.audioClipId ?? expected?.clipId ?? ids[0]!]);
      this.notice.textContent = action === "detach-audio"
        ? "原声已分离，默认音画联动；右键解除链接可单独移动声音。原轨若静音，新音轨也静音。"
        : "音画链接已解除；普通分组和字幕来源绑定保持不变。";
    } catch (error) {
      pending.applying = false;
      if (current()) this.context.onError(error);
    } finally {
      if (this.audioEdit === pending) { this.cancelAudioEdit(); if (!this.destroyed) this.render(); }
    }
  }
  async action(action: string, at = this.context.time()): Promise<void> {
    if (this.audioEdit || this.textNavigation) return;
    if (action === "detach-audio" || action === "unlink-audio") {
      await this.editOriginalAudio(action);
      return;
    }
    if (action === "zoom-in" || action === "zoom-out") {
      this.zoom(this.scale * (action === "zoom-in" ? 1.5 : 1 / 1.5));
      return;
    }
    if (action === "shortcuts") {
      await this.context.showShortcuts?.();
      return;
    }
    if (action === "add-text") {
      await this.context.addText?.();
      return;
    }
    const fitIdentity = action === "fit-selection" ? this.context.identity?.() : undefined;
    const fitScope = action === "fit-selection" ? {
      identity: fitIdentity ? { ...fitIdentity } : undefined,
      selection: JSON.stringify(this.context.selection()), control: this.pendingControl,
    } : undefined;
    const { document, sequence, selected } = this.current(),
      ids = [...selected],
      time = at,
      scope = {
        documentId: document.id,
        sequenceId: sequence.id,
        revision: document.revision,
        generation: this.context.identity?.().generation,
      };
    this.clearStaleClipboard(document);
    if (this.clipboardPending && ["copy", "cut", "paste", "duplicate"].includes(action)) return;
    if (action === "copy") {
      this.clipboard = {
        payload: copyClips(document, sequence.id, ids),
        documentId: document.id,
        generation: scope.generation,
      };
      this.render();
      return;
    }
    if (action === "cut") {
      const plan = planCutClips(document, sequence.id, ids);
      await this.applyClipboard(plan.operations, "剪切片段", scope, () => {
        this.clipboard = {
          payload: plan.payload,
          documentId: document.id,
          generation: scope.generation,
        };
        this.select([]);
      });
      return;
    }
    if (action === "paste") {
      if (!this.clipboard) return;
      const operations = planTimelinePaste(document, sequence.id, this.clipboard.payload, {
        at: time,
        idFactory: uid,
      });
      await this.applyClipboard(operations, "粘贴片段", scope, () =>
        this.select(operations.flatMap((op) => (op.type === "clip.add" ? [op.clip.id] : []))),
      );
      return;
    }
    if (action === "duplicate") {
      const operations = duplicateClipsInPlace(document, sequence.id, ids, { idFactory: uid });
      await this.applyClipboard(operations, "原位复制片段", scope, () =>
        this.select(operations.flatMap((op) => (op.type === "clip.add" ? [op.clip.id] : []))),
      );
      return;
    }
    if (action === "delete") {
      await this.apply(
        sequence.timelineMode === "magnetic"
          ? planMagneticRemove(document, sequence.id, ids)
          : [{ type: "clip.remove", sequenceId: sequence.id, clipIds: ids }],
        "删除片段",
      );
      this.select([]);
      return;
    }
    if (action === "split") {
      const plan = planSplitClips(document, sequence.id, ids, time, uid),
        generation = this.context.identity?.().generation;
      await this.apply(plan.operations, "切分片段");
      // Keep the complete right-hand group ready for the next edit; bound subtitles follow sources.
      const current = this.current();
      if (
        current.document.id === document.id &&
        current.sequence.id === sequence.id &&
        generation === this.context.identity?.().generation
      )
        this.select(plan.rightClipIds);
      return;
    }
    if (action === "keep-left" || action === "keep-right") {
      await this.keepAtPlayhead(document, sequence, ids, time, action);
      return;
    }
    if (action === "group") {
      await this.apply(groupClips(document, sequence.id, ids, uid("group")), "片段分组");
      return;
    }
    if (action === "ungroup") {
      await this.apply(ungroupClips(document, sequence.id, ids), "片段解组");
      return;
    }
    if (action === "fit-selection") {
      if (this.drag || this.pendingTrackGesture || this.destroyed ||
        fitScope?.control !== this.pendingControl ||
        fitScope?.selection !== JSON.stringify(this.context.selection()) ||
        (fitScope?.identity && (!sameIdentity(fitScope.identity, this.context.identity?.()) ||
          document.id !== fitScope.identity.documentId || document.revision !== fitScope.identity.revision)) ||
        (fitScope?.control && !this.fieldScopeCurrent(fitScope.control.field))) return;
      const clips = sequence.clips.filter((clip) => selected.has(clip.id));
      if (!ids.length || clips.length !== ids.length) return;
      const start = Math.min(...clips.map((clip) => clip.start)),
        end = Math.max(...clips.map((clip) => clip.start + clip.duration)),
        duration = Math.max(sequenceDuration(sequence), ...sequence.markers.map((marker) => marker.time + marker.duration)),
        width = this.viewport().clientWidth;
      this.scale = Math.min(1000, 12000000 / Math.max(1, ticksToSeconds(duration)),
        Math.max(0.01, (width - 60) / ticksToSeconds(end - start)));
      if (this.playbackActive) this.suspendPlaybackFollow();
      this.render({ preserveToolbar: true, scrollLeft: Math.max(0, ticksToSeconds(start) * this.scale - 30) });
      return;
    }
    if (action === "fit") {
      if (this.pendingTrackGesture) return;
      this.scale = Math.min(
        1000,
        Math.max(
          0.01,
          (this.viewport().clientWidth - 60) /
            Math.max(
              1,
              ticksToSeconds(
                Math.max(
                  sequenceDuration(sequence),
                  ...sequence.markers.map((marker) => marker.time + marker.duration),
                ),
              ),
            ),
        ),
      );
      this.scrollPosition = 0;
      this.viewport().scrollLeft = 0;
      this.render();
      return;
    }
    if (action.startsWith("track-")) {
      const kind = action.slice(6) as "video" | "audio" | "text";
      if (!["video", "audio", "text"].includes(kind)) return;
      await this.apply(
        [
          {
            type: "track.add",
            sequenceId: sequence.id,
            track: createTrack(
              uid("track"),
              kind,
              { video: "画面轨", audio: "声音轨", text: "文字轨" }[kind],
            ),
          },
        ],
        "添加轨道",
      );
    }
  }
  private async keepAtPlayhead(
    document: EditorDocument, sequence: EditorSequence, ids: string[], time: Tick,
    kind: "keep-left" | "keep-right", current?: () => boolean,
  ): Promise<void> {
    const selected = new Set(ids);
    if (!ids.length || sequence.clips.some((clip) =>
      selected.has(clip.id) && (time <= clip.start || time >= clip.start + clip.duration)))
      throw new Error("请把播放头移到每个所选片段内部，再保留左侧或右侧");
    const operations = planClipTiming(document, sequence.id, ids, { kind, time });
    if (current && !current()) return;
    await this.apply(operations, kind === "keep-left" ? "保留播放头左侧" : "保留播放头右侧");
  }
  private async shortcutTrim(kind: "keep-left" | "keep-right"): Promise<void> {
    if (this.trimShortcutPending || this.markerNavigationPending || this.textNavigation || this.audioEdit || this.viewPan) return;
    const owner = { cancelled: false };
    this.trimShortcutPending = owner;
    let current = () => !this.destroyed && this.trimShortcutPending === owner && !owner.cancelled;
    try {
      const identity = this.context.identity?.(), selection = this.context.selection(),
        ids = [...selection.clipIds], sequenceId = selection.sequenceId, time = this.context.time(),
        signature = JSON.stringify(ids);
      current = () => {
        const selected = this.context.selection(), clock = this.context.time(), latest = this.context.identity?.(),
          available = this.context.canTrimAtPlayhead?.(time) ?? true;
        return available && selected.sequenceId === sequenceId && JSON.stringify(selected.clipIds) === signature &&
          clock === time && ((!identity && !latest) || sameIdentity(identity, latest)) &&
          !this.destroyed && this.trimShortcutPending === owner && !owner.cancelled;
      };
      if (!current()) return;
      const { document, sequence, selected } = this.current();
      if (!current() || sequence.id !== sequenceId || JSON.stringify([...selected]) !== signature ||
        (identity && (document.id !== identity.documentId || document.revision !== identity.revision))) return;
      await this.keepAtPlayhead(document, sequence, ids, time, kind, current);
    } catch (error) {
      // A late failure belongs only to the original shortcut scope.
      try { if (current()) this.context.onError(error); } catch { /* unavailable parent */ }
    } finally {
      if (this.trimShortcutPending === owner) this.trimShortcutPending = undefined;
    }
  }
  private cancelMarkerNavigation(expected = this.markerNavigationPending): void {
    if (!expected || this.markerNavigationPending !== expected) return;
    expected.cancelled = true;
    this.markerNavigationPending = undefined;
  }
  private async navigateMarker(next: boolean): Promise<void> {
    if (this.markerNavigationPending || this.trimShortcutPending || this.textNavigation || this.audioEdit || this.viewPan || this.destroyed) return;
    const owner: { cancelled: boolean; target?: Tick } = { cancelled: false };
    this.markerNavigationPending = owner;
    let current = (_time: Tick) => !this.destroyed && this.markerNavigationPending === owner && !owner.cancelled;
    let time = 0, target: Tick | undefined;
    try {
      const identity = this.context.identity?.(), selection = this.context.selection(),
        sequenceId = selection.sequenceId, selected = JSON.stringify(selection.clipIds);
      time = this.context.time();
      current = (clock: Tick) => {
        const selection = this.context.selection(), now = this.context.time(), latest = this.context.identity?.(),
          available = this.context.canNavigateMarkers?.(clock) ?? true;
        return available && now === clock && selection.sequenceId === sequenceId &&
          JSON.stringify(selection.clipIds) === selected &&
          ((!identity && !latest) || sameIdentity(identity, latest)) &&
          !this.destroyed && this.markerNavigationPending === owner && !owner.cancelled &&
          !this.drag && !this.pendingControl && !this.pendingTrackGesture && !this.trackControlPending &&
          !this.canvasFieldFinish && !this.fadePending && !this.clipboardPending && !this.trimShortcutPending &&
          !this.menu && !this.confirmTrack && !this.textNavigation && !this.audioEdit && !this.viewPan;
      };
      if (!current(time)) return;
      const { document, sequence } = this.current();
      if (!current(time) || sequence.id !== sequenceId ||
        (identity && (document.id !== identity.documentId || document.revision !== identity.revision))) return;
      const last = sequenceDuration(sequence) - 1,
        boundaries = new Set(sequence.markers.flatMap((marker) => [marker.time, marker.time + marker.duration]));
      for (const boundary of boundaries) {
        if (boundary > last) continue;
        if (next ? boundary > time && (target === undefined || boundary < target)
          : boundary < time && (target === undefined || boundary > target)) target = boundary;
      }
      if (target === undefined || !current(time)) return;
      owner.target = target;
      await this.context.seek(target, true);
      if (current(target)) this.revealTime(target);
    } catch (error) {
      try { if (current(time) || (target !== undefined && current(target))) this.context.onError(error); }
      catch { /* A superseded parent owns its own errors. */ }
    } finally {
      if (this.markerNavigationPending === owner) this.markerNavigationPending = undefined;
    }
  }
  private keydown = (event: KeyboardEvent) => {
    if (event.isComposing || editableTarget(event.target)) return;
    if (this.audioEdit) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Escape" && !this.audioEdit.applying) this.cancelAudioEdit();
      return;
    }
    if (this.textNavigation) {
      if (event.key === "Escape") this.cancelTextNavigation();
      event.preventDefault(); event.stopPropagation();
      return;
    }
    if (event.repeat && ["Enter", " "].includes(event.key) &&
      event.target instanceof Element && event.target.closest("[data-et-track-height]")) {
      event.preventDefault();
      return;
    }
    if (this.pendingControl) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") this.cancelControl();
      return;
    }
    const gain = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-et-gain]") : undefined;
    if (gain && !event.ctrlKey && !event.metaKey && !event.altKey &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (!this.drag && !this.pendingTrackGesture && !this.fadePending) this.run(() => this.keyGain(gain, event));
      return;
    }
    const fade =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>("[data-et-fade]")
        : undefined;
    if (
      fade &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (!this.drag && !this.pendingTrackGesture && !this.fadePending)
        this.run(() => this.keyFade(fade, event));
      return;
    }
    if (this.pendingTrackGesture) {
      event.preventDefault();
      if (event.key === "Escape") { this.cancel(); this.render(); }
      else if (event.key === "Alt" && !this.pendingTrackGesture.up)
        this.pendingTrackGesture.last = { ...this.pendingTrackGesture.last, altKey: true };
      return;
    }
    if (event.key === "Alt" && this.drag) {
      event.preventDefault();
      this.drag.altKey = true;
      this.run(() => this.updateDrag(true));
      return;
    }
    if (event.key === "Escape" && this.confirmTrack) {
      event.preventDefault();
      this.confirmTrack = undefined;
      this.render();
      return;
    }
    const contextTarget =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>("[data-et-clip]")
        : undefined;
    if (contextTarget && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
      event.preventDefault();
      event.stopPropagation();
      const rect = contextTarget.getBoundingClientRect();
      this.openMenu(contextTarget.dataset.etClip!, rect.left, rect.bottom);
      return;
    }
    if (event.key === "Escape") {
      this.cancel();
      this.select([]);
      return;
    }
    const modified = event.ctrlKey || event.metaKey;
    if (
      !modified && !event.altKey && !this.drag && !this.confirmTrack && !this.menu &&
      !(event.target instanceof HTMLElement && event.target.closest("button"))
    ) {
      if (event.shiftKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat && !globalThis.document.querySelector("dialog[open]"))
          void this.navigateMarker(event.key === "ArrowDown");
        return;
      }
      if (!event.shiftKey && ["q", "w"].includes(event.key.toLowerCase())) {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat && !this.trackControlPending && !this.fadePending && !this.clipboardPending &&
          !this.canvasFieldFinish && !globalThis.document.querySelector("dialog[open]"))
          void this.shortcutTrim(event.key.toLowerCase() === "q" ? "keep-right" : "keep-left");
        return;
      }
      if (event.key.toLowerCase() === "m" && this.context.beginMarker &&
        !this.trackControlPending && !this.fadePending && !this.clipboardPending && !this.trimShortcutPending && !this.markerNavigationPending &&
        !globalThis.document.querySelector("dialog[open]")) {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat) this.run(() => this.context.beginMarker!(event.shiftKey ? "range" : "point"));
        return;
      }
      const { sequence } = this.current(),
        last = lastFrameTime(sequence);
      if (event.key === "?" && this.context.showShortcuts) {
        event.preventDefault();
        if (!event.repeat) this.run(() => this.action("shortcuts"));
        return;
      }
      if (["Home", "End", "ArrowUp", "ArrowDown"].includes(event.key) && !event.shiftKey) {
        event.preventDefault();
        const time = this.context.time(),
          next = event.key === "ArrowDown";
        let target = event.key === "Home" || event.key === "ArrowUp" ? 0 : last;
        if (event.key === "ArrowUp" || next) {
          const end = Math.max(0, sequenceDuration(sequence) - 1);
          let candidate: Tick | undefined;
          if (next) target = Math.min(end, Math.max(time, last));
          for (const clip of sequence.clips) {
            for (const boundary of [clip.start, clip.start + clip.duration]) {
              if (boundary > end) continue;
              if (next
                ? boundary > time && (candidate === undefined || boundary < candidate)
                : boundary < time && (candidate === undefined || boundary > candidate))
                candidate = boundary;
            }
          }
          if (candidate !== undefined) target = candidate;
        }
        this.run(() => this.seekVisible(target, true));
        return;
      }
      if (event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (!event.repeat) this.run(() => this.action("fit-selection"));
        return;
      }
      if (event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        this.run(() => this.action("fit"));
        return;
      }
      if (["+", "=", "-"].includes(event.key)) {
        event.preventDefault();
        this.run(() => this.action(event.key === "-" ? "zoom-out" : "zoom-in"));
        return;
      }
      if (!event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (!event.repeat) {
          this.snapping = !this.snapping;
          this.render();
        }
        return;
      }
    }
    const option =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>("[data-et-clip]")
        : undefined;
    if (option && ["Enter", " ", "Spacebar"].includes(event.key)) {
      event.preventDefault();
      if (event.repeat || this.drag) return;
      const { sequence, selected } = this.current(),
        id = option.dataset.etClip!;
      const group = this.expanded(sequence, [id]);
      if (modified || event.shiftKey) {
        if (selected.has(id)) for (const member of group) selected.delete(member);
        else for (const member of group) selected.add(member);
      } else {
        selected.clear();
        for (const member of group) selected.add(member);
      }
      this.select(selected);
      return;
    }
    if (modified && event.key.toLowerCase() === "a") {
      event.preventDefault();
      this.select(this.current().sequence.clips.map((clip) => clip.id));
      return;
    }
    const action = modified
      ? (
          {
            c: "copy",
            x: "cut",
            v: "paste",
            d: "duplicate",
            g: event.shiftKey ? "ungroup" : "group",
          } as Record<string, string>
        )[event.key.toLowerCase()]
      : ["Delete", "Backspace"].includes(event.key)
        ? "delete"
        : event.key.toLowerCase() === "s"
          ? "split"
          : undefined;
    if (action) {
      event.preventDefault();
      if (event.repeat) return;
      this.run(() => this.action(action));
      return;
    }
    if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const { document, sequence, selected } = this.current();
      const delta =
        frameToTicks(event.shiftKey ? 10 : 1, sequence.frameRate) *
        (event.key === "ArrowLeft" ? -1 : 1);
      // An exact cut point can be after the final frame's start. Right must not jump backward.
      if (!modified && delta > 0 && this.context.time() >= lastFrameTime(sequence)) return;
      this.run(() =>
        modified && selected.size
          ? sequence.timelineMode === "magnetic"
            ? this.applyMagneticMove(
                planMagneticMove(document, sequence.id, [...selected], {
                  delta,
                  direction: event.key === "ArrowLeft" ? "previous" : "next",
                }),
                "磁吸移动片段",
              )
            : this.apply(
                [{ type: "clip.move", sequenceId: sequence.id, clipIds: [...selected], delta }],
                "逐帧移动片段",
              )
          : this.seekVisible(
              Math.min(
                lastFrameTime(sequence),
                Math.max(0, this.context.time() + delta),
              ),
            ),
      );
    }
  };
  private keyup = (event: KeyboardEvent): void => {
    if (event.key === "Alt" && this.pendingTrackGesture) {
      event.preventDefault();
      if (!this.pendingTrackGesture.up)
        this.pendingTrackGesture.last = { ...this.pendingTrackGesture.last, altKey: false };
      return;
    }
    if (event.key !== "Alt" || !this.drag) return;
    event.preventDefault();
    this.drag.altKey = false;
    this.run(() => this.updateDrag(true));
  };
  private menuCurrent(): boolean {
    const menu = this.menu;
    if (!menu) return false;
    const { document, sequence, selected } = this.current();
    return (
      document.id === menu.documentId &&
      document.revision === menu.revision &&
      this.context.identity?.().generation === menu.generation &&
      sequence.id === menu.sequenceId &&
      menu.selected.length === selected.size &&
      menu.selected.every((id) => selected.has(id) && sequence.clips.some((clip) => clip.id === id))
    );
  }
  private closeMenu(restoreFocus = false): void {
    const menu = this.menu;
    if (!menu) return;
    this.menu = undefined;
    menu.lifetime.abort();
    menu.element.remove();
    if (restoreFocus)
      this.container
        .querySelector<HTMLElement>(`[data-et-clip="${CSS.escape(menu.clipId)}"]`)
        ?.focus({ preventScroll: true });
  }
  private contextmenu = (event: MouseEvent): void => {
    const target =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>("[data-et-clip]")
        : undefined;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    // Some platforms emit a native context menu for Control-click; here that gesture selects additively.
    if (event.ctrlKey) return;
    if (this.suppressContextMenu) return;
    this.openMenu(target.dataset.etClip!, event.clientX, event.clientY);
  };
  private clearTextClick = (): void => { this.lastTextClick = undefined; };
  private textClickScope(): string {
    const identity = this.context.identity?.(), document = identity ? undefined : this.current().document;
    return JSON.stringify([identity ?? [document!.id, document!.revision], this.context.selection(),
      this.context.time(), this.gestureViewport()]);
  }
  private textNavigationPointer = (event: PointerEvent): void => {
    if (!(event.target instanceof Node) || !this.container.contains(event.target)) {
      this.clearTextClick();
      this.cancelTextNavigation();
    }
  };
  /** Capture suppresses native click/dblclick: recognize two completed mouse clicks locally. */
  private recordTextClick(drag: Drag, event: GesturePointer): void {
    const previous = this.lastTextClick;
    this.clearTextClick();
    if (drag.textClick === undefined || drag.moved || !drag.clip || !this.context.editText) return;
    const identity = this.context.identity?.(), selection = this.context.selection(), time = this.context.time();
    if (this.destroyed || this.audioEdit || this.viewPan || time !== drag.textClick || !(this.context.canEditText?.(time) ?? true) ||
      (identity && (identity.documentId !== drag.documentId || identity.revision !== drag.revision ||
        identity.generation !== drag.generation)) || selection.sequenceId !== drag.sequenceId) return;
    const scope = this.textClickScope(),
      click = { clipId: drag.clip.id, scope, x: event.clientX, y: event.clientY, at: performance.now() };
    if (previous && previous.clipId === click.clipId && previous.scope === scope &&
      click.at - previous.at <= 500 && Math.hypot(click.x - previous.x, click.y - previous.y) <= 4)
      this.openText(click.clipId);
    else this.lastTextClick = click;
  }
  private textNavigationCurrent(owner: TextNavigation, exactRevision = false): boolean {
    const current = this.fieldScopeCurrent(owner.field, exactRevision || owner.exact),
      available = this.context.canEditText?.(owner.field.time) ?? true;
    return current && available && !this.destroyed && this.container.isConnected && !this.audioEdit && !this.viewPan &&
      this.textNavigation === owner && !owner.field.controller.signal.aborted;
  }
  /** Cancel only this navigation; an older completion must not abort a newer field owner. */
  cancelTextNavigation(expected = this.textNavigation): void {
    if (expected && this.textNavigation !== expected) return;
    this.clearTextClick();
    if (!expected) return;
    this.textNavigation = undefined;
    expected.field.controller.abort();
    this.updateTrackHeightControl();
  }
  private openText(clipId: string): void {
    if (!this.context.editText || this.destroyed || this.textNavigation || this.audioEdit || this.viewPan ||
      this.markerNavigationPending || this.trimShortcutPending || this.drag || this.menu ||
      this.pendingControl || this.pendingTrackGesture || this.trackControlPending || this.canvasFieldFinish ||
      this.fadePending || this.clipboardPending || globalThis.document.querySelector("dialog[open]")) return;
    const startingOwner = this.textNavigation,
      identity = this.context.identity?.(), captured = identity ? { ...identity } : undefined,
      { document, sequence, selected } = this.current(), clip = sequence.clips.find((item) => item.id === clipId),
      owner: TextNavigation = { clipId, field: {
        controller: new AbortController(),
        identity: captured ?? { documentId: document.id, revision: document.revision },
        selection: JSON.stringify(this.context.selection()), time: this.context.time(), viewport: this.gestureViewport(),
      } };
    if (this.destroyed || this.textNavigation !== startingOwner || this.audioEdit || this.viewPan ||
      this.markerNavigationPending || this.trimShortcutPending || clip?.kind !== "text") return;
    if (selected.size !== 1 || !selected.has(clipId)) {
      this.notice.textContent = "多选时请在属性的文字页逐个编辑，分组和关联选择保持不变";
      return;
    }
    if (sequence.tracks.find((track) => track.id === clip.trackId)?.locked) {
      this.notice.textContent = "文字轨道已锁定，请先解锁后编辑文字";
      return;
    }
    this.textNavigation = owner;
    this.updateTrackHeightControl();
    const fail = (error: unknown) => {
      try { if (this.textNavigationCurrent(owner)) this.context.onError(error); } catch { /* unavailable scope */ }
      this.cancelTextNavigation(owner);
    };
    const complete = (accepted: boolean) => {
      try {
        if (!accepted || !this.textNavigationCurrent(owner)) return;
        const value = this.context.identity?.(), before = value ? { ...value } : undefined,
          fresh = this.current(), after = this.context.identity?.(),
          target = fresh.sequence.clips.find((item) => item.id === clipId);
        if (!this.textNavigationCurrent(owner) || target?.kind !== "text" ||
          fresh.sequence.tracks.find((track) => track.id === target.trackId)?.locked ||
          fresh.document.id !== owner.field.identity.documentId ||
          (before && (!after || !sameIdentity(before, after) || fresh.document.id !== before.documentId ||
            fresh.document.revision !== before.revision))) return;
        owner.field.identity.revision = fresh.document.revision;
        owner.exact = true;
        if (!this.textNavigationCurrent(owner, true)) return;
        this.context.editText!(clipId, () => this.textNavigationCurrent(owner, true));
      } catch (error) { fail(error); }
      finally { this.cancelTextNavigation(owner); }
    };
    try {
      if (!this.textNavigationCurrent(owner, true) || document.id !== owner.field.identity.documentId ||
        document.revision !== owner.field.identity.revision) return this.cancelTextNavigation(owner);
      const ready = this.finishFocusedField(owner.field.controller.signal) ??
        this.context.beforeGesture?.(owner.field.controller.signal) ?? true;
      if (!this.textNavigationCurrent(owner)) {
        this.cancelTextNavigation(owner);
        if (ready instanceof Promise) void ready.catch(() => {});
      } else if (typeof ready === "boolean") complete(ready);
      else {
        this.container.focus({ preventScroll: true });
        void Promise.resolve(ready).then(complete, fail);
      }
    } catch (error) { fail(error); }
  }
  private openMenu(clipId: string, x: number, y: number, press?: PendingControl): void {
    if (this.audioEdit || this.textNavigation || this.clipboardPending || (this.pendingControl && this.pendingControl !== press) || this.pendingTrackGesture || this.fadePending) return;
    const pressCurrent = () => !press || (this.fieldScopeCurrent(press.field, true) &&
      (this.context.canTrimAtPlayhead?.(press.field.time) ?? true) && this.pendingControl === press);
    this.closeMenu();
    if (!press) this.cancel();
    const current = this.current();
    if (!pressCurrent()) return;
    const clip = current.sequence.clips.find((clip) => clip.id === clipId);
    if (!clip) return;
    const wanted = current.selected.has(clipId) ? current.selected : this.expanded(current.sequence, [clipId]);
    if (press) press.field.selection = JSON.stringify({ sequenceId: current.sequence.id, clipIds: [...wanted] });
    this.select(wanted);
    const { document, sequence, selected } = this.current();
    if (!pressCurrent() || !sequence.clips.some((item) => item.id === clipId)) return;
    this.clearStaleClipboard(document);
    const time = this.context.time();
    if (!pressCurrent()) return;
    const chosen = sequence.clips.filter((clip) => selected.has(clip.id)),
      inside = chosen.every((clip) => time > clip.start && time < clip.start + clip.duration),
      pending = this.clipboardPending ? "正在保存剪贴板操作，请稍候" : "";
    const locked = sequence.clips.some(
      (clip) =>
        selected.has(clip.id) && sequence.tracks.find((track) => track.id === clip.trackId)?.locked,
    );
    const element = globalThis.document.createElement("div");
    element.id = "timeline-context-menu";
    element.className = "timeline-context-menu editor-clip-menu";
    element.setAttribute("role", "menu");
    element.setAttribute("aria-label", "时间轴片段操作");
    element.setAttribute("aria-describedby", "timeline-context-menu-note");
    const item = (action: string, label: string, shortcut = "", reason = "", danger = false) =>
      `<button type="button" role="menuitem" data-timeline-menu-action="${action}"${danger ? ' class="danger"' : ""}${reason ? ` disabled title="${esc(reason)}"` : ""}><span>${label}</span>${shortcut ? `<kbd aria-hidden="true">${shortcut}</kbd>` : ""}</button>`,
      lockReason = locked ? "所选片段的轨道已锁定，请先解锁" : "",
      timeReason = inside ? "" : "请把播放头移到每个所选片段内部",
      detachReason = originalAudioReason(document, sequence, [...selected]),
      links = new Set(chosen.flatMap((item) => item.linkGroupId ? [item.linkGroupId] : [])),
      unlinkLocked = sequence.clips.some((item) => item.linkGroupId && links.has(item.linkGroupId) &&
        sequence.tracks.find((track) => track.id === item.trackId)?.locked);
    element.innerHTML = `<div class="timeline-context-menu-title">${esc(clipLabel(clip))}${selected.size > 1 ? ` · ${selected.size} 个片段` : ""}</div>
      ${item("copy", "复制", "⌘/Ctrl C", pending)}${item("cut", "剪切", "⌘/Ctrl X", pending || lockReason)}${item("paste", "粘贴到播放头", "⌘/Ctrl V", pending || (!this.clipboard ? "请先复制片段" : ""))}${item("duplicate", "原位复制", "⌘/Ctrl D", pending)}
      <div role="separator"></div>${item("split", "在播放头切分", "S", lockReason || timeReason)}${item("keep-left", "保留播放头左侧", "W", lockReason || timeReason)}${item("keep-right", "保留播放头右侧", "Q", lockReason || timeReason)}
      <div role="separator"></div>${item("detach-audio", "分离原声", "", pending || detachReason)}${item("unlink-audio", "解除链接", "", pending || (unlinkLocked ? "链接中有锁定轨道的片段，请先解锁" : !links.size ? "所选片段没有音画链接" : ""))}
      <div role="separator"></div>${item("group", "分组", "⌘/Ctrl G", lockReason || (selected.size < 2 ? "至少选择两个片段" : ""))}${item("ungroup", "解组", "⇧ ⌘/Ctrl G", lockReason || (!chosen.some((clip) => clip.groupId) ? "所选片段没有分组" : ""))}
      <div role="separator"></div>${item("remove", `从时间轴删除${selected.size > 1 ? ` ${selected.size} 个片段` : ""}`, "⌫", lockReason, true)}${item("cancel", "取消")}
      <p id="timeline-context-menu-note">播放头：${ticksToSeconds(time).toFixed(6)} 秒（打开菜单时）。${lockReason || timeReason || ""} 编辑可撤销；分离原声复用原素材并默认音画联动，未含声音的素材会得到静音。解除链接保留普通分组和字幕来源绑定。</p>`;
    const generation = this.context.identity?.().generation;
    if (!pressCurrent()) return;
    const lifetime = new AbortController();
    this.menu = {
      element,
      lifetime,
      documentId: document.id,
      revision: document.revision,
      generation,
      sequenceId: sequence.id,
      clipId,
      selected: [...selected],
      time,
    };
    element.addEventListener("click", (event) => {
      if (this.menu?.element !== element) return;
      const button = (event.target as Element).closest<HTMLButtonElement>(
        "[data-timeline-menu-action]",
      );
      if (!button || button.disabled) return;
      if (button.dataset.timelineMenuAction === "cancel") return this.closeMenu(true);
      const menu = this.menu, current = this.menuCurrent();
      if (this.menu !== menu) return;
      const action = button.dataset.timelineMenuAction!, at = menu.time;
      this.closeMenu(current);
      if (!current) return this.context.onError(new Error("工程或选择已变化，请重新打开片段菜单"));
      if (action === "detach-audio" || action === "unlink-audio") {
        this.run(() => this.editOriginalAudio(action, menu));
        return;
      }
      this.run(() => this.action(action === "remove" ? "delete" : action, at));
    });
    element.addEventListener("contextmenu", (event) => event.preventDefault());
    globalThis.document.body.append(element);
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
    if (press && this.pendingControl === press) this.cancelControl();
    element
      .querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
    globalThis.document.addEventListener(
      "pointerdown",
      (event) => {
        if (!element.contains(event.target as Node)) this.closeMenu();
      },
      { capture: true, signal: lifetime.signal },
    );
    globalThis.document.addEventListener(
      "keydown",
      (event) => {
        event.stopPropagation();
        if (event.key === "Escape" || event.key === "Tab") {
          if (event.key === "Escape") event.preventDefault();
          return this.closeMenu(true);
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...element.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const index = buttons.indexOf(globalThis.document.activeElement as HTMLButtonElement);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        const button = buttons[next];
        button?.focus({ preventScroll: true });
        if (button) {
          const item = button.getBoundingClientRect(),
            top = element.getBoundingClientRect().top + element.clientTop + 4,
            bottom = top + element.clientHeight - 8;
          if (item.top < top) element.scrollTop -= top - item.top;
          else if (item.bottom > bottom) element.scrollTop += item.bottom - bottom;
        }
      },
      { capture: true, signal: lifetime.signal },
    );
    for (const type of ["wheel", "touchmove"])
      globalThis.document.addEventListener(
        type,
        (event) => {
          if (!element.contains(event.target as Node)) this.closeMenu();
        },
        { capture: true, passive: true, signal: lifetime.signal },
      );
    window.addEventListener("resize", () => this.closeMenu(), { signal: lifetime.signal });
    window.addEventListener("blur", () => this.closeMenu(), { signal: lifetime.signal });
  }
  private point(clientX: number): Tick {
    return secondsToTicks(
      Math.max(
        0,
        (clientX - this.viewport().getBoundingClientRect().left + this.viewport().scrollLeft) /
          this.scale,
      ),
    );
  }
  private dragover = (event: DragEvent): void => {
    if (
      !this.context.addAsset ||
      !event.dataTransfer?.types.includes("text/plain") ||
      !(event.target instanceof Element) ||
      !event.target.closest("[data-et-lane]")
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  };
  private drop = (event: DragEvent): void => {
    if (!this.context.addAsset || !event.dataTransfer || !(event.target instanceof Element)) return;
    const lane = event.target.closest<HTMLElement>("[data-et-lane]");
    if (!lane || !this.container.contains(lane)) return;
    event.preventDefault();
    event.stopPropagation();
    this.run(async () => {
      const text = event.dataTransfer!.getData("text/plain");
      if (!text || text.length > 4096) return;
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        return;
      }
      if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        Object.keys(payload).length !== 1 ||
        !("assetId" in payload) ||
        typeof payload.assetId !== "string" ||
        !payload.assetId
      )
        return;
      const { sequence } = this.current();
      await this.context.addAsset!(payload.assetId, {
        at: this.snap(this.point(event.clientX), sequence, new Set(), !event.altKey),
        trackId: lane.dataset.etLane!,
      });
      this.render();
    });
  };
  private snap(
    time: Tick,
    sequence: EditorSequence,
    omitted: ReadonlySet<string>,
    allowSnapping = true,
    includePlayhead = true,
  ): Tick {
    let target = frameToTicks(
      ticksToFrame(Math.max(0, time), sequence.frameRate),
      sequence.frameRate,
    );
    if (this.snapping && allowSnapping) {
      let distance = (6 / this.scale) * 240000;
      const candidates = [
        0,
        ...(includePlayhead ? [this.context.time()] : []),
        ...sequence.markers.flatMap((marker) => [marker.time, marker.time + marker.duration]),
        ...sequence.clips
          .filter((clip) => !omitted.has(clip.id))
          .flatMap((clip) => [clip.start, clip.start + clip.duration]),
      ];
      for (const value of candidates) {
        const difference = Math.abs(value - time);
        if (difference < distance) {
          distance = difference;
          target = value;
        }
      }
    }
    return Math.max(0, target);
  }
  private moveDelta(
    desired: Tick,
    sequence: EditorSequence,
    ids: readonly string[],
    anchor: EditorClip,
    allowSnapping = true,
  ): Tick {
    const chosen = new Set(ids),
      moving = sequence.clips.filter((clip) => chosen.has(clip.id));
    const minimum = -Math.min(...moving.map((clip) => clip.start));
    let delta = Math.max(
      minimum,
      frameToTicks(
        ticksToFrame(Math.max(0, anchor.start + desired), sequence.frameRate),
        sequence.frameRate,
      ) - anchor.start,
    );
    if (!this.snapping || !allowSnapping) return delta;
    let distance = (6 / this.scale) * 240000;
    const targets = [
      0,
      this.context.time(),
      ...sequence.markers.flatMap((marker) => [marker.time, marker.time + marker.duration]),
      ...sequence.clips
        .filter(
          (clip) =>
            !chosen.has(clip.id) &&
            !(clip.kind === "text" && clip.sourceBinding && chosen.has(clip.sourceBinding.clipId)),
        )
        .flatMap((clip) => [clip.start, clip.start + clip.duration]),
    ];
    for (const edge of moving.flatMap((clip) => [clip.start, clip.start + clip.duration]))
      for (const target of targets) {
        const candidate = target - edge,
          error = Math.abs(candidate - desired);
        if (candidate >= minimum && error < distance) {
          distance = error;
          delta = candidate;
        }
      }
    return delta;
  }
  private pointerdown = (event: PointerEvent) => {
    if (this.textNavigation) this.cancelTextNavigation();
    const textTarget = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".et-text") : undefined,
      textClick = event.isPrimary && event.button === 0 && event.pointerType === "mouse" && !!textTarget &&
        !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
        !(event.target as HTMLElement).closest("[data-et-edge],[data-et-fade],[data-et-gain]");
    if (!textClick) this.clearTextClick();
    if (event.button === 1 && event.pointerType === "mouse" && event.isPrimary &&
        event.target instanceof Element && event.target.closest(".et-scroll") && !editableTarget(event.target)) {
      // A view-only gesture keeps the original input focused, including invalid/IME drafts.
      event.preventDefault();
      this.panRelease = event.pointerId;
      if (this.destroyed || this.viewPan || this.audioEdit || this.textNavigation || this.drag || this.pendingControl || this.pendingTrackGesture ||
          this.trackControlPending || this.canvasFieldFinish || this.fadePending || this.clipboardPending ||
          this.menu || globalThis.document.querySelector("dialog[open]")) return;
      this.run(() => {
        const viewport = this.viewport(), pan: ViewPan = {
          pointerId: event.pointerId, x: event.clientX, y: event.clientY,
          left: viewport.scrollLeft, top: this.container.querySelector<HTMLElement>(".et-body")!.scrollTop,
          scope: this.panScope(),
        };
        if (this.destroyed || !this.container.isConnected || this.viewPan || this.audioEdit || this.textNavigation) return;
        this.viewPan = pan;
        this.container.classList.add("et-panning");
        this.updateTrackHeightControl();
        // The container survives virtual-window redraws; its inner scroller does not.
        try { this.container.setPointerCapture(event.pointerId); }
        catch (error) { this.cancelPan(pan); throw error; }
      });
      return;
    }
    if (this.viewPan) { event.preventDefault(); return; }
    if (event.isPrimary) { this.suppressedControlClick = undefined; this.suppressContextMenu = false; }
    const menuTarget = event.button === 2 && event.target instanceof Element && !editableTarget(event.target)
      ? event.target.closest<HTMLElement>("[data-et-clip]") : undefined;
    if (menuTarget) {
      // Cancel native mousedown before it blurs (and can discard) a managed draft.
      this.suppressContextMenu = true;
      event.preventDefault();
    }
    if (this.pendingControl && event.isPrimary && event.button === 0)
      this.suppressedControlClick = event.pointerId;
    if (
      event.button === 0 &&
      event.target instanceof Element &&
      event.target.closest(TRACK_BUTTONS) &&
      globalThis.document.activeElement instanceof HTMLInputElement &&
      globalThis.document.activeElement.matches(TRACK_INPUTS)
    ) {
      event.preventDefault();
      return;
    }
    if (
      this.audioEdit ||
      this.pendingControl ||
      this.pendingTrackGesture ||
      this.trackControlPending ||
      this.canvasFieldFinish ||
      this.fadePending
    ) {
      event.preventDefault();
      return;
    }
    if (event.button === 0 && event.target instanceof Element && event.target.closest("[data-et-follow],[data-et-track-height]")) {
      // A view preference must not blur or submit an unrelated property draft.
      event.preventDefault();
      return;
    }
    if (event.button === 0 && event.target instanceof Element &&
      (this.context.beforeGesture || event.target.closest('[data-et-action="fit-selection"]'))) {
      const button = event.target.closest<HTMLButtonElement>("button"),
        intent = button && this.controlIntent(button);
      if (intent) {
        this.run(() => this.controlGesture(event, intent));
        return;
      }
    }
    if (menuTarget && !event.ctrlKey && !this.drag) {
      this.run(() => this.controlGesture(event, { kind: "menu", clipId: menuTarget.dataset.etClip!, x: event.clientX, y: event.clientY }));
      return;
    }
    if (event.button !== 0 || this.drag || editableTarget(event.target)) return;
    const target = event.target instanceof HTMLElement ? event.target : undefined;
    if (!target || target.closest("button,.et-toolbar,.et-track-heads")) return;
    const node = target.closest<HTMLElement>("[data-et-clip]"), intent: GestureIntent = {
      pointer: gesturePointer(event),
      clipId: node?.dataset.etClip,
      kind: node ? target.closest("[data-et-gain]") ? "gain" : (target.closest<HTMLElement>("[data-et-fade]")?.dataset.etFade as AudioFadeSide | undefined) ?? (target.closest<HTMLElement>("[data-et-edge]")?.dataset.etEdge as "left" | "right" | undefined) ?? "move"
        : target.closest(".et-ruler,.et-marker-lane,.et-playhead") ? "seek" : "box",
      additive: event.shiftKey || event.ctrlKey || event.metaKey,
      scroll: this.viewport().scrollLeft,
      verticalScroll: this.container.querySelector<HTMLElement>(".et-body")!.scrollTop,
    };
    intent.textClick = textClick && intent.kind === "move" ? this.context.time() : undefined;
    if (intent.textClick === undefined) this.clearTextClick();
    event.preventDefault();
    const gain = target.closest<HTMLElement>("[data-et-gain]");
    if (gain && (!this.gainCurrent(gain) || gain.getAttribute("aria-disabled") === "true")) return;
    const fade = target.closest<HTMLElement>("[data-et-fade]");
    if (fade && (!this.fadeCurrent(fade) || fade.getAttribute("aria-disabled") === "true")) return;
    const input = globalThis.document.activeElement;
    if (input instanceof HTMLInputElement && input.matches(TRACK_INPUTS) && this.trackInputCurrent(input)) {
      const clip = this.current().sequence.clips.find((item) => item.id === intent.clipId);
      intent.clipKind = clip?.kind;
      intent.trackId = clip?.trackId;
      this.run(() => this.trackDraftGesture(input, intent));
      return;
    }
    this.run(() => this.context.beforeGesture ? this.focusedFieldGesture(intent) : this.beginGesture(intent));
  };
  private gestureViewport(): string {
    const bounds = this.container.getBoundingClientRect();
    return JSON.stringify([bounds.left, bounds.top, bounds.width, bounds.height, this.scale]);
  }
  private panScope(): string {
    const identity = this.context.identity?.(), document = identity ? undefined : this.context.read();
    return JSON.stringify([identity ?? { documentId: document!.id, revision: document!.revision },
      this.context.selection().sequenceId, this.gestureViewport()]);
  }
  private panCurrent(pan: ViewPan): boolean {
    const scope = this.panScope();
    return !this.destroyed && this.viewPan === pan && pan.scope === scope;
  }
  private cancelPan(pan = this.viewPan): void {
    if (!pan || this.viewPan !== pan) return;
    this.viewPan = undefined;
    this.container.classList.remove("et-panning");
    this.updateTrackHeightControl();
    if (this.container.hasPointerCapture(pan.pointerId)) this.container.releasePointerCapture(pan.pointerId);
  }
  private panTo(event: Pick<GesturePointer, "clientX" | "clientY">): void {
    const pan = this.viewPan;
    if (!pan) return;
    if (!this.panCurrent(pan)) { this.cancelPan(pan); return; }
    this.viewport().scrollLeft = pan.left + pan.x - event.clientX;
    this.container.querySelector<HTMLElement>(".et-body")!.scrollTop = pan.top + pan.y - event.clientY;
  }
  private panEscape = (event: KeyboardEvent): void => {
    if (!this.viewPan || event.key !== "Escape" || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    this.cancelPan();
  };
  private panReleaseDefault = (event: PointerEvent): void => {
    if (event.type === "pointerdown") {
      this.panRelease = undefined;
    } else if (event.button === 1 && event.pointerId === this.panRelease) {
      // Linux can paste PRIMARY on release even when pointerdown suppressed mouse events.
      // Keep this physical release owned after Escape/blur has already ended the pan.
      this.panRelease = undefined;
      event.preventDefault();
    }
  };
  private fieldGestureCurrent(pending: PendingTrackGesture, exactRevision = false): boolean {
    const field = pending.field;
    return !!field && this.fieldScopeCurrent(field, exactRevision);
  }
  private fieldScopeCurrent(
    field: NonNullable<PendingTrackGesture["field"]>,
    exactRevision = false,
  ): boolean {
    if (this.destroyed || field.controller.signal.aborted) return false;
    const identity = this.context.identity?.(),
      document = identity ? undefined : this.current().document,
      revision = identity?.revision ?? document!.revision;
    return (identity?.documentId ?? document!.id) === field.identity.documentId &&
      identity?.generation === field.identity.generation &&
      revision >= field.identity.revision && revision <= field.identity.revision + Number(!exactRevision) &&
      JSON.stringify(this.context.selection()) === field.selection && this.context.time() === field.time &&
      this.gestureViewport() === field.viewport;
  }
  private controlIntent(button: HTMLButtonElement, checkTrackScope = true): ControlIntent | undefined {
    if (
      !this.container.contains(button) ||
      button.disabled ||
      button.getAttribute("aria-disabled") === "true"
    )
      return;
    const action = button.dataset.etAction;
    if (CONTROL_ACTIONS.includes(action as (typeof CONTROL_ACTIONS)[number]))
      return { kind: "action", action: action as (typeof CONTROL_ACTIONS)[number] };
    if (button.dataset.etMode === "free" || button.dataset.etMode === "magnetic")
      return { kind: "mode", mode: button.dataset.etMode };
    const owner = this.trackButtons.get(button);
    if (!owner || !this.currentTrackButtons.has(button) || (checkTrackScope && !this.trackOwnerCurrent(owner))) return;
    for (const operation of [
      "toggle",
      "up",
      "down",
      "delete-track",
      "delete-confirm",
      "delete-cancel",
    ] as const) {
      const key = `et${operation
        .split("-")
        .map((part) => part[0]!.toUpperCase() + part.slice(1))
        .join("")}`;
      if (!(key in button.dataset)) continue;
      const toggle = button.dataset.etToggle;
      if (operation === "toggle" && !["locked", "hidden", "muted", "solo"].includes(toggle!)) return;
      return {
        kind: "track",
        owner: { ...owner },
        operation,
        ...(operation === "toggle" ? { toggle: toggle as "locked" | "hidden" | "muted" | "solo" } : {}),
      };
    }
  }
  private matchingControl(intent: ControlIntent): HTMLButtonElement | undefined {
    // Private DOM ownership narrows the candidate before its live track scope reads the document.
    const signature = JSON.stringify(intent),
      candidate = [...this.container.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => JSON.stringify(this.controlIntent(button, false)) === signature,
      );
    return candidate && JSON.stringify(this.controlIntent(candidate)) === signature ? candidate : undefined;
  }
  /** Native blur may replace the pressed button; retain its meaning until the first release. */
  private controlGesture(event: PointerEvent, intent: ControlIntent): void {
    const identity = this.context.identity?.(),
      document = identity ? undefined : this.current().document,
      pending: PendingControl = {
        intent,
        pointerId: event.pointerId,
        field: {
          controller: new AbortController(),
          identity: {
            documentId: identity?.documentId ?? document!.id,
            revision: identity?.revision ?? document!.revision,
            generation: identity?.generation,
          },
          selection: JSON.stringify(this.context.selection()),
          time: this.context.time(),
          viewport: this.gestureViewport(),
        },
      };
    this.pendingControl = pending;
    this.updateTrackHeightControl();
    let ready: boolean | Promise<boolean>;
    try {
      const signal = pending.field.controller.signal;
      ready = (intent.kind === "menu" || (intent.kind === "action" && intent.action === "fit-selection")
        ? this.finishFocusedField(signal) : undefined) ?? this.context.beforeGesture?.(signal) ?? true;
    } catch (error) {
      event.preventDefault();
      this.suppressedControlClick = event.pointerId;
      if (this.pendingControl === pending) this.cancelControl();
      throw error;
    }
    if (this.pendingControl !== pending || !this.fieldScopeCurrent(pending.field, true)) {
      event.preventDefault();
      this.suppressedControlClick = event.pointerId;
      if (this.pendingControl === pending) this.cancelControl();
      else pending.field.controller.abort();
      if (ready instanceof Promise) void ready.catch(() => {});
      return;
    }
    if (ready === true && intent.kind === "menu") {
      pending.up = pending.ready = true;
      void this.finishControl(pending);
      return;
    }
    if (ready === true) {
      this.pendingControl = undefined;
      this.updateTrackHeightControl();
      return;
    }
    event.preventDefault();
    this.suppressedControlClick = event.pointerId;
    if (ready === false) {
      this.cancelControl();
      return;
    }
    this.container.focus({ preventScroll: true });
    if (this.pendingControl !== pending || !this.fieldScopeCurrent(pending.field, true)) {
      if (this.pendingControl === pending) this.cancelControl();
      else pending.field.controller.abort();
      if (ready instanceof Promise) void ready.catch(() => {});
      return;
    }
    this.container.setPointerCapture(event.pointerId);
    void Promise.resolve(ready).then(
      (accepted) => {
        if (this.pendingControl !== pending) return;
        pending.ready = accepted;
        void this.finishControl(pending);
      },
      (error) => {
        if (this.pendingControl === pending && this.fieldScopeCurrent(pending.field))
          this.context.onError(error);
        if (this.pendingControl === pending) {
          pending.ready = false;
          void this.finishControl(pending);
        }
      },
    );
  }
  private async finishControl(pending: PendingControl): Promise<void> {
    if (
      this.pendingControl !== pending ||
      pending.applying ||
      pending.up === undefined ||
      pending.ready === undefined
    )
      return;
    if (!pending.up || !pending.ready || !this.fieldScopeCurrent(pending.field)) {
      this.cancelControl();
      return;
    }
    try {
      const intent = pending.intent, before = this.context.identity?.(),
        identity = before ? { ...before } : undefined,
        { document, sequence } = this.current(),
        button = intent.kind === "menu" ? undefined : this.matchingControl(intent),
        after = this.context.identity?.(),
        current = after ? undefined : this.current().document;
      if (
        this.pendingControl !== pending ||
        !this.fieldScopeCurrent(pending.field) ||
        (intent.kind === "menu" ? !sequence.clips.some((clip) => clip.id === intent.clipId) : !button) ||
        document.id !== pending.field.identity.documentId ||
        document.revision !== (identity?.revision ?? document.revision) ||
        document.id !== (after?.documentId ?? current!.id) ||
        document.revision !== (after?.revision ?? current!.revision) ||
        identity?.generation !== after?.generation ||
        sequence.id !== JSON.parse(pending.field.selection).sequenceId ||
        (pending.intent.kind === "menu" && !(this.context.canTrimAtPlayhead?.(pending.field.time) ?? true)) ||
        this.pendingControl !== pending
      )
        return;
      pending.applying = true;
      if (pending.intent.kind === "menu") {
        pending.field.identity.revision = document.revision;
        this.openMenu(pending.intent.clipId, pending.intent.x, pending.intent.y, pending);
      } else if (pending.intent.kind === "action")
        await this.action(pending.intent.action, pending.field.time);
      else if (pending.intent.kind === "mode") await this.setMode(pending.intent.mode);
      else await this.trackControl(button!);
    } catch (error) {
      const identity = this.context.identity?.(),
        document = identity ? undefined : this.current().document;
      if (
        !this.destroyed &&
        !pending.field.controller.signal.aborted &&
        (identity?.documentId ?? document!.id) === pending.field.identity.documentId &&
        identity?.generation === pending.field.identity.generation &&
        this.context.selection().sequenceId === JSON.parse(pending.field.selection).sequenceId
      )
        this.context.onError(error);
    } finally {
      if (this.pendingControl === pending) this.cancelControl();
    }
  }
  private cancelControl(): void {
    const pending = this.pendingControl;
    if (!pending) return;
    this.pendingControl = undefined;
    this.updateTrackHeightControl();
    pending.field.controller.abort();
    if (this.container.hasPointerCapture(pending.pointerId))
      this.container.releasePointerCapture(pending.pointerId);
  }
  /** Keep the physical pointer intent while a different view finishes its field. */
  private focusedFieldGesture(intent: GestureIntent): void {
    const identity = this.context.identity?.(), document = identity ? undefined : this.current().document,
      pending: PendingTrackGesture = { intent, last: { ...intent.pointer }, field: {
        controller: new AbortController(),
        identity: { documentId: identity?.documentId ?? document!.id, revision: identity?.revision ?? document!.revision,
          generation: identity?.generation },
        selection: JSON.stringify(this.context.selection()), time: this.context.time(), viewport: this.gestureViewport(),
      } };
    this.pendingTrackGesture = pending;
    this.updateTrackHeightControl();
    let ready: boolean | Promise<boolean>;
    try { ready = this.context.beforeGesture!(pending.field!.controller.signal); }
    catch (error) { this.cancelTrackGesture(); throw error; }
    if (this.pendingTrackGesture !== pending || !this.fieldGestureCurrent(pending, true)) {
      if (this.pendingTrackGesture === pending) this.cancelTrackGesture();
      else pending.field!.controller.abort();
      if (ready instanceof Promise) void ready.catch(() => {});
      return;
    }
    if (typeof ready === "boolean") {
      this.pendingTrackGesture = undefined;
      this.updateTrackHeightControl();
      if (ready) this.beginGesture(intent);
      else pending.field!.controller.abort();
      return;
    }
    // The finisher has blurred the old field, but dispatch begins after this microtask.
    const clip = this.current().sequence.clips.find((item) => item.id === intent.clipId);
    intent.clipKind = clip?.kind; intent.trackId = clip?.trackId;
    this.container.focus({ preventScroll: true });
    if (this.pendingTrackGesture !== pending || !this.fieldGestureCurrent(pending, true)) {
      if (this.pendingTrackGesture === pending) this.cancelTrackGesture();
      else pending.field!.controller.abort();
      void ready.catch(() => {});
      return;
    }
    this.container.setPointerCapture(intent.pointer.pointerId);
    void this.finishFieldGesture(pending, ready);
  }
  private async finishFieldGesture(pending: PendingTrackGesture, ready: Promise<boolean>): Promise<void> {
    let finishing = false;
    try {
      if (!await ready || this.pendingTrackGesture !== pending || !this.fieldGestureCurrent(pending)) return;
      this.pendingTrackGesture = undefined;
      this.updateTrackHeightControl();
      finishing = true;
      const serial = this.gestureSerial + 1;
      this.beginGesture(pending.intent, !pending.up);
      if (!this.drag || this.gestureSerial !== serial) return;
      const last = pending.up ?? pending.last;
      this.drag.lastX = last.clientX; this.drag.lastY = last.clientY; this.drag.altKey = last.altKey;
      if (pending.up) this.pointerup(pending.up);
      else { this.updateDrag(); this.startAutoScroll(); }
    } catch (error) {
      if (!pending.field!.controller.signal.aborted && this.fieldGestureCurrent(pending)) this.context.onError(error);
    } finally {
      const active = this.pendingTrackGesture === pending;
      if (active) this.cancelTrackGesture();
      if ((active || finishing) && !pending.field!.controller.signal.aborted && !this.pendingTrackGesture && !this.drag &&
        this.container.hasPointerCapture(pending.intent.pointer.pointerId))
        this.container.releasePointerCapture(pending.intent.pointer.pointerId);
    }
  }
  /** A track draft must finish before the gesture takes its revision-bound document snapshot. */
  private async trackDraftGesture(input: HTMLInputElement, intent: GestureIntent): Promise<void> {
    const owner = this.trackInputs.get(input)!, pending: PendingTrackGesture = {
      owner, intent, last: { ...intent.pointer },
    }, selector = input.dataset.etTrackName ? `[data-et-track-name="${CSS.escape(input.dataset.etTrackName)}"]`
      : `[data-et-track-id="${CSS.escape(input.dataset.etTrackId!)}"][data-et-track-mix="${input.dataset.etTrackMix}"]`;
    let value = input.value, saved = false, finishing = false;
    this.pendingTrackGesture = pending;
    this.updateTrackHeightControl();
    try {
      this.container.setPointerCapture(intent.pointer.pointerId);
      this.replacingControls = true;
      try { input.blur(); this.container.focus({ preventScroll: true }); }
      finally { this.replacingControls = false; }
      value = input.value;
      if (!this.trackOwnerCurrent(owner)) return;
      const edit = this.trackInputEdit(input);
      this.render();
      if (this.pendingTrackGesture !== pending || !this.trackOwnerCurrent(owner)) return;
      if (edit) await this.apply([edit.operation], edit.label);
      saved = true;
      if (this.pendingTrackGesture !== pending || !this.trackOwnerCurrent(owner)) return;
      finishing = true;
      this.pendingTrackGesture = undefined;
      this.updateTrackHeightControl();
      this.render();
      if (!this.trackOwnerCurrent(owner)) return;
      const serial = this.gestureSerial + 1;
      this.beginGesture(intent, !pending.up);
      if (!this.drag || this.gestureSerial !== serial) return;
      const last = pending.up ?? pending.last;
      this.drag.lastX = last.clientX;
      this.drag.lastY = last.clientY;
      this.drag.altKey = last.altKey;
      if (pending.up) this.pointerup(pending.up);
      else { this.updateDrag(); this.startAutoScroll(); }
    } catch (error) {
      if ((this.pendingTrackGesture === pending || finishing) && this.trackOwnerCurrent(owner)) {
        this.context.onError(error);
        this.notice.textContent = error instanceof Error ? error.message : String(error);
      }
    } finally {
      const active = this.pendingTrackGesture === pending;
      if (active) this.cancelTrackGesture();
      if ((active || finishing) && !this.pendingTrackGesture && !this.drag && this.container.hasPointerCapture(intent.pointer.pointerId))
        this.container.releasePointerCapture(intent.pointer.pointerId);
      if (!this.destroyed && !this.drag) this.render();
      if (active && !saved && this.trackOwnerCurrent(owner)) {
        const field = this.container.querySelector<HTMLInputElement>(selector);
        if (field && !field.disabled) { field.value = value; field.focus({ preventScroll: true }); }
      }
    }
  }
  private beginGesture(intent: GestureIntent, capture = true): void {
    if (this.destroyed) return;
    const serial = ++this.gestureSerial, time = this.context.time(), viewport = this.gestureViewport();
    this.notice.textContent = "";
    const { document, sequence, selected } = this.current(), { pointer, kind, additive } = intent,
      clip = sequence.clips.find((item) => item.id === intent.clipId), generation = this.context.identity?.().generation;
    if (intent.clipId && (!clip || (intent.clipKind && (clip.kind !== intent.clipKind || clip.trackId !== intent.trackId)) ||
      !this.container.querySelector(`[data-et-clip="${CSS.escape(intent.clipId)}"]`)))
      throw new Error("片段已变化，请重新选择或拖动");
    if (kind === "gain" && (!clip || !("audio" in clip) || typeof clip.audio.volume !== "number" ||
      sequence.tracks.find((track) => track.id === clip.trackId)?.locked))
      throw new Error("片段音量已变化，请重新选择音量手柄");
    let ids = new Set(selected);
    if (clip) {
      const group = this.expanded(sequence, [clip.id]);
      if (additive && selected.has(clip.id)) for (const id of group) ids.delete(id);
      else {
        if (!additive && !selected.has(clip.id)) ids.clear();
        for (const id of group) ids.add(id);
      }
      this.context.select([...ids]);
      const identity = this.context.identity?.(), current = identity ? undefined : this.current().document,
        selection = this.context.selection();
      if (this.destroyed || (identity?.documentId ?? current!.id) !== document.id ||
        (identity?.revision ?? current!.revision) !== document.revision || identity?.generation !== generation ||
        selection.sequenceId !== sequence.id || selection.clipIds.length !== ids.size ||
        selection.clipIds.some((id) => !ids.has(id)) || time !== this.context.time() ||
        serial !== this.gestureSerial || viewport !== this.gestureViewport() || this.pendingTrackGesture) return;
      if (!ids.has(clip.id)) { this.render(); return; }
    }
    const drag: Drag = {
      kind,
      textClick: intent.textClick,
      pointerId: pointer.pointerId,
      x: pointer.clientX,
      y: pointer.clientY,
      scroll: intent.scroll,
      verticalScroll: intent.verticalScroll,
      lastX: pointer.clientX,
      lastY: pointer.clientY,
      documentId: document.id,
      revision: document.revision,
      generation,
      sequenceId: sequence.id,
      document,
      sequence,
      clip,
      ids: clip
        ? [
            clip.id,
            ...(kind === "move" && sequence.timelineMode === "magnetic"
              ? magneticMovementIds(sequence, [...ids])
              : [...ids]
            ).filter((id) => id !== clip.id),
          ]
        : [...ids],
      delta: 0,
      time: this.point(pointer.clientX),
      moved: false,
      additive,
      altKey: pointer.altKey,
    };
    this.drag = drag;
    this.updateTrackHeightControl();
    const gainControl = kind === "gain" && clip ? this.container.querySelector<HTMLElement>(`[data-et-clip="${CSS.escape(clip.id)}"] [data-et-gain]`) : undefined;
    (gainControl || this.container).focus({ preventScroll: true });
    const identity = this.context.identity?.(), current = identity ? undefined : this.current().document,
      selection = this.context.selection();
    if (this.drag !== drag || this.destroyed || serial !== this.gestureSerial ||
      (identity?.documentId ?? current!.id) !== document.id || (identity?.revision ?? current!.revision) !== document.revision ||
      identity?.generation !== generation || selection.sequenceId !== sequence.id ||
      selection.clipIds.length !== ids.size || selection.clipIds.some((id) => !ids.has(id)) ||
      time !== this.context.time() || viewport !== this.gestureViewport()) {
      if (this.drag === drag) this.cancel();
      return;
    }
    if (capture) this.container.setPointerCapture(pointer.pointerId);
    if (kind === "box") this.createBox();
    if (clip)
      for (const element of this.container.querySelectorAll<HTMLElement>("[data-et-clip]")) {
        element.classList.toggle("selected", ids.has(element.dataset.etClip!));
        element.setAttribute("aria-selected", String(ids.has(element.dataset.etClip!)));
      }
  }
  private gainMarkup(clip: EditorClip, track: EditorTrack, audibleAssets: Set<string>, left: number, right: number): string {
    if (!("audio" in clip) || (clip.kind === "media" && !audibleAssets.has(clip.assetId))) return "";
    const start = ticksToSeconds(clip.start) * this.scale, width = ticksToSeconds(clip.duration) * this.scale,
      visible = Math.min(start + width, right) - Math.max(start, left),
      position = Math.max(12, Math.min(width - 56, left - start + 12));
    if (typeof clip.audio.volume !== "number")
      return `<span class="et-gain-status" style="left:${position}px;max-width:${Math.max(16, visible - 24)}px" title="音量已自动化（含裁剪生成的曲线），请在属性面板编辑关键帧">音量自动化 · 属性编辑</span>`;
    if (visible < 68) return `<span class="et-gain-status" style="left:${Math.max(8, left - start + 8)}px" title="${gainText(clip.audio.volume)} · 放大时间轴可调整片段音量">音量 · 放大可调</span>`;
    const volume = this.drag?.kind === "gain" && this.drag.clip?.id === clip.id ? this.drag.gain ?? clip.audio.volume : clip.audio.volume,
      disabled = track.locked || this.fadePending,
      hint = `${gainText(volume)}${track.locked ? " · 轨道已锁定" : " · 上下拖动；方向键 1%，Shift 10%，Home/End 0/400%"}${track.muted || track.volume === 0 ? " · 轨道静音，调整后仍无声" : ""} · 开启调音试听后可实时听效果，松开保存`;
    return `<span class="et-gain-lines"><span data-et-gain-line style="bottom:calc(${volume * 25}% + ${2 - volume}px)"></span></span><span class="et-gain-handle" data-et-gain role="slider" tabindex="${disabled ? -1 : 0}" aria-label="片段音量 ${esc(clipLabel(clip))}" aria-valuemin="0" aria-valuemax="400" aria-valuenow="${gainPercent(volume)}" aria-valuetext="${esc(gainText(volume))}" aria-disabled="${disabled}" title="${esc(hint)}" style="left:${position}px">${gainPercent(volume)}%</span>`;
  }
  private gainFocus = (event: FocusEvent): void => {
    const control = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-et-gain]") : undefined;
    if (control && this.gainCurrent(control)) this.notice.textContent = control.title;
  };
  private gainCurrent(control: HTMLElement): boolean {
    const owner = this.gainOwners.get(control);
    if (!owner || !this.currentGainControls.has(control) || !this.container.contains(control)) return false;
    const identity = this.context.identity?.(), document = identity ? undefined : this.current().document;
    return !this.destroyed && (identity?.documentId ?? document?.id) === owner.documentId &&
      (identity?.revision ?? document?.revision) === owner.revision && identity?.generation === owner.generation &&
      this.context.selection().sequenceId === owner.sequenceId && this.context.selection().clipIds.includes(owner.clipId);
  }
  private paintGain(node: HTMLElement, volume: number): void {
    const line = node.querySelector<HTMLElement>("[data-et-gain-line]"), handle = node.querySelector<HTMLElement>("[data-et-gain]");
    if (line) line.style.bottom = `calc(${volume * 25}% + ${2 - volume}px)`;
    if (handle) {
      handle.textContent = `${gainPercent(volume)}%`;
      handle.setAttribute("aria-valuenow", String(gainPercent(volume)));
      handle.setAttribute("aria-valuetext", gainText(volume));
      handle.title = `${gainText(volume)} · ${handle.title.split(" · ").slice(2).join(" · ")}`;
    }
  }
  private async keyGain(control: HTMLElement, event: KeyboardEvent): Promise<void> {
    if (!this.gainCurrent(control)) throw new Error("工程已变化，请重新选择音量手柄");
    if (control.getAttribute("aria-disabled") === "true") return;
    const owner = this.gainOwners.get(control)!, { document, sequence } = this.current();
    if (!this.gainCurrent(control) || document.id !== owner.documentId || document.revision !== owner.revision) return;
    const clip = sequence.clips.find((item) => item.id === owner.clipId);
    if (!clip || !("audio" in clip) || typeof clip.audio.volume !== "number") return;
    const step = event.shiftKey ? 10 : 1,
      percent = event.key === "Home" ? 0 : event.key === "End" ? 400 : Math.max(0, Math.min(400,
        clip.audio.volume * 100 + (["ArrowUp", "ArrowRight"].includes(event.key) ? step : -step))),
      operations = planClipAudioGain(document, sequence.id, clip.id, percent / 100);
    if (!operations.length || !this.gainCurrent(control)) return;
    this.fadePending = true;
    for (const handle of this.container.querySelectorAll<HTMLElement>("[data-et-fade],[data-et-gain]"))
      handle.setAttribute("aria-disabled", "true");
    try { await this.apply(operations, "调整片段音量"); }
    catch (error) {
      const identity = this.context.identity?.(), current = identity ? undefined : this.current().document;
      if (!this.destroyed && (identity?.documentId ?? current?.id) === owner.documentId && identity?.generation === owner.generation &&
        this.context.selection().sequenceId === owner.sequenceId) this.context.onError(error);
    } finally { this.fadePending = false; if (!this.destroyed) this.render(); }
  }
  private fadeMarkup(clip: EditorClip, track: EditorTrack, audibleAssets: Set<string>): string {
    if (!("audio" in clip) || (clip.kind === "media" && !audibleAssets.has(clip.assetId)) ||
      ticksToSeconds(clip.duration) * this.scale < 48) return "";
    return (["fadeIn", "fadeOut"] as const).map((side) => {
      const value = clip.audio[side], label = side === "fadeIn" ? "声音淡入" : "声音淡出", disabled = track.locked || this.fadePending;
      const boundary = side === "fadeIn" ? value : clip.duration - value;
      const position = Math.max(12, Math.min(ticksToSeconds(clip.duration) * this.scale - 12, ticksToSeconds(boundary) * this.scale));
      return `<span class="et-fade-area et-${side}" data-et-fade-area="${side}" style="width:${ticksToSeconds(value) * this.scale}px"></span><span class="et-fade-handle et-${side}" data-et-fade="${side}" role="slider" tabindex="${disabled ? -1 : 0}" aria-label="${label}${side === "fadeOut" ? "开始" : "结束"} ${esc(clipLabel(clip))}" aria-valuemin="0" aria-valuemax="${ticksToSeconds(clip.duration)}" aria-valuenow="${ticksToSeconds(boundary)}" aria-valuetext="${label}时长 ${ticksToSeconds(value).toFixed(6)} 秒" aria-disabled="${disabled}" aria-busy="${this.fadePending}" title="${label} ${ticksToSeconds(value).toFixed(6)} 秒${track.locked ? " · 轨道已锁定" : " · 拖动调整；←/→ 一帧，Shift 十帧，Home/End 片段边缘"}" style="left:${position}px"></span>`;
    }).join("");
  }
  private paintFade(node: HTMLElement, side: AudioFadeSide, value: Tick, duration: Tick): void {
    const handle = node.querySelector<HTMLElement>(`[data-et-fade="${side}"]`),
      area = node.querySelector<HTMLElement>(`[data-et-fade-area="${side}"]`),
      boundary = side === "fadeIn" ? value : duration - value,
      label = side === "fadeIn" ? "声音淡入" : "声音淡出";
    if (handle) {
      handle.style.left = `${Math.max(12, Math.min(ticksToSeconds(duration) * this.scale - 12, ticksToSeconds(boundary) * this.scale))}px`;
      handle.setAttribute("aria-valuenow", String(ticksToSeconds(boundary)));
      handle.setAttribute("aria-valuetext", `${label}时长 ${ticksToSeconds(value).toFixed(6)} 秒`);
      handle.title = `${label} ${ticksToSeconds(value).toFixed(6)} 秒`;
    }
    if (area) area.style.width = `${ticksToSeconds(value) * this.scale}px`;
  }
  private fadeCurrent(control: HTMLElement): boolean {
    const owner = this.fadeOwners.get(control);
    if (!owner || !this.currentFadeControls.has(control) || !this.container.contains(control)) return false;
    const identity = this.context.identity?.(), document = identity ? undefined : this.current().document;
    return (identity?.documentId ?? document?.id) === owner.documentId &&
      (identity?.revision ?? document?.revision) === owner.revision &&
      identity?.generation === owner.generation && this.context.selection().sequenceId === owner.sequenceId;
  }
  private async keyFade(control: HTMLElement, event: KeyboardEvent): Promise<void> {
    if (!this.fadeCurrent(control)) throw new Error("工程已变化，请重新选择声音淡入淡出手柄");
    if (control.getAttribute("aria-disabled") === "true") return;
    const owner = this.fadeOwners.get(control)!, { document, sequence } = this.current(),
      clip = sequence.clips.find((item) => item.id === owner.clipId);
    if (!clip || !("audio" in clip)) return;
    const boundary = owner.side === "fadeIn" ? clip.audio.fadeIn : clip.duration - clip.audio.fadeOut,
      step = event.shiftKey ? 10 : 1,
      next = event.key === "Home" ? 0 : event.key === "End" ? clip.duration
        : frameToTicks(Math.max(0, ticksToFrame(boundary, sequence.frameRate) + (event.key === "ArrowRight" ? step : -step)), sequence.frameRate),
      duration = owner.side === "fadeIn" ? Math.min(clip.duration, next) : clip.duration - Math.min(clip.duration, next),
      operations = planClipAudioFade(document, sequence.id, clip.id, owner.side, duration);
    if (!operations.length) return;
    this.fadePending = true;
    for (const handle of this.container.querySelectorAll<HTMLElement>("[data-et-fade]")) {
      handle.setAttribute("aria-disabled", "true"); handle.setAttribute("aria-busy", "true");
    }
    try {
      await this.apply(operations, owner.side === "fadeIn" ? "调整声音淡入" : "调整声音淡出");
    } catch (error) {
      const identity = this.context.identity?.(), current = identity ? undefined : this.current().document;
      if (!this.destroyed && (identity?.documentId ?? current?.id) === owner.documentId &&
        identity?.generation === owner.generation && this.context.selection().sequenceId === owner.sequenceId)
        this.context.onError(error);
    } finally {
      this.fadePending = false;
      if (!this.destroyed) this.render();
    }
  }
  private cancelTrackGesture(): void {
    const pending = this.pendingTrackGesture;
    if (!pending) return;
    this.pendingTrackGesture = undefined;
    this.updateTrackHeightControl();
    pending.field?.controller.abort();
    if (this.container.hasPointerCapture(pending.intent.pointer.pointerId))
      this.container.releasePointerCapture(pending.intent.pointer.pointerId);
  }
  private pointermove = (event: PointerEvent) => {
    if (this.viewPan?.pointerId === event.pointerId) {
      if (!(event.buttons & 4)) this.cancelPan();
      else this.run(() => this.panTo(event));
      return;
    }
    if (this.pendingControl?.pointerId === event.pointerId) {
      if (this.pendingControl.up === undefined && event.buttons === 0) this.cancelControl();
      return;
    }
    const pending = this.pendingTrackGesture;
    if (pending?.intent.pointer.pointerId === event.pointerId) {
      if (pending.up) return;
      if (event.buttons === 0) { this.cancelTrackGesture(); this.render(); }
      else pending.last = gesturePointer(event);
      return;
    }
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // A release this page never received must not let later hovering resume the gesture.
    if (event.buttons === 0) {
      this.cancel();
      return;
    }
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.altKey = event.altKey;
    this.run(() => {
      this.updateDrag();
      this.startAutoScroll();
    });
  };
  private createBox(): void {
    this.box?.remove();
    this.box = globalThis.document.createElement("div");
    this.box.className = "et-selection-box";
    this.container.append(this.box);
  }
  private updateDrag(planNow = false): void {
    const drag = this.drag;
    if (!drag) return;
    if (planNow && this.dragPlanFrame !== undefined) {
      cancelAnimationFrame(this.dragPlanFrame);
      this.dragPlanFrame = undefined;
    }
    const viewport = this.viewport(),
      body = this.container.querySelector<HTMLElement>(".et-body")!;
    const dx = drag.lastX - drag.x + viewport.scrollLeft - drag.scroll,
      dy = drag.lastY - drag.y + body.scrollTop - drag.verticalScroll;
    drag.moved ||= drag.kind === "gain" ? Math.abs(drag.lastY - drag.y) >= 1 : Math.abs(dx) + Math.abs(dy) > 3;
    const identity = this.context.identity?.(),
      { document, sequence } = identity
        ? { document: drag.document, sequence: drag.sequence }
        : this.current();
    if (
      (identity?.documentId ?? document.id) !== drag.documentId ||
      (identity?.revision ?? document.revision) !== drag.revision ||
      identity?.generation !== drag.generation ||
      this.context.selection().sequenceId !== drag.sequenceId
    ) {
      this.cancel();
      throw new Error("工程已变化，请重新拖动片段");
    }
    if (drag.kind === "seek") {
      // Seeking must not snap to the playhead it just moved, which would trap small movements.
      drag.time = this.snap(this.point(drag.lastX), sequence, new Set(), !drag.altKey, false);
      this.run(() => this.context.seek(drag.time));
      return;
    }
    if (drag.kind === "box") {
      const rect = this.container.getBoundingClientRect(),
        initialX = drag.x - (viewport.scrollLeft - drag.scroll),
        initialY = drag.y - (body.scrollTop - drag.verticalScroll),
        left = Math.min(initialX, drag.lastX),
        top = Math.min(initialY, drag.lastY),
        right = Math.max(initialX, drag.lastX),
        bottom = Math.max(initialY, drag.lastY),
        visible = viewport.getBoundingClientRect(),
        area = body.getBoundingClientRect();
      const displayLeft = Math.max(visible.left, left),
        displayTop = Math.max(area.top, top);
      Object.assign(this.box!.style, {
        left: `${displayLeft - rect.left}px`,
        top: `${displayTop - rect.top}px`,
        width: `${Math.max(0, Math.min(right, visible.right) - displayLeft)}px`,
        height: `${Math.max(0, Math.min(bottom, area.bottom) - displayTop)}px`,
      });
      const ids = new Set(drag.additive ? drag.ids : []),
        sample = this.container.querySelector<HTMLElement>("[data-et-clip]"),
        // Offscreen clips are virtualized; all clip kinds share the visible clip's geometry.
        clipTop = sample?.offsetTop ?? 4,
        clipHeight = sample?.offsetHeight ?? this.trackHeight - 9;
      for (const clip of sequence.clips) {
        const lane = this.container
          .querySelector<HTMLElement>(`[data-et-lane="${CSS.escape(clip.trackId)}"]`)!
          .getBoundingClientRect();
        const x = visible.left + ticksToSeconds(clip.start) * this.scale - viewport.scrollLeft;
        if (
          x + Math.max(3, ticksToSeconds(clip.duration) * this.scale) >= left &&
          x <= right &&
          lane.top + clipTop + clipHeight > top &&
          lane.top + clipTop < bottom
        )
          ids.add(clip.id);
      }
      const expanded = this.expanded(sequence, ids);
      this.context.select([...expanded]);
      for (const element of this.container.querySelectorAll<HTMLElement>("[data-et-clip]")) {
        element.classList.toggle("selected", expanded.has(element.dataset.etClip!));
        element.setAttribute("aria-selected", String(expanded.has(element.dataset.etClip!)));
      }
      return;
    }
    const clip = drag.clip!;
    if (drag.kind === "gain") {
      if (!("audio" in clip) || typeof clip.audio.volume !== "number") return;
      drag.gain = Math.max(0, Math.min(4, clip.audio.volume - Math.round(drag.lastY - drag.y) / 100));
      if (drag.moved) {
        if (planNow) this.previewPlan(document, sequence, drag); else this.scheduleDragPlan();
      }
      const node = this.container.querySelector<HTMLElement>(`[data-et-clip="${CSS.escape(clip.id)}"]`);
      if (node) this.paintGain(node, drag.gain);
      const audible = !drag.plan?.reason && this.context.previewGain?.(clip.id, drag.gain);
      if (!drag.plan?.reason) this.notice.textContent = `${gainText(drag.gain)} · ${audible ? "正在实时试听，松开保存 · Esc 取消" : "仅预览音量线，开启调音试听后可实时听效果，松开保存"}`;
      return;
    }
    if (drag.kind === "fadeIn" || drag.kind === "fadeOut") {
      if (!("audio" in clip)) return;
      const desired = clip.audio[drag.kind] + Math.round(dx / this.scale * 240000) * (drag.kind === "fadeIn" ? 1 : -1);
      drag.delta = Math.min(clip.duration, Math.max(0,
        frameToTicks(ticksToFrame(Math.max(0, desired), sequence.frameRate), sequence.frameRate)));
      if (drag.moved) {
        if (planNow) this.previewPlan(document, sequence, drag);
        else this.scheduleDragPlan();
      }
      const node = this.container.querySelector<HTMLElement>(`[data-et-clip="${CSS.escape(clip.id)}"]`);
      if (node) {
        node.classList.toggle("drag-invalid", !!drag.plan?.reason);
        this.paintFade(node, drag.kind, drag.delta, clip.duration);
      }
      return;
    }
    const edge = clip.start + (drag.kind === "right" ? clip.duration : 0);
    const desired = Math.round((dx / this.scale) * 240000);
    drag.delta =
      drag.kind === "move"
        ? this.moveDelta(desired, sequence, drag.ids, clip, !drag.altKey)
        : this.snap(edge + desired, sequence, new Set(drag.ids), !drag.altKey) - edge;
    const hit = globalThis.document
      .elementFromPoint(drag.lastX, drag.lastY)
      ?.closest<HTMLElement>("[data-et-lane]");
    drag.targetTrack = hit?.dataset.etLane ?? clip.trackId;
    if (drag.moved) {
      if (planNow) this.previewPlan(document, sequence, drag);
      else this.scheduleDragPlan();
    }
    const sourceLane = this.container.querySelector<HTMLElement>(
      `[data-et-lane="${CSS.escape(clip.trackId)}"]`,
    );
    const destinationLane = this.container.querySelector<HTMLElement>(
      `[data-et-lane="${CSS.escape(drag.targetTrack)}"]`,
    );
    const vertical =
      drag.kind === "move" && sourceLane && destinationLane
        ? destinationLane.getBoundingClientRect().top - sourceLane.getBoundingClientRect().top
        : 0;
    for (const lane of this.container.querySelectorAll<HTMLElement>("[data-et-lane]")) {
      const target = drag.kind === "move" && lane.dataset.etLane === drag.targetTrack;
      lane.classList.toggle("drop-target", target);
      lane.classList.toggle("drop-target-invalid", !!drag.plan?.reason && target);
    }
    for (const element of this.container.querySelectorAll<HTMLElement>("[data-et-clip]")) {
      const source = sequence.clips.find((item) => item.id === element.dataset.etClip)!;
      element.classList.toggle(
        "drag-invalid",
        !!drag.plan?.reason &&
          (drag.kind === "move" ? drag.ids.includes(source.id) : source.id === clip.id),
      );
      if (drag.kind === "move" && drag.ids.includes(source.id)) {
        element.style.pointerEvents = "none";
        element.style.transform = `translate(${(drag.delta / 240000) * this.scale}px,${vertical}px)`;
      } else if (source.id === clip.id && drag.kind !== "move") {
        const deltaPx = (drag.delta / 240000) * this.scale;
        element.style.transform = drag.kind === "left" ? `translateX(${deltaPx}px)` : "";
        element.style.width = `${Math.max(3, ticksToSeconds(clip.duration) * this.scale + (drag.kind === "left" ? -deltaPx : deltaPx))}px`;
      }
    }
  }
  /** Several pointer events can arrive before paint; validate only their latest quantized result. */
  private scheduleDragPlan(): void {
    if (this.dragPlanFrame !== undefined) return;
    this.dragPlanFrame = requestAnimationFrame(() => {
      this.dragPlanFrame = undefined;
      if (!this.destroyed && this.drag) this.run(() => this.updateDrag(true));
    });
  }
  /** Preview and release share the exact planners; only changed frame/track results are validated. */
  private previewPlan(document: EditorDocument, sequence: EditorSequence, drag: Drag): void {
    const key = `${drag.kind}:${drag.kind === "gain" ? drag.gain : drag.delta}:${drag.kind === "move" ? drag.targetTrack : ""}`;
    if (drag.plan?.key === key) return;
    try {
      drag.plan = { key, operations: this.planDrag(document, sequence, drag) };
    } catch (error) {
      drag.plan = {
        key,
        error,
        reason: (error instanceof Error ? error.message : String(error)) || "无法在此位置编辑片段",
      };
    }
    const reason = drag.plan.reason ?? "";
    if (this.notice.textContent !== reason) this.notice.textContent = reason;
    const range = !reason && drag.clip && ["move", "left", "right"].includes(drag.kind)
      ? dragReadoutRange(sequence.id, drag.clip, drag.plan.operations!) : undefined;
    this.dragReadout.hidden = !range;
    if (range) {
      const values = [range.start, range.end, range.duration,
        drag.kind === "move" ? range.start - drag.clip!.start : range.duration - drag.clip!.duration];
      this.dragReadout.querySelector("i")!.textContent = drag.kind === "move" ? "位置变化" : "时长变化";
      this.dragReadout.querySelectorAll("b").forEach((node, index) => {
        const text = dragReadoutSeconds(values[index]!, index === 3);
        if (node.textContent !== text) node.textContent = text;
      });
    }
  }
  private planDrag(
    document: EditorDocument,
    sequence: EditorSequence,
    drag: Drag,
  ): EditorOperation[] {
    const clip = drag.clip!;
    if (drag.kind === "gain") {
      const volume = drag.gain!;
      if (!this.context.identity) return planClipAudioGain(document, sequence.id, clip.id, volume);
      if (!("audio" in clip) || typeof clip.audio.volume !== "number") throw new Error("音量已自动化，请在属性面板编辑关键帧");
      if (clip.audio.volume === volume) return [];
      const operations: EditorOperation[] = [{ type: "clip.update", sequenceId: sequence.id, clipId: clip.id,
        patch: { audio: { ...clip.audio, volume } } }];
      drag.fadePreview ??= prepareEditorOperationPreview(document);
      drag.fadePreview.preview(operations);
      return operations;
    }
    if (drag.kind === "fadeIn" || drag.kind === "fadeOut") {
      if (!this.context.identity) return planClipAudioFade(document, sequence.id, clip.id, drag.kind, drag.delta);
      if (!("audio" in clip)) throw new Error("片段不含声音属性");
      if (clip.audio[drag.kind] === drag.delta) return [];
      const operations: EditorOperation[] = [{ type: "clip.update", sequenceId: sequence.id, clipId: clip.id,
        patch: { audio: { ...clip.audio, [drag.kind]: drag.delta } } }];
      drag.fadePreview ??= prepareEditorOperationPreview(document);
      drag.fadePreview.preview(operations);
      return operations;
    }
    if (drag.kind === "move") {
      if (sequence.timelineMode === "magnetic")
        return planMagneticMove(document, sequence.id, drag.ids, {
          delta: drag.delta,
          trackId: drag.targetTrack,
          anchorClipId: clip.id,
        });
      const operations: EditorOperation[] = [
        {
          type: "clip.move",
          sequenceId: sequence.id,
          clipIds: drag.ids,
          delta: drag.delta,
          trackId: drag.targetTrack,
        },
      ];
      if (this.context.identity) {
        drag.movePreview ??= prepareEditorOperationPreview(document);
        drag.movePreview.preview(operations);
      } else applyEditorOperations(document, operations, document.revision);
      return structuredClone(operations);
    }
    if (isMagneticTrack(sequence, clip.trackId))
      return planClipTiming(
        document,
        sequence.id,
        [clip.id],
        {
          kind: drag.kind === "left" ? "keep-right" : "keep-left",
          time: clip.start + (drag.kind === "left" ? drag.delta : clip.duration + drag.delta),
        },
        { ripple: true },
      );
    const start = drag.kind === "left" ? drag.delta : 0,
      end = drag.kind === "right" ? clip.duration + drag.delta : clip.duration;
    if (!this.context.identity) return trimClip(document, sequence.id, clip.id, start, end);
    drag.trimPreview ??= prepareClipTrim(document, sequence.id, clip.id);
    return drag.trimPreview.plan(start, end);
  }
  /** Keep scrolling bounded by pixels per second, never by callback count or elapsed background time. */
  private scrollVelocity(): { x: number; y: number } {
    const drag = this.drag;
    if (!drag?.moved || this.destroyed || drag.kind === "gain") return { x: 0, y: 0 };
    const viewport = this.viewport(),
      body = this.container.querySelector<HTMLElement>(".et-body")!;
    const view = viewport.getBoundingClientRect(),
      area = body.getBoundingClientRect();
    const left = view.left,
      right = view.right,
      top = Math.max(view.top, area.top),
      bottom = Math.min(view.bottom, area.bottom);
    const zone = 36;
    const velocity = (position: number, start: number, end: number, rate: number) =>
      position < start + zone
        ? -rate * Math.min(1, Math.max(0, (start + zone - position) / zone))
        : position > end - zone
          ? rate * Math.min(1, Math.max(0, (position - end + zone) / zone))
          : 0;
    if (
      drag.lastX < left - zone ||
      drag.lastX > right + zone ||
      drag.lastY < top - zone ||
      drag.lastY > bottom + zone
    )
      return { x: 0, y: 0 };
    let x = velocity(drag.lastX, left, right, 480);
    let y = ["move", "box"].includes(drag.kind) ? velocity(drag.lastY, top, bottom, 320) : 0;
    if (
      (x < 0 && viewport.scrollLeft <= 0) ||
      (x > 0 && viewport.scrollLeft >= viewport.scrollWidth - viewport.clientWidth)
    )
      x = 0;
    if (
      (y < 0 && body.scrollTop <= 0) ||
      (y > 0 && body.scrollTop >= body.scrollHeight - body.clientHeight)
    )
      y = 0;
    return { x, y };
  }
  private startAutoScroll(): void {
    if (this.autoScrollFrame !== undefined) return;
    const velocity = this.scrollVelocity();
    if (!velocity.x && !velocity.y) return;
    this.autoScrollTime = performance.now();
    this.autoScrollRemainder = { x: 0, y: 0 };
    this.autoScrollFrame = requestAnimationFrame(this.autoScroll);
  }
  private autoScroll = (now: number) => {
    this.autoScrollFrame = undefined;
    if (!this.drag || this.destroyed) return;
    const velocity = this.scrollVelocity();
    if (!velocity.x && !velocity.y) return;
    const elapsed = Math.max(0, Math.min(32, now - this.autoScrollTime)) / 1000;
    const viewport = this.viewport(),
      body = this.container.querySelector<HTMLElement>(".et-body")!;
    const left = viewport.scrollLeft,
      top = body.scrollTop;
    this.autoScrollRemainder.x += velocity.x * elapsed;
    this.autoScrollRemainder.y += velocity.y * elapsed;
    const stepX = Math.trunc(this.autoScrollRemainder.x),
      stepY = Math.trunc(this.autoScrollRemainder.y);
    this.autoScrollRemainder.x -= stepX;
    this.autoScrollRemainder.y -= stepY;
    viewport.scrollLeft += stepX;
    body.scrollTop += stepY;
    this.scrollPosition = viewport.scrollLeft;
    this.verticalPosition = body.scrollTop;
    if (left === viewport.scrollLeft && top === body.scrollTop) {
      this.autoScrollTime = now;
      this.autoScrollFrame = requestAnimationFrame(this.autoScroll);
      return;
    }
    this.run(() => {
      // Rebuild only visible clips while capture stays on the stable outer container.
      this.render();
      this.updateDrag();
      if (this.drag && !this.destroyed) {
        this.autoScrollTime = now;
        this.autoScrollFrame = requestAnimationFrame(this.autoScroll);
      }
    });
  };
  private pointerup = (event: GesturePointer) => {
    const pan = this.viewPan;
    if (pan?.pointerId === event.pointerId) {
      this.run(() => this.panTo(event));
      this.cancelPan(pan);
      return;
    }
    const control = this.pendingControl;
    if (control?.pointerId === event.pointerId) {
      if (control.up === undefined) {
        const target = globalThis.document.elementFromPoint(event.clientX, event.clientY);
        control.up = control.intent.kind === "menu"
          ? target?.closest<HTMLElement>("[data-et-clip]")?.dataset.etClip === control.intent.clipId
          : target instanceof Element && !!target.closest("button") &&
            JSON.stringify(this.controlIntent(target.closest<HTMLButtonElement>("button")!)) === JSON.stringify(control.intent);
        void this.finishControl(control);
      }
      return;
    }
    const pending = this.pendingTrackGesture;
    if (pending?.intent.pointer.pointerId === event.pointerId) {
      pending.up ??= gesturePointer(event);
      return;
    }
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.altKey = event.altKey;
    let operations: EditorOperation[] | undefined;
    try {
      this.updateDrag(true);
      if (drag.moved && !["seek", "box"].includes(drag.kind) && !drag.plan?.reason)
        operations = structuredClone(
          drag.plan?.operations ?? this.planDrag(drag.document, drag.sequence, drag),
        );
    } catch (error) {
      this.cancel();
      this.context.onError(error);
      return;
    }
    this.cancel();
    this.run(async () => {
      const { document, sequence } = this.current();
      if (
        document.id !== drag.documentId ||
        document.revision !== drag.revision ||
        this.context.identity?.().generation !== drag.generation ||
        sequence.id !== drag.sequenceId
      )
        throw new Error("工程已变化，请重新拖动片段");
      if (drag.kind === "seek")
        await this.context.seek(
          this.snap(this.point(event.clientX), sequence, new Set(), !drag.altKey, false),
        );
      else if (drag.kind === "box") {
        if (!drag.moved && !drag.additive) this.context.select([]);
      } else if (drag.moved) {
        if (drag.plan?.reason) {
          this.notice.textContent = drag.plan.reason;
          throw drag.plan.error;
        }
        if (drag.kind === "move" && sequence.timelineMode === "magnetic")
          await this.applyMagneticMove(operations!, "移动片段");
        else if (operations?.length) await this.apply(operations, drag.kind === "move" ? "移动片段"
          : drag.kind === "gain" ? "调整片段音量" : drag.kind === "fadeIn" ? "调整声音淡入" : drag.kind === "fadeOut" ? "调整声音淡出" : "裁剪片段");
      }
      this.render();
      this.recordTextClick(drag, event);
    });
  };
  private cancel = () => {
    if (this.textNavigation) this.cancelTextNavigation();
    this.cancelMarkerNavigation();
    this.cancelPan();
    if (!this.audioEdit?.applying) this.cancelAudioEdit();
    this.cancelControl();
    this.cancelTrackGesture();
    this.notice.textContent = "";
    this.dragReadout.hidden = true;
    if (this.dragPlanFrame !== undefined) cancelAnimationFrame(this.dragPlanFrame);
    this.dragPlanFrame = undefined;
    if (this.autoScrollFrame !== undefined) cancelAnimationFrame(this.autoScrollFrame);
    this.autoScrollFrame = undefined;
    const drag = this.drag;
    if (drag?.kind === "gain") this.context.endGainPreview?.();
    drag?.movePreview?.dispose();
    drag?.trimPreview?.dispose();
    drag?.fadePreview?.dispose();
    this.drag = undefined;
    this.updateTrackHeightControl();
    if (drag && this.container.hasPointerCapture(drag.pointerId))
      this.container.releasePointerCapture(drag.pointerId);
    this.box?.remove();
    this.box = undefined;
    const clips = this.current().sequence.clips;
    for (const clip of this.container.querySelectorAll<HTMLElement>("[data-et-clip]")) {
      clip.classList.remove("drag-invalid");
      clip.style.transform = "";
      clip.style.pointerEvents = "";
      const source = clips.find((item) => item.id === clip.dataset.etClip);
      if (source && "audio" in source) {
        if (typeof source.audio.volume === "number") this.paintGain(clip, source.audio.volume);
        this.paintFade(clip, "fadeIn", source.audio.fadeIn, source.duration);
        this.paintFade(clip, "fadeOut", source.audio.fadeOut, source.duration);
      }
      if (source)
        clip.style.width = `${Math.max(3, ticksToSeconds(source.duration) * this.scale)}px`;
    }
    for (const lane of this.container.querySelectorAll<HTMLElement>("[data-et-lane]"))
      lane.classList.remove("drop-target", "drop-target-invalid");
  };
  private cancelPointer = (event: PointerEvent) => {
    if (event.type === "pointercancel") this.clearTextClick();
    if (this.viewPan?.pointerId === event.pointerId) this.cancelPan();
    const control = this.pendingControl;
    if (
      control?.pointerId === event.pointerId &&
      !(event.type === "lostpointercapture" && control.up !== undefined)
    )
      this.cancelControl();
    const pending = this.pendingTrackGesture;
    if (pending?.intent.pointer.pointerId === event.pointerId) {
      if (event.type === "lostpointercapture" && pending.up) return;
      this.cancelTrackGesture(); this.render();
    }
    if (this.drag?.pointerId === event.pointerId) this.cancel();
  };
  /** Leaving the window or hiding the document ends a gesture whose release may never arrive. */
  private interrupt = (event: Event) => {
    const hidden = globalThis.document.visibilityState === "hidden";
    if (event.type !== "visibilitychange" || hidden) { this.clearTextClick(); this.cancelTextNavigation(); }
    if (event.type !== "visibilitychange" || hidden) this.cancelMarkerNavigation();
    if (event.type !== "visibilitychange" || hidden) this.cancelPan();
    if (
      (!this.drag && !this.pendingTrackGesture && !this.pendingControl && !this.audioEdit) ||
      (event.type === "visibilitychange" && !hidden)
    )
      return;
    this.run(() => {
      const pending = !!this.pendingTrackGesture;
      this.cancel();
      if (pending) this.render();
    });
  };
  dispose(): void {
    this.cancelAudioEdit();
    this.closeMenu();
    this.cancel();
    this.destroyed = true;
    this.markerNavigationPending = undefined;
    this.trimShortcutPending = undefined;
    if (this.mediaFrame !== undefined) cancelAnimationFrame(this.mediaFrame);
    this.resizeObserver?.disconnect();
    this.media.dispose();
    this.container.removeEventListener("focusin", this.gainFocus);
    this.container.removeEventListener("click", this.click);
    this.container.removeEventListener("change", this.change);
    this.container.removeEventListener("input", this.input);
    this.container.removeEventListener("wheel", this.wheel);
    this.container.removeEventListener("keydown", this.keydown);
    this.container.removeEventListener("change", this.replacementChange, true);
    this.container.removeEventListener("keyup", this.keyup);
    this.container.removeEventListener("pointerdown", this.pointerdown);
    this.container.removeEventListener("pointermove", this.pointermove);
    this.container.removeEventListener("pointerup", this.pointerup);
    this.container.removeEventListener("pointercancel", this.cancelPointer);
    this.container.removeEventListener("lostpointercapture", this.cancelPointer);
    window.removeEventListener("blur", this.interrupt);
    globalThis.document.removeEventListener("visibilitychange", this.interrupt);
    globalThis.document.removeEventListener("keydown", this.panEscape, true);
    globalThis.document.removeEventListener("pointerdown", this.panReleaseDefault, true);
    globalThis.document.removeEventListener("pointerup", this.panReleaseDefault, true);
    this.panRelease = undefined;
    this.container.removeEventListener("dragover", this.dragover);
    this.container.removeEventListener("drop", this.drop);
    this.container.removeEventListener("contextmenu", this.contextmenu);
    globalThis.document.removeEventListener("keydown", this.clearTextClick, true);
    globalThis.document.removeEventListener("pointerdown", this.textNavigationPointer, true);
    this.container.classList.remove("et-tall-tracks");
    this.container.innerHTML = "";
  }
}
