/**
 * Layout Mapper - CSS layout semantics → Figma Auto Layout
 */

import type { LayoutInfo, PositioningInfo } from '@html2figma/shared';
import type { FigmaFrameNode } from '@html2figma/shared';

/**
 * Map CSS layout to Figma auto layout properties
 */
export function mapLayout(layout: LayoutInfo): Partial<FigmaFrameNode> {
  // Float containers use manual layout (NONE) — only preserve padding
  if (layout.hasFloatChildren) {
    return {
      paddingTop: Math.round(layout.padding.top),
      paddingRight: Math.round(layout.padding.right),
      paddingBottom: Math.round(layout.padding.bottom),
      paddingLeft: Math.round(layout.padding.left),
    };
  }

  const props: Partial<FigmaFrameNode> = {};

  // Display → layoutMode
  if (layout.display === 'flex' || layout.display === 'inline-flex') {
    props.layoutMode = mapFlexDirection(layout.flex?.direction);
    if (layout.flex) {
      props.primaryAxisAlignItems = mapJustifyContent(layout.flex.justifyContent);
      props.counterAxisAlignItems = mapAlignItems(layout.flex.alignItems);

      // row-reverse / column-reverse: Figma doesn't have reverse layouts, so we
      // reverse the child order (in mapContainerChildren). But justify-content
      // also needs flipping: flex-start in row-reverse means "pack to the right"
      // (the end of the normal axis), which is MAX in Figma.
      const isReversed = layout.flex.direction === 'row-reverse' || layout.flex.direction === 'column-reverse';
      if (isReversed) {
        props.primaryAxisAlignItems = flipAlignment(props.primaryAxisAlignItems);
      }

      props.itemSpacing = layout.flex.direction?.includes('column')
        ? layout.flex.gap.row
        : layout.flex.gap.column;

      // Wrap
      if (layout.flex.wrap === 'wrap' || layout.flex.wrap === 'wrap-reverse') {
        props.layoutWrap = 'WRAP';
        props.counterAxisSpacing = layout.flex.direction?.includes('column')
          ? layout.flex.gap.column
          : layout.flex.gap.row;
      }

      // Both axes FIXED — browser already computed exact dimensions.
      // FIXED preserves the browser-rendered size and allows centering
      // (AUTO/hug would collapse the axis, leaving no room for alignment).
      props.primaryAxisSizingMode = 'FIXED';
      props.counterAxisSizingMode = 'FIXED';
    }
  } else if (layout.display === 'grid' || layout.display === 'inline-grid') {
    // Grid → approximate as VERTICAL auto layout
    props.layoutMode = 'VERTICAL';
    props.primaryAxisAlignItems = 'MIN';
    props.counterAxisAlignItems = 'MIN';
    if (layout.grid) {
      props.itemSpacing = layout.grid.gap.row;
    }
  } else if (layout.display === 'inline') {
    // Inline containers flow children horizontally (like inline formatting context)
    props.layoutMode = 'HORIZONTAL';
    props.primaryAxisAlignItems = 'MIN';
    props.counterAxisAlignItems = 'CENTER';
    props.primaryAxisSizingMode = 'FIXED';
    props.counterAxisSizingMode = 'FIXED';
  } else {
    // Block/inline-block → VERTICAL auto layout (CSS block flows vertically)
    props.layoutMode = 'VERTICAL';
    props.primaryAxisAlignItems = 'MIN';
    // Map text-align to counter axis alignment (for inline/inline-block children)
    if (layout.textAlign === 'center') {
      props.counterAxisAlignItems = 'CENTER';
    } else if (layout.textAlign === 'right') {
      props.counterAxisAlignItems = 'MAX';
    } else {
      props.counterAxisAlignItems = 'MIN';
    }
    props.primaryAxisSizingMode = 'AUTO';  // height: auto (hug contents)
    props.counterAxisSizingMode = 'FIXED'; // width: fills parent
  }

  // Padding
  props.paddingTop = Math.round(layout.padding.top);
  props.paddingRight = Math.round(layout.padding.right);
  props.paddingBottom = Math.round(layout.padding.bottom);
  props.paddingLeft = Math.round(layout.padding.left);

  // Sizing constraints
  if (layout.sizing) {
    if (layout.sizing.minWidth) props.minWidth = Math.round(layout.sizing.minWidth);
    if (layout.sizing.maxWidth) props.maxWidth = Math.round(layout.sizing.maxWidth);
    if (layout.sizing.minHeight) props.minHeight = Math.round(layout.sizing.minHeight);
    if (layout.sizing.maxHeight) props.maxHeight = Math.round(layout.sizing.maxHeight);
  }

  return props;
}

