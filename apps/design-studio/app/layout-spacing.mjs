/* Native signed spacing is bounded to the main axis of nowrap fixed/Fill stacks. */
export const mainAxisGap = (node) =>
  node?.[node.layout === "vertical" ? "rowGap" : "columnGap"] ?? node?.gap ?? 0;

export function validateLayoutSpacing(node) {
  for (const key of ["gap", "rowGap", "columnGap"]) {
    if (node[key] === undefined) continue;
    if (!Number.isFinite(node[key]) || node[key] < -2000 || node[key] > 2000)
      throw new Error(`${key} 必须为 -2000–2000 的有限间距`);
  }
  if (!["gap", "rowGap", "columnGap"].some((key) => node[key] < 0)) return;
  const horizontal = node.layout === "horizontal";
  if (!["horizontal", "vertical"].includes(node.layout))
    throw new Error("负间距只支持水平或垂直主轴；Grid 和自由布局不能使用负间距");
  if (node.layoutWrap && node.layoutWrap !== "none")
    throw new Error("负间距换行尚不能可靠映射到原生与 CSS 布局");
  if (node.layoutReverse) throw new Error("负间距反向布局尚不支持");
  if (node[horizontal ? "rowGap" : "columnGap"] < 0)
    throw new Error("交叉轴间距不能为负数");
  if (node[horizontal ? "layoutSizingHorizontal" : "layoutSizingVertical"] === "hug")
    throw new Error("负间距主轴的 Hug 尺寸尚未验证；请使用固定或 Fill 尺寸");
}
