/**
 * Node Builder - Factory functions for constructing DesignNode variants
 */

import type {
  DesignNode,
  DesignContainerNode,
  DesignTextNode,
  DesignImageNode,
  DesignSVGNode,
  BoundingBox,
  PositioningInfo,
  LayoutInfo,
  BackgroundInfo,
  BorderInfo,
  EffectInfo,
  TextStyleInfo,
  ImageInfo,
  TransformInfo,
} from '@html2figma/shared';
import type { RenderNode } from '../traverser/types';
import { generateId, computedStyleToRecord, parseSpacing } from './utils';
import { resolveBackground, resolveBorder, resolveEffects, splitBackgroundLayers } from './resolvers/style';
import { resolveLayout, resolvePositioning, resolveTransform, resolveFlexItem } from './resolvers/layout';
import { resolveTextStyle, sanitizeTextContent } from './resolvers/text';
import { resolveImageInfo, resolveImgElement, imageToBase64, isSvgUrl } from './resolvers/image';

/**
 * Determine the DesignNode type for a RenderNode
 */
export function determineNodeType(node: RenderNode): DesignNode['nodeType'] {
  if (node.nodeType === 'text') return 'text';

  const tag = (node.tag || '').toLowerCase();

  if (tag === 'img') return 'image';
  if (tag === 'svg') return 'svg';

  // Check for elements that act like images
  if (tag === 'picture' || tag === 'video' || tag === 'canvas') return 'image';

  return 'container';
}

/**
 * Get semantic role from HTML tag
 */
function getRole(tag: string): string | undefined {
  const roleMap: Record<string, string> = {
    'button': 'button',
    'a': 'button',
    'input': 'input',
    'textarea': 'input',
    'select': 'input',
    'img': 'image',
    'svg': 'svg',
    'video': 'video',
    'canvas': 'image',
    'hr': 'separator',
    'fieldset': 'fieldset',
    'legend': 'legend',
  };
  return roleMap[tag];
}

/**
 * Resolve effective opacity from computed styles.
 * CSS `visibility: hidden` means the element occupies layout space but is not rendered.
 * We map this to opacity: 0 so Figma keeps the node in auto-layout but hides it visually.
 */
function resolveOpacity(styles: Record<string, string>): number {
  const visibility = styles['visibility'];
  if (visibility === 'hidden') return 0;
  const opacity = parseFloat(styles['opacity'] || '1');
  return isNaN(opacity) ? 1 : opacity;
}

/**
 * Build bounds from RenderNode.
 *
 * When a CSS transform is present, getBoundingClientRect() returns the AABB of the
 * transformed element. Figma needs the untransformed dimensions + rotation, and its
 * coordinate system differs from CSS:
 *
 * - Figma relativeTransform = [[cosR, sinR, tx], [-sinR, cosR, ty]]
 *   where R = Figma rotation angle.
 * - CSS rotate(θ) maps to Figma rotation = -θ  (opposite sign conventions).
 * - Figma's (node.x, node.y) = (tx, ty) in the relativeTransform, which is the
 *   translation component of the combined rotation+translation matrix.
 *
 * From the AABB center (= rotated center of the element) we derive:
 *   tx = AABB_cx - cos(θ)*w/2 + sin(θ)*h/2
 *   ty = AABB_cy - sin(θ)*w/2 - cos(θ)*h/2
 *
 * This formula correctly handles all transform-origin values because the AABB center
 * already encodes the origin offset.
 */
