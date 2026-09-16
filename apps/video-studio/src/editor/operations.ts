import type { ExportProfile } from "./export-settings";
import type { Tick } from "./time";
import type {
  EditorClip,
  EditorDocument,
  EditorSequence,
  EditorTrack,
  EditorAsset,
  TimelineMarker,
  Transition,
} from "./types";
import { validateEditorDocument } from "./validation";
import { reconcileDependentCaptions } from "./caption-bindings";

/** Optional clip properties can be removed with JSON null; supplied properties replace whole values. */
export type EditorClipPatch<T extends EditorClip = EditorClip> = T extends EditorClip
  ? {
      [K in Exclude<keyof T, "id" | "kind">]?: undefined extends T[K]
        ? Exclude<T[K], undefined> | null
        : T[K];
    }
  : never;

export type EditorOperation =
  | { type: "asset.add"; asset: EditorAsset }
  | { type: "asset.update"; assetId: string; patch: Partial<Omit<EditorAsset, "id">> }
  | { type: "asset.remove"; assetId: string }
  | { type: "sequence.add"; sequence: EditorSequence; index?: number }
  | {
      type: "sequence.update";
      sequenceId: string;
      patch: Partial<
        Pick<
          EditorSequence,
          | "name"
          | "width"
          | "height"
          | "frameRate"
          | "background"
          | "timelineMode"
          | "magneticTrackId"
        >
      >;
    }
  | { type: "sequence.remove"; sequenceId: string }
  | { type: "sequence.rename"; sequenceId: string; name: string }
  | { type: "sequence.activate"; sequenceId: string }
  | { type: "track.add"; sequenceId: string; track: EditorTrack; index?: number }
  | {
      type: "track.update";
      sequenceId: string;
      trackId: string;
      patch: Partial<Omit<EditorTrack, "id">>;
    }
  | { type: "track.remove"; sequenceId: string; trackId: string; removeClips?: boolean }
  | { type: "track.reorder"; sequenceId: string; trackIds: string[] }
  | { type: "clip.add"; sequenceId: string; clip: EditorClip }
  | { type: "clip.update"; sequenceId: string; clipId: string; patch: EditorClipPatch }
  | { type: "clip.remove"; sequenceId: string; clipIds: string[] }
  | { type: "clip.move"; sequenceId: string; clipIds: string[]; delta: Tick; trackId?: string }
  | { type: "marker.add"; sequenceId: string; marker: TimelineMarker }
  | {
      type: "marker.update";
      sequenceId: string;
      markerId: string;
      patch: Partial<Omit<TimelineMarker, "id">>;
    }
  | { type: "marker.remove"; sequenceId: string; markerId: string }
  | { type: "transition.add"; sequenceId: string; transition: Transition }
  | { type: "transition.remove"; sequenceId: string; transitionId: string }
  | { type: "project.rename"; name: string }
  | { type: "project.production"; data: EditorDocument["production"] | null }
  | { type: "project.exportProfiles"; profiles: ExportProfile[] };

