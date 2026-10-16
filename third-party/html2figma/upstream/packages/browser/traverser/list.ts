/**
 * List marker injection for <li> elements.
 * Detects display:list-item and stores marker metadata on the RenderNode.
 * The actual marker structure is created later in the converter.
 */

import type { RenderNode } from './types';

/**
 * Detect list-item elements and store marker metadata.
 * Does NOT modify children or text content — the converter handles layout.
 */
export function injectListMarker(element: Element, renderNode: RenderNode): void {
  const style = renderNode.computedStyle;
  if (!style) return;

  const display = style.getPropertyValue('display');
  if (display !== 'list-item') return;

  const listStyleType = style.getPropertyValue('list-style-type');
  if (!listStyleType || listStyleType === 'none') return;

  const markerText = generateMarkerText(listStyleType, element);
  if (!markerText) return;

  // Store marker info as metadata — converter will create the Figma structure
  renderNode.metadata = {
    ...renderNode.metadata,
    listMarker: markerText,
    listStylePosition: style.getPropertyValue('list-style-position') || 'outside',
  };
}

/**
 * Generate marker text based on list-style-type and element position.
 */
function generateMarkerText(type: string, element: Element): string | null {
  switch (type) {
    case 'disc':    return '\u2022'; // •
    case 'circle':  return '\u25E6'; // ◦
    case 'square':  return '\u25AA'; // ▪
    case 'decimal':
      return `${getListItemIndex(element)}.`;
    case 'decimal-leading-zero': {
      const idx = getListItemIndex(element);
      return `${idx < 10 ? '0' : ''}${idx}.`;
    }
    case 'lower-alpha':
    case 'lower-latin':
      return `${toLetter(getListItemIndex(element), false)}.`;
    case 'upper-alpha':
    case 'upper-latin':
      return `${toLetter(getListItemIndex(element), true)}.`;
    case 'lower-roman':
      return `${toRoman(getListItemIndex(element), false)}.`;
    case 'upper-roman':
      return `${toRoman(getListItemIndex(element), true)}.`;
    case 'cjk-decimal':
    case 'cjk-ideographic':
    case 'trad-chinese-informal':
      return `${toCJKDecimal(getListItemIndex(element))}\u3001`;
    default:
      return '\u2022';
  }
}

function getListItemIndex(element: Element): number {
  const valueAttr = element.getAttribute('value');
  if (valueAttr != null) {
    const parsed = parseInt(valueAttr, 10);
    if (!isNaN(parsed)) return parsed;
  }
  const parent = element.parentElement;
  let start = 1;
  if (parent && parent.tagName.toLowerCase() === 'ol') {
    const startAttr = parent.getAttribute('start');
    if (startAttr) {
      const parsed = parseInt(startAttr, 10);
      if (!isNaN(parsed)) start = parsed;
    }
  }
  let index = 0;
  let sibling: Element | null = element.previousElementSibling;
  while (sibling) {
    if (sibling.tagName.toLowerCase() === 'li') index++;
    sibling = sibling.previousElementSibling;
  }
  return start + index;
}

function toLetter(n: number, upper: boolean): string {
  let result = '';
  while (n > 0) {
    n--;
    result = String.fromCharCode((upper ? 65 : 97) + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result || (upper ? 'A' : 'a');
}

function toRoman(n: number, upper: boolean): string {
  const values = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const symbols = ['m', 'cm', 'd', 'cd', 'c', 'xc', 'l', 'xl', 'x', 'ix', 'v', 'iv', 'i'];
  let result = '';
  for (let i = 0; i < values.length; i++) {
    while (n >= values[i]) {
      result += symbols[i];
      n -= values[i];
    }
  }
  return upper ? result.toUpperCase() : result;
}

function toCJKDecimal(n: number): string {
  const digits = ['\u3007', '\u4E00', '\u4E8C', '\u4E09', '\u56DB', '\u4E94', '\u516D', '\u4E03', '\u516B', '\u4E5D'];
  if (n <= 0) return digits[0];
  if (n < 10) return digits[n];
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return (tens > 1 ? digits[tens] : '') + '\u5341' + (ones > 0 ? digits[ones] : '');
  }
  return String(n).split('').map(d => digits[parseInt(d)]).join('');
}
