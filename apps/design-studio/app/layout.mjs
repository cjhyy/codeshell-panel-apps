/* Auto-layout and reusable-component helpers for Design Studio v3 documents. */
import { descendantIds, setNodeTreePosition } from "./geometry.mjs";

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

function wrapTextValue(node, source, maximumWidth) {
  const tokens = String(source)
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  if (tokens.length === 0) return [""];
  const lines = [];
  let line = "";
  const pushLongToken = (token) => {
    let segment = "";
    for (const character of Array.from(token)) {
      const candidate = `${segment}${character}`;
      if (segment && estimatedTextWidth(node, candidate) > maximumWidth) {
        lines.push(segment);
        segment = character;
      } else {
        segment = candidate;
      }
    }
    return segment;
  };
  for (const token of tokens) {
    const candidate = line ? `${line} ${token}` : token;
    if (!line || estimatedTextWidth(node, candidate) <= maximumWidth) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line =
      estimatedTextWidth(node, token) > maximumWidth ? pushLongToken(token) : token;
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

function ellipsizeTextValue(node, source, maximumWidth) {
  if (estimatedTextWidth(node, source) <= maximumWidth) return source;
  const characters = [...source];
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimatedTextWidth(node, `${characters.slice(0, middle).join("")}…`) <= maximumWidth) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return `${characters.slice(0, low).join("").trimEnd()}…`;
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
  const explicit = node?.[axis === "horizontal" ? "layoutSizingHorizontal" : "layoutSizingVertical"];
  if (["fixed", "hug", "fill"].includes(explicit)) return explicit;
  return "fixed";
}

function axisSizeProperty(axis) {
  return axis === "horizontal" ? "width" : "height";
}

function axisSizeLimits(node, axis) {
  const prefix = axis === "horizontal" ? "Width" : "Height";
  const minimum = Math.max(1, finite(node?.[`min${prefix}`], 1));
  const maximum = Math.max(minimum, finite(node?.[`max${prefix}`], Number.POSITIVE_INFINITY));
  return { minimum, maximum };
}

function limitedAxisSize(node, axis, value) {
  const { minimum, maximum } = axisSizeLimits(node, axis);
  return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
}

function assignAxisSize(node, axis, value) {
  return assignNumber(node, axisSizeProperty(axis), limitedAxisSize(node, axis, value));
}

function distributeFillSizes(children, axis, available) {
  const sizes = new Map();
  let remaining = [...children];
  let remainingSpace = Math.max(0, finite(available));
  while (remaining.length > 0) {
    const share = remainingSpace / remaining.length;
    const clamped = remaining.filter((child) => {
      const size = limitedAxisSize(child, axis, share);
      if (Math.abs(size - share) <= 0.001) return false;
      sizes.set(child.id, size);
      remainingSpace -= size;
      return true;
    });
    if (clamped.length === 0) {
      for (const child of remaining) sizes.set(child.id, limitedAxisSize(child, axis, share));
      break;
    }
    const clampedIds = new Set(clamped.map((child) => child.id));
    remaining = remaining.filter((child) => !clampedIds.has(child.id));
  }
  return sizes;
}

function axisGap(container, axis) {
  const property = axis === "horizontal" ? "columnGap" : "rowGap";
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

function packFlexLines(children, mainSize, maximum, gap, wrap) {
  if (!wrap || !Number.isFinite(maximum)) return children.length > 0 ? [children] : [];
  const lines = [];
  let line = [];
  let occupied = 0;
  const axis = mainSize === "width" ? "horizontal" : "vertical";
  for (const child of children) {
    const size = limitedAxisSize(child, axis, child[mainSize]);
    const next = line.length === 0 ? size : occupied + gap + size;
    if (line.length > 0 && next > maximum + 0.01) {
      lines.push(line);
      line = [child];
      occupied = size;
    } else {
      line.push(child);
      occupied = next;
    }
  }
  if (line.length > 0) lines.push(line);
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
  const lines = packFlexLines(children, mainSize, innerMain, mainGap, wrap);
  const lineMainSizes = lines.map(
    (line) =>
      line.reduce(
        (total, child) => total + limitedAxisSize(child, mainAxis, child[mainSize]),
        0,
      ) +
      mainGap * Math.max(0, line.length - 1),
  );
  const lineCrossSizes = lines.map((line) =>
    line.reduce(
      (largest, child) =>
        Math.max(largest, limitedAxisSize(child, crossAxis, child[crossSize])),
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

function gridPlacements(children, columnCount) {
  const occupied = [];
  const placements = [];
  const fits = (row, column, rowSpan, columnSpan) => {
    if (column < 0 || column + columnSpan > columnCount) return false;
    for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
      for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
        if (occupied[row + rowOffset]?.[column + columnOffset]) return false;
      }
    }
    return true;
  };
  for (const child of children) {
    const columnSpan = Math.min(
      columnCount,
      Math.max(1, Math.round(finite(child.gridColumnSpan, 1))),
    );
    const rowSpan = Math.max(1, Math.round(finite(child.gridRowSpan, 1)));
    let row = 0;
    let column = 0;
    while (!fits(row, column, rowSpan, columnSpan)) {
      column += 1;
      if (column + columnSpan > columnCount) {
        row += 1;
        column = 0;
      }
    }
    for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
      occupied[row + rowOffset] ??= [];
      for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
        occupied[row + rowOffset][column + columnOffset] = true;
      }
    }
    placements.push({ child, row, column, rowSpan, columnSpan });
  }
  return {
    placements,
    rowCount: placements.reduce(
      (count, placement) => Math.max(count, placement.row + placement.rowSpan),
      0,
    ),
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

function gridContentSize(container, children) {
  const columns = Math.max(1, Math.round(finite(container.gridColumns, 1)));
  const columnGap = axisGap(container, "horizontal");
  const rowGap = axisGap(container, "vertical");
  const horizontalPadding = axisPadding(container, "horizontal");
  const verticalPadding = axisPadding(container, "vertical");
  const { placements, rowCount } = gridPlacements(children, columns);
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
  const rows = intrinsicGridRows(placements, rowCount, rowGap);
  return {
    width:
      horizontalPadding.start +
      horizontalPadding.end +
      intrinsicColumn * columns +
      columnGap * Math.max(0, columns - 1),
    height:
      verticalPadding.start +
      verticalPadding.end +
      rows.reduce((total, size) => total + size, 0) +
      rowGap * Math.max(0, rows.length - 1),
  };
}

function applyHugSize(nodes, container) {
  const children = layoutChildren(nodes, container);
  const content =
    container.layout === "grid"
      ? gridContentSize(container, children)
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

function distributedTrack(values, available, baseGap, alignment) {
  let gap = baseGap;
  let offset = 0;
  const occupied = values.reduce((total, value) => total + value, 0);
  const baseGapTotal = baseGap * Math.max(0, values.length - 1);
  const free = Math.max(0, available - occupied - baseGapTotal);
  if (alignment === "center") offset = free / 2;
  else if (alignment === "end") offset = free;
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
  const baseline =
    logicalTextTop - finite(child.y) + finite(text.fontSize, 16) * 0.8;
  return Math.min(
    limitedAxisSize(child, "vertical", child.height),
    Math.max(0, baseline),
  );
}

function lineBaselineMetrics(nodes, line, container, horizontal) {
  if (!horizontal) return null;
  const baselineChildren = line.filter(
    (child) => childAlignment(child, container) === "baseline",
  );
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
    ? value + finite(child.layoutBaselineOffset)
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
  const innerMain = Math.max(
    0,
    finite(container[mainSize]) - mainPadding.start - mainPadding.end,
  );
  const innerCross = Math.max(
    0,
    finite(container[crossSize]) - crossPadding.start - crossPadding.end,
  );
  const wrap = ["wrap", "wrap-reverse"].includes(container.layoutWrap);
  const orderedChildren = container.layoutReverse ? [...children].reverse() : children;
  const lines = packFlexLines(orderedChildren, mainSize, innerMain, mainGap, wrap);
  if (container.layoutWrap === "wrap-reverse") lines.reverse();
  let changed = false;

  for (const line of lines) {
    const fills = line.filter((child) => axisSizing(child, mainAxis) === "fill");
    if (fills.length === 0) continue;
    const fixed = line
      .filter((child) => axisSizing(child, mainAxis) !== "fill")
      .reduce(
        (total, child) => total + limitedAxisSize(child, mainAxis, child[mainSize]),
        0,
      );
    const available =
      innerMain - fixed - mainGap * Math.max(0, line.length - 1);
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
        (largest, child) =>
          Math.max(largest, limitedAxisSize(child, crossAxis, child[crossSize])),
        0,
      ),
    ),
  );
  if (!wrap && lineCrossSizes.length === 1) lineCrossSizes = [innerCross];
  const crossAlignment =
    container.layoutWrap === "wrap-reverse"
      ? reverseAlignment(container.alignContent ?? "start")
      : (container.alignContent ?? "start");
  const crossTrack = distributedTrack(
    lineCrossSizes,
    innerCross,
    crossGap,
    crossAlignment,
  );
  if (wrap && container.alignContent === "stretch" && lineCrossSizes.length > 0) {
    const stretch = crossTrack.free / lineCrossSizes.length;
    lineCrossSizes = lineCrossSizes.map((size) => size + stretch);
    crossTrack.offset = 0;
  }

  let lineCrossCursor =
    finite(container[crossPosition]) + crossPadding.start + crossTrack.offset;
  for (const [lineIndex, line] of lines.entries()) {
    const lineCrossSize = Math.max(0, lineCrossSizes[lineIndex] ?? 0);
    const mainValues = line.map((child) =>
      limitedAxisSize(child, mainAxis, child[mainSize]),
    );
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
          );
    let mainCursor = finite(container[mainPosition]) + mainPadding.start + mainTrack.offset;
    for (const child of line) {
      if (child.layoutMarginBefore === "auto" && autoMargins.length > 0) {
        mainCursor += mainTrack.free / autoMargins.length;
      }
      const sizing = axisSizing(child, crossAxis);
      const alignment = childAlignment(child, container);
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
          round(layoutPosition(child, mainPosition, mainCursor)),
        ) || changed;
      changed =
        setNodeTreePosition(
          nodes,
          child.id,
          crossPosition,
          round(layoutPosition(child, crossPosition, lineCrossCursor + crossOffset)),
        ) || changed;
      mainCursor += limitedAxisSize(child, mainAxis, child[mainSize]) + mainTrack.gap;
    }
    lineCrossCursor += lineCrossSize + crossTrack.gap;
  }
  return changed;
}

