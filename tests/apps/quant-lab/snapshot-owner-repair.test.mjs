import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { acquireOwnerLock, diagnoseOwnerLock, inspectOwnerLock } from "../../../apps/quant-lab/app/tools/owner-lock.mjs";
import { createOwnerIdentityReader, parseOwnerLinuxStat } from "../../../apps/quant-lab/app/tools/owner-identity.mjs";
import { readLocalSnapshot, writeLocalSnapshot } from "../../../apps/quant-lab/app/tools/local-snapshot-store.mjs";
import { runCollector } from "../../../apps/quant-lab/app/tools/collector-lock.mjs";
import { fetchAllQuotes, readLocalQuoteUniverse } from "../../../apps/quant-lab/app/tools/screen-a-shares.mjs";
import { nativeDataRoot, resolveLibraryRoot, withNativeDataRoot } from "../../../apps/quant-lab/app/tools/native-data-context.mjs";
import { acquireHistoryRunState, recoverHistoryManifestFromSeries, releaseHistoryRunState,
  historyManifestPath, readHistoryManifest, writeHistoryManifest } from "../../../apps/quant-lab/app/tools/a-share-history-cache.mjs";
import { reconcileAShareHistorySnapshots } from "../../../apps/quant-lab/app/tools/reconcile-a-share-history-snapshots.mjs";
import { runHistoryBatch } from "../../../apps/quant-lab/app/tools/history-batch.mjs";

const barrier = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const system = { machine: "a".repeat(64), boot: "linux:11111111-1111-4111-8111-111111111111" };
const reader = (overrides = {}) => createOwnerIdentityReader({ system: async () => system,
  inspect: async () => ({ start: "linux-ticks:41", state: "S" }), probe: () => "present", host: () => hostname(), ...overrides });
async function temporary(t) { const root = await mkdtemp(join(tmpdir(), "quant-owner-repair-")); t.after(() => rm(root, { recursive: true, force: true })); return root; }
async function json(path, value) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value)); }
const snapshot = (generatedAt, value, extra = {}) => ({ marketDate: "2026-10-28", asOf: "2026-10-28T07:00:00Z",
  generatedAt, session: { phase: "close" }, value, ...extra });

test("same quote timestamp accepts completed scans by generatedAt without regressing latest or archive", async t => {
  const root = await temporary(t);
  const partial = snapshot("2026-10-28T08:00:00Z", ["first"]), complete = snapshot("2026-10-28T08:01:00Z", ["first", "complete"]);
  await writeLocalSnapshot({ root, stream: "a-share-selection", snapshot: partial });
  const result = await writeLocalSnapshot({ root, stream: "a-share-selection", snapshot: complete });
  assert.equal(result.published, true); assert.equal(result.archivePublished, true);
  assert.deepEqual(JSON.parse(await readFile(result.latestPath)), complete);
  assert.deepEqual(JSON.parse(await readFile(result.historyPath)), complete);
  for (const late of [partial, complete,
    snapshot("2026-10-29T23:00:00Z", ["older-source"], { asOf: "2026-10-28T06:59:59Z" }),
    snapshot("2026-10-29T23:00:00Z", ["older-date"], { marketDate: "2026-10-27" }),
    snapshot("2026-10-29T23:00:00Z", ["intraday"], { session: { phase: "intraday" } }),
  ]) assert.equal((await writeLocalSnapshot({ root, stream: "a-share-selection", snapshot: late })).published, false);
  assert.deepEqual(await readLocalSnapshot({ root, stream: "a-share-selection" }), complete);
  assert.deepEqual(JSON.parse(await readFile(result.historyPath)), complete);
});

