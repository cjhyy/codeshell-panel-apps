import { evaluateAnimatedNumber } from "./animation";
import type { EvaluatedAudio } from "./evaluate";
import {
  sourceRangesToTimeline,
  sourceTimeAt,
  type Tick,
  type TimeMap,
  type TimeRange,
} from "./time";
import type { AudioMix, EditorAsset, EditorDocument, EditorSequence, EditorTrack } from "./types";
import { sequenceDuration, validateEditorDocument } from "./validation";

export const AUDIO_SAMPLE_RATE = 48000;
export const TICKS_PER_AUDIO_SAMPLE = 5;
export interface AudioSampleRange {
  startSample: number;
  endSample: number;
}
export interface AudioPlanStage {
  sequenceId: string;
  sequencePath: string;
  clipId: string;
  start: Tick;
  duration: Tick;
  timeMap: TimeMap;
  audio: AudioMix;
  track: Pick<EditorTrack, "id" | "volume" | "pan" | "muted">;
}
export interface AudioDuckingRequest extends NonNullable<AudioMix["ducking"]> {
  id: string;
  sidechainTrackInstanceIds: string[];
}
/** Each span has a constant signed map derivative. Coordinates still use the exact, nested tick maps. */
export interface AudioPlanSpan extends AudioSampleRange {
  playbackRate: number;
  sourceStart: Tick;
  sourceLast: Tick;
}
export interface AudioPlanLane {
  instanceId: string;
  assetId: string;
  assetKind: "audio" | "video";
  sourceDuration: Tick;
  sourceOffset: number;
  angleId?: string;
  stages: AudioPlanStage[];
  trackInstancePath: string[];
  duckingIds: string[];
  spans: AudioPlanSpan[];
}
export interface AudioPlan {
  sequenceId: string;
  duration: Tick;
  sampleRate: typeof AUDIO_SAMPLE_RATE;
  channels: 2;
  /** Samples live at n * 5 ticks; the final sample is strictly before duration. */
  sampleCount: number;
  lanes: AudioPlanLane[];
  ducking: AudioDuckingRequest[];
}

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const part = (kind: string, id: string) => `${kind}:${encodeURIComponent(id)}`;
const trackPath = (stage: AudioPlanStage) =>
  `${stage.sequencePath}/${part("track", stage.track.id)}`;

function rateAt(map: TimeMap, tick: Tick): number {
  let lo = 0,
    hi = map.points.length - 1;
  while (lo + 1 < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (map.points[mid]!.time <= tick) lo = mid;
    else hi = mid;
  }
  const a = map.points[lo]!,
    b = map.points[hi]!;
  return (b.source - a.source) / (b.time - a.time);
}

/** Same audio semantics as the frame evaluator, without evaluating the picture tree. */
export function sampleAudioLane(lane: AudioPlanLane, sample: number): EvaluatedAudio | null {
  if (
    !Number.isSafeInteger(sample) ||
    sample < 0 ||
    !Number.isSafeInteger(sample * TICKS_PER_AUDIO_SAMPLE)
  )
    throw new TypeError("Audio sample must be a nonnegative safe integer within the tick clock");
  let time = sample * TICKS_PER_AUDIO_SAMPLE;
  let gain = 1,
    pan = 0,
    pitchSemitones = 0,
    preservePitch = true,
    playbackRate = 1,
    fadeGain = 1,
    local = 0;
  const ducking: EvaluatedAudio["ducking"] = [];
  for (const stage of lane.stages) {
    local = time - stage.start;
    if (local < 0 || local >= stage.duration) return null;
    const mix = stage.audio;
    const fade =
      (mix.fadeIn ? clamp(local / mix.fadeIn, 0, 1) : 1) *
      (mix.fadeOut ? clamp((stage.duration - local) / mix.fadeOut, 0, 1) : 1);
    playbackRate *= rateAt(stage.timeMap, local);
    gain =
      stage.track.muted || !playbackRate
        ? 0
        : clamp(evaluateAnimatedNumber(mix.volume, local), 0, 4) * stage.track.volume * fade * gain;
    pan = clamp(
      pan + stage.track.pan + clamp(evaluateAnimatedNumber(mix.pan, local), -1, 1),
      -1,
      1,
    );
    pitchSemitones += mix.pitchSemitones;
    preservePitch &&= mix.preservePitch;
    fadeGain *= fade;
    if (mix.ducking)
      ducking.push({
        ...mix.ducking,
        sidechainTrackIds: [...mix.ducking.sidechainTrackIds],
        sequenceId: stage.sequenceId,
        sequenceTime: time,
        trackInstanceId: trackPath(stage),
        sidechainTrackInstanceIds: mix.ducking.sidechainTrackIds.map(
          (id) => `${stage.sequencePath}/${part("track", id)}`,
        ),
      });
    time = sourceTimeAt(stage.timeMap, local);
  }
  time += lane.sourceOffset;
  if (time < 0 || time >= lane.sourceDuration) return null;
  const leaf = lane.stages[lane.stages.length - 1]!;
  return {
    instanceId: lane.instanceId,
    sequenceId: leaf.sequenceId,
    clipId: leaf.clipId,
    trackId: leaf.track.id,
    trackInstanceId: trackPath(leaf),
    trackInstancePath: [...lane.trackInstancePath],
    assetId: lane.assetId,
    sourceTime: time,
    localTime: local,
    playbackRate,
    gain,
    pan,
    pitchSemitones,
    preservePitch,
    fadeGain,
    ducking,
    ...(lane.angleId ? { angleId: lane.angleId } : {}),
  };
}

