import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rm, rmdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from "node:path";

export const CLI_DIRECTORY = ".mimi-download-cli";
export const HEARTBEAT_TIMEOUT_MS = 30_000;
export const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "interrupted"]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const STATUSES = new Set(["pending", "queued", "running", ...TERMINAL_STATUSES]);
const MAX_RECORD_BYTES = 128 * 1024;
export const cliError = (code, message) => Object.assign(new Error(message), { code });
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;

export function cliJobId(value) {
  if (typeof value !== "string" || !UUID.test(value))
    throw cliError("INVALID_JOB", "任务 ID 必须是本 CLI 返回的 UUID。");
  return value;
}

export function cliRequestKey(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 160 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    throw cliError("INVALID_ARGUMENT", "requestKey 必须是 1–160 字符且不含控制字符。");
  return value;
}

function requestId(key) {
  const hex = createHash("sha256")
    .update("mimi-download:request:v1:" + key)
    .digest("hex");
  // Keep the existing UUID-v4-shaped task directory format. The full request
  // key is checked on read so a hash collision never admits different work.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// Resolve explicit directories without following any user-controlled symlink.
export async function checkedDirectory(value, { create = false } = {}) {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    /[\u0000-\u001f]/u.test(value) ||
    value.split(/[\\/]/).includes("..")
  )
    throw cliError("UNSAFE_PATH", "请使用不含跳级路径的完整目录路径。");
  const absolute = resolve(value),
    root = parse(absolute).root;
  let cursor = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    if (create)
      await mkdir(cursor, { mode: 0o700 }).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
    const info = await lstat(cursor);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw cliError("UNSAFE_PATH", "目录包含符号链接或不是普通目录。");
  }
  if ((await realpath(absolute)) !== absolute)
    throw cliError("UNSAFE_PATH", "目录实际位置与提供的路径不同。");
  return absolute;
}

async function jsonFile(path, limit = MAX_RECORD_BYTES, retry = 0) {
  const info = await lstat(path);
  // An atomic replacement can retire the inode between pathname lookup and
  // stat completion. Retry only that zero-link race; actual hardlinks still fail.
  if (info.isFile() && !info.isSymbolicLink() && info.nlink === 0 && retry < 3)
    return jsonFile(path, limit, retry + 1);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > limit)
    throw cliError("UNSAFE_RECORD", "任务文件无效、过大或包含链接。");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!same(info, opened)) {
      if (retry >= 3) throw cliError("RECORD_BUSY", "任务记录正在更新，请重试读取。");
      return await jsonFile(path, limit, retry + 1);
    }
    const bytes = await handle.readFile();
    if (bytes.length > limit) throw cliError("UNSAFE_RECORD", "任务文件过大。");
    // Writers atomically replace task.json. An already-open independent regular
    // file remains a coherent snapshot; reject links, but allow a newer inode.
    const named = await lstat(path);
    if (named.isFile() && !named.isSymbolicLink() && named.nlink === 0 && retry < 3)
      return jsonFile(path, limit, retry + 1);
    if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1)
      throw cliError("UNSAFE_RECORD", "任务文件已替换为链接或非普通文件。");
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw cliError("INVALID_RECORD", "任务文件不是有效 JSON。");
    }
  } finally {
    await handle.close();
  }
}

async function privateDirectory(path) {
  const directory = await checkedDirectory(path),
    info = await lstat(directory);
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0)
    throw cliError("UNSAFE_PATH", "CLI 数据目录必须仅当前用户可访问。");
  return directory;
}

async function atomicJson(directory, name, value) {
  const content = JSON.stringify(value) + "\n";
  if (Buffer.byteLength(content) > MAX_RECORD_BYTES)
    throw cliError("RECORD_TOO_LARGE", "任务记录过大。");
  const identity = await lstat(directory),
    temporary = join(directory, `.write-${randomUUID()}.tmp`);
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    await handle.writeFile(content);
    await handle.sync();
    if (!same(identity, await lstat(directory))) throw cliError("UNSAFE_PATH", "任务目录已替换。");
    const target = join(directory, name);
    const existing = await lstat(target).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1))
      throw cliError("UNSAFE_RECORD", "任务目标不是独立普通文件。");
    await rename(temporary, target);
  } finally {
    await handle.close();
    await rm(temporary, { force: true });
  }
}

