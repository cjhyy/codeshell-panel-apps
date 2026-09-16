/** One tick is exact for supported video frames and 48 kHz audio samples. */
export const TICKS_PER_SECOND = 240_000;
export type Tick = number;
export interface FrameRate {
  numerator: number;
  denominator: number;
}
export type RoundMode = "floor" | "ceil" | "round";
export interface TimeMap {
  points: Array<{ time: Tick; source: Tick }>;
}
export interface TimeRange {
  start: Tick;
  end: Tick;
}

const MAX_TICK = BigInt(Number.MAX_SAFE_INTEGER);
const SUPPORTED_RATES = new Set([
  "24/1",
  "25/1",
  "30/1",
  "48/1",
  "50/1",
  "60/1",
  "24000/1001",
  "30000/1001",
  "60000/1001",
]);

export function assertTick(value: unknown, label = "时间"): Tick {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label}必须是非负安全整数刻度`);
  return value;
}

function object(value: unknown, label: string, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label}必须是对象`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error(`${label}必须是普通对象`);
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.includes(key)))
    throw new Error(`${label}包含不支持的字段`);
  return value as Record<string, unknown>;
}

export function validateFrameRate(value: unknown): FrameRate {
  const data = object(value, "帧率", ["numerator", "denominator"]);
  let numerator = assertTick(data.numerator, "帧率分子");
  let denominator = assertTick(data.denominator, "帧率分母");
  if (!numerator || !denominator) throw new Error("帧率分子和分母必须大于零");
  let a = numerator,
    b = denominator;
  while (b) [a, b] = [b, a % b];
  numerator /= a;
  denominator /= a;
  if (!SUPPORTED_RATES.has(`${numerator}/${denominator}`)) throw new Error("不支持此工程帧率");
  return { numerator, denominator };
}

export function secondsToTicks(seconds: number): Tick {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("秒数必须是非负有限数");
  return assertTick(Math.round(seconds * TICKS_PER_SECOND));
}

export function ticksToSeconds(tick: Tick): number {
  return assertTick(tick) / TICKS_PER_SECOND;
}

function frameTicks(rate: FrameRate): number {
  const { numerator, denominator } = validateFrameRate(rate);
  return (TICKS_PER_SECOND * denominator) / numerator;
}

function tickFromBigInt(value: bigint): Tick {
  if (value < 0n || value > MAX_TICK) throw new Error("时间超过安全整数刻度范围");
  return Number(value);
}

export function frameToTicks(frame: number, rate: FrameRate): Tick {
  return tickFromBigInt(BigInt(assertTick(frame, "帧序号")) * BigInt(frameTicks(rate)));
}

export function ticksToFrame(tick: Tick, rate: FrameRate, mode: RoundMode = "round"): number {
  const value = BigInt(assertTick(tick));
  const unit = BigInt(frameTicks(rate));
  if (!["floor", "ceil", "round"].includes(mode)) throw new Error("未知帧取整方式");
  const offset = mode === "ceil" ? unit - 1n : mode === "round" ? unit / 2n : 0n;
  return Number((value + offset) / unit);
}

export function snapToFrame(tick: Tick, rate: FrameRate, mode: RoundMode = "round"): Tick {
  return frameToTicks(ticksToFrame(tick, rate, mode), rate);
}

/** Endpoint source times are boundaries, and may equal the source duration. */
export function validateTimeMap(value: unknown, duration: Tick, sourceDuration: Tick): TimeMap {
  assertTick(duration, "片段时长");
  assertTick(sourceDuration, "素材时长");
  if (!duration) throw new Error("片段时长必须大于零");
  const data = object(value, "时间映射", ["points"]);
  if (!Array.isArray(data.points) || data.points.length < 2 || data.points.length > 100_000)
    throw new Error("时间映射需要 2 至 100000 个节点");
  if (
    Object.getPrototypeOf(data.points) !== Array.prototype ||
    Reflect.ownKeys(data.points).length !== data.points.length + 1
  )
    throw new Error("时间映射节点必须是连续的普通数组");
  for (let index = 0; index < data.points.length; index++)
    if (!Object.hasOwn(data.points, index)) throw new Error("时间映射节点不能留空");
  let previous = -1;
  const points = data.points.map((raw) => {
    const point = object(raw, "时间映射节点", ["time", "source"]);
    const time = assertTick(point.time, "局部时间");
    const source = assertTick(point.source, "源时间");
    if (time <= previous || time > duration) throw new Error("时间映射的局部时间必须严格递增");
    if (source > sourceDuration) throw new Error("时间映射超出素材时长");
    previous = time;
    return { time, source };
  });
  if (points[0]!.time !== 0 || points.at(-1)!.time !== duration)
    throw new Error("时间映射必须覆盖片段的完整时长");
  return { points };
}

