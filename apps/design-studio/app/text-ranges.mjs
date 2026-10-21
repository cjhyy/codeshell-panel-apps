/** Content-bound paint/link ranges. This module never measures or fragments a scene Text. */
export const MAX_TEXT_RANGES = 64;
export const MAX_TEXT_RANGES_BYTES = 32 * 1024;
const MAX_TEXT = 4000;
const STYLE_KEYS = ["fill", "textDecoration", "textDecorationThickness", "textUnderlineOffset", "textDecorationSkipInk", "href"];
const plain = (value) => value !== null && typeof value === "object" &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = (message, code = "TEXT_RANGES_INVALID") => {
  const error = new Error(message); error.code = code; throw error;
};
const own = (value, key) => Object.hasOwn(value, key);
const exactKeys = (value, keys) => plain(value) && Object.keys(value).every((key) => keys.includes(key));
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const high = (unit) => unit >= 0xd800 && unit <= 0xdbff;
const low = (unit) => unit >= 0xdc00 && unit <= 0xdfff;
function validString(value) {
  if (typeof value !== "string" || value.length > MAX_TEXT) return false;
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (high(unit)) { if (!low(value.charCodeAt(++index))) return false; }
    else if (low(unit)) return false;
  }
  return true;
}
function boundary(source, index) {
  return Number.isInteger(index) && index >= 0 && index <= source.length &&
    !(index > 0 && index < source.length && high(source.charCodeAt(index - 1)) && low(source.charCodeAt(index)));
}
export function textRangeSourceSignature(sourceText) {
  if (!validString(sourceText)) fail("范围文字必须是最多4000个 UTF16 单元的完整 Unicode 字符串");
  return JSON.stringify([sourceText]);
}
const sourceOf = (node) => typeof node.textSource === "string" ? node.textSource : node.text;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const overrides = (range) => Object.fromEntries(STYLE_KEYS.filter((key) => own(range, key)).map((key) => [key, structuredClone(range[key])]));
function lengthValue(value, fontSize, thickness) {
  if (!exactKeys(value, ["unit", "value"])) fail("文字装饰长度包含未知字段");
  if (value.unit === "auto") {
    if (own(value, "value")) fail("auto 装饰长度不能包含数值");
    return { unit: "auto" };
  }
  const limit = value.unit === "em" ? 10 : value.unit === "px" ? 100 : NaN;
  const number = value.value, resolved = value.unit === "em" ? number * fontSize : number;
  if (!Number.isFinite(limit) || typeof number !== "number" || !Number.isFinite(number) ||
      Math.abs(number) > limit || (thickness && number <= 0) ||
      !Number.isFinite(resolved) || Math.abs(resolved) > 100)
    fail("文字装饰长度超出有限 px/em 范围");
  return { unit: value.unit, value: number };
}
export function isSafeTextRangeHref(value) {
  if (typeof value !== "string" || !value || value.length > 2048 ||
      /[\u0000-\u0020\u007f]/u.test(value[0]) || /[\u0000-\u0020\u007f]/u.test(value.at(-1)) ||
      /[\u0000-\u001f\u007f]/u.test(value) || !validString(value)) return false;
  if (value.startsWith("#")) return true;
  try { const url = new URL(value); return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol); }
  catch { return false; }
}
function normalizeStyle(value, fontSize) {
  if (!exactKeys(value, STYLE_KEYS)) fail("文字范围样式包含未知字段");
  const style = {};
  for (const key of STYLE_KEYS) {
    if (!own(value, key)) continue;
    const entry = value[key];
    if (key === "fill") {
      if (typeof entry !== "string" || !/^#[0-9a-f]{6}$/iu.test(entry)) fail("文字范围填色必须是不透明六位十六进制颜色");
      style.fill = entry.toLowerCase();
    } else if (key === "textDecoration") {
      if (!["none", "underline", "line-through"].includes(entry)) fail("文字范围装饰无效");
      style[key] = entry;
    } else if (key === "textDecorationThickness" || key === "textUnderlineOffset") {
      style[key] = lengthValue(entry, fontSize, key === "textDecorationThickness");
    } else if (key === "textDecorationSkipInk") {
      if (!["auto", "none"].includes(entry)) fail("文字范围 skip-ink 无效");
      style[key] = entry;
    } else {
      if (!isSafeTextRangeHref(entry)) fail("文字范围链接目标无效");
      style.href = entry;
    }
  }
  if (["textDecorationThickness", "textUnderlineOffset", "textDecorationSkipInk"].some((key) => own(style, key)) && style.textDecoration !== "underline")
    fail("范围下划线参数需要同一范围显式 underline");
  return style;
}
function coalesce(ranges) {
  const output = [];
  for (const range of ranges) {
    const style = overrides(range);
    if (!Object.keys(style).length) continue;
    const previous = output.at(-1);
    if (previous?.end === range.start && same(overrides(previous), style)) previous.end = range.end;
    else output.push({ start: range.start, end: range.end, ...style });
  }
  return output;
}
function payload(node) {
  if (node?.textRanges === undefined) return undefined;
  if (node.type !== "text") fail("textRanges 仅用于文字图层");
  const source = sourceOf(node), value = node.textRanges;
  if (!validString(source) || !validString(node.text)) fail("范围文字来源或显示内容无效");
  if (!exactKeys(value, ["version", "sourceSignature", "ranges"]) || value.version !== 1 ||
      typeof value.sourceSignature !== "string" || value.sourceSignature.length > 24004 ||
      !Array.isArray(value.ranges) || value.ranges.length > MAX_TEXT_RANGES || bytes(value) > MAX_TEXT_RANGES_BYTES)
    fail("textRanges 版本、字段或预算无效");
  if (value.sourceSignature !== textRangeSourceSignature(source))
    fail("textRanges 与当前完整文字来源签名不一致", "TEXT_RANGES_STALE");
  if (node.textOverflow !== undefined) fail("范围文字暂不支持截断", "TEXT_RANGES_UNSUPPORTED_TRUNCATION");
  let end = 0;
  const normalized = Array.from(value.ranges, (range, index) => {
    if (!exactKeys(range, ["start", "end", ...STYLE_KEYS]) ||
        !boundary(source, range.start) || !boundary(source, range.end) || range.start >= range.end ||
        (index > 0 && range.start < end)) fail("文字范围必须排序、不重叠并位于 UTF16 字符边界");
    end = range.end;
    return { start: range.start, end: range.end, ...normalizeStyle(overrides(range), node.fontSize) };
  });
  const result = { version: 1, sourceSignature: value.sourceSignature, ranges: coalesce(normalized) };
  if (bytes(result) > MAX_TEXT_RANGES_BYTES) fail("textRanges 超出字节预算");
  return result.ranges.length ? result : undefined;
}
function displayMap(node) {
  const sourceText = sourceOf(node), displayText = node.text;
  if (!validString(sourceText) || !validString(displayText)) fail("范围文字来源或显示内容无效");
  const segments = [];
  let source = 0, display = 0;
  while (display < displayText.length) {
    const text = String.fromCodePoint(displayText.codePointAt(display));
    if (sourceText.startsWith(text, source)) {
      const previous = segments.at(-1);
      if (previous?.kind === "source" && previous.sourceEnd === source && previous.displayEnd === display) {
        previous.sourceEnd += text.length; previous.displayEnd += text.length;
      } else segments.push({ kind: "source", sourceStart: source, sourceEnd: source + text.length, displayStart: display, displayEnd: display + text.length });
      source += text.length;
    } else if (text === "\n" && node.textFlow === "wrap") {
      segments.push({ kind: "soft-break", sourceOffset: source, displayStart: display, displayEnd: display + 1 });
    } else fail("范围显示文字必须保留每个来源字符；仅允许添加软换行", "TEXT_RANGES_DISPLAY_MISMATCH");
    display += text.length;
  }
  if (source !== sourceText.length) fail("范围显示文字丢失来源字符", "TEXT_RANGES_DISPLAY_MISMATCH");
  return { sourceText, displayText, sourceSignature: textRangeSourceSignature(sourceText), segments };
}
export function validateTextRanges(node) {
  const normalized = payload(node);
  if (node?.textRanges !== undefined) displayMap(node);
  return normalized;
}
export function mapTextDisplay(node) {
  payload(node);
  return displayMap(node);
}
export function projectTextRanges(node, suppliedMap) {
  const ranges = validateTextRanges(node)?.ranges ?? [];
  const map = mapTextDisplay(node);
  if (suppliedMap && !same(suppliedMap, map)) fail("显示映射不属于当前文字", "TEXT_RANGES_STALE");
  const result = [];
  let lineIndex = 0;
  for (const segment of map.segments) {
    if (segment.kind === "soft-break") {
      result.push({ ...segment, text: "\n", lineIndex }); lineIndex++; continue;
    }
    let source = segment.sourceStart;
    while (source < segment.sourceEnd) {
      const range = ranges.find((entry) => entry.start <= source && source < entry.end);
      const next = ranges.find((entry) => entry.start > source);
      const newline = map.sourceText.indexOf("\n", source);
      const sourceEnd = Math.min(segment.sourceEnd, range?.end ?? next?.start ?? segment.sourceEnd,
        newline >= source ? newline === source ? source + 1 : newline : segment.sourceEnd);
      const displayStart = segment.displayStart + source - segment.sourceStart;
      const text = map.sourceText.slice(source, sourceEnd), present = range ? overrides(range) : {};
      const style = { fill: node.fill, textDecoration: node.textDecoration ?? "none", ...present };
      delete style.href;
      if (style.textDecoration === "underline" && style.textDecorationSkipInk === undefined) style.textDecorationSkipInk = "auto";
      result.push({ kind: "source", sourceStart: source, sourceEnd, displayStart, displayEnd: displayStart + text.length,
        text, lineIndex, overrides: present, style, ...(present.href !== undefined ? { href: present.href } : {}) });
      if (text === "\n") lineIndex++;
      source = sourceEnd;
    }
  }
  return result;
}
function editBounds(node, edit, allowEmpty = true) {
  validateTextRanges(node);
  const source = sourceOf(node);
  if (node?.type !== "text" || !validString(source) || !boundary(source, edit.start) || !boundary(source, edit.end) ||
      edit.start > edit.end || (!allowEmpty && edit.start === edit.end)) fail("文字编辑范围无效");
  if (edit.expectedSourceSignature !== textRangeSourceSignature(source)) fail("文字编辑来源已变化", "TEXT_RANGES_STALE");
  return source;
}
function editedNode(node, source, ranges) {
  const next = structuredClone(node);
  next.text = source;
  if (own(node, "textSource") || node.textFlow === "wrap") next.textSource = source;
  delete next.textMetrics; delete next.textMeasurement; delete next.textFlowWidth;
  if (!source.trim()) { delete next.textFlow; delete next.textOverflow; }
  const normalized = coalesce(ranges);
  if (normalized.length) next.textRanges = { version: 1, sourceSignature: textRangeSourceSignature(source), ranges: normalized };
  else delete next.textRanges;
  validateTextRanges(next);
  return next;
}
export function replaceTextRange(node, edit) {
  if (!exactKeys(edit, ["start", "end", "text", "affinity", "expectedSourceSignature"])) fail("文字编辑包含未知字段");
  const source = editBounds(node, edit);
  if (!validString(edit.text) || (edit.text.length && !["before", "after", "none"].includes(edit.affinity)) ||
      (edit.affinity !== undefined && !["before", "after", "none"].includes(edit.affinity))) fail("文字编辑内容或插入亲和性无效");
  const text = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  if (!validString(text)) fail("编辑后文字超出4000个 UTF16 单元");
  const ranges = validateTextRanges(node)?.ranges ?? [], delta = edit.text.length - (edit.end - edit.start), output = [];
  const position = edit.affinity === "none" ? -1 : edit.affinity === "before"
    ? edit.start > 0 ? edit.start - 1 : edit.start
    : edit.start < source.length ? edit.start : source.length - 1;
  const inherited = ranges.find((range) => range.start <= position && position < range.end);
  for (const range of ranges) {
    if (range.start < edit.start) output.push({ ...range, end: Math.min(range.end, edit.start) });
    if (range.end > edit.end) output.push({ ...range, start: Math.max(range.start, edit.end) + delta, end: range.end + delta });
  }
  if (edit.text && inherited) output.push({ start: edit.start, end: edit.start + edit.text.length, ...overrides(inherited) });
  output.sort((left, right) => left.start - right.start);
  return editedNode(node, text, output);
}
export function setTextRangeStyle(node, edit) {
  if (!exactKeys(edit, ["start", "end", "style", "expectedSourceSignature"]) || !exactKeys(edit.style, STYLE_KEYS)) fail("文字范围样式编辑无效");
  const source = editBounds(node, edit, false), ranges = validateTextRanges(node)?.ranges ?? [];
  const points = [...new Set([0, source.length, edit.start, edit.end, ...ranges.flatMap((range) => [range.start, range.end])])].sort((a, b) => a - b);
  const output = [];
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1], end = points[index], range = ranges.find((entry) => entry.start <= start && start < entry.end);
    const style = range ? overrides(range) : {};
    if (start >= edit.start && end <= edit.end) {
      for (const [key, value] of Object.entries(edit.style)) {
        if (value === null) delete style[key]; else style[key] = structuredClone(value);
      }
      if (own(edit.style, "textDecoration") && edit.style.textDecoration !== "underline") {
        for (const key of ["textDecorationThickness", "textUnderlineOffset", "textDecorationSkipInk"]) {
          if (edit.style[key] !== undefined && edit.style[key] !== null) fail("非下划线样式不能同时指定下划线参数");
          delete style[key];
        }
      }
    }
    if (Object.keys(style).length) output.push({ start, end, ...normalizeStyle(style, node.fontSize) });
  }
  // Style-only edits preserve display bytes and font measurement receipts.
  const result = structuredClone(node), normalized = coalesce(output);
  if (normalized.length) result.textRanges = { version: 1, sourceSignature: textRangeSourceSignature(source), ranges: normalized };
  else delete result.textRanges;
  validateTextRanges(result);
  return result;
}
