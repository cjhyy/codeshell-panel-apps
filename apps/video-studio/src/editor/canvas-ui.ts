import {
  canvasTargets,
  canvasTargetCorners,
  canvasTargetHit,
  maskPointOnCanvas,
  planCanvasGesture,
  type CanvasEditMode,
  type CanvasTarget,
} from "./canvas-edits";
import { applyEditorOperations, type EditorOperation } from "./operations";
import type { EditorDocument } from "./types";
import type { SessionIdentity } from "./session";
import type { Tick } from "./time";
import { visualPointToCanvas, type VisualPoint } from "./visual-layout";
import { icon } from "../icons";
import { prepareEvaluator, type PreparedEvaluator } from "./evaluate";

export interface EditorCanvasContext {
  read(): EditorDocument;
  identity(): SessionIdentity;
  selection(): { sequenceId: string; clipIds: string[] };
  time(): Tick;
  select(ids: string[]): void;
  assertEditable?(): void;
  pause(): void;
  /** Finish a managed focused field; true means dispatch completed, not persistence. */
  beforeGesture?(signal: AbortSignal): boolean | Promise<boolean>;
  apply(operations: EditorOperation[], label: string): void;
  draft(document?: EditorDocument): Promise<void>;
  onError(error: unknown): void;
}
interface Gesture {
  target: CanvasTarget;
  identity: string;
  handle: string;
  mode: CanvasEditMode;
  pointer: number;
  start: VisualPoint;
  offset: VisualPoint;
  operations: EditorOperation[];
  changed: boolean;
}
type CanvasPointer = Pick<PointerEvent, "pointerId" | "clientX" | "clientY" | "altKey" | "shiftKey">;
interface PendingGesture {
  controller: AbortController;
  identity: SessionIdentity;
  selection: string;
  time: Tick;
  mode: CanvasEditMode;
  target?: CanvasTarget;
  selectOnly: boolean;
  handle: string;
  start: CanvasPointer;
  last: CanvasPointer;
  up?: CanvasPointer;
  viewport: string;
}
const pointer = (event: CanvasPointer): CanvasPointer => ({ pointerId: event.pointerId, clientX: event.clientX,
  clientY: event.clientY, altKey: event.altKey, shiftKey: event.shiftKey });
