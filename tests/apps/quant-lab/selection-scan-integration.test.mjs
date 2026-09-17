import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildSelectionSnapshot } from "../../../apps/quant-lab/app/tools/build-a-share-selection.mjs";
import { parseAShareSelectionSnapshot } from "../../../apps/quant-lab/app/modules/a-share-selection-ui.mjs";

function fixture() {
  const marketDate = "2026-09-11";
  const bars = Array.from({ length: 125 }, (_, index) => {
    const date = new Date(`${marketDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (124 - index));
    const close = 10 + index * 0.02;
    return { date: date.toISOString().slice(0, 10), open: close - 0.01, high: close + 0.05,
      low: close - 0.05, close, volume: 1_000_000 };
  });
  const quotes = Array.from({ length: 120 }, (_, index) => ({
    symbol: `SH${600000 + index}`, code: `${600000 + index}`, name: `公司${index}`,
    board: "main", price: bars.at(-1).close, open: bars.at(-1).open,
    high: bars.at(-1).high, low: bars.at(-1).low, previousClose: bars.at(-2).close,
    volume: 1_000_000, amount: 80_000_000, floatMarketCap: 5_000_000_000,
    totalMarketCap: 8_000_000_000, turnover: 2, pe: 15, pb: 2, changePercent: 1,
  }));
  const industries = Array.from({ length: 21 }, (_, index) => ({
    id: `new_industry${index}`, name: `行业${index}`, count: 4,
    changePercent: index === 20 ? -1 : 1, amount: 320_000_000,
  }));
  const members = new Map(industries.map((industry, index) => [industry.id, quotes.slice(index * 4, index * 4 + 4)]));
  return { marketDate, bars, quotes, industries, members };
}

test("real producer and UI contract resume all industries beyond the former twelve-sector gate", async () => {
  const root = await mkdtemp(join(tmpdir(), "selection-all-integration-"));
  const input = fixture();
  const memberCalls = [];
  const eventCalls = [];
  const dependencies = {
    fetchMarketTimestamp: async () => ({ marketDate: input.marketDate, asOf: `${input.marketDate}T15:00:00+08:00` }),
    fetchAllQuotes: async () => input.quotes,
    fetchIndustries: async () => input.industries,
    fetchMarketNews: async () => [],
    fetchHistorySeries: async () => ({ bars: input.bars }),
    fetchMembers: async (node) => {
      memberCalls.push(node);
      const quotes = input.members.get(node);
      return { symbols: quotes.map((item) => item.symbol), quotes, expectedCount: quotes.length,
        memberCount: quotes.length, complete: true, nextPage: 2 };
    },
    readCached: async () => ({ bars: input.bars }),
    loadHistory: async () => assert.fail("complete local histories should be reused"),
    fetchAnnouncements: async (symbol) => { eventCalls.push(symbol); return []; },
    enrichSelectionSnapshot: async (snapshot) => snapshot,
  };
  try {
    let latest;
    const snapshots = [];
    for (let batch = 0; batch < 12; batch += 1) {
      latest = await buildSelectionSnapshot({ persistLocal: true, root, continueScan: batch > 0 },
        new Date("2026-09-12T08:00:00Z"), dependencies);
      snapshots.push(latest);
      const parsed = parseAShareSelectionSnapshot(JSON.stringify(latest));
      assert.equal(parsed.sectors.length, 21);
      assert(parsed.sectors.some((sector) => sector.id === "new_industry20"), "cold industries remain visible");
      assert(parsed.sectors.filter((sector) => sector.recommended).length <= 3);
      assert.equal(parsed.scanProgress.completedSectors + parsed.scanProgress.pendingSectors + parsed.scanProgress.failedSectors, 21);
      assert.equal(parsed.scanCoverage.historyAvailable + parsed.scanCoverage.historyPending + parsed.scanCoverage.historyFailed,
        parsed.scanCoverage.historyRequested);
      assert(Buffer.byteLength(JSON.stringify(latest)) < 4 * 1024 * 1024, "snapshot fits existing Host output contract");
      if (!latest.scanProgress.hasMore) break;
    }
    assert(snapshots[0].scanProgress.pendingSectors > 0);
    assert.equal(latest.scanProgress.completedSectors, 21);
    assert.equal(latest.scanProgress.hasMore, false);
    assert.equal(latest.scanProgress.state, "complete");
    assert.equal(latest.scanCoverage.historyAvailable, 84);
    assert.equal(new Set(memberCalls).size, 21);
    assert.equal(memberCalls.length, 21, "finished memberships are not fetched every batch");
    assert.equal(new Set(eventCalls).size, eventCalls.length, "completed announcements are reused");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("intraday latest-history benchmarks stay aligned with the last closed stock session", async () => {
  const input = fixture();
  const snapshot = await buildSelectionSnapshot({}, new Date(`${input.marketDate}T06:00:00Z`), {
    fetchMarketTimestamp: async () => ({ marketDate: input.marketDate, asOf: `${input.marketDate}T14:00:00+08:00` }),
    fetchAllQuotes: async () => input.quotes,
    fetchIndustries: async () => input.industries.slice(0, 1),
    fetchMarketNews: async () => [],
    fetchHistorySeries: async (_symbol, _date, options) => {
      assert.equal(options.includeLatest, true);
      return { bars: input.bars };
    },
    fetchMembers: async (node) => ({ symbols: input.members.get(node).map((item) => item.symbol), complete: true, nextPage: 2 }),
    readCached: async () => ({ bars: input.bars }),
    loadHistory: async () => assert.fail("usable closed histories should come from cache"),
    fetchAnnouncements: async () => [],
    enrichSelectionSnapshot: async (value) => value,
  });
  assert.equal(snapshot.session.provisional, true);
  assert.equal(snapshot.sectors[0].candidates.length, 0, "an unfinished latest row must never become a close confirmation");
  const representative = snapshot.sectors[0].representatives[0];
  assert(representative);
  assert.equal(representative.abnormalDeviation.available, true,
    "stock and benchmark comparisons must both use the last closed session");
  assert(representative.abnormalDeviation.windows.every((window) => window.through === "2026-09-10"));
});
