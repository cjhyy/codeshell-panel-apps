import { figmaFillPaints, representativeDesignFill } from "./paint.mjs";
/* Deliberately bounded Figma JSON bridge. Figma binary files are not supported. */
import {
  MAX_DESIGN_NODES_PER_PAGE,
  MAX_DESIGN_CANVAS_SIZE,
  MAX_DESIGN_PAGES,
  isDesignNodeVisible,
  normalizeDesignDocument,
  normalizeDesignState,
  repositoryDesignPage,
} from "./document.mjs";
import { clipNodeBoundsToClippingAncestors } from "./geometry.mjs";
import { measureFigmaTextDocument } from "./text-metrics.mjs";
import {
  normalizeFigmaSource,
  prepareFigmaAssets,
  createFigmaTransferAssets,
} from "./figma-assets.mjs";

export const MAX_FIGMA_JSON_BYTES = 16 * 1024 * 1024;
export const MAX_FIGMA_TOTAL_NODES = 50_000;
const MAX_DEPTH = 32;
const MAX_WARNINGS = 200;
const TYPES = {
  FRAME: "frame",
  RECTANGLE: "rectangle",
  ELLIPSE: "ellipse",
  TEXT: "text",
  GROUP: "group",
  COMPONENT: "frame",
  COMPONENT_SET: "frame",
  INSTANCE: "frame",
  SECTION: "frame",
};
const CONTAINERS = new Set(["frame", "group"]);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value) => Math.round(value * 10000) / 10000;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const cleanName = (value, fallback) =>
  (typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]/gu, " ")
        .trim()
        .slice(0, 120)
    : "") || fallback;

function reporter() {
  const warnings = [];
  let total = 0;
  return {
    warnings,
    warn(code, source, message) {
      total += 1;
      if (warnings.length < MAX_WARNINGS)
        warnings.push({
          code,
          ...(source?.id ? { nodeId: String(source.id).slice(0, 160) } : {}),
          message,
        });
    },
    finish() {
      if (total > MAX_WARNINGS)
        warnings.push({
          code: "warnings-truncated",
          message: `另有 ${total - MAX_WARNINGS} 条兼容性提示未展开。`,
        });
      return total;
    },
  };
}

function readJson(input) {
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).byteLength > MAX_FIGMA_JSON_BYTES)
      throw new Error("Figma JSON 最多 16 MiB；请分页面导出。");
    try {
      return JSON.parse(input);
    } catch {
      throw new Error("Figma JSON 无法解析；不支持二进制 .fig 文件。");
    }
  }
  if (!object(input)) throw new Error("请输入 Figma REST 或 JSON_REST_V1 对象。");
  return input;
}

function sourcePages(input, depth = 0) {
  if (depth > 4) throw new Error("Figma JSON 包装层级过深或包含循环。");
  if (object(input.document)) return sourcePages(input.document, depth + 1);
  if (input.type === "DOCUMENT") {
    if (!Array.isArray(input.children) || input.children.some((page) => page?.type !== "CANVAS"))
      throw new Error("Figma DOCUMENT 必须包含 CANVAS 页面。");
    return input.children;
  }
  if (input.type === "CANVAS") return [input];
  if (object(input.nodes)) {
    if (Object.keys(input.nodes).length > MAX_DESIGN_NODES_PER_PAGE)
      throw new Error("选中图层数量超出导入上限。");
    const roots = Object.values(input.nodes)
      .map((entry) => entry?.document)
      .filter(object);
    if (!roots.length) throw new Error("JSON_REST_V1 中没有可读取的 document。");
    const pages = roots.filter((root) => root.type === "CANVAS" || root.type === "DOCUMENT");
    if (pages.length === roots.length) return pages.flatMap((page) => sourcePages(page, depth + 1));
    if (pages.length) throw new Error("请分别导出页面与选中的图层，避免重复导入。");
    return [
      {
        id: input.selection?.pageId ?? "selection",
        type: "CANVAS",
        name: input.selection?.pageName ?? "Figma Selection",
        partial: true,
        children: roots,
      },
    ];
  }
  if (
    TYPES[input.type] ||
    ["VECTOR", "BOOLEAN_OPERATION", "LINE", "POLYGON", "STAR"].includes(input.type)
  ) {
    return [{ id: "selection", type: "CANVAS", name: "Figma Selection", children: [input] }];
  }
  throw new Error("不是支持的 Figma REST 文件、DOCUMENT、CANVAS 或 JSON_REST_V1 导出。");
}

