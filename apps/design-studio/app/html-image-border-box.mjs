import { cssCornerRadii } from "./corner-radii.mjs";

const sides = ["top", "right", "bottom", "left"];
const px = /^(?:\d+(?:\.\d+)?|\.\d+)px$/u;
const fail = (reason) => { throw new Error(`HTML_IMAGE_BORDER_UNSUPPORTED: ${reason}`); };

/** A real editable border-box with an inset image, never a border painted over
 * the full bitmap. The maintained capture owns the source-only CSS facts. */
export function planHtmlImageBorderBox(source, node, { transformedAncestor = false } = {}) {
  if (source.nodeType !== "image" || !sides.some((side) => source.border?.[side]?.width > 0)) return null;
  const facts = source.cssImageBox, css = source.cssLayout;
  if (source.tag !== "img" || !source.semantic?.semanticId || !facts || !css || facts.complete !== "true")
    fail("边框图片需要当前真实 IMG 的完整捕获证据");
  if (transformedAncestor || facts.ancestorGeometry !== "ordinary" || source.transform || !["static", "relative"].includes(css.position) ||
      (css.position === "relative" && ["top", "right", "bottom", "left"].some((key) => !["auto", "0px"].includes(css[key]))))
    fail("变换或脱离普通流的边框图片尚未证明");
  for (const [key, allowed] of Object.entries({
    "object-position": ["50% 50%"], transform: ["none"], rotate: ["none"], scale: ["none"], translate: ["none"], zoom: ["1", "normal"], filter: ["none"],
    "backdrop-filter": ["none"], "mix-blend-mode": ["normal"], "box-shadow": ["none"],
    "outline-style": ["none"], "clip-path": ["none"], "mask-image": ["none"],
    "background-image": ["none"], "border-image-source": ["none"],
  })) if (!allowed.includes(facts[key])) fail(`${key} 不属于已验证的普通图片子集`);
  if (!/^rgba\(\d+, \d+, \d+, 0\)$/u.test(facts["background-color"]))
    fail("图片自身的有色背景与分组透明度合成尚未证明");
  if (!sides.every((side) => facts[`padding-${side}`] === "0px")) fail("图片自身 padding 必须为零");
  const width = Number.parseFloat(facts["border-top-width"]);
  if (!Number.isFinite(width) || width <= 0 || width > 100 ||
      !sides.every((side) => facts[`border-${side}-style`] === "solid" &&
        px.test(facts[`border-${side}-width`]) && Number.parseFloat(facts[`border-${side}-width`]) === width &&
        facts[`border-${side}-color`] === facts["border-top-color"] && source.border[side]?.width === width))
    fail("只支持四边相同的实线像素边框");
  if (!node.strokeSides || node.strokeAlign !== "inside" || node.strokeSides.some((side) =>
      side.width !== width || side.color !== node.strokeSides[0].color || side.opacity !== node.strokeSides[0].opacity))
    fail("原始边框与已验证的可编辑描边不一致");
  if (node.width - 2 * width < 1 || node.height - 2 * width < 1) fail("边框后的图片内容区小于 1px");
  if (!Array.isArray(source.cssBorderRadii) || source.cssBorderRadii.length !== 4 ||
      Array.from(source.cssBorderRadii).some((value) => typeof value !== "string")) fail("缺少原始圆角单位");
  const percentCircle = source.cssBorderRadii.every((radius) => radius === "50%");
  let radius;
  if (percentCircle) {
    if (node.width !== node.height || !["width", "height"].every((key) => px.test(css[key])) ||
        source.flexItem?.grow > 0 || !["min-width", "min-height"].every((key) => ["auto", "0px"].includes(css[key])) ||
        !["max-width", "max-height"].every((key) => css[key] === "none") ||
        !/^auto(?: \d+(?:\.\d+)? \/ \d+(?:\.\d+)?)?$/u.test(css["aspect-ratio"]))
      fail("50% 圆角只可投影当前固定方形，不能保留响应式百分比意图");
    radius = node.width / 2;
  } else {
    let radii;
    try { radii = cssCornerRadii(source.cssBorderRadii); } catch (error) { fail(error.message); }
    if (radii.some((value) => value !== radii[0])) fail("边框图片暂不支持不等圆角");
    radius = radii[0];
    if (radius > Math.min(node.width, node.height) / 2) fail("重叠圆角的响应式内边缘尚未证明");
  }
  if (!["fill", "cover", "contain"].includes(facts["object-fit"]) || facts["object-fit"] !== node.objectFit)
    fail("不支持该 object-fit 或捕获意图不一致");
  return { width, radius, innerRadius: Math.max(0, radius - width), percentCircle };
}
