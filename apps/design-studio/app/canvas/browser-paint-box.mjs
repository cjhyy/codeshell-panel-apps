/* Presentation-only Blink geometry. Replay the supported CSS subset in integer
 * LayoutUnits before snapping all four paint edges. Saved layout, hit testing,
 * SVG and text origins remain owned by their existing paths. */
const paintTypes = new Set(["rectangle", "frame", "component", "ellipse", "image"]);
const containerTypes = new Set(["frame", "group", "component"]);
const unit = value => Math.trunc(value * 64);
const sizing = (node, axis) => node[axis === "width" ? "layoutSizingHorizontal" : "layoutSizingVertical"] ?? "fixed";
const flex = node => ["horizontal", "vertical"].includes(node?.layout);
const mainAxis = node => node.layout === "horizontal" ? "width" : "height";
const crossAxis = node => node.layout === "horizontal" ? "height" : "width";
const pad = (node, axis) => (axis === "width" ? ["Left", "Right"] : ["Top", "Bottom"])
  .map(side => unit(Math.max(0, node[`padding${side}`] ?? node.padding ?? 0)));
const alignment = value => value ?? "start";
const aligned = (remaining, align) => align === "center" ? Math.trunc(remaining / 2) : align === "end" ? remaining : 0;

export function browserPaintBoxes(sourceNodes) {
  const index = new Map(sourceNodes.map(node => [node.id, node]));
  const children = new Map();
  for (const node of sourceNodes) {
    if (!children.has(node.parentId)) children.set(node.parentId, []);
    if (node.visible !== false && node.layoutPositioning !== "absolute") children.get(node.parentId).push(node);
  }
  const referenced = new Set(sourceNodes.filter(node => node.type === "instance").map(node => node.componentId));
  const phases = new Map(), dimensions = new Map(), visiting = new Set(), sizingNow = new Set();
  const nodes = new Map(), fallbackReasons = new Map();
  const stats = { input: sourceNodes.length, eligible: 0, changed: 0, fallback: 0, reasons: {} };
  const ownReason = node => {
    if (node.type === "instance") return "instance";
    if (referenced.has(node.id)) return "referenced-component";
    if (!paintTypes.has(node.type) && !["group", "text"].includes(node.type)) return "unsupported-type";
    if (![node.x, node.y, node.width, node.height].every(Number.isFinite) || node.width < 0 || node.height < 0) return "invalid-box";
    if (node.rotation) return "rotated";
    if (node.strokeSides !== undefined) return "stroke-sides";
    if (node.strokeAlign === "inside" && node.strokeWidth > 0 && !["transparent", "none"].includes(node.stroke)) return "inside-border";
    if ([node.constraintHorizontal, node.constraintVertical].some(value => value !== undefined && value !== "start")) return "constraint";
    if ([node.constraintLeft, node.constraintTop, node.constraintRight, node.constraintBottom].some(value => value !== undefined)) return "constraint-offset";
    if (node.layoutMarginBefore !== undefined) return "layout-margin";
    if (["minWidth", "maxWidth", "minHeight", "maxHeight"].some(key => node[key] !== undefined)) return "size-limits";
    if (node.layout === "grid") return "grid";
    if (node.layoutWrap && node.layoutWrap !== "none") return "wrap";
    if (node.layoutReverse) return "reverse";
    if (flex(node) && (node[node.layout === "horizontal" ? "columnGap" : "rowGap"] ?? node.gap ?? 0) < 0) return "negative-gap";
    if (flex(node) && !["start", "center", "end", "stretch"].includes(alignment(node.alignItems))) return "cross-alignment";
    if (flex(node) && !["start", "center", "end"].includes(alignment(node.justifyContent))) return "justify-content";
    if (node.layoutAlignSelf && node.layoutAlignSelf !== "auto") return "self-alignment-unverified";
    return null;
  };
  // Size first, independently of world origin. Intrinsic text widths are Blink's
  // enclosing LayoutUnit; fixed CSS lengths and every padding/gap truncate.
  const size = (node, axis) => {
    const key = `${node.id}:${axis}`;
    if (dimensions.has(key)) return dimensions.get(key);
    if (sizingNow.has(key)) return { reason: "circular-size" };
    sizingNow.add(key);
    let reason = ownReason(node), value;
    const parent = index.get(node.parentId), inFlow = flex(parent) && node.layoutPositioning !== "absolute";
    const mode = sizing(node, axis), self = node.layoutAlignSelf && node.layoutAlignSelf !== "auto" ? node.layoutAlignSelf : alignment(parent?.alignItems);
    if (!reason && inFlow && axis === mainAxis(parent) && mode === "fill") reason = "main-axis-flex-grow";
    if (!reason && inFlow && axis === crossAxis(parent) && (mode === "fill" || self === "stretch")) {
      const owner = size(parent, axis);
      if (owner.reason) reason = `parent-size:${owner.reason}`;
      else value = Math.max(0, owner.value - pad(parent, axis).reduce((a, b) => a + b, 0));
    } else if (!reason && mode === "fill") reason = "dynamic-size";
    else if (!reason && mode === "hug" && flex(node)) {
      const sizes = (children.get(node.id) ?? []).map(child => size(child, axis));
      const failed = sizes.find(result => result.reason);
      if (failed) reason = `child-size:${failed.reason}`;
      else {
        const gap = unit(Math.max(0, node[node.layout === "horizontal" ? "columnGap" : "rowGap"] ?? node.gap ?? 0));
        value = pad(node, axis).reduce((a, b) => a + b, 0) + (axis === mainAxis(node)
          ? sizes.reduce((sum, result) => sum + result.value, 0) + gap * Math.max(0, sizes.length - 1)
          : Math.max(0, ...sizes.map(result => result.value)));
      }
    } else if (!reason && mode === "hug" && node.type === "text") {
      value = axis === "width" ? Math.ceil(node.width * 64) : unit(node.height);
    } else if (!reason && mode !== "fixed" && mode !== "hug") reason = "dynamic-size";
    else if (!reason && mode === "hug" && node.type === "image") reason = "intrinsic-image";
    else if (!reason) value = unit(node[axis]);
    sizingNow.delete(key);
    const result = reason ? { reason } : { value };
    dimensions.set(key, result); return result;
  };
  const phase = node => {
    if (phases.has(node.id)) return phases.get(node.id);
    if (visiting.has(node.id)) return { reason: "parent-cycle" };
    visiting.add(node.id);
    let reason = ownReason(node), parent, parentPhase, x, y;
    const width = size(node, "width"), height = size(node, "height");
    reason ??= width.reason ?? height.reason;
    if (!reason && node.parentId) {
      parent = index.get(node.parentId);
      if (!parent) reason = "missing-parent";
      else if (!containerTypes.has(parent.type)) reason = "unsupported-parent";
      else {
        parentPhase = phase(parent);
        if (parentPhase.reason) reason = `ancestor:${parentPhase.reason}`;
      }
    }
    if (!reason && flex(parent) && node.layoutPositioning !== "absolute") {
      const main = mainAxis(parent), cross = crossAxis(parent), siblings = children.get(parent.id) ?? [];
      const sizes = siblings.map(child => size(child, main));
      const failed = sizes.find(result => result.reason);
      if (failed) reason = `sibling-size:${failed.reason}`;
      else {
        const mainPad = pad(parent, main), crossPad = pad(parent, cross);
        const gap = unit(Math.max(0, parent[parent.layout === "horizontal" ? "columnGap" : "rowGap"] ?? parent.gap ?? 0));
        const remaining = parentPhase[main] - mainPad[0] - mainPad[1] - sizes.reduce((sum, result) => sum + result.value, 0) - gap * Math.max(0, siblings.length - 1);
        const before = siblings.findIndex(child => child.id === node.id);
        const mainOffset = mainPad[0] + aligned(remaining, alignment(parent.justifyContent)) + sizes.slice(0, before).reduce((sum, result) => sum + result.value + gap, 0);
        const self = node.layoutAlignSelf && node.layoutAlignSelf !== "auto" ? node.layoutAlignSelf : alignment(parent.alignItems);
        const crossSize = cross === "width" ? width.value : height.value;
        const crossOffset = crossPad[0] + aligned(parentPhase[cross] - crossPad[0] - crossPad[1] - crossSize, self);
        x = parentPhase.x + (main === "width" ? mainOffset : crossOffset);
        y = parentPhase.y + (main === "height" ? mainOffset : crossOffset);
      }
    } else if (!reason) {
      x = (parentPhase?.x ?? 0) + unit(node.x - (parent?.x ?? 0));
      y = (parentPhase?.y ?? 0) + unit(node.y - (parent?.y ?? 0));
    }
    const result = reason ? { reason } : { x, y, width: width.value, height: height.value };
    if (!reason && [result.x, result.y].some(value => value < 0 && value % 64 !== 0)) result.reason = "negative-world-phase-unverified";
    // This is a replay safety boundary, not a visual acceptance tolerance.
    if (!result.reason && ["x", "y", "width", "height"].some(key => Math.abs(result[key] / 64 - node[key]) > .25)) result.reason = "LAYOUT_MISMATCH";
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
    const x = Math.round(box.x / 64), y = Math.round(box.y / 64);
    const width = Math.round((box.x + box.width) / 64) - x, height = Math.round((box.y + box.height) / 64) - y;
    const changed = x !== node.x || y !== node.y || width !== node.width || height !== node.height;
    nodes.set(node.id, changed ? { ...node, x, y, width, height } : node);
    if (changed) stats.changed++;
  }
  const layoutBoxes = new Map([...phases].map(([id, box]) => [id, box.reason ? box : Object.fromEntries(Object.entries(box).map(([key, value]) => [key, value / 64]))]));
  return { nodes, stats, fallbackReasons, layoutBoxes };
}
