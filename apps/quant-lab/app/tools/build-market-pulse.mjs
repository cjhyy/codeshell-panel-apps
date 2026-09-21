#!/usr/bin/env node
import { liveQuoteNumber } from "../live-quote-contract.mjs";
// Deterministic A-share market pulse. The Agent only launches this frozen tool;
// market breadth, index regimes, sector strength and news associations are all
// calculated here and written as one strict market-overview report.

import { open, mkdir, link, unlink } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MARKET_PULSE_INDEXES,
  buildMarketPulseReport,
  calculateMarketBreadth,
  mergeMarketNews,
  parseCsrcMarketNews,
  parseEastmoneyMarketNews,
  parseSinaFinanceRoll,
  parsePbcMarketNews,
  parseSinaIndexQuotes,
  parseSinaIndustryPayload,
  parseSinaKline,
} from "../market-pulse.mjs";
import { chinaClock, fetchAllQuotes, fetchMarketTimestamp } from "./screen-a-shares.mjs";
import { readLocalSnapshot, readLocalSnapshotHistory, writeLocalSnapshot } from "./local-snapshot-store.mjs";

const SINA_QUOTE_ORIGIN = "https://hq.sinajs.cn";
const SINA_HISTORY_ORIGIN = "https://quotes.sina.cn";
const SINA_FINANCE_ORIGIN = "https://vip.stock.finance.sina.com.cn";
const SINA_FEED_ORIGIN = "https://feed.mix.sina.com.cn";
const EASTMONEY_ORIGIN = "https://np-weblist.eastmoney.com";
const EASTMONEY_DATA_ORIGIN = "https://datacenter-web.eastmoney.com";
const CSRC_ORIGIN = "https://www.csrc.gov.cn";
const PBC_ORIGIN = "https://www.pbc.gov.cn";
const ALLOWED_ORIGINS = new Set([
  SINA_QUOTE_ORIGIN,
  SINA_HISTORY_ORIGIN,
  SINA_FINANCE_ORIGIN,
  SINA_FEED_ORIGIN,
  EASTMONEY_ORIGIN,
  EASTMONEY_DATA_ORIGIN,
  CSRC_ORIGIN,
  PBC_ORIGIN,
]);
const USER_AGENT = "QuantLab/0.11 deterministic A-share market pulse";
const TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 2_000_000;

class PulseError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    Object.assign(this, details);
  }
}

function filenameStamp(now) {
  return now.toISOString().replace(/[-:.]/gu, "");
}

function parseArgs(argv) {
  const options = {
    out: "",
    dryRun: false,
    stdout: false,
    persistLocal: false,
    persistPanelData: false,
    readLocal: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--stdout") options.stdout = true;
    else if (argument === "--persist-local") options.persistLocal = true;
    else if (argument === "--persist-panel-data") options.persistPanelData = true;
    else if (argument === "--read-local") options.readLocal = true;
    else if (argument === "--out") options.out = argv[++index] ?? "";
    else if (argument === "--help") options.help = true;
    else throw new PulseError("ARGUMENT_UNKNOWN", `unknown argument: ${argument}`);
  }
  return options;
}

export function defaultPanelDataRoot(input = {}) {
  const operatingSystem = input.platform ?? platform();
  const userHome = input.home ?? homedir();
  if (!userHome) throw new PulseError("PANEL_DATA_ROOT_MISSING", "user home is unavailable");
  if (operatingSystem === "darwin") {
    return resolve(userHome, "Library", "Application Support", "code-shell", "panel-app-data", "quant-lab");
  }
  if (operatingSystem === "win32") {
    return resolve(
      input.appData || resolve(userHome, "AppData", "Roaming"),
      "code-shell",
      "panel-app-data",
      "quant-lab",
    );
  }
  return resolve(
    input.xdgConfig || resolve(userHome, ".config"),
    "code-shell",
    "panel-app-data",
    "quant-lab",
  );
}

function isInstalledPanelTool() {
  return resolve(fileURLToPath(import.meta.url)) === resolve(
    homedir(),
    ".code-shell",
    "panel-apps",
    "quant-lab",
    "app",
    "tools",
    "build-market-pulse.mjs",
  );
}

export function validateMarketPulseOutputPath(path) {
  if (!/^data\/market-insights\/\d{8}T\d{9}Z-market-overview\.json$/u.test(path)) {
    throw new PulseError("OUTPUT_PATH_UNSAFE", `unsafe market-pulse output path: ${path}`);
  }
  return resolve(process.cwd(), path);
}

