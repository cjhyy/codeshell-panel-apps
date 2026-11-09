/**
 * Caller-visible warnings for SVG export diagnostics (exportDesignSvg options.diagnostics). Today the only code is
 * TEXT_LINE_BOX_SVG_UNMEASURED: no font metrics were available for a text line box, so that text keeps its receipt
 * geometry or the portable unmeasured fallback instead of a measured baseline. One entry per code and node.
 */
export const MAX_SVG_EXPORT_WARNINGS = 400;
const MESSAGES = {
  TEXT_LINE_BOX_SVG_UNMEASURED: "No font metrics were available for this text's line box; its SVG baseline is the unmeasured fallback, not a measured browser baseline.",
};

export function svgExportWarnings(diagnostics, { pageId } = {}) {
  const seen = new Set(), warnings = [];
  for (const diagnostic of diagnostics ?? []) {
    const key = `${diagnostic.code}\u0000${diagnostic.nodeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    warnings.push({ code: diagnostic.code, severity: "warning", nodeId: diagnostic.nodeId, ...(pageId ? { pageId } : {}),
      message: MESSAGES[diagnostic.code] ?? "SVG export reported a diagnostic for this node." });
  }
  return { warnings: warnings.slice(0, MAX_SVG_EXPORT_WARNINGS), truncatedWarningCount: Math.max(0, warnings.length - MAX_SVG_EXPORT_WARNINGS) };
}

/** Panel toast text appended to the export result; null when nothing was unmeasured. */
export function svgExportWarningNotice(diagnostics) {
  const { warnings, truncatedWarningCount } = svgExportWarnings(diagnostics);
  const count = warnings.length + truncatedWarningCount;
  return count ? `${count} 个文字未取得浏览器字体度量，SVG 中其基线为未测量回退（TEXT_LINE_BOX_SVG_UNMEASURED），请在字体可用时重新导出核对。` : null;
}
