/**
 * Stacking order post-processor.
 * Sorts children following CSS stacking order within a container.
 *
 * Core challenge: In Figma auto-layout, child order determines BOTH layout
 * position AND paint (layer) order. CSS separates these concerns — z-index
 * controls paint order independently of DOM/flow order.
 *
 * Solution: When a flow child (position:relative) needs to change its
 * stacking position, promote it to position:absolute so Figma positions
 * it by coordinates (independent of array order), then freely reorder.
 * For relative+auto (no explicit z-index), promotion only happens when
 * the element visually overlaps a static sibling — otherwise the layer
 * order difference is invisible and keeping flow preserves auto-layout.
 */

import type { DesignNode, DesignContainerNode } from '@html2figma/shared';
import { generateId } from '../utils';

/**
 * Determine if a node creates a new stacking context.
 * CSS spec: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_positioned_layout/Stacking_context
 */
export function createsStackingContext(node: DesignNode): boolean {
  // Check positioning + z-index
  const isPositioned = node.positioning.mode === 'absolute' ||
    node.positioning.mode === 'relative' ||
    node.positioning.mode === 'fixed' ||
    node.positioning.mode === 'sticky';
  if (isPositioned && node.positioning.zIndex !== undefined) return true;

  // opacity < 1
  if (node.opacity < 1) return true;

  // transform
  if (node.transform) return true;

  // Container-specific checks
  if (node.nodeType === 'container') {
    const container = node as DesignContainerNode;
    // filter or backdrop-filter
    if (container.effects.filters?.length) return true;
    if (container.effects.backdropFilters?.length) return true;
    // blend mode
    if (container.effects.blendMode && container.effects.blendMode !== 'normal') return true;
    // isolation: isolate is captured in rawStyles
    if (container.rawStyles?.['isolation'] === 'isolate') return true;
    // clip-path or mask (from rawStyles)
    if (container.rawStyles?.['clip-path'] && container.rawStyles['clip-path'] !== 'none') return true;
  }

  return false;
}

/**
 * Sort children following CSS stacking order within a container.
 *
 * CSS painting order within a stacking context (bottom to top):
 *   1. Children with negative z-index
 *   2. Non-positioned (static) flow children — DOM order
 *   3. Positioned children with z-index: auto — DOM order, above static
 *   4. Children with positive z-index
 *
 * position: relative with explicit z-index creates a stacking context
 * and participates in z-index sorting (treated like absolute/fixed for ordering).
 *
 * position: relative WITHOUT explicit z-index stays in flow order but
 * paints above static children per CSS spec (group 3).
 */
export function sortByStackingOrder(container: DesignContainerNode): void {
  if (!container.children || container.children.length <= 1) return;

  // Check if any child needs z-index reordering.
  // position:relative (even with z-index:auto) paints above static siblings per CSS spec
  // (painting order group 3 vs group 2), so we need sorting when relative and static mix.
  const hasRelative = container.children.some(c => c.positioning.mode === 'relative');
  const hasStatic = container.children.some(c => c.positioning.mode === 'static');
  const needsSorting = container.children.some(child => {
    const mode = child.positioning.mode;
    if (mode === 'absolute' || mode === 'fixed') return true;
    if (mode === 'relative' && child.positioning.zIndex !== undefined) return true;
    return false;
  }) || (hasRelative && hasStatic);

  if (!needsSorting) return;

  // Promote positioned flow children to absolute so they can be freely reordered.
  // This includes relative+z-index AND relative+auto (which paints above static per CSS spec).
  promoteRelativeChildren(container);

  // Now all children that participate in z-index sorting are either
  // absolute or fixed — safe to reorder without breaking layout.
  sortAutoLayoutStackingOrder(container);
}

/**
 * Promote `position:relative` children to `position:absolute`.
 *
 * In CSS, position:relative elements stay in flow but paint above static
 * siblings (painting order group 3 vs group 2). Those with explicit z-index
 * also participate in z-index sorting. In Figma auto-layout, reordering
 * flow children breaks layout.
 *
 * By promoting these to absolute:
 * - Their coordinates (already computed by the browser) position them correctly
 * - They no longer participate in auto-layout flow
 * - They can be freely reordered for correct stacking
 *
 * A flow placeholder is inserted at the original position to preserve the
 * layout space the element occupied. Without this, subsequent flow children
 * would collapse into the vacated space.
 *
 * Only promotes when the relative child actually needs to change stacking
 * position (i.e., its paint level differs from DOM order).
 */
