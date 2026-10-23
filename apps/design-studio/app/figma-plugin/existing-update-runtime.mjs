/** Private existing-node update lane. No creation, movement, layout or async commit. */
import { copyNativeTextEnvelope } from "../native-text-import.mjs";
import { nativeTextContent } from "../text-content.mjs";
import { nativeTextLineHeight } from "../text-line-height.mjs";
import { captureNativeTextRangeObservations } from "./text-range-capture.mjs";
import { NATIVE_TEXT_RANGE_FIELDS, NATIVE_TEXT_RANGE_SCALAR_ONLY_FIELDS,
  buildNativeTextRangeSource, importNativeTextRanges } from "../native-text-ranges-source.mjs";

const fail = (code, message) => { throw Object.assign(Error(message), { code }); };
const finite = Number.isFinite, own = (value, key) => Object.hasOwn(value, key);
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const textKeys = new Set(["text", "textSource", "fontFamily", "fontWeight", "fontStyle", "fontSize",
  "lineHeight", "lineHeightUnit", "textAlign", "letterSpacing", "textDecoration"]);
const keys = new Set(["notes", "name", "visible", "locked", "opacity", "fill", ...textKeys]);
const brands = new WeakMap();
const stable = value => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value)
  ? `[${value.map(stable).join(",")}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
const bytes = text => { let n = 0; for (const scalar of text) { const c = scalar.codePointAt(0); n += c < 128 ? 1 : c < 2048 ? 2 : c < 65536 ? 3 : 4; } return n; };
const bounded = value => {
  const copy = copyNativeTextEnvelope(value);
  if (bytes(JSON.stringify(copy)) > 256 * 1024) fail("NATIVE_UPDATE_BUDGET", "Complete native update observation exceeds256KiB");
  return copy;
};
const mismatch = () => fail("NATIVE_UPDATE_CONFLICT", "Native update fields or identity no longer match the prepared snapshot");
const unsupported = () => fail("NATIVE_UPDATE_UNSUPPORTED", "This existing update requires complete plain native SDK fields and matching own REST evidence");
const solid = value => {
  if (!Array.isArray(value) || value.length !== 1) unsupported();
  const paint = value[0];
  if (!plain(paint) || Object.keys(paint).some(key => !["type", "color", "opacity", "visible", "blendMode", "boundVariables"].includes(key)) ||
      paint.type !== "SOLID" || (paint.opacity ?? 1) !== 1 || (paint.visible ?? true) !== true ||
      (paint.blendMode ?? "NORMAL") !== "NORMAL" || paint.boundVariables !== undefined && stable(paint.boundVariables) !== "{}" ||
      !plain(paint.color) || Object.keys(paint.color).some(key => !["r", "g", "b", "a"].includes(key)) ||
      ![paint.color.r, paint.color.g, paint.color.b].every(n => finite(n) && n >= 0 && n <= 1) || (paint.color.a ?? 1) !== 1) unsupported();
  return { r: paint.color.r, g: paint.color.g, b: paint.color.b };
};
const rawType = node => node.type === "PAGE" ? "CANVAS" : node.type;

// Read-only import deliberately retains unknown getter values as diagnostics.
// Destructive whole-Text setters need a stronger, independently supported proof.
const assertPlainTextWriteEvidence = observations => {
  const { scalars, segments, rangeChecks } = observations;
  if (!segments.length || segments.length !== rangeChecks.length) unsupported();
  const segmentOnly = new Set(["fontStyle", "listOptions", "indentation", "textStyleOverrides"]);
  const getters = ["textDecoration", "textDecorationStyle", "textDecorationOffset",
    "textDecorationThickness", "textDecorationColor", "textDecorationSkipInk", "hyperlink"];
  const base = segments[0].values;
  for (const field of NATIVE_TEXT_RANGE_FIELDS) {
    if (base[field]?.kind !== "value") unsupported();
    const scalar = scalars[field];
    // These four SDK fields have a complete segment API but no scalar property.
    // Missing is permitted only here; mixed/error/unknown values never qualify.
    if (!(segmentOnly.has(field) && scalar?.kind === "missing") &&
        (scalar?.kind !== "value" || stable(scalar) !== stable(base[field]))) unsupported();
  }
  for (const field of NATIVE_TEXT_RANGE_SCALAR_ONLY_FIELDS)
    if (scalars[field]?.kind !== "value") unsupported();
  if (base.textDecoration.value !== "NONE" || base.hyperlink.value !== null ||
      base.textStyleId.value !== "" || base.fillStyleId.value !== "" ||
      stable(base.textStyleOverrides.value) !== "[]" ||
      !["NONE", "HEIGHT", "WIDTH_AND_HEIGHT"].includes(scalars.textAutoResize.value) ||
      ["layoutSizingHorizontal", "layoutSizingVertical"].some(field => !["FIXED", "FILL", "HUG"].includes(scalars[field].value))) unsupported();
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index], check = rangeChecks[index];
    if (stable(segment.values) !== stable(base) || check.start !== segment.start || check.end !== segment.end) unsupported();
    for (const field of getters)
      if (check.values[field]?.kind !== "value" || stable(check.values[field]) !== stable(segment.values[field])) unsupported();
  }
};

export const isNativeExistingUpdateCapture = (capture, patch) => brands.get(capture) === patch;

/** Returning null leaves the legacy unsupported/structural boundaries intact. */
export function createNativeExistingUpdateCapture({ patch, mixed }) {
  if (!patch.operations.length || !patch.operations.every(operation => operation.op === "update" &&
      Array.isArray(operation.changed) && operation.changed.length && operation.changed.every(key => keys.has(key))) ||
      patch.operations.every(operation => operation.changed.every(key => key === "notes"))) return null;
  if (patch.operations.some(operation => operation.changed.some(key => textKeys.has(key) || key === "fill") &&
      [operation.after, operation.baseline].some(node => node.fillPaints !== undefined || node.shadowStack !== undefined))) return null;
  if (patch.operations.some(operation => operation.changed.some(key => textKeys.has(key)) &&
      ![400, 700].includes(operation.after.fontWeight))) return null;
  const operations = new Map();
  for (const operation of patch.operations) {
    if (operations.has(operation.sourceId)) unsupported();
    operations.set(operation.sourceId, operation);
    if (operation.changed.some(key => textKeys.has(key)) && (operation.after.type !== "text" ||
        operation.after.textDecoration && operation.after.textDecoration !== "none")) unsupported();
    if (operation.changed.includes("fill") && (!/^#[0-9a-f]{6}$/iu.test(operation.after.fill) || operation.after.fillPaints !== undefined)) unsupported();
  }
  const captured = new Map(), topology = new Map(); let references = 0, totalBytes = 0, workBytes = 0, workReferences = 0;
  const validId = value => typeof value === "string" && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/u.test(value);
  const lineage = target => {
    const seen = new Set();
    for (let node = target, depth = 0; node; node = node.parent, depth++) {
      if (depth > 35 || seen.has(node) || node.removed === true) unsupported();
      seen.add(node);
      if (!topology.has(node)) {
        if (!validId(node.id) || typeof node.type !== "string" || !/^[A-Z][A-Z0-9_]{0,79}$/u.test(node.type) ||
            node.children !== undefined && !Array.isArray(node.children) || topology.size >= 50036) unsupported();
        const children = [...(node.children ?? [])];
        if (children.length > 50000 || (references += children.length) > 100000 ||
            new Set(children).size !== children.length || new Set(children.map(child => child.id)).size !== children.length ||
            children.some(child => !validId(child?.id)) ||
            node.parent && !(node.parent.children ?? []).includes(node)) unsupported();
        topology.set(node, { id: node.id, type: node.type, parent: node.parent, children });
      }
    }
  };
  const observe = (target, operation) => {
    const fields = {};
    for (const key of operation.changed) {
      if (["name", "visible", "locked", "opacity"].includes(key)) {
        const value = target[key];
        if (key === "name" ? typeof value !== "string" : key === "opacity" ? !finite(value) || value < 0 || value > 1 : typeof value !== "boolean") unsupported();
        fields[key] = value;
      }
    }
    if (operation.changed.some(key => ["fill", "opacity"].includes(key))) {
      fields.boundVariables = bounded(target.boundVariables);
      if (stable(fields.boundVariables) !== "{}") unsupported();
    }
    if (operation.changed.includes("fill")) {
      fields.fills = bounded(target.fills); fields.fillStyleId = target.fillStyleId;
      solid(fields.fills); if (fields.fillStyleId !== "") unsupported();
      if (typeof target.getPluginData !== "function") unsupported();
      for (const key of ["codeshellCssLinearSource", "codeshellCssShadowStack"]) {
        const value = target.getPluginData(key); if (value !== "") unsupported();
        fields[key] = value;
      }
    }
    if (target.type === "TEXT" && operation.changed.some(key => textKeys.has(key) || key === "fill")) {
      const result = captureNativeTextRangeObservations(target, mixed, {
        fields: NATIVE_TEXT_RANGE_FIELDS, scalarFields: NATIVE_TEXT_RANGE_SCALAR_ONLY_FIELDS,
      });
      if (result.status !== "captured") unsupported();
      assertPlainTextWriteEvidence(result.observations);
      if (["fontName", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "fills", "textDecoration"].some(key =>
        result.observations.scalars[key]?.kind !== "value")) unsupported();
      fields.text = result.observations;
      if (operation.changed.includes("textSource")) {
        if (typeof target.getPluginData !== "function") unsupported();
        const text = target.getPluginData("codeshellDesignMetadata");
        if (typeof text !== "string" || bytes(text) > 16 * 1024) unsupported();
        let metadata;
        try { metadata = text ? JSON.parse(text) : {}; } catch { unsupported(); }
        if (!plain(metadata)) unsupported();
        fields.metadataText = text; fields.metadata = bounded(metadata);
      }
    }
    return bounded(fields);
  };
  const captureTarget = (id, target) => {
    const operation = operations.get(id); if (!operation) return;
    if (captured.has(id) || target?.id !== id || target.removed === true || captured.size >= 50000) unsupported();
    lineage(target);
    const fields = observe(target, operation), snapshot = stable(fields);
    if ((totalBytes += bytes(snapshot)) > 16 * 1024 * 1024) fail("NATIVE_UPDATE_BUDGET", "Complete native update observations exceed16MiB");
    captured.set(id, { target, operation, fields, snapshot, corroborated: false });
  };
  const corroborateOwnRest = (id, raw) => {
    const entry = captured.get(id); if (!entry) return;
    const { target, operation, fields } = entry;
    // Copy only the complete required own-REST projection. Unrelated descendant
    // subtrees are not serialized at every target; original raw data is retained.
    const descriptors = Object.getOwnPropertyDescriptors(raw), projection = {};
    const required = new Set(["id", "type", ...Object.keys(fields).filter(key => ["name", "visible", "locked", "opacity", "boundVariables"].includes(key))]);
    if (own(fields, "fills")) for (const key of ["fills", "fillStyleId", "styles", "codeshellCssLinearSource", "codeshellCssShadowStack"]) required.add(key);
    if (fields.text) for (const key of ["characters", "style", "fills", "styles", "textStyleId", "fillStyleId", "characterStyleOverrides", "styleOverrideTable", "lineTypes", "lineIndentations",
      "textTruncation", "maxLines", "textAutoResize", "layoutSizingHorizontal", "layoutSizingVertical", "hasMissingFont", "leadingTrim", "hangingPunctuation", "hangingList"]) required.add(key);
    for (const key of required) if (own(descriptors, key)) {
      const descriptor = descriptors[key]; if (!own(descriptor, "value") || !descriptor.enumerable) unsupported();
      Object.defineProperty(projection, key, { value: descriptor.value, enumerable: true });
    }
    raw = bounded(projection);
    if (raw.id !== target.id || raw.type !== rawType(target)) mismatch();
    for (const key of ["name", "visible", "locked", "opacity"]) if (own(fields, key)) {
      const rawValue = raw[key] ?? ({ visible: true, locked: false, opacity: 1 })[key];
      if (rawValue !== fields[key]) mismatch();
    }
    if (own(fields, "boundVariables") && raw.boundVariables !== undefined && stable(bounded(raw.boundVariables)) !== "{}") unsupported();
    if (own(fields, "fills")) {
      if (stable(solid(bounded(raw.fills))) !== stable(solid(fields.fills))) mismatch();
      if (raw.fillStyleId !== undefined && raw.fillStyleId !== "" || raw.styles?.fill !== undefined && raw.styles.fill !== "") unsupported();
      if (raw.codeshellCssLinearSource !== undefined || raw.codeshellCssShadowStack !== undefined) unsupported();
    }
    if (fields.text) {
      if (raw.textStyleId !== undefined && raw.textStyleId !== "" || raw.fillStyleId !== undefined && raw.fillStyleId !== "" ||
          [raw.styles?.text, raw.styles?.fill].some(value => value !== undefined && value !== "")) unsupported();
      const styleKeys = new Set(["fontFamily", "fontPostScriptName", "fontStyle", "fontWeight", "fontSize", "italic", "textCase", "textDecoration",
        "textAutoResize", "textTruncation", "maxLines", "textAlignHorizontal", "textAlignVertical", "letterSpacing", "lineHeightPx", "lineHeightPercent",
        "lineHeightPercentFontSize", "lineHeightUnit", "fills", "hyperlink"]);
      if (!plain(raw.style) || Object.keys(raw.style).some(key => !styleKeys.has(key))) unsupported();
      if (raw.characterStyleOverrides !== undefined && (!Array.isArray(raw.characterStyleOverrides) || raw.characterStyleOverrides.some(id => id !== 0)) ||
          raw.styleOverrideTable !== undefined && (!plain(raw.styleOverrideTable) || Object.keys(raw.styleOverrideTable).length)) unsupported();
      const bound = buildNativeTextRangeSource({ rest: raw, ...fields.text });
      if (bound.status !== "bound" || importNativeTextRanges({ rest: raw, source: bound.source,
        canonicalNode: operation.baseline }).status !== "uniform") unsupported();
    }
    entry.corroborated = true;
  };
  const assertTopology = () => {
    for (const [target, before] of topology) {
      const children = target.children ?? [];
      if ((workReferences += children.length + 1) > 200000) fail("NATIVE_UPDATE_WORK_BUDGET", "Native update context rechecks exceed200000 references");
      if (target.removed === true || target.id !== before.id || target.type !== before.type || target.parent !== before.parent ||
          children.length !== before.children.length || children.some((child, index) => child !== before.children[index])) mismatch();
    }
  };
  const currentFields = entry => {
    const current = observe(entry.target, entry.operation);
    if ((workBytes += bytes(stable(current))) > 64 * 1024 * 1024) fail("NATIVE_UPDATE_WORK_BUDGET", "Native update rechecks exceed64MiB of observations");
    return current;
  };
  const assertCurrent = (complete = true) => {
    if (complete && ([...operations.keys()].some(id => !captured.has(id)) || [...captured.values()].some(entry => !entry.corroborated))) unsupported();
    assertTopology();
    for (const entry of captured.values()) if (stable(currentFields(entry)) !== entry.snapshot) mismatch();
  };
  const compile = ({ fontFor }) => {
    assertCurrent();
    const mutations = [], postchecks = [];
    for (const entry of captured.values()) {
      const { target, operation, fields } = entry;
      const { after, baseline, changed } = operation;
      const assigned = new Map();
      const assign = (key, value) => { const owned = bounded(value); assigned.set(key, owned); mutations.push(() => { target[key] = owned; }); };
      for (const key of changed) {
        if (["name", "visible", "locked"].includes(key)) assign(key, after[key]);
        else if (key === "opacity") assign(key, baseline.opacity > 0 ? Math.min(1, Math.max(0, fields.opacity * after.opacity / baseline.opacity)) : after.opacity);
        else if (key === "fill") assign("fills", [{ type: "SOLID", color: Object.fromEntries(["r", "g", "b"].map((name, i) => [name, parseInt(after.fill.slice(1 + i * 2, 3 + i * 2), 16) / 255])) }]);
        else if (key === "notes") {
          const method = target.setPluginData, value = after.notes ?? "";
          if (typeof method !== "function") unsupported();
          mutations.push(() => method.call(target, "codeshellNotes", value));
        }
      }
      if (changed.some(key => key === "text" || key === "textSource")) assign("characters", nativeTextContent(after, baseline));
      if (changed.some(key => ["fontFamily", "fontWeight", "fontStyle"].includes(key))) {
        const font = bounded(fontFor(after));
        if (!["Regular", "Bold", "Italic", "Bold Italic"].includes(font.style)) unsupported();
        assign("fontName", font);
      }
      if (changed.includes("fontSize")) assign("fontSize", after.fontSize);
      if (changed.some(key => key === "lineHeight" || key === "lineHeightUnit")) assign("lineHeight", nativeTextLineHeight(after));
      if (changed.includes("textAlign")) assign("textAlignHorizontal", after.textAlign.toUpperCase());
      if (changed.includes("letterSpacing")) assign("letterSpacing", { unit: "PIXELS", value: after.letterSpacing ?? 0 });
      if (changed.includes("textDecoration")) assign("textDecoration", "NONE");
      if (changed.includes("textSource")) {
        const method = target.setPluginData;
        if (typeof method !== "function") unsupported();
        const metadata = bounded({ ...fields.metadata, textSource: after.textSource ?? null }), text = JSON.stringify(metadata);
        if (bytes(text) > 16 * 1024) unsupported();
        mutations.push(() => method.call(target, "codeshellDesignMetadata", text));
        assigned.set("metadataText", text); assigned.set("metadata", metadata);
      }
      postchecks.push(() => {
        const current = currentFields(entry), expected = bounded(fields);
        const readbackFailure = (field = "fields") => fail("NATIVE_UPDATE_READBACK", `Native update ${field} readback differs from the exact prepared intent; undo was requested`);
        for (const [key, value] of assigned) if (own(expected, key) && key !== "fills") expected[key] = value;
        if (assigned.has("fills")) {
          if (stable(solid(current.fills)) !== stable(solid(assigned.get("fills")))) readbackFailure();
          expected.fills = current.fills; // Only documented SOLID default fields may differ in shape.
        }
        if (expected.text) {
          const before = expected.text, actual = current.text;
          if (!actual || actual.characters !== (assigned.get("characters") ?? before.characters)) readbackFailure();
          const scalar = bounded(before.scalars), segment = bounded(before.segments[0]?.values ?? {}), checks = bounded(before.rangeChecks[0]?.values ?? {});
          const set = (key, value) => {
            if (scalar[key]?.kind === "value") scalar[key] = { kind: "value", value };
            if (own(segment, key)) segment[key] = { kind: "value", value };
            if (own(checks, key)) checks[key] = { kind: "value", value };
          };
          for (const key of ["fontName", "fontSize", "lineHeight", "letterSpacing", "textDecoration", "fills", "textAlignHorizontal"])
            if (assigned.has(key)) set(key, assigned.get(key));
          if (assigned.has("fontName")) {
            set("fontWeight", after.fontWeight); set("fontStyle", after.fontStyle === "italic" ? "ITALIC" : "REGULAR");
          }
          const equalValue = (key, actualValue, expectedValue) => {
            if (key === "fills" && actualValue?.kind === "value" && expectedValue?.kind === "value")
              return stable(solid(actualValue.value)) === stable(solid(expectedValue.value));
            if (key === "lineHeight" && actualValue?.kind === "value" && expectedValue?.kind === "value") {
              const a = actualValue.value, e = expectedValue.value;
              // Existing retained native PERCENT transport contract (1ad67f0).
              return stable(Object.keys(a).sort()) === '["unit","value"]' && stable(Object.keys(e).sort()) === '["unit","value"]' &&
                a.unit === e.unit && (a.value === e.value || e.unit === "PERCENT" && a.value === Math.fround(e.value / 100) * 100);
            }
            return stable(actualValue) === stable(expectedValue);
          };
          const equalRecord = (a, e) => stable(Object.keys(a).sort()) === stable(Object.keys(e).sort()) && Object.keys(e).every(key => equalValue(key, a[key], e[key]));
          if (!equalRecord(actual.scalars, scalar)) readbackFailure("scalar " + Object.keys(scalar).find(key => !equalValue(key, actual.scalars[key], scalar[key])));
          if (actual.segments.some(run => !equalRecord(run.values, segment))) readbackFailure("segment");
          if (actual.rangeChecks.some(run => !equalRecord(run.values, checks))) readbackFailure("range getter");
          expected.text = current.text;
        }
        if (stable(current) !== stable(expected)) readbackFailure();
      });
    }
    return { mutations, assertApplied: () => { assertTopology(); for (const check of postchecks) check(); } };
  };
  const capture = { captureTarget, corroborateOwnRest, assertCurrent, compile };
  brands.set(capture, patch); return capture;
}
