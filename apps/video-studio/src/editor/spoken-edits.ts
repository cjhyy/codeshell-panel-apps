import type { TranscriptSegment } from "../production";
import type { SpokenSource } from "../spoken-edit";
import { splitClip, trimClip, type ClipIdFactory } from "./clip-edits";
import { applyEditorOperations, type EditorClipPatch, type EditorOperation } from "./operations";
import type { SessionIdentity } from "./session";
import {
  assertTick,
  sourceRangesToTimeline,
  TICKS_PER_SECOND,
  type Tick,
  type TimeMap,
  type TimeRange,
} from "./time";
import type { EditorClip, EditorDocument, EditorSequence, TimelineMarker } from "./types";
import { sequenceDuration, validateEditorDocument } from "./validation";

export interface SpokenDetection {
  kind: "pause" | "filler" | "repetition";
  precision: "detector" | "word" | "segment";
  text: string;
  reason: string;
  actionable: boolean;
  /** Actual asset ticks. */
  source: TimeRange;
}
export interface SpokenOccurrence {
  /** The sequence whose timeline `timeline` is expressed in; it contains `ownerClipId`. */
  sequenceId: string;
  ownerClipId: string;
  trackId: string;
  assetId: string;
  /** Asset ticks the owner actually plays for this moment. */
  source: TimeRange;
  timeline: TimeRange[];
  /** Inside a nested sequence or multicam clip: shown for review, trimmed in that sequence. */
  nested: boolean;
}
export interface EditorSpokenCandidate extends Omit<SpokenDetection, "source"> {
  id: string;
  identity: SessionIdentity;
  /** One place, or several contiguous places across edit points of the same recording. */
  occurrences: SpokenOccurrence[];
}
export type SpokenCutScope = "program" | "linked";
export interface SpokenCutOptions {
  /** program: every track loses the moment. linked: only the spoken clips and their linked tracks. */
  scope?: SpokenCutScope;
  idFactory: ClipIdFactory;
  /** Spoken clips; required for the linked scope. */
  ownerClipIds?: readonly string[];
  /** Largest transaction accepted; defaults to 2000 operations. */
  maxOperations?: number;
}
export interface EditorSpokenPlan {
  identity: SessionIdentity;
  sequenceId: string;
  title: string;
  operations: EditorOperation[];
  removed: Tick;
  candidateIds: string[];
}

/** Keeps about 0.17 s of breath next to speech. */
const BREATH_PADDING = 40_000;
/** 0.2 s: shorter leftovers are flashes, not usable pieces. */
const MIN_FRAGMENT = 48_000;
const MIN_PAUSE = 72_000;
const MIN_SPOKEN = 24_000;
const MAX_OPERATIONS = 2000;
const fillers = new Set(["嗯", "呃", "额", "唔", "um", "uh", "erm", "hmm"]);
const normalize = (text: string) => text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
const validTime = (start: number, end: number) =>
  Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start;
const ticks = (seconds: number) => Math.round(seconds * TICKS_PER_SECOND);
function idOf(value: string) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}
function merge(ranges: readonly TimeRange[]): TimeRange[] {
  const merged: TimeRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else if (range.start < range.end) merged.push({ ...range });
  }
  return merged;
}
function played(map: TimeMap): TimeRange {
  const sources = map.points.map((point) => point.source);
  return { start: Math.min(...sources), end: Math.max(...sources) };
}
function intersect(a: TimeRange, b: TimeRange): TimeRange | null {
  const start = Math.max(a.start, b.start),
    end = Math.min(a.end, b.end);
  return start < end ? { start, end } : null;
}
function timelineOf(clip: { start: Tick; timeMap: TimeMap }, source: TimeRange): TimeRange[] {
  return sourceRangesToTimeline(clip.timeMap, source.start, source.end).map((range) => ({
    start: range.start + clip.start,
    end: range.end + clip.start,
  }));
}
const sameIdentity = (a: SessionIdentity | undefined, b: SessionIdentity) =>
  !!a &&
  a.documentId === b.documentId &&
  a.generation === b.generation &&
  a.revision === b.revision;
