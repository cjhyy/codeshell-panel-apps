import { generateId, pxToFigmaUnits, normalizeWhitespace } from '@html2figma/shared/utils';
import { createLogger } from '@html2figma/shared';
import { LogModule } from '@html2figma/shared';
import type { RenderNode, TraverseOptions } from './types';
import { hasValidTextContent } from './visibility';

const logger = createLogger(LogModule.NODE_TRAVERSER);

/**
 * Remove the rotation component from a CSS computed transform matrix,
 * preserving scale and translate. Computed transform is always in
 * matrix(a,b,c,d,e,f) form for 2D transforms.
 *
 * Decomposition: scaleX = ||(a,b)||, scaleY = ||(c,d)||
 * Result: matrix(scaleX, 0, 0, scaleY, e, f)
 */
function removeRotationFromMatrix(matrixStr: string): string {
  const match = matrixStr.match(/matrix\(([^)]+)\)/);
  if (!match) return 'none'; // 3D or unparseable → fall back to full strip
  const vals = match[1].split(',').map(v => parseFloat(v.trim()));
  if (vals.length !== 6) return 'none';
  const [a, b, c, d, e, f] = vals;
  const sx = Math.sqrt(a * a + b * b);
  const sy = Math.sqrt(c * c + d * d);
  // Preserve axis flip (negative determinant)
  const det = a * d - b * c;
  const adjustedSy = det < 0 ? -sy : sy;
  return `matrix(${sx}, 0, 0, ${adjustedSy}, ${e}, ${f})`;
}

/**
 * Compute cumulative scale factor from all transformed ancestors.
 * Used to scale text font-size when inside a scaled container.
 */
export function computeAncestorScale(element: Element | null): { x: number; y: number } {
  let sx = 1, sy = 1;
  let el = element;
  while (el) {
    const t = window.getComputedStyle(el).transform;
    if (t && t !== 'none') {
      const match = t.match(/matrix\(([^)]+)\)/);
      if (match) {
        const vals = match[1].split(',').map(v => parseFloat(v.trim()));
        if (vals.length === 6) {
          sx *= Math.sqrt(vals[0] ** 2 + vals[1] ** 2);
          sy *= Math.sqrt(vals[2] ** 2 + vals[3] ** 2);
        }
      }
    }
    el = el.parentElement;
  }
  return { x: sx, y: sy };
}

/**
 * Get a rotation-free bounding rect for a Range.
 * Temporarily removes only the rotation component from ancestor transforms
 * (preserving scale + translate) so that text measurements are not distorted
 * by rotation (which causes false line breaks), while still reflecting scale.
 */
function getUntransformedRangeRect(range: Range, textNode: Text): DOMRect {
  let ancestor = textNode.parentElement;
  const saved: Array<{ el: HTMLElement; value: string }> = [];
  while (ancestor) {
    const t = window.getComputedStyle(ancestor).transform;
    if (t && t !== 'none') {
      saved.push({ el: ancestor, value: ancestor.style.transform });
      ancestor.style.transform = removeRotationFromMatrix(t);
    }
    ancestor = ancestor.parentElement;
  }

  // Force layout reflow so the browser recalculates without rotation
  if (saved.length > 0) {
    void (saved[0].el as HTMLElement).offsetHeight;
  }

  const rect = range.getBoundingClientRect();

  // Restore transforms
  for (const s of saved) {
    s.el.style.transform = s.value;
  }

  return rect;
}

/**
 * Text segment info (after splitting by line breaks).
 */
export interface TextSegment {
  /** Text content */
  text: string;
  /** Relative x coordinate */
  x: number;
  /** Relative y coordinate */
  y: number;
  /** Width */
  width: number;
  /** Height */
  height: number;
  /** Start index in the original text */
  startIndex: number;
  /** End index in the original text */
  endIndex: number;
}

/**
 * Text node metadata.
 */
export interface TextNodeMetadata {
  /** Text node reference */
  textNode: Text;
  /** Original text content */
  originalText: string;
  /** Normalized text */
  normalizedText: string;
  /** Parent element */
  parentElement: Element;
  /** Parent element computed style */
  parentComputedStyle: CSSStyleDeclaration;
  /** Text node bounding rect */
  boundingRect: DOMRect;
  /** Whether this is the first text node */
  isFirstTextNode: boolean;
  /** Whether this is the last text node */
  isLastTextNode: boolean;
}

/**
 * Parse lineHeight to pixel value.
 * @param lineHeight - lineHeight string value
 * @param computedStyle - Computed style object (to read fontSize)
 * @returns Parsed pixel value, or 0 if unparseable
 */
