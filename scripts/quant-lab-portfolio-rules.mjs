/* Pure P0-P3 portfolio-rule contract (Investment Desk Round 10). */
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rulesPath = join(repositoryRoot, "apps/quant-lab/app/portfolio-rules.mjs");
const {
  PORTFOLIO_RULE_THRESHOLDS,
  evaluatePortfolioRules,
} = await import(pathToFileURL(rulesPath).href);

const clone = (value) => structuredClone(value);

const baseAnalysis = {
  summary: {
    twr: { cumulative: 0.12, annualized: { value: 0.08 } },
    xirr: { value: 0.1 },
    hhi: {
      raw: 0.38,
      normalized: 0.1,
      count: 3,
      weights: { alpha: 0.5, beta: 0.3, flat: 0.2 },
    },
    exposure: {
      byInstrument: [
        { instrumentId: "alpha", symbol: "ALPHA", weight: 0.5, valueBase: "500.00" },
        { instrumentId: "beta", symbol: "BETA", weight: 0.3, valueBase: "300.00" },
        { instrumentId: "flat", symbol: "FLAT", weight: 0.2, valueBase: "200.00" },
      ],
      byAccount: [
        { accountId: "acct-a", weight: 0.7, valueBase: "700.00" },
        { accountId: "acct-b", weight: 0.3, valueBase: "300.00" },
      ],
    },
  },
  series: [
    { date: "2025-08-26", provisional: false },
    { date: "2026-08-26", provisional: false },
  ],
  rules: [],
};

const baseContext = {
  asOf: "2026-08-26T08:30:00.000Z",
  inputFingerprint: "fnv1a32:1234abcd",
  quotes: {
    status: "available",
    items: [
      {
        symbol: "ALPHA",
        account: "acct-a",
        status: "available",
        stale: false,
        ageCalendarDays: 10,
        source: "fixture-quotes",
        availableAt: "2026-08-26T08:00:00.000Z",
      },
    ],
  },
  ledger: {
    status: "verified",
    currentFingerprint: "fnv1a32:1234abcd",
    holdingsFingerprint: "fnv1a32:1234abcd",
    mismatchObserved: false,
  },
  raw: {
    status: "available",
    items: [
      { symbol: "ALPHA", account: "acct-a", status: "available", source: "raw-a", availableAt: "2026-08-26T07:00:00.000Z", stale: false, provisional: false },
      { symbol: "BETA", account: "acct-b", status: "available", source: "raw-b", availableAt: "2026-08-26T07:00:00.000Z", stale: false, provisional: false },
    ],
  },
  fxVerification: {
    status: "available",
    yahoo: 7,
    ecb: 7,
    date: "2026-08-25",
    source: "yahoo-chart + ecb-exr",
    availableAt: "2026-08-26T00:00:00.000Z",
  },
  corporateActionAudit: { status: "available" },
  positions: {
    status: "available",
    items: [
      { symbol: "ALPHA", account: "acct-a", pnlBase: "100.00", source: "portfolio-engine", availableAt: "2026-08-26T08:30:00.000Z", stale: false, provisional: false },
      { symbol: "BETA", account: "acct-b", pnlBase: "-40.00", source: "portfolio-engine", availableAt: "2026-08-26T08:30:00.000Z", stale: false, provisional: false },
      { symbol: "FLAT", account: "acct-a", pnlBase: "0.00", source: "portfolio-engine", availableAt: "2026-08-26T08:30:00.000Z", stale: false, provisional: false },
    ],
  },
  decisions: {
    status: "available",
    counts: { met: 2, partial: 1, missed: 1, undecidable: 1, notDue: 1, reviewDue: 1 },
    source: "portfolio/journal.json",
    availableAt: "2026-08-26T08:30:00.000Z",
  },
  alerts: {
    status: "available",
    items: [],
    source: "panel-storage/watchlist",
    availableAt: "2026-08-26T08:30:00.000Z",
  },
};

function evaluate(analysisMutator, contextMutator) {
  const analysis = clone(baseAnalysis);
  const context = clone(baseContext);
  analysisMutator?.(analysis);
  contextMutator?.(context);
  return evaluatePortfolioRules(analysis, context);
}

function byId(results, id) {
  const result = results.find((entry) => entry.id === id);
  assert(result, `missing rule ${id}`);
  return result;
}

