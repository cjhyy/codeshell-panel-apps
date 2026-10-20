/**
 * Text Mapper - DesignNode text styles → Figma text properties
 */

import type { TextStyleInfo, ColorValue, RichTextSegment, BackgroundLayer } from '@html2figma/shared';
import type { FigmaTextNode, FigmaStyledTextSegment, FontName, LineHeight, LetterSpacing, Paint } from '@html2figma/shared';
import { colorToFigmaRGB, mapBackgroundToFills } from './styleMapper';

/**
 * Map text style to Figma text node properties
 */
export function mapTextStyle(textStyle: TextStyleInfo): Partial<FigmaTextNode> {
  const props: Partial<FigmaTextNode> = {};

  // Font
  props.fontName = mapFontName(textStyle.fontFamily, textStyle.fontWeight, textStyle.fontStyle);
  props.fontSize = Math.max(textStyle.fontSize, 8); // Figma minimum font size
  props.fontWeight = textStyle.fontWeight;

  // Color → fills (gradient fill takes priority over solid color)
  if (textStyle.gradientFill && textStyle.gradientFill.length > 0) {
    props.fills = mapBackgroundToFills({ layers: textStyle.gradientFill });
  } else if (textStyle.color && textStyle.color.a > 0) {
    props.fills = [{
      type: 'SOLID',
      color: colorToFigmaRGB(textStyle.color),
      opacity: textStyle.color.a,
      visible: true,
    }];
  }

  // Alignment
  props.textAlignHorizontal = mapTextAlign(textStyle.textAlign);

  // Line height
  const lineHeight = mapLineHeight(textStyle.lineHeight);
  if (lineHeight) props.lineHeight = lineHeight;

  // Letter spacing
  const letterSpacing = mapLetterSpacing(textStyle.letterSpacing, textStyle.fontSize);
  if (letterSpacing) props.letterSpacing = letterSpacing;

  // Text decoration
  props.textDecoration = mapTextDecoration(textStyle.textDecoration);

  // Text case (from CSS text-transform)
  const textCase = mapTextCase(textStyle.textTransform);
  if (textCase !== 'ORIGINAL') (props as any).textCase = textCase;

  // Text truncation: text-overflow:ellipsis or -webkit-line-clamp
  // Single-line: text-overflow:ellipsis only works with white-space:nowrap
  // (without nowrap, text wraps and never overflows horizontally → no ellipsis)
  // Multi-line: -webkit-line-clamp implies ellipsis even without explicit text-overflow
  const hasTruncation = (textStyle.textOverflow === 'ellipsis' && textStyle.whiteSpace === 'nowrap')
    || (textStyle.maxLines != null && textStyle.maxLines > 0);

  if (hasTruncation) {
    props.textTruncation = 'ENDING';
    if (textStyle.maxLines != null && textStyle.maxLines > 0) {
      props.maxLines = textStyle.maxLines;
    }
    // Fixed width required for truncation to be visible.
    // Width comes from the browser-rendered bounds set in mapText().
    props.textAutoResize = 'HEIGHT';
  } else {
    // Auto resize: let both width and height adapt to content.
    // Line breaks are explicitly inserted (\n) by the traverser,
    // so we don't rely on fixed width to force wrapping.
    props.textAutoResize = 'WIDTH_AND_HEIGHT';
  }

  return props;
}

/**
 * Map rich text segments (DesignNode) → Figma styled text segments.
 * Each segment gets its own font, color, decoration, etc.
 */
export function mapStyledSegments(
  segments: RichTextSegment[],
  baseStyle: TextStyleInfo,
): FigmaStyledTextSegment[] {
  return segments.map(seg => {
    const figmaSeg: FigmaStyledTextSegment = {
      start: seg.start,
      end: seg.end,
    };

    const style = seg.style;

    // Only emit overrides that differ from the base style
    const fontName = mapFontName(style.fontFamily, style.fontWeight, style.fontStyle);
    const baseFontName = mapFontName(baseStyle.fontFamily, baseStyle.fontWeight, baseStyle.fontStyle);
    if (fontName.family !== baseFontName.family || fontName.style !== baseFontName.style) {
      figmaSeg.fontName = fontName;
    }

    if (style.fontSize !== baseStyle.fontSize) {
      figmaSeg.fontSize = Math.max(style.fontSize, 8);
    }

    if (style.fontWeight !== baseStyle.fontWeight) {
      figmaSeg.fontWeight = style.fontWeight;
    }

    // Color (gradient fill takes priority)
    if (style.gradientFill && style.gradientFill.length > 0) {
      figmaSeg.fills = mapBackgroundToFills({ layers: style.gradientFill });
    } else if (style.color && (
      style.color.r !== baseStyle.color.r ||
      style.color.g !== baseStyle.color.g ||
      style.color.b !== baseStyle.color.b ||
      style.color.a !== baseStyle.color.a
    )) {
      figmaSeg.fills = [{
        type: 'SOLID',
        color: colorToFigmaRGB(style.color),
        opacity: style.color.a,
        visible: true,
      }];
    }

    // Decoration
    const decoration = mapTextDecoration(style.textDecoration);
    const baseDecoration = mapTextDecoration(baseStyle.textDecoration);
    if (decoration !== baseDecoration) {
      figmaSeg.textDecoration = decoration;
    }

    // Line height
    const lh = mapLineHeight(style.lineHeight);
    const baseLh = mapLineHeight(baseStyle.lineHeight);
    if (lh && (!baseLh || lh.value !== baseLh.value || lh.unit !== baseLh.unit)) {
      figmaSeg.lineHeight = lh;
    }

    // Letter spacing
    const ls = mapLetterSpacing(style.letterSpacing, style.fontSize);
    const baseLs = mapLetterSpacing(baseStyle.letterSpacing, baseStyle.fontSize);
    if (ls && (!baseLs || ls.value !== baseLs.value)) {
      figmaSeg.letterSpacing = ls;
    }

    // Hyperlink
    if (seg.href) {
      figmaSeg.hyperlink = { type: 'URL', value: seg.href };
    }

    return figmaSeg;
  });
}

