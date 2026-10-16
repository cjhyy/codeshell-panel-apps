/**
 * Font utilities for Figma plugin contexts.
 * Shared by production plugin and test plugin.
 */

export interface FontDescriptor {
  family: string;
  style: string;
}

const FALLBACK_FONTS: FontDescriptor[] = [
  { family: 'Inter', style: 'Regular' },
  { family: 'Arial', style: 'Regular' },
];

/**
 * Recursively extract all unique fonts from a FigmaJSON node tree.
 * Handles both base fontName and per-segment fonts from styledTextSegments.
 */
export function extractFontsFromJSON(node: any): Map<string, FontDescriptor> {
  const fonts = new Map<string, FontDescriptor>();
  if (!node) return fonts;

  // Handle root wrapper { nodes: [...] }
  if (node.nodes?.length) {
    for (const n of node.nodes) {
      extractFontsFromJSON(n).forEach((f, k) => fonts.set(k, f));
    }
    return fonts;
  }

  if (node.type === 'TEXT') {
    // Base font
    if (node.fontName?.family && node.fontName?.style) {
      const { family, style } = node.fontName;
      fonts.set(`${family}:${style}`, { family, style });
    }
    // Per-range fonts from rich text segments
    if (node.styledTextSegments?.length) {
      for (const seg of node.styledTextSegments) {
        if (seg.fontName?.family && seg.fontName?.style) {
          const { family, style } = seg.fontName;
          fonts.set(`${family}:${style}`, { family, style });
        }
      }
    }
  }

  if (node.children?.length) {
    for (const child of node.children) {
      if (!child) continue;
      const childFonts = extractFontsFromJSON(child);
      childFonts.forEach((font, key) => fonts.set(key, font));
    }
  }

  return fonts;
}

/**
 * Load fonts via Figma API, with fallback fonts if any fail.
 */
export async function loadFonts(
  figmaApi: any,
  fonts: FontDescriptor[]
): Promise<{ successful: number; failed: number }> {
  if (!fonts.length) return { successful: 0, failed: 0 };

  figmaApi.notify(`Loading ${fonts.length} fonts...`, { timeout: 2000 });

  const results = await Promise.allSettled(
    fonts.map(font => figmaApi.loadFontAsync(font))
  );

  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.length - successful;

  if (failed > 0) {
    await Promise.allSettled(
      FALLBACK_FONTS.map(font => figmaApi.loadFontAsync(font))
    );
  }

  return { successful, failed };
}

/**
 * Convenience: extract fonts from JSON and load them all.
 */
export async function loadFontsFromJSON(figmaApi: any, jsonData: any): Promise<void> {
  const fonts = extractFontsFromJSON(jsonData);
  const { successful, failed } = await loadFonts(figmaApi, Array.from(fonts.values()));

  if (fonts.size > 0) {
    const message = failed === 0
      ? `All ${successful} fonts loaded!`
      : `${successful} fonts loaded, ${failed} failed`;
    figmaApi.notify(message, { timeout: 2000, error: failed > successful });
  }
}
