import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import { installNativeTextRangeSdkMock } from "./fixtures/native-text-sdk.mjs";
import { applyCreatedNativeTextRanges } from "../../../apps/design-studio/app/figma-plugin/text-range-write.mjs";
import { captureBoundNativeTextRanges, finalizeCreatedNativeTextRanges } from "../../../apps/design-studio/app/figma-plugin/text-range-state.mjs";
import { NATIVE_TEXT_RANGE_FIELDS, NATIVE_TEXT_RANGE_SCALAR_ONLY_FIELDS, buildNativeTextRangeSource, importNativeTextRanges } from "../../../apps/design-studio/app/native-text-ranges-source.mjs";
import { restoreNativeTextRangeHint } from "../../../apps/design-studio/app/native-text-range-hint.mjs";

const mixed = Symbol("test-sdk-mixed"), copy = value => JSON.parse(JSON.stringify(value));
function entry({ id = "mock:1", toRuntime } = {}) {
  const characters = "A😀 linked\nend", writes = [], hints = [];
  const target = { id, type: "TEXT", characters, fontName: { family: "Inter", style: "Regular" }, fontSize: 20,
    lineHeight: { unit: "PIXELS", value: 24 }, letterSpacing: { unit: "PIXELS", value: 0 },
    fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }], textDecoration: "NONE",
    textAlignHorizontal: "LEFT", textAutoResize: "HEIGHT", textTruncation: "DISABLED", maxLines: null,
    layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG",
    setPluginData(key, value) { hints.push({ key, value }); },
  };
  for (const method of ["setRangeHyperlink", "setRangeFills", "setRangeTextDecoration"])
    target[method] = (...args) => writes.push([method, ...copy(args)]);
  const sdk = installNativeTextRangeSdkMock(target, { mixed, toRuntime });
  target.exportAsync = async () => ({ document: sdk.projectRest({ id, type: "TEXT" }) });
  const source = { type: "text", text: characters, textSource: characters, textFlow: "wrap", fill: "#000000",
    fontFamily: "Inter", fontSize: 20, fontWeight: 400, fontStyle: "normal", lineHeight: 24, lineHeightUnit: "pixels",
    letterSpacing: 0, textAlign: "left", textDecoration: "none",
    textRanges: { version: 1, sourceSignature: JSON.stringify([characters]),
      ranges: [{ start: 4, end: 10, fill: "#1d70b8", href: "https://example.com/" }] } };
  return { target, source, sdk, writes, hints };
}

test("synthetic SDK applies real complete writer and independently validates final paint/link proof", async () => {
  const value = entry();
  applyCreatedNativeTextRanges(value.target, value.source);
  const rest = (await value.target.exportAsync()).document;
  assert.equal(value.writes.length, 9);
  assert.equal(value.target.fills, mixed); assert.equal(value.target.hyperlink, mixed);
  assert.equal(rest.characterStyleOverrides.length, 13, "REST overrides count scalars, SDK uses UTF16");
  const segments = value.target.getStyledTextSegments(NATIVE_TEXT_RANGE_FIELDS);
  assert.deepEqual(segments.map(segment => [segment.start, segment.end]), [[0, 4], [4, 10], [10, 14]]);
  assert.equal(value.target.getRangeHyperlink(0, 4), 1, "raw SDK unknown is distinct from segment null");
  assert.equal(segments[0].hyperlink, null);
  const bound = captureBoundNativeTextRanges(value.target, rest, mixed);
  assert.equal(bound.status, "bound", JSON.stringify(bound.diagnostics));
  const imported = importNativeTextRanges({ rest, source: bound.source, canonicalNode: value.source });
  assert.equal(imported.status, "admitted-intent", JSON.stringify(imported.diagnostics));
  await finalizeCreatedNativeTextRanges([value], { mixed, pluginId: "mock-test", assertOwned: target => assert.equal(target, value.target) });
  assert.equal(value.hints.length, 1);
  assert.deepEqual(restoreNativeTextRangeHint({ rest, source: bound.source, canonicalNode: value.source,
    hint: value.hints[0].value, pluginId: "mock-test", key: value.hints[0].key }),
  { fill: "#000000", textRanges: value.source.textRanges });
});

test("synthetic helper preserves setter failures and a changed live range cannot save author metadata", async () => {
  const value = entry();
  const saved = value.target.setRangeFills;
  value.target.setRangeFills = function (...args) { saved.apply(this, args); throw new Error("stored setter failure"); };
  assert.throws(() => applyCreatedNativeTextRanges(value.target, value.source), /stored setter failure/);
  assert.equal(value.sdk.history.length, 2, "the two successful native operations remain observed");
  const changed = entry(); applyCreatedNativeTextRanges(changed.target, changed.source);
  changed.target.setRangeFills(4, 10, [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }]);
  await assert.rejects(finalizeCreatedNativeTextRanges([changed], { mixed, pluginId: "mock-test", assertOwned() {} }),
    error => error.code === "NATIVE_TEXT_RANGE_HINT_EFFECTIVE");
  assert.equal(changed.hints.length, 0);
});

test("VM mock values enter the plugin realm while production capture keeps rejecting foreign records", async () => {
  const captureCode = (await readFile(new URL("../../../apps/design-studio/app/figma-plugin/text-range-capture.mjs", import.meta.url), "utf8"))
    .replace("export function captureNativeTextRangeObservations", "function captureNativeTextRangeObservations");
  const context = vm.createContext({ mixed, fields: copy(NATIVE_TEXT_RANGE_FIELDS), scalarFields: copy(NATIVE_TEXT_RANGE_SCALAR_ONLY_FIELDS) });
  vm.runInContext(`${captureCode}\nglobalThis.capture = captureNativeTextRangeObservations; globalThis.fromJson = JSON.parse;`, context);
  const foreign = entry(); applyCreatedNativeTextRanges(foreign.target, foreign.source);
  context.target = foreign.target;
  assert.equal(vm.runInContext("capture(target, mixed, {fields,scalarFields}).status", context), "unsupported");
  const native = entry({ toRuntime: value => context.fromJson(JSON.stringify(value)) });
  applyCreatedNativeTextRanges(native.target, native.source);
  context.target = native.target;
  // The actual factory assigns these object-valued setters inside the VM.
  vm.runInContext('target.fontName={family:"Inter",style:"Regular"};target.lineHeight={unit:"PIXELS",value:24};target.letterSpacing={unit:"PIXELS",value:0}', context);
  const result = vm.runInContext("capture(target, mixed, {fields,scalarFields})", context);
  assert.equal(result.status, "captured", JSON.stringify(result.diagnostics));
  assert.equal(result.observations.scalars.fontName.kind, "value");
  const bound = buildNativeTextRangeSource({ rest: copy((await native.target.exportAsync()).document), ...copy(result.observations) });
  assert.equal(bound.status, "bound", JSON.stringify(bound.diagnostics));
});
