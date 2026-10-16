/**
 * Style Resolver - CSS → structured DesignNode styles
 *
 * Parses CSS background, border, and effect properties into
 * DesignNode structured types, preserving CSS semantics.
 */

import type {
  BackgroundInfo,
  BackgroundLayer,
  BorderInfo,
  BorderSide,
  EffectInfo,
  BoxShadow,
  FilterEffect,
  ColorValue,
  GradientStop,
} from '@html2figma/shared';
import { parsePx, parseMultiValue, expandMultiValue, parseAngle } from '@html2figma/shared/css-utils';
import { createLogger, LogModule } from '@html2figma/shared';
import { parseColor, extractUrlFromCss, isTransparent } from '../utils';

const logger = createLogger(LogModule.NODE_TRAVERSER);

// ==================== Background ====================

/**
 * Resolve background from computed styles
 * @param styles - Computed CSS styles
 * @param elementBounds - Element dimensions for resolving percentage-based background-size
 */
export function resolveBackground(styles: Record<string, string>, elementBounds?: { width: number; height: number }): BackgroundInfo {
  const layers: BackgroundLayer[] = [];

  // background-color (always bottom layer)
  const bgColor = styles['background-color'] || styles['backgroundColor'];
  if (bgColor) {
    const color = parseColor(bgColor);
    if (color && !isTransparent(color)) {
      layers.push({ type: 'color', color });
    }
  }

  // background-image (can be multiple layers)
  const bgImage = styles['background-image'] || styles['backgroundImage'] || '';
  const bgValue = styles['background'] || '';
  const imageSource = bgImage !== 'none' ? bgImage : bgValue;

  if (imageSource && imageSource !== 'none') {
    logger.info(`[Background] imageSource="${imageSource.substring(0, 120)}" bgSize=${styles['background-size']} bgPos=${styles['background-position']} bgRepeat=${styles['background-repeat']}`);
    const imageLayers = splitBackgroundLayers(imageSource);
    // Pre-split per-layer background-size / position / repeat
    // (browsers report comma-separated values matching the number of image layers)
    const bgSizes = splitBackgroundLayers(styles['background-size'] || styles['backgroundSize'] || '');
    const bgPositions = splitBackgroundLayers(styles['background-position'] || styles['backgroundPosition'] || '');
    const bgRepeats = splitBackgroundLayers(styles['background-repeat'] || styles['backgroundRepeat'] || '');

    // CSS: first layer is on top; we store bottom-to-top
    for (let i = imageLayers.length - 1; i >= 0; i--) {
      const perLayerStyles: Record<string, string> = {
        ...styles,
        'background-size': bgSizes[i] || bgSizes[0] || 'auto',
        'background-position': bgPositions[i] || bgPositions[0] || '0% 0%',
        'background-repeat': bgRepeats[i] || bgRepeats[0] || 'repeat',
      };
      const layer = parseSingleBackgroundLayer(imageLayers[i], perLayerStyles, elementBounds);
      if (layer) {
        const extra = layer.type === 'image'
          ? ` url=${(layer as any).url?.substring(0, 80)} size=${JSON.stringify((layer as any).size)} repeat=${(layer as any).repeat}`
          : '';
        logger.info(`[Background] parsed layer[${i}]: type=${layer.type}${extra}`);
        layers.push(layer);
      }
    }
  }

  if (layers.length > 0) {
    logger.info(`[Background] resolved ${layers.length} layers: [${layers.map(l => l.type).join(', ')}]`);
  }

  return { layers };
}

/**
 * Split multi-layer background values, respecting parentheses
 */
export function splitBackgroundLayers(value: string): string[] {
  const layers: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of value) {
    if (char === '(') { depth++; current += char; }
    else if (char === ')') { depth--; current += char; }
    else if (char === ',' && depth === 0) {
      if (current.trim()) layers.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) layers.push(current.trim());
  return layers;
}

