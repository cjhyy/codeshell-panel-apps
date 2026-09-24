import {
  draftTextSegments,
  narrationFingerprint,
  normalizeNarrationScript,
  validateNarration,
  type NarrationState,
} from "../narration";
import {
  compileCaptionSources,
  planAddCaptions,
  planTranscriptCaptions,
  type CaptionDraft,
  type CaptionSource,
} from "./captions";
import { captionClipIdsForLegacyIds, projectLegacyView } from "./legacy-adapter";
import { legacyClipId } from "./legacy-aliases";
import { isSubtitleClip, sequenceOf as findSequence } from "./lookup";
import { applyEditorOperations, type EditorOperation } from "./operations";
import { narrationDependencies, reconcileEditorProduction } from "./production-guard";
import { frameToTicks, mergeTimeRanges, secondsToTicks, TICKS_PER_SECOND, type Tick, type TimeMap, type TimeRange } from "./time";
import type { EditorDocument, EditorSequence, JsonData, TextClip } from "./types";
import { sequenceDuration, validateEditorDocument } from "./validation";

/**
 * The narration workflow ("先看草稿，再用自己的声音讲") on the editor document. State stays in
 * `production.narration`; these planners return operations for the panel's coordinator,
 * which saves them without the generic approval guard (the guard would reset a state the
 * coordinator is deliberately writing).
 */
export const DRAFT_CAPTION_PREFIX = "draft-narration-";
export const RECORDED_CAPTION_PREFIX = "recorded-narration-";
const APPROVED = new Set<NarrationState["phase"]>(["approved", "recorded", "aligned"]);
const MAX_CLIPS = 2000;
const MAX_SEGMENTS = 10000;
/** Coverage slack for rounding through nested time maps: well below one audio sample. */
const COVERAGE_TOLERANCE = 4;

const codeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const record = (value: JsonData | undefined): Record<string, JsonData> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
const sequenceOf = (doc: EditorDocument, id: string) =>
  findSequence(doc, id, "口播对应的时间线不存在");

/** The validated narration state, or undefined when the project has none (or an unusable one). */
export function readNarration(doc: EditorDocument): NarrationState | undefined {
  const value = doc.production?.narration;
  if (value === undefined) return undefined;
  try {
    return validateNarration(value, doc.assets);
  } catch {
    return undefined;
  }
}
const scriptOf = (doc: EditorDocument) =>
  typeof doc.production?.script === "string" ? doc.production.script : "";
function storedDraftIds(doc: EditorDocument): string[] {
  const ids = record(doc.production?.narration)?.draftCaptionIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}
function storedRecordingId(doc: EditorDocument): string | undefined {
  const id = record(doc.production?.narration)?.recordingAssetId;
  return typeof id === "string" ? id : undefined;
}

/** Temporary draft subtitles: listed by clip ID, or by their old caption ID in older projects. */
export function narrationDraftClipIds(doc: EditorDocument, sequenceId: string): Set<string> {
  const ids = storedDraftIds(doc),
    wanted = new Set(ids),
    result = new Set<string>();
  if (!ids.length) return result;
  for (const clip of doc.sequences.find((item) => item.id === sequenceId)?.clips ?? [])
    if (isSubtitleClip(clip) && wanted.has(clip.id)) result.add(clip.id);
  for (const id of captionClipIdsForLegacyIds(doc, sequenceId, ids)) result.add(id);
  return result;
}
/** Subtitles named as temporary narration captions (the draft run's naming rule). */
export function draftNamedClipIds(doc: EditorDocument, sequenceId: string): Set<string> {
  const result = new Set<string>();
  for (const clip of doc.sequences.find((item) => item.id === sequenceId)?.clips ?? [])
    if (
      isSubtitleClip(clip) &&
      (clip.id.startsWith(DRAFT_CAPTION_PREFIX) ||
        legacyClipId(doc, sequenceId, clip, "captions").startsWith(DRAFT_CAPTION_PREFIX))
    )
      result.add(clip.id);
  return result;
}
/**
 * Subtitles the alignment step generated, known by their recorded-narration- name (clip ID or
 * old caption ID). Captions the user made from the same recording on the 字幕 page are theirs.
 */
