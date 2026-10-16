/**
 * Effect Resolver - Resolves all effects that were previously handled
 * by the post-processing effect system. Now inlined into the DSL.
 */

import type {
  DesignNode,
  DesignContainerNode,
  DesignTextNode,
  BackgroundInfo,
  BorderInfo,
} from '@html2figma/shared';

/**
 * Inline text wrapper effect:
 * If a text node has background or border, wrap it in a container.
 * Returns the original node (possibly wrapped in a container).
 */
export function inlineTextWrapperEffect(
  textNode: DesignTextNode
): DesignNode {
  const hasBackground = textNode.background && textNode.background.layers.length > 0;
  const hasBorder = textNode.border && hasBorderWidth(textNode.border);

  if (!hasBackground && !hasBorder) {
    return textNode;
  }

  // Create wrapper container
  const wrapper: DesignContainerNode = {
    id: textNode.id + '_wrapper',
    name: textNode.name + '_wrapper',
    tag: textNode.tag,
    role: 'container',
    nodeType: 'container',
    bounds: { ...textNode.bounds },
    visible: textNode.visible,
    opacity: textNode.opacity,
    positioning: { ...textNode.positioning },
    transform: textNode.transform ? { ...textNode.transform } : undefined,
    children: [textNode],
    layout: {
      display: 'flex',
      flex: {
        direction: 'row',
        wrap: 'nowrap',
        justifyContent: 'center',
        alignItems: 'center',
        gap: { row: 0, column: 0 },
      },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    background: textNode.background || { layers: [] },
    border: textNode.border || zeroBorder(),
    effects: { boxShadows: [] },
    overflow: 'visible',
  };

  // Clear background/border from text node (moved to wrapper)
  textNode.background = undefined;
  textNode.border = undefined;
  // Text node becomes relative to wrapper
  textNode.bounds = {
    x: 0,
    y: 0,
    width: textNode.bounds.width,
    height: textNode.bounds.height,
  };
  textNode.positioning = { mode: 'static' };

  return wrapper;
}

/**
 * When a visual container (with background/border) contains only text children,
 * switch its layout to flex with centering. This compensates for the fact that
 * Figma text height (based on lineHeight) often exceeds the container height
 * (based on CSS font metrics + padding), and centering keeps text visually
 * aligned within the container bounds.
 */
export function centerTextInVisualContainer(container: DesignContainerNode): void {
  // Only apply to containers with visual styling
  const hasBg = container.background && container.background.layers.length > 0
    && container.background.layers.some(l => l.type === 'color' ? l.color.a > 0 : true);
  const hasBrd = container.border && hasBorderWidth(container.border);
  if (!hasBg && !hasBrd) return;

  // Only apply when all children are text nodes
  if (container.children.length === 0) return;
  const allText = container.children.every(c => c.nodeType === 'text');
  if (!allText) return;

  // Skip textarea — text should start from the top, not be centered
  if (container.tag === 'textarea') return;

  // If already a flex container, just ensure vertical centering without overwriting
  // the existing justify/direction settings from CSS.
  const display = container.layout.display;
  if (display === 'flex' || display === 'inline-flex') {
    if (container.layout.flex) {
      container.layout.flex.alignItems = 'center';
    }
    return;
  }

  // Convert inline/inline-block to inline-flex with centering.
  const isInline = display === 'inline' || display === 'inline-block';

  // Also convert block containers that need centering:
  // - <button> / <input> elements: browsers vertically center their content by default
  // - Block containers with text-align: center and fixed height > text content height
  const isFormElement = container.tag === 'button' || container.tag === 'input';
  const textAlign = container.layout.textAlign;
  const hasTextCenter = textAlign === 'center';
  const isBlock = display === 'block';
  const needsBlockCenter = isBlock && (isFormElement || hasTextCenter);

  if (!isInline && !needsBlockCenter) return;

  container.layout.display = isInline ? 'inline-flex' : 'flex';
  let justifyContent = 'flex-start';
  if (textAlign === 'center' || isFormElement) justifyContent = 'center';
  else if (textAlign === 'right') justifyContent = 'flex-end';

  container.layout.flex = {
    direction: 'row',
    wrap: 'nowrap',
    justifyContent,
    alignItems: 'center',
    gap: { row: 0, column: 0 },
  };
}

// ==================== Helpers ====================

function hasBorderWidth(border: BorderInfo): boolean {
  return border.top.width > 0 || border.right.width > 0 ||
         border.bottom.width > 0 || border.left.width > 0;
}

function zeroBorder(): BorderInfo {
  const side = { width: 0, style: 'none' as const, color: { r: 0, g: 0, b: 0, a: 0 } };
  return {
    top: { ...side },
    right: { ...side },
    bottom: { ...side },
    left: { ...side },
    radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
  };
}
