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
import { runMediaProcess } from "../process-runner.js";

export interface EditorExportOptions extends EditorFrameRendererOptions {
  /** Completed full-sequence stereo 48 kHz PCM mix, shared with preview. */
  audioFile: string;
  outputPath: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  onProgress?(progress: {
    phase: "prepare" | "render" | "verify";
    completedFrames: number;
    totalFrames: number;
  }): void | Promise<void>;
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
): Promise<{ path: string; frameCount: number; durationSeconds: number; probe: unknown }> {
  const document = validateEditorDocument(options.document);
  const profile = validateExportProfile(options.profile);
  const sequence = document.sequences.find((item) => item.id === options.sequenceId);
  if (!sequence) throw new Error("导出序列不存在");
  const duration = sequenceDuration(sequence);
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
    Math.abs(seconds - ticksToSeconds(duration)) > 1 / 48000 + 0.000001
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
        `apad,atrim=end_sample=${Math.ceil(durationSeconds * 48000)}`,
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
              yield await renderer!.render(frameToTicks(frame, profile.frameRate));
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
    verifyExportOutput(profile, probe, ticksToSeconds(duration));
    if (signal.aborted) throw new DOMException("视频导出已取消", "AbortError");
    await publishWithoutOverwrite(temporary, options.outputPath);
    return { path: options.outputPath, frameCount, durationSeconds, probe };
  } finally {
    await renderer?.close();
    await rm(temporary, { force: true });
  }
}
