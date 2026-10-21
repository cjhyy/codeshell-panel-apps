import type { RenderNode } from "../upstream/packages/browser/traverser/types";

// Replaced-element facts must be read before the pinned converter discards
// object-position and the distinction between percentage and pixel radii.
export function captureImageBoxes(tree: RenderNode) {
  const boxes = new Map<object, Record<string, string>>();
  const visit = (node: RenderNode) => {
    if (node.nodeType === "element" && node.tag === "img" && node.metadata?.semantic &&
        node.domNode instanceof HTMLImageElement && node.computedStyle &&
        !node.metadata.isPseudoElement && !node.metadata.isFormContent) {
      const style = node.computedStyle;
      const facts: Record<string, string> = {
        naturalWidth: String(node.domNode.naturalWidth), naturalHeight: String(node.domNode.naturalHeight),
        complete: String(node.domNode.complete),
      };
      const view = node.domNode.ownerDocument.defaultView;
      let ancestorGeometry = Boolean(view);
      let depth = 0;
      for (let ancestor = node.domNode.parentElement; ancestor && ancestorGeometry; ancestor = ancestor.parentElement) {
        if (++depth > 100) { ancestorGeometry = false; break; }
        const computed = view!.getComputedStyle(ancestor);
        ancestorGeometry = ["transform", "rotate", "scale", "translate"].every((key) => computed.getPropertyValue(key) === "none") &&
          ["1", "normal"].includes(computed.getPropertyValue("zoom"));
      }
      facts.ancestorGeometry = ancestorGeometry ? "ordinary" : "unsupported";
      for (const property of ["object-fit", "object-position", "transform", "rotate", "scale", "translate", "zoom", "filter",
        "backdrop-filter", "mix-blend-mode", "box-shadow", "outline-style", "clip-path", "mask-image",
        "background-image", "background-color", "border-image-source", "padding-top", "padding-right", "padding-bottom", "padding-left",
        "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
        "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
        "border-top-color", "border-right-color", "border-bottom-color", "border-left-color"])
        facts[property] = style.getPropertyValue(property);
      boxes.set(node.metadata.semantic, facts);
    }
    for (const child of node.children) visit(child);
  };
  visit(tree);
  return (node: { nodeType: string; semantic?: object; cssImageBox?: Record<string, string> }) => {
    if (node.nodeType === "image" && node.semantic && boxes.has(node.semantic))
      node.cssImageBox = boxes.get(node.semantic)!;
  };
}