const end = (clip: EditorClip) => clip.start + clip.duration;
const bound = (clip: EditorClip) => clip.kind === "text" && !!clip.sourceBinding;

/** Pure detection on one asset's analysis. Candidates are suggestions only. */
export function detectSpokenRanges(source: SpokenSource): SpokenDetection[] {
  const result: SpokenDetection[] = [];
  const add = (
    kind: SpokenDetection["kind"],
    precision: SpokenDetection["precision"],
    start: number,
    stop: number,
    text: string,
    reason: string,
    actionable = true,
  ) => {
    if (!validTime(start, stop)) return;
    const range = { start: ticks(start), end: ticks(stop) };
    if (!Number.isSafeInteger(range.end) || range.end <= range.start) return;
    result.push({ kind, precision, text: text.trim(), reason, actionable, source: range });
  };
  for (const interval of source.silence ?? [])
    if (validTime(interval.start, interval.end) && interval.end - interval.start >= 1.2)
      add(
        "pause",
        "detector",
        interval.start,
        interval.end,
        "长停顿",
        "来自实际静音检测；靠近正文的一侧保留约 0.17 秒换气",
      );
  const segments = [...(source.transcript ?? [])]
    .filter((segment) => validTime(segment.start, segment.end) && typeof segment.text === "string")
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
  return result.sort((a, b) => a.source.start - b.source.start || a.source.end - b.source.end);
}

function occurrencesIn(
  document: EditorDocument,
  sequence: EditorSequence,
  assetId: string,
  range: TimeRange,
  depth: number,
): SpokenOccurrence[] {
  const result: SpokenOccurrence[] = [];
  const push = (clip: EditorClip, source: TimeRange, timeline: TimeRange[], nested: boolean) => {
    if (timeline.length)
      result.push({
        sequenceId: sequence.id,
        ownerClipId: clip.id,
        trackId: clip.trackId,
        assetId,
        source,
        timeline,
        nested,
      });
  };
  for (const clip of sequence.clips) {
    if (clip.kind === "media") {
      if (clip.assetId !== assetId) continue;
      const source = intersect(range, played(clip.timeMap));
      if (source) push(clip, source, timelineOf(clip, source), false);
    } else if (clip.kind === "multicam") {
      const angle = clip.angles.find((item) => item.assetId === assetId);
      if (!angle) continue;
      const local = intersect(
        {
          start: Math.max(0, range.start - angle.offset),
          end: Math.max(0, range.end - angle.offset),
        },
        played(clip.timeMap),
      );
      if (local)
        push(
          clip,
          { start: local.start + angle.offset, end: local.end + angle.offset },
          timelineOf(clip, local),
          true,
        );
    } else if (clip.kind === "sequence" && depth < 50) {
      const inner = document.sequences.find((item) => item.id === clip.sequenceId);
      if (!inner) continue;
      const window = played(clip.timeMap);
      for (const found of occurrencesIn(document, inner, assetId, range, depth + 1))
        push(
          clip,
          found.source,
          merge(
            found.timeline.flatMap((part) => {
              const visible = intersect(part, window);
              return visible ? timelineOf(clip, visible) : [];
            }),
          ),
          true,
        );
    }
  }
  return result;
}

/** Every place in the sequence that plays asset ticks `range`, mapped through speed and reverse. */
export function locateSourceRange(
  value: EditorDocument,
  sequenceId: string,
  assetId: string,
  range: TimeRange,
): SpokenOccurrence[] {
  const document = validateEditorDocument(value),
    sequence = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence) throw new Error("时间线不存在，请刷新后重试");
  assertTick(range.start, "源范围入点");
  assertTick(range.end, "源范围出点");
  if (range.end <= range.start) return [];
  return occurrencesIn(document, sequence, assetId, range, 0);
}

