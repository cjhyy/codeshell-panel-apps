/**
 * Style Mapper - DesignNode styles → Figma Paint/Effect
 */

import type {
  BackgroundInfo,
  BackgroundLayer,
  BorderInfo,
  EffectInfo,
  ColorValue,
  GradientStop,
  BoxShadow,
} from '@html2figma/shared';
import type {
  Paint,
  SolidPaint,
  GradientPaint,
  ImagePaint,
  AsyncImagePaint,
  Effect,
  RGB,
  RGBA,
  Transform,
  BlendMode,
} from '@html2figma/shared';

/**
 * Convert ColorValue (0-255) to Figma RGB (0-1)
 */
export function colorToFigmaRGB(color: ColorValue): RGB {
  return {
    r: color.r / 255,
    g: color.g / 255,
    b: color.b / 255,
  };
}

/**
 * Convert ColorValue to Figma RGBA (0-1)
 */
export function colorToFigmaRGBA(color: ColorValue): RGBA {
  return {
    r: color.r / 255,
    g: color.g / 255,
    b: color.b / 255,
    a: color.a,
  };
}

/**
 * Map CSS mix-blend-mode to Figma BlendMode
 */
export function mapBlendMode(cssBlendMode: string): BlendMode {
  const map: Record<string, BlendMode> = {
    'normal': 'NORMAL',
    'multiply': 'MULTIPLY',
    'screen': 'SCREEN',
    'overlay': 'OVERLAY',
    'darken': 'DARKEN',
    'lighten': 'LIGHTEN',
    'color-dodge': 'COLOR_DODGE',
    'color-burn': 'COLOR_BURN',
    'hard-light': 'HARD_LIGHT',
    'soft-light': 'SOFT_LIGHT',
    'difference': 'DIFFERENCE',
    'exclusion': 'EXCLUSION',
    'hue': 'HUE',
    'saturation': 'SATURATION',
    'color': 'COLOR',
    'luminosity': 'LUMINOSITY',
  };
  return map[cssBlendMode] || 'NORMAL';
}

/**
 * Map background layers to Figma fills
 */
export function mapBackgroundToFills(background: BackgroundInfo): Paint[] {
  const fills: Paint[] = [];

  for (const layer of background.layers) {
    const paint = mapBackgroundLayerToPaint(layer);
    if (paint) fills.push(paint);
  }

  return fills;
}

/**
 * Map a single background layer to a Figma Paint
 */
function mapBackgroundLayerToPaint(layer: BackgroundLayer): Paint | null {
  switch (layer.type) {
    case 'color': {
      if (layer.color.a === 0) return null;
      return {
        type: 'SOLID',
        color: colorToFigmaRGB(layer.color),
        opacity: layer.color.a,
        visible: true,
      } as SolidPaint;
    }

    case 'linear-gradient': {
      const stops = mapGradientStops(layer.stops);
      if (stops.length < 2) return null;
      return {
        type: 'GRADIENT_LINEAR',
        gradientStops: stops,
        gradientTransform: calculateLinearGradientTransform(layer.angle),
        visible: true,
      } as GradientPaint;
    }

    case 'radial-gradient': {
      const stops = mapGradientStops(layer.stops);
      if (stops.length < 2) return null;
      return {
        type: 'GRADIENT_RADIAL',
        gradientStops: stops,
        gradientTransform: calculateRadialGradientTransform(layer.position),
        visible: true,
      } as GradientPaint;
    }

    case 'conic-gradient': {
      const stops = mapGradientStops(layer.stops);
      if (stops.length < 2) return null;
      return {
        type: 'GRADIENT_ANGULAR',
        gradientStops: stops,
        gradientTransform: [
          [0.5, 0, 0.5],
          [0, 0.5, 0.5],
        ] as Transform,
        visible: true,
      } as GradientPaint;
    }

    case 'image': {
      // Image backgrounds — include base64 if available, otherwise pending URL for async fetch
      return {
        type: 'IMAGE',
        scaleMode: mapBackgroundSizeToScaleMode(layer.size, layer.repeat),
        visible: true,
        _pendingImageUrl: layer.url,
        _imageMetadata: {
          originalUrl: layer.url,
          ...(layer.base64 ? { base64: layer.base64 } : {}),
        },
      } as AsyncImagePaint;
    }

    default:
      return null;
  }
}

/**
 * Map gradient stops to Figma format
 */
function mapGradientStops(stops: GradientStop[]): { position: number; color: RGBA }[] {
  return stops.map(stop => ({
    position: Math.max(0, Math.min(1, stop.position)),
    color: colorToFigmaRGBA(stop.color),
  }));
}

/**
 * Calculate Figma gradient transform for linear gradient angle
 */
function calculateLinearGradientTransform(angleDeg: number): Transform {
  const mathAngleDeg = 90 - angleDeg;
  const angleRad = mathAngleDeg * (Math.PI / 180);
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  return [
    [cos, -sin, 0.5 - cos / 2 + sin / 2],
    [sin, cos, 0.5 - sin / 2 - cos / 2],
  ];
}

