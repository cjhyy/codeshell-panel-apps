import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDownloadRequest, runDownload } from "./download.mjs";
import { searchExternalSources } from "./search.mjs";
import { getEnvironment, findRuntimeExecutable } from "./environment.mjs";
import {
  cliError,
  cliJobId,
  cliRequestKey,
  checkedDirectory,
  createCliStore,
  getCliJob,
  listCliJobs,
  requestCliCancellation,
  TERMINAL_STATUSES,
  HEARTBEAT_TIMEOUT_MS,
} from "./cli-store.mjs";

const ENTRY = fileURLToPath(new URL("./video-download.mjs", import.meta.url));
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
  "archive",
  "start",
  "queue",
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
    if (["--background", "--refresh", "--latest"].includes(flag)) {
      const name = flag.slice(2);
      if (options[name]) throw cliError("INVALID_ARGUMENT", "参数重复。");
      options[name] = true;
      continue;
    }
    const name = flag?.slice(2),
      value = rest[++i];
    if (
      !flag?.startsWith("--") ||
      ![
        "project",
        "input-file",
        "job",
        "bin-dir",
        "attempt",
        "token",
        "request-key",
        "source",
        "expected-attempt",
        "restricted-output",
        "request-digest",
      ].includes(name) ||
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
  if (["doctor", "inspect", "search", "download", "retry", "start", "_worker"].includes(command))
    allowed.add("bin-dir");
  if (["inspect", "search", "download"].includes(command)) allowed.add("input-file");
  if (["status", "cancel", "retry", "check", "archive", "start", "_worker"].includes(command))
    allowed.add("job");
  if (["download", "retry", "start"].includes(command)) allowed.add("background");
  if (["retry", "start"].includes(command)) allowed.add("expected-attempt");
  if (command === "download") {
    allowed.add("request-key");
    allowed.add("source");
  }
  if (command === "doctor") {
    allowed.add("refresh");
    allowed.add("latest");
  }
  if (command === "queue") allowed.add("input-file");
  if (command === "_worker") {
    allowed.add("attempt");
    allowed.add("token");
    allowed.add("restricted-output");
    allowed.add("request-digest");
  }
  if (Object.keys(options).some((name) => !allowed.has(name)))
    throw cliError("INVALID_ARGUMENT", "此命令不支持提供的参数。");
  if (["inspect", "search", "download"].includes(command) && !options["input-file"])
    throw cliError("INVALID_ARGUMENT", "必须提供 --input-file JSON 文件。");
  if (["status", "cancel", "retry", "check", "archive", "start", "_worker"].includes(command))
    cliJobId(options.job);
  if (options["request-key"] !== undefined) cliRequestKey(options["request-key"]);
  if (options.source !== undefined && !["cli", "chat", "panel"].includes(options.source))
    throw cliError("INVALID_ARGUMENT", "source 必须是 cli/chat/panel。");
  if (
    options["expected-attempt"] !== undefined &&
    !/^[1-9]\d{0,8}$/u.test(options["expected-attempt"])
  )
    throw cliError("INVALID_ARGUMENT", "expected-attempt 必须是正整数。");
  if (command === "_worker" && (!/^[1-9]\d{0,5}$/.test(options.attempt || "") || !options.token))
    throw cliError("INVALID_ARGUMENT", "内部 worker 参数无效。");
  if (options["restricted-output"] !== undefined && options["restricted-output"] !== "project")
    throw cliError("INVALID_ARGUMENT", "内部 worker 输出范围无效。");
  if (options["request-digest"] !== undefined && !/^[a-f0-9]{64}$/u.test(options["request-digest"]))
    throw cliError("INVALID_ARGUMENT", "内部 worker 请求摘要无效。");
  if (options["restricted-output"] && !options["request-digest"])
    throw cliError("INVALID_ARGUMENT", "受限 worker 缺少启动时冻结的请求摘要。");
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
export const findCliExecutable = findRuntimeExecutable;

function spawnOwned(executable, args, options) {
  const grouped = process.platform !== "win32";
  const child = spawn(executable, args, { ...options, detached: grouped });
  const owned = { child, grouped, closed: false, signalFailed: false, terminationRequested: false };
  const killLeader = child.kill.bind(child);
  child.once("close", () => {
    owned.closed = true;
  });
  child.kill = (signal = "SIGTERM") => {
    owned.terminationRequested = true;
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

// A leader's close receipt cannot establish what happened to its Windows
// descendants after any termination request, including inner probe timeouts.
// This pure policy is simulated in tests; POSIX uses actual group confirmation.
export function ungroupedExitConfirmed(
  owned,
  { cancelled = false, platform = process.platform } = {},
) {
  return (
    platform === "win32" &&
    owned.closed === true &&
    !cancelled &&
    !owned.terminationRequested &&
    !owned.signalFailed
  );
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
      if (!ungroupedExitConfirmed(owned, { cancelled })) return false;
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
      timeout: 30_000,
      limit: 512 * 1024,
    });
    return /--js-runtimes\b/u.test(stdout) ? ["--js-runtimes", `node:${process.execPath}`] : [];
  } catch (error) {
    if (signal?.aborted || error.code === "PROCESS_TREE_UNCONFIRMED") throw error;
    return [];
  }
}

