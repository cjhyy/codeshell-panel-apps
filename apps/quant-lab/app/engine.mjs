/* Deterministic research engine used only by the Quant Lab Panel App. */
const TRADING_DAYS = 252;

export function markdownInlineCode(value) {
  const text = String(value).replaceAll("\n", " ");
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longestRun + 1);
  const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${padding}${text}${padding}${fence}`;
}

export function markdownPlainText(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([`*_[\]{}()#+.!|])/gu, "\\$1")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ");
}

export function fencedMarkdown(content, language = "") {
  const text = String(content);
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

function finiteNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a finite number`);
  return parsed;
}

function parseCsvLine(line) {
  const fields = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error("unterminated quoted CSV field");
  fields.push(value.trim());
  return fields;
}

function normalizedHeader(value) {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

export function isSafeCsvPath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    !value.toLowerCase().endsWith(".csv") ||
    value.startsWith("/") ||
    value.includes(":") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return false;
  }
  return value.split("/").every((segment) => {
    const windowsBaseName = (segment.split(".", 1)[0] ?? "").trimEnd().toUpperCase();
    return (
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !segment.startsWith(".") &&
      segment.toLowerCase() !== "node_modules" &&
      !/[. ]$/u.test(segment) &&
      !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(windowsBaseName)
    );
  });
}

export function parseOhlcvCsv(source) {
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new Error("CSV is empty");
  }
  const lines = source
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 3) throw new Error("CSV needs a header and at least two data rows");
  const headers = parseCsvLine(lines[0]).map(normalizedHeader);
  for (const header of ["date", "open", "high", "low", "close", "volume"]) {
    if (headers.filter((candidate) => candidate === header).length > 1) {
      throw new Error(`CSV contains duplicate ${header} columns`);
    }
  }
  const indexOf = (name) => headers.indexOf(name);
  const columns = {
    date: indexOf("date"),
    open: indexOf("open"),
    high: indexOf("high"),
    low: indexOf("low"),
    close: indexOf("close"),
    volume: indexOf("volume"),
  };
  for (const key of ["date", "open", "high", "low", "close"]) {
    if (columns[key] < 0) throw new Error(`CSV is missing the ${key} column`);
  }
  const bars = [];
  const dates = new Set();
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const fields = parseCsvLine(lines[lineIndex]);
    const rawDate = fields[columns.date];
    const dateMatch = /^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/.exec(rawDate ?? "");
    const date = dateMatch?.[1];
    const parsedDate = date ? new Date(`${date}T00:00:00Z`) : null;
    if (
      !date ||
      !parsedDate ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date
    ) {
      throw new Error(`row ${lineIndex + 1} has an invalid date`);
    }
    if (dates.has(date)) throw new Error(`row ${lineIndex + 1} duplicates date ${date}`);
    dates.add(date);
    const bar = {
      date,
      open: finiteNumber(fields[columns.open], `row ${lineIndex + 1} open`),
      high: finiteNumber(fields[columns.high], `row ${lineIndex + 1} high`),
      low: finiteNumber(fields[columns.low], `row ${lineIndex + 1} low`),
      close: finiteNumber(fields[columns.close], `row ${lineIndex + 1} close`),
      volume:
        columns.volume >= 0 && fields[columns.volume] !== ""
          ? finiteNumber(fields[columns.volume], `row ${lineIndex + 1} volume`)
          : 0,
    };
    if (Math.min(bar.open, bar.high, bar.low, bar.close) <= 0) {
      throw new Error(`row ${lineIndex + 1} contains a non-positive price`);
    }
    if (
      bar.high < Math.max(bar.open, bar.close, bar.low) ||
      bar.low > Math.min(bar.open, bar.close, bar.high)
    ) {
      throw new Error(`row ${lineIndex + 1} has inconsistent OHLC values`);
    }
    if (bar.volume < 0) throw new Error(`row ${lineIndex + 1} has negative volume`);
    bars.push(bar);
  }
  bars.sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
  return bars;
}

export function simpleMovingAverage(values, period) {
  const length = Math.max(1, Math.floor(period));
  const result = Array(values.length).fill(null);
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
    if (index >= length) sum -= values[index - length];
    if (index >= length - 1) result[index] = sum / length;
  }
  return result;
}

export function relativeStrengthIndex(values, period = 14) {
  const length = Math.max(2, Math.floor(period));
  const result = Array(values.length).fill(null);
  if (values.length <= length) return result;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= length; index += 1) {
    const change = values[index] - values[index - 1];
    gains += Math.max(0, change);
    losses += Math.max(0, -change);
  }
  let averageGain = gains / length;
  let averageLoss = losses / length;
  const valueFor = () =>
    averageLoss === 0
      ? averageGain === 0
        ? 50
        : 100
      : 100 - 100 / (1 + averageGain / averageLoss);
  result[length] = valueFor();
  for (let index = length + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (length - 1) + Math.max(0, change)) / length;
    averageLoss = (averageLoss * (length - 1) + Math.max(0, -change)) / length;
    result[index] = valueFor();
  }
  return result;
}

// Converts state signals ("is long") into edge signals ("just crossed").
// A state signal is true on every bar the condition holds, so an all-in engine
// re-enters only after an exit; edge mode instead fires once at the crossing,
// which is what "buy on the golden cross" conventionally means.
function withEdges(signals) {
  for (let index = 0; index < signals.length; index += 1) {
    const previous = index > 0 ? signals[index - 1] : { enter: false, exit: false };
    signals[index].enterSignal = signals[index].enter && !previous.enter;
    signals[index].exitSignal = signals[index].exit && !previous.exit;
  }
  return signals;
}

function strategySignals(bars, strategy) {
  const closes = bars.map((bar) => bar.close);
  const signals = bars.map(() => ({ enter: false, exit: false }));
  if (strategy.type === "sma-cross") {
    const fast = simpleMovingAverage(closes, strategy.fast);
    const slow = simpleMovingAverage(closes, strategy.slow);
    for (let index = 0; index < bars.length; index += 1) {
      if (fast[index] == null || slow[index] == null) continue;
      signals[index] = {
        enter: fast[index] > slow[index],
        exit: fast[index] <= slow[index],
      };
    }
    return { signals: withEdges(signals), indicators: { fast, slow } };
  }
  if (strategy.type === "rsi-reversion") {
    const rsi = relativeStrengthIndex(closes, strategy.period);
    for (let index = 0; index < bars.length; index += 1) {
      if (rsi[index] == null) continue;
      signals[index] = {
        enter: rsi[index] < strategy.oversold,
        exit: rsi[index] > strategy.overbought,
      };
    }
    return { signals: withEdges(signals), indicators: { rsi } };
  }
  if (strategy.type === "breakout") {
    const lookback = Math.max(2, Math.floor(strategy.lookback));
    const upper = Array(bars.length).fill(null);
    const lower = Array(bars.length).fill(null);
    for (let index = lookback; index < bars.length; index += 1) {
      const window = bars.slice(index - lookback, index);
      upper[index] = Math.max(...window.map((bar) => bar.high));
      lower[index] = Math.min(...window.map((bar) => bar.low));
      signals[index] = {
        enter: bars[index].close > upper[index],
        exit: bars[index].close < lower[index],
      };
    }
    return { signals: withEdges(signals), indicators: { upper, lower } };
  }
  throw new Error(`unknown strategy type: ${strategy.type}`);
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function metricsFor(equity, initialCapital, trades, exposureDays, benchmarkReturn, riskFreeRate = 0) {
  const finalEquity = equity.at(-1)?.value ?? initialCapital;
  const totalReturn = finalEquity / initialCapital - 1;
  const years = Math.max(equity.length / TRADING_DAYS, 1 / TRADING_DAYS);
  const annualizedReturn = (finalEquity / initialCapital) ** (1 / years) - 1;
  const dailyReturns = [];
  let peak = initialCapital;
  let maximumDrawdown = 0;
  const drawdowns = [];
  for (let index = 0; index < equity.length; index += 1) {
    const value = equity[index].value;
    peak = Math.max(peak, value);
    const drawdown = peak === 0 ? 0 : value / peak - 1;
    maximumDrawdown = Math.min(maximumDrawdown, drawdown);
    drawdowns.push({ date: equity[index].date, value: drawdown });
    if (index > 0 && equity[index - 1].value > 0) {
      dailyReturns.push(value / equity[index - 1].value - 1);
    }
  }
  const meanDaily =
    dailyReturns.length > 0
      ? dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length
      : 0;
  const volatility = standardDeviation(dailyReturns);
  // Excess-return Sharpe. A zero risk-free rate reproduces the v1 behaviour.
  const dailyRiskFree = (1 + riskFreeRate) ** (1 / TRADING_DAYS) - 1;
  const sharpe =
    volatility === 0 ? 0 : ((meanDaily - dailyRiskFree) / volatility) * Math.sqrt(TRADING_DAYS);
  const winners = trades.filter((trade) => trade.pnl > 0).length;
  const grossProfit = trades.reduce((sum, trade) => sum + Math.max(0, trade.pnl), 0);
  const grossLoss = trades.reduce((sum, trade) => sum + Math.max(0, -trade.pnl), 0);
  return {
    finalEquity,
    totalReturn,
    annualizedReturn,
    maximumDrawdown,
    sharpe,
    annualizedVolatility: volatility * Math.sqrt(TRADING_DAYS),
    calmar: maximumDrawdown === 0 ? null : annualizedReturn / Math.abs(maximumDrawdown),
    benchmarkReturn,
    excessReturn: totalReturn - benchmarkReturn,
    profitFactor: grossLoss === 0 ? null : grossProfit / grossLoss,
    averageTradeReturn:
      trades.length === 0
        ? 0
        : trades.reduce((sum, trade) => sum + trade.return, 0) / trades.length,
    winRate: trades.length === 0 ? 0 : winners / trades.length,
    trades: trades.length,
    exposure: equity.length === 0 ? 0 : exposureDays / equity.length,
    drawdowns,
  };
}

export function fingerprintText(value) {
  let hash = 2_166_136_261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function fingerprintBars(bars) {
  return fingerprintText(
    bars
      .map((bar) => [bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume].join(","))
      .join("\n") + "\n",
  );
}

export function analyzeDataset(bars) {
  if (!Array.isArray(bars) || bars.length === 0) {
    return { warnings: [{ code: "empty", message: "dataset is empty" }] };
  }
  let missingVolume = 0;
  let weekendBars = 0;
  let largestGapDays = 0;
  let largeJumps = 0;
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    if (!(bar.volume > 0)) missingVolume += 1;
    const day = new Date(`${bar.date}T00:00:00Z`).getUTCDay();
    if (day === 0 || day === 6) weekendBars += 1;
    if (index === 0) continue;
    const previous = bars[index - 1];
    largestGapDays = Math.max(
      largestGapDays,
      Math.round((Date.parse(bar.date) - Date.parse(previous.date)) / 86_400_000),
    );
    if (Math.abs(bar.close / previous.close - 1) >= 0.35) largeJumps += 1;
  }
  const warnings = [];
  if (bars.length < TRADING_DAYS) {
    warnings.push({
      code: "short-sample",
      message: `only ${bars.length} bars; less than one trading year`,
    });
  }
  if (missingVolume > 0) {
    warnings.push({
      code: "missing-volume",
      message: `${missingVolume} bar(s) have zero or missing volume`,
    });
  }
  if (weekendBars > 0) {
    warnings.push({
      code: "weekend-bars",
      message: `${weekendBars} bar(s) fall on weekends`,
    });
  }
  if (largestGapDays > 10) {
    warnings.push({
      code: "calendar-gap",
      message: `largest calendar gap is ${largestGapDays} days`,
    });
  }
  if (largeJumps > 0) {
    warnings.push({
      code: "large-jump",
      message: `${largeJumps} close-to-close move(s) exceed 35%; check corporate-action adjustment`,
    });
  }
  return { missingVolume, weekendBars, largestGapDays, largeJumps, warnings };
}

function validateSizer(sizer) {
  if (sizer == null) return { type: "all-in" };
  if (typeof sizer !== "object") throw new Error("sizer must be an object");
  if (sizer.type === "all-in") return { type: "all-in" };
  if (sizer.type === "fixed-fraction") {
    const pct = finiteNumber(sizer.pct, "sizer percentage");
    if (pct <= 0 || pct > 100) throw new Error("sizer percentage must be within (0, 100]");
    return { type: "fixed-fraction", pct };
  }
  if (sizer.type === "volatility-target") {
    const annual = finiteNumber(sizer.annual, "volatility target");
    const lookback = sizer.lookback == null ? 20 : finiteNumber(sizer.lookback, "sizer lookback");
    if (annual <= 0 || annual > 500) throw new Error("volatility target must be within (0, 500]");
    if (!Number.isInteger(lookback) || lookback < 2) {
      throw new Error("sizer lookback must be an integer >= 2");
    }
    const maxLeverage =
      sizer.maxLeverage == null ? 1 : finiteNumber(sizer.maxLeverage, "sizer max leverage");
    if (maxLeverage <= 0 || maxLeverage > 1) {
      throw new Error("sizer max leverage must be within (0, 1]; the engine does not borrow");
    }
    return { type: "volatility-target", annual, lookback, maxLeverage };
  }
  throw new Error(`unknown sizer type: ${sizer.type}`);
}

// Fraction of available cash to commit on this entry.
function sizerFraction(sizer, bars, index) {
  if (sizer.type === "all-in") return 1;
  if (sizer.type === "fixed-fraction") return sizer.pct / 100;
  const lookback = sizer.lookback;
  const returns = [];
  const start = Math.max(1, index - lookback + 1);
  for (let i = start; i <= index; i += 1) {
    const previous = bars[i - 1]?.close;
    if (previous > 0) returns.push(bars[i].close / previous - 1);
  }
  // Without enough history to measure volatility the target is undefined.
  // Report that instead of returning 0, which would silently consume an entry
  // signal -- in edge mode that signal never fires again.
  if (returns.length < 2) return null;
  const realized = standardDeviation(returns) * Math.sqrt(TRADING_DAYS);
  if (!Number.isFinite(realized)) return null;
  // A flat window implies zero measured risk; the ratio would be unbounded, so
  // clamp at maxLeverage rather than dividing by ~0.
  if (realized <= 0) return sizer.maxLeverage;
  // Scale exposure down when realized volatility exceeds the target. Never
  // scale above maxLeverage, since the engine has no borrowing model.
  return Math.min(sizer.maxLeverage, sizer.annual / 100 / realized);
}

function validateStrategy(strategy, barCount) {
  if (!strategy || typeof strategy !== "object") throw new Error("strategy is required");
  if (strategy.type === "sma-cross") {
    const fast = finiteNumber(strategy.fast, "fast SMA period");
    const slow = finiteNumber(strategy.slow, "slow SMA period");
    if (
      !Number.isInteger(fast) ||
      !Number.isInteger(slow) ||
      fast < 2 ||
      slow < 3 ||
      fast >= slow
    ) {
      throw new Error("SMA periods must be integers with 2 <= fast < slow");
    }
    if (slow >= barCount - 1) throw new Error("slow SMA period leaves too few executable bars");
    return;
  }
  if (strategy.type === "rsi-reversion") {
    const period = finiteNumber(strategy.period, "RSI period");
    const oversold = finiteNumber(strategy.oversold, "RSI oversold threshold");
    const overbought = finiteNumber(strategy.overbought, "RSI overbought threshold");
    if (
      !Number.isInteger(period) ||
      period < 2 ||
      oversold < 0 ||
      overbought > 100 ||
      oversold >= overbought
    ) {
      throw new Error("RSI requires an integer period >= 2 and 0 <= oversold < overbought <= 100");
    }
    if (period >= barCount - 1) throw new Error("RSI period leaves too few executable bars");
    return;
  }
  if (strategy.type === "breakout") {
    const lookback = finiteNumber(strategy.lookback, "breakout lookback");
    if (!Number.isInteger(lookback) || lookback < 2) {
      throw new Error("breakout lookback must be an integer >= 2");
    }
    if (lookback >= barCount - 1) {
      throw new Error("breakout lookback leaves too few executable bars");
    }
    return;
  }
  throw new Error(`unknown strategy type: ${strategy.type}`);
}

function validateBacktestBars(bars) {
  if (!Array.isArray(bars) || bars.length < 20) {
    throw new Error("backtest requires at least 20 bars");
  }
  if (bars.length > 100_000) throw new Error("backtest accepts at most 100000 bars");
  let previousDate = "";
  for (const [index, bar] of bars.entries()) {
    const label = `bar ${index + 1}`;
    if (!bar || typeof bar !== "object" || !/^\d{4}-\d{2}-\d{2}$/.test(bar.date)) {
      throw new Error(`${label} has an invalid date`);
    }
    const parsedDate = new Date(`${bar.date}T00:00:00Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== bar.date) {
      throw new Error(`${label} has an invalid date`);
    }
    if (previousDate && bar.date <= previousDate) {
      throw new Error("backtest bars must be strictly chronological with unique dates");
    }
    previousDate = bar.date;
    for (const field of ["open", "high", "low", "close"]) {
      if (!Number.isFinite(bar[field]) || bar[field] <= 0) {
        throw new Error(`${label} ${field} must be a positive finite number`);
      }
    }
    if (!Number.isFinite(bar.volume) || bar.volume < 0) {
      throw new Error(`${label} volume must be a non-negative finite number`);
    }
    if (
      bar.high < Math.max(bar.open, bar.close, bar.low) ||
      bar.low > Math.min(bar.open, bar.close, bar.high)
    ) {
      throw new Error(`${label} has inconsistent OHLC values`);
    }
  }
}

