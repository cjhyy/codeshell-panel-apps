import {
  applyOperations,
  timelineClips,
  timelineDuration,
  validateProject,
  type EditOperation,
  type Project,
} from "./model";
import type { TranscriptSegment } from "./production";

export interface SpokenSource {
  assetId: string;
  transcript?: readonly TranscriptSegment[];
  /** Real detector intervals, in seconds relative to the original source. */
  silence?: readonly { start: number; end: number }[];
}
export interface SpokenRange {
  track: "main" | "audio";
  clipId: string;
  assetId: string;
  sourceStartFrame: number;
  sourceEndFrame: number;
  timelineStartFrame: number;
  timelineEndFrame: number;
}
export interface SpokenCandidate extends SpokenRange {
  id: string;
  projectId: string;
  baseRevision: number;
  kind: "pause" | "filler" | "repetition";
  precision: "detector" | "word" | "segment";
  text: string;
  reason: string;
  actionable: boolean;
}
export interface SpokenEditPlan {
  projectId: string;
  baseRevision: number;
  title: string;
  operations: EditOperation[];
  removedRanges: SpokenRange[];
  candidateIds: string[];
  removedFrames: number;
}
const FPS = 30;
const MIN_FRAGMENT = 6;
const BREATH_PADDING = 5;
const fillers = new Set(["嗯", "呃", "额", "唔", "um", "uh", "erm", "hmm"]);
const normalize = (text: string) => text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
const validTime = (start: number, end: number) =>
  Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start;
