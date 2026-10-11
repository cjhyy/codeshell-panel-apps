/** Measurements from the actual shared PCM mix, before playback/encoding can clip it. */
export interface EditorAudioMixReport {
  sampleCount: number;
  peak: number;
  samplesOverFullScale: number;
}

export function validateAudioMixReport(value: unknown): EditorAudioMixReport {
  const report = value as EditorAudioMixReport | null;
  if (
    !report ||
    !Number.isSafeInteger(report.sampleCount) ||
    report.sampleCount < 0 ||
    report.sampleCount > 86400 * 48000 ||
    !Number.isFinite(report.peak) ||
    report.peak < 0 ||
    !Number.isSafeInteger(report.samplesOverFullScale) ||
    report.samplesOverFullScale < 0 ||
    report.samplesOverFullScale > report.sampleCount ||
    report.peak > 1 !== report.samplesOverFullScale > 0 ||
    (!report.sampleCount && report.peak !== 0)
  )
    throw new Error("混音测量结果无效，请重新准备声音");
  return {
    sampleCount: report.sampleCount,
    peak: report.peak,
    samplesOverFullScale: report.samplesOverFullScale,
  };
}

/** A warning never changes gain, normalizes, or blocks the user's export. */
export function audioMixWarning(value: unknown): string {
  const report = validateAudioMixReport(value);
  if (!report.samplesOverFullScale) return "";
  const db = 20 * Math.log10(report.peak);
  const level = db < 0.05 ? "略高于 0 dBFS" : `+${db.toFixed(1)} dBFS`;
  return `混音峰值 ${level}，声音叠加或音量过高可能导致失真。请降低音轨或片段音量后重新播放或导出。`;
}

/** Historical export warnings belong to that job's immutable snapshot, never the open project. */
export function exportAudioMixWarning(result: any, request: any): string {
  if (
    result?.verified !== true ||
    !/^[a-f0-9]{64}$/.test(request?.documentHash ?? "") ||
    result.audioMix?.documentHash !== request.documentHash ||
    typeof request.sequenceId !== "string" ||
    result.audioMix.sequenceId !== request.sequenceId
  )
    return "";
  try {
    return audioMixWarning(result.audioMix);
  } catch {
    return "";
  }
}
