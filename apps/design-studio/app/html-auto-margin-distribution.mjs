/* Capture-local proof for equal internal auto margins in one vertical Flex line. */
const plans = new WeakSet();
const axes = ["top", "right", "bottom", "left"];
const zero = value => /^0(?:\.0+)?px$/u.test(value);
const px = value => typeof value === "string" && /^-?(?:\d+(?:\.\d+)?|\.\d+)px$/u.test(value) ? Number.parseFloat(value) : NaN;
const finite = value => Number.isFinite(value) && Math.abs(value) <= 20000;
const sameBox = (a, b) => a && b && ["x", "y", "width", "height"].every(key => a[key] === b[key]);
const noText = element => ![...element.childNodes].some(node => node.nodeType === 3 && /[^\t\n\f\r ]/u.test(node.textContent ?? ""));
const nonReplaced = new Set("div main header footer section article aside nav ul ol li h1 h2 h3 h4 h5 h6 p form figure figcaption".split(" "));
const inertWrapper = node => node?.nodeType === "container" && /^margin_/u.test(node.id) &&
  node.name === "margin-wrapper" && !node.semantic && node.visible === true && node.opacity === 1 &&
  !node.transform && !node.image && !node.svgContent && !node.cssLayout && !node.rawStyles &&
  node.positioning?.mode === "static" && node.overflow === "visible" &&
  Array.isArray(node.background?.layers) && node.background.layers.length === 0 &&
  axes.every(side => node.border?.[side]?.width === 0 && node.border[side].style === "none") &&
  Array.isArray(node.effects?.boxShadows) && node.effects.boxShadows.length === 0 &&
  Object.keys(node.effects).every(key => key === "boxShadows") &&
  node.layout?.display === "flex" && node.layout.flex?.direction === "column" &&
  node.layout.flex.wrap === "nowrap" && node.layout.flex.justifyContent === "flex-start" &&
  node.layout.flex.gap?.row === 0 && node.layout.flex.gap?.column === 0 &&
  axes.every(side => node.layout.margin?.[side] === 0) &&
  Array.isArray(node.children) && node.children.length === 1;

/**
 * Only the current HTML importer supplies this callback. Saved CSS, selector
 * strings and report JSON cannot mint a plan. Element objects remain private.
 */
