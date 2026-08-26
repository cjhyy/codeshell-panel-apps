#!/usr/bin/env node
// Portfolio-valuation raw market sync. Zero dependencies, Node 18+.
//
// The output directory is intentionally fixed to data/market-raw. Research
// datasets in data/market are owned by fetch-market-data.mjs and can never be
// selected or overwritten by this tool.

import {
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  observationAvailableAt,
  sourceDateFromTimestamp,
} from "../market-contract.mjs";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 InvestmentDesk/0.5";
const RAW_DIRECTORY = "data/market-raw";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const CN_PAGE_LIMIT = 640;
const OUTPUT_HEADER =
  "marketDate,availableAt,open,high,low,close,volume";

export class PortfolioDataError extends Error {
  constructor(message, code = "PORTFOLIO_DATA_ERROR", details = {}) {
    super(message);
    this.name = "PortfolioDataError";
    this.code = code;
    Object.assign(this, details);
  }
}

function plainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function addDays(value, days) {
  const instant = new Date(`${value}T00:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

function round(value) {
  if (!Number.isFinite(value)) throw new PortfolioDataError("bar contains a non-finite number", "INVALID_BAR");
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(6).replace(/0+$/u, "").replace(/\.$/u, "");
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

export function fingerprintPortfolioBars(bars) {
  return fingerprintText(
    `${bars
      .map((bar) =>
        [
          bar.marketDate,
          round(bar.open),
          round(bar.high),
          round(bar.low),
          round(bar.close),
          Math.round(bar.volume),
        ].join(","),
      )
      .join("\n")}\n`,
  );
}

function canonicalSymbol(value) {
  if (typeof value !== "string") {
    throw new PortfolioDataError("symbol must be a string", "INVALID_SYMBOL");
  }
  const upper = value.trim().toUpperCase();
  if (upper === "USDCNY") {
    return { symbol: upper, market: "fx", upstreamSymbol: "CNY=X" };
  }
  const cn = /^(SH|SZ)?(\d{6})$/u.exec(upper);
  if (cn) {
    const inferred = /^(6|9)/u.test(cn[2])
      ? "SH"
      : /^(0|2|3)/u.test(cn[2])
        ? "SZ"
        : null;
    if (!inferred || (cn[1] && cn[1] !== inferred)) {
      throw new PortfolioDataError(
        `invalid A-share symbol ${JSON.stringify(value)}`,
        "INVALID_SYMBOL",
      );
    }
    return {
      symbol: `${inferred}${cn[2]}`,
      market: "cn",
      upstreamSymbol: `${inferred.toLowerCase()}${cn[2]}`,
    };
  }
  if (
    !/^[A-Z][A-Z0-9.-]{0,9}$/u.test(upper) ||
    upper.includes("..") ||
    /^HK[.:_-]/u.test(upper)
  ) {
    throw new PortfolioDataError(
      `invalid portfolio symbol ${JSON.stringify(value)}`,
      "INVALID_SYMBOL",
    );
  }
  return { symbol: upper, market: "us", upstreamSymbol: upper };
}

export function validateCliOptions({
  adjust = "none",
  purpose = "portfolio-valuation",
  outDir,
} = {}) {
  if (String(adjust).toLowerCase() !== "none") {
    throw new PortfolioDataError(
      "portfolio valuation requires adjust=none",
      "INVALID_ADJUST",
    );
  }
  if (purpose !== "portfolio-valuation") {
    throw new PortfolioDataError(
      "portfolio valuation requires purpose=portfolio-valuation",
      "INVALID_PURPOSE",
    );
  }
  if (outDir !== undefined) {
    throw new PortfolioDataError(
      "portfolio output is fixed to data/market-raw; --out-dir is forbidden",
      "INVALID_OUTPUT_DIRECTORY",
    );
  }
  return { adjust: "none", purpose: "portfolio-valuation" };
}

function expectedSource(market) {
  return market === "cn" ? "tencent-ifzq" : "yahoo-chart";
}

function availableAtContract(market) {
  return {
    field: "availableAt",
    marketDateField: "marketDate",
    rule:
      market === "cn"
        ? "marketDate 15:00 Asia/Shanghai"
        : market === "us"
          ? "marketDate 16:00 America/New_York"
          : "marketDate+1 00:00 UTC",
  };
}

function sanitizeBars(bars) {
  const byDate = new Map();
  for (const bar of bars) {
    if (!isoDate(bar.marketDate)) continue;
    const prices = [bar.open, bar.high, bar.low, bar.close];
    if (prices.some((price) => !Number.isFinite(price) || price <= 0)) continue;
    if (
      bar.high < Math.max(bar.open, bar.close) ||
      bar.low > Math.min(bar.open, bar.close)
    ) {
      continue;
    }
    if (!Number.isFinite(bar.volume) || bar.volume < 0) continue;
    if (!byDate.has(bar.marketDate)) byDate.set(bar.marketDate, bar);
  }
  return [...byDate.values()].sort((left, right) =>
    left.marketDate.localeCompare(right.marketDate),
  );
}

function toCsv(bars) {
  return `${[
    OUTPUT_HEADER,
    ...bars.map((bar) =>
      [
        bar.marketDate,
        bar.availableAt,
        round(bar.open),
        round(bar.high),
        round(bar.low),
        round(bar.close),
        String(Math.round(bar.volume)),
      ].join(","),
    ),
  ].join("\n")}\n`;
}

function parseCachedCsv(text, market) {
  const lines = String(text).trimEnd().split(/\r?\n/u);
  if (lines.shift() !== OUTPUT_HEADER || lines.length === 0) {
    throw new PortfolioDataError(
      "existing cache contract conflict: unexpected raw CSV header",
      "CACHE_CONTRACT_CONFLICT",
    );
  }
  const bars = lines.map((line, index) => {
    const fields = line.split(",");
    if (fields.length !== 7 || !isoDate(fields[0]) || Number.isNaN(Date.parse(fields[1]))) {
      throw new PortfolioDataError(
        `existing cache contract conflict: invalid CSV row ${index + 2}`,
        "CACHE_CONTRACT_CONFLICT",
      );
    }
    const bar = {
      marketDate: fields[0],
      availableAt: fields[1],
      open: Number(fields[2]),
      high: Number(fields[3]),
      low: Number(fields[4]),
      close: Number(fields[5]),
      volume: Number(fields[6]),
    };
    if (
      bar.availableAt !==
        observationAvailableAt({ market, observationDate: bar.marketDate }) ||
      [bar.open, bar.high, bar.low, bar.close].some(
        (value) => !Number.isFinite(value) || value <= 0,
      ) ||
      bar.high < Math.max(bar.open, bar.close) ||
      bar.low > Math.min(bar.open, bar.close) ||
      !Number.isInteger(bar.volume) ||
      bar.volume < 0
    ) {
      throw new PortfolioDataError(
        `existing cache contract conflict: invalid CSV row ${index + 2}`,
        "CACHE_CONTRACT_CONFLICT",
      );
    }
    return bar;
  });
  if (
    bars.some(
      (bar, index) =>
        index > 0 && bar.marketDate <= bars[index - 1].marketDate,
    )
  ) {
    throw new PortfolioDataError(
      "existing cache contract conflict: raw dates must be unique and ascending",
      "CACHE_CONTRACT_CONFLICT",
    );
  }
  return bars;
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function loadExisting(paths, identity) {
  const [csv, metaText] = await Promise.all([
    readOptional(paths.csv),
    readOptional(paths.meta),
  ]);
  if (csv === null && metaText === null) return null;
  if (csv === null || metaText === null) {
    throw new PortfolioDataError(
      "existing cache contract conflict: CSV and sidecar must both exist",
      "CACHE_CONTRACT_CONFLICT",
    );
  }
  let meta;
  try {
    meta = JSON.parse(metaText);
  } catch {
    throw new PortfolioDataError(
      "existing cache contract conflict: sidecar is not valid JSON",
      "CACHE_CONTRACT_CONFLICT",
    );
  }
  const expected = {
    format: "codeshell.market-data",
    version: 1,
    symbol: identity.symbol,
    market: identity.market,
    purpose: "portfolio-valuation",
    adjust: "none",
    source: expectedSource(identity.market),
  };
  const conflict =
    !plainObject(meta) ||
    Object.entries(expected).some(([key, value]) => meta[key] !== value) ||
    typeof meta.name !== "string" ||
    meta.name.trim().length === 0 ||
    !Number.isInteger(meta.bars) ||
    meta.bars < 1 ||
    typeof meta.sourceTimeZone !== "string" ||
    meta.sourceTimeZone.length === 0 ||
    typeof meta.syncedAt !== "string" ||
    Number.isNaN(Date.parse(meta.syncedAt)) ||
    typeof meta.lastAttemptAt !== "string" ||
    Number.isNaN(Date.parse(meta.lastAttemptAt)) ||
    typeof meta.stale !== "boolean" ||
    (identity.market === "fx" &&
      (meta.upstreamSymbol !== "CNY=X" || meta.direction !== "USD/CNY")) ||
    !plainObject(meta.availableAt) ||
    JSON.stringify(meta.availableAt) !==
      JSON.stringify(availableAtContract(identity.market));
  if (conflict) {
    throw new PortfolioDataError(
      "existing cache contract conflict: purpose/adjust/source/symbol/availableAt mismatch",
      "CACHE_CONTRACT_CONFLICT",
    );
  }
  const bars = parseCachedCsv(csv, identity.market);
  if (
    meta.bars !== bars.length ||
    meta.from !== bars[0].marketDate ||
    meta.to !== bars.at(-1).marketDate ||
    meta.fingerprint !== fingerprintPortfolioBars(bars)
  ) {
    throw new PortfolioDataError(
      "existing cache contract conflict: fingerprint mismatch",
      "CACHE_CONTRACT_CONFLICT",
    );
  }
  return { csv, meta, bars };
}

const MAX_RETRY_AFTER_MS = 120_000;

function retryAfterMilliseconds(response, now) {
  const raw = response.headers.get("retry-after");
  if (!raw) return 60_000;
  if (/^\d+$/u.test(raw.trim())) return Number(raw.trim()) * 1_000;
  const instant = Date.parse(raw);
  return Number.isNaN(instant)
    ? 60_000
    : Math.max(0, instant - now().getTime());
}

function yahooLimiter({ now, sleep, minimumIntervalMs }) {
  let lastStartedAt = null;
  return async () => {
    const current = now().getTime();
    if (lastStartedAt !== null) {
      const wait = Math.max(0, minimumIntervalMs - (current - lastStartedAt));
      if (wait > 0) await sleep(wait);
      lastStartedAt = Math.max(current + wait, lastStartedAt + minimumIntervalMs);
    } else {
      lastStartedAt = current;
    }
  };
}

async function responseText(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw new PortfolioDataError(
      `response exceeds ${MAX_BODY_BYTES} bytes`,
      "BODY_TOO_LARGE",
    );
  }
  return new TextDecoder().decode(bytes);
}

async function fetchJson(url, context, { yahoo = false } = {}) {
  const attempts = yahoo ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (yahoo) await context.beforeYahooRequest();
    let response;
    try {
      response = await context.fetchImpl(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json,text/plain,*/*",
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new PortfolioDataError(
        error?.message ?? "network request failed",
        error?.code ?? "NETWORK",
      );
    }
    if (response.status === 429) {
      const retryAfterMs = retryAfterMilliseconds(response, context.now);
      // One bounded retry. An unreasonable Retry-After is reported as a stale
      // failure with the requested delay rather than blocking the process.
      if (attempt + 1 < attempts && retryAfterMs <= MAX_RETRY_AFTER_MS) {
        await context.sleep(retryAfterMs);
        continue;
      }
      throw new PortfolioDataError("Yahoo returned HTTP 429", "HTTP_429", {
        retryAfterSeconds: Math.ceil(retryAfterMs / 1_000),
      });
    }
    if (!response.ok) {
      throw new PortfolioDataError(
        `HTTP ${response.status} from ${new URL(url).host}`,
        `HTTP_${response.status}`,
      );
    }
    const text = await responseText(response);
    if (!text.trim()) throw new PortfolioDataError("empty source response", "EMPTY_RESPONSE");
    try {
      return JSON.parse(text);
    } catch {
      throw new PortfolioDataError("source returned non-JSON content", "INVALID_JSON");
    }
  }
  throw new PortfolioDataError("source request failed", "NETWORK");
}

async function fetchTencentPage(code, from, to, context) {
  const url =
    "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get" +
    `?param=${code},day,${from},${to},${CN_PAGE_LIMIT},`;
  const payload = await fetchJson(url, context);
  const node = payload?.data?.[code];
  if (!plainObject(node)) {
    throw new PortfolioDataError(`Tencent returned no data for ${code}`, "NO_DATA");
  }
  if (!Array.isArray(node.day)) {
    const adjusted = Object.keys(node).filter((key) => key.endsWith("day"));
    if (adjusted.length > 0) {
      throw new PortfolioDataError(
        `Tencent raw day series is absent; refusing ${adjusted.join(",")}`,
        "ADJUST_CONFLICT",
      );
    }
    return [];
  }
  return node.day;
}

async function fetchTencent(identity, from, to, context) {
  const rowsByDate = new Map();
  let cursor = to;
  for (let page = 0; page < 40; page += 1) {
    const rows = await fetchTencentPage(
      identity.upstreamSymbol,
      from,
      cursor,
      context,
    );
    if (rows.length === 0) break;
    let earliest = null;
    let added = 0;
    for (const row of rows) {
      if (!rowsByDate.has(row[0])) {
        rowsByDate.set(row[0], row);
        added += 1;
      }
      if (earliest === null || row[0] < earliest) earliest = row[0];
    }
    if (
      earliest === null ||
      earliest <= from ||
      rows.length < CN_PAGE_LIMIT ||
      added === 0
    ) {
      break;
    }
    const nextCursor = addDays(earliest, -1);
    if (nextCursor < from || nextCursor >= cursor) break;
    cursor = nextCursor;
  }
  const bars = [...rowsByDate.values()]
    .filter((row) => row[0] >= from && row[0] <= to)
    .map((row) => ({
      marketDate: row[0],
      availableAt: observationAvailableAt({
        market: "cn",
        observationDate: row[0],
      }),
      open: Number(row[1]),
      close: Number(row[2]),
      high: Number(row[3]),
      low: Number(row[4]),
      volume: Math.round(Number(row[5]) * 100),
    }));
  if (bars.length === 0) {
    throw new PortfolioDataError(`Tencent returned no bars for ${identity.symbol}`, "NO_DATA");
  }
  let name = null;
  try {
    const response = await context.fetchImpl(
      `https://qt.gtimg.cn/q=${identity.upstreamSymbol}`,
      {
        headers: { "User-Agent": USER_AGENT, Referer: "https://finance.qq.com" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.ok) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength <= MAX_BODY_BYTES) {
        name = new TextDecoder("gbk").decode(bytes).split("~")[1]?.trim() || null;
      }
    }
  } catch {
    name = null;
  }
  return { bars, name, sourceTimeZone: "Asia/Shanghai" };
}

