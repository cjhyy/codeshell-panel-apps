/* Empty native paint arrays retain style without becoming painted geometry. */
const sides = ["top", "right", "bottom", "left"];
const types = ["frame", "component", "rectangle", "text"];
const finite = (value) => Number.isFinite(value) && value >= 0 && value <= 100;
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);

export function normalizeNativeStrokeInactive(value, node) {
  if (
    !object(value) ||
    !Object.keys(value).some((key) => key !== "sourceOnly") ||
    Object.keys(value).some(
      (key) =>
        ![
          "strokeAlign",
          "strokeWeight",
          "individualStrokeWeights",
          "strokesIncludedInLayout",
          "strokesIncludedInLayoutDefault",
          "sourceOnly",
        ].includes(key),
    )
  )
    throw Error("空描边样式包含未知字段或缺少来源样式");
  if (
    value.strokeAlign !== undefined &&
    !["INSIDE", "CENTER", "OUTSIDE"].includes(value.strokeAlign)
  )
    throw Error("空描边对齐无效");
  if (value.strokeWeight !== undefined && !finite(value.strokeWeight))
    throw Error("空描边宽度必须为 0–100");
  if (
    value.individualStrokeWeights !== undefined &&
    (!object(value.individualStrokeWeights) ||
      Object.keys(value.individualStrokeWeights).length !== 4 ||
      !sides.every((side) => finite(value.individualStrokeWeights[side])))
  )
    throw Error("空描边侧宽必须为完整的上右下左 0–100 数值");
  if (
    value.strokesIncludedInLayout !== undefined &&
    typeof value.strokesIncludedInLayout !== "boolean"
  )
    throw Error("空描边布局选择必须为布尔值");
  if (
    value.strokesIncludedInLayoutDefault !== undefined &&
    (value.strokesIncludedInLayoutDefault !== false || value.strokesIncludedInLayout !== undefined)
  )
    throw Error("空描边 REST 默认只支持独立保存的 false");
  if (value.sourceOnly !== undefined && value.sourceOnly !== true)
    throw Error("空描边 sourceOnly 只能为 true");
  if (
    value.individualStrokeWeights &&
    value.strokeWeight !== undefined &&
    sides.some((side) => value.individualStrokeWeights[side] !== value.strokeWeight) &&
    value.sourceOnly !== true
  )
    throw Error("混合侧宽与标量宽度不一致，必须保留为仅来源样式");
  if (
    node &&
    (!types.includes(node.type) ||
      node.stroke !== "transparent" ||
      node.strokeWidth !== 0 ||
      node.strokeSides !== undefined ||
      node.strokeAlign !== undefined ||
      node.strokeLayoutExcluded !== undefined ||
      (value.individualStrokeWeights !== undefined && node.type === "text") ||
      ((value.strokesIncludedInLayout !== undefined ||
        value.strokesIncludedInLayoutDefault !== undefined) &&
        !["frame", "component"].includes(node.type)))
  )
    throw Error("空描边样式只适用于无描边绘制的 Frame/Component/Rectangle/Text");
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, object(item) ? { ...item } : item]),
  );
}

export function captureNativeStrokeInactive(source, node) {
  if (!types.includes(node.type) || !Array.isArray(source.strokes) || source.strokes.length)
    return null;
  const value = {};
  for (const key of [
    "strokeAlign",
    "strokeWeight",
    "individualStrokeWeights",
    "strokesIncludedInLayout",
  ])
    if (own(source, key)) value[key] = source[key];
  if (
    ["frame", "component"].includes(node.type) &&
    ["HORIZONTAL", "VERTICAL", "GRID"].includes(source.layoutMode) &&
    !own(source, "strokesIncludedInLayout")
  )
    value.strokesIncludedInLayoutDefault = false;
  if (!Object.keys(value).length) return null;
  if (
    ["strokeJoin", "strokeMiterLimit", "strokeCap", "dashPattern", "strokeGeometry"].some((key) =>
      own(source, key),
    )
  )
    value.sourceOnly = true;
  if (
    value.individualStrokeWeights &&
    value.strokeWeight !== undefined &&
    sides.some((side) => value.individualStrokeWeights[side] !== value.strokeWeight)
  )
    value.sourceOnly = true;
  return normalizeNativeStrokeInactive(value, node);
}