function buildBounds(node: RenderNode, baseX: number, baseY: number, transform?: TransformInfo): BoundingBox {
  if (!node.boundingRect) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  // When transform is present and we have originalRect, compute corrected bounds
  if (node.originalRect && transform) {
    const sx = transform.scale?.x ?? 1;
    const sy = transform.scale?.y ?? 1;
    const w = node.originalRect.width * sx;
    const h = node.originalRect.height * sy;
    const θ = (transform.rotation ?? 0) * Math.PI / 180; // CSS rotation in radians
    const cosθ = Math.cos(θ);
    const sinθ = Math.sin(θ);

    // AABB center = rotated center of the element (true for any transform-origin)
    const aabbCx = node.boundingRect.left + node.boundingRect.width / 2;
    const aabbCy = node.boundingRect.top + node.boundingRect.height / 2;

    // Derive Figma (tx, ty) from the relativeTransform equation
    const tx = aabbCx - cosθ * w / 2 + sinθ * h / 2;
    const ty = aabbCy - sinθ * w / 2 - cosθ * h / 2;

    return { x: tx - baseX, y: ty - baseY, width: w, height: h };
  }

  // writing-mode rotation: browser returns visual bounds (already rotated),
  // but Figma needs pre-rotation dimensions + rotation. Swap w↔h and compute
  // Figma position from the AABB center (same formula as above).
  if (transform?.writingModeRotation && transform.rotation) {
    const w = node.boundingRect.height; // pre-rotation: swap
    const h = node.boundingRect.width;
    const θ = transform.rotation * Math.PI / 180;
    const cosθ = Math.cos(θ);
    const sinθ = Math.sin(θ);

    const aabbCx = node.boundingRect.left + node.boundingRect.width / 2;
    const aabbCy = node.boundingRect.top + node.boundingRect.height / 2;

    const tx = aabbCx - cosθ * w / 2 + sinθ * h / 2;
    const ty = aabbCy - sinθ * w / 2 - cosθ * h / 2;

    return { x: tx - baseX, y: ty - baseY, width: w, height: h };
  }

  return {
    x: node.boundingRect.left - baseX,
    y: node.boundingRect.top - baseY,
    width: node.boundingRect.width,
    height: node.boundingRect.height,
  };
}

/**
 * Build a name for a node
 */
function buildName(node: RenderNode): string {
  if (node.nodeType === 'text') {
    const text = (node.textContent || '').trim().substring(0, 30);
    return text || '#text';
  }
  const tag = node.tag || 'div';
  // Try to use class or id for a more descriptive name
  if (node.domNode instanceof Element) {
    const el = node.domNode as Element;
    const id = el.id;
    const cls = el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : '';
    if (id) return `${tag}#${id}`;
    if (cls) return `${tag}.${cls}`;
  }
  return tag;
}

/**
 * Build a DesignContainerNode from RenderNode
 */
export function buildContainerNode(
  node: RenderNode,
  baseX: number,
  baseY: number,
  includeRawStyles: boolean
): DesignContainerNode {
  const styles = getStyles(node);
  const tag = node.tag || 'div';
  const opacity = resolveOpacity(styles);

  const flexItem = resolveFlexItem(styles);

  // When background-clip: text is set, gradient goes to text fills, not container background
  const bgClip = styles['background-clip'] || styles['backgroundClip']
    || styles['-webkit-background-clip'] || styles['webkitBackgroundClip'] || '';
  let background = resolveBackground(styles, node.boundingRect);
  if (bgClip === 'text') {
    // Remove gradient layers from container background (they'll be on text children)
    const colorLayers = background.layers.filter(l => l.type === 'color');
    background = { layers: colorLayers };
  }

  const transformInfo = resolveTransform(styles, node.boundingRect || { width: 0, height: 0 });

  const layout = resolveLayout(styles);

  const result: DesignContainerNode = {
    id: generateId('c'),
    name: buildName(node),
    tag,
    role: getRole(tag),
    nodeType: 'container',
    bounds: buildBounds(node, baseX, baseY, transformInfo),
    visible: node.visible,
    opacity,
    positioning: resolvePositioning(styles),
    transform: transformInfo,
    flexItem,
    children: [],
    layout,
    background,
    border: resolveBorder(styles),
    effects: resolveEffects(styles),
    overflow: resolveOverflow(styles),
  };

  // Store background-clip for padding-box / content-box handling in adapter
  if (bgClip === 'padding-box' || bgClip === 'content-box') {
    result.backgroundClip = bgClip;
  }

  // Detect CSS gradient border trick:
  // border: Npx solid transparent + multi-value background-clip (padding-box, border-box)
  // The border-box layer shows through the transparent border area as a gradient border.
  detectGradientBorder(result, background, styles);

  // Capture container's own computed text style for rich text merge.
  // Needed when: has direct text children, is an inline container that participates
  // in rich text merge (e.g. <a>, <span>, <em>), or uses background-clip: text.
  const display = styles['display'] || '';
  const isInlineContainer = display === 'inline' || display === 'inline-block' || display === 'inline-flex';
  const hasTextChildren = node.children.some(c => c.nodeType === 'text');
  if (hasTextChildren || isInlineContainer || bgClip === 'text') {
    result.textStyle = resolveTextStyle(styles);

    // When background-clip: text, transfer gradient layers to textStyle.gradientFill
    // so postprocess (richText merge) can access it from DesignNode without browser API.
    if (bgClip === 'text') {
      const fullBg = resolveBackground(styles, node.boundingRect);
      const gradientLayers = fullBg.layers.filter(l => l.type !== 'color');
      if (gradientLayers.length > 0) {
        result.textStyle!.gradientFill = gradientLayers;
      }
    }
  }

  // Capture list-style-type for <ul>/<ol>/<li> so mergeListItems doesn't need computedStyle
  if (tag === 'ul' || tag === 'ol') {
    result.listStyleType = styles['list-style-type'] || (tag === 'ol' ? 'decimal' : 'disc');
  } else if (tag === 'li') {
    result.listStyleType = styles['list-style-type'] || undefined;
  }

  // Capture list marker text from traverser metadata so postprocess can use it
  if (node.metadata?.listMarker) {
    result.listMarker = node.metadata.listMarker as string;
  }

  // Propagate semantic info from RenderNode metadata
  if (node.metadata?.semantic) {
    result.semantic = node.metadata.semantic;
  }

  // Ensure <hr> elements have a minimum height so they're visible in Figma
  if (tag === 'hr' && result.bounds.height < 1) {
    result.bounds.height = 1;
  }

  applyTransformScale(result, transformInfo);

  if (includeRawStyles) {
    result.rawStyles = styles;
  }

  return result;
}

