import { analyzeStockHistory } from "./stock-screener.mjs";
import { buildStockLevels } from "./stock-levels.mjs";

const A_SHARE_SYMBOL = /^(SH|SZ)(\d{6})$/u;

function cleanText(value, maximum = 240) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, maximum)
    : "";
}

function finiteNumber(value) {
  if (value === "" || value === "-" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function canonicalSymbol(exchange, code) {
  const symbol = `${String(exchange).toUpperCase()}${code}`;
  if (!A_SHARE_SYMBOL.test(symbol)) return null;
  if ((symbol.startsWith("SH") && !/^[69]/u.test(code)) || (symbol.startsWith("SZ") && !/^[023]/u.test(code))) {
    return null;
  }
  return symbol;
}

function boardFor(symbol) {
  if (/^SH68\d{4}$/u.test(symbol)) return "star";
  if (/^SZ3\d{5}$/u.test(symbol)) return "chinext";
  return "main";
}

function parseTimestamp(value) {
  if (!/^\d{14}$/u.test(value)) throw new Error("腾讯行情缺少有效交易时点");
  const marketDate = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const asOf = `${marketDate}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+08:00`;
  if (!validDate(marketDate) || !Number.isFinite(Date.parse(asOf))) throw new Error("腾讯行情交易时点无效");
  return { marketDate, asOf };
}

export function parseTencentStockQuote(textInput) {
  const text = String(textInput ?? "");
  const match = /v_(sh|sz)(\d{6})="([^"]*)"/u.exec(text);
  if (!match) throw new Error("腾讯行情没有返回这只 A 股");
  const symbol = canonicalSymbol(match[1], match[2]);
  if (!symbol) throw new Error("腾讯行情返回了非沪深 A 股代码");
  const fields = match[3].split("~");
  const name = cleanText(fields[1], 40);
  const code = cleanText(fields[2], 6);
  const price = finiteNumber(fields[3]);
  const previousClose = finiteNumber(fields[4]);
  const open = finiteNumber(fields[5]);
  const high = finiteNumber(fields[33]);
  const low = finiteNumber(fields[34]);
  const amountFromTrade = finiteNumber(fields[35]?.split("/")?.[2]);
  const amount = amountFromTrade ?? (finiteNumber(fields[37]) == null ? null : finiteNumber(fields[37]) * 10_000);
  const volumeLots = finiteNumber(fields[36] || fields[6]);
  const turnover = finiteNumber(fields[38]);
  const changePercent = finiteNumber(fields[32]);
  if (
    !name || code !== match[2] ||
    [price, previousClose, open, high, low, amount, volumeLots, turnover, changePercent].some((value) => value == null) ||
    price <= 0 || previousClose <= 0 || open <= 0 || high < Math.max(open, price) || low > Math.min(open, price) ||
    amount < 0 || volumeLots < 0 || turnover < 0
  ) {
    throw new Error("腾讯个股行情字段不完整或相互冲突");
  }
  const timestamp = parseTimestamp(fields[30] ?? "");
  const floatMarketCapYi = finiteNumber(fields[44]);
  const totalMarketCapYi = finiteNumber(fields[45]);
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
    change: round(price - previousClose),
    changePercent,
    volume: Math.round(volumeLots * 100),
    amount,
    turnover,
    pe: finiteNumber(fields[39]),
    pb: finiteNumber(fields[46]),
    totalMarketCap: totalMarketCapYi == null ? null : totalMarketCapYi * 100_000_000,
    floatMarketCap: floatMarketCapYi == null ? null : floatMarketCapYi * 100_000_000,
    marketDate: timestamp.marketDate,
    asOf: timestamp.asOf,
  });
}

function decodeTencentEscapes(value) {
  try {
    return JSON.parse(`"${String(value).replace(/"/gu, "\\\"")}"`);
  } catch {
    return "";
  }
}