export function nativeInactiveStrokePlan(node) {
  const value = normalizeNativeStrokeInactive(node.nativeStrokeInactive, node);
  if (value.sourceOnly) throw Error("此空描边包含尚不能原生重建的特殊样式；请保留来源绑定");
  const manual =
    node.layoutReverse ||
    node.layoutWrap === "wrap-reverse" ||
    (node.layout === "vertical" && node.layoutWrap === "wrap");
  if (
    (value.strokesIncludedInLayout !== undefined ||
      value.strokesIncludedInLayoutDefault !== undefined) &&
    (manual || !["horizontal", "vertical", "grid"].includes(node.layout))
  )
    throw Error("自由布局中的描边布局选择尚不能安全重建；请保留来源绑定，不猜测原生布局状态");
  return value;
}

export const inactiveStrokeWidth = (node) =>
  node.nativeStrokeInactive?.individualStrokeWeights
    ? Math.max(...sides.map((side) => node.nativeStrokeInactive.individualStrokeWeights[side]))
    : node.nativeStrokeInactive
      ? node.nativeStrokeInactive.strokeWeight
      : node.strokeWidth;
export const strokeAlignment = (node) =>
  node.nativeStrokeInactive?.strokeAlign?.toLowerCase() ?? node.strokeAlign ?? "center";

const weights = (value) =>
  value.individualStrokeWeights
    ? sides.map((side) => value.individualStrokeWeights[side])
    : Array(4).fill(value.strokeWeight);
const activeWeights = (node) =>
  node.strokeSides ? node.strokeSides.map((side) => side.width) : Array(4).fill(node.strokeWidth);
const auto = (node) =>
  ["frame", "component"].includes(node.type) &&
  ["horizontal", "vertical", "grid"].includes(node.layout);
function adjustPadding(next, previous, widths, sign, changes) {
  for (const [index, side] of ["Top", "Right", "Bottom", "Left"].entries()) {
    const key = `padding${side}`;
    if (own(changes, key) || own(changes, "padding")) continue;
    const value = (previous[key] ?? previous.padding ?? 0) + sign * widths[index];
    if (!Number.isFinite(value) || value < 0 || value > 2000)
      throw Error("描边切换后的内容缩进超出 0–2000；请先调整缩进");
    next[key] = value;
  }
}

