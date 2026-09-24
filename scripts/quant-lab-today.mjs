import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { buildTodayModel, marketStatusAt } = await import(
  pathToFileURL(join(repositoryRoot, "apps", "quant-lab", "app", "today-model.mjs")).href
);
const { buildDeskAutomations, createAlertsController, HOST_AUTOMATION_LIMITS } = await import(
  pathToFileURL(join(repositoryRoot, "apps", "quant-lab", "app", "modules", "alerts-ui.mjs")).href
);
const { observationAvailableAt } = await import(
  pathToFileURL(join(repositoryRoot, "apps", "quant-lab", "app", "market-contract.mjs")).href
);
const { readFile } = await import("node:fs/promises");

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function rule(id, priority, status, overrides = {}) {
  return {
    id,
    priority,
    status,
    actual: Object.hasOwn(overrides, "actual")
      ? overrides.actual
      : { count: status === "warning" ? 1 : 0 },
    threshold: Object.hasOwn(overrides, "threshold") ? overrides.threshold : { count: 0 },
    data: {
      source: overrides.source ?? "portfolio-value-series",
      availableAt: overrides.availableAt ?? "2026-08-26T07:00:00+08:00",
      stale: overrides.stale ?? false,
      provisional: overrides.provisional ?? false,
    },
    ...(overrides.unavailable ? { unavailable: overrides.unavailable } : {}),
  };
}

const cleanRules = [
  rule("stale-quotes", "P0", "positive"),
  rule("missing-raw-data", "P0", "positive"),
  rule("pnl-contributors", "P2", "neutral"),
];

function input(overrides = {}) {
  return {
    portfolio: {
      ledgerExists: true,
      hasPositions: true,
      summary: {
        totalBase: "123456.78",
        source: "portfolio-analysis",
        availableAt: "2026-08-26T07:00:00+08:00",
        stale: false,
        provisional: false,
      },
      analysis: { marker: "already-computed" },
      rules: cleanRules,
      ...(overrides.portfolio ?? {}),
    },
    watchResults: overrides.watchResults ?? [],
    dataStatus: overrides.dataStatus ?? {
      source: "workspace-cache",
      availableAt: "2026-08-26T07:00:00+08:00",
      stale: false,
      provisional: false,
    },
    newsSummary: { status: "unavailable", reason: "not-implemented" },
    reviewDue: { status: "unavailable", reason: "not-implemented" },
    now: overrides.now ?? "2026-08-26T00:00:00.000Z",
    marketStatus: marketStatusAt(new Date("2026-08-26T00:00:00.000Z")),
  };
}

// Branch 1: no authoritative ledger always wins, even if other inputs carry a
// trigger. The action is a recording/navigation action, never market advice.
{
  const model = buildTodayModel(
    input({
      portfolio: { ledgerExists: false, hasPositions: false, rules: [] },
      watchResults: [{ id: "watch-z", triggered: true }],
    }),
  );
  assert.equal(model.primaryAction.id, "add-holding");
  assert.equal(model.primaryAction.label, "添加持仓");
  assert.equal(model.primaryAction.module, "holdings");
  assert.equal(model.primaryAction.focus, "portfolio-entry");
}

// Branch 2: P0 data blockers beat a real watch trigger. Selection is stable by
// rule id when inputs arrive in a different order, and missing actual stays null.
{
  const blockers = [
    rule("stale-quotes", "P0", "unavailable", {
      actual: null,
      threshold: { withinMarketFreshnessWindow: true },
      source: "data/quotes/latest.json",
      availableAt: null,
      stale: true,
      provisional: false,
      unavailable: { reason: "quote-data-unavailable" },
    }),
    rule("missing-raw-data", "P0", "warning", {
      actual: { count: 1 },
      threshold: { unavailableSources: 0 },
    }),
  ];
  const watchResults = [{
    id: "watch-hit",
    symbol: "AAPL",
    rule: "price-below",
    triggered: true,
    close: 90,
    threshold: { price: 100 },
    source: "data/market/AAPL.csv",
    availableAt: "2026-08-25T20:00:00-04:00",
    stale: false,
    provisional: false,
  }];
  const first = buildTodayModel(input({ portfolio: { rules: blockers }, watchResults }));
  const second = buildTodayModel(input({ portfolio: { rules: [...blockers].reverse() }, watchResults }));
  assert.equal(first.primaryAction.id, "sync-data");
  assert.equal(first.primaryAction.label, "同步数据");
  assert.equal(first.primaryAction.evidence.id, "missing-raw-data");
  assert.deepEqual(second.primaryAction, first.primaryAction);
  for (const field of ["actual", "threshold", "source", "availableAt", "stale", "provisional"]) {
    assert(Object.hasOwn(first.primaryAction.evidence, field), `P0 reason must include ${field}`);
  }
  const onlyMissing = buildTodayModel(input({ portfolio: { rules: [blockers[0]] } }));
  assert.equal(onlyMissing.primaryAction.evidence.actual, null, "missing data must not become zero");
}

