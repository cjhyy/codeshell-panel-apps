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
import { collectorRequestIdentity as stockRequest } from "../../../apps/quant-lab/app/tools/fetch-a-share-stock.mjs";
import { collectorRequestIdentity as usRequest } from "../../../apps/quant-lab/app/tools/fetch-us-stock.mjs";
import { collectorRequestIdentity as holdingRequest } from "../../../apps/quant-lab/app/tools/fetch-holding-quotes.mjs";
import { collectorRequestIdentity as selectionRequest } from "../../../apps/quant-lab/app/tools/build-a-share-selection.mjs";
import { collectorRequestIdentity as pulseRequest } from "../../../apps/quant-lab/app/tools/build-market-pulse.mjs";
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
  await runCollector("market", ["--read-local"], async () => {}, { root, normalizeRequest: () => ({ mode: "read-local" }) });
  resume.release(); await first;
  await runCollector("market", [], async () => { calls++; }, { root }); assert.equal(calls, 2);
});

test("semantic collectors coalesce aliases but independent symbols/projects share a separate bounded pool", async t => {
  const { runCollector, collectorRequestKey } = await import("../../../apps/quant-lab/app/tools/collector-lock.mjs");
  const { nativeDataRoot } = await import("../../../apps/quant-lab/app/tools/native-data-context.mjs");
  const root = await temporary(t), release = barrier();
  const firstArgs = ["--symbol", "600000", "--stdout", "--collector-scope", "a".repeat(64)];
  assert.equal(collectorRequestKey("fetch-a-share-stock", stockRequest(["--symbol", "600000"])), collectorRequestKey("fetch-a-share-stock", stockRequest(["--query", "sh600000", "--stdout"])));
  const starts = [barrier(), barrier(), barrier(), barrier()];
  const start = (args, index) => runCollector("fetch-a-share-stock", args, async cleaned => {
    assert(!cleaned.includes("--collector-scope")); assert.equal(nativeDataRoot(), root);
    starts[index].release(); await release.promise;
  }, { root, normalizeRequest: stockRequest });
  const active = [start(firstArgs, 0)]; await starts[0].promise;
  await assert.rejects(start(["--query", "SH600000", "--collector-scope", "a".repeat(64)], 1), { code: "QUANT_COLLECTOR_BUSY" });
  active.push(start(["--symbol", "600001"], 1)); await starts[1].promise;
  active.push(start(["--symbol", "600000", "--collector-scope", "b".repeat(64)], 2)); await starts[2].promise;
  active.push(start(["--symbol", "600002"], 3)); await starts[3].promise;
  await assert.rejects(runCollector("fetch-a-share-stock", ["--symbol", "600003"], async () => assert.fail("fifth provider must not run"), { root, normalizeRequest: stockRequest }), { code: "QUANT_COLLECTOR_CAPACITY" });
  release.release(); await Promise.all(active);
  await runCollector("fetch-a-share-stock", ["--symbol", "600003"], async () => {}, { root, normalizeRequest: stockRequest });
  assert.deepEqual((await readdir(join(root, ".quant-collector-locks-v3/slots"))), [], "every slot is released");
});

