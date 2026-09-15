import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectSelectionAnnouncements } from "../../../apps/quant-lab/app/tools/selection-announcement-scan.mjs";
import { readLocalSnapshot, writeLocalSnapshot } from "../../../apps/quant-lab/app/tools/local-snapshot-store.mjs";

test("announcement quotas are batches, and resuming checks the remaining stocks", async () => {
  const root = await mkdtemp(join(tmpdir(), "selection-announcements-"));
  try {
    const symbols = Array.from({ length: 47 }, (_, index) => `SH${600000 + index}`);
    const requests = [];
    const options = {
      root, symbols, marketDate: "2026-09-11", provisional: false,
      now: new Date("2026-09-12T08:00:00Z"),
      fetchAnnouncements: async (symbol) => { requests.push(symbol); return []; },
    };
    const first = await collectSelectionAnnouncements(options);
    assert.equal(first.available, 20);
    assert.equal(first.pending, 27);
    const second = await collectSelectionAnnouncements({ ...options, continueScan: true });
    assert.equal(second.available, 40);
    assert.equal(second.pending, 7);
    const third = await collectSelectionAnnouncements({ ...options, continueScan: true });
    assert.equal(third.available, 47);
    assert.equal(third.pending, 0);
    assert.equal(new Set(requests).size, requests.length);
    assert(third.announcements.has(symbols.at(-1)), "successful empty results retain per-stock availability");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("failed sources wait for bounded automatic retries, while manual refresh can recover", async () => {
  const root = await mkdtemp(join(tmpdir(), "selection-announcements-"));
  try {
    let calls = 0;
    const options = {
      root, symbols: ["SH600000"], marketDate: "2026-09-11", provisional: false,
      now: new Date("2026-09-12T08:00:00Z"),
      fetchAnnouncements: async () => { calls += 1; throw new Error("offline"); },
    };
    const first = await collectSelectionAnnouncements(options);
    assert.equal(first.failed, 0);
    assert.equal(first.pending, 1);
    assert.ok(Date.parse(first.nextRetryAt) >= options.now.getTime() + 30_000);
    assert.ok(Date.parse(first.nextRetryAt) < options.now.getTime() + 35_000);
    assert.equal(first.announcements.size, 0);
    const second = await collectSelectionAnnouncements({ ...options, continueScan: true });
    assert.equal(second.failed, 0);
    assert.equal(second.pending, 1);
    assert.equal(calls, 1);
    const third = await collectSelectionAnnouncements({ ...options, continueScan: true, now: new Date(first.nextRetryAt) });
    assert.equal(calls, 2);
    assert.ok(Date.parse(third.nextRetryAt) >= Date.parse(first.nextRetryAt) + 120_000);
    assert.ok(Date.parse(third.nextRetryAt) < Date.parse(first.nextRetryAt) + 125_000);
    const exhausted = await collectSelectionAnnouncements({ ...options, continueScan: true, now: new Date(third.nextRetryAt) });
    assert.equal(calls, 3);
    assert.equal(exhausted.failed, 1);
    assert.equal(exhausted.pending, 0);
    const later = new Date("2026-09-12T10:00:00Z");
    await collectSelectionAnnouncements({ ...options, continueScan: true, now: later });
    assert.equal(calls, 3);
    const retry = await collectSelectionAnnouncements({ ...options, now: later, fetchAnnouncements: async () => [] });
    assert.equal(retry.failed, 0);
    assert.equal(retry.available, 1);
    const closing = await collectSelectionAnnouncements({ ...options, provisional: true, continueScan: true });
    assert.equal(calls, 4, "a changed session phase must not inherit availability");
    assert.equal(closing.announcements.size, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an exhausted deadline keeps unattempted announcements pending", async () => {
  const result = await collectSelectionAnnouncements({
    symbols: ["SH600000"], marketDate: "2026-09-11", provisional: false,
    persistent: false, deadlineMs: 0,
    fetchAnnouncements: async () => assert.fail("must not start after deadline"),
  });
  assert.equal(result.pending, 1);
  assert.equal(result.failed, 0);
});

test("continuation refreshes expired announcements and prioritizes never-checked names", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "selection-announcements-ttl-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const records = new Map();
  const calls = [];
  const symbols = Array.from({ length: 25 }, (_, index) => `SH${600000 + index}`);
  const options = {
    root,
    symbols, marketDate: "2026-09-11", provisional: false,
    now: new Date("2026-09-12T08:00:00Z"),
    readSnapshot: async ({ scope }) => records.get(scope),
    writeSnapshot: async ({ scope, snapshot }) => records.set(scope, snapshot),
    fetchAnnouncements: async (symbol) => { calls.push(symbol); return []; },
  };
  await collectSelectionAnnouncements(options);
  calls.length = 0;
  const next = await collectSelectionAnnouncements({
    ...options, continueScan: true, now: new Date("2026-09-12T08:31:00Z"),
  });
  assert.deepEqual(new Set(calls.slice(0, 5)), new Set(symbols.slice(20)));
  assert.equal(next.available, 20, "expired successes cannot keep availability until refreshed");
  assert.equal(next.pending, 5);
});

test("a delayed older failure cannot replace a newer successful announcement snapshot", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "selection-announcements-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settings = { root, symbols: ["SH600000"], marketDate: "2026-09-11", provisional: false };
  let finishOlder, reportStarted;
  const started = new Promise((done) => { reportStarted = done; });
  const older = collectSelectionAnnouncements({
    ...settings, now: new Date("2026-09-11T08:00:00Z"),
    fetchAnnouncements: async () => {
      reportStarted();
      await new Promise((done) => { finishOlder = done; });
      throw Object.assign(new Error("old provider request failed"), { code: "OLD_REQUEST_FAILED" });
    },
  });
  await started;
  const freshEvents = [{ id: "fresh-fixture-event" }];
  const newer = await collectSelectionAnnouncements({
    ...settings, now: new Date("2026-09-11T08:01:00Z"), fetchAnnouncements: async () => freshEvents,
  });
  assert.equal(newer.available, 1, "the earlier network request must not hold the publication lock");
  finishOlder();
  const olderResult = await older;
  assert.equal(olderResult.available, 1);
  assert.equal(olderResult.failed, 0);
  const retained = await readLocalSnapshot({ root, stream: "a-share-selection-announcements", scope: "SH600000" });
  assert.equal(retained.status, "ready");
  assert.equal(retained.generatedAt, "2026-09-11T08:01:00.000Z");
  assert.deepEqual(retained.events, freshEvents);
  const next = await collectSelectionAnnouncements({
    ...settings, now: new Date("2026-09-11T08:02:00Z"), continueScan: true,
    fetchAnnouncements: async () => assert.fail("the successful newer cache must remain available"),
  });
  assert.equal(next.available, 1);
  assert.equal(next.failed, 0);
  assert.equal(next.pending, 0);
});

test("simultaneous publication serializes per symbol and preserves the newer timestamp", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "selection-announcements-publish-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let fetched = 0, release;
  const barrier = new Promise((done) => { release = done; });
  const settings = {
    root, symbols: ["SH600000"], marketDate: "2026-09-11", provisional: false,
    fetchAnnouncements: async () => {
      fetched += 1;
      if (fetched === 2) release();
      await barrier;
      return [];
    },
  };
  const outcomes = await Promise.all([
    collectSelectionAnnouncements({ ...settings, now: new Date("2026-09-11T08:01:00Z") }),
    collectSelectionAnnouncements({ ...settings, now: new Date("2026-09-11T08:00:00Z") }),
  ]);
  assert.ok(outcomes.every((result) => result.available === 1));
  const retained = await readLocalSnapshot({ root, stream: "a-share-selection-announcements", scope: "SH600000" });
  assert.equal(retained.generatedAt, "2026-09-11T08:01:00.000Z");
});

test("market date and closing phase take precedence over request start timestamps", async (t) => {
  for (const previous of [
    { marketDate: "2026-09-10", provisional: false },
    { marketDate: "2026-09-11", provisional: true },
  ]) {
    const root = await mkdtemp(join(tmpdir(), "selection-announcements-order-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeLocalSnapshot({
      root, stream: "a-share-selection-announcements", scope: "SH600000",
      snapshot: { kind: "a-share-selection-announcements", schemaVersion: 1,
        symbol: "SH600000", marketDate: previous.marketDate, generatedAt: "2026-09-12T08:01:00.000Z",
        session: { phase: previous.provisional ? "intraday" : "close", provisional: previous.provisional },
        status: "ready", events: [],
      },
    });
    await collectSelectionAnnouncements({
      root, symbols: ["SH600000"], marketDate: "2026-09-11", provisional: false,
      now: new Date("2026-09-12T08:00:00.000Z"), fetchAnnouncements: async () => [],
    });
    const retained = await readLocalSnapshot({ root, stream: "a-share-selection-announcements", scope: "SH600000" });
    assert.equal(retained.marketDate, "2026-09-11");
    assert.equal(retained.session.provisional, false);
    assert.equal(retained.generatedAt, "2026-09-12T08:00:00.000Z");
  }
});

test("legacy failures migrate to bounded retries and announcement HTTP throttling waits fifteen minutes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "selection-announcements-legacy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const base = { root, symbols: ["SH600000"], marketDate: "2026-09-11", provisional: false,
    now: new Date("2026-09-12T08:00:00Z") };
  await writeLocalSnapshot({ root, stream: "a-share-selection-announcements", scope: "SH600000", snapshot: {
    kind: "a-share-selection-announcements", schemaVersion: 1, symbol: "SH600000", marketDate: base.marketDate,
    generatedAt: "2026-09-12T07:00:00.000Z", session: { phase: "close", provisional: false },
    status: "failed", events: [], reason: "ANNOUNCEMENT_FAILED",
  } });
  let calls = 0;
  const recovered = await collectSelectionAnnouncements({ ...base, continueScan: true,
    fetchAnnouncements: async () => { calls += 1; return []; },
  });
  assert.equal(calls, 1); assert.equal(recovered.available, 1);
  const throttled = await collectSelectionAnnouncements({ ...base, symbols: ["SH600001"],
    fetchAnnouncements: async () => { throw Object.assign(new Error("HTTP 429 from source"), { code: "ANNOUNCEMENT_HTTP" }); },
  });
  assert.equal(throttled.pending, 1); assert.equal(throttled.failed, 0);
  assert.equal(throttled.sourceErrors[0].errorCode, "ANNOUNCEMENT_HTTP_429");
  assert.ok(Date.parse(throttled.nextRetryAt) >= base.now.getTime() + 900_000);
  const deferred = await collectSelectionAnnouncements({ ...base, symbols: ["SH600001"], continueScan: true,
    fetchAnnouncements: async () => assert.fail("must respect a persisted throttle delay"),
  });
  assert.equal(deferred.nextRetryAt, throttled.nextRetryAt);
  const mixed = await collectSelectionAnnouncements({ ...base, symbols: ["SH600001", "SH600002"], continueScan: true,
    deadlineMs: 0, fetchAnnouncements: async () => assert.fail("deadline exhausted"),
  });
  assert.equal(mixed.pending, 2);
  assert.equal(mixed.nextRetryAt, null, "unattempted work can resume before a different stock's backoff");
});

test("focus stocks enter the first announcement batch without repeating a fresh check", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "selection-announcements-focus-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const symbols = Array.from({ length: 25 }, (_, index) => `SH${600000 + index}`);
  const focus = symbols.at(-1);
  const calls = [];
  const options = { root, symbols, prioritySymbols: [focus], marketDate: "2026-09-11", provisional: false,
    now: new Date("2026-09-12T08:00:00Z"),
    fetchAnnouncements: async (symbol) => { calls.push(symbol); return []; },
  };
  const first = await collectSelectionAnnouncements(options);
  assert.equal(calls[0], focus);
  assert.equal(calls.length, 20);
  assert.equal(first.available, 20); assert.equal(first.pending, 5);
  const second = await collectSelectionAnnouncements({ ...options, continueScan: true });
  assert.equal(second.available, 25);
  assert.equal(calls.filter((symbol) => symbol === focus).length, 1);
});
