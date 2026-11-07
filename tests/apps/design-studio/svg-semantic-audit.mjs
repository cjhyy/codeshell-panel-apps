// Offline replay of the 235 R008 SVG rows against the authored exact vector
// geometry. Read-only inputs; derived output only. Usage:
//   node tests/apps/design-studio/svg-semantic-audit.mjs R008_EVIDENCE OUTPUT REAL_BACKUP [R009_SVG_SUMMARY]
// The authored geometry comes from the document model (normalizeDesignDocument,
// the input every renderer consumes). exportDesignSvg, frontend-export and
// browser paint boxes are deliberately not imported.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {PNG} from "pngjs";
import {normalizeDesignDocument} from "../../../apps/design-studio/app/document.mjs";
import {
  SVG_SEMANTIC_STATUS as S, SVG_SEMANTIC_TOLERANCES as T, addCoverageDelta, compareFill, compareStroke,
  compareSvgSemantics, offsetRoundedRect, oracleCoverage, paintRegion, roundedRect, shiftCoverage, signedDistance,
} from "./svg-semantic-metrics.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const parseRgb = value => /^#[a-f\d]{6}$/iu.test(value ?? "") ? [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)) : null;
const transparent = value => value === undefined || value === null || value === "transparent" || value === "none";
const counts = (items, key) => Object.fromEntries([...new Set(items.map(key))].sort().map(value => [value, items.filter(item => key(item) === value).length]));

function ancestorsOf(node, index) {
  const chain = [];
  for (let parent = index.get(node.parentId), seen = new Set(); parent && !seen.has(parent.id); parent = index.get(parent.parentId)) {
    seen.add(parent.id); chain.push(parent);
  }
  return chain;
}

/** Device-space oracle spec; unsupported page semantics are reported, never approximated. */
function specFor(row, node, ancestors, canvas) {
  const device = (box, radius = 0) => ({x: (box.x - row.tile.x) * row.scale, y: (box.y - row.tile.y) * row.scale,
    width: box.width * row.scale, height: box.height * row.scale, radius: radius * row.scale});
  const reasons = [];
  if (node.rotation || ancestors.some(entry => entry.rotation)) reasons.push("rotation in node/ancestor chain");
  if ((node.opacity ?? 1) !== 1 || ancestors.some(entry => (entry.opacity ?? 1) !== 1)) reasons.push("opacity below 1");
  if (node.shadow || node.shadowStack || node.fillPaints || node.cornerRadii || node.strokeSides) reasons.push("shadow/paint stack/per-corner/per-side semantics");
  const isStroke = node.strokeWidth > 0 && !transparent(node.stroke);
  if (isStroke && !transparent(node.fill)) reasons.push("stroked shape with own fill");
  const backgroundOwner = ancestors.find(entry => parseRgb(entry.fill));
  if (ancestors.some(entry => entry.fillPaints?.some(paint => paint.type !== "SOLID"))) reasons.push("gradient/image ancestor paint");
  const clips = ancestors.filter(entry => entry.clipContent).map(entry => device(entry, entry.cornerRadius ?? 0));
  const spec = {shape: {type: node.type, ...device(node, node.cornerRadius ?? 0), rotation: node.rotation ?? 0, cornerRadii: node.cornerRadii},
    paint: isStroke ? "stroke" : "fill", strokeWidth: (node.strokeWidth ?? 0) * row.scale, strokeAlign: node.strokeAlign ?? "center", clips};
  return {spec, reasons, foreground: parseRgb(isStroke ? node.stroke : node.fill),
    background: parseRgb(backgroundOwner?.fill) ?? parseRgb(canvas.background) ?? [255, 255, 255],
    backgroundOwner: backgroundOwner ? {id: backgroundOwner.id, box: device(backgroundOwner, backgroundOwner.cornerRadius ?? 0),
      strokeReach: (backgroundOwner.strokeWidth > 0 && !transparent(backgroundOwner.stroke) ? backgroundOwner.strokeWidth : 0) * row.scale} : {id: "canvas"}};
}

