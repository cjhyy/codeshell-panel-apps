import { parseDesignFontFamily, MAX_DESIGN_FONT_FAMILY_LENGTH } from "./font-family.mjs";

const styleKeys = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "whiteSpace",
  "textTransform", "visibility", "display", "direction", "writingMode"];
const legacyFamily = (value) => value.split(",")[0].trim().replace(/['"]/gu, "");
const normalText = (value) => value.replace(/[\t\n\f\r ]+/gu, " ").replace(/^ | $/gu, "");
const initialTextProjections = new WeakMap();
const own = (value, key) => {
  if (!value || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
};
const projectionSnapshot = value => {
  let count = 0, remaining = 16384;
  const seen = new Set();
  const visit = (item, depth) => {
    if (++count > 256 || depth > 8) throw Error("projection budget");
    if (item === undefined || item === null) return [item === null ? "null" : "undefined"];
    if (typeof item === "string") {
      if (item.length > 4000 || (remaining -= item.length) < 0) throw Error("projection string budget");
      return ["string", item];
    }
    if (typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) return [typeof item, item];
    if (typeof item !== "object" || seen.has(item) ||
        ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(item))) throw Error("projection shape");
    seen.add(item);
    const entries = Reflect.ownKeys(item).map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== "string" || key.length > 200 || (remaining -= key.length) < 0 ||
          !descriptor || !Object.hasOwn(descriptor, "value")) throw Error("projection descriptor");
      return [key, visit(descriptor.value, depth + 1)];
    });
    seen.delete(item);
    return [Array.isArray(item) ? "array" : "object", entries];
  };
  try { return JSON.stringify(visit(value, 0)); } catch { return null; }
};

/** Record the actual adapter projection before its parent can restore pre text. */
export function captureHtmlFontFamilyTextProjection(source, node) {
  const content = own(source, "content"), text = own(node, "text"), textSource = own(node, "textSource"), style = own(source, "textStyle");
  if (initialTextProjections.has(node) || own(source, "nodeType") !== "text" || own(node, "type") !== "text" ||
      typeof content !== "string" || content.length > 4000 || text !== content || textSource !== content) return;
  const styleSnapshot = projectionSnapshot(style), segments = own(source, "styledSegments"), segmentsSnapshot = projectionSnapshot(segments);
  if (styleSnapshot === null || segmentsSnapshot === null) return;
  initialTextProjections.set(node, { source, content, text, textSource, style, styleSnapshot,
    segments, segmentsSnapshot, family: own(style, "fontFamily") });
}

/** Private current-capture record. Never serialized as source authority. */
export function captureHtmlFontFamilyElement(element) {
  const view = element.ownerDocument.defaultView;
  if (!view) return { reason: "missing-view" };
  const style = view.getComputedStyle(element);
  if (style.fontFamily.length > MAX_DESIGN_FONT_FAMILY_LENGTH)
    return { reason: "budget" };
  if (!parseDesignFontFamily(style.fontFamily)) return { reason: "syntax" };
  if (element.childElementCount || element.textContent.length > 4000)
    return { reason: "mixed-or-large-source" };
  const pseudos = ["::before", "::after", "::first-line", "::first-letter"].map((pseudo) => {
    const variant = view.getComputedStyle(element, pseudo);
    return { pseudo, content: variant.content, fontFamily: variant.fontFamily };
  });
  return {
    element, parent: element.parentNode, document: element.ownerDocument,
    children: [...element.childNodes], text: element.textContent,
    style: Object.fromEntries(styleKeys.map((key) => [key, style[key]])), pseudos,
  };
}

function currentLeaf(record, root) {
  const element = record.element, document = root.ownerDocument;
  if (!element || record.document !== document || element.ownerDocument !== document ||
      !root.isConnected || !element.isConnected || !root.contains(element) ||
      element.parentNode !== record.parent || element.childElementCount ||
      element.textContent !== record.text || element.childNodes.length !== record.children.length ||
      record.children.some((child, index) => element.childNodes[index] !== child) ||
      record.children.some((child) => ![3, 8].includes(child.nodeType))) return false;
  const view = document.defaultView, style = view.getComputedStyle(element);
  if (styleKeys.some((key) => style[key] !== record.style[key])) return false;
  if (record.pseudos.some(({ pseudo, content, fontFamily }) => {
    const variant = view.getComputedStyle(element, pseudo);
    return variant.content !== content || variant.fontFamily !== fontFamily;
  })) return false;
  return ["normal", "nowrap", "pre", "pre-wrap", "pre-line", "break-spaces"].includes(style.whiteSpace) &&
    style.visibility === "visible" && style.display !== "none" && style.textTransform === "none" &&
    style.direction === "ltr" && style.writingMode === "horizontal-tb" &&
    record.pseudos.slice(0, 2).every(({ content }) => ["none", "normal"].includes(content)) &&
    record.pseudos.slice(2).every(({ fontFamily }) => fontFamily === style.fontFamily);
}

