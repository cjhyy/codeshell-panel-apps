import {
  evaluateAnimatedNumber,
  sliceAnimatedNumber,
  type AnimatedNumber,
  type Keyframe,
} from "./animation";
import { applyEditorOperations, type EditorClipPatch, type EditorOperation } from "./operations";
import {
  assertTick,
  constantTimeMap,
  frameToTicks,
  freezeTimeMap,
  sliceTimeMap,
  sourceRangesToTimeline,
  sourceTimeAt,
  validateTimeMap,
  type Tick,
  type TimeMap,
} from "./time";
import type {
  EditorAsset,
  EditorClip,
  EditorDocument,
  EditorSequence,
  TextClip,
  Transition,
} from "./types";
import { MAX_EDITOR_TICK, sequenceDuration, validateEditorDocument } from "./validation";

export type ClipIdFactory = (kind: "clip" | "group" | "link" | "transition") => string;
export interface ClipClipboard {
  schemaVersion: 1;
  origin: Tick;
  sequenceId: string;
  /** Detached dependency snapshot for validation/import; never another editable project authority. */
  document: EditorDocument;
}
export interface PasteClipOptions {
  at: Tick;
  /** Map the lowest selected track here, retaining all selected tracks' relative offsets. */
  trackId?: string;
  /** Explicit same-kind map for a new-track duplicate; never changes the source. */
  trackMap?: Readonly<Record<string, string>>;
  idFactory: ClipIdFactory;
}
export interface SpeedCurvePoint {
  /** Position along the retained source interval, from 0 to 1, including both endpoints. */
  position: number;
  speed: number;
}

type SourceClip = Extract<EditorClip, { timeMap: TimeMap }>;
const transformKeys = ["x", "y", "scaleX", "scaleY", "rotation", "opacity"] as const;
const colorKeys = [
  "exposure",
  "brightness",
  "contrast",
  "saturation",
  "temperature",
  "tint",
  "hue",
] as const;
const transformBounds = {
  x: [-10, 10],
  y: [-10, 10],
  scaleX: [0, 100],
  scaleY: [0, 100],
  rotation: [-360000, 360000],
  opacity: [0, 1],
} as const;
const colorBounds = {
  exposure: [-10, 10],
  brightness: [-1, 1],
  contrast: [0, 4],
  saturation: [0, 4],
  temperature: [-1, 1],
  tint: [-1, 1],
  hue: [-360, 360],
} as const;
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const MAX_KEYS = 10000;
const GAIN_TOLERANCE = 1e-6;

function context(document: EditorDocument, sequenceId: string) {
  const snapshot = validateEditorDocument(document);
  const sequence = snapshot.sequences.find((sequence) => sequence.id === sequenceId);
  if (!sequence) throw new Error("时间线不存在，请刷新后重试");
  return { document: snapshot, sequence };
}
function findClip(sequence: EditorSequence, clipId: string): EditorClip {
  const clip = sequence.clips.find((clip) => clip.id === clipId);
  if (!clip) throw new Error("所选片段不存在，请刷新后重试");
  return clip;
}
function sourceClip(clip: EditorClip): SourceClip {
  if (!("timeMap" in clip)) throw new Error("变速、倒放与定格需要媒体或嵌套序列片段");
  return clip;
}
function selectedIds(sequence: EditorSequence, values: readonly string[]): Set<string> {
  if (
    !Array.isArray(values) ||
    !values.length ||
    values.length > 2000 ||
    new Set(values).size !== values.length ||
    values.some((id) => typeof id !== "string")
  )
    throw new Error("请选择有效且不重复的片段");
  for (const id of values) findClip(sequence, id);
  return new Set(values);
}
function allocate(document: EditorDocument, factory: ClipIdFactory) {
  if (typeof factory !== "function") throw new Error("需要新片段 ID 生成器");
  const used = new Set(
    document.sequences.flatMap((sequence) => [
      sequence.id,
      ...sequence.tracks.map((track) => track.id),
      ...sequence.transitions.map((transition) => transition.id),
      ...sequence.clips.flatMap((clip) => [clip.id, clip.groupId ?? "", clip.linkGroupId ?? ""]),
    ]),
  );
  return (kind: Parameters<ClipIdFactory>[0]) => {
    const id = factory(kind);
    if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id) || used.has(id))
      throw new Error("新片段或分组 ID 无效或已存在，请重新操作");
    used.add(id);
    return id;
  };
}
function finish(document: EditorDocument, operations: EditorOperation[]): EditorOperation[] {
  applyEditorOperations(document, operations, document.revision);
  return structuredClone(operations);
}
function update(sequenceId: string, before: EditorClip, after: EditorClip): EditorOperation {
  const { id: _id, kind: _kind, ...patch } = structuredClone(after);
  const updates: Record<string, unknown> = patch;
  for (const key of ["groupId", "linkGroupId", "mask", "sourceBinding", "translation"])
    if (Object.hasOwn(before, key) && !Object.hasOwn(after, key)) updates[key] = null;
  return { type: "clip.update", sequenceId, clipId: before.id, patch: updates as EditorClipPatch };
}
function assertNoTransition(sequence: EditorSequence, ids: ReadonlySet<string>): void {
  if (
    sequence.transitions.some(
      (transition) => ids.has(transition.fromClipId) || ids.has(transition.toClipId),
    )
  )
    throw new Error("所选片段连接着转场，请先移除转场，再切分、裁剪或变速");
}
function boundText(sequence: EditorSequence, owner: EditorClip): TextClip[] {
  return sequence.clips.filter(
    (clip): clip is TextClip => clip.kind === "text" && clip.sourceBinding?.clipId === owner.id,
  );
}

