import type { AudioClip } from "../model";
import { isResourceId } from "../external-media";
import { createTrack, defaultAudioMix, defaultColorAdjustment, defaultTransform } from "./defaults";
import { resolveLegacyClipId } from "./legacy-aliases";
import { findFreeTrack } from "./placement";
import { LEGACY_FRAME_TICKS, MAX_LEGACY_FRAME } from "./legacy-time";
import { applyEditorOperations, type EditorOperation } from "./operations";
import { TICKS_PER_SECOND, type Tick, type TimeMap } from "./time";
import type { EditorAsset, EditorDocument, JsonData, MediaClip } from "./types";
import { sequenceDuration, validateEditorDocument } from "./validation";

export interface CanonicalVoiceoverResult {
  asset: EditorAsset;
}
export interface VoiceoverOrigin {
  sequenceId: string;
  revision: number;
}
/** The exact editor clip a regenerated voice replaces, captured when the user chose it. */
export interface VoiceoverReplaceTarget {
  sequenceId: string;
  clipId: string;
  trackId: string;
  assetId: string;
  start: Tick;
  duration: Tick;
  timeMap: TimeMap;
}
export interface VoiceoverPublication {
  jobId: string;
  origin?: VoiceoverOrigin;
  placement?: {
    startFrame: number;
    replaceTarget?: VoiceoverReplaceTarget;
    /** Frame snapshot persisted by earlier versions; resolved through the old clip ID alias. */
    replaceClip?: AudioClip;
  };
}
function audioClipOnTrack(
  doc: EditorDocument,
  sequenceId: string,
  clipId: string | undefined,
): MediaClip | undefined {
  const sequence = doc.sequences.find((s) => s.id === sequenceId),
    clip = sequence?.clips.find((c) => c.id === clipId);
  if (clip?.kind !== "media") return undefined;
  if (sequence!.tracks.find((t) => t.id === clip.trackId)?.kind !== "audio") return undefined;
  if (doc.assets.find((a) => a.id === clip.assetId)?.kind !== "audio") return undefined;
  return clip;
}
/** A sound clip on any audio track of the sequence, as the user selected it in the editor. */
export function captureReplaceTarget(
  doc: EditorDocument,
  sequenceId: string,
  clipId: string,
): VoiceoverReplaceTarget {
  const clip = audioClipOnTrack(doc, sequenceId, clipId);
  if (!clip) throw new Error("请选择音轨上的配音片段");
  assertTrackUnlocked(doc, sequenceId, clip);
  return {
    sequenceId,
    clipId: clip.id,
    trackId: clip.trackId,
    assetId: clip.assetId,
    start: clip.start,
    duration: clip.duration,
    timeMap: structuredClone(clip.timeMap),
  };
}
function assertTrackUnlocked(doc: EditorDocument, sequenceId: string, clip: MediaClip): void {
  if (
    doc.sequences
      .find((s) => s.id === sequenceId)
      ?.tracks.find((t) => t.id === clip.trackId)?.locked
  )
    throw new Error("配音所在轨道已锁定，请先解锁轨道再重新配音");
}
const isNativeTarget = (
  target: VoiceoverReplaceTarget | AudioClip,
): target is VoiceoverReplaceTarget => "clipId" in target;
/** The clip a target names, whether or not it was edited since. */
function targetClip(
  doc: EditorDocument,
  target: VoiceoverReplaceTarget | AudioClip,
  sequenceId: string,
): MediaClip | undefined {
  if (isNativeTarget(target))
    return target.sequenceId === sequenceId
      ? audioClipOnTrack(doc, sequenceId, target.clipId)
      : undefined;
  return audioClipOnTrack(
    doc,
    sequenceId,
    resolveLegacyClipId(doc, sequenceId, "audioClips", target.id),
  );
}
/**
 * The unchanged original clip, or nothing when it was moved, trimmed, re-timed or deleted.
 * Frame snapshots could only be captured from whole-frame, constant-speed clips, so their
 * tick comparison is exact.
 */
