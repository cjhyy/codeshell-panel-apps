import { stat } from "node:fs/promises";
import type { EditorSourceInspection } from "../../src/editor/import-media.js";
import { MAX_EDITOR_TICK } from "../../src/editor/validation.js";
import { runMediaProcess } from "../process-runner.js";
import { EditorTaskError } from "./protocol.js";
import { describeEditorVideo } from "./proxy.js";
import { readPrefix, fileHash } from "./files.js";
import { dirname, basename } from "node:path";

const inputOptions = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  "mov,matroska,webm,avi,mp3,wav,aiff,flac,ogg,aac,mpeg,mpegts,png_pipe,jpeg_pipe,webp_pipe,bmp_pipe,tiff_pipe,gif,apng,j2k_pipe",
];
interface Rational {
  n: bigint;
  d: bigint;
}
function rational(n: bigint, d = 1n): Rational {
  if (d === 0n) throw new Error("无效时间基准");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  let a = n < 0n ? -n : n,
    b = d;
  while (b) {
    const r = a % b;
    a = b;
    b = r;
  }
  return { n: n / (a || 1n), d: d / (a || 1n) };
}
const add = (a: Rational, b: Rational) => rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rational, b: Rational) => add(a, rational(-b.n, b.d));
const compare = (a: Rational, b: Rational) => a.n * b.d - b.n * a.d;
const publicRational = (v: Rational) => ({ numerator: String(v.n), denominator: String(v.d) });
function ratio(value: unknown): Rational | undefined {
  if (typeof value !== "string" || !/^[-+]?\d+[/:]\d+$/.test(value)) return;
  const [n, d] = value.split(/[/:]/).map(BigInt);
  if (!d) return;
  return rational(n!, d);
}
function decimal(value: unknown): Rational | undefined {
  if (typeof value !== "string" || !/^[-+]?\d+(?:\.\d+)?$/.test(value)) return;
  const whole = value.split(".");
  return rational(BigInt(whole.join("")), 10n ** BigInt(whole[1]?.length ?? 0));
}
function whole(value: unknown): bigint | undefined {
  if (typeof value === "number" && !Number.isSafeInteger(value)) return;
  if (!/^[-+]?\d+$/.test(String(value))) return;
  return BigInt(String(value));
}
const time = (pts: unknown, base: Rational): Rational | undefined => {
  const n = whole(pts);
  return n === undefined ? undefined : rational(n * base.n, base.d);
};
const numeric = (r: Rational) => Number(r.n) / Number(r.d);
const ticks = (r: Rational) => {
  const n = r.n * 240000n;
  return Number(n < 0n ? -((-n + r.d / 2n) / r.d) : (n + r.d / 2n) / r.d);
};
const frameRate = (value: unknown) => {
  const r = ratio(value);
  if (!r || r.n <= 0 || r.d <= 0 || r.n > 1000000000n || r.d > 1000000000n) return null;
  return { numerator: Number(r.n), denominator: Number(r.d) };
};
const field = (value: unknown) => (typeof value === "string" ? value.slice(0, 128) : "unknown");

