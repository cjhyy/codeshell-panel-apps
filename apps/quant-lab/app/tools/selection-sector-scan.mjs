import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, sep } from "node:path";

import { SELECTION_SCAN_LIMITS as LIMITS } from "../selection-scan-contract.mjs";
import { readUsableHistory, sanitizeHistoryBars } from "./a-share-history-cache.mjs";
import { fetchAllQuotesForNode, fetchHistory } from "./screen-a-shares.mjs";
import { retryAfterFailure, restoreSourceRetry, sourceRetryDue, sourceRetryErrorCode,
  sourceRetryPending, sourceRetryThrottled } from "./selection-source-retry.mjs";

const SYMBOL = /^(?:SH6|SZ[03])\d{5}$/u;
const MEMBER_SYMBOL = /^(?:SH|SZ)\d{6}$/u;
const NODE = /^new_[A-Za-z0-9]+$/u;
const MAX_FILE_BYTES = 1_000_000;

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function sourceError(source, error, detail = "") {
  return { source, errorCode: sourceRetryErrorCode(error),
    message: String(error?.message ?? "selection scan failed").replace(/[\r\n\t]/gu, " ").slice(0, 240),
    ...(detail ? { detail } : {}) };
}

function eligible(quote) {
  return quote && SYMBOL.test(quote.symbol) && typeof quote.name === "string" &&
    !/(?:ST|退)/iu.test(quote.name) && Number.isFinite(quote.price) && quote.price >= 2 &&
    Number.isFinite(quote.amount) && quote.amount >= 50_000_000 &&
    Number.isFinite(quote.floatMarketCap) && quote.floatMarketCap >= 2_000_000_000 &&
    Number.isFinite(quote.turnover) && quote.turnover >= 0.2 && quote.turnover <= 20;
}

async function safeDirectory(root, marketDate, provisional, namespace = null) {
  const base = await realpath(resolve(root));
  let directory = base;
  for (const segment of ["selection-sector-scan", "v1", marketDate, provisional ? "intraday" : "close", ...(namespace ? [namespace] : [])]) {
    directory = resolve(directory, segment);
    if (!directory.startsWith(`${base}${sep}`)) throw fail("SELECTION_CACHE_PATH_INVALID", "scan cache escaped its data root");
    await mkdir(directory, { mode: 0o700 }).catch((error) => { if (error.code !== "EEXIST") throw error; });
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(directory) !== directory) {
      throw fail("SELECTION_CACHE_PATH_INVALID", "scan cache directory must be local and must not be a symlink");
    }
  }
  return directory;
}

async function readJson(path) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > MAX_FILE_BYTES) throw fail("SELECTION_CACHE_FILE_INVALID", "scan cache file is invalid or too large");
    return JSON.parse(await handle.readFile("utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

async function atomicWrite(path, value) {
  const content = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw fail("SELECTION_CACHE_TOO_LARGE", "scan cache item exceeds its size bound");
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try { await rename(temporary, path); }
  finally { await unlink(temporary).catch(() => undefined); }
}

async function acquireLock(directory) {
  const path = resolve(directory, "scan.lock");
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle;
    try {
      handle = await open(path, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }));
      await handle.close();
      return async () => {
        const current = await readJson(path).catch(() => null);
        if (current?.token === token) await unlink(path).catch(() => undefined);
      };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (error.code !== "EEXIST") throw error;
      let current;
      try { current = await readJson(path); }
      catch (readError) {
        if (!(readError instanceof SyntaxError)) throw readError;
        const metadata = await lstat(path);
        if (metadata.isSymbolicLink() || !metadata.isFile() || Date.now() - metadata.mtimeMs < 120_000) {
          throw fail("SELECTION_SCAN_BUSY", "a selection batch is initializing; retry shortly");
        }
        // A terminated process can leave an empty file between exclusive create
        // and owner write. Give active initialization a grace period first.
        await unlink(path).catch(() => undefined);
        continue;
      }
      let ownerAlive = true;
      if (Number.isInteger(current?.pid) && current.pid > 0) {
        try { process.kill(current.pid, 0); }
        catch (checkError) { ownerAlive = checkError.code !== "ESRCH"; }
      }
      if (ownerAlive || attempt > 0) throw fail("SELECTION_SCAN_BUSY", "another selection batch is running; retry after it finishes");
      // A dead owner's lock can be recovered; verify identity before removing it.
      if ((await readJson(path))?.token === current.token) await unlink(path).catch(() => undefined);
    }
  }
  throw fail("SELECTION_SCAN_BUSY", "selection scan is already running");
}

