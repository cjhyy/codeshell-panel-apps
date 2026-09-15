import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const {
  HISTORY_DATA_SOURCES,
  MARKET_DATA_PROVIDER_CONTRACT,
  historyDataSourceCapability,
  historyDataSourcesForCapability,
  validateHistoryDataSourceDefinition,
  collectHistoryProcessOutput,
  historyAutofillNeeded,
  historyCoveragePresentation,
  historyDataRuntimeArgs,
  normalizeHistoryRequest,
  parseHistoryDatasetMeta,
  parseHistorySyncBundle,
} = await import(
  pathToFileURL(
    join(repositoryRoot, "apps", "quant-lab", "app", "modules", "history-data-ui.mjs"),
  ).href
);

assert.equal(historyCoveragePresentation({
  ready: 5_115,
  total: 5_208,
  remaining: 93,
  years: 3,
  networkCheckedThrough: "2026-09-01",
  snapshotBackfillThrough: "2026-09-02",
  confirmedThrough: "2026-09-03",
  to: "2026-09-03",
}, "2026-09-03").through, "2026-09-03", "the newest trusted coverage date must win");
assert.equal(historyAutofillNeeded({
  ready: 5_115,
  total: 5_208,
  attempted: 5_208,
  paused: false,
  running: false,
  snapshotBackfillThrough: "2026-09-02",
  confirmedThrough: "2026-09-03",
  to: "2026-09-03",
  snapshotBackfillDeferred: 0,
}, "2026-09-03", new Date("2026-09-04T00:00:00.000Z")), false);
const { fingerprintBars, parseOhlcvCsv } = await import(
  pathToFileURL(join(repositoryRoot, "apps", "quant-lab", "app", "engine.mjs")).href
);

const fullMarketProcessRecord = { stdout: "", stderr: "", stderrPending: "" };
const progressLines = Array.from({ length: 6_000 }, (_value, index) =>
  `${JSON.stringify({ type: "history-progress", completed: index + 1, total: 6_000, message: `样本 ${index + 1}` })}\n`
).join("");
const collectedProgress = collectHistoryProcessOutput(fullMarketProcessRecord, "stderr", progressLines);
assert.equal(collectedProgress.overflow, false, "full-market progress must not trip the output guard");
assert.equal(collectedProgress.lines.length, 6_000);
assert(fullMarketProcessRecord.stderr.length <= 64_000, "only a bounded diagnostic tail should be retained");
assert.equal(fullMarketProcessRecord.stderrPending, "");
assert.equal(
  collectHistoryProcessOutput(fullMarketProcessRecord, "stdout", "x".repeat(1_500_000)).overflow,
  false,
  "a full-market final manifest must fit in the dedicated stdout allowance",
);
assert.equal(
  collectHistoryProcessOutput({ stdout: "", stderr: "", stderrPending: "" }, "stderr", "x".repeat(16_001)).overflow,
  true,
  "an unterminated oversized diagnostic line must still be rejected",
);

assert.deepEqual(
  HISTORY_DATA_SOURCES.filter((source) => source.state === "ready").map((source) => source.id),
  ["tencent-ifzq", "eastmoney-kline", "yahoo-finance"],
);
assert.deepEqual(
  HISTORY_DATA_SOURCES.filter((source) => source.state === "credential-required").map(
    (source) => source.id,
  ),
  ["tushare-pro", "alpha-vantage", "massive"],
);
assert(Object.isFrozen(HISTORY_DATA_SOURCES));
assert(HISTORY_DATA_SOURCES.every((source) => Object.isFrozen(source)));
assert.equal(MARKET_DATA_PROVIDER_CONTRACT.version, 1);
assert(HISTORY_DATA_SOURCES.every((source) => source.contract === "codeshell.market-data-provider/v1"));
assert(HISTORY_DATA_SOURCES.every((source) => Object.isFrozen(source.auth) && Object.isFrozen(source.capabilities)));
assert.deepEqual(
  historyDataSourcesForCapability("adjustmentFactors").map((source) => source.id),
  ["tencent-ifzq", "tushare-pro"],
);
assert.equal(historyDataSourceCapability("tencent-ifzq", "adjustmentFactors"), "derived");
assert.equal(historyDataSourceCapability("missing", "daily"), "unavailable");
assert.equal(historyDataSourceCapability("tencent-ifzq", "unknown"), "unavailable");
assert.equal(validateHistoryDataSourceDefinition({
  id: "sample-provider",
  label: "Sample",
  markets: ["cn"],
  adjustments: ["none"],
  origins: ["https://example.com"],
  auth: { type: "none" },
  capabilities: {
    daily: "native", adjustmentFactors: "unavailable", realtime: "unavailable",
    minute: "unavailable", financials: "unavailable", orderBook: "unavailable",
  },
}), true);
assert.throws(() => validateHistoryDataSourceDefinition({
  id: "unsafe-provider",
  label: "Unsafe",
  markets: ["cn"],
  adjustments: ["none"],
  origins: ["http://example.com"],
  auth: { type: "none" },
  capabilities: {
    daily: "native", adjustmentFactors: "unavailable", realtime: "unavailable",
    minute: "unavailable", financials: "unavailable", orderBook: "unavailable",
  },
}), /HTTPS origins/u);

