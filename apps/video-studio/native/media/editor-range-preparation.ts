import { sampleAudioLane, type AudioPlan } from "../../src/editor/audio-plan.js";
import { validateExportRange, type ExportRange } from "../../src/editor/export-range.js";
import { mergeTimeRanges, sourceTimeAt, type TimeMap, type TimeRange } from "../../src/editor/time.js";
import { sequenceDuration, validateEditorDocument } from "../../src/editor/validation.js";

/** Conservative picture dependencies, without changing the document or its original clock.
 * Integral endpoints include the evaluator's rounded nested/reverse/held map values.
 * Transitions only combine already-active clips, so both endpoints remain included. */
export function editorRangeVisualAssets(value: unknown, sequenceId: string, valueRange: ExportRange): Set<string> {
  const document = validateEditorDocument(value),
    sequences = new Map(document.sequences.map((sequence) => [sequence.id, sequence])),
    selected = sequences.get(sequenceId);
  if (!selected) throw new Error("导出序列不存在");
  const range = validateExportRange(valueRange, sequenceDuration(selected)),
    assets = new Set<string>();
  let expanded = 0;
  const mapped = (map: TimeMap, ranges: TimeRange[]): TimeRange[] => mergeTimeRanges(ranges.flatMap((range) => {
    const result: TimeRange[] = [];
    for (let index = 0; index + 1 < map.points.length; index++) {
      const start = Math.max(range.start, map.points[index]!.time),
        end = Math.min(range.end, map.points[index + 1]!.time);
      if (start >= end) continue;
      const a = sourceTimeAt(map, start), b = sourceTimeAt(map, end - 1);
      result.push({ start: Math.min(a, b), end: Math.max(a, b) + 1 });
    }
    return result;
  }));
  const visit = (id: string, ranges: TimeRange[]) => {
    const sequence = sequences.get(id)!,
      tracks = new Map(sequence.tracks.map((track) => [track.id, track]));
    for (const clip of sequence.clips) {
      if (++expanded > 100000) throw new RangeError("导出范围的嵌套素材超过准备上限");
      const track = tracks.get(clip.trackId)!;
      if (track.hidden || track.kind === "audio") continue;
      const local = ranges.flatMap((range) => {
        const start = Math.max(range.start, clip.start),
          end = Math.min(range.end, clip.start + clip.duration);
        return start < end ? [{ start: start - clip.start, end: end - clip.start }] : [];
      });
      if (!local.length) continue;
      if (clip.kind === "media") assets.add(clip.assetId);
      else if (clip.kind === "sequence") visit(clip.sequenceId, mapped(clip.timeMap, local));
      else if (clip.kind === "multicam") {
        for (let index = 0; index < clip.switches.length; index++) {
          const item = clip.switches[index]!, end = clip.switches[index + 1]?.time ?? clip.duration;
          if (local.some((range) => range.start < end && range.end > item.time))
            assets.add(clip.angles.find((angle) => angle.id === item.angleId)!.assetId);
        }
      }
    }
  };
  visit(sequenceId, [{ start: range.start, end: range.start + range.duration }]);
  return assets;
}

/** Stateful ducking needs its full history. WSOLA output depends on the original span's
 * context and phase, so retain the complete mix for any intersecting stretched/pitched span. */
export function editorRangeAudioPreparation(plan: AudioPlan, value: ExportRange): {
  range?: ExportRange;
  fallback?: "ducking" | "stretch" | "sub-sample";
} {
  const range = validateExportRange(value, plan.duration),
    start = Math.ceil(range.start / 5), end = Math.ceil((range.start + range.duration) / 5);
  if (start === end) return { fallback: "sub-sample" };
  if (plan.ducking.length) return { fallback: "ducking" };
  for (const lane of plan.lanes)
    for (const span of lane.spans) {
      if (span.startSample >= end || span.endSample <= start) continue;
      const state = sampleAudioLane(lane, Math.max(start, span.startSample))!;
      if (state.playbackRate && (Math.abs(state.playbackRate) !== 1 || state.pitchSemitones !== 0))
        return { fallback: "stretch" };
    }
  return { range };
}
