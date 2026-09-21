#!/usr/bin/env node
// Deterministic A-share candidate scan. Zero dependencies.
//
// Stage 1 reads the current Shanghai/Shenzhen quote universe and applies fixed
// risk/liquidity gates. Stage 2 fetches 120+ qfq daily bars for the bounded
// history shortlist, computes the frozen cn-trend-volume-v1 evidence, and
// writes one strict market-insight report for the panel to load.

import { open, mkdir, link, readFile, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseTencentStockQuote } from "../a-share-stock-detail.mjs";
import { SELECTION_SCAN_LIMITS } from "../selection-scan-contract.mjs";
import {
  STOCK_SCREEN_PROFILE,
  buildStockScreenReport,
  normalizeStockQuote,
  prepareHistoryUniverse,
} from "../stock-screener.mjs";

const SINA_ORIGIN = "https://vip.stock.finance.sina.com.cn";
const TENCENT_QUOTE_ORIGIN = "https://qt.gtimg.cn";
const TENCENT_HISTORY_ORIGIN = "https://proxy.finance.qq.com";
const EASTMONEY_QUOTE_ORIGIN = "https://push2.eastmoney.com";
const USER_AGENT = "QuantLab/0.8 deterministic A-share screener";
const PAGE_SIZE = 100;
const PAGE_CONCURRENCY = 8;
const TENCENT_QUOTE_BATCH_SIZE = 150;
const TENCENT_QUOTE_CONCURRENCY = 4;
const HISTORY_CONCURRENCY = 1;
const HISTORY_REQUEST_INTERVAL_MS = 400;
const TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 2_000_000;

class ScreenFetchError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    Object.assign(this, details);
  }
}

function parseInteger(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new ScreenFetchError("ARGUMENT_INVALID", `${label} must be ${minimum}..${maximum}`);
  }
  return number;
}

function parseArgs(argv) {
  const options = { out: "", top: 10, historyLimit: 120, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--out") options.out = argv[++index] ?? "";
    else if (argument === "--top") options.top = parseInteger(argv[++index], "--top", 3, 10);
    else if (argument === "--history-limit") {
      options.historyLimit = parseInteger(argv[++index], "--history-limit", 20, 300);
    } else if (argument === "--help") options.help = true;
    else throw new ScreenFetchError("ARGUMENT_UNKNOWN", `unknown argument: ${argument}`);
  }
  return options;
}

export function validateStockScreenOutputPath(path) {
  if (!/^data\/market-insights\/\d{8}T\d{9}Z-candidates\.json$/u.test(path)) {
    throw new ScreenFetchError("OUTPUT_PATH_UNSAFE", `unsafe stock-screen output path: ${path}`);
  }
  return resolve(process.cwd(), path);
}

