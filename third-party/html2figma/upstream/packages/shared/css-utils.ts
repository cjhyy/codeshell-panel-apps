/**
 * CSS Utils - Unified CSS parsing utility functions
 *
 * Contains all CSS value parsing related utilities.
 */

/**
 * Parse a pixel value (supports px, em, rem, %).
 * @param value - CSS value string
 * @returns Parsed numeric value, or 0 on failure
 */
export function parsePx(value: string): number {
  if (!value) return 0;
  const match = value.match(/^(-?\d+(?:\.\d+)?)(px|em|rem|%)?$/);
  if (!match) return 0;
  return parseFloat(match[1]);
}

/**
 * Parse a length value and convert units to pixels.
 * @param value - CSS length value
 * @param baseFontSize - Base font size in px (default 16)
 * @returns Value converted to pixels
 */
export function parseLengthValue(value: string, baseFontSize: number = 16): number {
  if (!value) return 0;

  if (value.endsWith('px')) {
    return parseFloat(value);
  } else if (value.endsWith('%')) {
    return parseFloat(value);
  } else if (value.endsWith('em')) {
    return parseFloat(value) * baseFontSize;
  } else if (value.endsWith('rem')) {
    return parseFloat(value) * baseFontSize;
  } else if (value.endsWith('vh')) {
    return (parseFloat(value) / 100) * (window.innerHeight || 800);
  } else if (value.endsWith('vw')) {
    return (parseFloat(value) / 100) * (window.innerWidth || 1200);
  }

  return parseFloat(value) || 0;
}

/**
 * Parse an angle value and convert to degrees.
 * @param value - Angle value string
 * @returns Degrees
 */
export function parseAngle(value: string): number {
  if (!value) return 0;

  if (value.endsWith('deg')) {
    return parseFloat(value);
  } else if (value.endsWith('rad')) {
    return parseFloat(value) * (180 / Math.PI);
  } else if (value.endsWith('grad')) {
    return parseFloat(value) * (180 / 200);
  } else if (value.endsWith('turn')) {
    return parseFloat(value) * 360;
  }

  return parseFloat(value) || 0;
}

/**
 * Parse a CSS multi-value string (e.g. "10px 20px 30px 40px").
 * @param value - CSS multi-value string
 * @returns Array of numeric values
 */
export function parseMultiValue(value: string): number[] {
  if (!value) return [];

  return value
    .trim()
    .split(/\s+/)
    .map(v => parsePx(v))
    .filter(v => !isNaN(v));
}

/**
 * Values for four sides (top, right, bottom, left).
 */
export interface FourSides {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Expand a CSS multi-value array into four sides (following CSS shorthand rules):
 * - 1 value: all four sides
 * - 2 values: top/bottom, left/right
 * - 3 values: top, left/right, bottom
 * - 4 values: top, right, bottom, left
 *
 * @param values - Array of numeric values
 * @returns Four-side values
 */
export function expandMultiValue(values: number[]): FourSides {
  switch (values.length) {
    case 1:
      return {
        top: values[0],
        right: values[0],
        bottom: values[0],
        left: values[0]
      };
    case 2:
      return {
        top: values[0],
        right: values[1],
        bottom: values[0],
        left: values[1]
      };
    case 3:
      return {
        top: values[0],
        right: values[1],
        bottom: values[2],
        left: values[1]
      };
    case 4:
      return {
        top: values[0],
        right: values[1],
        bottom: values[2],
        left: values[3]
      };
    default:
      return {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0
      };
  }
}

/**
 * Parse a gap value.
 * @param gap - Gap value string
 * @returns Parsed numeric value
 */
export function parseGapValue(gap: string | undefined): number {
  if (!gap || gap === 'normal' || gap === '0' || gap === '0px') {
    return 0;
  }
  return parseFloat(gap) || 0;
}

/**
 * Parse a transform-origin value.
 * @param origin - transform-origin value
 * @param boundingRect - Element bounding rect
 * @returns Origin coordinates
 */
export function parseTransformOrigin(
  origin: string,
  boundingRect: DOMRect
): { x: number; y: number } {
  const parts = origin.split(' ');
  let x = boundingRect.width / 2;
  let y = boundingRect.height / 2;

  const parseOriginValue = (value: string, dimension: number): number => {
    if (value.includes('%')) {
      return (parseFloat(value) / 100) * dimension;
    } else if (value.includes('px')) {
      return parseFloat(value);
    } else if (value === 'left' || value === 'top') {
      return 0;
    } else if (value === 'right' || value === 'bottom') {
      return dimension;
    } else if (value === 'center') {
      return dimension / 2;
    }
    return parseFloat(value) || 0;
  };

  if (parts.length >= 1) {
    x = parseOriginValue(parts[0], boundingRect.width);
  }
  if (parts.length >= 2) {
    y = parseOriginValue(parts[1], boundingRect.height);
  }

  return { x, y };
}

/**
 * Convert a hyphenated string to camelCase.
 * @param str - Hyphen-separated string
 * @returns camelCase string
 */
export function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (match, letter) => letter.toUpperCase());
}

/**
 * Convert a camelCase string to kebab-case.
 * @param str - camelCase string
 * @returns Kebab-case string
 */
export function toKebabCase(str: string): string {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase();
}
