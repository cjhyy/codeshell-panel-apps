export const A_SHARE_STRATEGY_ASSUMPTIONS = Object.freeze({
  version: "1.0.0",
  signalAt: "close",
  entryAt: "next-open",
  buyCommissionRate: 0.0003,
  sellCommissionRate: 0.0003,
  stampDutyRate: 0.0005,
  slippageRate: 0.001,
  maximumExitDelayBars: 3,
  note: "按次日开盘成交，计双边佣金、卖出印花税与双边滑点；涨停无法买入、跌停最多顺延 3 个交易日。",
});

const A_SHARE_STRATEGY_BASE_SPECS = Object.freeze([
  Object.freeze({
    id: "trend-pullback",
    label: "趋势回踩",
    description: "中期趋势向上，近 5 日回到 MA20 附近后重新站稳，量能恢复但不追高。",
    category: "trend",
    categoryLabel: "趋势",
    timeframe: "波段",
    assetTypes: Object.freeze(["stock", "etf"]),
    marketStates: Object.freeze(["strong", "lean_strong", "range"]),
    phaseStates: Object.freeze(["ignite", "rally", "repair"]),
  }),
  Object.freeze({
    id: "ma20-reclaim", label: "MA20 收复", description: "盘中回踩或短暂跌破 MA20 后收回，收盘转强且量能不弱。",
    category: "trend", categoryLabel: "趋势", timeframe: "短波段", assetTypes: Object.freeze(["stock", "etf"]), marketStates: Object.freeze(["strong", "lean_strong", "range"]), phaseStates: Object.freeze(["ignite", "rally", "repair"]),
  }),
  Object.freeze({
    id: "ma60-reclaim", label: "MA60 修复", description: "中期均线附近出现止跌收复，适合观察趋势从修复转回升。",
    category: "trend", categoryLabel: "趋势", timeframe: "波段", assetTypes: Object.freeze(["stock", "etf"]), marketStates: Object.freeze(["lean_strong", "range", "lean_weak"]), phaseStates: Object.freeze(["ignite", "repair"]),
  }),
  Object.freeze({
    id: "trend-acceleration", label: "趋势加速", description: "MA5、MA10、MA20 多头排列，价格温和放量加速但尚未明显过热。",
    category: "trend", categoryLabel: "趋势", timeframe: "短波段", assetTypes: Object.freeze(["stock", "etf"]), marketStates: Object.freeze(["strong", "lean_strong"]), phaseStates: Object.freeze(["ignite", "rally"]),
  }),
  Object.freeze({
    id: "strong-volume-contraction", label: "强势缩量整理", description: "20 日趋势较强，价格在高位回撤但守住 MA20，近 3 日成交量明显收缩。",
    category: "trend", categoryLabel: "趋势", timeframe: "波段", assetTypes: Object.freeze(["stock", "etf"]), marketStates: Object.freeze(["strong", "lean_strong", "range"]), phaseStates: Object.freeze(["rally", "repair"]),
  }),
  Object.freeze({
    id: "orderly-uptrend", label: "有序上行", description: "20 日涨幅适中、回撤受控且量能稳定，强调可持续而不是单日爆发。",
    category: "trend", categoryLabel: "趋势", timeframe: "波段", assetTypes: Object.freeze(["stock", "etf"]), marketStates: Object.freeze(["strong", "lean_strong", "range"]), phaseStates: Object.freeze(["ignite", "rally", "repair"]),
  }),
  Object.freeze({
    id: "volume-breakout", label: "放量突破", description: "价格接近或突破 20 日高点，量比放大，均线偏离和单日涨幅仍在可控区间。",
    category: "breakout", categoryLabel: "突破", timeframe: "短波段", assetTypes: Object.freeze(["stock", "etf"]), marketStates: Object.freeze(["strong", "lean_strong", "range"]), phaseStates: Object.freeze(["ignite", "rally", "repair"]),
  }),
  Object.freeze({
    id: "tight-base-breakout", label: "平台突破", description: "近 10 日波动收窄形成平台，收盘接近平台高点并出现温和放量。",
    category: "breakout", categoryLabel: "突破", timeframe: "短波段", assetTypes: Object.freeze(["stock", "etf"]), marketStates: Object.freeze(["strong", "lean_strong", "range"]), phaseStates: Object.freeze(["ignite", "rally", "repair"]),
  }),
  Object.freeze({
    id: "high-breakout", label: "60日强势新高", description: "60 日收益和趋势结构较强，价格重新接近 60 日高点且没有触发追高过滤。",
    category: "breakout", categoryLabel: "突破", timeframe: "波段", assetTypes: Object.freeze(["stock"]), marketStates: Object.freeze(["strong", "lean_strong"]), phaseStates: Object.freeze(["ignite", "rally"]),
  }),
  Object.freeze({
    id: "box-breakout", label: "箱体突破", description: "20 日箱体足够紧，收盘越过箱顶并有成交量确认。",
    category: "breakout", categoryLabel: "突破", timeframe: "短波段", assetTypes: Object.freeze(["stock", "etf"]), marketStates: Object.freeze(["strong", "lean_strong", "range"]), phaseStates: Object.freeze(["ignite", "rally", "repair"]),
  }),
  Object.freeze({
    id: "volatility-contraction-breakout", label: "波动收缩突破", description: "短期振幅显著低于 20 日振幅后向上突破，避免在宽幅震荡中追价。",
    category: "breakout", categoryLabel: "突破", timeframe: "短线", assetTypes: Object.freeze(["stock", "etf"]), marketStates: Object.freeze(["strong", "lean_strong", "range"]), phaseStates: Object.freeze(["ignite", "repair"]),
  }),
  Object.freeze({
    id: "gap-hold-breakout", label: "跳空守缺口", description: "温和向上跳空后收在日内高位，缺口没有在当日被完全回补。",
    category: "breakout", categoryLabel: "突破", timeframe: "短线", assetTypes: Object.freeze(["stock"]), marketStates: Object.freeze(["strong", "lean_strong"]), phaseStates: Object.freeze(["ignite", "rally"]),
  }),
  Object.freeze({
    id: "oversold-reversal", label: "超跌反转", description: "20 日显著回撤后出现放量阳线和高位收盘，只作为反转观察而非趋势确认。",
    category: "reversal", categoryLabel: "反转", timeframe: "短线", assetTypes: Object.freeze(["stock", "etf"]), marketStates: Object.freeze(["range", "lean_weak", "weak"]), phaseStates: Object.freeze(["ice", "ebb", "repair"]),
  }),
  Object.freeze({
    id: "double-bottom-near", label: "近似双底", description: "价格回到 20 日前低附近但没有继续扩大跌幅，并出现止跌收盘。",
    category: "reversal", categoryLabel: "反转", timeframe: "短波段", assetTypes: Object.freeze(["stock", "etf"]), marketStates: Object.freeze(["range", "lean_weak"]), phaseStates: Object.freeze(["ice", "ebb", "repair"]),
  }),
  Object.freeze({
    id: "failed-breakdown-reclaim", label: "假跌破收复", description: "盘中跌破 20 日低点后收回，观察空头失败是否得到次日确认。",
    category: "reversal", categoryLabel: "反转", timeframe: "短线", assetTypes: Object.freeze(["stock", "etf"]), marketStates: Object.freeze(["range", "lean_weak"]), phaseStates: Object.freeze(["ice", "ebb", "repair"]),
  }),
  Object.freeze({
    id: "long-lower-shadow", label: "长下影承接", description: "下影明显、收盘靠近日内高位且量能放大，观察盘中承接是否持续。",
    category: "reversal", categoryLabel: "反转", timeframe: "短线", assetTypes: Object.freeze(["stock"]), marketStates: Object.freeze(["range", "lean_weak", "weak"]), phaseStates: Object.freeze(["ice", "ebb", "repair"]),
  }),
  Object.freeze({
    id: "capitulation-repair", label: "恐慌后修复", description: "前一日大跌后出现放量修复，但仍需等待趋势结构恢复。",
    category: "reversal", categoryLabel: "反转", timeframe: "短线", assetTypes: Object.freeze(["stock", "etf"]), marketStates: Object.freeze(["range", "lean_weak", "weak"]), phaseStates: Object.freeze(["ice", "ebb", "repair"]),
  }),
  Object.freeze({
    id: "low-volume-pullback", label: "缩量回踩", description: "趋势仍向上，回到 MA20 观察区时成交量降至常态以下。",
    category: "volume", categoryLabel: "量价", timeframe: "波段", assetTypes: Object.freeze(["stock", "etf"]), marketStates: Object.freeze(["strong", "lean_strong", "range"]), phaseStates: Object.freeze(["rally", "repair"]),
  }),
  Object.freeze({
    id: "volume-dry-up", label: "地量整理", description: "平台波动收窄且近 3 日持续缩量，等待新的方向性成交确认。",
    category: "volume", categoryLabel: "量价", timeframe: "短波段", assetTypes: Object.freeze(["stock", "etf"]), marketStates: Object.freeze(["lean_strong", "range", "lean_weak"]), phaseStates: Object.freeze(["ice", "repair"]),
  }),
  Object.freeze({
    id: "price-volume-confirmation", label: "价量齐升", description: "上涨幅度、收盘位置和成交量同步增强，同时限制追高幅度。",
    category: "volume", categoryLabel: "量价", timeframe: "短线", assetTypes: Object.freeze(["stock", "etf"]), marketStates: Object.freeze(["strong", "lean_strong", "range"]), phaseStates: Object.freeze(["ignite", "rally", "repair"]),
  }),
  Object.freeze({
    id: "first-limit-follow", label: "首板次日承接", description: "前一日接近涨停，次日未直接加速而是保持承接；仅用于高波动观察。",
    category: "limit", categoryLabel: "涨停", timeframe: "短线", assetTypes: Object.freeze(["stock"]), marketStates: Object.freeze(["strong", "lean_strong"]), phaseStates: Object.freeze(["ignite", "rally"]),
  }),
  Object.freeze({
    id: "limit-open-repair", label: "涨停后换手修复", description: "涨停后出现可控换手与高位收盘，观察分歧后的再次转强。",
    category: "limit", categoryLabel: "涨停", timeframe: "短线", assetTypes: Object.freeze(["stock"]), marketStates: Object.freeze(["strong", "lean_strong", "range"]), phaseStates: Object.freeze(["rally", "climax", "repair"]),
  }),
  Object.freeze({
    id: "strong-close-after-surge", label: "强阳高位收盘", description: "较大阳线伴随放量且收在日内高位，但拒绝接近涨停的追价。",
    category: "limit", categoryLabel: "涨停", timeframe: "短线", assetTypes: Object.freeze(["stock"]), marketStates: Object.freeze(["strong", "lean_strong"]), phaseStates: Object.freeze(["ignite", "rally"]),
  }),
  Object.freeze({
    id: "high-base-pullback", label: "高位平台回踩", description: "20 日强势后从高点回撤 3%—10%，并以缩量维持在 MA20 上方。",
    category: "pullback", categoryLabel: "回踩", timeframe: "波段", assetTypes: Object.freeze(["stock", "etf"]), marketStates: Object.freeze(["strong", "lean_strong", "range"]), phaseStates: Object.freeze(["rally", "climax", "repair"]),
  }),
  Object.freeze({
    id: "etf-trend-rotation", label: "ETF 趋势轮动", description: "ETF 中期趋势与相对强度同时向上，量能稳定且位置不过热。",
    category: "etf", categoryLabel: "ETF", timeframe: "波段", assetTypes: Object.freeze(["etf"]), marketStates: Object.freeze(["strong", "lean_strong", "range"]), phaseStates: Object.freeze(["ignite", "rally", "repair"]),
  }),
]);