/** Removing `timeline` from its owner must not leave a flash shorter than 0.2 s. */
function leavesSliver(clip: EditorClip, timeline: readonly TimeRange[]): boolean {
  let cursor = clip.start;
  for (const range of [...merge(timeline), { start: end(clip), end: end(clip) }]) {
    const piece = Math.min(range.start, end(clip)) - cursor;
    if (piece > 0 && piece < MIN_FRAGMENT) return true;
    cursor = Math.max(cursor, range.end);
  }
  return false;
}
function frameTicks(sequence: EditorSequence): Tick {
  return Math.round(
    (TICKS_PER_SECOND * sequence.frameRate.denominator) / sequence.frameRate.numerator,
  );
}
/**
 * Timeline ticks the owner plays for `source`. Reverse and speed maps can round an edge that
 * reaches the played source boundary one tick inside the clip; such sub-frame remainders snap
 * to the clip edge instead of leaving an invisible sliver.
 */
function mapPart(
  clip: { start: Tick; duration: Tick; timeMap: TimeMap },
  source: TimeRange,
  frame: Tick,
): TimeRange[] {
  const timeline = timelineOf(clip, source);
  const first = timeline[0],
    last = timeline.at(-1);
  if (first && first.start > clip.start && first.start - clip.start < frame)
    first.start = clip.start;
  if (
    last &&
    last.end < clip.start + clip.duration &&
    clip.start + clip.duration - last.end < frame
  )
    last.end = clip.start + clip.duration;
  return timeline;
}
const sourceLength = (parts: readonly SpokenOccurrence[]) =>
  parts.reduce((sum, part) => sum + part.source.end - part.source.start, 0);

export function findEditorSpokenCandidates(
  value: EditorDocument,
  sequenceId: string,
  identity: SessionIdentity,
  sources: readonly SpokenSource[],
): EditorSpokenCandidate[] {
  const document = validateEditorDocument(value),
    sequence = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence) throw new Error("时间线不存在，请刷新后重试");
  const frame = frameTicks(sequence),
    result: EditorSpokenCandidate[] = [];
  for (const source of sources) {
    if (!document.assets.some((asset) => asset.id === source.assetId)) continue;
    for (const detection of detectSpokenRanges(source)) {
      const pause = detection.kind === "pause",
        parts: SpokenOccurrence[] = [];
      for (const occurrence of occurrencesIn(
        document,
        sequence,
        source.assetId,
        detection.source,
        0,
      )) {
        let { start, end: stop } = occurrence.source,
          timeline = occurrence.timeline;
        const clip = sequence.clips.find((item) => item.id === occurrence.ownerClipId)!;
        if (!occurrence.nested && clip.kind === "media") {
          if (pause) {
            // At the outer clip edge there is no adjacent spoken syllable to guard.
            const window = played(clip.timeMap);
            if (start > window.start) start += BREATH_PADDING;
            if (stop < window.end) stop -= BREATH_PADDING;
          }
          if (stop <= start) continue;
          timeline = mapPart(clip, { start, end: stop }, frame);
        }
        if (timeline.length) parts.push({ ...occurrence, source: { start, end: stop }, timeline });
      }
      parts.sort((a, b) => a.timeline[0]!.start - b.timeline[0]!.start);
      // One moment spanning an edit point between clips of the same recording stays one candidate.
      const groups: SpokenOccurrence[][] = [];
      for (const part of parts) {
        const group = groups.at(-1),
          previous = group?.at(-1);
        if (
          previous &&
          previous.timeline.at(-1)!.end === part.timeline[0]!.start &&
          (previous.source.end === part.source.start || previous.source.start === part.source.end)
        )
          group!.push(part);
        else groups.push([part]);
      }
      for (const group of groups) {
        const length = sourceLength(group);
        // A clipped word or sentence is no longer the complete linguistic candidate.
        if (
          !pause &&
          (Math.min(...group.map((part) => part.source.start)) !== detection.source.start ||
            Math.max(...group.map((part) => part.source.end)) !== detection.source.end ||
            length !== detection.source.end - detection.source.start)
        )
          continue;
        if (length < (pause ? MIN_PAUSE : MIN_SPOKEN)) continue;
        let reason = detection.reason,
          actionable = detection.actionable;
        if (group.some((part) => part.nested)) {
          actionable = false;
          reason += "；这段素材在嵌套序列或多机位片段里，请在对应序列内精剪";
        } else if (
          actionable &&
          group.some((part) =>
            leavesSliver(
              sequence.clips.find((clip) => clip.id === part.ownerClipId)!,
              part.timeline,
            ),
          )
        ) {
          actionable = false;
          reason += "；删除会留下不足 0.2 秒的片段，请手动调整";
        }
        const id = `spoken-${idOf(
          `${sequence.id}:${detection.kind}:${group
            .map((part) => `${part.ownerClipId}:${part.source.start}:${part.source.end}`)
            .join(",")}`,
        )}`;
        if (result.some((item) => item.id === id)) continue;
        result.push({
          id,
          identity: { ...identity },
          kind: detection.kind,
          precision: detection.precision,
          text: detection.text,
          reason,
          actionable,
          occurrences: group,
        });
      }
    }
  }
  return result.sort(
    (a, b) =>
      a.occurrences[0]!.timeline[0]!.start - b.occurrences[0]!.timeline[0]!.start ||
      a.id.localeCompare(b.id),
  );
}

