/** Read-only native text evidence. No SDK, DOM, mutation, or CSS/native underline conversion. */
import { textRangeSourceSignature, validateTextRanges, isSafeTextRangeHref } from "./text-ranges.mjs";

export const MAX_NATIVE_TEXT_RANGE_SOURCE_BYTES = 256 * 1024;
export const MAX_NATIVE_TEXT_RANGE_SEGMENTS = 256;
export const MAX_NATIVE_TEXT_RANGE_CHECKS = 256;
export const NATIVE_TEXT_RANGE_FIELDS = Object.freeze([
  "fontName", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "fills",
  "textDecoration", "textDecorationStyle", "textDecorationOffset", "textDecorationThickness",
  "textDecorationColor", "textDecorationSkipInk", "hyperlink", "textCase", "openTypeFeatures",
  "textStyleId", "fillStyleId", "listOptions", "listSpacing", "indentation", "paragraphIndent", "paragraphSpacing",
  "textStyleOverrides", "boundVariables", "textWrapStyle",
]);
export const NATIVE_TEXT_RANGE_SCALAR_ONLY_FIELDS = Object.freeze([
  "hasMissingFont", "textTruncation", "maxLines", "leadingTrim", "hangingPunctuation", "hangingList",
  "textAlignHorizontal", "textAlignVertical", "textAutoResize", "layoutSizingHorizontal", "layoutSizingVertical",
]);
const REST_KEYS = ["id", "type", "characters", "style", "characterStyleOverrides", "styleOverrideTable",
  "fills", "lineTypes", "lineIndentations", "textTruncation", "maxLines", "textAutoResize",
  "layoutSizingHorizontal", "layoutSizingVertical", "hasMissingFont", "leadingTrim", "hangingPunctuation", "hangingList"];
