// Read-only quotes for the actual portfolio; never writes the transaction ledger.
import { fetchTencentStockQuote } from "./fetch-a-share-stock.mjs";
import { syncPortfolioData } from "./fetch-portfolio-data.mjs";
import { fetchYahooHoldingQuote } from "./fetch-us-stock.mjs";

export async function fetchHoldingQuotes(items, {
  cn = fetchTencentStockQuote,
  us = fetchYahooHoldingQuote,
  now = () => new Date(),
} = {}) {
  if (!Array.isArray(items) || items.length > 100) throw new Error("持仓行情最多支持 100 个标的");
  const unique = new Map();
  for (const item of items) {
    if (!item || !(item.market === "cn" ? /^(SH|SZ)\d{6}$/u : /^[A-Z][A-Z0-9.-]{0,14}$/u).test(item.symbol) ||
        !["cn", "us"].includes(item.market)) throw new Error("持仓行情代码无效");
    unique.set(`${item.market}:${item.symbol}`, item);
  }
  const pending = [...unique.values()];
  const quotes = [];
  const errors = [];
  // Four bounded workers avoid one request per account and unbounded fan-out.
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (pending.length) {
      const item = pending.shift();
      try {
        const quote = await (item.market === "cn" ? cn(item.symbol, { attempts: 1 }) : us(item.symbol));
        if (quote.symbol !== item.symbol || !Number.isFinite(quote.price) || quote.price <= 0 ||
            !Number.isFinite(Date.parse(quote.asOf)) || Date.parse(quote.asOf) > now().getTime() + 60_000) {
          throw new Error("报价身份、价格或时间无效");
        }
        quotes.push({ symbol: item.symbol, market: item.market, price: String(quote.price), asOf: quote.asOf,
          source: item.market === "cn" ? "腾讯证券" : "Yahoo Finance" });
      } catch (error) {
        errors.push({ symbol: item.symbol, message: String(error?.message ?? "行情读取失败").slice(0, 240) });
      }
    }
  }));
  return { kind: "holding-quotes", quotes, errors, fetchedAt: now().toISOString() };
}

export async function runCli(argv = process.argv.slice(2)) {
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