export function resolveReplaceTarget(
  doc: EditorDocument,
  target: VoiceoverReplaceTarget | AudioClip,
  sequenceId: string,
): MediaClip | undefined {
  const clip = targetClip(doc, target, sequenceId);
  if (!clip) return undefined;
  if (isNativeTarget(target))
    return clip.trackId === target.trackId &&
      clip.assetId === target.assetId &&
      clip.start === target.start &&
      clip.duration === target.duration &&
      clip.timeMap.points.length === target.timeMap.points.length &&
      clip.timeMap.points.every(
        (point, index) =>
          point.time === target.timeMap.points[index]!.time &&
          point.source === target.timeMap.points[index]!.source,
      )
      ? clip
      : undefined;
  const source = target.inFrame * LEGACY_FRAME_TICKS,
    duration = (target.outFrame - target.inFrame) * LEGACY_FRAME_TICKS,
    points = clip.timeMap.points;
  return clip.assetId === target.assetId &&
    clip.start === target.startFrame * LEGACY_FRAME_TICKS &&
    clip.duration === duration &&
    points.length === 2 &&
    points[0]!.time === 0 &&
    points[0]!.source === source &&
    points[1]!.time === duration &&
    points[1]!.source === source + duration
    ? clip
    : undefined;
}
/**
 * Checked before synthesis is queued: the clip is still exactly where the user chose it in
 * the active sequence. A locked track is reported instead of silently falling back later.
 */
export function verifyReplaceTarget(doc: EditorDocument, target: VoiceoverReplaceTarget): boolean {
  if (target.sequenceId !== doc.activeSequenceId) return false;
  const clip = resolveReplaceTarget(doc, target, target.sequenceId);
  if (!clip) return false;
  assertTrackUnlocked(doc, target.sequenceId, clip);
  return true;
}
/** Native source duration stays in ticks; the old 30 fps view never determines asset length. */
export function canonicalVoiceoverReceipt(raw: unknown): CanonicalVoiceoverResult {
  const data = raw as any,
    asset = data?.asset,
    inspection = data?.inspection;
  if (
    !asset ||
    !isResourceId(asset.id) ||
    !/^asset-[a-f0-9]{64}$/.test(asset.id) ||
    asset.sha256 !== asset.id.slice(6) ||
    !Number.isSafeInteger(asset.bytes) ||
    asset.bytes < 44 ||
    asset.bytes > 20 * 1024 ** 3 ||
    asset.mimeType !== "audio/wav" ||
    typeof asset.name !== "string" ||
    !asset.name.trim() ||
    asset.name.length > 200 ||
    inspection?.kind !== "audio" ||
    !Number.isFinite(inspection.durationSeconds) ||
    inspection.durationSeconds <= 0 ||
    inspection.durationSeconds > 86400 ||
    !data.speech ||
    typeof data.speech.text !== "string" ||
    !data.speech.text.trim()
  )
    throw new Error("配音任务没有返回完整的声音与实际时长");
  const duration = Math.round(inspection.durationSeconds * TICKS_PER_SECOND);
  if (!Number.isSafeInteger(duration) || duration < 1) throw new Error("配音声音时长无效");
  return {
    asset: {
      id: asset.id,
      resourceId: asset.id,
      fingerprint: asset.sha256,
      name: asset.name,
      kind: "audio",
      duration,
      metadata: {
        mimeType: asset.mimeType,
        size: asset.bytes,
        speech: structuredClone(data.speech) as JsonData,
      },
    },
  };
}

