/**
 * Absolute position post-processor.
 * Converts absolute children's coordinates from root-relative to parent-relative.
 * Fixed children keep root-relative coordinates for later hoisting to root.
 */

import type { DesignNode, DesignContainerNode } from '@html2figma/shared';

/**
 * Convert absolute children's coordinates from root-relative to parent-relative.
 *
 * All bounds are computed relative to the root node (baseX/baseY).
 * But in Figma auto-layout, absolute children's x/y are relative to their parent frame.
 *
 * Only `position: absolute` children are relativized here.
 * `position: fixed` children keep their root-relative coordinates so they can
 * be hoisted to the root frame by `hoistFixedElements`.
 */
export function relativeizeAbsoluteChildren(container: DesignContainerNode): void {
  const parentX = container.bounds.x;
  const parentY = container.bounds.y;

  for (const child of container.children) {
    if (child.positioning.mode === 'absolute') {
      child.bounds = {
        ...child.bounds,
        x: child.bounds.x - parentX,
        y: child.bounds.y - parentY,
      };
    }
  }
}

/**
 * Hoist `position: fixed` elements from anywhere in the tree to the root container.
 *
 * In CSS, fixed elements are positioned relative to the viewport and paint above
 * normal flow. In Figma, we simulate this by moving them to the root frame as
 * absolute children (last children = topmost layer).
 *
 * Fixed elements keep their root-relative coordinates (not relativized by
 * `relativeizeAbsoluteChildren`), so they're already correctly positioned
 * relative to the root frame.
 */
export function hoistFixedElements(root: DesignContainerNode): void {
  const fixedElements: DesignNode[] = [];
  collectAndRemoveFixed(root, fixedElements, true);
  if (fixedElements.length === 0) return;

  // Remove empty containers left behind after hoisting (e.g. margin-wrappers)
  pruneEmptyContainers(root);

  // Sort by z-index so highest z-index is last (topmost in Figma)
  fixedElements.sort((a, b) =>
    (a.positioning.zIndex ?? 0) - (b.positioning.zIndex ?? 0)
  );

  root.children.push(...fixedElements);
}

/**
 * Recursively collect and remove fixed-position children from the tree.
 */
function collectAndRemoveFixed(
  container: DesignContainerNode,
  collected: DesignNode[],
  isRoot: boolean,
): void {
  const remaining: DesignNode[] = [];
  for (const child of container.children) {
    if (!isRoot && child.positioning.mode === 'fixed') {
      collected.push(child);
    } else {
      remaining.push(child);
      if (child.nodeType === 'container') {
        collectAndRemoveFixed(child as DesignContainerNode, collected, false);
      }
    }
  }
  if (!isRoot) {
    container.children = remaining;
  }
}

/**
 * Remove empty margin-wrapper containers from the tree (bottom-up).
 * After hoisting fixed elements, their margin-wrapper parents
 * may become empty and waste layout space in auto-layout.
 */
function pruneEmptyContainers(container: DesignContainerNode): void {
  for (const child of container.children) {
    if (child.nodeType === 'container') {
      pruneEmptyContainers(child as DesignContainerNode);
    }
  }
  container.children = container.children.filter(child => {
    if (child.nodeType !== 'container') return true;
    const c = child as DesignContainerNode;
    // Only prune margin-wrappers that became empty
    return !(c.name === 'margin-wrapper' && c.children.length === 0);
  });
}

/**
 * Tree-wide pass: convert ALL flow (static) children from root-relative
 * to parent-relative coordinates.
 *
 * During conversion, all bounds are computed relative to the root element
 * (viewport minus baseX/baseY). `relativeizeAbsoluteChildren` converts
 * absolute children to parent-relative, but static (flow) children keep
 * root-relative coordinates. When the Figma creator sets `node.x = rootRelativeX`
 * on a flow child, Figma interprets it as parent-relative — placing the node
 * far outside its parent frame.
 *
 * This pass walks the entire tree after all post-processing and `hoistFixedElements`,
 * converting every flow child's coordinates to parent-relative.
 *
 * Special handling:
 * - `absolute` children: already parent-relative, skip; reconstruct root-relative for recursion
 * - `fixed` children: keep root-relative coords (correct for root-level after hoisting); recurse
 * - `static` children: convert root-relative → parent-relative
 */
export function relativizeAllFlowCoordinates(root: DesignContainerNode): void {
  _relativizeRecursive(root, root.bounds.x, root.bounds.y);
}

function _relativizeRecursive(
  container: DesignContainerNode,
  containerAbsX: number,
  containerAbsY: number,
): void {
  for (const child of container.children) {
    if (child.positioning.mode === 'fixed') {
      // Fixed children at root level keep root-relative coords.
      // Recurse into their children using the fixed element's root-relative position.
      if (child.nodeType === 'container') {
        _relativizeRecursive(child as DesignContainerNode, child.bounds.x, child.bounds.y);
      }
      continue;
    }

    if (child.positioning.mode === 'absolute') {
      // Already parent-relative from relativeizeAbsoluteChildren.
      // Reconstruct root-relative for recursion into sub-tree.
      const childAbsX = child.bounds.x + containerAbsX;
      const childAbsY = child.bounds.y + containerAbsY;
      if (child.nodeType === 'container') {
        _relativizeRecursive(child as DesignContainerNode, childAbsX, childAbsY);
      }
      continue;
    }

    // Static/flow child: root-relative → parent-relative
    const childAbsX = child.bounds.x;
    const childAbsY = child.bounds.y;
    child.bounds = {
      ...child.bounds,
      x: childAbsX - containerAbsX,
      y: childAbsY - containerAbsY,
    };

    if (child.nodeType === 'container') {
      _relativizeRecursive(child as DesignContainerNode, childAbsX, childAbsY);
    }
  }
}
