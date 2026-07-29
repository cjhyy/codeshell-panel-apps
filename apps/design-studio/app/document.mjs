/* Repository document codec used by the Design Studio Panel App. */
import {
  clipBoundsToClippingAncestors,
  clipNodeBoundsToClippingAncestors,
  inheritedNodeRotation,
  transformedNodeBoundsInTree,
} from "./geometry.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";
export const MAX_DESIGN_PAGES = 1_000;
export const MAX_DESIGN_NODES_PER_PAGE = 10_000;
export const MAX_SVG_EXPORT_BYTES = 384 * 1024;
export const MAX_COMPONENT_INSTANCE_DEPTH = 16;
export const MAX_RENDERED_NODES_PER_PAGE = 10_000;
const V3_NODE_TYPES = ["frame", "rectangle", "ellipse", "text", "group", "component", "instance"];
const CONTAINER_NODE_TYPES = ["frame", "group", "component"];
const MAX_PAGE_DEPTH = 32;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function validHex(value) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function hasUnsafeControlCharacters(value) {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

function isPortablePathSegment(segment) {
  const windowsBaseName = (segment.split(".", 1)[0] ?? "").trimEnd().toUpperCase();
  return (
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !segment.startsWith(".") &&
    segment.toLowerCase() !== "node_modules" &&
    !/[. ]$/u.test(segment) &&
    !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(windowsBaseName)
  );
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function assertObject(value, label, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  const unknown = Object.keys(value).filter(
    (key) => !allowedKeys.includes(key) && value[key] !== undefined,
  );
  if (unknown.length > 0) throw new Error(`${label} 包含未知字段：${unknown.join(", ")}`);
}

function assertFiniteRange(value, minimum, maximum, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} 必须是 ${minimum} 到 ${maximum} 之间的有限数字`);
  }
}

export function isSafeDesignPath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    !value.startsWith("designs/") ||
    !value.endsWith(".codesign.json") ||
    value.includes(":") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return false;
  }
  return value.split("/").every(isPortablePathSegment);
}

export function workspaceVersionChanged(base, current) {
  const diskFound = current?.found === true;
  if (!diskFound) return base.revision !== null || base.modifiedAt !== null;
  if (base.revision !== null) return base.revision !== current.revision;
  if (base.modifiedAt !== null) {
    return (
      !Number.isFinite(current.modifiedAt) || Math.abs(base.modifiedAt - current.modifiedAt) > 0.001
    );
  }
  return true;
}

function isContainerType(type) {
  return CONTAINER_NODE_TYPES.includes(type);
}

function normalizedNode(candidate, parentId) {
  const node = {
    id: candidate.id,
    type: candidate.type,
    name: candidate.name,
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
    fill: candidate.fill.toLowerCase(),
    stroke: candidate.stroke.toLowerCase(),
    strokeWidth: candidate.strokeWidth,
    opacity: candidate.opacity,
    rotation: candidate.rotation,
    cornerRadius: candidate.cornerRadius,
    visible: candidate.visible,
    locked: candidate.locked,
    ...(parentId ? { parentId } : {}),
    ...(candidate.notes !== undefined ? { notes: candidate.notes } : {}),
    ...(candidate.effectClipping !== undefined ? { effectClipping: candidate.effectClipping } : {}),
    ...(candidate.contentClipping !== undefined
      ? { contentClipping: candidate.contentClipping }
      : {}),
    ...(candidate.shadow !== undefined
      ? {
          shadow: {
            color: candidate.shadow.color.toLowerCase(),
            opacity: candidate.shadow.opacity,
            x: candidate.shadow.x,
            y: candidate.shadow.y,
            blur: candidate.shadow.blur,
          },
        }
      : {}),
  };
  if (candidate.type === "text") {
    node.text = candidate.text;
    node.fontSize = candidate.fontSize;
    node.fontWeight = candidate.fontWeight;
    node.lineHeight = candidate.lineHeight;
    node.textAlign = candidate.textAlign;
    if (candidate.fontFamily !== undefined) node.fontFamily = candidate.fontFamily;
    if (candidate.fontStyle !== undefined) node.fontStyle = candidate.fontStyle;
    if (candidate.letterSpacing !== undefined) node.letterSpacing = candidate.letterSpacing;
    if (candidate.textDecoration !== undefined) node.textDecoration = candidate.textDecoration;
    if (candidate.textMeasurement !== undefined) node.textMeasurement = candidate.textMeasurement;
    if (candidate.textSource !== undefined) node.textSource = candidate.textSource;
    if (candidate.textFlow !== undefined) node.textFlow = candidate.textFlow;
    if (candidate.textOverflow !== undefined) node.textOverflow = candidate.textOverflow;
    if (candidate.textFlowWidth !== undefined) node.textFlowWidth = candidate.textFlowWidth;
    if (candidate.layoutBaselineOffset !== undefined) {
      node.layoutBaselineOffset = candidate.layoutBaselineOffset;
    }
  } else if (
    ["frame", "component"].includes(candidate.type) &&
    candidate.clipContent !== undefined
  ) {
    node.clipContent = candidate.clipContent;
  }
  if (isContainerType(candidate.type)) {
    node.layout = candidate.layout ?? "none";
    if (candidate.layoutWrap !== undefined) node.layoutWrap = candidate.layoutWrap;
    node.gap = candidate.gap ?? 0;
    if (candidate.rowGap !== undefined) node.rowGap = candidate.rowGap;
    if (candidate.columnGap !== undefined) node.columnGap = candidate.columnGap;
    node.padding = candidate.padding ?? 0;
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      const property = `padding${side}`;
      if (candidate[property] !== undefined) node[property] = candidate[property];
    }
    node.alignItems = candidate.alignItems ?? "start";
    node.justifyContent = candidate.justifyContent ?? "start";
    if (candidate.alignContent !== undefined) node.alignContent = candidate.alignContent;
    if (candidate.gridColumns !== undefined) node.gridColumns = candidate.gridColumns;
  }
  for (const property of [
    "layoutSizingHorizontal",
    "layoutSizingVertical",
    "layoutPositioning",
    "layoutAlignSelf",
    "layoutMarginBefore",
    "gridColumnSpan",
    "gridRowSpan",
    "constraintHorizontal",
    "constraintVertical",
    "constraintBaseWidth",
    "constraintBaseHeight",
    "constraintLeft",
    "constraintRight",
    "constraintTop",
    "constraintBottom",
  ]) {
    if (candidate[property] !== undefined) node[property] = candidate[property];
  }
  if (candidate.type === "instance") {
    node.componentId = candidate.componentId;
  }
  return node;
}

function normalizeColors(tokens) {
  assertObject(tokens, "tokens", ["colors"]);
  if (!Array.isArray(tokens.colors)) throw new Error("颜色变量必须是数组");
  if (tokens.colors.length > 32) throw new Error("颜色变量最多 32 个");
  const colorNames = new Set();
  return tokens.colors.map((token, index) => {
    assertObject(token, `颜色变量 ${index + 1}`, ["name", "value"]);
    if (
      typeof token.name !== "string" ||
      token.name.length === 0 ||
      token.name.length > 80 ||
      hasUnsafeControlCharacters(token.name) ||
      !validHex(token.value)
    ) {
      throw new Error(`颜色变量 ${index + 1} 无效`);
    }
    const name = token.name;
    const normalizedName = name.trim().toLowerCase();
    if (!name.trim()) throw new Error(`颜色变量 ${index + 1} 的名称不能为空`);
    if (colorNames.has(normalizedName)) throw new Error(`颜色变量名称重复：${name}`);
    colorNames.add(normalizedName);
    return { name, value: token.value.toLowerCase() };
  });
}

function validateAndFlattenNode(candidate, parentId, depth, state, label) {
  if (depth > MAX_PAGE_DEPTH) {
    throw new Error(`图层嵌套最多 ${MAX_PAGE_DEPTH} 层`);
  }
  const container = isContainerType(candidate?.type);
  const allowedKeys = [
    "id",
    "type",
    "name",
    "notes",
    "effectClipping",
    "contentClipping",
    "shadow",
    "x",
    "y",
    "width",
    "height",
    "fill",
    "stroke",
    "strokeWidth",
    "opacity",
    "rotation",
    "cornerRadius",
    "visible",
    "locked",
    "clipContent",
    "text",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "textAlign",
    "fontFamily",
    "fontStyle",
    "letterSpacing",
    "textDecoration",
    "textMeasurement",
    "textSource",
    "textFlow",
    "textOverflow",
    "textFlowWidth",
    "layoutBaselineOffset",
    "layout",
    "layoutWrap",
    "gap",
    "rowGap",
    "columnGap",
    "padding",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "alignItems",
    "justifyContent",
    "alignContent",
    "gridColumns",
    "layoutSizingHorizontal",
    "layoutSizingVertical",
    "layoutPositioning",
    "layoutAlignSelf",
    "layoutMarginBefore",
    "gridColumnSpan",
    "gridRowSpan",
    "constraintHorizontal",
    "constraintVertical",
    "constraintBaseWidth",
    "constraintBaseHeight",
    "constraintLeft",
    "constraintRight",
    "constraintTop",
    "constraintBottom",
    "componentId",
    ...(container ? ["children"] : []),
  ];
  assertObject(candidate, label, allowedKeys);
  if (
    !V3_NODE_TYPES.includes(candidate.type) ||
    typeof candidate.id !== "string" ||
    candidate.id.length === 0 ||
    candidate.id.length > 160 ||
    hasUnsafeControlCharacters(candidate.id)
  ) {
    throw new Error(`${label} 的类型或 ID 无效`);
  }
  if (state.ids.has(candidate.id)) throw new Error(`图层 ID 重复：${candidate.id}`);
  if (
    typeof candidate.name !== "string" ||
    candidate.name.length > 120 ||
    hasUnsafeControlCharacters(candidate.name)
  ) {
    throw new Error(`图层 ${candidate.id} 的名称无效`);
  }
  for (const [property, minimum, maximum] of [
    ["x", -20000, 20000],
    ["y", -20000, 20000],
    ["width", 1, 20000],
    ["height", 1, 20000],
    ["strokeWidth", 0, 100],
    ["opacity", 0, 1],
    ["rotation", -360, 360],
    ["cornerRadius", 0, 9999],
  ]) {
    assertFiniteRange(candidate[property], minimum, maximum, `图层 ${candidate.id}.${property}`);
  }
  if (
    !(candidate.fill === "transparent" || validHex(candidate.fill)) ||
    !(candidate.stroke === "transparent" || validHex(candidate.stroke))
  ) {
    throw new Error(`图层 ${candidate.id} 的填充或描边色值无效`);
  }
  if (typeof candidate.visible !== "boolean" || typeof candidate.locked !== "boolean") {
    throw new Error(`图层 ${candidate.id} 的 visible 或 locked 无效`);
  }
  if (
    candidate.notes !== undefined &&
    (typeof candidate.notes !== "string" || candidate.notes.length > 2000)
  ) {
    throw new Error(`图层 ${candidate.id} 的 notes 无效`);
  }
  if (candidate.shadow !== undefined) {
    if (candidate.type === "group") {
      throw new Error(`编组 ${candidate.id} 不支持投影；请把投影应用到有可见填充的子图层`);
    }
    assertObject(candidate.shadow, `图层 ${candidate.id}.shadow`, [
      "color",
      "opacity",
      "x",
      "y",
      "blur",
    ]);
    if (!validHex(candidate.shadow.color)) {
      throw new Error(`图层 ${candidate.id}.shadow.color 必须是六位十六进制色值`);
    }
    for (const [property, minimum, maximum] of [
      ["opacity", 0, 1],
      ["x", -500, 500],
      ["y", -500, 500],
      ["blur", 0, 200],
    ]) {
      assertFiniteRange(
        candidate.shadow[property],
        minimum,
        maximum,
        `图层 ${candidate.id}.shadow.${property}`,
      );
    }
  }
  if (
    ["group", "instance"].includes(candidate.type) &&
    (candidate.fill !== "transparent" ||
      candidate.stroke !== "transparent" ||
      candidate.strokeWidth !== 0 ||
      candidate.cornerRadius !== 0)
  ) {
    throw new Error(
      `图层 ${candidate.id} 的类型不绘制自身填充、描边或圆角；请保持透明外观并修改其内容`,
    );
  }
  if (candidate.type === "text" && candidate.cornerRadius !== 0) {
    throw new Error(`文字图层 ${candidate.id} 不支持圆角；请保持 cornerRadius 为 0`);
  }
  if (
    candidate.type !== "text" &&
    [
      "text",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "textAlign",
      "fontFamily",
      "fontStyle",
      "letterSpacing",
      "textDecoration",
      "textMeasurement",
      "textSource",
      "textFlow",
      "textOverflow",
      "textFlowWidth",
      "layoutBaselineOffset",
    ].some((property) => Object.prototype.hasOwnProperty.call(candidate, property))
  ) {
    throw new Error(`非文字图层 ${candidate.id} 包含文字专属字段`);
  }
  if (
    candidate.type === "text" &&
    (typeof candidate.text !== "string" ||
      candidate.text.length > 4000 ||
      typeof candidate.fontSize !== "number" ||
      !Number.isFinite(candidate.fontSize) ||
      candidate.fontSize < 6 ||
      candidate.fontSize > 240 ||
      ![100, 200, 300, 400, 500, 600, 700, 800, 900].includes(candidate.fontWeight) ||
      typeof candidate.lineHeight !== "number" ||
      !Number.isFinite(candidate.lineHeight) ||
      candidate.lineHeight < 0.7 ||
      candidate.lineHeight > 3 ||
      !["left", "center", "right"].includes(candidate.textAlign) ||
      (candidate.fontFamily !== undefined &&
        (typeof candidate.fontFamily !== "string" ||
          !candidate.fontFamily.trim() ||
          candidate.fontFamily.length > 120 ||
          hasUnsafeControlCharacters(candidate.fontFamily))) ||
      (candidate.fontStyle !== undefined && !["normal", "italic"].includes(candidate.fontStyle)) ||
      (candidate.letterSpacing !== undefined &&
        (typeof candidate.letterSpacing !== "number" ||
          !Number.isFinite(candidate.letterSpacing) ||
          candidate.letterSpacing < -20 ||
          candidate.letterSpacing > 100)) ||
      (candidate.textDecoration !== undefined &&
        !["none", "underline", "line-through"].includes(candidate.textDecoration)) ||
      (candidate.textMeasurement !== undefined && candidate.textMeasurement !== "browser") ||
      (candidate.textSource !== undefined &&
        (typeof candidate.textSource !== "string" || candidate.textSource.length > 4000)) ||
      (candidate.textFlow !== undefined && candidate.textFlow !== "wrap") ||
      (candidate.textOverflow !== undefined && candidate.textOverflow !== "ellipsis") ||
      (candidate.textFlow === "wrap" &&
        (typeof candidate.textSource !== "string" || !candidate.textSource.trim())) ||
      (candidate.textOverflow === "ellipsis" &&
        (typeof candidate.textSource !== "string" || !candidate.textSource.trim())) ||
      (candidate.textFlowWidth !== undefined &&
        (typeof candidate.textFlowWidth !== "number" ||
          !Number.isFinite(candidate.textFlowWidth) ||
          candidate.textFlowWidth < 1 ||
          candidate.textFlowWidth > 20000)) ||
      (candidate.layoutBaselineOffset !== undefined &&
        (typeof candidate.layoutBaselineOffset !== "number" ||
          !Number.isFinite(candidate.layoutBaselineOffset) ||
          candidate.layoutBaselineOffset < -100 ||
          candidate.layoutBaselineOffset > 100)))
  ) {
    throw new Error(`文字图层 ${candidate.id} 的文字属性无效`);
  }
  if (candidate.effectClipping !== undefined && candidate.effectClipping !== "intentional") {
    throw new Error(`图层 ${candidate.id} 的 effectClipping 无效`);
  }
  if (
    candidate.contentClipping !== undefined &&
    (candidate.contentClipping !== "intentional" ||
      !["frame", "component"].includes(candidate.type) ||
      candidate.clipContent !== true)
  ) {
    throw new Error(`图层 ${candidate.id} 的 contentClipping 无效`);
  }
  if (
    (!["frame", "component"].includes(candidate.type) && candidate.clipContent !== undefined) ||
    (["frame", "component"].includes(candidate.type) &&
      candidate.clipContent !== undefined &&
      typeof candidate.clipContent !== "boolean")
  ) {
    throw new Error(`图层 ${candidate.id} 的 clipContent 无效`);
  }
  if (container) {
    const missingLayoutField = ["layout", "gap", "padding", "alignItems", "justifyContent"].find(
      (property) => !Object.prototype.hasOwnProperty.call(candidate, property),
    );
    if (missingLayoutField) throw new Error(`容器 ${candidate.id} 缺少 ${missingLayoutField}`);
    if (!["none", "horizontal", "vertical", "grid"].includes(candidate.layout)) {
      throw new Error(`容器 ${candidate.id} 的 layout 无效`);
    }
    if (
      candidate.layoutWrap !== undefined &&
      !["none", "wrap"].includes(candidate.layoutWrap)
    ) {
      throw new Error(`容器 ${candidate.id} 的 layoutWrap 无效`);
    }
    for (const property of [
      "gap",
      "rowGap",
      "columnGap",
      "padding",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
    ]) {
      if (candidate[property] === undefined) continue;
      assertFiniteRange(candidate[property], 0, 2000, `容器 ${candidate.id}.${property}`);
    }
    if (!["start", "center", "end", "stretch"].includes(candidate.alignItems)) {
      throw new Error(`容器 ${candidate.id} 的 alignItems 无效`);
    }
    if (!["start", "center", "end", "space-between"].includes(candidate.justifyContent)) {
      throw new Error(`容器 ${candidate.id} 的 justifyContent 无效`);
    }
    if (
      candidate.alignContent !== undefined &&
      !["start", "center", "end", "space-between", "stretch"].includes(candidate.alignContent)
    ) {
      throw new Error(`容器 ${candidate.id} 的 alignContent 无效`);
    }
    if (
      candidate.gridColumns !== undefined &&
      (!Number.isInteger(candidate.gridColumns) ||
        candidate.gridColumns < 1 ||
        candidate.gridColumns > 24)
    ) {
      throw new Error(`容器 ${candidate.id} 的 gridColumns 无效`);
    }
    if (!Array.isArray(candidate.children)) {
      throw new Error(`容器 ${candidate.id}.children 必须是数组`);
    }
  } else if (
    [
      "layout",
      "layoutWrap",
      "gap",
      "rowGap",
      "columnGap",
      "padding",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "alignItems",
      "justifyContent",
      "alignContent",
      "gridColumns",
    ].some((property) => Object.prototype.hasOwnProperty.call(candidate, property))
  ) {
    throw new Error(`图层 ${candidate.id} 包含容器专属布局字段`);
  }
  if (
    candidate.layoutAlignSelf !== undefined &&
    !["auto", "start", "center", "end", "stretch"].includes(candidate.layoutAlignSelf)
  ) {
    throw new Error(`图层 ${candidate.id} 的 layoutAlignSelf 无效`);
  }
  if (
    candidate.layoutMarginBefore !== undefined &&
    candidate.layoutMarginBefore !== "auto"
  ) {
    throw new Error(`图层 ${candidate.id} 的 layoutMarginBefore 无效`);
  }
  for (const property of ["layoutSizingHorizontal", "layoutSizingVertical"]) {
    if (
      candidate[property] !== undefined &&
      !["fixed", "hug", "fill"].includes(candidate[property])
    ) {
      throw new Error(`图层 ${candidate.id} 的 ${property} 无效`);
    }
  }
  if (
    candidate.layoutPositioning !== undefined &&
    !["auto", "absolute"].includes(candidate.layoutPositioning)
  ) {
    throw new Error(`图层 ${candidate.id} 的 layoutPositioning 无效`);
  }
  for (const property of ["constraintHorizontal", "constraintVertical"]) {
    if (
      candidate[property] !== undefined &&
      !["start", "center", "end", "stretch", "scale"].includes(candidate[property])
    ) {
      throw new Error(`图层 ${candidate.id} 的 ${property} 无效`);
    }
  }
  for (const property of ["constraintBaseWidth", "constraintBaseHeight"]) {
    if (candidate[property] !== undefined) {
      assertFiniteRange(candidate[property], 1, 20000, `图层 ${candidate.id}.${property}`);
    }
  }
  for (const property of [
    "constraintLeft",
    "constraintRight",
    "constraintTop",
    "constraintBottom",
  ]) {
    if (candidate[property] !== undefined) {
      assertFiniteRange(candidate[property], -20000, 20000, `图层 ${candidate.id}.${property}`);
    }
  }
  if (
    candidate.layoutPositioning !== "absolute" &&
    [
      "constraintHorizontal",
      "constraintVertical",
      "constraintBaseWidth",
      "constraintBaseHeight",
      "constraintLeft",
      "constraintRight",
      "constraintTop",
      "constraintBottom",
    ].some((property) => candidate[property] !== undefined)
  ) {
    throw new Error(`非绝对定位图层 ${candidate.id} 包含 Constraints 字段`);
  }
  for (const property of ["gridColumnSpan", "gridRowSpan"]) {
    if (
      candidate[property] !== undefined &&
      (!Number.isInteger(candidate[property]) ||
        candidate[property] < 1 ||
        candidate[property] > 24)
    ) {
      throw new Error(`图层 ${candidate.id} 的 ${property} 无效`);
    }
  }
  if (
    candidate.type === "instance" &&
    (typeof candidate.componentId !== "string" ||
      candidate.componentId.length === 0 ||
      candidate.componentId.length > 160 ||
      hasUnsafeControlCharacters(candidate.componentId))
  ) {
    throw new Error(`实例 ${candidate.id} 的 componentId 无效`);
  }
  if (
    candidate.type !== "instance" &&
    Object.prototype.hasOwnProperty.call(candidate, "componentId")
  ) {
    throw new Error(`非实例图层 ${candidate.id} 包含 componentId`);
  }
  state.ids.add(candidate.id);
  state.nodes.push(normalizedNode(candidate, parentId));
  if (state.nodes.length > MAX_DESIGN_NODES_PER_PAGE) {
    throw new Error(`页面最多包含 ${MAX_DESIGN_NODES_PER_PAGE} 个源图层`);
  }
  for (const [index, child] of (candidate.children ?? []).entries()) {
    validateAndFlattenNode(child, candidate.id, depth + 1, state, `${label}.children[${index}]`);
  }
}

function repositoryDocumentFromState(value) {
  const pages = Array.isArray(value.pages) ? value.pages : [];
  const activePageId = value.activePageId ?? pages[0]?.id ?? "page-1";
  const normalizedPages =
    pages.length > 0
      ? pages.map((page) => ({
          id: page.id,
          name: page.name,
          children: nestFlatNodes(page.id === activePageId ? value.nodes : (page.nodes ?? [])),
        }))
      : [
          {
            id: activePageId,
            name: value.pageName ?? "Page 1",
            children: nestFlatNodes(value.nodes ?? []),
          },
        ];
  return {
    format: value.format,
    version: value.version,
    name: value.name,
    canvas: value.canvas,
    tokens: value.tokens,
    activePageId,
    pages: normalizedPages,
  };
}

function nestFlatNodes(nodes) {
  if (!Array.isArray(nodes)) throw new Error("内部图层必须是数组");
  const byId = new Map();
  for (const node of nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node) || typeof node.id !== "string") {
      throw new Error("内部图层无效");
    }
    if (byId.has(node.id)) throw new Error(`图层 ID 重复：${node.id}`);
    byId.set(node.id, node);
  }
  const childrenByParent = new Map();
  const roots = [];
  for (const node of nodes) {
    if (!node.parentId) {
      roots.push(node);
      continue;
    }
    const parent = byId.get(node.parentId);
    if (!parent || !isContainerType(parent.type)) {
      throw new Error(`图层 ${node.id} 引用了不存在的容器：${node.parentId}`);
    }
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }
  const visiting = new Set();
  const visited = new Set();
  const build = (node, depth) => {
    if (depth > MAX_PAGE_DEPTH) throw new Error(`图层嵌套最多 ${MAX_PAGE_DEPTH} 层`);
    if (visiting.has(node.id)) throw new Error(`图层层级存在循环：${node.id}`);
    visiting.add(node.id);
    const { parentId: _parentId, children: _children, ...copy } = node;
    if (isContainerType(node.type)) {
      copy.children = (childrenByParent.get(node.id) ?? []).map((child) => build(child, depth + 1));
    }
    visiting.delete(node.id);
    visited.add(node.id);
    return copy;
  };
  const output = roots.map((node) => build(node, 0));
  if (visited.size !== nodes.length) {
    const orphan = nodes.find((node) => !visited.has(node.id));
    throw new Error(`图层层级存在循环或孤立节点：${orphan?.id ?? "unknown"}`);
  }
  return output;
}

export function repositoryDesignPage(value, pageId) {
  const page = value.pages?.find((candidate) => candidate.id === pageId);
  if (!page) throw new Error(`页面不存在：${pageId}`);
  return {
    id: page.id,
    name: page.name,
    children: nestFlatNodes(
      page.id === value.activePageId ? (value.nodes ?? []) : (page.nodes ?? []),
    ),
  };
}

export function normalizeDesignDocument(input) {
  assertObject(input, "设计文档", [
    "format",
    "version",
    "name",
    "canvas",
    "tokens",
    "activePageId",
    "pages",
  ]);
  if (
    input.format !== "codeshell.design" ||
    input.version !== 3 ||
    !Array.isArray(input.pages) ||
    input.pages.length === 0 ||
    input.pages.length > MAX_DESIGN_PAGES
  ) {
    throw new Error("不是有效的 CodeShell Design v3 文件");
  }
  if (
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 120 ||
    hasUnsafeControlCharacters(input.name)
  ) {
    throw new Error("设计名称必须是 1–120 个安全字符");
  }
  assertObject(input.canvas, "canvas", ["width", "height", "background"]);
  assertFiniteRange(input.canvas.width, 100, 10000, "canvas.width");
  assertFiniteRange(input.canvas.height, 100, 10000, "canvas.height");
  if (!validHex(input.canvas.background))
    throw new Error("canvas.background 必须是六位十六进制色值");
  const colors = normalizeColors(input.tokens);
  const pageIds = new Set();
  const pageStates = [];
  const allIds = new Set();
  const allNodes = [];
  for (const [pageIndex, page] of input.pages.entries()) {
    assertObject(page, `页面 ${pageIndex + 1}`, ["id", "name", "children"]);
    if (
      typeof page.id !== "string" ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(page.id) ||
      pageIds.has(page.id) ||
      typeof page.name !== "string" ||
      page.name.length === 0 ||
      !page.name.trim() ||
      page.name.length > 120 ||
      hasUnsafeControlCharacters(page.name) ||
      !Array.isArray(page.children)
    ) {
      throw new Error(`页面 ${pageIndex + 1} 无效`);
    }
    pageIds.add(page.id);
    const pageNodes = [];
    const state = { ids: allIds, nodes: pageNodes };
    for (const [nodeIndex, node] of page.children.entries()) {
      validateAndFlattenNode(node, undefined, 0, state, `页面 ${page.id}.children[${nodeIndex}]`);
    }
    allNodes.push(...pageNodes);
    pageStates.push({ id: page.id, name: page.name, nodes: pageNodes });
  }
  if (typeof input.activePageId !== "string" || !pageIds.has(input.activePageId)) {
    throw new Error("activePageId 必须引用一个存在的页面");
  }
  const nodesById = new Map(allNodes.map((node) => [node.id, node]));
  for (const node of allNodes) {
    if (
      node.type === "instance" &&
      nodesById.get(node.componentId)?.type !== "component"
    ) {
      throw new Error(`实例 ${node.id} 引用了不存在的组件：${node.componentId}`);
    }
  }
  const componentIds = new Set(
    allNodes.filter((node) => node.type === "component").map((node) => node.id),
  );
  const componentDependencies = new Map();
  const componentInstances = new Map();
  const componentSourceNodeCounts = new Map();
  for (const componentId of componentIds) {
    const descendants = descendantNodeIds(allNodes, componentId);
    const instances = allNodes.filter(
      (node) => descendants.has(node.id) && node.type === "instance",
    );
    componentDependencies.set(componentId, new Set(instances.map((node) => node.componentId)));
    componentInstances.set(componentId, instances);
    componentSourceNodeCounts.set(componentId, descendants.size + 1);
  }
  const visitingComponents = new Set();
  const visitedComponents = new Set();
  const visitComponent = (componentId) => {
    if (visitingComponents.has(componentId)) {
      throw new Error(`组件引用存在循环：${componentId}`);
    }
    if (visitedComponents.has(componentId)) return;
    visitingComponents.add(componentId);
    for (const dependencyId of componentDependencies.get(componentId) ?? []) {
      visitComponent(dependencyId);
    }
    visitingComponents.delete(componentId);
    visitedComponents.add(componentId);
  };
  for (const componentId of componentIds) visitComponent(componentId);
  const componentDepths = new Map();
  const componentExpandedCosts = new Map();
  const componentRenderMetrics = (componentId) => {
    if (componentDepths.has(componentId)) {
      return {
        depth: componentDepths.get(componentId),
        cost: componentExpandedCosts.get(componentId),
      };
    }
    let depth = 1;
    let cost = componentSourceNodeCounts.get(componentId) ?? 1;
    for (const instance of componentInstances.get(componentId) ?? []) {
      const dependency = componentRenderMetrics(instance.componentId);
      depth = Math.max(depth, dependency.depth + 1);
      cost = Math.min(MAX_RENDERED_NODES_PER_PAGE + 1, cost + dependency.cost);
    }
    componentDepths.set(componentId, depth);
    componentExpandedCosts.set(componentId, cost);
    return { depth, cost };
  };
  for (const componentId of componentIds) {
    const metrics = componentRenderMetrics(componentId);
    if (metrics.depth > MAX_COMPONENT_INSTANCE_DEPTH) {
      throw new Error(
        `组件 ${componentId} 的实例组合深度为 ${metrics.depth}，最多支持 ${MAX_COMPONENT_INSTANCE_DEPTH} 层`,
      );
    }
    if (metrics.cost > MAX_RENDERED_NODES_PER_PAGE) {
      throw new Error(
        `组件 ${componentId} 展开后超过 ${MAX_RENDERED_NODES_PER_PAGE} 个渲染图层；请减少嵌套实例或拆分设计`,
      );
    }
  }
  for (const page of pageStates) {
    let renderedCost = page.nodes.length;
    for (const instance of page.nodes.filter((node) => node.type === "instance")) {
      renderedCost = Math.min(
        MAX_RENDERED_NODES_PER_PAGE + 1,
        renderedCost + (componentExpandedCosts.get(instance.componentId) ?? 0),
      );
    }
    if (renderedCost > MAX_RENDERED_NODES_PER_PAGE) {
      throw new Error(
        `页面 ${page.id} 展开实例后超过 ${MAX_RENDERED_NODES_PER_PAGE} 个渲染图层；请减少实例数量或拆分页`,
      );
    }
  }
  const activePage = pageStates.find((page) => page.id === input.activePageId);
  const normalized = {
    format: "codeshell.design",
    version: 3,
    name: input.name,
    canvas: {
      width: input.canvas.width,
      height: input.canvas.height,
      background: input.canvas.background.toLowerCase(),
    },
    tokens: { colors },
    activePageId: input.activePageId,
    pages: pageStates,
    nodes: activePage.nodes,
  };
  return normalized;
}

export function normalizeDesignState(input) {
  return normalizeDesignDocument(repositoryDocumentFromState(input));
}

function escapeXml(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, "\ufffd")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function effectiveDesignNodeOpacity(document, node, nodeIndex = null) {
  const byId =
    nodeIndex instanceof Map
      ? nodeIndex
      : new Map(document.nodes.map((candidate) => [candidate.id, candidate]));
  const seen = new Set();
  let opacity = node.opacity;
  let parentId = node.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    opacity *= parent.opacity;
    parentId = parent.parentId;
  }
  return clamp(opacity, 0, 1);
}

export function isDesignNodeVisible(document, node, nodeIndex = null) {
  if (!node.visible) return false;
  const byId =
    nodeIndex instanceof Map
      ? nodeIndex
      : new Map(document.nodes.map((candidate) => [candidate.id, candidate]));
  const seen = new Set();
  let parentId = node.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    if (!parent.visible) return false;
    parentId = parent.parentId;
  }
  return effectiveDesignNodeOpacity(document, node, byId) > 0;
}

function svgTransform(document, node) {
  const transforms = [];
  const byId = new Map(document.nodes.map((candidate) => [candidate.id, candidate]));
  const ancestors = [];
  const seen = new Set();
  let parentId = node.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    ancestors.unshift(parent);
    parentId = parent.parentId;
  }
  for (const parent of ancestors) {
    if (!parent.rotation) continue;
    transforms.push(
      `rotate(${parent.rotation} ${round(parent.x + parent.width / 2)} ${round(parent.y + parent.height / 2)})`,
    );
  }
  if (node.rotation) {
    transforms.push(
      `rotate(${node.rotation} ${round(node.x + node.width / 2)} ${round(node.y + node.height / 2)})`,
    );
  }
  return transforms.length > 0 ? ` transform="${transforms.join(" ")}"` : "";
}

function wrapWithAncestorClips(document, node, clipIds, markup) {
  const byId = new Map(document.nodes.map((candidate) => [candidate.id, candidate]));
  const seen = new Set();
  let parentId = node.parentId;
  let wrapped = markup;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    const clipId = clipIds.get(parent.id);
    if (clipId) {
      wrapped = `  <g clip-path="url(#${clipId})">\n${wrapped
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n")}\n  </g>`;
    }
    parentId = parent.parentId;
  }
  return wrapped;
}

