import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { delimiter, isAbsolute, join, parse, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const FORMAT = "mimi-download.environment";
const SCHEMA = 1;
const CACHE_LIMIT = 16 * 1024;
const LOCAL_TTL = 6 * 60 * 60 * 1000;
const LATEST_TTL = 24 * 60 * 60 * 1000;
const LATEST_URL = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const TOOLS = ["yt-dlp", "ffmpeg"];
// Version probes depend on tool/runtime settings, not the shell or chat which
// happened to invoke them. Keep the complete env for execution, but bind cache
// identity only to these settings. Host task IDs, PWD/SHLVL/_, terminal metadata
// and credentials unrelated to these tools must not invalidate another entry.
const EXECUTION_ENV_KEYS = new Set([
  "PATH", "PATHEXT", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "USER", "LOGNAME", "SHELL",
  "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "SYSTEMROOT", "WINDIR", "COMSPEC",
  "TMPDIR", "TMP", "TEMP", "LANG", "LANGUAGE", "TZ",
  "XDG_CONFIG_HOME", "XDG_CONFIG_DIRS", "XDG_DATA_HOME", "XDG_DATA_DIRS", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR",
  "VIRTUAL_ENV", "CONDA_PREFIX", "CONDA_DEFAULT_ENV", "PYENV_ROOT", "PYENV_VERSION", "PYENV_DIR",
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "FTP_PROXY",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "PIP_CERT",
  "OPENSSL_CONF", "OPENSSL_MODULES", "GIT_SSL_CAINFO", "GIT_SSL_CAPATH",
  "FFREPORT", "AV_LOG_FORCE_COLOR", "AV_LOG_FORCE_NOCOLOR",
]);
const EXECUTION_ENV_PREFIX = /^(?:LC_|LD_|DYLD_|PYTHON|NODE_|YTDLP_|YT_DLP_|FFMPEG_)/u;
function environmentIdentity(env) {
  return Object.entries(env).filter(([name]) => {
    const upper = name.toUpperCase();
    return EXECUTION_ENV_KEYS.has(upper) || EXECUTION_ENV_PREFIX.test(upper);
  }).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}
const fail = (code, message) => Object.assign(new Error(message), { code });
const same = (left, right) => left.dev === right.dev && left.ino === right.ino;
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
const cancelled = (signal) => {
  if (signal?.aborted) throw fail("CANCELLED", "环境检测已取消。");
};

async function directory(value, { create = false, private: privateOnly = false } = {}) {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    /[\u0000-\u001f]/u.test(value) ||
    value.split(/[\\/]/u).includes("..")
  )
    throw fail("UNSAFE_PATH", "环境缓存需要无链接的完整项目目录。");
  const absolute = resolve(value), root = parse(absolute).root;
  let cursor = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    if (create) await mkdir(cursor, { mode: 0o700 }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    const info = await lstat(cursor);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw fail("UNSAFE_PATH", "环境缓存目录包含链接或不是普通目录。");
  }
  if ((await realpath(absolute)) !== absolute)
    throw fail("UNSAFE_PATH", "环境缓存目录实际位置发生变化。");
  const info = await lstat(absolute);
  if (privateOnly && process.platform !== "win32" && (info.mode & 0o077))
    throw fail("UNSAFE_PATH", "环境缓存目录必须仅当前用户可访问。");
  return absolute;
}

async function cacheDirectory(project) {
  const root = await directory(project);
  const data = await directory(join(root, ".mimi-download-cli"), { create: true, private: true });
  return directory(join(data, "environment"), { create: true, private: true });
}

function safeRecord(info) {
  // An atomic concurrent replacement can unlink the inode after pathname
  // lookup but before its stat is copied. Zero links is a coherent retired
  // snapshot; more than one link always means an unsafe hard-linked record.
  return info.isFile() && !info.isSymbolicLink() && info.nlink <= 1 &&
    (process.platform === "win32" || (info.mode & 0o077) === 0);
}

async function readCache(parent, name) {
  await directory(parent, { private: true });
  const path = join(parent, name);
  const info = await lstat(path).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (!info) return null;
  if (!safeRecord(info)) throw fail("UNSAFE_CACHE", "环境缓存必须是独立的私有普通文件。");
  if (info.size > CACHE_LIMIT) return null;
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (!handle) return null;
  try {
    const opened = await handle.stat();
    if (!safeRecord(opened) || !same(info, opened)) return null;
    const bytes = Buffer.alloc(CACHE_LIMIT + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const named = await lstat(path).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (named && !safeRecord(named)) throw fail("UNSAFE_CACHE", "环境缓存已替换为链接或非普通文件。");
    if (bytesRead > CACHE_LIMIT) return null;
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, bytesRead)));
    } catch {
      return null;
    }
  } finally {
    await handle.close();
  }
}

