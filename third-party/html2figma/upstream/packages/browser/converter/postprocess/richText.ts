/**
 * Rich text merging post-processor.
 * Merges all-inline children of a container into a single rich text node.
 */

import type { DesignNode, DesignContainerNode, DesignTextNode, RichTextSegment, TextStyleInfo } from '@html2figma/shared';
import { createLogger, LogModule } from '@html2figma/shared';
import { generateId, unionBounds } from '../utils';
import { createInlineMarginWrapper, applyInlineGaps } from './inlineGroup';

const logger = createLogger(LogModule.NODE_TRAVERSER);

/**
 * Compute the actual line-height in pixels from a TextStyleInfo.
 * Figma uses line-height to determine text node height, while the browser's
 * Range API reports height based on font metrics (smaller).
 */
function getLineHeightPx(style: TextStyleInfo): number {
  const lh = style.lineHeight;
  if (lh.unit === 'px' && lh.value > 0) return lh.value;
  if (lh.unit === '%' && lh.value > 0) return (lh.value / 100) * style.fontSize;
  // 'normal' — browser default is approximately 1.2
  return style.fontSize * 1.2;
}

/**
 * Map CSS text-align to flex justifyContent, preserving horizontal alignment
 * when switching a block container to flex-row.
 */
function mapTextAlignToJustify(textAlign?: string): string {
  if (textAlign === 'center') return 'center';
  if (textAlign === 'right') return 'flex-end';
  return 'flex-start';
}

// ── Gap detection & margin wrappers for inline spacing ──────────────

interface ChildGroup {
  startIndex: number;
  children: DesignNode[];
  /** Gap in pixels before this group (from previous group's right edge) */
  gapBefore: number;
}

/**
 * Split children into groups separated by visual gaps (margins between inline elements).
 * Children within the same row are checked for horizontal gaps.
 */
function splitByGaps(children: DesignNode[]): ChildGroup[] {
  const rows = clusterIntoLineRows(children);
  // For single-row case, split by x gaps
  if (rows.length === 1) {
    const sorted = rows[0].childIndices;
    const groups: ChildGroup[] = [];
    let currentGroup: ChildGroup = {
      startIndex: sorted[0],
      children: [children[sorted[0]]],
      gapBefore: 0,
    };

    for (let i = 1; i < sorted.length; i++) {
      const prevChild = children[sorted[i - 1]];
      const currChild = children[sorted[i]];
      const prevRight = prevChild.bounds.x + prevChild.bounds.width;
      const gap = currChild.bounds.x - prevRight;

      if (gap > 1) {
        groups.push(currentGroup);
        currentGroup = {
          startIndex: sorted[i],
          children: [currChild],
          gapBefore: gap,
        };
      } else {
        currentGroup.children.push(currChild);
      }
    }
    groups.push(currentGroup);
    return groups;
  }

  // Multi-row: treat as single group (gaps handled by line breaks)
  return [{ startIndex: 0, children: [...children], gapBefore: 0 }];
}

/**
 * Create a transparent wrapper that adds left padding to represent a horizontal gap.
 */
