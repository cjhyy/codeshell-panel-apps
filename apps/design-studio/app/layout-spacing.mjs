/* Canonical signed spacing is mathematical; native overlap has a separate bound. */
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

// Actual native H/V nowrap research: all adjacent gaps share a lower bound
// given by the smallest visible AUTO child. Do not apply this to CSS layout.
export function nativeMainGap(node, children = node.children ?? []) {
  const requested = mainAxisGap(node);
  if (!Array.isArray(children) || children.length > 10000)
    throw new Error("原生间距子项必须为有界数组");
  const flow = children.filter((child) => child.visible !== false && child.layoutPositioning !== "absolute");
  if (requested >= 0 || flow.length < 2) return { requested, effective: requested, minimum: null };
  const axis = node.layout === "vertical" ? "height" : "width";
  const sizes = flow.map((child) => child[axis]);
  if (sizes.some((size) => !Number.isFinite(size) || size <= 0))
    throw new Error("原生负间距需要可核对的可见 AUTO 子项主轴尺寸");
  const minimum = Math.min(...sizes);
  return { requested, effective: Math.max(requested, -minimum), minimum };
}

export function validateNativeLayoutSpacing(node, children = node.children ?? []) {
  validateLayoutSpacing(node);
  const plan = nativeMainGap(node, children);
  if (mainAxisGap(node) < 0 && (node.rotation || children.some((child) => child.visible !== false &&
      child.layoutPositioning !== "absolute" && child.rotation)))
    throw Object.assign(new Error("旋转子项的原生负间距主轴尺寸尚未验证"), { code: "NATIVE_NEGATIVE_SPACING" });
  if (plan.effective - plan.requested > 0.0001)
    throw Object.assign(new Error(`原生负间距 ${plan.requested}px 会被最小可见 AUTO 子项 ${plan.minimum}px 限制为 ${plan.effective}px；请调整间距或使用已验证的流关系`), { code: "NATIVE_NEGATIVE_SPACING" });
  return plan;
}