async function responseBytes(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new PulseError("SOURCE_TOO_LARGE", `response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new PulseError("SOURCE_TOO_LARGE", `response exceeds ${MAX_RESPONSE_BYTES} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchBytes(url, headers = {}) {
  const parsed = new URL(url);
  if (!ALLOWED_ORIGINS.has(parsed.origin) || parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new PulseError("SOURCE_URL_UNSAFE", `unexpected source origin: ${parsed.origin}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(parsed, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json,text/plain,*/*", ...headers },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new PulseError("SOURCE_HTTP", `HTTP ${response.status} from ${parsed.hostname}`, { status: response.status });
    if (new URL(response.url).origin !== parsed.origin) throw new PulseError("SOURCE_REDIRECT", `source escaped allowlist: ${response.url}`);
    return responseBytes(response);
  } catch (error) {
    if (error?.name === "AbortError") throw new PulseError("SOURCE_TIMEOUT", `timeout from ${parsed.hostname}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, encoding = "utf-8", headers = {}) {
  return new TextDecoder(encoding).decode(await fetchBytes(url, headers));
}

async function fetchJson(url, headers = {}) {
  const text = await fetchText(url, "utf-8", headers);
  try {
    return JSON.parse(text);
  } catch {
    throw new PulseError("SOURCE_SHAPE", `non-JSON response from ${new URL(url).hostname}`);
  }
}

async function fetchIndexQuotes() {
  const symbols = MARKET_PULSE_INDEXES.map((item) => item.symbol).join(",");
  const text = await fetchText(`${SINA_QUOTE_ORIGIN}/list=${symbols}`, "gbk", {
    Referer: "https://finance.sina.com.cn/",
  });
  const quotes = parseSinaIndexQuotes(text);
  if (quotes.size < MARKET_PULSE_INDEXES.length) {
    throw new PulseError("INDEX_QUOTE_COVERAGE_LOW", `index quote coverage ${quotes.size}/${MARKET_PULSE_INDEXES.length}`);
  }
  return quotes;
}

export async function fetchIndustries() {
  const text = await fetchText(`${SINA_FINANCE_ORIGIN}/q/view/newSinaHy.php`, "gbk", {
    Referer: "https://finance.sina.com.cn/",
  });
  return parseSinaIndustryPayload(text);
}

async function fetchIndexHistory(symbol) {
  const url = new URL("/cn/api/openapi.php/CN_MarketDataService.getKLineData", SINA_HISTORY_ORIGIN);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("scale", "240");
  url.searchParams.set("ma", "no");
  url.searchParams.set("datalen", "250");
  const bars = parseSinaKline(await fetchJson(url, { Referer: "https://finance.sina.com.cn/" }));
  if (bars.length < 121) throw new PulseError("INDEX_HISTORY_SHORT", `${symbol} has only ${bars.length} bars`);
  return bars;
}

async function fetchIndexHistories() {
  const results = await Promise.allSettled(
    MARKET_PULSE_INDEXES.map(async (index) => [index.symbol, await fetchIndexHistory(index.symbol)]),
  );
  const histories = new Map();
  const failures = [];
  for (const [position, result] of results.entries()) {
    if (result.status === "fulfilled") histories.set(...result.value);
    else failures.push({
      symbol: MARKET_PULSE_INDEXES[position].symbol,
      errorCode: result.reason?.code ?? "INDEX_HISTORY_ERROR",
    });
  }
  return { histories, failures };
}

function marketNewsUrl(now) {
  const url = new URL("/comm/web/getFastNewsList", EASTMONEY_ORIGIN);
  for (const [key, value] of Object.entries({
    client: "web",
    biz: "web_news_col",
    fastColumn: "102",
    sortEnd: "",
    pageSize: "50",
    req_trace: String(now.getTime()),
  })) url.searchParams.set(key, value);
  return url;
}

function sinaFinanceRollUrl(now) {
  const url = new URL("/api/roll/get", SINA_FEED_ORIGIN);
  for (const [key, value] of Object.entries({
    pageid: "153",
    lid: "2516",
    num: "50",
    page: "1",
    r: String(now.getTime()),
  })) url.searchParams.set(key, value);
  return url;
}

export async function fetchMarketNews(now) {
  const results = await Promise.allSettled([
    fetchJson(marketNewsUrl(now), { Referer: "https://finance.eastmoney.com/" })
      .then((payload) => parseEastmoneyMarketNews(payload, now.toISOString())),
    fetchJson(sinaFinanceRollUrl(now), { Referer: "https://finance.sina.com.cn/" })
      .then((payload) => parseSinaFinanceRoll(payload, now.toISOString())),
    fetchText(`${CSRC_ORIGIN}/csrc/xwfb/index.shtml`, "utf-8", { Referer: `${CSRC_ORIGIN}/` })
      .then((html) => parseCsrcMarketNews(html, now.toISOString())),
    fetchText(`${PBC_ORIGIN}/goutongjiaoliu/113456/113469/index.html`, "utf-8", { Referer: `${PBC_ORIGIN}/` })
      .then((html) => parsePbcMarketNews(html, now.toISOString())),
  ]);
  const news = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (news.length === 0) {
    const errors = results.map((result) => result.status === "rejected" ? result.reason?.code ?? "SOURCE_ERROR" : "EMPTY");
    throw new PulseError("NEWS_SOURCES_UNAVAILABLE", `market news unavailable: ${errors.join(",")}`);
  }
  return mergeMarketNews(news);
}

export function selectMarketHeadlines(newsInput, limit = 8) {
  const news = Array.isArray(newsInput) ? newsInput : [];
  const output = [];
  const seen = new Set();
  const buckets = ["sina-finance", "eastmoney-724", "csrc-policy", "pbc-policy"].map((source) => (
    news.filter((item) => item.source === source || item.sources?.some((entry) => entry.source === source))
  ));
  while (output.length < limit && buckets.some((bucket) => bucket.length > 0)) {
    for (const bucket of buckets) {
      while (bucket.length > 0 && seen.has(bucket[0].id)) bucket.shift();
      const item = bucket.shift();
      if (!item) continue;
      seen.add(item.id);
      output.push(item);
      if (output.length >= limit) break;
    }
  }
  for (const item of news) {
    if (output.length >= limit) break;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    output.push(item);
  }
  return output;
}

function dragonTigerUrl(sortType) {
  const url = new URL("/api/data/v1/get", EASTMONEY_DATA_ORIGIN);
  for (const [key, value] of Object.entries({
    reportName: "RPT_DAILYBILLBOARD_DETAILSNEW",
    columns: "SECURITY_CODE,SECUCODE,SECURITY_NAME_ABBR,TRADE_DATE,EXPLANATION,CHANGE_RATE,CLOSE_PRICE,ACCUM_AMOUNT,BILLBOARD_NET_AMT,DEAL_NET_RATIO,FREE_MARKET_CAP",
    pageNumber: "1",
    pageSize: "30",
    sortColumns: "TRADE_DATE,BILLBOARD_NET_AMT",
    sortTypes: `-1,${sortType}`,
    source: "WEB",
    client: "WEB",
  })) url.searchParams.set(key, value);
  return url;
}

export function parseDragonTigerRows(payload, direction) {
  if (!payload?.success || !Array.isArray(payload?.result?.data)) {
    throw new PulseError("DRAGON_TIGER_SHAPE", "dragon-tiger payload has no data array");
  }
  const rows = [];
  const seen = new Set();
  for (const item of payload.result.data) {
    const code = String(item?.SECURITY_CODE ?? "");
    const secucode = String(item?.SECUCODE ?? "");
    const exchange = secucode.endsWith(".SH") ? "SH" : secucode.endsWith(".SZ") ? "SZ" : "";
    const symbol = exchange && /^\d{6}$/u.test(code) ? `${exchange}${code}` : "";
    const marketDate = String(item?.TRADE_DATE ?? "").slice(0, 10);
    const netBuyAmount = Number(item?.BILLBOARD_NET_AMT);
    const name = String(item?.SECURITY_NAME_ABBR ?? "")
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 40);
    const explanation = String(item?.EXPLANATION ?? "")
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 160);
    if (
      !symbol || !name || !/^\d{4}-\d{2}-\d{2}$/u.test(marketDate) ||
      !Number.isFinite(netBuyAmount) || seen.has(symbol) ||
      (direction === "buy" ? netBuyAmount <= 0 : netBuyAmount >= 0)
    ) continue;
    const close = Number(item?.CLOSE_PRICE);
    const changePercent = Number(item?.CHANGE_RATE);
    const amount = Number(item?.ACCUM_AMOUNT);
    const netRatio = Number(item?.DEAL_NET_RATIO);
    if (
      !Number.isFinite(close) || close <= 0 ||
      !Number.isFinite(changePercent) || Math.abs(changePercent) > 30 ||
      !Number.isFinite(amount) || amount < 0 ||
      !Number.isFinite(netRatio) || Math.abs(netRatio) > 1_000
    ) continue;
    seen.add(symbol);
    rows.push({
      symbol,
      name,
      marketDate,
      close,
      changePercent,
      amount,
      netBuyAmount,
      netRatio,
      explanation,
      direction,
    });
    if (rows.length >= 5) break;
  }
  if (rows.length === 0) throw new PulseError("DRAGON_TIGER_EMPTY", `no ${direction} dragon-tiger rows`);
  return rows;
}

async function fetchDragonTiger() {
  const [buyPayload, sellPayload] = await Promise.all([
    fetchJson(dragonTigerUrl("-1"), { Referer: "https://data.eastmoney.com/" }),
    fetchJson(dragonTigerUrl("1"), { Referer: "https://data.eastmoney.com/" }),
  ]);
  const buys = parseDragonTigerRows(buyPayload, "buy");
  const sells = parseDragonTigerRows(sellPayload, "sell");
  const marketDate = buys[0].marketDate;
  if (sells[0].marketDate !== marketDate || [...buys, ...sells].some((item) => item.marketDate !== marketDate)) {
    throw new PulseError("DRAGON_TIGER_DATE_MISMATCH", "dragon-tiger buy/sell dates do not match");
  }
  return { marketDate, entries: [...buys, ...sells] };
}

function liveQuoteRow(quote) {
  return {
    symbol: quote.symbol,
    name: quote.name,
    board: quote.board,
    price: quote.price,
    changePercent: quote.changePercent,
    amount: quote.amount,
    turnover: quote.turnover,
  };
}

function dailyQuoteRow(quote) {
  const symbol = String(quote?.symbol ?? "");
  const name = String(quote?.name ?? "").trim();
  const board = quote?.board;
  const requiredNumbers = [
    quote?.price,
    quote?.open,
    quote?.high,
    quote?.low,
    quote?.previousClose,
    quote?.volume,
    quote?.amount,
    quote?.turnover,
    quote?.changePercent,
    quote?.floatMarketCap,
  ];
  if (
    !/^(?:SH|SZ)\d{6}$/u.test(symbol) ||
    !name ||
    !["main", "star", "chinext"].includes(board) ||
    requiredNumbers.some((value) => !Number.isFinite(value))
  ) {
    throw new PulseError("DAILY_QUOTE_INVALID", `invalid daily quote row for ${symbol || "unknown"}`);
  }
  return Object.freeze({
    symbol,
    name,
    board,
    price: quote.price,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    previousClose: quote.previousClose,
    volume: quote.volume,
    amount: quote.amount,
    turnover: quote.turnover,
    changePercent: quote.changePercent,
    pe: Number.isFinite(quote.pe) ? quote.pe : null,
    pb: Number.isFinite(quote.pb) ? quote.pb : null,
    floatMarketCap: quote.floatMarketCap,
    totalMarketCap: Number.isFinite(quote.totalMarketCap) ? quote.totalMarketCap : null,
  });
}

export function buildDailyRealtimeSnapshot({
  quotes,
  marketDate,
  asOf,
  generatedAt,
  session,
}) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(String(marketDate ?? "")) ||
    !Number.isFinite(Date.parse(asOf)) ||
    String(asOf).slice(0, 10) !== marketDate ||
    !Number.isFinite(Date.parse(generatedAt)) ||
    !["intraday", "close", "previous-close"].includes(session?.phase)
  ) {
    throw new PulseError("DAILY_QUOTE_SNAPSHOT_INVALID", "daily realtime snapshot identity is invalid");
  }
  const rows = (Array.isArray(quotes) ? quotes : [])
    .map(dailyQuoteRow)
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
  if (rows.length === 0 || new Set(rows.map((quote) => quote.symbol)).size !== rows.length) {
    throw new PulseError("DAILY_QUOTE_SNAPSHOT_INVALID", "daily realtime snapshot has no unique quotes");
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: "a-share-realtime-daily-snapshot",
    marketDate,
    asOf,
    generatedAt,
    session: Object.freeze({
      phase: session.phase,
      provisional: session.provisional === true,
      previousClose: session.previousClose === true,
    }),
    quoteCount: rows.length,
    quotes: Object.freeze(rows),
  });
}

