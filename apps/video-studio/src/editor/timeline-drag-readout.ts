import type { EditorOperation } from "./operations";
import { TICKS_PER_SECOND, type Tick } from "./time";

/** UI projection of a validated timeline plan, whose move batches explicitly include the anchor. */
export function dragReadoutRange(
  sequenceId: string,
  anchor: { id: string; start: Tick; duration: Tick },
  operations: readonly EditorOperation[],
): { start: Tick; end: Tick; duration: Tick } | undefined {
  let { start, duration } = anchor;
  for (const operation of operations) {
    if (!("sequenceId" in operation) || operation.sequenceId !== sequenceId) continue;
    if (operation.type === "clip.remove" && operation.clipIds.includes(anchor.id)) return;
    if (operation.type === "clip.update" && operation.clipId === anchor.id) {
      start = operation.patch.start ?? start;
      duration = operation.patch.duration ?? duration;
    } else if (operation.type === "clip.move" && operation.clipIds.includes(anchor.id))
      start += operation.delta;
  }
  return { start, end: start + duration, duration };
}

/** Six decimal places distinguish adjacent ticks without snapping the candidate to a frame. */
export function dragReadoutSeconds(time: Tick, signed = false): string {
  return `${signed && time >= 0 ? "+" : ""}${(time / TICKS_PER_SECOND).toFixed(6)} 秒`;
}
