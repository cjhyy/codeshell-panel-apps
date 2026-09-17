#!/usr/bin/env node
// Deterministic A-share selection snapshot. The tool keeps arithmetic, source
// timestamps, sector membership, stock history, announcements and news in one
// bounded output. The UI only renders the validated result.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAShareSelectionSnapshot,
  parseEastmoneyAnnouncements,
} from "../a-share-selection.mjs";
import { reviewPredictionLedger } from "../a-share-strategy-lab.mjs";
import { enrichSelectionSnapshot } from "./selection-research-evidence.mjs";
import { collectSelectionSectors } from "./selection-sector-scan.mjs";
import { collectSelectionAnnouncements } from "./selection-announcement-scan.mjs";
import { selectionIndustryDirectory, selectionQuoteSnapshot } from "./selection-source-cache.mjs";
import { fetchIndustries, fetchMarketNews } from "./build-market-pulse.mjs";
import { readUsableHistory } from "./a-share-history-cache.mjs";
import { LOCAL_SNAPSHOT_MAX_BYTES, readLocalSnapshot, readLocalSnapshotHistory, writeLocalSnapshot } from "./local-snapshot-store.mjs";
import {
  chinaClock,
  fetchAllQuotes,
  fetchHistory,
  fetchHistorySeries,
  fetchMarketTimestamp,
  mapWithConcurrency,
  readLimitedResponseText,
} from "./screen-a-shares.mjs";

const EASTMONEY_ANNOUNCEMENT_ORIGIN = "https://np-anotice-stock.eastmoney.com";
const USER_AGENT = "QuantLab/0.13 deterministic A-share selection";
const TIMEOUT_MS = 20_000;
const MAX_WATCH_ARGUMENT_CHARS = 12_000;
const DEVIATION_BENCHMARKS = Object.freeze(["SH000001", "SZ399001", "SZ399006"]);

class SelectionFetchError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    Object.assign(this, details);
  }
}

function cleanText(value, maximum = 80) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
}

