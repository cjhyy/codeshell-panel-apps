/* Geometry engine used only by the Design Studio Panel App. */
const CONTAINER_NODE_TYPES = ["frame", "group", "component"];

function isContainerNode(node) {
  return Boolean(node && CONTAINER_NODE_TYPES.includes(node.type));
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function snapValue(value, grid = 8) {
  if (!Number.isFinite(value) || !Number.isFinite(grid) || grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

export function pointInRotatedBounds(node, point) {
  if (
    !node ||
    !point ||
    ![node.x, node.y, node.width, node.height, node.rotation ?? 0, point.x, point.y].every(
      Number.isFinite,
    )
  ) {
    return false;
  }
  const centerX = node.x + node.width / 2;
  const centerY = node.y + node.height / 2;
  const radians = (-(node.rotation ?? 0) * Math.PI) / 180;
  const deltaX = point.x - centerX;
  const deltaY = point.y - centerY;
  const localX = centerX + deltaX * Math.cos(radians) - deltaY * Math.sin(radians);
  const localY = centerY + deltaX * Math.sin(radians) + deltaY * Math.cos(radians);
  return (
    localX >= node.x &&
    localX <= node.x + node.width &&
    localY >= node.y &&
    localY <= node.y + node.height
  );
}

export function rotateVector(vector, degrees) {
  if (
    !vector ||
    !Number.isFinite(vector.x) ||
    !Number.isFinite(vector.y) ||
    !Number.isFinite(degrees)
  ) {
    return { x: vector?.x ?? 0, y: vector?.y ?? 0 };
  }
  const radians = (degrees * Math.PI) / 180;
  return {
    x: vector.x * Math.cos(radians) - vector.y * Math.sin(radians),
    y: vector.x * Math.sin(radians) + vector.y * Math.cos(radians),
  };
}

function rotatePoint(point, center, degrees) {
  if (!degrees) return point;
  const rotated = rotateVector({ x: point.x - center.x, y: point.y - center.y }, degrees);
  return { x: center.x + rotated.x, y: center.y + rotated.y };
}

function validBounds(node) {
  return (
    node && [node.x, node.y, node.width, node.height, node.rotation ?? 0].every(Number.isFinite)
  );
}

function normalizeRotation(degrees) {
  const normalized = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return round(normalized);
}

export function pointToParentSpace(point, parent = null) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  if (!parent) return { x: point.x, y: point.y };
  if (!validBounds(parent)) return null;
  const center = { x: parent.x + parent.width / 2, y: parent.y + parent.height / 2 };
  return rotatePoint(point, center, -(parent.rotation ?? 0));
}

export function pointFromParentSpace(point, parent = null) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  if (!parent) return { x: point.x, y: point.y };
  if (!validBounds(parent)) return null;
  const center = { x: parent.x + parent.width / 2, y: parent.y + parent.height / 2 };
  return rotatePoint(point, center, parent.rotation ?? 0);
}

export function transformNodeBetweenParents(node, previousParent = null, nextParent = null) {
  if (!validBounds(node)) return false;
  if (
    (previousParent && !validBounds(previousParent)) ||
    (nextParent && !validBounds(nextParent))
  ) {
    return false;
  }
  const localCenter = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  const visualCenter = pointFromParentSpace(localCenter, previousParent);
  const nextCenter = pointToParentSpace(visualCenter, nextParent);
  if (!nextCenter) return false;
  node.x = round(nextCenter.x - node.width / 2);
  node.y = round(nextCenter.y - node.height / 2);
  node.rotation = normalizeRotation(
    (node.rotation ?? 0) + (previousParent?.rotation ?? 0) - (nextParent?.rotation ?? 0),
  );
  return true;
}

export function detachNodeFromParent(node, parent) {
  if (!parent || !transformNodeBetweenParents(node, parent, null)) return false;
  if (Number.isFinite(parent.opacity) && Number.isFinite(node.opacity)) {
    node.opacity = round(Math.min(1, Math.max(0, parent.opacity * node.opacity)), 4);
  }
  if (typeof parent.visible === "boolean" && typeof node.visible === "boolean") {
    node.visible = parent.visible && node.visible;
  }
  delete node.parentId;
  return true;
}

export function transformedNodeBounds(node, parent = null) {
  if (!validBounds(node) || (parent && !validBounds(parent))) return null;
  const nodeCenter = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  const parentCenter = parent
    ? { x: parent.x + parent.width / 2, y: parent.y + parent.height / 2 }
    : null;
  const corners = [
    { x: node.x, y: node.y },
    { x: node.x + node.width, y: node.y },
    { x: node.x + node.width, y: node.y + node.height },
    { x: node.x, y: node.y + node.height },
  ].map((point) => {
    const locallyRotated = rotatePoint(point, nodeCenter, node.rotation ?? 0);
    return parentCenter
      ? rotatePoint(locallyRotated, parentCenter, parent.rotation ?? 0)
      : locallyRotated;
  });
  const left = Math.min(...corners.map((point) => point.x));
  const top = Math.min(...corners.map((point) => point.y));
  const right = Math.max(...corners.map((point) => point.x));
  const bottom = Math.max(...corners.map((point) => point.y));
  return {
    x: round(left),
    y: round(top),
    width: round(right - left),
    height: round(bottom - top),
  };
}

function ancestorNodes(nodes, node, nodeIndex = null) {
  if (!Array.isArray(nodes) || !node) return [];
  const byId =
    nodeIndex instanceof Map
      ? nodeIndex
      : new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const ancestors = [];
  const seen = new Set();
  let parentId = node.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    ancestors.push(parent);
    parentId = parent.parentId;
  }
  return ancestors;
}

