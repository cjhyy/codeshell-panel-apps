// Read-only quotes for the actual portfolio; never writes the transaction ledger.
import { fetchTencentStockQuote } from "./fetch-a-share-stock.mjs";
import { syncPortfolioData } from "./fetch-portfolio-data.mjs";
import { fetchYahooHoldingQuote } from "./fetch-us-stock.mjs";

import { normalizeQuoteV2 } from "../quote-contract.mjs";
import { runQuoteRound } from "../quote-round-core.mjs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCollector } from "./collector-lock.mjs";

export async function fetchHoldingQuotes(items, { cn = fetchTencentStockQuote, us = fetchYahooHoldingQuote, now = () => new Date(), ...roundOptions } = {}) {
  if (!Array.isArray(items) || items.length > 200 || items.some((item) => !item || !["cn", "us"].includes(item.market) || !(item.market === "cn" ? /^(SH|SZ)\d{6}$/u : /^[A-Z][A-Z0-9.-]{0,14}$/u).test(item.symbol))) throw new Error("持仓行情代码无效");
  const result = await runQuoteRound(items, { ...roundOptions, fetchQuote: async (item, signal) => {
    const quote = await (item.market === "cn" ? cn(item.symbol, { attempts: 1, signal }) : us(item.symbol, { signal }));
    return normalizeQuoteV2(quote, { ...item, now: now() });
  } });
  return { kind: "holding-quotes", contract: 2, ...result, fetchedAt: now().toISOString() };
}

export async function runCli(argv = process.argv.slice(2)) {
  return runCollector("holding-quotes", argv, () => runCliUnlocked(argv));
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
