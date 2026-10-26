import { readFile } from "node:fs/promises";
import { NATIVE_TEXT_RANGE_FIELDS, NATIVE_TEXT_RANGE_SCALAR_ONLY_FIELDS } from "../../../../apps/design-studio/app/native-text-ranges-source.mjs";

const actual = JSON.parse(await readFile(new URL("../../../fixtures/design-studio/native-text-field-matrix-1ed86d39.json", import.meta.url), "utf8"))
  .cases.find(value => value.name === "full-range-blue20").capture.observations;
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const same = (first, second) => JSON.stringify(first) === JSON.stringify(second);
const rangeFields = ["textDecoration", "textDecorationStyle", "textDecorationOffset", "textDecorationThickness",
  "textDecorationColor", "textDecorationSkipInk", "hyperlink"];

/**
 * Test SDK only. Catalog/default shape comes from the retained actual observation,
 * while mutable characters, metrics and range writes belong to this synthetic
 * target. PERCENT values remain exact requested numbers: this helper does not
 * reproduce native Float32 transport, native glyphs, or newline range behavior.
 *
 * toRuntime must JSON-clone into the plugin VM realm when that VM owns the native
 * codec. Production capture deliberately rejects records from a foreign realm.
 */
export function installNativeTextRangeSdkMock(target, { mixed, toRuntime = copy } = {}) {
  if (target?.type !== "TEXT" || typeof mixed !== "symbol" || typeof toRuntime !== "function")
    throw new Error("A Text, mixed symbol and runtime clone are required");
  const readDefaults = observations => Object.fromEntries(Object.entries(observations)
    .filter(([, observation]) => observation.kind === "value")
    .map(([field, observation]) => [field, copy(observation.value)]));
  const segmentDefaults = readDefaults(actual.segments[0].values), scalarDefaults = readDefaults(actual.scalars);
  const originals = new Map(), history = [], bases = {};
  const fontRanges = typeof target.setRangeFontName === "function" && typeof target.setRangeFontSize === "function";
  for (const field of ["fills", "textDecoration", "hyperlink", ...(fontRanges ? ["fontName", "fontSize"] : [])]) {
    const descriptor = Object.getOwnPropertyDescriptor(target, field);
    if (descriptor && !descriptor.configurable) throw new Error(`Mock cannot replace ${field}`);
    bases[field] = copy(target[field] ?? scalarDefaults[field]);
    Object.defineProperty(target, field, { configurable: true, enumerable: true,
      get() { return cloneOutput(uniform(field, 0, target.characters.length)); },
      set(value) {
        bases[field] = copy(value);
        for (let index = history.length - 1; index >= 0; index--)
          if (history[index].field === field) history.splice(index, 1);
      },
    });
  }
  const cloneOutput = value => value === mixed || value === undefined ? value : toRuntime(copy(value));
  const scalar = field => {
    if (Object.hasOwn(bases, field)) return uniform(field, 0, target.characters.length);
    if (Object.hasOwn(target, field)) return target[field];
    return scalarDefaults[field];
  };
  // Missing scalar observations stay missing; complete segment values still
  // expose fontStyle/listOptions/indentation/textStyleOverrides, as in the SDK.
  for (const field of [...NATIVE_TEXT_RANGE_FIELDS, ...NATIVE_TEXT_RANGE_SCALAR_ONLY_FIELDS]) {
    if (Object.hasOwn(target, field) || actual.scalars[field]?.kind !== "value") continue;
    if (field === "fontWeight") {
      let explicit;
      Object.defineProperty(target, field, { configurable: true, enumerable: true,
        get: () => explicit ?? (fontRanges ? cloneOutput(uniform("fontWeight", 0, target.characters.length)) : /Bold/u.test(target.fontName?.style ?? "") ? 700 : 400), set: value => { explicit = value; },
      });
      continue;
    }
    Object.defineProperty(target, field, { configurable: true, enumerable: true,
      get: () => cloneOutput(scalarDefaults[field]), set: replacement => { scalarDefaults[field] = copy(replacement); },
    });
  }
  function at(field, index) {
    if (Object.hasOwn(bases, field)) {
      for (let position = history.length - 1; position >= 0; position--)
        if (history[position].field === field && history[position].start <= index && history[position].end > index)
          return history[position].value;
      return bases[field];
    }
    if (field === "fontWeight") {
      const font = at("fontName", index);
      return fontRanges ? font.variationSettings?.wght ?? ({ Thin:100, "Extra Light":200, Light:300, Regular:400,
        Italic:400, Medium:500, "Semi Bold":600, Bold:700, "Extra Bold":800, Black:900 }[font.style.replace(/ Italic$/u, "")] ?? 400)
        : target.fontWeight ?? (/Bold/u.test(font?.style ?? "") ? 700 : 400);
    }
    if (field === "fontStyle") return /Italic/u.test(at("fontName", index)?.style ?? "") ? "ITALIC" : "REGULAR";
    if (["fontName", "fontSize", "lineHeight", "letterSpacing"].includes(field)) return target[field];
    return segmentDefaults[field];
  }
  function positions(start, end) {
    const text = target.characters;
    if (typeof text !== "string" || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length)
      throw new Error("Invalid synthetic native range");
    const result = [];
    for (let index = 0; index < text.length; index += text.codePointAt(index) > 65535 ? 2 : 1)
      if (index >= start && index < end) result.push(index);
    if (start !== end && (!result.length || result[0] !== start) ||
        end < text.length && /[\uDC00-\uDFFF]/u.test(text[end]) && /[\uD800-\uDBFF]/u.test(text[end - 1]))
      throw new Error("Synthetic native ranges must use Unicode scalar boundaries");
    return result;
  }
  function uniform(field, start, end) {
    const indices = positions(start, end);
    if (!indices.length) return bases[field] ?? segmentDefaults[field];
    const first = at(field, indices[0]);
    return indices.every(index => same(at(field, index), first)) ? copy(first) : mixed;
  }
  for (const [method, field] of [["setRangeHyperlink", "hyperlink"], ["setRangeFills", "fills"], ["setRangeTextDecoration", "textDecoration"],
    ...(fontRanges ? [["setRangeFontName", "fontName"], ["setRangeFontSize", "fontSize"]] : [])]) {
    const original = target[method];
    if (typeof original !== "function") throw new Error(`Synthetic SDK setter ${method} is missing`);
    originals.set(method, original);
    target[method] = function (start, end, value) {
      positions(start, end);
      original.call(this, start, end, value);
      history.push({ field, start, end, value: copy(value) });
    };
  }
  target.getStyledTextSegments = fields => {
    const text = target.characters, segments = [];
    for (const start of positions(0, text.length)) {
      const end = start + (text.codePointAt(start) > 65535 ? 2 : 1);
      const values = Object.fromEntries(fields.map(field => [field, copy(at(field, start))]));
      const previous = segments.at(-1);
      if (previous && same(previous.values, values)) { previous.end = end; previous.characters += text.slice(start, end); }
      else segments.push({ start, end, characters: text.slice(start, end), values });
    }
    return toRuntime(segments.map(({ values, ...segment }) => ({ ...segment, ...values })));
  };
  for (const field of rangeFields) target[`getRange${field[0].toUpperCase()}${field.slice(1)}`] = (start, end) => {
    const value = uniform(field, start, end);
    // The retained SDK returned literal 1 for unlinked ranges. Keep that raw
    // observation distinct from the known null in getStyledTextSegments().
    return cloneOutput(field === "hyperlink" && value === null ? 1 : value);
  };
  const styleAt = index => {
    const font = at("fontName", index), line = at("lineHeight", index), spacing = at("letterSpacing", index), link = at("hyperlink", index);
    return { fontFamily: font.family, fontStyle: font.style, fontWeight: at("fontWeight", index), fontSize: at("fontSize", index),
      lineHeightUnit: line.unit === "PIXELS" ? "PIXELS" : "FONT_SIZE_%",
      ...(line.unit === "PIXELS" ? { lineHeightPx: line.value } : { lineHeightPercentFontSize: line.value }),
      letterSpacing: spacing.unit === "PIXELS" ? spacing.value : spacing.value * at("fontSize", index) / 100,
      textDecoration: at("textDecoration", index), textCase: at("textCase", index), fills: copy(at("fills", index)),
      hyperlink: link === null ? null : { type: "URL", url: link.value } };
  };
  return {
    /** Apply after the harness has projected current geometry and normal fields. */
    projectRest(input) {
      const raw = copy(input), indices = positions(0, target.characters.length), first = styleAt(indices[0] ?? 0);
      raw.id = target.id; raw.type = "TEXT"; raw.characters = target.characters;
      raw.style = { ...raw.style, ...first };
      raw.fills = copy(first.fills); raw.characterStyleOverrides = []; raw.styleOverrideTable = {};
      const styles = new Map([[JSON.stringify(first), 0]]);
      for (const index of indices) {
        const style = styleAt(index), key = JSON.stringify(style);
        if (!styles.has(key)) { const id = styles.size; styles.set(key, id); raw.styleOverrideTable[id] = style; }
        raw.characterStyleOverrides.push(styles.get(key));
      }
      for (const field of NATIVE_TEXT_RANGE_SCALAR_ONLY_FIELDS) {
        const value = scalar(field);
        if (value !== undefined && value !== mixed) raw[field] = copy(value);
      }
      return toRuntime(raw);
    },
    history,
    originals,
  };
}
