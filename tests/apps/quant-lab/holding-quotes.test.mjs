import test from "node:test";
import assert from "node:assert/strict";
import { fetchHoldingQuotes } from "../../../apps/quant-lab/app/tools/fetch-holding-quotes.mjs";
import { createHoldingQuoteController, createHoldingQuoteRequest, holdingQuoteDelay } from "../../../apps/quant-lab/app/modules/holding-quotes.mjs";
import { holdingsUnrealizedSummary } from "../../../apps/quant-lab/app/portfolio.mjs";

const now = () => new Date("2026-09-21T02:00:00Z");
const items = [{ symbol: "SH600036", market: "cn" }];
const quote = (price = "10.10", asOf = now().toISOString()) => ({ ...items[0], price, asOf });
const packet = (quotes) => ({ kind: "holding-quotes", quotes });

test("request only held symbols, deduplicate accounts, isolate individual provider failures", async () => {
  const calls = [];
  const result = await fetchHoldingQuotes([...items, ...items, { market: "us", symbol: "AAPL" }], {
    now,
    cn: async (symbol) => { calls.push(symbol); return { ...quote(), symbol, price: 10.1 }; },
    us: async () => { throw new Error("offline"); },
  });
  assert.deepEqual(calls, ["SH600036"]);
  assert.equal(result.quotes[0].price, "10.1");
  assert.equal(result.errors[0].symbol, "AAPL");
  await assert.rejects(fetchHoldingQuotes([{ symbol: "../bad", market: "cn" }]), /代码无效/u);
});

test("portfolio totals use decimal arithmetic, preserve zero and withhold partial currency totals", () => {
  const position = (pnl, cost) => ({ quantity: "100", unrealizedPnlBase: pnl, costBasisBase: cost });
  assert.deepEqual(holdingsUnrealizedSummary({ positionsByAccount: [position("0.10", "1"), position("0.20", "2")] }),
    { pnlBase: "0.30", costBase: "3.00", returnPercent: 10 });
  assert.equal(holdingsUnrealizedSummary({ positionsByAccount: [position("0.00", "20")] }).pnlBase, "0.00");
  assert.equal(holdingsUnrealizedSummary({ positionsByAccount: [position(null, null), position("10", "20")] }).pnlBase, null);
});

test("poll by exchange hours including US DST, pause when hidden, retry without losing prices", async () => {
  assert.equal(holdingQuoteDelay(items, now()), 15_000);
  assert.equal(holdingQuoteDelay(items, new Date("2026-09-21T04:00:00Z")), 300_000);
  assert.equal(holdingQuoteDelay([{ market: "us" }], new Date("2026-07-20T13:45:00Z")), 15_000);
  assert.equal(holdingQuoteDelay([{ market: "us" }], new Date("2026-12-21T14:45:00Z")), 15_000);
  let result = packet([quote()]);
  const updates = [];
  const timers = new Map();
  const controller = createHoldingQuoteController({
    request: { fetch: async () => { if (result instanceof Error) throw result; return result; }, cancel() {} },
    symbols: () => items, now,
    onUpdate: (quotes, state) => updates.push({ quotes, state }),
    schedule: (fn, delay) => { timers.set(fn, delay); return fn; }, unschedule: (fn) => timers.delete(fn),
  });
  controller.setActive(true);
  await controller.refresh();
  assert.deepEqual([...timers.values()], [15_000]);
  result = packet([quote("11.20")]);
  [...timers.keys()][0]();
  await controller.refresh();
  assert.equal(updates.at(-1).quotes.get("SH600036").price, "11.20", "scheduled refresh updates the price without navigation");
  result = new Error("offline");
  await controller.refresh();
  assert.equal(updates.at(-1).quotes.get("SH600036").price, "11.20");
  assert.equal(updates.at(-1).state.failed, true);
  assert.deepEqual([...timers.values()], [30_000]);
  controller.setActive(false);
  assert.equal(timers.size, 0);
  controller.reset();
});

test("reject foreign, invalid, future and older quotes; stale workspace responses cannot publish", async () => {
  let response = packet([quote()]);
  const updates = [];
  const controller = createHoldingQuoteController({ request: { fetch: async () => response, cancel() {} },
    symbols: () => items, now, onUpdate: (quotes) => updates.push(quotes) });
  await controller.refresh();
  response = packet([quote("9", "2026-09-20T02:00:00Z"), quote("99", "2027-01-01T00:00:00Z"),
    quote("0"), { ...quote("100"), symbol: "SZ000001" }]);
  await controller.refresh();
  assert.equal(updates.at(-1).get("SH600036").price, "10.10");
  let resolve;
  response = new Promise((done) => { resolve = done; });
  const pending = controller.refresh();
  controller.reset();
  resolve(packet([quote("88")]));
  await pending;
  assert.equal(updates.length, 2);
});

test("native process events before spawn returns are collected, and listeners are removed", async () => {
  const listeners = new Map();
  const request = createHoldingQuoteRequest({
    onHostEvent: (name, fn) => { listeners.set(name, fn); return () => listeners.delete(name); },
    hostCall: async (method) => {
      if (method === "process.find") return { available: true, handle: "node" };
      if (method === "filesystem.getKnownDirectory") return { handle: "data" };
      if (method === "process.spawn") {
        listeners.get("process.output")({ processId: "p", stream: "stdout", text: JSON.stringify(packet([quote()])) });
        listeners.get("process.exit")({ processId: "p", code: 0 });
        return { processId: "p" };
      }
      throw new Error(method);
    },
  });
  assert.equal((await request.fetch(items)).quotes[0].price, "10.10");
  assert.equal(listeners.size, 0);
});
