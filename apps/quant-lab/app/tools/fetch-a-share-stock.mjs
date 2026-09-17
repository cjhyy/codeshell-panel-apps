#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAShareStockDetailSnapshot,
  parseEastmoneyFinancials,
  parseTencentStockQuote,
  resolveTencentStockSuggestion,
} from "../a-share-stock-detail.mjs";
import { parseEastmoneyAnnouncements } from "../a-share-selection.mjs";
import { fetchMarketNews } from "./build-market-pulse.mjs";
import { readUsableHistory } from "./a-share-history-cache.mjs";
import { readLocalSnapshot, writeLocalSnapshot } from "./local-snapshot-store.mjs";
import { chinaClock, fetchHistorySeries, readLimitedResponseText } from "./screen-a-shares.mjs";

const TENCENT_QUOTE_ORIGIN = "https://qt.gtimg.cn";
const TENCENT_SEARCH_ORIGIN = "https://smartbox.gtimg.cn";
const EASTMONEY_ANNOUNCEMENT_ORIGIN = "https://np-anotice-stock.eastmoney.com";
const EASTMONEY_DATA_ORIGIN = "https://datacenter.eastmoney.com";
const USER_AGENT = "QuantLab/0.17 deterministic A-share stock detail";
const TIMEOUT_MS = 20_000;
const MAX_QUOTE_BYTES = 128_000;

class StockDetailFetchError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    Object.assign(this, details);
  }
}

function cleanText(value, maximum = 240) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
}

function canonicalSymbol(value) {
  const input = cleanText(value, 80).toUpperCase();
  const match = /(?:(SH|SZ)\s*)?(\d{6})/u.exec(input);
  if (!match) return null;
  const inferred = /^[69]/u.test(match[2]) ? "SH" : /^[023]/u.test(match[2]) ? "SZ" : null;
  if (!inferred || (match[1] && match[1] !== inferred)) return null;
  return `${inferred}${match[2]}`;
}

function parseArgs(argv) {
  const options = { query: "", stdout: false, persistLocal: false, readLocal: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--query" || argument === "--symbol") options.query = cleanText(argv[++index], 80);
    else if (argument === "--stdout") options.stdout = true;
    else if (argument === "--persist-local") options.persistLocal = true;
    else if (argument === "--read-local") options.readLocal = true;
    else if (argument === "--help") options.help = true;
    else throw new StockDetailFetchError("ARGUMENT_UNKNOWN", `unknown argument: ${argument}`);
  }
  if (!options.help && !options.query) throw new StockDetailFetchError("QUERY_REQUIRED", "--query is required");
  return options;
}

