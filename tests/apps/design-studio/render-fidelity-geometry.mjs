/* Isolated pixel probes for the geometry fixture. All coordinates, including
 * nominal bounds, are device pixels. A missing/ambiguous probe is not a pass. */
import { geometryDifference, inkGeometry } from "./render-fidelity.metrics.mjs";

const white = [255, 255, 255];
const black = [0, 0, 0];
const contains = (box, x, y) => box && x >= box.x && y >= box.y && x < box.x + box.width && y < box.y + box.height;

function coverageAt(image, x, y, foreground, background) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return 0;
  const offset = (y * image.width + x) * 4;
  let numerator = 0, denominator = 0;
  for (let c = 0; c < 3; c++) {
    const direction = foreground[c] - background[c];
    numerator += (image.data[offset + c] - background[c]) * direction;
    denominator += direction * direction;
  }
  if (!denominator) return 0;
  const alpha = Math.max(0, Math.min(1, numerator / denominator));
  const residual = Math.max(...foreground.map((color, c) =>
    Math.abs(image.data[offset + c] - (background[c] + alpha * (color - background[c])))));
  return residual <= 24 ? alpha : 0;
}

function weightedMoments(image, { roi, excludeBounds, foreground = black, background = white, minimumCoverage = 1 / 255 } = {}) {
  const bounds = roi ?? { x: 0, y: 0, width: image.width, height: image.height };
  let mass = 0, x1 = 0, y1 = 0, x2 = 0, xy = 0, y2 = 0, peakCoverage = 0, pixels = 0;
  for (let y = Math.max(0, Math.floor(bounds.y)); y < Math.min(image.height, Math.ceil(bounds.y + bounds.height)); y++) {
    for (let x = Math.max(0, Math.floor(bounds.x)); x < Math.min(image.width, Math.ceil(bounds.x + bounds.width)); x++) {
      if (contains(excludeBounds, x + .5, y + .5)) continue;
      const alpha = coverageAt(image, x, y, foreground, background);
      if (alpha < minimumCoverage) continue;
      const px = x + .5, py = y + .5;
      mass += alpha; x1 += alpha * px; y1 += alpha * py;
      x2 += alpha * px * px; xy += alpha * px * py; y2 += alpha * py * py;
      peakCoverage = Math.max(peakCoverage, alpha); pixels++;
    }
  }
  if (!mass) return null;
  const centroidX = x1 / mass, centroidY = y1 / mass;
  return { mass, centroidX, centroidY, peakCoverage, pixels,
    covarianceXX: x2 / mass - centroidX ** 2,
    covarianceXY: xy / mass - centroidX * centroidY,
    covarianceYY: y2 / mass - centroidY ** 2 };
}

export function coverageGeometry(image, options) {
  return weightedMoments(image, options);
}

export function rotationGeometry(image, options) {
  const moments = weightedMoments(image, options);
  return rotationMomentGeometry(moments);
}

// These are coverage-equivalent dimensions, not an estimate of the authored
// dimensions of a short rounded strip. Compare the same two raster probes;
// subpixel AA can change their second moments and remains subject to the gate.
export function rotationMomentGeometry(moments) {
  if (!moments) return null;
  const { covarianceXX: xx, covarianceXY: xy, covarianceYY: yy } = moments;
  if (![xx, xy, yy, moments.centroidX, moments.centroidY].every(Number.isFinite)) return null;
  const separation = Math.hypot(xx - yy, 2 * xy), trace = xx + yy;
  if (trace <= 0 || separation / trace < .1) return null; // A square/circle has no stable long axis.
  const lambdaMajor = (trace + separation) / 2, lambdaMinor = (trace - separation) / 2;
  if (lambdaMinor < -1e-9) return null;
  return { ...moments, angleDegrees: Math.atan2(2 * xy, xx - yy) * 90 / Math.PI,
    anisotropy: separation / trace, lambdaMajor, lambdaMinor: Math.max(0, lambdaMinor),
    effectiveLengthDevicePx: Math.sqrt(12 * lambdaMajor),
    effectiveThicknessDevicePx: Math.sqrt(12 * Math.max(0, lambdaMinor)) };
}

const axisAngleDifference = (a, b) => ((a - b + 270) % 180) - 90;
// L is the HTML paint box's snapped local long edge in CSS px. Scale already
// includes zoom and DPR; moments and the resulting endpoint are device px.
export function rotationEndpointDisplacement(angleDegrees,{localLongEdgeCss,scale}={}) {
  if(!(localLongEdgeCss>0)||!(scale>0)||![angleDegrees,localLongEdgeCss,scale].every(Number.isFinite))return NaN;
  return localLongEdgeCss*scale/2*Math.abs(Math.sin(angleDegrees*Math.PI/180));
}
export function compareRotationGeometry(reference, actual, options) {
  return compareRotationMoments(weightedMoments(reference, options), weightedMoments(actual, options), options);
}