export function parseLineHeight(lineHeight: string, computedStyle: CSSStyleDeclaration): number {
  if (!lineHeight || lineHeight === 'normal') {
    // "normal" is typically 1.2x the font size
    const fontSize = parseFloat(computedStyle.fontSize) || 16;
    return fontSize * 1.2;
  }

  const lineHeightValue = parseFloat(lineHeight);

  if (isNaN(lineHeightValue)) {
    return 0;
  }

  // px unit
  if (lineHeight.includes('px')) {
    return lineHeightValue;
  }

  // percentage (relative to font size)
  if (lineHeight.includes('%')) {
    const fontSize = parseFloat(computedStyle.fontSize) || 16;
    return (lineHeightValue / 100) * fontSize;
  }

  // unitless number (multiplier of font size)
  if (!isNaN(lineHeightValue) && lineHeight === String(lineHeightValue)) {
    const fontSize = parseFloat(computedStyle.fontSize) || 16;
    return lineHeightValue * fontSize;
  }

  // em unit
  if (lineHeight.includes('em')) {
    const fontSize = parseFloat(computedStyle.fontSize) || 16;
    return lineHeightValue * fontSize;
  }

  // rem unit (relative to root element font size)
  if (lineHeight.includes('rem')) {
    const rootFontSize = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
    return lineHeightValue * rootFontSize;
  }

  return 0;
}

/**
 * Create a CSSStyleDeclaration for a text node: inherits parent styles but
 * resets position to "static". Text nodes don't participate in CSS positioning
 * and should not be treated as positioned elements.
 */
export function createTextNodeStyle(parentStyle: CSSStyleDeclaration): CSSStyleDeclaration {
  // Use a Proxy to delegate to the original style object,
  // ensuring all property accesses work correctly.
  const handler: ProxyHandler<CSSStyleDeclaration> = {
    get(target: CSSStyleDeclaration, prop: string | symbol): any {
      // Intercept position property — force "static"
      if (prop === 'position') {
        return 'static';
      }

      // Intercept getPropertyValue method
      if (prop === 'getPropertyValue') {
        return (propertyName: string) => {
          if (propertyName === 'position') {
            return 'static';
          }
          return target.getPropertyValue(propertyName);
        };
      }

      // Delegate everything else to the original style object
      const value = (target as any)[prop];

      // Bind methods to the correct this context
      if (typeof value === 'function') {
        return value.bind(target);
      }

      return value;
    }
  };

  return new Proxy(parentStyle, handler);
}

/**
 * Create an inline-block CSSStyleDeclaration wrapper.
 * @param baseStyle - Base style
 * @param height - Height in pixels
 * @param lineHeight - Line height value
 * @param textAlign - Text alignment
 */
export function createInlineBlockStyle(
  baseStyle: CSSStyleDeclaration,
  height?: number,
  lineHeight?: string,
  textAlign?: string
): CSSStyleDeclaration {
  // Use a Proxy to delegate to the original style object,
  // ensuring all property accesses work correctly.
  const handler: ProxyHandler<CSSStyleDeclaration> = {
    get(target: CSSStyleDeclaration, prop: string | symbol): any {
      // Intercept display — force "inline-block"
      if (prop === 'display') {
        return 'inline-block';
      }

      // Intercept position — force "static"
      if (prop === 'position') {
        return 'static';
      }

      // Intercept height
      if (prop === 'height' && height !== undefined) {
        return `${height}px`;
      }

      // Intercept lineHeight
      if (prop === 'lineHeight' && lineHeight !== undefined) {
        return lineHeight;
      }

      // Intercept textAlign
      if (prop === 'textAlign' && textAlign !== undefined) {
        return textAlign;
      }

      // Intercept getPropertyValue method
      if (prop === 'getPropertyValue') {
        return (propertyName: string) => {
          if (propertyName === 'display') {
            return 'inline-block';
          }
          if (propertyName === 'position') {
            return 'static';
          }
          if (propertyName === 'height' && height !== undefined) {
            return `${height}px`;
          }
          if (propertyName === 'line-height' && lineHeight !== undefined) {
            return lineHeight;
          }
          if (propertyName === 'text-align' && textAlign !== undefined) {
            return textAlign;
          }
          return target.getPropertyValue(propertyName);
        };
      }

      // Delegate everything else to the original style object
      const value = (target as any)[prop];

      // Bind methods to the correct this context
      if (typeof value === 'function') {
        return value.bind(target);
      }

      return value;
    }
  };

  return new Proxy(baseStyle, handler);
}

