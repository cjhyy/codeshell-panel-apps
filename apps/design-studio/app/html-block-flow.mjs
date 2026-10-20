/* Bounded recovery of the pinned converter's ordinary vertical block stacks. */
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const css = (node, key) => String(node.cssLayout?.[key] ?? node.rawStyles?.[key] ?? "").trim().toLowerCase();
const inert = (node, name) => node.nodeType === "container" && node.name === name && !node.semantic;
const flow = (node) => node.visible !== false && node.layout?.display !== "none";
const absolute = (node) => ["absolute", "fixed"].includes(node.positioning?.mode);
const zeroOffset = (value) => !value || value === "auto" || /^-?0(?:\.0+)?(?:px)?$/u.test(value);

export function planHtmlBlockFlow(source, coordinateSpace = "parent-relative") {
  if (
    source.nodeType !== "container" ||
    !["block", "flow-root"].includes(source.layout?.display) ||
    (!source.cssLayout && !inert(source, "margin-wrapper")) ||
    !source.children?.length
  ) return null;
  const reason = (message) => ({ unsupported: message });
  if (source.transform || !["", "none"].includes(css(source, "float")) ||
      !["", "horizontal-tb"].includes(css(source, "writing-mode")) ||
      !["", "ltr"].includes(css(source, "direction")) ||
      !["", "auto", "1"].includes(css(source, "column-count")))
    return reason("浮动或变换的块容器需要保留测量布局。");
  if (source.children.length === 1 && source.children[0].nodeType === "text") return null;
  const local = (child, axis) => finite(child.bounds?.[axis]) -
    (coordinateSpace === "root-relative" ? finite(source.bounds?.[axis]) : 0);
  // Native strokes do not consume the frame's content area. CSS borders do,
  // so their layout inset belongs in native padding until stroke semantics
  // can represent that separately.
  const padding = Object.fromEntries(["top", "right", "bottom", "left"].map((side) =>
    [side, finite(source.layout?.padding?.[side]) + finite(source.border?.[side]?.width)]));
  const contentWidth = finite(source.bounds?.width) - padding.left - padding.right;
  const promoted = new Set(), replacements = new Map();
  for (const child of source.children) {
    const zeroRelative = css(child, "position") === "relative" &&
      ["top", "right", "bottom", "left"].every((key) => zeroOffset(css(child, key)));
    const autoOverflow = ["static", "relative"].includes(css(child, "position")) &&
      ["left", "right"].some((side) => css(child, `margin-${side}`) === "auto") &&
      ["top", "right", "bottom", "left"].every((side) => {
        const value = css(child, `margin-${side}`);
        return value === "auto" || /^0(?:\.0+)?(?:px)?$/u.test(value);
      }) && finite(child.bounds?.width) > contentWidth;
    if (
      !absolute(child) || (!zeroRelative && !autoOverflow)
    ) continue;
    const placeholder = source.children.find((entry) =>
      !replacements.has(entry) && entry.opacity === 0 && entry.children?.length === 0 &&
      ((zeroRelative && inert(entry, "z-index-placeholder") &&
        Math.abs(finite(entry.bounds?.width) - finite(child.bounds?.width)) < 0.02) ||
       (autoOverflow && inert(entry, "neg-margin-placeholder") &&
        Math.abs(finite(entry.bounds?.width) - Math.max(1, contentWidth)) < 0.02)) &&
      ["x", "y", "height"].every((key) =>
        Math.abs(finite(entry.bounds?.[key]) - finite(child.bounds?.[key])) < 0.02));
    if (placeholder) {
      promoted.add(child);
      replacements.set(placeholder, child);
    }
  }
  if (source.children.some((child) => absolute(child) &&
      ["static", "relative"].includes(css(child, "position")) && !promoted.has(child)))
    return reason("原始流图层缺少可恢复的可靠占位，保留测量布局。");
  if (promoted.size && source.children.some((child) => absolute(child) && !promoted.has(child)))
    return reason("相对 z-index 与绝对覆盖层的绘制顺序需要保留测量布局。");
  const entries = source.children.flatMap((child, index) => {
    if (promoted.has(child)) return [];
    const recovered = replacements.get(child) ?? child;
    return [{ source: recovered, index: replacements.has(child) ? source.children.indexOf(recovered) : index }];
  });
  const items = entries.filter(({ source: child }) => flow(child) && (!absolute(child) || promoted.has(child)));
  if (!items.length) return null;
  if (items.some(({ source: child }) => child.nodeType === "text"))
    return reason("混合行内文字不能作为普通垂直块流保留。");
  if (items.some(({ source: child }) => inert(child, "inline-group") &&
      (child.children?.length !== 1 || !["image", "svg"].includes(child.children[0].nodeType))))
    return reason("混合行内元素的行框与基线需要保留测量布局。");
  if (items.some(({ source: child }) =>
    child.transform || !["", "none"].includes(css(child, "float")) ||
    !["", "none"].includes(css(child, "clear"))))
    return reason("浮动、clear 或变换的子项不能作为普通垂直块流保留。");
  const firstY = local(items[0].source, "y");
  const last = items.at(-1).source;
  const measuredBottom = finite(source.bounds?.height) - local(last, "y") - finite(last.bounds?.height);
  const bottom = css(source, "height") === "auto" || !source.semantic
    ? measuredBottom : finite(padding.bottom);
  if (firstY < -0.02 || bottom < -0.02)
    return reason("块流溢出容器的垂直边界，保留测量布局。");
  for (let index = 0; index < items.length; index++) {
    const item = items[index], child = item.source;
    if (finite(child.bounds?.height) <= 0 || css(child, "height").includes("%") ||
        (css(child, "width").includes("%") && !/^100(?:\.0+)?%$/u.test(css(child, "width"))) ||
        (css(child, "position") === "relative" &&
          !["top", "right", "bottom", "left"].every((key) => zeroOffset(css(child, key)))))
      return reason("零高度、百分比尺寸或相对偏移不能作为普通块流保留。");
    item.x = local(child, "x");
    item.y = local(child, "y");
    item.gap = index === 0 ? 0 : item.y -
      local(items[index - 1].source, "y") - finite(items[index - 1].source.bounds?.height);
    if (item.x < -0.02 || item.gap < -2 || item.gap > 2000)
      return reason("块流包含负向外边距或相互覆盖，保留测量布局。");
    const left = finite(padding.left), right = finite(padding.right);
    const width = css(child, "width");
    if (/^100(?:\.0+)?%$/u.test(width) && child.layout?.sizing?.boxSizing !== "border-box" &&
        ["left", "right"].some((side) => finite(child.layout?.padding?.[side]) + finite(child.border?.[side]?.width) > 0))
      return reason("content-box 百分比宽度溢出的块需要保留测量布局。");
    item.fill = width === "auto" || /^100(?:\.0+)?%$/u.test(width) ||
      (!child.semantic && Math.abs(finite(child.bounds?.width) - finite(source.bounds?.width) + left + right) < 0.05);
    const beforeAuto = css(child, "margin-left") === "auto", afterAuto = css(child, "margin-right") === "auto";
    const horizontalAuto = beforeAuto || afterAuto;
    const free = Math.max(0, finite(source.bounds?.width) - left - right - finite(child.bounds?.width));
    const expectedX = left + (beforeAuto && afterAuto ? free / 2 : beforeAuto ? free : 0);
    if (horizontalAuto && Math.abs(item.x - expectedX) <= 0.05)
      item.crossAlign = beforeAuto && afterAuto ? "center" : beforeAuto ? "end" : "start";
    // Other varying x coordinates need authored horizontal margin support.
    if (Math.abs(item.x - left) > 0.05 && !item.crossAlign)
      return reason("各块的横向外边距或对齐不同，保留测量布局。");
  }
  if ([firstY, bottom, finite(padding.left), finite(padding.right)].some((value) => value > 2000))
    return reason("块流间距超出可编辑的 2000px padding 上限，保留测量布局。");
  return {
    entries, items, promoted,
    paddingTop: Math.max(0, firstY),
    paddingBottom: Math.max(0, bottom),
    paddingLeft: finite(padding.left),
    paddingRight: finite(padding.right),
  };
}