async function writeCache(parent, name, value) {
  await directory(parent, { private: true });
  const identity = await lstat(parent);
  const temporary = join(parent, `.write-${randomUUID()}.tmp`);
  const content = JSON.stringify(value) + "\n";
  if (Buffer.byteLength(content) > CACHE_LIMIT) throw fail("CACHE_TOO_LARGE", "环境缓存过大。");
  const handle = await open(temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
    await directory(parent, { private: true });
    if (!same(identity, await lstat(parent))) throw fail("UNSAFE_PATH", "环境缓存目录已替换。");
    const target = join(parent, name);
    const existing = await lstat(target).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (existing && !safeRecord(existing))
      throw fail("UNSAFE_CACHE", "环境缓存目标不是独立的私有普通文件。");
    // Each writer owns a unique temporary file. Concurrent replacements are
    // coherent snapshots; a cache record never owns subprocesses or task locks.
    await rename(temporary, target);
  } finally {
    await handle.close();
    if (same(identity, await lstat(parent).catch(() => ({}))))
      await rm(temporary, { force: true });
  }
}

// Resolve from this invocation's actual environment, never from cache contents.
export async function findRuntimeExecutable(name, { env = process.env, binDirectory } = {}) {
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(name))
    throw fail("INVALID_EXECUTABLE", "工具名称无效。");
  const directories = String(env.PATH || "").split(delimiter).filter((path) => path && isAbsolute(path));
  if (binDirectory) directories.push(await directory(binDirectory));
  for (const parent of [...new Set(directories)]) {
    for (const suffix of process.platform === "win32" ? [".exe", ""] : [""]) {
      try {
        const candidate = join(parent, name + suffix);
        await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        const path = await realpath(candidate), info = await lstat(path);
        if (info.isFile()) return path;
      } catch {
        // A missing PATH directory or tool is a normal unavailable dependency.
      }
    }
  }
  return null;
}

async function fileIdentity(path) {
  if (!path) return null;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    return { path, dev: info.dev, ino: info.ino, size: info.size, mtime: info.mtimeMs, mode: info.mode };
  } catch {
    return null;
  }
}

function groupExists(child) {
  if (!child.pid) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

async function versionProbe(executable, args, { env, cwd, signal, timeout = 5000 } = {}) {
  cancelled(signal);
  const grouped = process.platform !== "win32";
  const child = spawn(executable, args, { env, cwd, shell: false, detached: grouped, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", bytes = 0, failure, closed = false, killTimer, stopTimer, finish;
  const kill = (name) => {
    try {
      if (grouped && child.pid) process.kill(-child.pid, name);
      else child.kill(name);
    } catch (error) {
      if (error.code !== "ESRCH") failure = fail("PROCESS_UNCONFIRMED", "无法确认环境检测子进程已停止。");
    }
  };
  const stop = (error) => {
    failure ||= error;
    kill("SIGTERM");
    killTimer ||= setTimeout(() => kill("SIGKILL"), 200);
    stopTimer ||= setTimeout(() => {
      failure = fail("PROCESS_UNCONFIRMED", "无法确认环境检测子进程已停止。");
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      finish?.(null);
    }, 2500);
  };
  const abort = () => stop(fail("CANCELLED", "环境检测已取消。"));
  const timer = setTimeout(() => stop(fail("TIMEOUT", "环境检测超时。")), timeout);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const result = await new Promise((done) => {
    finish = done;
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > CACHE_LIMIT) stop(fail("OUTPUT_TOO_LARGE", "工具版本输出过大。"));
      else if (stream === child.stdout) stdout += chunk.toString("utf8");
    });
    child.once("error", () => { failure ||= fail("PROBE_FAILED", "无法运行工具版本检测。"); });
    child.once("close", (code) => { closed = true; done(code); });
  });
  clearTimeout(timer);
  clearTimeout(killTimer);
  clearTimeout(stopTimer);
  signal?.removeEventListener("abort", abort);
  // A version command may exit before descendants. Terminate and confirm the
  // whole owned POSIX group before returning or publishing a cache snapshot.
  if (grouped && groupExists(child)) {
    kill("SIGTERM");
    const deadline = Date.now() + 2000;
    while (groupExists(child) && Date.now() < deadline) {
      kill("SIGKILL");
      await pause(20);
    }
    if (groupExists(child)) throw fail("PROCESS_UNCONFIRMED", "无法确认环境检测子进程已停止。");
  }
  if (!closed || (!grouped && failure))
    throw fail("PROCESS_UNCONFIRMED", "无法确认环境检测子进程树已停止。");
  if (failure) throw failure;
  if (result !== 0) throw fail("PROBE_FAILED", "工具版本检测失败。");
  return stdout;
}

