import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readHistoryManifest } from "../../../apps/quant-lab/app/tools/a-share-history-cache.mjs";
import { runCli } from "../../../apps/quant-lab/app/tools/initialize-a-share-history.mjs";

const quotes = Array.from({ length: 20 }, (_, index) => ({
  symbol: `SH${600_000 + index}`, name: `bounded batch fixture ${index}`, board: "main",
  price: 20, open: 19.8, high: 20.2, low: 19.5, previousClose: 19.8,
  volume: 10_000_000, amount: 900_000_000 - index * 1_000_000,
  turnover: 2, changePercent: 1, pe: 20, pb: 3,
  floatMarketCap: 20_000_000_000, totalMarketCap: 30_000_000_000,
}));
const bars = Array.from({ length: 100 }, (_, index) => {
  const date = new Date("2026-06-04T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + index);
  const close = 10 + index * 0.05;
  return { date: date.toISOString().slice(0, 10), open: close - 0.02,
    high: close + 0.1, low: close - 0.1, close, volume: 1_000_000 };
});
const fetchBars = async ({ from, to }) => bars.filter(bar => bar.date >= from && bar.date <= to);
const argv = ["--scope", "core", "--source", "tushare-pro", "--stdout", "--max-items", "20"];
const dependencies = (root, marketDate, overrides = {}) => ({
  root, now: new Date(`${marketDate}T08:30:00Z`),
  fetchMarketTimestamp: async () => ({ marketDate, asOf: `${marketDate}T15:00:00+08:00` }),
  fetchAllQuotes: async () => quotes, fetchBars,
  requestIntervalMs: 0, retryDelaysMs: [], concurrency: 1, sourceFailureLimit: 100,
  progress: () => {}, stdout: () => {}, ...overrides,
});

test("a bounded history batch persists retryable failures as pending until a later batch succeeds", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quant-history-bounded-retry-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await runCli(argv, dependencies(root, "2026-09-07"));

  let requests = 0;
  const failed = await runCli(argv, dependencies(root, "2026-09-11", {
    fetchBars: async request => {
      if (++requests === 1) throw Object.assign(new Error("injected provider timeout"), { code: "SOURCE_TIMEOUT" });
      return fetchBars(request);
    },
  }));
  assert.equal(requests, 20);
  assert.equal(failed.failed, 1);
  assert.equal(failed.batch.checked.length, 19);
  assert.equal(failed.batch.checked.includes(quotes[0].symbol), false);
  assert.equal(failed.networkCheckedThrough, "2026-09-07");
  const persisted = await readHistoryManifest(root);
  assert.deepEqual(persisted.batch, failed.batch, "the next process reads the incomplete checkpoint from disk");

  const retriedSymbols = [];
  const recovered = await runCli(argv, dependencies(root, "2026-09-11", {
    fetchBars: async request => { retriedSymbols.push(request.symbol); return fetchBars(request); },
  }));
  assert.deepEqual(retriedSymbols, [quotes[0].symbol], "only the failed symbol is retried; successful rows retain their checkpoint");
  assert.equal(recovered.batch.checked.length, 20);
  assert.equal(recovered.failed, 0);
  assert.equal(recovered.networkCheckedThrough, "2026-09-11");
  assert.equal(recovered.records.every(record => record.to === "2026-09-11"), true);

  let extraRequests = 0;
  const stable = await runCli(argv, dependencies(root, "2026-09-11", {
    fetchBars: async request => { extraRequests++; return fetchBars(request); },
  }));
  assert.equal(extraRequests, 0, "a completed same-day batch remains idempotent");
  assert.equal(stable.networkCheckedThrough, "2026-09-11");
});

test("twenty persistent failures advance the durable cursor and SOURCE_EMPTY remains pending", async t => {
  const root = await mkdtemp(join(tmpdir(), "quant-history-fair-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const universe = Array.from({ length: 60 }, (_, index) => ({ ...quotes[index % 20], symbol: `SH${600000 + index}`, amount: 900000000 - index * 1000000 }));
  for (let batch = 0; batch < 3; batch++) await runCli(argv, dependencies(root, "2026-09-07", { fetchAllQuotes: async () => universe }));
  const visited = [];
  const fixture = dependencies(root, "2026-09-11", {
    fetchAllQuotes: async () => universe,
    fetchBars: async ({ symbol }) => { visited.push(symbol); throw Object.assign(Error("empty fixture"), { code: "SOURCE_EMPTY" }); },
  });
  for (let batch = 0; batch < 3; batch++) {
    const result = await runCli(argv, fixture);
    assert.equal(result.batch.checked.length, 0, "temporary empty data is not a completed check");
    assert.equal(result.batch.cursorSymbol, universe[batch * 20 + 19].symbol);
  }
  assert.deepEqual(visited, universe.map(item => item.symbol), "each 20-item failure batch yields to the next 20");
  await runCli(argv, fixture);
  assert.deepEqual(visited.slice(60), universe.slice(0, 20).map(item => item.symbol), "cursor wraps so failures are eventually retried");
});

test("legacy writers remain isolated while an explicitly selected library completes a bounded batch", async t => {
  const { mkdir, readFile, writeFile, readdir, symlink } = await import("node:fs/promises");
  const { resolveLibraryRoot } = await import("../../../apps/quant-lab/app/tools/native-data-context.mjs");
  const { runHistoryBatch } = await import("../../../apps/quant-lab/app/tools/history-batch.mjs");
  const root = await mkdtemp(join(tmpdir(), "quant-history-library-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const legacy = join(root, "a-share-history/v1");
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, "initializing.json"), "live-old-protocol-fixture");
  const libraryId = "a".repeat(32);
  assert.deepEqual(await readdir(root), ["a-share-history"]);
  await assert.rejects(runCli(["--stdout", "--status", "--library-id", libraryId], { root }), { code: "HISTORY_LIBRARY_MISSING" });
  const status = await runCli(["--stdout", "--lock-status", "--library-id", libraryId], { root, stdout() {} });
  assert.equal(status.running, false);
  assert.deepEqual(await readdir(root), ["a-share-history"], "both queries remain pure before initialization");
  const result = await runHistoryBatch({ source: "tushare-pro", scope: "core", libraryId }, dependencies(root, "2026-09-11"));
  assert.equal(result.ready, 20);
  assert.equal((await readHistoryManifest(await resolveLibraryRoot(root, libraryId))).ready, 20);
  assert.equal(await readFile(join(legacy, "initializing.json"), "utf8"), "live-old-protocol-fixture");
  await assert.rejects(runHistoryBatch({ libraryId: "../legacy" }, { root }), { code: "HISTORY_LIBRARY_ID_INVALID" });
  const malicious = "b".repeat(32);
  await symlink(legacy, join(root, "quant-history-libraries/v2", malicious));
  await assert.rejects(resolveLibraryRoot(root, malicious, { create: true }), /HISTORY_LIBRARY_PATH_UNSAFE/);
});