/** Adaptive linear automation preserves composed fades within 1e-6 sampled gain; never silently exceeds the key budget. */
function approximate(
  sample: (time: Tick) => number,
  start: Tick,
  end: Tick,
  anchors: Tick[],
  tolerance = GAIN_TOLERANCE,
): AnimatedNumber {
  const points = [
    ...new Set([start, end, ...anchors.filter((time) => time > start && time < end)]),
  ].sort((a, b) => a - b);
  const result: Keyframe[] = [];
  function add(time: Tick, value: number) {
    if (result.length >= MAX_KEYS) throw new Error("保留声音或动画需要过多关键帧，请先缩短片段");
    result.push({ time: time - start, value, easing: "linear" });
  }
  function segment(a: Tick, b: Tick, av: number, bv: number): void {
    const checks = [
      ...new Set([1, 2, 3].map((part) => a + Math.floor(((b - a) * part) / 4))),
    ].filter((t) => t > a && t < b);
    if (
      checks.some(
        (time) => Math.abs(sample(time) - (av + ((bv - av) * (time - a)) / (b - a))) > tolerance,
      )
    ) {
      const middle = a + Math.floor((b - a) / 2),
        value = sample(middle);
      segment(a, middle, av, value);
      segment(middle, b, value, bv);
    } else add(a, av);
  }
  for (let i = 0; i + 1 < points.length; i++)
    segment(points[i]!, points[i + 1]!, sample(points[i]!), sample(points[i + 1]!));
  add(end, sample(end));
  return { keyframes: result };
}
function keyTimes(value: AnimatedNumber): Tick[] {
  return typeof value === "number" ? [] : value.keyframes.map((key) => key.time);
}
function sliceProperty(
  value: AnimatedNumber,
  start: Tick,
  end: Tick,
  min: number,
  max: number,
): AnimatedNumber {
  const sliced = sliceAnimatedNumber(value, start, end);
  if (
    typeof sliced === "number" ||
    sliced.keyframes.every((key) => key.value >= min && key.value <= max)
  )
    return sliced;
  return approximate(
    (time) => clamp(evaluateAnimatedNumber(value, time), min, max),
    start,
    end,
    keyTimes(sliced).map((time) => time + start),
  );
}
function sliceText(clip: TextClip, start: Tick, end: Tick): TextClip {
  const next = structuredClone(clip);
  if (start === 0 && end === clip.duration) return next;
  if (clip.translation?.originalWords?.length) {
    if (clip.translation.originalWords.some((word) => word.start < start || word.end > end))
      throw new Error("裁剪将截断已翻译的原文词时间，请先校准字幕或解除翻译");
    next.translation!.originalWords = clip.translation.originalWords.map((word) => ({
      ...word,
      start: word.start - start,
      end: word.end - start,
    }));
  }
  if (clip.style.animation === "typewriter")
    throw new Error("打字机文字不能直接裁掉动画中段，请先关闭打字机效果再剪切");
  next.words = clip.words
    .filter((word) => word.end > start && word.start < end)
    .map((word) => ({
      ...word,
      start: Math.max(start, word.start) - start,
      end: Math.min(end, word.end) - start,
    }));
  const retained = clip.words
    .map((word, index) => ({ word, index }))
    .filter(({ word }) => word.end > start && word.start < end);
  if (clip.words.length && retained.length !== clip.words.length) {
    const compactWords = clip.words.map((word) => word.text.replace(/\s/g, ""));
    if (clip.translation || clip.text.replace(/\s/g, "") !== compactWords.join(""))
      throw new Error("这条字幕含译文或独立校对文字，请先校准逐字稿再按词剪切，以保留已编辑内容");
    // Slice the actual corrected string at word boundaries; preserve its punctuation and interior spacing.
    const offsets = Array.from({ length: clip.text.length }, (_, index) => index).filter(
      (index) => !/\s/.test(clip.text[index]!),
    );
    const first = retained[0]?.index ?? 0,
      last = retained.at(-1)?.index ?? -1;
    const from = compactWords.slice(0, first).reduce((sum, word) => sum + word.length, 0);
    const to = compactWords.slice(0, last + 1).reduce((sum, word) => sum + word.length, 0);
    next.text = retained.length ? clip.text.slice(offsets[from], offsets[to - 1]! + 1) : "";
  }
  return next;
}
function sliceClip(clip: EditorClip, start: Tick, end: Tick): EditorClip {
  assertTick(start);
  assertTick(end);
  if (start >= end || end > clip.duration) throw new Error("裁剪范围须位于片段内并保留正时长");
  const next = clip.kind === "text" ? sliceText(clip, start, end) : structuredClone(clip);
  next.start = clip.start + start;
  next.duration = end - start;
  for (const key of transformKeys)
    next.transform[key] = sliceProperty(
      clip.transform[key],
      start,
      end,
      transformBounds[key][0],
      transformBounds[key][1],
    );
  for (const key of colorKeys)
    next.color[key] = sliceProperty(
      clip.color[key],
      start,
      end,
      colorBounds[key][0],
      colorBounds[key][1],
    );
  if ("timeMap" in clip && "timeMap" in next) {
    next.timeMap = sliceTimeMap(clip.timeMap, start, end);
    next.audio.pan = sliceProperty(clip.audio.pan, start, end, -1, 1);
    const fadeIn = clip.audio.fadeIn,
      fadeOut = clip.audio.fadeOut;
    // Fades remain attached to their original time, not to the newly created edit edge.
    const preserveIn = !fadeIn || (start === 0 && end >= fadeIn) || start >= fadeIn;
    const preserveOut =
      !fadeOut ||
      (end === clip.duration && start <= clip.duration - fadeOut) ||
      end <= clip.duration - fadeOut;
    if (preserveIn && preserveOut) {
      next.audio.volume = sliceProperty(clip.audio.volume, start, end, 0, 4);
      next.audio.fadeIn = start === 0 ? Math.min(fadeIn, next.duration) : 0;
      next.audio.fadeOut = end === clip.duration ? Math.min(fadeOut, next.duration) : 0;
    } else {
      const gain = (time: Tick) =>
        clamp(evaluateAnimatedNumber(clip.audio.volume, time), 0, 4) *
        (fadeIn ? clamp(time / fadeIn) : 1) *
        (fadeOut ? clamp((clip.duration - time) / fadeOut) : 1);
      next.audio.volume = approximate(gain, start, end, [
        ...keyTimes(clip.audio.volume),
        fadeIn,
        clip.duration - fadeOut,
      ]);
      next.audio.fadeIn = 0;
      next.audio.fadeOut = 0;
    }
    if (clip.kind === "multicam" && next.kind === "multicam") {
      const active = clip.switches.filter((change) => change.time <= start).at(-1)!;
      next.switches = [
        { time: 0, angleId: active.angleId },
        ...clip.switches
          .filter((change) => change.time > start && change.time < end)
          .map((change) => ({ ...change, time: change.time - start })),
      ];
    }
  }
  if (clip.kind === "text" && next.kind === "text" && clip.style.animation === "fade") {
    next.transform.opacity = approximate(
      (time) =>
        clamp(evaluateAnimatedNumber(clip.transform.opacity, time)) *
        clamp(
          Math.min(time / (clip.duration * 0.1), (clip.duration - time) / (clip.duration * 0.1)),
        ),
      start,
      end,
      [
        ...keyTimes(clip.transform.opacity),
        Math.round(clip.duration * 0.1),
        Math.round(clip.duration * 0.9),
      ],
    );
    next.style.animation = "none";
  }
  return next;
}
function tightenBinding(text: TextClip, owner: SourceClip): void {
  if (!text.sourceBinding) return;
  const start = text.start - owner.start,
    end = start + text.duration;
  if (start < 0 || end > owner.duration)
    throw new Error("关联字幕与源片段尚未对齐，请先修正字幕时间再剪切");
  const points = sliceTimeMap(owner.timeMap, start, end).points.map((point) => point.source);
  const first = Math.max(text.sourceBinding.sourceStart, Math.min(...points));
  const last = Math.min(text.sourceBinding.sourceEnd, Math.max(...points));
  if (first < last) {
    text.sourceBinding.sourceStart = first;
    text.sourceBinding.sourceEnd = last;
  } else if (
    !points.every(
      (point) => point >= text.sourceBinding!.sourceStart && point < text.sourceBinding!.sourceEnd,
    )
  )
    throw new Error("字幕来源与保留片段不一致，请先重新对齐字幕");
}