/**
 * Parse a single background layer string
 */
function parseSingleBackgroundLayer(layer: string, styles: Record<string, string>, elementBounds?: { width: number; height: number }): BackgroundLayer | null {
  if (layer.includes('linear-gradient')) {
    return parseLinearGradient(layer);
  }
  if (layer.includes('radial-gradient')) {
    return parseRadialGradient(layer);
  }
  if (layer.includes('conic-gradient')) {
    return parseConicGradient(layer);
  }
  if (layer.includes('url(')) {
    return parseBackgroundImage(layer, styles, elementBounds);
  }
  // Solid color fallback
  const color = parseColor(layer);
  if (color && !isTransparent(color)) {
    return { type: 'color', color };
  }
  return null;
}

/**
 * Parse linear-gradient
 */
function parseLinearGradient(value: string): BackgroundLayer | null {
  const match = value.match(/linear-gradient\((.+)\)/);
  if (!match) return null;

  const content = match[1];
  let angle = 180; // default: to bottom
  let stopsStr = content;

  // Check for direction or angle
  const dirMatch = content.match(/^(to\s+\w+(?:\s+\w+)?|-?[\d.]+(?:deg|rad|grad|turn))\s*,\s*/);
  if (dirMatch) {
    const dir = dirMatch[1];
    stopsStr = content.slice(dirMatch[0].length);

    if (dir.startsWith('to ')) {
      angle = directionToAngle(dir);
    } else {
      angle = parseAngle(dir);
    }
  }

  const stops = parseGradientStops(stopsStr);
  if (stops.length < 2) return null;

  return { type: 'linear-gradient', angle, stops };
}

/**
 * Parse radial-gradient
 */
function parseRadialGradient(value: string): BackgroundLayer | null {
  const match = value.match(/radial-gradient\((.+)\)/);
  if (!match) return null;

  const content = match[1];
  let shape: 'circle' | 'ellipse' = 'ellipse';
  let position = { x: 0.5, y: 0.5 };
  let stopsStr = content;

  // Parse optional shape/size/position prefix before color stops.
  // CSS radial-gradient syntax: radial-gradient([shape] [size] [at position], stops...)
  // Examples:
  //   circle at 50% 50%, ...
  //   ellipse 100% 33% at 0% 100%, ...
  //   closest-side at 50% 50%, ...
  //   100% 33% at 0% 100%, ...
  // The prefix regex matches optional shape, optional size (keywords or lengths),
  // and optional "at X Y" position — everything up to the comma before color stops.
  const shapeMatch = content.match(
    /^(?:(circle|ellipse)\s+)?(?:(?:closest-side|closest-corner|farthest-side|farthest-corner|[\d.]+(?:px|%|em|rem|vh|vw)?(?:\s+[\d.]+(?:px|%|em|rem|vh|vw)?)?)\s+)?(?:at\s+([\d.]+%?)\s+([\d.]+%?))?\s*,\s*/
  );
  if (!shapeMatch) {
    // Fallback: try simple shape-only or at-only patterns
    const simpleMatch = content.match(/^(circle|ellipse)?\s*(?:at\s+([\d.]+%?)\s+([\d.]+%?))?\s*,\s*/);
    if (simpleMatch) {
      if (simpleMatch[1]) shape = simpleMatch[1] as 'circle' | 'ellipse';
      if (simpleMatch[2]) position.x = parseFloat(simpleMatch[2]) / 100;
      if (simpleMatch[3]) position.y = parseFloat(simpleMatch[3]) / 100;
      stopsStr = content.slice(simpleMatch[0].length);
    }
  } else {
    if (shapeMatch[1]) shape = shapeMatch[1] as 'circle' | 'ellipse';
    if (shapeMatch[2]) position.x = parseFloat(shapeMatch[2]) / 100;
    if (shapeMatch[3]) position.y = parseFloat(shapeMatch[3]) / 100;
    stopsStr = content.slice(shapeMatch[0].length);
  }

  const stops = parseGradientStops(stopsStr);
  if (stops.length < 2) return null;

  return { type: 'radial-gradient', shape, position, stops };
}

