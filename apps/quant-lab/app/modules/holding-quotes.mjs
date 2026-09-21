import { chinaMarketClock } from "./a-share-session.mjs";

const LAUNCHER = [
  'import { join } from "node:path";',
  'import { pathToFileURL } from "node:url";',
  'const home = process.env.HOME || process.env.USERPROFILE;',
  'if (!home) throw new Error("user-home-unavailable");',
  'const tool = join(home, ".code-shell", "panel-apps", "quant-lab", "app", "tools", "fetch-holding-quotes.mjs");',
  'const module = await import(pathToFileURL(tool).href);',
  'await module.runCli([process.argv.at(-1)]);',
].join("\n");

// Follow the existing Quant Lab read-only quote runtime, with listeners scoped
// to this request, a hard output bound, cancellation and late-result rejection.
export function createHoldingQuoteRequest({ hostCall, onHostEvent, maxOutputChars = 128_000 }) {
  let cancel = () => {};
  return {
    cancel: () => cancel(),
    async fetch(items) {
      if (typeof onHostEvent !== "function") throw new Error("自动行情需要在投资工作台内运行");
      let processId = null;
      let stopped = false;
      let finish;
      const early = [];
      let earlyBytes = 0;
      let stdout = "";
      let stderr = "";
      const result = new Promise((resolve, reject) => { finish = (error) => error ? reject(error) : resolve(stdout); });
      // Attach a rejection handler before any asynchronous Host setup.
      void result.catch(() => {});
      const stop = (message) => {
        stopped = true;
        if (processId) void hostCall("process.cancel", { processId }).catch(() => {});
        finish(new Error(message));
      };
      const cancelThis = () => stop("已停止持仓行情刷新");
      cancel = cancelThis;
      const receive = (kind, payload) => {
        if (stopped) return;
        if (!processId) {
          earlyBytes += typeof payload?.text === "string" ? payload.text.length : 0;
          if (earlyBytes > maxOutputChars || early.length >= 128) { stop("持仓行情输出过大"); return; }
          early.push([kind, payload]);
          return;
        }
        if (payload?.processId !== processId) return;
        if (kind === "output") {
          if (payload.stream === "stdout") stdout += payload.text ?? "";
          if (payload.stream === "stderr") stderr += payload.text ?? "";
          if (stdout.length + stderr.length > maxOutputChars) stop("持仓行情输出过大");
        } else finish(payload.code === 0 ? null : new Error(stderr.trim().slice(0, 200) || "持仓行情读取失败"));
      };
      const offOutput = onHostEvent("process.output", (value) => receive("output", value));
      const offExit = onHostEvent("process.exit", (value) => receive("exit", value));
      const timeout = setTimeout(() => stop("持仓行情刷新超时"), 60_000);
      try {
        let runtime;
        for (const name of ["node", "nodejs", "bun"]) {
          const executable = await hostCall("process.find", { name });
          if (stopped) throw new Error("已停止持仓行情刷新");
          if (executable?.available && executable.handle) { runtime = { name, handle: executable.handle }; break; }
        }
        if (!runtime) throw new Error("未找到行情运行环境");
        const directory = await hostCall("filesystem.getKnownDirectory", { name: "app-data" });
        if (stopped) throw new Error("已停止持仓行情刷新");
        const started = await hostCall("process.spawn", {
          executableHandle: runtime.handle,
          directoryHandle: directory.handle,
          args: [...(runtime.name === "bun" ? [] : ["--input-type=module"]), "--eval", LAUNCHER, JSON.stringify(items)],
        });
        processId = started?.processId;
        if (!processId) throw new Error("持仓行情程序未能启动");
        if (stopped) { stop("已停止持仓行情刷新"); throw new Error("已停止持仓行情刷新"); }
        for (const [kind, payload] of early) receive(kind, payload);
        return JSON.parse(await result);
      } finally {
        stopped = true;
        clearTimeout(timeout);
        offOutput?.();
        offExit?.();
        if (cancel === cancelThis) cancel = () => {};
      }
    },
  };
}

export function holdingQuoteDelay(items, now) {
  const cn = chinaMarketClock(now);
  const us = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const minute = Number(us.hour) * 60 + Number(us.minute);
  const cnOpen = cn.weekday && ((cn.minutes >= 9 * 60 + 15 && cn.minutes <= 11 * 60 + 30) ||
    (cn.minutes >= 13 * 60 && cn.minutes <= 15 * 60 + 5));
  const usOpen = !["Sat", "Sun"].includes(us.weekday) && minute >= 9 * 60 + 30 && minute <= 16 * 60 + 5;
  return items.some((item) => item.market === "cn" ? cnOpen : usOpen) ? 15_000 : 5 * 60_000;
}

export function createHoldingQuoteController({ request, symbols, onUpdate, now = () => new Date(),
  schedule = setTimeout, unschedule = clearTimeout }) {
  let active = false;
  let timer = null;
  let generation = 0;
  let flight = null;
  let quotes = new Map();
  let failures = 0;
  const clear = () => { if (timer !== null) unschedule(timer); timer = null; };
  async function refresh() {
    if (flight) return flight;
    clear();
    const items = symbols();
    if (!items.length) return;
    const token = generation;
    const expected = new Map(items.map((item) => [item.symbol, item.market]));
    flight = (async () => {
      try {
        const value = await request.fetch(items);
        if (token !== generation) return;
        if (value?.kind !== "holding-quotes" || !Array.isArray(value.quotes) || value.quotes.length > 100) throw new Error("持仓行情格式无效");
        let updated = 0;
        for (const quote of value.quotes) {
          if (expected.get(quote.symbol) !== quote.market || typeof quote.price !== "string" ||
              !/^(0|[1-9]\d*)(\.\d{1,12})?$/u.test(quote.price) || !Number.isFinite(Number(quote.price)) || Number(quote.price) <= 0 ||
              !Number.isFinite(Date.parse(quote.asOf)) || Date.parse(quote.asOf) > now().getTime() + 60_000) continue;
          const previous = quotes.get(quote.symbol);
          if (previous && Date.parse(previous.asOf) > Date.parse(quote.asOf)) continue;
          quotes.set(quote.symbol, { ...quote, source: quote.market === "cn" ? "腾讯证券" : "Yahoo Finance" });
          updated += 1;
        }
        failures = updated === expected.size ? 0 : failures + 1;
        onUpdate(new Map(quotes), { failed: updated < expected.size, message: updated < expected.size ? "部分报价未更新，保留上次价格" : "" });
      } catch (error) {
        if (token !== generation) return;
        failures += 1;
        onUpdate(new Map(quotes), { failed: true, message: error.message ?? "行情读取失败" });
      } finally {
        if (token === generation) {
          flight = null;
          if (active) timer = schedule(() => void refresh(), Math.min(300_000, holdingQuoteDelay(items, now()) * 2 ** Math.min(failures, 4)));
        }
      }
    })();
    return flight;
  }
  return {
    refresh,
    setActive(value) {
      const changed = active !== value;
      active = value;
      if (!value) { clear(); return; }
      if (changed) void refresh();
    },
    reset() {
      generation += 1;
      clear();
      request.cancel();
      flight = null;
      quotes = new Map();
      failures = 0;
    },
  };
}
