/* Isolated percentage float columns, projected onto the existing native Grid model. */
import { nativeGridPlan, GRID_CHILD_FIELDS } from "./grid.mjs";
import { removeHtmlGrid } from "./html-grid.mjs";

const css = (node, key) =>
  String(node.cssLayout?.[key] ?? node.rawStyles?.[key] ?? "")
    .trim()
    .toLowerCase();
const float = (node) => css(node, "float") || node.layout?.float || "none";
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const near = (a, b) => finite(a) && finite(b) && Math.abs(a - b) <= 0.05;
const inset = (node, side) =>
  (node.layout?.padding?.[side] ?? 0) + (node.border?.[side]?.width ?? 0);
const axes = ["top", "right", "bottom", "left"];
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const box = (node) =>
  ["x", "y", "width", "height"].every((k) => finite(node.bounds?.[k])) &&
  node.bounds.width > 0 &&
  node.bounds.height > 0 &&
  node.bounds.width <= 20000 &&
  node.bounds.height <= 20000 &&
  Math.abs(node.bounds.x) <= 20000 &&
  Math.abs(node.bounds.y) <= 20000;

// Name alone is never enough: this generated box must have no possible ink or
// descendants. Its clearance is represented by the containing row's HUG height.
export function isHtmlEmptyClear(node) {
  return (
    node.nodeType === "container" &&
    node.tag === "::after" &&
    !node.semantic &&
    node.bounds?.height === 0 &&
    finite(node.bounds?.width) &&
    node.bounds.width >= 0 &&
    node.bounds.width <= 20000 &&
    finite(node.bounds.x) &&
    finite(node.bounds.y) &&
    Math.abs(node.bounds.x) <= 20000 &&
    Math.abs(node.bounds.y) <= 20000 &&
    finite(node.opacity ?? 1) &&
    (node.opacity ?? 1) >= 0 &&
    (node.opacity ?? 1) <= 1 &&
    ["block", "table"].includes(node.layout?.display) &&
    float(node) === "none" &&
    css(node, "clear") === "both" &&
    ['""', "''"].includes(css(node, "content")) &&
    !node.children?.length &&
    !node.transform &&
    ["outline-style", "box-shadow", "filter", "backdrop-filter", "background-image"].every(
      (property) => css(node, property) === "none",
    ) &&
    !(node.background?.layers ?? []).length &&
    axes.every(
      (side) =>
        (node.border?.[side]?.width ?? 0) === 0 &&
        (node.layout?.padding?.[side] ?? 0) === 0 &&
        (node.layout?.margin?.[side] ?? 0) === 0,
    ) &&
    Object.entries(node.effects ?? {}).every(
      ([k, v]) =>
        v === undefined ||
        (k === "blendMode" ? v === "normal" : k === "boxShadows" && Array.isArray(v) && !v.length),
    )
  );
}

export function rationalFloatWidth(value) {
  if (typeof value !== "string" || value.length > 64 || !/^\d+(?:\.\d+)?%$/u.test(value))
    throw new Error("浮动列只支持捕获的正百分比宽度");
  const ratio = Number(value.slice(0, -1)) / 100;
  if (!finite(ratio) || ratio <= 0 || ratio > 1) throw new Error("浮动列百分比必须在 0–100% 之间");
  for (let denominator = 1; denominator <= 24; denominator++) {
    const numerator = Math.round(ratio * denominator);
    if (
      numerator > 0 &&
      numerator <= denominator &&
      Math.abs(ratio - numerator / denominator) <= 0.0000005
    )
      return { numerator, denominator };
  }
  throw new Error("浮动列百分比不能表示为最多 24 条原生 Grid track");
}

