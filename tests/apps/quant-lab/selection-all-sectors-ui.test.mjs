import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  createAShareSelectionController,
  parseAShareSelectionSnapshot,
  selectionRuntimeArgs,
  selectionSectorPage,
  selectionFreshnessRefreshAt,
} from "../../../apps/quant-lab/app/modules/a-share-selection-ui.mjs";

const marketDate = "2026-09-11";
const generatedAt = `${marketDate}T16:00:00+08:00`;

function fixture(count = 45) {
  const sectors = Array.from({ length: count }, (_, index) => {
    const state = index < 5 ? "complete" : index === 5 ? "partial" : index === 6 ? "failed" : "pending";
    const available = state === "complete" ? 2 : state === "partial" ? 1 : 0;
    const eligible = state === "complete" || state === "partial" ? 2 : 0;
    return {
      id: `new_sector${index}`, name: index === 30 ? "冷门行业" : `行业${index}`,
      recommended: index < 2, watched: false, stage: state === "complete" ? "repair" : "unavailable",
      stageLabel: "趋势待核验", relativeScore: index < 5 ? 80 - index : 0, rank: index < 5 ? index + 1 : null,
      selectionReason: index < 2 ? "已完成行业中优先研究" : state === "pending" ? "等待本地下一批扫描" : "尚未满足优先研究条件",
      scan: { state, memberCount: eligible, eligibleCount: eligible, historyAvailable: available, historyPending: eligible - available, historyFailed: 0, reason: state === "pending" ? "成员尚未扫描" : state === "failed" ? "成员来源失败" : "" },
      metrics: { sampleSize: available, constituentCount: state === "pending" ? null : 2, memberCoverage: eligible ? 1 : null, changePercent: state === "pending" ? null : index / 10, amount: state === "pending" ? null : 1_000_000 },
      catalysts: [], evidence: [], risks: [], candidates: [], representatives: [], timingQueue: [],
      poolCounts: { representatives: 0, waiting: 0, confirmed: 0, excluded: 0 },
    };
  });
  const completedSectors = sectors.filter((item) => item.scan.state === "complete").length;
  const failedSectors = sectors.filter((item) => item.scan.state === "failed").length;
  const historyAvailable = sectors.reduce((sum, item) => sum + item.scan.historyAvailable, 0);
  const historyPending = sectors.reduce((sum, item) => sum + item.scan.historyPending, 0);
  return {
    schemaVersion: 1, kind: "a-share-selection-snapshot", marketDate, generatedAt, asOf: `${marketDate}T15:00:00+08:00`,
    session: { phase: "close", provisional: false, previousClose: false },
    market: { state: "rotation", candidateLimit: 2, reason: "测试行情", breadth: { total: 120, up: 70, down: 30, flat: 20, netBreadth: 1 / 3, limitUp: 1, limitDown: 0, amount: 1_000_000 } },
    sectors, sectorDirectory: sectors.map(({ id, name }) => ({ id, name })), watch: { stocks: [], sectors: [] }, elapsedMs: 100,
    scanCoverage: { quoteUniverse: 120, researchSectors: count, sectorMembers: historyAvailable + historyPending, historyRequested: historyAvailable + historyPending, historyAvailable, historyPending, historyFailed: 0, historyCacheHits: historyAvailable, historyNetworkLoads: 0 },
    scanProgress: { version: 1, scope: "all-industries", state: "running", totalSectors: count, completedSectors, pendingSectors: count - completedSectors - failedSectors, failedSectors, hasMore: true, updatedAt: generatedAt },
  };
}

test("all industries over twelve survive parsing and presentation pagination", () => {
  const snapshot = parseAShareSelectionSnapshot(JSON.stringify(fixture()));
  assert.equal(snapshot.sectors.length, 45);
  assert.equal(selectionSectorPage(snapshot.sectors).total, 2);
  const first = selectionSectorPage(snapshot.sectors, { view: "all" });
  const second = selectionSectorPage(snapshot.sectors, { view: "all", page: 1 });
  assert.equal(first.rows.length, 20);
  assert.equal(second.rows.length, 20);
  assert.equal(first.pages, 3);
  assert.equal(new Set([...first.rows, ...second.rows].map((sector) => sector.id)).size, 40);
  const result = selectionSectorPage(snapshot.sectors, { view: "all", query: "冷门" });
  assert.equal(result.rows[0].id, "new_sector30");
  assert.equal(result.rows[0].rank, null);
  assert.equal(result.rows[0].recommended, false);
  assert.equal(result.rows[0].metrics.changePercent, null);
  assert.equal(selectionSectorPage(snapshot.sectors, { view: "all", sort: "change" }).rows[0].id, "new_sector6");
});

test("progress rejects conflicting arithmetic, fabricated completeness and duplicate ranks", () => {
  for (const change of [
    (value) => { value.scanProgress.completedSectors += 1; },
    (value) => { value.scanProgress.state = "complete"; },
    (value) => { value.sectors[5].scan.historyAvailable = 2; },
    (value) => { value.sectors[1].rank = 1; },
    (value) => { value.sectors[30].recommended = true; },
    (value) => { value.scanProgress.hasMore = false; },
    (value) => { value.scanCoverage.historyPending = 0; },
  ]) {
    const value = fixture();
    change(value);
    assert.throws(() => parseAShareSelectionSnapshot(JSON.stringify(value)), /无效|冲突|不能|重复/u);
  }
});

test("announcement continuation may run after every industry has completed", () => {
  const value = fixture(5);
  Object.assign(value.scanProgress, { announcementRequested: 10, announcementAvailable: 3, announcementPending: 7, announcementFailed: 0 });
  const snapshot = parseAShareSelectionSnapshot(JSON.stringify(value));
  assert.equal(snapshot.scanProgress.pendingSectors, 0);
  assert.equal(snapshot.scanProgress.hasMore, true);
  assert.equal(snapshot.scanProgress.announcementPending, 7);
  value.scanProgress.announcementPending = 6;
  assert.throws(() => parseAShareSelectionSnapshot(JSON.stringify(value)), /公告核验进度计数冲突/u);
  Object.assign(value.scanProgress, { announcementPending: 0, announcementAvailable: 10, hasMore: false, state: "partial" });
  assert.equal(parseAShareSelectionSnapshot(JSON.stringify(value)).scanProgress.state, "partial", "watch-history failures may remain outside completed industries");
});

