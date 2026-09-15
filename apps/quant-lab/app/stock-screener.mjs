import { strategyMetricsAt } from "./a-share-strategy-lab.mjs";
import { buildPatternEvidence } from "./a-share-pattern-evidence.mjs";

const DAY_MS = 86_400_000;

export const STOCK_SCREEN_PROFILE = Object.freeze({
  id: "cn-trend-volume-v1",
  minimumPrice: 2,
  minimumAmount: 50_000_000,
  minimumFloatMarketCap: 2_000_000_000,
  minimumTurnover: 0.2,
  maximumTurnover: 20,
  minimumHistoryBars: 61,
  minimumReturn60: 3,
  minimumVolumeRatio: 0.8,
  maximumDistanceFromHigh60: -12,
});

function finiteNumber(value) {
  if (value === "" || value === "-" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value, maximum = 80) {
  return typeof value === "string"
    ? value.replace(/\p{Cc}+/gu, " ").trim().slice(0, maximum)
    : "";
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const instant = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
}

function validInstant(value) {
  if (typeof value !== "string" || value.length > 40) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/u.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , offsetHour = "00", offsetMinute = "00"] = match;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
  if (Number(offsetHour) > 14 || Number(offsetMinute) > 59 || (Number(offsetHour) === 14 && Number(offsetMinute) !== 0)) return false;
  const calendarDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return calendarDate.toISOString().slice(0, 10) === `${year}-${month}-${day}` && Number.isFinite(Date.parse(value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function boardFor(symbol) {
  if (/^SH68\d{4}$/u.test(symbol)) return "star";
  if (/^SZ3\d{5}$/u.test(symbol)) return "chinext";
  return "main";
}

function dailyLimitThreshold(quote) {
  if (/(?:ST|退)/iu.test(String(quote?.name ?? ""))) return 4.8;
  return ["star", "chinext"].includes(quote?.board) ? 19.5 : 9.5;
}

function priorLimitUpStreak(bars, threshold, marketDate) {
  const closed = bars.filter((bar) => bar.date < marketDate);
  let streak = 0;
  for (let index = closed.length - 1; index >= 1; index -= 1) {
    const previous = closed[index - 1].close;
    const change = previous > 0 ? (closed[index].close / previous - 1) * 100 : Number.NEGATIVE_INFINITY;
    if (change < threshold) break;
    streak += 1;
  }
  return streak;
}

export function normalizeStockQuote(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const rawSymbol = cleanText(row.symbol, 16).toLowerCase();
  const match = /^(sh|sz)(\d{6})$/u.exec(rawSymbol);
  if (!match) return null;
  const [, exchange, code] = match;
  if ((exchange === "sh" && !code.startsWith("6")) ||
      (exchange === "sz" && !/^[03]/u.test(code))) {
    return null;
  }
  const name = cleanText(row.name, 80);
  const price = finiteNumber(row.trade);
  const amount = finiteNumber(row.amount);
  const floatMarketCapWan = finiteNumber(row.nmc);
  const totalMarketCapWan = finiteNumber(row.mktcap);
  const turnover = finiteNumber(row.turnoverratio);
  const changePercent = finiteNumber(row.changepercent);
  const open = finiteNumber(row.open);
  const high = finiteNumber(row.high);
  const low = finiteNumber(row.low);
  const previousClose = finiteNumber(row.settlement);
  const volume = finiteNumber(row.volume);
  if (
    !name ||
    [price, amount, floatMarketCapWan, turnover, changePercent, open, high, low, previousClose, volume]
      .some((value) => value == null)
  ) {
    return null;
  }
  if (
    price <= 0 ||
    amount < 0 ||
    floatMarketCapWan < 0 ||
    turnover < 0 ||
    volume < 0 ||
    high < Math.max(open, price) ||
    low > Math.min(open, price)
  ) {
    return null;
  }
  const symbol = `${exchange.toUpperCase()}${code}`;
  return Object.freeze({
    symbol,
    code,
    name,
    board: boardFor(symbol),
    price,
    open,
    high,
    low,
    previousClose,
    volume,
    amount,
    turnover,
    changePercent,
    pe: finiteNumber(row.per),
    pb: finiteNumber(row.pb),
    floatMarketCap: floatMarketCapWan * 10_000,
    totalMarketCap: totalMarketCapWan == null ? null : totalMarketCapWan * 10_000,
  });
}

function baseEligibility(quote) {
  if (/(?:ST|退)/iu.test(quote.name)) return "risk-name";
  if (quote.price < STOCK_SCREEN_PROFILE.minimumPrice) return "low-price";
  if (quote.amount < STOCK_SCREEN_PROFILE.minimumAmount) return "low-amount";
  if (quote.floatMarketCap < STOCK_SCREEN_PROFILE.minimumFloatMarketCap) return "small-float-cap";
  if (quote.turnover < STOCK_SCREEN_PROFILE.minimumTurnover) return "inactive";
  if (quote.turnover > STOCK_SCREEN_PROFILE.maximumTurnover) return "extreme-turnover";
  return null;
}

function averageRanks(rows, getter) {
  const sorted = rows
    .map((row, index) => ({ row, index, value: getter(row) }))
    .filter((item) => Number.isFinite(item.value))
    .sort((left, right) => left.value - right.value || left.row.symbol.localeCompare(right.row.symbol));
  const ranks = new Map();
  if (sorted.length === 1) {
    ranks.set(sorted[0].row.symbol, 50);
    return ranks;
  }
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value) end += 1;
    const averageIndex = (start + end - 1) / 2;
    const percentile = (averageIndex / Math.max(1, sorted.length - 1)) * 100;
    for (let index = start; index < end; index += 1) {
      ranks.set(sorted[index].row.symbol, percentile);
    }
    start = end;
  }
  return ranks;
}

function turnoverQuality(turnover) {
  if (turnover <= 0) return 0;
  if (turnover <= 4) return clamp(35 + turnover * 16.25, 0, 100);
  return clamp(100 - (turnover - 4) * 7.5, 0, 100);
}

export function prepareHistoryUniverse(quotesInput, options = {}) {
  const limit = Number.isInteger(options.limit) ? clamp(options.limit, 20, 300) : 120;
  const quotes = quotesInput.map((quote) => quote?.symbol ? quote : normalizeStockQuote(quote)).filter(Boolean);
  const rejected = new Map();
  const eligible = [];
  for (const quote of quotes) {
    const reason = baseEligibility(quote);
    if (reason) rejected.set(reason, (rejected.get(reason) ?? 0) + 1);
    else eligible.push(quote);
  }
  const amountRanks = averageRanks(eligible, (quote) => Math.log10(Math.max(1, quote.amount)));
  const changeRanks = averageRanks(eligible, (quote) => clamp(quote.changePercent, -10, 10));
  const selected = eligible
    .map((quote) => ({
      ...quote,
      preScore: round(
        (amountRanks.get(quote.symbol) ?? 0) * 0.7 +
          turnoverQuality(quote.turnover) * 0.2 +
          (changeRanks.get(quote.symbol) ?? 0) * 0.1,
        4,
      ),
    }))
    .sort((left, right) => right.preScore - left.preScore || left.symbol.localeCompare(right.symbol))
    .slice(0, limit);
  return Object.freeze({
    total: quotes.length,
    eligible: Object.freeze(eligible),
    selected: Object.freeze(selected),
    rejected: Object.freeze(Object.fromEntries([...rejected.entries()].sort())),
    limit,
  });
}

function sanitizeBars(bars) {
  if (!Array.isArray(bars)) return [];
  const byDate = new Map();
  for (const value of bars) {
    const date = cleanText(value?.date, 10);
    const open = finiteNumber(value?.open);
    const high = finiteNumber(value?.high);
    const low = finiteNumber(value?.low);
    const close = finiteNumber(value?.close);
    const volume = finiteNumber(value?.volume);
    if (
      !validDate(date) ||
      [open, high, low, close, volume].some((item) => item == null || item < 0) ||
      Math.min(open, high, low, close) <= 0 ||
      high < Math.max(open, close) ||
      low > Math.min(open, close)
    ) {
      continue;
    }
    byDate.set(date, { date, open, high, low, close, volume });
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function annualizedVolatility(closes) {
  const returns = [];
  for (let index = 1; index < closes.length; index += 1) {
    if (closes[index - 1] > 0 && closes[index] > 0) {
      returns.push(Math.log(closes[index] / closes[index - 1]));
    }
  }
  if (returns.length < 2) return null;
  const average = mean(returns);
  const variance = returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

export function analyzeStockHistory(quote, barsInput, options) {
  const marketDate = options?.marketDate;
  if (!validDate(marketDate)) throw new Error("marketDate must be YYYY-MM-DD");
  const bars = sanitizeBars(barsInput).filter((bar) => bar.date <= marketDate);
  if (options?.provisional === true) {
    const liveBar = {
      date: marketDate,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      close: quote.price,
      volume: quote.volume,
    };
    const existing = bars.findIndex((bar) => bar.date === marketDate);
    if (existing >= 0) bars[existing] = liveBar;
    else bars.push(liveBar);
    bars.sort((left, right) => left.date.localeCompare(right.date));
  }
  if (bars.length < STOCK_SCREEN_PROFILE.minimumHistoryBars) return null;
  const window = bars.slice(-121);
  const current = window.at(-1);
  const historyAgeCalendarDays = calendarDaysBetween(current.date, marketDate);
  if (historyAgeCalendarDays < 0 || historyAgeCalendarDays > 10) return null;
  const closes = window.map((bar) => bar.close);
  const last20 = window.slice(-20);
  const last60 = window.slice(-60);
  const previous20 = window.slice(-21, -1);
  if (previous20.length < 20 || last60.length < 60 || closes.length < 61) return null;
  const ma20 = mean(last20.map((bar) => bar.close));
  const ma60 = mean(last60.map((bar) => bar.close));
  const return20 = (current.close / window.at(-21).close - 1) * 100;
  const return60 = (current.close / window.at(-61).close - 1) * 100;
  const high60 = Math.max(...last60.map((bar) => bar.high));
  const previousVolume20 = mean(previous20.map((bar) => bar.volume));
  const volumeRatio = previousVolume20 > 0 ? current.volume / previousVolume20 : null;
  if (!Number.isFinite(volumeRatio)) return null;
  const strategyMetrics = strategyMetricsAt(bars, bars.length - 1);
  const patternEvidence = buildPatternEvidence(bars);
  const limitThreshold = dailyLimitThreshold(quote);
  const previousLimitUpStreak = priorLimitUpStreak(bars, limitThreshold, marketDate);
  const limitUpToday = quote.changePercent >= limitThreshold;
  const touchedLimitToday = limitUpToday || (
    quote.previousClose > 0 && (quote.high / quote.previousClose - 1) * 100 >= limitThreshold
  );
  return Object.freeze({
    ...quote,
    bars: bars.length,
    lastBarDate: current.date,
    historyAgeCalendarDays,
    close: current.close,
    ma20,
    ma60,
    return20,
    return60,
    distanceHigh60: (current.close / high60 - 1) * 100,
    volumeRatio,
    extension20: (current.close / ma20 - 1) * 100,
    volatility20: annualizedVolatility(last20.map((bar) => bar.close)),
    distancePriorHigh20: strategyMetrics?.distancePriorHigh20 ?? null,
    distancePriorHigh60: strategyMetrics?.distancePriorHigh60 ?? null,
    range10: strategyMetrics?.range10 ?? null,
    range5: strategyMetrics?.range5 ?? null,
    range20: strategyMetrics?.range20 ?? null,
    recentLow5Distance20: strategyMetrics?.recentLow5Distance20 ?? null,
    volume3Ratio20: strategyMetrics?.volume3Ratio20 ?? null,
    ma5: strategyMetrics?.ma5 ?? null,
    ma10: strategyMetrics?.ma10 ?? null,
    distancePriorLow20: strategyMetrics?.distancePriorLow20 ?? null,
    distancePriorLow60: strategyMetrics?.distancePriorLow60 ?? null,
    pullbackFromHigh20: strategyMetrics?.pullbackFromHigh20 ?? null,
    closePosition: strategyMetrics?.closePosition ?? null,
    lowerShadowRatio: strategyMetrics?.lowerShadowRatio ?? null,
    gapPercent: strategyMetrics?.gapPercent ?? null,
    previousChangePercent: strategyMetrics?.previousChangePercent ?? null,
    previousVolumeRatio: strategyMetrics?.previousVolumeRatio ?? null,
    higherLow5: strategyMetrics?.higherLow5 === true,
    intradayBreakLow20: strategyMetrics?.intradayBreakLow20 === true,
    dayReturn: strategyMetrics?.changePercent ?? null,
    priorHigh10: strategyMetrics?.priorHigh10 ?? null,
    limitThreshold,
    limitUpToday,
    touchedLimitToday,
    previousLimitUpStreak,
    consecutiveLimitUps: limitUpToday ? previousLimitUpStreak + 1 : 0,
    promotedToday: limitUpToday && previousLimitUpStreak > 0,
    patternEvidence,
  });
}

function evidenceRejection(row) {
  if (row.ma20 <= row.ma60) return "ma-trend";
  if (row.close <= row.ma20) return "below-ma20";
  if (row.return20 <= 0) return "return20-not-positive";
  if (row.return60 < STOCK_SCREEN_PROFILE.minimumReturn60) return "return60-too-low";
  if (row.distanceHigh60 < STOCK_SCREEN_PROFILE.maximumDistanceFromHigh60) return "far-from-high";
  if (row.volumeRatio < STOCK_SCREEN_PROFILE.minimumVolumeRatio) return "volume-not-confirmed";
  if (row.changePercent <= -5) return "large-down-day";
  const chaseThreshold = row.board === "main" ? 7.5 : 15;
  if (row.changePercent >= chaseThreshold) return "near-limit-chase";
  if (row.extension20 > 18) return "too-extended";
  return null;
}

function candidateRisks(row) {
  const risks = [];
  if (row.changePercent > 5) risks.push(`当日已涨 ${round(row.changePercent)}%，存在追高风险`);
  if (row.distanceHigh60 > -2) risks.push("接近 60 日高位，需核验突破有效性");
  if (row.turnover > 10) risks.push(`换手 ${round(row.turnover)}%，交易拥挤`);
  if (row.volatility20 != null && row.volatility20 > 55) risks.push("近 20 日波动偏高");
  if (row.pe != null && row.pe <= 0) risks.push("滚动市盈率非正，需核验盈利质量");
  if (row.pb != null && row.pb > 10) risks.push(`市净率 ${round(row.pb)}，估值敏感`);
  if (risks.length === 0) risks.push("尚未核验公告、行业催化与基本面反方证据");
  return risks.slice(0, 3);
}

function withScores(rows) {
  const ranks = {
    return60: averageRanks(rows, (row) => row.return60),
    return20: averageRanks(rows, (row) => row.return20),
    nearHigh: averageRanks(rows, (row) => row.distanceHigh60),
    volume: averageRanks(rows, (row) => clamp(row.volumeRatio, 0, 5)),
    amount: averageRanks(rows, (row) => Math.log10(Math.max(1, row.amount))),
  };
  return rows.map((row) => {
    const components = {
      trend60: ranks.return60.get(row.symbol) ?? 0,
      trend20: ranks.return20.get(row.symbol) ?? 0,
      nearHigh: ranks.nearHigh.get(row.symbol) ?? 0,
      volume: ranks.volume.get(row.symbol) ?? 0,
      liquidity: ranks.amount.get(row.symbol) ?? 0,
      turnover: turnoverQuality(row.turnover),
    };
    let penalty = 0;
    if (row.extension20 > 12) penalty += 5;
    if (row.volatility20 != null && row.volatility20 > 60) penalty += 5;
    if (row.changePercent > 6) penalty += 5;
    const score =
      components.trend60 * 0.28 +
      components.trend20 * 0.18 +
      components.nearHigh * 0.15 +
      components.volume * 0.15 +
      components.liquidity * 0.14 +
      components.turnover * 0.1 -
      penalty;
    return Object.freeze({ ...row, components, penalty, score: round(clamp(score, 0, 100), 1) });
  });
}

function formatYi(value) {
  return `${round(value / 100_000_000, 1).toLocaleString("zh-CN")} 亿`;
}

function summarizeRejection(row, reason) {
  const labels = {
    "ma-trend": "20 日均线尚未高于 60 日均线",
    "below-ma20": "价格仍在 20 日均线下方",
    "return20-not-positive": "20 日收益尚未转正",
    "return60-too-low": "60 日趋势强度不足",
    "far-from-high": "距离 60 日高点过远",
    "volume-not-confirmed": "量比未达到证据门槛",
    "large-down-day": "当日跌幅过大",
    "near-limit-chase": "当日涨幅接近涨停区间，拒绝追高",
    "too-extended": "偏离 20 日均线过远",
  };
  return `${row.symbol} ${row.name} 看似活跃，但因${labels[reason] ?? reason}被排除。`;
}

export function buildStockScreenReport(input) {
  const { preparation, histories, marketDate, asOf, generatedAt } = input;
  if (!validDate(marketDate)) throw new Error("marketDate must be YYYY-MM-DD");
  if (!validInstant(asOf) || !validInstant(generatedAt)) {
    throw new Error("asOf/generatedAt must be timezone-qualified ISO timestamps");
  }
  if (asOf.slice(0, 10) !== marketDate) {
    throw new Error("marketDate must match asOf local date");
  }
  if (Date.parse(asOf) > Date.parse(generatedAt) + 60 * 60 * 1_000) {
    throw new Error("asOf cannot be after generatedAt");
  }
  const historyMap = histories instanceof Map ? histories : new Map(Object.entries(histories ?? {}));
  const analyzed = preparation.selected.flatMap((quote) => {
    const row = analyzeStockHistory(quote, historyMap.get(quote.symbol), {
      marketDate,
      provisional: input.provisional === true,
    });
    return row ? [row] : [];
  });
  const scored = withScores(analyzed);
  const evidenceRows = [];
  const evidenceRejected = [];
  for (const row of scored) {
    const reason = evidenceRejection(row);
    if (reason) evidenceRejected.push({ row, reason });
    else evidenceRows.push(row);
  }
  evidenceRows.sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
  evidenceRejected.sort((left, right) => right.row.score - left.row.score || left.row.symbol.localeCompare(right.row.symbol));
  const top = Number.isInteger(input.top) ? clamp(input.top, 3, 10) : 10;
  const candidates = evidenceRows.slice(0, top);
  const coverage = preparation.selected.length === 0 ? 0 : analyzed.length / preparation.selected.length;
  const laggedHistory = analyzed.filter((row) => row.historyAgeCalendarDays > 0).length;
  const provisionalLabel = input.provisional === true ? "盘中初筛" : "最近完整行情";
  const summary = candidates.length
    ? `从当前在市的 ${preparation.total.toLocaleString("zh-CN")} 只沪深 A 股中先做风险与流动性过滤，再对预排前 ${preparation.selected.length.toLocaleString("zh-CN")} 只读取 120 日前复权行情；${evidenceRows.length.toLocaleString("zh-CN")} 只通过证据筛选，这里展示相对得分最高的 ${candidates.length} 只。${provisionalLabel}只用于缩小研究范围。`
    : `本次扫描覆盖 ${preparation.total.toLocaleString("zh-CN")} 只沪深 A 股，并对基础池预排前 ${preparation.selected.length.toLocaleString("zh-CN")} 只读取历史行情，但没有标的同时通过趋势与量价证据门槛。系统不会为了凑数降低标准。`;
  const coverageRiskBase = coverage < 0.9
    ? `历史行情覆盖仅 ${round(coverage * 100, 1)}%，未成功读取的标的已排除，结果可能不完整。`
    : `历史行情覆盖 ${round(coverage * 100, 1)}%；失败标的不会以缺数补零。`;
  const coverageRisk = laggedHistory
    ? `${coverageRiskBase}另有 ${laggedHistory} 只合格日线截止早于 ${marketDate}，已保留各自真实截止日并将报告标为谨慎。`
    : coverageRiskBase;
  const counterexample = evidenceRejected[0]
    ? summarizeRejection(evidenceRejected[0].row, evidenceRejected[0].reason)
    : "没有可展示的高分排除反例。";
  return Object.freeze({
    schemaVersion: 1,
    kind: "candidates",
    title: `A 股趋势量价候选 · ${provisionalLabel}`,
    subject: "A股当前在市股票池",
    marketDate,
    asOf,
    generatedAt,
    status: candidates.length === 0 ? "unavailable" : input.provisional === true || coverage < 0.9 || laggedHistory > 0 ? "caution" : "neutral",
    summary,
    facts: [
      { label: "当前股票池", value: `${preparation.total.toLocaleString("zh-CN")} 只`, tone: "neutral" },
      { label: "基础通过", value: `${preparation.eligible.length.toLocaleString("zh-CN")} 只`, tone: "neutral" },
      {
        label: "历史覆盖",
        value: `${analyzed.length}/${preparation.selected.length}${laggedHistory ? ` · ${laggedHistory} 只滞后` : ""}`,
        tone: coverage < 0.9 || laggedHistory ? "warning" : "positive",
      },
      { label: "证据通过", value: `${evidenceRows.length.toLocaleString("zh-CN")} 只`, tone: candidates.length ? "positive" : "warning" },
      { label: "风险门槛", value: "非 ST/退 · 价格≥2 · 换手 0.2–20%", tone: "neutral" },
      { label: "流动性门槛", value: "成交额≥0.5 亿 · 流通市值≥20 亿", tone: "neutral" },
      { label: "趋势量能", value: "MA20>MA60 · 60日≥3% · 量比≥0.8", tone: "neutral" },
      { label: "筛选口径", value: "趋势量价固定规则 v1", tone: "neutral" },
    ],
    items: candidates.map((row) => ({
      symbol: row.symbol,
      name: row.name,
      title: `相对得分 ${row.score.toFixed(1)} · 60 日 ${round(row.return60)}%`,
      detail: [
        `20 日 ${round(row.return20)}%`,
        `日线截至 ${row.lastBarDate}`,
        `距 60 日高点 ${round(row.distanceHigh60)}%`,
        `量比 ${round(row.volumeRatio)}`,
        `换手 ${round(row.turnover)}%`,
        `成交额 ${formatYi(row.amount)}`,
        `20 日年化波动 ${row.volatility20 == null ? "不可用" : `${round(row.volatility20)}%`}`,
      ].join(" · "),
      risk: candidateRisks(row).join("；"),
    })),
    risks: [
      `股票池是当前在市快照，不含历史退市与当时可得成分；历史阶段只覆盖基础门槛后预排的 ${preparation.selected.length.toLocaleString("zh-CN")} 只，相对排序不能证明绝对历史收益。`,
      "评分只使用价格、成交量、流动性与风险门槛，不包含公告真伪、行业催化、财务质量或个性化持仓。",
      input.provisional === true
        ? "当前为盘中数据，成交额、成交量和当日涨跌尚未完成；收盘后必须重新扫描。"
        : "未校验交易所节假日；marketDate 与数据时点必须一起阅读。",
      coverageRisk,
      counterexample,
      "候选只代表值得继续核验，不构成买卖推荐、仓位建议或收益承诺。",
    ],
    sources: [
      { label: "新浪财经沪深 A 股行情快照", url: "https://vip.stock.finance.sina.com.cn/mkt/", asOf },
      { label: "腾讯证券前复权日线", url: "https://gu.qq.com/", asOf: marketDate },
    ],
  });
}

export function calendarDaysBetween(from, to) {
  if (!validDate(from) || !validDate(to)) throw new Error("dates must be YYYY-MM-DD");
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}
