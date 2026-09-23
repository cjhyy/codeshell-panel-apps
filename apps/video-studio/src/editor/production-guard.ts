import type { EditorOperation } from "./operations";
import type { EditorDocument, EditorClip, JsonData } from "./types";
import { sequenceDuration, validateEditorDocument } from "./validation";

const record = (value: JsonData | undefined): Record<string, JsonData> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
function dependencies(
  document: EditorDocument,
  known: EditorDocument | null = document,
): string {
  const seen = new Set<string>(),
    assets = new Set<string>();
  const clip = (item: EditorClip) => {
    const base = {
      id: item.id,
      kind: item.kind,
      trackId: item.trackId,
      start: item.start,
      duration: item.duration,
    };
    if (item.kind === "media") {
      assets.add(item.assetId);
      return { ...base, assetId: item.assetId, timeMap: item.timeMap, audio: item.audio };
    }
    if (item.kind === "sequence")
      return {
        ...base,
        nested: sequence(item.sequenceId),
        timeMap: item.timeMap,
        audio: item.audio,
      };
    if (item.kind === "multicam") {
      for (const angle of item.angles) assets.add(angle.assetId);
      return {
        ...base,
        angles: item.angles,
        switches: item.switches,
        audioAngleId: item.audioAngleId,
        timeMap: item.timeMap,
        audio: item.audio,
      };
    }
    if (item.kind === "text" && item.role === "subtitle")
      return {
        ...base,
        text: item.text,
        words: item.words,
        translation: item.translation,
        sourceBinding: item.sourceBinding,
      };
    return null; // Decorative titles/shapes do not change a recorded script; total sequence duration still matters.
  };
  const sequence = (id: string): unknown => {
    if (seen.has(id)) return { reference: id };
    seen.add(id);
    const value = document.sequences.find((item) => item.id === id)!;
    return {
      id,
      duration: sequenceDuration(value),
      frameRate: value.frameRate,
      tracks: value.tracks
        .filter((track) =>
          value.clips.some(
            (item) =>
              item.trackId === track.id &&
              (item.kind !== "text" || item.role === "subtitle") &&
              item.kind !== "shape",
          ),
        )
        .map((track) => ({
          id: track.id,
          kind: track.kind,
          muted: track.muted,
          hidden: track.hidden,
          volume: track.volume,
          pan: track.pan,
        })),
      clips: value.clips
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(clip)
        .filter(Boolean)
        .sort((a: any, b: any) => a.id.localeCompare(b.id)),
      transitions: value.transitions.slice().sort((a, b) => a.id.localeCompare(b.id)),
    };
  };
  const timeline = sequence(document.activeSequenceId);
  const active = document.sequences.find((item) => item.id === document.activeSequenceId)!;
  return JSON.stringify({
    script: document.production?.script ?? "",
    // The recorded narration was approved against this picture size and arrangement,
    // as the old view's approval snapshot also records.
    canvas: { width: active.width, height: active.height, timelineMode: active.timelineMode },
    timeline,
    assets: document.assets
      .filter((item) => assets.has(item.id))
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        duration: item.duration,
        resourceId: item.resourceId,
        // A newly computed fingerprint records an existing source; only a change to an
        // already known fingerprint establishes changed bytes. Proxies/analysis are preparation.
        fingerprint: known?.assets.find((asset) => asset.id === item.id)?.fingerprint
          ? item.fingerprint
          : undefined,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

/**
 * What a confirmed narration draft (and a recorded take's alignment) depends on, in a
 * deterministic order: the script, the canvas, every audible/visible clip's timing, subtitles
 * and the sources' identity. Source fingerprints are left out, so computing one later (a
 * preparation step) never changes a stored approval.
 */
export function narrationDependencies(document: EditorDocument): string {
  return dependencies(validateEditorDocument(document), null);
}

/** Shared by generic manual/AI editing. Dedicated user approval and verified alignment use their own coordinator.
 * This function only invalidates approval; it can never create approval or choose a recording. */
export function reconcileEditorProduction(
  beforeValue: EditorDocument,
  afterValue: EditorDocument,
): EditorOperation[] {
  const before = validateEditorDocument(beforeValue),
    after = validateEditorDocument(afterValue);
  const narration = record(before.production?.narration);
  if (
    !narration ||
    !["approved", "recorded", "aligned"].includes(String(narration.phase)) ||
    dependencies(before) === dependencies(after, before)
  )
    return [];
  const recordingId = narration.recordingAssetId;
  const review: Record<string, JsonData> = {
    phase: "review",
    captionBasis: "draft",
    draftCaptionIds: narration.draftCaptionIds ?? [],
  };
  if (
    typeof recordingId === "string" &&
    after.assets.some(
      (asset) => asset.id === recordingId && ["audio", "video"].includes(asset.kind),
    )
  )
    review.recordingAssetId = recordingId;
  const production = structuredClone(after.production ?? {});
  production.narrationPreviousApproval = {
    ...structuredClone(narration),
    documentId: before.id,
    revision: before.revision,
    reason: "文案、字幕、声音或时间安排已改变，需重新审阅",
  };
  production.narration = review;
  return [{ type: "project.production", data: production }];
}