const own = (value, key) => Object.hasOwn(value, key);
const defaulted = (value, key, fallback) => own(value, key) ? value[key] : fallback;
const plain = value => value !== null && typeof value === "object" &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const issue = (code, message, extra = {}) => ({ code, message, ...extra });
const fail = (message, code = "NATIVE_TEXT_RANGES_INVALID") => {
  const error = new Error(message); error.code = code; throw error;
};
const keys = (value, allowed) => plain(value) && Object.keys(value).every(key => allowed.includes(key));
const same = (a, b) => stable(a) === stable(b);
function utf8(text) {
  let result = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    result += unit < 128 ? 1 : unit < 2048 ? 2 : unit >= 0xd800 && unit <= 0xdbff &&
      text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff ? (i++, 4) : 3;
  }
  return result;
}
function clone(value, state = { size: 0, seen: new Set() }, depth = 0) {
  if (depth > 12) fail("Native text source exceeds depth12", "NATIVE_TEXT_RANGES_BUDGET");
  const add = size => { if ((state.size += size) > MAX_NATIVE_TEXT_RANGE_SOURCE_BYTES)
    fail("Native text source exceeds256KiB", "NATIVE_TEXT_RANGES_BUDGET"); };
  if (value === null || typeof value === "boolean") { add(value === null ? 4 : value ? 4 : 5); return value; }
  if (typeof value === "string") { add(utf8(JSON.stringify(value))); return value; }
  if (typeof value === "number" && Number.isFinite(value)) { add(String(value).length); return value; }
  if (!Array.isArray(value) && !plain(value) || state.seen.has(value)) fail("Native text source must be acyclic plain JSON");
  state.seen.add(value); add(2);
  if (Array.isArray(value) && value.length * 2 + 1 > MAX_NATIVE_TEXT_RANGE_SOURCE_BYTES)
    fail("Native array exceeds minimum JSON byte budget", "NATIVE_TEXT_RANGES_BUDGET");
  const descriptors = Object.getOwnPropertyDescriptors(value), result = [];
  if (Reflect.ownKeys(value).some(key => typeof key !== "string")) fail("Native text source contains symbol keys");
  if (Array.isArray(value) && value.length > MAX_NATIVE_TEXT_RANGE_SOURCE_BYTES) fail("Native array exceeds budget", "NATIVE_TEXT_RANGES_BUDGET");
  const names = Array.isArray(value) ? Array.from({ length: value.length }, (_, i) => String(i)) : Object.keys(descriptors);
  if (Array.isArray(value)) {
    const indices = new Set(names);
    if (Object.keys(descriptors).some(key => key !== "length" && !indices.has(key))) fail("Native text source array is not JSON");
  }
  for (const key of names) {
    const descriptor = descriptors[key];
    if (!descriptor || !own(descriptor, "value") || !descriptor.enumerable) fail("Native text source contains holes or accessors");
    add((Array.isArray(value) ? 0 : utf8(JSON.stringify(key)) + 1) + (result.length ? 1 : 0));
    result.push([key, clone(descriptor.value, state, depth + 1)]);
  }
  state.seen.delete(value);
  return Array.isArray(value) ? result.map(entry => entry[1]) : Object.fromEntries(result);
}
function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return Array.isArray(value) ? `[${value.map(stable).join(",")}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
}
function binding(rest) {
  if (!plain(rest)) fail("Native source must be plain JSON");
  if (["type", "id", "characters"].some(key => { const d = Object.getOwnPropertyDescriptor(rest, key); return d && !own(d, "value"); })) fail("REST source contains accessors");
  if (rest.type !== "TEXT" || typeof rest.id !== "string" || !rest.id || rest.id.length > 160)
    fail("Native source is not an identified TEXT");
  const descriptors = Object.getOwnPropertyDescriptors(rest);
  if (REST_KEYS.some(key => own(descriptors, key) && !own(descriptors[key], "value"))) fail("REST source contains accessors");
  textRangeSourceSignature(rest.characters);
  return stable(clone(Object.fromEntries(REST_KEYS.filter(key => own(rest, key)).map(key => [key, rest[key]]))));
}
function observation(value) {
  if (!plain(value)) fail("Native observation must have an explicit kind");
  if (value.kind === "value" && keys(value, ["kind", "value"]) && own(value, "value")) return;
  if (["mixed", "missing"].includes(value.kind) && keys(value, ["kind"])) return;
  if (value.kind === "error" && keys(value, ["kind", "message"]) && typeof value.message === "string" && value.message.length <= 2000) return;
  fail("Malformed native observation");
}
function values(input, scalar = false) {
  if (!keys(input, scalar ? [...NATIVE_TEXT_RANGE_FIELDS, ...NATIVE_TEXT_RANGE_SCALAR_ONLY_FIELDS] : NATIVE_TEXT_RANGE_FIELDS)) fail("Unknown native observation field");
  for (const value of Object.values(input)) observation(value);
}
const boundary = (text, index) => Number.isInteger(index) && index >= 0 && index <= text.length &&
  !(index > 0 && index < text.length && /[\ud800-\udbff]/u.test(text[index - 1]) && /[\udc00-\udfff]/u.test(text[index]));
function shape(source) {
  if (!keys(source, ["version", "nodeId", "characters", "restSignature", "scalars", "segments", "rangeChecks"]) ||
      source.version !== 1 || typeof source.nodeId !== "string" || typeof source.restSignature !== "string") fail("Malformed native text source version");
  textRangeSourceSignature(source.characters); values(source.scalars, true);
  if (!Array.isArray(source.segments) || source.segments.length > MAX_NATIVE_TEXT_RANGE_SEGMENTS ||
      !Array.isArray(source.rangeChecks) || source.rangeChecks.length > MAX_NATIVE_TEXT_RANGE_CHECKS)
    fail("Native text source exceeds segment/check budget", "NATIVE_TEXT_RANGES_BUDGET");
  let offset = 0;
  for (const segment of source.segments) {
    if (!keys(segment, ["start", "end", "characters", "values"]) || !boundary(source.characters, segment.start) ||
        !boundary(source.characters, segment.end) || segment.start !== offset || segment.end <= segment.start ||
        segment.characters !== source.characters.slice(segment.start, segment.end)) fail("Native segments do not cover exact authored UTF16 text");
    values(segment.values); offset = segment.end;
  }
  if (offset !== source.characters.length) fail("Native segments omit authored text");
  for (const check of source.rangeChecks) {
    if (!keys(check, ["start", "end", "values"]) || !boundary(source.characters, check.start) ||
        !boundary(source.characters, check.end) || check.start >= check.end) fail("Invalid native getter range");
    values(check.values);
  }
}
const valueOf = (values, key) => values[key]?.kind === "value" ? values[key].value : undefined;
function paintProjection(paints) {
  if (!Array.isArray(paints)) return paints;
  return paints.map(paint => ({ type: paint.type, visible: defaulted(paint, "visible", true),
    opacity: defaulted(paint, "opacity", 1), blendMode: defaulted(paint, "blendMode", "NORMAL"),
    boundVariables: own(paint, "boundVariables") ? paint.boundVariables : {},
    color: paint.color && { r: paint.color.r, g: paint.color.g, b: paint.color.b, a: defaulted(paint.color, "a", 1) } }));
}
function href(value, rest = false) {
  if (value === null) return null;
  if (keys(value, ["type", rest ? "url" : "value"]) && value.type === "URL" && typeof value[rest ? "url" : "value"] === "string") return value[rest ? "url" : "value"];
  return undefined;
}
function consistent(rest, source) {
  const overrides = rest.characterStyleOverrides ?? [], table = rest.styleOverrideTable ?? {};
  // REST override entries count Unicode characters; SDK ranges use UTF16 offsets.
  const characterCount = Array.from(source.characters).length;
  if (rest.style !== undefined && !plain(rest.style)) fail("Malformed REST text style");
  if (!Array.isArray(overrides) || overrides.length > characterCount || !plain(table) ||
      overrides.some(id => !Number.isInteger(id) || id < 0 || id !== 0 && !plain(table[id]))) fail("Malformed REST character styles");
  const mismatch = () => fail("REST and live native style differ; source may have changed during capture", "NATIVE_TEXT_RANGES_CAPTURE_RACE");
  for (const key of NATIVE_TEXT_RANGE_SCALAR_ONLY_FIELDS) {
    const obs = source.scalars[key];
    if (obs?.kind !== "value") continue;
    if (own(rest, key) && !same(rest[key], obs.value) || own(rest.style ?? {}, key) && !same(rest.style[key], obs.value)) mismatch();
  }
  let characterIndex = 0;
  for (const segment of source.segments) {
    const v = segment.values;
    for (let i = segment.start; i < segment.end; i += source.characters.codePointAt(i) > 0xffff ? 2 : 1) {
      const id = overrides[characterIndex++] ?? 0;
      const style = { ...(rest.style ?? {}), ...(id === 0 ? {} : table[id]) };
      for (const key of ["fontSize", "fontWeight", "textDecoration", "textCase"])
        if (own(style, key) && v[key]?.kind === "value" && !same(style[key], valueOf(v, key))) mismatch();
      const font = valueOf(v, "fontName");
      if (font && (own(style, "fontFamily") && style.fontFamily !== font.family ||
          own(style, "fontStyle") && style.fontStyle !== font.style)) mismatch();
      const paints = style.fills ?? rest.fills;
      if (paints !== undefined && v.fills?.kind === "value" && !same(paintProjection(paints), paintProjection(valueOf(v, "fills")))) mismatch();
      if (own(style, "hyperlink") && v.hyperlink?.kind === "value" &&
          href(style.hyperlink, true) !== undefined && href(valueOf(v, "hyperlink")) !== undefined &&
          href(style.hyperlink, true) !== href(valueOf(v, "hyperlink"))) mismatch();
      const line = valueOf(v, "lineHeight");
      if (style.lineHeightUnit === "PIXELS" && line && (line.unit !== "PIXELS" || style.lineHeightPx !== line.value)) mismatch();
      // REST serializes the SDK percentage to Float32. Compare that exact
      // projection without changing either observation or canonical admission.
      if (["FONT_SIZE_%", "PERCENT"].includes(style.lineHeightUnit) && line &&
          (line.unit !== "PERCENT" || style.lineHeightPercentFontSize !== line.value &&
            !(typeof line.value === "number" && typeof style.lineHeightPercentFontSize === "number" &&
              style.lineHeightPercentFontSize === Math.fround(line.value)))) mismatch();
      const spacing = valueOf(v, "letterSpacing");
      if (own(style, "letterSpacing") && spacing && ["PIXELS", "PERCENT"].includes(spacing.unit)) {
        const pixels = spacing.unit === "PIXELS" ? spacing.value : spacing.value * valueOf(v, "fontSize") / 100;
        if (style.letterSpacing !== pixels) mismatch();
      }
    }
  }
}
function diagnostics(source) {
  const result = [];
  for (const [field, obs] of Object.entries(source.scalars)) {
    if (["error", "missing"].includes(obs.kind)) result.push(issue("NATIVE_TEXT_RANGES_SCALAR_OBSERVATION", "Native scalar observation remains raw", { field, kind: obs.kind }));
    if (field === "hyperlink" && obs.kind === "value" && href(obs.value) !== undefined) {
      const observed = source.segments.map(segment => segment.values.hyperlink);
      if (observed.length && observed.every(entry => entry?.kind === "value" && href(entry.value) !== undefined)) {
        const targets = [...new Set(observed.map(entry => href(entry.value)).filter(target => target !== null))];
        const expected = targets.length === 0 ? null : targets.length === 1 ? targets[0] : undefined;
        if (expected === undefined || href(obs.value) !== expected)
          fail("Native scalar hyperlink conflicts with complete styled segments", "NATIVE_TEXT_RANGES_CAPTURE_RACE");
      }
    }
    if (field === "hyperlink" && obs.kind === "value" && href(obs.value) === undefined)
      result.push(issue("NATIVE_TEXT_RANGES_HYPERLINK_UNKNOWN", "Native scalar hyperlink is not interpreted as no-link", { field, value: obs.value }));
  }
  for (const [field, obs] of Object.entries(source.scalars)) {
    if (obs.kind !== "value" || !NATIVE_TEXT_RANGE_FIELDS.includes(field) || field === "hyperlink") continue;
    const entries = source.segments.map(segment => segment.values[field]);
    if (entries.length && entries.every(value => value?.kind === "value") &&
        entries.every(value => same(value.value, entries[0].value)) && !same(obs.value, entries[0].value))
      fail("Native scalar conflicts with uniform styled segments", "NATIVE_TEXT_RANGES_CAPTURE_RACE");
  }
  for (const [index, check] of source.rangeChecks.entries()) for (const [field, obs] of Object.entries(check.values)) {
    if (obs.kind !== "value") {
      result.push(issue("NATIVE_TEXT_RANGES_GETTER_OBSERVATION", "Native getter observation remains raw", { field, index, kind: obs.kind }));
      continue;
    }
    if (field === "hyperlink" && href(obs.value) === undefined) {
      result.push(issue("NATIVE_TEXT_RANGES_HYPERLINK_UNKNOWN", "Native hyperlink getter value is not interpreted as no-link", { field, index, value: obs.value }));
      continue;
    }
    const segments = source.segments.filter(segment => segment.start < check.end && segment.end > check.start);
    const observations = segments.map(segment => segment.values[field]);
    if (observations.length && observations.every(value => value?.kind === "value") &&
        observations.every(value => same(value.value, observations[0].value)) && !same(obs.value, observations[0].value))
      fail("Valid native range getter conflicts with styled segments", "NATIVE_TEXT_RANGES_CAPTURE_RACE");
  }
  return result;
}
const errorResult = error => ({ status: error.code === "NATIVE_TEXT_RANGES_STALE" ? "stale" : "invalid",
  diagnostics: [issue(error.code ?? "NATIVE_TEXT_RANGES_INVALID", error.message)] });
function data(input, key, fallback) {
  if (!plain(input)) fail("Native codec input must be plain data");
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (!descriptor) return fallback;
  if (!own(descriptor, "value")) fail("Native codec input contains accessors");
  return descriptor.value;
}
export function buildNativeTextRangeSource(input) {
  try {
    const rest = data(input, "rest"), characters = data(input, "characters"), scalars = data(input, "scalars"),
      segments = data(input, "segments"), rangeChecks = data(input, "rangeChecks", []);
    const restSignature = binding(rest);
    const source = clone({ version: 1, nodeId: rest.id, characters, restSignature, scalars, segments, rangeChecks });
    return validateNativeTextRangeSource(rest, source);
  } catch (error) { return errorResult(error); }
}
export function validateNativeTextRangeSource(rest, candidate) {
  try {
    if (candidate === undefined) candidate = data(rest, "codeshellNativeTextRanges");
    if (candidate === undefined) return { status: "absent", diagnostics: [] };
    const source = clone(candidate); shape(source);
    const restSignature = binding(rest);
    if (source.nodeId !== rest.id || source.characters !== rest.characters || source.restSignature !== restSignature)
      fail("Native text evidence is stale for this REST node", "NATIVE_TEXT_RANGES_STALE");
    consistent(rest, source);
    return { status: "bound", source, diagnostics: diagnostics(source) };
  } catch (error) { return errorResult(error); }
}
export function nativeTextRangeSnapshot(source) {
  const value = clone(source); shape(value);
  // Exclude ephemeral REST override IDs; include all resolved live observations and unknown values.
  const { restSignature, ...snapshot } = value;
  return stable(snapshot);
}
function requireValue(values, key) {
  if (values[key]?.kind !== "value") fail(`Native ${key} is missing/mixed/unknown`, "NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");
  return values[key].value;
}
function exactColor(paints) {
  if (!Array.isArray(paints) || paints.length !== 1) fail("Native range requires one opaque normal SOLID paint", "NATIVE_TEXT_RANGES_UNSUPPORTED_PAINT");
  const paint = paints[0], color = paint?.color;
  if (!keys(paint, ["type", "visible", "opacity", "blendMode", "color", "boundVariables"]) || paint.type !== "SOLID" ||
      own(paint, "visible") && paint.visible !== true || defaulted(paint, "opacity", 1) !== 1 ||
      defaulted(paint, "blendMode", "NORMAL") !== "NORMAL" || !keys(color, ["r", "g", "b", "a"]) || defaulted(color, "a", 1) !== 1 ||
      own(paint, "boundVariables") && (!plain(paint.boundVariables) || Object.keys(paint.boundVariables).length)) fail("Native range paint is not supported", "NATIVE_TEXT_RANGES_UNSUPPORTED_PAINT");
  const channels = [color.r, color.g, color.b].map(channel => {
    for (let byte = 0; byte <= 255; byte++) if (channel === byte / 255 || channel === Math.fround(byte / 255)) return byte;
    fail("Native color cannot be represented exactly as sRGB8; raw channels were retained", "NATIVE_TEXT_RANGES_COLOR_QUANTIZATION");
  });
  return `#${channels.map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
