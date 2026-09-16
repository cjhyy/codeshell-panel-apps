import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TICKS_PER_SECOND,
  assertTick,
  validateFrameRate,
  secondsToTicks,
  ticksToSeconds,
  frameToTicks,
  ticksToFrame,
  snapToFrame,
  validateTimeMap,
  sourceTimeAt,
  sourceRangesToTimeline,
  sliceTimeMap,
  constantTimeMap,
  freezeTimeMap,
  type FrameRate,
  type TimeMap,
} from "../apps/video-studio/src/editor/time";
import {
  validateEasing,
  validateAnimatedNumber,
  evaluateAnimatedNumber,
  sliceAnimatedNumber,
  type AnimatedNumber,
} from "../apps/video-studio/src/editor/animation";

const near = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

test("integer and NTSC frame clocks remain exact over long sequences", () => {
  const rates: FrameRate[] = [
    ...[24, 25, 30, 48, 50, 60].map((numerator) => ({ numerator, denominator: 1 })),
    ...[24000, 30000, 60000].map((numerator) => ({ numerator, denominator: 1001 })),
  ];
  for (const rate of rates) {
    const one = frameToTicks(1, rate);
    assert.ok(Number.isSafeInteger(one));
    const frame = 10_000_001;
    assert.equal(frameToTicks(frame, rate), frame * one);
    assert.equal(ticksToFrame(frameToTicks(frame, rate), rate), frame);
    assert.equal(ticksToFrame(frameToTicks(frame, rate) + one - 1, rate, "floor"), frame);
    assert.equal(ticksToFrame(frameToTicks(frame, rate) + 1, rate, "ceil"), frame + 1);
  }
  assert.equal(
    frameToTicks(24_000 * 60 * 60, { numerator: 24000, denominator: 1001 }),
    3600 * 1001 * TICKS_PER_SECOND,
  );
  assert.equal(TICKS_PER_SECOND / 48_000, 5);
  assert.deepEqual(validateFrameRate({ numerator: 60, denominator: 2 }), {
    numerator: 30,
    denominator: 1,
  });
});

test("tick conversions round explicitly and reject overflow or unsupported clocks", () => {
  const rate = { numerator: 30000, denominator: 1001 };
  assert.equal(secondsToTicks(1.001), 240240);
  assert.equal(ticksToSeconds(240240), 1.001);
  assert.equal(snapToFrame(12012, rate), 16016);
  assert.equal(snapToFrame(12012, rate, "floor"), 8008);
  for (const invalid of [-1, 0.2, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "1"])
    assert.throws(() => assertTick(invalid));
  for (const invalid of [-1, Infinity, NaN, Number.MAX_SAFE_INTEGER])
    assert.throws(() => secondsToTicks(invalid));
  assert.throws(() => frameToTicks(Number.MAX_SAFE_INTEGER, rate));
  assert.throws(() => validateFrameRate({ numerator: 0, denominator: 1 }));
  assert.throws(() => validateFrameRate({ numerator: 30, denominator: 0 }));
  assert.throws(() => validateFrameRate({ numerator: 29.97, denominator: 1 }));
  assert.throws(() => validateFrameRate({ numerator: 120, denominator: 1 }));
});

test("time validators reject unknown fields, inherited records, and sparse node arrays", () => {
  assert.throws(() => validateFrameRate({ numerator: 30, denominator: 1, dropFrame: true }));
  assert.throws(() =>
    validateFrameRate(
      Object.assign(Object.create({ inherited: true }), { numerator: 30, denominator: 1 }),
    ),
  );
  const points = [
    { time: 0, source: 0 },
    { time: 10, source: 10 },
  ];
  assert.throws(() => validateTimeMap({ points, rate: 2 }, 10, 10));
  assert.throws(() =>
    validateTimeMap({ points: [{ ...points[0], easing: "ease-in" }, points[1]] }, 10, 10),
  );
  assert.throws(() => validateTimeMap({ points: [points[0], , points[1]] }, 10, 10));
  assert.throws(() =>
    validateTimeMap(Object.assign(Object.create({ inherited: true }), { points }), 10, 10),
  );
});

test("animation validators reject unsupported serialized fields and sparse keys", () => {
  const keys = [
    { time: 0, value: 0 },
    { time: 10, value: 1 },
  ];
  assert.throws(() => validateAnimatedNumber({ keyframes: keys, loop: true }));
  assert.throws(() =>
    validateAnimatedNumber({ keyframes: [{ ...keys[0], tension: 0.5 }, keys[1]] }),
  );
  assert.throws(() => validateAnimatedNumber({ keyframes: [keys[0], , keys[1]] }));
  assert.throws(() =>
    validateAnimatedNumber(Object.assign(Object.create({ inherited: true }), { keyframes: keys })),
  );
  assert.throws(() =>
    validateEasing({ type: "cubic-bezier", x1: 0, y1: 0, x2: 1, y2: 1, mirror: true }),
  );
  assert.throws(() =>
    validateEasing(
      Object.assign(Object.create({ inherited: true }), {
        type: "cubic-bezier",
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 1,
      }),
    ),
  );
});

