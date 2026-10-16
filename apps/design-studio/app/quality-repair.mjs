import { auditDesignPages, readableTextContrast, summarizeAudit } from "./audit.mjs";
import { isDesignNodeVisible, normalizeDesignState, renderedDesignInstanceEffectOutsets } from "./document.mjs";
import { clipBoundsToClippingAncestors, clipNodeBoundsToClippingAncestors, pointFromNodeSpace } from "./geometry.mjs";
import { measuredTextInkBounds } from "./text-metrics.mjs";

const round = (value) => Math.round(value * 10000) / 10000;
const mix = (color, target, amount) => `#${[1, 3, 5].map((offset) =>
  Math.round(parseInt(color.slice(offset, offset + 2), 16) * (1 - amount) + target * amount)
    .toString(16).padStart(2, "0")).join("")}`;

function treeMatches(node, byId, predicate) {
  const seen = new Set();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    if (predicate(node)) return true;
    node = byId.get(node.parentId);
  }
  return false;
}

function descendantsOf(parent, childrenById) {
  const pending = [...(childrenById.get(parent.id) ?? [])], nodes = [];
  while (pending.length) {
    const node = pending.pop();
    nodes.push(node);
    pending.push(...(childrenById.get(node.id) ?? []));
  }
  return nodes;
}

