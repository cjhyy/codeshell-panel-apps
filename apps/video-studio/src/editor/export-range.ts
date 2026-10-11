import { assertTick, ticksToSeconds, type Tick } from "./time";
import { MAX_EDITOR_TICK } from "./validation";

/** Half-open original sequence interval. Audio is cropped from the complete mix so
 * stateful processing, such as ducking, retains its original envelope at the start. */
export interface ExportRange {
  start: Tick;
  duration: Tick;
}

export function validateExportRange(value: unknown, sequenceDuration?: Tick): ExportRange {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some((key) => key !== "start" && key !== "duration")
  ) throw new Error("导出范围格式无效");
  const range = value as ExportRange;
  assertTick(range.start);
  assertTick(range.duration);
  if (
    !range.duration || range.start + range.duration > MAX_EDITOR_TICK ||
    (sequenceDuration !== undefined && range.start + range.duration > sequenceDuration)
  ) throw new Error("导出范围须位于当前序列内，且结束晚于开始");
  return { start: range.start, duration: range.duration };
}

/** Receipts and warnings describe the requested interval, including full-sequence exports. */
export function sameExportRange(expected: unknown, actual: unknown): boolean {
  if (expected === undefined || actual === undefined) return expected === actual;
  try {
    const first = validateExportRange(expected),
      second = validateExportRange(actual);
    return first.start === second.start && first.duration === second.duration;
  } catch {
    return false;
  }
}

/** Keep sub-millisecond ranges distinguishable in durable history without unnecessary zeroes. */
export function exportRangeLabel(value: ExportRange): string {
  const range = validateExportRange(value),
    seconds = (tick: Tick) => ticksToSeconds(tick).toFixed(6).replace(/\.?0+$/, "");
  return `${seconds(range.start)}–${seconds(range.start + range.duration)} 秒`;
}
