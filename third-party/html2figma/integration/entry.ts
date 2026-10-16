import { traverseDOM } from "../upstream/packages/browser/traverser/core";
import { renderToDesignDSL } from "../upstream/packages/browser/converter/convert";

export function convert(root: Element, options: { includeRawStyles: boolean; maxDepth: number }) {
  const tree = traverseDOM(root, { maxDepth: options.maxDepth });
  return tree ? renderToDesignDSL(tree, options) : null;
}