export function recordedNarrationClipIds(doc: EditorDocument, sequenceId: string): Set<string> {
  const result = new Set<string>();
  for (const clip of doc.sequences.find((item) => item.id === sequenceId)?.clips ?? [])
    if (
      isSubtitleClip(clip) &&
      (clip.id.startsWith(RECORDED_CAPTION_PREFIX) ||
        legacyClipId(doc, sequenceId, clip, "captions").startsWith(RECORDED_CAPTION_PREFIX))
    )
      result.add(clip.id);
  return result;
}

async function sha256(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
/** SHA-256 of the narration dependencies (editor fingerprint basis). */
export function editorNarrationFingerprint(doc: EditorDocument): Promise<string> {
  return sha256(narrationDependencies(doc));
}
function expectedFingerprint(state: NarrationState): string | undefined {
  return (state.phase === "recorded" || state.phase === "aligned") && state.alignmentFingerprint
    ? state.alignmentFingerprint
    : state.approvedFingerprint;
}
/** Why the saved confirmation does not cover the current project, or null when it does. */
export async function narrationApprovalIssue(doc: EditorDocument): Promise<string | null> {
  const state = readNarration(doc);
  if (!state || !APPROVED.has(state.phase) || !state.approvedScript || !state.approvedFingerprint)
    return "请先完成草稿审阅并确认文案";
  if (state.approvedScript !== scriptOf(doc)) return "文案已改变，请重新确认草稿";
  const expected = expectedFingerprint(state)!;
  if (state.fingerprintBasis === "editor")
    return expected === (await editorNarrationFingerprint(doc))
      ? null
      : "草稿已改变，请重新确认文案与画面";
  // Older approvals hashed the 30 fps view; it is only comparable while that view is complete.
  const view = projectLegacyView(doc);
  if (!view.timelineComplete) return "工程已变化，请重新确认文稿与草稿画面";
  return expected === (await narrationFingerprint(structuredClone(view.project)))
    ? null
    : "草稿已改变，请重新确认文案与画面";
}
export async function hasEditorNarrationApproval(doc: EditorDocument): Promise<boolean> {
  return (await narrationApprovalIssue(doc)) === null;
}
/** A still-valid older approval is rewritten on the editor basis at the next coordinator write. */
export async function narrationOnEditorBasis(
  doc: EditorDocument,
  state: NarrationState,
): Promise<NarrationState> {
  if (state.fingerprintBasis === "editor" || !APPROVED.has(state.phase)) return state;
  if (!(await hasEditorNarrationApproval(doc))) return state;
  const fingerprint = await editorNarrationFingerprint(doc),
    next: NarrationState = { ...state, fingerprintBasis: "editor" };
  if ((state.phase === "recorded" || state.phase === "aligned") && state.alignmentFingerprint)
    next.alignmentFingerprint = fingerprint;
  else next.approvedFingerprint = fingerprint;
  return next;
}
function production(doc: EditorDocument, patch: Record<string, JsonData>): EditorOperation {
  return {
    type: "project.production",
    data: { ...structuredClone(doc.production ?? {}), ...structuredClone(patch) },
  };
}
const narrationData = (state: NarrationState) => structuredClone(state) as unknown as JsonData;
function usableRecording(doc: EditorDocument, id: string | undefined): string | undefined {
  return id &&
    doc.assets.some((asset) => asset.id === id && (asset.kind === "audio" || asset.kind === "video"))
    ? id
    : undefined;
}
/** The coordinator's write of a narration state it has decided on (validated first). */
export function narrationStateOperation(
  doc: EditorDocument,
  state: NarrationState,
): EditorOperation {
  return production(doc, { narration: narrationData(validateNarration(state, doc.assets)) });
}
/** The sequence shows picture: media, a nested sequence or multicam on a picture track. */
export function hasNarrationPicture(doc: EditorDocument, sequenceId: string): boolean {
  return hasPicture(doc, sequenceId);
}
function hasPicture(doc: EditorDocument, sequenceId: string): boolean {
  const sequence = sequenceOf(doc, sequenceId);
  return sequence.clips.some(
    (clip) =>
      (clip.kind === "media" || clip.kind === "sequence" || clip.kind === "multicam") &&
      sequence.tracks.find((track) => track.id === clip.trackId)?.kind === "video",
  );
}

/**
 * Save the script and rebuild the estimated temporary subtitles over the real sequence length,
 * on the sequence's own frame grid. Only this workflow's drafts and recorded captions are
 * replaced; the user's subtitles and titles stay.
 */
export function planNarrationScript(
  value: EditorDocument,
  sequenceId: string,
  text: string,
  idFactory?: () => string,
): EditorOperation[] {
  const doc = validateEditorDocument(value),
    updated = normalizeNarrationScript(text),
    previous = readNarration(doc);
  sequenceOf(doc, sequenceId);
  const owned = new Set([
    ...narrationDraftClipIds(doc, sequenceId),
    ...(previous ? recordedNarrationClipIds(doc, sequenceId) : []),
  ]);
  const operations: EditorOperation[] = owned.size
    ? [{ type: "clip.remove", sequenceId, clipIds: [...owned] }]
    : [];
  const draft = applyEditorOperations(doc, operations, doc.revision),
    sequence = sequenceOf(draft, sequenceId),
    duration = sequenceDuration(sequence),
    unit = frameToTicks(1, sequence.frameRate),
    slots = Math.ceil(duration / unit),
    capacity = MAX_CLIPS - sequence.clips.length;
  if (duration > 0 && capacity < 1)
    throw new Error("时间线片段已达 2000 个上限，请先整理片段，再生成临时字幕");
  const segments = duration > 0 ? draftTextSegments(updated, Math.min(slots, capacity)) : [];
  const weights = segments.map((segment) => [...segment.replace(/\s/g, "")].length || 1);
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const spareSlots = slots - segments.length;
  const shares = weights.map((weight) => (spareSlots * weight) / totalWeight);
  const lengths = shares.map((share) => Math.floor(share) + 1);
  const spare = slots - lengths.reduce((total, length) => total + length, 0);
  const allocation = shares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of allocation.slice(0, spare)) lengths[index]!++;
  const used = new Set(sequence.clips.map((clip) => clip.id)),
    items: CaptionDraft[] = [];
  let cursor = 0,
    serial = 1;
  for (const [index, segment] of segments.entries()) {
    let id: string;
    do id = `${DRAFT_CAPTION_PREFIX}${serial++}`;
    while (used.has(id));
    used.add(id);
    const start = cursor * unit;
    cursor += lengths[index]!;
    items.push({
      id,
      start,
      end: index === segments.length - 1 ? duration : Math.min(duration, cursor * unit),
      text: segment,
    });
  }
  if (items.length)
    operations.push(
      ...planAddCaptions(draft, sequenceId, items, idFactory ? { idFactory } : {}),
    );
  const recordingAssetId = usableRecording(doc, previous?.recordingAssetId);
  const narration: NarrationState = {
    phase: !duration || previous?.phase === "draft" ? "draft" : "review",
    captionBasis: "draft",
    draftCaptionIds: items.map((item) => item.id!),
    ...(recordingAssetId ? { recordingAssetId } : {}),
  };
  operations.push(production(doc, { script: updated, narration: narrationData(narration) }));
  applyEditorOperations(doc, operations, doc.revision);
  return operations;
}

