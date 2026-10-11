import { randomId } from "../ids.js";
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
  selectedMarker?(): string | undefined;
  selectMarker?(markerId: string): void;
  time(): Tick;
  seek(time: Tick, exact?: boolean): void | Promise<void>;
  apply(operations: EditorOperation[], label: string): void | Promise<void>;
  /** Persist destructive clipboard edits before consuming their copy snapshot or selection. */
  applyClipboard?(operations: EditorOperation[], label: string): Promise<void>;
  addAsset?(assetId: string, placement: { at: Tick; trackId: string }): void | Promise<void>;
  /** Adds a visible title at the playhead; shown as the 添加文字 tool when provided. */
  addText?(): void | Promise<void>;
  showShortcuts?(): void | Promise<void>;
  onError(error: unknown): void;
}
type Drag = {
  kind: "move" | "left" | "right" | "seek" | "box";
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
  time: Tick;
  moved: boolean;
  additive: boolean;
  altKey: boolean;
  movePreview?: EditorOperationPreview;
  trimPreview?: ClipTrimPreview;
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
type GestureIntent = {
  pointer: GesturePointer;
  kind: Drag["kind"];
  clipId?: string;
  clipKind?: EditorClip["kind"];
  trackId?: string;
  additive: boolean;
  scroll: number;
  verticalScroll: number;
};
type PendingTrackGesture = {
  owner: TrackInputOwner;
  intent: GestureIntent;
  last: GesturePointer;
  up?: GesturePointer;
};
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
  if (clip.kind !== "text") return clip.label;
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
  /** One persistent live region; rendering keeps the node so text changes are announced. */
  private readonly notice = globalThis.document.createElement("p");
  private clipboard?: { payload: ClipClipboard; documentId: string; generation?: number };
  private clipboardPending = false;
  private drag?: Drag;
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
    container.classList.add("editor-timeline");
    container.tabIndex = 0;
    container.setAttribute("aria-label", "剪辑时间轴");
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
    container.addEventListener("dragover", this.dragover);
    container.addEventListener("drop", this.drop);
    container.addEventListener("contextmenu", this.contextmenu);
    this.render();
    this.resizeObserver = new ResizeObserver(() => {
      const width = container.clientWidth;
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
    if (this.destroyed || this.replacingControls) return;
    this.media.cancel();
    const focused = globalThis.document.activeElement;
    const focusedClip =
      focused instanceof HTMLElement
        ? focused.closest<HTMLElement>("[data-et-clip]")?.dataset.etClip
        : undefined;
    const restoreFocus = focused instanceof HTMLElement && this.container.contains(focused);
    // Only the explicit session-owned hook permits holding this detached read until RAF.
    const before = this.context.prepareMediaSnapshot && this.context.identity?.(),
      identity = before ? { ...before } : undefined,
      sequenceId = identity ? this.context.selection().sequenceId : undefined;
    const { document: project, sequence, selected } = this.current();
    const candidate =
      identity && sequenceId === sequence.id ? { document: project, sequence, identity } : undefined;
    const mediaScope = candidate && this.mediaScopeCurrent(candidate) ? candidate : undefined;
    this.clearStaleClipboard(project);
    if (this.pendingTrackGesture && !this.trackOwnerCurrent(this.pendingTrackGesture.owner))
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
        <div class="et-zoom-tools" role="group" aria-label="时间轴视图">${button("fit", "适合窗口", "fit", false, "Shift+Z")}${button("zoom-out", "缩小时间轴", "minus", false, "−")}<label class="et-zoom" title="时间轴缩放 · Ctrl/⌘ + 滚轮"><input data-et-zoom type="range" min="-2" max="3" step="0.05" value="${Math.log10(this.scale)}" aria-label="时间轴缩放"></label>${button("zoom-in", "放大时间轴", "plus", false, "+")}${this.context.showShortcuts ? button("shortcuts", "剪辑快捷键", "keyboard", false, "?") : ""}</div>
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
            <div class="et-track-title"><span class="et-track-kind" title="${{ video: "画面轨道", audio: "声音轨道", text: "文字轨道" }[track.kind]}">${timelineIcon(kindIcon, 14)}</span><input value="${esc(track.name)}" data-et-track-name="${esc(track.id)}" aria-label="轨道名称 ${esc(track.name)}" title="重命名轨道"><span class="et-track-controls">${toggle("locked", track.locked ? "解锁" : "锁定", track.locked ? "locked" : "unlocked")}${toggle("hidden", track.hidden ? "显示" : "隐藏", track.hidden ? "hidden" : "visible")}${toggle("muted", track.muted ? "取消静音" : "静音", track.muted ? "muted" : "volume")}</span></div>
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
                  `<div role="option" aria-selected="${selected.has(clip.id)}" tabindex="0" class="et-clip et-${clip.kind} et-clip-${track.kind}${selected.has(clip.id) ? " selected" : ""}" data-et-clip="${esc(clip.id)}" style="left:${ticksToSeconds(clip.start) * this.scale}px;width:${Math.max(3, ticksToSeconds(clip.duration) * this.scale)}px" title="${esc(clipLabel(clip))} · ${stamp(clip.start)} — ${stamp(clip.start + clip.duration)}"><span class="et-edge left" data-et-edge="left" aria-label="裁剪开头"></span><span class="et-clip-label">${esc(clipLabel(clip))}</span>${clip.groupId ? '<span class="et-group">▣</span>' : ""}<span class="et-edge right" data-et-edge="right" aria-label="裁剪结尾"></span></div>`,
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
        for (const control of this.container.querySelectorAll<HTMLInputElement | HTMLButtonElement>('[data-et-zoom],[data-et-action="fit"],[data-et-action="zoom-in"],[data-et-action="zoom-out"]'))
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
    this.container.querySelector(".et-toolbar")!.after(this.notice);
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
    if (this.drag?.kind === "box") this.createBox();
    if (restoreFocus && !(focused instanceof HTMLElement && focused.isConnected)) {
      const next = focusedClip
        ? this.container.querySelector<HTMLElement>(`[data-et-clip="${CSS.escape(focusedClip)}"]`)
        : undefined;
      (next ?? this.container).focus({ preventScroll: true });
    }
  }
  private syncVerticalScroll = (): void => {
    const body = this.container.querySelector<HTMLElement>(".et-body");
    // Restoring a replaced body's scrollTop queues an event for an already-rendered view.
    if (!body || body.scrollTop === this.verticalPosition) return;
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
        // Compact lanes keep the strip as tall as the clip allows, up to the full 32px.
        const stripHeight = Math.max(16, Math.min(32, node.clientHeight - 2));
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
    const line = this.container.querySelector<HTMLElement>(".et-playhead");
    if (line) line.style.left = `${ticksToSeconds(this.context.time()) * this.scale}px`;
  }
  /** Keyboard navigation reveals the current result without changing the document or selection. */
  private async seekVisible(time: Tick, exact = false): Promise<void> {
    await this.context.seek(time, exact);
    this.revealPlayhead();
  }
  /** Reveal the current clock without changing selection, zoom or document history. */
  revealPlayhead(): void {
    if (this.destroyed) return;
    const viewport = this.viewport(),
      x = ticksToSeconds(this.context.time()) * this.scale,
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
    const target = event.target instanceof HTMLElement ? event.target : undefined;
    if (!target) return;
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
      key = data.etToggle as "locked" | "hidden" | "muted" | undefined,
      desired = key ? !sequence.tracks.find((track) => track.id === owner.trackId)![key] : undefined,
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
      if (track.locked && key !== "locked" && !Object.hasOwn(data, "etDeleteCancel"))
        throw new Error("轨道已锁定，请先解锁再操作");
      if (key) {
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
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(".et-scroll")) return;
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
  async action(action: string, at = this.context.time()): Promise<void> {
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
      if (!ids.length || sequence.clips.some((clip) =>
        selected.has(clip.id) && (time <= clip.start || time >= clip.start + clip.duration)))
        throw new Error("请把播放头移到每个所选片段内部，再保留左侧或右侧");
      const operations = planClipTiming(document, sequence.id, ids, { kind: action, time });
      await this.apply(operations, action === "keep-left" ? "保留播放头左侧" : "保留播放头右侧");
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
  private keydown = (event: KeyboardEvent) => {
    if (event.isComposing || editableTarget(event.target)) return;
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
    this.openMenu(target.dataset.etClip!, event.clientX, event.clientY);
  };
  private openMenu(clipId: string, x: number, y: number): void {
    this.closeMenu();
    this.cancel();
    const current = this.current();
    const clip = current.sequence.clips.find((clip) => clip.id === clipId);
    if (!clip) return;
    this.select(
      current.selected.has(clipId) ? current.selected : this.expanded(current.sequence, [clipId]),
    );
    const { document, sequence, selected } = this.current();
    this.clearStaleClipboard(document);
    const time = this.context.time(),
      chosen = sequence.clips.filter((clip) => selected.has(clip.id)),
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
      timeReason = inside ? "" : "请把播放头移到每个所选片段内部";
    element.innerHTML = `<div class="timeline-context-menu-title">${esc(clipLabel(clip))}${selected.size > 1 ? ` · ${selected.size} 个片段` : ""}</div>
      ${item("copy", "复制", "⌘/Ctrl C", pending)}${item("cut", "剪切", "⌘/Ctrl X", pending || lockReason)}${item("paste", "粘贴到播放头", "⌘/Ctrl V", pending || (!this.clipboard ? "请先复制片段" : ""))}${item("duplicate", "原位复制", "⌘/Ctrl D", pending)}
      <div role="separator"></div>${item("split", "在播放头切分", "S", lockReason || timeReason)}${item("keep-left", "保留播放头左侧", "", lockReason || timeReason)}${item("keep-right", "保留播放头右侧", "", lockReason || timeReason)}
      <div role="separator"></div>${item("group", "分组", "⌘/Ctrl G", lockReason || (selected.size < 2 ? "至少选择两个片段" : ""))}${item("ungroup", "解组", "⇧ ⌘/Ctrl G", lockReason || (!chosen.some((clip) => clip.groupId) ? "所选片段没有分组" : ""))}
      <div role="separator"></div>${item("remove", `从时间轴删除${selected.size > 1 ? ` ${selected.size} 个片段` : ""}`, "⌫", lockReason, true)}${item("cancel", "取消")}
      <p id="timeline-context-menu-note">播放头：${ticksToSeconds(time).toFixed(6)} 秒（打开菜单时）。${lockReason || timeReason || ""} 编辑可撤销；磁吸主画面轨的裁剪会联动后续片段。</p>`;
    const lifetime = new AbortController();
    this.menu = {
      element,
      lifetime,
      documentId: document.id,
      revision: document.revision,
      generation: this.context.identity?.().generation,
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
      const current = this.menuCurrent();
      const action = button.dataset.timelineMenuAction!, at = this.menu.time;
      this.closeMenu(current);
      if (!current) return this.context.onError(new Error("工程或选择已变化，请重新打开片段菜单"));
      this.run(() => this.action(action === "remove" ? "delete" : action, at));
    });
    element.addEventListener("contextmenu", (event) => event.preventDefault());
    globalThis.document.body.append(element);
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
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
    if (event.button === 0 && event.target instanceof Element && event.target.closest(TRACK_BUTTONS) &&
      globalThis.document.activeElement instanceof HTMLInputElement &&
      globalThis.document.activeElement.matches(TRACK_INPUTS)) {
      event.preventDefault();
      return;
    }
    if (this.pendingTrackGesture || this.trackControlPending) { event.preventDefault(); return; }
    if (event.button !== 0 || this.drag || editableTarget(event.target)) return;
    const target = event.target instanceof HTMLElement ? event.target : undefined;
    if (!target || target.closest("button,.et-toolbar,.et-track-heads")) return;
    const node = target.closest<HTMLElement>("[data-et-clip]"), intent: GestureIntent = {
      pointer: gesturePointer(event),
      clipId: node?.dataset.etClip,
      kind: node ? (target.closest<HTMLElement>("[data-et-edge]")?.dataset.etEdge as "left" | "right" | undefined) ?? "move"
        : target.closest(".et-ruler,.et-marker-lane,.et-playhead") ? "seek" : "box",
      additive: event.shiftKey || event.ctrlKey || event.metaKey,
      scroll: this.viewport().scrollLeft,
      verticalScroll: this.container.querySelector<HTMLElement>(".et-body")!.scrollTop,
    };
    event.preventDefault();
    const input = globalThis.document.activeElement;
    if (input instanceof HTMLInputElement && input.matches(TRACK_INPUTS) && this.trackInputCurrent(input)) {
      const clip = this.current().sequence.clips.find((item) => item.id === intent.clipId);
      intent.clipKind = clip?.kind;
      intent.trackId = clip?.trackId;
      this.run(() => this.trackDraftGesture(input, intent));
      return;
    }
    this.run(() => this.beginGesture(intent));
  };
  /** A track draft must finish before the gesture takes its revision-bound document snapshot. */
  private async trackDraftGesture(input: HTMLInputElement, intent: GestureIntent): Promise<void> {
    const owner = this.trackInputs.get(input)!, pending: PendingTrackGesture = {
      owner, intent, last: { ...intent.pointer },
    }, selector = input.dataset.etTrackName ? `[data-et-track-name="${CSS.escape(input.dataset.etTrackName)}"]`
      : `[data-et-track-id="${CSS.escape(input.dataset.etTrackId!)}"][data-et-track-mix="${input.dataset.etTrackMix}"]`;
    let value = input.value, saved = false, finishing = false;
    this.pendingTrackGesture = pending;
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
      this.render();
      if (!this.trackOwnerCurrent(owner)) return;
      this.beginGesture(intent, !pending.up);
      if (!this.drag) return;
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
    this.notice.textContent = "";
    const { document, sequence, selected } = this.current(), { pointer, kind, additive } = intent,
      clip = sequence.clips.find((item) => item.id === intent.clipId);
    if (intent.clipId && (!clip || (intent.clipKind && (clip.kind !== intent.clipKind || clip.trackId !== intent.trackId)) ||
      !this.container.querySelector(`[data-et-clip="${CSS.escape(intent.clipId)}"]`)))
      throw new Error("片段已变化，请重新选择或拖动");
    let ids = new Set(selected);
    if (clip) {
      const group = this.expanded(sequence, [clip.id]);
      if (additive && selected.has(clip.id)) for (const id of group) ids.delete(id);
      else {
        if (!additive && !selected.has(clip.id)) ids.clear();
        for (const id of group) ids.add(id);
      }
      this.context.select([...ids]);
      if (!ids.has(clip.id)) { this.render(); return; }
    }
    this.drag = {
      kind,
      pointerId: pointer.pointerId,
      x: pointer.clientX,
      y: pointer.clientY,
      scroll: intent.scroll,
      verticalScroll: intent.verticalScroll,
      lastX: pointer.clientX,
      lastY: pointer.clientY,
      documentId: document.id,
      revision: document.revision,
      generation: this.context.identity?.().generation,
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
    this.container.focus({ preventScroll: true });
    if (capture) this.container.setPointerCapture(pointer.pointerId);
    if (kind === "box") this.createBox();
    if (clip)
      for (const element of this.container.querySelectorAll<HTMLElement>("[data-et-clip]")) {
        element.classList.toggle("selected", ids.has(element.dataset.etClip!));
        element.setAttribute("aria-selected", String(ids.has(element.dataset.etClip!)));
      }
  }
  private cancelTrackGesture(): void {
    const pending = this.pendingTrackGesture;
    if (!pending) return;
    this.pendingTrackGesture = undefined;
    if (this.container.hasPointerCapture(pending.intent.pointer.pointerId))
      this.container.releasePointerCapture(pending.intent.pointer.pointerId);
  }
  private pointermove = (event: PointerEvent) => {
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
    drag.moved ||= Math.abs(dx) + Math.abs(dy) > 3;
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
        clipHeight = sample?.offsetHeight ?? 39;
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
    const clip = drag.clip!,
      edge = clip.start + (drag.kind === "right" ? clip.duration : 0);
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
    const key = `${drag.kind}:${drag.delta}:${drag.kind === "move" ? drag.targetTrack : ""}`;
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
  }
  private planDrag(
    document: EditorDocument,
    sequence: EditorSequence,
    drag: Drag,
  ): EditorOperation[] {
    const clip = drag.clip!;
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
    if (!drag?.moved || this.destroyed) return { x: 0, y: 0 };
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
        else await this.apply(operations!, drag.kind === "move" ? "移动片段" : "裁剪片段");
      }
      this.render();
    });
  };
  private cancel = () => {
    this.cancelTrackGesture();
    this.notice.textContent = "";
    if (this.dragPlanFrame !== undefined) cancelAnimationFrame(this.dragPlanFrame);
    this.dragPlanFrame = undefined;
    if (this.autoScrollFrame !== undefined) cancelAnimationFrame(this.autoScrollFrame);
    this.autoScrollFrame = undefined;
    const drag = this.drag;
    drag?.movePreview?.dispose();
    drag?.trimPreview?.dispose();
    this.drag = undefined;
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
      if (source)
        clip.style.width = `${Math.max(3, ticksToSeconds(source.duration) * this.scale)}px`;
    }
    for (const lane of this.container.querySelectorAll<HTMLElement>("[data-et-lane]"))
      lane.classList.remove("drop-target", "drop-target-invalid");
  };
  private cancelPointer = (event: PointerEvent) => {
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
    if ((!this.drag && !this.pendingTrackGesture) || (event.type === "visibilitychange" && !hidden)) return;
    this.run(() => { const pending = !!this.pendingTrackGesture; this.cancel(); if (pending) this.render(); });
  };
  dispose(): void {
    this.closeMenu();
    this.cancel();
    this.destroyed = true;
    if (this.mediaFrame !== undefined) cancelAnimationFrame(this.mediaFrame);
    this.resizeObserver?.disconnect();
    this.media.dispose();
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
    this.container.removeEventListener("dragover", this.dragover);
    this.container.removeEventListener("drop", this.drop);
    this.container.removeEventListener("contextmenu", this.contextmenu);
    this.container.innerHTML = "";
  }
}
