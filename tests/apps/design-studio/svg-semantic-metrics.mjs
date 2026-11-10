// Exact-vector SVG semantic metrics.
//
// The oracle below rasterises only the authored geometry (axis-aligned,
// uniform-radius rectangles, centred strokes and ancestor clip rectangles) by
// exact-area pixel coverage. It never calls the SVG exporter, the HTML
// exporter, browser paint boxes or any production renderer. Measured SVG
// pixels and the oracle are reduced by the same linear coverage integrals, so
// the box-filter/bilinear blur and curvature effects of the measurement
// operator appear identically on both sides and cancel; what remains is the
// rasteriser's departure from exact-area coverage of the authored contour.

export const SVG_SEMANTIC_TOLERANCES = Object.freeze({
  // Product contract approved for this audit, device px.
  strokeCentroid: .35,
  strokeWidth: .35,
  fillCentroid: .5,
  fillWidth: .5,
  fillHeight: .5,
  // Max per-channel distance from the foreground/background mix line before a
  // pixel is treated as foreign colour (sampling contamination), 8-bit units.
  residual: 8,
  // Existing visibility contract for 32 contour normals.
  minimumStrokeProbes: 16,
});

export const SVG_SEMANTIC_STATUS = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL_SVG_GEOMETRY",
  CONTAMINATED: "SAMPLE_CONTAMINATED",
  MISSING: "DATA_MISSING",
  UNOBSERVABLE: "UNOBSERVABLE",
  UNSUPPORTED: "UNSUPPORTED_GEOMETRY",
});

const ARC_SUBROWS = 64;

export function roundedRect({x, y, width, height, radius = 0}) {
  if (![x, y, width, height, radius].every(Number.isFinite) || !(width > 0 && height > 0) || radius < 0) return null;
  return {x, y, width, height, radius: Math.min(radius, width / 2, height / 2)};
}

/** Exact parallel offset of a rounded rectangle. A positive radius stays
 * tangent-continuous (r+d). A zero radius has SVG miter joins, so its outer
 * offset keeps sharp corners. Inner offsets past the radius become sharp. */
export function offsetRoundedRect(rect, distance) {
  const radius = rect.radius > 0 ? Math.max(0, rect.radius + distance) : 0;
  return roundedRect({x: rect.x - distance, y: rect.y - distance, width: rect.width + 2 * distance,
    height: rect.height + 2 * distance, radius});
}

