import { randomId } from "../ids.js";
import { createTrack, defaultAudioMix, defaultColorAdjustment, defaultTransform } from "./defaults";
import { applyEditorOperations, type EditorOperation } from "./operations";
import { assertTick, sourceTimeAt, type FrameRate, type Tick } from "./time";
import type { EditorClip, EditorDocument, EditorSequence, SequenceClip, TextClip } from "./types";
import { sequenceDuration, validateEditorDocument } from "./validation";

export type SequenceIdFactory = (
  kind: "sequence" | "track" | "clip" | "group" | "link" | "transition" | "marker" | "angle",
) => string;
export interface SequenceEditPlan {
  operations: EditorOperation[];
  /** The sequence containing the returned selection. */
  sequenceId: string;
  clipIds: string[];
  /** Grouped, linked, caption-owned and transition-connected clips included by a compound. */
  includedClipIds?: string[];
  createdSequenceId?: string;
}
interface IdentityOptions {
  idFactory?: SequenceIdFactory;
}
const clone = <T>(value: T): T => structuredClone(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function sequence(doc: EditorDocument, id: string): EditorSequence {
  const result = doc.sequences.find((item) => item.id === id);
  if (!result) throw new Error("序列不存在");
  return result;
}
function fresh(doc: EditorDocument, factory?: SequenceIdFactory): SequenceIdFactory {
  const used = new Set<string>([doc.id, ...doc.assets.map((asset) => asset.id)]);
  for (const seq of doc.sequences) {
    used.add(seq.id);
    [...seq.tracks, ...seq.clips, ...seq.transitions, ...seq.markers].forEach((item) =>
      used.add(item.id),
    );
    seq.clips.forEach((clip) => {
      if (clip.groupId) used.add(clip.groupId);
      if (clip.linkGroupId) used.add(clip.linkGroupId);
      if (clip.kind === "multicam") clip.angles.forEach((angle) => used.add(angle.id));
    });
  }
  return (kind) => {
    const id = factory ? factory(kind) : `${kind}-${randomId()}`;
    if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) || used.has(id))
      throw new Error("新对象标识无效或重复");
    used.add(id);
    return id;
  };
}
function finish(doc: EditorDocument, plan: SequenceEditPlan): SequenceEditPlan {
  applyEditorOperations(doc, plan.operations, doc.revision);
  return clone(plan);
}
function unlocked(seq: EditorSequence, clip: EditorClip): void {
  if (seq.tracks.find((track) => track.id === clip.trackId)?.locked)
    throw new Error(`“${clip.label}”所在轨道已锁定`);
}
function neutralClip(clip: SequenceClip): boolean {
  return (
    !clip.mask &&
    clip.blendMode === "normal" &&
    same(clip.transform, defaultTransform()) &&
    same(clip.color, defaultColorAdjustment()) &&
    same(clip.audio, defaultAudioMix())
  );
}
function wrapper(id: string, child: EditorSequence, trackId: string, start: Tick): SequenceClip {
  const duration = sequenceDuration(child);
  if (!duration) throw new Error("空序列不能作为复合片段加入时间轴");
  return {
    id,
    kind: "sequence",
    sequenceId: child.id,
    label: child.name,
    trackId,
    start,
    duration,
    timeMap: {
      points: [
        { time: 0, source: 0 },
        { time: duration, source: duration },
      ],
    },
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
    audio: defaultAudioMix(),
  };
}

