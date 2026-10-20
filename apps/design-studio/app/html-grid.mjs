/* CSS Grid intent retained by the maintained browser capture boundary. */
import {
  gridPlacements,
  nativeGridPlan,
  GRID_CONTAINER_FIELDS,
  GRID_CHILD_FIELDS,
} from "./grid.mjs";

export const htmlCssValue = (source, property) =>
  String(source.cssLayout?.[property] ?? source.rawStyles?.[property] ?? "")
    .trim()
    .toLowerCase();

function split(value, delimiter = " ") {
  const result = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i <= value.length; i++) {
    if (value[i] === "(") depth++;
    if (value[i] === ")") depth--;
    if (depth < 0) throw new Error("Grid track 括号无效");
    if (
      i === value.length ||
      (depth === 0 && (delimiter === " " ? /\s/u.test(value[i]) : value[i] === delimiter))
    ) {
      const part = value.slice(start, i).trim();
      if (part) result.push(part);
      start = i + 1;
    }
  }
  if (depth) throw new Error("Grid track 括号无效");
  return result;
}

export function cssGridTracks(value, depth = 0) {
  if (typeof value !== "string" || value.length > 4096 || depth > 8)
    throw new Error("Grid track 定义超过长度或嵌套上限");
  if (!value || value === "none") return [];
  const tracks = [];
  for (const token of split(value)) {
    let match;
    if ((match = token.match(/^repeat\((.*)\)$/u))) {
      const args = split(match[1], ",");
      const count = Number(args[0]);
      if (args.length !== 2 || !Number.isInteger(count) || count < 1 || count > 24)
        throw new Error("Grid repeat 只支持 1–24 的固定次数；auto-fit/auto-fill 需要响应式断点");
      const repeated = cssGridTracks(args[1], depth + 1);
      if (!repeated.length || tracks.length + repeated.length * count > 24)
        throw new Error("Grid 每个轴最多支持 24 条 track");
      for (let i = 0; i < count; i++) tracks.push(...repeated.map((track) => ({ ...track })));
    } else if ((match = token.match(/^(\d+(?:\.\d+)?)(px|fr)$/u)) || token === "0") {
      const value = token === "0" ? 0 : Number(match[1]);
      const flex = match?.[2] === "fr";
      if (value > 20000 || (flex && value === 0)) throw new Error("Grid track 数值超出范围");
      tracks.push({ type: flex ? "flex" : "fixed", value, ...(flex ? { autoMinimum: true } : {}) });
    } else if ((match = token.match(/^minmax\(\s*0(?:px)?\s*,\s*(\d+(?:\.\d+)?)fr\s*\)$/u))) {
      const value = Number(match[1]);
      if (value <= 0 || value > 20000) throw new Error("Grid FLEX 数值超出范围");
      tracks.push({ type: "flex", value });
    } else if (token === "max-content" || token === "auto")
      tracks.push({ type: "hug", ...(token === "auto" ? { stretchAuto: true } : {}) });
    else throw new Error(`Grid track ${token} 暂不支持；请使用 px、minmax(0, Nfr) 或 max-content`);
    if (tracks.length > 24) throw new Error("Grid 每个轴最多支持 24 条 track");
  }
  return tracks;
}

function placement(startValue = "auto", endValue = "auto") {
  let start,
    span = 1;
  const positive = (value) => /^\d+$/u.test(value) && Number(value) > 0 && Number(value) <= 25;
  const spanValue = (value) =>
    /^span\s+[1-9]\d*$/u.test(value) ? Number(value.slice(5)) : undefined;
  if (positive(startValue)) start = Number(startValue) - 1;
  else if (spanValue(startValue)) span = spanValue(startValue);
  else if (startValue !== "auto") throw new Error("Grid 起始线只支持正整数、auto 或 span N");
  if (positive(endValue)) {
    if (start !== undefined) span = Number(endValue) - 1 - start;
    else if (spanValue(startValue)) start = Number(endValue) - 1 - span;
    else throw new Error("Grid 结束线需要显式起始线或 span N");
  } else if (spanValue(endValue)) span = spanValue(endValue);
  else if (endValue !== "auto") throw new Error("Grid 结束线只支持正整数、auto 或 span N");
  if (!Number.isInteger(span) || span < 1 || span > 24 || (start !== undefined && start < 0))
    throw new Error("Grid span/anchor 超出支持范围");
  return { start, span };
}

