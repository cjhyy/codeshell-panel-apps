import { GRID_CONTAINER_FIELDS, GRID_CHILD_FIELDS } from "./grid.mjs";
import { nativeTextContent } from "./text-content.mjs";
import { assertNativeTextRangeBoundary } from "./native-text-ranges.mjs";
import { mainAxisGap, nativeMainGap, validateNativeLayoutSpacing } from "./layout-spacing.mjs";
import {
  normalizeDesignDocument,
  normalizeDesignState,
  serializeDesignDocument,
} from "./document.mjs";
import {
  designSidecarPath,
  isMissingDesignSidecar,
  readDesignSidecar,
  writeDesignSidecar,
} from "./design-sidecar.mjs";
import { MAX_FIGMA_SOURCE_BYTES, normalizeFigmaSource } from "./figma-assets.mjs";
import { nativeNotesPatchBaseline } from "./native-notes.mjs";

export const FIGMA_BINDING_FORMAT = "codeshell.figma.binding";
const INDEX_FORMAT = "codeshell.figma.binding-index";
const HASH = /^[0-9a-f]{64}$/u;
const id = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 160 &&
  !/[\u0000-\u001f\u007f]/u.test(value);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const offset = (value) => Number.isFinite(value) && Math.abs(value) <= 50000;
const matrix = (value) =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((row) => Array.isArray(row) && row.length === 3 && row.every(Number.isFinite)) &&
  Number.isFinite(value[0][0] * value[1][1] - value[0][1] * value[1][0]) &&
  Math.abs(value[0][0] * value[1][1] - value[0][1] * value[1][0]) >= 0.000001;
const canonical = (value) =>
  JSON.parse(
    serializeDesignDocument(
      Array.isArray(value?.nodes) ? normalizeDesignState(value) : normalizeDesignDocument(value),
    ),
  );
const flat = (document) =>
  normalizeDesignDocument(canonical(document)).pages.flatMap((page) => {
    const indices = new Map();
    return page.nodes.map((node) => {
      const parent = node.parentId ?? page.id,
        siblingIndex = indices.get(parent) ?? 0;
      indices.set(parent, siblingIndex + 1);
      return { ...node, pageId: page.id, siblingIndex };
    });
  });
const properties = [
  "name",
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "opacity",
  "fill",
  "fillPaints",
  "stroke",
  "strokeWidth",
  "nativeStrokeInactive",
  "strokeAlign",
  "strokeSides",
  "strokeLayoutExcluded",
  "cornerRadius",
  "cornerRadii",
  "visible",
  "locked",
  "notes",
  "shadow",
  "shadowStack",
  "clipContent",
  "text",
  "textSource",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineHeight",
  "lineHeightUnit",
  "letterSpacing",
  "textAlign",
  "textDecoration",
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
  "layoutSizingHorizontal",
  "layoutSizingVertical",
  "layoutPositioning",
  "layoutAlignSelf",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "parentId",
  "pageId",
  "imageRef",
  "objectFit",
];
const comparedProperty = (node, key) => key === "y" && node.type === "text"
  ? node.y - (node.layoutBaselineOffset ?? 0) : node[key];
properties.push(
  "layoutReverse",
  "alignContent",
  "constraintHorizontal",
  "constraintVertical",
  "constraintLeft",
  "constraintRight",
  "constraintTop",
  "constraintBottom",
  "constraintBaseWidth",
  "constraintBaseHeight",
  "textFlow",
  "textOverflow",
  "textFlowWidth",
  "textMeasurement",
  "fontRef",
  "effectClipping",
  "contentClipping",
);
const unsupportedProperties = [
  ...GRID_CONTAINER_FIELDS,
  ...GRID_CHILD_FIELDS,
  "gridColumns",
  "gridColumnSpan",
  "gridRowSpan",
  "layoutMarginBefore",
  "componentId",
];

