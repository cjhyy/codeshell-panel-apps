export const AUTO_DATA_SOURCE_ID = "auto";

export const MARKET_DATA_PROVIDER_CONTRACT = Object.freeze({
  id: "codeshell.market-data-provider",
  version: 1,
  capabilities: Object.freeze([
    "daily",
    "adjustmentFactors",
    "realtime",
    "minute",
    "financials",
    "orderBook",
  ]),
  capabilityStates: Object.freeze(["native", "derived", "unavailable"]),
  dailyFields: Object.freeze(["date", "open", "high", "low", "close", "volume"]),
});

const CAPABILITY_STATES = new Set(MARKET_DATA_PROVIDER_CONTRACT.capabilityStates);

function validateSource(definition) {
  if (!definition || typeof definition !== "object") throw new TypeError("provider definition is required");
  if (!/^[a-z][a-z0-9-]{1,48}$/u.test(definition.id)) throw new TypeError("provider id is invalid");
  if (typeof definition.label !== "string" || !definition.label.trim()) throw new TypeError("provider label is required");
  if (!Array.isArray(definition.markets) || definition.markets.length === 0 ||
      definition.markets.some((market) => !["cn", "us"].includes(market))) {
    throw new TypeError(`provider ${definition.id} markets are invalid`);
  }
  if (!Array.isArray(definition.adjustments) || definition.adjustments.length === 0) {
    throw new TypeError(`provider ${definition.id} adjustments are required`);
  }
  if (!Array.isArray(definition.origins) || definition.origins.length === 0 ||
      definition.origins.some((origin) => {
        try {
          const parsed = new URL(origin);
          return parsed.protocol !== "https:" || parsed.origin !== origin;
        } catch {
          return true;
        }
      })) {
    throw new TypeError(`provider ${definition.id} HTTPS origins are invalid`);
  }
  const capabilities = definition.capabilities;
  if (!capabilities || typeof capabilities !== "object") {
    throw new TypeError(`provider ${definition.id} capabilities are required`);
  }
  for (const capability of MARKET_DATA_PROVIDER_CONTRACT.capabilities) {
    if (!CAPABILITY_STATES.has(capabilities[capability])) {
      throw new TypeError(`provider ${definition.id} capability ${capability} is invalid`);
    }
  }
  if (capabilities.daily === "unavailable") {
    throw new TypeError(`history provider ${definition.id} must implement daily data`);
  }
  const auth = definition.auth;
  if (!auth || !["none", "environment"].includes(auth.type)) {
    throw new TypeError(`provider ${definition.id} auth is invalid`);
  }
  if (auth.type === "environment" && !/^[A-Z][A-Z0-9_]{2,80}$/u.test(auth.env ?? "")) {
    throw new TypeError(`provider ${definition.id} credential environment name is invalid`);
  }
  return definition;
}

function source(definition) {
  validateSource(definition);
  const auth = Object.freeze({ ...definition.auth });
  const capabilities = Object.freeze({ ...definition.capabilities });
  return Object.freeze({
    ...definition,
    contract: `${MARKET_DATA_PROVIDER_CONTRACT.id}/v${MARKET_DATA_PROVIDER_CONTRACT.version}`,
    markets: Object.freeze([...definition.markets]),
    adjustments: Object.freeze([...definition.adjustments]),
    origins: Object.freeze([...definition.origins]),
    auth,
    capabilities,
    credentialEnv: auth.type === "environment" ? auth.env : null,
  });
}

