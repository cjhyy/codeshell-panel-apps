import { evaluateAnimatedNumber } from "./animation";
import { assertTick, sourceTimeAt, type Tick, type TimeMap } from "./time";
import type {
  AudioMix,
  ColorAdjustment,
  EditorAsset,
  EditorClip,
  EditorDocument,
  EditorSequence,
  EditorTrack,
  Mask,
  MediaClip,
  MulticamClip,
  SequenceClip,
  TextClip,
  TextStyle,
  Transform,
  Transition,
  VisualProperties,
} from "./types";
import { sequenceDuration, validateEditorDocument } from "./validation";

export interface ResolvedTransform extends Omit<
  Transform,
  "x" | "y" | "scaleX" | "scaleY" | "rotation" | "opacity"
> {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
}
export interface ResolvedColor extends Omit<
  ColorAdjustment,
  "exposure" | "brightness" | "contrast" | "saturation" | "temperature" | "tint" | "hue"
> {
  exposure: number;
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  hue: number;
}
export interface EvaluatedVisualBase {
  instanceId: string;
  sequenceId: string;
  clipId: string;
  trackId: string;
  localTime: Tick;
  transform: ResolvedTransform;
  color: ResolvedColor;
  blendMode: VisualProperties["blendMode"];
  mask?: Mask;
}
export interface EvaluatedMediaLayer extends EvaluatedVisualBase {
  kind: "media";
  assetId: string;
  assetKind: EditorAsset["kind"];
  sourceTime: Tick;
  naturalWidth: number;
  naturalHeight: number;
  angleId?: string;
}
export interface EvaluatedTextLayer extends EvaluatedVisualBase {
  kind: "text";
  text: string;
  role: TextClip["role"];
  style: TextStyle;
  words: TextClip["words"];
  activeWordIndices: number[];
  animationProgress: number;
}
export interface EvaluatedShapeLayer extends EvaluatedVisualBase {
  kind: "shape";
  shape: "rectangle" | "ellipse" | "line";
  fill: string;
  stroke: string;
  strokeWidth: number;
}
export interface EvaluatedGroupLayer extends EvaluatedVisualBase {
  kind: "group";
  sourceSequenceId: string;
  sourceTime: Tick;
  width: number;
  height: number;
  background: string;
  layers: EvaluatedLayer[];
}
export type EvaluatedVisualLayer =
  | EvaluatedMediaLayer
  | EvaluatedTextLayer
  | EvaluatedShapeLayer
  | EvaluatedGroupLayer;
export interface EvaluatedTransitionLayer {
  kind: "transition";
  instanceId: string;
  sequenceId: string;
  trackId: string;
  transitionId: string;
  transitionKind: Transition["kind"];
  progress: number;
  /** Composite the two endpoint images together before putting the result over lower tracks. */
  from: EvaluatedVisualLayer | null;
  to: EvaluatedVisualLayer | null;
}
export type EvaluatedLayer = EvaluatedVisualLayer | EvaluatedTransitionLayer;
export interface EvaluatedAudio {
  instanceId: string;
  sequenceId: string;
  clipId: string;
  trackId: string;
  trackInstanceId: string;
  /** Ancestor bus membership lets sidechains reference a track containing a nested sequence. */
  trackInstancePath: string[];
  assetId: string;
  sourceTime: Tick;
  localTime: Tick;
  /** Signed source-time derivative, composed through nested sequences. Zero means held/silent. */
  playbackRate: number;
  gain: number;
  pan: number;
  pitchSemitones: number;
  preservePitch: boolean;
  /** Includes the ancestor clip fades, but not volume or track gain. */
  fadeGain: number;
  angleId?: string;
  /** Requests for the real audio analyzer; evaluation never guesses speech activity. */
  ducking: Array<
    AudioMix["ducking"] & {
      sequenceId: string;
      sequenceTime: Tick;
      trackInstanceId: string;
      sidechainTrackInstanceIds: string[];
    }
  >;
}
export interface EvaluatedFrame {
  sequenceId: string;
  time: Tick;
  width: number;
  height: number;
  background: string;
  layers: EvaluatedLayer[];
  audio: EvaluatedAudio[];
}
export interface PreparedEvaluator {
  evaluate(sequenceId: string, tick: Tick): EvaluatedFrame;
}

