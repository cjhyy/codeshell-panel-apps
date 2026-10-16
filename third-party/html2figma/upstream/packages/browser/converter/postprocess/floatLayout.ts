/**
 * Float layout post-processor.
 * Detects containers with floated children and marks them for manual layout.
 * Adjusts sibling elements' positions to avoid overlapping float elements.
 */

import type { DesignNode, DesignContainerNode } from '@html2figma/shared';

/**
 * Detect if a container has floated children and mark it with `hasFloatChildren`.
 * Float is ignored inside flex/grid containers per CSS spec, so those are skipped.
 */
export function detectFloatContainer(container: DesignContainerNode): void {
  const display = container.layout.display;

  // Float is ignored in flex/grid contexts (CSS spec)
  if (
    display === 'flex' ||
    display === 'inline-flex' ||
    display === 'grid' ||
    display === 'inline-grid'
  ) {
    return;
  }

  for (const child of container.children) {
    if (
      child.nodeType === 'container' &&
      (child as DesignContainerNode).layout.float &&
      (child as DesignContainerNode).layout.float !== 'none'
    ) {
      container.layout.hasFloatChildren = true;
      return;
    }
  }
}

interface FloatRect {
  /** Right edge of float margin box (root-relative) */
  right: number;
  /** Left edge of float margin box (root-relative) */
  left: number;
  /** Top of float (root-relative) */
  top: number;
  /** Bottom of float (root-relative) */
  bottom: number;
  side: 'left' | 'right';
}

/**
 * Adjust non-float siblings' x/width to avoid overlapping float elements.
 *
 * Called while coordinates are still root-relative (before relativizeAllFlowCoordinates).
 * For each sibling that vertically overlaps a float:
 * - float:left → shift sibling right, reduce width
 * - float:right → reduce width from right side
 *
 * Also recursively shifts all static descendants so that parent-relative
 * coordinates remain correct after relativizeAllFlowCoordinates.
 */
export function adjustFloatSiblings(container: DesignContainerNode): void {
  if (!container.layout.hasFloatChildren) return;

  // Collect float rects (margin box edges)
  const floats: FloatRect[] = [];
  for (const child of container.children) {
    if (child.nodeType !== 'container') continue;
    const c = child as DesignContainerNode;
    if (!c.layout.float || c.layout.float === 'none') continue;

    floats.push({
      right: c.bounds.x + c.bounds.width + c.layout.margin.right,
      left: c.bounds.x - c.layout.margin.left,
      top: c.bounds.y,
      bottom: c.bounds.y + c.bounds.height,
      side: c.layout.float,
    });
  }

  if (floats.length === 0) return;

  for (const child of container.children) {
    // Skip float elements themselves
    if (child.nodeType === 'container') {
      const c = child as DesignContainerNode;
      if (c.layout.float && c.layout.float !== 'none') continue;
    }

    for (const float of floats) {
      // Check vertical overlap
      const childTop = child.bounds.y;
      const childBottom = child.bounds.y + child.bounds.height;
      if (childBottom <= float.top || childTop >= float.bottom) continue;

      if (float.side === 'left') {
        const shift = float.right - child.bounds.x;
        if (shift > 0) {
          child.bounds = {
            ...child.bounds,
            x: child.bounds.x + shift,
            width: Math.max(0, child.bounds.width - shift),
          };
          // Shift all static descendants to preserve internal layout
          if (child.nodeType === 'container') {
            shiftFlowDescendants(child as DesignContainerNode, shift, 0);
          }
        }
      } else {
        // float:right — shrink width from the right
        const childRight = child.bounds.x + child.bounds.width;
        const overflow = childRight - float.left;
        if (overflow > 0) {
          child.bounds = {
            ...child.bounds,
            width: Math.max(0, child.bounds.width - overflow),
          };
        }
      }
    }
  }
}

/**
 * Recursively shift root-relative coordinates of static/flow descendants.
 * Absolute children are already parent-relative — leave them untouched.
 */
function shiftFlowDescendants(
  container: DesignContainerNode,
  dx: number,
  dy: number,
): void {
  for (const child of container.children) {
    if (child.positioning.mode === 'absolute' || child.positioning.mode === 'fixed') {
      continue;
    }
    child.bounds = {
      ...child.bounds,
      x: child.bounds.x + dx,
      y: child.bounds.y + dy,
    };
    if (child.nodeType === 'container') {
      shiftFlowDescendants(child as DesignContainerNode, dx, dy);
    }
  }
}
