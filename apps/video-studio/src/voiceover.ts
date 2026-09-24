import {
  timelineDuration,
  timelineClips,
  validateProject,
  type Asset,
  type AudioClip,
  type Project,
} from "./model";
import type { AssetPublication } from "./production";

/** One saved revision includes both the durable source and its optional placement. */
export function publishProductionAssets(
  project: Project,
  assets: Asset[],
  options?: AssetPublication,
): { project: Project | null; notice?: string } {
  const next = structuredClone(project);
  for (const asset of assets) {
    const index = next.assets.findIndex((item) => item.id === asset.id);
    if (index >= 0) next.assets[index] = asset;
    else next.assets.push(asset);
  }
  let notice: string | undefined;
  const placement = options?.audioPlacement;
  // The job-specific result ID survives subsequent trims/moves. Replaying a
  // completion must not reset those edits or insert another audible instance.
  if (placement && !(next.audioClips ?? []).some((clip) => clip.id === placement.clipId)) {
    const asset = next.assets.find((asset) => asset.id === placement.assetId);
    if (!asset || asset.kind !== "audio") throw new Error("配音素材无效");
    const { startFrame, volume } = placement;
    if (!Number.isSafeInteger(startFrame) || startFrame < 0) throw new Error("配音位置无效");
    if (!Number.isFinite(volume) || volume < 0 || volume > 2) throw new Error("配音音量无效");
    const available = Math.max(0, timelineDuration(next) - startFrame);
    if (available > 0) {
      const clip: AudioClip = {
        id: placement.clipId,
        assetId: asset.id,
        inFrame: 0,
        outFrame: Math.min(asset.durationFrames, available),
        startFrame,
        volume,
      };
      next.audioClips = [...(next.audioClips ?? []), clip];
      if (available < asset.durationFrames)
        notice = `完整配音 ${(asset.durationFrames / 30).toFixed(1)} 秒已保留在素材库；画面只剩 ${(available / 30).toFixed(1)} 秒，当前音轨到画面结尾。请延长画面并调整配音出点，避免漏掉句尾。`;
      else notice = "配音已加入当前播放位置，完整文案和音频已保存";
    } else notice = "完整配音已保存到素材库。请先添加或延长画面，再将配音加入时间轴。";
  }
  const enhanced = options?.enhancement;
  if (
    enhanced &&
    !(next.audioClips ?? []).some((clip) => clip.id.startsWith(`enhanced-${enhanced.jobId}-`))
  ) {
    const result = next.assets.find(
      (asset) => asset.id === enhanced.assetId && asset.kind === "audio",
    );
    const source = next.assets.find((asset) => asset.mediaId === enhanced.sourceMediaId);
    if (!result || !source) throw new Error("原声优化的来源或结果无效");
    if (project.revision !== enhanced.baseRevision) {
      notice = "工程在处理期间已修改。优化后的完整音频已保存到素材库，请试听后自行替换。";
    } else {
      const instances = timelineClips(next).filter((clip) => clip.assetId === source.id);
      for (const [index, clip] of instances.entries()) {
        if (clip.outFrame > result.durationFrames) throw new Error("优化音频长度与原片不符");
        next.audioClips ??= [];
        next.audioClips.push({
          id: `enhanced-${enhanced.jobId}-v${index}`,
          assetId: result.id,
          inFrame: clip.inFrame,
          outFrame: clip.outFrame,
          startFrame: clip.startFrame,
          volume: clip.volume,
        });
        next.clips.find((item) => item.id === clip.id)!.volume = 0;
      }
      for (const [index, clip] of (next.audioClips ?? []).entries()) {
        if (clip.assetId !== source.id) continue;
        if (clip.outFrame > result.durationFrames) throw new Error("优化音频长度与原音轨不符");
        next.audioClips![index] = {
          ...clip,
          id: `enhanced-${enhanced.jobId}-a${index}`,
          assetId: result.id,
        };
      }
      notice = "已应用优化原声，保留画面、位置与音量；原始音频仍在素材库，可撤销恢复。";
    }
  }
  const normalized = validateProject(next);
  if (JSON.stringify(normalized) === JSON.stringify(validateProject(project)))
    return { project: null };
  normalized.revision++;
  return { project: validateProject(normalized), notice };
}
