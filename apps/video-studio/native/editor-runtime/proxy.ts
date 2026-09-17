import { stat, rename, rm } from "node:fs/promises";
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
}

/** Hash every decoded frame's time on the editor tick clock; do not replace VFR with a fixed rate. */
async function timeline(
  path: string,
  streamIndex: number,
  origin: number,
  context: ProxyContext,
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
    version: purpose === "preview" ? "editor-sdr-preview-v1" : "editor-sdr-proxy-v2-duration",
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
    if ((await fileHash(saved, context.signal)) === receipt.sha256)
      return { ...receipt, path: saved };
    throw new EditorTaskError("CACHE_CHANGED", "已准备视频内容发生变化，请清理该任务缓存后重试");
  }
  const original = await timeline(path, stream.index, sourceOriginSeconds, context);
  if (original.firstTick !== 0)
    throw new EditorTaskError(
      "UNSUPPORTED_TIMESTAMPS",
      "当前合成器尚不支持晚于素材起点出现的第一帧，请先整理画面起点",
    );
  const output = join(context.workDir, `proxy-${randomUUID()}.mp4`);
  const filter = `scale=${encodedWidth}:${encodedHeight}:flags=${purpose === "preview" ? "bilinear" : "lanczos"},setsar=1,colorspace=ispace=${inputMatrix}:iprimaries=${inputPrimaries}:itrc=${inputTransfer}:irange=${inputRange}:space=bt709:primaries=bt709:trc=bt709:range=tv:format=${purpose === "preview" ? "yuv420p" : "yuv444p"}:dither=fsb`;
  try {
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
          ? ["-crf", "23", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]
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
        output,
      ],
      { signal: context.signal },
    );
    const actual = await timeline(output, 0, 0, context);
    if (
      actual.hash !== original.hash ||
      actual.count !== original.count ||
      actual.endTick !== original.endTick
    )
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
    return result;
  } finally {
    await rm(output, { force: true });
  }
}
