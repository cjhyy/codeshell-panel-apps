import { textLineHeightPixels } from "./text-line-height.mjs";
import { textRangeTypography } from "./text-ranges.mjs";

/** Imported finite offsets (including zero) retain the historical hanging origin. */
export const textHasLineBoxOrigin = (node) => !Number.isFinite(node.layoutBaselineOffset);

const LAYOUT_CONTAINERS = new Set(["frame", "group", "component"]);
const parentLayout = parent => LAYOUT_CONTAINERS.has(parent?.type) && ["horizontal", "vertical", "grid"].includes(parent.layout) ? parent.layout : null;

/**
 * Whether HTML export carries finite (imported) text at its historical hanging
 * origin (frontend-export finiteTextPaintOffset; the font-loaded check stays
 * there, at runtime). Everything else with a finite offset is laid out by HTML
 * as a plain CSS line box: provenanced coordinates, rotation, typography
 * ranges, non-start vertical constraints and grid parents. `infiniteRoot`: an
 * exported root on the infinite workspace is pinned to start constraints.
 */
export function textHtmlFiniteHangingTransport(node, { parent = null, infiniteRoot = false } = {}) {
  if (node?.type !== "text" || textHasLineBoxOrigin(node) || node.layoutBaselineSource || Number(node.rotation) ||
      textRangeTypography(node, false).length) return false;
  if (!infiniteRoot && ((node.constraintVertical && node.constraintVertical !== "start") ||
      node.constraintTop !== undefined || node.constraintBottom !== undefined)) return false;
  return parentLayout(parent) !== "grid";
}

/**
 * The CSS line box HTML gives finite text it does not transport: its element
 * top is y minus the returned shift (the baseline offset for provenanced or
 * flow-owned boxes, else 0). null: the renderers keep the hanging transport or
 * there is no finite origin. Decided on the scene node (renderers may pass a
 * local copy).
 *
 * Provenanced text (layoutBaselineSource html/native, also with typography
 * ranges) keeps the transport: the import accepted that provenance only when
 * the browser-measured line-box offset reproduced y exactly, so y + the hanging
 * offset (plus the receipt's measured line offsets) is the DOM baseline.
 * Recomputing the line box from Canvas font metrics is 1 px off where those
 * metrics differ from Blink's line box (Times New Roman 12px); the measured
 * offset is exact (native line box and mixed-typography SVG pixel oracles).
 */
export function textHtmlFiniteLineBoxShift(node, context = {}) {
  if (node?.type !== "text" || textHasLineBoxOrigin(node) || textHtmlFiniteHangingTransport(node, context)) return null;
  if (["html", "native"].includes(node.layoutBaselineSource)) return null;
  const flowOwned = parentLayout(context.parent) !== null && node.layoutPositioning !== "absolute";
  return flowOwned || ["html", "native"].includes(node.layoutBaselineSource) ? Number(node.layoutBaselineOffset) || 0 : 0;
}
/** The parent/infinite-root context of a node in a flattened node list (array or id Map). */
export function textHtmlFiniteContextIn(nodes, node, canvasMode) {
  const parentId = node?.parentId;
  const parent = parentId === undefined ? null
    : (typeof nodes?.get === "function" ? nodes.get(parentId) : nodes?.find?.(candidate => candidate.id === parentId)) ?? null;
  return { parent, infiniteRoot: parentId === undefined && canvasMode === "infinite" };
}
/** Render-only line-box view of `node` (the document node is never rewritten); `scene` decides. */
export function textHtmlFiniteLineBoxNode(node, context = {}, scene = node) {
  const shift = textHtmlFiniteLineBoxShift(scene, context);
  return shift === null ? node : { ...node, y: node.y - shift, layoutBaselineOffset: undefined, layoutBaselineSource: undefined };
}

/**
 * CSS distributes leading around the font box, then places the alphabetic
 * baseline on its CSS-pixel grid. Font metrics, unlike actual glyph bounds,
 * stay invariant when the text changes (for example, adding a descender).
 * Canvas exposes rounded fontBoundingBox metrics; round SkFont metrics to the
 * same grid before distributing leading. This is the logical baseline offset;
 * paint-origin snapping is separate and never rewrites authored coordinates.
 */
