/* Solid side paints only. No imported paths or CSS execution. */
import { effectiveCornerRadii } from "./corner-radii.mjs";

export const STROKE_SIDES = Object.freeze(["top", "right", "bottom", "left"]);
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const hex = (v) => typeof v === "string" && /^#[a-f\d]{6}$/iu.test(v);
const rectTypes = ["frame", "rectangle", "component"];
export function normalizeStrokeSides(value) {
  if (!Array.isArray(value) || value.length !== 4)
    throw new Error("strokeSides 必须为上右下左四项");
  return Array.from(value, (side) => {
    if (
      !side ||
      typeof side !== "object" ||
      Array.isArray(side) ||
      Object.keys(side).some((k) => !["width", "color", "opacity"].includes(k)) ||
      !finite(side.width) ||
      side.width < 0 ||
      side.width > 100 ||
      !hex(side.color) ||
      !finite(side.opacity) ||
      side.opacity < 0 ||
      side.opacity > 1
    )
      throw new Error("边框只支持 0–100px、六位 RGB 与 0–1 透明度的有界实线侧边");
    return { width: side.width, color: side.color.toLowerCase(), opacity: side.opacity };
  });
}
export function designStrokeSides(node) {
  return (
    node.strokeSides ??
    Array.from({ length: 4 }, () => ({
      width: node.strokeWidth ?? 0,
      color: hex(node.stroke) ? node.stroke : "#000000",
      opacity: hex(node.stroke) ? 1 : 0,
    }))
  );
}
const uniform = (sides) =>
  sides.every(
    (s) =>
      s.width === sides[0].width &&
      (!s.width || (s.opacity === sides[0].opacity && (!s.opacity || s.color === sides[0].color))),
  );
export function validateDesignStroke(node) {
  if (node.strokeAlign !== undefined && !["inside", "center", "outside"].includes(node.strokeAlign))
    throw new Error("strokeAlign 只支持 inside/center/outside");
  const sides = node.strokeSides === undefined ? null : normalizeStrokeSides(node.strokeSides);
  if (
    (node.strokeSides !== undefined || node.strokeAlign !== undefined) &&
    !rectTypes.includes(node.type)
  )
    throw new Error("独立边框/对齐暂只适用于矩形与 Frame 表面");
  if (sides && !uniform(sides) && effectiveCornerRadii(node).some((r) => r > 0))
    throw new Error("不同侧边的圆角接合暂不能无损保留；请使用方角或统一边框");
  if (
    sides?.some(
      (side, i) =>
        side.width > 0 &&
        sides[(i + 1) % 4].width > 0 &&
        side.opacity !== sides[(i + 1) % 4].opacity,
    )
  )
    throw new Error("相接侧边的不同透明度暂不能保留；请使用相同透明度或不相接的侧边");
}
export const hasDesignStroke = (node) =>
  node.strokeSides !== undefined || node.strokeAlign !== undefined;