function scopeTracks(
  sequence: EditorSequence,
  scope: SpokenCutScope,
  ownerClipIds: readonly string[] | undefined,
): Set<string> {
  if (scope === "program") return new Set(sequence.tracks.map((track) => track.id));
  if (!ownerClipIds?.length) throw new Error("请先选择口播片段");
  const tracks = new Set(
    ownerClipIds.map((id) => {
      const clip = sequence.clips.find((item) => item.id === id);
      if (!clip) throw new Error("口播片段已变化，请重新分析");
      return clip.trackId;
    }),
  );
  // Linked and grouped partners ripple with the spoken clip, and so does everything on their tracks.
  for (;;) {
    const size = tracks.size;
    const members = sequence.clips.filter((clip) => tracks.has(clip.trackId));
    const links = new Set(members.map((clip) => clip.linkGroupId).filter(Boolean));
    const groups = new Set(members.map((clip) => clip.groupId).filter(Boolean));
    for (const clip of sequence.clips)
      if (
        (clip.linkGroupId && links.has(clip.linkGroupId)) ||
        (clip.groupId && groups.has(clip.groupId))
      )
        tracks.add(clip.trackId);
    if (tracks.size === size) return tracks;
  }
}

/** Atomic failures before any edit, in the order a person can fix them. */
function preflight(
  sequence: EditorSequence,
  ranges: readonly TimeRange[],
  inScope: (clip: EditorClip) => boolean,
  scope: SpokenCutScope,
): void {
  const cutting = sequence.clips.filter(
    (clip) =>
      inScope(clip) && ranges.some((range) => clip.start < range.end && end(clip) > range.start),
  );
  const cutIds = new Set(cutting.map((clip) => clip.id));
  if (
    sequence.transitions.some(
      (transition) => cutIds.has(transition.fromClipId) || cutIds.has(transition.toClipId),
    )
  )
    throw new Error("删减位置的片段连接着转场，请先移除转场再应用删减");
  const touched = new Set([
    ...cutIds,
    ...sequence.clips
      .filter((clip) => inScope(clip) && clip.start >= ranges[0]!.end)
      .map((clip) => clip.id),
  ]);
  for (;;) {
    const size = touched.size;
    const members = sequence.clips.filter((clip) => touched.has(clip.id));
    const links = new Set(members.map((clip) => clip.linkGroupId).filter(Boolean));
    const groups = new Set(members.map((clip) => clip.groupId).filter(Boolean));
    for (const clip of sequence.clips)
      if (
        (clip.linkGroupId && links.has(clip.linkGroupId)) ||
        (clip.groupId && groups.has(clip.groupId)) ||
        (clip.kind === "text" && clip.sourceBinding && touched.has(clip.sourceBinding.clipId))
      )
        touched.add(clip.id);
    if (touched.size === size) break;
  }
  for (const clip of sequence.clips.filter((item) => touched.has(item.id))) {
    const track = sequence.tracks.find((item) => item.id === clip.trackId)!;
    if (track.locked)
      throw new Error(
        `轨道“${track.name}”已锁定，请先解锁${scope === "program" ? "，或只删减口播及关联轨" : ""}`,
      );
  }
  for (const clip of cutting)
    if (leavesSliver(clip, ranges))
      throw new Error("这组删减会留下不足 0.2 秒的片段，请减少选项或手动调整");
}