const OPERATION_KEYS: Record<EditorOperation["type"], readonly string[]> = {
  "asset.add": ["type", "asset"],
  "asset.update": ["type", "assetId", "patch"],
  "asset.remove": ["type", "assetId"],
  "sequence.add": ["type", "sequence", "index"],
  "sequence.update": ["type", "sequenceId", "patch"],
  "sequence.remove": ["type", "sequenceId"],
  "sequence.rename": ["type", "sequenceId", "name"],
  "sequence.activate": ["type", "sequenceId"],
  "track.add": ["type", "sequenceId", "track", "index"],
  "track.update": ["type", "sequenceId", "trackId", "patch"],
  "track.remove": ["type", "sequenceId", "trackId", "removeClips"],
  "track.reorder": ["type", "sequenceId", "trackIds"],
  "clip.add": ["type", "sequenceId", "clip"],
  "clip.update": ["type", "sequenceId", "clipId", "patch"],
  "clip.remove": ["type", "sequenceId", "clipIds"],
  "clip.move": ["type", "sequenceId", "clipIds", "delta", "trackId"],
  "marker.add": ["type", "sequenceId", "marker"],
  "marker.update": ["type", "sequenceId", "markerId", "patch"],
  "marker.remove": ["type", "sequenceId", "markerId"],
  "transition.add": ["type", "sequenceId", "transition"],
  "transition.remove": ["type", "sequenceId", "transitionId"],
  "project.rename": ["type", "name"],
  "project.production": ["type", "data"],
  "project.exportProfiles": ["type", "profiles"],
};
const BASE_CLIP_KEYS = ["trackId", "start", "duration", "label", "groupId", "linkGroupId"];
const VISUAL_KEYS = ["transform", "color", "blendMode", "mask"];
const CLIP_PATCH_KEYS: Record<EditorClip["kind"], readonly string[]> = {
  media: [...BASE_CLIP_KEYS, ...VISUAL_KEYS, "assetId", "timeMap", "audio"],
  sequence: [...BASE_CLIP_KEYS, ...VISUAL_KEYS, "sequenceId", "timeMap", "audio"],
  multicam: [
    ...BASE_CLIP_KEYS,
    ...VISUAL_KEYS,
    "timeMap",
    "angles",
    "switches",
    "audioAngleId",
    "audio",
  ],
  text: [
    ...BASE_CLIP_KEYS,
    ...VISUAL_KEYS,
    "role",
    "text",
    "style",
    "words",
    "sourceBinding",
    "translation",
  ],
  shape: [...BASE_CLIP_KEYS, ...VISUAL_KEYS, "shape", "fill", "stroke", "strokeWidth"],
};
const OPTIONAL_CLIP_KEYS = new Set([
  "groupId",
  "linkGroupId",
  "mask",
  "sourceBinding",
  "translation",
]);
const TRACK_PATCH_KEYS = ["name", "kind", "locked", "hidden", "muted", "volume", "pan"];
const MARKER_PATCH_KEYS = ["time", "duration", "name", "note", "color"];

function object(
  value: unknown,
  allowed: readonly string[] | undefined,
  label: string,
): Record<string, any> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some(
      (key) =>
        typeof key !== "string" ||
        (allowed && !allowed.includes(key)) ||
        !Object.getOwnPropertyDescriptor(value, key)?.enumerable ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"),
    )
  )
    throw new Error(`${label}格式无效或包含未知字段`);
  return value as Record<string, any>;
}
function array(value: unknown, min: number, max: number, label: string): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < min ||
    value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    throw new Error(`${label}必须是包含 ${min} 至 ${max} 项的普通数组`);
  for (let position = 0; position < value.length; position++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(position));
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable)
      throw new Error(`${label}不能包含空项或动态属性`);
  }
  return value;
}
function id(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.length > 128) throw new Error(`${label}无效`);
  return value;
}
function ids(value: unknown): string[] {
  const result = array(value, 1, 10000, "片段选择").map((item) => id(item, "片段 ID"));
  if (new Set(result).size !== result.length) throw new Error("片段 ID 不能重复");
  return result;
}
function index(value: unknown, length: number): number {
  if (value === undefined) return length;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > length)
    throw new Error("插入位置超出范围");
  return Number(value);
}
function sequence(document: EditorDocument, sequenceId: unknown): EditorSequence {
  const found = document.sequences.find((item) => item.id === id(sequenceId, "时间线 ID"));
  if (!found) throw new Error(`时间线不存在：${sequenceId}`);
  return found;
}
function track(sequence: EditorSequence, trackId: unknown): EditorTrack {
  const found = sequence.tracks.find((item) => item.id === id(trackId, "轨道 ID"));
  if (!found) throw new Error(`轨道不存在：${trackId}`);
  return found;
}
function clip(sequence: EditorSequence, clipId: unknown): EditorClip {
  const found = sequence.clips.find((item) => item.id === id(clipId, "片段 ID"));
  if (!found) throw new Error(`片段不存在：${clipId}`);
  return found;
}
function unlocked(item: EditorTrack): void {
  if (item.locked) throw new Error(`轨道“${item.name}”已锁定，请先解锁`);
}
function checkClipTracks(sequence: EditorSequence, clips: readonly EditorClip[]): void {
  for (const item of clips) unlocked(track(sequence, item.trackId));
}
function checkTransitionTracks(sequence: EditorSequence, transition: Transition): void {
  checkClipTracks(sequence, [
    clip(sequence, transition.fromClipId),
    clip(sequence, transition.toClipId),
  ]);
}
function patch(
  target: object,
  updates: Record<string, unknown>,
  clearKeys: ReadonlySet<string> = new Set(),
): void {
  const destination = target as Record<string, unknown>;
  for (const key of Object.keys(updates)) {
    if (updates[key] === null && clearKeys.has(key)) delete destination[key];
    else destination[key] = structuredClone(updates[key]);
  }
}

