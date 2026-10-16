/**
 * renderToDesignDSL - Main conversion function
 *
 * Converts a RenderNode tree (browser-specific, with DOM refs)
 * into a pure JSON DesignNode tree (serializable, no DOM refs).
 */

import type { DesignNode, DesignContainerNode, DesignTextNode } from '@html2figma/shared';
import { createLogger, LogModule } from '@html2figma/shared';
import type { RenderNode } from '../traverser/types';
import { generateId } from './utils';

const logger = createLogger(LogModule.NODE_TRAVERSER);
import {
  determineNodeType,
  buildContainerNode,
  buildTextNode,
  buildImageNode,
  buildSVGNode,
} from './nodeBuilder';
import { inlineTextWrapperEffect, centerTextInVisualContainer } from './effectResolver';
import {
  relativeizeAbsoluteChildren,
  hoistFixedElements,
  relativizeAllFlowCoordinates,
  tryMergeInlineTextRun,
  groupInlineChildren,
  collapseMargins,
  sortByStackingOrder,
  restructureGrid,
  restructureTable,
  detectFloatContainer,
  adjustFloatSiblings,
  expandCollapsedContainers,
} from './postprocess/index';


/**
 * Options for renderToDesignDSL
 */
export interface DesignDSLOptions {
  /** Include raw CSS styles in each node (default: false) */
  includeRawStyles?: boolean;
  /** Scale factor (default: 1) */
  scale?: number;
  /** Max depth (default: 100) */
  maxDepth?: number;
}

/**
 * Convert a RenderNode tree to a DesignNode tree.
 *
 * This is the primary entry point for Stage 2 of the pipeline:
 *   traverseDOM() → RenderNode → renderToDesignDSL() → DesignNode
 */
export function renderToDesignDSL(
  renderNode: RenderNode,
  options: DesignDSLOptions = {}
): DesignNode | null {
  logger.info('[convert] renderToDesignDSL called');
  const {
    includeRawStyles = false,
    scale = 1,
    maxDepth = 100,
  } = options;

  // Compute base coordinates from root node
  let baseX = 0;
  let baseY = 0;
  if (renderNode.boundingRect) {
    baseX = renderNode.boundingRect.left;
    baseY = renderNode.boundingRect.top;
  }

  const context: ConversionContext = {
    baseX,
    baseY,
    scale,
    maxDepth,
    includeRawStyles,
    depth: 0,
  };

  const result = convertNode(renderNode, null, context);

  // Hoist position:fixed elements to root for correct viewport-level layering
  if (result && result.nodeType === 'container') {
    hoistFixedElements(result as DesignContainerNode);

    // Convert all flow children from root-relative to parent-relative coordinates.
    // Must run after hoistFixedElements so hoisted elements' children are also relativized.
    relativizeAllFlowCoordinates(result as DesignContainerNode);

    // Expand collapsed (0×0) containers to encompass their visible flow children.
    // Must run after relativizeAllFlowCoordinates so coordinates are parent-relative.
    expandCollapsedContainers(result as DesignContainerNode);

    // Position <legend> on <fieldset> border.
    // Must run after relativizeAllFlowCoordinates so all coordinates are parent-relative.
    // Running inside convertContainerNode would break because the legend's coordinates
    // are still root-relative at that point, causing double-offset when relativize
    // later treats it as already parent-relative.
    adjustAllFieldsetLegends(result as DesignContainerNode);
  }

  return result;
}

// ==================== Internal ====================

interface ConversionContext {
  baseX: number;
  baseY: number;
  scale: number;
  maxDepth: number;
  includeRawStyles: boolean;
  depth: number;
}

/**
 * Recursively convert a single RenderNode
 */
function convertNode(
  node: RenderNode,
  parentNode: RenderNode | null,
  context: ConversionContext
): DesignNode | null {
  if (context.depth > context.maxDepth) return null;
  if (!node.visible) return null;

  const nodeType = determineNodeType(node);

  switch (nodeType) {
    case 'text':
      return convertTextNode(node, parentNode, context);
    case 'image':
      return convertImageNode(node, context);
    case 'svg':
      return convertSVGNode(node, context);
    case 'container':
      return convertContainerNode(node, context);
    default:
      return null;
  }
}

