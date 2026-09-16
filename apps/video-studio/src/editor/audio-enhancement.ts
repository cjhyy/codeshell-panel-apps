import { isResourceId } from "../external-media";
import { createTrack, defaultColorAdjustment, defaultTransform } from "./defaults";
import { applyEditorOperations, type EditorOperation } from "./operations";
import { validateEditorDocument } from "./validation";
import type { EditorDocument, EditorAsset, MediaClip } from "./types";
export interface AudioEnhancementSettings {
  preset: "light" | "balanced";
  denoise: boolean;
  normalize: boolean;
}
export interface AudioEnhancementCapability {
  state: "ready" | "unavailable";
  message: string;
}
export interface AudioEnhancementResult {
  sourceResourceId: string;
  assetId: string;
  sha256: string;
  bytes: number;
  duration: number;
  sampleRate: number;
  sampleCount: number;
  settings: AudioEnhancementSettings;
}
function readSettings(raw: unknown, requireEffect: boolean): AudioEnhancementSettings {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) ||
    Reflect.ownKeys(raw).some(
      (key) => typeof key !== "string" || !["preset", "denoise", "normalize"].includes(String(key)),
    )
  )
    throw new Error("声音优化设置无效");
  const data = raw as AudioEnhancementSettings;
  if (
    !["light", "balanced"].includes(data.preset) ||
    typeof data.denoise !== "boolean" ||
    typeof data.normalize !== "boolean" ||
    (requireEffect && !data.denoise && !data.normalize)
  )
    throw new Error("请选择降噪或响度统一");
  return { preset: data.preset, denoise: data.denoise, normalize: data.normalize };
}
export function validateAudioEnhancementSettings(raw: unknown): AudioEnhancementSettings {
  return readSettings(raw, true);
}
/** Reads the actual native FFmpeg receipt; no legacy frame conversion. */
export function audioEnhancementReceipt(raw: unknown): AudioEnhancementResult {
  const value = raw as any,
    asset = value?.asset,
    inspection = value?.inspection,
    origin = value?.provenance;
  if (
    !asset ||
    !isResourceId(asset.id) ||
    !/^asset-[a-f0-9]{64}$/.test(asset.id) ||
    asset.sha256 !== asset.id.slice(6) ||
    !Number.isSafeInteger(asset.bytes) ||
    asset.bytes < 44 ||
    asset.bytes > 20 * 1024 ** 3 ||
    asset.mimeType !== "audio/wav" ||
    origin?.processor !== "ffmpeg-audio-enhance" ||
    origin.version !== 1 ||
    !isResourceId(origin.sourceAssetId) ||
    inspection?.kind !== "audio" ||
    inspection.audio?.sampleRate !== 48000 ||
    !Number.isInteger(inspection.audio?.channels) ||
    inspection.audio.channels < 1 ||
    inspection.audio.channels > 8 ||
    !Number.isFinite(inspection.durationSeconds) ||
    inspection.durationSeconds <= 0 ||
    inspection.durationSeconds > 86400
  )
    throw new Error("优化任务没有返回完整的音频与实际采样信息");
  const sampleCount = Math.round(inspection.durationSeconds * 48000);
  return validateAudioEnhancementResult({
    sourceResourceId: origin.sourceAssetId,
    assetId: asset.id,
    sha256: asset.sha256,
    bytes: asset.bytes,
    duration: sampleCount * 5,
    sampleRate: 48000,
    sampleCount,
    settings: readSettings(
      { preset: origin.preset, denoise: origin.denoise, normalize: origin.normalize },
      false,
    ),
  });
}
export function validateAudioEnhancementResult(value: unknown): AudioEnhancementResult {
  const data = value as AudioEnhancementResult;
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(data)) ||
    Reflect.ownKeys(data).some(
      (key) =>
        typeof key !== "string" ||
        ![
          "sourceResourceId",
          "assetId",
          "sha256",
          "bytes",
          "duration",
          "sampleRate",
          "sampleCount",
          "settings",
        ].includes(key),
    ) ||
    !isResourceId(data.sourceResourceId) ||
    !/^asset-[a-f0-9]{64}$/.test(data.assetId) ||
    data.sha256 !== data.assetId.slice(6) ||
    !Number.isSafeInteger(data.bytes) ||
    data.bytes < 44 ||
    data.bytes > 20 * 1024 ** 3 ||
    data.sampleRate !== 48000 ||
    !Number.isSafeInteger(data.sampleCount) ||
    data.sampleCount < 1 ||
    data.sampleCount > 86400 * 48000 ||
    data.duration !== data.sampleCount * 5
  )
    throw new Error("优化音频的来源或采样信息无效");
  return {
    sourceResourceId: data.sourceResourceId,
    assetId: data.assetId,
    sha256: data.sha256,
    bytes: data.bytes,
    duration: data.duration,
    sampleRate: data.sampleRate,
    sampleCount: data.sampleCount,
    settings: readSettings(data.settings, false),
  };
}
export function audioEnhancementSource(value: EditorDocument, sequenceId: string, clipId: string) {
  const document = validateEditorDocument(value),
    sequence = document.sequences.find((s) => s.id === sequenceId),
    clip = sequence?.clips.find((c) => c.id === clipId);
  if (!sequence || !clip || clip.kind !== "media")
    throw new Error("请选中当前序列的一段原始视频或音频；复合片段请先进入其序列");
  if (sequence.tracks.find((t) => t.id === clip.trackId)!.locked)
    throw new Error("请先解锁所选声音的轨道");
  const asset = document.assets.find((a) => a.id === clip.assetId)!;
  if (!["audio", "video"].includes(asset.kind) || !isResourceId(asset.resourceId ?? asset.id))
    throw new Error("请先保存或重新连接原始音频素材");
  if (sequence.transitions.some((t) => t.fromClipId === clipId || t.toClipId === clipId))
    throw new Error("请先移除所选片段的转场，再优化声音，以保留原混音");
  return { document, sequence, clip, asset, resourceId: asset.resourceId ?? asset.id };
}
export function enhancedEditorAsset(
  result: AudioEnhancementResult,
  name: string,
  id = result.assetId,
): EditorAsset {
  const value = validateAudioEnhancementResult(result);
  return {
    id,
    name,
    kind: "audio",
    duration: value.duration,
    resourceId: value.assetId,
    fingerprint: value.sha256,
    metadata: {
      mimeType: "audio/wav",
      size: value.bytes,
      audioEnhancement: { sourceResourceId: value.sourceResourceId, ...value.settings },
    },
  };
}
/** Scope is exactly the selected leaf clip. Existing source clips/subtitles and all other sequences stay authoritative. */
export function planApplyAudioEnhancement(
  value: EditorDocument,
  sequenceId: string,
  clipId: string,
  raw: AudioEnhancementResult,
  idFactory: () => string = () => crypto.randomUUID(),
): EditorOperation[] {
  const { document, sequence, clip, asset, resourceId } = audioEnhancementSource(
      value,
      sequenceId,
      clipId,
    ),
    result = validateAudioEnhancementResult(raw);
  if (resourceId !== result.sourceResourceId) throw new Error("这份优化结果不属于所选素材");
  if (clip.timeMap.points.some((p) => p.source > result.duration))
    throw new Error("优化音频没有覆盖所选片段的完整源区间，原片未修改");
  const operations: EditorOperation[] = [],
    existing = document.assets.find(
      (a) => a.resourceId === result.assetId || a.id === result.assetId,
    );
  if (existing && (existing.kind !== "audio" || existing.duration !== result.duration))
    throw new Error("已有优化素材的采样信息不一致");
  const enhanced = existing ?? enhancedEditorAsset(result, `${asset.name} · 优化声音`, idFactory());
  if (!existing) operations.push({ type: "asset.add", asset: enhanced });
  const originalTrack = sequence.tracks.find((t) => t.id === clip.trackId)!,
    track = createTrack(idFactory(), "audio", "优化声音"),
    link = clip.linkGroupId ?? idFactory();
  track.volume = originalTrack.volume;
  track.pan = originalTrack.pan;
  track.muted = originalTrack.muted;
  const derived: MediaClip = {
    ...structuredClone(clip),
    id: idFactory(),
    trackId: track.id,
    assetId: enhanced.id,
    label: `${clip.label} · 优化声音`,
    linkGroupId: link,
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
  };
  delete derived.mask;
  operations.push(
    { type: "track.add", sequenceId, track },
    { type: "clip.add", sequenceId, clip: derived },
    {
      type: "clip.update",
      sequenceId,
      clipId,
      patch: { audio: { ...clip.audio, volume: 0 }, linkGroupId: link },
    },
  );
  for (const dependent of sequence.clips) {
    if (
      dependent.id === clipId ||
      !("audio" in dependent) ||
      !dependent.audio.ducking?.sidechainTrackIds.includes(clip.trackId)
    )
      continue;
    operations.push({
      type: "clip.update",
      sequenceId,
      clipId: dependent.id,
      patch: {
        audio: {
          ...structuredClone(dependent.audio),
          ducking: {
            ...structuredClone(dependent.audio.ducking),
            sidechainTrackIds: [...dependent.audio.ducking.sidechainTrackIds, track.id],
          },
        },
      },
    });
  }
  applyEditorOperations(document, operations, document.revision);
  return operations;
}