/** Removing an owner deletes only subtitles explicitly bound to that owner, including cross-track bindings. */
function removeClips(sequence: EditorSequence, selectedIds: string[]): void {
  const removing = new Set(selectedIds);
  for (const clipId of removing) clip(sequence, clipId);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of sequence.clips) {
      if (
        item.kind === "text" &&
        item.role === "subtitle" &&
        item.sourceBinding &&
        removing.has(item.sourceBinding.clipId) &&
        !removing.has(item.id)
      ) {
        removing.add(item.id);
        changed = true;
      }
    }
  }
  checkClipTracks(
    sequence,
    sequence.clips.filter((item) => removing.has(item.id)),
  );
  const removedTransitions = sequence.transitions.filter(
    (item) => removing.has(item.fromClipId) || removing.has(item.toClipId),
  );
  for (const transition of removedTransitions) checkTransitionTracks(sequence, transition);
  sequence.transitions = sequence.transitions.filter((item) => !removedTransitions.includes(item));
  sequence.clips = sequence.clips.filter((item) => !removing.has(item.id));
}

function moveClips(sequence: EditorSequence, data: Record<string, any>): void {
  const selection = ids(data.clipIds).map((clipId) => clip(sequence, clipId));
  if (!Number.isSafeInteger(data.delta)) throw new Error("移动距离必须是安全整数刻度");
  const chosen = new Set(selection.map((item) => item.id));
  for (;;) {
    const size = chosen.size;
    const members = sequence.clips.filter((item) => chosen.has(item.id));
    const groups = new Set(members.map((item) => item.groupId).filter(Boolean));
    const links = new Set(members.map((item) => item.linkGroupId).filter(Boolean));
    for (const item of sequence.clips)
      if (
        (item.groupId && groups.has(item.groupId)) ||
        (item.linkGroupId && links.has(item.linkGroupId))
      )
        chosen.add(item.id);
    if (chosen.size === size) break;
  }
  const moving = sequence.clips.filter(
    (item) =>
      chosen.has(item.id) ||
      (item.kind === "text" && item.sourceBinding && chosen.has(item.sourceBinding.clipId)),
  );
  checkClipTracks(sequence, moving);
  const anchorIndex = sequence.tracks.findIndex((item) => item.id === selection[0]!.trackId);
  const trackShift =
    data.trackId === undefined
      ? 0
      : sequence.tracks.indexOf(track(sequence, data.trackId)) - anchorIndex;
  const positions = moving.map((item) => {
    const start = item.start + data.delta;
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(start + item.duration))
      throw new Error("移动后的片段超出时间范围");
    const destination = !chosen.has(item.id)
      ? track(sequence, item.trackId)
      : sequence.tracks[
          sequence.tracks.findIndex((candidate) => candidate.id === item.trackId) + trackShift
        ];
    if (!destination) throw new Error("成组移动超出轨道范围");
    unlocked(destination);
    return { item, start, trackId: destination.id };
  });
  const movedIds = new Set(moving.map((item) => item.id));
  for (const transition of sequence.transitions) {
    const fromMoved = movedIds.has(transition.fromClipId),
      toMoved = movedIds.has(transition.toClipId);
    if (fromMoved || toMoved) checkTransitionTracks(sequence, transition);
    if (fromMoved && toMoved) {
      const start = transition.start + data.delta;
      if (!Number.isSafeInteger(start) || start < 0) throw new Error("移动后的转场超出时间范围");
      transition.start = start;
    }
  }
  for (const position of positions) {
    position.item.start = position.start;
    position.item.trackId = position.trackId;
  }
}

