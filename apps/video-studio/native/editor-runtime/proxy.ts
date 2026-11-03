import { readFile, stat, rename, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { runMediaProcess } from "../process-runner.js";
import { atomic, digest, directory, fileHash, json, optionalJson, regular } from "./files.js";
import { EditorTaskError } from "./protocol.js";

const safety = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  "mov,matroska,webm,avi,mpeg,mpegts,ogg",
];
const known = (value: unknown) =>
  typeof value === "string" && !["unknown", "unspecified", "reserved"].includes(value)
    ? value
    : undefined;
function ratio(value: unknown): number {
  if (typeof value !== "string" || !/^\d+[:/]\d+$/.test(value)) return 1;
  const [a, b] = value.split(/[:/]/).map(Number);
  return a! > 0 && b! > 0 ? a! / b! : 1;
}
export interface EditorProxy {
  path: string;
  mimeType: "video/mp4";
  sha256: string;
  recipeHash: string;
  sourceHash: string;
  width: number;
  height: number;
  sourceOriginSeconds: number;
  frameCount: number;
  color: {
    space: "bt709";
    primaries: "bt709";
    transfer: "bt709";
    range: "tv";
    sourceBitDepth: number;
    assumptions: string[];
  };
}
export interface ProxyContext {
  ffmpegPath: string;
  ffprobePath: string;
  cacheDir: string;
  workDir: string;
  signal: AbortSignal;
  ffmpegVersion: string;
  /** Overall fraction of one source, from the first frame scan to the verified preview. */
  onProgress?(fraction: number): void;
}

/** Hash every decoded frame's time on the editor tick clock; do not replace VFR with a fixed rate. */
async function timeline(
  path: string,
  streamIndex: number,
  origin: number,
  context: ProxyContext,
  onFrame?: (count: number) => void,
): Promise<{ hash: string; count: number; firstTick: number; endTick: number }> {
  let pending = "",
    count = 0,
    previous = -1,
    firstTick = -1,
    endTick = -1;
  const hash = createHash("sha256");
  const consume = (chunk: Buffer) => {
    const lines = (pending + chunk.toString("utf8")).split(/\r?\n/);
    pending = lines.pop()!;
    if (pending.length > 4096) throw new EditorTaskError("INVALID_MEDIA", "视频帧时间数据无效");
    for (const line of lines) {
      const fields = Object.fromEntries(
        line
          .trim()
          .split("|")
          .map((field) => field.split("=")),
      );
      if (!fields.best_effort_timestamp_time) continue;
      const seconds = Number(fields.best_effort_timestamp_time),
        tick = Math.round((seconds - origin) * 240000);
      if (!Number.isFinite(seconds) || !Number.isSafeInteger(tick) || tick < 0 || tick <= previous)
        throw new EditorTaskError(
          "UNSUPPORTED_TIMESTAMPS",
          "源视频存在缺失或重复的画面时间戳，请先修复素材",
        );
      if (firstTick < 0) firstTick = tick;
      const duration = Number(fields.duration_time ?? fields.pkt_duration_time);
      if (!Number.isFinite(duration) || duration <= 0)
        throw new EditorTaskError(
          "UNSUPPORTED_TIMESTAMPS",
          "源视频缺少准确的画面持续时间，请先修复素材",
        );
      endTick = Math.round((seconds - origin + duration) * 240000);
      if (endTick > 86400 * 240000)
        throw new EditorTaskError("LIMIT_EXCEEDED", "兼容画面最多支持 24 小时视频");
      previous = tick;
      count++;
      hash.update(`${tick}\n`);
      onFrame?.(count);
    }
  };
  await runMediaProcess(
    context.ffprobePath,
    [
      "-v",
      "error",
      ...safety,
      "-select_streams",
      String(streamIndex),
      "-show_entries",
      "frame=best_effort_timestamp_time,duration_time,pkt_duration_time",
      "-of",
      "compact=p=0:nk=0",
      path,
    ],
    { signal: context.signal, onStdout: consume },
  );
  consume(Buffer.from("\n"));
  if (!count) throw new EditorTaskError("INVALID_MEDIA", "源视频没有可解码画面");
  return { hash: hash.digest("hex"), count, firstTick, endTick };
}

