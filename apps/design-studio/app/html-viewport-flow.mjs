/* Captured viewport relationships; no CSS inference from measured width alone. */
const css = (source, key) => String(source.cssLayout?.[key] ?? source.rawStyles?.[key] ?? "").trim().toLowerCase();
const zero = (value) => !value || value === "auto" || /^-?0(?:\.0+)?(?:px)?$/u.test(value);
const pixel = (value) => /^(?:0|\d+(?:\.\d+)?px)$/u.test(value);
const normalPosition = (values) => ["static", "relative"].includes(values.position) &&
  ["top", "right", "bottom", "left"].every((key) => zero(values[key]));

// Computed Typed OM resolves viewport lengths such as2vw to px. Inspect the
// authored, matching declarations as well before freezing ancestor box insets.
function fixedBoxDeclarations(element, document, window) {
  const spacing = /^(?:margin|padding)(?:-(?:top|right|bottom|left|inline(?:-start|-end)?|block(?:-start|-end)?))?$/u;
  const boxProperty = key => spacing.test(key) || /^border(?:-|$)/u.test(key) ||
    /^(?:all|(?:min-|max-)?(?:width|height|inline-size|block-size)|box-sizing|display|position|top|right|bottom|left|inset(?:-(?:inline|block)(?:-start|-end)?)?|float|transform|translate|rotate|scale|zoom|contain|content-visibility|writing-mode|direction|overflow(?:-x|-y|-inline|-block)?|scrollbar-(?:gutter|width))$/u.test(key);
  let rules = 0;
  const check = (style, conditional) => {
    if (style.length > 1024) return false;
    for (const key of style) {
      if (conditional && boxProperty(key)) return false;
      const value = style.getPropertyValue(key);
      if (key === "all" && !["initial", "unset"].includes(value)) return false;
      // A declared longhand with an empty CSSOM value can be a pending
      // shorthand substitution. Its computed px value does not prove fixed
      // authored intent, including for logical border shorthand families.
      if (boxProperty(key) && (!value || /\\|\b(?:var|env|attr)\(/iu.test(value))) return false;
    }
    for (const prefix of ["margin", "padding"]) for (const side of ["top", "right", "bottom", "left",
      "inline-start", "inline-end", "block-start", "block-end"]) {
      const value = style.getPropertyValue(`${prefix}-${side}`);
      if (!value || value === "auto" || value === "initial") continue;
      try {
        const length = window.CSSNumericValue.parse(value).to("px").value;
        if (!Number.isFinite(length) || length < 0 || length > 2000) return false;
      } catch { return false; }
    }
    return true;
  };
  const visit = (list, conditional, depth) => {
    if (depth > 16) return false;
    for (const rule of list) {
      if (++rules > 10000) return false;
      if (rule.selectorText) {
        if (rule.selectorText.length > 8192) return false;
        if (element.matches(rule.selectorText) && !check(rule.style, conditional)) return false;
      }
      if (rule.styleSheet && !visit(rule.styleSheet.cssRules, true, depth + 1)) return false;
      if (rule.cssRules && !visit(rule.cssRules, true, depth + 1)) return false;
    }
    return true;
  };
  try {
    const sheets = [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])];
    return sheets.length <= 64 && check(element.style, false) && sheets.every(sheet =>
      sheet.disabled || visit(sheet.cssRules, Boolean(sheet.media?.mediaText), 0));
  } catch { return false; }
}

