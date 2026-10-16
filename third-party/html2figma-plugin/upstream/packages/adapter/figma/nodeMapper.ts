/**
 * Node Mapper - DesignNode type → Figma node type mapping
 */

import type {
  DesignNode,
  DesignContainerNode,
  DesignTextNode,
  DesignImageNode,
  DesignSVGNode,
} from '@html2figma/shared';
import type {
  FigmaNode,
  FigmaFrameNode,
  FigmaTextNode,
  FigmaRectangleNode,
  FigmaSVGNode,
  AsyncImagePaint,
  SharedPluginDataMap,
} from '@html2figma/shared';
import type { SemanticInfo } from '@html2figma/shared';
import { mapLayout, mapOverflow, mapPositioning, inferConstraints } from './layoutMapper';
import { mapBackgroundToFills, mapBorderToStrokes, mapGradientBorderToStrokes, mapEffects, mapBlendMode, colorToFigmaRGB, colorToFigmaRGBA } from './styleMapper';
import { mapTextStyle, mapStyledSegments } from './textMapper';

/**
 * Map SemanticInfo to SharedPluginDataMap for Figma persistence.
 * Complex objects are JSON-serialized.
 */
function mapSemanticToPluginData(semantic: SemanticInfo): SharedPluginDataMap {
  const data: SharedPluginDataMap = {
    semanticId: semantic.semanticId,
  };
  if (semantic.classList && semantic.classList.length > 0) {
    data.classList = JSON.stringify(semantic.classList);
  }
  if (semantic.cssSelector) {
    data.cssSelector = semantic.cssSelector;
  }
  if (semantic.component) {
    data.component = JSON.stringify(semantic.component);
  }
  if (semantic.sourceLocation) {
    data.sourceLocation = JSON.stringify(semantic.sourceLocation);
  }
  if (semantic.attributes) {
    data.attributes = JSON.stringify(semantic.attributes);
  }
  return data;
}

/**
 * Map a DesignNode tree to a FigmaNode tree (pure JSON, no Figma API calls)
 */
export function mapDesignNodeToFigma(node: DesignNode): FigmaNode {
  let figmaNode: FigmaNode;
  switch (node.nodeType) {
    case 'container': figmaNode = mapContainer(node); break;
    case 'text': figmaNode = mapText(node); break;
    case 'image': figmaNode = mapImage(node); break;
    case 'svg': figmaNode = mapSVG(node); break;
    default: {
      const _exhaustive: never = node;
      throw new Error(`Unknown node type: ${(_exhaustive as any).nodeType}`);
    }
  }

  // Attach semantic metadata for round-trip mapping
  if (node.semantic) {
    figmaNode.sharedPluginData = mapSemanticToPluginData(node.semantic);
    // Also preserve tag and role at top level for easy access
    figmaNode.sharedPluginData.tag = node.tag;
    if (node.role) figmaNode.sharedPluginData.role = node.role;
  }

  return figmaNode;
}

// ==================== Container → FRAME ====================

