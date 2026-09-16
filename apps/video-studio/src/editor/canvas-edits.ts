import { evaluateAnimatedNumber, type AnimatedNumber } from "./animation";
import { evaluateFrame, type EvaluatedVisualLayer } from "./evaluate";
import type { EditorOperation } from "./operations";
import type { EditorClip, EditorDocument, Mask } from "./types";
import type { Tick } from "./time";
import { textSourceBounds } from "./compositor";
import {
  canvasPointToSource,
  fitVisualSource,
  sourcePointToCanvas,
  visualPointToCanvas,
  type VisualPoint,
} from "./visual-layout";

export type CanvasEditMode = "transform" | "crop" | "mask";
export interface CanvasTarget {
  document: EditorDocument;
  sequenceId: string;
  time: Tick;
  clip: EditorClip;
  layer: EvaluatedVisualLayer;
  canvas: { width: number; height: number };
  source: { width: number; height: number };
  locked: boolean;
}
export function canvasTargets(
  document: EditorDocument,
  sequenceId: string,
  time: Tick,
): CanvasTarget[] {
  const sequence = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence) return [];
  const frame = evaluateFrame(document, sequenceId, time);
  const layers = frame.layers.flatMap((layer) => {
    if (layer.kind !== "transition") return [layer];
    const direction =
      layer.transitionKind === "push-left" ? -1 : layer.transitionKind === "push-right" ? 1 : 0;
    return [
      { item: layer.from, offset: direction * layer.progress },
      { item: layer.to, offset: -direction * (1 - layer.progress) },
    ].flatMap(({ item, offset }) =>
      item ? [{ ...item, transform: { ...item.transform, x: item.transform.x + offset } }] : [],
    );
  });
  return layers
    .map((layer) => ({
      document,
      sequenceId,
      time,
      layer,
      clip: sequence.clips.find((item) => item.id === layer.clipId)!,
      canvas: { width: frame.width, height: frame.height },
      source:
        layer.kind === "media"
          ? { width: layer.naturalWidth, height: layer.naturalHeight }
          : layer.kind === "group"
            ? { width: layer.width, height: layer.height }
            : { width: frame.width, height: frame.height },
      locked: sequence.tracks.find((item) => item.id === layer.trackId)!.locked,
    }))
    .filter((item) => !!item.clip);
}
function bounds(target: CanvasTarget, content = true) {
  const crop = target.layer.transform.crop;
  const box =
    content && target.layer.kind === "text"
      ? textSourceBounds(target.layer, target.source.width, target.source.height)
      : content && target.layer.kind === "shape" && target.layer.shape === "line"
        ? {
            left: 0,
            right: 1,
            top: 0.5 - target.layer.strokeWidth / (2 * target.source.height),
            bottom: 0.5 + target.layer.strokeWidth / (2 * target.source.height),
          }
        : { left: 0, top: 0, right: 1, bottom: 1 };
  return {
    left: Math.max(crop.left, box.left),
    top: Math.max(crop.top, box.top),
    right: Math.min(1 - crop.right, box.right),
    bottom: Math.min(1 - crop.bottom, box.bottom),
  };
}
export function canvasTargetCorners(target: CanvasTarget, content = true): VisualPoint[] {
  const b = bounds(target, content);
  return [
    { x: b.left, y: b.top },
    { x: b.right, y: b.top },
    { x: b.right, y: b.bottom },
    { x: b.left, y: b.bottom },
  ].map((point) =>
    sourcePointToCanvas(point, target.source, target.canvas, target.layer.transform),
  );
}
export function canvasTargetHit(target: CanvasTarget, point: VisualPoint): boolean {
  const source = canvasPointToSource(point, target.source, target.canvas, target.layer.transform),
    box = bounds(target);
  return (
    !!source &&
    source.x >= box.left &&
    source.x <= box.right &&
    source.y >= box.top &&
    source.y <= box.bottom
  );
}
function animatedAt(value: AnimatedNumber, time: Tick, next: number): AnimatedNumber {
  if (typeof value === "number") return next;
  const keyframes = structuredClone(value.keyframes),
    found = keyframes.find((key) => key.time === time);
  if (found) found.value = next;
  else keyframes.push({ time, value: next, easing: "linear" });
  keyframes.sort((a, b) => a.time - b.time);
  return { keyframes };
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const rotate = (p: VisualPoint, degrees: number): VisualPoint => {
  const angle = (degrees * Math.PI) / 180;
  return {
    x: p.x * Math.cos(angle) - p.y * Math.sin(angle),
    y: p.x * Math.sin(angle) + p.y * Math.cos(angle),
  };
};
export function maskPointOnCanvas(target: CanvasTarget, point: VisualPoint): VisualPoint {
  const mask = target.layer.mask!;
  const fit = fitVisualSource(target.source, target.canvas, target.layer.transform);
  const offset = rotate(
    {
      x: (point.x - 0.5) * mask.width * fit.originalWidth,
      y: (point.y - 0.5) * mask.height * fit.originalHeight,
    },
    mask.rotation,
  );
  return sourcePointToCanvas(
    {
      x: 0.5 + mask.x + offset.x / fit.originalWidth,
      y: 0.5 + mask.y + offset.y / fit.originalHeight,
    },
    target.source,
    target.canvas,
    target.layer.transform,
  );
}
function maskLocal(target: CanvasTarget, point: VisualPoint, mask: Mask): VisualPoint {
  const source = canvasPointToSource(point, target.source, target.canvas, target.layer.transform);
  if (!source) throw new Error("零缩放图层请先通过属性恢复缩放");
  const fit = fitVisualSource(target.source, target.canvas, target.layer.transform);
  return rotate(
    {
      x: (source.x - 0.5 - mask.x) * fit.originalWidth,
      y: (source.y - 0.5 - mask.y) * fit.originalHeight,
    },
    -mask.rotation,
  );
}
/** One gesture creates one reversible operation. Animated properties update only the current key. */
export function planCanvasGesture(
  target: CanvasTarget,
  mode: CanvasEditMode,
  handle: string,
  start: VisualPoint,
  end: VisualPoint,
  options: { uniform?: boolean; snap?: boolean } = {},
): EditorOperation[] {
  if (target.locked) throw new Error("轨道已锁定，不能调整画面");
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) throw new Error("画布坐标无效");
  const clip = target.clip;
  if (!("transform" in clip)) throw new Error("当前片段没有画面");
  const transform = structuredClone(clip.transform),
    resolved = target.layer.transform;
  const localTime = clamp(target.time - clip.start, 0, clip.duration);
  const set = (key: "x" | "y" | "scaleX" | "scaleY" | "rotation", next: number) => {
    transform[key] = animatedAt(transform[key], localTime, next);
  };
  if (mode === "transform") {
    if (handle === "move") {
      set(
        "x",
        clamp(
          evaluateAnimatedNumber(transform.x, localTime) + (end.x - start.x) / target.canvas.width,
          -10,
          10,
        ),
      );
      set(
        "y",
        clamp(
          evaluateAnimatedNumber(transform.y, localTime) + (end.y - start.y) / target.canvas.height,
          -10,
          10,
        ),
      );
    } else if (handle === "rotate") {
      const center = visualPointToCanvas({ x: 0, y: 0 }, target.canvas, resolved);
      const angle =
        Math.atan2(end.y - center.y, end.x - center.x) -
        Math.atan2(start.y - center.y, start.x - center.x);
      const degrees =
        resolved.rotation + (Math.atan2(Math.sin(angle), Math.cos(angle)) * 180) / Math.PI;
      set(
        "rotation",
        clamp(options.snap ? Math.round(degrees / 15) * 15 : degrees, -360000, 360000),
      );
    } else if (["nw", "ne", "se", "sw"].includes(handle)) {
      const center = visualPointToCanvas({ x: 0, y: 0 }, target.canvas, resolved);
      const first = rotate({ x: start.x - center.x, y: start.y - center.y }, -resolved.rotation),
        last = rotate({ x: end.x - center.x, y: end.y - center.y }, -resolved.rotation);
      let x = Math.abs(first.x) > 1e-8 ? Math.abs(last.x / first.x) : 1;
      let y = Math.abs(first.y) > 1e-8 ? Math.abs(last.y / first.y) : 1;
      if (options.uniform !== false)
        x = y = Math.hypot(last.x, last.y) / Math.max(1e-8, Math.hypot(first.x, first.y));
      set("scaleX", clamp(resolved.scaleX * x, 0.001, 100));
      set("scaleY", clamp(resolved.scaleY * y, 0.001, 100));
    } else throw new Error("未知画布调整手柄");
    return [
      { type: "clip.update", sequenceId: target.sequenceId, clipId: clip.id, patch: { transform } },
    ];
  }
  if (mode === "crop") {
    if (!["left", "right", "top", "bottom"].includes(handle)) throw new Error("请拖动裁切边缘");
    const point = canvasPointToSource(end, target.source, target.canvas, resolved);
    if (!point) throw new Error("零缩放图层请先通过属性恢复缩放");
    if (handle === "left")
      transform.crop.left = clamp(point.x, 0, 1 - transform.crop.right - 0.001);
    if (handle === "right")
      transform.crop.right = clamp(1 - point.x, 0, 1 - transform.crop.left - 0.001);
    if (handle === "top") transform.crop.top = clamp(point.y, 0, 1 - transform.crop.bottom - 0.001);
    if (handle === "bottom")
      transform.crop.bottom = clamp(1 - point.y, 0, 1 - transform.crop.top - 0.001);
    return [
      { type: "clip.update", sequenceId: target.sequenceId, clipId: clip.id, patch: { transform } },
    ];
  }
  const mask = structuredClone(clip.mask);
  if (!mask) throw new Error("请先在蒙版属性中选择一种蒙版");
  const fit = fitVisualSource(target.source, target.canvas, resolved);
  if (handle === "move") {
    const first = canvasPointToSource(start, target.source, target.canvas, resolved),
      last = canvasPointToSource(end, target.source, target.canvas, resolved);
    if (!first || !last) throw new Error("零缩放图层请先通过属性恢复缩放");
    mask.x = clamp(mask.x + last.x - first.x, -2, 2);
    mask.y = clamp(mask.y + last.y - first.y, -2, 2);
  } else if (handle === "rotate") {
    const first = maskLocal(target, start, mask),
      last = maskLocal(target, end, mask);
    const angle = Math.atan2(last.y, last.x) - Math.atan2(first.y, first.x);
    const degrees = mask.rotation + (Math.atan2(Math.sin(angle), Math.cos(angle)) * 180) / Math.PI;
    mask.rotation = clamp(options.snap ? Math.round(degrees / 15) * 15 : degrees, -360000, 360000);
  } else if (/^point-\d+$/.test(handle) && mask.kind === "path") {
    const index = Number(handle.slice(6)),
      point = maskLocal(target, end, mask);
    if (!mask.points?.[index]) throw new Error("蒙版顶点已变化");
    mask.points[index] = {
      x: clamp(0.5 + point.x / (fit.originalWidth * mask.width), 0, 1),
      y: clamp(0.5 + point.y / (fit.originalHeight * mask.height), 0, 1),
    };
  } else if (["nw", "ne", "se", "sw"].includes(handle)) {
    const point = maskLocal(target, end, mask);
    mask.width = clamp((2 * Math.abs(point.x)) / fit.originalWidth, 0.001, 4);
    mask.height = clamp((2 * Math.abs(point.y)) / fit.originalHeight, 0.001, 4);
  } else throw new Error("未知蒙版调整手柄");
  return [{ type: "clip.update", sequenceId: target.sequenceId, clipId: clip.id, patch: { mask } }];
}