function assertUnavailable(result, reason) {
  assert.equal(result.status, "unavailable", result.id);
  assert.equal(result.unavailable?.reason, reason, result.id);
  assert.equal(result.actual, null, `${result.id} must not invent zero`);
}

const expectedIds = [
  "stale-quotes",
  "ledger-fingerprint-mismatch",
  "missing-raw-data",
  "suspected-missing-corporate-action",
  "fx-source-divergence",
  "provisional-checkpoints",
  "concentration-band",
  "position-weight-extremes",
  "pnl-contributors",
  "return-method-gap",
  "decision-outcomes",
  "review-due",
  "alerts-triggered",
];

const baseline = evaluate();
assert.deepEqual([...baseline].map((entry) => entry.id).sort(), [...expectedIds].sort());
assert.equal(baseline.length, 13);
for (const result of baseline) {
  assert(["P0", "P1", "P2", "P3"].includes(result.priority), result.id);
  assert(["backtestable", "historically-recomputable", "static-audit"].includes(result.verificationLevel), result.id);
  assert(["positive", "neutral", "warning", "unavailable"].includes(result.status), result.id);
  assert.equal(typeof result.condition, "string", result.id);
  assert(Object.prototype.hasOwnProperty.call(result, "actual"), result.id);
  assert(Object.prototype.hasOwnProperty.call(result, "threshold"), result.id);
  assert.equal(result.asOf, baseContext.asOf, result.id);
  assert.equal(result.inputFingerprint, baseContext.inputFingerprint, result.id);
  for (const field of ["source", "availableAt", "stale", "provisional"]) {
    assert(Object.prototype.hasOwnProperty.call(result.data, field), `${result.id}.${field}`);
  }
}

// Thresholds are a recursively frozen, exported contract rather than UI literals.
assert(Object.isFrozen(PORTFOLIO_RULE_THRESHOLDS));
assert(Object.isFrozen(PORTFOLIO_RULE_THRESHOLDS["concentration-band"]));
assert.equal(PORTFOLIO_RULE_THRESHOLDS["suspected-missing-corporate-action"].absoluteDailyChange, 0.35);
assert.equal(PORTFOLIO_RULE_THRESHOLDS["fx-source-divergence"].relativeDifference, 0.01);
assert.throws(() => {
  PORTFOLIO_RULE_THRESHOLDS["fx-source-divergence"].relativeDifference = 2;
}, TypeError);

// P0 pairs: non-trigger / trigger / unavailable.
assert.equal(byId(baseline, "stale-quotes").status, "positive");
assert.equal(byId(evaluate(null, (context) => { context.quotes.items[0].stale = true; }), "stale-quotes").status, "warning");
assertUnavailable(byId(evaluate(null, (context) => { context.quotes = { status: "unavailable", reason: "stale", items: [] }; }), "stale-quotes"), "stale");

assert.equal(byId(baseline, "ledger-fingerprint-mismatch").status, "positive");
assert.equal(byId(evaluate(null, (context) => { context.ledger.holdingsFingerprint = "fnv1a32:ffffffff"; }), "ledger-fingerprint-mismatch").status, "warning");
assertUnavailable(byId(evaluate(null, (context) => { context.ledger = { status: "unavailable", reason: "ledger-state-unavailable" }; }), "ledger-fingerprint-mismatch"), "ledger-state-unavailable");

assert.equal(byId(baseline, "missing-raw-data").status, "positive");
assert.equal(byId(evaluate(null, (context) => { context.raw.items[0].status = "unavailable"; context.raw.items[0].reason = "missing-raw-data"; }), "missing-raw-data").status, "warning");
assert.equal(byId(evaluate(null, (context) => { context.raw.items[0].ageCalendarDays = 10; }), "missing-raw-data").status, "positive", "raw age 10 is available");
const agedRaw = byId(evaluate(null, (context) => { context.raw.items[0].ageCalendarDays = 11; }), "missing-raw-data");
assert.equal(agedRaw.status, "warning", "raw age 11 is over the inclusive boundary");
assert.equal(agedRaw.actual.items[0].reason, "price-age-exceeded");
assertUnavailable(byId(evaluate(null, (context) => { context.raw = { status: "unavailable", reason: "raw-inventory-unavailable", items: [] }; }), "missing-raw-data"), "raw-inventory-unavailable");

