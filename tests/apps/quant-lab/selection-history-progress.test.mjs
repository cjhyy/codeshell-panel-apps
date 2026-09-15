import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readHistoryManifest, writeHistoryManifest } from "../../../apps/quant-lab/app/tools/a-share-history-cache.mjs";
import { compactHistoryBridgeSummary, runCli } from "../../../apps/quant-lab/app/tools/initialize-a-share-history.mjs";

const previousDate = "2026-09-07";
const targetDate = "2026-09-11";
const quotes = Array.from({ length: 20 }, (_, index) => ({
  symbol: `SH${600_000 + index}`, name: `历史进度样本${index}`, board: "main",
  price: 20, open: 19.8, high: 20.2, low: 19.5, previousClose: 19.8,
  volume: 10_000_000, amount: 900_000_000 - index * 1_000_000,
  turnover: 2, changePercent: 1, pe: 20, pb: 3,
  floatMarketCap: 20_000_000_000, totalMarketCap: 30_000_000_000,
}));
const allBars = Array.from({ length: 100 }, (_, index) => {
  const date = new Date("2026-06-04T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + index);
  const close = 10 + index * 0.05;
  return {
    date: date.toISOString().slice(0, 10), open: close - 0.02,
    high: close + 0.1, low: close - 0.1, close, volume: 1_000_000,
  };
});
const barsFor = ({ from, to }) => allBars.filter((bar) => bar.date >= from && bar.date <= to);
const argv = ["--scope", "core", "--source", "tushare-pro", "--stdout"];

function dependencies(root, marketDate, overrides = {}) {
  return {
    root, now: new Date(`${marketDate}T08:30:00Z`),
    fetchMarketTimestamp: async () => ({ marketDate, asOf: `${marketDate}T15:00:00+08:00` }),
    fetchAllQuotes: async () => quotes,
    fetchBars: async (request) => barsFor(request),
    requestIntervalMs: 0, retryDelaysMs: [], concurrency: 1,
    progress: () => {}, stdout: () => {},
    ...overrides,
  };
}

async function temporaryRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "quant-lab-history-progress-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("initial checkpoints do not claim a finished network pass", async (t) => {
  const root = await temporaryRoot(t);
  let requests = 0;
  let checkpoint = null;
  const manifest = await runCli(argv, dependencies(root, previousDate, {
    fetchBars: async (request) => {
      if (requests === 5) checkpoint = await readHistoryManifest(root);
      requests += 1;
      return barsFor(request);
    },
  }));
  assert.equal(checkpoint.attempted, 5);
  assert.equal(checkpoint.networkCheckedThrough, null);
  assert.equal(manifest.attempted, manifest.total);
  assert.equal(manifest.networkCheckedThrough, previousDate);
});

test("a paused refresh preserves the last completed date and resumes cached progress", async (t) => {
  const root = await temporaryRoot(t);
  await runCli(argv, dependencies(root, previousDate));
  let requests = 0;
  let checkpoint = null;
  const paused = await runCli(argv, dependencies(root, targetDate, {
    fetchBars: async (request) => {
      requests += 1;
      if (requests === 6) {
        checkpoint = await readHistoryManifest(root);
        throw Object.assign(new Error("source unavailable"), { code: "SOURCE_HTTP" });
      }
      return barsFor(request);
    },
  }));
  assert.equal(checkpoint.attempted, 5);
  assert.equal(checkpoint.networkCheckedThrough, previousDate);
  assert.equal(paused.paused, true);
  assert.equal(paused.attempted, 6);
  assert.equal(paused.networkCheckedThrough, previousDate);
  assert.equal(paused.ready, 20, "four-day-old cache remains research-usable during an outage");
  assert.equal(paused.remaining, 0, "remaining measures research coverage, not freshness");
  assert.deepEqual(compactHistoryBridgeSummary(paused).latestDateDistribution, [
    { date: targetDate, count: 5 }, { date: previousDate, count: 15 },
  ]);

  await writeHistoryManifest({ ...paused, resumeAfter: "2000-01-01T00:00:00Z" }, root);
  let resumedRequests = 0;
  const resumed = await runCli(argv, dependencies(root, targetDate, {
    fetchBars: async (request) => { resumedRequests += 1; return barsFor(request); },
  }));
  assert.equal(resumedRequests, 15, "persisted current series must be reused on resume");
  assert.equal(resumed.networkCheckedThrough, targetDate);
  assert.equal(resumed.paused, false);
  assert.deepEqual(compactHistoryBridgeSummary(resumed).latestDateDistribution, [{ date: targetDate, count: 20 }]);
});

test("an exhausted scope with a retryable failure is still eligible for another network pass", async (t) => {
  const root = await temporaryRoot(t);
  await runCli(argv, dependencies(root, previousDate));
  let requests = 0;
  const manifest = await runCli(argv, dependencies(root, targetDate, {
    sourceFailureLimit: 100,
    fetchBars: async (request) => {
      requests += 1;
      if (requests === 1) throw Object.assign(new Error("request timed out"), { code: "SOURCE_TIMEOUT" });
      return barsFor(request);
    },
  }));
  assert.equal(manifest.attempted, manifest.total);
  assert.equal(manifest.paused, false);
  assert.equal(manifest.failed, 1);
  assert.equal(manifest.networkCheckedThrough, previousDate);
  assert.equal(manifest.ready, 20);
  assert.deepEqual(compactHistoryBridgeSummary(manifest).latestDateDistribution, [
    { date: targetDate, count: 19 }, { date: previousDate, count: 1 },
  ]);
});

test("a completed availability check may advance without inventing fresh bars", async (t) => {
  const root = await temporaryRoot(t);
  await runCli(argv, dependencies(root, previousDate));
  const manifest = await runCli(argv, dependencies(root, targetDate, {
    fetchBars: async () => {
      throw Object.assign(new Error("no new rows available"), { code: "SOURCE_EMPTY" });
    },
  }));
  assert.equal(manifest.attempted, manifest.total);
  assert.equal(manifest.paused, false);
  assert.equal(manifest.failed, 0);
  assert.equal(manifest.unavailable, 20);
  assert.equal(manifest.networkCheckedThrough, targetDate);
  assert.equal(manifest.confirmedThrough, previousDate);
  assert.equal(manifest.ready, 20);
  assert.deepEqual(compactHistoryBridgeSummary(manifest).latestDateDistribution, [{ date: previousDate, count: 20 }]);
});
