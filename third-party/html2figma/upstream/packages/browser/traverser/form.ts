/**
 * Form element content injection for DOM traversal.
 * Injects synthetic RenderNodes for form elements whose visible content
 * (value, placeholder, selected option) has no DOM child representation.
 * Also simulates checkbox, radio, range slider, and select dropdown arrow visuals.
 *
 * Visual styles match Chrome's default appearance.
 */

import type { RenderNode } from './types';

// ── Chrome default colors ───────────────────────────────────────
// Accent blue used for checked checkbox/radio, range filled & thumb
const CHROME_ACCENT = 'rgb(2, 101, 220)';
// Border gray for unchecked checkbox/radio
const CHROME_BORDER = 'rgb(118, 118, 118)';
// Range track unfilled
const CHROME_TRACK = 'rgb(218, 220, 224)';

/** Input types that display user-entered or preset text */
const TEXT_INPUT_TYPES = new Set([
  'text', 'email', 'url', 'search', 'tel', 'number', '',
]);

/** Input types that act as buttons with a label */
const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset']);

/**
 * Inject synthetic children into a form element's RenderNode.
 */
export function injectFormContent(element: Element, renderNode: RenderNode): void {
  const tag = element.tagName.toLowerCase();

  if (tag === 'input') {
    injectInputContent(element as HTMLInputElement, renderNode);
  } else if (tag === 'select') {
    injectSelectContent(element as HTMLSelectElement, renderNode);
  } else if (tag === 'textarea') {
    injectTextareaContent(element as HTMLTextAreaElement, renderNode);
  }
  // <button> has DOM children — traverser handles it naturally
}

function injectInputContent(input: HTMLInputElement, renderNode: RenderNode): void {
  const type = (input.type || 'text').toLowerCase();

  if (TEXT_INPUT_TYPES.has(type)) {
    if (input.value) {
      pushFormTextChild(input, input.value, window.getComputedStyle(input), renderNode);
    } else if (input.placeholder) {
      pushFormTextChild(input, input.placeholder, getPlaceholderStyle(input), renderNode);
    }
  } else if (type === 'password') {
    if (input.value) {
      pushFormTextChild(input, '\u2022'.repeat(input.value.length), window.getComputedStyle(input), renderNode);
    } else if (input.placeholder) {
      pushFormTextChild(input, input.placeholder, getPlaceholderStyle(input), renderNode);
    }
  } else if (BUTTON_INPUT_TYPES.has(type)) {
    if (input.value) {
      pushFormTextChild(input, input.value, window.getComputedStyle(input), renderNode);
    }
  } else if (type === 'checkbox') {
    injectCheckboxContent(input, renderNode);
  } else if (type === 'radio') {
    injectRadioContent(input, renderNode);
  } else if (type === 'range') {
    injectRangeContent(input, renderNode);
  }
}

function injectSelectContent(select: HTMLSelectElement, renderNode: RenderNode): void {
  const text = select.options[select.selectedIndex]?.text;
  if (text) {
    const style = window.getComputedStyle(select);
    pushFormTextChild(select, text, style, renderNode);
    pushSelectChevron(select, style, renderNode);
  }
}

// ── Select chevron (Chrome style) ───────────────────────────────
// Absolutely positioned ">" rotated 90° CW at right-center of select

function pushSelectChevron(
  element: Element,
  baseStyle: CSSStyleDeclaration,
  parentRenderNode: RenderNode,
): void {
  const rect = element.getBoundingClientRect();
  const chevronSize = 16;
  // Right-aligned, vertically centered
  const cx = rect.right - chevronSize / 2 - 8;
  const cy = rect.top + (rect.height - chevronSize) / 2;
  const chevronRect = makeDOMRect(cx, cy, chevronSize, chevronSize);

  parentRenderNode.children.push({
    nodeType: 'text',
    tag: '#form-text',
    textContent: '>',
    computedStyle: createStyleProxy(baseStyle, {
      'text-align': 'center',
      'position': 'absolute',
    }),
    boundingRect: chevronRect,
    children: [],
    domNode: element,
    visible: true,
    metadata: { isFormContent: true, rotation: 90, positioning: 'absolute' },
  });
}