type Timeline = Awaited<ReturnType<typeof timeline>>;

/** The same frame clock read from demuxed packets, without decoding. Undefined whenever
 * packets cannot stand in for decoded pictures; callers then run the decoding scan,
 * which also owns every user-facing timestamp error. */
async function packetTimeline(
  path: string,
  streamIndex: number,
  origin: number,
  context: ProxyContext,
  onPacket?: (count: number) => void,
): Promise<(Timeline & { ticks: number[] }) | undefined> {
  let pending = "",
    usable = true,
    count = 0;
  const frames: Array<[tick: number, end: number]> = [];
  const consume = (chunk: Buffer) => {
    const lines = (pending + chunk.toString("utf8")).split(/\r?\n/);
    pending = lines.pop()!;
    if (pending.length > 4096) usable = false;
    for (const line of lines) {
      if (!usable || !line.trim()) continue;
      const fields = Object.fromEntries(line.trim().split("|").map((field) => field.split("=")));
      const seconds = Number(fields.pts_time),
        duration = Number(fields.duration_time),
        tick = Math.round((seconds - origin) * 240000),
        end = Math.round((seconds - origin + duration) * 240000);
      // Discarded (edit list) or corrupt packets are not presented as decoded frames.
      if (/[DC]/.test(fields.flags ?? "") || !Number.isFinite(seconds) || !Number.isFinite(duration) ||
          duration <= 0 || !Number.isSafeInteger(tick) || tick < 0 || end > 86400 * 240000)
        usable = false;
      else frames.push([tick, end]);
      onPacket?.(++count);
    }
  };
  await runMediaProcess(
    context.ffprobePath,
    [
      "-v", "error", ...safety, "-select_streams", String(streamIndex),
      "-show_entries", "packet=pts_time,duration_time,flags", "-of", "compact=p=0:nk=0", path,
    ],
    { signal: context.signal, onStdout: consume },
  );
  consume(Buffer.from("\n"));
  if (!usable || !frames.length) return undefined;
  // Packets arrive in decode order; B-frames present in a different order.
  frames.sort((a, b) => a[0] - b[0]);
  const hash = createHash("sha256"),
    ticks: number[] = [];
  for (const [index, [tick]] of frames.entries()) {
    if (index && tick <= frames[index - 1]![0]) return undefined;
    hash.update(`${tick}\n`);
    ticks.push(tick);
  }
  if (frames[0]![0] !== 0) return undefined;
  return { hash: hash.digest("hex"), count: frames.length, firstTick: 0, endTick: frames.at(-1)![1], ticks };
}

const encoderStatistics = new Map<string, Promise<boolean>>();
/** FFmpeg 6.0 added encoder input statistics; 5.x rejects the options as unknown. */
function supportsEncoderStatistics(context: ProxyContext): Promise<boolean> {
  const key = `${context.ffmpegPath}\0${context.ffmpegVersion}`;
  let known = encoderStatistics.get(key);
  if (!known) {
    known = runMediaProcess(context.ffmpegPath, ["-hide_banner", "-h", "long"], { signal: context.signal })
      .then(({ stdout }) => {
        const help = stdout.toString();
        return /^-stats_enc_pre\b/m.test(help) && /^-stats_enc_pre_fmt\b/m.test(help);
      })
      .catch(() => {
        // A cancelled probe says nothing about the binary; ask again next time.
        encoderStatistics.delete(key);
        return false;
      });
    encoderStatistics.set(key, known);
  }
  return known;
}

/** Presentation times the encoder actually received, on the 1/240000 encoder time base. */
async function encodedTicks(path: string): Promise<number[]> {
  const ticks: number[] = [];
  for (const line of (await readFile(path, "utf8")).split("\n")) {
    if (!line.trim()) continue;
    const tick = Number(line);
    if (!Number.isSafeInteger(tick)) return [];
    ticks.push(tick);
  }
  return ticks;
}
const sameTicks = (a: number[], b: number[]) =>
  a.length === b.length && a.every((tick, index) => tick === b[index]);