const translationStableProperties = [
  "nativeStrokeInactive",
  "type",
  "parentId",
  "pageId",
  "siblingIndex",
  "width",
  "height",
  "rotation",
  ...properties.filter((key) =>
    /^(?:layout|strokeLayoutExcluded|constraint|padding|gap|rowGap|columnGap|align|justify|minWidth|minHeight|maxWidth|maxHeight)/u.test(
      key,
    ),
  ),
  ...unsupportedProperties,
];
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const positionEqual = (left, right) => Math.abs(left - right) <= 1e-9;
const untransformed = (value) =>
  value === undefined ||
  (matrix(value) &&
    positionEqual(value[0][0], 1) &&
    positionEqual(value[0][1], 0) &&
    positionEqual(value[1][0], 0) &&
    positionEqual(value[1][1], 1));

export function figmaBindingPath(path) {
  return designSidecarPath(path, ".figma-source.json");
}
export function figmaSourceNodes(source) {
  const result = new Map(), locations = new Map(), fingerprints = new WeakMap(), interned = new Map(), visiting = new Set();
  let total = 0, bytes = 0, steps = 0;
  const invalid = (code = "FIGMA_SOURCE_JSON_INVALID") => {
    const message = code === "FIGMA_SOURCE_BUDGET" ? "Figma 来源 JSON 无效、过深或超过 16 MiB 上限" : "Figma 来源必须是有界无环的纯 JSON 数据";
    throw Object.assign(Error(message), { code });
  };
  const charge = count => { if ((bytes += count) > MAX_FIGMA_SOURCE_BYTES) invalid("FIGMA_SOURCE_BUDGET"); };
  const utf8 = text => {
    let count = 0;
    for (const scalar of text) {
      const point = scalar.codePointAt(0);
      count += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
    }
    return count;
  };
  const intern = key => {
    if (!interned.has(key)) interned.set(key, interned.size);
    return interned.get(key);
  };
  // A collision-free structural interner compares complete raw descendants
  // without serializing every ancestor subtree. Only object key order is ignored.
  const inspect = (value, depth = 0) => {
    if (++steps > 1000000 || depth > 128) invalid("FIGMA_SOURCE_BUDGET");
    if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) {
      const text = String(value); charge(text.length); return intern(`p${text}`);
    }
    if (typeof value === "string") {
      if (value.length > MAX_FIGMA_SOURCE_BYTES) invalid("FIGMA_SOURCE_BUDGET");
      const text = JSON.stringify(value); charge(utf8(text)); return intern(`p${text}`);
    }
    const array = Array.isArray(value);
    if (value === null || typeof value !== "object" || !array && ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || visiting.has(value)) invalid();
    if (array && value.length > 1000000) invalid("FIGMA_SOURCE_BUDGET");
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== "string")) invalid();
    const names = array ? keys.filter(key => key !== "length") : keys;
    if (names.length > 1000000) invalid("FIGMA_SOURCE_BUDGET");
    if (array && (names.length !== value.length || names.some((key, index) => key !== String(index)))) invalid();
    visiting.add(value); charge(2);
    const entries = [];
    for (const [index, key] of names.entries()) {
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, "value") || !descriptor.enumerable) invalid();
      charge((index ? 1 : 0) + (array ? 0 : utf8(JSON.stringify(key)) + 1));
      entries.push([key, inspect(descriptor.value, depth + 1)]);
    }
    visiting.delete(value);
    if (!array) entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    const token = intern(array ? `a${JSON.stringify(entries.map(entry => entry[1]))}` : `o${JSON.stringify(entries)}`);
    fingerprints.set(value, token);
    return token;
  };
  inspect(source);
  function visit(node, depth = 0, parentId = null, siblingIndex = null) {
    if (!node || typeof node !== "object" || !id(node.id) || depth > 40 || ++total > 60000)
      throw Error("Figma 来源节点无效或超出上限");
    // Selection exports can include an ancestor and its child as separate roots.
    // The complete raw representations must agree before either can be indexed.
    const previous = result.get(node.id);
    if (previous && fingerprints.get(previous) !== fingerprints.get(node))
      throw Object.assign(Error(`Figma 来源包含内容不一致的重复图层 ID：${node.id}；请重新导出来源`), { code: "FIGMA_SOURCE_DUPLICATE_ID_CONFLICT" });
    if (!previous) result.set(node.id, node);
    if (parentId !== null) {
      const location = locations.get(node.id);
      if (location && (location.parentId !== parentId || location.siblingIndex !== siblingIndex))
        throw Object.assign(Error(`Figma 来源包含父级或顺序不一致的重复图层 ID：${node.id}；请重新导出来源`), { code: "FIGMA_SOURCE_DUPLICATE_LOCATION_CONFLICT" });
      locations.set(node.id, { parentId, siblingIndex });
    }
    if (node.children !== undefined && !Array.isArray(node.children))
      throw Error("Figma 来源层级无效");
    for (const [index, child] of (node.children ?? []).entries()) visit(child, depth + 1, node.id, index);
  }
  if (
    source?.format !== "codeshell.figma.source" ||
    source.version !== 1 ||
    !source.nodes ||
    typeof source.nodes !== "object" ||
    Array.isArray(source.nodes)
  )
    throw Error("Figma 来源格式无效");
  for (const entry of Object.values(source.nodes)) visit(entry?.document);
  return result;
}