/** Euclidean signed distance (negative inside). 1-Lipschitz. */
export function signedDistance(rect, px, py) {
  const r = rect.radius, hx = rect.width / 2, hy = rect.height / 2;
  const qx = Math.abs(px - rect.x - hx) - hx + r, qy = Math.abs(py - rect.y - hy) - hy + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Inside set of a rounded rectangle on one horizontal line: [left,right]. */
export function rowInterval(rect, y) {
  if (!(y >= rect.y && y <= rect.y + rect.height)) return null;
  const r = rect.radius, t = Math.max(rect.y + r - y, y - (rect.y + rect.height - r), 0);
  const inset = r - Math.sqrt(Math.max(0, r * r - t * t));
  return [rect.x + inset, rect.x + rect.width - inset];
}

function subtract(intervals, cut) {
  if (!cut) return intervals;
  return intervals.flatMap(([a, b]) => [[a, Math.min(b, cut[0])], [Math.max(a, cut[1]), b]].filter(([l, r]) => r > l));
}
function intersect(intervals, keep) {
  if (!keep) return [];
  return intervals.map(([a, b]) => [Math.max(a, keep[0]), Math.min(b, keep[1])]).filter(([l, r]) => r > l);
}

/** Authored paint region in device px. Unsupported semantics are explicit,
 * never approximated by a nearby supported shape. */
export function paintRegion({shape, paint, strokeWidth = 0, strokeAlign = "center", clips = []}) {
  if (shape?.type !== "rectangle") return {unsupported: `shape ${shape?.type ?? "missing"} has no exact oracle`};
  if (shape.rotation) return {unsupported: "rotated geometry has no axis-aligned oracle in this audit"};
  if (shape.cornerRadii) return {unsupported: "per-corner radii are outside the uniform-radius oracle"};
  const base = roundedRect(shape);
  if (!base) return {unsupported: "degenerate authored rectangle"};
  const clipRects = clips.map(roundedRect);
  if (clipRects.some(rect => !rect)) return {unsupported: "degenerate ancestor clip"};
  let intervalsAt;
  if (paint === "fill") {
    intervalsAt = y => { const own = rowInterval(base, y); return own ? [own] : []; };
  } else if (paint === "stroke") {
    if (strokeAlign !== "center") return {unsupported: `stroke align ${strokeAlign} is outside this audit`};
    if (!(strokeWidth > 0)) return {unsupported: "no stroke width"};
    const outer = offsetRoundedRect(base, strokeWidth / 2), inner = offsetRoundedRect(base, -strokeWidth / 2);
    intervalsAt = y => { const own = rowInterval(outer, y); return own ? subtract([own], inner && rowInterval(inner, y)) : []; };
  } else return {unsupported: `paint ${paint} is outside this audit`};
  const clipped = y => clipRects.reduce((intervals, rect) => intersect(intervals, rowInterval(rect, y)), intervalsAt(y));
  const rects = [base, ...clipRects, ...(paint === "stroke" ? [offsetRoundedRect(base, strokeWidth / 2), offsetRoundedRect(base, -strokeWidth / 2)] : [])].filter(Boolean);
  return {base, rects, intervalsAt: clipped, paint, strokeWidth};
}

/** Exact-area coverage. Each pixel row is split at every rectangle's
 * top/bottom and arc start/end. Straight pieces have constant intervals and
 * are integrated exactly (x by interval overlap, y by piece height). Arc
 * pieces use 64 midpoint sub-rows; x stays exact. */
export function oracleCoverage(region, {left, top, width, height}, arcSubrows = ARC_SUBROWS) {
  const alpha = new Float64Array(width * height);
  const add = (j, y, weight) => {
    for (const [a, b] of region.intervalsAt(y)) {
      const first = Math.max(0, Math.floor(a - left)), last = Math.min(width - 1, Math.ceil(b - left) - 1);
      for (let i = first; i <= last; i++) {
        const overlap = Math.min(b, left + i + 1) - Math.max(a, left + i);
        if (overlap > 0) alpha[j * width + i] += overlap * weight;
      }
    }
  };
  for (let j = 0; j < height; j++) {
    const y0 = top + j, y1 = y0 + 1;
    const cuts = [y0, y1, ...region.rects.flatMap(rect => [rect.y, rect.y + rect.radius, rect.y + rect.height - rect.radius, rect.y + rect.height])
      .filter(y => y > y0 && y < y1)].sort((p, q) => p - q);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const a = cuts[k], b = cuts[k + 1];
      if (!(b > a)) continue;
      const middle = (a + b) / 2;
      const curved = region.rects.some(rect => rect.radius > 0 && middle > rect.y && middle < rect.y + rect.height &&
        (middle < rect.y + rect.radius || middle > rect.y + rect.height - rect.radius));
      if (!curved) { add(j, middle, b - a); continue; }
      const h = (b - a) / arcSubrows;
      for (let v = 0; v < arcSubrows; v++) add(j, a + (v + .5) * h, h);
    }
  }
  return {left, top, width, height, alpha, residual: new Float64Array(width * height)};
}

const sameColor = (a, b) => a.every((value, index) => value === b[index]);

/** Least-squares projection onto the straight sRGB foreground/background mix
 * (source-over compositing is linear in coverage). */
