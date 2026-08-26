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

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const TIMEOUT_MS = 30_000;
const CN_ADJUST = new Set(["qfq", "hfq", "none"]);
const US_ADJUST = new Set(["adj", "none"]);

class FetchError extends Error {}

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

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json,text/plain,*/*" },
      signal: controller.signal,
    });
    if (!response.ok) throw new FetchError(`HTTP ${response.status} from ${new URL(url).host}`);
    const text = await response.text();
    if (!text.trim()) throw new FetchError(`empty response from ${new URL(url).host}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new FetchError(`non-JSON response from ${new URL(url).host}`);
    }
  } catch (error) {
    if (error.name === "AbortError") throw new FetchError(`timeout after ${TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Tencent returns [date, open, close, high, low, volume] -- close precedes high.
// It hard-caps each response at 640 bars regardless of the count parameter, so
// long ranges are paged backward from `to` until the window is covered.
const CN_PAGE_LIMIT = 640;

async function fetchCnPage(code, from, to, adjust) {
  const fq = adjust === "none" ? "" : adjust;
  const url =
    `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get` +
    `?param=${code},day,${from},${to},${CN_PAGE_LIMIT},${fq}`;
  const payload = await getJson(url);
  const node = payload?.data?.[code];
  if (!node || Array.isArray(node)) {
    throw new FetchError(`no data for ${code} (delisted or wrong symbol?)`);
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
      `upstream returned no "${key}" series for ${code}` +
        (available.length ? ` (available: ${available.join(", ")})` : "") +
        `; refusing to substitute a different adjustment basis`,
    );
  }
  return Array.isArray(rows) ? rows : [];
}

async function fetchCn(symbol, from, to, adjust) {
  const code = cnPrefixed(symbol);
  const collected = new Map();
  let cursor = to;

  // Each page ends at `cursor`; step back to the day before its earliest bar.
  for (let page = 0; page < 40; page += 1) {
    const rows = await fetchCnPage(code, from, cursor, adjust);
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

  if (collected.size === 0) throw new FetchError(`no bars for ${code} in ${from}..${to}`);

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

async function fetchUs(symbol, from, to, adjust) {
  const p1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
  const p2 = Math.floor(Date.parse(`${to}T23:59:59Z`) / 1000);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplit`;
  const payload = await getJson(url);
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
async function fetchDisplayName(market, slug) {
  try {
    if (market === "cn") {
      const code = slug.toLowerCase();
      const response = await fetch(`https://qt.gtimg.cn/q=${code}`, {
        headers: { "User-Agent": UA, Referer: "https://finance.qq.com" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;
      // The quote feed is GBK-encoded; decode explicitly or names arrive as
      // replacement characters.
      const text = new TextDecoder("gbk").decode(await response.arrayBuffer());
      return text.split("~")[1]?.trim() || null;
    }
    const response = await fetch(
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      [
        "Usage: node tools/fetch-market-data.mjs --symbol <SYM> --market <cn|us> [options]",
        "",
        "  --symbol   600519 | sh600519 | AAPL          (required)",
        "  --market   cn | us                            (default: inferred)",
        "  --adjust   cn: qfq|hfq|none  us: adj|none     (default: qfq / adj)",
        "  --from     YYYY-MM-DD                         (default: 2015-01-01)",
        "  --to       YYYY-MM-DD                         (default: today)",
        "  --out-dir  output directory                   (default: data/market)",
      ].join("\n"),
    );
    return;
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
  const to = typeof args.to === "string" ? args.to : today();
  if (!isoDate(from) || !isoDate(to)) throw new FetchError("--from/--to must be YYYY-MM-DD");
  if (from > to) throw new FetchError("--from must not be after --to");

  const outDir = resolve(typeof args["out-dir"] === "string" ? args["out-dir"] : "data/market");
  const slug = market === "cn" ? cnPrefixed(symbol).toUpperCase() : symbol.toUpperCase();
  // The slug becomes a filename; reject anything that could traverse outDir.
  if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(slug) || slug.includes("..")) {
    throw new FetchError(`unsafe symbol for a filename: ${JSON.stringify(symbol)}`);
  }
  const csvPath = join(outDir, `${slug}.csv`);
  const metaPath = join(outDir, `${slug}.meta.json`);

  process.stderr.write(`fetching ${slug} (${market}/${adjust}) ${from}..${to}\n`);
  const raw = market === "cn" ? await fetchCn(symbol, from, to, adjust) : await fetchUs(symbol, from, to, adjust);
  const { bars, dropped } = sanitize(raw);
  if (bars.length < 3) throw new FetchError(`only ${bars.length} valid bars; need at least 3`);

  const displayName = await fetchDisplayName(market, slug);
  const csv = toCsv(bars);
  await mkdir(dirname(csvPath), { recursive: true });

  // Never silently overwrite a differently-adjusted file under the same name.
  let previous = null;
  let previousUnreadable = false;
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

  // Write the sidecar first, then the CSV. A crash between the two leaves a
  // sidecar describing data that was never written (detectable via fingerprint
  // mismatch) rather than a new CSV wearing the previous basis label.
  await writeFile(
    metaPath,
    `${JSON.stringify(
      {
        format: "codeshell.quant-dataset",
        version: 1,
        symbol: slug,
        name: displayName,
        market,
        adjust,
        source: market === "cn" ? "tencent-ifzq" : "yahoo-finance",
        syncedAt: new Date().toISOString(),
        bars: bars.length,
        from: bars[0].date,
        to: bars.at(-1).date,
        fingerprint: fingerprintBars(bars),
        dropped,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(csvPath, csv, "utf8");

  const droppedTotal = dropped.duplicate + dropped.nonPositive + dropped.inconsistent;
  console.log(`${csvPath}${displayName ? `  (${displayName})` : ""}`);
  console.log(
    `  ${bars.length} bars  ${bars[0].date}..${bars.at(-1).date}  adjust=${adjust}` +
      (droppedTotal ? `  (dropped ${droppedTotal})` : ""),
  );
  if (adjust === "none") {
    console.log("  WARNING: unadjusted prices. Splits/dividends will distort backtest results.");
  }
}

main().catch((error) => {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = 1;
});
