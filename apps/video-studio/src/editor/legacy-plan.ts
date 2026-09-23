import { applyOperations, type EditOperation } from "../model";
import { compileEditorSteps } from "./agent-tools";
import { createTrack, defaultAudioMix, defaultColorAdjustment, defaultTransform } from "./defaults";
import {
  applyLegacyProjectChange,
  projectLegacyView,
  type LegacyProjectView,
} from "./legacy-adapter";
import { resolveLegacyClipId, type LegacyCollection } from "./legacy-aliases";
import { LEGACY_FRAME_TICKS, MAX_LEGACY_FRAME } from "./legacy-time";
import { applyEditorOperations, type EditorOperation } from "./operations";
import type { SequenceIdFactory } from "./sequence-edits";
import { freezeTimeMap } from "./time";
import { magneticBlocks, planTimelineArrangement } from "./timing-edits";
import type { EditorClip, EditorDocument, EditorSequence, MediaClip } from "./types";

const F = LEGACY_FRAME_TICKS;
/** Shown when an old plan names a clip the current project cannot identify. */
export const UNMAPPED_LEGACY_CLIP = "在当前工程中无法对应，请使用新版方案格式";
type Operation = Record<string, any>;

function sequenceOf(document: EditorDocument, sequenceId: string): EditorSequence {
  const sequence = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence) throw new Error("方案对应的时间线不存在");
  return sequence;
}
function frame(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_LEGACY_FRAME
  )
    throw new Error(`${label}必须是 0 到 ${MAX_LEGACY_FRAME} 之间的整数帧`);
  return value;
}
function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value))
    throw new Error(`${label}格式不正确`);
  return value;
}
/** The old row an operation refers to, if it edits an existing row. */
function reference(op: Operation): { collection: LegacyCollection; id: string } | undefined {
  if (op.type === "remove-caption") return { collection: "captions", id: op.captionId };
  if (op.type === "caption") return { collection: "captions", id: op.caption?.id };
  if (typeof op.type === "string" && op.type.startsWith("audio-") && op.type !== "audio-add")
    return { collection: "audioClips", id: op.clipId };
  if (["trim", "split", "remove", "move", "video-move", "volume"].includes(op.type))
    return { collection: "clips", id: op.clipId };
  return undefined;
}
/**
 * The canonical clip behind an old ID: first the current 30 fps view, then the saved
 * legacy alias. Main-sequence IDs only resolve to clips on the view's main tracks, so a
 * picture-in-picture or title clip can never stand in for an old main-sequence row.
 */
function find(
  document: EditorDocument,
  view: LegacyProjectView,
  collection: LegacyCollection,
  legacyId: string,
): EditorClip | undefined {
  const sequence = sequenceOf(document, view.sequenceId);
  const mapped = view.clips.find(
    (item) => item.collection === collection && item.legacyId === legacyId,
  )?.clipId;
  if (mapped) return sequence.clips.find((clip) => clip.id === mapped);
  const resolved = resolveLegacyClipId(document, view.sequenceId, collection, legacyId);
  const clip = resolved ? sequence.clips.find((item) => item.id === resolved) : undefined;
  if (
    clip &&
    collection === "clips" &&
    clip.trackId !== view.tracks.primaryVideoTrackId &&
    clip.trackId !== view.tracks.primaryAudioTrackId
  )
    return undefined;
  return clip;
}
function lookup(
  document: EditorDocument,
  view: LegacyProjectView,
  collection: LegacyCollection,
  legacyId: unknown,
): EditorClip {
  const id = identifier(legacyId, collection === "captions" ? "字幕 ID" : "片段 ID");
  const clip = find(document, view, collection, id);
  if (!clip) throw new Error(`方案中的${collection === "captions" ? "字幕" : "片段"}「${id}」${UNMAPPED_LEGACY_CLIP}`);
  return clip;
}
/** Old frames address the source; only plain 1:1 media keeps that meaning. */
function sourceStart(clip: EditorClip, legacyId: string): number {
  if (
    clip.kind !== "media" ||
    clip.timeMap.points.some(
      (point) => point.source - point.time !== clip.timeMap.points[0]!.source,
    )
  )
    throw new Error(
      `片段「${legacyId}」包含变速、倒放或定格，旧方案无法按源素材帧编辑，请使用新版方案格式`,
    );
  return clip.timeMap.points[0]!.source;
}
function volume(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 2)
    throw new Error("音量必须是 0 到 2 之间的数字");
  return value;
}