export function coverageFromRgba(image, {foreground, background, window}) {
  if (!foreground || !background) return {unobservable: "paint colour is not a solid sRGB colour"};
  if (sameColor(foreground, background)) return {unobservable: "foreground equals background"};
  const left = Math.max(0, window.left), top = Math.max(0, window.top);
  const right = Math.min(image.width, window.left + window.width), bottom = Math.min(image.height, window.top + window.height);
  const width = right - left, height = bottom - top;
  if (!(width > 0 && height > 0)) return {missing: "measurement window outside capture"};
  const alpha = new Float64Array(width * height), residual = new Float64Array(width * height);
  let denominator = 0;
  for (let c = 0; c < 3; c++) denominator += (background[c] - foreground[c]) ** 2;
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const offset = ((top + j) * image.width + left + i) * 4;
    let numerator = 0;
    for (let c = 0; c < 3; c++) numerator += (background[c] - image.data[offset + c]) * (background[c] - foreground[c]);
    const a = Math.max(0, Math.min(1, numerator / denominator));
    let error = Math.abs(255 - image.data[offset + 3]);
    for (let c = 0; c < 3; c++) error = Math.max(error, Math.abs(image.data[offset + c] - (background[c] + a * (foreground[c] - background[c]))));
    alpha[j * width + i] = a; residual[j * width + i] = error;
  }
  return {left, top, width, height, alpha, residual, clippedByCapture: width !== window.width || height !== window.height};
}

/** Composite exact coverage to RGBA (8-bit rounding) for controls. */
export function rgbaFromCoverage(raster, {foreground, background, imageWidth, imageHeight}) {
  const data = new Uint8Array(imageWidth * imageHeight * 4);
  for (let p = 0; p < imageWidth * imageHeight; p++) { data.set(background, p * 4); data[p * 4 + 3] = 255; }
  for (let j = 0; j < raster.height; j++) for (let i = 0; i < raster.width; i++) {
    const x = raster.left + i, y = raster.top + j;
    if (x < 0 || y < 0 || x >= imageWidth || y >= imageHeight) continue;
    const a = raster.alpha[j * raster.width + i];
    for (let c = 0; c < 3; c++) data[(y * imageWidth + x) * 4 + c] = Math.round(background[c] + a * (foreground[c] - background[c]));
  }
  return {width: imageWidth, height: imageHeight, data};
}

/** Pixel shift of a coverage raster (coverage-synthetic control, not an SVG input). */
export function shiftCoverage(raster, dx, dy) {
  const alpha = new Float64Array(raster.alpha.length), residual = new Float64Array(raster.residual.length);
  for (let j = 0; j < raster.height; j++) for (let i = 0; i < raster.width; i++) {
    const si = i - dx, sj = j - dy;
    if (si < 0 || sj < 0 || si >= raster.width || sj >= raster.height) continue;
    alpha[j * raster.width + i] = raster.alpha[sj * raster.width + si];
    residual[j * raster.width + i] = raster.residual[sj * raster.width + si];
  }
  return {...raster, alpha, residual};
}

/** actual + (perturbed oracle - authored oracle), clamped to [0,1]. */
export function addCoverageDelta(raster, perturbed, authored) {
  const alpha = Float64Array.from(raster.alpha, (value, index) => Math.max(0, Math.min(1, value + perturbed.alpha[index] - authored.alpha[index])));
  return {...raster, alpha};
}

function bilinear(raster, x, y) {
  const px = x - raster.left - .5, py = y - raster.top - .5, i = Math.floor(px), j = Math.floor(py);
  if (i < 0 || j < 0 || i + 1 >= raster.width || j + 1 >= raster.height) return null;
  const fx = px - i, fy = py - j;
  let alpha = 0, residual = 0;
  for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
    const index = (j + dy) * raster.width + i + dx, weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
    alpha += raster.alpha[index] * weight;
    if (weight > 0) residual = Math.max(residual, raster.residual[index]);
  }
  return {alpha, residual};
}

