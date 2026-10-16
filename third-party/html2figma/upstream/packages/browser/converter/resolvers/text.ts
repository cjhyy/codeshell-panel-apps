/**
 * Text Resolver - Extract and sanitize text content and styles
 */

import type { TextStyleInfo, ColorValue, BoxShadow } from '@html2figma/shared';
import { createLogger, LogModule } from '@html2figma/shared';
import { parsePx, parseAngle } from '@html2figma/shared/css-utils';
import { parseColor, getStyle } from '../utils';
import { splitBackgroundLayers } from './style';

const logger = createLogger(LogModule.NODE_TRAVERSER);

/**
 * Resolve text style from computed styles
 */
export function resolveTextStyle(styles: Record<string, string>): TextStyleInfo {
  const fontFamily = getStyle(styles, 'font-family', 'fontFamily') || 'sans-serif';
  const fontSize = parsePx(getStyle(styles, 'font-size', 'fontSize') || '16px');
  const fontWeight = getStyle(styles, 'font-weight', 'fontWeight') || '400';
  const fontStyle = normalizeFontStyle(getStyle(styles, 'font-style', 'fontStyle'));
  const color = parseColor(getStyle(styles, 'color')) || { r: 0, g: 0, b: 0, a: 1 };

  const textAlign = normalizeTextAlign(getStyle(styles, 'text-align', 'textAlign'));
  const verticalAlign = getStyle(styles, 'vertical-align', 'verticalAlign') || undefined;
  const textDecoration = normalizeTextDecoration(getStyle(styles, 'text-decoration', 'textDecoration', 'text-decoration-line', 'textDecorationLine'));
  const textTransform = normalizeTextTransform(getStyle(styles, 'text-transform', 'textTransform'));

  const lineHeight = resolveLineHeight(getStyle(styles, 'line-height', 'lineHeight'), fontSize);
  const letterSpacing = resolveLetterSpacing(getStyle(styles, 'letter-spacing', 'letterSpacing'));

  const whiteSpace = getStyle(styles, 'white-space', 'whiteSpace') || undefined;
  const wordBreak = getStyle(styles, 'word-break', 'wordBreak') || undefined;
  const textOverflow = normalizeTextOverflow(getStyle(styles, 'text-overflow', 'textOverflow'));

  const maxLinesStr = getStyle(styles, '-webkit-line-clamp', 'webkitLineClamp');
  const maxLines = maxLinesStr ? parseInt(maxLinesStr, 10) : undefined;

  const textShadow = parseTextShadow(getStyle(styles, 'text-shadow', 'textShadow'));

  return {
    fontFamily: cleanFontFamily(fontFamily),
    fontSize: Math.max(fontSize, 1),
    fontWeight,
    fontStyle,
    color,
    textAlign,
    verticalAlign,
    textDecoration,
    textTransform,
    lineHeight,
    letterSpacing,
    whiteSpace,
    wordBreak,
    textOverflow: textOverflow || undefined,
    maxLines: maxLines && maxLines > 0 ? maxLines : undefined,
    textShadow: textShadow.length > 0 ? textShadow : undefined,
  };
}

/**
 * Sanitize text content for design output.
 *
 * The traverser may have already inserted \n at detected line break positions.
 * These must be preserved — they represent the browser's actual wrap points.
 * Only \r\n and \r (raw carriage returns) are normalized.
 */
export function sanitizeTextContent(text: string, whiteSpace?: string): string {
  if (!text) return '';

  // Replace zero-width characters
  let result = text.replace(/[\u200B\u200C\u200D\uFEFF]/g, '');

  // When white-space starts with 'pre', preserve newlines and whitespace
  if (whiteSpace && whiteSpace.startsWith('pre')) {
    // Normalize \r\n and \r to \n
    result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return result;
  }

  // Normalize \r\n and \r to \n, but preserve \n (inserted by traverser for line breaks)
  result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Collapse regular whitespace within each line, but preserve \u00A0 (non-breaking space)
  // The traverser uses \u00A0 to preserve leading/trailing spaces for Figma rendering
  result = result
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').replace(/^ +| +$/g, ''))
    .join('\n');

  logger.info(`[sanitizeText] in="${text.substring(0, 60)}" out="${result.substring(0, 60)}" hasLF=${result.includes('\n')}`);

  return result;
}

