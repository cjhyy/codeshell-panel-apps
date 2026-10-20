import { cssCornerRadii } from "../../../apps/design-studio/app/corner-radii.mjs";
import { FigmaAdapter } from "../upstream/packages/adapter/figma/FigmaAdapter";
import { inertDesignSvg } from "../../../apps/design-studio/app/design-node-adapter.mjs";
import { cssLinearBackgroundPaints } from "../../../apps/design-studio/app/css-linear-gradient.mjs";
import { designPaintsToFigma, cssLinearNeedsNativeWarning } from "../../../apps/design-studio/app/paint.mjs";
export { inertDesignSvg };
export const MAX_INPUT_BYTES = 12 * 1024 * 1024;
export const MAX_NODES = 3000;
const object = (v: any) => v && typeof v === "object" && !Array.isArray(v);
export function prepareDesignInput(input: any) {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_INPUT_BYTES)
    throw new Error("输入最多 12 MiB");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("JSON 无法解析");
  }
  const roots = Array.isArray(data) ? data : Array.isArray(data?.nodes) ? data.nodes : [data];
  if (!roots.length || roots.length > 20) throw new Error("每次导入 1–20 个根节点");
  let count = 0;
  const warnings: string[] = [];
  const reservedIds = new Set<string>();
  const legacyGridWarning =
    "Grid 使用测量像素的 Flex 行/固定几何兼容转换，未保留原生轨道或响应式尺寸；需要原生 Grid 时请通过 Design Studio 导入并使用 Design Bridge。";
  const legacyBorderWarning =
    "CSS 边框使用独立插件的统一居中描边兼容转换，未保留各侧宽度、颜色或内部对齐；需要可编辑侧边时请通过 Design Studio 导入并使用 Design Bridge。";
  const hasCssBorder = (node: any): boolean => Boolean(node.nodeType &&
    ["top", "right", "bottom", "left"].some((side) => node.border?.[side]?.width > 0 && node.border[side].style !== "none"));
  function inspect(node: any, depth = 0) {
    if (!object(node) || depth > 60 || ++count > MAX_NODES)
      throw new Error("节点树最多 3000 个节点、60 层");
    if (!node.nodeType && !["FRAME", "GROUP", "RECTANGLE", "TEXT", "SVG"].includes(node.type))
      throw new Error(`不支持节点类型：${String(node.type ?? "unknown").slice(0, 60)}`);
    if (node.nodeType && !["container", "text", "image", "svg"].includes(node.nodeType))
      throw new Error("不支持的 DesignNode 类型");
    const bounds = node.nodeType ? node.bounds : node;
    if (
      !object(bounds) ||
      !["width", "height"].every(
        (k) => Number.isFinite(bounds[k]) && bounds[k] >= 0 && bounds[k] <= 20000,
      )
    )
      throw new Error("节点宽高必须在 0–20000 之间");
    if (node.nodeType === "svg" || node.type === "SVG") inertDesignSvg(node.svgContent);
    if (node.children !== undefined && !Array.isArray(node.children))
      throw new Error("children 必须是数组");
    if (
      node.codeshellGridFallback === true ||
      node.cssLayout?.["--codeshell-grid-legacy"] === "synthetic"
    )
      warnings.push(legacyGridWarning);
    if (node.codeshellBorderFallback === true || hasCssBorder(node)) warnings.push(legacyBorderWarning);
    if (typeof node.id === "string" && node.id) reservedIds.add(node.id);
    for (const child of node.children ?? []) inspect(child, depth + 1);
  }
  roots.forEach((root: any) => inspect(root));
  const gradientPaints = new Map<string, any[]>();
  const assignedIds = new Set<string>();
  let sourceSerial = 0;
  function retainGradients(node: any) {
    // Inputs may mix DesignNode and native JSON roots. Make identities unique
    // across both before using them to reattach paints after upstream mapping.
    if (typeof node.id !== "string" || !node.id || assignedIds.has(node.id)) {
      let id;
      do { id = `codeshell-source-${sourceSerial++}`; } while (reservedIds.has(id));
      node.id = id;
      reservedIds.add(id);
    }
    assignedIds.add(node.id);
    if (node.nodeType && node.cssBorderRadii) {
      try { cssCornerRadii(node.cssBorderRadii); }
      catch (error: any) {
        node.border ??= {};
        node.border.radius = { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };
        warnings.push(`圆角未导入：${error.message}。`);
      }
    }
    if (node.nodeType && (node.cssBackground?.["background-image"]?.includes("gradient(") ||
        node.background?.layers?.some((layer: any) => layer.type?.endsWith("gradient")))) {
      // Never pass the unit-losing upstream gradient parse into its Figma mapper.
      // This is our cloned JSON, not the caller's DesignNode or pinned upstream.
      node.background ??= { layers: [] };
      node.background.layers = (node.background.layers ?? []).filter((layer: any) => !layer.type?.endsWith("gradient"));
      try {
        const fillPaints = cssLinearBackgroundPaints(node.cssBackground, node.bounds.width, node.bounds.height);
        gradientPaints.set(node.id, designPaintsToFigma({ fillPaints, ...node.bounds }));
        if (fillPaints.some(cssLinearNeedsNativeWarning))
          warnings.push("CSS 角度/像素色标仅按当前尺寸创建为原生渐变，Figma 内调整尺寸可能改变外观；请通过 Design Studio 保留和编辑原始 CSS 意图。");
      } catch (error: any) {
        warnings.push(`渐变未导入，保留独立背景色：${error.message}。`);
      }
    }
    for (const child of node.children ?? []) retainGradients(child);
  }
  roots.forEach(retainGradients);
  const hasLegacyGrid = (node: any): boolean =>
    node.codeshellGridFallback === true ||
    node.cssLayout?.["--codeshell-grid-legacy"] === "synthetic" ||
    (node.children ?? []).some(hasLegacyGrid);
  const hasLegacyBorder = (node: any): boolean =>
    node.codeshellBorderFallback === true || hasCssBorder(node) || (node.children ?? []).some(hasLegacyBorder);
  const converted = roots.map((root: any) => {
    const converted = root.nodeType ? FigmaAdapter.toFigmaJSON(root) : root;
    if (hasLegacyGrid(root)) converted.codeshellGridFallback = true;
    if (hasLegacyBorder(root)) converted.codeshellBorderFallback = true;
    return converted;
  });
  count = 0;
  // The adapter can add synthetic frames; recheck the final tree once, without double recursion.
  function normalizeOnce(node: any) {
    if (gradientPaints.has(node.id)) node.fills = gradientPaints.get(node.id);
    node.name = String(node.name || node.type || "HTML layer").slice(0, 120);
    node.id ||= `html-${serial++}`;
    node.width = Math.max(1, node.width);
    node.height = Math.max(1, node.height);
    if (node.type === "GROUP") {
      node.type = "FRAME";
      node.fills ||= [];
      node.clipsContent = false;
      warnings.push("GROUP 以可编辑 FRAME 导入");
    }
    if (
      node.type === "TEXT" &&
      (typeof node.characters !== "string" || node.characters.length > 10000)
    )
      throw new Error("单个文本节点最多 10000 字符");
    (node.children ?? []).forEach(normalizeOnce);
  }
  converted.forEach((root: any) => inspect(root));
  let serial = 0;
  converted.forEach(normalizeOnce);
  return { roots: converted, count, warnings: [...new Set(warnings)] };
}
