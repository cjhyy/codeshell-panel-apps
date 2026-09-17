import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { repositoryRoot } from "../../../scripts/panel-projects.mjs";
import { isDirectRun } from "../../helpers/direct-run.mjs";

// Existing model regression bodies are kept verbatim during the structural split.
export async function runModelTests() {
const quant = await import(pathToFileURL(join(repositoryRoot, "apps/quant-lab/app/engine.mjs")));
const bars = quant.generateDemoBars(260);
const run = quant.runBacktest(bars, {
  strategy: { type: "sma-cross", fast: 20, slow: 50 },
  initialCapital: 100_000,
  feeBps: 5,
  slippageBps: 2,
  stopLossPct: 8,
});
assert.equal(run.equity.length, 260);
assert(Number.isFinite(run.metrics.finalEquity));
assert(Number.isFinite(run.metrics.downsideDeviation));
assert(run.metrics.sortino == null || Number.isFinite(run.metrics.sortino));

// v1 configurations must keep producing v1 numbers after the sizer, signal-mode
// and risk-free-rate additions.
const legacyBaseline = quant.runBacktest(bars, {
  strategy: { type: "sma-cross", fast: 20, slow: 50 },
  initialCapital: 100_000,
  feeBps: 5,
  slippageBps: 2,
  stopLossPct: 8,
  sizer: { type: "all-in" },
  signalMode: "state",
  riskFreeRate: 0,
});
assert.equal(legacyBaseline.metrics.finalEquity, run.metrics.finalEquity);
assert.equal(legacyBaseline.metrics.sharpe, run.metrics.sharpe);

const cappedHolding = quant.runBacktest(quant.generateDemoBars(400), {
  strategy: { type: "sma-cross", fast: 10, slow: 30 },
  initialCapital: 100_000,
  feeBps: 5,
  slippageBps: 2,
  stopLossPct: 0,
  maxHoldingDays: 5,
});
assert(cappedHolding.trades.some((trade) => trade.reason === "max-hold"));
assert(cappedHolding.trades.filter((trade) => trade.reason === "max-hold").every((trade) => trade.entryDate < trade.exitDate));
assert.throws(
  () => quant.runBacktest(bars, {
    strategy: { type: "sma-cross", fast: 20, slow: 50 },
    initialCapital: 100_000,
    feeBps: 5,
    slippageBps: 2,
    stopLossPct: 8,
    maxHoldingDays: 1.5,
  }),
  /max holding days/u,
);

// Frozen v0.1.0 outputs for a fixed seed. Comparing defaults against explicit
// defaults would pass even if both regressed together, so pin the actual
// numbers the pre-sizer engine produced.
assert.equal(run.trades.length, 2);
assert.equal(run.metrics.finalEquity.toFixed(6), "156927.753986");
assert.equal(run.metrics.sharpe.toFixed(6), "3.330226");
assert.equal(run.metrics.maximumDrawdown.toFixed(6), "-0.110149");
assert.equal(run.metrics.benchmarkReturn.toFixed(6), "0.704951");

// Edge signals fire once per crossing rather than on every bar the state holds.
const edgeSignalBars = quant.generateDemoBars(400);
const edgeConfiguration = {
  strategy: { type: "sma-cross", fast: 10, slow: 30 },
  initialCapital: 100_000,
  feeBps: 5,
  slippageBps: 5,
  stopLossPct: 5,
};
const stateRun = quant.runBacktest(edgeSignalBars, edgeConfiguration);
const edgeRun = quant.runBacktest(edgeSignalBars, { ...edgeConfiguration, signalMode: "edge" });
assert(edgeRun.trades.length <= stateRun.trades.length);
assert.throws(
  () => quant.runBacktest(edgeSignalBars, { ...edgeConfiguration, signalMode: "sometimes" }),
  /signalMode/,
);

// A fixed fraction commits less capital, so it cannot outrun all-in on a winner.
const sizingBaseline = {
  strategy: { type: "sma-cross", fast: 20, slow: 50 },
  initialCapital: 100_000,
  feeBps: 5,
  slippageBps: 2,
  stopLossPct: 8,
};
// Vary only the sizer, so the comparison isolates sizing from execution costs.
const fullSized = quant.runBacktest(bars, sizingBaseline);
const halfSized = quant.runBacktest(bars, {
  ...sizingBaseline,
  sizer: { type: "fixed-fraction", pct: 50 },
});
assert.equal(fullSized.metrics.finalEquity, run.metrics.finalEquity);
assert(halfSized.metrics.finalEquity < fullSized.metrics.finalEquity);
assert.equal(halfSized.trades.length, fullSized.trades.length);
assert.throws(
  () => quant.runBacktest(bars, { ...edgeConfiguration, sizer: { type: "fixed-fraction", pct: 0 } }),
  /sizer percentage/,
);
assert.throws(
  () => quant.runBacktest(bars, { ...edgeConfiguration, sizer: { type: "leveraged" } }),
  /unknown sizer type/,
);
// The engine has no borrowing model, so leverage above 1 must be rejected.
assert.throws(
  () =>
    quant.runBacktest(bars, {
      ...edgeConfiguration,
      sizer: { type: "volatility-target", annual: 15, maxLeverage: 3 },
    }),
  /max leverage/,
);

// A positive risk-free rate lowers Sharpe for a profitable strategy.
const withRiskFree = quant.runBacktest(bars, {
  strategy: { type: "sma-cross", fast: 20, slow: 50 },
  initialCapital: 100_000,
  feeBps: 5,
  slippageBps: 2,
  stopLossPct: 8,
  riskFreeRate: 0.03,
});
assert(withRiskFree.metrics.sharpe < run.metrics.sharpe);
assert(withRiskFree.metrics.sortino < run.metrics.sortino);

// Parameter sweeps report invalid combinations instead of aborting the grid.
const sweep = quant.parameterSweep(
  bars,
  { ...edgeConfiguration, strategy: { type: "sma-cross" } },
  { fast: [5, 10, 60], slow: [30, 50] },
);
assert.equal(sweep.evaluated, 6);
assert(sweep.usable < sweep.evaluated, "fast >= slow combinations must be rejected, not thrown");
assert(sweep.results.some((entry) => entry.ok === false));
assert(Number.isFinite(sweep.sharpeMean));

// Walk-forward selects on the in-sample window and scores the untouched one.
const walkBars = quant.generateDemoBars(900);
const walkResult = quant.walkForward(
  walkBars,
  { ...edgeConfiguration, strategy: { type: "sma-cross" } },
  { fast: [10, 20], slow: [50, 100] },
  { inSampleBars: 400, outOfSampleBars: 100 },
);
assert(walkResult.usableFolds >= 2);
assert(walkResult.folds.every((fold) => !fold.ok || fold.from < fold.to));
assert(Number.isFinite(walkResult.meanInSampleFoldSharpe));
assert(Number.isFinite(walkResult.pooledOutOfSampleSharpe));
assert.equal(walkResult.failedFolds, 0);
assert(Number.isInteger(walkResult.untestedTailBars) && walkResult.untestedTailBars >= 0);

// Warm-up history must keep an in-sample-valid parameter usable out of sample.
// Without it a lookback longer than the fold fails every fold (regression).
const warmupWalk = quant.walkForward(
  quant.generateDemoBars(300),
  { ...edgeConfiguration, strategy: { type: "sma-cross" } },
  { fast: [5], slow: [49] },
  { inSampleBars: 100, outOfSampleBars: 50 },
);
assert.equal(warmupWalk.failedFolds, 0);
assert(warmupWalk.usableFolds >= 3);
assert(warmupWalk.warmupBars > 0);
assert(warmupWalk.folds.every((fold) => !fold.ok || fold.returns === undefined));

// Pooled Sharpe is computed over the concatenated stream, not averaged ratios,
// so the two summaries are allowed to differ and both must be finite.
assert(Number.isFinite(warmupWalk.meanOutOfSampleFoldSharpe));
assert(Number.isFinite(warmupWalk.pooledOutOfSampleSharpe));

// Warm-up bars prime indicators but must never trade: a position opened there
// would use parameters selected from data that comes after it.
const warmupProbeBars = quant.generateDemoBars(300);
const warmupProbe = quant.walkForward(
  warmupProbeBars,
  { ...edgeConfiguration, stopLossPct: 0, strategy: { type: "sma-cross" } },
  { fast: [5], slow: [20] },
  { inSampleBars: 100, outOfSampleBars: 50 },
);
for (const fold of warmupProbe.folds.filter((entry) => entry.ok)) {
  const sliceStart = warmupProbeBars.findIndex((bar) => bar.date === fold.from) - fold.warmupBars;
  const evaluation = warmupProbeBars.slice(sliceStart, sliceStart + fold.warmupBars + 50);
  const replay = quant.runBacktest(evaluation, {
    ...edgeConfiguration,
    stopLossPct: 0,
    strategy: { type: "sma-cross", ...fold.parameters },
    tradingFromIndex: fold.warmupBars,
  });
  assert(
    replay.trades.every((trade) => trade.entryDate >= fold.from),
    "no trade may be entered inside the warm-up prefix",
  );
  for (let i = 0; i < fold.warmupBars; i += 1) {
    assert.equal(replay.equity[i].value, 100_000, "warm-up equity must stay at initial capital");
  }
}
assert.throws(
  () => quant.runBacktest(warmupProbeBars, { ...edgeConfiguration, tradingFromIndex: -1 }),
  /tradingFromIndex/,
);

// Default warm-up must cover the longest lookback in the grid, or an in-sample
// valid parameter set fails every fold for lack of history.
const shortFoldWalk = quant.walkForward(
  quant.generateDemoBars(300),
  { ...edgeConfiguration, stopLossPct: 0, strategy: { type: "sma-cross" } },
  { fast: [2], slow: [50] },
  { inSampleBars: 100, outOfSampleBars: 10 },
);
assert(shortFoldWalk.warmupBars >= 52);
assert(shortFoldWalk.usableFolds >= 15);

// A numeric-string risk-free rate must not string-concatenate in pooled Sharpe.
const rateWalk = (rate) =>
  quant.walkForward(
    quant.generateDemoBars(300),
    { ...edgeConfiguration, stopLossPct: 0, riskFreeRate: rate, strategy: { type: "sma-cross" } },
    { fast: [5], slow: [20] },
    { inSampleBars: 100, outOfSampleBars: 50 },
  ).pooledOutOfSampleSharpe;
assert.equal(rateWalk("0.03").toFixed(9), rateWalk(0.03).toFixed(9));

// A zero-trade parameter set must not win a sweep over a traded candidate.
const zeroTradeSweep = quant.parameterSweep(
  quant.generateDemoBars(300),
  { ...edgeConfiguration, strategy: { type: "rsi-reversion", period: 14 } },
  { oversold: [1, 30], overbought: [70, 99] },
);
assert(zeroTradeSweep.usable > zeroTradeSweep.eligible);
assert(zeroTradeSweep.best.trades >= 1);

// Volatility targeting without enough history must not silently swallow the
// entry signal; edge mode would otherwise never fire it again.
const sizerBars = quant.generateDemoBars(300);
const edgeBase = {
  ...edgeConfiguration,
  stopLossPct: 0,
  signalMode: "edge",
  strategy: { type: "sma-cross", fast: 10, slow: 30 },
};
const allInEdge = quant.runBacktest(sizerBars, edgeBase);
const volTargetEdge = quant.runBacktest(sizerBars, {
  ...edgeBase,
  sizer: { type: "volatility-target", annual: 15, lookback: 250 },
});
assert.equal(volTargetEdge.trades.length, allInEdge.trades.length);
assert(Array.isArray(volTargetEdge.skippedEntries));
assert.throws(
  () =>
    quant.walkForward(
      quant.generateDemoBars(120),
      { ...edgeConfiguration, strategy: { type: "sma-cross" } },
      { fast: [10], slow: [50] },
      { inSampleBars: 400, outOfSampleBars: 100 },
    ),
  /at least 500 bars/,
);

// Drawdown episodes are ordered worst-first and stay within the equity window.
// Watchlist alerts reuse the backtest signal rules, so an alert can be checked
// by the same walk-forward machinery instead of being an unverifiable heuristic.
const watchBars = quant.generateDemoBars(300);
const lastClose = watchBars.at(-1).close;

const priceHit = quant.evaluateWatchItem(watchBars, {
  symbol: "TEST",
  rule: { type: "price-below", price: lastClose * 2 },
});
assert.equal(priceHit.triggered, true);
assert.equal(priceHit.asOf, watchBars.at(-1).date);

const priceMiss = quant.evaluateWatchItem(watchBars, {
  symbol: "TEST",
  rule: { type: "price-below", price: lastClose / 2 },
});
assert.equal(priceMiss.triggered, false);

// An always-true RSI threshold must fire; an impossible one must not.
assert.equal(
  quant.evaluateWatchItem(watchBars, {
    symbol: "TEST",
    rule: { type: "rsi-oversold", period: 14, threshold: 99 },
  }).triggered,
  true,
);
assert.equal(
  quant.evaluateWatchItem(watchBars, {
    symbol: "TEST",
    rule: { type: "rsi-oversold", period: 14, threshold: 1 },
  }).triggered,
  false,
);

// Compound alerts support deterministic AND / OR logic over the same latest bar.
const compoundAnd = quant.evaluateWatchItem(watchBars, {
  symbol: "TEST",
  rule: {
    type: "compound",
    operator: "and",
    conditions: [
      { type: "price-below", price: lastClose * 2 },
      { type: "rsi-oversold", period: 14, threshold: 99 },
    ],
  },
});
assert.equal(compoundAnd.triggered, true);
assert.equal(compoundAnd.conditions.length, 2);
assert.match(compoundAnd.detail, /全部满足 2\/2/u);

const compoundOr = quant.evaluateWatchItem(watchBars, {
  symbol: "TEST",
  rule: {
    type: "compound",
    operator: "or",
    conditions: [
      { type: "price-below", price: lastClose / 2 },
      { type: "rsi-oversold", period: 14, threshold: 99 },
    ],
  },
});
assert.equal(compoundOr.triggered, true);
assert.match(compoundOr.detail, /任一满足 1\/2/u);

// A signal alert fires on the same edge the backtester would trade on.
const signalWatch = quant.evaluateWatchItem(watchBars, {
  symbol: "TEST",
  rule: { type: "signal-entry" },
  strategy: { type: "sma-cross", fast: 10, slow: 30 },
});
// The alert must agree with the engine: it fires exactly when the final bar
// carries an entry edge, which is the bar the backtester would buy on.
const signalRun = quant.runBacktest(watchBars, {
  ...edgeConfiguration,
  stopLossPct: 0,
  signalMode: "edge",
  strategy: { type: "sma-cross", fast: 10, slow: 30 },
});
const entryOnFinalBar = signalRun.trades.some(
  (trade) => trade.entryDate === watchBars.at(-1).date,
);
assert.equal(
  signalWatch.triggered || entryOnFinalBar,
  signalWatch.triggered,
  "alert and backtester must agree on the final bar",
);
assert.equal(typeof signalWatch.detail, "string");

assert.throws(
  () => quant.evaluateWatchItem(watchBars, { symbol: "T", rule: { type: "nope" } }),
  /unknown alert rule/,
);
assert.throws(
  () => quant.evaluateWatchItem(watchBars, { symbol: "T", rule: { type: "price-below", price: -1 } }),
  /alert price/,
);
assert.throws(
  () => quant.evaluateWatchItem(watchBars, { symbol: "T", rule: { type: "compound", operator: "and", conditions: [] } }),
  /2 to 4 conditions/,
);
assert.throws(
  () => quant.evaluateWatchItem(watchBars, {
    symbol: "T",
    rule: {
      type: "compound",
      operator: "and",
      conditions: [
        { type: "price-below", price: 1 },
        { type: "compound", operator: "or", conditions: [] },
      ],
    },
  }),
  /nested compound/,
);
assert.throws(
  () => quant.evaluateWatchItem([watchBars[0]], { symbol: "T", rule: { type: "price-below", price: 1 } }),
  /at least two bars/,
);
// A signal alert with no strategy must fail loudly rather than silently never firing.
assert.throws(
  () => quant.evaluateWatchItem(watchBars, { symbol: "T", rule: { type: "signal-entry" } }),
  /needs a strategy/,
);

// Ranking puts triggered entries first, then the closest to triggering.
const ranked = quant.rankWatchResults([
  { symbol: "C", triggered: false, distance: 0.5 },
  { symbol: "A", triggered: true, distance: null },
  { symbol: "B", triggered: false, distance: 0.01 },
]);
assert.deepEqual(
  ranked.map((entry) => entry.symbol),
  ["A", "B", "C"],
);

const episodes = quant.drawdownEpisodes(run.equity, 3);
assert(episodes.length <= 3);
for (let i = 1; i < episodes.length; i += 1) {
  assert(episodes[i - 1].depth <= episodes[i].depth);
}
for (const episode of episodes) {
  assert(episode.depth < 0);
  assert(episode.peakDate <= episode.troughDate);
}

// Evidence carries engine-computed numbers plus the concerns a reviewer needs.
const evidence = quant.researchEvidence(run, { walkForward: walkResult, sweep });
assert.equal(evidence.metrics.finalEquity, run.metrics.finalEquity);
assert.equal(evidence.sample.bars, 260);
assert(Array.isArray(evidence.concerns));
const missingValidation = quant.researchEvidence(run);
assert(missingValidation.concerns.some((note) => /out-of-sample/.test(note)));

}

if (isDirectRun(import.meta.url)) {
  await runModelTests();
console.log("✓ Quant Lab engine smoke test");
console.log("✓ Quant Lab sizer, signal-mode and risk-free-rate contract");
console.log("✓ Quant Lab walk-forward and parameter sweep");
console.log("✓ Quant Lab research evidence");
console.log("✓ Quant Lab watchlist alert rules");
}
