import { isQuoteV2 } from "../quote-contract.mjs";

export const QUOTE_READ_FORMATS = new Set(["quant.quotes/2"]);
export const QUOTE_WRITE_FORMATS = new Set(["quant.quotes/2"]);
const NAME = "market-feed";
const KEY = "quant.quotes.v2";
const REQUIRED = ["get", "read", "attach", "detach", "configure", "setDesired", "control"];
const id = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function supportsMarketService(context) {
  return context?.capabilities?.services?.version === 1 && Array.isArray(context.availableMethods) &&
    REQUIRED.every(name => context.availableMethods.includes(`services.${name}`));
}
function documentValue(value) {
  if (!value || !QUOTE_READ_FORMATS.has(value.format) || !value.items || typeof value.items !== "object" || Array.isArray(value.items))
    throw new Error("行情快照格式不受支持，请更新面板；已停止写入");
  return value;
}
function quotesFrom(value, symbols) {
  const expected = new Set(symbols.map(item => `${item.market}:${item.symbol}`));
  return new Map(Object.entries(documentValue(value).items)
    .filter(([key, quote]) => expected.has(key) && isQuoteV2(quote) && key === `${quote.market}:${quote.symbol}`)
    .map(([, quote]) => [quote.symbol, quote]));
}
function casValue(value) {
  documentValue(value);
  if (![value.generation, value.commit, value.seq].every(number => Number.isSafeInteger(number) && number >= 0) ||
    !["active", "stopped", "migrated"].includes(value.control?.state) ||
    (value.control.stopRequestKey !== null && (typeof value.control.stopRequestKey !== "string" || value.control.stopRequestKey.length > 256)) ||
    (value.control.migratedTo !== null && (typeof value.control.migratedTo !== "string" || value.control.migratedTo.length > 256)) ||
    Object.keys(value.control).some(key => !["state", "stopRequestKey", "migratedTo"].includes(key)) ||
    Object.keys(value).some(key => !["format", "generation", "commit", "seq", "control", "holder", "round", "items"].includes(key)) ||
    (value.holder !== null && (!value.holder || typeof value.holder.instanceId !== "string" || !value.holder.instanceId.length || value.holder.instanceId.length > 128 || !Number.isSafeInteger(value.holder.leaseUntil) || value.holder.leaseUntil < 0 || Object.keys(value.holder).some(key => !["instanceId", "leaseUntil"].includes(key)))))
    throw new Error("共享行情控制记录无效；已保留记录并停止写入");
  return value;
}
const empty = () => ({ format: "quant.quotes/2", generation: 0, commit: 0, seq: 0,
  control: { state: "active", stopRequestKey: null, migratedTo: null }, holder: null,
  round: null, items: {} });

// Ownership, stop tombstones, sequence and payload share ONE CAS record. Every
// publish uses the exact revision returned by acquisition, never a fresh read.
export function createQuoteCasStore({ hostCall, instanceId = id(), now = Date.now, leaseMs = 70_000, hooks = {} }) {
  let owned = null;
  async function read() {
    const snapshot = await hostCall("storage.getSnapshot", { key: KEY });
    if (!snapshot || typeof snapshot.exists !== "boolean" || (snapshot.exists ? typeof snapshot.revision !== "string" : snapshot.revision !== null || snapshot.value !== null)) throw new Error("共享行情存储回执无效");
    if (snapshot.exists) casValue(snapshot.value);
    return snapshot;
  }
  async function commit(previous, value) {
    casValue(value);
    if (!QUOTE_WRITE_FORMATS.has(value.format)) throw new Error("行情格式只读");
    if (new TextEncoder().encode(JSON.stringify(value)).length > 65_536) throw new Error("共享行情快照超过 64KB 配额；请减少过渡模式订阅或更新 CodeShell");
    let result;
    try { result = await hostCall("storage.compareAndSet", { key: KEY, expectedRevision: previous.revision, value }); }
    catch (error) {
      const actual = await read();
      if (JSON.stringify(actual?.value) === JSON.stringify(value)) return actual;
      throw error;
    }
    if (result?.updated !== true) { owned = null; return null; }
    return result.snapshot;
  }
  return {
    read,
    async acquire() {
      const previous = await read();
      const value = previous.exists ? previous.value : empty();
      if (value.control.state !== "active" || (value.holder && value.holder.instanceId !== instanceId && value.holder.leaseUntil > now())) return null;
      const next = { ...value, commit: value.commit + 1,
        generation: value.generation + (value.holder?.instanceId === instanceId ? 0 : 1),
        holder: { instanceId, leaseUntil: now() + leaseMs } };
      owned = await commit(previous, next);
      return owned;
    },
    async publish(packet) {
      if (!owned) return null;
      const previous = owned;
      await hooks.beforePublish?.();
      const value = previous.value;
      if (value.control.state !== "active" || value.holder?.instanceId !== instanceId || value.holder.leaseUntil <= now()) { owned = null; return null; }
      const retained = packet.subscriptions ? new Set(packet.subscriptions.map(item => `${item.market}:${item.symbol}`)) : null;
      const items = Object.fromEntries(Object.entries(value.items).filter(([key]) => !retained || retained.has(key)));
      for (const quote of packet.quotes ?? []) {
        if (!isQuoteV2(quote)) continue;
        const key = `${quote.market}:${quote.symbol}`;
        const prior = items[key];
        if (isQuoteV2(prior) && key === `${prior.market}:${prior.symbol}` && Date.parse(quote.asOf) < Date.parse(prior.asOf)) continue;
        items[key] = quote;
      }
      const next = { ...value, commit: value.commit + 1, seq: value.seq + 1, items,
        round: packet.round ?? null, holder: { instanceId, leaseUntil: now() + leaseMs } };
      owned = await commit(previous, next);
      return owned;
    },
    async stop(requestKey = id()) {
      const previous = await read();
      const value = previous.exists ? previous.value : empty();
      if (value.control.stopRequestKey === requestKey) return previous;
      const next = { ...value, generation: value.generation + 1, commit: value.commit + 1,
        holder: null, control: { ...value.control, state: "stopped", stopRequestKey: requestKey } };
      const stopped = await commit(previous, next);
      owned = null;
      if (!stopped) throw new Error("其他页面已修改行情控制状态，请读取最新状态后重试");
      return stopped;
    },
    async resume() {
      const previous = await read(); const value = previous.exists ? previous.value : empty();
      if (value.control.state === "migrated") throw new Error("行情协议已迁移，请更新面板");
      if (value.control.state === "active") return previous;
      return commit(previous, { ...value, commit: value.commit + 1, generation: value.generation + 1,
        holder: null, control: { ...value.control, state: "active" } });
    },
    async release() {
      if (!owned) return;
      const previous = owned; owned = null;
      await commit(previous, { ...previous.value, commit: previous.value.commit + 1, holder: null });
    },
  };
}

