import { validateProject, type Asset, type Clip, type Project } from "../model";

/** The published 0.5.16 schema stayed at version 1. Keep its reader isolated from the old production UI. */
export interface LegacyMultitrackClip extends Clip {
  trackId: string;
  startFrame: number;
  transform?: { x: number; y: number; scale: number; opacity: number };
}
export interface LegacyMultitrackTrack {
  id: string;
  kind: "video" | "audio";
  name: string;
  muted?: boolean;
  hidden?: boolean;
  locked?: boolean;
}
export interface LegacyMultitrackProject extends Project {
  tracks: LegacyMultitrackTrack[];
  clips: LegacyMultitrackClip[];
  audioClips: LegacyMultitrackClip[];
}
export const LEGACY_MAIN_VIDEO_TRACK = "video-main";
const MAIN_AUDIO = "audio-main";
const MAX_FRAMES = 24 * 60 * 60 * 30;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("旧工程字段须为对象");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error("旧工程字段须为普通对象");
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !descriptor.enumerable || !("value" in descriptor))
      throw new Error("旧工程不能包含访问器或非 JSON 字段");
  }
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`旧工程包含未知字段：${key}`);
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`旧工程列表最多 ${max} 项`);
  return Array.from(value);
}
function number(value: unknown, min: number, max: number, integer = false): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isSafeInteger(value))
  )
    throw new Error(`旧工程数值须在 ${min} 到 ${max} 之间${integer ? "且为整数" : ""}`);
  return value;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value))
    throw new Error("旧工程 ID 无效");
  return value;
}
function text(value: unknown, max: number, multiline = false): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/ : /[\u0000-\u001f]/).test(value)
  )
    throw new Error("旧工程文本无效");
  return value;
}
function unique(values: { id: string }[]): void {
  if (new Set(values.map((value) => value.id)).size !== values.length)
    throw new Error("旧工程 ID 重复");
}
function readTrack(value: unknown): LegacyMultitrackTrack {
  const data = record(value);
  keys(data, ["id", "kind", "name", "muted", "hidden", "locked"]);
  if (data.kind !== "video" && data.kind !== "audio") throw new Error("旧工程轨道类型无效");
  const track: LegacyMultitrackTrack = {
    id: id(data.id),
    kind: data.kind,
    name: text(data.name, 80),
  };
  if (
    (track.id === LEGACY_MAIN_VIDEO_TRACK && track.kind !== "video") ||
    (track.id === MAIN_AUDIO && track.kind !== "audio")
  )
    throw new Error("旧工程主轨道类型不一致");
  for (const field of ["muted", "hidden", "locked"] as const)
    if (data[field] !== undefined) {
      if (typeof data[field] !== "boolean") throw new Error("旧工程轨道状态须为布尔值");
      track[field] = data[field];
    }
  return track;
}
function readClip(
  value: unknown,
  assets: ReadonlyMap<string, Asset>,
  audio: boolean,
): Omit<LegacyMultitrackClip, "trackId" | "startFrame"> & {
  trackId?: string;
  startFrame?: number;
} {
  const data = record(value);
  keys(data, [
    "id",
    "assetId",
    "inFrame",
    "outFrame",
    "volume",
    "startFrame",
    "trackId",
    ...(audio ? [] : ["transform"]),
  ]);
  const assetId = id(data.assetId),
    asset = assets.get(assetId);
  if (!asset) throw new Error("旧工程片段引用不存在的素材");
  if (audio ? !["audio", "video"].includes(asset.kind) : asset.kind === "audio")
    throw new Error("旧工程片段与轨道类型不一致");
  const inFrame = number(data.inFrame, 0, asset.durationFrames - 1, true),
    outFrame = number(data.outFrame, inFrame + 1, asset.durationFrames, true);
  const result = {
    id: id(data.id),
    assetId,
    inFrame,
    outFrame,
    volume: number(data.volume, 0, 2),
    ...(data.trackId !== undefined ? { trackId: id(data.trackId) } : {}),
    ...(audio || data.startFrame !== undefined
      ? { startFrame: number(data.startFrame, 0, MAX_FRAMES - outFrame + inFrame, true) }
      : {}),
  } as ReturnType<typeof readClip>;
  if (data.transform !== undefined) {
    const transform = record(data.transform);
    keys(transform, ["x", "y", "scale", "opacity"]);
    result.transform = {
      x: number(transform.x, -2, 2),
      y: number(transform.y, -2, 2),
      scale: number(transform.scale, 0.05, 4),
      opacity: number(transform.opacity, 0, 1),
    };
  }
  return result;
}