export function runBacktest(bars, configuration) {
  validateBacktestBars(bars);
  const initialCapital = finiteNumber(configuration.initialCapital, "initial capital");
  const feeRate = finiteNumber(configuration.feeBps, "fee bps") / 10_000;
  const slippageRate = finiteNumber(configuration.slippageBps, "slippage bps") / 10_000;
  const stopLossRate = finiteNumber(configuration.stopLossPct, "stop loss") / 100;
  if (initialCapital <= 0) throw new Error("initial capital must be positive");
  if (feeRate < 0 || feeRate >= 1 || slippageRate < 0 || slippageRate >= 1) {
    throw new Error("fee and slippage assumptions must be between 0 and 10000 bps");
  }
  if (stopLossRate < 0 || stopLossRate >= 1) {
    throw new Error("stop loss must be between 0% (inclusive) and 100% (exclusive)");
  }
  validateStrategy(configuration.strategy, bars.length);
  const sizer = validateSizer(configuration.sizer);
  const signalMode = configuration.signalMode ?? "state";
  if (signalMode !== "state" && signalMode !== "edge") {
    throw new Error('signalMode must be "state" or "edge"');
  }
  const riskFreeRate = finiteNumber(configuration.riskFreeRate ?? 0, "risk-free rate");
  // Bars before this index feed indicator warm-up only; no orders may execute
  // there. Walk-forward needs history at the fold boundary without letting
  // later-chosen parameters trade in the past.
  const tradingFromIndex = Math.floor(configuration.tradingFromIndex ?? 0);
  if (!Number.isInteger(tradingFromIndex) || tradingFromIndex < 0 || tradingFromIndex > bars.length) {
    throw new Error("tradingFromIndex must be an integer within [0, bars.length]");
  }
  if (riskFreeRate < -1 || riskFreeRate > 1) {
    throw new Error("risk-free rate must be a decimal within [-1, 1] (0.02 means 2%)");
  }

  const { signals, indicators } = strategySignals(bars, configuration.strategy);
  let cash = initialCapital;
  let shares = 0;
  let entry = null;
  let exposureDays = 0;
  const trades = [];
  const equity = [];
  const skippedEntries = [];

  const exitPosition = (bar, price, reason) => {
    const proceeds = shares * price;
    const exitFee = proceeds * feeRate;
    cash += proceeds - exitFee;
    const pnl = cash - entry.cashBefore;
    trades.push({
      entryDate: entry.date,
      exitDate: bar.date,
      entryPrice: entry.price,
      exitPrice: price,
      shares,
      pnl,
      return: pnl / entry.cashBefore,
      reason,
    });
    shares = 0;
    entry = null;
  };

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    let exposedThisBar = shares > 0;
    if (index > 0 && index >= tradingFromIndex) {
      const previousSignal = signals[index - 1];
      let exitedThisBar = false;
      if (shares > 0) {
        const stopPrice = stopLossRate > 0 ? entry.price * (1 - stopLossRate) : 0;
        if (stopPrice > 0 && bar.low <= stopPrice) {
          const executableStop = Math.min(bar.open, stopPrice) * (1 - slippageRate);
          exitPosition(bar, executableStop, "stop");
          exitedThisBar = true;
        } else if (signalMode === "edge" ? previousSignal.exitSignal : previousSignal.exit) {
          exitPosition(bar, bar.open * (1 - slippageRate), "signal");
          exitedThisBar = true;
        }
      }
      const wantsEntry = signalMode === "edge" ? previousSignal.enterSignal : previousSignal.enter;
      if (shares === 0 && !exitedThisBar && wantsEntry) {
        const entryPrice = bar.open * (1 + slippageRate);
        const cashBefore = cash;
        // Size off the signal bar, so the decision uses only closed data.
        const fraction = sizerFraction(sizer, bars, index - 1);
        const committed = fraction == null ? 0 : cash * fraction;
        shares = committed > 0 ? committed / (entryPrice * (1 + feeRate)) : 0;
        if (shares <= 0) {
          // Record the skip so an unsized signal is visible rather than silent.
          skippedEntries.push({
            date: bar.date,
            reason: fraction == null ? "sizer-unavailable" : "sizer-zero",
          });
          equity.push({ date: bar.date, value: cash });
          continue;
        }
        const cost = shares * entryPrice;
        const entryFee = cost * feeRate;
        cash -= cost + entryFee;
        entry = { date: bar.date, price: entryPrice, cashBefore };
        exposedThisBar = true;
      }
      if (shares > 0 && entry.date === bar.date && stopLossRate > 0) {
        const stopPrice = entry.price * (1 - stopLossRate);
        if (bar.low <= stopPrice) {
          exitPosition(bar, stopPrice * (1 - slippageRate), "stop");
        }
      }
    }
    if (index < tradingFromIndex) {
      equity.push({ date: bar.date, value: initialCapital });
      continue;
    }
    if (exposedThisBar) exposureDays += 1;
    equity.push({ date: bar.date, value: cash + shares * bar.close });
  }

  if (shares > 0) {
    const finalBar = bars.at(-1);
    exitPosition(finalBar, finalBar.close * (1 - slippageRate), "end");
    equity[equity.length - 1] = { date: finalBar.date, value: cash };
  }

  const benchmark = bars.map((bar) => ({
    date: bar.date,
    value: initialCapital * (bar.close / bars[0].close),
  }));
  const benchmarkReturn = bars.at(-1).close / bars[0].close - 1;
  const metrics = metricsFor(
    equity,
    initialCapital,
    trades,
    exposureDays,
    benchmarkReturn,
    riskFreeRate,
  );
  const finiteMetrics = [
    "finalEquity",
    "totalReturn",
    "annualizedReturn",
    "maximumDrawdown",
    "sharpe",
    "annualizedVolatility",
    "benchmarkReturn",
    "excessReturn",
    "averageTradeReturn",
    "winRate",
    "trades",
    "exposure",
  ];
  if (
    equity.some((point) => !Number.isFinite(point.value)) ||
    benchmark.some((point) => !Number.isFinite(point.value)) ||
    finiteMetrics.some((key) => !Number.isFinite(metrics[key])) ||
    (metrics.calmar != null && !Number.isFinite(metrics.calmar)) ||
    (metrics.profitFactor != null && !Number.isFinite(metrics.profitFactor))
  ) {
    throw new Error("backtest result is numerically unstable; check price magnitudes and inputs");
  }
  return {
    bars,
    equity,
    benchmark,
    trades,
    indicators,
    metrics,
    skippedEntries,
  };
}