/** Trim local output ticks [localStart,localEnd); retain the remaining picture at its original timeline time. No ripple. */
export function trimClip(
  value: EditorDocument,
  sequenceId: string,
  clipId: string,
  localStart: Tick,
  localEnd: Tick,
): EditorOperation[] {
  const { document, sequence } = context(value, sequenceId),
    before = findClip(sequence, clipId);
  if (localStart === 0 && localEnd === before.duration) return [];
  assertNoTransition(sequence, new Set([clipId]));
  const after = sliceClip(before, localStart, localEnd);
  if (after.kind === "text" && after.sourceBinding)
    tightenBinding(after, sourceClip(findClip(sequence, after.sourceBinding.clipId)));
  const operations: EditorOperation[] = [update(sequenceId, before, after)];
  for (const caption of boundText(sequence, before)) {
    if (
      caption.start < before.start ||
      caption.start + caption.duration > before.start + before.duration
    )
      throw new Error("关联字幕与源片段尚未对齐，请先修正字幕时间再裁剪");
    const start = Math.max(after.start, caption.start),
      end = Math.min(after.start + after.duration, caption.start + caption.duration);
    if (start >= end) operations.push({ type: "clip.remove", sequenceId, clipIds: [caption.id] });
    else {
      const trimmed = sliceClip(caption, start - caption.start, end - caption.start) as TextClip;
      tightenBinding(trimmed, sourceClip(after));
      operations.push(update(sequenceId, caption, trimmed));
    }
  }
  return finish(document, operations);
}

