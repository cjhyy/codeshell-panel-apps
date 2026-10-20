import {
  GRID_CONTAINER_FIELDS,
  GRID_CHILD_FIELDS,
  gridPlacements,
  effectiveGridRows,
  effectiveGridRowTracks,
} from "./grid.mjs";
/* Stable-id design/implementation comparison for the delivery workflow. */
import { normalizeDesignPaints } from "./paint.mjs";
import { designStrokeSides } from "./stroke.mjs";

function childrenOf(page) {
  return page?.children ?? page?.nodes ?? [];
}

function flatten(nodes, result = new Map()) {
  for (const node of nodes) {
    result.set(node.id, node);
    if (Array.isArray(node.children)) flatten(node.children, result);
  }
  return result;
}

function round(value, precision = 4) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function geometryDelta(expected, actual) {
  const properties = ["x", "y", "width", "height"];
  const values = Object.fromEntries(
    properties.map((property) => [
      property,
      round(Number(actual[property]) - Number(expected[property]), 2),
    ]),
  );
  return {
    ...values,
    maximum: Math.max(...Object.values(values).map(Math.abs)),
  };
}

function paintSignature(paints) {
  return JSON.stringify(
    paints == null
      ? null
      : normalizeDesignPaints(paints).map((paint) => {
          if (!paint.cssLinear || paint.cssLinear.sourceOnly) return paint;
          const { handles, stops, ...intent } = paint;
          return { ...intent, stops: stops.map(({ position, ...color }) => color) };
        }),
  );
}

// Compare effective defaults, rather than whether an optional field or shorthand
// happened to be serialized. Measured geometry alone cannot prove layout survived.
function semanticProperties(node) {
  const properties = {
    layoutSizingHorizontal: node.layoutSizingHorizontal ?? "fixed",
    layoutSizingVertical: node.layoutSizingVertical ?? "fixed",
    layoutPositioning: node.layoutPositioning ?? "auto",
    layoutAlignSelf: node.layoutAlignSelf ?? "auto",
    layoutMarginBefore: node.layoutMarginBefore ?? null,
    minWidth: node.minWidth ?? 1,
    minHeight: node.minHeight ?? 1,
    maxWidth: node.maxWidth ?? null,
    maxHeight: node.maxHeight ?? null,
    gridColumnSpan: node.gridColumnSpan ?? 1,
    gridRowSpan: node.gridRowSpan ?? 1,
    nativeStrokeInactive: node.nativeStrokeInactive ? JSON.stringify([
      node.nativeStrokeInactive.strokeAlign ?? null, node.nativeStrokeInactive.strokeWeight ?? null,
      node.nativeStrokeInactive.individualStrokeWeights ? ["top","right","bottom","left"].map(side=>node.nativeStrokeInactive.individualStrokeWeights[side]) : null,
      node.nativeStrokeInactive.strokesIncludedInLayout ?? null,
      node.nativeStrokeInactive.strokesIncludedInLayoutDefault ?? null,
      node.nativeStrokeInactive.sourceOnly ?? null,
    ]) : null,
  };
  if (["frame", "group", "component"].includes(node.type)) {
    Object.assign(properties, {
      layout: node.layout ?? "none",
      layoutReverse: node.layoutReverse ?? false,
      layoutWrap: node.layoutWrap ?? "none",
      rowGap: node.rowGap ?? node.gap ?? 0,
      columnGap: node.columnGap ?? node.gap ?? 0,
      alignItems: node.alignItems ?? "start",
      justifyContent: node.justifyContent ?? "start",
      alignContent: node.alignContent ?? "start",
      gridColumns: node.gridColumns ?? 1,
    });
    for (const side of ["Top", "Right", "Bottom", "Left"])
      properties[`padding${side}`] = node[`padding${side}`] ?? node.padding ?? 0;
    if (["horizontal", "vertical", "grid"].includes(node.layout))
      properties.layoutChildOrder = JSON.stringify(
        (node.children ?? [])
          .filter((child) => child.layoutPositioning !== "absolute")
          .map((child) => child.id),
      );
  }
  for (const key of [...GRID_CONTAINER_FIELDS, ...GRID_CHILD_FIELDS])
    properties[key] = JSON.stringify(node[key] ?? null);
  if (node.layout === "grid") {
    const rows = effectiveGridRows(
      node,
      gridPlacements(
        (node.children ?? []).filter((child) => child.visible !== false),
        node.gridColumns ?? 1,
        node,
      ).rowCount,
    );
    properties.gridRows = JSON.stringify(rows);
    properties.gridRowSizes = JSON.stringify(effectiveGridRowTracks(node, rows) ?? null);
  }
  if (node.type === "text") {
    Object.assign(properties, {
      text: node.text,
      textSource: node.textSource ?? node.text,
      textFlow: node.textFlow ?? null,
      textOverflow: node.textOverflow ?? null,
      layoutBaselineOffset: node.layoutBaselineOffset ?? 0,
    });
  }
  return properties;
}

