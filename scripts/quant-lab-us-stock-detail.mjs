import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(repositoryRoot, "apps", "quant-lab", "app");
const detail = await import(pathToFileURL(join(appDir, "us-stock-detail.mjs")).href);
const detailUi = await import(pathToFileURL(join(appDir, "modules", "a-share-stock-detail-ui.mjs")).href);
const detailTool = await import(pathToFileURL(join(appDir, "tools", "fetch-us-stock.mjs")).href);
const localSnapshots = await import(pathToFileURL(join(appDir, "tools", "local-snapshot-store.mjs")).href);

const searchPayload = {
  quotes: [
    { exchange: "NMS", shortname: "Apple Inc.", quoteType: "EQUITY", symbol: "AAPL", exchDisp: "NASDAQ", sector: "Technology", industry: "Consumer Electronics" },
    { exchange: "NYQ", shortname: "Apple Hospitality REIT, Inc.", quoteType: "EQUITY", symbol: "APLE", exchDisp: "NYSE" },
    { exchange: "PNK", shortname: "Apple Tree", quoteType: "EQUITY", symbol: "APPL", exchDisp: "OTC" },
  ],
};
assert.equal(detail.canonicalUsSymbol("brk/b"), "BRK-B");
assert.equal(detail.canonicalUsSymbol("Apple Inc"), null);
assert.deepEqual(detail.parseYahooStockSuggestions(searchPayload, "Apple").map((item) => item.symbol), ["AAPL", "APLE"]);
assert.equal(detail.resolveYahooStockSuggestion(searchPayload, "Apple").symbol, "AAPL");
assert.equal(detail.resolveYahooStockSuggestion(searchPayload, "AAPL").symbol, "AAPL");

const start = Date.parse("2026-04-30T20:00:00.000Z");
const timestamps = Array.from({ length: 121 }, (_value, index) => Math.floor((start + index * 24 * 60 * 60 * 1_000) / 1_000));
const closes = timestamps.map((_value, index) => 180 + index * 0.5);
const chartPayload = {
  chart: {
    error: null,
    result: [{
      meta: {
        currency: "USD",
        symbol: "AAPL",
        exchangeName: "NMS",
        fullExchangeName: "NasdaqGS",
        instrumentType: "EQUITY",
        regularMarketTime: Math.floor(Date.parse("2026-08-28T20:00:00.000Z") / 1_000),
        regularMarketPrice: 240,
        chartPreviousClose: 238,
        regularMarketDayHigh: 242,
        regularMarketDayLow: 235,
        regularMarketVolume: 50_000_000,
        longName: "Apple Inc.",
        currentTradingPeriod: {
          regular: {
            start: Math.floor(Date.parse("2026-08-28T13:30:00.000Z") / 1_000),
            end: Math.floor(Date.parse("2026-08-28T20:00:00.000Z") / 1_000),
          },
        },
      },
      timestamp: timestamps,
      indicators: {
        quote: [{
          open: closes.map((value) => value - 1),
          high: closes.map((value) => value + 2),
          low: closes.map((value) => value - 3),
          close: closes,
          volume: closes.map((_value, index) => index === 120 ? 50_000_000 : 40_000_000),
        }],
        adjclose: [{ adjclose: closes.map((value) => value * 0.98) }],
      },
    }],
  },
};
const identity = detail.resolveYahooStockSuggestion(searchPayload, "Apple");
const snapshot = detail.buildUsStockDetailSnapshot(chartPayload, identity, new Date("2026-08-30T04:00:00.000Z"));
assert.equal(snapshot.kind, "us-stock-detail-snapshot");
assert.equal(snapshot.market, "us");
assert.equal(snapshot.stock.symbol, "AAPL");
assert.equal(snapshot.stock.currency, "USD");
assert.equal(snapshot.session.phase, "previous-close");
assert.equal(snapshot.bars.length, 121);
assert.equal(snapshot.historyAdjust, "adj");
assert.equal(snapshot.sources[1].url.startsWith("https://www.sec.gov/"), true);

const parsed = detailUi.parseAShareStockDetailSnapshot(JSON.stringify(snapshot));
assert.equal(parsed.market, "us");
assert.equal(parsed.stock.exchange, "NasdaqGS");
assert.equal(parsed.metrics.historyBars, 121);
assert.equal(parsed.historyAdjust, "adj");
assert.equal(detailUi.stockDetailRuntimeArgs("node", "AAPL", "read-local", "us").at(-3), "us");
assert.throws(() => detailUi.stockDetailRuntimeArgs("node", "Apple", "read-local", "us"), /需要股票代码/u);
assert.equal(detailTool.yahooSearchUrl("Apple").origin, "https://query1.finance.yahoo.com");
assert.match(detailTool.yahooChartUrl("BRK-B").pathname, /BRK-B$/u);

const localRoot = await mkdtemp(join(tmpdir(), "quant-lab-us-stock-"));
try {
  const written = await localSnapshots.writeLocalSnapshot({ root: localRoot, stream: "us-stock", scope: "US-AAPL", snapshot });
  assert.match(written.latestPath, /snapshots\/us-stock\/US-AAPL\/latest\.json$/u);
  const restored = await localSnapshots.readLocalSnapshot({ root: localRoot, stream: "us-stock", scope: "US-AAPL" });
  assert.equal(restored.stock.symbol, "AAPL");
} finally {
  await rm(localRoot, { recursive: true, force: true });
}

console.log("✓ Quant Lab US name search, adjusted history, timing and local snapshot contract");