export const A_SHARE_STRATEGY_LIBRARY_RELEASE = Object.freeze({
  version: "2026.08-v1",
  revisedAt: "2026-08-26",
  status: "frozen",
  note: "冻结信号条件与 T+1 成交口径；后续阈值调整必须升级版本，历史校准保留原版本标识。",
});

const STRATEGY_RULE_SUMMARIES = Object.freeze({
  "trend-pullback": "MA20 > MA60；近 5 日回踩 MA20 -2.5%～+4%；收盘站上 MA20；量比 ≥ 0.8",
  "ma20-reclaim": "MA20 > MA60；近 5 日触及 MA20 附近；当日收涨并重新站上 MA20；量比 ≥ 0.8",
  "ma60-reclaim": "收盘站上 MA60；MA20 不低于 MA60 的 98%；当日涨幅 ≥ 0.5%；量比 ≥ 0.9",
  "trend-acceleration": "MA5 > MA10 > MA20；20 日涨幅 5%～22%；量比 1.0～2.5；当日涨幅 ≥ 0.5%",
  "strong-volume-contraction": "20 日涨幅 ≥ 8%；距 60 日高点 1%～8%；近 3 日量比 ≤ 0.8；偏离 MA20 不超过 7%",
  "orderly-uptrend": "MA20 > MA60；20 日涨幅 3%～18%；20 日振幅 ≤ 24%；近 5 日低点抬高；量比 0.65～1.5",
  "volume-breakout": "距 20 日前高不低于 -0.5%；量比 ≥ 1.2；当日涨幅 ≥ 0.5%；偏离 MA20 ≤ 8%",
  "tight-base-breakout": "10 日振幅 ≤ 8%；收盘接近 10 日平台高点；量比 ≥ 1.1；当日涨幅 ≥ 0.3%",
  "high-breakout": "60 日涨幅 ≥ 12%；距 60 日前高不低于 -1.5%；量比 ≥ 1；行业相对强度 ≥ 65",
  "box-breakout": "20 日振幅 ≤ 15%；收盘越过箱顶附近；量比 ≥ 1.15；收盘位于日内区间上 35%",
  "volatility-contraction-breakout": "5 日振幅 ≤ 20 日振幅的 55%；接近 20 日前高；量比 ≥ 1.05",
  "gap-hold-breakout": "向上跳空 0.8%～4.5%；收盘位于日内区间上 30%；量比 ≥ 1.1；拒绝追高",
  "oversold-reversal": "20 日跌幅 ≥ 8%；当日涨幅 ≥ 1%；收盘位于日内区间上 28%；量比 ≥ 1.2",
  "double-bottom-near": "距 20 日前低 0%～4%；当日收涨；收盘位于日内区间上 40%",
  "failed-breakdown-reclaim": "盘中跌破 20 日前低后收回；当日跌幅小于 1%；收盘位于日内区间上 35%",
  "long-lower-shadow": "下影/实体 ≥ 1.5；收盘位于日内区间上 32%；量比 ≥ 1.1",
  "capitulation-repair": "前一日跌幅 ≤ -5%；当日涨幅 ≥ 1%；量比 ≥ 1.1",
  "low-volume-pullback": "MA20 > MA60；偏离 MA20 0%～4%；量比 0.4～0.82",
  "volume-dry-up": "收盘不低于 MA20 的 98%；10 日振幅 ≤ 9%；近 3 日量比 ≤ 0.62",
  "price-volume-confirmation": "趋势成立；当日涨幅 ≥ 0.8%；收盘位于日内区间上 30%；量比 ≥ 1.3；拒绝追高",
  "first-limit-follow": "前一日接近涨停；次日涨幅 -2%～5%；收盘仍在 MA20 上方",
  "limit-open-repair": "前一日接近涨停；次日收盘位于日内区间上 38%；量比 ≥ 0.9；拒绝加速追高",
  "strong-close-after-surge": "MA20 > MA60；当日涨幅 ≥ 3.5% 且未接近涨停；收盘位于日内区间上 18%；量比 ≥ 1.35",
  "high-base-pullback": "20 日涨幅 ≥ 10%；距前高回撤 3%～10%；近 3 日量比 ≤ 0.85；收盘站上 MA20",
  "etf-trend-rotation": "仅 ETF；MA20 > MA60；20 日涨幅 ≥ 2%；偏离 MA20 ≤ 7%；量比 0.6～2.0",
});

export const A_SHARE_STRATEGY_SPECS = Object.freeze(A_SHARE_STRATEGY_BASE_SPECS.map((spec) => Object.freeze({
  ...spec,
  ruleVersion: "1.0.0",
  revisedAt: A_SHARE_STRATEGY_LIBRARY_RELEASE.revisedAt,
  ruleStatus: A_SHARE_STRATEGY_LIBRARY_RELEASE.status,
  ruleSummary: STRATEGY_RULE_SUMMARIES[spec.id] ?? "固定规则，等待补充条件摘要。",
})));