type AudioClip = MediaClip | SequenceClip | MulticamClip;
interface AudioContext {
  gain: number;
  pan: number;
  pitchSemitones: number;
  preservePitch: boolean;
  playbackRate: number;
  fadeGain: number;
  ducking: EvaluatedAudio["ducking"];
  trackInstancePath: string[];
}
const neutralAudio = (): AudioContext => ({
  gain: 1,
  pan: 0,
  pitchSemitones: 0,
  preservePitch: true,
  playbackRate: 1,
  fadeGain: 1,
  ducking: [],
  trackInstancePath: [],
});
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const pathPart = (kind: string, id: string) => `${kind}:${encodeURIComponent(id)}`;
const inside = (clip: EditorClip, time: Tick) =>
  time >= clip.start && time - clip.start < clip.duration;

function resolveTransform(value: Transform, local: Tick): ResolvedTransform {
  const number = (key: "x" | "y" | "scaleX" | "scaleY" | "rotation" | "opacity") =>
    evaluateAnimatedNumber(value[key], local);
  return {
    x: clamp(number("x"), -10, 10),
    y: clamp(number("y"), -10, 10),
    scaleX: clamp(number("scaleX"), 0, 100),
    scaleY: clamp(number("scaleY"), 0, 100),
    rotation: clamp(number("rotation"), -360000, 360000),
    opacity: clamp(number("opacity"), 0, 1),
    flipX: value.flipX,
    flipY: value.flipY,
    fit: value.fit,
    crop: { ...value.crop },
  };
}

function resolveColor(value: ColorAdjustment, local: Tick): ResolvedColor {
  const number = (
    key: "exposure" | "brightness" | "contrast" | "saturation" | "temperature" | "tint" | "hue",
  ) => evaluateAnimatedNumber(value[key], local);
  return {
    exposure: clamp(number("exposure"), -10, 10),
    brightness: clamp(number("brightness"), -1, 1),
    contrast: clamp(number("contrast"), 0, 4),
    saturation: clamp(number("saturation"), 0, 4),
    temperature: clamp(number("temperature"), -1, 1),
    tint: clamp(number("tint"), -1, 1),
    hue: clamp(number("hue"), -360, 360),
    curves: value.curves.map((curve) => ({
      ...curve,
      points: curve.points.map((point) => ({ ...point })),
    })),
    hsl: value.hsl.map((range) => ({ ...range })),
  };
}

function timeMapRate(map: TimeMap, time: Tick): number {
  let left = 0,
    right = map.points.length - 1;
  while (left + 1 < right) {
    const middle = left + Math.floor((right - left) / 2);
    if (map.points[middle]!.time <= time) left = middle;
    else right = middle;
  }
  const a = map.points[left]!,
    b = map.points[right]!;
  return (b.source - a.source) / (b.time - a.time);
}

function audioContext(
  clip: AudioClip,
  track: EditorTrack,
  local: Tick,
  parent: AudioContext,
  sequenceId: string,
  sequencePath: string,
): AudioContext {
  const mix = clip.audio;
  const fade =
    (mix.fadeIn ? clamp(local / mix.fadeIn, 0, 1) : 1) *
    (mix.fadeOut ? clamp((clip.duration - local) / mix.fadeOut, 0, 1) : 1);
  const playbackRate = parent.playbackRate * timeMapRate(clip.timeMap, local);
  const ducking = parent.ducking.map((item) => ({
    ...item,
    sidechainTrackIds: [...item.sidechainTrackIds],
    sidechainTrackInstanceIds: [...item.sidechainTrackInstanceIds],
  }));
  if (mix.ducking)
    ducking.push({
      ...mix.ducking,
      sidechainTrackIds: [...mix.ducking.sidechainTrackIds],
      sequenceId,
      sequenceTime: clip.start + local,
      trackInstanceId: `${sequencePath}/${pathPart("track", track.id)}`,
      sidechainTrackInstanceIds: mix.ducking.sidechainTrackIds.map(
        (id) => `${sequencePath}/${pathPart("track", id)}`,
      ),
    });
  return {
    gain:
      track.muted || !playbackRate
        ? 0
        : clamp(evaluateAnimatedNumber(mix.volume, local), 0, 4) *
          track.volume *
          fade *
          parent.gain,
    pan: clamp(
      parent.pan + track.pan + clamp(evaluateAnimatedNumber(mix.pan, local), -1, 1),
      -1,
      1,
    ),
    pitchSemitones: parent.pitchSemitones + mix.pitchSemitones,
    preservePitch: parent.preservePitch && mix.preservePitch,
    playbackRate,
    fadeGain: parent.fadeGain * fade,
    ducking,
    trackInstancePath: [
      ...parent.trackInstancePath,
      `${sequencePath}/${pathPart("track", track.id)}`,
    ],
  };
}

