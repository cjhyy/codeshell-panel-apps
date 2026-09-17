const STRENGTH_LABELS = Object.freeze({
  strong: "强势",
  lean_strong: "偏强",
  range: "震荡",
  lean_weak: "偏弱",
  weak: "弱势",
});

const PHASE_LABELS = Object.freeze({
  ice: "冰点",
  ignite: "启动",
  rally: "主升",
  climax: "高潮",
  ebb: "退潮",
  repair: "修复",
  unavailable: "样本积累中",
});

const PHASE_POSITIVE = new Set(["ignite", "rally", "climax"]);
const STRENGTH_WEAK = new Set(["lean_weak", "weak"]);
const MIN_PHASE_UNIVERSE = 1_000;
const MIN_PHASE_DAYS = 5;

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits = 1) {
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
  const instant = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
}

function limitPercent(quote) {
  if (/(?:ST|退)/iu.test(String(quote?.name ?? ""))) return 4.8;
  return ["star", "chinext"].includes(quote?.board) ? 19.5 : 9.5;
}

function usableQuote(quote) {
  return quote && /^(?:SH|SZ)\d{6}$/u.test(String(quote.symbol ?? "")) &&
    Number.isFinite(quote.price) && quote.price > 0 &&
    Number.isFinite(quote.changePercent) && Math.abs(quote.changePercent) <= 30;
}

function phaseRank(snapshot) {
  if (snapshot?.session?.phase === "close") return 3;
  if (snapshot?.session?.phase === "intraday") return 2;
  return 1;
}

function normalizeDailySnapshots(historyInput, currentInput) {
  const byDate = new Map();
  for (const snapshot of Array.isArray(historyInput) ? historyInput : []) {
    if (
      snapshot?.kind !== "a-share-realtime-daily-snapshot" ||
      !validDate(snapshot.marketDate) ||
      !Array.isArray(snapshot.quotes)
    ) continue;
    const existing = byDate.get(snapshot.marketDate);
    if (!existing || phaseRank(snapshot) > phaseRank(existing) || (
      phaseRank(snapshot) === phaseRank(existing) &&
      Date.parse(snapshot.generatedAt ?? "") > Date.parse(existing.generatedAt ?? "")
    )) byDate.set(snapshot.marketDate, snapshot);
  }
  if (currentInput && validDate(currentInput.marketDate) && Array.isArray(currentInput.quotes)) {
    byDate.set(currentInput.marketDate, {
      kind: "a-share-realtime-daily-snapshot",
      marketDate: currentInput.marketDate,
      generatedAt: currentInput.generatedAt,
      session: { phase: currentInput.provisional ? "intraday" : "close" },
      quotes: currentInput.quotes,
    });
  }
  return [...byDate.values()].sort((left, right) => left.marketDate.localeCompare(right.marketDate));
}

