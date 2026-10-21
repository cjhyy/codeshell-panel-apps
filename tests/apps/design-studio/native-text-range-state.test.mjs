import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { captureBoundNativeTextRanges, finalizeCreatedNativeTextRanges,
  NATIVE_TEXT_RANGE_HINT_KEY } from "../../../apps/design-studio/app/figma-plugin/text-range-state.mjs";
import { restoreNativeTextRangeHint } from "../../../apps/design-studio/app/native-text-range-hint.mjs";
import { textRangeSourceSignature } from "../../../apps/design-studio/app/text-ranges.mjs";

const fixture = JSON.parse(await readFile(new URL("../../fixtures/design-studio/native-text-field-matrix-1ed86d39.json", import.meta.url)));
const copy = value => structuredClone(value), mixed = Symbol("native-mixed"), pluginId = "test-native-final-state";
// A mock PIXELS variant of the complete actual field catalog. This is not an
// actual native PIXELS observation or a cross-renderer pixel acceptance.
function entry(id = "test:1") {
  const actual = fixture.cases.find(value => value.name === "full-range-blue20");
  const rest = copy(actual.rest), observations = copy(actual.capture.observations), writes = [];
  rest.id = id; rest.style.lineHeightUnit = "PIXELS"; rest.style.lineHeightPx = 24;
  const line = { kind: "value", value: { unit: "PIXELS", value: 24 } };
  observations.scalars.lineHeight = copy(line);
  for (const segment of observations.segments) segment.values.lineHeight = copy(line);
  const native = observation => observation.kind === "mixed" ? mixed : observation.kind === "missing" ? undefined :
    observation.kind === "error" ? (() => { throw new Error(observation.message); })() : copy(observation.value);
  const target = { id, type: "TEXT", characters: observations.characters,
    async exportAsync(options) { assert.deepEqual(options, { format: "JSON_REST_V1" }); return { document: copy(rest) }; },
    setPluginData(key, text) { writes.push({ key, text }); },
    getStyledTextSegments(fields) {
      return observations.segments.map(segment => ({ start: segment.start, end: segment.end, characters: segment.characters,
        ...Object.fromEntries(fields.filter(field => segment.values[field].kind !== "missing").map(field => [field, native(segment.values[field])])) }));
    },
  };
  for (const [field, observation] of Object.entries(observations.scalars))
    Object.defineProperty(target, field, { configurable: true, get: () => native(observation) });
  for (const field of Object.keys(observations.rangeChecks[0].values))
    target[`getRange${field[0].toUpperCase()}${field.slice(1)}`] = () => native(observations.rangeChecks[0].values[field]);
  const source = { ...copy(actual.canonical), lineHeight: 24, lineHeightUnit: "pixels",
    textRanges: { version: 1, sourceSignature: textRangeSourceSignature(observations.characters),
      ranges: [{ start: 0, end: observations.characters.length, fill: "#1d70b8" }] } };
  return { target, source, rest, observations, writes };
}
const context = (owned, overrides = {}) => ({ mixed, pluginId,
  assertOwned(target) { assert(owned.includes(target), "target left the factory's owned pages"); }, ...overrides });

test("final native snapshot restores full-range blue with unused black author base using complete SDK data", async () => {
  const value = entry(), before = copy(value.source);
  const result = await finalizeCreatedNativeTextRanges([value], context([value.target]));
  assert.equal(result.texts, 1); assert(result.bytes > 0);
  assert.equal(value.writes.length, 1); assert.equal(value.writes[0].key, NATIVE_TEXT_RANGE_HINT_KEY);
  const current = captureBoundNativeTextRanges(value.target, value.rest, mixed);
  assert.equal(current.status, "bound");
  const restored = restoreNativeTextRangeHint({ rest: value.rest, source: current.source,
    canonicalNode: { ...value.source, fill: "#1d70b8" }, hint: value.writes[0].text,
    pluginId, key: NATIVE_TEXT_RANGE_HINT_KEY });
  assert.equal(restored.fill, "#000000"); assert.deepEqual(restored.textRanges, before.textRanges);
  assert.deepEqual(value.source, before);
});

test("late owned exports cannot change an earlier Text between staged proof and first metadata write", async () => {
  const first = entry("test:1"), second = entry("test:2"), exportSecond = second.target.exportAsync;
  second.target.exportAsync = async options => {
    first.observations.rangeChecks[0].values.hyperlink = { kind: "value", value: null };
    return exportSecond(options);
  };
  await assert.rejects(finalizeCreatedNativeTextRanges([first, second], context([first.target, second.target])),
    error => error.code === "TEXT_RANGES_NATIVE_FINALIZE_RACE");
  assert.equal(first.writes.length + second.writes.length, 0);
});

test("ownership, whole-source capture, identity and effective-author failures never save partial intent", async () => {
  for (const change of [
    value => { value.target.getStyledTextSegments = () => { throw new Error("unavailable"); }; },
    value => { value.rest.id = "foreign:1"; },
    value => { value.source.textRanges.ranges[0].fill = "#ff0000"; },
  ]) {
    const first = entry("test:1"), second = entry("test:2"); change(second);
    await assert.rejects(finalizeCreatedNativeTextRanges([first, second], context([first.target, second.target])));
    assert.equal(first.writes.length + second.writes.length, 0);
  }
  const value = entry();
  await assert.rejects(finalizeCreatedNativeTextRanges([value], context([])), /owned pages/);
  assert.equal(value.writes.length, 0);
  const moved = entry(), owned = [moved.target], exportMoved = moved.target.exportAsync;
  moved.target.exportAsync = async options => { owned.length = 0; return exportMoved(options); };
  await assert.rejects(finalizeCreatedNativeTextRanges([moved], context(owned)), /owned pages/);
  assert.equal(moved.writes.length, 0);
});

test("plugin-data failure propagates without success; empty creation needs no metadata capability", async () => {
  const value = entry(); value.target.setPluginData = () => { throw new Error("storage failed"); };
  await assert.rejects(finalizeCreatedNativeTextRanges([value], context([value.target])), /storage failed/);
  assert.deepEqual(await finalizeCreatedNativeTextRanges([], context([])), { texts: 0, bytes: 0 });
  assert.equal(value.writes.length, 0);
});
