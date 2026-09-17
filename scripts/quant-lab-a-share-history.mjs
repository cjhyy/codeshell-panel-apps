import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  acquireHistoryRunState,
  createRawFactorPriceBundle,
  deriveAdjustmentFactors,
  deriveQfqResearchBars,
  mergeIncrementalHistory,
  mergeRawFactorPriceBundles,
  readActiveHistoryRunState,
  readHistoryManifest,
  readHistorySeries,
  readUsableHistory,
  releaseHistoryRunState,
  sanitizeHistoryBars,
  writeHistoryManifest,
  writeHistorySeries,
} from "../apps/quant-lab/app/tools/a-share-history-cache.mjs";
import {
  compactHistoryBridgeSummary,
  historyManifestRecordsForScope,
  historyInitializationPacing,
  normalizeHistoryInitializationOptions,
  runCli,
} from "../apps/quant-lab/app/tools/initialize-a-share-history.mjs";
import {
  estimatedHistoryRemainingMs,
  formatHistoryDuration,
  historyAutofillNeeded,
  historyCoveragePresentation,
  historyLibraryRuntimeArgs,
  parseHistoryLibrarySummary,
} from "../apps/quant-lab/app/modules/history-data-ui.mjs";
import { writeLocalSnapshot } from "../apps/quant-lab/app/tools/local-snapshot-store.mjs";

assert.equal(estimatedHistoryRemainingMs({ completed: 100, total: 1_000, elapsedMs: 10 * 60_000 }), 90 * 60_000);
assert.equal(formatHistoryDuration(90 * 60_000), "1 小时 30 分钟");
assert.deepEqual(
  historyManifestRecordsForScope(
    [{ symbol: "SH600000" }, { symbol: "SZ000001" }, { symbol: "SH688432" }],
    new Set(["SH600000", "SZ000001"]),
    "full",
  ).map((item) => item.symbol),
  ["SH600000", "SZ000001"],
  "full-market coverage must exclude retained series outside the current listed universe",
);
assert.equal(
  historyManifestRecordsForScope([{ symbol: "SH600000" }, { symbol: "SH688432" }], new Set(["SH600000"]), "core").length,
  2,
  "smaller scopes must retain cached records for later expansion",
);
assert.equal(estimatedHistoryRemainingMs({ completed: 4, total: 1_000, elapsedMs: 60_000 }), null);
const automaticFillNow = new Date("2026-09-03T10:00:00.000Z");
assert.equal(historyAutofillNeeded({
  to: "2026-08-31",
  paused: true,
  resumeAfter: "2026-09-03T11:00:00.000Z",
}, "2026-09-03", automaticFillNow), false, "active source cooldown must be respected");
assert.equal(historyAutofillNeeded({
  to: "2026-08-31",
  paused: true,
  resumeAfter: "2026-09-03T09:00:00.000Z",
}, "2026-09-03", automaticFillNow), true, "expired source cooldown must resume automatically");
assert.equal(historyAutofillNeeded({
  to: "2026-09-03",
  snapshotBackfillThrough: "2026-09-03",
  snapshotBackfillDeferred: 0,
}, "2026-09-03", automaticFillNow), false, "a current complete library must not refetch");
assert.deepEqual(historyCoveragePresentation({
  marketDate: "2026-09-03",
  networkCheckedThrough: "2026-09-03",
  confirmedThrough: "2026-09-03",
  ready: 5_115,
  total: 5_208,
  remaining: 93,
  years: 3,
}), {
  state: "current",
  through: "2026-09-03",
  current: true,
  coverage: "5,115 / 5,208 可用",
  note: "5,115 / 5,208 可用 · 93 只暂不可用",
}, "current date must stay primary even when new or unavailable stocks remain");
assert.equal(historyAutofillNeeded({
  to: "2026-09-03",
  snapshotBackfillThrough: "2026-09-03",
  snapshotBackfillDeferred: 2,
}, "2026-09-03", automaticFillNow), true, "new deferred continuity checks require one network pass");
assert.equal(historyAutofillNeeded({
  to: "2026-09-03",
  snapshotBackfillThrough: "2026-09-03",
  snapshotBackfillDeferred: 2,
  networkCheckedThrough: "2026-09-03",
}, "2026-09-03", automaticFillNow), false, "the same unresolved per-stock rows must not relaunch a full-market pass forever");
assert.equal(historyAutofillNeeded({
  to: "2026-09-04",
  snapshotBackfillThrough: "2026-09-04",
  snapshotBackfillDeferred: 2,
  networkCheckedThrough: "2026-09-03",
}, "2026-09-04", automaticFillNow), true, "a newer close reopens network verification");