/** Key-order independent comparison of plain document data. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function patchOf(before: object, after: object): Record<string, unknown> {
  const from = before as Record<string, unknown>,
    to = after as Record<string, unknown>,
    patch: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(from), ...Object.keys(to)]))
    if (key !== "id" && key !== "kind" && !same(from[key], to[key]))
      patch[key] = Object.hasOwn(to, key) ? structuredClone(to[key]) : null;
  return patch;
}

/**
 * The smallest transaction taking `before` to `after`: new clips, one patch per changed clip,
 * removals, then one ripple move per distance for clips that only moved. A pure move is used only
 * when everything that clip.move would carry along (groups, links, bound captions) moves by the
 * same distance; the rest are patched.
 */
function diffSequence(before: EditorSequence, after: EditorSequence): EditorOperation[] {
  const sequenceId = before.id,
    operations: EditorOperation[] = [];
  const beforeClips = new Map(before.clips.map((clip) => [clip.id, clip])),
    afterClips = new Map(after.clips.map((clip) => [clip.id, clip]));
  const beforeTransitions = new Map(before.transitions.map((item) => [item.id, item]));
  const afterTransitions = new Map(after.transitions.map((item) => [item.id, item]));
  for (const transition of before.transitions)
    if (!same(transition, afterTransitions.get(transition.id)))
      operations.push({ type: "transition.remove", sequenceId, transitionId: transition.id });
  for (const clip of after.clips)
    if (!beforeClips.has(clip.id))
      operations.push({ type: "clip.add", sequenceId, clip: structuredClone(clip) });
  const shifts = new Map<string, Tick>();
  for (const clip of after.clips) {
    const original = beforeClips.get(clip.id);
    if (original && original.start !== clip.start && same({ ...original, start: clip.start }, clip))
      shifts.set(clip.id, clip.start - original.start);
  }
  const tagged = (key: "linkGroupId" | "groupId") => {
    const map = new Map<string, string[]>();
    for (const clip of after.clips) {
      const tag = clip[key];
      if (tag) map.set(tag, [...(map.get(tag) ?? []), clip.id]);
    }
    return map;
  };
  const links = tagged("linkGroupId"),
    groups = tagged("groupId"),
    captions = new Map<string, string[]>();
  for (const clip of after.clips)
    if (clip.kind === "text" && clip.sourceBinding)
      captions.set(clip.sourceBinding.clipId, [
        ...(captions.get(clip.sourceBinding.clipId) ?? []),
        clip.id,
      ]);
  for (let changed = true; changed;) {
    changed = false;
    for (const [id, delta] of shifts) {
      const clip = afterClips.get(id)!;
      const carried = [
        ...(clip.linkGroupId ? links.get(clip.linkGroupId)! : []),
        ...(clip.groupId ? groups.get(clip.groupId)! : []),
        ...(captions.get(id) ?? []),
        ...(clip.kind === "text" && clip.sourceBinding ? [clip.sourceBinding.clipId] : []),
      ];
      if (carried.some((other) => shifts.get(other) !== delta)) {
        shifts.delete(id);
        changed = true;
      }
    }
  }
  for (const clip of after.clips) {
    const original = beforeClips.get(clip.id);
    if (original && !shifts.has(clip.id) && !same(original, clip))
      operations.push({
        type: "clip.update",
        sequenceId,
        clipId: clip.id,
        patch: patchOf(original, clip) as EditorClipPatch,
      });
  }
  const removed = before.clips.filter((clip) => !afterClips.has(clip.id)).map((clip) => clip.id);
  if (removed.length) operations.push({ type: "clip.remove", sequenceId, clipIds: removed });
  const moves = new Map<Tick, string[]>();
  for (const [id, delta] of shifts) moves.set(delta, [...(moves.get(delta) ?? []), id]);
  for (const [delta, clipIds] of moves)
    operations.push({ type: "clip.move", sequenceId, clipIds, delta });
  for (const transition of after.transitions)
    if (!same(beforeTransitions.get(transition.id), transition))
      operations.push({
        type: "transition.add",
        sequenceId,
        transition: structuredClone(transition),
      });
  const afterMarkers = new Map(after.markers.map((marker) => [marker.id, marker]));
  for (const marker of before.markers) {
    const next = afterMarkers.get(marker.id);
    if (!next) operations.push({ type: "marker.remove", sequenceId, markerId: marker.id });
    else if (!same(marker, next))
      operations.push({
        type: "marker.update",
        sequenceId,
        markerId: marker.id,
        patch: patchOf(marker, next) as Partial<Omit<TimelineMarker, "id">>,
      });
  }
  return operations;
}