/**
 * Calculate Figma gradient transform for radial gradient.
 *
 * Figma convention: gradientTransform maps node UV space → gradient
 * canonical space (same as the linear gradient transform).
 *
 * In gradient canonical space the radial gradient is a circle centered
 * at (0.5, 0.5) with radius 0.5.
 *
 * CSS radial-gradient defaults to `ellipse farthest-corner` sizing.
 * The ellipse semi-axes in UV are sqrt(2) × fcx and sqrt(2) × fcy, where
 * fcx = max(cx, 1-cx) and fcy = max(cy, 1-cy).
 *
 * To map UV radius `semi` → gradient radius 0.5:
 *   scale = 0.5 / semi   (shrink UV distances into gradient space)
 *   tx = 0.5 - scale * cx  (so T(cx,cy) = (0.5, 0.5))
 *
 * For circle on non-square elements, nodeMapper applies an aspect-ratio fixup.
 */
function calculateRadialGradientTransform(
  position: { x: number; y: number },
): Transform {
  const cx = position.x;
  const cy = position.y;
  const fcx = Math.max(cx, 1 - cx);
  const fcy = Math.max(cy, 1 - cy);

  // Ellipse farthest-corner: semi-axes = sqrt(2) × farthest-side distance (UV)
  const SQRT2 = Math.SQRT2;
  const semiX = fcx > 0 ? SQRT2 * fcx : 0.5;
  const semiY = fcy > 0 ? SQRT2 * fcy : 0.5;

  // Scale: UV radius semi → gradient radius 0.5
  const sx = 0.5 / semiX;
  const sy = 0.5 / semiY;
  // Translation: UV center (cx, cy) → gradient center (0.5, 0.5)
  const tx = 0.5 - sx * cx;
  const ty = 0.5 - sy * cy;

  return [
    [sx, 0, tx],
    [0, sy, ty],
  ];
}

/**
 * Map background-size + background-repeat to Figma scaleMode.
 *
 * Figma scale modes:
 * - FILL: scale to fill (like CSS cover)
 * - FIT: scale to fit (like CSS contain)
 * - CROP: no scaling, positioned at origin
 * - TILE: repeat pattern
 */
function mapBackgroundSizeToScaleMode(
  size: BackgroundLayer & { type: 'image' } extends { size: infer S } ? S : never,
  repeat?: string,
): 'FILL' | 'FIT' | 'CROP' | 'TILE' {
  if (size === 'cover') return 'FILL';
  if (size === 'contain') return 'FIT';
  // Only full 'repeat' → TILE (Figma has no repeat-x / repeat-y equivalent)
  if (repeat === 'repeat') return 'TILE';
  // auto → CROP (natural size, no scaling)
  if (size === 'auto') return 'CROP';
  // Explicit dimensions (e.g. 80px 80px) → CROP with imageTransform
  if (typeof size === 'object') return 'CROP';
  return 'FILL';
}

/**
 * Map border to Figma strokes
 */
export function mapBorderToStrokes(border: BorderInfo): {
  strokes?: Paint[];
  strokeWeight?: number;
  strokeTopWeight?: number;
  strokeRightWeight?: number;
  strokeBottomWeight?: number;
  strokeLeftWeight?: number;
  strokeAlign?: 'INSIDE' | 'OUTSIDE' | 'CENTER';
  strokeDashPattern?: number[];
  cornerRadius?: number;
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomRightRadius?: number;
  bottomLeftRadius?: number;
} {
  const result: any = {};

  // Check if all sides have the same width, color, and style
  const colorsMatch = (a: ColorValue, b: ColorValue) =>
    a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
  const allSame = border.top.width === border.right.width &&
                  border.right.width === border.bottom.width &&
                  border.bottom.width === border.left.width &&
                  border.top.style === border.right.style &&
                  border.right.style === border.bottom.style &&
                  border.bottom.style === border.left.style &&
                  colorsMatch(border.top.color, border.right.color) &&
                  colorsMatch(border.right.color, border.bottom.color) &&
                  colorsMatch(border.bottom.color, border.left.color);

  const hasBorder = border.top.width > 0 || border.right.width > 0 ||
                    border.bottom.width > 0 || border.left.width > 0;

  // Skip fully transparent borders (e.g. CSS gradient border trick uses
  // border: Npx solid transparent — the visual border comes from gradient strokes,
  // not from the transparent solid border itself).
  const allTransparent = border.top.color.a === 0 && border.right.color.a === 0 &&
    border.bottom.color.a === 0 && border.left.color.a === 0;

  if (hasBorder && !allTransparent) {
    // Use the first non-zero border side for color
    const primarySide = [border.top, border.right, border.bottom, border.left]
      .find(s => s.width > 0);

    if (primarySide) {
      result.strokes = [{
        type: 'SOLID',
        color: colorToFigmaRGB(primarySide.color),
        opacity: primarySide.color.a,
        visible: true,
      }];

      if (allSame) {
        result.strokeWeight = border.top.width;
      } else {
        result.strokeTopWeight = border.top.width;
        result.strokeRightWeight = border.right.width;
        result.strokeBottomWeight = border.bottom.width;
        result.strokeLeftWeight = border.left.width;
      }

      result.strokeAlign = 'INSIDE';

      // Dash pattern from border-style (proportional to stroke weight)
      const sw = allSame ? border.top.width : primarySide.width;
      if (primarySide.style === 'dashed') result.strokeDashPattern = [sw * 3, sw];
      else if (primarySide.style === 'dotted') result.strokeDashPattern = [sw, sw];
    }
  }

  // Border radius
  const { topLeft, topRight, bottomRight, bottomLeft } = border.radius;
  const allSameRadius = topLeft === topRight && topRight === bottomRight && bottomRight === bottomLeft;

  if (allSameRadius && topLeft > 0) {
    result.cornerRadius = topLeft;
  } else if (topLeft > 0 || topRight > 0 || bottomRight > 0 || bottomLeft > 0) {
    result.topLeftRadius = topLeft;
    result.topRightRadius = topRight;
    result.bottomRightRadius = bottomRight;
    result.bottomLeftRadius = bottomLeft;
  }

  return result;
}

