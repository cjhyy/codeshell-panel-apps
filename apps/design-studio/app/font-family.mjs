export const MAX_DESIGN_FONT_FAMILY_LENGTH = 120;

const generics = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong",
]);
const wideKeywords = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);
const space = (value) => /[\t\n\f\r ]/u.test(value);

/** Parse CSS family separators/escapes without treating a quoted comma as a list. */
export function parseDesignFontFamily(value) {
  if (typeof value !== "string" || value.length > MAX_DESIGN_FONT_FAMILY_LENGTH || !value.trim() ||
      /[\u0000-\u001f\u007f]/u.test(value)) return null;
  let index = 0;
  const families = [];
  const escape = () => {
    index += 1;
    if (index >= value.length) throw Error("Incomplete CSS escape");
    const hex = /^[\da-f]{1,6}/iu.exec(value.slice(index));
    if (!hex) return value[index++];
    index += hex[0].length;
    if (index < value.length && space(value[index])) index += 1;
    const point = Number.parseInt(hex[0], 16);
    return String.fromCodePoint(point === 0 || point > 0x10ffff ||
      (point >= 0xd800 && point <= 0xdfff) ? 0xfffd : point);
  };
  try {
    while (index < value.length) {
      while (index < value.length && space(value[index])) index += 1;
      if (index === value.length) return null;
      const quote = ["\"", "'"].includes(value[index]) ? value[index++] : null;
      let name = "", closed = !quote, pendingSpace = false;
      while (index < value.length) {
        const character = value[index];
        if (quote && character === quote) { index += 1; closed = true; break; }
        if (!quote && character === ",") break;
        if (!quote && space(character)) { pendingSpace = name.length > 0; index += 1; continue; }
        if (pendingSpace) { name += " "; pendingSpace = false; }
        name += character === "\\" ? escape() : value[index++];
      }
      if (!closed || !name || /[\u0000-\u001f\u007f]/u.test(name) ||
          (!quote && wideKeywords.has(name.toLowerCase()))) return null;
      while (index < value.length && space(value[index])) index += 1;
      families.push({ name, generic: !quote && generics.has(name.toLowerCase()), quoted: Boolean(quote) });
      if (index === value.length) break;
      if (value[index++] !== "," || index === value.length) return null;
    }
    return families.length ? families : null;
  } catch { return null; }
}

/** New-page native creation has one literal SDK family, never a CSS fallback list. */
export function nativeDesignFontFamily(node) {
  if (node.type !== "text") return null;
  const families = parseDesignFontFamily(node.fontFamily ?? "Inter");
  const family = families?.[0];
  // Commas/quotes/generic-looking literal SDK names have no reversible admitted
  // canonical domain yet. Keep their canonical CSS bytes and refuse this export.
  if (families?.length !== 1 || family.generic || generics.has(family.name.toLowerCase()) ||
      family.name !== family.name.trim() || /[,"'\\]/u.test(family.name)) {
    const label = (typeof node.name === "string" ? node.name : typeof node.id === "string" ? node.id : "Text").slice(0, 120);
    const error = new Error(`文字 ${label} 的 CSS 字体列表或通用字体无法证明为单一 Figma 字体；请指定已验证的具体字体后重试。`);
    error.code = "NATIVE_CSS_FONT_FAMILY";
    throw error;
  }
  return family.name;
}

/** Supplemental validation for raw transfer files; no schema or SDK acceptance claim. */
export function assertNativeTransferFontFamilies(transfer) {
  const queue = [], pages = Array.isArray(transfer.pages) ? transfer.pages : [];
  let count = 0;
  const enqueue = (node, depth) => {
    if (++count > 50000 || depth > 32) throw Error("Figma 字体校验超出传输图层或深度上限。");
    queue.push({node,depth});
  };
  if (pages.length > 50000) throw Error("Figma 字体校验超出传输页面上限。");
  for (const page of pages) if (Array.isArray(page?.children))
    for (const node of page.children) enqueue(node, 0);
  while (queue.length) {
    const {node,depth} = queue.pop();
    if (!node || typeof node !== "object") continue;
    const family = nativeDesignFontFamily(node);
    if (family !== null && node.fontFamily !== undefined && family !== node.fontFamily) {
      const error = new Error("Figma 传输包的字体必须已经是具体的单一字族名；不能把 CSS 引号或转义作为 SDK 字体名。");
      error.code = "NATIVE_CSS_FONT_FAMILY";
      throw error;
    }
    if (Array.isArray(node.children)) for (const child of node.children) enqueue(child, depth+1);
  }
}
