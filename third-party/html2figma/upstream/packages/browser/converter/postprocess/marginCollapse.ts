/**
 * Margin collapse post-processor.
 * Wraps children with non-zero margins in transparent wrapper frames,
 * so each child's margin is handled individually rather than through a uniform gap.
 *
 * Handles:
 * - Vertical margin collapse between adjacent siblings (CSS standard)
 * - Horizontal margins (margin-left / margin-right) as wrapper padding
 */

import type { DesignNode, DesignContainerNode, LayoutInfo } from '@html2figma/shared';
import { createLogger, LogModule } from '@html2figma/shared';
import { generateId } from '../utils';

const logger = createLogger(LogModule.NODE_TRAVERSER);

interface MarginPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Read margin from any node type (container via layout.margin, others via node.margin) */
function getNodeMargin(node: DesignNode): MarginPadding {
  if (node.nodeType === 'container') {
    return (node as DesignContainerNode).layout.margin;
  }
  return node.margin || { top: 0, right: 0, bottom: 0, left: 0 };
}

/** Clear margin on any node type */
function clearNodeMargin(node: DesignNode): void {
  if (node.nodeType === 'container') {
    (node as DesignContainerNode).layout.margin = { top: 0, right: 0, bottom: 0, left: 0 };
  } else if (node.margin) {
    node.margin = undefined;
  }
}

/**
 * Create a transparent wrapper frame that represents margins as padding.
 * When parentFlex is provided, the wrapper inherits the parent's flex
 * alignment so that content inside the wrapper is aligned the same way
 * the parent would align it (e.g. vertically centered).
 *
 * @param rawMargin - Original margins (may be negative). When provided,
 *   wrapper bounds use net margin for flow space calculation. Padding
 *   (clamped ≥0) still positions the child correctly inside the wrapper.
 *   Figma FIXED sizing keeps the wrapper narrow; child overflows visibly.
 */