export const A_SHARE_FACTOR_SPECS = Object.freeze([
  Object.freeze({ id: "momentum20", label: "20 日动量", description: "20 个交易日的价格收益，数值越高代表中期动量越强。" }),
  Object.freeze({ id: "trendGap", label: "均线趋势差", description: "MA20 相对 MA60 的距离，观察中期趋势结构。" }),
  Object.freeze({ id: "volumeRatio", label: "当日量比", description: "当日成交量相对前 20 日均量，观察量能确认。" }),
  Object.freeze({ id: "highProximity", label: "接近 20 日高点", description: "收盘相对前 20 日高点的距离，越接近高点数值越高。" }),
  Object.freeze({ id: "lowVolatility", label: "低波动", description: "20 日振幅取反，数值越高代表区间波动越小。" }),
  Object.freeze({ id: "reversal20", label: "20 日反转", description: "20 日收益取反，用于检查超跌方向是否有截面解释力。" }),
]);

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function mean(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function median(values) {
  const usable = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!usable.length) return null;
  const middle = Math.floor(usable.length / 2);
  return usable.length % 2 ? usable[middle] : (usable[middle - 1] + usable[middle]) / 2;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function sanitizeBars(barsInput) {
  const byDate = new Map();
  for (const item of Array.isArray(barsInput) ? barsInput : []) {
    const date = String(item?.date ?? "").slice(0, 10);
    const open = finite(item?.open);
    const high = finite(item?.high);
    const low = finite(item?.low);
    const close = finite(item?.close);
    const volume = finite(item?.volume);
    if (
      !validDate(date) || [open, high, low, close, volume].some((value) => value == null) ||
      Math.min(open, high, low, close) <= 0 || volume < 0 || high < Math.max(open, close) || low > Math.min(open, close)
    ) continue;
    byDate.set(date, { date, open, high, low, close, volume });
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function boardLimit(board) {
  return ["star", "chinext"].includes(board) ? 19.5 : 9.5;
}

export function aShareAssetType(symbolInput) {
  const symbol = String(symbolInput ?? "").toUpperCase();
  return /^(?:SH(?:5(?:1[0-9]|6[0-9]|8[0-9])|588|589)|SZ(?:15|16))[0-9]{3,4}$/u.test(symbol) ? "etf" : "stock";
}

export function strategyMetricsAt(barsInput, indexInput, { sanitized = false } = {}) {
  const bars = sanitized ? barsInput : sanitizeBars(barsInput);
  const index = Number(indexInput);
  if (!Number.isInteger(index) || index < 60 || index >= bars.length) return null;
  const current = bars[index];
  const previous = bars[index - 1];
  const last20 = bars.slice(index - 19, index + 1);
  const last60 = bars.slice(index - 59, index + 1);
  const previous20 = bars.slice(index - 20, index);
  const previous60 = bars.slice(index - 60, index);
  const recent5 = bars.slice(index - 4, index + 1);
  const recent10 = bars.slice(index - 9, index + 1);
  const previous10 = bars.slice(index - 10, index);
  const ma20 = mean(last20.map((bar) => bar.close));
  const ma60 = mean(last60.map((bar) => bar.close));
  const averageVolume20 = mean(previous20.map((bar) => bar.volume));
  const averageVolume3 = mean(bars.slice(index - 2, index + 1).map((bar) => bar.volume));
  const priorHigh20 = Math.max(...previous20.map((bar) => bar.high));
  const priorHigh60 = Math.max(...previous60.map((bar) => bar.high));
  const priorLow20 = Math.min(...previous20.map((bar) => bar.low));
  const priorLow60 = Math.min(...previous60.map((bar) => bar.low));
  const priorHigh10 = Math.max(...previous10.map((bar) => bar.high));
  const low10 = Math.min(...recent10.map((bar) => bar.low));
  const high10 = Math.max(...recent10.map((bar) => bar.high));
  const last5 = bars.slice(index - 4, index + 1);
  const previous5 = bars.slice(index - 9, index - 4);
  const range5 = (Math.max(...last5.map((bar) => bar.high)) / Math.min(...last5.map((bar) => bar.low)) - 1) * 100;
  const range20 = (Math.max(...last20.map((bar) => bar.high)) / Math.min(...last20.map((bar) => bar.low)) - 1) * 100;
  const candleRange = Math.max(current.high - current.low, current.close * 0.001);
  const bodyLow = Math.min(current.open, current.close);
  const body = Math.abs(current.close - current.open);
  const previousAverageVolume20 = mean(bars.slice(index - 21, index - 1).map((bar) => bar.volume));
  return Object.freeze({
    date: current.date,
    close: current.close,
    ma20,
    ma60,
    ma5: mean(bars.slice(index - 4, index + 1).map((bar) => bar.close)),
    ma10: mean(bars.slice(index - 9, index + 1).map((bar) => bar.close)),
    return20: (current.close / bars[index - 20].close - 1) * 100,
    return60: (current.close / bars[index - 60].close - 1) * 100,
    changePercent: (current.close / previous.close - 1) * 100,
    volumeRatio: averageVolume20 > 0 ? current.volume / averageVolume20 : null,
    volume3Ratio20: averageVolume20 > 0 ? averageVolume3 / averageVolume20 : null,
    extension20: (current.close / ma20 - 1) * 100,
    distancePriorHigh20: (current.close / priorHigh20 - 1) * 100,
    distancePriorHigh60: (current.close / priorHigh60 - 1) * 100,
    range10: (high10 / low10 - 1) * 100,
    range5,
    range20,
    recentLow5Distance20: (Math.min(...recent5.map((bar) => bar.low)) / ma20 - 1) * 100,
    distancePriorLow20: (current.close / priorLow20 - 1) * 100,
    distancePriorLow60: (current.close / priorLow60 - 1) * 100,
    pullbackFromHigh20: (current.close / priorHigh20 - 1) * 100,
    closePosition: (current.close - current.low) / candleRange,
    lowerShadowRatio: (bodyLow - current.low) / Math.max(body, current.close * 0.001),
    gapPercent: (current.open / previous.close - 1) * 100,
    previousChangePercent: index >= 2 ? (previous.close / bars[index - 2].close - 1) * 100 : 0,
    previousVolumeRatio: previousAverageVolume20 > 0 ? previous.volume / previousAverageVolume20 : null,
    higherLow5: Math.min(...last5.map((bar) => bar.low)) >= Math.min(...previous5.map((bar) => bar.low)),
    intradayBreakLow20: current.low < priorLow20 && current.close > priorLow20,
    priorHigh10,
  });
}

function rankWithTies(values) {
  const indexed = values.map((value, index) => ({ value, index })).sort((left, right) => left.value - right.value);
  const ranks = new Array(values.length);
  for (let start = 0; start < indexed.length;) {
    let end = start + 1;
    while (end < indexed.length && indexed[end].value === indexed[start].value) end += 1;
    const rank = (start + end - 1) / 2 + 1;
    for (let cursor = start; cursor < end; cursor += 1) ranks[indexed[cursor].index] = rank;
    start = end;
  }
  return ranks;
}

function correlation(left, right) {
  if (left.length !== right.length || left.length < 3) return null;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let numerator = 0;
  let leftSquared = 0;
  let rightSquared = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftSquared += leftDelta ** 2;
    rightSquared += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftSquared * rightSquared);
  return denominator > 0 ? numerator / denominator : null;
}

function deviation(values, average) {
  if (values.length < 2 || !Number.isFinite(average)) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function rollingFactorStability(rows, overallIc) {
  const windowCount = rows.length >= 40 ? 4 : rows.length >= 20 ? 2 : 0;
  if (!windowCount) return { state: "insufficient", windows: [] };
  const windows = [];
  for (let index = 0; index < windowCount; index += 1) {
    const start = Math.floor(index * rows.length / windowCount);
    const end = Math.floor((index + 1) * rows.length / windowCount);
    const slice = rows.slice(start, end);
    windows.push(Object.freeze({
      from: slice[0].date,
      to: slice.at(-1).date,
      days: slice.length,
      ic: round(mean(slice.map((row) => row.ic)), 4),
      spread: round(median(slice.map((row) => row.spread))),
    }));
  }
  const direction = Number.isFinite(overallIc) && Math.abs(overallIc) >= 0.02 ? Math.sign(overallIc) : 0;
  if (!direction) return { state: "insufficient", windows };
  const first = windows[0].ic;
  const latest = windows.at(-1).ic;
  const latestReversed = Number.isFinite(latest) && Math.abs(latest) >= 0.02 && Math.sign(latest) !== direction;
  const significantOpposite = windows.some((window) => Number.isFinite(window.ic) && Math.abs(window.ic) >= 0.02 && Math.sign(window.ic) !== direction);
  const sameDirection = windows.filter((window) => Number.isFinite(window.ic) && Math.sign(window.ic) === direction).length;
  const state = latestReversed
    ? "reversing"
    : significantOpposite || sameDirection < Math.ceil(windows.length * 0.75)
      ? "mixed"
      : Math.abs(latest ?? 0) < 0.015 || (Math.abs(first ?? 0) >= 0.02 && Math.abs(latest ?? 0) < Math.abs(first) * 0.5)
        ? "weakening"
        : "stable";
  return { state, windows };
}

function factorForwardReturn(bars, index, horizon, board) {
  const entryIndex = index + 1;
  const targetIndex = index + horizon;
  if (entryIndex >= bars.length || targetIndex >= bars.length) return null;
  const limit = boardLimit(board);
  if ((bars[entryIndex].open / bars[index].close - 1) * 100 >= limit) return null;
  let exitIndex = targetIndex;
  while (exitIndex < bars.length) {
    const previousClose = bars[exitIndex - 1]?.close;
    const change = previousClose ? (bars[exitIndex].close / previousClose - 1) * 100 : 0;
    if (change > -limit || exitIndex - targetIndex >= A_SHARE_STRATEGY_ASSUMPTIONS.maximumExitDelayBars) break;
    exitIndex += 1;
  }
  if (exitIndex >= bars.length) return null;
  const entryPrice = bars[entryIndex].open * (1 + A_SHARE_STRATEGY_ASSUMPTIONS.slippageRate);
  const exitPrice = bars[exitIndex].close * (1 - A_SHARE_STRATEGY_ASSUMPTIONS.slippageRate);
  const paid = entryPrice * (1 + A_SHARE_STRATEGY_ASSUMPTIONS.buyCommissionRate);
  const received = exitPrice * (
    1 - A_SHARE_STRATEGY_ASSUMPTIONS.sellCommissionRate - A_SHARE_STRATEGY_ASSUMPTIONS.stampDutyRate
  );
  return (received / paid - 1) * 100;
}

function factorValues(metrics) {
  return {
    momentum20: metrics.return20,
    trendGap: (metrics.ma20 / metrics.ma60 - 1) * 100,
    volumeRatio: metrics.volumeRatio,
    highProximity: metrics.distancePriorHigh20,
    lowVolatility: -metrics.range20,
    reversal20: -metrics.return20,
  };
}

function combinationPeriod(rowsByDate, dates, leftId, rightId, leftDirection, rightDirection, minimumCrossSection) {
  const observations = [];
  for (const date of dates) {
    const rows = (rowsByDate.get(date) ?? []).filter((row) =>
      Number.isFinite(row.forwardReturn)
      && Number.isFinite(row.factors[leftId])
      && Number.isFinite(row.factors[rightId]),
    );
    if (rows.length < minimumCrossSection) continue;
    const leftRanks = rankWithTies(rows.map((row) => row.factors[leftId]));
    const rightRanks = rankWithTies(rows.map((row) => row.factors[rightId]));
    const orientedScores = rows.map((_, index) => {
      const left = leftDirection > 0 ? leftRanks[index] : rows.length + 1 - leftRanks[index];
      const right = rightDirection > 0 ? rightRanks[index] : rows.length + 1 - rightRanks[index];
      return (left + right) / 2;
    });
    const ic = correlation(rankWithTies(orientedScores), rankWithTies(rows.map((row) => row.forwardReturn)));
    if (!Number.isFinite(ic)) continue;
    const ordered = rows.map((row, index) => ({ row, score: orientedScores[index] }))
      .sort((left, right) => left.score - right.score);
    const groupSize = Math.max(1, Math.floor(ordered.length / 5));
    const bottom = mean(ordered.slice(0, groupSize).map((item) => item.row.forwardReturn));
    const top = mean(ordered.slice(-groupSize).map((item) => item.row.forwardReturn));
    observations.push({ ic, spread: top - bottom });
  }
  return {
    days: observations.length,
    ic: mean(observations.map((item) => item.ic)),
    spread: median(observations.map((item) => item.spread)),
  };
}

function buildFactorCombinations(rowsByDate, factorObservations, correlationObservations, minimumCrossSection) {
  const dates = [...rowsByDate.entries()]
    .filter(([, rows]) => rows.length >= minimumCrossSection)
    .map(([date]) => date)
    .sort();
  if (dates.length < 28) {
    return { testedPairs: 0, skippedRedundant: 0, trainThrough: null, validateFrom: null, candidates: [] };
  }
  const splitIndex = Math.min(dates.length - 8, Math.max(20, Math.floor(dates.length * 0.7)));
  const trainDates = dates.slice(0, splitIndex);
  const validationDates = dates.slice(splitIndex);
  const trainSet = new Set(trainDates);
  const directions = new Map(A_SHARE_FACTOR_SPECS.map((spec) => {
    const trainIc = mean((factorObservations.get(spec.id) ?? []).filter((item) => trainSet.has(item.date)).map((item) => item.ic));
    return [spec.id, Number.isFinite(trainIc) && Math.abs(trainIc) >= 0.02 ? Math.sign(trainIc) : 0];
  }));
  const candidates = [];
  let testedPairs = 0;
  let skippedRedundant = 0;
  for (let leftIndex = 0; leftIndex < A_SHARE_FACTOR_SPECS.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < A_SHARE_FACTOR_SPECS.length; rightIndex += 1) {
      const left = A_SHARE_FACTOR_SPECS[leftIndex];
      const right = A_SHARE_FACTOR_SPECS[rightIndex];
      const leftDirection = directions.get(left.id);
      const rightDirection = directions.get(right.id);
      if (!leftDirection || !rightDirection) continue;
      const pairRows = (correlationObservations.get(`${left.id}:${right.id}`) ?? []).filter((item) => trainSet.has(item.date));
      const trainCorrelation = median(pairRows.map((item) => item.coefficient));
      if (Number.isFinite(trainCorrelation) && Math.abs(trainCorrelation) >= 0.7) {
        skippedRedundant += 1;
        continue;
      }
      testedPairs += 1;
      const train = combinationPeriod(rowsByDate, trainDates, left.id, right.id, leftDirection, rightDirection, minimumCrossSection);
      const validation = combinationPeriod(rowsByDate, validationDates, left.id, right.id, leftDirection, rightDirection, minimumCrossSection);
      const enough = train.days >= 20 && validation.days >= 8;
      const state = !enough
        ? "insufficient"
        : validation.ic <= 0 || validation.spread <= 0
          ? "unstable"
          : train.ic >= 0.03 && validation.ic >= 0.02 && train.spread > 0
            ? "supported"
            : "watch";
      candidates.push(Object.freeze({
        id: `${left.id}+${right.id}`,
        leftId: left.id,
        leftLabel: left.label,
        leftDirection,
        rightId: right.id,
        rightLabel: right.label,
        rightDirection,
        trainDays: train.days,
        validationDays: validation.days,
        trainIc: round(train.ic, 4),
        validationIc: round(validation.ic, 4),
        trainSpread: round(train.spread),
        validationSpread: round(validation.spread),
        state,
      }));
    }
  }
  const rank = { supported: 4, watch: 3, unstable: 2, insufficient: 1 };
  candidates.sort((left, right) =>
    rank[right.state] - rank[left.state]
    || (right.validationIc ?? -2) - (left.validationIc ?? -2)
    || left.id.localeCompare(right.id),
  );
  return {
    testedPairs,
    skippedRedundant,
    trainThrough: trainDates.at(-1),
    validateFrom: validationDates[0],
    candidates: candidates.slice(0, 5),
  };
}

export function buildFactorDiagnostics(itemsInput, {
  horizon = 5,
  lookbackDays = 120,
  minimumCrossSection = 5,
} = {}) {
  const safeHorizon = Number.isInteger(horizon) && horizon >= 2 && horizon <= 20 ? horizon : 5;
  const safeLookback = Number.isInteger(lookbackDays) && lookbackDays >= 20 && lookbackDays <= 252 ? lookbackDays : 120;
  const safeMinimum = Number.isInteger(minimumCrossSection) && minimumCrossSection >= 3 && minimumCrossSection <= 100
    ? minimumCrossSection
    : 5;
  const byDate = new Map();
  const symbols = new Set();
  for (const input of Array.isArray(itemsInput) ? itemsInput : []) {
    const symbol = String(input?.symbol ?? "");
    const board = ["main", "star", "chinext"].includes(input?.board) ? input.board : "main";
    const bars = sanitizeBars(input?.bars);
    if (!/^(?:SH|SZ)\d{6}$/u.test(symbol) || bars.length < 60 + safeHorizon + 1) continue;
    symbols.add(symbol);
    const start = Math.max(60, bars.length - safeLookback - safeHorizon);
    for (let index = start; index + safeHorizon < bars.length; index += 1) {
      const metrics = strategyMetricsAt(bars, index, { sanitized: true });
      const forwardReturn = factorForwardReturn(bars, index, safeHorizon, board);
      if (!metrics || !Number.isFinite(forwardReturn)) continue;
      const row = { symbol, forwardReturn, factors: factorValues(metrics) };
      const bucket = byDate.get(metrics.date) ?? [];
      bucket.push(row);
      byDate.set(metrics.date, bucket);
    }
  }
  const observations = new Map(A_SHARE_FACTOR_SPECS.map((spec) => [spec.id, []]));
  const correlationObservations = new Map();
  for (const [date, rows] of [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (rows.length < safeMinimum) continue;
    for (const spec of A_SHARE_FACTOR_SPECS) {
      const usable = rows.filter((row) => Number.isFinite(row.factors[spec.id]));
      if (usable.length < safeMinimum) continue;
      const factorRanks = rankWithTies(usable.map((row) => row.factors[spec.id]));
      const returnRanks = rankWithTies(usable.map((row) => row.forwardReturn));
      const ic = correlation(factorRanks, returnRanks);
      if (!Number.isFinite(ic)) continue;
      const ordered = usable.slice().sort((left, right) => left.factors[spec.id] - right.factors[spec.id]);
      const groupSize = Math.max(1, Math.floor(ordered.length / 5));
      const bottom = mean(ordered.slice(0, groupSize).map((row) => row.forwardReturn));
      const top = mean(ordered.slice(-groupSize).map((row) => row.forwardReturn));
      observations.get(spec.id).push({ date, count: usable.length, ic, spread: top - bottom });
    }
    for (let leftIndex = 0; leftIndex < A_SHARE_FACTOR_SPECS.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < A_SHARE_FACTOR_SPECS.length; rightIndex += 1) {
        const left = A_SHARE_FACTOR_SPECS[leftIndex];
        const right = A_SHARE_FACTOR_SPECS[rightIndex];
        const usable = rows.filter((row) => Number.isFinite(row.factors[left.id]) && Number.isFinite(row.factors[right.id]));
        if (usable.length < safeMinimum) continue;
        const coefficient = correlation(
          rankWithTies(usable.map((row) => row.factors[left.id])),
          rankWithTies(usable.map((row) => row.factors[right.id])),
        );
        if (!Number.isFinite(coefficient)) continue;
        const key = `${left.id}:${right.id}`;
        const bucket = correlationObservations.get(key) ?? [];
        bucket.push({ date, coefficient });
        correlationObservations.set(key, bucket);
      }
    }
  }
  const factors = A_SHARE_FACTOR_SPECS.map((spec) => {
    const rows = observations.get(spec.id);
    const icMean = mean(rows.map((row) => row.ic));
    const icStd = deviation(rows.map((row) => row.ic), icMean);
    const positiveIcRate = rows.length ? rows.filter((row) => row.ic > 0).length / rows.length : null;
    const state = rows.length < 20
      ? "insufficient"
      : icMean >= 0.03 && positiveIcRate >= 0.55
        ? "supported"
        : icMean <= -0.03 && positiveIcRate <= 0.45
          ? "opposite"
          : "weak";
    const stability = rollingFactorStability(rows, icMean);
    return Object.freeze({
      ...spec,
      horizon: safeHorizon,
      days: rows.length,
      observations: rows.reduce((sum, row) => sum + row.count, 0),
      icMean: round(icMean, 4),
      icStd: round(icStd, 4),
      icIr: Number.isFinite(icMean) && Number.isFinite(icStd) && icStd > 0 ? round(icMean / icStd, 4) : null,
      positiveIcRate: round(positiveIcRate, 4),
      longShortMedian: round(median(rows.map((row) => row.spread))),
      stability: Object.freeze({
        state: stability.state,
        windows: Object.freeze(stability.windows),
      }),
      state,
    });
  });
  const correlations = [];
  for (let leftIndex = 0; leftIndex < A_SHARE_FACTOR_SPECS.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < A_SHARE_FACTOR_SPECS.length; rightIndex += 1) {
      const left = A_SHARE_FACTOR_SPECS[leftIndex];
      const right = A_SHARE_FACTOR_SPECS[rightIndex];
      const rows = correlationObservations.get(`${left.id}:${right.id}`) ?? [];
      const coefficient = median(rows.map((row) => row.coefficient));
      const sameSignRate = rows.length && Number.isFinite(coefficient)
        ? rows.filter((row) => Math.sign(row.coefficient) === Math.sign(coefficient)).length / rows.length
        : null;
      const absolute = Math.abs(coefficient ?? 0);
      correlations.push(Object.freeze({
        leftId: left.id,
        leftLabel: left.label,
        rightId: right.id,
        rightLabel: right.label,
        days: rows.length,
        coefficient: round(coefficient, 4),
        sameSignRate: round(sameSignRate, 4),
        state: rows.length < 20
          ? "insufficient"
          : absolute >= 0.7 && sameSignRate >= 0.65
            ? "redundant"
            : absolute >= 0.5
              ? "related"
              : "distinct",
      }));
    }
  }
  correlations.sort((left, right) => Math.abs(right.coefficient ?? 0) - Math.abs(left.coefficient ?? 0) || left.leftId.localeCompare(right.leftId));
  const redundantPairs = correlations.filter((item) => item.state === "redundant");
  const combinations = buildFactorCombinations(byDate, observations, correlationObservations, safeMinimum);
  return Object.freeze({
    version: 1,
    horizon: safeHorizon,
    lookbackDays: safeLookback,
    minimumCrossSection: safeMinimum,
    stocks: symbols.size,
    factors: Object.freeze(factors),
    correlations: Object.freeze(correlations),
    redundancy: Object.freeze({
      pairs: redundantPairs.length,
      summary: redundantPairs.length
        ? `发现 ${redundantPairs.length} 组稳定高相关因子，组合研究时应只保留其中一个或先做正交化。`
        : "未发现达到稳定去重门槛的因子组合。",
    }),
    combinations: Object.freeze({
      version: 1,
      testedPairs: combinations.testedPairs,
      skippedRedundant: combinations.skippedRedundant,
      trainThrough: combinations.trainThrough,
      validateFrom: combinations.validateFrom,
      candidates: Object.freeze(combinations.candidates),
      disclosure: "只测试两个因子的等权秩组合；前 70% 日期定方向并去重，后 30% 日期独立复核。通过只代表进入研究候选，不会生成或上线策略。",
    }),
    disclosure: "按每日截面秩相关计算 Rank IC；滚动稳定性将有效日期等分为最多四段，检查方向反转与衰减。相关性为因子两两 Spearman 中位数，|ρ|≥0.70 且同号率≥65% 才标记重复。T+5 使用次日开盘入场并扣除费用与滑点；日度样本相互重叠，且当前成分回看存在幸存者偏差。",
  });
}

export function matchStrategySetups(metrics, {
  board = "main",
  relativeScore = 50,
  assetType = "stock",
  environmentState = null,
  phaseState = null,
} = {}) {
  if (!metrics) return Object.freeze([]);
  const chase = board === "main" ? 5.5 : 10;
  const trend = metrics.ma20 > metrics.ma60 && metrics.close > metrics.ma20 && metrics.return60 >= 3;
  const common = trend && metrics.changePercent > -5 && metrics.changePercent < chase && metrics.extension20 <= 10;
  const limit = boardLimit(board);
  const matches = [];
  if (
    common && metrics.recentLow5Distance20 >= -2.5 && metrics.recentLow5Distance20 <= 4 &&
    metrics.extension20 >= 0 && metrics.extension20 <= 5 && metrics.volumeRatio >= 0.8 &&
    metrics.changePercent >= -1.5
  ) matches.push({ id: "trend-pullback", status: "confirmed" });
  if (
    common && metrics.distancePriorHigh20 >= -0.5 && metrics.volumeRatio >= 1.2 &&
    metrics.changePercent >= 0.5 && metrics.extension20 <= 8
  ) matches.push({ id: "volume-breakout", status: "confirmed" });
  if (
    common && metrics.range10 <= 8 && metrics.close >= metrics.priorHigh10 * 0.995 &&
    metrics.volumeRatio >= 1.1 && metrics.changePercent >= 0.3 && metrics.extension20 <= 8
  ) matches.push({ id: "tight-base-breakout", status: "confirmed" });
  if (
    metrics.return20 >= 8 && metrics.distancePriorHigh60 >= -8 && metrics.distancePriorHigh60 <= -1 &&
    metrics.volume3Ratio20 <= 0.8 && metrics.extension20 >= 0 && metrics.extension20 <= 7
  ) matches.push({ id: "strong-volume-contraction", status: "watch" });
  if (
    common && metrics.return60 >= 12 && metrics.distancePriorHigh60 >= -1.5 &&
    metrics.volumeRatio >= 1 && metrics.changePercent >= 0 && relativeScore >= 65
  ) matches.push({ id: "high-breakout", status: "confirmed" });
  if (trend && metrics.recentLow5Distance20 <= 1.2 && metrics.close >= metrics.ma20 && metrics.changePercent > 0 && metrics.volumeRatio >= 0.8) {
    matches.push({ id: "ma20-reclaim", status: "confirmed" });
  }
  if (
    metrics.close > metrics.ma60 && metrics.recentLow5Distance20 < 1 && metrics.ma20 >= metrics.ma60 * 0.98 &&
    metrics.changePercent >= 0.5 && metrics.volumeRatio >= 0.9
  ) matches.push({ id: "ma60-reclaim", status: "watch" });
  if (
    common && metrics.ma5 > metrics.ma10 && metrics.ma10 > metrics.ma20 && metrics.return20 >= 5 && metrics.return20 <= 22 &&
    metrics.volumeRatio >= 1 && metrics.volumeRatio <= 2.5 && metrics.changePercent >= 0.5
  ) matches.push({ id: "trend-acceleration", status: "confirmed" });
  if (
    trend && metrics.return20 >= 3 && metrics.return20 <= 18 && metrics.range20 <= 24 && metrics.higherLow5 &&
    metrics.volumeRatio >= 0.65 && metrics.volumeRatio <= 1.5
  ) matches.push({ id: "orderly-uptrend", status: "confirmed" });
  if (
    common && metrics.range20 <= 15 && metrics.distancePriorHigh20 >= -0.4 && metrics.volumeRatio >= 1.15 && metrics.closePosition >= 0.65
  ) matches.push({ id: "box-breakout", status: "confirmed" });
  if (
    common && metrics.range5 <= metrics.range20 * 0.55 && metrics.distancePriorHigh20 >= -1 && metrics.volumeRatio >= 1.05
  ) matches.push({ id: "volatility-contraction-breakout", status: "confirmed" });
  if (
    trend && metrics.gapPercent >= 0.8 && metrics.gapPercent <= 4.5 && metrics.closePosition >= 0.7 &&
    metrics.changePercent < chase && metrics.volumeRatio >= 1.1
  ) matches.push({ id: "gap-hold-breakout", status: "confirmed" });
  if (
    metrics.return20 <= -8 && metrics.changePercent >= 1 && metrics.closePosition >= 0.72 && metrics.volumeRatio >= 1.2
  ) matches.push({ id: "oversold-reversal", status: "watch" });
  if (
    metrics.distancePriorLow20 >= 0 && metrics.distancePriorLow20 <= 4 && metrics.changePercent > 0 && metrics.closePosition >= 0.6
  ) matches.push({ id: "double-bottom-near", status: "watch" });
  if (metrics.intradayBreakLow20 && metrics.changePercent > -1 && metrics.closePosition >= 0.65) {
    matches.push({ id: "failed-breakdown-reclaim", status: "watch" });
  }
  if (metrics.lowerShadowRatio >= 1.5 && metrics.closePosition >= 0.68 && metrics.volumeRatio >= 1.1) {
    matches.push({ id: "long-lower-shadow", status: "watch" });
  }
  if (metrics.previousChangePercent <= -5 && metrics.changePercent >= 1 && metrics.volumeRatio >= 1.1) {
    matches.push({ id: "capitulation-repair", status: "watch" });
  }
  if (
    trend && metrics.extension20 >= 0 && metrics.extension20 <= 4 && metrics.volumeRatio >= 0.4 && metrics.volumeRatio <= 0.82
  ) matches.push({ id: "low-volume-pullback", status: "watch" });
  if (metrics.close > metrics.ma20 * 0.98 && metrics.range10 <= 9 && metrics.volume3Ratio20 <= 0.62) {
    matches.push({ id: "volume-dry-up", status: "watch" });
  }
  if (
    common && metrics.changePercent >= 0.8 && metrics.changePercent < chase && metrics.closePosition >= 0.7 && metrics.volumeRatio >= 1.3
  ) matches.push({ id: "price-volume-confirmation", status: "confirmed" });
  if (
    assetType === "stock" && metrics.previousChangePercent >= limit - 0.8 && metrics.changePercent >= -2 &&
    metrics.changePercent <= 5 && metrics.close > metrics.ma20
  ) matches.push({ id: "first-limit-follow", status: "watch" });
  if (
    assetType === "stock" && metrics.previousChangePercent >= limit - 0.8 && metrics.closePosition >= 0.62 &&
    metrics.volumeRatio >= 0.9 && metrics.changePercent < chase
  ) matches.push({ id: "limit-open-repair", status: "watch" });
  if (
    assetType === "stock" && trend && metrics.changePercent >= 3.5 && metrics.changePercent < chase &&
    metrics.closePosition >= 0.82 && metrics.volumeRatio >= 1.35
  ) matches.push({ id: "strong-close-after-surge", status: "confirmed" });
  if (
    trend && metrics.return20 >= 10 && metrics.pullbackFromHigh20 <= -3 && metrics.pullbackFromHigh20 >= -10 &&
    metrics.volume3Ratio20 <= 0.85 && metrics.close > metrics.ma20
  ) matches.push({ id: "high-base-pullback", status: "watch" });
  if (
    assetType === "etf" && trend && metrics.return20 >= 2 && metrics.extension20 <= 7 &&
    metrics.volumeRatio >= 0.6 && metrics.volumeRatio <= 2
  ) matches.push({ id: "etf-trend-rotation", status: "confirmed" });
  const seen = new Set();
  const filtered = matches.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    const spec = A_SHARE_STRATEGY_SPECS.find((candidate) => candidate.id === item.id);
    if (!spec || !spec.assetTypes.includes(assetType)) return false;
    if (environmentState && !spec.marketStates.includes(environmentState)) return false;
    if (phaseState && phaseState !== "unavailable" && !spec.phaseStates.includes(phaseState)) return false;
    return true;
  });
  return Object.freeze(filtered.map((item) => Object.freeze(item)));
}

