import { validateFrameRate, type FrameRate } from "./time";

export interface ExportProfile {
  id: string;
  name: string;
  width: number;
  height: number;
  frameRate: FrameRate;
  container: "mp4" | "webm" | "mov";
  videoCodec: "h264" | "hevc" | "vp9" | "prores";
  audioCodec: "aac" | "opus" | "pcm";
  /** Quality is 0–100, with larger values retaining more detail. Bitrate is a target average. */
  quality: { mode: "quality"; value: number } | { mode: "bitrate"; bitsPerSecond: number };
  /** Stereo PCM is fixed at 48 kHz × 16 bits × 2 channels. */
  audioBitrate: number;
  sampleRate: 48000;
  includeCaptions: boolean;
}

const VIDEO_ENCODERS = {
  h264: "libx264",
  hevc: "libx265",
  vp9: "libvpx-vp9",
  prores: "prores_ks",
} as const;
const AUDIO_ENCODERS = { aac: "aac", opus: "libopus", pcm: "pcm_s16le" } as const;
const PROFILE_KEYS = [
  "id",
  "name",
  "width",
  "height",
  "frameRate",
  "container",
  "videoCodec",
  "audioCodec",
  "quality",
  "audioBitrate",
  "sampleRate",
  "includeCaptions",
];

function object(value: unknown, keys: readonly string[], label: string): Record<string, any> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error(`${label}格式无效或包含未知字段`);
  return value as Record<string, any>;
}
function integer(value: unknown, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max)
    throw new Error(`${label}必须是 ${min}–${max} 范围内的整数`);
  return Number(value);
}
function label(value: unknown, max: number, name: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new Error(`${name}无效`);
  return value;
}
function rate(value: unknown): FrameRate {
  const data = object(value, ["numerator", "denominator"], "导出帧率");
  return validateFrameRate(data);
}

/** Portable policy only: availability is a separate mandatory preflight against the actual runtime. */
export function validateExportProfile(value: unknown): ExportProfile {
  const data = object(value, PROFILE_KEYS, "导出配置");
  const id = label(data.id, 128, "导出配置 ID");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id)) throw new Error("导出配置 ID 无效");
  const name = label(data.name, 200, "导出配置名称");
  const width = integer(data.width, 16, 8192, "导出宽度");
  const height = integer(data.height, 16, 8192, "导出高度");
  if (width % 2 || height % 2) throw new Error("导出画面宽高必须是偶数");
  const frameRate = rate(data.frameRate);
  if (!["mp4", "mov", "webm"].includes(data.container)) throw new Error("不支持此导出容器");
  if (!Object.hasOwn(VIDEO_ENCODERS, data.videoCodec)) throw new Error("不支持此视频编码");
  if (!Object.hasOwn(AUDIO_ENCODERS, data.audioCodec)) throw new Error("不支持此音频编码");
  const container = data.container as ExportProfile["container"];
  const videoCodec = data.videoCodec as ExportProfile["videoCodec"];
  const audioCodec = data.audioCodec as ExportProfile["audioCodec"];
  const compatible =
    container === "webm"
      ? videoCodec === "vp9" && audioCodec === "opus"
      : container === "mp4"
        ? ["h264", "hevc"].includes(videoCodec) && audioCodec === "aac"
        : (["h264", "hevc"].includes(videoCodec) && audioCodec === "aac") ||
          (videoCodec === "prores" && audioCodec === "pcm");
  if (!compatible) throw new Error("所选容器与音视频编码不兼容");
  const rawQuality = object(data.quality, ["mode", "value", "bitsPerSecond"], "导出质量");
  let quality: ExportProfile["quality"];
  if (rawQuality.mode === "quality") {
    if (Object.hasOwn(rawQuality, "bitsPerSecond")) throw new Error("质量模式不能同时指定码率");
    quality = { mode: "quality", value: integer(rawQuality.value, 0, 100, "导出质量") };
  } else if (rawQuality.mode === "bitrate") {
    if (Object.hasOwn(rawQuality, "value")) throw new Error("码率模式不能同时指定质量");
    if (videoCodec === "prores")
      throw new Error("ProRes 请使用质量模式，编码器不支持此目标码率控制");
    quality = {
      mode: "bitrate",
      bitsPerSecond: integer(rawQuality.bitsPerSecond, 100000, 500000000, "视频目标码率"),
    };
  } else throw new Error("导出质量模式无效");
  const audioBitrate =
    audioCodec === "pcm"
      ? integer(data.audioBitrate, 1536000, 1536000, "PCM 音频码率")
      : integer(data.audioBitrate, 32000, audioCodec === "opus" ? 510000 : 512000, "音频目标码率");
  if (data.sampleRate !== 48000) throw new Error("导出音频采样率必须为 48000 Hz");
  if (typeof data.includeCaptions !== "boolean") throw new Error("请明确是否导出字幕");
  return {
    id,
    name,
    width,
    height,
    frameRate,
    container,
    videoCodec,
    audioCodec,
    quality,
    audioBitrate,
    sampleRate: 48000,
    includeCaptions: data.includeCaptions,
  };
}

export function createExportPresets(): ExportProfile[] {
  return [
    { id: "landscape-1080p", name: "横屏 1080p", width: 1920, height: 1080 },
    { id: "portrait-1080p", name: "竖屏 1080p", width: 1080, height: 1920 },
    { id: "landscape-4k", name: "横屏 4K", width: 3840, height: 2160 },
  ].map((preset) =>
    validateExportProfile({
      ...preset,
      frameRate: { numerator: 30, denominator: 1 },
      container: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      quality: { mode: "quality", value: 62 },
      audioBitrate: 192000,
      sampleRate: 48000,
      includeCaptions: true,
    }),
  );
}

