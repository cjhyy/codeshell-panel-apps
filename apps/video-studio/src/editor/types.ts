import type { AnimatedNumber } from "./animation";
import type { ExportProfile } from "./export-settings";
import type { FrameRate, Tick, TimeMap } from "./time";

export type JsonData = null | boolean | number | string | JsonData[] | { [key: string]: JsonData };

/** Resource identifiers are resolved by the authorized media adapter, never as file paths. */
export interface EditorAsset {
  id: string;
  name: string;
  kind: "video" | "audio" | "image" | "demo";
  duration: Tick;
  width?: number;
  height?: number;
  resourceId?: string;
  fingerprint?: string;
  metadata?: { [key: string]: JsonData };
}

export interface Transform {
  /** Position relative to the canvas center, in fractions of canvas width / height. */
  x: AnimatedNumber;
  y: AnimatedNumber;
  scaleX: AnimatedNumber;
  scaleY: AnimatedNumber;
  rotation: AnimatedNumber;
  opacity: AnimatedNumber;
  flipX: boolean;
  flipY: boolean;
  fit: "contain" | "cover" | "stretch";
  crop: { left: number; top: number; right: number; bottom: number };
}

export interface ColorAdjustment {
  exposure: AnimatedNumber;
  brightness: AnimatedNumber;
  contrast: AnimatedNumber;
  saturation: AnimatedNumber;
  temperature: AnimatedNumber;
  tint: AnimatedNumber;
  hue: AnimatedNumber;
  curves: Array<{
    channel: "rgb" | "red" | "green" | "blue";
    points: Array<{ x: number; y: number }>;
  }>;
  hsl: Array<{
    hue: number;
    width: number;
    hueShift: number;
    saturation: number;
    lightness: number;
  }>;
}

export interface Mask {
  kind: "rectangle" | "ellipse" | "linear" | "path";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  feather: number;
  inverted: boolean;
  /** Closed polygon in normalized source coordinates; the pen tool edits these vertices. */
  points?: Array<{ x: number; y: number }>;
}

export interface AudioMix {
  volume: AnimatedNumber;
  pan: AnimatedNumber;
  fadeIn: Tick;
  fadeOut: Tick;
  pitchSemitones: number;
  preservePitch: boolean;
  ducking?: {
    sidechainTrackIds: string[];
    thresholdDb: number;
    attenuationDb: number;
    attack: Tick;
    release: Tick;
  };
}

export interface VisualProperties {
  transform: Transform;
  color: ColorAdjustment;
  blendMode: "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten";
  mask?: Mask;
}

export interface ClipBase {
  id: string;
  trackId: string;
  start: Tick;
  duration: Tick;
  label: string;
  groupId?: string;
  linkGroupId?: string;
}

export interface MediaClip extends ClipBase, VisualProperties {
  kind: "media";
  assetId: string;
  timeMap: TimeMap;
  audio: AudioMix;
}

export interface TextStyle {
  layout: "box" | "caption-stack";
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  background: string;
  backgroundRadius: number;
  padding: number;
  align: "left" | "center" | "right";
  lineHeight: number;
  letterSpacing: number;
  maxWidth: number;
  highlightColor: string;
  /** Literal, case-sensitive phrases; all occurrences are colored. Later entries win overlaps. */
  keywords?: Array<{ text: string; color: string }>;
  shadow: { color: string; blur: number; x: number; y: number };
  animation: "none" | "fade" | "typewriter" | "word-highlight";
}

export interface TextClip extends ClipBase, VisualProperties {
  kind: "text";
  role: "title" | "subtitle";
  text: string;
  style: TextStyle;
  words: Array<{ text: string; start: Tick; end: Tick }>;
  sourceBinding?: {
    clipId: string;
    sourceStart: Tick;
    sourceEnd: Tick;
    /** Clip IDs below the root owner, followed through nested sequences; source coordinates are actual asset ticks. */
    provenance?: { path: string[]; assetId: string; start: Tick; end: Tick };
  };
  translation?: {
    original: string;
    language: string;
    mode: "bilingual" | "translated";
    originalWords?: Array<{ text: string; start: Tick; end: Tick }>;
  };
}

export interface ShapeClip extends ClipBase, VisualProperties {
  kind: "shape";
  shape: "rectangle" | "ellipse" | "line";
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface SequenceClip extends ClipBase, VisualProperties {
  kind: "sequence";
  sequenceId: string;
  timeMap: TimeMap;
  audio: AudioMix;
}

export interface MulticamClip extends ClipBase, VisualProperties {
  kind: "multicam";
  timeMap: TimeMap;
  angles: Array<{ id: string; name: string; assetId: string; offset: number }>;
  switches: Array<{ time: Tick; angleId: string }>;
  audioAngleId: string;
  audio: AudioMix;
}

export type EditorClip = MediaClip | TextClip | ShapeClip | SequenceClip | MulticamClip;

export interface EditorTrack {
  id: string;
  name: string;
  kind: "video" | "audio" | "text";
  locked: boolean;
  hidden: boolean;
  muted: boolean;
  volume: number;
  pan: number;
}

export interface Transition {
  id: string;
  fromClipId: string;
  toClipId: string;
  start: Tick;
  duration: Tick;
  kind: "dissolve" | "fade-black" | "wipe-left" | "wipe-right" | "push-left" | "push-right";
}

export interface TimelineMarker {
  id: string;
  time: Tick;
  duration: Tick;
  name: string;
  note: string;
  color: string;
}

export interface EditorSequence {
  id: string;
  name: string;
  width: number;
  height: number;
  frameRate: FrameRate;
  background: string;
  timelineMode: "magnetic" | "free";
  /** Optional migration scope: only this picture track follows magnetic editing. */
  magneticTrackId?: string;
  /** Bottom to top visual order. Audio tracks do not participate in picture ordering. */
  tracks: EditorTrack[];
  clips: EditorClip[];
  transitions: Transition[];
  markers: TimelineMarker[];
}

export interface EditorDocument {
  schemaVersion: 2;
  timebase: 240000;
  id: string;
  name: string;
  revision: number;
  assets: EditorAsset[];
  sequences: EditorSequence[];
  activeSequenceId: string;
  exportProfiles: ExportProfile[];
  /** Production workflow annotations contain no second editable timeline. */
  production?: { [key: string]: JsonData };
}