export function buildLiveQuoteLists(quotesInput, phase = "intraday") {
  if (!["intraday", "close", "previous-close"].includes(phase)) {
    throw new PulseError("SESSION_PHASE_INVALID", "live quote lists require a valid session phase");
  }
  const phaseLabel = phase === "intraday" ? "盘中" : phase === "previous-close" ? "最近收盘" : "收盘";
  const quotes = (Array.isArray(quotesInput) ? quotesInput : []).filter((quote) =>
    quote?.symbol && /^(?:SH|SZ)\d{6}$/u.test(quote.symbol) &&
    !/(?:ST|退)/iu.test(quote.name) && !/^(?:N|C)[^A-Za-z]/u.test(quote.name) &&
    Number.isFinite(quote.price) && quote.price > 0 &&
    Number.isFinite(quote.changePercent) && Math.abs(quote.changePercent) <= 30 &&
    Number.isFinite(quote.amount) && quote.amount >= 20_000_000 &&
    Number.isFinite(quote.turnover) && quote.turnover >= 0,
  );
  const byGain = quotes.slice().sort((left, right) =>
    right.changePercent - left.changePercent || right.amount - left.amount || left.symbol.localeCompare(right.symbol),
  );
  const byAmount = quotes.slice().sort((left, right) =>
    right.amount - left.amount || Math.abs(right.changePercent) - Math.abs(left.changePercent) || left.symbol.localeCompare(right.symbol),
  );
  const attention = quotes
    .filter((quote) => {
      const upperChange = quote.board === "main" ? 8.8 : 18;
      return quote.price >= 3 && quote.amount >= 300_000_000 && quote.turnover >= 1 && quote.turnover <= 15 &&
        quote.changePercent >= 1.5 && quote.changePercent <= upperChange && quote.floatMarketCap >= 5_000_000_000;
    })
    .sort((left, right) =>
      right.changePercent - left.changePercent || right.amount - left.amount || left.symbol.localeCompare(right.symbol),
    )
    .slice(0, 8)
    .map((quote) => ({
      ...liveQuoteRow(quote),
      reason: `${phaseLabel}涨 ${quote.changePercent.toFixed(2)}% · 成交 ${Math.round(quote.amount / 100_000_000)} 亿 · 换手 ${quote.turnover.toFixed(2)}%`,
      risk: quote.changePercent >= (quote.board === "main" ? 7 : 14)
        ? "接近日内价格上限，追高与回落风险较高"
        : quote.turnover >= 10
          ? "换手偏高，短线拥挤度需要继续观察"
          : phase === "intraday"
            ? "仅为盘中量价线索，收盘后仍需核验趋势、公告与基本面"
            : "仅为收盘量价线索，尚未核验趋势、公告与基本面",
    }));
  return {
    gainers: byGain.slice(0, 8).map(liveQuoteRow),
    losers: byGain.slice(-8).reverse().map(liveQuoteRow),
    active: byAmount.slice(0, 8).map(liveQuoteRow),
    attention,
  };
}

