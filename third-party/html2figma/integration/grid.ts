import type { DesignNode } from "../upstream/packages/shared/design-node";
import type { RenderNode } from "../upstream/packages/browser/traverser/types";
import { renderToDesignDSL } from "../upstream/packages/browser/converter/convert";
import {
  buildContainerNode,
  buildTextNode,
} from "../upstream/packages/browser/converter/nodeBuilder";

// The pinned converter replaces Grid with pixel-sized Flex rows/cells. Keep
// Grid children outside that postprocessor, then convert each original item
// through the same converter. The input tree and DOM are never mutated.
export function renderPreservingGrid(
  tree: RenderNode,
  options: { includeRawStyles: boolean; maxDepth: number },
): DesignNode | null {
  const grids = new Map<object, RenderNode>();
  const prune = (node: RenderNode): RenderNode => {
    if (
      node.nodeType === "element" &&
      ["grid", "inline-grid"].includes(node.computedStyle?.display ?? "") &&
      node.metadata?.semantic
    ) {
      grids.set(node.metadata.semantic, node);
      return { ...node, children: [] };
    }
    return { ...node, children: node.children.map(prune) };
  };
  const result = renderToDesignDSL(prune(tree), options);
  const restore = (node: DesignNode) => {
    if (node.nodeType !== "container") return;
    const original = node.semantic && grids.get(node.semantic);
    if (original) {
      const rect = original.boundingRect;
      const local = buildContainerNode(original, rect?.left ?? 0, rect?.top ?? 0, false);
      node.children = original.children.flatMap((child) => {
        // Anonymous Grid text still inherits its actual parent's CSS. A
        // standalone renderToDesignDSL(text) has no parent style context.
        const converted =
          child.nodeType === "text"
            ? buildTextNode(
                child,
                original,
                child.boundingRect?.left ?? 0,
                child.boundingRect?.top ?? 0,
                options.includeRawStyles,
              )
            : renderPreservingGrid(child, options);
        if (!converted) return [];
        if (converted.nodeType === "text" && !converted.content) return [];
        converted.bounds.x += (child.boundingRect?.left ?? 0) - (rect?.left ?? 0) - local.bounds.x;
        converted.bounds.y += (child.boundingRect?.top ?? 0) - (rect?.top ?? 0) - local.bounds.y;
        return [converted];
      });
      // CSS order affects Grid placement. Keep absolute/fixed items in their
      // original slots, as the upstream sorter does for ordinary containers.
      const flow = node.children
        .filter((child) => !["absolute", "fixed"].includes(child.positioning.mode))
        .sort((left, right) => (left.flexItem?.order ?? 0) - (right.flexItem?.order ?? 0));
      let index = 0;
      node.children = node.children.map((child) =>
        ["absolute", "fixed"].includes(child.positioning.mode) ? child : flow[index++],
      );
    } else for (const child of node.children) restore(child);
  };
  if (result) restore(result);
  return result;
}