function convertTextNode(
  node: RenderNode,
  parentNode: RenderNode | null,
  context: ConversionContext
): DesignNode | null {
  const textNode = buildTextNode(
    node,
    parentNode,
    context.baseX,
    context.baseY,
    context.includeRawStyles
  );

  // Skip empty text
  if (!textNode.content) return null;

  // Inline the text wrapper effect (if text has bg/border)
  return inlineTextWrapperEffect(textNode);
}

function convertImageNode(
  node: RenderNode,
  context: ConversionContext
): DesignNode | null {
  return buildImageNode(
    node,
    context.baseX,
    context.baseY,
    context.includeRawStyles
  );
}

function convertSVGNode(
  node: RenderNode,
  context: ConversionContext
): DesignNode | null {
  return buildSVGNode(
    node,
    context.baseX,
    context.baseY,
    context.includeRawStyles
  );
}

function convertContainerNode(
  node: RenderNode,
  context: ConversionContext
): DesignNode | null {
  const container = buildContainerNode(
    node,
    context.baseX,
    context.baseY,
    context.includeRawStyles
  );

  // Process children
  if (node.children && node.children.length > 0) {
    const childContext: ConversionContext = {
      ...context,
      depth: context.depth + 1,
    };

    const children: DesignNode[] = [];
    for (const child of node.children) {
      const converted = convertNode(child, node, childContext);
      if (converted) {
        children.push(converted);
      }
    }

    container.children = children;

    // Merge text-only <li> children of <ul>/<ol> into a single text node
    // with Figma native list options (ORDERED/UNORDERED).
    mergeListItems(container);

    // Propagate -webkit-line-clamp from container to descendant text nodes.
    // CSS line-clamp is on the -webkit-box container, but Figma needs maxLines on text nodes.
    if (container.layout.lineClamp) {
      propagateLineClamp(container, container.layout.lineClamp);
    }

    // Sort flex/grid flow children by CSS `order` property.
    // CSS `order` controls visual ordering (default 0); lower values come first.
    // Must sort before post-processing so margin collapse, inline grouping, etc.
    // work on the visual order, not DOM order.
    sortByFlexOrder(container);

    // Convert absolute children's coordinates to be relative to this container
    relativeizeAbsoluteChildren(container);

    // Detect float containers → manual layout (no auto-layout)
    detectFloatContainer(container);
    // Adjust non-float siblings to avoid overlapping float elements
    adjustFloatSiblings(container);

    // Restructure CSS Grid into nested flex containers
    restructureGrid(container);

    // Restructure HTML tables into nested flex containers
    restructureTable(container);

    // Skip inline grouping, rich text merge, and margin collapse for float containers
    // (these only apply to auto-layout contexts)
    if (!container.layout.hasFloatChildren) {
      // Try to merge inline children into rich text (full or partial merge)
      const mergedChildren = tryMergeInlineTextRun(container, context);
      if (mergedChildren) {
        container.children = mergedChildren;
      }

      // Group consecutive inline children into horizontal wrappers
      container.children = groupInlineChildren(container);

      // Apply margin collapse for block containers
      logger.info('[convert] before collapseMargins', container.name, 'display=' + container.layout.display, 'children=' + container.children.length);
      collapseMargins(container);
    }

    // Sort by CSS stacking order
    sortByStackingOrder(container);

    // Center text in visual containers (bg/border) to compensate for
    // Figma lineHeight-based text height exceeding CSS content height
    centerTextInVisualContainer(container);
  }

  return container;
}

/**
 * Sort flow children of a flex/grid container by CSS `order` property.
 * Absolute/fixed children are not affected by `order` and stay in place.
 * Stable sort: children with equal `order` keep their DOM order.
 */
function sortByFlexOrder(container: DesignContainerNode): void {
  const display = container.layout.display;
  if (display !== 'flex' && display !== 'inline-flex'
    && display !== 'grid' && display !== 'inline-grid') return;

  const children = container.children;
  if (children.length <= 1) return;

  // Check if any child has a non-default order
  const hasOrder = children.some(c =>
    c.positioning?.mode !== 'absolute' && c.positioning?.mode !== 'fixed'
    && c.flexItem?.order !== undefined
  );
  if (!hasOrder) return;

  // Separate absolute/fixed children (keep in place) from flow children (sort by order)
  const indexed = children.map((child, i) => ({ child, domIndex: i }));
  const absFixed: typeof indexed = [];
  const flow: typeof indexed = [];

  for (const entry of indexed) {
    const mode = entry.child.positioning?.mode;
    if (mode === 'absolute' || mode === 'fixed') {
      absFixed.push(entry);
    } else {
      flow.push(entry);
    }
  }

  // Stable sort flow children by order (default 0)
  flow.sort((a, b) => {
    const orderA = a.child.flexItem?.order ?? 0;
    const orderB = b.child.flexItem?.order ?? 0;
    return orderA - orderB || a.domIndex - b.domIndex;
  });

  // Rebuild children array: put sorted flow children back into their slots
  // and keep absolute/fixed children at their original positions
  const result: DesignNode[] = [];
  let flowIdx = 0;
  for (let i = 0; i < children.length; i++) {
    const mode = children[i].positioning?.mode;
    if (mode === 'absolute' || mode === 'fixed') {
      result.push(children[i]);
    } else {
      result.push(flow[flowIdx++].child);
    }
  }

  container.children = result;
}