test("old snapshots without full-scan fields remain readable", () => {
  const value = fixture(5);
  delete value.scanProgress;
  delete value.scanCoverage.historyPending;
  for (const sector of value.sectors) { delete sector.scan; delete sector.rank; delete sector.selectionReason; }
  const snapshot = parseAShareSelectionSnapshot(JSON.stringify(value));
  assert.equal(snapshot.scanProgress, null);
  assert.equal(snapshot.sectors[0].scan, null);
  assert.equal(selectionSectorPage(snapshot.sectors).total, 2);
});

test("watch-only history batches continue after industries finish, without claiming completion", () => {
  const value = fixture(5);
  value.scanCoverage.historyRequested += 1;
  value.scanCoverage.historyPending = 1;
  const snapshot = parseAShareSelectionSnapshot(JSON.stringify(value));
  assert.equal(snapshot.scanProgress.pendingSectors, 0);
  assert.equal(snapshot.scanProgress.hasMore, true);
  assert.equal(snapshot.scanCoverage.historyPending, 1);
  Object.assign(value.scanProgress, { state: "complete", hasMore: false });
  assert.throws(() => parseAShareSelectionSnapshot(JSON.stringify(value)), /全局历史缺失冲突/u);
  value.scanCoverage.historyPending = 0;
  value.scanCoverage.historyFailed = 1;
  assert.throws(() => parseAShareSelectionSnapshot(JSON.stringify(value)), /全局历史缺失冲突/u);
});

test("continuation modes are separate from manual retry modes", () => {
  for (const runtime of ["node", "nodejs", "bun"]) {
    const continued = selectionRuntimeArgs(runtime, "%7B%7D", "global", "continue-local");
    assert(continued.includes("continue-local"));
    assert.match(continued.find((item) => item.includes("--continue-scan")), /args\.push\("--continue-scan"\)/u);
    assert(selectionRuntimeArgs(runtime, "%7B%7D", "global", "refresh-local").includes("refresh-local"));
    assert(selectionRuntimeArgs(runtime, "%7B%7D", "global", "continue-volatile").includes("continue-volatile"));
  }
});

test("valid high ICIR from a broad low-noise sample does not reject the snapshot", () => {
  const value = fixture();
  value.factorLab = {
    version: 1, horizon: 5, lookbackDays: 120, minimumCrossSection: 5, stocks: 120,
    factors: [{ id: "highProximity", state: "supported", horizon: 5, days: 40, observations: 4_800, icMean: 0.7, icStd: 0.00001, icIr: 70_000 }],
  };
  assert.equal(parseAShareSelectionSnapshot(JSON.stringify(value)).factorLab.factors[0].icIr, 70_000);
  value.factorLab.factors[0].icIr = "Infinity";
  assert.throws(() => parseAShareSelectionSnapshot(JSON.stringify(value)), /ICIR无效/u);
});

test("rotation history preserves valid ranks beyond the old twelve-industry limit", () => {
  const value = fixture(49);
  value.market.rotationMatrix = { version: 1, dates: ["2026-09-10", marketDate], rows: [{ id: "new_sector0", name: "行业0", delta: 10, trend: "rising", cells: [
    { available: true, score: 50, rank: 49, stage: "repair", stageLabel: "趋势修复" },
    { available: true, score: 60, rank: 1, stage: "repair", stageLabel: "趋势修复" },
  ] }], methodology: "各日完整行业排名" };
  const parsed = parseAShareSelectionSnapshot(JSON.stringify(value));
  assert.deepEqual(parsed.market.rotationMatrix.rows[0].cells.map((cell) => cell.rank), [49, 1]);
  value.market.rotationMatrix.rows[0].cells[0].rank = 257;
  assert.throws(() => parseAShareSelectionSnapshot(JSON.stringify(value)), /轮动排名无效/u);
});

