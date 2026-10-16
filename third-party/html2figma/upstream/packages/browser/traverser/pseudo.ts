/**
 * Pseudo-element capture for DOM traversal.
 * Extracts ::before, ::after, and ::marker pseudo-elements as synthetic RenderNodes.
 */

import type { RenderNode } from './types';

/**
 * Capture a ::before or ::after pseudo-element as a synthetic RenderNode.
 * Returns null if the pseudo-element doesn't exist or has no content.
 */
export function capturePseudoElement(element: Element, pseudo: '::before' | '::after'): RenderNode | null {
  try {
    const style = window.getComputedStyle(element, pseudo);
    const content = style.getPropertyValue('content');

    // No content or no pseudo-element
    if (!content || content === 'none' || content === 'normal') return null;

    // Check if pseudo-element is visible
    const display = style.getPropertyValue('display');
    if (display === 'none') return null;

    // Extract text content from CSS content value (strip quotes)
    let textContent = '';
    if (content.startsWith('"') && content.endsWith('"')) {
      textContent = content.slice(1, -1);
    } else if (content.startsWith("'") && content.endsWith("'")) {
      textContent = content.slice(1, -1);
    }
    // url() content → not text
    const isUrlContent = content.includes('url(');

    // Get bounds from parent element as basis
    const parentRect = element.getBoundingClientRect();

    // For pseudo-elements we can't get exact bounds via getBoundingClientRect.
    // Compute position from CSS positioning properties (top/right/bottom/left)
    // relative to the parent's bounding box.
    const rawWidth = style.getPropertyValue('width');
    const rawHeight = style.getPropertyValue('height');
    const width = parseFloat(rawWidth) || 0;
    const height = parseFloat(rawHeight) || 0;
    // Only fallback to parent dimensions when width/height is 'auto' (not explicitly 0).
    // CSS like `width: 0` (e.g. hover ::after with transition) must stay 0.
    const hasExplicitWidth = rawWidth && rawWidth !== 'auto' && rawWidth !== 'none';
    const hasExplicitHeight = rawHeight && rawHeight !== 'auto' && rawHeight !== 'none';
    const w = hasExplicitWidth ? width : (width || parentRect.width);
    const h = hasExplicitHeight ? height : (height || parentRect.height);

    const position = style.getPropertyValue('position');
    let x = parentRect.left;
    let y = parentRect.top;

    if (position === 'absolute' || position === 'fixed') {
      const cssTop = style.getPropertyValue('top');
      const cssBottom = style.getPropertyValue('bottom');
      const cssLeft = style.getPropertyValue('left');
      const cssRight = style.getPropertyValue('right');

      // Horizontal positioning
      if (cssLeft && cssLeft !== 'auto') {
        x = parentRect.left + parseFloat(cssLeft);
      } else if (cssRight && cssRight !== 'auto') {
        x = parentRect.right - parseFloat(cssRight) - w;
      }

      // Vertical positioning
      if (cssTop && cssTop !== 'auto') {
        y = parentRect.top + parseFloat(cssTop);
      } else if (cssBottom && cssBottom !== 'auto') {
        y = parentRect.bottom - parseFloat(cssBottom) - h;
      }
    }

    const pseudoRect: DOMRect = {
      x,
      y,
      width: w,
      height: h,
      left: x,
      top: y,
      right: x + w,
      bottom: y + h,
      toJSON: () => ({}),
    } as DOMRect;

    if (textContent || isUrlContent) {
      // Text pseudo-element or image pseudo-element
      const renderNode: RenderNode = {
        nodeType: textContent ? 'text' : 'element',
        tag: pseudo === '::before' ? '::before' : '::after',
        textContent: textContent || undefined,
        computedStyle: style,
        boundingRect: pseudoRect,
        children: [],
        domNode: element, // pseudo-elements don't have their own DOM node
        visible: true,
        metadata: { isPseudoElement: true, pseudo },
      };
      return renderNode;
    }

    // Empty content with dimensions (decorative container)
    if (width > 0 || height > 0) {
      const renderNode: RenderNode = {
        nodeType: 'element',
        tag: pseudo === '::before' ? '::before' : '::after',
        computedStyle: style,
        boundingRect: pseudoRect,
        children: [],
        domNode: element,
        visible: true,
        metadata: { isPseudoElement: true, pseudo },
      };
      return renderNode;
    }
  } catch {
    // Pseudo-element capture can fail in some edge cases
  }

  return null;
}

/**
 * Default marker text map for list-style-type values.
 */
const MARKER_MAP: Record<string, string> = {
  'disc': '\u2022',     // •
  'circle': '\u25E6',   // ◦
  'square': '\u25AA',   // ▪
};

/**
 * Compute the ordinal index of an <li> within its parent <ol>/<ul>.
 * Returns 1-based index.
 */