/**
 * Detect line breaks and build an index mapping from original text to normalized text.
 * Uses character position aggregation for accurate browser rendering match.
 * @param textNode - Text node
 * @param originalText - Original text content
 * @param normalizedText - Normalized text content
 * @returns Array of line break indices (based on normalized text)
 */
export function detectLineBreaksWithMapping(
  textNode: Text,
  originalText: string,
  normalizedText: string
): number[] {
  if (!normalizedText || normalizedText.length === 0) {
    return [];
  }

  // Get the parent element's white-space property
  const whiteSpace = window.getComputedStyle(textNode.parentElement!).whiteSpace;

  // For pre or pre-wrap, no mapping needed — use normalized text directly
  if (whiteSpace === 'pre' || whiteSpace === 'pre-wrap') {
    return detectLineBreaks(textNode, normalizedText);
  }

  // If original and normalized text are identical, detect directly
  if (originalText === normalizedText) {
    return detectLineBreaks(textNode, normalizedText);
  }

  // 1. Detect line breaks on the original text (actual browser rendering positions)
  const lines = aggregateTextLinesByCharPosition(textNode, originalText);

  if (lines.length <= 1) {
    return [];
  }

  // 2. Build index mapping: originalIndex -> normalizedIndex
  // Simulates normalizeWhitespace behavior:
  // - Leading/trailing whitespace is trimmed
  // - Consecutive inner whitespace is collapsed to a single space
  const indexMap: Map<number, number> = new Map();
  let normalizedIdx = 0;
  let inWhitespace = false;
  let hasSeenNonWhitespace = false;

  for (let i = 0; i < originalText.length; i++) {
    const char = originalText[i];
    const isWhitespace = /[\s\n\r\t]/.test(char);

    if (isWhitespace) {
      if (!hasSeenNonWhitespace) {
        // Leading whitespace: skip (will be trimmed)
        continue;
      }

      if (!inWhitespace) {
        // First whitespace in a sequence: map to the collapsed space
        indexMap.set(i, normalizedIdx);
        normalizedIdx++;
        inWhitespace = true;
      } else {
        // Subsequent whitespace: map to the same collapsed space position
        indexMap.set(i, normalizedIdx - 1);
      }
    } else {
      // Non-whitespace character
      hasSeenNonWhitespace = true;
      indexMap.set(i, normalizedIdx);
      normalizedIdx++;
      inWhitespace = false;
    }
  }

  // 3. Map each line's start position (original index) to normalized index
  const lineBreaks: number[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    // Find the first non-whitespace character in this line (original index)
    let firstNonWhitespaceIdx = line.startIndex;
    for (let j = line.startIndex; j < line.endIndex; j++) {
      if (!/[\s\n\r\t]/.test(originalText[j])) {
        firstNonWhitespaceIdx = j;
        break;
      }
    }

    const normalizedBreakPos = indexMap.get(firstNonWhitespaceIdx);

    if (normalizedBreakPos !== undefined) {
      // Avoid duplicate entries
      if (lineBreaks.length === 0 || lineBreaks[lineBreaks.length - 1] !== normalizedBreakPos) {
        lineBreaks.push(normalizedBreakPos);
      }
    }
  }

  return lineBreaks.sort((a, b) => a - b);
}

/**
 * Character position info.
 */