export function generateDemoBars(count = 520) {
  if (!Number.isInteger(count) || count < 1 || count > 5_000) {
    throw new Error("demo bar count must be an integer between 1 and 5000");
  }
  const bars = [];
  let seed = 7_314_159;
  let close = 112;
  const date = new Date("2023-01-03T00:00:00Z");
  const random = () => {
    seed = (seed * 48_271) % 2_147_483_647;
    return seed / 2_147_483_647;
  };
  while (bars.length < count) {
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) {
      const cycle = Math.sin(bars.length / 27) * 0.006;
      const drift = 0.00045 + cycle;
      const shock = (random() - 0.48) * 0.035;
      const open = close * (1 + (random() - 0.5) * 0.012);
      close = Math.max(18, open * (1 + drift + shock));
      const high = Math.max(open, close) * (1 + random() * 0.018);
      const low = Math.min(open, close) * (1 - random() * 0.018);
      bars.push({
        date: date.toISOString().slice(0, 10),
        open,
        high,
        low,
        close,
        volume: Math.round(2_500_000 + random() * 6_000_000),
      });
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return bars;
}

// --- Research layer -------------------------------------------------------
// A single backtest reports how one parameter set behaved on data it was
// chosen against. These helpers exist to answer the harder question: would it
// have held up out of sample, and is the neighbourhood stable?

// Annualized Sharpe over a return series, matching metricsFor's convention.
function sharpeOf(returns, riskFreeRate = 0) {
  if (!Array.isArray(returns) || returns.length < 2) return 0;
  const meanDaily = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const volatility = standardDeviation(returns);
  if (volatility === 0) return 0;
  const dailyRiskFree = (1 + riskFreeRate) ** (1 / TRADING_DAYS) - 1;
  return ((meanDaily - dailyRiskFree) / volatility) * Math.sqrt(TRADING_DAYS);
}

function strategyWithParameters(base, parameters) {
  return { ...base, ...parameters };
}

// Cartesian product of the supplied parameter ranges.
export function parameterGrid(ranges) {
  const keys = Object.keys(ranges);
  if (keys.length === 0) throw new Error("parameter grid needs at least one range");
  let combinations = [{}];
  for (const key of keys) {
    const values = ranges[key];
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error(`parameter range ${key} must be a non-empty array`);
    }
    const next = [];
    for (const combination of combinations) {
      for (const value of values) next.push({ ...combination, [key]: value });
    }
    combinations = next;
    if (combinations.length > 4_096) throw new Error("parameter grid exceeds 4096 combinations");
  }
  return combinations;
}

