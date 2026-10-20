import type { DesignContainerNode, DesignNode } from "../upstream/packages/shared/design-node";
import type { RenderNode } from "../upstream/packages/browser/traverser/types";
import { resolveBorder } from "../upstream/packages/browser/converter/resolvers/style";

type BottomSide = DesignContainerNode["border"]["bottom"];
type CapturedNode = DesignNode & { cssTableBottomBorder?: BottomSide };
const sides = ["top", "right", "bottom", "left"] as const;

// The pinned table pass discards every interior bottom rule, even when the
// neighbouring top rule is absent. Preserve only this unopposed, solid subset;
// competing collapsed borders still require a separate conflict model.
export function captureTableBottomBorders(tree: RenderNode) {
  const nodes = new Map<Element, RenderNode>();
  const collect = (node: RenderNode) => {
    if (node.nodeType === "element" && node.domNode instanceof Element)
      nodes.set(node.domNode, node);
    node.children.forEach(collect);
  };
  collect(tree);
  const borders = new Map<object, BottomSide>();
  const border = (style: CSSStyleDeclaration) => resolveBorder(Object.fromEntries(
    sides.flatMap((side) => ["width", "style", "color"].map((part) => {
      const key = `border-${side}-${part}`;
      return [key, style.getPropertyValue(key)];
    })),
  ));
  const visible = (element: Element) => {
    const node = nodes.get(element), style = node?.computedStyle;
    return node?.visible && node.metadata?.semantic && style &&
      style.visibility === "visible" && style.opacity === "1" &&
      style.transform === "none" &&
      ["", "normal", "1"].includes(style.getPropertyValue("zoom")) &&
      ["rotate", "scale", "translate"].every((key) =>
        ["", "none"].includes(style.getPropertyValue(key))) &&
      ["::before", "::after"].every((pseudo) => ["none", "normal"].includes(
        element.ownerDocument.defaultView!.getComputedStyle(element, pseudo).content));
  };
  const unbordered = (element: Element) => {
    const style = nodes.get(element)?.computedStyle;
    return visible(element) && style && style.borderImageSource === "none" &&
      sides.every((side) => style.getPropertyValue(`border-${side}-style`) !== "hidden" &&
        border(style)[side].width === 0);
  };
  for (const [element, node] of nodes) {
    if (node.tag !== "table" || !node.metadata?.semantic || !unbordered(element)) continue;
    const style = node.computedStyle!;
    // Collapsed borders ignore border-spacing, whose computed value may still
    // be the browser's 2px default even though the effective spacing is zero.
    if (!["table", "inline-table"].includes(style.display) || style.borderCollapse !== "collapse" ||
        element.querySelector("table") ||
        element.parentElement?.closest("table")) continue;
    let transformed = false;
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const ancestorStyle = element.ownerDocument.defaultView!.getComputedStyle(ancestor);
      if (ancestorStyle.transform !== "none" || !["", "normal", "1"].includes(ancestorStyle.getPropertyValue("zoom")) || ["rotate", "scale", "translate"].some((key) =>
        !["", "none"].includes(ancestorStyle.getPropertyValue(key)))) transformed = true;
    }
    if (transformed) continue;
    const rows: Element[] = [];
    let supported = true;
    for (const child of element.children) {
      if (child.tagName === "TR") rows.push(child);
      else if (["THEAD", "TBODY", "TFOOT"].includes(child.tagName) && unbordered(child) &&
          nodes.get(child)?.computedStyle?.display === ({
            THEAD: "table-header-group", TBODY: "table-row-group", TFOOT: "table-footer-group",
          } as Record<string, string>)[child.tagName]) {
        for (const row of child.children) {
          if (row.tagName !== "TR") supported = false;
          else rows.push(row);
        }
      } else supported = false;
    }
    const candidates: [object, BottomSide][] = [];
    let columns = 0;
    for (const row of rows) {
      if (!unbordered(row) || nodes.get(row)?.computedStyle?.display !== "table-row" ||
          !row.children.length) supported = false;
      if (!columns) columns = row.children.length;
      if (row.children.length !== columns) supported = false;
      for (const cell of row.children) {
        const source = nodes.get(cell), cellStyle = source?.computedStyle;
        if (!["TD", "TH"].includes(cell.tagName) || !visible(cell) || !cellStyle ||
            cellStyle.display !== "table-cell" ||
            ["colspan", "rowspan"].some((key) => ![null, "1"].includes(cell.getAttribute(key))) ||
            cellStyle.borderImageSource !== "none" ||
            sides.some((side) => cellStyle.getPropertyValue(`border-${side}-style`) === "hidden") ||
            ["top-left", "top-right", "bottom-right", "bottom-left"].some((corner) =>
              Number.parseFloat(cellStyle.getPropertyValue(`border-${corner}-radius`)) !== 0)) {
          supported = false;
          continue;
        }
        const original = border(cellStyle), bottom = original.bottom;
        if ([original.top, original.right, original.left].some((side) => side.width !== 0) ||
            !Number.isFinite(bottom.width) || bottom.width <= 0 || bottom.width > 100 ||
            bottom.style !== "solid" || bottom.color.a !== 1) supported = false;
        candidates.push([source!.metadata!.semantic, bottom]);
      }
    }
    // Commit the proposal only after every cell and ancestor has passed.
    if (supported && rows.length && candidates.length)
      for (const [semantic, bottom] of candidates) borders.set(semantic, bottom);
  }
  return (node: CapturedNode) => {
    if (node.nodeType !== "container" || !node.semantic || !["td", "th"].includes(node.tag)) return;
    const bottom = borders.get(node.semantic);
    // Keep this paint receipt separate: upstream's layout pass and the v3
    // sizing adapter must not count a restored collapsed edge as a new inset.
    if (bottom) node.cssTableBottomBorder = { ...bottom, color: { ...bottom.color } };
  };
}
