/* Circular pixel radii, clockwise from top-left. Authored values survive resize. */
export const CORNER_RADIUS_PROPERTIES = Object.freeze([
  "border-top-left-radius", "border-top-right-radius",
  "border-bottom-right-radius", "border-bottom-left-radius",
]);

export function normalizeCornerRadii(value) {
  if (!Array.isArray(value) || value.length !== 4 ||
      Array.from(value).some((radius) => !Number.isFinite(radius) || radius < 0 || radius > 9999))
    throw new Error("cornerRadii 必须是四个 0–9999 的有限圆形像素半径（左上、右上、右下、左下）");
  return [...value];
}

export function cssCornerRadii(values, borderBox) {
  return normalizeCornerRadii(values.map((value) => {
    const parts = String(value).trim().split(/\s+/u);
    if (parts.length < 1 || parts.length > 2 ||
        parts.some((part) => !/^(?:(?:\d+(?:\.\d+)?|\.\d+)(?:px|%)|0(?:\.0+)?)$/u.test(part)))
      throw new Error("CSS 圆角只支持圆形 px 半径或已知边框盒中的圆形百分比；椭圆和复杂表达式暂不能保留");
    // Computed CSS keeps percentages unresolved. Resolve each axis against the
    // original border box before checking circular representability; 50% on a
    // rectangle is an ellipse and must never be averaged into a circular radius.
    const radii = [parts[0], parts[1] ?? parts[0]].map((part, axis) => {
      if (!part.endsWith("%")) return Number.parseFloat(part);
      const edge = axis === 0 ? borderBox?.width : borderBox?.height;
      if (!Number.isFinite(edge) || edge <= 0)
        throw new Error("CSS 百分比圆角需要有限正尺寸的原始边框盒");
      return Number.parseFloat(part) / 100 * edge;
    });
    if (radii.length === 2 && radii[0] !== radii[1])
      throw new Error("CSS 椭圆圆角暂不能保留；请使用相等的水平和垂直 px 半径");
    return radii[0];
  }));
}

export function authoredCornerRadii(node) {
  return node.cornerRadii ?? Array(4).fill(node.cornerRadius ?? 0);
}

export function effectiveCornerRadii(node) {
  const radii = authoredCornerRadii(node);
  const [tl, tr, br, bl] = radii;
  // CSS Backgrounds 3: one common factor prevents overlapping adjacent curves.
  const scale = Math.min(1, ...[
    [node.width, tl + tr], [node.width, bl + br],
    [node.height, tl + bl], [node.height, tr + br],
  ].filter(([, sum]) => sum > 0).map(([edge, sum]) => Math.max(0, edge) / sum));
  return radii.map((radius) => radius * scale);
}

export function insideRoundedRect(node, point, epsilon = 0) {
  const x = point.x - node.x, y = point.y - node.y, w = node.width, h = node.height;
  if (x < -epsilon || y < -epsilon || x > w + epsilon || y > h + epsilon) return false;
  const [tl, tr, br, bl] = effectiveCornerRadii(node);
  for (const [radius, cx, cy, corner] of [
    [tl, tl, tl, x < tl && y < tl],
    [tr, w - tr, tr, x > w - tr && y < tr],
    [br, w - br, h - br, x > w - br && y > h - br],
    [bl, bl, h - bl, x < bl && y > h - bl],
  ]) if (radius > 0 && corner && (x - cx) ** 2 + (y - cy) ** 2 > (radius + epsilon) ** 2)
    return false;
  return true;
}

export function roundedRectOutline(node, steps = 8) {
  const [tl, tr, br, bl] = effectiveCornerRadii(node);
  const result = [];
  for (const [radius, x, y, start] of [
    [tl, node.x + tl, node.y + tl, Math.PI],
    [tr, node.x + node.width - tr, node.y + tr, -Math.PI / 2],
    [br, node.x + node.width - br, node.y + node.height - br, 0],
    [bl, node.x + bl, node.y + node.height - bl, Math.PI / 2],
  ]) for (let i = 0; i <= (radius ? steps : 0); i++) {
    const angle = start + (i / steps) * Math.PI / 2;
    result.push({ x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius });
  }
  return result;
}

export function roundedRectSvgGeometry(node) {
  const n = (value) => Math.round(value * 1e6) / 1e6;
  const [tl, tr, br, bl] = effectiveCornerRadii(node).map(n);
  const x = n(node.x), y = n(node.y), right = n(node.x + node.width), bottom = n(node.y + node.height);
  if (tl === tr && tr === br && br === bl)
    return { tag: "rect", attributes: `x="${x}" y="${y}" width="${n(node.width)}" height="${n(node.height)}" rx="${tl}"` };
  const arc = (radius, endX, endY) => radius
    ? `A ${radius} ${radius} 0 0 1 ${n(endX)} ${n(endY)}` : `L ${n(endX)} ${n(endY)}`;
  return { tag: "path", attributes: `d="M ${n(x + tl)} ${y} H ${n(right - tr)} ${arc(tr, right, y + tr)} V ${n(bottom - br)} ${arc(br, right - br, bottom)} H ${n(x + bl)} ${arc(bl, x, bottom - bl)} V ${n(y + tl)} ${arc(tl, x + tl, y)} Z"` };
}
