import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { acquireOwnerLock, inspectOwnerLock } from "../../../apps/quant-lab/app/tools/owner-lock.mjs";
import { writeLocalSnapshot, readLocalSnapshot } from "../../../apps/quant-lab/app/tools/local-snapshot-store.mjs";
import { isQuoteV2, normalizeQuoteV2 } from "../../../apps/quant-lab/app/quote-contract.mjs";
import { runQuoteRound } from "../../../apps/quant-lab/app/quote-round-core.mjs";
import { createMarketService, runService } from "../../../apps/quant-lab/app/tools/market-service.mjs";
const barrier = () => { let release; const promise = new Promise((r) => { release = r; }); return { promise, release }; };
async function temporary(t) { const root = await mkdtemp(join(tmpdir(), "quant-protocol-")); t.after(() => rm(root, { recursive: true, force: true })); return root; }

test("heartbeat release waits for in-flight writes; live owner cannot be stolen", async (t) => {
  const root = await temporary(t), path = join(root, "lock"), entered = barrier(), resume = barrier();
  const a = await acquireOwnerLock(path, { hooks: { beforeHeartbeat: async () => { entered.release(); await resume.promise; } } });
  const heartbeat = a.heartbeat(); await entered.promise;
  const release = a.release();
  assert.equal((await acquireOwnerLock(path)).acquired, false);
  resume.release(); await heartbeat; await release;
  const b = await acquireOwnerLock(path); assert.equal(b.acquired, true);
  assert.equal((await readdir(path)).length, 1);
  assert.deepEqual((await readdir(root)).filter((name) => name.includes("heartbeat")), []);
  await b.release();
});

