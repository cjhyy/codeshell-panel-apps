/* Native-safe recovery of bounded negative block margins through positive insets. */
const css = (source, key) => String(source.cssLayout?.[key] ?? source.rawStyles?.[key] ?? "").trim().toLowerCase();
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const near = (left, right) => Math.abs(left - right) <= 0.05;
const bounded = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;

/** Pure plan. Original padding remains in the receipt; all source objects are read-only. */
export function planHtmlBlockInsets(source, parent, block, { ancestorTransformed = false } = {}) {
  if (!block?.items.some((item) => item.bleed)) return null;
  const refuse = (unsupported) => ({ unsupported });
  if (parent.layout !== "vertical" || ![undefined, "fixed", "fill"].includes(parent.layoutSizingHorizontal) ||
      parent.rotation || ancestorTransformed || !["block", "flow-root"].includes(source.layout?.display) ||
      !/^(?:auto|100(?:\.0+)?%|\d+(?:\.\d+)?px)$/u.test(css(source, "width")) ||
      ["left", "right"].some((side) => css(source, `margin-${side}`) === "auto"))
    return refuse("负横向外边距的原生 inset 重排仅支持无 auto 外边距、Fixed/Fill 宽度的普通垂直块容器。");
  if (block.entries.length !== block.items.length || parent.children?.length !== block.items.length || block.items.some((item) =>
      !item.fill || item.crossAlign || item.gap < 0 || !item.original ||
      item.original.layoutSizingHorizontal !== "fill" || item.original.layoutPositioning === "absolute" ||
      item.original.visible === false || item.original.rotation ||
      ["left", "right"].some((side) => css(item.source, `margin-${side}`) === "auto")))
    return refuse("负横向外边距的原生 inset 重排需要全部可见普通 Fill 子项，且不含 auto 外边距、绝对覆盖或垂直重叠。");
  const bleedLeft = Math.max(...block.items.map((item) => item.bleed?.left ?? 0));
  const bleedRight = Math.max(...block.items.map((item) => item.bleed?.right ?? 0));
  const originalLeft = block.paddingLeft, originalRight = block.paddingRight;
  const paddingLeft = originalLeft - bleedLeft, paddingRight = originalRight - bleedRight;
  const borderLeft = finite(source.border?.left?.width), borderRight = finite(source.border?.right?.width);
  if (![borderLeft, borderRight].every((value) => bounded(value, 0, 2000)) ||
      !bounded(paddingLeft, Math.max(0, borderLeft), 2000) || !bounded(paddingRight, Math.max(0, borderRight), 2000))
    return refuse("负横向外边距超出父框可重排的正 padding；重排后 padding 必须覆盖自身 CSS border inset。");
  const width = parent.width - paddingLeft - paddingRight;
  const x = parent.x + paddingLeft;
  const items = [];
  for (const item of block.items) {
    const node = item.original;
    const left = bleedLeft - (item.bleed?.left ?? 0), right = bleedRight - (item.bleed?.right ?? 0);
    const y = node.y - item.gap, height = node.height + item.gap;
    if (![left, right, item.gap].every((value) => bounded(value, 0, 2000)) ||
        ![width, height].every((value) => bounded(value, 1, 20000)) ||
        ![x, y].every((value) => bounded(value, -20000, 20000)) || !near(node.x, x + left))
      return refuse("负横向外边距的补偿框超出 v3 尺寸/坐标预算或与实际测量位置不一致。");
    const notes = JSON.stringify({ format: "codeshell.html.block-inset", version: 1, sourceNodeId: node.id,
      bleed: [item.bleed?.left ?? 0, item.bleed?.right ?? 0], compensation: [left, right],
      capturedMargins: ["left", "right"].map((side) => item.source.cssLayout?.[`margin-${side}`] ?? item.source.rawStyles?.[`margin-${side}`] ?? "") });
    if (notes.length > 2000) return refuse("子项来源外边距记录超过 2000 字符预算，不能无损记录 inset 重排。");
    items.push({ node, x, y, width, height, left, right, top: item.gap, notes });
  }
  let metadata;
  try { metadata = JSON.parse(parent.notes ?? "{}"); } catch { return refuse("父框来源备注不能安全附加 inset 重排记录。"); }
  const notes = JSON.stringify({ ...metadata, blockInsetRebase: { version: 1,
    original: [originalLeft, originalRight], rebased: [paddingLeft, paddingRight],
    bleed: [bleedLeft, bleedRight], border: [borderLeft, borderRight] } });
  if (notes.length > 2000) return refuse("父框来源备注已到达 2000 字符预算，不能无损记录 inset 重排。");
  return { paddingLeft, paddingRight, notes, items, originalLeft, originalRight };
}

/** Validate all replacements together before mutating any original node. */
export function applyHtmlBlockInsets(roots, candidates, makeNode, warn, maximumNodes = 10000) {
  const proposals = new Map();
  for (const { source, node, block, ancestorTransformed } of candidates) {
    const plan = planHtmlBlockInsets(source, node, block, { ancestorTransformed });
    if (!plan) continue;
    if (plan.unsupported) { warn("block-bleed-native-unsupported", node.id, plan.unsupported); continue; }
    const children = plan.items.map((item) => Object.assign(
      makeNode(`${item.node.id}-block-insets`, "frame", `${item.node.name} block insets`,
        { x: item.x, y: item.y, width: item.width, height: item.height }),
      { layout: "vertical", layoutWrap: "none", gap: 0, padding: 0,
        paddingLeft: item.left, paddingRight: item.right, paddingTop: item.top, paddingBottom: 0,
        layoutSizingHorizontal: "fill", layoutSizingVertical: "hug", alignItems: "start", justifyContent: "start",
        clipContent: false, children: [item.node],
        notes: item.notes }));
    proposals.set(node, { ...node, paddingLeft: plan.paddingLeft, paddingRight: plan.paddingRight, notes: plan.notes, children });
  }
  if (!proposals.size) return null;
  let count = 0;
  const ids = new Set(), references = new Set();
  const check = (original, depth) => {
    const node = proposals.get(original) ?? original;
    if (++count > maximumNodes || depth > 32 || ids.has(node.id) || references.has(original)) return false;
    ids.add(node.id); references.add(original);
    return (node.children ?? []).every((child) => check(child, depth + 1));
  };
  if (!roots.every((root) => check(root, 1))) {
    for (const node of proposals.keys()) warn("block-bleed-native-unsupported", node.id,
      "正 inset 重排会超出 10,000 节点/32 层结构预算；保留原测量结构，原生负间距仍不兼容。");
    return null;
  }
  for (const [node, proposed] of proposals) {
    Object.assign(node, proposed);
    const receipt = JSON.parse(proposed.notes).blockInsetRebase;
    warn("block-inset-rebased", node.id,
      `原生 Auto Layout 通过结构化 inset 重排保留负外边距：父框 left/right padding ${receipt.original.join("/")} → ${receipt.rebased.join("/")}；原始 CSS 值保留在来源记录。`);
  }
  return count;
}
