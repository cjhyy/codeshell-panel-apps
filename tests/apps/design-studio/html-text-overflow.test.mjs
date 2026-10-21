import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProductionFidelity } from "../../../scripts/design-studio-production-fidelity.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { nativeTextContent } from "../../../apps/design-studio/app/text-content.mjs";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";
import { recoverHtmlTextOverflow } from "../../../apps/design-studio/app/html-text-overflow.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";

const full = "Full authored content remains editable when the frame becomes narrower and the visible line ends in an ellipsis.";
const spaced = "  Explicit spaces stay in the authored text while the single visible line truncates.  ";
const layout = "#fixture{display:flex;flex-direction:column;width:100%;height:240px;padding:20px;gap:16px;background:#e2e8f0}.row{display:flex;min-width:0;width:100%;background:white;padding:12px}.copy{min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font:20px/24px Arial}";

test("plain CSS nowrap ellipsis retains full editable words, structural Fill and exact pixels at640/400", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-ellipsis-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const result = await runProductionFidelity({ output, cases: [{ id: "ellipsis", html: `<main id="fixture"><section class="row"><div class="copy">${full}</div></section><section class="row"><div class="copy">${spaced}</div></section></main>`, css: layout }] });
  const observed = result.cases[0];
  assert.deepEqual(observed.warnings.filter((item) => item.code !== "layout-alignment" && (item.code !== "html-line-height-intent" || !item.message.startsWith("CSS 行高已解析为长度"))), []);
  assert.deepEqual(observed.semanticIssues, []);
  assert.ok(observed.comparisons.every((item) => item.changedPixels === 0), JSON.stringify(observed.comparisons));
  const design = normalizeDesignDocument(JSON.parse(await readFile(join(output, "ellipsis/imported.codesign.json"), "utf8")));
  const texts = design.nodes.filter((node) => node.type === "text");
  assert.deepEqual(texts.map((node) => node.textSource), [full, spaced.trim()]);
  assert.ok(texts.every((node) => node.textOverflow === "ellipsis" && node.textFlow === undefined && node.layoutSizingHorizontal === "fill" && node.layoutSizingVertical === "hug"));
  assert.ok(texts.every((node) => node.text.endsWith("…") && nativeTextContent(node) === node.textSource));
  assert.equal(JSON.parse(texts[1].notes).htmlText.rawSource, spaced);
  assert.ok(design.nodes.every((node) => node.layoutPositioning !== "absolute"));
  const transfer = createFigmaTransfer(design);
  const all = transfer.pages.flatMap((page) => { const flat = []; const visit = (node) => { flat.push(node); node.children?.forEach(visit); }; page.children.forEach(visit); return flat; });
  assert.deepEqual(all.filter((node) => node.type === "text").map((node) => nativeTextContent(node)), [full, spaced.trim()]);
  const browser = await chromium.launch();
  try {
    for (const width of [640, 400]) {
      const page = await browser.newPage({ viewport: { width, height: 240 } });
      const resized = normalizeDesignDocument(JSON.parse(serializeDesignDocument(design)));
      resized.canvas.width = width;
      const root = resized.nodes.find((node) => node.parentId === "html-viewport");
      for (const node of resized.nodes) if (node.id === "html-viewport" || node === root) node.width = width;
      applyAllAutoLayouts(resized.nodes);
      await page.setContent(exportDesignFrontend(JSON.parse(serializeDesignDocument(resized))));
      const expected = PNG.sync.read(await readFile(join(output, "ellipsis", width === 640 ? "imported-source.png" : "narrow-source.png")));
      const actual = PNG.sync.read(await page.screenshot());
      const changed = actual.data.reduce((count, value, index) => count + Number(value !== expected.data[index]), 0);
      assert.equal(changed, 0, `${width}px frontend CSS differing channels`);
      await page.close();
    }
  } finally { await browser.close(); }
  assert.equal(result.passed, true);
});