/** Split the selected instance and its bound subtitles at one exact timeline tick. Group/link labels are retained. */
export function splitClip(
  value: EditorDocument,
  sequenceId: string,
  clipId: string,
  timelineTick: Tick,
  idFactory: ClipIdFactory,
): EditorOperation[] {
  const { document, sequence } = context(value, sequenceId),
    before = findClip(sequence, clipId);
  assertTick(timelineTick);
  const local = timelineTick - before.start;
  if (local <= 0 || local >= before.duration) throw new Error("播放头须位于片段内部才能切分");
  assertNoTransition(sequence, new Set([clipId]));
  const newId = allocate(document, idFactory),
    left = sliceClip(before, 0, local),
    right = sliceClip(before, local, before.duration);
  right.id = newId("clip");
  if (before.kind === "text" && before.sourceBinding) {
    const owner = sourceClip(findClip(sequence, before.sourceBinding.clipId));
    tightenBinding(left as TextClip, owner);
    tightenBinding(right as TextClip, owner);
  }
  const operations: EditorOperation[] = [
    update(sequenceId, before, left),
    { type: "clip.add", sequenceId, clip: right },
  ];
  for (const caption of boundText(sequence, before)) {
    if (
      caption.start < before.start ||
      caption.start + caption.duration > before.start + before.duration
    )
      throw new Error("关联字幕与源片段尚未对齐，请先修正字幕时间再切分");
    const parts: TextClip[] = [];
    for (const owner of [left, right]) {
      const start = Math.max(caption.start, owner.start),
        end = Math.min(caption.start + caption.duration, owner.start + owner.duration);
      if (start >= end) continue;
      const part = sliceClip(caption, start - caption.start, end - caption.start) as TextClip;
      part.sourceBinding!.clipId = owner.id;
      tightenBinding(part, sourceClip(owner));
      if (parts.length) part.id = newId("clip");
      parts.push(part);
    }
    if (parts.length) {
      operations.push(update(sequenceId, caption, parts[0]!));
      for (const part of parts.slice(1))
        operations.push({ type: "clip.add", sequenceId, clip: part });
    }
  }
  return finish(document, operations);
}