async function fetchText(url, expectedOrigin, headers = {}, encoding = "utf-8") {
  const parsed = new URL(url);
  if (parsed.origin !== expectedOrigin || parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new ScreenFetchError("SOURCE_URL_UNSAFE", `unexpected source origin: ${parsed.origin}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(parsed, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json,text/plain,*/*", ...headers },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ScreenFetchError(
        "SOURCE_HTTP",
        `HTTP ${response.status} from ${parsed.hostname}`,
        { status: response.status },
      );
    }
    if (new URL(response.url).origin !== expectedOrigin) {
      throw new ScreenFetchError("SOURCE_REDIRECT", `source escaped allowlist: ${response.url}`);
    }
    return await readLimitedResponseText(response, MAX_RESPONSE_BYTES, encoding);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ScreenFetchError("SOURCE_TIMEOUT", `timeout from ${parsed.hostname}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function readLimitedResponseText(response, maximumBytes = MAX_RESPONSE_BYTES, encoding = "utf-8") {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new ScreenFetchError("SOURCE_TOO_LARGE", `response exceeds ${maximumBytes} bytes`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new ScreenFetchError("SOURCE_TOO_LARGE", `response exceeds ${maximumBytes} bytes`);
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
  return new TextDecoder(encoding).decode(bytes);
}

async function fetchJson(url, expectedOrigin, headers = {}) {
  const text = await fetchText(url, expectedOrigin, headers);
  try {
    return JSON.parse(text);
  } catch {
    throw new ScreenFetchError("SOURCE_SHAPE", `non-JSON response from ${new URL(url).hostname}`);
  }
}

export async function withRetry(operation, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      // Access/rate restrictions need a cooldown or a different source, not an
      // immediate repeat of every request in an eight-page batch.
      if ([403, 429, 456].includes(Number(error?.status))) throw error;
      if (attempt + 1 < attempts) {
        const throttled = [429, 501, 503].includes(Number(error?.status));
        await new Promise((resolveDelay) => setTimeout(
          resolveDelay,
          (throttled ? 3_000 : 500) * (attempt + 1),
        ));
      }
    }
  }
  throw lastError;
}

function quotePageUrl(page, options = {}) {
  const node = options.node ?? "hs_a";
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const sort = options.sort ?? "symbol";
  const asc = options.asc ?? "1";
  const url = new URL("/quotes_service/api/json_v2.php/Market_Center.getHQNodeData", SINA_ORIGIN);
  for (const [key, value] of Object.entries({
    page: String(page),
    num: String(pageSize),
    sort,
    asc,
    node,
    symbol: "",
    _s_r_a: "page",
  })) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function fetchQuotePage(page) {
  const payload = await withRetry(() =>
    fetchJson(quotePageUrl(page), SINA_ORIGIN, { Referer: "https://finance.sina.com.cn/" }),
  );
  if (!Array.isArray(payload)) {
    throw new ScreenFetchError("QUOTE_PAGE_SHAPE", `quote page ${page} was not an array`);
  }
  return payload;
}

export async function fetchQuotesForNode(node, options = {}) {
  if (!/^new_[A-Za-z0-9]+$/u.test(node)) {
    throw new ScreenFetchError("QUOTE_NODE_INVALID", `invalid Sina industry node: ${node}`);
  }
  const limit = Number.isInteger(options.limit) ? Math.min(100, Math.max(5, options.limit)) : 40;
  const payload = await withRetry(() =>
    fetchJson(
      quotePageUrl(1, { node, pageSize: limit, sort: "amount", asc: "0" }),
      SINA_ORIGIN,
      { Referer: "https://finance.sina.com.cn/" },
    ),
  );
  if (!Array.isArray(payload)) {
    throw new ScreenFetchError("QUOTE_NODE_SHAPE", `industry node ${node} was not an array`);
  }
  const quotes = new Map();
  for (const row of payload) {
    const quote = normalizeStockQuote(row);
    if (quote) quotes.set(quote.symbol, quote);
  }
  if (quotes.size < Math.min(3, payload.length)) {
    throw new ScreenFetchError(
      "QUOTE_NODE_COVERAGE_LOW",
      `industry node ${node} only produced ${quotes.size}/${payload.length} valid quotes`,
    );
  }
  return [...quotes.values()].sort(
    (left, right) => right.amount - left.amount || left.symbol.localeCompare(right.symbol),
  );
}

// Full constituent identity is separate from the legacy top-by-turnover query.
// The caller can persist each successful page and resume after a soft deadline.
export async function fetchAllQuotesForNode(node, options = {}) {
  if (!/^new_[A-Za-z0-9]+$/u.test(node)) {
    throw new ScreenFetchError("QUOTE_NODE_INVALID", `invalid Sina industry node: ${node}`);
  }
  const expectedCount = options.expectedCount;
  if (!Number.isInteger(expectedCount) || expectedCount < 0 || expectedCount > SELECTION_SCAN_LIMITS.membersPerSector) {
    throw new ScreenFetchError("QUOTE_NODE_COUNT_INVALID", "industry member count exceeds the supported bound");
  }
  const symbols = new Set(options.resume?.symbols ?? []);
  if ([...symbols].some((symbol) => !/^(?:SH|SZ)\d{6}$/u.test(symbol)) || symbols.size > SELECTION_SCAN_LIMITS.membersPerSector) {
    throw new ScreenFetchError("QUOTE_NODE_RESUME_INVALID", "industry resume identity is invalid");
  }
  const quotes = new Map();
  let nextPage = options.resume?.nextPage ?? 1;
  const lastPage = Math.floor(SELECTION_SCAN_LIMITS.membersPerSector / PAGE_SIZE) + 1;
  if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage > lastPage) {
    throw new ScreenFetchError("QUOTE_NODE_RESUME_INVALID", "industry resume page is invalid");
  }
  const fetchPage = options.fetchPage ?? ((page, pageOptions) => fetchJson(
    quotePageUrl(page, pageOptions), SINA_ORIGIN, { Referer: "https://finance.sina.com.cn/" },
  ));
  const snapshot = (complete, reason = null) => ({
    symbols: [...symbols].sort(), quotes: [...quotes.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)),
    memberCount: symbols.size, expectedCount, nextPage, complete, reason,
  });
  while (nextPage <= lastPage) {
    if (options.shouldStart && !options.shouldStart()) return snapshot(false, "SCAN_TIME_BUDGET");
    const pageStarted = nextPage;
    const previousSymbols = [...symbols];
    try {
      const payload = await fetchPage(nextPage, { node, pageSize: PAGE_SIZE, sort: "symbol", asc: "1" });
      if (!Array.isArray(payload) || payload.length > PAGE_SIZE) {
        throw new ScreenFetchError("QUOTE_NODE_PAGE_INVALID", `industry ${node} page ${nextPage} is invalid`);
      }
      const previousSize = symbols.size;
      for (const row of payload) {
        const symbol = String(row?.symbol ?? "").toUpperCase();
        if (!/^(?:SH|SZ)\d{6}$/u.test(symbol)) {
          throw new ScreenFetchError("QUOTE_NODE_SYMBOL_INVALID", `industry ${node} contains an invalid member identity`);
        }
        symbols.add(symbol);
        const quote = normalizeStockQuote(row);
        if (quote) quotes.set(quote.symbol, quote);
      }
      if (symbols.size > SELECTION_SCAN_LIMITS.membersPerSector) {
        throw new ScreenFetchError("QUOTE_NODE_TOO_LARGE", `industry ${node} exceeds the member bound`);
      }
      if (payload.length && symbols.size === previousSize) {
        throw new ScreenFetchError("QUOTE_NODE_PAGINATION_REPEAT", `industry ${node} repeated a constituent page`);
      }
      nextPage += 1;
      const ended = payload.length < PAGE_SIZE;
      if (ended && symbols.size < expectedCount) {
        throw new ScreenFetchError("QUOTE_NODE_MEMBERS_MISSING", `industry ${node} has ${symbols.size}/${expectedCount} constituent identities`);
      }
      if (!ended && nextPage > lastPage) {
        throw new ScreenFetchError("QUOTE_NODE_TOO_LARGE", `industry ${node} pagination did not terminate`);
      }
      const current = snapshot(ended);
      if (options.onPage) await options.onPage(current);
      if (ended) return current;
    } catch (error) {
      // Retain successfully observed identity without advertising completeness.
      error.partial = { ...snapshot(false, error?.code ?? "QUOTE_NODE_PAGE_FAILED"),
        symbols: previousSymbols, memberCount: previousSymbols.length, nextPage: pageStarted };
      throw error;
    }
  }
  throw new ScreenFetchError("QUOTE_NODE_TOO_LARGE", `industry ${node} pagination did not terminate`);
}

async function fetchAllSinaQuotes() {
  const rows = [];
  let ended = false;
  for (let start = 1; start <= 80 && !ended; start += PAGE_CONCURRENCY) {
    const pages = await Promise.all(
      Array.from({ length: PAGE_CONCURRENCY }, (_value, index) => fetchQuotePage(start + index)),
    );
    for (const page of pages) rows.push(...page);
    const firstShort = pages.findIndex((page) => page.length < PAGE_SIZE);
    if (firstShort >= 0) {
      if (pages.slice(firstShort + 1).some((page) => page.length > 0)) {
        throw new ScreenFetchError(
          "QUOTE_PAGINATION_GAP",
          `quote page ${start + firstShort} was short before a later non-empty page`,
        );
      }
      ended = true;
    }
  }
  const normalized = new Map();
  for (const row of rows) {
    const quote = normalizeStockQuote(row);
    if (quote) normalized.set(quote.symbol, quote);
  }
  if (normalized.size < 4_000) {
    throw new ScreenFetchError(
      "QUOTE_COVERAGE_LOW",
      `only ${normalized.size} valid Shanghai/Shenzhen quotes; refusing a partial universe`,
    );
  }
  if (normalized.size / Math.max(1, rows.length) < 0.85) {
    throw new ScreenFetchError(
      "QUOTE_SHAPE_DRIFT",
      `only ${normalized.size}/${rows.length} quote rows matched the Shanghai/Shenzhen contract`,
    );
  }
  return [...normalized.values()].sort((left, right) => left.symbol.localeCompare(right.symbol));
}

function canonicalQuoteSymbol(value) {
  const symbol = typeof value === "string" ? value.toUpperCase() : "";
  if (/^SH6\d{5}$/u.test(symbol) || /^SZ[03]\d{5}$/u.test(symbol)) return symbol;
  return null;
}

function scaledQuoteNumber(value, multiplier) {
  if (value === "" || value === "-" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number * multiplier : null;
}

export async function readLocalQuoteUniverse(root = process.cwd()) {
  const candidates = [
    {
      path: resolve(root, "snapshots", "a-share-realtime", "global", "latest.json"),
      symbols: (payload) => Array.isArray(payload?.quotes) ? payload.quotes.map((item) => item?.symbol) : [],
    },
    {
      path: resolve(root, "a-share-history", "v1", "manifest.json"),
      symbols: (payload) => Array.isArray(payload?.records) ? payload.records.map((item) => item?.symbol) : [],
    },
  ];
  for (const candidate of candidates) {
    try {
      const payload = JSON.parse(await readFile(candidate.path, "utf8"));
      const symbols = [...new Set(candidate.symbols(payload).map(canonicalQuoteSymbol).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
      if (symbols.length >= 4_000) return symbols;
    } catch {
      // Try the next locally validated universe before using an enumerating source.
    }
  }
  throw new ScreenFetchError(
    "QUOTE_UNIVERSE_MISSING",
    "no locally validated Shanghai/Shenzhen universe is available for quote fallback",
  );
}

export function tencentQuoteBatchUrl(symbolsInput) {
  const symbols = [...new Set((Array.isArray(symbolsInput) ? symbolsInput : [])
    .map(canonicalQuoteSymbol)
    .filter(Boolean))];
  if (symbols.length === 0 || symbols.length > TENCENT_QUOTE_BATCH_SIZE) {
    throw new ScreenFetchError("QUOTE_BATCH_INVALID", `Tencent quote batch must contain 1..${TENCENT_QUOTE_BATCH_SIZE} symbols`);
  }
  const url = new URL("/", TENCENT_QUOTE_ORIGIN);
  url.searchParams.set("q", symbols.map((symbol) => symbol.toLowerCase()).join(","));
  return url;
}

export function parseTencentQuoteBatch(textInput) {
  const quotes = new Map();
  const matches = String(textInput ?? "").matchAll(/v_(?:sh|sz)\d{6}="[^"]*"/gu);
  for (const match of matches) {
    try {
      const quote = parseTencentStockQuote(match[0]);
      if (!Number.isFinite(quote.floatMarketCap) || quote.floatMarketCap < 0) continue;
      quotes.set(quote.symbol, quote);
    } catch {
      // Suspended, delisted or structurally incomplete rows are excluded by the coverage gate below.
    }
  }
  return [...quotes.values()].sort((left, right) => left.symbol.localeCompare(right.symbol));
}

async function fetchTencentQuoteBatch(symbols) {
  const text = await withRetry(() => fetchText(
    tencentQuoteBatchUrl(symbols),
    TENCENT_QUOTE_ORIGIN,
    { Referer: "https://finance.qq.com/" },
    "gbk",
  ));
  return parseTencentQuoteBatch(text);
}

export async function fetchAllTencentQuotes(options = {}) {
  const universe = Array.isArray(options.universe)
    ? [...new Set(options.universe.map(canonicalQuoteSymbol).filter(Boolean))]
    : await readLocalQuoteUniverse(options.root ?? process.cwd());
  if (universe.length < 4_000) {
    throw new ScreenFetchError("QUOTE_UNIVERSE_LOW", `local quote universe contains only ${universe.length} symbols`);
  }
  const batches = [];
  for (let start = 0; start < universe.length; start += TENCENT_QUOTE_BATCH_SIZE) {
    batches.push(universe.slice(start, start + TENCENT_QUOTE_BATCH_SIZE));
  }
  const outcomes = await mapWithConcurrency(
    batches,
    TENCENT_QUOTE_CONCURRENCY,
    (batch) => fetchTencentQuoteBatch(batch),
  );
  const quotes = new Map();
  for (const outcome of outcomes) {
    if (!outcome.ok) continue;
    for (const quote of outcome.value) quotes.set(quote.symbol, quote);
  }
  if (quotes.size < 4_000 || quotes.size / universe.length < 0.85) {
    throw new ScreenFetchError(
      "TENCENT_QUOTE_COVERAGE_LOW",
      `Tencent returned ${quotes.size}/${universe.length} valid Shanghai/Shenzhen quotes`,
    );
  }
  return [...quotes.values()].sort((left, right) => left.symbol.localeCompare(right.symbol));
}

function eastmoneyQuoteUrl() {
  const url = new URL("/api/qt/clist/get", EASTMONEY_QUOTE_ORIGIN);
  for (const [key, value] of Object.entries({
    pn: "1",
    pz: "6000",
    po: "1",
    np: "1",
    ut: "bd1d9ddb04089700cf9c27f6f7426281",
    fltt: "2",
    invt: "2",
    fid: "f3",
    fs: "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23",
    fields: "f12,f14,f2,f3,f5,f6,f8,f9,f15,f16,f17,f18,f20,f21,f23",
  })) url.searchParams.set(key, value);
  return url;
}

export function parseEastmoneyQuoteUniverse(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload?.data?.diff)) {
    throw new ScreenFetchError("EASTMONEY_QUOTE_SHAPE", "Eastmoney quote universe has an invalid shape");
  }
  const rows = payload.data.diff;
  const quotes = new Map();
  for (const item of rows) {
    const code = String(item?.f12 ?? "");
    const exchange = code.startsWith("6") ? "sh" : /^[03]/u.test(code) ? "sz" : "";
    const quote = normalizeStockQuote({
      symbol: `${exchange}${code}`,
      name: item?.f14,
      trade: item?.f2,
      changepercent: item?.f3,
      settlement: item?.f18,
      open: item?.f17,
      high: item?.f15,
      low: item?.f16,
      volume: scaledQuoteNumber(item?.f5, 100),
      amount: item?.f6,
      per: item?.f9,
      pb: item?.f23,
      mktcap: scaledQuoteNumber(item?.f20, 1 / 10_000),
      nmc: scaledQuoteNumber(item?.f21, 1 / 10_000),
      turnoverratio: item?.f8,
    });
    if (quote) quotes.set(quote.symbol, quote);
  }
  if (quotes.size < 4_000 || quotes.size / Math.max(1, rows.length) < 0.85) {
    throw new ScreenFetchError(
      "EASTMONEY_QUOTE_COVERAGE_LOW",
      `Eastmoney returned ${quotes.size}/${rows.length} valid Shanghai/Shenzhen quotes`,
    );
  }
  return [...quotes.values()].sort((left, right) => left.symbol.localeCompare(right.symbol));
}

async function fetchAllEastmoneyQuotes() {
  const payload = await withRetry(() => fetchJson(
    eastmoneyQuoteUrl(),
    EASTMONEY_QUOTE_ORIGIN,
    { Referer: "https://quote.eastmoney.com/center/gridlist.html" },
  ));
  return parseEastmoneyQuoteUniverse(payload);
}

export async function fetchAllQuotes(options = {}) {
  let localUniverse = options.universe;
  if (options.preferLocalUniverse && !localUniverse) {
    localUniverse = await readLocalQuoteUniverse(options.root ?? process.cwd()).catch(() => null);
  }
  const tencent = ["tencent", options.fetchTencentQuotes ?? (() => fetchAllTencentQuotes({ ...options, universe: localUniverse }))];
  const sina = ["sina", options.fetchSinaQuotes ?? fetchAllSinaQuotes];
  const sources = [
    ...(options.preferLocalUniverse && localUniverse ? [tencent, sina] : [sina, tencent]),
    ["eastmoney", options.fetchEastmoneyQuotes ?? fetchAllEastmoneyQuotes],
  ];
  const failures = [];
  for (const [source, fetchSource] of sources) {
    try {
      return await fetchSource();
    } catch (error) {
      failures.push({ source, code: error?.code ?? error?.cause?.code ?? "QUOTE_SOURCE_ERROR",
        status: error?.status ?? null, message: String(error?.message ?? "source failed").slice(0, 240) });
    }
  }
  const restricted = failures.some((failure) => [403, 429, 456].includes(failure.status));
  throw new ScreenFetchError(
    "QUOTE_SOURCES_UNAVAILABLE",
    `全市场行情源暂时不可用；已拒绝使用不完整数据，${restricted ? "数据源触发频率限制，请稍后再试" : "请稍后重试"}`,
    { failures: failures.map((failure) => failure.code), sourceFailures: failures },
  );
}

function parseMarketTimestamp(text) {
  const fields = /="([^"]*)"/u.exec(text)?.[1]?.split("~") ?? [];
  const timestamp = fields[30] ?? "";
  if (!/^\d{14}$/u.test(timestamp)) {
    throw new ScreenFetchError("MARKET_TIME_INVALID", "Tencent index quote has no market timestamp");
  }
  const marketDate = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
  const asOf = `${marketDate}T${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:${timestamp.slice(12, 14)}+08:00`;
  return { marketDate, asOf };
}

