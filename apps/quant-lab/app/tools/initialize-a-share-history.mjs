#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { prepareHistoryUniverse } from "../stock-screener.mjs";
import { historySourceLabel } from "../market-data-sources.mjs";
import {
  A_SHARE_HISTORY_DEFAULT_SOURCE,
  A_SHARE_HISTORY_BASIS_VERSION,
  A_SHARE_HISTORY_KIND,
  A_SHARE_HISTORY_MANIFEST_KIND,
  A_SHARE_RESEARCH_PRICE_CONTRACT,
  A_SHARE_HISTORY_SCHEMA_VERSION,
  acquireHistoryRunState,
  createRawFactorPriceBundle,
  heartbeatHistoryRunState,
  isAShareHistorySource,
  mergeRawFactorPriceBundles,
  readActiveHistoryRunState,
  readHistoryManifest,
  readHistorySeries,
  recoverHistoryManifestFromSeries,
  releaseHistoryRunState,
  seriesBytes,
  writeHistoryManifest,
  writeHistorySeries,
} from "./a-share-history-cache.mjs";
import { fetchAsharePriceBundle, resolveSourceCandidates } from "./fetch-market-data.mjs";
import { reconcileAShareHistorySnapshots } from "./reconcile-a-share-history-snapshots.mjs";
import { chinaClock, fetchAllQuotes, fetchMarketTimestamp } from "./screen-a-shares.mjs";

const SCOPES = Object.freeze({ core: 120, broad: 300, full: null });
const SCOPE_RANK = Object.freeze({ core: 0, broad: 1, full: 2 });
const YEARS = 3;
const MAX_IN_PROCESS_RETRY_DELAY_MS = 10 * 60_000;
const RETRYABLE_SOURCE_ERRORS = new Set([
  "SOURCE_HTTP",
  "SOURCE_NETWORK",
  "SOURCE_RATE_LIMIT",
  "SOURCE_TIMEOUT",
]);
const TEMPORARILY_UNAVAILABLE_ERRORS = new Set([
  "SOURCE_EMPTY",
  "SOURCE_ADJUST_UNAVAILABLE",
]);
const PACING_BY_SCOPE = Object.freeze({
  core: Object.freeze({
    concurrency: 1,
    requestIntervalMs: 1_500,
    retryDelaysMs: Object.freeze([15_000, 45_000, 120_000]),
    sourceFailureLimit: 1,
    batchSize: 0,
    batchCooldownMs: 0,
    pauseCooldownMs: 10 * 60_000,
    checkpointEvery: 5,
  }),
  broad: Object.freeze({
    concurrency: 1,
    requestIntervalMs: 2_000,
    retryDelaysMs: Object.freeze([20_000, 60_000, 180_000]),
    sourceFailureLimit: 1,
    batchSize: 150,
    batchCooldownMs: 30_000,
    pauseCooldownMs: 20 * 60_000,
    checkpointEvery: 25,
  }),
  full: Object.freeze({
    concurrency: 1,
    requestIntervalMs: 3_000,
    retryDelaysMs: Object.freeze([30_000, 120_000, 300_000]),
    sourceFailureLimit: 1,
    batchSize: 200,
    batchCooldownMs: 60_000,
    pauseCooldownMs: 30 * 60_000,
    checkpointEvery: 100,
  }),
});

class HistoryInitializationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function historyInitializationPacing(scope) {
  const pacing = PACING_BY_SCOPE[scope];
  if (!pacing) throw new HistoryInitializationError("SCOPE_INVALID", "scope must be core, broad, or full");
  return pacing;
}