export function inheritedNodeRotation(nodes, node, excludedIds = new Set()) {
  return ancestorNodes(nodes, node)
    .filter((ancestor) => !excludedIds.has(ancestor.id))
    .reduce((rotation, ancestor) => rotation + (ancestor.rotation ?? 0), 0);
}

export function transformedNodeCornersInTree(nodes, node, nodeIndex = null) {
  if (!validBounds(node)) return null;
  const nodeCenter = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  return [
    { x: node.x, y: node.y },
    { x: node.x + node.width, y: node.y },
    { x: node.x + node.width, y: node.y + node.height },
    { x: node.x, y: node.y + node.height },
  ].map((point) => {
    let transformed = rotatePoint(point, nodeCenter, node.rotation ?? 0);
    for (const ancestor of ancestorNodes(nodes, node, nodeIndex)) {
      transformed = rotatePoint(
        transformed,
        { x: ancestor.x + ancestor.width / 2, y: ancestor.y + ancestor.height / 2 },
        ancestor.rotation ?? 0,
      );
    }
    return transformed;
  });
}

export function transformedNodeBoundsInTree(nodes, node, nodeIndex = null) {
  const corners = transformedNodeCornersInTree(nodes, node, nodeIndex);
  if (!corners) return null;
  const left = Math.min(...corners.map((point) => point.x));
  const top = Math.min(...corners.map((point) => point.y));
  const right = Math.max(...corners.map((point) => point.x));
  const bottom = Math.max(...corners.map((point) => point.y));
  return {
    x: round(left),
    y: round(top),
    width: round(right - left),
    height: round(bottom - top),
  };
}

export function pointToNodeSpace(nodes, node, point, nodeIndex = null) {
  if (!validBounds(node) || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return null;
  }
  let local = { x: point.x, y: point.y };
  for (const ancestor of ancestorNodes(nodes, node, nodeIndex).reverse()) {
    local = rotatePoint(
      local,
      { x: ancestor.x + ancestor.width / 2, y: ancestor.y + ancestor.height / 2 },
      -(ancestor.rotation ?? 0),
    );
  }
  local = rotatePoint(
    local,
    { x: node.x + node.width / 2, y: node.y + node.height / 2 },
    -(node.rotation ?? 0),
  );
  return local;
}