/** The old model's ID for a new row: `prefix-N`, N starting after the row count. */
function nextId(prefix: string, used: ReadonlySet<string>): string {
  let index = used.size + 1;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}
/** The old main sequence: clips on the view's main picture and main sound tracks, in time order. */
function mainClips(sequence: EditorSequence, view: LegacyProjectView): EditorClip[] {
  return sequence.clips
    .filter(
      (clip) =>
        clip.trackId === view.tracks.primaryVideoTrackId ||
        (!!view.tracks.primaryAudioTrackId && clip.trackId === view.tracks.primaryAudioTrackId),
    )
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}
/** Lay the main clips end to end from zero in the given order, moving each connected group once. */
function packMain(
  document: EditorDocument,
  sequenceId: string,
  order: readonly string[],
): EditorOperation[] {
  const sequence = sequenceOf(document, sequenceId);
  const find = (id: string) => sequence.clips.find((clip) => clip.id === id)!;
  if (
    sequence.transitions.some(
      (item) => order.includes(item.fromClipId) || order.includes(item.toClipId),
    )
  )
    throw new Error("主序列包含转场，旧方案无法重新排列，请使用新版方案格式");
  const targets = new Map<string, number>();
  let cursor = 0;
  for (const id of order) {
    const clip = find(id);
    targets.set(id, cursor - clip.start);
    cursor += clip.duration;
  }
  const moved = new Map<string, number>(),
    operations: EditorOperation[] = [];
  for (const id of order) {
    const delta = targets.get(id)!;
    if (moved.has(id)) {
      if (moved.get(id) !== delta)
        throw new Error("成组或关联的主序列片段无法按旧方案重排，请使用新版方案格式");
      continue;
    }
    const chosen = new Set([id]);
    for (;;) {
      const size = chosen.size;
      const members = sequence.clips.filter((clip) => chosen.has(clip.id));
      const groups = new Set(members.map((clip) => clip.groupId).filter(Boolean));
      const links = new Set(members.map((clip) => clip.linkGroupId).filter(Boolean));
      for (const clip of sequence.clips)
        if ((clip.groupId && groups.has(clip.groupId)) || (clip.linkGroupId && links.has(clip.linkGroupId)))
          chosen.add(clip.id);
      if (chosen.size === size) break;
    }
    for (const member of chosen) {
      if ((targets.get(member) ?? delta) !== delta || (moved.get(member) ?? delta) !== delta)
        throw new Error("成组或关联的主序列片段无法按旧方案重排，请使用新版方案格式");
      moved.set(member, delta);
    }
    if (delta) operations.push({ type: "clip.move", sequenceId, clipIds: [id], delta });
  }
  return operations;
}
function linear(clip: EditorClip | undefined): clip is MediaClip {
  return (
    clip?.kind === "media" &&
    clip.timeMap.points.every((point) => point.source - point.time === clip.timeMap.points[0]!.source)
  );
}
interface Piece {
  /** Offset of the surviving part inside the follower. */
  local: number;
  length: number;
  /** New timeline start of that part. */
  start: number;
}
/**
 * The old sequence carried its captions and independent sound along with the surviving
 * source ranges of the main clips. Reproduce that for the followers the old view shows:
 * each keeps the parts lying over surviving main source, moved to where that source now is.
 */
