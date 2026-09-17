#!/usr/bin/env node
import { open, readFile, rename, mkdir, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NEWS_PATHS,
  buildNewsFeed,
  emptyNewsCache,
  isAllowedNewsUrl,
  mergeNewsCache,
  newsFeedMatchesCache,
  parseCninfoAnnouncements,
  parseEastmoney724,
  parseEastmoneyStock,
  parseNewsCache,
  parseNewsFeed,
  parseNewsSubscriptions,
  parseSecSubmissions,
} from "../news-feed.mjs";

const BODY_LIMIT = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const SOURCE_LIMIT = 100;

class SourceFetchError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "SourceFetchError";
    this.code = code;
  }
}

function eastmoneyCode(symbol) {
  if (!/^(?:SH|SZ)\d{6}$/u.test(symbol)) throw new SourceFetchError("INVALID_SYMBOL");
  return `${symbol.startsWith("SH") ? "1" : "0"}.${symbol.slice(2)}`;
}

function stockUrl(symbol) {
  const url = new URL("https://np-listapi.eastmoney.com/comm/web/getListInfo");
  url.searchParams.set("client", "web");
  url.searchParams.set("type", "1");
  url.searchParams.set("mTypeAndCode", eastmoneyCode(symbol));
  url.searchParams.set("pageSize", "20");
  url.searchParams.set("pageIndex", "1");
  return url.toString();
}

function fastUrl(now) {
  const url = new URL("https://np-weblist.eastmoney.com/comm/web/getFastNewsList");
  url.searchParams.set("client", "web");
  url.searchParams.set("biz", "web_news_col");
  url.searchParams.set("fastColumn", "102");
  // Endpoint contract: the parameter must exist even when it is empty.
  url.searchParams.set("sortEnd", "");
  url.searchParams.set("pageSize", "50");
  url.searchParams.set("req_trace", String(Date.parse(now)));
  return url.toString();
}

async function responseBytes(response) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > BODY_LIMIT) throw new SourceFetchError("BODY_TOO_LARGE");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > BODY_LIMIT) throw new SourceFetchError("BODY_TOO_LARGE");
  return bytes;
}

export async function requestNewsJson(url, {
  fetchImpl,
  headers = {},
  method = "GET",
  body,
  timeoutMs = REQUEST_TIMEOUT_MS,
  redirects = 0,
  retry5xx = true,
  sleep = (ms) => new Promise((accept) => setTimeout(accept, ms)),
} = {}) {
  if (!isAllowedNewsUrl(url)) throw new SourceFetchError("URL_NOT_ALLOWED");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      body,
      headers: { Accept: "application/json", ...headers },
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new SourceFetchError("TIMEOUT");
    throw new SourceFetchError("NETWORK_ERROR", error instanceof Error ? error.message : "network error");
  } finally {
    clearTimeout(timer);
  }
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location || redirects >= MAX_REDIRECTS) throw new SourceFetchError("REDIRECT_REJECTED");
    const next = new URL(location, url).toString();
    if (!isAllowedNewsUrl(next)) throw new SourceFetchError("REDIRECT_NOT_ALLOWED");
    return requestNewsJson(next, { fetchImpl, headers, method, body, timeoutMs, redirects: redirects + 1, retry5xx, sleep });
  }
  if (response.status === 429) throw new SourceFetchError("HTTP_429");
  if (response.status >= 500 && retry5xx) {
    await sleep(25);
    return requestNewsJson(url, { fetchImpl, headers, method, body, timeoutMs, redirects, retry5xx: false, sleep });
  }
  if (!response.ok) throw new SourceFetchError(`HTTP_${response.status}`);
  const text = new TextDecoder().decode(await responseBytes(response));
  try {
    return JSON.parse(text);
  } catch {
    throw new SourceFetchError("BAD_JSON");
  }
}

function attemptError(source, error) {
  return {
    source,
    status: error?.code === "CONFIGURATION_REQUIRED" ? "configuration-required" : "error",
    errorCode: error?.code ?? "SOURCE_ERROR",
  };
}