export function chinaClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

export async function fetchMarketTimestamp() {
  const response = await withRetry(() =>
    fetchText("https://qt.gtimg.cn/q=sh000001", TENCENT_QUOTE_ORIGIN, {
      Referer: "https://finance.qq.com/",
    }),
  );
  return parseMarketTimestamp(response);
}

function addDays(date, days) {
  const instant = new Date(`${date}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

export function historyUrl(symbol, marketDate, options = {}) {
  const code = symbol.toLowerCase();
  const url = new URL("/ifzqgtimg/appstock/app/newfqkline/get", TENCENT_HISTORY_ORIGIN);
  url.searchParams.set(
    "param",
    `${code},day,${addDays(marketDate, -430)},${options.includeLatest === true ? "" : marketDate},180,qfq`,
  );
  return url;
}

function historyBars(rows) {
  return rows.flatMap((row) => {
    if (!Array.isArray(row) || row.length < 6) return [];
    const [date, open, close, high, low, lots] = row;
    return [{
      date,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Math.round(Number(lots) * 100),
    }];
  });
}

function calendarSpanDays(firstDate, marketDate) {
  const first = Date.parse(`${firstDate}T00:00:00.000Z`);
  const last = Date.parse(`${marketDate}T00:00:00.000Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first > last) return Number.POSITIVE_INFINITY;
  return Math.round((last - first) / 86_400_000);
}