function promoteRelativeChildren(container: DesignContainerNode): void {
  const parentX = container.bounds.x;
  const parentY = container.bounds.y;

  // Collect info about all children to determine if promotion is needed
  type ChildInfo = {
    child: DesignNode;
    domIndex: number;
    isRelative: boolean;
    isRelativeWithZ: boolean;
    zIndex: number | undefined;
  };

  const infos: ChildInfo[] = container.children.map((child, i) => {
    const mode = child.positioning.mode;
    const zIndex = child.positioning.zIndex;
    return {
      child,
      domIndex: i,
      isRelative: mode === 'relative',
      isRelativeWithZ: mode === 'relative' && zIndex !== undefined,
      zIndex,
    };
  });

  // Collect static siblings' bounds for overlap testing
  const staticBounds = infos
    .filter(i => i.child.positioning.mode === 'static')
    .map(i => i.child.bounds);

  // Determine which relative children actually need promotion.
  // Build new children array, replacing promoted children with placeholders
  // and appending the promoted (now absolute) children.
  const promotedChildren: DesignNode[] = [];
  const newChildren: DesignNode[] = [];

  for (const info of infos) {
    // Promote relative+z-index when needsPromotion says so
    const promoteWithZ = info.isRelativeWithZ && needsPromotion(info, infos);
    // Promote relative+auto only when it visually overlaps a static sibling.
    // Without overlap, layer order is invisible — keep it in flow to preserve auto-layout.
    const promoteAuto = info.isRelative && !info.isRelativeWithZ
      && staticBounds.some(sb => boundsOverlap(info.child.bounds, sb));

    if (!promoteWithZ && !promoteAuto) {
      newChildren.push(info.child);
      continue;
    }

    const child = info.child;

    // Create an invisible flow placeholder to preserve layout space.
    // The placeholder occupies the same bounds as the original element
    // so that auto-layout doesn't collapse.
    const placeholder: DesignContainerNode = {
      id: generateId('z-placeholder'),
      name: 'z-index-placeholder',
      tag: 'div',
      role: 'container',
      nodeType: 'container',
      bounds: { ...child.bounds },
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
    newChildren.push(placeholder);

    // Convert coordinates from root-relative to parent-relative
    // (same as relativeizeAbsoluteChildren does for absolute nodes).
    // At this point in the pipeline, flow children still have root-relative coords
    // (relativizeAllFlowCoordinates runs later, after the whole tree is built).
    child.bounds = {
      ...child.bounds,
      x: child.bounds.x - parentX,
      y: child.bounds.y - parentY,
    };

    // Promote to absolute
    child.positioning = {
      ...child.positioning,
      mode: 'absolute',
    };

    promotedChildren.push(child);
  }

  // Append promoted children after flow children (they'll be sorted by sortAutoLayoutStackingOrder)
  container.children = [...newChildren, ...promotedChildren];
}

/**
 * Check if a relative+z-index child needs promotion to absolute.
 *
 * Returns true if the child's z-index would cause it to paint in a
 * different position relative to its siblings than its DOM order implies.
 *
 * Cases where promotion IS needed:
 * - z-index > 0: should paint above later static siblings → needs to move after them
 * - z-index < 0: should paint below earlier static siblings → needs to move before them
 * - z-index = 0: paints at same level as static siblings in DOM order,
 *   but still above static siblings per CSS spec (positioned > non-positioned).
 *   However, since Figma auto-layout already respects DOM order, this is usually fine.
 *   Only promote if there are absolute/fixed siblings that would interleave.
 */
function needsPromotion(
  target: { domIndex: number; zIndex: number | undefined },
  allChildren: { domIndex: number; isRelativeWithZ: boolean; zIndex: number | undefined; child: DesignNode }[],
): boolean {
  const z = target.zIndex ?? 0;

  // Non-zero z-index always needs promotion — it must change stacking position
  if (z !== 0) return true;

  // z-index: 0 — only promote if there are absolute/fixed siblings.
  // Without abs/fixed siblings, sortAutoLayoutStackingOrder won't reorder anything,
  // so the relative element stays in DOM order (correct).
  // With abs/fixed siblings, the sort may interleave them, and the relative
  // element's z-level (0) needs to be correctly compared against abs siblings.
  const hasAbsFixed = allChildren.some(info => {
    const mode = info.child.positioning.mode;
    return mode === 'absolute' || mode === 'fixed';
  });

  return hasAbsFixed;
}

/**
 * Sort children for Figma auto-layout containers.
 *
 * After promoteRelativeChildren, all children that need z-index reordering
 * are absolute/fixed. Flow children (static, non-overlapping relative) stay
 * in DOM order to preserve auto-layout.
 *
 * Strategy:
 * 1. Keep flow children in DOM order (preserving layout).
 * 2. Compute each flow child's effective z-level for stacking purposes:
 *    - static / relative without z-index → z-level 0 (auto)
 * 3. Insert absolute/fixed children at positions that respect CSS stacking order:
 *    - abs with negative z-index → before any flow child with z-level >= 0
 *    - abs with z-index: auto (or 0) → after flow children with z-level <= 0,
 *      respecting DOM order among same-level elements
 *    - abs with positive z-index → after flow children with lower z-level
 */
function sortAutoLayoutStackingOrder(container: DesignContainerNode): void {
  type Entry = { child: DesignNode; domIndex: number; zLevel: number };

  const flowEntries: Entry[] = [];
  const absEntries: Entry[] = [];

  container.children.forEach((child, i) => {
    const mode = child.positioning.mode;
    const zIndex = child.positioning.zIndex;
    const isOutOfFlow = mode === 'absolute' || mode === 'fixed';

    if (isOutOfFlow) {
      absEntries.push({ child, domIndex: i, zLevel: zIndex ?? 0 });
    } else {
      // CSS painting order: positioned elements (relative) with z-index:auto
      // paint above non-positioned (static) siblings (group 3 vs group 2).
      // Use 0 for relative (auto) and -0.5 for static so that relative nodes
      // sort above static nodes while remaining below z-index:0 abs nodes in DOM order.
      const isPositioned = mode === 'relative' || mode === 'sticky';
      flowEntries.push({ child, domIndex: i, zLevel: isPositioned ? 0 : -0.5 });
    }
  });

  if (absEntries.length === 0) return;

  // Sort absolute entries by z-level, then DOM order
  absEntries.sort((a, b) => a.zLevel - b.zLevel || a.domIndex - b.domIndex);

  // Build result: flow children stay in DOM order, absolute children are
  // interleaved at the correct stacking positions.
  //
  // An absolute child with z-level Z should be placed:
  // - After all flow children with z-level < Z
  // - After all flow children with z-level == Z that appear before it in DOM
  // - Before flow children with z-level > Z
  const result: DesignNode[] = [];
  let absIdx = 0;

  for (let flowIdx = 0; flowIdx <= flowEntries.length; flowIdx++) {
    while (absIdx < absEntries.length) {
      const abs = absEntries[absIdx];

      if (flowIdx < flowEntries.length) {
        const flow = flowEntries[flowIdx];

        // Insert this absolute child before the current flow child if:
        // 1. abs z-level < flow z-level, OR
        // 2. abs z-level == flow z-level AND abs appeared before flow in DOM
        if (abs.zLevel < flow.zLevel ||
            (abs.zLevel === flow.zLevel && abs.domIndex < flow.domIndex)) {
          result.push(abs.child);
          absIdx++;
          continue;
        }
      } else {
        // After all flow children: append remaining absolute children
        result.push(abs.child);
        absIdx++;
        continue;
      }
      break;
    }

    if (flowIdx < flowEntries.length) {
      result.push(flowEntries[flowIdx].child);
    }
  }

  container.children = result;
}

/** Check if two bounding boxes overlap (edges touching counts as no overlap). */
function boundsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}