function descendantNodeIds(nodes, rootId) {
  const descendants = new Set();
  const queue = [rootId];
  for (let index = 0; index < queue.length; index += 1) {
    const parentId = queue[index];
    for (const node of nodes) {
      if (node.parentId !== parentId || descendants.has(node.id)) continue;
      descendants.add(node.id);
      queue.push(node.id);
    }
  }
  return descendants;
}

function allDocumentNodes(document) {
  const pages = Array.isArray(document?.pages) ? document.pages : [];
  if (pages.length === 0) return document.nodes ?? [];
  return pages.flatMap((page) =>
    page.id === document.activePageId ? (document.nodes ?? []) : (page.nodes ?? []),
  );
}

function detachedComponentRenderDocument(document, componentId) {
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (node.id !== componentId || !node.parentId) return node;
      const { parentId: _parentId, ...detached } = node;
      return detached;
    }),
  };
}

function emptyEffectOutsets() {
  return { left: 0, top: 0, right: 0, bottom: 0 };
}

function renderedSourceNodeEffectBounds(document, nodes, node, instanceStack, availableNodes) {
  const bounds = transformedNodeBoundsInTree(nodes, node);
  if (!bounds) return null;
  const instanceOutsets =
    node.type === "instance"
      ? renderedDesignInstanceEffectOutsets(document, node, instanceStack, availableNodes)
      : emptyEffectOutsets();
  const visibleShadow = node.shadow?.opacity > 0 ? node.shadow : null;
  const strokeOutset =
    !["group", "instance"].includes(node.type) &&
    node.stroke !== "transparent" &&
    node.strokeWidth > 0
      ? node.strokeWidth / 2
      : 0;
  const hasInstanceEffect = Object.values(instanceOutsets).some((value) => value > 0);
  if (!visibleShadow && !hasInstanceEffect && strokeOutset <= 0) {
    return clipNodeBoundsToClippingAncestors(nodes, node);
  }
  const shadowOutset = visibleShadow?.blur * 1.5 || 0;
  const shadowX = visibleShadow?.x || 0;
  const shadowY = visibleShadow?.y || 0;
  const totalRotation = (node.rotation ?? 0) + inheritedNodeRotation(nodes, node);
  const rotatedShadowOffset = totalRotation % 360 === 0 ? 0 : Math.hypot(shadowX, shadowY);
  const rotatedInstanceOutset =
    totalRotation % 360 === 0 ? 0 : Math.max(...Object.values(instanceOutsets));
  const leftOutset = Math.max(
    rotatedInstanceOutset || instanceOutsets.left,
    strokeOutset,
    visibleShadow
      ? strokeOutset + shadowOutset + (rotatedShadowOffset || Math.max(0, -shadowX))
      : 0,
  );
  const topOutset = Math.max(
    rotatedInstanceOutset || instanceOutsets.top,
    strokeOutset,
    visibleShadow
      ? strokeOutset + shadowOutset + (rotatedShadowOffset || Math.max(0, -shadowY))
      : 0,
  );
  const rightOutset = Math.max(
    rotatedInstanceOutset || instanceOutsets.right,
    strokeOutset,
    visibleShadow ? strokeOutset + shadowOutset + (rotatedShadowOffset || Math.max(0, shadowX)) : 0,
  );
  const bottomOutset = Math.max(
    rotatedInstanceOutset || instanceOutsets.bottom,
    strokeOutset,
    visibleShadow ? strokeOutset + shadowOutset + (rotatedShadowOffset || Math.max(0, shadowY)) : 0,
  );
  return clipBoundsToClippingAncestors(nodes, node, {
    x: bounds.x - leftOutset,
    y: bounds.y - topOutset,
    width: bounds.width + leftOutset + rightOutset,
    height: bounds.height + topOutset + bottomOutset,
  });
}