/**
 * Apply the element's own CSS transform scale to its layout properties.
 * getBoundingClientRect() returns scaled bounds, but getComputedStyle() returns
 * original declared values — so padding, margin, border, gap, etc. need manual scaling.
 */
function applyTransformScale(
  node: DesignContainerNode,
  transform: TransformInfo | undefined
): void {
  if (!transform?.scale) return;
  const sx = transform.scale.x;
  const sy = transform.scale.y;
  if (Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) return;

  // Scale padding
  const p = node.layout.padding;
  p.top = p.top * sy;
  p.bottom = p.bottom * sy;
  p.left = p.left * sx;
  p.right = p.right * sx;

  // Scale margin
  const m = node.layout.margin;
  m.top = m.top * sy;
  m.bottom = m.bottom * sy;
  m.left = m.left * sx;
  m.right = m.right * sx;

  // Scale flex gap
  if (node.layout.flex) {
    node.layout.flex.gap.row = node.layout.flex.gap.row * sy;
    node.layout.flex.gap.column = node.layout.flex.gap.column * sx;
  }

  // Scale grid gap
  if (node.layout.grid) {
    node.layout.grid.gap.row = node.layout.grid.gap.row * sy;
    node.layout.grid.gap.column = node.layout.grid.gap.column * sx;
  }

  // Scale border widths
  const b = node.border;
  b.top.width = b.top.width * sy;
  b.bottom.width = b.bottom.width * sy;
  b.left.width = b.left.width * sx;
  b.right.width = b.right.width * sx;

  // Scale border radius (average of sx/sy since radius is circular)
  const s = (sx + sy) / 2;
  const r = b.radius;
  r.topLeft = r.topLeft * s;
  r.topRight = r.topRight * s;
  r.bottomRight = r.bottomRight * s;
  r.bottomLeft = r.bottomLeft * s;

  // Scale box shadows
  for (const shadow of node.effects.boxShadows) {
    shadow.offsetX = shadow.offsetX * sx;
    shadow.offsetY = shadow.offsetY * sy;
    shadow.blurRadius = shadow.blurRadius * s;
    shadow.spreadRadius = shadow.spreadRadius * s;
  }
}

/**
 * Build a DesignTextNode from RenderNode
 */
