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

export interface EditorCanvasContext {
  read(): EditorDocument;
  identity(): SessionIdentity;
  selection(): { sequenceId: string; clipIds: string[] };
  time(): Tick;
  select(ids: string[]): void;
  assertEditable?(): void;
  pause(): void;
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
  operations: EditorOperation[];
  changed: boolean;
}
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
  private mode: CanvasEditMode = "transform";
  private gesture?: Gesture;
  private pendingDraft?: EditorDocument;
  private draftRunning = false;
  private draftSerial = 0;
  private frame?: number;
  private disposed = false;
  private targets: CanvasTarget[] = [];
  private target?: CanvasTarget;
  private box = { left: 0, top: 0, width: 1, height: 1, ratio: 1 };
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly context: EditorCanvasContext,
  ) {
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
    this.overlay.addEventListener("pointercancel", this.cancelEvent);
    this.overlay.addEventListener("lostpointercapture", this.cancelEvent);
    this.overlay.addEventListener("keydown", this.keydown);
    this.observer = new ResizeObserver(() => {
      this.cancel();
      this.layout();
    });
    this.observer.observe(canvas);
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
    const rect = this.canvas.getBoundingClientRect(),
      parent = this.canvas.parentElement!.getBoundingClientRect();
    const width = this.target?.canvas.width ?? this.canvas.width,
      height = this.target?.canvas.height ?? this.canvas.height;
    const ratio = Math.min(rect.width / width, rect.height / height);
    if (!(ratio > 0)) return;
    this.box = {
      left: rect.left + (rect.width - width * ratio) / 2,
      top: rect.top + (rect.height - height * ratio) / 2,
      width: width * ratio,
      height: height * ratio,
      ratio,
    };
    Object.assign(this.overlay.style, {
      left: `${this.box.left - parent.left}px`,
      top: `${this.box.top - parent.top}px`,
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
    if (this.gesture) {
      if (this.current(this.gesture)) return;
      this.cancel();
    }
    const selection = this.context.selection();
    this.targets = canvasTargets(this.context.read(), selection.sequenceId, this.context.time());
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
  private point(event: PointerEvent): VisualPoint {
    return {
      x: (event.clientX - this.box.left) / this.box.ratio,
      y: (event.clientY - this.box.top) / this.box.ratio,
    };
  }
  private down = (event: PointerEvent) => {
    if (event.button !== 0 || this.gesture || this.disposed) return;
    try {
      this.context.assertEditable?.();
      this.context.pause();
      const start = this.point(event);
      let handle = (event.target as Element)
        .closest("[data-canvas-handle]")
        ?.getAttribute("data-canvas-handle");
      if (!handle) {
        const chosen = [...this.targets].reverse().find((target) => canvasTargetHit(target, start));
        this.context.select(chosen ? [chosen.clip.id] : []);
        this.render();
        if (!chosen || this.mode !== "transform") return;
        handle = "move";
      }
      const target = this.target;
      if (!target) return;
      if (target.locked) throw new Error("轨道已锁定，不能调整画面");
      if (this.mode === "mask" && !target.layer.mask) return;
      this.gesture = {
        target,
        identity: this.identity(),
        handle,
        mode: this.mode,
        pointer: event.pointerId,
        start,
        operations: [],
        changed: false,
      };
      event.preventDefault();
      event.stopPropagation();
      this.overlay.focus();
      this.overlay.setPointerCapture(event.pointerId);
    } catch (error) {
      this.context.onError(error);
    }
  };
  private move = (event: PointerEvent) => {
    const gesture = this.gesture;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    if (!this.current(gesture)) {
      this.cancel();
      return;
    }
    const end = this.point(event);
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
  private up = (event: PointerEvent) => {
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
    if (!this.gesture) return;
    this.clear();
    void this.context.draft().catch((error) => {
      if (!this.disposed) this.context.onError(error);
    });
    this.render();
  }
  private cancelEvent = () => this.cancel();
  private keydown = (event: KeyboardEvent) => {
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
  dispose(): void {
    this.disposed = true;
    this.clear();
    this.observer.disconnect();
    window.removeEventListener("blur", this.cancelEvent);
    this.overlay.remove();
    this.controls.remove();
  }
}
