import { sourceRangesToTimeline, sourceTimeAt, type TimeRange } from "./time";
import type { EditorClip, EditorDocument, EditorSequence, TextClip } from "./types";
type SourceClip = Extract<EditorClip, { kind: "media" | "sequence" | "multicam" }>;
interface Stage {
  clip: SourceClip;
  sequenceId: string;
}
function route(
  document: EditorDocument,
  sequenceId: string,
  binding: NonNullable<TextClip["sourceBinding"]>,
): { stages: Stage[]; assetId: string; offset: number } | null {
  const sequences = new Map(document.sequences.map((seq) => [seq.id, seq]));
  let seq = sequences.get(sequenceId),
    clip = seq?.clips.find((item) => item.id === binding.clipId);
  const stages: Stage[] = [];
  if (!clip || !("timeMap" in clip)) return null;
  stages.push({ clip, sequenceId });
  for (const id of binding.provenance?.path ?? []) {
    if (clip.kind !== "sequence") return null;
    seq = sequences.get(clip.sequenceId);
    clip = seq?.clips.find((item) => item.id === id);
    if (!seq || !clip || !("timeMap" in clip)) return null;
    stages.push({ clip, sequenceId: seq.id });
  }
  if (clip.kind === "media") return { stages, assetId: clip.assetId, offset: 0 };
  if (clip.kind === "multicam") {
    const angle = clip.angles.find((item) => item.id === clip.audioAngleId);
    return angle ? { stages, assetId: angle.assetId, offset: angle.offset } : null;
  }
  return null;
}
function merge(ranges: TimeRange[]): TimeRange[] {
  if (ranges.length > 100000) throw new Error("嵌套字幕映射过大，请先拆分序列");
  const result: TimeRange[] = [];
  for (const range of ranges.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = result.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else if (range.start < range.end) result.push({ ...range });
  }
  return result;
}
function map(path: NonNullable<ReturnType<typeof route>>, from: number, to: number): TimeRange[] {
  let ranges = [{ start: Math.max(0, from - path.offset), end: Math.max(0, to - path.offset) }];
  for (const stage of path.stages.slice().reverse())
    ranges = merge(
      ranges.flatMap((range) =>
        sourceRangesToTimeline(stage.clip.timeMap, range.start, range.end).map((item) => ({
          start: item.start + stage.clip.start,
          end: item.end + stage.clip.start,
        })),
      ),
    );
  return ranges;
}
function sample(path: NonNullable<ReturnType<typeof route>>, tick: number): number {
  for (const { clip } of path.stages) {
    const local = tick - clip.start;
    if (local < 0 || local > clip.duration) throw new Error("字幕词超出嵌套音源，请先校准字幕");
    tick = sourceTimeAt(clip.timeMap, local);
  }
  return tick + path.offset;
}
const signature = (path: NonNullable<ReturnType<typeof route>>) =>
  JSON.stringify([
    path.assetId,
    path.offset,
    path.stages.map(({ clip, sequenceId }) => [
      sequenceId,
      clip.id,
      clip.start,
      clip.duration,
      clip.timeMap,
    ]),
  ]);