assert.deepEqual(normalizeHistoryRequest({
  market: "cn",
  symbol: "600519",
  adjust: "qfq",
  from: "2015-01-01",
  to: "2026-08-26",
}), {
  market: "cn",
  symbol: "SH600519",
  adjust: "qfq",
  from: "2015-01-01",
  to: "2026-08-26",
  source: "auto",
  csvPath: "data/market/SH600519.csv",
});
assert.equal(normalizeHistoryRequest({
  market: "cn",
  source: "tushare-pro",
  symbol: "600519",
  adjust: "hfq",
  from: "2015-01-01",
  to: "2026-08-26",
}).source, "tushare-pro");
assert.equal(normalizeHistoryRequest({
  market: "us",
  source: "massive",
  symbol: "AAPL",
  adjust: "split",
  from: "2015-01-01",
  to: "2026-08-26",
}).adjust, "split");
assert.equal(normalizeHistoryRequest({
  market: "us",
  symbol: "brk.b",
  adjust: "adj",
  from: "2000-01-01",
  to: "2026-08-26",
}).symbol, "BRK.B");
assert.throws(
  () => normalizeHistoryRequest({ market: "cn", symbol: "700", adjust: "qfq", from: "2015-01-01", to: "2026-08-26" }),
  /6 位/u,
);
assert.throws(
  () => normalizeHistoryRequest({ market: "us", symbol: "AAPL", adjust: "qfq", from: "2015-01-01", to: "2026-08-26" }),
  /口径/u,
);
assert.throws(
  () => normalizeHistoryRequest({ market: "cn", source: "massive", symbol: "600519", adjust: "none", from: "2015-01-01", to: "2026-08-26" }),
  /不支持所选市场/u,
);
assert.throws(
  () => normalizeHistoryRequest({ market: "us", symbol: "AAPL", adjust: "adj", from: "2026-09-01", to: "2026-08-26" }),
  /开始日期/u,
);

const syncRequest = normalizeHistoryRequest({
  market: "cn",
  symbol: "600519",
  adjust: "qfq",
  from: "2015-01-01",
  to: "2026-08-26",
});
assert.equal(syncRequest.csvPath, "data/market/SH600519.csv");
const runtimeArgs = historyDataRuntimeArgs("node", syncRequest);
assert.deepEqual(runtimeArgs.slice(-14), [
  "panel-history-sync",
  "--symbol", "SH600519",
  "--market", "cn",
  "--source", "auto",
  "--adjust", "qfq",
  "--from", "2015-01-01",
  "--to", "2026-08-26",
  "--stdout-bundle",
]);
assert(runtimeArgs.some((argument) => argument.includes("fetch-market-data.mjs")));
assert.throws(() => historyDataRuntimeArgs("python", syncRequest), /运行时/u);

