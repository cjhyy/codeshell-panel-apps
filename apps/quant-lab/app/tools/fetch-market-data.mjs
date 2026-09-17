#!/usr/bin/env node
// Quant Lab market data sync. Zero dependencies.
//
// Writes OHLCV CSV matching app/research/methodology.md:
//   date,open,high,low,close,volume
// plus a sidecar <name>.meta.json recording the adjustment mode, because an
// unlabelled adjustment basis is the single biggest hidden trap in backtesting.
//
// Usage:
//   node tools/fetch-market-data.mjs --symbol 600519 --market cn --adjust qfq
//   node tools/fetch-market-data.mjs --symbol AAPL --market us --adjust adj
//   node tools/fetch-market-data.mjs --symbol AAPL --market us --from 2020-01-01

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTO_DATA_SOURCE_ID,
  HISTORY_DATA_SOURCES,
  historyDataSource,
} from "../market-data-sources.mjs";
import { createRawFactorPriceBundle } from "./a-share-history-cache.mjs";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 12_000_000;
const CN_ADJUST = new Set(["qfq", "hfq", "adj", "none"]);
const US_ADJUST = new Set(["adj", "split", "none"]);
// The reviewed provider registry owns the network allowlist as part of its v1
// contract. Adding an adapter without declaring its exact HTTPS origin can no
// longer silently widen the fetch surface.
const ALLOWED_ORIGINS = new Set(HISTORY_DATA_SOURCES.flatMap((source) => source.origins));
const SOURCE_PRIORITY = Object.freeze({
  cn: Object.freeze(["tencent-ifzq", "eastmoney-kline", "tushare-pro", "alpha-vantage"]),
  us: Object.freeze(["yahoo-finance", "alpha-vantage", "massive"]),
});

export class FetchError extends Error {
  constructor(code, message, details = {}) {
    super(message === undefined ? code : message);
    this.code = message === undefined ? "MARKET_DATA_ERROR" : code;
    if (Number.isInteger(details.status)) this.status = details.status;
    if (Number.isFinite(details.retryAfterMs) && details.retryAfterMs >= 0) {
      this.retryAfterMs = Math.min(24 * 60 * 60 * 1_000, Math.round(details.retryAfterMs));
    }
  }
}

function retryAfterMilliseconds(value, now = Date.now()) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/u.test(text)) {
    return Math.min(24 * 60 * 60 * 1_000, Math.max(0, Math.ceil(Number(text) * 1_000)));
  }
  const instant = Date.parse(text);
  return Number.isFinite(instant)
    ? Math.min(24 * 60 * 60 * 1_000, Math.max(0, instant - now))
    : null;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function isoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // Reject impossible calendar dates such as 2026-02-31, which Date.parse
  // silently rolls forward into a different day.
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// A-share symbols need an exchange prefix. 6xx = Shanghai, 0xx/3xx = Shenzhen.
function cnPrefixed(symbol) {
  const bare = symbol.replace(/^(sh|sz)/i, "");
  if (!/^\d{6}$/.test(bare)) {
    throw new FetchError(`A-share symbol must be 6 digits, got ${JSON.stringify(symbol)}`);
  }
  if (/^(6|9)/.test(bare)) return `sh${bare}`;
  if (/^(0|2|3)/.test(bare)) return `sz${bare}`;
  throw new FetchError(`cannot infer exchange for ${bare}; pass sh${bare} or sz${bare}`);
}