function sourceClips(project: Project) {
  return [
    ...timelineClips(project).map((clip) => ({ ...clip, track: "main" as const })),
    ...(project.audioClips ?? []).map((clip) => ({
      ...clip,
      endFrame: clip.startFrame + clip.outFrame - clip.inFrame,
      track: "audio" as const,
    })),
  ].filter((clip) =>
    project.assets.some(
      (asset) => asset.id === clip.assetId && (asset.kind === "audio" || asset.kind === "video"),
    ),
  );
}
function idOf(value: string) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}
/** Candidates are suggestions only; nothing is selected or edited here. */
export function findSpokenCandidates(
  project: Project,
  sources: readonly SpokenSource[],
): SpokenCandidate[] {
  const current = validateProject(project),
    result: SpokenCandidate[] = [];
  const sourceMap = new Map(sources.map((source) => [source.assetId, source]));
  for (const clip of sourceClips(current)) {
    const source = sourceMap.get(clip.assetId);
    if (!source) continue;
    const add = (
      kind: SpokenCandidate["kind"],
      precision: SpokenCandidate["precision"],
      start: number,
      end: number,
      text: string,
      reason: string,
      actionable = true,
    ) => {
      if (!validTime(start, end)) return;
      const rawStart = Math.ceil(start * FPS),
        rawEnd = Math.floor(end * FPS);
      // A clipped word/sentence is no longer the complete linguistic candidate.
      if (kind !== "pause" && (rawStart < clip.inFrame || rawEnd > clip.outFrame)) return;
      let first = Math.max(clip.inFrame, rawStart),
        last = Math.min(clip.outFrame, rawEnd);
      if (kind === "pause") {
        // At the outer clip edge there is no adjacent spoken syllable to guard.
        // Avoid manufacturing a five-frame silent sliver at the start or end.
        if (first > clip.inFrame) first += BREATH_PADDING;
        if (last < clip.outFrame) last -= BREATH_PADDING;
      }
      if (last - first < (kind === "pause" ? 9 : 3)) return;
      const tiny =
        (first > clip.inFrame && first - clip.inFrame < MIN_FRAGMENT) ||
        (last < clip.outFrame && clip.outFrame - last < MIN_FRAGMENT);
      if (tiny) {
        actionable = false;
        reason += "；删除会留下不足 0.2 秒的片段，请手动调整";
      }
      const range: SpokenRange = {
        track: clip.track,
        clipId: clip.id,
        assetId: clip.assetId,
        sourceStartFrame: first,
        sourceEndFrame: last,
        timelineStartFrame: clip.startFrame + first - clip.inFrame,
        timelineEndFrame: clip.startFrame + last - clip.inFrame,
      };
      const id = `spoken-${idOf(`${clip.track}:${clip.id}:${kind}:${first}:${last}`)}`;
      if (!result.some((item) => item.id === id))
        result.push({
          ...range,
          id,
          projectId: current.id,
          baseRevision: current.revision,
          kind,
          precision,
          text: text.trim(),
          reason,
          actionable,
        });
    };
    for (const interval of source.silence ?? []) {
      if (validTime(interval.start, interval.end) && interval.end - interval.start >= 1.2)
        add(
          "pause",
          "detector",
          interval.start,
          interval.end,
          "长停顿",
          "来自实际静音检测；靠近正文的一侧保留约 0.17 秒换气",
        );
    }
    const segments = [...(source.transcript ?? [])]
      .filter(
        (segment) => validTime(segment.start, segment.end) && typeof segment.text === "string",
      )
      .sort((a, b) => a.start - b.start);
    let previous: TranscriptSegment | undefined;
    for (const segment of segments) {
      const words = (segment.words ?? []).filter(
        (word) =>
          validTime(word.start, word.end) &&
          word.start >= segment.start - 0.1 &&
          word.end <= segment.end + 0.1 &&
          typeof word.text === "string",
      );
      if (words.length) {
        for (const word of words)
          if (fillers.has(normalize(word.text)) && word.end - word.start <= 2)
            add(
              "filler",
              "word",
              word.start,
              word.end,
              word.text,
              "实际词时间戳；口头词可能有语气作用，请先试听",
            );
      } else {
        const plain = normalize(segment.text);
        if (fillers.has(plain))
          add(
            "filler",
            "segment",
            segment.start,
            segment.end,
            segment.text,
            "仅有整段时间戳；这一整段只包含口头词，请先试听",
          );
        else if (
          /(?:^|[\s，,。.!！?？])(?:嗯|呃|额|唔|um|uh|erm|hmm)(?:[\s，,。.!！?？]|$)/iu.test(
            segment.text,
          )
        )
          add(
            "filler",
            "segment",
            segment.start,
            segment.end,
            segment.text,
            "缺少词时间戳，无法只删口头词；仅供定位试听",
            false,
          );
      }
      if (
        previous &&
        segment.start >= previous.end - 0.15 &&
        segment.start - previous.end <= 3 &&
        normalize(segment.text).length >= 4 &&
        normalize(segment.text) === normalize(previous.text)
      )
        add(
          "repetition",
          "segment",
          segment.start,
          segment.end,
          segment.text,
          "相邻两段转写文字相同；可能是强调或识别错误，请试听后决定",
        );
      previous = segment;
    }
  }
  return result.sort(
    (a, b) => a.timelineStartFrame - b.timelineStartFrame || a.id.localeCompare(b.id),
  );
}
function mergeRanges(ranges: readonly { start: number; end: number }[]) {
  const merged: { start: number; end: number }[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}
/** Removing spoken audio also removes the corresponding picture time. The model
 * ripples captions and all independent audio tracks atomically from those cuts. */
export function buildSpokenEditPlan(
  project: Project,
  candidates: readonly SpokenCandidate[],
  selectedIds: readonly string[],
): SpokenEditPlan {
  const original = validateProject(project),
    ids = [...new Set(selectedIds)];
  if (original.timelineMode === "free")
    throw new Error("口播自动删减需要压紧时间轴，请先开启主序列磁性再应用；当前空隙已保留");
  if (!ids.length) throw new Error("请先勾选需要删减的候选");
  const selected = ids.map((id) => {
    const candidate = candidates.find((item) => item.id === id);
    if (!candidate) throw new Error("候选已失效，请重新分析");
    if (candidate.projectId !== original.id || candidate.baseRevision !== original.revision)
      throw new Error("工程已更新，请重新分析口播");
    if (!candidate.actionable) throw new Error("这项候选没有足够精确的时间范围，请手动调整");
    const clip = sourceClips(original).find(
      (item) =>
        item.track === candidate.track &&
        item.id === candidate.clipId &&
        item.assetId === candidate.assetId,
    );
    if (
      !clip ||
      !Number.isSafeInteger(candidate.sourceStartFrame) ||
      !Number.isSafeInteger(candidate.sourceEndFrame) ||
      candidate.sourceStartFrame < clip.inFrame ||
      candidate.sourceEndFrame > clip.outFrame ||
      candidate.sourceEndFrame <= candidate.sourceStartFrame ||
      candidate.timelineStartFrame !==
        clip.startFrame + candidate.sourceStartFrame - clip.inFrame ||
      candidate.timelineEndFrame !== clip.startFrame + candidate.sourceEndFrame - clip.inFrame
    )
      throw new Error("候选源时间映射不正确，请重新分析");
    return candidate;
  });
  const cuts = mergeRanges(
    selected.map((item) => ({ start: item.timelineStartFrame, end: item.timelineEndFrame })),
  );
  const removedFrames = cuts.reduce((sum, range) => sum + range.end - range.start, 0);
  if (removedFrames >= timelineDuration(original))
    throw new Error("不能删除整条视频，请保留至少一个片段");
  let working = original;
  const operations: EditOperation[] = [];
  const apply = (operation: EditOperation) => {
    operations.push(operation);
    if (operations.length > 500) throw new Error("这次删减片段过多，请分批应用");
    working = applyOperations(working, [operation], working.revision);
  };
  // Descending source ranges keep every earlier range attached to its original ID.
  for (const clip of timelineClips(original).reverse()) {
    const ranges = cuts
      .map((range) => ({
        start: Math.max(range.start, clip.startFrame),
        end: Math.min(range.end, clip.endFrame),
      }))
      .filter((range) => range.end > range.start)
      .map((range) => ({
        start: clip.inFrame + range.start - clip.startFrame,
        end: clip.inFrame + range.end - clip.startFrame,
      }));
    let cursor = clip.inFrame;
    for (const range of [...ranges, { start: clip.outFrame, end: clip.outFrame }]) {
      if (range.start > cursor && range.start - cursor < MIN_FRAGMENT)
        throw new Error("这组删减会留下不足 0.2 秒的片段，请减少选项或手动调整");
      cursor = range.end;
    }
    for (const range of ranges.reverse()) {
      const current = working.clips.find((item) => item.id === clip.id)!;
      if (range.start === current.inFrame && range.end === current.outFrame)
        apply({ type: "remove", clipId: current.id });
      else if (range.start === current.inFrame)
        apply({ type: "trim", clipId: current.id, inFrame: range.end, outFrame: current.outFrame });
      else if (range.end === current.outFrame)
        apply({
          type: "trim",
          clipId: current.id,
          inFrame: current.inFrame,
          outFrame: range.start,
        });
      else {
        const known = new Set(working.clips.map((item) => item.id));
        apply({ type: "split", clipId: current.id, atFrame: range.start });
        const middle = working.clips.find((item) => !known.has(item.id))!;
        apply({ type: "split", clipId: middle.id, atFrame: range.end });
        apply({ type: "remove", clipId: middle.id });
      }
    }
  }
  // Validate the exact single-revision patch that the caller will commit.
  const final = applyOperations(original, operations, original.revision);
  if (timelineDuration(original) - timelineDuration(final) !== removedFrames)
    throw new Error("删减时长校验失败，工程未修改");
  return {
    projectId: original.id,
    baseRevision: original.revision,
    title: `口播精剪 · ${selected.length} 项`,
    operations,
    candidateIds: ids,
    removedFrames,
    removedRanges: selected.map(
      ({
        track,
        clipId,
        assetId,
        sourceStartFrame,
        sourceEndFrame,
        timelineStartFrame,
        timelineEndFrame,
      }) => ({
        track,
        clipId,
        assetId,
        sourceStartFrame,
        sourceEndFrame,
        timelineStartFrame,
        timelineEndFrame,
      }),
    ),
  };
}
