/* Offline contract tests for the portfolio-valuation raw market sync CLI. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const toolPath = join(
  repositoryRoot,
  "apps/quant-lab/app/tools/fetch-portfolio-data.mjs",
);
const tool = await import(pathToFileURL(toolPath).href);

const temporaryRoots = [];
async function temporaryRoot() {
  const root = await mkdtemp(join(repositoryRoot, ".tmp-portfolio-data-"));
  temporaryRoots.push(root);
  return root;
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function yahooPayload({ symbol, exchangeTimezoneName, timestamps, name = symbol }) {
  return {
    chart: {
      result: [
        {
          meta: { symbol, exchangeTimezoneName, longName: name },
          timestamp: timestamps,
          indicators: {
            quote: [
              {
                open: timestamps.map((_, index) => 100 + index),
                high: timestamps.map((_, index) => 102 + index),
                low: timestamps.map((_, index) => 99 + index),
                close: timestamps.map((_, index) => 101 + index),
                volume: timestamps.map((_, index) => 1_000 + index),
              },
            ],
          },
        },
      ],
      error: null,
    },
  };
}

const fixedNow = () => new Date("2026-08-26T04:45:00.000Z");

try {
  const root = await temporaryRoot();
  await mkdir(join(root, "data/market"), { recursive: true });
  await writeFile(join(root, "data/market/AAPL.csv"), "research-sentinel\n", "utf8");
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("ifzq.gtimg.cn")) {
      return jsonResponse({
        data: {
          sh600519: {
            day: [
              ["2026-08-24", "1400", "1410", "1420", "1390", "10"],
              ["2026-08-25", "1410", "1425", "1430", "1405", "12"],
            ],
          },
        },
      });
    }
    if (String(url).startsWith("https://qt.gtimg.cn")) {
      return new Response("v_sh600519=\"1~Moutai~\"", { status: 200 });
    }
    if (String(url).includes("/chart/AAPL")) {
      return jsonResponse(
        yahooPayload({
          symbol: "AAPL",
          exchangeTimezoneName: "America/New_York",
          timestamps: [Date.parse("2026-07-01T20:00:00Z") / 1000],
          name: "Apple Inc.",
        }),
      );
    }
    if (String(url).includes("/chart/CNY%3DX")) {
      return jsonResponse(
        yahooPayload({
          symbol: "CNY=X",
          exchangeTimezoneName: "Europe/London",
          timestamps: [
            Date.parse("2026-07-01T23:00:00Z") / 1000,
            Date.parse("2026-01-15T00:00:00Z") / 1000,
          ],
          name: "USD/CNY",
        }),
      );
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const result = await tool.syncPortfolioData({
    rootDir: root,
    symbols: ["SH600519", "AAPL", "USDCNY"],
    from: "2026-01-01",
    to: "2026-08-25",
    fetchImpl,
    now: fixedNow,
    sleep: async () => {},
    minimumYahooIntervalMs: 0,
  });
  assert.equal(result.every((entry) => entry.status === "synced"), true);
  assert.equal(await readFile(join(root, "data/market/AAPL.csv"), "utf8"), "research-sentinel\n");

  const cnCsv = await readFile(join(root, "data/market-raw/SH600519.csv"), "utf8");
  assert.match(cnCsv, /^marketDate,availableAt,open,high,low,close,volume$/mu);
  assert.match(cnCsv, /2026-08-25,2026-08-25T07:00:00\.000Z,1410,1430,1405,1425,1200/u);
  const cnMeta = JSON.parse(
    await readFile(join(root, "data/market-raw/SH600519.meta.json"), "utf8"),
  );
  assert.equal(cnMeta.format, "codeshell.market-data");
  assert.equal(cnMeta.purpose, "portfolio-valuation");
  assert.equal(cnMeta.adjust, "none");
  assert.equal(cnMeta.source, "tencent-ifzq");
  assert.equal(cnMeta.name, "Moutai");
  assert.equal(cnMeta.bars, 2);
  assert.match(cnMeta.fingerprint, /^fnv1a32:[0-9a-f]{8}$/u);
  assert.equal(cnMeta.syncedAt, fixedNow().toISOString());
  assert.deepEqual(cnMeta.availableAt, {
    field: "availableAt",
    marketDateField: "marketDate",
    rule: "marketDate 15:00 Asia/Shanghai",
  });

  const aaplMeta = JSON.parse(
    await readFile(join(root, "data/market-raw/AAPL.meta.json"), "utf8"),
  );
  assert.equal(aaplMeta.source, "yahoo-chart");
  assert.equal(aaplMeta.adjust, "none");
  assert.equal(aaplMeta.sourceTimeZone, "America/New_York");
  const aaplCsv = await readFile(join(root, "data/market-raw/AAPL.csv"), "utf8");
  assert.match(aaplCsv, /2026-07-01,2026-07-01T20:00:00\.000Z/u);

  const fxMeta = JSON.parse(
    await readFile(join(root, "data/market-raw/USDCNY.meta.json"), "utf8"),
  );
  assert.equal(fxMeta.symbol, "USDCNY");
  assert.equal(fxMeta.upstreamSymbol, "CNY=X");
  assert.equal(fxMeta.direction, "USD/CNY");
  assert.equal(fxMeta.sourceTimeZone, "Europe/London");
  const fxCsv = await readFile(join(root, "data/market-raw/USDCNY.csv"), "utf8");
  // London summer time: 23:00Z is the next London calendar date.
  assert.match(fxCsv, /2026-07-02,2026-07-03T00:00:00\.000Z/u);
  // London winter time: 00:00Z remains the same source date.
  assert.match(fxCsv, /2026-01-15,2026-01-16T00:00:00\.000Z/u);
  assert.equal(calls.some((url) => url.includes("data/market")), false);

  // Existing cache contract conflicts fail before network and never rewrite.
  const conflictRoot = await temporaryRoot();
  await mkdir(join(conflictRoot, "data/market-raw"), { recursive: true });
  await writeFile(
    join(conflictRoot, "data/market-raw/AAPL.csv"),
    "marketDate,availableAt,open,high,low,close,volume\n2026-01-01,2026-01-01T21:00:00.000Z,1,1,1,1,1\n",
    "utf8",
  );
  await writeFile(
    join(conflictRoot, "data/market-raw/AAPL.meta.json"),
    `${JSON.stringify({
      format: "codeshell.market-data",
      version: 1,
      symbol: "AAPL",
      market: "us",
      purpose: "research",
      adjust: "adj",
      source: "yahoo-chart",
      fingerprint: "fnv1a32:00000000",
    })}\n`,
    "utf8",
  );
  let conflictFetches = 0;
  await assert.rejects(
    tool.syncPortfolioData({
      rootDir: conflictRoot,
      symbols: ["AAPL"],
      from: "2026-01-01",
      to: "2026-01-02",
      fetchImpl: async () => {
        conflictFetches += 1;
        throw new Error("must not fetch");
      },
      now: fixedNow,
    }),
    /existing cache contract conflict/u,
  );
  assert.equal(conflictFetches, 0);

  // A failed authoritative source keeps the old CSV/fingerprint/syncedAt and
  // marks the sidecar stale. It never switches source or writes a partial CSV.
  const staleRoot = await temporaryRoot();
  const firstFetch = async () =>
    jsonResponse(
      yahooPayload({
        symbol: "AAPL",
        exchangeTimezoneName: "America/New_York",
        timestamps: [Date.parse("2026-08-25T20:00:00Z") / 1000],
      }),
    );
  await tool.syncPortfolioData({
    rootDir: staleRoot,
    symbols: ["AAPL"],
    from: "2026-08-25",
    to: "2026-08-25",
    fetchImpl: firstFetch,
    now: fixedNow,
    minimumYahooIntervalMs: 0,
  });
  const oldCsv = await readFile(join(staleRoot, "data/market-raw/AAPL.csv"), "utf8");
  const oldMeta = JSON.parse(
    await readFile(join(staleRoot, "data/market-raw/AAPL.meta.json"), "utf8"),
  );
  const staleResult = await tool.syncPortfolioData({
    rootDir: staleRoot,
    symbols: ["AAPL"],
    from: "2026-08-25",
    to: "2026-08-25",
    fetchImpl: async () => {
      throw Object.assign(new Error("network unavailable"), { code: "NETWORK" });
    },
    now: () => new Date("2026-08-26T05:00:00.000Z"),
    minimumYahooIntervalMs: 0,
  });
  assert.equal(staleResult[0].status, "stale");
  assert.equal(await readFile(join(staleRoot, "data/market-raw/AAPL.csv"), "utf8"), oldCsv);
  const staleMeta = JSON.parse(
    await readFile(join(staleRoot, "data/market-raw/AAPL.meta.json"), "utf8"),
  );
  assert.equal(staleMeta.stale, true);
  assert.equal(staleMeta.syncedAt, oldMeta.syncedAt);
  assert.equal(staleMeta.fingerprint, oldMeta.fingerprint);
  assert.equal(staleMeta.source, "yahoo-chart");
  assert.equal(staleMeta.failure.code, "NETWORK");

  // Yahoo is serialized and a 429 retries the same authoritative URL once,
  // respecting Retry-After without replacing the source.
  const retryRoot = await temporaryRoot();
  const retryCalls = [];
  const sleeps = [];
  let attempt = 0;
  const retryResult = await tool.syncPortfolioData({
    rootDir: retryRoot,
    symbols: ["AAPL"],
    from: "2026-08-25",
    to: "2026-08-25",
    fetchImpl: async (url) => {
      retryCalls.push(String(url));
      attempt += 1;
      if (attempt === 1) {
        return new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "2" },
        });
      }
      return firstFetch();
    },
    now: fixedNow,
    sleep: async (milliseconds) => sleeps.push(milliseconds),
    minimumYahooIntervalMs: 1_000,
  });
  assert.equal(retryResult[0].status, "synced");
  assert.equal(retryCalls.length, 2);
  assert.equal(retryCalls[0], retryCalls[1]);
  assert(sleeps.some((milliseconds) => milliseconds >= 2_000));

  for (const symbol of ["../AAPL", "AAPL/../../x", "CNY=X", "HK.700", ""] ) {
    await assert.rejects(
      tool.syncPortfolioData({
        rootDir: await temporaryRoot(),
        symbols: [symbol],
        from: "2026-01-01",
        to: "2026-01-02",
        fetchImpl: firstFetch,
        now: fixedNow,
      }),
      /symbol/u,
    );
  }
  assert.throws(
    () => tool.validateCliOptions({ adjust: "adj", purpose: "portfolio-valuation" }),
    /adjust=none/u,
  );
  assert.throws(
    () => tool.validateCliOptions({ adjust: "none", purpose: "research" }),
    /purpose=portfolio-valuation/u,
  );
  assert.throws(
    () => tool.validateCliOptions({ adjust: "none", purpose: "portfolio-valuation", outDir: "data/market" }),
    /fixed to data\/market-raw/u,
  );

  const symlinkRoot = await temporaryRoot();
  await mkdir(join(symlinkRoot, "elsewhere"));
  await mkdir(join(symlinkRoot, "data"));
  await symlink(join(symlinkRoot, "elsewhere"), join(symlinkRoot, "data/market-raw"));
  await assert.rejects(
    tool.syncPortfolioData({
      rootDir: symlinkRoot,
      symbols: ["AAPL"],
      from: "2026-08-25",
      to: "2026-08-25",
      fetchImpl: firstFetch,
      now: fixedNow,
    }),
    /only real directories/u,
  );

  // Round 9: a narrow --from/--to sync must merge into the existing cache, not
  // truncate ten years of history down to the fetched window. Fetched bars win
  // inside the window; bars outside it are kept verbatim.
  const mergeRoot = await temporaryRoot();
  const mergeBars = (dates) =>
    yahooPayload({
      symbol: "AAPL",
      exchangeTimezoneName: "America/New_York",
      timestamps: dates.map((date) => Date.parse(`${date}T20:00:00Z`) / 1000),
    });
  await tool.syncPortfolioData({
    rootDir: mergeRoot,
    symbols: ["AAPL"],
    from: "2026-08-20",
    to: "2026-08-22",
    fetchImpl: async () => jsonResponse(mergeBars(["2026-08-20", "2026-08-21", "2026-08-22"])),
    now: fixedNow,
    minimumYahooIntervalMs: 0,
  });
  const mergeUrls = [];
  const mergeResult = await tool.syncPortfolioData({
    rootDir: mergeRoot,
    symbols: ["AAPL"],
    from: "2026-08-22",
    to: "2026-08-25",
    fetchImpl: async (url) => {
      mergeUrls.push(String(url));
      const payload = mergeBars(["2026-08-22", "2026-08-25"]);
      payload.chart.result[0].indicators.quote[0].close = [101.5, 102.5];
      return jsonResponse(payload);
    },
    now: () => new Date("2026-08-26T05:10:00.000Z"),
    minimumYahooIntervalMs: 0,
  });
  assert.equal(mergeResult[0].status, "synced", JSON.stringify(mergeResult[0]));
  assert.equal(mergeResult[0].bars, 4, "merged cache keeps bars outside the fetched window");
  const mergedCsv = await readFile(join(mergeRoot, "data/market-raw/AAPL.csv"), "utf8");
  const mergedDates = mergedCsv.trim().split("\n").slice(1).map((line) => line.split(",")[0]);
  assert.deepEqual(mergedDates, ["2026-08-20", "2026-08-21", "2026-08-22", "2026-08-25"]);
  assert.match(mergedCsv, /2026-08-22,2026-08-22T20:00:00\.000Z,100,102,99,101.5,1000/u);
  assert.match(mergedCsv, /2026-08-21,2026-08-21T20:00:00\.000Z,101,103,100,102,1001/u);
  const mergedMeta = JSON.parse(await readFile(join(mergeRoot, "data/market-raw/AAPL.meta.json"), "utf8"));
  assert.equal(mergedMeta.bars, 4);
  assert.equal(mergedMeta.from, "2026-08-20");
  assert.equal(mergedMeta.to, "2026-08-25");
  assert.equal(mergedMeta.stale, false);
  // Yahoo period1 starts one day before --from so a London/summer FX bar dated
  // --from (timestamp 23:00Z the previous day) is not dropped by the source.
  const mergePeriod1 = Number(/period1=(\d+)/u.exec(mergeUrls[0])[1]);
  assert.equal(mergePeriod1, Date.parse("2026-08-21T00:00:00Z") / 1000);

  // Retry-After is honoured only up to a bounded wait; a huge value is not
  // slept on. The failure is recorded (stale + retryAfterSeconds) instead.
  const hugeRetryRoot = await temporaryRoot();
  await tool.syncPortfolioData({
    rootDir: hugeRetryRoot,
    symbols: ["AAPL"],
    from: "2026-08-25",
    to: "2026-08-25",
    fetchImpl: firstFetch,
    now: fixedNow,
    minimumYahooIntervalMs: 0,
  });
  const hugeSleeps = [];
  let hugeAttempts = 0;
  const hugeResult = await tool.syncPortfolioData({
    rootDir: hugeRetryRoot,
    symbols: ["AAPL"],
    from: "2026-08-25",
    to: "2026-08-25",
    fetchImpl: async () => {
      hugeAttempts += 1;
      return new Response("rate limited", { status: 429, headers: { "retry-after": "3600" } });
    },
    now: fixedNow,
    sleep: async (milliseconds) => hugeSleeps.push(milliseconds),
    minimumYahooIntervalMs: 0,
  });
  assert.equal(hugeResult[0].status, "stale");
  assert.equal(hugeAttempts, 1, "an unreasonable Retry-After must not be retried");
  assert.equal(hugeSleeps.some((milliseconds) => milliseconds > 120_000), false);
  const hugeMeta = JSON.parse(await readFile(join(hugeRetryRoot, "data/market-raw/AAPL.meta.json"), "utf8"));
  assert.equal(hugeMeta.stale, true);
  assert.equal(hugeMeta.failure.code, "HTTP_429");
  assert.equal(hugeMeta.failure.retryAfterSeconds, 3600);

  console.log("✓ Quant Lab portfolio raw CLI offline source fixtures");
  console.log("✓ Quant Lab raw cache isolation, conflict and stale semantics");
  console.log("✓ Quant Lab Yahoo Retry-After and London source-date contract");
  console.log("✓ Quant Lab raw cache merge, bounded Retry-After and Yahoo window contract");
} finally {
  for (const root of temporaryRoots) {
    await rm(root, { recursive: true, force: true });
  }
}
