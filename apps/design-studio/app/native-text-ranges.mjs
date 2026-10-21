/**
 * Keep staged range authoring lossless while native consumers are implemented.
 * A successful SDK capability probe alone does not qualify production transfer.
 */
export function assertNativeTextRangeBoundary(node) {
  if (node?.textRanges === undefined) return;
  const label = (typeof node.name === "string" ? node.name : typeof node.id === "string" ? node.id : "Text").slice(0, 120);
  const error = new Error(
    label + "：范围文字的原生创建和增量导回尚未完成验证；已阻止互转，未丢弃范围样式。",
  );
  error.code = "TEXT_RANGES_NATIVE_UNSUPPORTED";
  throw error;
}
