// Explainable A-share price-pattern evidence. This is deliberately a bounded
// observation layer, not a probability model: sector gates, announcements,
// liquidity and the named strategy checks remain authoritative elsewhere.

const MINIMUM_BARS = 118;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function mean(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function percent(value, digits = 1) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
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
      !/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
      [open, high, low, close, volume].some((value) => value == null) ||
      Math.min(open, high, low, close) <= 0 || volume < 0 ||
      high < Math.max(open, close) || low > Math.min(open, close)
    ) continue;
    byDate.set(date, { date, open, high, low, close, volume });
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function ema(values, period) {
  const alpha = 2 / (period + 1);
  const result = [];
  for (const [index, value] of values.entries()) {
    result.push(index === 0 ? value : value * alpha + result[index - 1] * (1 - alpha));
  }
  return result;
}

function rollingMean(values, period) {
  const result = Array(values.length).fill(null);
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
    if (index >= period) sum -= values[index - period];
    if (index >= period - 1) result[index] = sum / period;
  }
  return result;
}

function kdj(bars) {
  let k = 50;
  let d = 50;
  const rows = [];
  for (let index = 0; index < bars.length; index += 1) {
    const window = bars.slice(Math.max(0, index - 8), index + 1);
    const low = Math.min(...window.map((bar) => bar.low));
    const high = Math.max(...window.map((bar) => bar.high));
    const rsv = high > low ? ((bars[index].close - low) / (high - low)) * 100 : 50;
    const previousK = k;
    const previousD = d;
    k = (rsv + 2 * previousK) / 3;
    d = (k + 2 * previousD) / 3;
    rows.push({ k, d, j: 3 * k - 2 * d });
  }
  return rows;
}

function directionScore(value) {
  if (value >= 1) return 100;
  if (value > 0) return 75;
  if (value > -1) return 45;
  return 15;
}

function maxDrawdown(closes) {
  let peak = closes[0];
  let maximum = 0;
  for (const close of closes) {
    peak = Math.max(peak, close);
    maximum = Math.max(maximum, (peak - close) / peak);
  }
  return maximum * 100;
}

function unavailableEvidence(bars) {
  return Object.freeze({
    version: 1,
    available: false,
    score: null,
    status: "unavailable",
    label: "形态样本不足",
    position: "需要长期趋势线",
    jValue: null,
    volumeRatio20: null,
    maxDrawdown25: null,
    keyCandleDate: "",
    components: Object.freeze([]),
    risks: Object.freeze([`当前 ${bars.length} 个交易日，需要至少 ${MINIMUM_BARS} 日才能计算四维形态证据`]),
    disclosure: "形态观察分不是上涨概率，也不会绕过板块、公告和追高过滤。",
  });
}