const ns = "http://www.w3.org/2000/svg";
function svg<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number> = {},
) {
  const node = document.createElementNS(ns, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}
const labels: Record<CanvasEditMode, string> = { transform: "画面", crop: "裁切", mask: "蒙版" };
const tooltips: Record<CanvasEditMode, string> = {
  transform: "移动与缩放画面",
  crop: "裁切画面",
  mask: "调整蒙版",
};
const pointText = (points: VisualPoint[]) =>
  points.map((point) => `${point.x},${point.y}`).join(" ");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Geometry lives over the actual letterboxed canvas, not its CSS element box. Pointer
 * candidates reuse preview decoders and reach Session only once, on successful pointerup. */
export class EditorCanvas {
  private readonly overlay = svg("svg", {
    class: "editor-canvas-controls",
    tabindex: 0,
    role: "group",
    "aria-label": "画布调整",
  });
  private readonly controls = document.createElement("div");
  private readonly observer: ResizeObserver;
  private readonly canvasStyle: Pick<
    CSSStyleDeclaration,
    "position" | "left" | "top" | "width" | "height" | "objectFit"
  >;
  private mode: CanvasEditMode = "transform";
  private gesture?: Gesture;
  private pendingGesture?: PendingGesture;
  private pendingDraft?: EditorDocument;
  private draftRunning = false;
  private draftSerial = 0;
  private frame?: number;
  private disposed = false;
  private targets: CanvasTarget[] = [];
  private target?: CanvasTarget;
  private view?: { width: number; height: number };
  private prepared?: { identity: string; evaluator: PreparedEvaluator };
  private box = { left: 0, top: 0, width: 1, height: 1, ratio: 1 };
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly context: EditorCanvasContext,
  ) {
    this.canvasStyle = {
      position: canvas.style.position,
      left: canvas.style.left,
      top: canvas.style.top,
      width: canvas.style.width,
      height: canvas.style.height,
      objectFit: canvas.style.objectFit,
    };
    this.controls.className = "editor-canvas-toolbar";
    this.controls.setAttribute("aria-label", "画布工具");
    for (const mode of ["transform", "crop", "mask"] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = icon(mode, 16);
      button.dataset.canvasMode = mode;
      button.setAttribute("aria-label", `画布${labels[mode]}工具`);
      button.title = tooltips[mode];
      button.addEventListener("click", () => {
        this.cancel();
        this.mode = mode;
        this.render();
      });
      this.controls.append(button);
    }
    canvas.parentElement!.append(this.overlay, this.controls);
    this.overlay.addEventListener("pointerdown", this.down);
    this.overlay.addEventListener("pointermove", this.move);
    this.overlay.addEventListener("pointerup", this.up);
    this.overlay.addEventListener("pointercancel", this.cancelPointer);
    this.overlay.addEventListener("lostpointercapture", this.cancelPointer);
    this.overlay.addEventListener("keydown", this.keydown);
    this.overlay.addEventListener("keyup", this.keyup);
    this.observer = new ResizeObserver(() => {
      this.cancel();
      this.layout();
    });
    this.observer.observe(canvas.parentElement!);
    window.addEventListener("blur", this.cancelEvent);
    this.render();
  }
  private identity(): string {
    return JSON.stringify(this.context.identity());
  }
  private current(gesture: Gesture): boolean {
    const selection = this.context.selection();
    return (
      gesture.identity === this.identity() &&
      selection.sequenceId === gesture.target.sequenceId &&
      selection.clipIds.length === 1 &&
      selection.clipIds[0] === gesture.target.clip.id &&
      this.context.time() === gesture.target.time
    );
  }
  private layout(): void {
    const container = this.canvas.parentElement!,
      parent = container.getBoundingClientRect(),
      style = getComputedStyle(container);
    const width = this.view?.width ?? this.canvas.width,
      height = this.view?.height ?? this.canvas.height;
    const paddingLeft = parseFloat(style.paddingLeft),
      paddingTop = parseFloat(style.paddingTop),
      availableWidth = container.clientWidth - paddingLeft - parseFloat(style.paddingRight),
      availableHeight = container.clientHeight - paddingTop - parseFloat(style.paddingBottom),
      ratio = Math.min(availableWidth / width, availableHeight / height),
      displayWidth = width * ratio,
      displayHeight = height * ratio;
    if (!(ratio > 0)) return;
    const left = paddingLeft + (availableWidth - displayWidth) / 2,
      top = paddingTop + (availableHeight - displayHeight) / 2;
    this.box = {
      left: parent.left + container.clientLeft + left,
      top: parent.top + container.clientTop + top,
      width: displayWidth,
      height: displayHeight,
      ratio,
    };
    // CSS containment follows the project aspect, not the rounded low-resolution bitmap.
    // This keeps odd-sized previews and their handles in the same place at every quality.
    Object.assign(this.canvas.style, {
      position: "absolute",
      left: `${left}px`,
      top: `${top}px`,
      width: `${displayWidth}px`,
      height: `${displayHeight}px`,
      objectFit: "fill",
    });
    Object.assign(this.overlay.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${this.box.width}px`,
      height: `${this.box.height}px`,
    });
    this.overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
    this.drawControls();
  }
  private drawControls(): void {
    this.overlay.replaceChildren();
    const target = this.target;
    if (!target) return;
    this.overlay.dataset.clipId = target.clip.id;
    const r = 5 / this.box.ratio;
    const corners =
      this.mode === "mask" && target.layer.mask
        ? [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ].map((point) => maskPointOnCanvas(target, point))
        : canvasTargetCorners(target, this.mode !== "crop");
    if (
      corners.some(
        ({ x, y }) => x < 0 || y < 0 || x > target.canvas.width || y > target.canvas.height,
      )
    ) {
      const inset = 1 / this.box.ratio;
      this.overlay.append(
        svg("rect", {
          x: inset,
          y: inset,
          width: target.canvas.width - inset * 2,
          height: target.canvas.height - inset * 2,
          class: "ec-viewport-outline",
        }),
      );
    }
    const outline = svg("polygon", {
      points: pointText(corners),
      class: "ec-outline",
      "data-canvas-handle": "move",
    });
    this.overlay.append(outline);
    if (target.locked) return;
    const handle = (name: string, point: VisualPoint, label: string) => {
      const node = svg("circle", {
        cx: point.x,
        cy: point.y,
        r,
        class: "ec-handle",
        "data-canvas-handle": name,
        "aria-label": label,
      });
      const title = svg("title");
      title.textContent = label;
      node.append(title);
      this.overlay.append(node);
    };
    if (this.mode === "crop") {
      for (const [name, a, b] of [
        ["top", 0, 1],
        ["right", 1, 2],
        ["bottom", 2, 3],
        ["left", 3, 0],
      ] as const)
        handle(
          name,
          { x: (corners[a]!.x + corners[b]!.x) / 2, y: (corners[a]!.y + corners[b]!.y) / 2 },
          `裁切${{ top: "上边", right: "右边", bottom: "下边", left: "左边" }[name]}`,
        );
      outline.removeAttribute("data-canvas-handle");
      return;
    }
    if (this.mode === "mask" && !target.layer.mask) {
      outline.removeAttribute("data-canvas-handle");
      return;
    }
    for (const [index, name] of ["nw", "ne", "se", "sw"].entries())
      handle(name, corners[index]!, `缩放${["左上", "右上", "右下", "左下"][index]}`);
    const center =
      this.mode === "transform"
        ? visualPointToCanvas({ x: 0, y: 0 }, target.canvas, target.layer.transform)
        : { x: (corners[0]!.x + corners[2]!.x) / 2, y: (corners[0]!.y + corners[2]!.y) / 2 };
    const top = { x: (corners[0]!.x + corners[1]!.x) / 2, y: (corners[0]!.y + corners[1]!.y) / 2 };
    const distance = Math.hypot(top.x - center.x, top.y - center.y);
    if (distance > 1e-8) {
      const rotate = {
        x: top.x + (((top.x - center.x) / distance) * 24) / this.box.ratio,
        y: top.y + (((top.y - center.y) / distance) * 24) / this.box.ratio,
      };
      this.overlay.append(
        svg("line", { x1: top.x, y1: top.y, x2: rotate.x, y2: rotate.y, class: "ec-outline" }),
      );
      handle("rotate", rotate, `旋转${labels[this.mode]}`);
    }
    if (this.mode === "mask" && target.layer.mask?.kind === "path")
      target.layer.mask.points!.forEach((point, index) =>
        handle(`point-${index}`, maskPointOnCanvas(target, point), `蒙版顶点 ${index + 1}`),
      );
  }
  render(): void {
    if (this.disposed) return;
    if (this.pendingGesture && !this.pendingCurrent(this.pendingGesture)) this.cancelPending();
    if (this.gesture) {
      if (this.current(this.gesture)) return;
      this.cancel();
    }
    const selection = this.context.selection(),
      document = this.context.read(),
      sequence = document.sequences.find((item) => item.id === selection.sequenceId);
    this.view = sequence ? { width: sequence.width, height: sequence.height } : undefined;
    const identity = JSON.stringify([
      this.context.identity(),
      document.id,
      document.revision,
      selection.sequenceId,
    ]);
    if (this.prepared?.identity !== identity)
      this.prepared = { identity, evaluator: prepareEvaluator(document) };
    const time = this.context.time();
    this.targets = sequence
      ? canvasTargets(
          document,
          selection.sequenceId,
          time,
          this.prepared.evaluator.evaluate(selection.sequenceId, time),
        )
      : [];
    this.target =
      selection.clipIds.length === 1
        ? this.targets.find((item) => item.clip.id === selection.clipIds[0])
        : undefined;
    for (const button of this.controls.querySelectorAll<HTMLButtonElement>("button"))
      button.setAttribute("aria-pressed", String(button.dataset.canvasMode === this.mode));
    const hint = this.target?.locked
      ? "轨道已锁定"
      : !this.target
        ? "在画面或时间线上选择一个片段"
        : this.mode === "crop"
          ? "拖动边缘裁切"
          : this.mode === "mask"
            ? this.target.layer.mask
              ? "拖动蒙版或顶点调整"
              : "在右侧蒙版属性中选择形状"
            : "拖动移动 · Alt 自由缩放 · Shift 旋转吸附";
    this.overlay.setAttribute("aria-description", hint);
    this.layout();
  }
  private point(event: CanvasPointer): VisualPoint {
    return {
      x: (event.clientX - this.box.left) / this.box.ratio,
      y: (event.clientY - this.box.top) / this.box.ratio,
    };
  }
  /** Document refreshes may carry this field's one dispatch while its pointer waits. */
  refreshDocument(): void {
    if (this.pendingGesture && this.pendingCurrent(this.pendingGesture)) return;
    this.cancel();
  }
  private pendingCurrent(pending: PendingGesture): boolean {
    const identity = this.context.identity();
    return !this.disposed && !pending.controller.signal.aborted && pending.mode === this.mode &&
      pending.time === this.context.time() && pending.selection === JSON.stringify(this.context.selection()) &&
      identity.documentId === pending.identity.documentId && identity.generation === pending.identity.generation &&
      identity.revision >= pending.identity.revision && identity.revision <= pending.identity.revision + 1;
  }
  private viewportSignature(): string {
    const bounds = this.overlay.getBoundingClientRect();
    return JSON.stringify([window.innerWidth, window.innerHeight, bounds.left, bounds.top, bounds.width, bounds.height]);
  }
  private down = (event: PointerEvent) => {
    if (event.button !== 0 || this.gesture || this.pendingGesture || this.disposed) return;
    try {
      this.context.assertEditable?.();
      this.context.pause();
      const start = this.point(event), handle = (event.target as Element)
        .closest("[data-canvas-handle]")?.getAttribute("data-canvas-handle"),
        chosen = handle ? this.target : [...this.targets].reverse().find((target) => canvasTargetHit(target, start));
      const pending: PendingGesture = { controller: new AbortController(), identity: { ...this.context.identity() },
        selection: JSON.stringify(this.context.selection()), time: this.context.time(), mode: this.mode,
        target: chosen, selectOnly: !chosen || (!handle && this.mode !== "transform"),
        handle: handle ?? "move", start: pointer(event), last: pointer(event), viewport: this.viewportSignature() };
      event.preventDefault();
      event.stopPropagation();
      this.pendingGesture = pending;
      const ready = this.context.beforeGesture?.(pending.controller.signal) ?? true;
      if (this.pendingGesture !== pending || !this.pendingCurrent(pending)) {
        if (this.pendingGesture === pending) this.cancelPending();
        else pending.controller.abort();
        if (ready instanceof Promise) void ready.catch(() => {});
        return;
      }
      if (typeof ready === "boolean") {
        this.pendingGesture = undefined;
        if (ready) {
          if (pending.selectOnly) this.finishSelection(pending);
          else this.beginGesture(pending, true);
        } else pending.controller.abort();
        return;
      }
      this.overlay.setPointerCapture(event.pointerId);
      this.overlay.focus();
      void this.finishPending(pending, ready);
    } catch (error) {
      this.cancelPending();
      this.context.onError(error);
    }
  };
  private async finishPending(pending: PendingGesture, ready: Promise<boolean>): Promise<void> {
    try {
      if (!await ready || this.pendingGesture !== pending || !this.pendingCurrent(pending) ||
        this.viewportSignature() !== pending.viewport) return;
      this.pendingGesture = undefined;
      if (pending.selectOnly) { this.finishSelection(pending); return; }
      this.beginGesture(pending, !pending.up);
      if (pending.up) this.up(pending.up);
      else this.move(pending.last);
    } catch (error) {
      if (!pending.controller.signal.aborted && this.pendingCurrent(pending)) this.context.onError(error);
    } finally {
      if (this.pendingGesture === pending) this.cancelPending();
      if (!this.pendingGesture && !this.gesture && !pending.controller.signal.aborted &&
        this.overlay.hasPointerCapture(pending.start.pointerId)) this.overlay.releasePointerCapture(pending.start.pointerId);
    }
  }
  private finishSelection(pending: PendingGesture): void {
    if (!this.pendingCurrent(pending)) return;
    this.context.assertEditable?.();
    const identity = this.identity();
    this.render();
    if (identity !== this.identity() || !this.pendingCurrent(pending) || this.viewportSignature() !== pending.viewport) return;
    // Resolve the saved target id; a completed field must never change what the click meant.
    const original = pending.target, target = original && this.targets.find((item) => item.clip.id === original.clip.id);
    if (original && (!target || target.clip.kind !== original.clip.kind || target.clip.trackId !== original.clip.trackId)) return;
    this.context.select(target ? [target.clip.id] : []);
    if (!this.disposed) { this.render(); this.overlay.focus(); }
  }
  private handlePoint(target: CanvasTarget, mode: CanvasEditMode, handle: string): VisualPoint {
    const corners = mode === "mask" && target.layer.mask
      ? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].map((point) => maskPointOnCanvas(target, point))
      : canvasTargetCorners(target, mode !== "crop"),
      center = mode === "mask" ? { x: (corners[0]!.x + corners[2]!.x) / 2, y: (corners[0]!.y + corners[2]!.y) / 2 }
        : visualPointToCanvas({ x: 0, y: 0 }, target.canvas, target.layer.transform);
    const corner = ["nw", "ne", "se", "sw"].indexOf(handle);
    if (corner >= 0) return corners[corner]!;
    const edge = ["top", "right", "bottom", "left"].indexOf(handle);
    if (edge >= 0) return { x: (corners[edge]!.x + corners[(edge + 1) % 4]!.x) / 2,
      y: (corners[edge]!.y + corners[(edge + 1) % 4]!.y) / 2 };
    if (handle.startsWith("point-") && target.layer.mask?.points) {
      const point = target.layer.mask.points[Number(handle.slice(6))];
      if (point) return maskPointOnCanvas(target, point);
    }
    if (handle === "rotate") {
      const top = { x: (corners[0]!.x + corners[1]!.x) / 2, y: (corners[0]!.y + corners[1]!.y) / 2 },
        distance = Math.hypot(top.x - center.x, top.y - center.y);
      if (distance > 1e-8) return { x: top.x + ((top.x - center.x) / distance) * 24 / this.box.ratio,
        y: top.y + ((top.y - center.y) / distance) * 24 / this.box.ratio };
    }
    return center;
  }
  private beginGesture(pending: PendingGesture, capture: boolean): void {
    const original = pending.target;
    if (!original || pending.selectOnly || !this.pendingCurrent(pending)) return;
    this.context.assertEditable?.();
    const identity = this.identity();
    this.render();
    if (identity !== this.identity() || !this.pendingCurrent(pending) || this.viewportSignature() !== pending.viewport) return;
    const target = this.targets.find((item) => item.clip.id === original.clip.id);
    if (!target || target.clip.kind !== original.clip.kind || target.clip.trackId !== original.clip.trackId)
      throw new Error("片段已变化，请重新调整画布");
    if (target.locked) throw new Error("轨道已锁定，不能调整画面");
    if (pending.mode === "mask" && !target.layer.mask) return;
    const oldAnchor = this.handlePoint(original, pending.mode, pending.handle),
      newAnchor = this.handlePoint(target, pending.mode, pending.handle),
      offset = { x: newAnchor.x - oldAnchor.x, y: newAnchor.y - oldAnchor.y }, start = this.point(pending.start);
    // Keep the original handle and pointer delta when the saved field moves its geometry.
    this.context.select([target.clip.id]);
    const selection = this.context.selection();
    if (this.disposed || pending.controller.signal.aborted || identity !== this.identity() ||
      this.context.time() !== pending.time || pending.mode !== this.mode ||
      selection.sequenceId !== target.sequenceId || selection.clipIds.length !== 1 || selection.clipIds[0] !== target.clip.id) return;
    this.target = target;
    this.gesture = { target, identity: this.identity(), handle: pending.handle, mode: pending.mode,
      pointer: pending.start.pointerId, start: { x: start.x + offset.x, y: start.y + offset.y }, offset,
      operations: [], changed: false };
    this.overlay.focus();
    if (capture) this.overlay.setPointerCapture(pending.start.pointerId);
  }
  private cancelPending(): void {
    const pending = this.pendingGesture;
    if (!pending) return;
    this.pendingGesture = undefined;
    pending.controller.abort();
    if (this.overlay.hasPointerCapture(pending.start.pointerId)) this.overlay.releasePointerCapture(pending.start.pointerId);
  }
  private move = (event: CanvasPointer & { buttons?: number }) => {
    const pending = this.pendingGesture;
    if (pending?.start.pointerId === event.pointerId) {
      if (!pending.up) {
        if (event.buttons === 0) this.cancelPending();
        else pending.last = pointer(event);
      }
      return;
    }
    const gesture = this.gesture;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    if (!this.current(gesture)) {
      this.cancel();
      return;
    }
    const point = this.point(event), end = { x: point.x + gesture.offset.x, y: point.y + gesture.offset.y };
    if (
      !gesture.changed &&
      Math.hypot(end.x - gesture.start.x, end.y - gesture.start.y) * this.box.ratio < 2
    )
      return;
    try {
      const operations = planCanvasGesture(
        gesture.target,
        gesture.mode,
        gesture.handle,
        gesture.start,
        end,
        { uniform: !event.altKey, snap: event.shiftKey },
      );
      const draft = applyEditorOperations(
        gesture.target.document,
        operations,
        gesture.target.document.revision,
      );
      gesture.operations = operations;
      gesture.changed = !same(draft.sequences, gesture.target.document.sequences);
      this.target = canvasTargets(draft, gesture.target.sequenceId, gesture.target.time).find(
        (item) => item.clip.id === gesture.target.clip.id,
      );
      this.drawControls();
      this.pendingDraft = draft;
      if (this.frame === undefined)
        this.frame = requestAnimationFrame(() => {
          this.frame = undefined;
          void this.drawDraft();
        });
    } catch (error) {
      this.cancel();
      this.context.onError(error);
    }
  };
  private async drawDraft(): Promise<void> {
    if (this.draftRunning || !this.gesture || !this.pendingDraft) return;
    this.draftRunning = true;
    const serial = this.draftSerial;
    try {
      while (this.pendingDraft && this.gesture && serial === this.draftSerial) {
        const draft = this.pendingDraft;
        this.pendingDraft = undefined;
        await this.context.draft(draft);
      }
    } catch (error) {
      if (serial === this.draftSerial) {
        this.cancel();
        this.context.onError(error);
      }
    } finally {
      this.draftRunning = false;
      if (this.pendingDraft && this.gesture) void this.drawDraft();
    }
  }
  private clear(): Gesture | undefined {
    const gesture = this.gesture;
    this.gesture = undefined;
    this.pendingDraft = undefined;
    this.draftSerial++;
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    if (gesture && this.overlay.hasPointerCapture(gesture.pointer))
      this.overlay.releasePointerCapture(gesture.pointer);
    return gesture;
  }
  private up = (event: CanvasPointer) => {
    if (this.pendingGesture?.start.pointerId === event.pointerId) {
      this.pendingGesture.up ??= pointer(event);
      return;
    }
    if (this.gesture?.pointer !== event.pointerId) return;
    this.move(event);
    if (!this.gesture) return;
    const current = this.current(this.gesture),
      gesture = this.clear()!;
    try {
      if (!current) throw new Error("调整期间工程已变化，请重新拖动");
      if (gesture.changed) {
        this.context.assertEditable?.();
        this.context.apply(gesture.operations, `画布调整${labels[gesture.mode]}`);
      } else void this.context.draft().catch((error) => this.context.onError(error));
    } catch (error) {
      void this.context.draft().catch(() => {});
      this.context.onError(error);
    }
    this.render();
  };
  cancel(): void {
    this.cancelPending();
    if (!this.gesture) return;
    this.clear();
    void this.context.draft().catch((error) => {
      if (!this.disposed) this.context.onError(error);
    });
    this.render();
  }
  private cancelEvent = () => this.cancel();
  private cancelPointer = (event: PointerEvent) => {
    if (this.pendingGesture?.start.pointerId === event.pointerId) {
      if (event.type === "lostpointercapture" && this.pendingGesture.up) return;
      this.cancelPending();
    }
    if (this.gesture?.pointer === event.pointerId) this.cancel();
  };
  private keydown = (event: KeyboardEvent) => {
    if (this.pendingGesture) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Escape") this.cancelPending();
      else this.pendingModifiers(event);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
      return;
    }
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) ||
      !this.target ||
      this.gesture
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    try {
      this.context.assertEditable?.();
      this.context.pause();
      const step = event.shiftKey ? 10 : 1;
      const end = {
        x: event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
        y: event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0,
      };
      this.context.apply(
        planCanvasGesture(this.target, "transform", "move", { x: 0, y: 0 }, end),
        "微调画面位置",
      );
      this.render();
    } catch (error) {
      this.context.onError(error);
    }
  };
  private pendingModifiers(event: KeyboardEvent): void {
    const pending = this.pendingGesture;
    if (pending && !pending.up && (event.key === "Alt" || event.key === "Shift"))
      pending.last = { ...pending.last, altKey: event.altKey, shiftKey: event.shiftKey };
  }
  private keyup = (event: KeyboardEvent) => this.pendingModifiers(event);
  dispose(): void {
    this.disposed = true;
    this.cancelPending();
    this.prepared = undefined;
    this.clear();
    this.observer.disconnect();
    window.removeEventListener("blur", this.cancelEvent);
    this.overlay.remove();
    this.controls.remove();
    Object.assign(this.canvas.style, this.canvasStyle);
  }
}