function parseWatchArgument(value) {
  if (!value) return { sectors: [], stocks: [] };
  if (typeof value !== "string" || value.length > MAX_WATCH_ARGUMENT_CHARS) {
    throw new SelectionFetchError("WATCH_ARGUMENT_INVALID", "watch argument is too large");
  }
  let parsed;
  try {
    parsed = JSON.parse(decodeURIComponent(value));
  } catch {
    throw new SelectionFetchError("WATCH_ARGUMENT_INVALID", "watch argument is not valid encoded JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SelectionFetchError("WATCH_ARGUMENT_INVALID", "watch argument must be an object");
  }
  const sectors = [];
  const sectorIds = new Set();
  for (const item of Array.isArray(parsed.sectors) ? parsed.sectors : []) {
    const id = cleanText(item?.id, 50);
    const name = cleanText(item?.name, 40);
    if (!/^new_[A-Za-z0-9]+$/u.test(id) || !name || sectorIds.has(id)) continue;
    sectorIds.add(id);
    sectors.push({ id, name });
    if (sectors.length >= 12) break;
  }
  const stocks = [];
  const stockSymbols = new Set();
  for (const item of Array.isArray(parsed.stocks) ? parsed.stocks : []) {
    const symbol = cleanText(item?.symbol, 16).toUpperCase();
    const name = cleanText(item?.name, 40);
    if (!/^(?:SH|SZ)\d{6}$/u.test(symbol) || stockSymbols.has(symbol)) continue;
    stockSymbols.add(symbol);
    stocks.push({ symbol, name, ...(item?.priority === "focus" ? { priority: "focus" } : {}) });
    if (stocks.length >= 20) break;
  }
  return { sectors, stocks };
}

function parseArgs(argv) {
  const options = {
    stdout: false,
    persistLocal: false,
    readLocal: false,
    continueScan: false,
    cacheScope: "global",
    watch: { sectors: [], stocks: [] },
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--stdout") options.stdout = true;
    else if (argument === "--persist-local") options.persistLocal = true;
    else if (argument === "--read-local") options.readLocal = true;
    else if (argument === "--continue-scan") options.continueScan = true;
    else if (argument === "--cache-scope") options.cacheScope = argv[++index] ?? "";
    else if (argument === "--watch") options.watch = parseWatchArgument(argv[++index] ?? "");
    else if (argument === "--help") options.help = true;
    else throw new SelectionFetchError("ARGUMENT_UNKNOWN", `unknown argument: ${argument}`);
  }
  return options;
}

function announcementUrl(symbol) {
  const url = new URL("/api/security/ann", EASTMONEY_ANNOUNCEMENT_ORIGIN);
  for (const [key, value] of Object.entries({
    sr: "-1",
    page_size: "8",
    page_index: "1",
    ann_type: "A",
    client_source: "web",
    stock_list: symbol.slice(2),
  })) url.searchParams.set(key, value);
  return url;
}

async function fetchAnnouncementPayload(symbol, now) {
  const url = announcementUrl(symbol);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json,text/plain,*/*",
        Referer: "https://data.eastmoney.com/",
      },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new SelectionFetchError("ANNOUNCEMENT_HTTP", `HTTP ${response.status} from ${url.hostname}`);
    }
    if (new URL(response.url).origin !== EASTMONEY_ANNOUNCEMENT_ORIGIN) {
      throw new SelectionFetchError("ANNOUNCEMENT_REDIRECT", `announcement source escaped allowlist: ${response.url}`);
    }
    const text = await readLimitedResponseText(response, 1_000_000);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new SelectionFetchError("ANNOUNCEMENT_SHAPE", `non-JSON response for ${symbol}`);
    }
    return parseEastmoneyAnnouncements(payload, symbol, now.toISOString());
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new SelectionFetchError("ANNOUNCEMENT_TIMEOUT", `announcement timeout for ${symbol}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function sourceError(source, error, detail = "") {
  return {
    source,
    errorCode: error?.code ?? error?.errorCode ?? "SOURCE_ERROR",
    message: cleanText(error instanceof Error ? error.message : error?.message ?? "source failed", 240),
    ...(detail ? { detail } : {}),
  };
}

function uniqueSymbols(values) {
  return [...new Set(values.filter((value) => /^(?:SH|SZ)\d{6}$/u.test(value)))];
}

export async function loadSelectionHistory(symbol, marketDate, {
  provisional = false,
  readCached = readUsableHistory,
  fetchFresh = fetchHistory,
  root = process.cwd(),
} = {}) {
  const cached = await readCached(symbol, marketDate, {
    minimumBars: 61,
    maximumAgeDays: provisional ? 10 : 0,
    limit: 180,
    root,
  }).catch(() => null);
  if (cached?.bars && (provisional || cached.bars.at(-1)?.date === marketDate)) {
    return { bars: cached.bars, origin: "cache" };
  }
  const bars = await fetchFresh(symbol, marketDate, { minimumBars: 61, attempts: 1, includeLatest: true });
  if (!provisional && bars.at(-1)?.date !== marketDate) {
    throw new SelectionFetchError("HISTORY_DATE_STALE", `history for ${symbol} does not include market close ${marketDate}`);
  }
  return { bars, origin: "network" };
}

export async function buildSelectionSnapshot(options = {}, nowInput = new Date(), dependencies = {}) {
  const now = new Date(nowInput);
  if (!Number.isFinite(now.getTime())) throw new SelectionFetchError("NOW_INVALID", "valid current time required");
  const watch = options.watch ?? { sectors: [], stocks: [] };
  const startedAt = Date.now();
  const persistent = options.persistLocal === true;
  const root = options.root ?? process.cwd();
  const [timestampResult, newsResult] = await Promise.allSettled([
    (dependencies.fetchMarketTimestamp ?? fetchMarketTimestamp)(),
    (dependencies.fetchMarketNews ?? fetchMarketNews)(now),
  ]);
  if (timestampResult.status !== "fulfilled") throw timestampResult.reason;
  let marketTimestamp = timestampResult.value;
  const clock = chinaClock(now);
  const provisional = clock.date === marketTimestamp.marketDate && clock.minutes < 15 * 60 + 10;
  const previousClose = clock.date !== marketTimestamp.marketDate;
  const [quoteData, directory] = await Promise.all([
    selectionQuoteSnapshot({ root, persistent, marketDate: marketTimestamp.marketDate, provisional, now,
      fetchQuotes: dependencies.fetchAllQuotes ?? fetchAllQuotes }),
    selectionIndustryDirectory({ root, persistent, marketDate: marketTimestamp.marketDate, provisional, now,
      continueScan: options.continueScan === true, seedSnapshots: options.reviewSnapshots ?? [],
      fetchIndustries: dependencies.fetchIndustries ?? fetchIndustries }),
  ]);
  if (quoteData.cached) marketTimestamp = { ...marketTimestamp, asOf: quoteData.asOf };
  else await quoteData.save(marketTimestamp.asOf);
  const quotes = quoteData.quotes;
  const allIndustries = directory.industries;
  const news = newsResult.status === "fulfilled" ? newsResult.value : [];
  const sourceErrors = [];
  sourceErrors.push(...directory.sourceErrors);
  if (newsResult.status === "rejected") sourceErrors.push(sourceError("news", newsResult.reason));

  const benchmarkOutcomes = await mapWithConcurrency(DEVIATION_BENCHMARKS, 3, async (symbol) => {
    const series = await (dependencies.fetchHistorySeries ?? fetchHistorySeries)(symbol, marketTimestamp.marketDate, {
      minimumBars: 31,
      assetType: "index",
      allowUnadjustedNewStock: true,
      includeLatest: true,
    });
    return provisional ? series.bars.filter((bar) => bar.date < marketTimestamp.marketDate) : series.bars;
  });
  const benchmarkHistories = new Map();
  for (const [index, outcome] of benchmarkOutcomes.entries()) {
    const symbol = DEVIATION_BENCHMARKS[index];
    if (outcome.ok) benchmarkHistories.set(symbol, outcome.value);
    else sourceErrors.push(sourceError("deviation-benchmark", outcome, symbol));
  }

  const watchSymbols = uniqueSymbols([
    ...[...watch.stocks].sort((a, b) => Number(b.priority === "focus") - Number(a.priority === "focus"))
      .map((item) => item.symbol),
    ...(options.reviewSnapshots ?? []).flatMap((snapshot) =>
      (Array.isArray(snapshot?.predictions) ? snapshot.predictions : []).map((item) => item.symbol),
    ).slice(0, 20),
  ]);
  const scan = await (dependencies.collectSelectionSectors ?? collectSelectionSectors)({
    industries: allIndustries, quotes, marketDate: marketTimestamp.marketDate,
    asOf: marketTimestamp.asOf, provisional, root, persistent,
    continueScan: options.continueScan === true,
    historyRequestVersion: 2,
    watchSymbols,
    loadHistory: dependencies.loadHistory ?? loadSelectionHistory,
    ...(dependencies.fetchMembers ? { fetchMembers: dependencies.fetchMembers } : {}),
    ...(dependencies.readCached ? { readCached: dependencies.readCached } : {}),
    timeBudgetMs: Math.max(0, Math.min(60_000, 110_000 - (Date.now() - startedAt))),
  });
  const { industryMembers, histories } = scan;
  sourceErrors.push(...scan.sourceErrors);
  const sectorHistorySymbols = uniqueSymbols([...industryMembers.values()].flatMap((members) => members.map((item) => item.symbol)));
  const historyCoverage = scan.historyRequested === 0 ? 0 : histories.size / scan.historyRequested;
  const scanBatch = scan.scanProgress.batch ? {
    ...scan.scanProgress.batch,
    announcementRequests: 0,
    announcementChecked: 0,
  } : null;
  const baseInput = {
    quotes,
    industries: allIndustries,
    sectorDirectory: allIndustries,
    industryMembers,
    histories,
    benchmarkHistories,
    announcements: new Map(),
    news,
    watch,
    marketHistory: options.marketHistory ?? [],
    reviewSnapshots: options.reviewSnapshots ?? [],
    marketDate: marketTimestamp.marketDate,
    asOf: marketTimestamp.asOf,
    generatedAt: now.toISOString(),
    provisional,
    previousClose,
    sectorScan: scan.sectorScan,
    scanProgress: { ...scan.scanProgress, ...(scanBatch ? { batch: scanBatch } : {}) },
    scanCoverage: {
      quoteUniverse: quotes.length,
      researchSectors: allIndustries.length,
      sectorMembers: sectorHistorySymbols.length,
      historyRequested: scan.historyRequested,
      historyAvailable: histories.size,
      historyCacheHits: scan.historyCacheHits,
      historyNetworkLoads: scan.historyNetworkLoads,
      historyFailed: scan.historyFailed,
      historyPending: scan.historyPending,
    },
    sourceStatus: {
      quotes: true,
      industries: directory.available && industryMembers.size > 0,
      histories: historyCoverage >= 0.6,
      announcements: false,
      news: newsResult.status === "fulfilled",
    },
    sourceErrors,
  };
  const preliminary = buildAShareSelectionSnapshot({ ...baseInput, omitDiagnostics: true });
  const announcementSymbols = uniqueSymbols([
    ...(preliminary.announcementRequests ?? preliminary.sectors.flatMap((sector) => [
      ...sector.representatives,
      ...sector.timingQueue,
      ...sector.candidates,
    ].map((candidate) => candidate.symbol))),
    ...watch.stocks.map((item) => item.symbol),
  ]);
  const events = await (dependencies.collectSelectionAnnouncements ?? collectSelectionAnnouncements)({
    symbols: announcementSymbols, marketDate: marketTimestamp.marketDate, provisional,
    prioritySymbols: watch.stocks.filter((item) => item.priority === "focus").map((item) => item.symbol),
    root, persistent, continueScan: options.continueScan === true, now,
    fetchAnnouncements: dependencies.fetchAnnouncements ?? fetchAnnouncementPayload,
    deadlineMs: startedAt + 120_000,
  });
  const { announcements } = events;
  sourceErrors.push(...events.sourceErrors);
  const announcementCoverage = events.requested === 0 ? 1 : events.available / events.requested;
  const hasMore = scan.scanProgress.hasMore || events.pending > 0 || directory.pending;
  const workSources = [
    { pending: scan.scanProgress.hasMore, nextRetryAt: scan.scanProgress.nextRetryAt },
    { pending: events.pending > 0, nextRetryAt: events.nextRetryAt },
    { pending: directory.pending, nextRetryAt: directory.nextRetryAt },
  ].filter((item) => item.pending);
  const nextRetryAt = workSources.some((item) => !item.nextRetryAt) ? null
    : workSources.map((item) => item.nextRetryAt).filter(Boolean).sort()[0] ?? null;
  const scanProgress = {
    ...scan.scanProgress,
    ...(scanBatch ? { batch: {
      ...scanBatch,
      announcementRequests: events.batchRequests ?? 0,
      announcementChecked: events.batchChecked ?? 0,
    } } : {}),
    state: hasMore ? "running" : scan.scanProgress.state === "complete" && events.failed === 0 && directory.available && allIndustries.length > 0 ? "complete" : "partial",
    hasMore,
    nextRetryAt,
    announcementRequested: events.requested,
    announcementAvailable: events.available,
    announcementPending: events.pending,
    announcementFailed: events.failed,
  };
  const predictionReview = reviewPredictionLedger(options.reviewSnapshots, histories, marketTimestamp.marketDate);
  const snapshot = buildAShareSelectionSnapshot({
    ...baseInput,
    generatedAt: new Date().toISOString(),
    announcements,
    scanProgress,
    sourceStatus: {
      ...baseInput.sourceStatus,
      announcements: announcementCoverage >= 0.6,
    },
    sourceErrors,
    elapsedMs: Date.now() - startedAt,
    predictionReview,
  });
  const enriched = await (dependencies.enrichSelectionSnapshot ?? enrichSelectionSnapshot)(snapshot, histories, {
    timeoutMs: hasMore ? 0 : Math.min(45_000, 140_000 - (Date.now() - startedAt)),
    ...(hasMore ? { skipReason: "正在分批扫描全部行业，完成后补充指标与财务核验" } : {}),
  });
  return { ...enriched, elapsedMs: Date.now() - startedAt };
}

export async function runCli(argv = process.argv.slice(2), nowInput = new Date()) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write([
      "Usage: node build-a-share-selection.mjs --stdout [--persist-local] [--cache-scope <scope>] [--watch <encoded-json>]",
      "",
      "  --stdout         emit one validated selection snapshot as JSON",
      "  --persist-local  atomically retain latest and daily snapshots below the process working directory",
      "  --read-local     emit the latest retained snapshot without network access",
      "  --continue-scan  resume pending work and due retries while preserving source cooldowns and attempt budgets",
      "  --cache-scope    global or a 16-character lowercase hex workspace scope",
      "  --watch <value>  URI-encoded {sectors,stocks} watch pool",
    ].join("\n") + "\n");
    return { ok: true, help: true };
  }
  if (!options.stdout) throw new SelectionFetchError("STDOUT_REQUIRED", "--stdout is required");
  if (options.readLocal) {
    const snapshot = await readLocalSnapshot({
      stream: "a-share-selection",
      scope: options.cacheScope,
    });
    process.stdout.write(`${JSON.stringify(snapshot)}\n`);
    return snapshot;
  }
  const reviewSnapshots = options.persistLocal
    ? await readLocalSnapshotHistory({
      stream: "a-share-selection",
      scope: options.cacheScope,
      limit: 40,
    }).catch(() => [])
    : [];
  const marketHistory = options.persistLocal
    ? await readLocalSnapshotHistory({
      stream: "a-share-realtime",
      scope: "global",
      limit: 60,
    }).catch(() => [])
    : [];
  const snapshot = await buildSelectionSnapshot({ ...options, reviewSnapshots, marketHistory }, nowInput);
  const serialized = `${JSON.stringify(snapshot)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > LOCAL_SNAPSHOT_MAX_BYTES) {
    throw new SelectionFetchError("SELECTION_SNAPSHOT_TOO_LARGE", "完整选股结果超过面板传输上限，已保留上一份快照");
  }
  if (options.persistLocal) {
    await writeLocalSnapshot({
      stream: "a-share-selection",
      scope: options.cacheScope,
      snapshot,
    });
  }
  process.stdout.write(serialized);
  return snapshot;
}

export { announcementUrl, parseWatchArgument };

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      errorCode: error?.code ?? error?.cause?.code ?? "SELECTION_ERROR",
      message: error instanceof Error ? error.message : "selection snapshot failed",
    })}\n`);
    process.exitCode = 1;
  });
}
