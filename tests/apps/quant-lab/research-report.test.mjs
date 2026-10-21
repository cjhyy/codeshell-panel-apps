import test from "node:test";
import assert from "node:assert/strict";
import { buildResearchReport, parseResearchMetadata, researchPreset } from "../../../apps/quant-lab/app/research-report.mjs";
import { generateDemoBars, runBacktest, fingerprintBars, walkForward } from "../../../apps/quant-lab/app/engine.mjs";
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test("report amounts reproduce engine trades, costs, actual drawdown peak/trough and benchmark", () => {
  const bars = generateDemoBars(760), { configuration, ranges } = researchPreset("trend-sma");
  const report = buildResearchReport({ bars, configuration, ranges });
  const result = runBacktest(bars, configuration);
  near(report.outcome.finalEquity, result.metrics.finalEquity);
  near(report.outcome.pnl, result.trades.reduce((n, t) => n + t.pnl, 0));
  near(report.money.feesPaid, result.trades.reduce((n, t) => n + t.shares * (t.entryPrice + t.exitPrice) * configuration.feeBps / 10000, 0));
  let grossPnl = 0;
  for (const trade of result.trades) grossPnl += trade.shares * (trade.exitPrice / (1 - configuration.slippageBps / 10000) - trade.entryPrice / (1 + configuration.slippageBps / 10000));
  near(grossPnl - report.money.slippageCost - report.money.feesPaid, report.outcome.pnl);
  const d = report.outcome.maxDrawdown;
  near(d.pct, result.metrics.maximumDrawdown);
  near(d.peakValue, result.equity.find(p => p.date === d.peakDate).value);
  near(d.troughValue, result.equity.find(p => p.date === d.troughDate).value);
  near(d.amount, d.peakValue - d.troughValue);
  near(report.benchmark.return, result.metrics.benchmarkReturn);
  const walk = walkForward(bars, configuration, ranges);
  assert.deepEqual(report.outOfSample.folds, walk.folds);
  assert.match(report.markdown, /不是连续账户或复利/);
});

test("short samples and synthetic data cannot imply validated real performance; metadata binds to exact bars", () => {
  const r = buildResearchReport({ preset: "trend-sma", synthetic: true });
  assert.equal(r.data.synthetic, true); assert.equal(r.outOfSample.ran, false);
  assert.equal(r.verdict.tier, "insufficient_evidence"); assert.match(r.markdown, /样本不足/); assert.match(r.markdown, /非真实绩效/);
  const bars = generateDemoBars(520);
  assert.throws(() => parseResearchMetadata("[]", bars), /无效/);
  assert.throws(() => parseResearchMetadata("bad", bars), /JSON/);
  assert.throws(() => parseResearchMetadata(JSON.stringify({ format: "codeshell.quant-dataset", fingerprint: fingerprintBars(bars), syncedAt: "not-a-date" }), bars), /syncedAt/);
  const metadata = parseResearchMetadata(JSON.stringify({ format: "codeshell.quant-dataset", fingerprint: fingerprintBars(bars), source: "fixture", adjust: "none" }), bars);
  const actual = buildResearchReport({ preset: "trend-sma", bars, metadata });
  assert.equal(actual.data.source, "fixture"); assert.match(actual.markdown, /未复权/);
  const stale = buildResearchReport({ preset: "trend-sma", bars, metadata: { ...metadata, fingerprint: "wrong" } });
  assert.equal(stale.data.source, "未知"); assert.match(stale.markdown, /指纹不一致/);
});

test("shared report rejects ambiguous presets and bounded aggregate OOS work", () => {
  assert.throws(() => buildResearchReport({ synthetic: true, preset: "trend-sma", configuration: researchPreset("trend-sma").configuration }), /必须且只能/);
  const bars = generateDemoBars(760);
  const configuration = { ...researchPreset("trend-sma").configuration, strategy: { type: "sma-cross", fast: 5, slow: 10 } };
  assert.throws(() => buildResearchReport({ bars, configuration, ranges: { fast: Array(64).fill(5), slow: Array(64).fill(10) }, options: { inSampleBars: 100, outOfSampleBars: 10 } }), error => error.code === "WORK_LIMIT");
});