test("time-map validation enforces duration, ordered local knots, and source bounds", () => {
  const original = {
    points: [
      { time: 0, source: 30 },
      { time: 10, source: 30 },
      { time: 20, source: 0 },
    ],
  };
  const validated = validateTimeMap(original, 20, 30);
  assert.deepEqual(validated, original);
  validated.points[0]!.source = 0;
  assert.equal(original.points[0]!.source, 30);
  for (const points of [
    [],
    [{ time: 0, source: 0 }],
    [
      { time: 1, source: 0 },
      { time: 20, source: 1 },
    ],
    [
      { time: 0, source: 0 },
      { time: 19, source: 1 },
    ],
    [
      { time: 0, source: 0 },
      { time: 10, source: 1 },
      { time: 10, source: 2 },
      { time: 20, source: 3 },
    ],
    [
      { time: 0, source: -1 },
      { time: 20, source: 1 },
    ],
    [
      { time: 0, source: 0 },
      { time: 20, source: 31 },
    ],
  ])
    assert.throws(() => validateTimeMap({ points }, 20, 30));
});

test("linear source maps preserve exact endpoints and avoid unsafe interpolation products", () => {
  const last = Number.MAX_SAFE_INTEGER;
  const map = validateTimeMap(
    {
      points: [
        { time: 0, source: last - 10 },
        { time: last, source: 1 },
      ],
    },
    last,
    last,
  );
  assert.equal(sourceTimeAt(map, 0), last - 10);
  assert.equal(sourceTimeAt(map, last), 1);
  const at = last - 1234;
  const n = BigInt(last - 10) * 1234n + BigInt(at);
  assert.equal(sourceTimeAt(map, at), Number((2n * n + BigInt(last)) / (2n * BigInt(last))));
  assert.equal(
    sourceTimeAt(
      {
        points: [
          { time: 0, source: 3 },
          { time: 10, source: 8 },
        ],
      },
      1,
    ),
    4,
  );
});

test("retained source intervals invert forward, reverse, hold, and repeated passes", () => {
  const map = validateTimeMap(
    {
      points: [
        { time: 0, source: 0 },
        { time: 100, source: 100 },
        { time: 200, source: 0 },
        { time: 230, source: 0 },
        { time: 330, source: 100 },
      ],
    },
    330,
    100,
  );
  assert.deepEqual(sourceRangesToTimeline(map, 20, 40), [
    { start: 20, end: 40 },
    { start: 161, end: 181 },
    { start: 250, end: 270 },
  ]);
  assert.deepEqual(sourceRangesToTimeline(freezeTimeMap(20, 100), 20, 21), [
    { start: 0, end: 100 },
  ]);
  assert.deepEqual(sourceRangesToTimeline(freezeTimeMap(20, 100), 0, 20), []);
  assert.deepEqual(sourceRangesToTimeline(map, 10, 10), []);
  assert.deepEqual(sourceRangesToTimeline(map, 200, 300), []);
  assert.throws(() => sourceRangesToTimeline(map, 40, 20));
});

test("inverse ranges exactly match every integral sample across fractional slopes", () => {
  const map: TimeMap = {
    points: [
      { time: 0, source: 3 },
      { time: 17, source: 30 },
      { time: 43, source: 7 },
      { time: 49, source: 7 },
      { time: 75, source: 40 },
    ],
  };
  for (let start = 0; start <= 41; start++) {
    const end = start + 3;
    const ranges = sourceRangesToTimeline(map, start, end);
    for (let time = 0; time < 75; time++) {
      const source = sourceTimeAt(map, time);
      assert.equal(
        ranges.some((range) => time >= range.start && time < range.end),
        source >= start && source < end,
        `source [${start},${end}), output ${time}, source sample ${source}`,
      );
    }
  }
});

test("splitting a map preserves source continuity and internal direction changes", () => {
  const map: TimeMap = {
    points: [
      { time: 0, source: 10 },
      { time: 100, source: 210 },
      { time: 150, source: 210 },
      { time: 250, source: 10 },
    ],
  };
  const left = sliceTimeMap(map, 0, 123),
    right = sliceTimeMap(map, 123, 250);
  assert.equal(sourceTimeAt(left, 123), sourceTimeAt(right, 0));
  for (let time = 0; time <= 127; time++)
    assert.equal(sourceTimeAt(right, time), sourceTimeAt(map, time + 123));
  assert.deepEqual(sliceTimeMap(map, 110, 140), freezeTimeMap(210, 30));
  assert.throws(() => sliceTimeMap(map, 10, 10));
  assert.throws(() => sliceTimeMap(map, 0, 251));
});