/**
 * Parse conic-gradient
 */
function parseConicGradient(value: string): BackgroundLayer | null {
  const match = value.match(/conic-gradient\((.+)\)/);
  if (!match) return null;

  const content = match[1];
  let angle = 0;
  let position = { x: 0.5, y: 0.5 };
  let stopsStr = content;

  const prefixMatch = content.match(/^(?:from\s+([\d.]+(?:deg|rad|turn)))?\s*(?:at\s+([\d.]+%?)\s+([\d.]+%?))?\s*,\s*/);
  if (prefixMatch) {
    if (prefixMatch[1]) angle = parseAngle(prefixMatch[1]);
    if (prefixMatch[2]) position.x = parseFloat(prefixMatch[2]) / 100;
    if (prefixMatch[3]) position.y = parseFloat(prefixMatch[3]) / 100;
    stopsStr = content.slice(prefixMatch[0].length);
  }

  const stops = parseGradientStops(stopsStr);
  if (stops.length < 2) return null;

  return { type: 'conic-gradient', angle, position, stops };
}

/**
 * Parse gradient color stops
 */
function parseGradientStops(stopsStr: string): GradientStop[] {
  const stops: GradientStop[] = [];
  const parts = splitBackgroundLayers(stopsStr); // reuse comma splitter

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    // Match: color [position]
    const posMatch = part.match(/^(.+?)\s+([\d.]+%?)$/);

    let colorStr = part;
    let position: number | undefined;

    if (posMatch) {
      colorStr = posMatch[1].trim();
      const posValue = posMatch[2];
      position = posValue.includes('%') ? parseFloat(posValue) / 100 : parseFloat(posValue);
    }

    const color = parseColor(colorStr);
    if (color) {
      stops.push({
        position: position !== undefined ? position : i / Math.max(1, parts.length - 1),
        color,
      });
    }
  }

  return stops;
}

/**
 * Resolve a single background-size dimension value.
 * Resolves percentages against container dimension, treats 'auto' as 0 (sentinel).
 */
function resolveBackgroundSizeDimension(val: string, containerDim?: number): number {
  if (val === 'auto') return 0; // sentinel: downstream handles via intrinsic image size
  if (val.includes('%')) {
    const pct = parseFloat(val) / 100;
    return containerDim ? Math.round(pct * containerDim) : 0;
  }
  return parsePx(val);
}

/**
 * Split a space-separated string into tokens, respecting parentheses.
 * Handles values like "calc(100% - 10px) calc(100% - 10px)".
 */