function rippleFollowers(
  before: EditorDocument,
  after: EditorDocument,
  sequenceId: string,
  mainIds: readonly string[],
  followerIds: readonly string[],
  factory: SequenceIdFactory,
): EditorOperation[] {
  const old = sequenceOf(before, sequenceId),
    next = sequenceOf(after, sequenceId);
  const olds = mainIds.map((id) => old.clips.find((clip) => clip.id === id));
  const news = new Map(next.clips.filter((clip) => mainIds.includes(clip.id)).map((clip) => [clip.id, clip]));
  if (!olds.every(linear) || ![...news.values()].every(linear)) return [];
  let draft = after;
  const operations: EditorOperation[] = [];
  for (const id of followerIds) {
    const original = old.clips.find((clip) => clip.id === id),
      follower = sequenceOf(draft, sequenceId).clips.find((clip) => clip.id === id);
    if (!original || !follower || JSON.stringify(original) !== JSON.stringify(follower)) continue;
    if (follower.kind === "text" && follower.sourceBinding) continue;
    let pieces: Piece[] = [];
    for (const main of olds as MediaClip[]) {
      const moved = news.get(main.id) as MediaClip | undefined;
      if (!moved) continue;
      const from = Math.max(follower.start, main.start),
        to = Math.min(follower.start + follower.duration, main.start + main.duration);
      if (to <= from) continue;
      const source = main.timeMap.points[0]!.source,
        movedSource = moved.timeMap.points[0]!.source;
      const first = Math.max(source + from - main.start, movedSource),
        last = Math.min(source + to - main.start, movedSource + moved.duration);
      if (last <= first)
        continue;
      pieces.push({
        local: main.start + first - source - follower.start,
        length: last - first,
        start: moved.start + first - movedSource,
      });
    }
    pieces.sort((a, b) => a.start - b.start);
    if (
      pieces.length === 1 &&
      pieces[0]!.local === 0 &&
      pieces[0]!.length === follower.duration &&
      pieces[0]!.start === follower.start
    )
      continue;
    let batch: EditorOperation[];
    if (!pieces.length) batch = [{ type: "clip.remove", sequenceId, clipIds: [id] }];
    else if (follower.kind === "text") {
      // Caption parts that meet again become one caption with the same text.
      const groups: Array<{ start: number; end: number; parts: Piece[] }> = [];
      for (const piece of pieces) {
        const last = groups.at(-1);
        if (last && last.end >= piece.start) {
          last.end = Math.max(last.end, piece.start + piece.length);
          last.parts.push(piece);
        } else groups.push({ start: piece.start, end: piece.start + piece.length, parts: [piece] });
      }
      const words = (group: (typeof groups)[number]) =>
        follower.words.flatMap((word) =>
          group.parts.flatMap((part) => {
            const from = Math.max(word.start, part.local),
              to = Math.min(word.end, part.local + part.length);
            return to > from
              ? [
                  {
                    ...word,
                    start: part.start - group.start + from - part.local,
                    end: part.start - group.start + to - part.local,
                  },
                ]
              : [];
          }),
        );
      batch = groups.map((group, index) => {
        const placed = {
          start: group.start,
          duration: group.end - group.start,
          ...(follower.words.length ? { words: words(group) } : {}),
        };
        return index === 0
          ? ({ type: "clip.update", sequenceId, clipId: id, patch: placed } as EditorOperation)
          : ({
              type: "clip.add",
              sequenceId,
              clip: { ...structuredClone(follower), id: factory("clip"), ...placed },
            } as EditorOperation);
      });
    } else {
      // Sound parts join only where both timeline and source continue.
      const merged: Piece[] = [];
      for (const piece of pieces) {
        const last = merged.at(-1);
        if (last && last.start + last.length === piece.start && last.local + last.length === piece.local)
          last.length += piece.length;
        else merged.push({ ...piece });
      }
      pieces = merged;
      const cuts = [
        ...new Set(pieces.flatMap((piece) => [piece.local, piece.local + piece.length])),
      ]
        .filter((cut) => cut > 0 && cut < follower.duration)
        .sort((a, b) => a - b);
      let local = draft;
      batch = [];
      const segments = [{ id, from: 0, to: follower.duration }];
      for (const cut of cuts) {
        const segment = segments.at(-1)!;
        const current = sequenceOf(local, sequenceId).clips.find((clip) => clip.id === segment.id)!;
        const split = compileEditorSteps(
          local,
          [{ kind: "split", sequenceId, clipId: segment.id, time: current.start + cut - segment.from }],
          factory,
        );
        const right = split.find((op) => op.type === "clip.add") as Extract<
          EditorOperation,
          { type: "clip.add" }
        >;
        local = applyEditorOperations(local, split, local.revision);
        batch.push(...split);
        segments.push({ id: right.clip.id, from: cut, to: segment.to });
        segment.to = cut;
      }
      for (const segment of segments) {
        const piece = pieces.find(
          (item) => item.local === segment.from && item.local + item.length === segment.to,
        );
        if (!piece) batch.push({ type: "clip.remove", sequenceId, clipIds: [segment.id] });
        else if (piece.start !== follower.start + segment.from)
          batch.push({
            type: "clip.move",
            sequenceId,
            clipIds: [segment.id],
            delta: piece.start - follower.start - segment.from,
          });
      }
    }
    draft = applyEditorOperations(draft, batch, draft.revision);
    operations.push(...batch);
  }
  return operations;
}

