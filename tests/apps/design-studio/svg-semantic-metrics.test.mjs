import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";
import {
  SVG_SEMANTIC_STATUS as S, addCoverageDelta, compareFill, compareStroke, compareSvgSemantics, coverageFromRgba,
  measurementWindow, medialDepth, oracleCoverage, paintRegion, rgbaFromCoverage, shiftCoverage,
} from "./svg-semantic-metrics.mjs";

const stroke = [0x68, 0x6e, 0x67], fill = [0x9b, 0x4e, 0x2e], white = [255, 255, 255], size = 64;
const ring = (shape, extra = {}) => ({shape: {type: "rectangle", ...shape}, paint: "stroke", strokeWidth: 1, ...extra});
const solid = (shape, extra = {}) => ({shape: {type: "rectangle", ...shape}, paint: "fill", ...extra});
// Real 235-row shapes in device px (DPR1/z1 and DPR2 fractional positions).
const ringA = ring({x: 12.8, y: 12.7, width: 14.4, height: 12.6, radius: 1.8});
const ringCircle = ring({x: 12.3, y: 12.2, width: 5.4, height: 5.4, radius: 2.7});
const ringDpr2 = ring({x: 25.6, y: 25.4, width: 28.8, height: 25.2, radius: 3.6}, {strokeWidth: 2});
const strip = solid({x: 12.8, y: 12.2, width: 4.8, height: 1.12});
const pill = solid({x: 19.9, y: 24.74, width: 25.2, height: 2.52, radius: 1.26});
const rounded = solid({x: 12.4, y: 12.8, width: 7.2, height: 2.7, radius: .9});

function render(spec, color) {
  const region = paintRegion(spec);
  return rgbaFromCoverage(oracleCoverage(region, {left: 0, top: 0, width: size, height: size}), {foreground: color, background: white, imageWidth: size, imageHeight: size});
}
const moved = (spec, change) => ({...spec, shape: {...spec.shape, ...change(spec.shape)}});
const check = (image, spec, color) => compareSvgSemantics(image, spec, {foreground: color, background: white});
const maxAbs = (result, field) => Math.max(...result.probes.filter(p => p.error).map(p => Math.abs(p.error[field])));

test("oracle coverage integrates exact authored areas", () => {
  const area = spec => oracleCoverage(paintRegion(spec), {left: 0, top: 0, width: size, height: size}).alpha.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(area(solid({x: 2.2, y: 3.6, width: 10.3, height: 4.7})) - 10.3 * 4.7) < 2e-3);
  assert.ok(Math.abs(area(rounded) - (7.2 * 2.7 - (4 - Math.PI) * .81)) < 2e-3);
  // A centred ring whose radius >= w/2 has area = centre perimeter * width.
  const {width: w, height: h, radius: r} = ringA.shape;
  assert.ok(Math.abs(area(ringA) - (2 * (w + h) - 8 * r + 2 * Math.PI * r)) < 3e-3);
});

test("medial depth follows the authored axis on flats and arcs", () => {
  const circle = paintRegion(ringCircle).base;
  assert.ok(Math.abs(medialDepth(circle, {x: 15, y: 12.2, nx: 0, ny: -1}, 5) - 2.7) < 1e-6);
  const angle = -3 * Math.PI / 4, arc = {x: 15 + 2.7 * Math.cos(angle), y: 14.9 + 2.7 * Math.sin(angle), nx: Math.cos(angle), ny: Math.sin(angle)};
  assert.ok(Math.abs(medialDepth(circle, arc, 5) - 2.7) < 1e-6);
  const box = paintRegion(ring({x: 0, y: 0, width: 20, height: 12, radius: 3})).base;
  assert.ok(Math.abs(medialDepth(box, {x: 7, y: 0, nx: 0, ny: -1}, 9) - 6) < 1e-6);
  assert.ok(Math.abs(medialDepth(box, {x: 4, y: 0, nx: 0, ny: -1}, 9) - 4) < 1e-6);
});

test("authored stroke rasters pass with measurement noise far below tolerance", () => {
  for (const spec of [ringA, ringCircle, ringDpr2]) {
    const result = check(render(spec, stroke), spec, stroke);
    assert.equal(result.status, S.PASS, JSON.stringify(result.counts));
    assert.equal(result.counts.PASS, 32);
    assert.ok(maxAbs(result, "centroid") < .02 && maxAbs(result, "width") < .02);
  }
});