function buildDailySeries(historyInput, currentInput) {
  const snapshots = normalizeDailySnapshots(historyInput, currentInput);
  const closeHistory = new Map();
  let previousLimitSymbols = new Set();
  let previousStreaks = new Map();
  const rows = [];
  for (const snapshot of snapshots) {
    const quotes = snapshot.quotes.filter(usableQuote);
    if (!quotes.length) continue;
    const changes = quotes.map((quote) => quote.changePercent);
    const up = changes.filter((value) => value > 0).length;
    const down = changes.filter((value) => value < 0).length;
    const flat = quotes.length - up - down;
    const currentLimitSymbols = new Set();
    const touchedLimitSymbols = new Set();
    const streaks = new Map();
    let aboveMa20 = 0;
    let ma20Coverage = 0;
    for (const quote of quotes) {
      const threshold = limitPercent(quote);
      const sealed = quote.changePercent >= threshold;
      const touched = sealed || (
        Number.isFinite(quote.high) && Number.isFinite(quote.previousClose) && quote.previousClose > 0 &&
        (quote.high / quote.previousClose - 1) * 100 >= threshold
      );
      if (sealed) currentLimitSymbols.add(quote.symbol);
      if (touched) touchedLimitSymbols.add(quote.symbol);
      streaks.set(quote.symbol, sealed ? (previousStreaks.get(quote.symbol) ?? 0) + 1 : 0);
      const history = closeHistory.get(quote.symbol) ?? [];
      history.push(quote.price);
      if (history.length > 30) history.shift();
      closeHistory.set(quote.symbol, history);
      if (history.length >= 20) {
        const ma20 = mean(history.slice(-20));
        if (Number.isFinite(ma20)) {
          ma20Coverage += 1;
          if (quote.price > ma20) aboveMa20 += 1;
        }
      }
    }
    const streakValues = [...streaks.values()];
    const maxConsecutive = Math.max(0, ...streakValues);
    const rungs = new Set(streakValues.filter((value) => value >= 2));
    const promoted = [...previousLimitSymbols].filter((symbol) => currentLimitSymbols.has(symbol)).length;
    const strongUp = changes.filter((value) => value >= 3).length;
    const strongDown = changes.filter((value) => value <= -3).length;
    rows.push(Object.freeze({
      date: snapshot.marketDate,
      total: quotes.length,
      up,
      down,
      flat,
      upRatio: up / quotes.length,
      downRatio: down / quotes.length,
      netBreadth: (up - down) / quotes.length,
      medianChange: median(changes) ?? 0,
      strongUpRatio: strongUp / quotes.length,
      strongDownRatio: strongDown / quotes.length,
      limitUp: currentLimitSymbols.size,
      limitDown: quotes.filter((quote) => quote.changePercent <= -limitPercent(quote)).length,
      maxConsecutive,
      firstBoard: streakValues.filter((value) => value === 1).length,
      ge2Count: streakValues.filter((value) => value >= 2).length,
      ge3Count: streakValues.filter((value) => value >= 3).length,
      ge5Count: streakValues.filter((value) => value >= 5).length,
      promotionPool: previousLimitSymbols.size,
      promotionRate: previousLimitSymbols.size >= 10 ? promoted / previousLimitSymbols.size : null,
      sealRate: touchedLimitSymbols.size ? currentLimitSymbols.size / touchedLimitSymbols.size : 0.5,
      ladderCompleteness: maxConsecutive >= 3 ? rungs.size / (maxConsecutive - 1) : 0,
      aboveMa20Ratio: ma20Coverage >= Math.min(1_000, quotes.length * 0.6) ? aboveMa20 / ma20Coverage : null,
      trendCoverage: ma20Coverage,
      amount: quotes.reduce((sum, quote) => sum + (Number.isFinite(quote.amount) ? quote.amount : 0), 0),
    }));
    previousLimitSymbols = currentLimitSymbols;
    previousStreaks = streaks;
  }
  return Object.freeze(rows);
}

function trendScore(row, indexTrends) {
  const trends = Array.isArray(indexTrends) ? indexTrends : [];
  if (trends.length) {
    const values = trends.map((trend) => {
      if (trend.regime === "bullish") return 90;
      if (trend.regime === "improving") return 68;
      if (trend.regime === "weakening") return 35;
      if (trend.regime === "bearish") return 12;
      return 50;
    });
    return { value: mean(values) ?? 50, evidence: `${trends.length} 个宽基的 20/60/120 日趋势` };
  }
  if (Number.isFinite(row.aboveMa20Ratio)) {
    return { value: row.aboveMa20Ratio * 100, evidence: `${row.trendCoverage} 只股票的 MA20 覆盖` };
  }
  return {
    value: clamp(50 + row.netBreadth * 70),
    evidence: "历史趋势覆盖不足，暂用当日市场宽度降级",
  };
}