function getListItemIndex(element: Element): number {
  const parent = element.parentElement;
  if (!parent) return 1;

  let index = 0;
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (child.tagName.toLowerCase() === 'li') {
      index++;
      if (child === element) return index;
    }
  }
  return 1;
}

/**
 * Generate marker text based on list-style-type and item index.
 */
function generateMarkerText(listStyleType: string, index: number): string {
  if (MARKER_MAP[listStyleType]) return MARKER_MAP[listStyleType] + ' ';
  if (listStyleType === 'none') return '';

  switch (listStyleType) {
    case 'decimal':
      return `${index}. `;
    case 'decimal-leading-zero':
      return `${index < 10 ? '0' : ''}${index}. `;
    case 'lower-alpha':
    case 'lower-latin':
      return `${String.fromCharCode(96 + ((index - 1) % 26) + 1)}. `;
    case 'upper-alpha':
    case 'upper-latin':
      return `${String.fromCharCode(64 + ((index - 1) % 26) + 1)}. `;
    case 'lower-roman': {
      const romans = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
      return `${romans[index] || index}. `;
    }
    case 'upper-roman': {
      const Romans = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
      return `${Romans[index] || index}. `;
    }
    default:
      // Default to disc for unordered, decimal for ordered
      return '\u2022 ';
  }
}

/**
 * Capture a ::marker pseudo-element as a synthetic text RenderNode.
 * Returns null if the element doesn't have a marker or marker is hidden.
 *
 * ::marker is used by list items (display: list-item) to render
 * bullet points (ul) or numbers (ol).
 */
export function captureMarkerPseudoElement(element: Element): RenderNode | null {
  try {
    const computedStyle = window.getComputedStyle(element);
    const display = computedStyle.getPropertyValue('display');

    // Only elements with display: list-item have markers
    if (display !== 'list-item') return null;

    let markerText = '';

    // Try to get marker content from ::marker computed style (Chrome 86+)
    try {
      const markerStyle = window.getComputedStyle(element, '::marker');
      const content = markerStyle.getPropertyValue('content');
      if (content && content !== 'none' && content !== 'normal') {
        // Strip quotes
        if ((content.startsWith('"') && content.endsWith('"')) ||
            (content.startsWith("'") && content.endsWith("'"))) {
          markerText = content.slice(1, -1);
        } else {
          markerText = content;
        }
      }
    } catch {
      // ::marker computed style not supported
    }

    // Fallback: determine marker text from list-style-type
    if (!markerText) {
      const listStyleType = computedStyle.getPropertyValue('list-style-type');
      if (listStyleType === 'none') return null;

      const parent = element.parentElement;
      const parentTag = parent?.tagName.toLowerCase();

      if (parentTag === 'ol' || listStyleType === 'decimal' || listStyleType.includes('alpha')
        || listStyleType.includes('roman') || listStyleType.includes('latin')) {
        const index = getListItemIndex(element);
        markerText = generateMarkerText(listStyleType || 'decimal', index);
      } else {
        markerText = generateMarkerText(listStyleType || 'disc', 1);
      }
    }

    if (!markerText) return null;

    // Get the element's bounding rect to position the marker
    const elementRect = element.getBoundingClientRect();

    // Estimate marker dimensions based on font size
    const fontSize = parseFloat(computedStyle.getPropertyValue('font-size')) || 16;
    const markerWidth = fontSize * markerText.length * 0.6;
    const markerHeight = fontSize * 1.2;

    // Position marker to the left of the element content
    const paddingLeft = parseFloat(computedStyle.getPropertyValue('padding-left')) || 0;
    const markerX = elementRect.left + paddingLeft - markerWidth;
    const markerY = elementRect.top + (parseFloat(computedStyle.getPropertyValue('padding-top')) || 0);

    const markerRect: DOMRect = {
      x: markerX,
      y: markerY,
      width: markerWidth,
      height: markerHeight,
      left: markerX,
      top: markerY,
      right: markerX + markerWidth,
      bottom: markerY + markerHeight,
      toJSON: () => ({}),
    } as DOMRect;

    // Get marker color — try ::marker style first, fall back to element color
    let markerComputedStyle: CSSStyleDeclaration;
    try {
      markerComputedStyle = window.getComputedStyle(element, '::marker');
      // Verify the style is usable by checking a basic property
      markerComputedStyle.getPropertyValue('color');
    } catch {
      markerComputedStyle = computedStyle;
    }

    const renderNode: RenderNode = {
      nodeType: 'text',
      tag: '::marker',
      textContent: markerText,
      computedStyle: markerComputedStyle,
      boundingRect: markerRect,
      children: [],
      domNode: element,
      visible: true,
      metadata: { isPseudoElement: true, pseudo: '::marker' },
    };

    return renderNode;
  } catch {
    // Marker capture can fail in edge cases
  }

  return null;
}