// Root overflow propagates to the viewport. A reserved, unpainted gutter can
// become fixed viewport padding; a visible classic scrollbar cannot.
function viewportScroller(ancestor, style, document, window) {
  if (ancestor !== document.documentElement || document.compatMode !== "CSS1Compat" ||
      document.scrollingElement !== ancestor ||
      !["auto", "stable", "stable both-edges"].includes(style.scrollbarGutter) ||
      style.contain !== "none" ||
      ![style.overflowX, style.overflowY].every((value) => ["visible", "auto", "scroll"].includes(value)))
    return null;
  const values = [window.innerWidth, window.innerHeight, window.scrollX, window.scrollY,
    ancestor.clientWidth, ancestor.clientHeight, ancestor.scrollWidth, ancestor.scrollHeight,
    ancestor.scrollLeft, ancestor.scrollTop];
  if (!(values.every(Number.isFinite) && window.innerWidth > 0 && window.innerHeight > 0 &&
    ancestor.clientWidth === window.innerWidth && ancestor.clientHeight === window.innerHeight &&
    ancestor.scrollHeight >= ancestor.clientHeight &&
    window.scrollX === 0 && window.scrollY === 0 && ancestor.scrollLeft === 0 && ancestor.scrollTop === 0))
    return null;
  if (style.scrollbarGutter === "auto")
    return ancestor.scrollWidth === ancestor.clientWidth ? { left: 0, right: 0 } : null;
  const typed = ancestor.computedStyleMap?.(), box = ancestor.getBoundingClientRect();
  if (!typed || !["auto", "100%"].includes(typed.get("width")?.toString()) ||
      style.display !== "block" || style.direction !== "ltr" || style.writingMode !== "horizontal-tb" ||
      style.cssFloat !== "none" || style.visibility !== "visible" || style.contentVisibility !== "visible" ||
      !normalPosition(Object.fromEntries(["position", "top", "right", "bottom", "left"].map(key =>
        [key, typed.get(key)?.toString() ?? ""]))) ||
      style.transform !== "none" || style.perspective !== "none" ||
      [style.translate, style.rotate, style.scale].some(value => value !== "none") ||
      !["1", "normal"].includes(style.zoom) || style.backgroundImage !== "none" ||
      style.opacity !== "1" || style.filter !== "none" || style.boxShadow !== "none" || style.clipPath !== "none" ||
      !["auto", "0px"].includes(window.getComputedStyle(ancestor, "::-webkit-scrollbar").width) ||
      ![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width < 1)
    return null;
  if (!["auto", "0px", "0"].includes(typed.get("min-width")?.toString()) ||
      typed.get("max-width")?.toString() !== "none") return null;
  if (!fixedBoxDeclarations(ancestor, document, window)) return null;
  for (const side of ["top", "right", "bottom", "left"]) for (const prefix of ["padding", "margin"]) {
    const value = typed.get(`${prefix}-${side}`)?.toString();
    if (value !== "auto" && !pixel(value)) return null;
  }
  const margins = ["left", "right"].map(side => {
    const intent = typed.get(`margin-${side}`)?.toString();
    return intent === "auto" || pixel(intent) ? Number.parseFloat(style.getPropertyValue(`margin-${side}`)) : NaN;
  });
  if (margins.some(value => !Number.isFinite(value) || value < 0 || value > 2000)) return null;
  if (ancestor.scrollWidth !== box.width + margins[0] + margins[1]) return null;
  const left = box.left - margins[0], right = window.innerWidth - box.right - margins[1];
  if ([left, right].some(value => !Number.isFinite(value) || value < 0 || value > 2000) ||
      (style.scrollbarGutter === "stable" ? left !== 0 : left !== right)) return null;
  return { left, right };
}

/** Read only the root's containing-block relationship, before the converter normalizes its origin. */
export function captureHtmlViewportRelation(root) {
  const document = root.ownerDocument, window = document.defaultView;
  const rect = root.getBoundingClientRect();
  const result = { version: 1, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  const unsupported = (reason) => ({ ...result, unsupported: reason });
  if (![document.documentElement, document.body].includes(root) && root.parentElement !== document.body)
    return unsupported("选中的嵌套根缺少其完整包含块，视口保留测量几何。");
  const htmlStyle = window.getComputedStyle(document.documentElement);
  const gutter = htmlStyle.scrollbarGutter === "auto" ? null :
    viewportScroller(document.documentElement, htmlStyle, document, window);
  if (htmlStyle.scrollbarGutter !== "auto" && !gutter)
    return unsupported("根滚动条预留空间缺少无可见滚动条、无横向溢出的固定视口关系。");
  if (gutter && !fixedBoxDeclarations(root, document, window))
    return unsupported("根的间距依赖相对单位、变量或条件规则，不能冻结为视口固定内边距。");
  const ancestors = [];
  for (let parent = root.parentElement; parent; parent = parent.parentElement) ancestors.push(parent);
  let heightFromViewport = true;
  const transparent = (value) => value === "transparent" || /rgba\([^)]*,\s*0\)$/u.test(value);
  const htmlColor = window.getComputedStyle(document.documentElement).backgroundColor;
  const bodyColor = document.body && window.getComputedStyle(document.body).backgroundColor;
  const viewportColor = transparent(htmlColor) ? bodyColor : htmlColor;
  for (const ancestor of ancestors) {
    const style = window.getComputedStyle(ancestor), typed = ancestor.computedStyleMap?.();
    if (!typed) return unsupported("浏览器没有提供根包含块的 CSS 尺寸意图。");
    if (gutter && !fixedBoxDeclarations(ancestor, document, window))
      return unsupported("根的祖先间距依赖相对单位、变量或条件规则，不能冻结为视口固定内边距。");
    const values = Object.fromEntries(["position", "top", "right", "bottom", "left"].map((key) =>
      [key, typed.get(key)?.toString() ?? ""]));
    if (style.display !== "block" || !normalPosition(values) || style.transform !== "none" ||
        style.float !== "none" || style.writingMode !== "horizontal-tb" || style.direction !== "ltr")
      return unsupported("根的祖先包含布局、定位或变换，不能作为普通视口块流。");
    if (style.backgroundImage !== "none" ||
        (!transparent(style.backgroundColor) && style.backgroundColor !== viewportColor))
      return unsupported("选中根以外的祖先背景需要完整页面捕获。");
    if (style.opacity !== "1" || style.filter !== "none" || style.boxShadow !== "none" ||
        style.clipPath !== "none" || ["Top", "Right", "Bottom", "Left"].some((side) =>
          Number.parseFloat(style[`border${side}Width`]) > 0 && !transparent(style[`border${side}Color`])))
      return unsupported("祖先的边框或视觉效果不在选中子树中，需要完整页面捕获。");
    if (![style.overflowX, style.overflowY].every((value) => value === "visible") &&
        !viewportScroller(ancestor, style, document, window))
      return unsupported("选中根的祖先存在独立裁切或滚动边界，不能折叠为视口。");
    const width = typed.get("width")?.toString();
    heightFromViewport &&= typed.get("height")?.toString() === "100%";
    if (width !== "auto" && width !== "100%")
      return unsupported("根的祖先具有独立宽度，不能折叠为视口固定内边距。");
    for (const key of ["min-width", "max-width", "min-height", "max-height"])
      if (!["auto", "none", "0px", "0"].includes(typed.get(key)?.toString()))
        return unsupported("根的祖先具有尺寸边界，需要保留完整包含块。");
    for (const side of ["top", "right", "bottom", "left"])
      for (const prefix of ["padding", "margin"]) {
        const value = typed.get(`${prefix}-${side}`)?.toString() ?? "";
        if (value !== "auto" && !pixel(value))
          return unsupported("根的祖先包含百分比或负间距，不能作为固定视口内边距。");
      }
  }
  if (root !== document.documentElement && root !== document.body) {
    const siblings = [...root.parentElement.childNodes].filter((node) => {
      if (node.nodeType === 3) return Boolean(node.textContent.trim());
      if (node.nodeType !== 1 || node === root) return false;
      const style = window.getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden" && node.getBoundingClientRect().height > 0;
    });
    if (siblings.length) return unsupported("选中根的其他可见兄弟未捕获，不能重建完整视口关系。");
  }
  const parent = root.parentElement;
  if (!parent) return { ...result, left: gutter?.left ?? 0, right: gutter?.right ?? 0,
    top: 0, bottom: 0, heightFromViewport };
  const box = parent.getBoundingClientRect(), style = window.getComputedStyle(parent);
  const inset = (side) => (Number.parseFloat(style[`padding${side}`]) || 0) +
    (Number.parseFloat(style[`border${side}Width`]) || 0);
  return { ...result, left: box.left + inset("Left"), right: window.innerWidth - box.right + inset("Right"),
    top: box.top + inset("Top"), bottom: window.innerHeight - box.bottom + inset("Bottom"), heightFromViewport };
}

/** Pure, bounded plan for one normal-flow root inside the captured viewport. */
export function planHtmlViewportFlow(source, node, relation, width, height, bounds) {
  if (!relation) return null;
  const unsupported = (message) => ({ unsupported: message });
  if (relation.unsupported) return unsupported(relation.unsupported);
  if (relation.version !== 1 ||
      ![relation.x, relation.y, relation.width, relation.height, relation.left, relation.right].every(Number.isFinite) ||
      relation.width <= 0 || relation.height <= 0)
    return unsupported("根视口关系缺少可靠的测量边界。");
  if (bounds && (bounds.left || bounds.top))
    return unsupported("裁切捕获的边界不是原始包含块，视口保留测量几何。");
  if (source.nodeType !== "container" || source.transform || node.rotation ||
      !["block", "flow-root", "flex", "grid"].includes(source.layout?.display))
    return unsupported("根的行内、变换或非块布局不能作为普通视口块流。");
  const position = Object.fromEntries(["position", "top", "right", "bottom", "left"].map((key) => [key, css(source, key)]));
  if (!normalPosition(position) || !["", "none"].includes(css(source, "float")) ||
      !["", "horizontal-tb"].includes(css(source, "writing-mode")) || !["", "ltr"].includes(css(source, "direction")))
    return unsupported("根包含定位偏移、浮动或非水平书写，视口保留测量几何。");
  const declaredWidth = css(source, "width"), declaredHeight = css(source, "height");
  if (!["auto", "100%"].includes(declaredWidth) && !pixel(declaredWidth))
    return unsupported(`根 width: ${declaredWidth || "未知"} 不能对应视口 Fill 或固定尺寸。`);
  if (declaredHeight.includes("%") && (declaredHeight !== "100%" || !relation.heightFromViewport))
    return unsupported("根的百分比高度缺少完整的视口包含块高度关系。");
  for (const key of ["min-width", "max-width", "min-height", "max-height"])
    if (css(source, key) && !["none", "auto"].includes(css(source, key)) && !pixel(css(source, key)))
      return unsupported("根的相对尺寸边界不能对应视口原生布局。");
  const margins = {};
  for (const side of ["top", "right", "bottom", "left"]) {
    const value = css(source, `margin-${side}`);
    if (value !== "auto" && !pixel(value)) return unsupported("根的负向或百分比外边距需要保留测量几何。");
    margins[side] = value === "auto" ? 0 : Number.parseFloat(value);
  }
  const contentInsets = ["left", "right"].reduce((sum, side) => sum +
    (source.layout?.padding?.[side] ?? 0) + (source.border?.[side]?.width ?? 0), 0);
  if (declaredWidth === "100%" &&
      ((source.layout?.sizing?.boxSizing !== "border-box" && contentInsets > 0) || margins.left || margins.right))
    return unsupported("根的 100% 宽度加 content-box 内边距或外边距会溢出，不能近似为 Fill。");
  const left = relation.left + margins.left, right = relation.right + margins.right;
  if ([left, right, relation.y].some((value) => value < -0.02 || value > 2000) || width - left - right < 1)
    return unsupported("根视口内边距超出可编辑范围或内容区域为空。");
  const beforeAuto = css(source, "margin-left") === "auto", afterAuto = css(source, "margin-right") === "auto";
  const alignment = beforeAuto && afterAuto ? "center" : beforeAuto ? "end" : "start";
  const free = Math.max(0, width - left - right - node.width);
  const expectedX = left + (alignment === "center" ? free / 2 : alignment === "end" ? free : 0);
  if (Math.abs(relation.x - expectedX) > 0.05 || Math.abs(relation.width - node.width) > 0.05 ||
      Math.abs(relation.height - node.height) > 0.05)
    return unsupported("根的测量位置不符合普通块与自动外边距关系。");
  const fillHeight = declaredHeight === "100%";
  if (fillHeight) {
    const verticalInsets = ["top", "bottom"].reduce((sum, side) => sum +
      (source.layout?.padding?.[side] ?? 0) + (source.border?.[side]?.width ?? 0), 0);
    if (![relation.top, relation.bottom].every((value) => Number.isFinite(value) && value >= 0 && value <= 2000) ||
        margins.top || margins.bottom || Math.abs(relation.y - relation.top) > 0.05 ||
        Math.abs(node.height - height + relation.top + relation.bottom) > 0.05 ||
        (source.layout?.sizing?.boxSizing !== "border-box" && verticalInsets > 0))
      return unsupported("根的 100% 高度包含外边距、content-box 溢出或不同的包含块边界。");
  }
  return { left: Math.max(0, left), right: Math.max(0, right), top: Math.max(0, relation.y),
    bottom: fillHeight ? relation.bottom : 0, fillHeight,
    fill: declaredWidth === "auto" || declaredWidth === "100%",
    ...(beforeAuto || afterAuto ? { crossAlign: alignment } : {}) };
}