// Branch 3: only a persisted, real watch evaluation with triggered === true
// can become today's trigger. Stable tie-break is id, not input order.
{
  const hits = [
    {
      id: "watch-z",
      symbol: "AAPL",
      rule: "price-below",
      triggered: true,
      close: 95,
      threshold: { price: 100 },
      source: "data/market/AAPL.csv",
      availableAt: "2026-08-25T20:00:00-04:00",
      stale: false,
      provisional: false,
    },
    {
      id: "watch-a",
      symbol: "SH600519",
      rule: "rsi-oversold",
      triggered: true,
      close: 1400,
      threshold: { threshold: 30 },
      source: "data/market/SH600519.csv",
      availableAt: "2026-08-26T15:00:00+08:00",
      stale: false,
      provisional: false,
    },
  ];
  const first = buildTodayModel(input({ watchResults: hits }));
  const second = buildTodayModel(input({ watchResults: [...hits].reverse() }));
  assert.equal(first.primaryAction.id, "view-trigger");
  assert.equal(first.primaryAction.label, "查看触发");
  assert.equal(first.primaryAction.evidence.id, "watch-a");
  assert.deepEqual(second.primaryAction, first.primaryAction);
}

// Branch 4: an important non-P0 portfolio warning is next. A P1 tie is stable.
{
  const warnings = [
    rule("position-weight-extremes", "P1", "warning"),
    rule("concentration-band", "P1", "warning"),
  ];
  const model = buildTodayModel(input({ portfolio: { rules: [...cleanRules, ...warnings] } }));
  assert.equal(model.primaryAction.id, "view-holdings-analysis");
  assert.equal(model.primaryAction.evidence.id, "concentration-band");
}

// Branch 5: no blocker or trigger falls back deterministically without inventing
// a recommendation. At most three compact summaries are returned.
{
  const withWatch = buildTodayModel(input({ watchResults: [{ id: "checked", triggered: false }] }));
  assert.equal(withWatch.primaryAction.id, "view-watch");
  const withoutWatch = buildTodayModel(input());
  assert.equal(withoutWatch.primaryAction.id, "view-research");
  assert(withoutWatch.summaries.length <= 3);
}

// Pure aggregation: a frozen input stays unchanged and an analyze adapter trap
// is never observed. today-model must consume the completed analysis, not call it.
{
  let analyzeReads = 0;
  const frozen = input();
  Object.defineProperty(frozen, "analyzePortfolio", {
    enumerable: false,
    get() {
      analyzeReads += 1;
      throw new Error("today-model must not read analyzePortfolio");
    },
  });
  deepFreeze(frozen);
  const before = JSON.stringify(frozen);
  const model = buildTodayModel(frozen);
  assert.equal(analyzeReads, 0);
  assert.equal(JSON.stringify(frozen), before);
  assert.equal(model.portfolioSummary.analysis, frozen.portfolio.analysis);
  assert.doesNotMatch(
    JSON.stringify(model),
    /建议|推荐|买入|卖出|加仓|减仓|止损/u,
    "today copy must remain descriptive/navigation-only",
  );
}

function assertClock(iso, market, state, nextIncludes) {
  const value = marketStatusAt(new Date(iso))[market];
  assert.equal(value.state, state, `${market} state at ${iso}`);
  assert.match(value.nextWindow, nextIncludes, `${market} next window at ${iso}`);
}

