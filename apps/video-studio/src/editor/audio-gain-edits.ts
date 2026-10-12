import { hasTimelineAudio } from "./audio-fade-edits";
import { applyEditorOperations, type EditorOperation } from "./operations";
import { validateEditorDocument } from "./validation";

/** A fixed gain edit never replaces an automation curve or changes linked clips. */
export function planClipAudioGain(
  value: unknown,
  sequenceId: string,
  clipId: string,
  volume: number,
): EditorOperation[] {
  const document = validateEditorDocument(value),
    sequence = document.sequences.find((item) => item.id === sequenceId),
    clip = sequence?.clips.find((item) => item.id === clipId);
  if (!sequence || !clip) throw new Error("片段已不存在，请重新选择");
  if (!Number.isFinite(volume) || volume < 0 || volume > 4)
    throw new Error("片段音量须在 0% 到 400% 之间");
  if (!("audio" in clip) || !hasTimelineAudio(document, clip))
    throw new Error("请选择含声音的片段");
  if (typeof clip.audio.volume !== "number")
    throw new Error("音量已自动化，请在属性面板编辑关键帧");
  if (sequence.tracks.find((track) => track.id === clip.trackId)?.locked)
    throw new Error("轨道已锁定，不能调整片段音量");
  if (clip.audio.volume === volume) return [];
  const operations: EditorOperation[] = [{ type: "clip.update", sequenceId, clipId,
    patch: { audio: { ...clip.audio, volume } } }];
  applyEditorOperations(document, operations, document.revision);
  return operations;
}