interface CharPosition {
  char: string;
  index: number;
  rect: DOMRect;
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/**
 * Text line info.
 */
interface TextLine {
  /** Line text content */
  text: string;
  /** Start index */
  startIndex: number;
  /** End index */
  endIndex: number;
  /** Top position (absolute coordinates) */
  top: number;
  /** Bottom position (absolute coordinates) */
  bottom: number;
  /** Left position (absolute coordinates) */
  left: number;
  /** Right position (absolute coordinates) */
  right: number;
  /** Line width */
  width: number;
  /** Line height */
  height: number;
}

/**
 * Compute each character's actual rendered position and aggregate by line.
 * @param textNode - Text node
 * @param text - Text content
 * @returns Array of text lines with content and position info
 */
export function aggregateTextLinesByCharPosition(
  textNode: Text,
  text: string
): TextLine[] {
  if (!text || text.length === 0) {
    return [];
  }

  const range = document.createRange();
  const charPositions: CharPosition[] = [];

  try {
    // Check once whether any ancestor has a transform
    let hasTransformedAncestor = false;
    let el = textNode.parentElement;
    while (el) {
      const t = window.getComputedStyle(el).transform;
      if (t && t !== 'none') { hasTransformedAncestor = true; break; }
      el = el.parentElement;
    }

    // If transforms exist, temporarily strip rotation (preserve scale+translate)
    const saved: Array<{ el: HTMLElement; value: string }> = [];
    if (hasTransformedAncestor) {
      let anc = textNode.parentElement;
      while (anc) {
        const t = window.getComputedStyle(anc).transform;
        if (t && t !== 'none') {
          saved.push({ el: anc, value: anc.style.transform });
          anc.style.transform = removeRotationFromMatrix(t);
        }
        anc = anc.parentElement;
      }
      // Force reflow
      void saved[0].el.offsetHeight;
    }

    // 1. Collect position info for each character
    for (let i = 0; i < text.length; i++) {
      range.setStart(textNode, i);
      range.setEnd(textNode, i + 1);

      const rect = range.getBoundingClientRect();

      // Skip invalid rects (whitespace chars may have zero dimensions)
      if (rect.width === 0 && rect.height === 0) {
        continue;
      }

      charPositions.push({
        char: text[i],
        index: i,
        rect: rect,
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right
      });
    }

    // Restore transforms
    for (const s of saved) {
      s.el.style.transform = s.value;
    }

    if (charPositions.length === 0) {
      return [];
    }

    // 2. Group characters into lines by y-coordinate (top)
    const lines: TextLine[] = [];
    let currentLine: CharPosition[] = [];
    let currentLineTop = charPositions[0].top;

    for (const charPos of charPositions) {
      // Detect line break: current char's top is significantly below the current line's top
      const isNewLine = Math.abs(charPos.top - currentLineTop) > 2;

      if (isNewLine && currentLine.length > 0) {
        // Finalize the current line
        lines.push(createLineFromChars(currentLine, text));

        // Start a new line
        currentLine = [charPos];
        currentLineTop = charPos.top;
      } else {
        // Add to current line
        currentLine.push(charPos);
      }
    }

    // Add the last line
    if (currentLine.length > 0) {
      lines.push(createLineFromChars(currentLine, text));
    }

    return lines;

  } finally {
    range.detach();
  }
}

/**
 * Create a TextLine from an array of character positions.
 */
function createLineFromChars(chars: CharPosition[], fullText: string): TextLine {
  const startIndex = chars[0].index;
  const endIndex = chars[chars.length - 1].index + 1;

  // Extract from the original text for accuracy
  const lineText = fullText.substring(startIndex, endIndex);

  // Compute line bounds
  const top = Math.min(...chars.map(c => c.top));
  const bottom = Math.max(...chars.map(c => c.bottom));
  const left = Math.min(...chars.map(c => c.left));
  const right = Math.max(...chars.map(c => c.right));

  const width = right - left;
  const height = bottom - top;

  return {
    text: lineText,
    startIndex,
    endIndex,
    top,
    bottom,
    left,
    right,
    width,
    height
  };
}

/**
 * Detect line break positions in rendered text (for non-normalized text).
 * Uses character position aggregation for accurate browser rendering match.
 * @param textNode - Text node
 * @param text - Text content
 * @returns Array of line break indices (character indices)
 */
export function detectLineBreaks(textNode: Text, text: string): number[] {
  const lines = aggregateTextLinesByCharPosition(textNode, text);

  if (lines.length <= 1) {
    return [];
  }

  // Extract the start position of each line (except the first) as break points
  const lineBreaks: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    lineBreaks.push(lines[i].startIndex);
  }

  return lineBreaks;
}

/**
 * Insert line break characters into text at the specified positions.
 * @param text - Original text
 * @param lineBreaks - Array of break positions
 * @returns Text with line breaks inserted
 */
export function insertLineBreaks(text: string, lineBreaks: number[]): string {
  if (lineBreaks.length === 0) {
    return text;
  }

  let result = '';
  let lastIndex = 0;

  for (const breakIndex of lineBreaks) {
    result += text.substring(lastIndex, breakIndex) + '\n';
    lastIndex = breakIndex;
  }

  result += text.substring(lastIndex);
  return result;
}

/**
 * Split text by line break positions and compute accurate position info for each segment.
 * @param textNode - Text node
 * @param text - Text content
 * @param lineBreaks - Array of break positions (character indices)
 * @param parentRect - Parent element bounding rect (for relative positioning)
 * @returns Array of text segments with text, position, and size info
 */
