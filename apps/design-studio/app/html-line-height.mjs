// Capture-local evidence never enters the canonical schema or survives as an
// active CSS expression. The resulting finite ratio is ordinary v3 typography.
const capturedRatios = new WeakMap();
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function applyHtmlNumberLineHeight(source, node, warn) {
  const evidence = source.cssLineHeight;
  if (evidence === undefined) return; // Legacy DesignNode callers have no new evidence.
  const fields = ["kind", "value", "fontSize"];
  const valid = object(evidence) && Object.keys(evidence).every((key) => fields.includes(key));
  const matching =
    valid &&
    evidence.fontSize === source.textStyle?.fontSize &&
    evidence.fontSize === node.fontSize &&
    Number.isFinite(evidence.fontSize) &&
    evidence.fontSize >= 6 &&
    evidence.fontSize <= 240 &&
    !(typeof source.tag === "string" && source.tag.startsWith("::")) &&
    (source.styledSegments?.length ?? 0) <= 1;
  if (
    matching &&
    evidence.kind === "number" &&
    Number.isFinite(evidence.value) &&
    evidence.value >= 0.7 &&
    evidence.value <= 3
  ) {
    // Do not pass a CSS number through the adapter's two-decimal geometry helper.
    node.lineHeight = evidence.value;
    capturedRatios.set(node, { fontSize: node.fontSize, ratio: evidence.value });
    return;
  }
  warn(
    "html-line-height-intent",
    node.id,
    matching && evidence.kind === "resolved-length"
      ? "CSS 行高已解析为长度，无法据此区分 px、百分比、em 或继承/计算依赖；保留现有测量回退，后续字号编辑需核对。"
      : matching && evidence.kind === "normal"
        ? "CSS normal 行高依赖实际字体，未证明等于固定比例；保留现有回退并核对字号编辑。"
        : "行高缺少唯一且匹配实际文字样式的有界 CSS number 证据；保留现有测量回退，未猜测原始单位。",
  );
}

export function htmlTextLineHeightRatio(node, fallback) {
  const captured = capturedRatios.get(node);
  return captured?.fontSize === node.fontSize ? captured.ratio : fallback;
}