function compatibleText(source, node, record) {
  const content = own(source, "content"), style = own(source, "textStyle"), segments = own(source, "styledSegments"),
    text = own(node, "text"), textSource = own(node, "textSource");
  if (typeof content !== "string" || (segments != null && (!Array.isArray(segments) || segments.length > 1)) ||
      own(style, "fontFamily") !== legacyFamily(record.style.fontFamily) ||
      own(node, "fontFamily") !== legacyFamily(record.style.fontFamily)) return false;
  const initial = initialTextProjections.get(node);
  // The pinned converter changes pre spaces to NBSP/collapsed display text.
  // Its existing parent overflow recovery then restores exact raw DOM text.
  // Qualify that current canonical text from private identities/bytes, never notes.
  if (record.style.whiteSpace === "pre" && initial?.source === source &&
      initial.content === content && initial.text === initial.content && initial.textSource === initial.content &&
      initial.style === style && initial.family === own(initial.style, "fontFamily") &&
      initial.styleSnapshot === projectionSnapshot(style) && initial.segments === segments &&
      initial.segmentsSnapshot === projectionSnapshot(segments) &&
      text === record.text && textSource === record.text) return true;
  if (text !== content || textSource !== content) return false;
  if (["normal", "nowrap"].includes(record.style.whiteSpace)) {
    // Compare the upstream display projection only; never replace any text byte.
    const legacy = (value) => normalText(value.replace(/\u00a0/gu, " "));
    return legacy(content) === legacy(record.text);
  }
  return content === record.text;
}

/** Restore only a unique real current leaf's complete computed CSS family. */
export function preserveHtmlFontFamilies({ tree, root, elements, records, ambiguousElements,
  canonicalBySource, textBindings, resources = [], warn }) {
  const texts = [], seen = new Set(), counts = new Map();
  const visit = (source) => {
    if (!source || typeof source !== "object" || seen.has(source)) return;
    seen.add(source);
    if (seen.size > 50000) throw Error("HTML font source tree exceeds its node budget");
    if (source.nodeType === "text") {
      texts.push(source);
      const id = source.semantic?.semanticId;
      if (typeof id === "string") counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const child of source.children ?? []) visit(child);
  };
  visit(tree);
  const result = { checked: 0, admitted: 0, restored: 0, retained: 0 };
  for (const { source, node } of textBindings ?? texts.map(source => ({source,node:canonicalBySource.get(source)}))) {
    if (node?.type !== "text") continue;
    result.checked += 1;
    const id = source.semantic?.semanticId, element = elements.get(id), record = element && records.get(element);
    let reason = !seen.has(source) || source.nodeType !== "text" || !element || counts.get(id) !== 1 || ambiguousElements.has(element) ? "binding" :
      record?.reason ?? (!record || !currentLeaf(record, root) ? "current-leaf" :
        !compatibleText(source, node, record) ? "text-or-style" : null);
    const family = !reason && record.style.fontFamily, parsed = family && parseDesignFontFamily(family);
    if (!reason && !parsed) reason = "syntax";
    if (reason) {
      result.retained += 1;
      warn(reason === "budget" ? "html-font-family-budget" : "html-font-family-unverified", node.id,
        `完整字体列表未通过当前真实文字来源校验（${reason}）；保留原来的字体投影，未截断或猜测新列表。`);
      continue;
    }
    result.admitted += 1;
    if (node.fontFamily !== family) result.restored += 1;
    node.fontFamily = family;
    const first = parsed[0];
    const matching = first.generic ? [] : resources.filter((resource) => resource.kind === "font" &&
      resource.family.toLowerCase() === first.name.toLowerCase() && resource.weight === node.fontWeight &&
      resource.style === (node.fontStyle ?? "normal"));
    if (matching.length === 1) node.fontRef = matching[0].id;
    else if (node.fontRef && !matching.some((resource) => resource.id === node.fontRef)) {
      delete node.fontRef;
      warn("html-font-family-resource-unverified", node.id,
        "原字体资源未唯一匹配当前完整列表的首个具体字体；保留 CSS 列表并移除不匹配的资源绑定。");
    }
  }
  return result;
}
