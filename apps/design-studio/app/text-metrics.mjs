/* Browser measurements are receipts for specific text and typography, not audit exemptions. */
import { designFontFamilyCss } from "./font-css.mjs";
export function textMetricsSignature(node) {
  return JSON.stringify([
    node.text,
    node.fontFamily ?? "",
    node.fontRef ?? "",
    node.fontSize,
    node.fontWeight,
    node.fontStyle ?? "normal",
    node.letterSpacing ?? 0,
    node.lineHeight,
  ]);
}

export function textSourceMetricsSignature(node) {
  return textMetricsSignature({ ...node, text: node.textSource ?? node.text });
}

export function validTextMetrics(metrics) {
  return Boolean(
    metrics &&
    typeof metrics === "object" &&
    !Array.isArray(metrics) &&
    Object.keys(metrics).every((key) =>
      [
        "version",
        "signature",
        "sourceSignature",
        "lineWidths",
        "lineInkBounds",
        "height",
        "fontAvailable",
      ].includes(key),
    ) &&
    metrics.version === 1 &&
    typeof metrics.signature === "string" &&
    metrics.signature.length <= 8500 &&
    (metrics.sourceSignature === undefined ||
      (typeof metrics.sourceSignature === "string" && metrics.sourceSignature.length <= 8500)) &&
    Array.isArray(metrics.lineWidths) &&
    metrics.lineWidths.length >= 1 &&
    metrics.lineWidths.length <= 4001 &&
    metrics.lineWidths.every(
      (width) => Number.isFinite(width) && width >= 0 && width <= 1_000_000,
    ) &&
    Array.isArray(metrics.lineInkBounds) &&
    metrics.lineInkBounds.length === metrics.lineWidths.length &&
    metrics.lineInkBounds.every(
      (bounds) =>
        bounds &&
        typeof bounds === "object" &&
        !Array.isArray(bounds) &&
        Object.keys(bounds).length === 4 &&
        ["x", "y", "width", "height"].every(
          (key) => Number.isFinite(bounds[key]) && Math.abs(bounds[key]) <= 1_000_000,
        ) &&
        bounds.width >= 0 &&
        bounds.height >= 0,
    ) &&
    Number.isFinite(metrics.height) &&
    metrics.height >= 0 &&
    metrics.height <= 1_000_000 &&
    typeof metrics.fontAvailable === "boolean",
  );
}

export function measuredTextInkBounds(node) {
  const metrics = currentTextMetrics(node);
  if (!metrics) return null;
  const boxes = metrics.lineInkBounds
    .map((box, index) => {
      const offset =
        node.textAlign === "center"
          ? (node.width - metrics.lineWidths[index]) / 2
          : node.textAlign === "right"
            ? node.width - metrics.lineWidths[index]
            : 0;
      return {
        x: box.x + offset,
        y: box.y + index * node.fontSize * node.lineHeight,
        width: box.width,
        height: box.height,
      };
    })
    .filter((box) => box.width > 0 && box.height > 0);
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...boxes.map((box) => box.x)),
    y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  };
}

export function currentTextMetrics(node) {
  return validTextMetrics(node.textMetrics) &&
    node.textMetrics.signature === textMetricsSignature(node) &&
    (node.textMetrics.sourceSignature === undefined ||
      node.textMetrics.sourceSignature === textSourceMetricsSignature(node)) &&
    node.textMetrics.lineWidths.length === String(node.text).split("\n").length
    ? node.textMetrics
    : null;
}

const round = (value) => Math.round(value * 10000) / 10000;