export function pointFromNodeSpace(nodes, node, point, nodeIndex = null) {
  if (!validBounds(node) || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return null;
  }
  let transformed = rotatePoint(
    point,
    { x: node.x + node.width / 2, y: node.y + node.height / 2 },
    node.rotation ?? 0,
  );
  for (const ancestor of ancestorNodes(nodes, node, nodeIndex)) {
    transformed = rotatePoint(
      transformed,
      { x: ancestor.x + ancestor.width / 2, y: ancestor.y + ancestor.height / 2 },
      ancestor.rotation ?? 0,
    );
  }
  return transformed;
}

function polygonArea(points) {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0);
}

function crossProduct(origin, first, second) {
  return (
    (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x)
  );
}

function lineIntersection(start, end, clipStart, clipEnd) {
  const subjectDelta = { x: end.x - start.x, y: end.y - start.y };
  const clipDelta = { x: clipEnd.x - clipStart.x, y: clipEnd.y - clipStart.y };
  const denominator = clipDelta.x * subjectDelta.y - clipDelta.y * subjectDelta.x;
  if (Math.abs(denominator) < 1e-9) return end;
  const offset = { x: start.x - clipStart.x, y: start.y - clipStart.y };
  const distance = -(clipDelta.x * offset.y - clipDelta.y * offset.x) / denominator;
  return {
    x: start.x + subjectDelta.x * distance,
    y: start.y + subjectDelta.y * distance,
  };
}

function clipConvexPolygon(subject, clip) {
  if (subject.length < 3 || clip.length < 3) return [];
  const orientation = polygonArea(clip) >= 0 ? 1 : -1;
  let output = subject;
  for (let index = 0; index < clip.length && output.length > 0; index += 1) {
    const clipStart = clip[index];
    const clipEnd = clip[(index + 1) % clip.length];
    const input = output;
    output = [];
    let start = input[input.length - 1];
    let startInside = orientation * crossProduct(clipStart, clipEnd, start) >= -1e-7;
    for (const end of input) {
      const endInside = orientation * crossProduct(clipStart, clipEnd, end) >= -1e-7;
      if (endInside !== startInside) {
        output.push(lineIntersection(start, end, clipStart, clipEnd));
      }
      if (endInside) output.push(end);
      start = end;
      startInside = endInside;
    }
  }
  return output;
}

function nodeClipOutlineInTree(nodes, node, nodeIndex) {
  if (!validBounds(node) || node.width <= 0 || node.height <= 0) return [];
  const points = [];
  const radius =
    node.type === "ellipse"
      ? Math.min(node.width, node.height) / 2
      : Math.min(node.cornerRadius ?? 0, node.width / 2, node.height / 2);
  if (node.type === "ellipse") {
    for (let index = 0; index < 64; index += 1) {
      const angle = (index / 64) * Math.PI * 2;
      points.push({
        x: node.x + node.width / 2 + Math.cos(angle) * (node.width / 2),
        y: node.y + node.height / 2 + Math.sin(angle) * (node.height / 2),
      });
    }
  } else if (radius > 0) {
    const corners = [
      { x: node.x + node.width - radius, y: node.y + radius, start: -Math.PI / 2 },
      {
        x: node.x + node.width - radius,
        y: node.y + node.height - radius,
        start: 0,
      },
      { x: node.x + radius, y: node.y + node.height - radius, start: Math.PI / 2 },
      { x: node.x + radius, y: node.y + radius, start: Math.PI },
    ];
    for (const corner of corners) {
      for (let index = 0; index <= 8; index += 1) {
        const angle = corner.start + (index / 8) * (Math.PI / 2);
        points.push({
          x: corner.x + Math.cos(angle) * radius,
          y: corner.y + Math.sin(angle) * radius,
        });
      }
    }
  } else {
    points.push(
      { x: node.x, y: node.y },
      { x: node.x + node.width, y: node.y },
      { x: node.x + node.width, y: node.y + node.height },
      { x: node.x, y: node.y + node.height },
    );
  }
  return points.map((point) => pointFromNodeSpace(nodes, node, point, nodeIndex)).filter(Boolean);
}