/** Unit-rate wrapper maps are exact integer translations, so collapsing them preserves all ticks, not just sampled endpoints. */
function normalized(path: NonNullable<ReturnType<typeof route>>): string {
  let shift = 0;
  const chain: unknown[] = [];
  for (const { clip } of path.stages) {
    const points = clip.timeMap.points;
    if (
      points.every(
        (point, index) =>
          index === 0 ||
          point.source - points[index - 1]!.source === point.time - points[index - 1]!.time,
      )
    )
      shift += points[0]!.source - clip.start;
    else {
      chain.push({ offset: shift - clip.start, points });
      shift = 0;
    }
  }
  return JSON.stringify({ chain, outputOffset: shift + path.offset });
}
/** Scale every keyframe time in a clip property by a new length. */
export function stretchKeyframes<T>(value: T, oldDuration: number, duration: number): T {
  return stretch(value, oldDuration, duration);
}
function stretch(value: any, oldDuration: number, duration: number): any {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => stretch(item, oldDuration, duration));
  if (Object.hasOwn(value, "keyframes")) {
    const keys = value.keyframes.map((key: any) => ({
      ...key,
      time: Math.round((key.time * duration) / oldDuration),
    }));
    if (new Set(keys.map((key: any) => key.time)).size !== keys.length)
      throw new Error("字幕动画变速后过密，请先调整关键帧");
    return { keyframes: keys };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, stretch(child, oldDuration, duration)]),
  );
}
/** Applied to the transaction draft before validation. Nested source edits cannot leave outer captions stale. */
export function reconcileDependentCaptions(before: EditorDocument, after: EditorDocument): void {
  for (const oldSequence of before.sequences)
    for (const oldCaption of oldSequence.clips) {
      if (oldCaption.kind !== "text" || !oldCaption.sourceBinding?.provenance) continue;
      const nextSequence = after.sequences.find((seq) => seq.id === oldSequence.id);
      const current = nextSequence?.clips.find((clip) => clip.id === oldCaption.id);
      if (
        !nextSequence ||
        !current ||
        current.kind !== "text" ||
        !current.sourceBinding?.provenance
      )
        continue;
      const oldPath = route(before, oldSequence.id, oldCaption.sourceBinding),
        nextPath = route(after, nextSequence.id, current.sourceBinding);
      if (!oldPath) throw new Error("既有字幕音源无效");
      const locked = () => {
        if (nextSequence.tracks.find((track) => track.id === current.trackId)?.locked)
          throw new Error("嵌套来源关联的字幕轨已锁定，请先解锁字幕轨");
      };
      if (!nextPath) {
        locked();
        nextSequence.clips = nextSequence.clips.filter((clip) => clip.id !== current.id);
        continue;
      }
      if (signature(oldPath) === signature(nextPath)) continue;
      if (oldPath.assetId !== nextPath.assetId || oldPath.offset !== nextPath.offset)
        throw new Error("实际字幕音源已变化，请先解除关联字幕或重新生成，不能沿用旧转写");
      locked();
      const sameInner =
        JSON.stringify(oldPath.stages.slice(1).map((stage) => stage.clip)) ===
        JSON.stringify(nextPath.stages.slice(1).map((stage) => stage.clip));
      if (
        sameInner &&
        (current.start !== oldCaption.start || current.duration !== oldCaption.duration)
      )
        continue; // Root split/trim/move planners already update their owned captions atomically.
      const provenance = current.sourceBinding.provenance;
      const oldRanges = map(oldPath, provenance.start, provenance.end),
        newRanges = map(nextPath, provenance.start, provenance.end);
      if (!newRanges.length) {
        nextSequence.clips = nextSequence.clips.filter((clip) => clip.id !== current.id);
        continue;
      }
      const index = oldRanges.findIndex(
        (range) =>
          range.start === oldCaption.start && range.end === oldCaption.start + oldCaption.duration,
      );
      if (index < 0 || newRanges.length !== oldRanges.length)
        throw new Error("嵌套字幕范围已独立调整或分成多段，请先解绑或重新生成");
      const range = newRanges[index]!;
      // Root planners already slice their bound captions. Changing a nested source selection
      // would require splitting outside captions too; reject until the caller explicitly does so.
      const pathRewritten =
        JSON.stringify(oldCaption.sourceBinding.provenance?.path) !==
          JSON.stringify(provenance.path) ||
        oldCaption.sourceBinding.clipId !== current.sourceBinding.clipId;
      const sameOutput =
        oldRanges.length === newRanges.length &&
        oldRanges.every(
          (range, i) => range.start === newRanges[i]!.start && range.end === newRanges[i]!.end,
        );
      const pureWrappers =
        pathRewritten && sameOutput && normalized(oldPath) === normalized(nextPath);
      if (
        provenance.path.length &&
        !pureWrappers &&
        oldPath.stages.some((stage, i) => {
          const old = stage.clip.timeMap.points.map((point) => point.source),
            next = nextPath.stages[i]?.clip.timeMap.points.map((point) => point.source);
          return (
            !next ||
            Math.min(...old) !== Math.min(...next) ||
            Math.max(...old) !== Math.max(...next)
          );
        })
      )
        throw new Error("裁掉嵌套音源会改变外层字幕内容，请先解绑或重新生成外层字幕");
      const duration = range.end - range.start;
      const remapWords = (input: TextClip["words"], originals: TextClip["words"]) =>
        input.map((word, wordIndex) => {
          // Existing planners may already move current; word source always derives from the original caption.
          const original = originals[wordIndex];
          if (!original) throw new Error("同批修改逐字内容和嵌套时间，请分步处理");
          const a = sample(oldPath, oldCaption.start + original.start),
            b = sample(oldPath, oldCaption.start + original.end - 1);
          const mapped = map(nextPath, Math.min(a, b), Math.max(a, b) + 1)
            .map((item) => ({
              start: Math.max(item.start, range.start),
              end: Math.min(item.end, range.end),
            }))
            .filter((item) => item.start < item.end);
          if (mapped.length !== 1) throw new Error("嵌套变速后的词时间不连续，请先解绑或重新生成");
          return {
            ...word,
            start: mapped[0]!.start - range.start,
            end: mapped[0]!.end - range.start,
          };
        });
      const words = remapWords(current.words, oldCaption.words);
      const originalWords = current.translation?.originalWords
        ? remapWords(
            current.translation.originalWords,
            oldCaption.translation?.originalWords ?? oldCaption.words,
          )
        : undefined;
      if (
        [words, originalWords ?? []].some((list) =>
          list.some(
            (word, i) => i > 0 && (word.start < list[i - 1]!.start || word.end < list[i - 1]!.end),
          ),
        )
      )
        throw new Error("倒放改变字幕词顺序，请先解绑或重新生成");
      const updated = stretch(current, current.duration, duration) as TextClip;
      updated.start = range.start;
      updated.duration = duration;
      updated.words = words;
      if (originalWords) updated.translation!.originalWords = originalWords;
      const owner = nextPath.stages[0]!.clip,
        a = sourceTimeAt(owner.timeMap, range.start - owner.start),
        b = sourceTimeAt(owner.timeMap, range.end - 1 - owner.start);
      updated.sourceBinding = {
        ...current.sourceBinding,
        sourceStart: Math.min(a, b),
        sourceEnd: Math.max(a, b) + 1,
      };
      nextSequence.clips[nextSequence.clips.indexOf(current)] = updated;
    }
}
