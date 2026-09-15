function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function mean(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function standardDeviation(values) {
  const average = mean(values);
  if (!Number.isFinite(average) || values.length === 0) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

function ema(values, period) {
  if (!values.length) return null;
  const alpha = 2 / (period + 1);
  let current = values[0];
  for (let index = 1; index < values.length; index += 1) current += alpha * (values[index] - current);
  return current;
}

function atrSeries(bars, period = 14) {
  const ranges = bars.map((bar, index) => {
    const previous = bars[index - 1]?.close ?? bar.close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previous), Math.abs(bar.low - previous));
  });
  if (ranges.length < period) return { value: null, series: [] };
  let current = mean(ranges.slice(0, period));
  const series = Array(period - 1).fill(null);
  series.push(current);
  for (let index = period; index < ranges.length; index += 1) {
    current = ((current * (period - 1)) + ranges[index]) / period;
    series.push(current);
  }
  return { value: current, series };
}

function sourceCandidate(price, source, weight = 1, date = "") {
  return Number.isFinite(price) && price > 0 ? { price, source, weight, date } : null;
}

function volumeProfileCandidates(bars, price, atr) {
  const recent = bars.slice(-120);
  if (recent.length < 20) return [];
  const minimum = Math.min(...recent.map((bar) => bar.low));
  const maximum = Math.max(...recent.map((bar) => bar.high));
  const binSize = Math.max((maximum - minimum) / 24, atr * 0.3, price * 0.002);
  const bins = new Map();
  for (const bar of recent) {
    const typical = (bar.high + bar.low + bar.close) / 3;
    const index = Math.round((typical - minimum) / binSize);
    bins.set(index, (bins.get(index) ?? 0) + bar.volume);
  }
  const average = mean([...bins.values()]) ?? 0;
  return [...bins.entries()]
    .filter(([, volume]) => volume >= average * 1.15)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([index, volume]) => sourceCandidate(minimum + index * binSize, "成交密集区", 1.2 + Math.min(1.2, volume / Math.max(1, average) * 0.25)))
    .filter(Boolean);
}

function swingCandidates(bars) {
  const recent = bars.slice(-120);
  const candidates = [];
  for (let index = 2; index < recent.length - 2; index += 1) {
    const bar = recent[index];
    const neighbors = [...recent.slice(index - 2, index), ...recent.slice(index + 1, index + 3)];
    if (neighbors.every((item) => bar.low <= item.low)) candidates.push(sourceCandidate(bar.low, "摆动低点", 1.35, bar.date));
    if (neighbors.every((item) => bar.high >= item.high)) candidates.push(sourceCandidate(bar.high, "摆动高点", 1.35, bar.date));
  }
  return candidates.filter(Boolean).slice(-16);
}

function openGaps(bars, atr, price) {
  const recent = bars.slice(-120);
  const gaps = [];
  for (let index = 1; index < recent.length; index += 1) {
    const previous = recent[index - 1];
    const current = recent[index];
    const minimumGap = Math.max((atr ?? 0) * 0.35, previous.close * 0.004);
    if (current.low - previous.high >= minimumGap) {
      const lower = previous.high;
      const upper = current.low;
      const filled = recent.slice(index + 1).some((bar) => bar.low <= lower);
      if (!filled) gaps.push({ direction: "up", label: "向上缺口", lower, upper, date: current.date });
    } else if (previous.low - current.high >= minimumGap) {
      const lower = current.high;
      const upper = previous.low;
      const filled = recent.slice(index + 1).some((bar) => bar.high >= upper);
      if (!filled) gaps.push({ direction: "down", label: "向下缺口", lower, upper, date: current.date });
    }
  }
  return gaps.slice(-5).map((gap) => Object.freeze({
    ...gap,
    lower: round(gap.lower),
    upper: round(gap.upper),
    distancePercent: round((((gap.lower + gap.upper) / 2) / price - 1) * 100),
  }));
}

function fibonacciLevels(bars, price) {
  const recent = bars.slice(-120);
  if (recent.length < 20) return [];
  const lowBar = recent.reduce((best, bar) => bar.low < best.low ? bar : best, recent[0]);
  const highBar = recent.reduce((best, bar) => bar.high > best.high ? bar : best, recent[0]);
  const range = highBar.high - lowBar.low;
  if (range <= 0) return [];
  return [0.236, 0.382, 0.5, 0.618, 0.786].map((ratio) => {
    const value = highBar.date > lowBar.date
      ? highBar.high - range * ratio
      : lowBar.low + range * ratio;
    return Object.freeze({
      ratio,
      label: `${(ratio * 100).toFixed(1)}%`,
      price: round(value),
      distancePercent: round((value / price - 1) * 100),
    });
  });
}