export function createFigmaBinding({ source, document, mapping, pageMappings = [] }) {
  // Validate raw source before structuredClone can invoke a source accessor.
  figmaSourceNodes(source);
  return parseFigmaBinding({
    format: FIGMA_BINDING_FORMAT,
    version: 1,
    source: structuredClone(source),
    baseline: canonical(document),
    mapping: structuredClone(mapping),
    pageMappings: structuredClone(pageMappings),
  });
}
export function parseFigmaBinding(input) {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      throw Error("Figma 来源映射不是有效 JSON");
    }
  }
  if (
    value?.format !== FIGMA_BINDING_FORMAT ||
    value.version !== 1 ||
    !Array.isArray(value.mapping) ||
    value.mapping.length > 50000 ||
    !Array.isArray(value.pageMappings) ||
    value.pageMappings.length > 1000
  )
    throw Error("Figma 来源映射格式无效");
  const baseline = canonical(value.baseline),
    baselineNodes = new Map(flat(baseline).map((node) => [node.id, node]));
  // Validate source bounds and selection context without rewriting any preserved raw fields.
  const sourceNodes = figmaSourceNodes(value.source);
  normalizeFigmaSource(value.source);
  const designIds = new Set(),
    sourceIds = new Set(),
    mappingByDesign = new Map(value.mapping.filter(object).map((entry) => [entry.designId, entry]));
  const pageIds = new Set(),
    mappedSources = new Set(),
    pageMappings = new Map();
  for (const entry of value.pageMappings) {
    if (
      !object(entry) ||
      !id(entry.designId) ||
      !id(entry.sourceId) ||
      !baseline.pages.some((page) => page.id === entry.designId) ||
      pageIds.has(entry.designId) ||
      mappedSources.has(entry.sourceId) ||
      !offset(entry.offsetX) ||
      !offset(entry.offsetY) ||
      (entry.partial !== undefined && typeof entry.partial !== "boolean")
    )
      throw Error("Figma 页面来源映射无效");
    if (
      entry.partial
        ? entry.sourceId !== "selection" && entry.sourceId !== value.source.selection?.pageId
        : sourceNodes.get(entry.sourceId)?.type !== "CANVAS"
    )
      throw Error("Figma 页面来源映射不匹配完整页面或选区上下文");
    pageIds.add(entry.designId);
    mappedSources.add(entry.sourceId);
    pageMappings.set(entry.designId, entry);
  }
  const sourcePage = new Map(),
    sourceParent = new Map();
  const visit = (node, pageId, parentId) => {
    const page = node.type === "CANVAS" ? node.id : pageId;
    if (page) sourcePage.set(node.id, page);
    if (parentId) sourceParent.set(node.id, parentId);
    for (const child of node.children ?? []) visit(child, page, node.id);
  };
  for (const entry of Object.values(value.source.nodes)) visit(entry.document, null, null);
  for (const entry of value.mapping) {
    if (
      !object(entry) ||
      !id(entry.designId) ||
      !id(entry.sourceId) ||
      !baselineNodes.has(entry.designId) ||
      !sourceNodes.has(entry.sourceId) ||
      designIds.has(entry.designId) ||
      sourceIds.has(entry.sourceId)
    )
      throw Error("Figma 图层来源映射无效或重复");
    const node = baselineNodes.get(entry.designId),
      page = pageMappings.get(entry.pageId);
    if (
      !id(entry.pageId) ||
      !id(entry.sourcePageId) ||
      node.pageId !== entry.pageId ||
      !page ||
      entry.sourcePageId !== page.sourceId ||
      !offset(entry.offsetX) ||
      !offset(entry.offsetY) ||
      entry.offsetX !== page.offsetX ||
      entry.offsetY !== page.offsetY ||
      (sourcePage.has(entry.sourceId) && sourcePage.get(entry.sourceId) !== entry.sourcePageId)
    )
      throw Error("Figma 图层页面或原点映射不匹配");
    if (entry.selectionRoot !== undefined && typeof entry.selectionRoot !== "boolean")
      throw Error("Figma 选区图层标记无效");
    if (entry.selectionRoot) {
      const context = value.source.selection?.roots?.[entry.sourceId];
      if (
        !page.partial ||
        node.parentId ||
        !id(entry.sourceParentId) ||
        !matrix(entry.sourceParentTransform) ||
        !context ||
        entry.sourceParentId !== context.parentId ||
        JSON.stringify(entry.sourceParentTransform) !== JSON.stringify(context.parentTransform)
      )
        throw Error("Figma 选区父级变换映射不匹配");
    } else if (entry.sourceParentId !== undefined || entry.sourceParentTransform !== undefined)
      throw Error("非选区图层包含选区父级上下文");
    if (
      node.parentId &&
      mappingByDesign.has(node.parentId) &&
      sourceParent.get(entry.sourceId) !== mappingByDesign.get(node.parentId).sourceId
    )
      throw Error("Figma 图层父级映射不匹配");
    designIds.add(entry.designId);
    sourceIds.add(entry.sourceId);
  }
  return {
    format: FIGMA_BINDING_FORMAT,
    version: 1,
    source: structuredClone(value.source),
    baseline,
    mapping: structuredClone(value.mapping),
    pageMappings: structuredClone(value.pageMappings),
  };
}

