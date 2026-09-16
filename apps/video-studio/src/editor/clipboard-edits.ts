import { copyClips, pasteClips, type ClipIdFactory } from "./clip-edits";
import { applyEditorOperations, type EditorOperation } from "./operations";
import { planMagneticRemove } from "./timing-edits";
import type { EditorDocument } from "./types";
import { validateEditorDocument } from "./validation";

/** Copy and remove exactly the same graph. A caption-only cut must never copy its owner. */
export function planCutClips(
  value: EditorDocument,
  sequenceId: string,
  clipIds: readonly string[],
) {
  const document = validateEditorDocument(value),
    sequence = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence) throw new Error("序列不存在");
  const payload = copyClips(document, sequenceId, clipIds);
  const selected = new Set(clipIds);
  for (;;) {
    const count = selected.size,
      members = sequence.clips.filter((clip) => selected.has(clip.id)),
      groups = new Set(members.map((clip) => clip.groupId).filter(Boolean)),
      links = new Set(members.map((clip) => clip.linkGroupId).filter(Boolean));
    for (const clip of sequence.clips)
      if (
        (clip.groupId && groups.has(clip.groupId)) ||
        (clip.linkGroupId && links.has(clip.linkGroupId))
      )
        selected.add(clip.id);
    if (count === selected.size) break;
  }
  const operations: EditorOperation[] =
    sequence.timelineMode === "magnetic"
      ? planMagneticRemove(document, sequenceId, [...selected])
      : [{ type: "clip.remove", sequenceId, clipIds: [...selected] }];
  const after = applyEditorOperations(document, operations, document.revision),
    remaining = new Set(
      after.sequences.find((item) => item.id === sequenceId)!.clips.map((clip) => clip.id),
    );
  if (
    payload.document.sequences
      .find((item) => item.id === sequenceId)!
      .clips.some((clip) => remaining.has(clip.id))
  )
    throw new Error("剪切来源字幕时，请同时选择来源片段，或先明确解除字幕绑定");
  return { operations, payload };
}

/** Preserve timing and per-track mix by copying the selected graph onto new parallel tracks. */
export function duplicateClipsInPlace(
  value: EditorDocument,
  sequenceId: string,
  clipIds: readonly string[],
  options: { idFactory: (kind: Parameters<ClipIdFactory>[0] | "track") => string },
): EditorOperation[] {
  const document = validateEditorDocument(value),
    sequence = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence) throw new Error("序列不存在");
  const payload = copyClips(document, sequenceId, clipIds),
    source = payload.document.sequences.find((item) => item.id === sequenceId)!,
    usedTracks = new Set(source.clips.map((clip) => clip.trackId)),
    trackMap: Record<string, string> = Object.fromEntries(
      sequence.tracks.map((track) => [track.id, track.id]),
    ),
    operations: EditorOperation[] = [];
  // Source order also determines layer order. Append as one parallel stack without moving locked tracks.
  for (const track of sequence.tracks.filter((item) => usedTracks.has(item.id))) {
    if (track.locked) throw new Error(`轨道“${track.name}”已锁定，请先解锁`);
    const id = options.idFactory("track");
    trackMap[track.id] = id;
    operations.push({
      type: "track.add",
      sequenceId,
      track: { ...structuredClone(track), id, name: `${track.name.slice(0, 190)} 副本` },
    });
  }
  const draft = applyEditorOperations(document, operations, document.revision);
  operations.push(
    ...pasteClips(draft, sequenceId, payload, {
      at: payload.origin,
      trackMap,
      idFactory: options.idFactory,
    }),
  );
  applyEditorOperations(document, operations, document.revision);
  return operations;
}
