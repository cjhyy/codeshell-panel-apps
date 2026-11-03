import { DUCKING_PROCESSOR, duckingStep, type DuckingCoefficients, type DuckingState } from "./ducking";

/** Live preview ducking: input is the summed sidechain (stereo), output the gain envelope
 * that drives the ducked clips' gain parameters, computed exactly as the native renderer. */
declare const registerProcessor: (name: string, processor: unknown) => void;
declare class AudioWorkletProcessor {
  constructor(options?: unknown);
}

class DuckingProcessor extends AudioWorkletProcessor {
  private readonly state: DuckingState = { power: 0, gain: 1 };
  private readonly coefficients: DuckingCoefficients;
  constructor(options: { processorOptions: DuckingCoefficients }) {
    super(options);
    this.coefficients = options.processorOptions;
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0] ?? [],
      left = input[0],
      right = input[1] ?? left,
      output = outputs[0]![0]!;
    for (let i = 0; i < output.length; i++)
      output[i] = duckingStep(this.state, left ? left[i]! : 0, right ? right[i]! : 0, this.coefficients);
    return true;
  }
}
registerProcessor(DUCKING_PROCESSOR, DuckingProcessor);
