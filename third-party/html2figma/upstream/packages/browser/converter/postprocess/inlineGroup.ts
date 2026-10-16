/**
 * Inline grouping post-processor.
 * Groups consecutive inline children into horizontal wrapper containers.
 */

import type { DesignNode, DesignContainerNode, DesignTextNode } from '@html2figma/shared';
import { generateId } from '../utils';
import { unionBounds } from '../utils';

/**
 * Detect if any inline child has vertical-align: middle.
 * Checks verticalAlign on DesignNodeBase (image/svg) and textStyle (text).
 * When found, the parent should use alignItems: 'center' instead of 'baseline'.
 */
function detectVerticalAlignCenter(children: DesignNode[]): boolean {
  return children.some(child => {
    // All node types can carry verticalAlign on DesignNodeBase
    if (child.verticalAlign === 'middle') return true;
    // Text nodes also have it in textStyle
    if (child.nodeType === 'text') {
      return (child as DesignTextNode).textStyle.verticalAlign === 'middle';
    }
    return false;
  });
}

/** Read horizontal margin (left or right) from any node type. */
function getHorizontalMargin(node: DesignNode, side: 'left' | 'right'): number {
  if (node.nodeType === 'container') {
    return (node as DesignContainerNode).layout.margin?.[side] || 0;
  }
  return node.margin?.[side] || 0;
}

/**
 * Check if a DesignNode is an inline element.
 */
export function isInlineNode(node: DesignNode): boolean {
  // Zero-dimension nodes are invisible and should not participate in inline flow.
  // Including them can cause inline-group wrappers to inflate to huge sizes
  // (e.g. a 0x0 display:inline container whose children are large hidden elements).
  if (node.bounds.width === 0 && node.bounds.height === 0) return false;

  // Text nodes are always inline
  if (node.nodeType === 'text') return true;

  // Container nodes with inline/inline-block display
  if (node.nodeType === 'container') {
    const display = (node as DesignContainerNode).layout.display;
    return display === 'inline' || display === 'inline-block' || display === 'inline-flex';
  }

  // SVG/image nodes are typically inline
  if (node.nodeType === 'svg' || node.nodeType === 'image') return true;

  return false;
}

/**
 * Compute gaps between consecutive inline children from browser bounds
 * and wrap children with padding to preserve the visual spacing.
 *
 * This captures both CSS margins AND HTML whitespace between inline elements,
 * since browser bounds (getBoundingClientRect) reflect the final rendered positions.
 *
 * For each child after the first, the gap to the previous sibling is applied
 * as left-padding via a margin wrapper. CSS horizontal margins are cleared
 * since the bounds-based gap subsumes them.
 */
export function applyInlineGaps(children: DesignNode[]): DesignNode[] {
  if (children.length <= 1) return children;

  const result: DesignNode[] = [];

  for (let i = 0; i < children.length; i++) {
    const child = children[i];

    // Compute gap from previous sibling's right edge to this child's left edge.
    // Browser bounds (getBoundingClientRect) don't include CSS margins, so the gap
    // between bounds naturally captures margins. However, in certain layouts
    // (e.g. -webkit-box with overflow:hidden), the bounds gap may be 0 even when
    // CSS margins exist. Fall back to explicit margin values when bounds gap is 0.
    let gapBefore = 0;
    if (i > 0) {
      const prev = children[i - 1];
      gapBefore = Math.round(child.bounds.x - (prev.bounds.x + prev.bounds.width));
      if (gapBefore < 0) gapBefore = 0;

      // Fallback: if bounds show no gap, use CSS margins from prev.right + child.left
      if (gapBefore === 0) {
        const prevMarginRight = getHorizontalMargin(prev, 'right');
        const childMarginLeft = getHorizontalMargin(child, 'left');
        gapBefore = Math.max(0, prevMarginRight + childMarginLeft);
      }
    }

    // Clear CSS horizontal margins — browser gaps subsume them
    if (child.nodeType === 'container') {
      const c = child as DesignContainerNode;
      c.layout.margin = { ...c.layout.margin, left: 0, right: 0 };
    } else if (child.margin) {
      child.margin = { ...child.margin, left: 0, right: 0 };
    }

    if (gapBefore > 0) {
      result.push(createInlineMarginWrapper(child, gapBefore, 0));
    } else {
      result.push(child);
    }
  }

  return result;
}

/**
 * Create an inline-run wrapper container for a group of inline children.
 * Uses browser bounds to compute gaps between children.
 */