function mapContainer(node: DesignContainerNode): FigmaFrameNode {
  const layoutProps = mapLayout(node.layout);

  // CSS baseline → Figma BASELINE works when children have different heights
  // (text baselines need alignment). But when all flow children are the same height,
  // browser baseline alignment often looks like vertical centering (children centered
  // in the container). Figma BASELINE in that case pushes children to top.
  // Detect this and use CENTER instead.
  if (layoutProps.counterAxisAlignItems === 'BASELINE' && node.children.length >= 2) {
    const flowChildren = node.children.filter(
      ch => ch.positioning?.mode !== 'absolute' && ch.positioning?.mode !== 'fixed',
    );
    if (flowChildren.length >= 2) {
      const heights = flowChildren.map(ch => Math.round(ch.bounds.height));
      const allSameHeight = heights.every(h => h === heights[0]);
      if (allSameHeight) {
        layoutProps.counterAxisAlignItems = 'CENTER';
      }
    }
  }

  // Detect block containers where children are actually laid out horizontally
  // (e.g. via floats or other mechanisms that don't change the container's display).
  // Check if all flow children overlap vertically (share a common Y band) and are
  // arranged left-to-right. This catches float layouts and other horizontal
  // arrangements that CSS reports as display:block.
  if (layoutProps.layoutMode === 'VERTICAL' && node.children.length >= 2) {
    const flowChildren = node.children.filter(
      ch => ch.positioning?.mode !== 'absolute' && ch.positioning?.mode !== 'fixed',
    );
    if (flowChildren.length >= 2) {
      // Check vertical overlap: all children share a common Y band
      const bandTop = Math.max(...flowChildren.map(ch => ch.bounds.y));
      const bandBottom = Math.min(...flowChildren.map(ch => ch.bounds.y + ch.bounds.height));
      const allOverlapVertically = bandBottom > bandTop; // there's a common Y range

      const sorted = [...flowChildren].sort((a, b) => a.bounds.x - b.bounds.x);
      const leftToRight = sorted.every((ch, i) =>
        i === 0 || ch.bounds.x >= sorted[i - 1].bounds.x + sorted[i - 1].bounds.width - 2,
      );
      if (allOverlapVertically && leftToRight) {
        layoutProps.layoutMode = 'HORIZONTAL';
        layoutProps.primaryAxisSizingMode = 'FIXED';
        layoutProps.counterAxisSizingMode = 'FIXED';
      }
    }
  }

  // Detect inline wrapping: HORIZONTAL containers where children wrap to multiple lines.
  // In CSS, inline content wraps naturally. Detect this by checking if any child's position
  // indicates a line break (x resets while y increases).
  // Only check flow children — absolute/fixed children are positioned independently
  // and their coordinates can falsely trigger wrap detection.
  if (layoutProps.layoutMode === 'HORIZONTAL' && node.children.length >= 2) {
    const wrapFlowChildren = node.children.filter(
      ch => ch.positioning?.mode !== 'absolute' && ch.positioning?.mode !== 'fixed',
    );
    let hasWrap = false;
    for (let i = 1; i < wrapFlowChildren.length; i++) {
      const prev = wrapFlowChildren[i - 1].bounds;
      const curr = wrapFlowChildren[i].bounds;
      if (curr.x < prev.x + prev.width - 1 && curr.y > prev.y + 1) {
        hasWrap = true;
        break;
      }
    }
    if (hasWrap) {
      layoutProps.layoutWrap = 'WRAP';
    } else if (layoutProps.layoutWrap === 'WRAP') {
      // CSS says flex-wrap: wrap but browser didn't actually wrap.
      // Force NO_WRAP to prevent Figma from wrapping due to font width differences.
      layoutProps.layoutWrap = 'NO_WRAP';
    }
  }

  // For WRAP containers, compute counterAxisSpacing from browser bounds.
  // CSS gap may be 0 while children have margins that create row spacing.
  // Figma WRAP ignores x/y coordinates and uses counterAxisSpacing for row gaps.
  if (layoutProps.layoutWrap === 'WRAP' && node.children.length >= 2) {
    const flowChildren = node.children.filter(
      ch => ch.positioning?.mode !== 'absolute' && ch.positioning?.mode !== 'fixed',
    );
    const sorted = [...flowChildren].sort((a, b) => a.bounds.y - b.bounds.y);
    const firstY = sorted[0]?.bounds.y ?? 0;
    const firstRowItems = sorted.filter(ch => Math.abs(ch.bounds.y - firstY) < 3);
    const firstRowBottom = Math.max(...firstRowItems.map(ch => ch.bounds.y + ch.bounds.height));
    const secondRowItem = sorted.find(ch => ch.bounds.y > firstY + 3);
    if (secondRowItem) {
      const rowGap = Math.max(0, Math.round(secondRowItem.bounds.y - firstRowBottom));
      layoutProps.counterAxisSpacing = rowGap;
    }
  }

  // Figma SPACE_BETWEEN with a single child centers it, but CSS space-between
  // with one child behaves like flex-start. Downgrade when ≤1 flow child.
  // For row-reverse/column-reverse, flex-start maps to MAX (already flipped by layoutMapper).
  if (layoutProps.primaryAxisAlignItems === 'SPACE_BETWEEN') {
    const flowCount = node.children.filter(
      ch => ch.positioning?.mode !== 'absolute' && ch.positioning?.mode !== 'fixed',
    ).length;
    if (flowCount <= 1) {
      const dir = node.layout.flex?.direction;
      const isReversed = dir === 'row-reverse' || dir === 'column-reverse';
      layoutProps.primaryAxisAlignItems = isReversed ? 'MAX' : 'MIN';
    }
  }

  // Detect actual alignment from browser positions.
  // CSS text-align, margin-left:auto, justify-content:flex-end etc. can position
  // children differently than what getComputedStyle reports for justify-content.
  // Detect centering and right-alignment by checking child positions within the
  // container's content area.
  if (layoutProps.primaryAxisAlignItems === 'MIN' && layoutProps.layoutMode === 'HORIZONTAL') {
    if (isCenteredByPosition(node)) {
      layoutProps.primaryAxisAlignItems = 'CENTER';
    } else if (isRightAlignedByPosition(node)) {
      layoutProps.primaryAxisAlignItems = 'MAX';
    }
  }
  if (layoutProps.counterAxisAlignItems === 'MIN' && layoutProps.layoutMode === 'VERTICAL') {
    if (isCenteredByPosition(node)) {
      layoutProps.counterAxisAlignItems = 'CENTER';
    } else if (isRightAlignedByPosition(node)) {
      layoutProps.counterAxisAlignItems = 'MAX';
    }
  }

  // Synthetic inline-group wrappers and inline containers (display:inline)
  // that hold text: let the cross axis HUG so Figma's font metrics
  // (which may be taller than the browser's) don't get clipped.
  // The browser measures these containers from actual rendered bounds,
  // but Figma may render the same font taller (e.g. Inter vs SF Pro).
  if (layoutProps.layoutMode === 'HORIZONTAL'
    && (node.name === 'inline-group' || node.layout.display === 'inline')) {
    layoutProps.counterAxisSizingMode = 'AUTO';
  }

  const positionProps = mapPositioning(node.positioning);
  // Use gradient strokes if CSS gradient border trick was detected,
  // but always get radius from the normal border mapper.
  const normalBorderProps = mapBorderToStrokes(node.border);
  const gradientStrokeProps = node.borderGradientLayers
    ? mapGradientBorderToStrokes(node.borderGradientLayers, node.border)
    : null;
  const borderProps = gradientStrokeProps
    ? { ...normalBorderProps, ...gradientStrokeProps }
    : normalBorderProps;
  const fills = mapBackgroundToFills(node.background);
  const effects = mapEffects(node.effects);

  // Fix up GRADIENT_RADIAL transforms for 'circle' shape.
  // CSS circle is circular in pixel space; the UV-space transform needs
  // different X/Y scales to preserve circularity on non-square elements.
  // gradientTransform maps UV → gradient canonical space.
  // Canonical: center (0.5, 0.5), radius 0.5.
  //   scale = 0.5 / semi,  tx = 0.5 − scale * cx
  //
  // Note: fills and layers are still in the same order here (bottom-to-top).
  // fills.reverse() happens AFTER this fixup.
  const W = node.bounds.width;
  const H = node.bounds.height;
  if (W > 0 && H > 0) {
    for (let i = 0; i < fills.length && i < node.background.layers.length; i++) {
      const layer = node.background.layers[i];
      const fill = fills[i] as any;
      if (layer.type === 'radial-gradient' && fill?.type === 'GRADIENT_RADIAL'
          && layer.shape === 'circle' && fill.gradientTransform) {
        const cx = layer.position.x;
        const cy = layer.position.y;
        const fcxPx = Math.max(cx * W, (1 - cx) * W);
        const fcyPx = Math.max(cy * H, (1 - cy) * H);
        const R = Math.sqrt(fcxPx * fcxPx + fcyPx * fcyPx);
        if (R > 0) {
          const sx = 0.5 * W / R;
          const sy = 0.5 * H / R;
          fill.gradientTransform = [
            [sx, 0, 0.5 - sx * cx],
            [0, sy, 0.5 - sy * cy],
          ];
        }
      }
    }
  }

  // Enrich each IMAGE fill's _imageMetadata with per-fill properties
  // (SVG detection, imageTransform, tileSize) so FrameCreator can
  // process multiple IMAGE fills independently with unique imageHashes.
  for (let i = 0; i < fills.length && i < node.background.layers.length; i++) {
    const layer = node.background.layers[i];
    const fill = fills[i] as any;
    if (layer.type === 'image' && fill?.type === 'IMAGE' && fill._imageMetadata) {
      const imgLayer = layer as any;
      if (isSvgDataUri(imgLayer.url) || isSvgUrl(imgLayer.url)) {
        fill._imageMetadata.isSvg = true;
        // svgContent available now only for data URIs; URL-based SVGs get content after extraction
        const decoded = decodeSvgDataUri(imgLayer.url);
        if (decoded) fill._imageMetadata.svgContent = decoded;
      }
      if (W > 0 && H > 0 && typeof imgLayer.size === 'object' && imgLayer.repeat !== 'repeat' && imgLayer.position) {
        const transform = calculateImageTransform(W, H, imgLayer.size.width, imgLayer.size.height, imgLayer.position);
        if (transform) {
          fill._imageMetadata.imageTransform = transform;
          fill._imageMetadata.scaleMode = 'CROP';
          fill.scaleMode = 'CROP';
        }
      }
      if (typeof imgLayer.size === 'object' && imgLayer.repeat === 'repeat') {
        fill._imageMetadata.tileSize = { width: imgLayer.size.width, height: imgLayer.size.height };
        fill._imageMetadata.scaleMode = 'TILE';
      }
    }
  }

  // Figma renders fills bottom-to-top: fills[0] = bottom, fills[last] = top.
  // Browser already stores layers bottom-to-top, so no reversal needed.

  // background-clip: padding-box / content-box → move fills to synthetic inner frame
  let bgClipChild: FigmaFrameNode | null = null;
  if (node.backgroundClip && node.backgroundClip !== 'border-box' && fills.length > 0) {
    const bTop = node.border.top.width;
    const bRight = node.border.right.width;
    const bBottom = node.border.bottom.width;
    const bLeft = node.border.left.width;
    const pTop = node.backgroundClip === 'content-box' ? node.layout.padding.top : 0;
    const pRight = node.backgroundClip === 'content-box' ? node.layout.padding.right : 0;
    const pBottom = node.backgroundClip === 'content-box' ? node.layout.padding.bottom : 0;
    const pLeft = node.backgroundClip === 'content-box' ? node.layout.padding.left : 0;
    const insetL = bLeft + pLeft;
    const insetT = bTop + pTop;
    const clipW = Math.round(W - insetL - bRight - pRight);
    const clipH = Math.round(H - insetT - bBottom - pBottom);
    const radius = borderProps.cornerRadius ?? 0;
    const innerRadius = Math.max(0, radius - insetL);

    if (clipW > 0 && clipH > 0) {
      bgClipChild = {
        id: node.id + '_bgclip',
        name: '_bg-clip',
        type: 'FRAME',
        visible: true,
        locked: true,
        x: Math.round(insetL),
        y: Math.round(insetT),
        width: clipW,
        height: clipH,
        opacity: 1,
        children: [],
        fills,
        clipsContent: true,
        layoutPositioning: 'ABSOLUTE',
        ...(innerRadius > 0 ? { cornerRadius: innerRadius } : {}),
      };
    }
  }

  // Adjust Figma padding to account for INSIDE stroke.
  // CSS padding is measured from inside the border, but Figma auto-layout
  // padding with strokeAlign INSIDE is measured from the frame edge.
  if (borderProps.strokeAlign === 'INSIDE') {
    const bTop = node.border.top.width;
    const bRight = node.border.right.width;
    const bBottom = node.border.bottom.width;
    const bLeft = node.border.left.width;
    if (bTop > 0 || bRight > 0 || bBottom > 0 || bLeft > 0) {
      if (layoutProps.paddingTop !== undefined) layoutProps.paddingTop += bTop;
      if (layoutProps.paddingRight !== undefined) layoutProps.paddingRight += bRight;
      if (layoutProps.paddingBottom !== undefined) layoutProps.paddingBottom += bBottom;
      if (layoutProps.paddingLeft !== undefined) layoutProps.paddingLeft += bLeft;
    }
  }

  const children = mapContainerChildren(node);
  // Track synthetic children so post-processing passes can skip them.
  const syntheticChildren = new Set<FigmaNode>();
  if (bgClipChild) {
    children.unshift(bgClipChild);
    syntheticChildren.add(bgClipChild);
  }

  // HUG (AUTO) lets Figma recalculate height from flow children + padding.
  // This can differ from the browser-computed value when:
  //   - Container has no children (HUG collapses to 0 → Figma 100×100 fallback)
  //   - All flow children are absolute/zero-height (HUG collapses to ~1)
  //   - Margin-wrapper bounds include padding for margin simulation
  // In all these cases, force FIXED to preserve the browser-computed dimensions.
  if (layoutProps.primaryAxisSizingMode === 'AUTO') {
    const flowChildrenHeight = node.children
      .filter(ch => ch.positioning?.mode !== 'absolute' && ch.positioning?.mode !== 'fixed')
      .reduce((sum, ch) => sum + ch.bounds.height, 0);
    const paddingV = (layoutProps.paddingTop || 0) + (layoutProps.paddingBottom || 0);
    const hugEstimate = flowChildrenHeight + paddingV;

    if (hugEstimate < node.bounds.height - 1) {
      layoutProps.primaryAxisSizingMode = 'FIXED';
    }
  }

  const figmaNode: FigmaFrameNode = {
    id: node.id,
    name: node.name,
    type: 'FRAME',
    visible: node.visible,
    locked: false,
    x: Math.round(node.bounds.x),
    y: Math.round(node.bounds.y),
    width: Math.round(node.bounds.width),
    height: Math.round(node.bounds.height),
    opacity: node.opacity,
    rotation: node.transform?.rotation != null ? -node.transform.rotation : undefined,
    children,

    // Layout
    ...layoutProps,
    // Containers with -webkit-line-clamp always need clipping — the CSS spec requires
    // overflow:hidden for line-clamp, but post-processors may change display from block
    // to flex, and the overflow may not propagate correctly through the pipeline.
    clipsContent: mapOverflow(node.overflow) || !!node.layout.lineClamp,

    // Positioning
    ...positionProps,

    // Visual — fills go to bgClipChild when background-clip is active
    fills: bgClipChild ? undefined : (fills.length > 0 ? fills : undefined),
    effects: effects.length > 0 ? effects : undefined,

    // Border
    ...borderProps,
  };

  // Blend mode
  if (node.effects.blendMode && node.effects.blendMode !== 'normal') {
    figmaNode.blendMode = mapBlendMode(node.effects.blendMode);
  }

  // Computed item spacing from margin collapse (supports negative for negative-margin wrappers)
  if (node.computedItemSpacing !== undefined && node.computedItemSpacing !== 0) {
    figmaNode.itemSpacing = Math.round(node.computedItemSpacing);
  }

  // Add top-level imageMetadata for background image layers so FrameCreator can process them.
  // Priority: first background image layer with base64 or URL.
  const bgImageLayer = node.background.layers.find(
    (l): l is Extract<typeof l, { type: 'image' }> => l.type === 'image',
  );
  if (bgImageLayer) {
    const meta: Record<string, any> = {
      originalUrl: bgImageLayer.url,
      ...(bgImageLayer.base64 ? { base64: bgImageLayer.base64 } : {}),
      ...(isSvgDataUri(bgImageLayer.url) ? { isSvg: true, svgContent: decodeSvgDataUri(bgImageLayer.url) } : {}),
    };

    // Calculate imageTransform for explicit background-size + position (CROP mode)
    // Applies to: no-repeat, repeat-x, repeat-y (Figma has no directional tile)
    if (typeof bgImageLayer.size === 'object' && bgImageLayer.repeat !== 'repeat') {
      const transform = calculateImageTransform(
        node.bounds.width, node.bounds.height,
        bgImageLayer.size.width, bgImageLayer.size.height,
        bgImageLayer.position,
      );
      if (transform) {
        meta.imageTransform = transform;
        meta.scaleMode = 'CROP';
      }
    }

    // TILE mode: only full 'repeat' with explicit size gets tileSize for scalingFactor
    // scalingFactor = desiredTileWidth / naturalImageWidth (computed in ImageCreator via getSizeAsync)
    if (typeof bgImageLayer.size === 'object' && bgImageLayer.repeat === 'repeat') {
      meta.tileSize = { width: bgImageLayer.size.width, height: bgImageLayer.size.height };
      meta.scaleMode = 'TILE';
    }

    // When background-clip moves fills to a child frame, attach imageMetadata there
    const metaTarget = bgClipChild || figmaNode;
    (metaTarget as any).imageMetadata = meta;
  }

  // Build design↔figma child pairs, skipping synthetic nodes like _bg-clip.
  // All post-processing passes use these pairs instead of raw index matching,
  // so inserting/removing synthetic children never breaks alignment.
  const childPairs = pairChildren(figmaNode, node, syntheticChildren);

  // Apply flex item properties to children
  applyFlexChildSizing(childPairs, node);

  // Block (VERTICAL) containers: text children need FILL on cross-axis (horizontal)
  // to wrap at the container width, matching CSS block text behavior.
  applyBlockChildSizing(childPairs, node);

  // Infer Figma constraints for absolute children from their position.
  // Figma default is CENTER which is wrong for most CSS absolute positioning.
  applyAbsoluteConstraints(childPairs, node);

  // Propagate flex alignment to direct text children
  adjustTextInFlexContainer(figmaNode, node);

  // Form elements (input/select/textarea) have browser-internal flex layout that
  // reports justify-content:center, but user-visible text alignment is controlled by
  // CSS text-align. Override primaryAxisAlignItems based on text-align.
  const isFormTag = node.tag === 'input' || node.tag === 'select' || node.tag === 'textarea';
  if (isFormTag && figmaNode.layoutMode === 'HORIZONTAL') {
    const ta = node.layout.textAlign;
    figmaNode.primaryAxisAlignItems = ta === 'center' ? 'CENTER'
      : ta === 'right' ? 'MAX'
      : 'MIN';
  }

  // Line-clamp containers: recursively clamp all descendant heights to container height.
  // Browser measures children at their full multi-line height, but line-clamp
  // visually clips to N lines. Without this, oversized descendants push siblings
  // down in Figma auto-layout even though clipsContent hides the overflow.
  if (node.layout.lineClamp && figmaNode.children) {
    clampDescendantHeights(figmaNode.children, figmaNode.height);
  }

  // Hide zero-size flow children. In CSS, elements can collapse to 0x0 via
  // overflow:hidden, max-width:0, etc. while still existing in the DOM.
  // In Figma auto-layout, these invisible frames disrupt spacing (e.g.
  // SPACE_BETWEEN distributes space around them). Setting visible=false
  // makes Figma skip them in layout calculations.
  for (const { design: dn, figma: fc } of childPairs) {
    if (dn.positioning?.mode === 'absolute' || dn.positioning?.mode === 'fixed') continue;
    if (dn.bounds.width === 0 && dn.bounds.height === 0) {
      (fc as any).visible = false;
    }
  }

  return figmaNode;
}