async function recoverLock(path, expected, verifyOwner) {
  // A sibling recovery lock serializes reclaimers even while the old named lock
  // is removed and a new writer acquires that name. Never remove a cached path.
  const recovery = join(dirname(path), `.recover-${basename(path)}`);
  try {
    await mkdir(recovery, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
  const recoveryIdentity = await lstat(recovery);
  try {
    const current = await lstat(path).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (!current || !same(expected, current) || current.isSymbolicLink()) return false;
    const owner = await jsonFile(join(path, "owner.json"));
    if (!(await verifyOwner(owner))) return false;
    if (!same(expected, await lstat(path))) return false;
    const retired = join(dirname(path), `.recovered-${randomUUID()}`);
    await rename(path, retired);
    await rm(join(retired, "owner.json"));
    await rmdir(retired);
    return true;
  } finally {
    if (!same(recoveryIdentity, await lstat(recovery)))
      throw cliError("LOCK_CHANGED", "恢复锁已改变，未删除其他进程的锁。");
    await rmdir(recovery);
  }
}

async function directoryLock(directory, name, operation) {
  const path = join(directory, name),
    deadline = Date.now() + 5000;
  let identity;
  for (;;) {
    try {
      await mkdir(path, { mode: 0o700 });
      identity = await lstat(path);
      await atomicJson(path, "owner.json", { pid: process.pid });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const info = await lstat(path).catch((failure) => {
        if (failure.code !== "ENOENT") throw failure;
        return null;
      });
      if (!info) continue;
      if (!info.isDirectory() || info.isSymbolicLink())
        throw cliError("UNSAFE_PATH", "任务锁无效。");
      const owner = await jsonFile(join(path, "owner.json")).catch(() => null);
      if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) {
        let dead = false;
        try {
          process.kill(owner.pid, 0);
        } catch (failure) {
          dead = failure.code === "ESRCH";
        }
        if (
          dead &&
          (await recoverLock(path, info, async (current) => {
            if (current.pid !== owner.pid) return false;
            try {
              process.kill(current.pid, 0);
              return false;
            } catch (failure) {
              return failure.code === "ESRCH";
            }
          }))
        ) {
          // This short record lock never owns subprocesses. Only a confirmed
          // dead writer and the same directory inode permit stale-lock cleanup.
          continue;
        }
      }
      if (Date.now() >= deadline)
        throw cliError(
          "JOB_BUSY",
          "无法确认任务写锁已释放。请核查 CLI 进程；无有效 owner 的锁需人工确认后恢复。",
        );
      await new Promise((resolveWait) => setTimeout(resolveWait, 40));
    }
  }
  try {
    return await operation();
  } finally {
    const current = await lstat(path).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (!current || !same(identity, current))
      throw cliError("LOCK_CHANGED", "任务锁已改变，未删除其他进程的锁。");
    await rm(join(path, "owner.json"));
    await rmdir(path);
  }
}

function validateRecord(record, id) {
  if (
    !record ||
    record.schemaVersion !== 1 ||
    record.id !== id ||
    !STATUSES.has(record.status) ||
    !Number.isSafeInteger(record.attempt) ||
    record.attempt < 1 ||
    typeof record.url !== "string" ||
    typeof record.createdAt !== "number" ||
    typeof record.updatedAt !== "number" ||
    !record.request ||
    typeof record.outputDirectory !== "string"
  )
    throw cliError("INVALID_RECORD", "任务记录格式无效。");
  return record;
}

function visibleRecord(record, now = Date.now()) {
  const heartbeat = record.heartbeatAt || record.updatedAt;
  return ["queued", "running"].includes(record.status) && now - heartbeat > HEARTBEAT_TIMEOUT_MS
    ? {
        ...record,
        status: "interrupted",
        error: {
          code: "HEARTBEAT_EXPIRED",
          message: "任务心跳已过期；确认原进程结束后可明确重试。",
        },
      }
    : record;
}

const configurationFields = [
  "format",
  "playlist",
  "playlistItems",
  "playlistEnd",
  "subtitles",
  "subtitleMode",
  "subtitleLanguages",
  "embedSubtitles",
];
const fileFields = [
  "path",
  "name",
  "bytes",
  "sha256",
  "mimeType",
  "modifiedAt",
  "status",
  "checkedAt",
];
export function publicCliRecord(record, now = Date.now()) {
  const current = visibleRecord(record, now),
    result = {};
  for (const key of [
    "schemaVersion",
    "id",
    "status",
    "attempt",
    "url",
    "title",
    "outputDirectory",
    "createdAt",
    "queuedAt",
    "updatedAt",
    "heartbeatAt",
    "startedAt",
    "finishedAt",
    "cancelRequestedAt",
    "archivedAt",
    "checkedAt",
    "requestKey",
  ])
    if (current[key] !== undefined) result[key] = current[key];
  result.source = ["cli", "chat", "panel"].includes(current.source) ? current.source : "cli";
  result.configuration = {};
  for (const key of configurationFields)
    if (current.request?.configuration?.[key] !== undefined)
      result.configuration[key] = current.request.configuration[key];
  if (typeof current.request?.copySuffix === "string" && current.request.copySuffix)
    result.copySuffix = current.request.copySuffix;
  if (current.progress && typeof current.progress === "object") {
    result.progress = {};
    for (const key of ["stage", "fraction", "message"])
      if (current.progress[key] !== undefined) result.progress[key] = current.progress[key];
  }
  if (current.error) result.error = { code: current.error.code, message: current.error.message };
  else result.error = null;
  result.files = (Array.isArray(current.files) ? current.files : []).slice(0, 200).map((file) => {
    const item = {};
    for (const key of fileFields) if (file[key] !== undefined) item[key] = file[key];
    return item;
  });
  return result;
}

const defaultQueue = () => ({
  schemaVersion: 1,
  revision: 0,
  paused: false,
  maxConcurrent: 2,
  slots: [],
});
function validateQueue(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    typeof value.paused !== "boolean" ||
    !Number.isSafeInteger(value.maxConcurrent) ||
    value.maxConcurrent < 1 ||
    value.maxConcurrent > 4 ||
    !Array.isArray(value.slots) ||
    value.slots.length > 128 ||
    value.slots.some(
      (slot) =>
        !slot ||
        !UUID.test(slot.id) ||
        !UUID.test(slot.token) ||
        !Number.isSafeInteger(slot.attempt) ||
        slot.attempt < 1 ||
        !Number.isSafeInteger(slot.pid) ||
        slot.pid < 1,
    )
  )
    throw cliError("INVALID_QUEUE", "项目下载队列记录无效，未覆盖原记录。");
  if (new Set(value.slots.map((slot) => slot.id)).size !== value.slots.length)
    throw cliError("INVALID_QUEUE", "项目下载队列包含重复执行槽位。");
  return value;
}

