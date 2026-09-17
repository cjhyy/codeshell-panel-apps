import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tool = await import(pathToFileURL(join(
  repositoryRoot,
  "apps/quant-lab/app/tools/fetch-market-data.mjs",
)).href);

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

assert.deepEqual(
  tool.resolveSourceCandidates({ market: "cn", adjust: "qfq", env: {} }).map((source) => source.id),
  ["tencent-ifzq", "eastmoney-kline"],
);
assert.deepEqual(
  tool.resolveSourceCandidates({
    market: "cn",
    adjust: "qfq",
    env: { TUSHARE_TOKEN: "configured" },
  }).map((source) => source.id),
  ["tencent-ifzq", "eastmoney-kline", "tushare-pro"],
);
assert.deepEqual(
  tool.resolveSourceCandidates({
    market: "us",
    adjust: "none",
    env: { ALPHAVANTAGE_API_KEY: "configured", MASSIVE_API_KEY: "configured" },
  }).map((source) => source.id),
  ["yahoo-finance", "alpha-vantage", "massive"],
);
assert.throws(
  () => tool.resolveSourceCandidates({
    market: "cn",
    adjust: "qfq",
    requestedSource: "tushare-pro",
    env: {},
  }),
  /TUSHARE_TOKEN/u,
);

const eastmoneyBars = await tool.fetchEastmoney({
  slug: "SH600519",
  from: "2026-01-01",
  to: "2026-01-03",
  adjust: "qfq",
  fetchImpl: async (url) => {
    assert.equal(url.origin, "https://push2his.eastmoney.com");
    assert.equal(url.searchParams.get("secid"), "1.600519");
    assert.equal(url.searchParams.get("ut"), "7eea3edcaed734bea9cbfc24409ed989");
    assert.equal(url.searchParams.get("fqt"), "1");
    assert.equal(url.searchParams.get("beg"), "20260101");
    assert.equal(url.searchParams.get("end"), "20260103");
    return jsonResponse({
      data: {
        klines: [
          "2026-01-02,10,11,12,9,100,0,0,0,0,0",
          "2026-01-03,11,12,13,10,120,0,0,0,0,0",
        ],
      },
    });
  },
});
assert.deepEqual(eastmoneyBars, [
  { date: "2026-01-02", open: 10, high: 12, low: 9, close: 11, volume: 10_000 },
  { date: "2026-01-03", open: 11, high: 13, low: 10, close: 12, volume: 12_000 },
]);

const bundleRequests = [];
let bundleWaits = 0;
const tencentBundle = await tool.fetchAsharePriceBundle({
  requestedSource: "tencent-ifzq",
  symbol: "SH600519",
  slug: "SH600519",
  from: "2026-01-01",
  to: "2026-01-03",
  beforeAdditionalRequest: async () => { bundleWaits += 1; },
  fetchImpl: async (input) => {
    const url = new URL(input);
    const parameter = url.searchParams.get("param");
    bundleRequests.push(parameter);
    const adjusted = parameter.endsWith(",qfq");
    return jsonResponse({
      data: {
        sh600519: adjusted
          ? { qfqday: [
              ["2026-01-01", "4", "5", "6", "3", "100"],
              ["2026-01-02", "19", "20", "21", "18", "110"],
              ["2026-01-03", "21", "22", "23", "20", "120"],
            ] }
          : { day: [
              ["2026-01-01", "8", "10", "12", "6", "100"],
              ["2026-01-02", "19", "20", "21", "18", "110"],
              ["2026-01-03", "21", "22", "23", "20", "120"],
            ] },
      },
    });
  },
});
assert.equal(bundleRequests.length, 2);
assert.equal(bundleWaits, 1, "raw and adjusted requests must pass through the caller's pacing gate");
assert.equal(tencentBundle.priceModel.kind, "raw-factor");
assert.equal(tencentBundle.priceModel.factorMethod, "derived-qfq-ratio");
assert.deepEqual(tencentBundle.adjustmentFactors.map((item) => item.factor), [0.5, 1, 1]);
assert.deepEqual(tencentBundle.bars.map((item) => item.close), [5, 20, 22]);
assert.throws(
  () => tool.resolveSourceCandidates({
    market: "us",
    adjust: "adj",
    requestedSource: "massive",
    env: { MASSIVE_API_KEY: "configured" },
  }),
  /adjust=adj/u,
);