function medianNumber(values) {
  const rows = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!rows.length) return null;
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
}

function anomalySession(asOf, phase) {
  if (phase !== "intraday") return { id: "close", label: phase === "previous-close" ? "最近收盘" : "收盘" };
  const match = String(asOf ?? "").match(/T(\d{2}):(\d{2})/u);
  const minutes = match ? Number(match[1]) * 60 + Number(match[2]) : 11 * 60;
  if (minutes <= 9 * 60 + 30) return { id: "auction", label: "集合竞价" };
  if (minutes < 10 * 60 + 30) return { id: "open", label: "开盘阶段" };
  if (minutes < 14 * 60 + 30) return { id: "intraday", label: "盘中阶段" };
  return { id: "close", label: "尾盘阶段" };
}

export function buildIntradayAnomalies(quotesInput, asOf, phase = "intraday") {
  if (!["intraday", "close", "previous-close"].includes(phase)) {
    throw new PulseError("SESSION_PHASE_INVALID", "anomaly board requires a valid session phase");
  }
  const quotes = (Array.isArray(quotesInput) ? quotesInput : []).filter((quote) =>
    /^(?:SH|SZ)\d{6}$/u.test(quote?.symbol) && quote?.name && !/(?:ST|退)/iu.test(quote.name) &&
    [quote.price, quote.open, quote.high, quote.low, quote.previousClose, quote.changePercent, quote.amount, quote.turnover]
      .every(Number.isFinite) && quote.price > 0 && quote.previousClose > 0 && quote.open > 0 && quote.low > 0 &&
    quote.high >= Math.max(quote.open, quote.price, quote.low) && quote.low <= Math.min(quote.open, quote.price) && quote.amount >= 100_000_000,
  );
  const marketMedian = medianNumber(quotes.map((quote) => quote.changePercent)) ?? 0;
  const session = anomalySession(asOf, phase);
  const candidates = [];
  for (const quote of quotes) {
    const gap = (quote.open / quote.previousClose - 1) * 100;
    const fromOpen = (quote.price / quote.open - 1) * 100;
    const amplitude = (quote.high / quote.low - 1) * 100;
    const range = Math.max(quote.high - quote.low, quote.price * 0.001);
    const closePosition = (quote.price - quote.low) / range;
    const relativeToMedian = quote.changePercent - marketMedian;
    const growth = ["star", "chinext"].includes(quote.board);
    const gapThreshold = growth ? 5 : 3;
    const moveThreshold = growth ? 5 : 3;
    const amplitudeThreshold = growth ? 12 : 8;
    const deviationThreshold = growth ? 8 : 5;
    const rules = [
      gap >= gapThreshold && { type: "gap-up", label: "高开偏离", direction: "up", severity: gap / gapThreshold, evidence: `高开 ${gap.toFixed(2)}%` },
      gap <= -gapThreshold && quote.changePercent >= 1 && { type: "opening-reversal", label: "低开修复", direction: "up", severity: Math.abs(gap) / gapThreshold + Math.max(0, quote.changePercent) / 5, evidence: `低开 ${gap.toFixed(2)}%，现涨 ${quote.changePercent.toFixed(2)}%` },
      fromOpen >= moveThreshold && closePosition >= 0.72 && { type: "intraday-surge", label: "盘中拉升", direction: "up", severity: fromOpen / moveThreshold, evidence: `较开盘拉升 ${fromOpen.toFixed(2)}%` },
      fromOpen <= -moveThreshold && closePosition <= 0.28 && { type: "intraday-dive", label: "盘中跳水", direction: "down", severity: Math.abs(fromOpen) / moveThreshold, evidence: `较开盘回落 ${Math.abs(fromOpen).toFixed(2)}%` },
      amplitude >= amplitudeThreshold && { type: "large-amplitude", label: "宽幅震荡", direction: closePosition >= 0.5 ? "up" : "down", severity: amplitude / amplitudeThreshold, evidence: `日内振幅 ${amplitude.toFixed(2)}%` },
      Math.abs(relativeToMedian) >= deviationThreshold && { type: "market-deviation", label: "相对偏离", direction: relativeToMedian > 0 ? "up" : "down", severity: Math.abs(relativeToMedian) / deviationThreshold, evidence: `较全市场中位偏离 ${relativeToMedian > 0 ? "+" : ""}${relativeToMedian.toFixed(2)}%` },
    ].filter(Boolean).sort((left, right) => right.severity - left.severity);
    const primary = rules[0];
    if (!primary) continue;
    const candidate = {
      symbol: quote.symbol,
      name: quote.name,
      board: quote.board,
      price: quote.price,
      changePercent: quote.changePercent,
      amount: quote.amount,
      turnover: quote.turnover,
      sessionId: session.id,
      sessionLabel: session.label,
      type: primary.type,
      typeLabel: primary.label,
      direction: primary.direction,
      severity: Math.round(primary.severity * 100) / 100,
      reason: `${session.label} · ${primary.evidence} · 成交 ${Math.round(quote.amount / 100_000_000)} 亿`,
      risk: phase === "intraday" ? "仅由当前快照的开高低现价计算，不代表连续分时趋势；收盘后需复核。" : "仅为全日价格偏离分类，需结合公告、流动性与次日承接复核。",
      metrics: {
        gap: Math.round(gap * 100) / 100,
        fromOpen: Math.round(fromOpen * 100) / 100,
        amplitude: Math.round(amplitude * 100) / 100,
        relativeToMedian: Math.round(relativeToMedian * 100) / 100,
      },
    };
    try {
      liveQuoteNumber(candidate.changePercent, "changePercent");
      liveQuoteNumber(candidate.severity, "severity");
      for (const [field, value] of Object.entries(candidate.metrics)) liveQuoteNumber(value, field);
      candidates.push(candidate);
    } catch {
      // Invalid optional anomalies cannot invalidate the all-market snapshot.
    }
  }
  const items = candidates.sort((left, right) =>
    right.severity - left.severity || right.amount - left.amount || left.symbol.localeCompare(right.symbol),
  ).slice(0, 10);
  const counts = Object.fromEntries([...new Set(items.map((item) => item.type))].map((type) => [type, items.filter((item) => item.type === type).length]));
  return Object.freeze({
    version: 1,
    sessionId: session.id,
    sessionLabel: session.label,
    marketMedian: Math.round(marketMedian * 100) / 100,
    items: Object.freeze(items.map((item) => Object.freeze(item))),
    counts: Object.freeze(counts),
    methodology: "按当前行情快照的昨收、开盘、最高、最低、现价和全市场涨跌幅中位数分型；没有分时序列时不声称识别瞬时拉升。",
  });
}

