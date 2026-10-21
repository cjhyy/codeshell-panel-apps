// Source proof only. No importer, layout, native or renderer calls this module.
// A proven current capture is not permission to enable negative-gap Hug layout.
const sides = ["top", "right", "bottom", "left"];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const bounded = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const px = (value) => typeof value === "string" && /^-?(?:\d+(?:\.\d+)?|\.\d+)px$/u.test(value)
  ? Number.parseFloat(value) : NaN;
const zeroSides = (value) => sides.every((side) => value?.[side] === 0);
const box = (value) => value && ["x", "y"].every((key) => bounded(value[key], -20000, 20000)) &&
  ["width", "height"].every((key) => bounded(value[key], 1, 20000));
const sameBox = (left, right) => ["x", "y", "width", "height"].every((key) => left[key] === right[key]);
const noPaint = (node, opacity) => node.visible === true && node.opacity === opacity && !node.semantic &&
  !node.transform && !node.image && !node.svgContent && !node.cssLayout && !node.rawStyles &&
  Array.isArray(node.background?.layers) && node.background.layers.length === 0 &&
  sides.every((side) => node.border?.[side]?.width === 0 && node.border[side].style === "none" &&
    node.border[side].color?.a === 0) &&
  ["topLeft", "topRight", "bottomRight", "bottomLeft"].every((key) => node.border?.radius?.[key] === 0) &&
  Array.isArray(node.effects?.boxShadows) && node.effects.boxShadows.length === 0 &&
  Object.keys(node.effects).every((key) => key === "boxShadows") && node.overflow === "visible";
const safeStyle = (style) => style &&
  ["transform", "translate", "rotate", "scale", "filter", "backdrop-filter", "box-shadow", "text-shadow", "clip-path", "mask-image"]
    .every((key) => style[key] === "none") &&
  style.zoom === "1" && style["mix-blend-mode"] === "normal" && style.isolation === "auto" &&
  style.position === "static" && style["z-index"] === "auto" &&
  sides.every((key) => style[key] === "auto") &&
  style.float === "none" && style.clear === "none" && style.direction === "ltr" &&
  style["writing-mode"] === "horizontal-tb" && style["column-count"] === "auto" && style["column-width"] === "auto" &&
  style.contain === "none" && style["content-visibility"] === "visible" &&
  style["overflow-x"] === "visible" && style["overflow-y"] === "visible" && style["aspect-ratio"] === "auto";
const noGenerated = (capture) => [capture.beforeContent, capture.afterContent].every((value) => ["none", "normal"].includes(value));
const unconstrainedHeight = (style) => style.height === "auto" && ["auto", "0px"].includes(style["min-height"]) && style["max-height"] === "none";
const finiteInsets = (style, property) => Object.fromEntries(sides.map((side) => [side, px(style[`${property}-${side}`])]));

/**
 * Prove one exact pinned-converter placeholder pair and describe its resolved
 * ordinary block flow. `captures` is an internal capture-local Map keyed by the
 * CURRENT DesignNode objects. Each value retains the SAME semantic object,
 * source id and opaque actual Element identities; selector strings are not keys.
 * CSS contains Typed-OM sizes/margins and actual computed effect/context values.
 *
 * This returns a BLOCKED source plan, never canonical nodes or an admission flag.
 * It does not infer percentage wrapping, media queries or native Hug behavior.
 */
