import {
  timelineClips,
  validateProject,
  type Asset,
  type AudioClip,
  type Caption,
  type CaptionStyle,
  type Clip,
  type Project,
} from "../model";
import { evaluateAnimatedNumber } from "./animation";
import { captionTemplate, sameJson } from "./caption-presets";
import { splitClip, trimClip } from "./clip-edits";
import { createTrack, defaultAudioMix, defaultColorAdjustment, defaultTransform } from "./defaults";
import { legacyClipId, type LegacyCollection } from "./legacy-aliases";
import { LEGACY_FRAME_TICKS } from "./legacy-time";
import { applyEditorOperations, type EditorOperation } from "./operations";
import { freezeTimeMap } from "./time";
import type {
  EditorAsset,
  EditorClip,
  EditorDocument,
  EditorSequence,
  JsonData,
  MediaClip,
  TextClip,
} from "./types";
import { validateEditorDocument } from "./validation";

/** Legacy frames describe 1/30 second regardless of the v2 sequence's frame rate. */
export { LEGACY_FRAME_TICKS };
type Collection = LegacyCollection;
export interface LegacyViewOptions {
  primaryVideoTrackId?: string;
  primaryAudioTrackId?: string;
  captionTrackId?: string;
}
export interface LegacyRestriction {
  code: string;
  message: string;
  clipId?: string;
  assetId?: string;
  field?: string;
  /** Excluded rows have no invented legacy source range or timeline duration. */
  excluded: boolean;
}
export interface LegacyClipMapping {
  collection: Collection;
  legacyId: string;
  clipId: string;
  trackId: string;
  volumeWritable: boolean;
}
export interface LegacyProjectView {
  /** Detached, deeply frozen read-only view. Clone it before calling mutable legacy workflows. */
  project: Project;
  sequenceId: string;
  revision: number;
  tracks: LegacyViewOptions;
  clips: LegacyClipMapping[];
  restrictions: LegacyRestriction[];
  /** False means legacy renders/exports cannot reproduce this sequence. Use the v2 renderer. */
  renderSafe: boolean;
  /** Partial views allow imports, production metadata and additions, but no destructive timeline rewrite. */
  timelineComplete: boolean;
}
const metadataKeys = [
  "size",
  "lastModified",
  "sourcePath",
  "mimeType",
  "proxyId",
  "thumbnailId",
  "scene",
  "speech",
] as const;
const annotationKeys = ["script", "workflow", "narration", "roughCuts"] as const;
const same = sameJson;
const frames = (tick: number) => tick / LEGACY_FRAME_TICKS;
const ticks = (frame: number) => frame * LEGACY_FRAME_TICKS;
function frozen<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) frozen(item);
    Object.freeze(value);
  }
  return value;
}
function sequenceOf(document: EditorDocument, id: string): EditorSequence {
  const sequence = document.sequences.find((sequence) => sequence.id === id);
  if (!sequence) throw new Error("旧流程对应的序列不存在");
  return sequence;
}
function allocate(used: Set<string>, preferred: string): string {
  let id = preferred,
    suffix = 0;
  while (used.has(id)) id = `${preferred.slice(0, 100)}-legacy-${++suffix}`;
  used.add(id);
  return id;
}
/** Subtitle clips whose old caption ID is listed, e.g. the narration workflow's temporary captions. */
export function captionClipIdsForLegacyIds(
  document: EditorDocument,
  sequenceId: string,
  legacyIds: Iterable<string>,
): Set<string> {
  const wanted = new Set(legacyIds),
    result = new Set<string>();
  if (!wanted.size) return result;
  for (const clip of document.sequences.find((item) => item.id === sequenceId)?.clips ?? [])
    if (
      clip.kind === "text" &&
      clip.role === "subtitle" &&
      wanted.has(legacyClipId(document, sequenceId, clip, "captions"))
    )
      result.add(clip.id);
  return result;
}
function baseProject(document: EditorDocument, sequence: EditorSequence): Project {
  return {
    schemaVersion: 1,
    id: document.id,
    name: document.name,
    revision: document.revision,
    width: sequence.width,
    height: sequence.height,
    fps: 30,
    assets: [],
    clips: [],
    audioClips: [],
    captions: [],
    timelineMode: "free",
  };
}
function assetFromLegacy(asset: Asset): EditorAsset {
  const { id, name, kind, durationFrames, width, height, mediaId, ...metadata } = asset;
  return {
    id,
    name,
    kind,
    duration: ticks(durationFrames),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(mediaId === undefined ? {} : { resourceId: mediaId }),
    ...(Object.keys(metadata).length
      ? { metadata: structuredClone(metadata) as Record<string, JsonData> }
      : {}),
  };
}
function legacyPreset(clip: TextClip, sequence: EditorSequence): CaptionStyle | undefined {
  return (["classic", "bold", "minimal"] as const).find((captionStyle) =>
    same(clip.style, captionTemplate({ ...sequence, captionStyle }).style),
  );
}
function exactMedia(clip: MediaClip): boolean {
  if (
    ![clip.start, clip.duration, ...clip.timeMap.points.map((point) => point.source)].every(
      (value) => value % LEGACY_FRAME_TICKS === 0,
    )
  )
    return false;
  const first = clip.timeMap.points[0]!.source;
  return clip.timeMap.points.every((point) => point.source === first + point.time);
}
/** A still image's display length is independent of its zero-duration source. */
function staticImage(clip: MediaClip, assets: readonly EditorAsset[]): boolean {
  return (
    assets.some((asset) => asset.id === clip.assetId && asset.kind === "image") &&
    clip.timeMap.points.every((point) => point.source === 0)
  );
}

