import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseDownloadRequest, runDownload } from "./download.mjs";
import { searchExternalSources } from "./search.mjs";
import {
  cliError,
  cliJobId,
  checkedDirectory,
  createCliStore,
  getCliJob,
  listCliJobs,
  requestCliCancellation,
  TERMINAL_STATUSES,
  HEARTBEAT_TIMEOUT_MS,
} from "./cli-store.mjs";

const ENTRY = fileURLToPath(import.meta.url);
const INPUT_LIMIT = 32 * 1024;
const COMMANDS = [
  "help",
  "ops",
  "doctor",
  "inspect",
  "search",
  "download",
  "jobs",
  "status",
  "cancel",
  "retry",
  "check",
];
const plain = (value) => value && typeof value === "object" && !Array.isArray(value);
const fields = (value, allowed) => {
  if (!plain(value) || Object.keys(value).some((key) => !allowed.includes(key)))
    throw cliError("INVALID_ARGUMENT", "输入必须是仅含支持字段的 JSON 对象。");
};
const clean = (value, limit = 500) =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, limit) : "";

function argumentsFor(argv) {
  const [command = "help", ...rest] = argv;
  if (![...COMMANDS, "_worker"].includes(command))
    throw cliError("INVALID_ARGUMENT", "未知命令，请运行 help。");
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--background") {
      if (options.background) throw cliError("INVALID_ARGUMENT", "参数重复。");
      options.background = true;
      continue;
    }
    const name = flag?.slice(2),
      value = rest[++i];
    if (
      !flag?.startsWith("--") ||
      !["project", "input-file", "job", "bin-dir", "attempt", "token"].includes(name) ||
      Object.hasOwn(options, name) ||
      !value ||
      value.startsWith("--")
    )
      throw cliError("INVALID_ARGUMENT", `无效参数：${flag || ""}`);
    options[name] = value;
  }
  if (["help", "ops"].includes(command)) {
    if (Object.keys(options).length) throw cliError("INVALID_ARGUMENT", "help/ops 不接受参数。");
    return { command, options };
  }
  if (!options.project || !isAbsolute(options.project))
    throw cliError("INVALID_ARGUMENT", "必须显式提供 --project 完整项目目录。");
  const allowed = new Set(["project"]);
  if (["doctor", "inspect", "search", "download", "retry", "_worker"].includes(command))
    allowed.add("bin-dir");
  if (["inspect", "search", "download"].includes(command)) allowed.add("input-file");
  if (["status", "cancel", "retry", "check", "_worker"].includes(command)) allowed.add("job");
  if (["download", "retry"].includes(command)) allowed.add("background");
  if (command === "_worker") {
    allowed.add("attempt");
    allowed.add("token");
  }
  if (Object.keys(options).some((name) => !allowed.has(name)))
    throw cliError("INVALID_ARGUMENT", "此命令不支持提供的参数。");
  if (["inspect", "search", "download"].includes(command) && !options["input-file"])
    throw cliError("INVALID_ARGUMENT", "必须提供 --input-file JSON 文件。");
  if (["status", "cancel", "retry", "check", "_worker"].includes(command)) cliJobId(options.job);
  if (command === "_worker" && (!/^[1-9]\d{0,5}$/.test(options.attempt || "") || !options.token))
    throw cliError("INVALID_ARGUMENT", "内部 worker 参数无效。");
  return { command, options };
}

async function readInput(path, cwd) {
  const absolute = resolve(cwd, path);
  await checkedDirectory(dirname(absolute));
  const info = await lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > INPUT_LIMIT)
    throw cliError("INVALID_INPUT", "输入必须是不含链接、最多 32 KiB 的普通 JSON 文件。");
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat(),
      bytes = await handle.readFile();
    if (opened.ino !== info.ino || opened.dev !== info.dev || bytes.length > INPUT_LIMIT)
      throw cliError("INVALID_INPUT", "输入文件发生变化或过大。");
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw cliError("INVALID_INPUT", "输入文件不是有效 JSON。");
    }
  } finally {
    await handle.close();
  }
}