function color(value, fallback = "#ffffff") {
  if (!object(value) || ![value.r, value.g, value.b].every(finite)) return fallback;
  return `#${[value.r, value.g, value.b]
    .map((channel) =>
      Math.round(clamp(channel, 0, 1) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function number(value, fallback, min, max, source, key, report) {
  if (value === undefined || value === null) return fallback;
  if (!finite(value)) {
    report.warn("invalid-value", source, `${key} 无效，已使用默认值。`);
    return fallback;
  }
  const result = clamp(value, min, max);
  if (value !== result)
    report.warn("value-clamped", source, `${key} 超出设计面板范围，已限制为 ${result}。`);
  return round(result);
}

function paint(paints, source, key, report) {
  if (!Array.isArray(paints)) return "transparent";
  const visible = paints.filter((entry) => entry?.visible !== false);
  if (visible.length > 1)
    report.warn("multiple-paints", source, `${key} 只能保留第一个纯色，其他绘制未导入。`);
  for (const entry of visible) {
    if (entry?.type !== "SOLID")
      report.warn(
        "unsupported-paint",
        source,
        `${key} 的 ${entry?.type ?? "未知"} 绘制未导入；图片需要独立资源。`,
      );
  }
  const solid = visible.find((entry) => entry?.type === "SOLID");
  if (!solid) return "transparent";
  const alpha =
    (finite(solid.opacity) ? solid.opacity : 1) * (finite(solid.color?.a) ? solid.color.a : 1);
  if (alpha === 0) return "transparent";
  if (alpha !== 1)
    report.warn(
      "paint-opacity",
      source,
      `${key} 的独立透明度暂按不透明纯色导入；图层透明度仍保留。`,
    );
  return color(solid.color, "#000000");
}

function rotatePoint(point, node, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const centerX = node.x + node.width / 2,
    centerY = node.y + node.height / 2;
  const x = point.x - centerX,
    y = point.y - centerY;
  return {
    x: centerX + x * Math.cos(radians) - y * Math.sin(radians),
    y: centerY + x * Math.sin(radians) + y * Math.cos(radians),
  };
}

function geometry(source, ancestors, report) {
  const bounds = object(source.absoluteBoundingBox) ? source.absoluteBoundingBox : null;
  const matrix = source.relativeTransform;
  const hasMatrix =
    Array.isArray(matrix) &&
    matrix.length === 2 &&
    matrix.every((row) => Array.isArray(row) && row.length === 3 && row.every(finite));
  let rotation = hasMatrix
    ? (Math.atan2(matrix[1][0], matrix[0][0]) * 180) / Math.PI
    : finite(source.rotation)
      ? (source.rotation * 180) / Math.PI
      : 0;
  const hasSize = finite(source.size?.x) && finite(source.size?.y);
  let width = hasSize ? source.size.x : (bounds?.width ?? source.width);
  let height = hasSize ? source.size.y : (bounds?.height ?? source.height);
  if (hasMatrix) {
    const [a, b] = matrix[0],
      [c, d] = matrix[1];
    if (
      Math.abs(a * d - b * c - 1) > 0.001 ||
      Math.abs(a * a + c * c - 1) > 0.001 ||
      Math.abs(b * b + d * d - 1) > 0.001
    ) {
      report.warn(
        "unsupported-transform",
        source,
        "镜像、缩放或倾斜矩阵不能完整保留，已近似为旋转和边界框。",
      );
    }
  }
  const totalRotation = rotation + ancestors.reduce((sum, ancestor) => sum + ancestor.rotation, 0);
  if (!hasSize && totalRotation && bounds) {
    const c = Math.abs(Math.cos((totalRotation * Math.PI) / 180)),
      s = Math.abs(Math.sin((totalRotation * Math.PI) / 180)),
      determinant = c * c - s * s;
    const inferredWidth = (bounds.width * c - bounds.height * s) / determinant;
    const inferredHeight = (bounds.height * c - bounds.width * s) / determinant;
    if (Math.abs(determinant) > 0.0001 && inferredWidth > 0 && inferredHeight > 0) {
      width = inferredWidth;
      height = inferredHeight;
      report.warn(
        "rotation-inferred",
        source,
        "缺少原始 size，已从旋转边界框推导尺寸；REST 导出建议使用 geometry=paths。",
      );
    } else {
      report.warn(
        "rotation-bounds",
        source,
        "缺少原始 size，旋转已近似为轴对齐边界框；REST 导出建议使用 geometry=paths。",
      );
      rotation = 0;
    }
  }
  width = number(width, 100, 1, 20000, source, "width", report);
  height = number(height, 100, 1, 20000, source, "height", report);
  let center;
  if (bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(finite)) {
    center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    for (const ancestor of ancestors) center = rotatePoint(center, ancestor, -ancestor.rotation);
  } else if (hasMatrix) {
    const parent = ancestors.at(-1),
      radians = (rotation * Math.PI) / 180;
    center = {
      x:
        (parent?.x ?? 0) +
        matrix[0][2] +
        (Math.cos(radians) * width) / 2 -
        (Math.sin(radians) * height) / 2,
      y:
        (parent?.y ?? 0) +
        matrix[1][2] +
        (Math.sin(radians) * width) / 2 +
        (Math.cos(radians) * height) / 2,
    };
  } else {
    report.warn("missing-geometry", source, "缺少绝对边界和变换，已使用默认几何位置。");
    center = {
      x: (ancestors.at(-1)?.x ?? 0) + width / 2,
      y: (ancestors.at(-1)?.y ?? 0) + height / 2,
    };
  }
  return {
    x: number(center.x - width / 2, 0, -20000, 20000, source, "x", report),
    y: number(center.y - height / 2, 0, -20000, 20000, source, "y", report),
    width,
    height,
    rotation: round(((((rotation + 180) % 360) + 360) % 360) - 180),
  };
}

function layout(source, node, report) {
  node.layout = { HORIZONTAL: "horizontal", VERTICAL: "vertical" }[source.layoutMode] ?? "none";
  if (source.layoutMode === "GRID")
    report.warn("grid-layout", source, "Figma Grid 暂按固定几何导入，未保留网格布局行为。");
  node.gap = number(source.itemSpacing, 0, 0, 2000, source, "itemSpacing", report);
  node.padding = 0;
  for (const side of ["Top", "Right", "Bottom", "Left"])
    node[`padding${side}`] = number(
      source[`padding${side}`],
      0,
      0,
      2000,
      source,
      `padding${side}`,
      report,
    );
  node.alignItems =
    { MIN: "start", CENTER: "center", MAX: "end", BASELINE: "baseline" }[
      source.counterAxisAlignItems
    ] ?? "start";
  node.justifyContent =
    { MIN: "start", CENTER: "center", MAX: "end", SPACE_BETWEEN: "space-between" }[
      source.primaryAxisAlignItems
    ] ?? "start";
  node.layoutWrap = source.layoutWrap === "WRAP" ? "wrap" : "none";
  if (finite(source.counterAxisSpacing)) {
    if (node.layout === "horizontal")
      node.rowGap = number(
        source.counterAxisSpacing,
        0,
        0,
        2000,
        source,
        "counterAxisSpacing",
        report,
      );
    else
      node.columnGap = number(
        source.counterAxisSpacing,
        0,
        0,
        2000,
        source,
        "counterAxisSpacing",
        report,
      );
  }
  if (source.counterAxisAlignContent === "SPACE_BETWEEN") node.alignContent = "space-between";
  if (node.type === "frame") node.clipContent = source.clipsContent === true;
}

function text(source, node, report) {
  const style = object(source.style) ? source.style : {};
  if (typeof source.characters !== "string")
    report.warn("missing-text", source, "文字内容缺失，已导入空文本。");
  node.text = typeof source.characters === "string" ? source.characters.slice(0, 4000) : "";
  if (source.characters?.length > 4000)
    report.warn("text-truncated", source, "文字超过 4000 字符，已截断。");
  node.fontSize = number(style.fontSize, 16, 6, 240, source, "fontSize", report);
  node.fontWeight =
    Math.round(number(style.fontWeight, 400, 100, 900, source, "fontWeight", report) / 100) * 100;
  if (finite(style.fontWeight) && node.fontWeight !== style.fontWeight)
    report.warn(
      "font-weight-rounded",
      source,
      "字体数值字重已映射到最接近的百位字重；原始字体设置保存在来源记录中。",
    );
  node.lineHeight = number(
    finite(style.lineHeightPx)
      ? style.lineHeightPx / node.fontSize
      : finite(style.lineHeightPercentFontSize)
        ? style.lineHeightPercentFontSize / 100
        : undefined,
    1.2,
    0.7,
    3,
    source,
    "lineHeight",
    report,
  );
  node.textAlign =
    { LEFT: "left", CENTER: "center", RIGHT: "right" }[style.textAlignHorizontal] ?? "left";
  if (style.textAlignHorizontal === "JUSTIFIED")
    report.warn("justified-text", source, "两端对齐暂按左对齐导入。");
  node.fontFamily = cleanName(style.fontFamily, "Inter");
  node.fontStyle = style.italic === true ? "italic" : "normal";
  node.letterSpacing = number(style.letterSpacing, 0, -20, 100, source, "letterSpacing", report);
  node.textDecoration =
    { UNDERLINE: "underline", STRIKETHROUGH: "line-through" }[style.textDecoration] ?? "none";
  node.cornerRadius = 0;
  if (node.text.trim()) {
    node.textSource = node.text;
    if (style.textAutoResize !== "WIDTH_AND_HEIGHT") node.textFlow = "wrap";
    node.textFlowWidth = node.width;
  }
  if (
    source.characterStyleOverrides?.some((value) => value !== 0) ||
    Object.keys(source.styleOverrideTable ?? {}).length
  )
    report.warn("rich-text", source, "混合文字样式已统一为图层基本样式。");
  if (style.textAlignVertical && style.textAlignVertical !== "TOP")
    report.warn("vertical-text", source, "文字垂直对齐暂按顶部对齐导入。");
}

/** Import a REST GET file response, DOCUMENT/CANVAS, selected node, or JSON_REST_V1 nodes response. */
export function importFigmaJson(
  input,
  { resources = [], imageRefs = new Map(), previews = {} } = {},
) {
  const value = readJson(input),
    pages = sourcePages(value),
    report = reporter();
  if (!pages.length || pages.length > MAX_DESIGN_PAGES)
    throw new Error(`Figma 页面数量必须为 1–${MAX_DESIGN_PAGES}。`);
  const ids = new Set(),
    seen = new Set();
  let visited = 0,
    importedNodes = 0,
    skippedNodes = 0;
  const mapping = [],
    pageMappings = [];
  const nonRenderingSourceNodes = new Set();
  let currentPage = null;
  const recordMapping = (source, node) => {
    if (source.absoluteRenderBounds === null) nonRenderingSourceNodes.add(node.id);
    const context = value.selection?.roots?.[source.id];
    if (typeof source.id === "string")
      mapping.push({
        designId: node.id,
        sourceId: source.id,
        pageId: currentPage.id,
        sourcePageId: currentPage.sourceId,
        offsetX: 0,
        offsetY: 0,
        ...(context && Array.isArray(context.parentTransform)
          ? {
              selectionRoot: true,
              sourceParentId: context.parentId,
              sourceParentTransform: context.parentTransform,
            }
          : {}),
      });
  };
  const allocateId = (source, fallback, page = false) => {
    const sourceId = typeof source.id === "string" ? source.id : fallback;
    const prefix = /^\d+:\d+$/u.test(sourceId) ? "figma-" : page ? "figma-page-" : "figma-node-";
    const base = `${prefix}${sourceId.toLowerCase().replace(/[^a-z0-9-]/gu, "-")}`.slice(
      0,
      page ? 58 : 150,
    );
    let id = base,
      suffix = 2;
    while (ids.has(id)) id = `${base}-${suffix++}`;
    if (id !== base)
      report.warn("duplicate-source-id", source, "重复的 Figma ID 已生成独立图层 ID。");
    ids.add(id);
    return id;
  };
  const convert = (source, ancestors, depth, counter) => {
    if (!object(source)) throw new Error("Figma 图层必须是对象。");
    if (depth > MAX_DEPTH) throw new Error(`Figma 图层嵌套最多 ${MAX_DEPTH} 层。`);
    if (seen.has(source)) throw new Error("Figma JSON 包含循环或重复对象引用。");
    seen.add(source);
    if (++visited > MAX_FIGMA_TOTAL_NODES || ++counter.count > MAX_DESIGN_NODES_PER_PAGE)
      throw new Error("Figma 图层超出导入上限；请拆分页面或文件。");
    const preview = previews[source.id];
    const previewRef = preview && imageRefs.get(preview.assetId);
    const imagePaint = Array.isArray(source.fills)
      ? source.fills.find(
          (entry) =>
            entry?.visible !== false &&
            entry.type === "IMAGE" &&
            imageRefs.has(entry.imageRef ?? entry.imageHash),
        )
      : null;
    const type = previewRef
      ? "image"
      : imagePaint && !source.children?.length
        ? "image"
        : TYPES[source.type];
    if (!type) {
      skippedNodes += 1;
      report.warn(
        "unsupported-node",
        source,
        `${source.type ?? "未知"} 图层未导入；矢量路径、布尔运算和特殊图层暂不支持。`,
      );
      // Traverse unsupported children for limits without presenting their contents as faithful.
      const inspect = (entry, nestedDepth) => {
        if (!object(entry) || seen.has(entry) || nestedDepth > MAX_DEPTH)
          throw new Error("Figma 图层包含无效、循环或过深结构。");
        seen.add(entry);
        skippedNodes += 1;
        if (++visited > MAX_FIGMA_TOTAL_NODES || ++counter.count > MAX_DESIGN_NODES_PER_PAGE)
          throw new Error("Figma 图层超出导入上限。");
        if (entry.children !== undefined && !Array.isArray(entry.children))
          throw new Error("Figma children 必须是数组。");
        for (const child of entry.children ?? []) inspect(child, nestedDepth + 1);
      };
      if (source.children !== undefined && !Array.isArray(source.children))
        throw new Error("Figma children 必须是数组。");
      for (const child of source.children ?? []) inspect(child, depth + 1);
      return null;
    }
    if (previewRef) {
      const box = preview.bounds ?? source.absoluteRenderBounds ?? source.absoluteBoundingBox;
      const previewSource = {
        ...source,
        absoluteBoundingBox: box,
        size: { x: box?.width, y: box?.height },
        relativeTransform: undefined,
        rotation:
          (-ancestors.reduce((sum, ancestor) => sum + ancestor.rotation, 0) * Math.PI) / 180,
      };
      const node = {
        id: allocateId(source, `node-${visited}`),
        type: "image",
        name: cleanName(source.name, source.type),
        ...geometry(previewSource, ancestors, report),
        imageRef: previewRef,
        objectFit: "fill",
        fill: "transparent",
        stroke: "transparent",
        strokeWidth: 0,
        opacity: 1,
        cornerRadius: 0,
        visible: source.visible !== false,
        locked: source.locked === true,
      };
      report.warn(
        "visual-fallback",
        source,
        "复杂图层以本地图片预览保留外观；原始矢量、样式和关系保存在来源记录中，增量导回保留未修改属性。",
      );
      importedNodes += 1;
      recordMapping(source, node);
      return node;
    }
    const fillPaints = !imagePaint && !["group", "image"].includes(type)
      ? figmaFillPaints(source.fills, message => report.warn("paint-conversion", source, message))
      : null;
    const node = {
      id: allocateId(source, `node-${visited}`),
      type,
      name: cleanName(source.name, source.type),
      ...geometry(
        !ancestors.length && value.selection?.roots?.[source.id]
          ? {
              ...source,
              relativeTransform: value.selection.roots[source.id].absoluteTransform,
              size: {
                x: value.selection.roots[source.id].width,
                y: value.selection.roots[source.id].height,
              },
            }
          : source,
        ancestors,
        report,
      ),
      fill: imagePaint ? "transparent" : fillPaints ? representativeDesignFill(fillPaints) : paint(source.fills, source, "填充", report),
      stroke: paint(source.strokes, source, "描边", report),
      strokeWidth: number(source.strokeWeight, 0, 0, 100, source, "strokeWeight", report),
      opacity: number(source.opacity, 1, 0, 1, source, "opacity", report),
      cornerRadius: number(
        source.cornerRadius ?? source.rectangleCornerRadii?.[0],
        0,
        0,
        9999,
        source,
        "cornerRadius",
        report,
      ),
      visible: source.visible !== false,
      locked: source.locked === true,
    };
    if (fillPaints && (fillPaints.length > 1 || fillPaints.some(paint => paint.type !== "SOLID" || paint.opacity !== 1))) node.fillPaints = fillPaints;
    if (node.stroke === "transparent") node.strokeWidth = 0;
    if (node.strokeWidth && source.strokeAlign !== "CENTER")
      report.warn("stroke-alignment", source, "内侧或外侧描边暂按居中描边导入。");
    if (type === "group") {
      node.fill = "transparent";
      node.stroke = "transparent";
      node.strokeWidth = 0;
      node.cornerRadius = 0;
    }
    if (type === "image") {
      node.imageRef = imageRefs.get(imagePaint.imageRef ?? imagePaint.imageHash);
      node.objectFit =
        { FIT: "contain", FILL: "cover", TILE: "fill", STRETCH: "fill" }[imagePaint.scaleMode] ??
        "cover";
      if (
        imagePaint.scaleMode === "TILE" ||
        imagePaint.imageTransform ||
        imagePaint.rotation ||
        imagePaint.filters
      )
        report.warn(
          "image-transform",
          source,
          "图片裁剪、平铺或滤镜保存在来源记录中；编辑器使用基础图片适配。",
        );
      if (imagePaint.opacity !== undefined && imagePaint.opacity !== 1)
        node.opacity = round(node.opacity * clamp(imagePaint.opacity, 0, 1));
    }
    if (imagePaint && source.fills.filter((entry) => entry?.visible !== false).length > 1)
      report.warn(
        "multiple-paints",
        source,
        "多个填充暂使用一个图片填充；所有原始绘制保存在来源记录中。",
      );
    if (["COMPONENT", "COMPONENT_SET", "INSTANCE"].includes(source.type))
      report.warn(
        "detached-component",
        source,
        "组件或实例已转为可编辑 Frame，组件引用、变体和覆写关系未保留。",
      );
    if (source.type === "SECTION")
      report.warn("section-as-frame", source, "Section 已转换为普通 Frame。");
    if (
      source.rectangleCornerRadii?.some((value) => value !== source.rectangleCornerRadii[0]) ||
      source.cornerSmoothing
    )
      report.warn("corner-shape", source, "独立圆角和圆角平滑暂按统一圆角导入。");
    if (source.isMask)
      report.warn("unsupported-mask", source, "遮罩关系未保留。请检查相邻图层显示。 ");
    if (source.blendMode && !["NORMAL", "PASS_THROUGH"].includes(source.blendMode))
      report.warn("blend-mode", source, `${source.blendMode} 混合模式未保留。`);
    if (Object.keys(source.boundVariables ?? {}).length)
      report.warn("variables-as-literals", source, "变量绑定已转成当前静态值。");
    if (source.transitionNodeID || source.interactions?.length || source.reactions?.length)
      report.warn("prototype-interaction", source, "Figma 原型连接和交互未导入。");
    const effects = (Array.isArray(source.effects) ? source.effects : []).filter(
      (effect) => effect?.visible !== false,
    );
    const shadow = effects.find((effect) => effect.type === "DROP_SHADOW");
    if (shadow && type !== "group")
      node.shadow = {
        color: color(shadow.color, "#000000"),
        opacity: number(shadow.color?.a, 1, 0, 1, source, "shadow.opacity", report),
        x: number(shadow.offset?.x, 0, -500, 500, source, "shadow.x", report),
        y: number(shadow.offset?.y, 0, -500, 500, source, "shadow.y", report),
        blur: number(shadow.radius, 0, 0, 200, source, "shadow.blur", report),
      };
    if (effects.length > (node.shadow ? 1 : 0) || shadow?.spread)
      report.warn("unsupported-effects", source, "仅保留一个无扩散外投影；其他效果未导入。");
    for (const axis of ["Horizontal", "Vertical"])
      if (["FIXED", "HUG", "FILL"].includes(source[`layoutSizing${axis}`]))
        node[`layoutSizing${axis}`] = source[`layoutSizing${axis}`].toLowerCase();
    for (const key of ["minWidth", "maxWidth", "minHeight", "maxHeight"])
      if (finite(source[key])) node[key] = number(source[key], 1, 1, 20000, source, key, report);
    if (node.minWidth > node.maxWidth) {
      delete node.maxWidth;
      report.warn("invalid-sizing", source, "maxWidth 小于 minWidth，已忽略。 ");
    }
    if (node.minHeight > node.maxHeight) {
      delete node.maxHeight;
      report.warn("invalid-sizing", source, "maxHeight 小于 minHeight，已忽略。 ");
    }
    if (source.layoutPositioning === "ABSOLUTE") node.layoutPositioning = "absolute";
    if (source.layoutAlign === "STRETCH") node.layoutAlignSelf = "stretch";
    const parent = ancestors.at(-1);
    if (
      source.constraints &&
      parent &&
      (parent.layout === "none" || source.layoutPositioning === "ABSOLUTE")
    ) {
      const constraint = {
        MIN: "start",
        CENTER: "center",
        MAX: "end",
        STRETCH: "stretch",
        SCALE: "scale",
      };
      node.layoutPositioning = "absolute";
      node.constraintHorizontal = constraint[source.constraints.horizontal] ?? "start";
      node.constraintVertical = constraint[source.constraints.vertical] ?? "start";
      node.constraintBaseWidth = parent.width;
      node.constraintBaseHeight = parent.height;
      node.constraintLeft = round(node.x - parent.x);
      node.constraintTop = round(node.y - parent.y);
      node.constraintRight = round(parent.x + parent.width - node.x - node.width);
      node.constraintBottom = round(parent.y + parent.height - node.y - node.height);
    }
    if (source.children !== undefined && !Array.isArray(source.children))
      throw new Error("Figma children 必须是数组。");
    if (CONTAINERS.has(type)) {
      layout(source, node, report);
      node.children = (source.children ?? [])
        .map((child) => convert(child, [...ancestors, node], depth + 1, counter))
        .filter(Boolean);
      if (imagePaint) {
        const background = {
          id: allocateId({ id: `${source.id ?? node.id}-background` }, `background-${visited}`),
          type: "image",
          name: `${node.name.slice(0, 100)} Background`,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          imageRef: imageRefs.get(imagePaint.imageRef ?? imagePaint.imageHash),
          objectFit: imagePaint.scaleMode === "FIT" ? "contain" : "cover",
          fill: "transparent",
          stroke: "transparent",
          strokeWidth: 0,
          opacity: imagePaint.opacity ?? 1,
          rotation: 0,
          cornerRadius: node.cornerRadius,
          visible: true,
          locked: false,
          layoutPositioning: "absolute",
        };
        node.children.unshift(background);
        importedNodes += 1;
      }
    } else if (source.children?.length) throw new Error("基础 Figma 图层不能包含 children。");
    if (type === "text") text(source, node, report);
    importedNodes += 1;
    recordMapping(source, node);
    return node;
  };
  const convertedPages = pages.map((page, index) => {
    if (!Array.isArray(page.children)) throw new Error("Figma CANVAS 必须包含 children 数组。");
    const counter = { count: 0 };
    const id = allocateId(page, `page-${index + 1}`, true);
    currentPage = { id, sourceId: typeof page.id === "string" ? page.id : null };
    if (currentPage.sourceId)
      pageMappings.push({
        designId: id,
        sourceId: currentPage.sourceId,
        offsetX: 0,
        offsetY: 0,
        ...(page.partial ? { partial: true } : {}),
      });
    return {
      id,
      name: cleanName(page.name, `Page ${index + 1}`),
      children: page.children.map((source) => convert(source, [], 0, counter)).filter(Boolean),
    };
  });
  // Size the finite canvas from visible content. Clipped or hidden offscreen
  // descendants still retain their geometry and source mapping for round trips.
  let extentX = 1440,
    extentY = 960;
  for (const [index, page] of convertedPages.entries()) {
    const flat = [];
    const flatten = (nodes, parentId) => {
      for (const node of nodes) {
        flat.push({ ...node, ...(parentId ? { parentId } : {}) });
        flatten(node.children ?? [], node.id);
      }
    };
    flatten(page.children);
    const nodeIndex = new Map(flat.map((node) => [node.id, node]));
    // REST explicitly reports no rendered pixels for these clipped branches.
    // Preserve every layer and its source mapping, while representing its actual
    // source visibility. A missing render-bounds field is not evidence of this.
    const suppressedIds = new Set(flat.filter((node) =>
      nonRenderingSourceNodes.has(node.id) && node.visible !== false && node.parentId &&
      clipNodeBoundsToClippingAncestors(flat, node, nodeIndex) === null,
    ).map((node) => node.id));
    const preserveSourceVisibility = (nodes) => {
      for (const node of nodes) {
        if (suppressedIds.has(node.id)) {
          node.visible = false;
          const flattened = nodeIndex.get(node.id);
          if (flattened) flattened.visible = false;
        }
        preserveSourceVisibility(node.children ?? []);
      }
    };
    preserveSourceVisibility(page.children);
    const bounds = flat
      .filter((node) => node.type !== "group" && isDesignNodeVisible({ nodes: flat }, node, nodeIndex))
      .map((node) => clipNodeBoundsToClippingAncestors(flat, node, nodeIndex))
      .filter(Boolean);
    const minX = bounds.length ? Math.min(...bounds.map((box) => box.x)) : 0,
      minY = bounds.length ? Math.min(...bounds.map((box) => box.y)) : 0;
    const offsetX = minX < 0 || minX >= MAX_DESIGN_CANVAS_SIZE ? -minX : 0;
    const offsetY = minY < 0 || minY >= MAX_DESIGN_CANVAS_SIZE ? -minY : 0;
    if (offsetX || offsetY) {
      const translate = (nodes) => {
        for (const node of nodes) {
          node.x = round(node.x + offsetX);
          node.y = round(node.y + offsetY);
          if (Math.abs(node.x) > 20000 || Math.abs(node.y) > 20000)
            throw new Error("Figma 页面跨度超出设计坐标范围；请拆分页面。");
          translate(node.children ?? []);
        }
      };
      translate(page.children);
      report.warn(
        "page-origin-normalized",
        pages[index],
        `页面原点已平移 (${round(offsetX)}, ${round(offsetY)})，让设计进入可见画布。`,
      );
      for (const entry of mapping)
        if (entry.pageId === page.id) {
          entry.offsetX = offsetX;
          entry.offsetY = offsetY;
        }
      const pageMapping = pageMappings.find((entry) => entry.designId === page.id);
      if (pageMapping) {
        pageMapping.offsetX = offsetX;
        pageMapping.offsetY = offsetY;
      }
    }
    extentX = Math.max(extentX, ...bounds.map((box) => box.x + box.width + offsetX));
    extentY = Math.max(extentY, ...bounds.map((box) => box.y + box.height + offsetY));
  }
  const width = clamp(Math.ceil(extentX), 100, MAX_DESIGN_CANVAS_SIZE);
  const height = clamp(Math.ceil(extentY), 100, MAX_DESIGN_CANVAS_SIZE);
  if (extentX > MAX_DESIGN_CANVAS_SIZE || extentY > MAX_DESIGN_CANVAS_SIZE)
    report.warn(
      "canvas-extent",
      null,
      "内容超过 20,000 px 画布上限；请拆分页面以避免 HTML 原型裁切。",
    );
  const document = normalizeDesignDocument({
    format: "codeshell.design",
    version: 3,
    name: cleanName(value.name ?? value.document?.name, "Figma Import"),
    canvas: { width, height, background: color(pages[0].backgroundColor, "#f5f5f2") },
    tokens: { colors: [] },
    resources,
    activePageId: convertedPages[0].id,
    pages: convertedPages,
  });
  const warningCount = report.finish();
  return {
    document,
    warnings: report.warnings,
    stats: { pages: pages.length, importedNodes, skippedNodes, warningCount },
    mapping,
    pageMappings,
  };
}

/** Import local images and preserve the complete official source alongside the editable document. */
export async function prepareFigmaImport(input, { sha256Bytes, textMeasurer, browserDocument } = {}) {
  const source = normalizeFigmaSource(input);
  const assets = await prepareFigmaAssets(source, { sha256Bytes });
  const result = importFigmaJson(source, {
    resources: assets.resources,
    imageRefs: assets.byAssetId,
    previews: source.previews,
  });
  const sourceNodes = new Map();
  const collect = (node) => {
    if (typeof node.id === "string") sourceNodes.set(node.id, node);
    for (const child of node.children ?? []) collect(child);
  };
  for (const page of sourcePages(source)) collect(page);
  const textMeasurement = await measureFigmaTextDocument(result.document, {
    sourceNodes,
    sourceIds: new Map(result.mapping.map((entry) => [entry.designId, entry.sourceId])),
    ...(textMeasurer ? { measurer: textMeasurer } : {}),
    ...(browserDocument ? { browserDocument } : {}),
  });
  for (const family of textMeasurement.unavailableFonts) {
    result.warnings.push({ code: "font-fallback", message: `字体 ${family} 不可用，已实测浏览器实际回退字体；安装原字体后请重新导入。` });
    result.stats.warningCount += 1;
  }
  result.document = normalizeDesignState(result.document);
  for (const message of source.warnings ?? [])
    result.warnings.push({ code: "plugin-export-warning", message });
  result.stats.warningCount += source.warnings?.length ?? 0;
  return { ...result, resourcePlans: assets.resourcePlans, source, textMeasurement };
}

/** Create a portable, editable subset consumed by the bundled Figma development plugin. */
export function createFigmaTransfer(input, { resources = new Map() } = {}) {
  const document = Array.isArray(input?.nodes)
    ? normalizeDesignState(input)
    : normalizeDesignDocument(input);
  const report = reporter();
  let exportedNodes = 0,
    skippedNodes = 0;
  const convert = (node) => {
    if (node.type === "instance") {
      skippedNodes += 1;
      report.warn(
        "unsupported-export-node",
        node,
        "组件实例暂未写入新页面传输包；来源绑定的增量导回会保留原始组件关系。",
      );
      return null;
    }
    const { children, ...copy } = node;
    // Transfer only schema-validated design values. No raw Figma/plugin metadata is trusted.
    const sourceMatch = /^figma-(\d+)-(\d+)$/u.exec(node.id);
    if (sourceMatch) copy.sourceId = `${sourceMatch[1]}:${sourceMatch[2]}`;
    if (node.type === "group" || node.type === "component")
      report.warn(
        "container-as-frame",
        node,
        "此容器将在 Figma 中创建为透明编组 Frame 或普通 Frame。 ",
      );
    if (node.layout === "grid")
      report.warn("grid-export", node, "Grid 将使用固定几何，Figma 自动布局关系未导出。");
    if (node.layoutWrap === "wrap-reverse" || node.layoutReverse)
      report.warn("reverse-layout-export", node, "反向布局将使用固定几何保留当前位置。");
    if (node.fontRef)
      report.warn(
        "font-resource-export",
        node,
        "字体文件未包含在传输包；Figma 将尝试已安装字体或回退到 Inter。 ",
      );
    if (node.notes)
      report.warn(
        "notes-plugin-data",
        node,
        "图层备注将保存在 Figma 插件数据中；不会转换为 Figma 云端评论。",
      );
    if (
      node.layoutMarginBefore ||
      (node.layoutAlignSelf && !["auto", "stretch"].includes(node.layoutAlignSelf))
    )
      report.warn("child-layout-export", node, "单项对齐和自动外边距暂使用 Figma 默认布局行为。");
    if (++exportedNodes > MAX_FIGMA_TOTAL_NODES)
      throw new Error("Figma 传输包最多 50,000 个图层；请分页面导出。");
    if (children) copy.children = children.map(convert).filter(Boolean);
    return copy;
  };
  const pages = document.pages.map((page) => ({
    id: page.id,
    name: page.name,
    children: repositoryDesignPage(document, page.id).children.map(convert).filter(Boolean),
  }));
  const warningCount = report.finish();
  const transfer = {
    format: "codeshell.figma.transfer",
    version: 1,
    name: document.name,
    canvas: { ...document.canvas },
    pages,
    assets: createFigmaTransferAssets(document, resources),
    warnings: report.warnings,
    stats: { pages: pages.length, exportedNodes, skippedNodes, warningCount },
  };
  if (new TextEncoder().encode(JSON.stringify(transfer, null, 2)).byteLength > MAX_FIGMA_JSON_BYTES)
    throw new Error("Figma 传输包超过 16 MiB；请分页面导出。");
  return transfer;
}
