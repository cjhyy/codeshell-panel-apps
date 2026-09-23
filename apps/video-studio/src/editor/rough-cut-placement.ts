import type { RoughCut } from "../model";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTransform,
} from "./defaults";
import { applyEditorOperations, type EditorOperation } from "./operations";
import { assertTick, constantTimeMap, type Tick } from "./time";
import { isMagneticTrack, magneticBlocks } from "./timing-edits";
import type { EditorDocument, EditorSequence, EditorTrack, MediaClip } from "./types";
import { MAX_EDITOR_TICK, sequenceDuration, validateEditorDocument } from "./validation";

/** Rough-cut markers keep 30 fps source frames; one frame is exactly 8000 ticks. */
const FRAME_TICKS = 8000;
const MAX_CUTS = 1000;
const MAX_CLIPS = 2000;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export type PlacementIdFactory = (kind: "clip" | "track") => string;
export type RoughCutAnchor = "playhead" | "end";
export interface RoughCutPlacementOptions {
  /** Playhead of the target sequence; required for the playhead anchor. */
  at?: Tick;
  anchor?: RoughCutAnchor;
  videoTrackId?: string;
  audioTrackId?: string;
  idFactory: PlacementIdFactory;
}
export interface RoughCutPlacement {
  operations: EditorOperation[];
  /** New clip IDs in cut order. */
  clipIds: string[];
  /** Start of the first new clip. */
  start: Tick;
  /**
   * End of the placed picture run (or of the sound run without picture). Continuing from here as
   * the next playhead keeps consecutive placements in order.
   */
  end: Tick;
}

const overlaps = (sequence: EditorSequence, trackId: string, start: Tick, duration: Tick) =>
  sequence.clips.some(
    (clip) =>
      clip.trackId === trackId &&
      clip.start < start + duration &&
      clip.start + clip.duration > start,
  );
const trackEnd = (sequence: EditorSequence, trackId: string) =>
  sequence.clips
    .filter((clip) => clip.trackId === trackId)
    .reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0);

/** First unlocked track of this kind free over [start, start + duration), else a new track. */
export function findFreeTrack(
  sequence: EditorSequence,
  kind: EditorTrack["kind"],
  start: Tick,
  duration: Tick,
  idFactory: (kind: "track") => string,
): { trackId: string; operations: EditorOperation[] } {
  const track = sequence.tracks.find(
    (item) => item.kind === kind && !item.locked && !overlaps(sequence, item.id, start, duration),
  );
  if (track) return { trackId: track.id, operations: [] };
  const created = createTrack(idFactory("track"), kind);
  return {
    trackId: created.id,
    operations: [{ type: "track.add", sequenceId: sequence.id, track: created }],
  };
}

/** The main picture track: the magnetic track when set, else the first unlocked video track. */
export function mainPictureTrack(sequence: EditorSequence): EditorTrack | undefined {
  const firstFree = () => sequence.tracks.find((item) => item.kind === "video" && !item.locked);
  return sequence.timelineMode === "magnetic"
    ? (sequence.tracks.find((item) => item.id === sequence.magneticTrackId) ?? firstFree())
    : firstFree();
}

/**
 * Default "add to timeline" spot without an explicit drop position: picture continues the main
 * picture track, sound continues the first unlocked audio track. A track is created only when no
 * usable track of that kind exists; a new main picture track goes below every other layer.
 */
export function planAppendPlacement(
  sequence: EditorSequence,
  kind: "video" | "audio",
  idFactory: (kind: "track") => string,
): { trackId: string; start: Tick; operations: EditorOperation[] } {
  const target =
    kind === "video"
      ? mainPictureTrack(sequence)
      : sequence.tracks.find((item) => item.kind === "audio" && !item.locked);
  if (target?.locked) throw new Error("主画面轨道已锁定，请先解锁后再加入");
  if (target?.kind === kind)
    return { trackId: target.id, start: trackEnd(sequence, target.id), operations: [] };
  const created = createTrack(idFactory("track"), kind);
  return {
    trackId: created.id,
    start: 0,
    operations: [
      {
        type: "track.add",
        sequenceId: sequence.id,
        track: created,
        ...(kind === "video" ? { index: 0 } : {}),
      },
    ],
  };
}

const holdsRole = (sequence: EditorSequence, trackId: string, role: "title" | "subtitle") =>
  sequence.clips.some((clip) => clip.trackId === trackId && clip.kind === "text" && clip.role === role);

/**
 * A text track that is visible over every picture: an unlocked text track above all video tracks
 * that is free over [start, start + duration) and holds no subtitles, preferring one that already
 * holds titles; else a new text track on top.
 */