export function requiredExportEncoders(profile: ExportProfile): string[] {
  const valid = validateExportProfile(profile);
  return [VIDEO_ENCODERS[valid.videoCodec], AUDIO_ENCODERS[valid.audioCodec]];
}

/** Run before creating a render task, with names obtained from that installation's `ffmpeg -encoders`. */
export function assertExportEncodersAvailable(
  profile: ExportProfile,
  available: Iterable<string>,
): void {
  const found = new Set(available);
  const missing = requiredExportEncoders(profile).filter((name) => !found.has(name));
  if (missing.length) throw new Error(`当前 FFmpeg 缺少导出编码器：${missing.join("、")}`);
}

/** Output arguments only; the native compiler owns input paths, stream maps, composition and duration. */
export function exportEncodingArguments(profile: ExportProfile): string[] {
  const p = validateExportProfile(profile);
  const args = [
    "-c:v",
    VIDEO_ENCODERS[p.videoCodec],
    "-pix_fmt",
    p.videoCodec === "prores" ? "yuv422p10le" : "yuv420p",
    "-s:v",
    `${p.width}x${p.height}`,
    "-r",
    `${p.frameRate.numerator}/${p.frameRate.denominator}`,
    "-fps_mode",
    "cfr",
  ];
  if (p.videoCodec === "h264" || p.videoCodec === "hevc") args.push("-preset", "medium");
  if (p.videoCodec === "hevc") args.push("-tag:v", "hvc1");
  if (p.videoCodec === "vp9") args.push("-deadline", "good", "-cpu-used", "2", "-row-mt", "1");
  if (p.videoCodec === "prores") args.push("-profile:v", "3");
  if (p.quality.mode === "bitrate") args.push("-b:v", String(p.quality.bitsPerSecond));
  else if (p.videoCodec === "prores")
    args.push("-qscale:v", String(31 - Math.round((p.quality.value * 30) / 100)));
  else {
    const maximum = p.videoCodec === "vp9" ? 63 : 51;
    args.push("-crf", String(maximum - Math.round((p.quality.value * maximum) / 100)));
    if (p.videoCodec === "vp9") args.push("-b:v", "0");
  }
  args.push("-c:a", AUDIO_ENCODERS[p.audioCodec], "-ar", "48000", "-ac", "2");
  if (p.audioCodec !== "pcm") args.push("-b:a", String(p.audioBitrate));
  if (p.container !== "webm") args.push("-movflags", "+faststart");
  args.push("-f", p.container);
  return args;
}

function probeRate(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d+(?:\/\d+)?$/.test(value)) return undefined;
  const [num, den = "1"] = value.split("/");
  const number = Number(num) / Number(den);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}
function probeSeconds(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/** Validate parsed `ffprobe -show_streams -show_format -of json` before publishing a successful result. */
export function verifyExportOutput(
  profile: ExportProfile,
  probe: unknown,
  expectedDurationSeconds: number,
): void {
  const p = validateExportProfile(profile);
  if (
    !Number.isFinite(expectedDurationSeconds) ||
    expectedDurationSeconds <= 0 ||
    expectedDurationSeconds > 86400
  )
    throw new Error("预期成片时长无效");
  if (!probe || typeof probe !== "object" || !Array.isArray((probe as any).streams))
    throw new Error("导出文件缺少有效的音视频检测结果");
  const value = probe as { streams: Record<string, any>[]; format?: Record<string, any> };
  if (
    value.streams.some((stream) => !stream || typeof stream !== "object" || Array.isArray(stream))
  )
    throw new Error("导出文件的媒体流信息无效");
  const videos = value.streams.filter(
    (stream) => stream.codec_type === "video" && !stream.disposition?.attached_pic,
  );
  const audios = value.streams.filter((stream) => stream.codec_type === "audio");
  if (videos.length !== 1 || audios.length !== 1)
    throw new Error("导出文件必须包含一个画面流和一个混音流");
  const video = videos[0]!,
    audio = audios[0]!;
  if (
    video.codec_name !== p.videoCodec ||
    audio.codec_name !== (p.audioCodec === "pcm" ? "pcm_s16le" : p.audioCodec)
  )
    throw new Error("导出文件的实际音视频编码与所选配置不一致");
  if (video.width !== p.width || video.height !== p.height)
    throw new Error("导出文件的实际画面尺寸与所选配置不一致");
  if (Number(audio.sample_rate) !== p.sampleRate || audio.channels !== 2)
    throw new Error("导出文件的音频采样率或声道数量不正确");
  const expectedRate = p.frameRate.numerator / p.frameRate.denominator;
  const actualRate = probeRate(video.avg_frame_rate) ?? probeRate(video.r_frame_rate);
  if (actualRate === undefined || Math.abs(actualRate - expectedRate) > 0.000001)
    throw new Error("导出文件的实际帧率与所选配置不一致");
  const durations = [probeSeconds(video.duration), probeSeconds(value.format?.duration)].filter(
    (v): v is number => v !== undefined,
  );
  if (!durations.length) throw new Error("导出文件缺少可核验的时长");
  const tolerance = 1 / expectedRate + 0.000001;
  if (durations.some((seconds) => Math.abs(seconds - expectedDurationSeconds) > tolerance))
    throw new Error("导出文件时长与时间线不一致，差异超过一帧");
  const formats =
    typeof value.format?.format_name === "string" ? value.format.format_name.split(",") : [];
  if (!formats.includes(p.container)) throw new Error("导出文件的实际容器与所选配置不一致");
}