function createMarginWrapper(
  child: DesignNode,
  padding: MarginPadding,
  parentFlex?: LayoutInfo['flex'],
  rawMargin?: MarginPadding,
): DesignContainerNode {
  // Determine wrapper layout: inherit parent flex alignment for cross-axis centering
  const layout: LayoutInfo = parentFlex
    ? {
        display: 'flex',
        flex: {
          direction: parentFlex.direction,
          wrap: 'nowrap',
          justifyContent: 'flex-start',
          alignItems: parentFlex.alignItems,
          gap: { row: 0, column: 0 },
        },
        padding,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      }
    : {
        display: 'block',
        padding,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      };

  // When rawMargin has negative values, use net margin for bounds so the wrapper
  // takes the correct flow space. Padding (clamped) still offsets the child.
  // Figma FIXED sizing respects this smaller width; child overflows with overflow:visible.
  let boundsWidth: number;
  let boundsHeight: number;
  if (rawMargin) {
    boundsWidth = Math.max(1, child.bounds.width + rawMargin.left + rawMargin.right);
    boundsHeight = Math.max(1, child.bounds.height + rawMargin.top + rawMargin.bottom);
  } else {
    boundsWidth = child.bounds.width + padding.left + padding.right;
    boundsHeight = child.bounds.height + padding.top + padding.bottom;
  }

  return {
    id: generateId('margin'),
    name: 'margin-wrapper',
    tag: 'div',
    role: 'container',
    nodeType: 'container',
    bounds: {
      x: child.bounds.x - padding.left,
      y: child.bounds.y - padding.top,
      width: boundsWidth,
      height: boundsHeight,
    },
    visible: true,
    opacity: 1,
    positioning: { mode: 'static' },
    children: [child],
    layout,
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

/** Threshold: margins ≤ this trigger the absolute-positioning fallback */
const NEGATIVE_MARGIN_THRESHOLD = -3;

/**
 * Handle a child with significant negative margins by converting it to
 * absolute positioning + an invisible flow placeholder.
 *
 * Strategy:
 *   1. Convert the child to absolute positioning at its browser-computed
 *      position (relativized to the container). It overlaps visually but
 *      doesn't participate in auto-layout flow.
 *   2. Insert an invisible flow placeholder whose size equals the child's
 *      reduced flow contribution (childSize + negativeMargin). This prevents
 *      subsequent siblings from collapsing into the space.
 *
 * Note: relativeizeAbsoluteChildren() has already run by the time
 * collapseMargins() executes, so we manually relativize the child's
 * coordinates here.
 */
function convertToAbsoluteWithPlaceholder(
  child: DesignNode,
  margins: MarginPadding,
  container: DesignContainerNode,
): { placeholder: DesignContainerNode; absoluteChild: DesignNode } {
  // Flow contribution: child size reduced by negative margins
  const flowWidth = Math.max(1, child.bounds.width
    + Math.min(0, margins.left) + Math.min(0, margins.right));
  const flowHeight = Math.max(1, child.bounds.height
    + Math.min(0, margins.top) + Math.min(0, margins.bottom));

  logger.info('[convertToAbsoluteWithPlaceholder]', child.name, {
    margins,
    childBounds: child.bounds,
    flowSize: { w: flowWidth, h: flowHeight },
  });

  // Create invisible flow placeholder at the child's position
  const placeholder: DesignContainerNode = {
    id: generateId('neg-placeholder'),
    name: 'neg-margin-placeholder',
    tag: 'div',
    role: 'container',
    nodeType: 'container',
    bounds: {
      x: child.bounds.x,
      y: child.bounds.y,
      width: flowWidth,
      height: flowHeight,
    },
    visible: true,
    opacity: 0,
    positioning: { mode: 'static' },
    children: [],
    layout: {
      display: 'block',
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

  // Convert child to absolute positioning.
  // relativeizeAbsoluteChildren() already ran, so manually relativize to container.
  child.positioning = { mode: 'absolute' };
  child.bounds = {
    ...child.bounds,
    x: child.bounds.x - container.bounds.x,
    y: child.bounds.y - container.bounds.y,
  };

  return { placeholder, absoluteChild: child };
}

/**
 * Check if a margin set has any significant negative values (beyond threshold).
 */
function hasSignificantNegativeMargin(margin: MarginPadding): boolean {
  return margin.top <= NEGATIVE_MARGIN_THRESHOLD
    || margin.bottom <= NEGATIVE_MARGIN_THRESHOLD
    || margin.left <= NEGATIVE_MARGIN_THRESHOLD
    || margin.right <= NEGATIVE_MARGIN_THRESHOLD;
}

/**
 * Handle margin collapse between children of a block container.
 * Instead of computing a single uniform gap, wraps each child
 * in a transparent frame whose padding equals the effective margins.
 *
 * Handles:
 * - Collapsed vertical margins between adjacent children (block layout)
 * - Horizontal margins (margin-left / margin-right)
 * - Flex/grid child margins (no collapse, direct wrapping)
 */
export function collapseMargins(container: DesignContainerNode): void {
  const display = container.layout.display;
  const isFlex = display === 'flex' || display === 'inline-flex'
    || display === 'grid' || display === 'inline-grid';

  // Skip margin collapse for table-internal elements — table cells don't
  // have CSS margin, and margin-wrappers create unwanted gaps.
  const tag = container.tag;
  if (tag === 'tr' || tag === 'thead' || tag === 'tbody' || tag === 'tfoot'
    || tag === 'table' || tag === 'th' || tag === 'td') {
    return;
  }

  if (isFlex) {
    logger.info('[collapseMargins] flex path', container.name, 'display=' + display);
    collapseFlexMargins(container);
    return;
  }

  const children = container.children;
  if (children.length === 0) return;

  logger.info('[collapseMargins] block path', container.name, 'display=' + display, 'children=' + children.length);

  // Container's content-area top edge (root-relative).
  // getBoundingClientRect includes border, so content starts after border + padding.
  const borderTop = container.border?.top?.width || 0;
  const paddingTop = container.layout.padding?.top || 0;
  const containerContentTop = container.bounds.y + borderTop + paddingTop;

  // Collect flow children (non-absolute/fixed) with their original indices
  const flowChildren: { index: number; node: DesignNode }[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.positioning?.mode === 'absolute' || child.positioning?.mode === 'fixed') continue;
    flowChildren.push({ index: i, node: child });
  }

  if (flowChildren.length === 0) return;

  const newChildren: DesignNode[] = [];
  let deferredGap = 0; // gap deferred from a zero-height sibling to the next real element

  for (let i = 0; i < children.length; i++) {
    const current = children[i];

    // Pass through absolute/fixed children unchanged
    if (current.positioning?.mode === 'absolute' || current.positioning?.mode === 'fixed') {
      newChildren.push(current);
      continue;
    }

    const flowIdx = flowChildren.findIndex(fc => fc.index === i);

    // Get margins from current child (works for all node types).
    const currentMargin = getNodeMargin(current);

    // Significant negative margins → absolute positioning + flow placeholder
    if (hasSignificantNegativeMargin(currentMargin)) {
      logger.info('[collapseMargins] negative margin child → absolute', current.name, currentMargin);

      if (current.nodeType === 'container') {
        const c = current as DesignContainerNode;
        c.layout.margin = { top: 0, right: 0, bottom: 0, left: 0 };
      }
      clearNodeMargin(current);

      const { placeholder, absoluteChild } = convertToAbsoluteWithPlaceholder(
        current, currentMargin, container,
      );
      newChildren.push(placeholder);
      newChildren.push(absoluteChild);
      continue;
    }

    // Clamp negative margins to 0 for padding; raw values used for bounds calculation.
    const ml = Math.max(0, currentMargin.left);
    const mr = Math.max(0, currentMargin.right);
    const hasNegativeH = currentMargin.left < 0 || currentMargin.right < 0;

    // Compute vertical gap above from browser bounds.
    // For the first flow child: gap from container content top to child top.
    // For subsequent children: absorb any deferred gap from the previous sibling
    // (when the previous sibling was a zero-height element, its gap is deferred
    // to the next sibling's gapAbove instead of inflating an empty wrapper).
    // Skip for text nodes — their line-height vertical offset is already handled
    // by Figma's lineHeight property; adding it as padding would duplicate it.
    let gapAbove = deferredGap;
    deferredGap = 0;
    if (flowIdx === 0 && current.nodeType !== 'text' && !container.layout.lineClamp) {
      gapAbove += Math.max(0, Math.round(current.bounds.y - containerContentTop));
    }

    // Compute vertical gap below from browser bounds (to next flow sibling).
    // Skip when both current and next are text nodes (pure line-height gap).
    // When at least one is a non-text node, the gap likely includes CSS margins
    // or other meaningful visual spacing.
    //
    // When the current element has zero height, defer the gap to the next sibling's
    // gapAbove. Placing paddingBottom on a zero-height wrapper creates an inflated
    // empty box; it's better to let the next real element carry the spacing.
    let gapBelow = 0;
    if (flowIdx >= 0 && flowIdx < flowChildren.length - 1) {
      const next = flowChildren[flowIdx + 1].node;
      const currentBottom = current.bounds.y + current.bounds.height;
      const gap = Math.max(0, Math.round(next.bounds.y - currentBottom));
      if (gap > 0 && !(current.nodeType === 'text' && next.nodeType === 'text')) {
        if (current.bounds.height === 0) {
          deferredGap += gap;
        } else {
          gapBelow = gap;
        }
      }
    }

    const needsWrapper = ml > 0 || mr > 0 || gapAbove > 0 || gapBelow > 0;

    logger.info('[collapseMargins] child', current.name, 'nodeType=' + current.nodeType, 'flowIdx=' + flowIdx, { ml, mr, gapAbove, gapBelow, needsWrapper });

    // Clear vertical margins for all flow children
    if (current.nodeType === 'container') {
      const c = current as DesignContainerNode;
      c.layout.margin = { ...c.layout.margin, top: 0, bottom: 0 };
    }

    if (needsWrapper) {
      clearNodeMargin(current);
      // Pass raw horizontal margins for bounds calculation when negative
      const rawMargin = hasNegativeH
        ? { left: currentMargin.left, right: currentMargin.right, top: 0, bottom: 0 }
        : undefined;
      newChildren.push(createMarginWrapper(current, {
        top: gapAbove,
        right: mr,
        bottom: gapBelow,
        left: ml,
      }, undefined, rawMargin));
    } else {
      newChildren.push(current);
    }
  }

  container.children = newChildren;
}

/**
 * Handle margins for flex/grid children.
 * CSS margins don't collapse in flex/grid layout — each child's
 * margin is applied directly. Wrap children that have non-zero
 * margins in transparent margin-wrapper frames.
 */
function collapseFlexMargins(container: DesignContainerNode): void {
  const children = container.children;
  if (children.length === 0) return;

  const parentFlex = container.layout.flex;
  const newChildren: DesignNode[] = [];

  for (const child of children) {
    // Pass through absolute/fixed children unchanged
    if (child.positioning?.mode === 'absolute' || child.positioning?.mode === 'fixed') {
      newChildren.push(child);
      continue;
    }

    const childMargin = getNodeMargin(child);

    // Significant negative margins → absolute positioning + flow placeholder
    if (hasSignificantNegativeMargin(childMargin)) {
      logger.info('[collapseFlexMargins] negative margin child → absolute', child.name, childMargin);
      clearNodeMargin(child);

      const { placeholder, absoluteChild } = convertToAbsoluteWithPlaceholder(
        child, childMargin, container,
      );
      newChildren.push(placeholder);
      newChildren.push(absoluteChild);
      continue;
    }

    // Clamp negative margins to 0 for padding (Figma can't have negative padding).
    // But pass raw margins to createMarginWrapper so it can calculate the correct
    // flow space (negative margins reduce the wrapper's effective width).
    let mt = Math.max(0, childMargin.top);
    let mb = Math.max(0, childMargin.bottom);
    let ml = Math.max(0, childMargin.left);
    let mr = Math.max(0, childMargin.right);

    // In Figma, the margin-wrapper inherits the parent's alignItems. When the
    // parent uses cross-axis centering, keeping cross-axis margins as padding
    // would shift the centering incorrectly. Drop cross-axis margins for
    // non-stretch alignment — the wrapper's alignItems already handles it.
    if (parentFlex) {
      const isRow = parentFlex.direction === 'row' || parentFlex.direction === 'row-reverse';
      const align = parentFlex.alignItems;
      if (align && align !== 'stretch') {
        if (isRow) {
          mt = 0;
          mb = 0;
        } else {
          ml = 0;
          mr = 0;
        }
      }
    }
    const hasNegative = childMargin.top < 0 || childMargin.right < 0
      || childMargin.bottom < 0 || childMargin.left < 0;

    if (mt > 0 || mr > 0 || mb > 0 || ml > 0) {
      clearNodeMargin(child);
      newChildren.push(createMarginWrapper(child, {
        top: mt, right: mr, bottom: mb, left: ml,
      }, parentFlex, hasNegative ? childMargin : undefined));
    } else {
      clearNodeMargin(child);
      newChildren.push(child);
    }
  }

  container.children = newChildren;
}