assert.deepEqual(normalizeHistoryInitializationOptions(["--scope", "core", "--stdout"]), {
  scope: "core",
  source: "tencent-ifzq",
  limit: 120,
  years: 3,
  incrementalOnly: false,
  stdout: true,
  help: false,
  status: false,
});
assert.deepEqual(historyInitializationPacing("full"), {
  concurrency: 1,
  requestIntervalMs: 3_000,
  retryDelaysMs: [30_000, 120_000, 300_000],
  sourceFailureLimit: 1,
  batchSize: 200,
  batchCooldownMs: 60_000,
  pauseCooldownMs: 30 * 60_000,
  checkpointEvery: 100,
});
assert.equal(historyInitializationPacing("core").concurrency, 1);
assert(historyInitializationPacing("core").requestIntervalMs < historyInitializationPacing("full").requestIntervalMs);
assert.throws(() => historyInitializationPacing("unknown"), /scope must be/u);
assert.equal(normalizeHistoryInitializationOptions(["--status", "--stdout"]).status, true);
assert.equal(normalizeHistoryInitializationOptions(["--scope", "broad", "--stdout"]).limit, 300);
const legacyLimitedSummary = parseHistoryLibrarySummary({
  schemaVersion: 1,
  kind: "a-share-history-library",
  scope: "full",
  source: "tencent-ifzq",
  adjust: "qfq",
  limit: 5_207,
  years: 3,
  marketDate: "2026-08-28",
  updatedAt: "2026-08-30T06:27:42.817Z",
  total: 5_207,
  ready: 468,
  cached: 468,
  failed: 4_739,
  bars: 344_503,
  storageBytes: 31_733_631,
  loaded: 178,
  skipped: 290,
  rebuilt: 0,
  failures: [
    { symbol: "SH600256", name: "广汇能源", errorCode: "SOURCE_HTTP" },
    { symbol: "SH600258", name: "首旅酒店", errorCode: "SOURCE_HTTP" },
  ],
});
assert.equal(legacyLimitedSummary.ready, 468);
assert.equal(legacyLimitedSummary.remaining, 4_739);
assert.equal(legacyLimitedSummary.failed, 0, "legacy bulk failures are unfinished coverage, not fresh per-stock failures");
assert.equal(legacyLimitedSummary.paused, true);
assert.equal(legacyLimitedSummary.legacyInterrupted, true);
assert.equal(legacyLimitedSummary.basisContract, "tencent-ifzq:cn:1d:qfq:v1");
assert.equal(legacyLimitedSummary.confirmedThrough, null);
assert.equal(legacyLimitedSummary.overlapValidated, 0);
assert.equal(legacyLimitedSummary.basisMismatches, 0);
assert.equal(legacyLimitedSummary.overlapCorrections, 0);
assert.equal(parseHistoryLibrarySummary(legacyLimitedSummary).legacyInterrupted, true, "legacy normalization must survive storage round-trips");
assert.equal(parseHistoryLibrarySummary(legacyLimitedSummary).resumeAfter, null);
assert.equal(parseHistoryLibrarySummary({
  ...legacyLimitedSummary,
  resumeAfter: "2026-08-31T18:00:00.000Z",
}).resumeAfter, "2026-08-31T18:00:00.000Z");
assert.throws(() => parseHistoryLibrarySummary({ ...legacyLimitedSummary, resumeAfter: "later" }), /resumeAfter/u);
assert.equal(parseHistoryLibrarySummary({ ...legacyLimitedSummary, running: true, runScope: "full", runStartedAt: "2026-08-31T17:15:00.000Z" }).running, true);
assert.deepEqual(parseHistoryLibrarySummary({
  ...legacyLimitedSummary,
  marketDate: "2026-09-01",
  recentSnapshotCoverage: [
    { date: "2026-08-31", count: 5_207, phase: "close" },
    { date: "2026-09-01", count: 5_208, phase: "previous-close" },
  ],
}).recentSnapshotCoverage, [
  { date: "2026-08-31", count: 5_207, phase: "close" },
  { date: "2026-09-01", count: 5_208, phase: "previous-close" },
]);
assert.throws(() => parseHistoryLibrarySummary({
  ...legacyLimitedSummary,
  recentSnapshotCoverage: [
    { date: "2026-08-31", count: 5_207, phase: "close" },
    { date: "2026-08-31", count: 5_208, phase: "close" },
  ],
}), /收盘快照覆盖条目/u);
const coverageSummary = parseHistoryLibrarySummary({
  ...legacyLimitedSummary,
  marketDate: "2026-09-02",
  latestDateDistribution: undefined,
  records: [
    { symbol: "SH600000", to: "2026-08-31" },
    { symbol: "SZ000001", to: "2026-09-01" },
    { symbol: "SZ000001", to: "2026-09-02" },
    { symbol: "invalid", to: "2026-09-02" },
  ],
});
assert.deepEqual(coverageSummary.latestDateDistribution, [
  { date: "2026-09-02", count: 1 },
  { date: "2026-08-31", count: 1 },
]);
assert.throws(() => parseHistoryLibrarySummary({ ...legacyLimitedSummary, running: "yes" }), /running 无效/u);
assert.throws(() => parseHistoryLibrarySummary({ ...legacyLimitedSummary, basisContract: "eastmoney-kline:cn:1d:qfq:v1" }), /价格口径标识/u);
assert.throws(() => parseHistoryLibrarySummary({ ...legacyLimitedSummary, overlapValidated: 1, basisMismatches: 2 }), /差异数超过/u);
assert.throws(() => parseHistoryLibrarySummary({ ...legacyLimitedSummary, overlapValidated: 1, overlapCorrections: 2 }), /修订数超过/u);
const shortHistorySummary = parseHistoryLibrarySummary({
  ...legacyLimitedSummary,
  scope: "core",
  limit: 120,
  total: 120,
  ready: 119,
  remaining: 1,
  attempted: 120,
  paused: false,
  legacyInterrupted: false,
  cached: 120,
  rawFactorReady: 0,
  legacyVendorAdjusted: 120,
  failed: 1,
  unavailable: null,
  loaded: 119,
  skipped: 0,
  failures: [{ symbol: "SH603293", name: "上市不足样本", errorCode: "HISTORY_NOT_USABLE" }],
});
assert.equal(shortHistorySummary.unavailable, 1);
assert.equal(shortHistorySummary.failed, 0, "insufficient listing history is not a network or task failure");
assert.deepEqual(normalizeHistoryInitializationOptions(["--scope", "full", "--stdout"]), {
  scope: "full",
  source: "tencent-ifzq",
  limit: null,
  years: 3,
  incrementalOnly: false,
  stdout: true,
  help: false,
  status: false,
});
assert.equal(
  normalizeHistoryInitializationOptions(["--source", "tushare-pro", "--stdout"]).source,
  "tushare-pro",
);
assert.equal(
  normalizeHistoryInitializationOptions(["--source", "eastmoney-kline", "--stdout"]).source,
  "eastmoney-kline",
);
assert.throws(() => normalizeHistoryInitializationOptions(["--scope", "everything"]), /core, broad, or full/u);
assert.throws(
  () => normalizeHistoryInitializationOptions(["--source", "alpha-vantage"]),
  /A-share raw prices and adjustment factors/u,
);
assert(historyLibraryRuntimeArgs("node", "core").includes("--input-type=module"));
assert.equal(historyLibraryRuntimeArgs("bun", "broad").includes("--input-type=module"), false);
assert(historyLibraryRuntimeArgs("node", "full").includes("full"));
assert(historyLibraryRuntimeArgs("node", "core", "initialize", "tushare-pro").includes("tushare-pro"));
assert(historyLibraryRuntimeArgs("node", "core", "initialize", "eastmoney-kline").includes("eastmoney-kline"));
assert(historyLibraryRuntimeArgs("node", "full", "autofill").includes("autofill"));
assert.equal(
  normalizeHistoryInitializationOptions(["--scope", "full", "--incremental-only", "--stdout"]).incrementalOnly,
  true,
);
assert.throws(
  () => historyLibraryRuntimeArgs("node", "core", "initialize", "alpha-vantage"),
  /请选择/u,
);
assert.throws(() => historyLibraryRuntimeArgs("python", "core"), /不受支持/u);