test("two real publishers retain complete collector stdout during publication contention", async t => {
  const root = await temporary(t), entered = barrier(), proceed = barrier();
  const first = snapshot("2026-10-28T08:00:00Z", ["first"]), second = snapshot("2026-10-28T08:01:00Z", ["complete", "result"]);
  const stdout = [], receipts = [];
  const collect = (value, scope, hooks = {}) => runCollector("market", ["--collector-scope", scope], async () => {
    receipts.push(await writeLocalSnapshot({ root, stream: "market", snapshot: value, hooks }));
    stdout.push(`${JSON.stringify(value)}\n`); return value;
  }, { root });
  const active = collect(first, "a".repeat(64), { beforePublish: async () => { entered.release(); await proceed.promise; } });
  await entered.promise;
  try {
    assert.deepEqual(await collect(second, "b".repeat(64)), second);
    assert.deepEqual(stdout.map(JSON.parse), [second]);
    assert.deepEqual(receipts[0], { latestPath: null, historyPath: null, bytes: 0, published: false,
      archivePublished: false, reason: "publisher-busy" });
  } finally { proceed.release(); await active; }
  assert.deepEqual(await readLocalSnapshot({ root, stream: "market" }), first);
  assert.equal((await writeLocalSnapshot({ root, stream: "market", snapshot: second })).published, true);
  assert.deepEqual(await readLocalSnapshot({ root, stream: "market" }), second);
  assert.equal(stdout.length, 2);
});

test("stale local owner is classified by kernel start/boot rather than hostname or reused PID", async () => {
  const owner = { pid: process.pid, hostname: "previous-network-hostname", identity: { ...system, start: "linux-ticks:41" } };
  assert.deepEqual(await reader().status(owner), { status: "alive", reason: "same-process" });
  assert.deepEqual(await reader({ inspect: async () => ({ start: "linux-ticks:42", state: "R" }) }).status(owner), { status: "dead", reason: "pid-reused" });
  const oldBoot = { ...owner, identity: { ...owner.identity, boot: "linux:22222222-2222-4222-8222-222222222222" } };
  assert.equal((await reader({ probe: () => "unknown" }).status(oldBoot)).status, "dead");
  assert.equal((await reader({ probe: () => "unknown" }).status(owner)).status, "unknown");
  assert.equal((await reader({ inspect: async () => null }).status(owner)).status, "unknown");
  assert.equal((await reader().status({ ...oldBoot, identity: { ...oldBoot.identity, machine: "b".repeat(64) } })).status, "unknown");
  assert.equal((await reader().status({ ...oldBoot, identity: { ...oldBoot.identity, machine: null } })).status, "unknown");
  assert.equal((await reader({ inspect: async () => ({ state: "Z", start: "linux-ticks:41" }) }).status(owner)).status, "dead");
  const fields = ["Z", "1", "123", ...Array(16).fill("0"), "101"];
  assert.deepEqual(parseOwnerLinuxStat(`123 (worker ) name) ${fields.join(" ")}`), { state: "Z", start: "linux-ticks:101" });
});

test("real immutable tokens survive unknown identity and reclaim only confirmed stale incarnations", async t => {
  const root = await temporary(t), path = join(root, "lock");
  const first = await acquireOwnerLock(path, { identity: reader() });
  const persisted = JSON.parse(await readFile(join(path, first.owner.file), "utf8"));
  await writeFile(join(path, first.owner.file), JSON.stringify({ ...persisted, hostname: "renamed-host" }));
  const inode = (await stat(path)).ino;
  assert.equal((await acquireOwnerLock(path, { identity: reader() })).acquired, false);
  assert.equal((await stat(path)).ino, inode);
  assert.equal((await acquireOwnerLock(path, { identity: reader({ probe: () => "unknown" }) })).acquired, false);
  const next = await acquireOwnerLock(path, { identity: reader({ inspect: async () => ({ start: "linux-ticks:42", state: "R" }) }) });
  assert.equal(next.acquired, true); assert.notEqual(next.owner.token, first.owner.token);
  assert.equal(await first.release(), false, "a stale release cannot unlink the replacement token");
  assert.equal((await inspectOwnerLock(path)).token, next.owner.token);
  await next.release();
  assert.deepEqual(await readdir(root), [], "ordinary completion releases all token files");
});

test("legacy owner files remain readable and hostname/PID uncertainty never authorizes removal", async t => {
  const root = await temporary(t), path = join(root, "lock");
  const first = await acquireOwnerLock(path, { identity: reader() });
  const { identity: _identity, ...legacy } = first.owner;
  await writeFile(join(path, legacy.file), JSON.stringify(legacy));
  assert.equal((await inspectOwnerLock(path)).identity, undefined);
  assert.equal((await acquireOwnerLock(path, { identity: reader() })).acquired, false);
  const foreign = reader({ host: () => "different-host", probe: () => "absent" });
  assert.equal((await acquireOwnerLock(path, { identity: foreign })).acquired, false);
  const next = await acquireOwnerLock(path, { identity: reader({ probe: () => "absent" }) });
  assert.equal(next.acquired, true); await next.release();
});

