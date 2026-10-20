import { traverseDOM } from "../upstream/packages/browser/traverser/core";
import { renderPreservingGrid } from "./grid";
import { renderToDesignDSL } from "../upstream/packages/browser/converter/convert";
import type { DesignNode } from "../upstream/packages/shared/design-node";
import type { RenderNode } from "../upstream/packages/browser/traverser/types";
import { captureStandaloneSvg } from "./svg";
import { captureTableBottomBorders } from "./table-borders";

type CapturedNode = DesignNode & {
  cssLayout?: Record<string, string>;
  cssBackground?: Record<string, string>;
  cssText?: Record<string, string>;
  cssEmptyBlock?: true;
  cssLineHeight?: { kind: string; value?: number; fontSize: number };
};
type TypedStyleElement = Element & {
  computedStyleMap?(): { get(property: string): { toString(): string; unit?: string; value?: unknown } | undefined };
};

// getComputedStyle resolves auto/percent sizes and auto margins to pixels. Keep
// their computed CSS values separately, without changing the pinned converter
// or substituting these values into its measured geometry and paint calculations.
function captureLayoutValues(tree: RenderNode) {
  const values = new Map<object, Record<string, string>>();
  const visit = (node: RenderNode) => {
    if (node.nodeType === "element" && node.metadata?.semantic) {
      try {
        const style = (node.domNode as TypedStyleElement).computedStyleMap?.();
        if (style) {
          const properties = [
            "width",
            "border-collapse",
            "table-layout",
            "border-spacing",
            "border-image-source",
            "height",
            "min-width",
            "max-width",
            "min-height",
            "max-height",
            "flex-basis",
            "margin-top",
            "margin-right",
            "margin-bottom",
            "margin-left",
            "grid-template-columns",
            "grid-template-rows",
            "grid-template-areas",
            "grid-auto-columns",
            "grid-auto-rows",
            "grid-auto-flow",
            "grid-column-start",
            "grid-column-end",
            "grid-row-start",
            "grid-row-end",
            "justify-items",
            "align-items",
            "justify-self",
            "align-self",
            "justify-content",
            "align-content",
            "writing-mode",
            "direction",
            "order",
            "z-index",
            "aspect-ratio",
            "row-gap",
            "column-gap",
            "box-sizing",
            "padding-top",
            "padding-right",
            "padding-bottom",
            "padding-left",
            "contain",
            "contain-intrinsic-size",
            "content-visibility",

            "display",
            "position",
            "top",
            "right",
            "bottom",
            "left",
            "float",
            "shape-outside",
            "clear",
            "column-count",

          ];
          const record: Record<string, string> = {};
          for (const property of properties) {
            const value = style.get(property)?.toString();
            if (value) record[property] = value;
          }
          values.set(node.metadata.semantic, record);
        }
      } catch {
        // Older browser engines still retain the converter's measured sizes.
      }
      if (
        ["grid", "inline-grid"].includes(node.computedStyle?.display ?? "") &&
        !values.get(node.metadata.semantic)?.["grid-template-columns"]
      )
        values.set(node.metadata.semantic, { "--codeshell-grid-intent": "unavailable" });
    }
    for (const child of node.children) visit(child);
  };
  visit(tree);
  return values;
}