/** The uniform-background owner must contain the whole window, clear of its
 * own (possibly rounded) stroked border; the shape is convex, so four corners suffice. */
function ownerCovers(owner, window) {
  const inner = offsetRoundedRect(roundedRect(owner.box), -owner.strokeReach);
  return Boolean(inner) && [[window.left, window.top], [window.left + window.width, window.top], [window.left, window.top + window.height],
    [window.left + window.width, window.top + window.height]].every(([x, y]) => signedDistance(inner, x, y) <= 0);
}

function strokeSummary(result) {
  const probes = result.probes.filter(probe => probe.error);
  const pick = (field, key) => probes.length ? Math.max(...probes.map(probe => Math.abs(probe[key][field]))) : null;
  return {statusCounts: result.counts, maxAbsErrorDevicePx: {centroid: pick("centroid", "error"), width: pick("width", "error")},
    maxAbsNominalDevicePx: {centroid: pick("centroid", "nominal"), width: pick("width", "nominal")},
    maxAbsOperatorBiasDevicePx: {centroid: pick("centroid", "operatorBias"), width: pick("width", "operatorBias")}};
}

/** Controls on the real SVG raster: each must be rejected for the row to keep a pass. */
function realControls(row, result, region) {
  const {actual, oracle} = result.rasters, outcomes = {};
  const judge = candidate => (region.paint === "stroke" ? compareStroke({actual: candidate, oracle, region}) : compareFill({actual: candidate, oracle, region})).status;
  outcomes.shiftX1 = judge(shiftCoverage(actual, 1, 0));
  outcomes.shiftY1 = judge(shiftCoverage(actual, 0, 1));
  const delta = change => addCoverageDelta(actual, oracleCoverage(paintRegion(change), actual), oracle);
  if (region.paint === "stroke") {
    outcomes.strokeWidthPlusHalf = judge(delta({...row.spec, strokeWidth: row.spec.strokeWidth + .5}));
    outcomes.oneEdgePlus1 = judge(delta({...row.spec, shape: {...row.spec.shape, height: row.spec.shape.height + 1}}));
  } else {
    outcomes.fillWidthPlus1 = judge(delta({...row.spec, shape: {...row.spec.shape, width: row.spec.shape.width + 1}}));
    outcomes.fillHeightPlus1 = judge(delta({...row.spec, shape: {...row.spec.shape, height: row.spec.shape.height + 1}}));
  }
  return {outcomes, allRejected: Object.values(outcomes).every(status => status === S.FAIL)};
}

const [oldArg, outputArg, realArg, r009Arg] = process.argv.slice(2);
assert(oldArg && outputArg && realArg, "usage: node svg-semantic-audit.mjs R008_EVIDENCE OUTPUT REAL_BACKUP [R009_SVG_SUMMARY]");
const old = resolve(oldArg), output = resolve(outputArg), realPath = resolve(realArg), startedUtc = new Date().toISOString();
assert(!output.startsWith(old + "/") && output !== old, "old raw is read-only");
const sourcePath = join(old, "final-real-rows.json"), sourceBytes = await readFile(sourcePath), realBytes = await readFile(realPath);
const r009Bytes = r009Arg ? await readFile(resolve(r009Arg)) : null;
const selected = JSON.parse(sourceBytes).filter(row => row.offline?.blockerClass === "SVG_PRECISE_UNEXPLAINED_STROKE");
assert.equal(selected.length, 235, "R008 denominator must remain exact");
assert.equal(new Set(selected.map(row => JSON.stringify([row.page, row.id, row.route, row.matrix]))).size, 235, "unique source rows");
const design = normalizeDesignDocument(JSON.parse(realBytes).document);
const pages = new Map(design.pages.map(page => [page.id, new Map(page.nodes.map(node => [node.id, node]))]));
const results = [], pngHashes = new Map();
const loadPng = async path => { const bytes = await readFile(path); pngHashes.set(path, sha(bytes)); return PNG.sync.read(bytes); };