function applyGridLayout(nodes, container, children) {
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
  const { placements, rowCount } = gridPlacements(children, columns);
  let rowHeights = intrinsicGridRows(placements, rowCount, rowGap);
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
      placement.column * (columnWidth + columnGap);
    const cellY = rowPositions[placement.row] ?? finite(container.y) + verticalPadding.start;
    const cellWidth =
      columnWidth * placement.columnSpan + columnGap * Math.max(0, placement.columnSpan - 1);
    const cellHeight =
      rowHeights
        .slice(placement.row, placement.row + placement.rowSpan)
        .reduce((total, value) => total + value, 0) +
      rowTrack.gap * Math.max(0, placement.rowSpan - 1);
    const alignment = childAlignment(placement.child, container);
    if (
      axisSizing(placement.child, "horizontal") === "fill" ||
      alignment === "stretch"
    ) {
      changed = assignAxisSize(placement.child, "horizontal", cellWidth) || changed;
    }
    if (
      axisSizing(placement.child, "vertical") === "fill" ||
      alignment === "stretch"
    ) {
      changed = assignAxisSize(placement.child, "vertical", cellHeight) || changed;
    }
    const horizontalOffset =
      alignment === "center"
        ? (cellWidth - placement.child.width) / 2
        : alignment === "end"
          ? cellWidth - placement.child.width
          : 0;
    const verticalOffset =
      alignment === "center"
        ? (cellHeight - placement.child.height) / 2
        : alignment === "end"
          ? cellHeight - placement.child.height
          : 0;
    changed =
      setNodeTreePosition(
        nodes,
        placement.child.id,
        "x",
        round(layoutPosition(placement.child, "x", cellX + horizontalOffset)),
      ) ||
      changed;
    changed =
      setNodeTreePosition(
        nodes,
        placement.child.id,
        "y",
        round(layoutPosition(placement.child, "y", cellY + verticalOffset)),
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
        changed =
          assignAxisSize(child, "vertical", container.height - top - bottom) || changed;
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

function applyResponsiveText(nodes, containerIds) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const eligibleContainers = containerIds instanceof Set ? containerIds : new Set(containerIds);
  let changed = false;
  for (const node of nodes) {
    if (
      node.type !== "text" ||
      (node.textFlow !== "wrap" && node.textOverflow !== "ellipsis") ||
      !node.textSource
    ) {
      continue;
    }
    const parent = byId.get(node.parentId);
    if (
      !parent ||
      !eligibleContainers.has(parent.id) ||
      !isAutoLayoutContainer(parent)
    ) {
      continue;
    }
    const contentLeft = parent.x + containerPadding(parent, "Left");
    const contentRight = parent.x + parent.width - containerPadding(parent, "Right");
    const leftOffset = Math.max(0, node.x - contentLeft);
    const available = Math.max(1, contentRight - contentLeft - leftOffset);
    if (
      Number.isFinite(node.textFlowWidth) &&
      Math.abs(available - node.textFlowWidth) < 0.5
    ) {
      continue;
    }
    const lines =
      node.textOverflow === "ellipsis"
        ? [ellipsizeTextValue(node, node.textSource, available)]
        : wrapTextValue(node, node.textSource, available);
    const nextText = lines.join("\n");
    if (node.text !== nextText) {
      node.text = nextText;
      changed = true;
    }
    const widest = Math.max(1, ...lines.map((line) => estimatedTextWidth(node, line)));
    const nextWidth =
      axisSizing(node, "horizontal") === "fill" ? available : Math.min(available, widest);
    changed = assignAxisSize(node, "horizontal", nextWidth) || changed;
    changed =
      assignAxisSize(
        node,
        "vertical",
        Math.max(1, lines.length * finite(node.fontSize, 16) * finite(node.lineHeight, 1.2)),
      ) || changed;
    changed = assignNumber(node, "textFlowWidth", available) || changed;
    if (node.textMeasurement !== undefined) {
      delete node.textMeasurement;
      changed = true;
    }
  }
  return changed;
}

export function applyAutoLayout(nodes, containerId) {
  if (!Array.isArray(nodes) || typeof containerId !== "string") return false;
  const container = nodes.find((node) => node.id === containerId);
  if (!isAutoLayoutContainer(container)) return false;
  const children = layoutChildren(nodes, container);
  let changed = false;
  for (const node of [container, ...childNodes(nodes, container.id, { visibleOnly: true })]) {
    if (node.minWidth !== undefined || node.maxWidth !== undefined) {
      changed = assignAxisSize(node, "horizontal", node.width) || changed;
    }
    if (node.minHeight !== undefined || node.maxHeight !== undefined) {
      changed = assignAxisSize(node, "vertical", node.height) || changed;
    }
  }
  changed = applyHugSize(nodes, container) || changed;
  if (children.length > 0) {
    changed =
      (container.layout === "grid"
        ? applyGridLayout(nodes, container, children)
        : applyFlexLayout(nodes, container, children)) || changed;
  }
  changed = applyAbsoluteConstraints(nodes, container) || changed;
  changed = applyResponsiveText(nodes, new Set([container.id])) || changed;
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
export function applyAutoLayouts(nodes, containerIds) {
  if (!Array.isArray(nodes) || !containerIds) return false;
  const requested = new Set(containerIds);
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
  for (let iteration = 0; iteration < 8; iteration += 1) {
    let iterationChanged = false;
    for (const node of [...containers].reverse()) {
      iterationChanged = applyHugSize(nodes, node) || iterationChanged;
    }
    for (const node of containers) {
      const children = layoutChildren(nodes, node);
      if (children.length > 0) {
        iterationChanged =
          (node.layout === "grid"
            ? applyGridLayout(nodes, node, children)
            : applyFlexLayout(nodes, node, children)) || iterationChanged;
      }
      iterationChanged = applyAbsoluteConstraints(nodes, node) || iterationChanged;
    }
    iterationChanged = applyResponsiveText(nodes, containerIdSet) || iterationChanged;
    changed = iterationChanged || changed;
    if (!iterationChanged) break;
  }
  return changed;
}

export function applyAllAutoLayouts(nodes) {
  if (!Array.isArray(nodes)) return false;
  return applyAutoLayouts(
    nodes,
    nodes.filter((node) => isAutoLayoutContainer(node)).map((node) => node.id),
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
