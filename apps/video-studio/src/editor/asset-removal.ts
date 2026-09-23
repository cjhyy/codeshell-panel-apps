import { recordedNarrationClipIds } from "./narration-edits";
import { applyEditorOperations, type EditorOperation } from "./operations";
import { validateTimeMap } from "./time";
import type { EditorDocument, EditorSequence, JsonData, TextClip } from "./types";
import { sequenceDuration, validateEditorDocument } from "./validation";

export interface EditorAssetRemovalUsage {
  assetIds: string[];
  assetCount: number;
  /** Direct picture-track media and multicam instances, across every sequence. */
  clipCount: number;
  /** Direct media instances on audio tracks. */
  audioClipCount: number;
  multicamClipCount: number;
  /** Indirect compound instances that use these assets; these wrappers are not deleted. */
  sequenceClipCount: number;
  /** Sequences from which at least one media instance or owned subtitle is removed. */
  sequenceCount: number;
  transitionCount: number;
  affectedCaptionCount: number;
  /** Includes any title explicitly bound to a removed source as well as subtitles. */
  affectedTextClipCount: number;
  affectedAudioClipCount: number;
  roughCutCount: number;
  workflowSourceCount: number;
  narrationRecording: boolean;
  used: boolean;
}
const record = (value: JsonData | undefined): Record<string, JsonData> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value : undefined;

/** Delete library references, not source files. Unrelated timeline positions and source maps stay exact.
 * The caller applies reconcileEditorProduction before publishing, as for every other timeline edit. */
