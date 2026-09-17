import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { readLocalSnapshot, writeLocalSnapshot } from "./local-snapshot-store.mjs";
import { SELECTION_SCAN_LIMITS } from "../selection-scan-contract.mjs";
import { retryAfterFailure, restoreSourceRetry, sourceRetryDue, sourceRetryErrorCode,
  sourceRetryPending } from "./selection-source-retry.mjs";

const STREAM = "a-share-selection-announcements";
const SYMBOL = /^(?:SH6\d{5}|SZ[03]\d{5})$/u;
const TTL_MS = 30 * 60 * 1_000;

async function announcementLockPath(root, symbol) {
  if (!SYMBOL.test(symbol)) throw new Error("公告缓存股票代码无效");
  let directory = await realpath(resolve(root));
  for (const segment of ["snapshots", STREAM, symbol]) {
    directory = resolve(directory, segment);
    await mkdir(directory, { mode: 0o700 }).catch((error) => { if (error.code !== "EEXIST") throw error; });
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(directory) !== directory) {
      throw new Error("公告缓存路径无效");
    }
  }
  return resolve(directory, ".announcement-write.lock");
}

async function readLock(path) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > 1_024) throw new Error("公告缓存写锁无效");
    const text = await handle.readFile("utf8");
    let value = null;
    try { value = JSON.parse(text); } catch { /* Exclusive create may precede the owner write. */ }
    return { ...value, modifiedAt: metadata.mtimeMs };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  } finally { await handle?.close(); }
}

async function withAnnouncementWriteLock(root, symbol, operation) {
  const path = await announcementLockPath(root, symbol);
  const token = randomUUID();
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    let handle;
    try {
      handle = await open(path, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, token }));
      await handle.close();
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (error.code !== "EEXIST") throw error;
      const owner = await readLock(path);
      if (!owner) continue;
      let dead = false;
      if (Number.isInteger(owner.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0); }
        catch (checkError) { dead = checkError.code === "ESRCH"; }
      } else dead = Date.now() - owner.modifiedAt > 30_000;
      if (dead) {
        const current = await readLock(path);
        if (current && current.token === owner.token && current.modifiedAt === owner.modifiedAt) {
          await unlink(path).catch(() => undefined);
        }
      } else await new Promise((done) => setTimeout(done, 20));
      continue;
    }
    try { return await operation(); }
    finally {
      if ((await readLock(path))?.token === token) await unlink(path).catch(() => undefined);
    }
  }
  throw Object.assign(new Error("公告缓存正在更新，请稍后重试"), { code: "ANNOUNCEMENT_CACHE_BUSY" });
}

function keepExisting(existing, incoming) {
  if (existing?.kind !== "a-share-selection-announcements" || existing.schemaVersion !== 1 ||
      existing.symbol !== incoming.symbol || !Number.isFinite(Date.parse(existing.generatedAt)) ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(existing.marketDate) || typeof existing.session?.provisional !== "boolean" ||
      !["ready", "failed"].includes(existing.status) ||
      (existing.status === "ready" && !Array.isArray(existing.events))) return false;
  if (existing.marketDate !== incoming.marketDate) return existing.marketDate > incoming.marketDate;
  if (existing.session.provisional !== incoming.session.provisional) return existing.session.provisional === false;
  const previousAt = Date.parse(existing.generatedAt);
  const incomingAt = Date.parse(incoming.generatedAt);
  return previousAt > incomingAt || (previousAt === incomingAt && existing.status === "ready" && incoming.status === "failed");
}

async function persistAnnouncement({ root, symbol, snapshot, readSnapshot, writeSnapshot }) {
  // Only serialize publication. Slow provider requests never hold this lock.
  return withAnnouncementWriteLock(root, symbol, async () => {
    const latest = await readSnapshot({ root, stream: STREAM, scope: symbol }).catch((error) => {
      if (["LOCAL_SNAPSHOT_MISSING", "ENOENT"].includes(error.code)) return null;
      throw error;
    });
    if (keepExisting(latest, snapshot)) return latest;
    await writeSnapshot({ root, stream: STREAM, scope: symbol, snapshot });
    return snapshot;
  });
}

