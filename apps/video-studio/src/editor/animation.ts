import { assertTick, type Tick } from "./time";

export type Easing =
  | "linear"
  | "hold"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | { type: "cubic-bezier"; x1: number; y1: number; x2: number; y2: number };
export interface Keyframe {
  time: Tick;
  value: number;
  /** This keyframe controls interpolation to the following keyframe. */
  easing?: Easing;
}
export type AnimatedNumber = number | { keyframes: Keyframe[] };
type Cubic = Extract<Easing, object>;
type Point = { x: number; y: number };

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label}必须是有限数`);
  return value;
}

function object(value: unknown, allowed: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label}必须是对象`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error(`${label}必须是普通对象`);
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.includes(key)))
    throw new Error(`${label}包含不支持的字段`);
  return value as Record<string, unknown>;
}

export function validateEasing(value: unknown): Easing {
  if (
    typeof value === "string" &&
    ["linear", "hold", "ease-in", "ease-out", "ease-in-out"].includes(value)
  )
    return value as Easing;
  const data = object(value, ["type", "x1", "y1", "x2", "y2"], "关键帧缓动");
  if (data.type !== "cubic-bezier") throw new Error("未知关键帧缓动");
  const result: Cubic = {
    type: "cubic-bezier",
    x1: finite(data.x1, "贝塞尔 x1"),
    y1: finite(data.y1, "贝塞尔 y1"),
    x2: finite(data.x2, "贝塞尔 x2"),
    y2: finite(data.y2, "贝塞尔 y2"),
  };
  if (
    result.x1 < 0 ||
    result.x1 > 1 ||
    result.x2 < 0 ||
    result.x2 > 1 ||
    result.y1 < -4 ||
    result.y1 > 4 ||
    result.y2 < -4 ||
    result.y2 > 4
  )
    throw new Error("贝塞尔横轴控制点须在 0–1，纵轴控制点须在 -4–4");
  return result;
}

export function validateKeyframes(value: unknown, duration?: Tick): Keyframe[] {
  if (duration !== undefined) assertTick(duration, "动画时长");
  if (!Array.isArray(value) || !value.length || value.length > 100_000)
    throw new Error("动画需要 1 至 100000 个关键帧");
  if (
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    throw new Error("关键帧必须是连续的普通数组");
  for (let index = 0; index < value.length; index++)
    if (!Object.hasOwn(value, index)) throw new Error("关键帧不能留空");
  let previous = -1;
  return value.map((raw) => {
    const data = object(raw, ["time", "value", "easing"], "关键帧");
    const time = assertTick(data.time, "关键帧时间");
    if (time <= previous || (duration !== undefined && time > duration))
      throw new Error("关键帧时间必须严格递增且位于动画时长内");
    previous = time;
    return {
      time,
      value: finite(data.value, "关键帧数值"),
      ...(data.easing === undefined ? {} : { easing: validateEasing(data.easing) }),
    };
  });
}

export function validateAnimatedNumber(value: unknown, duration?: Tick): AnimatedNumber {
  if (duration !== undefined) assertTick(duration, "动画时长");
  if (typeof value === "number") return finite(value, "动画数值");
  const data = object(value, ["keyframes"], "动画数值");
  return { keyframes: validateKeyframes(data.keyframes, duration) };
}

function cubicFor(easing: Easing): Cubic | undefined {
  if (typeof easing === "object") return easing;
  if (easing === "ease-in") return { type: "cubic-bezier", x1: 0.42, y1: 0, x2: 1, y2: 1 };
  if (easing === "ease-out") return { type: "cubic-bezier", x1: 0, y1: 0, x2: 0.58, y2: 1 };
  if (easing === "ease-in-out") return { type: "cubic-bezier", x1: 0.42, y1: 0, x2: 0.58, y2: 1 };
  return undefined;
}

function coordinate(t: number, p1: number, p2: number): number {
  const rest = 1 - t;
  return 3 * rest * rest * t * p1 + 3 * rest * t * t * p2 + t * t * t;
}

/** Solve the time (x) coordinate first; the Bézier parameter is not elapsed time. */
function parameterAtX(cubic: Cubic, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let left = 0,
    right = 1;
  for (let i = 0; i < 56; i++) {
    const middle = (left + right) / 2;
    if (coordinate(middle, cubic.x1, cubic.x2) < x) left = middle;
    else right = middle;
  }
  return (left + right) / 2;
}

function progress(easing: Easing, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (easing === "hold") return 0;
  const cubic = cubicFor(easing);
  return cubic ? coordinate(parameterAtX(cubic, x), cubic.y1, cubic.y2) : x;
}

function preceding(keys: Keyframe[], time: Tick): number {
  let left = 0,
    right = keys.length - 1;
  while (left + 1 < right) {
    const middle = left + Math.floor((right - left) / 2);
    if (keys[middle]!.time <= time) left = middle;
    else right = middle;
  }
  return left;
}

/** Validated inputs are clamped to the first/last keyframe outside their range. */
export function evaluateAnimatedNumber(value: AnimatedNumber, time: Tick): number {
  assertTick(time, "动画时间");
  if (typeof value === "number") return value;
  const keys = value.keyframes;
  if (!keys.length) throw new Error("动画缺少关键帧");
  if (time <= keys[0]!.time) return keys[0]!.value;
  if (time >= keys.at(-1)!.time) return keys.at(-1)!.value;
  const index = preceding(keys, time),
    left = keys[index]!,
    right = keys[index + 1]!;
  if (time === left.time || left.value === right.value) return left.value;
  const amount = progress(left.easing ?? "linear", (time - left.time) / (right.time - left.time));
  // Weighted interpolation avoids overflowing a difference between opposite large values.
  return left.value * (1 - amount) + right.value * amount;
}

function mix(a: Point, b: Point, t: number): Point {
  return { x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t };
}

function split(points: Point[], t: number): [Point[], Point[]] {
  const a = mix(points[0]!, points[1]!, t),
    b = mix(points[1]!, points[2]!, t),
    c = mix(points[2]!, points[3]!, t);
  const d = mix(a, b, t),
    e = mix(b, c, t),
    f = mix(d, e, t);
  return [
    [points[0]!, a, d, f],
    [f, e, c, points[3]!],
  ];
}

function restrictCubic(cubic: Cubic, from: number, to: number): Cubic | undefined {
  if (from === 0 && to === 1) return { ...cubic };
  const first = parameterAtX(cubic, from),
    last = parameterAtX(cubic, to);
  const points: Point[] = [
    { x: 0, y: 0 },
    { x: cubic.x1, y: cubic.y1 },
    { x: cubic.x2, y: cubic.y2 },
    { x: 1, y: 1 },
  ];
  const prefix = split(points, last)[0];
  const part = first === 0 ? prefix : split(prefix, first / last)[1];
  const width = part[3]!.x - part[0]!.x,
    height = part[3]!.y - part[0]!.y;
  if (!width || !height) return undefined;
  const result: Cubic = {
    type: "cubic-bezier",
    x1: Math.max(0, Math.min(1, (part[1]!.x - part[0]!.x) / width)),
    y1: (part[1]!.y - part[0]!.y) / height,
    x2: Math.max(0, Math.min(1, (part[2]!.x - part[0]!.x) / width)),
    y2: (part[2]!.y - part[0]!.y) / height,
  };
  if (
    ![result.y1, result.y2].every(
      (number) => Number.isFinite(number) && number >= -4 && number <= 4,
    )
  )
    return undefined;
  return result;
}

function turningParameters(cubic: Cubic): number[] {
  // y'(t)/3 = a t² + b t + c.
  const a = 1 - 3 * cubic.y2 + 3 * cubic.y1;
  const b = 2 * (cubic.y2 - 2 * cubic.y1),
    c = cubic.y1;
  if (Math.abs(a) < 1e-14) return Math.abs(b) < 1e-14 ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)];
}