export function designStrokeOutset(node) {
  const factor = node.strokeAlign === "inside" ? 0 : node.strokeAlign === "outside" ? 1 : 0.5;
  return Math.max(
    0,
    ...designStrokeSides(node)
      .filter((s) => s.opacity > 0)
      .map((s) => s.width * factor),
  );
}
export function editDesignStrokeColor(node, color) {
  if (!node.strokeSides) {
    node.stroke = color;
    return;
  }
  const invisible = node.strokeSides.filter((s) => s.width > 0).every((s) => s.opacity === 0);
  const sides = node.strokeSides.map((s) => ({
    ...s,
    ...(color === "transparent" ? { opacity: 0 } : { color, opacity: invisible ? 1 : s.opacity }),
  }));
  validateDesignStroke({ ...node, stroke: color, strokeSides: sides });
  node.stroke = color;
  node.strokeSides = sides;
  if (color !== "transparent" && !node.strokeWidth)
    node.strokeWidth = Math.max(...sides.map((s) => s.width));
}
export function editDesignStrokeWidth(node, width) {
  if (!node.strokeSides) {
    node.strokeWidth = width;
    return;
  }
  const maximum = Math.max(...node.strokeSides.map((s) => s.width));
  const sides = node.strokeSides.map((s) => ({
    ...s,
    width: maximum ? (s.width / maximum) * width : width,
  }));
  validateDesignStroke({ ...node, strokeWidth: width, strokeSides: sides });
  node.strokeWidth = width;
  node.strokeSides = sides;
}
const fmt = (v) => String(Math.round(v * 1e6) / 1e6 || 0);
function outline(box, radii) {
  const [tl, tr, br, bl] = radii,
    x = box.x,
    y = box.y,
    right = x + box.width,
    bottom = y + box.height;
  const arc = ([rx, ry], ex, ey) =>
    rx > 0 && ry > 0
      ? `A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(ex)} ${fmt(ey)}`
      : `L${fmt(ex)} ${fmt(ey)}`;
  return `M${fmt(x + tl[0])} ${fmt(y)} H${fmt(right - tr[0])} ${arc(tr, right, y + tr[1])} V${fmt(bottom - br[1])} ${arc(br, right - br[0], bottom)} H${fmt(x + bl[0])} ${arc(bl, x, bottom - bl[1])} V${fmt(y + tl[1])} ${arc(tl, x + tl[0], y)} Z`;
}
export function designStrokePaths(node) {
  const sides = designStrokeSides(node),
    [t, r, b, l] = sides.map((s) => s.width);
  const f = node.strokeAlign === "inside" ? 0 : node.strokeAlign === "outside" ? 1 : 0.5,
    g = 1 - f;
  const outer = {
    x: node.x - l * f,
    y: node.y - t * f,
    width: node.width + (l + r) * f,
    height: node.height + (t + b) * f,
  };
  const inner = {
    x: node.x + l * g,
    y: node.y + t * g,
    width: Math.max(0, node.width - (l + r) * g),
    height: Math.max(0, node.height - (t + b) * g),
  };
  if (!inner.width) inner.x = node.x + (node.width * l) / (l + r || 1);
  if (!inner.height) inner.y = node.y + (node.height * t) / (t + b || 1);
  if (uniform(sides)) {
    const s = sides[0];
    if (!s.width || !s.opacity) return [];
    const radii = effectiveCornerRadii(node);
    const out = radii.map((radius) => [
      radius ? radius + s.width * f : 0,
      radius ? radius + s.width * f : 0,
    ]);
    const ins = radii.map((radius) => [
      Math.max(0, radius - s.width * g),
      Math.max(0, radius - s.width * g),
    ]);
    return [
      {
        path: outline(outer, out) + (inner.width && inner.height ? " " + outline(inner, ins) : ""),
        color: s.color,
        opacity: s.opacity,
        rule: "evenodd",
      },
    ];
  }
  const output = [];
  const polygon = (points, side) => {
    if (side.width && side.opacity)
      output.push({
        path: points.map(([x, y], j) => `${j ? "L" : "M"}${fmt(x)} ${fmt(y)}`).join(" ") + " Z",
        color: side.color,
        opacity: side.opacity,
        rule: "nonzero",
      });
  };
  const rect = (x, y, w, h, side) => {
    if (w > 0 && h > 0)
      polygon(
        [
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
        ],
        side,
      );
  };
  const ox = outer.x,
    oy = outer.y,
    or = ox + outer.width,
    ob = oy + outer.height,
    ix = inner.x,
    iy = inner.y,
    ir = ix + inner.width,
    ib = iy + inner.height;
  rect(ix, oy, inner.width, iy - oy, sides[0]);
  rect(ir, iy, or - ir, inner.height, sides[1]);
  rect(ix, ib, inner.width, ob - ib, sides[2]);
  rect(ox, iy, ix - ox, inner.height, sides[3]);
  // Base each corner with one adjacent color, then cover its triangle with the
  // other. Coverage interpolates colors without exposing the background seam.
  if (ix > ox && iy > oy) {
    rect(ox, oy, ix - ox, iy - oy, sides[3]);
    polygon(
      [
        [ox, oy],
        [ix, oy],
        [ix, iy],
      ],
      sides[0],
    );
  }
  if (or > ir && iy > oy) {
    rect(ir, oy, or - ir, iy - oy, sides[1]);
    polygon(
      [
        [ir, oy],
        [or, oy],
        [ir, iy],
      ],
      sides[0],
    );
  }
  if (or > ir && ob > ib) {
    rect(ir, ib, or - ir, ob - ib, sides[1]);
    polygon(
      [
        [ir, ib],
        [or, ob],
        [ir, ob],
      ],
      sides[2],
    );
  }
  if (ix > ox && ob > ib) {
    rect(ox, ib, ix - ox, ob - ib, sides[3]);
    polygon(
      [
        [ix, ib],
        [ix, ob],
        [ox, ob],
      ],
      sides[2],
    );
  }
  return output;
}
export function designStrokeSvg(node) {
  const parts = designStrokePaths(node),
    common = parts.every((s) => s.opacity === parts[0]?.opacity),
    opacity = common ? (parts[0]?.opacity ?? 1) : 1;
  return (
    `<g opacity="${opacity}">` +
    parts
      .map(
        (s) =>
          `<path d="${s.path}" fill="${s.color}" fill-opacity="${common ? 1 : s.opacity}" fill-rule="${s.rule}"/>`,
      )
      .join("") +
    "</g>"
  );
}
export function nativeDesignStroke(node) {
  validateDesignStroke(node);
  const sides = designStrokeSides(node),
    active = sides.filter((s) => s.width > 0);
  const color = active[0] ?? { color: "#000000", opacity: 0 };
  if (
    active.some(
      (s) =>
        (s.opacity || color.opacity) && (s.color !== color.color || s.opacity !== color.opacity),
    )
  )
    throw new Error("Figma 原生侧边只支持同一颜色/透明度；多色边框请保留 v3 源文档，不能无损导出");
  return {
    align: (node.strokeAlign ?? "center").toUpperCase(),
    weights: sides.map((s) => s.width),
    paint: {
      type: "SOLID",
      color: Object.fromEntries(
        ["r", "g", "b"].map((key, i) => [
          key,
          parseInt(color.color.slice(1 + i * 2, 3 + i * 2), 16) / 255,
        ]),
      ),
      opacity: color.opacity,
    },
  };
}
export function figmaDesignStroke(source, node) {
  if (!rectTypes.includes(node.type)) return null;
  const paints = source.strokes?.filter((p) => p.visible !== false) ?? [];
  if (!paints.length) return null;
  if (source.dashPattern?.length) throw new Error("虚线描边暂不能保留为可编辑实线侧边");
  if (
    paints.length !== 1 ||
    paints[0].type !== "SOLID" ||
    (paints[0].blendMode && paints[0].blendMode !== "NORMAL")
  )
    return null;
  if (
    (source.strokeJoin && source.strokeJoin !== "MITER") ||
    (finite(source.strokeMiterLimit) && source.strokeMiterLimit < Math.SQRT2)
  )
    throw new Error("圆形/斜切描边接合暂不能保留；矩形侧边只支持直角 MITER 接合");
  const weights = STROKE_SIDES.map(
    (side) =>
      source[`stroke${side[0].toUpperCase() + side.slice(1)}Weight`] ??
      source.individualStrokeWeights?.[side] ??
      source.strokeWeight ??
      0,
  );
  const raw = paints[0],
    opacity = (raw.opacity ?? 1) * (raw.color?.a ?? 1);
  if (
    ![raw.color?.r, raw.color?.g, raw.color?.b, opacity].every((v) => finite(v) && v >= 0 && v <= 1)
  )
    throw new Error("原生边框颜色/透明度无效");
  if (!weights.some((w) => w > 0)) return null;
  const color =
    "#" +
    [raw.color.r, raw.color.g, raw.color.b]
      .map((v) =>
        Math.round(v * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  const align = source.strokeAlign ?? "CENTER";
  if (
    align === "CENTER" &&
    weights.every((w) => w === weights[0]) &&
    opacity === 1 &&
    source.strokesIncludedInLayout !== true
  )
    return null;
  const result = {
    strokeAlign: align.toLowerCase(),
    strokeSides: normalizeStrokeSides(weights.map((width) => ({ width, color, opacity }))),
  };
  validateDesignStroke({ ...node, ...result });
  return result;
}
