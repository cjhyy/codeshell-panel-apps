let _idCounter = 0;

/**
 * Generate a unique ID. Uses timestamp + counter + random for guaranteed uniqueness within a session.
 * @param prefix - Optional prefix (e.g., 'node', 'frame', 'i')
 */
export function generateId(prefix: string = 'node'): string {
  const timestamp = Date.now();
  const counter = ++_idCounter;
  const random = Math.random().toString(36).substring(2, 7);
  return `${prefix}_${timestamp}_${counter}_${random}`;
}

/**
 * Validate and normalize font name for Figma
 */
export function validateFontName(family: string, style: string): { family: string; style: string } {
  // Common font style mappings for better compatibility
  const styleMap: Record<string, string> = {
    'normal': 'Regular',
    'regular': 'Regular',
    'solid': 'Solid',
    'medium': 'Medium',
    'semibold': 'Semi Bold',
    'semi-bold': 'Semi Bold',
    'bold': 'Bold',
    'extrabold': 'Extra Bold',
    'extra-bold': 'Extra Bold',
    'light': 'Light',
    'thin': 'Thin',
    'italic': 'Italic',
    'oblique': 'Italic'
  };

  // Normalize style
  const normalizedStyle = styleMap[style.toLowerCase()] || style;

  // Ensure we have valid fallbacks
  const validStyles = ['Regular','Solid', 'Bold', 'Light', 'Medium', 'Semi Bold', 'Extra Bold', 'Italic'];
  const finalStyle = validStyles.includes(normalizedStyle) ? normalizedStyle : 'Regular';

  return {
    family: family || 'Inter',
    style: finalStyle
  };
}

/**
 * Convert pixels to Figma units (Figma uses points, but for web we keep pixels)
 */
export function pxToFigmaUnits(px: number): number {
  return Math.ceil(px);
}

/**
 * Normalize whitespace in text nodes based on parent element's white-space CSS property.
 * @param text - Raw text content
 * @param parentElement - Parent element used to read the white-space style
 * @param isFirstNode - Whether this is the first text node (for leading space handling)
 * @param isLastNode - Whether this is the last text node (for trailing space handling)
 * @returns Processed text content
 */
export function normalizeWhitespace(
  text: string,
  parentElement: Element,
  isFirstNode: boolean = false,
  isLastNode: boolean = false
): string {
  const computedStyle = window.getComputedStyle(parentElement);
  const whiteSpace = computedStyle.whiteSpace;

  switch (whiteSpace) {
    case 'pre':
      // Preserve all whitespace and line breaks
      return text;

    case 'pre-wrap':
      // Preserve all whitespace and line breaks, but allow wrapping
      return text;

    case 'pre-line':
      // Collapse whitespace but preserve line breaks
      // Merge multiple spaces/tabs into a single space
      let result = text.replace(/[ \t]+/g, ' ');
      // Remove spaces around line breaks
      result = result.replace(/[ \t]*\n[ \t]*/g, '\n');
      return result;

    case 'nowrap':
    case 'normal':
    default:
      // Collapse all consecutive whitespace (spaces, tabs, newlines) into a single space
      let normalized = text.replace(/[\s\n\r\t]+/g, ' ');

      // Record whether there's a trailing space before trimming
      const hasTrailingSpace = /\s$/.test(normalized);

      // If first node, remove leading whitespace
      if (isFirstNode) {
        normalized = normalized.replace(/^\s+/, '');
      }

      // If last node, remove trailing whitespace
      if (isLastNode) {
        normalized = normalized.replace(/\s+$/, '');
      }

      // After trimming, if there was a trailing space, add a non-breaking space
      if (hasTrailingSpace && normalized.length > 0) {
        normalized = normalized + '\u00A0';
      }

      return normalized;
  }
}
