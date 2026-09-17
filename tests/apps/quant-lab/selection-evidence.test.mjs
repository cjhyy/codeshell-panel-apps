import assert from "node:assert/strict";
import test from "node:test";
import { parseAShareSelectionSnapshot } from "../../../apps/quant-lab/app/modules/a-share-selection-ui.mjs";
import {
  parseSelectionResearchEvidence,
  renderSelectionResearchEvidence,
  selectionResearchEvidenceRows,
} from "../../../apps/quant-lab/app/modules/selection-evidence-ui.mjs";

const context = { marketDate: "2026-09-11", generatedAt: "2026-09-11T16:00:00+08:00" };
const candidate = { symbol: "SH600000", lastBarDate: context.marketDate };

function evidence() {
  return {
    version: 1, status: "partial", reason: "",
    providers: {
      stockstats: { available: true, supported: true, version: "0.6.8" },
      efinance: { available: true, supported: true, version: "0.5.5.2" },
      easyTdx: { available: false, supported: false, version: null, reason: "UPSTREAM_API_UNVERIFIED" },
    },
    stocks: [{
      symbol: candidate.symbol,
      technical: {
        available: true, asOf: context.marketDate, adjustment: "qfq", barCount: 180,
        rsi14: 53, atr14: 0.5, atrPercent: 2, macd: -0.1, macdSignal: -0.2, adx14: 25,
        calculation: { rsi: "stockstats rsi_14", adx: "stockstats dx_14; Wilder alpha=1/14, adjust=True", unknown: "discard" },
      },
      fundamentals: {
        available: true, observedAt: "2026-09-11T15:59:00+08:00", reportDate: null, disclosureDate: null,
        pe: 8, pb: 1.2, roe: 12.5, netProfitMargin: null, revenueYoY: null, profitYoY: null,
      },
      quoteCheck: { available: false, reason: "UPSTREAM_API_UNVERIFIED" },
      score: 99,
    }],
  };
}

function snapshot(researchEvidence) {
  return {
    schemaVersion: 1, kind: "a-share-selection-snapshot", ...context,
    asOf: "2026-09-11T15:00:00+08:00", session: { phase: "close", provisional: false, previousClose: false },
    market: {
      state: "rotation", candidateLimit: 2, reason: "测试行情",
      breadth: { total: 100, up: 60, down: 30, flat: 10, netBreadth: 0.3, limitUp: 1, limitDown: 0, amount: 1_000_000 },
    },
    sectors: [], sectorDirectory: [], watch: { stocks: [], sectors: [] }, elapsedMs: 100,
    ...(researchEvidence === undefined ? {} : { researchEvidence }),
  };
}

test("old or invalid optional evidence cannot hide the base selection snapshot", () => {
  const old = parseAShareSelectionSnapshot(JSON.stringify(snapshot()));
  assert.equal(old.researchEvidence.status, "unavailable");
  assert.match(old.researchEvidence.reason, /尚未补充/u);
  for (const malformed of [false, [], { version: 8 }, { ...evidence(), stocks: Array(21).fill({}) }]) {
    const parsed = parseAShareSelectionSnapshot(JSON.stringify(snapshot(malformed)));
    assert.equal(parsed.market.breadth.total, 100);
    assert.equal(parsed.researchEvidence.status, "unavailable");
  }
});

test("parse and preserve valid evidence without adding financial or signal claims", () => {
  const parsed = parseAShareSelectionSnapshot(JSON.stringify(snapshot(evidence()))).researchEvidence;
  assert.equal(parsed.stocks[0].technical.rsi14, 53);
  assert.equal(parsed.stocks[0].fundamentals.profitYoY, null);
  assert.equal(parsed.stocks[0].fundamentals.netProfitMargin, null);
  assert.equal(parsed.stocks[0].score, undefined);
  assert.equal(parsed.stocks[0].technical.calculation.unknown, undefined);
  assert.match(parsed.stocks[0].technical.calculation.adx, /Wilder/u);
  assert(Object.isFrozen(parsed.stocks[0].technical));
  const rows = selectionResearchEvidenceRows(candidate, parsed, context);
  assert.match(rows[0].metrics, /RSI14 53\.0.*ATR 2\.00%.*趋势强度 25\.0/u);
  assert.equal(rows[1].status, "仅当前截面");
  assert.match(rows[1].detail, /净利率 —/u);
  assert.equal(rows[2].status, "仍缺证据");
  assert.match(rows[2].detail, /不能用于历史时点筛选/u);
  assert.match(rows[3].detail, /上游接口当前未验证/u);
});