async function fetchYahoo(identity, from, to, context) {
  // Start one day early: a London-dated FX bar for `from` is stamped 23:00Z
  // on the previous UTC day during British Summer Time and would otherwise be
  // excluded by the source. Bars are still filtered to [from, to] by marketDate.
  const period1 = Math.floor(Date.parse(`${addDays(from, -1)}T00:00:00Z`) / 1_000);
  const period2 = Math.floor(Date.parse(`${to}T23:59:59Z`) / 1_000);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(identity.upstreamSymbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplit`;
  const payload = await fetchJson(url, context, { yahoo: true });
  const result = payload?.chart?.result?.[0];
  if (!plainObject(result)) {
    throw new PortfolioDataError(
      payload?.chart?.error?.description ?? `Yahoo returned no data for ${identity.symbol}`,
      "NO_DATA",
    );
  }
  const sourceTimeZone = result.meta?.exchangeTimezoneName;
  if (typeof sourceTimeZone !== "string" || sourceTimeZone.length === 0) {
    throw new PortfolioDataError("Yahoo response lacks exchangeTimezoneName", "TIMEZONE_MISSING");
  }
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const bars = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const values = [
      quote.open?.[index],
      quote.high?.[index],
      quote.low?.[index],
      quote.close?.[index],
    ];
    if (values.some((value) => value == null || !Number.isFinite(value))) continue;
    const timestamp = new Date(timestamps[index] * 1_000).toISOString();
    const marketDate = sourceDateFromTimestamp(timestamp, sourceTimeZone);
    if (marketDate < from || marketDate > to) continue;
    bars.push({
      marketDate,
      availableAt: observationAvailableAt({
        market: identity.market,
        observationDate: marketDate,
      }),
      open: values[0],
      high: values[1],
      low: values[2],
      close: values[3],
      volume: Math.round(quote.volume?.[index] ?? 0),
    });
  }
  if (bars.length === 0) {
    throw new PortfolioDataError(`Yahoo returned no usable bars for ${identity.symbol}`, "NO_DATA");
  }
  return {
    bars,
    name: result.meta?.longName || result.meta?.shortName || identity.symbol,
    sourceTimeZone,
  };
}

function cachePaths(rootDir, symbol) {
  const directory = resolve(rootDir, RAW_DIRECTORY);
  const csv = resolve(directory, `${symbol}.csv`);
  const meta = resolve(directory, `${symbol}.meta.json`);
  if (
    dirname(csv) !== directory ||
    dirname(meta) !== directory ||
    !/^[A-Z0-9][A-Z0-9._-]{0,31}$/u.test(symbol) ||
    symbol.includes("..")
  ) {
    throw new PortfolioDataError("unsafe symbol output path", "INVALID_SYMBOL");
  }
  return { directory, csv, meta };
}

async function rejectSymlinkOutput(rootDir) {
  for (const path of [
    resolve(rootDir),
    resolve(rootDir, "data"),
    resolve(rootDir, RAW_DIRECTORY),
  ]) {
    let stat;
    try {
      stat = await lstat(path);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new PortfolioDataError(
        "portfolio output path must contain only real directories",
        "INVALID_OUTPUT_DIRECTORY",
      );
    }
  }
}

async function writeAtomic(path, content) {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function writePair(paths, csv, meta) {
  await mkdir(paths.directory, { recursive: true });
  const csvTemporary = `${paths.csv}.tmp-${process.pid}-${Date.now()}-csv`;
  const metaTemporary = `${paths.meta}.tmp-${process.pid}-${Date.now()}-meta`;
  try {
    await writeFile(csvTemporary, csv, { encoding: "utf8", flag: "wx" });
    await writeFile(metaTemporary, `${JSON.stringify(meta, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    // A crash between renames yields a detectable fingerprint mismatch, never
    // a valid-looking cache with the wrong purpose or adjustment basis.
    await rename(csvTemporary, paths.csv);
    await rename(metaTemporary, paths.meta);
  } finally {
    for (const path of [csvTemporary, metaTemporary]) {
      await unlink(path).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    }
  }
}

async function markStale(paths, existing, error, attemptedAt, dryRun) {
  const nextMeta = {
    ...existing.meta,
    stale: true,
    lastAttemptAt: attemptedAt,
    failure: {
      code: error?.code ?? "FETCH_ERROR",
      message: error?.message ?? "source fetch failed",
      ...(Number.isFinite(error?.retryAfterSeconds)
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
    },
  };
  if (!dryRun) await writeAtomic(paths.meta, `${JSON.stringify(nextMeta, null, 2)}\n`);
  return nextMeta;
}

async function syncOne(identity, options, context) {
  const paths = cachePaths(options.rootDir, identity.symbol);
  await rejectSymlinkOutput(options.rootDir);
  const existing = await loadExisting(paths, identity);
  const attemptedAt = context.now().toISOString();
  let fetched;
  try {
    fetched =
      identity.market === "cn"
        ? await fetchTencent(identity, options.from, options.to, context)
        : await fetchYahoo(identity, options.from, options.to, context);
  } catch (error) {
    if (!existing) {
      return {
        symbol: identity.symbol,
        status: "error",
        error: {
          code: error?.code ?? "FETCH_ERROR",
          message: error?.message ?? "source fetch failed",
        },
      };
    }
    await markStale(paths, existing, error, attemptedAt, options.dryRun);
    return {
      symbol: identity.symbol,
      status: "stale",
      keptPrevious: true,
      error: { code: error?.code ?? "FETCH_ERROR", message: error?.message },
    };
  }
  const fetchedBars = sanitizeBars(fetched.bars);
  if (fetchedBars.length === 0) {
    const error = new PortfolioDataError("source returned no valid bars", "NO_VALID_BARS");
    if (existing) {
      await markStale(paths, existing, error, attemptedAt, options.dryRun);
      return { symbol: identity.symbol, status: "stale", keptPrevious: true, error: { code: error.code, message: error.message } };
    }
    return { symbol: identity.symbol, status: "error", error: { code: error.code, message: error.message } };
  }
  // The fetched window replaces cached bars inside [from, to]; bars outside the
  // window are kept verbatim so an incremental sync never truncates history.
  const bars = sanitizeBars([
    ...(existing?.bars ?? []).filter(
      (bar) => bar.marketDate < options.from || bar.marketDate > options.to,
    ),
    ...fetchedBars,
  ]);
  const csv = toCsv(bars);
  const meta = {
    format: "codeshell.market-data",
    version: 1,
    symbol: identity.symbol,
    ...(identity.market === "fx"
      ? { upstreamSymbol: identity.upstreamSymbol, direction: "USD/CNY" }
      : {}),
    name: fetched.name || identity.symbol,
    market: identity.market,
    adjust: "none",
    purpose: "portfolio-valuation",
    source: expectedSource(identity.market),
    sourceTimeZone: fetched.sourceTimeZone,
    bars: bars.length,
    from: bars[0].marketDate,
    to: bars.at(-1).marketDate,
    fingerprint: fingerprintPortfolioBars(bars),
    syncedAt: attemptedAt,
    lastAttemptAt: attemptedAt,
    stale: false,
    availableAt: availableAtContract(identity.market),
  };
  if (!options.dryRun) await writePair(paths, csv, meta);
  return {
    symbol: identity.symbol,
    status: "synced",
    bars: bars.length,
    fingerprint: meta.fingerprint,
    dryRun: options.dryRun,
  };
}

export async function syncPortfolioData({
  rootDir = process.cwd(),
  symbols,
  from = "2015-01-01",
  to = new Date().toISOString().slice(0, 10),
  adjust = "none",
  purpose = "portfolio-valuation",
  outDir,
  dryRun = false,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
  minimumYahooIntervalMs = 1_000,
} = {}) {
  validateCliOptions({ adjust, purpose, outDir });
  if (!Array.isArray(symbols) || symbols.length === 0) {
    throw new PortfolioDataError("at least one --symbol is required", "INVALID_SYMBOL");
  }
  if (!isoDate(from) || !isoDate(to) || from > to) {
    throw new PortfolioDataError("--from/--to must be ordered calendar dates", "INVALID_DATE");
  }
  if (typeof fetchImpl !== "function") {
    throw new PortfolioDataError("fetch implementation is unavailable", "FETCH_UNAVAILABLE");
  }
  const identities = symbols.map(canonicalSymbol);
  const seen = new Set();
  for (const identity of identities) {
    if (seen.has(identity.symbol)) {
      throw new PortfolioDataError(`duplicate symbol ${identity.symbol}`, "DUPLICATE_SYMBOL");
    }
    seen.add(identity.symbol);
  }
  const context = {
    fetchImpl,
    now,
    sleep,
    beforeYahooRequest: yahooLimiter({
      now,
      sleep,
      minimumIntervalMs: Math.max(0, minimumYahooIntervalMs),
    }),
  };
  const results = [];
  for (const identity of identities) {
    results.push(
      await syncOne(
        identity,
        { rootDir: resolve(rootDir), from, to, dryRun: Boolean(dryRun) },
        context,
      ),
    );
  }
  return results;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new PortfolioDataError(`unexpected argument ${token}`, "INVALID_ARGUMENT");
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      [
        "Usage: node app/tools/fetch-portfolio-data.mjs --symbol <SH600519|AAPL|USDCNY> [options]",
        "",
        "  --symbol    one symbol or a comma-separated list (required)",
        "  --from      YYYY-MM-DD (default 2015-01-01)",
        "  --to        YYYY-MM-DD (default today)",
        "  --adjust    only none is accepted",
        "  --purpose   only portfolio-valuation is accepted",
        "  --dry-run   fetch and validate without writing files",
        "",
        "Output is fixed to data/market-raw; --out-dir is rejected.",
      ].join("\n") + "\n",
    );
    return;
  }
  const symbols =
    typeof args.symbol === "string"
      ? args.symbol.split(",").map((value) => value.trim())
      : [];
  const results = await syncPortfolioData({
    rootDir: process.cwd(),
    symbols,
    from: typeof args.from === "string" ? args.from : undefined,
    to: typeof args.to === "string" ? args.to : undefined,
    adjust: typeof args.adjust === "string" ? args.adjust : "none",
    purpose:
      typeof args.purpose === "string"
        ? args.purpose
        : "portfolio-valuation",
    ...(Object.prototype.hasOwnProperty.call(args, "out-dir")
      ? { outDir: args["out-dir"] }
      : {}),
    dryRun: args["dry-run"] === true,
  });
  for (const result of results) process.stdout.write(`${JSON.stringify(result)}\n`);
  if (results.some((result) => result.status === "error")) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`error: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  });
}