class MockElement {
  constructor(tag = "div") { this.tagName = tag; this.children = []; this.dataset = {}; this.style = { setProperty() {} }; this.attributes = {}; this.listeners = new Map(); this.value = ""; this._text = ""; this.classList = { add() {}, remove() {}, toggle() {} }; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((item) => typeof item === "string" ? item : item.textContent).join(""); }
  get options() { return this.children; }
  get firstElementChild() { return this.children[0]; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this._text = ""; this.children = items; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  removeEventListener(name) { this.listeners.delete(name); }
  querySelectorAll() { return []; }
  querySelector() { return new MockElement(); }
  closest() { return this; }
  click() { this.listeners.get("click")?.({ target: this }); }
}

async function withController(run, { persistent = true, holdContinuation = false, snapshotInput = fixture(), initialNow = generatedAt, storageInput = null, versioned = false } = {}) {
  const originals = { window: globalThis.window, document: globalThis.document };
  const timers = new Map();
  let nextTimer = 0;
  const document = new MockElement("document");
  document.visibilityState = "visible";
  document.createElement = (tag) => new MockElement(tag);
  document.createTextNode = (text) => { const node = new MockElement("text"); node.textContent = text; return node; };
  globalThis.document = document;
  globalThis.window = { setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); } };
  const events = new Map();
  const calls = [];
  const updates = [];
  const notifications = [];
  const held = [];
  let spawned = 0;
  let currentNow = initialNow;
  let stored = structuredClone(storageInput), epoch = 0;
  let readError = false, writeError = false, loseWriteReply = false;
  let holdWrite = null;
  const storageSnapshot = () => ({
    exists: stored !== null,
    value: structuredClone(stored),
    revision: stored === null ? null : `sha256:${createHash("sha256").update(JSON.stringify(stored)).digest("hex")}`,
  });
  const elements = new Proxy({}, { get(target, key) { return target[key] ??= new MockElement(); } });
  const hostCall = async (method, args) => {
    calls.push({ method, args });
    if (method === "process.find") return { available: true, handle: "node" };
    if (method === "filesystem.getKnownDirectory") {
      if (!persistent && args.name === "app-data") throw new Error("unsupported");
      return { handle: "data" };
    }
    if (["storage.get", "storage.getSnapshot"].includes(method)) {
      if (readError) throw Error("offline read");
      return method === "storage.getSnapshot" ? storageSnapshot() : structuredClone(stored);
    }
    if (["storage.set", "storage.compareAndSet"].includes(method)) {
      if (holdWrite) await holdWrite;
      if (writeError) throw Error("write unavailable");
      const updated = method === "storage.set" || args.expectedRevision === storageSnapshot().revision;
      if (updated) stored = structuredClone(args.value);
      if (loseWriteReply) throw Error("reply lost after commit");
      return method === "storage.set" ? {} : { updated, snapshot: storageSnapshot() };
    }
    if (method === "process.cancel") { events.get("process.exit")?.({ processId: args.processId, code: 1 }); return {}; }
    if (method === "process.spawn") {
      spawned += 1;
      const processId = `p${calls.length}`;
      const finish = () => {
        events.get("process.output")?.({ processId, stream: "stdout", text: JSON.stringify(snapshotInput) });
        events.get("process.exit")?.({ processId, code: 0 });
      };
      if (holdContinuation && spawned > 1 && args.args.includes("continue-local")) held.push(finish);
      else queueMicrotask(finish);
      return { processId };
    }
    return {};
  };
  let controller;
  try {
    controller = createAShareSelectionController({ hostCall, onHostEvent(name, callback) { events.set(name, callback); return () => events.delete(name); }, notify(message, tone) { notifications.push({ message, tone }); }, onUpdate(value) { updates.push(value); }, storageKey: () => "selection.global", currentEpoch: () => epoch, getContext: () => ({ availableMethods: versioned ? ["storage.getSnapshot", "storage.compareAndSet"] : [] }), now: () => new Date(currentNow), elements });
    await controller.start();
    const tickContinuation = async () => {
      const entry = [...timers].find(([, timer]) => timer.delay === 5_000);
      assert(entry, "a five-second continuation should be scheduled");
      timers.delete(entry[0]); entry[1].callback();
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    };
    await run({ controller, elements, timers, calls, updates, notifications, document, tickContinuation,
      setStored(value) { stored = structuredClone(value); }, stored: () => structuredClone(stored),
      failReads(value) { readError = value; }, failWrites(value) { writeError = value; },
      loseReply() { loseWriteReply = true; }, holdWrites(promise) { holdWrite = promise; },
      switchProject() { epoch++; controller.reset(); }, setNow(value) { currentNow = value; }, finishHeld() { held.shift()?.(); } });
  } finally {
    controller?.dispose();
    globalThis.window = originals.window;
    globalThis.document = originals.document;
  }
}

test("a full one-hundred-stock watchlist rejects additions explicitly", async () => {
  const storageInput = { stocks: Array.from({ length: 100 }, (_, index) => ({
    symbol: `SH${600000 + index}`,
    name: `关注${index}`,
  })) };
  await withController(async ({ controller, notifications }) => {
    await controller.load();
    assert.equal(controller.watch.stocks.length, 100);
    assert.equal(await controller.followStock("SH600100", "新增关注"), false);
    assert.equal(controller.watch.stocks.length, 100);
    assert.deepEqual(notifications.at(-1), { message: "最多可长期关注 100 支股票；可先移除不再关注的股票。", tone: "error" });
  }, { storageInput });
});

test("actual controller displays non-priority pending rows and preserves selection through batches", async () => {
  await withController(async ({ controller, elements, tickContinuation }) => {
    elements.sectorViewAll.click();
    assert.equal(elements.sectorList.children.length, 20);
    assert.match(elements.sectorPageLabel.textContent, /共 45 个/u);
    elements.sectorSearch.value = "冷门";
    elements.sectorSearch.listeners.get("input")();
    assert.equal(elements.sectorList.children.length, 1);
    const pending = elements.sectorList.children[0];
    assert.match(pending.textContent, /待扫描.*非优先研究/u);
    elements.sectorList.listeners.get("click")({ target: pending });
    assert.match(elements.candidateTitle.textContent, /冷门行业/u);
    assert.match(elements.candidateList.textContent, /成员尚未扫描/u);
    await new Promise((resolve) => setImmediate(resolve)); // Wait for the selection preference to save.
    await tickContinuation();
    assert.match(elements.candidateTitle.textContent, /冷门行业/u);
    assert.equal(controller.snapshot.sectors.length, 45);
    elements.sectorSearch.value = "";
    elements.sectorSearch.listeners.get("input")();
    elements.sectorNext.click();
    assert.match(elements.sectorPageLabel.textContent, /第 2 \/ 3 页/u);
  });
});

test("automatic continuation stops on pause, inactive page and hidden document", async () => {
  await withController(async ({ controller, timers, calls, document, tickContinuation }) => {
    const latest = controller.snapshot;
    assert([...timers.values()].some((timer) => timer.delay === 5_000));
    controller.pauseScan();
    assert.equal(timers.size, 0);
    assert.equal(controller.snapshot, latest);
    await controller.resumeScan();
    assert(calls.some((call) => call.method === "process.spawn" && call.args.args.includes("continue-local")));
    controller.setActive(false);
    assert.equal(timers.size, 0);
    controller.setActive(true);
    document.visibilityState = "hidden";
    document.listeners.get("visibilitychange")();
    assert.equal(timers.size, 0);
    document.visibilityState = "visible";
    document.listeners.get("visibilitychange")();
    await tickContinuation();
    assert.equal(controller.snapshot.sectors.length, 45);
  });
});

test("pausing cancels a running continuation and retains the last validated snapshot", async () => {
  await withController(async ({ controller, calls, tickContinuation }) => {
    const latest = controller.snapshot;
    await tickContinuation();
    controller.pauseScan();
    assert(calls.some((call) => call.method === "process.cancel"));
    assert.equal(controller.snapshot, latest);
    await Promise.resolve();
  }, { holdContinuation: true });
});

