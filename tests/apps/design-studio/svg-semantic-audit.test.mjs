import assert from "node:assert/strict";
import {test} from "node:test";
import {auditRow, summarizeAudit} from "./svg-semantic-audit.mjs";
import {SVG_SEMANTIC_STATUS as S, oracleCoverage, paintRegion, rgbaFromCoverage} from "./svg-semantic-metrics.mjs";

// A real-shaped R008 row (android-chat-11, DPR1/z1) without any capture files.
const canvas = {background: "#ebede9"}, size = 40;
const node = {id: "android-chat-11", type: "rectangle", x: 22.8, y: 67.7, width: 14.4, height: 12.6, cornerRadius: 1.8,
  strokeWidth: 1, stroke: "#686e67", fill: "transparent", opacity: 1, rotation: 0, parentId: "frame"};
const ancestors = [{id: "frame", type: "frame", x: 0, y: 44, width: 412, height: 70, fill: "#ffffff", opacity: 1, rotation: 0, cornerRadius: 0}];
const row = {page: "android-chat", id: node.id, matrix: "dpr1-zoom1", route: "svg", scale: 1, tile: {x: 10, y: 55, width: 40, height: 38},
  geometry: {x: 22.8, y: 67.7, width: 14.4, height: 12.6}, paths: {svg: "memory:svg", html: "memory:html"},
  value: {strokeDeltas: [{edge: "contour", fraction: 0, centroid: .3, width: 0}], strokeEdges: {probes: []}, gateFailures: [], geometryFailures: []}};
const blank = () => { const data = new Uint8Array(size * size * 4).fill(255); return {width: size, height: size, data}; };
const authored = () => rgbaFromCoverage(oracleCoverage(paintRegion({shape: {type: "rectangle", x: 12.8, y: 12.7, width: 14.4, height: 12.6, radius: 1.8},
  paint: "stroke", strokeWidth: 1}), {left: 0, top: 0, width: size, height: size}), {foreground: [0x68, 0x6e, 0x67], background: [255, 255, 255], imageWidth: size, imageHeight: size});

test("zero-coverage SVG stroke stays FAIL through the full audit row and summary", () => {
  const entry = auditRow({row, node, ancestors, canvas, svg: blank(), html: authored()});
  assert.equal(entry.status, S.FAIL);
  assert.equal(entry.probes.length, 32);
  assert.ok(entry.probes.every(probe => probe.status === S.FAIL && probe.error.centroid === null && probe.error.width < -.9));
  // Width is still a finite failing field; the undefined centroid is excluded, not zeroed.
  assert.equal(entry.maxAbsErrorDevicePx.centroid, null);
  assert.ok(entry.maxAbsErrorDevicePx.width > .9);
  assert.equal(entry.maxAbsNominalDevicePx.centroid, null);
  assert.ok(Number.isFinite(entry.maxAbsOperatorBiasDevicePx.centroid));
  const passing = auditRow({row: {...row, id: "copy"}, node, ancestors, canvas, svg: authored(), html: blank()});
  assert.equal(passing.status, S.PASS);
  assert.equal(passing.htmlVsAuthoredDescriptive.status, S.FAIL);
  const summary = summarizeAudit([entry, passing]);
  assert.deepEqual(summary.statusCounts, {[S.FAIL]: 1, [S.PASS]: 1});
  assert.equal(summary.strokeProbes.statusCounts[S.FAIL], 32);
  assert.ok(summary.maxima.strokeWidth.errorDevicePx < -.9);
  assert.equal(summary.maxima.strokeWidth.id, node.id);
  for (const value of [summary.maxima.strokeCentroid.errorDevicePx, summary.maxima.strokeNominal.centroid, summary.maxima.strokeOperatorBias.centroid])
    assert.ok(Number.isFinite(value));
});
