import assert from "node:assert/strict";
import { test } from "node:test";
import { PNG } from "pngjs";
import { comparePixels } from "../../../scripts/design-studio-production-fidelity.mjs";

function image(width, height, change) {
  const png = new PNG({ width, height });
  png.data.fill(255);
  change?.(png.data);
  return PNG.sync.write(png);
}

test("production pixel comparison detects a single changed pixel and writes its diff", () => {
  const result = comparePixels(
    image(40, 20),
    image(40, 20, (data) => {
      data[97 * 4] = 254;
    }),
  );
  assert.equal(result.metrics.changedPixels, 1);
  assert.equal(result.metrics.pixelsOutsideTolerance, 1);
  assert.equal(result.metrics.changedPixelRatio, 1 / 800);
  assert.equal(result.metrics.maximumChannelDelta, 1);
  const diff = PNG.sync.read(result.diff);
  assert.equal(diff.data[97 * 4], 6);
  assert.equal(diff.data[97 * 4 + 3], 255);
});

test("pixel tolerance never hides exact changed-pixel or alpha measurements", () => {
  const result = comparePixels(
    image(2, 2),
    image(2, 2, (data) => {
      data[3] = 250;
    }),
    8,
  );
  assert.equal(result.metrics.changedPixels, 1);
  assert.equal(result.metrics.pixelsOutsideTolerance, 0);
  assert.equal(result.metrics.maximumChannelDelta, 5);
});

test("different image dimensions fail instead of resizing away evidence", () => {
  assert.throws(() => comparePixels(image(2, 2), image(3, 2)), /widths differ/u);
  assert.throws(() => comparePixels(image(2, 2), image(2, 3)), /heights differ/u);
});
