/* Capture-local source-only treatment for empty inline tokens between block boxes. */
const issuedPlans = new WeakMap();
const sides = ["top", "right", "bottom", "left"];
const forbiddenTags = new Set("a area audio br button canvas details dialog embed fieldset hr iframe img input label legend link math meter object option optgroup output picture progress script select slot source style summary svg table template textarea track video wbr".split(" "));
const sameBox = (a, b) => a && b && ["x", "y", "width", "height"].every(key => a[key] === b[key]);
const bounded = value => Number.isFinite(value) && Math.abs(value) <= 20000;
const geometryKeys = ["display", "position", "top", "right", "bottom", "left", "float", "clear", "width", "height", "min-width", "max-width", "min-height", "max-height", "font-family", "font-size", "line-height", "white-space", "writing-mode", "direction", "vertical-align", "transform", "translate", "rotate", "scale", "perspective", "zoom", "contain", "content-visibility", "counter-reset", "counter-increment", "counter-set", "content", "break-before", "break-after", "break-inside", ...sides.flatMap(side => ["margin-" + side, "padding-" + side, "border-" + side + "-width"])];
const tokenKeys = [...geometryKeys, "visibility", "opacity", "background-color", "background-image", "border-image-source", "box-shadow", "text-shadow", "outline-style", "filter", "backdrop-filter", "mix-blend-mode", "appearance", "resize", "clip-path", "mask-image", "-webkit-mask-image", "overflow-x", "overflow-y", "animation-name", "transition-duration"];
const signature = (view, element, keys) => {
  const style = view.getComputedStyle(element);
  let remaining = 16384;
  return JSON.stringify(keys.map(key => {
    const value = style.getPropertyValue(key);
    if (value.length > 4000 || (remaining -= value.length) < 0) fail();
    return value;
  }));
};
const fail = () => { throw Error("HTML_ZERO_FLOW_TOKEN_UNVERIFIED: source-only token proof changed"); };
const own = (value, key) => {
  if (!value || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor && !Object.hasOwn(descriptor, "value")) fail();
  return descriptor?.value;
};
const childrenOf = source => {
  const children = own(source, "children");
  if (children === undefined) return [];
  if (!Array.isArray(children) || children.length > 10000) fail();
  return Array.from({ length: children.length }, (_, index) => own(children, String(index)));
};

// Source snapshots never invoke getters, toJSON or inherited serialization code.
function snapshot(value) {
  let count = 0, budget = 32768;
  const seen = new Set();
  const visit = (item, depth) => {
    if (++count > 2000 || depth > 10) fail();
    if (item === null || item === undefined) return [item === null ? "null" : "undefined"];
    if (typeof item === "string") { budget -= item.length; if (budget < 0 || item.length > 4000) fail(); return ["string", item]; }
    if (typeof item === "boolean") return ["boolean", item];
    if (typeof item === "number" && Number.isFinite(item)) return ["number", item];
    if (typeof item !== "object" || seen.has(item) ||
        ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(item))) fail();
    seen.add(item);
    const rows = Reflect.ownKeys(item).map(key => {
      if (typeof key !== "string" || key.length > 200 || (budget -= key.length) < 0) fail();
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) fail();
      return [key, visit(descriptor.value, depth + 1)];
    });
    seen.delete(item);
    return [Array.isArray(item) ? "array" : "object", rows];
  };
  return JSON.stringify(visit(value, 0));
}
const parentSnapshot = source => snapshot({
  ...Object.fromEntries(["id", "nodeType", "name", "tag", "semantic", "bounds", "layout", "cssLayout", "positioning", "transform"].map(key => [key, own(source, key)])),
  childCount: childrenOf(source).length,
});