const tushareCalls = [];
const tushareBars = await tool.fetchTushare({
  slug: "SH600519",
  from: "2026-01-01",
  to: "2026-01-03",
  adjust: "qfq",
  token: "private-token",
  fetchImpl: async (_url, init) => {
    const request = JSON.parse(init.body);
    tushareCalls.push(request);
    if (request.api_name === "daily") {
      return jsonResponse({
        code: 0,
        msg: null,
        data: {
          fields: ["trade_date", "open", "high", "low", "close", "vol"],
          items: [
            ["20260103", 20, 22, 19, 21, 12],
            ["20260102", 10, 12, 9, 11, 10],
            ["20260101", 8, 9, 7, 8.5, 8],
          ],
        },
      });
    }
    return jsonResponse({
      code: 0,
      msg: null,
      data: {
        fields: ["trade_date", "adj_factor"],
        items: [["20260103", 2], ["20260102", 1], ["20260101", 1]],
      },
    });
  },
});
assert.equal(tushareCalls.length, 2);
assert.equal(tushareCalls[0].token, "private-token");
assert.equal(tushareCalls[0].params.ts_code, "600519.SH");
assert.equal(tushareBars.find((bar) => bar.date === "2026-01-02").close, 5.5);
assert.equal(tushareBars.find((bar) => bar.date === "2026-01-03").volume, 1200);

const alphaBars = await tool.fetchAlphaVantage({
  slug: "AAPL",
  market: "us",
  from: "2026-01-01",
  to: "2026-01-03",
  adjust: "adj",
  apiKey: "private-alpha-key",
  fetchImpl: async (url) => {
    assert.equal(url.searchParams.get("apikey"), "private-alpha-key");
    assert.equal(url.searchParams.get("function"), "TIME_SERIES_DAILY_ADJUSTED");
    return jsonResponse({
      "Time Series (Daily)": {
        "2026-01-03": {
          "1. open": "100",
          "2. high": "110",
          "3. low": "90",
          "4. close": "100",
          "5. adjusted close": "50",
          "6. volume": "1234",
        },
        "2025-12-31": {
          "1. open": "1",
          "2. high": "1",
          "3. low": "1",
          "4. close": "1",
          "5. adjusted close": "1",
          "6. volume": "1",
        },
      },
    });
  },
});
assert.deepEqual(alphaBars, [{
  date: "2026-01-03",
  open: 50,
  high: 55,
  low: 45,
  close: 50,
  volume: 1234,
}]);

const massiveBars = await tool.fetchMassive({
  slug: "AAPL",
  from: "2026-01-01",
  to: "2026-01-03",
  adjust: "split",
  apiKey: "private-massive-key",
  fetchImpl: async (url) => {
    assert.equal(url.searchParams.get("apiKey"), "private-massive-key");
    assert.equal(url.searchParams.get("adjusted"), "true");
    return jsonResponse({
      status: "OK",
      results: [
        { t: Date.parse("2026-01-02T05:00:00Z"), o: 10, h: 12, l: 9, c: 11, v: 1000 },
      ],
    });
  },
});
assert.deepEqual(massiveBars, [{
  date: "2026-01-02",
  open: 10,
  high: 12,
  low: 9,
  close: 11,
  volume: 1000,
}]);