/** Legacy range extension is safe only when there is no local timing to invent or retime. */
function assertStaticExtension(clip: EditorClip, sequence: EditorSequence): void {
  const animated = (value: unknown): boolean =>
    !!value &&
    typeof value === "object" &&
    (Object.hasOwn(value, "keyframes") || Object.values(value).some(animated));
  if (
    clip.groupId ||
    clip.linkGroupId ||
    animated(clip.transform) ||
    animated(clip.color) ||
    sequence.transitions.some(
      (transition) => transition.fromClipId === clip.id || transition.toClipId === clip.id,
    ) ||
    sequence.clips.some((item) => item.kind === "text" && item.sourceBinding?.clipId === clip.id) ||
    (clip.kind === "media" &&
      (animated(clip.audio) || clip.audio.fadeIn > 0 || clip.audio.fadeOut > 0)) ||
    (clip.kind === "text" &&
      (clip.sourceBinding ||
        clip.words.length ||
        clip.translation ||
        clip.style.animation !== "none"))
  )
    throw new Error(
      "旧流程不能安全延长或滑移包含动画、淡化、绑定或转场的新版片段，请使用新版时间线",
    );
}

/** A projection is compatibility data, never a second editable timeline or a fallback renderer. */
export function projectLegacyView(
  value: EditorDocument,
  sequenceId = value.activeSequenceId,
  options: LegacyViewOptions = {},
): LegacyProjectView {
  const document = validateEditorDocument(value),
    sequence = sequenceOf(document, sequenceId);
  const tracks: LegacyViewOptions = {};
  const savedTracks = Array.isArray(document.production?.legacyTracks)
    ? document.production.legacyTracks.find(
        (item) =>
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          item.sequenceId === sequenceId,
      )
    : undefined;
  // The projection's primary tracks are a stable mapping into the old frame view, not the editing
  // target of mainPictureTrack (placement.ts): a saved or explicit mapping wins, and locking or
  // switching the timeline mode must not move old clips to another track in the projection.
  for (const [key, kind, preferred] of [
    ["primaryVideoTrackId", "video", "track-video-main"],
    ["primaryAudioTrackId", "audio", "track-audio-main"],
    ["captionTrackId", "text", "track-captions"],
  ] as const) {
    const selected =
      options[key] === undefined
        ? (sequence.tracks.find(
            (track) =>
              savedTracks &&
              typeof savedTracks === "object" &&
              !Array.isArray(savedTracks) &&
              track.id === savedTracks[key] &&
              track.kind === kind,
          ) ??
          sequence.tracks.find(
            (track) =>
              track.id ===
                (key === "primaryVideoTrackId"
                  ? (sequence.magneticTrackId ?? preferred)
                  : preferred) && track.kind === kind,
          ) ??
          (key === "primaryAudioTrackId"
            ? undefined
            : sequence.tracks.find((track) => track.kind === kind)))
        : sequence.tracks.find((track) => track.id === options[key] && track.kind === kind);
    if (options[key] !== undefined && !selected)
      throw new Error("旧流程指定的轨道不存在或类型不匹配");
    if (selected) tracks[key] = selected.id;
  }
  let project = baseProject(document, sequence);
  const restrictions: LegacyRestriction[] = [],
    mapping: LegacyClipMapping[] = [];
  const restrict = (
    code: string,
    message: string,
    clipId?: string,
    excluded = true,
    extra: Partial<LegacyRestriction> = {},
  ) => restrictions.push({ code, message, ...(clipId ? { clipId } : {}), excluded, ...extra });
  for (const source of document.assets) {
    const asset: Asset = {
      id: source.id,
      name: source.name,
      kind: source.kind,
      // Still images have no source duration. The original library needs a
      // display length; keeping it in the projection preserves canonical zero.
      durationFrames:
        source.kind === "image"
          ? Math.max(
              source.duration === 0 ? 150 : Math.floor(frames(source.duration)),
              ...sequence.clips
                .filter(
                  (clip) =>
                    clip.kind === "media" &&
                    clip.assetId === source.id &&
                    staticImage(clip, document.assets),
                )
                .map((clip) => Math.ceil(frames(clip.duration))),
            )
          : Math.floor(frames(source.duration)),
      ...(source.width === undefined ? {} : { width: source.width }),
      ...(source.height === undefined ? {} : { height: source.height }),
      ...(source.resourceId === undefined ? {} : { mediaId: source.resourceId }),
    };
    for (const key of metadataKeys)
      if (source.metadata?.[key] !== undefined)
        (asset as unknown as Record<string, unknown>)[key] = structuredClone(source.metadata[key]);
    try {
      if (project.assets.length >= 1000) throw new Error("旧素材列表最多支持 1000 项");
      validateProject({ ...baseProject(document, sequence), assets: [asset] });
      project.assets.push(asset);
      if (source.duration % LEGACY_FRAME_TICKS)
        restrict(
          "asset-tail",
          "素材末尾不足一个旧版帧；视图仅公开完整源帧，未修改时保留原始精确时长",
          undefined,
          false,
          { assetId: source.id },
        );
    } catch (error) {
      restrict(
        "asset-unavailable",
        `此素材无法在旧流程中表达：${error instanceof Error ? error.message : String(error)}`,
        undefined,
        true,
        { assetId: source.id },
      );
    }
  }
  const assets = new Set(project.assets.map((asset) => asset.id));
  const primary = sequence.clips
    .filter(
      (clip) =>
        clip.trackId === tracks.primaryVideoTrackId || clip.trackId === tracks.primaryAudioTrackId,
    )
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const overlaps = new Set<string>();
  for (let index = 0; index < primary.length; index++)
    for (
      let next = index + 1;
      next < primary.length &&
      primary[next]!.start < primary[index]!.start + primary[index]!.duration;
      next++
    ) {
      overlaps.add(primary[index]!.id);
      overlaps.add(primary[next]!.id);
    }
  const used: Record<Collection, Set<string>> = {
    clips: new Set(),
    audioClips: new Set(),
    captions: new Set(),
  };
  const addMedia = (clip: MediaClip, collection: "clips" | "audioClips") => {
    if (!assets.has(clip.assetId)) {
      restrict("missing-legacy-asset", "片段的源素材不在旧流程可用范围", clip.id);
      return;
    }
    const image = staticImage(clip, document.assets);
    if (
      !exactMedia(clip) &&
      !(image && clip.start % LEGACY_FRAME_TICKS === 0 && clip.duration % LEGACY_FRAME_TICKS === 0)
    ) {
      restrict(
        "time-map",
        "片段包含变速、倒放、定格或不能用 30 fps 整帧准确表达的时间；请使用新版时间线工具",
        clip.id,
      );
      return;
    }
    if (overlaps.has(clip.id)) {
      restrict("primary-overlap", "旧主序列不能表达重叠或同时播放的主轨片段", clip.id);
      return;
    }
    const volumeWritable = typeof clip.audio.volume === "number" && clip.audio.volume <= 2;
    if (!volumeWritable)
      restrict(
        "volume-automation",
        "自动化音量或超过 200% 的音量仅在新版编辑器可修改；旧值仅供流程识别",
        clip.id,
        false,
      );
    const volume = Math.max(0, Math.min(2, evaluateAnimatedNumber(clip.audio.volume, 0)));
    const id = allocate(used[collection], legacyClipId(document, sequenceId, clip, collection));
    const row: AudioClip = {
      id,
      assetId: clip.assetId,
      inFrame: frames(clip.timeMap.points[0]!.source),
      outFrame: frames(clip.timeMap.points[0]!.source + clip.duration),
      startFrame: frames(clip.start),
      volume,
    };
    const end = row.startFrame + row.outFrame - row.inFrame;
    const primaryEnd = Math.max(
      0,
      ...project.clips.map((clip) => clip.startFrame! + clip.outFrame - clip.inFrame),
    );
    if (collection === "audioClips" && (end > primaryEnd || project.audioClips!.length >= 64)) {
      restrict(
        "independent-audio-range",
        "旧流程只支持主画面时长内最多 64 个独立音频片段",
        clip.id,
      );
      return;
    }
    (project[collection] as Clip[]).push(row);
    mapping.push({
      collection,
      legacyId: id,
      clipId: clip.id,
      trackId: clip.trackId,
      volumeWritable,
    });
    if (
      !same(clip.transform, defaultTransform()) ||
      !same(clip.color, defaultColorAdjustment()) ||
      clip.mask ||
      clip.blendMode !== "normal" ||
      !same({ ...clip.audio, volume: 1 }, defaultAudioMix())
    )
      restrict(
        "advanced-properties",
        "新版构图、调色、蒙版或混音保留在原文档；旧流程不能负责预览与导出",
        clip.id,
        false,
      );
  };
  for (const clip of primary) {
    if (clip.kind === "media") addMedia(clip, "clips");
    else restrict("clip-kind", "嵌套序列、多机位、图形与其他新版片段不能折叠成旧主序列", clip.id);
  }
  for (const clip of sequence.clips.filter((clip) => !primary.includes(clip))) {
    const track = sequence.tracks.find((track) => track.id === clip.trackId)!;
    if (clip.kind === "media" && track.kind === "audio") addMedia(clip, "audioClips");
    else if (clip.kind === "text" && clip.role === "subtitle") {
      const end = Math.max(
        0,
        ...project.clips.map((clip) => clip.startFrame! + clip.outFrame - clip.inFrame),
      );
      if (
        clip.start % LEGACY_FRAME_TICKS ||
        clip.duration % LEGACY_FRAME_TICKS ||
        frames(clip.start + clip.duration) > end ||
        clip.text.length > 4000
      ) {
        restrict(
          "caption-range",
          "字幕超出旧主画面范围、包含小于旧版整帧的时间或超过旧文本长度上限",
          clip.id,
        );
        continue;
      }
      const id = allocate(used.captions, legacyClipId(document, sequenceId, clip, "captions"));
      project.captions.push({
        id,
        startFrame: frames(clip.start),
        endFrame: frames(clip.start + clip.duration),
        text: clip.text,
      });
      mapping.push({
        collection: "captions",
        legacyId: id,
        clipId: clip.id,
        trackId: clip.trackId,
        volumeWritable: false,
      });
      if (
        !legacyPreset(clip, sequence) ||
        clip.words.length ||
        clip.translation ||
        !same(clip.transform, captionTemplate(sequence).transform) ||
        !same(clip.color, defaultColorAdjustment()) ||
        clip.mask ||
        clip.blendMode !== "normal"
      )
        restrict(
          "advanced-caption",
          "新版字幕样式、逐词时间和翻译信息不在旧投影中；原数据保留",
          clip.id,
          false,
        );
    } else
      restrict(
        "additional-track",
        "旧流程不能表达此画面轨、标题或新版片段；其内容仍保留在原文档",
        clip.id,
      );
  }
  const timelineComplete = !restrictions.some((item) => item.excluded && item.clipId);
  let cursor = 0;
  const contiguous = project.clips.every((clip) => {
    const exact = clip.startFrame === cursor;
    cursor = clip.startFrame! + clip.outFrame - clip.inFrame;
    return exact;
  });
  if (sequence.timelineMode === "magnetic" && contiguous && timelineComplete) {
    project.timelineMode = "magnetic";
    for (const clip of project.clips) delete clip.startFrame;
  }
  const subtitleClips = mapping
    .filter((item) => item.collection === "captions")
    .map((item) => sequence.clips.find((clip) => clip.id === item.clipId) as TextClip);
  const presets = subtitleClips.map((clip) => legacyPreset(clip, sequence));
  const preference = document.production?.legacyCaptionStyle;
  project.captionStyle =
    presets.length && presets[0] && presets.every((value) => value === presets[0])
      ? presets[0]
      : ["classic", "bold", "minimal"].includes(String(preference))
        ? (preference as CaptionStyle)
        : "classic";
  project = validateProject(project);
  for (const field of annotationKeys)
    if (document.production?.[field] !== undefined) {
      try {
        project = validateProject({
          ...project,
          [field]: structuredClone(document.production[field]),
        });
      } catch (error) {
        restrict(
          "annotation-unavailable",
          `制作流程数据需要新版界面处理：${error instanceof Error ? error.message : String(error)}`,
          undefined,
          false,
          { field },
        );
      }
    }
  if (
    sequence.frameRate.numerator !== 30 * sequence.frameRate.denominator ||
    sequence.background !== "#000000" ||
    sequence.transitions.length ||
    sequence.tracks.some(
      (track) => track.hidden || track.muted || track.volume !== 1 || track.pan !== 0,
    )
  )
    restrict(
      "sequence-rendering",
      "当前帧率、背景、转场或轨道混音需要新版渲染器",
      undefined,
      false,
    );
  return frozen({
    project,
    sequenceId,
    revision: document.revision,
    tracks,
    clips: mapping,
    restrictions,
    renderSafe: restrictions.length === 0,
    timelineComplete,
  });
}