/**
 * Merge text-only <li> children of a <ul>/<ol> into a single text node
 * with Figma native list options (ORDERED/UNORDERED).
 *
 * Figma text nodes support `setRangeListOptions()` which renders native
 * bullets (•) or numbers (1. 2. 3.) with correct alignment — no separate
 * marker elements needed.
 */
/**
 * Recursively find <fieldset> containers and adjust <legend> positioning.
 *
 * Must run AFTER relativizeAllFlowCoordinates — at that point all coordinates
 * are parent-relative, so we can safely promote legend to absolute and set
 * the border-centered Y without coordinate system conflicts.
 */
function adjustAllFieldsetLegends(container: DesignContainerNode): void {
  for (const child of container.children) {
    if (child.nodeType === 'container') {
      adjustAllFieldsetLegends(child as DesignContainerNode);
    }
  }
  if (container.tag !== 'fieldset') return;

  const legendIdx = container.children.findIndex(
    c => c.nodeType === 'container' && (c as DesignContainerNode).tag === 'legend',
  );
  if (legendIdx === -1) return;

  const legend = container.children[legendIdx] as DesignContainerNode;
  const borderWidth = container.border?.top?.width ?? 0;

  // Promote legend to absolute — centers it on the top border.
  // At this point legend.bounds.x/y are already parent-relative (from relativizeAllFlowCoordinates).
  // We only override y to the border-centered position; x stays as-is.
  legend.positioning = { ...legend.positioning, mode: 'absolute' };
  legend.bounds = {
    ...legend.bounds,
    y: -(legend.bounds.height / 2) + borderWidth / 2,
  };

  // Add a background to legend if it doesn't have one, so it covers the border.
  // Default to white if unknown.
  if (!legend.background?.layers?.length) {
    legend.background = {
      layers: [{
        type: 'color',
        color: { r: 255, g: 255, b: 255, a: 1 },
      }],
    };
  }
}

function mergeListItems(container: DesignContainerNode): void {
  const tag = container.tag;
  if (tag !== 'ul' && tag !== 'ol') return;

  const children = container.children;
  if (children.length === 0) return;

  // Determine list style type from pre-computed DesignNode field
  const listStyleType = container.listStyleType || (tag === 'ol' ? 'decimal' : 'disc');
  if (listStyleType === 'none') return;

  // Collect <li> children with their text nodes (pure DesignNode, no RenderNode)
  const liItems: { text: DesignTextNode; li: DesignContainerNode }[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.positioning?.mode === 'absolute' || child.positioning?.mode === 'fixed') continue;
    if (child.nodeType !== 'container') return;
    const li = child as DesignContainerNode;
    if (li.tag !== 'li') return;

    // Skip merge if <li> has visual styling (background, border) —
    // these are styled cards/tiles, not plain text list items
    if (liHasVisualStyling(li)) return;

    const textNode = extractSingleTextNode(li);
    if (!textNode) return; // complex li → bail

    liItems.push({ text: textNode, li });
  }

  if (liItems.length === 0) return;

  // Figma native: disc → UNORDERED, decimal → ORDERED
  // Custom: everything else → prepend marker text inline
  const isNativeUnordered = listStyleType === 'disc';
  const isNativeOrdered = listStyleType === 'decimal';
  const useNativeList = isNativeUnordered || isNativeOrdered;

  // Build merged text content and styled segments
  const baseStyle = liItems[0].text.textStyle;
  let fullText = '';
  const segments: import('@html2figma/shared').RichTextSegment[] = [];

  for (let i = 0; i < liItems.length; i++) {
    const { text, li } = liItems[i];

    // For non-native list types, prepend marker text (e.g. "a. ", "V. ", "◦ ")
    let prefix = '';
    if (!useNativeList) {
      const marker = li.listMarker;
      if (marker) {
        prefix = marker + ' ';
      }
    }

    const lineStart = fullText.length;
    fullText += prefix;

    if (text.styledSegments && text.styledSegments.length > 0) {
      // Prefix segment (marker text) uses base style
      if (prefix) {
        segments.push({
          start: lineStart,
          end: lineStart + prefix.length,
          text: prefix,
          style: text.textStyle,
        });
      }
      // Rich text: shift segment offsets by prefix length
      for (const seg of text.styledSegments) {
        segments.push({
          ...seg,
          start: lineStart + prefix.length + seg.start,
          end: lineStart + prefix.length + seg.end,
          text: seg.text,
        });
      }
      fullText += text.content;
    } else {
      // Plain text: single segment including prefix
      fullText += text.content;
      segments.push({
        start: lineStart,
        end: fullText.length,
        text: prefix + text.content,
        style: text.textStyle,
      });
    }

    if (i < liItems.length - 1) {
      fullText += '\n';
    }
  }

  // Create merged text node
  const mergedText: DesignTextNode = {
    id: generateId('lt'),
    name: fullText.substring(0, 30),
    tag: tag,
    role: 'text',
    nodeType: 'text',
    bounds: { ...container.bounds },
    visible: true,
    opacity: container.opacity,
    positioning: { mode: 'static' },
    content: fullText,
    textStyle: baseStyle,
    styledSegments: segments.length > 1 ? segments : undefined,
    // Only use Figma native list for disc/decimal
    listType: useNativeList
      ? (isNativeOrdered ? 'ordered' : 'unordered')
      : undefined,
  };

  container.children = [mergedText];
}

