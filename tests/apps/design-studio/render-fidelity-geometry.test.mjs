import assert from "node:assert/strict";
import { test } from "node:test";
import { compareChildEdges, compareCornerRadius, compareRotationGeometry, compareShadowGeometry, cornerRadiusGeometry, rotationEndpointDisplacement } from "./render-fidelity-geometry.mjs";

function rasterize(inside, { color = [0, 0, 0], opacity = 1 } = {}) {
  const width = 100, height = 100, data = new Uint8Array(width * height * 4).fill(255), samples = 8;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let hit = 0;
    for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) hit += !!inside(x + (sx + .5) / samples, y + (sy + .5) / samples);
    const alpha = hit / samples ** 2 * opacity;
    for (let c = 0; c < 3; c++) data[(y * width + x) * 4 + c] = Math.round(255 + alpha * (color[c] - 255));
  }
  return { width, height, data };
}
const rotated = (degrees = 15, dx = 0, dy = 0) => rasterize((x, y) => {
  const angle = degrees * Math.PI / 180, px = x - 50 - dx, py = y - 50 - dy;
  return Math.abs(px * Math.cos(angle) + py * Math.sin(angle)) < 30 && Math.abs(-px * Math.sin(angle) + py * Math.cos(angle)) < 14;
}, { color: [34, 102, 204] });
const round = (radius = 14, dx = 0, dy = 0) => rasterize((x, y) => {
  const xx = x - 20 - dx, yy = y - 20 - dy;
  if (xx < 0 || yy < 0 || xx > 60 || yy > 50) return false;
  return Math.hypot(Math.max(0, radius - xx, xx - (60 - radius)), Math.max(0, radius - yy, yy - (50 - radius))) <= radius;
});

test("rotation covariance detects one-device-pixel displacement and physical endpoint defects", () => {
  const reference = rotated(), options = { foreground: [34, 102, 204], localLongEdgeCss:60, scale:1 };
  assert.deepEqual(compareRotationGeometry(reference, reference, options).failures, []);
  for (const shifted of [rotated(15, 1), rotated(15, 0, 2)]) {
    const compared = compareRotationGeometry(reference, shifted, options);
    assert.ok(compared.failures.some(message => message.startsWith("rotation centroid")));
  }
  const angle = compareRotationGeometry(reference, rotated(16), options);
  assert.ok(angle.angleDegrees > .9 && angle.angleDegrees < 1.1);
  assert.ok(angle.failures.some(message => message.startsWith("rotation endpoint")));
});

test("endpoint metric keeps raw short-bar angle while rejecting 30x1 CSS bar +2deg at DPR2", () => {
  assert.ok(Math.abs(rotationEndpointDisplacement(2,{localLongEdgeCss:30,scale:2})-1.046984901075029)<1e-12);
  assert.ok(rotationEndpointDisplacement(1.817906,{localLongEdgeCss:4,scale:2})<.127);
  const bar=(degrees,dx=0)=>rasterize((x,y)=>{const angle=degrees*Math.PI/180,px=x-50-dx,py=y-50;return Math.abs(px*Math.cos(angle)+py*Math.sin(angle))<30&&Math.abs(-px*Math.sin(angle)+py*Math.cos(angle))<1;});
  const options={localLongEdgeCss:30,scale:2},reference=bar(15),angle=compareRotationGeometry(reference,bar(17),options);
  assert.ok(Math.abs(angle.angleDegrees-2)<.1,JSON.stringify(angle));
  assert.ok(angle.endpointDevicePx>1&&angle.failures.some(message=>message.startsWith("rotation endpoint")),JSON.stringify(angle));
  const shifted=compareRotationGeometry(reference,bar(15,1),options);
  assert.ok(shifted.centroid>.99&&shifted.failures.some(message=>message.startsWith("rotation centroid")),JSON.stringify(shifted));
  const missing=compareRotationGeometry(reference,reference);
  assert.equal(missing.measurable,false,"a missing HTML snapped long edge cannot become a geometry pass");
});

test("radius fit is calibrated against a synthetic circle and detects 1px/2px radius errors", () => {
  const options = { bounds: { x: 20, y: 20, width: 60, height: 50 }, nominalRadius: 14 }, reference = round();
  const fit = cornerRadiusGeometry(reference, options);
  assert.ok(fit && Math.abs(fit.radius - 14) <= .3, JSON.stringify(fit));
  assert.deepEqual(compareCornerRadius(reference, reference, options).failures, []);
  for (const radius of [15, 16]) {
    const result = compareCornerRadius(reference, round(radius), options);
    assert.ok(result.measurable && Math.abs(result.radius - (radius - 14)) <= .3, JSON.stringify(result));
    assert.ok(result.failures.length);
  }
});

test("child boundaries detect 1px and 2px displacements independent of pixel-neighborhood tolerance", () => {
  const rectangle = dx => rasterize((x, y) => x >= 20 + dx && x < 50 + dx && y >= 20 && y < 40);
  const reference = rectangle(0);
  assert.deepEqual(compareChildEdges(reference, reference).failures, []);
  for (const dx of [1, 2]) {
    const result = compareChildEdges(reference, rectangle(dx));
    assert.equal(result.left, dx); assert.equal(result.right, dx); assert.equal(result.failures.length, 2);
  }
});

test("visible shadow probe separates alpha and centroid defects and excludes the painted shape", () => {
  const shadow = (dx = 0, opacity = .25) => rasterize((x, y) => x >= 35 + dx && x < 65 + dx && y >= 60 && y < 72, { opacity });
  const options = { excludeBounds: { x: 20, y: 20, width: 60, height: 35 } }, reference = shadow();
  assert.deepEqual(compareShadowGeometry(reference, reference, options).failures, []);
  assert.ok(compareShadowGeometry(reference, shadow(2), options).failures.some(message => message.startsWith("shadow centroid")));
  const alpha = compareShadowGeometry(reference, shadow(0, .3), options);
  assert.ok(alpha.alphaRatio > 1.15 && alpha.failures.some(message => message.startsWith("shadow peak alpha")));
});

test("absent and rotationally ambiguous probes remain explicit unavailable measurements", () => {
  const blank = rasterize(() => false), square = rasterize((x, y) => x > 30 && x < 60 && y > 30 && y < 60);
  assert.equal(compareChildEdges(blank, blank).measurable, false);
  assert.equal(compareShadowGeometry(blank, blank).measurable, false);
  assert.equal(compareRotationGeometry(square, square).measurable, false);
  assert.equal(compareCornerRadius(blank, blank, { bounds: { x: 20, y: 20, width: 60, height: 50 }, nominalRadius: 14 }).measurable, false);
});