/**
 * Detect if flow children are visually centered along the horizontal axis
 * by comparing left/right gaps within the container's content area.
 */
function isCenteredByPosition(node: DesignContainerNode): boolean {
  const flowChildren = node.children.filter(
    ch => ch.positioning?.mode !== 'absolute' && ch.positioning?.mode !== 'fixed',
  );
  if (flowChildren.length === 0 || node.bounds.width <= 0) return false;

  const padL = node.layout.padding.left;
  const padR = node.layout.padding.right;
  const innerW = node.bounds.width - padL - padR;
  const contentLeft = Math.min(...flowChildren.map(ch => ch.bounds.x)) - padL;
  const contentRight = Math.max(...flowChildren.map(ch => ch.bounds.x + ch.bounds.width)) - padL;
  const spaceLeft = contentLeft;
  const spaceRight = innerW - contentRight;

  // Content is centered if left and right gaps are roughly equal
  // and there's meaningful space on both sides (not just flush left)
  return spaceLeft > 5 && spaceRight > 5
    && Math.abs(spaceLeft - spaceRight) < Math.max(5, innerW * 0.05);
}

/**
 * Detect if flow children are visually right-aligned along the horizontal axis.
 * Content is right-aligned when it's pushed to the right side with significant
 * space on the left (e.g. margin-left:auto, justify-content:flex-end, text-align:right).
 */