/**
 * Rebase a trim and preserve its boundary values and the remaining easing shape.
 * Overshoot extrema add keys at neighboring ticks; a one-tick interval has no
 * interior sample and can be linear without changing any representable value.
 */
export function sliceAnimatedNumber(value: AnimatedNumber, start: Tick, end: Tick): AnimatedNumber {
  assertTick(start, "动画裁剪入点");
  assertTick(end, "动画裁剪出点");
  if (start >= end) throw new Error("动画裁剪范围必须具有正时长");
  if (typeof value === "number") return value;
  const keys = value.keyframes;
  if (!keys.length) throw new Error("动画缺少关键帧");
  const times = new Set<number>([start, end]);
  for (const key of keys) if (key.time > start && key.time < end) times.add(key.time);
  for (let i = 0; i + 1 < keys.length; i++) {
    const left = keys[i]!,
      right = keys[i + 1]!,
      cubic = cubicFor(left.easing ?? "linear");
    if (!cubic || right.time <= start || left.time >= end || left.value === right.value) continue;
    for (const parameter of turningParameters(cubic)) {
      if (parameter <= 0 || parameter >= 1) continue;
      const time = left.time + coordinate(parameter, cubic.x1, cubic.x2) * (right.time - left.time);
      for (const tick of [Math.floor(time), Math.ceil(time)])
        if (tick > start && tick < end) times.add(tick);
    }
  }
  const sorted = [...times].sort((a, b) => a - b);
  const result: Keyframe[] = [];
  function segment(from: Tick, to: Tick): void {
    const initial = evaluateAnimatedNumber(value, from),
      final = evaluateAnimatedNumber(value, to);
    let easing: Easing = "linear";
    if (from >= keys[0]!.time && from < keys.at(-1)!.time) {
      const index = preceding(keys, from),
        left = keys[index]!,
        right = keys[index + 1]!;
      const original = left.easing ?? "linear",
        cubic = cubicFor(original);
      if (original === "hold") easing = "hold";
      else if (cubic && left.value !== right.value && to - from > 1) {
        const adjusted = restrictCubic(
          cubic,
          (from - left.time) / (right.time - left.time),
          (to - left.time) / (right.time - left.time),
        );
        if (!adjusted) {
          // Rare near-flat overshoots need another subdivision to remain within
          // the same validated control bounds; do not clamp or change the curve.
          const middle = from + Math.floor((to - from) / 2);
          segment(from, middle);
          segment(middle, to);
          return;
        }
        easing = adjusted;
      }
    }
    result.push({ time: from - start, value: initial, easing });
    if (to === end) result.push({ time: end - start, value: final });
  }
  for (let i = 0; i + 1 < sorted.length; i++) segment(sorted[i]!, sorted[i + 1]!);
  return { keyframes: result };
}