/** Selection-based copy/group expands explicit groups, links and source-bound subtitle dependencies. */
function selectionClosure(sequence: EditorSequence, ids: readonly string[]): Set<string> {
  const selected = selectedIds(sequence, ids);
  let changed = true;
  while (changed) {
    changed = false;
    const clips = sequence.clips.filter((clip) => selected.has(clip.id));
    const groups = new Set(clips.flatMap((clip) => (clip.groupId ? [clip.groupId] : [])));
    const links = new Set(clips.flatMap((clip) => (clip.linkGroupId ? [clip.linkGroupId] : [])));
    const owners = new Set(
      clips.flatMap((clip) =>
        clip.kind === "text" && clip.sourceBinding ? [clip.sourceBinding.clipId] : [],
      ),
    );
    for (const clip of sequence.clips) {
      if (
        !selected.has(clip.id) &&
        (owners.has(clip.id) ||
          (clip.groupId && groups.has(clip.groupId)) ||
          (clip.linkGroupId && links.has(clip.linkGroupId)) ||
          (clip.kind === "text" && clip.sourceBinding && selected.has(clip.sourceBinding.clipId)))
      ) {
        selected.add(clip.id);
        changed = true;
      }
    }
  }
  return selected;
}
function dependencySnapshot(
  document: EditorDocument,
  source: EditorSequence,
  selected: ReadonlySet<string>,
): EditorDocument {
  const clips = source.clips.filter((clip) => selected.has(clip.id));
  for (const transition of source.transitions)
    if (selected.has(transition.fromClipId) !== selected.has(transition.toClipId))
      throw new Error("复制带转场的片段时，请同时选择转场两端片段");
  const root: EditorSequence = {
    ...source,
    clips,
    transitions: source.transitions.filter((transition) => selected.has(transition.fromClipId)),
    markers: [],
  };
  const sequences = [root],
    seen = new Set([source.id]);
  for (let index = 0; index < sequences.length; index++)
    for (const clip of sequences[index]!.clips)
      if (clip.kind === "sequence" && !seen.has(clip.sequenceId)) {
        seen.add(clip.sequenceId);
        sequences.push(document.sequences.find((sequence) => sequence.id === clip.sequenceId)!);
      }
  const assets = new Set(
    sequences.flatMap((sequence) =>
      sequence.clips.flatMap((clip) =>
        clip.kind === "media"
          ? [clip.assetId]
          : clip.kind === "multicam"
            ? clip.angles.map((angle) => angle.assetId)
            : [],
      ),
    ),
  );
  return validateEditorDocument({
    schemaVersion: 2,
    timebase: document.timebase,
    id: document.id,
    name: document.name,
    revision: document.revision,
    assets: document.assets.filter((asset) => assets.has(asset.id)),
    sequences,
    activeSequenceId: source.id,
    exportProfiles: [],
  });
}
export function copyClips(
  value: EditorDocument,
  sequenceId: string,
  clipIds: readonly string[],
): ClipClipboard {
  const { document, sequence } = context(value, sequenceId),
    selected = selectionClosure(sequence, clipIds);
  const snapshot = dependencySnapshot(document, sequence, selected);
  return {
    schemaVersion: 1,
    sequenceId,
    origin: Math.min(...snapshot.sequences[0]!.clips.map((clip) => clip.start)),
    document: snapshot,
  };
}
function clipboard(value: unknown): ClipClipboard {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some(
      (key) =>
        typeof key !== "string" ||
        !["schemaVersion", "origin", "sequenceId", "document"].includes(key) ||
        !Object.getOwnPropertyDescriptor(value, key)?.enumerable ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"),
    )
  )
    throw new Error("片段剪贴板格式无效");
  const raw = value as ClipClipboard;
  if (raw.schemaVersion !== 1) throw new Error("不支持此片段剪贴板版本");
  const document = validateEditorDocument(raw.document),
    sequence = document.sequences.find((sequence) => sequence.id === raw.sequenceId);
  assertTick(raw.origin);
  if (
    !sequence ||
    document.activeSequenceId !== sequence.id ||
    !sequence.clips.length ||
    raw.origin !== Math.min(...sequence.clips.map((clip) => clip.start))
  )
    throw new Error("片段剪贴板缺少有效选择或起点");
  return { schemaVersion: 1, origin: raw.origin, sequenceId: raw.sequenceId, document };
}
function sameAsset(source: EditorAsset, target: EditorAsset, sameDocument: boolean): boolean {
  return (
    source.kind === target.kind &&
    source.duration === target.duration &&
    ((source.resourceId !== undefined && source.resourceId === target.resourceId) ||
      (source.fingerprint !== undefined && source.fingerprint === target.fingerprint) ||
      (sameDocument &&
        source.id === target.id &&
        source.resourceId === undefined &&
        target.resourceId === undefined))
  );
}
/** Missing imports are explicit data for the UI; this module never creates media behind the transaction API. */
export class ClipboardDependencyError extends Error {
  readonly code = "CLIPBOARD_DEPENDENCIES_MISSING";
  constructor(
    readonly assetIds: string[],
    readonly sequenceIds: string[],
  ) {
    super("素材或嵌套序列尚未导入到目标工程，请先准备缺失依赖再粘贴");
    this.name = "ClipboardDependencyError";
  }
}
export function pasteClips(
  value: EditorDocument,
  sequenceId: string,
  payload: unknown,
  options: PasteClipOptions,
): EditorOperation[] {
  const { document, sequence } = context(value, sequenceId),
    copied = clipboard(payload);
  assertTick(options.at);
  const source = copied.document.sequences.find((sequence) => sequence.id === copied.sequenceId)!;
  const sameDocument = document.id === copied.document.id,
    assets = new Map<string, string>(),
    missingAssets: string[] = [],
    missingSequences: string[] = [];
  for (const asset of copied.document.assets) {
    const target =
      document.assets.find(
        (candidate) => candidate.id === asset.id && sameAsset(asset, candidate, sameDocument),
      ) ?? document.assets.find((candidate) => sameAsset(asset, candidate, sameDocument));
    if (target) assets.set(asset.id, target.id);
    else missingAssets.push(asset.id);
  }
  for (const dependency of copied.document.sequences.filter((item) => item.id !== source.id)) {
    const target = document.sequences.find((item) => item.id === dependency.id);
    if (!target || (!sameDocument && JSON.stringify(target) !== JSON.stringify(dependency)))
      missingSequences.push(dependency.id);
  }
  if (missingAssets.length || missingSequences.length)
    throw new ClipboardDependencyError(missingAssets, missingSequences);
  const usedTracks = source.tracks.filter((track) =>
    source.clips.some((clip) => clip.trackId === track.id),
  );
  const sourceAnchor = source.tracks.indexOf(usedTracks[0]!);
  const targetAnchor =
    options.trackId === undefined
      ? sequence.tracks.findIndex((track) => track.id === usedTracks[0]!.id)
      : sequence.tracks.findIndex((track) => track.id === options.trackId);
  if (!options.trackMap && targetAnchor < 0) throw new Error("请选择对应的目标轨道后粘贴");
  const tracks = new Map<string, string>();
  for (const track of source.tracks) {
    const target = options.trackMap
      ? sequence.tracks.find((candidate) => candidate.id === options.trackMap![track.id])
      : sequence.tracks[targetAnchor + source.tracks.indexOf(track) - sourceAnchor];
    if (target && target.kind === track.kind) tracks.set(track.id, target.id);
  }
  if (usedTracks.some((track) => !tracks.has(track.id)))
    throw new Error("目标轨道不足或类型不匹配，请先准备对应轨道");
  const newId = allocate(document, options.idFactory),
    clipIds = new Map(source.clips.map((clip) => [clip.id, newId("clip")]));
  const groups = new Map<string, string>(),
    links = new Map<string, string>();
  function remapGroup(id: string, values: Map<string, string>, kind: "group" | "link") {
    if (!values.has(id)) values.set(id, newId(kind));
    return values.get(id)!;
  }
  const operations: EditorOperation[] = source.clips.map((original) => {
    const clip = structuredClone(original);
    clip.id = clipIds.get(original.id)!;
    clip.start = options.at + original.start - copied.origin;
    clip.trackId = tracks.get(original.trackId)!;
    if (clip.groupId) clip.groupId = remapGroup(clip.groupId, groups, "group");
    if (clip.linkGroupId) clip.linkGroupId = remapGroup(clip.linkGroupId, links, "link");
    if (clip.kind === "media") clip.assetId = assets.get(clip.assetId)!;
    if (clip.kind === "multicam")
      clip.angles = clip.angles.map((angle) => ({ ...angle, assetId: assets.get(angle.assetId)! }));
    if (clip.kind === "text" && clip.sourceBinding) {
      const owner = clipIds.get(clip.sourceBinding.clipId);
      if (!owner) throw new Error("复制关联字幕时必须包含其来源片段");
      clip.sourceBinding.clipId = owner;
      if (clip.sourceBinding.provenance) {
        const asset = assets.get(clip.sourceBinding.provenance.assetId);
        if (!asset) throw new Error("粘贴字幕缺少实际音源素材");
        clip.sourceBinding.provenance.assetId = asset;
      }
    }
    if ("audio" in clip && clip.audio.ducking)
      clip.audio.ducking.sidechainTrackIds = clip.audio.ducking.sidechainTrackIds.map((id) => {
        const target = tracks.get(id);
        if (!target) throw new Error("目标时间线缺少压低背景声所需的参考轨道");
        return target;
      });
    return { type: "clip.add", sequenceId, clip };
  });
  for (const original of source.transitions) {
    const transition: Transition = {
      ...original,
      id: newId("transition"),
      fromClipId: clipIds.get(original.fromClipId)!,
      toClipId: clipIds.get(original.toClipId)!,
      start: options.at + original.start - copied.origin,
    };
    operations.push({ type: "transition.add", sequenceId, transition });
  }
  return finish(document, operations);
}
export function duplicateSelectedClips(
  value: EditorDocument,
  sequenceId: string,
  clipIds: readonly string[],
  options: { at?: Tick; idFactory: ClipIdFactory },
): EditorOperation[] {
  const { document, sequence } = context(value, sequenceId);
  return pasteClips(document, sequenceId, copyClips(document, sequenceId, clipIds), {
    at: options.at ?? sequenceDuration(sequence),
    idFactory: options.idFactory,
  });
}
export function groupClips(
  value: EditorDocument,
  sequenceId: string,
  clipIds: readonly string[],
  groupId: string,
): EditorOperation[] {
  const { document, sequence } = context(value, sequenceId),
    selected = selectionClosure(sequence, clipIds);
  if (selected.size < 2) throw new Error("至少选择两个片段才能编组");
  if (
    typeof groupId !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(groupId) ||
    sequence.clips.some((clip) => clip.groupId === groupId && !selected.has(clip.id))
  )
    throw new Error("请使用有效且未被其他片段占用的分组 ID");
  return finish(
    document,
    [...selected].map((clipId) => ({
      type: "clip.update",
      sequenceId,
      clipId,
      patch: { groupId },
    })),
  );
}
export function ungroupClips(
  value: EditorDocument,
  sequenceId: string,
  clipIds: readonly string[],
): EditorOperation[] {
  const { document, sequence } = context(value, sequenceId),
    selected = selectedIds(sequence, clipIds);
  const groups = new Set(
    sequence.clips
      .filter((clip) => selected.has(clip.id))
      .flatMap((clip) => (clip.groupId ? [clip.groupId] : [])),
  );
  return finish(
    document,
    sequence.clips
      .filter((clip) => clip.groupId && groups.has(clip.groupId))
      .map((clip) => ({
        type: "clip.update",
        sequenceId,
        clipId: clip.id,
        patch: { groupId: null },
      })),
  );
}