/**
 * Check if a <li> element has visual styling that should be preserved
 * (background, border, border-radius). Such <li> elements are used as
 * styled cards/tiles and should NOT be merged into a plain text node.
 */
function liHasVisualStyling(li: DesignContainerNode): boolean {
  // Background with visible color or image
  const bg = li.background;
  if (bg?.layers && bg.layers.length > 0) {
    for (const layer of bg.layers) {
      if (layer.type === 'color') {
        const { r, g, b, a } = layer.color;
        // Skip transparent/near-transparent backgrounds
        if (a > 0.01 && !(r === 0 && g === 0 && b === 0 && a < 0.05)) return true;
      }
      if (layer.type !== 'color') return true; // gradient, image, etc.
    }
  }

  // Border with visible width
  const border = li.border;
  if (border) {
    const sides = [border.top, border.right, border.bottom, border.left];
    for (const side of sides) {
      if (side && side.width > 0 && side.color) {
        const { a } = side.color;
        if (a > 0.01) return true;
      }
    }
  }

  return false;
}

/**
 * Extract the single text node from a <li> container.
 * Handles cases where the text is wrapped in margin-wrappers or
 * the <li> was converted to flex-row by inline grouping.
 * Returns null if the <li> has complex (non-text) content.
 */
function extractSingleTextNode(li: DesignContainerNode): DesignTextNode | null {
  const flowChildren = li.children.filter(
    c => c.positioning?.mode !== 'absolute' && c.positioning?.mode !== 'fixed'
  );

  // Direct single text child
  if (flowChildren.length === 1 && flowChildren[0].nodeType === 'text') {
    return flowChildren[0] as DesignTextNode;
  }

  // Single container child (margin-wrapper or inline wrapper) → look inside
  if (flowChildren.length === 1 && flowChildren[0].nodeType === 'container') {
    return extractSingleTextNode(flowChildren[0] as DesignContainerNode);
  }

  return null;
}

/**
 * Propagate -webkit-line-clamp from a container to all descendant text nodes.
 * CSS line-clamp is set on the -webkit-box container but affects all text within.
 * Figma requires maxLines on each text node directly.
 */
function propagateLineClamp(container: DesignContainerNode, lineClamp: number): void {
  for (const child of container.children) {
    if (child.nodeType === 'text') {
      const text = child as DesignTextNode;
      if (!text.textStyle.maxLines) {
        text.textStyle.maxLines = lineClamp;
      }
    } else if (child.nodeType === 'container') {
      // Don't propagate into containers that have their own line-clamp
      const childContainer = child as DesignContainerNode;
      if (!childContainer.layout.lineClamp) {
        propagateLineClamp(childContainer, lineClamp);
      }
    }
  }
}
