import { timelineClips, validateProject, type Asset, type Project } from "../model";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTextStyle,
  defaultTransform,
} from "./defaults";
import { createExportPresets } from "./export-settings";
import { frameToTicks, TICKS_PER_SECOND } from "./time";
import type {
  EditorAsset,
  EditorDocument,
  EditorSequence,
  JsonData,
  MediaClip,
  TextClip,
} from "./types";
import { validateEditorDocument } from "./validation";
import {
  hasLegacyMultitrackFields,
  LEGACY_MAIN_VIDEO_TRACK,
  readLegacyMultitrackProject,
  type LegacyMultitrackProject,
} from "./legacy-multitrack-migration";

const LEGACY_RATE = { numerator: 30, denominator: 1 };
const ticks = (frame: number) => frameToTicks(frame, LEGACY_RATE);

function migrateAsset(asset: Asset): EditorAsset {
  const { id, name, kind, durationFrames, width, height, mediaId, ...metadata } = asset;
  return {
    id,
    name,
    kind,
    duration: ticks(durationFrames),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(mediaId !== undefined ? { resourceId: mediaId } : {}),
    ...(Object.keys(metadata).length
      ? { metadata: structuredClone(metadata) as { [key: string]: JsonData } }
      : {}),
  };
}

function migrateMedia(
  clip: {
    id: string;
    assetId: string;
    inFrame: number;
    outFrame: number;
    startFrame: number;
    volume: number;
  },
  trackId: string,
  label: string,
): MediaClip {
  const duration = ticks(clip.outFrame - clip.inFrame);
  return {
    kind: "media",
    id: clip.id,
    label,
    trackId,
    assetId: clip.assetId,
    start: ticks(clip.startFrame),
    duration,
    timeMap: {
      points: [
        { time: 0, source: ticks(clip.inFrame) },
        { time: duration, source: ticks(clip.outFrame) },
      ],
    },
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
    audio: { ...defaultAudioMix(), volume: clip.volume },
  };
}

function migrateCaptions(project: Project, trackId: string): TextClip[] {
  const preset = project.captionStyle ?? "classic";
  const fontSize = Math.round(Math.min(project.width * 0.035, project.height * 0.05));
  return project.captions.map((caption) => ({
    kind: "text",
    role: "subtitle",
    id: caption.id,
    trackId,
    label: caption.text.replace(/\s+/g, " ").trim().slice(0, 80) || "字幕",
    text: caption.text,
    start: ticks(caption.startFrame),
    duration: ticks(caption.endFrame - caption.startFrame),
    words: [],
    transform: { ...defaultTransform(), y: 0.4 },
    color: defaultColorAdjustment(),
    blendMode: "normal",
    style: {
      ...defaultTextStyle(),
      layout: "caption-stack",
      fontFamily: "system-ui",
      fontSize,
      fontWeight: preset === "bold" ? 800 : preset === "minimal" ? 500 : 600,
      color: preset === "bold" ? "#ffe46b" : "#ffffff",
      strokeColor: "#101010",
      strokeWidth: preset === "bold" ? Math.max(2, fontSize * 0.12) : 0,
      background: preset === "classic" ? "#050909b8" : "#00000000",
      backgroundRadius: 8,
      padding: fontSize * 0.5,
      align: "center",
      lineHeight: 1.4,
      maxWidth: 0.85,
      shadow:
        preset === "minimal"
          ? {
              color: "#000000bb",
              blur: Math.max(2, fontSize * 0.08),
              x: 0,
              y: Math.max(1, fontSize * 0.04),
            }
          : { color: "#00000000", blur: 0, x: 0, y: 0 },
    },
  }));
}