async function fetchBoundedText(url, expectedOrigin, encoding, headers = {}) {
  const parsed = new URL(url);
  if (parsed.origin !== expectedOrigin || parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new StockDetailFetchError("SOURCE_URL_UNSAFE", `unexpected source origin: ${parsed.origin}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(parsed, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/plain,application/json,*/*", ...headers },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new StockDetailFetchError("SOURCE_HTTP", `HTTP ${response.status} from ${parsed.hostname}`, { status: response.status });
    }
    if (new URL(response.url).origin !== expectedOrigin) {
      throw new StockDetailFetchError("SOURCE_REDIRECT", `source escaped allowlist: ${response.url}`);
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_QUOTE_BYTES) {
      throw new StockDetailFetchError("SOURCE_TOO_LARGE", `response exceeds ${MAX_QUOTE_BYTES} bytes`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_QUOTE_BYTES) {
      throw new StockDetailFetchError("SOURCE_TOO_LARGE", `response exceeds ${MAX_QUOTE_BYTES} bytes`);
    }
    return new TextDecoder(encoding).decode(bytes);
  } catch (error) {
    if (error?.name === "AbortError") throw new StockDetailFetchError("SOURCE_TIMEOUT", `timeout from ${parsed.hostname}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function stockSuggestionUrl(query) {
  const url = new URL("/s3/", TENCENT_SEARCH_ORIGIN);
  url.searchParams.set("q", cleanText(query, 80));
  url.searchParams.set("t", "all");
  return url;
}

export function stockQuoteUrl(symbol) {
  if (!/^(?:SH|SZ)\d{6}$/u.test(symbol)) throw new StockDetailFetchError("SYMBOL_INVALID", "A-share symbol is invalid");
  const url = new URL("/", TENCENT_QUOTE_ORIGIN);
  url.searchParams.set("q", symbol.toLowerCase());
  return url;
}

export function stockAnnouncementUrl(symbol) {
  if (!/^(?:SH|SZ)\d{6}$/u.test(symbol)) throw new StockDetailFetchError("SYMBOL_INVALID", "A-share symbol is invalid");
  const url = new URL("/api/security/ann", EASTMONEY_ANNOUNCEMENT_ORIGIN);
  for (const [key, value] of Object.entries({
    sr: "-1",
    page_size: "8",
    page_index: "1",
    ann_type: "A",
    client_source: "web",
    stock_list: symbol.slice(2),
  })) url.searchParams.set(key, value);
  return url;
}

export function stockFinancialsUrl(symbol) {
  if (!/^(?:SH|SZ)\d{6}$/u.test(symbol)) throw new StockDetailFetchError("SYMBOL_INVALID", "A-share symbol is invalid");
  const url = new URL("/securities/api/data/get", EASTMONEY_DATA_ORIGIN);
  const secucode = `${symbol.slice(2)}.${symbol.slice(0, 2)}`;
  for (const [key, value] of Object.entries({
    type: "RPT_F10_FINANCE_MAINFINADATA",
    sty: "APP_F10_MAINFINADATA",
    filter: `(SECUCODE=\"${secucode}\")`,
    p: "1",
    ps: "8",
    sr: "-1",
    st: "REPORT_DATE",
    source: "HSF10",
    client: "PC",
  })) url.searchParams.set(key, value);
  return url;
}

async function resolveQuery(query) {
  const symbol = canonicalSymbol(query);
  if (symbol) return symbol;
  const response = await fetchBoundedText(
    stockSuggestionUrl(query),
    TENCENT_SEARCH_ORIGIN,
    "utf-8",
    { Referer: "https://stockapp.finance.qq.com/" },
  );
  return resolveTencentStockSuggestion(response, query).symbol;
}

export async function fetchTencentStockQuote(symbol, options = {}) {
  const attempts = Number.isInteger(options.attempts) ? Math.min(3, Math.max(1, options.attempts)) : 3;
  const requestText = options.fetchText ?? ((url) => fetchBoundedText(
    url,
    TENCENT_QUOTE_ORIGIN,
    "gbk",
    { Referer: "https://finance.qq.com/", "Cache-Control": "no-cache" },
  ));
  const wait = options.wait ?? ((milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)));
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await requestText(stockQuoteUrl(symbol));
    try {
      const quote = parseTencentStockQuote(response);
      if (quote.symbol !== symbol) {
        throw new StockDetailFetchError("QUOTE_SYMBOL_CONFLICT", "行情代码与搜索结果不一致");
      }
      return quote;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await wait(250 * (attempt + 1));
    }
  }
  throw new StockDetailFetchError(
    "QUOTE_FIELDS_TRANSIENT",
    `腾讯实时行情连续 ${attempts} 次未通过完整性校验，请稍后重试`,
    { causeCode: lastError?.code ?? "QUOTE_FIELDS_INVALID" },
  );
}

async function fetchAnnouncements(symbol, now) {
  const url = stockAnnouncementUrl(symbol);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json,text/plain,*/*", Referer: "https://data.eastmoney.com/" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new StockDetailFetchError("ANNOUNCEMENT_HTTP", `HTTP ${response.status} from ${url.hostname}`);
    if (new URL(response.url).origin !== EASTMONEY_ANNOUNCEMENT_ORIGIN) {
      throw new StockDetailFetchError("ANNOUNCEMENT_REDIRECT", `announcement source escaped allowlist: ${response.url}`);
    }
    const text = await readLimitedResponseText(response, 1_000_000);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new StockDetailFetchError("ANNOUNCEMENT_SHAPE", `non-JSON announcement response for ${symbol}`);
    }
    return parseEastmoneyAnnouncements(payload, symbol, now.toISOString());
  } catch (error) {
    if (error?.name === "AbortError") throw new StockDetailFetchError("ANNOUNCEMENT_TIMEOUT", `announcement timeout for ${symbol}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFinancials(symbol, now) {
  const response = await fetchBoundedText(
    stockFinancialsUrl(symbol),
    EASTMONEY_DATA_ORIGIN,
    "utf-8",
    { Referer: `https://data.eastmoney.com/stockdata/${symbol.slice(2)}.html` },
  );
  let payload;
  try {
    payload = JSON.parse(response);
  } catch {
    throw new StockDetailFetchError("FINANCIALS_SHAPE", `non-JSON financial response for ${symbol}`);
  }
  return parseEastmoneyFinancials(payload, symbol, now);
}

function stockNews(quote, news) {
  const code = quote.symbol.slice(2);
  return (Array.isArray(news) ? news : [])
    .filter((item) => `${item?.title ?? ""} ${item?.summary ?? ""}`.includes(quote.name) || `${item?.title ?? ""}`.includes(code))
    .map((item) => ({
      id: cleanText(item.id, 100),
      kind: "news",
      label: cleanText(`${item.sourceCount > 1 ? `多源新闻 ${item.sourceCount}` : "个股新闻"} · ${item.sourceLabel ?? "财经资讯"}`, 40),
      title: cleanText(item.title, 240),
      publishedAt: item.publishedAt,
      url: item.url,
      importance: "context",
    }));
}

function sourceError(source, error) {
  return Object.freeze({
    source,
    errorCode: cleanText(error?.code ?? "SOURCE_ERROR", 80),
    message: cleanText(error instanceof Error ? error.message : "source failed", 240),
  });
}

export async function buildStockDetailSnapshot(query, nowInput = new Date()) {
  const now = new Date(nowInput);
  if (!Number.isFinite(now.getTime())) throw new StockDetailFetchError("NOW_INVALID", "valid current time required");
  const symbol = await resolveQuery(query);
  const quote = await fetchTencentStockQuote(symbol);
  const cachedHistory = await readUsableHistory(symbol, quote.marketDate, {
    minimumBars: 60,
    maximumAgeDays: 10,
    limit: 180,
  }).catch(() => null);
  const [historyResult, announcementResult, newsResult, financialsResult] = await Promise.allSettled([
    cachedHistory
      ? { bars: cachedHistory.bars, adjust: "qfq" }
      : fetchHistorySeries(symbol, quote.marketDate, {
        minimumBars: 1,
        allowUnadjustedNewStock: true,
      }),
    fetchAnnouncements(symbol, now),
    fetchMarketNews(now),
    fetchFinancials(symbol, now),
  ]);
  const sourceErrors = [];
  if (historyResult.status === "rejected") sourceErrors.push(sourceError("history", historyResult.reason));
  if (announcementResult.status === "rejected") sourceErrors.push(sourceError("announcements", announcementResult.reason));
  if (newsResult.status === "rejected") sourceErrors.push(sourceError("news", newsResult.reason));
  if (financialsResult.status === "rejected") sourceErrors.push(sourceError("financials", financialsResult.reason));
  const clock = chinaClock(now);
  const provisional = clock.date === quote.marketDate && clock.minutes < 15 * 60 + 10;
  const previousClose = clock.date !== quote.marketDate;
  const news = newsResult.status === "fulfilled" ? stockNews(quote, newsResult.value) : [];
  return buildAShareStockDetailSnapshot({
    quote,
    bars: historyResult.status === "fulfilled" ? historyResult.value.bars : [],
    historyAdjust: historyResult.status === "fulfilled" ? historyResult.value.adjust : null,
    events: [
      ...(announcementResult.status === "fulfilled" ? announcementResult.value : []),
      ...news,
    ],
    financials: financialsResult.status === "fulfilled" ? financialsResult.value : null,
    generatedAt: now.toISOString(),
    provisional,
    previousClose,
    sourceStatus: {
      history: historyResult.status === "fulfilled",
      announcements: announcementResult.status === "fulfilled",
      news: newsResult.status === "fulfilled",
      financials: financialsResult.status === "fulfilled",
    },
    sourceErrors,
  });
}

export async function runCli(argv = process.argv.slice(2), nowInput = new Date()) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write([
      "Usage: node fetch-a-share-stock.mjs --query <name-or-code> --stdout [--persist-local]",
      "",
      "  --query          A-share name, six-digit code, or SH/SZ symbol",
      "  --stdout         emit one validated stock detail snapshot as JSON",
      "  --persist-local  retain latest and daily snapshots in the Panel App data directory",
      "  --read-local     read a retained snapshot; query must contain a stock code",
    ].join("\n") + "\n");
    return { ok: true, help: true };
  }
  if (!options.stdout) throw new StockDetailFetchError("STDOUT_REQUIRED", "--stdout is required");
  if (options.readLocal) {
    const symbol = canonicalSymbol(options.query);
    if (!symbol) throw new StockDetailFetchError("READ_SYMBOL_REQUIRED", "reading local stock data requires a stock code");
    const snapshot = await readLocalSnapshot({ stream: "a-share-stock", scope: symbol });
    process.stdout.write(`${JSON.stringify(snapshot)}\n`);
    return snapshot;
  }
  const snapshot = await buildStockDetailSnapshot(options.query, nowInput);
  if (options.persistLocal) {
    await writeLocalSnapshot({ stream: "a-share-stock", scope: snapshot.stock.symbol, snapshot });
  }
  process.stdout.write(`${JSON.stringify(snapshot)}\n`);
  return snapshot;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      errorCode: error?.code ?? "STOCK_DETAIL_ERROR",
      message: error instanceof Error ? error.message : "stock detail failed",
    })}\n`);
    process.exitCode = 1;
  });
}