export function buildTextNode(
  node: RenderNode,
  parentNode: RenderNode | null,
  baseX: number,
  baseY: number,
  includeRawStyles: boolean
): DesignTextNode {
  // Pseudo-elements and form content have their own computed style; regular text nodes inherit from parent
  const isPseudoElement = node.metadata?.isPseudoElement === true;
  const isFormContent = node.metadata?.isFormContent === true;
  const useOwnStyle = (isPseudoElement || isFormContent) && node.computedStyle;
  const styleSource = useOwnStyle
    ? getStyles(node)
    : (parentNode ? getStyles(parentNode) : {});
  const content = sanitizeTextContent(node.textContent || '', styleSource['white-space']);
  const tag = (isPseudoElement || isFormContent) ? (node.tag || '#text') : (parentNode?.tag || '#text');
  const opacity = resolveOpacity(styleSource);

  const result: DesignTextNode = {
    id: generateId('t'),
    name: content.substring(0, 30) || '#text',
    tag,
    role: 'text',
    nodeType: 'text',
    bounds: buildBounds(node, baseX, baseY),
    visible: node.visible,
    opacity,
    positioning: node.metadata?.positioning
      ? { mode: node.metadata.positioning as 'absolute' | 'static' }
      : (isPseudoElement || isFormContent) ? resolvePositioning(styleSource) : { mode: 'static' as const },
    transform: node.metadata?.rotation != null ? { rotation: node.metadata.rotation } : undefined,
    content,
    textStyle: resolveTextStyle(styleSource),
  };

  // Apply ancestor scale to text properties (CSS transform: scale() doesn't change
  // computed font-size, but visually scales the text — Figma needs explicit font scaling)
  const ancestorScale = node.metadata?.ancestorScale as { x: number; y: number } | undefined;
  if (ancestorScale) {
    result.textStyle.fontSize = result.textStyle.fontSize * ancestorScale.x;
    if (result.textStyle.lineHeight && result.textStyle.lineHeight.unit !== 'normal') {
      result.textStyle.lineHeight = {
        ...result.textStyle.lineHeight,
        value: result.textStyle.lineHeight.value * ancestorScale.y,
      };
    }
    if (result.textStyle.letterSpacing && result.textStyle.letterSpacing.value !== 0) {
      result.textStyle.letterSpacing = {
        ...result.textStyle.letterSpacing,
        value: result.textStyle.letterSpacing.value * ancestorScale.x,
      };
    }
  }

  // Check for background-clip: text (gradient text effect)
  const bgClip = styleSource['background-clip'] || styleSource['backgroundClip']
    || styleSource['-webkit-background-clip'] || styleSource['webkitBackgroundClip'] || '';

  if (bgClip === 'text') {
    const bg = resolveBackground(styleSource);
    // Transfer gradient/image layers to text fill, keep solid color layers as background
    const gradientLayers = bg.layers.filter(l => l.type !== 'color');
    const colorLayers = bg.layers.filter(l => l.type === 'color');
    if (gradientLayers.length > 0) {
      result.textStyle.gradientFill = gradientLayers;
    }
    if (colorLayers.length > 0) {
      result.background = { layers: colorLayers };
    }
  } else if (isPseudoElement) {
    // Only pseudo-elements carry their own background/border — they don't
    // have a separate parent container in the design tree. Regular text nodes
    // inherit from the parent container which already preserves these visuals.
    const bg = resolveBackground(styleSource);
    if (bg.layers.length > 0) {
      result.background = bg;
    }
    const border = resolveBorder(styleSource);
    if (border.top.width > 0 || border.right.width > 0 || border.bottom.width > 0 || border.left.width > 0) {
      result.border = border;
    }
  }

  // Store line break metadata from traverser split mode so postprocess doesn't need RenderNode
  if (node.metadata?.hasLineBreakAfter === true) {
    result.hasLineBreakAfter = true;
  }

  // Propagate semantic info: pseudo/form nodes use own metadata, text nodes inherit from parent
  const semanticSource = (isPseudoElement || isFormContent) ? node : parentNode;
  if (semanticSource?.metadata?.semantic) {
    result.semantic = semanticSource.metadata.semantic;
  }

  if (includeRawStyles) {
    result.rawStyles = styleSource;
  }

  return result;
}

