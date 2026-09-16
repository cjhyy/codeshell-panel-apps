import type { EditorDocument } from "./types";

export interface EditorFontWarning {
  family: string;
  clipIds: string[];
  message: string;
}
const generic = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
  "-apple-system",
  "blinkmacsystemfont",
]);
const cache = new Map<string, boolean>();
let measure: CanvasRenderingContext2D | null | undefined;
/** Recheck after web fonts load; this does not request access to the user's local-font inventory. */
export function resetFontAvailabilityCache(): void {
  cache.clear();
}
function families(value: string): string[] {
  const result: string[] = [];
  let text = "",
    quote = "",
    escaped = false;
  const append = () => {
    const name = text.trim();
    if (name && !generic.has(name.toLowerCase())) result.push(name);
    text = "";
  };
  for (const char of value) {
    if (escaped) {
      text += char;
      escaped = false;
    } else if (char === "\\") escaped = true;
    else if (quote) {
      if (char === quote) quote = "";
      else text += char;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === ",") append();
    else text += char;
  }
  append();
  return [...new Set(result)];
}
function appearsAvailable(family: string): boolean {
  const remembered = cache.get(family);
  if (remembered !== undefined) return remembered;
  measure ??= document.createElement("canvas").getContext("2d");
  if (!measure) return true; // No measurement is not evidence of a missing font.
  // FontFaceSet.check can return true for an unknown system font. Compare actual
  // glyph metrics against three distinct fallbacks instead. This is a heuristic,
  // not installation proof or a guarantee that every Unicode glyph is present.
  const probes = ["mmmmmmmmiiWWW@0123456789", "汉字中文かな한글🙂"];
  let available = false;
  for (const fallback of ["monospace", "serif", "sans-serif"]) {
    measure.font = `72px ${fallback}`;
    const baseline = probes.map((text) => measure!.measureText(text).width);
    measure.font = `72px ${JSON.stringify(family)}, ${fallback}`;
    if (
      probes.some(
        (text, index) => Math.abs(measure!.measureText(text).width - baseline[index]!) > 0.01,
      )
    ) {
      available = true;
      break;
    }
  }
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  cache.set(family, available);
  return available;
}
export function unavailableFontFamilies(value: string): string[] {
  return families(value).filter((family) => !appearsAvailable(family));
}
export function fontWarningMessage(family: string): string {
  return `可能缺少字体“${family}”；缺失时预览和导出会使用替代字体。工程包不包含字体，换设备需自行安装；字体检测仅供参考。`;
}
/** Check this sequence and all reachable child sequences, including currently offscreen titles. */
export function editorFontWarnings(
  document: EditorDocument,
  sequenceId: string,
): EditorFontWarning[] {
  const visited = new Set<string>(),
    missing = new Map<string, Set<string>>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const sequence = document.sequences.find((sequence) => sequence.id === id);
    if (!sequence) return;
    for (const clip of sequence.clips) {
      if (clip.kind === "sequence") visit(clip.sequenceId);
      if (clip.kind !== "text") continue;
      for (const family of unavailableFontFamilies(clip.style.fontFamily)) {
        const ids = missing.get(family) ?? new Set<string>();
        ids.add(clip.id);
        missing.set(family, ids);
      }
    }
  };
  visit(sequenceId);
  return [...missing].map(([family, ids]) => ({
    family,
    clipIds: [...ids],
    message: fontWarningMessage(family),
  }));
}