test("a symmetric AA blur preserves coverage integral and centroid", () => {
  const region = paintRegion(ringA), window = measurementWindow(region);
  const oracle = oracleCoverage(region, window), blurred = {...oracle, alpha: new Float64Array(oracle.alpha.length)};
  const at = (i, j) => i < 0 || j < 0 || i >= oracle.width || j >= oracle.height ? 0 : oracle.alpha[j * oracle.width + i];
  for (let j = 0; j < oracle.height; j++) for (let i = 0; i < oracle.width; i++) {
    let value = 0;
    for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) value += at(i + u, j + v) * (2 - Math.abs(u)) * (2 - Math.abs(v)) / 16;
    blurred.alpha[j * oracle.width + i] = value;
  }
  const result = compareStroke({actual: blurred, oracle, region});
  assert.equal(result.status, S.PASS);
  assert.ok(maxAbs(result, "centroid") < .12 && maxAbs(result, "width") < .12, `${maxAbs(result, "centroid")} ${maxAbs(result, "width")}`);
});

test("NEGATIVE: whole stroke displaced by 1 device px is rejected", () => {
  for (const spec of [ringA, ringCircle, ringDpr2]) for (const [dx, dy] of [[1, 0], [0, 1], [0, -1]]) {
    const result = check(render(moved(spec, s => ({x: s.x + dx, y: s.y + dy})), stroke), spec, stroke);
    assert.equal(result.status, S.FAIL);
    assert.ok(maxAbs(result, "centroid") > .9, String(maxAbs(result, "centroid")));
  }
});

test("NEGATIVE: one stroke edge displaced by 1 device px is rejected", () => {
  for (const spec of [ringA, ringDpr2]) for (const change of [s => ({height: s.height + 1}), s => ({x: s.x - 1, width: s.width + 1})]) {
    const result = check(render(moved(spec, change), stroke), spec, stroke);
    assert.equal(result.status, S.FAIL);
    assert.ok(maxAbs(result, "centroid") > .9);
  }
});

test("NEGATIVE: stroke width changed by .5 device px is rejected; .25 shift passes", () => {
  for (const spec of [ringA, ringCircle, ringDpr2]) for (const delta of [.5, -.5]) {
    const result = check(render({...spec, strokeWidth: spec.strokeWidth + delta}, stroke), spec, stroke);
    assert.equal(result.status, S.FAIL);
    assert.ok(maxAbs(result, "width") > .4 && maxAbs(result, "width") < .65, String(maxAbs(result, "width")));
  }
  const near = check(render(moved(ringA, s => ({y: s.y + .25})), stroke), ringA, stroke);
  assert.equal(near.status, S.PASS);
});

test("authored fill rasters pass; width/height/position changes of 1 device px are rejected", () => {
  for (const spec of [strip, pill, rounded]) {
    const authored = check(render(spec, fill), spec, fill);
    assert.equal(authored.status, S.PASS, JSON.stringify(authored.error));
    assert.ok(Math.abs(authored.error.width) < .02 && Math.abs(authored.error.height) < .02 && authored.error.centroid < .02);
    for (const [label, change, field] of [
      ["width+1", s => ({width: s.width + 1}), "width"], ["height+1", s => ({height: s.height + 1}), "height"],
      ["width-1", s => ({width: s.width - 1}), "width"], ["translate x", s => ({x: s.x + 1}), "centroid"],
      ["translate y", s => ({y: s.y + 1}), "centroid"]]) {
      const result = check(render(moved(spec, change), fill), spec, fill);
      assert.equal(result.status, S.FAIL, `${label} ${JSON.stringify(result.error)}`);
      assert.ok(Math.abs(result.error[field]) > .9, `${label} ${result.error[field]}`);
    }
  }
});

test("thin fills derive width from mass only through a direct whole-column height", () => {
  const result = check(render(strip, fill), strip, fill);
  assert.deepEqual(result.observability, {widthDirect: false, heightDirect: true});
  assert.ok(Math.abs(result.oracle.height - 1.12) < 2e-3 && Math.abs(result.oracle.width - 4.8) < 3e-3);
  const tiny = solid({x: 12.2, y: 12.3, width: .9, height: .6});
  const unknown = check(render(tiny, fill), tiny, fill);
  assert.equal(unknown.status, S.UNOBSERVABLE);
  assert.equal(unknown.error.width, null);
});