export function planCreateSequence(
  document: EditorDocument,
  options: IdentityOptions & {
    name: string;
    width: number;
    height: number;
    frameRate: FrameRate;
    background?: string;
    activate?: boolean;
  },
): SequenceEditPlan {
  const doc = validateEditorDocument(document),
    ids = fresh(doc, options.idFactory),
    id = ids("sequence");
  const seq: EditorSequence = {
    id,
    name: options.name,
    width: options.width,
    height: options.height,
    frameRate: clone(options.frameRate),
    background: options.background ?? "#000000",
    timelineMode: "free",
    tracks: [
      createTrack(ids("track"), "video", "画面"),
      createTrack(ids("track"), "audio", "声音"),
      createTrack(ids("track"), "text", "文字"),
    ],
    clips: [],
    transitions: [],
    markers: [],
  };
  return finish(doc, {
    operations: [
      { type: "sequence.add", sequence: seq },
      ...(options.activate === false
        ? []
        : [{ type: "sequence.activate", sequenceId: id } as const]),
    ],
    sequenceId: id,
    clipIds: [],
    createdSequenceId: id,
  });
}
export function planRenameSequence(
  document: EditorDocument,
  sequenceId: string,
  name: string,
): SequenceEditPlan {
  const doc = validateEditorDocument(document);
  sequence(doc, sequenceId);
  return finish(doc, {
    operations: [{ type: "sequence.rename", sequenceId, name }],
    sequenceId,
    clipIds: [],
  });
}
export function planRemoveSequence(
  document: EditorDocument,
  sequenceId: string,
  replacementId?: string,
): SequenceEditPlan {
  const doc = validateEditorDocument(document);
  sequence(doc, sequenceId);
  if (doc.sequences.length === 1) throw new Error("工程至少保留一个序列");
  if (
    doc.sequences.some((seq) =>
      seq.clips.some((clip) => clip.kind === "sequence" && clip.sequenceId === sequenceId),
    )
  )
    throw new Error("此序列仍被复合片段引用，请先移除引用");
  const nextId =
    doc.activeSequenceId === sequenceId
      ? (replacementId ?? doc.sequences.find((seq) => seq.id !== sequenceId)!.id)
      : doc.activeSequenceId;
  if (nextId === sequenceId) throw new Error("请选择另一个当前序列");
  sequence(doc, nextId);
  return finish(doc, {
    operations: [
      ...(doc.activeSequenceId === sequenceId
        ? [{ type: "sequence.activate", sequenceId: nextId } as const]
        : []),
      { type: "sequence.remove", sequenceId },
    ],
    sequenceId: nextId,
    clipIds: [],
  });
}