test("a legacy host without persistent data cannot enter an infinite continuation loop", async () => {
  await withController(async ({ controller, timers, elements, calls }) => {
    assert(![...timers.values()].some((timer) => timer.delay === 5_000));
    assert.equal(elements.scanToggle.disabled, true);
    assert.match(elements.scanProgress.textContent, /不支持跨批次本地续扫/u);
    assert.equal(calls.filter((call) => call.method === "process.spawn").length, 1);
    assert(calls.find((call) => call.method === "process.spawn").args.args.includes("refresh-volatile"));
    await controller.refresh({ manual: true });
    await controller.refresh();
    assert(calls.filter((call) => call.method === "process.spawn").every((call) => call.args.args.includes("refresh-volatile")), "a volatile process has no checkpoint or retry budget to continue");
    assert(![...timers.values()].some((timer) => timer.delay === 5_000));
  }, { persistent: false });
});

test("close snapshots probe the next session and an unfinished close at bounded deadlines", () => {
  const snapshot = fixture(5);
  assert.equal(selectionFreshnessRefreshAt(snapshot, new Date("2026-09-14T09:35:00+08:00")), Date.parse("2026-09-14T09:35:00+08:00"));
  assert.equal(selectionFreshnessRefreshAt(snapshot, new Date("2026-09-12T16:00:00+08:00")), Date.parse("2026-09-14T09:35:00+08:00"));
  const intraday = { ...snapshot, generatedAt: "2026-09-11T14:50:00+08:00", session: { phase: "intraday", provisional: true } };
  assert.equal(selectionFreshnessRefreshAt(intraday, new Date("2026-09-11T15:05:00+08:00")), Date.parse("2026-09-11T15:12:00+08:00"));
  assert.equal(selectionFreshnessRefreshAt(intraday, new Date("2026-09-11T15:15:00+08:00")), Date.parse("2026-09-11T15:15:00+08:00"));
  assert.equal(selectionFreshnessRefreshAt(intraday, new Date("2026-09-11T15:15:00+08:00"), Date.parse("2026-09-11T15:14:00+08:00")), Date.parse("2026-09-11T15:29:00+08:00"));
});

test("legacy empty source failures recover on weekends without resetting current retry budgets", () => {
  const value = fixture(0);
  value.sourceStatus = { industries: false };
  Object.assign(value.scanProgress, { state: "partial", hasMore: false });
  const legacy = parseAShareSelectionSnapshot(JSON.stringify(value));
  const weekend = new Date("2026-09-12T16:00:00+08:00");
  assert.equal(selectionFreshnessRefreshAt(legacy, weekend), weekend.getTime());
  assert.equal(selectionFreshnessRefreshAt(legacy, weekend, Date.parse("2026-09-12T15:59:00+08:00")), Date.parse("2026-09-12T16:14:00+08:00"));
  value.selectionSummary = { version: 1, state: "data-unavailable", reason: "行业数据源仍不可用，本轮自动重试已结束", sectorCount: 0, rankedSectors: 0, partialSectors: 0, analyzedStocks: 0, observedStocks: 0, confirmedStocks: 0 };
  const current = parseAShareSelectionSnapshot(JSON.stringify(value));
  assert.equal(selectionFreshnessRefreshAt(current, weekend), Date.parse("2026-09-14T09:35:00+08:00"), "a current exhausted snapshot must not restart the migration probe");
});

test("frequent visible-context events do not postpone the absolute intraday refresh deadline", async () => {
  const snapshot = fixture(5);
  Object.assign(snapshot, { generatedAt: "2026-09-11T10:00:00+08:00", asOf: "2026-09-11T10:00:00+08:00", session: { phase: "intraday", provisional: true, previousClose: false } });
  Object.assign(snapshot.scanProgress, { state: "complete", hasMore: false, updatedAt: snapshot.generatedAt });
  await withController(async ({ controller, timers, calls, setNow }) => {
    setNow("2026-09-11T10:10:00+08:00"); controller.setActive(true);
    assert([...timers.values()].some((timer) => timer.delay === 20 * 60_000));
    setNow("2026-09-11T10:20:00+08:00"); controller.setActive(true);
    assert([...timers.values()].some((timer) => timer.delay === 10 * 60_000));
    setNow("2026-09-11T10:31:00+08:00"); controller.setActive(true);
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
    assert.equal(calls.filter((call) => call.method === "process.spawn").length, 2);
  }, { snapshotInput: snapshot, initialNow: snapshot.generatedAt });
});

test("source cooldown metadata schedules the specified retry instead of a five-second loop", async () => {
  const snapshot = fixture();
  snapshot.scanProgress.nextRetryAt = "2026-09-11T16:15:00+08:00";
  await withController(async ({ timers, elements }) => {
    assert([...timers.values()].some((timer) => timer.delay === 15 * 60_000));
    assert(![...timers.values()].some((timer) => timer.delay === 5_000));
    assert.match(elements.scanProgress.textContent, /数据源冷却中.*自动重试/u);
  }, { snapshotInput: snapshot });
});

test("pending member-source failures remain visible even when the cached industry directory is available", async () => {
  for (const reason of ["行业成员获取失败，已安排稍后自动重试", "SOURCE_HTTP_456"]) {
    const snapshot = fixture();
    snapshot.sourceStatus = { industries: true };
    snapshot.sectors[5].scan.reason = "";
    snapshot.sectors[6].scan.reason = "";
    snapshot.sectors[7].scan.reason = reason;
    snapshot.sectors[8].scan.reason = "等待获取完整行业成员";
    snapshot.scanProgress.nextRetryAt = "2026-09-11T16:15:00+08:00";
    await withController(async ({ elements }) => {
      assert.match(elements.scanProgress.textContent, reason === "SOURCE_HTTP_456"
        ? /待核验原因：数据源限流（456）/u : /待核验原因：行业成员获取失败/u);
      assert.doesNotMatch(elements.scanProgress.textContent, /等待获取完整行业成员|成员尚未扫描/u);
      assert.match(elements.scanProgress.textContent, /16:15.*自动重试/u);
    }, { snapshotInput: snapshot });
  }
});