test("constant-rate and freeze constructors express actual output duration", () => {
  assert.deepEqual(constantTimeMap(20, 220, 2), {
    duration: 100,
    timeMap: {
      points: [
        { time: 0, source: 20 },
        { time: 100, source: 220 },
      ],
    },
  });
  assert.deepEqual(constantTimeMap(220, 20, 0.5), {
    duration: 400,
    timeMap: {
      points: [
        { time: 0, source: 220 },
        { time: 400, source: 20 },
      ],
    },
  });
  assert.deepEqual(freezeTimeMap(73, 500), {
    points: [
      { time: 0, source: 73 },
      { time: 500, source: 73 },
    ],
  });
  for (const rate of [0, -1, NaN, Infinity, 1e20])
    assert.throws(() => constantTimeMap(0, 100, rate));
  assert.throws(() => constantTimeMap(20, 20));
  assert.throws(() => freezeTimeMap(20, 0));
});

test("animated values validate keyframe order, duration, finite numbers, and curve controls", () => {
  const original = {
    keyframes: [
      { time: 10, value: -2, easing: "ease-in" },
      { time: 20, value: 4 },
    ],
  };
  assert.deepEqual(validateAnimatedNumber(original, 20), original);
  assert.equal(validateAnimatedNumber(5, 20), 5);
  for (const value of [
    NaN,
    Infinity,
    { keyframes: [] },
    { keyframes: [{ time: 1, value: Infinity }] },
    {
      keyframes: [
        { time: 1, value: 1 },
        { time: 1, value: 2 },
      ],
    },
    { keyframes: [{ time: 21, value: 1 }] },
  ])
    assert.throws(() => validateAnimatedNumber(value, 20));
  for (const value of [
    "unknown",
    { type: "cubic-bezier", x1: -0.1, x2: 1, y1: 0, y2: 1 },
    { type: "cubic-bezier", x1: 0, x2: 1, y1: -5, y2: 1 },
    { type: "cubic-bezier", x1: 0, x2: 1, y1: 0, y2: NaN },
  ])
    assert.throws(() => validateEasing(value));
});

test("evaluation uses preceding easing, exact keyframes, and constant outer ranges", () => {
  const value: AnimatedNumber = {
    keyframes: [
      { time: 20, value: 1, easing: "hold" },
      { time: 40, value: 5 },
      { time: 60, value: 15 },
    ],
  };
  assert.equal(evaluateAnimatedNumber(value, 0), 1);
  assert.equal(evaluateAnimatedNumber(value, 39), 1);
  assert.equal(evaluateAnimatedNumber(value, 40), 5);
  assert.equal(evaluateAnimatedNumber(value, 50), 10);
  assert.equal(evaluateAnimatedNumber(value, 100), 15);
  assert.equal(evaluateAnimatedNumber(7, 50), 7);
});

test("cubic-bezier solves x instead of incorrectly using elapsed time as curve parameter", () => {
  const value: AnimatedNumber = {
    keyframes: [
      { time: 0, value: 0, easing: { type: "cubic-bezier", x1: 1, y1: 0, x2: 1, y2: 0 } },
      { time: 1000, value: 1 },
    ],
  };
  near(evaluateAnimatedNumber(value, 500), (1 - Math.cbrt(0.5)) ** 3);
  assert.ok(Math.abs(evaluateAnimatedNumber(value, 500) - 0.125) > 0.1);
  const easeIn: AnimatedNumber = {
    keyframes: [
      { time: 0, value: 0, easing: "ease-in" },
      { time: 1000, value: 1 },
    ],
  };
  near(evaluateAnimatedNumber(easeIn, 500), 0.31535681257253934);
});

test("trimmed linear and held animations keep both endpoint values and discontinuities", () => {
  const value: AnimatedNumber = {
    keyframes: [
      { time: 20, value: 3, easing: "hold" },
      { time: 40, value: 7 },
      { time: 80, value: 15 },
    ],
  };
  const sliced = sliceAnimatedNumber(value, 10, 90);
  for (let time = 0; time <= 80; time++)
    assert.equal(evaluateAnimatedNumber(sliced, time), evaluateAnimatedNumber(value, time + 10));
  assert.equal(sliceAnimatedNumber(3, 10, 20), 3);
  assert.throws(() => sliceAnimatedNumber(value, 5, 5));
});

test("trimmed Bézier and overshoot animations preserve the remaining shape and split continuity", () => {
  const easings = [
    "ease-in",
    "ease-out",
    "ease-in-out",
    { type: "cubic-bezier", x1: 0.2, y1: -2, x2: 0.8, y2: 3 },
    { type: "cubic-bezier", x1: 0, y1: 4, x2: 1, y2: -4 },
  ];
  for (const easing of easings) {
    const value = validateAnimatedNumber({
      keyframes: [
        { time: 0, value: -10, easing },
        { time: 1000, value: 90 },
      ],
    });
    const sliced = sliceAnimatedNumber(value, 123, 876);
    validateAnimatedNumber(sliced, 753);
    for (let time = 0; time <= 753; time++)
      near(evaluateAnimatedNumber(sliced, time), evaluateAnimatedNumber(value, time + 123), 1e-7);
    const left = sliceAnimatedNumber(value, 0, 417),
      right = sliceAnimatedNumber(value, 417, 1000);
    near(evaluateAnimatedNumber(left, 417), evaluateAnimatedNumber(right, 0));
  }
});