function injectTextareaContent(textarea: HTMLTextAreaElement, renderNode: RenderNode): void {
  if (textarea.value) {
    pushFormTextChild(textarea, textarea.value, window.getComputedStyle(textarea), renderNode);
  } else if (textarea.placeholder) {
    pushFormTextChild(textarea, textarea.placeholder, getPlaceholderStyle(textarea), renderNode);
  }
}

// ── Checkbox (Chrome style) ─────────────────────────────────────
// Unchecked: white square, 2px border #767676, border-radius 2px
// Checked:   blue (#0265DC) fill, no border, white "✓" centered

function injectCheckboxContent(input: HTMLInputElement, renderNode: RenderNode): void {
  const checked = input.checked;
  const rect = input.getBoundingClientRect();
  const size = Math.min(rect.width, rect.height) || 14;
  const boxRect = makeDOMRect(rect.left, rect.top, size, size);

  const base = window.getComputedStyle(input);
  const boxStyle = createStyleProxy(base, {
    ...(checked
      ? { ...NO_BORDER, 'background-color': CHROME_ACCENT }
      : {
        ...solidBorder('2px', CHROME_BORDER),
        'background-color': 'rgb(255, 255, 255)',
      }),
    'border-top-left-radius': '2px',
    'border-top-right-radius': '2px',
    'border-bottom-right-radius': '2px',
    'border-bottom-left-radius': '2px',
    'display': 'flex',
    'justify-content': 'center',
    'align-items': 'center',
    'overflow': 'visible',
    'position': 'static',
    'opacity': '1',
  });

  const box: RenderNode = {
    nodeType: 'element',
    tag: '#form-checkbox',
    computedStyle: boxStyle,
    boundingRect: boxRect,
    children: [],
    domNode: input,
    visible: true,
    metadata: { isFormContent: true },
  };

  if (checked) {
    box.children.push({
      nodeType: 'text',
      tag: '#form-text',
      textContent: '\u2713',
      computedStyle: createStyleProxy(base, {
        'color': 'rgb(255, 255, 255)',
        'font-size': `${Math.round(size * 0.75)}px`,
        'font-weight': '700',
        'line-height': `${size}px`,
        'text-align': 'center',
        'position': 'static',
      }),
      boundingRect: boxRect,
      children: [],
      domNode: input,
      visible: true,
      metadata: { isFormContent: true },
    });
  }

  renderNode.children.push(box);
}

// ── Radio (Chrome style) ────────────────────────────────────────
// Unchecked: white circle, 2px border #767676
// Checked:   2px blue border, blue filled dot (~40% size) centered

function injectRadioContent(input: HTMLInputElement, renderNode: RenderNode): void {
  const checked = input.checked;
  const rect = input.getBoundingClientRect();
  const size = Math.min(rect.width, rect.height) || 14;
  const halfSize = Math.round(size / 2);
  const outerRect = makeDOMRect(rect.left, rect.top, size, size);

  const base = window.getComputedStyle(input);
  const outerStyle = createStyleProxy(base, {
    ...solidBorder('2px', checked ? CHROME_ACCENT : CHROME_BORDER),
    ...circleRadius(halfSize),
    'background-color': 'rgb(255, 255, 255)',
    'display': 'flex',
    'justify-content': 'center',
    'align-items': 'center',
    'overflow': 'visible',
    'position': 'static',
    'opacity': '1',
  });

  const outer: RenderNode = {
    nodeType: 'element',
    tag: '#form-radio',
    computedStyle: outerStyle,
    boundingRect: outerRect,
    children: [],
    domNode: input,
    visible: true,
    metadata: { isFormContent: true },
  };

  if (checked) {
    // Inner filled dot
    const dotSize = Math.round(size * 0.4);
    const dotOffset = Math.round((size - dotSize) / 2);
    const dotRect = makeDOMRect(rect.left + dotOffset, rect.top + dotOffset, dotSize, dotSize);
    const dotHalf = Math.round(dotSize / 2);

    outer.children.push({
      nodeType: 'element',
      tag: '#form-radio-dot',
      computedStyle: createStyleProxy(base, {
        ...NO_BORDER,
        ...circleRadius(dotHalf),
        'background-color': CHROME_ACCENT,
        'display': 'block',
        'position': 'static',
        'overflow': 'visible',
        'opacity': '1',
      }),
      boundingRect: dotRect,
      children: [],
      domNode: input,
      visible: true,
      metadata: { isFormContent: true },
    });
  }

  renderNode.children.push(outer);
}