export function parseTencentStockSuggestions(textInput, queryInput) {
  const query = cleanText(queryInput, 80).replace(/\s+/gu, "");
  const match = /v_hint="([^"]*)"/u.exec(String(textInput ?? ""));
  if (!query || !match) return Object.freeze([]);
  const decoded = decodeTencentEscapes(match[1]);
  const seen = new Set();
  const rows = [];
  for (const raw of decoded.split("^")) {
    const [exchange, code, rawName, , kind] = raw.split("~");
    const symbol = canonicalSymbol(exchange, code);
    const name = cleanText(rawName, 40);
    if (!symbol || !name || kind !== "GP-A" || seen.has(symbol)) continue;
    seen.add(symbol);
    rows.push(Object.freeze({ symbol, code, name }));
  }
  return Object.freeze(rows.slice(0, 10));
}

export function resolveTencentStockSuggestion(textInput, queryInput) {
  const query = cleanText(queryInput, 80).replace(/\s+/gu, "");
  const rows = parseTencentStockSuggestions(textInput, query);
  const exact = rows.filter((item) => item.name.replace(/\s+/gu, "") === query || item.code === query);
  if (exact.length === 1) return exact[0];
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) {
    throw new Error(`名称不唯一，请输入代码：${rows.slice(0, 5).map((item) => `${item.name} ${item.code}`).join("、")}`);
  }
  throw new Error("未找到这只 A 股，请检查名称或输入六位代码");
}

function financialNumber(value, minimum, maximum, label, { ratio = false } = {}) {
  const number = finiteNumber(value);
  if (number == null) return null;
  const normalized = ratio ? number * 100 : number;
  if (normalized < minimum || normalized > maximum) throw new Error(`${label}超出有效范围`);
  return round(normalized);
}

function eastmoneySecucode(symbol) {
  if (!A_SHARE_SYMBOL.test(symbol)) throw new Error("财务数据股票代码无效");
  return `${symbol.slice(2)}.${symbol.slice(0, 2)}`;
}

