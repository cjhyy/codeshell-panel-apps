import { compileAudioPlan } from "./audio-plan";
import { prepareEvaluator, type EvaluatedLayer } from "./evaluate";
import { sequenceDuration } from "./validation";
import type { EditorAsset, EditorDocument } from "./types";

/** Fixed installed example audio; ordinary resources always take precedence. */
export function isEditorDemoNarration(asset: EditorAsset): boolean {
  return asset.id === "demo-narration-v1" && asset.name === "示例旁白 · 从想法，到成片。" &&
    asset.kind === "audio" && asset.duration === 24 * 240000 &&
    asset.metadata?.mimeType === "audio/mpeg" && !asset.resourceId;
}

/** A collision-free, deterministic content description; native callers may hash these bytes. */
function contentKey(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
      : item,
  );
}
const sourceOrder = (a: EditorAsset, b: EditorAsset) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Geometry and display names do not change the bytes read by a decoder or audio renderer. */
export function editorSourceContentKey(asset: EditorAsset): string {
  return contentKey([asset.id, asset.kind, asset.resourceId ?? asset.id, asset.fingerprint ?? "", asset.duration,
    isEditorDemoNarration(asset) ? "installed-demo-narration-v1" : "resource"]);
}

/** Include source bindings as well as the plan: replacing bytes under the same asset ID matters. */
export function editorAudioContentKey(document: EditorDocument, sequenceId: string): string {
  const plan = compileAudioPlan(document, sequenceId),
    ids = new Set(plan.lanes.map((lane) => lane.assetId));
  const sources = document.assets.filter((asset) => ids.has(asset.id))
    .sort(sourceOrder).map(editorSourceContentKey);
  return contentKey({ version: 1, plan, sources });
}

function referencedSourceKey(document: EditorDocument, sequenceId: string, videoOnly: boolean): string {
  const sequences = new Map(document.sequences.map((sequence) => [sequence.id, sequence])),
    visited = new Set<string>(), ids = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    const sequence = sequences.get(id);
    if (!sequence) throw new Error(`Unknown preview sequence: ${id}`);
    visited.add(id);
    for (const clip of sequence.clips) {
      if (clip.kind === "sequence") visit(clip.sequenceId);
      else if (clip.kind === "media") ids.add(clip.assetId);
      else if (clip.kind === "multicam") clip.angles.forEach((angle) => ids.add(angle.assetId));
    }
  };
  visit(sequenceId);
  const sources = document.assets.filter((asset) => ids.has(asset.id) &&
    (videoOnly ? asset.kind === "video" : asset.kind !== "audio"))
    .sort(sourceOrder).map(editorSourceContentKey);
  return contentKey({ version: 1, sources });
}

/** All referenced video sources, including nested sequences and alternate multicam angles. */
export function editorVideoSourceKey(document: EditorDocument, sequenceId: string): string {
  return referencedSourceKey(document, sequenceId, true);
}

/** Only visible video endpoints block a play request. A bounded look ahead at
 * upcoming clip boundaries warms likely next sources without scanning the library. */
export function editorPreviewVideoPlan(
  document: EditorDocument,
  sequenceId: string,
  time: number,
): { current: EditorAsset[]; upcoming: EditorAsset[] } {
  const sequence = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence) throw new Error(`Unknown preview sequence: ${sequenceId}`);
  const evaluator = prepareEvaluator(document),
    assets = new Map(document.assets.map((asset) => [asset.id, asset]));
  const at = (tick: number) => {
    const ids = new Set<string>();
    const visit = (layer: EvaluatedLayer) => {
      if (layer.kind === "group") layer.layers.forEach(visit);
      else if (layer.kind === "transition") {
        if (layer.from) visit(layer.from);
        if (layer.to) visit(layer.to);
      } else if (layer.kind === "media" && layer.assetKind === "video") ids.add(layer.assetId);
    };
    evaluator.evaluate(sequenceId, tick).layers.forEach(visit);
    return [...ids].map((id) => assets.get(id)!);
  };
  const duration = sequenceDuration(sequence),
    currentTime = time >= duration ? 0 : time,
    current = duration ? at(currentTime) : [],
    seen = new Set(current.map((asset) => asset.id)),
    upcoming: EditorAsset[] = [];
  const boundaries = [...new Set(sequence.clips.map((clip) => clip.start))]
    .filter((tick) => tick > currentTime && tick < duration).sort((a, b) => a - b).slice(0, 256);
  for (const tick of boundaries) {
    for (const asset of at(tick)) {
      if (seen.has(asset.id)) continue;
      seen.add(asset.id);
      upcoming.push(asset);
      if (upcoming.length === 2) return { current, upcoming };
    }
  }
  return { current, upcoming };
}

/** The media pool also owns images and demo surfaces, so its reuse check includes those sources. */
export function editorVisualSourceKey(document: EditorDocument, sequenceId: string): string {
  return referencedSourceKey(document, sequenceId, false);
}
