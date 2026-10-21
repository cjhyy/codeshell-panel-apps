import { admitNativeTextImport, nativeTextImportIntentSnapshot } from "./native-text-import.mjs";
import { importNativeTextRanges } from "./native-text-ranges-source.mjs";
import { validateTextRanges } from "./text-ranges.mjs";
import { figmaSourceNodes } from "./figma-binding.mjs";
import { normalizeShadowStack, nativeShadowStackEffects } from "./shadow-stack.mjs";
import { validTextLineHeight } from "./text-line-height.mjs";
import { nativeTextRangeCreationPlan } from "./native-text-ranges.mjs";
import { assertNativeImageFill } from "./image-dimensions.mjs";
import { validateLayoutSpacing, validateNativeLayoutSpacing, nativeMainGap, mainAxisGap } from "./layout-spacing.mjs";
import { distributeFillSizes } from "./layout.mjs";
import { normalizeCornerRadii, effectiveCornerRadii } from "./corner-radii.mjs";
import { figmaDesignStroke, nativeDesignStroke, hasDesignStroke, designStrokeSides, clearInvalidStrokeLayoutExclusion, captureNativeStrokeInactive, nativeInactiveStrokePlan } from "./stroke.mjs";
import { normalizeGridTracks, nativeGridPlan, gridFillHugContentHeight, GRID_CHILD_FIELDS, GRID_CONTAINER_FIELDS } from "./grid.mjs";
import {
  figmaFillPaints,
  representativeDesignFill,
  restoreCssLinearSource,
  cssLinearNeedsNativeWarning,
  designPaintsToFigma,
} from "./paint.mjs";
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
  normalizeFigmaAsset,
} from "./figma-assets.mjs";
import { prepareBuiltinDesignFontResources, ensureBuiltinDesignFonts } from "./builtin-fonts.mjs";

export const MAX_FIGMA_JSON_BYTES = 16 * 1024 * 1024;
export const MAX_FIGMA_TOTAL_NODES = 50_000;
const MAX_DEPTH = 32;
const MAX_WARNINGS = 200;
const nativeTextAdmissionContexts = new WeakMap();
function verifyNativeTextAdmissions(document, contexts) {
  if (!contexts?.size) return;
  const nodes = new Map(document.pages.flatMap(page => page.nodes).map(node => [node.id, node]));
  for (const [id, context] of contexts) {
    const node = nodes.get(id);
    try {
      // Re-admission reconstructs ranges; it does not prove the current payload
      // survived a measurer. Compare the exact independently admitted intent
      // first, without invoking nested accessors or toJSON.
      if (!node || nativeTextImportIntentSnapshot(node) !== context.intent) throw Error("Native Text intent changed");
      const admitted = importNativeTextRanges({ rest: context.rest, source: context.source, canonicalNode: node });
      if (!["uniform", "admitted-intent"].includes(admitted.status)) throw Error("Native Text source no longer matches");
      validateTextRanges(node);
    } catch {
      throw Object.assign(Error("原生范围文字在转换或测量后不再匹配完整来源；未扁平化范围样式。"),
        { code: "NATIVE_TEXT_IMPORT_FINAL_DRIFT" });
    }
  }
}
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

const LOSS_WARNINGS = new Set([
  "unsupported-paint",
  "unsupported-node",
  "unsupported-export-node",
  "rich-text",
  "missing-text",
  "text-truncated",
  "font-fallback",
  "font-resource-export",
  "line-height-unit-fixed",
  "missing-geometry",
  "unsupported-mask",
  "visual-fallback",
  "plugin-export-warning",
  "canvas-extent",
  "unsupported-grid",
  "unsupported-native-border",
  "unsupported-stroke-layout",
  "native-stroke-fill-model",
  "css-gradient-native-source",
  "native-negative-gap-effective",
]);
const EFFECT_WARNINGS = new Set(["unsupported-effects", "stroke-alignment", "corner-shape"]);
const ADVISORY_WARNINGS = new Set([
  "vertical-text",
  "grid-layout",
  "invalid-sizing",
  "page-origin-normalized",
  "rotation-inferred",
  "font-weight-rounded",
  "section-as-frame",
  "detached-component",
  "variables-as-literals",
  "prototype-interaction",
  "grid-export",
  "reverse-layout-export",
  "child-layout-export",
  "container-as-frame",
  "notes-plugin-data",
  "css-gradient-native-resize",
]);
function warningPriority({ code, message }) {
  // Missing image resources must remain visible even after hundreds of layout advisories.
  if (code === "unsupported-paint" && /\bIMAGE\b/u.test(message)) return 0;
  if (LOSS_WARNINGS.has(code)) return 1;
  if (EFFECT_WARNINGS.has(code)) return 3;
  if (ADVISORY_WARNINGS.has(code)) return 4;
  return 2;
}

