// Shared by the reviewed worker and short fallback rounds. Providers receive
// cancellation; a rejected or timed-out source never holds the whole round.
export async function runQuoteRound(items, { fetchQuote, cursor = 0, roundId = 1, batchSize = 4, batchDeadlineMs = 8000, perSourceMs = 6000, roundBudgetMs = 30000, now = () => Date.now(), signal, onBatch = async () => {}, deadline = timed } = {}) {
  if (!Array.isArray(items) || items.length > 200) throw new Error("QUOTE_SUBSCRIPTIONS_INVALID");
  batchSize = Math.min(4, Math.max(1, Number.isInteger(batchSize) ? batchSize : 4));
  cursor = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
  const unique = [...new Map(items.map((item) => [`${item.market}:${item.symbol}`, item])).values()];
  const ordered = unique.length ? [...unique.slice(cursor % unique.length), ...unique.slice(0, cursor % unique.length)] : [];
  const started = now();
  const quotes = [], errors = [];
  let visited = 0;
  // Removing the final subscription must commit an empty snapshot too; otherwise
  // the Host would retain the last subscribed symbols indefinitely.
  if (!ordered.length && !signal?.aborted) await onBatch({ quotes: [], errors: [], round: { roundId, cursor: 0, pending: 0, succeeded: 0, failed: 0 } });
  for (let offset = 0; offset < ordered.length && now() - started < roundBudgetMs && !signal?.aborted; offset += batchSize) {
    const batch = ordered.slice(offset, offset + Math.min(4, Math.max(1, batchSize)));
    const budget = Math.min(perSourceMs, batchDeadlineMs, roundBudgetMs - (now() - started));
    const results = await Promise.all(batch.map(async (item) => {
      try { return { quote: await deadline((requestSignal) => fetchQuote(item, requestSignal), budget, signal) }; }
      catch (error) { return { error: { symbol: item.symbol, market: item.market, message: String(error?.message ?? error).slice(0, 240) } }; }
    }));
    for (const result of results) { if (result.quote) quotes.push(result.quote); else errors.push(result.error); }
    visited += batch.length;
    await onBatch({ quotes: [...quotes], errors: [...errors], round: { roundId, cursor: unique.length ? (cursor + visited) % unique.length : 0, pending: ordered.length - visited, succeeded: quotes.length, failed: errors.length } });
  }
  return { quotes, errors, round: { roundId, cursor: unique.length ? (cursor + visited) % unique.length : 0, pending: ordered.length - visited, succeeded: quotes.length, failed: errors.length } };
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
