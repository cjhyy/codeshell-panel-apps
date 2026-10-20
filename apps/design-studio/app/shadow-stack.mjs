/* CSS geometric masks. Native painted-alpha effects are deliberately distinct. */
import { effectiveCornerRadii } from "./corner-radii.mjs";
import { designStrokeSides } from "./stroke.mjs";
const object = value => value && typeof value === "object" && !Array.isArray(value);
const keys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
const finite = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
export function normalizeShadowStack(value) {
  if (!object(value) || !keys(value, ["basis", "layers"]) || value.basis !== "css-box" ||
      !Array.isArray(value.layers) || value.layers.length < 1 || value.layers.length > 8)
    throw Error("shadowStack 只支持 css-box 几何蒙版与 1–8 个有序阴影；native-paint 原始效果暂保留在来源中");
  return { basis: "css-box", layers: Array.from(value.layers, layer => {
    if (!object(layer) || !keys(layer, ["kind", "color", "opacity", "x", "y", "blur", "spread", "visible"]) ||
        !["inner", "outer"].includes(layer.kind) || typeof layer.color !== "string" || !/^#[\da-f]{6}$/iu.test(layer.color) ||
        !finite(layer.opacity, 0, 1) || !finite(layer.x, -500, 500) || !finite(layer.y, -500, 500) ||
        !finite(layer.blur, 0, 200) || layer.spread !== 0 || typeof layer.visible !== "boolean")
      throw Error("阴影层需要 inner/outer、六位 RGB、0–1 透明度、±500px 偏移、0–200px 模糊、spread:0 与 visible 布尔值");
    return { kind: layer.kind, color: layer.color.toLowerCase(), opacity: layer.opacity, x: layer.x, y: layer.y, blur: layer.blur, spread: 0, visible: layer.visible };
  }) };
}
export function validateShadowStack(node) {
  if (node.shadowStack === undefined) return;
  normalizeShadowStack(node.shadowStack);
  if (!["frame", "rectangle", "component"].includes(node.type) || node.shadow !== undefined)
    throw Error("shadowStack 只适用于 Frame/Rectangle/Component，且不能与旧 shadow 同时设置");
  const widths = shadowBorderWidths(node);
  if (widths.some(width => width > 0) && node.strokeAlign !== "inside")
    throw Error("CSS 阴影几何蒙版只支持 inside 边框；center/outside 描边暂不能作为 CSS 边缘");
  if(widths.some(width=>width>0) && effectiveCornerRadii(node).some(radius=>radius>0))
    throw Error("带边框圆角的 CSS 阴影蒙版接合暂不能无损保留；请使用方角或移除边框，未近似内边缘曲线");
}
export const visibleShadowLayers = (node, kind) => (node.shadowStack?.layers ?? []).filter(layer => layer.visible && layer.opacity > 0 && (!kind || layer.kind === kind));
export function shadowStackOutsets(node, rotation = 0) {
  const result = { left: 0, top: 0, right: 0, bottom: 0 };
  for (const layer of visibleShadowLayers(node, "outer")) {
    const blur = layer.blur * 1.5, radial = rotation % 360 ? Math.hypot(layer.x, layer.y) : 0;
    result.left = Math.max(result.left, blur + (radial || Math.max(0, -layer.x)));
    result.top = Math.max(result.top, blur + (radial || Math.max(0, -layer.y)));
    result.right = Math.max(result.right, blur + (radial || Math.max(0, layer.x)));
    result.bottom = Math.max(result.bottom, blur + (radial || Math.max(0, layer.y)));
  }
  return result;
}
const fmt = value => String(Math.round(value * 1e6) / 1e6 || 0);
export function roundedShadowPath(box, radii, dx = 0, dy = 0) {
  const x = box.x + dx, y = box.y + dy, right = x + box.width, bottom = y + box.height;
  const [tl, tr, br, bl] = radii;
  const arc = ([rx, ry], ex, ey) => rx > 0 && ry > 0 ? `A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(ex)} ${fmt(ey)}` : `L${fmt(ex)} ${fmt(ey)}`;
  return `M${fmt(x + tl[0])} ${fmt(y)}H${fmt(right - tr[0])}${arc(tr, right, y + tr[1])}V${fmt(bottom - br[1])}${arc(br, right - br[0], bottom)}H${fmt(x + bl[0])}${arc(bl, x, bottom - bl[1])}V${fmt(y + tl[1])}${arc(tl, x + tl[0], y)}Z`;
}
export const shadowBorderWidths = node => designStrokeSides(node).map(side=>(node.strokeSides!==undefined || node.strokeAlign!==undefined || node.stroke!=="transparent")?side.width:0);
export function shadowMaskGeometry(node) {
  const [t, r, b, l] = shadowBorderWidths(node).map(width=>node.strokeAlign === "inside" ? width : 0);
  const radii = effectiveCornerRadii(node);
  const outer = { x: 0, y: 0, width: node.width, height: node.height };
  const inner = { x: Math.min(l, node.width), y: Math.min(t, node.height), width: Math.max(0, node.width - l - r), height: Math.max(0, node.height - t - b) };
  const outerRadii = radii.map(radius => [radius, radius]);
  const innerRadii = radii.map((radius, index) => [Math.max(0, radius - (index === 0 || index === 3 ? l : r)), Math.max(0, radius - (index < 2 ? t : b))]);
  return { outer, inner, outerRadii, innerRadii, outerPath: roundedShadowPath(outer, outerRadii), innerPath: roundedShadowPath(inner, innerRadii) };
}
export function shadowStackCss(node) {
  return (node.shadowStack?.layers ?? []).filter(layer => layer.visible).map(layer => {
    const rgb = [1, 3, 5].map(i => Number.parseInt(layer.color.slice(i, i + 2), 16));
    return `${layer.kind === "inner" ? "inset " : ""}${layer.x}px ${layer.y}px ${layer.blur}px 0px rgba(${rgb.join(",")},${layer.opacity})`;
  }).join(",");
}
export function shadowStackSvg(node, id) {
  if (!node.shadowStack) return { definitions: [], inner: "", outer: "" };
  validateShadowStack(node);
  const geometry = shadowMaskGeometry(node), layers = visibleShadowLayers(node), definitions = [], body = { inner: [], outer: [] };
  const extent = Math.max(1, ...layers.map(layer => layer.blur * 3 + Math.abs(layer.x) + Math.abs(layer.y) + 2));
  const cover = `M${-extent} ${-extent}H${node.width + extent}V${node.height + extent}H${-extent}Z`;
  definitions.push(`<clipPath id="${id}-padding"><path d="${geometry.innerPath}"/></clipPath>`);
  definitions.push(`<mask id="${id}-exterior" maskUnits="userSpaceOnUse" x="${-extent}" y="${-extent}" width="${node.width + extent * 2}" height="${node.height + extent * 2}" style="mask-type:alpha"><path d="${cover} ${geometry.outerPath}" fill="white" fill-rule="evenodd"/></mask>`);
  layers.forEach((layer, index) => {
    if(layer.kind==="inner" && (geometry.inner.width<=0 || geometry.inner.height<=0))return;
    const filter = `${id}-${index}`;
    definitions.push(`<filter id="${filter}" filterUnits="userSpaceOnUse" x="${-extent}" y="${-extent}" width="${node.width + extent * 2}" height="${node.height + extent * 2}" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${fmt(layer.blur / 2)}"/></filter>`);
    const path = layer.kind === "inner" ? `${cover} ${roundedShadowPath(geometry.inner, geometry.innerRadii, layer.x, layer.y)}` : roundedShadowPath(geometry.outer, geometry.outerRadii, layer.x, layer.y);
    body[layer.kind].unshift(`<g ${layer.kind === "inner" ? `clip-path="url(#${id}-padding)"` : `mask="url(#${id}-exterior)"`}><path d="${path}" fill-rule="evenodd" fill="${layer.color}" opacity="${layer.opacity}" filter="url(#${filter})"/></g>`);
  });
  return { definitions, inner: body.inner.join(""), outer: body.outer.join("") };
}
const nativeMaskError=message=>Object.assign(Error(message),{code:"NATIVE_CSS_SHADOW_MASK"});
export function nativeShadowStackEffects(node) {
  if (!node.shadowStack) return undefined;
  validateShadowStack(node);
  const inner = visibleShadowLayers(node, "inner");
  if (inner.length && (shadowBorderWidths(node).some(width => width > 0) || node.fill === "transparent" ||
      node.fillPaints?.some(paint => paint.type !== "SOLID" || paint.opacity !== 1)))
    throw nativeMaskError("CSS 内阴影的透明/无填充或边框几何蒙版不能无损映射 Figma INNER_SHADOW；请保留 Panel/CSS 版本");
  if(new Set(inner.map(layer=>layer.color)).size>1)throw nativeMaskError("多色 CSS 内阴影的原生可视顺序尚未验证；保留 Panel/CSS 完整层序");
  // Outer native alpha knockouts and descendants require separate capability evidence.
  if (visibleShadowLayers(node, "outer").length)
    throw nativeMaskError("CSS 外阴影几何蒙版暂不能无损映射 Figma painted-alpha DROP_SHADOW");
  return node.shadowStack.layers.map(layer => ({ type: layer.kind === "inner" ? "INNER_SHADOW" : "DROP_SHADOW", color: { r: parseInt(layer.color.slice(1, 3), 16) / 255, g: parseInt(layer.color.slice(3, 5), 16) / 255, b: parseInt(layer.color.slice(5, 7), 16) / 255, a: layer.opacity }, offset: { x: layer.x, y: layer.y }, radius: layer.blur, spread: 0, visible: layer.visible, blendMode: "NORMAL" }));
}