// ==================== Internal helpers ====================

function cleanFontFamily(fontFamily: string): string {
  // Return the first font in the stack, cleaned up
  const first = fontFamily.split(',')[0].trim().replace(/['"]/g, '');
  return first || 'sans-serif';
}

function normalizeFontStyle(value: string): TextStyleInfo['fontStyle'] {
  if (value === 'italic') return 'italic';
  if (value === 'oblique') return 'oblique';
  return 'normal';
}

function normalizeTextAlign(value: string): TextStyleInfo['textAlign'] {
  if (value === 'center') return 'center';
  if (value === 'right' || value === 'end') return 'right';
  if (value === 'justify') return 'justify';
  return 'left';
}

function normalizeTextDecoration(value: string): TextStyleInfo['textDecoration'] {
  if (!value || value === 'none') return 'none';
  if (value.includes('underline')) return 'underline';
  if (value.includes('line-through')) return 'line-through';
  if (value.includes('overline')) return 'overline';
  return 'none';
}

function normalizeTextTransform(value: string): TextStyleInfo['textTransform'] {
  if (value === 'uppercase') return 'uppercase';
  if (value === 'lowercase') return 'lowercase';
  if (value === 'capitalize') return 'capitalize';
  return 'none';
}

function normalizeTextOverflow(value: string): TextStyleInfo['textOverflow'] | undefined {
  if (value === 'ellipsis') return 'ellipsis';
  if (value === 'clip') return 'clip';
  return undefined;
}

function resolveLineHeight(value: string, fontSize: number): TextStyleInfo['lineHeight'] {
  if (!value || value === 'normal') {
    return { value: 0, unit: 'normal' };
  }
  if (value.endsWith('px')) {
    return { value: parseFloat(value), unit: 'px' };
  }
  if (value.endsWith('%')) {
    return { value: parseFloat(value), unit: '%' };
  }
  // Unitless multiplier → convert to percentage
  const multiplier = parseFloat(value);
  if (!isNaN(multiplier)) {
    return { value: multiplier * 100, unit: '%' };
  }
  return { value: 0, unit: 'normal' };
}

function resolveLetterSpacing(value: string): TextStyleInfo['letterSpacing'] {
  if (!value || value === 'normal') {
    return { value: 0, unit: 'px' };
  }
  if (value.endsWith('em')) {
    return { value: parseFloat(value), unit: 'em' };
  }
  return { value: parsePx(value), unit: 'px' };
}

function parseTextShadow(value: string): BoxShadow[] {
  if (!value || value === 'none') return [];

  // Parentheses-aware splitting (handles rgba() colors with commas)
  const shadows: BoxShadow[] = [];
  const parts = splitBackgroundLayers(value);

  for (const part of parts) {
    const tokens = part.trim().split(/\s+/);
    const lengths: number[] = [];
    let colorStr = '';

    for (const token of tokens) {
      if (token.match(/^-?[\d.]+px$/) || token.match(/^-?[\d.]+$/)) {
        lengths.push(parseFloat(token));
      } else {
        colorStr += (colorStr ? ' ' : '') + token;
      }
    }

    if (lengths.length >= 2) {
      const color = parseColor(colorStr) || { r: 0, g: 0, b: 0, a: 0.5 };
      shadows.push({
        inset: false,
        offsetX: lengths[0],
        offsetY: lengths[1],
        blurRadius: lengths[2] || 0,
        spreadRadius: 0,
        color,
      });
    }
  }

  return shadows;
}