/** Deterministic one-way migration. The caller retains the original v1 snapshot for rollback. */
export function migrateLegacyProject(value: unknown): EditorDocument {
  let multitrack: LegacyMultitrackProject | undefined;
  let project: Project;
  if (hasLegacyMultitrackFields(value)) project = multitrack = readLegacyMultitrackProject(value);
  else {
    try {
      project = validateProject(value);
    } catch (originalError) {
      // 0.5.16 also permits an independent audio tail without materializing tracks.
      try {
        project = multitrack = readLegacyMultitrackProject(value);
      } catch {
        throw originalError;
      }
    }
  }
  const assets = project.assets.map(migrateAsset);
  const names = new Map(assets.map((asset) => [asset.id, asset.name]));
  const primaryTrack = createTrack("track-video-main", "video", "主画面");
  const primaryAudioTrack = createTrack("track-audio-main", "audio", "主序列声音");
  let textTrackId = "track-captions";
  while (multitrack?.tracks.some((track) => track.id === textTrackId)) textTrackId += "-text";
  const textTrack = createTrack(textTrackId, "text", "字幕");
  const hasPrimaryAudio = project.clips.some(
    (clip) => assets.find((asset) => asset.id === clip.assetId)?.kind === "audio",
  );
  const audioTracks = (project.audioClips ?? []).map((clip, index) =>
    createTrack(`track-audio-${index + 1}`, "audio", names.get(clip.assetId) ?? "音频"),
  );
  const sequence: EditorSequence = {
    id: "sequence-main",
    name: project.name,
    width: project.width,
    height: project.height,
    frameRate: LEGACY_RATE,
    background: "#000000",
    timelineMode: project.timelineMode ?? "magnetic",
    ...(multitrack ? { magneticTrackId: LEGACY_MAIN_VIDEO_TRACK } : {}),
    tracks: multitrack
      ? [
          ...multitrack.tracks.map((track) => ({
            ...createTrack(track.id, track.kind, track.name),
            ...track,
          })),
          textTrack,
        ]
      : [primaryTrack, ...(hasPrimaryAudio ? [primaryAudioTrack] : []), ...audioTracks, textTrack],
    clips: [
      ...(multitrack
        ? multitrack.clips.map((clip) => ({
            ...migrateMedia(clip, clip.trackId, names.get(clip.assetId) ?? "画面"),
            ...(clip.transform
              ? {
                  transform: {
                    ...defaultTransform(),
                    x: clip.transform.x,
                    y: clip.transform.y,
                    scaleX: clip.transform.scale,
                    scaleY: clip.transform.scale,
                    opacity: clip.transform.opacity,
                  },
                }
              : {}),
          }))
        : timelineClips(project).map((clip) =>
            migrateMedia(
              clip,
              assets.find((asset) => asset.id === clip.assetId)?.kind === "audio"
                ? primaryAudioTrack.id
                : primaryTrack.id,
              names.get(clip.assetId) ?? "画面",
            ),
          )),
      ...(project.audioClips ?? []).map((clip, index) =>
        migrateMedia(
          clip,
          multitrack?.audioClips[index]!.trackId ?? audioTracks[index]!.id,
          names.get(clip.assetId) ?? "音频",
        ),
      ),
      ...migrateCaptions(project, textTrack.id),
    ],
    transitions: [],
    markers: [],
  };
  // v1 allowed identical IDs across picture/audio/caption lists. Scope collisions deterministically.
  const used = new Set<string>();
  const remapped: JsonData[] = [];
  for (const clip of sequence.clips) {
    const original = clip.id;
    let suffix = 0;
    while (used.has(clip.id)) clip.id = `${original.slice(0, 100)}-migrated-${++suffix}`;
    if (clip.id !== original) remapped.push({ original, id: clip.id, trackId: clip.trackId });
    used.add(clip.id);
  }
  const production: { [key: string]: JsonData } = {};
  for (const key of ["script", "workflow", "narration", "roughCuts"] as const) {
    if (project[key] !== undefined) production[key] = structuredClone(project[key]) as JsonData;
  }
  production.migration = { from: 1, revision: project.revision, sourceTimebase: 30, remapped };
  if (multitrack)
    production.migration = {
      ...(production.migration as object),
      sourceFormat: "0.5.16",
      magneticTrackId: LEGACY_MAIN_VIDEO_TRACK,
    } as JsonData;
  return validateEditorDocument({
    schemaVersion: 2,
    timebase: TICKS_PER_SECOND,
    id: project.id,
    name: project.name,
    revision: project.revision,
    assets,
    sequences: [sequence],
    activeSequenceId: sequence.id,
    exportProfiles: createExportPresets(),
    production,
  });
}

export function readEditorDocument(value: unknown): EditorDocument {
  if (
    value &&
    typeof value === "object" &&
    (value as { schemaVersion?: unknown }).schemaVersion === 1
  )
    return migrateLegacyProject(value);
  return validateEditorDocument(value);
}