/** A legacy production job can publish into v2, but cannot reconstruct or flatten its target. */
export function planPublishVoiceover(
  value: EditorDocument,
  result: CanonicalVoiceoverResult,
  context: VoiceoverPublication,
  idFactory: () => string = () => crypto.randomUUID(),
): { operations: EditorOperation[]; notice: string; placed: boolean } {
  const doc = validateEditorDocument(value),
    supplied = structuredClone(result.asset),
    operations: EditorOperation[] = [];
  if (
    supplied.kind !== "audio" ||
    !isResourceId(supplied.resourceId) ||
    !/^asset-[a-f0-9]{64}$/.test(supplied.resourceId) ||
    supplied.fingerprint !== supplied.resourceId.slice(6)
  )
    throw new Error("配音素材的真实来源无效");
  const collision = doc.assets.find((a) => a.id === supplied.id);
  if (collision && collision.resourceId !== supplied.resourceId)
    throw new Error("配音素材编号已属于其他来源");
  const matches = doc.assets.filter((a) => a.resourceId === supplied.resourceId);
  if (matches.some((a) => a.kind !== "audio" || a.duration !== supplied.duration))
    throw new Error("已有配音素材与任务结果不一致");
  // Identical bytes may come from another recipe or an ordinary import. Keep both recipes
  // rather than overwriting existing instances' metadata or losing the newly generated script.
  const existing = matches.find(
    (a) => JSON.stringify(a.metadata?.speech) === JSON.stringify(supplied.metadata?.speech),
  );
  const asset = existing ?? { ...supplied, id: collision ? idFactory() : supplied.id };
  if (!existing) operations.push({ type: "asset.add", asset });
  const finish = (notice: string, placed = false) => {
    applyEditorOperations(doc, operations, doc.revision);
    return { operations: structuredClone(operations), notice, placed };
  };
  const library = (reason: string) =>
    finish(`${reason}。完整新配音已保存在素材库，当前音轨和字幕保持不变，请试听后选择使用。`);
  if (!context.placement) return finish("完整配音已保存在素材库，可试听后加入时间线。");
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,120}$/.test(context.jobId) ||
    !Number.isSafeInteger(context.placement.startFrame) ||
    context.placement.startFrame < 0 ||
    context.placement.startFrame > MAX_LEGACY_FRAME
  )
    throw new Error("配音任务的原始放置记录无效");
  const origin = context.origin,
    sequence = doc.sequences.find((s) => s.id === origin?.sequenceId),
    marker = `voice-${context.jobId}`;
  // Completion receipts can be replayed after storage succeeded but recording consumption failed.
  const published = doc.sequences
    .flatMap((s) => s.clips)
    .find((c) => c.kind === "media" && c.id === marker && c.assetId === asset.id);
  if (published) return finish("此配音已加入工程，后续剪辑保持完整。", true);
  if (!origin || !Number.isSafeInteger(origin.revision) || origin.revision < 0 || !sequence)
    return library("原始目标序列记录缺失");
  const original = context.placement.replaceTarget ?? context.placement.replaceClip;
  if (original) {
    // A successful same-ID replacement is recognizable even after later user edits.
    if (targetClip(doc, original, sequence.id)?.assetId === asset.id)
      return finish("此配音已替换，后续剪辑保持完整。", true);
    if (doc.revision !== origin.revision) return library("工程在生成期间已修改，未替换原配音");
    const target = resolveReplaceTarget(doc, original, sequence.id);
    if (!target) return library("原配音已移动、裁剪或删除，未自动替换");
    const oldAsset = doc.assets.find((a) => a.id === target.assetId)!;
    if (oldAsset.duration !== asset.duration)
      return library("新配音与原素材时长不同，需重新安排内容");
    if (sequence.tracks.find((t) => t.id === target.trackId)!.locked)
      return library("原配音轨道已锁定");
    if (sequence.transitions.some((t) => t.fromClipId === target.id || t.toClipId === target.id))
      return library("原配音参与转场，需要先审核替换区间");
    const bound = doc.sequences.some((s) =>
      s.clips.some(
        (c) =>
          c.kind === "text" &&
          c.sourceBinding &&
          (c.sourceBinding.clipId === target.id ||
            c.sourceBinding.provenance?.path.includes(target.id)),
      ),
    );
    if (bound) return library("原配音含来源绑定字幕，需审核新声音并重新生成对应字幕");
    // Same source extent and the same clip ID preserve local automation, fades, links and ducking.
    operations.push({
      type: "clip.update",
      sequenceId: sequence.id,
      clipId: target.id,
      patch: { assetId: asset.id },
    });
    return finish(
      "已替换配音，保留原片段的精确时序、音量动画、声像、淡化和关联设置，可整体撤销。",
      true,
    );
  }
  if (doc.revision !== origin.revision) return library("工程在生成期间已修改，未自动放置配音");
  const start = context.placement.startFrame * LEGACY_FRAME_TICKS,
    available = Math.max(0, sequenceDuration(sequence) - start);
  if (!available) return library("原放置位置没有可用的画面时长");
  const duration = Math.min(available, asset.duration),
    track = createTrack(idFactory(), "audio", "生成配音");
  if (doc.sequences.some((s) => s.clips.some((c) => c.id === marker)))
    return library("配音结果编号与现有片段冲突");
  const clip: MediaClip = {
    id: marker,
    kind: "media",
    assetId: asset.id,
    trackId: track.id,
    label: asset.name,
    start,
    duration,
    timeMap: {
      points: [
        { time: 0, source: 0 },
        { time: duration, source: duration },
      ],
    },
    audio: defaultAudioMix(),
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
  };
  operations.push(
    { type: "track.add", sequenceId: sequence.id, track },
    { type: "clip.add", sequenceId: sequence.id, clip },
  );
  return finish(
    duration < asset.duration
      ? "配音已加入原目标序列，超过画面部分保存在完整素材中，请延长画面后使用。"
      : "配音已加入原目标序列，完整素材与文稿已保存，可整体撤销。",
    true,
  );
}