test("pre ellipsis preserves significant prefix spaces in SVG and exported responsive CSS", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-pre-ellipsis-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const sources = ["  Literal  spaces and long content that stays on the same line without wrapping.  ", " ".repeat(200) + full];
  const cases = sources.map((text, index) => ({ id: `pre-ellipsis-${index}`,
    html: `<main id="fixture"><section class="row"><div class="copy">${text}</div></section></main>`,
    css: layout.replace("white-space:nowrap", "white-space:pre") }));
  const result = await runProductionFidelity({ output, cases, resizeMode: "viewport-only" });
  const browser = await chromium.launch();
  try {
    for (const [index, observed] of result.cases.entries()) {
      assert(observed.comparisons.every(item => item.changedPixels === 0), JSON.stringify(observed));
      const original = normalizeDesignDocument(JSON.parse(await readFile(join(output, observed.id, "imported.codesign.json"), "utf8")));
      assert.equal(original.nodes.find(node => node.type === "text").textSource, sources[index]);
      for (const width of [640, 400]) {
        const resized = normalizeDesignDocument(JSON.parse(serializeDesignDocument(original)));
        resized.canvas.width = width;
        resized.nodes.find(node => node.id === "html-viewport").width = width;
        applyAllAutoLayouts(resized.nodes);
        const page = await browser.newPage({ viewport: { width, height: 240 } });
        await page.setContent(exportDesignFrontend(JSON.parse(serializeDesignDocument(resized))));
        const expected = PNG.sync.read(await readFile(join(output, observed.id, width === 640 ? "imported-source.png" : "narrow-source.png")));
        const actual = PNG.sync.read(await page.screenshot());
        assert.equal(actual.data.compare(expected.data), 0, `${observed.id} at ${width}px`);
        await page.close();
      }
    }
  } finally { await browser.close(); }
});

test("nowrap clip and pre preserve clipping and literal whitespace without introducing ellipsis", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-text-clip-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const result = await runProductionFidelity({ output, cases: [
    { id: "clip", html: `<main id="fixture"><section class="row"><div class="copy">${full}</div></section></main>`, css: layout.replace("text-overflow:ellipsis", "text-overflow:clip") },
    { id: "pre", html: '<main id="fixture"><section class="row"><div class="copy">  Literal  spaces and long content that stays on the same line without wrapping.  </div></section></main>', css: layout.replace("white-space:nowrap", "white-space:pre").replace("text-overflow:ellipsis", "text-overflow:clip") },
    { id: "pre-lines", html: '<main id="fixture"><section class="row"><div class="copy">  First  literal line\n\nSecond literal line.  </div></section></main>', css: layout.replace("white-space:nowrap", "white-space:pre").replace("text-overflow:ellipsis", "text-overflow:clip") },
  ] });
  for (const observed of result.cases) {
    assert.deepEqual(observed.warnings.filter((item) => item.code !== "layout-alignment" && (item.code !== "html-line-height-intent" || !item.message.startsWith("CSS 行高已解析为长度"))), [], observed.id);
    assert.ok(observed.comparisons.every((item) => item.changedPixels === 0), JSON.stringify(observed));
    const design = normalizeDesignDocument(JSON.parse(await readFile(join(output, observed.id, "imported.codesign.json"), "utf8")));
    const text = design.nodes.find((node) => node.type === "text");
    assert.equal(text.textOverflow, undefined);
    assert.equal(text.textFlow, undefined);
    assert.ok(!text.text.endsWith("…"));
    if (observed.id === "pre") assert.equal(text.textSource, "  Literal  spaces and long content that stays on the same line without wrapping.  ");
    if (observed.id === "pre-lines") assert.equal(text.textSource, "  First  literal line\n\nSecond literal line.  ");
  }
});

test("bounded text intent keeps source immutable, preserves NBSP, and diagnoses unsupported whitespace", () => {
  const make = (changes = {}) => {
    const source = { nodeType: "container", layout: { display: "block" }, children: [{ nodeType: "text" }], cssText: {
      whiteSpace: "nowrap", textOverflow: "ellipsis", overflowX: "hidden", overflowY: "hidden",
      childElements: "0",
      generatedContent: "false",
      writingMode: "horizontal-tb", direction: "ltr", textIndent: "0px", wordSpacing: "0px",
      textTransform: "none", lineHeight: "24px", rawSource: "  A\u00a0B  ", ...changes,
    } };
    const node = { id: "frame", x: 0, y: 0, width: 100, height: 24, padding: 0, rotation: 0,
      children: [{ id: "text", type: "text", x: 0, y: 1, width: 150, height: 22,
        fontSize: 20, rotation: 0, notes: "{}" }] };
    return { source, node };
  };
  const { source, node } = make();
  const original = JSON.stringify(source);
  Object.freeze(source.cssText); Object.freeze(source);
  const warnings = [];
  recoverHtmlTextOverflow(source, node, (...args) => warnings.push(args));
  assert.equal(JSON.stringify(source), original);
  assert.deepEqual(warnings, []);
  assert.equal(node.children[0].textSource, "A\u00a0B");
  assert.equal(JSON.parse(node.children[0].notes).htmlText.rawSource, "  A\u00a0B  ");
  for (const changes of [
    { whiteSpace: "pre", rawSource: "tabs\tneed tab stops" },
    { whiteSpace: "pre", rawSource: "first\nsecond" },
    { rawSource: "中文\n换行" },
    { direction: "rtl" }, { textOverflow: '"custom"' },
    { rawSource: " ".repeat(2500) + "words" }, { rawSource: "x".repeat(4001) },
    { lineHeight: "normal" }, { lineHeight: "24garbage" }, { textIndent: "calc(1% + 1px)" },
    { generatedContent: "true" }, { childElements: "1" }, { whiteSpace: "pre-wrap" }, { overflowX: "unknown" }, { overflowX: "clip", overflowY: "visible" },
  ]) {
    const { source, node } = make(changes), before = JSON.stringify(node), warnings = [];
    recoverHtmlTextOverflow(source, node, (...args) => warnings.push(args));
    assert.equal(JSON.stringify(node), before, JSON.stringify(changes));
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0][0], "html-text-overflow");
  }
  const breaks = make({ rawSource: "  first\n\n second  " }), breakWarnings = [];
  recoverHtmlTextOverflow(breaks.source, breaks.node, (...args) => breakWarnings.push(args));
  assert.equal(breaks.node.children[0].textSource, "first second");
  assert.equal(JSON.parse(breaks.node.children[0].notes).htmlText.rawSource, "  first\n\n second  ");
  assert.equal(breakWarnings[0][0], "html-text-segment-break");
  const aligned = make(); aligned.node.children[0].textAlign = "center";
  const beforeAligned = JSON.stringify(aligned.node), alignedWarnings = [];
  recoverHtmlTextOverflow(aligned.source, aligned.node, (...args) => alignedWarnings.push(args));
  assert.equal(JSON.stringify(aligned.node), beforeAligned);
  assert.equal(alignedWarnings[0][0], "html-text-overflow");
});

