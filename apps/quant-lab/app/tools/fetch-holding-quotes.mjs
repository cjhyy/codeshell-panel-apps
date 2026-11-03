// Read-only quotes for the actual portfolio; never writes the transaction ledger.
import { fetchTencentStockQuote } from "./fetch-a-share-stock.mjs";
import { canonicalSymbol, syncPortfolioData } from "./fetch-portfolio-data.mjs";
import { fetchYahooHoldingQuote } from "./fetch-us-stock.mjs";

import { normalizeQuoteV2 } from "../quote-contract.mjs";
import { normalizeQuoteSubscriptions, runQuoteRound } from "../quote-round-core.mjs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCollector } from "./collector-lock.mjs";

export async function fetchHoldingQuotes(items, { cn = fetchTencentStockQuote, us = fetchYahooHoldingQuote, now = () => new Date(), ...roundOptions } = {}) {
  const result = await runQuoteRound(items, { ...roundOptions, fetchQuote: async (item, signal) => {
    const quote = await (item.market === "cn" ? cn(item.symbol, { attempts: 1, signal }) : us(item.symbol, { signal }));
    return normalizeQuoteV2(quote, { ...item, now: now() });
  } });
  return { kind: "holding-quotes", contract: 2, ...result, fetchedAt: now().toISOString() };
}

export function collectorRequestIdentity(argv) {
  const input = JSON.parse(argv[0] ?? "[]");
  if (input?.mode === "history") {
    if (!Array.isArray(input.symbols) || input.symbols.length !== 1) throw new Error("每次补齐一个标的的历史行情");
    return { mode: "history", symbol: canonicalSymbol(input.symbols[0]).symbol,
      from: input.from === undefined ? "2015-01-01" : input.from,
      to: input.to === undefined ? new Date().toISOString().slice(0, 10) : input.to };
  }
  const { subscriptions: identities } = normalizeQuoteSubscriptions(input);
  return { mode: "quotes", items: identities.sort((a, b) => `${a.market}:${a.symbol}`.localeCompare(`${b.market}:${b.symbol}`)) };
}

export async function runCli(argv = process.argv.slice(2)) {
  return runCollector("holding-quotes", argv, (args) => runCliUnlocked(args), { normalizeRequest: collectorRequestIdentity });
}
async function runCliUnlocked(argv) {
  const input = JSON.parse(argv[0] ?? "[]");
  if (input?.mode === "history") {
    if (!Array.isArray(input.symbols) || input.symbols.length !== 1) throw new Error("每次补齐一个标的的历史行情");
    const results = await syncPortfolioData({ symbols: input.symbols, from: input.from, to: input.to,
      dryRun: true, includeData: true });
    process.stdout.write(`${JSON.stringify({ kind: "holding-history", results })}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(await fetchHoldingQuotes(input))}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
