/**
 * Core node traverser (functional implementation)
 * Converts a DOM tree into a simple tree structure with full style information.
 */

import type { RenderNode, TraverseOptions } from './types';
import { hasValidTextContent, isElementVisible } from './visibility';
import { capturePseudoElement, captureMarkerPseudoElement } from './pseudo';
import { injectFormContent } from './form';
import { injectListMarker } from './list';
import {
  traverseTextNode,
  type TextSegment,
  type TextNodeMetadata
} from './text';
import { extractSemanticInfo } from './semanticId';

// Re-export types for API compatibility
export type { RenderNode, TraverseOptions } from './types';
export type { TextSegment, TextNodeMetadata } from './text';

/**
 * Default options.
 */
const DEFAULT_OPTIONS: Required<Omit<TraverseOptions, 'filter' | 'extractMetadata'>> = {
  includeInvisible: false,
  maxDepth: Infinity,
  includeTextNodes: true,
  preserveWhitespace: false,
};

/**
 * Traverse an element node.
 */
function traverseElement(
  element: Element,
  depth: number,
  options: Required<Omit<TraverseOptions, 'filter' | 'extractMetadata'>> & Pick<TraverseOptions, 'filter' | 'extractMetadata'> & { enableTextPreprocess?: boolean }
): RenderNode | null {
  // Check depth limit
  if (depth > options.maxDepth) {
    return null;
  }

  // Skip elements that have no visual representation in normal flow
  const tagName = element.tagName.toLowerCase();
  if (tagName === 'option' || tagName === 'optgroup') {
    return null;
  }

  // Apply custom filter
  if (options.filter && !options.filter(element, depth)) {
    return null;
  }

  // Get computed style
  const computedStyle = window.getComputedStyle(element);

  // Check visibility
  const visible = isElementVisible(element, computedStyle);
  if (!visible && !options.includeInvisible) {
    return null;
  }

  // Get bounding rect
  const boundingRect = element.getBoundingClientRect();

  // Capture untransformed layout info when element has CSS transform.
  // offset* properties are not affected by CSS transform — they reflect the layout position/size.
  // offsetLeft/offsetTop are relative to offsetParent (the nearest positioned ancestor).
  let originalRect: { x: number; y: number; width: number; height: number } | undefined;
  const transform = computedStyle.transform;
  if (transform && transform !== 'none' && element instanceof HTMLElement) {
    originalRect = {
      x: element.offsetLeft,
      y: element.offsetTop,
      width: element.offsetWidth,
      height: element.offsetHeight,
    };
  }

  // Create render node
  const renderNode: RenderNode = {
    nodeType: 'element',
    tag: element.tagName.toLowerCase(),
    computedStyle: computedStyle,
    boundingRect: boundingRect,
    children: [],
    domNode: element,
    visible: visible,
    originalRect,
  };

  // Extract custom metadata
  if (options.extractMetadata) {
    renderNode.metadata = options.extractMetadata(element);
  }

  // Extract semantic info for round-trip mapping
  const semantic = extractSemanticInfo(element);
  if (!renderNode.metadata) renderNode.metadata = {};
  renderNode.metadata.semantic = semantic;

  // Skip ::marker pseudo-element capture — list markers are handled via
  // Figma native list options (mergeListItems in converter), not as separate nodes.
  // The captureMarkerPseudoElement creates nodes with out-of-bounds positioning
  // that breaks the rich text merge pipeline.

  // Capture ::before pseudo-element
  const beforeNode = capturePseudoElement(element, '::before');
  if (beforeNode) {
    renderNode.children.push(beforeNode);
  }

  // Traverse child nodes
  for (let i = 0; i < element.childNodes.length; i++) {
    const childNode = element.childNodes[i];
    const childRenderNode = traverseNode(childNode, depth + 1, options);

    if (childRenderNode) {
      // Handle possible array return (text split mode)
      if (Array.isArray(childRenderNode)) {
        renderNode.children.push(...childRenderNode);
      } else {
        renderNode.children.push(childRenderNode);
      }
    }
  }

  // Inject synthetic text for form elements (input, select, textarea)
  injectFormContent(element, renderNode);

  // Inject synthetic list marker for list-item elements (<li>)
  injectListMarker(element, renderNode);

  // Capture ::after pseudo-element
  const afterNode = capturePseudoElement(element, '::after');
  if (afterNode) {
    renderNode.children.push(afterNode);
  }

  return renderNode;
}

/**
 * Extended traverse options with text preprocessing support.
 */
export interface ExtendedTraverseOptions extends TraverseOptions {
  /** Whether to enable text preprocessing (auto-detect line breaks and decide insert or split). Default: true */
  enableTextPreprocess?: boolean;
}

/**
 * Traverse a single node (auto-detect type).
 */
function traverseNode(
  node: Node,
  depth: number,
  options: Required<Omit<TraverseOptions, 'filter' | 'extractMetadata'>> & Pick<TraverseOptions, 'filter' | 'extractMetadata'> & { enableTextPreprocess?: boolean }
): RenderNode | RenderNode[] | null {
  if (node.nodeType === Node.ELEMENT_NODE) {
    return traverseElement(node as Element, depth, options);
  } else if (node.nodeType === Node.TEXT_NODE) {
    return traverseTextNode(node as Text, depth, options);
  }

  // Other node types (comment nodes, etc.) are not processed
  return null;
}

/**
 * Main entry: traverse a DOM tree and build a render node tree (with automatic text preprocessing).
 *
 * @param rootElement - Root element
 * @param options - Traverse options
 * @returns Render node tree
 *
 * @example
 * ```typescript
 * const rootElement = document.body;
 * const renderTree = traverseDOM(rootElement, {
 *   includeInvisible: false,
 *   maxDepth: 10,
 *   includeTextNodes: true,
 *   enableTextPreprocess: true, // Enable automatic text preprocessing (default: true)
 *   filter: (node) => {
 *     // Filter out script and style tags
 *     if (node.nodeType === Node.ELEMENT_NODE) {
 *       const tag = (node as Element).tagName.toLowerCase();
 *       return tag !== 'script' && tag !== 'style';
 *     }
 *     return true;
 *   }
 * });
 *
 * // Text preprocessing rules:
 * // - Single text node with line breaks -> auto-insert newline characters \n
 * // - Multiple inline elements -> auto-split into segments (each with accurate x, y, width, height)
 * ```
 */
export function traverseDOM(
  rootElement: Element,
  options: ExtendedTraverseOptions = {}
): RenderNode | null {
  // Merge options
  const mergedOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
    enableTextPreprocess: options.enableTextPreprocess !== false // Default: enabled
  };

  // Start traversal from root element (depth 0)
  return traverseElement(rootElement, 0, mergedOptions);
}

