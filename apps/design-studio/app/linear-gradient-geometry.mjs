/* Structured CSS geometry only; no CSS execution, DOM, network or paint colors. */
const object = (v) => v && typeof v === "object" && !Array.isArray(v);
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const keys = (v, allowed) => {
  if (!object(v) || Object.keys(v).some((key) => !allowed.includes(key)))
    throw new Error("CSS 渐变几何包含未知字段");
};
export function normalizeCssLinear(value, stops) {
  keys(value, ["direction", "positions", "sourceOnly"]);
  const direction = value.direction;
  keys(direction, ["angle", "corner"]);
  let normalized;
  if (Object.keys(direction).length !== 1) throw new Error("CSS 渐变方向必须唯一");
  if (direction.angle !== undefined) {
    if (!finite(direction.angle) || direction.angle < 0 || direction.angle >= 360)
      throw new Error("CSS 渐变角度必须为 0–360（不含 360）");
    normalized = { angle: direction.angle };
  } else {
    if (
      !Array.isArray(direction.corner) ||
      direction.corner.length !== 2 ||
      !Array.from(direction.corner).every((v) => v === -1 || v === 1)
    )
      throw new Error("CSS 渐变角方向必须为两个 ±1");
    normalized = { corner: [...direction.corner] };
  }
  if (value.sourceOnly !== undefined && value.sourceOnly !== true)
    throw new Error("CSS 渐变 sourceOnly 只能为 true");
  if (
    !Array.isArray(value.positions) ||
    value.positions.length < 2 ||
    value.positions.length > 16 ||
    (!value.sourceOnly && value.positions.length !== stops.length)
  )
    throw new Error("CSS 渐变位置必须为 2–16 项且与可编辑色标对应");
  const positions = Array.from(value.positions, (position, index) => {
    if (position === null) return null;
    if (position === "previous") {
      if (
        !index ||
        value.positions[index - 1] === "previous" ||
        (!value.sourceOnly && (stops[index].opacity !== 0 || stops[index - 1].opacity !== 0))
      )
        throw new Error("CSS 透明色标重复位置无效");
      return "previous";
    }
    keys(position, ["unit", "value"]);
    if (
      !["px", "percent"].includes(position.unit) ||
      !finite(position.value) ||
      Math.abs(position.value) > 20000
    )
      throw new Error("CSS 色标只支持有界 px/percent 坐标");
    return { unit: position.unit, value: position.value };
  });
  if (positions.filter((p) => p !== "previous").length < 2)
    throw new Error("CSS 渐变至少需要两个原始色标");
  return { direction: normalized, positions, ...(value.sourceOnly ? { sourceOnly: true } : {}) };
}
export function parseCssLinearDirection(value) {
  if (value.startsWith("to ")) {
    const words = value.slice(3).split(/\s+/u);
    if (
      !words.length ||
      words.length > 2 ||
      new Set(words).size !== words.length ||
      words.some((word) => !["top", "right", "bottom", "left"].includes(word))
    )
      throw new Error("渐变方向不受支持");
    const x = words.includes("right") ? 1 : words.includes("left") ? -1 : 0;
    const y = words.includes("bottom") ? 1 : words.includes("top") ? -1 : 0;
    if (words.length === 2 && (!x || !y)) throw new Error("渐变方向冲突");
    return x && y ? { corner: [x, y] } : { angle: x ? (x > 0 ? 90 : 270) : y > 0 ? 180 : 0 };
  }
  const match = /^([-+]?(?:\d+(?:\.\d*)?|\.\d+))(deg|grad|rad|turn)$/u.exec(value);
  if (!match) throw new Error("渐变角度不受支持");
  const degrees = Number(match[1]) * { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 }[match[2]];
  if (!finite(degrees) || Math.abs(degrees) > 3600000) throw new Error("渐变角度超出范围");
  return { angle: ((degrees % 360) + 360) % 360 };
}
export function cssLinearVector(direction, width, height) {
  if (direction.corner) {
    const diagonal = Math.hypot(width, height);
    return {
      x: (direction.corner[0] * height) / diagonal,
      y: (direction.corner[1] * width) / diagonal,
    };
  }
  const angle = (direction.angle * Math.PI) / 180;
  const snap = (v) =>
    Math.abs(v) < 1e-12 ? 0 : Math.abs(Math.abs(v) - 1) < 1e-12 ? Math.sign(v) : v;
  return { x: snap(Math.sin(angle)), y: snap(-Math.cos(angle)) };
}
export function resolveCssLinear(paint, width, height) {
  const intent = paint.cssLinear;
  if (!intent || intent.sourceOnly || !(width > 0 && height > 0) || ![width, height].every(finite))
    return paint;
  const vector = cssLinearVector(intent.direction, width, height);
  const length = Math.abs(width * vector.x) + Math.abs(height * vector.y);
  const primary = intent.positions.flatMap((p, index) =>
    p === "previous"
      ? []
      : [{ index, value: p === null ? null : p.value / (p.unit === "percent" ? 100 : length) }],
  );
  primary[0].value ??= 0;
  primary.at(-1).value ??= 1;
  let previous = -Infinity;
  for (const stop of primary)
    if (stop.value !== null) {
      stop.value = Math.max(previous, stop.value);
      previous = stop.value;
    }
  for (let i = 0; i < primary.length - 1; i++) {
    let next = i + 1;
    while (primary[next].value === null) next++;
    for (let j = i + 1; j < next; j++)
      primary[j].value =
        primary[i].value + ((primary[next].value - primary[i].value) * (j - i)) / (next - i);
    i = next - 1;
  }
  const values = [];
  for (const item of primary) values[item.index] = item.value;
  intent.positions.forEach((p, index) => {
    if (p === "previous") values[index] = values[index - 1];
  });
  const start = Math.min(0, values[0]),
    end = Math.max(1, values.at(-1));
  const point = (t, perpendicular = 0) => ({
    x: 0.5 + ((t - 0.5) * length * vector.x - perpendicular * length * vector.y) / width,
    y: 0.5 + ((t - 0.5) * length * vector.y + perpendicular * length * vector.x) / height,
  });
  return {
    ...paint,
    handles: [point(start), point(end), point(start, (end - start) / 2)],
    stops: paint.stops.map((stop, index) => ({
      ...stop,
      position: (values[index] - start) / (end - start),
    })),
  };
}
export function cssLinearNeedsNativeWarning(paint) {
  const intent = paint.cssLinear;
  return Boolean(
    intent &&
    (intent.sourceOnly ||
      (intent.direction.angle !== undefined && Math.abs(intent.direction.angle % 90) > 1e-9) ||
      intent.positions.some((p) => p && p.unit === "px" && p.value !== 0)),
  );
}
export function validateCssLinearInterpolation(intent, stops) {
  if (intent.sourceOnly) return;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1],
      b = stops[i],
      p = intent.positions[i - 1],
      q = intent.positions[i];
    const hard =
      q === "previous" ||
      (p &&
        q &&
        typeof p === "object" &&
        typeof q === "object" &&
        p.unit === q.unit &&
        p.value >= q.value);
    if (!hard && a.opacity !== b.opacity && a.color !== b.color)
      throw new Error("不同颜色且透明度变化的 CSS 预乘插值无法由当前原生渐变无损表示");
  }
}
