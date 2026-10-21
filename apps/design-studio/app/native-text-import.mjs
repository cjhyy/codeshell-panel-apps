/** Pure admission of complete native observations; no metadata authorizes writes. */
import { NATIVE_TEXT_RANGE_FIELDS, NATIVE_TEXT_RANGE_SCALAR_ONLY_FIELDS,
  MAX_NATIVE_TEXT_RANGE_SOURCE_BYTES, validateNativeTextRangeSource,
  importNativeTextRanges } from "./native-text-ranges-source.mjs";
import { restoreNativeTextRangeHint } from "./native-text-range-hint.mjs";
import { nativeTextRangePlan } from "./native-text-range-plan.mjs";
import { nativeTextLineHeight, validTextLineHeight } from "./text-line-height.mjs";

export const NATIVE_TEXT_IMPORT_HINT_KEY = "codeshellTextRangeIntent";
export const NATIVE_TEXT_SUPPLEMENT_KEY = "nativeTextRanges";
export const NATIVE_TEXT_RESERVED_RAW_KEYS = Object.freeze([
  "codeshellNativeTextRanges", "codeshellNativeTextRangeHint", "codeshellTextRangeIntent", NATIVE_TEXT_SUPPLEMENT_KEY,
]);
// Raw SDK names are literal. The current canonical renderer parses a CSS
// family list, strips quote pairs and recognizes these unquoted generics.
// Refuse the ambiguous native subset instead of aliasing its face.
const genericFamilies = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong"]);
const getters = ["textDecoration", "textDecorationStyle", "textDecorationOffset",
  "textDecorationThickness", "textDecorationColor", "textDecorationSkipInk", "hyperlink"];
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length &&
  keys.every(key => own(value, key));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const value = (record, key) => {
  if (record[key]?.kind !== "value") throw Error("Native " + key + " is not a complete supported value");
  return record[key].value;
};
const utf8 = text => {
  let bytes = 0;
  for (const scalar of text) {
    const code = scalar.codePointAt(0);
    bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
  }
  return bytes;
};