export function createFigmaPatch(bindingValue, currentDocument) {
  const binding = parseFigmaBinding(bindingValue),
    current = canonical(currentDocument);
  const beforeNodes = new Map(flat(binding.baseline).map((node) => [node.id, node]));
  const afterNodes = new Map(flat(current).map((node) => [node.id, node]));
  // Until range-aware create/apply/live-source validation is implemented, even
  // a clear/removal must refuse instead of producing an apparently valid no-op.
  for (const node of beforeNodes.values()) assertNativeTextRangeBoundary(node);
  for (const node of afterNodes.values()) assertNativeTextRangeBoundary(node);
  const mapping = new Map(binding.mapping.map((entry) => [entry.designId, entry]));
  const sourceNodes = figmaSourceNodes(binding.source);
  const pages = new Map(binding.pageMappings.map((entry) => [entry.designId, entry]));
  const operations = [],
    diagnostics = [];
  const childOrder = (nodes) => {
    const result = new Map();
    for (const node of nodes.values()) {
      const key = JSON.stringify([node.pageId, node.parentId ?? null]);
      if (!result.has(key)) result.set(key, []);
      result.get(key).push(node.id);
    }
    return result;
  };
  const beforeOrder = childOrder(beforeNodes),
    afterOrder = childOrder(afterNodes);
  for (const parent of afterNodes.values()) {
    if (!["horizontal", "vertical"].includes(parent.layout) || mainAxisGap(parent) >= 0) continue;
    const children = (afterOrder.get(JSON.stringify([parent.pageId, parent.id])) ?? []).map((id) => afterNodes.get(id));
    validateNativeLayoutSpacing(parent, children);
    const requested = sourceNodes.get(mapping.get(parent.id)?.sourceId)?.itemSpacing;
    if (!(requested < 0) || mainAxisGap(beforeNodes.get(parent.id)) !== mainAxisGap(parent)) continue;
    const key = parent.layout === "vertical" ? "rowGap" : "columnGap";
    const plan = nativeMainGap({ ...parent, gap: requested, [key]: requested }, children);
    if (plan.minimum !== null && Math.abs(plan.effective - mainAxisGap(parent)) > 0.0001)
      throw Error("来源请求负间距的有效值会随子项尺寸/可见性变化；请明确调整主轴间距后重试，不能静默覆盖原始请求。");
  }
  const translationChains = new Map();
  function translationChain(designId) {
    if (translationChains.has(designId)) return translationChains.get(designId);
    const before = beforeNodes.get(designId),
      after = afterNodes.get(designId),
      entry = mapping.get(designId);
    const raw = sourceNodes.get(entry?.sourceId),
      box = raw?.absoluteBoundingBox;
    const reliable =
      before &&
      after &&
      entry &&
      pages.has(before.pageId) &&
      !entry.selectionRoot &&
      translationStableProperties.every((key) => same(before[key], after[key])) &&
      before.rotation === 0 &&
      (raw.rotation === undefined || positionEqual(raw.rotation, 0)) &&
      untransformed(raw.relativeTransform) &&
      untransformed(raw.absoluteTransform) &&
      box &&
      [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
      Math.abs(before.x - box.x - entry.offsetX) <= 0.0001 &&
      Math.abs(before.y - (before.type === "text" ? before.layoutBaselineOffset ?? 0 : 0) - box.y - entry.offsetY) <= 0.0001 &&
      Math.abs(before.width - box.width) <= 0.0001 &&
      Math.abs(before.height - box.height) <= 0.0001 &&
      (!before.layout ||
        before.layout === "none" ||
        same(
          beforeOrder.get(JSON.stringify([before.pageId, before.id])),
          afterOrder.get(JSON.stringify([after.pageId, after.id])),
        ));
    const result = !!reliable && (!before.parentId || translationChain(before.parentId));
    translationChains.set(designId, result);
    return result;
  }
  if (JSON.stringify(binding.baseline.canvas) !== JSON.stringify(current.canvas))
    diagnostics.push({
      designId: null,
      message:
        "设计画布的尺寸或背景已改变；Figma 页面背景不在本次增量修改中，新页面副本会使用当前背景。",
    });
  if (JSON.stringify(binding.baseline.tokens) !== JSON.stringify(current.tokens))
    diagnostics.push({
      designId: null,
      message: "设计颜色变量表不直接替换 Figma 变量；已映射图层的实际颜色修改仍会逐项导回。",
    });
  const siblingGroups = new Map();
  const siblingKey = (node) => JSON.stringify([node.pageId, node.parentId ?? null]);
  for (const node of afterNodes.values()) {
    const key = siblingKey(node);
    if (!siblingGroups.has(key)) siblingGroups.set(key, []);
    siblingGroups.get(key).push(node);
  }
  function neighbors(after) {
    const siblings = siblingGroups.get(siblingKey(after));
    const previous = siblings?.[after.siblingIndex - 1];
    const next = siblings?.[after.siblingIndex + 1];
    return {
      previousSiblingDesignId: previous?.id ?? null,
      previousSiblingSourceId: mapping.get(previous?.id)?.sourceId ?? null,
      nextSiblingDesignId: next?.id ?? null,
      nextSiblingSourceId: mapping.get(next?.id)?.sourceId ?? null,
    };
  }
  function sourceSiblingOrder(after) {
    const baseline = beforeNodes.get(after.id);
    const original = baseline ?? after;
    const parentSourceId =
      mapping.get(after.id)?.sourceParentId ??
      mapping.get(original.parentId)?.sourceId ??
      pages.get(original.pageId)?.sourceId;
    const parent = sourceNodes.get(parentSourceId);
    return parent?.children
      ? { beforeSiblingSourceIds: parent.children.map((node) => node.id) }
      : {};
  }
  for (const page of current.pages) {
    const previous = binding.baseline.pages.find((candidate) => candidate.id === page.id);
    const entry = pages.get(page.id);
    if (!previous)
      operations.push({ op: "create-page", designId: page.id, after: { name: page.name } });
    else if (
      previous.name !== page.name &&
      entry &&
      !entry.partial &&
      sourceNodes.get(entry.sourceId)?.type === "CANVAS"
    )
      operations.push({
        op: "rename-page",
        designId: page.id,
        sourceId: entry.sourceId,
        before: { name: previous.name },
        after: { name: page.name },
      });
  }
  // Preorder creates make new parents available before children.
  for (const [designId, after] of afterNodes) {
    const baseline = beforeNodes.get(designId),
      entry = mapping.get(designId);
    if (!baseline) {
      const { pageId, ...node } = after;
      operations.push({
        op: "create",
        designId,
        pageDesignId: pageId,
        parentDesignId: node.parentId ?? null,
        parentSourceId: mapping.get(node.parentId)?.sourceId ?? null,
        pageSourceId: pages.get(pageId)?.sourceId ?? null,
        after: node,
        ...neighbors(after),
        ...sourceSiblingOrder(after),
      });
      continue;
    }
    if (!entry) {
      if (
        [...properties, ...unsupportedProperties].some(
          (key) => JSON.stringify(baseline[key]) !== JSON.stringify(after[key]),
        )
      )
        diagnostics.push({
          designId,
          message:
            "此图层是来源合成的编辑器内容，没有独立 Figma 图层映射；请使用新页面副本核对修改。",
        });
      continue;
    }
    if (baseline.type !== after.type) {
      diagnostics.push({ designId, message: "来源图层类型已改变，请使用新页面导入以核对替换" });
      continue;
    }
    let changed = [...properties, "siblingIndex"].filter(
      (key) => key === "y" && baseline.type === "text" && after.type === "text"
        ? !positionEqual(comparedProperty(baseline, key), comparedProperty(after, key))
        : JSON.stringify(comparedProperty(baseline, key)) !== JSON.stringify(comparedProperty(after, key)),
    );
    if (after.type === "text") {
      changed = changed.filter((key) => key !== "text");
      if (nativeTextContent(baseline) !== nativeTextContent(after, baseline)) changed.push("text");
    }
    // A native parent translation already carries its descendants. Compare local
    // offsets only for a fully mapped, unchanged, untransformed geometry chain.
    // Also retain a counter-move when the child's absolute position stayed fixed.
    if (baseline.parentId && translationChain(designId)) {
      const parentBefore = beforeNodes.get(baseline.parentId),
        parentAfter = afterNodes.get(after.parentId);
      const localChanged = (key) =>
        !positionEqual(comparedProperty(after, key) - comparedProperty(parentAfter, key),
          comparedProperty(baseline, key) - comparedProperty(parentBefore, key));
      changed = [...properties, "siblingIndex"].filter((key) =>
        key === "x" || key === "y" ? localChanged(key) : changed.includes(key),
      );
    }
    const unsupported = unsupportedProperties.filter(
      (key) => JSON.stringify(baseline[key]) !== JSON.stringify(after[key]),
    );
    if (unsupported.length)
      diagnostics.push({
        designId,
        message: `${unsupported.join(", ")} 尚无直接 Figma 修改对应；请使用新页面副本核对。`,
      });
    if (changed.length) {
      // Update preflight compares only the changed REST properties. Descendant
      // snapshots are required for subtree deletes, not for a parent update.
      const before = { ...sourceNodes.get(entry.sourceId) };
      delete before.children;
      operations.push({
        op: "update",
        designId,
        sourceId: entry.sourceId,
        before: structuredClone(before),
        baseline,
        after,
        changed,
        parentSourceId: mapping.get(after.parentId)?.sourceId ?? null,
        parentDesignId: after.parentId ?? null,
        pageSourceId: pages.get(after.pageId)?.sourceId ?? null,
        pageDesignId: after.pageId,
        ...neighbors(after),
        ...sourceSiblingOrder(after),
      });
    }
  }
  const deleted = new Set([...beforeNodes.keys()].filter((key) => !afterNodes.has(key)));
  for (const designId of deleted) {
    const entry = mapping.get(designId),
      baseline = beforeNodes.get(designId);
    if (!entry || (baseline.parentId && deleted.has(baseline.parentId))) continue;
    if (
      !current.pages.some((page) => page.id === baseline.pageId) &&
      pages.has(baseline.pageId) &&
      !pages.get(baseline.pageId).partial &&
      sourceNodes.get(pages.get(baseline.pageId).sourceId)?.type === "CANVAS"
    )
      continue;
    operations.push({
      op: "delete",
      designId,
      sourceId: entry.sourceId,
      before: structuredClone(sourceNodes.get(entry.sourceId)),
    });
  }
  for (const page of binding.baseline.pages) {
    const entry = pages.get(page.id);
    if (!current.pages.some((candidate) => candidate.id === page.id) && entry) {
      const before = sourceNodes.get(entry.sourceId);
      if (!before || before.type !== "CANVAS" || entry.partial)
        diagnostics.push({ designId: page.id, message: "来源页面未完整导出，无法安全删除原页面" });
      else
        operations.push({
          op: "delete-page",
          designId: page.id,
          sourceId: entry.sourceId,
          before: structuredClone(before),
        });
    }
  }
  if (operations.length > 50000) throw Error("Figma 修改数量超过上限，请分批处理");
  const nativeNotesBefore = nativeNotesPatchBaseline(binding.source, operations, sourceNodes);
  return {
    format: "codeshell.figma.patch",
    version: 1,
    mapping: binding.mapping,
    pageMappings: binding.pageMappings,
    baseline: binding.baseline,
    ...(typeof binding.source.fileKey === "string" ? { fileKey: binding.source.fileKey } : {}),
    ...(typeof binding.source.documentId === "string"
      ? { documentId: binding.source.documentId }
      : {}),
    operations,
    ...(nativeNotesBefore ? { nativeNotesBefore } : {}),
    diagnostics,
    summary: {
      updates: operations.filter((op) => op.op === "update" || op.op === "rename-page").length,
      creates: operations.filter((op) => op.op === "create" || op.op === "create-page").length,
      deletes: operations.filter((op) => op.op === "delete" || op.op === "delete-page").length,
    },
  };
}

function parseIndex(content) {
  let index;
  try {
    index = JSON.parse(content);
  } catch {
    throw Error("Figma 来源索引无法读取");
  }
  if (
    index?.format !== INDEX_FORMAT ||
    index.version !== 1 ||
    !Array.isArray(index.entries) ||
    index.entries.length > 32
  )
    throw Error("Figma 来源索引无效");
  for (const entry of index.entries)
    if (
      !HASH.test(entry.sourceSha256) ||
      (entry.bindingSha256 === null
        ? entry.path !== null
        : !HASH.test(entry.bindingSha256) ||
          entry.path !== `designs/codesign-data/figma/${entry.bindingSha256}.json`)
    )
      throw Error("Figma 来源索引路径或摘要无效");
  return index;
}

// Immutable references also keep unsaved recovery journals small and verifiable.
export async function persistFigmaBinding({ binding, call, check, sha256 }) {
  const value = parseFigmaBinding(binding),
    content = JSON.stringify(value),
    digest = await sha256(content);
  check();
  const path = `designs/codesign-data/figma/${digest}.json`;
  try {
    await writeDesignSidecar({ path, content, expectedModifiedAt: null, call, check, sha256 });
  } catch (error) {
    check();
    const existing = await readDesignSidecar({ path, call, check, sha256 });
    if (existing.content !== content) throw error;
  }
  return { sha256: digest, path };
}
export async function resolveFigmaBindingRef({ ref, call, check, sha256 }) {
  if (
    !ref ||
    !HASH.test(ref.sha256) ||
    ref.path !== `designs/codesign-data/figma/${ref.sha256}.json`
  )
    throw Error("Figma 来源引用无效");
  const saved = await readDesignSidecar({ path: ref.path, call, check, sha256 });
  if ((await sha256(saved.content)) !== ref.sha256) throw Error("Figma 来源内容摘要不匹配");
  check();
  return parseFigmaBinding(saved.content);
}

// Register before the principal design commit. Explicit null entries preserve
// Undo back to a non-Figma document without misidentifying a failed save.
export async function registerFigmaBinding({ path, sourceContent, binding, call, check, sha256 }) {
  const sourceSha256 = await sha256(sourceContent),
    indexPath = figmaBindingPath(path);
  check();
  let existing = null,
    index = { format: INDEX_FORMAT, version: 1, entries: [] };
  try {
    existing = await readDesignSidecar({ path: indexPath, call, check, sha256 });
    const parsed = JSON.parse(existing.content);
    if (parsed.format === FIGMA_BINDING_FORMAT) {
      const prior = await persistFigmaBinding({ binding: parsed, call, check, sha256 });
      const original = await call("workspace.readText", { path });
      check();
      index.entries.push({
        sourceSha256: await sha256(original.content),
        bindingSha256: prior.sha256,
        path: prior.path,
      });
      check();
    } else index = parseIndex(existing.content);
  } catch (error) {
    check();
    if (!isMissingDesignSidecar(error)) throw error;
  }
  if (binding === null && !existing) return;
  const ref = binding === null ? null : await persistFigmaBinding({ binding, call, check, sha256 });
  check();
  const entries = index.entries.filter((entry) => entry.sourceSha256 !== sourceSha256);
  entries.push({ sourceSha256, bindingSha256: ref?.sha256 ?? null, path: ref?.path ?? null });
  await writeDesignSidecar({
    path: indexPath,
    content: JSON.stringify({ ...index, entries: entries.slice(-32) }),
    call,
    check,
    sha256,
    ...(existing?.revision
      ? { expectedRevision: existing.revision }
      : { expectedModifiedAt: existing?.modifiedAt ?? null }),
  });
}

export async function readFigmaBinding({ path, sourceContent, call, check, sha256 }) {
  let result;
  try {
    result = await readDesignSidecar({ path: figmaBindingPath(path), call, check, sha256 });
  } catch (error) {
    check();
    if (isMissingDesignSidecar(error)) return null;
    throw error;
  }
  const parsed = JSON.parse(result.content);
  if (parsed.format === FIGMA_BINDING_FORMAT) return parseFigmaBinding(parsed);
  const index = parseIndex(result.content),
    hash = await sha256(sourceContent);
  check();
  const entry = index.entries.find((candidate) => candidate.sourceSha256 === hash);
  if (!entry) throw Error("设计版本没有对应的 Figma 来源记录，请重新导入或恢复完整备份");
  if (entry.bindingSha256 === null) return null;
  return resolveFigmaBindingRef({
    ref: { sha256: entry.bindingSha256, path: entry.path },
    call,
    check,
    sha256,
  });
}
