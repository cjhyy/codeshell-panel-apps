import { textLineHeightPixels } from "./text-line-height.mjs";

/** Imported finite offsets (including zero) retain the historical hanging origin. */
export const textHasLineBoxOrigin = (node) => !Number.isFinite(node.layoutBaselineOffset);

/**
 * CSS distributes leading around the font box, then places the alphabetic
 * baseline on its CSS-pixel grid. Font metrics, unlike actual glyph bounds,
 * stay invariant when the text changes (for example, adding a descender).
 * Canvas exposes rounded fontBoundingBox metrics; round SkFont metrics to the
 * same grid before distributing leading. This is the logical baseline offset;
 * paint-origin snapping is separate and never rewrites authored coordinates.
 */
export function textLineBoxAlphabeticOffset(node, { ascent, descent }) {
  if (!Number.isFinite(ascent) || !Number.isFinite(descent))
    throw new Error("Text line boxes require finite font ascent and descent");
  return Math.floor((textLineHeightPixels(node) + Math.round(ascent) - Math.round(descent)) / 2);
}

/**
 * Blink's inline paint origin snaps in CSS space before DPR/CSS transforms.
 * The browser spike measures layout positions truncated to 1/64 CSS px and
 * line heights rounded to 1/64 before they accumulate across lines. Snapping
 * the unquantized sum fails, for example, at line six of 20.8px leading.
 * A local cached picture supplies its original world origin without putting
 * renderer metadata in the document. Imported finite offsets keep raw origins.
 */
export function textLineBoxBaselineY(node, index, alphabeticOffset, { originY = node.y } = {}) {
  const height = textLineHeightPixels(node);
  if (!textHasLineBoxOrigin(node)) return node.y + index * height + alphabeticOffset;
  const layoutTop = Math.trunc(originY * 64) / 64;
  const layoutHeight = Math.round(height * 64) / 64;
  return Math.round(layoutTop + index * layoutHeight + alphabeticOffset) + (node.y - originY);
}

/** Transport the historical hanging origin through the same CSS line box as
 * HTML. The logical hanging position stays exact; only the paint baseline is
 * quantized. Leading accumulates in LayoutUnits before CSS-pixel rounding. */
export function textFiniteBaselineY(node, index, metrics, { originY = node.y } = {}) {
  const alpha = Number.isFinite(metrics.alphabeticBaseline)
    ? metrics.alphabeticBaseline : textLineBoxAlphabeticOffset(node, metrics);
  if (!Number.isFinite(metrics.hangingToAlphabetic)) throw Error("Finite text requires a measured hanging baseline");
  const top = Math.trunc((originY + metrics.hangingToAlphabetic - alpha) * 64) / 64;
  const height = Math.round(textLineHeightPixels(node) * 64) / 64;
  return Math.round(top + index * height + alpha) + (node.y - originY);
}

/** SVG uses the same alphabetic offset when actual font metrics are available.
 * The portable unmeasured fallback remains explicitly distinguishable so it
 * cannot be presented as verified font geometry by offline callers. */
export function textSvgLineBox(node, index = 0, metrics) {
  const top = node.y + index * textLineHeightPixels(node);
  if (!textHasLineBoxOrigin(node)) return Number.isFinite(metrics?.hangingToAlphabetic)
    ? { y: textFiniteBaselineY(node, index, metrics), baseline: "alphabetic" }
    : { y: top, baseline: "hanging" };
  if (metrics) {
    const offset = Number.isFinite(metrics.alphabeticBaseline)
      ? metrics.alphabeticBaseline : textLineBoxAlphabeticOffset(node, metrics);
    return { y: textLineBoxBaselineY(node, index, offset), baseline: "alphabetic" };
  }
  return { y: top + textLineHeightPixels(node) / 2, baseline: "central", unmeasured: true };
}