/**
 * One transaction returns one detached document and advances its revision exactly once.
 * Cross-sequence dependencies are checked on the final graph, allowing one transaction
 * to repair references before it becomes visible. Track locks are checked at each step.
 */
export function applyEditorOperations(
  document: EditorDocument,
  operations: readonly EditorOperation[],
  baseRevision: number,
): EditorDocument {
  const next = structuredClone(validateEditorDocument(document));
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0 || next.revision !== baseRevision)
    throw new Error(`工程已更新（当前修订 ${next.revision}），请刷新后重试`);
  for (const raw of array(operations, 0, 10000, "编辑操作")) {
    const candidate = object(raw, undefined, "编辑操作");
    if (typeof candidate.type !== "string" || !Object.hasOwn(OPERATION_KEYS, candidate.type))
      throw new Error("不支持此编辑操作");
    const type = candidate.type as EditorOperation["type"];
    const data = object(candidate, OPERATION_KEYS[type], "编辑操作");
    if (type === "project.rename") next.name = data.name;
    else if (type === "project.production") {
      if (data.data === null) delete next.production;
      else next.production = structuredClone(object(data.data, undefined, "制作流程数据"));
    } else if (type === "project.exportProfiles")
      next.exportProfiles = structuredClone(data.profiles);
    else if (type === "asset.add") {
      const added = structuredClone(object(data.asset, undefined, "新素材")) as EditorAsset;
      if (next.assets.some((item) => item.id === id(added.id, "素材 ID")))
        throw new Error("素材 ID 已存在");
      next.assets.push(added);
    } else if (type === "asset.update" || type === "asset.remove") {
      const target = next.assets.find((item) => item.id === id(data.assetId, "素材 ID"));
      if (!target) throw new Error("素材不存在");
      if (type === "asset.remove") next.assets.splice(next.assets.indexOf(target), 1);
      else
        patch(
          target,
          object(
            data.patch,
            [
              "name",
              "kind",
              "duration",
              "width",
              "height",
              "resourceId",
              "fingerprint",
              "metadata",
            ],
            "素材修改",
          ),
        );
      // Reference and source-range integrity is validated once for the whole
      // transaction, allowing explicit replacement/removal of dependent clips.
    } else if (type === "sequence.add") {
      const added = structuredClone(object(data.sequence, undefined, "新时间线")) as EditorSequence;
      if (next.sequences.some((item) => item.id === id(added.id, "时间线 ID")))
        throw new Error("时间线 ID 已存在");
      next.sequences.splice(index(data.index, next.sequences.length), 0, added);
    } else {
      const current = sequence(next, data.sequenceId);
      if (type === "sequence.rename") current.name = data.name;
      else if (type === "sequence.update")
        patch(
          current,
          object(
            data.patch,
            [
              "name",
              "width",
              "height",
              "frameRate",
              "background",
              "timelineMode",
              "magneticTrackId",
            ],
            "时间线设置",
          ),
        );
      else if (type === "sequence.activate") next.activeSequenceId = current.id;
      else if (type === "sequence.remove") {
        if (current.id === next.activeSequenceId)
          throw new Error("请先切换到其他时间线再删除当前时间线");
        for (const item of current.tracks) unlocked(item);
        next.sequences.splice(next.sequences.indexOf(current), 1);
      } else if (type === "track.add") {
        const added = structuredClone(object(data.track, undefined, "新轨道")) as EditorTrack;
        if (current.tracks.some((item) => item.id === id(added.id, "轨道 ID")))
          throw new Error("轨道 ID 已存在");
        current.tracks.splice(index(data.index, current.tracks.length), 0, added);
      } else if (type === "track.update") {
        const target = track(current, data.trackId),
          updates = object(data.patch, TRACK_PATCH_KEYS, "轨道修改");
        if (target.locked && !(Object.keys(updates).length === 1 && updates.locked === false))
          unlocked(target);
        patch(target, updates);
      } else if (type === "track.remove") {
        const target = track(current, data.trackId);
        unlocked(target);
        if (data.removeClips !== undefined && typeof data.removeClips !== "boolean")
          throw new Error("删除片段选项无效");
        const contents = current.clips.filter((item) => item.trackId === target.id);
        if (contents.length && data.removeClips !== true)
          throw new Error("轨道仍有片段，请明确同时删除轨道内片段");
        if (contents.length)
          removeClips(
            current,
            contents.map((item) => item.id),
          );
        current.tracks.splice(current.tracks.indexOf(target), 1);
      } else if (type === "track.reorder") {
        const trackIds = array(
          data.trackIds,
          current.tracks.length,
          current.tracks.length,
          "轨道排序",
        );
        if (new Set(trackIds).size !== current.tracks.length)
          throw new Error("轨道排序必须完整且不能重复");
        const ordered = trackIds.map((trackId: unknown) => track(current, trackId));
        for (const locked of current.tracks.filter((item) => item.locked)) {
          const previous = current.tracks.indexOf(locked),
            nextIndex = ordered.indexOf(locked);
          if (
            current.tracks.some(
              (item, i) => item !== locked && i < previous !== ordered.indexOf(item) < nextIndex,
            )
          )
            unlocked(locked);
        }
        current.tracks = ordered;
      } else if (type === "clip.add") {
        const added = structuredClone(object(data.clip, undefined, "新片段")) as EditorClip;
        if (current.clips.some((item) => item.id === id(added.id, "片段 ID")))
          throw new Error("片段 ID 已存在");
        unlocked(track(current, added.trackId));
        current.clips.push(added);
      } else if (type === "clip.update") {
        const target = clip(current, data.clipId);
        if (!Object.hasOwn(CLIP_PATCH_KEYS, target.kind)) throw new Error("片段类型无效");
        const updates = object(data.patch, CLIP_PATCH_KEYS[target.kind], "片段修改");
        unlocked(track(current, target.trackId));
        if (Object.hasOwn(updates, "trackId")) unlocked(track(current, updates.trackId));
        patch(target, updates, OPTIONAL_CLIP_KEYS);
      } else if (type === "clip.remove") removeClips(current, ids(data.clipIds));
      else if (type === "clip.move") moveClips(current, data);
      else if (type === "marker.add") {
        const added = structuredClone(object(data.marker, undefined, "新标记")) as TimelineMarker;
        if (current.markers.some((item) => item.id === id(added.id, "标记 ID")))
          throw new Error("标记 ID 已存在");
        current.markers.push(added);
      } else if (type === "marker.update" || type === "marker.remove") {
        const target = current.markers.find((item) => item.id === id(data.markerId, "标记 ID"));
        if (!target) throw new Error("时间线标记不存在");
        if (type === "marker.update")
          patch(target, object(data.patch, MARKER_PATCH_KEYS, "标记修改"));
        else current.markers.splice(current.markers.indexOf(target), 1);
      } else if (type === "transition.add") {
        const added = structuredClone(object(data.transition, undefined, "新转场")) as Transition;
        if (current.transitions.some((item) => item.id === id(added.id, "转场 ID")))
          throw new Error("转场 ID 已存在");
        checkTransitionTracks(current, added);
        current.transitions.push(added);
      } else if (type === "transition.remove") {
        const target = current.transitions.find(
          (item) => item.id === id(data.transitionId, "转场 ID"),
        );
        if (!target) throw new Error("转场不存在");
        checkTransitionTracks(current, target);
        current.transitions.splice(current.transitions.indexOf(target), 1);
      }
    }
  }
  if (operations.length) {
    reconcileDependentCaptions(document, next);
    if (!Number.isSafeInteger(next.revision + 1)) throw new Error("工程修订号已超出范围");
    next.revision += 1;
  }
  return validateEditorDocument(next);
}
