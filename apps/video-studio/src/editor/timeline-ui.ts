import {
  EditorTimelineMedia,
  TIMELINE_MEDIA_LIMITS,
  type EditorTimelineMediaOptions,
  type TimelineMediaStrip,
} from "./timeline-media";
import { escapeHtml as esc } from "../icons";
import { createTrack } from "./defaults";
import {
  copyClips,
  pasteClips,
  splitClip,
  trimClip,
  groupClips,
  ungroupClips,
  type ClipClipboard,
} from "./clip-edits";
import { planCutClips, duplicateClipsInPlace } from "./clipboard-edits";
import type { EditorOperation } from "./operations";
import { frameToTicks, ticksToFrame, ticksToSeconds, secondsToTicks, type Tick } from "./time";
import type { EditorClip, EditorDocument, EditorSequence } from "./types";
import type { SessionIdentity } from "./session";
import { sequenceDuration } from "./validation";
import {
  magneticMovementIds,
  isMagneticTrack,
  planMagneticMove,
  planMagneticRemove,
  planClipTiming,
} from "./timing-edits";

export interface EditorTimelineContext {
  media?: EditorTimelineMediaOptions;
  read(): EditorDocument;
  identity?(): SessionIdentity;
  selection(): { sequenceId: string; clipIds: string[] };
  select(clipIds: string[]): void;
  selectedMarker?(): string | undefined;
  selectMarker?(markerId: string): void;
  time(): Tick;
  seek(time: Tick): void | Promise<void>;
  apply(operations: EditorOperation[], label: string): void | Promise<void>;
  addAsset?(assetId: string, placement: { at: Tick; trackId: string }): void | Promise<void>;
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
  sequenceId: string;
  clip?: EditorClip;
  ids: string[];
  targetTrack?: string;
  delta: Tick;
  time: Tick;
  moved: boolean;
  additive: boolean;
};
const uid = (kind: string) => `${kind}-${crypto.randomUUID()}`;
const editableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && !!target.closest("input,textarea,select,[contenteditable=true]");
const stamp = (time: Tick) => {
  const value = ticksToSeconds(time);
  return `${Math.floor(value / 60)}:${(value % 60).toFixed(value < 10 ? 2 : 1).padStart(value < 10 ? 5 : 4, "0")}`;
};

