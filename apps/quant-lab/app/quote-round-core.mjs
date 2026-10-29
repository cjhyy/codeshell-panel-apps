// Shared by the reviewed worker and short fallback rounds. Providers receive
// cancellation; a rejected or timed-out source never holds the whole round.
export function quoteSubscription(item) {
  if (!item || !["cn", "us"].includes(item.market) || typeof item.symbol !== "string" ||
      !(item.market === "cn" ? /^(SH|SZ)\d{6}$/u : /^[A-Z][A-Z0-9.-]{0,14}$/u).test(item.symbol)) return null;
  return { market: item.market, symbol: item.symbol };
}

export function normalizeQuoteSubscriptions(items) {
  if (!Array.isArray(items) || items.length > 200) throw new Error("QUOTE_SUBSCRIPTIONS_INVALID");
  const valid = new Map(), errors = [];
  for (const item of items) {
    const subscription = quoteSubscription(item);
    if (subscription) valid.set(`${subscription.market}:${subscription.symbol}`, subscription);
    else errors.push({ symbol: typeof item?.symbol === "string" ? item.symbol.slice(0, 64) : null,
      market: ["cn", "us"].includes(item?.market) ? item.market : null,
      code: "QUOTE_SUBSCRIPTION_INVALID", message: "行情代码不受当前市场契约支持" });
  }
  return { subscriptions: [...valid.values()], errors };
}

export async function runQuoteRound(items, { fetchQuote, cursor = 0, roundId = 1, batchSize = 4, batchDeadlineMs = 8000, perSourceMs = 6000, roundBudgetMs = 30000, now = () => Date.now(), signal, onBatch = async () => {}, deadline = timed } = {}) {
  const { subscriptions: unique, errors } = normalizeQuoteSubscriptions(items);
  batchSize = Math.min(4, Math.max(1, Number.isInteger(batchSize) ? batchSize : 4));
  cursor = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
  const ordered = unique.length ? [...unique.slice(cursor % unique.length), ...unique.slice(0, cursor % unique.length)] : [];
  const started = now();
  const quotes = [];
  let visited = 0, interrupted = 0;
  // Removing the final subscription must commit an empty snapshot too; otherwise
  // the Host would retain the last subscribed symbols indefinitely.
  if (!ordered.length && !signal?.aborted) await onBatch({ quotes: [], errors: [...errors], round: { roundId, cursor: 0, pending: 0, succeeded: 0, failed: errors.length } });
  for (let offset = 0; offset < ordered.length && now() - started < roundBudgetMs && !signal?.aborted; offset += batchSize) {
    const batch = ordered.slice(offset, offset + Math.min(4, Math.max(1, batchSize)));
    const remaining = roundBudgetMs - (now() - started);
    const sourceDeadline = Math.min(perSourceMs, batchDeadlineMs);
    const budget = Math.min(sourceDeadline, remaining);
    const results = await Promise.all(batch.map(async (item) => {
      try { return { quote: await deadline((requestSignal) => fetchQuote(item, requestSignal), budget, signal) }; }
      catch (error) {
        const code = error?.code ?? error?.message;
        if (code === "QUOTE_ABORTED" || code === "QUOTE_DEADLINE" && remaining < sourceDeadline) return { pending: true };
        return { error: { symbol: item.symbol, market: item.market, message: String(error?.message ?? error).slice(0, 240) } };
      }
    }));
    for (const result of results) { if (result.quote) quotes.push(result.quote); else if (result.pending) interrupted++; else errors.push(result.error); }
    visited += batch.length;
    await onBatch({ quotes: [...quotes], errors: [...errors], round: { roundId, cursor: unique.length ? (cursor + visited) % unique.length : 0, pending: ordered.length - visited + interrupted, succeeded: quotes.length, failed: errors.length } });
  }
  return { quotes, errors, round: { roundId, cursor: unique.length ? (cursor + visited) % unique.length : 0, pending: ordered.length - visited + interrupted, succeeded: quotes.length, failed: errors.length } };
}
export function timed(work, ms, signal) {
  const controller = new AbortController();
  let timer, cancel;
  return Promise.race([
    Promise.resolve().then(() => { if (signal?.aborted) throw new Error("QUOTE_ABORTED"); return work(controller.signal); }),
    new Promise((_, reject) => {
      cancel = () => { controller.abort(); reject(new Error("QUOTE_ABORTED")); };
      timer = setTimeout(() => { controller.abort(); reject(new Error("QUOTE_DEADLINE")); }, Math.max(0, ms));
      signal?.addEventListener("abort", cancel, { once: true });
    }),
  ]).finally(() => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); });
}