export function planTextPlacement(
  sequence: EditorSequence,
  start: Tick,
  duration: Tick,
  idFactory: (kind: "track") => string,
): { trackId: string; operations: EditorOperation[] } {
  const topPicture = sequence.tracks.reduce(
    (top, item, index) => (item.kind === "video" ? index : top),
    -1,
  );
  const candidates = sequence.tracks.filter(
    (item, index) =>
      index > topPicture &&
      item.kind === "text" &&
      !item.locked &&
      !holdsRole(sequence, item.id, "subtitle") &&
      !overlaps(sequence, item.id, start, duration),
  );
  const track =
    candidates.find((item) => holdsRole(sequence, item.id, "title")) ?? candidates[0];
  if (track) return { trackId: track.id, operations: [] };
  const created = createTrack(idFactory("track"), "text");
  return {
    trackId: created.id,
    operations: [{ type: "track.add", sequenceId: sequence.id, track: created }],
  };
}

interface Resolved {
  cut: RoughCut;
  kind: "video" | "audio";
  assetId: string;
  label: string;
  inTick: Tick;
  outTick: Tick;
  duration: Tick;
}

function resolveCuts(document: EditorDocument, cuts: readonly RoughCut[]): Resolved[] {
  if (!Array.isArray(cuts) || !cuts.length || cuts.length > MAX_CUTS)
    throw new Error(`请选择 1–${MAX_CUTS} 个粗剪片段`);
  const used = new Set<string>();
  const assets = new Map(document.assets.map((asset) => [asset.id, asset]));
  return cuts.map((cut) => {
    if (!cut || typeof cut.id !== "string" || !IDENTIFIER.test(cut.id))
      throw new Error("粗剪片段 ID 格式不正确");
    if (used.has(cut.id)) throw new Error(`粗剪片段 ID 重复：${cut.id}`);
    used.add(cut.id);
    const asset = typeof cut.assetId === "string" ? assets.get(cut.assetId) : undefined;
    if (!asset || (asset.kind !== "video" && asset.kind !== "audio"))
      throw new Error("粗剪只能引用当前工程的视频或音频素材");
    if (!Number.isSafeInteger(asset.duration) || asset.duration <= 0)
      throw new Error(`素材长度尚未确认：${asset.name}`);
    const frames = Math.floor(asset.duration / FRAME_TICKS);
    if (
      !Number.isSafeInteger(cut.inFrame) ||
      !Number.isSafeInteger(cut.outFrame) ||
      cut.inFrame < 0 ||
      cut.outFrame <= cut.inFrame ||
      cut.outFrame > frames
    )
      throw new Error("粗剪范围须为源素材内有效的整数帧，入点须早于出点");
    const inTick = cut.inFrame * FRAME_TICKS;
    // The last whole frame stands for the real end: keep the source's sub-frame tail.
    const outTick = cut.outFrame === frames ? asset.duration : cut.outFrame * FRAME_TICKS;
    return {
      cut,
      kind: asset.kind,
      assetId: asset.id,
      label: asset.name,
      inTick,
      outTick,
      duration: outTick - inTick,
    };
  });
}

function clipOf(item: Resolved, id: string, trackId: string, start: Tick): MediaClip {
  const { duration, timeMap } = constantTimeMap(item.inTick, item.outTick, 1);
  return {
    id,
    kind: "media",
    assetId: item.assetId,
    trackId,
    start,
    duration,
    label: item.label,
    timeMap,
    audio: defaultAudioMix(),
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
  };
}

function explicitTrack(sequence: EditorSequence, id: string | undefined, kind: "video" | "audio") {
  if (id === undefined) return undefined;
  const track = sequence.tracks.find((item) => item.id === id);
  if (!track) throw new Error("目标轨道已不存在");
  if (track.kind !== kind) throw new Error("素材类型与目标轨道不匹配");
  return track;
}

/**
 * Place rough-cut source ranges on one sequence as a single transaction. Picture and sound use
 * separate cursors from the playhead (or the end of their target track), in list order. A
 * magnetic main picture track opens a gap at the nearest block boundary; any other target must be
 * empty over the whole run, otherwise a free (possibly new) track of the same kind is used.
 */
