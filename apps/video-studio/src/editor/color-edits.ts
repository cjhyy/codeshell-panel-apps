import type { AnimatedNumber } from "./animation";
import type { ResolvedColorAdjustment } from "./color";
import { defaultColorAdjustment } from "./defaults";
import { resolveColor } from "./evaluate";
import { applyEditorOperations, type EditorOperation } from "./operations";
import { assertTick, type Tick } from "./time";
import type { ColorAdjustment, EditorClip, EditorDocument, EditorSequence } from "./types";
import { MAX_EDITOR_TICK, validateColorAdjustment, validateEditorDocument } from "./validation";

const properties = [
  "exposure", "brightness", "contrast", "saturation", "temperature", "tint", "hue",
] as const;
const localTime = (clip: EditorClip, time: Tick) =>
  Math.max(0, Math.min(clip.duration, time - clip.start));

/** Audio-only clips have a color field for schema uniformity but cannot display a grade. */
export function clipCanReceiveColor(
  document: EditorDocument,
  sequence: EditorSequence,
  clip: EditorClip,
): boolean {
  return sequence.tracks.find((track) => track.id === clip.trackId)?.kind !== "audio" &&
    !(clip.kind === "media" && document.assets.find((asset) => asset.id === clip.assetId)?.kind === "audio");
}

function context(value: EditorDocument, sequenceId: string, ids: readonly string[]) {
  const document = validateEditorDocument(value),
    sequence = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence) throw new Error("目标序列不存在");
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error("请选择有效且不重复的片段");
  const clips = ids.map((id) => {
    const clip = sequence.clips.find((item) => item.id === id);
    if (!clip) throw new Error("所选片段已不存在，请重新选择");
    if (!clipCanReceiveColor(document, sequence, clip))
      throw new Error("声音片段不能应用调色，请只选择画面或文字片段");
    return clip;
  });
  return { document, sequence, clips };
}

/** Copy the displayed grade at one exact tick, never the source clip's animation timeline. */
export function copyClipColor(
  value: EditorDocument,
  sequenceId: string,
  clipId: string,
  time: Tick,
): ResolvedColorAdjustment {
  assertTick(time);
  const { clips } = context(value, sequenceId, [clipId]),
    clip = clips[0]!;
  return resolveColor(clip.color, localTime(clip, time));
}

function replaceKey(value: AnimatedNumber, time: Tick, number: number): AnimatedNumber {
  if (typeof value === "number") return number;
  const keyframes = structuredClone(value.keyframes),
    existing = keyframes.find((key) => key.time === time);
  if (existing) existing.value = number;
  else keyframes.push({ time, value: number, easing: "linear" });
  keyframes.sort((a, b) => a.time - b.time);
  return { keyframes };
}

/** Each target keeps its existing animation except the current key. Curves and HSL are static values. */
export function pasteClipColor(
  value: EditorDocument,
  sequenceId: string,
  clipIds: readonly string[],
  time: Tick,
  copied: unknown,
): EditorOperation[] {
  assertTick(time);
  const { document, clips } = context(value, sequenceId, clipIds),
    snapshot = validateColorAdjustment(copied, MAX_EDITOR_TICK);
  if (properties.some((key) => typeof snapshot[key] !== "number"))
    throw new Error("请复制片段当前的调色快照；不能粘贴整段调色动画");
  const operations: EditorOperation[] = clips.map((clip) => {
    const color: ColorAdjustment = {
      ...structuredClone(clip.color),
      curves: structuredClone(snapshot.curves),
      hsl: structuredClone(snapshot.hsl),
    };
    for (const key of properties)
      color[key] = replaceKey(clip.color[key], localTime(clip, time), snapshot[key] as number);
    return { type: "clip.update", sequenceId, clipId: clip.id, patch: { color } };
  });
  applyEditorOperations(document, operations, document.revision);
  return operations;
}

/** Explicit reset removes color animation, tone curves and HSL, with one normal undoable batch. */
export function resetClipColor(
  value: EditorDocument,
  sequenceId: string,
  clipIds: readonly string[],
): EditorOperation[] {
  const { document, clips } = context(value, sequenceId, clipIds),
    operations: EditorOperation[] = clips.map((clip) => ({
      type: "clip.update",
      sequenceId,
      clipId: clip.id,
      patch: { color: defaultColorAdjustment() },
    }));
  applyEditorOperations(document, operations, document.revision);
  return operations;
}