/**
 * Map gradient border layers to Figma gradient strokes.
 * Used when CSS gradient border trick is detected (transparent border + background-clip).
 */
export function mapGradientBorderToStrokes(
  layers: BackgroundLayer[],
  border: BorderInfo,
): { strokes: Paint[]; strokeWeight: number; strokeAlign: 'INSIDE' | 'OUTSIDE' | 'CENTER' } | null {
  if (!layers || layers.length === 0) return null;

  const strokes: Paint[] = [];
  for (const layer of layers) {
    const paint = mapBackgroundLayerToPaint(layer);
    if (paint) strokes.push(paint);
  }

  if (strokes.length === 0) return null;

  // Use max border width
  const strokeWeight = Math.max(border.top.width, border.right.width, border.bottom.width, border.left.width);

  return {
    strokes,
    strokeWeight,
    strokeAlign: 'INSIDE',
  };
}

/**
 * Map effects (box-shadow, blur) to Figma effects
 */
export function mapEffects(effects: EffectInfo): Effect[] {
  const result: Effect[] = [];

  // Box shadows → drop shadows / inner shadows
  for (const shadow of effects.boxShadows) {
    if (shadow.inset) {
      result.push({
        type: 'INNER_SHADOW',
        visible: true,
        color: colorToFigmaRGBA(shadow.color),
        blendMode: 'NORMAL',
        offset: { x: shadow.offsetX, y: shadow.offsetY },
        radius: shadow.blurRadius,
        spread: shadow.spreadRadius,
      });
    } else {
      result.push({
        type: 'DROP_SHADOW',
        visible: true,
        color: colorToFigmaRGBA(shadow.color),
        blendMode: 'NORMAL',
        offset: { x: shadow.offsetX, y: shadow.offsetY },
        radius: shadow.blurRadius,
        spread: shadow.spreadRadius,
        // CSS box-shadow only renders behind the element's own painted area,
        // never bleeding through to child content. Figma's default (true)
        // shows shadow behind transparent areas of the frame, causing
        // shadows to visually "leak" into children — inconsistent with CSS.
        showShadowBehindNode: false,
      });
    }
  }

  // CSS filter effects → Figma effects
  if (effects.filters) {
    for (const filter of effects.filters) {
      if (filter.type === 'blur' && typeof filter.value === 'number') {
        result.push({
          type: 'LAYER_BLUR',
          visible: true,
          radius: filter.value,
        });
      } else if (filter.type === 'drop-shadow' && typeof filter.value === 'string') {
        const shadow = parseDropShadowFilter(filter.value);
        if (shadow) {
          result.push(shadow);
        }
      }
    }
  }

  // CSS backdrop-filter: blur → Figma background blur
  if (effects.backdropFilters) {
    for (const filter of effects.backdropFilters) {
      if (filter.type === 'blur' && typeof filter.value === 'number') {
        result.push({
          type: 'BACKGROUND_BLUR',
          visible: true,
          radius: filter.value,
        });
      }
    }
  }

  return result;
}

/**
 * Parse CSS drop-shadow() filter value into a Figma DROP_SHADOW effect.
 * Format: drop-shadow(offsetX offsetY blurRadius color)
 */
function parseDropShadowFilter(value: string): Effect | null {
  // Tokenize respecting parentheses (for rgba colors)
  const tokens: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of value) {
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

  // Parse color: default to semi-transparent black
  let color: RGBA = { r: 0, g: 0, b: 0, a: 0.25 };
  if (colorStr) {
    const rgbaMatch = colorStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
    if (rgbaMatch) {
      color = {
        r: parseInt(rgbaMatch[1]) / 255,
        g: parseInt(rgbaMatch[2]) / 255,
        b: parseInt(rgbaMatch[3]) / 255,
        a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1,
      };
    }
  }

  return {
    type: 'DROP_SHADOW',
    visible: true,
    color,
    blendMode: 'NORMAL',
    offset: { x: lengths[0], y: lengths[1] },
    radius: lengths[2] || 0,
    spread: 0,
  };
}