assert.equal(byId(baseline, "suspected-missing-corporate-action").status, "positive");
const jumpBoundary = byId(evaluate((analysis) => {
  analysis.rules.push({ id: "suspected-missing-corporate-action", values: [{ instrumentId: "alpha", symbol: "ALPHA", account: "acct-a", change: -0.35, date: "2026-08-26" }] });
}), "suspected-missing-corporate-action");
assert.equal(jumpBoundary.status, "warning", "absolute 35% is inclusive");
assertUnavailable(byId(evaluate(null, (context) => { context.corporateActionAudit = { status: "unavailable", reason: "audit-data-unavailable" }; }), "suspected-missing-corporate-action"), "audit-data-unavailable");

assert.equal(byId(baseline, "fx-source-divergence").status, "positive");
assert.notEqual(byId(evaluate(null, (context) => { context.fxVerification.yahoo = 7.07; }), "fx-source-divergence").status, "warning", "exactly 1% does not trigger");
assert.equal(byId(evaluate(null, (context) => { context.fxVerification.yahoo = 7.071; }), "fx-source-divergence").status, "warning", ">1% triggers");
assert.equal(byId(evaluate(null, (context) => { context.fxVerification = { status: "not-available" }; }), "fx-source-divergence").status, "neutral", "missing ECB verification is not an error");
assertUnavailable(byId(evaluate(null, (context) => { context.fxVerification = { status: "error", reason: "fx-verification-invalid" }; }), "fx-source-divergence"), "fx-verification-invalid");

assert.equal(byId(baseline, "provisional-checkpoints").status, "positive");
assert.equal(byId(evaluate((analysis) => { analysis.series[1].provisional = true; }), "provisional-checkpoints").status, "warning");
assertUnavailable(byId(evaluate((analysis) => { analysis.series = null; }), "provisional-checkpoints"), "series-unavailable");

// P1 pairs and threshold equality boundaries.
assert.equal(byId(baseline, "concentration-band").status, "neutral");
// Round 11: the 0.25/0.50 bins are a product heuristic (PRD §8.4/§10 say they
// are descriptive and carry no good/bad label), so the rule is always neutral and
// the threshold contract states its basis instead of implying an industry standard.
assert.equal(PORTFOLIO_RULE_THRESHOLDS["concentration-band"].basis, "product-heuristic");
const higherBand = byId(evaluate((analysis) => { analysis.summary.hhi.normalized = 0.5; }), "concentration-band");
assert.equal(higherBand.actual.band, "higher", "higher band starts at equality");
assert.equal(higherBand.status, "neutral", "descriptive bins must not be rendered as a warning");
assert.equal(byId(evaluate((analysis) => { analysis.summary.hhi.normalized = 1; analysis.summary.hhi.count = 1; }), "concentration-band").actual.band, "higher", "n=1 is fully concentrated");
assert.equal(byId(evaluate((analysis) => { analysis.summary.hhi.normalized = 0; }), "concentration-band").actual.band, "lower", "equal weights are fully diversified");
assert.equal(byId(evaluate((analysis) => { analysis.summary.hhi.normalized = 0.25; }), "concentration-band").actual.band, "middle", "middle band starts at equality");
assert.equal(byId(evaluate((analysis) => { analysis.summary.hhi.normalized = 0.2499999; }), "concentration-band").actual.band, "lower", "just below 0.25 stays lower");
assert.equal(byId(evaluate((analysis) => { analysis.summary.hhi.normalized = 0.4999999; }), "concentration-band").actual.band, "middle", "just below 0.50 stays middle");
assertUnavailable(byId(evaluate((analysis) => { analysis.summary.hhi = { unavailable: { code: "missing-raw-data" } }; }), "concentration-band"), "missing-raw-data");

assert.equal(byId(baseline, "position-weight-extremes").status, "neutral");
const extrema = byId(evaluate(), "position-weight-extremes").actual;
assert.equal(extrema.maxPosition.symbol, "ALPHA");
assert.equal(extrema.maxAccount.accountId, "acct-a");
assertUnavailable(byId(evaluate((analysis) => { analysis.summary.exposure = { unavailable: { code: "raw-contract-conflict" } }; }), "position-weight-extremes"), "raw-contract-conflict");

