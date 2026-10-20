import { traverseDOM } from "../upstream/packages/browser/traverser/core";
import { renderPreservingGrid } from "./grid";
import { renderToDesignDSL } from "../upstream/packages/browser/converter/convert";
import type { DesignNode } from "../upstream/packages/shared/design-node";
import type { RenderNode } from "../upstream/packages/browser/traverser/types";
import { captureStandaloneSvg } from "./svg";

type CapturedNode = DesignNode & {
  cssLayout?: Record<string, string>;
  cssBackground?: Record<string, string>;
  cssText?: Record<string, string>;
};
type TypedStyleElement = Element & {
  computedStyleMap?(): { get(property: string): { toString(): string } | undefined };
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

            "display",
            "position",
            "top",
            "right",
            "bottom",
            "left",
            "float",
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
  options: { includeRawStyles: boolean; maxDepth: number; preserveGrid: boolean },
) {
  const tree = traverseDOM(root, { maxDepth: options.maxDepth });
  if (!tree) return null;
  const values = captureLayoutValues(tree);
  const svgResources = new Map<object, string>();
  const backgrounds = new Map<object, Record<string, string>>();
  const gridSources = new Set<object>();
  const corners = new Map<object, string[]>();
  const textIntents = new Map<object, Record<string, string>>();
  const captureSvg = (node: RenderNode) => {
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
