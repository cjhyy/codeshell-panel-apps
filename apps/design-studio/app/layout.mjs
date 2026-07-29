/* Auto-layout and reusable-component helpers for Design Studio v3 documents. */
import { descendantIds, setNodeTreePosition } from "./geometry.mjs";

export const CONTAINER_NODE_TYPES = Object.freeze(["frame", "group", "component"]);

function round(value, precision = 2) {
  const factor = 10 ** precision;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function assignNumber(node, property, value) {
  const next = round(value);
  if (node[property] === next) return false;
  node[property] = next;
  return true;
}

function containerPadding(container, side) {
  const override = container[`padding${side}`];
  return Math.max(0, finite(override, Math.max(0, finite(container.padding))));
}

export function isContainerNode(node) {
  return Boolean(node && CONTAINER_NODE_TYPES.includes(node.type));
}

export function isAutoLayoutContainer(node) {
  return Boolean(isContainerNode(node) && ["horizontal", "vertical"].includes(node.layout));
}

export function childNodes(nodes, parentId, { visibleOnly = false } = {}) {
  if (!Array.isArray(nodes) || typeof parentId !== "string") return [];
  return nodes.filter(
    (node) => node.parentId === parentId && (!visibleOnly || node.visible !== false),
  );
}

export function applyAutoLayout(nodes, containerId) {
  if (!Array.isArray(nodes) || typeof containerId !== "string") return false;
  const container = nodes.find((node) => node.id === containerId);
  if (!isAutoLayoutContainer(container)) return false;
  const children = childNodes(nodes, container.id, { visibleOnly: true });
  if (children.length === 0) return false;

  const horizontal = container.layout === "horizontal";
  const mainPosition = horizontal ? "x" : "y";
  const crossPosition = horizontal ? "y" : "x";
  const mainSize = horizontal ? "width" : "height";
  const crossSize = horizontal ? "height" : "width";
  const mainStartPadding = containerPadding(container, horizontal ? "Left" : "Top");
  const mainEndPadding = containerPadding(container, horizontal ? "Right" : "Bottom");
  const crossStartPadding = containerPadding(container, horizontal ? "Top" : "Left");
  const crossEndPadding = containerPadding(container, horizontal ? "Bottom" : "Right");
  const configuredGap = Math.max(0, finite(container.gap));
  const innerMain = Math.max(0, finite(container[mainSize]) - mainStartPadding - mainEndPadding);
  const innerCross = Math.max(
    1,
    finite(container[crossSize]) - crossStartPadding - crossEndPadding,
  );
  const growChildren = children.filter((node) => node.layoutGrow === 1);
  const fixedSize = children
    .filter((node) => node.layoutGrow !== 1)
    .reduce((total, node) => total + Math.max(1, finite(node[mainSize], 1)), 0);
  const baseGapTotal = configuredGap * Math.max(0, children.length - 1);
  const growSpace = Math.max(0, innerMain - fixedSize - baseGapTotal);
  const growSize = growChildren.length > 0 ? growSpace / growChildren.length : 0;

  let changed = false;
  if (growChildren.length > 0) {
    for (const node of growChildren) {
      changed = assignNumber(node, mainSize, Math.max(1, growSize)) || changed;
    }
  }

  const occupied = children.reduce(
    (total, node) => total + Math.max(1, finite(node[mainSize], 1)),
    0,
  );
  const freeMain = Math.max(0, innerMain - occupied);
  let gap = configuredGap;
  let offset = 0;
  if (container.justifyContent === "center") {
    offset = Math.max(0, (freeMain - baseGapTotal) / 2);
  } else if (container.justifyContent === "end") {
    offset = Math.max(0, freeMain - baseGapTotal);
  } else if (container.justifyContent === "space-between" && children.length > 1) {
    gap = Math.max(configuredGap, freeMain / (children.length - 1));
  }

  let cursor = finite(container[mainPosition]) + mainStartPadding + offset;
  for (const node of children) {
    const alignment =
      node.layoutAlign && node.layoutAlign !== "auto"
        ? node.layoutAlign
        : (container.alignItems ?? "start");
    if (alignment === "stretch") {
      changed = assignNumber(node, crossSize, innerCross) || changed;
    }
    const childCrossSize = Math.max(1, finite(node[crossSize], 1));
    let crossOffset = 0;
    if (alignment === "center") crossOffset = (innerCross - childCrossSize) / 2;
    else if (alignment === "end") crossOffset = innerCross - childCrossSize;
    changed = setNodeTreePosition(nodes, node.id, mainPosition, round(cursor)) || changed;
    changed =
      setNodeTreePosition(
        nodes,
        node.id,
        crossPosition,
        round(finite(container[crossPosition]) + crossStartPadding + crossOffset),
      ) || changed;
    cursor += Math.max(1, finite(node[mainSize], 1)) + gap;
  }
  return changed;
}

function nodeDepth(nodes, node) {
  const byId = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const seen = new Set();
  let current = node;
  let value = 0;
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    current = byId.get(current.parentId);
    value += 1;
  }
  return value;
}

