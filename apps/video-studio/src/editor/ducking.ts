import { AUDIO_SAMPLE_RATE, TICKS_PER_AUDIO_SAMPLE, type AudioDuckingRequest } from "./audio-plan";

/** AudioWorklet processor name registered by `ducking-worklet.ts`. */
export const DUCKING_PROCESSOR = "video-studio-ducking";

/** The one ducking detector: the native renderer and the live preview worklet both run it
 * sample by sample, so preview and export duck the same way. */
export interface DuckingCoefficients {
  /** Mean-square power threshold. */
  threshold: number;
  attenuation: number;
  attack: number;
  release: number;
  /** 10 ms exponential power average. */
  rms: number;
}
export interface DuckingState {
  power: number;
  gain: number;
}

export function duckingCoefficients(
  request: Pick<AudioDuckingRequest, "thresholdDb" | "attenuationDb" | "attack" | "release">,
): DuckingCoefficients {
  return {
    threshold: 10 ** (request.thresholdDb / 10),
    attenuation: 10 ** (-request.attenuationDb / 20),
    attack: request.attack ? Math.exp(-TICKS_PER_AUDIO_SAMPLE / request.attack) : 0,
    release: request.release ? Math.exp(-TICKS_PER_AUDIO_SAMPLE / request.release) : 0,
    rms: Math.exp(-1 / (AUDIO_SAMPLE_RATE * 0.01)),
  };
}

/** Advances one sample of the summed sidechain and returns the gain for that sample. */
export function duckingStep(state: DuckingState, left: number, right: number, c: DuckingCoefficients): number {
  state.power = c.rms * state.power + ((1 - c.rms) * (left * left + right * right)) / 2;
  const target = state.power >= c.threshold ? c.attenuation : 1;
  const coefficient = target < state.gain ? c.attack : c.release;
  state.gain = target + coefficient * (state.gain - target);
  return state.gain;
}
