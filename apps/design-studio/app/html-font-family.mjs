import { parseDesignFontFamily, MAX_DESIGN_FONT_FAMILY_LENGTH } from "./font-family.mjs";

const styleKeys = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "whiteSpace",
  "textTransform", "visibility", "display", "direction", "writingMode"];
const legacyFamily = (value) => value.split(",")[0].trim().replace(/['"]/gu, "");
const normalText = (value) => value.replace(/[\t\n\f\r ]+/gu, " ").replace(/^ | $/gu, "");

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
  if (node.text !== source.content || node.textSource !== source.content ||
      typeof source.content !== "string" || (source.styledSegments?.length ?? 0) > 1 ||
      source.textStyle?.fontFamily !== legacyFamily(record.style.fontFamily) ||
      node.fontFamily !== legacyFamily(record.style.fontFamily)) return false;
  if (["normal", "nowrap"].includes(record.style.whiteSpace)) {
    // Compare the upstream display projection only; never replace any text byte.
    const legacy = (value) => normalText(value.replace(/\u00a0/gu, " "));
    return legacy(source.content) === legacy(record.text);
  }
  return source.content === record.text;
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
