"use strict";
(() => {
  // src/editor/time.ts
  var TICKS_PER_SECOND = 24e4;
  var MAX_TICK = BigInt(Number.MAX_SAFE_INTEGER);

  // src/editor/validation.ts
  var MAX_EDITOR_TICK = 24 * 60 * 60 * TICKS_PER_SECOND;
  var MAX_DOCUMENT_CHARACTERS = 16 * 1024 * 1024;

  // src/editor/ducking.ts
  var DUCKING_PROCESSOR = "video-studio-ducking";
  function duckingStep(state, left, right, c) {
    state.power = c.rms * state.power + (1 - c.rms) * (left * left + right * right) / 2;
    const target = state.power >= c.threshold ? c.attenuation : 1;
    const coefficient = target < state.gain ? c.attack : c.release;
    state.gain = target + coefficient * (state.gain - target);
    return state.gain;
  }

  // src/editor/ducking-worklet.ts
  var DuckingProcessor = class extends AudioWorkletProcessor {
    state = { power: 0, gain: 1 };
    coefficients;
    constructor(options) {
      super(options);
      this.coefficients = options.processorOptions;
    }
    process(inputs, outputs) {
      const input = inputs[0] ?? [], left = input[0], right = input[1] ?? left, output = outputs[0][0];
      for (let i = 0; i < output.length; i++)
        output[i] = duckingStep(this.state, left ? left[i] : 0, right ? right[i] : 0, this.coefficients);
      return true;
    }
  };
  registerProcessor(DUCKING_PROCESSOR, DuckingProcessor);
})();
