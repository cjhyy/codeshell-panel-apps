import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runMediaProcess } from "../process-runner.js";
import { editorSourcePcmCacheKey } from "../media/editor-audio-renderer.js";
import {
  decodeEditorWaveform,
  WAVEFORM_LIMITS,
  type StoredEditorWaveform,
} from "../../src/editor/waveform.js";
import { abort, atomic, digest, fileHash, regular } from "./files.js";
import { EditorTaskError } from "./protocol.js";
const RATE = 48000,
  MAX_SAMPLES = RATE * WAVEFORM_LIMITS.seconds;
const safety = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  "mov,matroska,webm,avi,mp3,wav,aiff,flac,ogg,aac",
];
type Bin = { min: number; max: number; squares: number; count: number };
const empty = (): Bin => ({ min: Infinity, max: -Infinity, squares: 0, count: 0 });
/** Streaming aggregation keeps at most 65,536 bins and one incomplete PCM frame. */
export class WaveformAccumulator {
  private bins: Bin[] = [];
  private current = empty();
  private tail = Buffer.alloc(0);
  private samplesPerBin = 960;
  private sampleCount = 0;
  push(bytes: Buffer): void {
    const data = this.tail.length ? Buffer.concat([this.tail, bytes]) : bytes;
    const length = data.length - (data.length % 8);
    for (let offset = 0; offset < length; offset += 8) {
      if (++this.sampleCount > MAX_SAMPLES)
        throw new EditorTaskError("LIMIT_EXCEEDED", "波形分析最多支持 24 小时音频");
      const left = data.readFloatLE(offset),
        right = data.readFloatLE(offset + 4);
      if (
        !Number.isFinite(left) ||
        !Number.isFinite(right) ||
        Math.max(Math.abs(left), Math.abs(right)) > 1000000
      )
        throw new EditorTaskError("INVALID_AUDIO", "音频解码包含无效采样");
      this.current.min = Math.min(this.current.min, left, right);
      this.current.max = Math.max(this.current.max, left, right);
      this.current.squares += left * left + right * right;
      this.current.count++;
      if (this.current.count === this.samplesPerBin) {
        this.bins.push(this.current);
        this.current = empty();
        if (this.bins.length === WAVEFORM_LIMITS.bins) {
          const compact: Bin[] = [];
          for (let i = 0; i < this.bins.length; i += 2) {
            const a = this.bins[i]!,
              b = this.bins[i + 1]!;
            compact.push({
              min: Math.min(a.min, b.min),
              max: Math.max(a.max, b.max),
              squares: a.squares + b.squares,
              count: a.count + b.count,
            });
          }
          this.bins = compact;
          this.samplesPerBin *= 2;
        }
      }
    }
    this.tail = Buffer.from(data.subarray(length));
  }
  finish(sourceHash: string, hasAudio = true): StoredEditorWaveform {
    if (this.tail.length || (hasAudio && !this.sampleCount))
      throw new EditorTaskError("INVALID_AUDIO", "音频解码未得到完整采样");
    const bins = this.current.count ? [...this.bins, this.current] : this.bins;
    let peakScale = 1;
    for (const bin of bins) peakScale = Math.max(peakScale, Math.abs(bin.min), Math.abs(bin.max));
    const data = Buffer.alloc(bins.length * 6),
      scale = 32767 / peakScale;
    bins.forEach((bin, i) => {
      data.writeInt16LE(Math.round(bin.min * scale), i * 6);
      data.writeInt16LE(Math.round(bin.max * scale), i * 6 + 2);
      data.writeInt16LE(Math.round(Math.sqrt(bin.squares / (bin.count * 2)) * scale), i * 6 + 4);
    });
    return {
      schemaVersion: 1,
      sourceHash,
      sampleRate: RATE,
      channels: 2,
      hasAudio,
      sampleCount: this.sampleCount,
      samplesPerBin: this.samplesPerBin,
      peakScale,
      peaksBase64: data.toString("base64"),
    };
  }
}
export interface AnalyzeWaveformOptions {
  input: string;
  cacheDir: string;
  pcmCacheDir: string;
  sourceDuration: number;
  ffmpegPath: string;
  ffprobePath: string;
  signal: AbortSignal;
}
export async function analyzeEditorWaveform(options: AnalyzeWaveformOptions): Promise<{
  path: string;
  sourceHash: string;
  recipeHash: string;
  reused: boolean;
  reusedPcm: boolean;
}> {
  const { input, signal } = options;
  abort(signal);
  const sourceHash = await fileHash(input, signal);
  const version = (
    await runMediaProcess(options.ffmpegPath, ["-hide_banner", "-version"], {
      signal,
      maxStdoutBytes: 65536,
    })
  ).stdout.toString();
  const recipeHash = digest({ algorithm: "stereo-envelope-v1", sourceHash, decoder: version });
  const path = join(options.cacheDir, `${recipeHash}.json`);
  try {
    const cached = await regular(options.cacheDir, [`${recipeHash}.json`]);
    if ((await lstat(cached)).size > WAVEFORM_LIMITS.bytes)
      throw new EditorTaskError("INVALID_CACHE", "波形缓存超出大小限制");
    const waveform = decodeEditorWaveform(JSON.parse(await readFile(cached, "utf8")));
    if (waveform.sourceHash !== sourceHash)
      throw new EditorTaskError("INVALID_CACHE", "波形缓存与素材不匹配");
    return { path, sourceHash, recipeHash, reused: true, reusedPcm: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const probe = JSON.parse(
    (
      await runMediaProcess(
        options.ffprobePath,
        [
          "-v",
          "error",
          ...safety,
          "-show_entries",
          "format=start_time,duration:stream=codec_type,start_time,duration",
          "-of",
          "json",
          input,
        ],
        { signal, maxStdoutBytes: 1024 * 1024 },
      )
    ).stdout.toString(),
  );
  if (!Array.isArray(probe.streams)) throw new EditorTaskError("INVALID_AUDIO", "音频信息无效");
  const audio = probe.streams.find((s: any) => s.codec_type === "audio");
  const accumulator = new WaveformAccumulator();
  let reusedPcm = false;
  if (audio) {
    const origin = Number(probe.format?.start_time ?? 0),
      end = Number(audio.start_time ?? origin) - origin + Number(audio.duration);
    if (Number.isFinite(end) && end > WAVEFORM_LIMITS.seconds)
      throw new EditorTaskError("LIMIT_EXCEEDED", "波形分析最多支持 24 小时音频");
    const basename = `${editorSourcePcmCacheKey(sourceHash, options.sourceDuration, version)}.f32`;
    let pcm: string | undefined;
    try {
      const candidate = await regular(options.pcmCacheDir, [basename]),
        size = (await lstat(candidate)).size;
      // A cached export decode can be bounded by its declared source duration. Only
      // reuse when metadata establishes that the entire stream is present.
      if (
        Number.isFinite(end) &&
        end > 0 &&
        size % 8 === 0 &&
        size / 8 >= Math.ceil(end * RATE) - 1 &&
        options.sourceDuration / 240000 + 1 > end &&
        size / 8 <= MAX_SAMPLES
      )
        pcm = candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (pcm) {
      const stream = createReadStream(pcm),
        cancel = () => stream.destroy(new DOMException("Cancelled", "AbortError"));
      signal.addEventListener("abort", cancel, { once: true });
      try {
        abort(signal);
        for await (const bytes of stream) {
          abort(signal);
          accumulator.push(bytes);
        }
        reusedPcm = true;
      } finally {
        signal.removeEventListener("abort", cancel);
        stream.destroy();
      }
    } else {
      await runMediaProcess(
        options.ffmpegPath,
        [
          "-nostdin",
          "-v",
          "error",
          ...safety,
          "-copyts",
          "-start_at_zero",
          "-i",
          input,
          "-map",
          "0:a:0",
          "-vn",
          "-sn",
          "-dn",
          "-af",
          "aresample=48000:async=1:first_pts=0",
          "-ac",
          "2",
          "-ar",
          "48000",
          "-c:a",
          "pcm_f32le",
          "-f",
          "f32le",
          "pipe:1",
        ],
        { signal, progressStream: "stderr", onStdout: (bytes) => accumulator.push(bytes) },
      );
    }
  }
  abort(signal);
  if ((await fileHash(input, signal)) !== sourceHash)
    throw new EditorTaskError("SOURCE_CHANGED", "素材在波形分析时发生变化");
  const waveform = accumulator.finish(sourceHash, !!audio);
  decodeEditorWaveform(waveform);
  await atomic(path, Buffer.from(JSON.stringify(waveform)));
  abort(signal);
  return { path, sourceHash, recipeHash, reused: false, reusedPcm };
}