function executionOutcome(bars, signalIndex, horizon, board) {
  const entryIndex = signalIndex + 1;
  if (entryIndex >= bars.length) return { state: "pending" };
  const signalClose = bars[signalIndex].close;
  const entry = bars[entryIndex];
  const limit = boardLimit(board);
  if ((entry.open / signalClose - 1) * 100 >= limit) return { state: "unfilled", reason: "next-open-limit-up" };
  const targetIndex = entryIndex + horizon - 1;
  if (targetIndex >= bars.length) return { state: "pending" };
  let exitIndex = targetIndex;
  while (exitIndex < bars.length) {
    const previousClose = bars[exitIndex - 1]?.close;
    const change = previousClose ? (bars[exitIndex].close / previousClose - 1) * 100 : 0;
    if (change > -limit || exitIndex - targetIndex >= A_SHARE_STRATEGY_ASSUMPTIONS.maximumExitDelayBars) break;
    exitIndex += 1;
  }
  if (exitIndex >= bars.length) return { state: "pending" };
  const entryPrice = entry.open * (1 + A_SHARE_STRATEGY_ASSUMPTIONS.slippageRate);
  const exitPrice = bars[exitIndex].close * (1 - A_SHARE_STRATEGY_ASSUMPTIONS.slippageRate);
  const paid = entryPrice * (1 + A_SHARE_STRATEGY_ASSUMPTIONS.buyCommissionRate);
  const received = exitPrice * (
    1 - A_SHARE_STRATEGY_ASSUMPTIONS.sellCommissionRate - A_SHARE_STRATEGY_ASSUMPTIONS.stampDutyRate
  );
  const holdingBars = bars.slice(entryIndex, exitIndex + 1);
  const adverse = Math.min(...holdingBars.map((bar) => (bar.low / paid - 1) * 100));
  return {
    state: "evaluated",
    entryDate: entry.date,
    exitDate: bars[exitIndex].date,
    returnNet: round((received / paid - 1) * 100),
    maxAdverse: round(Math.min(0, adverse)),
    delayedExitBars: exitIndex - targetIndex,
  };
}