async function responseText(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new FetchError("SOURCE_TOO_LARGE", `source response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw new FetchError("SOURCE_TOO_LARGE", `source response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  return new TextDecoder().decode(bytes);
}

async function getJson(url, options = {}) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    !ALLOWED_ORIGINS.has(parsed.origin)
  ) {
    throw new FetchError("SOURCE_URL_UNSAFE", `source origin is not allowed: ${parsed.origin}`);
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(parsed, {
      method: options.method ?? "GET",
      headers: {
        "User-Agent": UA,
        Accept: "application/json,text/plain,*/*",
        ...(options.headers ?? {}),
      },
      body: options.body,
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new FetchError(
        "SOURCE_HTTP",
        `HTTP ${response.status} from ${parsed.hostname}`,
        {
          status: response.status,
          retryAfterMs: retryAfterMilliseconds(response.headers.get("retry-after")),
        },
      );
    }
    if (response.url && new URL(response.url).origin !== parsed.origin) {
      throw new FetchError("SOURCE_REDIRECT", `source escaped the ${parsed.hostname} allowlist`);
    }
    const text = await responseText(response);
    if (!text.trim()) throw new FetchError("SOURCE_EMPTY", `empty response from ${parsed.hostname}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new FetchError("SOURCE_SHAPE", `non-JSON response from ${parsed.hostname}`);
    }
  } catch (error) {
    if (error.name === "AbortError") {
      throw new FetchError("SOURCE_TIMEOUT", `timeout after ${TIMEOUT_MS}ms from ${parsed.hostname}`);
    }
    if (error instanceof FetchError) throw error;
    const networkCode = String(error?.cause?.code ?? error?.code ?? "");
    if (
      error instanceof TypeError ||
      /^(?:ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN|UND_ERR_[A-Z_]+)$/u.test(networkCode)
    ) {
      throw new FetchError(
        "SOURCE_NETWORK",
        `network error from ${parsed.hostname}${networkCode ? ` (${networkCode})` : ""}`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Tencent returns [date, open, close, high, low, volume] -- close precedes high.
// It hard-caps each response at 640 bars regardless of the count parameter, so
// long ranges are paged backward from `to` until the window is covered.
const CN_PAGE_LIMIT = 640;

async function fetchCnPage(code, from, to, adjust, fetchImpl = fetch) {
  const fq = adjust === "none" ? "" : adjust;
  const url =
    `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get` +
    `?param=${code},day,${from},${to},${CN_PAGE_LIMIT},${fq}`;
  const payload = await getJson(url, { fetchImpl });
  const node = payload?.data?.[code];
  if (!node || Array.isArray(node)) {
    throw new FetchError("SOURCE_EMPTY", `no data for ${code} (delisted or wrong symbol?)`);
  }
  const key = adjust === "none" ? "day" : `${adjust}day`;
  // Never fall back to node.day for an adjusted request: returning raw prices
  // while the sidecar records "qfq" would label unadjusted data as adjusted.
  const rows = node[key];
  if (rows === undefined) {
    // A window containing no trading days returns neither the adjusted series
    // nor any rows. Treat that as exhaustion; only a populated-but-differently-
    // adjusted payload indicates a real basis substitution.
    const fallback = node.day;
    if (!Array.isArray(fallback) || fallback.length === 0) return [];
    const available = Object.keys(node).filter((name) => name.endsWith("day"));
    throw new FetchError(
      "SOURCE_ADJUST_UNAVAILABLE",
      `upstream returned no "${key}" series for ${code}` +
        (available.length ? ` (available: ${available.join(", ")})` : "") +
        `; refusing to substitute a different adjustment basis`,
    );
  }
  return Array.isArray(rows) ? rows : [];
}

async function fetchCn(symbol, from, to, adjust, fetchImpl = fetch, beforeAdditionalRequest = async () => undefined) {
  const code = cnPrefixed(symbol);
  const collected = new Map();
  let cursor = to;

  // Each page ends at `cursor`; step back to the day before its earliest bar.
  for (let page = 0; page < 40; page += 1) {
    if (page > 0) await beforeAdditionalRequest();
    const rows = await fetchCnPage(code, from, cursor, adjust, fetchImpl);
    if (rows.length === 0) break;

    let earliest = null;
    let added = 0;
    for (const row of rows) {
      const date = row[0];
      if (!collected.has(date)) {
        collected.set(date, row);
        added += 1;
      }
      if (earliest === null || date < earliest) earliest = date;
    }
    // `earliest` is the oldest bar available at or after `from`; requesting an
    // earlier window would only return an empty range.
    if (earliest === null || earliest <= from || rows.length < CN_PAGE_LIMIT) break;
    // No new dates means the server stopped honouring the window; stop paging.
    if (added === 0) break;

    const previousDay = new Date(`${earliest}T00:00:00Z`);
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);
    const nextCursor = previousDay.toISOString().slice(0, 10);
    // `nextCursor === from` still has one unfetched day; only stop below `from`
    // or when the cursor fails to move backwards.
    if (nextCursor < from || nextCursor >= cursor) break;
    cursor = nextCursor;
    if (page === 39) {
      process.stderr.write(
        `warning: stopped after 40 pages; ${from}..${cursor} was not fetched\n`,
      );
    }
  }

  if (collected.size === 0) {
    throw new FetchError("SOURCE_EMPTY", `no bars for ${code} in ${from}..${to}`);
  }

  return [...collected.values()]
    .filter((row) => row[0] >= from && row[0] <= to)
    .map((row) => ({
      date: row[0],
      open: Number(row[1]),
      close: Number(row[2]),
      high: Number(row[3]),
      low: Number(row[4]),
      // Tencent reports A-share volume in lots (1 lot = 100 shares).
      volume: Math.round(Number(row[5]) * 100),
    }));
}

function eastmoneySecid(slug) {
  const match = /^(SH|SZ)(\d{6})$/u.exec(slug);
  if (!match) throw new FetchError("SOURCE_SYMBOL_INVALID", `东方财富不支持 ${slug}`);
  return `${match[1] === "SH" ? "1" : "0"}.${match[2]}`;
}

export async function fetchEastmoney({ slug, from, to, adjust, fetchImpl = fetch }) {
  const fqt = { none: "0", qfq: "1", hfq: "2" }[adjust];
  if (fqt === undefined) {
    throw new FetchError("SOURCE_ADJUST_UNSUPPORTED", `东方财富不支持 adjust=${adjust}`);
  }
  const url = new URL("/api/qt/stock/kline/get", "https://push2his.eastmoney.com");
  url.searchParams.set("secid", eastmoneySecid(slug));
  url.searchParams.set("ut", "7eea3edcaed734bea9cbfc24409ed989");
  url.searchParams.set("klt", "101");
  url.searchParams.set("fqt", fqt);
  url.searchParams.set("beg", compactDate(from));
  url.searchParams.set("end", compactDate(to));
  url.searchParams.set("lmt", "1000000");
  url.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6");
  url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56");
  const payload = await getJson(url, {
    fetchImpl,
    headers: { Referer: "https://quote.eastmoney.com/" },
  });
  const rows = payload?.data?.klines;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new FetchError("SOURCE_EMPTY", `东方财富未返回 ${slug} 在 ${from}..${to} 的日线`);
  }
  return rows.map((row) => {
    const [date, open, close, high, low, volume] = String(row).split(",");
    return {
      date,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      // 东方财富日线成交量单位为手，基础库统一换算为股。
      volume: Math.round(Number(volume) * 100),
    };
  });
}

async function fetchUs(symbol, from, to, adjust, fetchImpl = fetch) {
  const p1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
  const p2 = Math.floor(Date.parse(`${to}T23:59:59Z`) / 1000);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplit`;
  const payload = await getJson(url, { fetchImpl });
  const result = payload?.chart?.result?.[0];
  if (!result) {
    const message = payload?.chart?.error?.description ?? "unknown symbol";
    throw new FetchError(`Yahoo rejected ${symbol}: ${message}`);
  }
  const stamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const adjClose = result.indicators?.adjclose?.[0]?.adjclose;
  if (adjust === "adj" && !adjClose) {
    throw new FetchError(`Yahoo returned no adjusted close for ${symbol}`);
  }
  const bars = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = quote.close?.[i];
    // Yahoo pads holidays and halts with nulls; drop rather than interpolate.
    if ([open, high, low, close].some((v) => v == null || !Number.isFinite(v))) continue;
    // Scale OHLC by the adjclose/close ratio so splits and dividends stay
    // internally consistent -- adjusting close alone would break high >= close.
    const factor = adjust === "adj" ? adjClose[i] / close : 1;
    if (!Number.isFinite(factor) || factor <= 0) continue;
    bars.push({
      date: new Date(stamps[i] * 1000).toISOString().slice(0, 10),
      open: open * factor,
      high: high * factor,
      low: low * factor,
      close: close * factor,
      volume: Math.round(quote.volume?.[i] ?? 0),
    });
  }
  if (bars.length === 0) throw new FetchError(`no usable bars for ${symbol} in ${from}..${to}`);
  return bars;
}

function compactDate(value) {
  return value.replaceAll("-", "");
}

function expandedDate(value) {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function tushareSymbol(slug) {
  const match = /^(SH|SZ)(\d{6})$/u.exec(slug);
  if (!match) throw new FetchError("SOURCE_SYMBOL_INVALID", `Tushare does not support ${slug}`);
  return `${match[2]}.${match[1]}`;
}

function alphaVantageSymbol(slug, market) {
  if (market === "us") return slug;
  const match = /^(SH|SZ)(\d{6})$/u.exec(slug);
  if (!match) throw new FetchError("SOURCE_SYMBOL_INVALID", `Alpha Vantage does not support ${slug}`);
  return `${match[2]}.${match[1] === "SH" ? "SHH" : "SHZ"}`;
}

function credentialFor(source, env) {
  if (!source.credentialEnv) return null;
  const value = String(env?.[source.credentialEnv] ?? "").trim();
  if (!value) {
    throw new FetchError(
      "SOURCE_CREDENTIAL_MISSING",
      `${source.label} requires ${source.credentialEnv} in the CodeShell project environment`,
    );
  }
  return value;
}

export function resolveSourceCandidates({
  market,
  adjust,
  requestedSource = AUTO_DATA_SOURCE_ID,
  previousSource = null,
  env = process.env,
}) {
  const pinnedSource = requestedSource === AUTO_DATA_SOURCE_ID && previousSource
    ? previousSource
    : requestedSource;
  if (pinnedSource !== AUTO_DATA_SOURCE_ID) {
    const source = historyDataSource(pinnedSource);
    if (!source) throw new FetchError("SOURCE_UNSUPPORTED", `unsupported data source: ${pinnedSource}`);
    if (!source.markets.includes(market)) {
      throw new FetchError("SOURCE_MARKET_UNSUPPORTED", `${source.label} does not support market=${market}`);
    }
    if (!source.adjustments.includes(adjust)) {
      throw new FetchError("SOURCE_ADJUST_UNSUPPORTED", `${source.label} does not support adjust=${adjust}`);
    }
    credentialFor(source, env);
    return [source];
  }

  const candidates = SOURCE_PRIORITY[market]
    .map((id) => historyDataSource(id))
    .filter((source) => source?.adjustments.includes(adjust))
    .filter((source) => !source.credentialEnv || String(env?.[source.credentialEnv] ?? "").trim());
  if (!candidates.length) {
    throw new FetchError("SOURCE_UNAVAILABLE", `no configured source supports ${market}/${adjust}`);
  }
  return candidates;
}

async function tushareQuery(apiName, params, fields, token, fetchImpl) {
  const payload = await getJson("https://api.tushare.pro", {
    fetchImpl,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_name: apiName, token, params, fields: fields.join(",") }),
  });
  if (payload?.code !== 0) {
    const message = String(payload?.msg ?? "");
    const limited = /(?:rate|limit|too many|frequency|频率|每分钟|访问过于频繁)/iu.test(message);
    throw new FetchError(
      limited ? "SOURCE_RATE_LIMIT" : "SOURCE_REJECTED",
      `Tushare rejected ${apiName} (code ${String(payload?.code ?? "unknown").slice(0, 24)})`,
    );
  }
  const returnedFields = payload?.data?.fields;
  const items = payload?.data?.items;
  if (!Array.isArray(returnedFields) || !Array.isArray(items)) {
    throw new FetchError("SOURCE_SHAPE", `Tushare ${apiName} response shape changed`);
  }
  const indexes = new Map(returnedFields.map((field, index) => [field, index]));
  for (const field of fields) {
    if (!indexes.has(field)) throw new FetchError("SOURCE_SHAPE", `Tushare ${apiName} omitted ${field}`);
  }
  return items.map((item) => Object.fromEntries(fields.map((field) => [field, item[indexes.get(field)]])));
}

