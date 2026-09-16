import type { AudioMix, ColorAdjustment, EditorTrack, TextStyle, Transform } from "./types";

/** Fresh values keep editing one clip from changing another clip's defaults. */
export function defaultTransform(): Transform {
  return {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    flipX: false,
    flipY: false,
    fit: "contain",
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
  };
}

export function defaultColorAdjustment(): ColorAdjustment {
  return {
    exposure: 0,
    brightness: 0,
    contrast: 1,
    saturation: 1,
    temperature: 0,
    tint: 0,
    hue: 0,
    curves: [],
    hsl: [],
  };
}

export function defaultAudioMix(): AudioMix {
  return { volume: 1, pan: 0, fadeIn: 0, fadeOut: 0, pitchSemitones: 0, preservePitch: true };
}

export function defaultTextStyle(): TextStyle {
  return {
    layout: "box",
    fontFamily: "system-ui",
    fontSize: 48,
    fontWeight: 600,
    italic: false,
    color: "#ffffff",
    strokeColor: "#000000",
    strokeWidth: 0,
    background: "#00000000",
    backgroundRadius: 0,
    padding: 0,
    align: "center",
    lineHeight: 1.4,
    letterSpacing: 0,
    maxWidth: 0.85,
    highlightColor: "#ffe46b",
    shadow: { color: "#00000000", blur: 0, x: 0, y: 0 },
    animation: "none",
  };
}

export function createTrack(id: string, kind: EditorTrack["kind"], name?: string): EditorTrack {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id)) throw new Error("轨道 ID 无效");
  if (!["video", "audio", "text"].includes(kind)) throw new Error("轨道类型无效");
  const label = name ?? { video: "画面", audio: "声音", text: "文字" }[kind];
  if (
    typeof label !== "string" ||
    !label.trim() ||
    label.length > 200 ||
    /[\x00-\x1f\x7f]/.test(label)
  )
    throw new Error("轨道名称无效");
  return { id, kind, name: label, locked: false, hidden: false, muted: false, volume: 1, pan: 0 };
}
