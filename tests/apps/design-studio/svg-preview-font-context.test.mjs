import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeDesignDocument, exportDesignSvg, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { isDesignPreviewCurrent } from "../../../apps/design-studio/app/tools/check-design.mjs";

const text = (extra = {}) => ({ id: "copy", name: "Copy", type: "text", x: 20, y: 20, width: 180, height: 60,
  text: "HMI Alpha", fontFamily: "Arial", fontSize: 20, fontWeight: 400, lineHeight: 1.6, textAlign: "left",
  fill: "#111111", stroke: "transparent", strokeWidth: 0, opacity: 1, rotation: 0, cornerRadius: 0,
  visible: true, locked: false, ...extra });
const design = (children = [text()]) => normalizeDesignDocument({ format: "codeshell.design", version: 3,
  name: "SVG font context", canvas: { width: 400, height: 240, background: "#ffffff" },
  tokens: { colors: [] }, resources: [], activePageId: "main", pages: [{ id: "main", name: "Main", children }] });
const metrics = new Map([["copy", { ascent: 19, descent: 5 }]]);

test("offline preview validation replays measured browser context without mutating the design", () => {
  const document = design(), before = serializeDesignDocument(document);
  const measured = exportDesignSvg(document, { textLineBoxMetrics: metrics });
  assert.match(measured, /data-text-line-box="alphabetic" data-text-baseline-offset="23"/u);
  assert.notEqual(measured, exportDesignSvg(document), "offline unmeasured geometry differs");
  assert.equal(isDesignPreviewCurrent(document, measured), true);
  assert.equal(isDesignPreviewCurrent(document, exportDesignSvg(document)), true);
  assert.equal(serializeDesignDocument(document), before);
});

test("font-context replay still rejects modified source, body, metadata and malformed context", () => {
  const document = design(), measured = exportDesignSvg(document, { textLineBoxMetrics: metrics });
  for (const mutation of [
    source => source.replace("HMI Alpha", "HMI Beta"),
    source => source.replace('y="43"', 'y="44"'),
    source => source.replace('data-text-baseline-offset="23"', 'data-text-baseline-offset="24"'),
    source => source.replace('data-text-baseline-offset="23"', 'data-text-baseline-offset="NaN"'),
    source => source.replace('data-text-baseline-offset="23"', 'data-text-baseline-offset="1001"'),
    source => source.replace('data-node-id="copy"', 'data-node-id="missing"'),
    source => source.replace('data-text-baseline-offset="23"', 'data-text-baseline-offset="023"'),
    source => source.replace('data-text-metrics-signature="', 'data-text-metrics-signature="stale'),
    source => `${source}\n`,
  ]) assert.equal(isDesignPreviewCurrent(document, mutation(measured)), false);
  const changed = design([text({ text: "New source" })]);
  assert.equal(isDesignPreviewCurrent(changed, measured), false);
  assert.equal(isDesignPreviewCurrent(document, null), false);
  assert.equal(isDesignPreviewCurrent(document, "x".repeat(4 * 1024 * 1024 + 1)), false);
});

test("single-line preview context is bound to line height, unit and all font metric inputs", () => {
  for (const changes of [
    { lineHeight: 2 },
    { lineHeightUnit: "pixels" },
    { lineHeight: 32, lineHeightUnit: "pixels" },
    { fontFamily: "Helvetica" },
    { fontSize: 21 },
    { fontWeight: 500 },
    { fontStyle: "italic" },
    { letterSpacing: .5 },
  ]) {
    const document = design(), svg = exportDesignSvg(document, { textLineBoxMetrics: metrics });
    Object.assign(document.nodes[0], changes);
    assert.equal(isDesignPreviewCurrent(document, svg), false, JSON.stringify(changes));
  }
});

test("XML-escaped text and identifiers keep exact source-bound metric replay", () => {
  const id = 'copy"&\'', document = design([text({ id, text: 'HMI "quotes" & <markup>' })]);
  const svg = exportDesignSvg(document, { textLineBoxMetrics: new Map([[id, { alphabeticBaseline: 23 }]]) });
  assert.equal(isDesignPreviewCurrent(document, svg), true);
  assert.match(svg, /data-text-metrics-signature="[^"]*&amp;[^"]*"/u);
  document.nodes[0].lineHeight = 2;
  assert.equal(isDesignPreviewCurrent(document, svg), false);
});

test("finite hanging offsets retain metadata-free compatibility and cannot borrow line-box metrics", () => {
  for (const offset of [-3, 0, 5.25]) {
    const document = design([text({ layoutBaselineOffset: offset })]), svg = exportDesignSvg(document);
    assert.equal(exportDesignSvg(document, { textLineBoxMetrics: metrics }), svg);
    assert.doesNotMatch(svg, /data-text-line-box/u);
    assert.equal(isDesignPreviewCurrent(document, svg), true);
    assert.equal(isDesignPreviewCurrent(document, svg.replace('data-node-id="copy"', 'data-node-id="copy" data-text-line-box="alphabetic" data-text-baseline-offset="23"')), false);
  }
});

test("repeated component instances replay identical source-text metadata and reject conflicting repeats", () => {
  const shape = { fill: "transparent", stroke: "transparent", strokeWidth: 0, opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false };
  const document = design([
    { ...shape, id: "master", name: "Master", type: "component", x: 0, y: 0, width: 200, height: 80, layout: "none", gap: 0, padding: 0, alignItems: "start", justifyContent: "start", children: [text()] },
    { ...shape, id: "first", name: "First", type: "instance", x: 0, y: 100, width: 200, height: 80, componentId: "master" },
    { ...shape, id: "second", name: "Second", type: "instance", x: 200, y: 100, width: 200, height: 80, componentId: "master" },
  ]);
  const svg = exportDesignSvg(document, { textLineBoxMetrics: metrics });
  assert.equal([...svg.matchAll(/data-text-baseline-offset="23"/gu)].length, 3);
  assert.equal(isDesignPreviewCurrent(document, svg), true);
  assert.equal(isDesignPreviewCurrent(document, svg.replace('data-text-baseline-offset="23"', 'data-text-baseline-offset="24"')), false);
});