/** Round the interpolated nonnegative source coordinate without overflowing Number. */
function interpolateSource(
  a: TimeMap["points"][number],
  b: TimeMap["points"][number],
  time: Tick,
): Tick {
  const width = BigInt(b.time - a.time);
  const elapsed = BigInt(time - a.time);
  const numerator = BigInt(a.source) * (width - elapsed) + BigInt(b.source) * elapsed;
  return tickFromBigInt((2n * numerator + width) / (2n * width));
}

/** Time maps passed to evaluators are validated at the document boundary. */
export function sourceTimeAt(map: TimeMap, time: Tick): Tick {
  assertTick(time, "局部时间");
  if (map.points.length < 2) throw new Error("时间映射缺少节点");
  if (time <= map.points[0]!.time) return map.points[0]!.source;
  if (time >= map.points.at(-1)!.time) return map.points.at(-1)!.source;
  let left = 0,
    right = map.points.length - 1;
  while (left + 1 < right) {
    const middle = left + Math.floor((right - left) / 2);
    if (map.points[middle]!.time <= time) left = middle;
    else right = middle;
  }
  return interpolateSource(map.points[left]!, map.points[right]!, time);
}

function firstTick(start: Tick, end: Tick, test: (time: Tick) => boolean): Tick {
  let left = start,
    right = end;
  while (left < right) {
    const middle = left + Math.floor((right - left) / 2);
    if (test(middle)) right = middle;
    else left = middle + 1;
  }
  return left;
}

/**
 * Invert [start,end) on integral output ticks, including reverse and held spans.
 * Reverse spans exclude the upper source boundary and include the lower one;
 * hence reversing 100→0 maps source [20,40) to output [61,81), not [60,80).
 */
export function sourceRangesToTimeline(map: TimeMap, start: Tick, end: Tick): TimeRange[] {
  assertTick(start, "源范围入点");
  assertTick(end, "源范围出点");
  if (end < start) throw new Error("源范围出点不能早于入点");
  if (start === end) return [];
  const ranges: TimeRange[] = [];
  for (let i = 0; i + 1 < map.points.length; i++) {
    const a = map.points[i]!,
      b = map.points[i + 1]!;
    const at = (time: Tick) => interpolateSource(a, b, time);
    let range: TimeRange;
    if (a.source === b.source) {
      if (a.source < start || a.source >= end) continue;
      range = { start: a.time, end: b.time };
    } else if (b.source > a.source) {
      range = {
        start: firstTick(a.time, b.time, (time) => at(time) >= start),
        end: firstTick(a.time, b.time, (time) => at(time) >= end),
      };
    } else {
      range = {
        start: firstTick(a.time, b.time, (time) => at(time) < end),
        end: firstTick(a.time, b.time, (time) => at(time) < start),
      };
    }
    if (range.start >= range.end) continue;
    const previous = ranges.at(-1);
    if (previous?.end === range.start) previous.end = range.end;
    else ranges.push(range);
  }
  return ranges;
}

export function sliceTimeMap(map: TimeMap, start: Tick, end: Tick): TimeMap {
  assertTick(start, "裁剪入点");
  assertTick(end, "裁剪出点");
  if (start >= end || end > map.points.at(-1)!.time)
    throw new Error("裁剪范围必须位于时间映射内且具有正时长");
  return {
    points: [
      { time: 0, source: sourceTimeAt(map, start) },
      ...map.points
        .filter((point) => point.time > start && point.time < end)
        .map((point) => ({ time: point.time - start, source: point.source })),
      { time: end - start, source: sourceTimeAt(map, end) },
    ],
  };
}

/** Positive speed magnitude; descending source endpoints represent reverse playback. */
export function constantTimeMap(
  inTick: Tick,
  outTick: Tick,
  rate = 1,
): { duration: Tick; timeMap: TimeMap } {
  assertTick(inTick, "源入点");
  assertTick(outTick, "源出点");
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("速度必须是正有限数");
  if (inTick === outTick) throw new Error("定格请使用独立的定格时间映射");
  const duration = assertTick(Math.round(Math.abs(outTick - inTick) / rate), "片段时长");
  if (!duration) throw new Error("变速后时长不能小于一个刻度");
  return {
    duration,
    timeMap: {
      points: [
        { time: 0, source: inTick },
        { time: duration, source: outTick },
      ],
    },
  };
}

export function freezeTimeMap(sourceTick: Tick, duration: Tick): TimeMap {
  assertTick(sourceTick, "定格源时间");
  assertTick(duration, "定格时长");
  if (!duration) throw new Error("定格时长必须大于零");
  return {
    points: [
      { time: 0, source: sourceTick },
      { time: duration, source: sourceTick },
    ],
  };
}