// Sweeps a parameter grid. Invalid combinations (fast >= slow, warm-up longer
// than the sample) are reported rather than thrown, so a grid edge does not
// abort the whole sweep.
export function parameterSweep(bars, configuration, ranges, options = {}) {
  const combinations = parameterGrid(ranges);
  const results = [];
  for (const parameters of combinations) {
    try {
      const result = runBacktest(bars, {
        ...configuration,
        strategy: strategyWithParameters(configuration.strategy, parameters),
      });
      results.push({
        parameters,
        ok: true,
        metrics: result.metrics,
        trades: result.trades.length,
      });
    } catch (error) {
      results.push({ parameters, ok: false, error: error.message });
    }
  }
  const usable = results.filter((entry) => entry.ok);
  // A parameter set that never trades has flat equity and therefore Sharpe 0,
  // which would outrank every genuinely traded but losing candidate. Zero-trade
  // runs stay reportable but are ineligible to win unless nothing traded at all.
  const minimumTrades = Math.max(1, Math.floor(options.minimumTrades ?? 1));
  const eligible = usable.filter((entry) => entry.trades >= minimumTrades);
  const sharpes = eligible.map((entry) => entry.metrics.sharpe);
  const best = eligible.reduce(
    (winner, entry) => (winner == null || entry.metrics.sharpe > winner.metrics.sharpe ? entry : winner),
    null,
  );
  return {
    results,
    evaluated: results.length,
    usable: usable.length,
    eligible: eligible.length,
    minimumTrades,
    best,
    // Neighbourhood stability. A high peak surrounded by poor scores is the
    // signature of an overfit parameter choice.
    sharpeMean: sharpes.length ? sharpes.reduce((sum, v) => sum + v, 0) / sharpes.length : null,
    sharpeStdDev: sharpes.length > 1 ? standardDeviation(sharpes) : null,
    sharpeMin: sharpes.length ? Math.min(...sharpes) : null,
    sharpeMax: sharpes.length ? Math.max(...sharpes) : null,
  };
}