export function planHtmlNegativeRow({ root, parent, row, captures } = {}) {
  const refuse = (code) => ({ status: "unsupported", code });
  const require = (condition, code) => { if (!condition) throw code; };
  try {
    require(root && parent && row && captures instanceof Map && captures.size <= 10000, "INVALID_CAPTURE");
    const ancestry = new Map(), worlds = new Map(), ids = new Set(), active = new Set();
    let count = 0;
    const visit = (node, ancestors, origin) => {
      require(node && typeof node === "object" && !active.has(node) && !ancestry.has(node), "GRAPH_OWNERSHIP");
      require(++count <= 10000 && ancestors.length < 32 && typeof node.id === "string" &&
        node.id.length > 0 && node.id.length <= 1000 && !ids.has(node.id), "GRAPH_BUDGET_OR_ID");
      ids.add(node.id); active.add(node); ancestry.set(node, ancestors);
      require(node.bounds && Number.isFinite(node.bounds.x) && Number.isFinite(node.bounds.y), "GRAPH_COORDINATES");
      const world = { ...node.bounds, x: origin.x + node.bounds.x, y: origin.y + node.bounds.y };
      worlds.set(node, world);
      require(node.children === undefined || Array.isArray(node.children), "GRAPH_CHILDREN");
      const children = node.children ?? [];
      require(children.length <= 10000 - count &&
        Array.from({ length: children.length }, (_, index) => own(children, index)).every(Boolean), "GRAPH_CHILDREN");
      for (const child of children) visit(child, [...ancestors, node], world);
      active.delete(node);
    };
    visit(root, [], { x: 0, y: 0 });
    require(ancestry.has(parent) && ancestry.has(row) && ancestry.get(row).at(-1) === parent, "ROW_OWNERSHIP");
    for (const [node, value] of captures) require(ancestry.has(node) && node.semantic && value &&
      value.sourceId === node.id && value.semantic === node.semantic && value.semanticId === node.semantic.semanticId,
    "CAPTURE_OWNERSHIP");
    const capture = (node) => {
      const value = captures.get(node);
      require(value && node.semantic && value.semantic === node.semantic && value.sourceId === node.id &&
        typeof node.semantic.semanticId === "string" && node.semantic.semanticId.length > 0 && value.semanticId === node.semantic.semanticId && value.element &&
        typeof value.element === "object" && Array.isArray(value.children) && value.children.length <= 10000 && box(value.bounds) &&
        sameBox(worlds.get(node), value.bounds), "CAPTURE_IDENTITY_OR_BOUNDS");
      require(node.visible === true && value.css.visibility === "visible" && !node.transform && node.overflow === "visible" &&
        node.positioning?.mode === (node === row ? "absolute" : "static") &&
        safeStyle(value.css) && noGenerated(value), "UNSUPPORTED_SOURCE_CONTEXT");
      // Never prefer stale CSS metadata over the currently bound capture.
      require(node.cssLayout && Object.entries(node.cssLayout).every(([key, property]) =>
        !own(value.css, key) || value.css[key] === property), "STALE_SOURCE_STYLE");
      return value;
    };
    const p = capture(parent), r = capture(row);
    require(parent.nodeType === "container" && parent.layout?.display === "block" &&
      p.css.display === "block" && unconstrainedHeight(p.css) && ["auto", "100%"].includes(p.css.width) &&
      ["auto", "0px"].includes(p.css["min-width"]) && p.css["box-sizing"] === "border-box" &&
      p.css["margin-left"] === "auto" && p.css["margin-right"] === "auto" &&
      p.css["margin-top"] === "0px" && p.css["margin-bottom"] === "0px" &&
      sides.every((side) => p.css[`border-${side}-width`] === "0px") &&
      p.nonblankDirectText === false && p.children.length === 2, "UNSUPPORTED_PARENT");
    require(row.nodeType === "container" && row.positioning?.mode === "absolute" &&
      row.layout?.display === "flex" && r.css.display === "flex" && r.css["flex-direction"] === "row" &&
      ["wrap", "nowrap"].includes(r.css["flex-wrap"]) && r.css.width === "auto" &&
      unconstrainedHeight(r.css) && ["auto", "0px"].includes(r.css["min-width"]) && r.css["max-width"] === "none" &&
      r.css["box-sizing"] === "border-box" && r.nonblankDirectText === false &&
      r.parentElement === p.element && p.children[1] === r.element, "UNSUPPORTED_ROW");
    const padding = finiteInsets(p.css, "padding"), margins = finiteInsets(r.css, "margin");
    require(Object.values(padding).every((value) => bounded(value, 0, 2000)) && padding.top > 0 && padding.bottom > 0 &&
      sides.every((side) => parent.layout?.padding?.[side] === padding[side]), "PARENT_INSETS");
    require(bounded(margins.top, -1999, -3) && margins.bottom === 0 &&
      [margins.left, margins.right].every((value) => bounded(value, -1999, -3)) &&
      zeroSides(row.layout?.margin), "UNSUPPORTED_MARGINS");
    const entries = parent.children;
    require(Array.isArray(entries) && entries.length === 3 && entries[2] === row, "PAIR_SEQUENCE");
    const heading = entries[0], placeholder = entries[1], h = capture(heading);
    require(heading.nodeType === "container" && heading.positioning?.mode === "static" &&
      heading.layout?.display === "block" && h.css.display === "block" && h.parentElement === p.element &&
      p.children[0] === h.element && h.element !== r.element && unconstrainedHeight(h.css) &&
      h.css.width === "auto" && ["auto", "0px"].includes(h.css["min-width"]) && h.css["max-width"] === "none" &&
      ["top", "left", "right"].every((side) => h.css[`margin-${side}`] === "0px"), "UNSUPPORTED_HEADING");
    const previousBottomMargin = px(h.css["margin-bottom"]);
    require(bounded(previousBottomMargin, 0, 2000), "UNSUPPORTED_MARGINS");
    const expected = { ...row.bounds,
      width: row.bounds.width + margins.left + margins.right,
      height: row.bounds.height + margins.top };
    require(box(expected) && placeholder.nodeType === "container" && /^neg-placeholder_/u.test(placeholder.id) && placeholder.name === "neg-margin-placeholder" &&
      placeholder.tag === "div" && placeholder.role === "container" && placeholder.positioning?.mode === "static" &&
      noPaint(placeholder, 0) && Array.isArray(placeholder.children) && placeholder.children.length === 0 &&
      placeholder.layout?.display === "block" && zeroSides(placeholder.layout.padding) && zeroSides(placeholder.layout.margin) &&
      sameBox(placeholder.bounds, expected) && !captures.has(placeholder), "PLACEHOLDER_SIGNATURE");
    require([...captures.values()].every((value) => value.element !== placeholder && value.sourceId !== placeholder.id &&
      value.semantic !== placeholder.semantic), "PLACEHOLDER_REAL_SOURCE");
    const local = (node) => ({ ...worlds.get(node), x: worlds.get(node).x - p.bounds.x, y: worlds.get(node).y - p.bounds.y });
    const rowBox = local(row), headingBox = local(heading);
    const gap = margins.top + previousBottomMargin;
    require(gap < 0 && gap >= -1999 &&
      headingBox.x === padding.left && headingBox.y === padding.top &&
      headingBox.width === p.bounds.width - padding.left - padding.right &&
      rowBox.x === padding.left + margins.left &&
      rowBox.width === p.bounds.width - padding.left - padding.right - margins.left - margins.right &&
      rowBox.y === headingBox.y + headingBox.height + gap &&
      p.bounds.height === padding.top + headingBox.height + gap + rowBox.height + padding.bottom, "BLOCK_GEOMETRY");
    const rebased = { ...padding, left: padding.left + margins.left, right: padding.right + margins.right };
    require([rebased.left, rebased.right].every((value) => bounded(value, 0, 2000)), "INSET_BUDGET");
    // Recover the real DOM width owner through at most one pinned margin wrapper.
    const ownerCandidates = [...captures.keys()].filter((node) => node.nodeType === "container" &&
      captures.get(node)?.element === p.parentElement && ancestry.get(parent).includes(node));
    require(ownerCandidates.length === 1, "WIDTH_OWNER");
    const owner = ownerCandidates[0], o = capture(owner);
    require(o.css.display === "block" && o.nonblankDirectText === false &&
      o.children.filter((element) => element === p.element).length === 1 &&
      sides.every((side) => o.css[`border-${side}-width`] === "0px"), "WIDTH_OWNER");
    const ownerPadding = finiteInsets(o.css, "padding");
    require(Object.values(ownerPadding).every((value) => bounded(value, 0, 2000)), "WIDTH_OWNER");
    const available = o.bounds.width - ownerPadding.left - ownerPadding.right;
    const maximum = p.css["max-width"] === "none" ? null : px(p.css["max-width"]);
    require(maximum === null || bounded(maximum, 1, 20000), "WIDTH_CONSTRAINT");
    const width = maximum === null ? available : Math.min(available, maximum), auto = (available - width) / 2;
    require(width === p.bounds.width && auto >= 0 &&
      p.bounds.x === o.bounds.x + ownerPadding.left + auto, "AUTO_MARGIN_GEOMETRY");
    const between = ancestry.get(parent).slice(ancestry.get(parent).indexOf(owner) + 1);
    require(between.length === (auto > 0 ? 1 : 0), "AUTO_MARGIN_WRAPPER");
    if (between.length) {
      const wrapper = between[0];
      require(wrapper.nodeType === "container" && /^margin_/u.test(wrapper.id) && wrapper.name === "margin-wrapper" && wrapper.tag === "div" &&
        wrapper.role === "container" && noPaint(wrapper, 1) && wrapper.positioning?.mode === "static" &&
        wrapper.children?.length === 1 && wrapper.children[0] === parent && !captures.has(wrapper) &&
        wrapper.layout?.display === "block" && zeroSides(wrapper.layout.margin) &&
        wrapper.layout.padding?.left === auto && wrapper.layout.padding?.right === auto &&
        wrapper.layout.padding?.top === 0 && wrapper.layout.padding?.bottom === 0 &&
        worlds.get(wrapper).x === o.bounds.x + ownerPadding.left &&
        worlds.get(wrapper).y === p.bounds.y && wrapper.bounds.width === available && wrapper.bounds.height === p.bounds.height,
      "AUTO_MARGIN_WRAPPER");
    }
    // Every real ancestor must have current, safe source context. A name-only
    // synthetic ancestor is insufficient; only the one proven wrapper is exempt.
    for (const ancestor of ancestry.get(parent)) {
      if (between.includes(ancestor)) continue;
      capture(ancestor);
    }
    return {
      status: "source-proven", activation: "blocked", dependencies: ["NATIVE_NEGATIVE_GAP_HUG_UNVERIFIED", "ROW_INNER_FLOW_UNCHANGED"],
      parent, row, heading, remove: [placeholder], retain: [heading, row],
      parentSourceId: parent.id, rowSourceId: row.id, rowSemantic: row.semantic,
      resolved: { gap, parentHeight: p.bounds.height, parentWidth: p.bounds.width, padding: { ...padding }, rebasedPadding: rebased,
        row: rowBox, heading: headingBox, headingInsets: { left: -margins.left, right: -margins.right },
        placeholderContribution: { width: expected.width, height: expected.height },
        autoMargins: { left: auto, right: auto, ownerContentWidth: available, maximumWidth: maximum } },
    };
  } catch (error) {
    return refuse(typeof error === "string" && /^[A-Z_]+$/u.test(error) ? error : "INVALID_CAPTURE");
  }
}