export function buildPatternEvidence(barsInput) {
  const bars = sanitizeBars(barsInput);
  if (bars.length < MINIMUM_BARS) return unavailableEvidence(bars);
  const closes = bars.map((bar) => bar.close);
  const volumes = bars.map((bar) => bar.volume);
  const shortTrend = ema(ema(closes, 10), 10);
  const ma14 = rollingMean(closes, 14);
  const ma28 = rollingMean(closes, 28);
  const ma57 = rollingMean(closes, 57);
  const ma114 = rollingMean(closes, 114);
  const bullBear = closes.map((_, index) => mean([ma14[index], ma28[index], ma57[index], ma114[index]]));
  const index = bars.length - 1;
  const current = bars[index];
  const short = shortTrend[index];
  const long = bullBear[index];
  const shortSlope5 = (short / shortTrend[index - 5] - 1) * 100;
  const longSlope5 = (long / bullBear[index - 5] - 1) * 100;
  const distanceShort = (current.close / short - 1) * 100;
  const distanceLong = (current.close / long - 1) * 100;
  const inBowl = short > long && current.close >= long && current.close <= short;
  const nearLong = Math.abs(distanceLong) <= 3;
  const nearShort = Math.abs(distanceShort) <= 2;
  const position = inBowl
    ? "回落双线之间"
    : nearLong
      ? "靠近中长期线"
      : nearShort
        ? "靠近短期趋势线"
        : current.close > Math.max(short, long)
          ? "趋势线上方"
          : "趋势线下方";
  const positionScore = inBowl ? 100 : nearLong ? 86 : nearShort ? 82 : current.close > Math.max(short, long) ? 58 : 20;
  const trendScore = clamp(
    (short > long ? 100 : 20) * 0.35 +
      directionScore(shortSlope5) * 0.2 +
      directionScore(longSlope5) * 0.2 +
      positionScore * 0.25,
    0,
    100,
  );

  const kdjRows = kdj(bars);
  const oscillator = kdjRows[index];
  const previousOscillator = kdjRows[index - 1];
  const jRebound = oscillator.j > kdjRows[index - 3].j;
  const kCrossD = previousOscillator.k <= previousOscillator.d && oscillator.k > oscillator.d;
  const jBase = oscillator.j <= 20 ? 84 : oscillator.j <= 50 ? 70 : oscillator.j <= 80 ? 48 : 18;
  const kdjScore = clamp(jBase + (jRebound ? 9 : -4) + (kCrossD ? 7 : 0), 0, 100);
  const jPosition = oscillator.j <= 20 ? "低位" : oscillator.j >= 80 ? "高位" : "中位";

  const recent20 = bars.slice(-20);
  const previous20Volumes = bars.slice(-21, -1).map((bar) => bar.volume);
  const averageVolume20 = mean(previous20Volumes);
  const volumeRatio20 = averageVolume20 > 0 ? current.volume / averageVolume20 : 0;
  let keyCandle = null;
  for (let barIndex = Math.max(1, bars.length - 20); barIndex < bars.length; barIndex += 1) {
    const priorVolume = bars[barIndex - 1].volume;
    if (priorVolume > 0 && bars[barIndex].volume / priorVolume >= 1.8 && bars[barIndex].close > bars[barIndex].open) {
      keyCandle = bars[barIndex];
    }
  }
  const largestVolumeBar = recent20.reduce((largest, bar) => bar.volume > largest.volume ? bar : largest, recent20[0]);
  const largestVolumeBearish = largestVolumeBar.close < largestVolumeBar.open;
  const earlierVolume = mean(volumes.slice(-25, -15));
  const middleVolume = mean(volumes.slice(-15, -5));
  const latestVolume = mean(volumes.slice(-5));
  const shrinkThenExpand = earlierVolume > 0 && middleVolume < earlierVolume * 0.9 && latestVolume > middleVolume * 1.12;
  let volumeScore = 48;
  if (keyCandle) volumeScore += 20;
  if (shrinkThenExpand) volumeScore += 14;
  if (volumeRatio20 >= 0.8 && volumeRatio20 <= 2.5) volumeScore += 13;
  else if (volumeRatio20 > 2.5) volumeScore += 5;
  else if (volumeRatio20 < 0.6) volumeScore -= 14;
  if (largestVolumeBearish) volumeScore -= 25;
  volumeScore = clamp(volumeScore, 0, 100);
  const volumeLabel = largestVolumeBearish
    ? "最大量阴线待核验"
    : shrinkThenExpand
      ? "缩量后量能恢复"
      : keyCandle
        ? "近期有放量阳线"
        : "量能尚未形成关键K线";

  const recent25 = bars.slice(-25);
  const recent10 = bars.slice(-10);
  const recent25Closes = recent25.map((bar) => bar.close);
  const drawdown25 = maxDrawdown(recent25Closes);
  const return25 = (current.close / recent25Closes[0] - 1) * 100;
  const high25 = Math.max(...recent25.map((bar) => bar.high));
  const pullback25 = (current.close / high25 - 1) * 100;
  const low10 = Math.min(...recent10.map((bar) => bar.low));
  const high10 = Math.max(...recent10.map((bar) => bar.high));
  const range10 = (high10 / low10 - 1) * 100;
  let shapeScore = 50;
  shapeScore += return25 > 0 ? 15 : -10;
  if (pullback25 >= -12 && pullback25 <= -2) shapeScore += 16;
  else if (pullback25 > -2) shapeScore += 5;
  else if (pullback25 < -20) shapeScore -= 15;
  if (range10 <= 8) shapeScore += 14;
  else if (range10 <= 12) shapeScore += 7;
  else if (range10 > 20) shapeScore -= 10;
  if (drawdown25 <= 15) shapeScore += 8;
  else if (drawdown25 > 25) shapeScore -= 14;
  shapeScore = clamp(shapeScore, 0, 100);
  const shapeLabel = range10 <= 8
    ? "窄幅整理"
    : pullback25 >= -12 && pullback25 <= -2
      ? "高点回落观察"
      : return25 > 0
        ? "趋势延续"
        : "形态修复中";

  const risks = [];
  if (largestVolumeBearish) risks.push(`近 20 日最大成交量出现在阴线（${largestVolumeBar.date}），需核验是否为资金撤退`);
  if (oscillator.j >= 80) risks.push(`KDJ J 值 ${round(oscillator.j, 1)} 处于高位，回落风险增加`);
  if (distanceShort > 10) risks.push(`价格高于短期趋势线 ${percent(distanceShort)}，形态位置偏热`);
  if (drawdown25 > 25) risks.push(`近 25 日最大回撤 ${percent(-drawdown25)}，形态稳定性偏弱`);
  const rawScore = trendScore * 0.3 + kdjScore * 0.2 + volumeScore * 0.25 + shapeScore * 0.25;
  const score = clamp(rawScore - Math.max(0, risks.length - 1) * 3, 0, 100);
  const status = risks.length >= 2 && score < 60
    ? "risk"
    : score >= 75 && short > long && (inBowl || nearLong || nearShort)
      ? "ready"
      : score >= 60
        ? "watch"
        : score >= 45
          ? "repair"
          : "weak";
  const label = status === "ready"
    ? "回落形态优先核验"
    : status === "watch"
      ? "形态进入观察区"
      : status === "repair"
        ? "形态仍在修复"
        : status === "risk"
          ? "形态风险偏高"
          : "形态证据偏弱";
  const components = [
    { id: "trend", label: "双线趋势", score: trendScore, summary: `${position} · 双线 5 日斜率 ${percent(shortSlope5)} / ${percent(longSlope5)}` },
    { id: "kdj", label: "KDJ 状态", score: kdjScore, summary: `J ${round(oscillator.j, 1)}（${jPosition}）${jRebound ? " · 近 3 日回升" : " · 尚未回升"}${kCrossD ? " · K 上穿 D" : ""}` },
    { id: "volume", label: "量能结构", score: volumeScore, summary: `${volumeLabel} · 当日/20日均量 ${round(volumeRatio20, 2)}` },
    { id: "shape", label: "价格形态", score: shapeScore, summary: `${shapeLabel} · 25 日回撤 ${percent(-drawdown25)} · 10 日振幅 ${percent(range10)}` },
  ].map((item) => Object.freeze({ ...item, score: round(item.score, 1) }));
  return Object.freeze({
    version: 1,
    available: true,
    score: round(score, 1),
    status,
    label,
    position,
    jValue: round(oscillator.j, 2),
    volumeRatio20: round(volumeRatio20, 2),
    maxDrawdown25: round(drawdown25, 2),
    keyCandleDate: keyCandle?.date ?? "",
    components: Object.freeze(components),
    risks: Object.freeze(risks.slice(0, 3)),
    disclosure: "形态观察分用于拆解趋势、KDJ、量能与价格位置，不是上涨概率，也不会绕过板块、公告和追高过滤。",
  });
}

export const A_SHARE_PATTERN_EVIDENCE = Object.freeze({
  version: 1,
  minimumBars: MINIMUM_BARS,
  weights: Object.freeze({ trend: 0.3, kdj: 0.2, volume: 0.25, shape: 0.25 }),
});