export async function fetchTushare({ slug, from, to, adjust, token, fetchImpl = fetch }) {
  const tsCode = tushareSymbol(slug);
  const params = {
    ts_code: tsCode,
    start_date: compactDate(from),
    end_date: compactDate(to),
  };
  const daily = await tushareQuery(
    "daily",
    params,
    ["trade_date", "open", "high", "low", "close", "vol"],
    token,
    fetchImpl,
  );
  let factors = null;
  let latestFactor = 1;
  if (adjust !== "none") {
    const rows = await tushareQuery(
      "adj_factor",
      params,
      ["trade_date", "adj_factor"],
      token,
      fetchImpl,
    );
    factors = new Map(rows.map((row) => [row.trade_date, Number(row.adj_factor)]));
    const latestDate = daily.map((row) => String(row.trade_date)).sort().at(-1);
    latestFactor = factors.get(latestDate);
    if (!Number.isFinite(latestFactor) || latestFactor <= 0) {
      throw new FetchError("SOURCE_SHAPE", `Tushare has no valid latest adjustment factor for ${tsCode}`);
    }
  }
  return daily.map((row) => {
    const factor = adjust === "none" ? 1 : factors.get(String(row.trade_date));
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new FetchError("SOURCE_SHAPE", `Tushare adjustment factor is missing for ${row.trade_date}`);
    }
    // Tushare documents qfq as price × factor / latest factor and hfq as
    // price × factor. Volume is reported in lots (手), so normalize to shares.
    const multiplier = adjust === "qfq" ? factor / latestFactor : factor;
    return {
      date: expandedDate(String(row.trade_date)),
      open: Number(row.open) * multiplier,
      high: Number(row.high) * multiplier,
      low: Number(row.low) * multiplier,
      close: Number(row.close) * multiplier,
      volume: Math.round(Number(row.vol) * 100),
    };
  });
}