function ordinary(view, element) {
  const style = view.getComputedStyle(element);
  return style.visibility === "visible" && style.writingMode === "horizontal-tb" && style.direction === "ltr" &&
    style.transform === "none" && style.perspective === "none" &&
    [style.translate, style.rotate, style.scale].every(value => value === "none") &&
    ["1", "normal"].includes(style.zoom) && style.contain === "none" && style.contentVisibility === "visible";
}
function nonpainting(view, element) {
  const style = view.getComputedStyle(element), box = element.getBoundingClientRect();
  return element.namespaceURI === "http://www.w3.org/1999/xhtml" && !forbiddenTags.has(element.localName) &&
    !element.hasAttribute("id") && !element.hasAttribute("name") &&
    !element.hasAttribute("is") && !view.customElements?.get(element.localName) && !element.shadowRoot &&
    element.attributes.length <= 64 && !element.isContentEditable && element.tabIndex < 0 && ![...element.attributes].some(attribute =>
      /^(?:aria-|on)/u.test(attribute.name) || ["role", "title", "tabindex", "contenteditable", "accesskey", "draggable", "autofocus"].includes(attribute.name)) &&
    element.childNodes.length === 0 && element.textContent === "" && ordinary(view, element) &&
    style.display === "inline" && style.position === "static" && style.cssFloat === "none" && style.clear === "none" &&
    box.width === 0 && box.height === 0 && [...element.getClientRects()].length === 1 &&
    sameBox(box, element.getClientRects()[0]) && style.opacity === "1" &&
    ["::before", "::after", "::marker"].every(pseudo => ["none", "normal"].includes(view.getComputedStyle(element, pseudo).content)) &&
    ["normal", "none"].includes(style.content) &&
    ["counterReset", "counterIncrement", "counterSet"].every(key => style[key] === "none") &&
    ["breakBefore", "breakAfter", "breakInside"].every(key => style[key] === "auto") &&
    style.animationName === "none" && style.transitionDuration.split(",").every(value => value.trim() === "0s") &&
    sides.every(side => ["margin-", "padding-", "border-"].every(prefix =>
      style.getPropertyValue(prefix + side + (prefix === "border-" ? "-width" : "")) === "0px")) &&
    /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0(?:\.0+)?\s*\)$/u.test(style.backgroundColor) &&
    ["backgroundImage", "borderImageSource", "boxShadow", "textShadow", "outlineStyle", "filter", "backdropFilter", "clipPath", "maskImage", "webkitMaskImage"].every(key => ["none", ""].includes(style[key] ?? "")) &&
    style.mixBlendMode === "normal" && style.appearance === "none" && style.resize === "none" &&
    [style.overflowX, style.overflowY].every(value => ["visible", "hidden", "clip"].includes(value));
}