test("coverage-synthetic controls (not SVG inputs): pixel shift and analytic band deltas are rejected", () => {
  const region = paintRegion(ringA), window = measurementWindow(region), image = render(ringA, stroke);
  const actual = coverageFromRgba(image, {foreground: stroke, background: white, window}), oracle = oracleCoverage(region, actual);
  assert.equal(compareStroke({actual, oracle, region}).status, S.PASS);
  assert.equal(compareStroke({actual: shiftCoverage(actual, 0, 1), oracle, region}).status, S.FAIL);
  const wider = oracleCoverage(paintRegion({...ringA, strokeWidth: 1.5}), actual);
  assert.equal(compareStroke({actual: addCoverageDelta(actual, wider, oracle), oracle, region}).status, S.FAIL);
  const fillRegion = paintRegion(pill), fillWindow = measurementWindow(fillRegion);
  const fillActual = coverageFromRgba(render(pill, fill), {foreground: fill, background: white, window: fillWindow}), fillOracle = oracleCoverage(fillRegion, fillActual);
  for (const change of [s => ({width: s.width + 1}), s => ({height: s.height + 1})]) {
    const perturbed = oracleCoverage(paintRegion(moved(pill, change)), fillActual);
    assert.equal(compareFill({actual: addCoverageDelta(fillActual, perturbed, fillOracle), oracle: fillOracle, region: fillRegion}).status, S.FAIL);
  }
  assert.equal(compareFill({actual: shiftCoverage(fillActual, 1, 0), oracle: fillOracle, region: fillRegion}).status, S.FAIL);
});

test("foreign colour is sampling contamination, never pass or fail", () => {
  const image = render(ringA, stroke);
  const paint = (x, y) => image.data.set([30, 60, 220], (y * size + x) * 4);
  paint(19, 12); // on the top edge
  const one = check(image, ringA, stroke);
  assert.equal(one.status, S.PASS);
  assert.ok(one.counts.SAMPLE_CONTAMINATED >= 1);
  assert.ok(one.probes.filter(p => p.status === S.CONTAMINATED).every(p => !p.error));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if ((x + y) % 2 === 0 && Math.abs(x - 20) > 6) paint(x, y);
  assert.equal(check(image, ringA, stroke).status, S.CONTAMINATED);
});

test("unobservable, missing and unsupported data are explicit non-passes", () => {
  assert.equal(compareSvgSemantics(render(strip, fill), strip, {foreground: white, background: white}).status, S.UNOBSERVABLE);
  assert.equal(compareSvgSemantics(render(strip, fill), strip, {foreground: null, background: white}).status, S.UNOBSERVABLE);
  const clipped = {...strip, clips: [{x: 0, y: 0, width: 5, height: 5}]};
  assert.equal(check(render(strip, fill), clipped, fill).status, S.UNOBSERVABLE);
  const outside = solid({x: 60, y: 60, width: 8, height: 8});
  assert.equal(check(render(strip, fill), outside, fill).status, S.MISSING);
  assert.equal(check(render(strip, fill), {...strip, shape: {...strip.shape, type: "ellipse"}}, fill).status, S.UNSUPPORTED);
  assert.equal(check(render(strip, fill), {...strip, shape: {...strip.shape, rotation: 40}}, fill).status, S.UNSUPPORTED);
  assert.equal(check(render(ringA, stroke), {...ringA, strokeAlign: "inside"}, stroke).status, S.UNSUPPORTED);
});

test("an ancestor clip is part of the authored oracle", () => {
  const spec = {...ringA, clips: [{x: 12.8, y: 12.7, width: 14.4, height: 12.6}]};
  const result = check(render(spec, stroke), spec, stroke);
  assert.equal(result.status, S.PASS);
  // The unclipped authored stroke is half outside the clip: rejected widths.
  assert.equal(check(render(ringA, stroke), spec, stroke).status, S.FAIL);
});

test("oracle module is independent of every production renderer/exporter", async () => {
  const source = await readFile(new URL("./svg-semantic-metrics.mjs", import.meta.url), "utf8");
  assert.deepEqual([...source.matchAll(/^import .* from\s+["']([^"']+)["']/gmu)].map(match => match[1]), []);
});