/** Validate and take ownership once; output mutation cannot alter this saved evaluator. */
export function prepareEvaluator(value: unknown): PreparedEvaluator {
  const document: EditorDocument = validateEditorDocument(value);
  const assets = new Map(document.assets.map((asset) => [asset.id, asset]));
  const sequences = new Map(document.sequences.map((sequence) => [sequence.id, sequence]));
  const durations = new Map(
    document.sequences.map((sequence) => [sequence.id, sequenceDuration(sequence)]),
  );
  const tracks = new Map(
    document.sequences.map((sequence) => [
      sequence.id,
      sequence.tracks.map((track) => ({
        track,
        clips: sequence.clips
          .filter((clip) => clip.trackId === track.id)
          .sort((a, b) => a.start - b.start),
      })),
    ]),
  );

  function evaluateSequence(
    sequence: EditorSequence,
    tick: Tick,
    sequencePath: string,
    parent: AudioContext,
    visible: boolean,
  ): EvaluatedFrame {
    const frame: EvaluatedFrame = {
      sequenceId: sequence.id,
      time: tick,
      width: sequence.width,
      height: sequence.height,
      background: sequence.background,
      layers: [],
      audio: [],
    };
    if (tick >= durations.get(sequence.id)!) return frame;
    for (const { track, clips } of tracks.get(sequence.id)!) {
      const visual = new Map<string, EvaluatedVisualLayer | null>();
      const active = clips.filter((clip) => inside(clip, tick));
      const picture = visible && !track.hidden && track.kind !== "audio";
      for (const clip of active) {
        const localTime = tick - clip.start;
        const instanceId = `${sequencePath}/${pathPart("clip", clip.id)}`;
        const base = (): EvaluatedVisualBase => ({
          instanceId,
          sequenceId: sequence.id,
          clipId: clip.id,
          trackId: track.id,
          localTime,
          transform: resolveTransform(clip.transform, localTime),
          color: resolveColor(clip.color, localTime),
          blendMode: clip.blendMode,
          ...(clip.mask ? { mask: structuredClone(clip.mask) } : {}),
        });
        const mediaLayer = (
          asset: EditorAsset,
          sourceTime: Tick,
          angleId?: string,
        ): EvaluatedMediaLayer | null =>
          picture &&
          asset.kind !== "audio" &&
          sourceTime >= 0 &&
          (asset.kind === "image" || sourceTime < asset.duration)
            ? {
                ...base(),
                kind: "media",
                assetId: asset.id,
                assetKind: asset.kind,
                sourceTime,
                naturalWidth: asset.width ?? sequence.width,
                naturalHeight: asset.height ?? sequence.height,
                ...(angleId ? { angleId } : {}),
              }
            : null;
        const addAudio = (
          asset: EditorAsset,
          sourceTime: Tick,
          context: AudioContext,
          angleId?: string,
        ): void => {
          if (
            (asset.kind !== "video" && asset.kind !== "audio") ||
            sourceTime < 0 ||
            sourceTime >= asset.duration
          )
            return;
          frame.audio.push({
            ...context,
            instanceId: `${instanceId}/audio`,
            sequenceId: sequence.id,
            clipId: clip.id,
            trackId: track.id,
            trackInstanceId: `${sequencePath}/${pathPart("track", track.id)}`,
            assetId: asset.id,
            sourceTime,
            localTime,
            ...(angleId ? { angleId } : {}),
          });
        };
        if (clip.kind === "media") {
          const asset = assets.get(clip.assetId)!,
            sourceTime = sourceTimeAt(clip.timeMap, localTime);
          visual.set(clip.id, mediaLayer(asset, sourceTime));
          addAudio(
            asset,
            sourceTime,
            audioContext(clip, track, localTime, parent, sequence.id, sequencePath),
          );
        } else if (clip.kind === "multicam") {
          const source = sourceTimeAt(clip.timeMap, localTime);
          let switchIndex = clip.switches.length - 1;
          while (switchIndex > 0 && clip.switches[switchIndex]!.time > localTime) switchIndex--;
          const activeSwitch = clip.switches[switchIndex]!;
          const angle = clip.angles.find((item) => item.id === activeSwitch.angleId)!;
          const audioAngle = clip.angles.find((item) => item.id === clip.audioAngleId)!;
          visual.set(
            clip.id,
            mediaLayer(assets.get(angle.assetId)!, source + angle.offset, angle.id),
          );
          addAudio(
            assets.get(audioAngle.assetId)!,
            source + audioAngle.offset,
            audioContext(clip, track, localTime, parent, sequence.id, sequencePath),
            audioAngle.id,
          );
        } else if (clip.kind === "sequence") {
          const sourceTime = sourceTimeAt(clip.timeMap, localTime),
            nested = sequences.get(clip.sequenceId)!;
          const child = evaluateSequence(
            nested,
            sourceTime,
            `${instanceId}/${pathPart("sequence", nested.id)}`,
            audioContext(clip, track, localTime, parent, sequence.id, sequencePath),
            picture,
          );
          frame.audio.push(...child.audio);
          visual.set(
            clip.id,
            picture && sourceTime < durations.get(nested.id)!
              ? {
                  ...base(),
                  kind: "group",
                  sourceSequenceId: nested.id,
                  sourceTime,
                  width: nested.width,
                  height: nested.height,
                  background: nested.background,
                  layers: child.layers,
                }
              : null,
          );
        } else if (clip.kind === "text") {
          visual.set(
            clip.id,
            picture
              ? {
                  ...base(),
                  kind: "text",
                  role: clip.role,
                  text: clip.text,
                  style: structuredClone(clip.style),
                  words: clip.words.map((word) => ({ ...word })),
                  activeWordIndices: clip.words.flatMap((word, index) =>
                    localTime >= word.start && localTime < word.end ? [index] : [],
                  ),
                  animationProgress: localTime / clip.duration,
                }
              : null,
          );
        } else {
          visual.set(
            clip.id,
            picture
              ? {
                  ...base(),
                  kind: "shape",
                  shape: clip.shape,
                  fill: clip.fill,
                  stroke: clip.stroke,
                  strokeWidth: clip.strokeWidth,
                }
              : null,
          );
        }
      }
      if (!picture) continue;
      const transitionByClip = new Map<string, Transition>();
      for (const transition of sequence.transitions) {
        if (
          tick < transition.start ||
          tick - transition.start >= transition.duration ||
          !visual.has(transition.fromClipId) ||
          !visual.has(transition.toClipId)
        )
          continue;
        transitionByClip.set(transition.fromClipId, transition);
        transitionByClip.set(transition.toClipId, transition);
      }
      const emitted = new Set<string>();
      for (const clip of active) {
        const transition = transitionByClip.get(clip.id);
        if (transition) {
          if (emitted.has(transition.id)) continue;
          emitted.add(transition.id);
          frame.layers.push({
            kind: "transition",
            instanceId: `${sequencePath}/${pathPart("transition", transition.id)}`,
            sequenceId: sequence.id,
            trackId: track.id,
            transitionId: transition.id,
            transitionKind: transition.kind,
            progress: (tick - transition.start) / transition.duration,
            from: visual.get(transition.fromClipId) ?? null,
            to: visual.get(transition.toClipId) ?? null,
          });
        } else {
          const layer = visual.get(clip.id);
          if (layer) frame.layers.push(layer);
        }
      }
    }
    return frame;
  }

  return {
    evaluate(sequenceId, tick) {
      assertTick(tick, "求值时间");
      const sequence = sequences.get(sequenceId);
      if (!sequence) throw new Error("待求值的序列不存在");
      return evaluateSequence(
        sequence,
        tick,
        pathPart("sequence", sequenceId),
        neutralAudio(),
        true,
      );
    },
  };
}

/** Convenience for one-off inspection; playback should retain a prepared evaluator. */
export function evaluateFrame(document: unknown, sequenceId: string, tick: Tick): EvaluatedFrame {
  return prepareEvaluator(document).evaluate(sequenceId, tick);
}