function isRightAlignedByPosition(node: DesignContainerNode): boolean {
  const flowChildren = node.children.filter(
    ch => ch.positioning?.mode !== 'absolute' && ch.positioning?.mode !== 'fixed',
  );
  if (flowChildren.length === 0 || node.bounds.width <= 0) return false;

  const padL = node.layout.padding.left;
  const padR = node.layout.padding.right;
  const innerW = node.bounds.width - padL - padR;
  if (innerW <= 0) return false;
  const contentLeft = Math.min(...flowChildren.map(ch => ch.bounds.x)) - padL;
  const contentRight = Math.max(...flowChildren.map(ch => ch.bounds.x + ch.bounds.width)) - padL;
  const contentW = contentRight - contentLeft;
  const spaceLeft = contentLeft;
  const spaceRight = innerW - contentRight;

  // Content is right-aligned if:
  // 1. Flush to right edge (spaceRight ≈ 0)
  // 2. Significant space on left (content doesn't fill the container)
  return spaceRight < 5 && spaceLeft > Math.max(10, innerW * 0.1)
    && contentW < innerW * 0.85;
}

/**
 * Map container children, reversing order for row-reverse / column-reverse.
 */
function mapContainerChildren(node: DesignContainerNode): FigmaNode[] {
  const mapped = node.children.map(mapDesignNodeToFigma);
  const dir = node.layout.flex?.direction;
  if (dir === 'row-reverse' || dir === 'column-reverse') {
    mapped.reverse();
  }
  return mapped;
}