function roundStep(price) {
  const magnitude = 10 ** Math.floor(Math.log10(price));
  const normalized = price / magnitude;
  if (normalized < 2) return magnitude * 0.05;
  if (normalized < 5) return magnitude * 0.1;
  return magnitude * 0.2;
}

function levelSide(value, price) {
  if (Math.abs(value / price - 1) <= 0.001) return "neutral";
  return value < price ? "support" : "resistance";
}

function layerLine(id, label, value, price, strength = 2) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Object.freeze({
    id,
    label,
    price: round(value),
    kind: levelSide(value, price),
    strength,
  });
}

function priceLayers({ recent, price, atr, zones, gaps, fibonacci, keltner, roundPriceStep }) {
  const last = recent.at(-1);
  const layers = [];
  const pushLayer = (id, label, lines) => layers.push(Object.freeze({
    id,
    label,
    available: lines.filter(Boolean).length > 0,
    lines: Object.freeze(lines.filter(Boolean)),
  }));
  pushLayer("sr", "压力支撑", zones.map((zone) => Object.freeze({
    id: zone.id,
    label: zone.label,
    price: zone.price,
    kind: zone.kind,
    strength: zone.strength,
  })));
  if (last) {
    const pivot = (last.high + last.low + last.close) / 3;
    const spread = last.high - last.low;
    pushLayer("pivot", "枢轴点", [
      layerLine("pivot-p", "枢轴 P", pivot, price, 3),
      layerLine("pivot-r1", "压力 R1", 2 * pivot - last.low, price, 2),
      layerLine("pivot-r2", "压力 R2", pivot + spread, price, 2),
      layerLine("pivot-r3", "压力 R3", last.high + 2 * (pivot - last.low), price, 1),
      layerLine("pivot-s1", "支撑 S1", 2 * pivot - last.high, price, 2),
      layerLine("pivot-s2", "支撑 S2", pivot - spread, price, 2),
      layerLine("pivot-s3", "支撑 S3", last.low - 2 * (last.high - pivot), price, 1),
    ]);
  } else pushLayer("pivot", "枢轴点", []);
  const extremes = [];
  for (const period of [60, 120]) {
    const sample = recent.slice(-period);
    if (sample.length < period) continue;
    extremes.push(
      layerLine(`extreme-high-${period}`, `${period}日高点`, Math.max(...sample.map((bar) => bar.high)), price, 3),
      layerLine(`extreme-low-${period}`, `${period}日低点`, Math.min(...sample.map((bar) => bar.low)), price, 3),
    );
  }
  pushLayer("extreme", "前高前低", extremes);
  const closes20 = recent.slice(-20).map((bar) => bar.close);
  const bollMiddle = closes20.length === 20 ? mean(closes20) : null;
  const bollDeviation = closes20.length === 20 ? standardDeviation(closes20) : null;
  pushLayer("boll", "布林带", Number.isFinite(bollMiddle) && Number.isFinite(bollDeviation) ? [
    layerLine("boll-upper", "Boll 上轨", bollMiddle + 2 * bollDeviation, price, 2),
    layerLine("boll-middle", "Boll 中轨", bollMiddle, price, 1),
    layerLine("boll-lower", "Boll 下轨", bollMiddle - 2 * bollDeviation, price, 2),
  ] : []);
  const keltnerLines = [];
  for (const [period, multiplier, label] of [[20, 2, "短期"], [60, 2.5, "中期"], [120, 3, "长期"]]) {
    const closes = recent.slice(-period).map((bar) => bar.close);
    if (closes.length < period || !Number.isFinite(atr)) continue;
    const middle = ema(closes, period);
    keltnerLines.push(
      layerLine(`keltner-${period}-upper`, `${label}上轨`, middle + atr * multiplier, price, 2),
      layerLine(`keltner-${period}-lower`, `${label}下轨`, middle - atr * multiplier, price, 2),
    );
  }
  if (keltner && !keltnerLines.length) {
    keltnerLines.push(
      layerLine("keltner-20-upper", "短期上轨", keltner.upper, price, 2),
      layerLine("keltner-20-lower", "短期下轨", keltner.lower, price, 2),
    );
  }
  pushLayer("keltner", "Keltner", keltnerLines);
  pushLayer("atr", "ATR通道", Number.isFinite(atr) ? [1, 2, 3].flatMap((multiple) => [
    layerLine(`atr-upper-${multiple}`, `现价 +${multiple}ATR`, price + atr * multiple, price, multiple === 1 ? 2 : 1),
    layerLine(`atr-lower-${multiple}`, `现价 -${multiple}ATR`, price - atr * multiple, price, multiple === 1 ? 2 : 1),
  ]) : []);
  pushLayer("gap", "缺口位", gaps.slice(-3).flatMap((gap, index) => [
    layerLine(`gap-${index + 1}-lower`, `${gap.label}下沿`, gap.lower, price, 2),
    layerLine(`gap-${index + 1}-upper`, `${gap.label}上沿`, gap.upper, price, 2),
  ]));
  pushLayer("fib", "斐波那契", fibonacci.map((item, index) =>
    layerLine(`fib-${index + 1}`, `Fib ${item.label}`, item.price, price, 1),
  ));
  pushLayer("round", "整数关口", [
    layerLine("round-lower", "下方整数位", Math.floor(price / roundPriceStep) * roundPriceStep, price, 1),
    layerLine("round-upper", "上方整数位", Math.ceil(price / roundPriceStep) * roundPriceStep, price, 1),
  ]);
  return Object.freeze(layers);
}