// Rolling walk-forward. Each fold selects parameters on the in-sample window
// and scores them on the untouched window that follows, so the out-of-sample
// figures never saw the data used to pick them.
export function walkForward(bars, configuration, ranges, options = {}) {
  const inSampleBars = Math.floor(options.inSampleBars ?? 504);
  const outOfSampleBars = Math.floor(options.outOfSampleBars ?? 126);
  if (!Number.isInteger(inSampleBars) || inSampleBars < 30) {
    throw new Error("inSampleBars must be an integer >= 30");
  }
  if (!Number.isInteger(outOfSampleBars) || outOfSampleBars < 10) {
    throw new Error("outOfSampleBars must be an integer >= 10");
  }
  // Coerce here too: runBacktest accepts numeric strings, but this value also
  // feeds sharpeOf directly, where "0.03" would make 1 + rate string-concatenate.
  const riskFreeRate = Number(configuration.riskFreeRate ?? 0);
  if (!Number.isFinite(riskFreeRate)) throw new Error("risk-free rate must be a finite number");
  if (bars.length < inSampleBars + outOfSampleBars) {
    throw new Error(
      `walk-forward needs at least ${inSampleBars + outOfSampleBars} bars, received ${bars.length}`,
    );
  }

  // Indicators need history before the first scored bar. Prepending the tail of
  // the in-sample window is legitimate -- that data is already known at the
  // boundary -- and without it a valid parameter set can fail purely because its
  // lookback exceeds the fold length.
  // Default warm-up must cover the longest lookback in the grid, otherwise a
  // parameter set that is valid in-sample fails every fold for lack of history.
  const longestLookback = Math.max(
    0,
    ...parameterGrid(ranges).map((parameters) => {
      const merged = { ...configuration.strategy, ...parameters };
      const candidates = [merged.slow, merged.fast, merged.period, merged.lookback]
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value));
      return candidates.length ? Math.max(...candidates) : 0;
    }),
  );
  const defaultWarmup = Math.max(Math.min(inSampleBars, outOfSampleBars), longestLookback + 2);
  const warmupBars = Math.min(
    inSampleBars,
    Math.max(0, Math.floor(options.warmupBars ?? defaultWarmup)),
  );

  const folds = [];
  let lastScoredIndex = 0;
  for (let start = 0; start + inSampleBars + outOfSampleBars <= bars.length; start += outOfSampleBars) {
    const inSample = bars.slice(start, start + inSampleBars);
    const scoredFrom = start + inSampleBars;
    const scoredTo = scoredFrom + outOfSampleBars;
    const outOfSample = bars.slice(scoredFrom, scoredTo);
    // Warm-up bars precede the scored window and never extend past it, so no
    // future information enters the evaluation.
    const evaluationSlice = bars.slice(scoredFrom - warmupBars, scoredTo);
    lastScoredIndex = scoredTo;
    const sweep = parameterSweep(inSample, configuration, ranges);
    if (!sweep.best) {
      folds.push({
        from: outOfSample[0].date,
        to: outOfSample.at(-1).date,
        ok: false,
        error: "no valid parameter set in sample",
      });
      continue;
    }
    const chosen = sweep.best.parameters;
    try {
      const result = runBacktest(evaluationSlice, {
        ...configuration,
        strategy: strategyWithParameters(configuration.strategy, chosen),
        // Warm-up bars prime the indicators but must not trade: a position
        // opened there would use parameters chosen from later data.
        tradingFromIndex: warmupBars,
      });
      // Score only the out-of-sample portion: drop the warm-up prefix from the
      // equity curve before deriving returns.
      const scoredEquity = result.equity.slice(warmupBars);
      // Warm-up equity is flat initial capital by construction, so the scored
      // window always starts from an untraded portfolio.
      const equityBase = configuration.initialCapital;
      const scoredReturns = [];
      for (let i = 0; i < scoredEquity.length; i += 1) {
        const previous = i === 0 ? equityBase : scoredEquity[i - 1].value;
        if (previous > 0) scoredReturns.push(scoredEquity[i].value / previous - 1);
      }
      const scoredReturn =
        equityBase > 0 && scoredEquity.length
          ? scoredEquity.at(-1).value / equityBase - 1
          : 0;
      const benchmarkReturn = outOfSample.at(-1).close / outOfSample[0].close - 1;
      folds.push({
        from: outOfSample[0].date,
        to: outOfSample.at(-1).date,
        ok: true,
        parameters: chosen,
        warmupBars,
        inSampleSharpe: sweep.best.metrics.sharpe,
        inSampleReturn: sweep.best.metrics.totalReturn,
        outOfSampleSharpe: sharpeOf(scoredReturns, riskFreeRate),
        outOfSampleReturn: scoredReturn,
        benchmarkReturn,
        returns: scoredReturns,
        trades: result.trades.length,
      });
    } catch (error) {
      folds.push({
        from: outOfSample[0].date,
        to: outOfSample.at(-1).date,
        ok: false,
        error: error.message,
      });
    }
  }

  const usable = folds.filter((fold) => fold.ok);
  const mean = (values) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const meanInSampleFoldSharpe = mean(usable.map((fold) => fold.inSampleSharpe));
  const meanOutOfSampleFoldSharpe = mean(usable.map((fold) => fold.outOfSampleSharpe));
  // The mean of per-fold ratios is not the Sharpe of the combined series. Pool
  // the out-of-sample returns and compute one ratio over the whole stream.
  const pooledReturns = usable.flatMap((fold) => fold.returns ?? []);
  const pooledOutOfSampleSharpe = pooledReturns.length > 1 ? sharpeOf(pooledReturns, riskFreeRate) : null;
  for (const fold of usable) delete fold.returns;
  return {
    folds,
    inSampleBars,
    outOfSampleBars,
    warmupBars,
    usableFolds: usable.length,
    failedFolds: folds.length - usable.length,
    // Bars after the last scored fold are never evaluated; report the omission
    // rather than letting recent data disappear silently.
    untestedTailBars: bars.length - lastScoredIndex,
    testedThrough: usable.length ? usable.at(-1).to : null,
    meanInSampleFoldSharpe,
    meanOutOfSampleFoldSharpe,
    pooledOutOfSampleSharpe,
    // Sharpe routinely collapses out of sample; a large gap means the in-sample
    // figure was largely parameter selection, not signal.
    degradation:
      meanInSampleFoldSharpe == null || pooledOutOfSampleSharpe == null
        ? null
        : meanInSampleFoldSharpe - pooledOutOfSampleSharpe,
    outOfSampleWinRate: usable.length
      ? usable.filter((fold) => fold.outOfSampleReturn > 0).length / usable.length
      : null,
    beatBenchmarkRate: usable.length
      ? usable.filter((fold) => fold.outOfSampleReturn > fold.benchmarkReturn).length / usable.length
      : null,
  };
}