/** Start (draft) or return to (review) the draft stage; temporary subtitles and the take stay. */
export function planNarrationPhase(
  value: EditorDocument,
  phase: "draft" | "review",
): EditorOperation[] {
  const doc = validateEditorDocument(value),
    previous = readNarration(doc),
    recordingAssetId = usableRecording(doc, previous?.recordingAssetId ?? storedRecordingId(doc));
  const narration: NarrationState = {
    phase,
    captionBasis: "draft",
    draftCaptionIds: previous?.draftCaptionIds ?? storedDraftIds(doc),
    ...(recordingAssetId ? { recordingAssetId } : {}),
  };
  return [production(doc, { narration: narrationData(narration) })];
}

/** The user's confirmation of the reviewed draft, fingerprinted on the editor document. */
export async function planApproveNarration(value: EditorDocument): Promise<EditorOperation[]> {
  const doc = validateEditorDocument(value),
    state = readNarration(doc);
  if (!state || state.phase !== "review") throw new Error("请先完成草稿并进入审阅，再确认口播");
  const approvedScript = scriptOf(doc);
  normalizeNarrationScript(approvedScript);
  if (!hasPicture(doc, doc.activeSequenceId)) throw new Error("请先安排草稿画面，再确认口播");
  const narration: NarrationState = {
    ...state,
    phase: "approved",
    captionBasis: "draft",
    approvedScript,
    approvedFingerprint: await editorNarrationFingerprint(doc),
    fingerprintBasis: "editor",
  };
  return [production(doc, { narration: narrationData(narration) })];
}