async function fetchTusharePriceBundle({
  source,
  slug,
  from,
  to,
  env,
  fetchImpl,
  beforeRequest,
}) {
  const token = credentialFor(source, env);
  const tsCode = tushareSymbol(slug);
  const params = {
    ts_code: tsCode,
    start_date: compactDate(from),
    end_date: compactDate(to),
  };
  await beforeRequest();
  const daily = await tushareQuery(
    "daily",
    params,
    ["trade_date", "open", "high", "low", "close", "vol"],
    token,
    fetchImpl,
  );
  await beforeRequest();
  const factorRows = await tushareQuery(
    "adj_factor",
    params,
    ["trade_date", "adj_factor"],
    token,
    fetchImpl,
  );
  const factors = new Map(factorRows.map((row) => [String(row.trade_date), Number(row.adj_factor)]));
  const latestDate = daily.map((row) => String(row.trade_date)).sort().at(-1);
  const latestFactor = factors.get(latestDate);
  if (!Number.isFinite(latestFactor) || latestFactor <= 0) {
    throw new FetchError("SOURCE_SHAPE", `Tushare has no valid latest adjustment factor for ${tsCode}`);
  }
  const rawBars = daily.map((row) => ({
    date: expandedDate(String(row.trade_date)),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Math.round(Number(row.vol) * 100),
  }));
  const adjustmentFactors = daily.map((row) => {
    const factor = factors.get(String(row.trade_date));
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new FetchError("SOURCE_SHAPE", `Tushare adjustment factor is missing for ${row.trade_date}`);
    }
    return {
      date: expandedDate(String(row.trade_date)),
      factor: factor / latestFactor,
    };
  });
  return createRawFactorPriceBundle({
    rawBars,
    adjustmentFactors,
    source: source.id,
    factorSource: source.id,
    factorMethod: "official-adj-factor",
  });
}