export function renderedDesignInstanceEffectOutsets(
  document,
  instance,
  instanceStack = new Set(),
  availableNodes = allDocumentNodes(document),
) {
  if (instance?.type !== "instance" || instanceStack.has(instance.componentId)) {
    return emptyEffectOutsets();
  }
  const component = availableNodes.find(
    (candidate) => candidate.id === instance.componentId && candidate.type === "component",
  );
  if (!component || component.width <= 0 || component.height <= 0) {
    return emptyEffectOutsets();
  }
  const sourceDocument = detachedComponentRenderDocument(
    { ...document, nodes: availableNodes },
    component.id,
  );
  const sourceIds = descendantNodeIds(sourceDocument.nodes, component.id);
  sourceIds.add(component.id);
  const nextStack = new Set(instanceStack);
  nextStack.add(component.id);
  const sourceBounds = sourceDocument.nodes
    .filter(
      (candidate) =>
        sourceIds.has(candidate.id) &&
        candidate.type !== "group" &&
        isDesignNodeVisible(sourceDocument, candidate),
    )
    .map((candidate) =>
      renderedSourceNodeEffectBounds(
        sourceDocument,
        sourceDocument.nodes,
        candidate,
        nextStack,
        sourceDocument.nodes,
      ),
    )
    .filter(Boolean);
  if (sourceBounds.length === 0) return emptyEffectOutsets();
  const left = Math.min(...sourceBounds.map((bounds) => bounds.x));
  const top = Math.min(...sourceBounds.map((bounds) => bounds.y));
  const right = Math.max(...sourceBounds.map((bounds) => bounds.x + bounds.width));
  const bottom = Math.max(...sourceBounds.map((bounds) => bounds.y + bounds.height));
  const scaleX = Math.abs(instance.width / component.width);
  const scaleY = Math.abs(instance.height / component.height);
  return {
    left: Math.max(0, component.x - left) * scaleX,
    top: Math.max(0, component.y - top) * scaleY,
    right: Math.max(0, right - (component.x + component.width)) * scaleX,
    bottom: Math.max(0, bottom - (component.y + component.height)) * scaleY,
  };
}

