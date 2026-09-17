import assert from "node:assert/strict";
import test from "node:test";
import { createHistoryDataController, historyAutofillNeeded, historyCoveragePresentation, parseHistoryLibrarySummary } from "../../../apps/quant-lab/app/modules/history-data-ui.mjs";

function contractedUniverse() {
  return {
    scope: "full", source: "tencent-ifzq", adjust: "qfq", limit: 5_056, years: 3,
    marketDate: "2026-09-11", updatedAt: "2026-09-12T14:36:00Z", total: 5_056, ready: 5_056,
    cached: 5_108, failed: 0, loaded: 0, skipped: 5_056, rebuilt: 0, bars: 3_600_000, storageBytes: 200_000_000,
    remaining: 0, attempted: 5_056, paused: false, sessionPhase: "close", provisional: false,
    from: "2023-09-11", to: "2026-09-07", confirmedThrough: "2026-09-07", networkCheckedThrough: "2026-09-04",
    snapshotBackfillThrough: "2026-09-11", snapshotBackfillDeferred: 5_108, snapshotGapSeries: 5_083,
    snapshotGapDates: ["2026-09-08", "2026-09-09"], latestDateDistribution: [{ date: "2026-09-07", count: 5_081 }],
    auditTrail: [{ at: "2026-09-10T10:00:00Z", kind: "snapshot-check", status: "partial", from: "2026-09-04", through: "2026-09-11", updatedSeries: 5_086, addedBars: 0, skippedSeries: 5_086, failedSeries: 0 }],
  };
}

test("a shrinking listed universe does not invalidate a larger historical audit event", () => {
  const parsed = parseHistoryLibrarySummary(contractedUniverse());
  assert.equal(parsed.total, 5_056);
  assert.equal(parsed.cached, 5_108);
  assert.equal(parsed.auditTrail[0].updatedSeries, 5_086);
  assert.equal(parsed.auditTrail[0].skippedSeries, 5_086);
  const invalid = contractedUniverse();
  invalid.auditTrail[0].updatedSeries = 10_001;
  assert.throws(() => parseHistoryLibrarySummary(invalid), /updatedSeries/u);
});

test("checking local snapshots cannot mark missing actual daily bars current or suppress network fill", () => {
  const parsed = parseHistoryLibrarySummary(contractedUniverse());
  const view = historyCoveragePresentation(parsed);
  assert.equal(view.through, "2026-09-07");
  assert.equal(view.current, false);
  assert.equal(view.state, "stale");
  assert.match(view.note, /快照检查不代表日线已补齐/u);
  assert.equal(historyAutofillNeeded(parsed, "2026-09-11", new Date("2026-09-12T16:00:00Z")), true);
  assert.equal(historyAutofillNeeded({ ...parsed, snapshotBackfillDeferred: 0, snapshotGapSeries: 0, snapshotGapDates: [] }, "2026-09-11", new Date("2026-09-12T16:00:00Z")), true, "a local check marker alone cannot suppress a missing-date network pass");
  const checked = { ...parsed, networkCheckedThrough: "2026-09-11" };
  assert.equal(historyCoveragePresentation(checked).current, false);
  assert.equal(historyAutofillNeeded(checked, "2026-09-11", new Date("2026-09-12T16:00:00Z")), false, "a completed network pass does not endlessly recheck legitimately unavailable bars");
});

test("mixed history dates and failed checks trigger one full network verification", () => {
  const summary = parseHistoryLibrarySummary({
    ...contractedUniverse(),
    to: "2026-09-11", confirmedThrough: "2026-09-11",
    snapshotBackfillDeferred: 0, snapshotGapSeries: 0, snapshotGapDates: [],
    latestDateDistribution: [{ date: "2026-09-11", count: 1 }, { date: "2026-09-07", count: 5_080 }],
  });
  const now = new Date("2026-09-12T16:00:00Z");
  assert.equal(historyCoveragePresentation(summary).state, "stale");
  assert.equal(historyAutofillNeeded(summary, "2026-09-11", now), true,
    "one current series cannot hide thousands of lagging cached histories");
  const checked = parseHistoryLibrarySummary({ ...summary, networkCheckedThrough: "2026-09-11" });
  assert.equal(historyAutofillNeeded(checked, "2026-09-11", now), false,
    "a completed availability check stops repeat passes even when some series stay behind");

  const failed = parseHistoryLibrarySummary({
    ...summary, failed: 1, latestDateDistribution: [{ date: "2026-09-11", count: 5_081 }],
  });
  assert.equal(historyAutofillNeeded(failed, "2026-09-11", now), true,
    "an exhausted scope with a failed request still needs a completed network pass");
  assert.equal(historyAutofillNeeded({ ...failed, networkCheckedThrough: "2026-09-11" }, "2026-09-11", now), false);
});

class Element {
  constructor() { this.children = []; this.dataset = {}; this.style = { setProperty() {} }; this.value = ""; this.textContent = ""; this.listeners = new Map(); this.classList = { toggle() {}, add() {}, remove() {} }; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  get firstElementChild() { return this.children[0]; }
  get options() { return this.children; }
  querySelector() { return this.child ??= new Element(); }
  querySelectorAll() { return []; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name) { this.listeners.delete(name); }
  setAttribute() {}
}

test("unreadable local status is diagnosed explicitly and recovery preserves existing files", async () => {
  const original = { window: globalThis.window, document: globalThis.document };
  const timers = new Map(); let id = 0;
  globalThis.window = { setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(key) { timers.delete(key); } };
  globalThis.document = { createElement: () => new Element(), createTextNode: (text) => ({ textContent: text }) };
  const elements = new Proxy({}, { get(target, key) { return target[key] ??= new Element(); } });
  elements.market.value = "cn"; elements.bootstrapSource.value = "tencent-ifzq";
  const events = new Map();
  let invalid = true;
  let controller;
  try {
    controller = createHistoryDataController({ elements, currentEpoch: () => 0, contextState: () => ({ trusted: true }), notify() {}, now: () => new Date("2026-09-12T16:00:00Z"),
      onHostEvent(name, listener) { events.set(name, listener); return () => events.delete(name); },
      async hostCall(method) {
        if (method === "process.find") return { available: true, handle: "node" };
        if (method === "filesystem.getKnownDirectory") return { handle: "app-data" };
        if (method === "process.spawn") {
          const processId = `p${++id}`;
          setImmediate(() => { events.get("process.output")?.({ processId, stream: "stdout", text: invalid ? "malformed-json" : JSON.stringify(contractedUniverse()) }); events.get("process.exit")?.({ processId, code: 0 }); });
          return { processId };
        }
        return {};
      },
    });
    assert.equal(await controller.refreshHistorySummaryFromLocal(), null);
    assert.equal(elements.bootstrapBadge.textContent, "状态恢复失败");
    assert.equal(elements.bootstrapCoverage.textContent, "已有文件状态暂不可读");
    assert.match(elements.bootstrapStatus.textContent, /不代表历史库未初始化/u);
    assert.equal(elements.bootstrapAction.textContent, "重新读取状态");
    invalid = false;
    assert.equal((await controller.refreshHistorySummaryFromLocal()).cached, 5_108);
    assert.notEqual(elements.bootstrapBadge.textContent, "尚未初始化");
  } finally {
    controller?.dispose?.();
    globalThis.window = original.window;
    globalThis.document = original.document;
  }
});
