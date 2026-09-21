import assert from "node:assert/strict";
import test from "node:test";
import { selectionIndustryDirectory, selectionQuoteSnapshot } from "../../../apps/quant-lab/app/tools/selection-source-cache.mjs";
import { loadSelectionHistory, parseWatchArgument } from "../../../apps/quant-lab/app/tools/build-a-share-selection.mjs";
import { historyUrl, parseTencentHistoryPayload } from "../../../apps/quant-lab/app/tools/screen-a-shares.mjs";

function memoryStore() {
  const records = new Map();
  return { records, readSnapshot: async ({ stream }) => records.get(stream),
    writeSnapshot: async ({ stream, snapshot }) => records.set(stream, structuredClone(snapshot)) };
}

test("a throttled directory preserves all known identities and resumes after cooldown", async () => {
  const store = memoryStore();
  let requests = 0;
  const industries = Array.from({ length: 49 }, (_, i) => ({ id: `new_industry${i}`, name: `行业${i}`, count: 18, changePercent: 4 }));
  const options = { ...store, persistent: true, marketDate: "2026-09-11", provisional: false,
    now: new Date("2026-09-12T08:00:00Z"),
    seedSnapshots: [{ generatedAt: "2026-09-07T08:00:00Z", sectorDirectory: industries }],
    fetchIndustries: async () => { requests += 1; throw Object.assign(new Error("throttled"), { code: "SOURCE_HTTP", status: 456 }); },
  };
  const failed = await selectionIndustryDirectory(options);
  assert.equal(failed.industries.length, 49);
  assert(failed.industries.every((row) => row.count === 0 && row.changePercent === null));
  assert.equal(failed.available, false);
  assert.equal(failed.pending, true);
  assert.equal(failed.nextRetryAt, "2026-09-12T08:15:00.000Z");
  await selectionIndustryDirectory({ ...options, continueScan: true });
  assert.equal(requests, 1, "resumption respects source cooldown");
  const recovered = await selectionIndustryDirectory({ ...options, continueScan: true,
    now: new Date("2026-09-12T08:16:00Z"), fetchIndustries: async () => { requests += 1; return industries; } });
  assert.equal(recovered.available, true);
  assert.equal(recovered.pending, false);
  await selectionIndustryDirectory({ ...options, continueScan: true, now: new Date("2026-09-12T08:17:00Z") });
  assert.equal(requests, 2, "completed closing directory is reused across batches");
});

test("watch arguments preserve up to one hundred stocks", () => {
  const stocks = Array.from({ length: 105 }, (_, index) => ({ symbol: `SH${600000 + index}` }));
  const parsed = parseWatchArgument(encodeURIComponent(JSON.stringify({ stocks })));
  assert.equal(parsed.stocks.length, 100);
  assert.equal(parsed.stocks.at(-1).symbol, "SH600099");
});

test("an empty first directory is retryable and prior-day metrics are never revived", async () => {
  const store = memoryStore();
  const options = { ...store, persistent: true, marketDate: "2026-09-11", provisional: false,
    now: new Date("2026-09-12T08:00:00Z"), fetchIndustries: async () => [],
    seedSnapshots: [{ generatedAt: "2026-08-01T08:00:00Z", sectorDirectory: [{ id: "new_old", name: "旧行业" }] }] };
  const value = await selectionIndustryDirectory(options);
  assert.equal(value.industries.length, 0);
  assert.equal(value.pending, true, "zero industries is not a completed scan");
});

test("a partial nonempty response cannot silently replace the full industry directory", async () => {
  const store = memoryStore();
  const industries = Array.from({ length: 49 }, (_, i) => ({ id: `new_industry${i}`, name: `行业${i}` }));
  const value = await selectionIndustryDirectory({ ...store, persistent: true, marketDate: "2026-09-11", provisional: false,
    now: new Date("2026-09-12T08:00:00Z"), fetchIndustries: async () => industries.slice(0, 48),
    seedSnapshots: [{ generatedAt: "2026-09-11T08:00:00Z", sectorDirectory: industries }] });
  assert.equal(value.industries.length, 49);
  assert.equal(value.available, false);
  assert.equal(value.pending, true);
});