function nextSessionOutcome(bars, signalIndex) {
  const nextIndex = signalIndex + 1;
  if (nextIndex >= bars.length) return { state: "pending" };
  const signal = bars[signalIndex];
  const next = bars[nextIndex];
  return {
    state: "evaluated",
    date: next.date,
    openGap: round((next.open / signal.close - 1) * 100),
    closeReturn: round((next.close / signal.close - 1) * 100),
    intradayReturn: round((next.close / next.open - 1) * 100),
    maxAdverse: round(Math.min(0, (next.low / signal.close - 1) * 100)),
  };
}

function aggregateOutcomes(samples, horizon) {
  const rows = samples.filter((item) => item[`h${horizon}`]?.state === "evaluated").map((item) => item[`h${horizon}`]);
  const unfilled = samples.filter((item) => item[`h${horizon}`]?.state === "unfilled").length;
  return Object.freeze({
    evaluated: rows.length,
    unfilled,
    medianNetReturn: round(median(rows.map((item) => item.returnNet))),
    positiveRate: rows.length ? round(rows.filter((item) => item.returnNet > 0).length / rows.length, 4) : null,
    medianMaxAdverse: round(median(rows.map((item) => item.maxAdverse))),
  });
}

export const A_SHARE_STRATEGY_EVIDENCE_GATE = Object.freeze({
  version: "1.0.0",
  observe: Object.freeze({ minimumT5: 12, minimumStocks: 5 }),
  candidate: Object.freeze({
    minimumT5: 20,
    minimumT20: 12,
    minimumStocks: 8,
    minimumMedianT5: 0.5,
    minimumPositiveRateT5: 0.55,
    minimumMedianT20: 0,
    minimumPositiveRateT20: 0.5,
    minimumMedianAdverseT20: -12,
  }),
  note: "只决定研究证据等级，不自动启用策略、不改变今日选股阈值。",
});

