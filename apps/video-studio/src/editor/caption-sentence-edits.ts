import { randomId } from "../ids.js";
import { sliceCaptionBinding } from "./caption-bindings";
import type { CaptionPlan } from "./captions";
import { isSubtitleClip } from "./lookup";
import { applyEditorOperations, type EditorClipPatch } from "./operations";
import { assertTick, type Tick } from "./time";
import type { EditorDocument, EditorSequence, TextClip } from "./types";
import { validateEditorDocument } from "./validation";

export interface CaptionSentencePlan extends CaptionPlan {
  /** Existing rows whose unsaved drafts must be protected before preview and application. */
  affectedIds: string[];
}
const gaps = /^[\p{White_Space}\p{Punctuation}]*$/u;
function graphemeBoundary(text: string, caret: number): boolean {
  // Intl.Segmenter is available in supported browser runtimes; no code-unit fallback may split emoji.
  const Constructor = (Intl as unknown as {
    Segmenter?: new (locale: string | undefined, options: { granularity: string }) => {
      segment(text: string): Iterable<{ index: number }>;
    };
  }).Segmenter;
  if (!Constructor) throw new Error("当前浏览器不能安全识别文字边界，请升级浏览器后分句");
  return [...new Constructor(undefined, { granularity: "grapheme" }).segment(text)]
    .some((item) => item.index === caret);
}
/** Exact ordered word matching; punctuation/whitespace gaps carry no invented speech times. */
function wordOffsets(clip: TextClip): { starts: number[]; ends: number[] } | undefined {
  const starts: number[] = [], ends: number[] = [];
  let cursor = 0;
  for (const word of clip.words) {
    const text = word.text.trim(), start = text ? clip.text.indexOf(text, cursor) : -1;
    if (start < 0 || !gaps.test(clip.text.slice(cursor, start))) return;
    starts.push(start);
    cursor = start + text.length;
    ends.push(cursor);
  }
  if (!gaps.test(clip.text.slice(cursor))) return;
  return { starts, ends };
}
function wordBoundary(offsets: NonNullable<ReturnType<typeof wordOffsets>>, caret: number): number | undefined {
  const { starts, ends } = offsets;
  for (let index = 1; index < starts.length; index++)
    if (caret >= ends[index - 1]! && caret <= starts[index]!) return index;
}
function context(value: EditorDocument, sequenceId: string): { document: EditorDocument; sequence: EditorSequence } {
  const document = validateEditorDocument(value),
    sequence = document.sequences.find((seq) => seq.id === sequenceId);
  if (!sequence) throw new Error("字幕时间线不存在");
  return { document, sequence };
}
function caption(sequence: EditorSequence, clipId: string): TextClip {
  const clip = sequence.clips.find((item) => item.id === clipId);
  if (!clip || !isSubtitleClip(clip)) throw new Error("请选择有效的字幕片段");
  if (sequence.tracks.find((track) => track.id === clip.trackId)?.locked)
    throw new Error("字幕轨已锁定，请先解锁");
  if (clip.translation)
    throw new Error("含译文字幕暂不支持分句或合并；请使用原始字幕，或重新生成原字幕后处理，避免丢失翻译关系");
  if (["fade", "typewriter"].includes(clip.style.animation) || animated(clip.transform) || animated(clip.color))
    throw new Error("字幕含淡入、打字机或关键帧动画；请先关闭这些动画再分句或合并");
  if (sequence.transitions.some((item) => item.fromClipId === clip.id || item.toClipId === clip.id))
    throw new Error("字幕带有转场，请先移除转场再分句或合并");
  return clip;
}
function animated(value: unknown): boolean {
  return !!value && typeof value === "object" &&
    (Object.hasOwn(value, "keyframes") || Object.values(value).some(animated));
}
function patch(clip: TextClip): EditorClipPatch<TextClip> {
  const { id: _, kind: __, ...value } = clip;
  return value;
}
function finish(document: EditorDocument, result: CaptionSentencePlan): CaptionSentencePlan {
  applyEditorOperations(document, result.operations, document.revision);
  return result;
}
export function planCaptionSplit(
  value: EditorDocument,
  sequenceId: string,
  clipId: string,
  options: { caret: number; time?: Tick; idFactory?: () => string },
): CaptionSentencePlan {
  const { document, sequence } = context(value, sequenceId),
    clip = caption(sequence, clipId), caret = options.caret;
  if (!Number.isSafeInteger(caret) || caret <= 0 || caret >= clip.text.length || !graphemeBoundary(clip.text, caret))
    throw new Error("请将光标放在完整字符之间，且两侧都保留字幕文字");
  const leftText = clip.text.slice(0, caret), rightText = clip.text.slice(caret);
  if (!leftText.trim() || !rightText.trim()) throw new Error("分句两侧都必须保留非空文字");
  const offsets = wordOffsets(clip),
    boundary = offsets && wordBoundary(offsets, caret),
    automatic = boundary === undefined ? undefined : clip.words[boundary]!.start;
  const reliable = boundary !== undefined && automatic! > 0 && automatic! < clip.duration &&
    clip.words[boundary - 1]!.end <= automatic!;
  if (options.time === undefined && !reliable)
    throw new Error("光标处没有可靠的真实词边界；请填写片段内部的分割时间，或使用播放头时间，不会按字数估时");
  const time = options.time === undefined ? clip.start + automatic! : assertTick(options.time, "分割时间"),
    local = time - clip.start;
  if (local <= 0 || local >= clip.duration) throw new Error("分割时间必须严格位于这条字幕内部");
  const id = options.idFactory?.() ?? `caption-${randomId()}`;
  if (document.sequences.some((seq) => seq.clips.some((item) => item.id === id))) throw new Error("新字幕 ID 已存在，请重新预览");
  const left = structuredClone(clip), right = structuredClone(clip);
  left.text = leftText;
  left.duration = local;
  right.id = id;
  right.text = rightText;
  right.start = time;
  right.duration = clip.duration - local;
  // Never clamp a word across the chosen edit. Retain only completely proven words on its own side.
  left.words = offsets === undefined ? [] : clip.words
    .filter((word, index) => offsets.ends[index]! <= caret && word.end <= local)
    .map((word) => ({ ...word, text: word.text.trim() }));
  right.words = offsets === undefined ? [] : clip.words
    .filter((word, index) => offsets.starts[index]! >= caret && word.start >= local)
    .map((word) => ({ ...word, text: word.text.trim(), start: word.start - local, end: word.end - local }));
  const complete = [
    !!offsets && clip.words.every((word, index) =>
      offsets.starts[index]! >= caret || (offsets.ends[index]! <= caret && word.end <= local)),
    !!offsets && clip.words.every((word, index) =>
      offsets.ends[index]! <= caret || (offsets.starts[index]! >= caret && word.start >= local)),
  ];
  const notices = [options.time === undefined
    ? "按真实词时间分句，保留精确词时间与原有文字。"
    : "使用手动分割时间；保留能证明归属的完整词时间，不估算或截短词时间。"];
  const dropped = clip.words.length - left.words.length - right.words.length;
  if (dropped) notices.push(`无法证明归属的 ${dropped} 个词时间将清除；需要时请重新对齐声音。`);
  for (const [index, part] of [left, right].entries()) {
    if (part.style.animation === "word-highlight" && (!part.words.length || !complete[index])) part.style.animation = "none";
    if (clip.sourceBinding)
      part.sourceBinding = sliceCaptionBinding(document, sequenceId, clip, part.start, part.start + part.duration);
  }
  if (clip.style.animation === "word-highlight" && [left, right].some((part) => part.style.animation !== "word-highlight"))
    notices.push("缺少完整词时间的分句将关闭逐词高亮，避免显示不完整的对齐结果。");
  return finish(document, {
    sequenceId, affectedIds: [clipId], operations: [
      { type: "clip.update", sequenceId, clipId, patch: patch(left) },
      { type: "clip.add", sequenceId, clip: right },
    ], added: 1, skipped: 0, notices,
  });
}
export function planCaptionMerge(value: EditorDocument, sequenceId: string, clipIds: readonly string[]): CaptionSentencePlan {
  const { document, sequence } = context(value, sequenceId);
  if (clipIds.length !== 2 || new Set(clipIds).size !== 2) throw new Error("请恰好选择相邻的两条字幕进行合并");
  const [left, right] = clipIds.map((id) => caption(sequence, id))
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id)) as [TextClip, TextClip];
  if (left.trackId !== right.trackId) throw new Error("只能合并同一字幕轨的相邻字幕");
  if (left.start + left.duration > right.start) throw new Error("这两条字幕时间重叠，请先调整时间再合并");
  const between = sequence.clips.some((clip) =>
    clip.trackId === left.trackId && clip.id !== left.id && clip.id !== right.id &&
    clip.start < right.start + right.duration && clip.start + clip.duration > left.start);
  if (between) throw new Error("所选字幕之间或合并范围内还有其他片段，请先选择真正相邻的字幕");
  const look = (clip: TextClip) => JSON.stringify([clip.style, clip.transform, clip.color, clip.blendMode, clip.mask ?? null]);
  if (look(left) !== look(right)) throw new Error("这两条字幕样式或画面属性不同，请先统一样式与属性再合并");
  if (left.groupId !== right.groupId || left.linkGroupId !== right.linkGroupId)
    throw new Error("这两条字幕的分组或音画关联不同，请先解除或统一关联再合并");
  if ([left, right].some((clip) => clip.words.length && !wordOffsets(clip)))
    throw new Error("词时间与已保存字幕文字不一致，请先校准或重新对齐字幕后合并");
  const merged = structuredClone(left), offset = right.start - left.start;
  merged.text = `${left.text}\n${right.text}`;
  merged.duration = offset + right.duration;
  merged.words = [
    ...left.words.map((word) => ({ ...word, text: word.text.trim() })),
    ...right.words.map((word) => ({ ...word, text: word.text.trim(), start: word.start + offset, end: word.end + offset })),
  ];
  const notices = ["按时间顺序用换行连接原文字，保留已有真实词时间；可一次撤销。"];
  if (left.sourceBinding || right.sourceBinding) {
    const a = left.sourceBinding, b = right.sourceBinding;
    if (!a || !b || a.clipId !== b.clipId ||
        JSON.stringify(a.provenance?.path ?? []) !== JSON.stringify(b.provenance?.path ?? []) ||
        a.provenance?.assetId !== b.provenance?.assetId || left.start + left.duration !== right.start)
      throw new Error("来源绑定不同或字幕时间不连续；请先解除所选来源绑定，再确认合并");
    const first = sliceCaptionBinding(document, sequenceId, left, left.start, left.start + left.duration),
      last = sliceCaptionBinding(document, sequenceId, right, right.start, right.start + right.duration);
    if (first.sourceEnd !== last.sourceStart || first.provenance?.end !== last.provenance?.start)
      throw new Error("源声音范围不连续；请先解除所选来源绑定，再确认合并");
    merged.sourceBinding = {
      ...first, sourceEnd: last.sourceEnd,
      ...(first.provenance && last.provenance
        ? { provenance: { ...first.provenance, end: last.provenance.end } } : {}),
    };
  }
  if (!left.words.length || !right.words.length) {
    if (merged.style.animation === "word-highlight") merged.style.animation = "none";
    notices.push("部分字幕没有词时间，仅保留已有真实词时间，逐词高亮关闭。没有补造缺失的词时间。");
  }
  if (left.start + left.duration < right.start) notices.push("合并后字幕会覆盖两条字幕之间的空白时间，请检查预览。");
  return finish(document, { sequenceId, affectedIds: [left.id, right.id], operations: [
    { type: "clip.update", sequenceId, clipId: left.id, patch: patch(merged) },
    { type: "clip.remove", sequenceId, clipIds: [right.id] },
  ], added: 0, skipped: 0, notices });
}