function publicQueue(value) {
  return {
    revision: value.revision,
    paused: value.paused,
    maxConcurrent: value.maxConcurrent,
    active: value.slots.length,
  };
}

export async function createCliStore(project, { create = false } = {}) {
  const root = await checkedDirectory(project),
    identity = await lstat(root);
  const directory = join(root, CLI_DIRECTORY),
    jobsDirectory = join(directory, "jobs");
  const verify = async () => {
    if (!same(identity, await lstat(root))) throw cliError("PROJECT_CHANGED", "项目目录已改变。");
    await checkedDirectory(root);
  };
  const taskDirectory = async (id) => {
    cliJobId(id);
    await verify();
    await privateDirectory(directory);
    await privateDirectory(jobsDirectory);
    return privateDirectory(join(jobsDirectory, id));
  };
  if (create) {
    await checkedDirectory(jobsDirectory, { create: true });
    await privateDirectory(directory);
    await privateDirectory(jobsDirectory);
    await verify();
  }
  const read = async (id) =>
    validateRecord(await jsonFile(join(await taskDirectory(id), "task.json")), id);
  const readQueue = async () => {
    await verify();
    try {
      await privateDirectory(directory);
      return validateQueue(await jsonFile(join(directory, "queue.json")));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return defaultQueue();
    }
  };
  const queueOperation = (operation) =>
    directoryLock(directory, ".queue.lock", async () => {
      const queue = await readQueue();
      const result = await operation(queue);
      await verify();
      await privateDirectory(directory);
      return result;
    });
  async function createRecord(
    request,
    outputDirectory,
    {
      id = randomUUID(),
      source = "cli",
      requestKey,
      requestDigest,
      pending = false,
      title = "",
    } = {},
  ) {
    await checkedDirectory(jobsDirectory, { create: true });
    await privateDirectory(directory);
    await privateDirectory(jobsDirectory);
    await verify();
    const task = join(jobsDirectory, id),
      now = Date.now();
    await mkdir(task, { mode: 0o700 });
    const record = {
      schemaVersion: 1,
      id,
      status: pending ? "pending" : "queued",
      attempt: 1,
      url: request.url,
      title,
      request,
      outputDirectory,
      source,
      ...(requestKey === undefined ? {} : { requestKey, requestDigest }),
      createdAt: now,
      ...(pending ? {} : { queuedAt: now }),
      updatedAt: now,
      heartbeatAt: now,
      progress: { stage: "queued", fraction: 0, message: "等待下载 worker。" },
      files: [],
    };
    await atomicJson(task, "task.json", record);
    return record;
  }
  return {
    project: root,
    directory,
    jobsDirectory,
    verify,
    taskDirectory,
    read,
    async getQueue() {
      return publicQueue(await readQueue());
    },
    async configureQueue({ expectedRevision, paused, maxConcurrent }) {
      if (
        !Number.isSafeInteger(expectedRevision) ||
        expectedRevision < 0 ||
        typeof paused !== "boolean" ||
        !Number.isSafeInteger(maxConcurrent) ||
        maxConcurrent < 1 ||
        maxConcurrent > 4
      )
        throw cliError(
          "INVALID_ARGUMENT",
          "队列需要有效 expectedRevision、paused 和 1–4 的 maxConcurrent。",
        );
      return queueOperation(async (queue) => {
        if (queue.revision !== expectedRevision)
          throw cliError("QUEUE_CONFLICT", "其他页面或 CLI 已修改队列，请刷新后再操作。");
        const next = { ...queue, revision: queue.revision + 1, paused, maxConcurrent };
        await atomicJson(directory, "queue.json", next);
        return publicQueue(next);
      });
    },
    async admitWorker(id, attempt, token) {
      cliJobId(id);
      return queueOperation(async (queue) => {
        const slot = queue.slots.find((value) => value.id === id);
        if (slot) {
          if (slot.attempt !== attempt || slot.token !== token || slot.pid !== process.pid)
            throw cliError("JOB_BUSY", "任务仍占有旧执行槽位，请核查原 worker。");
          return true;
        }
        if (queue.paused || queue.slots.length >= queue.maxConcurrent) return false;
        const own = await read(id);
        if (
          own.attempt !== attempt ||
          own.workerToken !== token ||
          own.status !== "queued" ||
          own.archivedAt ||
          own.cancelRequestedAt
        )
          throw cliError("WORKER_REJECTED", "等待中的任务已改变，不能开始执行。");
        const entries = await readdir(jobsDirectory, { withFileTypes: true });
        if (entries.length > 1000)
          throw cliError("OUTPUT_LIMIT", "项目任务过多，请先归档或整理旧任务。");
        const candidates = [];
        for (const entry of entries) {
          if (!UUID.test(entry.name)) continue;
          let record;
          try {
            record = await read(entry.name);
          } catch {
            // A concurrent create can expose its directory before task.json is
            // committed; corrupt history must not poison unrelated admission.
            // listCliJobs reports these records as warnings. Existing slots
            // remain counted independently and are never reclaimed here.
            continue;
          }
          if (
            record.status === "queued" &&
            record.workerToken &&
            !queue.slots.some((slot) => slot.id === record.id) &&
            !record.cancelRequestedAt &&
            !record.archivedAt &&
            Date.now() - (record.heartbeatAt || record.updatedAt) <= HEARTBEAT_TIMEOUT_MS
          )
            candidates.push(record);
        }
        candidates.sort(
          (a, b) =>
            (a.queuedAt ?? a.createdAt) - (b.queuedAt ?? b.createdAt) || a.id.localeCompare(b.id),
        );
        const available = queue.maxConcurrent - queue.slots.length;
        if (!candidates.slice(0, available).some((value) => value.id === id)) return false;
        const next = {
          ...queue,
          slots: [...queue.slots, { id, attempt, token, pid: process.pid }],
        };
        await atomicJson(directory, "queue.json", next);
        return true;
      });
    },
    // Only the worker owning this exact receipt calls this after confirming its
    // process tree exited. Dead PIDs and expired heartbeats never free slots.
    async releaseSlot(id, attempt, token) {
      return queueOperation(async (queue) => {
        const slot = queue.slots.find((value) => value.id === id);
        if (!slot) return;
        if (slot.attempt !== attempt || slot.token !== token || slot.pid !== process.pid)
          throw cliError("JOB_BUSY", "执行槽位不属于当前 worker，未释放。");
        await atomicJson(directory, "queue.json", {
          ...queue,
          slots: queue.slots.filter((value) => value !== slot),
        });
      });
    },
    create: createRecord,
    async createOrGet(
      request,
      outputDirectory,
      { requestKey, source = "cli", pending = false, title = "" },
    ) {
      cliRequestKey(requestKey);
      if (!["cli", "chat", "panel"].includes(source))
        throw cliError("INVALID_ARGUMENT", "source 必须是 cli/chat/panel。");
      const id = requestId(requestKey),
        requestDigest = createHash("sha256")
          .update(JSON.stringify({ request, outputDirectory, source, pending, title }))
          .digest("hex");
      await privateDirectory(jobsDirectory);
      return directoryLock(jobsDirectory, `.submit-${id}.lock`, async () => {
        await verify();
        const exists = await lstat(join(jobsDirectory, id)).catch((error) => {
          if (error.code !== "ENOENT") throw error;
          return null;
        });
        if (exists) {
          let record;
          try {
            record = await read(id);
          } catch (cause) {
            throw Object.assign(
              cliError(
                "SUBMISSION_UNCERTAIN",
                "原提交目录存在但回执不可读，请核查此任务，不能重新下载。",
              ),
              { jobId: id, cause },
            );
          }
          if (record.requestKey !== requestKey || record.requestDigest !== requestDigest)
            throw Object.assign(cliError("REQUEST_CONFLICT", "requestKey 已用于不同的下载请求。"), {
              jobId: id,
            });
          return { record, created: false };
        }
        return {
          record: await createRecord(request, outputDirectory, {
            id,
            source,
            requestKey,
            requestDigest,
            pending,
            title,
          }),
          created: true,
        };
      });
    },
    async update(id, operation) {
      const task = await taskDirectory(id);
      return directoryLock(task, ".write.lock", async () => {
        const record = await read(id),
          next = await operation(record);
        if (!next) return record;
        validateRecord(next, id);
        await verify();
        await checkedDirectory(task);
        await atomicJson(task, "task.json", next);
        return next;
      });
    },
    async claimWorker(id, attempt, token, { detachedGroup = false } = {}) {
      const task = await taskDirectory(id),
        path = join(task, ".worker.lock");
      try {
        await mkdir(path, { mode: 0o700 });
      } catch (error) {
        if (error.code === "EEXIST")
          throw cliError("JOB_BUSY", "此任务已有 worker；请检查状态后重试。");
        throw error;
      }
      const lockIdentity = await lstat(path);
      await atomicJson(path, "owner.json", { pid: process.pid, attempt, token, detachedGroup });
      return async () => {
        const current = await lstat(path);
        if (!same(lockIdentity, current)) throw cliError("LOCK_CHANGED", "Worker 锁已替换。");
        await rm(join(path, "owner.json"));
        await rmdir(path);
      };
    },
    async verifyNoWorker(id) {
      const task = await taskDirectory(id),
        path = join(task, ".worker.lock");
      const identity = await lstat(path).catch((error) => {
        if (error.code !== "ENOENT") throw error;
        return null;
      });
      if (!identity) return;
      if (!identity.isDirectory() || identity.isSymbolicLink())
        throw cliError("UNSAFE_PATH", "Worker 锁无效。");
      const owner = await jsonFile(join(path, "owner.json"));
      if (!Number.isSafeInteger(owner.pid) || owner.pid < 1)
        throw cliError("JOB_BUSY", "无法确认旧 worker 已退出，请检查任务锁。");
      try {
        process.kill(owner.pid, 0);
        throw cliError("JOB_BUSY", "原 worker 仍在运行；请取消或等待它退出后重试。");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
      // A worker can crash before recording its own detached downloader group.
      // Its dead PID or empty process group cannot prove every child exited.
      // Only the live worker releases this lock after confirming its children.
      throw cliError(
        "JOB_BUSY",
        "原 worker 已退出，但无法确认下载子进程或进程组全部结束。worker 锁已保留；请核查原进程树后人工恢复，再明确重试。",
      );
    },
  };
}

// Pure read APIs used by the Panel's authorized-directory bridge. Never create,
// migrate, save, or infer Host tasks/resources while listing CLI-owned records.
export async function listCliJobs(project, { limit = 100, includeArchived = false } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw cliError("INVALID_ARGUMENT", "limit 必须在 1–1000 之间。");
  if (typeof includeArchived !== "boolean")
    throw cliError("INVALID_ARGUMENT", "includeArchived 必须是布尔值。");
  const store = await createCliStore(project);
  let entries;
  try {
    await checkedDirectory(store.jobsDirectory);
    entries = await readdir(store.jobsDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {
      format: "mimi-download.cli.jobs",
      schemaVersion: 1,
      project: store.project,
      jobs: [],
      truncated: false,
    };
  }
  const jobs = [],
    warnings = [];
  for (const entry of entries.slice(0, 1000)) {
    if (!UUID.test(entry.name)) continue;
    try {
      if (!entry.isDirectory() || entry.isSymbolicLink())
        throw cliError("UNSAFE_RECORD", "任务目录包含链接。");
      const record = await store.read(entry.name);
      if (includeArchived || !record.archivedAt) jobs.push(publicCliRecord(record));
    } catch (error) {
      warnings.push({ id: entry.name, code: error.code || "INVALID_RECORD" });
    }
  }
  const active = new Set(["pending", "queued", "running", "cancelling"]);
  jobs.sort(
    (a, b) =>
      Number(active.has(b.status)) - Number(active.has(a.status)) ||
      b.createdAt - a.createdAt ||
      a.id.localeCompare(b.id),
  );
  await store.verify();
  return {
    format: "mimi-download.cli.jobs",
    schemaVersion: 1,
    project: store.project,
    jobs: jobs.slice(0, limit),
    truncated: jobs.length > limit || entries.length > 1000,
    ...(warnings.length ? { warnings } : {}),
  };
}

export async function getCliJob(project, id) {
  return publicCliRecord(await (await createCliStore(project)).read(cliJobId(id)));
}

export async function requestCliCancellation(project, id) {
  const store = await createCliStore(project);
  await store.update(cliJobId(id), (record) =>
    TERMINAL_STATUSES.has(record.status)
      ? null
      : {
          ...record,
          ...(!record.workerToken && ["pending", "queued"].includes(record.status)
            ? { status: "cancelled", finishedAt: Date.now() }
            : {}),
          cancelRequestedAt: Date.now(),
          updatedAt: Date.now(),
        },
  );
  return getCliJob(project, id);
}