/** The root and nested sequences used only from within it (no other timeline refers to them). */
function exclusiveSequences(doc: EditorDocument, rootId: string): Set<string> {
  const reachable = new Set(reachableSequences(doc, rootId).map((item) => item.id)),
    exclusive = new Set([rootId]);
  const referrers = (id: string) =>
    doc.sequences.filter((item) =>
      item.clips.some((clip) => clip.kind === "sequence" && clip.sequenceId === id),
    );
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of reachable) {
      if (exclusive.has(id)) continue;
      const from = referrers(id);
      if (from.length && from.every((item) => exclusive.has(item.id))) {
        exclusive.add(id);
        changed = true;
      }
    }
  }
  return exclusive;
}
function reachableSequences(doc: EditorDocument, rootId: string): EditorSequence[] {
  const result: EditorSequence[] = [],
    seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const sequence = doc.sequences.find((item) => item.id === id);
    if (!sequence) return;
    result.push(sequence);
    for (const clip of sequence.clips) if (clip.kind === "sequence") visit(clip.sequenceId);
  };
  visit(rootId);
  return result;
}

/**
 * Choose the user's own recording. Replacing a take removes the previous take from the audio
 * tracks and its recorded captions, and checkpoints that controlled change so the original
 * confirmation of the draft still applies.
 */
export async function planBindNarrationRecording(
  value: EditorDocument,
  assetId: string,
): Promise<EditorOperation[]> {
  const doc = validateEditorDocument(value),
    issue = await narrationApprovalIssue(doc);
  if (issue) throw new Error(issue);
  const asset = doc.assets.find((item) => item.id === assetId);
  if (!asset || (asset.kind !== "audio" && asset.kind !== "video"))
    throw new Error("请选择当前工程中的本人录音或视频");
  if (asset.metadata?.speech) throw new Error("合成配音不能作为本人录音");
  const state = await narrationOnEditorBasis(doc, readNarration(doc)!),
    previousId = state.recordingAssetId,
    replacing = Boolean(previousId && previousId !== assetId),
    operations: EditorOperation[] = [];
  if (replacing) {
    const captions = recordedNarrationClipIds(doc, doc.activeSequenceId),
      exclusive = exclusiveSequences(doc, doc.activeSequenceId);
    const plays = (sequence: EditorSequence) =>
      sequence.clips.some(
        (clip) =>
          clip.kind === "media" &&
          clip.assetId === previousId &&
          sequence.tracks.find((track) => track.id === clip.trackId)?.kind === "audio",
      );
    if (reachableSequences(doc, doc.activeSequenceId).some((item) => !exclusive.has(item.id) && plays(item)))
      throw new Error(
        "原录音还在其他时间线也用到的嵌套序列里，请先在那个嵌套序列中移除原录音，再更换本人录音",
      );
    for (const sequence of reachableSequences(doc, doc.activeSequenceId)) {
      const clipIds = sequence.clips
        .filter(
          (clip) =>
            (clip.kind === "media" &&
              clip.assetId === previousId &&
              sequence.tracks.find((track) => track.id === clip.trackId)?.kind === "audio") ||
            (sequence.id === doc.activeSequenceId && captions.has(clip.id)),
        )
        .map((clip) => clip.id);
      if (clipIds.length) operations.push({ type: "clip.remove", sequenceId: sequence.id, clipIds });
    }
  }
  const after = applyEditorOperations(doc, operations, doc.revision);
  const narration: NarrationState = {
    ...state,
    phase: "recorded",
    captionBasis: "draft",
    recordingAssetId: assetId,
  };
  if (replacing) {
    narration.alignmentFingerprint = await editorNarrationFingerprint(after);
    narration.fingerprintBasis = "editor";
  }
  validateNarration(narration, doc.assets);
  operations.push(production(after, { narration: narrationData(narration) }));
  return operations;
}

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words?: { text: string; start: number; end: number }[];
}
/** Source extent played by local [start, end) of a continuous, piecewise linear time map. */
function mapImage(map: TimeMap, start: Tick, end: Tick): TimeRange[] {
  const result: TimeRange[] = [];
  for (let index = 0; index + 1 < map.points.length; index++) {
    const a = map.points[index]!,
      b = map.points[index + 1]!,
      from = Math.max(start, a.time),
      to = Math.min(end, b.time);
    if (from >= to || a.source === b.source) continue;
    const at = (time: number) => a.source + ((b.source - a.source) * (time - a.time)) / (b.time - a.time);
    const x = at(from),
      y = at(to);
    result.push({ start: Math.floor(Math.min(x, y)), end: Math.ceil(Math.max(x, y)) });
  }
  return result;
}
/** Asset source ranges this audible instance actually plays, from its root timeline ranges. */
function retainedSource(source: CaptionSource): TimeRange[] {
  let ranges = source.ranges.map((range) => ({ ...range }));
  for (const stage of source.lane.stages) {
    ranges = mergeTimeRanges(
      ranges.flatMap((range) => {
        const from = Math.max(range.start, stage.start) - stage.start,
          to = Math.min(range.end, stage.start + stage.duration) - stage.start;
        return from < to ? mapImage(stage.timeMap, from, to) : [];
      }),
    );
  }
  return ranges.map((range) => ({
    start: range.start + source.lane.sourceOffset,
    end: range.end + source.lane.sourceOffset,
  }));
}
function onAudioTrack(doc: EditorDocument, source: CaptionSource): boolean {
  const leaf = source.lane.stages.at(-1)!;
  return (
    doc.sequences
      .find((item) => item.id === leaf.sequenceId)
      ?.tracks.find((track) => track.id === leaf.track.id)?.kind === "audio"
  );
}

