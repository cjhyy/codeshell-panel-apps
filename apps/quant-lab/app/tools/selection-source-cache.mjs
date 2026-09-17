import { readLocalSnapshot, writeLocalSnapshot } from "./local-snapshot-store.mjs";
import { SELECTION_SCAN_LIMITS } from "../selection-scan-contract.mjs";
import { retryAfterFailure, restoreSourceRetry, sourceRetryDue, sourceRetryPending, sourceRetryErrorCode } from "./selection-source-retry.mjs";

const QUOTE_STREAM = "a-share-selection-quotes";
const DIRECTORY_STREAM = "a-share-industry-directory";
const INTRADAY_TTL_MS = 3 * 60_000;
const DIRECTORY_MAX_AGE_MS = 7 * 86_400_000;

function sameSession(value, marketDate, provisional) {
  return value?.marketDate === marketDate && value?.session?.provisional === provisional;
}

function fresh(value, marketDate, provisional, now) {
  const age = now.getTime() - Date.parse(value?.generatedAt);
  return sameSession(value, marketDate, provisional) && Number.isFinite(age) && age >= 0 &&
    (!provisional || age < INTRADAY_TTL_MS);
}

function validQuoteCache(value, marketDate, provisional, now) {
  if (!fresh(value, marketDate, provisional, now) || !Number.isFinite(Date.parse(value.asOf)) ||
      value.asOf.slice(0, 10) !== marketDate || Date.parse(value.asOf) > now.getTime() ||
      (provisional && now.getTime() - Date.parse(value.asOf) >= INTRADAY_TTL_MS) ||
      !Array.isArray(value.quotes) || value.quotes.length < 4_000 || value.quotes.length > SELECTION_SCAN_LIMITS.stocks) return false;
  const seen = new Set();
  return value.quotes.every((row) => {
    if (!/^(?:SH6\d{5}|SZ[03]\d{5})$/u.test(row?.symbol) || seen.has(row.symbol) ||
        typeof row.name !== "string" || !row.name.trim() ||
        ["price", "open", "high", "low", "previousClose", "volume", "amount", "turnover", "changePercent", "floatMarketCap"]
          .some((key) => typeof row[key] !== "number" || !Number.isFinite(row[key])) ||
        row.price <= 0 || row.amount < 0 || row.volume < 0 || row.floatMarketCap < 0 ||
        row.high < Math.max(row.price, row.open) || row.low > Math.min(row.price, row.open)) return false;
    seen.add(row.symbol);
    return true;
  });
}

export async function selectionQuoteSnapshot({ root, persistent, marketDate, provisional, now, fetchQuotes,
  readSnapshot = readLocalSnapshot, writeSnapshot = writeLocalSnapshot }) {
  if (persistent) {
    for (const stream of ["a-share-realtime", QUOTE_STREAM]) {
      const cached = await readSnapshot({ root, stream, scope: "global" }).catch(() => null);
      if (validQuoteCache(cached, marketDate, provisional, now)) {
        return { quotes: cached.quotes, asOf: cached.asOf, cached: true };
      }
    }
  }
  const quotes = await fetchQuotes();
  return { quotes, cached: false,
    save: async (asOf) => {
      if (persistent) await writeSnapshot({ root, stream: QUOTE_STREAM, scope: "global", snapshot: {
        kind: QUOTE_STREAM, schemaVersion: 1, marketDate, asOf, generatedAt: now.toISOString(),
        session: { phase: provisional ? "intraday" : "close", provisional }, quotes,
      } });
    },
  };
}

function directoryRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > SELECTION_SCAN_LIMITS.sectors) return null;
  const seen = new Set();
  if (rows.some((row) => !/^new_[A-Za-z0-9]+$/u.test(row?.id) || typeof row.name !== "string" ||
    !row.name.trim() || seen.has(row.id) || (seen.add(row.id), false))) return null;
  return rows.map((row) => ({ ...row, count: Number.isInteger(row.count) && row.count >= 0 && row.count <= SELECTION_SCAN_LIMITS.membersPerSector ? row.count : 0 }));
}