test("fresh quote evidence avoids refetching fifty pages and preserves its actual timestamp", async () => {
  const store = memoryStore();
  const quotes = Array.from({ length: 4_001 }, (_, i) => ({ symbol: `SH${600000 + i}`, name: `股票${i}`,
    price: 12, open: 12, high: 13, low: 11, previousClose: 12, amount: 1e8, volume: 1e7,
    turnover: 1, changePercent: 0, floatMarketCap: 1e10 }));
  store.records.set("a-share-realtime", { marketDate: "2026-09-11", generatedAt: "2026-09-11T08:00:00Z",
    asOf: "2026-09-11T16:00:00+08:00", session: { provisional: false }, quotes });
  const options = { ...store, persistent: true, marketDate: "2026-09-11", provisional: false,
    now: new Date("2026-09-12T08:00:00Z"), fetchQuotes: async () => assert.fail("fresh close must reuse the verified universe") };
  const cached = await selectionQuoteSnapshot(options);
  assert.equal(cached.cached, true);
  assert.equal(cached.asOf, "2026-09-11T16:00:00+08:00");
  assert.equal(cached.quotes.length, 4001);
  let requests = 0;
  const stale = await selectionQuoteSnapshot({ ...options, marketDate: "2026-09-12", fetchQuotes: async () => { requests += 1; return quotes; } });
  assert.equal(stale.cached, false);
  assert.equal(requests, 1);
  const intraday = { ...store.records.get("a-share-realtime"), session: { provisional: true },
    asOf: "2026-09-11T10:00:00+08:00", generatedAt: "2026-09-11T02:00:00Z" };
  store.records.set("a-share-realtime", intraday);
  await selectionQuoteSnapshot({ ...options, provisional: true, now: new Date("2026-09-11T02:04:00Z"), fetchQuotes: async () => { requests += 1; return quotes; } });
  assert.equal(requests, 2, "intraday quote evidence expires after three minutes");
  store.records.set("a-share-realtime", { ...intraday, generatedAt: "2026-09-11T02:09:00Z" });
  await selectionQuoteSnapshot({ ...options, provisional: true, now: new Date("2026-09-11T02:10:00Z"), fetchQuotes: async () => { requests += 1; return quotes; } });
  assert.equal(requests, 3, "a recent write does not make an old market observation fresh");
});

test("selection downloads use the same minimum history as its cache and preserve focus", async () => {
  const through = "2026-09-11";
  const rows = Array.from({ length: 80 }, (_, i) => [
    new Date(Date.parse(`${through}T00:00:00Z`) - (79 - i) * 86_400_000).toISOString().slice(0, 10),
    "10", "10", "11", "9", "1000000",
  ]);
  const payload = { data: { sh600000: { qfqday: rows } } };
  const result = await loadSelectionHistory("SH600000", through, {
    readCached: async () => null,
    fetchFresh: async (symbol, date, options) => {
      assert.equal(options.attempts, 1, "batch retry policy owns subsequent network attempts");
      assert.equal(options.includeLatest, true, "live selection must request Tencent's current-session row");
      return parseTencentHistoryPayload(payload, symbol, date, options).bars;
    },
  });
  assert.equal(result.bars.length, 80, "61–119 valid bars must not fail only on the network path");
  assert.equal(result.bars.at(-1).date, through);
  const watch = parseWatchArgument(encodeURIComponent(JSON.stringify({ stocks: [{ symbol: "SZ000938", name: "紫光股份", priority: "focus" }] })));
  assert.equal(watch.stocks[0].priority, "focus");
});

test("latest daily histories include the target close while excluding future rows and excess bars", () => {
  const through = "2026-09-14";
  const rows = Array.from({ length: 182 }, (_, i) => [
    new Date(Date.parse(`${through}T00:00:00Z`) + (i - 180) * 86_400_000).toISOString().slice(0, 10),
    "10", "10", "11", "9", "1000000",
  ]);
  const payload = { data: { sz001896: { qfqday: rows } } };
  assert.equal(historyUrl("SZ001896", through).searchParams.get("param").split(",")[3], through,
    "historical bounded-date callers keep their original query");
  assert.equal(historyUrl("SZ001896", through, { includeLatest: true }).searchParams.get("param").split(",")[3], "",
    "the latest endpoint is required for the provider's extra current-session row");
  const { bars } = parseTencentHistoryPayload(payload, "SZ001896", through, { includeLatest: true, minimumBars: 61 });
  assert.equal(bars.length, 180);
  assert.equal(bars.at(-1).date, through);
  assert.equal(bars.some((bar) => bar.date > through), false);
  const previous = parseTencentHistoryPayload(payload, "SZ001896", "2026-09-11", { includeLatest: true, minimumBars: 61 });
  assert.equal(previous.bars.at(-1).date, "2026-09-11", "recent-close requests cannot use today's later bar");
});