/**
 * A published audio result's placement at an old 30 fps frame, on the editor document: the
 * real sequence length decides how much fits (the 30 fps view may show none of real footage).
 * The job-specific clip ID makes a replayed completion a no-op, keeping later edits.
 */
export function planPublishedAudioPlacement(
  value: EditorDocument,
  sequenceId: string,
  placement: { clipId: string; assetId: string; startFrame: number; volume: number },
  idFactory: (kind: "track") => string = () => `track-${crypto.randomUUID()}`,
): { operations: EditorOperation[]; notice?: string } {
  const doc = validateEditorDocument(value),
    sequence = doc.sequences.find((item) => item.id === sequenceId);
  if (!sequence) throw new Error("配音目标序列不存在");
  const asset = doc.assets.find((item) => item.id === placement.assetId);
  if (!asset || asset.kind !== "audio") throw new Error("配音素材无效");
  const { startFrame, volume } = placement;
  if (!Number.isSafeInteger(startFrame) || startFrame < 0 || startFrame > MAX_LEGACY_FRAME)
    throw new Error("配音位置无效");
  if (!Number.isFinite(volume) || volume < 0 || volume > 2) throw new Error("配音音量无效");
  if (doc.sequences.some((item) => item.clips.some((clip) => clip.id === placement.clipId)))
    return { operations: [] };
  const start = startFrame * LEGACY_FRAME_TICKS,
    available = Math.max(0, sequenceDuration(sequence) - start);
  if (!available)
    return {
      operations: [],
      notice: "完整配音已保存到素材库。请先添加或延长画面，再将配音加入时间轴。",
    };
  const duration = Math.min(asset.duration, available),
    track = findFreeTrack(sequence, "audio", start, duration, idFactory);
  const clip: MediaClip = {
    id: placement.clipId,
    kind: "media",
    assetId: asset.id,
    trackId: track.trackId,
    label: asset.name,
    start,
    duration,
    timeMap: {
      points: [
        { time: 0, source: 0 },
        { time: duration, source: duration },
      ],
    },
    audio: { ...defaultAudioMix(), volume },
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
  };
  const operations: EditorOperation[] = [
    ...track.operations,
    { type: "clip.add", sequenceId, clip },
  ];
  applyEditorOperations(doc, operations, doc.revision);
  const seconds = (tick: number) => (tick / TICKS_PER_SECOND).toFixed(1);
  return {
    operations,
    notice:
      duration < asset.duration
        ? `完整配音 ${seconds(asset.duration)} 秒已保留在素材库；画面只剩 ${seconds(available)} 秒，当前音轨到画面结尾。请延长画面并调整配音出点，避免漏掉句尾。`
        : "配音已加入当前播放位置，完整文案和音频已保存",
  };
}
