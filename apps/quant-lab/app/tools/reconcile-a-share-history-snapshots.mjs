import {
  A_SHARE_HISTORY_BASIS_VERSION,
  A_SHARE_RESEARCH_PRICE_CONTRACT,
  createRawFactorPriceBundle,
  readHistorySeries,
  sanitizeHistoryBars,
  seriesBytes,
  writeHistoryManifest,
  writeHistorySeries,
} from "./a-share-history-cache.mjs";
import { readLocalSnapshotHistory } from "./local-snapshot-store.mjs";

const SNAPSHOT_STREAM = "a-share-realtime";
const SNAPSHOT_SCOPE = "global";
const SNAPSHOT_HISTORY_LIMIT = 120;
const RECONCILE_CONCURRENCY = 12;

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const instant = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
}

function calendarAge(from, to) {
  return Math.floor((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

function closeMatches(left, right) {
  const first = Number(left);
  const second = Number(right);
  if (!Number.isFinite(first) || !Number.isFinite(second) || first <= 0 || second <= 0) return false;
  return Math.abs(first - second) <= 0.000001;
}

function weekdayDatesBetween(left, right, limit = 15) {
  if (!validDate(left) || !validDate(right) || left >= right) return [];
  const dates = [];
  const cursor = new Date(`${left}T00:00:00.000Z`);
  const end = Date.parse(`${right}T00:00:00.000Z`);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor.getTime() < end && dates.length < limit) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function normalizedCloseSnapshots(values) {
  const byDate = new Map();
  for (const snapshot of values) {
    if (
      snapshot?.kind !== "a-share-realtime-daily-snapshot" ||
      !["close", "previous-close"].includes(snapshot?.session?.phase) ||
      snapshot.session.provisional !== false ||
      !validDate(String(snapshot.marketDate ?? "")) ||
      !Array.isArray(snapshot.quotes)
    ) continue;
    const quotes = new Map();
    const universeSymbols = new Set();
    for (const quote of snapshot.quotes) {
      const symbol = String(quote?.symbol ?? "");
      if (!/^(?:SH|SZ)\d{6}$/u.test(symbol)) continue;
      universeSymbols.add(symbol);
      const [bar] = sanitizeHistoryBars([{
        date: snapshot.marketDate,
        open: quote.open,
        high: quote.high,
        low: quote.low,
        close: quote.price,
        volume: quote.volume,
      }]);
      const previousClose = Number(quote.previousClose);
      if (!bar || !Number.isFinite(previousClose) || previousClose <= 0) continue;
      quotes.set(symbol, Object.freeze({ bar, previousClose }));
    }
    if (!quotes.size) continue;
    byDate.set(snapshot.marketDate, Object.freeze({
      marketDate: snapshot.marketDate,
      asOf: Number.isFinite(Date.parse(snapshot.asOf)) ? new Date(snapshot.asOf).toISOString() : null,
      sessionPhase: snapshot.session.phase,
      quoteCount: Number.isInteger(snapshot.quoteCount) ? snapshot.quoteCount : snapshot.quotes.length,
      universeSymbols,
      quotes,
    }));
  }
  return [...byDate.values()].sort((left, right) => left.marketDate.localeCompare(right.marketDate));
}

function manifestRecordFor(series, bytes) {
  return Object.freeze({
    symbol: series.symbol,
    name: series.name,
    from: series.bars[0].date,
    to: series.bars.at(-1).date,
    bars: series.bars.length,
    bytes,
    updatedAt: series.updatedAt,
    source: series.source,
    priceModel: series.priceModel.kind,
    rawSource: series.priceModel.rawSource,
    factorSource: series.priceModel.factorSource,
    factorMethod: series.priceModel.factorMethod,
    basisContract: series.basis.contract,
    validationStatus: series.validation.status,
    confirmedThrough: series.validation.confirmedThrough,
  });
}

function recordUsableForResearch(record, marketDate, source) {
  const age = calendarAge(String(record?.to ?? ""), marketDate);
  return record?.source === source && Number(record?.bars) >= 60 && age >= 0 && age <= 10;
}

function snapshotValidation(date, now) {
  return Object.freeze({
    status: "snapshot-appended",
    checkedAt: now.toISOString(),
    overlapBars: 0,
    mismatchBars: 0,
    correctionBars: 0,
    confirmedThrough: date,
    provisionalBarExcluded: false,
  });
}

function appendSnapshots(series, snapshots, now) {
  const storedBars = series.priceModel.kind === "raw-factor" ? series.rawBars : series.bars;
  const additions = [];
  let previousClose = storedBars.at(-1)?.close;
  const after = snapshots.filter((snapshot) => snapshot.marketDate > storedBars.at(-1).date);
  let previousSnapshotDate = storedBars.at(-1).date;
  for (const snapshot of after) {
    const gapDates = weekdayDatesBetween(previousSnapshotDate, snapshot.marketDate);
    if (gapDates.length) {
      return Object.freeze({ series: null, added: 0, deferred: true, reason: "snapshot-gap", gapDates: Object.freeze(gapDates) });
    }
    previousSnapshotDate = snapshot.marketDate;
    const quote = snapshot.quotes.get(series.symbol);
    if (!quote) continue;
    if (!closeMatches(previousClose, quote.previousClose)) {
      return Object.freeze({ series: null, added: 0, deferred: true, reason: "price-discontinuity", gapDates: Object.freeze([]) });
    }
    additions.push(quote.bar);
    previousClose = quote.bar.close;
  }
  if (!additions.length) return Object.freeze({ series: null, added: 0, deferred: false, reason: null, gapDates: Object.freeze([]) });
  const latestDate = additions.at(-1).date;
  const base = {
    ...series,
    marketDate: latestDate,
    updatedAt: now.toISOString(),
    validation: snapshotValidation(latestDate, now),
  };
  if (series.priceModel.kind !== "raw-factor") {
    return Object.freeze({
      series: Object.freeze({ ...base, bars: Object.freeze([...series.bars, ...additions]) }),
      added: additions.length,
      deferred: false,
      reason: null,
      gapDates: Object.freeze([]),
    });
  }
  const latestFactor = series.adjustmentFactors.at(-1)?.factor;
  if (!Number.isFinite(latestFactor) || Math.abs(latestFactor - 1) > 0.000001) {
    return Object.freeze({ series: null, added: 0, deferred: true, reason: "factor-discontinuity", gapDates: Object.freeze([]) });
  }
  const bundle = createRawFactorPriceBundle({
    rawBars: [...series.rawBars, ...additions],
    adjustmentFactors: [
      ...series.adjustmentFactors,
      ...additions.map((bar) => Object.freeze({ date: bar.date, factor: 1 })),
    ],
    source: series.source,
    factorSource: series.priceModel.factorSource,
    factorMethod: series.priceModel.factorMethod,
    generatedAt: now.toISOString(),
  });
  return Object.freeze({
    series: Object.freeze({
      ...base,
      rawBars: bundle.rawBars,
      adjustmentFactors: bundle.adjustmentFactors,
      priceModel: bundle.priceModel,
      bars: bundle.bars,
    }),
    added: additions.length,
    deferred: false,
    reason: null,
    gapDates: Object.freeze([]),
  });
}

async function mapWithConcurrency(values, concurrency, callback) {
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      await callback(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
}

export async function reconcileAShareHistorySnapshots({
  root = process.cwd(),
  manifest,
  now = new Date(),
  snapshotLimit = SNAPSHOT_HISTORY_LIMIT,
} = {}) {
  if (!manifest || !Number.isFinite(now.getTime())) return manifest;
  const snapshots = normalizedCloseSnapshots(await readLocalSnapshotHistory({
    root,
    stream: SNAPSHOT_STREAM,
    scope: SNAPSHOT_SCOPE,
    limit: snapshotLimit,
  }));
  if (!snapshots.length) return manifest;
  const latestSnapshot = snapshots.at(-1);
  const recentSnapshotCoverage = snapshots.slice(-5).map((snapshot) => Object.freeze({
    date: snapshot.marketDate,
    count: snapshot.universeSymbols.size,
    phase: snapshot.marketDate === latestSnapshot.marketDate ? snapshot.sessionPhase ?? "close" : "close",
  }));
  const storedRecords = Array.isArray(manifest.records) ? manifest.records : [];
  const completeUniverseSnapshot = manifest.scope === "full" &&
    latestSnapshot.marketDate >= manifest.marketDate &&
    latestSnapshot.quoteCount === latestSnapshot.universeSymbols.size &&
    latestSnapshot.quoteCount >= Math.ceil(manifest.total * 0.98);
  const records = completeUniverseSnapshot
    ? storedRecords.filter((record) => latestSnapshot.universeSymbols.has(record.symbol))
    : storedRecords;
  const universePruned = storedRecords.length - records.length;
  const excludedSymbols = new Set(
    (Array.isArray(manifest.excludedSymbols) ? manifest.excludedSymbols : [])
      .map(String)
      .filter((symbol) => /^(?:SH|SZ)\d{6}$/u.test(symbol)),
  );
  if (completeUniverseSnapshot) {
    for (const record of storedRecords) {
      if (/^(?:SH|SZ)\d{6}$/u.test(String(record?.symbol ?? "")) && !latestSnapshot.universeSymbols.has(record.symbol)) {
        excludedSymbols.add(record.symbol);
      }
    }
    for (const symbol of latestSnapshot.universeSymbols) excludedSymbols.delete(symbol);
  }
  const nextRecords = new Map(records.map((record) => [record.symbol, record]));
  const candidates = records.filter((record) =>
    /^(?:SH|SZ)\d{6}$/u.test(record?.symbol) &&
    record.source === manifest.source &&
    validDate(String(record.to ?? "")) &&
    record.to < latestSnapshot.marketDate,
  );
  let backfilledSeries = 0;
  let backfilledBars = 0;
  let deferred = 0;
  let gapSeries = 0;
  const gapDates = new Set();
  await mapWithConcurrency(candidates, RECONCILE_CONCURRENCY, async (record) => {
    const series = await readHistorySeries(record.symbol, root);
    if (!series || series.source !== manifest.source) return;
    const result = appendSnapshots(series, snapshots, now);
    if (result.deferred) {
      deferred += 1;
      if (result.reason === "snapshot-gap") {
        gapSeries += 1;
        for (const date of result.gapDates) gapDates.add(date);
      }
      return;
    }
    if (!result.series) return;
    const saved = await writeHistorySeries(result.series, root);
    nextRecords.set(record.symbol, manifestRecordFor(saved.series, saved.bytes));
    backfilledSeries += 1;
    backfilledBars += result.added;
  });
  const sameDeferredState = manifest.snapshotBackfillThrough === latestSnapshot.marketDate &&
    manifest.snapshotBackfillDeferred === deferred &&
    manifest.snapshotGapSeries === gapSeries &&
    JSON.stringify(manifest.snapshotGapDates ?? []) === JSON.stringify([...gapDates].sort().slice(0, 15));
  const sameSnapshotCoverage = JSON.stringify(manifest.recentSnapshotCoverage ?? []) === JSON.stringify(recentSnapshotCoverage);
  if (
    backfilledSeries === 0 &&
    universePruned === 0 &&
    (deferred === 0 || sameDeferredState) &&
    sameSnapshotCoverage
  ) return manifest;
  const sortedRecords = [...nextRecords.values()].sort((left, right) => left.symbol.localeCompare(right.symbol));
  const dates = sortedRecords.flatMap((record) => [record.from, record.to]).filter(validDate).sort();
  const ready = Math.min(
    manifest.total,
    sortedRecords.filter((record) => recordUsableForResearch(record, latestSnapshot.marketDate, manifest.source)).length,
  );
  const rawFactorReady = sortedRecords.filter((record) => record.priceModel === "raw-factor").length;
  const legacyVendorAdjusted = sortedRecords.length - rawFactorReady;
  const legacyContract = `${manifest.source}:cn:1d:qfq:v${A_SHARE_HISTORY_BASIS_VERSION}`;
  const auditEvent = Object.freeze({
    at: now.toISOString(),
    kind: backfilledSeries > 0 ? "snapshot-fill" : "snapshot-check",
    from: manifest.confirmedThrough ?? manifest.to ?? null,
    through: latestSnapshot.marketDate,
    requestedGapDates: [...gapDates].sort().slice(0, 15),
    updatedSeries: backfilledSeries,
    addedBars: backfilledBars,
    skippedSeries: Math.max(0, candidates.length - backfilledSeries - deferred),
    failedSeries: 0,
    status: deferred > 0 ? "partial" : "complete",
  });
  const previousAudit = Array.isArray(manifest.auditTrail)
    ? manifest.auditTrail.filter((event) => event?.at !== auditEvent.at).slice(-4)
    : [];
  const next = Object.freeze({
    ...manifest,
    marketDate: latestSnapshot.marketDate,
    asOf: latestSnapshot.asOf ?? manifest.asOf,
    updatedAt: now.toISOString(),
    ready,
    remaining: Math.max(0, manifest.total - ready),
    cached: sortedRecords.length,
    bars: sortedRecords.reduce((sum, record) => sum + Number(record.bars ?? 0), 0),
    storageBytes: sortedRecords.reduce((sum, record) => sum + Number(record.bytes ?? 0), 0),
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
    rawFactorReady,
    legacyVendorAdjusted,
    priceModel: legacyVendorAdjusted === 0
      ? "raw-factor"
      : rawFactorReady === 0
        ? "legacy-vendor-qfq"
        : "mixed-migration",
    sessionPhase: "close",
    provisional: false,
    confirmedThrough: dates.at(-1) ?? null,
    basisContract: rawFactorReady > 0 ? A_SHARE_RESEARCH_PRICE_CONTRACT : legacyContract,
    snapshotBackfillAt: now.toISOString(),
    snapshotBackfillThrough: latestSnapshot.marketDate,
    snapshotBackfilledSeries: backfilledSeries,
    snapshotBackfilledBars: backfilledBars,
    snapshotBackfillDeferred: deferred,
    snapshotGapSeries: gapSeries,
    snapshotGapDates: [...gapDates].sort().slice(0, 15),
    recentSnapshotCoverage,
    excludedSymbols: [...excludedSymbols].sort(),
    auditTrail: [...previousAudit, auditEvent],
    records: sortedRecords,
  });
  await writeHistoryManifest(next, root);
  return next;
}