export function renderedDesignNodeShadowFilterBounds(
  document,
  node,
  availableNodes = allDocumentNodes(document),
) {
  const shadow = node?.shadow?.opacity > 0 ? node.shadow : null;
  if (!shadow) return null;
  const instanceOutsets =
    node.type === "instance"
      ? renderedDesignInstanceEffectOutsets(document, node, new Set(), availableNodes)
      : emptyEffectOutsets();
  const strokeOutset =
    !["group", "instance"].includes(node.type) &&
    node.stroke !== "transparent" &&
    node.strokeWidth > 0
      ? node.strokeWidth / 2
      : 0;
  const baseLeft = node.x - instanceOutsets.left - strokeOutset;
  const baseTop = node.y - instanceOutsets.top - strokeOutset;
  const baseRight = node.x + node.width + instanceOutsets.right + strokeOutset;
  const baseBottom = node.y + node.height + instanceOutsets.bottom + strokeOutset;
  const blurOutset = shadow.blur * 1.5;
  const left = baseLeft - blurOutset + Math.min(0, shadow.x);
  const top = baseTop - blurOutset + Math.min(0, shadow.y);
  const right = baseRight + blurOutset + Math.max(0, shadow.x);
  const bottom = baseBottom + blurOutset + Math.max(0, shadow.y);
  return {
    x: round(left),
    y: round(top),
    width: round(right - left),
    height: round(bottom - top),
  };
}