test("missing or malformed indicators stay null and only downgrade technical evidence", () => {
  for (const invalid of [null, undefined, "53", "", true, NaN, Infinity, -1, 101]) {
    const input = evidence();
    input.stocks[0].technical.rsi14 = invalid;
    const parsed = parseSelectionResearchEvidence(input, context);
    assert.equal(parsed.stocks[0].technical.available, false);
    assert.equal(parsed.stocks[0].technical.rsi14, null);
    assert.equal(parsed.stocks[0].fundamentals.available, true);
    assert.match(selectionResearchEvidenceRows(candidate, parsed, context)[0].metrics, /RSI14 —/u);
  }
  const warmup = evidence();
  warmup.stocks[0].technical.barCount = 119;
  assert.equal(parseSelectionResearchEvidence(warmup, context).stocks[0].technical.available, false);
});

test("stale and future technical dates cannot support complete-close evidence", () => {
  for (const asOf of ["2026-09-10", "2026-09-12", "2026-02-30", "2026-09-11T15:00:00Z"]) {
    const input = evidence();
    input.stocks[0].technical.asOf = asOf;
    assert.equal(parseSelectionResearchEvidence(input, context).stocks[0].technical.available, false);
  }
  const intraday = evidence();
  intraday.stocks[0].technical.asOf = "2026-09-10";
  const parsed = parseSelectionResearchEvidence(intraday, { ...context, provisional: true });
  assert.equal(parsed.stocks[0].technical.available, true);
  assert.match(selectionResearchEvidenceRows(candidate, parsed, { ...context, provisional: true })[0].detail, /指标 2026-09-10/u);
});

test("current financial snapshots never acquire fabricated disclosure dates", () => {
  for (const changes of [
    { reportDate: "2026-06-30" },
    { disclosureDate: "2026-08-31" },
    { observedAt: "2026-09-12T00:00:00Z" },
    { observedAt: "2026-09-11T15:59:00" },
    { roe: "12.5" },
  ]) {
    const input = evidence();
    Object.assign(input.stocks[0].fundamentals, changes);
    const parsed = parseSelectionResearchEvidence(input, context).stocks[0];
    assert.equal(parsed.fundamentals.available, false);
    assert.equal(parsed.fundamentals.reportDate, null);
    assert.equal(parsed.technical.available, true);
  }
});

test("unsupported packages and unavailable payloads retain per-stock explanations", () => {
  const unsupported = evidence();
  unsupported.providers.stockstats.supported = false;
  unsupported.providers.stockstats.reason = "PACKAGE_VERSION_UNVERIFIED";
  const parsed = parseSelectionResearchEvidence(unsupported, context);
  assert.equal(parsed.providers.stockstats.available, false);
  assert.equal(parsed.stocks[0].technical.available, false);

  const missing = evidence();
  missing.status = "unavailable";
  missing.stocks[0].technical = { available: false, reason: "INDICATOR_WARMUP_REQUIRED", barCount: 90, asOf: context.marketDate };
  missing.stocks[0].fundamentals = { available: false, reason: "PROVIDER_TIMEOUT" };
  const unavailable = parseSelectionResearchEvidence(missing, context);
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.stocks.length, 1);
  assert.equal(unavailable.stocks[0].technical.barCount, 90);
  assert.match(selectionResearchEvidenceRows(candidate, unavailable, context)[0].detail, /不足 120 根/u);
});

test("deduplicate canonical stock identities and reject mismatched exchanges", () => {
  const input = evidence();
  input.stocks.push(input.stocks[0], { ...input.stocks[0], symbol: "SH000001" });
  const parsed = parseSelectionResearchEvidence(input, context);
  assert.equal(parsed.stocks.length, 1);
  assert.equal(parsed.status, "partial");
  assert.match(parsed.reason, /重复/u);
});

test("quotes retain their observation time without asserting matching prices", () => {
  const input = evidence();
  input.stocks[0].quoteCheck = { available: true, asOf: context.marketDate, price: 15.5, adjustment: "none" };
  const parsed = parseSelectionResearchEvidence(input, context);
  assert.equal(parsed.stocks[0].quoteCheck.price, 15.5);
  assert.match(selectionResearchEvidenceRows(candidate, parsed, context)[3].detail, /未据此判定一致/u);
  input.stocks[0].quoteCheck.price = "15.5";
  assert.equal(parseSelectionResearchEvidence(input, context).stocks[0].quoteCheck.available, false);
});

test("both full candidate and compact waiting rows expose all evidence gaps", () => {
  const element = (tag, className, content = "") => ({
    tag, className, content, dataset: {}, children: [], append(...items) { this.children.push(...items); },
  });
  const flatten = (node) => [node.content, ...node.children.map(flatten)].join(" ");
  for (const compact of [false, true]) {
    const rendered = renderSelectionResearchEvidence(candidate, parseSelectionResearchEvidence(evidence(), context), { ...context, compact, element });
    assert.equal(rendered.tag, compact ? "details" : "section");
    assert.match(flatten(rendered), /核验完整性/u);
    assert.match(flatten(rendered), /财务披露时点 \/ 现金流/u);
    assert.match(flatten(rendered), /这还不是完整的基本面筛选/u);
    assert.match(flatten(rendered), /easy_tdx/u);
  }
});