async function fetchEastmoneyStock(subscriptions, options) {
  const items = [];
  for (const entry of subscriptions.symbols.filter((item) => item.market === "cn").slice(0, SOURCE_LIMIT)) {
    const payload = await requestNewsJson(stockUrl(entry.symbol), {
      ...options,
      headers: { "User-Agent": "QuantLab/0.5 local personal feed", Referer: "https://finance.eastmoney.com/" },
    });
    items.push(...parseEastmoneyStock(payload, entry.symbol, options.now));
  }
  return { source: "eastmoney-stock", status: "ok", items };
}

function cninfoRequest(symbol, now) {
  const end = new Date(now);
  const start = new Date(end.getTime() - 120 * 24 * 60 * 60 * 1_000);
  const date = (value) => value.toISOString().slice(0, 10);
  return new URLSearchParams({
    pageNum: "1",
    pageSize: "20",
    column: "szse",
    tabName: "fulltext",
    plate: "",
    stock: "",
    searchkey: symbol.slice(2),
    secid: "",
    category: "",
    trade: "",
    seDate: `${date(start)}~${date(end)}`,
    sortName: "",
    sortType: "",
    isHLtitle: "true",
  }).toString();
}

async function fetchCninfoAnnouncements(subscriptions, options) {
  const items = [];
  const symbols = subscriptions.symbols.filter((item) => item.market === "cn").slice(0, 30);
  for (const [index, entry] of symbols.entries()) {
    if (index > 0) await options.sleep(100);
    const payload = await requestNewsJson("https://www.cninfo.com.cn/new/hisAnnouncement/query", {
      ...options,
      method: "POST",
      body: cninfoRequest(entry.symbol, options.now),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "QuantLab/0.31 local official disclosure feed",
        Referer: "https://www.cninfo.com.cn/",
      },
    });
    items.push(...parseCninfoAnnouncements(payload, entry.symbol, options.now));
  }
  return { source: "cninfo-announcement", status: "ok", items };
}

async function fetchEastmoney724(subscriptions, options) {
  const payload = await requestNewsJson(fastUrl(options.now), {
    ...options,
    headers: { "User-Agent": "QuantLab/0.5 local personal feed", Referer: "https://finance.eastmoney.com/" },
  });
  return { source: "eastmoney-724", status: "ok", items: parseEastmoney724(payload, subscriptions, options.now) };
}

function tickerMappings(payload) {
  const mappings = new Map();
  for (const row of Object.values(payload && typeof payload === "object" ? payload : {})) {
    const ticker = String(row?.ticker ?? "").toUpperCase();
    if (/^[A-Z][A-Z0-9.-]{0,15}$/u.test(ticker) && Number.isInteger(row?.cik_str)) {
      mappings.set(ticker, String(row.cik_str).padStart(10, "0"));
    }
  }
  return mappings;
}

async function fetchSec(subscriptions, options) {
  if (!subscriptions.secContact) throw new SourceFetchError("CONFIGURATION_REQUIRED");
  const headers = { "User-Agent": subscriptions.secContact };
  const mappings = tickerMappings(await requestNewsJson("https://www.sec.gov/files/company_tickers.json", { ...options, headers }));
  const items = [];
  let requestIndex = 0;
  for (const entry of subscriptions.symbols.filter((item) => item.market === "us").slice(0, SOURCE_LIMIT)) {
    const cik = mappings.get(entry.symbol);
    if (!cik) continue;
    if (requestIndex > 0) await options.sleep(1_000);
    requestIndex += 1;
    const payload = await requestNewsJson(`https://data.sec.gov/submissions/CIK${cik}.json`, { ...options, headers });
    items.push(...parseSecSubmissions(payload, { symbol: entry.symbol, cik }, options.now));
  }
  return { source: "sec-edgar", status: "ok", items };
}