function reporter() {
  const warnings = [],
    sample = [],
    groups = new Map();
  let total = 0;
  return {
    warnings,
    get warningGroups() {
      return [...groups].map(([code, count]) => ({ code, count }));
    },
    warn(code, source, message) {
      total += 1;
      groups.set(code, (groups.get(code) ?? 0) + 1);
      const warning = {
        code,
        ...(source?.id ? { nodeId: String(source.id).slice(0, 160) } : {}),
        message,
      };
      const priority = warningPriority(warning);
      const index = sample.findIndex((entry) => entry.priority > priority);
      if (index !== -1) sample.splice(index, 0, { warning, priority });
      else if (sample.length < MAX_WARNINGS) sample.push({ warning, priority });
      if (sample.length > MAX_WARNINGS) sample.pop();
    },
    finish() {
      warnings.splice(0, warnings.length, ...sample.map((entry) => entry.warning));
      if (total > sample.length)
        warnings.push({
          code: "warnings-truncated",
          message: `另有 ${total - sample.length} 条兼容性提示未展开。`,
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

function layoutSizing(source, node, parent) {
  const inferred = {};
  const primary = { HORIZONTAL: "Horizontal", VERTICAL: "Vertical" }[source.layoutMode];
  if (primary) {
    const counter = primary === "Horizontal" ? "Vertical" : "Horizontal";
    for (const [axis, key] of [
      [primary, "primaryAxisSizingMode"],
      [counter, "counterAxisSizingMode"],
    ])
      if (["FIXED", "AUTO"].includes(source[key]))
        inferred[axis] = source[key] === "AUTO" ? "hug" : "fixed";
  } else if (source.type === "TEXT") {
    const textAutoResize = source.style?.textAutoResize ?? source.textAutoResize;
    if (["NONE", "HEIGHT", "WIDTH_AND_HEIGHT", "TRUNCATE"].includes(textAutoResize)) {
      inferred.Horizontal = textAutoResize === "WIDTH_AND_HEIGHT" ? "hug" : "fixed";
      inferred.Vertical = ["HEIGHT", "WIDTH_AND_HEIGHT"].includes(textAutoResize) ? "hug" : "fixed";
    }
  }
  const parentPrimary = { horizontal: "Horizontal", vertical: "Vertical" }[parent?.layout];
  if (parentPrimary && source.layoutPositioning !== "ABSOLUTE") {
    // Filling the parent takes precedence over an inner frame's intrinsic sizing.
    if (source.layoutGrow === 1) inferred[parentPrimary] = "fill";
    if (source.layoutAlign === "STRETCH")
      inferred[parentPrimary === "Horizontal" ? "Vertical" : "Horizontal"] = "fill";
  }
  for (const axis of ["Horizontal", "Vertical"]) {
    const explicit = source[`layoutSizing${axis}`];
    if (["FIXED", "HUG", "FILL"].includes(explicit))
      node[`layoutSizing${axis}`] = explicit.toLowerCase();
    else if (inferred[axis]) node[`layoutSizing${axis}`] = inferred[axis];
  }
}

function gridChildProperties(source) {
  const properties = {};
  const inactiveAnchors =
    source.visible === false &&
    source.gridRowAnchorIndex === -1 &&
    source.gridColumnAnchorIndex === -1;
  for (const key of [
    "gridColumnSpan",
    "gridRowSpan",
    "gridRowAnchorIndex",
    "gridColumnAnchorIndex",
  ])
    if (source[key] !== undefined && !(inactiveAnchors && key.endsWith("AnchorIndex")))
      properties[key] = source[key];
  for (const axis of ["Horizontal", "Vertical"]) {
    const key = `gridChild${axis}Align`;
    if (source[key] !== undefined)
      properties[key] = { AUTO: "auto", MIN: "start", CENTER: "center", MAX: "end" }[source[key]];
  }
  return properties;
}

function layout(source, node, report) {
  node.layout = { HORIZONTAL: "horizontal", VERTICAL: "vertical" }[source.layoutMode] ?? "none";
  const activeStrokeLayout = ["HORIZONTAL", "VERTICAL", "GRID"].includes(source.layoutMode);
  if (source.strokesIncludedInLayout !== undefined && typeof source.strokesIncludedInLayout !== "boolean") {
    Object.assign(node, { layout: "none", gap: 0, padding: 0, alignItems: "start", justifyContent: "start" });
    report.warn("unsupported-stroke-layout", source, "strokesIncludedInLayout 必须为布尔值；保留测量几何，未猜测原生描边布局。");
    return;
  }
  if (activeStrokeLayout && source.strokesIncludedInLayout === true &&
      (hasDesignStroke(node) ? designStrokeSides(node).some(side=>side.width>0) : node.strokeWidth>0) &&
      (!hasDesignStroke(node) || node.strokeAlign!=="inside")) {
    Object.assign(node,{layout:"none",gap:0,padding:0,alignItems:"start",justifyContent:"start"});
    if(node.type === "frame")node.clipContent=source.clipsContent===true;
    report.warn("unsupported-stroke-layout",source,"参与布局的描边暂只支持完整 INSIDE 侧边；CENTER/OUTSIDE 或不支持的描边保留测量几何，未猜测有效 padding。");
    return;
  }
  if (source.layoutMode === "GRID") {
    try {
      const columns = source.gridColumnCount,
        rows = source.gridRowCount;
      if (
        (source.gridItemsPositioning !== undefined &&
          !["MANUAL", "ROW_AUTO_FLOW"].includes(source.gridItemsPositioning)) ||
        (source.gridAutoTracks !== undefined && !["NONE", "ROWS"].includes(source.gridAutoTracks))
      )
        throw new Error("不支持的 Grid flow/automatic tracks 模式");
      if (
        source.gridItemsPositioning !== "ROW_AUTO_FLOW" &&
        (source.children ?? []).some(
          (child) =>
            child.visible !== false &&
            child.layoutPositioning !== "ABSOLUTE" &&
            (!Number.isInteger(child.gridRowAnchorIndex) ||
              !Number.isInteger(child.gridColumnAnchorIndex)),
        )
      )
        throw new Error("MANUAL Grid 缺少子项锚点");
      const tracks = (value) =>
        normalizeGridTracks(
          value.map((track) => ({
            type: track.type.toLowerCase(),
            ...(track.type === "HUG"
              ? {}
              : { value: track.value ?? (track.type === "FLEX" ? 1 : undefined) }),
          })),
        );
      const grid = {
        ...node,
        layout: "grid",
        gridColumns: columns,
        gridRows: rows,
        gridColumnSizes: tracks(source.gridColumnSizes),
        gridRowSizes: tracks(source.gridRowSizes),
        gridItemsPositioning:
          source.gridItemsPositioning === "ROW_AUTO_FLOW" ? "row-auto-flow" : "manual",
        gridAutoTracks: source.gridAutoTracks === "ROWS" ? "rows" : "none",
        justifyContent: "start",
        alignContent: "start",
      };
      // Child intrinsic eligibility requires their complete converted tree.
      // Validate after recursion below; do not guess it from shallow raw fields.
      Object.assign(node, grid);
    } catch (error) {
      report.warn(
        "unsupported-grid",
        source,
        `原生 Grid 无法表示：${error.message}。请使用插件重新导出完整 track 数据或把网格限制为 1–24 行/列；本次保留固定几何。`,
      );
    }
  }
  node.gap = number(source.itemSpacing, 0, -2000, 2000, source, "itemSpacing", report);
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
  if (activeStrokeLayout && source.strokesIncludedInLayout === true) {
    if (hasDesignStroke(node) && node.strokeAlign === "inside") designStrokeSides(node).forEach((stroke,i)=>{
      const key=`padding${["Top","Right","Bottom","Left"][i]}`;
      node[key]+=stroke.width;
    });
    else if (node.strokeWidth) report.warn("unsupported-stroke-layout",source,"原生描边参与布局但未保留完整侧边，内容缩进可能不同。");
  }
  if (activeStrokeLayout && source.strokesIncludedInLayout !== true && node.strokeAlign === "inside") {
    if (["horizontal", "vertical"].includes(node.layout) && ["frame", "component"].includes(node.type))
      // REST omits its documented false default; fresh SDK Frame activation has
      // a different live default and must be configured explicitly on export.
      node.strokeLayoutExcluded = true;
    else if (node.layout === "grid" && designStrokeSides(node).some(side => side.width > 0))
      report.warn("unsupported-stroke-layout", source, "原生 Grid 排除 inside 描边的 Fill 基准暂未验证；保留当前内容缩进，请核对重排与原生副本。");
  }
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
        -2000,
        2000,
        source,
        "counterAxisSpacing",
        report,
      );
    else
      node.columnGap = number(
        source.counterAxisSpacing,
        0,
        -2000,
        2000,
        source,
        "counterAxisSpacing",
        report,
      );
  }
  if (source.counterAxisAlignContent === "SPACE_BETWEEN") node.alignContent = "space-between";
  if (node.layout === "grid") {
    node.rowGap = number(source.gridRowGap, 0, 0, 2000, source, "gridRowGap", report);
    node.columnGap = number(source.gridColumnGap, 0, 0, 2000, source, "gridColumnGap", report);
    node.alignItems = "start";
    node.justifyContent = "start";
    node.alignContent = "start";
    node.layoutWrap = "none";
  }
  if (node.type === "frame") node.clipContent = source.clipsContent === true;
}

function text(source, node, report, nativeAdmission) {
  node.layoutBaselineSource = "native";
  const style = object(source.style) ? source.style : {};
  if (typeof source.characters !== "string")
    report.warn("missing-text", source, "文字内容缺失，已导入空文本。");
  node.text = typeof source.characters === "string" ? source.characters.slice(0, 4000) : "";
  if (typeof source.characters === "string" && source.characters.length <= 4000)
    node.textSource = source.characters;
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
  const pixelLineHeight = { lineHeight: style.lineHeightPx, lineHeightUnit: "pixels" };
  if (style.lineHeightUnit === "PIXELS" && validTextLineHeight(pixelLineHeight)) {
    node.lineHeight = pixelLineHeight.lineHeight;
    node.lineHeightUnit = "pixels";
  } else {
    node.lineHeight = number(
      finite(style.lineHeightPx)
        ? style.lineHeightPx / node.fontSize
        : finite(style.lineHeightPercentFontSize)
          ? style.lineHeightPercentFontSize / 100
          : undefined,
      1.2, 0.7, 3, source, "lineHeight", report,
    );
    if (style.lineHeightUnit === "PIXELS") report.warn("line-height-unit-fixed", source,
      "像素行高超出受支持范围；已保留受限的测量行高，未标记为可保留的像素单位。 ");
    else if (style.lineHeightUnit !== undefined && !["FONT_SIZE_%", "PERCENT"].includes(style.lineHeightUnit))
      report.warn("line-height-unit-fixed", source,
        "此行高单位尚不能保留为可编辑单位；已使用测量行高。 ");
  }
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
  delete node.cornerRadii;
  if (node.text.trim()) {
    node.textSource = node.text;
    if (style.textAutoResize !== "WIDTH_AND_HEIGHT") node.textFlow = "wrap";
    if ((style.textTruncation ?? source.textTruncation) === "ENDING") {
      if ((style.maxLines ?? source.maxLines) === 1) {
        node.textOverflow = "ellipsis";
        delete node.textFlow;
      } else report.warn(
        "text-truncation", source, "多行或按高度截断尚不能对应单行省略号；已保留完整文字。",
      );
    }
    node.textFlowWidth = node.width;
  }
  if (
    !nativeAdmission?.patch && (source.characterStyleOverrides?.some((value) => value !== 0) ||
    Object.keys(source.styleOverrideTable ?? {}).length)
  )
    report.warn("rich-text", source, "混合文字样式已统一为图层基本样式。");
  if (style.textAlignVertical && style.textAlignVertical !== "TOP")
    report.warn("vertical-text", source, "文字垂直对齐暂按顶部对齐导入。");
}

/** Import a REST GET file response, DOCUMENT/CANVAS, selected node, or JSON_REST_V1 nodes response. */
function diagnoseNativeStrokeFillModels(document, mapping, report, unsupportedBorders) {
  // Preserve measured geometry if an older/native layout disagrees with the
  // verified content allocator; no unavailable layout-version field is inferred.
  const sourceIds = new Map(mapping.map(entry => [entry.designId, entry.sourceId]));
  for (const page of document.pages) {
    const nodeById = new Map(page.nodes.map(node => [node.id, node]));
    const byParent = new Map();
    for (const child of page.nodes) if (child.parentId) {
      if (!byParent.has(child.parentId)) byParent.set(child.parentId, []);
      byParent.get(child.parentId).push(child);
    }
    for (const parent of page.nodes) {
      const children = (byParent.get(parent.id) ?? []).filter(node => node.visible !== false && node.layoutPositioning !== "absolute");
      const horizontal = parent.layout === "horizontal", axis = horizontal ? "horizontal" : "vertical";
      const size = horizontal ? "width" : "height", sizing = horizontal ? "layoutSizingHorizontal" : "layoutSizingVertical";
      const inactiveFrame = node => ["frame", "component"].includes(node.type) && node.layout === "none";
      const physicalStroke = node => hasDesignStroke(node) && node.strokeAlign === "inside"
        ? designStrokeSides(node).filter((_, index) => horizontal ? index % 2 === 1 : index % 2 === 0).reduce((sum, side) => sum + side.width, 0)
        : 0;
      const inactiveFills = children.filter(node => node[sizing] === "fill" && inactiveFrame(node) &&
        (physicalStroke(node) > 0 || unsupportedBorders.has(node.id)));
      if (["horizontal", "vertical"].includes(parent.layout) && inactiveFills.length) {
        // This new native basis is verified for two unrotated leaf Fill items,
        // with positive remaining content and no content min / below-basis cap.
        // Do not extend that evidence to active siblings or native cap rules.
        const fills = children.filter(node => node[sizing] === "fill");
        const padding = (horizontal ? ["Left", "Right"] : ["Top", "Bottom"]).map(side => parent[`padding${side}`] ?? parent.padding ?? 0);
        const available = parent[size] - padding[0] - padding[1] - mainAxisGap(parent) * (children.length - 1);
        const basis = fills.map(physicalStroke);
        const prefix = horizontal ? "Width" : "Height";
        const position = horizontal ? "x" : "y";
        const ancestors = [];
        for (let ancestor = parent; ancestor; ancestor = nodeById.get(ancestor.parentId)) ancestors.push(ancestor);
        let reason = "";
        if (parent.layoutWrap && parent.layoutWrap !== "none" || parent[sizing] === "hug" ||
            parent.justifyContent !== "start" || mainAxisGap(parent) < 0 ||
            ancestors.some(node => node.rotation) || children.some(node => node.rotation))
          reason = "换行、Hug 主轴、非起始对齐、负间距或旋转尚未验证";
        else if (children.length !== 2 || fills.length !== 2 || children.some(node =>
          node.type !== "rectangle" && !inactiveFrame(node) || (byParent.get(node.id) ?? []).length))
          reason = "只验证了两个空的 inactive Frame/矩形 Fill 子项，混合活动容器或更多子项尚未验证";
        else if (children.some(node => unsupportedBorders.has(node.id)))
          reason = "侧边描边无法完整转换";
        else if (available <= basis.reduce((sum, value) => sum + value, 0) || fills.some((node, index) =>
          node[`min${prefix}`] > basis[index] || node[`max${prefix}`] < basis[index]))
          reason = "零/负剩余内容、正内容最小值或小于描边基准的最大值尚未验证";
        else {
          const predicted = distributeFillSizes(fills, axis, available);
          let next = parent[position] + padding[0];
          for (const child of children) {
            if (round(predicted.get(child.id)) !== child[size] || round(next) !== child[position]) {
              reason = "测量尺寸或主轴位置与已验证的分配规则不同";
              break;
            }
            next += child[size] + mainAxisGap(parent);
          }
        }
        if (reason) {
          report.warn("native-stroke-fill-model", { id: sourceIds.get(parent.id), name: parent.name },
            `inactive Frame 描边 Fill：${reason}；保留测量几何，不启用未验证的流式重排。未猜测原生布局版本。`);
          parent.layout = "none";
          parent.padding = 0;
          parent.gap = 0;
          clearInvalidStrokeLayoutExclusion(parent);
          for (const key of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "rowGap", "columnGap"]) delete parent[key];
          for (const child of byParent.get(parent.id) ?? []) {
            if (child.layoutSizingHorizontal === "fill") child.layoutSizingHorizontal = "fixed";
            if (child.layoutSizingVertical === "fill") child.layoutSizingVertical = "fixed";
            delete child.layoutAlignSelf;
          }
          continue;
        }
      }
      if (!["horizontal", "vertical"].includes(parent.layout) ||
          parent.layoutWrap && parent.layoutWrap !== "none") continue;
      if (parent[sizing] === "hug") continue;
      if (!children.some(node => node.strokeLayoutExcluded === true && designStrokeSides(node).some(side => side.width > 0))) continue;
      const fills = children.filter(node => node[sizing] === "fill");
      if (fills.length < 2) continue;
      const padding = (horizontal ? ["Left", "Right"] : ["Top", "Bottom"]).reduce((sum, side) => sum + (parent[`padding${side}`] ?? parent.padding ?? 0), 0);
      const fixed = children.filter(node => node[sizing] !== "fill").reduce((sum, node) => sum + node[size], 0);
      const predicted = distributeFillSizes(fills, axis, parent[size] - padding - fixed - mainAxisGap(parent) * (children.length - 1));
      if (fills.some(node => Math.round(predicted.get(node.id) * 100) / 100 !== node[size])) {
        const sourceId = sourceIds.get(parent.id);
        report.warn("native-stroke-fill-model", { id: sourceId, name: parent.name }, "此来源排除 inside 描边的 Fill 尺寸与已验证的当前内容分配规则不同；已保留测量几何，重排/副本可能改变尺寸。未猜测原生布局版本。");
      }
    }
  }
}

export function importFigmaJson(input, options = {}) {
  return importFigmaJsonWithReport(input, options, reporter());
}

function importFigmaJsonWithReport(
  input,
  { resources = [], imageRefs = new Map(), previews = {} },
  report,
) {
  const rawValue = readJson(input),
    value = Object.hasOwn(rawValue, "nativeTextRanges") ? normalizeFigmaSource(rawValue) : rawValue,
    pages = sourcePages(value);
  const textSupplement = value.nativeTextRanges, nativeAdmissions = new Map();
  if (textSupplement) {
    const owners = figmaSourceNodes(value);
    for (const id of Object.keys(textSupplement.nodes))
      if (owners.get(id)?.type !== "TEXT")
        throw Object.assign(Error("原生范围文字补充记录没有唯一匹配的 TEXT 来源。"), { code: "NATIVE_TEXT_IMPORT_TABLE_OWNER" });
  }
  if (!pages.length || pages.length > MAX_DESIGN_PAGES)
    throw new Error(`Figma 页面数量必须为 1–${MAX_DESIGN_PAGES}。`);
  const ids = new Set(),
    seen = new Set();
  let visited = 0,
    importedNodes = 0,
    skippedNodes = 0;
  // Capture-local proof: raw multi-style/paragraph text must not become an
  // accepted intrinsic leaf merely because conversion flattened its styles.
  const unsupportedGridText = new WeakSet();
  const gridParents = new WeakMap();
  const gridParentOf = (node) => gridParents.get(node);
  const mapping = [],
    pageMappings = [];
  const nonRenderingSourceNodes = new Set();
  const unsupportedBorders = new Set();
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
    const supplemental = source.type === "TEXT" ? textSupplement?.nodes?.[source.id] : undefined;
    const nativeAdmission = supplemental ? admitNativeTextImport({ rest: source, source: supplemental.source,
      ...(Object.hasOwn(supplemental, "hint") ? { hint: supplemental.hint } : {}), pluginId: textSupplement.pluginId }) : null;
    if (nativeAdmission?.status === "unsupported")
      report.warn("native-text-source-unsupported", source, "完整原生范围来源未通过可编辑准入；保留已有预览或来源边界。");
    const preview = previews[source.id];
    // Only the independently proved Text's own mixed-fill cause is bypassed.
    // Ancestor previews return before this descendant is ever converted.
    const previewRef = nativeAdmission?.ownMixedPreview ? null : preview && imageRefs.get(preview.assetId);
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
    let fillPaints =
      !imagePaint && !["group", "image"].includes(type)
        ? figmaFillPaints(source.fills, (message) =>
            report.warn("paint-conversion", source, message),
          )
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
      fill: imagePaint
        ? "transparent"
        : fillPaints
          ? representativeDesignFill(fillPaints)
          : paint(source.fills, source, "填充", report),
      stroke: "transparent",
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
    if (fillPaints && source.codeshellCssLinearSource) {
      fillPaints = restoreCssLinearSource(
        fillPaints,
        source.codeshellCssLinearSource,
        node.width,
        node.height,
        (message) => report.warn("css-gradient-native-source", source, message),
      );
    }
    if (source.rectangleCornerRadii !== undefined && ["frame", "rectangle", "component", "image"].includes(type)) {
      try {
        const radii = normalizeCornerRadii(source.rectangleCornerRadii);
        node.cornerRadius = radii[0];
        if (radii.some((value) => value !== radii[0])) node.cornerRadii = radii;
      } catch (error) {
        report.warn("corner-shape", source, error.message);
      }
    }
    try {
      const border=figmaDesignStroke(source,node);
      if (border) {
        Object.assign(node,border);
        node.stroke=border.strokeSides[0].opacity>0 ? border.strokeSides[0].color : "transparent";
        node.strokeWidth=border.strokeSides[0].opacity>0 ? Math.max(...border.strokeSides.map(s=>s.width)) : 0;
      } else {
        if (["frame", "component", "rectangle"].includes(type) && source.strokeAlign === "INSIDE" &&
            Array.isArray(source.strokes) && source.strokes.some(stroke => stroke.visible !== false) &&
            ["Top", "Right", "Bottom", "Left"].some(side =>
              (source[`stroke${side}Weight`] ?? source.individualStrokeWeights?.[side.toLowerCase()] ?? source.strokeWeight ?? 0) > 0))
          unsupportedBorders.add(node.id);
        node.stroke=paint(source.strokes,source,"描边",report);
      }
    } catch (error) {
      unsupportedBorders.add(node.id);
      report.warn("unsupported-native-border",source,error.message);
      node.stroke=paint(source.strokes,source,"描边",report);
    }
    if (
      fillPaints &&
      (fillPaints.length > 1 ||
        fillPaints.some((paint) => paint.type !== "SOLID" || paint.opacity !== 1))
    )
      node.fillPaints = fillPaints;
    if (node.stroke === "transparent") node.strokeWidth = 0;
    try {
      const inactive = captureNativeStrokeInactive(source, node);
      if (inactive) {
        node.nativeStrokeInactive = inactive;
        if (inactive.sourceOnly || inactive.strokesIncludedInLayout !== undefined && !["HORIZONTAL", "VERTICAL", "GRID"].includes(source.layoutMode))
          report.warn("native-inactive-stroke", source, "空描边样式已保留；部分原生样式或自由布局中的布局选择尚不能安全创建新副本，请保留来源绑定。");
      } else if (Array.isArray(source.strokes) && source.strokes.length && node.stroke === "transparent" && !hasDesignStroke(node))
        report.warn("native-inactive-stroke", source, "不可见或全透明描边仍包含原始绘制项，不等于空描边数组；未猜测其未来激活样式，来源记录保留原值。");
    } catch (error) { report.warn("native-inactive-stroke", source, `空描边样式不能无损表示：${error.message}；来源记录保留原值。`); }
    if (node.strokeWidth && !hasDesignStroke(node) && source.strokeAlign !== "CENTER")
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
    if (source.cornerSmoothing)
      report.warn("corner-shape", source, "圆角平滑暂不能保留；已保留圆形圆角半径。");
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
    if(source.codeshellCssShadowStack)try{
      const stack=normalizeShadowStack(source.codeshellCssShadowStack),candidate={...node,shadowStack:stack};
      const expected=nativeShadowStackEffects(candidate),actual=source.effects??[];
      const comparable=effect=>({type:effect.type,color:Object.fromEntries(["r","g","b","a"].map(key=>[key,Math.fround(effect.color?.[key]??(key==="a"?1:0))])),x:Math.fround(effect.offset?.x??0),y:Math.fround(effect.offset?.y??0),radius:Math.fround(effect.radius??0),spread:effect.spread??0,visible:effect.visible!==false,blendMode:effect.blendMode??"NORMAL"});
      if(JSON.stringify(expected.map(comparable))!==JSON.stringify(actual.map(comparable)))throw Error("原生效果已与 CSS 来源快照不同");
      node.shadowStack=stack;
    }catch(error){report.warn("css-shadow-source-invalid",source,error.message);}
    const shadow = effects.find((effect) => effect.type === "DROP_SHADOW");
    if (shadow && type !== "group" && !node.shadowStack)
      node.shadow = {
        color: color(shadow.color, "#000000"),
        opacity: number(shadow.color?.a, 1, 0, 1, source, "shadow.opacity", report),
        x: number(shadow.offset?.x, 0, -500, 500, source, "shadow.x", report),
        y: number(shadow.offset?.y, 0, -500, 500, source, "shadow.y", report),
        blur: number(shadow.radius, 0, 0, 200, source, "shadow.blur", report),
      };
    if (!node.shadowStack && (effects.length > (node.shadow ? 1 : 0) || shadow?.spread))
      report.warn("unsupported-effects", source, "仅保留一个无扩散外投影；其他效果未导入。");
    const parent = ancestors.at(-1);
    gridParents.set(node, parent ?? null);
    layoutSizing(source, node, parent);
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
    if (parent?.layout === "grid" && node.layoutPositioning !== "absolute")
      Object.assign(node, gridChildProperties(source));
    const parentCrossAxis = { horizontal: "Vertical", vertical: "Horizontal" }[parent?.layout];
    if (
      source.layoutAlign === "STRETCH" &&
      node.layoutPositioning !== "absolute" &&
      parentCrossAxis &&
      node[`layoutSizing${parentCrossAxis}`] === "fill"
    )
      node.layoutAlignSelf = "stretch";
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
      try {
        validateLayoutSpacing(node);
        if (mainAxisGap(node) < 0 && (source.itemReverseZIndex === true || source.itemSpacing < -2000))
          throw new Error("负间距的原生堆叠顺序或尺寸超出可编辑范围");
      } catch (error) {
        report.warn("unsupported-negative-spacing", source, `${error.message}；保留测量几何。`);
        node.layout = "none";
        clearInvalidStrokeLayoutExclusion(node);
        node.gap = 0;
        delete node.rowGap;
        delete node.columnGap;
      }
      node.children = (source.children ?? [])
        .map((child) => convert(child, [...ancestors, node], depth + 1, counter))
        .filter(Boolean);
      if (node.layout === "grid") {
        try {
          const intrinsicCells = node.children.filter((cell) =>
            gridFillHugContentHeight(node, cell, cell.children, parent, gridParentOf) !== null);
          if (intrinsicCells.some((cell) => {
            const pending = [cell];
            // The intrinsic helper has already proved this subtree's bounded
            // shape. Retain raw unsupported-typography checks at every leaf.
            for (let visited = 0; pending.length && visited < 32; visited += 1) {
              const content = pending.pop();
              if (unsupportedGridText.has(content)) return true;
              pending.push(...(content.children ?? []));
            }
            return pending.length > 0;
          }))
            throw new Error("HUG 行内的 FILL 文字单元暂不支持列表、段落间距/缩进、截断、大小写转换或混合/非顶部左对齐样式");
          if (intrinsicCells.length &&
              node.strokeSides?.some((side) => side.width > 0) && source.strokesIncludedInLayout !== true &&
              node.strokeAlign !== "center")
            throw new Error("HUG 行内的 FILL 文字单元仅支持 included 的 inside 或 excluded 的有界 center 底边描边");
          nativeGridPlan(node, parent, gridParentOf);
        } catch (error) {
          report.warn(
            "unsupported-grid",
            source,
            `原生 Grid 无法表示：${error.message}；保留测量几何，请修复轨道/子项的内在尺寸关系后重试。`,
          );
          node.layout = "none";
          for (const key of ["gridColumns", ...GRID_CONTAINER_FIELDS]) delete node[key];
          // These fields describe only this rejected parent relationship. A
          // child's own nested Grid container fields remain intact.
          for (const child of node.children)
            for (const key of [...GRID_CHILD_FIELDS, "gridColumnSpan", "gridRowSpan"]) delete child[key];
        }
      }
      if (["horizontal", "vertical"].includes(node.layout) && mainAxisGap(node) < 0) {
        const rotated = [...ancestors, node, ...node.children.filter((child) => child.visible !== false && child.layoutPositioning !== "absolute")].some((entry) => entry.rotation);
        const axis = node.layout === "vertical" ? "height" : "width";
        const rawFlow = (source.children ?? []).filter((child) => child.visible !== false && child.layoutPositioning !== "ABSOLUTE");
        const rawExtents = rawFlow
          .map((child) => child.size?.[axis === "width" ? "x" : "y"] ?? child.absoluteBoundingBox?.[axis]);
        const unbounded = rawExtents.some((size) => !finite(size) || size < 1 || size > 20000) ||
          rawFlow.length !== node.children.filter((child) => child.visible !== false && child.layoutPositioning !== "absolute").length;
        if (rotated || unbounded) {
          report.warn("unsupported-negative-spacing", source, "旋转、缺失或超出 v3 范围的流项无法可靠求原生有效主轴间距；保留有界测量几何。");
          node.layout = "none";
          clearInvalidStrokeLayoutExclusion(node);
          node.gap = 0;
          delete node.rowGap;
          delete node.columnGap;
        }
        const plan = node.layout === "none" ? null : nativeMainGap(node);
        if (plan && plan.effective - plan.requested > 0.0001) {
          node.gap = plan.effective;
          const key = node.layout === "horizontal" ? "columnGap" : "rowGap";
          if (node[key] !== undefined) node[key] = plan.effective;
          report.warn("native-negative-gap-effective", source,
            `原生请求间距 ${plan.requested}px 实际受最小可见 AUTO 子项限制为 ${plan.effective}px；可编辑布局使用实际间距，原始请求保留在来源绑定快照。`);
        }
      }
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
          ...(node.cornerRadii ? { cornerRadii: [...node.cornerRadii] } : {}),
          visible: true,
          locked: false,
          layoutPositioning: "absolute",
        };
        node.children.unshift(background);
        importedNodes += 1;
      }
    } else if (source.children?.length) throw new Error("基础 Figma 图层不能包含 children。");
    if (type === "text") {
      text(source, node, report, nativeAdmission);
      if (nativeAdmission?.patch) {
        Object.assign(node, nativeAdmission.patch);
        if (nativeAdmission.patch.lineHeightUnit === undefined) delete node.lineHeightUnit;
        if (nativeAdmission.patch.textFlow === undefined) delete node.textFlow;
        nativeAdmissions.set(node.id, { rest: source, source: supplemental.source,
          intent: nativeTextImportIntentSnapshot({ type: "text", ...nativeAdmission.patch }) });
        report.warn("native-text-range-intent", source, "已恢复完整原生颜色和链接范围意图；原始数值保留，跨渲染器像素尚未验证。");
        for (const note of nativeAdmission.diagnostics.filter(note => note.code.includes("HINT")))
          report.warn("native-text-range-hint", source, note.message);
      }
      const style = source.style ?? {};
      if (((source.characterStyleOverrides?.some((value) => value !== 0) ||
          Object.keys(source.styleOverrideTable ?? {}).length) && !nativeAdmission?.paintLinkOnly) ||
          (source.lineTypes !== undefined && (!Array.isArray(source.lineTypes) ||
            source.lineTypes.some(value => value !== "NONE"))) ||
          (source.lineIndentations !== undefined && (!Array.isArray(source.lineIndentations) ||
            source.lineIndentations.some(value => value !== 0))) ||
          (style.listSpacing ?? 0) !== 0 ||
          (style.lineHeightUnit === "PIXELS" && node.lineHeightUnit !== "pixels") ||
          (style.lineHeightUnit !== undefined && !["PIXELS", "FONT_SIZE_%", "PERCENT"].includes(style.lineHeightUnit)) ||
          (style.paragraphSpacing ?? 0) !== 0 || (style.paragraphIndent ?? 0) !== 0 ||
          ![undefined, "LEFT"].includes(style.textAlignHorizontal) ||
          ![undefined, "TOP"].includes(style.textAlignVertical) ||
          ![undefined, "ORIGINAL"].includes(style.textCase) ||
          ![undefined, "DISABLED"].includes(style.textTruncation ?? source.textTruncation) ||
          (style.maxLines ?? source.maxLines) != null)
        unsupportedGridText.add(node);
    }
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
    const suppressedIds = new Set(
      flat
        .filter(
          (node) =>
            nonRenderingSourceNodes.has(node.id) &&
            node.visible !== false &&
            node.parentId &&
            !(node.layoutPositioning !== "absolute" &&
              ["horizontal", "vertical", "grid"].includes(nodeIndex.get(node.parentId)?.layout)) &&
            clipNodeBoundsToClippingAncestors(flat, node, nodeIndex) === null,
        )
        .map((node) => node.id),
    );
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
      .filter(
        (node) => node.type !== "group" && isDesignNodeVisible({ nodes: flat }, node, nodeIndex),
      )
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
  diagnoseNativeStrokeFillModels(document, mapping, report, unsupportedBorders);
  verifyNativeTextAdmissions(document, nativeAdmissions);
  const warningCount = report.finish();
  const result = {
    document,
    warnings: report.warnings,
    warningGroups: report.warningGroups,
    stats: { pages: pages.length, importedNodes, skippedNodes, warningCount },
    mapping,
    pageMappings,
  };
  nativeTextAdmissionContexts.set(result, nativeAdmissions);
  return result;
}

