import type { EditorClip, EditorDocument, EditorSequence, TextClip } from "./types";

/** The sequence with this ID; `missing` is the user-facing message when it is gone. */
export function sequenceOf(
  document: EditorDocument,
  sequenceId: string,
  missing = "时间线不存在，请刷新后重试",
): EditorSequence {
  const sequence = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence) throw new Error(missing);
  return sequence;
}

/** A caption line (subtitle text clip), as opposed to titles and other text. */
export const isSubtitleClip = (clip: EditorClip): clip is TextClip =>
  clip.kind === "text" && clip.role === "subtitle";
