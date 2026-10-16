/**
 * Stable semantic ID generation for DOM elements.
 *
 * Priority (high → low):
 * 1. data-semantic-id attribute (explicit user annotation)
 * 2. Element id attribute
 * 3. data-component + child index
 * 4. tag + classList + sibling index
 *
 * Design goals:
 * - Deterministic: same HTML produces same IDs across renders
 * - Stable: inserting a sibling doesn't invalidate all subsequent IDs
 *   when semantic anchors (id, data-semantic-id) are present
 * - Human-readable: IDs look like CSS selectors
 */

import type { SemanticInfo, SemanticAttributes, ComponentInfo } from '@html2figma/shared';

/** Max classes used in CSS selectors to avoid bloat on Tailwind pages */
const MAX_SELECTOR_CLASSES = 3;

// ── Semantic ID with ancestor cache ─────────────────────────────────

/**
 * WeakMap cache: element → computed full semantic ID path.
 * Since the traverser visits parents before children (depth-first),
 * a child can reuse its parent's cached path in O(1) instead of
 * re-walking the ancestor chain.
 */
const idCache = new WeakMap<Element, string>();

/**
 * Build a stable semantic ID segment for a single element.
 * Does NOT include parent path — caller composes the full path.
 */
export function buildSegment(el: Element): string {
  // Priority 1: explicit annotation
  const explicitId = el.getAttribute('data-semantic-id');
  if (explicitId) return explicitId;

  // Priority 2: HTML id
  const htmlId = el.id;
  if (htmlId) return `#${htmlId}`;

  // Priority 3: data-component
  const component = el.getAttribute('data-component');
  if (component) {
    const idx = getSiblingIndex(el);
    return idx > 0 ? `${component}:${idx}` : component;
  }

  // Priority 4: tag + classes + sibling index for disambiguation
  const tag = el.tagName.toLowerCase();
  const classes = getClassSelector(el);
  const idx = getSiblingIndex(el);
  const suffix = idx > 0 ? `:${idx}` : '';
  return `${tag}${classes}${suffix}`;
}

/**
 * Build full semantic ID path from root to element.
 * Uses ' > ' as separator (like CSS child combinator).
 * Amortized O(1) per element via WeakMap cache.
 */
export function buildSemanticId(el: Element, root?: Element): string {
  const cached = idCache.get(el);
  if (cached) return cached;

  const segments: string[] = [];
  let current: Element | null = el;
  let prefix = '';

  while (current && current !== root) {
    if (current.nodeType !== Node.ELEMENT_NODE) break;

    // Check ancestor cache — if parent's ID was already computed, use as prefix
    if (current !== el) {
      const ancestorCached = idCache.get(current);
      if (ancestorCached) {
        prefix = ancestorCached;
        break;
      }
    }

    segments.unshift(buildSegment(current));

    // Stop at semantic anchors to keep paths short
    const hasAnchor = current.id || current.getAttribute('data-semantic-id');
    if (hasAnchor && current !== el) break;

    current = current.parentElement;
  }

  const ownPath = segments.join(' > ');
  const result = prefix ? `${prefix} > ${ownPath}` : ownPath;
  idCache.set(el, result);
  return result;
}

/**
 * Extract full SemanticInfo from a DOM element.
 */
export function extractSemanticInfo(el: Element, root?: Element): SemanticInfo {
  const semanticId = buildSemanticId(el, root);
  const info: SemanticInfo = { semanticId };

  // Attributes
  const attributes = extractAttributes(el);
  if (attributes) info.attributes = attributes;

  // Class list
  const classList = getClassList(el);
  if (classList.length > 0) info.classList = classList;

  // CSS selector (best-effort unique selector)
  const cssSelector = buildCssSelector(el);
  if (cssSelector) info.cssSelector = cssSelector;

  // Component info
  const component = extractComponentInfo(el);
  if (component) info.component = component;

  // Source location (from data attributes)
  const file = el.getAttribute('data-component-file');
  if (file) {
    info.sourceLocation = { file };
    const line = el.getAttribute('data-component-line');
    if (line) info.sourceLocation.line = parseInt(line, 10);
  }

  return info;
}

