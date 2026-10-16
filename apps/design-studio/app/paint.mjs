/* Bounded editable paint stacks. Entries keep Figma's bottom-to-top order. */
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hex = (value) => typeof value === "string" && /^#[a-f\d]{6}$/iu.test(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const clamp = (value) => Math.max(0, Math.min(1, value));
const fmt = (value) => String(Math.round(value * 1000000) / 1000000 || 0);
const color = (value) =>
  `#${[value.r, value.g, value.b]
    .map((v) =>
      Math.round(clamp(v) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
const rgb = (value) =>
  [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error("绘制包含未知字段");
}
function alpha(value) {
  if (!finite(value) || value < 0 || value > 1) throw new Error("绘制透明度必须在 0–1 之间");
  return value;
}
export function gradientMatrix(handles) {
  const [a, b, c] = handles;
  return [
    [b.x - a.x, 2 * (c.x - a.x), 2 * a.x - c.x],
    [b.y - a.y, 2 * (c.y - a.y), 2 * a.y - c.y],
  ];
}
export function inverseGradientMatrix(handles) {
  const [[a, b, c], [d, e, f]] = gradientMatrix(handles),
    determinant = a * e - b * d;
  if (Math.abs(determinant) < 1e-8) throw new Error("线性渐变坐标不可逆");
  return [
    [e / determinant, -b / determinant, (b * f - e * c) / determinant],
    [-d / determinant, a / determinant, (d * c - a * f) / determinant],
  ];
}
export function normalizeDesignPaints(value) {
  if (!Array.isArray(value) || !value.length || value.length > 8)
    throw new Error("填充绘制必须为 1–8 层");
  return value.map((paint) => {
    keys(
      paint,
      paint?.type === "SOLID"
        ? ["type", "color", "opacity"]
        : ["type", "opacity", "handles", "stops"],
    );
    const opacity = alpha(paint.opacity);
    if (paint.type === "SOLID") {
      if (!hex(paint.color)) throw new Error("纯色绘制必须是六位十六进制颜色");
      return { type: "SOLID", color: paint.color.toLowerCase(), opacity };
    }
    if (
      paint.type !== "GRADIENT_LINEAR" ||
      !Array.isArray(paint.handles) ||
      paint.handles.length !== 3 ||
      !Array.isArray(paint.stops) ||
      paint.stops.length < 2 ||
      paint.stops.length > 16
    )
      throw new Error("仅支持有界纯色/线性渐变；渐变必须有三个控制点与 2–16 个色标");
    const handles = paint.handles.map((point) => {
      keys(point, ["x", "y"]);
      if (![point.x, point.y].every((v) => finite(v) && Math.abs(v) <= 100))
        throw new Error("渐变控制点超出范围");
      return { x: point.x, y: point.y };
    });
    inverseGradientMatrix(handles);
    const stops = paint.stops.map((stop) => {
      keys(stop, ["position", "color", "opacity"]);
      if (!hex(stop.color)) throw new Error("渐变色标颜色无效");
      return {
        position: alpha(stop.position),
        color: stop.color.toLowerCase(),
        opacity: alpha(stop.opacity),
      };
    });
    if (stops.some((stop, index) => index && stop.position < stops[index - 1].position))
      throw new Error("渐变色标必须按位置排序");
    return { type: "GRADIENT_LINEAR", opacity, handles, stops };
  });
}
export function gradientHandlesFromTransform(transform) {
  if (
    !Array.isArray(transform) ||
    transform.length !== 2 ||
    !transform.every((row) => Array.isArray(row) && row.length === 3 && row.every(finite))
  )
    throw new Error("渐变矩阵无效");
  const [[a, b, c], [d, e, f]] = transform,
    determinant = a * e - b * d;
  if (Math.abs(determinant) < 1e-8) throw new Error("渐变矩阵不可逆");
  const point = (x, y) => ({
    x: (e * (x - c) - b * (y - f)) / determinant,
    y: (-d * (x - c) + a * (y - f)) / determinant,
  });
  return [point(0, 0.5), point(1, 0.5), point(0, 1)];
}
export function figmaFillPaints(fills, warn = () => {}) {
  if (!Array.isArray(fills)) return null;
  const visible = fills.filter((paint) => paint?.visible !== false);
  if (
    !visible.length ||
    visible.length > 8 ||
    visible.some((paint) => !["SOLID", "GRADIENT_LINEAR"].includes(paint?.type))
  )
    return null;
  try {
    const paints = visible.map((paint) => {
      if (paint.blendMode && paint.blendMode !== "NORMAL")
        throw new Error("非 NORMAL 混合绘制需本地预览资源");
      const opacity = finite(paint.opacity) ? clamp(paint.opacity) : 1;
      if (paint.type === "SOLID")
        return {
          type: "SOLID",
          color: color(paint.color),
          opacity: opacity * (finite(paint.color?.a) ? clamp(paint.color.a) : 1),
        };
      const stops = paint.gradientStops?.map((stop) => ({
        position: stop.position,
        color: color(stop.color),
        opacity: finite(stop.color?.a) ? clamp(stop.color.a) : 1,
      }));
      const handles =
        paint.gradientHandlePositions ?? gradientHandlesFromTransform(paint.gradientTransform);
      try {
        inverseGradientMatrix(handles);
      } catch {
        if (!stops?.length) throw new Error("缺少渐变色标");
        warn("退化线性渐变没有可逆控制点；按零长度渐变的末色标保留，不猜测方向。");
        const last = stops.at(-1);
        return { type: "SOLID", color: last.color, opacity: opacity * last.opacity };
      }
      return { type: "GRADIENT_LINEAR", opacity, handles, stops };
    });
    return normalizeDesignPaints(paints);
  } catch (error) {
    warn(`绘制无法无损转换：${error.message}`);
    return null;
  }
}
export function designFillPaints(node) {
  return (
    node.fillPaints ?? (hex(node.fill) ? [{ type: "SOLID", color: node.fill, opacity: 1 }] : [])
  );
}
export function hasVisibleDesignFill(node) {
  return designFillPaints(node).some(
    (paint) =>
      paint.opacity > 0 && (paint.type === "SOLID" || paint.stops.some((stop) => stop.opacity > 0)),
  );
}
export function compositePaintPixel(front, back) {
  const a = front.alpha + back.alpha * (1 - front.alpha);
  if (a <= 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
  return {
    red: (front.red * front.alpha + back.red * back.alpha * (1 - front.alpha)) / a,
    green: (front.green * front.alpha + back.green * back.alpha * (1 - front.alpha)) / a,
    blue: (front.blue * front.alpha + back.blue * back.alpha * (1 - front.alpha)) / a,
    alpha: a,
  };
}
function stopPixel(stop) {
  const [red, green, blue] = rgb(stop.color);
  return { red, green, blue, alpha: stop.opacity };
}
export function sampleDesignFill(node, point = { x: 0.5, y: 0.5 }) {
  let pixel = { red: 0, green: 0, blue: 0, alpha: 0 };
  for (const paint of designFillPaints(node)) {
    let current;
    if (paint.type === "SOLID") {
      const [red, green, blue] = rgb(paint.color);
      current = { red, green, blue, alpha: 1 };
    } else {
      const matrix = inverseGradientMatrix(paint.handles),
        t = matrix[0][0] * point.x + matrix[0][1] * point.y + matrix[0][2];
      const rightIndex = paint.stops.findIndex((stop) => stop.position >= t);
      if (rightIndex <= 0)
        current = stopPixel(rightIndex === 0 ? paint.stops[0] : paint.stops.at(-1));
      else {
        const left = paint.stops[rightIndex - 1],
          right = paint.stops[rightIndex],
          fraction = (t - left.position) / (right.position - left.position || 1);
        const a = stopPixel(left),
          b = stopPixel(right),
          alpha = a.alpha + (b.alpha - a.alpha) * fraction;
        current = {
          alpha,
          ...Object.fromEntries(
            ["red", "green", "blue"].map((key) => [key, a[key] + (b[key] - a[key]) * fraction]),
          ),
        };
      }
    }
    pixel = compositePaintPixel({ ...current, alpha: current.alpha * paint.opacity }, pixel);
  }
  return pixel;
}
export function representativeDesignFill(paints) {
  const pixel = sampleDesignFill({ fillPaints: paints });
  return pixel.alpha <= 0 ? "transparent" : color({ r: pixel.red, g: pixel.green, b: pixel.blue });
}
export function designPaintSvg(node, id) {
  if (typeof id !== "string" || !/^[a-z][a-z0-9_-]{0,159}$/iu.test(id))
    throw new Error("SVG 绘制 ID 必须安全且唯一");
  const paints = designFillPaints(node);
  if (!node.fillPaints) return { attributes: `fill="${node.fill}"`, definitions: [] };
  const definitions = [];
  const attributes = paints.map((paint, index) => {
    if (paint.type === "SOLID") return `fill="${paint.color}" fill-opacity="${fmt(paint.opacity)}"`;
    const [[a, b, c], [d, e, f]] = gradientMatrix(paint.handles),
      gradientId = `${id}-${index}`;
    const transform = [
      node.width * a,
      node.height * d,
      node.width * b,
      node.height * e,
      node.x + node.width * c,
      node.y + node.height * f,
    ]
      .map(fmt)
      .join(" ");
    definitions.push(
      `<linearGradient id="${gradientId}" gradientUnits="userSpaceOnUse" x1="0" y1="0.5" x2="1" y2="0.5" gradientTransform="matrix(${transform})" color-interpolation="sRGB">${paint.stops.map((stop) => `<stop offset="${fmt(stop.position)}" stop-color="${stop.color}" stop-opacity="${fmt(stop.opacity)}"/>`).join("")}</linearGradient>`,
    );
    return `fill="url(#${gradientId})" fill-opacity="${fmt(paint.opacity)}"`;
  });
  if (attributes.length === 1) return { attributes: attributes[0], definitions };
  const box = `x="${fmt(node.x)}" y="${fmt(node.y)}" width="${fmt(node.width)}" height="${fmt(node.height)}"`;
  definitions.push(
    `<pattern id="${id}-stack" patternUnits="userSpaceOnUse" ${box} viewBox="${fmt(node.x)} ${fmt(node.y)} ${fmt(node.width)} ${fmt(node.height)}">${attributes.map((fill) => `<rect ${box} ${fill}/>`).join("")}</pattern>`,
  );
  return { attributes: `fill="url(#${id}-stack)"`, definitions };
}
export function designPaintCssImage(node) {
  const local = { ...node, x: 0, y: 0 },
    paint = designPaintSvg(local, "paint");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(node.width)}" height="${fmt(node.height)}"><defs>${paint.definitions.join("")}</defs><rect width="100%" height="100%" ${paint.attributes}/></svg>`;
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}
export function designPaintsToFigma(node) {
  return designFillPaints(node).map((paint) =>
    paint.type === "SOLID"
      ? {
          type: "SOLID",
          color: Object.fromEntries(
            ["r", "g", "b"].map((key, index) => [key, rgb(paint.color)[index]]),
          ),
          opacity: paint.opacity,
        }
      : {
          type: "GRADIENT_LINEAR",
          opacity: paint.opacity,
          gradientTransform: inverseGradientMatrix(paint.handles),
          gradientStops: paint.stops.map((stop) => ({
            position: stop.position,
            color: {
              ...Object.fromEntries(
                ["r", "g", "b"].map((key, index) => [key, rgb(stop.color)[index]]),
              ),
              a: stop.opacity,
            },
          })),
        },
  );
}
