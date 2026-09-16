import type { Tick } from "./time";

export const WAVEFORM_LIMITS = Object.freeze({
  bins: 65536,
  bytes: 768 * 1024,
  sampleRate: 48000,
  seconds: 86400,
});
/** Stereo envelope: each bin stores minimum, maximum and RMS across both channels.
 * Signed 16-bit values share peakScale, preserving peaks above full scale. */
export interface EditorWaveform {
  schemaVersion: 1;
  sourceHash: string;
  sampleRate: 48000;
  channels: 2;
  hasAudio: boolean;
  sampleCount: number;
  samplesPerBin: number;
  peakScale: number;
  data: Int16Array;
}
export interface StoredEditorWaveform extends Omit<EditorWaveform, "data"> {
  peaksBase64: string;
}
export function decodeEditorWaveform(value: unknown): EditorWaveform {
  const v = value as StoredEditorWaveform;
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).sort().join() !==
      "channels,hasAudio,peakScale,peaksBase64,sampleCount,sampleRate,samplesPerBin,schemaVersion,sourceHash" ||
    v.schemaVersion !== 1 ||
    !/^[a-f0-9]{64}$/.test(v.sourceHash) ||
    v.sampleRate !== 48000 ||
    v.channels !== 2 ||
    typeof v.hasAudio !== "boolean" ||
    !Number.isSafeInteger(v.sampleCount) ||
    v.sampleCount < 0 ||
    v.sampleCount > WAVEFORM_LIMITS.seconds * 48000 ||
    !Number.isSafeInteger(v.samplesPerBin) ||
    v.samplesPerBin < 1 ||
    v.samplesPerBin > WAVEFORM_LIMITS.seconds * 48000 ||
    !Number.isFinite(v.peakScale) ||
    v.peakScale < 1 ||
    v.peakScale > 1000000 ||
    typeof v.peaksBase64 !== "string" ||
    v.peaksBase64.length > WAVEFORM_LIMITS.bins * 8 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.peaksBase64)
  )
    throw new Error("波形数据无效或超过大小限制");
  const binary = atob(v.peaksBase64),
    bins = Math.ceil(v.sampleCount / v.samplesPerBin);
  if (
    bins > WAVEFORM_LIMITS.bins ||
    binary.length !== bins * 6 ||
    (v.hasAudio ? v.sampleCount === 0 : v.sampleCount !== 0)
  )
    throw new Error("波形长度不匹配");
  const data = new Int16Array(bins * 3);
  for (let i = 0; i < data.length; i++)
    data[i] = ((binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8)) << 16) >> 16;
  for (let i = 0; i < data.length; i += 3)
    if (
      data[i]! > data[i + 1]! ||
      data[i + 2]! < 0 ||
      data[i + 2]! > Math.max(Math.abs(data[i]!), Math.abs(data[i + 1]!)) + 1
    )
      throw new Error("波形包络无效");
  const { peaksBase64: _, ...metadata } = v;
  return { ...metadata, data };
}
/** Query a source-time interval, aggregating real bins. Hold frames are silent. */
export function waveformEnvelope(
  waveform: EditorWaveform,
  start: Tick,
  end: Tick,
): { min: number; max: number; rms: number } {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end))
    throw new TypeError("波形取样时间无效");
  if (start === end || !waveform.hasAudio) return { min: 0, max: 0, rms: 0 };
  const a = Math.max(0, Math.floor(Math.min(start, end) / 5 / waveform.samplesPerBin));
  const b = Math.min(
    waveform.data.length / 3,
    Math.ceil(Math.max(start, end) / 5 / waveform.samplesPerBin),
  );
  let min = 0,
    max = 0,
    square = 0,
    count = 0;
  for (let i = a; i < b; i++) {
    min = Math.min(min, waveform.data[i * 3]!);
    max = Math.max(max, waveform.data[i * 3 + 1]!);
    const weight = Math.min(
      waveform.samplesPerBin,
      waveform.sampleCount - i * waveform.samplesPerBin,
    );
    square += waveform.data[i * 3 + 2]! ** 2 * weight;
    count += weight;
  }
  const scale = waveform.peakScale / 32767;
  return { min: min * scale, max: max * scale, rms: count ? Math.sqrt(square / count) * scale : 0 };
}