export function planEditorAssetRemoval(
  value: EditorDocument,
  ids: readonly string[],
): { operations: EditorOperation[]; usage: EditorAssetRemovalUsage } {
  const document = validateEditorDocument(value);
  if (!Array.isArray(ids) || ids.length > 1000) throw new Error("请选择最多 1000 个要删除的素材");
  const selected = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id))
      throw new Error("删除素材 ID 无效");
    if (!document.assets.some((asset) => asset.id === id))
      throw new Error("所选素材已不在当前工程，请刷新后重试");
    selected.add(id);
  }
  const usage: EditorAssetRemovalUsage = {
    assetIds: document.assets.filter((asset) => selected.has(asset.id)).map((asset) => asset.id),
    assetCount: selected.size,
    clipCount: 0,
    audioClipCount: 0,
    multicamClipCount: 0,
    sequenceClipCount: 0,
    sequenceCount: 0,
    transitionCount: 0,
    affectedCaptionCount: 0,
    affectedTextClipCount: 0,
    affectedAudioClipCount: 0,
    roughCutCount: 0,
    workflowSourceCount: 0,
    narrationRecording: false,
    used: false,
  };
  if (!selected.size) return { operations: [], usage };
  const sequences = new Map(document.sequences.map((sequence) => [sequence.id, sequence]));
  const removing = new Map(document.sequences.map((sequence) => [sequence.id, new Set<string>()]));
  const production = structuredClone(document.production ?? {});
  const narration = record(production.narration);
  usage.narrationRecording =
    typeof narration?.recordingAssetId === "string" && selected.has(narration.recordingAssetId);
  for (const sequence of document.sequences) {
    const targets = removing.get(sequence.id)!;
    // The narration workflow's recorded captions cannot outlive their recording.
    const recorded = usage.narrationRecording
      ? recordedNarrationClipIds(document, sequence.id, String(narration!.recordingAssetId))
      : new Set<string>();
    for (const clip of sequence.clips) {
      if (
        (clip.kind === "media" && selected.has(clip.assetId)) ||
        (clip.kind === "multicam" && clip.angles.some((angle) => selected.has(angle.assetId)))
      ) {
        targets.add(clip.id);
        if (sequence.tracks.find((track) => track.id === clip.trackId)!.kind === "audio")
          usage.audioClipCount++;
        else usage.clipCount++;
        if (clip.kind === "multicam") usage.multicamClipCount++;
      }
      if (
        clip.kind === "text" &&
        ((clip.sourceBinding?.provenance && selected.has(clip.sourceBinding.provenance.assetId)) ||
          recorded.has(clip.id))
      )
        targets.add(clip.id);
    }
  }
  // Resolve bindings by their actual instance path: another angle can delete the
  // multicam owner even when the subtitle's own recorded audio asset remains.
  const bindingRemoved = (sequence: EditorSequence, caption: TextClip): boolean => {
    const binding = caption.sourceBinding;
    if (!binding) return false;
    let ownerSequence = sequence;
    let owner = sequence.clips.find((clip) => clip.id === binding.clipId);
    if (removing.get(sequence.id)!.has(binding.clipId)) return true;
    for (const id of binding.provenance?.path ?? []) {
      if (owner?.kind !== "sequence") return false;
      ownerSequence = sequences.get(owner.sequenceId)!;
      if (removing.get(ownerSequence.id)!.has(id)) return true;
      owner = ownerSequence.clips.find((clip) => clip.id === id);
    }
    return false;
  };
  for (const sequence of document.sequences)
    for (const clip of sequence.clips)
      if (clip.kind === "text" && bindingRemoved(sequence, clip))
        removing.get(sequence.id)!.add(clip.id);

  const indirect = new Map<string, boolean>();
  const usesSelection = (sequence: EditorSequence): boolean => {
    if (indirect.has(sequence.id)) return indirect.get(sequence.id)!;
    const used = sequence.clips.some((clip) =>
      clip.kind === "sequence"
        ? usesSelection(sequences.get(clip.sequenceId)!)
        : clip.kind === "media"
          ? selected.has(clip.assetId)
          : clip.kind === "multicam" && clip.angles.some((angle) => selected.has(angle.assetId)),
    );
    indirect.set(sequence.id, used);
    return used;
  };
  const remaining = new Map(
    document.sequences.map((sequence) => [
      sequence.id,
      {
        ...sequence,
        clips: sequence.clips.filter((clip) => !removing.get(sequence.id)!.has(clip.id)),
      },
    ]),
  );
  for (const sequence of document.sequences) {
    for (const clip of sequence.clips) {
      if (clip.kind !== "sequence") continue;
      if (usesSelection(sequences.get(clip.sequenceId)!)) usage.sequenceClipCount++;
      const child = remaining.get(clip.sequenceId)!,
        duration = sequenceDuration(child);
      try {
        if (!duration) throw new Error("复合源序列为空");
        validateTimeMap(clip.timeMap, clip.duration, duration);
        if (
          clip.timeMap.points.some(
            (point, index, points) =>
              index && point.source === duration && points[index - 1]!.source === duration,
          )
        )
          throw new Error("复合片段定格点超出剩余画面");
      } catch {
        throw new Error(
          `删除素材会使复合片段“${clip.label}”引用的序列“${child.name}”时长不足，请先移除或调整该复合片段，再删除素材`,
        );
      }
    }
  }
  const operations: EditorOperation[] = [];
  for (const sequence of document.sequences) {
    const targets = removing.get(sequence.id)!;
    if (!targets.size) continue;
    usage.sequenceCount++;
    for (const clip of sequence.clips.filter((clip) => targets.has(clip.id))) {
      const track = sequence.tracks.find((track) => track.id === clip.trackId)!;
      if (track.locked)
        throw new Error(`序列“${sequence.name}”的轨道“${track.name}”已锁定，请先解锁后删除素材`);
      if (clip.kind === "text" && clip.role === "subtitle") usage.affectedCaptionCount++;
    }
    usage.transitionCount += sequence.transitions.filter(
      (transition) => targets.has(transition.fromClipId) || targets.has(transition.toClipId),
    ).length;
    operations.push({ type: "clip.remove", sequenceId: sequence.id, clipIds: [...targets] });
  }
  if (Array.isArray(production.roughCuts)) {
    const retained = production.roughCuts.filter(
      (cut) =>
        !(typeof record(cut)?.assetId === "string" && selected.has(record(cut)!.assetId as string)),
    );
    usage.roughCutCount = production.roughCuts.length - retained.length;
    production.roughCuts = retained;
  }
  const workflow = record(production.workflow);
  if (workflow && Array.isArray(workflow.sources)) {
    const retained = workflow.sources.filter(
      (source) =>
        !(
          typeof record(source)?.assetId === "string" &&
          selected.has(record(source)!.assetId as string)
        ),
    );
    usage.workflowSourceCount = workflow.sources.length - retained.length;
    workflow.sources = retained;
  }
  if (usage.narrationRecording && narration) {
    const active = remaining.get(document.activeSequenceId)!;
    production.narration = {
      phase: active.clips.some((clip) => ["media", "multicam", "sequence"].includes(clip.kind))
        ? "review"
        : "draft",
      captionBasis: "draft",
      draftCaptionIds: structuredClone(narration.draftCaptionIds ?? []),
    };
  }
  if (JSON.stringify(production) !== JSON.stringify(document.production ?? {}))
    operations.push({ type: "project.production", data: production });
  operations.push(
    ...usage.assetIds.map((assetId): EditorOperation => ({ type: "asset.remove", assetId })),
  );
  const after = applyEditorOperations(document, operations, document.revision);
  // Account for dependent text removed by the shared transaction reconciler.
  const surviving = new Map(
    after.sequences.map((sequence) => [
      sequence.id,
      new Set(sequence.clips.map((clip) => clip.id)),
    ]),
  );
  usage.affectedCaptionCount = 0;
  for (const sequence of document.sequences)
    for (const clip of sequence.clips) {
      if (clip.kind !== "text" || surviving.get(sequence.id)!.has(clip.id)) continue;
      usage.affectedTextClipCount++;
      if (clip.role === "subtitle") usage.affectedCaptionCount++;
    }
  usage.affectedAudioClipCount = usage.audioClipCount;
  usage.used = !!(
    usage.clipCount ||
    usage.audioClipCount ||
    usage.affectedTextClipCount ||
    usage.roughCutCount ||
    usage.workflowSourceCount ||
    usage.narrationRecording
  );
  return { operations, usage };
}
