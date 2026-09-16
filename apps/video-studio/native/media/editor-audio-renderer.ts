import { createHash, randomUUID } from "node:crypto";
import { createReadStream, closeSync, openSync, readSync, statSync, writeSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { setImmediate as yieldTask } from "node:timers/promises";
import {
  AUDIO_SAMPLE_RATE,
  compileAudioPlan,
  sampleAudioLane,
  TICKS_PER_AUDIO_SAMPLE,
  type AudioPlanLane,
  type AudioPlanSpan,
} from "../../src/editor/audio-plan.js";
import { mediaAbortError, runMediaProcess } from "./media-process-runner.js";

export interface EditorAudioRenderOptions {
  document: unknown;
  sequenceId: string;
  /** Only already-authorized, materialized local files. The renderer never resolves Host resources. */
  resolveAssetPath(assetId: string, signal: AbortSignal): string | Promise<string>;
  ffmpegPath: string;
  ffprobePath: string;
  workDir: string;
  cacheDir: string;
  outputPath: string;
  signal: AbortSignal;
  onProgress?: (progress: { fraction: number; stage: string }) => void | Promise<void>;
  /** Explicit disk budget, applied before decoding or writing PCM; no media is silently omitted. */
  maxPcmBytes?: number;
  /** Bounds temporary mixing arrays independently of the bounded source PCM reader. */
  maxMixBytes?: number;
}
export interface EditorAudioAssetReport {
  assetId: string;
  status: "decoded" | "no-audio-stream";
  sourceHash: string;
  sampleCount: number;
  cacheHit: boolean;
}
export interface EditorAudioRenderResult {
  path: string;
  sampleRate: 48000;
  channels: 2;
  sampleCount: number;
  peak: number;
  /** Float WAV retains headroom instead of silently normalizing the user's mix. */
  samplesOverFullScale: number;
  assets: EditorAudioAssetReport[];
  processing: {
    algorithm: "sample-mapped-pcm+ffmpeg-atempo-wsola-v1";
    processedSpans: number;
    spanCacheHits: number;
    /** WSOLA spans use source context; this is not a claim of phase-perfect time stretching. */
    contextSamples: number;
    pitchFactors: Array<{ instanceId: string; requested: number; effective: number }>;
  };
  ducking: {
    detector: "10ms-exponential-rms";
    envelope: "one-pole-gain";
    sidechain: "pre-ducking-scoped-bus";
    requestCount: number;
  };
}

const RATE = AUDIO_SAMPLE_RATE,
  CHANNELS = 2,
  BYTES = 8,
  BLOCK = 1024;
const CONTEXT = RATE / 4;
const CACHE_VERSION = "editor-audio-pcm-v2-timestamps";
const inputSafety = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  "mov,matroska,webm,avi,mp3,wav,aiff,flac,ogg,aac",
];
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Shared with waveform analysis; does not change source decoding or mix policy. */
export function editorSourcePcmCacheKey(
  sourceHash: string,
  sourceDuration: number,
  ffmpegVersion: string,
): string {
  return digest({
    version: CACHE_VERSION,
    decoder: ffmpegVersion,
    hash: sourceHash,
    samples: Math.ceil(sourceDuration / TICKS_PER_AUDIO_SAMPLE) + RATE,
  });
}
function cancelled(signal: AbortSignal): void {
  if (signal.aborted) throw mediaAbortError();
}
async function hashFile(path: string, signal: AbortSignal): Promise<string> {
  const hash = createHash("sha256"),
    stream = createReadStream(path);
  const abort = () => stream.destroy(mediaAbortError());
  signal.addEventListener("abort", abort, { once: true });
  try {
    cancelled(signal);
    for await (const chunk of stream) hash.update(chunk);
    return hash.digest("hex");
  } finally {
    signal.removeEventListener("abort", abort);
    stream.destroy();
  }
}
async function pcmExists(path: string, exactSamples?: number): Promise<boolean> {
  try {
    const info = await stat(path);
    return (
      info.isFile() &&
      info.size % BYTES === 0 &&
      (exactSamples === undefined || info.size === exactSamples * BYTES)
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
function writeAll(fd: number, buffer: Buffer): void {
  let offset = 0;
  while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset);
}

/** Bounded random access supports reverse playback without loading entire source files into RAM. */
class PcmStore {
  private files = new Map<string, { fd: number; samples: number }>();
  private blocks = new Map<string, Buffer>();
  private readonly blockSamples = 8192;
  private file(path: string): { fd: number; samples: number } {
    const saved = this.files.get(path);
    if (saved) {
      this.files.delete(path);
      this.files.set(path, saved);
      return saved;
    }
    if (this.files.size >= 32) {
      const key = this.files.keys().next().value!;
      closeSync(this.files.get(key)!.fd);
      this.files.delete(key);
    }
    const size = statSync(path).size;
    if (size % BYTES) throw new Error(`Incomplete PCM cache: ${path}`);
    const file = { fd: openSync(path, "r"), samples: size / BYTES };
    this.files.set(path, file);
    return file;
  }
  sample(path: string, position: number, channel: number): number {
    const lo = Math.floor(position),
      fraction = position - lo;
    const first = this.integer(path, lo, channel);
    return fraction ? first + (this.integer(path, lo + 1, channel) - first) * fraction : first;
  }
  private integer(path: string, sample: number, channel: number): number {
    const file = this.file(path);
    if (sample < 0 || sample >= file.samples) return 0;
    const block = Math.floor(sample / this.blockSamples),
      key = `${path}\0${block}`;
    let bytes = this.blocks.get(key);
    if (bytes) {
      this.blocks.delete(key);
      this.blocks.set(key, bytes);
    } else {
      if (this.blocks.size >= 64) this.blocks.delete(this.blocks.keys().next().value!);
      bytes = Buffer.alloc(
        Math.min(this.blockSamples, file.samples - block * this.blockSamples) * BYTES,
      );
      let read = 0;
      while (read < bytes.length) {
        const count = readSync(
          file.fd,
          bytes,
          read,
          bytes.length - read,
          block * this.blockSamples * BYTES + read,
        );
        if (!count) throw new Error("PCM cache was truncated during render");
        read += count;
      }
      this.blocks.set(key, bytes);
    }
    const value = bytes.readFloatLE((sample % this.blockSamples) * BYTES + channel * 4);
    if (!Number.isFinite(value)) throw new Error("Audio PCM contains a non-finite sample");
    return value;
  }
  dispose(): void {
    for (const file of this.files.values()) closeSync(file.fd);
    this.files.clear();
    this.blocks.clear();
  }
}

function tempoFilters(factor: number): string[] {
  if (!(factor > 0) || !Number.isFinite(factor))
    throw new Error("The requested audio tempo is not representable");
  const filters: string[] = [];
  while (factor < 0.5) {
    filters.push("atempo=0.5");
    factor /= 0.5;
  }
  while (factor > 2) {
    filters.push("atempo=2");
    factor /= 2;
  }
  if (Math.abs(factor - 1) > 1e-12) filters.push(`atempo=${factor.toPrecision(17)}`);
  return filters;
}

/**
 * Produce the same reusable 48k stereo float WAV for preview and final video muxing.
 * Tick maps, envelopes and placement are evaluated per sample. Pitch-preserving retiming uses
 * FFmpeg's WSOLA, with 250ms context around each constant-rate span; it can change waveform phase.
 * Sidechain detection uses the actual dry mix, so cycles have deterministic, feedback-free meaning.
 */
export async function renderEditorAudio(
  options: EditorAudioRenderOptions,
): Promise<EditorAudioRenderResult> {
  const { signal } = options;
  cancelled(signal);
  for (const [name, path] of Object.entries({
    workDir: options.workDir,
    cacheDir: options.cacheDir,
    outputPath: options.outputPath,
  }))
    if (!isAbsolute(path)) throw new Error(`${name} must be an absolute authorized path`);
  const plan = compileAudioPlan(options.document, options.sequenceId);
  const lanes = plan.lanes.filter((lane) => lane.spans.length > 0);
  const budget = options.maxPcmBytes ?? 64 * 1024 ** 3;
  const mixBudget = options.maxMixBytes ?? 256 * 1024 ** 2;
  if (!Number.isSafeInteger(mixBudget) || mixBudget < BYTES)
    throw new RangeError("maxMixBytes must be a positive safe byte budget");
  if (!Number.isSafeInteger(budget) || budget < BYTES)
    throw new RangeError("maxPcmBytes must be a positive safe byte budget");
  let reserved = 0;
  const reserve = (bytes: number) => {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || reserved + bytes > budget)
      throw new Error(`Audio PCM exceeds the configured ${budget} byte disk budget`);
    reserved += bytes;
  };
  reserve(plan.sampleCount * BYTES * 2);
  await mkdir(options.workDir, { recursive: true });
  await mkdir(options.cacheDir, { recursive: true });
  await mkdir(dirname(options.outputPath), { recursive: true });
  const temporary = await mkdtemp(join(options.workDir, "editor-audio-"));
  const outputTemporary = `${options.outputPath}.${randomUUID()}.tmp`;
  const store = new PcmStore();
  const run = (executable: string, args: string[]) => runMediaProcess(executable, args, { signal });
  const result: EditorAudioRenderResult = {
    path: options.outputPath,
    sampleRate: RATE,
    channels: CHANNELS,
    sampleCount: plan.sampleCount,
    peak: 0,
    samplesOverFullScale: 0,
    assets: [],
    processing: {
      algorithm: "sample-mapped-pcm+ffmpeg-atempo-wsola-v1",
      processedSpans: 0,
      spanCacheHits: 0,
      contextSamples: CONTEXT,
      pitchFactors: [],
    },
    ducking: {
      detector: "10ms-exponential-rms",
      envelope: "one-pole-gain",
      sidechain: "pre-ducking-scoped-bus",
      requestCount: plan.ducking.length,
    },
  };
  const progress = async (fraction: number, stage: string) => {
    cancelled(signal);
    await options.onProgress?.({ fraction, stage });
  };
  try {
    const version = (await run(options.ffmpegPath, ["-hide_banner", "-version"])).stdout.toString();
    const filters = (await run(options.ffmpegPath, ["-hide_banner", "-filters"])).stdout.toString();
    for (const filter of ["aresample", "asetrate", "atempo", "atrim"])
      if (!new RegExp(`\\s${filter}\\s+A->A`).test(filters))
        throw new Error(`FFmpeg lacks the required ${filter} audio filter`);
    const assets = new Map<string, { path: string | null; hash: string }>();
    const unique = [...new Map(lanes.map((lane) => [lane.assetId, lane])).values()];
    for (let index = 0; index < unique.length; index++) {
      const lane = unique[index]!;
      await progress((0.2 * index) / Math.max(1, unique.length), "decode-audio");
      const path = await options.resolveAssetPath(lane.assetId, signal);
      cancelled(signal);
      if (!isAbsolute(path))
        throw new Error(
          `Audio asset ${lane.assetId} was not materialized to an absolute local path`,
        );
      const before = await stat(path);
      if (!before.isFile()) throw new Error(`Audio asset ${lane.assetId} is not a file`);
      const hash = await hashFile(path, signal);
      const probe = JSON.parse(
        (
          await run(options.ffprobePath, [
            "-v",
            "error",
            ...inputSafety,
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_type,sample_rate,channels",
            "-of",
            "json",
            path,
          ])
        ).stdout.toString(),
      ) as { streams?: Array<{ codec_type?: string }> };
      if (!Array.isArray(probe.streams))
        throw new Error(`Invalid audio probe result for ${lane.assetId}`);
      if (!probe.streams.some((stream) => stream.codec_type === "audio")) {
        if (lane.assetKind === "audio")
          throw new Error(`Audio asset ${lane.assetId} contains no decodable audio stream`);
        assets.set(lane.assetId, { path: null, hash });
        result.assets.push({
          assetId: lane.assetId,
          status: "no-audio-stream",
          sourceHash: hash,
          sampleCount: 0,
          cacheHit: false,
        });
        continue;
      }
      const samples = Math.ceil(lane.sourceDuration / TICKS_PER_AUDIO_SAMPLE) + RATE;
      reserve(samples * BYTES);
      const cachePath = join(
        options.cacheDir,
        `${editorSourcePcmCacheKey(hash, lane.sourceDuration, version)}.f32`,
      );
      const cacheHit = await pcmExists(cachePath);
      if (!cacheHit) {
        const scratch = join(temporary, `${randomUUID()}.f32`);
        await run(options.ffmpegPath, [
          "-nostdin",
          "-v",
          "error",
          ...inputSafety,
          "-copyts",
          "-start_at_zero",
          "-i",
          path,
          "-map",
          "0:a:0",
          "-vn",
          "-sn",
          "-dn",
          // Preserve the audio stream's offset within a video and real timestamp gaps.
          "-af",
          `aresample=${RATE}:async=1:first_pts=0`,
          "-t",
          (samples / RATE).toPrecision(17),
          "-ac",
          "2",
          "-ar",
          String(RATE),
          "-c:a",
          "pcm_f32le",
          "-f",
          "f32le",
          "-y",
          scratch,
        ]);
        if (!(await pcmExists(scratch)))
          throw new Error(`Decoder produced incomplete PCM for ${lane.assetId}`);
        const after = await stat(path);
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
          throw new Error(`Audio asset ${lane.assetId} changed during rendering`);
        await rename(scratch, cachePath);
      }
      const sampleCount = (await stat(cachePath)).size / BYTES;
      if (!sampleCount) throw new Error(`Audio stream for ${lane.assetId} decoded to no samples`);
      if (sampleCount > samples)
        throw new Error(`Decoder exceeded the expected PCM bound for ${lane.assetId}`);
      assets.set(lane.assetId, { path: cachePath, hash });
      result.assets.push({
        assetId: lane.assetId,
        status: "decoded",
        sourceHash: hash,
        sampleCount,
        cacheHit,
      });
    }

    const processed = new Map<AudioPlanSpan, string>();
    const spanTotal = lanes.reduce((sum, lane) => sum + lane.spans.length, 0);
    let spanIndex = 0;
    for (const lane of lanes)
      for (const span of lane.spans) {
        await progress(0.2 + (0.3 * spanIndex++) / Math.max(1, spanTotal), "retime-audio");
        const asset = assets.get(lane.assetId)!;
        if (!asset.path || span.playbackRate === 0) continue;
        const state = sampleAudioLane(lane, span.startSample)!;
        const speed = Math.abs(span.playbackRate),
          pitch = 2 ** (state.pitchSemitones / 12) * (state.preservePitch ? 1 : speed);
        // Unity-rate playback reads exact mapped samples, including reverse and nested rounding.
        // Other rates use the resampler's low-pass filter to avoid aliasing when speeding up.
        if (state.pitchSemitones === 0 && speed === 1) continue;
        const shiftedRate = Math.round(RATE * pitch);
        if (!Number.isSafeInteger(shiftedRate) || shiftedRate < 1 || shiftedRate > 2147483647)
          throw new Error(
            `Audio pitch for ${lane.instanceId} exceeds FFmpeg's sample-rate capability`,
          );
        const effectivePitch = shiftedRate / RATE;
        result.processing.pitchFactors.push({
          instanceId: lane.instanceId,
          requested: pitch,
          effective: effectivePitch,
        });
        const count = span.endSample - span.startSample;
        const sourceCount = Math.ceil(count * speed) + 2 * CONTEXT;
        reserve((sourceCount + count) * BYTES);
        const cachePath = join(
          options.cacheDir,
          `${digest({ version: CACHE_VERSION, decoder: version, source: asset.hash, start: span.sourceStart, count, speed, direction: Math.sign(span.playbackRate), shiftedRate, context: CONTEXT })}.f32`,
        );
        result.processing.processedSpans++;
        if (await pcmExists(cachePath, count)) {
          result.processing.spanCacheHits++;
          processed.set(span, cachePath);
          continue;
        }
        const input = join(temporary, `${randomUUID()}.f32`),
          output = join(temporary, `${randomUUID()}.f32`);
        const fd = openSync(input, "wx"),
          direction = Math.sign(span.playbackRate);
        try {
          for (let start = 0; start < sourceCount; start += BLOCK) {
            cancelled(signal);
            const length = Math.min(BLOCK, sourceCount - start),
              bytes = Buffer.allocUnsafe(length * BYTES);
            for (let i = 0; i < length; i++)
              for (let channel = 0; channel < CHANNELS; channel++)
                bytes.writeFloatLE(
                  store.sample(
                    asset.path,
                    span.sourceStart / TICKS_PER_AUDIO_SAMPLE + direction * (start + i - CONTEXT),
                    channel,
                  ),
                  i * BYTES + channel * 4,
                );
            writeAll(fd, bytes);
            await yieldTask();
          }
        } finally {
          closeSync(fd);
        }
        const trimStart = Math.round(CONTEXT / speed);
        const chain = [
          `asetrate=${shiftedRate}`,
          `aresample=${RATE}`,
          ...tempoFilters(speed / effectivePitch),
          `atrim=start_sample=${trimStart}:end_sample=${trimStart + count}`,
        ];
        await run(options.ffmpegPath, [
          "-nostdin",
          "-v",
          "error",
          "-f",
          "f32le",
          "-ar",
          String(RATE),
          "-ac",
          "2",
          "-i",
          input,
          "-af",
          chain.join(","),
          "-c:a",
          "pcm_f32le",
          "-f",
          "f32le",
          "-y",
          output,
        ]);
        if (!(await pcmExists(output, count)))
          throw new Error(
            `FFmpeg time stretching could not provide all ${count} samples for ${lane.instanceId}; no silent tail was substituted`,
          );
        await rename(output, cachePath);
        await rm(input);
        processed.set(span, cachePath);
      }

    const dryBuses = new Set(plan.ducking.flatMap((request) => request.sidechainTrackInstanceIds));
    const detector = new Map(plan.ducking.map((request) => [request.id, { power: 0, gain: 1 }]));
    const rmsCoefficient = Math.exp(-1 / (RATE * 0.01));
    const cursors = new Map(lanes.map((lane) => [lane, 0]));
    const raw = join(temporary, "mix.f32"),
      fd = openSync(raw, "wx");
    try {
      for (let start = 0; start < plan.sampleCount; start += BLOCK) {
        const count = Math.min(BLOCK, plan.sampleCount - start),
          end = start + count;
        let mixBytes = count * BYTES * 3;
        if (mixBytes > mixBudget)
          throw new Error(`Audio mixing exceeds the configured ${mixBudget} byte memory budget`);
        const allocate = (length: number): Float64Array => {
          mixBytes += length * 8;
          if (mixBytes > mixBudget)
            throw new Error(`Audio mixing exceeds the configured ${mixBudget} byte memory budget`);
          return new Float64Array(length);
        };
        const buses = new Map<string, Float64Array>();
        const dry: Array<{ lane: AudioPlanLane; samples: Float64Array }> = [];
        for (const lane of lanes) {
          const asset = assets.get(lane.assetId)!;
          if (!asset.path) continue;
          let cursor = cursors.get(lane)!;
          while (cursor < lane.spans.length && lane.spans[cursor]!.endSample <= start) cursor++;
          cursors.set(lane, cursor);
          const spans: AudioPlanSpan[] = [];
          while (cursor < lane.spans.length && lane.spans[cursor]!.startSample < end)
            spans.push(lane.spans[cursor++]!);
          if (!spans.length) continue;
          const samples = allocate(count * CHANNELS);
          for (const span of spans)
            for (
              let sample = Math.max(start, span.startSample);
              sample < Math.min(end, span.endSample);
              sample++
            ) {
              const state = sampleAudioLane(lane, sample)!;
              if (!state.gain || !state.playbackRate) continue;
              const transformed = processed.get(span),
                sourcePath = transformed ?? asset.path;
              const coordinate = transformed
                ? sample - span.startSample
                : state.sourceTime / TICKS_PER_AUDIO_SAMPLE;
              const left = store.sample(sourcePath, coordinate, 0),
                right = store.sample(sourcePath, coordinate, 1);
              const angle = ((state.pan <= 0 ? state.pan + 1 : state.pan) * Math.PI) / 2;
              // StereoPanner semantics: center preserves stereo, either extreme folds both channels to that side.
              const l =
                (state.pan <= 0 ? left + right * Math.cos(angle) : left * Math.cos(angle)) *
                state.gain;
              const r =
                (state.pan <= 0 ? right * Math.sin(angle) : right + left * Math.sin(angle)) *
                state.gain;
              const offset = (sample - start) * CHANNELS;
              samples[offset] = l;
              samples[offset + 1] = r;
              for (const busId of lane.trackInstancePath) {
                if (dryBuses.has(busId)) {
                  let bus = buses.get(busId);
                  if (!bus) {
                    bus = allocate(count * CHANNELS);
                    buses.set(busId, bus);
                  }
                  bus[offset] += l;
                  bus[offset + 1] += r;
                }
              }
            }
          dry.push({ lane, samples });
        }
        const envelopes = new Map<string, Float64Array>();
        for (const request of plan.ducking) {
          const state = detector.get(request.id)!,
            envelope = allocate(count);
          const threshold = 10 ** (request.thresholdDb / 10),
            attenuation = 10 ** (-request.attenuationDb / 20);
          const attack = request.attack ? Math.exp(-TICKS_PER_AUDIO_SAMPLE / request.attack) : 0;
          const release = request.release ? Math.exp(-TICKS_PER_AUDIO_SAMPLE / request.release) : 0;
          for (let i = 0; i < count; i++) {
            let l = 0,
              r = 0;
            for (const id of request.sidechainTrackInstanceIds) {
              const bus = buses.get(id);
              if (bus) {
                l += bus[i * CHANNELS]!;
                r += bus[i * CHANNELS + 1]!;
              }
            }
            state.power =
              rmsCoefficient * state.power + ((1 - rmsCoefficient) * (l * l + r * r)) / 2;
            const target = state.power >= threshold ? attenuation : 1;
            const coefficient = target < state.gain ? attack : release;
            state.gain = target + coefficient * (state.gain - target);
            envelope[i] = state.gain;
          }
          envelopes.set(request.id, envelope);
        }
        const mix = new Float64Array(count * CHANNELS);
        for (const item of dry)
          for (let i = 0; i < count; i++) {
            let gain = 1;
            for (const id of item.lane.duckingIds) gain *= envelopes.get(id)![i]!;
            mix[i * CHANNELS] += item.samples[i * CHANNELS]! * gain;
            mix[i * CHANNELS + 1] += item.samples[i * CHANNELS + 1]! * gain;
          }
        const bytes = Buffer.allocUnsafe(count * BYTES);
        for (let i = 0; i < count; i++) {
          const peak = Math.max(Math.abs(mix[i * CHANNELS]!), Math.abs(mix[i * CHANNELS + 1]!));
          if (!Number.isFinite(peak) || peak > 3.4028234663852886e38)
            throw new Error(`Audio mix exceeds finite float PCM at sample ${start + i}`);
          result.peak = Math.max(result.peak, peak);
          if (peak > 1) result.samplesOverFullScale++;
          bytes.writeFloatLE(mix[i * CHANNELS]!, i * BYTES);
          bytes.writeFloatLE(mix[i * CHANNELS + 1]!, i * BYTES + 4);
        }
        writeAll(fd, bytes);
        await yieldTask();
        await progress(0.5 + (0.45 * end) / Math.max(1, plan.sampleCount), "mix-audio");
      }
    } finally {
      closeSync(fd);
    }
    await run(options.ffmpegPath, [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "f32le",
      "-ar",
      String(RATE),
      "-ac",
      "2",
      "-i",
      raw,
      "-c:a",
      "pcm_f32le",
      "-rf64",
      "auto",
      "-f",
      "wav",
      "-y",
      outputTemporary,
    ]);
    cancelled(signal);
    await rename(outputTemporary, options.outputPath);
    await progress(1, "audio-ready");
    return result;
  } finally {
    store.dispose();
    await rm(outputTemporary, { force: true });
    await rm(temporary, { recursive: true, force: true });
  }
}