export function externalComponentInstancesForPage(document, pageId) {
  const pages = Array.isArray(document?.pages) ? document.pages : [];
  const sourcePage = pages.find((page) => page.id === pageId);
  if (!sourcePage) return [];
  const nodesForPage = (page) =>
    page.id === document.activePageId ? (document.nodes ?? []) : (page.nodes ?? []);
  const componentIds = new Set(
    nodesForPage(sourcePage)
      .filter((node) => node.type === "component")
      .map((node) => node.id),
  );
  if (componentIds.size === 0) return [];
  return pages
    .filter((page) => page.id !== pageId)
    .flatMap((page) =>
      nodesForPage(page)
        .filter((node) => node.type === "instance" && componentIds.has(node.componentId))
        .map((node) => ({ pageId: page.id, nodeId: node.id, componentId: node.componentId })),
    );
}

export function designNodeRemovalIds(document, pageId, rootIds) {
  const roots = new Set(rootIds ?? []);
  if (roots.size === 0) return [];
  const page = document.pages?.find((candidate) => candidate.id === pageId);
  if (!page) return [];
  const pageNodes = page.id === document.activePageId ? (document.nodes ?? []) : (page.nodes ?? []);
  const removedIds = new Set(pageNodes.filter((node) => roots.has(node.id)).map((node) => node.id));
  if (removedIds.size === 0) return [];
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const node of pageNodes) {
      if (!node.parentId || !removedIds.has(node.parentId) || removedIds.has(node.id)) continue;
      removedIds.add(node.id);
      expanded = true;
    }
  }
  const componentIds = new Set(
    pageNodes
      .filter((node) => removedIds.has(node.id) && node.type === "component")
      .map((node) => node.id),
  );
  if (componentIds.size > 0) {
    for (const node of allDocumentNodes(document)) {
      if (node.type === "instance" && componentIds.has(node.componentId)) {
        removedIds.add(node.id);
      }
    }
  }
  return [...removedIds];
}