function scaleTick(value: Tick, oldDuration: Tick, duration: Tick): Tick {
  const n = BigInt(value) * BigInt(duration),
    d = BigInt(oldDuration);
  return Number((2n * n + d) / (2n * d));
}
function stretchProperty(value: AnimatedNumber, from: Tick, duration: Tick): AnimatedNumber {
  if (typeof value === "number") return value;
  let previous = -1;
  return {
    keyframes: value.keyframes.map((key) => {
      const time = scaleTick(key.time, from, duration);
      if (time <= previous) throw new Error("变速后关键帧落在同一刻度，请降低速度或先整理关键帧");
      previous = time;
      return { ...structuredClone(key), time };
    }),
  };
}
function stretchDecorations(clip: EditorClip, duration: Tick, stretchSwitches = true): EditorClip {
  const next = structuredClone(clip);
  next.duration = duration;
  for (const key of transformKeys)
    next.transform[key] = stretchProperty(clip.transform[key], clip.duration, duration);
  for (const key of colorKeys)
    next.color[key] = stretchProperty(clip.color[key], clip.duration, duration);
  if ("audio" in clip && "audio" in next) {
    next.audio.volume = stretchProperty(clip.audio.volume, clip.duration, duration);
    next.audio.pan = stretchProperty(clip.audio.pan, clip.duration, duration);
    next.audio.fadeIn = scaleTick(clip.audio.fadeIn, clip.duration, duration);
    next.audio.fadeOut = scaleTick(clip.audio.fadeOut, clip.duration, duration);
  }
  if (stretchSwitches && clip.kind === "multicam" && next.kind === "multicam") {
    next.switches = clip.switches.map((change) => ({
      ...change,
      time: scaleTick(change.time, clip.duration, duration),
    }));
    if (
      new Set(next.switches.map((change) => change.time)).size !== next.switches.length ||
      next.switches.at(-1)!.time >= duration
    )
      throw new Error("变速后机位切点过密，请降低速度");
  }
  if (clip.kind === "text" && next.kind === "text")
    next.words = clip.words.map((word) => ({
      ...word,
      start: scaleTick(word.start, clip.duration, duration),
      end: scaleTick(word.end, clip.duration, duration),
    }));
  if (clip.kind === "text" && next.kind === "text" && clip.translation?.originalWords)
    next.translation!.originalWords = clip.translation.originalWords.map((word) => ({
      ...word,
      start: scaleTick(word.start, clip.duration, duration),
      end: scaleTick(word.end, clip.duration, duration),
    }));
  return next;
}
function forward(map: TimeMap): boolean {
  return map.points.every(
    (point, index) => index === 0 || point.source > map.points[index - 1]!.source,
  );
}
function retimeBoundCaption(caption: TextClip, before: SourceClip, after: SourceClip): TextClip {
  if (!forward(before.timeMap) || !forward(after.timeMap))
    throw new Error("带来源字幕的倒放、定格或往返变速需要先解除字幕绑定，避免改变文字顺序");
  const binding = caption.sourceBinding!;
  const ranges = sourceRangesToTimeline(after.timeMap, binding.sourceStart, binding.sourceEnd);
  if (ranges.length !== 1) throw new Error("字幕来源无法连续映射到变速片段，请先重新对齐字幕");
  const range = ranges[0]!,
    next = stretchDecorations(caption, range.end - range.start) as TextClip;
  next.start = after.start + range.start;
  const mapWord = (word: TextClip["words"][number]) => {
    const start = caption.start - before.start + word.start,
      end = caption.start - before.start + word.end;
    if (start < 0 || end > before.duration)
      throw new Error("逐字字幕与原片段未对齐，请先校准再变速");
    const wordRanges = sourceRangesToTimeline(
      after.timeMap,
      sourceTimeAt(before.timeMap, start),
      sourceTimeAt(before.timeMap, end),
    );
    if (wordRanges.length !== 1) throw new Error("变速后字幕词无法保留，请降低速度或重新对齐");
    const first = Math.max(range.start, wordRanges[0]!.start) - range.start;
    const last = Math.min(range.end, wordRanges[0]!.end) - range.start;
    if (first >= last) throw new Error("变速后字幕词短于一个刻度，请降低速度");
    return { ...word, start: first, end: last };
  };
  next.words = caption.words.map(mapWord);
  if (caption.translation?.originalWords)
    next.translation!.originalWords = caption.translation.originalWords.map(mapWord);
  return next;
}
function retime(
  document: EditorDocument,
  sequence: EditorSequence,
  before: SourceClip,
  duration: Tick,
  timeMap: TimeMap,
  adjust?: (clip: SourceClip) => void,
): EditorOperation[] {
  assertNoTransition(sequence, new Set([before.id]));
  const after = stretchDecorations(before, duration, !adjust) as SourceClip;
  after.timeMap = timeMap;
  adjust?.(after);
  const operations: EditorOperation[] = [update(sequence.id, before, after)];
  for (const caption of boundText(sequence, before))
    operations.push(update(sequence.id, caption, retimeBoundCaption(caption, before, after)));
  return finish(document, operations);
}
function speed(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0.05 || value > 100)
    throw new Error("播放速度须在 0.05 至 100 倍之间");
  return value;
}
function sourceEndpoints(clip: SourceClip): [Tick, Tick] {
  const points = clip.timeMap.points,
    start = points[0]!.source,
    end = points.at(-1)!.source;
  const sign = Math.sign(end - start);
  if (
    !sign ||
    points.some(
      (point, index) => index > 0 && Math.sign(point.source - points[index - 1]!.source) !== sign,
    )
  )
    throw new Error("定格或往返时间映射不能直接改为单一速度，请先切分为单向片段");
  return [start, end];
}
/** Absolute constant speed over the retained source interval; no following clip is moved. */
export function setClipSpeed(
  value: EditorDocument,
  sequenceId: string,
  clipId: string,
  rate: number,
): EditorOperation[] {
  const { document, sequence } = context(value, sequenceId),
    clip = sourceClip(findClip(sequence, clipId));
  const [start, end] = sourceEndpoints(clip),
    result = constantTimeMap(start, end, speed(rate));
  return retime(document, sequence, clip, result.duration, result.timeMap);
}