// Locates the worst peak-to-trough stretch so a research prompt can ask what
// actually happened during it, rather than quoting a bare drawdown number.
export function drawdownEpisodes(equity, limit = 3) {
  if (!Array.isArray(equity) || equity.length === 0) return [];
  const episodes = [];
  let peak = equity[0];
  let trough = equity[0];
  let inDrawdown = false;
  const close = () => {
    if (!inDrawdown || peak.value <= 0) return;
    episodes.push({
      peakDate: peak.date,
      troughDate: trough.date,
      depth: trough.value / peak.value - 1,
    });
    inDrawdown = false;
  };
  for (const point of equity) {
    if (point.value >= peak.value) {
      close();
      peak = point;
      trough = point;
      continue;
    }
    inDrawdown = true;
    if (point.value < trough.value) trough = point;
  }
  close();
  return episodes
    .sort((a, b) => a.depth - b.depth)
    .slice(0, Math.max(0, Math.floor(limit)));
}

// Assembles everything a reviewer needs to judge a result. Every number here
// comes from the engine; the agent explains it and never recomputes it.
export function researchEvidence(result, options = {}) {
  const { metrics, equity, trades, bars } = result;
  const episodes = drawdownEpisodes(equity, 3);
  const walk = options.walkForward ?? null;
  const sweep = options.sweep ?? null;

  const concerns = [];
  if (metrics.trades < 30) {
    concerns.push(
      `only ${metrics.trades} closed trades; per-trade statistics are not statistically meaningful`,
    );
  }
  if (metrics.totalReturn <= metrics.benchmarkReturn) {
    concerns.push("strategy underperforms buy-and-hold before any further adjustment");
  }
  if (walk && walk.usableFolds === 0) {
    concerns.push(
      "walk-forward produced no usable folds; the out-of-sample figures are unavailable, not favourable",
    );
  }
  if (walk && walk.failedFolds > 0 && walk.usableFolds > 0) {
    concerns.push(
      `${walk.failedFolds} of ${walk.folds.length} walk-forward folds failed and are excluded from the summary`,
    );
  }
  if (walk && walk.untestedTailBars > 0) {
    concerns.push(
      `${walk.untestedTailBars} most recent bars fall outside the last scored fold and were never validated`,
    );
  }
  if (walk && walk.degradation != null && walk.degradation > 0.5) {
    concerns.push(
      `Sharpe falls ${walk.degradation.toFixed(2)} from in-sample to pooled out-of-sample, indicating parameter overfitting`,
    );
  }
  if (walk && walk.beatBenchmarkRate != null && walk.beatBenchmarkRate < 0.5) {
    concerns.push(
      `beats benchmark in only ${(walk.beatBenchmarkRate * 100).toFixed(0)}% of out-of-sample folds`,
    );
  }
  if (sweep && sweep.sharpeStdDev != null && sweep.sharpeMean != null) {
    if (sweep.sharpeMax - sweep.sharpeMean > 2 * sweep.sharpeStdDev) {
      concerns.push(
        "best parameter set is an isolated peak in the sweep; the neighbourhood does not support it",
      );
    }
  }
  if (result.skippedEntries?.length) {
    const unavailable = result.skippedEntries.filter(
      (entry) => entry.reason === "sizer-unavailable",
    ).length;
    concerns.push(
      `${result.skippedEntries.length} entry signals were skipped because the sizer produced no position` +
        (unavailable ? ` (${unavailable} lacked volatility history)` : ""),
    );
  }
  if (sweep && sweep.eligible === 0 && sweep.usable > 0) {
    concerns.push("no swept parameter set produced a trade; the sweep has no valid winner");
  }
  if (!walk) concerns.push("no out-of-sample validation was run");

  return {
    sample: bars.length ? { bars: bars.length, from: bars[0].date, to: bars.at(-1).date } : null,
    metrics,
    worstDrawdowns: episodes,
    tradeCount: trades.length,
    walkForward: walk,
    sweep: sweep
      ? {
          evaluated: sweep.evaluated,
          usable: sweep.usable,
          eligible: sweep.eligible,
          best: sweep.best?.parameters ?? null,
          sharpeMean: sweep.sharpeMean,
          sharpeStdDev: sweep.sharpeStdDev,
          sharpeMin: sweep.sharpeMin,
          sharpeMax: sweep.sharpeMax,
        }
      : null,
    concerns,
  };
}