function versionOf(name, value) {
  const output = typeof value === "string" ? value : value?.stdout;
  if (typeof output !== "string" || Buffer.byteLength(output) > CACHE_LIMIT ||
      (plain(value) && value.code !== undefined && value.code !== 0)) return null;
  const version = name === "ffmpeg" ? /^ffmpeg version ([^\s]+)/mu.exec(output)?.[1] : output.trim().split(/\s/u)[0];
  return typeof version === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._+~/-]{0,99}$/u.test(version) ? version : null;
}

function validDependency(value) {
  return plain(value) && Object.keys(value).every((key) => ["available", "version", "error"].includes(key)) &&
    typeof value.available === "boolean" &&
    (value.available ? value.error === undefined && typeof value.version === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._+~/-]{0,99}$/u.test(value.version) :
      value.version === null && ["not-found", "probe-failed", "timeout", "output-too-large"].includes(value.error));
}

function fresh(value, now, ttl) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) &&
    Date.parse(value) <= now && now - Date.parse(value) < ttl;
}

async function latestRelease({ fetcher, signal, timeout }) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeout);
  try {
    cancelled(signal);
    const response = await fetcher(LATEST_URL, {
      method: "GET", redirect: "error", signal: controller.signal,
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Mimi-Download-environment" },
    });
    if (!response?.ok || !response.body?.getReader) throw new Error("latest-unavailable");
    const reader = response.body.getReader(), chunks = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > CACHE_LIMIT) throw new Error("latest-response-too-large");
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (data.draft || data.prerelease || typeof data.tag_name !== "string" ||
        !/^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/u.test(data.tag_name))
      throw new Error("latest-invalid-version");
    return data.tag_name;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/** Cache only observed version metadata. Injected probe/fetcher are trusted test adapters. */