export function parseTencentHistoryPayload(payload, symbol, marketDate, options = {}) {
  const code = symbol.toLowerCase();
  const node = payload?.data?.[code];
  let adjust = "qfq";
  let rows = node?.qfqday;
  if (!Array.isArray(rows)) {
    if (options.allowUnadjustedNewStock === true && Array.isArray(node?.day)) {
      adjust = "none";
      rows = node.day;
    } else {
      throw new ScreenFetchError("HISTORY_SHAPE", `no qfq history for ${symbol}`);
    }
  }
  // Tencent's bounded-date response omits the current session; its latest
  // response includes it as an extra row. Live selection requests the latter,
  // but never admits dates after the requested market session or over 180 bars.
  const parsedBars = historyBars(rows);
  const bars = options.includeLatest === true
    ? parsedBars.filter((bar) => bar.date <= marketDate).slice(-180)
    : parsedBars;
  if (adjust === "none" && options.assetType !== "index") {
    const spanDays = calendarSpanDays(bars[0]?.date, marketDate);
    if (bars.length >= STOCK_SCREEN_PROFILE.minimumHistoryBars || spanDays > 120) {
      throw new ScreenFetchError(
        "HISTORY_BASIS",
        `refusing unadjusted history fallback for established stock ${symbol}`,
      );
    }
  }
  const minimumBars = options.minimumBars ?? STOCK_SCREEN_PROFILE.minimumHistoryBars;
  if (!Number.isInteger(minimumBars) || minimumBars < 1 || minimumBars > 180) {
    throw new ScreenFetchError("HISTORY_OPTION", "history minimumBars must be 1..180");
  }
  if (bars.length < minimumBars) {
    throw new ScreenFetchError("HISTORY_SHORT", `${symbol} has only ${bars.length} ${adjust} bars`);
  }
  return Object.freeze({ bars: Object.freeze(bars), adjust });
}