function splitSpaceTokens(value: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of value) {
    if (char === '(') { depth++; current += char; }
    else if (char === ')') { depth--; current += char; }
    else if (/\s/.test(char) && depth === 0) {
      if (current.trim()) tokens.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

/**
 * Parse background-image url()
 */
function parseBackgroundImage(layer: string, styles: Record<string, string>, elementBounds?: { width: number; height: number }): BackgroundLayer | null {
  const url = extractUrlFromCss(layer);
  if (!url) return null;

  const bgSize = styles['background-size'] || styles['backgroundSize'] || 'auto';
  let size: BackgroundLayer & { type: 'image' } extends { size: infer S } ? S : never;

  if (bgSize === 'cover') size = 'cover';
  else if (bgSize === 'contain') size = 'contain';
  else if (bgSize === 'auto' || bgSize === 'auto auto') size = 'auto';
  else {
    const parts = bgSize.split(/\s+/);
    const w = resolveBackgroundSizeDimension(parts[0] || '0', elementBounds?.width);
    const h = resolveBackgroundSizeDimension(parts[1] || parts[0] || '0', elementBounds?.height);
    // Both 0 (both auto) → treat as 'auto' keyword
    if (w === 0 && h === 0) size = 'auto';
    else size = { width: w, height: h };
  }

  const bgPos = styles['background-position'] || styles['backgroundPosition'] || '0% 0%';
  const posParts = splitSpaceTokens(bgPos);
  // CSS background-position % is relative to (container - image), compute available space
  const imgW = typeof size === 'object' && size.width > 0 ? size.width : undefined;
  const imgH = typeof size === 'object' && size.height > 0 ? size.height : undefined;
  const availW = (elementBounds?.width && imgW) ? elementBounds.width - imgW : undefined;
  const availH = (elementBounds?.height && imgH) ? elementBounds.height - imgH : undefined;
  const posX = parseBackgroundPositionValue(posParts[0] || '0%', availW);
  const posY = parseBackgroundPositionValue(posParts[1] || posParts[0] || '0%', availH);

  const repeat = styles['background-repeat'] || styles['backgroundRepeat'] || 'repeat';

  return {
    type: 'image',
    url,
    size,
    position: { x: posX, y: posY },
    repeat,
  };
}

/**
 * Parse a single background-position value (keyword, percentage, pixel, or calc).
 * Returns a 0-1 fraction (for keywords/%) or raw px (for px/calc with availableDim).
 *
 * @param val - CSS position value
 * @param availableDim - (containerDim - imageDim) for resolving calc() expressions.
 *   CSS background-position % is relative to (container - image), not container.
 */
function parseBackgroundPositionValue(val: string, availableDim?: number): number {
  const keywordMap: Record<string, number> = {
    'left': 0, 'top': 0,
    'center': 0.5,
    'right': 1, 'bottom': 1,
  };
  if (keywordMap[val] !== undefined) return keywordMap[val];
  // Handle calc() expressions (e.g., "calc(100% - 10px)" from 4-value position syntax)
  if (val.startsWith('calc(')) {
    const match = val.match(/calc\((.+)\)/);
    if (match) {
      const inner = match[1].trim();
      const calcMatch = inner.match(/^([\d.]+)%\s*([+-])\s*([\d.]+)(?:px)?$/);
      if (calcMatch) {
        const pct = parseFloat(calcMatch[1]) / 100;
        const op = calcMatch[2];
        const px = parseFloat(calcMatch[3]);
        if (availableDim != null && availableDim > 0) {
          // Fully resolve: (containerDim - imgDim) * pct ± px → raw px
          return pct * availableDim + (op === '-' ? -px : px);
        }
        return pct; // fallback: percentage fraction only
      }
    }
    return 0;
  }
  if (val.includes('%')) return parseFloat(val) / 100;
  if (val.endsWith('px')) return parsePx(val); // raw px for downstream use
  return parseFloat(val) || 0;
}

/**
 * CSS direction keyword → angle in degrees
 */
function directionToAngle(dir: string): number {
  const map: Record<string, number> = {
    'to top': 0,
    'to top right': 45,
    'to right': 90,
    'to bottom right': 135,
    'to bottom': 180,
    'to bottom left': 225,
    'to left': 270,
    'to top left': 315,
  };
  return map[dir] ?? 180;
}

// ==================== Border ====================

const ZERO_COLOR: ColorValue = { r: 0, g: 0, b: 0, a: 0 };

function zeroBorderSide(): BorderSide {
  return { width: 0, style: 'none', color: { ...ZERO_COLOR } };
}

/**
 * Resolve border from computed styles
 */
export function resolveBorder(styles: Record<string, string>): BorderInfo {
  const parseSide = (side: 'top' | 'right' | 'bottom' | 'left'): BorderSide => {
    const width = parsePx(styles[`border-${side}-width`] || '0');
    const styleVal = (styles[`border-${side}-style`] || 'none') as BorderSide['style'];
    const colorStr = styles[`border-${side}-color`] || '';
    const color = parseColor(colorStr) || { ...ZERO_COLOR };

    if (width <= 0 || styleVal === 'none') {
      return zeroBorderSide();
    }

    return { width, style: styleVal, color };
  };

  const parseRadius = (key: string): number => {
    return parsePx(styles[key] || '0');
  };

  return {
    top: parseSide('top'),
    right: parseSide('right'),
    bottom: parseSide('bottom'),
    left: parseSide('left'),
    radius: {
      topLeft: parseRadius('border-top-left-radius'),
      topRight: parseRadius('border-top-right-radius'),
      bottomRight: parseRadius('border-bottom-right-radius'),
      bottomLeft: parseRadius('border-bottom-left-radius'),
    },
  };
}

// ==================== Effects ====================

/**
 * Resolve effects (box-shadow, filter, backdrop-filter, blend-mode)
 */
export function resolveEffects(styles: Record<string, string>): EffectInfo {
  return {
    boxShadows: parseBoxShadows(styles['box-shadow'] || styles['boxShadow'] || ''),
    filters: parseFilterList(styles['filter'] || ''),
    backdropFilters: parseFilterList(styles['backdrop-filter'] || styles['backdropFilter'] || ''),
    blendMode: styles['mix-blend-mode'] || styles['mixBlendMode'] || undefined,
  };
}

/**
 * Parse CSS box-shadow into structured BoxShadow[]
 */
function parseBoxShadows(value: string): BoxShadow[] {
  if (!value || value === 'none') return [];

  const shadows: BoxShadow[] = [];
  // Split by comma but respect parentheses (for rgba)
  const parts = splitBackgroundLayers(value);

  for (const part of parts) {
    const shadow = parseSingleBoxShadow(part.trim());
    if (shadow) shadows.push(shadow);
  }

  return shadows;
}

function parseSingleBoxShadow(value: string): BoxShadow | null {
  const inset = value.includes('inset');
  const cleaned = value.replace(/inset/g, '').trim();

  // Match lengths and color
  const tokens: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of cleaned) {
    if (char === '(') { depth++; current += char; }
    else if (char === ')') { depth--; current += char; }
    else if (char === ' ' && depth === 0) {
      if (current.trim()) tokens.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) tokens.push(current.trim());

  // Separate length values from color
  const lengths: number[] = [];
  let colorStr = '';

  for (const token of tokens) {
    if (token.match(/^-?[\d.]+px$/) || token.match(/^-?[\d.]+$/)) {
      lengths.push(parseFloat(token));
    } else {
      colorStr += (colorStr ? ' ' : '') + token;
    }
  }

  if (lengths.length < 2) return null;

  const color = parseColor(colorStr) || { r: 0, g: 0, b: 0, a: 0.25 };

  return {
    inset,
    offsetX: lengths[0],
    offsetY: lengths[1],
    blurRadius: lengths[2] || 0,
    spreadRadius: lengths[3] || 0,
    color,
  };
}

/**
 * Parse CSS filter or backdrop-filter
 */
function parseFilterList(value: string): FilterEffect[] | undefined {
  if (!value || value === 'none') return undefined;

  const effects: FilterEffect[] = [];
  const regex = /(\w[\w-]*)\(([^)]+)\)/g;
  let match;

  while ((match = regex.exec(value)) !== null) {
    const type = match[1] as FilterEffect['type'];
    const val = match[2].trim();

    switch (type) {
      case 'blur':
        effects.push({ type: 'blur', value: parsePx(val) });
        break;
      case 'brightness':
      case 'contrast':
      case 'grayscale':
      case 'invert':
      case 'saturate':
      case 'sepia':
        effects.push({ type, value: parseFloat(val) });
        break;
      case 'hue-rotate':
        effects.push({ type: 'hue-rotate', value: parseAngle(val) });
        break;
      case 'drop-shadow':
        effects.push({ type: 'drop-shadow', value: val });
        break;
    }
  }

  return effects.length > 0 ? effects : undefined;
}