// PATH remains authoritative. Hosts with custom data directories must append
// their actual managed bin to PATH, or the caller explicitly supplies --bin-dir.
export async function findCliExecutable(name, { env = process.env, binDirectory } = {}) {
  const directories = (env.PATH || "").split(delimiter).filter((path) => path && isAbsolute(path));
  if (binDirectory) directories.push(await checkedDirectory(binDirectory));
  for (const directory of [...new Set(directories)]) {
    for (const suffix of process.platform === "win32" ? [".exe", ""] : [""]) {
      const candidate = join(directory, name + suffix);
      try {
        await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        const path = await realpath(candidate),
          info = await lstat(path);
        if (info.isFile()) return path;
      } catch {
        /* A missing PATH entry is not a dependency failure by itself. */
      }
    }
  }
  return null;
}

function spawnOwned(executable, args, options) {
  const grouped = process.platform !== "win32";
  const child = spawn(executable, args, { ...options, detached: grouped });
  const owned = { child, grouped, closed: false, signalFailed: false };
  const killLeader = child.kill.bind(child);
  child.once("close", () => {
    owned.closed = true;
  });
  child.kill = (signal = "SIGTERM") => {
    if (!grouped || !child.pid) return killLeader(signal);
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      if (error.code !== "ESRCH") owned.signalFailed = true;
      return false;
    }
  };
  return owned;
}