/** Depth along the inward normal before the medial axis: the largest t with
 * sdf(p - t n) = -t (sdf is 1-Lipschitz, so equality fails after the axis). */
export function medialDepth(rect, point, limit) {
  const holds = t => Math.abs(signedDistance(rect, point.x - t * point.nx, point.y - t * point.ny) + t) < 1e-9;
  if (holds(limit)) return limit;
  let low = 0, high = limit;
  for (let k = 0; k < 60; k++) { const middle = (low + high) / 2; if (holds(middle)) low = middle; else high = middle; }
  return low;
}

/** 32 equal arc-length points on the authored centre contour with outward
 * normals; independent of the old harness contour helper. */
export function contourNormals(rect, count = 32) {
  const {x, y, width, height} = rect, r = rect.radius, pieces = [];
  const line = (x0, y0, dx, dy, length, nx, ny) => { if (length > 1e-12) pieces.push({length, at: t => ({x: x0 + dx * t, y: y0 + dy * t, nx, ny})}); };
  const arc = (cx, cy, start) => { if (r > 0) pieces.push({length: Math.PI * r / 2, at: t => { const a = start + t / r; return {x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a)}; }}); };
  line(x + r, y, 1, 0, width - 2 * r, 0, -1); arc(x + width - r, y + r, -Math.PI / 2);
  line(x + width, y + r, 0, 1, height - 2 * r, 1, 0); arc(x + width - r, y + height - r, 0);
  line(x + width - r, y + height, -1, 0, width - 2 * r, 0, 1); arc(x + r, y + height - r, Math.PI / 2);
  line(x, y + height - r, 0, -1, height - 2 * r, -1, 0); arc(x + r, y + r, Math.PI);
  const perimeter = pieces.reduce((sum, piece) => sum + piece.length, 0);
  return Array.from({length: count}, (_, index) => {
    let distance = (index + .5) * perimeter / count;
    for (const piece of pieces) { if (distance <= piece.length) return {index, fraction: index / count, ...piece.at(distance)}; distance -= piece.length; }
    const last = pieces.at(-1);
    return {index, fraction: index / count, ...last.at(last.length)};
  });
}

/** Trapezoid integral of bilinear coverage along one normal. Width is the
 * coverage integral; centroid is its first moment / width (offset from the
 * authored centre contour, outward positive). */
export function measureStrokeProbe(raster, probe, {inward, outward, step = 1 / 16}) {
  const count = Math.max(2, Math.ceil((inward + outward) / step)), h = (inward + outward) / count;
  let mass = 0, moment = 0, residual = 0;
  for (let k = 0; k <= count; k++) {
    const s = -inward + k * h, sample = bilinear(raster, probe.x + s * probe.nx, probe.y + s * probe.ny);
    if (!sample) return null;
    const weight = k === 0 || k === count ? h / 2 : h;
    mass += sample.alpha * weight; moment += s * sample.alpha * weight; residual = Math.max(residual, sample.residual);
  }
  return {width: mass, centroid: mass > 0 ? moment / mass : null, residual};
}

/** Fill integrals over the measurement raster: mass, area centroid, and the
 * largest row/column coverage integrals. */
export function measureFill(raster) {
  let mass = 0, sx = 0, sy = 0, residual = 0, row = 0, column = 0;
  const columns = new Float64Array(raster.width);
  for (let j = 0; j < raster.height; j++) {
    let rowSum = 0;
    for (let i = 0; i < raster.width; i++) {
      const index = j * raster.width + i, a = raster.alpha[index];
      mass += a; sx += (raster.left + i + .5) * a; sy += (raster.top + j + .5) * a;
      rowSum += a; columns[i] += a; residual = Math.max(residual, raster.residual[index]);
    }
    row = Math.max(row, rowSum);
  }
  for (const value of columns) column = Math.max(column, value);
  return {mass, centroidX: mass ? sx / mass : null, centroidY: mass ? sy / mass : null, maxRowIntegral: row, maxColumnIntegral: column, residual};
}

