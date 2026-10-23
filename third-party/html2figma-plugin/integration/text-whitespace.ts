// Informational source receipts use the existing semantic shared-plugin-data
// channel. They never normalize characters or admit layout on JSON reimport.
const KEY = "htmlTextWhitespace";
const object = (value: any) => value && typeof value === "object" && !Array.isArray(value);
export function textWhitespaceSource(value: any) {
  if (!object(value) || !["normal", "nowrap"].includes(value.whiteSpace) ||
      typeof value.rawSource !== "string" || value.rawSource.length > 1000 ||
      JSON.stringify(value.rawSource).length > 1000 ||
      (value.removedTrailingNbsp !== undefined && value.removedTrailingNbsp !== true) ||
      (value.omittedPseudos !== undefined && (!Array.isArray(value.omittedPseudos) ||
        value.omittedPseudos.length < 1 || value.omittedPseudos.length > 2 ||
        value.omittedPseudos.some((pseudo: any) => !["::before", "::after"].includes(pseudo)) ||
        new Set(value.omittedPseudos).size !== value.omittedPseudos.length)) ||
      (!value.removedTrailingNbsp && !value.omittedPseudos)) return null;
  return { whiteSpace: value.whiteSpace, rawSource: value.rawSource,
    ...(value.removedTrailingNbsp ? { removedTrailingNbsp: true } : {}),
    ...(value.omittedPseudos ? { omittedPseudos: [...value.omittedPseudos] } : {}) };
}
const snapshot = (node: any) => ({
  type: node.type, x: node.x, y: node.y, width: node.width, height: node.height,
  ...(node.type === "TEXT" ? { characters: node.characters, fontName: node.fontName,
    fontSize: node.fontSize, lineHeight: node.lineHeight, letterSpacing: node.letterSpacing } : {}),
  ...(node.children ? { children: node.children.map((child: any) => ({
    type: child.type, x: child.x, y: child.y, width: child.width, height: child.height,
    ...(child.type === "TEXT" ? { characters: child.characters } : {}),
  })) } : {}),
});
export function retainTextWhitespace(node: any, source: any, warnings: string[]) {
  const receipt = textWhitespaceSource(source);
  if (receipt) {
    const serialized = JSON.stringify({ format: "codeshell.html.text-whitespace", version: 1,
      source: receipt, snapshot: snapshot(node) });
    if (serialized.length <= 8000) {
      node.sharedPluginData ??= {};
      node.sharedPluginData[KEY] = serialized;
    } else warnings.push("HTML 文字来源快照超过 8000 UTF-16 单元；未覆盖原始备注，未修改文字或布局。");
  }
  const raw = node.sharedPluginData?.[KEY];
  if (raw === undefined) return;
  let value;
  try { if (typeof raw === "string" && raw.length <= 8000) value = JSON.parse(raw); } catch { /* Preserve uninterpreted raw metadata. */ }
  const original = textWhitespaceSource(value?.source);
  if (!original || value?.format !== "codeshell.html.text-whitespace" || value.version !== 1) {
    warnings.push("HTML 文字来源备注无效；原始备注仅作记录，未用于修改文字或布局。");
    return;
  }
  if (JSON.stringify(value.snapshot) !== JSON.stringify(snapshot(node)))
    warnings.push("HTML 文字来源备注与当前图层快照不同；仅保留原始记录，未用于修改文字或布局。");
  if (original.omittedPseudos)
    warnings.push("已省略捕获时无绘制、无文字且脱离文档流的空伪元素；保留真实节点，但不保留伪元素扩展的点击区域。");
}