function mergedZones(candidates, price, atr) {
  const tolerance = Math.max((atr ?? 0) * 0.45, price * 0.005);
  const groups = [];
  for (const candidate of candidates.filter(Boolean).sort((left, right) => left.price - right.price)) {
    let group = groups.find((item) => Math.abs(item.price - candidate.price) <= tolerance);
    if (!group) {
      group = { price: candidate.price, weight: 0, sources: new Set(), dates: new Set() };
      groups.push(group);
    }
    group.price = (group.price * group.weight + candidate.price * candidate.weight) / (group.weight + candidate.weight);
    group.weight += candidate.weight;
    group.sources.add(candidate.source);
    if (candidate.date) group.dates.add(candidate.date);
  }
  const zones = groups.map((group) => {
    const kind = group.price <= price ? "support" : "resistance";
    const sources = [...group.sources];
    return {
      kind,
      label: sources.slice(0, 2).join(" · "),
      price: round(group.price),
      distancePercent: round((group.price / price - 1) * 100),
      strength: Math.min(5, Math.max(1, Math.round(group.weight))),
      sources,
      evidence: `${sources.join("、")}共振${group.dates.size ? ` · 最近 ${[...group.dates].sort().at(-1)}` : ""}`,
    };
  });
  const supports = zones.filter((item) => item.kind === "support")
    .sort((left, right) => Math.abs(left.distancePercent) - Math.abs(right.distancePercent) || right.strength - left.strength)
    .slice(0, 4);
  const resistances = zones.filter((item) => item.kind === "resistance")
    .sort((left, right) => Math.abs(left.distancePercent) - Math.abs(right.distancePercent) || right.strength - left.strength)
    .slice(0, 4);
  return [...supports, ...resistances].map((zone, index) => Object.freeze({ ...zone, id: `${zone.kind}-${index + 1}` }));
}

function reviewZone(zone, bars, atr) {
  const sample = bars.slice(-60);
  const tolerance = Math.max((atr ?? 0) * 0.25, zone.price * 0.003);
  let touches = 0;
  let crosses = 0;
  let touching = false;
  let lastTouch = null;
  for (let index = 0; index < sample.length; index += 1) {
    const bar = sample[index];
    const isTouch = bar.low <= zone.price + tolerance && bar.high >= zone.price - tolerance;
    if (isTouch && !touching) touches += 1;
    if (isTouch) lastTouch = bar.date;
    touching = isTouch;
    if (index === 0) continue;
    const previous = sample[index - 1].close;
    const crossedUp = previous < zone.price - tolerance && bar.close > zone.price + tolerance;
    const crossedDown = previous > zone.price + tolerance && bar.close < zone.price - tolerance;
    if (crossedUp || crossedDown) crosses += 1;
  }
  const last = sample.at(-1);
  const breached = zone.kind === "support"
    ? last.close < zone.price - tolerance
    : last.close > zone.price + tolerance;
  const lastTouchIndex = lastTouch ? sample.findLastIndex((bar) => bar.date === lastTouch) : -1;
  return Object.freeze({
    windowBars: sample.length,
    touches,
    crosses,
    lastTouch,
    barsSinceTouch: lastTouchIndex < 0 ? null : sample.length - 1 - lastTouchIndex,
    status: breached ? "breached" : "holding",
  });
}