interface CopyMap {
  sequenceId: string;
  tracks: Map<string, string>;
  clips: Map<string, string>;
  groups: Map<string, string>;
  links: Map<string, string>;
}
function copyMap(seq: EditorSequence, sequenceId: string, ids: SequenceIdFactory): CopyMap {
  const groups = new Map<string, string>(),
    links = new Map<string, string>();
  seq.clips.forEach((clip) => {
    if (clip.groupId && !groups.has(clip.groupId)) groups.set(clip.groupId, ids("group"));
    if (clip.linkGroupId && !links.has(clip.linkGroupId)) links.set(clip.linkGroupId, ids("link"));
  });
  return {
    sequenceId,
    tracks: new Map(seq.tracks.map((track) => [track.id, ids("track")])),
    clips: new Map(seq.clips.map((clip) => [clip.id, ids("clip")])),
    groups,
    links,
  };
}
function copyClip(
  doc: EditorDocument,
  original: EditorSequence,
  raw: EditorClip,
  maps: Map<string, CopyMap>,
  ids: SequenceIdFactory,
  shift = 0,
): EditorClip {
  const map = maps.get(original.id)!,
    clip = clone(raw);
  clip.id = map.clips.get(raw.id)!;
  clip.trackId = map.tracks.get(raw.trackId)!;
  clip.start += shift;
  if (clip.groupId) clip.groupId = map.groups.get(clip.groupId)!;
  if (clip.linkGroupId) clip.linkGroupId = map.links.get(clip.linkGroupId)!;
  if ("audio" in clip && clip.audio.ducking)
    clip.audio.ducking.sidechainTrackIds = clip.audio.ducking.sidechainTrackIds.map(
      (id) => map.tracks.get(id)!,
    );
  if (clip.kind === "sequence")
    clip.sequenceId = maps.get(clip.sequenceId)?.sequenceId ?? clip.sequenceId;
  if (clip.kind === "multicam") {
    const angles = new Map(clip.angles.map((angle) => [angle.id, ids("angle")]));
    clip.angles.forEach((angle) => {
      angle.id = angles.get(angle.id)!;
    });
    clip.switches.forEach((item) => {
      item.angleId = angles.get(item.angleId)!;
    });
    clip.audioAngleId = angles.get(clip.audioAngleId)!;
  }
  if (clip.kind === "text" && clip.sourceBinding) {
    const binding = clip.sourceBinding;
    let owner = original.clips.find((item) => item.id === binding.clipId)!;
    binding.clipId = map.clips.get(binding.clipId)!;
    if (binding.provenance)
      binding.provenance.path = binding.provenance.path.map((id) => {
        if (owner.kind !== "sequence") throw new Error("字幕来源路径无效");
        const child = sequence(doc, owner.sequenceId);
        owner = child.clips.find((item) => item.id === id)!;
        return maps.get(child.id)?.clips.get(id) ?? id;
      });
  }
  return clip;
}
/** Duplicate the complete nested sequence DAG once per source, sharing only immutable media assets. */
export function planDuplicateSequence(
  document: EditorDocument,
  sequenceId: string,
  options: IdentityOptions & { name?: string; activate?: boolean } = {},
): SequenceEditPlan {
  const doc = validateEditorDocument(document),
    source = sequence(doc, sequenceId),
    ids = fresh(doc, options.idFactory),
    closure: EditorSequence[] = [],
    visited = new Set<string>();
  const visit = (seq: EditorSequence) => {
    if (visited.has(seq.id)) return;
    visited.add(seq.id);
    closure.push(seq);
    seq.clips.forEach((clip) => {
      if (clip.kind === "sequence") visit(sequence(doc, clip.sequenceId));
    });
  };
  visit(source);
  const maps = new Map(closure.map((seq) => [seq.id, copyMap(seq, ids("sequence"), ids)]));
  const operations: EditorOperation[] = closure.map((seq) => {
    const map = maps.get(seq.id)!;
    return {
      type: "sequence.add",
      sequence: {
        ...clone(seq),
        id: map.sequenceId,
        ...(seq.magneticTrackId ? { magneticTrackId: map.tracks.get(seq.magneticTrackId)! } : {}),
        name: seq.id === source.id ? (options.name ?? `${seq.name} 副本`) : `${seq.name} 副本`,
        tracks: seq.tracks.map((track) => ({ ...clone(track), id: map.tracks.get(track.id)! })),
        clips: seq.clips.map((clip) => copyClip(doc, seq, clip, maps, ids)),
        transitions: seq.transitions.map((item) => ({
          ...clone(item),
          id: ids("transition"),
          fromClipId: map.clips.get(item.fromClipId)!,
          toClipId: map.clips.get(item.toClipId)!,
        })),
        markers: seq.markers.map((item) => ({ ...clone(item), id: ids("marker") })),
      },
    };
  });
  const id = maps.get(source.id)!.sequenceId;
  if (options.activate !== false) operations.push({ type: "sequence.activate", sequenceId: id });
  return finish(doc, { operations, sequenceId: id, clipIds: [], createdSequenceId: id });
}

