/* CSS background-image → bounded editable v3 paints. No DOM or upstream parser.
 * Gradient line, magic corners and stop fixup: https://www.w3.org/TR/css-images-3/
 * Structured geometry stays editable across resize; native paints are a current
 * size snapshot. Renderers can quantize alpha differently from browser CSS.
 */
import {
  parseCssLinearDirection,
  cssLinearVector,
  normalizeCssLinear,
  validateCssLinearInterpolation,
} from "./linear-gradient-geometry.mjs";
const fail = (message) => {
  throw new Error(message);
};
const split = (value) => {
  const parts = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "(") depth++;
    if (value[i] === ")" && --depth < 0) fail("背景括号无效");
    if (value[i] === "," && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (depth) fail("背景括号无效");
  parts.push(value.slice(start).trim());
  return parts;
};
const numeric = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/u;
function cssColor(value) {
  if (value === "transparent") return { color: "#000000", opacity: 0 };
  const match = /^rgba?\(([^()]*)\)$/u.exec(value);
  if (!match) fail("仅支持计算后的 sRGB rgb/rgba 颜色");
  const parts = match[1].trim().split(/[\s,/]+/u);
  if (parts.length < 3 || parts.length > 4 || parts.some((part) => !numeric.test(part)))
    fail("颜色通道格式不受支持");
  const channels = parts.slice(0, 3).map(Number),
    opacity = Number(parts[3] ?? 1);
  if (channels.some((v) => !Number.isInteger(v) || v < 0 || v > 255) || opacity < 0 || opacity > 1)
    fail("颜色超出八位 sRGB/透明度范围");
  return { color: `#${channels.map((v) => v.toString(16).padStart(2, "0")).join("")}`, opacity };
}
function linear(value, width, height) {
  const match = /^linear-gradient\((.*)\)$/u.exec(value);
  if (!match) fail("仅支持非重复 linear-gradient；径向、锥形或重复渐变未转换");
  const parts = split(match[1]);
  const hasDirection = /^(?:to\s|[-+]?(?:\d|\.))/u.test(parts[0]);
  const direction = parseCssLinearDirection(hasDirection ? parts.shift() : "180deg");
  const vector = cssLinearVector(direction, width, height);
  const length = Math.abs(width * vector.x) + Math.abs(height * vector.y);
  if (!Number.isFinite(length) || length < 0.0001) fail("渐变绘制区域退化");
  const stops = [],
    authoredPositions = [];
  for (const part of parts) {
    const stop = /^(rgba?\([^()]*\)|transparent)(.*)$/u.exec(part);
    if (!stop) fail("颜色提示、插值色彩空间或复杂色标未转换");
    const color = cssColor(stop[1]);
    const positions = stop[2].trim() ? stop[2].trim().split(/\s+/u) : [null];
    if (positions.length > 2) fail("渐变色标位置过多");
    for (const position of positions) {
      const parsed =
        position === null ? null : /^([-+]?(?:\d+(?:\.\d*)?|\.\d+))(%|px)?$/u.exec(position);
      if (position !== null && (!parsed || (!parsed[2] && Number(parsed[1]) !== 0)))
        fail("色标仅支持像素、百分比或零；calc/其他单位未转换");
      const resolved = parsed ? Number(parsed[1]) / (parsed[2] === "%" ? 100 : length) : null;
      if (resolved !== null && !Number.isFinite(resolved)) fail("色标位置超出数值范围");
      stops.push({ ...color, position: resolved });
      authoredPositions.push(
        parsed ? { unit: parsed[2] === "%" ? "percent" : "px", value: Number(parsed[1]) } : null,
      );
    }
  }
  if (stops.length < 2 || stops.length > 16) fail("渐变必须有 2–16 个色标");
  // CSS Images §3.4.3: default endpoints, clamp decreasing positions, distribute omissions.
  stops[0].position ??= 0;
  stops.at(-1).position ??= 1;
  let previous = -Infinity;
  for (const stop of stops)
    if (stop.position !== null) {
      stop.position = Math.max(previous, stop.position);
      previous = stop.position;
    }
  for (let i = 0; i < stops.length - 1; i++) {
    let next = i + 1;
    while (stops[next].position === null) next++;
    for (let j = i + 1; j < next; j++)
      stops[j].position =
        stops[i].position + ((stops[next].position - stops[i].position) * (j - i)) / (next - i);
    i = next - 1;
  }
  // Existing native paints interpolate RGB independently of alpha. CSS uses
  // premultiplied RGBA; same-color fades and constant-alpha spans are exact.
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i],
      b = stops[i + 1];
    if (a.position === b.position || a.opacity === b.opacity || a.color === b.color) continue;
    if (a.opacity === 0 && b.opacity > 0) a.color = b.color;
    else if (b.opacity === 0 && a.opacity > 0) b.color = a.color;
    else fail("不同颜色且透明度变化的 CSS 预乘插值无法由当前原生渐变无损表示");
  }
  // A transparent interior stop can require two different colors at one point.
  // Retain each adjacent span independently using a duplicate zero-alpha stop.
  for (let i = 1; i < stops.length - 1; i++) {
    if (
      stops[i].opacity !== 0 ||
      stops[i - 1].opacity === 0 ||
      stops[i + 1].opacity === 0 ||
      stops[i - 1].color === stops[i + 1].color
    )
      continue;
    const stop = stops[i];
    stop.color = stops[i - 1].color;
    stops.splice(i + 1, 0, { ...stop, color: stops[i + 1].color });
    authoredPositions.splice(i + 1, 0, "previous");
    i++;
  }
  if (stops.length > 16) fail("透明色标展开后超过 16 项");
  const start = Math.min(0, stops[0].position),
    end = Math.max(1, stops.at(-1).position);
  const point = (t, perpendicular = 0) => ({
    x: 0.5 + ((t - 0.5) * length * vector.x - perpendicular * length * vector.y) / width,
    y: 0.5 + ((t - 0.5) * length * vector.y + perpendicular * length * vector.x) / height,
  });
  const handles = [point(start), point(end), point(start, (end - start) / 2)];
  if (
    handles.some(
      (p) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        Math.abs(p.x) > 100 ||
        Math.abs(p.y) > 100,
    )
  )
    fail("渐变控制点超出原生范围");
  const cssLinear = normalizeCssLinear({ direction, positions: authoredPositions }, stops);
  validateCssLinearInterpolation(cssLinear, stops);
  return {
    type: "GRADIENT_LINEAR",
    opacity: 1,
    handles,
    stops: stops.map((stop) => ({ ...stop, position: (stop.position - start) / (end - start) })),
    cssLinear,
  };
}