test("source interruption is explained before zero-result or market-filter claims", async () => {
  const snapshot = fixture(0);
  snapshot.sourceStatus = { industries: false };
  snapshot.scanProgress.nextRetryAt = "2026-09-11T16:15:00+08:00";
  snapshot.selectionSummary = { version: 1, state: "data-unavailable", reason: "行业数据源暂时中断，尚未完成扫描", sectorCount: 0, rankedSectors: 0, partialSectors: 0, analyzedStocks: 0, observedStocks: 0, confirmedStocks: 0 };
  await withController(async ({ elements }) => {
    assert.match(elements.picksList.textContent, /尚未完成扫描/u);
    assert.match(elements.sectorList.textContent, /行业数据源暂时中断/u);
    assert.match(elements.scanProgress.textContent, /行业扫描未完成/u);
    assert.doesNotMatch(elements.scanProgress.textContent, /本轮扫描已完成/u);
  }, { snapshotInput: snapshot });
});

test("empty research results keep an explicit route to the observed industries", async () => {
  const snapshot = fixture(5);
  snapshot.sectors.forEach((sector) => { sector.recommended = false; });
  snapshot.market.candidateLimit = 0;
  Object.assign(snapshot.scanProgress, { state: "complete", hasMore: false });
  snapshot.selectionSummary = { version: 1, state: "market-blocked", reason: "市场条件未通过，13 只股票继续观察", sectorCount: 5, rankedSectors: 5, partialSectors: 0, analyzedStocks: 13, observedStocks: 13, confirmedStocks: 0 };
  await withController(async ({ elements }) => {
    assert.equal(elements.picksCount.textContent, "0 只");
    assert.match(elements.picksList.textContent, /继续观察/u);
    const action = elements.picksList.children.at(-1).children[0];
    assert.equal(action.textContent, "查看观察池 · 全部板块");
    action.click();
    assert.equal(elements.funnelDetails.open, true);
    assert.equal(elements.sectorViewAll.getAttribute("aria-pressed"), "true");
    assert.equal(elements.sectorList.children.length, 5);
    assert.equal(elements.picksCount.textContent, "0 只", "navigation must not relabel observations as recommendations");
  }, { snapshotInput: snapshot });
});

test("full-pool gate counts can overlap and are not confused with truncated display cards", () => {
  const snapshot = fixture();
  snapshot.selectionSummary = { version: 1, state: "market-blocked", reason: "市场条件未通过，保留观察", sectorCount: 45, rankedSectors: 5, partialSectors: 1, analyzedStocks: 11, observedStocks: 8, confirmedStocks: 5 };
  snapshot.sectors[0].gateCounts = { analyzed: 2, historyUnavailable: 0, trendBlocked: 1, strategyWaiting: 2, technicalReady: 1, marketBlocked: 1, announcementPending: 1, announcementRisk: 0, sectorBlocked: 0, confirmed: 0 };
  const parsed = parseAShareSelectionSnapshot(JSON.stringify(snapshot));
  assert.equal(parsed.selectionSummary.confirmedStocks, 5);
  assert.equal(parsed.sectors[0].gateCounts.strategyWaiting, 2);
  assert.equal(parsed.sectors[0].gateCounts.marketBlocked, 1);
  snapshot.sectors[0].gateCounts.analyzed = 2_001;
  assert.throws(() => parseAShareSelectionSnapshot(JSON.stringify(snapshot)), /过滤数无效/u);
});

test("watch additions during a running batch are refreshed after that batch rather than discarded", async () => {
  await withController(async ({ controller, timers, calls, tickContinuation, finishHeld }) => {
    await tickContinuation();
    await controller.followStock("SH600000", "浦发银行");
    finishHeld();
    for (let index = 0; index < 14; index += 1) await Promise.resolve();
    const queued = [...timers].find(([, timer]) => timer.delay === 0);
    assert(queued, "watch change must enqueue a refresh after the in-flight batch");
    timers.delete(queued[0]); queued[1].callback();
    for (let index = 0; index < 14; index += 1) await Promise.resolve();
    const last = calls.filter((call) => call.method === "process.spawn").at(-1);
    assert(last.args.args.includes("continue-local"), "watch changes must preserve existing retry budgets");
    assert.match(decodeURIComponent(last.args.args.at(-2)), /SH600000/u);
  }, { holdContinuation: true });
});

test("visible background watch maintenance updates an old close without continuing full-market batches", async () => {
  await withController(async ({ controller, timers, calls, setNow }) => {
    await controller.followStock("SH600000", "浦发银行");
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
    const before = calls.filter((call) => call.method === "process.spawn").length;
    setNow("2026-09-14T10:00:00+08:00");
    controller.setActive(false, { backgroundWatch: true });
    for (let index = 0; index < 14; index += 1) await Promise.resolve();
    assert.equal(calls.filter((call) => call.method === "process.spawn").length, before + 1);
    assert(![...timers.values()].some((timer) => timer.delay === 5_000));
    assert([...timers.values()].some((timer) => timer.delay === 30 * 60_000));
    controller.setActive(false, { backgroundWatch: false });
    assert.equal(timers.size, 0);
  });
});

test("automatic freshness preserves retry budgets while explicit manual refresh resets them", async () => {
  await withController(async ({ controller, calls }) => {
    const first = calls.find((call) => call.method === "process.spawn");
    assert(first.args.args.includes("continue-local"));
    await controller.refresh({ manual: true });
    const manual = calls.filter((call) => call.method === "process.spawn").at(-1);
    assert(manual.args.args.includes("refresh-local"));
    await controller.refresh();
    const automatic = calls.filter((call) => call.method === "process.spawn").at(-1);
    assert(automatic.args.args.includes("continue-local"));
  });
});

