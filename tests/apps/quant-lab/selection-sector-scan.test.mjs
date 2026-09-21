import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { collectSelectionSectors } from "../../../apps/quant-lab/app/tools/selection-sector-scan.mjs";
import { fetchAllQuotesForNode } from "../../../apps/quant-lab/app/tools/screen-a-shares.mjs";
import { retryAfterFailure, restoreSourceRetry, sourceRetryErrorCode } from "../../../apps/quant-lab/app/tools/selection-source-retry.mjs";

const MARKET_DATE = "2026-09-11";
const AS_OF = "2026-09-11T15:30:00+08:00";
const symbol = (index) => `SH${String(600000 + index)}`;
const industry = (index, count = 3) => ({ id: `new_sector${String(index).padStart(3, "0")}`, count, name: `行业${index}` });
const quote = (code, overrides = {}) => ({ symbol: code, name: `股票${code}`, price: 10,
  amount: 100_000_000, floatMarketCap: 5_000_000_000, turnover: 2, ...overrides });
function bars(date = MARKET_DATE, count = 180) {
  const end = Date.parse(`${date}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(end - (count - index - 1) * 86_400_000).toISOString().slice(0, 10),
    open: 10, high: 11, low: 9, close: 10.2, volume: 10_000,
  }));
}
function defaults(extra = {}) {
  return { marketDate: MARKET_DATE, asOf: AS_OF, provisional: false, persistent: false,
    readCached: async () => null, loadHistory: async () => ({ bars: bars(), origin: "network" }), ...extra };
}
async function dataRoot(t) {
  const root = await mkdtemp(resolve(tmpdir(), "quant-lab-sector-scan-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
function checkedCounts(result) {
  const progress = result.scanProgress;
  assert.equal(progress.batch.version, 1);
  for (const key of ["memberRequests", "memberCompleted", "historyRequests", "historyAdded", "historyRejected"]) {
    assert.ok(Number.isInteger(progress.batch[key]) && progress.batch[key] >= 0);
  }
  assert.ok(progress.batch.memberCompleted <= progress.batch.memberRequests);
  assert.ok(progress.batch.historyAdded + progress.batch.historyRejected <= progress.batch.historyRequests);
  assert.equal(progress.completedSectors + progress.pendingSectors + progress.failedSectors, progress.totalSectors);
  assert.equal(result.historyCacheHits + result.historyNetworkLoads, result.histories.size);
  assert.equal(result.histories.size + result.historyPending + result.historyFailed, result.historyRequested);
  for (const sector of result.sectorScan.values()) {
    for (const key of ["memberCount", "eligibleCount", "historyAvailable", "historyPending", "historyFailed"]) {
      assert.ok(Number.isInteger(sector[key]) && sector[key] >= 0);
    }
    assert.equal(sector.historyAvailable + sector.historyPending + sector.historyFailed, sector.eligibleCount);
    assert.ok(sector.memberCount >= sector.eligibleCount);
  }
}

test("all-sector batches continue beyond twelve industries and preserve completed history", async (t) => {
  const root = await dataRoot(t);
  const industries = Array.from({ length: 13 }, (_, index) => industry(index));
  const identities = new Map(industries.map((item, index) => [item.id, [symbol(index * 3), symbol(index * 3 + 1), symbol(index * 3 + 2)]]));
  const currentQuotes = [...identities.values()].flat().map((code) => quote(code));
  const memberCalls = [], historyCalls = [];
  const settings = defaults({ root, persistent: true, industries: [...industries].reverse(), quotes: currentQuotes,
    fetchMembers: async (id) => { memberCalls.push(id); return { symbols: identities.get(id), complete: true }; },
    loadHistory: async (code) => { historyCalls.push(code); return { bars: bars(), origin: "network" }; },
  });
  const first = await collectSelectionSectors(settings);
  assert.equal(memberCalls.length, 8);
  assert.equal(historyCalls.length, 24);
  assert.equal(first.scanProgress.completedSectors, 8);
  assert.equal(first.scanProgress.pendingSectors, 5);
  assert.equal(first.scanProgress.hasMore, true);
  assert.deepEqual(first.scanProgress.batch, { version: 1, memberRequests: 8, memberCompleted: 8, historyRequests: 24, historyAdded: 24, historyRejected: 0 });
  const second = await collectSelectionSectors({ ...settings, continueScan: true,
    quotes: currentQuotes.map((item) => ({ ...item, price: 22 })) });
  assert.equal(memberCalls.length, 13);
  assert.equal(historyCalls.length, 39);
  assert.equal(second.historyCacheHits, 24);
  assert.equal(second.historyNetworkLoads, 15);
  assert.equal(second.industryMembers.size, 13);
  assert.equal(second.industryMembers.get(industries[0].id)[0].price, 22);
  assert.equal(second.scanProgress.state, "complete");
  assert.equal(second.scanProgress.hasMore, false);
  checkedCounts(first); checkedCounts(second);
  const files = await readdir(resolve(root, "selection-sector-scan/v1", MARKET_DATE, "close"));
  assert.equal(files.filter((file) => file.startsWith("history-")).length, 39);
  assert.ok(!files.includes("scan.lock"));
});

test("all members including thirteenth and 101st use local history before the network allowance", async () => {
  const members = Array.from({ length: 120 }, (_, index) => symbol(index));
  const network = [];
  let localReads = 0;
  const result = await collectSelectionSectors(defaults({
    industries: [industry(0, members.length)], quotes: members.map((code) => quote(code)),
    fetchMembers: async () => ({ symbols: [...members].reverse(), complete: true }),
    readCached: async (code) => { localReads += 1; return [members[12], members[100]].includes(code) ? null : { bars: bars(), adjustment: "qfq" }; },
    loadHistory: async (code) => { network.push(code); return { bars: bars(), origin: "network" }; },
  }));
  assert.equal(result.industryMembers.values().next().value.length, 120);
  assert.equal(localReads, 120);
  assert.deepEqual(network, [members[12], members[100]]);
  assert.equal(result.historyCacheHits, 118);
  assert.equal(result.historyRequested, 120);
  assert.equal(result.scanProgress.state, "complete");
  checkedCounts(result);
});

test("missing histories are interleaved across sectors and shared stocks only load once", async () => {
  const industries = [industry(0, 101), industry(1, 101), industry(2, 101)];
  const identities = new Map(industries.map((item, index) => [item.id,
    [symbol(900), ...Array.from({ length: 100 }, (_, offset) => symbol(index * 100 + offset))]]));
  const called = [];
  let active = 0, maximumActive = 0;
  const result = await collectSelectionSectors(defaults({ industries,
    quotes: [...new Set([...identities.values()].flat())].map((code) => quote(code)),
    fetchMembers: async (id) => ({ symbols: identities.get(id), complete: true }),
    loadHistory: async (code) => {
      called.push(code); active += 1; maximumActive = Math.max(active, maximumActive);
      await new Promise((done) => setImmediate(done)); active -= 1;
      return { bars: bars(), origin: "network" };
    },
  }));
  assert.equal(called.length, 24);
  assert.equal(new Set(called).size, 24);
  assert.deepEqual(called.slice(0, 3), [symbol(0), symbol(100), symbol(200)]);
  assert.equal(maximumActive, 3);
  assert.equal(result.historyRequested, 301);
  assert.equal(result.historyPending, 277);
  checkedCounts(result);
});

test("persisted round-robin cursor reaches sectors beyond a 24-history batch", async (t) => {
  const root = await dataRoot(t);
  const cache = resolve(root, "selection-sector-scan/v1", MARKET_DATE, "close");
  await mkdir(cache, { recursive: true });
  const industries = Array.from({ length: 32 }, (_, index) => industry(index, 2));
  await Promise.all(industries.map((item, index) => writeFile(resolve(cache, `members-${item.id}.json`), JSON.stringify({
    version: 1, marketDate: MARKET_DATE, provisional: false, node: item.id, expectedCount: 2,
    complete: true, nextPage: 2, symbols: [symbol(index * 2), symbol(index * 2 + 1)],
  }))));
  const calls = [];
  const settings = defaults({ root, persistent: true, continueScan: true, industries,
    quotes: Array.from({ length: 64 }, (_, index) => quote(symbol(index))),
    fetchMembers: async () => assert.fail("complete membership should resume locally"),
    loadHistory: async (code) => { calls.push(code); return { bars: bars(), origin: "network" }; },
  });
  const first = await collectSelectionSectors(settings);
  assert.deepEqual(calls, Array.from({ length: 24 }, (_, index) => symbol(index * 2)));
  const second = await collectSelectionSectors(settings);
  assert.deepEqual(calls.slice(24, 32), Array.from({ length: 8 }, (_, index) => symbol((index + 24) * 2)));
  assert.equal(new Set(calls).size, 48);
  checkedCounts(first); checkedCounts(second);
});

test("transient failures retry after persisted delays, stop at three attempts, and allow manual recovery", async (t) => {
  const root = await dataRoot(t);
  let clock = Date.parse(AS_OF);
  let memberAttempts = 0, historyAttempts = 0;
  const settings = defaults({ root, persistent: true, now: () => clock,
    industries: [industry(0, 1), industry(1, 1)], quotes: [quote(symbol(0)), quote(symbol(1))],
    fetchMembers: async (id) => {
      memberAttempts += 1;
      if (id === industry(1).id) throw Object.assign(new Error("offline members"), { code: "MEMBERS_OFFLINE" });
      return { symbols: [symbol(0)], complete: true };
    },
    loadHistory: async () => { historyAttempts += 1; throw Object.assign(new Error("offline history"), { code: "HISTORY_OFFLINE" }); },
  });
  const first = await collectSelectionSectors(settings);
  assert.equal(first.historyFailed, 0);
  assert.equal(first.historyPending, 1);
  assert.equal(first.scanProgress.hasMore, true);
  assert.equal(first.scanProgress.nextRetryAt, new Date(clock + 30_000).toISOString());
  assert.equal(first.scanProgress.state, "running");
  assert.equal(first.sectorScan.get(industry(0).id).state, "partial");
  assert.equal(first.sectorScan.get(industry(1).id).state, "pending");
  assert.match(first.sectorScan.get(industry(0).id).reason, /自动重试/u);
  assert.match(first.sectorScan.get(industry(1).id).reason, /行业成员获取失败/u);
  assert.ok(first.sourceErrors.some((item) => item.errorCode === "MEMBERS_OFFLINE"));
  const second = await collectSelectionSectors({ ...settings, continueScan: true });
  assert.equal(memberAttempts, 2); assert.equal(historyAttempts, 1);
  assert.equal(second.scanProgress.hasMore, true);
  clock += 30_000;
  const third = await collectSelectionSectors({ ...settings, continueScan: true });
  assert.equal(memberAttempts, 3); assert.equal(historyAttempts, 2);
  assert.equal(third.scanProgress.nextRetryAt, new Date(clock + 120_000).toISOString());
  clock += 120_000;
  const exhausted = await collectSelectionSectors({ ...settings, continueScan: true });
  assert.equal(memberAttempts, 4); assert.equal(historyAttempts, 3);
  assert.equal(exhausted.historyFailed, 1);
  assert.equal(exhausted.historyPending, 0);
  assert.equal(exhausted.scanProgress.hasMore, false);
  assert.equal(exhausted.scanProgress.state, "partial");
  assert.equal(exhausted.sectorScan.get(industry(1).id).state, "failed");
  clock += 3_600_000;
  await collectSelectionSectors({ ...settings, continueScan: true });
  assert.equal(memberAttempts, 4); assert.equal(historyAttempts, 3);
  const manual = await collectSelectionSectors({ ...settings, continueScan: false });
  assert.equal(memberAttempts, 5); assert.equal(historyAttempts, 4);
  assert.equal(manual.scanProgress.nextRetryAt, new Date(clock + 30_000).toISOString());
  checkedCounts(first); checkedCounts(second); checkedCounts(third);
  checkedCounts(exhausted); checkedCounts(manual);
});

test("trading date and phase isolate caches and intraday data contains only closed bars", async (t) => {
  const root = await dataRoot(t);
  let memberAttempts = 0, historyAttempts = 0;
  const settings = defaults({ root, persistent: true, industries: [industry(0, 1)], quotes: [quote(symbol(0))],
    fetchMembers: async () => { memberAttempts += 1; return { symbols: [symbol(0)], complete: true }; },
    loadHistory: async (_code, date) => { historyAttempts += 1; return { bars: bars(date), origin: "network" }; },
  });
  const intraday = await collectSelectionSectors({ ...settings, provisional: true });
  assert.equal(intraday.histories.get(symbol(0)).at(-1).date, "2026-09-10");
  await collectSelectionSectors({ ...settings, continueScan: true });
  await collectSelectionSectors({ ...settings, marketDate: "2026-09-14", asOf: "2026-09-14T15:30:00+08:00", continueScan: true });
  assert.equal(memberAttempts, 3); assert.equal(historyAttempts, 3);
  checkedCounts(intraday);
});

test("stale formal cache is replaced and invalid fresh history cannot complete a sector", async () => {
  const result = await collectSelectionSectors(defaults({ industries: [industry(0, 1)], quotes: [quote(symbol(0))],
    fetchMembers: async () => ({ symbols: [symbol(0)], complete: true }),
    readCached: async () => ({ bars: bars("2026-09-10") }),
    loadHistory: async () => ({ bars: bars("2026-09-10"), origin: "network" }),
  }));
  assert.equal(result.histories.size, 0);
  assert.equal(result.historyFailed, 0);
  assert.equal(result.historyPending, 1);
  assert.equal(result.historyCacheHits, 0);
  assert.equal(result.scanProgress.state, "running");
  assert.ok(result.scanProgress.nextRetryAt);
  assert.equal(result.sourceErrors.at(-1).errorCode, "HISTORY_DATE_STALE");
  assert.deepEqual(result.scanProgress.batch, { version: 1, memberRequests: 1, memberCompleted: 1, historyRequests: 1, historyAdded: 0, historyRejected: 1 });
  checkedCounts(result);
});

test("missing current quotes are disclosed, zero eligible members is complete without a candidate", async () => {
  const result = await collectSelectionSectors(defaults({ industries: [industry(0, 3)],
    quotes: [quote(symbol(0), { name: "*ST示例" }), quote(symbol(1), { amount: 0 })],
    fetchMembers: async () => ({ symbols: [symbol(0), symbol(1), symbol(2)], complete: true }),
    loadHistory: async () => assert.fail("ineligible history must not be requested"),
  }));
  assert.equal(result.industryMembers.get(industry(0).id).length, 0);
  assert.equal(result.sectorScan.get(industry(0).id).memberCount, 3);
  assert.equal(result.sectorScan.get(industry(0).id).reason, "本轮有 1 只成员缺少可用的 A 股行情，未纳入评估");
  assert.equal(result.scanProgress.state, "complete");
  checkedCounts(result);
});

test("safety bounds fail explicitly instead of truncating sectors or constituents", async () => {
  await assert.rejects(collectSelectionSectors(defaults({ industries: Array.from({ length: 257 }, (_, i) => industry(i)), quotes: [] })), { code: "SECTOR_DIRECTORY_TOO_LARGE" });
  await assert.rejects(collectSelectionSectors(defaults({ industries: [industry(0, 2001)], quotes: [] })), { code: "SECTOR_DIRECTORY_INVALID" });
  await assert.rejects(fetchAllQuotesForNode(industry(0).id, { expectedCount: 2001 }), { code: "QUOTE_NODE_COUNT_INVALID" });
});

test("deadline stops new tasks while retaining unattempted history for continuation", async () => {
  let clock = 0, requests = 0;
  const identities = Array.from({ length: 30 }, (_, index) => symbol(index));
  const result = await collectSelectionSectors(defaults({ now: () => clock, deadlineMs: 1,
    industries: [industry(0, 30)], quotes: identities.map((code) => quote(code)),
    fetchMembers: async () => ({ symbols: identities, complete: true }),
    loadHistory: async () => { requests += 1; clock = 2; return { bars: bars(), origin: "network" }; },
  }));
  assert.equal(requests, 1);
  assert.equal(result.historyPending, 29);
  assert.equal(result.historyFailed, 0);
  assert.equal(result.scanProgress.hasMore, true);
  checkedCounts(result);
});

test("same-root overlapping processes are excluded and cache symlinks are rejected", async (t) => {
  const root = await dataRoot(t);
  let releaseMember, entered;
  const enteredPromise = new Promise((done) => { entered = done; });
  const settings = defaults({ root, persistent: true, industries: [industry(0, 0)], quotes: [],
    fetchMembers: async () => {
      entered(); await new Promise((done) => { releaseMember = done; });
      return { symbols: [], complete: true };
    },
  });
  const first = collectSelectionSectors(settings);
  await enteredPromise;
  await assert.rejects(collectSelectionSectors(settings), { code: "SELECTION_SCAN_BUSY" });
  releaseMember(); await first;
  const otherRoot = await dataRoot(t);
  await symlink(root, resolve(otherRoot, "selection-sector-scan"));
  await assert.rejects(collectSelectionSectors({ ...settings, root: otherRoot }), { code: "SELECTION_CACHE_PATH_INVALID" });
});

test("a crashed owner or an abandoned empty lock can be recovered", async (t) => {
  const root = await dataRoot(t);
  const cache = resolve(root, "selection-sector-scan/v1", MARKET_DATE, "close");
  await mkdir(cache, { recursive: true });
  const lock = resolve(cache, "scan.lock");
  const settings = defaults({ root, persistent: true, industries: [], quotes: [] });
  await writeFile(lock, JSON.stringify({ pid: 2_147_483_647, token: "dead-owner" }));
  assert.equal((await collectSelectionSectors(settings)).scanProgress.state, "complete");
  await writeFile(lock, "");
  const old = new Date(Date.now() - 180_000);
  await utimes(lock, old, old);
  assert.equal((await collectSelectionSectors(settings)).scanProgress.state, "complete");
});

test("full industry fetch reads beyond page 100, preserves halted identities, and uses symbol sort", async () => {
  const rows = Array.from({ length: 121 }, (_, index) => ({ symbol: symbol(index).toLowerCase() }));
  const calls = [];
  const result = await fetchAllQuotesForNode(industry(0).id, { expectedCount: rows.length,
    fetchPage: async (page, options) => { calls.push(options); return rows.slice((page - 1) * 100, page * 100); },
  });
  assert.equal(result.symbols.length, 121);
  assert.equal(result.quotes.length, 0);
  assert.ok(result.symbols.includes(symbol(100)));
  assert.equal(result.complete, true);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((item) => item.sort === "symbol" && item.asc === "1"));
});

test("membership page failures, early empty pages and repeated pages never report completion", async () => {
  const page = Array.from({ length: 100 }, (_, index) => ({ symbol: symbol(index) }));
  await assert.rejects(fetchAllQuotesForNode(industry(0).id, { expectedCount: 150,
    fetchPage: async (index) => index === 1 ? page : [],
  }), { code: "QUOTE_NODE_MEMBERS_MISSING" });
  await assert.rejects(fetchAllQuotesForNode(industry(0).id, { expectedCount: 150,
    fetchPage: async () => page,
  }), { code: "QUOTE_NODE_PAGINATION_REPEAT" });
  await assert.rejects(fetchAllQuotesForNode(industry(0).id, { expectedCount: 150,
    fetchPage: async (index) => { if (index > 1) throw new Error("network failed"); return page; },
  }), (error) => error.partial.complete === false && error.partial.symbols.length === 100 && error.partial.nextPage === 2);
});

test("partial membership pages persist across invocations and continue from the next page", async (t) => {
  const root = await dataRoot(t);
  const rows = Array.from({ length: 121 }, (_, index) => ({ symbol: symbol(index) }));
  const pages = [];
  let clock = 0;
  const settings = defaults({ root, persistent: true, now: () => clock, timeBudgetMs: 1,
    industries: [industry(0, rows.length)], quotes: rows.map((row) => quote(row.symbol)),
    readCached: async () => ({ bars: bars() }),
    fetchMembers: (id, options) => fetchAllQuotesForNode(id, { ...options,
      fetchPage: async (page) => { pages.push(page); clock += 2; return rows.slice((page - 1) * 100, page * 100); },
    }),
  });
  const first = await collectSelectionSectors(settings);
  assert.equal(first.sectorScan.get(industry(0).id).state, "pending");
  assert.equal(first.sectorScan.get(industry(0).id).memberCount, 0);
  assert.equal(first.sectorScan.get(industry(0).id).reason, "等待获取完整行业成员");
  assert.equal(first.scanProgress.hasMore, true);
  const second = await collectSelectionSectors({ ...settings, continueScan: true, timeBudgetMs: 100 });
  assert.deepEqual(pages, [1, 2]);
  assert.equal(second.scanProgress.state, "complete");
  assert.equal(second.histories.size, 121);
  const saved = JSON.parse(await readFile(resolve(root, "selection-sector-scan/v1", MARKET_DATE, "close", `members-${industry(0).id}.json`), "utf8"));
  assert.equal(saved.complete, true);
  checkedCounts(first); checkedCounts(second);
});

test("provider throttling pauses all member jobs across processes without blocking available history", async (t) => {
  const root = await dataRoot(t);
  let clock = Date.parse(AS_OF), calls = 0, recovering = false;
  const industries = Array.from({ length: 9 }, (_, index) => industry(index, 1));
  const options = defaults({ root, persistent: true, now: () => clock, industries,
    quotes: industries.map((_item, index) => quote(symbol(index))), watchSymbols: [symbol(99)],
    fetchMembers: async (id) => {
      calls += 1;
      if (!recovering) throw Object.assign(new Error("HTTP 456 limited"), { code: "SOURCE_HTTP", status: 456 });
      return { symbols: [symbol(Number(id.slice(-3)))], complete: true };
    },
  });
  const first = await collectSelectionSectors(options);
  assert.ok(calls >= 1 && calls <= 3, "only requests already started may remain after the first refusal");
  assert.equal(first.histories.size, 1, "the independent history provider can still serve a watched name");
  assert.equal(first.scanProgress.nextRetryAt, new Date(clock + 15 * 60_000).toISOString());
  assert.equal(first.scanProgress.pendingSectors, 9);
  assert.ok(first.sourceErrors.some((item) => item.errorCode === "SOURCE_HTTP_456"));
  const before = calls;
  const waiting = await collectSelectionSectors({ ...options, continueScan: true });
  assert.equal(calls, before);
  assert.equal(waiting.scanProgress.nextRetryAt, first.scanProgress.nextRetryAt);
  clock += 15 * 60_000;
  recovering = true;
  const resumed = await collectSelectionSectors({ ...options, continueScan: true });
  assert.equal(resumed.scanProgress.completedSectors, 8);
  assert.equal(resumed.scanProgress.hasMore, true);
  assert.equal(resumed.scanProgress.nextRetryAt, null);
  const complete = await collectSelectionSectors({ ...options, continueScan: true });
  assert.equal(complete.scanProgress.state, "complete");
  checkedCounts(first); checkedCounts(waiting); checkedCounts(resumed); checkedCounts(complete);
});

test("legacy failed caches resume with one recorded attempt rather than remaining permanently missing", async (t) => {
  const root = await dataRoot(t);
  const cache = resolve(root, "selection-sector-scan/v1", MARKET_DATE, "close");
  await mkdir(cache, { recursive: true });
  const clock = Date.parse(AS_OF);
  await writeFile(resolve(cache, `members-${industry(0).id}.json`), JSON.stringify({
    version: 1, marketDate: MARKET_DATE, provisional: false, node: industry(0).id, expectedCount: 1,
    complete: false, failed: true, reason: "SOURCE_HTTP", symbols: [], nextPage: 1,
    updatedAt: new Date(clock - 3_600_000).toISOString(),
  }));
  await writeFile(resolve(cache, `history-${symbol(0)}.json`), JSON.stringify({
    version: 1, marketDate: MARKET_DATE, provisional: false, symbol: symbol(0), status: "failed",
    reason: "HISTORY_OFFLINE", updatedAt: new Date(clock - 3_600_000).toISOString(),
  }));
  let memberCalls = 0, historyCalls = 0;
  const result = await collectSelectionSectors(defaults({ root, persistent: true, continueScan: true, now: () => clock,
    industries: [industry(0, 1)], quotes: [quote(symbol(0))],
    fetchMembers: async () => { memberCalls += 1; return { symbols: [symbol(0)], complete: true }; },
    loadHistory: async () => { historyCalls += 1; throw Object.assign(new Error("still offline"), { code: "HISTORY_OFFLINE" }); },
  }));
  assert.equal(memberCalls, 1); assert.equal(historyCalls, 1);
  assert.equal(result.historyPending, 1);
  assert.equal(result.scanProgress.nextRetryAt, new Date(clock + 120_000).toISOString());
  const saved = JSON.parse(await readFile(resolve(cache, `history-${symbol(0)}.json`), "utf8"));
  assert.equal(saved.retry.attempts, 2);
  checkedCounts(result);
});

test("short or wrong-basis history remains unavailable and is not retried automatically", async (t) => {
  const root = await dataRoot(t);
  let calls = 0;
  const settings = defaults({ root, persistent: true, industries: [], quotes: [], watchSymbols: [symbol(0), symbol(1)],
    loadHistory: async (code) => {
      calls += 1;
      return code === symbol(0) ? { bars: bars(MARKET_DATE, 60) } : { bars: bars(), adjustment: "none" };
    },
  });
  const result = await collectSelectionSectors(settings);
  assert.equal(result.historyFailed, 2); assert.equal(result.historyPending, 0);
  assert.equal(result.scanProgress.hasMore, false);
  assert.deepEqual(new Set(result.sourceErrors.map((item) => item.errorCode)), new Set(["HISTORY_SHORT", "HISTORY_BASIS"]));
  await collectSelectionSectors({ ...settings, continueScan: true });
  assert.equal(calls, 2);
  checkedCounts(result);
});

test("watched histories have a bounded head start within the shared 24-request batch", async () => {
  const industries = Array.from({ length: 49 }, (_, index) => industry(index, 1));
  const watches = Array.from({ length: 20 }, (_, index) => symbol(119 - index));
  const calls = [];
  const result = await collectSelectionSectors(defaults({ industries,
    quotes: industries.map((_item, index) => quote(symbol(index))), watchSymbols: watches,
    fetchMembers: async (id) => ({ symbols: [symbol(Number(id.slice(-3)))], complete: true }),
    loadHistory: async (code) => { calls.push(code); return { bars: bars() }; },
  }));
  assert.deepEqual(calls.slice(0, 12), watches.slice(0, 12));
  assert.equal(calls.length, 24); assert.equal(new Set(calls).size, 24);
  assert.ok(calls.some((code) => code === symbol(0)), "industry progress retains the rest of the shared quota");
  checkedCounts(result);
});

test("shared retry helper recognizes HTTP status, delays stale dates, and caps old records", () => {
  const now = Date.parse(AS_OF);
  assert.equal(sourceRetryErrorCode({ code: "ANNOUNCEMENT_HTTP", message: "HTTP 429 from source" }), "ANNOUNCEMENT_HTTP_429");
  assert.equal(retryAfterFailure({ code: "HISTORY_DATE_STALE" }, null, now).nextRetryAt, new Date(now + 300_000).toISOString());
  const first = retryAfterFailure({ code: "SOURCE_HTTP", status: 456 }, null, now);
  const second = retryAfterFailure({ code: "SOURCE_HTTP_456" }, first, now);
  assert.equal(second.nextRetryAt, new Date(now + 1_800_000).toISOString());
  assert.equal(retryAfterFailure({ code: "SOURCE_HTTP_456" }, second, now).exhausted, true);
  assert.equal(restoreSourceRetry({ reason: "HISTORY_SHORT" }, now).exhausted, true);
  assert.equal(restoreSourceRetry({ reason: "HISTORY_DATE_OR_BARS_INVALID" }, now).exhausted, false);
});

test("three source-wide throttle rounds stop new sectors and remain stopped until a manual retry", async (t) => {
  const root = await dataRoot(t);
  let clock = Date.parse(AS_OF), calls = 0;
  const settings = defaults({ root, persistent: true, now: () => clock,
    industries: Array.from({ length: 49 }, (_, index) => industry(index, 1)), quotes: [],
    fetchMembers: async () => {
      calls += 1;
      throw Object.assign(new Error("HTTP 456 from source"), { code: "SOURCE_HTTP", status: 456 });
    },
  });
  const first = await collectSelectionSectors(settings);
  assert.equal(calls, 3);
  assert.equal(first.scanProgress.nextRetryAt, new Date(clock + 15 * 60_000).toISOString());
  assert.equal(first.scanProgress.pendingSectors, 49);
  clock += 15 * 60_000;
  const second = await collectSelectionSectors({ ...settings, continueScan: true });
  assert.equal(calls, 6, "new sector names still share the existing source retry budget");
  assert.equal(second.scanProgress.nextRetryAt, new Date(clock + 30 * 60_000).toISOString());
  clock += 30 * 60_000;
  const final = await collectSelectionSectors({ ...settings, continueScan: true });
  assert.equal(calls, 9);
  assert.equal(final.scanProgress.hasMore, false);
  assert.equal(final.scanProgress.nextRetryAt, null);
  assert.equal(final.scanProgress.state, "partial");
  assert.equal(final.scanProgress.failedSectors, 49);
  assert.equal(final.scanProgress.pendingSectors, 0);
  assert.match(final.sectorScan.get(industry(48).id).reason, /自动重试已达上限/u);
  assert.ok(final.sourceErrors.some((error) => error.detail === "all-industries" && error.errorCode === "SOURCE_HTTP_456"));
  clock += 12 * 60 * 60_000;
  const stopped = await collectSelectionSectors({ ...settings, continueScan: true });
  assert.equal(calls, 9);
  assert.equal(stopped.scanProgress.batch.memberRequests, 0);
  assert.equal(stopped.scanProgress.hasMore, false);
  const manual = await collectSelectionSectors({ ...settings, continueScan: false });
  assert.equal(calls, 12);
  assert.equal(manual.scanProgress.hasMore, true);
  assert.equal(manual.scanProgress.nextRetryAt, new Date(clock + 15 * 60_000).toISOString());
  checkedCounts(first); checkedCounts(second); checkedCounts(final); checkedCounts(stopped); checkedCounts(manual);
});

test("legacy source cooldown is retained and migrates to the second bounded retry round", async (t) => {
  const root = await dataRoot(t);
  const cache = resolve(root, "selection-sector-scan/v1", MARKET_DATE, "close");
  await mkdir(cache, { recursive: true });
  let clock = Date.parse(AS_OF), calls = 0;
  const due = new Date(clock + 15 * 60_000).toISOString();
  await writeFile(resolve(cache, "progress-global.json"), JSON.stringify({
    version: 1, marketDate: MARKET_DATE, provisional: false, historyCursor: 0, memberSourceNextRetryAt: due,
  }));
  const settings = defaults({ root, persistent: true, continueScan: true, now: () => clock,
    industries: [industry(0, 1)], quotes: [],
    fetchMembers: async () => {
      calls += 1; throw Object.assign(new Error("HTTP 456 from source"), { code: "SOURCE_HTTP", status: 456 });
    },
  });
  const waiting = await collectSelectionSectors(settings);
  assert.equal(calls, 0); assert.equal(waiting.scanProgress.nextRetryAt, due);
  clock += 15 * 60_000;
  const retried = await collectSelectionSectors(settings);
  assert.equal(calls, 1);
  assert.equal(retried.scanProgress.nextRetryAt, new Date(clock + 30 * 60_000).toISOString());
  const saved = JSON.parse(await readFile(resolve(cache, "progress-global.json"), "utf8"));
  assert.equal(saved.memberSourceRetry.attempts, 2);
  checkedCounts(waiting); checkedCounts(retried);
});

test("latest-history request migration restores an exhausted stale-date budget exactly once", async (t) => {
  const root = await dataRoot(t);
  const cache = resolve(root, "selection-sector-scan/v1", MARKET_DATE, "close");
  await mkdir(cache, { recursive: true });
  let clock = Date.parse(AS_OF), calls = 0;
  let oldRetry = null;
  for (let attempt = 0; attempt < 3; attempt += 1) oldRetry = retryAfterFailure({ code: "HISTORY_DATE_STALE" }, oldRetry, clock - 3_600_000);
  await writeFile(resolve(cache, `history-${symbol(0)}.json`), JSON.stringify({
    version: 1, marketDate: MARKET_DATE, provisional: false, symbol: symbol(0), status: "failed",
    reason: "HISTORY_DATE_STALE", retry: oldRetry,
  }));
  const settings = defaults({ root, persistent: true, continueScan: true, now: () => clock,
    industries: [], quotes: [], watchSymbols: [symbol(0)],
    loadHistory: async () => { calls += 1; return { bars: bars("2026-09-10"), origin: "network" }; },
  });
  const oldMode = await collectSelectionSectors(settings);
  assert.equal(calls, 0); assert.equal(oldMode.historyFailed, 1);
  const latestMode = { ...settings, historyRequestVersion: 2 };
  const migrated = await collectSelectionSectors(latestMode);
  assert.equal(calls, 1); assert.equal(migrated.historyFailed, 0); assert.equal(migrated.historyPending, 1);
  const firstSaved = JSON.parse(await readFile(resolve(cache, `history-${symbol(0)}.json`), "utf8"));
  assert.equal(firstSaved.historyRequestVersion, 2); assert.equal(firstSaved.retry.attempts, 1);
  await collectSelectionSectors(latestMode);
  assert.equal(calls, 1, "a new marked failure must wait rather than migrate again");
  clock += 5 * 60_000;
  await collectSelectionSectors(latestMode);
  assert.equal(calls, 2);
  clock += 15 * 60_000;
  const exhausted = await collectSelectionSectors(latestMode);
  assert.equal(calls, 3); assert.equal(exhausted.historyFailed, 1); assert.equal(exhausted.scanProgress.hasMore, false);
  clock += 3_600_000;
  await collectSelectionSectors(latestMode);
  assert.equal(calls, 3, "the latest request mode retains its own exhausted budget across processes");
  checkedCounts(oldMode); checkedCounts(migrated); checkedCounts(exhausted);
});

test("latest-history migration preserves other failures and reads valid formal cache first", async (t) => {
  const root = await dataRoot(t);
  const cache = resolve(root, "selection-sector-scan/v1", MARKET_DATE, "close");
  await mkdir(cache, { recursive: true });
  const clock = Date.parse(AS_OF);
  for (const [index, reason] of [[0, "HISTORY_SHORT"], [1, "HISTORY_DATE_STALE"], [2, "HISTORY_DATE_STALE"]]) {
    let retry = null;
    for (let attempt = 0; attempt < 3; attempt += 1) retry = retryAfterFailure({ code: reason }, retry, clock);
    await writeFile(resolve(cache, `history-${symbol(index)}.json`), JSON.stringify({
      version: 1, marketDate: MARKET_DATE, provisional: false, symbol: symbol(index), status: "failed", reason, retry,
    }));
  }
  const requested = [];
  const result = await collectSelectionSectors(defaults({ root, persistent: true, continueScan: true,
    historyRequestVersion: 2, now: () => clock, industries: [], quotes: [], watchSymbols: [symbol(0), symbol(1), symbol(2)],
    readCached: async (code) => code === symbol(1) ? { bars: bars(), adjustment: "qfq" } : null,
    loadHistory: async (code) => { requested.push(code); return { bars: bars(), origin: "network" }; },
  }));
  assert.deepEqual(requested, [symbol(2)]);
  assert.equal(result.historyFailed, 1); assert.equal(result.historyCacheHits, 1); assert.equal(result.historyNetworkLoads, 1);
  const saved = JSON.parse(await readFile(resolve(cache, `history-${symbol(2)}.json`), "utf8"));
  assert.equal(saved.status, "complete"); assert.equal(saved.historyRequestVersion, 2);
  checkedCounts(result);
});

test("Sina provider upgrade reuses verified legacy members without sharing them with other providers", async (t) => {
  const root = await dataRoot(t);
  const settings = defaults({ root, persistent: true, industries: [industry(0, 1)], quotes: [quote(symbol(0))],
    fetchMembers: async () => ({ symbols: [symbol(0)], complete: true }),
  });
  await collectSelectionSectors(settings);
  let requests = 0;
  const fetchMembers = async () => { requests += 1; return { symbols: [symbol(0)], complete: true }; };
  const migrated = await collectSelectionSectors({ ...settings, industries: [industry(0, 0)], cacheNamespace: "sina", fetchMembers });
  assert.equal(requests, 0);
  assert.equal(migrated.scanProgress.completedSectors, 1);
  await collectSelectionSectors({ ...settings, cacheNamespace: "eastmoney", fetchMembers });
  assert.equal(requests, 1, "an independent taxonomy cannot inherit Sina member evidence");
});

test("cached members remain visible while missing industry metrics prevent complete ranking", async () => {
  const result = await collectSelectionSectors(defaults({
    industries: [{ ...industry(0, 0), changePercent: null, amount: null }], quotes: [quote(symbol(0))],
    fetchMembers: async () => ({ symbols: [symbol(0)], complete: true }),
  }));
  assert.equal(result.sectorScan.get(industry(0).id).state, "partial");
  assert.equal(result.sectorScan.get(industry(0).id).memberCount, 1);
  assert.equal(result.scanProgress.completedSectors, 0);
  assert.equal(result.scanProgress.pendingSectors, 1);
});
