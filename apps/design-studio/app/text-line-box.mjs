import { textLineHeightPixels } from "./text-line-height.mjs";

/** Imported finite offsets (including zero) retain the historical hanging origin. */
export const textHasLineBoxOrigin = (node) => !Number.isFinite(node.layoutBaselineOffset);

/**
 * CSS distributes leading around the font box, then places the alphabetic
 * baseline on its CSS-pixel grid. Font metrics, unlike actual glyph bounds,
 * stay invariant when the text changes (for example, adding a descender).
 * Canvas exposes rounded fontBoundingBox metrics; round SkFont metrics to the
 * same grid before distributing leading. Never round the authored node origin.
 */
export function textLineBoxAlphabeticOffset(node, { ascent, descent }) {
  if (!Number.isFinite(ascent) || !Number.isFinite(descent))
    throw new Error("Text line boxes require finite font ascent and descent");
  return Math.floor((textLineHeightPixels(node) + Math.round(ascent) - Math.round(descent)) / 2);
}

/** SVG uses the same alphabetic offset when actual font metrics are available.
 * The portable unmeasured fallback remains explicitly distinguishable so it
 * cannot be presented as verified font geometry by offline callers. */
export function textSvgLineBox(node, index = 0, metrics) {
  const top = node.y + index * textLineHeightPixels(node);
  if (!textHasLineBoxOrigin(node)) return { y: top, baseline: "hanging" };
  if (metrics) {
    const offset = Number.isFinite(metrics.alphabeticBaseline)
      ? metrics.alphabeticBaseline : textLineBoxAlphabeticOffset(node, metrics);
    return { y: top + offset, baseline: "alphabetic" };
  }
  return { y: top + textLineHeightPixels(node) / 2, baseline: "central", unmeasured: true };
}