function clippedPolygonBounds(nodes, node, subject, nodeIndex) {
  if (!Array.isArray(nodes) || !node || subject.length < 3) return null;
  let polygon = subject;
  for (const ancestor of ancestorNodes(nodes, node, nodeIndex)) {
    if (ancestor.clipContent !== true) continue;
    polygon = clipConvexPolygon(polygon, nodeClipOutlineInTree(nodes, ancestor, nodeIndex));
    if (polygon.length < 3) return null;
  }
  const left = Math.min(...polygon.map((point) => point.x));
  const top = Math.min(...polygon.map((point) => point.y));
  const right = Math.max(...polygon.map((point) => point.x));
  const bottom = Math.max(...polygon.map((point) => point.y));
  if (right - left <= 1e-7 || bottom - top <= 1e-7) return null;
  return {
    x: round(left, 4),
    y: round(top, 4),
    width: round(right - left, 4),
    height: round(bottom - top, 4),
  };
}

export function clipNodeBoundsToClippingAncestors(nodes, node, nodeIndex = null) {
  return clippedPolygonBounds(
    nodes,
    node,
    nodeClipOutlineInTree(nodes, node, nodeIndex),
    nodeIndex,
  );
}

export function clipBoundsToClippingAncestors(nodes, node, bounds, nodeIndex = null) {
  if (
    !bounds ||
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return null;
  }
  return clippedPolygonBounds(
    nodes,
    node,
    [
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      { x: bounds.x, y: bounds.y + bounds.height },
    ],
    nodeIndex,
  );
}

export function pointInNodeTree(nodes, node, point) {
  const local = pointToNodeSpace(nodes, node, point);
  if (!local) return false;
  return (
    local.x >= node.x &&
    local.x <= node.x + node.width &&
    local.y >= node.y &&
    local.y <= node.y + node.height
  );
}

export function visualSelectionBounds(nodes, allNodes = nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return null;
  const bounds = nodes.map((node) => transformedNodeBoundsInTree(allNodes, node)).filter(Boolean);
  return selectionBounds(bounds);
}

export function snapBoundsToNodes(bounds, stationaryNodes, delta, threshold = 6) {
  if (
    !bounds ||
    !Array.isArray(stationaryNodes) ||
    !Number.isFinite(delta?.x) ||
    !Number.isFinite(delta?.y) ||
    !Number.isFinite(threshold) ||
    threshold < 0
  ) {
    return { x: delta?.x ?? 0, y: delta?.y ?? 0, guides: [] };
  }
  const bestMatch = (axis) => {
    const horizontal = axis === "x";
    const start = horizontal ? bounds.x + delta.x : bounds.y + delta.y;
    const size = horizontal ? bounds.width : bounds.height;
    const sourceAnchors = [start, start + size / 2, start + size];
    let best = null;
    for (const node of stationaryNodes) {
      const targetStart = horizontal ? node.x : node.y;
      const targetSize = horizontal ? node.width : node.height;
      const targetAnchors = [targetStart, targetStart + targetSize / 2, targetStart + targetSize];
      for (const source of sourceAnchors) {
        for (const target of targetAnchors) {
          const distance = Math.abs(target - source);
          if (distance > threshold || (best && distance >= best.distance)) continue;
          best = { adjustment: target - source, distance, value: target, targetId: node.id };
        }
      }
    }
    return best;
  };
  const xMatch = bestMatch("x");
  const yMatch = bestMatch("y");
  return {
    x: delta.x + (xMatch?.adjustment ?? 0),
    y: delta.y + (yMatch?.adjustment ?? 0),
    guides: [
      ...(xMatch ? [{ axis: "x", value: xMatch.value, targetId: xMatch.targetId }] : []),
      ...(yMatch ? [{ axis: "y", value: yMatch.value, targetId: yMatch.targetId }] : []),
    ],
  };
}

export function descendantIds(nodes, rootIds) {
  const descendants = new Set();
  const queue = [...rootIds];
  while (queue.length > 0) {
    const parentId = queue.shift();
    for (const node of nodes) {
      if (node.parentId !== parentId || descendants.has(node.id) || rootIds.has(node.id)) continue;
      descendants.add(node.id);
      queue.push(node.id);
    }
  }
  return descendants;
}