/** Import local images and preserve the complete official source alongside the editable document. */
export async function prepareFigmaImport(
  input,
  { sha256Bytes, textMeasurer, browserDocument, readFontBytes } = {},
) {
  const source = normalizeFigmaSource(input);
  const assets = await prepareFigmaAssets(source, { sha256Bytes });
  const report = reporter();
  const result = importFigmaJsonWithReport(
    source,
    { resources: assets.resources, imageRefs: assets.byAssetId, previews: source.previews },
    report,
  );
  let fonts = { resourcePlans: [], faces: [] };
  if (readFontBytes || (globalThis.document?.fonts && typeof globalThis.FontFace === "function")) {
    fonts = await prepareBuiltinDesignFontResources(result.document, {
      ...(readFontBytes ? { readBytes: readFontBytes } : {}),
      sha256Bytes,
    });
    await ensureBuiltinDesignFonts(result.document, { faces: fonts.faces });
  }
  const sourceNodes = new Map();
  const collect = (node) => {
    if (typeof node.id === "string") sourceNodes.set(node.id, node);
    for (const child of node.children ?? []) collect(child);
  };
  for (const page of sourcePages(source)) collect(page);
  const textMeasurement = await measureFigmaTextDocument(result.document, {
    nativeLineBoxes: true,
    sourceNodes,
    sourceIds: new Map(result.mapping.map((entry) => [entry.designId, entry.sourceId])),
    ...(textMeasurer ? { measurer: textMeasurer } : {}),
    ...(browserDocument ? { browserDocument } : {}),
  });
  // Reject poisoned or changed intent before normalization can read or discard it.
  verifyNativeTextAdmissions(result.document, nativeTextAdmissionContexts.get(result));
  for (const family of textMeasurement.unavailableFonts) {
    report.warn(
      "font-fallback",
      null,
      `字体 ${family} 不可用，已实测浏览器实际回退字体；安装原字体后请重新导入。`,
    );
  }
  for (const issue of textMeasurement.unsupportedBaselines ?? [])
    report.warn("text-baseline-mapping", { id: issue.nodeId }, `${issue.reason}；已保留来源几何，请核对文字位置。`);
  for (const issue of textMeasurement.unsupportedTruncations ?? [])
    report.warn("text-truncation", { id: issue.nodeId }, issue.reason);
  result.document = normalizeDesignState(result.document);
  verifyNativeTextAdmissions(result.document, nativeTextAdmissionContexts.get(result));
  for (const message of source.warnings ?? []) report.warn("plugin-export-warning", null, message);
  result.stats.warningCount = report.finish();
  result.warningGroups = report.warningGroups;
  return {
    ...result,
    resourcePlans: [...assets.resourcePlans, ...fonts.resourcePlans],
    source,
    textMeasurement,
  };
}