export function splitTextIntoSegments(
  textNode: Text,
  text: string,
  lineBreaks: number[],
  parentRect?: DOMRect
): TextSegment[] {
  if (!text || text.length === 0) {
    return [];
  }

  const segments: TextSegment[] = [];
  const range = document.createRange();

  try {
    // No line breaks — the entire text is a single segment
    if (lineBreaks.length === 0) {
      range.selectNodeContents(textNode);
      const rect = getUntransformedRangeRect(range, textNode);

      segments.push({
        text,
        x: rect.left,  // Absolute coordinates (relative to viewport)
        y: rect.top,    // Absolute coordinates (relative to viewport)
        width: rect.width,
        height: rect.height,
        startIndex: 0,
        endIndex: text.length
      });

      return segments;
    }

    // Split by line breaks
    let startIndex = 0;
    const breakPoints = [...lineBreaks, text.length]; // Add text end as final break point

    for (const endIndex of breakPoints) {
      if (startIndex >= endIndex) {
        startIndex = endIndex;
        continue;
      }

      const segmentText = text.substring(startIndex, endIndex);

      // Skip empty segments
      if (segmentText.trim().length === 0) {
        startIndex = endIndex;
        continue;
      }

      // Use Range API to get accurate position for this segment
      range.setStart(textNode, startIndex);
      range.setEnd(textNode, endIndex);
      const rect = getUntransformedRangeRect(range, textNode);

      // Skip invalid rects
      if (rect.width > 0 && rect.height > 0) {
        segments.push({
          text: segmentText,
          x: rect.left,  // Absolute coordinates (relative to viewport)
          y: rect.top,    // Absolute coordinates (relative to viewport)
          width: rect.width,
          height: rect.height,
          startIndex,
          endIndex
        });
      }

      startIndex = endIndex;
    }
  } finally {
    range.detach();
  }

  return segments;
}

/**
 * Analyze a text node and create metadata.
 * @param textNode - Text node
 * @param parentElement - Parent element (for style inheritance)
 * @param parentComputedStyle - Parent element computed style
 * @returns Text node metadata, or null if the text is empty
 */
export function analyzeTextNode(
  textNode: Text,
  parentElement: Element,
  parentComputedStyle: CSSStyleDeclaration
): TextNodeMetadata | null {
  const textContent = textNode.textContent || '';

  // Apply whitespace normalization
  // Determine whether this text node is at the very start/end of the parent's children.
  // Use position among ALL child nodes (not just text nodes) because preceding/following
  // element siblings (e.g. <img>) mean the text is NOT at the line start/end,
  // and inter-element whitespace should be preserved.
  const siblings = Array.from(parentElement.childNodes);
  const nodeIndex = siblings.indexOf(textNode);
  const isFirstTextNode = nodeIndex === 0;
  const isLastTextNode = nodeIndex === siblings.length - 1;

  // In flex/grid containers, inter-item whitespace is ignored by the browser.
  // Also, if the next sibling is a block-level element, the trailing space
  // before it is never rendered. In both cases, treat this text node as
  // effectively "last" so normalizeWhitespace doesn't inject a trailing NBSP.
  const parentDisplay = window.getComputedStyle(parentElement).display;
  const parentIsFlexOrGrid =
    parentDisplay === 'flex' || parentDisplay === 'inline-flex' ||
    parentDisplay === 'grid' || parentDisplay === 'inline-grid';

  const nextSiblingNode = nodeIndex < siblings.length - 1 ? siblings[nodeIndex + 1] : null;
  const nextSiblingIsBlock =
    !parentIsFlexOrGrid &&
    nextSiblingNode?.nodeType === Node.ELEMENT_NODE
      ? (() => {
          const d = window.getComputedStyle(nextSiblingNode as Element).display;
          return d === 'block' || d === 'flex' || d === 'grid' ||
                 d === 'inline-flex' || d === 'inline-grid' || d === 'table';
        })()
      : false;

  const effectiveIsLast = isLastTextNode || parentIsFlexOrGrid || nextSiblingIsBlock;

  const normalizedText = normalizeWhitespace(
    textContent,
    parentElement,
    isFirstTextNode,
    effectiveIsLast
  );

  // Skip if the normalized text is empty
  if (normalizedText === '') {
    return null;
  }

  // Use Range API to get the text node's true bounding rect (untransformed)
  const range = document.createRange();
  range.selectNodeContents(textNode);
  const boundingRect = getUntransformedRangeRect(range, textNode);
  range.detach();

  // Skip if the text node has no dimensions (likely invisible)
  if (boundingRect.width <= 0 || boundingRect.height <= 0) {
    return null;
  }

  return {
    textNode,
    originalText: textContent,
    normalizedText,
    parentElement,
    parentComputedStyle,
    boundingRect,
    isFirstTextNode,
    isLastTextNode
  };
}

