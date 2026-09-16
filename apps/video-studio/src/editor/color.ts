import type { ColorAdjustment } from "./types";

export interface ResolvedColorAdjustment {
  exposure: number;
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  hue: number;
  curves: ColorAdjustment["curves"];
  hsl: ColorAdjustment["hsl"];
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const wrap = (degrees: number) => ((degrees % 360) + 360) % 360;

/** Piecewise linear tone curves in normalized sRGB channel values. */
export function evaluateColorCurve(
  points: readonly { x: number; y: number }[],
  input: number,
): number {
  const value = clamp(input);
  if (!points.length) return value;
  if (value <= points[0]!.x) return points[0]!.y;
  if (value >= points.at(-1)!.x) return points.at(-1)!.y;
  let left = 0,
    right = points.length - 1;
  while (left + 1 < right) {
    const middle = (left + right) >> 1;
    if (points[middle]!.x <= value) left = middle;
    else right = middle;
  }
  const a = points[left]!,
    b = points[right]!;
  return a.y + ((value - a.x) / (b.x - a.x)) * (b.y - a.y);
}

export function hasColorAdjustment(color: ResolvedColorAdjustment): boolean {
  return (
    color.exposure !== 0 ||
    color.brightness !== 0 ||
    color.contrast !== 1 ||
    color.saturation !== 1 ||
    color.temperature !== 0 ||
    color.tint !== 0 ||
    color.hue !== 0 ||
    color.curves.some((curve) => curve.points.some((point) => point.x !== point.y)) ||
    color.hsl.some((band) => band.hueShift !== 0 || band.saturation !== 0 || band.lightness !== 0)
  );
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const lightness = (max + min) / 2,
    delta = max - min;
  if (delta === 0) return [0, 0, lightness];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const hue = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [wrap(hue * 60), saturation, lightness];
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const h = wrap(hue) / 60;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = lightness - c / 2;
  const rgb =
    h < 1
      ? [c, x, 0]
      : h < 2
        ? [x, c, 0]
        : h < 3
          ? [0, c, x]
          : h < 4
            ? [0, x, c]
            : h < 5
              ? [x, 0, c]
              : [c, 0, x];
  return [rgb[0]! + m, rgb[1]! + m, rgb[2]! + m];
}

/**
 * The same SDR sRGB operation runs in preview and offline composition.
 * Exposure is stops; white balance is normalized warmth/tint, not Kelvin.
 * Pixels use straight alpha and alpha is never changed by grading.
 */
export function applyColorToRgba(pixels: Uint8ClampedArray, color: ResolvedColorAdjustment): void {
  if (pixels.length % 4) throw new Error("颜色缓冲必须包含完整 RGBA 像素");
  if (!hasColorAdjustment(color)) return;
  const exposure = 2 ** color.exposure;
  const redGain = exposure * (1 + color.temperature * 0.25 + color.tint * 0.1);
  const greenGain = exposure * (1 - color.tint * 0.2);
  const blueGain = exposure * (1 - color.temperature * 0.25 + color.tint * 0.1);
  const curves = new Map(color.curves.map((curve) => [curve.channel, curve.points]));
  const tone = (input: number, channel: "red" | "green" | "blue") => {
    const master = curves.get("rgb");
    const specific = curves.get(channel);
    const value = master ? evaluateColorCurve(master, input) : input;
    return specific ? evaluateColorCurve(specific, value) : value;
  };
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) continue;
    let r = clamp(
      ((pixels[index]! / 255) * redGain - 0.5) * color.contrast + 0.5 + color.brightness,
    );
    let g = clamp(
      ((pixels[index + 1]! / 255) * greenGain - 0.5) * color.contrast + 0.5 + color.brightness,
    );
    let b = clamp(
      ((pixels[index + 2]! / 255) * blueGain - 0.5) * color.contrast + 0.5 + color.brightness,
    );
    if (color.hue !== 0 || color.saturation !== 1 || color.hsl.length) {
      let [h, s, l] = rgbToHsl(r, g, b);
      let hueDelta = color.hue,
        saturationDelta = 0,
        lightnessDelta = 0;
      if (s > 0)
        for (const band of color.hsl) {
          const distance = Math.min(wrap(h - band.hue), wrap(band.hue - h));
          const weight =
            distance >= band.width / 2
              ? 0
              : (1 + Math.cos((2 * Math.PI * distance) / band.width)) / 2;
          hueDelta += band.hueShift * weight;
          saturationDelta += band.saturation * weight;
          lightnessDelta += band.lightness * weight;
        }
      h += hueDelta;
      s = clamp(s * color.saturation + saturationDelta);
      l = clamp(l + lightnessDelta);
      [r, g, b] = hslToRgb(h, s, l);
    }
    pixels[index] = Math.round(clamp(tone(r, "red")) * 255);
    pixels[index + 1] = Math.round(clamp(tone(g, "green")) * 255);
    pixels[index + 2] = Math.round(clamp(tone(b, "blue")) * 255);
  }
}