/** Exact old semantics through the 30 fps view: used when that view shows everything, or for additions. */
function viaLegacyView(
  document: EditorDocument,
  sequenceId: string,
  op: EditOperation,
): EditorOperation[] {
  const view = projectLegacyView(document, sequenceId);
  const before = structuredClone(view.project);
  const after = applyOperations(before, [op], before.revision);
  return applyLegacyProjectChange(document, view, before, after, document.revision);
}

function native(
  document: EditorDocument,
  view: LegacyProjectView,
  op: Operation,
  factory: SequenceIdFactory,
): EditorOperation[] {
  const sequenceId = view.sequenceId,
    sequence = sequenceOf(document, sequenceId);
  const steps = (draft: EditorDocument, value: Record<string, unknown>[]) =>
    compileEditorSteps(draft, value, factory);
  const ref = reference(op);
  const target = ref && lookup(document, view, ref.collection, ref.id);
  switch (op.type) {
    case "trim":
    case "audio-trim": {
      const clip = target!,
        source = sourceStart(clip, op.clipId);
      let localStart = frame(op.inFrame, "入点") * F - source,
        localEnd = frame(op.outFrame, "出点") * F - source;
      // Real footage can start or end between old frames; a whole-frame edge within one
      // frame of it means that edge is kept.
      if (Math.abs(localStart) < F) localStart = 0;
      if (Math.abs(localEnd - clip.duration) < F) localEnd = clip.duration;
      if (localStart < 0 || localEnd > clip.duration || localStart >= localEnd)
        throw new Error("此工程只能在片段现有范围内裁剪；延长片段请使用新版方案格式");
      if (localStart === 0 && localEnd === clip.duration) return [];
      // Old independent audio keeps its start when trimmed; main pictures follow the sequence.
      const options = op.type === "audio-trim" ? { ripple: false } : {};
      let draft = document;
      const result: EditorOperation[] = [];
      const run = (batch: EditorOperation[]) => {
        draft = applyEditorOperations(draft, batch, draft.revision);
        result.push(...batch);
      };
      if (localStart > 0)
        run(
          steps(draft, [
            {
              kind: "timing",
              sequenceId,
              clipIds: [clip.id],
              action: { kind: "keep-right", time: clip.start + localStart },
              options,
            },
          ]),
        );
      const current = sequenceOf(draft, sequenceId).clips.find((item) => item.id === clip.id)!;
      if (localEnd - localStart < current.duration)
        run(
          steps(draft, [
            {
              kind: "timing",
              sequenceId,
              clipIds: [clip.id],
              action: { kind: "keep-left", time: current.start + localEnd - localStart },
              options,
            },
          ]),
        );
      const moved = sequenceOf(draft, sequenceId).clips.find((item) => item.id === clip.id)!;
      if (op.type === "audio-trim" && moved.start !== clip.start)
        run(
          steps(draft, [
            {
              kind: "move",
              sequenceId,
              clipIds: [clip.id],
              options: { delta: clip.start - moved.start },
            },
          ]),
        );
      return result;
    }
    case "split":
    case "audio-split": {
      const clip = target!,
        collection = op.type === "split" ? "clips" : "audioClips";
      // The right piece gets the ID the old model would give it, so later operations of
      // the same plan can name it; an ID already taken is recorded as an alias instead.
      const legacyId = nextId(
        collection === "clips" ? "clip" : "audio",
        new Set((view.project[collection] ?? []).map((item) => item.id)),
      );
      const used = new Set(
        document.sequences.flatMap((item) => [
          item.id,
          ...item.tracks.map((track) => track.id),
          ...item.transitions.map((transition) => transition.id),
          ...item.clips.flatMap((value) => [value.id, value.groupId ?? "", value.linkGroupId ?? ""]),
        ]),
      );
      const clipId = used.has(legacyId) ? factory("clip") : legacyId;
      let first = true;
      const operations = compileEditorSteps(
        document,
        [
          {
            kind: "split",
            sequenceId,
            clipId: clip.id,
            time: clip.start + frame(op.atFrame, "切分位置") * F - sourceStart(clip, op.clipId),
          },
        ],
        (kind) => {
          if (kind === "clip" && first) {
            first = false;
            return clipId;
          }
          return factory(kind);
        },
      );
      if (clipId !== legacyId) {
        const production = structuredClone(document.production ?? {});
        production.legacyAliases = [
          ...(Array.isArray(production.legacyAliases) ? production.legacyAliases : []),
          { sequenceId, collection, legacyId, clipId },
        ];
        operations.push({ type: "project.production", data: production });
      }
      return operations;
    }
    case "remove":
    case "audio-remove":
    case "remove-caption":
      return steps(document, [{ kind: "remove", sequenceId, clipIds: [target!.id] }]);
    case "move": {
      if (sequence.timelineMode !== "magnetic")
        throw new Error("自由时间轴请按时间移动片段，或先开启主序列磁性");
      const clip = target!;
      const main = mainClips(sequence, view);
      if (
        typeof op.toIndex !== "number" ||
        !Number.isSafeInteger(op.toIndex) ||
        op.toIndex < 0 ||
        op.toIndex >= main.length
      )
        throw new Error("片段目标位置超出范围");
      if (main.some((item) => item.trackId === view.tracks.primaryAudioTrackId)) {
        // Like the old sequence, pictures and audio-only clips share one order.
        const order = main.map((item) => item.id).filter((id) => id !== clip.id);
        order.splice(op.toIndex, 0, clip.id);
        return order.every((id, index) => id === main[index]!.id)
          ? []
          : packMain(document, sequenceId, order);
      }
      const blocks = magneticBlocks(sequence, clip.trackId);
      const moving = blocks.find((block) => block.clipIds.includes(clip.id))!;
      const remaining = blocks.filter((block) => block !== moving);
      const others = remaining.flatMap((block) => block.clipIds);
      if (op.toIndex > others.length) throw new Error("片段目标位置超出范围");
      const current = remaining
        .filter((block) => block.start < moving.start)
        .flatMap((block) => block.clipIds).length;
      if (current === op.toIndex) return [];
      const desired =
        op.toIndex === 0
          ? remaining[0]!.start
          : remaining.find((block) => block.clipIds.includes(others[op.toIndex - 1]!))!.end;
      return steps(document, [
        { kind: "move", sequenceId, clipIds: [clip.id], options: { delta: desired - moving.start } },
      ]);
    }
    case "video-move":
    case "audio-move": {
      if (op.type === "video-move" && sequence.timelineMode !== "free")
        throw new Error("按时间移动片段需要先关闭主序列磁性");
      const clip = target!,
        delta = frame(op.startFrame, "开始时间") * F - clip.start;
      return delta
        ? steps(document, [{ kind: "move", sequenceId, clipIds: [clip.id], options: { delta } }])
        : [];
    }
    case "volume":
    case "audio-volume": {
      const clip = target!;
      if (!("audio" in clip) || typeof clip.audio.volume !== "number")
        throw new Error("此片段的自动化音量需要在新版属性面板中修改");
      return [
        {
          type: "clip.update",
          sequenceId,
          clipId: clip.id,
          patch: { audio: { ...clip.audio, volume: volume(op.volume) } },
        },
      ];
    }
    case "caption": {
      const clip = target!;
      if (clip.kind !== "text") throw new Error("方案中的字幕已不是字幕片段");
      const caption = op.caption,
        start = frame(caption.startFrame, "字幕开始时间") * F,
        end = frame(caption.endFrame, "字幕结束时间") * F;
      if (typeof caption.text !== "string" || !caption.text.trim() || caption.text.length > 4000)
        throw new Error("字幕必须是非空文本，最多 4000 个字符");
      if (end <= start) throw new Error("字幕结束时间必须晚于开始时间");
      const patch: Record<string, unknown> = {};
      if (caption.text !== clip.text) {
        if (clip.words.length || clip.translation)
          throw new Error("包含逐词时间或翻译的字幕须在字幕页修改内容");
        patch.text = caption.text;
        patch.label = caption.text.replace(/\s+/g, " ").trim().slice(0, 80) || "字幕";
      }
      if (start !== clip.start) patch.start = start;
      if (end - start !== clip.duration) patch.duration = end - start;
      // A retimed caption no longer covers the words it was bound to.
      if (clip.sourceBinding && (patch.start !== undefined || patch.duration !== undefined))
        patch.sourceBinding = null;
      return Object.keys(patch).length
        ? [{ type: "clip.update", sequenceId, clipId: clip.id, patch }]
        : [];
    }
    case "add": {
      const asset = document.assets.find((item) => item.id === identifier(op.assetId, "素材 ID"));
      if (!asset) throw new Error(`素材不存在：${op.assetId}`);
      const trackId =
        asset.kind === "audio" ? view.tracks.primaryAudioTrackId : view.tracks.primaryVideoTrackId;
      const operations: EditorOperation[] = [];
      let track = trackId;
      if (!track) {
        track = factory("track");
        operations.push({
          type: "track.add",
          sequenceId,
          track: createTrack(track, asset.kind === "audio" ? "audio" : "video"),
        });
      }
      const still = asset.kind === "image" && asset.duration === 0;
      const inTick = frame(op.inFrame ?? 0, "入点") * F;
      const outTick =
        op.outFrame === undefined
          ? still
            ? 150 * F
            : asset.duration
          : frame(op.outFrame, "出点") * F;
      if (outTick <= inTick) throw new Error("出点必须晚于入点");
      const duration = outTick - inTick;
      const start = Math.max(
        0,
        ...sequence.clips
          .filter((clip) => clip.trackId === track)
          .map((clip) => clip.start + clip.duration),
      );
      operations.push({
        type: "clip.add",
        sequenceId,
        clip: {
          id: factory("clip"),
          kind: "media",
          label: asset.name,
          trackId: track,
          assetId: asset.id,
          start,
          duration,
          timeMap: still
            ? freezeTimeMap(0, duration)
            : {
                points: [
                  { time: 0, source: inTick },
                  { time: duration, source: outTick },
                ],
              },
          transform: defaultTransform(),
          color: defaultColorAdjustment(),
          blendMode: "normal",
          audio: { ...defaultAudioMix(), volume: 1 },
        },
      });
      return operations;
    }
    default:
      return viaLegacyView(document, sequenceId, op as EditOperation);
  }
}