// --- Watchlist -------------------------------------------------------------
// Evaluates the latest bar of a tracked symbol against the same signal rules
// the backtester uses, so an alert can be validated by the same walk-forward
// machinery rather than being an unbacktestable heuristic.

const ALERT_RULES = ["signal-entry", "rsi-oversold", "price-below", "drawdown-from-high"];

export function validateAlertRule(rule) {
  if (!rule || typeof rule !== "object") throw new Error("alert rule is required");
  if (!ALERT_RULES.includes(rule.type)) throw new Error(`unknown alert rule: ${rule.type}`);
  if (rule.type === "price-below") {
    const price = finiteNumber(rule.price, "alert price");
    if (price <= 0) throw new Error("alert price must be positive");
    return { type: rule.type, price };
  }
  if (rule.type === "rsi-oversold") {
    const period = Math.floor(finiteNumber(rule.period ?? 14, "RSI period"));
    const threshold = finiteNumber(rule.threshold ?? 30, "RSI threshold");
    if (period < 2) throw new Error("RSI period must be >= 2");
    if (threshold <= 0 || threshold >= 100) throw new Error("RSI threshold must be within (0, 100)");
    return { type: rule.type, period, threshold };
  }
  if (rule.type === "drawdown-from-high") {
    const pct = finiteNumber(rule.pct ?? 20, "drawdown threshold");
    const lookback = Math.floor(finiteNumber(rule.lookback ?? 252, "drawdown lookback"));
    if (pct <= 0 || pct >= 100) throw new Error("drawdown threshold must be within (0, 100)");
    if (lookback < 2) throw new Error("drawdown lookback must be >= 2");
    return { type: rule.type, pct, lookback };
  }
  return { type: rule.type, strategy: rule.strategy ?? null };
}

