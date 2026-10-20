import { textLineHeightRatio, validTextLineHeight } from "./text-line-height.mjs";
/* Bounded native/CSS grid semantics shared by the document and Figma plugin. */
export const GRID_CONTAINER_FIELDS = Object.freeze([
  "gridRows",
  "gridColumnSizes",
  "gridRowSizes",
  "gridItemsPositioning",
  "gridAutoTracks",
]);
export const GRID_CHILD_FIELDS = Object.freeze([
  "gridRowAnchorIndex",
  "gridColumnAnchorIndex",
  "gridChildHorizontalAlign",
  "gridChildVerticalAlign",
]);
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
export function normalizeGridTracks(value) {
  if (!Array.isArray(value) || !value.length || value.length > 24)
    throw new Error("Grid tracks 必须为 1–24 项");
  return value.map((track) => {
    if (
      !track ||
      typeof track !== "object" ||
      Array.isArray(track) ||
      Object.keys(track).some((key) => !["type", "value"].includes(key)) ||
      !["fixed", "flex", "hug"].includes(track.type)
    )
      throw new Error("Grid track 类型无效");
    if (track.type === "hug") {
      if (track.value !== undefined) throw new Error("HUG track 不接受 value");
      return { type: "hug" };
    }
    const size = track.value ?? (track.type === "flex" ? 1 : undefined);
    if (!Number.isFinite(size) || size < 0 || (track.type === "flex" && size === 0) || size > 20000)
      throw new Error("Grid track value 超出范围");
    return { type: track.type, value: size };
  });
}
export function validateGridFields(node, container = false) {
  for (const key of ["gridRows", "gridColumns", "gridColumnSpan", "gridRowSpan"])
    if (node[key] !== undefined && !integer(node[key], 1, 24))
      throw new Error(`${key} 必须为 1–24`);
  for (const key of ["gridRowAnchorIndex", "gridColumnAnchorIndex"])
    if (node[key] !== undefined && !integer(node[key], 0, 9999))
      throw new Error(`${key} 必须为 0–9999`);
  if ((node.gridRowAnchorIndex === undefined) !== (node.gridColumnAnchorIndex === undefined))
    throw new Error("Grid manual anchors 必须同时包含行和列");
  for (const key of ["gridChildHorizontalAlign", "gridChildVerticalAlign"])
    if (node[key] !== undefined && !["auto", "start", "center", "end"].includes(node[key]))
      throw new Error(`${key} 无效`);
  if (!container && GRID_CONTAINER_FIELDS.some((key) => node[key] !== undefined))
    throw new Error("Grid container 字段只适用于容器");
  if (
    node.gridItemsPositioning !== undefined &&
    !["manual", "row-auto-flow"].includes(node.gridItemsPositioning)
  )
    throw new Error("gridItemsPositioning 无效");
  if (node.gridAutoTracks !== undefined && !["none", "rows"].includes(node.gridAutoTracks))
    throw new Error("gridAutoTracks 无效");
  for (const [key, count] of [
    ["gridColumnSizes", node.gridColumns],
    ["gridRowSizes", node.gridRows],
  ])
    if (node[key] !== undefined) {
      const tracks = normalizeGridTracks(node[key]);
      if (count === undefined || tracks.length !== count)
        throw new Error(`${key} 数量与 grid count 不一致`);
    }
  if (
    container &&
    node.layout === "grid" &&
    node.gridItemsPositioning === "manual" &&
    Array.isArray(node.children)
  ) {
    const placed = gridPlacements(node.children, node.gridColumns ?? 1, node);
    if (
      node.gridAutoTracks !== "rows" &&
      node.gridRows !== undefined &&
      placed.rowCount > node.gridRows
    )
      throw new Error("Grid manual anchors/spans 超出 gridRows");
  }
}
export function gridPlacements(children, columnCount, container = {}) {
  if (!integer(columnCount, 1, 24)) throw new Error("Grid columns 必须为 1–24");
  const occupied = new Set(),
    placements = [];
  let cursor = 0;
  const fits = (row, column, rowSpan, columnSpan) => {
    if (column + columnSpan > columnCount) return false;
    for (let y = row; y < row + rowSpan; y++)
      for (let x = column; x < column + columnSpan; x++)
        if (occupied.has(y * columnCount + x)) return false;
    return true;
  };
  for (const child of children) {
    // Containers can be validated before their descendants. Bound every loop
    // operand here before inspecting occupancy, even for untrusted documents.
    if (!child || typeof child !== "object") throw new Error("Grid 子项无效");
    for (const key of ["gridColumnSpan", "gridRowSpan"])
      if (child[key] !== undefined && !integer(child[key], 1, 24))
        throw new Error(`${key} 必须为 1–24`);
    for (const key of ["gridRowAnchorIndex", "gridColumnAnchorIndex"])
      if (child[key] !== undefined && !integer(child[key], 0, 9999))
        throw new Error(`${key} 必须为 0–9999`);
    // Hidden native Grid children remain editable layers but have no occupied
    // cell (Figma reports -1 anchors). Validate them above before excluding them.
    if (child.visible === false || child.layoutPositioning === "absolute") continue;
    const columnSpan = Math.min(columnCount, Math.max(1, child.gridColumnSpan ?? 1));
    const rowSpan = Math.max(1, child.gridRowSpan ?? 1);
    const manual =
      container.gridItemsPositioning === "manual" &&
      Number.isInteger(child.gridRowAnchorIndex) &&
      Number.isInteger(child.gridColumnAnchorIndex);
    let cell = container.gridItemsPositioning === "row-auto-flow" ? cursor : 0;
    let row = manual ? child.gridRowAnchorIndex : Math.floor(cell / columnCount);
    let column = manual ? child.gridColumnAnchorIndex : cell % columnCount;
    if (manual && !fits(row, column, rowSpan, columnSpan))
      throw new Error(`${child.name ?? child.id}: Grid placement 重叠或超出列范围`);
    while (!manual && !fits(row, column, rowSpan, columnSpan)) {
      cell++;
      row = Math.floor(cell / columnCount);
      column = cell % columnCount;
    }
    for (let y = row; y < row + rowSpan; y++)
      for (let x = column; x < column + columnSpan; x++) occupied.add(y * columnCount + x);
    cursor = row * columnCount + column + columnSpan;
    placements.push({ child, row, column, rowSpan, columnSpan });
  }
  return {
    placements,
    rowCount: Math.max(0, ...placements.map((item) => item.row + item.rowSpan)),
  };
}
// Native runs 289e088a (rectangle), a4e5dd91 (plain Text), and fc6bb994 (padded
// cells in externally sized rows) prove this vertical dependency.
// Text height is its logical line box after the bounded responsive-text pass. Never use an old
// stretched cell height as intrinsic content, or shrink edits retain the old row.
export function gridFillHugContentHeight(container, child, children = child?.children, parent) {
  const unconstrained = (node) =>
    ["minWidth", "maxWidth", "minHeight", "maxHeight"].every((key) => node[key] === undefined);
  const noStroke = (node) =>
    !(node.strokeWidth > 0) &&
    (node.strokeSides === undefined ||
      (Array.isArray(node.strokeSides) &&
        node.strokeSides.every((side) => side && side.width === 0))) &&
    !node.strokeLayoutExcluded;
  const verticalPadding = (node) =>
    (node.paddingTop ?? node.padding ?? 0) + (node.paddingBottom ?? node.padding ?? 0);
  const boundedPadding = (node) =>
    ["Top", "Right", "Bottom", "Left"].every((side) => {
      const value = node[`padding${side}`] ?? node.padding ?? 0;
      return Number.isFinite(value) && value >= 0 && value <= 2000;
    });
  // A FILL row has a resolved width only in this proven, non-circular parent
  // context. Persisted geometry alone is not evidence that a HUG owner resolves it.
  const resolvedFillWidth =
    container?.layoutSizingHorizontal === "fill" &&
    parent?.layout === "vertical" &&
    parent.layoutSizingHorizontal === "fixed" &&
    Number.isFinite(parent.width) && parent.width >= 1 && parent.width <= 20000 &&
    unconstrained(parent) &&
    !parent.rotation && !parent.layoutReverse &&
    (!parent.layoutWrap || parent.layoutWrap === "none") &&
    container.layoutPositioning !== "absolute" &&
    !container.layoutMarginBefore && unconstrained(container);
  // Native fc6bb994 / 7937bd33 reserve exactly this INSIDE bottom rule when
  // included. Canonical padding already contains that physical inset once.
  const includedBottomRule =
    container?.strokeAlign === "inside" &&
    !container.strokeLayoutExcluded &&
    Array.isArray(container.strokeSides) && container.strokeSides.length === 4 &&
    Array.from(container.strokeSides).every((side, index) => side && side.width === (index === 2 ? 1 : 0)) &&
    ["Top", "Right", "Left"].every((side) => (container[`padding${side}`] ?? container.padding ?? 0) === 0) &&
    (container.paddingBottom ?? container.padding ?? 0) === 1;
  if (
    !container ||
    !child ||
    container.layout !== "grid" ||
    (container.layoutSizingHorizontal !== "fixed" && !resolvedFillWidth) ||
    container.layoutSizingVertical !== "hug" ||
    container.gridRows !== 1 ||
    container.gridRowSizes?.length !== 1 ||
    container.gridRowSizes[0].type !== "hug" ||
    container.gridColumnSizes?.some((track) => !["fixed", "flex"].includes(track.type)) ||
    container.rotation ||
    container.layoutReverse ||
    (container.layoutWrap && container.layoutWrap !== "none") ||
    (container.justifyContent && container.justifyContent !== "start") ||
    (container.alignContent && container.alignContent !== "start") ||
    (container.alignItems && container.alignItems !== "start") ||
    (verticalPadding(container) !== 0 && !includedBottomRule) ||
    !unconstrained(container) ||
    (!noStroke(container) && !includedBottomRule) ||
    child.type !== "frame" ||
    child.layout !== "vertical" ||
    child.layoutSizingHorizontal !== "fill" ||
    child.layoutSizingVertical !== "fill" ||
    (child.gridRowSpan ?? 1) !== 1 ||
    child.visible === false ||
    child.layoutPositioning === "absolute" ||
    child.rotation ||
    child.layoutReverse ||
    (child.layoutWrap && child.layoutWrap !== "none") ||
    child.layoutMarginBefore ||
    (child.justifyContent && child.justifyContent !== "start") ||
    (child.alignItems && child.alignItems !== "start") ||
    (child.gap ?? 0) !== 0 ||
    (child.rowGap ?? 0) !== 0 ||
    !boundedPadding(child) ||
    !unconstrained(child) ||
    !noStroke(child)
  )
    return null;
  // Flat layouts resolve descendants only after the bounded parent/cell check.
  // Ordinary rectangles and unrelated layouts do not add a full document scan.
  const resolvedChildren = typeof children === "function" ? children() : children;
  if (!Array.isArray(resolvedChildren) || resolvedChildren.length !== 1) return null;
  const content = resolvedChildren[0];
  const fixedRectangle =
    content?.type === "rectangle" &&
    content.layoutSizingVertical === "fixed" &&
    ["fixed", "fill"].includes(content.layoutSizingHorizontal);
  const plainText =
    content?.type === "text" &&
    content.layoutSizingVertical === "hug" &&
    content.layoutSizingHorizontal === "fill" &&
    content.textFlow === "wrap" &&
    content.textOverflow === undefined &&
    typeof content.textSource === "string" &&
    content.textSource.length <= 4000 &&
    /[^\t\n\f\r ]/u.test(content.textSource) &&
    Number.isFinite(content.fontSize) &&
    content.fontSize >= 6 &&
    content.fontSize <= 240 &&
    validTextLineHeight(content) &&
    textLineHeightRatio(content) >= 0.7 &&
    textLineHeightRatio(content) <= 3 &&
    (content.letterSpacing ?? 0) === 0 &&
    (content.textAlign ?? "left") === "left" &&
    (content.textDecoration ?? "none") === "none";
  if (
    !content ||
    (!fixedRectangle && !plainText) ||
    (fixedRectangle && verticalPadding(child) !== 0) ||
    content.children !== undefined ||
    content.visible === false ||
    content.layoutPositioning === "absolute" ||
    content.rotation ||
    content.layoutMarginBefore ||
    !Number.isFinite(content.height) ||
    content.height < 1 ||
    content.height > 20000 ||
    !unconstrained(content) ||
    !noStroke(content)
  )
    return null;
  const height = content.height + verticalPadding(child);
  return height <= 20000 ? height : null;
}
export function gridTrackSizes(tracks, count, placements, axis, gap, available, intrinsicSize) {
  const definitions = Array.from(
    { length: count },
    (_, i) => tracks?.[i] ?? { type: axis === "horizontal" ? "flex" : "hug", value: 1 },
  );
  const sizes = definitions.map((track) => (track.type === "fixed" ? track.value : 0));
  const start = axis === "horizontal" ? "column" : "row",
    span = `${start}Span`;
  const dimension = axis === "horizontal" ? "width" : "height";
  const bySpan = new Map();
  for (const item of placements) {
    const group = bySpan.get(item[span]) ?? [];
    group.push(item);
    bySpan.set(item[span], group);
  }
  // Equal-span contributions share one baseline and use the largest planned
  // increase per track. Sequential mutation makes track widths depend on layer
  // order when two spanning items overlap.
  for (const [, group] of [...bySpan].sort(([left], [right]) => left - right)) {
    const increases = Array(count).fill(0);
    for (const item of group) {
      const indices = Array.from({ length: item[span] }, (_, i) => item[start] + i);
      // A span crossing FLEX consumes flexible extent; it must not inflate HUG.
      if (
        available !== undefined &&
        item[span] > 1 &&
        indices.some((i) => definitions[i]?.type === "flex")
      )
        continue;
      const intrinsic = indices.filter(
        (i) =>
          definitions[i]?.type === "hug" ||
          (available === undefined && definitions[i]?.type === "flex"),
      );
      const occupied =
        indices.reduce((sum, i) => sum + (sizes[i] ?? 0), 0) + gap * (item[span] - 1);
      const contribution = intrinsicSize?.(item.child) ?? item.child[dimension];
      const needed = Math.max(0, contribution - occupied);
      for (const i of intrinsic) increases[i] = Math.max(increases[i], needed / intrinsic.length);
    }
    for (let i = 0; i < count; i++) sizes[i] += increases[i];
  }
  if (available !== undefined) {
    const weight = definitions.reduce(
      (sum, track) => sum + (track.type === "flex" ? (track.value ?? 1) : 0),
      0,
    );
    const free = Math.max(
      0,
      available - sizes.reduce((a, b) => a + b, 0) - gap * Math.max(0, count - 1),
    );
    definitions.forEach((track, i) => {
      if (track.type === "flex") sizes[i] = (free * (track.value ?? 1)) / Math.max(1, weight);
    });
  }
  return sizes;
}
export function effectiveGridRows(source, rowCount) {
  return source.gridAutoTracks === "rows"
    ? Math.max(1, rowCount)
    : Math.max(1, source.gridRows ?? rowCount, rowCount);
}
export function effectiveGridRowTracks(source, rowCount) {
  return source.gridRowSizes
    ? Array.from({ length: rowCount }, (_, index) => source.gridRowSizes[index] ?? { type: "hug" })
    : undefined;
}
export function nativeGridPlan(source, parent) {
  validateGridFields(source, true);
  const columns = source.gridColumns ?? 1;
  const placed = gridPlacements(source.children ?? [], columns, source);
  const rows = effectiveGridRows(source, placed.rowCount);
  if (rows > 24) throw new Error("原生 Grid 互换最多保留 24 行；请拆分网格");
  if (placed.rowCount > rows) throw new Error("Grid children 超出 gridRows；请增加行数");
  if (source.gridAutoTracks === "rows" && source.gridItemsPositioning === "manual") {
    const occupiedRows = new Set();
    for (const item of placed.placements)
      for (let row = item.row; row < item.row + item.rowSpan; row++) occupiedRows.add(row);
    if (occupiedRows.size && occupiedRows.size !== rows)
      throw new Error("自动 Grid 行中的空白手动行不能保留；请移除空行或关闭自动行");
  }
  const columnSizes =
    source.gridColumnSizes ?? Array.from({ length: columns }, () => ({ type: "flex", value: 1 }));
  const rowSizes =
    effectiveGridRowTracks(source, rows) ?? Array.from({ length: rows }, () => ({ type: "hug" }));
  for (const [axis, tracks] of [
    ["Horizontal", columnSizes],
    ["Vertical", rowSizes],
  ]) {
    for (const item of placed.placements) {
      const child = item.child;
      const stretch =
        child.layoutAlignSelf === "stretch" ||
        ((!child.layoutAlignSelf || child.layoutAlignSelf === "auto") &&
          source.alignItems === "stretch");
      const start = axis === "Horizontal" ? item.column : item.row;
      const span = axis === "Horizontal" ? item.columnSpan : item.rowSpan;
      if (
        (child[`layoutSizing${axis}`] === "fill" || stretch) &&
        tracks.slice(start, start + span).some((track) => track.type === "hug") &&
        !(axis === "Vertical" && gridFillHugContentHeight(source, child, child.children, parent) !== null)
      )
        throw new Error(
          `Grid ${axis}: FILL 子项与 HUG track 的内在尺寸循环尚不能保留；请改为固定 track 或 HUG/固定子项`,
        );
    }
    if (source[`layoutSizing${axis}`] === "hug" && tracks.some((track) => track.type === "flex"))
      throw new Error(
        `Grid ${axis}: HUG 容器不能包含 FLEX track；请改为 FIXED/HUG track 或固定容器尺寸`,
      );
  }
  if (
    source.layoutReverse ||
    (source.layoutWrap && source.layoutWrap !== "none") ||
    source.justifyContent !== "start" ||
    (source.alignContent && source.alignContent !== "start")
  )
    throw new Error("Grid 反向/换行/track 分布不能对应 Figma；请使用 start 分布");
  return { columns, rows, columnSizes, rowSizes, ...placed };
}
export function configureNativeGrid(node, source, parent) {
  const plan = nativeGridPlan(source, parent);
  for (const key of [
    "gridColumnCount",
    "gridRowCount",
    "gridRowSizes",
    "gridColumnSizes",
    "gridAutoTracks",
    "gridItemsPositioning",
  ])
    if (!(key in node))
      throw new Error(
        `${source.name}: 当前 Figma 不支持原生 GRID API (${key})，请更新 Figma 后重试`,
      );
  node.layoutMode = "GRID";
  node.layoutSizingHorizontal = "FIXED";
  node.layoutSizingVertical = "FIXED";
  node.gridAutoTracks = "NONE";
  node.gridItemsPositioning = "MANUAL";
  node.gridColumnCount = plan.columns;
  node.gridRowCount = plan.rows;
  node.gridColumnGap = source.columnGap ?? source.gap;
  node.gridRowGap = source.rowGap ?? source.gap;
  for (const side of ["Top", "Right", "Bottom", "Left"])
    node[`padding${side}`] = source[`padding${side}`] ?? source.padding;
  for (const [key, tracks] of [
    ["gridColumnSizes", plan.columnSizes],
    ["gridRowSizes", plan.rowSizes],
  ]) {
    const native = node[key];
    if (native.length !== tracks.length)
      throw new Error(`${source.name}: Figma Grid track 数量不匹配`);
    tracks.forEach((track, i) => {
      native[i].type = track.type.toUpperCase();
      if (track.type !== "hug") native[i].value = track.value ?? 1;
    });
  }
  return plan;
}
export function positionNativeGridChild(node, source, parentSource, plan) {
  node.layoutPositioning = source.layoutPositioning === "absolute" ? "ABSOLUTE" : "AUTO";
  if (source.layoutPositioning === "absolute") return;
  const hidden = source.visible === false;
  const item = hidden
    ? {
        row: plan.rows,
        column: 0,
        rowSpan: source.gridRowSpan ?? 1,
        columnSpan: Math.min(plan.columns, source.gridColumnSpan ?? 1),
      }
    : plan.placements.find((entry) => entry.child === source);
  if (typeof node.setGridChildPosition !== "function")
    throw new Error("当前 Figma 不支持 Grid 子项位置；请更新后重试");
  // Assign spans only while a child has a real cell. One bounded temporary row
  // block is reused by every hidden child; hiding releases it before the next
  // child is created. finishNativeGrid removes the now-empty temporary rows.
  if (hidden) {
    node.parent.gridRowCount = Math.max(node.parent.gridRowCount, item.row + item.rowSpan);
    node.visible = true;
  }
  node.setGridChildPosition(item.row, item.column);
  node.gridColumnSpan = item.columnSpan;
  node.gridRowSpan = item.rowSpan;
  if (hidden) node.visible = false;
  for (const axis of ["Horizontal", "Vertical"]) {
    const key = `gridChild${axis}Align`;
    const self =
      source[key] ??
      (source.layoutAlignSelf && source.layoutAlignSelf !== "auto"
        ? source.layoutAlignSelf
        : parentSource.alignItems);
    node[key] =
      { start: "MIN", center: "CENTER", end: "MAX", stretch: "MIN", auto: "AUTO" }[self] ?? "MIN";
  }
}
export function finishNativeGrid(node, source, parent) {
  // Appending an eventual absolute overlay can temporarily add a grid row.
  // Once every child has its final positioning, remove those empty temporary rows.
  node.gridRowCount = nativeGridPlan(source, parent).rows;
  node.gridItemsPositioning =
    source.gridItemsPositioning === "row-auto-flow" ? "ROW_AUTO_FLOW" : "MANUAL";
  node.gridAutoTracks = source.gridAutoTracks === "rows" ? "ROWS" : "NONE";
}
export function cssGridTrack(track) {
  return track.type === "fixed"
    ? `${track.value}px`
    : track.type === "hug"
      ? "fit-content(100%)"
      : `minmax(0, ${track.value ?? 1}fr)`;
}
