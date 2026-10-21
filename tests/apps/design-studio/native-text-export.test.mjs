import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createNativeTextExportCapture } from "../../../apps/design-studio/app/figma-plugin/text-source-export.mjs";
import { buildNativeTextRangeSource, nativeTextRangeSnapshot } from "../../../apps/design-studio/app/native-text-ranges-source.mjs";

const data = JSON.parse(await readFile(new URL("../../fixtures/design-studio/native-text-field-matrix-1ed86d39.json", import.meta.url)));
const copy = value => structuredClone(value), mixed = Symbol("synthetic native mixed");
const fields = ["textDecoration", "textDecorationStyle", "textDecorationOffset", "textDecorationThickness",
  "textDecorationColor", "textDecorationSkipInk", "hyperlink"];
function fixture(index = 1, pluginData = "not-json") {
  // Retained observations are replay data, not a new SDK execution or glyph test.
  const actual = data.cases[index], rest = copy(actual.rest), observations = copy(actual.capture.observations);
  let writes = 0, reads = 0;
  const read = observation => observation?.kind === "value" ? copy(observation.value) :
    observation?.kind === "mixed" ? mixed : undefined;
  const node = { type: "TEXT", id: rest.id, name: rest.name, characters: observations.characters,
    strokes: [], effects: [], blendMode: "PASS_THROUGH", isMask: false,
    getPluginData() { reads++; return pluginData; },
    setPluginData() { writes++; throw Error("Read-only export cannot write"); } };
  for (const [key, observation] of Object.entries(observations.scalars))
    if (observation.kind !== "missing") Object.defineProperty(node, key, { configurable: true, enumerable: true,
      get() { if (observation.kind === "error") throw Error(observation.message); return read(observations.scalars[key]); } });
  node.getStyledTextSegments = requested => observations.segments.map(segment => ({
    start: segment.start, end: segment.end, characters: segment.characters,
    ...Object.fromEntries(requested.map(key => [key, read(segment.values[key])])),
  }));
  for (const field of fields) node["getRange" + field[0].toUpperCase() + field.slice(1)] = (start, end) => {
    const observation = observations.rangeChecks.find(check => check.start === start && check.end === end)?.values[field];
    if (observation?.kind === "error") throw Error(observation.message);
    return read(observation);
  };
  const page = { id: "0:1", type: "PAGE", parent: null, children: [node], selection: [node] };
  node.parent = page;
  const official = { id: page.id, type: "CANVAS", children: [rest] };
  return { rest, node, page, official, observations, counters: () => ({ writes, reads }) };
}

test("read-only staged export retains exact complete raw values, unknown getter1 and malformed hints without writes", () => {
  const value = fixture(), original = JSON.stringify(value.official), selection = value.page.selection;
  const capture = createNativeTextExportCapture({ roots: [value.page], mixed, pluginId: "actual-test-plugin-id" });
  capture.add(value.official, value.page);
  const result = capture.finalize(), entry = result.supplement.nodes[value.rest.id];
  const expected = buildNativeTextRangeSource({ rest: value.rest, ...value.observations });
  assert.equal(expected.status, "bound");
  assert.equal(nativeTextRangeSnapshot(entry.source), nativeTextRangeSnapshot(expected.source));
  assert.equal(entry.source.rangeChecks[0].values.hyperlink.value, 1);
  assert.equal(entry.hint, "not-json");
  assert.equal(result.supplement.pluginId, "actual-test-plugin-id");
  assert.deepEqual(value.counters(), { writes: 0, reads: 1 });
  assert.equal(value.page.selection, selection);
  assert.equal(JSON.stringify(value.official), original);
});