// Also accepts immutable raw moments so old PNG captures can be re-evaluated
// without rendering or changing the original measurements.
export function compareRotationMoments(reference, actual, options = {}) {
  const expected = rotationMomentGeometry(reference), observed = rotationMomentGeometry(actual);
  if (!expected || !observed) return { measurable: false, failures: ["rotation probe has no stable principal axis"] };
  const centroid = Math.hypot(observed.centroidX - expected.centroidX, observed.centroidY - expected.centroidY);
  const angleDegrees = axisAngleDifference(observed.angleDegrees, expected.angleDegrees);
  const lengthDeltaDevicePx = observed.effectiveLengthDevicePx - expected.effectiveLengthDevicePx;
  const thicknessDeltaDevicePx = observed.effectiveThicknessDevicePx - expected.effectiveThicknessDevicePx;
  const endpointDevicePx=rotationEndpointDisplacement(angleDegrees,options);
  if(!Number.isFinite(endpointDevicePx))return {measurable:false,reference:expected,actual:observed,centroid,angleDegrees,
    failures:["rotation HTML snapped local long edge or physical scale unavailable"]};
  return { measurable: true, reference: expected, actual: observed, centroid, angleDegrees,endpointDevicePx,
    lengthDeltaDevicePx, thicknessDeltaDevicePx, lengthLimitDevicePx: .5, thicknessLimitDevicePx: .35,
    localLongEdgeCss:options.localLongEdgeCss,scale:options.scale,endpointLimitDevicePx:.5,
    failures: [...(centroid > .5 ? [`rotation centroid ${centroid} > 0.5`] : []),
      ...(endpointDevicePx > .5 ? [`rotation endpoint ${endpointDevicePx} > 0.5`] : []),
      ...(Math.abs(lengthDeltaDevicePx) > .5 ? [`rotation length ${lengthDeltaDevicePx} > 0.5`] : []),
      ...(Math.abs(thicknessDeltaDevicePx) > .35 ? [`rotation thickness ${thicknessDeltaDevicePx} > 0.35`] : [])] };
}

export function compareChildEdges(reference, actual, options) {
  const delta = geometryDifference(inkGeometry(reference, options), inkGeometry(actual, options));
  if (!delta.measurable) return { ...delta, failures: ["child edge ink not measurable"] };
  return { ...delta, failures: ["left", "top", "right", "bottom"]
    .filter(edge => Math.abs(delta[edge]) > .5).map(edge => `child ${edge} ${delta[edge]} > 0.5`) };
}

export function shadowGeometry(image, options) {
  const moments = weightedMoments(image, options);
  return moments ? { ...moments, basis: "visible exterior shadow; shape/stroke bounds excluded" } : null;
}
export function compareShadowGeometry(reference, actual, options) {
  const expected = shadowGeometry(reference, options), observed = shadowGeometry(actual, options);
  if (!expected || !observed) return { measurable: false, failures: ["exterior shadow ink not measurable"] };
  const centroid = Math.hypot(observed.centroidX - expected.centroidX, observed.centroidY - expected.centroidY);
  const alphaRatio = observed.peakCoverage / expected.peakCoverage;
  return { measurable: true, reference: expected, actual: observed, centroid, alphaRatio,
    massRatio: observed.mass / expected.mass,
    failures: [...(centroid > 1 ? [`shadow centroid ${centroid} > 1`] : []),
      ...(Math.abs(alphaRatio - 1) > .1 ? [`shadow peak alpha ratio ${alphaRatio} outside ±10%`] : [])] };
}

function halfCrossing(image, origin, end, fixed, axis, foreground, background) {
  let previous = 0;
  for (let position = Math.floor(origin); position <= Math.ceil(end); position++) {
    const value = coverageAt(image, axis === "x" ? position : Math.floor(fixed),
      axis === "y" ? position : Math.floor(fixed), foreground, background);
    if (value >= .5 && previous < .5) {
      return position - .5 + (.5 - previous) / (value - previous);
    }
    previous = value;
  }
  return null;
}

/** Fit the isolated top-left outer arc. The nominal radius only bounds the
 * search window; the measured straight sides establish the actual corner. */
