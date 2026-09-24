const DEFAULT_MAX_CALLS = 27;
const DEFAULT_BACKGROUND_CALLS = 24;
const DEFAULT_WINDOW_MS = 10_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const RATE_LIMIT_PATTERN = /Panel App rate limit exceeded/iu;

const INTERACTIVE_METHODS = new Set([
  "agent.submitPrompt",
  "agent.task.start",
  "automations.create",
  "automations.createUnique",
  "automations.delete",
  "automations.update",
  "automations.updateIfRevision",
  "automations.deleteIfRevision",
  "notifications.send",
  "process.cancel",
  "workspace.writeText",
  "storage.compareAndSet",
]);

export function panelHostCallPriority(method) {
  return INTERACTIVE_METHODS.has(method) ? "interactive" : "background";
}

export function panelHostCallCacheKey(method, params) {
  if (method === "process.find" && typeof params?.name === "string") {
    return `process.find:${params.name}`;
  }
  if (method === "filesystem.getKnownDirectory" && typeof params?.name === "string") {
    return `filesystem.getKnownDirectory:${params.name}`;
  }
  return "";
}

export function normalizePanelHostCallError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (RATE_LIMIT_PATTERN.test(message)) {
    return new Error("面板请求暂时过多，已自动排队重试；若仍未恢复，请等待 10 秒后再试");
  }
  return error instanceof Error ? error : new Error(message || "面板请求失败");
}

export function createPanelHostCallScheduler(options) {
  const invoke = options.invoke;
  const currentScope = options.currentScope ?? (() => null);
  const now = options.now ?? (() => Date.now());
  const schedule = options.schedule ?? ((callback, delay) => window.setTimeout(callback, delay));
  const cancelSchedule = options.cancelSchedule ?? ((timer) => window.clearTimeout(timer));
  const maxCalls = Math.max(1, options.maxCalls ?? DEFAULT_MAX_CALLS);
  const backgroundCalls = Math.max(
    1,
    Math.min(maxCalls, options.backgroundCalls ?? DEFAULT_BACKGROUND_CALLS),
  );
  const windowMs = Math.max(10, options.windowMs ?? DEFAULT_WINDOW_MS);
  const cacheTtlMs = Math.max(0, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
  const queue = [];
  const callTimes = [];
  const cache = new Map();
  let timer = null;
  let pumping = false;

  function prune(timestamp) {
    while (callTimes.length && timestamp - callTimes[0] >= windowMs) callTimes.shift();
    for (const [key, entry] of cache) {
      if (!entry.promise && entry.expiresAt <= timestamp) cache.delete(key);
    }
  }

  function arm(delay) {
    const bounded = Math.max(1, Math.ceil(delay));
    if (timer != null) cancelSchedule(timer);
    timer = schedule(() => {
      timer = null;
      pump();
    }, bounded);
  }

  function availableIndex(timestamp) {
    const interactive = queue.findIndex(
      (item) => item.priority === "interactive" && item.notBefore <= timestamp,
    );
    if (interactive >= 0 && callTimes.length < maxCalls) return interactive;
    if (callTimes.length >= backgroundCalls) return -1;
    return queue.findIndex((item) => item.notBefore <= timestamp);
  }

  function nextDelay(timestamp) {
    if (!queue.length) return null;
    const delays = [];
    const readyInteractive = queue.some(
      (item) => item.priority === "interactive" && item.notBefore <= timestamp,
    );
    const readyBackground = queue.some(
      (item) => item.priority === "background" && item.notBefore <= timestamp,
    );
    for (const [ready, cap] of [
      [readyInteractive, maxCalls],
      [readyBackground, backgroundCalls],
    ]) {
      if (!ready || callTimes.length < cap) continue;
      const releaseIndex = Math.max(0, callTimes.length - cap);
      delays.push(windowMs - (timestamp - callTimes[releaseIndex]) + 5);
    }
    const future = queue
      .filter((item) => item.notBefore > timestamp)
      .map((item) => item.notBefore - timestamp);
    delays.push(...future);
    return Math.max(1, Math.min(...delays));
  }

  function complete(item, value) {
    if (item.scope !== currentScope()) {
      fail(item, new Error("项目已切换，旧项目请求的结果未应用。"));
      return;
    }
    if (item.cacheKey) {
      cache.set(item.cacheKey, {
        value,
        expiresAt: now() + cacheTtlMs,
        promise: null,
      });
    }
    item.resolve(value);
  }

  function fail(item, error) {
    if (
      item.scope === currentScope() &&
      RATE_LIMIT_PATTERN.test(error instanceof Error ? error.message : String(error ?? "")) &&
      item.attempts < 1
    ) {
      item.attempts += 1;
      item.notBefore = now() + windowMs + 25;
      queue.push(item);
      pump();
      return;
    }
    if (item.cacheKey) cache.delete(item.cacheKey);
    item.reject(normalizePanelHostCallError(error));
  }

  function dispatch(item, timestamp) {
    callTimes.push(timestamp);
    Promise.resolve()
      .then(() => {
        if (item.scope !== currentScope()) throw new Error("项目已切换，已取消尚未发出的请求。");
        return invoke(item.method, item.params);
      })
      .then((value) => complete(item, value))
      .catch((error) => fail(item, error))
      .finally(pump);
  }

  function pump() {
    if (pumping) return;
    pumping = true;
    try {
      if (timer != null) {
        cancelSchedule(timer);
        timer = null;
      }
      let timestamp = now();
      prune(timestamp);
      let index = availableIndex(timestamp);
      while (index >= 0) {
        const [item] = queue.splice(index, 1);
        dispatch(item, timestamp);
        timestamp = now();
        prune(timestamp);
        index = availableIndex(timestamp);
      }
      const delay = nextDelay(timestamp);
      if (delay != null) arm(delay);
    } finally {
      pumping = false;
    }
  }

  function call(method, params) {
    const scope = currentScope();
    const methodKey = panelHostCallCacheKey(method, params);
    const cacheKey = methodKey ? JSON.stringify([scope, methodKey]) : "";
    const timestamp = now();
    prune(timestamp);
    const cached = cacheKey ? cache.get(cacheKey) : null;
    if (cached?.promise) return cached.promise;
    if (cached && cached.expiresAt > timestamp) return Promise.resolve(cached.value);

    let resolveCall;
    let rejectCall;
    const promise = new Promise((resolve, reject) => {
      resolveCall = resolve;
      rejectCall = reject;
    });
    const item = {
      method,
      params,
      scope,
      priority: panelHostCallPriority(method),
      notBefore: timestamp,
      attempts: 0,
      cacheKey,
      resolve: resolveCall,
      reject: rejectCall,
    };
    if (cacheKey) cache.set(cacheKey, { promise, expiresAt: Number.POSITIVE_INFINITY });
    queue.push(item);
    pump();
    return promise;
  }

  return {
    call,
    snapshot() {
      const timestamp = now();
      prune(timestamp);
      return {
        queued: queue.length,
        callsInWindow: callTimes.length,
        cached: [...cache.keys()].length,
      };
    },
  };
}