const bar = (date, close) => ({
  date,
  open: close - 0.2,
  high: close + 0.5,
  low: close - 0.5,
  close,
  volume: 1_000_000,
});
const rawFactorRaw = [bar("2026-08-23", 8), bar("2026-08-24", 9), bar("2026-08-25", 10)];
const rawFactorAdjusted = [bar("2026-08-23", 4), bar("2026-08-24", 4.5), bar("2026-08-25", 10)];
const derivedFactors = deriveAdjustmentFactors(rawFactorRaw, rawFactorAdjusted);
assert.deepEqual(derivedFactors.map((item) => item.factor), [0.5, 0.5, 1]);
assert.deepEqual(
  deriveQfqResearchBars(rawFactorRaw, derivedFactors).map((item) => item.close),
  [4, 4.5, 10],
);
const previousPriceBundle = createRawFactorPriceBundle({
  rawBars: rawFactorRaw,
  adjustmentFactors: rawFactorRaw.map((item) => ({ date: item.date, factor: 1 })),
  source: "tencent-ifzq",
  factorMethod: "derived-qfq-ratio",
  generatedAt: "2026-08-25T09:00:00.000Z",
});
const incrementalPriceBundle = createRawFactorPriceBundle({
  rawBars: [bar("2026-08-24", 9), bar("2026-08-25", 10), bar("2026-08-26", 11)],
  adjustmentFactors: [
    { date: "2026-08-24", factor: 0.5 },
    { date: "2026-08-25", factor: 0.5 },
    { date: "2026-08-26", factor: 1 },
  ],
  source: "tencent-ifzq",
  factorMethod: "derived-qfq-ratio",
  generatedAt: "2026-08-26T09:00:00.000Z",
});
const factorRebasedBundle = mergeRawFactorPriceBundles({
  ...previousPriceBundle,
  priceModel: previousPriceBundle.priceModel,
}, incrementalPriceBundle, "2026-08-26T09:00:00.000Z");
assert.equal(factorRebasedBundle.rebuilt, false);
assert.equal(factorRebasedBundle.factorChanged, true);
assert.equal(factorRebasedBundle.adjustmentFactors[0].factor, 0.5);
assert.deepEqual(factorRebasedBundle.bars.map((item) => item.close), [4, 4.5, 5, 11]);
assert.deepEqual(sanitizeHistoryBars([
  bar("2026-08-25", 10),
  { ...bar("2026-08-24", 9), high: 8 },
  bar("2026-08-25", 10.1),
]).map((item) => item.close), [10.1]);
const unchangedBasis = mergeIncrementalHistory(
  [bar("2026-08-24", 9), bar("2026-08-25", 10)],
  [bar("2026-08-25", 10), bar("2026-08-26", 11)],
);
assert.equal(unchangedBasis.rebuilt, false);
assert.equal(unchangedBasis.overlapCount, 1);
assert.equal(unchangedBasis.mismatchCount, 0);
assert.deepEqual(unchangedBasis.bars.map((item) => item.date), ["2026-08-24", "2026-08-25", "2026-08-26"]);
const changedBasis = mergeIncrementalHistory(
  [bar("2026-08-22", 7), bar("2026-08-23", 8), bar("2026-08-24", 9), bar("2026-08-25", 10)],
  [bar("2026-08-22", 6), bar("2026-08-23", 7), bar("2026-08-24", 8), bar("2026-08-25", 9), bar("2026-08-26", 10)],
);
assert.equal(changedBasis.rebuilt, true, "a broad qfq overlap shift must trigger a full rebuild");
assert.equal(changedBasis.mismatchCount, 4);
const earlierOverlapChanged = mergeIncrementalHistory(
  [bar("2026-08-23", 8), bar("2026-08-24", 9), bar("2026-08-25", 10)],
  [bar("2026-08-23", 7), bar("2026-08-24", 9), bar("2026-08-25", 10), bar("2026-08-26", 11)],
);
assert.equal(earlierOverlapChanged.rebuilt, false, "a single corrected price bar must merge without a three-year rebuild");
assert.equal(earlierOverlapChanged.reason, "overlap-corrected");
assert.deepEqual(earlierOverlapChanged.correctionDates, ["2026-08-23"]);
assert.equal(earlierOverlapChanged.bars[0].close, 7, "every overlap bar must still be audited and corrected");
const revisedVolume = mergeIncrementalHistory(
  [bar("2026-08-24", 9), bar("2026-08-25", 10)],
  [bar("2026-08-24", 9), { ...bar("2026-08-25", 10), volume: 999_900 }],
);
assert.equal(revisedVolume.rebuilt, false, "a volume correction must not cause an extra full-history request");
assert.equal(revisedVolume.correctionCount, 1);
assert.equal(revisedVolume.bars.at(-1).volume, 999_900);