// ==================== Synthetic node helpers ====================

/** Paired design↔figma child for index-safe iteration. */
type ChildPair = { design: DesignNode; figma: FigmaNode };

/**
 * Build an array of {design, figma} pairs, correctly matching real figma
 * children to their design counterparts while skipping synthetic nodes.
 * Handles reversed flex direction (row-reverse / column-reverse).
 *
 * @param syntheticChildren Explicit set of adapter-created nodes to skip.
 *   Using a set (not a name convention) avoids false positives from user HTML
 *   elements whose names happen to start with `_`.
 */
function pairChildren(
  figmaNode: FigmaFrameNode,
  designNode: DesignContainerNode,
  syntheticChildren: Set<FigmaNode>,
): ChildPair[] {
  if (!figmaNode.children) return [];

  // Filter out synthetic nodes to get only real figma children
  const realFigmaChildren = figmaNode.children.filter(c => !syntheticChildren.has(c));

  const dir = designNode.layout.flex?.direction;
  const isReversed = dir === 'row-reverse' || dir === 'column-reverse';

  const pairs: ChildPair[] = [];
  for (let i = 0; i < designNode.children.length; i++) {
    // Reversed containers: figma children are in reverse order relative to design
    const figmaIdx = isReversed ? (designNode.children.length - 1 - i) : i;
    const fc = realFigmaChildren[figmaIdx];
    if (!fc) continue;
    pairs.push({ design: designNode.children[i], figma: fc });
  }
  return pairs;
}

/**
 * Recursively clamp heights of all flow descendants to maxH.
 * Used by line-clamp containers to prevent browser's multi-line measurements
 * from inflating Figma auto-layout dimensions.
 */
function clampDescendantHeights(children: FigmaNode[], maxH: number): void {
  for (const child of children) {
    if ((child as any).layoutPositioning === 'ABSOLUTE') continue;
    if ((child as any).height > maxH) {
      (child as any).height = maxH;
    }
    if (Array.isArray((child as any).children)) {
      clampDescendantHeights((child as any).children, maxH);
    }
  }
}

/**
 * Infer and apply Figma constraints for absolute children based on their
 * position within the parent container.
 */
function applyAbsoluteConstraints(
  pairs: ChildPair[],
  designNode: DesignContainerNode,
): void {
  const parentW = designNode.bounds.width;
  const parentH = designNode.bounds.height;
  if (parentW <= 0 || parentH <= 0) return;

  for (const { design: child, figma: figmaChild } of pairs) {
    if (child.positioning?.mode !== 'absolute' && child.positioning?.mode !== 'fixed') continue;

    // Don't override constraints already set (e.g. select chevron)
    if ((figmaChild as any).constraints) continue;

    (figmaChild as any).constraints = inferConstraints(child.bounds, { width: parentW, height: parentH });
  }
}

/**
 * Block (VERTICAL) containers: set text children's horizontal sizing to FILL
 * so they wrap at the container width. In CSS, block-level text fills the
 * parent width and wraps. Figma text defaults to HUG which expands horizontally.
 */
function applyBlockChildSizing(
  pairs: ChildPair[],
  designNode: DesignContainerNode,
): void {
  const display = designNode.layout.display;
  if (display === 'flex' || display === 'inline-flex'
    || display === 'grid' || display === 'inline-grid') return;

  for (const { design: childDesign, figma: childFigma } of pairs) {
    if (childDesign.positioning?.mode === 'absolute' || childDesign.positioning?.mode === 'fixed') continue;

    // Text nodes wider than the container need FILL to wrap
    if (childFigma.type === 'TEXT' && childDesign.bounds.width > designNode.bounds.width * 0.95) {
      (childFigma as any).layoutSizingHorizontal = 'FILL';
    }
    // Container children (like margin-wrappers, inline-groups) also FILL
    if (childFigma.type === 'FRAME' && childDesign.nodeType === 'container') {
      (childFigma as any).layoutSizingHorizontal = 'FILL';
    }
  }
}