function classifyStrength(row, indexTrends = []) {
  if (!row) {
    return Object.freeze({
      state: "range",
      label: STRENGTH_LABELS.range,
      score: 50,
      candidateLimit: 2,
      confidence: "low",
      reason: "市场数据不足，暂不扩大候选范围。",
      dimensions: Object.freeze([]),
    });
  }
  const profit = clamp(
    50 + row.netBreadth * 72 + row.medianChange * 8 +
    (row.strongUpRatio - row.strongDownRatio) * 130,
  );
  const speculation = clamp(
    35 + Math.min(30, row.limitUp / Math.max(1, row.total) * 3_500) +
    Math.min(18, row.maxConsecutive * 3) +
    (Number.isFinite(row.promotionRate) ? (row.promotionRate - 0.18) * 55 : 0) +
    (row.sealRate - 0.55) * 28 -
    Math.min(25, row.limitDown / Math.max(1, row.total) * 3_500),
  );
  const resilience = clamp(
    50 + row.netBreadth * 62 - row.strongDownRatio * 180 + row.strongUpRatio * 70,
  );
  const trend = trendScore(row, indexTrends);
  const score = round(profit * 0.32 + speculation * 0.18 + resilience * 0.2 + trend.value * 0.3, 0);
  const state = score >= 67
    ? "strong"
    : score >= 56
      ? "lean_strong"
      : score >= 44
        ? "range"
        : score >= 33
          ? "lean_weak"
          : "weak";
  const candidateLimit = { strong: 3, lean_strong: 3, range: 2, lean_weak: 1, weak: 0 }[state];
  const dimensions = Object.freeze([
    Object.freeze({ id: "profit", label: "赚钱效应", value: round(profit, 0), evidence: `上涨 ${row.up} / 下跌 ${row.down} · 中位 ${round(row.medianChange, 2)}%` }),
    Object.freeze({ id: "speculation", label: "投机热度", value: round(speculation, 0), evidence: `涨停近似 ${row.limitUp} · 最高连板 ${row.maxConsecutive}` }),
    Object.freeze({ id: "resilience", label: "抗跌能力", value: round(resilience, 0), evidence: `大跌占比 ${round(row.strongDownRatio * 100, 1)}%` }),
    Object.freeze({ id: "trend", label: "趋势状态", value: round(trend.value, 0), evidence: trend.evidence }),
  ]);
  const best = dimensions.slice().sort((left, right) => right.value - left.value)[0];
  const worst = dimensions.slice().sort((left, right) => left.value - right.value)[0];
  return Object.freeze({
    state,
    label: STRENGTH_LABELS[state],
    score,
    candidateLimit,
    confidence: row.total >= 4_000 && (Number.isFinite(row.aboveMa20Ratio) || indexTrends.length >= 3) ? "high" : row.total >= 1_000 ? "medium" : "low",
    reason: `${STRENGTH_LABELS[state]} ${score} 分；${best.label}较强，${worst.label}是当前约束。`,
    dimensions,
  });
}

function ema(values, alpha = 1 / 3) {
  const out = [];
  let current = null;
  for (const value of values) {
    if (!Number.isFinite(value)) {
      out.push(current);
      continue;
    }
    current = current == null ? value : current + alpha * (value - current);
    out.push(current);
  }
  return out;
}

function rawPhaseAt(index, series) {
  const height = series.height[index] ?? 0;
  const first = series.first[index] ?? 0;
  const ge2 = series.ge2[index] ?? 0;
  const promotion = series.promotion[index] ?? 0;
  const seal = series.seal[index] ?? 0.5;
  const priorGe2 = series.ge2[Math.max(0, index - 5)] ?? ge2;
  const priorHeight = series.height[Math.max(0, index - 5)] ?? height;
  if (ge2 >= 50 || first >= 220) return "climax";
  if ((height >= 7 && ge2 >= 15 && promotion >= 0.23) || (promotion >= 0.3 && ge2 >= 12 && height >= 5)) return "rally";
  if (height <= 4 && ge2 <= 6 && first <= 24) return "ice";
  const fromHigh = priorGe2 >= 12 || priorHeight >= 6;
  if ((fromHigh && promotion <= 0.15 && ge2 < priorGe2) || (promotion <= 0.13 && seal <= 0.57)) return "ebb";
  if ((ge2 - priorGe2 >= 3 && ge2 >= 8 && promotion >= 0.2) || (height - priorHeight >= 1 && height >= 5 && promotion >= 0.19)) return "ignite";
  return "repair";
}