export function normalizeNodeTreeOrder(nodes) {
  if (!Array.isArray(nodes)) return false;
  const childrenByParent = new Map();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }
  const ordered = [];
  const visited = new Set();
  const appendTree = (node) => {
    if (visited.has(node.id)) return;
    ordered.push(node);
    visited.add(node.id);
    for (const child of childrenByParent.get(node.id) ?? []) appendTree(child);
  };
  for (const node of nodes) {
    if (node.parentId) continue;
    appendTree(node);
  }
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    ordered.push(node);
  }
  const changed = ordered.some((node, index) => node !== nodes[index]);
  if (changed) nodes.splice(0, nodes.length, ...ordered);
  return changed;
}

export function selectionBounds(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return null;
  const left = Math.min(...nodes.map((node) => node.x));
  const top = Math.min(...nodes.map((node) => node.y));
  const right = Math.max(...nodes.map((node) => node.x + node.width));
  const bottom = Math.max(...nodes.map((node) => node.y + node.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function wrapNodesInFrame(nodes, selectedIds, frame, padding = 24) {
  if (
    !Array.isArray(nodes) ||
    !(selectedIds instanceof Set) ||
    selectedIds.size === 0 ||
    !frame ||
    !isContainerNode(frame) ||
    typeof frame.id !== "string" ||
    nodes.some((node) => node.id === frame.id) ||
    !Number.isFinite(padding) ||
    padding < 0
  ) {
    return false;
  }
  const selected = nodes.filter((node) => selectedIds.has(node.id));
  if (selected.length === 0 || selected.some((node) => isContainerNode(node) || node.parentId)) {
    return false;
  }
  const bounds = selectionBounds(selected);
  frame.x = round(bounds.x - padding);
  frame.y = round(bounds.y - padding);
  frame.width = round(bounds.width + padding * 2);
  frame.height = round(bounds.height + padding * 2);

  const firstSelectedIndex = nodes.findIndex((node) => selectedIds.has(node.id));
  const insertionIndex = nodes
    .slice(0, firstSelectedIndex)
    .filter((node) => !selectedIds.has(node.id)).length;
  const remaining = nodes.filter((node) => !selectedIds.has(node.id));
  for (const node of selected) node.parentId = frame.id;
  remaining.splice(insertionIndex, 0, frame, ...selected);
  nodes.splice(0, nodes.length, ...remaining);
  return true;
}

export function releaseFrame(nodes, frameId) {
  if (!Array.isArray(nodes) || typeof frameId !== "string") return false;
  const frame = nodes.find((node) => node.id === frameId);
  if (!frame || !["frame", "group"].includes(frame.type)) return false;
  const children = nodes.filter((node) => node.parentId === frameId);
  const nextParent = frame.parentId
    ? nodes.find((node) => node.id === frame.parentId && isContainerNode(node))
    : null;
  if (frame.parentId && !nextParent) return false;
  for (const child of children) {
    transformNodeTreeBetweenParents(nodes, child, nextParent);
    if (Number.isFinite(frame.opacity) && Number.isFinite(child.opacity)) {
      child.opacity = round(Math.min(1, Math.max(0, frame.opacity * child.opacity)), 4);
    }
    if (typeof frame.visible === "boolean" && typeof child.visible === "boolean") {
      child.visible = frame.visible && child.visible;
    }
    if (nextParent) child.parentId = nextParent.id;
    else delete child.parentId;
  }
  nodes.splice(nodes.indexOf(frame), 1);
  normalizeNodeTreeOrder(nodes);
  return true;
}

export function alignNodes(nodes, alignment, canvas) {
  if (!Array.isArray(nodes) || nodes.length === 0) return false;
  const bounds =
    nodes.length === 1
      ? {
          x: Number.isFinite(canvas?.x) ? canvas.x : 0,
          y: Number.isFinite(canvas?.y) ? canvas.y : 0,
          width: canvas.width,
          height: canvas.height,
        }
      : selectionBounds(nodes);
  for (const node of nodes) {
    if (alignment === "left") node.x = bounds.x;
    else if (alignment === "center") node.x = round(bounds.x + (bounds.width - node.width) / 2);
    else if (alignment === "right") node.x = round(bounds.x + bounds.width - node.width);
    else if (alignment === "top") node.y = bounds.y;
    else if (alignment === "middle") node.y = round(bounds.y + (bounds.height - node.height) / 2);
    else if (alignment === "bottom") node.y = round(bounds.y + bounds.height - node.height);
    else return false;
  }
  return true;
}

function selectedTreeRoots(nodes, selectedIds) {
  return nodes.filter(
    (node) => selectedIds.has(node.id) && (!node.parentId || !selectedIds.has(node.parentId)),
  );
}

function visualBoundsForNode(nodes, node) {
  return transformedNodeBoundsInTree(nodes, node);
}

function moveNodeTreeByVisualDelta(nodes, root, delta) {
  if (!Number.isFinite(delta?.x) || !Number.isFinite(delta?.y)) return false;
  const inheritedRotation = inheritedNodeRotation(nodes, root);
  const localDelta = inheritedRotation ? rotateVector(delta, -inheritedRotation) : delta;
  root.x = round(root.x + localDelta.x);
  root.y = round(root.y + localDelta.y);
  if (isContainerNode(root)) {
    const descendants = descendantIds(nodes, new Set([root.id]));
    for (const node of nodes) {
      if (!descendants.has(node.id)) continue;
      node.x = round(node.x + localDelta.x);
      node.y = round(node.y + localDelta.y);
    }
  }
  return true;
}

export function alignNodeTrees(nodes, selectedIds, alignment, canvas) {
  if (!Array.isArray(nodes) || !(selectedIds instanceof Set) || selectedIds.size === 0) {
    return false;
  }
  if (!["left", "center", "right", "top", "middle", "bottom"].includes(alignment)) return false;
  const roots = selectedTreeRoots(nodes, selectedIds);
  if (roots.length === 0) return false;
  const entries = roots.map((node) => ({ node, bounds: visualBoundsForNode(nodes, node) }));
  if (entries.some((entry) => !entry.bounds)) return false;
  const singleParent =
    roots.length === 1 && roots[0].parentId
      ? nodes.find((candidate) => candidate.id === roots[0].parentId && isContainerNode(candidate))
      : null;
  const target =
    roots.length === 1
      ? singleParent
        ? transformedNodeBoundsInTree(nodes, singleParent)
        : {
            x: Number.isFinite(canvas?.x) ? canvas.x : 0,
            y: Number.isFinite(canvas?.y) ? canvas.y : 0,
            width: canvas?.width,
            height: canvas?.height,
          }
      : selectionBounds(entries.map((entry) => entry.bounds));
  if (!target || ![target.x, target.y, target.width, target.height].every(Number.isFinite)) {
    return false;
  }
  for (const entry of entries) {
    const { bounds } = entry;
    const delta = { x: 0, y: 0 };
    if (alignment === "left") delta.x = target.x - bounds.x;
    else if (alignment === "center") {
      delta.x = target.x + target.width / 2 - (bounds.x + bounds.width / 2);
    } else if (alignment === "right") {
      delta.x = target.x + target.width - (bounds.x + bounds.width);
    } else if (alignment === "top") delta.y = target.y - bounds.y;
    else if (alignment === "middle") {
      delta.y = target.y + target.height / 2 - (bounds.y + bounds.height / 2);
    } else if (alignment === "bottom") {
      delta.y = target.y + target.height - (bounds.y + bounds.height);
    }
    moveNodeTreeByVisualDelta(nodes, entry.node, delta);
  }
  return true;
}

export function distributeNodes(nodes, axis) {
  if (!Array.isArray(nodes) || nodes.length < 3) return false;
  const horizontal = axis === "horizontal";
  if (!horizontal && axis !== "vertical") return false;
  const position = horizontal ? "x" : "y";
  const size = horizontal ? "width" : "height";
  const ordered = [...nodes].sort((left, right) => left[position] - right[position]);
  const first = ordered[0][position];
  const last = ordered.at(-1);
  const lastEdge = last[position] + last[size];
  const occupied = ordered.reduce((total, node) => total + node[size], 0);
  const gap = (lastEdge - first - occupied) / (ordered.length - 1);
  let cursor = first;
  for (const node of ordered) {
    node[position] = round(cursor);
    cursor += node[size] + gap;
  }
  return true;
}

export function distributeNodeTrees(nodes, selectedIds, axis) {
  if (!Array.isArray(nodes) || !(selectedIds instanceof Set) || selectedIds.size === 0) {
    return false;
  }
  const roots = selectedTreeRoots(nodes, selectedIds);
  if (roots.length < 3 || !["horizontal", "vertical"].includes(axis)) return false;
  const horizontal = axis === "horizontal";
  const position = horizontal ? "x" : "y";
  const size = horizontal ? "width" : "height";
  const entries = roots
    .map((node) => ({ node, bounds: visualBoundsForNode(nodes, node) }))
    .filter((entry) => entry.bounds)
    .sort((left, right) => left.bounds[position] - right.bounds[position]);
  if (entries.length !== roots.length) return false;
  const first = entries[0].bounds[position];
  const last = entries.at(-1).bounds;
  const lastEdge = last[position] + last[size];
  const occupied = entries.reduce((total, entry) => total + entry.bounds[size], 0);
  const gap = (lastEdge - first - occupied) / (entries.length - 1);
  let cursor = first;
  for (const entry of entries) {
    const delta = cursor - entry.bounds[position];
    moveNodeTreeByVisualDelta(
      nodes,
      entry.node,
      horizontal ? { x: delta, y: 0 } : { x: 0, y: delta },
    );
    cursor += entry.bounds[size] + gap;
  }
  return true;
}

export function setNodeTreePosition(nodes, nodeId, axis, value) {
  if (!Array.isArray(nodes) || !["x", "y"].includes(axis) || !Number.isFinite(value)) return false;
  const root = nodes.find((node) => node.id === nodeId);
  if (!root) return false;
  const delta = value - root[axis];
  if (delta === 0) return false;
  root[axis] = round(value);
  if (isContainerNode(root)) {
    const descendants = descendantIds(nodes, new Set([root.id]));
    for (const node of nodes) {
      if (!descendants.has(node.id)) continue;
      node[axis] = round(node[axis] + delta);
    }
  }
  return true;
}

export function moveSelectedNodes(nodes, selectedIds, direction) {
  if (!Array.isArray(nodes) || selectedIds.size === 0) return false;
  if (direction !== "up" && direction !== "down") return false;
  let changed = false;
  const childrenByParent = new Map();
  for (const node of nodes) {
    const parent = node.parentId ?? null;
    const siblings = childrenByParent.get(parent) ?? [];
    siblings.push(node);
    childrenByParent.set(parent, siblings);
  }

  for (const siblings of childrenByParent.values()) {
    if (direction === "up") {
      for (let index = siblings.length - 2; index >= 0; index -= 1) {
        if (selectedIds.has(siblings[index].id) && !selectedIds.has(siblings[index + 1].id)) {
          [siblings[index], siblings[index + 1]] = [siblings[index + 1], siblings[index]];
          changed = true;
        }
      }
    } else {
      for (let index = 1; index < siblings.length; index += 1) {
        if (selectedIds.has(siblings[index].id) && !selectedIds.has(siblings[index - 1].id)) {
          [siblings[index], siblings[index - 1]] = [siblings[index - 1], siblings[index]];
          changed = true;
        }
      }
    }
  }
  if (!changed) return false;

  const ordered = [];
  const visited = new Set();
  const appendTree = (node) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    ordered.push(node);
    for (const child of childrenByParent.get(node.id) ?? []) appendTree(child);
  };
  for (const root of childrenByParent.get(null) ?? []) appendTree(root);
  for (const node of nodes) appendTree(node);
  nodes.splice(0, nodes.length, ...ordered);
  return changed;
}

function transformNodeTreeBetweenParents(nodes, node, nextParent = null) {
  if (!Array.isArray(nodes) || !validBounds(node) || (nextParent && !validBounds(nextParent))) {
    return false;
  }
  const previousAncestors = ancestorNodes(nodes, node);
  const nextAncestors = nextParent ? [nextParent, ...ancestorNodes(nodes, nextParent)] : [];
  if ([...previousAncestors, ...nextAncestors].some((ancestor) => !validBounds(ancestor))) {
    return false;
  }

  const previousCenter = {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2,
  };
  const visualCenter = pointFromNodeSpace(nodes, node, previousCenter);
  if (!visualCenter) return false;

  let nextCenter = visualCenter;
  for (const ancestor of [...nextAncestors].reverse()) {
    nextCenter = rotatePoint(
      nextCenter,
      { x: ancestor.x + ancestor.width / 2, y: ancestor.y + ancestor.height / 2 },
      -(ancestor.rotation ?? 0),
    );
  }

  const nextX = round(nextCenter.x - node.width / 2);
  const nextY = round(nextCenter.y - node.height / 2);
  const delta = { x: nextX - node.x, y: nextY - node.y };
  const previousInheritedRotation = previousAncestors.reduce(
    (rotation, ancestor) => rotation + (ancestor.rotation ?? 0),
    0,
  );
  const nextInheritedRotation = nextAncestors.reduce(
    (rotation, ancestor) => rotation + (ancestor.rotation ?? 0),
    0,
  );
  node.x = nextX;
  node.y = nextY;
  node.rotation = normalizeRotation(
    (node.rotation ?? 0) + previousInheritedRotation - nextInheritedRotation,
  );
  if (isContainerNode(node) && (delta.x !== 0 || delta.y !== 0)) {
    const descendants = descendantIds(nodes, new Set([node.id]));
    for (const descendant of nodes) {
      if (!descendants.has(descendant.id)) continue;
      descendant.x = round(descendant.x + delta.x);
      descendant.y = round(descendant.y + delta.y);
    }
  }
  return true;
}

export function reparentNode(nodes, nodeId, parentId) {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return false;
  const previousAncestors = ancestorNodes(nodes, node);
  const previousParent = node.parentId
    ? nodes.find((candidate) => candidate.id === node.parentId && isContainerNode(candidate))
    : null;
  const parent =
    typeof parentId === "string"
      ? nodes.find((candidate) => candidate.id === parentId && isContainerNode(candidate))
      : null;
  if (parentId && !parent) return false;
  if (
    parent &&
    (parent.id === node.id || descendantIds(nodes, new Set([node.id])).has(parent.id))
  ) {
    return false;
  }
  // Legacy/minimal callers may use hierarchy-only nodes without geometry.
  // Preserve their structural reorder behavior; normalized design documents
  // always take the complete visual-transform path.
  transformNodeTreeBetweenParents(nodes, node, parent);
  if (previousParent && !parent) {
    if (Number.isFinite(node.opacity)) {
      const inheritedOpacity = previousAncestors.reduce(
        (opacity, ancestor) => opacity * (Number.isFinite(ancestor.opacity) ? ancestor.opacity : 1),
        1,
      );
      node.opacity = round(Math.min(1, Math.max(0, inheritedOpacity * node.opacity)), 4);
    }
    if (typeof node.visible === "boolean") {
      node.visible =
        node.visible &&
        previousAncestors.every(
          (ancestor) => typeof ancestor.visible !== "boolean" || ancestor.visible,
        );
    }
  }
  const index = nodes.indexOf(node);
  nodes.splice(index, 1);
  if (!parent) {
    delete node.parentId;
    nodes.push(node);
    return true;
  }
  node.parentId = parent.id;
  const parentTreeIds = new Set([parent.id, ...descendantIds(nodes, new Set([parent.id]))]);
  const insertionIndex = nodes.reduce(
    (last, candidate, candidateIndex) => (parentTreeIds.has(candidate.id) ? candidateIndex : last),
    nodes.findIndex((candidate) => candidate.id === parent.id),
  );
  nodes.splice(insertionIndex + 1, 0, node);
  normalizeNodeTreeOrder(nodes);
  return true;
}
