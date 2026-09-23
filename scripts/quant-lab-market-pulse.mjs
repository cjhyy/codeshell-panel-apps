import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pulse = await import(
  pathToFileURL(join(repositoryRoot, "apps", "quant-lab", "app", "market-pulse.mjs")).href
);
const insight = await import(
  pathToFileURL(join(repositoryRoot, "apps", "quant-lab", "app", "modules", "market-insights-ui.mjs")).href
);
const liveMarket = await import(
  pathToFileURL(join(repositoryRoot, "apps", "quant-lab", "app", "modules", "live-market-ui.mjs")).href
);
const aShareSession = await import(
  pathToFileURL(join(repositoryRoot, "apps", "quant-lab", "app", "modules", "a-share-session.mjs")).href
);
const cli = await import(
  pathToFileURL(join(repositoryRoot, "apps", "quant-lab", "app", "tools", "build-market-pulse.mjs")).href
);
const localSnapshots = await import(
  pathToFileURL(join(repositoryRoot, "apps", "quant-lab", "app", "tools", "local-snapshot-store.mjs")).href
);
const stockScreener = await import(
  pathToFileURL(join(repositoryRoot, "apps", "quant-lab", "app", "stock-screener.mjs")).href
);
const marketEnvironment = await import(
  pathToFileURL(join(repositoryRoot, "apps", "quant-lab", "app", "market-environment.mjs")).href
);