function groupExists(owned) {
  if (!owned.child.pid) return false;
  try {
    process.kill(-owned.child.pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

async function confirmOwnedExit(children, { cancelled = false } = {}) {
  for (const owned of children) {
    if (!owned.child.pid) continue;
    if (!owned.grouped) {
      // Node cannot confirm Windows descendants after cancelling a leader.
      if (cancelled || !owned.closed) return false;
      continue;
    }
    if (!groupExists(owned)) continue;
    owned.child.kill("SIGTERM");
    const deadline = Date.now() + 4000;
    let escalated = false;
    while (groupExists(owned) && Date.now() < deadline) {
      if (!escalated && Date.now() > deadline - 3000) {
        owned.child.kill("SIGKILL");
        escalated = true;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    if (groupExists(owned) || owned.signalFailed) return false;
  }
  return true;
}

async function capture(
  executable,
  args,
  { signal, timeout = 25_000, limit = 3_000_000, env = process.env } = {},
) {
  if (!executable)
    throw cliError("DEPENDENCY_MISSING", "未找到 yt-dlp，请安装并放到 PATH 或指定 --bin-dir。");
  signal?.throwIfAborted();
  return new Promise((resolveCapture, reject) => {
    const owned = spawnOwned(executable, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    const child = owned.child;
    let stdout = "",
      stderr = "",
      bytes = 0,
      failure,
      killTimer;
    const stop = (error) => {
      failure ||= error;
      child.kill("SIGTERM");
      killTimer ||= setTimeout(() => child.kill("SIGKILL"), 3000);
    };
    const aborted = () => stop(signal.reason || cliError("CANCELLED", "命令已取消。"));
    const timer = setTimeout(() => stop(cliError("TIMEOUT", "查询超时。")), timeout);
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) aborted();
    for (const [stream, name] of [
      [child.stdout, "stdout"],
      [child.stderr, "stderr"],
    ]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > limit) {
          stop(cliError("OUTPUT_LIMIT", "查询输出过大，请缩小范围。"));
          return;
        }
        if (name === "stdout") stdout += chunk;
        else stderr += chunk;
      });
    }
    child.once("error", () => {
      failure ||= cliError("PROCESS_FAILED", "无法启动依赖程序。");
    });
    child.once("close", async (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", aborted);
      if (!(await confirmOwnedExit([owned], { cancelled: Boolean(failure) }))) {
        reject(
          cliError("PROCESS_TREE_UNCONFIRMED", "无法确认查询子进程树已结束；请核查进程后再操作。"),
        );
        return;
      }
      if (failure) reject(failure);
      else if (code !== 0)
        reject(
          cliError("PROCESS_FAILED", "依赖程序未成功完成，请检查网络、视频访问条件和依赖版本。"),
        );
      else resolveCapture({ stdout, stderr });
    });
  });
}

async function jsRuntimeArguments(executable, env, signal) {
  if (!executable || Number(process.versions.node.split(".")[0]) < 22) return [];
  try {
    const { stdout } = await capture(executable, ["--ignore-config", "--help"], {
      env,
      signal,
      timeout: 5000,
      limit: 512 * 1024,
    });
    return /--js-runtimes\b/u.test(stdout) ? ["--js-runtimes", `node:${process.execPath}`] : [];
  } catch (error) {
    if (signal?.aborted || error.code === "PROCESS_TREE_UNCONFIRMED") throw error;
    return [];
  }
}

async function doctor(options, env, signal) {
  const dependencies = {};
  for (const name of ["yt-dlp", "ffmpeg"]) {
    const path = await findCliExecutable(name, { env, binDirectory: options["bin-dir"] });
    try {
      const result =
        path &&
        (await capture(path, name === "yt-dlp" ? ["--ignore-config", "--version"] : ["-version"], {
          env,
          signal,
          timeout: 5000,
          limit: 64 * 1024,
        }));
      dependencies[name] = {
        available: Boolean(result),
        path,
        version: clean(result?.stdout.split(/\r?\n/)[0], 200),
      };
    } catch (error) {
      dependencies[name] = {
        available: false,
        path,
        error: { code: error.code, message: error.message },
      };
    }
  }
  const runtimeArgs = await jsRuntimeArguments(dependencies["yt-dlp"].path, env, signal);
  return {
    node: { version: process.versions.node, executable: process.execPath },
    dependencies,
    javascriptRuntime: {
      available: Number(process.versions.node.split(".")[0]) >= 22,
      enabled: runtimeArgs.length > 0,
      executable: process.execPath,
      note: runtimeArgs.length
        ? "为支持此选项的 yt-dlp 显式启用当前 Node。YouTube 还取决于 yt-dlp/EJS、网站和网络。"
        : "当前 Node 或 yt-dlp 不支持显式 JavaScript runtime；基础命令保持兼容。",
    },
  };
}

async function inspect(input, options, env, signal) {
  fields(input, ["url", "playlist"]);
  const request = parseDownloadRequest({
    action: "download",
    url: input.url,
    configuration: { playlist: input.playlist ?? false },
  });
  const executable = await findCliExecutable("yt-dlp", { env, binDirectory: options["bin-dir"] });
  const runtimeArgs = await jsRuntimeArguments(executable, env, signal);
  const { stdout } = await capture(
    executable,
    [
      ...runtimeArgs,
      "--ignore-config",
      "--no-cache-dir",
      "--skip-download",
      "--dump-single-json",
      "--socket-timeout",
      "10",
      "--retries",
      "0",
      ...(request.configuration.playlist
        ? ["--flat-playlist", "--playlist-end", "200"]
        : ["--no-playlist"]),
      "--",
      request.url,
    ],
    { env, signal },
  );
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw cliError("INVALID_OUTPUT", "下载器未返回有效视频信息。");
  }
  const summary = (row) => ({
    id: clean(row?.id, 160),
    title: clean(row?.title, 500),
    url: clean(row?.webpage_url || row?.url, 4096),
    author: clean(row?.uploader || row?.channel, 160),
    duration: Number.isFinite(row?.duration) ? row.duration : null,
  });
  return {
    ...summary(data),
    url: request.url,
    extractor: clean(data?.extractor_key || data?.extractor, 100),
    uploadDate: clean(data?.upload_date, 20),
    playlist: Array.isArray(data?.entries),
    entries: Array.isArray(data?.entries) ? data.entries.slice(0, 200).map(summary) : [],
    resolutions: [
      ...new Set(
        (Array.isArray(data?.formats) ? data.formats : [])
          .map((format) => format.height)
          .filter((value) => Number.isInteger(value) && value > 0),
      ),
    ].sort((a, b) => b - a),
  };
}

async function search(input, options, env, signal, fetcher) {
  fields(input, ["query", "platform", "limit"]);
  if (
    typeof input.query !== "string" ||
    !input.query.trim() ||
    input.query.length > 300 ||
    !["youtube", "bilibili", "both"].includes(input.platform || "both") ||
    (input.limit !== undefined &&
      (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 8))
  )
    throw cliError(
      "INVALID_ARGUMENT",
      "query 最多 300 字符；platform 为 youtube/bilibili/both；limit 为 1–8。",
    );
  const platforms =
    !input.platform || input.platform === "both" ? ["youtube", "bilibili"] : [input.platform];
  const executable = await findCliExecutable("yt-dlp", { env, binDirectory: options["bin-dir"] });
  const runtimeArgs = await jsRuntimeArguments(executable, env, signal);
  const candidates = [],
    warnings = [];
  for (const platform of platforms) {
    signal?.throwIfAborted();
    let found = [];
    if (executable) {
      try {
        const { stdout } = await capture(
          executable,
          [
            ...runtimeArgs,
            "--ignore-config",
            "--no-cache-dir",
            "--skip-download",
            "--flat-playlist",
            "--dump-single-json",
            "--socket-timeout",
            "10",
            "--retries",
            "0",
            "--extractor-retries",
            "0",
            "--",
            `${platform === "youtube" ? "ytsearch" : "bilisearch"}${input.limit || 8}:${input.query}`,
          ],
          { env, signal },
        );
        const data = JSON.parse(stdout);
        for (const row of Array.isArray(data?.entries)
          ? data.entries.slice(0, input.limit || 8)
          : []) {
          const raw =
            row?.webpage_url ||
            row?.url ||
            (platform === "youtube" && /^[\w-]{11}$/.test(row?.id)
              ? `https://www.youtube.com/watch?v=${row.id}`
              : "");
          const url = canonicalCandidate(raw, platform);
          if (url && row.title)
            found.push({
              url,
              platform,
              title: clean(row.title, 300),
              author: clean(row.uploader || row.channel, 160),
              duration: row.duration ?? null,
              evidence: "platform-search",
            });
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        warnings.push({ platform, message: clean(error.message) });
      }
    }
    if (!found.length) {
      try {
        const boundedFetch = (url, init) =>
          fetcher(url, {
            ...init,
            signal: AbortSignal.any([init.signal, signal || new AbortController().signal]),
          });
        const result = await searchExternalSources(
          { platform, query: input.query, limit: input.limit || 8 },
          boundedFetch,
        );
        found = result.candidates;
      } catch (error) {
        if (signal?.aborted) throw error;
        warnings.push({ platform, message: "公开平台或搜索索引暂不可用。" });
      }
    }
    candidates.push(...found);
  }
  return {
    query: input.query,
    candidates,
    warnings,
    note: "搜索索引结果未验证当前可访问性；本命令未读取视频正文。",
  };
}

function canonicalCandidate(value, platform) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (
      platform === "youtube" &&
      ["www.youtube.com", "youtube.com", "youtu.be"].includes(url.hostname)
    ) {
      const id = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v");
      return /^[\w-]{11}$/.test(id || "") ? `https://www.youtube.com/watch?v=${id}` : null;
    }
    if (
      platform === "bilibili" &&
      ["www.bilibili.com", "bilibili.com"].includes(url.hostname) &&
      /^\/video\/(BV[A-Za-z0-9]{10}|av\d+)\/?$/.test(url.pathname)
    )
      return `https://www.bilibili.com${url.pathname}`;
  } catch {
    /* Only canonical platform links reach callers. */
  }
  return null;
}

