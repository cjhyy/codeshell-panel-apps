import { FigmaAdapter } from "../upstream/packages/adapter/figma/FigmaAdapter";
import { inertDesignSvg } from "../../../apps/design-studio/app/design-node-adapter.mjs";
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
    for (const child of node.children ?? []) inspect(child, depth + 1);
  }
  roots.forEach((root: any) => inspect(root));
  const converted = roots.map((root: any) =>
    root.nodeType ? FigmaAdapter.toFigmaJSON(root) : root,
  );
  count = 0;
  // The adapter can add synthetic frames; recheck the final tree once, without double recursion.
  function normalizeOnce(node: any) {
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