/**
 * Replace the temporary subtitles with the recording's real transcript. Every transcribed
 * sentence must be kept by the take on audible audio tracks; the captions are bound to the take,
 * so they follow it through speed changes, nested sequences and every placed instance.
 */
export function planNarrationAlignment(
  value: EditorDocument,
  sequenceId: string,
  segments: readonly TranscriptSegment[],
): { operations: EditorOperation[]; added: number; keptUserCaptions: number } {
  const doc = validateEditorDocument(value),
    state = readNarration(doc),
    recordingId = state?.recordingAssetId,
    asset = doc.assets.find((item) => item.id === recordingId);
  if (!asset || (asset.kind !== "audio" && asset.kind !== "video"))
    throw new Error("请先保存并绑定当前工程的本人录音，再对齐字幕");
  if (asset.metadata?.speech) throw new Error("合成配音不能作为本人录音生成正式字幕");
  const sequence = sequenceOf(doc, sequenceId);
  const sources = compileCaptionSources(doc, sequenceId)
    .filter((source) => source.assetId === asset.id && onAudioTrack(doc, source))
    .sort(
      (a, b) =>
        codeUnits(a.ownerClipId, b.ownerClipId) || codeUnits(a.instanceId, b.instanceId),
    );
  if (!sources.length) throw new Error("请先将本人录音放入独立音轨并开启声音，再对齐字幕");
  if (!Array.isArray(segments) || !segments.length || segments.length > MAX_SEGMENTS)
    throw new Error("需要本人录音的真实转写分段，不能用文稿估算字幕时间");
  const duration = asset.duration / TICKS_PER_SECOND,
    frame = frameToTicks(1, sequence.frameRate) / TICKS_PER_SECOND,
    epsilon = 1e-9;
  const transcript = Array.from(segments, (segment, index) => {
    if (
      !segment ||
      typeof segment !== "object" ||
      !Number.isFinite(segment.start) ||
      !Number.isFinite(segment.end) ||
      segment.start < 0 ||
      segment.end <= segment.start ||
      segment.start >= duration ||
      segment.end > duration + frame + epsilon ||
      typeof segment.text !== "string" ||
      !segment.text.trim() ||
      segment.text.length > 4000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(segment.text)
    )
      throw new Error(`本人录音第 ${index + 1} 段转写的文字或真实时间无效，请重新转写`);
    const end = Math.min(segment.end, duration);
    const result: TranscriptSegment = { start: segment.start, end, text: segment.text };
    const words: TranscriptSegment["words"] = segment.words;
    if (Array.isArray(words) && words.length)
      result.words = words
        .filter((word) => word.start < end)
        .map((word) => ({ text: word.text, start: word.start, end: Math.min(word.end, end) }));
    return result;
  });
  const retained = mergeTimeRanges(sources.flatMap(retainedSource), COVERAGE_TOLERANCE);
  for (const [index, segment] of transcript.entries()) {
    const from = secondsToTicks(segment.start),
      to = secondsToTicks(segment.end);
    if (
      !retained.some(
        (range) =>
          range.start <= from + COVERAGE_TOLERANCE && range.end + COVERAGE_TOLERANCE >= to,
      )
    )
      throw new Error(
        `本人录音第 ${index + 1} 段说话内容未完整保留。请先补足画面和音轨，不能为适配草稿时长截掉尾句或重说内容。`,
      );
  }
  const owned = new Set([
    ...narrationDraftClipIds(doc, sequenceId),
    ...recordedNarrationClipIds(doc, sequenceId),
  ]);
  const operations: EditorOperation[] = owned.size
    ? [{ type: "clip.remove", sequenceId, clipIds: [...owned] }]
    : [];
  const draft = applyEditorOperations(doc, operations, doc.revision);
  // The user's own captions from this recording (字幕 page, maybe corrected) stay; the
  // alignment does not add a second caption over them.
  const userCaptions = sequenceOf(draft, sequenceId).clips.filter(
    (clip): clip is TextClip =>
      isSubtitleClip(clip) && clip.sourceBinding?.provenance?.assetId === asset.id,
  );
  const lanes = new Map(sources.map((source, index) => [source.instanceId, index + 1]));
  const used = new Set(sequenceOf(draft, sequenceId).clips.map((clip) => clip.id));
  const plan = planTranscriptCaptions(draft, sequenceId, new Map([[asset.id, transcript]]), {
    assetIds: [asset.id],
    sourceFilter: (source) => lanes.has(source.instanceId),
    captionId: (source, segment, range) => {
      const base = `${RECORDED_CAPTION_PREFIX}${lanes.get(source.instanceId)}-${segment + 1}${range ? `-${range + 1}` : ""}`;
      let id = base,
        suffix = 0;
      while (used.has(id)) id = `${base}-${++suffix}`;
      used.add(id);
      return id;
    },
  });
  const covered = (clip: TextClip) =>
    userCaptions.some(
      (user) => user.start < clip.start + clip.duration && clip.start < user.start + user.duration,
    );
  const generated = plan.operations.filter(
    (operation) =>
      operation.type === "clip.add" && operation.clip.kind === "text" && !covered(operation.clip),
  );
  if (generated.length)
    operations.push(
      ...plan.operations.filter((operation) => operation.type !== "clip.add"),
      ...generated,
    );
  applyEditorOperations(doc, operations, doc.revision);
  return { operations, added: generated.length, keptUserCaptions: userCaptions.length };
}

