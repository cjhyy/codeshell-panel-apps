import { compileAudioPlan } from "./audio-plan";
import { createTrack, defaultColorAdjustment, defaultTransform } from "./defaults";
import { applyEditorOperations, type EditorOperation } from "./operations";
import type { EditorDocument, EditorSequence, MediaClip } from "./types";
import { validateEditorDocument } from "./validation";

/** An inexpensive explanation for an already detached editor view; planners validate independently. */
export function originalAudioReason(document: EditorDocument, sequence: EditorSequence,
  clipIds: readonly string[]): string {
  const clip = clipIds.length === 1 && sequence.clips.find((item) => item.id === clipIds[0]);
  if (!clip || clip.kind !== "media" || sequence.tracks.find((track) => track.id === clip.trackId)?.kind !== "video" ||
    document.assets.find((asset) => asset.id === clip.assetId)?.kind !== "video")
    return "请选择一个视频素材片段";
  if (sequence.tracks.find((track) => track.id === clip.trackId)?.locked)
    return "视频轨道已锁定，请先解锁";
  if (sequence.transitions.some((item) => item.fromClipId === clip.id || item.toClipId === clip.id))
    return "请先移除片段两端的转场，以免改变原声交叉淡化";
  if (clip.audio.volume === 0) return "原片段已静音；请先恢复原声音量";
  return "";
}

/** Reuses the authorized source, preserving the original mix without decoding or creating an asset. */
export function planDetachOriginalAudio(value: unknown, sequenceId: string, clipId: string,
  idFactory: () => string): { operations: EditorOperation[]; audioClipId: string } {
  const document = validateEditorDocument(value),
    sequence = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence) throw new Error("序列已不存在，请重新选择");
  const reason = originalAudioReason(document, sequence, [clipId]);
  if (reason) throw new Error(reason);
  const used = new Set(document.sequences.flatMap((item) => [item.id,
    ...item.tracks.map((track) => track.id), ...item.transitions.map((transition) => transition.id),
    ...item.clips.flatMap((clip) => [clip.id, clip.groupId, clip.linkGroupId])])),
    allocate = () => {
      const id = idFactory();
      if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id) || used.has(id))
        throw new Error("新声音片段或链接 ID 无效或已存在，请重新操作");
      used.add(id); return id;
    };
  const clip = sequence.clips.find((item) => item.id === clipId)! as MediaClip,
    sourceTrack = sequence.tracks.find((track) => track.id === clip.trackId)!,
    trackId = allocate(), audioClipId = allocate(), link = clip.linkGroupId ?? allocate(),
    track = { ...createTrack(trackId, "audio", `${clip.label || "视频"} · 原声`.slice(0, 200)),
      volume: sourceTrack.volume, pan: sourceTrack.pan, muted: sourceTrack.muted },
    audioClip: MediaClip = { ...structuredClone(clip), id: audioClipId, trackId,
      label: `${clip.label || "视频"} · 原声`.slice(0, 256), linkGroupId: link,
      transform: defaultTransform(), color: defaultColorAdjustment(), blendMode: "normal" };
  delete audioClip.mask;
  const operations: EditorOperation[] = [
    { type: "track.add", sequenceId, track, index: sequence.tracks.indexOf(sourceTrack) + 1 },
    { type: "clip.add", sequenceId, clip: audioClip },
    { type: "clip.update", sequenceId, clipId, patch: { audio: { ...clip.audio, volume: 0 }, linkGroupId: link } },
  ];
  // Keep the old bus for other source-track clips; include the extracted signal in every dependent bus.
  for (const dependent of sequence.clips) {
    if (!("audio" in dependent) || !dependent.audio.ducking?.sidechainTrackIds.includes(sourceTrack.id)) continue;
    if (sequence.tracks.find((item) => item.id === dependent.trackId)?.locked)
      throw new Error("依赖原声的压低背景声片段位于锁定轨道，请先解锁");
    if (dependent.audio.ducking.sidechainTrackIds.length >= 64)
      throw new Error("压低背景声的声音来源已达上限，不能安全分离原声");
    operations.push({ type: "clip.update", sequenceId, clipId: dependent.id,
      patch: { audio: { ...dependent.audio, ducking: { ...dependent.audio.ducking,
        sidechainTrackIds: [...dependent.audio.ducking.sidechainTrackIds, trackId] } } } });
  }
  const next = applyEditorOperations(document, operations, document.revision), affected = new Set([sequenceId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const parent of next.sequences)
      if (!affected.has(parent.id) && parent.clips.some((item) => item.kind === "sequence" && affected.has(item.sequenceId))) {
        affected.add(parent.id); grew = true;
      }
  }
  // Muted video lanes still count. Check nested callers too, using the normal public compiler limits.
  for (const id of affected) {
    try { compileAudioPlan(next, id); }
    catch { throw new Error("分离后的声音实例超过混音容量，请先简化此序列及其父序列"); }
  }
  return { operations, audioClipId };
}

/** Clears complete link groups atomically, while ordinary groups and caption ownership remain intact. */
export function planUnlinkAudio(value: unknown, sequenceId: string,
  clipIds: readonly string[]): EditorOperation[] {
  const document = validateEditorDocument(value), sequence = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence || !Array.isArray(clipIds) || !clipIds.length || new Set(clipIds).size !== clipIds.length ||
    clipIds.some((id) => !sequence.clips.some((clip) => clip.id === id)))
    throw new Error("片段已不存在，请重新选择");
  const selected = new Set(clipIds), links = new Set(sequence.clips
    .filter((clip) => selected.has(clip.id) && clip.linkGroupId).map((clip) => clip.linkGroupId!)),
    members = sequence.clips.filter((clip) => clip.linkGroupId && links.has(clip.linkGroupId));
  if (!members.length) throw new Error("所选片段没有音画链接");
  if (members.some((clip) => sequence.tracks.find((track) => track.id === clip.trackId)?.locked))
    throw new Error("链接中有锁定轨道的片段，请先解锁后整体解除链接");
  const operations: EditorOperation[] = members.map((clip) => ({ type: "clip.update", sequenceId,
    clipId: clip.id, patch: { linkGroupId: null } }));
  applyEditorOperations(document, operations, document.revision);
  return operations;
}
