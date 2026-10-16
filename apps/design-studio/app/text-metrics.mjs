/* Browser measurements are receipts for specific text and typography, not audit exemptions. */
export function textMetricsSignature(node) {
  return JSON.stringify([
    node.text, node.fontFamily ?? "", node.fontRef ?? "", node.fontSize, node.fontWeight,
    node.fontStyle ?? "normal", node.letterSpacing ?? 0, node.lineHeight,
  ]);
}

export function validTextMetrics(metrics) {
  return Boolean(metrics && typeof metrics === "object" && !Array.isArray(metrics) &&
    Object.keys(metrics).every((key) => ["version", "signature", "lineWidths", "lineInkBounds", "height", "fontAvailable"].includes(key)) &&
    metrics.version === 1 && typeof metrics.signature === "string" && metrics.signature.length <= 8500 &&
    Array.isArray(metrics.lineWidths) && metrics.lineWidths.length >= 1 && metrics.lineWidths.length <= 4001 &&
    metrics.lineWidths.every((width) => Number.isFinite(width) && width >= 0 && width <= 1_000_000) &&
    Array.isArray(metrics.lineInkBounds) && metrics.lineInkBounds.length === metrics.lineWidths.length &&
    metrics.lineInkBounds.every((bounds) => bounds && typeof bounds === "object" && !Array.isArray(bounds) &&
      Object.keys(bounds).length === 4 && ["x", "y", "width", "height"].every((key) => Number.isFinite(bounds[key]) && Math.abs(bounds[key]) <= 1_000_000) &&
      bounds.width >= 0 && bounds.height >= 0) &&
    Number.isFinite(metrics.height) && metrics.height >= 0 && metrics.height <= 1_000_000 &&
    typeof metrics.fontAvailable === "boolean");
}

export function measuredTextInkBounds(node) {
  const metrics = currentTextMetrics(node);
  if (!metrics) return null;
  const boxes = metrics.lineInkBounds.map((box, index) => {
    const offset = node.textAlign === "center" ? (node.width - metrics.lineWidths[index]) / 2
      : node.textAlign === "right" ? node.width - metrics.lineWidths[index] : 0;
    return { x: box.x + offset, y: box.y + index * node.fontSize * node.lineHeight,
      width: box.width, height: box.height };
  }).filter((box) => box.width > 0 && box.height > 0);
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...boxes.map((box) => box.x)), y = Math.min(...boxes.map((box) => box.y));
  return { x, y, width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y };
}

export function currentTextMetrics(node) {
  return validTextMetrics(node.textMetrics) && node.textMetrics.signature === textMetricsSignature(node) &&
    node.textMetrics.lineWidths.length === String(node.text).split("\n").length
    ? node.textMetrics : null;
}

const round = (value) => Math.round(value * 10000) / 10000;

function createBrowserMeasurer(documentValue) {
  const svg = documentValue.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("style", "position:fixed;left:-100000px;top:0;visibility:hidden;overflow:visible");
  const text = documentValue.createElementNS(svg.namespaceURI, "text");
  text.setAttribute("dominant-baseline", "hanging");
  svg.append(text);
  documentValue.body.append(svg);
  const context = documentValue.createElement("canvas").getContext("2d");
  if (!context) { svg.remove(); throw Error("浏览器无法测量文字"); }
  return {
    configure(node) {
      for (const [name, value] of Object.entries({
        "font-family": node.fontFamily ?? "Inter, ui-sans-serif, system-ui, sans-serif",
        "font-size": node.fontSize, "font-weight": node.fontWeight,
        "font-style": node.fontStyle ?? "normal", "letter-spacing": node.letterSpacing ?? 0,
      })) text.setAttribute(name, String(value));
      text.setAttribute("xml:space", "preserve");
      text.style.whiteSpace = "pre";
    },
    measure(value) {
      text.textContent = value || " ";
      const bounds = text.getBBox();
      return { width: value ? round(text.getComputedTextLength()) : 0,
        bottom: value ? round(Math.max(0, bounds.y + bounds.height)) : 0,
        ink: value ? { x: round(bounds.x), y: round(bounds.y), width: round(bounds.width), height: round(bounds.height) }
          : { x: 0, y: 0, width: 0, height: 0 } };
    },
    fontAvailable(node) {
      const probe = `BESbswyMW0123456789${String(node.text).slice(0, 128)}`;
      return ["monospace", "serif", "sans-serif"].some((fallback) => {
        context.font = `${node.fontStyle ?? "normal"} ${node.fontWeight} 24px ${fallback}`;
        const baseline = context.measureText(probe).width;
        context.font = `${node.fontStyle ?? "normal"} ${node.fontWeight} 24px ${JSON.stringify(node.fontFamily)}, ${fallback}`;
        return Math.abs(context.measureText(probe).width - baseline) > 0.01;
      });
    },
    close: () => svg.remove(),
  };
}

