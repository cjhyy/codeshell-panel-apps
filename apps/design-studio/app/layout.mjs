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

function axisSizing(node, axis, parent = null) {
  const explicit = node?.[axis === "horizontal" ? "layoutSizingHorizontal" : "layoutSizingVertical"];
  if (["fixed", "hug", "fill"].includes(explicit)) return explicit;
  if (!parent || !isAutoLayoutContainer(parent)) return "fixed";
  const horizontalParent = parent.layout === "horizontal";
  const mainAxis = horizontalParent ? "horizontal" : "vertical";
  if (node.layoutGrow === 1 && axis === mainAxis) return "fill";
  const crossAxis = horizontalParent ? "vertical" : "horizontal";
  if (
    axis === crossAxis &&
    (node.layoutAlign === "stretch" ||
      (["auto", undefined].includes(node.layoutAlign) && parent.alignItems === "stretch"))
  ) {
    return "fill";
  }
  return "fixed";
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
  for (const child of children) {
    const size = Math.max(1, finite(child[mainSize], 1));
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
  const wrap = container.layoutWrap === "wrap";
  const lines = packFlexLines(children, mainSize, innerMain, mainGap, wrap);
  const lineMainSizes = lines.map(
    (line) =>
      line.reduce((total, child) => total + Math.max(1, finite(child[mainSize], 1)), 0) +
      mainGap * Math.max(0, line.length - 1),
  );
  const lineCrossSizes = lines.map((line) =>
    line.reduce(
      (largest, child) => Math.max(largest, Math.max(1, finite(child[crossSize], 1))),
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
      (Math.max(1, finite(placement.child.height, 1)) -
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
        (Math.max(1, finite(placement.child.width, 1)) -
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
    changed = assignNumber(container, "width", Math.max(1, content.width)) || changed;
  }
  if (axisSizing(container, "vertical") === "hug") {
    changed = assignNumber(container, "height", Math.max(1, content.height)) || changed;
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
  return child.layoutAlign && child.layoutAlign !== "auto"
    ? child.layoutAlign
    : (container.alignItems ?? "start");
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
  const wrap = container.layoutWrap === "wrap";
  const lines = packFlexLines(children, mainSize, innerMain, mainGap, wrap);
  let changed = false;

  for (const line of lines) {
    const fills = line.filter((child) => axisSizing(child, mainAxis, container) === "fill");
    if (fills.length === 0) continue;
    const fixed = line
      .filter((child) => axisSizing(child, mainAxis, container) !== "fill")
      .reduce((total, child) => total + Math.max(1, finite(child[mainSize], 1)), 0);
    const available =
      innerMain - fixed - mainGap * Math.max(0, line.length - 1);
    const fillSize = Math.max(1, available / fills.length);
    for (const child of fills) {
      changed = assignNumber(child, mainSize, fillSize) || changed;
    }
  }

  let lineCrossSizes = lines.map((line) =>
    line.reduce(
      (largest, child) => Math.max(largest, Math.max(1, finite(child[crossSize], 1))),
      0,
    ),
  );
  if (!wrap && lineCrossSizes.length === 1) lineCrossSizes = [innerCross];
  const crossTrack = distributedTrack(
    lineCrossSizes,
    innerCross,
    crossGap,
    container.alignContent ?? "start",
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
    const mainValues = line.map((child) => Math.max(1, finite(child[mainSize], 1)));
    const mainTrack = distributedTrack(
      mainValues,
      innerMain,
      mainGap,
      container.justifyContent ?? "start",
    );
    let mainCursor = finite(container[mainPosition]) + mainPadding.start + mainTrack.offset;
    for (const child of line) {
      const sizing = axisSizing(child, crossAxis, container);
      const alignment = childAlignment(child, container);
      if (sizing === "fill" || alignment === "stretch") {
        changed = assignNumber(child, crossSize, Math.max(1, lineCrossSize)) || changed;
      }
      const childCrossSize = Math.max(1, finite(child[crossSize], 1));
      let crossOffset = 0;
      if (alignment === "center") crossOffset = (lineCrossSize - childCrossSize) / 2;
      else if (alignment === "end") crossOffset = lineCrossSize - childCrossSize;
      changed = setNodeTreePosition(nodes, child.id, mainPosition, round(mainCursor)) || changed;
      changed =
        setNodeTreePosition(
          nodes,
          child.id,
          crossPosition,
          round(lineCrossCursor + crossOffset),
        ) || changed;
      mainCursor += Math.max(1, finite(child[mainSize], 1)) + mainTrack.gap;
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
      axisSizing(placement.child, "horizontal", container) === "fill" ||
      alignment === "stretch"
    ) {
      changed = assignNumber(placement.child, "width", Math.max(1, cellWidth)) || changed;
    }
    if (
      axisSizing(placement.child, "vertical", container) === "fill" ||
      alignment === "stretch"
    ) {
      changed = assignNumber(placement.child, "height", Math.max(1, cellHeight)) || changed;
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
      setNodeTreePosition(nodes, placement.child.id, "x", round(cellX + horizontalOffset)) ||
      changed;
    changed =
      setNodeTreePosition(nodes, placement.child.id, "y", round(cellY + verticalOffset)) || changed;
  }
  return changed;
}

export function applyAutoLayout(nodes, containerId) {
  if (!Array.isArray(nodes) || typeof containerId !== "string") return false;
  const container = nodes.find((node) => node.id === containerId);
  if (!isAutoLayoutContainer(container)) return false;
  const children = layoutChildren(nodes, container);
  let changed = applyHugSize(nodes, container);
  if (children.length === 0) return changed;
  changed =
    (container.layout === "grid"
      ? applyGridLayout(nodes, container, children)
      : applyFlexLayout(nodes, container, children)) || changed;
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
  let changed = false;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    let iterationChanged = false;
    for (const node of [...containers].reverse()) {
      iterationChanged = applyHugSize(nodes, node) || iterationChanged;
    }
    for (const node of containers) {
      const children = layoutChildren(nodes, node);
      if (children.length === 0) continue;
      iterationChanged =
        (node.layout === "grid"
          ? applyGridLayout(nodes, node, children)
          : applyFlexLayout(nodes, node, children)) || iterationChanged;
    }
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
