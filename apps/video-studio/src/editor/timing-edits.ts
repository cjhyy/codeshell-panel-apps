import { freezeClip, reverseClip, setClipSpeed, setClipTimeMap, trimClip } from "./clip-edits";
import { applyEditorOperations, type EditorClipPatch, type EditorOperation } from "./operations";
import { assertTick, type Tick, type TimeMap } from "./time";
import type { EditorClip, EditorDocument, EditorSequence, Transition } from "./types";
import { validateEditorDocument } from "./validation";

export type ClipTimingAction =
  | { kind: "speed"; rate: number; preservePitch?: boolean }
  | { kind: "map"; timeMap: TimeMap }
  | { kind: "reverse" }
  | { kind: "freeze"; time: Tick; duration: Tick }
  | { kind: "keep-left" | "keep-right"; time: Tick };
export interface ClipTimingOptions {
  /** Close duration changes along affected tracks; groups and bound captions follow once. */
  ripple?: boolean;
  /** Explicitly remove transitions touching the edited clips and replace their overlap with a hard cut. */
  removeTransitions?: boolean;
  /** Keep existing caption content/timing while explicitly removing the source binding. */
  detachCaptions?: boolean;
}
export interface TransitionPlanOptions {
  kind: Transition["kind"];
  duration: Tick;
  id: string;
  /** Ripple moves the second clip and subsequent clips on its track. Overlap moves only the second clip. */
  placement?: "ripple" | "overlap";
  remove?: boolean;
}
/** Older multitrack projects restrict automatic ripple to their original main picture track. */
export function isMagneticTrack(sequence: EditorSequence, trackId: string): boolean {
  return sequence.timelineMode === "magnetic" && magneticTrackMatches(sequence, trackId);
}
function magneticTrackMatches(sequence: EditorSequence, trackId: string): boolean {
  return sequence.magneticTrackId === undefined || sequence.magneticTrackId === trackId;
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function scope(value: EditorDocument, sequenceId: string) {
  const document = validateEditorDocument(value),
    sequence = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence) throw new Error("时间线不存在");
  return { document, sequence };
}
function find(sequence: EditorSequence, id: string): EditorClip {
  const clip = sequence.clips.find((item) => item.id === id);
  if (!clip) throw new Error("片段不存在，请重新选择");
  return clip;
}
/** Movement dependencies are bidirectional: groups, audio links and their source-bound captions. */
function components(
  sequence: EditorSequence,
  includeBindings = true,
  includeTransitions = false,
): Set<string>[] {
  const parents = new Map(sequence.clips.map((clip) => [clip.id, clip.id]));
  const root = (id: string): string => {
    let current = id;
    while (parents.get(current)! !== current) current = parents.get(current)!;
    while (id !== current) {
      const next = parents.get(id)!;
      parents.set(id, current);
      id = next;
    }
    return current;
  };
  const join = (a: string, b: string) => parents.set(root(a), root(b));
  const groupIds = new Map<string, string>(),
    linkIds = new Map<string, string>();
  for (const clip of sequence.clips) {
    for (const [id, ids] of [
      [clip.groupId, groupIds],
      [clip.linkGroupId, linkIds],
    ] as const)
      if (id) {
        const other = ids.get(id);
        if (other) join(clip.id, other);
        else ids.set(id, clip.id);
      }
    if (includeBindings && clip.kind === "text" && clip.sourceBinding)
      join(clip.id, clip.sourceBinding.clipId);
  }
  if (includeTransitions)
    for (const transition of sequence.transitions) join(transition.fromClipId, transition.toClipId);
  const result = new Map<string, Set<string>>();
  for (const clip of sequence.clips) {
    const id = root(clip.id);
    if (!result.has(id)) result.set(id, new Set());
    result.get(id)!.add(clip.id);
  }
  return [...result.values()];
}
function selected(sequence: EditorSequence, ids: readonly string[]): Set<string> {
  if (!Array.isArray(ids) || !ids.length || ids.length > 2000 || new Set(ids).size !== ids.length)
    throw new Error("请选择有效且不重复的片段");
  ids.forEach((id) => find(sequence, id));
  const chosen = new Set(ids),
    groups = components(sequence, false);
  for (;;) {
    const size = chosen.size;
    for (const group of groups)
      if ([...group].some((id) => chosen.has(id))) group.forEach((id) => chosen.add(id));
    for (const clip of sequence.clips)
      if (clip.kind === "text" && clip.sourceBinding && chosen.has(clip.sourceBinding.clipId))
        chosen.add(clip.id);
    if (size === chosen.size) return chosen;
  }
}
function unlocked(sequence: EditorSequence, ids: Iterable<string>): void {
  for (const id of ids)
    if (sequence.tracks.find((track) => track.id === find(sequence, id).trackId)?.locked !== false)
      throw new Error("操作涉及已锁定轨道，请先解锁；所有片段均未修改");
}
function ordered(sequence: EditorSequence, trackId: string): EditorClip[] {
  return sequence.clips
    .filter((clip) => clip.trackId === trackId)
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}
function pairTransition(
  sequence: EditorSequence,
  from: string,
  to: string,
): Transition | undefined {
  return sequence.transitions.find((item) => item.fromClipId === from && item.toClipId === to);
}
/** Resolve requested shifts against whole dependency components; contradictory group shifts are never guessed. */
function moveTargets(
  before: EditorSequence,
  after: EditorSequence,
  targets: Map<string, Tick>,
): Map<string, Tick> {
  const shifts = new Map<string, Tick>();
  for (const group of components(before)) {
    const requests = [...group]
      .filter((id) => targets.has(id) && after.clips.some((clip) => clip.id === id))
      .map((id) => targets.get(id)! - find(after, id).start);
    if (!requests.length) continue;
    if (requests.some((delta) => delta !== requests[0]))
      throw new Error("成组或关联片段需要不同位移，无法保持相对位置；请先调整分组或间隙");
    const delta = requests[0]!;
    if (!delta) continue;
    unlocked(before, group);
    for (const id of group) {
      const clip = after.clips.find((clip) => clip.id === id);
      if (clip) {
        clip.start += delta;
        assertTick(clip.start, "移动后起点");
        shifts.set(id, delta);
      }
    }
  }
  for (const transition of after.transitions) {
    const fromShift = shifts.get(transition.fromClipId) ?? 0,
      toShift = shifts.get(transition.toClipId) ?? 0;
    if (fromShift !== toShift)
      throw new Error("移动会改变另一处转场，请同时整理其两端片段或先移除该转场");
    transition.start += fromShift;
  }
  return shifts;
}
function finish(
  document: EditorDocument,
  before: EditorSequence,
  after: EditorSequence,
  shifts = new Map<string, Tick>(),
): EditorOperation[] {
  const operations: EditorOperation[] = [],
    sequenceId = before.id;
  for (const transition of before.transitions)
    if (!after.transitions.some((item) => item.id === transition.id && equal(item, transition)))
      operations.push({ type: "transition.remove", sequenceId, transitionId: transition.id });
  const removed = before.clips
    .filter((item) => !after.clips.some((next) => next.id === item.id))
    .map((item) => item.id);
  if (removed.length) operations.push({ type: "clip.remove", sequenceId, clipIds: removed });
  for (const next of after.clips) {
    const original = find(before, next.id),
      unshifted = { ...next, start: next.start - (shifts.get(next.id) ?? 0) };
    if (equal(original, unshifted)) continue;
    // Apply source trims before ripple movement: moving a clip that began at zero left first would fail.
    const { id: _id, kind: _kind, ...rest } = structuredClone(unshifted);
    const patch: Record<string, unknown> = rest;
    for (const key of ["groupId", "linkGroupId", "mask", "sourceBinding", "translation"])
      if (Object.hasOwn(original, key) && !Object.hasOwn(next, key)) patch[key] = null;
    operations.push({
      type: "clip.update",
      sequenceId,
      clipId: next.id,
      patch: patch as EditorClipPatch,
    });
  }
  for (const group of components(before)) {
    const members = [...group].filter((id) => shifts.has(id) && !removed.includes(id));
    if (!members.length) continue;
    // Source-bound text is moved by clip.move itself; including it in this same operation moves it once.
    operations.push({
      type: "clip.move",
      sequenceId,
      clipIds: members,
      delta: shifts.get(members[0]!)!,
    });
  }
  for (const transition of after.transitions)
    if (!before.transitions.some((item) => item.id === transition.id && equal(item, transition)))
      operations.push({ type: "transition.add", sequenceId, transition });
  if (before.timelineMode !== after.timelineMode)
    operations.push({
      type: "sequence.update",
      sequenceId,
      patch: { timelineMode: after.timelineMode },
    });
  applyEditorOperations(document, operations, document.revision);
  return structuredClone(operations);
}
/** Temporary helper input retains only the edited instance, its captions and nested dependencies. Never stored. */
function isolated(
  document: EditorDocument,
  sequence: EditorSequence,
  clip: EditorClip,
): EditorDocument {
  const ids = new Set([sequence.id]),
    sequences: EditorSequence[] = [
      {
        ...sequence,
        transitions: [],
        markers: [],
        clips: sequence.clips.filter(
          (item) =>
            item.id === clip.id ||
            (item.kind === "text" && item.sourceBinding?.clipId === clip.id) ||
            (clip.kind === "text" && clip.sourceBinding?.clipId === item.id),
        ),
      },
    ];
  for (let index = 0; index < sequences.length; index++)
    for (const item of sequences[index]!.clips)
      if (item.kind === "sequence" && !ids.has(item.sequenceId)) {
        ids.add(item.sequenceId);
        sequences.push(document.sequences.find((sequence) => sequence.id === item.sequenceId)!);
      }
  return validateEditorDocument({ ...document, activeSequenceId: sequence.id, sequences });
}