/**
 * Map font family + weight + style → Figma FontName
 */
export function mapFontName(family: string, weight: number | string, style: string): FontName {
  // Clean up font family
  const cleanFamily = family.split(',')[0].trim().replace(/['"]/g, '');

  // Map generic families to safe defaults
  const familyMap: Record<string, string> = {
    'sans-serif': 'Inter',
    'serif': 'Times New Roman',
    'monospace': 'Monaco',
    'system-ui': 'Inter',
    '-apple-system': 'Inter',
  };
  const resolvedFamily = familyMap[cleanFamily.toLowerCase()] || cleanFamily || 'Inter';

  // Map weight+style to Figma style string
  const numericWeight = typeof weight === 'string' ? parseInt(weight, 10) || 400 : weight;
  const isItalic = style === 'italic' || style === 'oblique';

  // Icon fonts use non-standard style names in Figma
  const iconFontStyle = mapIconFontStyle(resolvedFamily, numericWeight);
  if (iconFontStyle) return { family: resolvedFamily, style: iconFontStyle };

  let figmaStyle = 'Regular';
  if (numericWeight >= 700) figmaStyle = isItalic ? 'Bold Italic' : 'Bold';
  else if (numericWeight >= 600) figmaStyle = isItalic ? 'Semi Bold Italic' : 'Semi Bold';
  else if (numericWeight >= 500) figmaStyle = isItalic ? 'Medium Italic' : 'Medium';
  else if (numericWeight <= 300) figmaStyle = isItalic ? 'Light Italic' : 'Light';
  else figmaStyle = isItalic ? 'Italic' : 'Regular';

  return { family: resolvedFamily, style: figmaStyle };
}

/**
 * Map icon font families to their Figma style names.
 * Icon fonts like Font Awesome use non-standard style names
 * (e.g. "Solid" instead of "Bold" for weight 900).
 */
function mapIconFontStyle(family: string, weight: number): string | undefined {
  const lf = family.toLowerCase();

  // Font Awesome 6 Free: weight 900 → Solid, weight 400 → Regular
  // Font Awesome 6 Brands: only has "Regular"
  if (lf.includes('font awesome')) {
    if (lf.includes('brands')) return 'Regular';
    if (weight >= 900) return 'Solid';
    return 'Regular';
  }

  // Material Icons / Material Symbols: always "Regular"
  if (lf.includes('material icons') || lf.includes('material symbols')) {
    return 'Regular';
  }

  return undefined;
}

function mapTextAlign(align: string): FigmaTextNode['textAlignHorizontal'] {
  switch (align) {
    case 'center': return 'CENTER';
    case 'right': return 'RIGHT';
    case 'justify': return 'JUSTIFIED';
    default: return 'LEFT';
  }
}

function mapLineHeight(lh: TextStyleInfo['lineHeight']): LineHeight | undefined {
  if (lh.unit === 'normal' || lh.value === 0) return undefined;
  if (lh.unit === 'px') return { value: lh.value, unit: 'PIXELS' };
  if (lh.unit === '%') return { value: lh.value, unit: 'PERCENT' };
  return undefined;
}

function mapLetterSpacing(ls: TextStyleInfo['letterSpacing'], fontSize: number = 16): LetterSpacing | undefined {
  if (ls.value === 0) return undefined;
  if (ls.unit === 'px') return { value: ls.value, unit: 'PIXELS' };
  // Convert em to pixels using actual fontSize
  if (ls.unit === 'em') return { value: ls.value * fontSize, unit: 'PIXELS' };
  return undefined;
}

function mapTextCase(transform: string): 'UPPER' | 'LOWER' | 'TITLE' | 'ORIGINAL' {
  switch (transform) {
    case 'uppercase': return 'UPPER';
    case 'lowercase': return 'LOWER';
    case 'capitalize': return 'TITLE';
    default: return 'ORIGINAL';
  }
}

function mapTextDecoration(dec: string): FigmaTextNode['textDecoration'] {
  switch (dec) {
    case 'underline': return 'UNDERLINE';
    case 'line-through': return 'STRIKETHROUGH';
    default: return 'NONE';
  }
}