function buildPhase(rows) {
  const eligible = rows.filter((row) => row.total >= MIN_PHASE_UNIVERSE);
  if (eligible.length < MIN_PHASE_DAYS) {
    return Object.freeze({
      state: "unavailable",
      label: PHASE_LABELS.unavailable,
      available: false,
      duration: 0,
      confidence: "low",
      pendingLabel: "",
      reason: `需要至少 ${MIN_PHASE_DAYS} 个完整市场日；当前已有 ${eligible.length} 个。`,
      metrics: Object.freeze({}),
      timeline: Object.freeze([]),
    });
  }
  const smooth = {
    height: ema(eligible.map((row) => row.maxConsecutive)),
    first: ema(eligible.map((row) => row.firstBoard)),
    ge2: ema(eligible.map((row) => row.ge2Count)),
    promotion: ema(eligible.map((row) => row.promotionRate)),
    seal: ema(eligible.map((row) => row.sealRate)),
  };
  let current = null;
  let pending = null;
  let pendingDays = 0;
  const timeline = [];
  for (let index = 0; index < eligible.length; index += 1) {
    let raw = rawPhaseAt(index, smooth);
    const strength = classifyStrength(eligible[index]);
    if (PHASE_POSITIVE.has(raw) && STRENGTH_WEAK.has(strength.state)) raw = "repair";
    if (current == null) current = raw;
    else if (raw === current) {
      pending = null;
      pendingDays = 0;
    } else if (raw === pending) {
      pendingDays += 1;
      if (pendingDays >= 2) {
        current = raw;
        pending = null;
        pendingDays = 0;
      }
    } else {
      pending = raw;
      pendingDays = 1;
    }
    timeline.push(Object.freeze({ date: eligible[index].date, state: current, label: PHASE_LABELS[current] }));
  }
  const latest = eligible.at(-1);
  let duration = 0;
  for (let index = timeline.length - 1; index >= 0 && timeline[index].state === current; index -= 1) duration += 1;
  return Object.freeze({
    state: current,
    label: PHASE_LABELS[current],
    available: true,
    duration,
    confidence: eligible.length >= 20 ? "high" : eligible.length >= 10 ? "medium" : "low",
    pendingLabel: pending ? PHASE_LABELS[pending] : "",
    reason: pending
      ? `${PHASE_LABELS[current]}已持续 ${duration} 日；${PHASE_LABELS[pending]}信号正在等待第二日确认。`
      : `${PHASE_LABELS[current]}已持续 ${duration} 日；阶段使用平滑后的连板高度、宽度、晋级率和封板率。`,
    metrics: Object.freeze({
      maxConsecutive: latest.maxConsecutive,
      firstBoard: latest.firstBoard,
      ge2Count: latest.ge2Count,
      ge3Count: latest.ge3Count,
      ge5Count: latest.ge5Count,
      promotionRate: round(latest.promotionRate, 4),
      sealRate: round(latest.sealRate, 4),
      ladderCompleteness: round(latest.ladderCompleteness, 4),
    }),
    timeline: Object.freeze(timeline.slice(-12)),
  });
}

function crossSectionRanks(rows, getter) {
  const sorted = rows.slice().sort((left, right) => {
    const difference = getter(left) - getter(right);
    return difference || left.id.localeCompare(right.id);
  });
  const ranks = new Map();
  if (sorted.length === 1) {
    ranks.set(sorted[0].id, 50);
    return ranks;
  }
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && getter(sorted[end]) === getter(sorted[start])) end += 1;
    const percentile = ((start + end - 1) / 2 / Math.max(1, sorted.length - 1)) * 100;
    for (let index = start; index < end; index += 1) ranks.set(sorted[index].id, percentile);
    start = end;
  }
  return ranks;
}