/** Computed CSS is retained at the integration boundary before upstream loses stop units. */
export function cssLinearBackgroundPaints(style, width, height) {
  if (!(width > 0 && height > 0)) fail("渐变绘制区域必须大于零");
  if (typeof style?.["background-image"] !== "string" || style["background-image"].length > 16000)
    fail("缺少有界原始 CSS 渐变，不能从上游已丢失单位的色标猜测");
  const images = split(style["background-image"]);
  if (images.length > 8) fail("背景最多八层");
  const perLayer = (property, index, fallback) => {
    const values = split(String(style[property] ?? fallback));
    return values[index % values.length];
  };
  const paints = [];
  const base = cssColor(style["background-color"] ?? "transparent");
  if (base.opacity > 0) paints.push({ type: "SOLID", ...base });
  for (let i = images.length - 1; i >= 0; i--) {
    if (images[i] === "none") continue;
    if (
      perLayer("background-size", i, "auto") !== "auto" &&
      perLayer("background-size", i, "auto") !== "auto auto"
    )
      fail("自定义背景尺寸的渐变未转换");
    if (
      !/^(?:[-+]?(?:\d+(?:\.\d*)?|\.\d+)%|0(?:px)?)(?:\s+(?:[-+]?(?:\d+(?:\.\d*)?|\.\d+)%|0(?:px)?))?$/u.test(
        perLayer("background-position", i, "0% 0%"),
      )
    )
      fail("带像素偏移的渐变背景位置未转换");
    if (perLayer("background-blend-mode", i, "normal") !== "normal") fail("背景混合模式未转换");
    if (perLayer("background-attachment", i, "scroll") !== "scroll") fail("固定或局部背景未转换");
    const origin = perLayer("background-origin", i, "padding-box");
    if (
      origin !== "border-box" &&
      (origin !== "padding-box" ||
        ["top", "right", "bottom", "left"].some(
          (side) => parseFloat(style[`border-${side}-width`] ?? "0") !== 0,
        ))
    )
      fail("非完整容器的渐变原点未转换");
    if (perLayer("background-clip", i, "border-box") !== "border-box") fail("渐变背景裁剪未转换");
    paints.push(linear(images[i], width, height));
  }
  if (!paints.length || paints.length > 8) fail("背景绘制层数超出 1–8 层范围");
  return paints;
}
