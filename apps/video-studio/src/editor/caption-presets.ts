import type { CaptionStyle, Project } from "../model";
import { migrateLegacyProject } from "./migration";
import { applyEditorOperations, type EditorOperation } from "./operations";
import type { EditorDocument, EditorSequence, TextClip, TextStyle } from "./types";
import { validateEditorDocument } from "./validation";

/** The fixed subtitle looks shared by the caption panel and the old production projection. */
export type CaptionPreset = CaptionStyle;
export const CAPTION_PRESETS: ReadonlyArray<{ value: CaptionPreset; label: string }> = [
  { value: "classic", label: "经典 · 黑底白字" },
  { value: "bold", label: "醒目 · 黄字描边" },
  { value: "minimal", label: "简洁 · 白字无框" },
];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function preset(value: unknown): CaptionPreset {
  if (!CAPTION_PRESETS.some((item) => item.value === value)) throw new Error("字幕样式无效");
  return value as CaptionPreset;
}
const templates = new Map<string, TextClip>();
/** A subtitle clip exactly as migration creates it for this canvas and preset. */
export function captionTemplate(project: Pick<Project, "width" | "height" | "captionStyle">): TextClip {
  const key = `${project.width}:${project.height}:${project.captionStyle ?? "classic"}`;
  const cached = templates.get(key);
  if (cached) return structuredClone(cached);
  const document = migrateLegacyProject({
    schemaVersion: 1,
    id: "legacy-caption-template",
    name: "字幕",
    revision: 0,
    fps: 30,
    width: project.width,
    height: project.height,
    captionStyle: project.captionStyle ?? "classic",
    assets: [{ id: "template-source", name: "字幕画布", kind: "demo", durationFrames: 1 }],
    clips: [
      { id: "template-picture", assetId: "template-source", inFrame: 0, outFrame: 1, volume: 1 },
    ],
    captions: [{ id: "template-text", text: "字幕", startFrame: 0, endFrame: 1 }],
  });
  const result = document.sequences[0]!.clips.find((clip) => clip.kind === "text") as TextClip;
  if (templates.size >= 24) templates.clear();
  templates.set(key, result);
  return structuredClone(result);
}
export function captionPresetStyle(
  sequence: Pick<EditorSequence, "width" | "height">,
  value: CaptionPreset,
): TextStyle {
  return captionTemplate({
    width: sequence.width,
    height: sequence.height,
    captionStyle: preset(value),
  }).style;
}
/** Preset look for one caption: per-caption animation and literal keyword emphasis stay its own. */
function presetFor(clip: TextClip, style: TextStyle): TextStyle {
  const next: TextStyle = { ...structuredClone(style), animation: clip.style.animation };
  if (clip.style.keywords) next.keywords = structuredClone(clip.style.keywords);
  return next;
}
/** The preset every subtitle currently shows, ignoring its own animation; undefined when mixed or custom. */
export function currentCaptionPreset(
  sequence: EditorSequence,
  clips: readonly TextClip[],
): CaptionPreset | undefined {
  if (!clips.length) return undefined;
  return CAPTION_PRESETS.map((item) => item.value).find((value) => {
    const style = captionPresetStyle(sequence, value);
    return clips.every((clip) => same(clip.style, presetFor(clip, style)));
  });
}
/** Restyle every subtitle of the sequence; text, words, translation and animation are retained. */
export function planCaptionPreset(
  value: EditorDocument,
  sequenceId: string,
  chosen: CaptionPreset,
): EditorOperation[] {
  const doc = validateEditorDocument(value),
    selected = preset(chosen),
    sequence = doc.sequences.find((item) => item.id === sequenceId);
  if (!sequence) throw new Error("字幕时间线不存在");
  const clips = sequence.clips.filter(
    (clip): clip is TextClip => clip.kind === "text" && clip.role === "subtitle",
  );
  if (clips.some((clip) => sequence.tracks.find((track) => track.id === clip.trackId)?.locked))
    throw new Error("字幕轨已锁定，请先解锁后再套用样式");
  const style = captionPresetStyle(sequence, selected);
  const operations: EditorOperation[] = clips
    .filter((clip) => !same(clip.style, presetFor(clip, style)))
    .map((clip) => ({
      type: "clip.update",
      sequenceId,
      clipId: clip.id,
      patch: { style: presetFor(clip, style) },
    }));
  // The old projection reads this preference whenever animated captions no longer match a template.
  if (doc.production?.legacyCaptionStyle !== selected)
    operations.push({
      type: "project.production",
      data: { ...structuredClone(doc.production ?? {}), legacyCaptionStyle: selected },
    });
  applyEditorOperations(doc, operations, doc.revision);
  return operations;
}
