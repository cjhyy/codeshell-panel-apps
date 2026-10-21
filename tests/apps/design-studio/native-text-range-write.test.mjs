import assert from "node:assert/strict";
import { test } from "node:test";
import { applyCreatedNativeTextRanges } from "../../../apps/design-studio/app/figma-plugin/text-range-write.mjs";

function fixture() {
  const textSource = "A😀 linked\nend";
  return { type: "text", fill: "#000000", text: "A😀\n linked\nend", textSource, textFlow: "wrap",
    textRanges: { version: 1, sourceSignature: JSON.stringify([textSource]),
      ranges: [{ start: 4, end: 10, fill: "#1d70b8", href: "https://example.com/" }] } };
}
function sdk(characters) {
  const calls = [], units = Array.from({ length: characters.length }, () => ({}));
  const each = (start, end, update) => { for (let i = start; i < end; i++) Object.assign(units[i], update); };
  return { type: "TEXT", characters, calls, units,
    setRangeHyperlink(start, end, hyperlink) {
      calls.push(["hyperlink", start, end, structuredClone(hyperlink)]);
      // Exercise native hyperlink appearance defaults; later writes must win.
      each(start, end, { hyperlink, fill: "native-link-default", decoration: "UNDERLINE" });
    },
    setRangeFills(start, end, fills) {
      calls.push(["fills", start, end, structuredClone(fills)]);
      each(start, end, { fill: structuredClone(fills[0].color) });
    },
    setRangeTextDecoration(start, end, decoration) {
      calls.push(["decoration", start, end, decoration]); each(start, end, { decoration });
    },
  };
}

test("new native Text writes full source-indexed gap/color/link runs and restores appearance after native link defaults", () => {
  const source = fixture(), before = structuredClone(source), node = sdk(source.textSource);
  const plan = applyCreatedNativeTextRanges(node, source);
  assert.equal(plan.characters, "A😀 linked\nend");
  assert.deepEqual(plan.runs.map(run => [run.start, run.end]), [[0, 4], [4, 10], [10, 14]]);
  assert.deepEqual(node.calls.map(call => call[0]), ["hyperlink", "fills", "decoration", "hyperlink", "fills", "decoration", "hyperlink", "fills", "decoration"]);
  for (let i = 0; i < node.units.length; i++) {
    assert.deepEqual(node.units[i], { hyperlink: i >= 4 && i < 10 ? { type: "URL", value: "https://example.com/" } : null,
      fill: i >= 4 && i < 10 ? { r: 29 / 255, g: 112 / 255, b: 184 / 255 } : { r: 0, g: 0, b: 0 }, decoration: "NONE" });
  }
  assert.deepEqual(source, before);
  assert.equal(node.characters, source.textSource);
});

test("invalid range plans and unavailable native methods fail before the first range write", () => {
  for (const change of [source => source.textRanges.ranges[0].href = "#",
    source => source.textRanges.ranges[0].textDecoration = "underline",
    source => source.textRanges.ranges[0].end = 99]) {
    const source = fixture(); change(source); const node = sdk(source.textSource);
    assert.throws(() => applyCreatedNativeTextRanges(node, source), error => typeof error.code === "string" && error.message.length < 250);
    assert.deepEqual(node.calls, []);
  }
  const source = fixture();
  for (const mutation of [node => delete node.setRangeFills, node => node.characters = source.text]) {
    const node = sdk(source.textSource); mutation(node);
    assert.throws(() => applyCreatedNativeTextRanges(node, source), error => error.code === "TEXT_RANGES_NATIVE_WRITE_UNAVAILABLE");
    assert.deepEqual(node.calls, []);
  }
});

test("legacy Text stays untouched and empty authored range input performs zero writes", () => {
  assert.equal(applyCreatedNativeTextRanges(null, { type: "text", text: "old" }), undefined);
  const source = { type: "text", fill: "#000000", text: "", textSource: "",
    textRanges: { version: 1, sourceSignature: '[""]', ranges: [] } }, node = sdk("");
  assert.deepEqual(applyCreatedNativeTextRanges(node, source), { characters: "", runs: [] });
  assert.deepEqual(node.calls, []);
});