function addDays(date, days) {
  const instant = new Date(`${date}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

function latestHistoryDateDistribution(records, marketDate) {
  const latestBySymbol = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const symbol = String(record?.symbol ?? "");
    const date = String(record?.to ?? "");
    if (!/^(?:SH|SZ)\d{6}$/u.test(symbol) || !/^\d{4}-\d{2}-\d{2}$/u.test(date) || date > marketDate) continue;
    const previous = latestBySymbol.get(symbol);
    if (!previous || date > previous) latestBySymbol.set(symbol, date);
  }
  const counts = new Map();
  for (const date of latestBySymbol.values()) counts.set(date, (counts.get(date) ?? 0) + 1);
  return Object.freeze([...counts]
    .sort(([left], [right]) => right.localeCompare(left))
    .slice(0, 6)
    .map(([date, count]) => Object.freeze({ date, count })));
}

export function historyManifestRecordsForScope(records, selectedSymbols, scope) {
  const valid = (Array.isArray(records) ? records : []).filter((record) =>
    /^(?:SH|SZ)\d{6}$/u.test(String(record?.symbol ?? "")),
  );
  if (scope !== "full") return Object.freeze(valid);
  const symbols = selectedSymbols instanceof Set ? selectedSymbols : new Set(selectedSymbols ?? []);
  return Object.freeze(valid.filter((record) => symbols.has(record.symbol)));
}

export function compactHistoryBridgeSummary(value) {
  const { records, excludedSymbols, recovered: _recovered, ...summary } = value;
  return Object.freeze({
    ...summary,
    excludedCount: Array.isArray(excludedSymbols) ? excludedSymbols.length : 0,
    latestDateDistribution: latestHistoryDateDistribution(records, value?.marketDate),
  });
}

function formatResumeTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function normalizeHistoryInitializationOptions(argv = []) {
  let scope = "core";
  let source = A_SHARE_HISTORY_DEFAULT_SOURCE;
  let incrementalOnly = false;
  let stdout = false;
  let help = false;
  let status = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--scope") scope = String(argv[++index] ?? "");
    else if (argument === "--source") source = String(argv[++index] ?? "");
    else if (argument === "--incremental-only") incrementalOnly = true;
    else if (argument === "--stdout") stdout = true;
    else if (argument === "--status") status = true;
    else if (argument === "--help") help = true;
    else throw new HistoryInitializationError("ARGUMENT_UNKNOWN", `unknown argument: ${argument}`);
  }
  if (!Object.hasOwn(SCOPES, scope)) {
    throw new HistoryInitializationError("SCOPE_INVALID", "scope must be core, broad, or full");
  }
  if (!isAShareHistorySource(source)) {
    throw new HistoryInitializationError(
      "SOURCE_INVALID",
      "source must support auditable A-share raw prices and adjustment factors (tencent-ifzq, eastmoney-kline, or tushare-pro)",
    );
  }
  return Object.freeze({
    scope,
    source,
    limit: SCOPES[scope],
    years: YEARS,
    incrementalOnly,
    stdout,
    help,
    status,
  });
}

function progress(output, value) {
  output(`${JSON.stringify({ type: "history-progress", ...value })}\n`);
}

function historyOutcomeCounts(failures) {
  const unavailable = failures.filter((failure) => failure.errorCode === "HISTORY_NOT_USABLE").length;
  return Object.freeze({ failed: failures.length - unavailable, unavailable });
}

function recordFor(series, bytes) {
  return Object.freeze({
    symbol: series.symbol,
    name: series.name,
    from: series.bars[0].date,
    to: series.bars.at(-1).date,
    bars: series.bars.length,
    bytes,
    updatedAt: series.updatedAt,
    source: series.source,
    priceModel: series.priceModel.kind,
    rawSource: series.priceModel.rawSource,
    factorSource: series.priceModel.factorSource,
    factorMethod: series.priceModel.factorMethod,
    basisContract: series.basis.contract,
    validationStatus: series.validation.status,
    confirmedThrough: series.validation.confirmedThrough,
  });
}

function usableForResearch(series, marketDate) {
  if (!series || series.bars.length < 60) return false;
  const age = Math.floor(
    (Date.parse(`${marketDate}T00:00:00.000Z`) - Date.parse(`${series.bars.at(-1).date}T00:00:00.000Z`)) /
      86_400_000,
  );
  return age >= 0 && age <= 10;
}

function recordUsableForResearch(record, marketDate, source) {
  const to = String(record?.to ?? "");
  const age = Math.floor(
    (Date.parse(`${marketDate}T00:00:00.000Z`) - Date.parse(`${to}T00:00:00.000Z`)) /
      86_400_000,
  );
  return record?.source === source && Number(record?.bars) >= 60 && age >= 0 && age <= 10;
}

function closeEnoughToTarget(series, marketDate, provisional = false) {
  if (!usableForResearch(series, marketDate)) return false;
  const latest = series.bars.at(-1).date;
  if (latest >= marketDate) return true;
  if (!provisional) return false;
  const age = Math.floor(
    (Date.parse(`${marketDate}T00:00:00.000Z`) - Date.parse(`${latest}T00:00:00.000Z`)) /
      86_400_000,
  );
  // During the session, yesterday's confirmed close (or Friday before a
  // Monday session) is already the correct research baseline. Do not refetch
  // thousands of stocks just to receive and then discard a provisional bar.
  return age >= 1 && age <= 3;
}

async function defaultFetchPriceBundle({ symbol, from, to, source, beforeAdditionalRequest }) {
  return fetchAsharePriceBundle({
    requestedSource: source,
    symbol,
    slug: symbol,
    from,
    to,
    beforeAdditionalRequest,
  });
}

function identityPriceBundle(bars, source, generatedAt) {
  return createRawFactorPriceBundle({
    rawBars: bars,
    adjustmentFactors: (Array.isArray(bars) ? bars : []).map((bar) => ({ date: bar.date, factor: 1 })),
    source,
    factorSource: source,
    factorMethod: "identity-test-fixture",
    generatedAt,
  });
}

function buildDerivedSeries({ quote, bundle, marketDate, updatedAt, validation }) {
  return {
    schemaVersion: A_SHARE_HISTORY_SCHEMA_VERSION,
    kind: A_SHARE_HISTORY_KIND,
    symbol: quote.symbol,
    name: quote.name,
    adjust: "qfq",
    source: bundle.priceModel.rawSource,
    marketDate,
    updatedAt,
    priceModel: bundle.priceModel,
    basis: {
      contract: A_SHARE_RESEARCH_PRICE_CONTRACT,
      source: bundle.priceModel.rawSource,
      market: "cn",
      interval: "1d",
      adjustment: "qfq",
      version: A_SHARE_HISTORY_BASIS_VERSION,
    },
    validation,
    rawBars: bundle.rawBars,
    adjustmentFactors: bundle.adjustmentFactors,
    bars: bundle.bars,
  };
}

export async function runCli(argv = process.argv.slice(2), dependencies = {}) {
  const options = normalizeHistoryInitializationOptions(argv);
  if (options.help) {
    process.stdout.write([
      "Usage: node initialize-a-share-history.mjs --scope <core|broad|full> --stdout",
      "       [--source <tencent-ifzq|eastmoney-kline|tushare-pro>]",
      "",
      "  core   initialize 120 high-liquidity A shares",
      "  broad  initialize 300 high-liquidity A shares",
      "  full   initialize every valid currently quoted Shanghai/Shenzhen A share",
      "  source selects the raw-price/factor provider and is recorded for later updates",
      "  --incremental-only updates missing/lagging sessions without migrating current legacy files",
      "  research qfq prices are generated locally; legacy vendor-qfq files migrate gradually",
    ].join("\n") + "\n");
    return { ok: true, help: true };
  }
  if (!options.stdout) throw new HistoryInitializationError("STDOUT_REQUIRED", "--stdout is required");

  const root = resolve(dependencies.root ?? process.cwd());
  const now = dependencies.now instanceof Date ? dependencies.now : new Date();
  if (!Number.isFinite(now.getTime())) throw new HistoryInitializationError("NOW_INVALID", "valid current time required");
  if (options.status) {
    let manifest = await readHistoryManifest(root);
    if (!manifest) throw new HistoryInitializationError("HISTORY_LIBRARY_MISSING", "history library is not initialized");
    manifest = await recoverHistoryManifestFromSeries(manifest, root, now);
    let activeRun = await readActiveHistoryRunState(root);
    if (!activeRun) {
      const localLock = await acquireHistoryRunState({
        scope: manifest.scope,
        source: manifest.source,
        now: new Date(),
      }, root);
      if (localLock.acquired) {
        try {
          manifest = await reconcileAShareHistorySnapshots({ root, manifest, now });
        } finally {
          await releaseHistoryRunState(localLock.state, root);
        }
      } else {
        activeRun = localLock.state;
      }
    }
    const status = Object.freeze({
      ...manifest,
      paused: activeRun ? false : manifest.paused === true,
      running: Boolean(activeRun),
      runScope: activeRun?.scope ?? null,
      runStartedAt: activeRun?.startedAt ?? null,
    });
    // The manifest may contain more than five thousand per-symbol records.
    // The panel only needs the latest-date histogram, so keep the persisted
    // manifest complete while sending a compact status payload across the host
    // bridge. This turns a ~500 KB refresh into a few KB.
    const compactStatus = compactHistoryBridgeSummary(status);
    const writeOutput = dependencies.stdout ?? ((line) => process.stdout.write(line));
    writeOutput(`${JSON.stringify(compactStatus)}\n`);
    return status;
  }
  const runLock = await acquireHistoryRunState({
    scope: options.scope,
    source: options.source,
    now: new Date(),
  }, root);
  if (!runLock.acquired) {
    throw new HistoryInitializationError(
      "HISTORY_ALREADY_RUNNING",
      "A 股历史基础库正在另一个窗口或刷新前的后台任务中初始化，请等待当前任务完成后再操作",
    );
  }
  try {
  const emitProgress = dependencies.progress ?? ((line) => process.stderr.write(line));
  const writeOutput = dependencies.stdout ?? ((line) => process.stdout.write(line));
  const getTimestamp = dependencies.fetchMarketTimestamp ?? fetchMarketTimestamp;
  const getQuotes = dependencies.fetchAllQuotes ?? fetchAllQuotes;
  const getPriceBundle = dependencies.fetchPriceBundle ?? (
    dependencies.fetchBars
      ? async (input) => identityPriceBundle(
          await dependencies.fetchBars(input),
          input.source,
          now.toISOString(),
        )
      : defaultFetchPriceBundle
  );
  let previousManifest = await readHistoryManifest(root).catch(() => null);
  if (previousManifest?.scope === "full") {
    previousManifest = await recoverHistoryManifestFromSeries(previousManifest, root);
  }
  if (previousManifest && previousManifest.source !== options.source) {
    throw new HistoryInitializationError(
      "HISTORY_SOURCE_CONFLICT",
      `历史基础库已固定使用 ${historySourceLabel(previousManifest.source)}，不能混用 ${historySourceLabel(options.source)}`,
    );
  }
  const previousResumeAt = Date.parse(String(previousManifest?.resumeAfter ?? ""));
  if (previousManifest?.paused === true && Number.isFinite(previousResumeAt) && previousResumeAt > Date.now()) {
    throw new HistoryInitializationError(
      "HISTORY_SOURCE_COOLDOWN",
      `历史数据源正在冷却保护，最早 ${formatResumeTime(previousResumeAt)} 后可继续；冷却期间不会发起历史请求`,
    );
  }
  if (!dependencies.fetchBars && !dependencies.fetchPriceBundle) {
    resolveSourceCandidates({
      market: "cn",
      adjust: "qfq",
      requestedSource: options.source,
    });
  }
  const previousScope = Object.hasOwn(SCOPE_RANK, previousManifest?.scope) ? previousManifest.scope : "core";
  const effectiveScope = SCOPE_RANK[options.scope] >= SCOPE_RANK[previousScope] ? options.scope : previousScope;
  const effectiveLimit = effectiveScope === "full"
    ? null
    : Math.max(SCOPES[effectiveScope], previousManifest?.scope === "full" ? 0 : previousManifest?.limit ?? 0);
  const pacing = historyInitializationPacing(effectiveScope);
  const requestIntervalMs = Number.isFinite(dependencies.requestIntervalMs)
    ? Math.max(0, Number(dependencies.requestIntervalMs))
    : pacing.requestIntervalMs;
  const retryDelaysMs = Array.isArray(dependencies.retryDelaysMs)
    ? dependencies.retryDelaysMs
      .map(Number)
      .filter((delay) => Number.isFinite(delay) && delay >= 0 && delay <= 10 * 60_000)
    : pacing.retryDelaysMs;
  const sourceFailureLimit = Number.isInteger(dependencies.sourceFailureLimit)
    ? Math.max(1, dependencies.sourceFailureLimit)
    : pacing.sourceFailureLimit;
  const concurrency = Number.isInteger(dependencies.concurrency)
    ? Math.max(1, Math.min(4, dependencies.concurrency))
    : pacing.concurrency;
  const startedAt = Date.now();

  progress(emitProgress, { stage: "universe", message: "正在核对全市场股票与最新交易日" });
  const [{ marketDate, asOf }, quotes] = await Promise.all([getTimestamp(), getQuotes()]);
  const clock = chinaClock(now);
  const provisional = clock.date === marketDate && clock.minutes < 15 * 60 + 10;
  const previousClose = clock.date !== marketDate;
  const sessionPhase = provisional ? "intraday" : previousClose ? "previous-close" : "close";
  const withoutProvisionalBundle = (bundle) => {
    if (!provisional) return bundle;
    const rawBars = bundle.rawBars.filter((bar) => bar.date < marketDate);
    const factorByDate = new Map(bundle.adjustmentFactors.map((item) => [item.date, item]));
    const factors = rawBars.map((bar) => factorByDate.get(bar.date)).filter(Boolean);
    const latestFactor = factors.at(-1)?.factor;
    if (!Number.isFinite(latestFactor) || latestFactor <= 0) return bundle;
    return createRawFactorPriceBundle({
      rawBars,
      adjustmentFactors: factors.map((item) => ({
        date: item.date,
        factor: item.factor / latestFactor,
      })),
      source: bundle.priceModel.rawSource,
      factorSource: bundle.priceModel.factorSource,
      factorMethod: bundle.priceModel.factorMethod,
      generatedAt: now.toISOString(),
    });
  };
  const preparation = effectiveScope === "full"
    ? Object.freeze({
        total: quotes.length,
        eligible: Object.freeze([...quotes]),
        selected: Object.freeze([...new Map(quotes
          .filter((quote) => /^(?:SH|SZ)\d{6}$/u.test(quote?.symbol) && String(quote?.name ?? "").trim())
          .map((quote) => [quote.symbol, quote])).values()]
          .sort((left, right) => left.symbol.localeCompare(right.symbol))),
        rejected: Object.freeze({}),
        limit: quotes.length,
      })
    : prepareHistoryUniverse(quotes, { limit: effectiveLimit });
  if (preparation.selected.length < Math.min(20, effectiveLimit ?? 20)) {
    throw new HistoryInitializationError(
      "HISTORY_UNIVERSE_LOW",
      `only ${preparation.selected.length} stocks passed the initialization universe`,
    );
  }
  const from = addDays(marketDate, -(YEARS * 366 + 14));
  const initialBundles = new Map();
  if (!previousManifest) {
    const probe = preparation.selected[0];
    const cachedProbe = await readHistorySeries(probe.symbol, root).catch(() => null);
    if (!(cachedProbe?.source === options.source && usableForResearch(cachedProbe, marketDate))) {
      progress(emitProgress, {
        stage: "source",
        completed: 0,
        total: preparation.selected.length,
        loaded: 0,
        skipped: 0,
        failed: 0,
        unavailable: 0,
        message: `正在检查 ${historySourceLabel(options.source)} 的历史日线可用性`,
      });
      try {
        const bundle = withoutProvisionalBundle(await getPriceBundle({
          symbol: probe.symbol,
          from,
          to: marketDate,
          source: options.source,
          beforeAdditionalRequest: async () => {
            if (requestIntervalMs > 0) {
              await new Promise((resolveDelay) => setTimeout(resolveDelay, requestIntervalMs));
            }
          },
        }));
        if (!Array.isArray(bundle?.bars) || bundle.bars.length < 60) {
          throw new Error("返回的有效日线不足 60 根");
        }
        initialBundles.set(probe.symbol, bundle);
      } catch (error) {
        throw new HistoryInitializationError(
          "HISTORY_SOURCE_UNAVAILABLE",
          `${historySourceLabel(options.source)}可用性检查失败：${error instanceof Error ? error.message : "无法读取历史日线"}`,
        );
      }
    }
  }
  const selectedSymbols = new Set(preparation.selected.map((quote) => quote.symbol));
  const excludedSymbols = new Set(
    (Array.isArray(previousManifest?.excludedSymbols) ? previousManifest.excludedSymbols : [])
      .map(String)
      .filter((symbol) => /^(?:SH|SZ)\d{6}$/u.test(symbol) && !selectedSymbols.has(symbol)),
  );
  if (effectiveScope === "full") {
    for (const record of Array.isArray(previousManifest?.records) ? previousManifest.records : []) {
      if (/^(?:SH|SZ)\d{6}$/u.test(String(record?.symbol ?? "")) && !selectedSymbols.has(record.symbol)) {
        excludedSymbols.add(record.symbol);
      }
    }
  }
  // A full-market manifest describes the current listed universe. Keep old
  // series files recoverable on disk, but do not let delisted/renamed records
  // inflate ready/cached counts or appear as false date gaps in the UI.
  const existingRecords = new Map(
    historyManifestRecordsForScope(previousManifest?.records, selectedSymbols, effectiveScope)
      .map((item) => [item.symbol, item]),
  );
  const selectedReady = new Set([...existingRecords.values()]
    .filter((record) => selectedSymbols.has(record.symbol))
    .filter((record) => recordUsableForResearch(record, marketDate, options.source))
    .map((record) => record.symbol));
  const workItems = [...preparation.selected].sort((left, right) => {
    const leftRecord = existingRecords.get(left.symbol);
    const rightRecord = existingRecords.get(right.symbol);
    const priority = (record) => {
      if (options.incrementalOnly) {
        // Daily autofill should repair an existing lagging series before it
        // scans current local rows and only then retries unavailable/new
        // listings. That makes the useful update durable before slow retries.
        if (record && (record.source !== options.source || String(record.to ?? "") < marketDate)) return 0;
        if (record) return 1;
        return 2;
      }
      if (!record) return 0;
      return recordUsableForResearch(record, marketDate, options.source) ? 2 : 1;
    };
    const priorityDifference = priority(leftRecord) - priority(rightRecord);
    if (priorityDifference !== 0) return priorityDifference;
    const dateDifference = String(leftRecord?.to ?? "").localeCompare(String(rightRecord?.to ?? ""));
    return dateDifference || left.symbol.localeCompare(right.symbol);
  });
  const failures = [];
  let completed = 0;
  let loaded = 0;
  let skipped = 0;
  let rebuilt = 0;
  let overlapValidated = 0;
  let basisMismatches = 0;
  let overlapCorrections = 0;
  let migrated = 0;
  let factorRebased = 0;
  let nextIndex = 0;
  let nextRequestAt = 0;
  let sourceRetryAt = 0;
  let consecutiveSourceFailures = 0;
  let sourcePaused = false;
  let sourceResumeAfter = null;
  let networkRequestCount = 0;
  let lastCooldownRequestCount = 0;

  progress(emitProgress, {
    stage: "history",
    completed,
    total: preparation.selected.length,
    loaded,
    skipped,
    ...historyOutcomeCounts(failures),
    message: `${historySourceLabel(options.source)} · ${options.incrementalOnly ? "先补落后交易日，再重试未覆盖股票" : "先补未完成和过旧股票，再更新已覆盖股票"}；联网请求至少间隔 ${(requestIntervalMs / 1_000).toFixed(1)} 秒`,
  });

  async function throttle() {
    if (
      pacing.batchSize > 0 &&
      networkRequestCount > 0 &&
      networkRequestCount % pacing.batchSize === 0 &&
      lastCooldownRequestCount !== networkRequestCount
    ) {
      lastCooldownRequestCount = networkRequestCount;
      sourceRetryAt = Math.max(sourceRetryAt, Date.now() + pacing.batchCooldownMs);
      progress(emitProgress, {
        stage: "source",
        completed,
        total: preparation.selected.length,
        loaded,
        skipped,
        ...historyOutcomeCounts(failures),
        message: `已完成 ${networkRequestCount} 次联网请求，主动休息 ${Math.ceil(pacing.batchCooldownMs / 60_000)} 分钟保护数据源`,
      });
    }
    while (true) {
      const scheduledAt = Math.max(Date.now(), nextRequestAt, sourceRetryAt);
      nextRequestAt = scheduledAt + requestIntervalMs;
      const delay = scheduledAt - Date.now();
      if (delay > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
      if (Date.now() >= sourceRetryAt) {
        networkRequestCount += 1;
        return;
      }
    }
  }

  async function fetchPriceBundleReliably(input) {
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      await throttle();
      try {
        const bundle = await getPriceBundle({ ...input, beforeAdditionalRequest: throttle });
        consecutiveSourceFailures = 0;
        return withoutProvisionalBundle(bundle);
      } catch (error) {
        const retryable = RETRYABLE_SOURCE_ERRORS.has(String(error?.code ?? ""));
        if (!retryable) throw error;
        const requestedDelay = Number(error?.retryAfterMs);
        if (Number.isFinite(requestedDelay) && requestedDelay > MAX_IN_PROCESS_RETRY_DELAY_MS) {
          sourcePaused = true;
          sourceResumeAfter = new Date(Date.now() + requestedDelay).toISOString();
          throw error;
        }
        if (attempt < retryDelaysMs.length) {
          const delay = Math.max(
            retryDelaysMs[attempt],
            Number.isFinite(requestedDelay) && requestedDelay >= 0 ? requestedDelay : 0,
          );
          sourceRetryAt = Math.max(sourceRetryAt, Date.now() + delay);
          progress(emitProgress, {
            stage: "source",
            completed,
            total: preparation.selected.length,
            loaded,
            skipped,
            ...historyOutcomeCounts(failures),
            message: `历史数据源响应受限，${Math.max(1, Math.ceil(delay / 1_000))} 秒后自动重试`,
          });
          continue;
        }
        consecutiveSourceFailures += 1;
        if (consecutiveSourceFailures >= sourceFailureLimit) {
          sourcePaused = true;
          const cooldownMs = Math.max(
            pacing.pauseCooldownMs,
            Number.isFinite(requestedDelay) && requestedDelay >= 0 ? requestedDelay : 0,
          );
          sourceResumeAfter = new Date(Date.now() + cooldownMs).toISOString();
        }
        throw error;
      }
    }
    throw new HistoryInitializationError("HISTORY_FETCH_ERROR", "history raw-price/factor source retry exhausted");
  }

  function buildManifest() {
    const records = [...existingRecords.values()].sort((left, right) => left.symbol.localeCompare(right.symbol));
    const rawFactorReady = records.filter((record) => record.priceModel === "raw-factor").length;
    const legacyVendorAdjusted = records.length - rawFactorReady;
    const dates = records.flatMap((record) => [record.from, record.to]).filter(Boolean).sort();
    const outcomes = historyOutcomeCounts(failures);
    const networkPassComplete = completed === preparation.selected.length &&
      !sourcePaused &&
      !failures.some((failure) => RETRYABLE_SOURCE_ERRORS.has(failure.errorCode));
    const auditEvent = Object.freeze({
      at: now.toISOString(),
      kind: previousManifest
        ? (previousManifest.snapshotGapDates?.length || previousManifest.snapshotBackfillDeferred > 0 ? "gap-fill" : "incremental")
        : "initialization",
      from: previousManifest?.confirmedThrough ?? previousManifest?.to ?? null,
      through: dates.at(-1) ?? null,
      requestedGapDates: Array.isArray(previousManifest?.snapshotGapDates)
        ? previousManifest.snapshotGapDates.slice(0, 15)
        : [],
      updatedSeries: loaded,
      addedBars: 0,
      skippedSeries: skipped,
      failedSeries: outcomes.failed,
      status: sourcePaused
        ? "paused"
        : completed < preparation.selected.length
          ? "running"
          : outcomes.failed > 0 || selectedReady.size < preparation.selected.length
            ? "partial"
            : "complete",
    });
    const previousAudit = Array.isArray(previousManifest?.auditTrail)
      ? previousManifest.auditTrail.filter((event) => event?.at !== auditEvent.at).slice(-4)
      : [];
    return Object.freeze({
      schemaVersion: A_SHARE_HISTORY_SCHEMA_VERSION,
      kind: A_SHARE_HISTORY_MANIFEST_KIND,
      scope: effectiveScope,
      limit: effectiveScope === "full" ? preparation.selected.length : effectiveLimit,
      years: YEARS,
      source: options.source,
      adjust: "qfq",
      marketDate,
      asOf,
      updatedAt: now.toISOString(),
      total: preparation.selected.length,
      // Research-usable cached series may still need their latest close. Their
      // actual coverage remains in records/date distribution, not this count.
      ready: selectedReady.size,
      remaining: Math.max(0, preparation.selected.length - selectedReady.size),
      attempted: completed,
      paused: sourcePaused,
      resumeAfter: sourcePaused ? sourceResumeAfter : null,
      cached: records.length,
      failed: outcomes.failed,
      unavailable: outcomes.unavailable,
      bars: records.reduce((sum, record) => sum + Number(record.bars ?? 0), 0),
      storageBytes: records.reduce((sum, record) => sum + Number(record.bytes ?? 0), 0),
      from: dates[0] ?? null,
      to: dates.at(-1) ?? null,
      loaded,
      skipped,
      rebuilt,
      overlapValidated,
      basisMismatches,
      overlapCorrections,
      migrated,
      factorRebased,
      rawFactorReady,
      legacyVendorAdjusted,
      priceModel: legacyVendorAdjusted === 0 ? "raw-factor" : "mixed-migration",
      sessionPhase,
      provisional,
      confirmedThrough: dates.at(-1) ?? null,
      // Only an exhausted pass without transient source failures checks the
      // whole scope. A checkpoint or outage must remain resumable even when
      // older cached series are still research-usable. Successfully checked
      // suspended/new listings may stay behind without repeating this pass.
      networkCheckedThrough: networkPassComplete
        ? marketDate
        : previousManifest?.networkCheckedThrough ?? null,
      basisContract: A_SHARE_RESEARCH_PRICE_CONTRACT,
      recentSnapshotCoverage: Array.isArray(previousManifest?.recentSnapshotCoverage)
        ? previousManifest.recentSnapshotCoverage.slice(-5)
        : [],
      excludedSymbols: effectiveScope === "full" ? [...excludedSymbols].sort() : [],
      failures: failures.slice(0, 30),
      elapsedMs: Date.now() - startedAt,
      auditTrail: [...previousAudit, auditEvent],
      records,
    });
  }

  async function checkpointManifest() {
    if (
      sourcePaused ||
      completed === 0 ||
      pacing.checkpointEvery <= 0 ||
      completed % pacing.checkpointEvery !== 0 ||
      completed >= preparation.selected.length
    ) return;
    await writeHistoryManifest(buildManifest(), root);
    await heartbeatHistoryRunState(runLock.state, root, new Date());
    progress(emitProgress, {
      stage: "checkpoint",
      completed,
      total: preparation.selected.length,
      loaded,
      skipped,
      ...historyOutcomeCounts(failures),
      message: `已保存进度清单 ${selectedReady.size}/${preparation.selected.length}，中断后可从这里续跑`,
    });
  }

  async function worker() {
    while (nextIndex < workItems.length && !sourcePaused) {
      const index = nextIndex;
      nextIndex += 1;
      const quote = workItems[index];
      const queuedRecord = existingRecords.get(quote.symbol);
      const queuedForNetwork = !queuedRecord ||
        queuedRecord.source !== options.source ||
        String(queuedRecord.to ?? "") < marketDate;
      selectedReady.delete(quote.symbol);
      try {
        let series = await readHistorySeries(quote.symbol, root);
        if (series?.source !== options.source) series = null;
        let updated = false;
        let basisRebuilt = false;
        const legacyPriceModel = series?.priceModel?.kind !== "raw-factor";
        const needsRefresh = !closeEnoughToTarget(series, marketDate, provisional);
        const shouldMigrate = Boolean(
          series && legacyPriceModel && !provisional && !options.incrementalOnly,
        );
        if (!series || needsRefresh || shouldMigrate) {
          let bundle;
          let validationStatus = series ? "migrated" : "initial";
          let overlapBars = 0;
          let mismatchBars = 0;
          if (series?.priceModel?.kind === "raw-factor") {
            const overlapFrom = addDays(series.bars.at(-1).date, -21);
            const incremental = await fetchPriceBundleReliably({
              symbol: quote.symbol,
              from: overlapFrom,
              to: marketDate,
              source: options.source,
            });
            const merged = mergeRawFactorPriceBundles(series, incremental, now.toISOString());
            overlapBars = merged.overlapCount;
            overlapValidated += overlapBars;
            if (merged.rebuilt) {
              mismatchBars = overlapBars;
              basisMismatches += mismatchBars;
              bundle = await fetchPriceBundleReliably({
                symbol: quote.symbol,
                from,
                to: marketDate,
                source: options.source,
              });
              validationStatus = "rebuilt";
              basisRebuilt = true;
            } else {
              bundle = merged;
              validationStatus = merged.factorChanged ? "factor-rebased" : "matched";
              if (merged.factorChanged) factorRebased += 1;
            }
          } else {
            bundle = initialBundles.get(quote.symbol) ?? await fetchPriceBundleReliably({
              symbol: quote.symbol,
              from,
              to: marketDate,
              source: options.source,
            });
            initialBundles.delete(quote.symbol);
            if (series) migrated += 1;
          }
          series = buildDerivedSeries({
            quote,
            bundle,
            marketDate,
            updatedAt: now.toISOString(),
            validation: {
              status: validationStatus,
              checkedAt: now.toISOString(),
              overlapBars,
              mismatchBars,
              correctionBars: 0,
              confirmedThrough: bundle.bars.at(-1)?.date,
              provisionalBarExcluded: provisional,
            },
          });
          if (!Array.isArray(series?.bars) || series.bars.length < 60) {
            throw new HistoryInitializationError(
              "HISTORY_NOT_USABLE",
              `${quote.symbol} has fewer than 60 valid daily bars`,
            );
          }
          const saved = await writeHistorySeries(series, root);
          series = saved.series;
          existingRecords.set(quote.symbol, recordFor(series, saved.bytes));
          updated = true;
        } else {
          const bytes = await seriesBytes(quote.symbol, root);
          existingRecords.set(quote.symbol, recordFor(series, bytes));
        }
        if (!usableForResearch(series, marketDate)) {
          throw new HistoryInitializationError(
            "HISTORY_NOT_USABLE",
            `${quote.symbol} history is too short or stale for research`,
          );
        }
        selectedReady.add(quote.symbol);
        if (updated) loaded += 1;
        else skipped += 1;
        if (basisRebuilt) rebuilt += 1;
      } catch (error) {
        const fallback = await readHistorySeries(quote.symbol, root).catch(() => null);
        if (fallback?.source === options.source && usableForResearch(fallback, marketDate)) {
          const bytes = await seriesBytes(quote.symbol, root).catch(() => 0);
          existingRecords.set(quote.symbol, recordFor(fallback, bytes));
          selectedReady.add(quote.symbol);
        }
        const errorCode = String(error?.code ?? "HISTORY_FETCH_ERROR").slice(0, 80);
        failures.push({
          symbol: quote.symbol,
          name: quote.name,
          errorCode: TEMPORARILY_UNAVAILABLE_ERRORS.has(errorCode) ? "HISTORY_NOT_USABLE" : errorCode,
        });
      } finally {
        completed += 1;
        if (!options.incrementalOnly || queuedForNetwork || completed % 100 === 0 || completed === workItems.length) {
          progress(emitProgress, {
            stage: "history",
            completed,
            total: preparation.selected.length,
            loaded,
            skipped,
            ...historyOutcomeCounts(failures),
            current: quote.symbol,
            message: `${quote.name} ${quote.symbol}`,
          });
        }
        await checkpointManifest();
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(concurrency, workItems.length) },
    () => worker(),
  ));

  const manifest = buildManifest();
  await writeHistoryManifest(manifest, root);
  progress(emitProgress, {
    stage: "complete",
    completed,
    total: preparation.selected.length,
    loaded,
    skipped,
    ...historyOutcomeCounts(failures),
    message: sourcePaused
      ? `历史数据源持续受限，已安全暂停并保存 ${selectedReady.size}/${preparation.selected.length} 只；最早 ${formatResumeTime(sourceResumeAfter)} 后续跑`
      : `历史基础库已准备 ${selectedReady.size}/${preparation.selected.length} 只`,
  });
  writeOutput(`${JSON.stringify(compactHistoryBridgeSummary(manifest))}\n`);
  return manifest;
  } finally {
    await releaseHistoryRunState(runLock.state, root);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      type: "history-error",
      errorCode: error?.code ?? "HISTORY_INITIALIZATION_ERROR",
      message: error instanceof Error ? error.message : "history initialization failed",
    })}\n`);
    process.exitCode = 1;
  });
}
