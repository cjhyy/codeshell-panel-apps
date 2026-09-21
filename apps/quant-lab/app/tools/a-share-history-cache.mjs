import { mkdir, open, readFile, readdir, rename, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";

import { historyDataSource } from "../market-data-sources.mjs";

export const A_SHARE_HISTORY_SCHEMA_VERSION = 1;
export const A_SHARE_HISTORY_KIND = "a-share-history-series";
export const A_SHARE_HISTORY_MANIFEST_KIND = "a-share-history-library";
export const A_SHARE_HISTORY_RUN_KIND = "a-share-history-run";
export const A_SHARE_HISTORY_DIRECTORY = "a-share-history/v1";
export const A_SHARE_HISTORY_DEFAULT_SOURCE = "tencent-ifzq";
export const A_SHARE_HISTORY_BASIS_VERSION = 1;
export const A_SHARE_RESEARCH_PRICE_VERSION = 1;
export const A_SHARE_RESEARCH_PRICE_CONTRACT = "canonical:cn:1d:qfq:raw-factor:v1";
const HISTORY_RUN_STALE_MS = 13 * 60 * 60 * 1_000;
const HISTORY_PRICE_FIELDS = Object.freeze(["open", "high", "low", "close"]);
const HISTORY_PRICE_RELATIVE_TOLERANCE = 0.0001;

export function isAShareHistorySource(value) {
  const source = historyDataSource(String(value ?? ""));
  return Boolean(source?.markets.includes("cn") && source.adjustments.includes("qfq"));
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const instant = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function sanitizeHistoryBars(values) {
  if (!Array.isArray(values)) return [];
  const byDate = new Map();
  for (const value of values) {
    const date = String(value?.date ?? "");
    const openValue = finite(value?.open);
    const highValue = finite(value?.high);
    const lowValue = finite(value?.low);
    const closeValue = finite(value?.close);
    const volumeValue = finite(value?.volume);
    if (
      !validDate(date) ||
      [openValue, highValue, lowValue, closeValue].some((item) => item == null || item <= 0) ||
      volumeValue == null ||
      volumeValue < 0 ||
      highValue < Math.max(openValue, closeValue) ||
      lowValue > Math.min(openValue, closeValue)
    ) continue;
    byDate.set(date, Object.freeze({
      date,
      open: openValue,
      high: highValue,
      low: lowValue,
      close: closeValue,
      volume: Math.round(volumeValue),
    }));
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function sanitizeAdjustmentFactors(values) {
  if (!Array.isArray(values)) return [];
  const byDate = new Map();
  for (const value of values) {
    const date = String(value?.date ?? "");
    const factor = finite(value?.factor);
    if (!validDate(date) || factor == null || factor <= 0 || factor > 1_000_000) continue;
    byDate.set(date, Object.freeze({ date, factor }));
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function roundedPrice(value) {
  return Number(Number(value).toFixed(8));
}

export function deriveQfqResearchBars(rawBarsInput, factorsInput) {
  const rawBars = sanitizeHistoryBars(rawBarsInput);
  const factors = sanitizeAdjustmentFactors(factorsInput);
  const byDate = new Map(factors.map((item) => [item.date, item.factor]));
  if (!rawBars.length || factors.length !== rawBars.length || rawBars.some((bar) => !byDate.has(bar.date))) {
    throw new Error("A_SHARE_HISTORY_FACTOR_COVERAGE_INVALID");
  }
  return Object.freeze(rawBars.map((bar) => {
    const factor = byDate.get(bar.date);
    return Object.freeze({
      date: bar.date,
      open: roundedPrice(bar.open * factor),
      high: roundedPrice(bar.high * factor),
      low: roundedPrice(bar.low * factor),
      close: roundedPrice(bar.close * factor),
      volume: bar.volume,
    });
  }));
}

export function deriveAdjustmentFactors(rawBarsInput, adjustedBarsInput) {
  const rawBars = sanitizeHistoryBars(rawBarsInput);
  const adjustedBars = sanitizeHistoryBars(adjustedBarsInput);
  const adjustedByDate = new Map(adjustedBars.map((bar) => [bar.date, bar]));
  if (!rawBars.length || adjustedBars.length !== rawBars.length || rawBars.some((bar) => !adjustedByDate.has(bar.date))) {
    throw new Error("A_SHARE_HISTORY_FACTOR_INPUT_INVALID");
  }
  const ratios = rawBars.map((bar) => ({
    date: bar.date,
    ratio: adjustedByDate.get(bar.date).close / bar.close,
  }));
  const latestRatio = ratios.at(-1)?.ratio;
  if (!Number.isFinite(latestRatio) || latestRatio <= 0) {
    throw new Error("A_SHARE_HISTORY_FACTOR_INPUT_INVALID");
  }
  return Object.freeze(ratios.map((item) => Object.freeze({
    date: item.date,
    factor: Number((item.ratio / latestRatio).toFixed(12)),
  })));
}

export function createRawFactorPriceBundle({
  rawBars,
  adjustmentFactors = null,
  adjustedBars = null,
  source,
  factorSource = source,
  factorMethod,
  generatedAt = new Date().toISOString(),
}) {
  if (!isAShareHistorySource(source) || !isAShareHistorySource(factorSource)) {
    throw new Error("A_SHARE_HISTORY_PRICE_SOURCE_INVALID");
  }
  const raw = sanitizeHistoryBars(rawBars);
  const factors = adjustmentFactors == null
    ? deriveAdjustmentFactors(raw, adjustedBars)
    : sanitizeAdjustmentFactors(adjustmentFactors);
  const bars = deriveQfqResearchBars(raw, factors);
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("A_SHARE_HISTORY_PRICE_TIME_INVALID");
  if (!["official-adj-factor", "derived-qfq-ratio", "identity-test-fixture"].includes(factorMethod)) {
    throw new Error("A_SHARE_HISTORY_FACTOR_METHOD_INVALID");
  }
  return Object.freeze({
    rawBars: Object.freeze(raw),
    adjustmentFactors: Object.freeze(factors),
    bars,
    priceModel: Object.freeze({
      kind: "raw-factor",
      version: A_SHARE_RESEARCH_PRICE_VERSION,
      contract: A_SHARE_RESEARCH_PRICE_CONTRACT,
      rawSource: source,
      factorSource,
      factorMethod,
      factorAsOf: factors.at(-1)?.date ?? null,
      generatedAt: new Date(generatedAt).toISOString(),
    }),
  });
}

function cacheRoot(root = process.cwd()) {
  return resolve(root, A_SHARE_HISTORY_DIRECTORY);
}

function seriesPath(symbol, root) {
  if (!/^(?:SH|SZ)\d{6}$/u.test(symbol)) throw new Error("A_SHARE_HISTORY_SYMBOL_INVALID");
  return resolve(cacheRoot(root), "series", `${symbol}.json`);
}

export function historyManifestPath(root = process.cwd()) {
  return resolve(cacheRoot(root), "manifest.json");
}

export function historyRunStatePath(root = process.cwd()) {
  return resolve(cacheRoot(root), "initializing.json");
}

async function atomicWrite(path, content) {
  await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

function parseHistoryRunState(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schemaVersion !== A_SHARE_HISTORY_SCHEMA_VERSION ||
    value.kind !== A_SHARE_HISTORY_RUN_KIND ||
    !Number.isInteger(value.pid) ||
    value.pid <= 0 ||
    typeof value.token !== "string" ||
    value.token.length < 8 ||
    value.token.length > 160 ||
    !["core", "broad", "full"].includes(value.scope) ||
    !isAShareHistorySource(value.source) ||
    !Number.isFinite(Date.parse(value.startedAt)) ||
    !Number.isFinite(Date.parse(value.heartbeatAt))
  ) return null;
  return Object.freeze({
    schemaVersion: A_SHARE_HISTORY_SCHEMA_VERSION,
    kind: A_SHARE_HISTORY_RUN_KIND,
    pid: value.pid,
    token: value.token,
    scope: value.scope,
    source: value.source,
    startedAt: new Date(value.startedAt).toISOString(),
    heartbeatAt: new Date(value.heartbeatAt).toISOString(),
  });
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export async function readActiveHistoryRunState(root = process.cwd(), now = new Date()) {
  const path = historyRunStatePath(root);
  let state = null;
  let file = null;
  try {
    const content = await readFile(path, "utf8");
    state = parseHistoryRunState(JSON.parse(content));
    file = await stat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (!(error instanceof SyntaxError)) throw error;
    file = await stat(path).catch((statError) => statError?.code === "ENOENT" ? null : Promise.reject(statError));
  }
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  const active = state &&
    Number.isFinite(nowMs) &&
    nowMs - Date.parse(state.heartbeatAt) <= HISTORY_RUN_STALE_MS &&
    processAlive(state.pid);
  if (active) return state;
  const incompleteRecentWrite = !state && file && Number.isFinite(nowMs) && nowMs - file.mtimeMs < 5_000;
  if (incompleteRecentWrite) return null;
  if (file) {
    await unlink(path).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  return null;
}

export async function acquireHistoryRunState(input, root = process.cwd()) {
  const path = historyRunStatePath(root);
  await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await readActiveHistoryRunState(root, input.now);
    if (existing) return Object.freeze({ acquired: false, state: existing });
    const startedAt = input.now.toISOString();
    const state = Object.freeze({
      schemaVersion: A_SHARE_HISTORY_SCHEMA_VERSION,
      kind: A_SHARE_HISTORY_RUN_KIND,
      pid: process.pid,
      token: `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      scope: input.scope,
      source: input.source,
      startedAt,
      heartbeatAt: startedAt,
    });
    let handle = null;
    try {
      handle = await open(path, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
      await handle.sync();
      return Object.freeze({ acquired: true, state });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    } finally {
      await handle?.close();
    }
  }
  const existing = await readActiveHistoryRunState(root, input.now);
  return Object.freeze({ acquired: false, state: existing });
}

export async function heartbeatHistoryRunState(state, root = process.cwd(), now = new Date()) {
  const current = await readActiveHistoryRunState(root, now);
  if (!current || current.token !== state?.token) return false;
  await atomicWrite(historyRunStatePath(root), `${JSON.stringify({
    ...current,
    heartbeatAt: now.toISOString(),
  }, null, 2)}\n`);
  return true;
}

export async function releaseHistoryRunState(state, root = process.cwd()) {
  const path = historyRunStatePath(root);
  let current = null;
  try {
    current = parseHistoryRunState(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return false;
    throw error;
  }
  if (!current || current.token !== state?.token) return false;
  await unlink(path).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  return true;
}

export function parseHistorySeries(value, expectedSymbol = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A_SHARE_HISTORY_INVALID");
  const symbol = String(value.symbol ?? "");
  const source = String(value.source ?? "");
  if (
    value.schemaVersion !== A_SHARE_HISTORY_SCHEMA_VERSION ||
    value.kind !== A_SHARE_HISTORY_KIND ||
    !/^(?:SH|SZ)\d{6}$/u.test(symbol) ||
    (expectedSymbol && symbol !== expectedSymbol) ||
    value.adjust !== "qfq" ||
    !isAShareHistorySource(source) ||
    !validDate(String(value.marketDate ?? "")) ||
    !Number.isFinite(Date.parse(value.updatedAt))
  ) throw new Error("A_SHARE_HISTORY_INVALID");
  const rawFactorInput = value.priceModel?.kind === "raw-factor" || value.rawBars != null || value.adjustmentFactors != null;
  const storedBars = value.bars == null && rawFactorInput ? [] : sanitizeHistoryBars(value.bars);
  if (!rawFactorInput && (
    storedBars.length < 3 ||
    storedBars.length !== value.bars.length ||
    storedBars.at(-1).date > value.marketDate
  )) throw new Error("A_SHARE_HISTORY_BARS_INVALID");
  let rawBars = null;
  let adjustmentFactors = null;
  let bars = storedBars;
  let priceModel;
  let expectedBasisContract;
  if (rawFactorInput) {
    const model = value.priceModel;
    if (
      !model ||
      typeof model !== "object" ||
      Array.isArray(model) ||
      model.kind !== "raw-factor" ||
      model.version !== A_SHARE_RESEARCH_PRICE_VERSION ||
      model.contract !== A_SHARE_RESEARCH_PRICE_CONTRACT ||
      model.rawSource !== source ||
      !isAShareHistorySource(model.factorSource) ||
      !["official-adj-factor", "derived-qfq-ratio", "identity-test-fixture"].includes(model.factorMethod) ||
      !validDate(String(model.factorAsOf ?? "")) ||
      !Number.isFinite(Date.parse(model.generatedAt))
    ) throw new Error("A_SHARE_HISTORY_PRICE_MODEL_INVALID");
    const bundle = createRawFactorPriceBundle({
      rawBars: value.rawBars,
      adjustmentFactors: value.adjustmentFactors,
      source,
      factorSource: model.factorSource,
      factorMethod: model.factorMethod,
      generatedAt: model.generatedAt,
    });
    if (bundle.priceModel.factorAsOf !== model.factorAsOf || bundle.bars.at(-1).date > value.marketDate) {
      throw new Error("A_SHARE_HISTORY_PRICE_MODEL_INVALID");
    }
    if (value.bars != null) {
      if (bundle.bars.length !== storedBars.length) throw new Error("A_SHARE_HISTORY_DERIVED_BARS_INVALID");
      const storedByDate = new Map(storedBars.map((bar) => [bar.date, bar]));
      const derivedMismatch = bundle.bars.some((bar) => {
        const stored = storedByDate.get(bar.date);
        return !stored || stored.volume !== bar.volume || HISTORY_PRICE_FIELDS.some(
          (field) => Math.abs(stored[field] - bar[field]) > 0.0000001,
        );
      });
      if (derivedMismatch) throw new Error("A_SHARE_HISTORY_DERIVED_BARS_INVALID");
    }
    rawBars = bundle.rawBars;
    adjustmentFactors = bundle.adjustmentFactors;
    bars = bundle.bars;
    priceModel = bundle.priceModel;
    expectedBasisContract = A_SHARE_RESEARCH_PRICE_CONTRACT;
  } else {
    expectedBasisContract = `${source}:cn:1d:qfq:v${A_SHARE_HISTORY_BASIS_VERSION}`;
    priceModel = Object.freeze({
      kind: "legacy-vendor-qfq",
      version: A_SHARE_HISTORY_BASIS_VERSION,
      contract: expectedBasisContract,
      rawSource: null,
      factorSource: source,
      factorMethod: "vendor-adjusted-only",
      factorAsOf: bars.at(-1).date,
      generatedAt: new Date(value.updatedAt).toISOString(),
    });
  }
  const basis = value.basis == null
    ? Object.freeze({
        contract: expectedBasisContract,
        source,
        market: "cn",
        interval: "1d",
        adjustment: "qfq",
        version: A_SHARE_HISTORY_BASIS_VERSION,
      })
    : value.basis;
  if (
    !basis ||
    typeof basis !== "object" ||
    Array.isArray(basis) ||
    basis.contract !== expectedBasisContract ||
    basis.source !== source ||
    basis.market !== "cn" ||
    basis.interval !== "1d" ||
    basis.adjustment !== "qfq" ||
    basis.version !== A_SHARE_HISTORY_BASIS_VERSION
  ) throw new Error("A_SHARE_HISTORY_BASIS_INVALID");
  const legacyValidation = Object.freeze({
    status: "legacy",
    checkedAt: new Date(value.updatedAt).toISOString(),
    overlapBars: 0,
    mismatchBars: 0,
    correctionBars: 0,
    confirmedThrough: bars.at(-1).date,
    provisionalBarExcluded: false,
  });
  const validation = value.validation == null ? legacyValidation : value.validation;
  const correctionBars = validation?.correctionBars == null ? 0 : validation.correctionBars;
  if (
    !validation ||
    typeof validation !== "object" ||
    Array.isArray(validation) ||
    !["legacy", "initial", "migrated", "matched", "factor-rebased", "corrected", "rebuilt", "snapshot-appended"].includes(validation.status) ||
    !Number.isFinite(Date.parse(validation.checkedAt)) ||
    !Number.isInteger(validation.overlapBars) ||
    validation.overlapBars < 0 ||
    validation.overlapBars > 10_000 ||
    !Number.isInteger(validation.mismatchBars) ||
    validation.mismatchBars < 0 ||
    validation.mismatchBars > validation.overlapBars ||
    !Number.isInteger(correctionBars) ||
    correctionBars < 0 ||
    correctionBars > validation.overlapBars ||
    validation.confirmedThrough !== bars.at(-1).date ||
    typeof validation.provisionalBarExcluded !== "boolean"
  ) throw new Error("A_SHARE_HISTORY_VALIDATION_INVALID");
  return Object.freeze({
    schemaVersion: A_SHARE_HISTORY_SCHEMA_VERSION,
    kind: A_SHARE_HISTORY_KIND,
    symbol,
    name: String(value.name ?? "").normalize("NFKC").trim().slice(0, 40),
    adjust: "qfq",
    source,
    marketDate: value.marketDate,
    updatedAt: new Date(value.updatedAt).toISOString(),
    priceModel,
    basis: Object.freeze({ ...basis }),
    validation: Object.freeze({
      ...validation,
      checkedAt: new Date(validation.checkedAt).toISOString(),
      correctionBars,
    }),
    ...(rawBars ? {
      rawBars: Object.freeze(rawBars),
      adjustmentFactors: Object.freeze(adjustmentFactors),
    } : {}),
    bars: Object.freeze(bars),
  });
}

export async function readHistorySeries(symbol, root = process.cwd()) {
  try {
    const parsed = JSON.parse(await readFile(seriesPath(symbol, root), "utf8"));
    return parseHistorySeries(parsed, symbol);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof SyntaxError) return null;
    if (/^A_SHARE_HISTORY_/u.test(String(error?.message))) return null;
    throw error;
  }
}

export async function writeHistorySeries(input, root = process.cwd()) {
  const parsed = parseHistorySeries(input, input?.symbol);
  const content = parsed.priceModel.kind === "raw-factor"
    ? `${JSON.stringify(Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== "bars")))}\n`
    : `${JSON.stringify(parsed)}\n`;
  const path = seriesPath(parsed.symbol, root);
  await atomicWrite(path, content);
  return Object.freeze({ path, bytes: Buffer.byteLength(content), series: parsed });
}

function calendarAge(from, to) {
  return Math.floor((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

export async function readUsableHistory(symbol, marketDate, options = {}) {
  if (!validDate(marketDate)) return null;
  const series = await readHistorySeries(symbol, options.root);
  if (!series) return null;
  const lastDate = series.bars.at(-1).date;
  const age = calendarAge(lastDate, marketDate);
  const maximumAge = Number.isInteger(options.maximumAgeDays) ? options.maximumAgeDays : 10;
  const minimumBars = Number.isInteger(options.minimumBars) ? options.minimumBars : 60;
  if (age < 0 || age > maximumAge || series.bars.length < minimumBars) return null;
  return Object.freeze({ ...series, bars: Object.freeze(series.bars.slice(-(options.limit ?? 180))) });
}

export function mergeIncrementalHistory(previousBars, fetchedBars) {
  const previous = sanitizeHistoryBars(previousBars);
  const fetched = sanitizeHistoryBars(fetchedBars);
  if (!previous.length) {
    return Object.freeze({
      bars: Object.freeze(fetched),
      rebuilt: true,
      reason: "initial",
      overlapCount: 0,
      mismatchCount: 0,
      mismatchDates: Object.freeze([]),
      correctionCount: 0,
      correctionDates: Object.freeze([]),
    });
  }
  if (!fetched.length) {
    return Object.freeze({
      bars: Object.freeze(previous),
      rebuilt: false,
      reason: "no-update",
      overlapCount: 0,
      mismatchCount: 0,
      mismatchDates: Object.freeze([]),
      correctionCount: 0,
      correctionDates: Object.freeze([]),
    });
  }
  const before = new Map(previous.map((bar) => [bar.date, bar]));
  const overlaps = fetched.filter((bar) => before.has(bar.date));
  if (!overlaps.length) {
    return Object.freeze({
      bars: Object.freeze(fetched),
      rebuilt: true,
      reason: "overlap-missing",
      overlapCount: 0,
      mismatchCount: 0,
      mismatchDates: Object.freeze([]),
      correctionCount: 0,
      correctionDates: Object.freeze([]),
    });
  }
  const priceMismatchDates = overlaps.flatMap((bar) => {
    const old = before.get(bar.date);
    const priceChanged = HISTORY_PRICE_FIELDS.some((field) =>
      Math.abs(old[field] - bar[field]) / Math.max(old[field], bar[field]) > HISTORY_PRICE_RELATIVE_TOLERANCE,
    );
    return priceChanged ? [bar.date] : [];
  });
  const minimumBasisMismatchBars = overlaps.length < 4
    ? overlaps.length
    : Math.max(2, Math.ceil(overlaps.length * 0.25));
  if (priceMismatchDates.length >= minimumBasisMismatchBars) {
    return Object.freeze({
      bars: Object.freeze(fetched),
      rebuilt: true,
      reason: "overlap-mismatch",
      overlapCount: overlaps.length,
      mismatchCount: priceMismatchDates.length,
      mismatchDates: Object.freeze(priceMismatchDates),
      correctionCount: 0,
      correctionDates: Object.freeze([]),
    });
  }
  const correctionDates = overlaps.flatMap((bar) => {
    const old = before.get(bar.date);
    return priceMismatchDates.includes(bar.date) || old.volume !== bar.volume ? [bar.date] : [];
  });
  return Object.freeze({
    bars: Object.freeze(sanitizeHistoryBars([...previous, ...fetched])),
    rebuilt: false,
    reason: correctionDates.length ? "overlap-corrected" : "overlap-matched",
    overlapCount: overlaps.length,
    mismatchCount: 0,
    mismatchDates: Object.freeze([]),
    correctionCount: correctionDates.length,
    correctionDates: Object.freeze(correctionDates),
  });
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function mergeRawFactorPriceBundles(previousSeries, incrementalBundle, generatedAt = new Date().toISOString()) {
  if (
    previousSeries?.priceModel?.kind !== "raw-factor" ||
    incrementalBundle?.priceModel?.kind !== "raw-factor" ||
    previousSeries.priceModel.rawSource !== incrementalBundle.priceModel.rawSource ||
    previousSeries.priceModel.factorSource !== incrementalBundle.priceModel.factorSource
  ) return Object.freeze({ rebuilt: true, reason: "price-model-conflict", overlapCount: 0 });
  const previousRaw = sanitizeHistoryBars(previousSeries.rawBars);
  const incrementalRaw = sanitizeHistoryBars(incrementalBundle.rawBars);
  const previousFactors = sanitizeAdjustmentFactors(previousSeries.adjustmentFactors);
  const incrementalFactors = sanitizeAdjustmentFactors(incrementalBundle.adjustmentFactors);
  const oldFactorByDate = new Map(previousFactors.map((item) => [item.date, item.factor]));
  const newFactorByDate = new Map(incrementalFactors.map((item) => [item.date, item.factor]));
  const overlapDates = incrementalRaw
    .map((bar) => bar.date)
    .filter((date) => oldFactorByDate.has(date) && newFactorByDate.has(date));
  if (!overlapDates.length) {
    return Object.freeze({ rebuilt: true, reason: "factor-overlap-missing", overlapCount: 0 });
  }
  const ratios = overlapDates.map((date) => newFactorByDate.get(date) / oldFactorByDate.get(date));
  const scale = median(ratios);
  const inconsistent = !Number.isFinite(scale) || scale <= 0 || ratios.some(
    (ratio) => Math.abs(ratio - scale) / Math.max(ratio, scale) > 0.005,
  );
  if (inconsistent) {
    return Object.freeze({
      rebuilt: true,
      reason: "factor-overlap-inconsistent",
      overlapCount: overlapDates.length,
    });
  }
  const rawByDate = new Map(previousRaw.map((bar) => [bar.date, bar]));
  for (const bar of incrementalRaw) rawByDate.set(bar.date, bar);
  const factorByDate = new Map(previousFactors.map((item) => [
    item.date,
    Object.freeze({ date: item.date, factor: Number((item.factor * scale).toFixed(12)) }),
  ]));
  for (const item of incrementalFactors) factorByDate.set(item.date, item);
  const rawBars = [...rawByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  const adjustmentFactors = rawBars.map((bar) => factorByDate.get(bar.date)).filter(Boolean);
  const bundle = createRawFactorPriceBundle({
    rawBars,
    adjustmentFactors,
    source: previousSeries.priceModel.rawSource,
    factorSource: previousSeries.priceModel.factorSource,
    factorMethod: incrementalBundle.priceModel.factorMethod,
    generatedAt,
  });
  return Object.freeze({
    ...bundle,
    rebuilt: false,
    reason: Math.abs(scale - 1) > 0.0001 ? "factor-rebased" : "factor-matched",
    overlapCount: overlapDates.length,
    factorChanged: Math.abs(scale - 1) > 0.0001,
    scale,
  });
}

export async function writeHistoryManifest(manifest, root = process.cwd()) {
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  const path = historyManifestPath(root);
  await atomicWrite(path, content);
  return Object.freeze({ path, bytes: Buffer.byteLength(content) });
}

export async function readHistoryManifest(root = process.cwd()) {
  try {
    const value = JSON.parse(await readFile(historyManifestPath(root), "utf8"));
    const source = value?.source == null
      ? A_SHARE_HISTORY_DEFAULT_SOURCE
      : String(value.source);
    const adjust = value?.adjust == null ? "qfq" : String(value.adjust);
    if (
      value?.schemaVersion !== A_SHARE_HISTORY_SCHEMA_VERSION ||
      value?.kind !== A_SHARE_HISTORY_MANIFEST_KIND ||
      !["core", "broad", "full"].includes(value.scope) ||
      !Number.isInteger(value.limit) ||
      (value.scope === "core" && value.limit !== 120) ||
      (value.scope === "broad" && value.limit !== 300) ||
      (value.scope === "full" && (value.limit < 20 || value.limit > 10_000 || value.limit !== value.total)) ||
      !isAShareHistorySource(source) ||
      adjust !== "qfq" ||
      !Number.isFinite(Date.parse(value.updatedAt)) ||
      (value.resumeAfter != null && !Number.isFinite(Date.parse(value.resumeAfter))) ||
      !validDate(String(value.marketDate ?? "")) ||
      !Number.isInteger(value.total) ||
      !Number.isInteger(value.ready) ||
      !Number.isInteger(value.failed) ||
      !Number.isInteger(value.bars) ||
      !Number.isInteger(value.storageBytes)
    ) return null;
    return Object.freeze({ ...value, source, adjust });
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function seriesBytes(symbol, root = process.cwd()) {
  try {
    return (await stat(seriesPath(symbol, root))).size;
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
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

function usableManifestRecord(record, marketDate, source) {
  const age = calendarAge(String(record?.to ?? ""), marketDate);
  return record?.source === source && Number(record?.bars) >= 60 && age >= 0 && age <= 10;
}

export async function recoverHistoryManifestFromSeries(manifest, root = process.cwd(), now = new Date()) {
  if (!manifest || manifest.scope !== "full") return manifest;
  const excludedSymbols = new Set(
    (Array.isArray(manifest.excludedSymbols) ? manifest.excludedSymbols : [])
      .map(String)
      .filter((symbol) => /^(?:SH|SZ)\d{6}$/u.test(symbol)),
  );
  const recordsBySymbol = new Map(
    (Array.isArray(manifest.records) ? manifest.records : [])
      .filter((record) => /^(?:SH|SZ)\d{6}$/u.test(record?.symbol))
      .map((record) => [record.symbol, record]),
  );
  const names = await readdir(resolve(cacheRoot(root), "series")).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  let recovered = 0;
  for (const name of names) {
    const match = /^((?:SH|SZ)\d{6})\.json$/u.exec(name);
    if (!match || recordsBySymbol.has(match[1]) || excludedSymbols.has(match[1])) continue;
    const series = await readHistorySeries(match[1], root);
    if (!series || series.source !== manifest.source) continue;
    recordsBySymbol.set(match[1], manifestRecordFor(series, await seriesBytes(match[1], root)));
    recovered += 1;
  }
  const records = [...recordsBySymbol.values()].sort((left, right) => left.symbol.localeCompare(right.symbol));
  const rawFactorReady = records.filter((record) => record.priceModel === "raw-factor").length;
  const legacyVendorAdjusted = records.length - rawFactorReady;
  const priceModel = legacyVendorAdjusted === 0 ? "raw-factor"
    : rawFactorReady === 0 ? "legacy-vendor-qfq" : "mixed-migration";
  const countsMatch = manifest.cached === records.length &&
    manifest.rawFactorReady === rawFactorReady && manifest.legacyVendorAdjusted === legacyVendorAdjusted &&
    manifest.priceModel === priceModel;
  if (recovered === 0 && countsMatch) return manifest;
  const marketDate = [manifest.marketDate, ...records.map((record) => record.to)]
    .filter(validDate)
    .sort()
    .at(-1);
  const ready = Math.min(
    manifest.total,
    records.filter((record) => usableManifestRecord(record, marketDate, manifest.source)).length,
  );
  const legacyFailures = Array.isArray(manifest.failures) ? manifest.failures : [];
  const legacyInterrupted = manifest.failed > 0 &&
    manifest.failed === manifest.total - manifest.ready &&
    legacyFailures.length > 0 &&
    legacyFailures.every((failure) => ["SOURCE_HTTP", "SOURCE_TIMEOUT"].includes(String(failure?.errorCode ?? "")));
  const dates = records.flatMap((record) => [record.from, record.to]).filter(validDate).sort();
  const next = Object.freeze({
    ...manifest,
    marketDate,
    updatedAt: now.toISOString(),
    ready,
    remaining: Math.max(0, manifest.total - ready),
    paused: legacyInterrupted || manifest.paused === true,
    cached: records.length,
    rawFactorReady,
    legacyVendorAdjusted,
    priceModel,
    basisContract: rawFactorReady > 0 ? A_SHARE_RESEARCH_PRICE_CONTRACT : manifest.basisContract,
    failed: legacyInterrupted ? 0 : manifest.failed,
    bars: records.reduce((sum, record) => sum + Number(record.bars ?? 0), 0),
    storageBytes: records.reduce((sum, record) => sum + Number(record.bytes ?? 0), 0),
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
    failures: legacyInterrupted ? [] : legacyFailures,
    recovered,
    records,
  });
  await writeHistoryManifest(next, root);
  return next;
}