export function planClipTiming(
  value: EditorDocument,
  sequenceId: string,
  clipIds: readonly string[],
  action: ClipTimingAction,
  options: ClipTimingOptions = {},
): EditorOperation[] {
  const { document, sequence: before } = scope(value, sequenceId),
    chosen = selected(before, clipIds),
    after = structuredClone(before);
  unlocked(before, chosen);
  const affected = before.transitions.filter(
    (item) => chosen.has(item.fromClipId) || chosen.has(item.toClipId),
  );
  if (affected.length && !options.removeTransitions)
    throw new Error("所选片段带有转场；如需修改时间，请明确选择移除相关转场");
  after.transitions = after.transitions.filter(
    (item) => !affected.some((original) => original.id === item.id),
  );
  if (options.detachCaptions)
    for (const clip of after.clips)
      if (clip.kind === "text" && clip.sourceBinding && chosen.has(clip.sourceBinding.clipId))
        delete clip.sourceBinding;
  const owners = [...chosen].filter((id) => {
    const clip = find(before, id);
    return !(clip.kind === "text" && clip.sourceBinding && chosen.has(clip.sourceBinding.clipId));
  });
  if (action.kind === "map" && owners.length > 1) {
    const anchor = find(before, owners[0]!);
    if (
      !("timeMap" in anchor) ||
      owners.some((id) => {
        const member = find(before, id);
        return (
          !("timeMap" in member) ||
          member.start !== anchor.start ||
          member.duration !== anchor.duration ||
          !equal(member.timeMap, anchor.timeMap)
        );
      })
    )
      throw new Error(
        "共同编辑点表需要成组片段具有相同的起点、时长和来源映射；请先单独整理不同步片段",
      );
  }
  for (const id of owners) {
    const clip = find(after, id),
      input = isolated(document, after, clip);
    let operations: EditorOperation[];
    if (action.kind === "speed") operations = setClipSpeed(input, sequenceId, id, action.rate);
    else if (action.kind === "map") {
      operations = setClipTimeMap(input, sequenceId, id, action.timeMap);
    } else if (action.kind === "reverse") operations = reverseClip(input, sequenceId, id);
    else if (action.kind === "freeze")
      operations = freezeClip(input, sequenceId, id, action.time, action.duration);
    else {
      assertTick(action.time, "播放头时间");
      const start = action.kind === "keep-right" ? Math.max(0, action.time - clip.start) : 0;
      const end =
        action.kind === "keep-left"
          ? Math.min(clip.duration, action.time - clip.start)
          : clip.duration;
      operations =
        start >= end
          ? [{ type: "clip.remove", sequenceId, clipIds: [id] }]
          : trimClip(input, sequenceId, id, start, end);
    }
    const edited = applyEditorOperations(input, operations, input.revision).sequences.find(
      (item) => item.id === sequenceId,
    )!;
    const included = input.sequences
      .find((item) => item.id === sequenceId)!
      .clips.map((item) => item.id);
    after.clips = after.clips.filter((item) => !included.includes(item.id)).concat(edited.clips);
    if (action.kind === "speed" && action.preservePitch !== undefined) {
      const next = find(after, id);
      if ("audio" in next) next.audio.preservePitch = action.preservePitch;
    }
  }
  const targets = new Map<string, Tick>();
  if (options.ripple ?? before.timelineMode === "magnetic") {
    const tracks = new Set(
      owners
        .map((id) => find(before, id).trackId)
        .filter(
          (id) =>
            before.tracks.find((track) => track.id === id)?.kind !== "text" &&
            (options.ripple !== undefined || isMagneticTrack(before, id)),
        ),
    );
    for (const trackId of tracks) {
      const trackClips = ordered(before, trackId);
      let cursor = trackClips[0]?.start ?? 0,
        previousOriginal: EditorClip | undefined,
        previousNext: EditorClip | undefined;
      for (const original of trackClips) {
        if (previousOriginal)
          cursor += Math.max(
            0,
            original.start - previousOriginal.start - previousOriginal.duration,
          );
        const next = after.clips.find((item) => item.id === original.id);
        if (next) {
          const overlap = previousNext
            ? (pairTransition(after, previousNext.id, next.id)?.duration ?? 0)
            : 0;
          targets.set(next.id, cursor - overlap);
          cursor = cursor - overlap + next.duration;
          previousNext = next;
        }
        previousOriginal = original;
      }
    }
  } else if (affected.length) throw new Error("移除转场需要联动后续片段以消除重叠，请开启联动排列");
  const shifts = moveTargets(before, after, targets);
  return finish(document, before, after, shifts);
}