export async function getEnvironment(project, {
  env = process.env, binDirectory, refresh = false, includeLatest = false,
  now = Date.now, signal, probe = versionProbe, fetcher = globalThis.fetch,
  localTtlMs = LOCAL_TTL, latestTtlMs = LATEST_TTL, probeTimeout = 5000, latestTimeout = 5000,
} = {}) {
  cancelled(signal);
  const timestamp = typeof now === "function" ? now() : now;
  if (!Number.isFinite(timestamp) || !Number.isFinite(localTtlMs) || localTtlMs < 0 || localTtlMs > LOCAL_TTL ||
      !Number.isFinite(latestTtlMs) || latestTtlMs < 0 || latestTtlMs > LATEST_TTL ||
      !Number.isFinite(probeTimeout) || probeTimeout < 1 || probeTimeout > 30_000 ||
      !Number.isFinite(latestTimeout) || latestTimeout < 1 || latestTimeout > 30_000)
    throw fail("INVALID_ARGUMENT", "环境检测时间参数无效。");
  const checkedAt = new Date(timestamp).toISOString(), parent = await cacheDirectory(project);
  // Freeze the invocation environment. Hash relevant execution settings without
  // writing environment values, proxy credentials or configuration paths.
  const executionEnv = Object.fromEntries(Object.entries(env).filter(([, value]) => typeof value === "string"));
  const environment = environmentIdentity(executionEnv);
  const paths = Object.fromEntries(await Promise.all(TOOLS.map(async (name) =>
    [name, await findRuntimeExecutable(name, { env: executionEnv, binDirectory })])));
  const identities = Object.fromEntries(await Promise.all(TOOLS.map(async (name) => [name, await fileIdentity(paths[name])])));
  const nodeIdentity = await fileIdentity(process.execPath);
  const fingerprint = hash({ format: FORMAT, schemaVersion: SCHEMA, platform: process.platform, arch: process.arch,
    node: { version: process.versions.node, identity: nodeIdentity },
    environment, identities });
  const localName = `local-${fingerprint}.json`;
  let local = await readCache(parent, localName);
  const cached = !refresh && plain(local) && local.format === FORMAT && local.schemaVersion === SCHEMA &&
    local.fingerprint === fingerprint && fresh(local.checkedAt, timestamp, localTtlMs) &&
    TOOLS.every((name) => validDependency(local.dependencies?.[name]));
  if (!cached) {
    const dependencies = {};
    for (const name of TOOLS) {
      cancelled(signal);
      if (!identities[name]) { dependencies[name] = { available: false, version: null, error: "not-found" }; continue; }
      try {
        const output = await probe(paths[name], name === "ffmpeg" ? ["-version"] : ["--ignore-config", "--version"],
          { env: executionEnv, cwd: resolve(project), signal, timeout: probeTimeout });
        cancelled(signal);
        const version = versionOf(name, output);
        if (!version) throw fail("PROBE_FAILED", "工具版本输出无效。");
        dependencies[name] = { available: true, version };
      } catch (error) {
        cancelled(signal);
        if (["CANCELLED", "PROCESS_UNCONFIRMED"].includes(error.code)) throw error;
        dependencies[name] = { available: false, version: null, error:
          error.code === "TIMEOUT" ? "timeout" : error.code === "OUTPUT_TOO_LARGE" ? "output-too-large" : "probe-failed" };
      }
    }
    cancelled(signal);
    // A replaced executable cannot turn this probe into a cache for the new file.
    const after = Object.fromEntries(await Promise.all(TOOLS.map(async (name) => [name, await fileIdentity(paths[name])])));
    if (hash(after) !== hash(identities)) throw fail("ENVIRONMENT_CHANGED", "检测期间工具发生变化，请重试。");
    local = { format: FORMAT, schemaVersion: SCHEMA, fingerprint, checkedAt, dependencies };
    await writeCache(parent, localName, local);
  }
  const dependencies = Object.fromEntries(TOOLS.map((name) => [name, {
    available: local.dependencies[name].available, path: paths[name], version: local.dependencies[name].version,
    ...(local.dependencies[name].error ? { error: local.dependencies[name].error } : {}),
  }]));
  const [major, minor] = process.versions.node.split(".").map(Number);
  const result = { ready: (major > 20 || major === 20 && minor >= 10) && TOOLS.every((name) => dependencies[name].available),
    node: { version: process.versions.node, path: process.execPath }, dependencies, checkedAt: local.checkedAt, cached: Boolean(cached) };
  if (includeLatest) {
    const latestFingerprint = hash({ format: FORMAT, schemaVersion: SCHEMA, source: LATEST_URL,
      environment });
    const latestName = `latest-${latestFingerprint}.json`;
    let latest = await readCache(parent, latestName);
    const valid = !refresh && plain(latest) && latest.format === FORMAT && latest.schemaVersion === SCHEMA &&
      latest.fingerprint === latestFingerprint && fresh(latest.checkedAt, timestamp, latestTtlMs) &&
      (typeof latest.version === "string" && /^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/u.test(latest.version) ||
        latest.version === null && latest.error === "latest-unavailable");
    if (!valid) {
      latest = { format: FORMAT, schemaVersion: SCHEMA, fingerprint: latestFingerprint, checkedAt, version: null };
      try {
        latest.version = await latestRelease({ fetcher, signal, timeout: latestTimeout });
      } catch {
        cancelled(signal);
        latest.error = "latest-unavailable";
      }
      cancelled(signal);
      await writeCache(parent, latestName, latest);
    }
    result.latest = { version: latest.version, checkedAt: latest.checkedAt,
      ...(latest.error ? { error: latest.error } : {}), cached: Boolean(valid) };
  }
  cancelled(signal);
  return { format: FORMAT, schemaVersion: SCHEMA, ok: true, result };
}

export async function main(input, { project = process.cwd(), ...options } = {}) {
  if (!plain(input) || Object.keys(input).some((key) => !["action", "includeLatest"].includes(key)) ||
      !["get", "refresh"].includes(input.action) ||
      input.includeLatest !== undefined && typeof input.includeLatest !== "boolean")
    throw fail("INVALID_ARGUMENT", "环境请求只支持 get/refresh 和 includeLatest。");
  return getEnvironment(project, { ...options, refresh: input.action === "refresh", includeLatest: input.includeLatest === true });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGTERM", cancel);
  process.once("SIGINT", cancel);
  try {
    if (process.argv.length !== 2) throw fail("INVALID_ARGUMENT", "环境入口不接受命令行参数。");
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > CACHE_LIMIT) throw fail("INVALID_ARGUMENT", "环境请求过大。");
      chunks.push(chunk);
    }
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw fail("INVALID_ARGUMENT", "环境请求不是有效 JSON。"); }
    process.stdout.write(JSON.stringify(await main(input, { signal: controller.signal })) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({ format: FORMAT, schemaVersion: SCHEMA, ok: false,
      error: { code: error.code || "ENVIRONMENT_FAILED", message:
        /^[A-Z_]+$/u.test(error.code || "") ? error.message : "环境检测失败。" } }) + "\n");
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGTERM", cancel);
    process.removeListener("SIGINT", cancel);
  }
}