export function createBrowserTextMeasurer(documentValue = globalThis.document) {
  if (!documentValue?.body || !documentValue.createElementNS) return null;
  const svg = documentValue.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute(
    "style",
    "position:fixed;left:-100000px;top:0;visibility:hidden;overflow:visible",
  );
  const text = documentValue.createElementNS(svg.namespaceURI, "text");
  text.setAttribute("dominant-baseline", "hanging");
  svg.append(text);
  documentValue.body.append(svg);
  const lineBox = documentValue.createElement("div");
  lineBox.style.cssText = "all:initial;display:block;position:fixed;left:-100000px;top:0;visibility:hidden;margin:0;padding:0;border:0;white-space:pre;width:max-content;height:auto";
  lineBox.textContent = "Hg";
  documentValue.body.append(lineBox);
  const range = documentValue.createRange();
  range.selectNodeContents(lineBox);
  const baselineOffsets = new Map();
  const context = documentValue.createElement("canvas").getContext("2d");
  if (!context) {
    svg.remove();
    lineBox.remove();
    throw Error("浏览器无法测量文字");
  }
  let actualInkAvailable = true;
  let wrapWidth = Infinity;
  return {
    configure(node) {
      wrapWidth = node.textFlow === "wrap" ? node.width : Infinity;
      for (const [name, value] of Object.entries({
        "font-family": designFontFamilyCss(
          node.fontFamily ?? "Inter, ui-sans-serif, system-ui, sans-serif",
        ),
        "font-size": node.fontSize,
        "font-weight": node.fontWeight,
        "font-style": node.fontStyle ?? "normal",
        "letter-spacing": node.letterSpacing ?? 0,
      }))
        text.setAttribute(name, String(value));
      text.setAttribute("xml:space", "preserve");
      text.style.whiteSpace = "pre";
      context.font = `${node.fontStyle ?? "normal"} ${node.fontWeight} ${node.fontSize}px ${designFontFamilyCss(node.fontFamily ?? "Inter")}`;
      context.textBaseline = "hanging";
      actualInkAvailable = !node.letterSpacing || "letterSpacing" in context;
      if ("letterSpacing" in context) context.letterSpacing = `${node.letterSpacing ?? 0}px`;
    },
    lineBoxOffset(node) {
      const key = JSON.stringify([node.fontFamily, node.fontRef, node.fontSize,
        node.fontWeight, node.fontStyle, node.letterSpacing, node.lineHeight]);
      if (baselineOffsets.has(key)) return baselineOffsets.get(key);
      Object.assign(lineBox.style, {
        fontFamily: designFontFamilyCss(node.fontFamily),
        fontSize: `${node.fontSize}px`,
        fontWeight: String(node.fontWeight),
        fontStyle: node.fontStyle ?? "normal",
        letterSpacing: `${node.letterSpacing ?? 0}px`,
        lineHeight: `${node.fontSize * node.lineHeight}px`,
      });
      // Native TEXT bounds start at the line box. Browser Range bounds start
      // at its font box, whereas SVG/Canvas hanging text starts lower within
      // that font box. Measure both pieces with the actual loaded font.
      text.textContent = "Hg";
      const offset = range.getBoundingClientRect().top - lineBox.getBoundingClientRect().top -
        text.getBoundingClientRect().top;
      if (!Number.isFinite(offset) || Math.abs(offset) > 100)
        throw Error("浏览器文字行框与 hanging 基线差值超过支持范围");
      baselineOffsets.set(key, offset);
      return offset;
    },
    measure(value) {
      text.textContent = value || " ";
      const bounds = text.getBBox();
      const actual = context.measureText(value);
      let advance = value ? text.getComputedTextLength() : 0;
      if (advance > wrapWidth + 0.01 && /\S/u.test(value) && / +$/u.test(value)) {
        text.textContent = value.replace(/ +$/u, "");
        const fittingAdvance = text.getComputedTextLength();
        text.textContent = value;
        if (fittingAdvance <= wrapWidth + 0.01) advance = fittingAdvance;
      }
      const measuredInk =
        actualInkAvailable &&
        [
          actual.actualBoundingBoxLeft,
          actual.actualBoundingBoxRight,
          actual.actualBoundingBoxAscent,
          actual.actualBoundingBoxDescent,
        ].every(Number.isFinite)
          ? {
              x: -actual.actualBoundingBoxLeft,
              y: -actual.actualBoundingBoxAscent,
              width: actual.actualBoundingBoxLeft + actual.actualBoundingBoxRight,
              height: actual.actualBoundingBoxAscent + actual.actualBoundingBoxDescent,
            }
          : bounds;
      return {
        width: round(advance),
        bottom: value ? round(Math.max(0, measuredInk.y + measuredInk.height)) : 0,
        ink: value
          ? {
              x: round(measuredInk.x),
              y: round(measuredInk.y),
              width: round(Math.max(0, measuredInk.width)),
              height: round(Math.max(0, measuredInk.height)),
            }
          : { x: 0, y: 0, width: 0, height: 0 },
      };
    },
    fontAvailable(node) {
      const probe = `BESbswyMW0123456789${String(node.text).slice(0, 128)}`;
      return ["monospace", "serif", "sans-serif"].some((fallback) => {
        context.font = `${node.fontStyle ?? "normal"} ${node.fontWeight} 24px ${fallback}`;
        const baseline = context.measureText(probe).width;
        context.font = `${node.fontStyle ?? "normal"} ${node.fontWeight} 24px ${designFontFamilyCss(node.fontFamily)}, ${fallback}`;
        return Math.abs(context.measureText(probe).width - baseline) > 0.01;
      });
    },
    close() { svg.remove(); lineBox.remove(); },
  };
}