const metaPath = "data/market/SH600519.meta.json";
const metaDocument = {
  format: "codeshell.quant-dataset",
  version: 1,
  symbol: "SH600519",
  name: "贵州茅台",
  market: "cn",
  adjust: "qfq",
  source: "tencent-ifzq",
  syncedAt: "2026-08-26T08:00:00.000Z",
  networkCheckedThrough: "2026-08-26",
  bars: 2650,
  from: "2015-01-05",
  to: "2026-08-26",
  fingerprint: "fnv1a32:12345678",
  dropped: { duplicate: 0, nonPositive: 0, inconsistent: 0 },
};
const meta = parseHistoryDatasetMeta(
  JSON.stringify(metaDocument),
  metaPath,
  new Set(["data/market/SH600519.csv"]),
);
assert.equal(meta.csvPath, "data/market/SH600519.csv");
assert.equal(meta.bars, 2650);
assert.equal(meta.networkCheckedThrough, "2026-08-26");
assert(Object.isFrozen(meta));
const legacyMetaDocument = { ...metaDocument };
delete legacyMetaDocument.networkCheckedThrough;
assert.equal(
  parseHistoryDatasetMeta(JSON.stringify(legacyMetaDocument), metaPath, new Set([meta.csvPath])).networkCheckedThrough,
  null,
  "旧版项目数据必须保留未完成网络核对的状态，以便启动时自动完整复核一次",
);
assert.throws(
  () => parseHistoryDatasetMeta(
    JSON.stringify({ ...metaDocument, networkCheckedThrough: "2026-08-25" }),
    metaPath,
    new Set([meta.csvPath]),
  ),
  /metadata-fields-invalid/u,
  "网络核对日期不能早于最新 K 线",
);
assert.throws(
  () => parseHistoryDatasetMeta(JSON.stringify({ ...metaDocument, format: "other" }), metaPath, new Set([meta.csvPath])),
  /metadata-format-unsupported/u,
);
assert.throws(
  () => parseHistoryDatasetMeta(JSON.stringify(metaDocument), metaPath, new Set()),
  /dataset-csv-missing/u,
);
assert.throws(
  () => parseHistoryDatasetMeta(
    JSON.stringify({ ...metaDocument, symbol: "SZ000001" }),
    metaPath,
    new Set([meta.csvPath]),
  ),
  /dataset-csv-missing/u,
  "元数据代码必须和文件名一致",
);
assert.throws(
  () => parseHistoryDatasetMeta(
    JSON.stringify({ ...metaDocument, source: "yahoo-finance" }),
    metaPath,
    new Set([meta.csvPath]),
  ),
  /metadata-fields-invalid/u,
  "数据源必须支持声明的市场",
);
assert.throws(
  () => parseHistoryDatasetMeta(
    JSON.stringify({ ...metaDocument, syncedAt: "2026-08-26T08:00:00" }),
    metaPath,
    new Set([meta.csvPath]),
  ),
  /metadata-fields-invalid/u,
  "同步时间必须带时区",
);
assert.throws(
  () => parseHistoryDatasetMeta(
    JSON.stringify({ ...metaDocument, syncedAt: "2026-08-26T08:00:00+23:00" }),
    metaPath,
    new Set([meta.csvPath]),
  ),
  /metadata-fields-invalid/u,
  "同步时间必须使用有效的 ISO-8601 时区偏移",
);
assert.throws(
  () => parseHistoryDatasetMeta(
    JSON.stringify({ ...metaDocument, fingerprint: "anything" }),
    metaPath,
    new Set([meta.csvPath]),
  ),
  /metadata-fields-invalid/u,
);
assert.throws(
  () => parseHistoryDatasetMeta(
    JSON.stringify(metaDocument),
    `data/market/nested/${metaDocument.symbol}.meta.json`,
    new Set([meta.csvPath]),
  ),
  /metadata-path-invalid/u,
);

const syncCsv = [
  "date,open,high,low,close,volume",
  "2026-08-24,10,11,9,10.5,1000",
  "2026-08-25,10.5,11.5,10,11,1200",
  "2026-08-26,11,12,10.5,11.5,1500",
  "",
].join("\n");
const syncBars = parseOhlcvCsv(syncCsv);
const parsedBundle = parseHistorySyncBundle({
  format: "codeshell.quant-dataset-bundle",
  version: 1,
  csv: syncCsv,
  metadata: {
    ...metaDocument,
    bars: syncBars.length,
    from: syncBars[0].date,
    to: syncBars.at(-1).date,
    fingerprint: fingerprintBars(syncBars),
  },
}, syncRequest);
assert.equal(parsedBundle.meta.symbol, "SH600519");
assert.equal(parsedBundle.csv, syncCsv);
assert.throws(
  () => parseHistorySyncBundle({
    format: "codeshell.quant-dataset-bundle",
    version: 1,
    csv: syncCsv.replace("11.5,1500", "11.6,1500"),
    metadata: {
      ...metaDocument,
      bars: syncBars.length,
      from: syncBars[0].date,
      to: syncBars.at(-1).date,
      fingerprint: fingerprintBars(syncBars),
    },
  }, syncRequest),
  /校验/u,
);

console.log("✓ Quant Lab historical data catalog, direct sync and metadata contract");