// Evaluates one symbol. Returns a structured verdict rather than a message, so
// the caller decides how to present it and the agent never invents numbers.
export function evaluateWatchItem(bars, item) {
  if (!Array.isArray(bars) || bars.length < 2) throw new Error("need at least two bars");
  const rule = validateAlertRule(item.rule);
  const last = bars.at(-1);
  const closes = bars.map((bar) => bar.close);
  const base = {
    symbol: item.symbol,
    asOf: last.date,
    close: last.close,
    changePct: closes.at(-2) > 0 ? last.close / closes.at(-2) - 1 : 0,
    rule: rule.type,
  };

  if (rule.type === "price-below") {
    return {
      ...base,
      triggered: last.close <= rule.price,
      detail: `收盘 ${last.close.toFixed(2)}，触发线 ${rule.price.toFixed(2)}`,
      distance: rule.price > 0 ? last.close / rule.price - 1 : null,
    };
  }

  if (rule.type === "rsi-oversold") {
    const rsi = relativeStrengthIndex(closes, rule.period);
    const value = rsi.at(-1);
    if (value == null) {
      return { ...base, triggered: false, detail: "历史不足，无法计算 RSI", distance: null };
    }
    return {
      ...base,
      triggered: value <= rule.threshold,
      detail: `RSI(${rule.period}) ${value.toFixed(1)}，阈值 ${rule.threshold}`,
      distance: (value - rule.threshold) / 100,
    };
  }

  if (rule.type === "drawdown-from-high") {
    const window = closes.slice(-rule.lookback);
    const high = Math.max(...window);
    const drawdown = high > 0 ? last.close / high - 1 : 0;
    return {
      ...base,
      triggered: drawdown <= -rule.pct / 100,
      detail: `距 ${rule.lookback} 日高点 ${(drawdown * 100).toFixed(1)}%，阈值 -${rule.pct}%`,
      distance: drawdown + rule.pct / 100,
    };
  }

  // signal-entry: fires on the same edge the backtester would trade.
  const strategy = rule.strategy ?? item.strategy;
  if (!strategy) throw new Error("signal-entry alert needs a strategy");
  const { signals } = strategySignals(bars, strategy);
  const lastSignal = signals.at(-1);
  return {
    ...base,
    triggered: Boolean(lastSignal?.enterSignal),
    detail: lastSignal?.enterSignal
      ? `${strategyRuleLabel(strategy)} 今日出现买入信号`
      : lastSignal?.enter
        ? `${strategyRuleLabel(strategy)} 处于持有区间，但今日无新信号`
        : `${strategyRuleLabel(strategy)} 未触发`,
    distance: null,
  };
}

function strategyRuleLabel(strategy) {
  if (strategy.type === "sma-cross") return `SMA ${strategy.fast}/${strategy.slow}`;
  if (strategy.type === "rsi-reversion") return `RSI ${strategy.period}`;
  if (strategy.type === "breakout") return `突破 ${strategy.lookback}`;
  return strategy.type;
}

// Ranks evaluated items so triggered ones surface first, then those closest to
// triggering. Sorting by proximity keeps a long watchlist scannable.
export function rankWatchResults(results) {
  return [...results].sort((a, b) => {
    if (a.triggered !== b.triggered) return a.triggered ? -1 : 1;
    const left = a.distance == null ? Number.POSITIVE_INFINITY : Math.abs(a.distance);
    const right = b.distance == null ? Number.POSITIVE_INFINITY : Math.abs(b.distance);
    return left - right;
  });
}