export function buildMarketMainlines(sectorsInput) {
  const sectors = Array.isArray(sectorsInput) ? sectorsInput : [];
  const eligible = sectors.filter((sector) =>
    sector && Number.isFinite(sector.relativeScore) &&
    sector.metrics?.sampleSize >= 3 && sector.stage !== "unavailable",
  );
  const hasLadderSignal = eligible.some((sector) => Number(sector.metrics?.limitUpCount) > 0);
  const ladderRanks = hasLadderSignal ? {
    limitUp: crossSectionRanks(eligible, (sector) => Number(sector.metrics?.limitUpCount ?? 0)),
    maxBoards: crossSectionRanks(eligible, (sector) => Number(sector.metrics?.maxBoards ?? 0)),
    rungs: crossSectionRanks(eligible, (sector) => Number(sector.metrics?.rungsFilled ?? 0)),
    ge2: crossSectionRanks(eligible, (sector) => Number(sector.metrics?.ge2Count ?? 0)),
  } : null;
  const scored = eligible.map((sector) => {
    const ladderScore = ladderRanks
      ? round(
          (ladderRanks.limitUp.get(sector.id) ?? 0) * 0.35 +
          (ladderRanks.maxBoards.get(sector.id) ?? 0) * 0.25 +
          (ladderRanks.rungs.get(sector.id) ?? 0) * 0.25 +
          (ladderRanks.ge2.get(sector.id) ?? 0) * 0.15,
          1,
        )
      : null;
    return {
      sector,
      ladderScore,
      score: ladderScore == null
        ? sector.relativeScore
        : round(ladderScore * 0.6 + sector.relativeScore * 0.4, 1),
    };
  }).sort((left, right) => right.score - left.score || left.sector.id.localeCompare(right.sector.id));
  return Object.freeze(scored.slice(0, 3).map(({ sector, ladderScore, score }, index) => Object.freeze({
    id: sector.id,
    name: sector.name,
    role: index === 0 && (
      ["advancing", "expansion"].includes(sector.stage) || Number(ladderScore) >= 60
    )
      ? "mainline"
      : ["emerging", "repair"].includes(sector.stage)
        ? "rotation"
        : "watch",
    roleLabel: index === 0 && (
      ["advancing", "expansion"].includes(sector.stage) || Number(ladderScore) >= 60
    )
      ? "当前主线"
      : ["emerging", "repair"].includes(sector.stage)
        ? "次级轮动"
        : "异动观察",
    stage: sector.stage,
    stageLabel: sector.stageLabel,
    score,
    method: ladderScore == null ? "trend-relative" : "sample-ladder",
    methodLabel: ladderScore == null ? "趋势相对强度" : "样本梯队＋趋势",
    ladderScore,
    trendScore: sector.relativeScore,
    sampleSize: sector.metrics.sampleSize,
    constituentCount: Number.isFinite(sector.metrics.constituentCount) ? sector.metrics.constituentCount : null,
    memberCoverage: Number.isFinite(sector.metrics.memberCoverage) ? sector.metrics.memberCoverage : null,
    limitUpCount: Number(sector.metrics.limitUpCount ?? 0),
    maxBoards: Number(sector.metrics.maxBoards ?? 0),
    rungsFilled: Number(sector.metrics.rungsFilled ?? 0),
    ge2Count: Number(sector.metrics.ge2Count ?? 0),
    evidence: Object.freeze(ladderScore == null
      ? (sector.evidence ?? []).slice(0, 2)
      : [
          `样本涨停 ${Number(sector.metrics.limitUpCount ?? 0)} · 最高 ${Number(sector.metrics.maxBoards ?? 0)} 板 · 梯队 ${Number(sector.metrics.rungsFilled ?? 0)} 档 · 二板以上 ${Number(sector.metrics.ge2Count ?? 0)}`,
          `趋势相对强度 ${sector.relativeScore} · 样本 ${sector.metrics.sampleSize}/${Number.isFinite(sector.metrics.constituentCount) ? sector.metrics.constituentCount : "—"}`,
        ]),
    risk: ladderScore == null
      ? String(sector.risks?.[0] ?? "板块持续性仍需下一交易日确认")
      : "梯队分来自当前高流动性成分样本，不代表板块全部股票或历史真实成分。",
  })));
}

export function buildMarketEnvironment({
  quotes = [],
  marketDate,
  generatedAt = "",
  provisional = false,
  historySnapshots = [],
  indexTrends = [],
  sectors = [],
} = {}) {
  const daily = buildDailySeries(historySnapshots, { quotes, marketDate, generatedAt, provisional });
  const current = daily.at(-1) ?? null;
  const strength = classifyStrength(current, indexTrends);
  const phase = buildPhase(daily);
  return Object.freeze({
    version: 1,
    state: strength.state,
    label: strength.label,
    score: strength.score,
    reason: strength.reason,
    candidateLimit: strength.candidateLimit,
    confidence: strength.confidence,
    dimensions: strength.dimensions,
    phase,
    mainlines: buildMarketMainlines(sectors),
    historyDays: daily.length,
    methodology: "市场强弱与情绪阶段并行；阶段只在完整市场历史达到门槛后启用，不生成交易信号。",
  });
}

function parsedNumber(value, minimum, maximum, label, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`${label}无效`);
  return number;
}

function parsedText(value, maximum = 240) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, maximum)
    : "";
}