export function parseEastmoneyFinancials(payload, symbolInput, availableAtInput = new Date()) {
  const symbol = cleanText(symbolInput, 16).toUpperCase();
  const secucode = eastmoneySecucode(symbol);
  const availableAt = new Date(availableAtInput);
  if (!Number.isFinite(availableAt.getTime())) throw new Error("财务数据可用时点无效");
  if (!payload || typeof payload !== "object" || payload.success !== true || !Array.isArray(payload.result?.data)) {
    throw new Error("东方财富财务摘要返回结构无效");
  }
  const cutoff = new Date(availableAt.getTime() + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  const periods = [];
  const seen = new Set();
  for (const row of payload.result.data) {
    if (cleanText(row?.SECUCODE, 16).toUpperCase() !== secucode) continue;
    const reportDate = cleanText(row.REPORT_DATE, 10);
    const noticeDate = cleanText(row.NOTICE_DATE, 10);
    if (!validDate(reportDate) || !validDate(noticeDate) || reportDate > noticeDate || noticeDate > cutoff || seen.has(reportDate)) continue;
    seen.add(reportDate);
    periods.push(Object.freeze({
      reportDate,
      noticeDate,
      reportName: cleanText(row.REPORT_DATE_NAME ?? row.REPORT_TYPE, 30) || reportDate,
      currency: cleanText(row.CURRENCY, 8) || "CNY",
      revenue: financialNumber(row.TOTALOPERATEREVE, 0, 1e16, "营业收入"),
      revenueYoY: financialNumber(row.TOTALOPERATEREVETZ, -100, 100_000, "营业收入同比"),
      netProfit: financialNumber(row.PARENTNETPROFIT, -1e16, 1e16, "归母净利润"),
      netProfitYoY: financialNumber(row.PARENTNETPROFITTZ, -100_000, 100_000, "归母净利润同比"),
      deductedProfit: financialNumber(row.KCFJCXSYJLR, -1e16, 1e16, "扣非净利润"),
      deductedProfitYoY: financialNumber(row.KCFJCXSYJLRTZ, -100_000, 100_000, "扣非净利润同比"),
      eps: financialNumber(row.EPSJB, -1e6, 1e6, "每股收益"),
      roe: financialNumber(row.ROEJQ, -1_000, 1_000, "加权 ROE"),
      grossMargin: financialNumber(row.XSMLL, -1_000, 1_000, "销售毛利率"),
      netMargin: financialNumber(row.XSJLL, -1_000, 1_000, "销售净利率"),
      debtRatio: financialNumber(row.ZCFZL, 0, 1_000, "资产负债率"),
      currentRatio: financialNumber(row.LD, 0, 10_000, "流动比率"),
      quickRatio: financialNumber(row.SD, 0, 10_000, "速动比率"),
      operatingCashPerShare: financialNumber(row.MGJYXJJE, -1e6, 1e6, "每股经营现金流"),
      cashRevenueRatio: financialNumber(row.JYXJLYYSR, -100_000, 100_000, "经营现金流收入比", { ratio: true }),
    }));
  }
  periods.sort((left, right) => right.reportDate.localeCompare(left.reportDate) || right.noticeDate.localeCompare(left.noticeDate));
  const latestPeriods = periods.slice(0, 8);
  return Object.freeze({
    version: 1,
    available: latestPeriods.length > 0,
    periods: Object.freeze(latestPeriods),
    disclosure: latestPeriods.length
      ? "财务摘要按公告日过滤，只展示当时已公开的数据；季度指标多为年初至报告期累计口径，不把缺失字段补为 0。"
      : "当前公开财务摘要没有返回可用报告期；不能据此判断公司没有财务披露。",
  });
}

function normalizeFinancials(value) {
  if (value == null) return Object.freeze({
    version: 1,
    available: false,
    periods: Object.freeze([]),
    disclosure: "当前快照未取得公开财务摘要；刷新后仍不可用时，请以公司公告原文为准。",
  });
  if (value.version !== 1 || value.available !== (Array.isArray(value.periods) && value.periods.length > 0)) {
    throw new Error("财务摘要结构无效");
  }
  return value;
}

function sanitizeBars(input, marketDate) {
  const rows = new Map();
  for (const item of Array.isArray(input) ? input : []) {
    const date = cleanText(item?.date, 10);
    const open = finiteNumber(item?.open);
    const high = finiteNumber(item?.high);
    const low = finiteNumber(item?.low);
    const close = finiteNumber(item?.close);
    const volume = finiteNumber(item?.volume);
    if (
      !validDate(date) || date > marketDate ||
      [open, high, low, close, volume].some((value) => value == null || value < 0) ||
      Math.min(open, high, low, close) <= 0 || high < Math.max(open, close) || low > Math.min(open, close)
    ) continue;
    rows.set(date, Object.freeze({ date, open, high, low, close, volume: Math.round(volume) }));
  }
  return [...rows.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(-180);
}

function liveBars(quote, bars, provisional) {
  const rows = [...bars];
  if (!provisional) return rows;
  const current = Object.freeze({
    date: quote.marketDate,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    close: quote.price,
    volume: quote.volume,
  });
  const index = rows.findIndex((item) => item.date === quote.marketDate);
  if (index >= 0) rows[index] = current;
  else rows.push(current);
  return rows.slice(-180);
}

function returnFor(rows, periods) {
  if (rows.length <= periods) return null;
  return round((rows.at(-1).close / rows.at(-(periods + 1)).close - 1) * 100);
}

function movingAverage(rows, periods) {
  if (rows.length < periods) return null;
  return round(mean(rows.slice(-periods).map((item) => item.close)));
}

function buildMetrics(quote, rows, provisional) {
  const analyzed = analyzeStockHistory(quote, rows, { marketDate: quote.marketDate, provisional });
  const renderedBars = liveBars(quote, rows, provisional);
  const last120 = renderedBars.slice(-120);
  const high120 = last120.length ? Math.max(...last120.map((item) => item.high)) : null;
  const low120 = last120.length ? Math.min(...last120.map((item) => item.low)) : null;
  return Object.freeze({
    ma20: analyzed ? round(analyzed.ma20) : movingAverage(renderedBars, 20),
    ma60: analyzed ? round(analyzed.ma60) : movingAverage(renderedBars, 60),
    ma120: movingAverage(renderedBars, 120),
    return20: analyzed ? round(analyzed.return20) : returnFor(renderedBars, 20),
    return60: analyzed ? round(analyzed.return60) : returnFor(renderedBars, 60),
    return120: returnFor(renderedBars, 120),
    volumeRatio20: analyzed ? round(analyzed.volumeRatio) : null,
    extension20: analyzed ? round(analyzed.extension20) : null,
    volatility20: analyzed?.volatility20 == null ? null : round(analyzed.volatility20),
    high120: high120 == null ? null : round(high120),
    low120: low120 == null ? null : round(low120),
    distanceHigh120: high120 == null ? null : round((quote.price / high120 - 1) * 100),
    historyBars: renderedBars.length,
    lastBarDate: renderedBars.at(-1)?.date ?? "",
  });
}

function buildTiming(quote, metrics) {
  if (metrics.ma20 == null || metrics.ma60 == null || metrics.extension20 == null) {
    const shortHistory = metrics.historyBars > 0 && metrics.historyBars < 60;
    return Object.freeze({
      state: "unavailable",
      label: shortHistory ? "上市历史较短" : "历史数据不足",
      action: shortHistory
        ? `目前只有 ${metrics.historyBars} 个交易日，先展示真实行情，不输出趋势买卖时机。`
        : "先补足趋势数据，再判断观察时机。",
      confirmation: shortHistory
        ? `累计至少 60 个有效交易日后，再启用 MA20 / MA60 趋势判断。`
        : "至少需要 60 个有效交易日。",
      invalidation: "当前不能仅凭单日涨跌形成买卖判断。",
    });
  }
  const strong = quote.price > metrics.ma20 && metrics.ma20 > metrics.ma60 && (metrics.return60 ?? -100) > 0;
  if (strong && metrics.extension20 >= -2 && metrics.extension20 <= 5 && quote.changePercent < 7) {
    return Object.freeze({
      state: "watch",
      label: "进入观察区",
      action: "趋势仍在，位置未明显远离 20 日线；等待量价或事件进一步确认。",
      confirmation: `价格守住 MA20 ${metrics.ma20.toFixed(2)}，且成交量不明显萎缩。`,
      invalidation: `收盘跌破 MA20 ${metrics.ma20.toFixed(2)}，或公告与基本面出现新的反方证据。`,
    });
  }
  if (strong && metrics.extension20 > 5) {
    return Object.freeze({
      state: "extended",
      label: "位置偏高",
      action: `当前高于 MA20 ${metrics.extension20.toFixed(1)}%，优先等待回撤确认，避免只因上涨追入。`,
      confirmation: `回撤后重新站稳 MA20 ${metrics.ma20.toFixed(2)}，或放量突破后不快速回落。`,
      invalidation: `跌破 MA20 ${metrics.ma20.toFixed(2)} 且无法快速收回。`,
    });
  }
  return Object.freeze({
    state: "risk",
    label: "等待趋势修复",
    action: "当前未同时满足价格、20 日线与 60 日线的趋势条件。",
    confirmation: `重新站上 MA20 ${metrics.ma20.toFixed(2)}，并观察 MA20 是否高于 MA60 ${metrics.ma60.toFixed(2)}。`,
    invalidation: `若继续跌破 MA60 ${metrics.ma60.toFixed(2)}，弱势结构仍在。`,
  });
}

export function buildStockDetailTrend(quote, barsInput, { provisional = false } = {}) {
  if (!quote || !validDate(quote.marketDate)) throw new Error("个股趋势需要有效行情日期");
  const bars = sanitizeBars(barsInput, quote.marketDate);
  const metrics = buildMetrics(quote, bars, provisional);
  const renderedBars = Object.freeze(liveBars(quote, bars, provisional));
  return Object.freeze({
    bars: renderedBars,
    metrics,
    timing: buildTiming(quote, metrics),
    levels: buildStockLevels(renderedBars, quote.price),
  });
}

function validEvent(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const kind = ["announcement", "news"].includes(item.kind) ? item.kind : null;
  const importance = ["context", "risk", "operating", "routine"].includes(item.importance) ? item.importance : "context";
  const id = cleanText(item.id, 100);
  const title = cleanText(item.title, 240);
  const label = cleanText(item.label, 40) || (kind === "announcement" ? "公司公告" : "个股新闻");
  const publishedAt = cleanText(item.publishedAt, 40);
  let url;
  try {
    url = new URL(item.url);
  } catch {
    return null;
  }
  const allowed = ["eastmoney.com", "sina.com.cn", "csrc.gov.cn", "pbc.gov.cn"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  if (!kind || !id || !title || !Number.isFinite(Date.parse(publishedAt)) || url.protocol !== "https:" || !allowed || url.username || url.password) {
    return null;
  }
  return Object.freeze({ kind, importance, id, title, label, publishedAt, url: url.toString() });
}

function mergedEvents(input) {
  const seen = new Set();
  return Object.freeze((Array.isArray(input) ? input : [])
    .map(validEvent)
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt) || left.id.localeCompare(right.id))
    .filter((item) => {
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8));
}

export function buildAShareStockDetailSnapshot(input) {
  const quote = input?.quote;
  if (!quote || !A_SHARE_SYMBOL.test(quote.symbol) || !validDate(quote.marketDate) || !Number.isFinite(Date.parse(quote.asOf))) {
    throw new Error("个股详情需要有效实时行情");
  }
  const generatedAt = new Date(input.generatedAt);
  if (!Number.isFinite(generatedAt.getTime())) throw new Error("个股详情生成时间无效");
  const provisional = input.provisional === true;
  const previousClose = input.previousClose === true;
  if (provisional && previousClose) throw new Error("个股详情交易阶段冲突");
  const phase = provisional ? "intraday" : previousClose ? "previous-close" : "close";
  const bars = sanitizeBars(input.bars, quote.marketDate);
  const metrics = buildMetrics(quote, bars, provisional);
  const renderedBars = Object.freeze(liveBars(quote, bars, provisional));
  const events = mergedEvents(input.events);
  const financials = normalizeFinancials(input.financials);
  const sourceStatus = Object.freeze({
    quote: true,
    history: input.sourceStatus?.history === true,
    announcements: input.sourceStatus?.announcements === true,
    news: input.sourceStatus?.news === true,
    financials: input.sourceStatus?.financials === true,
  });
  const historyAdjust = sourceStatus.history
    ? input.historyAdjust === "none" ? "none" : "qfq"
    : null;
  return Object.freeze({
    schemaVersion: 1,
    kind: "a-share-stock-detail-snapshot",
    marketDate: quote.marketDate,
    asOf: quote.asOf,
    generatedAt: generatedAt.toISOString(),
    session: Object.freeze({ phase, provisional, previousClose }),
    stock: Object.freeze({
      symbol: quote.symbol,
      code: quote.code,
      name: quote.name,
      board: quote.board,
      price: quote.price,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      previousClose: quote.previousClose,
      change: quote.change,
      changePercent: quote.changePercent,
      volume: quote.volume,
      amount: quote.amount,
      turnover: quote.turnover,
      pe: quote.pe,
      pb: quote.pb,
      totalMarketCap: quote.totalMarketCap,
      floatMarketCap: quote.floatMarketCap,
    }),
    metrics,
    timing: buildTiming(quote, metrics),
    levels: buildStockLevels(renderedBars, quote.price),
    financials,
    bars: renderedBars,
    events,
    historyAdjust,
    sourceStatus,
    sourceErrors: Object.freeze(Array.isArray(input.sourceErrors) ? input.sourceErrors.slice(0, 8) : []),
    sources: Object.freeze([
      Object.freeze({ label: "腾讯证券 · 实时行情", url: `https://gu.qq.com/${quote.symbol.toLowerCase()}/gp`, asOf: quote.asOf }),
      ...(sourceStatus.history ? [Object.freeze({
        label: historyAdjust === "none" ? "腾讯证券 · 未复权日线（新股短历史）" : "腾讯证券 · 前复权日线",
        url: "https://gu.qq.com/",
        asOf: quote.marketDate,
      })] : []),
      ...(sourceStatus.announcements ? [Object.freeze({ label: "东方财富 · 上市公司公告", url: "https://data.eastmoney.com/notices/", asOf: generatedAt.toISOString() })] : []),
      ...(sourceStatus.news ? [Object.freeze({ label: "东方财富 · 财经快讯", url: "https://finance.eastmoney.com/", asOf: generatedAt.toISOString() })] : []),
      ...(sourceStatus.financials ? [Object.freeze({ label: "东方财富 · 公开财务摘要", url: `https://data.eastmoney.com/stockdata/${quote.code}.html`, asOf: financials.periods[0]?.noticeDate ?? generatedAt.toISOString() })] : []),
    ]),
    disclaimer: "行情与时机条件仅用于研究，不构成个性化买卖、仓位或收益建议。",
  });
}
