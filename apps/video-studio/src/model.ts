import { randomId } from "./ids.js";
import { validateVideoWorkflow, type VideoWorkflow } from "./workflow";
import { validateNarration, type NarrationState } from "./narration";
import { validateRoughCuts } from "./rough-cut";
import { isResourceId } from "./external-media";

/**
 * A portable, frame-based edit decision list. Source media stays outside the project.
 * Ranges are half open: [inFrame, outFrame) and [startFrame, endFrame).
 */
export interface Asset {
  id: string;
  name: string;
  kind: "video" | "audio" | "image" | "demo";
  durationFrames: number;
  width?: number;
  height?: number;
  size?: number;
  lastModified?: number;
  /** Selected-folder relative path for display and repeated batch imports; never an authority. */
  sourcePath?: string;
  mimeType?: string;
  mediaId?: string;
  proxyId?: string;
  thumbnailId?: string;
  scene?: HyperframesScene;
  speech?: SynthesizedSpeech;
}

export interface SynthesizedSpeech {
  text: string;
  voiceId: string;
  engine: string;
  modelId?: string;
  instructions?: string;
  referenceAssetId?: string;
  referenceText?: string;
  rate: number;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Reproducible scene data only; Host paths and executables never enter a project. */
export interface HyperframesScene {
  kind: "hyperframes";
  sourceHash: string;
  params: { [key: string]: JsonValue };
}

export interface Clip {
  id: string;
  assetId: string;
  inFrame: number;
  outFrame: number;
  volume: number;
  /** Explicit placement in a free timeline; omitted on legacy magnetic sequences. */
  startFrame?: number;
}

export interface TimelineClip extends Clip {
  startFrame: number;
  endFrame: number;
}

export interface AudioClip extends Clip {
  startFrame: number;
}

export interface Caption {
  id: string;
  startFrame: number;
  endFrame: number;
  text: string;
}

export type CaptionStyle = "classic" | "bold" | "minimal";
export type TimelineMode = "magnetic" | "free";

/** Half-open source ranges retained during rough cutting, independent of the final timeline. */
export interface RoughCut {
  id: string;
  assetId: string;
  inFrame: number;
  outFrame: number;
  name: string;
  enabled: boolean;
}

export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  revision: number;
  width: number;
  height: number;
  fps: 30;
  assets: Asset[];
  clips: Clip[];
  /** Omitted version 1 projects retain the original contiguous magnetic sequence. */
  timelineMode?: TimelineMode;
  /** Optional on legacy version 1 files; validation normalizes this to an array. */
  audioClips?: AudioClip[];
  captions: Caption[];
  /** Omitted legacy projects retain the classic black-backed white subtitles. */
  captionStyle?: CaptionStyle;
  script?: string;
  /** A production plan, separate from executed edits and rendered results. */
  workflow?: VideoWorkflow;
  /** User-reviewed draft and the original recording selected for its final narration. */
  narration?: NarrationState;
  roughCuts?: RoughCut[];
}

export type EditOperation =
  | { type: "trim"; clipId: string; inFrame: number; outFrame: number }
  | { type: "split"; clipId: string; atFrame: number }
  | { type: "remove"; clipId: string }
  | { type: "move"; clipId: string; toIndex: number }
  | { type: "video-move"; clipId: string; startFrame: number }
  | { type: "volume"; clipId: string; volume: number }
  | { type: "add"; assetId: string; inFrame?: number; outFrame?: number; startFrame?: number }
  | {
      type: "audio-add";
      assetId: string;
      startFrame?: number;
      inFrame?: number;
      outFrame?: number;
      volume?: number;
    }
  | { type: "audio-trim"; clipId: string; inFrame: number; outFrame: number }
  | { type: "audio-split"; clipId: string; atFrame: number }
  | { type: "audio-move"; clipId: string; startFrame: number }
  | { type: "audio-volume"; clipId: string; volume: number }
  | { type: "audio-remove"; clipId: string }
  | { type: "caption"; caption: Caption }
  | { type: "remove-caption"; captionId: string }
  | { type: "workflow"; workflow: VideoWorkflow }
  | { type: "rough-cuts"; cuts: RoughCut[] }
  | {
      type: "settings";
      name?: string;
      width?: number;
      height?: number;
      captionStyle?: CaptionStyle;
      timelineMode?: TimelineMode;
    };

const FPS = 30;
const MAX_FRAMES = 24 * 60 * 60 * FPS;
const MAX_ASSETS = 1_000;
const MAX_CLIPS = 2_000;
const MAX_AUDIO_CLIPS = 64;
const MAX_CAPTIONS = 10_000;
const MAX_OPERATIONS = 1_000;
const MAX_CAPTION_TEXT = 4_000;
const MAX_SRT_LENGTH = 4_000_000;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label}必须是普通数据对象`);
  }
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label}包含未知字段：${key}`);
  }
}