// Fixed Beijing clock: boundaries, US cross-midnight, weekend, and dates on
// both sides of US DST. DST must not shift the user-confirmed 21:30–04:00 clock.
assertClock("2026-08-24T01:29:00.000Z", "cn", "closed", /08-24 09:30/u);
assertClock("2026-08-24T01:30:00.000Z", "cn", "open", /08-24 15:00/u);
assertClock("2026-08-24T06:59:59.000Z", "cn", "open", /08-24 15:00/u);
assertClock("2026-08-24T07:00:00.000Z", "cn", "closed", /08-25 09:30/u);
assertClock("2026-08-22T02:00:00.000Z", "cn", "closed", /08-24 09:30/u);

assertClock("2026-08-24T13:29:00.000Z", "us", "closed", /08-24 21:30/u);
assertClock("2026-08-24T13:30:00.000Z", "us", "open", /08-25 04:00/u);
assertClock("2026-08-24T19:59:59.000Z", "us", "open", /08-25 04:00/u);
assertClock("2026-08-24T20:00:00.000Z", "us", "closed", /08-25 21:30/u);
assertClock("2026-08-21T18:00:00.000Z", "us", "open", /08-22 04:00/u);
assertClock("2026-08-21T20:00:00.000Z", "us", "closed", /08-24 21:30/u);
assertClock("2026-03-09T13:30:00.000Z", "us", "open", /03-10 04:00/u);
assertClock("2026-12-07T13:30:00.000Z", "us", "open", /12-08 04:00/u);

// The reminder plan is two independently identifiable Host jobs. Empty markets
// do not produce a task; prompts contain only their own symbols and the existing
// fetch/watch engine contract.
{
  const plans = buildDeskAutomations([
    { id: "cn-1", symbol: "SH600519", rule: { type: "price-below", price: 1200 } },
    { id: "us-1", symbol: "AAPL", rule: { type: "rsi-oversold", threshold: 30 } },
  ]);
  assert.deepEqual(plans.map((item) => item.market), ["cn", "us"]);
  assert.deepEqual(plans.map((item) => item.name), [
    "投资工作台 · A股窗口",
    "投资工作台 · 美股开盘后",
  ]);
  assert.deepEqual(plans.map((item) => item.schedule), [
    "10 10,15 * * 1-5",
    "35 22 * * 1-5",
  ]);
  for (const plan of plans) {
    assert.equal(plan.timezone, "Asia/Shanghai");
    assert.match(plan.prompt, /fetch-market-data\.mjs/u);
    assert.doesNotMatch(plan.prompt, /<panel>/u, "Host does not expand panel path templates");
    assert.match(
      plan.prompt,
      /quant-lab:project-runtime[\s\S]*app\/tools\/fetch-market-data\.mjs/u,
      "automation must resolve the project-selected package through its Skill",
    );
    assert.match(
      plan.prompt,
      /bundled-fetch-tool-not-found[\s\S]*unavailable[\s\S]*禁止.*估算/u,
      "a missing bundled tool must degrade honestly",
    );
    assert.match(plan.prompt, /evaluateWatchItem/u);
    assert.match(plan.prompt, /rankWatchResults/u);
    assert.match(plan.prompt, /所有数值.*CSV.*引擎/u);
    assert.match(plan.prompt, /禁止估算/u);
    assert.match(plan.prompt, /不构成投资建议/u);
    assert.match(plan.prompt, /只在.*触发.*通知/u);
  }
  assert.match(plans[0].prompt, /SH600519/u);
  assert.doesNotMatch(plans[0].prompt, /AAPL/u);
  assert.match(plans[1].prompt, /AAPL/u);
  assert.doesNotMatch(plans[1].prompt, /SH600519/u);
  assert.deepEqual(
    buildDeskAutomations([{ symbol: "AAPL", rule: { type: "price-below", price: 90 } }])
      .map((item) => item.market),
    ["us"],
  );
}