function visibleEffectBounds(view, node, byId) {
  if (node.type === "group") return null;
  const ink = measuredTextInkBounds(node);
  const stroke = !["group", "instance"].includes(node.type) && node.stroke !== "transparent" ? node.strokeWidth / 2 : 0;
  const shadow = node.shadow?.opacity > 0 ? node.shadow : null;
  const blur = shadow ? shadow.blur * 1.5 : 0;
  const instance = node.type === "instance" ? renderedDesignInstanceEffectOutsets(view, node)
    : { left: 0, right: 0, top: 0, bottom: 0 };
  const left = Math.max(instance.left, stroke, shadow ? stroke + blur + Math.max(0, -shadow.x) : 0);
  const right = Math.max(instance.right, stroke, shadow ? stroke + blur + Math.max(0, shadow.x) : 0);
  const top = Math.max(instance.top, stroke, shadow ? stroke + blur + Math.max(0, -shadow.y) : 0);
  const bottom = Math.max(instance.bottom, stroke, shadow ? stroke + blur + Math.max(0, shadow.y) : 0);
  if (!ink && Math.max(left, right, top, bottom) === 0)
    return clipNodeBoundsToClippingAncestors(view.nodes, node, byId);
  const base = ink ?? { x: 0, y: 0, width: node.width, height: node.height };
  const x = node.x + base.x - left, y = node.y + base.y - top;
  const width = base.width + left + right, height = base.height + top + bottom;
  const points = [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
    .map((point) => pointFromNodeSpace(view.nodes, node, point, byId));
  if (points.some((point) => !point)) return null;
  const minX = Math.min(...points.map((point) => point.x)), minY = Math.min(...points.map((point) => point.y));
  return clipBoundsToClippingAncestors(view.nodes, node, {
    x: minX, y: minY, width: Math.max(...points.map((point) => point.x)) - minX,
    height: Math.max(...points.map((point) => point.y)) - minY,
  }, byId);
}

// An explicit edit, never an import/audit side effect. Keep the original intact
// and report each edit; clipping, text, source bindings and gradients are retained.
export function repairDesignQuality(input) {
  const document = normalizeDesignState(structuredClone(input));
  const before = summarizeAudit(auditDesignPages(document));
  const changes = [];
  for (const page of document.pages) {
    const view = { ...document, activePageId: page.id, nodes: page.nodes };
    const byId = new Map(page.nodes.map((node) => [node.id, node]));
    const childrenById = new Map();
    for (const node of page.nodes) {
      const siblings = childrenById.get(node.parentId) ?? [];
      siblings.push(node);
      childrenById.set(node.parentId, siblings);
    }
    // Work from leaves to roots so a parent is expanded only once. Child geometry
    // uses page coordinates: extending an unclipped frame does not move content.
    for (const parent of [...page.nodes].reverse()) {
      if (!["frame", "group", "component"].includes(parent.type) || parent.clipContent === true ||
          treeMatches(parent, byId, (node) => node.locked || node.rotation)) continue;
      const children = descendantsOf(parent, childrenById).filter((node) => isDesignNodeVisible(view, node, byId));
      if (!children.length) continue;
      const bounds = children.map((node) => visibleEffectBounds(view, node, byId)).filter(Boolean);
      if (!bounds.length) continue;
      const x = Math.min(parent.x, ...bounds.map((box) => box.x));
      const y = Math.min(parent.y, ...bounds.map((box) => box.y));
      const right = Math.max(parent.x + parent.width, ...bounds.map((box) => box.x + box.width));
      const bottom = Math.max(parent.y + parent.height, ...bounds.map((box) => box.y + box.height));
      const next = { x: round(x), y: round(y), width: round(right - x), height: round(bottom - y) };
      if (next.width > 20000 || next.height > 20000 || Math.abs(x) > 20000 || Math.abs(y) > 20000) continue;
      // A container-only repair cannot fix content outside the canvas. Leave that
      // issue explicit rather than introducing another overflowing painted frame.
      if (x < 0 || y < 0 || right > document.canvas.width || bottom > document.canvas.height) continue;
      if (Object.entries(next).every(([key, value]) => Math.abs(parent[key] - value) <= 0.5)) continue;
      const previous = Object.fromEntries(Object.keys(next).map((key) => [key, parent[key]]));
      Object.assign(parent, next);
      changes.push({ pageId: page.id, nodeId: parent.id, kind: "fit-container", before: previous, after: next });
    }
    for (const node of page.nodes) {
      if (node.type !== "text" || treeMatches(node, byId, (ancestor) => ancestor.locked) || !isDesignNodeVisible(view, node, byId)) continue;
      const originalPaints = node.fillPaints && structuredClone(node.fillPaints);
      // Only a single solid foreground can be adjusted without destroying a
      // gradient or layered artwork. Preserve its original alpha.
      if (originalPaints && (originalPaints.length !== 1 || originalPaints[0].type !== "SOLID")) continue;
      const original = originalPaints?.[0].color ?? node.fill;
      if (!/^#[0-9a-f]{6}$/iu.test(original)) continue;
      const initial = readableTextContrast(view, node, { nodeIndex: byId, availableNodes: page.nodes });
      if (initial.ratio === null || initial.ratio + 0.005 >= initial.required) continue;
      let chosen;
      for (let step = 1; step <= 20 && !chosen; step += 1) {
        const candidates = [];
        for (const target of [0, 255]) {
          const color = mix(original, target, step / 20);
          node.fill = color;
          if (node.fillPaints) node.fillPaints[0].color = color;
          const contrast = readableTextContrast(view, node, { nodeIndex: byId, availableNodes: page.nodes });
          if (contrast.ratio !== null && contrast.ratio + 0.005 >= contrast.required)
            candidates.push({ color, ratio: contrast.ratio });
        }
        chosen = candidates.sort((a, b) => b.ratio - a.ratio)[0];
      }
      if (chosen) {
        node.fill = chosen.color;
        if (node.fillPaints) node.fillPaints[0].color = chosen.color;
        changes.push({ pageId: page.id, nodeId: node.id, kind: "text-contrast", before: original,
          after: chosen.color, ratioBefore: initial.ratio, ratioAfter: chosen.ratio });
      } else {
        node.fill = original;
        if (originalPaints) node.fillPaints = originalPaints;
      }
    }
  }
  document.nodes = document.pages.find((page) => page.id === document.activePageId).nodes;
  const issues = auditDesignPages(document);
  return { document, before, after: summarizeAudit(issues), changes, unresolved: issues };
}