for (const row of selected) {
  assert.equal(row.route, "svg");
  const index = pages.get(row.page), node = index?.get(row.id);
  assert(node, `authored node ${row.page}/${row.id}`);
  for (const field of ["x", "y", "width", "height"]) assert.equal(node[field], row.geometry[field], `capture geometry of ${row.id} must equal the authored document`);
  const ancestors = ancestorsOf(node, index), plan = specFor(row, node, ancestors, design.canvas);
  const oldStroke = Boolean(row.value.strokeDeltas?.length);
  const entry = {page: row.page, id: row.id, matrix: row.matrix, scale: row.scale, tile: row.tile, kind: plan.spec.paint,
    oldKind: oldStroke ? "stroke-probes" : "fill-without-stroke-probes", authoredCss: {x: node.x, y: node.y, width: node.width, height: node.height,
      cornerRadius: node.cornerRadius ?? 0, strokeWidth: node.strokeWidth ?? 0, stroke: node.stroke, fill: node.fill},
    spec: plan.spec, foreground: plan.foreground, background: plan.background, backgroundOwner: plan.backgroundOwner.id,
    paths: {svg: row.paths.svg, html: row.paths.html}, oldGateFailures: row.value.gateFailures, oldGeometryFailures: row.value.geometryFailures};
  results.push(entry);
  if (plan.reasons.length) { Object.assign(entry, {status: S.UNSUPPORTED, reason: plan.reasons.join("; ")}); continue; }
  let svg, html;
  try { svg = await loadPng(row.paths.svg); html = await loadPng(row.paths.html); }
  catch (error) { Object.assign(entry, {status: S.MISSING, reason: String(error)}); continue; }
  const result = compareSvgSemantics(svg, plan.spec, {foreground: plan.foreground, background: plan.background});
  entry.status = result.status; entry.reason = result.reason ?? null; entry.window = result.window ?? null;
  if (result.window && plan.backgroundOwner.box && !ownerCovers(plan.backgroundOwner, result.window)) {
    Object.assign(entry, {status: S.UNSUPPORTED, reason: "background owner does not cover the measurement window"}); continue;
  }
  if (!result.rasters) continue;
  const region = paintRegion(plan.spec);
  if (result.kind === "stroke") {
    Object.assign(entry, strokeSummary(result));
    entry.probes = result.probes.map(probe => ({index: probe.index, fraction: probe.fraction, status: probe.status, inward: probe.inward,
      oracle: probe.oracle && {centroid: probe.oracle.centroid, width: probe.oracle.width},
      actual: probe.actual && {centroid: probe.actual.centroid, width: probe.actual.width, residual: probe.actual.residual},
      error: probe.error ?? null}));
    const oldProbes = new Map((row.value.strokeEdges?.probes ?? []).map(probe => [probe.index, probe]));
    const consistency = entry.probes.filter(probe => probe.actual?.centroid !== null && probe.actual && oldProbes.has(probe.index)).map(probe => ({
      centroid: Math.abs(probe.actual.centroid - oldProbes.get(probe.index).centroid), width: Math.abs(probe.actual.width - oldProbes.get(probe.index).width)}));
    entry.oldSvgProbeConsistency = consistency.length ? {matched: consistency.length, maxAbsCentroid: Math.max(...consistency.map(item => item.centroid)), maxAbsWidth: Math.max(...consistency.map(item => item.width))} : null;
    entry.oldSvgMinusHtmlCss = {centroid: Math.max(...row.value.strokeDeltas.map(delta => Math.abs(delta.centroid))) / row.scale,
      width: Math.max(...row.value.strokeDeltas.map(delta => Math.abs(delta.width))) / row.scale};
  } else {
    Object.assign(entry, {observability: result.observability, oracle: result.oracle, actual: result.actual, nominal: result.nominal, error: result.error ?? null});
    entry.operatorBias = {width: result.oracle.width === null ? null : result.oracle.width - result.nominal.width, height: result.oracle.height === null ? null : result.oracle.height - result.nominal.height,
      centroid: Math.hypot(result.oracle.centroidX - result.nominal.centroidX, result.oracle.centroidY - result.nominal.centroidY)};
    entry.oldSvgMinusHtmlDevice = row.value.delta;
  }
  entry.controls = realControls({spec: plan.spec}, result, region);
  if (entry.status === S.PASS && !entry.controls.allRejected) Object.assign(entry, {status: S.UNOBSERVABLE, reason: "a real-raster negative control was not rejected"});
  const reference = compareSvgSemantics(html, plan.spec, {foreground: plan.foreground, background: plan.background});
  entry.htmlVsAuthoredDescriptive = {status: reference.status, ...(reference.kind === "stroke" ? strokeSummary(reference) : {error: reference.error ?? null})};
}