/** Adjacent picture clips are required; no source handles are fabricated or silently trimmed. */
export function planTransition(
  value: EditorDocument,
  sequenceId: string,
  fromClipId: string,
  toClipId: string,
  options: TransitionPlanOptions,
): EditorOperation[] {
  const { document, sequence: before } = scope(value, sequenceId),
    from = find(before, fromClipId),
    to = find(before, toClipId),
    after = structuredClone(before);
  if (
    from.trackId !== to.trackId ||
    before.tracks.find((track) => track.id === from.trackId)?.kind !== "video"
  )
    throw new Error("转场需要同一画面轨的相邻片段");
  const clips = ordered(before, from.trackId),
    fromIndex = clips.findIndex((item) => item.id === from.id);
  if (clips[fromIndex + 1]?.id !== to.id) throw new Error("请选择从前到后相邻的两个画面片段");
  unlocked(before, [from.id, to.id]);
  const existing = pairTransition(before, from.id, to.id),
    duration = options.remove ? 0 : assertTick(options.duration, "转场时长");
  if (!options.remove && (!duration || duration >= Math.min(from.duration, to.duration)))
    throw new Error("转场须短于前后两个片段的时长，且大于零");
  if (options.remove && !existing) throw new Error("这两个片段之间没有转场");
  after.transitions = after.transitions.filter((item) => item.id !== existing?.id);
  const target = from.start + from.duration - duration,
    delta = target - to.start,
    targets = new Map<string, Tick>([[from.id, from.start]]);
  const suffix = options.placement === "overlap" ? [to] : clips.slice(fromIndex + 1);
  suffix.forEach((clip) => targets.set(clip.id, clip.start + delta));
  const shifts = moveTargets(before, after, targets);
  if (!options.remove)
    after.transitions.push({
      id: existing?.id ?? options.id,
      fromClipId: from.id,
      toClipId: to.id,
      start: find(after, to.id).start,
      duration,
      kind: options.kind,
    });
  return finish(document, before, after, shifts);
}