function exportNodeSvg(
  document,
  node,
  clipIds,
  shadowIds,
  componentClipIds,
  instanceStack = new Set(),
) {
  if (!isDesignNodeVisible(document, node)) return "";
  const shadowId = shadowIds.get(node.id);
  const filter = shadowId ? ` filter="url(#${shadowId})"` : "";
  if (node.type === "instance") {
    const component = document.nodes.find(
      (candidate) => candidate.id === node.componentId && candidate.type === "component",
    );
    if (!component || component.width <= 0 || component.height <= 0) return "";
    if (instanceStack.has(component.id)) return "";
    const nextInstanceStack = new Set(instanceStack);
    nextInstanceStack.add(component.id);
    const sourceDocument = detachedComponentRenderDocument(document, component.id);
    const sourceComponent = sourceDocument.nodes.find((candidate) => candidate.id === component.id);
    const sourceClipIds = componentClipIds.get(component.id) ?? clipIds;
    const componentDescendantIds = descendantNodeIds(sourceDocument.nodes, component.id);
    const sourceNodes = [
      sourceComponent,
      ...sourceDocument.nodes.filter((candidate) => componentDescendantIds.has(candidate.id)),
    ].filter(Boolean);
    const source = sourceNodes
      .map((candidate) =>
        exportNodeSvg(
          sourceDocument,
          candidate,
          sourceClipIds,
          shadowIds,
          componentClipIds,
          nextInstanceStack,
        ),
      )
      .filter(Boolean)
      .join("\n");
    const scaleX = round(node.width / component.width, 6);
    const scaleY = round(node.height / component.height, 6);
    const mapping = `translate(${round(node.x)} ${round(node.y)}) scale(${scaleX} ${scaleY}) translate(${-round(component.x)} ${-round(component.y)})`;
    const transform = svgTransform(document, node);
    const effectiveOpacity = round(effectiveDesignNodeOpacity(document, node), 4);
    const opacity = effectiveOpacity === 1 ? "" : ` opacity="${effectiveOpacity}"`;
    const markup = `  <g data-node-id="${escapeXml(node.id)}" data-component-id="${escapeXml(component.id)}"${opacity}${filter}${transform}>\n    <g transform="${mapping}">\n${source
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n")}\n    </g>\n  </g>`;
    return wrapWithAncestorClips(document, node, clipIds, markup);
  }
  const transform = svgTransform(document, node);
  const effectiveOpacity = round(effectiveDesignNodeOpacity(document, node), 4);
  const opacity = effectiveOpacity === 1 ? "" : ` opacity="${effectiveOpacity}"`;
  const metadata = ` data-node-id="${escapeXml(node.id)}"`;
  const clipped = (markup) => wrapWithAncestorClips(document, node, clipIds, markup);
  if (node.type === "ellipse") {
    return clipped(
      `  <ellipse${metadata} cx="${round(node.x + node.width / 2)}" cy="${round(node.y + node.height / 2)}" rx="${round(node.width / 2)}" ry="${round(node.height / 2)}" fill="${escapeXml(node.fill)}" stroke="${escapeXml(node.stroke)}" stroke-width="${node.strokeWidth}"${opacity}${filter}${transform} />`,
    );
  }
  if (node.type === "text") {
    const textX =
      node.textAlign === "center"
        ? node.x + node.width / 2
        : node.textAlign === "right"
          ? node.x + node.width
          : node.x;
    const anchor =
      node.textAlign === "center" ? "middle" : node.textAlign === "right" ? "end" : "start";
    const fontFamily = escapeXml(node.fontFamily ?? "Inter, ui-sans-serif, system-ui, sans-serif");
    const fontStyle = node.fontStyle ?? "normal";
    const letterSpacing = node.letterSpacing ?? 0;
    const textDecoration = node.textDecoration ?? "none";
    // Separate text elements are more portable than tspans: several native
    // SVG renderers ignore tspan x/y or dy and collapse every line together.
    const lines = String(node.text)
      .split("\n")
      .map(
        (line, index) =>
          `    <text x="${round(textX)}" y="${round(node.y + index * node.fontSize * node.lineHeight)}" fill="${escapeXml(node.fill)}" stroke="${escapeXml(node.stroke)}" stroke-width="${node.strokeWidth}" font-family="${fontFamily}" font-size="${node.fontSize}" font-weight="${node.fontWeight}" font-style="${fontStyle}" letter-spacing="${round(letterSpacing)}" text-decoration="${textDecoration}" text-anchor="${anchor}" dominant-baseline="hanging">${escapeXml(line || " ")}</text>`,
      )
      .join("\n");
    return clipped(`  <g${metadata}${opacity}${filter}${transform}>\n${lines}\n  </g>`);
  }
  if (node.type === "group") return "";
  return clipped(
    `  <rect${metadata} x="${round(node.x)}" y="${round(node.y)}" width="${round(node.width)}" height="${round(node.height)}" rx="${round(Math.min(node.cornerRadius, node.width / 2, node.height / 2))}" fill="${escapeXml(node.fill)}" stroke="${escapeXml(node.stroke)}" stroke-width="${node.strokeWidth}"${opacity}${filter}${transform} />`,
  );
}