export function assessStrategyEvidence({ stocks = 0, t5 = {}, t20 = {} } = {}) {
  const gate = A_SHARE_STRATEGY_EVIDENCE_GATE;
  if ((t5.evaluated ?? 0) < gate.observe.minimumT5 || stocks < gate.observe.minimumStocks) {
    return Object.freeze({
      version: gate.version,
      state: "accumulating",
      label: "积累样本",
      reason: `观察门需 T+5 ≥ ${gate.observe.minimumT5} 次且覆盖 ≥ ${gate.observe.minimumStocks} 只股票。`,
    });
  }
  const t5Weak = !Number.isFinite(t5.medianNetReturn) || !Number.isFinite(t5.positiveRate)
    || t5.medianNetReturn <= 0 || t5.positiveRate < 0.5;
  const t20Weak = (t20.evaluated ?? 0) >= gate.candidate.minimumT20
    && (!Number.isFinite(t20.medianNetReturn) || !Number.isFinite(t20.positiveRate)
      || t20.medianNetReturn <= gate.candidate.minimumMedianT20 || t20.positiveRate < 0.5);
  if (t5Weak || t20Weak) {
    return Object.freeze({
      version: gate.version,
      state: "caution",
      label: "证据警示",
      reason: t5Weak ? "T+5 中位收益或正收益样本比例未通过观察底线。" : "T+20 方向与短周期证据不一致。",
    });
  }
  const candidate = (t5.evaluated ?? 0) >= gate.candidate.minimumT5
    && (t20.evaluated ?? 0) >= gate.candidate.minimumT20
    && stocks >= gate.candidate.minimumStocks
    && t5.medianNetReturn >= gate.candidate.minimumMedianT5
    && t5.positiveRate >= gate.candidate.minimumPositiveRateT5
    && t20.medianNetReturn > gate.candidate.minimumMedianT20
    && t20.positiveRate >= gate.candidate.minimumPositiveRateT20
    && Number.isFinite(t20.medianMaxAdverse)
    && t20.medianMaxAdverse >= gate.candidate.minimumMedianAdverseT20;
  return Object.freeze(candidate ? {
    version: gate.version,
    state: "candidate",
    label: "研究候选",
    reason: "样本量、T+5/T+20 方向与不利波动均通过候选门；仍需样本外与成员偏差复核。",
  } : {
    version: gate.version,
    state: "watch",
    label: "进入观察",
    reason: "已通过最低观察门，但尚未同时满足候选样本量、双周期和回撤约束。",
  });
}