/**
 * Translate an old frame-based plan into editor operations, one operation at a time
 * against a running draft. While the 30 fps view shows the whole sequence the old
 * semantics are reproduced exactly through that view (including its caption and audio
 * ripple). Otherwise existing clips are edited with the shared timeline planners, so
 * real footage, extra tracks, titles and transitions stay intact; additions and
 * production notes still use the view, which accepts them while incomplete.
 */
export function translateLegacyOperations(
  document: EditorDocument,
  sequenceId: string,
  operations: readonly EditOperation[],
  factory: SequenceIdFactory,
): EditorOperation[] {
  if (!Array.isArray(operations) || operations.length > 1000)
    throw new Error("方案 operations 必须是最多 1000 条操作的数组");
  let draft = document;
  const result: EditorOperation[] = [];
  for (const value of operations) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("编辑操作必须是对象");
    const op = value as Operation;
    const view = projectLegacyView(draft, sequenceId);
    const ref = reference(op);
    const existing =
      ref &&
      (op.type !== "caption" ||
        (typeof ref.id === "string" && !!find(draft, view, ref.collection, ref.id)));
    if (existing) lookup(draft, view, ref.collection, ref.id);
    let batch: EditorOperation[];
    if (view.timelineComplete) batch = viaLegacyView(draft, sequenceId, value);
    else if (op.type === "settings" && op.timelineMode !== undefined) {
      const { timelineMode, ...rest } = op;
      if (!["magnetic", "free"].includes(timelineMode))
        throw new Error("时间轴模式须为 magnetic 或 free");
      batch =
        timelineMode === sequenceOf(draft, sequenceId).timelineMode
          ? []
          : planTimelineArrangement(draft, sequenceId, {
              mode: timelineMode,
              compact: timelineMode === "magnetic",
            });
      if (Object.keys(rest).length > 1) {
        const next = applyEditorOperations(draft, batch, draft.revision);
        batch = [...batch, ...viaLegacyView(next, sequenceId, rest as EditOperation)];
      }
    } else if (
      existing &&
      ["trim", "remove", "move"].includes(op.type) &&
      sequenceOf(draft, sequenceId).timelineMode === "magnetic"
    ) {
      // Main-sequence edits also move what the old sequence moved with them.
      const main = mainClips(sequenceOf(draft, sequenceId), view).map((clip) => clip.id);
      batch = native(draft, view, op, factory);
      let after = applyEditorOperations(draft, batch, draft.revision);
      if (
        op.type !== "move" &&
        sequenceOf(draft, sequenceId).clips.some(
          (clip) => clip.trackId === view.tracks.primaryAudioTrackId,
        )
      ) {
        const alive = new Set(sequenceOf(after, sequenceId).clips.map((clip) => clip.id));
        const packed = packMain(
          after,
          sequenceId,
          main.filter((id) => alive.has(id)),
        );
        after = applyEditorOperations(after, packed, after.revision);
        batch = [...batch, ...packed];
      }
      batch = [
        ...batch,
        ...rippleFollowers(
          draft,
          after,
          sequenceId,
          main,
          view.clips
            .filter((item) => item.collection !== "clips")
            .map((item) => item.clipId),
          factory,
        ),
      ];
    } else if (existing || (op.type === "add" && op.startFrame === undefined))
      batch = native(draft, view, op, factory);
    else batch = viaLegacyView(draft, sequenceId, value);
    if (batch.length) draft = applyEditorOperations(draft, batch, draft.revision);
    result.push(...batch);
  }
  applyEditorOperations(document, result, document.revision);
  return result;
}