function inspectBars(input, marketDate, provisional) {
  const values = Array.isArray(input) ? input : input?.bars;
  const adjustment = input?.adjustment ?? input?.adjust;
  if (adjustment && adjustment !== "qfq") return { reason: "HISTORY_BASIS" };
  if (!Array.isArray(values) || values.length > 2_000) return { reason: "HISTORY_BARS_INVALID" };
  const clean = sanitizeHistoryBars(values);
  if (clean.length !== values.length || clean.some((bar) => bar.date > marketDate)) return { reason: "HISTORY_BARS_INVALID" };
  const bars = (provisional ? clean.filter((bar) => bar.date < marketDate) : clean).slice(-180);
  if (bars.length < 61) return { reason: "HISTORY_SHORT" };
  const lastDate = bars.at(-1).date;
  const age = (Date.parse(marketDate) - Date.parse(lastDate)) / 86_400_000;
  if (provisional ? age < 1 || age > 10 : lastDate !== marketDate) return { reason: "HISTORY_DATE_STALE" };
  return { bars };
}

function usableBars(input, marketDate, provisional) {
  return inspectBars(input, marketDate, provisional).bars ?? null;
}

async function mapBounded(values, concurrency, callback, shouldStart = () => true) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length && shouldStart()) {
      const index = cursor++;
      await callback(values[index], index);
    }
  }));
}

function checkedMemberResult(value, industry) {
  if (!value || !Array.isArray(value.symbols) || typeof value.complete !== "boolean" ||
      value.symbols.length > LIMITS.membersPerSector || value.symbols.some((symbol) => !MEMBER_SYMBOL.test(symbol))) {
    throw fail("SECTOR_MEMBERS_INVALID", `invalid constituent identities for ${industry.id}`);
  }
  const symbols = [...new Set(value.symbols)].sort();
  if (value.complete && symbols.length < industry.count) throw fail("QUOTE_NODE_MEMBERS_MISSING", `industry ${industry.id} has ${symbols.length}/${industry.count} identities`);
  return { symbols, complete: value.complete, nextPage: Number.isInteger(value.nextPage) ? value.nextPage : 1,
    reason: value.reason ?? null };
}

