#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildUsStockDetailSnapshot,
  canonicalUsSymbol,
  resolveYahooStockSuggestion,
} from "../us-stock-detail.mjs";
import { readLocalSnapshot, writeLocalSnapshot } from "./local-snapshot-store.mjs";

const YAHOO_ORIGIN = "https://query1.finance.yahoo.com";
const USER_AGENT = "QuantLab/0.32 US stock detail";
const TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 2_000_000;

class UsStockFetchError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function cleanText(value, maximum = 240) {
  return String(value ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, maximum);
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
    else throw new UsStockFetchError("ARGUMENT_UNKNOWN", `unknown argument: ${argument}`);
  }
  if (!options.help && !options.query) throw new UsStockFetchError("QUERY_REQUIRED", "--query is required");
  return options;
}

async function fetchJson(url) {
  const parsed = new URL(url);
  if (parsed.origin !== YAHOO_ORIGIN || parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new UsStockFetchError("SOURCE_URL_UNSAFE", "unexpected Yahoo source URL");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(parsed, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new UsStockFetchError("SOURCE_HTTP", `Yahoo Finance 返回 HTTP ${response.status}`);
    if (new URL(response.url).origin !== YAHOO_ORIGIN) throw new UsStockFetchError("SOURCE_REDIRECT", "Yahoo source escaped allowlist");
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new UsStockFetchError("SOURCE_TOO_LARGE", "美股行情返回过大");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new UsStockFetchError("SOURCE_TOO_LARGE", "美股行情返回过大");
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error?.name === "AbortError") throw new UsStockFetchError("SOURCE_TIMEOUT", "Yahoo Finance 请求超时");
    if (error instanceof SyntaxError) throw new UsStockFetchError("SOURCE_SHAPE", "Yahoo Finance 返回了无效 JSON");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function yahooSearchUrl(query) {
  const url = new URL("/v1/finance/search", YAHOO_ORIGIN);
  url.searchParams.set("q", cleanText(query, 80));
  url.searchParams.set("quotesCount", "10");
  url.searchParams.set("newsCount", "0");
  return url;
}

export function yahooChartUrl(symbol) {
  const canonical = canonicalUsSymbol(symbol);
  if (!canonical) throw new UsStockFetchError("SYMBOL_INVALID", "美股代码无效");
  const url = new URL(`/v8/finance/chart/${encodeURIComponent(canonical)}`, YAHOO_ORIGIN);
  url.searchParams.set("range", "1y");
  url.searchParams.set("interval", "1d");
  url.searchParams.set("events", "div,splits");
  return url;
}

async function resolveQuery(query) {
  const payload = await fetchJson(yahooSearchUrl(query));
  return resolveYahooStockSuggestion(payload, query);
}

export async function buildUsStockSnapshot(query, nowInput = new Date()) {
  const identity = await resolveQuery(query);
  const payload = await fetchJson(yahooChartUrl(identity.symbol));
  const chartError = payload?.chart?.error;
  if (chartError) throw new UsStockFetchError("CHART_ERROR", cleanText(chartError.description, 200) || "Yahoo Finance 没有返回行情");
  return buildUsStockDetailSnapshot(payload, identity, nowInput);
}

export async function runCli(argv = process.argv.slice(2), nowInput = new Date()) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write("Usage: node fetch-us-stock.mjs --query <name-or-ticker> --stdout [--persist-local|--read-local]\n");
    return { ok: true, help: true };
  }
  if (!options.stdout) throw new UsStockFetchError("STDOUT_REQUIRED", "--stdout is required");
  if (options.readLocal) {
    const symbol = canonicalUsSymbol(options.query);
    if (!symbol) throw new UsStockFetchError("READ_SYMBOL_REQUIRED", "读取本地美股数据需要股票代码");
    const snapshot = await readLocalSnapshot({ stream: "us-stock", scope: `US-${symbol}` });
    process.stdout.write(`${JSON.stringify(snapshot)}\n`);
    return snapshot;
  }
  const snapshot = await buildUsStockSnapshot(options.query, nowInput);
  if (options.persistLocal) await writeLocalSnapshot({ stream: "us-stock", scope: `US-${snapshot.stock.symbol}`, snapshot });
  process.stdout.write(`${JSON.stringify(snapshot)}\n`);
  return snapshot;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      errorCode: error?.code ?? "US_STOCK_DETAIL_ERROR",
      message: error instanceof Error ? error.message : "US stock detail failed",
    })}\n`);
    process.exitCode = 1;
  });
}