/**
 * Build a DesignImageNode from RenderNode
 */
export function buildImageNode(
  node: RenderNode,
  baseX: number,
  baseY: number,
  includeRawStyles: boolean
): DesignImageNode {
  const styles = getStyles(node);
  const opacity = resolveOpacity(styles);
  const imageInfo = resolveImageInfo(node.domNode, styles);

  // Try to capture base64 — for <picture>, use the inner <img>
  const imgEl = resolveImgElement(node.domNode);
  if (imgEl instanceof HTMLImageElement) {
    const b64 = imageToBase64(imgEl);
    if (b64) imageInfo.base64 = b64;
  }

  const transformInfo = resolveTransform(styles, node.boundingRect || { width: 0, height: 0 });
  const margin = parseSpacing(styles, 'margin');
  if (transformInfo?.scale) {
    const sx = transformInfo.scale.x;
    const sy = transformInfo.scale.y;
    if (margin.top || margin.bottom) { margin.top *= sy; margin.bottom *= sy; }
    if (margin.left || margin.right) { margin.left *= sx; margin.right *= sx; }
  }
  const verticalAlign = styles['vertical-align'] || styles['verticalAlign'] || undefined;
  const result: DesignImageNode = {
    id: generateId('i'),
    name: buildName(node),
    tag: node.tag || 'img',
    role: 'image',
    nodeType: 'image',
    bounds: buildBounds(node, baseX, baseY, transformInfo),
    visible: node.visible,
    opacity,
    positioning: resolvePositioning(styles),
    transform: transformInfo,
    margin: (margin.top || margin.right || margin.bottom || margin.left) ? margin : undefined,
    verticalAlign,
    imageData: imageInfo,
    border: resolveBorder(styles),
    effects: resolveEffects(styles),
  };

  // Propagate semantic info from RenderNode metadata
  if (node.metadata?.semantic) {
    result.semantic = node.metadata.semantic;
  }

  if (includeRawStyles) {
    result.rawStyles = styles;
  }

  return result;
}

/**
 * Build a DesignSVGNode from RenderNode
 */
export function buildSVGNode(
  node: RenderNode,
  baseX: number,
  baseY: number,
  includeRawStyles: boolean
): DesignSVGNode {
  const styles = getStyles(node);
  const opacity = resolveOpacity(styles);

  let svgContent = '';
  if (node.domNode instanceof Element) {
    svgContent = resolveSvgColors(node.domNode);
  }

  const transformInfo = resolveTransform(styles, node.boundingRect || { width: 0, height: 0 });
  const svgMargin = parseSpacing(styles, 'margin');
  if (transformInfo?.scale) {
    const sx = transformInfo.scale.x;
    const sy = transformInfo.scale.y;
    if (svgMargin.top || svgMargin.bottom) { svgMargin.top *= sy; svgMargin.bottom *= sy; }
    if (svgMargin.left || svgMargin.right) { svgMargin.left *= sx; svgMargin.right *= sx; }
  }
  const svgVerticalAlign = styles['vertical-align'] || styles['verticalAlign'] || undefined;
  const result: DesignSVGNode = {
    id: generateId('s'),
    name: buildName(node),
    tag: 'svg',
    role: 'svg',
    nodeType: 'svg',
    bounds: buildBounds(node, baseX, baseY, transformInfo),
    visible: node.visible,
    opacity,
    positioning: resolvePositioning(styles),
    transform: transformInfo,
    margin: (svgMargin.top || svgMargin.right || svgMargin.bottom || svgMargin.left) ? svgMargin : undefined,
    verticalAlign: svgVerticalAlign,
    svgContent,
    background: resolveBackground(styles, node.boundingRect),
    border: resolveBorder(styles),
    effects: resolveEffects(styles),
  };

  // Propagate semantic info from RenderNode metadata
  if (node.metadata?.semantic) {
    result.semantic = node.metadata.semantic;
  }

  if (includeRawStyles) {
    result.rawStyles = styles;
  }

  return result;
}