/** Returns a draft; caller validates its complete native/layout plan before commit. */
export function planNativeStrokeEdit(node, changes) {
  if (
    changes.stroke !== undefined &&
    changes.stroke !== "transparent" &&
    !(typeof changes.stroke === "string" && /^#[a-f\d]{6}$/iu.test(changes.stroke))
  )
    throw Error("描边颜色必须为六位 RGB 或透明");
  const next = { ...node, ...changes };
  if (own(changes, "padding"))
    for (const side of ["Top", "Right", "Bottom", "Left"])
      if (!own(changes, `padding${side}`)) delete next[`padding${side}`];
  if (changes.nativeStrokeInactive === null) delete next.nativeStrokeInactive;
  if (node.nativeStrokeInactive && changes.nativeStrokeInactive !== null) {
    const value = normalizeNativeStrokeInactive(
      changes.nativeStrokeInactive ?? node.nativeStrokeInactive,
      node,
    );
    if (node.nativeStrokeInactive.sourceOnly) value.sourceOnly = true;
    if (changes.strokeAlign !== undefined) {
      if (changes.strokeAlign === null) delete value.strokeAlign;
      else value.strokeAlign = String(changes.strokeAlign).toUpperCase();
    }
    if (changes.strokeWidth !== undefined) {
      if (!finite(changes.strokeWidth)) throw Error("描边宽度必须为 0–100");
      if (value.individualStrokeWeights) {
        const maximum = Math.max(...Object.values(value.individualStrokeWeights));
        value.individualStrokeWeights = Object.fromEntries(
          sides.map((side) => [
            side,
            maximum
              ? (value.individualStrokeWeights[side] / maximum) * changes.strokeWidth
              : changes.strokeWidth,
          ]),
        );
      }
      if (value.strokeWeight !== undefined || !value.individualStrokeWeights)
        value.strokeWeight = changes.strokeWidth;
    }
    if (own(changes, "strokeLayoutExcluded")) {
      value.strokesIncludedInLayout = changes.strokeLayoutExcluded !== true;
      delete value.strokesIncludedInLayoutDefault;
    }
    delete next.strokeAlign;
    delete next.strokeSides;
    delete next.strokeLayoutExcluded;
    next.stroke = "transparent";
    next.strokeWidth = 0;
    next.nativeStrokeInactive = value;
    const newSides = changes.strokeSides !== undefined && changes.strokeSides !== null;
    if (!newSides && (changes.stroke === undefined || changes.stroke === "transparent"))
      return next;
    if (value.sourceOnly)
      throw Error("此来源使用暂不支持的特殊描边，当前不能添加颜色；无描边状态和来源样式已保留");
    if (newSides) {
      if (node.type === "text") throw Error("文字暂不支持独立侧边描边");
      // An explicit side edit supplies new weights, but never invents missing alignment/inclusion.
      value.individualStrokeWeights = Object.fromEntries(
        sides.map((side, i) => [side, changes.strokeSides[i]?.width]),
      );
      delete value.strokeWeight;
    }
    if (!value.strokeAlign || (value.strokeWeight === undefined && !value.individualStrokeWeights))
      throw Error("来源缺少描边宽度或对齐；请先选择宽度和对齐，再添加颜色");
    if (node.type === "text" && value.strokeAlign !== "CENTER")
      throw Error("此文字描边使用内侧或外侧对齐；请先在描边对齐中选择居中，再添加颜色");
    const widths = weights(value),
      painted = widths.some((width) => width > 0);
    const included = value.strokesIncludedInLayout ?? value.strokesIncludedInLayoutDefault;
    const finalNativeAuto =
      auto(next) &&
      !next.layoutReverse &&
      next.layoutWrap !== "wrap-reverse" &&
      !(next.layout === "vertical" && next.layoutWrap === "wrap");
    if (included !== undefined && !finalNativeAuto)
      throw Error(
        "此自由布局来源保留了描边布局选择；请先改为 Auto Layout 模式，再添加颜色，避免丢弃来源样式",
      );
    if (auto(next) && painted && included === true && value.strokeAlign !== "INSIDE")
      throw Error("参与布局的内侧描边才能保留此布局；请先选择内侧对齐或排除描边布局");
    if (auto(next) && painted && value.strokeAlign === "INSIDE" && included === undefined)
      throw Error("来源没有描边布局选择；请先选择描边是否参与布局，再添加颜色");
    if (next.layout === "grid" && painted && value.strokeAlign === "INSIDE" && included === false)
      throw Error("Grid 排除内侧描边的激活尚未验证；请先选择参与布局或保留无描边状态");
    delete next.nativeStrokeInactive;
    next.stroke =
      changes.stroke ??
      changes.strokeSides?.find((side) => side.width && side.opacity)?.color ??
      "transparent";
    next.strokeWidth = Math.max(...widths);
    if (node.type !== "text") {
      next.strokeAlign = value.strokeAlign.toLowerCase();
      next.strokeSides = newSides
        ? changes.strokeSides
        : widths.map((width) => ({ width, color: changes.stroke, opacity: 1 }));
      if (auto(next) && value.strokeAlign === "INSIDE") {
        if (included === false) next.strokeLayoutExcluded = true;
        else if (included === true) adjustPadding(next, node, widths, 1, changes);
      }
    }
    return next;
  }
  if (
    changes.stroke === "transparent" &&
    types.includes(node.type) &&
    (node.stroke !== "transparent" || node.strokeSides !== undefined)
  ) {
    const widths = activeWeights(node),
      align = (node.strokeAlign ?? "center").toUpperCase();
    const value = { strokeAlign: align };
    if (widths.every((width) => width === widths[0])) value.strokeWeight = widths[0];
    else
      value.individualStrokeWeights = Object.fromEntries(sides.map((side, i) => [side, widths[i]]));
    if (auto(node))
      value.strokesIncludedInLayout = align === "INSIDE" && node.strokeLayoutExcluded !== true;
    if (auto(node) && align === "INSIDE" && value.strokesIncludedInLayout)
      adjustPadding(next, node, widths, -1, changes);
    next.stroke = "transparent";
    next.strokeWidth = 0;
    next.nativeStrokeInactive = value;
    delete next.strokeSides;
    delete next.strokeAlign;
    delete next.strokeLayoutExcluded;
    // Subtract the old painted widths first; requested latent edits describe the next activation.
    const latentChanges = Object.fromEntries(
      ["strokeWidth", "strokeAlign", "strokeLayoutExcluded"]
        .filter((key) => own(changes, key))
        .map((key) => [key, changes[key]]),
    );
    if (changes.strokeSides !== undefined && changes.strokeSides !== null) {
      next.nativeStrokeInactive.individualStrokeWeights = Object.fromEntries(
        sides.map((side, i) => [side, changes.strokeSides[i]?.width]),
      );
      delete next.nativeStrokeInactive.strokeWeight;
    }
    return Object.keys(latentChanges).length ? planNativeStrokeEdit(next, latentChanges) : next;
  }
  return null;
}