export function parseMarketEnvironment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1) {
    throw new Error("市场环境版本无效");
  }
  const state = Object.hasOwn(STRENGTH_LABELS, value.state) ? value.state : null;
  if (!state || parsedText(value.label, 20) !== STRENGTH_LABELS[state]) throw new Error("市场强弱状态无效");
  if (!Array.isArray(value.dimensions) || value.dimensions.length !== 4) throw new Error("市场环境分项无效");
  const dimensionIds = new Set();
  const dimensions = value.dimensions.map((item) => {
    const id = parsedText(item?.id, 20);
    if (!new Set(["profit", "speculation", "resilience", "trend"]).has(id) || dimensionIds.has(id)) {
      throw new Error("市场环境分项重复或无效");
    }
    dimensionIds.add(id);
    return Object.freeze({
      id,
      label: parsedText(item.label, 24),
      value: parsedNumber(item.value, 0, 100, `${id}分数`),
      evidence: parsedText(item.evidence, 180),
    });
  });
  const phaseState = Object.hasOwn(PHASE_LABELS, value.phase?.state) ? value.phase.state : null;
  if (!phaseState || parsedText(value.phase?.label, 20) !== PHASE_LABELS[phaseState]) throw new Error("市场阶段无效");
  const available = value.phase?.available === true;
  if (available !== (phaseState !== "unavailable")) throw new Error("市场阶段可用状态冲突");
  const metricsInput = value.phase?.metrics && typeof value.phase.metrics === "object" && !Array.isArray(value.phase.metrics)
    ? value.phase.metrics
    : {};
  const metrics = available ? Object.freeze({
    maxConsecutive: parsedNumber(metricsInput.maxConsecutive, 0, 100, "最高连板"),
    firstBoard: parsedNumber(metricsInput.firstBoard, 0, 20_000, "首板数"),
    ge2Count: parsedNumber(metricsInput.ge2Count, 0, 20_000, "二板以上数"),
    ge3Count: parsedNumber(metricsInput.ge3Count, 0, 20_000, "三板以上数"),
    ge5Count: parsedNumber(metricsInput.ge5Count, 0, 20_000, "五板以上数"),
    promotionRate: parsedNumber(metricsInput.promotionRate, 0, 1, "晋级率", { nullable: true }),
    sealRate: parsedNumber(metricsInput.sealRate, 0, 1, "封板率"),
    ladderCompleteness: parsedNumber(metricsInput.ladderCompleteness, 0, 1, "梯队完整度"),
  }) : Object.freeze({});
  if (!Array.isArray(value.phase?.timeline) || value.phase.timeline.length > 12) throw new Error("市场阶段时间线无效");
  const timeline = value.phase.timeline.map((item) => {
    const itemState = Object.hasOwn(PHASE_LABELS, item?.state) && item.state !== "unavailable" ? item.state : null;
    if (!itemState || !validDate(item.date) || parsedText(item.label, 20) !== PHASE_LABELS[itemState]) {
      throw new Error("市场阶段时间线条目无效");
    }
    return Object.freeze({ date: item.date, state: itemState, label: PHASE_LABELS[itemState] });
  });
  if (!Array.isArray(value.mainlines) || value.mainlines.length > 3) throw new Error("市场主线列表无效");
  const mainlineIds = new Set();
  const mainlines = value.mainlines.map((item) => {
    const id = parsedText(item?.id, 50);
    const role = new Set(["mainline", "rotation", "watch"]).has(item?.role) ? item.role : null;
    const method = item?.method == null
      ? "trend-relative"
      : new Set(["trend-relative", "sample-ladder"]).has(item.method)
        ? item.method
        : null;
    if (!/^new_[A-Za-z0-9]+$/u.test(id) || !role || !method || mainlineIds.has(id)) throw new Error("市场主线条目无效");
    mainlineIds.add(id);
    return Object.freeze({
      id,
      name: parsedText(item.name, 40),
      role,
      roleLabel: parsedText(item.roleLabel, 20),
      stage: parsedText(item.stage, 20),
      stageLabel: parsedText(item.stageLabel, 20),
      score: parsedNumber(item.score, 0, 100, "市场主线分数"),
      method,
      methodLabel: parsedText(item.methodLabel, 30) || (method === "sample-ladder" ? "样本梯队＋趋势" : "趋势相对强度"),
      ladderScore: parsedNumber(item.ladderScore, 0, 100, "市场主线梯队分", { nullable: true }),
      trendScore: item.trendScore == null
        ? parsedNumber(item.score, 0, 100, "市场主线趋势分")
        : parsedNumber(item.trendScore, 0, 100, "市场主线趋势分"),
      sampleSize: item.sampleSize == null ? 0 : parsedNumber(item.sampleSize, 0, 10_000, "市场主线样本数"),
      constituentCount: parsedNumber(item.constituentCount, 0, 20_000, "市场主线成分数", { nullable: true }),
      memberCoverage: parsedNumber(item.memberCoverage, 0, 1, "市场主线覆盖率", { nullable: true }),
      limitUpCount: item.limitUpCount == null ? 0 : parsedNumber(item.limitUpCount, 0, 10_000, "市场主线涨停数"),
      maxBoards: item.maxBoards == null ? 0 : parsedNumber(item.maxBoards, 0, 100, "市场主线最高板"),
      rungsFilled: item.rungsFilled == null ? 0 : parsedNumber(item.rungsFilled, 0, 100, "市场主线梯队档数"),
      ge2Count: item.ge2Count == null ? 0 : parsedNumber(item.ge2Count, 0, 10_000, "市场主线二板数"),
      evidence: Object.freeze((Array.isArray(item.evidence) ? item.evidence : []).slice(0, 2).map((entry) => parsedText(entry, 180)).filter(Boolean)),
      risk: parsedText(item.risk, 180),
    });
  });
  const mainlineHistoryInput = value.mainlineHistory == null ? [] : value.mainlineHistory;
  if (!Array.isArray(mainlineHistoryInput) || mainlineHistoryInput.length > 12) throw new Error("市场主线历史无效");
  const mainlineHistory = mainlineHistoryInput.map((item) => {
    const sectorId = parsedText(item?.sectorId, 50);
    const sectorName = parsedText(item?.sectorName, 40);
    const method = new Set(["trend-relative", "sample-ladder"]).has(item?.method) ? item.method : null;
    const sessionPhase = new Set(["intraday", "close", "previous-close"]).has(item?.sessionPhase)
      ? item.sessionPhase
      : null;
    if (!validDate(item?.date) || !/^new_[A-Za-z0-9]+$/u.test(sectorId) || !sectorName || !method || !sessionPhase) {
      throw new Error("市场主线历史条目无效");
    }
    return Object.freeze({
      date: item.date,
      sectorId,
      sectorName,
      score: parsedNumber(item.score, 0, 100, "市场主线历史分数"),
      method,
      methodLabel: parsedText(item.methodLabel, 30) || (method === "sample-ladder" ? "样本梯队＋趋势" : "趋势相对强度"),
      sessionPhase,
      duration: parsedNumber(item.duration, 1, 10_000, "市场主线连续天数"),
    });
  });
  const confidence = new Set(["low", "medium", "high"]).has(value.confidence) ? value.confidence : null;
  const phaseConfidence = new Set(["low", "medium", "high"]).has(value.phase?.confidence) ? value.phase.confidence : null;
  if (!confidence || !phaseConfidence) throw new Error("市场环境置信等级无效");
  return Object.freeze({
    version: 1,
    state,
    label: STRENGTH_LABELS[state],
    score: parsedNumber(value.score, 0, 100, "市场环境总分"),
    reason: parsedText(value.reason, 240),
    candidateLimit: parsedNumber(value.candidateLimit, 0, 3, "市场候选上限"),
    confidence,
    dimensions: Object.freeze(dimensions),
    phase: Object.freeze({
      state: phaseState,
      label: PHASE_LABELS[phaseState],
      available,
      duration: parsedNumber(value.phase.duration, 0, 10_000, "市场阶段持续天数"),
      confidence: phaseConfidence,
      pendingLabel: parsedText(value.phase.pendingLabel, 20),
      reason: parsedText(value.phase.reason, 240),
      metrics,
      timeline: Object.freeze(timeline),
    }),
    mainlines: Object.freeze(mainlines),
    mainlineHistory: Object.freeze(mainlineHistory),
    mainlineHistoryMethodology: parsedText(value.mainlineHistoryMethodology, 240),
    historyDays: parsedNumber(value.historyDays, 0, 10_000, "市场历史天数"),
    methodology: parsedText(value.methodology, 240),
  });
}

export { PHASE_LABELS, STRENGTH_LABELS };