function ownedData(value, limit, state = { bytes: 0, steps: 0, seen: new Set() }, depth = 0,
  limits = { steps: 100000, depth: 20, keys: 8192 }) {
  const charge = text => { if ((state.bytes += utf8(text)) > limit) throw Error("Owned native data exceeds its complete byte budget"); };
  if (++state.steps > limits.steps || depth > limits.depth) throw Error("Owned native data exceeds its structural budget");
  if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) {
    charge(JSON.stringify(value)); return value;
  }
  if (typeof value === "string") { charge(JSON.stringify(value)); return value; }
  const array = Array.isArray(value);
  if ((!array && !plain(value)) || state.seen.has(value)) throw Error("Native import requires acyclic owned JSON");
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  const length = array ? descriptors.length?.value : undefined, names = array ? keys.filter(key => key !== "length") : keys;
  if (keys.some(key => typeof key !== "string") || names.length > limits.keys ||
      array && (!Number.isInteger(length) || names.length !== length || names.some((key, index) => key !== String(index))))
    throw Error("Native import requires dense bounded JSON");
  state.seen.add(value); charge(array ? "[" : "{");
  const result = array ? [] : {};
  for (const [index, key] of names.entries()) {
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, "value") || !descriptor.enumerable) throw Error("Native import refuses accessors and hidden fields");
    charge((index ? "," : "") + (array ? "" : JSON.stringify(key) + ":"));
    Object.defineProperty(result, key, { value: ownedData(descriptor.value, limit, state, depth + 1, limits),
      enumerable: true, configurable: true, writable: true });
  }
  charge(array ? "]" : "}"); state.seen.delete(value);
  return result;
}
/** Descriptor-owned clone for the entire supplemental source envelope. */
export function copyNativeTextEnvelope(input) {
  return ownedData(input, 16 * 1024 * 1024, undefined, 0,
    { steps: 1000000, depth: 128, keys: 1000000 });
}
const intentFields = ["type", "textSource", "textFlow", "textOverflow", "fill", "fillPaints",
  "textDecoration", "textDecorationThickness", "textUnderlineOffset", "textDecorationSkipInk", "textRanges",
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "lineHeightUnit", "letterSpacing", "textAlign"];
/** Immutable semantic postcondition; display wrapping and measured geometry may change. */
export function nativeTextImportIntentSnapshot(node) {
  if (!plain(node)) throw Error("Native Text intent requires owned data");
  const descriptors = Object.getOwnPropertyDescriptors(node), projected = {};
  for (const key of intentFields) {
    const descriptor = descriptors[key];
    if (!descriptor) continue;
    if (!own(descriptor, "value") || !descriptor.enumerable) throw Error("Native Text intent accessor refused");
    // Canonical optional undefined fields normalize to absence.
    if (descriptor.value !== undefined) projected[key] = descriptor.value;
  }
  const copied = ownedData(projected, MAX_NATIVE_TEXT_RANGE_SOURCE_BYTES);
  const ordered = value => Array.isArray(value) ? value.map(ordered) : plain(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
  return JSON.stringify(ordered(copied));
}
function argument(input, key) {
  if (!plain(input)) throw Error("Native import arguments must be an owned record");
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (!descriptor) return undefined;
  if (!Object.hasOwn(descriptor, "value") || !descriptor.enumerable) throw Error("Native import argument accessor refused");
  return descriptor.value;
}

/** A bound partial codec source is not a production capture. Kinds stay raw. */
export function completeNativeTextSource(source) {
  return plain(source) && exactKeys(source.scalars, [...NATIVE_TEXT_RANGE_FIELDS, ...NATIVE_TEXT_RANGE_SCALAR_ONLY_FIELDS]) &&
    Array.isArray(source.segments) && Array.isArray(source.rangeChecks) &&
    source.segments.every(segment => exactKeys(segment.values, NATIVE_TEXT_RANGE_FIELDS)) &&
    source.rangeChecks.length === source.segments.length && source.rangeChecks.every((check, index) =>
      check.start === source.segments[index].start && check.end === source.segments[index].end &&
      exactKeys(check.values, getters));
}

export function hasReservedNativeTextMetadata(rest) {
  return NATIVE_TEXT_RESERVED_RAW_KEYS.some(key => own(rest, key));
}

/** No public supplemental marker can suppress a mask, paint or ancestor cause. */
export function nativeTextOwnMixedPreview(rest, source) {
  if (rest.type !== "TEXT" || rest.isMask === true ||
      rest.children !== undefined && (!Array.isArray(rest.children) || rest.children.length) ||
      ![undefined, "NORMAL", "PASS_THROUGH"].includes(rest.blendMode) ||
      !Array.isArray(rest.fills) || rest.fills.filter(paint => paint.visible !== false).length > 1 ||
      rest.fills.some(paint => paint.visible !== false && paint.type !== "SOLID") ||
      rest.strokes !== undefined && (!Array.isArray(rest.strokes) || rest.strokes.some(paint => paint.visible !== false)) ||
      rest.effects !== undefined && (!Array.isArray(rest.effects) || rest.effects.some(effect => effect.visible !== false)))
    return false;
  return source.scalars.fills.kind === "mixed" &&
    source.scalars.fontName.kind === "value" && source.scalars.fontSize.kind === "value";
}

/**
 * Project one uniform SDK metric set. A ratio is a unit conversion of the
 * observed native value; REST measured pixels and authored hints never supply it.
 */
export function admitNativeTextImport(input) {
  const diagnostics = [];
  const refused = message => ({ status: "unsupported", diagnostics: [...diagnostics,
    { code: "NATIVE_TEXT_IMPORT_UNSUPPORTED", message }], pixelsVerified: false });
  try {
    let rest = argument(input, "rest"), source = argument(input, "source");
    const copied = source === undefined ? null : ownedData({ rest, source }, MAX_NATIVE_TEXT_RANGE_SOURCE_BYTES);
    if (copied) ({ rest, source } = copied);
    if (!plain(rest) || source === undefined || hasReservedNativeTextMetadata(rest))
      return refused("A fresh explicit supplemental source without raw collisions is required");
    if (rest.children !== undefined && (!Array.isArray(rest.children) || rest.children.length))
      return refused("A native Text must be a leaf");
    const checked = validateNativeTextRangeSource(rest, source);
    diagnostics.push(...checked.diagnostics);
    if (checked.status !== "bound" || !completeNativeTextSource(checked.source))
      return refused("The native source is stale, invalid or incomplete");
    const live = checked.source, segments = live.segments, first = segments[0]?.values;
    if (!first) return refused("A nonempty complete metric segment is required");
    const metricFields = ["fontName", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing"];
    for (const key of metricFields) {
      const observed = value(first, key);
      if (!segments.every(segment => same(value(segment.values, key), observed)))
        return refused("Native metric variants cannot become paint/link ranges");
      // SDK Text lacks scalar fontStyle on the retained actual source. Its
      // explicit missing observation is retained; complete segments supply it.
      if (key !== "fontStyle" && !same(value(live.scalars, key), observed))
        return refused("Scalar and complete segment metrics disagree");
      if (key === "fontStyle" && live.scalars[key].kind === "value" && !same(value(live.scalars, key), observed))
        return refused("Scalar and complete segment fontStyle disagree");
    }
    const font = value(first, "fontName"), size = value(first, "fontSize"), weight = value(first, "fontWeight"),
      style = value(first, "fontStyle"), line = value(first, "lineHeight"), spacing = value(first, "letterSpacing");
    if (!plain(font) || typeof font.family !== "string" || !font.family.length ||
        font.family !== font.family.trim() || font.family.length > 120 || /[\u0000-\u001f\u007f,"'\\]/u.test(font.family) ||
        genericFamilies.has(font.family.toLowerCase()) ||
        !Number.isFinite(size) || size < 6 || size > 240 ||
        ![100,200,300,400,500,600,700,800,900].includes(weight) ||
        !["REGULAR", "ITALIC"].includes(style) ||
        !["Regular", "Bold", "Italic", "Bold Italic"].includes(font.style) ||
        (["Italic", "Bold Italic"].includes(font.style) ? "ITALIC" : "REGULAR") !== style ||
        font.variationSettings?.wght !== weight &&
          (["Bold", "Bold Italic"].includes(font.style) ? 700 : 400) !== weight)
      return refused("Native font metrics are outside the canonical uniform subset");
    const patch = { text: live.characters, textSource: live.characters, fontFamily: font.family,
      fontSize: size, fontWeight: weight, fontStyle: style === "ITALIC" ? "italic" : "normal",
      fill: "#000000", textDecoration: "none" };
    if (!plain(line) || !Number.isFinite(line.value)) return refused("Native line height is not explicit");
    if (line.unit === "PIXELS") Object.assign(patch, { lineHeight: line.value, lineHeightUnit: "pixels" });
    else if (line.unit === "PERCENT") patch.lineHeight = line.value / 100;
    else return refused("Native automatic or unknown line-height units require a separate model");
    if (!validTextLineHeight(patch) || nativeTextLineHeight(patch).unit !== line.unit ||
        nativeTextLineHeight(patch).value !== line.value)
      return refused("Native line height has no exact in-envelope canonical unit conversion");
    if (!plain(spacing) || !Number.isFinite(spacing.value) ||
        !(spacing.unit === "PIXELS" || spacing.unit === "PERCENT" && spacing.value === 0) ||
        spacing.value < -20 || spacing.value > 100)
      return refused("Native letter spacing is unsupported");
    patch.letterSpacing = spacing.value;
    const align = { LEFT: "left", CENTER: "center", RIGHT: "right" }[value(live.scalars, "textAlignHorizontal")];
    if (!align) return refused("Native horizontal alignment is unsupported");
    patch.textAlign = align;
    const resize = value(live.scalars, "textAutoResize");
    if (!["NONE", "HEIGHT", "WIDTH_AND_HEIGHT"].includes(resize)) return refused("Native text resize mode is unsupported");
    if (live.characters.length && resize !== "WIDTH_AND_HEIGHT") patch.textFlow = "wrap";
    const canonical = { type: "text", ...patch };
    const admitted = importNativeTextRanges({ rest, source: live, canonicalNode: canonical });
    diagnostics.push(...admitted.diagnostics);
    if (!["uniform", "admitted-intent"].includes(admitted.status))
      return refused("The complete native paint/link/decoration context is unsupported");
    if (admitted.textRanges) patch.textRanges = admitted.textRanges;
    let paintLinkOnly = false;
    try { nativeTextRangePlan({ type: "text", ...patch }); paintLinkOnly = true; }
    catch { /* Canonical intent is distinct from native create eligibility. */ }
    let hint, pluginId;
    try {
      hint = argument(input, "hint"); pluginId = argument(input, "pluginId");
      if (hint !== undefined) hint = ownedData(hint, 64 * 1024);
    } catch {
      diagnostics.push({ code: "NATIVE_TEXT_IMPORT_HINT_INVALID", message: "Author hint data was refused; independently admitted native intent retained" });
      hint = undefined;
    }
    if (hint !== undefined) {
      if (typeof pluginId !== "string" || !pluginId)
        diagnostics.push({ code: "NATIVE_TEXT_IMPORT_HINT_UNAVAILABLE", message: "Actual pluginId is unavailable; native intent retained" });
      else try {
        Object.assign(patch, restoreNativeTextRangeHint({ rest, source: live,
          canonicalNode: { type: "text", ...patch }, hint, pluginId, key: NATIVE_TEXT_IMPORT_HINT_KEY }));
      } catch (error) {
        diagnostics.push({ code: error.code ?? "NATIVE_TEXT_IMPORT_HINT_INVALID",
          message: "Author hint was refused; independently admitted native intent retained" });
      }
    }
    return { status: admitted.status, patch, paintLinkOnly,
      ownMixedPreview: paintLinkOnly && nativeTextOwnMixedPreview(rest, live),
      diagnostics, pixelsVerified: false };
  } catch (error) { return refused(error.message); }
}

/** The complete outer normalizer owns the16MiB cap; no entry is truncated. */
export function normalizeNativeTextSupplement(input) {
  if (input === undefined) return undefined;
  if (!plain(input) || input.version !== 1 || !plain(input.nodes) ||
      Object.keys(input).some(key => !["version", "pluginId", "nodes"].includes(key)) ||
      input.pluginId !== undefined && (typeof input.pluginId !== "string" || input.pluginId.length > 100000) ||
      Object.keys(input.nodes).length > 10000)
    throw Object.assign(Error("Native Text supplemental envelope is invalid"), { code: "NATIVE_TEXT_IMPORT_TABLE" });
  for (const [id, entry] of Object.entries(input.nodes)) {
    if (!id || id.length > 160 || !plain(entry) || !own(entry, "source") || !plain(entry.source) ||
        Object.keys(entry).some(key => !["source", "hint"].includes(key)))
      throw Object.assign(Error("Native Text supplemental entry is invalid"), { code: "NATIVE_TEXT_IMPORT_TABLE" });
  }
  // normalizeFigmaSource has already JSON-owned the complete envelope. Keep
  // unknown observation values and malformed hints for independent refusal.
  return input;
}
