/* Stable-id design/implementation comparison for the delivery workflow. */

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
    properties.map((property) => [property, round(Number(actual[property]) - Number(expected[property]), 2)]),
  );
  return {
    ...values,
    maximum: Math.max(...Object.values(values).map(Math.abs)),
  };
}

function styleDifferences(expected, actual) {
  const properties = [
    "fill",
    "stroke",
    "strokeWidth",
    "cornerRadius",
    "opacity",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
    "textAlign",
  ];
  const differences = properties
    .filter(
      (property) =>
        expected[property] !== undefined &&
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
    passed:
      missing.length === 0 &&
      maximumGeometryDelta <= 2 &&
      styleDifferenceCount === 0,
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

export function comparisonMarkdown(comparison, { designPath, implementationPath, pixelMetrics } = {}) {
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
- 2px 内且样式一致：${(comparison.closeRate * 100).toFixed(2)}%
- 最大几何偏差：${comparison.maximumGeometryDelta}px
- 缺少 / 额外节点：${comparison.missingNodeCount} / ${comparison.unexpectedNodeCount}
- 样式差异：${comparison.styleDifferenceCount}
${pixelLines.join("\n")}

## 需要优先修正

${differences.length ? differences.join("\n") : "- 没有稳定 ID 层面的差异。"}
`;
}
