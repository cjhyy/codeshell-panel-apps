/** Deterministic Panel-native voice task fixture. Audio decoding still uses the
 * suite's real MP3; this is not a model-quality or actual inference test. */
export function installLocalVoiceProcessMock(options = {}) {
  window.__localVoiceTaskMockOptions = {
    installed: false,
    durationSeconds: 24,
    outputAssetId: "asset-" + "b".repeat(64),
    ...options,
  };
  window.__voiceRuntimeRequests = [];
}