export function planNestSequence(
  document: EditorDocument,
  parentId: string,
  childId: string,
  options: IdentityOptions & { at: Tick; trackId?: string },
): SequenceEditPlan {
  const doc = validateEditorDocument(document),
    parent = sequence(doc, parentId),
    child = sequence(doc, childId),
    ids = fresh(doc, options.idFactory);
  assertTick(options.at);
  const operations: EditorOperation[] = [];
  const trackId = options.trackId ?? ids("track");
  if (!options.trackId)
    operations.push({
      type: "track.add",
      sequenceId: parentId,
      track: createTrack(trackId, "video", child.name),
    });
  else if (parent.tracks.find((track) => track.id === trackId)?.kind !== "video")
    throw new Error("嵌套序列需要画面轨道");
  const clip = wrapper(ids("clip"), child, trackId, options.at);
  operations.push({ type: "clip.add", sequenceId: parentId, clip });
  return finish(doc, { operations, sequenceId: parentId, clipIds: [clip.id] });
}

function expanded(seq: EditorSequence, requested: string[]): Set<string> {
  if (!requested.length || requested.length > 2000 || new Set(requested).size !== requested.length)
    throw new Error("请选择 1 至 2000 个不同片段");
  const selected = new Set(requested);
  if (requested.some((id) => !seq.clips.some((clip) => clip.id === id)))
    throw new Error("选中片段已不存在");
  let changed = true;
  while (changed) {
    const previous = selected.size,
      groups = new Set<string>(),
      links = new Set<string>();
    for (const clip of seq.clips)
      if (selected.has(clip.id)) {
        if (clip.groupId) groups.add(clip.groupId);
        if (clip.linkGroupId) links.add(clip.linkGroupId);
        if (clip.kind === "text" && clip.sourceBinding) selected.add(clip.sourceBinding.clipId);
      }
    for (const clip of seq.clips)
      if (
        (clip.groupId && groups.has(clip.groupId)) ||
        (clip.linkGroupId && links.has(clip.linkGroupId)) ||
        (clip.kind === "text" && clip.sourceBinding && selected.has(clip.sourceBinding.clipId))
      )
        selected.add(clip.id);
    for (const transition of seq.transitions)
      if (selected.has(transition.fromClipId) || selected.has(transition.toClipId)) {
        selected.add(transition.fromClipId);
        selected.add(transition.toClipId);
      }
    changed = previous !== selected.size;
  }
  if (selected.size > 2000) throw new Error("联动片段超过 2000 个，请分批创建复合片段");
  return selected;
}
const overlaps = (clip: EditorClip, start: Tick, end: Tick) =>
  clip.start < end && clip.start + clip.duration > start;
function checkIsolation(
  seq: EditorSequence,
  selected: Set<string>,
  start: Tick,
  end: Tick,
): number {
  const inside = seq.clips.filter((clip) => selected.has(clip.id)),
    outside = seq.clips.filter((clip) => !selected.has(clip.id));
  const visual = inside.filter(
    (clip) => seq.tracks.find((track) => track.id === clip.trackId)!.kind !== "audio",
  );
  const indices = visual.map((clip) => seq.tracks.findIndex((track) => track.id === clip.trackId));
  const low = Math.min(...indices),
    high = Math.max(...indices);
  if (
    outside.some((clip) => {
      const index = seq.tracks.findIndex((track) => track.id === clip.trackId);
      return (
        seq.tracks[index]!.kind !== "audio" &&
        index >= low &&
        index <= high &&
        overlaps(clip, start, end)
      );
    })
  )
    throw new Error("选中画面之间夹有其他片段；请一起选择，保持原有叠放顺序");
  if (visual.some((clip) => clip.blendMode !== "normal"))
    throw new Error("混合模式依赖外层画面，当前不能无损创建复合片段");
  if (
    visual.some((clip) => clip.kind === "text" && clip.style.layout === "caption-stack") &&
    outside.some(
      (clip) =>
        clip.kind === "text" && clip.style.layout === "caption-stack" && overlaps(clip, start, end),
    )
  )
    throw new Error("上下叠放字幕需要一起创建复合片段，避免改变字幕位置");
  for (const clip of seq.clips) {
    if (!("audio" in clip) || !clip.audio.ducking) continue;
    const isInside = selected.has(clip.id);
    if (
      seq.clips.some(
        (other) =>
          selected.has(other.id) !== isInside &&
          clip.audio.ducking!.sidechainTrackIds.includes(other.trackId),
      )
    )
      throw new Error("自动压低音量跨越了所选范围，请一起选择相关声音片段");
  }
  return indices.length ? high + 1 : seq.tracks.length;
}
interface RouteStage {
  sequenceId: string;
  clip: EditorClip;
}
function route(doc: EditorDocument, seq: EditorSequence, caption: TextClip): RouteStage[] {
  if (!caption.sourceBinding) return [];
  let owner = seq.clips.find((clip) => clip.id === caption.sourceBinding!.clipId)!;
  const result: RouteStage[] = [{ sequenceId: seq.id, clip: owner }];
  for (const id of caption.sourceBinding.provenance?.path ?? []) {
    if (owner.kind !== "sequence") throw new Error("字幕来源路径无效");
    seq = sequence(doc, owner.sequenceId);
    owner = seq.clips.find((clip) => clip.id === id)!;
    result.push({ sequenceId: seq.id, clip: owner });
  }
  return result;
}

