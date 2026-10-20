/* Freeze same-document SVG resources without modifying the measured DOM. */
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";
const MAX_ELEMENTS = 2000;
const MAX_REFERENCES = 256;
const MAX_DEPTH = 32;
const MAX_BYTES = 1024 * 1024;
// Keep the resource subset aligned with the v3 inert SVG validator.
const allowed = new Set(
  "svg g path rect circle ellipse line polyline polygon defs clipPath mask linearGradient radialGradient stop pattern text tspan title desc metadata filter feGaussianBlur feOffset feBlend feColorMatrix feComposite feFlood feMerge feMergeNode feMorphology feTurbulence feDisplacementMap use symbol"
    .toLowerCase()
    .split(" "),
);
const fragment = /^#([a-z0-9_.:-]+)$/iu;

export function captureStandaloneSvg(source: Element): string {
  const ownerDocument = source.ownerDocument;
  const view = ownerDocument.defaultView;
  if (!view || source.namespaceURI !== SVG_NS || source.localName !== "svg")
    throw Error("SVG 捕获需要活动文档内的 SVG 根节点");
  const clones = new Map<Element, Element>();
  const ids = new Map<string, Element>();
  const completed = new Set<string>();
  const active = new Set<string>();
  let elementCount = 0;
  let referenceCount = 0;
  let bytes = 0;
  const account = (value: string) => {
    bytes += new TextEncoder().encode(value).length;
    if (bytes > MAX_BYTES) throw Error("独立 SVG 超过 1 MiB 上限");
  };
  const reference = (value: string) => {
    const match = fragment.exec(value.trim());
    if (!match) throw Error("SVG 引用必须是同一文档内的 #id，不能加载外部资源");
    return match[1];
  };
  const references = (element: Element) => {
    const ids: string[] = [];
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "src" || name === "xml:base")
        throw Error(`SVG 不允许 ${attribute.name} 属性`);
      if (name === "href" || name === "xlink:href") ids.push(reference(attribute.value));
      for (const url of attribute.value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/giu))
        ids.push(reference(url[1] ?? url[2] ?? url[3]));
      if (/\\|@import|(?:javascript|vbscript|data|file)\s*:/iu.test(attribute.value))
        throw Error("SVG 不允许活动样式或外部资源");
    }
    if (
      element.localName === "use" &&
      !element.hasAttribute("href") &&
      !element.hasAttributeNS(XLINK_NS, "href")
    )
      throw Error("SVG use 缺少同一文档内的 #id 引用");
    return ids;
  };
  const cloneTree = (original: Element, depth = 0): Element => {
    const existing = clones.get(original);
    if (existing) return existing;
    if (depth > MAX_DEPTH || ++elementCount > MAX_ELEMENTS)
      throw Error("独立 SVG 最多 2000 个元素及 32 层嵌套");
    if (original.namespaceURI !== SVG_NS || !allowed.has(original.localName.toLowerCase()))
      throw Error(`SVG 不允许 ${original.localName} 元素`);
    references(original);
    const id = original.getAttribute("id");
    if (id && ids.has(id) && ids.get(id) !== original) throw Error(`SVG ID 重复：${id}`);
    if (id) ids.set(id, original);
    const clone = original.cloneNode(false) as Element;
    clones.set(original, clone);
    account(original.localName);
    for (const attribute of [...original.attributes]) account(attribute.name + attribute.value);
    for (const child of [...original.childNodes]) {
      if (child.nodeType === 1) clone.append(cloneTree(child as Element, depth + 1));
      else if (child.nodeType === 3) {
        account(child.textContent ?? "");
        clone.append(child.cloneNode(false));
      }
    }
    return clone;
  };
  const root = cloneTree(source);
  root.setAttributeNS(XMLNS_NS, "xmlns", SVG_NS);
  root.setAttributeNS(XMLNS_NS, "xmlns:xlink", XLINK_NS);
  const defs = ownerDocument.createElementNS(SVG_NS, "defs");
  const attachDefinitions = () => {
    if (!defs.childNodes.length || defs.parentNode) return;
    if (++elementCount > MAX_ELEMENTS) throw Error("独立 SVG 最多 2000 个元素");
    root.prepend(defs);
  };
  const resolve = (id: string, depth: number) => {
    if (active.has(id)) throw Error(`SVG 引用包含循环：#${id}`);
    if (completed.has(id)) return;
    if (depth > MAX_DEPTH || ++referenceCount > MAX_REFERENCES)
      throw Error("独立 SVG 最多 256 项引用及 32 层引用链");
    const original = ownerDocument.getElementById(id);
    if (!original) throw Error(`SVG 缺少同一文档内的引用：#${id}`);
    active.add(id);
    if (!clones.has(original)) defs.append(cloneTree(original));
    inspect(original, depth);
    active.delete(id);
    completed.add(id);
  };
  const inspect = (original: Element, depth: number) => {
    for (const id of references(original)) resolve(id, depth + 1);
    for (const child of [...original.children]) inspect(child, depth);
  };
  inspect(source, 0);
  attachDefinitions();

  // Freeze the live SVG's inherited paint context. Referenced definitions keep
  // currentColor/inheritance so each use instance receives its own visible color.
  const properties = [
    "color",
    "fill",
    "fill-opacity",
    "fill-rule",
    "stroke",
    "stroke-opacity",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-dasharray",
    "stroke-dashoffset",
    "clip-rule",
    "clip-path",
    "mask",
  ];
  const freeze = (original: Element, insideDefinition: boolean) => {
    const definition = insideDefinition || ["defs", "symbol"].includes(original.localName);
    if (!definition) {
      const clone = clones.get(original) as SVGElement;
      const computed = view.getComputedStyle(original);
      for (const property of properties) {
        const value = computed.getPropertyValue(property);
        if (!value) continue;
        clone.style.removeProperty(property);
        clone.setAttribute(property, value);
      }
      references(clone);
    }
    for (const child of [...original.children]) freeze(child, definition);
  };
  freeze(source, false);
  // Computed CSS may introduce local clip/paint references absent from attributes.
  for (const clone of [...clones.values()]) for (const id of references(clone)) resolve(id, 0);
  attachDefinitions();
  const serialized = new XMLSerializer().serializeToString(root);
  if (new TextEncoder().encode(serialized).length > MAX_BYTES)
    throw Error("独立 SVG 超过 1 MiB 上限");
  return serialized;
}
