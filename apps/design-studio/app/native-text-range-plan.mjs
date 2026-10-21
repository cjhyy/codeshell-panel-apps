import { MAX_TEXT_RANGES, isSafeTextRangeHref, mapTextDisplay, validateTextRanges } from "./text-ranges.mjs";

export const MAX_NATIVE_TEXT_RANGE_RUNS = MAX_TEXT_RANGES * 2 + 1;
const geometry = ["textDecorationThickness", "textUnderlineOffset", "textDecorationSkipInk"];
const own = (value, key) => Object.hasOwn(value, key);
const failures = new WeakSet();
const fail = (code, message) => { const error = new Error(message); error.code = code; failures.add(error); throw error; };
const invalidSource = "Native range planning requires a valid complete content-bound Text source.";
const sourceErrors = new Set([
  "TEXT_RANGES_INVALID", "TEXT_RANGES_STALE", "TEXT_RANGES_DISPLAY_MISMATCH",
  "TEXT_RANGES_UNSUPPORTED_TRUNCATION", "TEXT_RANGES_UNSUPPORTED_BASE_PAINT",
]);
const fields = [
  "type", "text", "textSource", "textFlow", "textRanges", "fill", "fillPaints",
  "textDecoration", ...geometry, "textOverflow", "fontSize",
];

