/**
 * Figma Adapter - DesignNode → Figma conversion
 */

export { FigmaAdapter } from './FigmaAdapter';
export { mapDesignNodeToFigma } from './nodeMapper';
export { mapLayout, mapOverflow, mapPositioning } from './layoutMapper';
export {
  mapBackgroundToFills,
  mapBorderToStrokes,
  mapEffects,
  mapBlendMode,
  colorToFigmaRGB,
  colorToFigmaRGBA,
} from './styleMapper';
export { mapTextStyle, mapStyledSegments, mapFontName } from './textMapper';
