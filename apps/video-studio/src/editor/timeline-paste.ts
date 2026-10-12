import { pasteClips, validateClipClipboard, type ClipIdFactory } from "./clip-edits";
import type { EditorOperation } from "./operations";
import type { Tick } from "./time";
import type { EditorDocument, EditorTrack } from "./types";
import { validateEditorDocument } from "./validation";

/** Same-sequence paste keeps original tracks. Across sequences, preserve the full
 * source track's ordinal within its kind, including unselected sidechain tracks.
 * Never skip locked tracks, search for a free slot, create tracks or move neighbors. */
export function planTimelinePaste(
  value: EditorDocument,
  sequenceId: string,
  payload: unknown,
  options: { at: Tick; idFactory: ClipIdFactory },
): EditorOperation[] {
  const document = validateEditorDocument(value),
    copied = validateClipClipboard(payload),
    sequence = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence) throw new Error("目标序列不存在");
  if (document.id === copied.document.id && sequenceId === copied.sequenceId)
    return pasteClips(document, sequenceId, copied, options);
  const source = copied.document.sequences.find((item) => item.id === copied.sequenceId)!,
    required = new Set(
      source.clips.flatMap((clip) => [
        clip.trackId,
        ...("audio" in clip ? (clip.audio.ducking?.sidechainTrackIds ?? []) : []),
      ]),
    ),
    trackMap: Record<string, string> = {},
    ordinal: Record<EditorTrack["kind"], number> = { video: 0, audio: 0, text: 0 };
  for (const track of source.tracks) {
    const index = ordinal[track.kind]++,
      target = sequence.tracks.filter((item) => item.kind === track.kind)[index];
    if (target) trackMap[track.id] = target.id;
    else if (required.has(track.id)) {
      const label = { video: "画面", audio: "声音", text: "文字" }[track.kind];
      throw new Error(`目标序列缺少第 ${index + 1} 条${label}轨，请先添加对应轨道后粘贴`);
    }
  }
  return pasteClips(document, sequenceId, copied, { ...options, trackMap });
}
