import { applyEditorOperations, type EditorOperation } from "./operations";
import type { EditorClip, EditorDocument } from "./types";
import type { Tick } from "./time";
import { validateEditorDocument } from "./validation";

export type AudioFadeSide = "fadeIn" | "fadeOut";

export function hasTimelineAudio(document: EditorDocument, clip: EditorClip): boolean {
  if (!("audio" in clip)) return false;
  if (clip.kind !== "media") return true;
  return document.assets.some((asset) => asset.id === clip.assetId &&
    (asset.kind === "audio" || asset.kind === "video"));
}

/** Change only the chosen clip's fade; groups and magnetic neighbours keep their timing. */
export function planClipAudioFade(
  value: unknown,
  sequenceId: string,
  clipId: string,
  side: AudioFadeSide,
  duration: Tick,
): EditorOperation[] {
  const document = validateEditorDocument(value),
    sequence = document.sequences.find((item) => item.id === sequenceId),
    clip = sequence?.clips.find((item) => item.id === clipId);
  if (!sequence || !clip) throw new Error("片段已不存在，请重新选择");
  if ((side !== "fadeIn" && side !== "fadeOut") || !Number.isSafeInteger(duration) ||
    duration < 0 || duration > clip.duration)
    throw new Error("声音淡入或淡出时长须在 0 到片段时长之间");
  if (!("audio" in clip) || !hasTimelineAudio(document, clip))
    throw new Error("请选择音频、视频、嵌套序列或多机位片段");
  if (sequence.tracks.find((track) => track.id === clip.trackId)?.locked)
    throw new Error("轨道已锁定，不能调整声音淡入淡出");
  if (clip.audio[side] === duration) return [];
  const operations: EditorOperation[] = [{
    type: "clip.update", sequenceId, clipId,
    patch: { audio: { ...clip.audio, [side]: duration } },
  }];
  applyEditorOperations(document, operations, document.revision);
  return operations;
}
