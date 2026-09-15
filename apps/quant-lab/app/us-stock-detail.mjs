import { buildStockDetailTrend } from "./a-share-stock-detail.mjs";

const US_SYMBOL = /^[A-Z][A-Z0-9.-]{0,14}$/u;
const US_EXCHANGES = new Set(["ASE", "BTS", "NCM", "NGM", "NMS", "NYQ", "PCX"]);

function cleanText(value, maximum = 240) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, maximum)
    : "";
}

function finiteNumber(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function dateInNewYork(timestamp) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

export function canonicalUsSymbol(value) {
  const symbol = cleanText(value, 20).toUpperCase().replace(/\//gu, "-");
  return US_SYMBOL.test(symbol) ? symbol : null;
}

export function parseYahooStockSuggestions(payload, queryInput) {
  const query = cleanText(queryInput, 80).toUpperCase();
  const seen = new Set();
  const rows = [];
  for (const item of Array.isArray(payload?.quotes) ? payload.quotes : []) {
    const symbol = canonicalUsSymbol(item?.symbol);
    const exchange = cleanText(item?.exchange, 12).toUpperCase();
    const name = cleanText(item?.longname || item?.shortname, 80);
    if (!symbol || !name || item?.quoteType !== "EQUITY" || !US_EXCHANGES.has(exchange) || seen.has(symbol)) continue;
    seen.add(symbol);
    rows.push(Object.freeze({
      symbol,
      name,
      exchange,
      exchangeLabel: cleanText(item?.exchDisp, 32) || exchange,
      sector: cleanText(item?.sector, 60),
      industry: cleanText(item?.industry, 80),
      exact: symbol === query,
    }));
  }
  return Object.freeze(rows.slice(0, 10));
}

export function resolveYahooStockSuggestion(payload, queryInput) {
  const query = cleanText(queryInput, 80);
  const rows = parseYahooStockSuggestions(payload, query);
  const normalized = query.toUpperCase();
  const exact = rows.filter((item) => item.symbol === normalized || item.name.toUpperCase() === normalized);
  if (exact.length === 1) return exact[0];
  if (rows.length >= 1) return rows[0];
  throw new Error("未找到这只美股，请输入公司名称或美股代码");
}

function adjustedBars(result) {
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] ?? {};
  const adjusted = result?.indicators?.adjclose?.[0]?.adjclose ?? [];
  const rows = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const close = finiteNumber(quote.close?.[index]);
    const adjustedClose = finiteNumber(adjusted[index]) ?? close;
    const factor = close && adjustedClose ? adjustedClose / close : 1;
    const open = finiteNumber(quote.open?.[index]);
    const high = finiteNumber(quote.high?.[index]);
    const low = finiteNumber(quote.low?.[index]);
    const volume = finiteNumber(quote.volume?.[index]);
    const date = dateInNewYork(Number(timestamps[index]) * 1_000);
    if (
      !/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
      [open, high, low, close, adjustedClose, volume].some((value) => value == null) ||
      Math.min(open, high, low, close, adjustedClose) <= 0 || volume < 0
    ) continue;
    const row = {
      date,
      open: round(open * factor, 4),
      high: round(high * factor, 4),
      low: round(low * factor, 4),
      close: round(adjustedClose, 4),
      volume: Math.round(volume),
    };
    if (row.high < Math.max(row.open, row.close)) row.high = Math.max(row.open, row.close);
    if (row.low > Math.min(row.open, row.close)) row.low = Math.min(row.open, row.close);
    rows.push(Object.freeze(row));
  }
  return Object.freeze(rows.slice(-180));
}