/** Compact one chosen picture track from zero, preserving order, each transition and linked offsets. */
export function planTimelineArrangement(
  value: EditorDocument,
  sequenceId: string,
  options: { mode: "magnetic" | "free"; trackId?: string; compact?: boolean },
): EditorOperation[] {
  const { document, sequence: before } = scope(value, sequenceId),
    after = structuredClone(before);
  if (!["magnetic", "free"].includes(options.mode)) throw new Error("排列方式无效");
  after.timelineMode = options.mode;
  let shifts = new Map<string, Tick>();
  if (options.compact) {
    const trackId =
      options.trackId ??
      before.magneticTrackId ??
      before.tracks.find((track) => track.kind === "video")?.id;
    if (!trackId || before.tracks.find((track) => track.id === trackId)?.kind !== "video")
      throw new Error("请选择需要整理的画面轨");
    const clips = ordered(before, trackId),
      targets = new Map<string, Tick>();
    for (let index = 0; index < clips.length; index++) {
      const clip = clips[index]!,
        previous = clips[index - 1];
      targets.set(
        clip.id,
        previous
          ? targets.get(previous.id)! +
              previous.duration -
              (pairTransition(before, previous.id, clip.id)?.duration ?? 0)
          : 0,
      );
    }
    shifts = moveTargets(before, after, targets);
  }
  return finish(document, before, after, shifts);
}