export async function fetchAsharePriceBundle(options) {
  const candidates = resolveSourceCandidates({ ...options, market: "cn", adjust: "qfq" });
  const failures = [];
  let requestCount = 0;
  const beforeRequest = async () => {
    if (requestCount > 0 && typeof options.beforeAdditionalRequest === "function") {
      await options.beforeAdditionalRequest();
    }
    requestCount += 1;
  };
  for (const source of candidates) {
    try {
      let bundle;
      if (source.id === "tushare-pro") {
        bundle = await fetchTusharePriceBundle({
          source,
          slug: options.slug,
          from: options.from,
          to: options.to,
          env: options.env ?? process.env,
          fetchImpl: options.fetchImpl ?? fetch,
          beforeRequest,
        });
      } else if (["tencent-ifzq", "eastmoney-kline"].includes(source.id)) {
        await beforeRequest();
        const rawBars = await fetchBarsFromSource({
          ...options,
          market: "cn",
          adjust: "none",
          source,
          beforeAdditionalRequest: beforeRequest,
        });
        await beforeRequest();
        const adjustedBars = await fetchBarsFromSource({
          ...options,
          market: "cn",
          adjust: "qfq",
          source,
          beforeAdditionalRequest: beforeRequest,
        });
        bundle = createRawFactorPriceBundle({
          rawBars,
          adjustedBars,
          source: source.id,
          factorSource: source.id,
          factorMethod: "derived-qfq-ratio",
        });
      } else {
        throw new FetchError("SOURCE_ADJUST_UNSUPPORTED", `${source.label} cannot provide an auditable A-share factor`);
      }
      return Object.freeze({
        ...bundle,
        source: source.id,
        failures: Object.freeze(failures),
      });
    } catch (error) {
      const normalized = /^A_SHARE_HISTORY_/u.test(String(error?.message ?? ""))
        ? new FetchError("SOURCE_FACTOR_INVALID", `${source.label} raw prices and adjustment factors do not align`)
        : error;
      failures.push({ source: source.id, code: normalized?.code ?? "MARKET_DATA_ERROR" });
      if (options.requestedSource !== AUTO_DATA_SOURCE_ID || options.previousSource) throw normalized;
    }
  }
  throw new FetchError(
    "SOURCE_ALL_FAILED",
    `all eligible A-share raw/factor sources failed: ${failures.map((failure) => `${failure.source}/${failure.code}`).join(", ")}`,
  );
}

export async function fetchAlphaVantage({ slug, market, from, to, adjust, apiKey, fetchImpl = fetch }) {
  const adjusted = adjust === "adj";
  const url = new URL("/query", "https://www.alphavantage.co");
  url.searchParams.set("function", adjusted ? "TIME_SERIES_DAILY_ADJUSTED" : "TIME_SERIES_DAILY");
  url.searchParams.set("symbol", alphaVantageSymbol(slug, market));
  url.searchParams.set("outputsize", "full");
  url.searchParams.set("apikey", apiKey);
  const payload = await getJson(url, { fetchImpl });
  const rejected = payload?.["Error Message"] ?? payload?.Note ?? payload?.Information;
  if (rejected) {
    const limited = /(?:rate|limit|too many|frequency|calls per)/iu.test(String(rejected));
    throw new FetchError(
      limited ? "SOURCE_RATE_LIMIT" : "SOURCE_REJECTED",
      `Alpha Vantage rejected the request: ${String(rejected).slice(0, 180)}`,
    );
  }
  const series = payload?.["Time Series (Daily)"];
  if (!series || typeof series !== "object" || Array.isArray(series)) {
    throw new FetchError("SOURCE_SHAPE", "Alpha Vantage daily response shape changed");
  }
  return Object.entries(series).flatMap(([date, row]) => {
    if (date < from || date > to) return [];
    const close = Number(row?.["4. close"]);
    const adjustedClose = adjusted ? Number(row?.["5. adjusted close"]) : close;
    const factor = adjustedClose / close;
    if (!Number.isFinite(factor) || factor <= 0) return [];
    return [{
      date,
      open: Number(row?.["1. open"]) * factor,
      high: Number(row?.["2. high"]) * factor,
      low: Number(row?.["3. low"]) * factor,
      close: close * factor,
      volume: Math.round(Number(row?.[adjusted ? "6. volume" : "5. volume"] ?? 0)),
    }];
  });
}

