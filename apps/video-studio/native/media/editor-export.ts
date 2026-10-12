import { constants } from "node:fs";
import { copyFile, link, mkdir, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { EditorFrameRenderer, type EditorFrameRendererOptions } from "./editor-frame-renderer.js";
import {
  assertExportEncodersAvailable,
  exportEncodingArguments,
  validateExportProfile,
  verifyExportOutput,
} from "../../src/editor/export-settings.js";
import { validateEditorDocument, sequenceDuration } from "../../src/editor/validation.js";
import { frameToTicks, ticksToFrame, ticksToSeconds } from "../../src/editor/time.js";
import { sameExportRange, validateExportRange, type ExportRange } from "../../src/editor/export-range.js";
import { validateAudioMixReport, type EditorAudioMixReport } from "../../src/editor/audio-mix-report.js";
import { runMediaProcess } from "../process-runner.js";

export interface EditorExportOptions extends EditorFrameRendererOptions {
  /** Completed stereo 48 kHz PCM mix. Without audioRange this is the full preview mix. */
  audioFile: string;
  audioRange?: ExportRange;
  range?: ExportRange;
  outputPath: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  onProgress?(progress: {
    phase: "prepare" | "render" | "verify";
    completedFrames: number;
    totalFrames: number;
  }): void | Promise<void>;
}

/** Select original 48 kHz samples in the half-open tick interval; never restart mixing or ducking. */
export function exportRangeAudioFilter(value: ExportRange): string {
  const range = validateExportRange(value);
  return `atrim=start_sample=${Math.ceil(range.start / 5)}:end_sample=${Math.ceil((range.start + range.duration) / 5)},asetpts=PTS-STARTPTS`;
}

/** Stream the same pre-encoding PCM selection used by the muxer, with bounded memory. */
export async function measureEditorExportAudioRange(options: {
  audioFile: string;
  range: ExportRange;
  ffmpegPath: string;
  signal: AbortSignal;
}): Promise<EditorAudioMixReport> {
  const range = validateExportRange(options.range),
    expected = Math.ceil((range.start + range.duration) / 5) - Math.ceil(range.start / 5);
  let sampleCount = 0, peak = 0, samplesOverFullScale = 0, pending = Buffer.alloc(0);
  await runMediaProcess(options.ffmpegPath, [
    "-nostdin", "-v", "error", "-i", options.audioFile,
    "-map", "0:a:0", "-af", exportRangeAudioFilter(range),
    "-ac", "2", "-ar", "48000", "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1",
  ], {
    signal: options.signal,
    onStdout(chunk) {
      const bytes = pending.length ? Buffer.concat([pending, chunk]) : chunk,
        complete = bytes.length - bytes.length % 8;
      for (let index = 0; index < complete; index += 8) {
        const level = Math.max(Math.abs(bytes.readFloatLE(index)), Math.abs(bytes.readFloatLE(index + 4)));
        if (!Number.isFinite(level) || ++sampleCount > expected)
          throw new Error("导出范围混音数据无效");
        peak = Math.max(peak, level);
        if (level > 1) samplesOverFullScale++;
      }
      pending = Buffer.from(bytes.subarray(complete));
    },
  });
  if (pending.length || sampleCount !== expected) throw new Error("导出范围混音数据不完整");
  return validateAudioMixReport({ sampleCount, peak, samplesOverFullScale });
}

async function publishWithoutOverwrite(source: string, destination: string) {
  try {
    await link(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await copyFile(source, destination, constants.COPYFILE_EXCL);
  }
  await rm(source);
}

/** Produce and verify a real video using the same browser frame renderer as preview. */
export async function exportEditorSequence(
  options: EditorExportOptions,
): Promise<{ path: string; frameCount: number; durationSeconds: number; probe: unknown; range?: ExportRange }> {
  const document = validateEditorDocument(options.document);
  const profile = validateExportProfile(options.profile);
  const sequence = document.sequences.find((item) => item.id === options.sequenceId);
  if (!sequence) throw new Error("导出序列不存在");
  const fullDuration = sequenceDuration(sequence),
    range = options.range === undefined ? undefined : validateExportRange(options.range, fullDuration),
    duration = range?.duration ?? fullDuration;
  const audioRange = options.audioRange === undefined ? undefined : validateExportRange(options.audioRange, fullDuration);
  if (audioRange && !sameExportRange(range, audioRange))
    throw new Error("音频混音范围与导出范围不一致");
  const audioDurationSeconds = audioRange
    ? (Math.ceil((audioRange.start + audioRange.duration) / 5) - Math.ceil(audioRange.start / 5)) / 48000
    : ticksToSeconds(fullDuration);
  const frameCount = ticksToFrame(duration, profile.frameRate, "ceil");
  if (!frameCount) throw new Error("空序列无法导出");
  const durationSeconds =
    (frameCount * profile.frameRate.denominator) / profile.frameRate.numerator;
  const outputRelation = relative(options.workDir, options.outputPath);
  if (
    !isAbsolute(options.workDir) ||
    !isAbsolute(options.outputPath) ||
    !outputRelation ||
    outputRelation === ".." ||
    outputRelation.startsWith(`..${sep}`) ||
    isAbsolute(outputRelation)
  )
    throw new Error("导出文件必须位于当前任务工作目录中");
  if (!isAbsolute(options.audioFile) || !(await stat(options.audioFile)).isFile())
    throw new Error("导出缺少完整的音频混音文件");
  const ffmpeg = options.ffmpegPath ?? "ffmpeg",
    ffprobe = options.ffprobePath ?? "ffprobe";
  const signal = options.signal;
  await options.onProgress?.({ phase: "prepare", completedFrames: 0, totalFrames: frameCount });
  const encoders = await runMediaProcess(ffmpeg, ["-hide_banner", "-encoders"], { signal });
  const names = encoders.stdout
    .toString("utf8")
    .split("\n")
    .flatMap((line) => /^\s*[VAS][A-Z.]{5}\s+(\S+)/.exec(line)?.[1] ?? []);
  assertExportEncodersAvailable(profile, names);
  const audioResult = await runMediaProcess(
    ffprobe,
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", options.audioFile],
    { signal },
  );
  const audioProbe = JSON.parse(audioResult.stdout.toString("utf8"));
  const tracks = audioProbe.streams;
  const seconds = Number(tracks?.[0]?.duration ?? audioProbe.format?.duration);
  if (
    !Array.isArray(tracks) ||
    tracks.length !== 1 ||
    tracks[0].codec_type !== "audio" ||
    !["pcm_s16le", "pcm_f32le"].includes(tracks[0].codec_name) ||
    Number(tracks[0].sample_rate) !== 48000 ||
    tracks[0].channels !== 2 ||
    !Number.isFinite(seconds) ||
    Math.abs(seconds - audioDurationSeconds) > 1 / 48000 + 0.000001
  )
    throw new Error("音频混音的格式或时长与序列不一致");
  await mkdir(dirname(options.outputPath), { recursive: true });
  const temporary = join(
    dirname(options.outputPath),
    `.render-${randomUUID()}.${profile.container}`,
  );
  let renderer: EditorFrameRenderer | undefined;
  try {
    renderer = await EditorFrameRenderer.create({ ...options, document, profile });
    await runMediaProcess(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-n",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "-framerate",
        `${profile.frameRate.numerator}/${profile.frameRate.denominator}`,
        "-i",
        "pipe:0",
        "-i",
        options.audioFile,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-vf",
        // Lock conversion before the output size/pixel-format stage. Older FFmpeg
        // can otherwise negotiate RGB here and insert a later default BT.601 conversion.
        `scale=out_color_matrix=bt709:out_range=limited,format=${profile.videoCodec === "prores" ? "yuv422p10le" : "yuv420p"},setparams=colorspace=bt709:range=limited`,
        "-af",
        `${range && !audioRange ? `${exportRangeAudioFilter(range)},` : ""}apad,atrim=end_sample=${Math.ceil(durationSeconds * 48000)}`,
        ...exportEncodingArguments(profile),
        "-color_primaries",
        "bt709",
        "-color_trc",
        "iec61966-2-1",
        "-colorspace",
        "bt709",
        "-color_range",
        "tv",
        // The producer writes exactly frameCount images and closes stdin; the
        // audio filter also has a finite sample count. Do not use -frames:v:
        // FFmpeg 5 can stop the entire mux before draining the audio input.
        temporary,
      ],
      {
        signal,
        input: async function* (inputSignal) {
          const stop = () => {
            void renderer?.close();
          };
          inputSignal.addEventListener("abort", stop, { once: true });
          try {
            for (let frame = 0; frame < frameCount; frame++) {
              if (inputSignal.aborted) throw new DOMException("视频编码已取消", "AbortError");
              yield await renderer!.render((range?.start ?? 0) + frameToTicks(frame, profile.frameRate));
              await options.onProgress?.({
                phase: "render",
                completedFrames: frame + 1,
                totalFrames: frameCount,
              });
            }
          } finally {
            inputSignal.removeEventListener("abort", stop);
          }
        },
      },
    );
    await renderer.close();
    await options.onProgress?.({
      phase: "verify",
      completedFrames: frameCount,
      totalFrames: frameCount,
    });
    const result = await runMediaProcess(
      ffprobe,
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", temporary],
      { signal },
    );
    const probe = JSON.parse(result.stdout.toString("utf8"));
    // A sub-frame range still owns one complete output frame. Container timestamp
    // rounding must be compared with that encoded length, not the original few ticks.
    verifyExportOutput(profile, probe, range ? durationSeconds : ticksToSeconds(duration));
    if (signal.aborted) throw new DOMException("视频导出已取消", "AbortError");
    await publishWithoutOverwrite(temporary, options.outputPath);
    return { path: options.outputPath, frameCount, durationSeconds, probe, ...(range ? { range } : {}) };
  } finally {
    await renderer?.close();
    await rm(temporary, { force: true });
  }
}