/** Full decode scan uses integer stream PTS and sample counts; no 30fps quantization or guessed VFR duration. */
export async function inspectEditorSource(
  path: string,
  resourceId: string,
  ffprobePath: string,
  signal: AbortSignal,
): Promise<EditorSourceInspection> {
  const bytes = (await stat(path)).size;
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 20 * 1024 ** 3)
    throw new EditorTaskError("INVALID_MEDIA", "素材为空或超过 20GiB 限制");
  const sha256 = await fileHash(path, signal);
  if (resourceId.startsWith("asset-") && resourceId !== `asset-${sha256}`)
    throw new EditorTaskError("SOURCE_CHANGED", "素材内容与资源身份不一致");
  const probe = JSON.parse(
    (
      await runMediaProcess(
        ffprobePath,
        ["-v", "error", ...inputOptions, "-show_streams", "-show_format", "-of", "json", path],
        { signal, maxStdoutBytes: 512 * 1024 },
      )
    ).stdout.toString(),
  );
  if (!Array.isArray(probe.streams) || probe.streams.length > 64)
    throw new EditorTaskError("INVALID_MEDIA", "媒体轨道列表无效或超过 64 条限制");
  const video = probe.streams.find(
      (s: any) => s.codec_type === "video" && !s.disposition?.attached_pic,
    ),
    audio = probe.streams.find((s: any) => s.codec_type === "audio");
  if (!video && !audio) throw new EditorTaskError("INVALID_MEDIA", "素材没有可解析的画面或声音");
  const magic = await readPrefix(dirname(path), [basename(path)]),
    format = field(probe.format?.format_name);
  const imageMime = magic.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "image/png"
    : magic[0] === 255 && magic[1] === 216
      ? "image/jpeg"
      : magic.subarray(0, 3).toString() === "GIF"
        ? "image/gif"
        : magic.subarray(8, 12).toString() === "WEBP"
          ? "image/webp"
          : magic.subarray(4, 12).toString().includes("ftypavif")
            ? "image/avif"
            : magic.subarray(0, 2).toString() === "BM"
              ? "image/bmp"
              : magic.subarray(0, 4).equals(Buffer.from([73, 73, 42, 0])) ||
                  magic.subarray(0, 4).equals(Buffer.from([77, 77, 0, 42]))
                ? "image/tiff"
                : undefined;
  const kind = imageMime && video ? "image" : video ? "video" : "audio";
  const selected = [video, audio].filter(Boolean);
  const bases = new Map<number, Rational>();
  for (const stream of selected) {
    const base = ratio(stream.time_base);
    if (!base || base.n <= 0n)
      throw new EditorTaskError("INVALID_MEDIA", "媒体缺少有效的有理时间基准");
    bases.set(stream.index, base);
  }
  const starts = selected
    .map((s) => time(s.start_pts, bases.get(s.index)!))
    .filter((v): v is Rational => Boolean(v));
  let origin = starts.length
    ? starts.reduce((a, b) => (compare(a, b) < 0 ? a : b))
    : (decimal(probe.format?.start_time) ?? rational(0n));
  if (kind === "image") origin = rational(0n);
  const streams = new Map<
    number,
    {
      count: number;
      first?: Rational;
      end?: Rational;
      last?: Rational;
      step?: Rational;
      variable: boolean;
      invalid: boolean;
      samples: bigint;
    }
  >();
  for (const s of selected)
    streams.set(s.index, { count: 0, variable: false, invalid: false, samples: 0n });
  let pending = "";
  const consume = (chunk: Buffer) => {
    const lines = (pending + chunk.toString()).split(/\r?\n/);
    pending = lines.pop()!;
    if (pending.length > 8192) throw new EditorTaskError("INVALID_MEDIA", "媒体帧记录超出限制");
    for (const line of lines) {
      const f = Object.fromEntries(line.split("|").map((part) => part.split("=")));
      const index = Number(f.stream_index),
        state = streams.get(index),
        base = bases.get(index);
      if (!state || !base) continue;
      state.count++;
      if (state.count > 10000000)
        throw new EditorTaskError("LIMIT_EXCEEDED", "素材解码帧数超过当前分析限制");
      const pts = time(f.best_effort_timestamp ?? f.pts, base);
      if (!pts) {
        state.invalid = true;
        continue;
      }
      let duration: Rational | undefined;
      if (audio?.index === index) {
        const samples = whole(f.nb_samples);
        if (
          samples === undefined ||
          samples <= 0n ||
          !Number.isSafeInteger(Number(audio.sample_rate)) ||
          Number(audio.sample_rate) < 1
        ) {
          state.invalid = true;
          continue;
        }
        state.samples += samples;
        duration = rational(samples, BigInt(audio.sample_rate));
      } else duration = time(f.duration ?? f.pkt_duration, base);
      if (!duration || duration.n <= 0n) {
        state.invalid = true;
        continue;
      }
      if (!state.first) state.first = pts;
      if (state.last) {
        const step = sub(pts, state.last);
        if (step.n <= 0n) state.invalid = true;
        else if (state.step && compare(step, state.step) !== 0n) state.variable = true;
        state.step = step;
      }
      state.last = pts;
      const end = add(pts, duration);
      if (!state.end || compare(end, state.end) > 0n) state.end = end;
    }
  };
  await runMediaProcess(
    ffprobePath,
    [
      "-v",
      "error",
      ...inputOptions,
      ...(kind === "image" ? ["-read_intervals", "%+#1"] : []),
      "-show_frames",
      "-show_entries",
      "frame=stream_index,pts,best_effort_timestamp,duration,pkt_duration,nb_samples",
      "-of",
      "compact=p=0:nk=0",
      path,
    ],
    { signal, onStdout: consume },
  );
  consume(Buffer.from("\n"));
  if ((video && !streams.get(video.index)?.count) || (audio && !streams.get(audio.index)?.count))
    throw new EditorTaskError("INVALID_MEDIA", "素材没有能够实际解码的画面或声音");
  const limitations: Array<{ code: string; message: string }> = [];
  let duration = rational(0n),
    trimmedAudioPadding = rational(0n);
  for (const stream of selected) {
    const state = streams.get(stream.index)!;
    if (kind === "image") continue;
    let end = state.end;
    if (state.invalid || !end) {
      const declared = time(stream.duration_ts, bases.get(stream.index)!);
      if (!declared) throw new EditorTaskError("INVALID_MEDIA", "素材缺少准确时长，无法加入工程");
      end = add(time(stream.start_pts, bases.get(stream.index)!) ?? origin, declared);
      limitations.push({
        code: "UNSUPPORTED_TIMESTAMPS",
        message: "素材包含无法准确定位的帧时间，需先修复时间戳后预览或导出",
      });
    }
    // Container sample duration removes encoder padding beyond the playable audio endpoint.
    // MP3 gapless decodes can already be shorter than their declared packet span; keep that shorter span.
    const declared = time(stream.duration_ts, bases.get(stream.index)!);
    if (stream === audio && declared && declared.n > 0n) {
      const declaredEnd = add(time(stream.start_pts, bases.get(stream.index)!) ?? origin, declared);
      if (compare(declaredEnd, end) < 0n) {
        trimmedAudioPadding = sub(end, declaredEnd);
        end = declaredEnd;
      }
    }
    const span = sub(end, origin);
    if (compare(span, duration) > 0n) duration = span;
  }
  const durationTick = kind === "image" ? 0 : ticks(duration);
  if (
    !Number.isSafeInteger(durationTick) ||
    (kind !== "image" && durationTick < 1) ||
    durationTick > MAX_EDITOR_TICK
  )
    throw new EditorTaskError("LIMIT_EXCEEDED", "素材时长无效或超过当前 24 小时限制");
  let width: number | undefined, height: number | undefined;
  let videoInfo: EditorSourceInspection["inspection"]["video"];
  if (video) {
    const sar = ratio(video.sample_aspect_ratio) ?? rational(1n),
      rotation = Number(
        video.side_data_list?.find((s: any) => Number.isFinite(s.rotation))?.rotation ??
          video.tags?.rotate ??
          0,
      );
    if (
      !Number.isSafeInteger(video.width) ||
      !Number.isSafeInteger(video.height) ||
      video.width < 1 ||
      video.height < 1
    )
      throw new EditorTaskError("INVALID_MEDIA", "素材画面尺寸无效");
    const displayWidth = Math.round(video.width * numeric(sar)),
      rotated = Math.abs(Math.round(rotation / 90)) % 2 === 1;
    width = rotated ? video.height : displayWidth;
    height = rotated ? displayWidth : video.height;
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width! < 1 ||
      height! < 1 ||
      width! > 8192 ||
      height! > 8192
    )
      throw new EditorTaskError("LIMIT_EXCEEDED", "素材显示尺寸超过当前 8192 像素限制");
    const state = streams.get(video.index)!;
    videoInfo = {
      streamIndex: video.index,
      codec: field(video.codec_name),
      pixelFormat: field(video.pix_fmt),
      codedWidth: video.width,
      codedHeight: video.height,
      displayWidth: width!,
      displayHeight: height!,
      sampleAspectRatio: publicRational(sar),
      rotation,
      frameRate: frameRate(video.r_frame_rate),
      averageFrameRate: frameRate(video.avg_frame_rate),
      timeBase: publicRational(bases.get(video.index)!),
      frameCount: state.count,
      variableFrameRate: state.variable,
      firstFrame: state.first ? publicRational(sub(state.first, origin)) : null,
      color: {
        space: field(video.color_space),
        primaries: field(video.color_primaries),
        transfer: field(video.color_transfer),
        range: field(video.color_range),
        sourceBitDepth:
          Number(video.bits_per_raw_sample) ||
          Number(/p(\d+)(?:le|be)$/.exec(String(video.pix_fmt))?.[1]) ||
          8,
      },
    };
    if (kind === "video") {
      try {
        const policy = describeEditorVideo(video);
        videoInfo.conversionAssumptions = policy.assumptions;
      } catch (error) {
        if (!(error instanceof EditorTaskError)) throw error;
        limitations.push({ code: error.code, message: error.message });
      }
      if (state.first && ticks(sub(state.first, origin)) !== 0)
        limitations.push({
          code: "UNSUPPORTED_TIMESTAMPS",
          message: "第一帧晚于素材起点，当前合成器需要先整理画面起点",
        });
    } else if (
      !["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"].includes(imageMime!)
    )
      limitations.push({
        code: "UNSUPPORTED_IMAGE",
        message: "图片已入库；当前合成器需要先转换为 PNG 或 JPEG",
      });
  }
  const audioInfo = audio
    ? {
        streamIndex: audio.index,
        codec: field(audio.codec_name),
        sampleRate: Number(audio.sample_rate) || 0,
        channels: Number(audio.channels) || 0,
        timeBase: publicRational(bases.get(audio.index)!),
        decodedSamples: String(streams.get(audio.index)!.samples),
        trimmedEncoderPadding: publicRational(trimmedAudioPadding),
      }
    : undefined;
  const mimeType =
    imageMime ??
    (kind === "video"
      ? format.includes("matroska")
        ? "video/x-matroska"
        : format.includes("avi")
          ? "video/x-msvideo"
          : format.includes("mpegts")
            ? "video/mp2t"
            : format === "mpeg"
              ? "video/mpeg"
              : String(probe.format?.tags?.major_brand).trim() === "qt"
                ? "video/quicktime"
                : "video/mp4"
      : format.includes("mp3")
        ? "audio/mpeg"
        : format.includes("wav")
          ? "audio/wav"
          : format.includes("aiff")
            ? "audio/aiff"
            : format.includes("flac")
              ? "audio/flac"
              : format.includes("ogg")
                ? "audio/ogg"
                : format.includes("aac")
                  ? "audio/aac"
                  : "audio/mp4");
  return {
    resourceId,
    sha256,
    bytes,
    kind,
    duration: durationTick,
    ...(width === undefined ? {} : { width, height }),
    mimeType,
    inspection: {
      schemaVersion: 1,
      format,
      timing: {
        origin: publicRational(origin),
        duration: publicRational(duration),
        tickRounding: "nearest",
        basis:
          kind === "image"
            ? "static-image"
            : trimmedAudioPadding.n
              ? "decoded-frames-and-stream-duration"
              : "decoded-frames",
      },
      ...(videoInfo ? { video: videoInfo } : {}),
      ...(audioInfo ? { audio: audioInfo } : {}),
      compatibility: {
        preview: limitations.length
          ? "unsupported"
          : kind === "video"
            ? "native-proxy"
            : kind === "audio"
              ? "prepared-audio"
              : "static-image",
        export: limitations.length ? "unsupported" : "supported",
        limitations,
      },
    },
  };
}
