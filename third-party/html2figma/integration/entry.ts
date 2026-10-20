import { traverseDOM } from "../upstream/packages/browser/traverser/core";
import { renderToDesignDSL } from "../upstream/packages/browser/converter/convert";
import type { DesignNode } from "../upstream/packages/shared/design-node";
import type { RenderNode } from "../upstream/packages/browser/traverser/types";

type CapturedNode = DesignNode & { cssLayout?: Record<string, string> };
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
            "flex-basis",
            "margin-top",
            "margin-right",
            "margin-bottom",
            "margin-left",
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
    }
    for (const child of node.children) visit(child);
  };
  visit(tree);
  return values;
}

export function convert(root: Element, options: { includeRawStyles: boolean; maxDepth: number }) {
  const tree = traverseDOM(root, { maxDepth: options.maxDepth });
  if (!tree) return null;
  const values = captureLayoutValues(tree);
  const result = renderToDesignDSL(tree, options);
  const attach = (node: CapturedNode) => {
    // Anonymous text inherits its parent's semantic metadata and CSS styles;
    // applying the parent's box dimensions to that text would be incorrect.
    const cssLayout = node.nodeType !== "text" && node.semantic && values.get(node.semantic);
    if (cssLayout && Object.keys(cssLayout).length > 0) node.cssLayout = cssLayout;
    if (node.nodeType === "container") for (const child of node.children) attach(child);
  };
  if (result) attach(result);
  return result;
}
