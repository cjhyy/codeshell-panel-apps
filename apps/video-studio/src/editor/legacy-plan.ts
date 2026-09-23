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
import type { EditorClip, EditorDocument, EditorSequence } from "./types";

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
      const localStart = frame(op.inFrame, "入点") * F - source,
        localEnd = frame(op.outFrame, "出点") * F - source;
      if (localStart < 0 || localEnd > clip.duration || localStart >= localEnd)
        throw new Error("此工程只能在片段现有范围内裁剪；延长片段请使用新版方案格式");
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
      const clip = target!;
      return steps(document, [
        {
          kind: "split",
          sequenceId,
          clipId: clip.id,
          time: clip.start + frame(op.atFrame, "切分位置") * F - sourceStart(clip, op.clipId),
        },
      ]);
    }
    case "remove":
    case "audio-remove":
    case "remove-caption":
      return steps(document, [{ kind: "remove", sequenceId, clipIds: [target!.id] }]);
    case "move": {
      if (sequence.timelineMode !== "magnetic")
        throw new Error("自由时间轴请按时间移动片段，或先开启主序列磁性");
      const clip = target!;
      const blocks = magneticBlocks(sequence, clip.trackId);
      const moving = blocks.find((block) => block.clipIds.includes(clip.id))!;
      const remaining = blocks.filter((block) => block !== moving);
      const others = remaining.flatMap((block) => block.clipIds);
      if (
        typeof op.toIndex !== "number" ||
        !Number.isSafeInteger(op.toIndex) ||
        op.toIndex < 0 ||
        op.toIndex > others.length
      )
        throw new Error("片段目标位置超出范围");
      const current = remaining.filter((block) => block.start < moving.start).flatMap(
        (block) => block.clipIds,
      ).length;
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
        (clip.kind === "media" && document.assets.find((asset) => asset.id === clip.assetId)?.name) ||
        clip.label ||
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
