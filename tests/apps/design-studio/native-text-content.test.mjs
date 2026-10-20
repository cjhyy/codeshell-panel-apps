import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeTextContent, nativeTextPlan } from "../../../apps/design-studio/app/text-content.mjs";
import { textMetricsSignature, textSourceMetricsSignature } from "../../../apps/design-studio/app/text-metrics.mjs";

const source = "Text wraps across ordinary block flow when the parent frame becomes narrower.";
const display = "Text wraps across ordinary block flow when the parent frame \nbecomes narrower.";
const wrapped = () => {
  const node = { text: display, textSource: source, fontFamily: "Arial", fontSize: 20,
    fontWeight: 400, lineHeight: 1.2, textFlow: "wrap", layoutSizingHorizontal: "fill", layoutSizingVertical: "hug" };
  node.textMetrics = { version: 1, signature: textMetricsSignature(node), sourceSignature: textSourceMetricsSignature(node),
    lineWidths: [542, 170], lineInkBounds: [0, 1].map(() => ({ x: 0, y: 0, width: 10, height: 20 })),
    height: 44, fontAvailable: true };
  return node;
};

test("native text uses authored characters without browser soft breaks and retains Hug/Fill", () => {
  const node = wrapped();
  assert.deepEqual(nativeTextPlan(node), { characters: source, autoResize: "HEIGHT", truncation: "DISABLED", maxLines: null });
  node.fontSize = 24;
  assert.equal(nativeTextContent(node), source, "Typography edits do not author line breaks");
  delete node.textMetrics;
  assert.equal(nativeTextContent(node), source, "Older receipts may be absent when only soft breaks differ");
  const preformatted = "  explicit first line  \n\n\tsecond line with trailing spaces  ";
  assert.equal(nativeTextContent({ text: preformatted, textSource: preformatted }), preformatted);
  assert.equal(nativeTextContent({ text: "first\n\nline\ncontinues", textSource: "first\n\nline continues" }), "first\n\nline\ncontinues");
});

test("a direct display edit never resurrects stale source and source-only edits use the authored update", () => {
  const direct = wrapped();
  direct.text = "Edited visible text\nwith an authored hard line.";
  assert.equal(nativeTextContent(direct), direct.text);
  const newlineEdit = wrapped();
  newlineEdit.text = `${source}\n`;
  assert.equal(nativeTextContent(newlineEdit), newlineEdit.text, "An explicit newline edit with a prior receipt is content");
  delete newlineEdit.textMetrics.sourceSignature;
  assert.equal(nativeTextContent(newlineEdit), newlineEdit.text, "Older receipts still identify a changed display");
  assert.equal(nativeTextContent({ text: "first\nsecond", textSource: "firstsecond" }), "first\nsecond",
    "Unmarked text does not imply browser wrapping");
  const sourceEdit = wrapped();
  sourceEdit.textSource = "Edited authored source\n\nretains these explicit lines.";
  assert.equal(nativeTextContent(sourceEdit), sourceEdit.textSource);
  const baseline = { text: display, textSource: source };
  assert.equal(nativeTextContent({ text: display, textSource: "Updated source without a receipt" }, baseline), "Updated source without a receipt");
  assert.equal(nativeTextContent({ text: "Current edit", textSource: "Stale source" }), "Current edit");
});

test("native ellipsis keeps the full authored text and uses native one-line truncation", () => {
  const node = { text: "Full authored…", textSource: "Full authored content is editable", textOverflow: "ellipsis" };
  assert.deepEqual(nativeTextPlan(node), { characters: node.textSource, autoResize: "NONE", truncation: "ENDING", maxLines: 1 });
  assert.equal(nativeTextContent({ ...node, text: "Edited label…" }), "Edited label…");
});

test("pixel unit provenance preserves explicit newline edits and authored source despite stale typography", () => {
  const node = wrapped(); Object.assign(node, { lineHeight: 20, lineHeightUnit: "pixels", text: "Alpha \nBeta", textSource: "Alpha Beta" });
  node.textMetrics.signature = textMetricsSignature(node); node.textMetrics.sourceSignature = textSourceMetricsSignature(node);
  assert.equal(JSON.parse(node.textMetrics.signature).length, 9);
  assert.equal(nativeTextContent(node), "Alpha Beta");
  node.fontSize = 24; assert.equal(nativeTextContent(node), "Alpha Beta", "Stale typography retains content provenance");
  node.text = "Alpha\n Beta"; assert.equal(nativeTextContent(node), "Alpha\n Beta", "New authored line break must not resurrect stale source");
  node.text = "Alpha \nBeta"; node.textSource = "Edited source\nwith explicit LF";
  assert.equal(nativeTextContent(node), node.textSource);
  for (const signature of [JSON.stringify(["Edited display", "Arial", "", 16, 400, "normal", 0, 20, "relative"]), JSON.stringify(["Edited display", "Arial", "", 16, 400, "normal", 0, 20, "pixels", "extra"])]) {
    const invalid = { ...node, text: "Edited display", textSource: "Stale source", textMetrics: { ...node.textMetrics, signature } };
    assert.equal(nativeTextContent(invalid), "Edited display", "Malformed9/10 metadata cannot certify source content");
  }
});