export async function fetchMassive({ slug, from, to, adjust, apiKey, fetchImpl = fetch }) {
  const url = new URL(
    `/v2/aggs/ticker/${encodeURIComponent(slug)}/range/1/day/${from}/${to}`,
    "https://api.massive.com",
  );
  url.searchParams.set("adjusted", String(adjust === "split"));
  url.searchParams.set("sort", "asc");
  url.searchParams.set("limit", "50000");
  url.searchParams.set("apiKey", apiKey);
  const payload = await getJson(url, { fetchImpl });
  if (!Array.isArray(payload?.results)) {
    throw new FetchError("SOURCE_SHAPE", "Massive aggregate response shape changed");
  }
  return payload.results.flatMap((row) => {
    const date = new Date(Number(row?.t)).toISOString().slice(0, 10);
    if (date < from || date > to) return [];
    return [{
      date,
      open: Number(row?.o),
      high: Number(row?.h),
      low: Number(row?.l),
      close: Number(row?.c),
      volume: Math.round(Number(row?.v ?? 0)),
    }];
  });
}

export async function fetchBarsFromSource({
  source,
  symbol,
  slug,
  market,
  from,
  to,
  adjust,
  env = process.env,
  fetchImpl = fetch,
  beforeAdditionalRequest = async () => undefined,
}) {
  if (source.id === "tencent-ifzq") {
    return fetchCn(symbol, from, to, adjust, fetchImpl, beforeAdditionalRequest);
  }
  if (source.id === "eastmoney-kline") {
    return fetchEastmoney({ slug, from, to, adjust, fetchImpl });
  }
  if (source.id === "yahoo-finance") return fetchUs(symbol, from, to, adjust, fetchImpl);
  const credential = credentialFor(source, env);
  if (source.id === "tushare-pro") {
    return fetchTushare({ slug, from, to, adjust, token: credential, fetchImpl });
  }
  if (source.id === "alpha-vantage") {
    return fetchAlphaVantage({ slug, market, from, to, adjust, apiKey: credential, fetchImpl });
  }
  if (source.id === "massive") {
    return fetchMassive({ slug, from, to, adjust, apiKey: credential, fetchImpl });
  }
  throw new FetchError("SOURCE_UNSUPPORTED", `unsupported data source: ${source.id}`);
}

export async function fetchWithSourceFallback(options) {
  const candidates = resolveSourceCandidates(options);
  const failures = [];
  for (const source of candidates) {
    try {
      const bars = await fetchBarsFromSource({ ...options, source });
      return { bars, source: source.id, failures };
    } catch (error) {
      failures.push({ source: source.id, code: error?.code ?? "MARKET_DATA_ERROR" });
      if (options.requestedSource !== AUTO_DATA_SOURCE_ID || options.previousSource) throw error;
    }
  }
  throw new FetchError(
    "SOURCE_ALL_FAILED",
    `all eligible sources failed: ${failures.map((failure) => `${failure.source}/${failure.code}`).join(", ")}`,
  );
}

// Guards against the malformed data the panel's own audit would flag later.
function sanitize(bars) {
  const seen = new Set();
  const clean = [];
  const dropped = { duplicate: 0, nonPositive: 0, inconsistent: 0 };
  for (const bar of bars) {
    if (!isoDate(bar.date)) continue;
    if (seen.has(bar.date)) {
      dropped.duplicate += 1;
      continue;
    }
    const prices = [bar.open, bar.high, bar.low, bar.close];
    if (prices.some((p) => !Number.isFinite(p) || p <= 0)) {
      dropped.nonPositive += 1;
      continue;
    }
    if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) {
      dropped.inconsistent += 1;
      continue;
    }
    seen.add(bar.date);
    clean.push(bar);
  }
  clean.sort((a, b) => a.date.localeCompare(b.date));
  return { bars: clean, dropped };
}