const batchFixture = () => ({ version: 1, memberRequests: 0, memberCompleted: 0, historyRequests: 24, historyAdded: 0, historyRejected: 24, announcementRequests: 0, announcementChecked: 0 });

test("per-batch diagnostics keep real attempts separate from added data and reject impossible counts", () => {
  const value = fixture();
  value.scanProgress.batch = batchFixture();
  assert.deepEqual(parseAShareSelectionSnapshot(JSON.stringify(value)).scanProgress.batch, value.scanProgress.batch);
  for (const change of [
    { version: 2 }, { historyRequests: 25 }, { historyAdded: 1 },
    { memberRequests: 9 }, { memberCompleted: 1 },
    { announcementRequests: 21 }, { announcementChecked: 1 },
  ]) {
    value.scanProgress.batch = { ...batchFixture(), ...change };
    assert.throws(() => parseAShareSelectionSnapshot(JSON.stringify(value)), /本批扫描计数/u);
  }
});

test("continuations preserve cards, disclosure state and the ready page while showing local progress", async () => {
  await withController(async ({ controller, elements, updates, tickContinuation, finishHeld }) => {
    elements.sectorViewAll.click();
    const card = elements.sectorList.children[0];
    const pickContent = elements.picksList.children[0];
    const buttonLabel = elements.refresh.textContent;
    const updateCount = updates.length;
    await tickContinuation();
    assert.equal(elements.root.getAttribute("aria-busy"), "false");
    assert.equal(elements.root.dataset.state, "ready");
    assert.equal(elements.root.dataset.scanState, "scanning");
    assert.equal(elements.refresh.textContent, buttonLabel);
    assert.equal(elements.export.disabled, false);
    assert.equal(elements.sectorList.children[0], card);
    assert.equal(elements.picksList.children[0], pickContent);
    assert.match(elements.status.textContent, /历史 11\/12 已核验.*待核验 1.*本批正在核验/u);
    finishHeld();
    for (let index = 0; index < 15; index += 1) await Promise.resolve();
    assert.equal(elements.sectorList.children[0], card);
    assert.equal(updates.length, updateCount, "an unchanged batch must not trigger the outer app render again");
    assert.match(elements.scanProgress.textContent, /净增可用历史 0.*下批/u);
    assert.equal(controller.snapshot.sectors.length, 45);
  }, { holdContinuation: true });
});

test("two empty automatic batches pause with a reason instead of looping every five seconds", async () => {
  await withController(async ({ elements, timers, tickContinuation }) => {
    await tickContinuation();
    await tickContinuation();
    assert.equal(elements.scanProgress.dataset.state, "paused");
    assert.match(elements.status.textContent, /连续 2 批未取得新增数据或处理进展.*已暂停/u);
    assert.equal(elements.scanToggle.textContent, "继续扫描");
    assert(![...timers.values()].some((timer) => timer.delay === 5_000));
  });
});

test("real attempted batches do not trigger the idle-loop guard and report added data separately", async () => {
  const value = fixture();
  value.scanProgress.batch = batchFixture();
  await withController(async ({ elements, timers, tickContinuation }) => {
    await tickContinuation();
    await tickContinuation();
    assert.notEqual(elements.scanProgress.dataset.state, "paused");
    assert.match(elements.scanProgress.textContent, /检查历史 24、补齐 0、暂未取得 24/u);
    assert([...timers.values()].some((timer) => timer.delay === 5_000));
  }, { snapshotInput: value });
});

test("newly completed histories show the batch increment without resetting the selection", async () => {
  const value = fixture();
  await withController(async ({ elements, tickContinuation }) => {
    const sector = value.sectors[5];
    Object.assign(sector.scan, { state: "complete", historyAvailable: 2, historyPending: 0 });
    sector.rank = 6;
    value.scanProgress.completedSectors += 1;
    value.scanProgress.pendingSectors -= 1;
    value.scanCoverage.historyAvailable += 1;
    value.scanCoverage.historyCacheHits += 1;
    value.scanCoverage.historyPending -= 1;
    value.scanProgress.batch = { ...batchFixture(), historyRequests: 1, historyAdded: 1, historyRejected: 0 };
    await tickContinuation();
    assert.match(elements.status.textContent, /净增可用历史 1、已核验公告 0、完整行业 1/u);
    assert.match(elements.scanProgress.textContent, /已完成 6/u);
  }, { snapshotInput: value });
});

function partialObservationFixture() {
  const value = fixture(49);
  value.market.candidateLimit = 0;
  value.sectors.forEach((sector, index) => {
    const eligible = index < 7 ? 60 : index === 7 ? 70 : 0;
    const available = index < 7 ? 30 : index === 7 ? 33 : 0;
    sector.recommended = false;
    sector.rank = null;
    sector.selectionReason = "行业成分尚未完整核验，不能进入确认";
    sector.scan = { state: index < 8 ? "partial" : "pending", memberCount: eligible, eligibleCount: eligible, historyAvailable: available, historyPending: eligible - available, historyFailed: 0, reason: index < 8 ? "HTTP456；HISTORY_DATE_STALE" : "成员尚未扫描" };
    sector.metrics.sampleSize = available;
  });
  Object.assign(value.scanCoverage, { sectorMembers: 490, historyRequested: 490, historyAvailable: 243, historyCacheHits: 243, historyPending: 247, historyFailed: 0 });
  Object.assign(value.scanProgress, { completedSectors: 0, pendingSectors: 49, failedSectors: 0, announcementRequested: 43, announcementAvailable: 43, announcementPending: 0, announcementFailed: 0, nextRetryAt: "2026-09-11T16:15:00+08:00", batch: batchFixture() });
  value.selectionSummary = { version: 1, state: "scanning", reason: "行业核验尚未完成", sectorCount: 49, rankedSectors: 0, partialSectors: 8, analyzedStocks: 243, observedStocks: 51, confirmedStocks: 0 };
  const candidate = { symbol: "SH600001", name: "观察样本", rank: 1, relativeScore: 60, state: "waiting", stateLabel: "继续观察", lastBarDate: marketDate, price: 10, changePercent: 1, amount: 100_000, turnover: 2, pe: 10, pb: 1,
    metrics: { ma20: 9.8, ma60: 9, return20: 3, return60: 10, volumeRatio: 0.8, distanceHigh60: -5, extension20: 2 },
    setup: { id: "market-environment", status: "waiting", label: "等待市场条件", trigger: "市场条件未通过，继续等待" },
    risks: ["公告核验未通过"], support: [], events: [] };
  value.sectors[0].timingQueue = [candidate];
  value.sectors[0].representatives = [{ ...candidate, risks: [] }];
  value.sectors[0].poolCounts = { representatives: 1, waiting: 1, confirmed: 0, excluded: 0 };
  return value;
}

