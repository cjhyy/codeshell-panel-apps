/**
 * DSL Utils - Color parsing, unit conversion, and shared helpers
 */

import type { ColorValue, Spacing, BoundingBox, DesignNode } from '@html2figma/shared';
import { parsePx, parseMultiValue, expandMultiValue } from '@html2figma/shared/css-utils';
import { generateId } from '@html2figma/shared/utils';

// Re-export generateId so existing internal imports (`from './utils'`) keep working
export { generateId };

/** Color parse cache to avoid DOM reflow */
const colorCache = new Map<string, ColorValue | null>();

/**
 * Parse a CSS color string to ColorValue (0-255 range)
 * Uses the browser's built-in color parsing
 */
export function parseColor(colorString: string): ColorValue | null {
  if (!colorString || colorString === 'transparent' || colorString === 'none' ||
      colorString === 'initial' || colorString === 'inherit') {
    return null;
  }

  // Check cache first
  if (colorCache.has(colorString)) {
    const cached = colorCache.get(colorString)!;
    return cached ? { ...cached } : null;
  }

  const result = parseColorUncached(colorString);
  colorCache.set(colorString, result);
  return result;
}

function parseColorUncached(colorString: string): ColorValue | null {
  // Parse rgba/rgb with commas: rgb(255, 0, 0) or rgba(255, 0, 0, 0.5)
  const rgbaMatch = colorString.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1]),
      g: parseInt(rgbaMatch[2]),
      b: parseInt(rgbaMatch[3]),
      a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1,
      raw: colorString,
    };
  }

  // Parse comma-free syntax: rgb(255 0 0) or rgb(255 0 0 / 0.5)
  const rgbSpaceMatch = colorString.match(/rgba?\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+%?))?\s*\)/);
  if (rgbSpaceMatch) {
    let alpha = 1;
    if (rgbSpaceMatch[4] !== undefined) {
      alpha = rgbSpaceMatch[4].endsWith('%')
        ? parseFloat(rgbSpaceMatch[4]) / 100
        : parseFloat(rgbSpaceMatch[4]);
    }
    return {
      r: parseInt(rgbSpaceMatch[1]),
      g: parseInt(rgbSpaceMatch[2]),
      b: parseInt(rgbSpaceMatch[3]),
      a: alpha,
      raw: colorString,
    };
  }

  // Parse hex
  if (colorString.startsWith('#')) {
    const hex = colorString.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        return { r, g, b, a, raw: colorString };
      }
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.substr(0, 2), 16);
      const g = parseInt(hex.substr(2, 2), 16);
      const b = parseInt(hex.substr(4, 2), 16);
      const a = hex.length === 8 ? parseInt(hex.substr(6, 2), 16) / 255 : 1;
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        return { r, g, b, a, raw: colorString };
      }
    }
  }

  // Use browser to parse named colors and other formats
  try {
    const div = document.createElement('div');
    div.style.color = colorString;
    document.body.appendChild(div);
    const computed = window.getComputedStyle(div).color;
    document.body.removeChild(div);

    const match = computed.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
    if (match) {
      return {
        r: parseInt(match[1]),
        g: parseInt(match[2]),
        b: parseInt(match[3]),
        a: match[4] !== undefined ? parseFloat(match[4]) : 1,
        raw: colorString,
      };
    }
  } catch {
    // Ignore browser parsing errors
  }

  return null;
}

/**
 * Parse spacing (padding/margin) from computed style
 */
export function parseSpacing(
  computedStyle: Record<string, string>,
  prefix: 'padding' | 'margin'
): Spacing {
  return {
    top: parsePx(computedStyle[`${prefix}-top`] || computedStyle[`${prefix}Top`] || '0'),
    right: parsePx(computedStyle[`${prefix}-right`] || computedStyle[`${prefix}Right`] || '0'),
    bottom: parsePx(computedStyle[`${prefix}-bottom`] || computedStyle[`${prefix}Bottom`] || '0'),
    left: parsePx(computedStyle[`${prefix}-left`] || computedStyle[`${prefix}Left`] || '0'),
  };
}

/**
 * Parse shorthand spacing value
 */
export function parseShorthandSpacing(value: string): Spacing {
  const values = parseMultiValue(value);
  return expandMultiValue(values);
}

/**
 * Check if a color is transparent
 */
export function isTransparent(color: ColorValue | null): boolean {
  if (!color) return true;
  return color.a === 0;
}

/**
 * Extract a CSS property from computed style, trying both kebab-case and camelCase
 */
export function getStyle(styles: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    if (styles[key]) return styles[key];
  }
  return '';
}

/**
 * Extract URL from CSS url() function
 */
export function extractUrlFromCss(cssValue: string): string | null {
  if (!cssValue || !cssValue.includes('url(')) {
    return null;
  }
  const match = cssValue.match(/url\s*\(\s*['"]?([^'")\s]+)['"]?\s*\)/i);
  return match ? match[1] : null;
}

/**
 * Convert CSSStyleDeclaration to plain Record<string, string>
 */
export function computedStyleToRecord(computedStyle: CSSStyleDeclaration): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < computedStyle.length; i++) {
    const property = computedStyle[i];
    const value = computedStyle.getPropertyValue(property);
    if (value && value !== 'initial' && value !== 'inherit' && value !== 'unset') {
      result[property] = value;
    }
  }

  // Explicitly read properties that may not be enumerable.
  // Vendor-prefixed properties and CSS shorthands (e.g. border-spacing decomposes
  // into -webkit-border-horizontal/vertical-spacing) are not listed in the iteration
  // but getPropertyValue() still returns the correct value.
  const explicitProps = ['-webkit-line-clamp', '-webkit-box-orient', 'border-spacing'];
  for (const prop of explicitProps) {
    if (!(prop in result)) {
      const val = computedStyle.getPropertyValue(prop);
      if (val && val !== 'none' && val !== 'initial' && val !== 'inherit' && val !== 'unset') {
        result[prop] = val;
      }
    }
  }

  return result;
}

/**
 * Compute the visual bounding box of a single node.
 * For zero-dimension containers with children, recursively expands
 * to include children's visual bounds (e.g. inline <a> wrapping <img>).
 */
function visualBounds(node: DesignNode): BoundingBox {
  const b = node.bounds;
  if (b.width > 0 && b.height > 0) return b;

  // Zero-dimension node with children — expand to include children
  const children = (node as any).children as DesignNode[] | undefined;
  if (!children || children.length === 0) return b;

  let minX = b.x, minY = b.y;
  let maxX = b.x + b.width, maxY = b.y + b.height;
  for (const child of children) {
    // Skip fixed children — they will be hoisted to root by hoistFixedElements
    // and should not inflate the parent's bounds (e.g. a 0×0 inline container
    // whose fixed children are large viewport-level elements like navbars).
    if (child.positioning?.mode === 'fixed') continue;
    // Children use parent-relative coords; convert to same coordinate space
    const cb = visualBounds(child);
    const cx = b.x + cb.x;
    const cy = b.y + cb.y;
    minX = Math.min(minX, cx);
    minY = Math.min(minY, cy);
    maxX = Math.max(maxX, cx + cb.width);
    maxY = Math.max(maxY, cy + cb.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Compute the union bounding box of a set of nodes.
 * Uses visual bounds to handle zero-dimension containers with visible children.
 */
export function unionBounds(nodes: DesignNode[]): BoundingBox {
  if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const vb = visualBounds(node);
    minX = Math.min(minX, vb.x);
    minY = Math.min(minY, vb.y);
    maxX = Math.max(maxX, vb.x + vb.width);
    maxY = Math.max(maxY, vb.y + vb.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