test("CLI-parsed collector identities coalesce repeated aliases, holdings and ignored source fields under real locks", async t => {
  const { runCollector, collectorRequestKey } = await import("../../../apps/quant-lab/app/tools/collector-lock.mjs");
  const encoded = value => encodeURIComponent(JSON.stringify(value));
  const pairs = [
    ["fetch-a-share-stock", stockRequest, ["--query", "SH600000"], ["--query", "SZ000001", "--symbol", "sh600000", "--stdout"]],
    ["fetch-us-stock", usRequest, ["--query", "AAPL"], ["--symbol", "MSFT", "--query", " ＡＡＰＬ ", "--stdout"]],
    ["holding-quotes", holdingRequest, ['[{"market":"cn","symbol":"SH600000"}]'], ['[{"symbol":"SH600000","market":"cn","shares":10},{"market":"cn","symbol":"SH600000"}]']],
    ["holding-quotes", holdingRequest, [JSON.stringify({ mode: "history", symbols: ["600000"], to: "2026-10-28" })], [JSON.stringify({ mode: "history", symbols: [" sh600000 "], from: "2015-01-01", to: "2026-10-28", ignored: true })]],
    ["build-a-share-selection", selectionRequest, ["--data-sources", encoded({ industry: "sina" })], ["--data-sources", encoded({ industry: "eastmoney" }), "--data-sources", encoded({ industry: "sina", label: "ignored", endpoint: "ignored" }), "--cache-scope", "global"]],
    ["build-a-share-selection", selectionRequest, [], ["--cache-scope", "global", "--watch", encoded({ stocks: [], sectors: [], ignored: 1 }), "--stdout"]],
    ["build-a-share-selection", selectionRequest, ["--watch", encoded({ stocks: [{ symbol: "SH600000", name: "浦发" }], sectors: [] })], ["--watch", encoded({ stocks: [{ symbol: "sh600000", name: " 浦发 ", ignored: true }, { symbol: "SH600000", name: "duplicate ignored" }], sectors: [] })]],
    ["build-market-pulse", pulseRequest, ["--stdout", "--persist-panel-data"], ["--stdout", "--stdout", "--persist-panel-data", "--out", ""]],
    ...["--help", "--read-local"].map(value => ["fetch-a-share-stock", stockRequest, ["--query", value], ["--symbol", "SH600000", "--query", value, "--stdout"]]),
  ];
  const root = await temporary(t);
  for (const [key, normalizeRequest, firstArgs, duplicateArgs] of pairs) {
    assert.equal(collectorRequestKey(key, normalizeRequest(firstArgs)), collectorRequestKey(key, normalizeRequest(duplicateArgs)), key);
    const entered = barrier(), release = barrier(); let calls = 0;
    const active = runCollector(key, firstArgs, async () => { calls++; entered.release(); await release.promise; }, { root, normalizeRequest });
    await entered.promise;
    try {
      await assert.rejects(runCollector(key, duplicateArgs, async () => { calls++; }, { root, normalizeRequest }), { code: "QUANT_COLLECTOR_BUSY" });
      assert.equal(calls, 1, "an equivalent request never enters provider work");
    } finally { release.release(); await active; }
  }
  assert.notDeepEqual(usRequest(["--query", "BRK/B"]), usRequest(["--query", "BRK-B"]), "live Yahoo requests preserve the actual search query");
  assert.deepEqual(usRequest(["--query", "BRK/B", "--read-local"]), usRequest(["--query", "BRK-B", "--read-local"]), "retained reads use canonicalUsSymbol");
  assert.notDeepEqual(selectionRequest([]), selectionRequest(["--data-sources", encoded({})]), "legacy source discovery and explicit auto configuration take different real branches");
  assert.notDeepEqual(selectionRequest([]), selectionRequest(["--continue-scan"]));
  assert.notDeepEqual(holdingRequest(['[{"market":"us","symbol":"AAPL"}]']), holdingRequest(['[{"market":"us","symbol":"MSFT"}]']));
});

test("parsed help stays pure while independent selection options and library domains retain capacity", async t => {
  const { runCollector } = await import("../../../apps/quant-lab/app/tools/collector-lock.mjs");
  const root = await temporary(t), release = barrier(), active = [];
  await runCollector("fetch-a-share-stock", ["--help"], async () => {}, { root, normalizeRequest: stockRequest });
  assert.deepEqual(await readdir(root), [], "help does not create lock or library records");
  const inputs = [[], ["--continue-scan"], ["--collector-scope", "a".repeat(64)], ["--library-id", "b".repeat(32)]];
  try {
    for (const args of inputs) {
      const entered = barrier();
      active.push(runCollector("build-a-share-selection", args, async () => { entered.release(); await release.promise; }, { root, normalizeRequest: selectionRequest }));
      await entered.promise;
    }
    await assert.rejects(runCollector("build-a-share-selection", ["--cache-scope", "123456789abcdef0"], async () => assert.fail("fifth work must not start"), { root, normalizeRequest: selectionRequest }), { code: "QUANT_COLLECTOR_CAPACITY" });
    await runCollector("build-a-share-selection", ["--help"], async () => {}, { root, normalizeRequest: selectionRequest });
  } finally { release.release(); await Promise.all(active); }
});