const recoveryTemporary = await mkdtemp(join(tmpdir(), "quant-lab-history-recovery-"));
try {
  const recoveryBars = Array.from({ length: 75 }, (_value, index) => {
    const instant = new Date("2026-06-18T00:00:00.000Z");
    instant.setUTCDate(instant.getUTCDate() + index);
    return bar(instant.toISOString().slice(0, 10), 10 + index / 10);
  });
  const saved = [];
  for (const [symbol, name] of [
    ["SH600000", "恢复样本一"],
    ["SH600001", "恢复样本二"],
    ["SH600002", "已退出当前在市池"],
  ]) {
    saved.push(await writeHistorySeries({
      schemaVersion: 1,
      kind: "a-share-history-series",
      symbol,
      name,
      adjust: "qfq",
      source: "tencent-ifzq",
      marketDate: "2026-08-31",
      updatedAt: "2026-08-31T17:15:00.000Z",
      bars: recoveryBars,
    }, recoveryTemporary));
  }
  assert.equal(saved[0].series.priceModel.kind, "legacy-vendor-qfq");
  const firstRecord = {
    symbol: saved[0].series.symbol,
    name: saved[0].series.name,
    from: saved[0].series.bars[0].date,
    to: saved[0].series.bars.at(-1).date,
    bars: saved[0].series.bars.length,
    bytes: saved[0].bytes,
    updatedAt: saved[0].series.updatedAt,
    source: saved[0].series.source,
  };
  await writeHistoryManifest({
    schemaVersion: 1,
    kind: "a-share-history-library",
    scope: "full",
    limit: 20,
    years: 3,
    source: "tencent-ifzq",
    adjust: "qfq",
    marketDate: "2026-08-28",
    asOf: "2026-08-28T15:00:00+08:00",
    updatedAt: "2026-08-28T08:00:00.000Z",
    total: 20,
    ready: 1,
    failed: 19,
    bars: firstRecord.bars,
    storageBytes: firstRecord.bytes,
    from: firstRecord.from,
    to: firstRecord.to,
    loaded: 1,
    skipped: 0,
    rebuilt: 0,
    failures: [{ symbol: "SH600002", name: "旧版限流样本", errorCode: "SOURCE_HTTP" }],
    records: [firstRecord],
  }, recoveryTemporary);
  const currentUniverseSymbols = [
    "SH600000",
    "SH600001",
    ...Array.from({ length: 18 }, (_value, index) => `SH${String(600003 + index).padStart(6, "0")}`),
  ];
  await writeLocalSnapshot({
    root: recoveryTemporary,
    stream: "a-share-realtime",
    scope: "global",
    snapshot: {
      schemaVersion: 1,
      kind: "a-share-realtime-daily-snapshot",
      marketDate: "2026-08-31",
      asOf: "2026-08-31T15:00:00+08:00",
      generatedAt: "2026-08-31T08:00:00.000Z",
      session: { phase: "close", provisional: false, previousClose: false },
      quoteCount: currentUniverseSymbols.length,
      quotes: currentUniverseSymbols.map((symbol) => ({
        symbol,
        name: `在市 ${symbol}`,
        open: 10,
        high: 10.2,
        low: 9.8,
        price: 10.1,
        previousClose: 10,
        volume: 1_000_000,
      })),
    },
  });
  const recoveredStatus = await runCli(["--status", "--stdout"], {
    root: recoveryTemporary,
    stdout: () => undefined,
  });
  assert.equal(recoveredStatus.ready, 2, "status must recover valid series omitted by an interrupted manifest write");
  assert.equal(recoveredStatus.cached, 2);
  assert.equal(recoveredStatus.remaining, 18);
  assert.equal(recoveredStatus.failed, 0, "legacy bulk limit errors must not survive local-file recovery");
  assert.equal(recoveredStatus.marketDate, "2026-08-31");
  const recoveredManifest = await readHistoryManifest(recoveryTemporary);
  assert.equal(recoveredManifest.records.length, 2);
  assert.deepEqual(recoveredManifest.excludedSymbols, ["SH600002"]);
  assert.deepEqual(recoveredManifest.recentSnapshotCoverage, [
    { date: "2026-08-31", count: 20, phase: "close" },
  ]);
  assert.equal(
    recoveredManifest.records.some((record) => record.symbol === "SH600002"),
    false,
    "a retained file outside a complete current-universe snapshot must not inflate status recovery",
  );
  const repeatedRecoveryStatus = await runCli(["--status", "--stdout"], {
    root: recoveryTemporary,
    stdout: () => undefined,
  });
  assert.equal(repeatedRecoveryStatus.cached, 2, "the persisted exclusion must prevent a later status read from restoring the file again");
} finally {
  await rm(recoveryTemporary, { recursive: true, force: true });
}