test("awaited source, getter and noncatalog preview/topology changes refuse the complete export", async () => {
  for (const mutate of [
    value => value.observations.rangeChecks[0].values.hyperlink.value = null,
    value => value.node.isMask = true,
    value => value.node.effects.push({ type: "DROP_SHADOW", visible: true }),
    value => value.page.children.reverse(),
    value => value.node.parent = { type: "FRAME", id: "other", parent: value.page, children: [value.node] },
  ]) {
    const value = fixture();
    const sibling = { type: "RECTANGLE", id: "sibling", parent: value.page, children: [] };
    value.page.children.push(sibling);
    value.official.children.push({ type: "RECTANGLE", id: "sibling" });
    const capture = createNativeTextExportCapture({ roots: [value.page], mixed, pluginId: "actual-test-plugin-id" });
    capture.add(value.official, value.page);
    await Promise.resolve();
    mutate(value);
    assert.throws(() => capture.finalize(), error => /^NATIVE_TEXT_EXPORT_(?:RACE|TOPOLOGY)$/u.test(error.code));
    assert.equal(value.counters().writes, 0);
  }
});

test("reserved raw collisions and inconsistent overlapping Text exports never overwrite official data", () => {
  const value = fixture(), capture = createNativeTextExportCapture({ roots: [value.page], mixed });
  const collision = copy(value.rest); collision.codeshellNativeTextRanges = { version: "old" };
  const original = JSON.stringify(collision);
  assert.throws(() => capture.add(collision, value.node), error => error.code === "NATIVE_TEXT_EXPORT_COLLISION");
  assert.equal(JSON.stringify(collision), original);
  capture.add(value.rest, value.node);
  capture.add(copy(value.rest), value.node);
  const changed = copy(value.rest); changed.style.unknownFutureField = 1;
  assert.throws(() => capture.add(changed, value.node), error => error.code === "NATIVE_TEXT_EXPORT_OVERLAP");
  const result = capture.finalize();
  assert.equal(result.supplement.pluginId, undefined);
  assert.equal(result.supplement.nodes[value.rest.id].hint, undefined);
  assert.deepEqual(value.counters(), { writes: 0, reads: 0 }, "a missing actual pluginId never gets an invented namespace");
});

test("failed live capture cannot reuse reserved old source metadata or publish a partial table", () => {
  const value = fixture();
  value.node.getStyledTextSegments = () => { throw Error("Native getter unavailable"); };
  const capture = createNativeTextExportCapture({ roots: [value.page], mixed, pluginId: "actual-test-plugin-id" });
  capture.add(value.rest, value.node);
  const result = capture.finalize();
  assert.equal(result.supplement, undefined);
  assert(result.warnings.some(message => message.includes("unavailable")));
  assert.deepEqual(value.counters(), { writes: 0, reads: 0 });
  assert.throws(() => capture.add({ ...value.rest, codeshellNativeTextRangeHint: "{}" }, value.node),
    error => error.code === "NATIVE_TEXT_EXPORT_COLLISION");
});


test("official source type/order disagreements refuse and optional hint read failure keeps fresh native evidence", () => {
  const value = fixture(), sibling = { type: "RECTANGLE", id: "sibling", parent: value.page, children: [] };
  value.page.children.push(sibling); value.official.children.push({ type: "RECTANGLE", id: "sibling" });
  const wrongOrder = copy(value.official); wrongOrder.children.reverse();
  const capture = createNativeTextExportCapture({ roots: [value.page], mixed });
  assert.throws(() => capture.add(wrongOrder, value.page), error => error.code === "NATIVE_TEXT_EXPORT_IDENTITY");
  assert.throws(() => capture.add({ ...value.official, type: "FRAME" }, value.page), error => error.code === "NATIVE_TEXT_EXPORT_IDENTITY");
  value.node.getPluginData = () => { throw Error("metadata read unavailable"); };
  const fresh = createNativeTextExportCapture({ roots: [value.page], mixed, pluginId: "actual-test-plugin-id" });
  fresh.add(value.official, value.page);
  const result = fresh.finalize();
  assert(result.supplement.nodes[value.node.id].source);
  assert.equal(result.supplement.nodes[value.node.id].hint, undefined);
  assert(result.warnings.some(note => note.includes("optional author hint unavailable")));
});