// P2 pairs. Positive, negative and flat use the same sorted item shape.
const pnl = byId(baseline, "pnl-contributors");
assert.equal(pnl.status, "neutral");
assert.deepEqual(pnl.actual.items.map((item) => [item.symbol, item.direction, Object.keys(item).sort()]), [
  ["ALPHA", "positive", Object.keys(pnl.actual.items[0]).sort()],
  ["BETA", "negative", Object.keys(pnl.actual.items[1]).sort()],
  ["FLAT", "neutral", Object.keys(pnl.actual.items[2]).sort()],
]);
assert.deepEqual(pnl.actual.totals, { positive: "100.00", negative: "-40.00", neutral: "0.00" });
// Round 11: an empty book has no contributors; "0.00" totals would be the pseudo
// number PRD §8.6 forbids, so the rule is unavailable(no-positions) instead.
assertUnavailable(byId(evaluate(null, (context) => { context.positions.items = []; }), "pnl-contributors"), "no-positions");
assertUnavailable(byId(evaluate(null, (context) => { context.positions.items[0].pnlBase = null; context.positions.items[0].unavailableReason = "missing-fx"; }), "pnl-contributors"), "missing-fx");

assert.equal(byId(baseline, "return-method-gap").status, "neutral");
assert.equal(byId(baseline, "return-method-gap").actual.gap, 0.02);
assert.equal(byId(evaluate((analysis) => { analysis.summary.xirr.value = 0.08; }), "return-method-gap").actual.gap, 0);
assertUnavailable(byId(evaluate((analysis) => { analysis.summary.twr.annualized = { unavailable: { code: "short-period", days: 364 } }; }), "return-method-gap"), "insufficient-history");

assert.equal(byId(baseline, "decision-outcomes").status, "neutral");
assert.equal(byId(evaluate(null, (context) => { context.decisions.counts = { met: 0, partial: 0, missed: 0, undecidable: 0, notDue: 0, reviewDue: 0 }; }), "decision-outcomes").actual.total, 0);
assertUnavailable(byId(evaluate(null, (context) => { context.decisions = { status: "unavailable", reason: "decision-data-unavailable" }; }), "decision-outcomes"), "decision-data-unavailable");

// P3 pairs.
assert.equal(byId(baseline, "review-due").status, "warning");
assert.equal(byId(evaluate(null, (context) => { context.decisions.counts.reviewDue = 0; }), "review-due").status, "positive");
assertUnavailable(byId(evaluate(null, (context) => { context.decisions = { status: "unavailable", reason: "decision-data-unavailable" }; }), "review-due"), "decision-data-unavailable");

assert.equal(byId(baseline, "alerts-triggered").status, "positive");
assert.equal(byId(evaluate(null, (context) => { context.alerts.items = [{ symbol: "ALPHA", account: "acct-a", triggered: true }]; }), "alerts-triggered").status, "warning");
assertUnavailable(byId(evaluate(null, (context) => { context.alerts = { status: "unavailable", reason: "alert-data-unavailable" }; }), "alerts-triggered"), "alert-data-unavailable");

// Every currently known unavailable reason is localized. Static ledger/raw
// audits remain evaluable and no branch throws or fills a missing number with 0.
for (const [reason, mutateAnalysis, mutateContext, affectedId] of [
  ["missing-raw-data", (analysis) => { analysis.summary.hhi = { unavailable: { code: "missing-raw-data" } }; }, null, "concentration-band"],
  ["missing-fx", null, (context) => { context.positions.items[0].pnlBase = null; context.positions.items[0].unavailableReason = "missing-fx"; }, "pnl-contributors"],
  ["stale", null, (context) => { context.quotes = { status: "unavailable", reason: "stale", items: [] }; }, "stale-quotes"],
  ["price-age-exceeded", (analysis) => { analysis.summary.hhi = { unavailable: { code: "price-age-exceeded", details: { ageCalendarDays: 11 } } }; }, null, "concentration-band"],
  ["fx-age-exceeded", (analysis) => { analysis.summary.hhi = { unavailable: { code: "fx-age-exceeded", details: { ageCalendarDays: 11 } } }; }, null, "concentration-band"],
  ["raw-contract-conflict", (analysis) => { analysis.summary.exposure = { unavailable: { code: "raw-contract-conflict" } }; }, null, "position-weight-extremes"],
  ["non-positive-equity", (analysis) => { analysis.summary.twr = { unavailable: { code: "non-positive-equity" } }; }, null, "return-method-gap"],
  ["insufficient-history", (analysis) => { analysis.summary.twr.annualized = { unavailable: { code: "insufficient-history" } }; }, null, "return-method-gap"],
  ["provisional", (analysis) => { analysis.series[1].provisional = true; }, null, "return-method-gap"],
]) {
  const results = evaluate(mutateAnalysis, mutateContext);
  assertUnavailable(byId(results, affectedId), reason);
  assert.equal(byId(results, "ledger-fingerprint-mismatch").status, "positive", `${reason}: unrelated static audit remains available`);
}

