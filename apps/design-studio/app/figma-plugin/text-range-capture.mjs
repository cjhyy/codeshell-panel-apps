/** Read-only SDK boundary. Returned observations contain owned JSON, never host objects. */
const MAX_TEXT = 4000;
const MAX_SEGMENTS = 256;
const MAX_BYTES = 256 * 1024;
const MAX_DEPTH = 12;
const RANGE_FIELDS = Object.freeze([
  "textDecoration", "textDecorationStyle", "textDecorationOffset",
  "textDecorationThickness", "textDecorationColor", "textDecorationSkipInk", "hyperlink",
]);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const errorText = (error) => {
  try {
    const descriptor = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "message") : undefined;
    return descriptor && own(descriptor, "value") && typeof descriptor.value === "string"
      ? descriptor.value.slice(0, 240) : "Native getter failed";
  }
  catch { return "Native getter failed"; }
};
const fail = (message) => { throw new Error(message); };
const budgetErrors = new WeakSet();
const isBudget = error => error !== null && typeof error === "object" && budgetErrors.has(error);
const budget = (message) => { const error = new Error(message); budgetErrors.add(error); throw error; };
function byteLength(text) {
  let count = 0;
  for (const scalar of text) {
    const point = scalar.codePointAt(0);
    count += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return count;
}

/** Field names come from the reviewed pure source codec, not serialized input. */
export function captureNativeTextRangeObservations(node, mixed, { fields, scalarFields = [] } = {}) {
  const diagnostics = [];
  const refused = (code, message) => ({ status: "unsupported", diagnostics: [...diagnostics, { code, message }] });
  if (!node || node.type !== "TEXT") return refused("NATIVE_TEXT_CAPTURE_TYPE", "Native source must be TEXT");
  if (typeof mixed !== "symbol") return refused("NATIVE_TEXT_CAPTURE_MIXED", "Native mixed identity is unavailable");
  if (!Array.isArray(fields) || !fields.length || fields.length > 64 ||
      !Array.isArray(scalarFields) || scalarFields.length > 64 ||
      [...fields, ...scalarFields].some(field => typeof field !== "string" || !/^[a-zA-Z][a-zA-Z0-9]*$/u.test(field)) ||
      new Set(fields).size !== fields.length || new Set(scalarFields).size !== scalarFields.length)
    return refused("NATIVE_TEXT_CAPTURE_FIELDS", "Native field catalog is invalid");
  let characters;
  try { characters = node.characters; }
  catch (error) { return refused("NATIVE_TEXT_CAPTURE_CHARACTERS", errorText(error)); }
  if (typeof characters !== "string" || characters.length > MAX_TEXT)
    return refused("NATIVE_TEXT_CAPTURE_BUDGET", "Native text exceeds the complete 4000 UTF16 source budget");

  let steps = 0, dataBytes = 0;
  const addBytes = count => { if ((dataBytes += count) > MAX_BYTES) budget("Complete native observations exceed 256 KiB"); };
  const copy = (value, seen = new Set(), depth = 0) => {
    if (++steps > 40000 || depth > MAX_DEPTH) budget("Native observation exceeds its data budget");
    if (value === null || typeof value === "boolean") { addBytes(value === null ? 4 : value ? 4 : 5); return value; }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) fail("Nonfinite native number");
      addBytes(String(value).length); return value;
    }
    if (typeof value === "string") {
      if (value.length > MAX_BYTES) budget("Native string exceeds its data budget");
      addBytes(byteLength(JSON.stringify(value))); return value;
    }
    if (typeof value !== "object" || value === mixed) fail("Unsupported native host value");
    if (seen.has(value)) fail("Cyclic native observation");
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (!array && prototype !== Object.prototype && prototype !== null) fail("Unsupported native object prototype");
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== "string")) fail("Native symbol key is not JSON data");
    if (array && (!Number.isInteger(value.length) || value.length > 1024)) budget("Native array exceeds its data budget");
    const dataKeys = array ? keys.filter(key => key !== "length") : keys;
    if (dataKeys.length > 512) budget("Native object exceeds its data budget");
    if (array && dataKeys.length !== value.length) fail("Native object is sparse");
    if (array && dataKeys.some((key, index) => key !== String(index))) fail("Native array has extra properties");
    seen.add(value);
    addBytes(2);
    const result = array ? [] : {};
    for (const key of dataKeys) {
      const descriptor = descriptors[key];
      if (!own(descriptor, "value") || !descriptor.enumerable) fail("Native observation has an accessor or hidden field");
      addBytes((array ? 0 : byteLength(JSON.stringify(key)) + 1) + 1);
      Object.defineProperty(result, key, { value: copy(descriptor.value, seen, depth + 1), enumerable: true, configurable: true, writable: true });
    }
    seen.delete(value);
    return result;
  };
  const observe = (getter) => {
    try {
      const value = getter();
      if (value === mixed) return { kind: "mixed" };
      if (value === undefined) return { kind: "missing" };
      return { kind: "value", value: copy(value) };
    } catch (error) {
      if (isBudget(error)) throw error;
      return { kind: "error", message: errorText(error) };
    }
  };
  const read = () => {
    const scalars = {};
    for (const field of new Set([...fields, ...scalarFields])) scalars[field] = observe(() => node[field]);
    let raw;
    try { raw = node.getStyledTextSegments([...fields]); }
    catch (error) { return refused("NATIVE_TEXT_CAPTURE_SEGMENTS", errorText(error)); }
    if (!Array.isArray(raw) || raw.length > MAX_SEGMENTS)
      return refused("NATIVE_TEXT_CAPTURE_BUDGET", "Native segments exceed their complete source budget");
    const rawDescriptors = Object.getOwnPropertyDescriptors(raw), rawKeys = Reflect.ownKeys(rawDescriptors);
    if (rawKeys.some(key => typeof key !== "string" || key !== "length" && !/^(0|[1-9][0-9]*)$/u.test(key)) ||
        rawKeys.length !== raw.length + 1)
      return refused("NATIVE_TEXT_CAPTURE_SEGMENTS", "Native segment array is not dense owned data");
    const segments = [], rangeChecks = [];
    let cursor = 0;
    for (let index = 0; index < raw.length; index++) {
      const entry = rawDescriptors[String(index)];
      if (!entry || !own(entry, "value") || !entry.enumerable)
        return refused("NATIVE_TEXT_CAPTURE_SEGMENTS", "Native segment entry is not owned data");
      const segment = entry.value;
      if (!segment || typeof segment !== "object" || Array.isArray(segment) ||
          ![Object.prototype, null].includes(Object.getPrototypeOf(segment)))
        return refused("NATIVE_TEXT_CAPTURE_SEGMENTS", "Native segment is not a plain record");
      const descriptors = Object.getOwnPropertyDescriptors(segment);
      if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !own(descriptors[key], "value") || !descriptors[key].enumerable))
        return refused("NATIVE_TEXT_CAPTURE_SEGMENTS", "Native segment contains accessors or hidden data");
      const start = descriptors.start?.value, end = descriptors.end?.value, text = descriptors.characters?.value;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start !== cursor || end <= start || end > characters.length ||
          text !== characters.slice(start, end) ||
          (start > 0 && /[\uD800-\uDBFF]/u.test(characters[start - 1]) && /[\uDC00-\uDFFF]/u.test(characters[start])) ||
          (end < characters.length && /[\uD800-\uDBFF]/u.test(characters[end - 1]) && /[\uDC00-\uDFFF]/u.test(characters[end])))
        return refused("NATIVE_TEXT_CAPTURE_SEGMENTS", "Native segments do not cover exact UTF16 source boundaries");
      const values = {}, checks = {};
      for (const field of fields) values[field] = observe(() => descriptors[field]?.value);
      for (const field of RANGE_FIELDS) {
        const getter = `getRange${field[0].toUpperCase()}${field.slice(1)}`;
        checks[field] = observe(() => {
          const method = node[getter];
          return typeof method === "function" ? method.call(node, start, end) : undefined;
        });
      }
      segments.push({ start, end, characters: text, values });
      rangeChecks.push({ start, end, values: checks });
      cursor = end;
    }
    if (cursor !== characters.length)
      return refused("NATIVE_TEXT_CAPTURE_SEGMENTS", "Native segments leave an uncaptured source suffix");
    let after;
    try { after = node.characters; }
    catch (error) { return refused("NATIVE_TEXT_CAPTURE_CHARACTERS", errorText(error)); }
    if (after !== characters) return refused("NATIVE_TEXT_CAPTURE_RACE", "Native characters changed during source capture");
    const observations = { characters, scalars, segments, rangeChecks };
    if (byteLength(JSON.stringify(observations)) > MAX_BYTES)
      return refused("NATIVE_TEXT_CAPTURE_BUDGET", "Complete native source exceeds 256 KiB");
    return { status: "captured", observations, diagnostics };
  };
  try { return read(); }
  catch (error) {
    return refused(isBudget(error) ? "NATIVE_TEXT_CAPTURE_BUDGET" : "NATIVE_TEXT_CAPTURE_DATA", errorText(error));
  }
}