export async function runNewsFetch({
  subscriptions,
  previousCache = emptyNewsCache(),
  previousFeed = null,
  market = "all",
  now = new Date().toISOString(),
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((accept) => setTimeout(accept, ms)),
} = {}) {
  if (!["all", "cn", "us"].includes(market)) throw new Error("market must be all, cn or us");
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation required");
  const sources = market === "cn"
    ? ["cninfo-announcement", "eastmoney-stock", "eastmoney-724"]
    : market === "us"
      ? ["sec-edgar"]
      : ["cninfo-announcement", "eastmoney-stock", "eastmoney-724", "sec-edgar"];
  const attempts = [];
  const options = { fetchImpl, sleep, now: new Date(now).toISOString() };
  for (const source of sources) {
    if (!subscriptions.enabledSources.includes(source)) continue;
    try {
      if (source === "cninfo-announcement") attempts.push(await fetchCninfoAnnouncements(subscriptions, options));
      else if (source === "eastmoney-stock") attempts.push(await fetchEastmoneyStock(subscriptions, options));
      else if (source === "eastmoney-724") attempts.push(await fetchEastmoney724(subscriptions, options));
      else attempts.push(await fetchSec(subscriptions, options));
    } catch (error) {
      attempts.push(attemptError(source, error));
    }
  }
  const cache = mergeNewsCache(previousCache, attempts, subscriptions, options.now);
  const feed = buildNewsFeed(cache, subscriptions, options.now);
  // A feed from another cache generation (crash between the two renames) is
  // not a trustworthy "added" baseline; both files are rebuilt from the cache.
  const baseline = newsFeedMatchesCache(previousFeed, previousCache) ? previousFeed : null;
  const old = new Set((baseline?.items ?? []).map((item) => `${item.id}:${item.fingerprint}`));
  const added = feed.items.filter((item) => !old.has(`${item.id}:${item.fingerprint}`));
  return {
    cache,
    feed,
    attempts: attempts.map((attempt) => ({ source: attempt.source, status: attempt.status, errorCode: attempt.errorCode ?? null, count: attempt.items?.length ?? 0 })),
    added: added.map((item) => item.id),
  };
}

function parseArgs(argv) {
  const options = { subscriptions: NEWS_PATHS.subscriptions, feed: NEWS_PATHS.feed, cache: NEWS_PATHS.cache, market: "all", dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (["--subscriptions", "--feed", "--cache", "--market"].includes(arg)) options[arg.slice(2).replace(/-([a-z])/gu, (_all, char) => char.toUpperCase())] = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

export function validateNewsProjectPath(path) {
  if (!/^data\/news\/[A-Za-z0-9._-]+\.json$/u.test(path)) throw new Error(`unsafe news path: ${path}`);
  return resolve(process.cwd(), path);
}

export async function acquireNewsLock(lockPath) {
  await mkdir(dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") throw new SourceFetchError("LOCK_BUSY");
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await handle.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
  };
}

async function readOptional(path, parser, fallback) {
  try {
    return parser(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function atomicWrite(path, content) {
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
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const subscriptionPath = validateNewsProjectPath(options.subscriptions);
  const feedPath = validateNewsProjectPath(options.feed);
  const cachePath = validateNewsProjectPath(options.cache);
  const lockPath = resolve(dirname(cachePath), ".fetch-news.lock");
  const releaseLock = await acquireNewsLock(lockPath);
  try {
    const subscriptions = parseNewsSubscriptions(await readFile(subscriptionPath, "utf8"));
    // Re-read after acquiring the lock. Another completed invocation must be
    // merged, never overwritten from pre-lock memory.
    const previousCache = await readOptional(cachePath, parseNewsCache, emptyNewsCache());
    const previousFeed = await readOptional(feedPath, parseNewsFeed, null);
    const result = await runNewsFetch({ subscriptions, previousCache, previousFeed, market: options.market });
    if (!options.dryRun) {
      await atomicWrite(cachePath, `${JSON.stringify(result.cache, null, 2)}\n`);
      await atomicWrite(feedPath, `${JSON.stringify(result.feed, null, 2)}\n`);
    }
    const summary = {
      ok: true,
      dryRun: options.dryRun,
      market: options.market,
      sources: result.attempts,
      addedCount: result.added.length,
      addedIds: result.added,
      feedFingerprint: result.feed.fingerprint,
      previousFeedTorn: previousFeed != null && !newsFeedMatchesCache(previousFeed, previousCache),
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return summary;
  } finally {
    await releaseLock();
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, errorCode: error?.code ?? "CLI_ERROR", message: error instanceof Error ? error.message : "news fetch failed" })}\n`);
    process.exitCode = 1;
  });
}