export function createSharedMarketController({ hostCall, getContext, onHostEvent, request, symbols, onUpdate,
  now = () => new Date(), schedule = setTimeout, unschedule = clearTimeout }) {
  let active = false, timer = null, flight = null, token = 0, attachId = null, seq = -1;
  let serviceState = null, configSignature = null, fingerprint = null;
  const check = generation => { if (generation !== token) throw new Error("行情连接已切换，旧回执未应用"); };
  async function call(generation, method, params) {
    check(generation);
    const value = await hostCall(method, params);
    check(generation);
    return value;
  }
  const makeCas = generation => createQuoteCasStore({ hostCall: (method, params) => call(generation, method, params), now: () => now().getTime() });
  let cas = makeCas(token);
  const service = () => supportsMarketService(getContext());
  const clear = () => { if (timer != null) unschedule(timer); timer = null; };
  function update(value, state = {}) {
    const quotes = quotesFrom(value, symbols());
    const next = JSON.stringify([...quotes]);
    if (next === fingerprint && !state.message) return;
    fingerprint = next;
    onUpdate(quotes, { ...state, background: serviceState?.desired === "always", phase: serviceState?.phase,
      message: state.message ?? (service() ? `共享后台行情 · ${serviceState?.phase ?? "连接中"}` : "过渡模式：需要更新 CodeShell 才能关闭面板后继续") });
  }
  async function readService(generation = token) {
    const snapshot = await call(generation,"services.read", { name: NAME, channel: "quotes", ...(seq >= 0 ? { afterSeq: seq } : {}) });
    if (!snapshot?.unchanged && snapshot?.value) { if (snapshot.seq < seq) return; seq = snapshot.seq; update(snapshot.value); }
  }
  async function configure(generation) {
    const subscriptions = [...new Map(symbols().map(item => [`${item.market}:${item.symbol}`, item])).values()]
      .sort((a, b) => `${a.market}:${a.symbol}`.localeCompare(`${b.market}:${b.symbol}`));
    const config = { format: "quant.market-feed.config/1", subscriptions,
      cadence: { open: 15000, closed: 300000 }, budgets: { batch: 4, batchDeadlineMs: 8000, perSourceMs: 6000, roundBudgetMs: 30000 } };
    const signature = JSON.stringify(config);
    if (signature === configSignature) return;
    const requestKey = `config:${id()}`;
    try { await call(generation, "services.configure", { name: NAME, config, expectedConfigRevision: serviceState.configRevision, requestKey }); }
    catch (error) {
      const state = await call(generation, "services.get", { name: NAME });
      if (!state.controls?.some(control => control.requestKey === requestKey)) {
        if (state.configRevision === serviceState.configRevision) throw error;
        await call(generation, "services.configure", { name: NAME, config, expectedConfigRevision: state.configRevision, requestKey });
      }
    }
    serviceState = await call(generation, "services.get", { name: NAME });
    configSignature = signature;
  }
  async function connect(generation) {
    serviceState = await call(generation, "services.get", { name: NAME });
    await readService(generation); // hydrate committed data before attach can start work
    if (!attachId) attachId = (await call(generation, "services.attach", { name: NAME })).attachId;
    await configure(generation);
    if (serviceState.desired === "off" && serviceState.desiredRevision === 0) {
      await call(generation, "services.setDesired", { name: NAME, desired: "on-demand", expectedRevision: serviceState.desiredRevision, requestKey: `initial:${id()}` });
      serviceState = await call(generation, "services.get", { name: NAME });
    }
    await readService(generation);
    onUpdate(new Map(), { preserve: true, background: serviceState.desired === "always", message: `共享后台行情 · ${serviceState.phase}` });
  }
  async function refresh({ poke = false } = {}) {
    if (flight) return flight;
    clear(); const generation = token;
    flight = (async () => {
      try {
        if (service()) {
          await connect(generation);
          if (poke) await call(generation,"services.control", { name: NAME, action: "poke", requestKey: `poke:${id()}` });
        } else {
          const methods = getContext().availableMethods;
          if (!Array.isArray(methods) || !methods.includes("storage.getSnapshot"))
            throw new Error("当前 CodeShell 无法读取共享行情；仅显示本地数据，请更新 CodeShell");
          const cached = await cas.read();
          if (cached.exists) update(cached.value);
          if (!["storage.compareAndSet", "process.resolveEntry"].every(name => methods.includes(name)))
            throw new Error("当前 CodeShell 不支持已授权共享采集；仅显示已验证缓存，请更新 CodeShell");
          if (!active || generation !== token || !symbols().length) return;
          if (await cas.acquire()) {
            check(generation);
            const packet = await request.fetch(symbols());
            if (generation !== token) return;
            if (packet.contract !== 2) throw new Error("报价契约不兼容，请更新面板");
            const published = await cas.publish({ ...packet, subscriptions: symbols() });
            if (published) update(published.value); else request.cancel();
          }
        }
      } catch (error) {
        if (generation === token) onUpdate(new Map(), { failed: true, preserve: true, message: error.message });
      } finally {
        if (generation === token) { flight = null; if (active) timer = schedule(() => void refresh(), service() ? 60_000 : 15_000); }
      }
    })();
    return flight;
  }
  const unsubscribe = onHostEvent?.("services.changed", event => {
    if (!active || event.name !== NAME || !service()) return;
    if (event.state) serviceState = typeof event.state === "object" ? event.state : { ...serviceState, phase: event.state };
    if (!event.channel || event.channel === "quotes") void readService().catch(() => {});
  });
  return {
    refresh: () => refresh({ poke: true }),
    setActive(value) {
      const changed = active !== value; active = value;
      if (!value) clear();
      else if (changed || (!timer && !flight)) void refresh();
    },
    async pause(paused) {
      const generation = token;
      request.cancel(); clear();
      if (service()) {
        serviceState = await call(generation, "services.get", { name: NAME });
        const requestKey = `pause:${id()}`;
        try { await call(generation, "services.control", { name: NAME, action: paused ? "pause" : "resume", requestKey }); }
        catch (error) { const current = await call(generation, "services.get", { name: NAME }); if (!current.controls?.some(control => control.requestKey === requestKey)) throw error; }
      } else if (paused) await cas.stop(`stop:${id()}`);
      else await cas.resume();
      check(generation);
      onUpdate(new Map(), { preserve: true, message: paused ? "行情采集已暂停，保留已提交快照" : "行情采集已恢复" });
      if (!paused && active) await refresh();
    },
    async setBackground(enabled) {
      const generation = token;
      if (!service()) throw new Error("需要更新 CodeShell 才能关闭面板后继续");
      serviceState = await call(generation, "services.get", { name: NAME });
      const requestKey = `desired:${id()}`;
      try { serviceState = await call(generation, "services.setDesired", { name: NAME, desired: enabled ? "always" : "off", expectedRevision: serviceState.desiredRevision, requestKey }); }
      catch (error) {
        serviceState = await call(generation, "services.get", { name: NAME });
        if (!serviceState.controls?.some(control => control.requestKey === requestKey)) throw error;
      }
      onUpdate(new Map(), { preserve: true, background: serviceState.desired === "always", message: enabled ? "后台更新已启用；CodeShell 运行期间，关闭面板也继续" : "后台更新已关闭" });
      if (enabled) await refresh();
    },
    reset() {
      token++; clear(); flight = null; request.cancel();
      attachId = null; seq = -1; configSignature = null; fingerprint = null; serviceState = null;
      // Reset may follow a project switch: never release via the new project's
      // bridge. The old bounded lease expires; any late CAS publish is rejected.
      cas = makeCas(token);
    },
    dispose() { token++; active = false; clear(); unsubscribe?.(); request.cancel();
      if (attachId) void hostCall("services.detach", { attachId }).catch(() => {}); },
  };
}
