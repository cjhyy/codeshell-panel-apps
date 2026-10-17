/* A temporary renderer projection; never rewrites the saved CodeShell document. */
import { gradientMatrix } from "../../apps/design-studio/app/paint.mjs";

export const GRIDA_ENCODER_SOURCE_COMMIT = "f0e2aeab23575fb9c2970d5f55275f1679c87155";
export const gridaImageResourceId = (id) => `res://codeshell-images/${encodeURIComponent(id)}`;

export function rgba(value, alpha = 1) {
  if (!/^#[a-f\d]{6}$/iu.test(value)) return { r: 0, g: 0, b: 0, a: 0 };
  return { r: parseInt(value.slice(1, 3), 16) / 255,
    g: parseInt(value.slice(3, 5), 16) / 255,
    b: parseInt(value.slice(5, 7), 16) / 255, a: alpha };
}

const paintBase = { active: true, blend_mode: "normal", opacity: 1 };
const solid = (color, opacity = 1) => ({ ...paintBase, type: "solid", color: rgba(color, opacity) });
function paintsFor(node) {
  const paints = node.fillPaints ?? [{ type: "SOLID", color: node.fill, opacity: 1 }];
  return paints.map((paint) => paint.type === "SOLID"
    ? solid(paint.color, paint.opacity)
    : { ...paintBase, type: "linear_gradient", opacity: paint.opacity,
      xy1: [0, 0.5], xy2: [1, 0.5], transform: gradientMatrix(paint.handles),
      stops: paint.stops.map((stop) => ({ offset: stop.position,
        color: rgba(stop.color, stop.opacity) })) });
}
const firstFamily = (family = "Inter") => String(family).split(",")[0].trim().replace(/^["']|["']$/gu, "");
const imagePaint = (src, fit = "fill") => ({ ...paintBase, type: "image", src, fit,
  filters: { exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0,
    highlights: 0, shadows: 0 } });

/** Preserve source node IDs and ordering while projecting absolute-canvas coordinates. */
export async function toGridaDocument(design, {
  resources = new Map(), registeredFontFamilies = new Set(), fontFallbackReasons = new Map(), rasterizeText,
} = {}) {
  if (!Array.isArray(design?.nodes)) throw Error("Grida requires a normalized active-page design.nodes array");
  const sourceById = new Map(design.nodes.map((node) => [node.id, node]));
  if (sourceById.size !== design.nodes.length) throw Error("Duplicate source node IDs");
  const used = new Set(sourceById.keys());
  const auxiliaryId = (name) => {
    let id = `__codeshell_compare_${name}__`, suffix = 0;
    while (used.has(id)) id = `__codeshell_compare_${name}_${++suffix}__`;
    used.add(id);
    return id;
  };
  const sceneId = auxiliaryId("scene"), boardId = auxiliaryId("artboard");
  const nodes = Object.create(null), links = Object.create(null);
  links[sceneId] = [boardId];
  const document = { nodes, links, scenes_ref: [sceneId], entry_scene_id: sceneId,
    properties: {}, images: {}, bitmaps: {} };
  const issues = [];
  const stats = { sourceNodes: design.nodes.length, convertedSourceNodes: 0, auxiliaryNodes: 2,
    nativeTextNodes: 0, rasterTextFallback: 0, nativeImageNodes: 0,
    missingImages: 0, sourceMissingImages: design.sourceMissingImages ?? 0,
    linearGradients: 0, clippingContainers: 0,
    rotatedNodes: 0, shadows: 0, unsupportedNodes: 0, unsupported: issues };
  const mark = (code, node, message) => issues.push({ code, nodeId: node.id, message });
  const common = (node, parent = null) => ({
    id: node.id, name: node.name, active: node.visible !== false, locked: node.locked === true,
    layout_positioning: "absolute", layout_inset_left: node.x - (parent?.x ?? 0),
    layout_inset_top: node.y - (parent?.y ?? 0),
    layout_target_width: node.width, layout_target_height: node.height,
    opacity: node.opacity, z_index: 0, rotation: node.rotation ?? 0,
    corner_radius: node.cornerRadius ?? 0,
    rectangular_corner_radius_top_left: Math.min(node.cornerRadius ?? 0, node.width / 2, node.height / 2),
    rectangular_corner_radius_top_right: Math.min(node.cornerRadius ?? 0, node.width / 2, node.height / 2),
    rectangular_corner_radius_bottom_left: Math.min(node.cornerRadius ?? 0, node.width / 2, node.height / 2),
    rectangular_corner_radius_bottom_right: Math.min(node.cornerRadius ?? 0, node.width / 2, node.height / 2),
    stroke_width: node.strokeWidth ?? 0,
    stroke_align: "center", stroke_cap: "butt", stroke_join: "miter",
    stroke_paints: node.stroke !== "transparent" ? [solid(node.stroke)] : [],
    fill_paints: paintsFor(node),
    fe_shadows: node.shadow?.opacity > 0 ? [{ type: "shadow", active: true, inset: false,
      dx: node.shadow.x, dy: node.shadow.y, blur: node.shadow.blur / 2, spread: 0,
      color: rgba(node.shadow.color, node.shadow.opacity) }] : [],
  });
  const container = (node) => ({ ...node, type: "container", clips_content: false,
    layout_mode: "flow", layout_direction: "horizontal",
    layout_main_axis_alignment: "start", layout_cross_axis_alignment: "start" });
  nodes[sceneId] = { id: sceneId, type: "scene", name: "CodeShell renderer comparison",
    active: true, locked: false, constraints: { children: "multiple" }, guides: [], edges: [],
    background_color: { r: 0, g: 0, b: 0, a: 0 } };
  nodes[boardId] = { ...common({ id: boardId, name: "Artboard", x: 0, y: 0,
    width: design.canvas.width, height: design.canvas.height, opacity: 1,
    fill: design.canvas.background, stroke: "transparent" }), type: "rectangle" };
  // Compatibility losses in the saved source are reported separately. A transparent
  // imported frame must not become extra artwork in just one comparison renderer.
  const missingSourceImages = new Set();
  const images = [];
  for (const node of design.nodes) {
    const parent = sourceById.get(node.parentId);
    const base = common(node, parent);
    const parentId = parent ? parent.id : sceneId;
    (links[parentId] ??= []).push(node.id);
    let projected;
    stats.rotatedNodes += Number(Boolean(node.rotation));
    stats.shadows += Number(Boolean(node.shadow?.opacity > 0));
    stats.linearGradients += (node.fillPaints ?? []).filter((paint) => paint.type === "GRADIENT_LINEAR").length;
    if (["frame", "component", "group"].includes(node.type)) {
      projected = container(base);
      projected.clips_content = node.clipContent === true;
      if (node.type === "group") { projected.fill_paints = []; projected.stroke_paints = []; }
      stats.clippingContainers += Number(projected.clips_content);
    } else if (node.type === "rectangle") projected = { ...base, type: "rectangle" };
    else if (node.type === "ellipse") projected = { ...base, type: "ellipse", angle: 360,
      angle_offset: 0, inner_radius: 0 };
    else if (node.type === "text") {
      const family = firstFamily(node.fontFamily);
      if (registeredFontFamilies.has(family) && !fontFallbackReasons.has(family)) {
        projected = { ...base, type: "tspan", text: node.text,
          font_family: family, font_size: node.fontSize, font_weight: node.fontWeight,
          font_style_italic: node.fontStyle === "italic", font_kerning: true,
          text_decoration_line: node.textDecoration ?? "none", text_align: node.textAlign,
          text_align_vertical: "top", letter_spacing: (node.letterSpacing ?? 0) / node.fontSize,
          line_height: node.lineHeight };
        stats.nativeTextNodes += 1;
      } else if (rasterizeText) {
        const image = await rasterizeText(node);
        const id = auxiliaryId(`text_${node.id}`), resourceId = `res://codeshell-raster-text/${encodeURIComponent(node.id)}`;
        projected = container({ ...base, fill_paints: [], stroke_paints: [], fe_shadows: [] });
        nodes[id] = { ...common({ ...node, id, x: image.x, y: image.y, width: image.width,
          height: image.height, fill: "transparent", stroke: "transparent", opacity: 1,
          rotation: 0, shadow: null, cornerRadius: 0 }), type: "rectangle",
          fill_paints: [imagePaint(resourceId)] };
        links[node.id] = [id];
        images.push({ id: resourceId, bytes: image.bytes });
        stats.auxiliaryNodes += 1;
        stats.rasterTextFallback += 1;
        mark(fontFallbackReasons.has(family) ? "native-font-raster-cache" : "system-text-raster-cache", node,
          fontFallbackReasons.get(family) ??
          `Native font ${family} is absent; original browser typography is cached as an individual text image.`);
      } else {
        projected = { ...base, type: "rectangle", fill_paints: [solid("#fff0f3")],
          stroke_paints: [solid("#ff5c78")], stroke_width: 1 };
        mark("missing-font", node, `Font bytes for ${family} were not supplied.`);
        stats.unsupportedNodes += 1;
      }
    } else if (node.type === "image") {
      projected = { ...base, type: "rectangle" };
      const resource = resources.get(node.imageRef);
      if (resource?.bytes?.length) {
        projected.fill_paints = [imagePaint(gridaImageResourceId(node.imageRef),
          { cover: "cover", contain: "contain", fill: "fill" }[node.objectFit] ?? "cover")];
        stats.nativeImageNodes += 1;
        if (node.objectFit === "fill") {
          stats.unsupportedNodes += 1;
          mark("image-stretch-compatibility", node,
            "Pinned Grida image fill fitting is not reliable for all source/target sizes; verify stretched images visually.");
        }
      } else missingSourceImages.add(node.id);
    } else {
      projected = container({ ...base, fill_paints: [solid("#fff0f3")],
        stroke_paints: [solid("#ff5c78")], stroke_width: 1 });
      stats.unsupportedNodes += 1;
      mark("unsupported-node", node, `No native projection for ${node.type}; layer and children retained as a placeholder.`);
    }
    if (missingSourceImages.has(node.id)) {
      projected.fill_paints = [solid("#fff0f3")];
      projected.stroke_paints = [solid("#ff5c78")];
      projected.stroke_width = Math.max(1, node.strokeWidth ?? 0);
      stats.missingImages += 1;
      mark("missing-image", node, "Original image resource is unavailable; source layer retained as a placeholder.");
    }
    nodes[node.id] = projected;
    stats.convertedSourceNodes += 1;
  }
  return { document, images, stats };
}