/** Explicit source/output control points share the same animation and bound-subtitle retiming path. */
export function setClipTimeMap(
  value: EditorDocument,
  sequenceId: string,
  clipId: string,
  mapping: TimeMap,
): EditorOperation[] {
  const { document, sequence } = context(value, sequenceId),
    clip = sourceClip(findClip(sequence, clipId));
  const duration = assertTick(mapping?.points?.at(-1)?.time, "曲线输出时长");
  const sourceDuration =
    clip.kind === "media"
      ? document.assets.find((asset) => asset.id === clip.assetId)!.duration
      : clip.kind === "sequence"
        ? sequenceDuration(document.sequences.find((item) => item.id === clip.sequenceId)!)
        : MAX_EDITOR_TICK;
  return retime(
    document,
    sequence,
    clip,
    duration,
    validateTimeMap(mapping, duration, sourceDuration),
  );
}
/** Reverse source playback while keeping output-space decoration animation and clip length. */
export function reverseClip(
  value: EditorDocument,
  sequenceId: string,
  clipId: string,
): EditorOperation[] {
  const { document, sequence } = context(value, sequenceId),
    clip = sourceClip(findClip(sequence, clipId));
  const timeMap = {
    points: [...clip.timeMap.points]
      .reverse()
      .map((point) => ({ time: clip.duration - point.time, source: point.source })),
  };
  return retime(document, sequence, clip, clip.duration, timeMap, (after) => {
    if (clip.kind === "multicam" && after.kind === "multicam")
      after.switches = [
        { time: 0, angleId: clip.switches.at(-1)!.angleId },
        ...clip.switches
          .slice(1)
          .map((change, index) => ({
            time: clip.duration - change.time,
            angleId: clip.switches[index]!.angleId,
          }))
          .reverse(),
      ];
  });
}
/** Replace this instance with a held frame chosen from its current timeline position; held audio is silent in the evaluator. */
export function freezeClip(
  value: EditorDocument,
  sequenceId: string,
  clipId: string,
  timelineTick: Tick,
  duration: Tick,
): EditorOperation[] {
  const { document, sequence } = context(value, sequenceId),
    clip = sourceClip(findClip(sequence, clipId));
  assertTick(timelineTick);
  assertTick(duration);
  if (timelineTick < clip.start || timelineTick >= clip.start + clip.duration)
    throw new Error("定格位置须位于所选片段内部");
  return retime(
    document,
    sequence,
    clip,
    duration,
    freezeTimeMap(sourceTimeAt(clip.timeMap, timelineTick - clip.start), duration),
    (after) => {
      if (clip.kind === "multicam" && after.kind === "multicam")
        after.switches = [
          {
            time: 0,
            angleId: clip.switches
              .filter((change) => change.time <= timelineTick - clip.start)
              .at(-1)!.angleId,
          },
        ];
    },
  );
}

