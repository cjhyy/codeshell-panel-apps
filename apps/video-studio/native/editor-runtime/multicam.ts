import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { runMediaProcess } from "../process-runner.js";
import { editorSourcePcmCacheKey } from "../media/editor-audio-renderer.js";
import { correlateAudioFeatures } from "../../src/editor/audio-correlation.js";
import { abort, atomic, digest, fileHash, regular } from "./files.js";
import { EditorTaskError } from "./protocol.js";
const safety = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  "mov,matroska,webm,avi,mp3,wav,aiff,flac,ogg,aac",
];
const RATE = 48000,
  BIN = 240;
export interface MulticamNativeSource {
  resourceId: string;
  path: string;
  duration: number;
}
export interface MulticamNativeOptions {
  sources: MulticamNativeSource[];
  referenceResourceId: string;
  windowSeconds: number;
  maxOffsetSeconds: number;
  cacheDir: string;
  pcmCacheDir: string;
  ffmpegPath: string;
  ffprobePath: string;
  signal: AbortSignal;
}
export interface MulticamNativeResult {
  referenceResourceId: string;
  reused: boolean;
  results: Array<{
    resourceId: string;
    sourceHash: string;
    offset: number;
    confidence: number;
    secondPeak: number;
    overlapSeconds: number;
    precisionTicks: 1200;
    reliable: boolean;
    reason?: string;
  }>;
}
class Features {
  values: number[] = [];
  private tail = Buffer.alloc(0);
  private count = 0;
  private squares = 0;
  private total = 0;
  constructor(private readonly maxSamples: number) {}
  push(bytes: Buffer) {
    const data = this.tail.length ? Buffer.concat([this.tail, bytes]) : bytes,
      length = data.length - (data.length % 8);
    for (let at = 0; at < length; at += 8) {
      if (this.total++ >= this.maxSamples) break;
      const left = data.readFloatLE(at),
        right = data.readFloatLE(at + 4);
      if (
        !Number.isFinite(left) ||
        !Number.isFinite(right) ||
        Math.max(Math.abs(left), Math.abs(right)) > 1e6
      )
        throw new EditorTaskError("INVALID_AUDIO", "机位声音包含无效采样");
      this.squares += left * left + right * right;
      this.count++;
      if (this.count === BIN) {
        this.values.push(Math.log1p(1000 * Math.sqrt(this.squares / (2 * this.count))));
        this.squares = 0;
        this.count = 0;
      }
    }
    this.tail = Buffer.from(data.subarray(length));
  }
  finish() {
    if (this.tail.length) throw new EditorTaskError("INVALID_AUDIO", "机位声音采样不完整");
    return Float32Array.from(this.values);
  }
}
export async function alignEditorMulticam(
  options: MulticamNativeOptions,
): Promise<MulticamNativeResult> {
  const { signal } = options;
  abort(signal);
  if (
    options.sources.length < 2 ||
    options.sources.length > 32 ||
    !Number.isFinite(options.windowSeconds) ||
    options.windowSeconds < 3 ||
    options.windowSeconds > 180 ||
    !Number.isFinite(options.maxOffsetSeconds) ||
    options.maxOffsetSeconds < 0 ||
    options.maxOffsetSeconds > 60 ||
    options.maxOffsetSeconds >= options.windowSeconds - 2
  )
    throw new EditorTaskError(
      "INVALID_REQUEST",
      "对齐分析需要 3 至 180 秒，最大偏移小于分析时长减 2 秒",
    );
  if (
    new Set(options.sources.map((source) => source.resourceId)).size !== options.sources.length ||
    !options.sources.some((source) => source.resourceId === options.referenceResourceId)
  )
    throw new EditorTaskError("INVALID_REQUEST", "对齐机位列表或基准机位无效");
  const version = (
    await runMediaProcess(options.ffmpegPath, ["-hide_banner", "-version"], {
      signal,
      maxStdoutBytes: 65536,
    })
  ).stdout.toString();
  const decoded: Array<{
    source: MulticamNativeSource;
    sourceHash: string;
    features: Float32Array;
    reused: boolean;
  }> = [];
  for (const source of options.sources) {
    abort(signal);
    const sourceHash = await fileHash(source.path, signal),
      key = digest({
        algorithm: "stereo-log-energy-5ms-v1",
        sourceHash,
        windowSeconds: options.windowSeconds,
        decoder: version,
      }),
      path = join(options.cacheDir, `${key}.json`);
    try {
      const cached = await regular(options.cacheDir, [`${key}.json`]);
      if ((await stat(cached)).size > 1024 * 1024) throw new Error("机位缓存超过范围");
      const value = JSON.parse(await readFile(cached, "utf8"));
      if (
        value.sourceHash !== sourceHash ||
        !Array.isArray(value.features) ||
        value.features.length < 400 ||
        value.features.length > 36000 ||
        !value.features.every(
          (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 30,
        )
      )
        throw new Error("机位声音缓存无效");
      decoded.push({
        source,
        sourceHash,
        features: Float32Array.from(value.features),
        reused: true,
      });
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const accumulator = new Features(Math.floor(options.windowSeconds * RATE));
    const pcmKey = editorSourcePcmCacheKey(sourceHash, source.duration, version);
    let usedPcm = false;
    try {
      const pcm = await regular(options.pcmCacheDir, [`${pcmKey}.f32`]),
        info = await stat(pcm);
      if (info.size % 8 !== 0 || info.size < RATE * 2 * 8)
        throw new Error("声音缓存不完整或不足两秒");
      const stream = createReadStream(pcm, {
        start: 0,
        end: Math.min(info.size, options.windowSeconds * RATE * 8) - 1,
      });
      const cancel = () => stream.destroy(new DOMException("Cancelled", "AbortError"));
      signal.addEventListener("abort", cancel, { once: true });
      try {
        for await (const bytes of stream) {
          abort(signal);
          accumulator.push(bytes as Buffer);
        }
        usedPcm = true;
      } finally {
        signal.removeEventListener("abort", cancel);
        stream.destroy();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!usedPcm) {
      const probe = JSON.parse(
        (
          await runMediaProcess(
            options.ffprobePath,
            [
              "-v",
              "error",
              ...safety,
              "-show_entries",
              "stream=codec_type",
              "-of",
              "json",
              source.path,
            ],
            { signal, maxStdoutBytes: 1024 * 1024 },
          )
        ).stdout.toString(),
      );
      if (!probe.streams?.some((stream: any) => stream.codec_type === "audio"))
        throw new EditorTaskError("NO_AUDIO", "所选机位没有可用于同步的声音，请手动设置偏移");
      await runMediaProcess(
        options.ffmpegPath,
        [
          "-v",
          "error",
          "-nostdin",
          ...safety,
          "-copyts",
          "-start_at_zero",
          "-i",
          source.path,
          "-map",
          "0:a:0",
          "-vn",
          "-af",
          "aresample=48000:async=1:first_pts=0",
          "-ac",
          "2",
          "-t",
          String(options.windowSeconds),
          "-c:a",
          "pcm_f32le",
          "-f",
          "f32le",
          "pipe:1",
        ],
        { signal, maxStdoutBytes: 0, onStdout: (bytes) => accumulator.push(bytes) },
      );
    }
    const features = accumulator.finish();
    if (features.length < 400)
      throw new EditorTaskError("SHORT_AUDIO", "机位共同声音至少需要 2 秒");
    abort(signal);
    if ((await fileHash(source.path, signal)) !== sourceHash)
      throw new EditorTaskError("SOURCE_CHANGED", "机位素材在声音分析期间发生变化");
    await atomic(path, Buffer.from(JSON.stringify({ sourceHash, features: Array.from(features) })));
    decoded.push({ source, sourceHash, features, reused: false });
  }
  const reference = decoded.find((item) => item.source.resourceId === options.referenceResourceId)!;
  const results = decoded.map((item) => {
    abort(signal);
    const referenceOnly = item === reference,
      result = referenceOnly
        ? { lag: 0, confidence: 1, secondPeak: 0, overlap: item.features.length, reliable: true }
        : correlateAudioFeatures(
            reference.features,
            item.features,
            Math.round(options.maxOffsetSeconds * 200),
          );
    return {
      resourceId: item.source.resourceId,
      sourceHash: item.sourceHash,
      offset: result.lag * 1200,
      confidence: result.confidence,
      secondPeak: result.secondPeak,
      overlapSeconds: result.overlap / 200,
      precisionTicks: 1200 as const,
      reliable: result.reliable,
      ...(result.reason ? { reason: result.reason } : {}),
    };
  });
  return {
    referenceResourceId: options.referenceResourceId,
    reused: decoded.every((item) => item.reused),
    results,
  };
}