function createHorizontalGapWrapper(child: DesignNode, gapLeft: number): DesignContainerNode {
  const zeroBorderSide = { width: 0, style: 'none' as const, color: { r: 0, g: 0, b: 0, a: 0 } };
  return {
    id: generateId('gap'),
    name: 'gap-wrapper',
    tag: 'div',
    role: 'container',
    nodeType: 'container',
    bounds: {
      x: child.bounds.x - gapLeft,
      y: child.bounds.y,
      width: child.bounds.width + gapLeft,
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
      padding: { top: 0, right: 0, bottom: 0, left: Math.round(gapLeft) },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    background: { layers: [] },
    border: {
      top: { ...zeroBorderSide },
      right: { ...zeroBorderSide },
      bottom: { ...zeroBorderSide },
      left: { ...zeroBorderSide },
      radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    },
    effects: { boxShadows: [] },
    overflow: 'visible',
  };
}

/**
 * Strip all \n from a merged text node that covers a single visual line row.
 * The traverser's split mode sets hasLineBreakAfter on segments at line breaks,
 * which causes \n in merged text. For per-line-row merges, line breaks are
 * handled by absolute positioning, so \n in the content is incorrect.
 */
function stripTrailingNewlines(textNode: DesignTextNode): void {
  if (!textNode.content?.includes('\n')) return;
  textNode.content = textNode.content.replace(/\n/g, '');
  if (textNode.styledSegments) {
    let offset = 0;
    for (const seg of textNode.styledSegments) {
      const cleanText = (seg.text || '').replace(/\n/g, '');
      seg.text = cleanText;
      seg.start = offset;
      offset += cleanText.length;
      seg.end = offset;
    }
  }
}

/**
 * Check if a DesignNode is a pure text node (text content only, no image/svg).
 */
function isTextOnlyNode(node: DesignNode): boolean {
  if (node.nodeType === 'text') return true;
  if (node.nodeType === 'image' || node.nodeType === 'svg') return false;
  // Inline container: check if it contains only text
  if (node.nodeType === 'container') {
    const container = node as DesignContainerNode;
    // Any container with visual styling (background/border) must NOT be
    // merged into a text node — Figma can't do per-range backgrounds.
    if (hasVisualStyling(container)) return false;
    const display = container.layout.display;
    const isInlineDisplay = display === 'inline' || display === 'inline-block';
    const isTextWrapper = display === 'flex'
      && container.children.length === 1
      && container.children[0].nodeType === 'text';
    if (!isInlineDisplay && !isTextWrapper) return false;
    // An inline container with children must have all text-only children
    return container.children.every(isTextOnlyNode);
  }
  return false;
}

/**
 * Check if a container has meaningful visual styling (background or border)
 * that would be lost if merged into a rich text node.
 */
function hasVisualStyling(container: DesignContainerNode): boolean {
  // Check for non-empty background layers
  if (container.background && container.background.layers.length > 0) {
    // Check if any layer is non-transparent
    const hasVisibleBg = container.background.layers.some(layer => {
      if (layer.type === 'color') return layer.color.a > 0;
      // Gradients and images are always visible
      return true;
    });
    if (hasVisibleBg) return true;
  }
  // Check for non-zero border width
  if (container.border) {
    const b = container.border;
    if (b.top.width > 0 || b.right.width > 0 || b.bottom.width > 0 || b.left.width > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a node is a visual inline element — an inline container or flex
 * wrapper that carries background/border. These should NOT be merged into
 * rich text (Figma can't do per-range backgrounds) but can participate in
 * partial merge layout (kept as separate containers in a flex-row parent).
 */
function isVisualInlineWrapper(node: DesignNode): boolean {
  if (node.nodeType !== 'container') return false;
  const container = node as DesignContainerNode;
  if (!hasVisualStyling(container)) return false;
  const display = container.layout.display;
  // Flex wrapper from inlineTextWrapperEffect
  const isFlexWrapper = display === 'flex'
    && container.children.length === 1
    && container.children[0].nodeType === 'text';
  // Inline container with visual styling (e.g. <span style="background:...">)
  const isInline = display === 'inline' || display === 'inline-block' || display === 'inline-flex';
  return isFlexWrapper || isInline;
}

/** Intermediate segment with line break info from traverser */
export interface TextSegmentInfo {
  text: string;
  style: import('@html2figma/shared').TextStyleInfo;
  tag?: string;
  href?: string;
  /** From traverser's split mode: this segment has a line break after it */
  hasLineBreakAfter?: boolean;
}

/**
 * Extract text content and style from a DesignNode recursively.
 * Pure DesignNode operation — no browser API or RenderNode access needed.
 */
export function extractTextSegments(
  node: DesignNode,
): TextSegmentInfo[] {
  if (node.nodeType === 'text') {
    const textNode = node as DesignTextNode;
    if (!textNode.content) return [];
    return [{
      text: textNode.content,
      style: textNode.textStyle,
      tag: textNode.tag,
      hasLineBreakAfter: textNode.hasLineBreakAfter === true,
    }];
  }

  if (node.nodeType === 'container') {
    const container = node as DesignContainerNode;
    const tag = container.tag;

    // Use container's pre-computed textStyle (written by nodeBuilder)
    // For synthetic wrappers without textStyle, fall back to first text child's style
    const containerStyle = container.textStyle;
    const hasReliableContainerStyle = !!containerStyle;

    logger.info(`[RichText] extractTextSegments container tag=${tag} hasTextStyle=${hasReliableContainerStyle}${containerStyle ? ` fontStyle=${containerStyle.fontStyle} color=r${containerStyle.color.r},g${containerStyle.color.g},b${containerStyle.color.b}` : ''}`);

    // Extract href for <a> tags from semantic attributes
    let href: string | undefined;
    if (tag === 'a') {
      href = container.semantic?.attributes?.href || undefined;
    }

    if (container.children.length === 0) return [];

    // Recurse into children
    const segments: TextSegmentInfo[] = [];
    for (let i = 0; i < container.children.length; i++) {
      const child = container.children[i];

      if (child.nodeType === 'text') {
        const textChild = child as DesignTextNode;
        if (textChild.content) {
          // Pseudo-element text nodes (::before/::after) keep their own style.
          // Synthetic wrappers without textStyle fall back to text node's own style.
          const isPseudo = textChild.tag === '::before' || textChild.tag === '::after';
          const resolvedStyle = isPseudo
            ? textChild.textStyle
            : (hasReliableContainerStyle ? containerStyle! : textChild.textStyle);
          segments.push({
            text: textChild.content,
            style: resolvedStyle,
            tag: isPseudo ? textChild.tag : tag,
            href,
            hasLineBreakAfter: textChild.hasLineBreakAfter === true,
          });
        }
      } else {
        // Nested inline container
        const childSegments = extractTextSegments(child);
        segments.push(...childSegments);
      }
    }

    return segments;
  }

  return [];
}

/** Context needed for rich text merging */
export interface RichTextContext {
  baseX: number;
  baseY: number;
  scale: number;
  maxDepth: number;
  includeRawStyles: boolean;
  depth: number;
}

// ── Visual line clustering ──────────────────────────────────────────
//
// Inline elements with different font sizes sit at different y-positions
// due to baseline alignment.  A naïve "compare y" heuristic fails for
// mixed-size text on the same line.
//
// Instead we cluster children into visual rows:
//   1. Each row tracks a vertical extent [top, bottom].
//   2. A child belongs to a row when its vertical *midpoint* falls inside
//      the row's extent, or the row's midpoint falls inside the child's
//      extent — this handles baseline-aligned elements of any size.
//   3. After clustering, rows are sorted top→bottom, elements within a
//      row are sorted left→right.
//   4. Line breaks (\n) are only inserted between rows.

interface LineRow {
  top: number;
  bottom: number;
  /** Indices into the original children array */
  childIndices: number[];
}

/**
 * Cluster children into visual line rows based on vertical midpoint overlap.
 */
function clusterIntoLineRows(children: DesignNode[]): LineRow[] {
  const rows: LineRow[] = [];

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const cTop = child.bounds.y;
    const cBottom = cTop + child.bounds.height;
    const cMid = (cTop + cBottom) / 2;

    // Find the first row whose vertical range overlaps with this child
    // using the bidirectional midpoint test.
    let matched: LineRow | undefined;
    for (const row of rows) {
      const rMid = (row.top + row.bottom) / 2;
      if (
        (cMid >= row.top && cMid <= row.bottom) ||   // child mid inside row
        (rMid >= cTop && rMid <= cBottom)             // row mid inside child
      ) {
        matched = row;
        break;
      }
    }

    if (matched) {
      matched.childIndices.push(i);
      // Expand the row's extent to include this child
      matched.top = Math.min(matched.top, cTop);
      matched.bottom = Math.max(matched.bottom, cBottom);
    } else {
      rows.push({ top: cTop, bottom: cBottom, childIndices: [i] });
    }
  }

  // Sort rows top→bottom
  rows.sort((a, b) => a.top - b.top);

  // Sort children within each row left→right
  for (const row of rows) {
    row.childIndices.sort((a, b) => children[a].bounds.x - children[b].bounds.x);
  }

  return rows;
}

/**
 * Merge a subset of children into a single rich text node.
 * Pure DesignNode operation — no RenderNode access needed.
 */
function mergeChildrenSubset(
  children: DesignNode[],
  parentTag: string,
  parentOpacity: number,
  /** When true, skip inserting \n between visual rows — let Figma handle wrapping */
  skipLineBreaks: boolean = false,
): DesignTextNode | null {
  logger.info(`[RichText] mergeChildrenSubset: ${children.length} children skipLineBreaks=${skipLineBreaks}`);
  const lineRows = clusterIntoLineRows(children);
  const rawSegments: TextSegmentInfo[] = [];

  for (let rowIdx = 0; rowIdx < lineRows.length; rowIdx++) {
    const row = lineRows[rowIdx];

    for (let ci = 0; ci < row.childIndices.length; ci++) {
      const childIdx = row.childIndices[ci];
      const child = children[childIdx];
      const segments = extractTextSegments(child);
      rawSegments.push(...segments);

      // Check for visual gap between this child and the next in the same row.
      // Insert NBSP (\u00A0) to represent inline margins. NBSP is used instead
      // of regular space because TextCreator.sanitizeText collapses regular
      // spaces ([ \t]+), which would break styled segment boundaries.
      if (ci < row.childIndices.length - 1) {
        const nextChildIdx = row.childIndices[ci + 1];
        const nextChild = children[nextChildIdx];
        const currentRight = child.bounds.x + child.bounds.width;
        const gap = nextChild.bounds.x - currentRight;
        if (gap > 1 && rawSegments.length > 0) {
          const lastSeg = rawSegments[rawSegments.length - 1];
          rawSegments.push({
            text: '\u00A0',
            style: lastSeg.style,
            tag: lastSeg.tag,
          });
        }
      }
    }

    // Insert line break after every row except the last.
    // Skip when the container uses line-clamp — Figma handles wrapping + truncation;
    // manual \n would consume maxLines prematurely.
    if (!skipLineBreaks && rowIdx < lineRows.length - 1 && rawSegments.length > 0) {
      rawSegments[rawSegments.length - 1].hasLineBreakAfter = true;
    }
  }

  // When skipping line breaks (line-clamp), also clear per-segment breaks
  // from the traverser's split mode — Figma handles wrapping internally.
  if (skipLineBreaks) {
    for (const seg of rawSegments) {
      seg.hasLineBreakAfter = false;
    }
  }

  if (rawSegments.length === 0) return null;

  let fullText = '';
  const styledSegments: RichTextSegment[] = [];

  for (const seg of rawSegments) {
    if (!seg.text) continue;
    const start = fullText.length;
    fullText += seg.text;
    if (seg.hasLineBreakAfter) {
      fullText += '\n';
    }
    const end = fullText.length;

    styledSegments.push({
      start,
      end,
      text: seg.hasLineBreakAfter ? seg.text + '\n' : seg.text,
      style: seg.style,
      tag: seg.tag,
      href: seg.href,
    });
  }

  if (!fullText || styledSegments.length === 0) return null;

  // Log merged segments for debugging
  for (const seg of styledSegments) {
    logger.info(`[RichText] segment [${seg.start}-${seg.end}] "${seg.text?.substring(0, 20)}" tag=${seg.tag} fontStyle=${seg.style.fontStyle} color=r${seg.style.color.r},g${seg.style.color.g},b${seg.style.color.b}`);
  }

  const baseStyle = styledSegments[0].style;
  const mergedBounds = unionBounds(children);

  return {
    id: generateId('rt'),
    name: fullText.substring(0, 30) || '#text',
    tag: parentTag,
    role: 'text',
    nodeType: 'text',
    bounds: mergedBounds,
    visible: true,
    opacity: parentOpacity,
    positioning: { mode: 'static' },
    content: fullText,
    textStyle: baseStyle,
    styledSegments,
  };
}

/**
 * Try to merge inline children of a container into rich text nodes.
 *
 * Full merge: all children are text-only → single DesignTextNode.
 * Partial merge: some children have visual styling (bg/border) →
 *   merge consecutive text-only runs, keep visual containers as-is,
 *   switch parent to flex-row to maintain inline flow.
 *
 * Returns new children array or null if no merging is applicable.
 */
export function tryMergeInlineTextRun(
  container: DesignContainerNode,
  context: RichTextContext,
): DesignNode[] | null {
  // Exclude absolute-positioned children — they have parent-relative coords
  // (from relativeizeAbsoluteChildren) that are incomparable with static children's
  // page-absolute coords, and they don't participate in inline flow.
  let allChildren = container.children;
  let absoluteChildren = allChildren.filter(c => c.positioning?.mode === 'absolute');
  let children = allChildren.filter(c => c.positioning?.mode !== 'absolute');

  // When a block container has a single non-visual inline child (e.g. <span>),
  // "unwrap" it — use the inline child's children for the merge.  This covers:
  //   <div -webkit-line-clamp:2><span>text <em>keyword</em> text</span></div>
  // Without unwrapping, children.length===1 triggers the early return and the
  // inline content is never merged into a single rich text node.
  if (children.length <= 1 && (children.length === 0 || children[0].nodeType !== 'container')) {
    return null;
  }
  if (children.length === 1 && children[0].nodeType === 'container') {
    const only = children[0] as DesignContainerNode;
    const d = only.layout.display;
    if ((d === 'inline' || d === 'inline-block') && !hasVisualStyling(only)) {
      const innerChildren = only.children.filter(c => c.positioning?.mode !== 'absolute');
      const innerAbsolute = only.children.filter(c => c.positioning?.mode === 'absolute');

      // Special case: gradient text children can't survive full merge
      // (Figma can't do per-segment gradients), so switch to flex-row instead.
      const hasGradientChild = innerChildren.some(c => {
        if (c.nodeType !== 'container') return false;
        const cont = c as DesignContainerNode;
        return cont.children.some(ch => {
          if (ch.nodeType !== 'text') return false;
          const t = ch as DesignTextNode;
          return t.textStyle?.gradientFill && t.textStyle.gradientFill.length > 0;
        });
      });
      if (innerChildren.length >= 2 && hasGradientChild) {
        // Promote inner children and switch to flex-row directly.
        // Don't recurse — that would full-merge and lose the gradient.
        const justify = mapTextAlignToJustify(container.layout.textAlign);
        container.layout.display = 'flex';
        container.layout.flex = {
          direction: 'row',
          wrap: 'nowrap',
          justifyContent: justify,
          alignItems: 'center',
          gap: { row: 0, column: 0 },
        };
        for (const c of innerChildren) {
          c.positioning = { mode: 'static' };
          // Adjust gradient container heights to match Figma's line-height.
          // Browser inline span height < Figma text height, causing misalignment.
          if (c.nodeType === 'container') {
            const cont = c as DesignContainerNode;
            for (const ch of cont.children) {
              if (ch.nodeType === 'text') {
                const t = ch as DesignTextNode;
                if (t.textStyle) {
                  const figmaH = getLineHeightPx(t.textStyle) * ((t.content || '').split('\n').length);
                  if (figmaH > cont.bounds.height) {
                    cont.bounds = { ...cont.bounds, height: figmaH };
                  }
                }
              }
            }
          }
        }
        const gapped = applyInlineGaps(innerChildren);
        container.children = [...gapped, ...absoluteChildren];
        return [...gapped, ...absoluteChildren];
      }

      // General case: unwrap the inline child and continue with its children.
      if (innerChildren.length >= 2) {
        children = innerChildren;
        absoluteChildren = [...absoluteChildren, ...innerAbsolute];
        allChildren = [...children, ...absoluteChildren];
        // Update container's children to the unwrapped set so downstream
        // code (e.g. flex-row switch) writes back to the correct parent.
        container.children = allChildren;
      } else {
        return null;
      }
    } else {
      return null;
    }
  }

  // Only merge at block-level containers.
  // Inline containers (e.g. <i>, <span>, <a>) should NOT merge their own children —
  // the parent block container will recursively extract their text via extractTextSegments,
  // which preserves per-segment styles (pseudo-element colors, nested bold/italic, etc.)
  // and maintains correct DOM ordering.
  const display = container.layout.display;
  if (display === 'flex' || display === 'inline-flex' || display === 'grid' || display === 'inline-grid') {
    return null;
  }
  if (display === 'inline' || display === 'inline-block') {
    return null;
  }

  const allTextOnly = children.every(isTextOnlyNode);
  const hasInlineElement = children.some(c => c.nodeType === 'container');

  // When the container uses -webkit-line-clamp, Figma handles wrapping and truncation.
  // Don't insert \n between visual rows — it would consume maxLines prematurely.
  const hasLineClamp = container.layout.lineClamp != null && container.layout.lineClamp > 0;
  logger.info(`[RichText] DEBUG lineClamp container="${container.name}" display=${display} lineClamp=${container.layout.lineClamp} hasLineClamp=${hasLineClamp}`);

  // ── Full merge: all children are pure text ──
  if (allTextOnly && hasInlineElement) {
    // Check for gaps between adjacent children (margins between inline elements)
    const groups = splitByGaps(children);

    if (groups.length === 1) {
      // No gaps: standard full merge into single text node
      const merged = mergeChildrenSubset(children, container.tag, container.opacity, hasLineClamp);
      return merged ? [merged, ...absoluteChildren] : null;
    }

    // Gaps exist: merge each group separately, use flex-row with gap wrappers
    logger.info(`[RichText] full merge with gaps: ${groups.length} groups`);
    const newChildren: DesignNode[] = [];
    for (const group of groups) {
      let node: DesignNode;
      if (group.children.length >= 2) {
        const merged = mergeChildrenSubset(
          group.children,
          container.tag, container.opacity, hasLineClamp,
        );
        node = merged || group.children[0];
      } else {
        node = group.children[0];
      }

      if (group.gapBefore > 0) {
        newChildren.push(createHorizontalGapWrapper(node, group.gapBefore));
      } else {
        newChildren.push(node);
      }
    }

    // Switch parent to flex-row so children flow horizontally.
    // Preserve original text-align as justifyContent for centering.
    const justify = mapTextAlignToJustify(container.layout.textAlign);
    container.layout.display = 'flex';
    container.layout.flex = {
      direction: 'row',
      wrap: 'nowrap',
      justifyContent: justify,
      alignItems: 'baseline',
      gap: { row: 0, column: 0 },
    };

    return [...newChildren, ...absoluteChildren];
  }

  // ── Partial merge: some children have visual styling (bg/border) ──
  // All children must be either text-only OR visual inline wrappers
  const allMergeable = children.every(c => isTextOnlyNode(c) || isVisualInlineWrapper(c));
  if (!allMergeable) return null;

  // Group consecutive text-only children into runs
  const textOnlyFlags = children.map(isTextOnlyNode);

  interface Run { start: number; end: number; textOnly: boolean; }
  const runs: Run[] = [];
  let i = 0;
  while (i < children.length) {
    const isText = textOnlyFlags[i];
    let j = i + 1;
    while (j < children.length && textOnlyFlags[j] === isText) j++;
    runs.push({ start: i, end: j, textOnly: isText });
    i = j;
  }

  logger.info(`[RichText] partial merge: ${runs.length} runs: ${runs.map(r => `[${r.start}-${r.end}) ${r.textOnly ? 'text' : 'visual'}`).join(', ')}`);

  // Only proceed if there are text-only runs worth merging
  const hasTextRun = runs.some(r => r.textOnly);
  if (!hasTextRun) return null;

  // Determine if all ORIGINAL children are on a single visual line.
  // Must use original children (before merge) because merged text nodes span
  // multiple lines but have a single large bounding box that clusters incorrectly.
  const lineRows = clusterIntoLineRows(children);
  const isSingleLine = lineRows.length <= 1;

  // Build new children array: merge text-only runs, keep visual containers
  const newChildren: DesignNode[] = [];

  for (const run of runs) {
    if (!run.textOnly) {
      // Keep visual containers as-is
      for (let k = run.start; k < run.end; k++) {
        newChildren.push(children[k]);
      }
    } else if (run.end - run.start >= 2) {
      const runChildren = children.slice(run.start, run.end);
      if (isSingleLine) {
        // Single line: merge all text children in the run
        const merged = mergeChildrenSubset(runChildren, container.tag, container.opacity);
        if (merged) {
          newChildren.push(merged);
        } else {
          newChildren.push(...runChildren);
        }
      } else {
        // Multi-line: merge per visual line row to prevent overlapping bounding boxes.
        // A merged text node's height covers all its lines; if it shares lines with
        // visual containers or other merged text, they overlap with absolute positioning.
        const runLineRows = clusterIntoLineRows(runChildren);
        for (const row of runLineRows) {
          const rowChildren = row.childIndices.map(idx => runChildren[idx]);
          if (rowChildren.length >= 2) {
            const merged = mergeChildrenSubset(
              rowChildren,
              container.tag, container.opacity,
            );
            if (merged) {
              // Strip \n from per-line-row merged text — the traverser's split mode
              // marks segments with hasLineBreakAfter, but in per-row merge the line
              // break is handled by absolute positioning, not text content.
              stripTrailingNewlines(merged);
              newChildren.push(merged);
            } else {
              newChildren.push(...rowChildren);
            }
          } else {
            newChildren.push(rowChildren[0]);
          }
        }
      }
    } else {
      // Single text-only child — keep as-is
      newChildren.push(children[run.start]);
    }
  }

  logger.info(`[RichText] partial merge: ${newChildren.length} children, ${lineRows.length} line(s), mode=${isSingleLine ? 'flex-row' : 'absolute'}`);

  if (isSingleLine) {
    // Flex-row: children flow left-to-right, no overlap from text width differences.
    // Preserve original text-align as justifyContent for centering.
    // Use center alignment — span containers use line-height to vertically center text.
    const justify = mapTextAlignToJustify(container.layout.textAlign);
    container.layout.display = 'flex';
    container.layout.flex = {
      direction: 'row',
      wrap: 'nowrap',
      justifyContent: justify,
      alignItems: 'center',
      gap: { row: 0, column: 0 },
    };
    for (const child of newChildren) {
      child.positioning = { mode: 'static' };
    }

    // Apply browser-computed gaps (includes CSS margins + HTML whitespace).
    // groupInlineChildren skips flex containers, so we must handle it here.
    const gapped = applyInlineGaps(newChildren);
    newChildren.length = 0;
    newChildren.push(...gapped);
  } else {
    // Multi-line: absolute positioning at browser-computed coordinates.
    const parentX = container.bounds.x;
    const parentY = container.bounds.y;
    logger.info(`[RichText] partial merge parent bounds: x=${parentX}, y=${parentY}, w=${container.bounds.width}, h=${container.bounds.height}`);
    for (const child of newChildren) {
      const origX = child.bounds.x;
      const origY = child.bounds.y;
      child.positioning = { mode: 'absolute' };
      child.bounds = {
        ...child.bounds,
        x: child.bounds.x - parentX,
        y: child.bounds.y - parentY,
      };
      logger.info(`[RichText] partial merge child "${child.name?.substring(0, 20)}" orig=(${origX}, ${origY}) -> relative=(${child.bounds.x}, ${child.bounds.y}) size=${child.bounds.width}x${child.bounds.height}`);
    }

    // Adjust text node y positions to compensate for Figma's line-height-based rendering.
    for (const child of newChildren) {
      if (child.nodeType === 'text') {
        const textChild = child as DesignTextNode;
        const lineHeightPx = getLineHeightPx(textChild.textStyle);
        const browserHeight = child.bounds.height;
        const content = textChild.content || '';
        const numLines = (content.match(/\n/g)?.length || 0) + 1;
        const figmaHeight = numLines * lineHeightPx;
        if (figmaHeight > browserHeight) {
          const yOffset = (figmaHeight - browserHeight) / 2;
          child.bounds.y -= yOffset;
          logger.info(`[RichText] text lineHeight adjust: "${child.name?.substring(0, 20)}" lineHeight=${lineHeightPx.toFixed(1)}px, lines=${numLines}, browserH=${browserHeight.toFixed(1)}, figmaH=${figmaHeight.toFixed(1)}, yOffset=-${yOffset.toFixed(1)}`);
        }
      }
    }

    // Ensure the parent has a minimum height so the auto-layout frame
    // doesn't collapse (absolute children don't contribute to sizing).
    if (!container.layout.sizing) {
      container.layout.sizing = { boxSizing: 'border-box' };
    }
    container.layout.sizing.minHeight = container.bounds.height;
  }

  return [...newChildren, ...absoluteChildren];
}
