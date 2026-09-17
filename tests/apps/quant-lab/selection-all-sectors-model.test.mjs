import assert from "node:assert/strict";
import test from "node:test";

import { buildAShareSelectionSnapshot } from "../../../apps/quant-lab/app/a-share-selection.mjs";
import { SELECTION_SCAN_LIMITS } from "../../../apps/quant-lab/app/selection-scan-contract.mjs";

const marketDate = "2026-09-11";
const generatedAt = `${marketDate}T15:30:00+08:00`;

function barsFor(rate = 0.0004, length = 100) {
  let close = 10;
  return Array.from({ length }, (_, index) => {
    const date = new Date(`${marketDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - length + 1 + index);
    const open = close;
    close *= 1 + rate;
    return { date: date.toISOString().slice(0, 10), open, high: close * 1.004, low: open * 0.996, close, volume: 1_000_000 };
  });
}

function quoteFor(index, bars) {
  const last = bars.at(-1);
  const symbol = `SH${600000 + index}`;
  return {
    symbol, code: symbol.slice(2), name: `股票${index}`, board: "main",
    price: last.close, open: last.open, high: last.high, low: last.low, previousClose: last.open,
    volume: last.volume, amount: 900_000_000, turnover: 2, changePercent: 1,
    pe: 16, pb: 2, floatMarketCap: 10_000_000_000, totalMarketCap: 20_000_000_000,
  };
}

function fixture() {
  const industries = Array.from({ length: 18 }, (_, index) => ({
    id: `new_sector${String(index).padStart(2, "0")}`, name: `行业${index}`, count: 4,
    changePercent: index === 14 ? -0.1 : 2,
    amount: index === 14 ? 1_000_000_000 : 100_000_000_000,
  }));
  const quotes = [];
  const industryMembers = new Map();
  const histories = new Map();
  const announcements = new Map();
  const sectorScan = new Map();
  for (let sectorIndex = 0; sectorIndex < 16; sectorIndex += 1) {
    const members = [];
    for (let memberIndex = 0; memberIndex < 4; memberIndex += 1) {
      const bars = barsFor(sectorIndex >= 14 ? 0.002 : 0.0004);
      const quote = quoteFor(sectorIndex * 4 + memberIndex, bars);
      quotes.push(quote);
      members.push(quote);
      if (sectorIndex !== 15 || memberIndex < 3) histories.set(quote.symbol, bars);
      announcements.set(quote.symbol, []);
    }
    industryMembers.set(industries[sectorIndex].id, members);
    sectorScan.set(industries[sectorIndex].id, {
      state: sectorIndex === 15 ? "partial" : "complete",
      memberCount: 4, eligibleCount: 4, historyAvailable: sectorIndex === 15 ? 3 : 4,
      historyPending: sectorIndex === 15 ? 1 : 0, historyFailed: 0, reason: "",
    });
  }
  sectorScan.set(industries[17].id, { state: "failed", memberCount: 0, eligibleCount: 0, historyAvailable: 0, historyPending: 0, historyFailed: 0, reason: "成员源不可用" });
  while (quotes.length < 120) quotes.push(quoteFor(quotes.length, barsFor()));
  return {
    quotes, industries: industries.slice(0, 16), sectorDirectory: industries,
    industryMembers, histories, announcements, sectorScan,
    marketDate, asOf: `${marketDate}T15:00:00+08:00`, generatedAt,
    provisional: false, sourceStatus: { quotes: true, industries: true, histories: true, announcements: true, news: false },
    omitDiagnostics: true,
  };
}

test("every industry is visible and complete ranks include a quiet industry beyond twelve", () => {
  const input = fixture();
  const snapshot = buildAShareSelectionSnapshot(input);
  assert.equal(snapshot.sectors.length, 18);
  assert.equal(snapshot.sectorDirectory.length, 18);
  const quiet = snapshot.sectors.find((sector) => sector.id === "new_sector14");
  assert.equal(quiet.rank, 1);
  assert.equal(quiet.recommended, true);
  assert(snapshot.sectors.filter((sector) => sector.recommended).length <= 3);
  assert.deepEqual(snapshot.sectors.filter((sector) => sector.scan.state === "complete").map((sector) => sector.rank), Array.from({ length: 15 }, (_, index) => index + 1));
  for (const state of ["pending", "partial", "failed"]) {
    const sector = snapshot.sectors.find((item) => item.scan.state === state);
    assert(sector);
    assert.equal(sector.rank, null);
    assert.equal(sector.recommended, false);
    assert.equal(sector.candidates.length, 0);
    assert(sector.selectionReason.length > 0);
    assert(!snapshot.market.mainlines.some((item) => item.id === sector.id));
  }
  const partial = snapshot.sectors.find((sector) => sector.scan.state === "partial");
  assert(partial.representatives.length > 0, "completed individual histories remain observable");
  assert(partial.representatives.every((stock) => stock.state !== "opportunity"));
  assert.equal(snapshot.scanProgress.totalSectors, 18);
  assert.equal(snapshot.scanProgress.completedSectors, 15);
  assert.equal(snapshot.scanProgress.pendingSectors, 2);
  assert.equal(snapshot.scanProgress.failedSectors, 1);
  assert.equal(snapshot.scanProgress.hasMore, true);
  assert.equal(snapshot.scanCoverage.historyPending, 0);
});

test("unprocessed name-only directory entries retain missing metadata and remain pending", () => {
  const input = fixture();
  input.sectorDirectory[16] = { id: "new_sector16", name: "未扫描行业" };
  const row = buildAShareSelectionSnapshot(input).sectors.find((sector) => sector.id === "new_sector16");
  assert.equal(row.scan.state, "pending");
  assert.equal(row.metrics.constituentCount, null);
  assert.equal(row.metrics.changePercent, null);
  assert.equal(row.metrics.amount, null);
  assert.equal(row.rank, null);
});

test("directory bounds fail explicitly while the normal full directory is never truncated", () => {
  const input = fixture();
  input.industries = [];
  input.industryMembers = new Map();
  input.sectorScan = new Map();
  input.sectorDirectory = Array.from({ length: SELECTION_SCAN_LIMITS.sectors }, (_, index) => ({ id: `new_all${index}`, name: `全行业${index}` }));
  const snapshot = buildAShareSelectionSnapshot(input);
  assert.equal(snapshot.sectors.length, SELECTION_SCAN_LIMITS.sectors);
  assert.equal(snapshot.sectorDirectory.length, SELECTION_SCAN_LIMITS.sectors);
  assert(snapshot.sectors.every((sector) => sector.scan.state === "pending" && sector.rank === null));
  assert.throws(() => buildAShareSelectionSnapshot({ ...input, sectorDirectory: [...input.sectorDirectory, { id: "new_overflow", name: "超界" }] }), /safety bound/u);
});

test("legacy input retains recommendations and the separate twelve watched-sector limit", () => {
  const input = fixture();
  delete input.sectorScan;
  input.industries = input.industries.slice(0, 15);
  input.watch = { sectors: input.sectorDirectory.map(({ id, name }) => ({ id, name })) };
  const snapshot = buildAShareSelectionSnapshot(input);
  assert.equal(snapshot.sectors.length, 15);
  assert.equal(snapshot.sectors[0].id, "new_sector14");
  assert(snapshot.sectors.some((sector) => sector.recommended));
  assert.equal(snapshot.watch.sectors.length, 12);
  assert.equal(snapshot.scanProgress, undefined);
  assert.equal(snapshot.scanCoverage.historyPending, undefined);
});

test("independent diagnostics use at most 120 complete histories in stable symbol order", () => {
  const input = fixture();
  input.omitDiagnostics = false;
  input.histories = new Map();
  input.quotes = [];
  for (let index = 130; index >= 0; index -= 1) {
    const bars = barsFor();
    const quote = quoteFor(index, bars);
    input.quotes.push(quote);
    input.histories.set(quote.symbol, bars);
  }
  const outdated = input.histories.get("SH600000").slice(0, -1);
  input.histories.set("SH600000", outdated);
  const snapshot = buildAShareSelectionSnapshot(input);
  assert.equal(snapshot.strategyLab.sample.symbols.length, 120);
  assert.equal(snapshot.strategyLab.sample.symbols[0], "SH600001");
  assert.equal(snapshot.strategyLab.sample.symbols.at(-1), "SH600120");
  assert.deepEqual(snapshot.factorLab.sample, snapshot.strategyLab.sample);
  assert.match(snapshot.strategyLab.disclosure, /校准样本最多 120 只，不等同全市场/u);
  assert.match(snapshot.factorLab.disclosure, /按股票代码稳定排序/u);
  assert.equal(snapshot.sectors.length, 18, "diagnostic sampling cannot shrink the selection universe");
  const omitted = buildAShareSelectionSnapshot({ ...input, omitDiagnostics: true });
  assert.equal(omitted.strategyLab.sample.omitted, true);
  assert.equal(omitted.strategyLab.sample.symbols.length, 0);
  assert.match(omitted.strategyLab.disclosure, /预扫描未计算/u);
});

test("scan count conflicts are rejected instead of publishing invented completeness", () => {
  const input = fixture();
  input.sectorScan.set("new_sector00", { state: "complete", memberCount: 4, eligibleCount: 4, historyAvailable: 3, historyPending: 1, historyFailed: 0 });
  assert.throws(() => buildAShareSelectionSnapshot(input), /counts conflict/u);
});

test("rotation retains ranks beyond twelve and leaves partial historical industries unranked", () => {
  const input = fixture();
  const historicalSectors = Array.from({ length: 49 }, (_, index) => ({
    id: `new_sector${String(index).padStart(2, "0")}`, name: `行业${index}`,
    relativeScore: 99 - index, rank: index + 1,
    stage: "expansion", stageLabel: "扩散", scan: { state: "complete" },
  }));
  input.reviewSnapshots = [
    { kind: "a-share-selection-snapshot", marketDate: "2026-09-09", session: { phase: "close" }, sectors: historicalSectors },
    { kind: "a-share-selection-snapshot", marketDate: "2026-09-10", session: { phase: "close" },
      sectors: historicalSectors.map((sector) => sector.id === "new_sector14"
        ? { ...sector, rank: null, relativeScore: 0, scan: { state: "partial" } }
        : sector) },
  ];
  const snapshot = buildAShareSelectionSnapshot(input);
  const rotation = snapshot.market.rotationMatrix;
  assert.deepEqual(rotation.dates, ["2026-09-09", "2026-09-10", marketDate]);
  const quiet = rotation.rows.find((sector) => sector.id === "new_sector14");
  assert.equal(quiet.cells[0].rank, 15, "a current leading industry can have a historical rank beyond the former twelve-industry limit");
  assert.equal(quiet.cells[0].available, true);
  assert.equal(quiet.cells[1].available, false);
  assert.equal(quiet.cells[1].rank, null, "partial historical coverage must not become rank zero or a real ranking");
  assert.equal(quiet.cells[1].score, null);
  assert.equal(quiet.cells[2].rank, 1);
});

test("a limit-up tier larger than twelve retains complete unique stock evidence", () => {
  const input = fixture();
  const bars = barsFor(0.0012);
  const previous = bars.at(-2).close;
  bars[bars.length - 1] = { ...bars.at(-1), open: previous, low: previous * 0.99, high: previous * 1.1, close: previous * 1.1 };
  const members = Array.from({ length: 20 }, (_, index) => ({ ...quoteFor(index, bars), previousClose: previous, changePercent: 10 }));
  input.quotes = [...members, ...input.quotes.slice(members.length)];
  input.industries = ["new_ladderA", "new_ladderB"].map((id) => ({ id, name: id, count: 20, amount: 20_000_000_000, changePercent: 10 }));
  input.sectorDirectory = input.industries;
  input.industryMembers = new Map(input.industries.map((industry) => [industry.id, members]));
  input.histories = new Map(members.map((stock) => [stock.symbol, bars]));
  input.sectorScan = new Map(input.industries.map((industry) => [industry.id, {
    state: "complete", memberCount: 20, eligibleCount: 20,
    historyAvailable: 20, historyPending: 0, historyFailed: 0,
  }]));
  const ladder = buildAShareSelectionSnapshot(input).market.limitLadder;
  assert.equal(ladder.sealed, 20, "overlapping industry membership must not double count limit-up stocks");
  assert.equal(ladder.tiers.length, 1);
  assert.equal(ladder.tiers[0].boards, 1);
  assert.equal(ladder.tiers[0].stocks.length, 20, "presentation limits cannot remove the evidence behind the total");
  assert.equal(ladder.sealed, ladder.tiers.reduce((sum, tier) => sum + tier.stocks.length, 0));
  assert.equal(new Set(ladder.tiers.flatMap((tier) => tier.stocks.map((stock) => stock.symbol))).size, 20);
});

test("completed industries can continue announcement or watch history batches", () => {
  const input = fixture();
  input.industries = input.industries.slice(0, 15);
  input.sectorDirectory = input.industries;
  const progress = {
    version: 1, scope: "all-industries", state: "running", hasMore: true, updatedAt: generatedAt,
    totalSectors: 15, completedSectors: 15, pendingSectors: 0, failedSectors: 0,
    announcementRequested: 25, announcementAvailable: 20, announcementPending: 5, announcementFailed: 0,
  };
  const snapshot = buildAShareSelectionSnapshot({ ...input, scanProgress: progress });
  assert.deepEqual(snapshot.scanProgress, progress);
  const watchPending = buildAShareSelectionSnapshot({
    ...input, scanProgress: { ...progress, announcementAvailable: 25, announcementPending: 0 },
    scanCoverage: { historyRequested: 61, historyAvailable: 60, historyPending: 1, historyFailed: 0 },
  });
  assert.equal(watchPending.scanProgress.state, "running");
  assert.equal(watchPending.scanProgress.pendingSectors, 0);
  const terminal = { ...progress, state: "partial", hasMore: false, announcementPending: 0, announcementFailed: 5 };
  assert.equal(buildAShareSelectionSnapshot({ ...input, scanProgress: terminal }).scanProgress.state, "partial");
  assert.throws(() => buildAShareSelectionSnapshot({ ...input, scanProgress: { ...terminal, state: "complete" } }), /state conflicts/u);
  const announcementsComplete = { ...terminal, announcementAvailable: 25, announcementFailed: 0 };
  const failedWatchInput = { ...input, scanProgress: announcementsComplete, scanCoverage: { historyRequested: 61, historyAvailable: 60, historyPending: 0, historyFailed: 1 } };
  assert.equal(buildAShareSelectionSnapshot(failedWatchInput).scanProgress.state, "partial");
  assert.throws(() => buildAShareSelectionSnapshot({ ...failedWatchInput, scanProgress: { ...announcementsComplete, state: "complete" } }), /state conflicts/u);
  assert.equal(buildAShareSelectionSnapshot({ ...input, scanProgress: announcementsComplete }).scanProgress.state, "partial", "a terminal source failure may keep progress partial despite completed sector counts");
  assert.throws(() => buildAShareSelectionSnapshot({ ...input, scanProgress: { ...progress, announcementAvailable: 19 } }), /counts conflict/u);
  assert.throws(() => buildAShareSelectionSnapshot({ ...input, scanProgress: { ...progress, announcementRequested: 6501 } }), /invalid.*announcementRequested/u);
  const missingField = { ...progress };
  delete missingField.announcementFailed;
  assert.throws(() => buildAShareSelectionSnapshot({ ...input, scanProgress: missingField }), /invalid.*announcementFailed/u);
});

test("scan progress preserves retry timing with completed sectors and no announcement backlog", () => {
  const input = fixture();
  input.industries = input.industries.slice(0, 15);
  input.sectorDirectory = input.industries;
  const progress = {
    version: 1, scope: "all-industries", state: "running", hasMore: true, updatedAt: generatedAt,
    totalSectors: 15, completedSectors: 15, pendingSectors: 0, failedSectors: 0,
    announcementRequested: 25, announcementAvailable: 25, announcementPending: 0, announcementFailed: 0,
    nextRetryAt: "2026-09-11T08:00:00.000Z",
  };
  assert.deepEqual(buildAShareSelectionSnapshot({ ...input, scanProgress: progress }).scanProgress, progress);
  assert.equal(buildAShareSelectionSnapshot({ ...input, scanProgress: { ...progress, nextRetryAt: null } }).scanProgress.nextRetryAt, null);
  assert.throws(() => buildAShareSelectionSnapshot({ ...input, scanProgress: { ...progress, nextRetryAt: "later" } }), /invalid.*nextRetryAt/u);
  assert.throws(() => buildAShareSelectionSnapshot({ ...input, scanProgress: { ...progress, state: "complete", hasMore: false } }), /invalid.*nextRetryAt/u);
});

test("batch evidence counts new requests separately from cumulative cached history", () => {
  const input = fixture();
  const progress = buildAShareSelectionSnapshot(input).scanProgress;
  const batch = {
    version: 1, memberRequests: 8, memberCompleted: 7,
    historyRequests: 24, historyAdded: 20, historyRejected: 4,
    announcementRequests: 20, announcementChecked: 19,
  };
  const snapshot = buildAShareSelectionSnapshot({ ...input, scanProgress: { ...progress, batch } });
  assert.deepEqual(snapshot.scanProgress.batch, batch);
  assert(Object.isFrozen(snapshot.scanProgress.batch));
  const zeroBatch = Object.fromEntries(Object.keys(batch).map((key) => [key, key === "version" ? 1 : 0]));
  const cached = buildAShareSelectionSnapshot({ ...input, scanProgress: { ...progress, batch: zeroBatch } });
  assert(cached.scanCoverage.historyAvailable > 24);
  assert.equal(cached.scanProgress.batch.historyAdded, 0, "already cached histories are not new network additions");
  assert.equal(buildAShareSelectionSnapshot(input).scanProgress.batch, undefined, "older producers need no batch metadata");
  const buildBatch = (value) => buildAShareSelectionSnapshot({ ...input, scanProgress: { ...progress, batch: value } });
  for (const invalid of [null, [], { ...batch, version: 2 }, { ...batch, memberRequests: 9 },
    { ...batch, historyRequests: 25 }, { ...batch, announcementRequests: 21 },
    { ...batch, historyAdded: -1 }, { ...batch, historyRejected: 1.5 },
    { ...batch, announcementChecked: "19" }]) {
    assert.throws(() => buildBatch(invalid), /invalid all-industry scan batch/u);
  }
  for (const invalid of [
    { ...batch, memberRequests: 6 }, { ...batch, historyAdded: 21 },
    { ...batch, historyRequests: 0, historyAdded: 0, historyRejected: 1 },
    { ...batch, announcementRequests: 18 },
  ]) assert.throws(() => buildBatch(invalid), /batch counts conflict/u);
  const missing = { ...batch };
  delete missing.announcementChecked;
  assert.throws(() => buildBatch(missing), /invalid.*announcementChecked/u);
});

function readyFixture() {
  const input = fixture();
  const members = Array.from({ length: 6 }, (_, index) => quoteFor(index, barsFor(0.0012)));
  const industry = { id: "new_ready", name: "就绪行业", count: members.length, amount: 6_000_000_000, changePercent: 1 };
  input.quotes = [...members, ...input.quotes.slice(members.length)];
  input.industries = [industry];
  input.sectorDirectory = [industry];
  input.industryMembers = new Map([[industry.id, members]]);
  input.histories = new Map(members.map((stock) => [stock.symbol, barsFor(0.0012)]));
  input.announcements = new Map(members.map((stock) => [stock.symbol, []]));
  input.sectorScan = new Map([[industry.id, { state: "complete", memberCount: 6, eligibleCount: 6, historyAvailable: 6, historyPending: 0, historyFailed: 0 }]]);
  return input;
}

test("announcement requests cover ready stocks hidden below the presentation cutoffs", () => {
  const input = readyFixture();
  const preliminary = buildAShareSelectionSnapshot({ ...input, announcements: new Map() });
  assert.equal(preliminary.announcementRequests.length, 6);
  const visible = new Set(preliminary.sectors.flatMap((sector) => [...sector.representatives, ...sector.timingQueue, ...sector.candidates].map((stock) => stock.symbol)));
  assert(visible.size < preliminary.announcementRequests.length);
  const announcements = new Map(preliminary.announcementRequests.map((symbol) => [symbol, visible.has(symbol) ? [{
    id: `${symbol}-risk`, kind: "announcement", label: "风险公告", importance: "risk", title: "股东减持风险提示公告",
    publishedAt: `${marketDate}T00:00:00Z`, url: `https://data.eastmoney.com/notices/detail/${symbol.slice(2)}/test.html`,
  }] : []]));
  const result = buildAShareSelectionSnapshot({ ...input, announcements });
  assert(result.sectors[0].candidates.length > 0, "known-risk leading names cannot starve the unseen ready stocks of announcement checks");
  assert(result.sectors[0].candidates.every((stock) => !visible.has(stock.symbol)));
  assert.equal(result.sectors[0].gateCounts.technicalReady, 6);
  assert.equal(result.sectors[0].gateCounts.announcementRisk, visible.size);
  assert.equal(result.sectors[0].gateCounts.confirmed, 6 - visible.size);
  assert.equal(result.selectionSummary.confirmedStocks, 6 - visible.size);
  assert.equal(result.selectionSummary.state, "ready");
  assert.equal(buildAShareSelectionSnapshot({ ...input, omitDiagnostics: false }).announcementRequests, undefined);
});