// ==================== SVG color resolution ====================

const SVG_SHAPE_SELECTOR = 'path,circle,rect,line,polyline,polygon,ellipse';

/**
 * Clone an inline SVG element and inject computed stroke/fill colors as
 * presentation attributes so that currentColor and CSS-only paint rules are
 * preserved when Figma's createNodeFromSvg() renders without any CSS context.
 *
 * Strategy:
 *  - stroke: always inject computed value if it is a real color (not "none").
 *    This resolves both `stroke="currentColor"` and CSS-only `stroke` rules.
 *  - fill: only resolve if the attribute is explicitly "currentColor".
 *    We intentionally leave fill="none" alone to avoid painting transparent areas.
 */
function resolveSvgColors(svgEl: Element): string {
  const clone = svgEl.cloneNode(true) as Element;

  // Resolve currentColor on the <svg> root element itself.
  // CSS `color` on the SVG (or inherited from parent) is what `currentColor` resolves to.
  const svgFill = svgEl.getAttribute('fill');
  if (svgFill === 'currentColor') {
    const svgCs = window.getComputedStyle(svgEl);
    const resolved = svgCs.getPropertyValue('color');
    if (resolved) {
      clone.setAttribute('fill', resolved);
    }
  }

  const origShapes = Array.from(svgEl.querySelectorAll(SVG_SHAPE_SELECTOR));
  const cloneShapes = Array.from(clone.querySelectorAll(SVG_SHAPE_SELECTOR));

  origShapes.forEach((orig, i) => {
    const cloneEl = cloneShapes[i] as Element;
    if (!cloneEl) return;
    const cs = window.getComputedStyle(orig);

    // Inject computed stroke — resolves currentColor and CSS-only stroke rules
    const stroke = cs.getPropertyValue('stroke');
    if (stroke && stroke !== 'none') {
      cloneEl.setAttribute('stroke', stroke);
    }

    const shapeFill = cloneEl.getAttribute('fill');

    // Case 1: fill="currentColor" explicitly on the shape
    if (shapeFill === 'currentColor') {
      const fill = cs.getPropertyValue('fill');
      if (fill && fill !== 'none') cloneEl.setAttribute('fill', fill);
      return;
    }

    // Case 2: shape has no fill attribute — it inherits from parent.
    // If the parent SVG had fill="currentColor" (now resolved above), the clone
    // already has the correct value. But if currentColor was set via CSS (not attribute),
    // shapes inherit it but the clone loses the CSS context.
    // Inject the computed fill so Figma renders correctly without CSS.
    if (!shapeFill) {
      const fill = cs.getPropertyValue('fill');
      if (fill && fill !== 'none' && fill !== 'rgb(0, 0, 0)') {
        // Non-default fill inherited via CSS — inject it
        cloneEl.setAttribute('fill', fill);
      }
    }
  });

  return clone.outerHTML;
}

// ==================== Internal helpers ====================

/**
 * Get styles as Record from a RenderNode
 */
function getStyles(node: RenderNode): Record<string, string> {
  if (!node.computedStyle) return {};
  return computedStyleToRecord(node.computedStyle);
}

/**
 * Resolve overflow from computed styles.
 * CSSStyleDeclaration iteration only yields longhand properties (overflow-x, overflow-y),
 * not the shorthand `overflow`. Pick the most restrictive axis value.
 */
function resolveOverflow(styles: Record<string, string>): DesignContainerNode['overflow'] {
  const values = [styles['overflow'], styles['overflow-x'], styles['overflow-y']].filter(Boolean);
  if (values.includes('hidden')) return 'hidden';
  if (values.includes('scroll')) return 'scroll';
  if (values.includes('auto')) return 'auto';
  return 'visible';
}

/**
 * Detect CSS gradient border trick and extract border gradient layers.
 *
 * Pattern: border: Npx solid transparent + multi-value background-clip
 * where one layer uses border-box and another uses padding-box.
 * The border-box gradient layer renders in the border area, simulating a gradient border.
 *
 * When detected:
 * - Extracts border-box gradient layers → result.borderGradientLayers (become Figma gradient strokes)
 * - Keeps padding-box layers as normal background fills
 * - Sets backgroundClip to 'padding-box' so the fill doesn't extend into border area
 */