export function serializeDesignDocument(value) {
  const repository = Array.isArray(value?.nodes)
    ? repositoryDocumentFromState(value)
    : repositoryDocumentFromState(normalizeDesignDocument(value));
  return `${JSON.stringify(repository, null, 2)}\n`;
}

export function replaceDesignColors(document, replacements) {
  const normalized = new Map();
  for (const [previousValue, nextValue] of replacements ?? []) {
    if (!validHex(previousValue) || !validHex(nextValue)) continue;
    const previous = previousValue.toLowerCase();
    const next = nextValue.toLowerCase();
    if (previous !== next) normalized.set(previous, next);
  }
  if (normalized.size === 0) return 0;
  const replacementFor = (value) =>
    typeof value === "string" ? normalized.get(value.toLowerCase()) : undefined;
  let replacementCount = 0;
  const canvasReplacement = replacementFor(document.canvas?.background);
  if (canvasReplacement) {
    document.canvas.background = canvasReplacement;
    replacementCount += 1;
  }
  for (const node of allDocumentNodes(document)) {
    for (const property of ["fill", "stroke"]) {
      const nextValue = replacementFor(node[property]);
      if (!nextValue) continue;
      node[property] = nextValue;
      replacementCount += 1;
    }
    const shadowReplacement = replacementFor(node.shadow?.color);
    if (shadowReplacement) {
      node.shadow.color = shadowReplacement;
      replacementCount += 1;
    }
  }
  return replacementCount;
}