// --- Round 13: watch-hit freshness and the P0 warning/unavailable split ------
// A P0 *warning* means verified portfolio data is wrong or inconsistent and
// must win. A P0 *unavailable* means a dependency could not be checked (e.g. the
// dedicated quote feed is not integrated yet); it must not permanently bury a
// fresh watch hit whose own CSV evidence is available.
const NOW = "2026-08-24T13:30:00.000Z"; // Monday 21:30 Beijing
function freshHit(overrides = {}) {
  return {
    id: "watch-fresh",
    symbol: "SH600519",
    rule: "price-below",
    triggered: true,
    close: 1100,
    asOf: "2026-08-21", // Friday: the last regular window before Monday
    threshold: { type: "price-below", price: 1200 },
    source: "data/market/SH600519.csv",
    availableAt: "2026-08-21",
    checkedAt: "2026-08-21T07:10:00.000Z",
    stale: false,
    provisional: false,
    ...overrides,
  };
}
const quoteFeedMissing = rule("stale-quotes", "P0", "unavailable", {
  actual: null,
  threshold: { withinMarketFreshnessWindow: true },
  source: "data/quotes/latest.json",
  availableAt: null,
  stale: false,
  provisional: false,
  unavailable: { reason: "quote-data-unavailable", reasons: ["quote-data-unavailable"] },
});
{
  const withUnavailable = buildTodayModel(
    input({ now: NOW, portfolio: { rules: [quoteFeedMissing, cleanRules[1]] }, watchResults: [freshHit()] }),
  );
  assert.equal(withUnavailable.primaryAction.id, "view-trigger", "P0 unavailable must not bury a fresh hit");
  assert.equal(withUnavailable.primaryAction.evidence.id, "watch-fresh");
  assert.equal(withUnavailable.primaryAction.evidence.stale, false);
  // The blocked P0 remains explicit in the data summary, never hidden.
  const dataSummary = withUnavailable.summaries.find((item) => item.id === "data");
  assert.equal(dataSummary.state, "attention");
  assert.match(String(dataSummary.value), /P0/u);

  const warningWins = buildTodayModel(
    input({
      now: NOW,
      portfolio: { rules: [quoteFeedMissing, rule("missing-raw-data", "P0", "warning")] },
      watchResults: [freshHit()],
    }),
  );
  assert.equal(warningWins.primaryAction.id, "sync-data");
  assert.equal(warningWins.primaryAction.evidence.id, "missing-raw-data");

  const noHit = buildTodayModel(input({ now: NOW, portfolio: { rules: [quoteFeedMissing] } }));
  assert.equal(noHit.primaryAction.id, "sync-data", "without a fresh hit the P0 unavailable still leads");
  assert.equal(noHit.primaryAction.evidence.id, "stale-quotes");
  assert.equal(noHit.primaryAction.evidence.actual, null);
}

// Expiry: a persisted hit whose bar is older than the last regular window is
// stale evidence. It stays visible in the watch summary (flagged stale) but
// cannot be today's trigger; a P0 unavailable then leads, and with no P0 the
// honest action is to re-check the watchlist.
{
  const staleHit = freshHit({ id: "watch-stale", asOf: "2026-08-20", availableAt: "2026-08-20" });
  const model = buildTodayModel(input({ now: NOW, watchResults: [staleHit] }));
  assert.equal(model.primaryAction.id, "view-watch");
  const watchSummary = model.summaries.find((item) => item.id === "watch");
  assert.equal(watchSummary.evidence.stale, true);
  assert.match(String(watchSummary.value), /1 触发/u);
  assert.match(String(watchSummary.value), /过期/u);
  const withP0 = buildTodayModel(
    input({ now: NOW, portfolio: { rules: [quoteFeedMissing] }, watchResults: [staleHit] }),
  );
  assert.equal(withP0.primaryAction.id, "sync-data");

  const fresh = buildTodayModel(input({ now: NOW, watchResults: [freshHit()] }));
  assert.equal(fresh.primaryAction.id, "view-trigger");
  // Saturday morning still treats Friday's bar as fresh; Monday treats Thursday's as stale.
  const saturday = buildTodayModel(
    input({ now: "2026-08-22T01:00:00.000Z", watchResults: [freshHit()] }),
  );
  assert.equal(saturday.primaryAction.id, "view-trigger");
  // A result already flagged stale by its sidecar is never a fresh trigger.
  const flagged = buildTodayModel(input({ now: NOW, watchResults: [freshHit({ stale: true })] }));
  assert.equal(flagged.primaryAction.id, "view-watch");
  // Errors never count as triggers.
  const errored = buildTodayModel(
    input({ now: NOW, watchResults: [freshHit({ error: "缺少文件" })] }),
  );
  assert.notEqual(errored.primaryAction.id, "view-trigger");
}