/**
 * Map CSS overflow → Figma clipsContent
 */
export function mapOverflow(overflow: string): boolean {
  return overflow === 'hidden' || overflow === 'scroll' || overflow === 'auto';
}

/**
 * Map CSS positioning → Figma layoutPositioning
 */
export function mapPositioning(positioning: PositioningInfo): Partial<FigmaFrameNode> {
  const props: Partial<FigmaFrameNode> = {};

  if (positioning.mode === 'absolute' || positioning.mode === 'fixed') {
    props.layoutPositioning = 'ABSOLUTE';
  }

  return props;
}

/**
 * Infer Figma constraints for an absolute child from its position within the parent.
 *
 * CSS getComputedStyle resolves all offsets (top/right/bottom/left) to pixel values
 * even when they were 'auto', so we can't use offsets directly. Instead, compare
 * distances to each edge of the parent to determine the anchor direction.
 */
export function inferConstraints(
  child: { x: number; y: number; width: number; height: number },
  parent: { width: number; height: number },
): { horizontal: string; vertical: string } {
  const distL = child.x;
  const distR = parent.width - (child.x + child.width);
  const distT = child.y;
  const distB = parent.height - (child.y + child.height);

  const THRESHOLD = 3; // px tolerance for "equal distance"

  let horizontal: string;
  if (Math.abs(distL - distR) <= THRESHOLD) {
    horizontal = (distL < parent.width * 0.2) ? 'STRETCH' : 'CENTER';
  } else {
    horizontal = distL <= distR ? 'MIN' : 'MAX';
  }

  let vertical: string;
  if (Math.abs(distT - distB) <= THRESHOLD) {
    vertical = (distT < parent.height * 0.2) ? 'STRETCH' : 'CENTER';
  } else {
    vertical = distT <= distB ? 'MIN' : 'MAX';
  }

  return { horizontal, vertical };
}

// ==================== Internal mappers ====================

function mapFlexDirection(direction?: string): 'HORIZONTAL' | 'VERTICAL' {
  if (direction === 'column' || direction === 'column-reverse') return 'VERTICAL';
  return 'HORIZONTAL';
}

function mapJustifyContent(value?: string): FigmaFrameNode['primaryAxisAlignItems'] {
  switch (value) {
    case 'center': return 'CENTER';
    case 'flex-end': case 'end': return 'MAX';
    case 'space-between': return 'SPACE_BETWEEN';
    case 'space-around': case 'space-evenly': return 'SPACE_BETWEEN';
    default: return 'MIN';
  }
}

function mapAlignItems(value?: string): FigmaFrameNode['counterAxisAlignItems'] {
  switch (value) {
    case 'center': return 'CENTER';
    case 'flex-end': case 'end': return 'MAX';
    case 'baseline': return 'BASELINE';
    default: return 'MIN';
  }
}

/**
 * Flip MIN↔MAX for reverse flex directions.
 * CENTER and SPACE_BETWEEN are symmetric and stay unchanged.
 */
function flipAlignment(align?: FigmaFrameNode['primaryAxisAlignItems']): FigmaFrameNode['primaryAxisAlignItems'] {
  if (align === 'MIN') return 'MAX';
  if (align === 'MAX') return 'MIN';
  return align; // CENTER, SPACE_BETWEEN unchanged
}