// Age 10 is allowed, age 11 is blocked by the portfolio analysis reason.
assert.equal(byId(baseline, "stale-quotes").status, "positive");
assertUnavailable(byId(evaluate((analysis) => { analysis.summary.hhi = { unavailable: { code: "price-age-exceeded", details: { ageCalendarDays: 11 } } }; }), "concentration-band"), "price-age-exceeded");

// Stable deterministic order: priority -> severity -> subject symbol/account -> id.
const scrambledAnalysis = clone(baseAnalysis);
scrambledAnalysis.rules = [
  { id: "suspected-missing-corporate-action", values: [
    { instrumentId: "beta", symbol: "BETA", account: "acct-b", change: -0.4, date: "2026-08-26" },
    { instrumentId: "alpha", symbol: "ALPHA", account: "acct-a", change: 0.4, date: "2026-08-26" },
  ] },
];
const once = evaluatePortfolioRules(scrambledAnalysis, clone(baseContext));
const twice = evaluatePortfolioRules(clone(scrambledAnalysis), clone(baseContext));
assert.deepEqual(once, twice);
const sortKeys = once.map((item) => [item.priorityRank, item.severityRank, item.sortSymbol, item.sortAccount, item.id]);
assert.deepEqual(sortKeys, [...sortKeys].sort((left, right) =>
  left[0] - right[0] || left[1] - right[1] || left[2].localeCompare(right[2]) || left[3].localeCompare(right[3]) || left[4].localeCompare(right[4])
));

const categories = baseline.reduce((counts, rule) => {
  counts[rule.verificationLevel] = (counts[rule.verificationLevel] ?? 0) + 1;
  return counts;
}, {});
assert.deepEqual(categories, {
  "static-audit": 6,
  "historically-recomputable": 7,
});
assert.equal(categories.backtestable ?? 0, 0, "portfolio static/history rules must not masquerade as strategy backtests");

// Round 11: when several dependencies are missing at once the primary reason is
// chosen by a frozen severity order (contract conflict > missing > age > fx >
// equity > history > provisional > stale), never by alphabetical accident, and
// every distinct reason is preserved in `unavailable.reasons`.
const multiRawContext = (context) => {
  context.raw.items[0] = { ...context.raw.items[0], status: "unavailable", reason: "missing-raw-data" };
  context.raw.items[1] = { ...context.raw.items[1], status: "unavailable", reason: "raw-contract-conflict" };
};
const multiRawAnalysis = (analysis) => {
  analysis.summary.hhi = { unavailable: { code: "missing-raw-data" } };
  analysis.summary.exposure = { unavailable: { code: "missing-raw-data" } };
};
const multiRaw = evaluate(multiRawAnalysis, multiRawContext);
const multiBand = byId(multiRaw, "concentration-band");
assertUnavailable(multiBand, "raw-contract-conflict");
assert.deepEqual(multiBand.unavailable.reasons, ["raw-contract-conflict", "missing-raw-data"]);
assert.deepEqual(byId(multiRaw, "position-weight-extremes").unavailable.reasons, ["raw-contract-conflict", "missing-raw-data"]);
assert.deepEqual(
  byId(multiRaw, "missing-raw-data").actual.items.map((item) => item.reason),
  ["missing-raw-data", "raw-contract-conflict"],
  "the P0 raw audit itself still lists every source with its own reason",
);
// Item order must not change the verdict.
const swappedRaw = evaluate(multiRawAnalysis, (context) => {
  multiRawContext(context);
  context.raw.items.reverse();
});
assert.deepEqual(byId(swappedRaw, "concentration-band").unavailable, multiBand.unavailable);

const multiPnl = byId(evaluate(null, (context) => {
  context.positions.items[0] = { ...context.positions.items[0], pnlBase: null, unavailableReason: "missing-fx" };
  context.positions.items[2] = { ...context.positions.items[2], pnlBase: null, unavailableReason: "raw-contract-conflict" };
}), "pnl-contributors");
assertUnavailable(multiPnl, "raw-contract-conflict");
assert.deepEqual(multiPnl.unavailable.reasons, ["raw-contract-conflict", "missing-fx"]);
assert.deepEqual(multiPnl.subjects.map((subject) => subject.symbol), ["ALPHA", "FLAT"], "every blocked position is a subject");