export function textLineBoxAlphabeticOffset(node, { ascent, descent }, layoutScale = 1) {
  if (!Number.isFinite(ascent) || !Number.isFinite(descent))
    throw new Error("Text line boxes require finite font ascent and descent");
  // With a real device scale, Blink lays text out at fontSize × scale: the
  // metrics must be measured at that size and the leading floors in physical
  // pixels (Arial 600 14/1.4 at DPR 2: ascent 25, not 2×13). Scale 1 is the
  // historical CSS-pixel formula, unchanged.
  return Math.floor((textLineHeightPixels(node) * layoutScale + Math.round(ascent) - Math.round(descent)) / 2) / layoutScale;
}

/**
 * Blink's inline paint origin snaps in CSS space before DPR/CSS transforms.
 * The browser spike measures layout positions truncated to 1/64 CSS px and
 * line heights rounded to 1/64 before they accumulate across lines. Snapping
 * the unquantized sum fails, for example, at line six of 20.8px leading.
 * A local cached picture supplies its original world origin without putting
 * renderer metadata in the document. Imported finite offsets keep raw origins.
 */
export function textLineBoxBaselineY(node, index, alphabeticOffset, { originY = node.y, layoutScale = 1 } = {}) {
  const height = textLineHeightPixels(node);
  if (!textHasLineBoxOrigin(node)) return node.y + index * height + alphabeticOffset;
  // `layoutScale` is the document's layout zoom (blinkLayoutScale): 1 under
  // DevTools-emulated DSF, the device scale under a real one. LayoutUnits and
  // the paint-origin rounding then live on that physical grid, before any CSS
  // transform. Scale 1 is the historical CSS-pixel replay, unchanged.
  const layoutTop = Math.trunc(originY * 64 * layoutScale) / 64;
  const layoutHeight = Math.round(height * layoutScale * 64) / 64;
  return Math.round(layoutTop + index * layoutHeight + alphabeticOffset * layoutScale) / layoutScale + (node.y - originY);
}

/**
 * Same paint-origin rounding as textLineBoxBaselineY for a line whose top is
 * `lineOffset` below the node (mixed-size range lines, where earlier lines may
 * be taller than one line height).
 */
export function textLineBoxBaselineAt(node, lineOffset, alphabeticOffset, { originY = node.y, layoutScale = 1 } = {}) {
  const layoutTop = Math.trunc(originY * 64 * layoutScale) / 64;
  return Math.round(layoutTop + Math.round(lineOffset * layoutScale * 64) / 64 + alphabeticOffset * layoutScale) / layoutScale + (node.y - originY);
}

/** Transport the historical hanging origin through the same CSS line box as
 * HTML. The logical hanging position stays exact; only the paint baseline is
 * quantized. Leading accumulates in LayoutUnits before CSS-pixel rounding. */
export function textFiniteBaselineY(node, index, metrics, { originY = node.y, layoutScale = 1, layoutMetrics = null } = {}) {
  const alpha = Number.isFinite(metrics.alphabeticBaseline)
    ? metrics.alphabeticBaseline : textLineBoxAlphabeticOffset(node, metrics);
  if (!Number.isFinite(metrics.hangingToAlphabetic)) throw Error("Finite text requires a measured hanging baseline");
  // The element top is authored in CSS px (HTML export: hanging origin minus the CSS alphabetic
  // offset). Under a real device scale Blink then lays the line box out at fontSize x scale
  // (`layoutMetrics`, measured at that size) and rounds the paint origin in physical pixels.
  // Scale 1 is the historical CSS replay, unchanged.
  const layoutAlpha = layoutScale !== 1 && layoutMetrics ? textLineBoxAlphabeticOffset(node, layoutMetrics, layoutScale) : alpha;
  const top = Math.trunc((originY + metrics.hangingToAlphabetic - alpha) * 64 * layoutScale) / 64;
  const height = Math.round(textLineHeightPixels(node) * layoutScale * 64) / 64;
  return Math.round(top + index * height + layoutAlpha * layoutScale) / layoutScale + (node.y - originY);
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
