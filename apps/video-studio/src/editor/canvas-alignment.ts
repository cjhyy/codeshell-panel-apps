import { evaluateAnimatedNumber } from "./animation";
import { canvasTargetCorners, canvasTargets, planCanvasGesture } from "./canvas-edits";
import { canvasPointToSource } from "./visual-layout";
import type { EditorOperation } from "./operations";
import type { EditorDocument } from "./types";
import type { Tick } from "./time";

export type CanvasAlignment = "left" | "center-x" | "right" | "top" | "center-y" | "bottom";

/** A cheap eligibility check for the inspector; geometry is evaluated only on an action. */
export function canvasAlignmentReason(
  document: EditorDocument,
  sequenceId: string,
  clipIds: readonly string[],
  time: Tick,
): string {
  const sequence = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence) return "当前序列已变化，请重新选择片段。";
  if (!clipIds.length) return "请先选择要对齐的画面片段。";
  if (!Number.isSafeInteger(time) || time < 0) return "播放位置无效，请重新定位。";
  for (const id of new Set(clipIds)) {
    const clip = sequence.clips.find((item) => item.id === id),
      track = sequence.tracks.find((item) => item.id === clip?.trackId);
    if (!clip || !track) return "所选片段已变化，请重新选择。";
    if (track.locked) return "所选片段包含已锁定轨道，请先解锁；本次选择不会部分对齐。";
    if (
      track.kind === "audio" ||
      (clip.kind === "media" &&
        document.assets.find((asset) => asset.id === clip.assetId)?.kind === "audio")
    )
      return "所选片段包含音频，请只选择画面片段。";
    if (track.hidden) return "所选片段包含隐藏轨道，请先显示轨道。";
    if (time < clip.start || time - clip.start >= clip.duration)
      return "请把播放头移到所有所选画面片段同时出现的位置。";
    if (clip.mask) return "带蒙版的片段请先用位置属性调整；快速对齐暂不计算蒙版边缘。";
    if (clip.kind === "text" && clip.style.layout === "caption-stack")
      return "叠放字幕的边框受其他字幕影响，请用位置属性调整。";
    if (clip.kind === "text" && !clip.text.trim()) return "空文字没有可对齐的排版框。";
    if (
      sequence.transitions.some(
        (transition) =>
          time >= transition.start &&
          time - transition.start < transition.duration &&
          (transition.fromClipId === id || transition.toClipId === id),
      )
    )
      return "所选画面正在转场，请把播放头移出转场后再对齐。";
  }
  return "";
}

/** Align each selected clip independently to the canvas, without changing its other axis.
 * Returns one atomic batch. Existing animation follows the same current-key edit as dragging. */
export function planCanvasAlignment(
  document: EditorDocument,
  sequenceId: string,
  clipIds: readonly string[],
  time: Tick,
  alignment: CanvasAlignment,
): EditorOperation[] {
  if (!["left", "center-x", "right", "top", "center-y", "bottom"].includes(alignment))
    throw new Error("未知画布对齐方式");
  const reason = canvasAlignmentReason(document, sequenceId, clipIds, time);
  if (reason) throw new Error(reason);
  const targets = canvasTargets(document, sequenceId, time),
    horizontal = ["left", "center-x", "right"].includes(alignment),
    axis = horizontal ? "x" : "y",
    otherAxis = horizontal ? "y" : "x";
  const operations: EditorOperation[] = [];
  for (const id of new Set(clipIds)) {
    const target = targets.find((item) => item.clip.id === id);
    if (!target) throw new Error("所选片段在当前刻度没有可对齐的画面，请重新定位。");
    const corners = canvasTargetCorners(target),
      first = canvasPointToSource(
        corners[0]!,
        target.source,
        target.canvas,
        target.layer.transform,
      ),
      last = canvasPointToSource(corners[2]!, target.source, target.canvas, target.layer.transform);
    if (!first || !last || last.x - first.x <= 1e-10 || last.y - first.y <= 1e-10)
      throw new Error("所选片段没有有效画面边框，请检查缩放、文字与裁切。");
    const minimum = Math.min(...corners.map((point) => point[axis])),
      maximum = Math.max(...corners.map((point) => point[axis])),
      dimension = horizontal ? target.canvas.width : target.canvas.height,
      delta =
        alignment === "left" || alignment === "top"
          ? -minimum
          : alignment === "right" || alignment === "bottom"
            ? dimension - maximum
            : dimension / 2 - (minimum + maximum) / 2,
      next = target.layer.transform[axis] + delta / dimension;
    if (!Number.isFinite(next) || next < -10 || next > 10)
      throw new Error("对齐所需位置超出允许范围，请先减小缩放。");
    if (Math.abs(delta) < 1e-7) continue;
    const movement =
      (next - evaluateAnimatedNumber(target.clip.transform[axis], target.layer.localTime)) *
      dimension;
    const [operation] = planCanvasGesture(
      target,
      "transform",
      "move",
      { x: 0, y: 0 },
      horizontal ? { x: movement, y: 0 } : { x: 0, y: movement },
    );
    if (!operation || operation.type !== "clip.update" || !operation.patch.transform)
      throw new Error("无法调整当前画面位置");
    // A horizontal action must not insert a y key (and vice versa).
    operation.patch.transform[otherAxis] = structuredClone(target.clip.transform[otherAxis]);
    operations.push(operation);
  }
  return operations;
}