let tencentAttempts = 0;
const fallback = await tool.fetchWithSourceFallback({
  requestedSource: "auto",
  previousSource: null,
  symbol: "600519",
  slug: "SH600519",
  market: "cn",
  from: "2026-01-01",
  to: "2026-01-03",
  adjust: "qfq",
  env: { TUSHARE_TOKEN: "private-token" },
  fetchImpl: async (url, init) => {
    if (String(url).includes("ifzq.gtimg.cn")) {
      tencentAttempts += 1;
      return jsonResponse({ error: true }, 503);
    }
    if (String(url).includes("push2his.eastmoney.com")) {
      return jsonResponse({
        data: {
          klines: [
            "2026-01-01,8,8.5,9,7,8,0,0,0,0,0",
            "2026-01-02,10,11,12,9,10,0,0,0,0,0",
            "2026-01-03,20,21,22,19,12,0,0,0,0,0",
          ],
        },
      });
    }
    const request = JSON.parse(init.body);
    if (request.api_name === "daily") {
      return jsonResponse({
        code: 0,
        msg: null,
        data: {
          fields: ["trade_date", "open", "high", "low", "close", "vol"],
          items: [
            ["20260103", 20, 22, 19, 21, 12],
            ["20260102", 10, 12, 9, 11, 10],
            ["20260101", 8, 9, 7, 8.5, 8],
          ],
        },
      });
    }
    return jsonResponse({
      code: 0,
      msg: null,
      data: {
        fields: ["trade_date", "adj_factor"],
        items: [["20260103", 2], ["20260102", 1], ["20260101", 1]],
      },
    });
  },
});
assert.equal(tencentAttempts, 1);
assert.equal(fallback.source, "eastmoney-kline");
assert.deepEqual(fallback.failures, [{ source: "tencent-ifzq", code: "SOURCE_HTTP" }]);
assert.equal(fallback.bars.length, 3);

await assert.rejects(
  tool.fetchWithSourceFallback({
    requestedSource: "tencent-ifzq",
    previousSource: null,
    symbol: "600519",
    slug: "SH600519",
    market: "cn",
    from: "2026-01-01",
    to: "2026-01-03",
    adjust: "qfq",
    fetchImpl: async () => jsonResponse({ error: true }, 429, { "retry-after": "120" }),
  }),
  (error) => error?.code === "SOURCE_HTTP" && error?.status === 429 && error?.retryAfterMs === 120_000,
  "HTTP Retry-After must survive as a machine-readable provider wait",
);

await assert.rejects(
  tool.fetchWithSourceFallback({
    requestedSource: "tencent-ifzq",
    previousSource: null,
    symbol: "600519",
    slug: "SH600519",
    market: "cn",
    from: "2026-01-01",
    to: "2026-01-03",
    adjust: "qfq",
    fetchImpl: async () => {
      throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
    },
  }),
  (error) => error?.code === "SOURCE_NETWORK",
  "ordinary transport failures must be retryable instead of becoming unknown per-stock failures",
);

await assert.rejects(
  tool.fetchWithSourceFallback({
    requestedSource: "tencent-ifzq",
    previousSource: null,
    symbol: "688035",
    slug: "SH688035",
    market: "cn",
    from: "2026-01-01",
    to: "2026-01-03",
    adjust: "qfq",
    fetchImpl: async () => jsonResponse({ data: { sh688035: {} } }),
  }),
  (error) => error?.code === "SOURCE_EMPTY",
  "Tencent no-data responses must retain a machine-readable unavailable code",
);

await assert.rejects(
  tool.fetchWithSourceFallback({
    requestedSource: "tencent-ifzq",
    previousSource: null,
    symbol: "601399",
    slug: "SH601399",
    market: "cn",
    from: "2026-01-01",
    to: "2026-01-03",
    adjust: "qfq",
    fetchImpl: async () => jsonResponse({
      data: {
        sh601399: {
          day: [["2026-01-03", "2.70", "2.71", "2.72", "2.69", "1000"]],
        },
      },
    }),
  }),
  (error) => error?.code === "SOURCE_ADJUST_UNAVAILABLE",
  "Tencent raw-only responses must be unavailable instead of silently relabelled as qfq",
);

await assert.rejects(
  tool.fetchWithSourceFallback({
    requestedSource: "auto",
    previousSource: "tushare-pro",
    symbol: "600519",
    slug: "SH600519",
    market: "cn",
    from: "2026-01-01",
    to: "2026-01-03",
    adjust: "qfq",
    env: {},
  }),
  /TUSHARE_TOKEN/u,
  "an existing dataset is pinned to its provider instead of silently switching",
);

console.log("✓ Quant Lab pluggable market-data adapters, credentials and fallback contract");
