import { textLineHeightPixels } from "./text-line-height.mjs";
import { validateTextRanges } from "./text-ranges.mjs";
import { mainAxisGap } from "./layout-spacing.mjs";
import {
  gridPlacements, gridTrackSizes, effectiveGridRows, gridFillHugContentHeight,
} from "./grid.mjs";
import { hasDesignStroke, designStrokeSides, strokeLayoutBasisExtra } from "./stroke.mjs";
/* Auto-layout and reusable-component helpers for Design Studio v3 documents. */
import { descendantIds, setNodeTreePosition } from "./geometry.mjs";
import {
  createBrowserTextMeasurer,
  currentTextMetrics,
  measuredWrap,
  measuredEllipsis,
  textMetricsSignature,
  textSourceMetricsSignature,
} from "./text-metrics.mjs";
import { designCoordinateLimit } from "./document.mjs";

export const CONTAINER_NODE_TYPES = Object.freeze(["frame", "group", "component"]);

function round(value, precision = 2) {
  const factor = 10 ** precision;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function assignNumber(node, property, value) {
  const next = round(value);
  if (node[property] === next) return false;
  node[property] = next;
  return true;
}

function glyphWidthFactor(character) {
  if (/\s/u.test(character)) return 0.33;
  if (/[ilI1.,:;'|!•·…]/u.test(character)) return 0.28;
  if (/[mwMW@#%&]/u.test(character)) return 0.9;
  if (/[\u0000-\u00ff]/u.test(character)) return 0.56;
  return 1;
}

function estimatedTextWidth(node, value) {
  const characters = Array.from(String(value));
  return (
    characters.reduce(
      (width, character) => width + glyphWidthFactor(character) * finite(node.fontSize, 16),
      0,
    ) +
    Math.max(0, characters.length - 1) * finite(node.letterSpacing)
  );
}

function ellipsizeTextValue(
  node,
  source,
  maximumWidth,
  widthOf = (value) => estimatedTextWidth(node, value),
) {
  return measuredEllipsis(source, maximumWidth, (value) => ({ width: widthOf(value) }));
}

function containerPadding(container, side) {
  const override = container[`padding${side}`];
  return Math.max(0, finite(override, Math.max(0, finite(container.padding))));
}

export function isContainerNode(node) {
  return Boolean(node && CONTAINER_NODE_TYPES.includes(node.type));
}

export function isAutoLayoutContainer(node) {
  return Boolean(isContainerNode(node) && ["horizontal", "vertical", "grid"].includes(node.layout));
}

export function childNodes(nodes, parentId, { visibleOnly = false } = {}) {
  if (!Array.isArray(nodes) || typeof parentId !== "string") return [];
  return nodes.filter(
    (node) => node.parentId === parentId && (!visibleOnly || node.visible !== false),
  );
}

export function isAutoLayoutFlowChild(node, parent) {
  return Boolean(
    node &&
    isAutoLayoutContainer(parent) &&
    node.parentId === parent.id &&
    node.layoutPositioning !== "absolute",
  );
}

function layoutChildren(nodes, container) {
  return childNodes(nodes, container.id, { visibleOnly: true }).filter(
    (node) => node.layoutPositioning !== "absolute",
  );
}

function axisSizing(node, axis) {
  const explicit =
    node?.[axis === "horizontal" ? "layoutSizingHorizontal" : "layoutSizingVertical"];
  if (["fixed", "hug", "fill"].includes(explicit)) return explicit;
  return "fixed";
}

function axisSizeProperty(axis) {
  return axis === "horizontal" ? "width" : "height";
}

function axisSizeLimits(node, axis) {
  const prefix = axis === "horizontal" ? "Width" : "Height";
  // A CSS border box cannot be smaller than its physical padding. Preserve the
  // authored max field while resolving the same minimum when max < padding.
  const padding = isAutoLayoutContainer(node) ? axisPadding(node, axis) : null;
  const paddingFloor = padding ? padding.start + padding.end : 0;
  const minimum = Math.min(20000, Math.max(1, paddingFloor, finite(node?.[`min${prefix}`], 1)));
  const maximum = Math.max(minimum, Math.min(20000, finite(node?.[`max${prefix}`], 20000)));
  return { minimum, maximum };
}

function limitedAxisSize(node, axis, value) {
  const { minimum, maximum } = axisSizeLimits(node, axis);
  return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
}

function assignAxisSize(node, axis, value) {
  const property = axisSizeProperty(axis), limited = limitedAxisSize(node, axis, value);
  const next = Object.is(limited, -0) ? 0 : limited;
  if (node[property] === next) return false;
  node[property] = next;
  return true;
}

function fillContentInset(node, axis) {
  if (isAutoLayoutContainer(node)) {
    const padding = axisPadding(node, axis);
    return padding.start + padding.end + strokeLayoutBasisExtra(node, axis);
  }
  const inactiveFrame = ["frame", "component"].includes(node?.type) && node.layout === "none";
  if ((node?.type === "rectangle" || inactiveFrame) && hasDesignStroke(node) && node.strokeAlign === "inside") {
    // Native inactive Frames reserve physical inside strokes like rectangles.
    // Their retained padding is inactive and must not become a content basis.
    const sides = designStrokeSides(node);
    return axis === "horizontal" ? sides[1].width + sides[3].width : sides[0].width + sides[2].width;
  }
  return 0;
}

export function distributeFillSizes(children, axis, available) {
  const sizes = new Map();
  let remaining = [...children];
  let remainingSpace = Math.max(0, finite(available));
  while (remaining.length > 0) {
    const insets = remaining.reduce((total, child) => total + fillContentInset(child, axis), 0);
    const share = Math.max(0, remainingSpace - insets) / remaining.length;
    const candidates = remaining.map((child) => {
      const target = share + fillContentInset(child, axis);
      const size = limitedAxisSize(child, axis, target);
      return { child, size, violation: size - target };
    });
    const violation = candidates.reduce((total, candidate) => total + candidate.violation, 0);
    // Freeze only the limits responsible for the total violation. Freezing both
    // a minimum and a maximum at once can otherwise leave distributable space.
    const clamped = candidates.filter((candidate) =>
      violation > 0.001 ? candidate.violation > 0.001 :
      violation < -0.001 ? candidate.violation < -0.001 : false,
    );
    if (clamped.length === 0) {
      for (const { child, size } of candidates) sizes.set(child.id, size);
      break;
    }
    const clampedIds = new Set();
    for (const { child, size } of clamped) {
      sizes.set(child.id, size);
      remainingSpace -= size;
      clampedIds.add(child.id);
    }
    remaining = remaining.filter((child) => !clampedIds.has(child.id));
  }
  return sizes;
}

function axisGap(container, axis) {
  const property = axis === "horizontal" ? "columnGap" : "rowGap";
  if ((container.layout === "horizontal" && axis === "horizontal") ||
      (container.layout === "vertical" && axis === "vertical")) return finite(mainAxisGap(container));
  return Math.max(0, finite(container[property], Math.max(0, finite(container.gap))));
}

function axisPadding(container, axis) {
  return axis === "horizontal"
    ? {
        start: containerPadding(container, "Left"),
        end: containerPadding(container, "Right"),
      }
    : {
        start: containerPadding(container, "Top"),
        end: containerPadding(container, "Bottom"),
      };
}

function packFlexLines(children, mainSize, maximum, gap, wrap, reverse = false) {
  // CSS collects each line in source order before reversing its main direction.
  // Reversing all items first changes line membership when items wrap.
  const ordered = line => reverse ? [...line].reverse() : line;
  if (!wrap || !Number.isFinite(maximum)) return children.length > 0 ? [ordered(children)] : [];
  const lines = [];
  let line = [];
  let occupied = 0;
  const axis = mainSize === "width" ? "horizontal" : "vertical";
  for (const child of children) {
    const size = limitedAxisSize(child, axis, child[mainSize]);
    const next = line.length === 0 ? size : occupied + gap + size;
    if (line.length > 0 && next > maximum + 0.01) {
      lines.push(ordered(line));
      line = [child];
      occupied = size;
    } else {
      line.push(child);
      occupied = next;
    }
  }
  if (line.length > 0) lines.push(ordered(line));
  return lines;
}

function flexContentSize(container, children) {
  const horizontal = container.layout === "horizontal";
  const mainAxis = horizontal ? "horizontal" : "vertical";
  const crossAxis = horizontal ? "vertical" : "horizontal";
  const mainSize = horizontal ? "width" : "height";
  const crossSize = horizontal ? "height" : "width";
  const mainPadding = axisPadding(container, mainAxis);
  const crossPadding = axisPadding(container, crossAxis);
  const mainGap = axisGap(container, mainAxis);
  const crossGap = axisGap(container, crossAxis);
  const mainHug = axisSizing(container, mainAxis) === "hug";
  const innerMain = mainHug
    ? Number.POSITIVE_INFINITY
    : Math.max(0, finite(container[mainSize]) - mainPadding.start - mainPadding.end);
  const wrap = ["wrap", "wrap-reverse"].includes(container.layoutWrap);
  const lines = packFlexLines(children, mainSize, innerMain, mainGap, wrap, container.layoutReverse);
  const lineMainSizes = lines.map(
    (line) =>
      line.reduce((total, child) => total + limitedAxisSize(child, mainAxis, child[mainSize]), 0) +
      mainGap * Math.max(0, line.length - 1),
  );
  const lineCrossSizes = lines.map((line) =>
    line.reduce(
      (largest, child) => Math.max(largest, limitedAxisSize(child, crossAxis, child[crossSize])),
      0,
    ),
  );
  return {
    main:
      mainPadding.start +
      mainPadding.end +
      (lineMainSizes.length > 0 ? Math.max(...lineMainSizes) : 0),
    cross:
      crossPadding.start +
      crossPadding.end +
      lineCrossSizes.reduce((total, size) => total + size, 0) +
      crossGap * Math.max(0, lineCrossSizes.length - 1),
  };
}

function intrinsicGridRows(placements, rowCount, rowGap) {
  const rows = Array.from({ length: rowCount }, () => 1);
  for (const placement of placements) {
    const required = Math.max(
      1,
      (limitedAxisSize(placement.child, "vertical", placement.child.height) -
        rowGap * Math.max(0, placement.rowSpan - 1)) /
        placement.rowSpan,
    );
    for (let row = placement.row; row < placement.row + placement.rowSpan; row += 1) {
      rows[row] = Math.max(rows[row], required);
    }
  }
  return rows;
}

function gridContentSize(nodes, container, children, parentOf) {
  const columns = Math.max(1, Math.round(finite(container.gridColumns, 1)));
  const columnGap = axisGap(container, "horizontal");
  const rowGap = axisGap(container, "vertical");
  const horizontalPadding = axisPadding(container, "horizontal");
  const verticalPadding = axisPadding(container, "vertical");
  const { placements, rowCount } = gridPlacements(children, columns, container);
  const widthOwner = container.layoutSizingHorizontal === "fill"
    ? parentOf?.(container) : undefined;
  const intrinsicColumn = placements.reduce(
    (largest, placement) =>
      Math.max(
        largest,
        (limitedAxisSize(placement.child, "horizontal", placement.child.width) -
          columnGap * Math.max(0, placement.columnSpan - 1)) /
          placement.columnSpan,
      ),
    1,
  );
  const explicitRows =
    container.gridAutoTracks === "rows"
      ? effectiveGridRows(container, rowCount)
      : Math.max(rowCount, container.gridRows ?? 0);
  const rows = container.gridRowSizes
    ? gridTrackSizes(
        container.gridRowSizes,
        explicitRows,
        placements,
        "vertical",
        rowGap,
        undefined,
        (child) => gridFillHugContentHeight(container, child, (node) => childNodes(nodes, node.id), widthOwner, parentOf),
      )
    : intrinsicGridRows(placements, explicitRows, rowGap);
  const columnWidths = container.gridColumnSizes
    ? gridTrackSizes(container.gridColumnSizes, columns, placements, "horizontal", columnGap)
    : Array(columns).fill(intrinsicColumn);
  return {
    width:
      horizontalPadding.start +
      horizontalPadding.end +
      columnWidths.reduce((total, size) => total + size, 0) +
      columnGap * Math.max(0, columns - 1),
    height:
      verticalPadding.start +
      verticalPadding.end +
      rows.reduce((total, size) => total + size, 0) +
      rowGap * Math.max(0, rows.length - 1),
  };
}

function applyHugSize(nodes, container, parentOf) {
  const children = layoutChildren(nodes, container);
  const content =
    container.layout === "grid"
      ? gridContentSize(nodes, container, children, parentOf)
      : (() => {
          const measured = flexContentSize(container, children);
          return container.layout === "horizontal"
            ? { width: measured.main, height: measured.cross }
            : { width: measured.cross, height: measured.main };
        })();
  let changed = false;
  if (axisSizing(container, "horizontal") === "hug") {
    changed = assignAxisSize(container, "horizontal", content.width) || changed;
  }
  if (axisSizing(container, "vertical") === "hug") {
    changed = assignAxisSize(container, "vertical", content.height) || changed;
  }
  return changed;
}

function distributedTrack(values, available, baseGap, alignment, signedAlignment = false) {
  let gap = baseGap;
  let offset = 0;
  const occupied = values.reduce((total, value) => total + value, 0);
  const baseGapTotal = baseGap * Math.max(0, values.length - 1);
  const signedFree = available - occupied - baseGapTotal;
  const free = Math.max(0, signedFree);
  if (alignment === "center") offset = (signedAlignment ? signedFree : free) / 2;
  else if (alignment === "end") offset = signedAlignment ? signedFree : free;
  else if (alignment === "space-between" && values.length > 1) gap += free / (values.length - 1);
  return { gap, offset, free };
}

function childAlignment(child, container) {
  return child.layoutAlignSelf && child.layoutAlignSelf !== "auto"
    ? child.layoutAlignSelf
    : (container.alignItems ?? "start");
}

function reverseAlignment(value) {
  if (value === "start") return "end";
  if (value === "end") return "start";
  return value;
}

function childBaseline(nodes, child) {
  const childDescendants = child.type === "text" ? null : descendantIds(nodes, child.id);
  const text =
    child.type === "text"
      ? child
      : nodes.find(
          (candidate) =>
            candidate.type === "text" &&
            candidate.visible !== false &&
            childDescendants.has(candidate.id),
        );
  if (!text) return limitedAxisSize(child, "vertical", child.height);
  const logicalTextTop = finite(text.y) - finite(text.layoutBaselineOffset);
  const baseline = logicalTextTop - finite(child.y) + finite(text.fontSize, 16) * 0.8;
  return Math.min(limitedAxisSize(child, "vertical", child.height), Math.max(0, baseline));
}

function lineBaselineMetrics(nodes, line, container, horizontal) {
  if (!horizontal) return null;
  const baselineChildren = line.filter((child) => childAlignment(child, container) === "baseline");
  if (baselineChildren.length === 0) return null;
  const values = baselineChildren.map((child) => ({
    child,
    baseline: childBaseline(nodes, child),
    height: limitedAxisSize(child, "vertical", child.height),
  }));
  const baseline = Math.max(...values.map((value) => value.baseline));
  const descent = Math.max(...values.map((value) => value.height - value.baseline));
  return { baseline, size: baseline + descent };
}

function layoutPosition(child, property, value) {
  return property === "y" && child.type === "text"
    ? round(value + finite(child.layoutBaselineOffset))
    : value;
}

function applyFlexLayout(nodes, container, children) {
  const horizontal = container.layout === "horizontal";
  const mainAxis = horizontal ? "horizontal" : "vertical";
  const crossAxis = horizontal ? "vertical" : "horizontal";
  const mainPosition = horizontal ? "x" : "y";
  const crossPosition = horizontal ? "y" : "x";
  const mainSize = horizontal ? "width" : "height";
  const crossSize = horizontal ? "height" : "width";
  const mainPadding = axisPadding(container, mainAxis);
  const crossPadding = axisPadding(container, crossAxis);
  const mainGap = axisGap(container, mainAxis);
  const crossGap = axisGap(container, crossAxis);
  const innerMain = Math.max(0, finite(container[mainSize]) - mainPadding.start - mainPadding.end);
  const innerCross = Math.max(
    0,
    finite(container[crossSize]) - crossPadding.start - crossPadding.end,
  );
  const wrap = ["wrap", "wrap-reverse"].includes(container.layoutWrap);
  const lines = packFlexLines(children, mainSize, innerMain, mainGap, wrap, container.layoutReverse);
  if (container.layoutWrap === "wrap-reverse") lines.reverse();
  let changed = false;

  for (const line of lines) {
    const fills = line.filter((child) => axisSizing(child, mainAxis) === "fill");
    if (fills.length === 0) continue;
    const fixed = line
      .filter((child) => axisSizing(child, mainAxis) !== "fill")
      .reduce((total, child) => total + limitedAxisSize(child, mainAxis, child[mainSize]), 0);
    const available = innerMain - fixed - mainGap * Math.max(0, line.length - 1);
    const fillSizes = distributeFillSizes(fills, mainAxis, available);
    for (const child of fills) {
      changed = assignAxisSize(child, mainAxis, fillSizes.get(child.id)) || changed;
    }
  }

  const baselineMetrics = lines.map((line) =>
    lineBaselineMetrics(nodes, line, container, horizontal),
  );
  let lineCrossSizes = lines.map((line, index) =>
    Math.max(
      baselineMetrics[index]?.size ?? 0,
      line.reduce(
        (largest, child) => Math.max(largest, limitedAxisSize(child, crossAxis, child[crossSize])),
        0,
      ),
    ),
  );
  if (!wrap && lineCrossSizes.length === 1) lineCrossSizes = [innerCross];
  const crossAlignment =
    container.layoutWrap === "wrap-reverse"
      ? reverseAlignment(container.alignContent ?? "start")
      : (container.alignContent ?? "start");
  const crossTrack = distributedTrack(lineCrossSizes, innerCross, crossGap, crossAlignment);
  if (wrap && container.alignContent === "stretch" && lineCrossSizes.length > 0) {
    const stretch = crossTrack.free / lineCrossSizes.length;
    lineCrossSizes = lineCrossSizes.map((size) => size + stretch);
    crossTrack.offset = 0;
  }

  let lineCrossCursor = finite(container[crossPosition]) + crossPadding.start + crossTrack.offset;
  for (const [lineIndex, line] of lines.entries()) {
    const lineCrossSize = Math.max(0, lineCrossSizes[lineIndex] ?? 0);
    const mainValues = line.map((child) => limitedAxisSize(child, mainAxis, child[mainSize]));
    const autoMargins = line.filter((child) => child.layoutMarginBefore === "auto");
    const mainTrack =
      autoMargins.length > 0
        ? {
            gap: mainGap,
            offset: 0,
            free: Math.max(
              0,
              innerMain -
                mainValues.reduce((total, value) => total + value, 0) -
                mainGap * Math.max(0, line.length - 1),
            ),
          }
        : distributedTrack(
            mainValues,
            innerMain,
            mainGap,
            container.layoutReverse
              ? reverseAlignment(container.justifyContent ?? "start")
              : (container.justifyContent ?? "start"),
            !wrap && !container.layoutReverse,
          );
    let mainCursor = finite(container[mainPosition]) + mainPadding.start + mainTrack.offset;
    for (const child of line) {
      if (child.layoutMarginBefore === "auto" && autoMargins.length > 0) {
        mainCursor += mainTrack.free / autoMargins.length;
      }
      const sizing = axisSizing(child, crossAxis);
      const logicalAlignment = childAlignment(child, container);
      const alignment = container.layoutWrap === "wrap-reverse"
        ? reverseAlignment(logicalAlignment) : logicalAlignment;
      if (sizing === "fill" || alignment === "stretch") {
        changed = assignAxisSize(child, crossAxis, lineCrossSize) || changed;
      }
      const childCrossSize = limitedAxisSize(child, crossAxis, child[crossSize]);
      let crossOffset = 0;
      if (alignment === "center") crossOffset = (lineCrossSize - childCrossSize) / 2;
      else if (alignment === "end") crossOffset = lineCrossSize - childCrossSize;
      else if (alignment === "baseline" && baselineMetrics[lineIndex]) {
        crossOffset = baselineMetrics[lineIndex].baseline - childBaseline(nodes, child);
      }
      changed =
        setNodeTreePosition(
          nodes,
          child.id,
          mainPosition,
          layoutPosition(child, mainPosition, mainCursor),
          { preservePrecision: true },
        ) || changed;
      changed =
        setNodeTreePosition(
          nodes,
          child.id,
          crossPosition,
          layoutPosition(child, crossPosition, lineCrossCursor + crossOffset),
          { preservePrecision: true },
        ) || changed;
      mainCursor += limitedAxisSize(child, mainAxis, child[mainSize]) + mainTrack.gap;
    }
    lineCrossCursor += lineCrossSize + crossTrack.gap;
  }
  return changed;
}

function applyGridLayout(nodes, container, children, parentOf) {
  const columns = Math.max(1, Math.round(finite(container.gridColumns, 1)));
  const columnGap = axisGap(container, "horizontal");
  const rowGap = axisGap(container, "vertical");
  const horizontalPadding = axisPadding(container, "horizontal");
  const verticalPadding = axisPadding(container, "vertical");
  const innerWidth = Math.max(
    0,
    finite(container.width) - horizontalPadding.start - horizontalPadding.end,
  );
  const innerHeight = Math.max(
    0,
    finite(container.height) - verticalPadding.start - verticalPadding.end,
  );
  const columnWidth = Math.max(1, (innerWidth - columnGap * Math.max(0, columns - 1)) / columns);
  const { placements, rowCount } = gridPlacements(children, columns, container);
  const widthOwner = container.layoutSizingHorizontal === "fill"
    ? parentOf?.(container) : undefined;
  const columnWidths = container.gridColumnSizes
    ? gridTrackSizes(
        container.gridColumnSizes,
        columns,
        placements,
        "horizontal",
        columnGap,
        innerWidth,
      )
    : Array(columns).fill(Math.fround(columnWidth));
  const explicitRows =
    container.gridAutoTracks === "rows"
      ? effectiveGridRows(container, rowCount)
      : Math.max(rowCount, container.gridRows ?? 0);
  let rowHeights = container.gridRowSizes
    ? gridTrackSizes(
        container.gridRowSizes,
        explicitRows,
        placements,
        "vertical",
        rowGap,
        innerHeight,
        (child) => gridFillHugContentHeight(container, child, (node) => childNodes(nodes, node.id), widthOwner, parentOf),
      )
    : intrinsicGridRows(placements, explicitRows, rowGap);
  const rowTrack = distributedTrack(
    rowHeights,
    innerHeight,
    rowGap,
    container.alignContent ?? "start",
  );
  if (container.alignContent === "stretch" && rowHeights.length > 0) {
    const stretch = rowTrack.free / rowHeights.length;
    rowHeights = rowHeights.map((height) => height + stretch);
    rowTrack.offset = 0;
  }
  const rowPositions = [];
  let rowCursor = finite(container.y) + verticalPadding.start + rowTrack.offset;
  for (const rowHeight of rowHeights) {
    rowPositions.push(rowCursor);
    rowCursor += rowHeight + rowTrack.gap;
  }

  let changed = false;
  for (const placement of placements) {
    const cellX =
      finite(container.x) +
      horizontalPadding.start +
      columnWidths.slice(0, placement.column).reduce((sum, size) => sum + size, 0) +
      placement.column * columnGap;
    const cellY = rowPositions[placement.row] ?? finite(container.y) + verticalPadding.start;
    const cellWidth =
      columnWidths
        .slice(placement.column, placement.column + placement.columnSpan)
        .reduce((sum, size) => sum + size, 0) +
      columnGap * Math.max(0, placement.columnSpan - 1);
    const cellHeight =
      rowHeights
        .slice(placement.row, placement.row + placement.rowSpan)
        .reduce((total, value) => total + value, 0) +
      rowTrack.gap * Math.max(0, placement.rowSpan - 1);
    const alignment = childAlignment(placement.child, container);
    if (axisSizing(placement.child, "horizontal") === "fill" || alignment === "stretch") {
      changed = assignAxisSize(placement.child, "horizontal", cellWidth) || changed;
    }
    if (axisSizing(placement.child, "vertical") === "fill" || alignment === "stretch") {
      changed = assignAxisSize(placement.child, "vertical", cellHeight) || changed;
    }
    const horizontalAlignment =
      placement.child.gridChildHorizontalAlign &&
      placement.child.gridChildHorizontalAlign !== "auto"
        ? placement.child.gridChildHorizontalAlign
        : alignment;
    const verticalAlignment =
      placement.child.gridChildVerticalAlign && placement.child.gridChildVerticalAlign !== "auto"
        ? placement.child.gridChildVerticalAlign
        : alignment;
    const horizontalOffset =
      horizontalAlignment === "center"
        ? (cellWidth - placement.child.width) / 2
        : horizontalAlignment === "end"
          ? cellWidth - placement.child.width
          : 0;
    const verticalOffset =
      verticalAlignment === "center"
        ? (cellHeight - placement.child.height) / 2
        : verticalAlignment === "end"
          ? cellHeight - placement.child.height
          : 0;
    changed =
      setNodeTreePosition(
        nodes,
        placement.child.id,
        "x",
        Math.fround(layoutPosition(placement.child, "x", cellX + horizontalOffset)),
        { preservePrecision: true },
      ) || changed;
    changed =
      setNodeTreePosition(
        nodes,
        placement.child.id,
        "y",
        Math.fround(layoutPosition(placement.child, "y", cellY + verticalOffset)),
        { preservePrecision: true },
      ) || changed;
  }
  return changed;
}

function constraintInset(node, property, fallback) {
  return Number.isFinite(node[property]) ? node[property] : fallback;
}

function applyAbsoluteConstraints(nodes, container) {
  const children = childNodes(nodes, container.id, { visibleOnly: true }).filter(
    (node) => node.layoutPositioning === "absolute",
  );
  let changed = false;
  for (const child of children) {
    const horizontal = child.constraintHorizontal;
    if (horizontal) {
      const left = constraintInset(child, "constraintLeft", child.x - container.x);
      const right = constraintInset(
        child,
        "constraintRight",
        container.x + container.width - child.x - child.width,
      );
      if (horizontal === "stretch") {
        changed = assignAxisSize(child, "horizontal", container.width - left - right) || changed;
        changed = setNodeTreePosition(nodes, child.id, "x", round(container.x + left)) || changed;
      } else if (horizontal === "end") {
        changed =
          setNodeTreePosition(
            nodes,
            child.id,
            "x",
            round(container.x + container.width - right - child.width),
          ) || changed;
      } else if (horizontal === "center") {
        const baseWidth = Math.max(
          1,
          constraintInset(child, "constraintBaseWidth", left + child.width + right),
        );
        const baseChildWidth = Math.max(1, baseWidth - left - right);
        const centerOffset = left + baseChildWidth / 2 - baseWidth / 2;
        changed =
          setNodeTreePosition(
            nodes,
            child.id,
            "x",
            round(container.x + container.width / 2 + centerOffset - child.width / 2),
          ) || changed;
      } else if (horizontal === "scale") {
        const baseWidth = Math.max(
          1,
          constraintInset(child, "constraintBaseWidth", left + child.width + right),
        );
        const baseChildWidth = Math.max(1, baseWidth - left - right);
        const scale = container.width / baseWidth;
        changed = assignAxisSize(child, "horizontal", baseChildWidth * scale) || changed;
        changed =
          setNodeTreePosition(nodes, child.id, "x", round(container.x + left * scale)) || changed;
      } else {
        changed = setNodeTreePosition(nodes, child.id, "x", round(container.x + left)) || changed;
      }
    }

    const vertical = child.constraintVertical;
    if (vertical) {
      const top = constraintInset(child, "constraintTop", child.y - container.y);
      const bottom = constraintInset(
        child,
        "constraintBottom",
        container.y + container.height - child.y - child.height,
      );
      if (vertical === "stretch") {
        changed = assignAxisSize(child, "vertical", container.height - top - bottom) || changed;
        changed = setNodeTreePosition(nodes, child.id, "y", round(container.y + top)) || changed;
      } else if (vertical === "end") {
        changed =
          setNodeTreePosition(
            nodes,
            child.id,
            "y",
            round(container.y + container.height - bottom - child.height),
          ) || changed;
      } else if (vertical === "center") {
        const baseHeight = Math.max(
          1,
          constraintInset(child, "constraintBaseHeight", top + child.height + bottom),
        );
        const baseChildHeight = Math.max(1, baseHeight - top - bottom);
        const centerOffset = top + baseChildHeight / 2 - baseHeight / 2;
        changed =
          setNodeTreePosition(
            nodes,
            child.id,
            "y",
            round(container.y + container.height / 2 + centerOffset - child.height / 2),
          ) || changed;
      } else if (vertical === "scale") {
        const baseHeight = Math.max(
          1,
          constraintInset(child, "constraintBaseHeight", top + child.height + bottom),
        );
        const baseChildHeight = Math.max(1, baseHeight - top - bottom);
        const scale = container.height / baseHeight;
        changed = assignAxisSize(child, "vertical", baseChildHeight * scale) || changed;
        changed =
          setNodeTreePosition(nodes, child.id, "y", round(container.y + top * scale)) || changed;
      } else {
        changed = setNodeTreePosition(nodes, child.id, "y", round(container.y + top)) || changed;
      }
    }
  }
  return changed;
}

const responsiveTextStates = new WeakMap();
const textBaselineStates = new WeakMap();

function textLayoutMeasurer(nodes, supplied) {
  if (supplied !== undefined) return supplied;
  if (
    !nodes.some(
      (node) =>
        node.type === "text" &&
        (node.textFlow === "wrap" ||
          node.textOverflow === "ellipsis" ||
          axisSizing(node, "horizontal") === "hug" ||
          ["native", "html"].includes(node.layoutBaselineSource)),
    )
  )
    return null;
  try {
    return createBrowserTextMeasurer();
  } catch {
    return null;
  }
}

// Canonical y is a hanging origin; manual/native line-box geometry stays fixed.
// Provenance lives outside glyph receipts so Node-only reflow cannot erase it.
function refreshTextBaselines(nodes, measurement, canvas) {
  if (!measurement?.lineBoxOffset) return false;
  let changed = false;
  for (const node of nodes) {
    if (node.type !== "text" || !["native", "html"].includes(node.layoutBaselineSource) || node.rotation) continue;
    const key = JSON.stringify([node.fontFamily, node.fontRef, node.fontSize, node.fontWeight,
      node.fontStyle, node.letterSpacing, node.lineHeight, node.lineHeightUnit]);
    const cached = textBaselineStates.get(node);
    if (cached?.key === key && cached.offset === node.layoutBaselineOffset) continue;
    measurement.configure(node);
    const logicalY = node.y - finite(node.layoutBaselineOffset);
    const nextY = round(logicalY + measurement.lineBoxOffset(node));
    if (Math.abs(nextY) > designCoordinateLimit(canvas)) throw Error("文字基线映射会超过设计坐标范围");
    const offset = round(nextY - logicalY, 4);
    changed = assignNumber(node, "y", nextY) || changed;
    if (node.layoutBaselineOffset !== offset) {
      node.layoutBaselineOffset = offset;
      changed = true;
    }
    textBaselineStates.set(node, { key, offset });
  }
  return changed;
}

function applyResponsiveText(nodes, containerIds, measurement) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const eligibleContainers = containerIds instanceof Set ? containerIds : new Set(containerIds);
  let changed = false;
  for (const node of nodes) {
    const rangedSource =
      node.type === "text" && node.textRanges !== undefined && node.textSource === undefined
        ? node.text
        : undefined;
    if (
      node.type !== "text" ||
      (node.textFlow !== "wrap" &&
        node.textOverflow !== "ellipsis" &&
        axisSizing(node, "horizontal") !== "hug") ||
      (typeof node.textSource !== "string" && rangedSource === undefined)
    ) {
      continue;
    }
    const parent = byId.get(node.parentId);
    if (!parent || !eligibleContainers.has(parent.id) || !isAutoLayoutContainer(parent)) {
      continue;
    }
    // Ranges may bind text directly. Retain that exact source before responsive
    // layout can add display-only LF; this does not require source on all Text.
    if (rangedSource !== undefined) {
      node.textSource = rangedSource;
      changed = true;
    }
    const contentLeft = parent.x + containerPadding(parent, "Left");
    const contentRight = parent.x + parent.width - containerPadding(parent, "Right");
    const leftOffset = Math.max(0, node.x - contentLeft);
    const available = Math.max(1, contentRight - contentLeft - leftOffset);
    const signature = textSourceMetricsSignature(node);
    const cached = responsiveTextStates.get(node);
    const receipt = currentTextMetrics(node);
    if (
      Number.isFinite(node.textFlowWidth) &&
      Math.abs(available - node.textFlowWidth) < 0.5 &&
      ((cached?.signature === signature && cached.text === node.text) ||
        receipt ||
        (!node.textMetrics && node.textSource === node.text))
    ) {
      continue;
    }
    measurement?.configure(node);
    const widthOf = measurement
      ? (value) => measurement.measure(value).width
      : (value) => estimatedTextWidth(node, value);
    const intrinsic = node.textFlow !== "wrap" && node.textOverflow !== "ellipsis";
    const lines =
      node.textOverflow === "ellipsis"
        ? [ellipsizeTextValue(node, node.textSource, available, widthOf)]
        : intrinsic
          ? node.textSource.split("\n")
          : measuredWrap(node.textSource, available, (value) => ({ width: widthOf(value) }));
    const nextText = lines.join("\n");
    if (nextText.length > 4000) throw Error(`文字 ${node.id} 换行后超过 4000 字符；请拆分文字图层`);
    if (node.text !== nextText) {
      node.text = nextText;
      changed = true;
    }
    const widest = Math.max(1, ...lines.map(widthOf));
    const nextWidth = intrinsic
      ? widest
      : axisSizing(node, "horizontal") === "fill"
        ? available
        : Math.min(available, widest);
    changed = assignAxisSize(node, "horizontal", nextWidth) || changed;
    // Responsive text line-box measurement retains its existing typography
    // quantizer (for example the canonical 1.3333 ratio for a 16px line box).
    // This is separate from transporting frame/track geometry without rounding.
    changed = assignNumber(node, "height", limitedAxisSize(node, "vertical",
      Math.max(1, lines.length * textLineHeightPixels(node)))) || changed;
    changed = assignNumber(node, "textFlowWidth", available) || changed;
    if (measurement) {
      const metrics = lines.map((line) => measurement.measure(line));
      const nextMetrics = {
        version: 1,
        signature: textMetricsSignature(node),
        sourceSignature: signature,
        lineWidths: metrics.map((metric) => metric.width),
        lineInkBounds: metrics.map((metric) => metric.ink),
        height: Math.max(
          0,
          ...metrics.map(
            (metric, index) => metric.bottom + index * textLineHeightPixels(node),
          ),
        ),
        fontAvailable: measurement.fontAvailable(node),
      };
      if (JSON.stringify(node.textMetrics) !== JSON.stringify(nextMetrics)) {
        node.textMetrics = nextMetrics;
        changed = true;
      }
      if (node.textMeasurement !== "browser") {
        node.textMeasurement = "browser";
        changed = true;
      }
    } else if (node.textMeasurement !== undefined || node.textMetrics !== undefined) {
      delete node.textMeasurement;
      delete node.textMetrics;
      changed = true;
    }
    responsiveTextStates.set(node, { signature, text: node.text });
  }
  return changed;
}

function applyContainerSizeLimits(nodes, container) {
  let changed = false;
  for (const node of [container, ...childNodes(nodes, container.id, { visibleOnly: true })]) {
    if (isAutoLayoutContainer(node) || node.minWidth !== undefined || node.maxWidth !== undefined) {
      changed = assignAxisSize(node, "horizontal", node.width) || changed;
    }
    if (isAutoLayoutContainer(node) || node.minHeight !== undefined || node.maxHeight !== undefined) {
      changed = assignAxisSize(node, "vertical", node.height) || changed;
    }
  }
  return changed;
}

export function applyAutoLayout(nodes, containerId, { textMeasurer, canvas } = {}) {
  if (!Array.isArray(nodes) || typeof containerId !== "string") return false;
  nodes.forEach(validateTextRanges);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parentOf = (node) => node.parentId ? byId.get(node.parentId) : null;
  const container = byId.get(containerId);
  if (!isAutoLayoutContainer(container)) return false;
  const children = layoutChildren(nodes, container);
  let changed = applyContainerSizeLimits(nodes, container);
  changed = applyHugSize(nodes, container, parentOf) || changed;
  if (children.length > 0) {
    changed =
      (container.layout === "grid"
        ? applyGridLayout(nodes, container, children, parentOf)
        : applyFlexLayout(nodes, container, children)) || changed;
  }
  changed = applyAbsoluteConstraints(nodes, container) || changed;
  const measurement = textLayoutMeasurer(nodes, textMeasurer);
  try {
    changed = refreshTextBaselines(nodes, measurement, canvas) || changed;
    changed = applyResponsiveText(nodes, new Set([container.id]), measurement) || changed;
  } finally {
    if (textMeasurer === undefined) measurement?.close?.();
  }
  return changed;
}

function nodeDepth(nodes, node) {
  const byId = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const seen = new Set();
  let current = node;
  let value = 0;
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    current = byId.get(current.parentId);
    value += 1;
  }
  return value;
}

/**
 * Reflow only the requested auto-layout containers.
 *
 * Coordinates in the editor model are always absolute document coordinates, including nested
 * children. Auto layout is therefore an explicit geometry owner, not a document-wide normalization
 * pass: manual-layout containers keep the x/y values supplied by people and Agents.
 */
export function applyAutoLayouts(nodes, containerIds, { textMeasurer, canvas } = {}) {
  if (!Array.isArray(nodes) || !containerIds) return false;
  nodes.forEach(validateTextRanges);
  const requested = new Set(containerIds);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parentOf = (node) => node.parentId ? byId.get(node.parentId) : null;
  for (const id of [...requested]) {
    let node = byId.get(id);
    const seen = new Set();
    while (node && !seen.has(node.id)) {
      seen.add(node.id);
      const parent = byId.get(node.parentId);
      if (!isAutoLayoutFlowChild(node, parent)) break;
      const intrinsicGridDependency = parent.layout === "grid" && gridFillHugContentHeight(
        parent, node, (descendant) => childNodes(nodes, descendant.id), byId.get(parent.parentId), parentOf,
      ) !== null;
      if (axisSizing(node, "horizontal") !== "hug" &&
          axisSizing(node, "vertical") !== "hug" && !intrinsicGridDependency) break;
      requested.add(parent.id);
      node = parent;
    }
  }
  for (const containerId of [...requested]) {
    for (const descendantId of descendantIds(nodes, new Set([containerId]))) {
      const descendant = nodes.find((node) => node.id === descendantId);
      if (isAutoLayoutContainer(descendant)) requested.add(descendant.id);
    }
  }
  const containers = nodes
    .filter((candidate) => requested.has(candidate.id) && isAutoLayoutContainer(candidate))
    .sort((left, right) => nodeDepth(nodes, left) - nodeDepth(nodes, right));
  const containerIdSet = new Set(containers.map((container) => container.id));
  let changed = false;
  const measurement = textLayoutMeasurer(nodes, textMeasurer);
  try {
    changed = refreshTextBaselines(nodes, measurement, canvas) || changed;
    for (let iteration = 0; containers.length && iteration < 8; iteration += 1) {
      let iterationChanged = false;
      for (const node of [...containers].reverse()) {
        iterationChanged = applyContainerSizeLimits(nodes, node) || iterationChanged;
        iterationChanged = applyHugSize(nodes, node, parentOf) || iterationChanged;
      }
      for (const node of containers) {
        const children = layoutChildren(nodes, node);
        if (children.length > 0) {
          iterationChanged =
            (node.layout === "grid"
              ? applyGridLayout(nodes, node, children, parentOf)
              : applyFlexLayout(nodes, node, children)) || iterationChanged;
        }
        iterationChanged = applyAbsoluteConstraints(nodes, node) || iterationChanged;
      }
      iterationChanged =
        applyResponsiveText(nodes, containerIdSet, measurement) || iterationChanged;
      changed = iterationChanged || changed;
      if (!iterationChanged) break;
    }
  } finally {
    if (textMeasurer === undefined) measurement?.close?.();
  }
  return changed;
}

export function applyAllAutoLayouts(nodes, options) {
  if (!Array.isArray(nodes)) return false;
  return applyAutoLayouts(
    nodes,
    nodes.filter((node) => isAutoLayoutContainer(node)).map((node) => node.id),
    options,
  );
}

export function createComponentInstance(component, id, offset = 32, canvas = null) {
  if (!component || component.type !== "component" || typeof id !== "string" || !id) {
    return null;
  }
  const candidates = [
    { x: component.x + component.width + offset, y: component.y },
    { x: component.x, y: component.y + component.height + offset },
    { x: component.x - component.width - offset, y: component.y },
    { x: component.x, y: component.y - component.height - offset },
  ];
  if (canvas?.mode === "infinite") {
    const limit = designCoordinateLimit(canvas);
    const position = candidates.find((candidate) =>
      Math.abs(candidate.x) <= limit && Math.abs(candidate.y) <= limit) ?? {
      x: Math.min(limit, Math.max(-limit, component.x + offset)),
      y: Math.min(limit, Math.max(-limit, component.y + offset)),
    };
    return componentInstanceAt(component, id, position);
  }
  const fitsCanvas = (candidate) =>
    canvas &&
    candidate.x >= 0 &&
    candidate.y >= 0 &&
    candidate.x + component.width <= canvas.width &&
    candidate.y + component.height <= canvas.height;
  const position = canvas
    ? (candidates.find(fitsCanvas) ?? {
        x: Math.min(Math.max(0, component.x + offset), Math.max(0, canvas.width - component.width)),
        y: Math.min(
          Math.max(0, component.y + offset),
          Math.max(0, canvas.height - component.height),
        ),
      })
    : candidates[0];
  return componentInstanceAt(component, id, position);
}

function componentInstanceAt(component, id, position) {
  return {
    id,
    type: "instance",
    name: `${component.name} · 实例`,
    componentId: component.id,
    x: round(position.x),
    y: round(position.y),
    width: round(component.width),
    height: round(component.height),
    fill: "transparent",
    stroke: "transparent",
    strokeWidth: 0,
    opacity: 1,
    rotation: 0,
    cornerRadius: 0,
    visible: true,
    locked: false,
  };
}