export function createHtmlAutoMarginCapture({ tree, root, elements, ambiguousElements }) {
  const worlds = new WeakMap(), originals = new WeakMap(), seen = new Set();
  let count = 0;
  const visit = (node, origin, depth) => {
    if (!node || typeof node !== "object" || seen.has(node) || ++count > 10000 || depth > 32 ||
        !node.bounds || !["x", "y", "width", "height"].every(key => finite(node.bounds[key])) ||
        (node.children !== undefined && !Array.isArray(node.children))) throw new Error("graph");
    seen.add(node);
    if (node.nodeType === "container" && node.semantic && typeof node.semantic === "object") {
      if (originals.has(node.semantic)) throw new Error("semantic alias");
      originals.set(node.semantic, node);
    }
    const bounds = { ...node.bounds, x: origin.x + node.bounds.x, y: origin.y + node.bounds.y };
    if (![bounds.x, bounds.y].every(finite)) throw new Error("world bounds");
    worlds.set(node, bounds);
    for (const child of node.children ?? []) visit(child, bounds, depth + 1);
  };
  try { visit(tree, { x: 0, y: 0 }, 0); } catch { return () => null; }
  const view = root.ownerDocument.defaultView;
  const typed = (element, key) => element.computedStyleMap().get(key)?.toString() ?? "";
  const require = (value, code) => { if (!value) throw code; };
  const elementFor = source => {
    const original = source.semantic && originals.get(source.semantic);
    const element = elements.get(source.semantic?.semanticId);
    // Existing ancestor auto-margin recovery may clone this exact source while
    // rebasing x/y. Its captured semantic/CSS/layout/child objects stay identical.
    require(original && source.id === original.id && source.cssLayout === original.cssLayout &&
      source.layout === original.layout && source.children === original.children &&
      element?.ownerDocument === root.ownerDocument && root.contains(element) &&
      !ambiguousElements.has(element) && source.visible === true &&
      sameBox(worlds.get(original), element.getBoundingClientRect()), "source-identity-or-bounds");
    return element;
  };
  const ordinary = (element, source) => {
    const style = view.getComputedStyle(element);
    require(source.nodeType === "container" && nonReplaced.has(element.localName) &&
      source.positioning?.mode === "static" && !source.transform &&
      style.position === "static" && style.visibility === "visible" &&
      style.display !== "none" && style.display !== "contents" &&
      style.cssFloat === "none" && style.clear === "none" &&
      style.writingMode === "horizontal-tb" && style.direction === "ltr" &&
      style.transform === "none" && style.perspective === "none" &&
      [style.translate, style.rotate, style.scale].every(value => value === "none") &&
      ["1", "normal"].includes(style.zoom) && style.contain === "none" &&
      style.contentVisibility === "visible" && style.aspectRatio === "auto" &&
      ["::before", "::after"].every(pseudo => ["none", "normal"].includes(view.getComputedStyle(element, pseudo).content)),
    "source-context");
    for (const key of ["display", "position", "width", "min-width", "max-width", "height", "min-height", "max-height", "flex-basis", "align-self", "order",
      "margin-top", "margin-bottom", "margin-left", "margin-right"])
      require(source.cssLayout?.[key] === typed(element, key), "stale-source-style");
    for (const key of ["flex-grow", "flex-shrink"])
      if (source.rawStyles?.[key] !== undefined)
        require(source.rawStyles[key] === style.getPropertyValue(key), "stale-source-style");
    return style;
  };
  return source => {
    if (!source.semantic || source.layout?.flex?.direction !== "column" ||
        !Array.isArray(source.children) || source.children.length < 2) return null;
    const entries = source.children.map(node => inertWrapper(node) ? { source: node.children[0], wrapper: node } : { source: node });
    if (!entries.some(item => ["top", "bottom"].some(side => item.source.cssLayout?.["margin-" + side] === "auto"))) return null;
    try {
      require(entries.length <= 1000, "participant-budget");
      const element = elementFor(source), style = ordinary(element, source);
      require(["flex", "inline-flex"].includes(style.display) && style.flexDirection === "column" &&
        style.flexWrap === "nowrap" && source.layout.flex.wrap === "nowrap" &&
        ["normal", "stretch"].includes(style.alignItems) &&
        ["normal", "start", "flex-start", "space-between"].includes(style.justifyContent) &&
        source.layout.flex.justifyContent === style.justifyContent &&
        ["normal", "0px"].includes(typed(element, "row-gap")) &&
        ["normal", "0px"].includes(typed(element, "column-gap")) &&
        source.layout.flex.gap?.row === 0 && source.layout.flex.gap?.column === 0 &&
        ["auto", "0px"].includes(typed(element, "min-height")) && typed(element, "max-height") === "none" &&
        axes.every(side => style.getPropertyValue("border-" + side + "-width") === "0px") &&
        noText(element) && element.children.length === entries.length, "parent-or-participant-topology");
      // Transformed/vertical/zoomed containing spaces never qualify by a name.
      for (let ancestor = element.parentElement, depth = 0; ancestor; ancestor = ancestor.parentElement) {
        require(++depth <= 32, "ancestor-budget");
        const context = view.getComputedStyle(ancestor);
        require(context.transform === "none" && context.perspective === "none" &&
          [context.translate, context.rotate, context.scale].every(value => value === "none") &&
          ["1", "normal"].includes(context.zoom) && context.writingMode === "horizontal-tb" &&
          context.direction === "ltr" && context.visibility === "visible", "ancestor-context");
        if (ancestor === root) break;
      }
      const items = entries.map((item, index) => {
        const child = item.source, real = elementFor(child), current = ordinary(real, child);
        require(real === element.children[index] && real.parentElement === element &&
          current.order === "0" && current.flexGrow === "0" && current.flexBasis === "auto" &&
          (child.flexItem?.grow === undefined || child.flexItem.grow === 0) && ["0", "1"].includes(current.flexShrink) &&
          ["auto", "stretch"].includes(current.alignSelf) && typed(real, "width") === "auto" &&
          (typed(real, "height") === "auto" || Number.isFinite(px(typed(real, "height")))) &&
          ["min-width", "max-width"].every(key => ["none", "auto"].includes(typed(real, key)) || Number.isFinite(px(typed(real, key)))) &&
          ["auto", "0px"].includes(typed(real, "min-height")) && typed(real, "max-height") === "none" &&
          ["left", "right"].every(side => zero(typed(real, "margin-" + side))),
        "child-sizing-or-order");
        // Horizontal auto-width text can shrink toward min-content. This proof
        // intentionally covers vertical automatic intrinsic height only.
        require(current.flexShrink === "0" ||
          (typed(real, "height") === "auto" && typed(real, "min-height") === "auto" &&
            current.overflowX === "visible" && current.overflowY === "visible"), "unproven-flex-shrink");
        const bounds = real.getBoundingClientRect();
        require(bounds.width >= 1 && bounds.height >= 1, "empty-participant");
        const margins = ["top", "bottom"].map(side => typed(real, "margin-" + side));
        require(margins.every(value => value === "auto" || zero(value)), "fixed-main-margin");
        const serializedMargins = ["top", "bottom"].map(side => px(current.getPropertyValue("margin-" + side)));
        require(serializedMargins.every(value => Number.isFinite(value) && value >= 0), "serialized-main-margin");
        return { ...item, semantic: child.semantic, cssLayout: child.cssLayout,
          element: real, box: bounds, margins, serializedMargins };
      });
      require(items[0].margins[0] !== "auto" && items.at(-1).margins[1] !== "auto", "endpoint-auto");
      const slots = items.slice(1).map((item, index) =>
        Number(items[index].margins[1] === "auto") + Number(item.margins[0] === "auto"));
      require(slots[0] > 0 && slots.every(value => value === slots[0]), "unequal-auto-boundaries");
      const box = element.getBoundingClientRect();
      const padding = Object.fromEntries(axes.map(side => [side, px(typed(element, "padding-" + side))]));
      require(Object.values(padding).every(value => Number.isFinite(value) && value >= 0 && value <= 2000) &&
        axes.every(side => source.layout.padding?.[side] === padding[side]), "parent-padding");
      const free = Math.max(0, box.height - padding.top - padding.bottom - items.reduce((sum, item) => sum + item.box.height, 0));
      const used = free / slots.reduce((sum, value) => sum + value, 0);
      let y = box.y + padding.top;
      for (const [index, item] of items.entries()) {
        const before = item.margins[0] === "auto" ? used : 0;
        const after = item.margins[1] === "auto" ? used : 0;
        y += before;
        require(item.box.y === y, "source-distribution-geometry");
        y += item.box.height + after;
        if (item.wrapper) {
          // Upstream wraps the exact child box using CSSOM's serialized used
          // margins, which can round 336.890625 to 336.891. Corroborate that
          // exact metadata arithmetic; the real DOM distribution above still
          // uses exact boxes and free space, without rounding or tolerance.
          const [serializedBefore, serializedAfter] = item.serializedMargins;
          const wrapper = item.wrapper, expected = { x: item.box.x, y: item.box.y - serializedBefore,
            width: item.box.width, height: item.box.height + serializedBefore + serializedAfter };
          require(inertWrapper(wrapper) && sameBox(worlds.get(wrapper), expected) &&
            wrapper.layout.padding.top === serializedBefore && wrapper.layout.padding.bottom === serializedAfter &&
            wrapper.layout.padding.left === 0 && wrapper.layout.padding.right === 0,
          "margin-wrapper-proof");
        }
        item.bounds = { ...item.source.bounds,
          x: item.source.bounds.x + (item.wrapper?.bounds.x ?? 0),
          y: item.source.bounds.y + (item.wrapper?.bounds.y ?? 0) };
        delete item.element; delete item.box; delete item.wrapper; delete item.serializedMargins;
        Object.freeze(item.margins); Object.freeze(item.bounds); Object.freeze(item);
      }
      const plan = Object.freeze({ source, semantic: source.semantic, cssLayout: source.cssLayout,
        items: Object.freeze(items), boundarySlots: slots[0] });
      plans.add(plan);
      return plan;
    } catch (error) {
      return { unsupported: typeof error === "string" ? error : "capture-unavailable" };
    }
  };
}

/** Consume only this synchronous capture's original objects and exact unwrap. */
export function consumeHtmlAutoMarginPlan(plan, original, current) {
  if (!plans.has(plan)) return null;
  plans.delete(plan);
  if (plan.source !== original || current.semantic !== plan.semantic ||
      current.cssLayout !== plan.cssLayout || current.children?.length !== plan.items.length) return null;
  return current.children.every((child, index) => {
    const item = plan.items[index];
    return child.semantic === item.semantic && child.cssLayout === item.cssLayout &&
      child.id === item.source.id && sameBox(child.bounds, item.bounds);
  }) ? plan : null;
}