export function calibrateStrategyHistories(itemsInput, { maximumSignalsPerStock = 24 } = {}) {
  const samplesByStrategy = new Map(A_SHARE_STRATEGY_SPECS.map((spec) => [spec.id, []]));
  for (const input of Array.isArray(itemsInput) ? itemsInput : []) {
    const symbol = String(input?.symbol ?? "");
    const board = ["main", "star", "chinext"].includes(input?.board) ? input.board : "main";
    const bars = sanitizeBars(input?.bars);
    if (!/^(?:SH|SZ)\d{6}$/u.test(symbol) || bars.length < 81) continue;
    const lastSignal = new Map();
    const start = Math.max(60, bars.length - 180);
    for (let index = start; index < bars.length - 1; index += 1) {
      const metrics = strategyMetricsAt(bars, index);
      const matches = matchStrategySetups(metrics, { board, relativeScore: 70, assetType: aShareAssetType(symbol) });
      for (const match of matches) {
        if (match.status !== "confirmed") continue;
        if (index - (lastSignal.get(match.id) ?? -99) < 5) continue;
        const bucket = samplesByStrategy.get(match.id);
        if (bucket.filter((item) => item.symbol === symbol).length >= maximumSignalsPerStock) continue;
        lastSignal.set(match.id, index);
        bucket.push({
          symbol,
          signalDate: bars[index].date,
          h5: executionOutcome(bars, index, 5, board),
          h20: executionOutcome(bars, index, 20, board),
        });
      }
    }
  }
  const strategies = A_SHARE_STRATEGY_SPECS.map((spec) => {
    const samples = samplesByStrategy.get(spec.id);
    const stocks = new Set(samples.map((item) => item.symbol)).size;
    const t5 = aggregateOutcomes(samples, 5);
    const t20 = aggregateOutcomes(samples, 20);
    return Object.freeze({
      ...spec,
      signals: samples.length,
      stocks,
      t5,
      t20,
      evidence: assessStrategyEvidence({ stocks, t5, t20 }),
    });
  });
  const evidenceSummary = Object.freeze(Object.fromEntries(
    ["candidate", "watch", "caution", "accumulating"].map((state) => [
      state,
      strategies.filter((item) => item.evidence.state === state).length,
    ]),
  ));
  return Object.freeze({
    version: 2,
    assumptions: A_SHARE_STRATEGY_ASSUMPTIONS,
    evidenceGate: A_SHARE_STRATEGY_EVIDENCE_GATE,
    evidenceSummary,
    strategies: Object.freeze(strategies),
    disclosure: "证据门只做研究分级，不会自动启用策略。仅回放当前取得的高流动性成分历史，使用当前行业归属，存在幸存者偏差；统计是扣除假设成本后的绝对收益，不是相对指数超额。",
  });
}

