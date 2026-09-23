import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_FILE_BYTES = 20 * 1024 ** 3;
const MIME = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".opus": "audio/ogg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".srt": "application/x-subrip",
  ".vtt": "text/vtt",
  ".ass": "text/plain",
};
const FORMATS = new Set(["best", "2160", "1440", "1080", "720", "480", "360", "audio"]);
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
function fail(message, code = "INVALID_REQUEST", retryable = false) {
  throw Object.assign(new Error(message), { code, retryable });
}

export function parseDownloadRequest(value) {
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) => !["action", "url", "configuration", "jobId", "scopeKey"].includes(key),
    ) ||
    value.action !== "download"
  )
    fail("下载任务参数无效。");
  if (
    typeof value.url !== "string" ||
    value.url.length > 4096 ||
    /[\u0000-\u0020\u007f]/u.test(value.url)
  )
    fail("请输入完整的视频网址。");
  let url;
  try {
    url = new URL(value.url);
  } catch {
    fail("请输入完整的视频网址。");
  }
  if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password)
    fail("下载任务只接受不含账号密码的 HTTP 或 HTTPS 视频网址。");
  const config = value.configuration ?? {};
  if (
    !object(config) ||
    Object.keys(config).some(
      (key) =>
        ![
          "format",
          "playlist",
          "playlistItems",
          "playlistEnd",
          "subtitles",
          "subtitleMode",
          "subtitleLanguagePreset",
          "subtitleLanguages",
          "embedSubtitles",
        ].includes(key),
    )
  )
    fail("下载配置包含未知字段。");
  const format = config.format ?? "best";
  if (!FORMATS.has(format)) fail("请选择支持的下载质量。");
  for (const key of ["playlist", "subtitles", "embedSubtitles"])
    if (config[key] !== undefined && typeof config[key] !== "boolean") fail("下载开关参数无效。");
  if (
    config.playlistItems !== undefined &&
    (typeof config.playlistItems !== "string" ||
      config.playlistItems.length > 120 ||
      (config.playlistItems && !/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(config.playlistItems)))
  )
    fail("播放列表范围无效。");
  if (
    config.playlistEnd !== undefined &&
    (!Number.isSafeInteger(config.playlistEnd) ||
      config.playlistEnd < 0 ||
      config.playlistEnd > 500)
  )
    fail("播放列表结束位置必须在 0–500 之间。");
  const subtitleMode = config.subtitleMode ?? "manual";
  if (!["manual", "auto", "both"].includes(subtitleMode)) fail("字幕来源无效。");
  const subtitleLanguages = config.subtitleLanguages ?? "zh.*,en.*";
  if (
    typeof subtitleLanguages !== "string" ||
    !subtitleLanguages ||
    subtitleLanguages.length > 120 ||
    !/^[a-zA-Z0-9.*,_-]+$/.test(subtitleLanguages)
  )
    fail("字幕语言表达式无效。");
  return {
    action: "download",
    url: url.href,
    configuration: {
      format,
      playlist: config.playlist === true,
      playlistItems: config.playlistItems || "",
      playlistEnd: config.playlistEnd || 0,
      subtitles: config.subtitles === true,
      subtitleMode,
      subtitleLanguages,
      embedSubtitles: config.embedSubtitles === true,
    },
  };
}