async function doctor(project, options, env, signal, fetcher) {
  const snapshot = await getEnvironment(project, {
    env,
    signal,
    fetcher,
    binDirectory: options["bin-dir"],
    refresh: options.refresh === true,
    includeLatest: options.latest === true,
  });
  const { dependencies, cached, checkedAt, ready, latest } = snapshot.result;
  const runtimeArgs = await jsRuntimeArguments(dependencies["yt-dlp"].path, env, signal);
  return {
    node: { version: process.versions.node, executable: process.execPath },
    dependencies,
    cached,
    checkedAt,
    ready,
    ...(latest ? { latest } : {}),
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

function executionDigest(record) {
  return createHash("sha256")
    .update(JSON.stringify({ request: record.request, outputDirectory: record.outputDirectory }))
    .digest("hex");
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
  // These constraints come from the reviewed launch context/argv. Mutable
  // project records (including source) never grant access to another directory.
  const restrictedOutput =
    options.restrictedOutput === true || options["restricted-output"] === "project";
  const expectedDigest = options.executionDigest || options["request-digest"];
  const verifyRecord = (record) => {
    if (
      (restrictedOutput && !expectedDigest) ||
      (expectedDigest && executionDigest(record) !== expectedDigest)
    )
      throw cliError(
        "INPUT_CHANGED",
        "下载请求或保存目录在任务启动后发生变化，未继续执行。请核对后重新提交。",
      );
  };
  const verifyExecution = async (record = undefined) => {
    const current = record || (await store.read(id));
    if (current.cancelRequestedAt) throw cliError("CANCELLED", "CLI 下载已取消。");
    if (
      current.attempt !== attempt ||
      current.workerToken !== token ||
      !["queued", "running"].includes(current.status)
    )
      throw cliError("WORKER_REJECTED", "任务已改变，未继续执行。");
    verifyRecord(current);
    await store.verify();
    await validateOutputDirectory(store.project, initial.outputDirectory, restrictedOutput);
  };
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
  let admitted = false,
    pollTail = Promise.resolve(),
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
        verifyRecord(record);
        if (record.cancelRequestedAt) stop();
        if (Date.now() - lastWrite >= 1500) {
          await store.update(id, (current) => {
            if (current.attempt !== attempt || current.workerToken !== token)
              throw cliError("WORKER_REJECTED", "任务已改变。");
            verifyRecord(current);
            lastWrite = Date.now();
            return {
              ...current,
              status: admitted ? "running" : "queued",
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
    await verifyExecution(initial);
    const request = parseDownloadRequest(initial.request);
    if (request.useSavedLogin)
      throw cliError("UNSUPPORTED", "CLI 不读取 Host Cookie；请使用面板授权账号下载。");
    poll();
    await pollTail;
    controller.signal.throwIfAborted();
    while (!(await store.admitWorker(id, attempt, token))) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      await pollTail;
      controller.signal.throwIfAborted();
    }
    admitted = true;
    await store.update(id, (record) => {
      if (record.attempt !== attempt || record.workerToken !== token || record.cancelRequestedAt)
        throw cliError("WORKER_REJECTED", "任务已改变，未开始下载。");
      return {
        ...record,
        status: "running",
        startedAt: Date.now(),
        heartbeatAt: Date.now(),
        updatedAt: Date.now(),
      };
    });
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
    await verifyExecution();
    controller.signal.throwIfAborted();
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
              status: "present",
            }))
          : [],
      };
    });
  } finally {
    if (treeConfirmed) {
      await store.releaseSlot(id, attempt, token);
      await release();
    }
  }
  return getCliJob(project, id);
}