/** Temporary input for one clip edit: the clip, its bound captions and nested sources. Never stored. */
function isolated(
  document: EditorDocument,
  working: EditorSequence,
  clips: EditorClip[],
): EditorDocument {
  const ids = new Set([working.id]),
    sequences: EditorSequence[] = [{ ...working, transitions: [], markers: [], clips }];
  for (let index = 0; index < sequences.length; index++)
    for (const clip of sequences[index]!.clips)
      if (clip.kind === "sequence" && !ids.has(clip.sequenceId)) {
        ids.add(clip.sequenceId);
        sequences.push(document.sequences.find((item) => item.id === clip.sequenceId)!);
      }
  return validateEditorDocument({ ...document, activeSequenceId: working.id, sequences });
}

/** Cut `range` out of one clip in the working sequence; bound captions follow through split/trim/remove. */
function cutClip(
  document: EditorDocument,
  working: EditorSequence,
  clipId: string,
  range: TimeRange,
  idFactory: ClipIdFactory,
): void {
  const sequenceId = working.id,
    clip = working.clips.find((item) => item.id === clipId)!;
  const included = [
    clip,
    ...working.clips.filter(
      (item) => item.kind === "text" && item.sourceBinding?.clipId === clip.id,
    ),
  ];
  let input = isolated(document, working, included);
  const run = (operations: EditorOperation[]) => {
    input = applyEditorOperations(input, operations, input.revision);
  };
  const from = Math.max(range.start, clip.start) - clip.start,
    to = Math.min(range.end, end(clip)) - clip.start;
  if (from === 0 && to === clip.duration)
    run([{ type: "clip.remove", sequenceId, clipIds: [clipId] }]);
  else if (from === 0) run(trimClip(input, sequenceId, clipId, to, clip.duration));
  else if (to === clip.duration) run(trimClip(input, sequenceId, clipId, 0, from));
  else {
    const split = splitClip(input, sequenceId, clipId, range.start, idFactory);
    const added = split.find((operation) => operation.type === "clip.add");
    if (added?.type !== "clip.add") throw new Error("切分结果无效，工程未修改");
    run(split);
    run(trimClip(input, sequenceId, added.clip.id, range.end - range.start, added.clip.duration));
  }
  const edited = input.sequences.find((item) => item.id === sequenceId)!.clips,
    byId = new Map(edited.map((item) => [item.id, item])),
    known = new Set(included.map((item) => item.id));
  // Kept clips stay in place and new pieces are appended, matching how the transaction applies.
  working.clips = working.clips.flatMap((item) =>
    !known.has(item.id) ? [item] : byId.has(item.id) ? [byId.get(item.id)!] : [],
  );
  for (const item of edited) if (!known.has(item.id)) working.clips.push(item);
}

/**
 * Remove timeline moments from one sequence: cut every scoped clip at the moments, then close each
 * gap by moving later scoped clips left. Free-mode gaps elsewhere are kept. Bound subtitles follow
 * their owners through split, trim, remove and move. Cuts are computed moment by moment on a
 * working copy; the result is one compact transaction from the original to the final state.
 */