export function replaceDesignColor(document, previousValue, nextValue) {
  return replaceDesignColors(document, [[previousValue, nextValue]]);
}

export function measureDesignDocumentBytes(value) {
  return new TextEncoder().encode(serializeDesignDocument(value)).length;
}

export function exportDesignSvg(document) {
  const renderNodes = allDocumentNodes(document);
  const renderDocument = { ...document, nodes: renderNodes };
  const activePage = document.pages?.find((page) => page.id === document.activePageId);
  const pageName = activePage?.name ?? document.activePageId ?? "Page 1";
  const clipIds = new Map();
  const clipPaths = [];
  const componentClipIds = new Map();
  const shadowIds = new Map();
  const shadowFilters = [];
  renderNodes.forEach((node, index) => {
    if (["frame", "component"].includes(node.type) && node.clipContent === true) {
      const id = `frame-clip-${index}`;
      clipIds.set(node.id, id);
      const transform = svgTransform(renderDocument, node);
      clipPaths.push(
        `    <clipPath id="${id}" clipPathUnits="userSpaceOnUse"><rect x="${round(node.x)}" y="${round(node.y)}" width="${round(node.width)}" height="${round(node.height)}" rx="${round(Math.min(node.cornerRadius, node.width / 2, node.height / 2))}"${transform} /></clipPath>`,
      );
    }
    if (node.shadow && node.shadow.opacity > 0 && node.type !== "group") {
      const id = `node-shadow-${index}`;
      const bounds = renderedDesignNodeShadowFilterBounds(renderDocument, node, renderNodes);
      shadowIds.set(node.id, id);
      shadowFilters.push(
        `    <filter id="${id}" filterUnits="userSpaceOnUse" x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}"><feDropShadow dx="${round(node.shadow.x)}" dy="${round(node.shadow.y)}" stdDeviation="${round(node.shadow.blur / 2)}" flood-color="${escapeXml(node.shadow.color)}" flood-opacity="${round(node.shadow.opacity, 4)}" /></filter>`,
      );
    }
  });
  const components = renderNodes.filter((node) => node.type === "component");
  components.forEach((component, componentIndex) => {
    const sourceDocument = detachedComponentRenderDocument(renderDocument, component.id);
    const sourceIds = descendantNodeIds(sourceDocument.nodes, component.id);
    sourceIds.add(component.id);
    const sourceClipIds = new Map();
    sourceDocument.nodes.forEach((node, nodeIndex) => {
      if (
        !sourceIds.has(node.id) ||
        !["frame", "component"].includes(node.type) ||
        node.clipContent !== true
      ) {
        return;
      }
      const id = `component-${componentIndex}-clip-${nodeIndex}`;
      sourceClipIds.set(node.id, id);
      const transform = svgTransform(sourceDocument, node);
      clipPaths.push(
        `    <clipPath id="${id}" clipPathUnits="userSpaceOnUse"><rect x="${round(node.x)}" y="${round(node.y)}" width="${round(node.width)}" height="${round(node.height)}" rx="${round(Math.min(node.cornerRadius, node.width / 2, node.height / 2))}"${transform} /></clipPath>`,
      );
    });
    componentClipIds.set(component.id, sourceClipIds);
  });
  const body = document.nodes
    .map((node) => exportNodeSvg(renderDocument, node, clipIds, shadowIds, componentClipIds))
    .filter(Boolean)
    .join("\n");
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="${SVG_NS}" width="${document.canvas.width}" height="${document.canvas.height}" viewBox="0 0 ${document.canvas.width} ${document.canvas.height}" data-page-id="${escapeXml(document.activePageId ?? "page-1")}">`,
    `  <title>${escapeXml(`${document.name} — ${pageName}`)}</title>`,
    ...(clipPaths.length + shadowFilters.length > 0
      ? ["  <defs>", ...clipPaths, ...shadowFilters, "  </defs>"]
      : []),
    `  <rect width="${document.canvas.width}" height="${document.canvas.height}" fill="${escapeXml(document.canvas.background)}" />`,
    body,
    "</svg>",
    "",
  ].join("\n");
  const bytes = new TextEncoder().encode(svg).length;
  if (bytes > MAX_SVG_EXPORT_BYTES) {
    throw new Error(
      `SVG 为 ${(bytes / 1024).toFixed(1)} KiB，超过 ${MAX_SVG_EXPORT_BYTES / 1024} KiB 导出上限；请减少长文本或图层数量`,
    );
  }
  return svg;
}
