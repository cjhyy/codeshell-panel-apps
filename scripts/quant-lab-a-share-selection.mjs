import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const panelDir = join(repositoryRoot, "apps", "quant-lab", "app");
const selection = await import(pathToFileURL(join(panelDir, "a-share-selection.mjs")).href);
const strategyLab = await import(pathToFileURL(join(panelDir, "a-share-strategy-lab.mjs")).href);
const stockScreener = await import(pathToFileURL(join(panelDir, "stock-screener.mjs")).href);
const patternEvidence = await import(pathToFileURL(join(panelDir, "a-share-pattern-evidence.mjs")).href);
const abnormalDeviation = await import(pathToFileURL(join(panelDir, "a-share-abnormal-deviation.mjs")).href);
const selectionUi = await import(pathToFileURL(join(panelDir, "modules", "a-share-selection-ui.mjs")).href);
const selectionSignalLab = await import(pathToFileURL(join(panelDir, "modules", "selection-signal-lab.mjs")).href);
const instruments = await import(pathToFileURL(join(panelDir, "modules", "a-share-instruments.mjs")).href);
const selectionTool = await import(pathToFileURL(join(panelDir, "tools", "build-a-share-selection.mjs")).href);
const localSnapshots = await import(pathToFileURL(join(panelDir, "tools", "local-snapshot-store.mjs")).href);

assert.equal(strategyLab.A_SHARE_STRATEGY_SPECS.length, 25);
assert.equal(selection.A_SHARE_SELECTION_LIMITS.watchStocks, 100);
assert.equal(strategyLab.A_SHARE_STRATEGY_LIBRARY_RELEASE.version, "2026.08-v1");
assert.equal(strategyLab.A_SHARE_STRATEGY_SPECS.every((item) => item.ruleVersion === "1.0.0" && item.ruleSummary.length > 20), true);
assert.equal(strategyLab.assessStrategyEvidence({ stocks: 4, t5: { evaluated: 30 }, t20: { evaluated: 20 } }).state, "accumulating");
assert.equal(strategyLab.assessStrategyEvidence({ stocks: 8, t5: { evaluated: 20, medianNetReturn: -0.1, positiveRate: 0.48 }, t20: { evaluated: 12, medianNetReturn: 1, positiveRate: 0.6, medianMaxAdverse: -5 } }).state, "caution");
assert.equal(strategyLab.assessStrategyEvidence({ stocks: 8, t5: { evaluated: 20, medianNetReturn: 1, positiveRate: 0.6 }, t20: { evaluated: 12, medianNetReturn: 2, positiveRate: 0.55, medianMaxAdverse: -8 } }).state, "candidate");
const evidenceComparison = strategyLab.compareStrategyEvidence([{
  marketDate: "2026-09-02",
  session: { provisional: false },
  strategyLab: { strategies: [{ id: "trend-pullback", label: "趋势回踩", ruleVersion: "1.0.0", signals: 12, stocks: 4, t5: { evaluated: 10 }, t20: { evaluated: 4 }, evidence: { state: "accumulating" } }] },
}], {
  strategies: [{ id: "trend-pullback", label: "趋势回踩", ruleVersion: "1.0.0", signals: 18, stocks: 6, t5: { evaluated: 14 }, t20: { evaluated: 7 }, evidence: { state: "watch", reason: "通过观察门" } }],
}, "2026-09-03");
assert.equal(evidenceComparison.summary.upgraded, 1);
assert.equal(evidenceComparison.changes[0].deltaT5, 4);
assert.match(evidenceComparison.disclosure, /规则版本变化.*不.*解释/u);