// This registry is shared by the browser UI and the bundled Node fetcher. Keep
// credentials out of it: only the environment-variable name may cross into the
// panel or a task prompt.
export const HISTORY_DATA_SOURCES = Object.freeze([
  source({
    id: "tencent-ifzq",
    label: "腾讯行情",
    markets: ["cn"],
    adjustments: ["qfq", "hfq", "none"],
    state: "ready",
    access: "no-key",
    auth: { type: "none" },
    origins: ["https://web.ifzq.gtimg.cn", "https://qt.gtimg.cn"],
    capabilities: {
      daily: "native", adjustmentFactors: "derived", realtime: "unavailable",
      minute: "unavailable", financials: "unavailable", orderBook: "unavailable",
    },
    summary: "A 股日线 · 前复权 / 后复权 / 不复权",
  }),
  source({
    id: "eastmoney-kline",
    label: "东方财富",
    markets: ["cn"],
    adjustments: ["qfq", "hfq", "none"],
    state: "ready",
    access: "no-key",
    auth: { type: "none" },
    origins: ["https://push2his.eastmoney.com"],
    capabilities: {
      daily: "native", adjustmentFactors: "unavailable", realtime: "unavailable",
      minute: "unavailable", financials: "unavailable", orderBook: "unavailable",
    },
    summary: "A 股日线 · 前复权 / 后复权 / 不复权 · 免配置备用源",
  }),
  source({
    id: "yahoo-finance",
    label: "Yahoo Chart",
    markets: ["us"],
    adjustments: ["adj", "none"],
    state: "ready",
    access: "no-key",
    auth: { type: "none" },
    origins: ["https://query1.finance.yahoo.com"],
    capabilities: {
      daily: "native", adjustmentFactors: "unavailable", realtime: "unavailable",
      minute: "unavailable", financials: "unavailable", orderBook: "unavailable",
    },
    summary: "美股日线 · 股息拆股复权 / 不复权",
  }),
  source({
    id: "tushare-pro",
    label: "Tushare Pro",
    markets: ["cn"],
    adjustments: ["qfq", "hfq", "none"],
    state: "credential-required",
    access: "token-and-points",
    auth: { type: "environment", env: "TUSHARE_TOKEN" },
    origins: ["https://api.tushare.pro"],
    capabilities: {
      daily: "native", adjustmentFactors: "native", realtime: "unavailable",
      minute: "unavailable", financials: "unavailable", orderBook: "unavailable",
    },
    summary: "A 股日线 · 支持前后复权 · 受账户积分限制",
  }),
  source({
    id: "alpha-vantage",
    label: "Alpha Vantage",
    markets: ["cn", "us"],
    adjustments: ["adj", "none"],
    state: "credential-required",
    access: "api-key",
    auth: { type: "environment", env: "ALPHAVANTAGE_API_KEY" },
    origins: ["https://www.alphavantage.co"],
    capabilities: {
      daily: "native", adjustmentFactors: "unavailable", realtime: "unavailable",
      minute: "unavailable", financials: "unavailable", orderBook: "unavailable",
    },
    summary: "全球股票日线 · 完整历史和复权接口可能需要付费方案",
  }),
  source({
    id: "massive",
    label: "Massive",
    markets: ["us"],
    adjustments: ["split", "none"],
    state: "credential-required",
    access: "api-key",
    auth: { type: "environment", env: "MASSIVE_API_KEY" },
    origins: ["https://api.massive.com"],
    capabilities: {
      daily: "native", adjustmentFactors: "unavailable", realtime: "unavailable",
      minute: "unavailable", financials: "unavailable", orderBook: "unavailable",
    },
    summary: "美股聚合日线 · 拆股复权 / 不复权",
  }),
]);

const SOURCE_BY_ID = new Map(HISTORY_DATA_SOURCES.map((candidate) => [candidate.id, candidate]));

export function historyDataSource(id) {
  return SOURCE_BY_ID.get(String(id ?? "")) ?? null;
}

export function historyDataSourcesForMarket(market, adjustment = null) {
  return HISTORY_DATA_SOURCES.filter(
    (candidate) =>
      candidate.markets.includes(market) &&
      (adjustment === null || candidate.adjustments.includes(adjustment)),
  );
}

export function historyDataSourcesForCapability(capability, state = null) {
  if (!MARKET_DATA_PROVIDER_CONTRACT.capabilities.includes(capability)) return [];
  return HISTORY_DATA_SOURCES.filter((candidate) =>
    state === null
      ? candidate.capabilities[capability] !== "unavailable"
      : candidate.capabilities[capability] === state,
  );
}

export function historyDataSourceCapability(id, capability) {
  if (!MARKET_DATA_PROVIDER_CONTRACT.capabilities.includes(capability)) return "unavailable";
  return historyDataSource(id)?.capabilities[capability] ?? "unavailable";
}

export function validateHistoryDataSourceDefinition(definition) {
  validateSource(definition);
  return true;
}

export function defaultHistorySource(market) {
  return market === "cn" ? "tencent-ifzq" : "yahoo-finance";
}

export function historySourceLabel(id) {
  if (id === AUTO_DATA_SOURCE_ID) return "自动选择";
  return historyDataSource(id)?.label ?? String(id ?? "");
}
