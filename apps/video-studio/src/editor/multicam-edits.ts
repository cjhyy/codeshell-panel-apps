import { randomId } from "../ids.js";
import { createTrack, defaultAudioMix, defaultColorAdjustment, defaultTransform } from "./defaults";
import { applyEditorOperations, type EditorOperation } from "./operations";
import { assertTick, type Tick } from "./time";
import type { EditorDocument, EditorSequence, MulticamClip } from "./types";
import { validateEditorDocument } from "./validation";
import { trimClip } from "./clip-edits";

export interface MulticamAlignmentResult {
  assetId: string;
  /** Source time in this angle = master source time + offset. */
  offset: Tick;
  confidence: number;
  secondPeak: number;
  overlapSeconds: number;
  precisionTicks: 1200;
  reliable: boolean;
  reason?: string;
}
export interface MulticamAlignment {
  documentId: string;
  revision: number;
  documentHash: string;
  referenceAssetId: string;
  results: MulticamAlignmentResult[];
  reused: boolean;
}
export interface MulticamAlignmentOptions {
  windowSeconds: number;
  maxOffsetSeconds: number;
  signal?: AbortSignal;
}
export interface CreateMulticamOptions {
  assetIds: string[];
  at: Tick;
  name: string;
  offsets?: Record<string, Tick>;
  audioAssetId?: string;
  trackId?: string;
  idFactory?: (kind: "clip" | "track" | "angle") => string;
}
function selected(
  doc: EditorDocument,
  sequenceId: string,
  clipId?: string,
): { sequence: EditorSequence; clip?: MulticamClip } {
  const sequence = doc.sequences.find((seq) => seq.id === sequenceId);
  if (!sequence) throw new Error("序列不存在");
  if (clipId === undefined) return { sequence };
  const clip = sequence.clips.find((clip) => clip.id === clipId);
  if (!clip || clip.kind !== "multicam") throw new Error("请选择一个多机位片段");
  if (sequence.tracks.find((track) => track.id === clip.trackId)?.locked)
    throw new Error("多机位片段所在轨道已锁定");
  return { sequence, clip };
}
function finish(document: EditorDocument, operations: EditorOperation[]): EditorOperation[] {
  applyEditorOperations(document, operations, document.revision);
  return structuredClone(operations);
}
export function planCreateMulticam(
  value: EditorDocument,
  sequenceId: string,
  options: CreateMulticamOptions,
): EditorOperation[] {
  const document = validateEditorDocument(value),
    { sequence } = selected(document, sequenceId);
  if (
    !Array.isArray(options.assetIds) ||
    options.assetIds.length < 2 ||
    options.assetIds.length > 32 ||
    new Set(options.assetIds).size !== options.assetIds.length
  )
    throw new Error("多机位需要 2 至 32 个不同视频素材");
  const assets = options.assetIds.map((id) => {
    const asset = document.assets.find((asset) => asset.id === id);
    if (!asset || asset.kind !== "video") throw new Error("多机位须使用工程中的视频素材");
    return asset;
  });
  const offsets = options.offsets ?? {};
  if (
    ![Object.prototype, null].includes(Object.getPrototypeOf(offsets)) ||
    Object.keys(offsets).some((id) => !options.assetIds.includes(id))
  )
    throw new Error("机位偏移包含未知素材");
  for (const offset of Object.values(offsets))
    if (!Number.isSafeInteger(offset) || Math.abs(offset) > 86400 * 240000)
      throw new Error("机位偏移无效");
  assertTick(options.at);
  const used = new Set<string>();
  for (const seq of document.sequences) {
    seq.tracks.forEach((track) => used.add(track.id));
    seq.clips.forEach((clip) => {
      used.add(clip.id);
      if (clip.kind === "multicam") clip.angles.forEach((angle) => used.add(angle.id));
    });
  }
  const id = (kind: "clip" | "track" | "angle") => {
    const result = options.idFactory?.(kind) ?? `${kind}-${randomId()}`;
    if (used.has(result)) throw new Error("多机位对象编号重复");
    used.add(result);
    return result;
  };
  const start = Math.max(0, ...assets.map((asset) => -(offsets[asset.id] ?? 0))),
    end = Math.min(...assets.map((asset) => asset.duration - (offsets[asset.id] ?? 0)));
  if (end <= start) throw new Error("机位没有共同有效的时间范围，请调整同步偏移");
  const angles = assets.map((asset) => ({
    id: id("angle"),
    name: asset.name,
    assetId: asset.id,
    offset: offsets[asset.id] ?? 0,
  }));
  const audio = angles.find((angle) => angle.assetId === (options.audioAssetId ?? assets[0]!.id));
  if (!audio) throw new Error("请选择有效的主声音机位");
  const trackId = options.trackId ?? id("track"),
    ops: EditorOperation[] = [];
  if (options.trackId) {
    if (sequence.tracks.find((track) => track.id === trackId)?.kind !== "video")
      throw new Error("多机位需要画面轨道");
  } else
    ops.push({ type: "track.add", sequenceId, track: createTrack(trackId, "video", options.name) });
  const clip: MulticamClip = {
    id: id("clip"),
    kind: "multicam",
    label: options.name,
    trackId,
    start: options.at,
    duration: end - start,
    angles,
    audioAngleId: audio.id,
    switches: [{ time: 0, angleId: angles[0]!.id }],
    timeMap: {
      points: [
        { time: 0, source: start },
        { time: end - start, source: end },
      ],
    },
    audio: defaultAudioMix(),
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
  };
  ops.push({ type: "clip.add", sequenceId, clip });
  return finish(document, ops);
}
export function planUpdateMulticamAngles(
  value: EditorDocument,
  sequenceId: string,
  clipId: string,
  patch: { angles?: MulticamClip["angles"]; audioAngleId?: string },
  options: { trimToCommonRange?: boolean } = {},
): EditorOperation[] {
  const document = validateEditorDocument(value),
    { clip, sequence } = selected(document, sequenceId, clipId);
  if (
    !patch ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(patch)) ||
    Object.keys(patch).some((key) => !["angles", "audioAngleId"].includes(key))
  )
    throw new Error("机位更新字段无效");
  const operations: EditorOperation[] = [];
  if (options.trimToCommonRange && patch.angles) {
    const sourceStart = clip!.timeMap.points[0]!.source;
    if (clip!.timeMap.points.some((point) => point.source - point.time !== sourceStart))
      throw new Error("变速或倒放机位请先手动裁剪到共同范围，再修改偏移");
    const minimum = Math.max(0, ...patch.angles.map((angle) => -angle.offset)),
      maximum = Math.min(
        ...patch.angles.map((angle) => {
          const asset = document.assets.find((asset) => asset.id === angle.assetId);
          if (!asset || asset.kind !== "video") throw new Error("机位素材无效");
          return asset.duration - angle.offset;
        }),
      );
    const start = Math.max(0, minimum - sourceStart),
      end = Math.min(clip!.duration, maximum - sourceStart);
    if (start >= end) throw new Error("机位没有共同有效的时间范围");
    if (
      (start !== 0 || end !== clip!.duration) &&
      sequence.clips.some(
        (other) =>
          other.id !== clipId &&
          ((clip!.groupId && other.groupId === clip!.groupId) ||
            (clip!.linkGroupId && other.linkGroupId === clip!.linkGroupId)),
      )
    )
      throw new Error("共同范围裁剪会影响分组或链接片段，请先解除分组或链接");
    operations.push(...trimClip(document, sequenceId, clipId, start, end));
  }
  operations.push({ type: "clip.update", sequenceId, clipId, patch: structuredClone(patch) });
  return finish(document, operations);
}
export function planMulticamSwitches(
  value: EditorDocument,
  sequenceId: string,
  clipId: string,
  switches: MulticamClip["switches"],
): EditorOperation[] {
  const document = validateEditorDocument(value);
  selected(document, sequenceId, clipId);
  return finish(document, [
    { type: "clip.update", sequenceId, clipId, patch: { switches: structuredClone(switches) } },
  ]);
}
function compress(switches: MulticamClip["switches"]): MulticamClip["switches"] {
  return switches.filter(
    (item, index) => index === 0 || item.angleId !== switches[index - 1]!.angleId,
  );
}
export function planMulticamCut(
  value: EditorDocument,
  sequenceId: string,
  clipId: string,
  time: Tick,
  angleId: string,
): EditorOperation[] {
  const document = validateEditorDocument(value),
    clip = selected(document, sequenceId, clipId).clip!;
  assertTick(time);
  if (time >= clip.duration) throw new Error("切换点必须位于多机位片段内");
  const switches = clip.switches.filter((item) => item.time !== time);
  switches.push({ time, angleId });
  switches.sort((a, b) => a.time - b.time);
  return planMulticamSwitches(document, sequenceId, clipId, compress(switches));
}
/** Replace only the recorded interval; retain the selected angle after its end until the next existing cut. */
export function planRecordMulticamSwitches(
  value: EditorDocument,
  sequenceId: string,
  clipId: string,
  start: Tick,
  end: Tick,
  cuts: MulticamClip["switches"],
): EditorOperation[] {
  const document = validateEditorDocument(value),
    clip = selected(document, sequenceId, clipId).clip!;
  assertTick(start);
  assertTick(end);
  if (
    start >= end ||
    end > clip.duration ||
    !cuts.length ||
    cuts[0]!.time !== start ||
    cuts.some(
      (cut, i) => cut.time < start || cut.time >= end || (i > 0 && cut.time <= cuts[i - 1]!.time),
    )
  )
    throw new Error("录制切点范围无效，请重新录制");
  return planMulticamSwitches(
    document,
    sequenceId,
    clipId,
    compress([
      ...clip.switches.filter((cut) => cut.time < start),
      ...structuredClone(cuts),
      ...clip.switches.filter((cut) => cut.time >= end),
    ]),
  );
}