// ── Range slider (Chrome style) ─────────────────────────────────
// Track: 8px height, rounded, gray (#DADCE0) unfilled, blue (#0265DC) filled
// Thumb: 16px circle, blue (#0265DC), 1px light border

function injectRangeContent(input: HTMLInputElement, renderNode: RenderNode): void {
  const rect = input.getBoundingClientRect();
  const base = window.getComputedStyle(input);

  const min = parseFloat(input.min) || 0;
  const max = parseFloat(input.max) || 100;
  const val = parseFloat(input.value) || 0;
  const ratio = Math.max(0, Math.min(1, (val - min) / (max - min)));

  const trackH = 8;
  const trackRadius = `${trackH / 2}px`;
  const thumbSize = 16;
  const trackY = rect.top + (rect.height - trackH) / 2;
  const trackW = rect.width;
  const filledW = trackW * ratio;

  // All range children use position:absolute so they overlay
  // at their exact coordinates instead of stacking in the parent layout.

  // Filled portion (left of thumb)
  if (filledW > 0) {
    renderNode.children.push({
      nodeType: 'element',
      tag: '#form-range-filled',
      computedStyle: createStyleProxy(base, {
        ...NO_BORDER,
        'background-color': CHROME_ACCENT,
        'border-top-left-radius': trackRadius,
        'border-top-right-radius': ratio >= 1 ? trackRadius : '0px',
        'border-bottom-left-radius': trackRadius,
        'border-bottom-right-radius': ratio >= 1 ? trackRadius : '0px',
        'display': 'block',
        'position': 'absolute',
        'overflow': 'visible',
        'opacity': '1',
      }),
      boundingRect: makeDOMRect(rect.left, trackY, filledW, trackH),
      children: [],
      domNode: input,
      visible: true,
      metadata: { isFormContent: true },
    });
  }

  // Remaining portion (right of thumb)
  const remainW = trackW - filledW;
  if (remainW > 0) {
    renderNode.children.push({
      nodeType: 'element',
      tag: '#form-range-track',
      computedStyle: createStyleProxy(base, {
        ...NO_BORDER,
        'background-color': CHROME_TRACK,
        'border-top-left-radius': ratio <= 0 ? trackRadius : '0px',
        'border-top-right-radius': trackRadius,
        'border-bottom-left-radius': ratio <= 0 ? trackRadius : '0px',
        'border-bottom-right-radius': trackRadius,
        'display': 'block',
        'position': 'absolute',
        'overflow': 'visible',
        'opacity': '1',
      }),
      boundingRect: makeDOMRect(rect.left + filledW, trackY, remainW, trackH),
      children: [],
      domNode: input,
      visible: true,
      metadata: { isFormContent: true },
    });
  }

  // Thumb circle
  const thumbX = rect.left + filledW - thumbSize / 2;
  const thumbY = rect.top + (rect.height - thumbSize) / 2;
  renderNode.children.push({
    nodeType: 'element',
    tag: '#form-range-thumb',
    computedStyle: createStyleProxy(base, {
      'background-color': CHROME_ACCENT,
      ...circleRadius(thumbSize / 2),
      ...solidBorder('1px', 'rgba(0, 0, 0, 0.1)'),
      'display': 'block',
      'position': 'absolute',
      'overflow': 'visible',
      'opacity': '1',
    }),
    boundingRect: makeDOMRect(thumbX, thumbY, thumbSize, thumbSize),
    children: [],
    domNode: input,
    visible: true,
    metadata: { isFormContent: true },
  });
}