const seconds = (frames: number) => (frames / 30).toFixed(2);
/** A short Chinese description of one old plan operation for the review card. */
export function legacyOperationLabel(
  document: EditorDocument,
  sequenceId: string,
  value: EditOperation,
): string {
  const op = value as Operation;
  let named = "片段";
  try {
    const ref = reference(op);
    const view = projectLegacyView(document, sequenceId);
    const clip = ref && typeof ref.id === "string" && find(document, view, ref.collection, ref.id);
    if (clip)
      named =
        clip.label ||
        (clip.kind === "media" && document.assets.find((asset) => asset.id === clip.assetId)?.name) ||
        named;
  } catch {
    /* Labels never block review; translation reports the real problem. */
  }
  switch (op.type) {
    case "trim":
      return `裁剪 ${named} → ${seconds(op.inFrame)}–${seconds(op.outFrame)}s`;
    case "remove":
      return `移除 ${named}`;
    case "split":
      return `切分 ${named} @ ${seconds(op.atFrame)}s`;
    case "move":
      return `移动 ${named} 到第 ${op.toIndex + 1} 位`;
    case "video-move":
      return `移动 ${named} 到 ${seconds(op.startFrame)}s`;
    case "volume":
      return `设置 ${named} 音量 ${Math.round(op.volume * 100)}%`;
    case "caption":
      return `字幕：${op.caption?.text ?? ""}`;
    case "remove-caption":
      return "删除一条字幕";
    case "settings":
      return "更新工程设置";
    case "add":
      return "添加素材到序列";
    case "workflow":
      return "更新制作单";
    case "rough-cuts":
      return `更新素材粗剪清单（${op.cuts?.length ?? 0} 段）`;
    case "audio-add":
      return "添加独立音乐 / 配音轨";
    case "audio-split":
      return `切分音轨 ${named} @ 源素材 ${seconds(op.atFrame)}s`;
    case "audio-trim":
      return `裁剪音轨 ${named} → ${seconds(op.inFrame)}–${seconds(op.outFrame)}s`;
    case "audio-move":
      return `移动音轨 ${named} 到 ${seconds(op.startFrame)}s`;
    case "audio-volume":
      return `设置音轨 ${named} 音量 ${Math.round(op.volume * 100)}%`;
    case "audio-remove":
      return `删除音轨 ${named}`;
    default:
      return "剪辑操作";
  }
}