const stroke = results.filter(row => row.kind === "stroke"), fill = results.filter(row => row.kind === "fill");
const probes = stroke.flatMap(row => (row.probes ?? []).map(probe => ({...probe, row})));
const scored = probes.filter(probe => probe.error);
const top = (items, value) => { const best = [...items].sort((a, b) => value(b) - value(a))[0]; return best ?? null; };
const describeProbe = (probe, field) => probe && {page: probe.row.page, id: probe.row.id, matrix: probe.row.matrix, index: probe.index, fraction: probe.fraction,
  errorDevicePx: probe.error[field], oracle: probe.oracle, actual: probe.actual, svgPng: probe.row.paths.svg};
const fillScored = fill.filter(row => row.error);
const describeFill = (row, field) => row && {page: row.page, id: row.id, matrix: row.matrix, errorDevicePx: row.error[field], oracle: row.oracle, actual: row.actual, svgPng: row.paths.svg};
const htmlStroke = stroke.filter(row => row.htmlVsAuthoredDescriptive?.maxAbsErrorDevicePx);
const summary = {
  rows: results.length, sourceNodes: new Set(results.map(row => row.id)).size,
  strokeRows: stroke.length, strokeSourceNodes: new Set(stroke.map(row => row.id)).size,
  fillRows: fill.length, fillSourceNodes: new Set(fill.map(row => row.id)).size,
  statusCounts: counts(results, row => row.status),
  byKind: {stroke: counts(stroke, row => row.status), fill: counts(fill, row => row.status)},
  byMatrix: Object.fromEntries([...new Set(results.map(row => row.matrix))].sort().map(matrix => [matrix, counts(results.filter(row => row.matrix === matrix), row => row.status)])),
  validDenominator: results.filter(row => [S.PASS, S.FAIL].includes(row.status)).length,
  sourceNodesAllPass: [...new Set(results.map(row => row.id))].filter(id => results.filter(row => row.id === id).every(row => row.status === S.PASS)).length,
  strokeProbes: {total: probes.length, statusCounts: counts(probes, probe => probe.status)},
  maxima: {
    strokeCentroid: describeProbe(top(scored, probe => Math.abs(probe.error.centroid)), "centroid"),
    strokeWidth: describeProbe(top(scored, probe => Math.abs(probe.error.width)), "width"),
    fillCentroid: describeFill(top(fillScored, row => row.error.centroid), "centroid"),
    fillWidth: describeFill(top(fillScored.filter(row => row.error.width !== null), row => Math.abs(row.error.width)), "width"),
    fillHeight: describeFill(top(fillScored.filter(row => row.error.height !== null), row => Math.abs(row.error.height)), "height"),
    strokeOperatorBias: {centroid: Math.max(...scored.map(probe => Math.abs(probe.oracle.centroid))), width: Math.max(...stroke.filter(row => row.maxAbsOperatorBiasDevicePx).map(row => row.maxAbsOperatorBiasDevicePx.width))},
    strokeNominal: {centroid: Math.max(...scored.map(probe => Math.abs(probe.actual.centroid))), width: Math.max(...stroke.filter(row => row.maxAbsNominalDevicePx).map(row => row.maxAbsNominalDevicePx.width))},
    fillOperatorBias: {centroid: Math.max(...fill.filter(row => row.operatorBias).map(row => row.operatorBias.centroid)),
      width: Math.max(...fill.filter(row => row.operatorBias?.width !== null && row.operatorBias).map(row => Math.abs(row.operatorBias.width))),
      height: Math.max(...fill.filter(row => row.operatorBias?.height !== null && row.operatorBias).map(row => Math.abs(row.operatorBias.height)))},
  },
  controls: {rows: results.filter(row => row.controls).length, allRejectedRows: results.filter(row => row.controls?.allRejected).length,
    outcomes: Object.fromEntries([...new Set(results.flatMap(row => Object.keys(row.controls?.outcomes ?? {})))].map(name => [name, counts(results.filter(row => row.controls?.outcomes[name]), row => row.controls.outcomes[name])]))},
  oldSvgProbeConsistency: {rows: stroke.filter(row => row.oldSvgProbeConsistency).length,
    maxAbsCentroid: Math.max(...stroke.filter(row => row.oldSvgProbeConsistency).map(row => row.oldSvgProbeConsistency.maxAbsCentroid)),
    maxAbsWidth: Math.max(...stroke.filter(row => row.oldSvgProbeConsistency).map(row => row.oldSvgProbeConsistency.maxAbsWidth))},
  descriptiveHtml: {
    oldSvgMinusHtmlMaxCss: {strokeCentroid: Math.max(...stroke.map(row => row.oldSvgMinusHtmlCss?.centroid ?? 0)), strokeWidth: Math.max(...stroke.map(row => row.oldSvgMinusHtmlCss?.width ?? 0))},
    htmlVsAuthoredStatus: counts(results.filter(row => row.htmlVsAuthoredDescriptive), row => row.htmlVsAuthoredDescriptive.status),
    htmlVsAuthoredMaxDevice: {strokeCentroid: Math.max(...htmlStroke.map(row => row.htmlVsAuthoredDescriptive.maxAbsErrorDevicePx.centroid ?? 0)),
      strokeWidth: Math.max(...htmlStroke.map(row => row.htmlVsAuthoredDescriptive.maxAbsErrorDevicePx.width ?? 0)),
      fillCentroid: Math.max(...fill.map(row => row.htmlVsAuthoredDescriptive?.error?.centroid ?? 0)),
      fillWidth: Math.max(...fill.map(row => Math.abs(row.htmlVsAuthoredDescriptive?.error?.width ?? 0))),
      fillHeight: Math.max(...fill.map(row => Math.abs(row.htmlVsAuthoredDescriptive?.error?.height ?? 0)))},
  },
};
const receipt = {createdUtc: new Date().toISOString(), startedUtc, argv: process.argv, derivedOffline: true, rawCapturesChanged: false,
  contract: {tolerances: T, gate: "measure(SVG raster) - measure(exact-area raster of authored geometry), identical linear coverage operator"},
  oldRuleRetained: r009Bytes ? {path: resolve(r009Arg), sha256: sha(r009Bytes), summary: JSON.parse(r009Bytes).summary} : null,
  source: {path: sourcePath, sha256: sha(sourceBytes)}, sourceDocument: {path: realPath, sha256: sha(realBytes)},
  pngs: pngHashes.size, summary,
  rows: results.map(row => ({...row, svgSha256: pngHashes.get(row.paths.svg) ?? null, htmlSha256: pngHashes.get(row.paths.html) ?? null}))};
await mkdir(output, {recursive: true});
await writeFile(join(output, "svg-semantic-audit.json"), JSON.stringify(receipt, null, 1) + "\n");
await writeFile(join(output, "summary.json"), JSON.stringify({...receipt, rows: undefined}, null, 2) + "\n");
assert.equal(sha(await readFile(sourcePath)), receipt.source.sha256, "old raw changed");
assert.equal(sha(await readFile(realPath)), receipt.sourceDocument.sha256, "user source changed");
console.log(JSON.stringify(summary, null, 2));