/** Validate the exact published extension; unknown fields are never stripped to make an import succeed. */
export function readLegacyMultitrackProject(value: unknown): LegacyMultitrackProject {
  const data = record(value);
  // The original validator remains the authority for every unchanged root/asset/production field.
  const {
    tracks: rawTracks,
    clips: rawClips,
    audioClips: rawAudio,
    captions: rawCaptions,
    ...common
  } = data;
  const project = validateProject({ ...common, clips: [], audioClips: [], captions: [] });
  const declared = rawTracks === undefined ? [] : list(rawTracks, 24).map(readTrack);
  unique(declared);
  const tracks = (["video", "audio"] as const).flatMap((kind) => {
    const group = declared.filter((track) => track.kind === kind);
    const main = kind === "video" ? LEGACY_MAIN_VIDEO_TRACK : MAIN_AUDIO;
    if (!group.some((track) => track.id === main))
      group.unshift({ id: main, kind, name: kind === "video" ? "主画面" : "音频 1" });
    if (group.length > (kind === "video" ? 8 : 16)) throw new Error("旧工程轨道数量超过范围");
    return group;
  });
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const pictures = list(rawClips, 2000).map((clip) => readClip(clip, assets, false));
  const audio = list(rawAudio === undefined ? [] : rawAudio, 64).map((clip) =>
    readClip(clip, assets, true),
  );
  unique([...pictures, ...audio]);
  // Pre-track legacy files used virtual audio lanes, assigned stably by start time.
  const assignments = new Map<string, string>(),
    ends: number[] = [];
  if (rawTracks === undefined)
    for (const clip of [...audio].sort((a, b) => a.startFrame! - b.startFrame!)) {
      let lane = ends.findIndex((end) => end <= clip.startFrame!);
      if (lane < 0) lane = ends.length;
      ends[lane] = clip.startFrame! + clip.outFrame - clip.inFrame;
      const trackId = lane ? `audio-auto-${lane + 1}` : MAIN_AUDIO;
      assignments.set(clip.id, trackId);
      if (!tracks.some((track) => track.id === trackId))
        tracks.push({ id: trackId, kind: "audio", name: `音频 ${lane + 1}` });
    }
  const cursors = new Map<string, number>();
  const clips = pictures
    .map((clip): LegacyMultitrackClip => {
      const trackId = clip.trackId ?? LEGACY_MAIN_VIDEO_TRACK;
      if (!tracks.some((track) => track.id === trackId && track.kind === "video"))
        throw new Error("旧工程画面轨不存在");
      const magnetic = project.timelineMode !== "free" && trackId === LEGACY_MAIN_VIDEO_TRACK;
      if (magnetic && clip.startFrame !== undefined) throw new Error("磁性主轨不能指定开始时间");
      if (trackId !== LEGACY_MAIN_VIDEO_TRACK && clip.startFrame === undefined)
        throw new Error("叠加轨须明确开始时间");
      const startFrame = clip.startFrame ?? cursors.get(trackId) ?? 0;
      cursors.set(trackId, startFrame + clip.outFrame - clip.inFrame);
      return { ...clip, trackId, startFrame };
    })
    .sort((a, b) => a.startFrame - b.startFrame);
  const audioClips = audio.map((clip): LegacyMultitrackClip => {
    const trackId =
      clip.trackId ?? (rawTracks === undefined ? assignments.get(clip.id)! : MAIN_AUDIO);
    if (!tracks.some((track) => track.id === trackId && track.kind === "audio"))
      throw new Error("旧工程音频轨不存在");
    return { ...clip, trackId, startFrame: clip.startFrame! };
  });
  const laneEnds = new Map<string, number>();
  for (const clip of [...clips, ...audioClips].sort((a, b) => a.startFrame - b.startFrame)) {
    if (clip.startFrame < (laneEnds.get(clip.trackId) ?? 0))
      throw new Error("旧工程同一轨道片段不能重叠");
    laneEnds.set(clip.trackId, clip.startFrame + clip.outFrame - clip.inFrame);
  }
  const duration = number(Math.max(0, ...laneEnds.values()), 0, MAX_FRAMES, true);
  const captions = list(rawCaptions, 10000)
    .map((value) => {
      const caption = record(value);
      keys(caption, ["id", "startFrame", "endFrame", "text"]);
      const startFrame = number(caption.startFrame, 0, Math.max(0, duration - 1), true);
      return {
        id: id(caption.id),
        startFrame,
        endFrame: number(caption.endFrame, startFrame + 1, duration, true),
        text: text(caption.text, 4000, true).replace(/\r\n?/g, "\n"),
      };
    })
    .sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
  unique(captions);
  return { ...project, tracks, clips, audioClips, captions };
}

export function hasLegacyMultitrackFields(value: unknown): boolean {
  const data = record(value);
  return (
    Object.hasOwn(data, "tracks") ||
    [data.clips, data.audioClips].some(
      (values) =>
        Array.isArray(values) &&
        values.some((value) => {
          const clip = record(value);
          return Object.hasOwn(clip, "trackId") || Object.hasOwn(clip, "transform");
        }),
    )
  );
}