/** Moving a picture with a transition moves the complete connected block, including dependent audio/text. */
export function magneticMovementIds(
  sequence: EditorSequence,
  clipIds: readonly string[],
): string[] {
  const initial = selected(sequence, clipIds);
  if (
    ![...initial].some(
      (id) =>
        sequence.tracks.find((track) => track.id === find(sequence, id).trackId)?.kind ===
          "video" && magneticTrackMatches(sequence, find(sequence, id).trackId),
    )
  )
    return [...initial];
  return components(sequence, true, true)
    .filter((group) => [...group].some((id) => initial.has(id)))
    .flatMap((group) => [...group]);
}
interface MagneticBlock {
  clips: EditorClip[];
  start: Tick;
  duration: Tick;
}
function blocks(
  sequence: EditorSequence,
  trackId: string,
  ids?: ReadonlySet<string>,
): MagneticBlock[] {
  return components(sequence, true, true)
    .map((group) => {
      const clips = ordered(sequence, trackId).filter(
        (clip) => group.has(clip.id) && (!ids || ids.has(clip.id)),
      );
      const start = clips[0]?.start ?? 0;
      return {
        clips,
        start,
        duration:
          clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), start) - start,
      };
    })
    .filter((block) => block.clips.length)
    .sort((a, b) => a.start - b.start);
}
/** Connected blocks on one track (groups, links, bound captions, transitions), in time order. */
export function magneticBlocks(
  sequence: EditorSequence,
  trackId: string,
): { clipIds: string[]; start: Tick; end: Tick }[] {
  return blocks(sequence, trackId).map((block) => ({
    clipIds: block.clips.map((clip) => clip.id),
    start: block.start,
    end: block.start + block.duration,
  }));
}
function packBlocks(values: MagneticBlock[], targets: Map<string, Tick>): void {
  let cursor = 0;
  for (const block of values) {
    for (const clip of block.clips) targets.set(clip.id, cursor + clip.start - block.start);
    cursor += block.duration;
  }
}
export interface MagneticMoveOptions {
  delta: Tick;
  trackId?: string;
  anchorClipId?: string;
  /** Keyboard movement changes neighboring block order on picture tracks; audio/text remain frame nudges. */
  direction?: "previous" | "next";
}
/** Reorder one picture block at the nearest insertion boundary, then compact its source/destination picture tracks. */
export function planMagneticMove(
  value: EditorDocument,
  sequenceId: string,
  clipIds: readonly string[],
  options: MagneticMoveOptions,
): EditorOperation[] {
  const { document, sequence: before } = scope(value, sequenceId),
    after = structuredClone(before);
  if (!Number.isSafeInteger(options.delta)) throw new Error("移动距离必须为有效刻度");
  const anchor = find(before, options.anchorClipId ?? clipIds[0]!);
  if (!clipIds.includes(anchor.id)) throw new Error("移动锚点必须是所选片段");
  const destinationId = options.trackId ?? anchor.trackId;
  if (
    before.tracks.find((track) => track.id === anchor.trackId)?.kind !== "video" ||
    (!magneticTrackMatches(before, anchor.trackId) && !magneticTrackMatches(before, destinationId))
  ) {
    const operations: EditorOperation[] = [
      {
        type: "clip.move",
        sequenceId,
        clipIds: [...clipIds],
        delta: options.delta,
        ...(options.trackId === undefined ? {} : { trackId: options.trackId }),
      },
    ];
    applyEditorOperations(document, operations, document.revision);
    return operations;
  }
  const initial = selected(before, clipIds);
  const chosen = new Set(
    components(before, true, true)
      .filter((group) => [...group].some((id) => initial.has(id)))
      .flatMap((group) => [...group]),
  );
  unlocked(before, chosen);
  const fromIndex = before.tracks.findIndex((track) => track.id === anchor.trackId),
    toIndex =
      options.trackId === undefined
        ? fromIndex
        : before.tracks.findIndex((track) => track.id === options.trackId),
    trackShift = toIndex - fromIndex;
  if (toIndex < 0 || before.tracks[toIndex]!.kind !== "video")
    throw new Error("请选择有效的画面目标轨道");
  const destination = before.tracks[toIndex]!.id;
  for (const clip of after.clips.filter((clip) => chosen.has(clip.id))) {
    if (clip.kind === "text" && clip.sourceBinding && chosen.has(clip.sourceBinding.clipId))
      continue;
    const sourceIndex = before.tracks.findIndex((track) => track.id === clip.trackId),
      track = before.tracks[sourceIndex + trackShift];
    if (!track || track.kind !== before.tracks[sourceIndex]!.kind)
      throw new Error("成组片段移动后轨道类型不匹配或超出范围");
    if (track.locked) throw new Error("目标轨道已锁定，所有片段均未修改");
    clip.trackId = track.id;
  }
  const targets = new Map<string, Tick>();
  const kept = new Set(after.clips.filter((clip) => !chosen.has(clip.id)).map((clip) => clip.id));
  if (destination !== anchor.trackId && magneticTrackMatches(before, anchor.trackId))
    packBlocks(blocks(after, anchor.trackId, kept), targets);
  const movingClips = ordered(after, destination).filter((clip) => chosen.has(clip.id)),
    start = movingClips[0]!.start;
  const moving: MagneticBlock = {
    clips: movingClips,
    start,
    duration: Math.max(...movingClips.map((clip) => clip.start + clip.duration)) - start,
  };
  const remaining = blocks(after, destination, kept);
  const desired = start + options.delta;
  let index = remaining.filter((block) => desired >= block.start + block.duration / 2).length;
  if (options.direction && destination === anchor.trackId) {
    const oldIndex = remaining.filter((block) => block.start < start).length;
    index = Math.max(
      0,
      Math.min(remaining.length, oldIndex + (options.direction === "previous" ? -1 : 1)),
    );
  }
  if (magneticTrackMatches(before, destination)) {
    remaining.splice(index, 0, moving);
    packBlocks(remaining, targets);
  } else {
    for (const clip of moving.clips) targets.set(clip.id, clip.start + options.delta);
  }
  const shifts = moveTargets(before, after, targets);
  return finish(document, before, after, shifts);
}

/** Delete explicit groups/links and owned captions; only transitions attached to removed clips are removed. */
export function planMagneticRemove(
  value: EditorDocument,
  sequenceId: string,
  clipIds: readonly string[],
): EditorOperation[] {
  const { document, sequence: before } = scope(value, sequenceId),
    chosen = selected(before, clipIds),
    after = structuredClone(before);
  unlocked(before, chosen);
  const tracks = new Set(
    [...chosen]
      .map((id) => find(before, id).trackId)
      .filter(
        (id) =>
          before.tracks.find((track) => track.id === id)?.kind === "video" &&
          magneticTrackMatches(before, id),
      ),
  );
  after.clips = after.clips.filter((clip) => !chosen.has(clip.id));
  after.transitions = after.transitions.filter(
    (transition) => !chosen.has(transition.fromClipId) && !chosen.has(transition.toClipId),
  );
  const targets = new Map<string, Tick>();
  for (const trackId of tracks) packBlocks(blocks(after, trackId), targets);
  const shifts = moveTargets(before, after, targets);
  return finish(document, before, after, shifts);
}