test("owner filename/token mismatch and empty owner files are diagnosed without mutation", async t => {
  const root = await temporary(t), path = join(root, "lock");
  const first = await acquireOwnerLock(path, { identity: reader() });
  const file = join(path, first.owner.file);
  await writeFile(file, JSON.stringify({ ...first.owner, token: "33333333-3333-4333-8333-333333333333" }));
  assert.equal((await inspectOwnerLock(path)).unknown, true);
  assert.equal((await acquireOwnerLock(path, { identity: reader(), isDead: () => true })).acquired, false);
  await writeFile(file, "");
  const before = await stat(file);
  assert.equal((await diagnoseOwnerLock(path, { identity: reader() })).status, "unknown");
  assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
  assert.equal(await readFile(file, "utf8"), "");
  await writeFile(file, "null");
  assert.equal((await inspectOwnerLock(path)).unknown, true);
  await first.release();
});

test("failed owner staging cleans only its exact files and async identity waits do not block release", async t => {
  const root = await temporary(t), path = join(root, "lock");
  await assert.rejects(acquireOwnerLock(path, { identity: reader(), hooks: { afterOwnerWrite: () => { throw Error("injected stage failure"); } } }), /injected stage failure/);
  assert.deepEqual(await readdir(root), []);
  const first = await acquireOwnerLock(path, { identity: reader() }), entered = barrier(), proceed = barrier();
  const waiting = acquireOwnerLock(path, { identity: { capture: () => reader().capture(),
    status: async () => { entered.release(); await proceed.promise; return { status: "unknown" }; } } });
  await entered.promise;
  await first.release();
  assert.equal(await inspectOwnerLock(path), null, "async owner inspection cannot hold up the old owner's release");
  proceed.release(); assert.equal((await waiting).acquired, false);
  assert.deepEqual(await readdir(root), []);
});

test("atomic claim of a releasing empty directory preserves the replacement owner from late rmdir", async t => {
  const root = await temporary(t), path = join(root, "lock"), entered = barrier(), proceed = barrier();
  const first = await acquireOwnerLock(path, { identity: reader(), hooks: {
    beforeRmdir: async () => { entered.release(); await proceed.promise; },
  } });
  const releasing = first.release(); await entered.promise;
  assert.deepEqual(await readdir(path), [], "the old token was removed before this release barrier");
  const next = await acquireOwnerLock(path, { identity: reader() });
  assert.equal(next.acquired, true);
  const inode = (await stat(path)).ino;
  proceed.release(); assert.equal(await releasing, true);
  assert.equal((await inspectOwnerLock(path)).token, next.owner.token);
  assert.equal((await stat(path)).ino, inode);
  await next.assertOwned(); await next.release();
  assert.deepEqual(await readdir(root), []);
});

test("collector diagnostics are pure for absent and active requests and never call providers", async t => {
  const root = await temporary(t), output = [];
  const options = { root, stdout: value => output.push(JSON.parse(value)) };
  const read = () => runCollector("market", ["--collector-lock-status"], () => assert.fail("diagnostic provider"), options);
  assert.equal((await read()).request.status, "unlocked");
  assert.deepEqual(await readdir(root), []);
  const entered = barrier(), proceed = barrier();
  const active = runCollector("market", [], async () => { entered.release(); await proceed.promise; }, options);
  await entered.promise;
  try {
    const names = await readdir(join(root, ".quant-collector-locks-v3/requests"));
    const path = join(root, ".quant-collector-locks-v3/requests", names[0]);
    const before = await inspectOwnerLock(path), inode = (await stat(path)).ino;
    const diagnostic = await read();
    assert.deepEqual(diagnostic.request.owner, before);
    assert.ok(["alive", "unknown"].includes(diagnostic.request.status));
    assert.equal((await stat(path)).ino, inode);
    assert.deepEqual(await inspectOwnerLock(path), before);
  } finally { proceed.release(); await active; }
  assert.equal(output.length, 2);
});