function round(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function toCsv(bars) {
  const lines = ["date,open,high,low,close,volume"];
  for (const b of bars) {
    lines.push(
      `${b.date},${round(b.open)},${round(b.high)},${round(b.low)},${round(b.close)},${b.volume}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function fingerprintText(value) {
  let hash = 2_166_136_261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

// Must reproduce engine.mjs fingerprintBars exactly: data rows only, no header,
// so the panel can detect drift between a CSV and its sidecar. Hashing the
// rendered CSV (header included) would disagree with the engine on every file.
function fingerprintBars(bars) {
  return fingerprintText(
    bars
      .map((bar) =>
        [bar.date, round(bar.open), round(bar.high), round(bar.low), round(bar.close), bar.volume].join(","),
      )
      .join("\n") + "\n",
  );
}

// Human-readable name for a symbol. The panel shows codes otherwise, and
// "SH600519" tells a reader far less than "贵州茅台". Never fatal: a missing
// name degrades the display, it does not invalidate the price data.
async function fetchDisplayName(market, slug, fetchImpl = fetch) {
  try {
    if (market === "cn") {
      const code = slug.toLowerCase();
      const response = await fetchImpl(`https://qt.gtimg.cn/q=${code}`, {
        headers: { "User-Agent": UA, Referer: "https://finance.qq.com" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;
      // The quote feed is GBK-encoded; decode explicitly or names arrive as
      // replacement characters.
      const text = new TextDecoder("gbk").decode(await response.arrayBuffer());
      return text.split("~")[1]?.trim() || null;
    }
    const response = await fetchImpl(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(slug)}?interval=1d&range=1d`,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) return null;
    const payload = await response.json();
    const meta = payload?.chart?.result?.[0]?.meta;
    return meta?.longName || meta?.shortName || null;
  } catch {
    return null;
  }
}

export async function runCli(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseArgs(argv);
  const env = dependencies.env ?? process.env;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now instanceof Date ? dependencies.now : new Date();
  if (!Number.isFinite(now.getTime())) throw new FetchError("NOW_INVALID", "valid current time required");
  if (args["list-sources"]) {
    const rows = HISTORY_DATA_SOURCES.map((source) => ({
      id: source.id,
      label: source.label,
      markets: source.markets,
      adjustments: source.adjustments,
      access: source.access,
      contract: source.contract,
      capabilities: source.capabilities,
      origins: source.origins,
      credentialEnv: source.credentialEnv,
      configured: !source.credentialEnv || Boolean(String(env[source.credentialEnv] ?? "").trim()),
    }));
    process.stdout.write(`${JSON.stringify({ sources: rows }, null, 2)}\n`);
    return { sources: rows };
  }
  if (args.help) {
    console.log(
      [
        "Usage: node tools/fetch-market-data.mjs --symbol <SYM> --market <cn|us> [options]",
        "",
        "  --symbol   600519 | sh600519 | AAPL          (required)",
        "  --market   cn | us                            (default: inferred)",
        "  --source   auto | provider id                 (default: auto)",
        "  --adjust   cn: qfq|hfq|adj|none  us: adj|split|none",
        "  --from     YYYY-MM-DD                         (default: 2015-01-01)",
        "  --to       YYYY-MM-DD                         (default: today)",
        "  --out-dir  output directory                   (default: data/market)",
        "  --stdout-bundle  emit validated metadata + CSV as JSON without writing",
        "  --list-sources                                show adapters and credential readiness",
      ].join("\n"),
    );
    return { help: true };
  }

  const symbol = typeof args.symbol === "string" ? args.symbol.trim() : "";
  if (!symbol) throw new FetchError("--symbol is required (try --help)");

  const market = (
    typeof args.market === "string" ? args.market : /^\d{6}$|^(sh|sz)\d{6}$/i.test(symbol) ? "cn" : "us"
  ).toLowerCase();
  if (market !== "cn" && market !== "us") throw new FetchError(`--market must be cn or us`);

  const adjust = (typeof args.adjust === "string" ? args.adjust : market === "cn" ? "qfq" : "adj")
    .toLowerCase();
  const allowed = market === "cn" ? CN_ADJUST : US_ADJUST;
  if (!allowed.has(adjust)) {
    throw new FetchError(`--adjust for ${market} must be one of: ${[...allowed].join(", ")}`);
  }

  const from = typeof args.from === "string" ? args.from : "2015-01-01";
  const to = typeof args.to === "string" ? args.to : now.toISOString().slice(0, 10);
  if (!isoDate(from) || !isoDate(to)) throw new FetchError("--from/--to must be YYYY-MM-DD");
  if (from > to) throw new FetchError("--from must not be after --to");

  const stdoutBundle = args["stdout-bundle"] === true;
  const outDir = resolve(typeof args["out-dir"] === "string" ? args["out-dir"] : "data/market");
  const slug = market === "cn" ? cnPrefixed(symbol).toUpperCase() : symbol.toUpperCase();
  // The slug becomes a filename; reject anything that could traverse outDir.
  if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(slug) || slug.includes("..")) {
    throw new FetchError(`unsafe symbol for a filename: ${JSON.stringify(symbol)}`);
  }
  const csvPath = join(outDir, `${slug}.csv`);
  const metaPath = join(outDir, `${slug}.meta.json`);

  // Read the existing contract before touching the network. Automatic mode
  // pins updates to the prior provider so one CSV can never silently mix data
  // from two vendors.
  let previous = null;
  let previousUnreadable = false;
  if (!stdoutBundle) {
    try {
      const parsed = JSON.parse(await readFile(metaPath, "utf8"));
      // Valid JSON that is not an object (null, false, an array) carries no
      // readable adjustment basis, so treat it as unreadable rather than absent.
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw Object.assign(new Error("metadata is not an object"), { code: "EINVALIDMETA" });
      }
      previous = parsed;
    } catch (error) {
      previous = null;
      // ENOENT means no prior dataset. Anything else means metadata exists but
      // cannot be understood, so its adjustment basis is unknown, not absent.
      if ((error?.code ?? null) !== "ENOENT") previousUnreadable = true;
    }
  }
  if (previousUnreadable && !args.force) {
    throw new FetchError(
      `${slug} has existing metadata that could not be parsed; its adjustment basis is unknown. ` +
        `Pass --force to overwrite, or remove ${metaPath} first.`,
    );
  }
  if (previous && previous.adjust !== adjust && !args.force) {
    throw new FetchError(
      `${slug} already exists with adjust=${previous.adjust}; refusing to overwrite with ` +
        `adjust=${adjust}. Mixing adjustment bases silently corrupts backtests. ` +
        `Pass --force to replace, or use a different --out-dir.`,
    );
  }
  const requestedSource = typeof args.source === "string" ? args.source : AUTO_DATA_SOURCE_ID;
  if (
    previous &&
    requestedSource !== AUTO_DATA_SOURCE_ID &&
    previous.source !== requestedSource &&
    !args.force
  ) {
    throw new FetchError(
      "SOURCE_CONTRACT_CONFLICT",
      `${slug} already exists with source=${previous.source}; refusing to mix source=${requestedSource}. ` +
        `Use a different --out-dir or explicitly replace the old dataset.`,
    );
  }

  process.stderr.write(
    `fetching ${slug} (${market}/${adjust}, source=${requestedSource}) ${from}..${to}\n`,
  );
  const fetched = await fetchWithSourceFallback({
    requestedSource,
    previousSource: previous && !args.force ? previous.source : null,
    symbol,
    slug,
    market,
    from,
    to,
    adjust,
    env,
    fetchImpl,
  });
  const { bars, dropped } = sanitize(fetched.bars);
  if (bars.length < 3) throw new FetchError(`only ${bars.length} valid bars; need at least 3`);

  const displayName = previous?.name || await fetchDisplayName(market, slug, fetchImpl);
  const csv = toCsv(bars);
  const metadata = {
    format: "codeshell.quant-dataset",
    version: 1,
    symbol: slug,
    name: displayName,
    market,
    adjust,
    source: fetched.source,
    sourceRequested: requestedSource,
    sourceFallbacks: fetched.failures,
    syncedAt: now.toISOString(),
    // Records the end of the interval that the provider was actually asked
    // to check. This can be newer than the last bar for a suspension or
    // non-trading day and prevents a background updater from retrying the
    // same already-verified interval forever.
    networkCheckedThrough: to,
    bars: bars.length,
    from: bars[0].date,
    to: bars.at(-1).date,
    fingerprint: fingerprintBars(bars),
    dropped,
  };

  if (stdoutBundle) {
    const bundle = {
      format: "codeshell.quant-dataset-bundle",
      version: 1,
      csv,
      metadata,
    };
    process.stdout.write(`${JSON.stringify(bundle)}\n`);
    return bundle;
  }

  await mkdir(dirname(csvPath), { recursive: true });

  // Write the sidecar first, then the CSV. A crash between the two leaves a
  // sidecar describing data that was never written (detectable via fingerprint
  // mismatch) rather than a new CSV wearing the previous basis label.
  await writeFile(
    metaPath,
    `${JSON.stringify(
      metadata,
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(csvPath, csv, "utf8");

  const droppedTotal = dropped.duplicate + dropped.nonPositive + dropped.inconsistent;
  console.log(`${csvPath}${displayName ? `  (${displayName})` : ""}`);
  console.log(
    `  ${bars.length} bars  ${bars[0].date}..${bars.at(-1).date}  ` +
      `adjust=${adjust}  source=${fetched.source}` +
      (droppedTotal ? `  (dropped ${droppedTotal})` : ""),
  );
  if (adjust === "none") {
    console.log("  WARNING: unadjusted prices. Splits/dividends will distort backtest results.");
  }
  return {
    path: csvPath,
    symbol: slug,
    source: fetched.source,
    adjust,
    bars: bars.length,
    from: bars[0].date,
    to: bars.at(-1).date,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli().catch((error) => {
    process.stderr.write(`error [${error?.code ?? "MARKET_DATA_ERROR"}]: ${error.message}\n`);
    process.exitCode = 1;
  });
}