/** A view of the parent's single document. All gestures commit one command batch. */
export class EditorTimeline {
  private media: EditorTimelineMedia;
  private mediaFrame?: number;
  private resizeObserver?: ResizeObserver;
  private scale = 64;
  private snapping = true;
  private clipboard?: ClipClipboard;
  private drag?: Drag;
  private destroyed = false;
  private box?: HTMLElement;
  private scrollPosition = 0;
  private verticalPosition = 0;
  private autoScrollFrame: number | undefined;
  private autoScrollTime = 0;
  private autoScrollRemainder = { x: 0, y: 0 };
  private menu?: {
    element: HTMLElement;
    lifetime: AbortController;
    documentId: string;
    revision: number;
    generation?: number;
    sequenceId: string;
    clipId: string;
    selected: string[];
  };
  constructor(
    private readonly container: HTMLElement,
    private readonly context: EditorTimelineContext,
  ) {
    this.media = new EditorTimelineMedia(context.media);
    container.classList.add("editor-timeline");
    container.tabIndex = 0;
    container.setAttribute("aria-label", "剪辑时间轴");
    container.addEventListener("click", this.click);
    container.addEventListener("change", this.change);
    container.addEventListener("keydown", this.keydown);
    container.addEventListener("pointerdown", this.pointerdown);
    container.addEventListener("pointermove", this.pointermove);
    container.addEventListener("pointerup", this.pointerup);
    container.addEventListener("pointercancel", this.cancel);
    container.addEventListener("lostpointercapture", this.lostCapture);
    container.addEventListener("dragover", this.dragover);
    container.addEventListener("drop", this.drop);
    container.addEventListener("contextmenu", this.contextmenu);
    this.render();
    this.resizeObserver = new ResizeObserver(() => this.scheduleMedia());
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
    await this.context.apply(operations, label);
    this.render();
  }
  private select(ids: Iterable<string>) {
    this.context.select([...ids]);
    this.render();
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
  render(): void {
    if (this.destroyed) return;
    this.media.cancel();
    const focused = globalThis.document.activeElement;
    const focusedClip =
      focused instanceof HTMLElement
        ? focused.closest<HTMLElement>("[data-et-clip]")?.dataset.etClip
        : undefined;
    const restoreFocus = focused instanceof HTMLElement && this.container.contains(focused);
    const { sequence, selected } = this.current();
    if (this.menu && !this.menuCurrent()) this.closeMenu();
    for (const id of selected)
      if (!sequence.clips.some((clip) => clip.id === id)) selected.delete(id);
    if (selected.size !== this.context.selection().clipIds.length)
      this.context.select([...selected]);
    const existing = this.container.querySelector<HTMLElement>(".et-scroll");
    if (existing) this.scrollPosition = existing.scrollLeft;
    this.verticalPosition =
      this.container.querySelector<HTMLElement>(".et-body")?.scrollTop ?? this.verticalPosition;
    const duration = Math.max(
        sequenceDuration(sequence),
        ...sequence.markers.map((marker) => marker.time + marker.duration),
      ),
      viewportWidth = Math.max(400, this.container.clientWidth - 160);
    this.scale = Math.min(this.scale, 12000000 / Math.max(1, ticksToSeconds(duration)));
    const width = Math.max(viewportWidth, ticksToSeconds(duration) * this.scale + 150);
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
    const button = (action: string, label: string, disabled = false) =>
      `<button type="button" data-et-action="${action}"${disabled ? " disabled" : ""}>${label}</button>`;
    this.container.innerHTML = `<div class="et-toolbar">${button("split", "切分", selected.size !== 1)}${button("copy", "复制", !selected.size)}${button("paste", "粘贴", !this.clipboard)}${button("duplicate", "原位复制", !selected.size)}${button("group", "分组", selected.size < 2)}${button("ungroup", "解组", !selected.size)}${button("delete", "删除", !selected.size)}<label><input type="checkbox" data-et-snap ${this.snapping ? "checked" : ""}>吸附</label><span class="et-spacer"></span>${button("fit", "适合窗口")}<label>缩放 <input data-et-zoom type="range" min="-2" max="3" step="0.05" value="${Math.log10(this.scale)}" aria-label="时间轴缩放"></label><output>${selected.size ? `已选 ${selected.size} 个片段` : "拖动空白处框选"}</output></div>
      <div class="et-body"><div class="et-track-heads"><div class="et-track-top">轨道</div>${sequence.tracks
        .slice()
        .reverse()
        .map(
          (track) =>
            `<div class="et-track-head" data-track-head="${esc(track.id)}"><input value="${esc(track.name)}" data-et-track-name="${esc(track.id)}" aria-label="轨道名称 ${esc(track.name)}"><div><button data-et-track="${esc(track.id)}" data-et-toggle="locked" aria-label="${track.locked ? "解锁" : "锁定"}${esc(track.name)}" aria-pressed="${track.locked}">${track.locked ? "🔒" : "锁"}</button><button data-et-track="${esc(track.id)}" data-et-toggle="hidden" aria-label="${track.hidden ? "显示" : "隐藏"}${esc(track.name)}" aria-pressed="${track.hidden}"${track.locked ? " disabled" : ""}>${track.hidden ? "显" : "隐"}</button><button data-et-track="${esc(track.id)}" data-et-toggle="muted" aria-label="${track.muted ? "取消静音" : "静音"}${esc(track.name)}" aria-pressed="${track.muted}"${track.locked ? " disabled" : ""}>${track.muted ? "声" : "静"}</button><button data-et-up="${esc(track.id)}" aria-label="上移${esc(track.name)}">↑</button><button data-et-down="${esc(track.id)}" aria-label="下移${esc(track.name)}">↓</button></div>${track.kind !== "text" ? `<div class="et-track-mix"><label>音量<input type="number" min="0" max="400" step="any" value="${track.volume * 100}" data-et-track-id="${esc(track.id)}" data-et-track-mix="volume" aria-label="${esc(track.name)} 音量百分比"${track.locked ? " disabled" : ""}></label><label>声像<input type="number" min="-100" max="100" step="any" value="${track.pan * 100}" data-et-track-id="${esc(track.id)}" data-et-track-mix="pan" aria-label="${esc(track.name)} 声像" title="左 -100 · 居中 0 · 右 100"${track.locked ? " disabled" : ""}></label></div>` : ""}</div>`,
        )
        .join(
          "",
        )}<div class="et-add">${button("track-video", "+ 画面")}${button("track-audio", "+ 声音")}${button("track-text", "+ 文字")}</div></div>
      <div class="et-scroll"><div class="et-content" style="width:${width}px"><div class="et-ruler" aria-label="时间刻度">${ticks.join("")}</div><div class="et-marker-lane" aria-label="标记范围">${sequence.markers
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
            `<div class="et-lane${track.locked ? " locked" : ""}" data-et-lane="${esc(track.id)}" aria-label="${esc(track.name)}">${sequence.clips
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
                  `<div role="option" aria-selected="${selected.has(clip.id)}" tabindex="0" class="et-clip et-${clip.kind}${selected.has(clip.id) ? " selected" : ""}" data-et-clip="${esc(clip.id)}" style="left:${ticksToSeconds(clip.start) * this.scale}px;width:${Math.max(3, ticksToSeconds(clip.duration) * this.scale)}px" title="${esc(clip.label)} · ${stamp(clip.start)} — ${stamp(clip.start + clip.duration)}"><span class="et-edge left" data-et-edge="left" aria-label="裁剪开头"></span><span class="et-clip-label">${esc(clip.label)}</span>${clip.groupId ? '<span class="et-group">▣</span>' : ""}<span class="et-edge right" data-et-edge="right" aria-label="裁剪结尾"></span></div>`,
              )
              .join("")}</div>`,
        )
        .join(
          "",
        )}<div class="et-playhead" style="left:${ticksToSeconds(this.context.time()) * this.scale}px"><i></i></div></div></div></div>`;
    const scroll = this.viewport();
    scroll.scrollLeft = this.scrollPosition;
    this.container.querySelector<HTMLElement>(".et-body")!.scrollTop = this.verticalPosition;
    scroll.addEventListener(
      "scroll",
      () => {
        if (scroll.scrollLeft === this.scrollPosition) return;
        this.scrollPosition = scroll.scrollLeft;
        if (!this.drag) this.render();
      },
      { passive: true },
    );
    this.container
      .querySelector<HTMLElement>(".et-body")!
      .addEventListener("scroll", this.scheduleMedia, { passive: true });
    this.scheduleMedia();
    if (this.drag?.kind === "box") this.createBox();
    if (restoreFocus) {
      const next = focusedClip
        ? this.container.querySelector<HTMLElement>(`[data-et-clip="${CSS.escape(focusedClip)}"]`)
        : undefined;
      (next ?? this.container).focus({ preventScroll: true });
    }
  }
  private scheduleMedia = (): void => {
    if (this.destroyed) return;
    this.media.cancel();
    if (this.mediaFrame !== undefined) cancelAnimationFrame(this.mediaFrame);
    this.mediaFrame = requestAnimationFrame(() => {
      this.mediaFrame = undefined;
      if (this.destroyed) return;
      const { document, sequence } = this.current();
      const viewport = this.viewport().getBoundingClientRect(),
        body = this.container.querySelector<HTMLElement>(".et-body")!.getBoundingClientRect();
      const strips: TimelineMediaStrip[] = [];
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
        Object.assign(canvas.style, {
          left: `${left - bounds.left}px`,
          width: `${right - left}px`,
          height: "32px",
        });
        node.appendChild(canvas);
        strips.push({
          clipId: clip.id,
          canvas,
          localStart,
          localEnd,
          width: right - left,
          height: 32,
        });
      }
      void this.media.render(document, sequence.id, strips);
    });
  };
  updatePlayhead(): void {
    const line = this.container.querySelector<HTMLElement>(".et-playhead");
    if (line) line.style.left = `${ticksToSeconds(this.context.time()) * this.scale}px`;
  }
  private click = (event: MouseEvent) => {
    const target = event.target instanceof HTMLElement ? event.target : undefined;
    if (!target) return;
    const action = target.closest<HTMLElement>("[data-et-action]")?.dataset.etAction;
    if (action) {
      this.run(() => this.action(action));
      return;
    }
    const toggle = target.closest<HTMLElement>("[data-et-toggle]");
    if (toggle)
      this.run(async () => {
        const { sequence } = this.current();
        const track = sequence.tracks.find((item) => item.id === toggle.dataset.etTrack)!;
        const key = toggle.dataset.etToggle as "locked" | "hidden" | "muted";
        await this.apply(
          [
            {
              type: "track.update",
              sequenceId: sequence.id,
              trackId: track.id,
              patch: { [key]: !track[key] },
            },
          ],
          "调整轨道",
        );
      });
    const direction = target.closest<HTMLElement>("[data-et-up],[data-et-down]");
    if (direction)
      this.run(async () => {
        const { sequence } = this.current();
        const ids = sequence.tracks.map((track) => track.id),
          id = direction.dataset.etUp ?? direction.dataset.etDown!,
          from = ids.indexOf(id),
          to = from + (direction.dataset.etUp ? 1 : -1);
        if (to < 0 || to >= ids.length) return;
        [ids[from], ids[to]] = [ids[to]!, ids[from]!];
        await this.apply(
          [{ type: "track.reorder", sequenceId: sequence.id, trackIds: ids }],
          "轨道排序",
        );
      });
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
    if (target.matches("[data-et-snap]")) this.snapping = target.checked;
    if (target.matches("[data-et-zoom]")) {
      this.scale = 10 ** Number(target.value);
      this.render();
    }
    if (target.dataset.etTrackMix)
      this.run(async () => {
        if (
          !target.value.trim() ||
          !Number.isFinite(target.valueAsNumber) ||
          !target.checkValidity()
        )
          throw new Error("轨道音量必须为 0–400%，声像必须在左 100 到右 100 之间");
        const key = target.dataset.etTrackMix as "volume" | "pan";
        await this.apply(
          [
            {
              type: "track.update",
              sequenceId: this.current().sequence.id,
              trackId: target.dataset.etTrackId!,
              patch: { [key]: target.valueAsNumber / 100 },
            },
          ],
          key === "volume" ? "调整轨道音量" : "调整轨道声像",
        );
      });
    if (target.dataset.etTrackName)
      this.run(() =>
        this.apply(
          [
            {
              type: "track.update",
              sequenceId: this.current().sequence.id,
              trackId: target.dataset.etTrackName!,
              patch: { name: target.value },
            },
          ],
          "重命名轨道",
        ),
      );
  };
  async action(action: string): Promise<void> {
    const { document, sequence, selected } = this.current(),
      ids = [...selected],
      time = this.context.time();
    if (action === "copy") {
      this.clipboard = copyClips(document, sequence.id, ids);
      this.render();
      return;
    }
    if (action === "cut") {
      const plan = planCutClips(document, sequence.id, ids);
      await this.apply(plan.operations, "剪切片段");
      this.clipboard = plan.payload;
      this.select([]);
      return;
    }
    if (action === "paste") {
      if (!this.clipboard) return;
      const operations = pasteClips(document, sequence.id, this.clipboard, {
        at: time,
        idFactory: uid,
      });
      await this.apply(operations, "粘贴片段");
      this.select(operations.flatMap((op) => (op.type === "clip.add" ? [op.clip.id] : [])));
      return;
    }
    if (action === "duplicate") {
      const operations = duplicateClipsInPlace(document, sequence.id, ids, { idFactory: uid });
      await this.apply(operations, "原位复制片段");
      this.select(operations.flatMap((op) => (op.type === "clip.add" ? [op.clip.id] : [])));
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
      if (ids.length !== 1) throw new Error("请选择一个片段切分");
      await this.apply(splitClip(document, sequence.id, ids[0]!, time, uid), "切分片段");
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
      this.scale = Math.min(
        1000,
        Math.max(
          0.01,
          (this.container.clientWidth - 220) /
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
    if (editableTarget(event.target)) return;
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
      this.run(() => this.action(action));
      return;
    }
    if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const { document, sequence, selected } = this.current();
      const delta =
        frameToTicks(event.shiftKey ? 10 : 1, sequence.frameRate) *
        (event.key === "ArrowLeft" ? -1 : 1);
      this.run(() =>
        modified && selected.size
          ? this.apply(
              sequence.timelineMode === "magnetic"
                ? planMagneticMove(document, sequence.id, [...selected], {
                    delta,
                    direction: event.key === "ArrowLeft" ? "previous" : "next",
                  })
                : [{ type: "clip.move", sequenceId: sequence.id, clipIds: [...selected], delta }],
              sequence.timelineMode === "magnetic" ? "磁吸移动片段" : "逐帧移动片段",
            )
          : this.context.seek(Math.max(0, this.context.time() + delta)),
      );
    }
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
    const locked = sequence.clips.some(
      (clip) =>
        selected.has(clip.id) && sequence.tracks.find((track) => track.id === clip.trackId)?.locked,
    );
    const element = globalThis.document.createElement("div");
    element.id = "timeline-context-menu";
    element.className = "timeline-context-menu";
    element.setAttribute("role", "menu");
    element.setAttribute("aria-label", "时间轴片段操作");
    element.setAttribute("aria-describedby", "timeline-context-menu-note");
    element.innerHTML = `<div class="timeline-context-menu-title">${esc(clip.label)}</div><button type="button" role="menuitem" class="danger" data-timeline-menu-action="remove"${locked ? " disabled" : ""}>从时间轴删除${selected.size > 1 ? ` ${selected.size} 个片段` : ""}</button><button type="button" role="menuitem" data-timeline-menu-action="cancel">取消</button><p id="timeline-context-menu-note">素材库与原文件保留，可撤销</p>`;
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
    };
    element.addEventListener("click", (event) => {
      if (this.menu?.element !== element) return;
      const button = (event.target as Element).closest<HTMLButtonElement>(
        "[data-timeline-menu-action]",
      );
      if (!button || button.disabled) return;
      if (button.dataset.timelineMenuAction === "cancel") return this.closeMenu(true);
      const current = this.menuCurrent();
      this.closeMenu();
      if (!current) return this.context.onError(new Error("工程或选择已变化，请重新打开片段菜单"));
      this.run(() => this.action("delete"));
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
        buttons[next]?.focus({ preventScroll: true });
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
        at: this.snap(this.point(event.clientX), sequence, new Set()),
        trackId: lane.dataset.etLane!,
      });
      this.render();
    });
  };
  private snap(time: Tick, sequence: EditorSequence, omitted: ReadonlySet<string>): Tick {
    let target = frameToTicks(
      ticksToFrame(Math.max(0, time), sequence.frameRate),
      sequence.frameRate,
    );
    if (this.snapping) {
      let distance = (6 / this.scale) * 240000;
      const candidates = [
        0,
        this.context.time(),
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
    if (!this.snapping) return delta;
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
    if (event.button !== 0 || editableTarget(event.target)) return;
    const target = event.target instanceof HTMLElement ? event.target : undefined;
    if (!target || target.closest("button,.et-toolbar,.et-track-heads")) return;
    const { document, sequence, selected } = this.current();
    const node = target.closest<HTMLElement>("[data-et-clip]"),
      clip = sequence.clips.find((item) => item.id === node?.dataset.etClip);
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    let ids = new Set(selected);
    if (clip) {
      const group = this.expanded(sequence, [clip.id]);
      if (additive && selected.has(clip.id)) for (const id of group) ids.delete(id);
      else {
        if (!additive && !selected.has(clip.id)) ids.clear();
        for (const id of group) ids.add(id);
      }
      this.context.select([...ids]);
      if (!ids.has(clip.id)) {
        this.render();
        event.preventDefault();
        return;
      }
    }
    const kind = clip
      ? ((target.closest<HTMLElement>("[data-et-edge]")?.dataset.etEdge as
          | "left"
          | "right"
          | undefined) ?? "move")
      : target.closest(".et-ruler,.et-marker-lane,.et-playhead")
        ? "seek"
        : "box";
    this.drag = {
      kind,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scroll: this.viewport().scrollLeft,
      verticalScroll: this.container.querySelector<HTMLElement>(".et-body")!.scrollTop,
      lastX: event.clientX,
      lastY: event.clientY,
      documentId: document.id,
      revision: document.revision,
      sequenceId: sequence.id,
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
      time: this.point(event.clientX),
      moved: false,
      additive,
    };
    this.container.focus({ preventScroll: true });
    this.container.setPointerCapture(event.pointerId);
    event.preventDefault();
    if (kind === "box") this.createBox();
    if (clip)
      for (const element of this.container.querySelectorAll<HTMLElement>("[data-et-clip]")) {
        element.classList.toggle("selected", ids.has(element.dataset.etClip!));
        element.setAttribute("aria-selected", String(ids.has(element.dataset.etClip!)));
      }
  };
  private pointermove = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
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
  private updateDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    const viewport = this.viewport(),
      body = this.container.querySelector<HTMLElement>(".et-body")!;
    const dx = drag.lastX - drag.x + viewport.scrollLeft - drag.scroll,
      dy = drag.lastY - drag.y + body.scrollTop - drag.verticalScroll;
    drag.moved ||= Math.abs(dx) + Math.abs(dy) > 3;
    const { document, sequence } = this.current();
    if (
      document.id !== drag.documentId ||
      document.revision !== drag.revision ||
      sequence.id !== drag.sequenceId
    ) {
      this.cancel();
      throw new Error("工程已变化，请重新拖动片段");
    }
    if (drag.kind === "seek") {
      drag.time = this.snap(this.point(drag.lastX), sequence, new Set());
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
      const ids = new Set(drag.additive ? drag.ids : []);
      for (const clip of sequence.clips) {
        const lane = this.container
          .querySelector<HTMLElement>(`[data-et-lane="${CSS.escape(clip.trackId)}"]`)!
          .getBoundingClientRect();
        const x = visible.left + ticksToSeconds(clip.start) * this.scale - viewport.scrollLeft;
        if (
          x + Math.max(3, ticksToSeconds(clip.duration) * this.scale) >= left &&
          x <= right &&
          lane.top + 56 >= top &&
          lane.top + 7 <= bottom
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
        ? this.moveDelta(desired, sequence, drag.ids, clip)
        : this.snap(edge + desired, sequence, new Set(drag.ids)) - edge;
    const hit = globalThis.document
      .elementFromPoint(drag.lastX, drag.lastY)
      ?.closest<HTMLElement>("[data-et-lane]");
    drag.targetTrack = hit?.dataset.etLane ?? clip.trackId;
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
    for (const lane of this.container.querySelectorAll<HTMLElement>("[data-et-lane]"))
      lane.classList.toggle(
        "drop-target",
        drag.kind === "move" && lane.dataset.etLane === drag.targetTrack,
      );
    for (const element of this.container.querySelectorAll<HTMLElement>("[data-et-clip]")) {
      const source = sequence.clips.find((item) => item.id === element.dataset.etClip)!;
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
  private pointerup = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.cancel();
    this.run(async () => {
      const { document, sequence } = this.current();
      if (
        document.id !== drag.documentId ||
        document.revision !== drag.revision ||
        sequence.id !== drag.sequenceId
      )
        throw new Error("工程已变化，请重新拖动片段");
      if (drag.kind === "seek")
        await this.context.seek(this.snap(this.point(event.clientX), sequence, new Set()));
      else if (drag.kind === "box") {
        if (!drag.moved && !drag.additive) this.context.select([]);
      } else if (drag.moved) {
        const clip = drag.clip!;
        if (drag.kind === "move")
          await this.apply(
            sequence.timelineMode === "magnetic"
              ? planMagneticMove(document, sequence.id, drag.ids, {
                  delta: drag.delta,
                  trackId: drag.targetTrack,
                  anchorClipId: clip.id,
                })
              : [
                  {
                    type: "clip.move",
                    sequenceId: sequence.id,
                    clipIds: drag.ids,
                    delta: drag.delta,
                    trackId: drag.targetTrack,
                  },
                ],
            "移动片段",
          );
        else
          await this.apply(
            isMagneticTrack(sequence, clip.trackId)
              ? planClipTiming(
                  document,
                  sequence.id,
                  [clip.id],
                  {
                    kind: drag.kind === "left" ? "keep-right" : "keep-left",
                    time:
                      clip.start + (drag.kind === "left" ? drag.delta : clip.duration + drag.delta),
                  },
                  { ripple: true },
                )
              : trimClip(
                  document,
                  sequence.id,
                  clip.id,
                  drag.kind === "left" ? drag.delta : 0,
                  drag.kind === "right" ? clip.duration + drag.delta : clip.duration,
                ),
            "裁剪片段",
          );
      }
      this.render();
    });
  };
  private cancel = () => {
    if (this.autoScrollFrame !== undefined) cancelAnimationFrame(this.autoScrollFrame);
    this.autoScrollFrame = undefined;
    const drag = this.drag;
    this.drag = undefined;
    if (drag && this.container.hasPointerCapture(drag.pointerId))
      this.container.releasePointerCapture(drag.pointerId);
    this.box?.remove();
    this.box = undefined;
    const clips = this.current().sequence.clips;
    for (const clip of this.container.querySelectorAll<HTMLElement>("[data-et-clip]")) {
      clip.style.transform = "";
      clip.style.pointerEvents = "";
      const source = clips.find((item) => item.id === clip.dataset.etClip);
      if (source)
        clip.style.width = `${Math.max(3, ticksToSeconds(source.duration) * this.scale)}px`;
    }
    for (const lane of this.container.querySelectorAll<HTMLElement>("[data-et-lane]"))
      lane.classList.remove("drop-target");
  };
  private lostCapture = (event: PointerEvent) => {
    if (this.drag?.pointerId === event.pointerId) this.cancel();
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
    this.container.removeEventListener("keydown", this.keydown);
    this.container.removeEventListener("pointerdown", this.pointerdown);
    this.container.removeEventListener("pointermove", this.pointermove);
    this.container.removeEventListener("pointerup", this.pointerup);
    this.container.removeEventListener("pointercancel", this.cancel);
    this.container.removeEventListener("lostpointercapture", this.lostCapture);
    this.container.removeEventListener("dragover", this.dragover);
    this.container.removeEventListener("drop", this.drop);
    this.container.removeEventListener("contextmenu", this.contextmenu);
    this.container.innerHTML = "";
  }
}
