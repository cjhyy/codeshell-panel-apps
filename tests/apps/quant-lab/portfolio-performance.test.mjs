import test from "node:test";
import assert from "node:assert/strict";
import { portfolioPerformanceSeries } from "../../../apps/quant-lab/app/portfolio.mjs";
import { performanceWindow } from "../../../apps/quant-lab/app/modules/portfolio-performance-ui.mjs";
const row = (date, value, beginFlow = "0.00", endFlow = "0.00", extra = {}) => ({ date, value, beginFlow, endFlow, ...extra });

test("daily net profit excludes deposits, withdrawals and transferred positions", () => {
  const values = portfolioPerformanceSeries([
    row("2026-09-01", "1010.00", "1000.00"),
    row("2026-09-02", "1525.10", "500.00"),
    row("2026-09-03", "1040.35", "0.00", "-500.00"),
  ]);
  assert.deepEqual(values.map((item) => item.dailyPnl), ["10.00", "15.10", "15.25"]);
  assert(Math.abs(values[1].cumulativeReturn - 0.0201) < 1e-12, "returns compound instead of summing daily percentages");
});

test("snapshot import starts a baseline, not invented pre-import daily gains", () => {
  const values = portfolioPerformanceSeries([row("2026-09-01", "1100.00", "1000.00"), row("2026-09-02", "1122.00")], { openingSnapshot: true });
  assert.equal(values[0].dailyPnl, null);
  assert.equal(values[0].dailyReturn, null);
  assert.equal(values[0].cumulativeReturn, 0);
  assert.equal(values[1].dailyPnl, "22.00");
  assert(Math.abs(values[1].cumulativeReturn - 0.02) < 1e-12);
});

test("missing valuations break the curve and recovery cannot invent the missing daily return", () => {
  const values = portfolioPerformanceSeries([
    row("2026-09-01", "1000.00", "1000.00"),
    row("2026-09-02", null, "0.00", "0.00", { unavailable: { code: "missing-raw-data" } }),
    row("2026-09-03", "1050.00"), row("2026-09-04", "1060.00"),
  ]);
  assert.deepEqual(values.map((item) => item.dailyPnl), ["0.00", null, null, "10.00"]);
  assert.deepEqual(values.map((item) => item.cumulativeReturn), [0, null, null, null]);
});

test("complete live valuation updates only today's provisional point and cannot erase cash or FX problems", () => {
  const rows = [row("2026-09-01", "1000.00", "1000.00"), row("2026-09-02", null, "0.00", "0.00", { unavailable: { code: "missing-raw-data" } })];
  const live = { date: "2026-09-02", value: "990.00", complete: true };
  const values = portfolioPerformanceSeries(rows, { live });
  assert.equal(values[1].dailyPnl, "-10.00");
  assert.equal(values[1].live, true);
  assert.equal(values[1].provisional, true);
  assert.equal(rows[1].value, null, "history remains immutable");
  for (const code of ["negative-cash", "missing-fx", "suspected-missing-corporate-action"]) {
    const blocked = portfolioPerformanceSeries([rows[0], { ...rows[1], unavailable: { code } }], { live });
    assert.equal(blocked[1].dailyPnl, null);
  }
  assert.equal(portfolioPerformanceSeries(rows, { live: { ...live, complete: false } })[1].dailyPnl, null);
});

test("money subtraction keeps cents exact; zero is a valid day and ranges use calendar dates", () => {
  const values = portfolioPerformanceSeries([row("2026-08-01", "0.10", "0.10"), row("2026-09-01", "0.30"), row("2026-09-02", "0.30")]);
  assert.equal(values[1].dailyPnl, "0.20");
  assert.equal(values[2].dailyPnl, "0.00");
  assert.equal(performanceWindow(values, "30").length, 2);
  assert.equal(performanceWindow(values, "90").length, 3);
  assert.equal(performanceWindow(values, "all").length, 3);
});
