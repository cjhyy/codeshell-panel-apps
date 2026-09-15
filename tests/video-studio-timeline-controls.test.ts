import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fitTimelineScale,
  getTimelineTicks,
  MAX_TIMELINE_SCALE,
  MIN_TIMELINE_SCALE,
  snapFrame,
} from "../apps/video-studio/src/timeline-controls";

test("fit shows the complete sequence with padding and can zoom below the old 12 px/s floor", () => {
  assert.equal(fitTimelineScale(300, 30, 840), 80);
  assert.equal(fitTimelineScale(30 * 3600, 30, 940), 0.25);
  const dayScale = fitTimelineScale(30 * 86400, 30, 940);
  assert.ok(dayScale < 12);
  assert.ok(86400 * dayScale + 40 <= 940);
  assert.equal(fitTimelineScale(1, 30, 840), MAX_TIMELINE_SCALE);
  assert.equal(fitTimelineScale(300, 30, 20), MIN_TIMELINE_SCALE);
  assert.equal(fitTimelineScale(300, 30, 840, 80), 76);
  assert.ok(Number.isFinite(fitTimelineScale(NaN, 0, Infinity)));
});

test("ruler steps adapt from seconds down to individual integer frames", () => {
  const options = { durationFrames: 600, fps: 30, minSpacingPixels: 40 };
  const cases = [
    [1200, 1],
    [240, 5],
    [120, 10],
    [80, 15],
    [40, 30],
    [20, 60],
  ];
  for (const [pixelsPerSecond, expectedStep] of cases) {
    const result = getTimelineTicks({
      ...options,
      pixelsPerSecond: pixelsPerSecond!,
      maxTicks: 1000,
    });
    assert.equal(result.stepFrames, expectedStep);
    assert.ok(result.frames.every(Number.isSafeInteger));
    assert.equal(result.frames[0], 0);
    assert.ok(result.frames.every((frame) => frame <= options.durationFrames));
  }
  assert.equal(getTimelineTicks({ ...options, fps: 24, pixelsPerSecond: 40 }).stepFrames, 24);
});

test("ruler retains local detail and aligned labels inside a scrolled viewport of a 24-hour clip", () => {
  const result = getTimelineTicks({
    durationFrames: 30 * 86400,
    fps: 30,
    pixelsPerSecond: 240,
    visibleStartFrame: 1000001,
    visibleEndFrame: 1000121,
  });
  assert.equal(result.stepFrames, 10);
  assert.deepEqual(
    result.frames,
    Array.from({ length: 12 }, (_, index) => 1000010 + index * 10),
  );
});

test("ruler caps generated labels for long clips even without a visible range", () => {
  for (const maxTicks of [1, 2, 15, 200]) {
    const result = getTimelineTicks({
      durationFrames: 30 * 86400,
      fps: 30,
      pixelsPerSecond: 240,
      maxTicks,
    });
    assert.ok(result.frames.length <= maxTicks);
    assert.ok(result.frames.every((frame, index) => !index || frame > result.frames[index - 1]!));
  }
  const reversed = getTimelineTicks({
    durationFrames: 300,
    fps: 30,
    pixelsPerSecond: 60,
    visibleStartFrame: 200,
    visibleEndFrame: 100,
  });
  assert.deepEqual(reversed.frames, []);
});

test("snap uses pixel distance at the current zoom, including fractional pointer positions", () => {
  const options = { candidates: [120], fps: 30, pixelsPerSecond: 240 };
  assert.equal(snapFrame(119, options), 120);
  assert.equal(snapFrame(118, options), 118);
  assert.equal(snapFrame(118.9, options), 119);
  assert.equal(snapFrame(118, { ...options, pixelsPerSecond: 60 }), 120);
  assert.equal(snapFrame(119, { ...options, thresholdPixels: 7 }), 119);
  assert.equal(snapFrame(119, { ...options, enabled: false }), 119);
});

test("snap selects the nearest valid boundary with deterministic ties and ignores illegal candidates", () => {
  const options = { candidates: [107, 105, 95], fps: 30, pixelsPerSecond: 30 };
  assert.equal(snapFrame(100, options), 95);
  assert.equal(snapFrame(100, { ...options, candidates: [95, 105, 107] }), 95);
  assert.equal(snapFrame(103, options), 105);
  assert.equal(snapFrame(91, { ...options, candidates: [89], minFrame: 90 }), 91);
  assert.equal(snapFrame(99, { ...options, candidates: [101], maxFrame: 100 }), 99);
  assert.equal(
    snapFrame(99, { ...options, candidates: [100.4, NaN, Infinity], maxFrame: 100 }),
    99,
  );
  assert.equal(snapFrame(1, { ...options, enabled: false, minFrame: 10, maxFrame: 20 }), 10);
  assert.equal(snapFrame(30, { ...options, enabled: false, minFrame: 10, maxFrame: 20 }), 20);
  assert.equal(snapFrame(12.7, { ...options, enabled: false, minFrame: 10, maxFrame: 20 }), 13);
});

test("snap supports signed virtual trim coordinates while respecting the explicit source boundary", () => {
  const options = {
    candidates: [-90, -70, 0],
    fps: 30,
    pixelsPerSecond: 30,
    minFrame: -75,
    maxFrame: 30,
  };
  assert.equal(snapFrame(-72, options), -70);
  assert.equal(snapFrame(-76, { ...options, enabled: false }), -75);
  assert.equal(snapFrame(-72, { ...options, candidates: [-80] }), -72);
  assert.equal(snapFrame(-72, { ...options, minFrame: 0 }), 0);
});