export function buildUsStockDetailSnapshot(payload, identity, nowInput = new Date()) {
  const now = new Date(nowInput);
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || !Number.isFinite(now.getTime())) throw new Error("美股行情结构无效");
  const symbol = canonicalUsSymbol(meta.symbol);
  if (!symbol || symbol !== identity?.symbol || meta.instrumentType !== "EQUITY") throw new Error("美股行情代码与搜索结果不一致");
  const bars = adjustedBars(result);
  if (!bars.length) throw new Error("美股历史行情为空");
  const rawQuote = result.indicators?.quote?.[0] ?? {};
  const lastIndex = rawQuote.close?.length - 1;
  const price = finiteNumber(meta.regularMarketPrice) ?? finiteNumber(rawQuote.close?.[lastIndex]);
  const previousClose = finiteNumber(meta.chartPreviousClose) ?? finiteNumber(meta.previousClose);
  const open = finiteNumber(rawQuote.open?.[lastIndex]) ?? price;
  const high = finiteNumber(meta.regularMarketDayHigh) ?? finiteNumber(rawQuote.high?.[lastIndex]) ?? price;
  const low = finiteNumber(meta.regularMarketDayLow) ?? finiteNumber(rawQuote.low?.[lastIndex]) ?? price;
  const volume = finiteNumber(meta.regularMarketVolume) ?? finiteNumber(rawQuote.volume?.[lastIndex]) ?? 0;
  if ([price, previousClose, open, high, low].some((value) => value == null || value <= 0)) throw new Error("美股最新行情字段不完整");
  const marketDate = bars.at(-1).date;
  const marketTime = Number(meta.regularMarketTime) * 1_000;
  const regularStart = Number(meta.currentTradingPeriod?.regular?.start) * 1_000;
  const regularEnd = Number(meta.currentTradingPeriod?.regular?.end) * 1_000;
  const provisional = Number.isFinite(regularStart) && Number.isFinite(regularEnd) && now.getTime() >= regularStart && now.getTime() < regularEnd;
  const previousSession = dateInNewYork(now) !== marketDate;
  const previousClosePhase = !provisional && previousSession;
  const asOfCandidate = Number.isFinite(marketTime) ? new Date(marketTime) : new Date(Number(result.timestamp?.at(-1)) * 1_000);
  let asOf = asOfCandidate.toISOString();
  if (asOf.slice(0, 10) !== marketDate) asOf = `${marketDate}T20:00:00.000Z`;
  const quote = Object.freeze({
    symbol,
    code: symbol,
    name: cleanText(meta.longName || meta.shortName || identity.name, 80),
    board: "us",
    currency: cleanText(meta.currency, 8) || "USD",
    exchange: cleanText(meta.fullExchangeName || identity.exchangeLabel || meta.exchangeName, 40),
    sector: cleanText(identity.sector, 60),
    industry: cleanText(identity.industry, 80),
    price: round(price, 4),
    open: round(open, 4),
    high: round(Math.max(high, open, price), 4),
    low: round(Math.min(low, open, price), 4),
    previousClose: round(previousClose, 4),
    change: round(price - previousClose, 4),
    changePercent: round((price / previousClose - 1) * 100),
    volume: Math.round(volume),
    amount: null,
    turnover: null,
    pe: null,
    pb: null,
    totalMarketCap: null,
    floatMarketCap: null,
    marketDate,
    asOf,
  });
  const trend = buildStockDetailTrend(quote, bars, { provisional });
  return Object.freeze({
    schemaVersion: 1,
    kind: "us-stock-detail-snapshot",
    market: "us",
    marketDate,
    asOf,
    generatedAt: now.toISOString(),
    session: Object.freeze({
      phase: provisional ? "intraday" : previousClosePhase ? "previous-close" : "close",
      provisional,
      previousClose: previousClosePhase,
    }),
    stock: Object.freeze(quote),
    metrics: trend.metrics,
    timing: trend.timing,
    levels: trend.levels,
    bars: trend.bars,
    events: Object.freeze([]),
    historyAdjust: "adj",
    sourceStatus: Object.freeze({ quote: true, history: true, announcements: false, news: false }),
    sourceErrors: Object.freeze([]),
    sources: Object.freeze([
      Object.freeze({ label: "Yahoo Finance · 美股行情与复权日线", url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`, asOf }),
      Object.freeze({ label: "SEC EDGAR · 公司申报检索", url: `https://www.sec.gov/edgar/browse/?CIK=${encodeURIComponent(symbol)}&owner=exclude&action=getcompany`, asOf: now.toISOString() }),
    ]),
    disclaimer: "Yahoo 行情用于研究展示；公司披露以 SEC 与公司投资者关系页面为准，不构成个性化投资建议。",
  });
}