async function launch(store, record, options, context) {
  const token = randomUUID();
  options = { ...options, executionDigest: executionDigest(record) };
  await store.update(record.id, (current) => {
    if (
      current.attempt !== record.attempt ||
      current.status !== "queued" ||
      current.workerToken ||
      current.cancelRequestedAt ||
      current.archivedAt
    )
      throw cliError("SUBMISSION_UNCERTAIN", "此任务已改变或已启动，请查询状态，不能重复启动。");
    return { ...current, workerToken: token };
  });
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
        "--request-digest",
        options.executionDigest,
        ...(options.restrictedOutput ? ["--restricted-output", "project"] : []),
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

function validateTaskInput(input, { requireAttempt = false } = {}) {
  const action = input?.action;
  if (action === "submit") {
    fields(input, ["action", "requestKey", "request", "source", "start", "title"]);
    cliRequestKey(input.requestKey);
    fields(input.request, ["url", "configuration", "outputDirectory", "copySuffix"]);
    if (
      (input.source !== undefined && !["cli", "chat", "panel"].includes(input.source)) ||
      (input.start !== undefined && typeof input.start !== "boolean") ||
      (input.request.outputDirectory !== undefined &&
        typeof input.request.outputDirectory !== "string") ||
      (input.title !== undefined && (typeof input.title !== "string" || input.title.length > 500))
    )
      throw cliError("INVALID_ARGUMENT", "source/start/title 格式无效。");
    const request = parseDownloadRequest({
      action: "download",
      url: input.request.url,
      configuration: input.request.configuration,
      copySuffix: input.request.copySuffix,
    });
    return {
      ...input,
      request,
      outputDirectory: input.request.outputDirectory,
      title: clean(input.title, 500),
    };
  }
  if (action === "list") {
    fields(input, ["action", "limit", "includeArchived"]);
    if (
      (input.limit !== undefined &&
        (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1000)) ||
      (input.includeArchived !== undefined && typeof input.includeArchived !== "boolean")
    )
      throw cliError("INVALID_ARGUMENT", "列表参数无效。");
    return input;
  }
  if (action === "queue") {
    fields(input, ["action"]);
    return input;
  }
  if (action === "configure") {
    fields(input, ["action", "expectedRevision", "paused", "maxConcurrent"]);
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      typeof input.paused !== "boolean" ||
      !Number.isSafeInteger(input.maxConcurrent) ||
      input.maxConcurrent < 1 ||
      input.maxConcurrent > 4
    )
      throw cliError(
        "INVALID_ARGUMENT",
        "队列需要 expectedRevision、paused 和 1–4 的 maxConcurrent。",
      );
    return input;
  }
  if (["status", "cancel", "retry", "start", "check", "archive"].includes(action)) {
    fields(input, [
      "action",
      "id",
      ...(["retry", "start"].includes(action) ? ["expectedAttempt"] : []),
    ]);
    cliJobId(input.id);
    if (
      ["retry", "start"].includes(action) &&
      ((requireAttempt && input.expectedAttempt === undefined) ||
        (input.expectedAttempt !== undefined &&
          (!Number.isSafeInteger(input.expectedAttempt) || input.expectedAttempt < 1)))
    )
      throw cliError("INVALID_ARGUMENT", "start/retry 需要任务当前的 expectedAttempt。");
    return input;
  }
  throw cliError("INVALID_ARGUMENT", "未知下载服务操作。");
}

async function validateOutputDirectory(project, value, restricted) {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    value.split(/[\\/]/u).includes("..")
  )
    throw cliError("INVALID_ARGUMENT", "outputDirectory 必须是不含跳级路径的完整目录路径。");
  const output = resolve(value),
    child = relative(project, output);
  if (restricted && (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)))
    throw cliError(
      "OUTSIDE_PROJECT",
      "此任务的保存目录不在当前授权项目内，请通过 CLI 操作或重新授权原目录。",
    );
  // Validate the existing ancestry without creating output directories while
  // preparing a request. The worker checks identity again immediately before use.
  let cursor = output;
  for (;;) {
    try {
      await checkedDirectory(cursor);
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      cursor = parent;
    }
  }
  return output;
}