/**
 * Apply flex item sizing properties to children of a flex container.
 */
function applyFlexChildSizing(
  pairs: ChildPair[],
  designNode: DesignContainerNode,
): void {
  const isFlex = designNode.layout.display === 'flex' || designNode.layout.display === 'inline-flex';
  if (!isFlex) return;

  const dir = designNode.layout.flex?.direction;
  const isColumn = dir === 'column' || dir === 'column-reverse';

  const parentAlignItems = designNode.layout.flex?.alignItems || 'stretch';

  for (const { design: childDesign, figma: childFigma } of pairs) {
    // Absolute/fixed children don't participate in flex layout — skip all flex sizing.
    // Must check before cross-axis sizing, otherwise FILL gets set on absolute children
    // which Figma doesn't support (causes them to collapse to default 100×100).
    if (childDesign.positioning?.mode === 'absolute' || childDesign.positioning?.mode === 'fixed') continue;

    const flexItem = childDesign.flexItem;

    // Cross-axis sizing: determined by effective align-self
    // (child's align-self, falling back to parent's align-items, default 'stretch')
    const effectiveAlignSelf = flexItem?.alignSelf || parentAlignItems;

    if (effectiveAlignSelf === 'stretch') {
      // stretch → FILL in cross axis
      if (isColumn) {
        (childFigma as any).layoutSizingHorizontal = 'FILL';
      } else {
        (childFigma as any).layoutSizingVertical = 'FILL';
      }
    } else if (childFigma.type === 'FRAME') {
      // Non-stretch (center/flex-start/flex-end/baseline): container children
      // should HUG cross-axis so parent alignment (e.g. CENTER) takes effect.
      // Without this, FIXED sizing at browser-measured height fills the parent
      // and makes centering invisible.
      if (isColumn) {
        (childFigma as any).layoutSizingHorizontal = 'HUG';
      } else {
        (childFigma as any).layoutSizingVertical = 'HUG';
      }
    }

    // Wrapped text in flex row: FILL primary axis to match browser behavior.
    // In CSS, a wrapping anonymous text flex item fills the container width, so
    // text-align (default left) controls alignment. In Figma, HUG shrinks the
    // text node and the parent's justify-content centers it — visually different.
    if (!isColumn && childFigma.type === 'TEXT' && childDesign.nodeType === 'text') {
      const textContent = (childDesign as DesignTextNode).content;
      if (textContent && textContent.includes('\n')) {
        (childFigma as any).layoutSizingHorizontal = 'FILL';
      }
    }

    if (!flexItem) continue;

    // flex-basis with grow=0 → FIXED size along primary axis.
    // Always use browser-computed bounds instead of raw flex-basis, because:
    //   - min-width:auto can make the element wider than its basis
    //   - max-width can constrain it smaller
    //   - content size may override a small basis
    // The browser's getBoundingClientRect gives the final resolved size.
    if (typeof flexItem.basis === 'number' && flexItem.grow === 0) {
      if (isColumn) {
        (childFigma as any).height = Math.round(childDesign.bounds.height);
        (childFigma as any).layoutSizingVertical = 'FIXED';
      } else {
        (childFigma as any).width = Math.round(childDesign.bounds.width);
        (childFigma as any).layoutSizingHorizontal = 'FIXED';
      }
    }

    // flex-grow → FILL in the primary axis direction
    if (flexItem.grow > 0) {
      if (isColumn) {
        (childFigma as any).layoutSizingVertical = 'FILL';
      } else {
        (childFigma as any).layoutSizingHorizontal = 'FILL';
      }
      (childFigma as any).layoutGrow = flexItem.grow;
    }

    // Map align-self to Figma layoutAlign
    if (flexItem.alignSelf) {
      const alignMap: Record<string, string> = {
        'flex-start': 'MIN',
        'start': 'MIN',
        'flex-end': 'MAX',
        'end': 'MAX',
        'center': 'CENTER',
        'stretch': 'STRETCH',
      };
      const mapped = alignMap[flexItem.alignSelf];
      if (mapped) {
        (childFigma as any).layoutAlign = mapped;
      }
    }
  }
}

/**
 * Propagate container alignment to direct text children and handle truncation sizing.
 *
 * In Figma, resize() on a text node inside auto-layout sets
 * layoutSizingHorizontal = FIXED, which prevents the parent's
 * primaryAxisAlignItems from visually centering the text.
 * We fix this by:
 *  1. Setting layoutSizingHorizontal/Vertical = HUG so the text node
 *     shrinks to content and the parent alignment takes effect.
 *  2. Setting textAlignHorizontal from the parent's justify-content
 *     (or align-items for column direction) as a safety net.
 *  3. For truncated text (textTruncation: ENDING), FILL the parent
 *     width so Figma knows where to truncate — applies to both flex
 *     and block containers.
 */
