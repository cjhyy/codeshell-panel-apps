const svgElements = new Set(
  "svg g path rect circle ellipse line polyline polygon defs clipPath mask linearGradient radialGradient stop pattern text tspan title desc metadata filter feGaussianBlur feOffset feBlend feColorMatrix feComposite feFlood feMerge feMergeNode feMorphology feTurbulence feDisplacementMap use symbol"
    .toLowerCase().split(" "),
);

/** Shared admission for inert, self-contained SVG image resources. */
export function inertDesignSvg(value) {
  if (typeof value !== "string" || new TextEncoder().encode(value).length > 1024 * 1024)
    throw new Error("SVG 必须是最多 1 MiB 的文本");
  const source = value.replace(/^\uFEFF/u, "").replace(/^\s*<\?xml[^?]*\?>/u, "").trim();
  if (!/^<svg[\s>]/iu.test(source) || /<!|<\?|&(?!(?:amp|lt|gt|quot|apos);)/iu.test(source))
    throw new Error("SVG 包含声明、实体或不支持的标记");
  for (const tag of source.matchAll(/<\/?\s*([\w:-]+)\b([^<>]*)>/gu)) {
    if (!svgElements.has(tag[1].toLowerCase())) throw new Error(`SVG 不允许 ${tag[1]} 元素`);
    if (/\bon[\w:-]+\s*=|\b(?:src|xml:base)\s*=/iu.test(tag[2]))
      throw new Error("SVG 不允许事件或外部资源属性");
    for (const href of tag[2].matchAll(/\b(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/giu))
      if (!/^#[a-z0-9_.:-]+$/iu.test(href[1] ?? href[2] ?? href[3])) throw new Error("SVG 引用必须是内部 ID");
  }
  if (/<(?:script|style|foreignObject)\b|\\|@import|(?:javascript|vbscript|data|file)\s*:|url\(\s*(?!['"]?#[a-z0-9_.:-]+['"]?\s*\))/iu.test(source))
    throw new Error("SVG 不允许脚本、样式表或外部 URL");
  return source;
}