export function planHtmlFloatColumns(source, coordinateSpace = "parent-relative") {
  if (
    source.nodeType !== "container" ||
    !["block", "flow-root"].includes(source.layout?.display) ||
    !(source.children ?? []).some((child) => !isHtmlEmptyClear(child) && float(child) !== "none")
  )
    return null;
  const reject = (message) => ({ unsupported: message });
  try {
    if (
      !source.cssLayout ||
      !box(source) ||
      source.children.length > 25 ||
      source.transform ||
      float(source) !== "none" ||
      !["static", "relative"].includes(css(source, "position")) ||
      !axes.every((side) => ["auto", "", "0px", "0"].includes(css(source, side))) ||
      css(source, "direction") !== "ltr" ||
      css(source, "writing-mode") !== "horizontal-tb" ||
      !["auto", "1"].includes(css(source, "column-count"))
    )
      throw new Error("浮动行需要可靠的普通 LTR 水平块流与有限几何；变换、偏移或多栏暂不能保留");
    const entries = source.children.flatMap((child, index) =>
      isHtmlEmptyClear(child) ? [] : [{ source: child, index }],
    );
    if (!entries.length || entries.length > 24) throw new Error("浮动行只支持 1–24 个真实列");
    const padding = Object.fromEntries(axes.map((side) => [side, inset(source, side)]));
    if (Object.values(padding).some((v) => !finite(v) || v < 0 || v > 2000))
      throw new Error("浮动行 padding 超出原生布局范围");
    const available = source.bounds.width - padding.left - padding.right;
    if (available <= 0) throw new Error("浮动行没有正内容宽度");
    const direction = float(entries[0].source);
    if (!["left", "right"].includes(direction))
      throw new Error("浮动行只能包含同方向的列，不能混合普通文字/块或绝对覆盖层");
    let columns = 1;
    const items = entries.map(({ source: child, index }) => {
      if (
        child.nodeType !== "container" ||
        !child.cssLayout ||
        !box(child) ||
        child.visible === false ||
        float(child) !== direction ||
        ["absolute", "fixed"].includes(child.positioning?.mode) ||
        child.transform ||
        !["block", "flow-root", "flex", "grid"].includes(child.layout?.display) ||
        !["static", "relative"].includes(css(child, "position")) ||
        !axes.every((side) => ["auto", "", "0px", "0"].includes(css(child, side))) ||
        !axes.every((side) => /^0(?:\.0+)?(?:px)?$/u.test(css(child, `margin-${side}`))) ||
        css(child, "clear") !== "none" ||
        css(child, "shape-outside") !== "none" ||
        css(child, "direction") !== "ltr" ||
        css(child, "writing-mode") !== "horizontal-tb" ||
        !["auto", "1"].includes(css(child, "column-count")) ||
        !["auto", "0"].includes(css(child, "z-index")) ||
        css(child, "aspect-ratio") !== "auto"
      )
        throw new Error(
          "浮动列的文字环绕、shape-outside、clear、方向混合、外边距、变换或偏移暂不能原生保留",
        );
      if (
        !["auto", "0px", "0"].includes(css(child, "min-width")) ||
        css(child, "max-width") !== "none" ||
        !["auto", "0px", "0"].includes(css(child, "min-height")) ||
        css(child, "max-height") !== "none"
      )
        throw new Error("浮动列 min/max 约束不能作为固定比例轨道保留");
      if (css(child, "height") !== "auto" && !/^\d+(?:\.\d+)?px$/u.test(css(child, "height")))
        throw new Error("浮动列只支持 auto 或固定像素高度");
      const fraction = rationalFloatWidth(css(child, "width"));
      columns = (columns / gcd(columns, fraction.denominator)) * fraction.denominator;
      if (columns > 24) throw new Error("浮动列共同分母超过 24 条原生 track");
      if (
        axes.some(
          (side) =>
            !finite(inset(child, side)) || inset(child, side) < 0 || inset(child, side) > 2000,
        )
      )
        throw new Error("浮动列 padding/border 超过有界布局预算");
      const horizontalInset = inset(child, "left") + inset(child, "right");
      if (
        !finite(horizontalInset) ||
        horizontalInset < 0 ||
        (css(child, "box-sizing") !== "border-box" && horizontalInset > 0)
      )
        throw new Error("content-box 百分比列加上 padding/border 会改变比例；请使用 border-box");
      const ratio = fraction.numerator / fraction.denominator;
      if (!near(child.bounds.width, available * ratio) || child.bounds.width < horizontalInset)
        throw new Error("浮动列测量宽度与捕获的百分比不一致或被最小内容约束扩大");
      return { source: child, index, fraction };
    });
    let used = 0,
      maxHeight = 0;
    const placements = new Map();
    for (const item of items) {
      const span = item.fraction.numerator * (columns / item.fraction.denominator);
      const column = direction === "left" ? used : columns - used - span;
      if (column < 0 || used + span > columns)
        throw new Error("浮动列存在多行包装或重叠，不能作为单行 Grid 保留");
      const x = item.source.bounds.x - (coordinateSpace === "root-relative" ? source.bounds.x : 0);
      const y = item.source.bounds.y - (coordinateSpace === "root-relative" ? source.bounds.y : 0);
      if (!near(x, padding.left + (available * column) / columns) || !near(y, padding.top))
        throw new Error("浮动列不在同一测量行或偏离百分比轨道；保留原始几何");
      maxHeight = Math.max(maxHeight, item.source.bounds.height);
      placements.set(item.source, { column, span });
      used += span;
    }
    if (
      css(source, "height") === "auto" &&
      !near(source.bounds.height, padding.top + maxHeight + padding.bottom)
    )
      throw new Error("浮动行没有可靠地包含列高度；请使用 flow-root 或空 clearfix");
    return {
      entries,
      items,
      placements,
      initialSizing: new Map(),
      fields: {
        layout: "grid",
        layoutWrap: "none",
        gap: 0,
        rowGap: 0,
        columnGap: 0,
        alignItems: "start",
        justifyContent: "start",
        alignContent: "start",
        gridColumns: columns,
        gridRows: 1,
        gridColumnSizes: Array.from({ length: columns }, () => ({ type: "flex", value: 1 })),
        gridRowSizes: [{ type: "hug" }],
        gridItemsPositioning: "manual",
        gridAutoTracks: "none",
      },
    };
  } catch (error) {
    return reject(error.message);
  }
}

export function sizeHtmlFloatColumn(source, node, plan) {
  const placement = plan.placements.get(source);
  if (!placement) throw new Error("浮动列缺少经过验证的源位置");
  plan.initialSizing.set(
    node,
    Object.fromEntries(["layoutSizingHorizontal", "layoutSizingVertical"].map((k) => [k, node[k]])),
  );
  Object.assign(node, {
    gridRowAnchorIndex: 0,
    gridColumnAnchorIndex: placement.column,
    gridColumnSpan: placement.span,
    gridRowSpan: 1,
    gridChildHorizontalAlign: "start",
    gridChildVerticalAlign: "start",
    layoutSizingHorizontal: "fill",
    layoutSizingVertical:
      css(source, "height") === "auto" && ["horizontal", "vertical", "grid"].includes(node.layout)
        ? "hug"
        : "fixed",
  });
}

export function validateHtmlFloatColumns(node) {
  if (node.layout !== "grid") throw new Error("浮动列的父级原生 Grid 已失效");
  nativeGridPlan(node);
}
export function removeHtmlFloatColumns(node, plan) {
  removeHtmlGrid(node);
  for (const [child, sizing] of plan.initialSizing) {
    for (const key of ["gridColumnSpan", "gridRowSpan", ...GRID_CHILD_FIELDS]) delete child[key];
    for (const [key, value] of Object.entries(sizing))
      if (value === undefined) delete child[key];
      else child[key] = value;
  }
}