const snapshotBackfillTemporary = await mkdtemp(join(tmpdir(), "quant-lab-history-snapshot-backfill-"));
try {
  const datedBars = (close) => Array.from({ length: 75 }, (_value, index) => {
    const instant = new Date("2026-06-18T00:00:00.000Z");
    instant.setUTCDate(instant.getUTCDate() + index);
    return bar(instant.toISOString().slice(0, 10), close);
  });
  const legacySaved = await writeHistorySeries({
    schemaVersion: 1,
    kind: "a-share-history-series",
    symbol: "SH600000",
    name: "自动补齐旧版样本",
    adjust: "qfq",
    source: "tencent-ifzq",
    marketDate: "2026-08-31",
    updatedAt: "2026-08-31T17:15:00.000Z",
    bars: datedBars(10),
  }, snapshotBackfillTemporary);
  const rawBundle = createRawFactorPriceBundle({
    rawBars: datedBars(20),
    adjustmentFactors: datedBars(20).map((item) => ({ date: item.date, factor: 1 })),
    source: "tencent-ifzq",
    factorMethod: "derived-qfq-ratio",
    generatedAt: "2026-08-31T17:15:00.000Z",
  });
  const rawSaved = await writeHistorySeries({
    schemaVersion: 1,
    kind: "a-share-history-series",
    symbol: "SZ000001",
    name: "自动补齐新版样本",
    adjust: "qfq",
    source: "tencent-ifzq",
    marketDate: "2026-08-31",
    updatedAt: "2026-08-31T17:15:00.000Z",
    rawBars: rawBundle.rawBars,
    adjustmentFactors: rawBundle.adjustmentFactors,
    priceModel: rawBundle.priceModel,
  }, snapshotBackfillTemporary);
  const deferredSaved = await writeHistorySeries({
    schemaVersion: 1,
    kind: "a-share-history-series",
    symbol: "SH600001",
    name: "除权断点样本",
    adjust: "qfq",
    source: "tencent-ifzq",
    marketDate: "2026-08-31",
    updatedAt: "2026-08-31T17:15:00.000Z",
    bars: datedBars(30),
  }, snapshotBackfillTemporary);
  const record = (saved) => ({
    symbol: saved.series.symbol,
    name: saved.series.name,
    from: saved.series.bars[0].date,
    to: saved.series.bars.at(-1).date,
    bars: saved.series.bars.length,
    bytes: saved.bytes,
    updatedAt: saved.series.updatedAt,
    source: saved.series.source,
    priceModel: saved.series.priceModel.kind,
    rawSource: saved.series.priceModel.rawSource,
    factorSource: saved.series.priceModel.factorSource,
    factorMethod: saved.series.priceModel.factorMethod,
    basisContract: saved.series.basis.contract,
    validationStatus: saved.series.validation.status,
    confirmedThrough: saved.series.validation.confirmedThrough,
  });
  const initialRecords = [legacySaved, rawSaved, deferredSaved].map(record);
  await writeHistoryManifest({
    schemaVersion: 1,
    kind: "a-share-history-library",
    scope: "core",
    limit: 120,
    years: 3,
    source: "tencent-ifzq",
    adjust: "qfq",
    marketDate: "2026-08-31",
    asOf: "2026-08-31T15:00:00+08:00",
    updatedAt: "2026-08-31T17:15:00.000Z",
    total: 120,
    ready: 3,
    remaining: 117,
    attempted: 3,
    paused: false,
    cached: 3,
    failed: 0,
    unavailable: 0,
    bars: initialRecords.reduce((sum, item) => sum + item.bars, 0),
    storageBytes: initialRecords.reduce((sum, item) => sum + item.bytes, 0),
    from: initialRecords[0].from,
    to: "2026-08-31",
    loaded: 3,
    skipped: 0,
    rebuilt: 0,
    failures: [],
    records: initialRecords,
  }, snapshotBackfillTemporary);
  const closeQuote = (symbol, name, previousClose, close) => ({
    symbol,
    name,
    open: previousClose,
    high: Math.max(previousClose, close) + 0.2,
    low: Math.min(previousClose, close) - 0.2,
    price: close,
    previousClose,
    volume: 1_200_000,
  });
  const closeDays = [
    ["2026-09-01", 10, 11, 20, 21],
    ["2026-09-02", 11, 12, 21, 22],
    ["2026-09-03", 12, 13, 22, 23],
  ];
  for (const [marketDate, legacyPrevious, legacyClose, rawPrevious, rawClose] of closeDays) {
    const quotes = [
      closeQuote("SH600000", "自动补齐旧版样本", legacyPrevious, legacyClose),
      closeQuote("SZ000001", "自动补齐新版样本", rawPrevious, rawClose),
      closeQuote("SH600001", "除权断点样本", 29.99, 30.2),
    ];
    await writeLocalSnapshot({
      root: snapshotBackfillTemporary,
      stream: "a-share-realtime",
      scope: "global",
      snapshot: {
        schemaVersion: 1,
        kind: "a-share-realtime-daily-snapshot",
        marketDate,
        asOf: `${marketDate}T15:00:00+08:00`,
        generatedAt: `${marketDate}T08:00:00.000Z`,
        session: marketDate === "2026-09-03"
          ? { phase: "previous-close", provisional: false, previousClose: true }
          : { phase: "close", provisional: false, previousClose: false },
        quoteCount: quotes.length,
        quotes,
      },
    });
  }
  const backfilled = await runCli(["--status", "--stdout"], {
    root: snapshotBackfillTemporary,
    now: new Date("2026-09-03T10:00:00.000Z"),
    stdout: () => undefined,
  });
  assert.equal(backfilled.marketDate, "2026-09-03");
  assert.equal(backfilled.to, "2026-09-03");
  assert.equal(backfilled.snapshotBackfillThrough, "2026-09-03");
  assert.equal(backfilled.snapshotBackfilledSeries, 2);
  assert.equal(backfilled.snapshotBackfilledBars, 6);
  assert.equal(backfilled.snapshotBackfillDeferred, 1, "a corporate-action discontinuity must wait for source verification");
  assert.deepEqual(backfilled.recentSnapshotCoverage, [
    { date: "2026-09-01", count: 3, phase: "close" },
    { date: "2026-09-02", count: 3, phase: "close" },
    { date: "2026-09-03", count: 3, phase: "previous-close" },
  ]);
  assert.equal(backfilled.auditTrail.at(-1).kind, "snapshot-fill");
  assert.equal(backfilled.auditTrail.at(-1).updatedSeries, 2);
  assert.equal(backfilled.auditTrail.at(-1).addedBars, 6);
  assert.equal(backfilled.auditTrail.at(-1).status, "partial");
  assert.equal(backfilled.snapshotBackfillThrough, "2026-09-03", "a next-session previous-close snapshot is a finalized daily bar");
  assert.equal((await readHistorySeries("SH600000", snapshotBackfillTemporary)).bars.at(-1).close, 13);
  assert.equal((await readHistorySeries("SH600000", snapshotBackfillTemporary)).validation.status, "snapshot-appended");
  const rawBackfilled = await readHistorySeries("SZ000001", snapshotBackfillTemporary);
  assert.equal(rawBackfilled.rawBars.at(-1).close, 23);
  assert.equal(rawBackfilled.adjustmentFactors.at(-1).factor, 1);
  assert.equal(rawBackfilled.validation.status, "snapshot-appended");
  assert.equal((await readHistorySeries("SH600001", snapshotBackfillTemporary)).bars.at(-1).date, "2026-08-31");
  const parsedBackfill = parseHistoryLibrarySummary(backfilled);
  assert.equal(parsedBackfill.snapshotBackfilledSeries, 2);
  assert.equal(parsedBackfill.snapshotBackfilledBars, 6);
  assert.equal(parsedBackfill.snapshotBackfillDeferred, 1);
  assert.equal(parsedBackfill.auditTrail.at(-1).kind, "snapshot-fill");
  const persistedBeforeRepeat = await readHistoryManifest(snapshotBackfillTemporary);
  const repeated = await runCli(["--status", "--stdout"], {
    root: snapshotBackfillTemporary,
    now: new Date("2026-09-03T10:05:00.000Z"),
    stdout: () => undefined,
  });
  assert.equal(repeated.updatedAt, persistedBeforeRepeat.updatedAt, "a repeated local reconcile must be idempotent");
  assert.equal((await readHistorySeries("SH600000", snapshotBackfillTemporary)).bars.length, 78);
  assert.equal((await readHistorySeries("SZ000001", snapshotBackfillTemporary)).bars.length, 78);
} finally {
  await rm(snapshotBackfillTemporary, { recursive: true, force: true });
}

