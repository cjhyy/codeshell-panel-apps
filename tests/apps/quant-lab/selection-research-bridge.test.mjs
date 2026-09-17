import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  enrichSelectionSnapshot,
  runSelectionBridge,
  selectionEvidenceRequest,
} from "../../../apps/quant-lab/app/tools/selection-research-evidence.mjs";

const snapshot = {
  marketDate: "2026-09-11", generatedAt: "2026-09-11T08:00:00Z",
  session: { provisional: false },
  sectors: [{
    candidates: [{ symbol: "SH600519" }],
    representatives: [{ symbol: "SH600519" }, { symbol: "SZ000001" }],
    timingQueue: [],
  }],
};
const bars = ["2026-09-10", "2026-09-11", "2026-09-14"].map((date) => ({
  date, open: 10, high: 11, low: 9, close: 10, volume: 100,
}));
const histories = new Map([["SH600519", bars]]);

test("selection request is bounded, unique, uses adjusted bars and excludes incomplete/future days", () => {
  const closed = selectionEvidenceRequest(snapshot, histories);
  assert.deepEqual(closed.symbols, ["SH600519", "SZ000001"]);
  assert.deepEqual(closed.histories[0].bars.map((bar) => bar.date), ["2026-09-10", "2026-09-11"]);
  assert.equal(closed.histories[0].adjustment, "qfq");
  const intraday = selectionEvidenceRequest({ ...snapshot, session: { provisional: true } }, histories);
  assert.deepEqual(intraday.histories[0].bars.map((bar) => bar.date), ["2026-09-10"]);
  assert.equal(histories.get("SH600519").length, 3);
});

test("provider failure or foreign symbols cannot erase or alter the selected stocks", async () => {
  for (const runBridge of [
    async () => { throw new Error("timeout"); },
    async () => ({ version: 1, stocks: [{ symbol: "SH600000" }] }),
  ]) {
    const result = await enrichSelectionSnapshot(snapshot, histories, { runBridge });
    assert.equal(result.researchEvidence.status, "unavailable");
    assert.equal(result.sectors, snapshot.sectors);
    assert.equal(result.marketDate, snapshot.marketDate);
    assert.equal(snapshot.researchEvidence, undefined);
  }
});

test("a slow base scan publishes without starting optional providers", async () => {
  const result = await enrichSelectionSnapshot(snapshot, histories, {
    timeoutMs: 5_000,
    runBridge: async () => { assert.fail("no provider should run with insufficient time"); },
  });
  assert.equal(result.sectors, snapshot.sectors);
  assert.equal(result.researchEvidence.status, "unavailable");
  assert.match(result.researchEvidence.reason, /采集耗时/u);
});

test("intraday closed indicators survive a financial provider outage", async () => {
  const result = await enrichSelectionSnapshot({ ...snapshot, session: { provisional: true } }, histories, {
    runBridge: async () => ({
      version: 1,
      providers: { stockstats: { available: true, supported: true, version: "0.6.8" }, efinance: { available: true } },
      stocks: [{
        symbol: "SH600519",
        technical: {
          available: true, asOf: "2026-09-10", adjustment: "qfq", barCount: 180,
          rsi14: 55, atr14: 1, atrPercent: 2, macd: 0.2, macdSignal: 0.1, adx14: 20,
        },
        fundamentals: { available: false, reason: "PROVIDER_TIMEOUT" },
        quoteCheck: { available: false },
      }],
    }),
  });
  assert.equal(result.researchEvidence.status, "partial");
  assert.equal(result.researchEvidence.stocks[0].technical.available, true);
  assert.equal(result.researchEvidence.stocks[0].fundamentals.available, false);
  assert.equal(result.sectors, snapshot.sectors);
});

function fakeProcess(onInput) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  const chunks = [];
  child.stdin.on("data", (chunk) => chunks.push(chunk));
  child.stdin.on("finish", () => onInput?.(Buffer.concat(chunks).toString(), child));
  return child;
}

test("fixed executable arguments and stdin JSON keep stock data out of shell code", async () => {
  const child = fakeProcess((input, process) => {
    assert.deepEqual(JSON.parse(input), { action: "probe" });
    process.stdout.write('{"version":1,"stocks":[]}');
    process.emit("close", 0);
  });
  const result = await runSelectionBridge({ action: "probe" }, {
    python: "/test/python", source: "print('fixed')",
    spawnProcess: (executable, args, options) => {
      assert.equal(executable, "/test/python");
      assert.deepEqual(args, ["-B", "-c", "print('fixed')"]);
      assert.equal(options.shell, false);
      return child;
    },
  });
  assert.equal(result.version, 1);
});

test("deadline and invalid JSON terminate the optional process", async () => {
  for (const mode of ["timeout", "invalid-json", "overflow"]) {
    const child = fakeProcess((_input, process) => {
      if (mode === "invalid-json") { process.stdout.write("not-json"); process.emit("close", 0); }
      if (mode === "overflow") process.stdout.write(Buffer.alloc(2_000_001));
    });
    await assert.rejects(runSelectionBridge({ action: "probe" }, {
      source: "fixed", python: "python3", spawnProcess: () => child, timeoutMs: 15,
    }));
    assert.equal(child.killed, true);
  }
});