// Shared domain operations. The CLI supplies an explicit project; the reviewed
// stdin entry supplies only its Host-authorized cwd and always limits outputs.
export async function runTaskOperation(
  input,
  {
    project,
    env = process.env,
    signal,
    onProgress = () => {},
    options = {},
    background = true,
    restrictedOutput = false,
    requireAttempt = false,
  } = {},
) {
  const operation = validateTaskInput(input, { requireAttempt });
  const root = await checkedDirectory(project);
  signal?.throwIfAborted();
  if (operation.action === "list") {
    const listed = await listCliJobs(root, {
      limit: operation.limit ?? 100,
      includeArchived: operation.includeArchived ?? false,
    });
    return { ...listed, queue: await (await createCliStore(root)).getQueue() };
  }
  if (operation.action === "status") return getCliJob(root, operation.id);
  if (operation.action === "cancel") return requestCliCancellation(root, operation.id);
  if (operation.action === "queue") return (await createCliStore(root)).getQueue();
  if (operation.action === "configure")
    return (await createCliStore(root, { create: true })).configureQueue(operation);
  if (operation.action === "submit") {
    const outputDirectory = await validateOutputDirectory(
      root,
      operation.outputDirectory ?? join(root, "downloads"),
      restrictedOutput,
    );
    const store = await createCliStore(root, { create: true });
    const { record, created } = await store.createOrGet(operation.request, outputDirectory, {
      requestKey: operation.requestKey,
      source: operation.source ?? "cli",
      pending: operation.start === false,
      title: operation.title,
    });
    if (!created || operation.start === false) return getCliJob(root, record.id);
    return launch(
      store,
      record,
      { ...options, background, restrictedOutput },
      { env, signal, onProgress },
    );
  }
  const store = await createCliStore(root);
  if (operation.action === "archive") {
    await store.update(operation.id, async (record) => {
      if (!TERMINAL_STATUSES.has(record.status) && record.status !== "pending")
        throw cliError("JOB_BUSY", "请先取消并等待任务结束，再归档。");
      await store.verifyNoWorker(record.id);
      return record.archivedAt
        ? null
        : { ...record, archivedAt: Date.now(), updatedAt: Date.now() };
    });
    return getCliJob(root, operation.id);
  }
  if (operation.action === "check") {
    await store.update(operation.id, async (record) => {
      await validateOutputDirectory(root, record.outputDirectory, restrictedOutput);
      if (!TERMINAL_STATUSES.has(record.status))
        throw cliError("JOB_BUSY", "下载结束后才能核查结果文件。");
      const { handleLibraryRequest } = await import("./library.mjs");
      const now = Date.now(),
        files = [];
      for (const file of record.files || []) {
        signal?.throwIfAborted();
        const result = await handleLibraryRequest(
          {
            action: "check",
            files: [
              {
                path: file.path,
                bytes: file.bytes,
                ...(file.modifiedAt === undefined ? {} : { modifiedAt: file.modifiedAt }),
              },
            ],
          },
          { cwd: record.outputDirectory },
        );
        const checked = result.files[0];
        // Keep the original download inventory as the comparison baseline.
        // Adopting changed bytes/mtime would make a second check falsely pass.
        files.push({
          ...file,
          status: checked.status,
          ...(file.modifiedAt === undefined && checked.status === "present"
            ? { modifiedAt: checked.modifiedAt }
            : {}),
          checkedAt: now,
        });
      }
      return { ...record, files, checkedAt: now, updatedAt: now };
    });
    return getCliJob(root, operation.id);
  }
  const current = await store.read(operation.id);
  const expectedAttempt = operation.expectedAttempt ?? current.attempt;
  let launchRecord;
  await store.update(operation.id, async (record) => {
    await validateOutputDirectory(root, record.outputDirectory, restrictedOutput);
    if (operation.action === "start") {
      if (record.attempt !== expectedAttempt)
        throw cliError("ATTEMPT_CONFLICT", "任务 attempt 已改变，请刷新。");
      if (record.status !== "pending") return null;
      if (record.archivedAt) throw cliError("JOB_ARCHIVED", "任务已归档。");
      await store.verifyNoWorker(record.id);
      launchRecord = {
        ...record,
        status: "queued",
        queuedAt: Date.now(),
        heartbeatAt: Date.now(),
        updatedAt: Date.now(),
      };
    } else {
      if (record.attempt === expectedAttempt + 1) return null;
      if (record.attempt !== expectedAttempt)
        throw cliError("ATTEMPT_CONFLICT", "任务 attempt 已改变，请刷新后再决定是否重试。");
      await store.verifyNoWorker(record.id);
      const stale =
        ["queued", "running"].includes(record.status) &&
        Date.now() - (record.heartbeatAt || record.updatedAt) > HEARTBEAT_TIMEOUT_MS;
      if (
        !TERMINAL_STATUSES.has(record.status) &&
        !stale &&
        !(record.status === "queued" && !record.workerToken)
      )
        throw cliError("JOB_BUSY", "任务尚未结束，请先取消并等待退出；仅保存的任务请使用 start。");
      const {
        workerToken: _token,
        cancelRequestedAt: _cancel,
        finishedAt: _finished,
        archivedAt: _archive,
        ...rest
      } = record;
      launchRecord = {
        ...rest,
        attempt: record.attempt + 1,
        status: "queued",
        queuedAt: Date.now(),
        updatedAt: Date.now(),
        heartbeatAt: Date.now(),
        error: null,
        files: [],
        progress: { stage: "queued", fraction: 0, message: "等待明确重试。" },
      };
    }
    return launchRecord;
  });
  return launchRecord
    ? launch(
        store,
        launchRecord,
        { ...options, background, restrictedOutput },
        { env, signal, onProgress },
      )
    : getCliJob(root, operation.id);
}

