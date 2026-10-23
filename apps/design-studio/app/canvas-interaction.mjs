import { isDesignNodeVisible } from "./document.mjs";
import { pointToNodeSpace, visualSelectionBounds } from "./geometry.mjs";

function ancestors(node, index) {
  const chain = [],
    seen = new Set([node.id]);
  for (let id = node.parentId; id && !seen.has(id); ) {
    seen.add(id);
    const parent = index.get(id);
    if (!parent) break;
    chain.unshift(parent);
    id = parent.parentId;
  }
  return chain;
}

function inside(node, point, ellipse = false) {
  if (!point) return false;
  const x = point.x - node.x,
    y = point.y - node.y;
  const w = Math.max(1, node.width),
    h = Math.max(1, node.height);
  if (x < 0 || y < 0 || x > w || y > h) return false;
  if (ellipse) return ((x - w / 2) / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2 <= 1;
  const radius = Math.min(node.cornerRadius || 0, w / 2, h / 2);
  if (!radius) return true;
  const dx = Math.max(radius - x, x - (w - radius), 0);
  const dy = Math.max(radius - y, y - (h - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

/** Hit the actual document geometry, in front-to-back order, with ancestor clips. */
export function hitTestCanvasNode(
  design,
  point,
  index = new Map(design.nodes.map((n) => [n.id, n])),
) {
  for (let i = design.nodes.length - 1; i >= 0; i--) {
    const node = design.nodes[i];
    if (!isDesignNodeVisible(design, node, index)) continue;
    if (!inside(node, pointToNodeSpace(design.nodes, node, point, index), node.type === "ellipse"))
      continue;
    if (
      ancestors(node, index).some(
        (parent) =>
          ["frame", "component"].includes(parent.type) &&
          parent.clipContent &&
          !inside(parent, pointToNodeSpace(design.nodes, parent, point, index)),
      )
    )
      continue;
    return node;
  }
  return null;
}

export function hitTestCanvasLabel(design, point, zoom, selectedIds, context) {
  if (zoom < 0.65 || !context) return null;
  const index = new Map(design.nodes.map((node) => [node.id, node]));
  const previousFont = context.font;
  context.font = `600 ${11 / zoom}px Inter, system-ui, sans-serif`;
  try {
    for (const node of [...design.nodes].reverse()) {
      if (
        !["frame", "component", "group"].includes(node.type) ||
        (node.parentId && !selectedIds.has(node.id)) ||
        !isDesignNodeVisible(design, node, index)
      )
        continue;
      const text = `${node.type === "component" ? "◇ " : node.type === "group" ? "▣ " : ""}${node.name}`;
      const local = pointToNodeSpace(design.nodes, node, point, index);
      const label = {
        x: node.x,
        y: node.y - 30 / zoom,
        width: context.measureText(text).width,
        height: 15 / zoom,
      };
      if (!inside(label, local)) continue;
      if (
        ancestors(node, index).some(
          (parent) =>
            ["frame", "component"].includes(parent.type) &&
            parent.clipContent &&
            !inside(parent, pointToNodeSpace(design.nodes, parent, point, index)),
        )
      )
        continue;
      return node;
    }
  } finally {
    context.font = previousFont;
  }
  return null;
}

export function canvasResizeHandles(
  node,
  { zoom, locked = false, tool = "select", nodes, index } = {},
) {
  if (
    !node ||
    locked ||
    tool !== "select" ||
    [node, ...ancestors(node, index ?? new Map(nodes.map((n) => [n.id, n])))].some(
      (n) => n.rotation,
    )
  )
    return [];
  return [
    ["nw", node.x, node.y],
    ["ne", node.x + node.width, node.y],
    ["se", node.x + node.width, node.y + node.height],
    ["sw", node.x, node.y + node.height],
  ].map(([id, x, y]) => ({ id, x, y, size: 8 / zoom }));
}

export function hitTestCanvasHandle(point, handles, zoom, coarse = false) {
  const radius = (coarse ? 14 : 6) / zoom;
  return handles.find((h) => Math.abs(point.x - h.x) <= radius && Math.abs(point.y - h.y) <= radius)
    ?.id;
}

function rotate(context, node) {
  if (!node.rotation) return;
  const x = node.x + node.width / 2,
    y = node.y + node.height / 2;
  context.translate(x, y);
  context.rotate((node.rotation * Math.PI) / 180);
  context.translate(-x, -y);
}

/** Affine transform shared by the canvas and the HTML inline text editor. */
export function canvasNodeMatrix(
  node,
  nodes,
  pan,
  zoom,
  index = new Map(nodes.map((n) => [n.id, n])),
) {
  let matrix = [zoom, 0, 0, zoom, pan.x, pan.y];
  const multiply = ([a, b, c, d, e, f]) => {
    const [A, B, C, D, E, F] = matrix;
    matrix = [
      A * a + C * b,
      B * a + D * b,
      A * c + C * d,
      B * c + D * d,
      A * e + C * f + E,
      B * e + D * f + F,
    ];
  };
  for (const n of [...ancestors(node, index), node]) {
    if (!n.rotation) continue;
    const x = n.x + n.width / 2,
      y = n.y + n.height / 2;
    const c = Math.cos((n.rotation * Math.PI) / 180),
      s = Math.sin((n.rotation * Math.PI) / 180);
    multiply([c, s, -s, c, x - c * x + s * y, y - s * x - c * y]);
  }
  multiply([1, 0, 0, 1, node.x, node.y]);
  return matrix;
}

/** The overlay contains editor chrome only; the design is always drawn by CanvasKit. */
export function drawCanvasInteraction(
  canvas,
  {
    design,
    selectedIds,
    pan,
    zoom,
    dpr = 1,
    width,
    height,
    activeTool,
    interaction,
    isLocked = () => false,
  },
) {
  const w = Math.max(1, Math.ceil(width * dpr)),
    h = Math.max(1, Math.ceil(height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * pan.x, dpr * pan.y);
  const index = new Map(design.nodes.map((n) => [n.id, n]));
  const selected = design.nodes.filter(
    (n) => selectedIds.has(n.id) && isDesignNodeVisible(design, n, index),
  );
  if (zoom >= 0.65)
    for (const node of design.nodes) {
      if (
        !["frame", "component", "group"].includes(node.type) ||
        (node.parentId && !selectedIds.has(node.id)) ||
        !isDesignNodeVisible(design, node, index)
      )
        continue;
      ctx.save();
      for (const parent of ancestors(node, index)) {
        rotate(ctx, parent);
        if (["frame", "component"].includes(parent.type) && parent.clipContent) {
          ctx.beginPath();
          ctx.roundRect(
            parent.x,
            parent.y,
            parent.width,
            parent.height,
            Math.max(0, Math.min(parent.cornerRadius || 0, parent.width / 2, parent.height / 2)),
          );
          ctx.clip();
        }
      }
      rotate(ctx, node);
      ctx.font = `600 ${11 / zoom}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = "#8a8a85";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(
        `${node.type === "component" ? "◇ " : node.type === "group" ? "▣ " : ""}${node.name}`,
        node.x,
        node.y - 18 / zoom,
      );
      ctx.restore();
    }
  let handles = [];
  for (const node of selected) {
    ctx.save();
    for (const n of [...ancestors(node, index), node]) rotate(ctx, n);
    const locked = isLocked(node);
    ctx.strokeStyle = locked ? "#ffae52" : "#4f7cff";
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash(locked ? [5 / zoom, 3 / zoom] : []);
    ctx.strokeRect(node.x, node.y, node.width, node.height);
    ctx.restore();
    if (selected.length === 1)
      handles = canvasResizeHandles(node, {
        zoom,
        locked,
        tool: activeTool,
        nodes: design.nodes,
        index,
      });
  }
  ctx.setLineDash([]);
  for (const handle of handles) {
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#315fda";
    ctx.lineWidth = 1.5 / zoom;
    ctx.beginPath();
    ctx.roundRect(
      handle.x - handle.size / 2,
      handle.y - handle.size / 2,
      handle.size,
      handle.size,
      1.5 / zoom,
    );
    ctx.fill();
    ctx.stroke();
  }
  if (selected.length > 1) {
    const b = visualSelectionBounds(selected, design.nodes);
    ctx.strokeStyle = "#4f7cff";
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([4 / zoom, 3 / zoom]);
    ctx.strokeRect(b.x, b.y, b.width, b.height);
  }
  if (interaction?.kind === "marquee") {
    const x = Math.min(interaction.start.x, interaction.current.x),
      y = Math.min(interaction.start.y, interaction.current.y);
    const width = Math.abs(interaction.current.x - interaction.start.x),
      height = Math.abs(interaction.current.y - interaction.start.y);
    ctx.fillStyle = "rgba(79,124,255,.08)";
    ctx.strokeStyle = "#6d9cff";
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([3 / zoom, 2 / zoom]);
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
  }
  if (interaction?.kind === "move")
    for (const guide of interaction.guides ?? []) {
      ctx.strokeStyle = "#ff4fa3";
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([4 / zoom, 3 / zoom]);
      ctx.beginPath();
      const infinite = design.canvas.mode === "infinite";
      const left = infinite ? -pan.x / zoom : 0;
      const top = infinite ? -pan.y / zoom : 0;
      const right = infinite ? (width - pan.x) / zoom : design.canvas.width;
      const bottom = infinite ? (height - pan.y) / zoom : design.canvas.height;
      ctx.moveTo(guide.axis === "x" ? guide.value : left, guide.axis === "y" ? guide.value : top);
      ctx.lineTo(
        guide.axis === "x" ? guide.value : right,
        guide.axis === "y" ? guide.value : bottom,
      );
      ctx.stroke();
    }
  return handles;
}