const METRICS = ["fontName", "fontSize", "lineHeight", "letterSpacing"];
function plainMetrics(v) {
  for (const key of METRICS) requireValue(v, key);
  for (const [key, allowed] of [["textCase", "ORIGINAL"], ["listSpacing", 0], ["indentation", 0], ["paragraphIndent", 0], ["paragraphSpacing", 0]])
    if (requireValue(v, key) !== allowed) fail(`Native ${key} changes paragraph metrics`, "NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");
  const options = requireValue(v, "listOptions");
  if (!plain(options) || options.type !== "NONE" || Object.keys(options).some(key => key !== "type")) fail("Native lists are not supported", "NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");
  for (const key of ["openTypeFeatures", "boundVariables"]) {
    const object = requireValue(v, key);
    if (!plain(object) || Object.keys(object).length) fail("Native features/variables require a separate model", "NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");
  }
  const overrides = requireValue(v, "textStyleOverrides");
  if (!Array.isArray(overrides) || overrides.some(entry => !keys(entry, ["type"]) || !["HYPERLINK", "TEXT_DECORATION"].includes(entry.type)))
    fail("Native semantic font overrides require a separate model", "NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");
  if (requireValue(v, "textWrapStyle") !== "AUTO") fail("Native text-wrap style is unsupported", "NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");
}
export function importNativeTextRanges(input) {
  let rest, source, canonicalNode;
  try {
    rest = data(input, "rest"); source = data(input, "source"); canonicalNode = clone(data(input, "canonicalNode"));
  } catch (error) { return { ...errorResult(error), status: "unsupported", pixelsVerified: false }; }
  const checked = validateNativeTextRangeSource(rest, source), notes = [...checked.diagnostics];
  const unsupported = error => ({ status: "unsupported", diagnostics: [...notes, issue(error.code ?? "NATIVE_TEXT_RANGES_INVALID", error.message)], pixelsVerified: false });
  if (checked.status !== "bound") return { status: "unsupported", diagnostics: notes, pixelsVerified: false };
  try {
    const live = checked.source;
    if (canonicalNode?.type !== "text" || (canonicalNode.textSource ?? canonicalNode.text) !== live.characters)
      fail("Canonical text does not preserve native authored source", "NATIVE_TEXT_RANGES_SOURCE_MISMATCH");
    for (const segment of live.segments) for (const key of ["textDecorationStyle", "textDecorationOffset", "textDecorationThickness", "textDecorationColor", "textDecorationSkipInk"])
      if (segment.values[key]?.kind === "value" && segment.values[key].value !== null)
        fail("Native underline geometry has no proven CSS basis; whole range admission refused", "NATIVE_TEXT_RANGES_NATIVE_DECORATION_BASIS");
    const context = live.scalars;
    for (const [field, expected] of [["hasMissingFont", false], ["leadingTrim", "NONE"], ["hangingPunctuation", false],
      ["hangingList", false], ["textAlignVertical", "TOP"], ["textTruncation", "DISABLED"], ["maxLines", null]])
      if (requireValue(context, field) !== expected) fail(`Native ${field} applicability is unsupported`, "NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");
    if ({LEFT:"left",CENTER:"center",RIGHT:"right"}[requireValue(context, "textAlignHorizontal")] !== (canonicalNode.textAlign ?? "left"))
      fail("Canonical text alignment differs from native", "NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");
    const baseMetrics = live.segments[0]?.values, ranges = [];
    for (const segment of live.segments) {
      const v = segment.values; plainMetrics(v);
      for (const key of METRICS) if (!same(valueOf(v, key), valueOf(baseMetrics, key)))
        fail("Native metric variants cannot be split into paint ranges", "NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");
      const font = requireValue(v, "fontName"), line = requireValue(v, "lineHeight"), spacing = requireValue(v, "letterSpacing");
      if (!plain(font) || font.family !== canonicalNode.fontFamily || valueOf(v, "fontSize") !== canonicalNode.fontSize ||
          requireValue(v, "fontWeight") !== canonicalNode.fontWeight || requireValue(v, "fontStyle") !== (canonicalNode.fontStyle === "italic" ? "ITALIC" : "REGULAR") ||
          !plain(line) || line.unit !== (canonicalNode.lineHeightUnit === "pixels" ? "PIXELS" : "PERCENT") ||
          line.value !== (canonicalNode.lineHeightUnit === "pixels" ? canonicalNode.lineHeight : canonicalNode.lineHeight * 100) ||
          !plain(spacing) || !(spacing.value === 0 && canonicalNode.letterSpacing === 0 || spacing.unit === "PIXELS" && spacing.value === canonicalNode.letterSpacing))
        fail("Canonical font metrics differ from native", "NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");
      if (!keys(font, ["family", "style", "variationSettings"]) || !["Regular", "Bold", "Italic", "Bold Italic"].includes(font.style) ||
          own(font, "variationSettings") && (!plain(font.variationSettings) || Object.entries(font.variationSettings).some(([axis, number]) =>
            axis === "wght" ? number !== canonicalNode.fontWeight : axis === "slnt" ? number !== 0 : true)))
        fail("Native font axis/style is outside canonical uniform metrics", "NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");
      const fill = exactColor(requireValue(v, "fills")), decoration = requireValue(v, "textDecoration");
      if (!["NONE", "UNDERLINE", "STRIKETHROUGH"].includes(decoration)) fail("Native decoration is unsupported", "NATIVE_TEXT_RANGES_UNSUPPORTED_DECORATION");
      for (const key of ["textDecorationStyle", "textDecorationOffset", "textDecorationThickness", "textDecorationColor", "textDecorationSkipInk"])
        if (requireValue(v, key) !== null) fail("Native underline geometry has no proven CSS basis; whole range admission refused", "NATIVE_TEXT_RANGES_NATIVE_DECORATION_BASIS");
      const link = requireValue(v, "hyperlink"), target = href(link);
      if (target === undefined || typeof target === "string" && (target.startsWith("#") || !isSafeTextRangeHref(target)))
        fail("Native hyperlink target is unsupported; raw value retained", "NATIVE_TEXT_RANGES_UNSUPPORTED_HYPERLINK");
      const range = { start: segment.start, end: segment.end };
      const textDecoration = {NONE:"none",UNDERLINE:"underline",STRIKETHROUGH:"line-through"}[decoration];
      if (fill !== canonicalNode.fill?.toLowerCase()) range.fill = fill;
      if (textDecoration !== (canonicalNode.textDecoration ?? "none")) range.textDecoration = textDecoration;
      if (target !== null) range.href = target;
      if (Object.keys(range).length > 2) ranges.push(range);
    }
    const textRanges = validateTextRanges({ ...canonicalNode, textRanges: { version: 1,
      sourceSignature: textRangeSourceSignature(live.characters), ranges } });
    notes.push(issue("NATIVE_TEXT_RANGES_PIXELS_UNVERIFIED", "Native paint/link/decoration intent recovered; cross-renderer pixels are not verified"));
    return { status: textRanges ? "admitted-intent" : "uniform", ...(textRanges ? { textRanges } : {}), diagnostics: notes, pixelsVerified: false };
  } catch (error) { return unsupported(error); }
}