export async function handleServiceRequest(
  input,
  { cwd = process.cwd(), env = process.env, signal } = {},
) {
  try {
    const result = await runTaskOperation(input, {
      project: cwd,
      env,
      signal,
      restrictedOutput: true,
      requireAttempt: true,
    });
    return { format: "mimi-download.service", schemaVersion: 1, ok: true, result };
  } catch (error) {
    return {
      format: "mimi-download.service",
      schemaVersion: 1,
      ok: false,
      error: {
        code: typeof error.code === "string" ? error.code : "OPERATION_FAILED",
        message: clean(error.message),
        ...(error.jobId ? { jobId: error.jobId } : {}),
      },
    };
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
          "node video-download.mjs <command> --project /absolute/project [--input-file request.json] [--job UUID] [--background] [--bin-dir /absolute/bin] [--request-key stable-key] [--source cli|chat|panel] [--expected-attempt N] [doctor: --refresh --latest]",
        inputs: {
          inspect: { url: "HTTP(S) URL", playlist: false },
          search: { query: "keywords", platform: "both", limit: 8 },
          download: {
            url: "HTTP(S) URL",
            configuration: { format: "best", playlist: false, subtitles: false },
            outputDirectory: "optional absolute directory",
          },
        },
        queue: {
          defaultMaxConcurrent: 2,
          maxConcurrent: "1–4",
          configureInput: { expectedRevision: 0, paused: false, maxConcurrent: 2 },
        },
        note: "公共 CLI 与面板服务共享项目 .mimi-download-cli/任务和队列；Host账号任务与资源库仍由Host管理。后台进程仍需要运行设备保持在线。",
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
  if (command === "doctor")
    return { ok: true, result: await doctor(project, options, env, signal, fetcher) };
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
  let operation;
  if (command === "download") {
    const input = await readInput(options["input-file"], cwd);
    fields(input, ["url", "configuration", "outputDirectory", "copySuffix", "title"]);
    const { title, ...request } = input;
    operation = {
      action: "submit",
      request,
      requestKey: options["request-key"] ?? randomUUID(),
      source: options.source ?? "cli",
      ...(title === undefined ? {} : { title }),
    };
  } else if (command === "queue") {
    if (options["input-file"]) {
      const input = await readInput(options["input-file"], cwd);
      fields(input, ["expectedRevision", "paused", "maxConcurrent"]);
      operation = { action: "configure", ...input };
    } else operation = { action: "queue" };
  } else if (command === "jobs") operation = { action: "list" };
  else
    operation = {
      action: command,
      id: options.job,
      ...(options["expected-attempt"] === undefined
        ? {}
        : { expectedAttempt: Number(options["expected-attempt"]) }),
    };
  return {
    ok: true,
    result: await runTaskOperation(operation, {
      project,
      env,
      signal,
      onProgress,
      options,
      background: options.background === true,
    }),
  };
}
