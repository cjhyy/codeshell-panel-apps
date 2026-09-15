const WINDOW_RULES = Object.freeze([
  Object.freeze({ days: 3, positiveMain: 20, negativeMain: 20, positiveGrowth: 30, negativeGrowth: 30 }),
  Object.freeze({ days: 10, positiveMain: 100, negativeMain: 50, positiveGrowth: 100, negativeGrowth: 50 }),
  Object.freeze({ days: 30, positiveMain: 200, negativeMain: 70, positiveGrowth: 200, negativeGrowth: 70 }),
]);

const INDEX_NAMES = Object.freeze({
  SH000001: "上证指数",
  SZ399001: "深证成指",
  SZ399006: "创业板指",
});

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function validBars(input) {
  return (Array.isArray(input) ? input : [])
    .filter((bar) => /^\d{4}-\d{2}-\d{2}$/u.test(bar?.date) && Number.isFinite(Number(bar?.close)) && Number(bar.close) > 0)
    .map((bar) => ({ date: bar.date, close: Number(bar.close) }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function abnormalBenchmarkFor(symbolInput, boardInput) {
  const symbol = String(symbolInput ?? "").toUpperCase();
  const board = String(boardInput ?? "");
  if (board === "chinext" || /^SZ3\d{5}$/u.test(symbol)) return "SZ399006";
  if (symbol.startsWith("SZ")) return "SZ399001";
  return "SH000001";
}

function closeAtOrBefore(bars, date) {
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    if (bars[index].date <= date) return bars[index];
  }
  return null;
}

export function calculateAbnormalDeviation({ symbol, board, stockBars, benchmarkBars }) {
  const benchmarkSymbol = abnormalBenchmarkFor(symbol, board);
  const stocks = validBars(stockBars);
  const benchmark = validBars(benchmarkBars);
  const unavailable = (reason) => Object.freeze({
    version: 1,
    available: false,
    benchmarkSymbol,
    benchmarkName: INDEX_NAMES[benchmarkSymbol],
    state: "unavailable",
    label: "待补齐",
    windows: Object.freeze([]),
    reason,
    disclosure: "需同期个股与对应宽基指数日线；近似口径不等于交易所认定。",
  });
  if (stocks.length < 31 || benchmark.length < 31) return unavailable("个股或基准指数不足 31 个交易日");
  const endDate = benchmark.at(-1).date;
  const stockEnd = closeAtOrBefore(stocks, endDate);
  if (!stockEnd || stockEnd.date < endDate) return unavailable("个股最新日线与基准指数不同步");
  const growthBoard = ["star", "chinext"].includes(board);
  const windows = [];
  for (const rule of WINDOW_RULES) {
    const benchmarkStart = benchmark.at(-(rule.days + 1));
    if (!benchmarkStart) continue;
    const stockStart = closeAtOrBefore(stocks, benchmarkStart.date);
    if (!stockStart) continue;
    const benchmarkReturn = (benchmark.at(-1).close / benchmarkStart.close - 1) * 100;
    const stockReturn = (stockEnd.close / stockStart.close - 1) * 100;
    const deviation = stockReturn - benchmarkReturn;
    const threshold = deviation >= 0
      ? (growthBoard ? rule.positiveGrowth : rule.positiveMain)
      : (growthBoard ? rule.negativeGrowth : rule.negativeMain);
    const closeness = Math.abs(deviation) / threshold * 100;
    const state = closeness >= 100 ? "triggered" : closeness >= 70 ? "edge" : closeness >= 50 ? "watch" : "normal";
    windows.push(Object.freeze({
      days: rule.days,
      from: benchmarkStart.date,
      through: endDate,
      stockReturn: round(stockReturn),
      benchmarkReturn: round(benchmarkReturn),
      deviation: round(deviation),
      threshold,
      closeness: round(closeness, 1),
      direction: deviation >= 0 ? "up" : "down",
      state,
    }));
  }
  if (windows.length !== WINDOW_RULES.length) return unavailable("同期日线无法覆盖全部异动窗口");
  const priority = { triggered: 3, edge: 2, watch: 1, normal: 0 };
  const leading = windows.slice().sort((left, right) => priority[right.state] - priority[left.state] || right.closeness - left.closeness)[0];
  const labels = { triggered: "近似达阈值", edge: "异动边缘", watch: "进入观察", normal: "未接近阈值" };
  return Object.freeze({
    version: 1,
    available: true,
    benchmarkSymbol,
    benchmarkName: INDEX_NAMES[benchmarkSymbol],
    state: leading.state,
    label: labels[leading.state],
    leadingWindowDays: leading.days,
    windows: Object.freeze(windows),
    reason: `${leading.days} 日窗口接近度 ${leading.closeness.toFixed(1)}%`,
    disclosure: `个股累计涨跌减 ${INDEX_NAMES[benchmarkSymbol]} 同期涨跌；指数映射为研究近似，不是交易所监管认定。`,
  });
}

export const A_SHARE_ABNORMAL_DEVIATION_RULES = WINDOW_RULES;