export function cornerRadiusGeometry(image, { bounds, nominalRadius, foreground = black, background = white }) {
  if (!(nominalRadius >= 4)) return null; // Too few edge samples for a stable circle fit.
  const straight = nominalRadius * 1.5 + 2;
  const left = halfCrossing(image, bounds.x - 3, bounds.x + nominalRadius, bounds.y + straight, "x", foreground, background);
  const top = halfCrossing(image, bounds.y - 3, bounds.y + nominalRadius, bounds.x + straight, "y", foreground, background);
  if (left === null || top === null) return null;
  const points = [];
  for (let y = Math.ceil(top + nominalRadius * .15); y < top + nominalRadius * .85; y++) {
    const edge = halfCrossing(image, left - 2, left + nominalRadius * 1.5, y, "x", foreground, background);
    if (edge !== null) points.push({ x: edge - left, y: y + .5 - top });
  }
  if (points.length < 4) return null;
  const loss = radius => points.reduce((sum, point) => {
    const predicted = radius - Math.sqrt(Math.max(0, radius ** 2 - (point.y - radius) ** 2));
    return sum + (point.x - predicted) ** 2;
  }, 0) / points.length;
  let low = Math.max(1, nominalRadius / 2), high = nominalRadius * 1.5;
  for (let iteration = 0; iteration < 64; iteration++) {
    const one = low + (high - low) / 3, two = high - (high - low) / 3;
    if (loss(one) < loss(two)) high = two; else low = one;
  }
  const radius = (low + high) / 2, residual = Math.sqrt(loss(radius));
  if (residual > .75) return null;
  return { radius, left, top, residual, samples: points.length, basis: "50% coverage outer top-left arc fit" };
}

export function compareCornerRadius(reference, actual, options) {
  const expected = cornerRadiusGeometry(reference, options), observed = cornerRadiusGeometry(actual, options);
  if (!expected || !observed) return { measurable: false, failures: ["rounded outer arc unavailable or fit residual exceeds 0.75px"] };
  const delta = observed.radius - expected.radius;
  return { measurable: true, reference: expected, actual: observed, radius: delta,
    failures: Math.abs(delta) > .5 ? [`corner radius ${delta} > 0.5`] : [] };
}

/** Adapter for the explicitly isolated synthetic fixture probes. Real designs
 * require their own isolation checks; an arbitrary node is not a safe probe. */
export function compareGeometryProbe(reference, actual, { node, tile = { x: 0, y: 0 }, scale = 1, kind } = {}) {
  kind ??= ["button-edge", "selector-edge", "clipped-child"].includes(node?.id) ? "child" :
    ["radius", "rotation", "shadow", "shadow-stack"].includes(node?.id) ? node.id : undefined;
  if (!kind) return null;
  const rgb = value => /^#[a-f\d]{6}$/iu.test(value ?? "") ? [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)) : black;
  const box = { x: (node.x - tile.x) * scale, y: (node.y - tile.y) * scale, width: node.width * scale, height: node.height * scale };
  const expanded = amount => ({ x: box.x - amount, y: box.y - amount, width: box.width + amount * 2, height: box.height + amount * 2 });
  let result;
  if (kind === "radius") {
    const outset = (node.strokeAlign === "inside" ? 0 : node.strokeAlign === "outside" ? 1 : .5) * (node.strokeWidth || 0) * scale;
    result = compareCornerRadius(reference, actual, { bounds: expanded(outset), nominalRadius: node.cornerRadius * scale + outset,
      foreground: rgb(node.strokeWidth > 0 ? node.stroke : node.fill) });
  } else if (kind === "rotation") {
    result = compareRotationGeometry(reference, actual, { roi: expanded(Math.max(node.width, node.height) * scale * .35), foreground: rgb(node.fill),
      localLongEdgeCss:Math.max(Math.round(Math.trunc(node.width*64)/64),Math.round(Math.trunc(node.height*64)/64)),scale });
  } else if (kind === "child") {
    result = compareChildEdges(reference, actual, { roi: expanded(4 * scale), foreground: rgb(node.fill) });
  } else if (kind === "shadow" || kind === "shadow-stack") {
    const shadow = node.shadow ?? node.shadowStack?.layers.find(layer => layer.kind === "outer" && layer.visible);
    if (!shadow) return { kind, measurable: false, failures: ["no visible isolated outer shadow"] };
    const paintOutset = (node.strokeAlign === "inside" ? 0 : node.strokeAlign === "outside" ? 1 : .5) * (node.strokeWidth || 0) * scale;
    result = compareShadowGeometry(reference, actual, { roi: expanded((shadow.blur * 3 + Math.max(Math.abs(shadow.x), Math.abs(shadow.y)) + 4) * scale),
      excludeBounds: expanded(paintOutset + scale), foreground: rgb(shadow.color) });
  } else return null;
  return { kind, ...result };
}