/**
 * Diff actual legacy fields before touching v2. Returned operations are validated
 * as one transaction; callers commit through their ordinary EditorHistory/session.
 */
export function applyLegacyProjectChange(
  value: EditorDocument,
  view: LegacyProjectView,
  beforeValue: Project,
  afterValue: Project,
  baseRevision: number,
): EditorOperation[] {
  const document = validateEditorDocument(value);
  if (baseRevision !== document.revision || view.revision !== document.revision)
    throw new Error("工程已更新，请重新打开此制作流程后重试");
  const currentView = projectLegacyView(document, view.sequenceId, view.tracks);
  const before = validateProject(beforeValue),
    after = validateProject(afterValue);
  if (
    !same(before, currentView.project) ||
    !same(view.project, currentView.project) ||
    !same(view.clips, currentView.clips)
  )
    throw new Error("旧流程的基础视图已变化，请刷新后重试");
  if (after.id !== before.id) throw new Error("旧流程不能替换工程身份，请使用导入功能");
  const sequenceId = view.sequenceId;
  const operations: EditorOperation[] = [],
    lateAssets: EditorOperation[] = [],
    extensions: EditorOperation[] = [];
  let draft = document;
  const append = (items: EditorOperation[]) => {
    if (!items.length) return;
    draft = applyEditorOperations(draft, items, draft.revision);
    operations.push(...items);
  };
  const used = new Set(
    document.sequences.flatMap((sequence) => [
      sequence.id,
      ...sequence.tracks.map((track) => track.id),
      ...sequence.clips.map((clip) => clip.id),
    ]),
  );
  const aliases: JsonData[] = [];
  const mapped = new Map(
    currentView.clips.map((item) => [`${item.collection}:${item.legacyId}`, item]),
  );
  const newlyMapped = new Map<string, LegacyClipMapping>();
  const splitBaselines = new Map<string, AudioClip>();
  const sequence = () => sequenceOf(draft, sequenceId);
  const find = (id: string) => {
    const clip = sequence().clips.find((clip) => clip.id === id);
    if (!clip) throw new Error("旧流程修改的片段已被联动编辑，请使用新版时间线重试");
    return clip;
  };
  const trackIds = { ...currentView.tracks };
  const track = (key: keyof LegacyViewOptions, kind: "video" | "audio" | "text") => {
    if (trackIds[key]) return trackIds[key]!;
    const id = allocate(
      used,
      `track-legacy-${key === "primaryVideoTrackId" ? "video" : key === "primaryAudioTrackId" ? "audio-main" : "captions"}`,
    );
    append([
      {
        type: "track.add",
        sequenceId,
        track: createTrack(
          id,
          kind,
          kind === "text" ? "字幕" : kind === "audio" ? "主序列声音" : "主画面",
        ),
      },
    ]);
    trackIds[key] = id;
    return id;
  };
  const mapNew = (collection: Collection, id: string, trackId: string): LegacyClipMapping => {
    const clipId = allocate(used, id),
      mapping = { collection, legacyId: id, clipId, trackId, volumeWritable: true };
    newlyMapped.set(`${collection}:${id}`, mapping);
    // Identity aliases also override old migration records when a previously
    // deleted canonical ID is deliberately reused by a later legacy addition.
    aliases.push({ sequenceId, collection, legacyId: id, clipId });
    return mapping;
  };
  for (const asset of after.assets) {
    const old = before.assets.find((item) => item.id === asset.id);
    if (!old) {
      if (document.assets.some((item) => item.id === asset.id))
        throw new Error("旧流程新增素材与不可见的现有素材 ID 冲突");
      append([{ type: "asset.add", asset: assetFromLegacy(asset) }]);
      continue;
    }
    const current = document.assets.find((item) => item.id === asset.id)!;
    const patch: Record<string, unknown> = {};
    for (const [legacy, canonical] of [
      ["name", "name"],
      ["kind", "kind"],
      ["durationFrames", "duration"],
      ["width", "width"],
      ["height", "height"],
      ["mediaId", "resourceId"],
    ] as const)
      if (!same(old[legacy], asset[legacy])) {
        // This field is a synthetic display allowance for durationless images,
        // including when an old workflow lengthens a still-image instance.
        if (
          legacy === "durationFrames" &&
          current.kind === "image" &&
          asset.kind === "image" &&
          current.duration === 0
        )
          continue;
        if (asset[legacy] === undefined)
          throw new Error("旧流程不能清除素材的原始尺寸或资源引用，请使用新版素材管理");
        patch[canonical] =
          legacy === "durationFrames" ? ticks(asset.durationFrames) : asset[legacy];
      }
    if (metadataKeys.some((key) => !same(old[key], asset[key]))) {
      const metadata = structuredClone(current.metadata ?? {});
      for (const key of metadataKeys)
        if (!same(old[key], asset[key])) {
          if (asset[key] === undefined) delete metadata[key];
          else metadata[key] = structuredClone(asset[key]) as JsonData;
        }
      patch.metadata = metadata;
    }
    if (Object.keys(patch).length) {
      const operation: EditorOperation = { type: "asset.update", assetId: asset.id, patch };
      if (typeof patch.duration === "number" && patch.duration < current.duration)
        lateAssets.push(operation);
      else append([operation]);
    }
  }
  for (const asset of before.assets)
    if (!after.assets.some((item) => item.id === asset.id))
      lateAssets.push({ type: "asset.remove", assetId: asset.id });
  if (before.name !== after.name) append([{ type: "project.rename", name: after.name }]);
  const settings: Partial<Pick<EditorSequence, "width" | "height" | "timelineMode">> = {};
  if (before.width !== after.width) settings.width = after.width;
  if (before.height !== after.height) settings.height = after.height;
  if (before.timelineMode !== after.timelineMode) {
    if (!currentView.timelineComplete)
      throw new Error("当前旧视图不完整，不能通过旧流程切换时间线模式");
    settings.timelineMode = after.timelineMode ?? "magnetic";
  }
  if (Object.keys(settings).length)
    append([{ type: "sequence.update", sequenceId, patch: settings }]);
  const oldRows: Record<Collection, Array<(Clip & { startFrame?: number }) | Caption>> = {
    clips: timelineClips(before),
    audioClips: before.audioClips ?? [],
    captions: before.captions,
  };
  const newRows: typeof oldRows = {
    clips: timelineClips(after),
    audioClips: after.audioClips ?? [],
    captions: after.captions,
  };
  const temporal = (row: Clip | Caption) =>
    "assetId" in row
      ? [row.assetId, row.inFrame, row.outFrame, row.startFrame]
      : [row.startFrame, row.endFrame];
  for (const collection of ["clips", "audioClips", "captions"] as const)
    for (const old of oldRows[collection]) {
      const next = newRows[collection].find((item) => item.id === old.id);
      if ((!next || !same(temporal(old), temporal(next))) && !currentView.timelineComplete)
        throw new Error(
          "旧视图未包含全部片段，无法安全删除、移动或裁剪现有时间线；请使用新版时间线工具",
        );
    }
  // Recognize a lossless two-piece legacy split before considering its right half a new raw clip.
  for (const collection of ["clips", "audioClips"] as const)
    for (const old of oldRows[collection] as AudioClip[]) {
      const left = (newRows[collection] as AudioClip[]).find((item) => item.id === old.id);
      if (
        !left ||
        left.assetId !== old.assetId ||
        left.inFrame !== old.inFrame ||
        left.outFrame >= old.outFrame
      )
        continue;
      const matches = (newRows[collection] as AudioClip[]).filter(
        (item) =>
          !oldRows[collection].some((row) => row.id === item.id) &&
          !newlyMapped.has(`${collection}:${item.id}`) &&
          item.assetId === old.assetId &&
          item.inFrame === left.outFrame &&
          item.outFrame === old.outFrame &&
          item.startFrame === left.startFrame + left.outFrame - left.inFrame,
      );
      if (matches.length !== 1) continue;
      const mapping = mapped.get(`${collection}:${old.id}`)!,
        right = mapNew(collection, matches[0]!.id, mapping.trackId);
      right.volumeWritable = mapping.volumeWritable;
      splitBaselines.set(`${collection}:${right.legacyId}`, old);
      let first = true;
      append(
        splitClip(
          draft,
          sequenceId,
          mapping.clipId,
          find(mapping.clipId).start + ticks(left.outFrame - old.inFrame),
          () => {
            if (first) {
              first = false;
              return right.clipId;
            }
            return allocate(used, `${mapping.clipId.slice(0, 80)}-caption-split`);
          },
        ),
      );
    }
  // Explicit removals use the canonical cascade for owned subtitles and transitions.
  for (const collection of ["clips", "audioClips", "captions"] as const)
    for (const old of oldRows[collection])
      if (!newRows[collection].some((item) => item.id === old.id)) {
        const mapping = mapped.get(`${collection}:${old.id}`)!;
        if (sequence().clips.some((clip) => clip.id === mapping.clipId))
          append([{ type: "clip.remove", sequenceId, clipIds: [mapping.clipId] }]);
      }
  const destinations = new Map<string, number>();
  for (const collection of ["clips", "audioClips"] as const)
    for (const next of newRows[collection] as AudioClip[]) {
      let mapping =
        mapped.get(`${collection}:${next.id}`) ?? newlyMapped.get(`${collection}:${next.id}`);
      const old = (oldRows[collection] as AudioClip[]).find((item) => item.id === next.id);
      if (!mapping) {
        const asset = after.assets.find((asset) => asset.id === next.assetId)!;
        let trackId: string;
        if (collection === "audioClips") {
          trackId = allocate(used, `track-legacy-${next.id.slice(0, 85)}`);
          append([
            {
              type: "track.add",
              sequenceId,
              track: createTrack(trackId, "audio", asset.name.slice(0, 200)),
            },
          ]);
        } else
          trackId =
            asset.kind === "audio"
              ? track("primaryAudioTrackId", "audio")
              : track("primaryVideoTrackId", "video");
        mapping = mapNew(collection, next.id, trackId);
        const duration = ticks(next.outFrame - next.inFrame);
        append([
          {
            type: "clip.add",
            sequenceId,
            clip: {
              id: mapping.clipId,
              kind: "media",
              label: asset.name,
              trackId,
              assetId: next.assetId,
              start: ticks(next.startFrame),
              duration,
              timeMap:
                asset.kind === "image" &&
                draft.assets.find((item) => item.id === asset.id)!.duration === 0
                  ? freezeTimeMap(0, duration)
                  : {
                      points: [
                        { time: 0, source: ticks(next.inFrame) },
                        { time: duration, source: ticks(next.outFrame) },
                      ],
                    },
              transform: defaultTransform(),
              color: defaultColorAdjustment(),
              blendMode: "normal",
              audio: { ...defaultAudioMix(), volume: next.volume },
            },
          },
        ]);
        continue;
      }
      const clip = find(mapping.clipId);
      if (clip.kind !== "media") throw new Error("旧媒体映射已失效");
      if (old && next.assetId !== old.assetId)
        throw new Error("旧流程不能替换现有片段的源素材，请使用新版素材替换");
      const image = staticImage(clip, draft.assets);
      // Legacy image ranges are display offsets. A just-split right half still
      // uses its old display offset until the next projection normalizes it.
      const sourceStart = image
          ? ticks(old?.inFrame ?? next.inFrame)
          : clip.timeMap.points[0]!.source,
        sourceEnd = sourceStart + clip.duration;
      if (ticks(next.inFrame) !== sourceStart || ticks(next.outFrame) !== sourceEnd) {
        if (ticks(next.inFrame) < sourceStart || ticks(next.outFrame) > sourceEnd) {
          assertStaticExtension(clip, sequence());
          const start = ticks(next.inFrame),
            end = ticks(next.outFrame);
          const asset = draft.assets.find((asset) => asset.id === clip.assetId)!;
          if (
            (!image && !exactMedia(clip)) ||
            start > sourceStart ||
            end < sourceEnd ||
            start < 0 ||
            (!image && end > asset.duration)
          )
            throw new Error(
              "旧流程只能在原素材范围内延长平直原速片段，滑移或变速请使用新版裁剪工具",
            );
          const duration = end - start;
          // Magnetic followers must move out of the extended range before validating this duration.
          extensions.push({
            type: "clip.update",
            sequenceId,
            clipId: clip.id,
            patch: {
              duration,
              timeMap: image
                ? freezeTimeMap(0, duration)
                : {
                    points: [
                      { time: 0, source: start },
                      { time: duration, source: end },
                    ],
                  },
            },
          });
        } else
          append(
            trimClip(
              draft,
              sequenceId,
              mapping.clipId,
              ticks(next.inFrame) - sourceStart,
              ticks(next.outFrame) - sourceStart,
            ),
          );
      }
      const scalarBefore = old ?? splitBaselines.get(`${collection}:${next.id}`);
      if (scalarBefore && scalarBefore.volume !== next.volume) {
        if (!mapping.volumeWritable) throw new Error("此片段的自动化音量需要在新版属性面板中修改");
        const current = find(mapping.clipId) as MediaClip;
        // Cropping a fade may create a gain envelope. Changing the legacy scalar
        // cannot replace that newly preserved envelope without a v2 decision.
        if (typeof current.audio.volume !== "number")
          throw new Error("裁剪保留了音量包络，请在新版属性面板调整音量");
        append([
          {
            type: "clip.update",
            sequenceId,
            clipId: mapping.clipId,
            patch: { audio: { ...current.audio, volume: next.volume } },
          },
        ]);
      }
      if (
        !old ||
        old.startFrame !== next.startFrame ||
        find(mapping.clipId).start !== ticks(next.startFrame)
      )
        destinations.set(mapping.clipId, ticks(next.startFrame));
    }
  for (const next of after.captions) {
    const mapping = mapped.get(`captions:${next.id}`),
      old = before.captions.find((item) => item.id === next.id);
    if (!mapping) {
      const trackId = track("captionTrackId", "text"),
        added = mapNew("captions", next.id, trackId),
        template = captionTemplate(after);
      append([
        {
          type: "clip.add",
          sequenceId,
          clip: {
            ...template,
            id: added.clipId,
            trackId,
            label: next.text.replace(/\s+/g, " ").trim().slice(0, 80) || "字幕",
            text: next.text,
            start: ticks(next.startFrame),
            duration: ticks(next.endFrame - next.startFrame),
          },
        },
      ]);
      continue;
    }
    if (same(old, next)) continue;
    let clip = find(mapping.clipId);
    if (clip.kind !== "text") throw new Error("旧字幕映射已失效");
    if (old!.text !== next.text) {
      if (clip.words.length || clip.translation)
        throw new Error("包含逐词时间或翻译的字幕须在新版文字面板修改内容");
      append([
        {
          type: "clip.update",
          sequenceId,
          clipId: clip.id,
          patch: {
            text: next.text,
            label: next.text.replace(/\s+/g, " ").trim().slice(0, 80) || "字幕",
          },
        },
      ]);
    }
    const length = ticks(next.endFrame - next.startFrame);
    if (
      old!.endFrame - old!.startFrame !== next.endFrame - next.startFrame &&
      clip.duration !== length
    ) {
      if (length > clip.duration) {
        assertStaticExtension(clip, sequence());
        append([{ type: "clip.update", sequenceId, clipId: clip.id, patch: { duration: length } }]);
      } else {
        const localStart = Math.max(
          0,
          Math.min(clip.duration - length, ticks(next.startFrame) - clip.start),
        );
        append(trimClip(draft, sequenceId, clip.id, localStart, localStart + length));
      }
      clip = find(clip.id);
    }
    if (old!.startFrame !== next.startFrame) destinations.set(clip.id, ticks(next.startFrame));
  }
  // Move connected groups once. Final explicit destinations must all agree with
  // canonical link/group/subtitle following; do not move a member a second time.
  const visited = new Set<string>();
  const positions = new Map(sequence().clips.map((clip) => [clip.id, clip.start]));
  const movement: EditorOperation[] = [];
  const moves = [...destinations].sort(([leftId, left], [rightId, right]) => {
    const leftClip = find(leftId),
      rightClip = find(rightId);
    const bound = (clip: EditorClip) => Number(clip.kind === "text" && !!clip.sourceBinding);
    return bound(leftClip) - bound(rightClip) || left - right;
  });
  for (const [id, destination] of moves) {
    if (visited.has(id)) continue;
    const delta = destination - positions.get(id)!;
    if (!delta) continue;
    const chosen = new Set([id]);
    for (;;) {
      const size = chosen.size;
      const members = sequence().clips.filter((clip) => chosen.has(clip.id));
      const groups = new Set(members.map((clip) => clip.groupId).filter(Boolean));
      const links = new Set(members.map((clip) => clip.linkGroupId).filter(Boolean));
      for (const clip of sequence().clips)
        if (
          (clip.groupId && groups.has(clip.groupId)) ||
          (clip.linkGroupId && links.has(clip.linkGroupId))
        )
          chosen.add(clip.id);
      if (chosen.size === size) break;
    }
    movement.push({ type: "clip.move", sequenceId, clipIds: [id], delta });
    for (const clip of sequence().clips)
      if (
        chosen.has(clip.id) ||
        (clip.kind === "text" && clip.sourceBinding && chosen.has(clip.sourceBinding.clipId))
      ) {
        positions.set(clip.id, positions.get(clip.id)! + delta);
        visited.add(clip.id);
        if (destinations.has(clip.id) && destinations.get(clip.id) !== positions.get(clip.id))
          throw new Error("旧流程请求了不一致的成组移动，请使用新版分组工具");
      }
  }
  // Reordering adjacent clips can overlap temporarily. Validate the complete
  // move/extension transaction, while canonical operations still enforce locks.
  append([...movement, ...extensions]);
  // A legacy request that leaves one group member stationary must not secretly move it.
  for (const mapping of currentView.clips) {
    const next = newRows[mapping.collection].find((item) => item.id === mapping.legacyId);
    if (!next || !visited.has(mapping.clipId)) continue;
    const original = sequenceOf(document, sequenceId).clips.find(
      (clip) => clip.id === mapping.clipId,
    )!;
    if (original.kind === "text" && original.sourceBinding && !destinations.has(original.id))
      continue;
    if (find(mapping.clipId).start !== ticks(next.startFrame!))
      throw new Error("旧流程不能单独移动已分组或关联的片段");
  }
  let production = structuredClone(document.production ?? {});
  for (const field of annotationKeys)
    if (!same(before[field], after[field])) {
      if (
        currentView.restrictions.some(
          (item) => item.code === "annotation-unavailable" && item.field === field,
        )
      )
        throw new Error("此制作流程数据没有完整投影，请使用新版流程界面修改");
      if (after[field] === undefined) delete production[field];
      else production[field] = structuredClone(after[field]) as JsonData;
    }
  if (before.captionStyle !== after.captionStyle) {
    if (
      !currentView.timelineComplete ||
      currentView.clips.some(
        (mapping) =>
          mapping.collection === "captions" &&
          !legacyPreset(
            sequenceOf(document, sequenceId).clips.find(
              (clip) => clip.id === mapping.clipId,
            ) as TextClip,
            sequenceOf(document, sequenceId),
          ),
      )
    )
      throw new Error("自定义或未完整投影的字幕不能套用旧版全局样式，请使用新版文字面板");
    const style = captionTemplate(after).style;
    for (const clip of sequence().clips.filter(
      (clip) => clip.kind === "text" && clip.role === "subtitle",
    ))
      append([{ type: "clip.update", sequenceId, clipId: clip.id, patch: { style } }]);
    production.legacyCaptionStyle = after.captionStyle ?? "classic";
  }
  if (!same(trackIds, currentView.tracks)) {
    const previous = Array.isArray(production.legacyTracks) ? production.legacyTracks : [];
    production.legacyTracks = [
      ...previous.filter(
        (item) =>
          !item ||
          typeof item !== "object" ||
          Array.isArray(item) ||
          item.sequenceId !== sequenceId,
      ),
      { sequenceId, ...trackIds },
    ];
  }
  if (aliases.length || Array.isArray(production.legacyAliases)) {
    const alive = new Set(sequence().clips.map((clip) => clip.id));
    const added = new Set([...newlyMapped.values()].map((item) => item.clipId));
    const previous = Array.isArray(production.legacyAliases) ? production.legacyAliases : [];
    production.legacyAliases = [
      ...previous.filter(
        (item) =>
          !item ||
          typeof item !== "object" ||
          Array.isArray(item) ||
          item.sequenceId !== sequenceId ||
          (typeof item.clipId === "string" && alive.has(item.clipId) && !added.has(item.clipId)),
      ),
      ...aliases,
    ];
  }
  if (!same(production, document.production ?? {}))
    append([{ type: "project.production", data: production }]);
  append(lateAssets);
  applyEditorOperations(document, operations, baseRevision);
  return structuredClone(operations);
}
/** The editor clip behind an old independent-audio row the user selected in the frame view. */
export function editorClipIdForLegacyAudio(
  view: Pick<LegacyProjectView, "clips">,
  legacyId: string,
): string | undefined {
  return view.clips.find((item) => item.collection === "audioClips" && item.legacyId === legacyId)
    ?.clipId;
}
