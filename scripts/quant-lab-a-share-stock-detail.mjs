import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(repositoryRoot, "apps", "quant-lab", "app");
const detail = await import(pathToFileURL(join(appDir, "a-share-stock-detail.mjs")).href);
const detailUi = await import(pathToFileURL(join(appDir, "modules", "a-share-stock-detail-ui.mjs")).href);
const detailTool = await import(pathToFileURL(join(appDir, "tools", "fetch-a-share-stock.mjs")).href);
const screenTool = await import(pathToFileURL(join(appDir, "tools", "screen-a-shares.mjs")).href);
const localSnapshots = await import(pathToFileURL(join(appDir, "tools", "local-snapshot-store.mjs")).href);

const quoteText = 'v_sh600519="1~贵州茅台~600519~1292.30~1302.80~1304.00~24767~10210~14553~1292.30~70~1292.29~2~1292.27~1~1292.24~3~1292.01~2~1292.36~2~1292.37~8~1292.38~4~1292.50~16~1292.59~4~~20260826150000~-10.50~-0.81~1305.00~1288.00~1292.30/24767/3203715661~24767~320372~0.20~19.84~~1305.00~1288.00~1.30~16154.80~16154.80~6.43~1433.08~1172.52~0.83~44~1293.52~18.14~19.62~~~0.12~320371.5661~38.7690~3~   A~GP-A"';
const quote = detail.parseTencentStockQuote(quoteText);
assert.equal(quote.symbol, "SH600519");
assert.equal(quote.name, "贵州茅台");
assert.equal(quote.price, 1292.3);
assert.equal(quote.amount, 3_203_715_661);
assert.equal(quote.volume, 2_476_700);
assert.equal(quote.pe, 19.84);
assert.equal(quote.pb, 6.43);
assert.equal(quote.totalMarketCap, 1_615_480_000_000);
assert.equal(quote.floatMarketCap, 1_615_480_000_000);
const unequalCapQuote = detail.parseTencentStockQuote(
  quoteText.replace("~16154.80~16154.80~6.43~", "~77.37~972.29~7.67~"),
);
assert.equal(unequalCapQuote.totalMarketCap, 97_229_000_000);
assert.equal(unequalCapQuote.floatMarketCap, 7_737_000_000);

const transientQuoteText = quoteText.replace(
  "~-0.81~1305.00~1288.00~",
  "~-0.81~1200.00~1288.00~",
);
assert.throws(() => detail.parseTencentStockQuote(transientQuoteText), /字段不完整或相互冲突/u);
let quoteAttempts = 0;
const quoteRetryWaits = [];
const retriedQuote = await detailTool.fetchTencentStockQuote("SH600519", {
  fetchText: async () => ++quoteAttempts === 1 ? transientQuoteText : quoteText,
  wait: async (milliseconds) => quoteRetryWaits.push(milliseconds),
});
assert.equal(retriedQuote.symbol, "SH600519");
assert.equal(quoteAttempts, 2);
assert.deepEqual(quoteRetryWaits, [250]);
await assert.rejects(
  () => detailTool.fetchTencentStockQuote("SH600519", {
    attempts: 3,
    fetchText: async () => transientQuoteText,
    wait: async () => undefined,
  }),
  (error) => error?.code === "QUOTE_FIELDS_TRANSIENT" && /连续 3 次/u.test(error.message),
);

const financialPayload = {
  success: true,
  result: {
    data: [
      {
        SECUCODE: "600519.SH",
        REPORT_DATE: "2026-06-30 00:00:00",
        NOTICE_DATE: "2026-08-13 00:00:00",
        REPORT_DATE_NAME: "2026中报",
        CURRENCY: "CNY",
        TOTALOPERATEREVE: 89_360_000_000,
        TOTALOPERATEREVETZ: 9.8,
        PARENTNETPROFIT: 45_403_000_000,
        PARENTNETPROFITTZ: 8.9,
        KCFJCXSYJLR: 45_120_000_000,
        KCFJCXSYJLRTZ: 9.1,
        EPSJB: 36.15,
        ROEJQ: 18.7,
        XSMLL: 91.8,
        XSJLL: 52.1,
        ZCFZL: 16.4,
        LD: 4.9,
        SD: 4.6,
        MGJYXJJE: 37.2,
        JYXJLYYSR: 0.523,
      },
      {
        SECUCODE: "600519.SH",
        REPORT_DATE: "2025-12-31 00:00:00",
        NOTICE_DATE: "2026-03-31 00:00:00",
        REPORT_DATE_NAME: "2025年报",
        CURRENCY: "CNY",
        TOTALOPERATEREVE: 186_000_000_000,
        TOTALOPERATEREVETZ: 12.4,
        PARENTNETPROFIT: 92_000_000_000,
        PARENTNETPROFITTZ: 10.2,
        EPSJB: 73.25,
        ROEJQ: 36.2,
        XSMLL: 91.5,
        XSJLL: 51.2,
        ZCFZL: 17.1,
        LD: 4.7,
        SD: 4.4,
        MGJYXJJE: 76.4,
        JYXJLYYSR: 0.516,
      },
      {
        SECUCODE: "600519.SH",
        REPORT_DATE: "2026-09-30 00:00:00",
        NOTICE_DATE: "2026-10-24 00:00:00",
        REPORT_DATE_NAME: "2026三季报",
      },
    ],
  },
};
const financials = detail.parseEastmoneyFinancials(financialPayload, "SH600519", "2026-08-26T15:08:00+08:00");
assert.equal(financials.periods.length, 2, "future announcements must be excluded");
assert.equal(financials.periods[0].reportName, "2026中报");
assert.equal(financials.periods[0].cashRevenueRatio, 52.3);
assert.equal(financials.periods[0].revenue, 89_360_000_000);

