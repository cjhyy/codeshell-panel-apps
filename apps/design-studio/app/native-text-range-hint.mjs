import { validateTextRanges } from "./text-ranges.mjs";
import { nativeTextRangePlan } from "./native-text-range-plan.mjs";
import { validateNativeTextRangeSource, importNativeTextRanges, nativeTextRangeSnapshot } from "./native-text-ranges-source.mjs";

export const MAX_NATIVE_TEXT_RANGE_HINT_BYTES = 64 * 1024;
export const MAX_NATIVE_PLUGIN_DATA_ENTRY_BYTES = 100000;
const failures = new WeakSet();
const fail = (code, message) => { const error = new Error(message); error.code = code; failures.add(error); throw error; };
const invalid = () => fail("NATIVE_TEXT_RANGE_HINT_INVALID", "Native author hints require bounded owned plain data.");
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const restFields = [
  "id", "type", "characters", "style", "characterStyleOverrides", "styleOverrideTable", "fills",
  "lineTypes", "lineIndentations", "textTruncation", "maxLines", "textAutoResize",
  "layoutSizingHorizontal", "layoutSizingVertical", "hasMissingFont", "leadingTrim", "hangingPunctuation", "hangingList",
];
const nodeFields = [
  "type", "text", "textSource", "textFlow", "textRanges", "fill", "fillPaints", "textDecoration",
  "textDecorationThickness", "textUnderlineOffset", "textDecorationSkipInk", "textOverflow",
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "lineHeightUnit", "letterSpacing", "textAlign",
];
function utf8(text) {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0);
    bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
  }
  return bytes;
}
function clone(value, state = { seen: new Set(), bytes: 0, count: 0 }, depth = 0) {
  const add = text => { if ((state.bytes += utf8(text)) > 512 * 1024) invalid(); };
  if (++state.count > 100000 || depth > 16) invalid();
  if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) {
    add(String(value)); return value;
  }
  if (typeof value === "string") {
    if (value.length > 512 * 1024) invalid();
    add(JSON.stringify(value)); return value;
  }
  const array = Array.isArray(value);
  if ((!array && !plain(value)) || state.seen.has(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  const length = array ? descriptors.length?.value : undefined;
  if (keys.some(key => typeof key !== "string") ||
      array && (!Number.isInteger(length) || length > 4096)) invalid();
  const names = array ? keys.filter(key => key !== "length") : keys;
  if (names.length > 4096 || array && (names.length !== length || names.some((key, index) => key !== String(index)))) invalid();
  state.seen.add(value); add("[]");
  const result = array ? [] : {};
  for (const key of names) {
    const descriptor = descriptors[key];
    if (!own(descriptor, "value") || !descriptor.enumerable) invalid();
    add(JSON.stringify(key) + ":,");
    Object.defineProperty(result, key, { value: clone(descriptor.value, state, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  state.seen.delete(value);
  return result;
}
function record(value, allowed) {
  if (!plain(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !allowed.includes(key) ||
      !own(descriptors[key], "value") || !descriptors[key].enumerable)) invalid();
  return Object.fromEntries(Object.keys(descriptors).map(key => [key, descriptors[key].value]));
}
function project(value, fields, omitUndefined = false) {
  if (!plain(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), result = {};
  for (const key of fields) {
    if (!own(descriptors, key)) continue;
    const descriptor = descriptors[key];
    if (!own(descriptor, "value") || !descriptor.enumerable) invalid();
    if (descriptor.value === undefined && omitUndefined) continue;
    result[key] = clone(descriptor.value);
  }
  return result;
}
function storage(value, pluginId, key) {
  if (![pluginId, key].every(text => typeof text === "string" && text.length <= 100000 && /^[a-z0-9_.-]+$/iu.test(text)))
    invalid();
  const text = typeof value === "string" ? value : JSON.stringify(value), bytes = utf8(text);
  if (bytes > MAX_NATIVE_TEXT_RANGE_HINT_BYTES || bytes + utf8(pluginId) + utf8(key) > MAX_NATIVE_PLUGIN_DATA_ENTRY_BYTES)
    fail("NATIVE_TEXT_RANGE_HINT_BUDGET", "The complete native author hint or plugin-data entry exceeds its byte budget.");
  return text;
}
function effective(plan) {
  const runs = [];
  for (const run of plan.runs) {
    const previous = runs.at(-1);
    if (previous && previous.end === run.start && previous.fill === run.fill &&
        JSON.stringify(previous.hyperlink) === JSON.stringify(run.hyperlink)) previous.end = run.end;
    else runs.push({ ...run, hyperlink: run.hyperlink && { ...run.hyperlink } });
  }
  return JSON.stringify({ characters: plan.characters, runs });
}
function proof(restInput, sourceInput, canonicalInput) {
  const rest = project(restInput, restFields), source = clone(sourceInput);
  const checked = validateNativeTextRangeSource(rest, source);
  if (checked.status !== "bound")
    fail("NATIVE_TEXT_RANGE_HINT_SOURCE", "Author hints require a complete independently bound current native source.");
  const canonical = project(canonicalInput, nodeFields, true);
  const imported = importNativeTextRanges({ rest, source: checked.source, canonicalNode: canonical });
  if (!["uniform", "admitted-intent"].includes(imported.status))
    fail("NATIVE_TEXT_RANGE_HINT_EFFECTIVE", "Current native text cannot independently prove the supported effective paint/link plan.");
  // Never leave a caller-supplied range in the independent native proof.
  delete canonical.textRanges;
  if (imported.textRanges) canonical.textRanges = imported.textRanges;
  const plan = nativeTextRangePlan(canonical);
  return { rest, source: checked.source, plan, snapshot: nativeTextRangeSnapshot(checked.source) };
}
function samePlan(author, current) {
  if (effective(nativeTextRangePlan(author)) !== effective(current))
    fail("NATIVE_TEXT_RANGE_HINT_EFFECTIVE", "The hinted author state would change current native characters, colors, or links.");
}
function boundary(fn) {
  try { return fn(); }
  catch (error) {
    if (error !== null && typeof error === "object" && failures.has(error)) throw error;
    fail("NATIVE_TEXT_RANGE_HINT_INVALID", "Native author hint validation failed without restoring any author state.");
  }
}

/** Pure only: the runtime must call after all native setters and final layout. */
export function buildNativeTextRangeHint(input) {
  return boundary(() => {
    const args = record(input, ["rest", "source", "authorNode", "pluginId", "key"]);
    const author = project(args.authorNode, nodeFields, true);
    const ranges = validateTextRanges(author);
    if (!ranges) fail("NATIVE_TEXT_RANGE_HINT_NO_INTENT", "Only a nonempty explicit canonical range payload needs an author hint.");
    const current = proof(args.rest, args.source, author);
    samePlan(author, current.plan);
    const hint = { version: 1, nodeId: current.rest.id, fill: author.fill.toLowerCase(), textRanges: ranges, snapshot: current.snapshot };
    storage(hint, args.pluginId, args.key);
    return hint;
  });
}

/** Restore author intent only, never current native values/metrics/identity. */
export function restoreNativeTextRangeHint(input) {
  return boundary(() => {
    const args = record(input, ["rest", "source", "canonicalNode", "hint", "pluginId", "key"]);
    const raw = typeof args.hint === "string" ? args.hint : clone(args.hint);
    storage(raw, args.pluginId, args.key);
    const hint = record(typeof raw === "string" ? JSON.parse(raw) : raw, ["version", "nodeId", "fill", "textRanges", "snapshot"]);
    if (Object.keys(hint).length !== 5 || hint.version !== 1 || typeof hint.nodeId !== "string" ||
        typeof hint.fill !== "string" || typeof hint.snapshot !== "string") invalid();
    const canonical = project(args.canonicalNode, nodeFields, true);
    const current = proof(args.rest, args.source, canonical);
    if (hint.nodeId !== current.rest.id || hint.snapshot !== current.snapshot)
      fail("NATIVE_TEXT_RANGE_HINT_STALE", "The author hint does not match this complete current native text snapshot.");
    const author = { ...canonical, fill: hint.fill, textRanges: hint.textRanges };
    const ranges = validateTextRanges(author);
    if (!ranges) fail("NATIVE_TEXT_RANGE_HINT_NO_INTENT", "An author hint cannot restore an empty or partial range payload.");
    samePlan(author, current.plan);
    return { fill: hint.fill.toLowerCase(), textRanges: ranges };
  });
}
