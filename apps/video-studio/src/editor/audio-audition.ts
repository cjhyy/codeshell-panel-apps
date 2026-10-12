import { compileAudioPlan } from "./audio-plan";
import type { EditorDocument } from "./types";
import { validateEditorDocument } from "./validation";

/** Audition documents are detached snapshots; history, saved projects and exports keep the original. */
export function trackAuditionDocument(value: EditorDocument, sequenceId: string, solo: ReadonlySet<string>): EditorDocument {
  const document = validateEditorDocument(value), sequence = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence) throw new Error("试听序列已移除");
  if (solo.size) for (const track of sequence.tracks) if (!solo.has(track.id)) track.muted = true;
  return document;
}

/** Constant root-clip gain is linear in the shared mix. Sidechain ducking is not: changing
 * its input changes a detector's history, so those projects must use a freshly rendered mix. */
export function clipGainAuditionDocument(value: EditorDocument, sequenceId: string, clipId: string): { document: EditorDocument; volume: number } {
  const document = validateEditorDocument(value), sequence = document.sequences.find((item) => item.id === sequenceId),
    clip = sequence?.clips.find((item) => item.id === clipId);
  if (!sequence || !clip || !("audio" in clip) || typeof clip.audio.volume !== "number")
    throw new Error("请选择一个使用固定音量的声音片段");
  const track = sequence.tracks.find((item) => item.id === clip.trackId)!;
  if (track.muted || track.volume === 0) throw new Error("所选轨道已静音，或未加入独轨试听");
  const plan = compileAudioPlan(document, sequenceId);
  if (plan.ducking.length) throw new Error("此序列含自动闪避，请保存音量后重新播放试听；实时调音不能保持闪避检测结果");
  if (!plan.lanes.some((lane) => lane.stages[0]?.clipId === clipId))
    throw new Error("所选片段没有可试听的声音");
  const volume = clip.audio.volume;
  for (const item of sequence.clips) if ("audio" in item) item.audio.volume = item.id === clipId ? 1 : 0;
  return { document, volume };
}