function addDays(date, days) {
  const instant = new Date(`${date}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

function history(marketDate, startPrice, dailyReturn, finalVolumeRatio = 1.25) {
  const bars = [];
  let previous = startPrice;
  for (let index = 120; index >= 0; index -= 1) {
    const close = previous * (1 + dailyReturn);
    bars.push({
      date: addDays(marketDate, -index),
      open: previous,
      high: Math.max(previous, close) * 1.004,
      low: Math.min(previous, close) * 0.996,
      close,
      volume: index === 0 ? 1_000_000 * finalVolumeRatio : 1_000_000,
    });
    previous = close;
  }
  return bars;
}

function quote(index, bars, changePercent = 1) {
  const code = String(600000 + index).padStart(6, "0");
  const last = bars.at(-1);
  return {
    symbol: `SH${code}`,
    code,
    name: `样本公司${index}`,
    board: "main",
    price: last.close,
    open: last.open,
    high: last.high,
    low: last.low,
    previousClose: last.close / (1 + changePercent / 100),
    volume: last.volume,
    amount: 800_000_000 + index * 10_000_000,
    turnover: 2 + (index % 5) * 0.2,
    changePercent,
    pe: 16 + index / 10,
    pb: 2 + index / 100,
    floatMarketCap: 10_000_000_000,
    totalMarketCap: 20_000_000_000,
  };
}

const marketDate = "2026-08-26";
const asOf = "2026-08-26T15:00:00+08:00";
const generatedAt = "2026-08-26T15:08:00+08:00";
const histories = new Map();
const memberQuotes = [];
for (let index = 0; index < 12; index += 1) {
  const dailyReturn = index < 4 ? 0.0022 : index < 8 ? 0.0012 : -0.0005;
  const bars = history(marketDate, 10 + index, dailyReturn, 1.1 + (index % 4) * 0.15);
  if ([2, 3, 6, 7].includes(index)) {
    const anchor = bars.at(-6).close;
    for (let offset = 5; offset >= 1; offset -= 1) {
      const bar = bars.at(-offset);
      const close = anchor * (1 - (6 - offset) * 0.002);
      bar.open = close * 0.998;
      bar.high = close * 1.004;
      bar.low = bar.open * 0.996;
      bar.close = close;
    }
  }
  const row = quote(index, bars, index < 8 ? 1 + index / 10 : -0.6);
  if (index === 0) row.amount = 3_000_000_000;
  memberQuotes.push(row);
  histories.set(row.symbol, bars);
}

function setLimitSequence(memberIndex, priorBoards) {
  const row = memberQuotes[memberIndex];
  const bars = histories.get(row.symbol);
  let previous = bars.at(-(priorBoards + 2)).close;
  for (let offset = priorBoards + 1; offset >= 1; offset -= 1) {
    const current = bars.at(-offset);
    const close = previous * 1.1;
    current.open = previous;
    current.high = close;
    current.low = previous;
    current.close = close;
    previous = close;
  }
  const current = bars.at(-1);
  const prior = bars.at(-2);
  Object.assign(row, {
    price: current.close,
    open: current.open,
    high: current.high,
    low: current.low,
    previousClose: prior.close,
    changePercent: (current.close / prior.close - 1) * 100,
  });
}

setLimitSequence(0, 2);
setLimitSequence(1, 0);

const marketQuotes = [...memberQuotes];
for (let index = memberQuotes.length; index < 120; index += 1) {
  const bars = history(marketDate, 8 + index / 10, 0.0002);
  marketQuotes.push(quote(index, bars, index < 82 ? 0.8 : index < 112 ? -0.8 : 0));
}

const industries = [
  { id: "new_energy", name: "电力设备", count: 80, changePercent: 2.2, amount: 95_000_000_000 },
  { id: "new_chip", name: "电子元件", count: 90, changePercent: 1.5, amount: 110_000_000_000 },
  { id: "new_bank", name: "银行", count: 42, changePercent: -0.3, amount: 70_000_000_000 },
];
const industryMembers = new Map([
  ["new_energy", memberQuotes.slice(0, 4)],
  ["new_chip", memberQuotes.slice(4, 8)],
  ["new_bank", memberQuotes.slice(8, 12)],
]);
const news = [
  {
    id: "202608260001",
    title: `新能源与储能项目加快落地，${memberQuotes[0].name}披露新订单`,
    summary: "电力设备、动力电池和储能产业链需求受到关注。",
    publishedAt: "2026-08-26T06:30:00.000Z",
    fetchedAt: "2026-08-26T07:00:00.000Z",
    url: "https://finance.eastmoney.com/a/202608260001.html",
  },
  {
    id: "202608260002",
    title: "半导体与算力基础设施出现新进展",
    summary: "芯片、电子元件和数据中心产业链更新。",
    publishedAt: "2026-08-26T05:30:00.000Z",
    fetchedAt: "2026-08-26T07:00:00.000Z",
    url: "https://finance.eastmoney.com/a/202608260002.html",
  },
];
const announcementPayload = {
  data: {
    list: [
      {
        art_code: "AN202608260001",
        title_ch: `${memberQuotes[0].name}关于重大合同中标的公告`,
        notice_date: "2026-08-26 09:00:00",
      },
      {
        art_code: "AN202608250001",
        title_ch: `${memberQuotes[0].name}关于股东减持风险提示的公告`,
        notice_date: "2026-08-25 18:00:00",
      },
    ],
  },
};
const parsedAnnouncements = selection.parseEastmoneyAnnouncements(
  announcementPayload,
  memberQuotes[0].symbol,
  generatedAt,
);
assert.equal(parsedAnnouncements.length, 2);
assert.equal(parsedAnnouncements[0].importance, "operating");
assert.equal(parsedAnnouncements[1].importance, "risk");

const snapshotInput = {
  quotes: marketQuotes,
  industries,
  sectorDirectory: [...industries, { id: "new_auto", name: "汽车制造", count: 100, changePercent: 0.1, amount: 1 }],
  industryMembers,
  histories,
  benchmarkHistories: new Map([
    ["SH000001", history(marketDate, 3_000, 0.0001)],
    ["SZ399001", history(marketDate, 10_000, 0.0001)],
    ["SZ399006", history(marketDate, 2_000, 0.0001)],
  ]),
  announcements: new Map(memberQuotes.map((row) => [row.symbol, row.symbol === memberQuotes[0].symbol ? parsedAnnouncements : []])),
  news,
  watch: {
    sectors: [{ id: "new_energy", name: "电力设备" }],
    stocks: [{ symbol: memberQuotes[0].symbol, name: memberQuotes[0].name }],
  },
  marketDate,
  asOf,
  generatedAt,
  provisional: false,
  previousClose: false,
  scanCoverage: {
    quoteUniverse: marketQuotes.length,
    researchSectors: industries.length,
    sectorMembers: histories.size,
    historyRequested: histories.size,
    historyAvailable: histories.size,
    historyCacheHits: histories.size,
    historyNetworkLoads: 0,
    historyFailed: 0,
  },
  sourceStatus: { quotes: true, industries: true, histories: true, announcements: true, news: true },
  elapsedMs: 1780,
};
const snapshot = selection.buildAShareSelectionSnapshot(snapshotInput);
const signalPool = snapshot.sectors.flatMap((sector) => [
  ...sector.representatives,
  ...sector.candidates,
  ...sector.timingQueue,
]);
const maximumSignalScore = Math.max(...signalPool.map((candidate) => candidate.relativeScore));
const strictSignal = selectionSignalLab.evaluateSelectionSignal(snapshot, {
  mode: "and",
  conditions: [
    { field: "relativeScore", operator: ">=", value: maximumSignalScore },
    { field: "return20", operator: ">", value: -100 },
  ],
});
assert(strictSignal.matches.length >= 1);
assert(strictSignal.matches.every((item) => item.candidate.relativeScore >= maximumSignalScore));
assert.match(selectionSignalLab.selectionSignalCsv(strictSignal), /market_date,mode,conditions,sector,pool,symbol,name/u);
assert.match(selectionSignalLab.selectionSignalCsv(strictSignal), /2026-08-26,and,.*SH\d{6}/u);
assert.equal(strictSignal.poolCount <= signalPool.length, true, "signal lab must deduplicate the same stock across sector pools");
const permissiveSignal = selectionSignalLab.evaluateSelectionSignal(snapshot, {
  mode: "or",
  conditions: [
    { field: "pe", operator: "<", value: -999_999 },
    { field: "return20", operator: ">", value: -100 },
  ],
});
assert.equal(permissiveSignal.matches.length, permissiveSignal.poolCount, "OR mode should accept any available passing condition");
assert.throws(
  () => selectionSignalLab.normalizeSelectionSignal({ mode: "and", conditions: [{ field: "__proto__", operator: ">", value: 0 }] }),
  /字段无效/u,
);

assert.equal(snapshot.schemaVersion, 1);
assert.equal(snapshot.kind, "a-share-selection-snapshot");
assert.equal(snapshot.market.state, "strong");
assert.equal(snapshot.market.breadth.total, 120);
assert.deepEqual(snapshot.scanCoverage, {
  quoteUniverse: 120,
  researchSectors: 3,
  sectorMembers: histories.size,
  historyRequested: histories.size,
  historyAvailable: histories.size,
  historyCacheHits: histories.size,
  historyNetworkLoads: 0,
  historyFailed: 0,
});
assert.equal(snapshot.stockDirectory.length, 120);
assert(snapshot.technologyHotspots.topicCount >= 2);
assert(snapshot.technologyHotspots.topics.some((item) => item.label === "半导体" && item.sectors.some((sector) => sector.id === "new_chip")));
assert(snapshot.technologyHotspots.topics.some((item) => item.label === "新能源技术" && item.stocks.some((stock) => stock.sectorId === "new_energy")));
assert.match(snapshot.technologyHotspots.disclaimer, /行业.*不代表.*买入建议/u);
const technologyPool = selection.selectTechnologyIndustryPool(industries, news, generatedAt, 3);
assert(technologyPool.some((item) => item.id === "new_chip"));
assert(technologyPool.some((item) => item.id === "new_energy"));
assert.equal(snapshot.strategyLab.strategies.length, 25);
assert.equal(snapshot.strategyLab.version, 2);
assert.equal(snapshot.strategyEvidenceChanges.summary.new, 0);
assert.equal(Object.values(snapshot.strategyLab.evidenceSummary).reduce((sum, value) => sum + value, 0), 25);
assert.equal(snapshot.factorLab.combinations.version, 1);
assert(Array.isArray(snapshot.factorLab.combinations.candidates));
assert.equal(snapshot.factorLab.factors.length, 6);
assert.equal(snapshot.factorLab.correlations.length, 15);
assert.equal(snapshot.factorLab.redundancy.pairs, snapshot.factorLab.correlations.filter((item) => item.state === "redundant").length);
assert.equal(snapshot.factorLab.stocks, histories.size);
assert(snapshot.factorLab.factors.some((item) => item.days >= 20));
assert(snapshot.factorLab.factors.some((item) => item.icMean != null));
assert(snapshot.factorLab.factors.some((item) => item.stability.windows.length >= 2));
assert(snapshot.factorLab.factors.every((item) => ["stable", "weakening", "reversing", "mixed", "insufficient"].includes(item.stability.state)));
assert.match(snapshot.factorLab.disclosure, /Rank IC.*滚动稳定性.*重叠.*幸存者偏差/u);
const patternFixture = patternEvidence.buildPatternEvidence(histories.get(memberQuotes[2].symbol));
assert.equal(patternFixture.available, true);
assert.equal(patternFixture.components.length, 4);
assert.match(patternFixture.disclosure, /不是上涨概率/u);
assert.match(snapshot.strategyLab.assumptions.note, /次日开盘.*佣金.*涨停/u);
assert(snapshot.predictions.length > 0);
assert(snapshot.predictions.every((item) => /不是上涨概率|不输出上涨概率/u.test(item.statement)));
assert.deepEqual(snapshot.stockDirectory[0], {
  symbol: memberQuotes[0].symbol,
  name: memberQuotes[0].name,
});
assert(snapshot.sectors.filter((item) => item.recommended).length <= snapshot.market.candidateLimit);
assert(snapshot.sectors.every((item) => item.candidates.length <= 2));
assert(snapshot.sectors.every((item) => item.representatives.length <= 3));
assert(snapshot.sectors.every((item) => item.timingQueue.length <= 3));
assert(snapshot.sectors.every((item) => item.candidates.every((candidate) => candidate.state === "opportunity")));
const energy = snapshot.sectors.find((item) => item.id === "new_energy");
assert.equal(energy.watched, true);
const deviationFixture = energy.representatives.find((item) => item.symbol === memberQuotes[0].symbol).abnormalDeviation;
assert.equal(deviationFixture.available, true);
assert.equal(deviationFixture.benchmarkSymbol, "SH000001");
assert.deepEqual(deviationFixture.windows.map((item) => item.days), [3, 10, 30]);
assert.match(deviationFixture.disclosure, /不是交易所监管认定/u);
assert.equal(abnormalDeviation.abnormalBenchmarkFor("SZ300750", "chinext"), "SZ399006");
assert.equal(abnormalDeviation.abnormalBenchmarkFor("SZ000001", "main"), "SZ399001");
assert.equal(energy.metrics.limitUpCount, 2);
assert.equal(energy.metrics.firstBoardCount, 1);
assert.equal(energy.metrics.ge2Count, 1);
assert.equal(energy.metrics.maxBoards, 3);
assert.equal(energy.metrics.rungsFilled, 1);
assert.equal(energy.metrics.ladderCompleteness, 0.5);
assert.equal(energy.metrics.memberCoverage, 0.05);
assert(energy.catalysts.some((item) => /储能/u.test(item.title)));
assert(energy.representatives.length > 0, "sector strength must stay visible independently from timing");
assert(energy.timingQueue.some((item) => item.state === "waiting"), "a chased stock must wait instead of becoming a candidate");
const blockedLeader = energy.timingQueue.find((item) => item.symbol === memberQuotes[0].symbol);
assert(blockedLeader, "a strong representative with a risk announcement must remain in the timing queue");
assert.equal(blockedLeader.setup.id, "announcement-risk-review");
assert(blockedLeader.events.some((item) => item.kind === "announcement"));
assert(blockedLeader.events.some((item) => item.kind === "news"));
const firstCandidate = energy.candidates[0];
assert(firstCandidate, "another stock that clears the strategy and event gates should remain confirmable");
const missingAnnouncements = new Map(snapshotInput.announcements);
missingAnnouncements.delete(firstCandidate.symbol);
const missingAnnouncementSnapshot = selection.buildAShareSelectionSnapshot({
  ...snapshotInput,
  announcements: missingAnnouncements,
  watch: { stocks: [{ symbol: firstCandidate.symbol, name: firstCandidate.name }] },
});
assert.equal(missingAnnouncementSnapshot.sourceStatus.announcements, true);
assert(!missingAnnouncementSnapshot.sectors.some((sector) => sector.candidates.some((item) => item.symbol === firstCandidate.symbol)));
const awaitingAnnouncement = missingAnnouncementSnapshot.sectors
  .flatMap((sector) => sector.timingQueue).find((item) => item.symbol === firstCandidate.symbol);
assert(awaitingAnnouncement, "a technically ready stock must remain reachable by the announcement fetch pass");
assert.equal(awaitingAnnouncement.state, "waiting");
assert.equal(awaitingAnnouncement.stateLabel, "等待公告数据");
assert.equal(awaitingAnnouncement.setup.id, "announcement-data-pending");
assert(awaitingAnnouncement.risks.some((risk) => /公告数据尚未成功取得/u.test(risk)));
assert.equal(missingAnnouncementSnapshot.watch.stocks[0].stateLabel, "等待公告数据");
selectionUi.parseAShareSelectionSnapshot(JSON.stringify(missingAnnouncementSnapshot));
assert.deepEqual(snapshotInput.announcements.get(firstCandidate.symbol), [], "a successful empty announcement list remains eligible");
const preliminarySnapshot = selection.buildAShareSelectionSnapshot({ ...snapshotInput, announcements: new Map() });
assert(preliminarySnapshot.sectors.every((sector) => sector.candidates.length === 0));
const announcementFetchPool = preliminarySnapshot.sectors.flatMap((sector) => [...sector.representatives, ...sector.timingQueue]);
assert(announcementFetchPool.some((item) => item.symbol === firstCandidate.symbol));
assert(!announcementFetchPool.some((item) => item.state === "opportunity"));
assert.equal(firstCandidate.setup.status, "confirmed");
assert.match(firstCandidate.setup.label, /趋势回踩|放量突破|平台突破|60日强势新高/u);
assert.equal(firstCandidate.patternEvidence.available, true);
assert.equal(firstCandidate.patternEvidence.components.length, 4);
assert.match(firstCandidate.patternEvidence.disclosure, /不是上涨概率/u);
assert.equal(snapshot.watch.stocks[0].state, "waiting");
assert.match(snapshot.watch.stocks[0].reason, /KDJ J 值.*等待回到 80 以下/u);
assert.equal(snapshot.market.mainlines[0].id, "new_energy");
assert.equal(snapshot.market.mainlines[0].method, "sample-ladder");
assert.equal(snapshot.market.mainlines[0].methodLabel, "样本梯队＋趋势");
assert(snapshot.market.mainlines[0].ladderScore > snapshot.market.mainlines[0].trendScore);
assert.match(snapshot.market.mainlines[0].risk, /高流动性成分样本/u);
assert.equal(snapshot.market.limitLadder.sealed, 2);
assert.equal(snapshot.market.limitLadder.maxBoards, 3);
assert.deepEqual(snapshot.market.limitLadder.tiers.map((item) => item.boards), [3, 1]);
assert.match(snapshot.market.limitLadder.disclosure, /不是全市场涨停家数/u);

const historicalSnapshot = (date, sectorId, sectorName, score, method = "trend-relative") => ({
  kind: "a-share-selection-snapshot",
  marketDate: date,
  session: { phase: "close", provisional: false, previousClose: false },
  market: {
    mainlines: [{ id: sectorId, name: sectorName, role: "mainline", score, method }],
  },
  sectors: [
    { id: "new_energy", name: "电力设备", relativeScore: sectorId === "new_energy" ? score : score - 12, stage: "advancing", stageLabel: sectorId === "new_energy" ? "主升" : "扩散" },
    { id: "new_chip", name: "电子元件", relativeScore: sectorId === "new_chip" ? score : score - 8, stage: "expanding", stageLabel: sectorId === "new_chip" ? "扩散" : "轮动" },
  ],
});
const snapshotWithMainlineHistory = selection.buildAShareSelectionSnapshot({
  ...snapshotInput,
  reviewSnapshots: [
    historicalSnapshot("2026-08-23", "new_chip", "电子元件", 68),
    historicalSnapshot("2026-08-24", "new_energy", "电力设备", 72),
    historicalSnapshot("2026-08-25", "new_energy", "电力设备", 79, "sample-ladder"),
  ],
});
assert.deepEqual(
  snapshotWithMainlineHistory.market.mainlineHistory.map((item) => [item.date, item.sectorId, item.duration]),
  [
    ["2026-08-23", "new_chip", 1],
    ["2026-08-24", "new_energy", 1],
    ["2026-08-25", "new_energy", 2],
    ["2026-08-26", "new_energy", 3],
  ],
);
assert.match(snapshotWithMainlineHistory.market.mainlineHistoryMethodology, /不以今天.*回填历史/u);
assert.deepEqual(snapshotWithMainlineHistory.market.rotationMatrix.dates, ["2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26"]);
assert.equal(snapshotWithMainlineHistory.market.rotationMatrix.rows[0].id, "new_energy");
assert.equal(snapshotWithMainlineHistory.market.rotationMatrix.rows[0].cells.length, 4);
assert.equal(snapshotWithMainlineHistory.market.rotationMatrix.rows[0].cells.every((item) => item.available), true);
assert.match(snapshotWithMainlineHistory.market.rotationMatrix.methodology, /不用今天.*回填历史/u);
const parsedMainlineHistorySnapshot = selectionUi.parseAShareSelectionSnapshot(JSON.stringify(snapshotWithMainlineHistory));
assert.equal(parsedMainlineHistorySnapshot.market.mainlineHistory.at(-1).duration, 3);
assert.equal(parsedMainlineHistorySnapshot.market.rotationMatrix.rows[0].cells.length, 4);

const parsedSnapshot = selectionUi.parseAShareSelectionSnapshot(JSON.stringify(snapshot));
assert.equal(parsedSnapshot.sectors.length, 3);
assert.equal(parsedSnapshot.watch.stocks[0].symbol, memberQuotes[0].symbol);
assert.equal(parsedSnapshot.sectorDirectory.length, 4);
assert.equal(parsedSnapshot.stockDirectory.length, 120);
assert.equal(parsedSnapshot.scanCoverage.quoteUniverse, 120);
assert.equal(parsedSnapshot.scanCoverage.historyAvailable, histories.size);
assert.equal(parsedSnapshot.factorLab.factors.length, 6);
assert.equal(parsedSnapshot.factorLab.horizon, 5);
assert.equal(parsedSnapshot.strategyEvidenceChanges.summary.new, 0);
assert.equal(parsedSnapshot.factorLab.correlations.length, 15);
assert.equal(parsedSnapshot.factorLab.factors[0].stability.windows.length, snapshot.factorLab.factors[0].stability.windows.length);
assert.equal(parsedSnapshot.market.mainlines[0].method, "sample-ladder");
assert.equal(parsedSnapshot.market.mainlines[0].maxBoards, 3);
assert.equal(parsedSnapshot.market.limitLadder.tiers[0].stocks[0].promoted, true);
assert.equal(parsedSnapshot.sectors.find((item) => item.id === "new_energy").metrics.limitUpCount, 2);
assert.equal(parsedSnapshot.technologyHotspots.topicCount, snapshot.technologyHotspots.topicCount);
assert(parsedSnapshot.technologyHotspots.topics.some((item) => item.stocks.length > 0));
assert.equal(parsedSnapshot.sectors.find((item) => item.id === "new_energy").candidates.every((item) => item.state === "opportunity"), true);
assert.equal(parsedSnapshot.sectors.find((item) => item.id === "new_energy").candidates[0].patternEvidence.components.length, 4);
assert.equal(parsedSnapshot.sectors.find((item) => item.id === "new_energy").representatives[0].abnormalDeviation.available, true);
assert(parsedSnapshot.sectors.find((item) => item.id === "new_energy").timingQueue.length > 0);
assert.deepEqual(
  selectionUi.waitingReasonLines({
    risks: [
      "量比 0.70，等待量能确认",
      "量比 0.70，尚未确认",
      "KDJ J 值 88.4 处于高位，等待回到 80 以下再确认",
      "距离 MA20 +8.0%，等待回到观察区",
    ],
    setup: { trigger: "等待完整收盘组合" },
  }),
  [
    "量比 0.70,等待量能确认",
    "KDJ J 值 88.4 处于高位,等待回到 80 以下再确认",
    "距离 MA20 +8.0%,等待回到观察区",
  ],
  "waiting rows must show three numbered, non-duplicate blockers instead of repeating the strategy label",
);
assert.deepEqual(
  instruments.resolveAShareStock(memberQuotes[0].name, parsedSnapshot.stockDirectory),
  { ok: true, symbol: memberQuotes[0].symbol, name: memberQuotes[0].name, matchedBy: "exact-name" },
);
assert.equal(instruments.resolveAShareStock("样本公司0", parsedSnapshot.stockDirectory).symbol, memberQuotes[0].symbol);
assert.equal(instruments.resolveAShareStock(memberQuotes[0].symbol.slice(2), []).symbol, memberQuotes[0].symbol);
assert.equal(instruments.resolveAShareStock("样本公司", parsedSnapshot.stockDirectory).code, "ambiguous");
assert.equal(instruments.resolveAShareStock("不存在公司", parsedSnapshot.stockDirectory).code, "not-found");
assert.match(
  instruments.aShareResolutionMessage(
    instruments.resolveAShareStock("样本公司", parsedSnapshot.stockDirectory),
  ),
  /名称不唯一.*样本公司0/u,
);
const poisoned = structuredClone(snapshot);
poisoned.sources[0].url = "https://evil.example/quotes";
assert.throws(() => selectionUi.parseAShareSelectionSnapshot(JSON.stringify(poisoned)), /链接来源无效/u);
const conflictingSession = structuredClone(snapshot);
conflictingSession.session = { phase: "intraday", provisional: false, previousClose: false };
assert.throws(
  () => selectionUi.parseAShareSelectionSnapshot(JSON.stringify(conflictingSession)),
  /交易阶段冲突/u,
);
const conflictingCoverage = structuredClone(snapshot);
conflictingCoverage.scanCoverage.historyFailed = 1;
assert.throws(
  () => selectionUi.parseAShareSelectionSnapshot(JSON.stringify(conflictingCoverage)),
  /扫描范围数量冲突/u,
);
const duplicateDirectory = structuredClone(snapshot);
duplicateDirectory.stockDirectory.push({ ...duplicateDirectory.stockDirectory[0] });
assert.throws(
  () => selectionUi.parseAShareSelectionSnapshot(JSON.stringify(duplicateDirectory)),
  /名称目录条目无效或重复/u,
);
const poisonedPattern = structuredClone(snapshot);
poisonedPattern.sectors[0].representatives[0].patternEvidence.score = 101;
assert.throws(
  () => selectionUi.parseAShareSelectionSnapshot(JSON.stringify(poisonedPattern)),
  /形态观察分无效/u,
);
const poisonedHotspot = structuredClone(snapshot);
poisonedHotspot.technologyHotspots.topics[0].news[0].url = "https://evil.example/hotspot";
assert.throws(
  () => selectionUi.parseAShareSelectionSnapshot(JSON.stringify(poisonedHotspot)),
  /链接来源无效/u,
);

assert.deepEqual(selectionUi.parseSelectionWatchStorage({
  sectors: [{ id: "new_energy", name: "电力设备", priority: "focus" }, { id: "bad", name: "伪造" }],
  stocks: [{ symbol: "600519", name: "贵州茅台", priority: "invalid" }, { symbol: "sz600519", name: "冲突" }],
  selectedSectorId: "new_energy",
}), {
  version: 2,
  sectors: [{ id: "new_energy", name: "电力设备", priority: "focus" }],
  stocks: [{ symbol: "SH600519", name: "贵州茅台" }],
  selectedSectorId: "new_energy",
});
assert.equal(selectionUi.parseSelectionWatchStorage({ selectedSectorId: "../../bad" }).selectedSectorId, null);
const oversizedWatch = { stocks: Array.from({ length: 105 }, (_, index) => ({
  symbol: `SH${600000 + index}`,
  name: `关注${index}`,
})) };
assert.equal(selectionUi.parseSelectionWatchStorage(oversizedWatch).stocks.length, 100);

const encodedWatch = encodeURIComponent(JSON.stringify({
  sectors: [{ id: "new_energy", name: "电力设备" }],
  stocks: [{ symbol: "SH600519", name: "贵州茅台" }],
}));
assert.deepEqual(selectionTool.parseWatchArgument(encodedWatch), {
  sectors: [{ id: "new_energy", name: "电力设备" }],
  stocks: [{ symbol: "SH600519", name: "贵州茅台" }],
});
assert.equal(selectionTool.announcementUrl("SH600519").searchParams.get("stock_list"), "600519");
assert.deepEqual(selectionUi.selectionRuntimeArgs("node", encodedWatch).slice(0, 2), ["--input-type=module", "--eval"]);
assert.equal(selectionUi.selectionRuntimeArgs("bun", encodedWatch)[0], "--eval");
assert(selectionUi.selectionRuntimeArgs("node", encodedWatch, "0123456789abcdef", "refresh-local").includes("refresh-local"));
assert(selectionUi.selectionRuntimeArgs("node", encodedWatch, "0123456789abcdef", "read-local").includes("read-local"));
assert.throws(() => selectionUi.selectionRuntimeArgs("node", encodedWatch, "unsafe"), /范围无效/u);
assert.throws(() => selectionUi.selectionRuntimeArgs("python", encodedWatch), /不受支持/u);

const intradaySnapshot = selection.buildAShareSelectionSnapshot({
  quotes: marketQuotes,
  industries,
  sectorDirectory: industries,
  industryMembers,
  histories,
  announcements: new Map(memberQuotes.map((row) => [row.symbol, []])),
  news,
  watch: {},
  marketDate,
  asOf: "2026-08-26T10:30:00+08:00",
  generatedAt: "2026-08-26T10:31:00+08:00",
  provisional: true,
  previousClose: false,
  sourceStatus: { quotes: true, industries: true, histories: true, announcements: true, news: true },
  elapsedMs: 900,
});
assert(intradaySnapshot.sectors.every((item) => item.candidates.length === 0), "intraday bars must never enter the confirmed pool");
assert(intradaySnapshot.sectors.some((item) => item.timingQueue.some((candidate) => candidate.setup.status === "intraday")));

// A current quote must never confirm yesterday's technical setup at the close.
const staleHistories = new Map([...histories].map(([symbol, bars]) => [
  symbol,
  bars.map((bar) => ({ ...bar, date: addDays(bar.date, -1) })),
]));
const staleSnapshot = selection.buildAShareSelectionSnapshot({
  ...snapshotInput,
  histories: staleHistories,
  watch: { stocks: [{ symbol: firstCandidate.symbol, name: firstCandidate.name }] },
});
assert(staleSnapshot.sectors.every((sector) => sector.candidates.length === 0));
assert.equal(staleSnapshot.watch.stocks[0].state, "unavailable");
assert.equal(staleSnapshot.watch.stocks[0].setup.id, "history-stale");
assert.match(staleSnapshot.watch.stocks[0].reason, /旧形态/u);
selectionUi.parseAShareSelectionSnapshot(JSON.stringify(staleSnapshot));

const cachedBars = histories.get(firstCandidate.symbol);
const priorBars = staleHistories.get(firstCandidate.symbol);
let networkLoads = 0;
const loadHistory = (provisional, readCached, fetchFresh = async () => {
  networkLoads += 1;
  return cachedBars;
}) => selectionTool.loadSelectionHistory(firstCandidate.symbol, marketDate, { provisional, readCached, fetchFresh });
const refreshedHistory = await loadHistory(false, async (_symbol, _date, options) => {
  assert.equal(options.maximumAgeDays, 0);
  assert.equal(options.minimumBars, 61);
  return { bars: priorBars };
});
assert.equal(refreshedHistory.origin, "network");
assert.equal(networkLoads, 1);
assert.equal((await loadHistory(false, async () => ({ bars: cachedBars }))).origin, "cache");
assert.equal(networkLoads, 1);
await assert.rejects(() => loadHistory(false, async () => ({ bars: priorBars }), async () => {
  throw Object.assign(new Error("source unavailable"), { code: "SOURCE_OFFLINE" });
}), { code: "SOURCE_OFFLINE" });
await assert.rejects(() => loadHistory(false, async () => null, async () => priorBars), { code: "HISTORY_DATE_STALE" });
assert.equal((await loadHistory(true, async (_symbol, _date, options) => {
  assert.equal(options.maximumAgeDays, 10);
  return { bars: priorBars };
})).origin, "cache");

// The MA20-reclaim and orderly-uptrend branches cannot bypass the common
// confirmation ceiling even though their individual setup rules still match.
for (const [board, ceiling] of [["main", 5.5], ["chinext", 10]]) {
  for (const dailyReturn of [0.0012, 0.0018]) {
    const bars = history(marketDate, 10, dailyReturn, 1).slice(-100);
    const row = { ...quote(450, bars, ceiling), board };
    const analyzed = stockScreener.analyzeStockHistory(row, bars, { marketDate });
    const matches = strategyLab.matchStrategySetups(analyzed, { board });
    assert(matches.some((item) => ["ma20-reclaim", "orderly-uptrend"].includes(item.id) && item.status === "confirmed"));
    const timingSnapshot = (changePercent) => selection.buildAShareSelectionSnapshot({
      ...snapshotInput,
      quotes: [...marketQuotes, { ...row, changePercent }],
      histories: new Map([...histories, [row.symbol, bars]]),
      announcements: new Map([...snapshotInput.announcements, [row.symbol, []]]),
      watch: { stocks: [{ symbol: row.symbol, name: row.name }] },
    }).watch.stocks[0];
    assert.equal(timingSnapshot(ceiling - 0.01).state, "opportunity");
    assert.equal(timingSnapshot(ceiling).state, "waiting");
    assert.match(timingSnapshot(ceiling).reason, /追高风险/u);
  }
}

// Missing saved scores are missing observations, never a fabricated zero.
for (const missing of [null, "", "   ", false]) {
  const missingScores = selection.buildAShareSelectionSnapshot({
    ...snapshotInput,
    reviewSnapshots: [{
      kind: "a-share-selection-snapshot",
      marketDate: addDays(marketDate, -1),
      market: { mainlines: [{ id: "new_energy", name: "电力设备", role: "mainline", score: missing }] },
      sectors: [{ id: "new_energy", name: "电力设备", relativeScore: missing, stage: "advancing", stageLabel: "主升" }],
    }],
  });
  assert(missingScores.market.mainlineHistory.every((item) => item.date === marketDate));
  assert.deepEqual(missingScores.market.rotationMatrix.dates, [marketDate]);
}

const reviewSignalDate = histories.get(memberQuotes[2].symbol).at(-10).date;
const reviewed = strategyLab.reviewPredictionLedger([{
  predictions: [{
    id: `${reviewSignalDate}-${memberQuotes[2].symbol}-trend-pullback`,
    marketDate: reviewSignalDate,
    symbol: memberQuotes[2].symbol,
    name: memberQuotes[2].name,
    setupId: "trend-pullback",
    setupLabel: "趋势回踩",
  }],
}], histories, marketDate);
assert.equal(reviewed.records.length, 1);
assert.equal(reviewed.records[0].h1.state, "evaluated");
assert.equal(typeof reviewed.records[0].h1.openGap, "number");
assert.equal(typeof reviewed.records[0].h1.closeReturn, "number");
assert.equal(reviewed.records[0].h5.state, "evaluated");
assert.equal(reviewed.records[0].h20.state, "pending");
assert.equal(reviewed.summary.evaluated1, 1);

const gapReview = strategyLab.reviewPredictionLedger([{
  predictions: [{
    id: "2026-09-01-SH600000-gap-review",
    marketDate: "2026-09-01",
    symbol: "SH600000",
    name: "高开样本",
    setupId: "gap-review",
    setupLabel: "高开复盘",
  }],
}], new Map([["SH600000", [
  { date: "2026-09-01", open: 9.8, high: 10.2, low: 9.7, close: 10, volume: 1_000_000 },
  { date: "2026-09-02", open: 11, high: 12, low: 10.5, close: 11.5, volume: 1_200_000 },
]]]), "2026-09-03");
assert.equal(gapReview.records[0].h1.state, "evaluated");
assert.equal(gapReview.records[0].h1.maxAdverse, 0, "a fully favourable next session has zero adverse excursion, not a positive loss");
const legacyPositiveAdverse = structuredClone(snapshot);
legacyPositiveAdverse.predictionReview = structuredClone(gapReview);
legacyPositiveAdverse.predictionReview.records[0].h1.maxAdverse = 4.97;
assert.equal(
  selectionUi.parseAShareSelectionSnapshot(JSON.stringify(legacyPositiveAdverse)).predictionReview.records[0].h1.maxAdverse,
  0,
  "a snapshot written by the previous build must remain readable and normalize positive adverse excursion to zero",
);

const localRoot = await mkdtemp(join(tmpdir(), "quant-lab-local-snapshot-"));
try {
  const written = await localSnapshots.writeLocalSnapshot({
    root: localRoot,
    stream: "a-share-selection",
    scope: "0123456789abcdef",
    snapshot,
  });
  assert.match(written.latestPath, /snapshots\/a-share-selection\/0123456789abcdef\/latest\.json$/u);
  assert.match(written.historyPath, new RegExp(`${snapshot.marketDate}-${snapshot.session.phase}\\.json$`, "u"));
  assert.deepEqual(
    await localSnapshots.readLocalSnapshot({
      root: localRoot,
      stream: "a-share-selection",
      scope: "0123456789abcdef",
    }),
    snapshot,
  );
  assert.equal((await localSnapshots.readLocalSnapshotHistory({
    root: localRoot,
    stream: "a-share-selection",
    scope: "0123456789abcdef",
  })).length, 1);
  await assert.rejects(
    () => localSnapshots.readLocalSnapshot({ root: localRoot, stream: "a-share-selection", scope: "fedcba9876543210" }),
    (error) => error?.code === "LOCAL_SNAPSHOT_MISSING",
  );
} finally {
  await rm(localRoot, { recursive: true, force: true });
}

console.log("\u2713 Quant Lab A-share theme selection, stock timing, announcements/news and watch contract");

// Portfolio synchronization preserves manual priorities, ignores closed/non-A-share
// positions, and deduplicates instruments held in multiple accounts.
{
  const ledger = { instruments: [
    { id: "a", symbol: "SH600519", name: "茅台", market: "cn" },
    { id: "b", symbol: "SZ300750", name: "宁德时代", market: "cn" },
    { id: "c", symbol: "SH603298", name: "杭叉集团", market: "cn" },
    { id: "d", symbol: "AAPL", name: "Apple", market: "us" },
  ] };
  const holdings = { positionsByAccount: [
    { instrumentId: "a", quantity: "10" }, { instrumentId: "b", quantity: "20" },
    { instrumentId: "b", quantity: "30" }, { instrumentId: "c", quantity: "0" },
    { instrumentId: "d", quantity: "2" },
  ] };
  const initial = { stocks: [{ symbol: "SH600519", name: "自选名称", priority: "focus" }] };
  const merged = selectionUi.mergePortfolioWatch(initial, ledger, holdings);
  assert.equal(merged.added, 1);
  assert.equal(merged.value.stocks[0].name, "自选名称");
  assert.equal(merged.value.stocks[0].priority, "focus");
  assert.equal(merged.value.stocks[1].source, "portfolio");
  assert.equal(selectionUi.mergePortfolioWatch(merged.value, ledger, holdings).added, 0);
  assert.equal(selectionUi.mergePortfolioWatch(merged.value, ledger, { positionsByAccount: [] }).value.stocks.length, 2);
  const full = { stocks: Array.from({ length: 100 }, (_, index) => ({ symbol: `SH${600000 + index}`, name: "原有关注" })) };
  const limited = selectionUi.mergePortfolioWatch(full, ledger, holdings);
  assert.equal(limited.value.stocks.length, 100);
  assert.deepEqual(limited.skipped, ["SH600519", "SZ300750"]);
}

assert.match(selectionUi.selectionProcessError('{"errorCode":"SOURCE_HTTP_456","message":"HTTP 456"}'), /频率限制/u);
assert.match(selectionUi.selectionProcessError("", { code: null, signal: "SIGTERM" }), /中断.*SIGTERM/u);
assert.match(selectionUi.selectionProcessError("", { code: 1 }), /退出码 1/u);