// Preserve every original character; line breaks are layout, and textSource retains the source.
export function measuredWrap(source, width, measure) {
  return source.split("\n").flatMap((paragraph) => {
    if (!paragraph || measure(paragraph).width <= width + 0.01) return [paragraph];
    const lines = [];
    let line = "";
    for (const token of paragraph.match(/\S+\s*|\s+/gu) ?? []) {
      // A word's following spaces hang at the line end in normal/pre-wrap
      // browser layout. Count them once another word follows, retaining their
      // exact bytes in the previous line and in textSource.
      const trailingSpaces = /\S/u.test(token) ? / +$/u.exec(token)?.[0].length ?? 0 : 0;
      const fittingToken = trailingSpaces ? token.slice(0, -trailingSpaces) : token;
      if (line && measure(line + fittingToken).width > width + 0.01) {
        lines.push(line);
        line = "";
      }
      const characters = Array.from(token);
      for (const [index, character] of characters.entries()) {
        if (index < characters.length - trailingSpaces &&
            line && measure(line + character).width > width + 0.01) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    lines.push(line);
    return lines;
  });
}

export function measuredEllipsis(source, width, measure) {
  const lines = source.split(/\r\n?|\n/u);
  const first = lines[0];
  if (lines.length === 1 && measure(first).width <= width) return first;
  const characters = [...first];
  let low = 0, high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measure(`${characters.slice(0, middle).join("")}…`).width <= width) low = middle;
    else high = middle - 1;
  }
  return `${characters.slice(0, low).join("").trimEnd()}…`;
}