test("real child death permits exact-token reclaim, live child remains busy", async (t) => {
  const root = await temporary(t), path = join(root, "lock");
  const module = new URL("../../../apps/quant-lab/app/tools/owner-lock.mjs", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `import { acquireOwnerLock } from ${JSON.stringify(module)}; const lock = await acquireOwnerLock(${JSON.stringify(path)}); process.send(lock.owner); process.on('message', () => {});`], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  t.after(() => { if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL"); });
  await once(child, "message");
  const inode = (await stat(path)).ino;
  assert.equal((await acquireOwnerLock(path)).acquired, false);
  assert.equal((await stat(path)).ino, inode);
  const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
  const b = await acquireOwnerLock(path); assert.equal(b.acquired, true); await b.release();
});

test("stale reclaimer cannot remove replacement owner or its directory", async (t) => {
  const path = join(await temporary(t), "lock");
  const a = await acquireOwnerLock(path), entered = barrier(), resume = barrier();
  // Inject death only for the captured immutable token; process liveness is
  // exercised independently by the child-process test above.
  const stale = acquireOwnerLock(path, { isDead: (o) => o.token === a.owner.token, hooks: { beforeUnlink: async () => { entered.release(); await resume.promise; } } });
  await entered.promise; await a.release(); const b = await acquireOwnerLock(path);
  const inode = (await stat(path)).ino; resume.release();
  assert.equal((await stale).acquired, false);
  assert.equal((await inspectOwnerLock(path)).token, b.owner.token);
  assert.equal((await stat(path)).ino, inode); await b.release();
});

test("late old snapshot cannot roll back latest or same-day archive", async (t) => {
  const root = await temporary(t);
  const snapshot = (asOf, phase = "intraday") => ({ marketDate: "2026-10-28", asOf, session: { phase }, value: asOf });
  const newest = snapshot("2026-10-28T07:00:00Z", "close");
  const first = await writeLocalSnapshot({ root, stream: "market", snapshot: newest });
  const bytes = await readFile(first.latestPath, "utf8");
  assert.equal((await writeLocalSnapshot({ root, stream: "market", snapshot: snapshot("2026-10-28T06:00:00Z") })).published, false);
  assert.equal(await readFile(first.latestPath, "utf8"), bytes);
  assert.deepEqual(await readLocalSnapshot({ root, stream: "market" }), newest);
});

test("quote daily movement uses dated supplier reference, null on missing/cross-day/conflicting basis", () => {
  const now = new Date("2026-10-28T06:00:00Z");
  const input = { symbol: "SH600000", price: 11, previousClose: 10, changePercent: 10, asOf: now.toISOString(), marketDate: "2026-10-28" };
  const options = { symbol: input.symbol, market: "cn", now };
  assert.equal(normalizeQuoteV2(input, options).dayChange, "1");
  const quote = normalizeQuoteV2(input, options);
  assert.equal(isQuoteV2(quote), true);
  for (const overrides of [{ dayChange: "NaN" }, { dayChange: "2" }, { dayChangePct: "bad" }, { dayChangePct: null }, { previousClose: "Infinity" }, { referenceDate: "2020-01-01" }, { referenceBasis: "unknown" }, { currency: "USD" }, { marketDate: "2026-02-31" }, { fetchedAt: "invalid" }]) assert.equal(isQuoteV2({ ...quote, ...overrides }), false);
  assert.equal(isQuoteV2(normalizeQuoteV2({ ...input, previousClose: null }, options)), true);
  for (const overrides of [{ previousClose: null }, { changePercent: 20 }, { marketDate: "2026-10-27" }, { priceBasis: "qfq" }, { session: "halted" }, { referenceDate: "2020-01-01" }, { asOf: "2026-10-27T06:00:00Z" }]) assert.equal(normalizeQuoteV2({ ...input, ...overrides }, options).dayChange, null);
});

test("round batches bound a hanging provider and retain fair pending cursor", async () => {
  let now = 0;
  const batches = [];
  const result = await runQuoteRound(Array.from({ length: 10 }, (_, i) => ({ market: "us", symbol: `S${i}` })), {
    now: () => now, cursor: 0, roundBudgetMs: 30,
    fetchQuote: async (item) => { if (item.symbol === "S1") return new Promise(() => {}); return item; },
    deadline: async (work) => { const value = work(new AbortController().signal); if (batches.length === 0) now = 30; return Promise.race([value, Promise.resolve().then(() => { throw new Error("deadline"); })]); },
    onBatch: async (batch) => batches.push(batch),
  });
  assert.equal(result.round.pending, 6); assert.equal(result.round.cursor, 4);
  assert.ok(result.quotes.length > 0); assert.ok(result.errors.some((item) => item.symbol === "S1"));
});

test("service coalesces poke, publishes snapshots and drains without a browser owner", async () => {
  const entered = barrier(), resume = barrier(), done = barrier(); let calls = 0; const sent = [];
  const service = createMarketService({ send: async (message) => { sent.push(message); if (message.t === "drained") done.release(); }, schedule: () => 0, unschedule: () => {}, collect: async (_, { onBatch }) => { calls++; entered.release(); await resume.promise; await onBatch({ quotes: [], round: { roundId: calls, cursor: 0, pending: 0, succeeded: 0, failed: 0 } }); } });
  await service.receive({ t: "hello", protocol: 1, config: { format: "quant.market-feed.config/1", subscriptions: [] } });
  await entered.promise; await service.receive({ t: "poke" }); await service.receive({ t: "poke" }); assert.equal(calls, 1);
  resume.release(); await service.close(); await done.promise;
  assert.equal(sent.filter((item) => item.t === "ready").length, 1); assert.equal(sent.at(-1).t, "drained");
});

test("empty subscription round clears the restored Host snapshot without provider requests", async () => {
  const published = barrier(); let calls = 0;
  const service = createMarketService({ send: async (message) => { if (message.t === "publish") published.release(message); }, schedule: () => 0, unschedule() {},
    collect: (items, options) => runQuoteRound(items, { ...options, fetchQuote: async () => { calls++; throw Error("unexpected provider"); } }) });
  const quote = normalizeQuoteV2({ symbol: "SH600000", price: 11, asOf: "2026-10-28T06:00:00Z" }, { market: "cn", symbol: "SH600000", now: new Date("2026-10-28T06:00:00Z") });
  await service.receive({ t: "hello", protocol: 1, config: { format: "quant.market-feed.config/1", subscriptions: [] }, last: { quotes: { format: "quant.quotes/2", items: { "cn:SH600000": quote } } } });
  const packet = await published.promise;
  assert.deepEqual(packet.value.items, {}); assert.equal(packet.value.round.pending, 0); assert.equal(calls, 0);
  await service.close();
});

test("a later service round cannot replace a newer provider timestamp with an older price", async () => {
  const now = new Date("2026-10-28T06:00:00Z");
  const quote = normalizeQuoteV2({ symbol: "SH600000", price: 11, asOf: now.toISOString() }, { market: "cn", symbol: "SH600000", now });
  const older = normalizeQuoteV2({ symbol: "SH600000", price: 10, asOf: "2026-10-28T05:00:00Z" }, { market: "cn", symbol: "SH600000", now });
  const published = barrier();
  const service = createMarketService({ send: async (message) => { if (message.t === "publish") published.release(message); }, schedule: () => 0, unschedule() {},
    collect: async (_, { onBatch }) => onBatch({ quotes: [older], round: { roundId: 2, cursor: 0, pending: 0, succeeded: 1, failed: 0 } }) });
  await service.receive({ t: "hello", protocol: 1, config: { format: "quant.market-feed.config/1", subscriptions: [{ market: "cn", symbol: "SH600000" }] }, last: { quotes: { format: "quant.quotes/2", items: { "cn:SH600000": quote } } } });
  assert.deepEqual((await published.promise).value.items["cn:SH600000"], quote);
  await service.close();
});

test("native stream drain exits after acknowledgement without waiting for Host stdin EOF", async () => {
  const input = new PassThrough(), output = new PassThrough(), published = barrier();
  let text = "";
  output.on("data", (chunk) => { text += chunk; if (text.includes('"t":"publish"')) published.release(); });
  const running = runService(input, output);
  input.write(`${JSON.stringify({ t: "hello", protocol: 1, config: { format: "quant.market-feed.config/1", subscriptions: [] } })}\n`);
  await published.promise;
  input.write('{"t":"drain"}\n');
  await running;
  assert.equal(input.destroyed, true);
  assert.equal(text.trim().split("\n").map((line) => JSON.parse(line)).at(-1).t, "drained");
  output.destroy();
});

test("history status is byte-for-byte read-only and legacy protocol roots refuse new writers", async (t) => {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { writeHistoryManifest, historyManifestPath, acquireHistoryRunState, releaseHistoryRunState } = await import("../../../apps/quant-lab/app/tools/a-share-history-cache.mjs");
  const { runCli } = await import("../../../apps/quant-lab/app/tools/initialize-a-share-history.mjs");
  const root = await temporary(t);
  const manifest = { schemaVersion: 1, kind: "a-share-history-library", scope: "core", limit: 120, source: "tencent-ifzq", adjust: "qfq", updatedAt: "2026-10-28T00:00:00Z", marketDate: "2026-10-28", total: 120, ready: 0, failed: 0, bars: 0, storageBytes: 0, records: [] };
  await writeHistoryManifest(manifest, root);
  const lock = await acquireHistoryRunState({ scope: "core", source: "tencent-ifzq", now: new Date() }, root);
  const path = historyManifestPath(root), before = await readFile(path, "utf8");
  const ownerPath = join(root, "a-share-history/v2/initializing.json");
  const inode = (await stat(ownerPath)).ino, files = await readdir(ownerPath);
  await runCli(["--status", "--stdout"], { root, stdout() {} });
  assert.equal(await readFile(path, "utf8"), before); assert.equal((await stat(ownerPath)).ino, inode); assert.deepEqual(await readdir(ownerPath), files);
  await releaseHistoryRunState(lock.state);
  await mkdir(join(root, "a-share-history/v1"));
  const denied = await acquireHistoryRunState({ scope: "core", source: "tencent-ifzq", now: new Date() }, root);
  assert.equal(denied.acquired, false); assert.equal(denied.code, "HISTORY_LEGACY_PROTOCOL");
  // A legacy program paused before creating its wx file may now resume. No v2
  // writer was admitted and we never unlink/rename its live shared directory.
  await writeFile(join(root, "a-share-history/v1/initializing.json"), "legacy-paused-writer");
  assert.equal((await acquireHistoryRunState({ scope: "core", source: "tencent-ifzq", now: new Date() }, root)).acquired, false);
});

test("short native collectors coalesce concurrent webviews before provider execution", async (t) => {
  const { runCollector } = await import("../../../apps/quant-lab/app/tools/collector-lock.mjs");
  const root = await temporary(t), entered = barrier(), resume = barrier(); let calls = 0;
  const first = runCollector("market", [], async () => { calls++; entered.release(); await resume.promise; }, { root });
  await entered.promise;
  await assert.rejects(runCollector("market", [], async () => { calls++; }, { root }), { code: "QUANT_COLLECTOR_BUSY" });
  assert.equal(calls, 1);
  await runCollector("market", ["--read-local"], async () => {}, { root });
  resume.release(); await first;
  await runCollector("market", [], async () => { calls++; }, { root }); assert.equal(calls, 2);
});