function integer(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label}必须是 ${min} 到 ${max} 之间的整数`);
  }
  return value;
}

function text(value: unknown, max: number, label: string, multiline = false): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/ : /[\u0000-\u001f]/).test(value)
  ) {
    throw new Error(`${label}必须是非空文本，最多 ${max} 个字符`);
  }
  return value;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`${label}格式不正确`);
  }
  return value;
}

function captionStyle(value: unknown): CaptionStyle {
  if (value !== "classic" && value !== "bold" && value !== "minimal")
    throw new Error("字幕样式须为 classic、bold 或 minimal");
  return value;
}

function list(value: unknown, max: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) {
    throw new Error(`${label}必须是数组，最多 ${max} 项`);
  }
  // Reject sparse arrays as well as malformed items.
  return Array.from(value);
}

function uniqueIds(items: readonly { id: string }[], label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`${label} ID 重复：${item.id}`);
    seen.add(item.id);
  }
}

function volume(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 2) {
    throw new Error("音量必须是 0 到 2 之间的数值");
  }
  return value;
}

function mediaId(value: unknown): string {
  if (!isResourceId(value)) {
    throw new Error("持久素材 ID 格式不正确");
  }
  return value;
}

function readScene(value: unknown): HyperframesScene {
  const data = record(value, "场景");
  keys(data, ["kind", "sourceHash", "params"], "场景");
  if (data.kind !== "hyperframes") throw new Error("不支持此场景类型");
  if (typeof data.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(data.sourceHash)) {
    throw new Error("场景源码摘要格式不正确");
  }
  let remaining = 4_096;
  function copyJson(value: unknown, depth: number): JsonValue {
    if (--remaining < 0 || depth > 12) throw new Error("场景参数过多或嵌套过深");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.length <= 65_536) return value;
    if (Array.isArray(value))
      return list(value, 4_096, "场景参数").map((item) => copyJson(item, depth + 1));
    const input = record(value, "场景参数");
    const result: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(input)) {
      if (["__proto__", "constructor", "prototype"].includes(key) || key.length > 240) {
        throw new Error("场景参数字段不受支持");
      }
      result[key] = copyJson(item, depth + 1);
    }
    return result;
  }
  const params = copyJson(record(data.params, "场景参数"), 0) as HyperframesScene["params"];
  if (new TextEncoder().encode(JSON.stringify(params)).byteLength > 65_536) {
    throw new Error("场景参数最多 64 KiB");
  }
  return { kind: "hyperframes", sourceHash: data.sourceHash, params };
}

function readAsset(value: unknown): Asset {
  const data = record(value, "素材");
  keys(
    data,
    [
      "id",
      "name",
      "kind",
      "durationFrames",
      "width",
      "height",
      "size",
      "lastModified",
      "sourcePath",
      "mimeType",
      "mediaId",
      "proxyId",
      "thumbnailId",
      "scene",
      "speech",
    ],
    "素材",
  );
  if (!["video", "audio", "image", "demo"].includes(data.kind as string)) {
    throw new Error("素材类型不受支持");
  }
  const asset: Asset = {
    id: identifier(data.id, "素材 ID"),
    name: text(data.name, 240, "素材名称"),
    kind: data.kind as Asset["kind"],
    durationFrames: integer(data.durationFrames, 1, MAX_FRAMES, "素材时长"),
  };
  if (data.width !== undefined) asset.width = integer(data.width, 1, 16_384, "素材宽度");
  if (data.height !== undefined) asset.height = integer(data.height, 1, 16_384, "素材高度");
  if (data.size !== undefined)
    asset.size = integer(data.size, 0, Number.MAX_SAFE_INTEGER, "素材大小");
  if (data.lastModified !== undefined) {
    asset.lastModified = integer(data.lastModified, 0, Number.MAX_SAFE_INTEGER, "素材修改时间");
  }
  if (data.sourcePath !== undefined) {
    const path = text(data.sourcePath, 1024, "素材相对路径");
    if (
      /[\\:\x00-\x1f\x7f]/.test(path) ||
      path.startsWith("/") ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error("素材相对路径无效");
    asset.sourcePath = path;
  }
  if (data.mimeType !== undefined) asset.mimeType = text(data.mimeType, 128, "素材 MIME 类型");
  if (data.mediaId !== undefined) asset.mediaId = mediaId(data.mediaId);
  if (data.proxyId !== undefined) asset.proxyId = mediaId(data.proxyId);
  if (data.thumbnailId !== undefined) asset.thumbnailId = mediaId(data.thumbnailId);
  if (data.scene !== undefined) asset.scene = readScene(data.scene);
  if (data.speech !== undefined) {
    const speech = record(data.speech, "配音");
    keys(
      speech,
      [
        "text",
        "voiceId",
        "engine",
        "modelId",
        "instructions",
        "referenceAssetId",
        "referenceText",
        "rate",
      ],
      "配音",
    );
    if (asset.kind !== "audio") throw new Error("配音来源必须是音频素材");
    if ((speech.referenceAssetId !== undefined) !== (speech.referenceText !== undefined))
      throw new Error("配音参考录音和逐字稿必须同时提供");
    if (
      speech.referenceText !== undefined &&
      (typeof speech.referenceText !== "string" ||
        !speech.referenceText.trim() ||
        Array.from(speech.referenceText).length > 1000)
    )
      throw new Error("配音参考录音逐字稿须为 1 至 1000 个字符");
    if (
      typeof speech.rate !== "number" ||
      !Number.isFinite(speech.rate) ||
      speech.rate < 0.5 ||
      speech.rate > 2
    )
      throw new Error("配音速度必须在 0.5 到 2 之间");
    asset.speech = {
      text: text(speech.text, 10000, "配音文稿", true),
      voiceId: text(speech.voiceId, 256, "配音音色"),
      engine: text(speech.engine, 128, "配音引擎"),
      ...(speech.modelId !== undefined ? { modelId: text(speech.modelId, 256, "配音模型") } : {}),
      ...(speech.instructions !== undefined
        ? { instructions: text(speech.instructions, 2000, "配音风格", true) }
        : {}),
      ...(speech.referenceAssetId !== undefined
        ? {
            referenceAssetId: mediaId(speech.referenceAssetId),
            referenceText: text(speech.referenceText, 2000, "配音参考录音逐字稿", true),
          }
        : {}),
      rate: speech.rate,
    };
  }
  return asset;
}

function readClip(value: unknown, assets: ReadonlyMap<string, Asset>): Clip {
  const data = record(value, "片段");
  keys(data, ["id", "assetId", "inFrame", "outFrame", "volume", "startFrame"], "片段");
  const assetId = identifier(data.assetId, "片段素材 ID");
  const asset = assets.get(assetId);
  if (!asset) throw new Error(`片段引用了不存在的素材：${assetId}`);
  const inFrame = integer(data.inFrame, 0, asset.durationFrames - 1, "片段入点");
  const outFrame = integer(data.outFrame, inFrame + 1, asset.durationFrames, "片段出点");
  return {
    id: identifier(data.id, "片段 ID"),
    assetId,
    inFrame,
    outFrame,
    volume: volume(data.volume),
    ...(data.startFrame !== undefined
      ? { startFrame: integer(data.startFrame, 0, MAX_FRAMES - outFrame + inFrame, "片段开始时间") }
      : {}),
  };
}

function readCaption(value: unknown, duration: number): Caption {
  const data = record(value, "字幕");
  keys(data, ["id", "startFrame", "endFrame", "text"], "字幕");
  const startFrame = integer(data.startFrame, 0, Math.max(0, duration - 1), "字幕开始时间");
  return {
    id: identifier(data.id, "字幕 ID"),
    startFrame,
    endFrame: integer(data.endFrame, startFrame + 1, duration, "字幕结束时间"),
    text: text(data.text, MAX_CAPTION_TEXT, "字幕内容", true).replace(/\r\n?/g, "\n"),
  };
}

function readAudioClip(
  value: unknown,
  assets: ReadonlyMap<string, Asset>,
  duration: number,
): AudioClip {
  const data = record(value, "音频片段");
  keys(data, ["id", "assetId", "inFrame", "outFrame", "volume", "startFrame"], "音频片段");
  const { startFrame, ...clipData } = data;
  const clip = readClip(clipData, assets);
  if (!["audio", "video"].includes(assets.get(clip.assetId)!.kind)) {
    throw new Error("音轨只能引用音频或视频素材");
  }
  return {
    ...clip,
    startFrame: integer(startFrame, 0, duration - (clip.outFrame - clip.inFrame), "音轨开始时间"),
  };
}

/** Validate and copy untrusted imported data; never retain input object references. */
export function validateProject(value: unknown): Project {
  const data = record(value, "工程");
  keys(
    data,
    [
      "schemaVersion",
      "id",
      "name",
      "revision",
      "width",
      "height",
      "fps",
      "assets",
      "clips",
      "timelineMode",
      "audioClips",
      "captions",
      "captionStyle",
      "script",
      "workflow",
      "narration",
      "roughCuts",
    ],
    "工程",
  );
  if (data.schemaVersion !== 1) throw new Error("不支持此工程版本");
  if (data.fps !== FPS) throw new Error("当前版本只支持 30 fps 工程");
  if (
    data.timelineMode !== undefined &&
    data.timelineMode !== "magnetic" &&
    data.timelineMode !== "free"
  )
    throw new Error("时间轴模式须为 magnetic 或 free");
  const timelineMode = data.timelineMode as TimelineMode | undefined;
  const assets = list(data.assets, MAX_ASSETS, "素材列表").map(readAsset);
  uniqueIds(assets, "素材");
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const clips = list(data.clips, MAX_CLIPS, "片段列表").map((clip) => readClip(clip, assetsById));
  uniqueIds(clips, "片段");
  if (timelineMode === "free") {
    let cursor = 0;
    for (const clip of clips) {
      clip.startFrame ??= cursor;
      cursor = clip.startFrame + clip.outFrame - clip.inFrame;
    }
    clips.sort((a, b) => a.startFrame! - b.startFrame!);
    let end = 0;
    for (const clip of clips) {
      if (clip.startFrame! < end) throw new Error("同一画面轨的片段不能重叠，请移到空余位置");
      end = clip.startFrame! + clip.outFrame - clip.inFrame;
    }
  } else if (clips.some((clip) => clip.startFrame !== undefined)) {
    throw new Error("磁性时间轴不能指定片段开始时间，请先关闭主序列磁性");
  }
  const duration = integer(
    timelineDuration({ clips, timelineMode }),
    0,
    MAX_FRAMES,
    "时间线总时长",
  );
  const audioClips = list(
    data.audioClips === undefined ? [] : data.audioClips,
    MAX_AUDIO_CLIPS,
    "音轨列表",
  ).map((clip) => readAudioClip(clip, assetsById, duration));
  uniqueIds(audioClips, "音轨");
  const captions = list(data.captions, MAX_CAPTIONS, "字幕列表").map((caption) =>
    readCaption(caption, duration),
  );
  uniqueIds(captions, "字幕");
  captions.sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
  return {
    schemaVersion: 1,
    id: identifier(data.id, "工程 ID"),
    name: text(data.name, 200, "工程名称"),
    revision: integer(data.revision, 0, Number.MAX_SAFE_INTEGER - 1, "工程修订号"),
    width: integer(data.width, 16, 8_192, "画面宽度"),
    height: integer(data.height, 16, 8_192, "画面高度"),
    fps: FPS,
    ...(data.script !== undefined ? { script: text(data.script, 10000, "口播文稿", true) } : {}),
    assets,
    clips,
    ...(timelineMode !== undefined ? { timelineMode } : {}),
    audioClips,
    captions,
    ...(data.captionStyle !== undefined ? { captionStyle: captionStyle(data.captionStyle) } : {}),
    ...(data.workflow !== undefined
      ? { workflow: validateVideoWorkflow(data.workflow, assets) }
      : {}),
    ...(data.narration !== undefined
      ? { narration: validateNarration(data.narration, assets) }
      : {}),
    ...(data.roughCuts !== undefined
      ? { roughCuts: validateRoughCuts(data.roughCuts, assets) }
      : {}),
  };
}

export function createProject(name = "未命名项目"): Project {
  return validateProject({
    schemaVersion: 1,
    id: `project-${randomId()}`,
    name,
    revision: 0,
    width: 1920,
    height: 1080,
    fps: FPS,
    assets: [],
    clips: [],
    captions: [],
  });
}

export function createDemoProject(): Project {
  const project = createProject("从想法，到成片。");
  project.assets = [
    {
      id: "demo-intro",
      name: "01 开场 · 一个好故事",
      kind: "demo",
      durationFrames: 180,
      width: 1920,
      height: 1080,
    },
    {
      id: "demo-city",
      name: "02 演示 · 剪辑你的第一条视频",
      kind: "demo",
      durationFrames: 300,
      width: 1920,
      height: 1080,
    },
    {
      id: "demo-outro",
      name: "03 收尾 · 开始创作",
      kind: "demo",
      durationFrames: 240,
      width: 1920,
      height: 1080,
    },
  ];
  project.clips = project.assets.map((asset, index) => ({
    id: `clip-${index + 1}`,
    assetId: asset.id,
    inFrame: 0,
    outFrame: asset.durationFrames,
    volume: 1,
  }));
  project.captions = [
    { id: "caption-1", startFrame: 0, endFrame: 150, text: "从想法，到成片。" },
    { id: "caption-2", startFrame: 210, endFrame: 420, text: "整理素材，让每一次剪辑都有依据。" },
    { id: "caption-3", startFrame: 510, endFrame: 690, text: "你的下一个好故事，现在开始。" },
  ];
  return validateProject(project);
}

export function timelineDuration(project: Pick<Project, "clips" | "timelineMode">): number {
  let cursor = 0;
  let duration = 0;
  for (const clip of project.clips) {
    const start = project.timelineMode === "free" ? (clip.startFrame ?? cursor) : cursor;
    cursor = start + clip.outFrame - clip.inFrame;
    duration = Math.max(duration, cursor);
  }
  return duration;
}

export function timelineClips(project: Pick<Project, "clips" | "timelineMode">): TimelineClip[] {
  let cursor = 0;
  const result = project.clips.map((clip) => {
    const startFrame = project.timelineMode === "free" ? (clip.startFrame ?? cursor) : cursor;
    cursor = startFrame + clip.outFrame - clip.inFrame;
    return { ...clip, startFrame, endFrame: cursor };
  });
  return project.timelineMode === "free"
    ? result.sort((a, b) => a.startFrame - b.startFrame)
    : result;
}

function nextId(prefix: string, used: ReadonlySet<string>): string {
  let index = used.size + 1;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

/**
 * Captions follow surviving source ranges of the same clip instance. Removed source
 * ranges lose their captions; new material starts uncaptioned. A move carries its
 * captions, and a caption spanning separated ranges can become multiple captions.
 * Adjacent pieces with the same origin are joined to avoid needless fragmentation.
 */
function rippleCaptions(project: Project, before: TimelineClip[], preserveGaps = false): void {
  const after = new Map(timelineClips(project).map((clip) => [clip.id, clip]));
  const used = new Set(project.captions.map((caption) => caption.id));
  const result: Caption[] = [];
  for (const caption of project.captions) {
    const pieces: { startFrame: number; endFrame: number }[] = [];
    if (preserveGaps) {
      // Captions in an existing picture gap have no source clip to follow.
      let cursor = caption.startFrame;
      for (const oldClip of before) {
        if (oldClip.endFrame <= cursor) continue;
        const end = Math.min(caption.endFrame, oldClip.startFrame);
        if (end > cursor) pieces.push({ startFrame: cursor, endFrame: end });
        cursor = Math.max(cursor, Math.min(caption.endFrame, oldClip.endFrame));
        if (cursor >= caption.endFrame) break;
      }
      if (cursor < caption.endFrame)
        pieces.push({ startFrame: cursor, endFrame: caption.endFrame });
    }
    for (const oldClip of before) {
      const newClip = after.get(oldClip.id);
      if (!newClip) continue;
      const oldStart = Math.max(caption.startFrame, oldClip.startFrame);
      const oldEnd = Math.min(caption.endFrame, oldClip.endFrame);
      if (oldEnd <= oldStart) continue;
      const sourceStart = Math.max(
        oldClip.inFrame + oldStart - oldClip.startFrame,
        newClip.inFrame,
      );
      const sourceEnd = Math.min(oldClip.inFrame + oldEnd - oldClip.startFrame, newClip.outFrame);
      if (sourceEnd > sourceStart) {
        pieces.push({
          startFrame: newClip.startFrame + sourceStart - newClip.inFrame,
          endFrame: newClip.startFrame + sourceEnd - newClip.inFrame,
        });
      }
    }
    pieces.sort((a, b) => a.startFrame - b.startFrame);
    const merged: typeof pieces = [];
    for (const piece of pieces) {
      const previous = merged[merged.length - 1];
      if (previous && previous.endFrame >= piece.startFrame)
        previous.endFrame = Math.max(previous.endFrame, piece.endFrame);
      else merged.push({ ...piece });
    }
    merged.forEach((piece, index) => {
      const id = index === 0 ? caption.id : nextId("caption", used);
      used.add(id);
      result.push({ id, text: caption.text, ...piece });
    });
  }
  project.captions = result;
}

/** Audio follows the same surviving picture ranges, preserving its own source offsets. */
function rippleAudio(project: Project, before: TimelineClip[]): void {
  const after = new Map(timelineClips(project).map((clip) => [clip.id, clip]));
  const used = new Set((project.audioClips ?? []).map((clip) => clip.id));
  const result: AudioClip[] = [];
  for (const audio of project.audioClips ?? []) {
    const endFrame = audio.startFrame + audio.outFrame - audio.inFrame;
    const pieces: Omit<AudioClip, "id">[] = [];
    for (const oldClip of before) {
      const newClip = after.get(oldClip.id);
      if (!newClip) continue;
      const oldStart = Math.max(
        audio.startFrame,
        oldClip.startFrame,
        oldClip.startFrame + newClip.inFrame - oldClip.inFrame,
      );
      const oldEnd = Math.min(
        endFrame,
        oldClip.endFrame,
        oldClip.startFrame + newClip.outFrame - oldClip.inFrame,
      );
      if (oldEnd <= oldStart) continue;
      const inFrame = audio.inFrame + oldStart - audio.startFrame;
      pieces.push({
        assetId: audio.assetId,
        volume: audio.volume,
        inFrame,
        outFrame: inFrame + oldEnd - oldStart,
        startFrame:
          newClip.startFrame + oldClip.inFrame + oldStart - oldClip.startFrame - newClip.inFrame,
      });
    }
    pieces.sort((a, b) => a.startFrame - b.startFrame);
    const merged: typeof pieces = [];
    for (const piece of pieces) {
      const previous = merged[merged.length - 1];
      // A deleted picture interval must also skip that interval in the audio source.
      // Joining merely adjacent timeline positions would reintroduce deleted speech.
      if (
        previous &&
        previous.startFrame + previous.outFrame - previous.inFrame === piece.startFrame &&
        previous.outFrame === piece.inFrame
      )
        previous.outFrame = piece.outFrame;
      else merged.push({ ...piece });
    }
    merged.forEach((piece, index) => {
      const id = index === 0 ? audio.id : nextId("audio", used);
      used.add(id);
      result.push({ id, ...piece });
    });
  }
  project.audioClips = result;
}

/** Independent tracks retain absolute positions in free mode; only the new sequence end clips them. */
function trimIndependentTracksToTimeline(project: Project): void {
  const duration = timelineDuration(project);
  project.audioClips = (project.audioClips ?? []).flatMap((clip) => {
    const available = duration - clip.startFrame;
    return available > 0
      ? [{ ...clip, outFrame: Math.min(clip.outFrame, clip.inFrame + available) }]
      : [];
  });
  project.captions = project.captions.flatMap((caption) =>
    caption.startFrame < duration
      ? [{ ...caption, endFrame: Math.min(caption.endFrame, duration) }]
      : [],
  );
}

const OPERATION_KEYS: Record<EditOperation["type"], readonly string[]> = {
  trim: ["type", "clipId", "inFrame", "outFrame"],
  split: ["type", "clipId", "atFrame"],
  remove: ["type", "clipId"],
  move: ["type", "clipId", "toIndex"],
  "video-move": ["type", "clipId", "startFrame"],
  volume: ["type", "clipId", "volume"],
  add: ["type", "assetId", "inFrame", "outFrame", "startFrame"],
  "audio-add": ["type", "assetId", "inFrame", "outFrame", "startFrame", "volume"],
  "audio-trim": ["type", "clipId", "inFrame", "outFrame"],
  "audio-split": ["type", "clipId", "atFrame"],
  "audio-move": ["type", "clipId", "startFrame"],
  "audio-volume": ["type", "clipId", "volume"],
  "audio-remove": ["type", "clipId"],
  caption: ["type", "caption"],
  "remove-caption": ["type", "captionId"],
  workflow: ["type", "workflow"],
  "rough-cuts": ["type", "cuts"],
  settings: ["type", "name", "width", "height", "captionStyle", "timelineMode"],
};

/**
 * Apply an entire patch atomically to a copy, with optimistic revision locking.
 * move.toIndex is the final, zero-based clip index. split.atFrame and
 * audio-split.atFrame are source frames; audio splitting preserves timeline positions.
 * A successful nonempty patch increments revision exactly once; failed patches do
 * not change any caller-owned data. A caption operation inserts or replaces by ID.
 */
export function applyOperations(
  project: Project,
  operations: readonly EditOperation[],
  baseRevision: number,
): Project {
  let next = validateProject(project);
  integer(baseRevision, 0, Number.MAX_SAFE_INTEGER - 1, "基础修订号");
  if (next.revision !== baseRevision) {
    throw new Error(
      `工程已更新（当前修订 ${next.revision}，请求修订 ${baseRevision}），请刷新后重试`,
    );
  }
  const items = list(operations, MAX_OPERATIONS, "编辑操作");
  for (const item of items) {
    const data = record(item, "编辑操作");
    if (typeof data.type !== "string" || !Object.hasOwn(OPERATION_KEYS, data.type)) {
      throw new Error("不支持此编辑操作");
    }
    const type = data.type as EditOperation["type"];
    keys(data, OPERATION_KEYS[type], "编辑操作");
    const before = timelineClips(next);
    const wasFree = next.timelineMode === "free";
    let compressedTimeline = false;
    if (type === "add") {
      if (data.startFrame !== undefined && !wasFree)
        throw new Error("指定加入时间需要先关闭主序列磁性");
      const assetId = identifier(data.assetId, "素材 ID");
      const asset = next.assets.find((candidate) => candidate.id === assetId);
      if (!asset) throw new Error(`素材不存在：${assetId}`);
      next.clips.push(
        readClip(
          {
            id: nextId("clip", new Set(next.clips.map((clip) => clip.id))),
            assetId,
            inFrame: data.inFrame === undefined ? 0 : data.inFrame,
            outFrame: data.outFrame === undefined ? asset.durationFrames : data.outFrame,
            volume: 1,
            ...(wasFree
              ? {
                  startFrame:
                    data.startFrame === undefined ? timelineDuration(next) : data.startFrame,
                }
              : {}),
          },
          new Map([[assetId, asset]]),
        ),
      );
    } else if (type === "audio-add") {
      const assetId = identifier(data.assetId, "素材 ID");
      const asset = next.assets.find((candidate) => candidate.id === assetId);
      if (!asset) throw new Error(`素材不存在：${assetId}`);
      const duration = timelineDuration(next);
      const startFrame = integer(
        data.startFrame === undefined ? 0 : data.startFrame,
        0,
        duration - 1,
        "音轨开始时间",
      );
      const inFrame = integer(
        data.inFrame === undefined ? 0 : data.inFrame,
        0,
        asset.durationFrames - 1,
        "音轨入点",
      );
      const audioClips = (next.audioClips ??= []);
      audioClips.push(
        readAudioClip(
          {
            id: nextId("audio", new Set(audioClips.map((clip) => clip.id))),
            assetId,
            inFrame,
            outFrame:
              data.outFrame === undefined
                ? Math.min(asset.durationFrames, inFrame + duration - startFrame)
                : data.outFrame,
            startFrame,
            volume: data.volume === undefined ? 1 : data.volume,
          },
          new Map([[assetId, asset]]),
          duration,
        ),
      );
    } else if (type.startsWith("audio-")) {
      const clipId = identifier(data.clipId, "音轨 ID");
      const audioClips = (next.audioClips ??= []);
      const index = audioClips.findIndex((clip) => clip.id === clipId);
      const clip = audioClips[index];
      if (!clip) throw new Error(`音轨不存在：${clipId}`);
      if (type === "audio-remove") audioClips.splice(index, 1);
      else if (type === "audio-volume") clip.volume = volume(data.volume);
      else if (type === "audio-move") {
        clip.startFrame = integer(
          data.startFrame,
          0,
          timelineDuration(next) - (clip.outFrame - clip.inFrame),
          "音轨开始时间",
        );
      } else if (type === "audio-trim") {
        const asset = next.assets.find((candidate) => candidate.id === clip.assetId)!;
        clip.inFrame = integer(data.inFrame, 0, asset.durationFrames - 1, "音轨入点");
        clip.outFrame = integer(data.outFrame, clip.inFrame + 1, asset.durationFrames, "音轨出点");
      } else if (type === "audio-split") {
        const atFrame = integer(data.atFrame, clip.inFrame + 1, clip.outFrame - 1, "音轨分割位置");
        const right = {
          ...clip,
          id: nextId("audio", new Set(audioClips.map((candidate) => candidate.id))),
          inFrame: atFrame,
          startFrame: clip.startFrame + atFrame - clip.inFrame,
        };
        clip.outFrame = atFrame;
        audioClips.splice(index + 1, 0, right);
      }
    } else if (type === "caption") {
      const caption = readCaption(data.caption, timelineDuration(next));
      const index = next.captions.findIndex((candidate) => candidate.id === caption.id);
      if (index >= 0) next.captions[index] = caption;
      else next.captions.push(caption);
    } else if (type === "remove-caption") {
      const captionId = identifier(data.captionId, "字幕 ID");
      const index = next.captions.findIndex((caption) => caption.id === captionId);
      if (index < 0) throw new Error(`字幕不存在：${captionId}`);
      next.captions.splice(index, 1);
    } else if (type === "workflow") {
      next.workflow = validateVideoWorkflow(data.workflow, next.assets);
    } else if (type === "rough-cuts") {
      next.roughCuts = validateRoughCuts(data.cuts, next.assets);
    } else if (type === "settings") {
      if (data.timelineMode !== undefined) {
        if (data.timelineMode !== "magnetic" && data.timelineMode !== "free")
          throw new Error("时间轴模式须为 magnetic 或 free");
        if (data.timelineMode === "free" && !wasFree) {
          next.clips = before.map(({ endFrame: _endFrame, ...clip }) => clip);
        } else if (data.timelineMode === "magnetic" && wasFree) {
          next.clips = next.clips.map(({ startFrame: _startFrame, ...clip }) => clip);
          compressedTimeline = true;
        }
        next.timelineMode = data.timelineMode;
      }
      if (data.captionStyle !== undefined) next.captionStyle = captionStyle(data.captionStyle);
      if (data.name !== undefined) next.name = text(data.name, 200, "工程名称");
      if (data.width !== undefined) next.width = integer(data.width, 16, 8_192, "画面宽度");
      if (data.height !== undefined) next.height = integer(data.height, 16, 8_192, "画面高度");
    } else {
      const clipId = identifier(data.clipId, "片段 ID");
      const index = next.clips.findIndex((clip) => clip.id === clipId);
      const clip = next.clips[index];
      if (!clip) throw new Error(`片段不存在：${clipId}`);
      if (type === "trim") {
        const asset = next.assets.find((candidate) => candidate.id === clip.assetId)!;
        const inFrame = integer(data.inFrame, 0, asset.durationFrames - 1, "片段入点");
        if (wasFree)
          clip.startFrame = integer(
            clip.startFrame! + inFrame - clip.inFrame,
            0,
            MAX_FRAMES - 1,
            "片段开始时间",
          );
        clip.inFrame = inFrame;
        clip.outFrame = integer(data.outFrame, clip.inFrame + 1, asset.durationFrames, "片段出点");
      } else if (type === "split") {
        const atFrame = integer(data.atFrame, clip.inFrame + 1, clip.outFrame - 1, "分割位置");
        const right = {
          ...clip,
          id: nextId("clip", new Set(next.clips.map((candidate) => candidate.id))),
          inFrame: atFrame,
          ...(wasFree ? { startFrame: clip.startFrame! + atFrame - clip.inFrame } : {}),
        };
        clip.outFrame = atFrame;
        next.clips.splice(index + 1, 0, right);
      } else if (type === "remove") {
        next.clips.splice(index, 1);
      } else if (type === "move") {
        if (wasFree) throw new Error("自由时间轴请按时间移动片段，或先开启主序列磁性");
        const toIndex = integer(data.toIndex, 0, next.clips.length - 1, "片段目标位置");
        next.clips.splice(index, 1);
        next.clips.splice(toIndex, 0, clip);
      } else if (type === "video-move") {
        if (!wasFree) throw new Error("按时间移动片段需要先关闭主序列磁性");
        clip.startFrame = integer(
          data.startFrame,
          0,
          MAX_FRAMES - clip.outFrame + clip.inFrame,
          "片段开始时间",
        );
      } else if (type === "volume") {
        clip.volume = volume(data.volume);
      }
    }
    if (
      type === "trim" ||
      type === "remove" ||
      type === "move" ||
      type === "video-move" ||
      type === "add" ||
      compressedTimeline
    ) {
      rippleCaptions(next, before, wasFree);
      if (wasFree) trimIndependentTracksToTimeline(next);
      else rippleAudio(next, before);
    }
    // Bound intermediate states too, so an oversized patch cannot temporarily
    // allocate an unbounded project and then hide it with a final removal.
    next = validateProject(next);
  }
  if (items.length) {
    next.revision += 1;
    next = validateProject(next);
  }
  return next;
}

export function formatTime(frame: number): string {
  integer(frame, 0, MAX_FRAMES, "时间码");
  const seconds = Math.floor(frame / FPS);
  return [Math.floor(seconds / 3_600), Math.floor(seconds / 60) % 60, seconds % 60, frame % FPS]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function srtTime(frame: number): string {
  const millis = Math.round((frame * 1_000) / FPS);
  const seconds = Math.floor(millis / 1_000);
  const clock = [Math.floor(seconds / 3_600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  return `${clock},${String(millis % 1_000).padStart(3, "0")}`;
}

export function exportSrt(project: Project): string {
  const validated = validateProject(project);
  return validated.captions
    .map(
      (caption, index) =>
        `${index + 1}\n${srtTime(caption.startFrame)} --> ${srtTime(caption.endFrame)}\n${caption.text}\n`,
    )
    .join("\n");
}

function parseSrtTime(value: string): number {
  const match = /^(\d{2,3}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value);
  if (!match) throw new Error(`SRT 时间格式不正确：${value}`);
  const [, hours, minutes, seconds, millis] = match;
  if (Number(minutes) >= 60 || Number(seconds) >= 60) {
    throw new Error(`SRT 时间超出范围：${value}`);
  }
  return integer(
    Math.round(
      ((Number(hours) * 3_600_000 +
        Number(minutes) * 60_000 +
        Number(seconds) * 1_000 +
        Number(millis)) *
        FPS) /
        1_000,
    ),
    0,
    MAX_FRAMES,
    "SRT 时间",
  );
}

/** Import SRT as plain text. Times snap to the nearest frame; overlap is allowed. */
export function parseSrt(source: string): Caption[] {
  if (typeof source !== "string" || source.length > MAX_SRT_LENGTH) {
    throw new Error(`SRT 必须是文本，最多 ${MAX_SRT_LENGTH} 个字符`);
  }
  const normalized = source
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!normalized) return [];
  const blocks = normalized.split(/\n[ \t]*\n+/);
  if (blocks.length > MAX_CAPTIONS) throw new Error(`SRT 最多 ${MAX_CAPTIONS} 条字幕`);
  const captions = blocks.map((block, index) => {
    const lines = block.split("\n");
    if (/^\d+$/.test(lines[0]!.trim())) lines.shift();
    const times =
      /^\s*(\d{2,3}:\d{2}:\d{2}[,.]\d{3})\s+-->\s+(\d{2,3}:\d{2}:\d{2}[,.]\d{3})\s*$/.exec(
        lines.shift() ?? "",
      );
    if (!times) throw new Error(`第 ${index + 1} 条 SRT 缺少有效时间范围`);
    return readCaption(
      {
        id: `caption-${index + 1}`,
        startFrame: parseSrtTime(times[1]!),
        endFrame: parseSrtTime(times[2]!),
        text: lines.join("\n").trim(),
      },
      MAX_FRAMES,
    );
  });
  return captions.sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
}