/** One shared compatibility policy for native inspection and actual source preparation. */
export function describeEditorVideo(stream: any) {
  const trc = known(stream.color_transfer),
    primaries = known(stream.color_primaries),
    matrix = known(stream.color_space),
    range = known(stream.color_range);
  if (
    ["smpte2084", "arib-std-b67"].includes(trc ?? "") ||
    ["bt2020", "smpte431", "smpte432"].includes(primaries ?? "") ||
    ["bt2020nc", "bt2020c"].includes(matrix ?? "")
  )
    throw new EditorTaskError(
      "UNSUPPORTED_HDR",
      "当前合成管线支持 SDR；HDR 或广色域素材需明确转换后导入",
    );
  if (/^(?:yuva|gbrap|rgba|bgra|argb|abgr|ya)/.test(String(stream.pix_fmt)))
    throw new EditorTaskError(
      "UNSUPPORTED_ALPHA_VIDEO",
      "当前视频中间格式不支持透明通道，请先保留透明度导出为图片序列",
    );
  const rotation = Number(
    stream.side_data_list?.find((item: any) => Number.isFinite(item.rotation))?.rotation ??
      stream.tags?.rotate ??
      0,
  );
  if (!Number.isFinite(rotation) || Math.abs(rotation / 90 - Math.round(rotation / 90)) > 0.00001)
    throw new EditorTaskError("UNSUPPORTED_ORIENTATION", "源视频方向元数据不是直角旋转");
  const sar = ratio(stream.sample_aspect_ratio),
    unrotatedWidth = Math.round(stream.width * sar),
    rotated = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const width = rotated ? stream.height : unrotatedWidth,
    height = rotated ? unrotatedWidth : stream.height;
  if (width < 1 || height < 1 || width > 8192 || height > 8192)
    throw new EditorTaskError("LIMIT_EXCEEDED", "源视频显示尺寸超过当前 8192 像素合成上限");
  const assumptions: string[] = [],
    sd = stream.height <= 576;
  const inputMatrix = matrix ?? (sd ? "smpte170m" : "bt709"),
    inputPrimaries = primaries ?? (sd ? "smpte170m" : "bt709"),
    inputTransfer = trc ?? "bt709",
    inputRange = range ?? "tv";
  if (!matrix) assumptions.push(`未标记色彩矩阵，使用${inputMatrix}`);
  if (!primaries) assumptions.push(`未标记色彩原色，使用${inputPrimaries}`);
  if (!trc) assumptions.push("未标记传递函数，使用bt709");
  if (!range) assumptions.push("未标记视频范围，使用limited");
  if (
    !["bt709", "bt470bg", "smpte170m", "smpte240m", "gbr"].includes(inputMatrix) ||
    !["bt709", "bt470bg", "bt470m", "smpte170m", "smpte240m"].includes(inputPrimaries) ||
    !["bt709", "iec61966-2-1", "gamma22", "gamma28", "smpte170m", "smpte240m"].includes(
      inputTransfer,
    ) ||
    !["pc", "tv"].includes(inputRange)
  )
    throw new EditorTaskError(
      "UNSUPPORTED_COLOR",
      "源素材色彩描述尚不支持，请先明确转换为 SDR Rec.709",
    );
  const sourceBitDepth =
    Number(stream.bits_per_raw_sample) ||
    Number(/p(\d+)(?:le|be)$/.exec(String(stream.pix_fmt))?.[1]) ||
    8;
  return {
    rotation,
    sar,
    width,
    height,
    assumptions,
    inputMatrix,
    inputPrimaries,
    inputTransfer,
    inputRange,
    sourceBitDepth,
  };
}