function detectGradientBorder(
  result: DesignContainerNode,
  background: BackgroundInfo,
  styles: Record<string, string>,
): void {
  // Must have a transparent border with non-zero width
  const border = result.border;
  const hasBorderWidth = border.top.width > 0 || border.right.width > 0 ||
    border.bottom.width > 0 || border.left.width > 0;
  if (!hasBorderWidth) return;

  const allTransparent = border.top.color.a === 0 && border.right.color.a === 0 &&
    border.bottom.color.a === 0 && border.left.color.a === 0;
  if (!allTransparent) return;

  // Must have multi-value background-clip with both padding-box and border-box
  const bgClipRaw = styles['background-clip'] || styles['backgroundClip'] || '';
  const clipValues = splitBackgroundLayers(bgClipRaw);
  if (clipValues.length < 2) return;

  const hasPaddingBox = clipValues.some(v => v.trim() === 'padding-box');
  const hasBorderBox = clipValues.some(v => v.trim() === 'border-box');
  if (!hasPaddingBox || !hasBorderBox) return;

  // Match background-image layers with their clip values.
  // CSS: background-clip values correspond to background-image layers (top to bottom).
  // resolveBackground stores layers bottom-to-top, so we need to match carefully.
  const bgImageRaw = styles['background-image'] || styles['backgroundImage'] || '';
  const imageLayers = splitBackgroundLayers(bgImageRaw);
  if (imageLayers.length < 2) return;

  // clipValues[0] corresponds to imageLayers[0] (topmost layer), etc.
  // background.layers stores them bottom-to-top (reversed), but also includes
  // background-color as index 0. We need to map image layers to clip values.

  // Extract border-box gradient layers
  const borderGradients: typeof background.layers = [];
  const keepLayers: typeof background.layers = [];

  // background-color layer (always bottom, always border-box by default) — keep as fill
  const colorLayers = background.layers.filter(l => l.type === 'color');
  const gradientImageLayers = background.layers.filter(l => l.type !== 'color');

  // gradientImageLayers are in bottom-to-top order (reversed from CSS).
  // imageLayers/clipValues are in CSS order (top-to-bottom).
  // So gradientImageLayers[0] = imageLayers[imageLayers.length-1], etc.
  for (let gi = 0; gi < gradientImageLayers.length; gi++) {
    // Reverse index: gradientImageLayers[gi] corresponds to imageLayers[imageLayers.length - 1 - gi]
    const cssIndex = imageLayers.length - 1 - gi;
    const clip = (cssIndex >= 0 && cssIndex < clipValues.length)
      ? clipValues[cssIndex].trim() : 'border-box';

    if (clip === 'border-box') {
      borderGradients.push(gradientImageLayers[gi]);
    } else {
      keepLayers.push(gradientImageLayers[gi]);
    }
  }

  if (borderGradients.length === 0) return;

  // Filter out degenerate gradients where all stops are the same color
  // (e.g. white-to-white). These are CSS structural artifacts, not real gradient borders.
  const meaningfulGradients = borderGradients.filter(layer => {
    if (layer.type !== 'linear-gradient' && layer.type !== 'radial-gradient') return true;
    const stops = (layer as any).stops;
    if (!stops || stops.length < 2) return false;
    const first = stops[0].color;
    return stops.some((s: any) =>
      s.color.r !== first.r || s.color.g !== first.g ||
      s.color.b !== first.b || s.color.a !== first.a,
    );
  });

  // Store meaningful border gradient layers for adapter to convert to gradient strokes
  if (meaningfulGradients.length > 0) {
    result.borderGradientLayers = meaningfulGradients;
  }

  // Always update background to only keep padding-box layers + color,
  // and set backgroundClip. Even when border gradients are degenerate (filtered out),
  // the CSS background-clip: padding-box still applies to the remaining fills —
  // without it, fills would extend into the border area and cover sibling border strokes.
  result.background = { layers: [...colorLayers, ...keepLayers] };
  result.backgroundClip = 'padding-box';
}