const canonicalTracks = (tracks) =>
  tracks.map(({ type, value }) => ({ type, ...(value !== undefined ? { value } : {}) }));
const flow = (child) =>
  child.visible !== false &&
  child.layout?.display !== "none" &&
  !["absolute", "fixed"].includes(child.positioning?.mode);
const zeroIntrinsic = (node) =>
  node.nodeType === "container" &&
  !(node.children ?? []).length &&
  ["top", "right", "bottom", "left"].every(
    (side) => !(node.layout?.padding?.[side] ?? 0) && !(node.border?.[side]?.width ?? 0),
  );

export function planHtmlGrid(source) {
  const grid = source.layout.grid;
  const css = (property, fallback = "") => htmlCssValue(source, property) || fallback;
  for (const axis of ["width", "height"])
    if (["min-content", "fit-content"].includes(css(axis)))
      throw new Error(
        `Grid 容器 ${axis}:${css(axis)} 的内容约束暂不能原生保留；请使用固定尺寸或 max-content`,
      );
  if (css("--codeshell-grid-intent") === "unavailable")
    throw new Error(
      "浏览器未提供 Grid Typed OM 原始 track 值；请使用支持 computedStyleMap 的 Chromium 重新捕获",
    );
  for (const [property, axis] of [
    ["row-gap", "row"],
    ["column-gap", "column"],
  ])
    if (
      (css(property) && !/^(?:normal|\d+(?:\.\d+)?px|0)$/u.test(css(property))) ||
      (grid.gap?.[axis] ?? 0) > 2000
    )
      throw new Error(`Grid ${property} 只支持不超过 2000px 的绝对间距；请将百分比间距改为 px`);
  if (!/^row$/u.test(css("grid-auto-flow", grid.autoFlow || "row")))
    throw new Error("Grid 只支持 row 自动流；请移除 dense/column");
  if (!["", "none"].includes(css("grid-template-areas")))
    throw new Error("Grid 命名区域暂不支持；请使用正整数行列线");
  if (
    !["", "ltr"].includes(css("direction")) ||
    !["", "horizontal-tb"].includes(css("writing-mode"))
  )
    throw new Error("Grid 只支持从左到右的横向书写模式");
  for (const property of ["justify-content", "align-content"])
    if (!["", "normal", "start", "left", "stretch"].includes(css(property)))
      throw new Error("Grid track 分布只支持 start；请移除居中、两端分布或反向对齐");
  const columns = cssGridTracks(css("grid-template-columns", grid.templateColumns));
  if (!columns.length) throw new Error("Grid 需要显式列定义");
  const rows = cssGridTracks(css("grid-template-rows", grid.templateRows));
  const declaredRows = rows.length;
  const items = new Map();
  for (const child of (source.children ?? []).filter(flow)) {
    if (child.nodeType === "text")
      throw new Error("Grid 匿名文本的行框暂不能保留；请用元素包装该文本");
    if (child.transform?.matrix)
      throw new Error(
        "Grid 流子项的 CSS transform 暂不能与原生 cell 定位同时保留；请移除变换或使用独立包装框",
      );
    if (
      child.positioning?.mode === "relative" &&
      ["top", "right", "bottom", "left"].some(
        (side) => !["", "auto", "0px", "0"].includes(htmlCssValue(child, side)),
      )
    )
      throw new Error("Grid 相对定位偏移暂不能与原生 cell 定位同时保留；请移除偏移或使用包装框");
    const col = placement(
      htmlCssValue(child, "grid-column-start") || "auto",
      htmlCssValue(child, "grid-column-end") || "auto",
    );
    const row = placement(
      htmlCssValue(child, "grid-row-start") || "auto",
      htmlCssValue(child, "grid-row-end") || "auto",
    );
    if ((col.start === undefined) !== (row.start === undefined))
      throw new Error("Grid 部分显式放置暂不支持；请同时指定行列起始线，或都使用 auto");
    if (col.span > columns.length) throw new Error("Grid span 超出显式列数；请补充列定义");
    if (!["", "auto", "0"].includes(htmlCssValue(child, "z-index")))
      throw new Error("Grid 流子项 z-index 与自动放置的独立顺序暂不能保留");
    items.set(child, {
      gridColumnSpan: col.span,
      gridRowSpan: row.span,
      ...(col.start !== undefined
        ? { gridColumnAnchorIndex: col.start, gridRowAnchorIndex: row.start }
        : {}),
    });
  }
  const manualCount = [...items.values()].filter(
    (item) => item.gridRowAnchorIndex !== undefined,
  ).length;
  if (manualCount && manualCount !== items.size)
    throw new Error("Grid 混合显式与自动放置暂不支持；请统一使用 auto 或显式行列线");
  const fields = {
    layout: "grid",
    gridColumns: columns.length,
    gridItemsPositioning: manualCount ? "manual" : "row-auto-flow",
    gridAutoTracks: "none",
  };
  const placed = gridPlacements([...items.values()], columns.length, fields);
  const measuredRows = split(String(grid.templateRows ?? "")).filter((token) =>
    /^\d+(?:\.\d+)?px$/u.test(token),
  ).length;
  const rowCount = Math.max(1, rows.length, placed.rowCount, measuredRows);
  if (rowCount > 24) throw new Error("Grid 最多支持 24 行；请拆分网格");
  const implicitRows = rows.length < rowCount;
  if (implicitRows) {
    const automatic = cssGridTracks(css("grid-auto-rows", "auto"));
    if (automatic.length !== 1) throw new Error("Grid 隐式行只支持一种 track 尺寸");
    while (rows.length < rowCount) rows.push({ ...automatic[0] });
    if (!declaredRows && automatic[0].type === "hug") fields.gridAutoTracks = "rows";
  }
  for (const [axis, tracks, distribution] of [
    ["width", columns, "justify-content"],
    ["height", rows, "align-content"],
  ]) {
    if (
      tracks.some((track) => track.stretchAuto) &&
      !["start", "left"].includes(css(distribution)) &&
      !["auto", "max-content", "min-content", "fit-content"].includes(css(axis))
    )
      throw new Error(
        `Grid auto ${axis} track 在固定容器内会拉伸；请改用 max-content、固定 track 或 start 分布`,
      );
    if (tracks.some((track) => track.autoMinimum))
      for (const child of items.keys()) {
        const min = htmlCssValue(child, `min-${axis}`);
        if (
          !/^0(?:\.0+)?(?:px)?$/u.test(min) &&
          !(zeroIntrinsic(child) && htmlCssValue(child, axis) === "auto")
        )
          throw new Error(
            `Grid 裸 fr 的自动最小 ${axis} 暂不能保留；请使用 minmax(0, Nfr) 或为子项设置 min-${axis}:0`,
          );
      }
  }
  return {
    fields: {
      ...fields,
      gridRows: rowCount,
      gridColumnSizes: canonicalTracks(columns),
      gridRowSizes: canonicalTracks(rows),
    },
    items,
    cells: new Map(
      [...items].map(([source, item]) => [
        source,
        placed.placements.find((cell) => cell.child === item),
      ]),
    ),
    horizontalAlign: css("justify-items", grid.justifyItems || "normal"),
    verticalAlign: css("align-items", grid.alignItems || "normal"),
    warnings:
      implicitRows && fields.gridAutoTracks !== "rows"
        ? [
            "Grid 隐式行保留测量时的数量；新增行后请同步更新 gridRows/gridRowSizes，或使用 auto 隐式行且不声明显式行。",
          ]
        : [],
  };
}