export async function collectSelectionSectors({
  industries, quotes, marketDate, asOf, provisional = false, root = process.cwd(),
  persistent = true, continueScan = false, watchSymbols = [], cacheNamespace = null,
  fetchMembers = fetchAllQuotesForNode, readCached = readUsableHistory,
  loadHistory = async (symbol, date) => ({ bars: await fetchHistory(symbol, date), origin: "network" }),
  historyRequestVersion = 1,
  now = () => Date.now(), timeBudgetMs = 60_000, deadlineMs = null,
} = {}) {
  if (!validDate(marketDate) || typeof provisional !== "boolean" || !Number.isFinite(Date.parse(asOf))) {
    throw fail("SELECTION_SCAN_DATE_INVALID", "selection scan needs a valid market date, timestamp and phase");
  }
  if (![1, 2].includes(historyRequestVersion)) throw fail("HISTORY_REQUEST_VERSION_INVALID", "unsupported selection history request version");
  if (!Array.isArray(industries) || industries.length > LIMITS.sectors) throw fail("SECTOR_DIRECTORY_TOO_LARGE", "the complete industry directory exceeds the supported bound");
  if (cacheNamespace != null && !/^(sina|eastmoney|json-[0-9a-f]{16})$/.test(cacheNamespace)) throw fail("SELECTION_CACHE_PATH_INVALID", "invalid provider namespace");
  const directory = [...industries].sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
  const uniqueNodes = new Set();
  for (const industry of directory) {
    if (!NODE.test(industry?.id) || uniqueNodes.has(industry.id) || !Number.isInteger(industry.count) ||
        industry.count < 0 || industry.count > LIMITS.membersPerSector) {
      throw fail("SECTOR_DIRECTORY_INVALID", "industry directory contains duplicate identities or unsupported member counts");
    }
    uniqueNodes.add(industry.id);
  }
  const quoteValues = quotes instanceof Map ? [...quotes.values()] : quotes;
  if (!Array.isArray(quoteValues) || quoteValues.length > LIMITS.stocks) throw fail("QUOTE_UNIVERSE_TOO_LARGE", "current quote universe exceeds the supported bound");
  const currentQuotes = new Map(quoteValues.filter((quote) => SYMBOL.test(quote?.symbol)).map((quote) => [quote.symbol, quote]));
  if (!Array.isArray(watchSymbols) || watchSymbols.length > LIMITS.stocks || watchSymbols.some((symbol) => !SYMBOL.test(symbol))) {
    throw fail("WATCH_SYMBOLS_INVALID", "watched stock identities are invalid");
  }
  const watches = [...new Set(watchSymbols)];
  const budget = Number.isFinite(timeBudgetMs) ? Math.max(0, Math.min(60_000, timeBudgetMs)) : 60_000;
  const deadline = Math.min(now() + budget, Number.isFinite(deadlineMs) ? deadlineMs : Infinity);
  const shouldStart = () => now() < deadline;
  const sourceErrors = [];
  const batch = { version: 1, memberRequests: 0, memberCompleted: 0, historyRequests: 0, historyAdded: 0, historyRejected: 0 };
  const cacheDirectory = persistent ? await safeDirectory(root, marketDate, provisional, cacheNamespace) : null;
  const legacyDirectory = persistent && cacheNamespace === "sina" ? await safeDirectory(root, marketDate, provisional) : null;
  const release = persistent ? await acquireLock(cacheDirectory) : async () => undefined;
  const context = { version: 1, marketDate, provisional };
  const pathFor = (kind, identity) => {
    if (!/^(?:progress|members|history)$/u.test(kind) ||
        !(identity === "global" || NODE.test(identity) || SYMBOL.test(identity))) throw fail("SELECTION_CACHE_PATH_INVALID", "scan cache identity is invalid");
    return resolve(cacheDirectory, `${kind}-${identity}.json`);
  };
  const readCache = async (kind, identity) => {
    if (!persistent) return null;
    try {
      const record = await readJson(pathFor(kind, identity));
      return record?.version === 1 && record.marketDate === marketDate && record.provisional === provisional ? record : null;
    } catch (error) {
      // Symlinks and inaccessible files are not treated as ordinary stale data.
      if (error.code && !["SELECTION_CACHE_FILE_INVALID"].includes(error.code)) throw error;
      sourceErrors.push(sourceError("scan-cache", error, identity));
      return null;
    }
  };
  const writeCache = async (kind, identity, record) => {
    if (persistent) await atomicWrite(pathFor(kind, identity), { ...context, ...record, updatedAt: new Date(now()).toISOString() });
  };
  try {
    const progress = await readCache("progress", "global");
    let historyCursor = Number.isInteger(progress?.historyCursor) ? progress.historyCursor : 0;
    let memberSourceRetry = continueScan && progress?.memberSourceRetry
      ? restoreSourceRetry({ retry: progress.memberSourceRetry }, now()) : null;
    // Old progress files persisted a source cooldown without an attempt count.
    // Migrate that refusal as one attempt, keeping its original due time.
    if (continueScan && !memberSourceRetry && Number.isFinite(Date.parse(progress?.memberSourceNextRetryAt))) {
      memberSourceRetry = retryAfterFailure({ code: "SOURCE_THROTTLED" }, null,
        Math.min(now(), Date.parse(progress.memberSourceNextRetryAt) - 15 * 60_000));
    }
    let memberSourceReason = continueScan ? progress?.memberSourceReason ?? "SOURCE_THROTTLED" : null;
    const memberSourceReady = () => !memberSourceRetry || sourceRetryDue(memberSourceRetry, now());
    const sourceStopped = () => Boolean(memberSourceRetry?.exhausted);
    const saveProgress = () => writeCache("progress", "global", { historyCursor, memberSourceRetry, memberSourceReason,
      memberSourceNextRetryAt: memberSourceRetry?.nextRetryAt ?? null });
    const shouldStartMembers = () => shouldStart() && memberSourceReady();
    const members = new Map();
    for (const industry of directory) {
      let saved = await readCache("members", industry.id);
      // The pre-provider cache used Sina exclusively. Reuse only verified,
      // complete identities from the same session when upgrading its namespace.
      if (legacyDirectory && !saved?.complete) {
        try {
          const legacy = await readJson(resolve(legacyDirectory, `members-${industry.id}.json`));
          if (legacy?.version === 1 && legacy.marketDate === marketDate && legacy.provisional === provisional &&
              legacy.node === industry.id && (industry.count === 0 || legacy.expectedCount === industry.count) && legacy.complete && !legacy.failed) {
            checkedMemberResult(legacy, industry);
            saved = legacy;
            await writeCache("members", industry.id, legacy);
          }
        } catch (error) {
          if (error.code && !["SELECTION_CACHE_FILE_INVALID", "SECTOR_MEMBERS_INVALID", "QUOTE_NODE_MEMBERS_MISSING"].includes(error.code)) throw error;
          sourceErrors.push(sourceError("scan-cache", error, industry.id));
        }
      }
      let state = { symbols: [], complete: false, failed: false, reason: null, nextPage: 1 };
      if (saved?.node === industry.id && (industry.count === 0 || saved.expectedCount === industry.count)) {
        try { state = { ...checkedMemberResult(saved, industry), failed: Boolean(saved.failed),
          ...(saved.failed ? { retry: restoreSourceRetry(saved, now()), message: saved.message } : {}) }; }
        catch (error) { sourceErrors.push(sourceError("scan-cache", error, industry.id)); }
      }
      members.set(industry.id, state);
    }
    const memberJobs = directory.filter((industry) => {
      const state = members.get(industry.id);
      return !state.complete && (!state.failed || !continueScan || sourceRetryDue(state.retry, now()));
    }).sort((a, b) => Number(members.get(a.id).failed) - Number(members.get(b.id).failed))
      .slice(0, LIMITS.sectorBatchSize);
    const previousSourceRetry = memberSourceRetry;
    let sourceThrottledThisBatch = false;
    let memberSucceededThisBatch = false;
    await mapBounded(memberJobs, LIMITS.networkConcurrency, async (industry) => {
      batch.memberRequests += 1;
      const previousRetry = continueScan ? members.get(industry.id).retry : null;
      const saveMember = async (value, failed = false, retry = null, message = null) => {
        const state = { ...checkedMemberResult(value, industry), failed, ...(failed ? { retry, message } : {}) };
        members.set(industry.id, state);
        await writeCache("members", industry.id, { ...state, node: industry.id, expectedCount: industry.count });
        return state;
      };
      try {
        const value = await fetchMembers(industry.id, { expectedCount: industry.count,
          resume: members.get(industry.id), shouldStart: shouldStartMembers, onPage: (page) => saveMember(page) });
        await saveMember(value);
        if (value.complete) {
          memberSucceededThisBatch = true;
          batch.memberCompleted += 1;
        }
      } catch (error) {
        const partial = error?.partial ?? members.get(industry.id);
        const reason = sourceRetryErrorCode(error);
        const retry = retryAfterFailure(error, previousRetry, now());
        if (sourceRetryThrottled(reason)) {
          // A source-wide refusal also applies to names not yet attempted.
          // Avoid evading this cooldown by advancing to the next eight sectors.
          // Count a batch refusal once, even when three in-flight requests fail.
          // New sector names cannot restart a fresh source retry budget.
          if (!sourceThrottledThisBatch) {
            memberSourceRetry = retryAfterFailure(error, previousSourceRetry, now());
            memberSourceReason = reason;
            sourceThrottledThisBatch = true;
          }
          await saveProgress();
        }
        await saveMember({ ...partial, complete: false, reason }, true, retry,
          String(error?.message ?? "行业成员获取失败").slice(0, 240));
      }
    }, shouldStartMembers);
    if (memberSucceededThisBatch && !sourceThrottledThisBatch) {
      memberSourceRetry = null;
      memberSourceReason = null;
    }

    const industryMembers = new Map();
    const requested = new Set(watches);
    const missingQuotes = new Map();
    for (const industry of directory) {
      const state = members.get(industry.id);
      if (!state.complete) continue;
      const current = state.symbols.map((symbol) => currentQuotes.get(symbol));
      missingQuotes.set(industry.id, current.filter((quote) => !quote).length);
      const eligibleMembers = current.filter(eligible).sort((a, b) => a.symbol.localeCompare(b.symbol));
      industryMembers.set(industry.id, eligibleMembers);
      for (const quote of eligibleMembers) requested.add(quote.symbol);
    }
    if (requested.size > LIMITS.stocks) throw fail("HISTORY_UNIVERSE_TOO_LARGE", "eligible history universe exceeds the supported bound");
    const histories = new Map();
    const failedHistories = new Map();
    let historyCacheHits = 0;
    let historyNetworkLoads = 0;
    await mapBounded([...requested].sort(), 16, async (symbol) => {
      let cached = null;
      try {
        cached = await readCached(symbol, marketDate, { root, minimumBars: 61, maximumAgeDays: provisional ? 10 : 0, limit: 180 });
      } catch (error) { sourceErrors.push(sourceError("history-cache", error, symbol)); }
      const formalBars = usableBars(cached, marketDate, provisional);
      if (formalBars) {
        histories.set(symbol, formalBars);
        historyCacheHits += 1;
        // The canonical library already persists this evidence. Avoid rewriting
        // thousands of identical per-stock files on every background batch.
        return;
      }
      const saved = await readCache("history", symbol);
      const localBars = saved?.symbol === symbol && saved.status === "complete" ? usableBars(saved, marketDate, provisional) : null;
      if (localBars) {
        histories.set(symbol, localBars);
        historyCacheHits += 1;
      } else if (saved?.symbol === symbol && saved.status === "failed") {
        // Version 2 explicitly uses the corrected latest-history request. Only
        // old stale-date failures get a fresh budget; the first new response
        // persists the marker so continuation cannot repeat this migration.
        const legacyStaleRequest = historyRequestVersion === 2 && saved.historyRequestVersion === undefined &&
          saved.reason === "HISTORY_DATE_STALE";
        if (!legacyStaleRequest) failedHistories.set(symbol, { reason: String(saved.reason ?? "HISTORY_FAILED"),
          retry: restoreSourceRetry(saved, now()), message: saved.message });
      }
    });

    // Rotate through the entire directory, including currently empty queues.
    // The persistent cursor prevents the first sectors taking each batch again.
    const queueIds = [...directory.map((industry) => industry.id), ...(watches.length ? ["watch"] : [])];
    const queueFor = new Map(queueIds.map((id) => [id,
      (id === "watch" ? watches : (industryMembers.get(id) ?? []).map((quote) => quote.symbol))
        .filter((symbol) => !histories.has(symbol) && (!continueScan || !failedHistories.has(symbol) ||
          sourceRetryDue(failedHistories.get(symbol).retry, now()))),
    ]));
    const picked = new Set();
    // User-selected names share the same quota, with a bounded head start.
    const historyJobs = (queueFor.get("watch") ?? []).slice(0, 12);
    for (const symbol of historyJobs) picked.add(symbol);
    let emptyVisits = 0;
    while (queueIds.length && historyJobs.length < LIMITS.historyNetworkBatchSize && emptyVisits < queueIds.length) {
      const index = ((historyCursor % queueIds.length) + queueIds.length) % queueIds.length;
      historyCursor = (index + 1) % queueIds.length;
      const queue = queueFor.get(queueIds[index]);
      while (queue.length && picked.has(queue[0])) queue.shift();
      if (!queue.length) { emptyVisits += 1; continue; }
      const symbol = queue.shift();
      picked.add(symbol);
      historyJobs.push(symbol);
      emptyVisits = 0;
    }
    await saveProgress();
    await mapBounded(historyJobs, LIMITS.networkConcurrency, async (symbol) => {
      batch.historyRequests += 1;
      try {
        const value = await loadHistory(symbol, marketDate, { provisional, root, readCached: async () => null });
        const { bars, reason } = inspectBars(value, marketDate, provisional);
        if (!bars) throw fail(reason, `no usable closed qfq history for ${symbol} at ${marketDate}`);
        histories.set(symbol, bars);
        failedHistories.delete(symbol);
        if (value?.origin === "cache") historyCacheHits += 1;
        else {
          historyNetworkLoads += 1;
          batch.historyAdded += 1;
        }
        await writeCache("history", symbol, { symbol, status: "complete", adjustment: "qfq", bars, historyRequestVersion });
      } catch (error) {
        batch.historyRejected += 1;
        const record = { reason: sourceRetryErrorCode(error),
          retry: retryAfterFailure(error, continueScan ? failedHistories.get(symbol)?.retry : null, now()),
          message: String(error?.message ?? "历史数据获取失败").slice(0, 240) };
        failedHistories.set(symbol, record);
        await writeCache("history", symbol, { symbol, status: "failed", ...record, historyRequestVersion });
      }
    }, shouldStart);

    for (const [id, state] of members) {
      if (state.failed) sourceErrors.push(sourceError("industry-members", { code: state.reason,
        message: state.message ?? "行业成员上次获取失败" }, id));
    }
    if (sourceStopped()) sourceErrors.push(sourceError("industry-members", { code: memberSourceReason,
      message: "行业成员来源连续限流，自动重试已达上限；尚未取全的行业已停止扫描，请稍后手动重试" }, "all-industries"));
    for (const [symbol, state] of failedHistories) {
      sourceErrors.push(sourceError("history", { code: state.reason, message: state.message ?? "股票历史上次获取失败" }, symbol));
    }
    const terminalHistoryFailure = (symbol) => failedHistories.has(symbol) && !sourceRetryPending(failedHistories.get(symbol).retry);

    const sectorScan = new Map();
    for (const industry of directory) {
      const memberState = members.get(industry.id);
      const quotesForSector = industryMembers.get(industry.id) ?? [];
      const historyAvailable = quotesForSector.filter((quote) => histories.has(quote.symbol)).length;
      const historyFailed = quotesForSector.filter((quote) => !histories.has(quote.symbol) && terminalHistoryFailure(quote.symbol)).length;
      const historyPending = quotesForSector.length - historyAvailable - historyFailed;
      const metadataMissing = industry.changePercent === null || industry.amount === null;
      const state = !memberState.complete ? (sourceStopped() || (memberState.failed && !sourceRetryPending(memberState.retry)) ? "failed" : "pending") :
        historyPending || historyFailed || metadataMissing ? "partial" : "complete";
      const absent = missingQuotes.get(industry.id) ?? 0;
      let reason = !memberState.complete && sourceStopped()
        ? "行业成员来源连续限流，自动重试已达上限，请稍后手动重试"
        : memberState.failed
        ? sourceRetryPending(memberState.retry) ? "行业成员获取失败，已安排稍后自动重试"
          : memberState.reason === "QUOTE_NODE_MEMBERS_MISSING"
          ? `行业成员尚未取全（已取得 ${memberState.symbols.length} / ${industry.count} 只），请手动刷新重试`
          : "行业成员获取失败，请手动刷新重试"
        : !memberState.complete ? "等待获取完整行业成员"
          : historyFailed ? historyPending ? "正在补齐历史数据；部分历史获取失败，需手动重试" : "部分历史获取失败，请手动刷新重试"
            : historyPending ? quotesForSector.some((quote) => failedHistories.has(quote.symbol))
              ? "部分历史数据暂未取得，已安排稍后自动重试" : "正在分批补齐股票历史数据" : null;
      if (absent) {
        const coverageReason = `本轮有 ${absent} 只成员缺少可用的 A 股行情，未纳入评估`;
        reason = reason ? `${reason}；${coverageReason}` : coverageReason;
      }
      if (metadataMissing && memberState.complete) reason = [reason, "行业实时指标暂缺，保留成分分析，等待来源恢复后参与排名"].filter(Boolean).join("；");
      sectorScan.set(industry.id, { state, memberCount: state !== "pending" ? memberState.symbols.length : 0,
        eligibleCount: quotesForSector.length, historyAvailable, historyPending, historyFailed, reason,
        ...(absent ? { missingQuoteCount: absent } : {}) });
    }
    const historyRequested = requested.size;
    const historyFailed = [...requested].filter((symbol) => !histories.has(symbol) && terminalHistoryFailure(symbol)).length;
    const historyPending = historyRequested - histories.size - historyFailed;
    const completedSectors = [...sectorScan.values()].filter((item) => item.state === "complete").length;
    const failedSectors = [...sectorScan.values()].filter((item) => item.state === "failed").length;
    const pendingSectors = directory.length - completedSectors - failedSectors;
    const retryTimes = [];
    for (const item of members.values()) {
      if (item.complete || sourceStopped() || (item.failed && !sourceRetryPending(item.retry))) continue;
      retryTimes.push(Math.max(now(), Date.parse(item.retry?.nextRetryAt) || 0,
        Date.parse(memberSourceRetry?.nextRetryAt) || 0));
    }
    for (const symbol of requested) {
      if (histories.has(symbol) || terminalHistoryFailure(symbol)) continue;
      retryTimes.push(Math.max(now(), Date.parse(failedHistories.get(symbol)?.retry.nextRetryAt) || 0));
    }
    const hasMore = retryTimes.length > 0;
    const nextRetryAt = hasMore && Math.min(...retryTimes) > now() ? new Date(Math.min(...retryTimes)).toISOString() : null;
    const scanProgress = { version: 1, scope: "all-industries",
      state: hasMore ? "running" : failedSectors || pendingSectors || historyFailed ? "partial" : "complete",
      totalSectors: directory.length, completedSectors, pendingSectors, failedSectors,
      hasMore, nextRetryAt, batch, updatedAt: new Date(now()).toISOString() };
    return { industryMembers, histories, sectorScan, scanProgress, historyCacheHits,
      historyNetworkLoads, historyRequested, historyPending, historyFailed, sourceErrors };
  } finally {
    await release();
  }
}