test("local quote universe prioritizes selected v2 snapshots/history and only reads legacy fallback", async t => {
  const root = await temporary(t), libraryId = "a".repeat(32);
  const selected = await resolveLibraryRoot(root, libraryId, { create: true });
  const symbols = start => Array.from({ length: 4000 }, (_, index) => `SH${start + index}`);
  const writePool = (base, version, values) => json(join(base, `a-share-history/${version}/manifest.json`), { records: values.map(symbol => ({ symbol })) });
  await writePool(root, "v1", symbols(600000)); await writePool(selected, "v1", symbols(601000));
  await writePool(selected, "v2", symbols(602000));
  const legacy = join(selected, "a-share-history/v1/manifest.json"), legacyBefore = await readFile(legacy, "utf8");
  assert.deepEqual(await readLocalQuoteUniverse(root, { libraryId }), symbols(602000));
  await json(join(selected, "snapshots-v2/a-share-realtime/global/latest.json"), { quotes: symbols(603000).map(symbol => ({ symbol })) });
  assert.deepEqual(await withNativeDataRoot(selected, () => readLocalQuoteUniverse()), symbols(603000));
  await rm(join(selected, "snapshots-v2"), { recursive: true }); await rm(join(selected, "a-share-history/v2"), { recursive: true });
  assert.deepEqual(await readLocalQuoteUniverse(root, { libraryId }), symbols(601000));
  assert.equal(await readFile(legacy, "utf8"), legacyBefore);
  await assert.rejects(readLocalQuoteUniverse(root, { libraryId: "b".repeat(32) }), { code: "QUOTE_UNIVERSE_MISSING" });
  const calls = [];
  await fetchAllQuotes({ root, libraryId: "b".repeat(32), preferLocalUniverse: true,
    fetchSinaQuotes: async () => { calls.push("sina"); return []; },
    fetchTencentQuotes: async () => { calls.push("tencent"); return []; } });
  assert.deepEqual(calls, ["sina"], "an empty selected library cannot reuse the parent pool even for source priority");
});

test("history repair/recovery cannot publish a manifest after its exact owner is released", async t => {
  const root = await temporary(t);
  const manifest = { schemaVersion: 1, kind: "a-share-history-library", scope: "full", limit: 0,
    source: "tencent-ifzq", adjust: "qfq", updatedAt: "2026-10-28T08:00:00Z", marketDate: "2026-10-28",
    total: 0, ready: 0, failed: 0, bars: 0, storageBytes: 0, records: [], cached: 1 };
  await writeHistoryManifest(manifest, root);
  const lock = await acquireHistoryRunState({ scope: "full", source: manifest.source, now: new Date() }, root);
  await releaseHistoryRunState(lock.state);
  const before = await readFile(historyManifestPath(root), "utf8");
  await assert.rejects(recoverHistoryManifestFromSeries(manifest, root, new Date(), { runState: lock.state }), /HISTORY_OWNER_LOST/);
  assert.equal(await readFile(historyManifestPath(root), "utf8"), before);
  await writeLocalSnapshot({ root, stream: "a-share-realtime", snapshot: { ...snapshot("2026-10-28T08:00:00Z"),
    kind: "a-share-realtime-daily-snapshot", session: { phase: "close", provisional: false }, quoteCount: 1,
    quotes: [{ symbol: "SH600000", open: 10, high: 11, low: 9, price: 10, volume: 1000, previousClose: 10 }] } });
  await assert.rejects(reconcileAShareHistorySnapshots({ root, manifest, runState: lock.state }), /HISTORY_OWNER_LOST/);
  assert.equal(await readFile(historyManifestPath(root), "utf8"), before);
});

test("history batch providers see only the authorized selected library context", async t => {
  const root = await temporary(t), libraryId = "c".repeat(32), selected = await resolveLibraryRoot(root, libraryId, { create: true });
  const foreign = await temporary(t);
  const expected = Error("fixture ends before provider collection");
  const observed = [];
  await assert.rejects(withNativeDataRoot(foreign, () => runHistoryBatch({ libraryId }, { root,
    fetchMarketTimestamp: async () => { observed.push(nativeDataRoot()); throw expected; },
    fetchAllQuotes: async () => { observed.push(nativeDataRoot()); throw expected; },
  })), expected);
  assert.ok(observed.length > 0); assert.deepEqual([...new Set(observed)], [selected]);
  assert.equal(await readHistoryManifest(foreign), null);
});