test("text recovery keeps border and padding geometry structural", () => {
  const source = { nodeType: "container", layout: { display: "block" }, children: [{ nodeType: "text" }], cssText: {
    whiteSpace: "nowrap", textOverflow: "ellipsis", overflowX: "hidden", overflowY: "hidden", childElements: "0", generatedContent: "false",
    writingMode: "horizontal-tb", direction: "ltr", textIndent: "0px", wordSpacing: "normal", textTransform: "none", lineHeight: "24px", rawSource: full,
  } };
  const frame = { id: "frame", x: 20, y: 20, width: 200, height: 50, paddingTop: 13, paddingRight: 13, paddingBottom: 13, paddingLeft: 13,
    stroke: "#112233", strokeWidth: 1, rotation: 0, children: [{ id: "text", type: "text", x: 33, y: 34, width: 994, height: 22, fontSize: 20, rotation: 0, notes: "{}" }] };
  recoverHtmlTextOverflow(source, frame, () => assert.fail("supported text should not warn"));
  assert.equal(frame.strokeWidth, 1); assert.equal(frame.stroke, "#112233");
  assert.deepEqual([frame.x, frame.y, frame.width, frame.height, frame.paddingLeft, frame.paddingTop], [20, 20, 200, 50, 13, 13]);
  assert.deepEqual([frame.children[0].x, frame.children[0].width, frame.children[0].layoutBaselineOffset], [33, 174, 1]);
});

test("generated pseudo text is diagnosed instead of reauthoring it from DOM textContent", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-ellipsis-generated-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const result = await runProductionFidelity({ output, cases: [{ id: "pseudo", html: '<main id="fixture"><section class="row"><div class="copy">Original visible words</div></section></main>', css: layout + '.copy::before{content:"Generated prefix: "}' }] });
  assert.ok(result.cases[0].warnings.some((item) => item.code === "html-text-overflow" && item.message.includes("生成")));
  const document = normalizeDesignDocument(JSON.parse(await readFile(join(output, "pseudo/imported.codesign.json"), "utf8")));
  assert.ok(document.nodes.every((node) => !JSON.parse(node.notes ?? "{}").htmlText));
  // The pinned converter can already omit generated runs. This case remains
  // explicitly unsupported; replacing it with DOM text would conceal the loss.
});

test("ASCII nowrap segment breaks normalize visibly while exact source and diagnostic survive", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-ellipsis-breaks-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const raw = "  First authored line\nsecond authored line.  ";
  const result = await runProductionFidelity({ output, cases: [{ id: "breaks", html: `<main id="fixture"><section class="row"><div class="copy">${raw}</div></section></main>`, css: layout }] });
  assert.ok(result.cases[0].warnings.some((item) => item.code === "html-text-segment-break"));
  assert.ok(result.cases[0].comparisons.every((item) => item.changedPixels === 0));
  const design = normalizeDesignDocument(JSON.parse(await readFile(join(output, "breaks/imported.codesign.json"), "utf8")));
  const text = design.nodes.find((node) => node.type === "text");
  assert.equal(text.textSource, "First authored line second authored line.");
  assert.equal(JSON.parse(text.notes).htmlText.rawSource, raw);
  assert.equal(nativeTextContent(text), text.textSource);
});