export function planSpokenCuts(
  value: EditorDocument,
  sequenceId: string,
  timelineRanges: readonly TimeRange[],
  options: SpokenCutOptions,
): { operations: EditorOperation[]; removed: Tick } {
  const original = validateEditorDocument(value),
    sequence = original.sequences.find((item) => item.id === sequenceId);
  if (!sequence) throw new Error("时间线不存在，请刷新后重试");
  if (typeof options?.idFactory !== "function") throw new Error("需要新片段 ID 生成器");
  const scope = options.scope ?? "program";
  if (scope !== "program" && scope !== "linked") throw new Error("删减范围无效");
  const limit = options.maxOperations ?? MAX_OPERATIONS;
  if (!Array.isArray(timelineRanges)) throw new Error("删减时间无效");
  for (const range of timelineRanges) {
    assertTick(range?.start, "删减入点");
    assertTick(range?.end, "删减出点");
    if (range.end <= range.start) throw new Error("删减时间必须具有正时长");
  }
  const ranges = merge(timelineRanges);
  if (!ranges.length) throw new Error("请先勾选需要删减的候选");
  const total = sequenceDuration(sequence),
    removed = ranges.reduce((sum, range) => sum + range.end - range.start, 0);
  if (removed >= total) throw new Error("不能删除整条视频，请保留至少一个片段");
  if (ranges.at(-1)!.end > total) throw new Error("删减时间超出时间线，请重新分析");
  const tracks = scopeTracks(sequence, scope, options.ownerClipIds);
  const inScope = (clip: EditorClip) => tracks.has(clip.trackId) && !bound(clip);
  preflight(sequence, ranges, inScope, scope);

  const working = structuredClone(sequence),
    issued = new Set<string>();
  const taken = (item: EditorSequence, id: string) =>
    item.id === id ||
    item.tracks.some((track) => track.id === id) ||
    item.transitions.some((transition) => transition.id === id) ||
    item.clips.some((clip) => clip.id === id || clip.groupId === id || clip.linkGroupId === id);
  const fresh: ClipIdFactory = (kind) => {
    const id = options.idFactory(kind);
    if (
      typeof id !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id) ||
      issued.has(id) ||
      taken(working, id) ||
      original.sequences.some((item) => taken(item, id))
    )
      throw new Error("新片段或分组 ID 无效或已存在，请重新操作");
    issued.add(id);
    return id;
  };
  // Latest first: earlier moments keep their original timeline positions.
  for (const range of [...ranges].reverse()) {
    const length = range.end - range.start;
    const cutting = working.clips.filter(
      (clip) => inScope(clip) && clip.start < range.end && end(clip) > range.start,
    );
    const touched = {
      linkGroupId: new Set(cutting.map((clip) => clip.linkGroupId).filter(Boolean)),
      groupId: new Set(cutting.map((clip) => clip.groupId).filter(Boolean)),
    };
    for (const { id } of cutting) cutClip(original, working, id, range, fresh);
    const later = working.clips.filter((clip) => inScope(clip) && clip.start >= range.end);
    const moving = new Set(later.map((clip) => clip.id));
    for (const key of ["linkGroupId", "groupId"] as const)
      for (const tag of new Set(later.map((clip) => clip[key]).filter(Boolean))) {
        const members = working.clips.filter((clip) => clip[key] === tag);
        if (members.every((clip) => moving.has(clip.id))) continue;
        // A pair or group cut together keeps its left halves and joins its right halves anew.
        if (!touched[key].has(tag))
          throw new Error(
            key === "linkGroupId"
              ? "关联片段跨越删减位置，请先取消关联或手动调整"
              : "成组片段跨越删减位置，请先取消编组再删减",
          );
        const next = fresh(key === "linkGroupId" ? "link" : "group");
        for (const clip of members) if (moving.has(clip.id)) clip[key] = next;
      }
    const shifted = new Set(moving);
    for (const clip of working.clips)
      if (clip.kind === "text" && clip.sourceBinding && moving.has(clip.sourceBinding.clipId))
        shifted.add(clip.id);
    for (const clip of working.clips) if (shifted.has(clip.id)) clip.start -= length;
    for (const transition of working.transitions) {
      const from = shifted.has(transition.fromClipId);
      if (from !== shifted.has(transition.toClipId))
        throw new Error("删减会改变转场两端的相对位置，请先移除转场再应用删减");
      if (from) transition.start -= length;
    }
    if (scope === "program")
      working.markers = working.markers.flatMap((marker) => {
        const markerEnd = marker.time + marker.duration;
        if (marker.time >= range.end) return [{ ...marker, time: marker.time - length }];
        if (marker.time > range.start)
          return markerEnd > range.end
            ? [{ ...marker, time: range.start, duration: markerEnd - range.end }]
            : [];
        if (markerEnd > range.start)
          return [
            {
              ...marker,
              duration: marker.duration - (Math.min(markerEnd, range.end) - range.start),
            },
          ];
        return [marker];
      });
  }
  const operations = diffSequence(sequence, working);
  if (operations.length > limit) throw new Error("这次删减片段过多，请分批应用");
  // Validate the exact single-revision patch that the caller will commit.
  const final = applyEditorOperations(original, operations, original.revision),
    result = final.sequences.find((item) => item.id === sequenceId)!;
  const comparable = (item: EditorSequence) => ({
    ...item,
    transitions: [...item.transitions].sort((a, b) => a.id.localeCompare(b.id)),
  });
  if (!same(comparable(result), comparable(working)))
    throw new Error("删减结果校验失败，工程未修改");
  const extent = (item: EditorSequence) =>
    scope === "program"
      ? sequenceDuration(item)
      : item.clips.filter(inScope).reduce((last, clip) => Math.max(last, end(clip)), 0);
  if (extent(sequence) - extent(result) !== removed)
    throw new Error("删减时长校验失败，工程未修改");
  return { operations, removed };
}