/** Private object identities and exact current source fields are the authority. */
export function createHtmlZeroFlowTokenCapture({ tree, root, elements, ambiguousElements = new WeakSet() }) {
  const worlds = new WeakMap(), parents = new WeakMap(), containers = new Map(), seen = new Set(), accepted = [];
  let acceptedStringUnits = 0;
  const result = { checked: 0, refused: 0, tokens: [] }, view = root.ownerDocument.defaultView;
  const visit = (source, parent, origin, depth) => {
    if (!source || typeof source !== "object" || seen.has(source) || seen.size >= 10000 || depth > 32) fail();
    const originalBounds = own(source, "bounds"), children = childrenOf(source),
      bounds = Object.fromEntries(["x", "y", "width", "height"].map(key => [key, own(originalBounds, key)]));
    if (!Object.values(bounds).every(bounded)) fail();
    seen.add(source); parents.set(source, parent);
    const box = { ...bounds, x: origin.x + bounds.x, y: origin.y + bounds.y };
    if (![box.x, box.y].every(bounded)) fail(); worlds.set(source, box);
    const id = own(source, "nodeType") === "container" && own(own(source, "semantic"), "semanticId");
    if (id) containers.set(id, (containers.get(id) ?? 0) + 1);
    for (const child of children) visit(child, source, box, depth + 1);
  };
  try { visit(tree, null, { x: 0, y: 0 }, 0); } catch { return { capture: () => null, verify() {}, report: () => result }; }
  const elementFor = source => {
    const id = source.semantic?.semanticId, element = elements.get(id);
    if (!seen.has(source) || containers.get(id) !== 1 || !element || ambiguousElements.has(element) ||
        element.ownerDocument !== root.ownerDocument || !root.isConnected || !element.isConnected ||
        !root.contains(element) || !sameBox(worlds.get(source), element.getBoundingClientRect())) fail();
    return element;
  };
  const prove = (source, tokenSources) => {
    const parent = elementFor(source), style = view.getComputedStyle(parent);
    if (!["block", "flow-root"].includes(style.display) || !ordinary(view, parent) || parent.shadowRoot ||
        style.whiteSpace !== "normal" || !["::before", "::after"].every(pseudo => ["none", "normal"].includes(view.getComputedStyle(parent, pseudo).content)) ||
        parent.childNodes.length > 1000 || [...parent.childNodes].some(node =>
          ![1, 3, 8].includes(node.nodeType) || (node.nodeType === 3 && /[^\t\n\f\r ]/u.test(node.textContent ?? "")))) fail();
    for (let ancestor = parent, depth = 0; ancestor; ancestor = ancestor.parentElement) {
      if (++depth > 32 || !ordinary(view, ancestor)) fail();
    }
    const realTokens = tokenSources.map(token => {
      const element = elementFor(token);
      if (parents.get(token) !== source || element.parentElement !== parent || !nonpainting(view, element) ||
          token.nodeType !== "container" || token.visible !== true || token.transform || token.children?.length !== 0 ||
          token.layout?.display !== "inline" || token.positioning?.mode !== "static") fail();
      return element;
    });
    for (const child of parent.children) {
      if (realTokens.includes(child)) continue;
      const current = view.getComputedStyle(child);
      if (current.display === "none" || ["absolute", "fixed"].includes(current.position)) continue;
      // No anonymous inline line or break may coexist with the zero tokens.
      if (!["block", "flow-root", "flex", "grid"].includes(current.display) || !ordinary(view, child) ||
          current.cssFloat !== "none" || current.clear !== "none" ||
          child.getBoundingClientRect().width <= 0 || child.getBoundingClientRect().height <= 0) fail();
    }
    return { parent, realTokens };
  };
  const current = record => {
    const sourceSnapshot = parentSnapshot(record.source), sourceChildren = childrenOf(record.source),
      snapshots = record.tokenSources.map(snapshot);
    const { parent, realTokens } = prove(record.source, record.tokenSources);
    if (parent !== record.parent || parent.parentNode !== record.owner ||
        parent.childNodes.length !== record.nodes.length || record.nodes.some((node, index) => parent.childNodes[index] !== node) ||
        own(record.source, "children") !== record.childrenArray || sourceChildren.length !== record.children.length ||
        record.children.some((child, index) => sourceChildren[index] !== child) || sourceSnapshot !== record.sourceSnapshot ||
        signature(view, parent, geometryKeys) !== record.parentStyle ||
        record.elements.some(item => item.element.parentElement !== parent || !sameBox(item.box, item.element.getBoundingClientRect()) ||
          signature(view, item.element, geometryKeys) !== item.style) ||
        record.tokenSources.some((token, index) => snapshots[index] !== record.snapshots[index] ||
          signature(view, realTokens[index], tokenKeys) !== record.tokenStyles[index])) fail();
  };
  return {
    capture(source) {
      if (!seen.has(source)) return null;
      let tokenSources = [];
      try {
        const sourceSnapshot = parentSnapshot(source), children = childrenOf(source);
        if (!["block", "flow-root"].includes(source.layout?.display)) return null;
        tokenSources = children.filter(child => worlds.get(child)?.width === 0 && worlds.get(child)?.height === 0 && own(child, "nodeType") === "container");
        if (!tokenSources.length) return null;
        result.checked += tokenSources.length;
        if (tokenSources.length > 100 || accepted.length >= 100 || result.tokens.length + tokenSources.length > 500) fail();
        const snapshots = tokenSources.map(snapshot);
        const { parent, realTokens } = prove(source, tokenSources);
        const record = { source, tokenSources, parent, owner: parent.parentNode, nodes: [...parent.childNodes], children, childrenArray: own(source, "children"),
          sourceSnapshot, snapshots,
          parentStyle: signature(view, parent, geometryKeys), tokenStyles: realTokens.map(element => signature(view, element, tokenKeys)),
          elements: [...parent.children].map(element => ({ element, box: element.getBoundingClientRect(), style: signature(view, element, geometryKeys) })) };
        const stringUnits = record.sourceSnapshot.length + record.parentStyle.length +
          [...record.snapshots, ...record.tokenStyles, ...record.elements.map(item => item.style)].reduce((sum, value) => sum + value.length, 0);
        if (stringUnits > 512 * 1024 || acceptedStringUnits + stringUnits > 2 * 1024 * 1024) fail();
        let consumed = false;
        const plan = Object.freeze({});
        issuedPlans.set(plan, { source, tokenSources,
          accept(parentNodeId) {
            if (consumed) fail(); consumed = true;
            current(record); accepted.push(record); acceptedStringUnits += stringUnits;
            for (const [index, token] of tokenSources.entries()) result.tokens.push({ parentNodeId, sourceId: String(token.id ?? "").slice(0, 200),
              semanticId: String(token.semantic.semanticId).slice(0, 2000), tag: realTokens[index].localName, sourceBounds: { ...worlds.get(token) },
              reason: "verified-nonpainting-zero-inline-source-token" });
          }, verify: () => current(record) });
        return plan;
      } catch { result.refused += tokenSources.length; return null; }
    },
    verify() { for (const record of accepted) current(record); },
    report: () => ({ ...result, admitted: result.tokens.length, tokens: result.tokens.map(token => ({ ...token, sourceBounds: { ...token.sourceBounds } })) }),
  };
}

/** JSON, saved notes and public lookalikes cannot mint this one-use capability. */
export function consumeHtmlZeroFlowTokenPlan(plan, original, current) {
  const proof = issuedPlans.get(plan);
  if (!proof) return null;
  issuedPlans.delete(plan);
  proof.verify();
  const originalChildren = childrenOf(original), currentChildren = childrenOf(current);
  if (proof.source !== original || own(current, "semantic") !== own(original, "semantic") || own(current, "layout") !== own(original, "layout") ||
      own(current, "cssLayout") !== own(original, "cssLayout") || currentChildren.length !== originalChildren.length ||
      proof.tokenSources.some(token => currentChildren[originalChildren.indexOf(token)] !== token)) return null;
  return { tokens: new Set(proof.tokenSources), accept: proof.accept };
}