/**
 * Replace leading and trailing regular spaces with non-breaking spaces.
 * Figma automatically trims leading/trailing regular spaces, so we use
 * \u00A0 (non-breaking space) to preserve them.
 *
 * @param text - Text content
 * @returns Text with leading/trailing spaces replaced
 */
function replaceLeadingTrailingSpaces(text: string): string {
  if (!text) return text;

  // Replace leading regular spaces with non-breaking spaces
  let result = text.replace(/^( +)/, (match) => '\u00A0'.repeat(match.length));

  // Replace trailing regular spaces with non-breaking spaces
  result = result.replace(/( +)$/, (match) => '\u00A0'.repeat(match.length));

  return result;
}

/**
 * Map normalized text indices back to original text indices.
 *
 * @param normalizedText - Normalized text
 * @param originalText - Original text
 * @param normalizedIndices - Indices based on normalizedText
 * @returns Corresponding originalText indices
 */
function mapNormalizedToOriginalIndices(
  normalizedText: string,
  originalText: string,
  normalizedIndices: number[]
): number[] {
  // Build a normalizedIndex -> originalIndex mapping table
  const indexMap = new Map<number, number>();

  let normalizedPos = 0;
  let inWhitespace = false;

  for (let originalPos = 0; originalPos < originalText.length; originalPos++) {
    const char = originalText[originalPos];
    const isWhitespace = /\s/.test(char);

    if (isWhitespace) {
      if (!inWhitespace) {
        // First whitespace char — map to the normalized position
        if (normalizedPos < normalizedText.length && /\s/.test(normalizedText[normalizedPos])) {
          indexMap.set(normalizedPos, originalPos);
          normalizedPos++;
        }
        inWhitespace = true;
      }
      // Subsequent whitespace chars are skipped (collapsed in normalized text)
    } else {
      // Non-whitespace character
      indexMap.set(normalizedPos, originalPos);
      normalizedPos++;
      inWhitespace = false;
    }
  }

  // Map the end position (text end)
  indexMap.set(normalizedText.length, originalText.length);

  // Convert normalized indices to original indices
  return normalizedIndices.map(normalizedIdx => {
    const originalIdx = indexMap.get(normalizedIdx);
    if (originalIdx === undefined) {
      logger.warn('[mapNormalizedToOriginalIndices] Unable to map index:', normalizedIdx);
      return normalizedIdx; // fallback
    }
    return originalIdx;
  });
}

/**
 * Preprocess a text node: detect line breaks and either split or insert newlines.
 * @param metadata - Text node metadata
 * @param mode - Processing mode: 'split' splits into segments, 'insert' inserts newline characters
 * @returns For 'split' mode: array of text segments. For 'insert' mode: text with newlines inserted.
 */
export function preprocessTextNode(
  metadata: TextNodeMetadata,
  mode: 'split'
): TextSegment[];
export function preprocessTextNode(
  metadata: TextNodeMetadata,
  mode: 'insert'
): string;
export function preprocessTextNode(
  metadata: TextNodeMetadata,
  mode: 'split' | 'insert'
): TextSegment[] | string {
  const { textNode, originalText, normalizedText, parentElement } = metadata;

  // For white-space: pre/pre-wrap, the text already has correct \n characters.
  // Skip line break detection to avoid inserting duplicate newlines.
  const parentStyle = parentElement
    ? window.getComputedStyle(parentElement)
    : null;
  const whiteSpace = parentStyle?.whiteSpace || '';
  if (whiteSpace && whiteSpace.startsWith('pre')) {
    if (mode === 'insert') {
      return replaceLeadingTrailingSpaces(normalizedText);
    }
    // Split mode for pre-formatted text: fall through to normal detection
    // (segments need positioning data from Range API)
  }

  // For writing-mode: vertical-*, skip line break detection.
  // The browser renders characters stacked vertically — each character is at a different Y,
  // so detectLineBreaks sees every character as a separate "line". But in Figma we use
  // a rotated frame, so the text should stay as a single horizontal line.
  const writingMode = parentStyle?.writingMode || '';
  if (writingMode === 'vertical-rl' || writingMode === 'vertical-lr') {
    if (mode === 'insert') {
      return replaceLeadingTrailingSpaces(normalizedText);
    }
  }

  // Detect line breaks and build index mapping
  const lineBreaks = detectLineBreaksWithMapping(textNode, originalText, normalizedText);
  logger.info(`[Text] lineBreaks detected: [${lineBreaks.join(',')}] for "${normalizedText.substring(0, 60)}"`);

  if (mode === 'insert') {
    // Insert newline mode: return text with newlines inserted
    let result = lineBreaks.length > 0
      ? insertLineBreaks(normalizedText, lineBreaks)
      : normalizedText;

    // Replace leading/trailing spaces with non-breaking spaces
    result = replaceLeadingTrailingSpaces(result);

    return result;
  } else {
    // Split mode: return array of text segments
    const parentRect = parentElement.getBoundingClientRect();

    // Use originalText (not normalizedText) because range.setStart/setEnd
    // operates on textNode.textContent (i.e., originalText).
    // The lineBreaks need to be mapped back to originalText indices.
    const originalLineBreaks = mapNormalizedToOriginalIndices(normalizedText, originalText, lineBreaks);

    // Use originalText and originalLineBreaks for correct positioning
    const segments = splitTextIntoSegments(textNode, originalText, originalLineBreaks, parentRect);

    // Replace segment text with normalized text
    // lineBreaks are break positions based on normalizedText
    const normalizedSegments = segments.map((segment, index) => {
      // Compute this segment's start/end in normalizedText
      const normalizedStart = index === 0 ? 0 : lineBreaks[index - 1];
      const normalizedEnd = index < lineBreaks.length ? lineBreaks[index] : normalizedText.length;

      // Don't trim — preserve original spaces
      let normalizedSegmentText = normalizedText.substring(normalizedStart, normalizedEnd);

      // Replace leading/trailing regular spaces with non-breaking spaces
      // so that Figma will render them
      normalizedSegmentText = replaceLeadingTrailingSpaces(normalizedSegmentText);

      return {
        ...segment,
        text: normalizedSegmentText, // Use processed text
        startIndex: normalizedStart,
        endIndex: normalizedEnd
      };
    });

    return normalizedSegments;
  }
}

