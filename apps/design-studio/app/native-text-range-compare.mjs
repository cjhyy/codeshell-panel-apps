import { MAX_NATIVE_TEXT_RANGE_SOURCE_BYTES, NATIVE_TEXT_RANGE_FIELDS,
  NATIVE_TEXT_RANGE_SCALAR_ONLY_FIELDS, validateNativeTextRangeSource,
  nativeTextRangeSnapshot } from "./native-text-ranges-source.mjs";

const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const failures = new WeakSet();
const fail = code => { const error = new Error(code); error.code = code; failures.add(error); throw error; };
const rangeFields = ["textDecoration", "textDecorationStyle", "textDecorationOffset",
  "textDecorationThickness", "textDecorationColor", "textDecorationSkipInk", "hyperlink"];
const restFields = ["style", "fills", "styles", "textStyleId", "fillStyleId", "lineTypes", "lineIndentations",
  "textTruncation", "maxLines", "textAutoResize", "layoutSizingHorizontal", "layoutSizingVertical",
  "hasMissingFont", "leadingTrim", "hangingPunctuation", "hangingList"];
const messages = {
  NATIVE_TEXT_SOURCE_COMPARE_INVALID: "Native text comparison requires bounded owned JSON TEXT nodes.",
  NATIVE_TEXT_SOURCE_COMPARE_BUDGET: "A complete native comparison node exceeds its 256 KiB data budget.",
  NATIVE_TEXT_SOURCE_COMPARE_SNAPSHOT_REQUIRED: "A complete historical native text snapshot is required before changing original text.",
  NATIVE_TEXT_SOURCE_COMPARE_CURRENT_REQUIRED: "The current native text node requires a complete fresh source snapshot.",
  NATIVE_TEXT_SOURCE_COMPARE_SOURCE_INVALID: "Native text source validation failed against its own REST node.",
  NATIVE_TEXT_SOURCE_COMPARE_SOURCE_STALE: "Native text source is stale for its own REST node.",
  NATIVE_TEXT_SOURCE_COMPARE_SNAPSHOT_CHANGED: "Complete native observations or their exact segment boundaries changed.",
  NATIVE_TEXT_SOURCE_COMPARE_REST_STYLE_CHANGED: "Resolved native REST text styles changed.",
};
const note = (code, side) => ({ code, message: messages[code], ...(side ? { side } : {}) });
function utf8(text) {
  let bytes = 0;
  for (const scalar of text) {
    const point = scalar.codePointAt(0);
    bytes += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
  }
  return bytes;
}
function clone(value, state, depth = 0) {
  const add = bytes => { if ((state.bytes += bytes) > MAX_NATIVE_TEXT_RANGE_SOURCE_BYTES)
    fail("NATIVE_TEXT_SOURCE_COMPARE_BUDGET"); };
  if (++state.steps > 100000 || depth > 16) fail("NATIVE_TEXT_SOURCE_COMPARE_BUDGET");
  if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) {
    add(String(value).length); return value;
  }
  if (typeof value === "string") {
    if (value.length > MAX_NATIVE_TEXT_RANGE_SOURCE_BYTES) fail("NATIVE_TEXT_SOURCE_COMPARE_BUDGET");
    add(utf8(JSON.stringify(value))); return value;
  }
  const array = Array.isArray(value);
  if ((!array && !plain(value)) || state.seen.has(value)) fail("NATIVE_TEXT_SOURCE_COMPARE_INVALID");
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== "string")) fail("NATIVE_TEXT_SOURCE_COMPARE_INVALID");
  const length = array ? descriptors.length?.value : undefined;
  if (array && (!Number.isInteger(length) || length > 8192)) fail("NATIVE_TEXT_SOURCE_COMPARE_BUDGET");
  const names = array ? keys.filter(key => key !== "length") : keys;
  if (names.length > 8192) fail("NATIVE_TEXT_SOURCE_COMPARE_BUDGET");
  if (array && (names.length !== length || names.some((key, index) => key !== String(index))))
    fail("NATIVE_TEXT_SOURCE_COMPARE_INVALID");
  state.seen.add(value); add(2);
  const result = array ? [] : {};
  for (const [index, key] of names.entries()) {
    const descriptor = descriptors[key];
    if (!own(descriptor, "value") || !descriptor.enumerable) fail("NATIVE_TEXT_SOURCE_COMPARE_INVALID");
    add((index ? 1 : 0) + (array ? 0 : utf8(JSON.stringify(key)) + 1));
    Object.defineProperty(result, key, { value: clone(descriptor.value, state, depth + 1),
      enumerable: true, writable: true, configurable: true });
  }
  state.seen.delete(value);
  return result;
}
function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return Array.isArray(value) ? `[${value.map(stable).join(",")}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
}
const sameKeys = (value, fields) => Object.keys(value).length === fields.length && fields.every(field => own(value, field));
function complete(source) {
  return sameKeys(source.scalars, [...NATIVE_TEXT_RANGE_FIELDS, ...NATIVE_TEXT_RANGE_SCALAR_ONLY_FIELDS]) &&
    source.segments.every(segment => sameKeys(segment.values, NATIVE_TEXT_RANGE_FIELDS)) &&
    source.rangeChecks.length === source.segments.length && source.rangeChecks.every((check, index) =>
      check.start === source.segments[index].start && check.end === source.segments[index].end && sameKeys(check.values, rangeFields));
}
function resolveRest(rest) {
  if (own(rest, "characterStyleOverrides") && !Array.isArray(rest.characterStyleOverrides) ||
      own(rest, "styleOverrideTable") && !plain(rest.styleOverrideTable)) fail("NATIVE_TEXT_SOURCE_COMPARE_INVALID");
  const base = rest.style ?? {}, table = rest.styleOverrideTable ?? {}, overrides = rest.characterStyleOverrides ?? [];
  if (!plain(base) || !plain(table) || !Array.isArray(overrides)) fail("NATIVE_TEXT_SOURCE_COMPARE_INVALID");
  const scalarCount = Array.from(rest.characters).length;
  if (overrides.length > scalarCount || overrides.some(id => !Number.isInteger(id) || id < 0 || id !== 0 && !own(table, String(id))))
    fail("NATIVE_TEXT_SOURCE_COMPARE_INVALID");
  const baseValues = new Map(Object.entries(base).map(([key, value]) => [key, stable(value)]));
  const normalized = new Map([[0, "{}"]]);
  for (const [key, value] of Object.entries(table)) {
    if (!/^(0|[1-9][0-9]*)$/u.test(key) || !Number.isSafeInteger(Number(key)) || !plain(value))
      fail("NATIVE_TEXT_SOURCE_COMPARE_INVALID");
    // Base style is retained separately. Removing only exact inherited values
    // is equivalent to merging base+override, without duplicating a large base
    // for every Unicode scalar. Unknown override keys remain comparison data.
    const effective = Object.fromEntries(Object.entries(value).filter(([name, item]) =>
      !baseValues.has(name) || stable(item) !== baseValues.get(name)));
    if (key !== "0") normalized.set(Number(key), stable(effective));
  }
  const styles = [], indices = new Map(), runs = [], used = new Set();
  let scalar = 0;
  for (const _character of rest.characters) {
    const id = overrides[scalar] ?? 0, style = normalized.get(id);
    if (style === undefined) fail("NATIVE_TEXT_SOURCE_COMPARE_INVALID");
    used.add(id);
    if (!indices.has(style)) { indices.set(style, styles.length); styles.push(style); }
    const index = indices.get(style), previous = runs.at(-1);
    if (previous?.style === index) previous.end++;
    else runs.push({ start: scalar, end: scalar + 1, style: index });
    scalar++;
  }
  // Unused table entries are still retained, with only their ephemeral IDs
  // removed. They cannot hide unknown REST style changes behind equal getters.
  const unusedStyles = Object.entries(table).filter(([key]) => key === "0" || !used.has(Number(key)))
    .map(([, value]) => stable(value)).sort();
  const context = Object.fromEntries(restFields.filter(key => own(rest, key)).map(key => [key, rest[key]]));
  return stable({ context, styles, runs, unusedStyles });
}

/**
 * Pure conflict evidence only. Each source validates against its OWN REST node;
 * neither historical metadata nor a matching result authorizes native writes.
 * The caller still owns the 16 MiB complete-transfer budget and duplicate IDs.
 */
export function compareNativeTextRangeSources(input) {
  let side, bytes;
  try {
    if (!plain(input)) fail("NATIVE_TEXT_SOURCE_COMPARE_INVALID");
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !["expectedRest", "currentRest"].includes(key) ||
        !own(descriptors[key], "value") || !descriptors[key].enumerable) ||
        !own(descriptors, "expectedRest") || !own(descriptors, "currentRest")) fail("NATIVE_TEXT_SOURCE_COMPARE_INVALID");
    const nodes = {};
    bytes = {};
    for (side of ["expected", "current"]) {
      const state = { bytes: 0, steps: 0, seen: new Set() };
      nodes[side] = clone(descriptors[`${side}Rest`].value, state);
      bytes[side] = state.bytes;
      if (!plain(nodes[side]) || nodes[side].type !== "TEXT" || typeof nodes[side].id !== "string" ||
          !nodes[side].id || nodes[side].id.length > 160 || typeof nodes[side].characters !== "string" ||
          nodes[side].characters.length > 4000) fail("NATIVE_TEXT_SOURCE_COMPARE_INVALID");
    }
    bytes.total = bytes.expected + bytes.current;
    const sources = {};
    for (side of ["expected", "current"]) {
      const checked = validateNativeTextRangeSource(nodes[side]);
      if (checked.status === "absent" || checked.status === "bound" && !complete(checked.source)) {
        const code = side === "expected" ? "NATIVE_TEXT_SOURCE_COMPARE_SNAPSHOT_REQUIRED" : "NATIVE_TEXT_SOURCE_COMPARE_CURRENT_REQUIRED";
        return { status: side === "expected" ? "snapshot-required" : "invalid", diagnostics: [note(code, side)], bytes };
      }
      if (checked.status !== "bound") {
        const code = checked.status === "stale" ? "NATIVE_TEXT_SOURCE_COMPARE_SOURCE_STALE" : "NATIVE_TEXT_SOURCE_COMPARE_SOURCE_INVALID";
        return { status: checked.status === "stale" ? "stale" : "invalid", diagnostics: [note(code, side)], bytes };
      }
      sources[side] = checked.source;
    }
    const projections = {};
    for (side of ["expected", "current"]) projections[side] = resolveRest(nodes[side]);
    side = undefined;
    const diagnostics = [];
    if (nativeTextRangeSnapshot(sources.expected) !== nativeTextRangeSnapshot(sources.current))
      diagnostics.push(note("NATIVE_TEXT_SOURCE_COMPARE_SNAPSHOT_CHANGED"));
    if (projections.expected !== projections.current)
      diagnostics.push(note("NATIVE_TEXT_SOURCE_COMPARE_REST_STYLE_CHANGED"));
    return { status: diagnostics.length ? "changed" : "unchanged", diagnostics, bytes };
  } catch (error) {
    const code = error !== null && typeof error === "object" && failures.has(error)
      ? error.code : "NATIVE_TEXT_SOURCE_COMPARE_INVALID";
    return { status: "invalid", diagnostics: [note(code, side)] };
  }
}