/** Width is directly the coverage integral of a fully covered pixel row
 * (needs the vertical extent to contain one whole device row), and vice versa.
 * With only one direct axis the other is mass/direct. With neither, w and h of
 * box-filtered coverage are not separately identifiable (only w*h is). */
export function fillAxisObservability(rect) {
  const fullRow = Math.floor(rect.y + rect.height) - Math.ceil(rect.y) >= 1;
  const fullColumn = Math.floor(rect.x + rect.width) - Math.ceil(rect.x) >= 1;
  return {widthDirect: fullRow, heightDirect: fullColumn};
}

export function fillIntegralSize(measure, observability) {
  const width = observability.widthDirect ? measure.maxRowIntegral : null;
  const height = observability.heightDirect ? measure.maxColumnIntegral : null;
  return {width: width ?? (height ? measure.mass / height : null), height: height ?? (width ? measure.mass / width : null)};
}

const within = (value, limit) => value !== null && Number.isFinite(value) && Math.abs(value) <= limit + 1e-12;

/** Compare one stroke row. Both rasters must cover the same window. */
export function compareStroke({actual, oracle, region, tolerances = SVG_SEMANTIC_TOLERANCES, count = 32}) {
  const strokeWidth = region.strokeWidth, outward = strokeWidth / 2 + 3, probes = [];
  for (const point of contourNormals(region.base, count)) {
    const inward = medialDepth(region.base, point, outward);
    const reference = measureStrokeProbe(oracle, point, {inward, outward});
    const observed = measureStrokeProbe(actual, point, {inward, outward});
    const entry = {index: point.index, fraction: point.fraction, x: point.x, y: point.y, nx: point.nx, ny: point.ny, inward, outward};
    probes.push(entry);
    if (!reference || !observed) { entry.status = SVG_SEMANTIC_STATUS.MISSING; continue; }
    Object.assign(entry, {oracle: reference, actual: observed});
    // Visible-ring requirement: an authored band clipped away is unobservable.
    if (!(reference.width >= strokeWidth / 2)) { entry.status = SVG_SEMANTIC_STATUS.UNOBSERVABLE; continue; }
    if (observed.residual > tolerances.residual) { entry.status = SVG_SEMANTIC_STATUS.CONTAMINATED; continue; }
    entry.operatorBias = {centroid: reference.centroid, width: reference.width - strokeWidth};
    if (observed.centroid === null) {
      // No ink: width is a finite failing field; centroid is undefined (null), never zero.
      Object.assign(entry, {status: SVG_SEMANTIC_STATUS.FAIL, reason: "no stroke coverage", error: {centroid: null, width: observed.width - reference.width},
        nominal: {centroid: null, width: observed.width - strokeWidth}});
      continue;
    }
    entry.error = {centroid: observed.centroid - reference.centroid, width: observed.width - reference.width};
    entry.nominal = {centroid: observed.centroid, width: observed.width - strokeWidth};
    entry.status = within(entry.error.centroid, tolerances.strokeCentroid) && within(entry.error.width, tolerances.strokeWidth) ? SVG_SEMANTIC_STATUS.PASS : SVG_SEMANTIC_STATUS.FAIL;
  }
  const counts = Object.fromEntries(Object.values(SVG_SEMANTIC_STATUS).map(status => [status, probes.filter(probe => probe.status === status).length]));
  const status = counts[SVG_SEMANTIC_STATUS.FAIL] ? SVG_SEMANTIC_STATUS.FAIL
    : counts[SVG_SEMANTIC_STATUS.PASS] >= tolerances.minimumStrokeProbes ? SVG_SEMANTIC_STATUS.PASS
    : counts[SVG_SEMANTIC_STATUS.CONTAMINATED] ? SVG_SEMANTIC_STATUS.CONTAMINATED
    : counts[SVG_SEMANTIC_STATUS.MISSING] ? SVG_SEMANTIC_STATUS.MISSING : SVG_SEMANTIC_STATUS.UNOBSERVABLE;
  return {kind: "stroke", status, counts, probes};
}

