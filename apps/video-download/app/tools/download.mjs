import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, rm } from "node:fs/promises";
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
      (key) => !["action", "url", "configuration", "copySuffix", "jobId", "scopeKey"].includes(key),
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
  if (
    value.copySuffix !== undefined &&
    (typeof value.copySuffix !== "string" || !/^(?:[a-f0-9]{8})?$/.test(value.copySuffix))
  )
    fail("副本标识无效。");
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
    config.playlistEnd != null &&
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
    copySuffix: value.copySuffix || "",
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
  const { url, configuration: c, copySuffix } = parseDownloadRequest(request);
  const variant = createHash("sha256").update(JSON.stringify(c)).digest("hex").slice(0, 8);
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
    `%(title).80B_%(id).60B_${c.format}-${variant}${copySuffix ? "_copy-" + copySuffix : ""}.%(ext)s`,
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

/** Deliver verified task outputs to a Host-granted directory without overwriting files.
 * Directory paths arrive only through trusted argv, never through browser JSON.
 * Each file publishes atomically; a later failure leaves earlier verified files
 * intact so an explicit retry can verify and reuse them. */
export async function publishDownloadArtifacts(jobDir, outputDir, artifacts, signal) {
  if (typeof outputDir !== "string" || !isAbsolute(outputDir)) fail("缺少已授权的保存目录。");
  await realDirectory(outputDir);
  const root = await open(
    outputDir,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
  );
  const identity = await root.stat();
  const ioRoot = process.platform === "linux" ? `/proc/self/fd/${root.fd}` : outputDir;
  const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
  const verify = async () => {
    signal?.throwIfAborted();
    const current = await lstat(outputDir);
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      !same(current, identity) ||
      (await realpath(outputDir)) !== outputDir
    )
      fail("保存目录已变化，请重新选择。", "DIRECTORY_CHANGED");
  };
  const digest = async (handle, bytes) => {
    const hash = createHash("sha256"),
      buffer = Buffer.allocUnsafe(1024 * 1024);
    for (let offset = 0; offset < bytes;) {
      await verify();
      const part = await handle.read(buffer, 0, Math.min(buffer.length, bytes - offset), offset);
      if (!part.bytesRead) fail("输出文件在校验时变化。", "OUTPUT_CHANGED");
      offset += part.bytesRead;
      hash.update(buffer.subarray(0, part.bytesRead));
    }
    return hash.digest("hex");
  };
  const existingMatches = async (path, artifact) => {
    let handle;
    try {
      const named = await lstat(path);
      if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1) return false;
      handle = await open(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
      );
      const before = await handle.stat();
      if (!same(before, named) || before.size !== artifact.bytes || before.nlink !== 1)
        return false;
      const sha256 = await digest(handle, artifact.bytes);
      const after = await handle.stat(),
        current = await lstat(path);
      return (
        same(before, current) &&
        after.size === before.size &&
        after.mtimeMs === before.mtimeMs &&
        after.ctimeMs === before.ctimeMs &&
        after.nlink === 1 &&
        sha256 === artifact.sha256
      );
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    } finally {
      await handle?.close();
    }
  };
  const published = [];
  try {
    await verify();
    for (const artifact of artifacts) {
      const name = artifact.name;
      if (
        typeof name !== "string" ||
        !name ||
        name.length > 240 ||
        /[\\/\u0000-\u001f\u007f:]/.test(name) ||
        /[. ]$/.test(name) ||
        /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name) ||
        artifact.file !== `media/${name}` ||
        !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
        !Number.isSafeInteger(artifact.bytes) ||
        artifact.bytes < 1 ||
        artifact.bytes > MAX_FILE_BYTES
      )
        fail("保存文件清单无效。", "UNSAFE_OUTPUT");
      const target = join(ioRoot, name);
      await verify();
      if (await existingMatches(target, artifact)) {
        published.push({ ...artifact, published: { path: name, reused: true } });
        continue;
      }
      const temporary = join(ioRoot, `.codeshell-download-${randomUUID()}.tmp`);
      let source, destination, temporaryIdentity;
      try {
        source = await open(
          join(jobDir, artifact.file),
          constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
        );
        const before = await source.stat();
        if (!before.isFile() || before.nlink !== 1 || before.size !== artifact.bytes)
          fail("下载源文件已变化。", "OUTPUT_CHANGED");
        await verify();
        destination = await open(
          temporary,
          constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
          0o600,
        );
        temporaryIdentity = await destination.stat();
        const hash = createHash("sha256"),
          buffer = Buffer.allocUnsafe(1024 * 1024);
        for (let offset = 0; offset < artifact.bytes;) {
          await verify();
          const part = await source.read(
            buffer,
            0,
            Math.min(buffer.length, artifact.bytes - offset),
            offset,
          );
          if (!part.bytesRead) fail("下载源文件已截断。", "OUTPUT_CHANGED");
          hash.update(buffer.subarray(0, part.bytesRead));
          let written = 0;
          while (written < part.bytesRead) {
            const result = await destination.write(
              buffer,
              written,
              part.bytesRead - written,
              offset + written,
            );
            if (!result.bytesWritten) fail("无法继续保存文件。", "OUTPUT_FAILED", true);
            written += result.bytesWritten;
          }
          offset += part.bytesRead;
        }
        const after = await source.stat();
        if (
          after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs ||
          after.ctimeMs !== before.ctimeMs ||
          hash.digest("hex") !== artifact.sha256
        )
          fail("下载源文件在保存时变化。", "OUTPUT_CHANGED");
        await destination.sync();
        if ((await digest(destination, artifact.bytes)) !== artifact.sha256)
          fail("保存文件的校验失败。", "OUTPUT_CHANGED");
        await verify();
        let reused = false;
        try {
          await link(temporary, target);
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          if (!(await existingMatches(target, artifact)))
            fail("保存目录已有不同内容的同名文件，请选择下载副本。", "OUTPUT_CONFLICT");
          reused = true;
        }
        await verify();
        if (!reused) {
          const named = await lstat(target),
            final = await destination.stat();
          if (
            !named.isFile() ||
            named.isSymbolicLink() ||
            !same(named, temporaryIdentity) ||
            final.size !== artifact.bytes
          )
            fail("保存文件在发布时变化。", "OUTPUT_CHANGED");
        }
        published.push({ ...artifact, published: { path: name, reused } });
      } catch (error) {
        if (
          error.code?.startsWith("OUTPUT_") ||
          ["DIRECTORY_CHANGED", "UNSAFE_OUTPUT"].includes(error.code) ||
          signal?.aborted
        )
          throw error;
        fail("无法保存下载文件，请检查目录权限和剩余空间。", "OUTPUT_FAILED", true);
      } finally {
        await source?.close();
        await destination?.close();
        if (temporaryIdentity) {
          const current = await lstat(temporary).catch(() => null);
          if (current && same(current, temporaryIdentity)) await rm(temporary, { force: true });
        }
      }
    }
    return published;
  } finally {
    await root.close();
  }
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
  {
    jobDir,
    outputDir,
    signal = new AbortController().signal,
    progress = () => {},
    spawnProcess = spawn,
  } = {},
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
  let artifacts = await collectDownloadArtifacts(jobDir, signal);
  if (outputDir) {
    progress({ stage: "publish", message: "正在保存到已授权目录。" });
    artifacts = await publishDownloadArtifacts(jobDir, outputDir, artifacts, signal);
  }
  progress({ stage: "complete", fraction: 1, message: `已完成 ${artifacts.length} 个文件。` });
  return { kind: "video-download", artifacts };
}

async function main() {
  const args = process.argv.slice(2);
  if (![2, 4].includes(args.length)) fail("下载入口需要 Host 提供任务目录。");
  const directories = new Map();
  for (let index = 0; index < args.length; index += 2) {
    if (
      !["--job-dir", "--output-dir"].includes(args[index]) ||
      directories.has(args[index]) ||
      !isAbsolute(args[index + 1] || "")
    )
      fail("下载目录参数无效。");
    directories.set(args[index], args[index + 1]);
  }
  if (!directories.has("--job-dir")) fail("下载入口缺少任务目录。");
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
      jobDir: directories.get("--job-dir"),
      outputDir: directories.get("--output-dir"),
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