export function createInlineRunWrapper(inlineNodes: DesignNode[]): DesignContainerNode {
  const wrappedChildren = applyInlineGaps(inlineNodes);
  const bounds = unionBounds(inlineNodes);
  const alignItems = detectVerticalAlignCenter(inlineNodes) ? 'center' : 'baseline';

  return {
    id: generateId('inline'),
    name: 'inline-group',
    tag: 'div',
    role: 'container',
    nodeType: 'container',
    bounds,
    visible: true,
    opacity: 1,
    positioning: { mode: 'static' },
    children: wrappedChildren,
    layout: {
      display: 'flex',
      flex: {
        direction: 'row',
        wrap: 'wrap',
        justifyContent: 'flex-start',
        alignItems,
        gap: { row: 0, column: 0 },
      },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    background: { layers: [] },
    border: {
      top: { width: 0, style: 'none', color: { r: 0, g: 0, b: 0, a: 0 } },
      right: { width: 0, style: 'none', color: { r: 0, g: 0, b: 0, a: 0 } },
      bottom: { width: 0, style: 'none', color: { r: 0, g: 0, b: 0, a: 0 } },
      left: { width: 0, style: 'none', color: { r: 0, g: 0, b: 0, a: 0 } },
      radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    },
    effects: { boxShadows: [] },
    overflow: 'visible',
  };
}

/**
 * Create a transparent wrapper that represents horizontal spacing as padding.
 * Figma doesn't support per-child margin, so we wrap the child in a frame
 * whose left/right padding equals the desired spacing.
 */
export function createInlineMarginWrapper(
  child: DesignNode,
  marginLeft: number,
  marginRight: number,
): DesignContainerNode {
  return {
    id: generateId('margin'),
    name: 'margin-wrapper',
    tag: 'div',
    role: 'container',
    nodeType: 'container',
    bounds: {
      x: child.bounds.x - marginLeft,
      y: child.bounds.y,
      width: child.bounds.width + marginLeft + marginRight,
      height: child.bounds.height,
    },
    visible: true,
    opacity: 1,
    positioning: { mode: 'static' },
    children: [child],
    layout: {
      display: 'flex',
      flex: {
        direction: 'row',
        wrap: 'nowrap',
        justifyContent: 'flex-start',
        alignItems: 'center',
        gap: { row: 0, column: 0 },
      },
      padding: { top: 0, right: marginRight, bottom: 0, left: marginLeft },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    background: { layers: [] },
    border: {
      top: { width: 0, style: 'none', color: { r: 0, g: 0, b: 0, a: 0 } },
      right: { width: 0, style: 'none', color: { r: 0, g: 0, b: 0, a: 0 } },
      bottom: { width: 0, style: 'none', color: { r: 0, g: 0, b: 0, a: 0 } },
      left: { width: 0, style: 'none', color: { r: 0, g: 0, b: 0, a: 0 } },
      radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    },
    effects: { boxShadows: [] },
    overflow: 'visible',
  };
}

/**
 * Group consecutive inline children into horizontal wrapper containers.
 * This transforms: [inline, inline, block, inline] into: [wrapper(inline, inline), block, wrapper(inline)]
 * Only applies to block containers (not flex/grid which handle layout differently).
 */
export function groupInlineChildren(container: DesignContainerNode): DesignNode[] {
  const display = container.layout.display;
  // Skip flex/grid containers — they handle their own child layout.
  // Skip inline containers — their children flow naturally in inline context;
  // changing to flex would break parent's rich text merge (e.g. <i> with pseudo-elements).
  if (display === 'flex' || display === 'inline-flex' || display === 'grid' || display === 'inline-grid'
    || display === 'inline') {
    return container.children;
  }

  const allChildren = container.children;
  // Absolute children don't participate in inline flow — exclude from classification, pass through.
  const absoluteChildren = allChildren.filter(c => c.positioning?.mode === 'absolute');
  const children = allChildren.filter(c => c.positioning?.mode !== 'absolute');
  if (children.length <= 1) return allChildren;

  // Check if there are any inline children to group
  const hasInline = children.some(isInlineNode);
  const hasBlock = children.some(c => !isInlineNode(c));
  if (!hasInline) {
    // All block — no grouping needed
    return allChildren;
  }
  if (hasInline && !hasBlock) {
    // Determine cross-axis alignment: if any child has vertical-align: middle,
    // use 'center' (Figma equivalent); otherwise default to 'baseline'.
    const alignItems = detectVerticalAlignCenter(children) ? 'center' : 'baseline';

    // lineClamp containers (-webkit-box with -webkit-line-clamp) are single-line
    // truncation — must not wrap. Regular block containers with inline children
    // may wrap naturally.
    const wrap = container.layout.lineClamp ? 'nowrap' : 'wrap';

    // All inline in a block container — switch to flex-row for horizontal flow.
    container.layout.display = 'flex';
    container.layout.flex = {
      direction: 'row',
      wrap,
      justifyContent: 'flex-start',
      alignItems,
      gap: { row: 0, column: 0 },
    };

    // Apply browser-computed gaps (includes CSS margins + HTML whitespace)
    const result = applyInlineGaps(children);
    return [...result, ...absoluteChildren];
  }

  const result: DesignNode[] = [];
  let currentInlineRun: DesignNode[] = [];

  for (const child of children) {
    if (isInlineNode(child)) {
      currentInlineRun.push(child);
    } else {
      if (currentInlineRun.length > 0) {
        result.push(createInlineRunWrapper(currentInlineRun));
        currentInlineRun = [];
      }
      result.push(child);
    }
  }

  if (currentInlineRun.length > 0) {
    result.push(createInlineRunWrapper(currentInlineRun));
  }

  return [...result, ...absoluteChildren];
}
