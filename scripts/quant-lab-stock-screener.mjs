import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screener = await import(
  pathToFileURL(join(repositoryRoot, "apps", "quant-lab", "app", "stock-screener.mjs")).href
);
const insightModule = await import(
  pathToFileURL(
    join(repositoryRoot, "apps", "quant-lab", "app", "modules", "market-insights-ui.mjs"),
  ).href
);
const cliModule = await import(
  pathToFileURL(
    join(repositoryRoot, "apps", "quant-lab", "app", "tools", "screen-a-shares.mjs"),
  ).href
);

function addDays(date, days) {
  const instant = new Date(`${date}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

function history({ marketDate, startPrice, dailyReturn, finalVolumeRatio = 1.5 }) {
  const bars = [];
  let previous = startPrice;
  for (let index = 129; index >= 0; index -= 1) {
    const close = previous * (1 + dailyReturn);
    const volume = index === 0 ? 1_500_000 * finalVolumeRatio / 1.5 : 1_000_000;
    bars.push({
      date: addDays(marketDate, -index),
      open: previous,
      high: Math.max(previous, close) * 1.004,
      low: Math.min(previous, close) * 0.996,
      close,
      volume,
    });
    previous = close;
  }
  return bars;
}

function quoteRow(index, bars, overrides = {}) {
  const last = bars.at(-1);
  const previous = bars.at(-2);
  const code = String(600000 + index).padStart(6, "0");
  return {
    symbol: `sh${code}`,
    code,
    name: `样本${index}`,
    trade: last.close,
    pricechange: last.close - previous.close,
    changepercent: ((last.close / previous.close) - 1) * 100,
    settlement: previous.close,
    open: last.open,
    high: last.high,
    low: last.low,
    volume: last.volume,
    amount: 300_000_000 + index * 50_000_000,
    per: 18 + index,
    pb: 2 + index / 10,
    mktcap: 2_000_000 + index * 10_000,
    nmc: 1_000_000 + index * 10_000,
    turnoverratio: 2 + index / 10,
    ...overrides,
  };
}

const marketDate = "2026-08-25";
const quoteRows = [];
const sourceHistories = new Map();
for (let index = 0; index < 12; index += 1) {
  const bars = history({ marketDate, startPrice: 8 + index, dailyReturn: 0.0015 + index * 0.00008 });
  const row = quoteRow(index, bars);
  quoteRows.push(row);
  sourceHistories.set(`SH${row.code}`, bars);
}

const fallingBars = history({ marketDate, startPrice: 40, dailyReturn: -0.001 });
const falling = quoteRow(20, fallingBars, { name: "回落样本", amount: 2_000_000_000 });
quoteRows.push(falling);
sourceHistories.set(`SH${falling.code}`, fallingBars);

const stBars = history({ marketDate, startPrice: 10, dailyReturn: 0.002 });
quoteRows.push(quoteRow(30, stBars, { name: "*ST风险样本" }));
quoteRows.push(quoteRow(31, stBars, { name: "低流动性样本", amount: 1_000_000 }));

const normalized = quoteRows.map(screener.normalizeStockQuote).filter(Boolean);
assert.equal(normalized.length, quoteRows.length);
assert.equal(screener.normalizeStockQuote({ symbol: "bj920000" }), null);
assert.equal(normalized[0].floatMarketCap, quoteRows[0].nmc * 10_000);

function tencentQuoteText(symbol, name, price = 10) {
  const fields = Array.from({ length: 68 }, () => "");
  fields[0] = "1";
  fields[1] = name;
  fields[2] = symbol.slice(2);
  fields[3] = String(price);
  fields[4] = String(price - 0.1);
  fields[5] = String(price - 0.05);
  fields[6] = "10000";
  fields[30] = "20260825093000";
  fields[32] = "1.01";
  fields[33] = String(price + 0.2);
  fields[34] = String(price - 0.2);
  fields[35] = `${price}/10000/10000000`;
  fields[36] = "10000";
  fields[37] = "1000";
  fields[38] = "1.5";
  fields[39] = "18";
  fields[44] = "100";
  fields[45] = "120";
  fields[46] = "2";
  return `v_${symbol.toLowerCase()}="${fields.join("~")}";`;
}

const tencentBatch = cliModule.parseTencentQuoteBatch([
  tencentQuoteText("SH600000", "浦发银行", 9.3),
  tencentQuoteText("SZ000001", "平安银行", 11.8),
  'v_bj920000="ignored";',
].join("\n"));
assert.deepEqual(tencentBatch.map((quote) => quote.symbol), ["SH600000", "SZ000001"]);
assert.equal(tencentBatch[0].amount, 10_000_000);
assert.equal(tencentBatch[0].floatMarketCap, 10_000_000_000);
assert.equal(cliModule.tencentQuoteBatchUrl(["SH600000", "SZ000001"]).origin, "https://qt.gtimg.cn");
assert.throws(
  () => cliModule.tencentQuoteBatchUrl(Array.from({ length: 151 }, (_value, index) => `SH${String(600000 + index)}`)),
  /1\.\.150/u,
);

const eastmoneyRows = Array.from({ length: 4_000 }, (_value, index) => {
  const shanghai = index < 3_000;
  const code = shanghai ? String(600000 + index) : String(index - 2_999).padStart(6, "0");
  return {
    f12: code,
    f14: `样本${index}`,
    f2: 10,
    f3: 1,
    f5: 10_000,
    f6: 10_000_000,
    f8: 1.5,
    f9: 18,
    f15: 10.2,
    f16: 9.8,
    f17: 9.9,
    f18: 9.9,
    f20: 12_000_000_000,
    f21: 10_000_000_000,
    f23: 2,
  };
});
const eastmoneyQuotes = cliModule.parseEastmoneyQuoteUniverse({ data: { diff: eastmoneyRows } });
assert.equal(eastmoneyQuotes.length, 4_000);
assert.equal(eastmoneyQuotes[0].volume, 1_000_000);
assert.equal(eastmoneyQuotes[0].floatMarketCap, 10_000_000_000);

const fallbackQuotes = await cliModule.fetchAllQuotes({
  fetchSinaQuotes: async () => { throw new Error("empty primary"); },
  fetchTencentQuotes: async () => tencentBatch,
  fetchEastmoneyQuotes: async () => { throw new Error("must not run"); },
});
assert.equal(fallbackQuotes, tencentBatch, "full-market quote refresh must switch sources after a primary failure");
await assert.rejects(
  () => cliModule.fetchAllQuotes({
    fetchSinaQuotes: async () => { throw new Error("primary failed"); },
    fetchTencentQuotes: async () => { throw new Error("secondary failed"); },
    fetchEastmoneyQuotes: async () => { throw new Error("tertiary failed"); },
  }),
  (error) => error?.code === "QUOTE_SOURCES_UNAVAILABLE" && /拒绝使用不完整数据/u.test(error.message),
);

const universeDirectory = await mkdtemp(join(tmpdir(), "quant-lab-quote-universe-"));
try {
  const snapshotDirectory = join(universeDirectory, "snapshots", "a-share-realtime", "global");
  await mkdir(snapshotDirectory, { recursive: true });
  await writeFile(
    join(snapshotDirectory, "latest.json"),
    JSON.stringify({ quotes: eastmoneyQuotes.map((quote) => ({ symbol: quote.symbol })) }),
    "utf8",
  );
  const localUniverse = await cliModule.readLocalQuoteUniverse(universeDirectory);
  assert.equal(localUniverse.length, 4_000);
  assert.equal(localUniverse[0], "SH600000");
} finally {
  await rm(universeDirectory, { recursive: true, force: true });
}

const preparation = screener.prepareHistoryUniverse(normalized, { limit: 50 });
assert.equal(preparation.total, 15);
assert.equal(preparation.eligible.length, 13);
assert.equal(preparation.rejected["risk-name"], 1);
assert.equal(preparation.rejected["low-amount"], 1);
assert(!preparation.selected.some((quote) => quote.name.includes("ST")));

const analyzed = screener.analyzeStockHistory(
  preparation.selected.find((quote) => quote.symbol === "SH600011"),
  sourceHistories.get("SH600011"),
  { marketDate, provisional: false },
);
assert(analyzed.return60 > 10);
assert(analyzed.ma20 > analyzed.ma60);
assert(analyzed.volumeRatio > 1);
assert.equal(
  screener.analyzeStockHistory(
    preparation.selected.find((quote) => quote.symbol === "SH600011"),
    sourceHistories.get("SH600011"),
    { marketDate: addDays(marketDate, 11), provisional: false },
  ),
  null,
  "超过十个自然日的历史末点不能冒充当前证据",
);

const report = screener.buildStockScreenReport({
  preparation,
  histories: sourceHistories,
  marketDate,
  asOf: "2026-08-25T15:00:00+08:00",
  generatedAt: "2026-08-25T15:12:00+08:00",
  provisional: false,
  top: 5,
});
assert.equal(report.schemaVersion, 1);
assert.equal(report.kind, "candidates");
assert.equal(report.items.length, 5);
assert(report.items.every((item) => item.title.includes("相对得分")));
assert(report.items.every((item) => /量比/u.test(item.detail)));
assert(!report.items.some((item) => item.name.includes("ST")));
assert(report.risks.some((risk) => /当前在市快照/u.test(risk)));
assert(report.risks.some((risk) => /回落样本/u.test(risk)));
assert(report.items.every((item) => /日线截至/u.test(item.detail)));
const laggedHistories = new Map(sourceHistories);
const laggedSymbol = preparation.selected[0].symbol;
laggedHistories.set(laggedSymbol, sourceHistories.get(laggedSymbol).slice(0, -1));
const laggedReport = screener.buildStockScreenReport({
  preparation,
  histories: laggedHistories,
  marketDate,
  asOf: "2026-08-25T15:00:00+08:00",
  generatedAt: "2026-08-25T15:12:00+08:00",
  provisional: false,
  top: 5,
});
assert.equal(laggedReport.status, "caution");
assert.match(laggedReport.facts.find((fact) => fact.label === "历史覆盖").value, /1 只滞后/u);
assert(laggedReport.risks.some((risk) => risk.includes("截止早于 2026-08-25")));
assert.equal(
  screener.buildStockScreenReport({
    preparation,
    histories: sourceHistories,
    marketDate,
    asOf: "2026-08-25T15:00:00+08:00",
    generatedAt: "2026-08-25T15:12:00+08:00",
    provisional: false,
    top: 20,
  }).items.length,
  10,
  "候选报告必须服从面板 schema 的十项上限",
);
assert.throws(
  () => screener.buildStockScreenReport({
    preparation,
    histories: sourceHistories,
    marketDate,
    asOf: "2026-08-25T15:00:00",
    generatedAt: "2026-08-25T15:12:00+08:00",
  }),
  /timezone-qualified/u,
);
assert.throws(
  () => screener.buildStockScreenReport({
    preparation,
    histories: sourceHistories,
    marketDate: "2026-08-24",
    asOf: "2026-08-25T15:00:00+08:00",
    generatedAt: "2026-08-25T15:12:00+08:00",
  }),
  /marketDate must match asOf/u,
);
assert.throws(
  () => screener.buildStockScreenReport({
    preparation,
    histories: sourceHistories,
    marketDate,
    asOf: "2026-08-25T15:00:00+08:00",
    generatedAt: "2026-08-25T10:00:00+08:00",
  }),
  /asOf cannot be after generatedAt/u,
);
assert.throws(
  () => screener.buildStockScreenReport({
    preparation,
    histories: sourceHistories,
    marketDate,
    asOf: "2026-08-25T15:00:00+23:00",
    generatedAt: "2026-08-25T15:12:00+08:00",
  }),
  /timezone-qualified/u,
);

const outputPath = "data/market-insights/20260825T071200000Z-candidates.json";
const parsed = insightModule.parseMarketInsight(JSON.stringify(report), outputPath);
assert.equal(parsed.kindLabel, "研究候选");
assert.equal(parsed.items.length, 5);
assert.equal(parsed.sources.length, 2);

const task = insightModule.buildMarketInsightTask(
  "candidates",
  "",
  new Date("2026-08-25T07:12:00.000Z"),
);
assert.equal(task.path, outputPath);
assert.equal(task.displayText, "执行今日固定选股");
assert.equal(task.runMode, "local-selection");
assert.equal(Object.hasOwn(task, "prompt"), false, "candidate selection must not expose an Agent prompt");

assert.doesNotThrow(() => cliModule.validateStockScreenOutputPath(outputPath));
const liveHistoryUrl = cliModule.historyUrl("SH600519", marketDate);
assert.equal(liveHistoryUrl.origin, "https://proxy.finance.qq.com");
assert.equal(liveHistoryUrl.pathname, "/ifzqgtimg/appstock/app/newfqkline/get");
assert.match(liveHistoryUrl.searchParams.get("param"), /^sh600519,day,[^,]+,[^,]+,180,qfq$/u);
const indexSeries = cliModule.parseTencentHistoryPayload({
  data: {
    sh000001: {
      day: Array.from({ length: 31 }, (_value, index) => [
        addDays(marketDate, index - 30), "3000", String(3000 + index), String(3001 + index), "2999", "1000",
      ]),
    },
  },
}, "SH000001", marketDate, { minimumBars: 31, assetType: "index", allowUnadjustedNewStock: true });
assert.equal(indexSeries.adjust, "none");
assert.equal(indexSeries.bars.length, 31);
assert.throws(
  () => cliModule.validateStockScreenOutputPath("../../candidate.json"),
  /unsafe stock-screen output path/u,
);
const writeDirectory = await mkdtemp(join(tmpdir(), "quant-lab-screen-report-"));
try {
  const writePath = join(writeDirectory, "report.json");
  await cliModule.writeReportCreateOnly(writePath, "first\n");
  await assert.rejects(
    () => cliModule.writeReportCreateOnly(writePath, "replacement\n"),
    (error) => error?.code === "OUTPUT_EXISTS",
  );
  assert.equal(await readFile(writePath, "utf8"), "first\n");
} finally {
  await rm(writeDirectory, { recursive: true, force: true });
}
assert.equal(
  await cliModule.readLimitedResponseText(new Response("small response"), 32),
  "small response",
);
await assert.rejects(
  () => cliModule.readLimitedResponseText(new Response("response exceeds limit"), 8),
  (error) => error?.code === "SOURCE_TOO_LARGE",
);
await assert.rejects(
  () => cliModule.runCli(["--top", "20", "--help"]),
  /3\.\.10/u,
);

const provisionalReport = screener.buildStockScreenReport({
  preparation,
  histories: sourceHistories,
  marketDate,
  asOf: "2026-08-25T10:30:00+08:00",
  generatedAt: "2026-08-25T10:31:00+08:00",
  provisional: true,
  top: 5,
});
assert.equal(provisionalReport.status, "caution");
assert.match(provisionalReport.title, /盘中初筛/u);
assert(provisionalReport.risks.some((risk) => /收盘后必须重新扫描/u.test(risk)));

console.log("✓ Quant Lab deterministic A-share universe, evidence gates, ranking and report contract");