function merge(ranges: TimeRange[]): TimeRange[] {
  const result: TimeRange[] = [];
  for (const range of ranges.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = result[result.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else if (range.start < range.end) result.push({ ...range });
  }
  return result;
}

function toRoot(ranges: TimeRange[], stages: AudioPlanStage[], before: number): TimeRange[] {
  for (let index = before - 1; index >= 0; index--) {
    const stage = stages[index]!;
    ranges = merge(
      ranges.flatMap((range) =>
        sourceRangesToTimeline(stage.timeMap, range.start, range.end).map((mapped) => ({
          start: mapped.start + stage.start,
          end: mapped.end + stage.start,
        })),
      ),
    );
  }
  return ranges;
}

function laneSpans(lane: AudioPlanLane, duration: Tick): AudioPlanSpan[] {
  const stages = lane.stages,
    leaf = stages[stages.length - 1]!;
  const lower = Math.max(0, -lane.sourceOffset),
    upper = lane.sourceDuration - lane.sourceOffset;
  if (upper <= lower) return [];
  const valid = toRoot(
    sourceRangesToTimeline(leaf.timeMap, lower, upper).map((range) => ({
      start: range.start + leaf.start,
      end: range.end + leaf.start,
    })),
    stages,
    stages.length - 1,
  );
  const boundaries = new Set<number>([0, Math.ceil(duration / TICKS_PER_AUDIO_SAMPLE)]);
  const add = (ranges: TimeRange[]) => {
    for (const range of ranges) {
      boundaries.add(Math.ceil(range.start / TICKS_PER_AUDIO_SAMPLE));
      boundaries.add(Math.ceil(range.end / TICKS_PER_AUDIO_SAMPLE));
    }
    if (boundaries.size > 1000000)
      throw new RangeError("Expanded audio map exceeds one million spans");
  };
  add(valid);
  for (let index = 0; index < stages.length; index++) {
    const stage = stages[index]!;
    for (let point = 0; point + 1 < stage.timeMap.points.length; point++) {
      add(
        toRoot(
          [
            {
              start: stage.start + stage.timeMap.points[point]!.time,
              end: stage.start + stage.timeMap.points[point + 1]!.time,
            },
          ],
          stages,
          index,
        ),
      );
    }
  }
  const sorted = [...boundaries].sort((a, b) => a - b),
    spans: AudioPlanSpan[] = [];
  for (let index = 0; index + 1 < sorted.length; index++) {
    const startSample = sorted[index]!,
      endSample = sorted[index + 1]!;
    if (startSample >= Math.ceil(duration / TICKS_PER_AUDIO_SAMPLE)) break;
    const first = sampleAudioLane(lane, startSample);
    if (!first || startSample === endSample) continue;
    const last = sampleAudioLane(lane, endSample - 1);
    if (!last || last.playbackRate !== first.playbackRate)
      throw new Error("Audio map partition lost a timing boundary");
    spans.push({
      startSample,
      endSample,
      playbackRate: first.playbackRate,
      sourceStart: first.sourceTime,
      sourceLast: last.sourceTime,
    });
  }
  return spans;
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

/** Validate/copy once and expand the selected sequence. Throws instead of dropping excess instances. */
export function compileAudioPlan(
  value: unknown,
  sequenceId: string,
  options: { maxLanes?: number } = {},
): AudioPlan {
  const document: EditorDocument = validateEditorDocument(value);
  const sequenceMap = new Map(document.sequences.map((sequence) => [sequence.id, sequence]));
  const assets = new Map(document.assets.map((asset) => [asset.id, asset]));
  const selected = sequenceMap.get(sequenceId);
  if (!selected) throw new Error(`Unknown audio sequence: ${sequenceId}`);
  const maxLanes = options.maxLanes ?? 4096;
  if (!Number.isSafeInteger(maxLanes) || maxLanes < 1 || maxLanes > 16384)
    throw new RangeError("maxLanes must be between 1 and 16384");
  const duration = sequenceDuration(selected);
  const plan: AudioPlan = {
    sequenceId,
    duration,
    sampleRate: AUDIO_SAMPLE_RATE,
    channels: 2,
    sampleCount: Math.ceil(duration / TICKS_PER_AUDIO_SAMPLE),
    lanes: [],
    ducking: [],
  };
  const requests = new Map<string, AudioDuckingRequest>();
  let expanded = 0;
  let spanCount = 0;
  const walk = (sequence: EditorSequence, path: string, ancestors: AudioPlanStage[]) => {
    for (const track of sequence.tracks)
      for (const clip of sequence.clips
        .filter((item) => item.trackId === track.id)
        .sort((a, b) => a.start - b.start)) {
        if (clip.kind !== "media" && clip.kind !== "sequence" && clip.kind !== "multicam") continue;
        if (++expanded > 100000) throw new RangeError("Expanded audio graph exceeds 100000 clips");
        const stage: AudioPlanStage = {
          sequenceId: sequence.id,
          sequencePath: path,
          clipId: clip.id,
          start: clip.start,
          duration: clip.duration,
          timeMap: clip.timeMap,
          audio: clip.audio,
          track: { id: track.id, volume: track.volume, pan: track.pan, muted: track.muted },
        };
        const stages = [...ancestors, stage],
          clipPath = `${path}/${part("clip", clip.id)}`;
        if (clip.kind === "sequence") {
          walk(
            sequenceMap.get(clip.sequenceId)!,
            `${clipPath}/${part("sequence", clip.sequenceId)}`,
            stages,
          );
          continue;
        }
        let asset: EditorAsset,
          offset = 0,
          angleId: string | undefined;
        if (clip.kind === "multicam") {
          const angle = clip.angles.find((item) => item.id === clip.audioAngleId)!;
          asset = assets.get(angle.assetId)!;
          offset = angle.offset;
          angleId = angle.id;
        } else asset = assets.get(clip.assetId)!;
        if (asset.kind !== "audio" && asset.kind !== "video") continue;
        if (plan.lanes.length >= maxLanes)
          throw new RangeError(`Audio plan exceeds the ${maxLanes} instance capacity`);
        const duckingIds: string[] = [];
        for (const ancestor of stages)
          if (ancestor.audio.ducking) {
            const id = `${ancestor.sequencePath}/${part("clip", ancestor.clipId)}/ducking`;
            requests.set(id, {
              ...ancestor.audio.ducking,
              id,
              sidechainTrackInstanceIds: ancestor.audio.ducking.sidechainTrackIds.map(
                (trackId) => `${ancestor.sequencePath}/${part("track", trackId)}`,
              ),
            });
            duckingIds.push(id);
          }
        const lane: AudioPlanLane = {
          instanceId: `${clipPath}/audio`,
          assetId: asset.id,
          assetKind: asset.kind,
          sourceDuration: asset.duration,
          sourceOffset: offset,
          stages,
          trackInstancePath: stages.map(trackPath),
          duckingIds,
          spans: [],
          ...(angleId ? { angleId } : {}),
        };
        lane.spans = laneSpans(lane, duration);
        spanCount += lane.spans.length;
        if (spanCount > 1000000)
          throw new RangeError("Audio plan exceeds one million expanded spans");
        plan.lanes.push(lane);
      }
  };
  walk(selected, part("sequence", sequenceId), []);
  plan.ducking = [...requests.values()];
  return freeze(plan);
}