export async function collectSelectionAnnouncements({
  symbols,
  prioritySymbols = [],
  marketDate,
  provisional,
  persistent = true,
  continueScan = false,
  root = process.cwd(),
  now = new Date(),
  fetchAnnouncements,
  deadlineMs = Date.now() + 30_000,
  readSnapshot = readLocalSnapshot,
  writeSnapshot = writeLocalSnapshot,
}) {
  const requested = [...new Set(symbols.filter((symbol) => SYMBOL.test(symbol)))];
  const priorities = new Map([...new Set(prioritySymbols.filter((symbol) => SYMBOL.test(symbol)))].map((symbol, index) => [symbol, index]));
  const announcements = new Map();
  const failures = new Map();
  const jobs = [];
  const unresolved = new Map();
  const nowMs = now.getTime();
  const startedAt = Date.now();
  const currentTime = () => nowMs + Math.max(0, Date.now() - startedAt);
  const adopt = (symbol, record) => {
    announcements.delete(symbol);
    failures.delete(symbol);
    unresolved.delete(symbol);
    if (record.status === "ready") announcements.set(symbol, record.events);
    else {
      const retry = restoreSourceRetry(record, currentTime());
      const failure = { reason: record.reason || "ANNOUNCEMENT_FAILED", retry };
      failures.set(symbol, failure);
      if (sourceRetryPending(retry)) unresolved.set(symbol, retry);
    }
  };
  for (const symbol of requested) {
    const cached = persistent
      ? await readSnapshot({ root, stream: STREAM, scope: symbol }).catch(() => null)
      : null;
    const cachedAt = Date.parse(cached?.generatedAt);
    const compatible = cached?.kind === "a-share-selection-announcements" && cached?.schemaVersion === 1 &&
      cached?.marketDate === marketDate &&
      cached?.session?.provisional === provisional && cached?.symbol === symbol &&
      Number.isFinite(cachedAt) && now.getTime() >= cachedAt;
    if (compatible && now.getTime() - cachedAt < TTL_MS && cached.status === "ready" && Array.isArray(cached.events)) {
      announcements.set(symbol, cached.events);
    } else if (compatible && continueScan && cached.status === "failed") {
      adopt(symbol, cached);
      if (sourceRetryDue(failures.get(symbol).retry, nowMs)) jobs.push({ symbol, cachedAt });
    } else {
      unresolved.set(symbol, null);
      jobs.push({ symbol, cachedAt: compatible ? cachedAt : -Infinity });
    }
  }

  // New names come first, then the oldest successful checks. Long scans must
  // refresh stale evidence without starving names beyond the first batch.
  jobs.sort((a, b) => (priorities.get(a.symbol) ?? Infinity) - (priorities.get(b.symbol) ?? Infinity) ||
    a.cachedAt - b.cachedAt || a.symbol.localeCompare(b.symbol));
  let cursor = 0;
  let batchChecked = 0;
  const batch = jobs.slice(0, SELECTION_SCAN_LIMITS.announcementBatchSize);
  await Promise.all(Array.from({ length: Math.min(3, batch.length) }, async () => {
    while (cursor < batch.length && Date.now() < deadlineMs) {
      const { symbol } = batch[cursor++];
      let record;
      try {
        const events = await fetchAnnouncements(symbol, now);
        if (!Array.isArray(events)) throw Object.assign(new Error("公告返回格式无效"), { code: "ANNOUNCEMENT_FORMAT_INVALID" });
        record = { status: "ready", events };
        batchChecked += 1;
      } catch (error) {
        const reason = sourceRetryErrorCode(error?.code ? error : { code: "ANNOUNCEMENT_FAILED", message: error?.message });
        record = { status: "failed", events: [], reason,
          retry: retryAfterFailure({ code: reason }, continueScan ? failures.get(symbol)?.retry : null, currentTime()) };
      }
      adopt(symbol, record);
      if (persistent) {
        const retained = await persistAnnouncement({
          root, symbol, readSnapshot, writeSnapshot,
          snapshot: {
            kind: "a-share-selection-announcements", schemaVersion: 1,
            symbol, marketDate, generatedAt: now.toISOString(),
            session: { phase: provisional ? "intraday" : "close", provisional, previousClose: false },
            ...record,
          },
        });
        if (retained.marketDate === marketDate && retained.session?.provisional === provisional) {
          adopt(symbol, retained);
        }
      }
    }
  }));
  const completedAt = currentTime();
  const pendingTimes = [...unresolved.values()].map((retry) => Math.max(completedAt, Date.parse(retry?.nextRetryAt) || 0));
  const nextRetryAt = pendingTimes.length && Math.min(...pendingTimes) > completedAt
    ? new Date(Math.min(...pendingTimes)).toISOString() : null;
  return {
    announcements,
    requested: requested.length,
    available: announcements.size,
    pending: unresolved.size,
    failed: [...failures.values()].filter((failure) => !sourceRetryPending(failure.retry)).length,
    nextRetryAt,
    batchRequests: cursor,
    batchChecked,
    sourceErrors: [...failures].map(([symbol, failure]) => ({
      source: "announcements", errorCode: failure.reason,
      message: sourceRetryPending(failure.retry) ? "个股公告暂未取得，已安排稍后自动重试" : "个股公告未取得，请手动重试后再核验", detail: symbol,
    })),
  };
}