// The fixed Beijing clock is a display/automation convention only. It must not
// leak into the portfolio bar `availableAt` contract, which stays New York
// close based (EDT and EST differ by an hour) and lives in market-contract.
{
  assert.equal(observationAvailableAt({ market: "us", observationDate: "2026-03-09" }), "2026-03-09T20:00:00.000Z");
  assert.equal(observationAvailableAt({ market: "us", observationDate: "2026-12-07" }), "2026-12-07T21:00:00.000Z");
  assert.equal(observationAvailableAt({ market: "cn", observationDate: "2026-08-24" }), "2026-08-24T07:00:00.000Z");
  const clock = marketStatusAt(new Date(NOW));
  assert.doesNotMatch(JSON.stringify(clock), /availableAt|checkpoint/u, "clock output must not carry bar fields");
  const todaySource = await readFile(
    join(repositoryRoot, "apps", "quant-lab", "app", "today-model.mjs"),
    "utf8",
  );
  assert.doesNotMatch(todaySource, /market-contract|America\/New_York|availableAt\s*[:=]\s*windowText/u);
  const contractSource = await readFile(
    join(repositoryRoot, "apps", "quant-lab", "app", "market-contract.mjs"),
    "utf8",
  );
  assert.doesNotMatch(contractSource, /today-model|21:30|BEIJING/u);
}

// Weekend / Monday boundaries of the cross-midnight US window.
assertClock("2026-08-21T19:59:00.000Z", "us", "open", /08-22 04:00/u); // Sat 03:59 Beijing
assertClock("2026-08-21T20:00:00.000Z", "us", "closed", /08-24 21:30/u); // Sat 04:00 Beijing
assertClock("2026-08-22T19:59:00.000Z", "us", "closed", /08-24 21:30/u); // Sun 03:59 Beijing: no Saturday session
assertClock("2026-08-23T10:00:00.000Z", "us", "closed", /08-24 21:30/u); // Sunday
assertClock("2026-08-23T19:00:00.000Z", "us", "closed", /08-24 21:30/u); // Mon 03:00 Beijing
assertClock("2026-08-21T07:00:00.000Z", "cn", "closed", /08-24 09:30/u); // Fri 15:00 → Monday

// --- Round 13: automation prompt contract ---------------------------------
// 100 entries is the watchlist cap; long ids plus full strategy snapshots push
// the compact rule JSON past the Host's 20000-character prompt limit.
function oversizedWatchlist() {
  const items = Array.from({ length: 100 }, (_, index) => ({
    id: `cn-${index}-${"x".repeat(96)}`,
    symbol: `SZ${String(300000 + index)}`,
    rule: { type: "signal-entry" },
    strategy: { type: "rsi-reversion", period: 14, oversold: 30, overbought: 70, stop: 0.08, holdDays: 20 },
  }));
  assert(JSON.stringify(items).length > HOST_AUTOMATION_LIMITS.prompt, "fixture must exceed the Host limit");
  return items;
}
{
  const signalItem = {
    id: "cn-signal",
    symbol: "SZ000002",
    rule: { type: "signal-entry" },
    strategy: { type: "sma-cross", fast: 17, slow: 61 },
  };
  const [plan] = buildDeskAutomations([signalItem]);
  assert.equal(plan.market, "cn");
  assert.equal(plan.schedule, "10 10,15 * * 1-5", "two A-share points: after open and after close");
  assert.equal(plan.error, undefined);
  assert.match(plan.prompt, /"fast":\s*17/u, "signal-entry needs its strategy snapshot to be evaluable");
  assert.doesNotMatch(plan.prompt, /--out-dir data\/market --force/u, "the job must never overwrite a user's adjustment basis");
  assert.match(plan.prompt, /禁止使用 `--force`/u);
  assert.match(plan.prompt, /meta\.json[\s\S]*--adjust/u, "reuse the existing sidecar adjust basis");
  assert.match(plan.prompt, /test -r/u, "the resolved program must be readable before execution");
  assert.doesNotMatch(plan.prompt, /installed\.json|\$HOME\/\.code-shell/u);
  assert.match(plan.prompt, /同一.*rule id[\s\S]*asOf[\s\S]*不重复通知/u, "multi-point runs must not re-notify an unchanged hit");
  assert.match(plan.prompt, /provisional/u);
  assert(plan.prompt.length <= HOST_AUTOMATION_LIMITS.prompt);

  // Host rejects prompts over 20000 characters. The plan must fail honestly
  // per market instead of letting the Host throw on a stale stub assumption.
  const many = oversizedWatchlist();
  const [tooLong] = buildDeskAutomations(many);
  assert.equal(tooLong.market, "cn");
  assert.equal(tooLong.error, "prompt-too-long");
  assert.equal(tooLong.prompt, null);
  assert.equal(HOST_AUTOMATION_LIMITS.prompt, 20000);
  assert.equal(HOST_AUTOMATION_LIMITS.name, 120);
}