function styleDifferences(expected, actual) {
  const properties = [
    "fill",
    "fillPaints",
    "stroke",
    "strokeWidth",
    "strokeAlign",
    "strokeSides",
    "strokeLayoutExcluded",
    "cornerRadius",
    "cornerRadii",
    "opacity",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "lineHeightUnit",
    "letterSpacing",
    "textAlign",
  ];
  const differences = properties
    .filter((property) => property !== "fill" || !expected.fillPaints || !actual.fillPaints)
    .filter((property) => !["stroke","strokeWidth"].includes(property) || !expected.strokeSides || !actual.strokeSides)
    .filter((property) =>
      property === "fillPaints"
        ? paintSignature(expected.fillPaints) !== paintSignature(actual.fillPaints)
        : property === "strokeSides"
          ? JSON.stringify(designStrokeSides(expected)) !== JSON.stringify(designStrokeSides(actual))
          : property === "strokeAlign"
            ? (expected.strokeAlign??"center") !== (actual.strokeAlign??"center")
          : property === "strokeLayoutExcluded"
            ? (expected.strokeLayoutExcluded === true) !== (actual.strokeLayoutExcluded === true)
        : expected[property] !== undefined &&
          actual[property] !== undefined &&
          String(expected[property]) !== String(actual[property]),
    )
    .map((property) => ({
      property,
      expected: expected[property],
      actual: actual[property],
    }));
  if (expected.type !== actual.type) {
    differences.unshift({
      property: "type",
      expected: expected.type,
      actual: actual.type,
    });
  }
  const expectedSemantics = semanticProperties(expected);
  const actualSemantics = semanticProperties(actual);
  for (const property of new Set([
    ...Object.keys(expectedSemantics),
    ...Object.keys(actualSemantics),
  ])) {
    if (expectedSemantics[property] !== actualSemantics[property]) {
      differences.push({
        property,
        expected: expectedSemantics[property],
        actual: actualSemantics[property],
      });
    }
  }
  return differences;
}

