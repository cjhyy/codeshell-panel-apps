/**
 * Expand collapsed (0×0 or near-zero) containers to encompass their
 * visible flow children.
 *
 * Some CSS patterns produce containers with zero dimensions that still
 * have visible children (e.g. Apple's globalnav flyout menu where a
 * `display:block` wrapper is 0×0 but children are positioned via CSS
 * custom properties and appear inline in the nav bar).
 *
 * In the browser, `overflow:visible` (the default) makes these children
 * render outside the collapsed parent. In Figma auto-layout, a 0×0 frame
 * cannot meaningfully contain its children.
 *
 * This post-processor detects such containers and:
 *   1. Expands the parent bounds to encompass all flow children
 *   2. Adjusts children's parent-relative coordinates
 *   3. Shifts the parent's position so children remain in the same
 *      absolute location
 *
 * Must run AFTER relativizeAllFlowCoordinates (children are parent-relative).
 */

import type { DesignNode, DesignContainerNode } from '@html2figma/shared';

/** Threshold: containers with both dimensions ≤ this are considered collapsed */
const COLLAPSED_THRESHOLD = 1;

export function expandCollapsedContainers(root: DesignContainerNode): void {
  _expandRecursive(root);
}

function _expandRecursive(container: DesignContainerNode): void {
  // Recurse depth-first so inner collapsed containers are fixed before outer ones
  for (const child of container.children) {
    if (child.nodeType === 'container') {
      _expandRecursive(child as DesignContainerNode);
    }
  }

  // Only process containers with near-zero dimensions
  if (container.bounds.width > COLLAPSED_THRESHOLD || container.bounds.height > COLLAPSED_THRESHOLD) {
    return;
  }

  // Only expand if overflow is visible (clipped containers should stay collapsed)
  if (container.overflow !== 'visible') {
    return;
  }

  // Collect flow children (not absolute/fixed)
  const flowChildren = container.children.filter(
    ch => ch.positioning?.mode !== 'absolute' && ch.positioning?.mode !== 'fixed',
  );
  if (flowChildren.length === 0) return;

  // Compute bounding box of all flow children (parent-relative coords)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ch of flowChildren) {
    const b = ch.bounds;
    if (b.width === 0 && b.height === 0) continue; // skip zero-size children
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }

  if (!isFinite(minX) || !isFinite(minY)) return; // all children are zero-size

  const expandedW = maxX - minX;
  const expandedH = maxY - minY;

  // Only expand if children actually extend beyond the container
  if (expandedW <= COLLAPSED_THRESHOLD && expandedH <= COLLAPSED_THRESHOLD) return;

  // Shift container position so children remain in the same absolute location.
  // Children are at parent-relative coords; shifting parent.x += minX means
  // child coords need to decrease by minX to stay in the same place.
  container.bounds = {
    x: container.bounds.x + minX,
    y: container.bounds.y + minY,
    width: expandedW,
    height: expandedH,
  };

  // Adjust all children's coordinates (both flow and absolute)
  for (const ch of container.children) {
    ch.bounds = {
      ...ch.bounds,
      x: ch.bounds.x - minX,
      y: ch.bounds.y - minY,
    };
  }
}