// ===== Internal helpers =====

function getClassList(el: Element): string[] {
  if (!el.className || typeof el.className !== 'string') return [];
  return el.className.trim().split(/\s+/).filter(Boolean);
}

function getClassSelector(el: Element): string {
  const classes = getClassList(el);
  if (classes.length === 0) return '';
  // Use at most 2 classes to keep IDs readable
  return '.' + classes.slice(0, 2).join('.');
}

/**
 * Get sibling index among elements with the same tag (0-based).
 * Returns 0 if the element is the only one of its tag among siblings.
 */
function getSiblingIndex(el: Element): number {
  const parent = el.parentElement;
  if (!parent) return 0;

  const tag = el.tagName;
  const sameTags = Array.from(parent.children).filter(c => c.tagName === tag);
  if (sameTags.length <= 1) return 0;
  return sameTags.indexOf(el);
}

function extractAttributes(el: Element): SemanticAttributes | undefined {
  const attrs: SemanticAttributes = {};
  let hasAny = false;

  if (el.id) { attrs.id = el.id; hasAny = true; }
  // className is NOT stored here — classList field already carries class info,
  // avoiding duplicate storage (especially bloated on Tailwind pages).

  // data-* attributes (exclude internal ones)
  const dataAttrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith('data-') &&
        !attr.name.startsWith('data-semantic-') &&
        !attr.name.startsWith('data-component')) {
      dataAttrs[attr.name] = attr.value;
    }
  }
  if (Object.keys(dataAttrs).length > 0) { attrs.dataAttributes = dataAttrs; hasAny = true; }

  // aria-* attributes
  const ariaAttrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith('aria-')) {
      ariaAttrs[attr.name] = attr.value;
    }
  }
  if (Object.keys(ariaAttrs).length > 0) { attrs.ariaAttributes = ariaAttrs; hasAny = true; }

  // Common semantic attributes
  const href = el.getAttribute('href');
  if (href) { attrs.href = href; hasAny = true; }
  const src = el.getAttribute('src');
  if (src) { attrs.src = src; hasAny = true; }
  const alt = el.getAttribute('alt');
  if (alt) { attrs.alt = alt; hasAny = true; }
  const type = el.getAttribute('type');
  if (type) { attrs.type = type; hasAny = true; }
  const placeholder = el.getAttribute('placeholder');
  if (placeholder) { attrs.placeholder = placeholder; hasAny = true; }

  return hasAny ? attrs : undefined;
}

function extractComponentInfo(el: Element): ComponentInfo | undefined {
  const name = el.getAttribute('data-component');
  if (!name) return undefined;

  const info: ComponentInfo = { name };

  const framework = el.getAttribute('data-component-framework');
  if (framework && ['react', 'vue', 'svelte', 'html'].includes(framework)) {
    info.framework = framework as ComponentInfo['framework'];
  }

  // Extract data-prop-* as component props
  const props: Record<string, unknown> = {};
  let hasProps = false;
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith('data-prop-')) {
      const propName = attr.name.slice('data-prop-'.length);
      props[propName] = attr.value;
      hasProps = true;
    }
  }
  if (hasProps) info.props = props;

  return info;
}

/**
 * Build a best-effort CSS selector for this element.
 * Tries id > class combo (max 3 classes) > tag + nth-child.
 */
function buildCssSelector(el: Element): string {
  if (el.id) return `#${el.id}`;

  const tag = el.tagName.toLowerCase();
  const classes = getClassList(el);

  if (classes.length > 0) {
    // Cap at MAX_SELECTOR_CLASSES to avoid bloated selectors on Tailwind pages
    return `${tag}.${classes.slice(0, MAX_SELECTOR_CLASSES).join('.')}`;
  }

  // Fallback: tag with nth-child
  const parent = el.parentElement;
  if (parent) {
    const idx = Array.from(parent.children).indexOf(el) + 1;
    return `${tag}:nth-child(${idx})`;
  }

  return tag;
}