test("partial coverage shows real observations and the exact cooldown without starting another request", async () => {
  await withController(async ({ controller, elements, calls, setNow, timers }) => {
    assert.match(elements.status.textContent, /全部 49 个行业.*已完成 0.*部分完成 8.*历史 243\/490 已核验（待核验 247.*公告 43\/43/u);
    assert.match(elements.status.textContent, /检查历史 24、补齐 0、暂未取得 24/u);
    assert.match(elements.status.textContent, /数据源限流（456）.*日线尚未更新.*16:15.*等待期间不发起续批请求/u);
    assert.match(elements.picksList.textContent, /已取得数据 · 继续观察.*全池共 51 只.*观察样本.*市场条件未通过.*行业待满足/u);
    assert.equal(elements.picksCount.textContent, "0 只");
    const preview = elements.picksList.children.find((node) => node.className === "selection-observation-preview");
    assert.equal(preview.children.filter((node) => node.dataset.kind === "observation").length, 1, "timing and representative duplicates must not inflate the visible pool");
    setNow("2026-09-11T16:05:00+08:00");
    controller.setActive(true);
    await controller.refresh();
    assert.equal(calls.filter((call) => call.method === "process.spawn").length, 1);
    assert([...timers.values()].some((timer) => timer.delay === 10 * 60_000));
  }, { snapshotInput: partialObservationFixture() });
});

function ladderFixture(count = 20) {
  const stocks = Array.from({ length: count }, (_, index) => ({
    symbol: `SH${String(600001 + index)}`, name: `封板样本${index}`, sectorId: "new_sector0", sectorName: "行业0", boards: index < 5 ? 2 : 1,
    previousBoards: index < 5 ? 1 : 0, promoted: index < 5, sealed: true, touched: true, price: 11, changePercent: 10, amount: 100_000,
  }));
  return { version: 1, provisional: false, sampleSize: count, sealed: count, broken: 0, maxBoards: 2, promotionPool: 5, promotionRate: 1,
    tiers: [{ boards: 2, label: "2 板", stocks: stocks.slice(0, 5) }, { boards: 1, label: "首板", stocks: stocks.slice(5) }], brokenStocks: [], disclosure: "完整核验样本；每层只展示部分明细" };
}

test("limit ladders retain full sealed counts beyond display limits and reject duplicates or fabricated totals", async () => {
  const value = fixture();
  value.market.limitLadder = ladderFixture();
  const parsed = parseAShareSelectionSnapshot(JSON.stringify(value));
  assert.equal(parsed.market.limitLadder.sealed, 20);
  assert.equal(parsed.market.limitLadder.tiers[1].stocks.length, 15);
  await withController(async ({ elements }) => {
    const firstBoards = elements.limitLadderTiers.children.find((node) => node.dataset.boards === "1");
    assert.match(firstBoards.children[0].textContent, /15 只 · 展示前 12 只/u);
    assert.equal(firstBoards.children[1].children.length, 12);
  }, { snapshotInput: value });
  value.market.limitLadder = ladderFixture(1_001);
  value.market.limitLadder.promotionPool = 1_001;
  assert.equal(parseAShareSelectionSnapshot(JSON.stringify(value)).market.limitLadder.sealed, 1_001);
  for (const modify of [
    (ladder) => { ladder.sealed = 19; },
    (ladder) => { ladder.sampleSize = 19; },
    (ladder) => { ladder.tiers[1].stocks[0].symbol = ladder.tiers[0].stocks[0].symbol; },
    (ladder) => { ladder.broken = 1; ladder.sampleSize = 21; ladder.brokenStocks = [{ ...ladder.tiers[0].stocks[0], boards: 0, sealed: false }]; },
  ]) {
    value.market.limitLadder = ladderFixture();
    modify(value.market.limitLadder);
    assert.throws(() => parseAShareSelectionSnapshot(JSON.stringify(value)), /梯队.*冲突|股票重复/u);
  }
});

test("leaving the selection page lets its running batch finish before suspending continuation", async () => {
  await withController(async ({ controller, calls, timers, elements, tickContinuation, finishHeld }) => {
    await tickContinuation();
    const started = calls.filter((call) => call.method === "process.spawn").length;
    controller.setActive(false);
    assert(!calls.some((call) => call.method === "process.cancel"), "navigation must not cancel an in-flight batch");
    finishHeld();
    for (let index = 0; index < 30; index += 1) await Promise.resolve();
    assert.doesNotMatch(elements.status.textContent, /任务已中断|本次刷新失败|扫描已暂停/u);
    assert.match(elements.status.textContent, /上批/u, "the finished batch must remain visible in progress");
    assert.equal(calls.filter((call) => call.method === "process.spawn").length, started);
    assert.equal(timers.size, 0, "background page must not schedule another full-market batch");
    controller.setActive(true);
    assert([...timers.values()].some((timer) => timer.delay === 5_000), "returning resumes saved progress");
  }, { holdContinuation: true });
});

test("hiding the window preserves a running batch and resumes scheduling when visible", async () => {
  await withController(async ({ calls, timers, document, tickContinuation, finishHeld }) => {
    await tickContinuation();
    document.visibilityState = "hidden";
    document.listeners.get("visibilitychange")();
    assert(!calls.some((call) => call.method === "process.cancel"));
    finishHeld();
    for (let index = 0; index < 30; index += 1) await Promise.resolve();
    assert.equal(timers.size, 0);
    document.visibilityState = "visible";
    document.listeners.get("visibilitychange")();
    assert([...timers.values()].some((timer) => timer.delay === 5_000));
  }, { holdContinuation: true });
});