// Preserve every original character; line breaks are layout, and textSource retains the source.
function measuredWrap(source, width, measure) {
  return source.split("\n").flatMap((paragraph) => {
    if (!paragraph || measure(paragraph).width <= width + 0.01) return [paragraph];
    const lines = [];
    let line = "";
    for (const token of paragraph.match(/\S+\s*|\s+/gu) ?? []) {
      if (line && measure(line + token).width > width + 0.01) { lines.push(line); line = ""; }
      for (const character of Array.from(token)) {
        if (line && measure(line + character).width > width + 0.01) { lines.push(line); line = ""; }
        line += character;
      }
    }
    lines.push(line);
    return lines;
  });
}

/** Mutates only text layout fields; Node callers remain unmeasured unless a real measurer is supplied. */
export async function measureFigmaTextDocument(documentValue, {
  sourceNodes = new Map(), sourceIds = new Map(), browserDocument = globalThis.document, measurer,
} = {}) {
  if (!measurer && (!browserDocument?.body || !browserDocument.createElementNS))
    return { measured: 0, unavailableFonts: [], geometryChangedIds: [] };
  await browserDocument?.fonts?.ready;
  const measurement = measurer ?? createBrowserMeasurer(browserDocument);
  const warnings = new Set(), changed = [], pages = documentValue.pages ?? [documentValue];
  let measured = 0;
  try {
    for (const page of pages) for (const node of page.nodes ?? []) {
      if (node.type !== "text") continue;
      measurement.configure(node);
      const source = sourceNodes.get(sourceIds.get(node.id));
      const autoResize = source?.style?.textAutoResize;
      const originalText = node.textSource ?? node.text;
      const lines = autoResize === "WIDTH_AND_HEIGHT" ? originalText.split("\n")
        : measuredWrap(originalText, node.width, (value) => measurement.measure(value));
      const text = lines.join("\n");
      if (text.length > 4000) throw Error(`文字 ${node.id} 换行后超过 4000 字符；请拆分文字图层`);
      node.text = text;
      const metrics = lines.map((line) => measurement.measure(line));
      const width = Math.max(0, ...metrics.map((metric) => Math.max(metric.width, metric.ink.x + metric.ink.width)));
      const height = Math.max(0, ...metrics.map((metric, index) => metric.bottom + index * node.fontSize * node.lineHeight));
      if (autoResize === "WIDTH_AND_HEIGHT" && width > node.width) {
        node.width = Math.ceil(width * 100) / 100; changed.push(node.id);
      }
      if (["WIDTH_AND_HEIGHT", "HEIGHT"].includes(autoResize) && height > node.height) {
        node.height = Math.ceil(height * 100) / 100;
        if (!changed.includes(node.id)) changed.push(node.id);
      }
      if (originalText.trim()) {
        node.textSource = originalText;
        if (autoResize !== "WIDTH_AND_HEIGHT") node.textFlow = "wrap";
        else delete node.textFlow;
        node.textFlowWidth = node.width;
      }
      const fontAvailable = measurement.fontAvailable(node);
      if (!fontAvailable) warnings.add(node.fontFamily);
      node.textMetrics = { version: 1, signature: textMetricsSignature(node),
        lineWidths: metrics.map((metric) => metric.width), lineInkBounds: metrics.map((metric) => metric.ink),
        height: round(height), fontAvailable };
      measured += 1;
    }
  } finally { measurement.close?.(); }
  // normalized editor states expose the active page's nodes as an alias.
  if (documentValue.pages) documentValue.nodes = documentValue.pages.find((page) => page.id === documentValue.activePageId)?.nodes ?? [];
  return { measured, unavailableFonts: [...warnings], geometryChangedIds: changed };
}