test("actual stock CLI processes share last-wins request authority before fetching", { timeout: 10000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "quant-cli-authority-")), owned = [];
  t.after(async () => {
    for (const child of owned) {
      if (child.exitCode == null && child.signalCode == null) {
        const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
      }
    }
    await rm(root, { recursive: true, force: true });
  });
  const entry = new URL("../../../apps/quant-lab/app/tools/fetch-a-share-stock.mjs", import.meta.url).href;
  const launch = (args, hold) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import { runCli } from ${JSON.stringify(entry)};
      let fetched = false;
      globalThis.fetch = async () => {
        fetched = true;
        if (${hold}) { process.send({ type: 'entered' }); await new Promise(resolve => process.once('message', resolve)); }
        throw Error('OFFLINE_PROVIDER_BARRIER');
      };
      try { await runCli(${JSON.stringify(args)}); process.send({ type: 'result', fetched }); }
      catch(error) { process.send({ type: 'result', code: error.code, message: error.message, fetched }); }
      finally { process.disconnect(); }
    `], { cwd: root, env: { PATH: process.env.PATH, HOME: root, TMPDIR: root, NODE_OPTIONS: process.env.NODE_OPTIONS }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    owned.push(child);
    return child;
  };
  const first = launch(["--query", "SH600000", "--stdout"], true);
  assert.equal((await once(first, "message"))[0].type, "entered");
  try {
    const second = launch(["--query", "SZ000001", "--symbol", "600000", "--stdout"], false);
    const exited = once(second, "exit");
    const result = (await once(second, "message"))[0];
    assert.equal(result.code, "QUANT_COLLECTOR_BUSY"); assert.equal(result.fetched, false);
    assert.equal((await exited)[0], 0);
  } finally {
    const result = once(first, "message"), exited = once(first, "exit"); first.send({ release: true });
    assert.equal((await result)[0].message, "OFFLINE_PROVIDER_BARRIER");
    assert.equal((await exited)[0], 0);
  }
  assert.deepEqual(await readdir(join(root, ".quant-collector-locks-v3/slots")), []);
});

test("authorized native roots propagate across async helpers; Python never guesses a HOME runtime", async t => {
  const { nativeDataRoot, withNativeDataRoot, resolveLibraryRoot } = await import("../../../apps/quant-lab/app/tools/native-data-context.mjs");
  const { selectionPythonPath } = await import("../../../apps/quant-lab/app/tools/selection-research-evidence.mjs");
  const root = await temporary(t), id = "a".repeat(32);
  const selected = await resolveLibraryRoot(root, id, { create: true });
  await withNativeDataRoot(selected, async () => {
    await Promise.resolve(); assert.equal(nativeDataRoot(), selected);
    const { historyManifestPath } = await import("../../../apps/quant-lab/app/tools/a-share-history-cache.mjs");
    assert.equal(historyManifestPath(), join(selected, "a-share-history/v2/manifest.json"));
    const saved = await writeLocalSnapshot({ stream: "fixture", snapshot: { marketDate: "2026-10-28", asOf: "2026-10-28T06:00:00Z", session: { phase: "intraday" } } });
    assert(saved.latestPath.startsWith(`${selected}/`));
  });
  assert.equal(nativeDataRoot(), process.cwd());
  assert.equal(await selectionPythonPath({ HOME: "/invented/private-host-root" }), process.platform === "win32" ? "python" : "python3");
  assert.equal(await selectionPythonPath({ QUANT_LAB_PYTHON: "/reviewed/python" }), "/reviewed/python");
});

test("plain decimal contract rejects hexadecimal/exponents and never fabricates a regular session", () => {
  const now = new Date("2026-10-28T06:00:00Z"), options = { market: "cn", symbol: "SH600000", now };
  const input = { symbol: "SH600000", price: 11, previousClose: 10, asOf: now.toISOString() };
  const valid = normalizeQuoteV2(input, options);
  assert.equal(valid.session, "unknown"); assert.equal(valid.dayChange, "1"); assert(isQuoteV2(valid));
  for (const value of ["0x10", "1e1", " 10 ", true]) {
    assert.throws(() => normalizeQuoteV2({ ...input, price: value }, options));
    assert.equal(normalizeQuoteV2({ ...input, previousClose: value }, options).dayChange, null);
    assert.equal(isQuoteV2({ ...valid, price: String(value) }), false);
  }
  assert.equal(normalizeQuoteV2({ ...input, price: 10 }, options).dayChange, "0");
});

test("invalid individual subscriptions are discarded without stopping valid work", async () => {
  const done = barrier(), sent = [];
  const service = createMarketService({ send: async message => { sent.push(message); if (message.t === "publish") done.release(); }, schedule: () => 0, unschedule() {},
    collect: async (items, { onBatch }) => {
      assert.deepEqual(items, [{ market: "cn", symbol: "SH600000" }]);
      await onBatch({ quotes: [], round: { cursor: 0, pending: 0 } });
    } });
  await service.receive({ t: "hello", protocol: 1, config: { format: "quant.market-feed.config/1", subscriptions: [null, { market: "cn", symbol: "bad" }, { market: "cn", symbol: "SH600000" }] } });
  await done.promise; assert(sent.some(item => item.t === "progress" && item.message.includes("2")));
  await service.close(); assert.equal(sent.at(-1).t, "drained");
});

test("budget interruption and cancellation preserve pending instead of counting supplier failures", async () => {
  const items = Array.from({ length: 8 }, (_, index) => ({ market: "us", symbol: `S${index}` }));
  let clock = 0;
  const result = await runQuoteRound(items, { now: () => clock, roundBudgetMs: 100, fetchQuote: async item => item,
    deadline: async (work, ms) => { assert.equal(ms, 100); clock = 100; throw Error("QUOTE_DEADLINE"); } });
  assert.equal(result.round.pending, 8); assert.equal(result.round.failed, 0); assert.equal(result.round.cursor, 4);
  const visited = [];
  await runQuoteRound(items, { cursor: result.round.cursor, fetchQuote: async item => { visited.push(item.symbol); return item; } });
  assert.deepEqual(visited.slice(0, 4), ["S4", "S5", "S6", "S7"]);
  const controller = new AbortController();
  const aborted = await runQuoteRound(items, { signal: controller.signal, fetchQuote: async item => item,
    deadline: async () => { controller.abort(); throw Error("QUOTE_ABORTED"); } });
  assert.equal(aborted.round.pending, 8); assert.equal(aborted.round.failed, 0);
});