// The shared canonical validator receives owned data, never foreign accessors
// or a toJSON method. A scene node's unrelated geometry/metadata is not copied.
function contentSnapshot(input) {
  const invalid = () => fail("TEXT_RANGES_NATIVE_INVALID_SOURCE", invalidSource);
  const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
  if (!plain(input))
    fail("TEXT_RANGES_NATIVE_INVALID_NODE", "Native range planning requires a canonical Text node.");
  let steps = 0, bytes = 0;
  const count = value => {
    // Primitive strings only: this cannot invoke a foreign serialization hook.
    for (const character of JSON.stringify(value)) {
      const code = character.codePointAt(0);
      bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    }
    // Two complete 4000-unit strings can each escape to 24 KiB, in
    // addition to the independently bounded 32 KiB range payload.
    if (bytes > 96 * 1024) invalid();
  };
  const copy = (value, seen = new Set(), depth = 0) => {
    if (++steps > 2048 || depth > 8) invalid();
    if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) {
      count(value); return value;
    }
    if (typeof value === "string") {
      if (value.length > 32768) invalid();
      count(value); return value;
    }
    const array = Array.isArray(value);
    if ((!array && !plain(value)) || seen.has(value)) invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    const length = array ? descriptors.length?.value : undefined;
    if (keys.some(key => typeof key !== "string") || array && (!Number.isInteger(length) || length > 64)) invalid();
    const dataKeys = array ? keys.filter(key => key !== "length") : keys;
    if (dataKeys.length > 16 && !array || array && (dataKeys.length !== length || dataKeys.some((key, index) => key !== String(index))))
      invalid();
    seen.add(value);
    const result = array ? [] : {};
    for (const key of dataKeys) {
      const descriptor = descriptors[key];
      if (!own(descriptor, "value") || !descriptor.enumerable) invalid();
      count(key);
      Object.defineProperty(result, key, { value: copy(descriptor.value, seen, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    seen.delete(value);
    return result;
  };
  const descriptors = Object.getOwnPropertyDescriptors(input), snapshot = {};
  for (const key of fields) {
    if (!own(descriptors, key)) continue;
    const descriptor = descriptors[key];
    if (!own(descriptor, "value") || !descriptor.enumerable) invalid();
    // These are rejected by presence/value; do not traverse an unsupported
    // arbitrary paint stack just to report its known applicability failure.
    if (geometry.includes(key))
      fail("TEXT_RANGES_NATIVE_UNSUPPORTED_DECORATION", "Native range planning currently supports no text decoration or CSS underline geometry.");
    if (key === "fillPaints" && descriptor.value !== undefined)
      fail("TEXT_RANGES_NATIVE_UNSUPPORTED_PAINT", "Native text range planning supports one opaque hex base fill only.");
    if (descriptor.value !== undefined) snapshot[key] = copy(descriptor.value);
  }
  return snapshot;
}

function sourcePlan(node) {
  try {
    return { ranges: validateTextRanges(node)?.ranges ?? [], characters: mapTextDisplay(node).sourceText };
  } catch (error) {
    let code;
    try { code = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "code")?.value : undefined; }
    catch { /* Foreign failures never supply the planner's diagnostic text. */ }
    fail(sourceErrors.has(code) ? code : "TEXT_RANGES_NATIVE_INVALID_SOURCE", invalidSource);
  }
}

function nativeHyperlink(value) {
  const unsupported = () => fail("TEXT_RANGES_NATIVE_UNSUPPORTED_LINK",
    "Native range links support conservative absolute HTTP(S) URLs and bare ASCII mailto addresses only.");
  if (!isSafeTextRangeHref(value)) unsupported();
  if (/^https?:\/\//iu.test(value)) {
    // Exclude bracket/IDN/backslash normalization and malformed DNS/IPv4
    // authorities without depending on a browser URL implementation.
    const authority = /^https?:\/\/([^/?#]+)/iu.exec(value)[1];
    const host = authority.replace(/:[0-9]+$/u, "");
    const labels = host.split(".");
    if (host.length > 253 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(label)))
      unsupported();
    if (/^(?:[0-9]+|0x[0-9a-f]*)$/iu.test(labels.at(-1)) &&
        !(labels.length === 4 && labels.every(label => /^(?:0|[1-9][0-9]{0,2})$/u.test(label) && Number(label) <= 255)))
      unsupported();
    return { type: "URL", value };
  }
  const mail = /^mailto:([a-z0-9_+.-]{1,64})@([a-z0-9.-]{1,253})$/iu.exec(value);
  if (!mail || mail[1].startsWith(".") || mail[1].endsWith(".") || mail[1].includes("..") ||
      mail[2].split(".").length < 2 ||
      mail[2].split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(label)))
    unsupported();
  return { type: "URL", value };
}

/**
 * Pure staged plan for ONE native Text; source indices never refer to soft LF.
 * Runtime consumers must validate creation/patch applicability independently.
 * This validates content and range paint applicability, not the full node schema.
 */
function plan(node) {
  if (!node || typeof node !== "object" || Array.isArray(node) || node.type !== "text")
    fail("TEXT_RANGES_NATIVE_INVALID_NODE", "Native range planning requires a canonical Text node.");
  if (node.textSource !== undefined && typeof node.textSource !== "string")
    fail("TEXT_RANGES_NATIVE_INVALID_SOURCE", invalidSource);
  if (typeof node.fill !== "string" || !/^#[0-9a-f]{6}$/iu.test(node.fill) || node.fillPaints !== undefined)
    fail("TEXT_RANGES_NATIVE_UNSUPPORTED_PAINT", "Native text range planning supports one opaque hex base fill only.");
  if ((node.textDecoration !== undefined && node.textDecoration !== "none") || geometry.some(key => own(node, key)))
    fail("TEXT_RANGES_NATIVE_UNSUPPORTED_DECORATION", "Native range planning currently supports no text decoration or CSS underline geometry.");
  if (node.textOverflow !== undefined)
    fail("TEXT_RANGES_UNSUPPORTED_TRUNCATION", "Native range planning does not support truncated text.");
  const { characters, ranges } = sourcePlan(node);
  const fill = node.fill.toLowerCase();
  const runs = [];
  let cursor = 0;
  for (const range of ranges) {
    if ((range.textDecoration !== undefined && range.textDecoration !== "none") || geometry.some(key => own(range, key)))
      fail("TEXT_RANGES_NATIVE_UNSUPPORTED_DECORATION", "Native range planning currently supports no text decoration or CSS underline geometry.");
    if (cursor < range.start)
      runs.push({ start: cursor, end: range.start, fill, hyperlink: null });
    runs.push({ start: range.start, end: range.end, fill: range.fill ?? fill,
      hyperlink: range.href === undefined ? null : nativeHyperlink(range.href) });
    cursor = range.end;
  }
  if (cursor < characters.length)
    runs.push({ start: cursor, end: characters.length, fill, hyperlink: null });
  return { characters, runs };
}

export function nativeTextRangePlan(node) {
  try { return plan(contentSnapshot(node)); }
  catch (error) {
    if (error !== null && typeof error === "object" && failures.has(error)) throw error;
    fail("TEXT_RANGES_NATIVE_INVALID_SOURCE", invalidSource);
  }
}
