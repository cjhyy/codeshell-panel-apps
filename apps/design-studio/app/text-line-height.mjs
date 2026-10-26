// The pixel envelope derives from font-size1–240 × ratio0.7–3 limits.
// An absent unit keeps the original v3 ratio semantics and serialized shape.
export const MIN_TEXT_LINE_HEIGHT_PIXELS = 0.7;
export const MAX_TEXT_LINE_HEIGHT_PIXELS = 720;

export function validTextLineHeight(node) {
  if (!Number.isFinite(node.lineHeight)) return false;
  if (node.lineHeightUnit === undefined) return node.lineHeight >= 0.7 && node.lineHeight <= 3;
  return (
    node.lineHeightUnit === "pixels" &&
    node.lineHeight >= MIN_TEXT_LINE_HEIGHT_PIXELS &&
    node.lineHeight <= MAX_TEXT_LINE_HEIGHT_PIXELS
  );
}

export const textLineHeightPixels = (node) =>
  node.lineHeightUnit === "pixels"
    ? node.lineHeight
    : (node.fontSize ?? 16) * (node.lineHeight ?? 1.2);
export const textLineHeightRatio = (node) => textLineHeightPixels(node) / (node.fontSize ?? 16);
export const textLineHeightCss = (node) =>
  node.lineHeightUnit === "pixels" ? `${node.lineHeight}px` : String(node.lineHeight ?? 1.2);

export function nativeTextLineHeight(node) {
  if (!validTextLineHeight(node)) throw Error("文字行高或单位无效。");
  return node.lineHeightUnit === "pixels"
    ? { unit: "PIXELS", value: node.lineHeight }
    : { unit: "PERCENT", value: node.lineHeight * 100 };
}
