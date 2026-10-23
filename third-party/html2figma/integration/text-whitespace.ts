import type { RenderNode } from "../upstream/packages/browser/traverser/types";

export type TextWhitespaceRecovery = {
  whiteSpace: "normal" | "nowrap";
  rawSource: string;
  removedTrailingNbsp?: true;
  omittedPseudos?: string[];
};

const collapseAscii = (value: string) =>
  value.replace(/[\t\n\f\r ]+/gu, " ").replace(/^ | $/gu, "");
const noPaintPseudo = (node: RenderNode, element: Element) => {
  const style = node.computedStyle;
  if (!style || node.domNode !== element || node.nodeType !== "element" ||
      node.metadata?.isPseudoElement !== true || !["::before", "::after"].includes(node.tag ?? "") ||
      !['""', "''"].includes(style.content) || node.textContent || node.children.length ||
      !["absolute", "fixed"].includes(style.position) || style.display !== "block" ||
      style.appearance !== "none" || style.textDecorationLine !== "none" ||
      style.overflowX !== "visible" || style.overflowY !== "visible" || style.resize !== "none") return false;
  return ["transparent", "rgba(0, 0, 0, 0)"].includes(style.backgroundColor) &&
    style.backgroundImage === "none" && style.boxShadow === "none" && style.textShadow === "none" &&
    ["Top", "Right", "Bottom", "Left"].every((side) =>
      style[`border${side}Style` as keyof CSSStyleDeclaration] === "none" &&
      style[`border${side}Width` as keyof CSSStyleDeclaration] === "0px") &&
    style.borderImageSource === "none" && style.outlineStyle === "none" &&
    style.filter === "none" && style.backdropFilter === "none" &&
    style.clip === "auto" && style.clipPath === "none" && style.maskImage === "none" &&
    style.getPropertyValue("-webkit-box-reflect") === "none" &&
    style.transform === "none" && style.mixBlendMode === "normal" &&
    style.visibility === "visible" && style.opacity === "1";
};

// Correct only a current live Text node whose ASCII suffix the browser proves
// discarded. The pinned normalizer appends NBSP even after trimming that suffix.
// Clone the owned render tree; neither the DOM nor immutable upstream is edited.
export function recoverCollapsedTextWhitespace(tree: RenderNode) {
  const recovered = new Map<object, TextWhitespaceRecovery>();
  const visit = (source: RenderNode): RenderNode => {
    const node = { ...source, children: source.children.map(visit) };
    const element = node.domNode;
    const style = node.computedStyle;
    if (node.nodeType !== "element" || !(element instanceof Element) ||
        element.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
        !node.metadata?.semantic || node.metadata.isPseudoElement || node.metadata.isFormContent ||
        node.metadata.listMarker || !style || element.childNodes.length !== 1 ||
        !(element.firstChild instanceof Text) ||
        element.matches("button,input,select,textarea,option,svg,canvas,video,audio,object,embed,iframe") ||
        !["normal", "nowrap"].includes(style.whiteSpace) || style.direction !== "ltr" ||
        style.writingMode !== "horizontal-tb" || style.visibility !== "visible" ||
        style.textTransform !== "none" || !["normal", "0px"].includes(style.wordSpacing) ||
        style.fontFamily.length > 256) return node;
    const textNode = element.firstChild;
    const rawSource = textNode.data;
    // Do not repair upstream's separate Unicode-space/ZWJ behavior here.
    if (!rawSource || rawSource.length > 1000 || JSON.stringify(rawSource).length > 1000 ||
        /\s/u.test(rawSource.replace(/[\t\n\f\r ]/gu, "")) ||
        /[\u200b\u200c\u200d]/u.test(rawSource)) return node;
    const text = node.children.filter((child) => child.nodeType === "text" && child.domNode === textNode &&
      !child.metadata?.isPseudoElement && !child.metadata?.isFormContent && !child.metadata?.isTextSegment);
    if (text.length !== 1 || node.children.some((child) => child !== text[0] && !noPaintPseudo(child, element))) return node;
    const view = element.ownerDocument.defaultView;
    if (!view || !["::before", "::after"].every((pseudo) => {
      const current = view.getComputedStyle(element, pseudo);
      return ["none", "normal"].includes(current.content) || current.display === "none" ||
        node.children.some((child) => child.tag === pseudo && noPaintPseudo(child, element));
    })) return node;
    const receipt: TextWhitespaceRecovery = {
      whiteSpace: style.whiteSpace as "normal" | "nowrap", rawSource,
    };
    const omitted = node.children.filter((child) => child !== text[0]);
    let nextText = text[0];
    const suffix = /[\t\n\f\r ]+$/u.exec(rawSource);
    if (suffix && text[0].textContent?.endsWith("\u00a0") &&
        collapseAscii(text[0].textContent.replace(/\u00a0/gu, " ")) === collapseAscii(rawSource)) {
      try {
        const range = element.ownerDocument.createRange();
        range.setStart(textNode, suffix.index);
        range.setEnd(textNode, rawSource.length);
        const rects = Array.from(range.getClientRects());
        if (rects.length > 0 && rects.every((rect) => rect.width === 0) &&
            range.getBoundingClientRect().width === 0 &&
            !text[0].textContent.slice(0, -1).endsWith("\n")) {
          nextText = { ...text[0], textContent: text[0].textContent.slice(0, -1) };
          receipt.removedTrailingNbsp = true;
        }
      } catch { /* An unavailable Range proof leaves the exact captured text. */ }
    }
    if (omitted.length) receipt.omittedPseudos = omitted.map((child) => child.tag!);
    if (!receipt.removedTrailingNbsp && !receipt.omittedPseudos) return node;
    recovered.set(node.metadata.semantic, receipt);
    return { ...node, children: [nextText] };
  };
  return { tree: visit(tree), recovered };
}