const suggestions = 'v_hint="sh~600519~\\u8d35\\u5dde\\u8305\\u53f0~gzmt~GP-A^sz~000596~\\u53e4\\u4e95\\u8d21\\u9152~gjgj~GP-A"';
assert.deepEqual(detail.parseTencentStockSuggestions(suggestions, "贵州茅台"), [
  { symbol: "SH600519", code: "600519", name: "贵州茅台" },
  { symbol: "SZ000596", code: "000596", name: "古井贡酒" },
]);
assert.deepEqual(detail.resolveTencentStockSuggestion(suggestions, "贵州茅台"), {
  symbol: "SH600519",
  code: "600519",
  name: "贵州茅台",
});
assert.throws(() => detail.resolveTencentStockSuggestion(suggestions, "白酒"), /名称不唯一/u);

function addDays(date, days) {
  const instant = new Date(`${date}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

const bars = Array.from({ length: 121 }, (_value, index) => {
  const close = 1_100 + index * 1.6;
  return {
    date: addDays("2026-04-28", index),
    open: close - 2,
    high: close + 5,
    low: close - 6,
    close,
    volume: index === 120 ? 2_476_700 : 2_000_000,
  };
});
bars.at(-1).date = "2026-08-26";
bars.at(-1).open = quote.open;
bars.at(-1).high = quote.high;
bars.at(-1).low = quote.low;
bars.at(-1).close = quote.price;

const snapshot = detail.buildAShareStockDetailSnapshot({
  quote,
  bars,
  events: [
    {
      id: "AN202608260001",
      kind: "announcement",
      label: "经营事件",
      title: "贵州茅台关于回购进展的公告",
      publishedAt: "2026-08-26T01:00:00.000Z",
      url: "https://data.eastmoney.com/notices/detail/600519/AN202608260001.html",
      importance: "operating",
    },
  ],
  generatedAt: "2026-08-26T15:08:00+08:00",
  provisional: false,
  previousClose: false,
  financials,
  sourceStatus: { history: true, announcements: true, news: true, financials: true },
});
assert.equal(snapshot.kind, "a-share-stock-detail-snapshot");
assert.equal(snapshot.stock.pb, 6.43);
assert.equal(snapshot.bars.length, 121);
assert.equal(snapshot.metrics.historyBars, 121);
assert(Number.isFinite(snapshot.metrics.ma20));
assert.equal(snapshot.levels.layers.length, 9);
assert.deepEqual(snapshot.levels.layers.map((item) => item.id), [
  "sr", "pivot", "extreme", "boll", "keltner", "atr", "gap", "fib", "round",
]);
assert(snapshot.levels.layers.find((item) => item.id === "pivot").lines.length >= 7);
assert(snapshot.levels.layers.find((item) => item.id === "boll").lines.length === 3);
assert(snapshot.levels.layers.find((item) => item.id === "keltner").lines.length >= 6);
assert(snapshot.levels.zones.every((item) => item.review?.windowBars === 60));
assert(snapshot.levels.zones.every((item) => item.review.touches >= 0 && item.review.crosses >= 0));
assert.match(snapshot.levels.disclosure, /描述性统计.*后见信息.*不是.*回测/u);
assert(["watch", "extended", "risk"].includes(snapshot.timing.state));
assert.equal(snapshot.events.length, 1);
assert.equal(snapshot.financials.periods.length, 2);
assert.match(snapshot.sources.at(-1).label, /公开财务摘要/u);

const parsed = detailUi.parseAShareStockDetailSnapshot(JSON.stringify(snapshot));
assert.equal(parsed.stock.symbol, "SH600519");
assert.equal(parsed.metrics.historyBars, 121);
assert.equal(parsed.levels.layers.length, 9);
assert.equal(parsed.levels.zones[0].review.windowBars, 60);
assert.equal(parsed.events[0].importance, "operating");
assert.equal(parsed.financials.periods[0].roe, 18.7);
const poisoned = structuredClone(snapshot);
poisoned.sources[0].url = "https://evil.example/quote";
assert.throws(() => detailUi.parseAShareStockDetailSnapshot(JSON.stringify(poisoned)), /链接来源无效/u);
const conflictingBars = structuredClone(snapshot);
conflictingBars.metrics.historyBars -= 1;
assert.throws(() => detailUi.parseAShareStockDetailSnapshot(JSON.stringify(conflictingBars)), /历史行情不一致/u);

const newStockRows = Array.from({ length: 19 }, (_value, index) => {
  const close = 88 + index * 4.8;
  return [addDays("2026-08-04", index), String(close - 1), String(close), String(close + 2), String(close - 3), "10000"];
});
newStockRows.at(-1)[0] = "2026-08-28";
const newStockHistory = screenTool.parseTencentHistoryPayload({
  data: { sz001232: { day: newStockRows } },
}, "SZ001232", "2026-08-28", { minimumBars: 1, allowUnadjustedNewStock: true });
assert.equal(newStockHistory.adjust, "none");
assert.equal(newStockHistory.bars.length, 19);
assert.throws(
  () => screenTool.parseTencentHistoryPayload(
    { data: { sz001232: { day: newStockRows } } },
    "SZ001232",
    "2026-08-28",
  ),
  (error) => error?.code === "HISTORY_SHAPE",
);

const newStockQuote = {
  ...quote,
  symbol: "SZ001232",
  code: "001232",
  name: "嘉立创",
  board: "main",
  marketDate: "2026-08-28",
  asOf: "2026-08-28T15:00:00+08:00",
  price: 175.01,
  open: 165.97,
  high: 177.77,
  low: 165.97,
  previousClose: 162.03,
  change: 12.98,
  changePercent: 8.01,
};
const newStockSnapshot = detail.buildAShareStockDetailSnapshot({
  quote: newStockQuote,
  bars: newStockHistory.bars,
  historyAdjust: newStockHistory.adjust,
  events: [],
  generatedAt: "2026-08-28T15:08:00+08:00",
  provisional: false,
  previousClose: false,
  sourceStatus: { history: true, announcements: true, news: true },
});
assert.equal(newStockSnapshot.historyAdjust, "none");
assert.equal(newStockSnapshot.bars.length, 19);
assert.equal(newStockSnapshot.timing.state, "unavailable");
assert.match(newStockSnapshot.timing.action, /19 个交易日/u);
assert.match(newStockSnapshot.sources[1].label, /未复权日线/u);
const parsedNewStock = detailUi.parseAShareStockDetailSnapshot(JSON.stringify(newStockSnapshot));
assert.equal(parsedNewStock.historyAdjust, "none");
assert.equal(parsedNewStock.metrics.historyBars, 19);

assert.deepEqual(detailUi.stockDetailRuntimeArgs("node", "SH600519", "read-local").slice(0, 2), ["--input-type=module", "--eval"]);
assert.equal(detailUi.stockDetailRuntimeArgs("bun", "贵州茅台", "refresh-local")[0], "--eval");
assert.throws(() => detailUi.stockDetailRuntimeArgs("node", "贵州茅台", "read-local"), /需要股票代码/u);
assert.throws(() => detailUi.stockDetailRuntimeArgs("python", "600519"), /不受支持/u);
assert.equal(detailTool.stockSuggestionUrl("贵州茅台").origin, "https://smartbox.gtimg.cn");
assert.equal(detailTool.stockQuoteUrl("SH600519").searchParams.get("q"), "sh600519");
assert.equal(detailTool.stockAnnouncementUrl("SH600519").searchParams.get("stock_list"), "600519");
assert.equal(detailTool.stockFinancialsUrl("SH600519").searchParams.get("filter"), '(SECUCODE="600519.SH")');

const localRoot = await mkdtemp(join(tmpdir(), "quant-lab-stock-detail-"));
try {
  const written = await localSnapshots.writeLocalSnapshot({
    root: localRoot,
    stream: "a-share-stock",
    scope: "SH600519",
    snapshot,
  });
  assert.match(written.latestPath, /snapshots\/a-share-stock\/SH600519\/latest\.json$/u);
  assert.deepEqual(await localSnapshots.readLocalSnapshot({
    root: localRoot,
    stream: "a-share-stock",
    scope: "SH600519",
  }), snapshot);
  await assert.rejects(
    () => localSnapshots.readLocalSnapshot({ root: localRoot, stream: "a-share-stock", scope: "SZ300750" }),
    (error) => error?.code === "LOCAL_SNAPSHOT_MISSING",
  );
} finally {
  await rm(localRoot, { recursive: true, force: true });
}

console.log("✓ Quant Lab A-share name search, stock data, timing and local snapshot contract");