function sameCanvas(before: EditorDocument, after: EditorDocument): boolean {
  if (before.activeSequenceId !== after.activeSequenceId) return false;
  const a = sequenceOf(before, before.activeSequenceId),
    b = after.sequences.find((item) => item.id === after.activeSequenceId);
  return (
    !!b && a.width === b.width && a.height === b.height && a.timelineMode === b.timelineMode
  );
}
function sameRecording(before: EditorDocument, after: EditorDocument, id: string): boolean {
  const pick = (doc: EditorDocument) => {
    const asset = doc.assets.find((item) => item.id === id);
    return asset
      ? JSON.stringify([asset.kind, asset.duration, asset.resourceId ?? null, asset.metadata?.speech ?? null])
      : null;
  };
  const known = pick(before);
  return known !== null && known === pick(after);
}
const PROTECTED = "这次编辑会让已确认的草稿与本人录音失效，自动制作不能这样修改";

/**
 * A granted edit during the recorded-narration run: the script, canvas and recording stay as
 * confirmed, and only the coordinator writes the narration state. Other changes checkpoint the
 * alignment work (an edit after alignment returns to recorded).
 */
export async function reconcileNarrationRunEdit(
  beforeValue: EditorDocument,
  afterValue: EditorDocument,
): Promise<EditorOperation[]> {
  const before = validateEditorDocument(beforeValue),
    after = validateEditorDocument(afterValue),
    state = readNarration(before);
  if (!state || !APPROVED.has(state.phase)) return reconcileEditorProduction(before, after);
  if (JSON.stringify(before.production?.narration) !== JSON.stringify(after.production?.narration))
    throw new Error("口播确认状态由面板维护，自动制作不能自行修改口播确认状态");
  if (scriptOf(before) !== scriptOf(after)) throw new Error("本人录音阶段不能改写已确认文案");
  if (!sameCanvas(before, after)) throw new Error(PROTECTED);
  if (!state.recordingAssetId) throw new Error("请先选择本人录音，再编排录音与画面");
  if (!sameRecording(before, after, state.recordingAssetId)) throw new Error(PROTECTED);
  for (const sequence of before.sequences) {
    const owned = new Set([
      ...narrationDraftClipIds(before, sequence.id),
      ...recordedNarrationClipIds(before, sequence.id),
    ]);
    const next = after.sequences.find((item) => item.id === sequence.id);
    for (const clip of sequence.clips) {
      if (!isSubtitleClip(clip) || owned.has(clip.id)) continue;
      const kept = next?.clips.find((item) => item.id === clip.id);
      if (!kept || !isSubtitleClip(kept) || kept.text !== clip.text)
        throw new Error("自动制作不能修改或删除用户自己的字幕，请在制作单 blockers 写明需要调整的字幕");
    }
  }
  for (const sequence of after.sequences) {
    const known = new Map(
      (before.sequences.find((item) => item.id === sequence.id)?.clips ?? []).map((clip) => [
        clip.id,
        clip.kind === "media" ? clip.assetId : "",
      ]),
    );
    for (const clip of sequence.clips)
      if (
        clip.kind === "media" &&
        known.get(clip.id) !== clip.assetId &&
        after.assets.find((asset) => asset.id === clip.assetId)?.metadata?.speech
      )
        throw new Error("本人录音阶段不能加入合成配音，请保留本人的声音");
  }
  if (narrationDependencies(before) === narrationDependencies(after)) return [];
  if (!(await hasEditorNarrationApproval(before)))
    throw new Error("已确认的草稿已改变，请重新确认后使用本人录音");
  const narration: NarrationState = {
    ...(await narrationOnEditorBasis(before, state)),
    phase: "recorded",
    captionBasis: "draft",
    alignmentFingerprint: await editorNarrationFingerprint(after),
    fingerprintBasis: "editor",
  };
  return [production(after, { narration: narrationData(narration) })];
}