/** Mutates only text layout fields; Node callers remain unmeasured unless a real measurer is supplied. */
export async function measureFigmaTextDocument(
  documentValue,
  {
    sourceNodes = new Map(),
    sourceIds = new Map(),
    browserDocument = globalThis.document,
    measurer,
    nativeLineBoxes = false,
  } = {},
) {
  if (!measurer && (!browserDocument?.body || !browserDocument.createElementNS))
    return { measured: 0, unavailableFonts: [], geometryChangedIds: [] };
  await browserDocument?.fonts?.ready;
  const measurement = measurer ?? createBrowserTextMeasurer(browserDocument);
  const warnings = new Set(),
    changed = new Set(),
    unsupportedBaselines = [],
    unsupportedTruncations = [],
    pages = documentValue.pages ?? [documentValue];
  let measured = 0;
  try {
    for (const page of pages)
      for (const node of page.nodes ?? []) {
        if (node.type !== "text") continue;
        const source = sourceNodes.get(sourceIds.get(node.id));
        const autoResize = source?.style?.textAutoResize;
        measurement.configure(node.textOverflow === "ellipsis"
          ? { ...node, textFlow: undefined }
          : autoResize === "WIDTH_AND_HEIGHT" ? node : { ...node, textFlow: "wrap" });
        if (nativeLineBoxes && measurement.lineBoxOffset) {
          try {
            if (node.rotation) throw Error("旋转文字的原生行框尚不能映射为 hanging 基线");
            const logicalY = node.y - (node.layoutBaselineOffset ?? 0);
            const nextY = Math.round((logicalY + measurement.lineBoxOffset(node)) * 100) / 100;
            if (nextY < -20000 || nextY > 20000) throw Error("文字基线映射会超过设计坐标范围");
            if (node.y !== nextY) changed.add(node.id);
            node.y = nextY;
            node.layoutBaselineOffset = round(nextY - logicalY);
            node.layoutBaselineSource = "native";
          } catch (error) {
            unsupportedBaselines.push({ nodeId: node.id, reason: error.message });
          }
        }
        const originalText = node.textSource ?? node.text;
        if (node.textOverflow === "ellipsis" && /[\r\n]/u.test(originalText))
          unsupportedTruncations.push({ nodeId: node.id, reason: "单行截断包含显式换行；暂以首行省略号预览，完整来源保留，请核对原生效果" });
        const lines =
          node.textOverflow === "ellipsis"
            ? [measuredEllipsis(originalText, node.width, (value) => measurement.measure(value))]
            : autoResize === "WIDTH_AND_HEIGHT"
            ? originalText.split("\n")
            : measuredWrap(originalText, node.width, (value) => measurement.measure(value));
        const text = lines.join("\n");
        if (text.length > 4000) throw Error(`文字 ${node.id} 换行后超过 4000 字符；请拆分文字图层`);
        node.text = text;
        const metrics = lines.map((line) => measurement.measure(line));
        const width = Math.max(
          0,
          ...metrics.map((metric) =>
            Math.max(metric.width, metric.ink.width, metric.ink.x + metric.ink.width),
          ),
        );
        const height = Math.max(
          0,
          ...metrics.map(
            (metric, index) => metric.bottom + index * node.fontSize * node.lineHeight,
          ),
        );
        if (autoResize === "WIDTH_AND_HEIGHT" && width > node.width) {
          node.width = Math.ceil(width * 100) / 100;
          changed.add(node.id);
        }
        if (["WIDTH_AND_HEIGHT", "HEIGHT"].includes(autoResize) && height > node.height) {
          node.height = Math.ceil(height * 100) / 100;
          changed.add(node.id);
        }
        if (originalText.trim()) {
          node.textSource = originalText;
          if (autoResize !== "WIDTH_AND_HEIGHT" && node.textOverflow !== "ellipsis") node.textFlow = "wrap";
          else delete node.textFlow;
          node.textFlowWidth = node.width;
        }
        const fontAvailable = measurement.fontAvailable(node);
        if (!fontAvailable) warnings.add(node.fontFamily);
        node.textMetrics = {
          version: 1,
          signature: textMetricsSignature(node),
          sourceSignature: textSourceMetricsSignature(node),
          lineWidths: metrics.map((metric) => metric.width),
          lineInkBounds: metrics.map((metric) => metric.ink),
          height: round(height),
          fontAvailable,
        };
        measured += 1;
      }
  } finally {
    measurement.close?.();
  }
  // normalized editor states expose the active page's nodes as an alias.
  if (documentValue.pages)
    documentValue.nodes =
      documentValue.pages.find((page) => page.id === documentValue.activePageId)?.nodes ?? [];
  return { measured, unavailableFonts: [...warnings], geometryChangedIds: [...changed], unsupportedBaselines, unsupportedTruncations };
}