export function planRoughCutPlacement(
  value: EditorDocument,
  sequenceId: string,
  cuts: readonly RoughCut[],
  options: RoughCutPlacementOptions,
): RoughCutPlacement {
  const document = validateEditorDocument(value);
  const sequence = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence) throw new Error("时间线不存在，请刷新后重试");
  if (typeof options?.idFactory !== "function") throw new Error("需要新片段 ID 生成器");
  const anchor = options.anchor ?? "playhead";
  if (anchor !== "playhead" && anchor !== "end") throw new Error("加入位置无效");
  const resolved = resolveCuts(document, cuts);
  if (sequence.clips.length + resolved.length > MAX_CLIPS)
    throw new Error(`加入粗剪片段后超出片段数量上限（${MAX_CLIPS}）`);
  let playhead = 0;
  if (anchor === "playhead") {
    try {
      playhead = assertTick(options.at, "播放头");
    } catch {
      throw new Error("播放头位置无效，请重新定位后再加入");
    }
    // The editor parks a playhead left at the program end on its last tick; that is the end.
    const programEnd = sequenceDuration(sequence);
    if (programEnd > 0 && playhead === programEnd - 1) playhead = programEnd;
  }
  const tooLong = () => new Error("加入粗剪片段后超出时长上限（24 小时）");
  const operations: EditorOperation[] = [];
  const ids = new Map<RoughCut, string>();
  let working = document;
  let snapped: Tick | undefined;

  const video = resolved.filter((item) => item.kind === "video"),
    audio = resolved.filter((item) => item.kind === "audio");
  const total = (items: Resolved[]) => items.reduce((sum, item) => sum + item.duration, 0);
  const place = (items: Resolved[], trackId: string, start: Tick) => {
    let cursor = start;
    const added: EditorOperation[] = [];
    for (const item of items) {
      const id = options.idFactory("clip");
      ids.set(item.cut, id);
      added.push({ type: "clip.add", sequenceId, clip: clipOf(item, id, trackId, cursor) });
      cursor += item.duration;
    }
    if (cursor > MAX_EDITOR_TICK) throw tooLong();
    return added;
  };
  const step = (next: EditorOperation[]) => {
    operations.push(...next);
    working = applyEditorOperations(working, next, working.revision);
  };
  const current = () => working.sequences.find((item) => item.id === sequenceId)!;

  if (video.length) {
    const length = total(video);
    const target =
      explicitTrack(sequence, options.videoTrackId, "video") ?? mainPictureTrack(sequence);
    if (target && target.kind === "video" && isMagneticTrack(sequence, target.id)) {
      if (target.locked) throw new Error("主画面轨道已锁定，请先解锁后再加入");
      if (sequenceDuration(sequence) + length > MAX_EDITOR_TICK) throw tooLong();
      const blocks = magneticBlocks(sequence, target.id);
      let start = trackEnd(sequence, target.id);
      if (anchor === "playhead") {
        const boundaries = [0, ...blocks.flatMap((block) => [block.start, block.end])];
        start = boundaries.reduce(
          (best, boundary) =>
            Math.abs(boundary - playhead) < Math.abs(best - playhead) ? boundary : best,
          boundaries[0]!,
        );
      }
      const later = blocks
        .filter((block) => block.start >= start)
        .flatMap((block) => block.clipIds);
      if (later.length)
        step([{ type: "clip.move", sequenceId, clipIds: later, delta: length }]);
      if (overlaps(current(), target.id, start, length))
        throw new Error("插入位置被跨越的片段占用，请把播放头移到片段交界处");
      step(place(video, target.id, start));
      snapped = start;
    } else {
      // After the whole program, so a free picture never lands under an existing overlay.
      const start = anchor === "end" ? sequenceDuration(sequence) : playhead;
      const chosen =
        target && !target.locked && !overlaps(sequence, target.id, start, length)
          ? { trackId: target.id, operations: [] as EditorOperation[] }
          : findFreeTrack(sequence, "video", start, length, options.idFactory);
      step([...chosen.operations, ...place(video, chosen.trackId, start)]);
    }
  }

  if (audio.length) {
    const length = total(audio),
      sequenceNow = current();
    const target =
      explicitTrack(sequenceNow, options.audioTrackId, "audio") ??
      sequenceNow.tracks.find((item) => item.kind === "audio" && !item.locked);
    // At the end, sound follows the last sound on any track; with an inserted picture it starts
    // where that picture was inserted.
    const soundEnd = sequenceNow.clips
      .filter(
        (clip) => sequenceNow.tracks.find((item) => item.id === clip.trackId)?.kind === "audio",
      )
      .reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0);
    const start = anchor === "end" ? soundEnd : (snapped ?? playhead);
    const chosen =
      target && !target.locked && !overlaps(sequenceNow, target.id, start, length)
        ? { trackId: target.id, operations: [] as EditorOperation[] }
        : findFreeTrack(sequenceNow, "audio", start, length, options.idFactory);
    step([...chosen.operations, ...place(audio, chosen.trackId, start)]);
  }

  // Validate the exact transaction the caller will commit.
  applyEditorOperations(document, operations, document.revision);
  const clipIds = resolved.map((item) => ids.get(item.cut)!);
  const added = new Map(
    operations.flatMap((operation) =>
      operation.type === "clip.add" ? [[operation.clip.id, operation.clip] as const] : [],
    ),
  );
  const run = (video.length ? video : audio).map((item) => added.get(ids.get(item.cut)!)!);
  return {
    operations,
    clipIds,
    start: added.get(clipIds[0]!)!.start,
    end: Math.max(...run.map((clip) => clip.start + clip.duration)),
  };
}