export function downloadArguments(request, ffmpegAvailable) {
  const { url, configuration: c } = parseDownloadRequest(request);
  if (c.format === "audio" && !ffmpegAvailable)
    fail("音频下载需要先安装 FFmpeg。", "DEPENDENCY_MISSING", true);
  const args = [
    "--ignore-config",
    "--continue",
    "--no-overwrites",
    "--newline",
    "--progress",
    "--no-simulate",
    "--restrict-filenames",
    "--trim-filenames",
    "180",
    "--socket-timeout",
    "30",
    "--retries",
    "3",
    "--fragment-retries",
    "3",
    "--progress-template",
    "download:progress:%(progress._percent_str)s",
    "--print",
    "before_dl:meta:%(title)s",
    "--output",
    "%(title).100B_%(id).80B.%(ext)s",
  ];
  if (c.format === "audio")
    args.push("--extract-audio", "--audio-format", "mp3", "--audio-quality", "0");
  else if (/^\d+$/.test(c.format)) {
    args.push("--format", ffmpegAvailable ? "bv*+ba/b" : "b", "--format-sort", `res:${c.format}`);
    if (ffmpegAvailable) args.push("--merge-output-format", "mp4");
  } else
    args.push(
      "--format",
      ffmpegAvailable ? "bestvideo*+bestaudio/best" : "best[ext=mp4]/best",
      ...(ffmpegAvailable ? ["--merge-output-format", "mp4"] : []),
    );
  if (c.playlist) {
    args.push("--yes-playlist");
    if (c.playlistItems) args.push("--playlist-items", c.playlistItems);
    else if (c.playlistEnd) args.push("--playlist-end", String(c.playlistEnd));
  } else args.push("--no-playlist");
  if (c.subtitles && c.format !== "audio") {
    if (["manual", "both"].includes(c.subtitleMode)) args.push("--write-subs");
    if (["auto", "both"].includes(c.subtitleMode)) args.push("--write-auto-subs");
    args.push("--sub-format", "vtt", "--sub-langs", c.subtitleLanguages);
    if (ffmpegAvailable) {
      args.push("--convert-subs", "srt");
      if (c.embedSubtitles) args.push("--embed-subs");
    }
  }
  // No raw argv, executable, configuration file, output path or postprocessor
  // command comes from browser JSON. The reviewed tool owns all options.
  return [...args, "--", url];
}

async function realDirectory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(path)) !== path)
    fail("任务目录已变化。", "DIRECTORY_CHANGED");
}

export async function collectDownloadArtifacts(jobDir, signal) {
  const directory = join(jobDir, "media");
  await realDirectory(jobDir);
  await realDirectory(directory);
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length > 512) fail("下载产生的文件过多，请缩小播放列表范围。", "OUTPUT_LIMIT");
  const artifacts = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    signal?.throwIfAborted();
    if (entry.isSymbolicLink() || entry.isDirectory())
      fail("下载结果包含非普通文件。", "UNSAFE_OUTPUT");
    const mimeType = MIME[extname(entry.name).toLowerCase()];
    if (!mimeType) continue;
    if (artifacts.length >= 128) fail("结果超过 128 个文件，请缩小播放列表范围。", "OUTPUT_LIMIT");
    const path = join(directory, entry.name);
    const handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > MAX_FILE_BYTES)
        fail("下载结果为空、过大或不是独立普通文件。", "UNSAFE_OUTPUT");
      const hash = createHash("sha256");
      const bytes = Buffer.allocUnsafe(1024 * 1024);
      let offset = 0;
      for (;;) {
        signal?.throwIfAborted();
        const part = await handle.read(bytes, 0, bytes.length, offset);
        if (!part.bytesRead) break;
        offset += part.bytesRead;
        if (offset > MAX_FILE_BYTES) fail("下载结果超过资源大小限制。", "OUTPUT_LIMIT");
        hash.update(bytes.subarray(0, part.bytesRead));
      }
      const after = await handle.stat(),
        current = await lstat(path);
      if (
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        offset !== after.size ||
        current.isSymbolicLink() ||
        current.ino !== before.ino ||
        current.dev !== before.dev
      )
        fail("下载结果在校验时发生变化。", "OUTPUT_CHANGED");
      const sha256 = hash.digest("hex");
      artifacts.push({
        file: `media/${entry.name}`,
        name: entry.name,
        bytes: offset,
        sha256,
        assetId: `asset-${sha256}`,
        mimeType,
      });
    } finally {
      await handle.close();
    }
  }
  if (!artifacts.some((item) => /^(video|audio)\//.test(item.mimeType)))
    fail("下载没有产生可用的音视频文件。", "NO_MEDIA", true);
  return artifacts;
}

function probeFfmpeg(spawnProcess, signal) {
  return new Promise((resolveProbe) => {
    if (signal.aborted) return resolveProbe(false);
    const child = spawnProcess("ffmpeg", ["-version"], { stdio: "ignore", shell: false });
    const stop = () => child.kill("SIGKILL");
    const timer = setTimeout(stop, 5000);
    signal.addEventListener("abort", stop, { once: true });
    const done = (available) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      resolveProbe(available);
    };
    child.once("error", () => done(false));
    child.once("close", (code) => done(code === 0));
  });
}