// ── Shared helpers ──────────────────────────────────────────────

function pushFormTextChild(
  element: Element,
  text: string,
  style: CSSStyleDeclaration,
  parentRenderNode: RenderNode,
): void {
  parentRenderNode.children.push({
    nodeType: 'text',
    tag: '#form-text',
    textContent: text,
    computedStyle: style,
    boundingRect: element.getBoundingClientRect(),
    children: [],
    domNode: element,
    visible: true,
    metadata: { isFormContent: true },
  });
}

function getPlaceholderStyle(element: Element): CSSStyleDeclaration {
  const elementStyle = window.getComputedStyle(element);
  const placeholderStyle = window.getComputedStyle(element, '::placeholder');
  return createStyleProxy(elementStyle, {
    'color': placeholderStyle.color || elementStyle.color,
  });
}

function makeDOMRect(x: number, y: number, w: number, h: number): DOMRect {
  return {
    x, y, width: w, height: h,
    left: x, top: y, right: x + w, bottom: y + h,
    toJSON: () => ({}),
  } as DOMRect;
}

// ── Style shorthand helpers ─────────────────────────────────────

const NO_BORDER: Record<string, string> = {
  'border-top-width': '0px', 'border-right-width': '0px',
  'border-bottom-width': '0px', 'border-left-width': '0px',
  'border-top-style': 'none', 'border-right-style': 'none',
  'border-bottom-style': 'none', 'border-left-style': 'none',
};

const TRANSPARENT_BG: Record<string, string> = {
  'background-color': 'transparent',
};

function solidBorder(width: string, color: string): Record<string, string> {
  return {
    'border-top-width': width, 'border-right-width': width,
    'border-bottom-width': width, 'border-left-width': width,
    'border-top-style': 'solid', 'border-right-style': 'solid',
    'border-bottom-style': 'solid', 'border-left-style': 'solid',
    'border-top-color': color, 'border-right-color': color,
    'border-bottom-color': color, 'border-left-color': color,
  };
}

/** Use px value (not %) since parsePx converts "50%" to 50px which is wrong */
function circleRadius(r: number): Record<string, string> {
  const v = `${r}px`;
  return {
    'border-top-left-radius': v, 'border-top-right-radius': v,
    'border-bottom-left-radius': v, 'border-bottom-right-radius': v,
  };
}

// ── Style proxy ─────────────────────────────────────────────────

function createStyleProxy(
  base: CSSStyleDeclaration,
  overrides: Record<string, string>,
): CSSStyleDeclaration {
  const camelOverrides: Record<string, string> = {};
  for (const [key, val] of Object.entries(overrides)) {
    camelOverrides[key] = val;
    camelOverrides[kebabToCamel(key)] = val;
  }

  const handler: ProxyHandler<CSSStyleDeclaration> = {
    get(target: CSSStyleDeclaration, prop: string | symbol): any {
      if (typeof prop === 'string' && prop in camelOverrides) {
        return camelOverrides[prop];
      }
      if (prop === 'getPropertyValue') {
        return (name: string) => {
          if (name in overrides) return overrides[name];
          const camel = kebabToCamel(name);
          if (camel in camelOverrides) return camelOverrides[camel];
          return target.getPropertyValue(name);
        };
      }
      const value = (target as any)[prop];
      if (typeof value === 'function') return value.bind(target);
      return value;
    },
  };

  return new Proxy(base, handler);
}

function kebabToCamel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