/** A granted edit during the draft run: subtitles it adds become temporary draft captions. */
export async function reconcileDraftRunEdit(
  beforeValue: EditorDocument,
  afterValue: EditorDocument,
): Promise<EditorOperation[]> {
  const before = validateEditorDocument(beforeValue),
    after = validateEditorDocument(afterValue);
  if (JSON.stringify(before.production?.narration) !== JSON.stringify(after.production?.narration))
    throw new Error("口播确认状态由面板维护，自动制作不能自行修改口播确认状态");
  const state = readNarration(before);
  if (!state || state.phase !== "draft") return reconcileEditorProduction(before, after);
  const sequenceId = after.activeSequenceId,
    known = new Set(
      before.sequences.find((item) => item.id === sequenceId)?.clips.map((clip) => clip.id) ?? [],
    ),
    // Only temporary captions still on the timeline; removed ones no longer count.
    current = [...narrationDraftClipIds(after, sequenceId)];
  const added = sequenceOf(after, sequenceId)
    .clips.filter((clip) => isSubtitleClip(clip) && !known.has(clip.id) && !current.includes(clip.id))
    .map((clip) => clip.id);
  if (!added.length) return [];
  if (current.length + added.length > 1000) throw new Error("临时字幕最多 1000 条，请先合并字幕");
  const narration: NarrationState = { ...state, draftCaptionIds: [...current, ...added] };
  return [production(after, { narration: narrationData(narration) })];
}