export function planCreateCompound(
  document: EditorDocument,
  sequenceId: string,
  clipIds: string[],
  options: IdentityOptions & { name: string },
): SequenceEditPlan {
  const doc = validateEditorDocument(document),
    parent = sequence(doc, sequenceId),
    ids = fresh(doc, options.idFactory),
    selected = expanded(parent, clipIds);
  const clips = parent.clips.filter((clip) => selected.has(clip.id));
  clips.forEach((clip) => unlocked(parent, clip));
  const start = Math.min(...clips.map((clip) => clip.start)),
    end = Math.max(...clips.map((clip) => clip.start + clip.duration));
  const trackIndex = checkIsolation(parent, selected, start, end),
    tracks = new Map(parent.tracks.map((track) => [track.id, ids("track")]));
  const child: EditorSequence = {
    ...clone(parent),
    id: ids("sequence"),
    name: options.name,
    background: "#00000000",
    timelineMode: "free",
    ...(parent.magneticTrackId ? { magneticTrackId: tracks.get(parent.magneticTrackId)! } : {}),
    tracks: parent.tracks.map((track) => ({ ...clone(track), id: tracks.get(track.id)! })),
    clips: clips.map((original) => {
      const clip = clone(original);
      clip.start -= start;
      clip.trackId = tracks.get(clip.trackId)!;
      if ("audio" in clip && clip.audio.ducking)
        clip.audio.ducking.sidechainTrackIds = clip.audio.ducking.sidechainTrackIds.map(
          (id) => tracks.get(id)!,
        );
      return clip;
    }),
    transitions: parent.transitions
      .filter((item) => selected.has(item.fromClipId))
      .map((item) => ({ ...clone(item), start: item.start - start })),
    markers: [],
  };
  const trackId = ids("track"),
    nested = wrapper(ids("clip"), child, trackId, start),
    operations: EditorOperation[] = [
      { type: "sequence.add", sequence: child },
      {
        type: "track.add",
        sequenceId,
        track: createTrack(
          trackId,
          clips.every(
            (clip) => parent.tracks.find((track) => track.id === clip.trackId)!.kind === "audio",
          )
            ? "audio"
            : "video",
          options.name,
        ),
        index: trackIndex,
      },
    ];
  for (const seq of doc.sequences)
    for (const caption of seq.clips) {
      if (
        caption.kind !== "text" ||
        !caption.sourceBinding ||
        (seq.id === sequenceId && selected.has(caption.id))
      )
        continue;
      const stages = route(doc, seq, caption),
        index = stages.findIndex(
          (stage) => stage.sequenceId === sequenceId && selected.has(stage.clip.id),
        );
      if (index < 0) continue;
      if (!caption.sourceBinding.provenance || index === 0)
        throw new Error("此字幕缺少跨序列来源记录，不能安全改写复合结构");
      unlocked(seq, caption);
      const sourceBinding = clone(caption.sourceBinding);
      sourceBinding.provenance!.path.splice(index - 1, 0, nested.id);
      operations.push({
        type: "clip.update",
        sequenceId: seq.id,
        clipId: caption.id,
        patch: { sourceBinding },
      });
    }
  operations.push(
    { type: "clip.remove", sequenceId, clipIds: [...selected] },
    { type: "clip.add", sequenceId, clip: nested },
  );
  return finish(doc, {
    operations,
    sequenceId,
    clipIds: [nested.id],
    includedClipIds: [...selected],
    createdSequenceId: child.id,
  });
}