export function planEditorSpokenEdit(
  value: EditorDocument,
  identity: SessionIdentity,
  candidates: readonly EditorSpokenCandidate[],
  selectedIds: readonly string[],
  options: { scope?: SpokenCutScope; idFactory: ClipIdFactory },
): EditorSpokenPlan {
  const document = validateEditorDocument(value);
  if (!identity || document.id !== identity.documentId || document.revision !== identity.revision)
    throw new Error("工程已更新，请重新分析口播");
  const ids = [...new Set(selectedIds)];
  if (!ids.length) throw new Error("请先勾选需要删减的候选");
  const selected = ids.map((id) => {
    const candidate = candidates.find((item) => item.id === id);
    if (!candidate) throw new Error("候选已失效，请重新分析");
    if (!sameIdentity(candidate.identity, identity)) throw new Error("工程已更新，请重新分析口播");
    if (!candidate.actionable) throw new Error("这项候选没有足够精确的时间范围，请手动调整");
    if (!Array.isArray(candidate.occurrences) || !candidate.occurrences.length)
      throw new Error("候选源时间映射不正确，请重新分析");
    return candidate;
  });
  const occurrences = selected.flatMap((candidate) => candidate.occurrences);
  const sequenceId = occurrences[0]!.sequenceId;
  if (occurrences.some((occurrence) => occurrence.sequenceId !== sequenceId))
    throw new Error("候选来自不同时间线，请重新分析口播");
  const sequence = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence) throw new Error("时间线已变化，请重新分析口播");
  const frame = frameTicks(sequence);
  for (const occurrence of occurrences) {
    const clip = sequence.clips.find((item) => item.id === occurrence.ownerClipId);
    const window = clip?.kind === "media" ? played(clip.timeMap) : undefined;
    if (
      !clip ||
      clip.kind !== "media" ||
      !window ||
      occurrence.nested ||
      clip.assetId !== occurrence.assetId ||
      clip.trackId !== occurrence.trackId ||
      !Number.isSafeInteger(occurrence.source?.start) ||
      !Number.isSafeInteger(occurrence.source?.end) ||
      occurrence.source.start < window.start ||
      occurrence.source.end > window.end ||
      occurrence.source.end <= occurrence.source.start ||
      !same(mapPart(clip, occurrence.source, frame), occurrence.timeline)
    )
      throw new Error("候选源时间映射不正确，请重新分析");
  }
  const { operations, removed } = planSpokenCuts(
    document,
    sequenceId,
    occurrences.flatMap((occurrence) => occurrence.timeline),
    {
      scope: options?.scope ?? "program",
      idFactory: options?.idFactory,
      ownerClipIds: [...new Set(occurrences.map((occurrence) => occurrence.ownerClipId))],
    },
  );
  return {
    identity: { ...identity },
    sequenceId,
    title: `口播精剪 · ${selected.length} 项`,
    operations,
    removed,
    candidateIds: ids,
  };
}
