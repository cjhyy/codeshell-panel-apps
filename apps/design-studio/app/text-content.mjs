import { validTextMetrics } from "./text-metrics.mjs";
import { validateTextRanges, mapTextDisplay } from "./text-ranges.mjs";

const recordedText = (signature) => {
  try {
    const value = JSON.parse(signature);
    return Array.isArray(value) && (value.length === 8 || (value.length === 9 && value[8] === "pixels")) && typeof value[0] === "string"
      ? value[0]
      : undefined;
  } catch {
    return undefined;
  }
};

function onlySoftBreaks(display, source) {
  let offset = 0;
  for (const character of display) {
    if (source.startsWith(character, offset)) offset += character.length;
    else if (character !== "\n") return false;
  }
  return offset === source.length;
}

/** Native characters are authored content; browser soft breaks are display layout. */
export function nativeTextContent(node, baseline) {
  if (node.textRanges !== undefined) {
    validateTextRanges(node);
    return mapTextDisplay(node).sourceText;
  }
  const display = node.text ?? "",
    source = node.textSource;
  if (typeof source !== "string" || display === source) return display;
  if (validTextMetrics(node.textMetrics)) {
    // Compare content provenance independently of typography: changing a font
    // invalidates its measurements, but does not author new line breaks.
    const previousDisplay = recordedText(node.textMetrics.signature);
    const previousSource = recordedText(node.textMetrics.sourceSignature);
    if (display === previousDisplay) return source;
    if (
      previousDisplay !== undefined &&
      (previousSource === undefined || source === previousSource)
    ) return display;
  }
  if (baseline && display === baseline.text && source !== baseline.textSource) return source;
  // Older/Node-only documents can have no glyph receipt. Accept the declared
  // source only when display adds line breaks without changing any source byte.
  if (node.textFlow === "wrap" && onlySoftBreaks(display, source)) return source;
  if (
    node.textOverflow === "ellipsis" && display.endsWith("…") &&
    source.startsWith(display.slice(0, -1).trimEnd())
  ) return source;
  return display;
}

export function nativeTextPlan(node, baseline) {
  return {
    characters: nativeTextContent(node, baseline),
    autoResize:
      node.layoutSizingHorizontal === "hug"
        ? "WIDTH_AND_HEIGHT"
        : node.layoutSizingVertical === "hug" ? "HEIGHT" : "NONE",
    truncation: node.textOverflow === "ellipsis" ? "ENDING" : "DISABLED",
    maxLines: node.textOverflow === "ellipsis" ? 1 : null,
  };
}