async function worker(
  project,
  id,
  attempt,
  token,
  options,
  { env = process.env, onProgress = () => {}, signal, detached = false } = {},
) {
  const store = await createCliStore(project),
    initial = await store.read(id);
  if (initial.attempt !== attempt || initial.workerToken !== token || initial.status !== "queued")
    throw cliError("WORKER_REJECTED", "Worker 与当前待开始任务不匹配。");
  const request = parseDownloadRequest(initial.request);
  if (request.useSavedLogin)
    throw cliError("UNSUPPORTED", "CLI 不读取 Host Cookie；请使用面板授权账号下载。");
  let detachedGroup = false;
  if (detached && process.platform !== "win32") {
    try {
      const group = await capture("/bin/ps", ["-o", "pgid=", "-p", String(process.pid)], {
        env,
        signal,
        timeout: 2000,
        limit: 4096,
      });
      detachedGroup = Number(group.stdout.trim()) === process.pid;
    } catch {
      /* If group ownership cannot be verified, crash recovery stays conservative. */
    }
  }
  const release = await store.claimWorker(id, attempt, token, { detachedGroup });
  const controller = new AbortController();
  const stop = () => controller.abort(cliError("CANCELLED", "CLI 下载已取消。"));
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  const timer = setTimeout(
    () => controller.abort(cliError("TIMEOUT", "下载超过六小时上限，请检查后明确重试。")),
    6 * 60 * 60 * 1000,
  );
  let pollTail = Promise.resolve(),
    progress = initial.progress,
    lastWrite = 0;
  const poll = () => {
    pollTail = pollTail
      .then(async () => {
        const record = await store.read(id);
        if (
          record.attempt !== attempt ||
          record.workerToken !== token ||
          !["queued", "running"].includes(record.status)
        )
          throw cliError("WORKER_REJECTED", "任务已改变，当前 worker 已停止。");
        if (record.cancelRequestedAt) stop();
        if (Date.now() - lastWrite >= 1500) {
          await store.update(id, (current) => {
            if (current.attempt !== attempt || current.workerToken !== token)
              throw cliError("WORKER_REJECTED", "任务已改变。");
            lastWrite = Date.now();
            return {
              ...current,
              status: "running",
              heartbeatAt: lastWrite,
              updatedAt: lastWrite,
              progress,
            };
          });
        }
      })
      .catch((error) => {
        controller.abort(error);
      });
  };
  const polling = setInterval(poll, 250);
  const children = [];
  let result, failure;
  try {
    poll();
    await pollTail;
    controller.signal.throwIfAborted();
    const executables = {};
    for (const name of ["yt-dlp", "ffmpeg"])
      executables[name] = await findCliExecutable(name, { env, binDirectory: options["bin-dir"] });
    if (!executables["yt-dlp"])
      throw cliError("DEPENDENCY_MISSING", "未找到 yt-dlp，请先安装并设置 PATH 或 --bin-dir。");
    const runtimeArgs = await jsRuntimeArguments(executables["yt-dlp"], env, controller.signal);
    await checkedDirectory(initial.outputDirectory, { create: true });
    // Reuse the same private work directory across explicit attempts so yt-dlp
    // --continue can see the partial files left by a confirmed cancellation.
    const task = await store.taskDirectory(id),
      workDirectory = join(task, "work");
    await mkdir(workDirectory, { mode: 0o700 }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    await checkedDirectory(workDirectory);
    result = await runDownload(request, {
      jobDir: workDirectory,
      outputDir: initial.outputDirectory,
      signal: controller.signal,
      spawnProcess: (name, args, spawnOptions) => {
        const owned = spawnOwned(
          executables[name] || name,
          name === "yt-dlp" ? [...runtimeArgs, ...args] : args,
          {
            ...spawnOptions,
            env,
          },
        );
        children.push(owned);
        return owned.child;
      },
      progress: (value) => {
        progress = value;
        onProgress(value);
      },
    });
  } catch (error) {
    failure = error;
  } finally {
    clearInterval(polling);
    clearTimeout(timer);
    await pollTail;
    signal?.removeEventListener("abort", stop);
  }
  const treeConfirmed =
    failure?.code !== "PROCESS_TREE_UNCONFIRMED" &&
    (await confirmOwnedExit(children, { cancelled: controller.signal.aborted }));
  if (!treeConfirmed)
    failure = cliError(
      "PROCESS_TREE_UNCONFIRMED",
      "无法确认下载子进程树已全部结束。任务标记为中断并保留 worker 锁；请核查原进程树后人工恢复，避免重复下载。",
    );
  try {
    await store.update(id, (record) => {
      if (record.attempt !== attempt || record.workerToken !== token)
        throw cliError("WORKER_REJECTED", "任务已改变，未覆盖新记录。");
      const now = Date.now(),
        cancelled = record.cancelRequestedAt || failure?.code === "CANCELLED";
      const { workerToken: _token, ...rest } = record;
      return {
        ...rest,
        status: !treeConfirmed
          ? "interrupted"
          : failure
            ? cancelled
              ? "cancelled"
              : "failed"
            : "completed",
        updatedAt: now,
        heartbeatAt: now,
        finishedAt: now,
        progress: failure ? progress : { stage: "complete", fraction: 1, message: "下载完成。" },
        ...(failure
          ? { error: { code: failure.code || "DOWNLOAD_FAILED", message: clean(failure.message) } }
          : { error: null }),
        files: result
          ? result.artifacts.map(({ name, bytes, sha256, mimeType, published }) => ({
              path: join(initial.outputDirectory, published.path),
              name,
              bytes,
              sha256,
              mimeType,
            }))
          : [],
      };
    });
  } finally {
    if (treeConfirmed) await release();
  }
  return getCliJob(project, id);
}

async function launch(store, record, options, context) {
  const token = randomUUID();
  await store.update(record.id, (current) => ({ ...current, workerToken: token }));
  if (!options.background)
    return worker(store.project, record.id, record.attempt, token, options, context);
  try {
    const child = spawn(
      process.execPath,
      [
        ENTRY,
        "_worker",
        "--project",
        store.project,
        "--job",
        record.id,
        "--attempt",
        String(record.attempt),
        "--token",
        token,
        ...(options["bin-dir"] ? ["--bin-dir", options["bin-dir"]] : []),
      ],
      { detached: true, stdio: "ignore", shell: false, env: context.env || process.env },
    );
    await new Promise((resolveSpawn, reject) => {
      child.once("spawn", resolveSpawn);
      child.once("error", reject);
    });
    child.unref();
    return { ...(await getCliJob(store.project, record.id)), background: true };
  } catch {
    // The record is deliberately retained: inspect this ID before another start.
    throw Object.assign(
      cliError(
        "SUBMISSION_UNCERTAIN",
        "无法确认后台 worker 是否已启动。请用返回的任务 ID 检查状态，不要重新下载。",
      ),
      { jobId: record.id },
    );
  }
}

export async function main(
  argv,
  { cwd = process.cwd(), env = process.env, signal, fetcher = fetch, onProgress = () => {} } = {},
) {
  const { command, options } = argumentsFor(argv);
  if (["help", "ops"].includes(command))
    return {
      ok: true,
      result: {
        format: "mimi-download.cli",
        schemaVersion: 1,
        commands: COMMANDS,
        usage:
          "node video-download.mjs <command> --project /absolute/project [--input-file request.json] [--job UUID] [--background] [--bin-dir /absolute/bin]",
        inputs: {
          inspect: { url: "HTTP(S) URL", playlist: false },
          search: { query: "keywords", platform: "both", limit: 8 },
          download: {
            url: "HTTP(S) URL",
            configuration: { format: "best", playlist: false, subtitles: false },
            outputDirectory: "optional absolute directory",
          },
        },
        note: "独立 CLI 任务保存在项目 .mimi-download-cli/；不访问 Host Cookie、模型凭据、面板队列或资源库。后台进程仍需要运行设备保持在线。",
      },
    };
  const project = await checkedDirectory(options.project);
  if (options["bin-dir"]) {
    const binDirectory = await checkedDirectory(options["bin-dir"]);
    env = {
      ...env,
      PATH: [...new Set([...(env.PATH || "").split(delimiter), binDirectory].filter(Boolean))].join(
        delimiter,
      ),
    };
  }
  if (command === "doctor") return { ok: true, result: await doctor(options, env, signal) };
  if (command === "inspect")
    return {
      ok: true,
      result: await inspect(await readInput(options["input-file"], cwd), options, env, signal),
    };
  if (command === "search")
    return {
      ok: true,
      result: await search(
        await readInput(options["input-file"], cwd),
        options,
        env,
        signal,
        fetcher,
      ),
    };
  if (command === "jobs") return { ok: true, result: await listCliJobs(project) };
  if (command === "status") return { ok: true, result: await getCliJob(project, options.job) };
  if (command === "cancel")
    return { ok: true, result: await requestCliCancellation(project, options.job) };
  if (command === "check") {
    const record = await getCliJob(project, options.job),
      files = [];
    for (const file of record.files || []) {
      // Import lazily; the store stays independent of the Panel library bridge.
      const { handleLibraryRequest } = await import("./library.mjs");
      const result = await handleLibraryRequest(
        { action: "check", files: [{ path: file.path, bytes: file.bytes }] },
        { cwd: record.outputDirectory },
      );
      files.push(...result.files);
    }
    return { ok: true, result: { id: record.id, files } };
  }
  if (command === "_worker")
    return {
      ok: true,
      result: await worker(project, options.job, Number(options.attempt), options.token, options, {
        env,
        signal,
        onProgress,
        detached: true,
      }),
    };
  let store, record;
  if (command === "download") {
    const input = await readInput(options["input-file"], cwd);
    fields(input, ["url", "configuration", "outputDirectory"]);
    const request = parseDownloadRequest({
      action: "download",
      url: input.url,
      configuration: input.configuration,
    });
    const outputDirectory = input.outputDirectory ?? join(project, "downloads");
    if (typeof outputDirectory !== "string" || !isAbsolute(outputDirectory))
      throw cliError("INVALID_ARGUMENT", "outputDirectory 必须是完整目录路径。");
    store = await createCliStore(project, { create: true });
    record = await store.create(request, outputDirectory);
  } else if (command === "retry") {
    store = await createCliStore(project);
    await store.verifyNoWorker(options.job);
    record = await store.update(options.job, (current) => {
      const stale =
        ["queued", "running"].includes(current.status) &&
        Date.now() - (current.heartbeatAt || current.updatedAt) > HEARTBEAT_TIMEOUT_MS;
      if (!TERMINAL_STATUSES.has(current.status) && !stale)
        throw cliError("JOB_BUSY", "任务尚未结束，请先取消并等待退出。");
      const {
        workerToken: _token,
        cancelRequestedAt: _cancel,
        finishedAt: _finished,
        ...rest
      } = current;
      return {
        ...rest,
        attempt: current.attempt + 1,
        status: "queued",
        updatedAt: Date.now(),
        heartbeatAt: Date.now(),
        error: null,
        files: [],
        progress: { stage: "queued", fraction: 0, message: "等待明确重试。" },
      };
    });
  }
  return { ok: true, result: await launch(store, record, options, { env, signal, onProgress }) };
}

const direct = process.argv[1] && (await realpath(process.argv[1]).catch(() => null));
if (direct && import.meta.url === pathToFileURL(direct).href) {
  const controller = new AbortController(),
    stop = () => controller.abort(cliError("CANCELLED", "CLI 已收到停止请求。"));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    const response = await main(process.argv.slice(2), {
      signal: controller.signal,
      onProgress: (progress) =>
        process.stderr.write(JSON.stringify({ type: "progress", progress }) + "\n"),
    });
    process.stdout.write(JSON.stringify(response) + "\n");
    if (["failed", "cancelled", "interrupted"].includes(response.result?.status))
      process.exitCode = 1;
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error: {
          code: error.code || "OPERATION_FAILED",
          message: clean(error.message),
          ...(error.jobId ? { jobId: error.jobId } : {}),
        },
      }) + "\n",
    );
    process.exitCode = ["INVALID_ARGUMENT", "INVALID_INPUT", "INVALID_JOB"].includes(error.code)
      ? 2
      : 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