export function compareDesignDocuments(
  expectedDesign,
  actualDesign,
  { expectedPageId = expectedDesign?.activePageId, actualPageId = actualDesign?.activePageId } = {},
) {
  const expectedPage = expectedDesign?.pages?.find((page) => page.id === expectedPageId);
  const actualPage = actualDesign?.pages?.find((page) => page.id === actualPageId);
  if (!expectedPage || !actualPage) throw new Error("比较需要两个存在的设计页面");
  const expectedNodes = flatten(childrenOf(expectedPage));
  const actualNodes = flatten(childrenOf(actualPage));
  const matched = [];
  const missing = [];
  for (const [id, expected] of expectedNodes) {
    const actual = actualNodes.get(id);
    if (!actual) {
      missing.push({ id, name: expected.name, type: expected.type });
      continue;
    }
    const geometry = geometryDelta(expected, actual);
    const styles = styleDifferences(expected, actual);
    matched.push({
      id,
      name: expected.name,
      type: expected.type,
      geometry,
      styles,
      close: geometry.maximum <= 2 && styles.length === 0,
    });
  }
  const unexpected = [...actualNodes]
    .filter(([id]) => !expectedNodes.has(id))
    .map(([id, node]) => ({ id, name: node.name, type: node.type }));
  const maximumGeometryDelta = Math.max(0, ...matched.map((entry) => entry.geometry.maximum));
  const meanGeometryDelta =
    matched.length === 0
      ? 0
      : matched.reduce((sum, entry) => sum + entry.geometry.maximum, 0) / matched.length;
  const styleDifferenceCount = matched.reduce((sum, entry) => sum + entry.styles.length, 0);
  const closeNodeCount = matched.filter((entry) => entry.close).length;
  return {
    format: "codeshell.design-comparison",
    version: 1,
    expectedPageId,
    actualPageId,
    expectedNodeCount: expectedNodes.size,
    actualNodeCount: actualNodes.size,
    matchedNodeCount: matched.length,
    closeNodeCount,
    missingNodeCount: missing.length,
    unexpectedNodeCount: unexpected.length,
    styleDifferenceCount,
    maximumGeometryDelta: round(maximumGeometryDelta, 2),
    meanGeometryDelta: round(meanGeometryDelta, 2),
    coverage: round(expectedNodes.size === 0 ? 1 : matched.length / expectedNodes.size),
    closeRate: round(matched.length === 0 ? 0 : closeNodeCount / matched.length),
    passed: missing.length === 0 && maximumGeometryDelta <= 2 && styleDifferenceCount === 0,
    missing,
    unexpected,
    differences: matched
      .filter((entry) => !entry.close)
      .sort(
        (left, right) =>
          right.geometry.maximum - left.geometry.maximum ||
          right.styles.length - left.styles.length ||
          left.id.localeCompare(right.id),
      ),
  };
}

export function comparisonMarkdown(
  comparison,
  { designPath, implementationPath, pixelMetrics } = {},
) {
  const pixelLines = pixelMetrics
    ? [
        `- 像素相似度：${(pixelMetrics.similarity * 100).toFixed(2)}%`,
        `- 明显变化像素（阈值 ${pixelMetrics.threshold}）：${(
          pixelMetrics.changedRatio * 100
        ).toFixed(2)}%`,
      ]
    : ["- 像素指标：未生成"];
  const differences = comparison.differences.slice(0, 100).map((entry) => {
    const geometry = Object.entries(entry.geometry)
      .filter(([property, value]) => property !== "maximum" && value !== 0)
      .map(([property, value]) => `${property} ${value > 0 ? "+" : ""}${value}px`)
      .join("，");
    const styles = entry.styles
      .map((style) => `${style.property}: ${style.expected} → ${style.actual}`)
      .join("，");
    return `- \`${entry.id}\` ${[geometry, styles].filter(Boolean).join("；")}`;
  });
  return `# 设计实现对比

- 设计源：${designPath ?? "当前设计"}
- 前端实现：${implementationPath ?? "未指定"}
- 稳定 ID 覆盖：${(comparison.coverage * 100).toFixed(2)}%
- 2px 内且内容、布局与样式一致：${(comparison.closeRate * 100).toFixed(2)}%
- 最大几何偏差：${comparison.maximumGeometryDelta}px
- 缺少 / 额外节点：${comparison.missingNodeCount} / ${comparison.unexpectedNodeCount}
- 内容、布局与样式差异：${comparison.styleDifferenceCount}
${pixelLines.join("\n")}

## 需要优先修正

${differences.length ? differences.join("\n") : "- 没有稳定 ID 层面的差异。"}
`;
}
