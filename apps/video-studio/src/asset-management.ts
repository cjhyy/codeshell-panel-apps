import { applyOperations, validateProject, type EditOperation, type Project } from "./model";
import { reconcileNarrationEdit } from "./narration";

export interface AssetRemovalUsage {
  assetIds: string[];
  assetCount: number;
  /** Picture-sequence instances removed, including audio-only and demo instances. */
  clipCount: number;
  /** Independent audio instances directly referencing the removed assets. */
  audioClipCount: number;
  roughCutCount: number;
  removedFrames: number;
  affectedCaptionCount: number;
  /** Original audio instances removed or changed, including the direct removals above. */
  affectedAudioClipCount: number;
  workflowSourceCount: number;
  narrationRecording: boolean;
  used: boolean;
}

function selectedAssets(project: Project, ids: readonly string[]): Set<string> {
  if (!Array.isArray(ids) || ids.length > 1000) throw new Error("请选择最多 1000 个要删除的素材");
  const selected = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id))
      throw new Error("删除素材 ID 无效");
    if (!project.assets.some((asset) => asset.id === id))
      throw new Error("所选素材已不在当前工程，请刷新后重试");
    selected.add(id);
  }
  return selected;
}

function removal(project: Project, ids: readonly string[]) {
  const before = validateProject(project);
  const selected = selectedAssets(before, ids);
  let next = validateProject(before);
  const narrationRecording = !!(
    before.narration?.recordingAssetId && selected.has(before.narration.recordingAssetId)
  );
  if (selected.size) {
    // Match replacing a narration recording: its owned ASR subtitles cannot
    // outlive the source. Other captions follow the ordinary timeline ripple.
    if (narrationRecording)
      next.captions = next.captions.filter(
        (caption) => !caption.id.startsWith("recorded-narration-"),
      );
    const operations: EditOperation[] = [
      ...(next.audioClips ?? [])
        .filter((clip) => selected.has(clip.assetId))
        .map((clip): EditOperation => ({ type: "audio-remove", clipId: clip.id })),
      ...next.clips
        .filter((clip) => selected.has(clip.assetId))
        .reverse()
        .map((clip): EditOperation => ({ type: "remove", clipId: clip.id })),
    ];
    // The public edit protocol bounds patches to 1000 operations, while a valid
    // project can contain 2000 clips. Internal chunks remain one undoable edit.
    for (let offset = 0; offset < operations.length; offset += 1000) {
      next = applyOperations(next, operations.slice(offset, offset + 1000), before.revision);
      next.revision = before.revision;
    }
    next.assets = next.assets.filter((asset) => !selected.has(asset.id));
    if (next.roughCuts) next.roughCuts = next.roughCuts.filter((cut) => !selected.has(cut.assetId));
    if (next.workflow)
      next.workflow.sources = next.workflow.sources.filter(
        (source) => !selected.has(source.assetId),
      );
    if (narrationRecording)
      next.narration = {
        phase: next.clips.length ? "review" : "draft",
        captionBasis: "draft",
        draftCaptionIds: [...before.narration!.draftCaptionIds],
      };
    next = reconcileNarrationEdit(before, next);
    if (next.narration && !next.clips.length)
      next.narration = {
        phase: "draft",
        captionBasis: "draft",
        draftCaptionIds: [...next.narration.draftCaptionIds],
        ...(next.narration.recordingAssetId
          ? { recordingAssetId: next.narration.recordingAssetId }
          : {}),
      };
    next.revision = before.revision + 1;
    next = validateProject(next);
  }
  const clips = before.clips.filter((clip) => selected.has(clip.assetId));
  const remainingCaptions = new Map(next.captions.map((caption) => [caption.id, caption]));
  const remainingAudio = new Map((next.audioClips ?? []).map((clip) => [clip.id, clip]));
  const usage: AssetRemovalUsage = {
    assetIds: before.assets.filter((asset) => selected.has(asset.id)).map((asset) => asset.id),
    assetCount: selected.size,
    clipCount: clips.length,
    audioClipCount: (before.audioClips ?? []).filter((clip) => selected.has(clip.assetId)).length,
    roughCutCount: (before.roughCuts ?? []).filter((cut) => selected.has(cut.assetId)).length,
    removedFrames: clips.reduce((sum, clip) => sum + clip.outFrame - clip.inFrame, 0),
    affectedCaptionCount: before.captions.filter(
      (caption) => JSON.stringify(caption) !== JSON.stringify(remainingCaptions.get(caption.id)),
    ).length,
    affectedAudioClipCount: (before.audioClips ?? []).filter(
      (clip) => JSON.stringify(clip) !== JSON.stringify(remainingAudio.get(clip.id)),
    ).length,
    workflowSourceCount: (before.workflow?.sources ?? []).filter((source) =>
      selected.has(source.assetId),
    ).length,
    narrationRecording,
    used: false,
  };
  usage.used = !!(
    usage.clipCount ||
    usage.audioClipCount ||
    usage.roughCutCount ||
    usage.workflowSourceCount ||
    usage.narrationRecording
  );
  return { project: next, usage };
}

/** Remove project references only; no filesystem, resource or original-file deletion. */
export function removeAssets(project: Project, ids: readonly string[]): Project {
  return removal(project, ids).project;
}

/** Compute the actual timeline impact before the user confirms a library deletion. */
export function assetRemovalUsage(project: Project, ids: readonly string[]): AssetRemovalUsage {
  return removal(project, ids).usage;
}