export async function runDownload(
  raw,
  { jobDir, signal = new AbortController().signal, progress = () => {}, spawnProcess = spawn } = {},
) {
  const request = parseDownloadRequest(raw);
  if (typeof jobDir !== "string" || !isAbsolute(jobDir)) fail("缺少 Host 任务目录。");
  jobDir = resolve(jobDir);
  await realDirectory(jobDir);
  signal.throwIfAborted();
  const directory = join(jobDir, "media");
  await mkdir(directory, { mode: 0o700 }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  await realDirectory(directory);
  const ffmpeg = await probeFfmpeg(spawnProcess, signal);
  signal.throwIfAborted();
  const args = downloadArguments(request, ffmpeg);
  progress({ stage: "download", message: "正在下载到项目任务目录。", fraction: 0 });
  await new Promise((resolveDownload, reject) => {
    const child = spawnProcess("yt-dlp", args, {
      cwd: directory,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const pending = { stdout: "", stderr: "" };
    let stderrBytes = 0,
      failure,
      killTimer;
    let lastProgress = 0;
    const stop = () => {
      child.kill("SIGTERM");
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), 3000);
    };
    const consume = (text, stream) => {
      pending[stream] += text;
      if (Buffer.byteLength(pending[stream]) > 64 * 1024) {
        failure ??= Object.assign(new Error("下载程序输出超出限制。"), {
          code: "OUTPUT_LIMIT",
          retryable: false,
        });
        stop();
        return;
      }
      while (pending[stream].includes("\n")) {
        const end = pending[stream].indexOf("\n"),
          line = pending[stream].slice(0, end).trim();
        pending[stream] = pending[stream].slice(end + 1);
        const match = /^progress:\s*(\d+(?:\.\d+)?)%$/.exec(line);
        if (match && Date.now() - lastProgress >= 750) {
          lastProgress = Date.now();
          progress({
            stage: "download",
            fraction: Math.min(0.99, Number(match[1]) / 100),
            message: "正在下载。",
          });
        }
      }
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (text) => consume(text, "stdout"));
    // Upstream diagnostics can contain signed URLs or cookies. Do not persist
    // raw stderr in task events; bound it and expose only reviewed error text.
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text) => {
      stderrBytes += Buffer.byteLength(text);
      consume(text, "stderr");
      if (stderrBytes > 8 * 1024 * 1024) {
        failure ??= Object.assign(new Error("下载程序错误输出超出限制。"), {
          code: "OUTPUT_LIMIT",
          retryable: false,
        });
        stop();
      }
    });
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    child.once("error", (error) => {
      failure = Object.assign(
        new Error(error.code === "ENOENT" ? "请先安装 yt-dlp。" : "无法启动下载程序。"),
        { code: "DEPENDENCY_MISSING", retryable: true },
      );
    });
    child.once("close", (code) => {
      clearTimeout(killTimer);
      signal.removeEventListener("abort", stop);
      if (signal.aborted) reject(signal.reason ?? new Error("下载已取消。"));
      else if (failure) reject(failure);
      else if (code !== 0)
        reject(
          Object.assign(new Error("下载未完成，请检查视频可用性、网络或账号授权后重试。"), {
            code: "DOWNLOAD_FAILED",
            retryable: true,
          }),
        );
      else resolveDownload();
    });
  });
  signal.throwIfAborted();
  progress({ stage: "verify", message: "正在校验输出文件。" });
  const artifacts = await collectDownloadArtifacts(jobDir, signal);
  progress({ stage: "complete", fraction: 1, message: `已完成 ${artifacts.length} 个文件。` });
  return { kind: "video-download", artifacts };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--job-dir") fail("下载入口需要 Host 提供任务目录。");
  const parts = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) fail("下载任务参数过大。");
    parts.push(chunk);
  }
  let raw;
  try {
    raw = JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    fail("下载任务参数不是有效 JSON。");
  }
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("下载已取消。"));
  process.once("SIGTERM", cancel);
  process.once("SIGINT", cancel);
  const timer = setTimeout(cancel, 6 * 60 * 60 * 1000);
  try {
    const result = await runDownload(raw, {
      jobDir: args[1],
      signal: controller.signal,
      progress: (value) =>
        process.stdout.write(JSON.stringify({ type: "progress", progress: value }) + "\n"),
    });
    process.stdout.write(JSON.stringify({ type: "result", result }) + "\n");
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGTERM", cancel);
    process.removeListener("SIGINT", cancel);
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stdout.write(
      JSON.stringify({
        type: "error",
        code: error.code ?? "DOWNLOAD_FAILED",
        message: error.message,
        retryable: error.retryable === true,
      }) + "\n",
    );
    process.exitCode = 1;
  });
}