function adjustTextInFlexContainer(
  figmaNode: FigmaFrameNode,
  designNode: DesignContainerNode,
): void {
  if (!figmaNode.children) return;

  const isFlex = designNode.layout.display === 'flex' || designNode.layout.display === 'inline-flex';
  const isInline = designNode.layout.display === 'inline';

  const dir = designNode.layout.flex?.direction;
  const isColumn = dir === 'column' || dir === 'column-reverse';

  // Horizontal alignment source (flex only):
  //   row  → primary axis → justifyContent
  //   column → counter axis → alignItems
  const hAlign = isFlex
    ? (isColumn
        ? designNode.layout.flex?.alignItems
        : designNode.layout.flex?.justifyContent)
    : undefined;

  const textAlign: FigmaTextNode['textAlignHorizontal'] | undefined =
    hAlign === 'center' ? 'CENTER'
    : (hAlign === 'flex-end' || hAlign === 'end') ? 'RIGHT'
    : undefined;

  // Form elements (input/select/textarea) use browser-internal flex layout
  // (e.g. justify-content:center) that doesn't reflect user CSS intent.
  // Text alignment in form elements should come from CSS text-align, not flex props.
  const isFormElement = designNode.tag === 'input' || designNode.tag === 'select' || designNode.tag === 'textarea';

  for (const child of figmaNode.children) {
    if (child.type !== 'TEXT') continue;
    const t = child as FigmaTextNode;

    if (isInline && !t.textTruncation) {
      // Inline containers: text segments must HUG to preserve natural widths
      // for correct wrapping. But if the text has truncation (maxLines/line-clamp),
      // keep it — it's intentional from CSS and needs FIXED width to work.
      t.layoutSizingHorizontal = 'HUG';
      t.layoutSizingVertical = 'HUG';
    } else if (t.textTruncation === 'ENDING') {
      // Truncated text needs constrained width — FILL stretches to parent
      t.layoutSizingHorizontal = 'FILL';
      t.layoutSizingVertical = 'HUG';
    } else if (isFlex) {
      // Let the text HUG its content so parent alignment works
      t.layoutSizingHorizontal = 'HUG';
      t.layoutSizingVertical = 'HUG';
    }

    if (textAlign && !isFormElement) {
      t.textAlignHorizontal = textAlign;
    }
  }
}

// ==================== Text → TEXT ====================

function mapText(node: DesignTextNode): FigmaTextNode {
  const textProps = mapTextStyle(node.textStyle);
  const positionProps = mapPositioning(node.positioning);

  // Handle CSS line-clamp (maxLines) + font metric mismatch between browser and Figma.
  //
  // The traverser inserts \n at visual line break positions. We use the presence of
  // \n to distinguish whether truncation was actually triggered in the browser:
  //
  // - NO \n: text fit within maxLines without wrapping → no actual truncation.
  //   Remove maxLines/textTruncation to avoid false ellipsis from Figma's wider
  //   font rendering. Use WIDTH_AND_HEIGHT auto-resize so text sizes naturally.
  //
  // - HAS \n: text wrapped beyond maxLines → truncation was active.
  //   Strip \n to collapse content to single line. Keep FIXED width (browser's
  //   container constraint) + maxLines + textTruncation for correct clamping.
  let characters = node.content;

  if (textProps.maxLines != null && textProps.maxLines > 0) {
    // Rich-text merged nodes (styledSegments) from line-clamp containers intentionally
    // omit \n to let Figma handle wrapping + truncation. The \n heuristic doesn't apply
    // to them — always keep truncation settings for rich-text merged text.
    const isRichTextMerge = node.styledSegments != null && node.styledSegments.length > 0;

    if (characters.includes('\n')) {
      // Text was genuinely wrapping → strip \n, keep truncation with FIXED width
      characters = characters.replace(/\n/g, ' ').replace(/  +/g, ' ');
    } else if (!isRichTextMerge) {
      // Text fit without wrapping → remove truncation to avoid false ellipsis
      delete (textProps as any).textTruncation;
      delete (textProps as any).maxLines;
      textProps.textAutoResize = 'WIDTH_AND_HEIGHT';
    }
  }

  const figmaNode: FigmaTextNode = {
    ...positionProps,
    ...textProps,
    id: node.id,
    name: node.name,
    type: 'TEXT' as const,
    visible: node.visible,
    locked: false,
    x: Math.round(node.bounds.x),
    y: Math.round(node.bounds.y),
    width: Math.round(node.bounds.width),
    height: Math.round(node.bounds.height),
    opacity: node.opacity,
    rotation: node.transform?.rotation != null ? -node.transform.rotation : undefined,
    characters,
  };

  // Absolute text with rotation → constrain to right-center (e.g. select chevron)
  if (node.positioning.mode === 'absolute' && node.transform?.rotation) {
    figmaNode.constraints = { horizontal: 'MAX', vertical: 'CENTER' };
    figmaNode.textAlignVertical = 'CENTER';
  }

  // Map text shadow → DROP_SHADOW effects
  if (node.textStyle.textShadow && node.textStyle.textShadow.length > 0) {
    const effects: any[] = node.textStyle.textShadow.map(shadow => ({
      type: 'DROP_SHADOW',
      visible: true,
      color: colorToFigmaRGBA(shadow.color),
      blendMode: 'NORMAL',
      offset: { x: shadow.offsetX, y: shadow.offsetY },
      radius: shadow.blurRadius,
      spread: shadow.spreadRadius,
    }));
    (figmaNode as any).effects = effects;
  }

  // Map Figma native list type
  if (node.listType) {
    figmaNode.listOptions = {
      type: node.listType === 'ordered' ? 'ORDERED' : 'UNORDERED',
    };
  }

  // Map rich text segments → per-range style overrides
  if (node.styledSegments && node.styledSegments.length > 0) {
    figmaNode.styledTextSegments = mapStyledSegments(node.styledSegments, node.textStyle);
  }

  // Extract imageMetadata for IMAGE fills (from background-clip: text with image)
  // TextCreator needs this at top level to process the image async.
  if (figmaNode.fills) {
    const imageFill = figmaNode.fills.find(
      (f): f is AsyncImagePaint => f.type === 'IMAGE' && !!(f as any)._imageMetadata,
    ) as AsyncImagePaint | undefined;
    if (imageFill?._imageMetadata) {
      (figmaNode as any).imageMetadata = {
        ...imageFill._imageMetadata,
        scaleMode: (imageFill as any).scaleMode || 'FILL',
      };
    }
  }

  return figmaNode;
}

// ==================== Image → RECTANGLE with IMAGE fill ====================