function fallbackDirectory(cached, seeds, now) {
  const sources = [cached, ...seeds].filter(Boolean).sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));
  for (const source of sources) {
    const age = now.getTime() - Date.parse(source.dataAt ?? source.generatedAt);
    if (!Number.isFinite(age) || age < 0 || age > DIRECTORY_MAX_AGE_MS) continue;
    const rows = directoryRows(source.industries ?? source.sectorDirectory);
    // Recover identity only. Previous-day moves and membership totals must not
    // become today's market evidence or a false pagination completeness target.
    if (rows) return rows.map(({ id, name }) => ({ id, name, count: 0, changePercent: null, amount: null }));
  }
  return [];
}

export async function selectionIndustryDirectory({ root, persistent, marketDate, provisional, now,
  continueScan = false, seedSnapshots = [], fetchIndustries,
  readSnapshot = readLocalSnapshot, writeSnapshot = writeLocalSnapshot }) {
  const cached = persistent ? await readSnapshot({ root, stream: DIRECTORY_STREAM, scope: "global" }).catch(() => null) : null;
  const rows = directoryRows(cached?.industries);
  if (cached?.status === "ready" && rows && fresh(cached, marketDate, provisional, now)) {
    return { industries: rows, available: true, pending: false, nextRetryAt: null, sourceErrors: [] };
  }
  const retry = cached?.status === "failed" && sameSession(cached, marketDate, provisional)
    ? restoreSourceRetry(cached, now.getTime()) : null;
  const fallback = fallbackDirectory(cached, seedSnapshots, now);
  const unavailable = (reason, nextRetry) => ({
    industries: fallback, available: false, pending: sourceRetryPending(nextRetry),
    nextRetryAt: nextRetry?.nextRetryAt ?? null,
    sourceErrors: [{ source: "industries", errorCode: reason,
      message: fallback.length ? "行业接口暂不可用，保留已核验行业名称，涨跌与成员数等待重新核验" : "行业接口暂不可用，尚未取得可用目录", }],
  });
  if (continueScan && retry && !sourceRetryDue(retry, now.getTime())) return unavailable(cached.reason, retry);
  try {
    const payload = await fetchIndustries();
    const industries = directoryRows(payload);
    if (!industries) throw Object.assign(new Error("行业目录为空或结构无效"), {
      code: Array.isArray(payload) && payload.length === 0 ? "SOURCE_EMPTY" : "INDUSTRY_DIRECTORY_INVALID",
    });
    const returnedIds = new Set(industries.map((item) => item.id));
    if (fallback.some((item) => !returnedIds.has(item.id))) {
      throw Object.assign(new Error("行业目录覆盖不足，保留此前完整目录等待重新核验"), { code: "INDUSTRY_DIRECTORY_COVERAGE_LOW" });
    }
    if (persistent) await writeSnapshot({ root, stream: DIRECTORY_STREAM, scope: "global", snapshot: {
      kind: DIRECTORY_STREAM, schemaVersion: 1, marketDate, generatedAt: now.toISOString(), dataAt: now.toISOString(),
      session: { phase: provisional ? "intraday" : "close", provisional }, status: "ready", industries,
    } });
    return { industries, available: true, pending: false, nextRetryAt: null, sourceErrors: [] };
  } catch (error) {
    const reason = sourceRetryErrorCode(error);
    const nextRetry = retryAfterFailure(error, continueScan ? retry : null, now.getTime());
    if (persistent) await writeSnapshot({ root, stream: DIRECTORY_STREAM, scope: "global", snapshot: {
      kind: DIRECTORY_STREAM, schemaVersion: 1, marketDate, generatedAt: now.toISOString(),
      dataAt: cached?.dataAt ?? seedSnapshots.find((item) => item?.sectorDirectory?.length)?.generatedAt ?? now.toISOString(),
      session: { phase: provisional ? "intraday" : "close", provisional }, status: "failed", reason, retry: nextRetry, industries: fallback,
    } });
    return unavailable(reason, nextRetry);
  }
}