test("long-term watch preserves a conflicting draft and blocks scans until explicit reload", async () => {
  await withController(async ({ controller, elements, calls, notifications, setStored, stored }) => {
    setStored({ version: 2, stocks: [{ symbol: "SH600036", name: "other device" }], sectors: [] });
    const before = calls.filter((call) => call.method === "process.spawn").length;
    assert.equal(await controller.followStock("SH600519", "my draft"), false);
    assert.equal(controller.watch.stocks[0].symbol, "SH600519");
    assert.equal(stored().stocks[0].symbol, "SH600036");
    assert.match(elements.watchStorageState.textContent, /其他页面或设备/);
    assert.equal(elements.watchStockAdd.disabled, true);
    assert.equal(elements.watchStorageRecovery.hidden, false);
    assert.equal(notifications.some((item) => item.message === "已长期关注 my draft"), false);
    await controller.refresh({ manual: true });
    assert.equal(calls.filter((call) => call.method === "process.spawn").length, before);
    const writes = calls.filter((call) => call.method === "storage.compareAndSet").length;
    assert.equal(await controller.followStock("SH600000", "blocked"), false);
    assert.equal(calls.filter((call) => call.method === "storage.compareAndSet").length, writes);
    elements.watchStorageReload.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(controller.watch.stocks[0].symbol, "SH600036");
    assert.equal(elements.watchStockAdd.disabled, false);
    assert.equal(elements.watchStorageRecovery.hidden, true);
    assert.equal(calls.some((call) => call.method === "storage.set"), false);
  }, { versioned: true });
});

test("long-term watch reload failure keeps the draft and a lost committed reply is reconciled without another write", async () => {
  await withController(async ({ controller, elements, calls, failWrites, failReads, loseReply, stored }) => {
    failWrites(true);
    assert.equal(await controller.followStock("SH600519", "draft"), false);
    failReads(true);
    elements.watchStorageReload.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(controller.watch.stocks[0].symbol, "SH600519");
    assert.match(elements.watchStorageState.textContent, /读取失败/);
    assert.equal(elements.watchStockAdd.disabled, true);
    failReads(false); failWrites(false);
    elements.watchStorageReload.click();
    await new Promise((resolve) => setImmediate(resolve));
    loseReply();
    const before = calls.filter((call) => call.method === "storage.compareAndSet").length;
    assert.equal(await controller.followStock("SH600036", "confirmed"), true);
    assert.equal(stored().stocks[0].symbol, "SH600036");
    assert.equal(calls.filter((call) => call.method === "storage.compareAndSet").length, before + 1);
    assert.equal(elements.watchStorageRecovery.hidden, true);
  }, { versioned: true });
});

test("a pending long-term watch save cannot publish success or start scans in the next project", async () => {
  await withController(async ({ controller, elements, calls, notifications, holdWrites, switchProject }) => {
    let release;
    holdWrites(new Promise((resolve) => { release = resolve; }));
    const pending = controller.followStock("SH600519", "old project");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(elements.watchStockAdd.disabled, true);
    switchProject();
    const count = calls.length;
    release();
    assert.equal(await pending, false);
    assert.equal(controller.watch.stocks.length, 0);
    assert.equal(calls.length, count);
    assert.equal(notifications.some((item) => item.message === "已长期关注 old project"), false);
  }, { versioned: true });
});

test("portfolio synchronization cannot silently claim success after a conflicting save", async () => {
  await withController(async ({ controller, elements, setStored, stored }) => {
    setStored({ stocks: [{ symbol: "SH600036", name: "other" }], sectors: [] });
    await assert.rejects(controller.syncPortfolio(
      { instruments: [{ id: "stock", market: "cn", symbol: "SH600519", name: "holding" }] },
      { positionsByAccount: [{ instrumentId: "stock", quantity: 1 }] },
    ), /尚未保存/);
    assert.equal(stored().stocks[0].symbol, "SH600036");
    assert.equal(controller.watch.stocks[0].symbol, "SH600519");
    assert.equal(elements.watchStockAdd.disabled, true);
  }, { versioned: true });
});

test("unsupported long-term watch records cannot be replaced by an empty default", async () => {
  for (const storageInput of [{ version: 999, stocks: [] }, { stocks: "broken" }, { stocks: [{ symbol: "invalid" }] }]) {
    await withController(async ({ controller, elements, calls, stored }) => {
      assert.equal(await controller.followStock("SH600519", "blocked"), false);
      assert.match(elements.watchStorageState.textContent, /读取失败/);
      assert.deepEqual(stored(), storageInput);
      assert.equal(calls.some((call) => ["storage.set", "storage.compareAndSet", "process.spawn"].includes(call.method)), false);
    }, { versioned: true, storageInput });
  }
});


test("pausing scans leaves project watch storage writable without restarting scans", async () => {
  await withController(async ({ controller, elements, calls, stored, holdWrites }) => {
    controller.pauseScan();
    const scans = calls.filter((call) => call.method === "process.spawn").length;
    assert.equal(await controller.followStock("SH600519", "after pause"), true);
    assert.equal(stored().stocks[0].symbol, "SH600519");
    assert.equal(elements.watchStockAdd.disabled, false);
    let release;
    holdWrites(new Promise((resolve) => { release = resolve; }));
    const pending = controller.followStock("SH600036", "during pause");
    await new Promise((resolve) => setImmediate(resolve));
    controller.pauseScan();
    release();
    assert.equal(await pending, true);
    assert.equal(elements.watchStockAdd.disabled, false);
    assert.equal(stored().stocks.length, 2);
    assert.equal(calls.filter((call) => call.method === "process.spawn").length, scans);
    assert.equal(elements.watchStorageRecovery.hidden, true);
  }, { versioned: true });
});