/**
 * Reflow only the requested auto-layout containers.
 *
 * Coordinates in the editor model are always absolute document coordinates, including nested
 * children. Auto layout is therefore an explicit geometry owner, not a document-wide normalization
 * pass: manual-layout containers keep the x/y values supplied by people and Agents.
 */
export function applyAutoLayouts(nodes, containerIds) {
  if (!Array.isArray(nodes) || !containerIds) return false;
  const requested = new Set(containerIds);
  for (const containerId of [...requested]) {
    for (const descendantId of descendantIds(nodes, new Set([containerId]))) {
      const descendant = nodes.find((node) => node.id === descendantId);
      if (isAutoLayoutContainer(descendant)) requested.add(descendant.id);
    }
  }
  let changed = false;
  for (const node of nodes
    .filter((candidate) => requested.has(candidate.id) && isAutoLayoutContainer(candidate))
    .sort((left, right) => nodeDepth(nodes, left) - nodeDepth(nodes, right))) {
    changed = applyAutoLayout(nodes, node.id) || changed;
  }
  return changed;
}

export function applyAllAutoLayouts(nodes) {
  if (!Array.isArray(nodes)) return false;
  return applyAutoLayouts(
    nodes,
    nodes.filter((node) => isAutoLayoutContainer(node)).map((node) => node.id),
  );
}

export function createComponentInstance(component, id, offset = 32, canvas = null) {
  if (!component || component.type !== "component" || typeof id !== "string" || !id) {
    return null;
  }
  const candidates = [
    { x: component.x + component.width + offset, y: component.y },
    { x: component.x, y: component.y + component.height + offset },
    { x: component.x - component.width - offset, y: component.y },
    { x: component.x, y: component.y - component.height - offset },
  ];
  const fitsCanvas = (candidate) =>
    canvas &&
    candidate.x >= 0 &&
    candidate.y >= 0 &&
    candidate.x + component.width <= canvas.width &&
    candidate.y + component.height <= canvas.height;
  const position = canvas
    ? (candidates.find(fitsCanvas) ?? {
        x: Math.min(Math.max(0, component.x + offset), Math.max(0, canvas.width - component.width)),
        y: Math.min(
          Math.max(0, component.y + offset),
          Math.max(0, canvas.height - component.height),
        ),
      })
    : candidates[0];
  return {
    id,
    type: "instance",
    name: `${component.name} · 实例`,
    componentId: component.id,
    x: round(position.x),
    y: round(position.y),
    width: round(component.width),
    height: round(component.height),
    fill: "transparent",
    stroke: "transparent",
    strokeWidth: 0,
    opacity: 1,
    rotation: 0,
    cornerRadius: 0,
    visible: true,
    locked: false,
  };
}