/**
 * Check whether the parent element contains multiple inline elements.
 * @param parentElement - Parent element
 * @returns Whether there are multiple inline elements (inline or inline-block)
 */
export function hasMultipleInlineElements(parentElement: Element): boolean {
  const children = Array.from(parentElement.childNodes);
  let inlineElementCount = 0;

  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const style = window.getComputedStyle(child as Element);
      const display = style.display;

      // Count inline, inline-block, inline-flex elements
      if (display === 'inline' || display === 'inline-block' || display === 'inline-flex') {
        inlineElementCount++;
        if (inlineElementCount > 1) {
          return true;
        }
      }
    } else if (child.nodeType === Node.TEXT_NODE) {
      // Text nodes also count as inline elements
      const textContent = child.textContent || '';
      if (textContent.trim().length > 0) {
        inlineElementCount++;
        if (inlineElementCount > 1) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Traverse a text node (with automatic preprocessing).
 * Rules:
 * - If parent has only a single text node with line breaks -> insert newline characters
 * - If parent has multiple inline elements -> split into multiple segments
 */
export function traverseTextNode(
  textNode: Text,
  depth: number,
  options: Required<Omit<TraverseOptions, 'filter' | 'extractMetadata'>> & Pick<TraverseOptions, 'filter' | 'extractMetadata'> & { enableTextPreprocess?: boolean }
): RenderNode | RenderNode[] | null {
  // Check whether text nodes should be included
  if (!options.includeTextNodes) {
    return null;
  }

  // Check depth limit
  if (depth > options.maxDepth) {
    return null;
  }

  // Apply custom filter
  if (options.filter && !options.filter(textNode, depth)) {
    return null;
  }

  // Check if text content is valid
  if (!hasValidTextContent(textNode, options.preserveWhitespace)) {
    return null;
  }

  // Get parent element's computed style (for text-related styles)
  let computedStyle: CSSStyleDeclaration | undefined;
  if (!textNode.parentElement) {
    return null;
  }

  computedStyle = window.getComputedStyle(textNode.parentElement);

  // Compute cumulative ancestor scale for text nodes inside scaled containers.
  // This is stored on metadata so buildTextNode can scale font-size accordingly.
  const ancestorScale = computeAncestorScale(textNode.parentElement);
  const hasAncestorScale = Math.abs(ancestorScale.x - 1) > 0.001 || Math.abs(ancestorScale.y - 1) > 0.001;

  // Text preprocessing (enabled by default)
  const enablePreprocess = options.enableTextPreprocess !== false;

  if (enablePreprocess) {
    // Analyze text node
    const metadata = analyzeTextNode(textNode, textNode.parentElement, computedStyle);

    if (!metadata) {
      return null;
    }

    // Auto-detect which mode to use
    // Rule: check if parent has multiple inline elements
    const hasMultipleInlines = hasMultipleInlineElements(textNode.parentElement);
    const preprocessMode = hasMultipleInlines ? 'split' : 'insert';

    logger.info(`[Text] mode=${preprocessMode} parent=<${textNode.parentElement.tagName.toLowerCase()}> original="${metadata.originalText.substring(0, 60)}" normalized="${metadata.normalizedText.substring(0, 60)}"`);

    if (preprocessMode === 'insert') {
      // Insert newline mode: modify text content, return a single node
      const processedText = preprocessTextNode(metadata, 'insert');
      logger.info(`[Text] insert result: "${processedText.substring(0, 80)}" hasLineBreaks=${processedText.includes('\n')}`);

      // Get bounding rect for the text node using Range (untransformed)
      let boundingRect: DOMRect | undefined;
      try {
        const range = document.createRange();
        range.selectNodeContents(textNode);
        boundingRect = getUntransformedRangeRect(range, textNode);
      } catch (e) {
        logger.warn('Unable to get text boundingRect, using parent element:', e);
        if (textNode.parentElement) {
          boundingRect = textNode.parentElement.getBoundingClientRect();
        }
      }

      const renderNode: RenderNode = {
        nodeType: 'text',
        textContent: processedText,
        boundingRect: boundingRect,
        children: [],
        domNode: textNode,
        visible: true,
        computedStyle: computedStyle,
      };

      // Extract custom metadata
      if (options.extractMetadata) {
        renderNode.metadata = options.extractMetadata(textNode);
      }

      // Attach ancestor scale for font-size scaling in buildTextNode
      if (hasAncestorScale) {
        renderNode.metadata = { ...renderNode.metadata, ancestorScale };
      }

      return renderNode;
    } else {
      // Split mode: return multiple nodes, one per text segment
      const segments = preprocessTextNode(metadata, 'split');
      logger.info(`[Text] split result: ${segments.length} segments`, segments.map(s => ({ text: s.text.substring(0, 40), x: s.x, y: s.y, w: s.width, h: s.height })));

      if (segments.length === 0) {
        return null;
      }

      // Create a render node for each segment
      const renderNodes: RenderNode[] = segments.map((segment, index) => {
        // Create a virtual DOMRect for each segment
        const segmentRect: DOMRect = {
          x: segment.x,
          y: segment.y,
          width: segment.width,
          height: segment.height,
          left: segment.x,
          top: segment.y,
          right: segment.x + segment.width,
          bottom: segment.y + segment.height,
          toJSON: () => ({})
        } as DOMRect;

        // Check if this is the last segment
        const isLastSegment = index === segments.length - 1;

        const renderNode: RenderNode = {
          nodeType: 'text',
          textContent: segment.text,
          boundingRect: segmentRect,
          children: [],
          domNode: textNode,
          visible: true,
          computedStyle: computedStyle,
          metadata: {
            segmentIndex: index,
            totalSegments: segments.length,
            startIndex: segment.startIndex,
            endIndex: segment.endIndex,
            isTextSegment: true,
            hasLineBreakAfter: !isLastSegment, // All segments except the last have a line break after
            ...(hasAncestorScale ? { ancestorScale } : {}),
          }
        };

        // Merge user-defined metadata
        if (options.extractMetadata) {
          const userMetadata = options.extractMetadata(textNode);
          if (userMetadata) {
            renderNode.metadata = { ...renderNode.metadata, ...userMetadata };
          }
        }

        return renderNode;
      });

      return renderNodes;
    }
  }

  // Preprocessing disabled: no preprocessing applied
  // Get bounding rect for the text node (untransformed)
  let boundingRect: DOMRect | undefined;
  try {
    const range = document.createRange();
    range.selectNodeContents(textNode);
    boundingRect = getUntransformedRangeRect(range, textNode);
  } catch (e) {
    logger.warn('Unable to get boundingRect, using parent element:', e);
    if (textNode.parentElement) {
      boundingRect = textNode.parentElement.getBoundingClientRect();
    }
  }

  const renderNode: RenderNode = {
    nodeType: 'text',
    textContent: textNode.textContent || '',
    boundingRect: boundingRect,
    children: [],
    domNode: textNode,
    visible: true,
    computedStyle: computedStyle,
  };

  // Extract custom metadata
  if (options.extractMetadata) {
    renderNode.metadata = options.extractMetadata(textNode);
  }

  // Attach ancestor scale for font-size scaling in buildTextNode
  if (hasAncestorScale) {
    renderNode.metadata = { ...renderNode.metadata, ancestorScale };
  }

  return renderNode;
}