const multiReturn = byId(evaluate((analysis) => {
  analysis.series[1].provisional = true;
  analysis.summary.twr.annualized = { unavailable: { code: "short-period", days: 364 } };
}), "return-method-gap");
assertUnavailable(multiReturn, "insufficient-history");
assert.deepEqual(multiReturn.unavailable.reasons, ["insufficient-history", "provisional"]);
assert.equal(multiReturn.unavailable.upstreamCode, "short-period", "normalization keeps the engine code");
const equityAndProvisional = byId(evaluate((analysis) => {
  analysis.series[1].provisional = true;
  analysis.summary.twr = { unavailable: { code: "non-positive-equity" } };
}), "return-method-gap");
assertUnavailable(equityAndProvisional, "non-positive-equity");
assert.deepEqual(equityAndProvisional.unavailable.reasons, ["non-positive-equity", "provisional"]);

// Round 11: the corporate-action audit only covers positions whose raw source
// was readable. An unaudited position is not a clean bill of health.
const unauditedClean = byId(evaluate(null, (context) => {
  context.raw.items[1] = { ...context.raw.items[1], status: "unavailable", reason: "raw-contract-conflict" };
}), "suspected-missing-corporate-action");
assertUnavailable(unauditedClean, "raw-contract-conflict");
assert.deepEqual(unauditedClean.unavailable.details.unaudited, ["BETA"]);
const unauditedWithJump = byId(evaluate((analysis) => {
  analysis.rules.push({ id: "suspected-missing-corporate-action", values: [{ instrumentId: "alpha", symbol: "ALPHA", account: "acct-a", change: 0.5, date: "2026-08-26" }] });
}, (context) => {
  context.raw.items[1] = { ...context.raw.items[1], status: "unavailable", reason: "missing-raw-data" };
}), "suspected-missing-corporate-action");
assert.equal(unauditedWithJump.status, "warning", "found jumps are still reported");
assert.deepEqual(unauditedWithJump.actual.unaudited, [{ symbol: "BETA", reason: "missing-raw-data" }]);
assert(unauditedWithJump.limitations.some((line) => line.includes("BETA")), "unaudited symbols are stated as a limitation");

// Round 11: representative large sample. The rule layer is O(rules x positions)
// and must not re-walk history; the budget is deliberately loose to avoid a
// flaky millisecond threshold while still catching quadratic regressions.
const largeAnalysis = clone(baseAnalysis);
const largeContext = clone(baseContext);
const sampleSize = 5000;
largeAnalysis.summary.exposure.byInstrument = [];
largeContext.raw.items = [];
largeContext.positions.items = [];
for (let index = 0; index < sampleSize; index += 1) {
  const symbol = `SYM${String(index).padStart(5, "0")}`;
  const account = `acct-${index % 7}`;
  largeAnalysis.summary.exposure.byInstrument.push({ instrumentId: symbol.toLowerCase(), symbol, weight: 1 / sampleSize, valueBase: "1.00" });
  largeContext.raw.items.push({ symbol, account, status: "available", ageCalendarDays: index % 11, source: "raw", availableAt: "2026-08-26T07:00:00.000Z", stale: false, provisional: false });
  largeContext.positions.items.push({ symbol, account, pnlBase: `${index % 2 ? "-" : ""}${index}.${String(index % 100).padStart(2, "0")}`, source: "portfolio-engine", availableAt: "2026-08-26T08:30:00.000Z", stale: false, provisional: false });
}
const largeStarted = performance.now();
const largeResults = evaluatePortfolioRules(largeAnalysis, largeContext);
const largeElapsed = performance.now() - largeStarted;
assert.equal(largeResults.length, 13);
assert.equal(byId(largeResults, "pnl-contributors").actual.items.length, sampleSize);
assert.equal(byId(largeResults, "missing-raw-data").status, "positive");
assert(largeElapsed < 5000, `rule layer took ${largeElapsed.toFixed(0)}ms for ${sampleSize} positions`);

console.log("✓ Quant Lab portfolio P0-P3 pure-rule contract");