const snapshotGapTemporary = await mkdtemp(join(tmpdir(), "quant-lab-history-snapshot-gap-"));
try {
  const gapBars = Array.from({ length: 75 }, (_value, index) => {
    const instant = new Date("2026-06-18T00:00:00.000Z");
    instant.setUTCDate(instant.getUTCDate() + index);
    return bar(instant.toISOString().slice(0, 10), 10);
  });
  const saved = await writeHistorySeries({
    schemaVersion: 1,
    kind: "a-share-history-series",
    symbol: "SH600000",
    name: "中间缺口样本",
    adjust: "qfq",
    source: "tencent-ifzq",
    marketDate: "2026-08-31",
    updatedAt: "2026-08-31T17:15:00.000Z",
    bars: gapBars,
  }, snapshotGapTemporary);
  const seriesRecord = {
    symbol: saved.series.symbol,
    name: saved.series.name,
    from: saved.series.bars[0].date,
    to: saved.series.bars.at(-1).date,
    bars: saved.series.bars.length,
    bytes: saved.bytes,
    updatedAt: saved.series.updatedAt,
    source: saved.series.source,
    priceModel: saved.series.priceModel.kind,
    rawSource: saved.series.priceModel.rawSource,
    factorSource: saved.series.priceModel.factorSource,
    factorMethod: saved.series.priceModel.factorMethod,
    basisContract: saved.series.basis.contract,
    validationStatus: saved.series.validation.status,
    confirmedThrough: saved.series.validation.confirmedThrough,
  };
  await writeHistoryManifest({
    schemaVersion: 1,
    kind: "a-share-history-library",
    scope: "core",
    limit: 120,
    years: 3,
    source: "tencent-ifzq",
    adjust: "qfq",
    marketDate: "2026-08-31",
    asOf: "2026-08-31T15:00:00+08:00",
    updatedAt: "2026-08-31T17:15:00.000Z",
    total: 120,
    ready: 1,
    remaining: 119,
    attempted: 1,
    paused: false,
    cached: 1,
    failed: 0,
    unavailable: 0,
    bars: seriesRecord.bars,
    storageBytes: seriesRecord.bytes,
    from: seriesRecord.from,
    to: seriesRecord.to,
    loaded: 1,
    skipped: 0,
    rebuilt: 0,
    failures: [],
    records: [seriesRecord],
  }, snapshotGapTemporary);
  const quote = { symbol: "SH600000", name: "中间缺口样本", open: 10, high: 11.2, low: 9.8, price: 11, previousClose: 10, volume: 1_200_000 };
  await writeLocalSnapshot({
    root: snapshotGapTemporary,
    stream: "a-share-realtime",
    scope: "global",
    snapshot: {
      schemaVersion: 1,
      kind: "a-share-realtime-daily-snapshot",
      marketDate: "2026-09-03",
      asOf: "2026-09-03T15:00:00+08:00",
      generatedAt: "2026-09-03T08:00:00.000Z",
      session: { phase: "close", provisional: false, previousClose: false },
      quoteCount: 1,
      quotes: [quote],
    },
  });
  const gapStatus = await runCli(["--status", "--stdout"], {
    root: snapshotGapTemporary,
    now: new Date("2026-09-03T10:00:00.000Z"),
    stdout: () => undefined,
  });
  assert.equal(gapStatus.snapshotBackfillDeferred, 1);
  assert.equal(gapStatus.snapshotGapSeries, 1);
  assert.deepEqual(gapStatus.snapshotGapDates, ["2026-09-01", "2026-09-02"]);
  assert.equal((await readHistorySeries("SH600000", snapshotGapTemporary)).bars.at(-1).date, "2026-08-31", "a later snapshot must not jump over missing weekdays");
  const parsedGap = parseHistoryLibrarySummary(gapStatus);
  assert.deepEqual(parsedGap.snapshotGapDates, ["2026-09-01", "2026-09-02"]);
} finally {
  await rm(snapshotGapTemporary, { recursive: true, force: true });
}