/** Source-space speed integrates analytically. Linear approximation error is <1/100 frame before integer rounding (which adds at most 0.5 * maxSpeed + 1 source ticks). */
export function setClipSpeedCurve(
  value: EditorDocument,
  sequenceId: string,
  clipId: string,
  curve: readonly SpeedCurvePoint[],
): EditorOperation[] {
  const { document, sequence } = context(value, sequenceId),
    clip = sourceClip(findClip(sequence, clipId));
  const [sourceStart, sourceEnd] = sourceEndpoints(clip),
    span = Math.abs(sourceEnd - sourceStart),
    direction = Math.sign(sourceEnd - sourceStart);
  if (
    !Array.isArray(curve) ||
    Object.getPrototypeOf(curve) !== Array.prototype ||
    curve.length < 2 ||
    curve.length > 100 ||
    Reflect.ownKeys(curve).length !== curve.length + 1 ||
    Array.from({ length: curve.length }, (_, index) =>
      Object.getOwnPropertyDescriptor(curve, String(index)),
    ).some((descriptor) => !descriptor?.enumerable || !Object.hasOwn(descriptor, "value"))
  )
    throw new Error("速度曲线需要 2 至 100 个有效控制点");
  let previous = -1;
  const controls = curve.map((raw) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) ||
      Reflect.ownKeys(raw).some(
        (key) =>
          typeof key !== "string" ||
          !["position", "speed"].includes(key) ||
          !Object.hasOwn(Object.getOwnPropertyDescriptor(raw, key)!, "value"),
      )
    )
      throw new Error("速度曲线控制点无效");
    if (
      typeof raw.position !== "number" ||
      !Number.isFinite(raw.position) ||
      raw.position < 0 ||
      raw.position > 1 ||
      raw.position <= previous
    )
      throw new Error("速度曲线位置须从 0 至 1 严格递增");
    previous = raw.position;
    return { position: raw.position, speed: speed(raw.speed) };
  });
  if (controls[0]!.position !== 0 || controls.at(-1)!.position !== 1)
    throw new Error("速度曲线必须包含源范围的 0 和 1 两端");
  const points: TimeMap["points"] = [{ time: 0, source: sourceStart }];
  let elapsed = 0;
  const tolerance = Math.max(1, frameToTicks(1, sequence.frameRate) / 100);
  function append(time: number, source: number) {
    if (points.length >= MAX_KEYS) throw new Error("速度曲线需要过多节点，请缩短片段或简化曲线");
    const point = { time: Math.round(time), source: Math.round(source) },
      previous = points.at(-1)!;
    if (point.time <= previous.time || point.source === previous.source)
      throw new Error("速度控制点过密，不能在整数刻度保留完整源范围");
    points.push(point);
  }
  for (let index = 0; index + 1 < controls.length; index++) {
    const left = controls[index]!,
      right = controls[index + 1]!;
    const sourceOffset = Math.round(span * left.position),
      distance = Math.round(span * right.position) - sourceOffset;
    if (distance <= 0) throw new Error("速度控制点落在同一源刻度，请拉开控制点");
    const delta = right.speed - left.speed;
    const at = (fraction: number) =>
      Math.abs(delta) < 1e-10
        ? (distance * fraction) / left.speed
        : (distance * Math.log1p((delta * fraction) / left.speed)) / delta;
    function subdivide(a: number, b: number): void {
      const startTime = at(a),
        endTime = at(b);
      // Linear interpolation error <= max |source''| * dt^2 / 8, before integer rounding.
      const second =
        Math.abs(delta / distance) * Math.max(left.speed + delta * a, left.speed + delta * b);
      if ((second * (endTime - startTime) ** 2) / 8 > tolerance / 2) {
        const mid = (a + b) / 2;
        subdivide(a, mid);
        subdivide(mid, b);
      } else append(elapsed + endTime, sourceStart + direction * (sourceOffset + distance * b));
    }
    subdivide(0, 1);
    elapsed += at(1);
    if (elapsed > MAX_EDITOR_TICK) throw new Error("变速后的片段超过 24 小时");
  }
  points.at(-1)!.source = sourceEnd;
  const duration = points.at(-1)!.time;
  return retime(document, sequence, clip, duration, { points });
}