test("missing industry data is distinct from a weak-market block with visible observations", () => {
  const input = readyFixture();
  const memberSymbols = new Set(input.industryMembers.get("new_ready").map((stock) => stock.symbol));
  input.quotes = input.quotes.map((stock) => memberSymbols.has(stock.symbol) ? stock : { ...stock, changePercent: -2 });
  const weak = buildAShareSelectionSnapshot(input);
  assert.equal(weak.market.candidateLimit, 0);
  assert.equal(weak.selectionSummary.state, "market-blocked");
  assert.equal(weak.selectionSummary.analyzedStocks, 6);
  assert.equal(weak.selectionSummary.observedStocks, 6);
  assert.equal(weak.selectionSummary.confirmedStocks, 0);
  assert.equal(weak.sectors[0].gateCounts.technicalReady, 6);
  assert.equal(weak.sectors[0].gateCounts.marketBlocked, 6);
  assert.equal(weak.sectors[0].candidates.length, 0);
  assert(weak.sectors[0].timingQueue.every((stock) => stock.state === "waiting" && stock.setup.id === "market-environment"));
  assert(weak.sectors[0].timingQueue.every((stock) => stock.risks.some((reason) => /当前市场.*尚未通过/u.test(reason))));
  const missing = buildAShareSelectionSnapshot({
    ...input, industries: [], sectorDirectory: [], industryMembers: new Map(), sectorScan: new Map(),
    sourceStatus: { ...input.sourceStatus, industries: false },
    sourceErrors: [{ source: "industries", errorCode: "HTTP_456", message: "行业来源暂不可用" }],
  });
  assert.equal(missing.selectionSummary.state, "data-unavailable");
  assert.equal(missing.selectionSummary.sectorCount, 0);
  assert.match(missing.selectionSummary.reason, /行业数据源获取失败/u);
  assert.match(missing.selectionSummary.reason, /同时当前市场.*额度为 0/u);
});