function mapImage(node: DesignImageNode): FigmaRectangleNode {
  const positionProps = mapPositioning(node.positioning);
  const borderProps = mapBorderToStrokes(node.border);
  const effects = mapEffects(node.effects);

  // Map objectFit to scaleMode
  const scaleModeMap: Record<string, 'FILL' | 'FIT' | 'CROP' | 'TILE'> = {
    'fill': 'FILL',
    'contain': 'FIT',
    'cover': 'FILL',
    'none': 'CROP',
    'scale-down': 'FIT',
  };
  const scaleMode = scaleModeMap[node.imageData.objectFit] || 'FILL';

  const figmaNode: FigmaRectangleNode = {
    ...positionProps,
    ...borderProps,
    id: node.id,
    name: node.name,
    type: 'RECTANGLE' as const,
    visible: node.visible,
    locked: false,
    x: Math.round(node.bounds.x),
    y: Math.round(node.bounds.y),
    width: Math.round(node.bounds.width),
    height: Math.round(node.bounds.height),
    opacity: node.opacity,
    rotation: node.transform?.rotation != null ? -node.transform.rotation : undefined,

    // Image as fill — include base64 if browser captured it, otherwise pending URL for async fetch
    fills: [{
      type: 'IMAGE',
      scaleMode,
      visible: true,
      _pendingImageUrl: node.imageData.src,
      _imageMetadata: {
        originalUrl: node.imageData.src,
        width: node.imageData.width,
        height: node.imageData.height,
        ...(node.imageData.base64 ? { base64: node.imageData.base64 } : {}),
      },
    } as AsyncImagePaint],

    effects: effects.length > 0 ? effects : undefined,
  };

  // Blend mode
  if (node.effects.blendMode && node.effects.blendMode !== 'normal') {
    figmaNode.blendMode = mapBlendMode(node.effects.blendMode);
  }

  // Add imageMetadata at top level so ImageCreator can find it
  if (node.imageData.src) {
    // Detect SVG: data URI, URL ending in .svg, or base64 field with svg MIME
    const isSvg = isSvgDataUri(node.imageData.src)
      || isSvgUrl(node.imageData.src)
      || isSvgDataUri(node.imageData.base64 || '');
    const svgContent = isSvg
      ? (decodeSvgDataUri(node.imageData.src) ?? decodeSvgDataUri(node.imageData.base64 || ''))
      : undefined;

    (figmaNode as any).imageMetadata = {
      originalUrl: node.imageData.src,
      width: node.imageData.width,
      height: node.imageData.height,
      ...(node.imageData.base64 && !isSvg ? { base64: node.imageData.base64 } : {}),
      ...(isSvg ? { isSvg: true, ...(svgContent ? { svgContent } : {}) } : {}),
    };
  }

  return figmaNode;
}

function isSvgDataUri(src: string): boolean {
  return !!src && src.startsWith('data:image/svg');
}

function isSvgUrl(src: string): boolean {
  if (!src) return false;
  const path = src.split('?')[0].split('#')[0];
  return path.endsWith('.svg') || path.endsWith('.svgz');
}

/**
 * Decode SVG data URI to raw SVG string.
 * Handles both base64-encoded and plain text data URIs.
 */
function decodeSvgDataUri(src: string): string | undefined {
  if (!src.startsWith('data:image/svg')) return undefined;
  const commaIdx = src.indexOf(',');
  if (commaIdx === -1) return undefined;
  const meta = src.substring(0, commaIdx); // e.g. "data:image/svg+xml;base64"
  const payload = src.substring(commaIdx + 1);
  if (meta.includes('base64')) {
    try { return atob(payload); } catch { return undefined; }
  }
  try { return decodeURIComponent(payload); } catch { return payload; }
}

/**
 * Calculate Figma imageTransform for explicit background-size + background-position.
 *
 * Maps node normalized UV to image normalized UV so that the image
 * appears at (posX, posY) with display size (imgW x imgH) inside
 * a node of size (nodeW x nodeH).
 *
 * Formula:
 *   image_u = (nodeW / imgW) * node_u + (-posX / imgW)
 *   image_v = (nodeH / imgH) * node_v + (-posY / imgH)
 *
 * Position values from CSS:
 *   - Fractional (0-1 from keywords/percentages): posX = frac * (nodeW - imgW)
 *   - Pixel (>1 or explicitly parsed):             posX = value
 */
function calculateImageTransform(
  nodeW: number,
  nodeH: number,
  imgW: number,
  imgH: number,
  position: { x: number; y: number },
): [[number, number, number], [number, number, number]] | null {
  if (imgW <= 0 || imgH <= 0 || nodeW <= 0 || nodeH <= 0) return null;

  // Resolve position: values in [0,1] are fractions, values > 1 are pixels
  const posX = position.x <= 1
    ? position.x * (nodeW - imgW)
    : position.x;
  const posY = position.y <= 1
    ? position.y * (nodeH - imgH)
    : position.y;

  const sx = nodeW / imgW;
  const sy = nodeH / imgH;
  const tx = -posX / imgW;
  const ty = -posY / imgH;

  return [[sx, 0, tx], [0, sy, ty]];
}

// ==================== SVG → SVG node ====================

function mapSVG(node: DesignSVGNode): FigmaSVGNode {
  const positionProps = mapPositioning(node.positioning);
  const borderProps = node.border ? mapBorderToStrokes(node.border) : {};
  const effects = node.effects ? mapEffects(node.effects) : [];

  const svgNode: FigmaSVGNode = {
    ...positionProps,
    id: node.id,
    name: node.name,
    type: 'SVG' as const,
    visible: node.visible,
    locked: false,
    x: Math.round(node.bounds.x),
    y: Math.round(node.bounds.y),
    width: Math.round(node.bounds.width),
    height: Math.round(node.bounds.height),
    opacity: node.opacity,
    rotation: node.transform?.rotation != null ? -node.transform.rotation : undefined,
    svgContent: node.svgContent,
    effects: effects.length > 0 ? effects : undefined,
    strokes: borderProps.strokes,
    strokeWeight: borderProps.strokeWeight,
    strokeAlign: borderProps.strokeAlign,
    cornerRadius: borderProps.cornerRadius,
  } as FigmaSVGNode;

  // Blend mode
  if (node.effects?.blendMode && node.effects.blendMode !== 'normal') {
    svgNode.blendMode = mapBlendMode(node.effects.blendMode);
  }

  return svgNode;
}

// ==================== Helpers ====================