function addDays(date, days) {
  const instant = new Date(`${date}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

function quoteRow(index, changePercent) {
  const code = String(600000 + index).padStart(6, "0");
  const previous = 10 + index / 100;
  const price = previous * (1 + changePercent / 100);
  return {
    symbol: `sh${code}`,
    code,
    name: `样本${index}`,
    trade: price,
    pricechange: price - previous,
    changepercent: changePercent,
    settlement: previous,
    open: Math.min(previous, price),
    high: Math.max(previous, price) * 1.002,
    low: Math.min(previous, price) * 0.998,
    volume: 10_000_000,
    amount: 120_000_000 + index * 1_000_000,
    per: 18,
    pb: 2,
    mktcap: 500_000,
    nmc: 300_000,
    turnoverratio: 2,
  };
}

const quoteRows = [];
for (let index = 0; index < 160; index += 1) {
  const change = index < 100 ? 1 + index / 500 : index < 150 ? -1 - index / 500 : 0;
  quoteRows.push(quoteRow(index, change));
}
quoteRows[0] = quoteRow(0, 10.02);
quoteRows[159] = quoteRow(159, -10.01);
const breadth = pulse.calculateMarketBreadth(quoteRows);
assert.equal(breadth.total, 160);
assert.equal(breadth.up, 100);
assert.equal(breadth.down, 51);
assert.equal(breadth.flat, 9);
assert.equal(breadth.limitUp, 1);
assert.equal(breadth.limitDown, 1);
assert(breadth.amount > 20_000_000_000);
const normalizedQuoteRows = quoteRows.map((row) => stockScreener.normalizeStockQuote(row)).filter(Boolean);
const liveQuoteLists = cli.buildLiveQuoteLists(normalizedQuoteRows.map((quote, index) => ({
  ...quote,
  amount: 800_000_000 + index * 10_000_000,
  turnover: 2 + index / 100,
  floatMarketCap: 20_000_000_000,
  changePercent: index < 20 ? 3 + index / 20 : quote.changePercent,
})));
assert.equal(liveQuoteLists.gainers.length, 8);
assert.equal(liveQuoteLists.losers.length, 8);
assert.equal(liveQuoteLists.active.length, 8);
assert.equal(liveQuoteLists.attention.length, 8);
assert(liveQuoteLists.attention.every((item) => item.reason.includes("成交") && item.risk));
const closeQuoteLists = cli.buildLiveQuoteLists(normalizedQuoteRows.map((quote, index) => ({
  ...quote,
  amount: 800_000_000 + index * 10_000_000,
  turnover: 2 + index / 100,
  floatMarketCap: 20_000_000_000,
  changePercent: index < 20 ? 3 + index / 20 : quote.changePercent,
})), "close");
assert(closeQuoteLists.attention.every((item) => item.reason.startsWith("收盘涨")));
assert(closeQuoteLists.attention.every((item) => !item.risk.includes("盘中量价")));
assert.throws(() => cli.buildLiveQuoteLists(normalizedQuoteRows, "premarket"), /交易阶段|session phase/iu);

const anomalyQuotes = [
  { symbol: "SH600001", name: "高开样本", board: "main", previousClose: 10, open: 10.4, high: 10.9, low: 10.3, price: 10.8, changePercent: 8, amount: 1_200_000_000, turnover: 4 },
  { symbol: "SH600002", name: "跳水样本", board: "main", previousClose: 10, open: 10.3, high: 10.4, low: 9.6, price: 9.7, changePercent: -3, amount: 900_000_000, turnover: 5 },
  { symbol: "SZ300003", name: "振幅样本", board: "chinext", previousClose: 20, open: 20, high: 23, low: 19.8, price: 21, changePercent: 5, amount: 1_500_000_000, turnover: 8 },
];
const anomalyBoard = cli.buildIntradayAnomalies(anomalyQuotes, "2026-08-26T09:50:00+08:00", "intraday");
assert.equal(anomalyBoard.sessionId, "open");
assert(anomalyBoard.items.some((item) => item.type === "gap-up"));
assert(anomalyBoard.items.some((item) => item.type === "intraday-dive"));
assert.match(anomalyBoard.methodology, /当前行情快照.*不声称/u);

const dailyRealtimeSnapshot = cli.buildDailyRealtimeSnapshot({
  quotes: normalizedQuoteRows,
  marketDate: "2026-08-26",
  asOf: "2026-08-26T12:00:00+08:00",
  generatedAt: "2026-08-26T04:00:01.000Z",
  session: { phase: "intraday", provisional: true, previousClose: false },
});
assert.equal(dailyRealtimeSnapshot.kind, "a-share-realtime-daily-snapshot");
assert.equal(dailyRealtimeSnapshot.quoteCount, normalizedQuoteRows.length);
assert.equal(dailyRealtimeSnapshot.quotes[0].symbol, "SH600000");
assert.equal(dailyRealtimeSnapshot.quotes.at(-1).symbol, "SH600159");
assert.throws(
  () => cli.buildDailyRealtimeSnapshot({
    ...dailyRealtimeSnapshot,
    quotes: [normalizedQuoteRows[0], normalizedQuoteRows[0]],
  }),
  /no unique quotes/u,
);
const fullMarketArchive = cli.buildDailyRealtimeSnapshot({
  ...dailyRealtimeSnapshot,
  quotes: Array.from({ length: 5_205 }, (_value, index) => ({
    ...normalizedQuoteRows[index % normalizedQuoteRows.length],
    symbol: `SH${String(600000 + index).padStart(6, "0")}`,
    name: `容量样本 ${index}`,
  })),
});
assert.equal(fullMarketArchive.quoteCount, 5_205);
assert(
  Buffer.byteLength(JSON.stringify(fullMarketArchive), "utf8") < localSnapshots.LOCAL_SNAPSHOT_MAX_BYTES,
  "a complete 5,205-stock daily realtime archive must stay below the atomic local snapshot limit",
);
const environmentHistory = Array.from({ length: 6 }, (_value, day) => {
  const date = addDays("2026-08-21", day);
  const quotes = Array.from({ length: 1_200 }, (_item, index) => {
    const previousClose = 10 + index / 1_000;
    const changePercent = index < 24 ? 10.02 : index < 900 ? 1.2 : -0.5;
    const price = previousClose * (1 + changePercent / 100);
    return {
      symbol: `SH${String(600000 + index).padStart(6, "0")}`,
      name: `环境样本${index}`,
      board: "main",
      price,
      open: previousClose,
      high: price * 1.001,
      low: previousClose * 0.998,
      previousClose,
      changePercent,
      volume: 1_000_000,
      amount: 100_000_000,
      turnover: 2,
    };
  });
  return {
    kind: "a-share-realtime-daily-snapshot",
    marketDate: date,
    generatedAt: `${date}T07:01:00.000Z`,
    session: { phase: "close" },
    quotes,
  };
});
const computedEnvironment = marketEnvironment.buildMarketEnvironment({
  quotes: environmentHistory.at(-1).quotes,
  marketDate: environmentHistory.at(-1).marketDate,
  generatedAt: environmentHistory.at(-1).generatedAt,
  historySnapshots: environmentHistory,
});
assert.equal(computedEnvironment.dimensions.length, 4);
assert.equal(computedEnvironment.phase.available, true);
assert.equal(computedEnvironment.phase.timeline.length, 6);
assert(["strong", "lean_strong", "range", "lean_weak", "weak"].includes(computedEnvironment.state));
assert.equal(marketEnvironment.parseMarketEnvironment(computedEnvironment).score, computedEnvironment.score);
const poisonedEnvironment = structuredClone(computedEnvironment);
poisonedEnvironment.dimensions[0].value = 101;
assert.throws(() => marketEnvironment.parseMarketEnvironment(poisonedEnvironment), /分数无效/u);
const realtimeArchiveRoot = await mkdtemp(join(tmpdir(), "quant-lab-realtime-archive-"));
try {
  const intradayWrite = await localSnapshots.writeLocalSnapshot({
    root: realtimeArchiveRoot,
    stream: "a-share-realtime",
    scope: "global",
    snapshot: dailyRealtimeSnapshot,
  });
  assert.match(intradayWrite.historyPath, /2026-08-26-intraday\.json$/u);
  const closeSnapshot = {
    ...dailyRealtimeSnapshot,
    asOf: "2026-08-26T15:00:00+08:00",
    generatedAt: "2026-08-26T07:00:01.000Z",
    session: { phase: "close", provisional: false, previousClose: false },
  };
  const closeWrite = await localSnapshots.writeLocalSnapshot({
    root: realtimeArchiveRoot,
    stream: "a-share-realtime",
    scope: "global",
    snapshot: closeSnapshot,
  });
  assert.match(closeWrite.historyPath, /2026-08-26-close\.json$/u);
  const history = await localSnapshots.readLocalSnapshotHistory({
    root: realtimeArchiveRoot,
    stream: "a-share-realtime",
    scope: "global",
  });
  assert.deepEqual(history.map((snapshot) => snapshot.session.phase), ["intraday", "close"]);
  assert.equal((await localSnapshots.readLocalSnapshot({
    root: realtimeArchiveRoot,
    stream: "a-share-realtime",
    scope: "global",
  })).session.phase, "close");
} finally {
  await rm(realtimeArchiveRoot, { recursive: true, force: true });
}

const dragonTigerFixture = (direction) => ({
  success: true,
  result: {
    data: Array.from({ length: 6 }, (_value, index) => ({
      SECURITY_CODE: String(600800 + index),
      SECUCODE: `${600800 + index}.SH`,
      SECURITY_NAME_ABBR: `榜单样本${index}`,
      TRADE_DATE: "2026-08-25 00:00:00",
      EXPLANATION: "日涨跌幅偏离值达到榜单条件",
      CHANGE_RATE: direction === "buy" ? 6 + index / 10 : -(2 + index / 10),
      CLOSE_PRICE: 15 + index,
      ACCUM_AMOUNT: 2_000_000_000,
      BILLBOARD_NET_AMT: (direction === "buy" ? 1 : -1) * (300_000_000 - index * 10_000_000),
      DEAL_NET_RATIO: direction === "buy" ? 12 : -12,
    })),
  },
});
assert.equal(cli.parseDragonTigerRows(dragonTigerFixture("buy"), "buy").length, 5);
assert.equal(cli.parseDragonTigerRows(dragonTigerFixture("sell"), "sell").length, 5);
assert.throws(() => cli.parseDragonTigerRows({ success: false }, "buy"), /payload has no data/u);

const industryObject = {};
for (let index = 0; index < 24; index += 1) {
  const change = 3 - index * 0.25;
  const id = index === 0 ? "new_ysjs" : index === 23 ? "new_tchy" : `new_x${index}`;
  const name = index === 0 ? "有色金属" : index === 23 ? "陶瓷行业" : `样本行业${index}`;
  industryObject[id] = `${id},${name},${20 + index},10,0.2,${change},1000000,${500_000_000 + index},sh600000,5.5,12.3,0.6,领涨样本`;
}
const industries = pulse.parseSinaIndustryPayload(
  `var S_Finance_bankuai_sinaindustry = ${JSON.stringify(industryObject)};`,
);
assert.equal(industries.length, 24);
assert.equal(industries[0].name, "有色金属");
assert.equal(industries.at(-1).name, "陶瓷行业");

const marketDate = "2026-08-26";
const indexText = pulse.MARKET_PULSE_INDEXES.map((spec, index) => {
  const previous = 2_000 + index * 300 + 249 * 4;
  const current = previous * 1.01;
  return `var hq_str_${spec.symbol}="${spec.name},${previous},${previous},${current},${current * 1.005},${previous * 0.995},0,0,100000000,200000000000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,${marketDate},12:00:00,00,";`;
}).join("\n");
const indexQuotes = pulse.parseSinaIndexQuotes(indexText);
assert.equal(indexQuotes.size, 4);
assert.equal(indexQuotes.get("sh000001").asOf, "2026-08-26T12:00:00+08:00");
assert.equal(
  pulse.parseSinaIndexQuotes(indexText.replaceAll("12:00:00", "25:00:00")).size,
  0,
  "越界行情时点必须拒绝",
);

const indexHistories = new Map();
for (const [position, spec] of pulse.MARKET_PULSE_INDEXES.entries()) {
  const rows = [];
  for (let offset = 249; offset >= 1; offset -= 1) {
    const progress = 250 - offset;
    const close = 2_000 + position * 300 + progress * 4;
    rows.push({
      day: addDays(marketDate, -offset),
      open: close - 2,
      high: close + 4,
      low: close - 4,
      close,
      volume: 100_000_000,
    });
  }
  const bars = pulse.parseSinaKline({ result: { data: rows } });
  indexHistories.set(spec.symbol, bars);
}
const trend = pulse.analyzeIndexTrend(indexQuotes.get("sh000001"), indexHistories.get("sh000001"));
assert.equal(trend.regime, "bullish");
assert(trend.return120 > 0);
assert(trend.ma20 > trend.ma60);
assert.equal(trend.highLookback, 250);
assert.throws(
  () => pulse.analyzeIndexTrend(
    {
      ...indexQuotes.get("sh000001"),
      marketDate: "2026-09-10",
      asOf: "2026-09-10T12:00:00+08:00",
    },
    indexHistories.get("sh000001"),
  ),
  /history is stale/u,
);

const news = pulse.parseEastmoneyMarketNews({
  data: {
    fastNewsList: [
      {
        code: "20260826001",
        title: "有色金属价格走强，铜矿供应受到关注",
        summary: "铜与铝相关产业数据发布。",
        showTime: "2026-08-26 11:30:00",
      },
      {
        code: "20260826002",
        title: "无关海外事件",
        summary: "没有行业关键词。",
        showTime: "2026-08-26 11:20:00",
      },
    ],
  },
}, "2026-08-26T04:05:00.000Z");
assert.equal(news.length, 2);
assert.equal(news[0].source, "eastmoney-724");
const sinaNews = pulse.parseSinaFinanceRoll({
  result: {
    data: [{
      docid: "comos:test001",
      title: "有色金属价格走强，铜矿供应受到关注",
      intro: "铜矿供给与有色板块表现受到市场关注。",
      ctime: String(Date.parse("2026-08-26T03:32:00.000Z") / 1_000),
      url: "https://finance.sina.com.cn/stock/2026-08-26/doc-test001.shtml",
      media_name: "证券时报",
    }],
  },
}, "2026-08-26T04:05:00.000Z");
assert.equal(sinaNews.length, 1);
assert.equal(sinaNews[0].source, "sina-finance");
const csrcNews = pulse.parseCsrcMarketNews(`
  <a href="/csrc/c100028/c7655001/content.shtml">关于资本市场支持新质生产力的意见</a>
  <span class="time">08-26</span>
`, "2026-08-26T04:05:00.000Z");
assert.equal(csrcNews.length, 1);
assert.equal(csrcNews[0].official, true);
const pbcNews = pulse.parsePbcMarketNews(`
  <a href="/goutongjiaoliu/113456/113469/2026082809193480410/index.html" target="_blank" title="中国人民银行公告﹝2026﹞第22号">中国人民银行公告</a>
  <span class="hui12">2026-08-28</span>
`, "2026-08-30T04:05:00.000Z");
assert.equal(pbcNews.length, 1);
assert.equal(pbcNews[0].source, "pbc-policy");
assert.equal(pbcNews[0].official, true);
const mergedNews = pulse.mergeMarketNews([...news, ...sinaNews, ...csrcNews]);
assert.equal(mergedNews.find((item) => item.title.includes("有色金属")).sourceCount, 2);
const balancedHeadlines = cli.selectMarketHeadlines(mergedNews, 3);
assert.deepEqual(new Set(balancedHeadlines.flatMap((item) => item.sources.map((source) => source.source))), new Set(["sina-finance", "eastmoney-724", "csrc-policy"]));
assert.equal(
  pulse.parseEastmoneyMarketNews({
    data: { fastNewsList: [{ code: "bad-date", title: "坏日期", showTime: "2026-02-30 11:30:00" }] },
  }, "2026-08-26T04:05:00.000Z").length,
  0,
  "不存在的新闻日期必须拒绝",
);
const associations = pulse.associateSectorNews(industries.slice(0, 1), news, "2026-08-26T12:00:00+08:00");
assert.equal(associations.get("new_ysjs").matches.length, 1);

const report = pulse.buildMarketPulseReport({
  quotes: quoteRows,
  industries,
  indexQuotes,
  indexHistories,
  news,
  marketDate,
  asOf: "2026-08-26T12:00:00+08:00",
  generatedAt: "2026-08-26T04:05:06.789Z",
  provisional: true,
  sourceStatus: { news: true },
});
assert.equal(report.kind, "market-overview");
assert.equal(report.status, "positive");
assert.equal(report.facts.length, 8);
assert.match(report.facts.find((fact) => fact.label === "情绪").value, /全市场 160.*平 9/u);
assert.equal(report.items.length, 9);
assert(report.summary.includes("新闻只作为催化线索"));
assert(report.risks.some((risk) => risk.includes("盘中累计快照")));
assert(report.items.some((item) => item.name === "有色金属" && item.detail.includes("新闻匹配 1 条")));
assert(report.items.every((item) => !/建议买入|加仓/u.test(`${item.title}${item.detail}${item.risk}`)));
const previousCloseReport = pulse.buildMarketPulseReport({
  quotes: quoteRows,
  industries,
  indexQuotes,
  indexHistories,
  news,
  marketDate,
  asOf: "2026-08-26T12:00:00+08:00",
  generatedAt: "2026-08-27T04:05:06.789Z",
  previousClose: true,
  sourceStatus: { indexQuotes: true, industries: true, news: true },
});
assert.match(previousCloseReport.title, /最近收盘/u);
assert.match(previousCloseReport.summary, /周末、节假日或数据源延迟/u);
assert.match(previousCloseReport.facts.find((fact) => fact.label === "量能").value, /最近收盘/u);
assert(previousCloseReport.risks.some((risk) => risk.includes("没有取得新交易日快照")));
assert.throws(
  () => pulse.buildMarketPulseReport({
    quotes: quoteRows,
    marketDate,
    asOf: "2026-08-26T12:00:00+08:00",
    generatedAt: "2026-08-26T04:05:06.789Z",
    provisional: true,
    previousClose: true,
  }),
  /both provisional and previous-close/u,
);
assert.throws(
  () => pulse.buildMarketPulseReport({
    quotes: quoteRows,
    industries,
    indexQuotes,
    indexHistories,
    news,
    marketDate: "2026-08-25",
    asOf: "2026-08-26T12:00:00+08:00",
    generatedAt: "2026-08-26T04:05:06.789Z",
  }),
  /marketDate must match asOf/u,
);
assert.throws(
  () => pulse.buildMarketPulseReport({
    quotes: quoteRows,
    marketDate,
    asOf: "2026-08-26T12:00:00+23:00",
    generatedAt: "2026-08-26T04:05:06.789Z",
  }),
  /timezone-qualified/u,
);
const degradedReport = pulse.buildMarketPulseReport({
  quotes: quoteRows,
  industries: [],
  indexQuotes: new Map(),
  indexHistories: new Map(),
  news: [],
  marketDate,
  asOf: "2026-08-26T12:00:00+08:00",
  generatedAt: "2026-08-26T04:05:06.789Z",
  sourceStatus: { indexQuotes: false, industries: false, news: false },
});
assert.equal(degradedReport.status, "unavailable");
assert.equal(degradedReport.sources.length, 1);
assert(degradedReport.risks.some((risk) => risk.includes("行业板块源本次不可用")));
assert(degradedReport.risks.some((risk) => risk.includes("主要指数实时行情本次不可用")));
assert(degradedReport.risks.some((risk) => risk.includes("仅 0/4 个宽基")));

const outputPath = "data/market-insights/20260826T040506789Z-market-overview.json";
const parsedReport = insight.parseMarketInsight(JSON.stringify(report), outputPath);
assert.equal(parsedReport.kindLabel, "市场脉搏");
assert.equal(parsedReport.items.length, 9);
assert(parsedReport.sources.length >= 8);

const liveSnapshotValue = {
  schemaVersion: 1,
  kind: "live-market-snapshot",
  marketDate: report.marketDate,
  asOf: report.asOf,
  generatedAt: report.generatedAt,
  session: { phase: "intraday", provisional: true, previousClose: false },
  breadth,
  indexes: pulse.MARKET_PULSE_INDEXES.map((spec) => {
    const quote = indexQuotes.get(spec.symbol);
    return {
      symbol: spec.displaySymbol,
      name: spec.name,
      price: quote.price,
      changePercent: quote.changePercent,
      amount: quote.amount,
      asOf: quote.asOf,
    };
  }),
  sectors: [...industries.slice(0, 3), ...industries.slice(-2)].map((sector, index) => ({
    id: sector.id,
    name: sector.name,
    changePercent: sector.changePercent,
    amount: sector.amount,
    leaderSymbol: sector.leaderSymbol,
    leaderName: sector.leaderName,
    leaderChangePercent: sector.leaderChangePercent,
    direction: index < 3 ? "leading" : "lagging",
  })),
  rankings: {
    gainers: liveQuoteLists.gainers,
    losers: liveQuoteLists.losers,
    active: liveQuoteLists.active,
  },
  attention: liveQuoteLists.attention,
  anomalyBoard,
  dragonTiger: { marketDate: null, entries: [] },
  headlines: [{
    id: "market-news:sina",
    title: "A股公司产业动态",
    publishedAt: "2026-08-26T03:30:00.000Z",
    url: "https://finance.sina.com.cn/stock/2026-08-26/doc-test001.shtml",
    source: "sina-finance",
    sourceLabel: "证券时报 · 新浪聚合",
    sourceCount: 2,
    official: false,
  }, {
    id: "market-news:csrc",
    title: "资本市场政策发布",
    publishedAt: "2026-08-26T00:00:00.000Z",
    url: "https://www.csrc.gov.cn/csrc/c100028/c7655001/content.shtml",
    source: "csrc-policy",
    sourceLabel: "中国证监会 · 官方发布",
    sourceCount: 1,
    official: true,
  }],
  sourceStatus: { breadth: true, indexQuotes: true, industries: true, indexHistory: true, news: true, dragonTiger: false },
  elapsedMs: 1_234,
  report,
};
const parsedLive = liveMarket.parseLiveMarketSnapshot(JSON.stringify(liveSnapshotValue));
assert.equal(parsedLive.breadth.total, 160);

// A single extreme but valid listing must not poison either live or cached data.
const extremeQuote = { ...anomalyQuotes[0], symbol: "SH601091", name: "C波动样本",
  previousClose: 57.77, open: 30, low: 29.5, high: 56.82, price: 47.91, changePercent: -17.07 };
const extremeBoard = cli.buildIntradayAnomalies([extremeQuote, ...anomalyQuotes], liveSnapshotValue.asOf, "intraday");
const extremeLive = liveMarket.parseLiveMarketSnapshot(JSON.stringify({ ...liveSnapshotValue, anomalyBoard: extremeBoard }));
assert(extremeLive.anomalyBoard.items.some((item) => item.symbol === extremeQuote.symbol && item.metrics.gap < -30));
assert.equal(extremeLive.validationWarnings.length, 0);
const invalidBoard = structuredClone(extremeBoard);
invalidBoard.items[0].metrics.gap = null;
const isolated = liveMarket.parseLiveMarketSnapshot(JSON.stringify({ ...liveSnapshotValue, anomalyBoard: invalidBoard }));
assert.equal(isolated.breadth.total, parsedLive.breadth.total);
assert.equal(isolated.anomalyBoard.items.length, extremeBoard.items.length - 1);
assert(isolated.validationWarnings.some((warning) => warning.includes("已隔离")));
assert.equal(Object.values(isolated.anomalyBoard.counts).reduce((sum, count) => sum + count, 0), isolated.anomalyBoard.items.length);
const invalidStructure = liveMarket.parseLiveMarketSnapshot(JSON.stringify({ ...liveSnapshotValue, anomalyBoard: { version: 99 } }));
assert.equal(invalidStructure.anomalyBoard.items.length, 0);
assert(invalidStructure.validationWarnings.some((warning) => warning.includes("暂不可用")));
const exceptionalRankings = structuredClone(liveSnapshotValue.rankings);
exceptionalRankings.gainers[0].changePercent = 175;
exceptionalRankings.gainers[1].changePercent = null;
const ranks = liveMarket.parseLiveMarketSnapshot(JSON.stringify({ ...liveSnapshotValue, rankings: exceptionalRankings }));
assert.equal(ranks.rankings.gainers[0].changePercent, 175);
assert.equal(ranks.rankings.gainers.length, exceptionalRankings.gainers.length - 1);
assert.equal(ranks.indexes.length, 4);
assert(ranks.validationWarnings.some((warning) => warning.includes("排行条目已隔离")));
assert.equal(cli.buildIntradayAnomalies([{ ...extremeQuote, open: 0 }, { ...extremeQuote, low: 0 }], liveSnapshotValue.asOf, "intraday").items.length, 0);
assert.match(liveMarket.liveMarketErrorMessage('{"errorCode":"SOURCE_HTTP","message":"HTTP 456 from vip.stock.finance.sina.com.cn"}'), /频率限制/u);

assert.equal(parsedLive.indexes.length, 4);
assert.equal(parsedLive.sectors.length, 5);
assert.equal(parsedLive.rankings.gainers.length, 8);
assert.equal(parsedLive.attention.length, 8);
assert.equal(parsedLive.anomalyBoard.sessionId, "open");
assert.equal(parsedLive.anomalyBoard.items.length, anomalyBoard.items.length);
assert.equal(parsedLive.headlines[0].sourceCount, 2);
assert.equal(parsedLive.headlines[1].official, true);
assert.equal(parsedLive.session.phase, "intraday");
assert.equal(
  aShareSession.displayedAShareSessionPhase(parsedLive, new Date("2026-08-26T07:07:00.000Z")),
  "settling",
  "15:07 China time must be labelled as close settlement instead of intraday",
);
assert.equal(
  aShareSession.displayedAShareSessionPhase(parsedLive, new Date("2026-08-26T07:10:00.000Z")),
  "close-pending",
  "an old intraday snapshot after 15:10 must be labelled as waiting for a complete close",
);
assert.equal(
  aShareSession.displayedAShareSessionPhase({ ...parsedLive, session: { phase: "close" } }, new Date("2026-08-26T07:07:00.000Z")),
  "close",
);
assert.equal(
  aShareSession.displayedAShareSessionPhase(
    { ...parsedLive, marketDate: "2026-08-25", session: { phase: "close", provisional: false, previousClose: false } },
    new Date("2026-08-26T02:30:00.000Z"),
  ),
  "previous-close",
  "a close snapshot from an earlier date must be labelled as the most recent close, never today's close",
);
assert.equal(
  aShareSession.nextAShareCloseProbeAt(new Date("2026-08-26T06:00:00.000Z")).toISOString(),
  "2026-08-26T07:12:00.000Z",
);
assert.equal(
  aShareSession.nextAShareCloseProbeAt(new Date("2026-08-26T08:00:00.000Z")).toISOString(),
  "2026-08-27T07:12:00.000Z",
);
assert.equal(
  aShareSession.nextAShareCloseProbeAt(new Date("2026-08-28T08:00:00.000Z")).toISOString(),
  "2026-08-31T07:12:00.000Z",
  "the lightweight close probe must skip weekends",
);
assert.equal(
  aShareSession.aShareCloseProbeRetryMs(parsedLive, new Date("2026-08-26T07:20:00.000Z"), true),
  15 * 60 * 1_000,
  "a same-day provisional snapshot must receive one bounded retry cadence",
);
assert.equal(
  aShareSession.aShareCloseProbeRetryMs(parsedLive, new Date("2026-08-26T07:20:00.000Z"), false),
  15 * 60 * 1_000,
  "a failed close probe may retry inside the bounded close window",
);
assert.equal(
  aShareSession.aShareCloseProbeRetryMs(parsedLive, new Date("2026-08-26T09:00:00.000Z"), false),
  null,
  "the lightweight retry loop must stop at 17:00 China time",
);
assert.equal(
  aShareSession.aShareCloseProbeRetryMs({ ...parsedLive, marketDate: "2026-08-25", session: { phase: "previous-close", provisional: false } }, new Date("2026-08-26T07:20:00.000Z"), true),
  null,
  "a verified older close may represent a holiday and must not be hammered",
);
assert.equal(
  liveMarket.liveMarketErrorMessage("[TypeError: fetch failed] {\n  [cause]: Error: socket closed\n}"),
  "公开行情数据源暂时连接失败，请稍后重试",
);
assert.equal(
  liveMarket.liveMarketErrorMessage('{"ok":false,"errorCode":"SOURCE_HTTP","message":"HTTP 429 from source"}'),
  "公开行情数据源触发频率限制，请稍后再试",
);
assert.equal(liveMarket.LIVE_MARKET_REFRESH_POLICY.openMs, 3 * 60 * 1_000);
assert.equal(liveMarket.LIVE_MARKET_REFRESH_POLICY.closedMs, 15 * 60 * 1_000);
assert.deepEqual(liveMarket.liveMarketRuntimeArgs("node").slice(0, 2), ["--input-type=module", "--eval"]);
assert.deepEqual(liveMarket.liveMarketRuntimeArgs("bun").slice(0, 1), ["--eval"]);
assert(liveMarket.liveMarketRuntimeArgs("node", "refresh-local").includes("refresh-local"));
assert(liveMarket.liveMarketRuntimeArgs("node", "read-local").includes("read-local"));
assert(
  liveMarket.liveMarketRuntimeArgs("node", "refresh-local").some((value) => value.includes("--persist-panel-data")),
  "automatic market refreshes must persist the complete daily archive in private panel data",
);
assert.throws(() => liveMarket.liveMarketRuntimeArgs("node", "unsafe"), /本地模式不受支持/u);
assert.throws(() => liveMarket.liveMarketRuntimeArgs("python3"), /运行时不受支持/u);
assert.throws(
  () => liveMarket.parseLiveMarketSnapshot(JSON.stringify({
    ...liveSnapshotValue,
    breadth: { ...breadth, flat: breadth.flat + 1 },
  })),
  /涨跌家数与行情覆盖不一致/u,
);
assert.throws(
  () => liveMarket.parseLiveMarketSnapshot(JSON.stringify({
    ...liveSnapshotValue,
    session: { phase: "close", provisional: true, previousClose: false },
  })),
  /交易阶段冲突/u,
);
assert.throws(
  () => liveMarket.parseLiveMarketSnapshot(JSON.stringify({
    ...liveSnapshotValue,
    headlines: [{
      id: "spoofed-source",
      title: "伪造来源",
      publishedAt: "2026-08-26T03:00:00.000Z",
      url: "https://not-eastmoney.com/fake",
    }],
  })),
  /盘中快讯条目无效/u,
);

const task = insight.buildMarketInsightTask("market-overview", "", new Date("2026-08-26T04:05:06.789Z"));
assert.equal(task.path, outputPath);
assert.equal(task.displayText, "保存今日盘面解读");
assert.match(task.prompt, /build-market-pulse\.mjs/u);
assert.match(task.prompt, /不要自行补写数字/u);
assert.match(task.prompt, /新闻标题与摘要.*不可信数据/u);
assert.doesNotMatch(task.prompt, /必须联网核验最新公开数据/u);

const automationPlan = insight.buildMarketPulseAutomation();
assert.equal(automationPlan.name, "投资工作台 · A股市场脉搏");
assert.equal(automationPlan.schedule, "10 10,15 * * 1-5");
assert.equal(automationPlan.timezone, "Asia/Shanghai");
assert.match(automationPlan.prompt, /quant-lab:project-runtime[\s\S]*app\/tools\/build-market-pulse\.mjs[\s\S]*node "\$PANEL_TOOL"/u);
assert.match(automationPlan.prompt, /--persist-panel-data/u);
assert.match(automationPlan.prompt, /不得为了保存再执行第二次行情请求/u);
assert.match(automationPlan.prompt, /新闻标题与摘要.*不可信数据/u);

assert.doesNotThrow(() => cli.validateMarketPulseOutputPath(outputPath));
assert.throws(() => cli.validateMarketPulseOutputPath("../../pulse.json"), /unsafe market-pulse output path/u);
assert.equal(
  cli.defaultPanelDataRoot({ platform: "darwin", home: "/Users/demo" }),
  "/Users/demo/Library/Application Support/code-shell/panel-app-data/quant-lab",
);
assert.match(
  cli.defaultPanelDataRoot({ platform: "linux", home: "/home/demo" }),
  /\/home\/demo\/\.config\/code-shell\/panel-app-data\/quant-lab$/u,
);
const writeDirectory = await mkdtemp(join(tmpdir(), "quant-lab-pulse-report-"));
try {
  const writePath = join(writeDirectory, "report.json");
  await cli.writeReportCreateOnly(writePath, "first\n");
  await assert.rejects(
    () => cli.writeReportCreateOnly(writePath, "replacement\n"),
    (error) => error?.code === "OUTPUT_EXISTS",
  );
  assert.equal(await readFile(writePath, "utf8"), "first\n");
} finally {
  await rm(writeDirectory, { recursive: true, force: true });
}
await assert.rejects(() => cli.runCli(["--unknown"], new Date("2026-08-26T04:05:06.789Z")), /unknown argument/u);

function element() {
  return {
    dataset: {},
    textContent: "",
    disabled: false,
    attributes: new Map(),
    addEventListener() {},
    setAttribute(name, value) { this.attributes.set(name, value); },
  };
}
const automations = [];
const calls = [];
const automationElements = { root: element(), schedule: element(), status: element(), action: element() };
let rejectNextList = false;
const controller = insight.createMarketPulseAutomationController({
  elements: automationElements,
  notify() {},
  async hostCall(method, params) {
    calls.push([method, params]);
    if (method === "automations.list") {
      if (rejectNextList) {
        rejectNextList = false;
        throw new Error("temporary list failure");
      }
      return { automations: [...automations] };
    }
    if (method === "automations.create") {
      automations.push({ id: "pulse-1", ...params });
      return { ok: true };
    }
    if (method === "automations.delete") {
      const index = automations.findIndex((item) => item.id === params.id);
      if (index >= 0) automations.splice(index, 1);
      return { ok: true };
    }
    throw new Error(`unexpected ${method}`);
  },
});
await controller.toggle();
assert.equal(automations.length, 1);
assert.equal(controller.state.task.name, automationPlan.name);
assert.equal(automationElements.action.attributes.get("aria-pressed"), "true");
await controller.toggle();
assert.equal(automations.length, 0);
assert.equal(automationElements.action.attributes.get("aria-pressed"), "false");
automations.push({ id: "pulse-existing", ...automationPlan });
rejectNextList = true;
await controller.load();
assert.match(controller.state.error, /temporary list failure/u);
const deleteCallsBeforeReadRetry = calls.filter(([method]) => method === "automations.delete").length;
await controller.toggle();
assert.equal(automations.length, 1, "重试读取状态不能关闭已经存在的任务");
assert.equal(
  calls.filter(([method]) => method === "automations.delete").length,
  deleteCallsBeforeReadRetry,
);
assert.equal(automationElements.action.attributes.get("aria-pressed"), "true");
await controller.toggle();
assert.equal(automations.length, 0);
assert(calls.some(([method]) => method === "automations.create"));
assert(calls.some(([method]) => method === "automations.delete"));

console.log("✓ Quant Lab deterministic market breadth, sectors, long trend, news linkage and daily pulse automation");
