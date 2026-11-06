/* Presentation-only Blink box geometry. The document and SVG retain precise
 * authored boxes. Supported CSS absolute paths quantize each local layout
 * value to 1/64px, then snap world box edges before view scale / DPR. */
const paintTypes = new Set(["rectangle", "frame", "component", "ellipse", "image"]);
const containerTypes = new Set(["frame", "group", "component"]);
const layoutUnit = value => Math.trunc(value * 64) / 64;

export function browserPaintBoxes(sourceNodes) {
  const index = new Map(sourceNodes.map(node => [node.id, node]));
  const referenced = new Set(sourceNodes.filter(node => node.type === "instance").map(node => node.componentId));
  const phases = new Map(), visiting = new Set(), nodes = new Map(), fallbackReasons = new Map();
  const stats = { input: sourceNodes.length, eligible: 0, changed: 0, fallback: 0, reasons: {} };
  const ownReason = node => {
    if (node.type === "instance") return "instance";
    if (referenced.has(node.id)) return "referenced-component";
    if (!paintTypes.has(node.type) && node.type !== "group") return "unsupported-type";
    if (![node.x, node.y, node.width, node.height].every(Number.isFinite) || node.width < 0 || node.height < 0) return "invalid-box";
    if (node.rotation) return "rotated";
    if (node.strokeSides !== undefined) return "stroke-sides";
    if (node.strokeAlign === "inside" && node.strokeWidth > 0 && !["transparent", "none"].includes(node.stroke)) return "inside-border";
    if ([node.layoutSizingHorizontal, node.layoutSizingVertical].some(value => value !== undefined && value !== "fixed")) return "dynamic-size";
    if ([node.constraintHorizontal, node.constraintVertical].some(value => value !== undefined && value !== "start")) return "constraint";
    if ([node.constraintLeft, node.constraintTop, node.constraintRight, node.constraintBottom].some(value => value !== undefined)) return "constraint-offset";
    if (node.layoutMarginBefore !== undefined) return "layout-margin";
    return null;
  };
  const phase = node => {
    if (phases.has(node.id)) return phases.get(node.id);
    if (visiting.has(node.id)) return { reason: "parent-cycle" };
    visiting.add(node.id);
    let reason = ownReason(node), parent, parentPhase;
    if (!reason && node.parentId) {
      parent = index.get(node.parentId);
      if (!parent) reason = "missing-parent";
      else if (!containerTypes.has(parent.type)) reason = "unsupported-parent";
      else {
        parentPhase = phase(parent);
        if (parentPhase.reason) reason = `ancestor:${parentPhase.reason}`;
        else if (parent.layout && parent.layout !== "none" && node.layoutPositioning !== "absolute") reason = "flow-owned";
      }
    }
    const result = reason ? { reason } : {
      x: (parentPhase?.x ?? 0) + layoutUnit(node.x - (parent?.x ?? 0)),
      y: (parentPhase?.y ?? 0) + layoutUnit(node.y - (parent?.y ?? 0)),
      width: layoutUnit(node.width), height: layoutUnit(node.height),
    };
    // Negative local offsets are measured. Fractional negative world origins
    // need a view-translation probe before claiming the same paint tie rule.
    if (!result.reason && [result.x, result.y].some(value => value < 0 && !Number.isInteger(value)))
      result.reason = "negative-world-phase-unverified";
    visiting.delete(node.id); phases.set(node.id, result); return result;
  };
  for (const node of sourceNodes) {
    const box = phase(node);
    const reason = box.reason ?? (!paintTypes.has(node.type) ? "unsupported-type" : null);
    if (reason) {
      nodes.set(node.id, node); fallbackReasons.set(node.id, reason);
      stats.fallback++; stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1; continue;
    }
    stats.eligible++;
    const x = Math.round(box.x), y = Math.round(box.y);
    const width = Math.round(box.x + box.width) - x, height = Math.round(box.y + box.height) - y;
    const changed = x !== node.x || y !== node.y || width !== node.width || height !== node.height;
    nodes.set(node.id, changed ? { ...node, x, y, width, height } : node);
    if (changed) stats.changed++;
  }
  return { nodes, stats, fallbackReasons };
}