export function buildStockLevels(barsInput, priceInput) {
  const bars = Array.isArray(barsInput) ? barsInput.filter((bar) =>
    Number.isFinite(bar?.open) && Number.isFinite(bar?.high) && Number.isFinite(bar?.low) &&
    Number.isFinite(bar?.close) && Number.isFinite(bar?.volume) && bar.close > 0,
  ) : [];
  const price = Number(priceInput);
  if (!Number.isFinite(price) || price <= 0 || bars.length < 14) {
    return Object.freeze({
      version: 1,
      available: false,
      atr: null,
      atrPercent: null,
      keltner: null,
      zones: Object.freeze([]),
      gaps: Object.freeze([]),
      fibonacci: Object.freeze([]),
      layers: Object.freeze([]),
      disclosure: "至少需要 14 个有效交易日才能计算关键价位。",
    });
  }
  const atrResult = atrSeries(bars, 14);
  const atr = atrResult.value;
  const recent = bars.slice(-120);
  const candidates = [
    ...volumeProfileCandidates(recent, price, atr),
    ...swingCandidates(recent),
  ];
  for (const period of [20, 60, 120]) {
    const sample = recent.slice(-period);
    if (sample.length < Math.min(period, 20)) continue;
    const low = sample.reduce((best, bar) => bar.low < best.low ? bar : best, sample[0]);
    const high = sample.reduce((best, bar) => bar.high > best.high ? bar : best, sample[0]);
    candidates.push(sourceCandidate(low.low, `${period}日低点`, period === 120 ? 1.8 : 1.3, low.date));
    candidates.push(sourceCandidate(high.high, `${period}日高点`, period === 120 ? 1.8 : 1.3, high.date));
  }
  const gaps = openGaps(recent, atr, price);
  for (const gap of gaps) candidates.push(sourceCandidate((gap.lower + gap.upper) / 2, gap.label, 1.7, gap.date));
  const fibonacci = fibonacciLevels(recent, price);
  for (const level of fibonacci) candidates.push(sourceCandidate(level.price, `斐波那契 ${level.label}`, 0.8));
  const last = recent.at(-1);
  if (last) {
    const pivot = (last.high + last.low + last.close) / 3;
    candidates.push(sourceCandidate(pivot, "前日枢轴", 1));
    candidates.push(sourceCandidate(2 * pivot - last.high, "枢轴 S1", 1));
    candidates.push(sourceCandidate(2 * pivot - last.low, "枢轴 R1", 1));
  }
  const step = roundStep(price);
  candidates.push(sourceCandidate(Math.floor(price / step) * step, "整数关口", 0.9));
  candidates.push(sourceCandidate(Math.ceil(price / step) * step, "整数关口", 0.9));
  if (atr) candidates.push(sourceCandidate(price - atr * 2, "ATR 风险线", 1.4));
  const middle = ema(recent.map((bar) => bar.close), 20);
  const keltner = middle != null && atr != null ? Object.freeze({
    period: 20,
    multiplier: 2,
    middle: round(middle),
    upper: round(middle + atr * 2),
    lower: round(middle - atr * 2),
  }) : null;
  if (keltner) {
    candidates.push(sourceCandidate(keltner.lower, "Keltner 下轨", 1.1));
    candidates.push(sourceCandidate(keltner.upper, "Keltner 上轨", 1.1));
  }
  const zones = mergedZones(candidates, price, atr).map((zone) => Object.freeze({
    ...zone,
    review: reviewZone(zone, recent, atr),
  }));
  const layers = priceLayers({
    recent,
    price,
    atr,
    zones,
    gaps,
    fibonacci,
    keltner,
    roundPriceStep: step,
  });
  return Object.freeze({
    version: 1,
    available: true,
    atr: round(atr),
    atrPercent: round(atr / price * 100),
    keltner,
    zones: Object.freeze(zones),
    gaps: Object.freeze(gaps),
    fibonacci: Object.freeze(fibonacci),
    layers,
    disclosure: "九类关键价位由复权 OHLCV 计算；成交密集区是按日线量价估算，不等同于逐笔筹码分布。触达与穿越是用当前价位回看最近 60 根日线的描述性统计，包含后见信息，不是 point-in-time 回测或有效率。图层用于研究参照，不是买卖指令。",
  });
}
