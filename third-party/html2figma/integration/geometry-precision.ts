import type { RenderNode } from "../upstream/packages/browser/traverser/types";

type GeometryValue = { value: number; projection: number };
type GeometryNode = {
  nodeType: string; tag?: string; semantic?: object;
  cssGeometry?: Record<string, GeometryValue>;
  cssLayout?: Record<string, string>;
};

// CSSOM strings have fewer decimal digits than CSSUnitValue.value. Capture only
// actual finite px values from the same real Element/semantic object that the
// pinned traversal owns. Percentage, keyword and CSSMathValue intent stays with
// the existing converter; this never infers a pixel value from an authored token.
export function captureGeometryPrecision(tree: RenderNode) {
  const records = new Map<object, { tag: string; values: Record<string, GeometryValue> }>();
  const properties = ["width", "height", "min-width", "max-width", "min-height", "max-height",
    "flex-basis", "row-gap", "column-gap", "padding-top", "padding-right", "padding-bottom", "padding-left"];
  const visit = (node: RenderNode) => {
    if (node.nodeType === "element" && node.tag && node.metadata?.semantic &&
        node.domNode instanceof Element && node.computedStyle &&
        !node.metadata.isPseudoElement && !node.metadata.isFormContent && !node.metadata.listMarker) {
      const values: Record<string, GeometryValue> = {};
      try {
        const style = (node.domNode as Element & { computedStyleMap?(): {
          get(property: string): { unit?: string; value?: unknown } | undefined;
        } }).computedStyleMap?.();
        for (const property of properties) {
          const typed = style?.get(property), projection = Number.parseFloat(node.computedStyle.getPropertyValue(property));
          if (typed?.unit === "px" && typeof typed.value === "number" &&
              Number.isFinite(typed.value) && Number.isFinite(projection))
            values[property] = { value: Object.is(typed.value, -0) ? 0 : typed.value, projection };
        }
      } catch { /* Missing Typed OM retains the old numeric projection. */ }
      records.set(node.metadata.semantic, { tag: node.tag, values });
    }
    for (const child of node.children) visit(child);
  };
  visit(tree);
  return (node: GeometryNode) => {
    const record = node.semantic && records.get(node.semantic);
    // Anonymous text and synthetic margin/line wrappers must not acquire their
    // source Element's padding or size. Only its actual tagged box is eligible.
    if (!record || node.nodeType === "text" || node.tag !== record.tag) return;
    node.cssGeometry = record.values;
    if (node.cssLayout) node.cssLayout = { ...node.cssLayout,
      ...Object.fromEntries(Object.entries(record.values).map(([key, { value }]) => [key, `${value}px`])) };
  };
}