export function sizeHtmlGridChild(source, node, parent, plan) {
  const placement = plan.items.get(source);
  if (!placement) return;
  Object.assign(node, placement);
  for (const [axis, dimension, self, inherited, tracks] of [
    ["Horizontal", "width", "justify-self", plan.horizontalAlign, parent.gridColumnSizes],
    ["Vertical", "height", "align-self", plan.verticalAlign, parent.gridRowSizes],
  ]) {
    let align = htmlCssValue(source, self) || "auto";
    if (align === "auto") align = inherited;
    if (["normal", "auto"].includes(align))
      align = ["image", "svg"].includes(source.nodeType) ? "start" : "stretch";
    align =
      { "self-start": "start", "self-end": "end", left: "start", right: "end" }[align] ?? align;
    if (!["start", "center", "end", "stretch"].includes(align))
      throw new Error(`Grid ${self}:${align} 暂不支持`);
    const value = htmlCssValue(source, dimension);
    if (value.includes("%") && !/^100(?:\.0+)?%$/u.test(value))
      throw new Error(`Grid ${dimension} 只支持 auto、px 或 100%`);
    if (["min-content", "fit-content"].includes(value))
      throw new Error(
        `Grid ${dimension}:${value} 的内容约束暂不能原生保留；请使用固定尺寸或 max-content`,
      );
    if (!["", "auto"].includes(htmlCssValue(source, "aspect-ratio")))
      throw new Error("Grid aspect-ratio 自动尺寸暂不能原生保留");
    if (
      /^100(?:\.0+)?%$/u.test(value) &&
      (htmlCssValue(source, "box-sizing") || source.layout?.sizing?.boxSizing || "content-box") ===
        "content-box" &&
      (dimension === "width" ? ["left", "right"] : ["top", "bottom"]).some(
        (side) => (source.layout?.padding?.[side] ?? 0) + (source.border?.[side]?.width ?? 0) > 0,
      )
    )
      throw new Error(`Grid content-box ${dimension}:100% 加上边距会溢出 cell；请改用 border-box`);
    const cell = plan.cells.get(source);
    const start = axis === "Horizontal" ? cell.column : cell.row;
    const span = axis === "Horizontal" ? cell.columnSpan : cell.rowSpan;
    const hugTrack = tracks.slice(start, start + span).some((track) => track.type === "hug");
    if (value === "auto" && align === "stretch" && hugTrack)
      throw new Error(
        `Grid 自动拉伸 ${dimension} 子项与 HUG track 的内在尺寸循环暂不能保留；请使用固定尺寸或非拉伸对齐`,
      );
    if (
      dimension === "width" &&
      value === "auto" &&
      align !== "stretch" &&
      source.nodeType === "container"
    )
      throw new Error(
        "Grid 非拉伸 auto 宽度的 shrink-to-fit 约束暂不能保留；请使用固定尺寸或 max-content",
      );
    if (value === "max-content" && node.type === "frame" && node.layout === "none")
      throw new Error(
        "Grid max-content 子项需要可编辑 Auto Layout；请先将子项转换为 Flex/Grid 布局",
      );
    let mode = "fixed";
    if (value === "auto" && align === "stretch" && !hugTrack) mode = "fill";
    else if (/^100(?:\.0+)?%$/u.test(value)) mode = "fill";
    else if (
      ["auto", "max-content"].includes(value) &&
      ["horizontal", "vertical", "grid"].includes(node.layout)
    )
      mode = "hug";
    node[`layoutSizing${axis}`] = mode;
    node[`gridChild${axis}Align`] = align === "stretch" ? "start" : align;
  }
  if (
    ["image", "svg"].includes(source.nodeType) &&
    ["Horizontal", "Vertical"].some(
      (axis, index) =>
        node[`layoutSizing${axis}`] === "fill" &&
        htmlCssValue(source, index ? "width" : "height") === "auto",
    )
  )
    throw new Error("Grid 图片的自动宽高比随 FILL 变化暂不能原生保留；请指定两个轴的尺寸");
  delete node.layoutAlignSelf;
}

export function validateHtmlGrid(node) {
  nativeGridPlan(node);
}
export function removeHtmlGrid(node) {
  node.layout = "none";
  for (const key of ["gridColumns", ...GRID_CONTAINER_FIELDS]) delete node[key];
  for (const child of node.children ?? []) {
    for (const key of ["gridColumnSpan", "gridRowSpan", ...GRID_CHILD_FIELDS]) delete child[key];
    for (const axis of ["Horizontal", "Vertical"])
      if (child[`layoutSizing${axis}`] === "fill") child[`layoutSizing${axis}`] = "fixed";
  }
}