export function convert(
  root: Element,
  options: { includeRawStyles: boolean; maxDepth: number; preserveGrid: boolean;
    onElement?: (semanticId: string, element: Element) => void },
) {
  const tree = traverseDOM(root, { maxDepth: options.maxDepth });
  if (!tree) return null;
  const values = captureLayoutValues(tree);
  const attachTableBorder = captureTableBottomBorders(tree);
  const svgResources = new Map<object, string>();
  const backgrounds = new Map<object, Record<string, string>>();
  const gridSources = new Set<object>();
  const corners = new Map<object, string[]>();
  const textIntents = new Map<object, Record<string, string>>();
  const lineHeights = new Map<object, { kind: string; value?: number; fontSize: number }>();
  const emptyBlocks = new Set<object>();
  const captureSvg = (node: RenderNode) => {
    if (node.nodeType === "element" && node.metadata?.semantic &&
        node.domNode instanceof Element && node.computedStyle &&
        !node.metadata.isPseudoElement && !node.metadata.isFormContent && !node.metadata.listMarker) {
      const fontSize = Number.parseFloat(node.computedStyle.fontSize);
      let evidence: { kind: string; value?: number; fontSize: number } = { kind: "unavailable", fontSize };
      try {
        const value = (node.domNode as TypedStyleElement).computedStyleMap?.().get("line-height");
        if (value?.unit === "number" && typeof value.value === "number") {
          const view = node.domNode.ownerDocument.defaultView;
          const style = node.computedStyle;
          const ordinary = view && ["::before", "::after"].every((pseudo) =>
            ["none", "normal"].includes(view.getComputedStyle(node.domNode as Element, pseudo).content)) &&
            ["::first-line", "::first-letter"].every((pseudo) => {
              const variant = view.getComputedStyle(node.domNode as Element, pseudo);
              return ["fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing"]
                .every((key) => variant[key as keyof CSSStyleDeclaration] === style[key as keyof CSSStyleDeclaration]);
            });
          evidence = ordinary ? { kind: "number", value: value.value, fontSize } : { kind: "unsupported", fontSize };
        }
        else if (value?.unit === "px") evidence = { kind: "resolved-length", fontSize };
        else if (value?.toString() === "normal") evidence = { kind: "normal", fontSize };
        else if (value) evidence = { kind: "unsupported", fontSize };
      } catch { /* Missing Typed OM is explicit evidence of the fallback boundary. */ }
      lineHeights.set(node.metadata.semantic, evidence);
    }
    if (node.nodeType === "element" && node.metadata?.semantic &&
        node.domNode instanceof Element && !node.metadata.isPseudoElement && !node.metadata.isFormContent)
      options.onElement?.(node.metadata.semantic.semanticId ?? "", node.domNode);
    // An empty converted child list can also mean discarded text or generated
    // content. Only the live DOM can establish an ordinary empty block.
    if (node.nodeType === "element" && node.metadata?.semantic &&
        node.domNode instanceof Element && node.computedStyle &&
        !node.metadata.isPseudoElement && !node.metadata.isFormContent && !node.metadata.listMarker &&
        ["block", "flow-root"].includes(node.computedStyle.display) &&
        node.domNode.childElementCount === 0 &&
        !/[^\t\n\f\r ]/u.test(node.domNode.textContent ?? "") &&
        ["normal", "nowrap"].includes(node.computedStyle.whiteSpace)) {
      const element = node.domNode;
      const window = element.ownerDocument.defaultView;
      if (window && ["::before", "::after"].every((pseudo) =>
        ["none", "normal"].includes(window.getComputedStyle(element, pseudo).content)))
        emptyBlocks.add(node.metadata.semantic);
    }
    if (
      node.metadata?.semantic &&
      ["grid", "inline-grid"].includes(node.computedStyle?.display ?? "")
    )
      gridSources.add(node.metadata.semantic);
    if (node.tag === "svg" && node.metadata?.semantic && node.domNode instanceof Element)
      svgResources.set(node.metadata.semantic, captureStandaloneSvg(node.domNode));
    if (node.nodeType === "element" && node.metadata?.semantic && node.computedStyle)
      corners.set(node.metadata.semantic, ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"].map((property) => node.computedStyle!.getPropertyValue(property)));
    if (node.nodeType === "element" && node.metadata?.semantic && node.computedStyle &&
        node.domNode instanceof Element &&
        (node.domNode.childElementCount === 0 && ["nowrap", "pre"].includes(node.computedStyle.whiteSpace) || node.computedStyle.textOverflow !== "clip")) {
      const style = node.computedStyle;
      textIntents.set(node.metadata.semantic, {
        rawSource: node.domNode.textContent ?? "", whiteSpace: style.whiteSpace,
        childElements: String(node.domNode.childElementCount),
        generatedContent: String(Boolean(node.metadata.listMarker || node.children.some((child) =>
          child.metadata?.isPseudoElement || child.metadata?.isFormContent))),
        textOverflow: style.textOverflow, overflowX: style.overflowX, overflowY: style.overflowY,
        writingMode: style.writingMode, direction: style.direction, lineHeight: style.lineHeight,
        textIndent: style.textIndent, wordSpacing: style.wordSpacing, textTransform: style.textTransform,
      });
    }
    // The immutable upstream gradient parser discards px stop units and cannot
    // distinguish repeated gradients. Retain computed CSS before that parse.
    if (node.nodeType === "element" && node.metadata?.semantic &&
        node.computedStyle?.getPropertyValue("background-image").includes("gradient(")) {
      const background: Record<string, string> = {};
      for (const property of [
        "background-image", "background-color", "background-size", "background-position",
        "background-repeat", "background-origin", "background-clip", "background-blend-mode",
        "background-attachment", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
      ]) background[property] = node.computedStyle.getPropertyValue(property);
      backgrounds.set(node.metadata.semantic, background);
    }
    for (const child of node.children) captureSvg(child);
  };
  captureSvg(tree);
  const result = options.preserveGrid
    ? renderPreservingGrid(tree, options)
    : renderToDesignDSL(tree, options);
  const attach = (node: CapturedNode) => {
    attachTableBorder(node);
    if (node.nodeType === "text" && node.semantic && lineHeights.has(node.semantic))
      node.cssLineHeight = lineHeights.get(node.semantic)!;
    // Anonymous text inherits its parent's semantic metadata and CSS styles;
    // applying the parent's box dimensions to that text would be incorrect.
    const cssLayout = node.nodeType !== "text" && node.semantic && values.get(node.semantic);
    if (cssLayout && Object.keys(cssLayout).length > 0) node.cssLayout = cssLayout;
    if (
      !options.preserveGrid &&
      node.nodeType === "container" &&
      node.semantic &&
      gridSources.has(node.semantic)
    )
      node.cssLayout = { ...node.cssLayout, "--codeshell-grid-legacy": "synthetic" };
    if (node.nodeType === "container" && node.semantic && textIntents.has(node.semantic))
      node.cssText = textIntents.get(node.semantic)!;
    if (node.nodeType === "container" && node.semantic && emptyBlocks.has(node.semantic))
      node.cssEmptyBlock = true;
    if (node.nodeType !== "text" && node.semantic && corners.has(node.semantic))
      node.cssBorderRadii = corners.get(node.semantic)!;
    if (node.nodeType !== "text" && node.semantic && backgrounds.has(node.semantic))
      node.cssBackground = backgrounds.get(node.semantic)!;
    if (node.nodeType === "svg" && node.semantic && svgResources.has(node.semantic))
      node.svgContent = svgResources.get(node.semantic)!;
    if (node.nodeType === "container") for (const child of node.children) attach(child);
  };
  if (result) attach(result);
  return result;
}