export async function fetchHistorySeries(symbol, marketDate, options = {}) {
  const attempts = options.attempts ?? 2;
  if (![1, 2].includes(attempts)) throw new ScreenFetchError("HISTORY_OPTION", "history attempts must be 1 or 2");
  await new Promise((resolveDelay) => setTimeout(resolveDelay, HISTORY_REQUEST_INTERVAL_MS));
  const payload = await withRetry(() => fetchJson(historyUrl(symbol, marketDate, options), TENCENT_HISTORY_ORIGIN), attempts);
  return parseTencentHistoryPayload(payload, symbol, marketDate, options);
}

export async function fetchHistory(symbol, marketDate, options = {}) {
  return (await fetchHistorySeries(symbol, marketDate, options)).bars;
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { ok: true, value: await mapper(items[index], index) };
      } catch (error) {
        results[index] = {
          ok: false,
          errorCode: error?.code ?? "HISTORY_ERROR",
          message: error instanceof Error ? error.message : "history fetch failed",
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
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
      throw new ScreenFetchError("OUTPUT_EXISTS", `refusing to replace existing report: ${path}`);
    }
    throw error;
  }
  await unlink(temporary).catch(() => undefined);
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(
      [
        "Usage: node screen-a-shares.mjs --out data/market-insights/<STAMP>-candidates.json [options]",
        "",
        "  --top <3..10>             candidates written to the report (default: 10)",
        "  --history-limit <20..300>  bounded qfq shortlist (default: 120)",
        "  --dry-run                 fetch and calculate without writing",
      ].join("\n") + "\n",
    );
    return { ok: true, help: true };
  }
  if (!options.out) throw new ScreenFetchError("OUTPUT_REQUIRED", "--out is required");
  const outputPath = validateStockScreenOutputPath(options.out);
  const startedAt = Date.now();
  const [{ marketDate, asOf }, quotes] = await Promise.all([
    fetchMarketTimestamp(),
    fetchAllQuotes(),
  ]);
  const currentClock = chinaClock();
  const provisional = currentClock.date === marketDate && currentClock.minutes < 15 * 60 + 10;
  const preparation = prepareHistoryUniverse(quotes, { limit: options.historyLimit });
  const outcomes = await mapWithConcurrency(
    preparation.selected,
    HISTORY_CONCURRENCY,
    (quote) => fetchHistory(quote.symbol, marketDate),
  );
  const histories = new Map();
  const failures = [];
  outcomes.forEach((outcome, index) => {
    const symbol = preparation.selected[index].symbol;
    if (outcome.ok) histories.set(symbol, outcome.value);
    else failures.push({ symbol, errorCode: outcome.errorCode });
  });
  const coverage = preparation.selected.length === 0 ? 0 : histories.size / preparation.selected.length;
  if (coverage < 0.8) {
    const failureCounts = Object.entries(
      failures.reduce((counts, failure) => {
        counts[failure.errorCode] = (counts[failure.errorCode] ?? 0) + 1;
        return counts;
      }, {}),
    )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([code, count]) => `${code}:${count}`)
      .join(", ");
    throw new ScreenFetchError(
      "HISTORY_COVERAGE_LOW",
      `qfq history coverage ${histories.size}/${preparation.selected.length} is below 80%${failureCounts ? ` (${failureCounts})` : ""}`,
    );
  }
  const report = buildStockScreenReport({
    preparation,
    histories,
    marketDate,
    asOf,
    generatedAt: new Date().toISOString(),
    provisional,
    top: options.top,
  });
  if (!options.dryRun) await writeReportCreateOnly(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  const summary = {
    ok: true,
    dryRun: options.dryRun,
    output: options.out,
    marketDate,
    asOf,
    provisional,
    universe: preparation.total,
    baseEligible: preparation.eligible.length,
    historyRequested: preparation.selected.length,
    historyLoaded: histories.size,
    historyFailures: failures.slice(0, 20),
    candidates: report.items.length,
    elapsedMs: Date.now() - startedAt,
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  return summary;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        errorCode: error?.code ?? "SCREEN_ERROR",
        message: error instanceof Error ? error.message : "stock screen failed",
      })}\n`,
    );
    process.exitCode = 1;
  });
}