function settledValue(result, fallback) {
  return result.status === "fulfilled" ? result.value : fallback;
}

function settledError(result) {
  return result.status === "rejected"
    ? { errorCode: result.reason?.code ?? "SOURCE_ERROR", message: result.reason instanceof Error ? result.reason.message : "source failed" }
    : null;
}

export async function writeReportCreateOnly(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if (error?.code === "EEXIST") {
      throw new PulseError("OUTPUT_EXISTS", `refusing to replace existing report: ${path}`);
    }
    throw error;
  }
  await unlink(temporary).catch(() => undefined);
}

export async function runCli(argv = process.argv.slice(2), nowInput = new Date()) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write([
      "Usage: node build-market-pulse.mjs [--out data/market-insights/<STAMP>-market-overview.json] [options]",
      "",
      "  --out <path>  explicit strict report path; defaults to the current UTC stamp",
      "  --dry-run     fetch and calculate without writing",
      "  --stdout      emit a validated live snapshot as JSON without writing",
      "  --persist-local  retain latest and daily live snapshots below the process working directory",
      "  --persist-panel-data  retain daily snapshots in CodeShell's private Quant Lab data directory",
      "  --read-local     emit the latest retained live snapshot without network access",
    ].join("\n") + "\n");
    return { ok: true, help: true };
  }
  if (options.readLocal) {
    if (!options.stdout) throw new PulseError("STDOUT_REQUIRED", "--read-local requires --stdout");
    const snapshot = await readLocalSnapshot({
      root: options.persistPanelData ? defaultPanelDataRoot() : process.cwd(),
      stream: "live-market",
      scope: "global",
    });
    process.stdout.write(`${JSON.stringify(snapshot)}\n`);
    return snapshot;
  }
  const now = new Date(nowInput);
  if (!Number.isFinite(now.getTime())) throw new PulseError("NOW_INVALID", "valid current time required");
  const output = options.out || `data/market-insights/${filenameStamp(now)}-market-overview.json`;
  const outputPath = validateMarketPulseOutputPath(output);
  const startedAt = Date.now();
  const persistPanelData = options.persistPanelData || (
    isInstalledPanelTool() && !options.stdout && !options.dryRun && !options.readLocal
  );
  const marketHistory = persistPanelData
    ? await readLocalSnapshotHistory({
      root: defaultPanelDataRoot(),
      stream: "a-share-realtime",
      scope: "global",
      limit: 60,
    }).catch(() => [])
    : [];
  const [marketTimestamp, quotes] = await Promise.all([fetchMarketTimestamp(), fetchAllQuotes({
    root: persistPanelData || options.persistPanelData ? defaultPanelDataRoot() : process.cwd(),
    // Re-enumerate periodically so cached identities do not permanently omit
    // new listings; other refreshes reuse the known universe for batch quotes.
    preferLocalUniverse: now.getUTCMinutes() % 30 >= 3,
  })]);
  const [indexQuoteResult, industryResult, historyResult, newsResult, dragonTigerResult] = await Promise.allSettled([
    fetchIndexQuotes(),
    fetchIndustries(),
    fetchIndexHistories(),
    fetchMarketNews(now),
    fetchDragonTiger(),
  ]);
  const indexQuotes = settledValue(indexQuoteResult, new Map());
  for (const quote of indexQuotes.values()) {
    if (quote.marketDate !== marketTimestamp.marketDate) {
      throw new PulseError("MARKET_DATE_MISMATCH", `index date ${quote.marketDate} differs from market date ${marketTimestamp.marketDate}`);
    }
  }
  const industries = settledValue(industryResult, []);
  const historyOutcome = settledValue(historyResult, { histories: new Map(), failures: [] });
  const news = settledValue(newsResult, []);
  const dragonTiger = settledValue(dragonTigerResult, { marketDate: null, entries: [] });
  const clock = chinaClock(now);
  const provisional = clock.date === marketTimestamp.marketDate && clock.minutes < 15 * 60 + 10;
  const previousClose = clock.date !== marketTimestamp.marketDate;
  const report = buildMarketPulseReport({
    quotes,
    industries,
    indexQuotes,
    indexHistories: historyOutcome.histories,
    news,
    marketDate: marketTimestamp.marketDate,
    asOf: marketTimestamp.asOf,
    generatedAt: now.toISOString(),
    provisional,
    previousClose,
    marketHistory,
    sourceStatus: {
      indexQuotes: indexQuoteResult.status === "fulfilled",
      industries: industryResult.status === "fulfilled",
      news: newsResult.status === "fulfilled",
    },
  });
  if (!options.dryRun && !options.stdout) {
    await writeReportCreateOnly(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  const sourceErrors = {
    indexQuotes: settledError(indexQuoteResult),
    industries: settledError(industryResult),
    news: settledError(newsResult),
    dragonTiger: settledError(dragonTigerResult),
  };
  let dailyArchiveSaved = false;
  if (options.stdout || persistPanelData) {
    const breadth = calculateMarketBreadth(quotes);
    const phase = provisional ? "intraday" : previousClose ? "previous-close" : "close";
    const quoteLists = buildLiveQuoteLists(quotes, phase);
    const anomalyBoard = buildIntradayAnomalies(quotes, marketTimestamp.asOf, phase);
    const selectedIndustries = [...industries.slice(0, 3), ...industries.slice(-2)].filter(
      (industry, index, values) => values.findIndex((item) => item.id === industry.id) === index,
    );
    const snapshot = {
      schemaVersion: 1,
      kind: "live-market-snapshot",
      marketDate: report.marketDate,
      asOf: report.asOf,
      generatedAt: report.generatedAt,
      session: {
        phase,
        provisional,
        previousClose,
      },
      breadth,
      marketEnvironment: report.environment,
      indexes: MARKET_PULSE_INDEXES.flatMap((spec) => {
        const quote = indexQuotes.get(spec.symbol);
        if (!quote) return [];
        return [{
          symbol: spec.displaySymbol,
          name: spec.name,
          price: quote.price,
          changePercent: quote.changePercent,
          amount: quote.amount,
          asOf: quote.asOf,
        }];
      }),
      sectors: selectedIndustries.map((industry, index) => ({
        id: industry.id,
        name: industry.name,
        changePercent: industry.changePercent,
        amount: industry.amount,
        leaderSymbol: industry.leaderSymbol,
        leaderName: industry.leaderName,
        leaderChangePercent: industry.leaderChangePercent,
        direction: index < Math.min(3, industries.length) ? "leading" : "lagging",
      })),
      rankings: {
        gainers: quoteLists.gainers,
        losers: quoteLists.losers,
        active: quoteLists.active,
      },
      attention: quoteLists.attention,
      anomalyBoard,
      dragonTiger,
      headlines: selectMarketHeadlines(news).map((item) => ({
        id: item.id,
        title: item.title,
        publishedAt: item.publishedAt,
        url: item.url,
        source: item.source,
        sourceLabel: item.sourceLabel,
        sourceCount: item.sourceCount ?? 1,
        official: item.official === true,
      })),
      sourceStatus: {
        breadth: true,
        indexQuotes: indexQuoteResult.status === "fulfilled",
        industries: industryResult.status === "fulfilled",
        indexHistory: historyResult.status === "fulfilled" && historyOutcome.failures.length === 0,
        news: newsResult.status === "fulfilled",
        dragonTiger: dragonTigerResult.status === "fulfilled",
      },
      sourceErrors,
      historyFailures: historyOutcome.failures,
      elapsedMs: Date.now() - startedAt,
      report,
    };
    if (options.persistLocal || persistPanelData) {
      const snapshotRoot = persistPanelData ? defaultPanelDataRoot() : process.cwd();
      await mkdir(snapshotRoot, { recursive: true, mode: 0o700 });
      const dailyRealtimeSnapshot = buildDailyRealtimeSnapshot({
        quotes,
        marketDate: report.marketDate,
        asOf: report.asOf,
        generatedAt: report.generatedAt,
        session: snapshot.session,
      });
      // Commit the complete-universe archive first. The compact live-market
      // snapshot remains the advertised latest view only after both writes
      // succeed, so readers never mistake a partial archive for a saved day.
      await writeLocalSnapshot({
        root: snapshotRoot,
        stream: "a-share-realtime",
        scope: "global",
        snapshot: dailyRealtimeSnapshot,
      });
      await writeLocalSnapshot({
        root: snapshotRoot,
        stream: "live-market",
        scope: "global",
        snapshot,
      });
      dailyArchiveSaved = true;
    }
    if (options.stdout) {
      process.stdout.write(`${JSON.stringify(snapshot)}\n`);
      return snapshot;
    }
  }
  const summary = {
    ok: true,
    dryRun: options.dryRun,
    output,
    marketDate: report.marketDate,
    asOf: report.asOf,
    provisional,
    previousClose,
    status: report.status,
    universe: quotes.length,
    industries: industries.length,
    indexTrends: report.items.filter((item) => item.symbol.startsWith("指数 ")).length,
    news: news.length,
    dragonTiger: dragonTiger.entries.length,
    sourceErrors,
    historyFailures: historyOutcome.failures,
    elapsedMs: Date.now() - startedAt,
    dailyArchiveSaved,
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  return summary;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      errorCode: error?.code ?? error?.cause?.code ?? "MARKET_PULSE_ERROR",
      message: error instanceof Error ? error.message : "market pulse failed",
    })}\n`);
    process.exitCode = 1;
  });
}
