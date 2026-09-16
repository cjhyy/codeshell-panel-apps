import { isResourceId } from "../external-media";
import { createTrack, defaultColorAdjustment, defaultTransform } from "./defaults";
import { applyEditorOperations, type EditorOperation } from "./operations";
import { validateEditorDocument } from "./validation";
import type { EditorDocument, MediaClip } from "./types";

export const SEPARATION_MODEL_ID = "uvr-mdx-kara-2-v1";
export const SEPARATION_MODEL_SHA =
  "bf32e15105a09c0f7dddd2b67346146334d6f3ecb399ed7638eba2ab07cbf5f4";
export const SEPARATION_MAX_SECONDS = 2 * 60 * 60;
export interface SeparationCapability {
  state: "not-installed" | "needs-setup" | "ready" | "unavailable" | "installing";
  modelId: string;
  message: string;
  canInstall: boolean;
}
export interface SeparationStem {
  assetId: string;
  sha256: string;
  bytes: number;
  mimeType: "audio/wav";
}
export interface SeparationResult {
  sourceResourceId: string;
  sourceSha256: string;
  modelId: string;
  modelSha256: string;
  sampleRate: number;
  sampleCount: number;
  durationSeconds: number;
  stems: { vocals: SeparationStem; instrumental: SeparationStem };
}
export function validateSeparationResult(value: unknown): SeparationResult {
  const plain = (object: unknown, keys: string[]) =>
    !!object &&
    typeof object === "object" &&
    !Array.isArray(object) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(object)) &&
    Reflect.ownKeys(object).every((key) => typeof key === "string" && keys.includes(key));
  if (
    !plain(value, [
      "sourceResourceId",
      "sourceSha256",
      "modelId",
      "modelSha256",
      "sampleRate",
      "sampleCount",
      "durationSeconds",
      "stems",
    ])
  )
    throw new Error("分离结果格式无效");
  const data = value as SeparationResult;
  const hash = (x: unknown) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
  if (
    !data ||
    typeof data !== "object" ||
    !isResourceId(data.sourceResourceId) ||
    !hash(data.sourceSha256) ||
    data.modelSha256 !== SEPARATION_MODEL_SHA ||
    data.modelId !== SEPARATION_MODEL_ID ||
    data.sampleRate !== 44100 ||
    !Number.isSafeInteger(data.sampleCount) ||
    data.sampleCount < 1 ||
    data.sampleCount > SEPARATION_MAX_SECONDS * 44100 ||
    data.durationSeconds !== data.sampleCount / data.sampleRate ||
    !plain(data.stems, ["vocals", "instrumental"]) ||
    (data.sourceResourceId.startsWith("asset-") &&
      data.sourceResourceId !== `asset-${data.sourceSha256}`)
  )
    throw new Error("人声分离任务返回了无效的采样或来源信息");
  for (const key of ["vocals", "instrumental"] as const) {
    const stem = data.stems[key];
    if (
      !plain(stem, ["assetId", "sha256", "bytes", "mimeType"]) ||
      !isResourceId(stem.assetId) ||
      !hash(stem.sha256) ||
      stem.assetId !== `asset-${stem.sha256}` ||
      stem.mimeType !== "audio/wav" ||
      !Number.isSafeInteger(stem.bytes) ||
      stem.bytes < 44 ||
      stem.bytes > 4 * 1024 ** 3
    )
      throw new Error("人声分离任务没有返回完整的两条音轨");
  }
  return structuredClone(data);
}
export function separationSource(value: EditorDocument, sequenceId: string, clipId: string) {
  const document = validateEditorDocument(value),
    sequence = document.sequences.find((s) => s.id === sequenceId),
    clip = sequence?.clips.find((c) => c.id === clipId);
  if (!sequence || !clip || clip.kind !== "media")
    throw new Error("请选中一段原始视频或音频；复合片段请先进入其序列");
  const track = sequence.tracks.find((t) => t.id === clip.trackId)!;
  if (track.locked) throw new Error("请先解锁所选片段的轨道");
  const asset = document.assets.find((a) => a.id === clip.assetId)!;
  if (!["audio", "video"].includes(asset.kind) || !isResourceId(asset.resourceId ?? asset.id))
    throw new Error("请先保存或重新连接这段音频的原始素材");
  if (asset.duration <= 0 || asset.duration > SEPARATION_MAX_SECONDS * 240000)
    throw new Error("人声分离支持不超过 2 小时的原始素材，请先拆分较长素材");
  if (sequence.transitions.some((t) => t.fromClipId === clip.id || t.toClipId === clip.id))
    throw new Error("请先移除所选片段的转场，再分离音频，以免改变转场混音");
  return { document, sequence, clip, asset, resourceId: asset.resourceId ?? asset.id };
}
/** Adds immutable stems, preserves the original picture/media, and mutes only its old audio. */
export function planApplySeparation(
  value: EditorDocument,
  sequenceId: string,
  clipId: string,
  raw: SeparationResult,
  mode: "vocals" | "instrumental" | "both",
  idFactory: () => string = () => crypto.randomUUID(),
): EditorOperation[] {
  const { document, sequence, clip, asset, resourceId } = separationSource(
      value,
      sequenceId,
      clipId,
    ),
    result = validateSeparationResult(raw),
    operations: EditorOperation[] = [];
  if (!["vocals", "instrumental", "both"].includes(mode)) throw new Error("请选择要加入的音轨");
  if (result.sourceResourceId !== resourceId) throw new Error("这份分离结果不属于当前素材");
  const duration = Math.round((result.sampleCount * 240000) / result.sampleRate);
  if (Math.abs(duration - asset.duration) > Math.ceil(240000 / result.sampleRate))
    throw new Error("分离结果长度与原素材不一致，请重新处理");
  const selected = mode === "both" ? (["vocals", "instrumental"] as const) : [mode];
  const link = clip.linkGroupId ?? idFactory();
  const originalTrack = sequence.tracks.find((t) => t.id === clip.trackId)!;
  const addedTracks: string[] = [];
  for (const role of selected) {
    const stem = result.stems[role],
      name = role === "vocals" ? "人声" : "伴奏";
    let editorAsset = document.assets.find(
      (a) => a.resourceId === stem.assetId || a.id === stem.assetId,
    );
    if (editorAsset && (editorAsset.kind !== "audio" || editorAsset.duration !== duration))
      throw new Error("已有分离素材的信息不匹配，请重新处理");
    if (!editorAsset) {
      editorAsset = {
        id: idFactory(),
        name: `${asset.name} · ${name}`,
        kind: "audio",
        duration,
        resourceId: stem.assetId,
        fingerprint: stem.sha256,
        metadata: {
          mimeType: "audio/wav",
          size: stem.bytes,
          separation: {
            sourceAssetId: asset.id,
            sourceSha256: result.sourceSha256,
            modelId: result.modelId,
            modelSha256: result.modelSha256,
            role,
          },
        },
      };
      operations.push({ type: "asset.add", asset: editorAsset });
    }
    const track = createTrack(idFactory(), "audio", name);
    // Track gain/pan and mute belong to the effective original sound, not to its picture.
    track.volume = originalTrack.volume;
    track.pan = originalTrack.pan;
    track.muted = originalTrack.muted;
    addedTracks.push(track.id);
    operations.push({ type: "track.add", sequenceId, track });
    const added: MediaClip = {
      ...structuredClone(clip),
      id: idFactory(),
      trackId: track.id,
      assetId: editorAsset.id,
      label: `${clip.label} · ${name}`,
      linkGroupId: link,
      transform: defaultTransform(),
      color: defaultColorAdjustment(),
      blendMode: "normal",
    };
    delete added.mask;
    operations.push({ type: "clip.add", sequenceId, clip: added });
  }
  operations.push({
    type: "clip.update",
    sequenceId,
    clipId,
    patch: { audio: { ...clip.audio, volume: 0 }, linkGroupId: link },
  });
  // Existing music beds that listen to this voice track must keep hearing its new
  // stems. Leave the old track reference for its other untouched clips as well.
  for (const dependent of sequence.clips) {
    if (dependent.id === clipId || !("audio" in dependent)) continue;
    const ducking = dependent.audio.ducking;
    if (!ducking?.sidechainTrackIds.includes(clip.trackId)) continue;
    operations.push({
      type: "clip.update",
      sequenceId,
      clipId: dependent.id,
      patch: {
        audio: {
          ...structuredClone(dependent.audio),
          ducking: {
            ...structuredClone(ducking),
            sidechainTrackIds: [...ducking.sidechainTrackIds, ...addedTracks],
          },
        },
      },
    });
  }
  applyEditorOperations(document, operations, document.revision);
  return operations;
}