// --- Round 13: controller with a fake DOM and a Host-faithful fake ---------
function fakeNode() {
  return { textContent: "", dataset: {}, hidden: false, disabled: false, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
}
function fakeElements() {
  const market = () => ({ root: fakeNode(), time: fakeNode(), status: fakeNode(), button: fakeNode() });
  return {
    master: fakeNode(),
    summary: fakeNode(),
    markets: { cn: market(), us: market() },
    legacy: fakeNode(),
    legacyState: fakeNode(),
    legacyRemove: fakeNode(),
  };
}
function fakeHost(seed = []) {
  const automations = structuredClone(seed);
  const calls = [];
  return {
    automations,
    calls,
    async call(method, params) {
      calls.push({ method, params });
      if (method === "automations.list") return { automations: structuredClone(automations) };
      if (method === "automations.create") {
        if (!params.name || params.name.length > 120) throw new Error("Panel App automation requires a valid name and schedule");
        if (!params.prompt || params.prompt.length > 20000) throw new Error("Panel App automation prompt must be between 1 and 20000 characters");
        const created = { id: `auto-${automations.length + 1}`, permissionLevel: "full", resumeSessionId: "s", ...params };
        automations.push(created);
        return created;
      }
      if (method === "automations.update") {
        const index = automations.findIndex((item) => item.id === params.id);
        if (index < 0) throw new Error("Panel App automation is not available in this project task");
        const { id: _id, ...patch } = params;
        if (!Object.keys(patch).length) throw new Error("Panel App automation update is empty");
        automations[index] = { ...automations[index], ...patch };
        return automations[index];
      }
      if (method === "automations.delete") {
        const index = automations.findIndex((item) => item.id === params.id);
        if (index < 0) throw new Error("Panel App automation is not available in this project task");
        automations.splice(index, 1);
        return { ok: true };
      }
      throw new Error(`unexpected ${method}`);
    },
  };
}
{
  // Orphan: an active A-share task whose symbols were all removed must stay
  // visible and closable; it must not read as "no task".
  const [cnPlan] = buildDeskAutomations([{ id: "a", symbol: "SH600519", rule: { type: "price-below", price: 1 } }]);
  const host = fakeHost([
    { id: "orphan", name: cnPlan.name, schedule: cnPlan.schedule, timezone: cnPlan.timezone, prompt: cnPlan.prompt },
  ]);
  const elements = fakeElements();
  let watchlist = [];
  const controller = createAlertsController({
    hostCall: host.call,
    elements,
    watchlist: () => watchlist,
  });
  await controller.load();
  assert.equal(elements.markets.cn.root.dataset.state, "orphan");
  assert.match(elements.markets.cn.status.textContent, /已无关注标的/u);
  assert.equal(elements.markets.cn.button.disabled, false);
  assert.equal(elements.markets.cn.button.textContent, "关闭");
  await controller.toggleMarket("cn");
  assert.equal(host.automations.length, 0, "orphan task must be deletable");

  // Drift: the watchlist changed after the task was created. The status must
  // say so and the button must update the existing task in place (no duplicate).
  watchlist = [{ id: "a", symbol: "SH600519", rule: { type: "price-below", price: 1 } }];
  await controller.toggleMarket("cn");
  assert.equal(host.automations.length, 1);
  watchlist = [
    ...watchlist,
    { id: "b", symbol: "SZ000002", rule: { type: "rsi-oversold", period: 14, threshold: 30 } },
  ];
  await controller.load();
  assert.equal(elements.markets.cn.root.dataset.state, "drift");
  assert.match(elements.markets.cn.status.textContent, /关注列表已变化/u);
  assert.equal(elements.markets.cn.button.textContent, "更新");
  await controller.toggleMarket("cn");
  assert.equal(host.automations.length, 1, "update must not create a second task");
  assert.match(host.automations[0].prompt, /SZ000002/u);
  assert.equal(host.calls.filter((call) => call.method === "automations.update").length, 1);
  assert.equal(elements.markets.cn.root.dataset.state, "active");
}
{
  // A transient list failure must not turn the retry button into a destructive
  // toggle. Once the authoritative state can be read, the existing task stays.
  const items = [{ id: "a", symbol: "SH600519", rule: { type: "price-below", price: 1 } }];
  const [plan] = buildDeskAutomations(items);
  const host = fakeHost([
    { id: "existing", name: plan.name, schedule: plan.schedule, timezone: plan.timezone, prompt: plan.prompt },
  ]);
  const originalCall = host.call;
  let failNextList = true;
  const elements = fakeElements();
  const controller = createAlertsController({
    hostCall: async (method, params) => {
      if (method === "automations.list" && failNextList) {
        failNextList = false;
        throw new Error("temporary list failure");
      }
      return originalCall(method, params);
    },
    elements,
    watchlist: () => items,
  });
  await controller.load();
  assert.equal(elements.markets.cn.button.textContent, "重试读取");
  await controller.toggleMarket("cn");
  assert.equal(host.automations.length, 1, "重试读取不能关闭已经存在的提醒任务");
  assert.equal(host.calls.filter((call) => call.method === "automations.delete").length, 0);
  assert.equal(elements.markets.cn.root.dataset.state, "active");
}
{
  // Over-limit prompt: no Host call is attempted and the market shows the reason.
  const many = oversizedWatchlist();
  const host = fakeHost();
  const elements = fakeElements();
  const controller = createAlertsController({ hostCall: host.call, elements, watchlist: () => many });
  await controller.load();
  assert.equal(elements.markets.cn.root.dataset.state, "error");
  assert.match(elements.markets.cn.status.textContent, /prompt-too-long/u);
  assert.equal(elements.markets.cn.button.disabled, true);
  await controller.toggleAll();
  assert.equal(host.calls.filter((call) => call.method === "automations.create").length, 0);
}
{
  // Legacy removal lists the exact tasks that will be deleted, only matches the
  // old single-task naming, and never touches an unrelated user task.
  const items = [
    { id: "a", symbol: "SH600519", rule: { type: "price-below", price: 1 } },
    { id: "b", symbol: "AAPL", rule: { type: "price-below", price: 1 } },
  ];
  const host = fakeHost([
    { id: "legacy-1", name: "Quant Lab · 每日盯盘（2 个标的）", schedule: "30 18 * * 1-5", prompt: "old", timezone: "Asia/Shanghai" },
    { id: "user-1", name: "Quant Lab · 每日盯盘笔记同步", schedule: "0 9 * * *", prompt: "mine", timezone: "Asia/Shanghai" },
  ]);
  const elements = fakeElements();
  const controller = createAlertsController({ hostCall: host.call, elements, watchlist: () => items });
  await controller.load();
  assert.equal(controller.state.legacy.length, 1, "only the exact legacy naming pattern is a migration candidate");
  await controller.toggleAll();
  assert.match(elements.legacyState.textContent, /Quant Lab · 每日盯盘（2 个标的）/u, "the user must see which task will be removed");
  await controller.removeLegacy();
  assert.deepEqual(host.automations.map((item) => item.name).sort(), [
    "Quant Lab · 每日盯盘笔记同步",
    "投资工作台 · A股窗口",
    "投资工作台 · 美股开盘后",
  ].sort());
}

console.log("Quant Lab today model tests passed");