/** Export uses a lossless full-size intermediate; interactive playback uses a smaller fast preview. */
export async function prepareEditorProxy(
  path: string,
  sourceHash: string,
  context: ProxyContext,
  purpose: "export" | "preview" = "export",
): Promise<EditorProxy> {
  const probe = JSON.parse(
    (
      await runMediaProcess(
        context.ffprobePath,
        ["-v", "error", ...safety, "-show_streams", "-show_format", "-of", "json", path],
        { signal: context.signal },
      )
    ).stdout.toString(),
  );
  const stream = probe.streams?.find(
    (item: any) => item.codec_type === "video" && !item.disposition?.attached_pic,
  );
  if (
    !stream ||
    !Number.isInteger(stream.index) ||
    !Number.isInteger(stream.width) ||
    !Number.isInteger(stream.height)
  )
    throw new EditorTaskError("INVALID_MEDIA", "视频素材没有有效画面流");
  const {
    rotation,
    sar,
    width,
    height,
    assumptions,
    inputMatrix,
    inputPrimaries,
    inputTransfer,
    inputRange,
    sourceBitDepth,
  } = describeEditorVideo(stream);
  if (Number(probe.format?.duration) > 86400)
    throw new EditorTaskError("LIMIT_EXCEEDED", "兼容画面最多支持 24 小时视频");
  const sourceOriginSeconds = Number(probe.format?.start_time ?? 0);
  if (!Number.isFinite(sourceOriginSeconds))
    throw new EditorTaskError("INVALID_MEDIA", "源视频起始时间无效");
  const previewScale = Math.min(1, 1920 / width, 1080 / height);
  const encodedWidth =
    purpose === "preview" ? Math.max(2, Math.round((width * previewScale) / 2) * 2) : width;
  const encodedHeight =
    purpose === "preview" ? Math.max(2, Math.round((height * previewScale) / 2) * 2) : height;
  const recipeHash = digest({
    version: purpose === "preview" ? "editor-sdr-preview-v2-gop30" : "editor-sdr-proxy-v2-duration",
    sourceHash,
    ffmpeg: context.ffmpegVersion,
    stream: stream.index,
    width,
    height,
    ...(purpose === "preview" ? { encodedWidth, encodedHeight } : {}),
    rotation,
    sar,
    inputMatrix,
    inputPrimaries,
    inputTransfer,
    inputRange,
    sourceOriginSeconds,
  });
  const cache = await directory(context.cacheDir, ["video", recipeHash]);
  const receipt = await optionalJson(cache, ["receipt.json"]);
  if (receipt?.recipeHash === recipeHash && receipt.sourceHash === sourceHash) {
    const saved = await regular(cache, ["video.mp4"]);
    if ((await fileHash(saved, context.signal)) === receipt.sha256) {
      context.onProgress?.(1);
      return { ...receipt, path: saved };
    }
    throw new EditorTaskError("CACHE_CHANGED", "已准备视频内容发生变化，请清理该任务缓存后重试");
  }
  let reported = -1;
  const report = (fraction: number) => {
    if (fraction >= 1 || fraction - reported >= 0.01) {
      reported = fraction;
      context.onProgress?.(fraction);
    }
  };
  // Phase starts are always visible, even after a fast scan ends just below the 1% step.
  const begin = (fraction: number) => {
    if (fraction > reported) {
      reported = fraction;
      context.onProgress?.(fraction);
    }
  };
  const durationSeconds = Number(stream.duration) || Number(probe.format?.duration) || 0,
    [rateNumerator, rateDenominator] = String(stream.avg_frame_rate || stream.r_frame_rate)
      .split("/")
      .map(Number),
    expectedFrames =
      Number(stream.nb_frames) ||
      Math.round((durationSeconds * rateNumerator!) / (rateDenominator || 1)) ||
      0;
  const scanned = (start: number, span: number) => (count: number) => {
    if (expectedFrames > 0) report(start + span * Math.min(1, count / expectedFrames));
  };
  // Decoding the whole source only to read its frame clock dominated 4K preparation.
  // Packets give the same clock when the encoder later receives exactly those frames;
  // without encoder statistics there is nothing to confirm that against.
  const packets = (await supportsEncoderStatistics(context))
    ? await packetTimeline(path, stream.index, sourceOriginSeconds, context, scanned(0, 0.05))
    : undefined;
  const scan = async (start: number, span: number) => {
    const decoded = await timeline(path, stream.index, sourceOriginSeconds, context, scanned(start, span));
    if (decoded.firstTick !== 0)
      throw new EditorTaskError(
        "UNSUPPORTED_TIMESTAMPS",
        "当前合成器尚不支持晚于素材起点出现的第一帧，请先整理画面起点",
      );
    return decoded;
  };
  // An unusable packet clock keeps the previous order: reject bad timing before encoding.
  let original: Timeline = packets ?? (await scan(0.05, 0.55));
  const encodeStart = packets ? 0.05 : 0.6,
    encodeEnd = packets ? 0.95 : 0.85;
  const output = join(context.workDir, `proxy-${randomUUID()}.mp4`),
    encoderInput = join(context.workDir, `proxy-${randomUUID()}.frames`);
  const filter = `scale=${encodedWidth}:${encodedHeight}:flags=${purpose === "preview" ? "bilinear" : "lanczos"},setsar=1,colorspace=ispace=${inputMatrix}:iprimaries=${inputPrimaries}:itrc=${inputTransfer}:irange=${inputRange}:space=bt709:primaries=bt709:trc=bt709:range=tv:format=${purpose === "preview" ? "yuv420p" : "yuv444p"}:dither=fsb`;
  try {
    begin(encodeStart);
    await runMediaProcess(
      context.ffmpegPath,
      [
        "-nostdin",
        "-v",
        "error",
        ...safety,
        "-copyts",
        "-start_at_zero",
        "-i",
        path,
        "-map",
        `0:${stream.index}`,
        "-an",
        "-sn",
        "-dn",
        "-vf",
        filter,
        "-fps_mode",
        "passthrough",
        "-enc_time_base",
        "1:240000",
        "-c:v",
        purpose === "preview" ? "libx264" : "libvpx-vp9",
        ...(purpose === "preview"
          ? // The player seeks every frame, and Chromium decodes from the preceding keyframe.
            ["-crf", "23", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", "30"]
          : [
              "-lossless", "1", "-pix_fmt", "yuv444p", "-deadline", "good",
              "-cpu-used", "4", "-row-mt", "1",
            ]),
        "-color_primaries",
        "bt709",
        "-color_trc",
        "bt709",
        "-colorspace",
        "bt709",
        "-color_range",
        "tv",
        "-video_track_timescale",
        "240000",
        "-movflags",
        "+faststart",
        "-y",
        "-nostats",
        "-progress",
        "pipe:1",
        ...(packets ? ["-stats_enc_pre", encoderInput, "-stats_enc_pre_fmt", "{pts}"] : []),
        output,
      ],
      {
        signal: context.signal,
        durationSeconds,
        onStdout: () => {},
        onProgress: ({ fraction }) => report(encodeStart + (encodeEnd - encodeStart) * (fraction ?? 0)),
      },
    );
    begin(encodeEnd);
    // Demuxed packets stand in for decoded frames only when the decoder produced exactly them.
    if (packets && !sameTicks(packets.ticks, await encodedTicks(encoderInput)))
      original = await scan(encodeEnd, (1 - encodeEnd) / 2);
    const verifyStart = Math.max(encodeEnd, reported),
      verify = scanned(verifyStart, 0.999 - verifyStart);
    const matches = (value: Timeline) =>
      value.hash === original.hash && value.count === original.count && value.endTick === original.endTick;
    let actual: Timeline | undefined = await packetTimeline(output, 0, 0, context, verify);
    // Only decoded proxy frames can prove a mismatch.
    if (!actual || !matches(actual)) actual = await timeline(output, 0, 0, context, verify);
    if (!matches(actual))
      throw new EditorTaskError(
        "PROXY_TIMING_MISMATCH",
        "兼容视频的帧时间与原素材不一致，已停止输出",
      );
    const saved = join(cache, "video.mp4");
    await rename(output, saved);
    const result: EditorProxy = {
      path: saved,
      mimeType: "video/mp4",
      sha256: await fileHash(saved, context.signal),
      recipeHash,
      sourceHash,
      width,
      height,
      sourceOriginSeconds,
      frameCount: actual.count,
      color: {
        space: "bt709",
        primaries: "bt709",
        transfer: "bt709",
        range: "tv",
        sourceBitDepth,
        assumptions,
      },
    };
    const { path: _path, ...publicReceipt } = result;
    await atomic(join(cache, "receipt.json"), Buffer.from(JSON.stringify(publicReceipt)));
    report(1);
    return result;
  } finally {
    await rm(output, { force: true });
    await rm(encoderInput, { force: true });
  }
}