export function compareFill({actual, oracle, region, tolerances = SVG_SEMANTIC_TOLERANCES}) {
  const observability = fillAxisObservability(region.base);
  const reference = measureFill(oracle), observed = measureFill(actual);
  const referenceSize = fillIntegralSize(reference, observability), observedSize = fillIntegralSize(observed, observability);
  const result = {kind: "fill", observability, oracle: {...reference, ...referenceSize}, actual: {...observed, ...observedSize},
    nominal: {width: region.base.width, height: region.base.height, centroidX: region.base.x + region.base.width / 2, centroidY: region.base.y + region.base.height / 2}};
  if (!(reference.mass > 0)) return {...result, status: SVG_SEMANTIC_STATUS.UNOBSERVABLE, reason: "authored fill clipped away"};
  if (observed.residual > tolerances.residual) return {...result, status: SVG_SEMANTIC_STATUS.CONTAMINATED};
  if (!(observed.mass > 0)) return {...result, status: SVG_SEMANTIC_STATUS.FAIL, reason: "no fill coverage"};
  const error = {
    centroid: Math.hypot(observed.centroidX - reference.centroidX, observed.centroidY - reference.centroidY),
    centroidX: observed.centroidX - reference.centroidX, centroidY: observed.centroidY - reference.centroidY,
    width: referenceSize.width === null ? null : observedSize.width - referenceSize.width,
    height: referenceSize.height === null ? null : observedSize.height - referenceSize.height,
    mass: observed.mass - reference.mass,
  };
  result.error = error;
  if (!within(error.centroid, tolerances.fillCentroid) || (error.width !== null && !within(error.width, tolerances.fillWidth)) ||
    (error.height !== null && !within(error.height, tolerances.fillHeight))) return {...result, status: SVG_SEMANTIC_STATUS.FAIL};
  if (error.width === null || error.height === null) return {...result, status: SVG_SEMANTIC_STATUS.UNOBSERVABLE, reason: "width and height are not separately identifiable: no whole device row or column inside the authored fill"};
  return {...result, status: SVG_SEMANTIC_STATUS.PASS};
}

/** Device-space measurement window around an authored region. */
export function measurementWindow(region, margin = 4) {
  const reach = region.paint === "stroke" ? region.strokeWidth / 2 : 0, b = region.base;
  const left = Math.floor(b.x - reach - margin), top = Math.floor(b.y - reach - margin);
  return {left, top, width: Math.ceil(b.x + b.width + reach + margin) - left, height: Math.ceil(b.y + b.height + reach + margin) - top};
}

/** End-to-end comparison of one RGBA capture with the authored geometry. */
export function compareSvgSemantics(image, spec, {foreground, background, tolerances = SVG_SEMANTIC_TOLERANCES} = {}) {
  const region = paintRegion(spec);
  if (region.unsupported) return {status: SVG_SEMANTIC_STATUS.UNSUPPORTED, reason: region.unsupported};
  const window = measurementWindow(region), actual = coverageFromRgba(image, {foreground, background, window});
  if (actual.unobservable) return {status: SVG_SEMANTIC_STATUS.UNOBSERVABLE, reason: actual.unobservable};
  if (actual.missing || actual.clippedByCapture) return {status: SVG_SEMANTIC_STATUS.MISSING, reason: actual.missing ?? "measurement window clipped by capture"};
  const oracle = oracleCoverage(region, actual);
  const result = region.paint === "stroke" ? compareStroke({actual, oracle, region, tolerances}) : compareFill({actual, oracle, region, tolerances});
  return {...result, window: {left: actual.left, top: actual.top, width: actual.width, height: actual.height}, region: {base: region.base, paint: region.paint, strokeWidth: region.strokeWidth}, rasters: {actual, oracle}};
}