/** Flatten only an untrimmed, full-speed, undecorated instance. Unsupported changes are rejected, never discarded. */
export function planUnpackCompound(
  document: EditorDocument,
  sequenceId: string,
  clipId: string,
  options: IdentityOptions = {},
): SequenceEditPlan {
  const doc = validateEditorDocument(document),
    parent = sequence(doc, sequenceId),
    raw = parent.clips.find((clip) => clip.id === clipId);
  if (!raw || raw.kind !== "sequence") throw new Error("请选择一个复合片段");
  const nested = raw,
    child = sequence(doc, nested.sequenceId),
    duration = sequenceDuration(child),
    ids = fresh(doc, options.idFactory);
  unlocked(parent, nested);
  const track = parent.tracks.find((item) => item.id === nested.trackId)!;
  if (
    track.kind === "audio" &&
    (!/^#[0-9a-f]{6}00$/i.test(child.background) ||
      child.clips.some(
        (clip) => child.tracks.find((item) => item.id === clip.trackId)!.kind !== "audio",
      ))
  )
    throw new Error("声音轨道中的复合包含不可见画面，请先移到画面轨道后解除复合");
  if (!neutralClip(nested) || track.hidden || track.muted || track.volume !== 1 || track.pan !== 0)
    throw new Error("复合片段或所在轨道已有整体效果，请先恢复默认效果后解除复合");
  if (nested.groupId || nested.linkGroupId)
    throw new Error("请先解除复合片段与其他片段的分组或链接");
  if (
    nested.duration !== duration ||
    nested.timeMap.points.some((point) => point.source !== point.time)
  )
    throw new Error("已裁剪、变速、倒放或定格的复合片段暂不能无损解除");
  if (parent.width !== child.width || parent.height !== child.height)
    throw new Error("不同画布尺寸的复合片段暂不能无损解除");
  if (parent.transitions.some((item) => item.fromClipId === clipId || item.toClipId === clipId))
    throw new Error("请先移除复合片段两端的转场");
  child.clips.forEach((clip) => unlocked(child, clip));
  if (
    parent.clips.some(
      (clip) => "audio" in clip && clip.audio.ducking?.sidechainTrackIds.includes(track.id),
    )
  )
    throw new Error("其他片段正在依据此复合轨道压低音量，暂不能解除复合");
  const opaque = /^#[0-9a-f]{6}(ff)?$/i.test(child.background);
  if (
    !opaque &&
    child.clips.some(
      (clip) =>
        child.tracks.find((item) => item.id === clip.trackId)!.kind !== "audio" &&
        clip.blendMode !== "normal",
    )
  )
    throw new Error("透明复合中的混合模式依赖独立画布，暂不能无损解除");
  if (
    child.clips.some((clip) => clip.kind === "text" && clip.style.layout === "caption-stack") &&
    parent.clips.some(
      (clip) =>
        clip.kind === "text" &&
        clip.style.layout === "caption-stack" &&
        overlaps(clip, nested.start, nested.start + nested.duration),
    )
  )
    throw new Error("解除后会改变上下叠放字幕的布局，请先调整字幕布局");
  const map = copyMap(child, parent.id, ids),
    maps = new Map([[child.id, map]]);
  const copied = child.clips.map((clip) => copyClip(doc, child, clip, maps, ids, nested.start));
  const operations: EditorOperation[] = [],
    index = parent.tracks.findIndex((item) => item.id === track.id);
  let insertion = index;
  // A sequence canvas is a real layer; preserve its background when dissolving the group boundary.
  if (!/^#[0-9a-f]{6}00$/i.test(child.background)) {
    const backgroundTrack = createTrack(ids("track"), "video", `${child.name} 背景`);
    operations.push(
      { type: "track.add", sequenceId, track: backgroundTrack, index: insertion++ },
      {
        type: "clip.add",
        sequenceId,
        clip: {
          id: ids("clip"),
          kind: "shape",
          shape: "rectangle",
          label: `${child.name} 背景`,
          trackId: backgroundTrack.id,
          start: nested.start,
          duration: nested.duration,
          transform: defaultTransform(),
          color: defaultColorAdjustment(),
          blendMode: "normal",
          fill: child.background,
          stroke: "#00000000",
          strokeWidth: 0,
        },
      },
    );
  }
  for (const original of child.tracks)
    operations.push({
      type: "track.add",
      sequenceId,
      track: { ...clone(original), id: map.tracks.get(original.id)! },
      index: insertion++,
    });
  copied.forEach((clip) => operations.push({ type: "clip.add", sequenceId, clip }));
  child.transitions.forEach((item) =>
    operations.push({
      type: "transition.add",
      sequenceId,
      transition: {
        ...clone(item),
        id: ids("transition"),
        start: item.start + nested.start,
        fromClipId: map.clips.get(item.fromClipId)!,
        toClipId: map.clips.get(item.toClipId)!,
      },
    }),
  );
  child.markers.forEach((item) =>
    operations.push({
      type: "marker.add",
      sequenceId,
      marker: { ...clone(item), id: ids("marker"), time: item.time + nested.start },
    }),
  );
  for (const seq of doc.sequences)
    for (const caption of seq.clips) {
      if (caption.kind !== "text" || !caption.sourceBinding) continue;
      const stages = route(doc, seq, caption),
        stageIndex = stages.findIndex(
          (stage) => stage.sequenceId === sequenceId && stage.clip.id === clipId,
        );
      if (stageIndex < 0) continue;
      const nextStage = stages[stageIndex + 1];
      if (!nextStage || !caption.sourceBinding.provenance)
        throw new Error("复合片段绑定字幕缺少具体素材来源，请先重新绑定或解除字幕绑定");
      unlocked(seq, caption);
      const sourceBinding = clone(caption.sourceBinding),
        newId = map.clips.get(nextStage.clip.id)!;
      if (stageIndex === 0) {
        const owner = copied.find((clip) => clip.id === newId)!;
        if (!("timeMap" in owner)) throw new Error("字幕来源没有素材时间映射");
        sourceBinding.clipId = newId;
        sourceBinding.provenance!.path.shift();
        const a = sourceTimeAt(owner.timeMap, Math.max(0, caption.start - owner.start)),
          b = sourceTimeAt(
            owner.timeMap,
            Math.min(owner.duration, caption.start + caption.duration - owner.start),
          );
        sourceBinding.sourceStart = Math.min(a, b);
        sourceBinding.sourceEnd = Math.max(a, b);
        if (sourceBinding.sourceStart === sourceBinding.sourceEnd)
          throw new Error("定格素材的绑定字幕暂不能跨层解除复合");
      } else sourceBinding.provenance!.path.splice(stageIndex - 1, 2, newId);
      operations.push({
        type: "clip.update",
        sequenceId: seq.id,
        clipId: caption.id,
        patch: { sourceBinding },
      });
    }
  operations.push({ type: "clip.remove", sequenceId, clipIds: [clipId] });
  return finish(doc, { operations, sequenceId, clipIds: copied.map((clip) => clip.id) });
}
