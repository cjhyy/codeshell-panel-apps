/* Bounded plain HTML text intent. Measured boxes stay structural/editable. */
const collapsed = (text) => text.replace(/[\t\n\f\r ]+/gu, " ").replace(/^ | $/gu, "");
const clipped = (value) => ["hidden", "clip", "auto", "scroll"].includes(value);
const zero = (value) => /^-?0(?:\.0+)?(?:px|%)?$/u.test(value);

export function recoverHtmlTextOverflow(source, node, warn) {
  const css = source.cssText;
  if (!css) return;
  const unsupported = (reason) => warn("html-text-overflow", node.id, `${reason}；保留原始测量几何，请核对文字截断。`);
  if (!["nowrap", "pre"].includes(css.whiteSpace)) return unsupported("只支持 nowrap 或 pre 的单行截断意图");
  if (css.generatedContent !== "false") return unsupported("伪元素、表单或列表生成的内容不能替换为 DOM 原文");
  if (source.nodeType !== "container" || css.childElements !== "0" || !["block", "inline-block"].includes(source.layout?.display) ||
      source.children?.length !== 1 || source.children[0].nodeType !== "text" ||
      node.children?.length !== 1 || node.children[0].type !== "text")
    return unsupported("只支持无子元素的单一普通文字框");
  const text = node.children[0];
  if (text.textAlign && text.textAlign !== "left") return unsupported("非左对齐文字的裁剪原点尚不能保留");
  if (node.rotation || text.rotation || css.writingMode !== "horizontal-tb" || css.direction !== "ltr" ||
      !zero(css.textIndent) || !(css.wordSpacing === "normal" || zero(css.wordSpacing)) || css.textTransform !== "none")
    return unsupported("旋转、竖排、RTL、缩进、词距或文字变换尚不能保留");
  if (typeof css.rawSource !== "string" || css.rawSource.length > 4000)
    return unsupported("原始文字来源缺失或超过 4000 字符");
  if (!["clip", "ellipsis"].includes(css.textOverflow))
    return unsupported("只支持单值 clip 或 ellipsis");
  if (![css.overflowX, css.overflowY].every((value) => ["visible", "hidden", "clip", "auto", "scroll"].includes(value)))
    return unsupported("未知的文字溢出模式");
  const ellipsis = css.textOverflow === "ellipsis" && clipped(css.overflowX);
  if (clipped(css.overflowX) !== clipped(css.overflowY))
    return unsupported("不同轴的裁剪不能映射到同一个原生文字框");
  if (css.whiteSpace === "pre" && (css.rawSource.includes("\t") || ellipsis && /[\r\n]/u.test(css.rawSource)))
    return unsupported("保留格式文字的制表符或多行 ellipsis 尚不能原生表示");
  if (css.whiteSpace === "nowrap" && /[\r\n]/u.test(css.rawSource) && /[^\x00-\x7f]/u.test(css.rawSource))
    return unsupported("非 ASCII 来源的显式换行涉及语言相关折叠，暂不能原生表示");
  const full = css.whiteSpace === "nowrap" ? collapsed(css.rawSource) : css.rawSource;
  if (!full.trim()) return;
  const lineHeight = /^\d+(?:\.\d+)?px$/u.test(css.lineHeight) ? Number.parseFloat(css.lineHeight) : NaN;
  const top = node.paddingTop ?? node.padding ?? 0, left = node.paddingLeft ?? node.padding ?? 0,
    right = node.paddingRight ?? node.padding ?? 0;
  const baseline = text.y - node.y - top;
  if (!Number.isFinite(lineHeight) || lineHeight / text.fontSize < 0.7 || lineHeight / text.fontSize > 3 || Math.abs(baseline) > 100)
    return unsupported("行高或文字行框不在支持范围内");
  const semantic = JSON.parse(text.notes ?? "{}");
  semantic.htmlText = { whiteSpace: css.whiteSpace,
    ...(css.rawSource !== full ? { rawSource: css.rawSource } : {}) };
  const notes = JSON.stringify(semantic);
  if (notes.length > 2000) return unsupported("完整原始空白来源超过语义备注预算");
  if (css.whiteSpace === "nowrap" && /[\r\n]/u.test(css.rawSource))
    warn("html-text-segment-break", node.id, "nowrap 的显式换行按 CSS 空白折叠；完整原始字符保留在语义备注，原生编辑使用折叠后的完整文字。");
  Object.assign(node, { layout: "vertical", layoutWrap: "none", gap: 0, rowGap: 0, columnGap: 0,
    alignItems: "start", justifyContent: "start", clipContent: clipped(css.overflowX) });
  if (node.clipContent) node.contentClipping = "intentional";
  Object.assign(text, { x: node.x + left, text: full, textSource: full,
    lineHeight: lineHeight / text.fontSize, height: lineHeight * full.split("\n").length,
    layoutBaselineOffset: Math.round(baseline * 10000) / 10000,
    layoutSizingHorizontal: ellipsis ? "fill" : "hug", layoutSizingVertical: "hug",
    layoutAlignSelf: "start", textFlowWidth: Math.max(1, node.width - left - right), notes });
  delete text.textFlow;
  if (ellipsis) { text.textOverflow = "ellipsis"; text.width = text.textFlowWidth; }
  else delete text.textOverflow;
}