/** Create a portable, editable subset consumed by the bundled Figma development plugin. */
export function createFigmaTransfer(input, { resources = new Map() } = {}) {
  const document = Array.isArray(input?.nodes)
    ? normalizeDesignState(input)
    : normalizeDesignDocument(input);
  const report = reporter();
  const assets = createFigmaTransferAssets(document, resources), imageAssets = new Map();
  let exportedNodes = 0,
    skippedNodes = 0;
  const gridParents = new WeakMap();
  const gridParentOf = (node) => gridParents.get(node);
  const convert = (node, parent) => {
    nativeTextRangeCreationPlan(node);
    if (node.type === "image" && node.objectFit === "fill") {
      if (!imageAssets.has(node.imageRef)) imageAssets.set(node.imageRef, normalizeFigmaAsset(assets[node.imageRef]));
      const asset = imageAssets.get(node.imageRef);
      if (["image/svg+xml", "image/webp"].includes(asset.mime)) report.warn("native-image-fill-conversion", node,
        "原生 fill 宽高比需等现有插件界面把 SVG/WebP 转换为 PNG 后校验；未转换的直接原生传输会被拒绝，尚未声明原生像素一致。");
      else assertNativeImageFill(node, asset.bytes);
    }
    gridParents.set(node, parent ?? null);
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
    // Browser baseline provenance drives only local typography refresh. Native
    // creation consumes the physical offset, never an HTML measurement promise.
    if (copy.layoutBaselineSource === "html") delete copy.layoutBaselineSource;
    if(node.shadowStack){nativeShadowStackEffects(node);report.warn("css-shadow-native-raster",node,"保留可编辑 INNER_SHADOW 参数；原生与 CSS 的模糊内核仍有实测像素差异，未声明严格像素一致。");}
    if (node.nativeStrokeInactive) {
      try { nativeInactiveStrokePlan(node); }
      catch (error) { report.warn("native-inactive-stroke-export", node, `${error.message}；传输文件保留样式，插件会阻止创建有损副本。来源绑定中的无关编辑仍可导回。`); }
    }
    if (["horizontal", "vertical"].includes(node.layout)) validateNativeLayoutSpacing(node);
    if (mainAxisGap(node) < 0 && (node.children ?? []).some((child) => child.visible !== false &&
        child.layoutPositioning !== "absolute" && child[node.layout === "vertical" ? "layoutSizingVertical" : "layoutSizingHorizontal"] === "fill" &&
        (child[node.layout === "vertical" ? "minHeight" : "minWidth"] ?? 1) < -mainAxisGap(node)))
      report.warn("native-negative-gap-resize", node, "原生缩小时若最小可见 AUTO 子项小于负间距幅度，Figma 会限制实际间距；当前几何已验证，后续更小尺寸需重新核对。");
    if (hasDesignStroke(node)) {
      try { nativeDesignStroke(node); }
      catch (error) { throw new Error(`${node.name}: ${error.message}`); }
    }
    if (node.fillPaints?.some((paint) => paint.cssLinear && !paint.cssLinear.sourceOnly)) {
      try { designPaintsToFigma(node); }
      catch (error) { throw new Error(`${node.name}: ${error.message}`); }
    }
    if (node.fillPaints?.some(cssLinearNeedsNativeWarning))
      report.warn(
        "css-gradient-native-resize",
        node,
        "CSS 渐变按当前尺寸创建为可编辑原生渐变；非直角角度/像素色标不能保证随原生缩放保持 CSS 行为。原始几何意图随来源保存；请在 Design Studio 中调整尺寸以重新求值。",
      );
    // Transfer only schema-validated design values. No raw Figma/plugin metadata is trusted.
    const sourceMatch = /^figma-(\d+)-(\d+)$/u.exec(node.id);
    if (sourceMatch) copy.sourceId = `${sourceMatch[1]}:${sourceMatch[2]}`;
    if (node.type === "group" || node.type === "component")
      report.warn(
        "container-as-frame",
        node,
        "此容器将在 Figma 中创建为透明编组 Frame 或普通 Frame。 ",
      );
    const resolvedCorners = node.cornerRadii && effectiveCornerRadii(node);
    if (resolvedCorners && node.cornerRadii.some((radius, index) => radius > resolvedCorners[index] + 1e-6))
      report.warn("corner-overlap-export", node, "相邻圆角需要 CSS 共同缩放；Figma 原生的缩放结果可能不同，请核对角部外观。原始半径保持可编辑。");
    if (node.layout === "grid") {
      try {
        nativeGridPlan(node, parent, gridParentOf);
      } catch (error) {
        report.warn(
          "grid-export",
          node,
          `Grid 不能创建为原生布局：${error.message}。请修复后重试；插件会阻止有损导入。`,
        );
      }
    }
    if (node.layoutWrap === "wrap-reverse" || node.layoutReverse)
      report.warn("reverse-layout-export", node, "反向布局将使用固定几何保留当前位置。");
    if (node.type === "text" && node.rotation && node.layoutBaselineOffset)
      report.warn("text-baseline-export", node, "自身旋转文字的 hanging 原点尚不能映射为原生行框；请核对旋转文字位置。");
    if (node.fontRef)
      report.warn(
        "font-resource-export",
        node,
        "字体文件未包含在传输包；Figma 将尝试已安装字体。缺失的图标或私用区字体会阻止导入，普通文字回退会明确报告。 ",
      );
    if (node.notes)
      report.warn(
        "notes-plugin-data",
        node,
        "图层备注将保存在 Figma 插件数据中；不会转换为 Figma 云端评论。",
      );
    if (
      node.layoutMarginBefore ||
      (node.layoutAlignSelf &&
        !["auto", "stretch"].includes(node.layoutAlignSelf) &&
        !GRID_CHILD_FIELDS.some((key) => node[key] !== undefined))
    )
      report.warn("child-layout-export", node, "单项对齐和自动外边距暂使用 Figma 默认布局行为。");
    if (++exportedNodes > MAX_FIGMA_TOTAL_NODES)
      throw new Error("Figma 传输包最多 50,000 个图层；请分页面导出。");
    if (children) copy.children = children.map((child) => convert(child, node)).filter(Boolean);
    return copy;
  };
  const pages = document.pages.map((page) => ({
    id: page.id,
    name: page.name,
    children: repositoryDesignPage(document, page.id).children.map((child) => convert(child)).filter(Boolean),
  }));
  const warningCount = report.finish();
  const transfer = {
    format: "codeshell.figma.transfer",
    version: 1,
    name: document.name,
    canvas: { ...document.canvas },
    pages,
    assets,
    warnings: report.warnings,
    warningGroups: report.warningGroups,
    stats: { pages: pages.length, exportedNodes, skippedNodes, warningCount },
  };
  if (new TextEncoder().encode(JSON.stringify(transfer, null, 2)).byteLength > MAX_FIGMA_JSON_BYTES)
    throw new Error("Figma 传输包超过 16 MiB；请分页面导出。");
  return transfer;
}