export function compareStrategyEvidence(snapshotHistoryInput, currentLab, currentMarketDate) {
  const prior = (Array.isArray(snapshotHistoryInput) ? snapshotHistoryInput : [])
    .filter((snapshot) =>
      validDate(snapshot?.marketDate)
      && snapshot.marketDate < currentMarketDate
      && snapshot.session?.provisional !== true
      && Array.isArray(snapshot.strategyLab?.strategies),
    )
    .sort((left, right) => right.marketDate.localeCompare(left.marketDate))[0] ?? null;
  const currentStrategies = Array.isArray(currentLab?.strategies) ? currentLab.strategies : [];
  if (!prior) {
    return Object.freeze({
      version: 1,
      fromMarketDate: null,
      toMarketDate: currentMarketDate,
      summary: Object.freeze({ upgraded: 0, downgraded: 0, unchanged: 0, new: 0, ruleChanged: 0 }),
      changes: Object.freeze([]),
      disclosure: "尚无更早的完整收盘选股快照；从下一次运行开始比较证据等级与样本增量。",
    });
  }
  const ranks = { accumulating: 1, caution: 2, watch: 3, candidate: 4 };
  const priorById = new Map(prior.strategyLab.strategies.map((strategy) => [strategy.id, strategy]));
  const changes = currentStrategies.map((strategy) => {
    const previous = priorById.get(strategy.id);
    const currentState = ranks[strategy.evidence?.state] ? strategy.evidence.state : "accumulating";
    const previousState = previous
      ? ranks[previous?.evidence?.state] ? previous.evidence.state : "accumulating"
      : null;
    const ruleChanged = Boolean(previous && previous.ruleVersion && strategy.ruleVersion && previous.ruleVersion !== strategy.ruleVersion);
    const kind = !previous
      ? "new"
      : ruleChanged
        ? "rule-changed"
        : ranks[currentState] > ranks[previousState]
          ? "upgraded"
          : ranks[currentState] < ranks[previousState]
            ? "downgraded"
            : "unchanged";
    const delta = (next, before) => Number(next ?? 0) - Number(before ?? 0);
    return Object.freeze({
      strategyId: strategy.id,
      label: strategy.label,
      kind,
      fromState: previousState,
      toState: currentState,
      fromRuleVersion: previous?.ruleVersion ?? "",
      toRuleVersion: strategy.ruleVersion ?? "",
      deltaSignals: delta(strategy.signals, previous?.signals),
      deltaStocks: delta(strategy.stocks, previous?.stocks),
      deltaT5: delta(strategy.t5?.evaluated, previous?.t5?.evaluated),
      deltaT20: delta(strategy.t20?.evaluated, previous?.t20?.evaluated),
      reason: ruleChanged
        ? `规则版本 ${previous.ruleVersion} → ${strategy.ruleVersion}，两版结果不直接比较。`
        : strategy.evidence?.reason ?? "证据等级按当前样本重新评估。",
    });
  });
  const count = (kind) => changes.filter((item) => item.kind === kind).length;
  return Object.freeze({
    version: 1,
    fromMarketDate: prior.marketDate,
    toMarketDate: currentMarketDate,
    summary: Object.freeze({
      upgraded: count("upgraded"),
      downgraded: count("downgraded"),
      unchanged: count("unchanged"),
      new: count("new"),
      ruleChanged: count("rule-changed"),
    }),
    changes: Object.freeze(changes),
    disclosure: "只与最近一份更早的完整收盘快照比较；规则版本变化时不把样本差异解释为策略改善或恶化。",
  });
}

function setupSpec(id) {
  return A_SHARE_STRATEGY_SPECS.find((item) => item.id === id) ?? null;
}

export function buildPredictionLedger(sectorsInput, strategyLab, marketDate) {
  const stats = new Map((strategyLab?.strategies ?? []).map((item) => [item.id, item]));
  const predictions = [];
  const seen = new Set();
  for (const sector of Array.isArray(sectorsInput) ? sectorsInput : []) {
    for (const [pool, rows] of [["confirmed", sector.candidates], ["waiting", sector.timingQueue]]) {
      for (const item of Array.isArray(rows) ? rows : []) {
        if (seen.has(item.symbol) || predictions.length >= 20) continue;
        seen.add(item.symbol);
        const setup = setupSpec(item.setup?.id);
        const calibration = stats.get(item.setup?.id);
        const enough = (calibration?.t5?.evaluated ?? 0) >= 5;
        const median5 = calibration?.t5?.medianNetReturn;
        const bias = !enough || median5 == null ? "insufficient" : median5 > 1 ? "positive" : median5 < -1 ? "caution" : "neutral";
        predictions.push(Object.freeze({
          id: `${marketDate}-${item.symbol}-${item.setup?.id ?? "unknown"}`,
          marketDate,
          symbol: item.symbol,
          name: item.name,
          sectorId: sector.id,
          sectorName: sector.name,
          pool,
          setupId: item.setup?.id ?? "unknown",
          setupLabel: setup?.label ?? item.setup?.label ?? "未命名策略",
          signalClose: item.price,
          bias,
          calibration: {
            sampleSize5: calibration?.t5?.evaluated ?? 0,
            medianNetReturn5: median5 ?? null,
            positiveRate5: calibration?.t5?.positiveRate ?? null,
            sampleSize20: calibration?.t20?.evaluated ?? 0,
            medianNetReturn20: calibration?.t20?.medianNetReturn ?? null,
            positiveRate20: calibration?.t20?.positiveRate ?? null,
          },
          statement: enough
            ? `历史同策略样本的 T+5 净收益中位数为 ${median5 > 0 ? "+" : ""}${median5.toFixed(2)}%；这是历史分布，不是上涨概率。`
            : "历史有效样本不足 5 次，不输出上涨概率或收益预测，只保存条件快照等待复盘。",
        }));
      }
    }
  }
  return Object.freeze(predictions);
}

export function reviewPredictionLedger(snapshotHistoryInput, historiesInput, currentMarketDate) {
  const histories = historiesInput instanceof Map ? historiesInput : new Map(Object.entries(historiesInput ?? {}));
  const records = [];
  const seen = new Set();
  for (const snapshot of Array.isArray(snapshotHistoryInput) ? snapshotHistoryInput : []) {
    for (const prediction of Array.isArray(snapshot?.predictions) ? snapshot.predictions : []) {
      if (!prediction?.id || seen.has(prediction.id) || prediction.marketDate >= currentMarketDate) continue;
      seen.add(prediction.id);
      const bars = sanitizeBars(histories.get(prediction.symbol));
      const signalIndex = bars.findIndex((bar) => bar.date === prediction.marketDate);
      if (signalIndex < 0) continue;
      const board = /^SH68/u.test(prediction.symbol) ? "star" : /^SZ3/u.test(prediction.symbol) ? "chinext" : "main";
      records.push(Object.freeze({
        predictionId: prediction.id,
        marketDate: prediction.marketDate,
        symbol: prediction.symbol,
        name: prediction.name,
        setupId: prediction.setupId,
        setupLabel: prediction.setupLabel,
        h1: Object.freeze(nextSessionOutcome(bars, signalIndex)),
        h5: Object.freeze(executionOutcome(bars, signalIndex, 5, board)),
        h20: Object.freeze(executionOutcome(bars, signalIndex, 20, board)),
      }));
    }
  }
  const evaluated5 = records.filter((item) => item.h5.state === "evaluated");
  const evaluated20 = records.filter((item) => item.h20.state === "evaluated");
  const evaluated1 = records.filter((item) => item.h1.state === "evaluated");
  const highOpen1 = evaluated1.filter((item) => item.h1.openGap >= 5);
  return Object.freeze({
    records: Object.freeze(records.slice(0, 60)),
    summary: Object.freeze({
      saved: records.length,
      evaluated1: evaluated1.length,
      positiveRate1: evaluated1.length ? round(evaluated1.filter((item) => item.h1.closeReturn > 0).length / evaluated1.length, 4) : null,
      medianCloseReturn1: round(median(evaluated1.map((item) => item.h1.closeReturn))),
      highOpenEvaluated1: highOpen1.length,
      highOpenMedianIntradayReturn1: round(median(highOpen1.map((item) => item.h1.intradayReturn))),
      chaseRisk: highOpen1.length >= 5 && median(highOpen1.map((item) => item.h1.intradayReturn)) < 0,
      evaluated5: evaluated5.length,
      positiveRate5: evaluated5.length ? round(evaluated5.filter((item) => item.h5.returnNet > 0).length / evaluated5.length, 4) : null,
      medianNetReturn5: round(median(evaluated5.map((item) => item.h5.returnNet))),
      evaluated20: evaluated20.length,
      positiveRate20: evaluated20.length ? round(evaluated20.filter((item) => item.h20.returnNet > 0).length / evaluated20.length, 4) : null,
      medianNetReturn20: round(median(evaluated20.map((item) => item.h20.returnNet))),
    }),
  });
}
