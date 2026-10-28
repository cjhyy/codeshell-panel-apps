#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { fetchHoldingQuotes } from "./fetch-holding-quotes.mjs";
import { isQuoteV2 } from "../quote-contract.mjs";

export function marketServiceConfig(input) {
  if (input?.format !== "quant.market-feed.config/1" || !Array.isArray(input.subscriptions) || input.subscriptions.length > 200) throw new Error("MARKET_CONFIG_INVALID");
  const subscriptions = [...new Map(input.subscriptions.map((item) => {
    if (!item || !["cn", "us"].includes(item.market) || !(item.market === "cn" ? /^(SH|SZ)\d{6}$/u : /^[A-Z][A-Z0-9.-]{0,14}$/u).test(item.symbol)) throw new Error("MARKET_SUBSCRIPTION_INVALID");
    // Only public symbol identities enter config; no ledger, credential or account.
    return [`${item.market}:${item.symbol}`, { market: item.market, symbol: item.symbol }];
  })).values()];
  return { format: input.format, subscriptions, cadenceMs: Math.min(300000, Math.max(15000, Number(input.cadence?.open) || 15000)), closedCadenceMs: Math.min(900000, Math.max(300000, Number(input.cadence?.closed) || 300000)) };
}
export function serviceCadence(config, now) {
  const isOpen = (market) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: market === "cn" ? "Asia/Shanghai" : "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((part) => [part.type, part.value]));
    if (["Sat", "Sun"].includes(parts.weekday)) return false;
    const minute = Number(parts.hour) * 60 + Number(parts.minute);
    return market === "cn" ? (minute >= 555 && minute <= 690) || (minute >= 780 && minute <= 905) : minute >= 570 && minute <= 965;
  };
  return config.subscriptions.some((item) => isOpen(item.market)) ? config.cadenceMs : config.closedCadenceMs;
}
export function createMarketService({ send, collect = fetchHoldingQuotes, schedule = setTimeout, unschedule = clearTimeout, now = () => new Date() } = {}) {
  let config, items = {}, cursor = 0, roundId = 0, timer, active = null, controller, closed = false, hello = false, pending = false;
  async function run() {
    if (closed || !config) return;
    if (active) { pending = true; return active; }
    controller = new AbortController();
    const selected = config.subscriptions;
    const allowed = new Set(selected.map((item) => `${item.market}:${item.symbol}`));
    items = Object.fromEntries(Object.entries(items).filter(([key]) => allowed.has(key)));
    active = (async () => {
      await collect(selected, { cursor, roundId: ++roundId, signal: controller.signal, onBatch: async ({ quotes, round }) => {
        if (closed) return;
        const currentKeys = new Set(config.subscriptions.map((item) => `${item.market}:${item.symbol}`));
        items = Object.fromEntries(Object.entries(items).filter(([key]) => currentKeys.has(key)));
        for (const quote of quotes) {
          const key = `${quote.market}:${quote.symbol}`;
          if (isQuoteV2(quote) && currentKeys.has(key) && (!items[key] || Date.parse(quote.asOf) >= Date.parse(items[key].asOf))) items[key] = quote;
        }
        cursor = round.cursor;
        await send({ t: "publish", channel: "quotes", value: { format: "quant.quotes/2", round, items } });
      } });
    })();
    try { await active; } finally {
      active = null;
      if (!closed) {
        const again = pending; pending = false;
        timer = schedule(() => { void run().catch(fail); }, again ? 1000 : serviceCadence(config, now()));
      }
    }
  }
  async function fail(error) { await send({ t: "progress", message: String(error.message).slice(0, 240) }); }
  async function close() {
    if (closed) return;
    closed = true; unschedule(timer); controller?.abort();
    await active?.catch(() => undefined);
    await send({ t: "drained" });
  }
  return {
    async receive(message) {
      if (closed) return;
      if (message.t === "hello") {
        if (hello || message.protocol !== 1) throw new Error("MARKET_PROTOCOL_INVALID");
        hello = true;
        config = marketServiceConfig(message.config?.format ? message.config : { format: "quant.market-feed.config/1", subscriptions: [] });
        const last = message.last?.quotes;
        if (last?.format === "quant.quotes/2") {
          items = Object.fromEntries(Object.entries(last.items ?? {}).filter(([, value]) => isQuoteV2(value)).slice(0, 200));
          cursor = Number.isSafeInteger(last.round?.cursor) ? last.round.cursor : 0;
          roundId = Number.isSafeInteger(last.round?.roundId) ? last.round.roundId : 0;
        }
        await send({ t: "ready" });
        void run().catch(fail);
      } else if (!hello) throw new Error("MARKET_HELLO_REQUIRED");
      else if (message.t === "config") { config = marketServiceConfig(message.config); unschedule(timer); void run().catch(fail); }
      else if (message.t === "poke") { unschedule(timer); void run().catch(fail); }
      else if (message.t === "drain") await close();
      else throw new Error("MARKET_MESSAGE_INVALID");
    }, close,
  };
}
export async function runService(input = process.stdin, output = process.stdout) {
  const service = createMarketService({ send: async (value) => {
    if (!output.write(`${JSON.stringify(value)}\n`)) await once(output, "drain");
  } });
  let buffer = "";
  try {
    for await (const chunk of input) {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer) > 1048576) throw new Error("MARKET_INPUT_TOO_LARGE");
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        const message = JSON.parse(line);
        await service.receive(message);
        // A drain receipt means all work has settled. Exit the stdin iterator
        // instead of forcing the Host to wait for its termination deadline.
        if (message.t === "drain") return;
      }
    }
  } finally { await service.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runService().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