const temporary = await mkdtemp(join(tmpdir(), "quant-lab-history-"));
try {
  const quotes = Array.from({ length: 20 }, (_value, index) => ({
    symbol: `${index % 2 ? "SZ" : "SH"}${String(600_000 + index).padStart(6, "0")}`,
    name: `历史样本${index + 1}`,
    price: 20 + index,
    open: 19 + index,
    high: 21 + index,
    low: 18 + index,
    previousClose: 19.5 + index,
    volume: 10_000_000,
    amount: 5_000_000_000 - index * 10_000_000,
    turnover: 2 + index / 100,
    changePercent: 1 + index / 100,
    floatMarketCap: 50_000_000_000,
    totalMarketCap: 80_000_000_000,
    pe: 20,
    pb: 3,
    board: "main",
  }));
  quotes.push(
    {
      ...quotes[0],
      symbol: "SH688888",
      name: "ST历史低流动样本",
      amount: 10_000,
      turnover: 0,
    },
    {
      ...quotes[1],
      symbol: "SZ300999",
      name: "历史低流动样本",
      amount: 20_000,
      turnover: 0.01,
    },
  );
  const allBars = Array.from({ length: 75 }, (_value, index) => {
    const instant = new Date("2026-06-13T00:00:00.000Z");
    instant.setUTCDate(instant.getUTCDate() + index);
    return bar(instant.toISOString().slice(0, 10), 10 + index / 10);
  });
  let fetchCount = 0;
  let activeFetches = 0;
  let maximumActiveFetches = 0;
  let checkpointObserved = null;
  let initializationOutput = "";
  const requestedSources = [];
  let marketDate = "2026-08-26";
  const dependencies = {
    root: temporary,
    now: new Date("2026-08-26T08:30:00.000Z"),
    fetchMarketTimestamp: async () => ({ marketDate, asOf: `${marketDate}T15:00:00+08:00` }),
    fetchAllQuotes: async () => quotes,
    fetchBars: async ({ from, to, source }) => {
      if (fetchCount === 5) checkpointObserved = await readHistoryManifest(temporary);
      activeFetches += 1;
      maximumActiveFetches = Math.max(maximumActiveFetches, activeFetches);
      await Promise.resolve();
      fetchCount += 1;
      requestedSources.push(source);
      const result = allBars.filter((item) => item.date >= from && item.date <= to);
      activeFetches -= 1;
      return result;
    },
    progress: () => undefined,
    stdout: (line) => { initializationOutput += line; },
    requestIntervalMs: 0,
    retryDelaysMs: [0],
  };
  const first = await runCli(
    ["--scope", "core", "--source", "tushare-pro", "--stdout"],
    dependencies,
  );
  assert.equal(first.total, 20);
  assert.equal(first.ready, 20);
  assert.equal(first.loaded, 20);
  assert.equal(first.failed, 0);
  assert.equal(first.remaining, 0);
  assert.equal(first.paused, false);
  assert.equal(fetchCount, 20);
  assert.equal(maximumActiveFetches, 1, "history initialization must never overlap provider requests");
  assert.equal(checkpointObserved?.attempted, 5, "long initialization must checkpoint its manifest before completion");
  assert.equal(checkpointObserved?.ready, 5);
  assert.equal(checkpointObserved?.remaining, 15);
  const compactInitialization = JSON.parse(initializationOutput);
  assert.equal(compactInitialization.records, undefined, "completion bridge payload must omit per-symbol records");
  assert.deepEqual(compactInitialization.latestDateDistribution, [{ date: marketDate, count: 20 }]);
  assert(initializationOutput.length < 20_000, "completion bridge payload must remain compact");
  assert.equal(compactHistoryBridgeSummary(first).records, undefined);
  assert.equal(compactHistoryBridgeSummary({ ...first, recovered: 3 }).recovered, undefined);
  assert(requestedSources.every((source) => source === "tushare-pro"));
  assert.equal((await readHistoryManifest(temporary)).source, "tushare-pro");
  assert.equal((await readHistoryManifest(temporary)).adjust, "qfq");
  assert.equal((await readHistoryManifest(temporary)).ready, 20);
  const usable = await readUsableHistory(quotes[0].symbol, marketDate, { root: temporary });
  assert.equal(usable?.bars.length, 75);
  assert.equal(usable?.source, "tushare-pro");
  assert.equal(usable?.basis.contract, "canonical:cn:1d:qfq:raw-factor:v1");
  assert.equal(usable?.priceModel.kind, "raw-factor");
  assert.equal(usable?.priceModel.rawSource, "tushare-pro");
  assert.equal(usable?.rawBars.length, 75);
  assert.equal(usable?.adjustmentFactors.length, 75);
  const storedPriceFile = JSON.parse(await readFile(join(
    temporary,
    "a-share-history/v1/series",
    `${quotes[0].symbol}.json`,
  ), "utf8"));
  assert.equal(storedPriceFile.bars, undefined, "derived qfq bars must be generated on read, not duplicated on disk");
  assert.equal(storedPriceFile.rawBars.length, 75);
  assert.equal(storedPriceFile.adjustmentFactors.length, 75);
  assert.equal(usable?.validation.status, "initial");
  const firstSummary = parseHistoryLibrarySummary(first);
  assert.equal(firstSummary.source, "tushare-pro");
  assert.equal(firstSummary.basisContract, "canonical:cn:1d:qfq:raw-factor:v1");
  assert.equal(firstSummary.rawFactorReady, 20);
  assert.equal(firstSummary.legacyVendorAdjusted, 0);
  assert.equal(firstSummary.sessionPhase, "close");
  assert.equal(firstSummary.provisional, false);
  assert.equal(firstSummary.confirmedThrough, marketDate);
  assert.equal(firstSummary.networkCheckedThrough, marketDate);
  assert.equal(firstSummary.auditTrail.at(-1).kind, "initialization");
  assert.equal(firstSummary.auditTrail.at(-1).status, "complete");
  assert.equal(firstSummary.auditTrail.at(-1).updatedSeries, 20);
  let compactStatusOutput = "";
  await runCli(["--status", "--stdout"], {
    ...dependencies,
    stdout: (line) => { compactStatusOutput += line; },
  });
  const compactStatus = JSON.parse(compactStatusOutput);
  assert.equal(compactStatus.records, undefined, "status bridge payload must omit the full per-symbol manifest");
  assert.deepEqual(compactStatus.latestDateDistribution, [{ date: marketDate, count: 20 }]);
  assert(compactStatusOutput.length < 20_000, "status bridge payload must remain compact");
  assert.deepEqual(parseHistoryLibrarySummary(compactStatus).latestDateDistribution, [{ date: marketDate, count: 20 }]);

  const backgroundRun = await acquireHistoryRunState({
    scope: "core",
    source: "tushare-pro",
    now: new Date(),
  }, temporary);
  assert.equal(backgroundRun.acquired, true);
  assert.equal((await readActiveHistoryRunState(temporary))?.scope, "core");
  const statusWhileRunning = await runCli(["--status", "--stdout"], dependencies);
  assert.equal(statusWhileRunning.running, true, "status must expose a live initializer from another window");
  await assert.rejects(
    runCli(["--scope", "core", "--source", "tushare-pro", "--stdout"], dependencies),
    /另一个窗口/u,
    "a second initializer must not run against the same private library",
  );
  assert.equal(await releaseHistoryRunState(backgroundRun.state, temporary), true);
  assert.equal((await runCli(["--status", "--stdout"], dependencies)).running, false);

  const second = await runCli(
    ["--scope", "core", "--source", "tushare-pro", "--stdout"],
    dependencies,
  );
  assert.equal(second.loaded, 0);
  assert.equal(second.skipped, 20);
  assert.equal(second.networkCheckedThrough, marketDate);
  assert.equal(parseHistoryLibrarySummary(second).auditTrail.at(-1).kind, "incremental");
  assert.equal(fetchCount, 20, "same-market-date updates must reuse the initialized cache");

  marketDate = "2026-08-27";
  dependencies.now = new Date("2026-08-27T08:30:00.000Z");
  allBars.push(bar("2026-08-27", 17.5));
  const third = await runCli(
    ["--scope", "core", "--source", "tushare-pro", "--stdout"],
    dependencies,
  );
  assert.equal(third.loaded, 20);
  assert.equal(third.rebuilt, 0);
  assert.equal(third.overlapValidated, 440, "all 22 overlap bars per stock must be audited");
  assert.equal(third.basisMismatches, 0);
  const thirdSummary = parseHistoryLibrarySummary(third);
  assert.equal(thirdSummary.overlapValidated, 440);
  assert.equal(thirdSummary.basisMismatches, 0);
  assert.equal(thirdSummary.overlapCorrections, 0);
  assert.equal(thirdSummary.confirmedThrough, "2026-08-27");
  assert.equal(thirdSummary.networkCheckedThrough, "2026-08-27");
  assert.equal(thirdSummary.auditTrail.at(-1).kind, "incremental");
  assert(thirdSummary.auditTrail.length <= 5);
  assert.equal(fetchCount, 40, "incremental update should fetch one overlap window per stock");
  const full = await runCli(
    ["--scope", "full", "--source", "tushare-pro", "--stdout"],
    dependencies,
  );
  assert.equal(full.scope, "full");
  assert.equal(full.limit, 22);
  assert.equal(full.total, 22);
  assert.equal(full.ready, 22);
  assert.equal(full.loaded, 2, "full-market expansion must add stocks rejected by the core liquidity preset");
  assert.equal(full.skipped, 20);
  assert.equal(fetchCount, 42);
  assert.equal(parseHistoryLibrarySummary(full).scope, "full");
  assert.equal((await readHistoryManifest(temporary)).scope, "full");
  quotes.push(
    { ...quotes[0], symbol: "SZ399991", name: "待补齐样本 1" },
    { ...quotes[0], symbol: "SZ399992", name: "待补齐样本 2" },
    { ...quotes[0], symbol: "SZ399993", name: "待补齐样本 3" },
  );
  marketDate = "2026-08-28";
  dependencies.now = new Date("2026-08-28T08:30:00.000Z");
  let outageFetchCount = 0;
  const outageSymbols = [];
  const paused = await runCli(
    ["--scope", "full", "--source", "tushare-pro", "--stdout"],
    {
      ...dependencies,
      sourceFailureLimit: 3,
      fetchBars: async ({ symbol }) => {
        outageFetchCount += 1;
        outageSymbols.push(symbol);
        const error = new Error("HTTP 429");
        error.code = "SOURCE_HTTP";
        throw error;
      },
    },
  );
  assert.equal(paused.paused, true, "repeated source HTTP errors must pause the run");
  assert.equal(paused.ready, 22, "previous usable files must remain available after a source outage");
  assert.equal(paused.remaining, 3);
  assert(paused.attempted < paused.total, "a paused run must not mark the untouched market as failed");
  assert(paused.failed < paused.total);
  assert(outageFetchCount > paused.failed, "transient source errors should be retried before pausing");
  assert.equal(outageSymbols[0], "SZ399991", "resumed runs must fill missing coverage before refreshing cached stocks");
  assert.equal(parseHistoryLibrarySummary(paused).paused, true);
  assert.equal(parseHistoryLibrarySummary(paused).remaining, 3);
  assert(Number.isFinite(Date.parse(paused.resumeAfter)), "a provider pause must persist its earliest safe resume time");
  let cooldownNetworkStarted = false;
  await assert.rejects(
    runCli(["--scope", "full", "--source", "tushare-pro", "--stdout"], {
      ...dependencies,
      fetchMarketTimestamp: async () => {
        cooldownNetworkStarted = true;
        return { marketDate, asOf: `${marketDate}T15:00:00+08:00` };
      },
    }),
    /冷却保护/u,
    "clicking again during the persisted cooldown must stop before any market request",
  );
  assert.equal(cooldownNetworkStarted, false);
  await assert.rejects(
    runCli(["--scope", "core", "--source", "tencent-ifzq", "--stdout"], dependencies),
    /不能混用/u,
  );
  const shortTemporary = await mkdtemp(join(tmpdir(), "quant-lab-history-short-"));
  try {
    const shortSymbols = [quotes[17].symbol, quotes[18].symbol, quotes[19].symbol];
    const short = await runCli(
      ["--scope", "core", "--source", "tushare-pro", "--stdout"],
      {
        ...dependencies,
        root: shortTemporary,
        fetchAllQuotes: async () => quotes.slice(0, 20),
        fetchBars: async ({ symbol }) => {
          if (symbol === shortSymbols[0]) return allBars.slice(-2);
          if (symbol === shortSymbols[1]) {
            const error = new Error("provider returned no rows");
            error.code = "SOURCE_EMPTY";
            throw error;
          }
          if (symbol === shortSymbols[2]) {
            const error = new Error("provider returned raw rows but no qfq rows");
            error.code = "SOURCE_ADJUST_UNAVAILABLE";
            throw error;
          }
          return allBars;
        },
      },
    );
    assert.equal(short.ready, 17);
    assert.equal(short.remaining, 3);
    assert.equal(short.unavailable, 3);
    assert.equal(short.failed, 0);
    assert(short.failures.every((failure) => failure.errorCode === "HISTORY_NOT_USABLE"));
    assert.equal(parseHistoryLibrarySummary(short).unavailable, 3);
  } finally {
    await rm(shortTemporary, { recursive: true, force: true });
  }
  const probeTemporary = await mkdtemp(join(tmpdir(), "quant-lab-history-probe-"));
  try {
    await assert.rejects(
      runCli(["--scope", "core", "--source", "eastmoney-kline", "--stdout"], {
        ...dependencies,
        root: probeTemporary,
        fetchBars: async () => {
          throw new Error("upstream unavailable");
        },
      }),
      /东方财富可用性检查失败/u,
      "a new library must fail during source probing instead of producing a partial empty library",
    );
    assert.equal(await readHistoryManifest(probeTemporary), null);
  } finally {
    await rm(probeTemporary, { recursive: true, force: true });
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}

const intradayTemporary = await mkdtemp(join(tmpdir(), "quant-lab-history-intraday-"));
try {
  const marketDate = "2026-08-27";
  const quotes = Array.from({ length: 20 }, (_value, index) => ({
    symbol: `${index % 2 ? "SZ" : "SH"}${String(600_100 + index).padStart(6, "0")}`,
    name: `盘中确认样本${index + 1}`,
    price: 20 + index,
    open: 19 + index,
    high: 21 + index,
    low: 18 + index,
    previousClose: 19.5 + index,
    volume: 10_000_000,
    amount: 5_000_000_000 - index * 10_000_000,
    turnover: 2,
    changePercent: 1,
    floatMarketCap: 50_000_000_000,
    totalMarketCap: 80_000_000_000,
    pe: 20,
    pb: 3,
    board: "main",
  }));
  const bars = Array.from({ length: 75 }, (_value, index) => {
    const instant = new Date("2026-06-14T00:00:00.000Z");
    instant.setUTCDate(instant.getUTCDate() + index);
    return bar(instant.toISOString().slice(0, 10), 10 + index / 10);
  });
  let fetches = 0;
  const dependencies = {
    root: intradayTemporary,
    now: new Date("2026-08-27T04:00:00.000Z"),
    fetchMarketTimestamp: async () => ({ marketDate, asOf: `${marketDate}T12:00:00+08:00` }),
    fetchAllQuotes: async () => quotes,
    fetchBars: async () => {
      fetches += 1;
      return bars;
    },
    progress: () => undefined,
    stdout: () => undefined,
    requestIntervalMs: 0,
    retryDelaysMs: [0],
  };
  const first = await runCli(["--scope", "core", "--source", "tencent-ifzq", "--stdout"], dependencies);
  assert.equal(first.sessionPhase, "intraday");
  assert.equal(first.provisional, true);
  assert.equal(first.confirmedThrough, "2026-08-26");
  const saved = await readHistorySeries(quotes[0].symbol, intradayTemporary);
  assert.equal(saved.bars.at(-1).date, "2026-08-26", "the current intraday bar must not enter confirmed history");
  assert.equal(saved.validation.provisionalBarExcluded, true);
  assert.equal(fetches, 20);
  const second = await runCli(["--scope", "core", "--source", "tencent-ifzq", "--stdout"], dependencies);
  assert.equal(second.skipped, 20);
  assert.equal(fetches, 20, "an intraday rerun must reuse yesterday's confirmed close without network requests");
} finally {
  await rm(intradayTemporary, { recursive: true, force: true });
}

console.log("✓ Quant Lab resumable A-share history initialization and incremental cache contract");
