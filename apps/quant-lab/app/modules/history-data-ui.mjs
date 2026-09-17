import {
  AUTO_DATA_SOURCE_ID,
  HISTORY_DATA_SOURCES,
  MARKET_DATA_PROVIDER_CONTRACT,
  historyDataSource,
  historyDataSourceCapability,
  historyDataSourcesForMarket,
  historyDataSourcesForCapability,
  historySourceLabel,
  validateHistoryDataSourceDefinition,
} from "../market-data-sources.mjs";
import { fingerprintBars, parseOhlcvCsv } from "../engine.mjs";

const DATA_DIRECTORY = "data/market";
const META_SUFFIX = ".meta.json";
const SOURCE_PREFERENCES_KEY = "history-data-source-preferences:v1";
const HISTORY_LIBRARY_STATUS_KEY = "a-share-history-library-status:v1";
const HISTORY_PROCESS_TIMEOUT_MS = 12 * 60 * 60 * 1_000;
const HISTORY_MAX_STDOUT_CHARS = 8_000_000;
const HISTORY_STDERR_TAIL_CHARS = 64_000;
const HISTORY_MAX_PROGRESS_LINE_CHARS = 16_000;
const HISTORY_AUTOFILL_RECHECK_MS = 5 * 60 * 1_000;
const HISTORY_BACKGROUND_POLL_MS = 15_000;
const HISTORY_LIBRARY_DEFAULT_SOURCE = "tencent-ifzq";
const HISTORY_LIBRARY_BASIS_VERSION = 1;
const HISTORY_LIBRARY_RESEARCH_CONTRACT = "canonical:cn:1d:qfq:raw-factor:v1";
const LEGACY_INTERRUPTION_ERRORS = new Set([
  "SOURCE_HTTP",
  "SOURCE_NETWORK",
  "SOURCE_RATE_LIMIT",
  "SOURCE_TIMEOUT",
]);

const HISTORY_NODE_LAUNCHER = [
  'import { join } from "node:path";',
  'import { pathToFileURL } from "node:url";',
  'const home = process.env.HOME || process.env.USERPROFILE;',
  'if (!home) throw new Error("user-home-unavailable");',
  'const tool = join(home, ".code-shell", "panel-apps", "quant-lab", "app", "tools", "initialize-a-share-history.mjs");',
  'const module = await import(pathToFileURL(tool).href);',
  'const mode = process.argv.at(-3) || "initialize";',
  'const scope = process.argv.at(-2) || "core";',
  'const source = process.argv.at(-1) || "tencent-ifzq";',
  'const args = mode === "status" ? ["--status", "--stdout"] : ["--scope", scope, "--source", source, "--stdout"];',
  'if (mode === "autofill") args.push("--incremental-only");',
  'await module.runCli(args);',
].join("\n");

const HISTORY_DATA_NODE_LAUNCHER = [
  'import { join } from "node:path";',
  'import { pathToFileURL } from "node:url";',
  'const home = process.env.HOME || process.env.USERPROFILE;',
  'if (!home) throw new Error("user-home-unavailable");',
  'const marker = process.argv.indexOf("panel-history-sync");',
  'if (marker < 0) throw new Error("history-sync-arguments-missing");',
  'const tool = join(home, ".code-shell", "panel-apps", "quant-lab", "app", "tools", "fetch-market-data.mjs");',
  'const module = await import(pathToFileURL(tool).href);',
  'await module.runCli(process.argv.slice(marker + 1));',
].join("\n");

const HISTORY_RUNTIME_SPECS = Object.freeze([
  Object.freeze({ name: "node", label: "Node.js" }),
  Object.freeze({ name: "nodejs", label: "Node.js" }),
  Object.freeze({ name: "bun", label: "Bun" }),
]);

export {
  HISTORY_DATA_SOURCES,
  MARKET_DATA_PROVIDER_CONTRACT,
  historyDataSourceCapability,
  historyDataSourcesForCapability,
  validateHistoryDataSourceDefinition,
};

export function collectHistoryProcessOutput(record, stream, text) {
  if (!record || !["stdout", "stderr"].includes(stream) || typeof text !== "string") {
    return Object.freeze({ overflow: true, lines: Object.freeze([]) });
  }
  if (stream === "stdout") {
    if (record.stdout.length + text.length > HISTORY_MAX_STDOUT_CHARS) {
      return Object.freeze({ overflow: true, lines: Object.freeze([]) });
    }
    record.stdout += text;
    return Object.freeze({ overflow: false, lines: Object.freeze([]) });
  }
  record.stderr = `${record.stderr}${text}`.slice(-HISTORY_STDERR_TAIL_CHARS);
  const parts = `${record.stderrPending}${text}`.split(/\r?\n/u);
  record.stderrPending = parts.pop() ?? "";
  const overflow = record.stderrPending.length > HISTORY_MAX_PROGRESS_LINE_CHARS ||
    parts.some((line) => line.length > HISTORY_MAX_PROGRESS_LINE_CHARS);
  return Object.freeze({ overflow, lines: Object.freeze(parts) });
}

export function estimatedHistoryRemainingMs({ completed, total, elapsedMs }) {
  if (
    !Number.isInteger(completed) ||
    !Number.isInteger(total) ||
    completed < 5 ||
    total <= completed ||
    !Number.isFinite(elapsedMs) ||
    elapsedMs <= 0
  ) return null;
  return Math.min(24 * 60 * 60 * 1_000, Math.ceil((elapsedMs / completed) * (total - completed)));
}

export function formatHistoryDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "";
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} 小时 ${remainder} 分钟` : `${hours} 小时`;
}

export function historyAutofillNeeded(summary, marketDate, instant = new Date()) {
  if (!summary || !isoDate(String(marketDate ?? "")) || !Number.isFinite(instant?.getTime?.())) return false;
  if (summary.running === true) return false;
  const resumeAt = Date.parse(String(summary.resumeAfter ?? ""));
  if (summary.paused === true && Number.isFinite(resumeAt) && resumeAt > instant.getTime()) return false;
  if (summary.paused === true) return true;
  if (Number.isInteger(summary.attempted) && Number.isInteger(summary.total) && summary.attempted < summary.total) return true;
  const through = [summary.confirmedThrough, summary.to]
    .filter((value) => isoDate(String(value ?? "")))
    .sort()
    .at(-1);
  const checkedThrough = summary.networkCheckedThrough;
  const laggingSeries = (Array.isArray(summary.latestDateDistribution) ? summary.latestDateDistribution : [])
    .some((row) => isoDate(String(row.date ?? "")) && Number(row.count) > 0 && row.date < marketDate);
  // A local snapshot may expose a suspended stock, a corporate-action basis
  // break, or a genuinely missing date. Trigger one network pass for that
  // market date, then leave unresolved per-stock rows explicit instead of
  // relaunching the same full-market pass every five minutes.
  if (!through || through < marketDate || laggingSeries || Number(summary.failed ?? 0) > 0 ||
      Number(summary.snapshotBackfillDeferred ?? 0) > 0 || Number(summary.snapshotGapSeries ?? 0) > 0 ||
      Boolean(summary.snapshotGapDates?.length)) {
    return !checkedThrough || checkedThrough < marketDate;
  }
  return false;
}

export function historyCoveragePresentation(summary, marketDate = summary?.marketDate) {
  if (!summary || !Number.isInteger(summary.ready) || summary.ready <= 0) {
    return Object.freeze({
      state: "empty",
      through: null,
      current: false,
      coverage: "未初始化",
      note: "近三年前复权",
    });
  }
  const majorityDate = [...(Array.isArray(summary.latestDateDistribution) ? summary.latestDateDistribution : [])]
    .filter((row) => isoDate(String(row.date ?? "")) && Number(row.count) > 0)
    .sort((a, b) => b.count - a.count || b.date.localeCompare(a.date))[0]?.date;
  const through = majorityDate ?? [
    summary.confirmedThrough,
    summary.to,
  ].filter((value) => isoDate(String(value ?? ""))).sort().at(-1) ??
    (isoDate(String(summary.networkCheckedThrough ?? "")) ? summary.networkCheckedThrough : null);
  const target = isoDate(String(marketDate ?? "")) ? String(marketDate) : null;
  const unresolvedGap = Number(summary.snapshotBackfillDeferred ?? 0) > 0 || Number(summary.snapshotGapSeries ?? 0) > 0 || Boolean(summary.snapshotGapDates?.length);
  const networkVerified = isoDate(String(summary.networkCheckedThrough ?? "")) && (!target || summary.networkCheckedThrough >= target);
  const current = Boolean(through && (!target || through >= target) && !unresolvedGap);
  const total = Number.isInteger(summary.total) && summary.total >= summary.ready
    ? summary.total
    : summary.ready;
  const remaining = Number.isInteger(summary.remaining)
    ? summary.remaining
    : Math.max(0, total - summary.ready);
  const coverage = `${summary.ready.toLocaleString("zh-CN")} / ${total.toLocaleString("zh-CN")} 可用`;
  const note = unresolvedGap
    ? `${coverage} · ${majorityDate ? `多数序列截至 ${majorityDate} · ` : ""}${networkVerified ? "已联网核对，仍有序列缺口" : "历史缺口待联网补齐，快照检查不代表日线已补齐"}`
    : remaining > 0
    ? `${coverage} · ${remaining.toLocaleString("zh-CN")} 只暂不可用`
    : `${coverage} · ${Number(summary.years) || 3} 年前复权`;
  return Object.freeze({
    state: current ? "current" : "stale",
    through,
    current,
    coverage,
    note,
  });
}

function historyOnlyUnavailable(summary) {
  return Number(summary?.remaining) > 0 &&
    Number(summary?.unavailable) === Number(summary?.remaining) &&
    Number(summary?.failed) === 0;
}

function historyLibrarySource(value) {
  const source = historyDataSource(String(value ?? ""));
  if (!source?.markets.includes("cn") || !source.adjustments.includes("qfq")) {
    throw new Error("请选择可用于 A 股前复权日线的历史数据源");
  }
  return source;
}

export function historyLibraryRuntimeArgs(
  name,
  scope = "core",
  mode = "initialize",
  source = HISTORY_LIBRARY_DEFAULT_SOURCE,
) {
  if (!["core", "broad", "full"].includes(scope)) throw new Error("历史基础库范围无效");
  if (!["initialize", "autofill", "status"].includes(mode)) throw new Error("历史基础库模式无效");
  historyLibrarySource(source);
  if (name === "node" || name === "nodejs") {
    return Object.freeze(["--input-type=module", "--eval", HISTORY_NODE_LAUNCHER, mode, scope, source]);
  }
  if (name === "bun") return Object.freeze(["--eval", HISTORY_NODE_LAUNCHER, mode, scope, source]);
  throw new Error("历史基础库运行时不受支持");
}

export function historyDataRuntimeArgs(name, input) {
  const request = normalizeHistoryRequest(input);
  const args = [
    "panel-history-sync",
    "--symbol", request.symbol,
    "--market", request.market,
    "--source", request.source,
    "--adjust", request.adjust,
    "--from", request.from,
    "--to", request.to,
    "--stdout-bundle",
  ];
  if (name === "node" || name === "nodejs") {
    return Object.freeze(["--input-type=module", "--eval", HISTORY_DATA_NODE_LAUNCHER, ...args]);
  }
  if (name === "bun") return Object.freeze(["--eval", HISTORY_DATA_NODE_LAUNCHER, ...args]);
  throw new Error("单股回测数据运行时不受支持");
}

export function parseHistoryLibrarySummary(value) {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error("历史基础库结果不是有效 JSON");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("历史基础库结果无效");
  const integer = (field, minimum = 0, maximum = 10_000_000) => {
    const number = Number(value[field]);
    if (!Number.isInteger(number) || number < minimum || number > maximum) {
      throw new Error(`历史基础库 ${field} 无效`);
    }
    return number;
  };
  const scope = ["core", "broad", "full"].includes(value.scope) ? value.scope : null;
  const source = String(value.source ?? HISTORY_LIBRARY_DEFAULT_SOURCE);
  historyLibrarySource(source);
  if (value.adjust != null && value.adjust !== "qfq") throw new Error("历史基础库复权口径无效");
  const limit = integer("limit", 20, 10_000);
  if (!isoDate(String(value.marketDate ?? "")) || !isoInstant(String(value.updatedAt ?? ""))) {
    throw new Error("历史基础库时间无效");
  }
  const total = integer("total", 1, 10_000);
  if (
    !scope ||
    (scope === "core" && limit !== 120) ||
    (scope === "broad" && limit !== 300) ||
    (scope === "full" && limit !== total)
  ) throw new Error("历史基础库范围无效");
  const ready = integer("ready", 0, total);
  const cached = integer("cached", ready, 10_000);
  const rawFailed = integer("failed", 0, total);
  const years = integer("years", 1, 10);
  const bars = integer("bars");
  const storageBytes = integer("storageBytes", 0, 1_000_000_000);
  const loaded = integer("loaded", 0, total);
  const skipped = integer("skipped", 0, total);
  const rebuilt = integer("rebuilt", 0, total);
  const overlapValidated = value.overlapValidated == null ? 0 : integer("overlapValidated");
  const basisMismatches = value.basisMismatches == null ? 0 : integer("basisMismatches");
  const overlapCorrections = value.overlapCorrections == null ? 0 : integer("overlapCorrections");
  if (basisMismatches > overlapValidated) {
    throw new Error("历史基础库复权差异数超过重叠校验数");
  }
  if (overlapCorrections > overlapValidated) {
    throw new Error("历史基础库修订数超过重叠校验数");
  }
  const legacyBasisContract = `${source}:cn:1d:qfq:v${HISTORY_LIBRARY_BASIS_VERSION}`;
  const basisContract = value.basisContract ?? legacyBasisContract;
  if (![legacyBasisContract, HISTORY_LIBRARY_RESEARCH_CONTRACT].includes(basisContract)) {
    throw new Error("历史基础库价格口径标识无效");
  }
  const rawFactorReady = value.rawFactorReady == null ? 0 : integer("rawFactorReady", 0, cached);
  const legacyVendorAdjusted = value.legacyVendorAdjusted == null
    ? cached - rawFactorReady
    : integer("legacyVendorAdjusted", 0, cached);
  if (rawFactorReady + legacyVendorAdjusted !== cached) {
    throw new Error("历史基础库价格分层覆盖数无效");
  }
  const priceModel = value.priceModel == null
    ? "legacy-vendor-qfq"
    : ["legacy-vendor-qfq", "mixed-migration", "raw-factor"].includes(value.priceModel)
      ? value.priceModel
      : (() => { throw new Error("历史基础库价格模型无效"); })();
  const migrated = value.migrated == null ? 0 : integer("migrated", 0, total);
  const factorRebased = value.factorRebased == null ? 0 : integer("factorRebased", 0, total);
  const sessionPhase = value.sessionPhase == null
    ? null
    : ["intraday", "previous-close", "close"].includes(value.sessionPhase)
      ? value.sessionPhase
      : (() => { throw new Error("历史基础库交易时段无效"); })();
  if (value.provisional != null && typeof value.provisional !== "boolean") {
    throw new Error("历史基础库 provisional 无效");
  }
  const confirmedThrough = value.confirmedThrough == null
    ? (isoDate(String(value.to ?? "")) ? value.to : null)
    : isoDate(String(value.confirmedThrough))
      ? value.confirmedThrough
      : (() => { throw new Error("历史基础库确认日期无效"); })();
  const snapshotBackfillAt = value.snapshotBackfillAt == null
    ? null
    : isoInstant(String(value.snapshotBackfillAt))
      ? new Date(value.snapshotBackfillAt).toISOString()
      : (() => { throw new Error("历史基础库自动补齐时间无效"); })();
  const snapshotBackfillThrough = value.snapshotBackfillThrough == null
    ? null
    : isoDate(String(value.snapshotBackfillThrough))
      ? value.snapshotBackfillThrough
      : (() => { throw new Error("历史基础库自动补齐日期无效"); })();
  const networkCheckedThrough = value.networkCheckedThrough == null
    ? null
    : isoDate(String(value.networkCheckedThrough))
      ? value.networkCheckedThrough
      : (() => { throw new Error("历史基础库联网核验日期无效"); })();
  const snapshotBackfilledSeries = value.snapshotBackfilledSeries == null
    ? 0
    : integer("snapshotBackfilledSeries", 0, cached);
  const snapshotBackfilledBars = value.snapshotBackfilledBars == null
    ? 0
    : integer("snapshotBackfilledBars", 0, 10_000_000);
  const snapshotBackfillDeferred = value.snapshotBackfillDeferred == null
    ? 0
    : integer("snapshotBackfillDeferred", 0, cached);
  const snapshotGapSeries = value.snapshotGapSeries == null
    ? 0
    : integer("snapshotGapSeries", 0, cached);
  const snapshotGapDates = value.snapshotGapDates == null
    ? []
    : Array.isArray(value.snapshotGapDates) && value.snapshotGapDates.length <= 15 && value.snapshotGapDates.every((date) => isoDate(String(date)))
      ? [...new Set(value.snapshotGapDates.map(String))].sort()
      : (() => { throw new Error("历史基础库快照缺口日期无效"); })();
  if (snapshotGapSeries > snapshotBackfillDeferred) throw new Error("历史基础库快照缺口数量冲突");
  const auditTrail = value.auditTrail == null
    ? []
    : Array.isArray(value.auditTrail) && value.auditTrail.length <= 5
      ? value.auditTrail.map((event, index) => {
          if (!event || typeof event !== "object" || Array.isArray(event)) {
            throw new Error("历史基础库补齐记录无效");
          }
          const kind = ["initialization", "incremental", "gap-fill", "snapshot-fill", "snapshot-check"].includes(event.kind)
            ? event.kind
            : null;
          const status = ["running", "complete", "partial", "paused"].includes(event.status)
            ? event.status
            : null;
          const eventInteger = (field, maximum = 10_000_000) => {
            const number = Number(event[field] ?? 0);
            if (!Number.isInteger(number) || number < 0 || number > maximum) {
              throw new Error(`历史基础库补齐记录 ${index + 1} ${field} 无效`);
            }
            return number;
          };
          const eventDate = (field) => event[field] == null
            ? null
            : isoDate(String(event[field]))
              ? String(event[field])
              : (() => { throw new Error(`历史基础库补齐记录 ${index + 1} ${field} 无效`); })();
          const requestedGapDates = event.requestedGapDates == null
            ? []
            : Array.isArray(event.requestedGapDates) && event.requestedGapDates.length <= 15 && event.requestedGapDates.every((date) => isoDate(String(date)))
              ? [...new Set(event.requestedGapDates.map(String))].sort()
              : (() => { throw new Error(`历史基础库补齐记录 ${index + 1} 缺口日期无效`); })();
          if (!kind || !status || !isoInstant(String(event.at ?? ""))) {
            throw new Error(`历史基础库补齐记录 ${index + 1} 状态无效`);
          }
          return Object.freeze({
            at: new Date(event.at).toISOString(),
            kind,
            status,
            from: eventDate("from"),
            through: eventDate("through"),
            requestedGapDates: Object.freeze(requestedGapDates),
            updatedSeries: eventInteger("updatedSeries", 10_000),
            addedBars: eventInteger("addedBars"),
            skippedSeries: eventInteger("skippedSeries", 10_000),
            failedSeries: eventInteger("failedSeries", 10_000),
          });
        })
      : (() => { throw new Error("历史基础库补齐记录列表无效"); })();
  if (value.legacyInterrupted != null && typeof value.legacyInterrupted !== "boolean") {
    throw new Error("历史基础库 legacyInterrupted 无效");
  }
  const legacyFailureRows = Array.isArray(value.failures) ? value.failures : [];
  const legacyInterrupted = value.legacyInterrupted === true || (
    value.remaining == null &&
    value.attempted == null &&
    value.paused == null &&
    rawFailed > 0 &&
    rawFailed === total - ready &&
    legacyFailureRows.length > 0 &&
    legacyFailureRows.every((item) => LEGACY_INTERRUPTION_ERRORS.has(String(item?.errorCode ?? "")))
  );
  const inferredUnavailable = legacyFailureRows.length > 0 &&
    legacyFailureRows.every((item) => String(item?.errorCode ?? "") === "HISTORY_NOT_USABLE")
    ? rawFailed
    : legacyFailureRows.filter((item) => String(item?.errorCode ?? "") === "HISTORY_NOT_USABLE").length;
  const unavailable = value.unavailable == null
    ? Math.min(total, inferredUnavailable)
    : integer("unavailable", 0, total);
  const inferredExcluded = new Set(
    (Array.isArray(value.excludedSymbols) ? value.excludedSymbols : [])
      .map(String)
      .filter((symbol) => /^(?:SH|SZ)\d{6}$/u.test(symbol)),
  ).size;
  const excludedCount = value.excludedCount == null
    ? inferredExcluded
    : integer("excludedCount", 0, 10_000);
  const failed = legacyInterrupted
    ? 0
    : value.unavailable == null
      ? Math.max(0, rawFailed - unavailable)
      : rawFailed;
  const remaining = value.remaining == null ? total - ready : integer("remaining", 0, total);
  if (remaining !== total - ready) throw new Error("历史基础库 remaining 与覆盖数不一致");
  const attempted = legacyInterrupted
    ? Math.min(total, loaded + skipped)
    : value.attempted == null
      ? Math.min(total, loaded + skipped + failed)
    : integer("attempted", 0, total);
  if (value.paused != null && typeof value.paused !== "boolean") {
    throw new Error("历史基础库 paused 无效");
  }
  if (value.running != null && typeof value.running !== "boolean") {
    throw new Error("历史基础库 running 无效");
  }
  const runScope = value.runScope == null
    ? null
    : ["core", "broad", "full"].includes(value.runScope)
      ? value.runScope
      : (() => { throw new Error("历史基础库 runScope 无效"); })();
  const runStartedAt = value.runStartedAt == null
    ? null
    : isoInstant(String(value.runStartedAt))
      ? new Date(value.runStartedAt).toISOString()
      : (() => { throw new Error("历史基础库 runStartedAt 无效"); })();
  const resumeAfter = value.resumeAfter == null
    ? null
    : isoInstant(String(value.resumeAfter))
      ? new Date(value.resumeAfter).toISOString()
      : (() => { throw new Error("历史基础库 resumeAfter 无效"); })();
  const paused = legacyInterrupted || value.paused === true;
  const failures = Object.freeze((Array.isArray(value.failures) ? value.failures : []).slice(0, 30).flatMap((item) => {
    const symbol = String(item?.symbol ?? "").toUpperCase();
    if (!/^(?:SH|SZ)\d{6}$/u.test(symbol)) return [];
    return [Object.freeze({
      symbol,
      name: String(item?.name ?? "").normalize("NFKC").trim().slice(0, 40),
      errorCode: String(item?.errorCode ?? "HISTORY_ERROR").slice(0, 80),
    })];
  }));
  let latestDateDistribution;
  if (value.latestDateDistribution != null) {
    if (!Array.isArray(value.latestDateDistribution) || value.latestDateDistribution.length > 6) {
      throw new Error("历史基础库最新日期分布无效");
    }
    const seenDates = new Set();
    latestDateDistribution = Object.freeze(value.latestDateDistribution.map((item) => {
      const date = String(item?.date ?? "");
      const count = Number(item?.count);
      if (!isoDate(date) || date > value.marketDate || !Number.isInteger(count) || count < 1 || count > cached || seenDates.has(date)) {
        throw new Error("历史基础库最新日期分布条目无效");
      }
      seenDates.add(date);
      return Object.freeze({ date, count });
    }).sort((left, right) => right.date.localeCompare(left.date)));
  } else {
    const latestBySymbol = new Map();
    for (const record of Array.isArray(value.records) ? value.records.slice(0, 10_000) : []) {
      const symbol = String(record?.symbol ?? "").toUpperCase();
      const date = String(record?.to ?? "");
      if (!/^(?:SH|SZ)\d{6}$/u.test(symbol) || !isoDate(date) || date > value.marketDate) continue;
      const previous = latestBySymbol.get(symbol);
      if (!previous || date > previous) latestBySymbol.set(symbol, date);
    }
    const latestDateCounts = new Map();
    for (const date of latestBySymbol.values()) latestDateCounts.set(date, (latestDateCounts.get(date) ?? 0) + 1);
    latestDateDistribution = Object.freeze([...latestDateCounts]
      .sort(([left], [right]) => right.localeCompare(left))
      .slice(0, 6)
      .map(([date, count]) => Object.freeze({ date, count })));
  }
  if (value.recentSnapshotCoverage != null && (!Array.isArray(value.recentSnapshotCoverage) || value.recentSnapshotCoverage.length > 5)) {
    throw new Error("历史基础库收盘快照覆盖无效");
  }
  const snapshotDates = new Set();
  const recentSnapshotCoverage = Object.freeze((Array.isArray(value.recentSnapshotCoverage)
    ? value.recentSnapshotCoverage
    : []).map((item) => {
    const date = String(item?.date ?? "");
    const count = Number(item?.count);
    const phase = String(item?.phase ?? "close");
    if (
      !isoDate(date) ||
      date > value.marketDate ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 10_000 ||
      !["close", "previous-close"].includes(phase) ||
      snapshotDates.has(date)
    ) throw new Error("历史基础库收盘快照覆盖条目无效");
    snapshotDates.add(date);
    return Object.freeze({ date, count, phase });
  }).sort((left, right) => left.date.localeCompare(right.date)));
  return Object.freeze({
    scope,
    source,
    adjust: "qfq",
    limit,
    years,
    marketDate: value.marketDate,
    updatedAt: new Date(value.updatedAt).toISOString(),
    total,
    ready,
    remaining,
    attempted,
    paused,
    running: value.running === true,
    runScope,
    runStartedAt,
    resumeAfter,
    legacyInterrupted,
    cached,
    failed,
    unavailable,
    excludedCount,
    bars,
    storageBytes,
    from: isoDate(String(value.from ?? "")) ? value.from : null,
    to: isoDate(String(value.to ?? "")) ? value.to : null,
    loaded,
    skipped,
    rebuilt,
    overlapValidated,
    basisMismatches,
    overlapCorrections,
    basisContract,
    priceModel,
    rawFactorReady,
    legacyVendorAdjusted,
    migrated,
    factorRebased,
    sessionPhase,
    provisional: value.provisional === true,
    confirmedThrough,
    snapshotBackfillAt,
    snapshotBackfillThrough,
    networkCheckedThrough,
    snapshotBackfilledSeries,
    snapshotBackfilledBars,
    snapshotBackfillDeferred,
    snapshotGapSeries,
    snapshotGapDates: Object.freeze(snapshotGapDates),
    auditTrail: Object.freeze(auditTrail),
    latestDateDistribution,
    recentSnapshotCoverage,
    failures,
  });
}

function isoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isoInstant(value) {
  if (typeof value !== "string" || value.length > 40) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/u.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , offsetHour = "00", offsetMinute = "00"] = match;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
  if (Number(offsetHour) > 14 || Number(offsetMinute) > 59 || (Number(offsetHour) === 14 && Number(offsetMinute) !== 0)) return false;
  const calendarDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return calendarDate.toISOString().slice(0, 10) === `${year}-${month}-${day}` && Number.isFinite(Date.parse(value));
}

function normalizeSymbol(symbol, market) {
  const value = String(symbol ?? "").trim();
  if (market === "cn") {
    const bare = value.replace(/^(sh|sz)/iu, "");
    if (!/^\d{6}$/u.test(bare)) throw new Error("A 股代码必须是 6 位数字");
    if (/^(6|9)/u.test(bare)) return `SH${bare}`;
    if (/^(0|2|3)/u.test(bare)) return `SZ${bare}`;
    throw new Error("无法根据代码推断交易所");
  }
  const upper = value.toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/u.test(upper) || upper.includes("..")) {
    throw new Error("美股代码格式无效");
  }
  return upper;
}

export function normalizeHistoryRequest(input) {
  const market = input?.market === "us" ? "us" : "cn";
  const source = String(input?.source ?? AUTO_DATA_SOURCE_ID);
  const provider = source === AUTO_DATA_SOURCE_ID ? null : historyDataSource(source);
  if (provider && !provider.markets.includes(market)) {
    throw new Error(`${provider.label} 不支持所选市场`);
  }
  if (!provider && source !== AUTO_DATA_SOURCE_ID) throw new Error("数据源无效");
  const allowedAdjustments = provider
    ? provider.adjustments
    : market === "cn"
      ? ["qfq", "hfq", "none"]
      : ["adj", "none"];
  const adjust = String(input?.adjust ?? "").toLowerCase();
  if (!allowedAdjustments.includes(adjust)) {
    throw new Error(`${provider?.label ?? (market === "cn" ? "A 股" : "美股")}不支持该复权口径`);
  }
  const from = String(input?.from ?? "");
  const to = String(input?.to ?? "");
  if (!isoDate(from) || !isoDate(to)) throw new Error("请填写有效的开始和结束日期");
  if (from > to) throw new Error("开始日期不能晚于结束日期");
  const symbol = normalizeSymbol(input?.symbol, market);
  return Object.freeze({
    market,
    symbol,
    adjust,
    from,
    to,
    source,
    csvPath: `${DATA_DIRECTORY}/${symbol}.csv`,
  });
}

export function parseHistoryDatasetMeta(text, path, csvPaths = new Set()) {
  if (
    !String(path).startsWith(`${DATA_DIRECTORY}/`) ||
    !String(path).endsWith(META_SUFFIX) ||
    String(path).split("/").length !== 3
  ) {
    throw new Error("metadata-path-invalid");
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("metadata-json-invalid");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("metadata-object-required");
  }
  if (value.format !== "codeshell.quant-dataset" || value.version !== 1) {
    throw new Error("metadata-format-unsupported");
  }
  const symbol = String(value.symbol ?? "");
  const csvPath = path.slice(0, -META_SUFFIX.length) + ".csv";
  const pathSymbol = path.slice(`${DATA_DIRECTORY}/`.length, -META_SUFFIX.length);
  if (
    !/^[A-Z0-9][A-Z0-9._-]{0,31}$/u.test(symbol) ||
    symbol !== pathSymbol ||
    !csvPaths.has(csvPath)
  ) {
    throw new Error("dataset-csv-missing");
  }
  const source = HISTORY_DATA_SOURCES.find((candidate) => candidate.id === value.source);
  if (
    !["cn", "us"].includes(value.market) ||
    !source ||
    !source.markets.includes(value.market) ||
    !source.adjustments.includes(value.adjust) ||
    !isoInstant(value.syncedAt) ||
    !Number.isInteger(value.bars) ||
    value.bars < 3 ||
    !isoDate(value.from) ||
    !isoDate(value.to) ||
    (value.networkCheckedThrough != null && !isoDate(value.networkCheckedThrough)) ||
    (value.networkCheckedThrough != null && value.networkCheckedThrough < value.to) ||
    value.from > value.to ||
    typeof value.fingerprint !== "string" ||
    !/^fnv1a32:[0-9a-f]{8}$/u.test(value.fingerprint)
  ) {
    throw new Error("metadata-fields-invalid");
  }
  return Object.freeze({
    symbol,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : null,
    market: value.market,
    adjust: value.adjust,
    source: value.source,
    syncedAt: value.syncedAt,
    bars: value.bars,
    from: value.from,
    to: value.to,
    // Older v1 sidecars did not record the requested provider interval. Keep
    // that absence explicit so startup maintenance performs one complete
    // reconciliation instead of assuming that a matching last-bar date also
    // proves there are no internal gaps.
    networkCheckedThrough: value.networkCheckedThrough ?? null,
    fingerprint: value.fingerprint,
    csvPath,
    metaPath: path,
  });
}

export function parseHistorySyncBundle(value, input) {
  const request = normalizeHistoryRequest(input);
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error("单股回测数据结果不是有效 JSON");
    }
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.format !== "codeshell.quant-dataset-bundle" ||
    value.version !== 1 ||
    typeof value.csv !== "string" ||
    !value.metadata ||
    typeof value.metadata !== "object" ||
    Array.isArray(value.metadata)
  ) throw new Error("单股回测数据结果无效");
  if (new TextEncoder().encode(value.csv).byteLength > 480 * 1024) {
    throw new Error("单股回测数据超过工作区文件大小限制");
  }
  const metaText = `${JSON.stringify(value.metadata, null, 2)}\n`;
  const meta = parseHistoryDatasetMeta(
    metaText,
    request.csvPath.replace(/\.csv$/u, META_SUFFIX),
    new Set([request.csvPath]),
  );
  if (
    meta.symbol !== request.symbol ||
    meta.market !== request.market ||
    meta.adjust !== request.adjust ||
    (request.source !== AUTO_DATA_SOURCE_ID && meta.source !== request.source)
  ) throw new Error("单股回测数据与请求口径不一致");
  const bars = parseOhlcvCsv(value.csv);
  if (
    bars.length !== meta.bars ||
    bars[0]?.date !== meta.from ||
    bars.at(-1)?.date !== meta.to ||
    fingerprintBars(bars) !== meta.fingerprint
  ) throw new Error("单股回测数据正文与元数据校验不一致");
  return Object.freeze({
    request,
    csv: value.csv,
    metaText,
    meta,
  });
}

function textElement(tagName, text, className = "") {
  const element = document.createElement(tagName);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function createHistoryDataController(options) {
  const { elements, hostCall, currentEpoch, contextState, onLoadDataset, notify, now } = options;
  const onHostEvent = options.onHostEvent;
  const resolveAShare = options.resolveAShare ?? ((value) => ({ symbol: value }));
  const onHistorySummary = options.onHistorySummary ?? (() => undefined);
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  let datasets = [];
  let skippedDatasets = 0;
  let loading = false;
  let sourcePreferences = { cn: AUTO_DATA_SOURCE_ID, us: AUTO_DATA_SOURCE_ID };
  let sourcePreferencesLoaded = false;
  let historySummary = null;
  let historySummaryLoaded = false;
  // Until the first shared-directory check completes, the honest state is
  // "checking" rather than "not initialized". This also prevents a brief
  // false empty state when opening the Panel in a fresh conversation.
  let historyStatusChecking = true;
  let historyStatusInFlight = false;
  let historyStatusPromise = null;
  let historyStatusRecoveryFailed = false;
  let historyInitializing = false;
  let historyProgress = null;
  let historyMessage = "";
  let historyMessageTone = "idle";
  let historyRuntime = null;
  let historyProcessId = null;
  let singleSyncProcessId = null;
  let singleSyncInFlight = false;
  let historyCancelled = false;
  let historyStartedAt = null;
  let historyCooldownTimer = null;
  let historyCooldownAt = null;
  let historyBackgroundPollTimer = null;
  const automaticFillAttempts = new Map();
  let automaticFillInFlight = null;
  const automaticProjectFillAttempts = new Set();
  const projectFillSymbols = new Map();
  let automaticProjectFillInFlight = null;
  const historyProcessRecords = new Map();

  function renderSourceRegistry() {
    if (!elements.sourceList) return;
    const marketLabel = { cn: "A 股", us: "美股" };
    const factorLabel = { native: "原生复权因子", derived: "本地推导因子", unavailable: "供应商复权价" };
    elements.sourceList.replaceChildren(...HISTORY_DATA_SOURCES.map((source) => {
      const row = textElement("article", "");
      row.dataset.sourceState = source.state;
      row.dataset.providerContract = source.contract;
      const identity = textElement("div", "");
      identity.append(
        textElement("b", source.label),
        textElement("span", [
          source.markets.map((market) => marketLabel[market]).join(" / "),
          "日线",
          factorLabel[source.capabilities.adjustmentFactors],
        ].join(" · ")),
      );
      row.append(
        identity,
        textElement("em", source.credentialEnv ? `需 ${source.credentialEnv}` : "免配置"),
      );
      return row;
    }));
  }

  renderSourceRegistry();

  function historyRecord(processId) {
    const existing = historyProcessRecords.get(processId);
    if (existing) return existing;
    const created = { stdout: "", stderr: "", stderrPending: "", exit: null, resolve: null };
    historyProcessRecords.set(processId, created);
    return created;
  }

  function applyHistoryProgress(value) {
    if (value?.type !== "history-progress") return;
    const total = Number(value.total);
    const completed = Number(value.completed);
    historyProgress = {
      stage: String(value.stage ?? "history"),
      total: Number.isInteger(total) && total > 0 ? total : 0,
      completed: Number.isInteger(completed) && completed >= 0 ? completed : 0,
      loaded: Number.isInteger(Number(value.loaded)) ? Number(value.loaded) : 0,
      skipped: Number.isInteger(Number(value.skipped)) ? Number(value.skipped) : 0,
      failed: Number.isInteger(Number(value.failed)) ? Number(value.failed) : 0,
      unavailable: Number.isInteger(Number(value.unavailable)) ? Number(value.unavailable) : 0,
      message: String(value.message ?? "").normalize("NFKC").trim().slice(0, 120),
    };
    renderHistoryBootstrap();
  }

  const unsubscribeHistoryOutput = onHostEvent?.("process.output", (payload) => {
    const processId = typeof payload?.processId === "string" ? payload.processId : "";
    if (
      !processId ||
      ![historyProcessId, singleSyncProcessId].includes(processId) ||
      !["stdout", "stderr"].includes(payload?.stream) ||
      typeof payload?.text !== "string"
    ) return;
    const record = historyRecord(processId);
    const collected = collectHistoryProcessOutput(record, payload.stream, payload.text);
    if (collected.overflow) {
      void hostCall("process.cancel", { processId }).catch(() => undefined);
      return;
    }
    if (payload.stream !== "stderr" || processId !== historyProcessId) return;
    for (const line of collected.lines) {
      try {
        applyHistoryProgress(JSON.parse(line));
      } catch {
        // Upstream warnings remain in stderr for the final error fallback.
      }
    }
  });

  const unsubscribeHistoryExit = onHostEvent?.("process.exit", (payload) => {
    const processId = typeof payload?.processId === "string" ? payload.processId : "";
    if (!processId || ![historyProcessId, singleSyncProcessId].includes(processId)) return;
    const record = historyRecord(processId);
    record.exit = { code: payload?.code, signal: payload?.signal };
    record.resolve?.(record);
  });

  function formatStorageSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "—";
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function syncBootstrapScopeToSummary() {
    if (!historySummary || !elements.bootstrapScope) return;
    elements.bootstrapScope.value = historySummary.scope;
  }

  function clearHistoryCooldownTimer() {
    if (historyCooldownTimer != null) window.clearTimeout(historyCooldownTimer);
    historyCooldownTimer = null;
    historyCooldownAt = null;
  }

  function syncHistoryCooldownTimer(resumeAfter) {
    const resumeAt = Date.parse(String(resumeAfter ?? ""));
    const delay = resumeAt - now().getTime();
    if (!Number.isFinite(resumeAt) || delay <= 0) {
      clearHistoryCooldownTimer();
      return;
    }
    if (historyCooldownTimer != null && historyCooldownAt === resumeAt) return;
    clearHistoryCooldownTimer();
    historyCooldownAt = resumeAt;
    historyCooldownTimer = window.setTimeout(() => {
      historyCooldownTimer = null;
      historyCooldownAt = null;
      renderHistoryBootstrap();
      if (
        historySummary?.paused === true &&
        ["close", "previous-close"].includes(historySummary.sessionPhase) &&
        historyAutofillNeeded(historySummary, historySummary.marketDate, now())
      ) {
        void autoFillThrough(historySummary.marketDate, historySummary.sessionPhase);
      }
    }, Math.min(delay + 250, 2_147_483_647));
  }

  function clearHistoryBackgroundPollTimer() {
    if (historyBackgroundPollTimer != null) window.clearTimeout(historyBackgroundPollTimer);
    historyBackgroundPollTimer = null;
  }

  function syncHistoryBackgroundPollTimer() {
    if (
      historySummary?.running !== true ||
      historyInitializing ||
      historyStatusInFlight ||
      historyBackgroundPollTimer != null
    ) {
      if (historySummary?.running !== true || historyInitializing || historyStatusInFlight) {
        clearHistoryBackgroundPollTimer();
      }
      return;
    }
    historyBackgroundPollTimer = window.setTimeout(() => {
      historyBackgroundPollTimer = null;
      void (async () => {
        const summary = await refreshHistorySummaryFromLocal();
        if (summary?.running === true) {
          syncHistoryBackgroundPollTimer();
          return;
        }
        if (!summary) return;
        historyMessageTone = summary.remaining > 0 || summary.failed > 0 ? "warning" : "idle";
        historyMessage = summary.remaining > 0 || summary.failed > 0
          ? `后台自动补齐已结束；已核对 ${summary.ready}/${summary.total} 只，${summary.remaining} 只暂不可用，下一交易日会自动再查。`
          : `后台自动补齐已完成；${summary.ready}/${summary.total} 只历史数据已就绪。`;
        renderHistoryBootstrap();
        notify(summary.remaining > 0 || summary.failed > 0
          ? "历史数据已核对，个别股票暂不可用"
          : "A 股历史基础库已自动补齐");
      })();
    }, HISTORY_BACKGROUND_POLL_MS);
  }

  function formatHistoryResumeTime(value) {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(value));
  }

  function renderAutofillAudit() {
    if (!elements.autofillAuditList || !elements.autofillAuditSummary) return;
    const list = elements.autofillAuditList;
    list.replaceChildren();
    const labels = {
      initialization: "首次初始化",
      incremental: "增量更新",
      "gap-fill": "缺口联网补齐",
      "snapshot-fill": "收盘快照补齐",
      "snapshot-check": "收盘缺口检查",
    };
    const statusLabels = { running: "进行中", complete: "已完成", partial: "部分完成", paused: "已暂停" };
    let audit = historySummary?.auditTrail ? [...historySummary.auditTrail] : [];
    if (!audit.length && historySummary?.snapshotBackfillAt) {
      audit.push({
        at: historySummary.snapshotBackfillAt,
        kind: historySummary.snapshotBackfilledSeries > 0 ? "snapshot-fill" : "snapshot-check",
        status: historySummary.snapshotBackfillDeferred > 0 ? "partial" : "complete",
        from: null,
        through: historySummary.snapshotBackfillThrough,
        requestedGapDates: historySummary.snapshotGapDates,
        updatedSeries: historySummary.snapshotBackfilledSeries,
        addedBars: historySummary.snapshotBackfilledBars,
        skippedSeries: 0,
        failedSeries: 0,
      });
    }
    if (!audit.length && historySummary) {
      audit.push({
        at: historySummary.updatedAt,
        kind: "incremental",
        status: historySummary.paused ? "paused" : historySummary.remaining > 0 || historySummary.failed > 0 ? "partial" : "complete",
        from: historySummary.from,
        through: historySummary.confirmedThrough ?? historySummary.to,
        requestedGapDates: [],
        updatedSeries: historySummary.loaded,
        addedBars: 0,
        skippedSeries: historySummary.skipped,
        failedSeries: historySummary.failed,
      });
    }
    if (historyInitializing) {
      audit.push({
        at: null,
        kind: historySummary?.snapshotGapDates?.length || historySummary?.snapshotBackfillDeferred > 0 ? "gap-fill" : "incremental",
        status: "running",
        from: historySummary?.confirmedThrough ?? historySummary?.to ?? null,
        through: historySummary?.marketDate ?? null,
        requestedGapDates: historySummary?.snapshotGapDates ?? [],
        updatedSeries: historyProgress?.loaded ?? 0,
        addedBars: 0,
        skippedSeries: historyProgress?.skipped ?? 0,
        failedSeries: historyProgress?.failed ?? 0,
      });
    }
    const recent = audit.slice(-3).reverse();
    if (!recent.length) {
      const row = textElement("li", "", "");
      row.dataset.state = historyStatusChecking ? "running" : "waiting";
      row.append(
        textElement("time", historyStatusChecking ? "现在" : "—"),
        textElement("b", historyStatusChecking ? "正在核对本地基础库" : "尚无记录"),
        textElement("span", historyStatusChecking
          ? "只读取本地清单与收盘快照；发现连续缺口后才会启动固定程序联网补齐。"
          : "初始化后每次打开工作台都会检查；这里会说明何时检查、补了什么，以及是否仍有缺口。"),
      );
      list.append(row);
      elements.autofillAuditSummary.textContent = historyStatusChecking ? "正在读取最近状态" : "等待首次初始化";
      return;
    }
    for (const event of recent) {
      const gaps = Array.isArray(event.requestedGapDates) ? event.requestedGapDates : [];
      const detail = [
        gaps.length ? `发现 ${gaps.map((date) => date.slice(5).replace("-", "/")).join("、")}` : "",
        event.from && event.through && event.from !== event.through ? `${event.from} → ${event.through}` : event.through ? `核对至 ${event.through}` : "",
        event.updatedSeries > 0 ? `更新 ${event.updatedSeries} 只` : "",
        event.addedBars > 0 ? `补入 ${event.addedBars} 根日线` : "",
        event.skippedSeries > 0 ? `复用 ${event.skippedSeries} 只` : "",
        event.failedSeries > 0 ? `失败 ${event.failedSeries} 只` : "",
        statusLabels[event.status] ?? "",
      ].filter(Boolean).join(" · ");
      const row = textElement("li", "", "");
      row.dataset.state = event.status;
      row.append(
        textElement("time", event.at ? formatHistoryResumeTime(event.at) : "现在"),
        textElement("b", labels[event.kind] ?? "基础库更新"),
        textElement("span", detail || "本轮未产生需要写入的变化"),
      );
      list.append(row);
    }
    const latest = recent[0];
    elements.autofillAuditSummary.textContent = latest.status === "running"
      ? "当前更新进行中"
      : `最近 ${latest.at ? formatHistoryResumeTime(latest.at) : "刚刚"} · ${statusLabels[latest.status] ?? "已记录"}`;
  }

  function renderLatestCoverage() {
    if (!elements.latestCoverageList || !elements.latestCoverageSummary) return;
    const rows = historySummary?.latestDateDistribution ?? [];
    elements.latestCoverageList.replaceChildren();
    if (!rows.length) {
      elements.latestCoverageSummary.textContent = historyStatusChecking ? "正在读取股票清单" : "当前清单未包含日期分布";
      elements.latestCoverageList.append(textElement("p", historyStatusChecking
        ? "核对完成后会列出最新日线停留在各日期的股票数。"
        : "下次本地状态检查会重建这份分布。"));
      return;
    }
    const targetDate = [
      historySummary.snapshotBackfillThrough,
      historySummary.confirmedThrough,
      historySummary.marketDate,
      historySummary.to,
    ].filter((value) => isoDate(String(value ?? ""))).sort().at(-1);
    const targetCount = rows.find((row) => row.date === targetDate)?.count ?? 0;
    elements.latestCoverageSummary.textContent = `${targetCount}/${historySummary.cached} 只已到 ${targetDate}`;
    const maximum = Math.max(1, historySummary.cached, ...rows.map((row) => row.count));
    for (const row of rows) {
      const item = textElement("div", "", "history-latest-coverage-row");
      item.dataset.state = row.date === targetDate ? "current" : "lagging";
      const date = textElement("time", row.date.slice(5).replace("-", "/"));
      date.dateTime = row.date;
      const track = textElement("span", "", "history-latest-coverage-track");
      const fill = textElement("i", "");
      fill.style.width = `${Math.max(2, (row.count / maximum) * 100).toFixed(2)}%`;
      track.append(fill);
      item.append(date, track, textElement("b", `${row.count} 只`));
      elements.latestCoverageList.append(item);
    }
  }

  function renderSessionCoverage() {
    if (!elements.sessionCoverageList) return;
    elements.sessionCoverageList.replaceChildren();
    const rows = historySummary?.recentSnapshotCoverage ?? [];
    if (!rows.length) {
      elements.sessionCoverageList.append(textElement("p", historyStatusChecking
        ? "正在读取最近交易日"
        : "暂无已留存的收盘快照"));
      return;
    }
    for (const row of [...rows].reverse()) {
      const item = textElement("span", "", "history-session-coverage-item");
      const date = textElement("time", row.date.slice(5).replace("-", "/"));
      date.dateTime = row.date;
      item.append(date, textElement("b", `${row.count.toLocaleString("zh-CN")} 只`));
      item.title = `${row.date} 已留存 ${row.count.toLocaleString("zh-CN")} 只在市股票收盘快照`;
      elements.sessionCoverageList.append(item);
    }
  }

  function renderHistoryBootstrap() {
    if (!elements.bootstrap) return;
    syncHistoryCooldownTimer(historySummary?.paused ? historySummary.resumeAfter : null);
    if (elements.bootstrapNext) {
      elements.bootstrapNext.hidden = !historySummary || historyInitializing;
      elements.bootstrapNext.disabled = historyInitializing || historyStatusChecking;
    }
    onHistorySummary(historySummary, {
      initializing: historyInitializing,
      checking: historyStatusChecking,
      tone: historyMessageTone,
    });
    syncHistoryBackgroundPollTimer();
    const requestedScope = ["core", "broad", "full"].includes(elements.bootstrapScope.value)
      ? elements.bootstrapScope.value
      : "core";
    const requestedLimit = requestedScope === "full" ? 0 : requestedScope === "broad" ? 300 : 120;
    const requestedCoverage = requestedScope === "full" ? "待核对全市场" : String(requestedLimit);
    const renderAutofill = (state, message) => {
      if (!elements.autofill) return;
      elements.autofill.dataset.state = state;
      elements.autofill.querySelector("strong").textContent = message;
    };
    renderAutofillAudit();
    renderLatestCoverage();
    renderSessionCoverage();
    const selectedSource = historySummary?.source ?? elements.bootstrapSource.value;
    const source = historyDataSource(selectedSource);
    elements.bootstrapSourceLabel.textContent = source?.label ?? "请选择";
    if (historyInitializing) {
      const total = historyProgress?.total || requestedLimit;
      const completed = Math.min(total, historyProgress?.completed ?? 0);
      const ratio = total ? completed / total : 0;
      elements.bootstrap.dataset.state = "running";
      elements.bootstrapBadge.textContent = historyProgress?.stage === "universe"
        ? "核对股票池"
        : historyProgress?.stage === "source"
          ? "检查数据源"
          : `${completed} / ${total}`;
      elements.bootstrapRange.textContent = "近 3 年 · 原始价＋因子";
      elements.bootstrapCoverage.textContent = `${completed} / ${total || requestedCoverage} 已处理`;
      elements.bootstrapDate.textContent = historySummary?.marketDate ?? "读取中";
      elements.bootstrapSize.textContent = formatStorageSize(historySummary?.storageBytes ?? 0);
      elements.bootstrapAction.textContent = historyCancelled ? "正在停止…" : "停止初始化";
      elements.bootstrapAction.disabled = historyCancelled;
      elements.bootstrapScope.disabled = true;
      elements.bootstrapSource.disabled = true;
      elements.bootstrapProgress.style.width = `${(ratio * 100).toFixed(2)}%`;
      const remainingMs = estimatedHistoryRemainingMs({
        completed,
        total,
        elapsedMs: historyStartedAt == null ? 0 : Math.max(0, monotonicNow() - historyStartedAt),
      });
      elements.bootstrapStatus.textContent = historyProgress?.message
        ? [
            historyProgress.message,
            total ? `进度 ${(ratio * 100).toFixed(1)}%` : "",
            remainingMs == null ? "" : `按当前速度预计剩余 ${formatHistoryDuration(remainingMs)}`,
            `已更新 ${historyProgress.loaded}`,
            `已复用 ${historyProgress.skipped}`,
            historyProgress.unavailable > 0 ? `暂不可用 ${historyProgress.unavailable}` : "",
            `失败 ${historyProgress.failed}`,
          ].filter(Boolean).join(" · ")
        : "正在启动本地历史数据初始化程序…";
      return;
    }
    if (historyStatusChecking && !historySummary) {
      elements.bootstrap.dataset.state = "empty";
      elements.bootstrapBadge.textContent = "检查本地基础库";
      elements.bootstrapCoverage.textContent = `0 / ${requestedCoverage}`;
      elements.bootstrapDate.textContent = "读取中";
      elements.bootstrapSize.textContent = "—";
      elements.bootstrapAction.textContent = "正在检查…";
      elements.bootstrapAction.disabled = true;
      elements.bootstrapScope.disabled = true;
      elements.bootstrapSource.disabled = true;
      elements.bootstrapProgress.style.width = "0%";
      elements.bootstrapStatus.textContent = "正在核对本地收盘快照并自动补齐历史基础库，不会联网请求行情。";
      renderAutofill("checking", "正在逐日核对本地快照");
      return;
    }
    elements.bootstrapScope.disabled = false;
    elements.bootstrapSource.disabled = Boolean(historySummary);
    elements.bootstrapAction.disabled = !source;
    elements.bootstrapProgress.style.width = "0%";
    if (!historySummary) {
      elements.bootstrap.dataset.state = historyMessageTone === "error" ? "error" : historyMessageTone === "warning" ? "partial" : "empty";
      elements.bootstrapBadge.textContent = historyStatusRecoveryFailed ? "状态恢复失败" : historyMessageTone === "warning" ? "初始化已暂停" : historyMessageTone === "error" ? "初始化失败" : "尚未初始化";
      elements.bootstrapRange.textContent = "近 3 年 · 原始价＋因子";
      elements.bootstrapCoverage.textContent = historyStatusRecoveryFailed ? "已有文件状态暂不可读" : `0 / ${requestedCoverage}`;
      elements.bootstrapDate.textContent = "—";
      elements.bootstrapSize.textContent = "—";
      elements.bootstrapAction.textContent = historyStatusRecoveryFailed ? "重新读取状态" : "初始化基础库";
      elements.bootstrapStatus.textContent = historyMessage || (source
        ? requestedScope === "full"
          ? `${source.label}将以单路慢速模式准备全部在市 A 股的原始日线与复权信息：不并发、请求间主动等待，预计需要数小时；可随时停止并续跑。`
          : `${source.label}将提供原始日线与复权信息；前复权研究价格由本地统一生成，并记录来源与口径版本。`
        : "请先选择历史数据源和股票范围。数据保存在投资工作台本地目录，不写入当前项目，也不会进入 Git。");
      renderAutofill("idle", "初始化一次后，每次打开自动检查");
      return;
    }
    elements.bootstrapSource.value = historySummary.source;
    const complete = historySummary.remaining === 0 && historySummary.failed === 0;
    const currentCoverage = Boolean(
      historySummary.confirmedThrough && historySummary.confirmedThrough >= historySummary.marketDate,
    );
    const researchReady = complete || (
      currentCoverage && historySummary.total > 0 && historySummary.ready / historySummary.total >= 0.95
    );
    const networkCurrent = Boolean(
      historySummary.networkCheckedThrough && historySummary.networkCheckedThrough >= historySummary.marketDate,
    );
    const cooldownMs = historySummary.paused && historySummary.resumeAfter
      ? Math.max(0, Date.parse(historySummary.resumeAfter) - now().getTime())
      : 0;
    const coolingDown = cooldownMs > 0;
    elements.bootstrap.dataset.state = historyMessageTone === "error" ? "error" : researchReady ? "ready" : "partial";
    elements.bootstrapBadge.textContent = researchReady
      ? complete
        ? historySummary.legacyVendorAdjusted > 0 ? "基础库可用 · 迁移中" : "基础库已就绪"
        : `基础库可用 · ${historySummary.remaining} 只暂不可用`
      : coolingDown
        ? "数据源冷却中"
        : historySummary.paused
          ? "等待数据源恢复"
          : "部分数据可用";
    elements.bootstrapRange.textContent = historySummary.from && historySummary.to
      ? `${historySummary.from} → ${historySummary.to} · 原始价＋因子`
      : `近 ${historySummary.years} 年 · 原始价＋因子`;
    elements.bootstrapCoverage.textContent = `${historySummary.ready} / ${historySummary.total} · 缓存 ${historySummary.cached}`;
    elements.bootstrapDate.textContent = historySummary.to ?? historySummary.marketDate;
    elements.bootstrapSize.textContent = formatStorageSize(historySummary.storageBytes);
    if (historySummary.running) {
      const ratio = historySummary.total ? historySummary.ready / historySummary.total : 0;
      elements.bootstrap.dataset.state = "running";
      elements.bootstrapBadge.textContent = "后台初始化中";
      elements.bootstrapAction.textContent = "后台初始化中";
      elements.bootstrapAction.disabled = true;
      elements.bootstrapScope.disabled = true;
      elements.bootstrapSource.disabled = true;
      elements.bootstrapProgress.style.width = `${(ratio * 100).toFixed(2)}%`;
      elements.bootstrapStatus.textContent = [
        "另一窗口或刷新前启动的低速任务仍在运行，请勿重复启动",
        `进度清单已保存 ${historySummary.ready}/${historySummary.total}`,
        historySummary.runStartedAt
          ? `开始于 ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(historySummary.runStartedAt))}`
          : "",
        "可以离开本页，任务会继续运行",
      ].filter(Boolean).join(" · ");
      renderAutofill("filling", "正在联网补齐缺口与落后交易日");
      return;
    }
    const selectedScope = elements.bootstrapScope.value;
    const selectedLimit = selectedScope === "full" ? Number.POSITIVE_INFINITY : selectedScope === "broad" ? 300 : 120;
    elements.bootstrapAction.disabled = !source || coolingDown;
    elements.bootstrapAction.textContent = coolingDown
      ? `等待 ${formatHistoryDuration(cooldownMs)}`
      : selectedScope === "full" && historySummary.scope !== "full"
        ? "扩展到全部 A 股"
        : selectedScope !== "full" && selectedLimit > historySummary.limit
          ? "扩展到 300 只"
          : historySummary.remaining > 0 || historySummary.failed > 0
            ? networkCurrent
              ? `重新核验 ${historySummary.remaining} 只`
              : historySummary.scope === "full" ? "继续补齐全市场" : `继续补齐 ${historySummary.limit} 只`
            : historySummary.legacyVendorAdjusted > 0
              ? `增量更新并迁移 ${historySummary.scope === "full" ? "全市场" : `${historySummary.limit} 只`}`
              : `增量更新 ${historySummary.scope === "full" ? "全市场" : `${historySummary.limit} 只`}`;
    elements.bootstrapStatus.textContent = historyMessage || [
      `来源 ${historySourceLabel(historySummary.source)}`,
      coolingDown
        ? `限流保护中，最早 ${formatHistoryResumeTime(historySummary.resumeAfter)} 后可继续，期间不发起历史请求`
        : "",
      historySummary.legacyInterrupted ? "检测到旧版限流记录，未完成股票已改为待补齐" : "",
      historySummary.remaining > 0
        ? networkCurrent
          ? `个别股票暂不可用 ${historySummary.remaining} 只，下一交易日自动再查`
          : `待补齐 ${historySummary.remaining} 只`
        : "",
      `最近更新 ${new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(historySummary.updatedAt))}`,
      `本轮更新 ${historySummary.loaded}`,
      `复用 ${historySummary.skipped}`,
      historySummary.snapshotBackfilledSeries > 0
        ? `本地收盘快照自动补齐 ${historySummary.snapshotBackfilledSeries} 只 / ${historySummary.snapshotBackfilledBars} 根`
        : "",
      historySummary.snapshotBackfillThrough
        ? `自动补齐已核对至 ${historySummary.snapshotBackfillThrough}`
        : "",
      historySummary.snapshotBackfillDeferred > 0
        ? historySummary.networkCheckedThrough && historySummary.networkCheckedThrough >= historySummary.snapshotBackfillThrough
          ? `已联网核验；${historySummary.snapshotBackfillDeferred} 只因停牌、数据源缺失或复权不连续暂保留原序列`
          : `复权连续性待联网核验 ${historySummary.snapshotBackfillDeferred} 只`
        : "",
      historySummary.snapshotGapDates.length
        ? historySummary.networkCheckedThrough && historySummary.networkCheckedThrough >= historySummary.snapshotBackfillThrough
          ? `个别序列缺少 ${historySummary.snapshotGapDates.map((date) => date.slice(5).replace("-", "/")).join("、")} 成交，联网核验后仍无有效日线`
          : `中间交易日缺口 ${historySummary.snapshotGapDates.map((date) => date.slice(5).replace("-", "/")).join("、")}，已转联网增量补齐`
        : "",
      historySummary.confirmedThrough ? `历史数据最晚确认至 ${historySummary.confirmedThrough}` : "",
      historySummary.provisional ? "盘中临时报价未写入历史日线" : "",
      `原始价＋复权因子 ${historySummary.rawFactorReady} / ${historySummary.cached}`,
      historySummary.legacyVendorAdjusted > 0 ? `旧版供应商前复权待渐进迁移 ${historySummary.legacyVendorAdjusted} 只` : "",
      historySummary.migrated > 0 ? `本轮迁移 ${historySummary.migrated} 只` : "",
      historySummary.factorRebased > 0 ? `复权因子重算 ${historySummary.factorRebased} 只` : "",
      historySummary.overlapValidated > 0
        ? `重叠校验 ${historySummary.overlapValidated} 根${historySummary.basisMismatches > 0 ? `，发现差异 ${historySummary.basisMismatches} 根` : "，口径一致"}`
        : "",
      historySummary.overlapCorrections > 0 ? `单根行情修订 ${historySummary.overlapCorrections} 根（已合并，未重建）` : "",
      `复权重建 ${historySummary.rebuilt}`,
      historySummary.unavailable > 0 ? `新股、短历史或来源暂不可用 ${historySummary.unavailable} 只（后续自动再查）` : "",
      historySummary.excludedCount > 0 ? `已排除不在当前在市池的旧记录 ${historySummary.excludedCount} 只` : "",
      historySummary.failed > 0 ? `本轮失败 ${historySummary.failed}` : "",
      historySummary.failures.some((item) => item.errorCode !== "HISTORY_NOT_USABLE")
        ? `异常 ${historySummary.failures.filter((item) => item.errorCode !== "HISTORY_NOT_USABLE").slice(0, 3).map((item) => item.name || item.symbol).join("、")}`
        : "",
    ].filter(Boolean).join(" · ");
    const deferredChecked = historySummary.snapshotBackfillDeferred > 0
      && historySummary.networkCheckedThrough
      && historySummary.networkCheckedThrough >= historySummary.snapshotBackfillThrough;
    renderAutofill(
      (historySummary.snapshotGapDates.length || historySummary.snapshotBackfillDeferred > 0) && !deferredChecked ? "gap" : "ready",
      deferredChecked
        ? `已核对至 ${historySummary.snapshotBackfillThrough} · ${historySummary.snapshotBackfillDeferred} 只个别序列待下一交易日再检查`
        : historySummary.snapshotGapDates.length
        ? `发现缺口 ${historySummary.snapshotGapDates.map((date) => date.slice(5).replace("-", "/")).join("、")} · 转联网补齐`
        : historySummary.snapshotBackfillDeferred > 0
          ? `${historySummary.snapshotBackfillDeferred} 只待联网核验复权连续性`
          : historySummary.snapshotBackfillThrough
            ? `已逐日核对至 ${historySummary.snapshotBackfillThrough} · 无中间缺口 · 下次打开或 15:12 盘后复核`
            : "已启用自动检查 · 打开时与 15:12 盘后核对",
    );
  }

  async function restoreHistorySummary() {
    if (historySummaryLoaded) return;
    historySummaryLoaded = true;
    try {
      const saved = await hostCall("storage.get", { key: HISTORY_LIBRARY_STATUS_KEY });
      if (saved) {
        historySummary = parseHistoryLibrarySummary(saved);
        syncBootstrapScopeToSummary();
      }
    } catch (error) {
      historyMessageTone = "warning";
      historyMessage = `历史库状态缓存未通过校验：${error instanceof Error ? error.message : "缓存解析失败"}。正在从本地历史库恢复，已有数据不会被删除。`;
    }
    renderHistoryBootstrap();
  }

  async function ensureHistoryRuntime() {
    if (historyRuntime) return historyRuntime;
    if (typeof onHostEvent !== "function") throw new Error("历史基础库需在 CodeShell 投资工作台内运行");
    let selected = null;
    for (const spec of HISTORY_RUNTIME_SPECS) {
      const executable = await hostCall("process.find", { name: spec.name });
      if (executable?.available && typeof executable.handle === "string") {
        selected = { executable, spec };
        break;
      }
    }
    if (!selected) throw new Error("未发现 Node.js 或 Bun，无法初始化历史基础库");
    let directory = null;
    let storageMode = "app-data";
    try {
      directory = await hostCall("filesystem.getKnownDirectory", { name: "app-data" });
    } catch {
      storageMode = "downloads";
      try {
        directory = await hostCall("filesystem.getKnownDirectory", { name: "downloads" });
      } catch {
        throw new Error("当前 CodeShell 无法提供历史基础库保存目录，请更新桌面端后重试");
      }
    }
    if (typeof directory?.handle !== "string") throw new Error("无法取得受限的历史基础库保存目录");
    historyRuntime = {
      executableHandle: selected.executable.handle,
      directoryHandle: directory.handle,
      name: selected.spec.name,
      storageMode,
    };
    return historyRuntime;
  }

  function waitForHistoryExit(processId) {
    const record = historyRecord(processId);
    if (record.exit) return Promise.resolve(record);
    return new Promise((resolveWait, reject) => {
      const timeout = window.setTimeout(() => {
        record.resolve = null;
        void hostCall("process.cancel", { processId }).catch(() => undefined);
        reject(new Error("历史基础库初始化超时，已停止本次任务"));
      }, HISTORY_PROCESS_TIMEOUT_MS);
      record.resolve = (next) => {
        window.clearTimeout(timeout);
        record.resolve = null;
        resolveWait(next);
      };
    });
  }

  function historyProcessError(stderr) {
    const lines = String(stderr).trim().split(/\r?\n/u).filter(Boolean).reverse();
    for (const line of lines) {
      try {
        const value = JSON.parse(line);
        if (value?.type === "history-error" && typeof value.message === "string") return value.message.slice(0, 300);
      } catch {
        // Continue to the next structured or plain-text line.
      }
    }
    return lines.find((line) => line.length < 300) ?? "历史基础库初始化失败";
  }

  async function initializeHistoryLibrary({ automatic = false } = {}) {
    if (historyStatusChecking) return;
    if (historyInitializing) {
      historyCancelled = true;
      renderHistoryBootstrap();
      if (historyProcessId) await hostCall("process.cancel", { processId: historyProcessId }).catch(() => undefined);
      return;
    }
    historyInitializing = true;
    historyCancelled = false;
    historyStartedAt = monotonicNow();
    historyProgress = null;
    historyMessage = "";
    historyMessageTone = "idle";
    renderHistoryBootstrap();
    let processId = null;
    try {
      const scope = ["broad", "full"].includes(elements.bootstrapScope.value)
        ? elements.bootstrapScope.value
        : "core";
      const source = historyLibrarySource(elements.bootstrapSource.value);
      const runtime = await ensureHistoryRuntime();
      const started = await hostCall("process.spawn", {
        executableHandle: runtime.executableHandle,
        directoryHandle: runtime.directoryHandle,
        args: historyLibraryRuntimeArgs(runtime.name, scope, automatic ? "autofill" : "initialize", source.id),
      });
      if (typeof started?.processId !== "string") throw new Error("历史基础库程序未能启动");
      processId = started.processId;
      historyProcessId = processId;
      const record = await waitForHistoryExit(processId);
      if (historyCancelled) {
        historyMessageTone = "warning";
        historyMessage = "初始化已停止；已经写入的股票会在下次运行时直接复用，不会从头重来。";
        return;
      }
      if (record.exit?.code !== 0) throw new Error(historyProcessError(record.stderr));
      const summary = parseHistoryLibrarySummary(record.stdout);
      historySummary = summary;
      syncBootstrapScopeToSummary();
      await hostCall("storage.set", { key: HISTORY_LIBRARY_STATUS_KEY, value: summary }).catch(() => undefined);
      const onlyUnavailable = historyOnlyUnavailable(summary);
      historyMessageTone = summary.remaining > 0 || summary.failed > 0 ? "warning" : "idle";
      historyMessage = summary.paused
        ? `${historySourceLabel(summary.source)}暂时受限，已安全暂停；${summary.ready} 只已保留，待补齐 ${summary.remaining} 只${summary.resumeAfter ? `，最早 ${formatHistoryResumeTime(summary.resumeAfter)} 后可续跑` : "，稍后可续跑"}。`
        : summary.remaining > 0 || summary.failed > 0
          ? onlyUnavailable
            ? `${historySourceLabel(summary.source)}基础库已核对 ${summary.ready}/${summary.total} 只；另有 ${summary.unavailable} 只新股、短历史或来源暂不可用，下一交易日自动再查。`
            : `${historySourceLabel(summary.source)}基础库已准备 ${summary.ready}/${summary.total} 只，待后续核验 ${summary.remaining} 只；已写入数据会直接复用。`
        : `${historySourceLabel(summary.source)}基础库已准备 ${summary.ready}/${summary.total} 只；${automatic ? "缺失交易日已自动补齐。" : "后续增量更新会沿用该来源。"}`;
      if (runtime.storageMode === "downloads") {
        historyMessage += " 当前桌面端暂不支持面板私有目录，数据已兼容保存到本机下载目录的 a-share-history 文件夹。";
      }
      notify(summary.remaining > 0 || summary.failed > 0
        ? onlyUnavailable ? "历史数据已核对，个别股票暂不可用" : "历史基础库部分完成，可继续核验"
        : automatic ? "A 股历史基础库已自动补齐" : "A 股历史基础库初始化完成");
    } catch (error) {
      if (!historyCancelled) {
        historyMessageTone = "error";
        historyMessage = error instanceof Error ? error.message : "历史基础库初始化失败";
      }
    } finally {
      if (processId) historyProcessRecords.delete(processId);
      historyProcessId = null;
      historyInitializing = false;
      historyStartedAt = null;
      renderHistoryBootstrap();
    }
  }

  async function refreshHistorySummaryFromLocal() {
    if (historyInitializing) return historySummary;
    if (historyStatusPromise) return historyStatusPromise;
    const task = (async () => {
      historyStatusInFlight = true;
      historyStatusChecking = true;
      renderHistoryBootstrap();
      let processId = null;
      try {
        const runtime = await ensureHistoryRuntime();
        const started = await hostCall("process.spawn", {
          executableHandle: runtime.executableHandle,
          directoryHandle: runtime.directoryHandle,
          args: historyLibraryRuntimeArgs(
            runtime.name,
            historySummary?.scope ?? "core",
            "status",
            historySummary?.source ?? HISTORY_LIBRARY_DEFAULT_SOURCE,
          ),
        });
        if (typeof started?.processId !== "string") return historySummary;
        processId = started.processId;
        historyProcessId = processId;
        const record = await waitForHistoryExit(processId);
        if (record.exit?.code !== 0) throw new Error(historyProcessError(record.stderr));
        historySummary = parseHistoryLibrarySummary(record.stdout);
        historyStatusRecoveryFailed = false;
        syncBootstrapScopeToSummary();
        await hostCall("storage.set", { key: HISTORY_LIBRARY_STATUS_KEY, value: historySummary }).catch(() => undefined);
        historyMessage = "";
        historyMessageTone = historySummary.remaining > 0 || historySummary.failed > 0 ? "warning" : "idle";
        return historySummary;
      } catch (error) {
        historyStatusRecoveryFailed = true;
        historyMessageTone = "error";
        historyMessage = `本地历史库状态恢复失败：${error instanceof Error ? error.message : "状态解析失败"}。已保留已有文件，请重新读取状态；这不代表历史库未初始化。`;
        return historySummary;
      } finally {
        if (processId) historyProcessRecords.delete(processId);
        historyProcessId = null;
        historyStatusInFlight = false;
        historyStatusChecking = false;
        renderHistoryBootstrap();
      }
    })();
    historyStatusPromise = task;
    try {
      return await task;
    } finally {
      if (historyStatusPromise === task) historyStatusPromise = null;
    }
  }

  async function autoFillThrough(marketDate, sessionPhase) {
    if (!isoDate(String(marketDate ?? "")) || !["close", "previous-close"].includes(sessionPhase)) {
      return historySummary;
    }
    if (automaticFillInFlight) return automaticFillInFlight;
    const checkedAt = now().getTime();
    const previousAttemptAt = automaticFillAttempts.get(marketDate) ?? 0;
    const resumeAt = Date.parse(String(historySummary?.resumeAfter ?? ""));
    const cooldownExplicitlyExpired = historySummary?.paused === true &&
      Number.isFinite(resumeAt) &&
      resumeAt > previousAttemptAt &&
      resumeAt <= checkedAt;
    if (!cooldownExplicitlyExpired && checkedAt - previousAttemptAt < HISTORY_AUTOFILL_RECHECK_MS) {
      return historySummary;
    }
    const task = (async () => {
      const summary = await refreshHistorySummaryFromLocal();
      if (
        !summary ||
        summary.running ||
        historyInitializing ||
        singleSyncInFlight
      ) return summary;
      if (!historyAutofillNeeded(summary, marketDate, now())) return summary;
      // Only a real launch consumes the same-day retry window. Merely joining
      // an in-flight status read must not suppress the autofill that follows.
      automaticFillAttempts.set(marketDate, now().getTime());
      for (const [date] of automaticFillAttempts) {
        if (date !== marketDate) automaticFillAttempts.delete(date);
      }
      historyMessageTone = "warning";
      historyMessage = `发现 ${marketDate} 前存在缺口、落后交易日或到期重试项，正在后台直接增量核对；不启动 Agent。`;
      renderHistoryBootstrap();
      await initializeHistoryLibrary({ automatic: true });
      return historySummary;
    })();
    automaticFillInFlight = task;
    try {
      return await task;
    } finally {
      if (automaticFillInFlight === task) automaticFillInFlight = null;
    }
  }

  function setState(message, tone = "idle") {
    elements.state.textContent = message;
    elements.state.dataset.tone = tone;
  }

  function syncAdjustmentFields() {
    const market = elements.market.value === "us" ? "us" : "cn";
    const source = historyDataSource(elements.source.value);
    const values = source
      ? source.adjustments
      : market === "cn"
        ? ["qfq", "hfq", "none"]
        : ["adj", "none"];
    const labels = {
      qfq: "前复权 qfq",
      hfq: "后复权 hfq",
      adj: "股息/拆股复权 adj",
      split: "拆股复权 split",
      none: "不复权 none",
    };
    const previous = elements.adjust.value;
    elements.adjust.replaceChildren(
      ...values.map((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = labels[value] ?? value;
        return option;
      }),
    );
    if (values.includes(previous)) elements.adjust.value = previous;
  }

  function syncMarketFields() {
    const market = elements.market.value === "us" ? "us" : "cn";
    const previous = sourcePreferences[market] ?? elements.source.value;
    const sources = historyDataSourcesForMarket(market).filter((source) => !source.credentialEnv);
    elements.source.replaceChildren(
      ...[
        { id: AUTO_DATA_SOURCE_ID, label: "自动选择 · 失败时按可用源降级" },
        ...sources.map((source) => ({
          id: source.id,
          label: `${source.label} · 免配置`,
        })),
      ].map(({ id, label }) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = label;
        return option;
      }),
    );
    if (previous === AUTO_DATA_SOURCE_ID || sources.some((source) => source.id === previous)) {
      elements.source.value = previous;
    }
    syncAdjustmentFields();
    elements.symbol.placeholder = market === "cn" ? "贵州茅台或 600519" : "AAPL";
  }

  async function restoreSourcePreferences(epoch) {
    if (sourcePreferencesLoaded) return;
    sourcePreferencesLoaded = true;
    try {
      const saved = await hostCall("storage.get", { key: SOURCE_PREFERENCES_KEY });
      if (epoch !== currentEpoch()) return;
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        for (const market of ["cn", "us"]) {
          const candidate = String(saved[market] ?? AUTO_DATA_SOURCE_ID);
          if (
            candidate === AUTO_DATA_SOURCE_ID ||
            historyDataSourcesForMarket(market).some((source) => source.id === candidate)
          ) {
            sourcePreferences[market] = candidate;
          }
        }
      }
      syncMarketFields();
    } catch {
      // Preference recovery is optional and must never block the data library.
    }
  }

  function persistSourcePreference() {
    const market = elements.market.value === "us" ? "us" : "cn";
    sourcePreferences = { ...sourcePreferences, [market]: elements.source.value };
    void hostCall("storage.set", {
      key: SOURCE_PREFERENCES_KEY,
      value: sourcePreferences,
    }).catch(() => undefined);
  }

  function latestKnownProjectDate() {
    return [
      historySummary?.networkCheckedThrough,
      historySummary?.confirmedThrough,
      historySummary?.snapshotBackfillThrough,
      historySummary?.marketDate,
    ].filter((value) => isoDate(String(value ?? ""))).sort().at(-1) ?? null;
  }

  function render() {
    elements.count.textContent = `${datasets.length} 份单股回测数据`;
    elements.list.replaceChildren();
    if (datasets.length === 0) {
      elements.list.append(
        textElement(
          "p",
          skippedDatasets
            ? `没有可安全载入的数据集；已忽略 ${skippedDatasets} 份格式或来源不一致的记录。`
            : "当前项目还没有单股导出数据。如果只做日常选股，可以忽略此项。",
          "history-dataset-empty",
        ),
      );
      return;
    }
    if (skippedDatasets) {
      elements.list.append(
        textElement(
          "p",
          `已忽略 ${skippedDatasets} 份格式或来源不一致的记录。`,
          "history-dataset-warning",
        ),
      );
    }
    const sourceLabels = new Map(HISTORY_DATA_SOURCES.map((source) => [source.id, source.label]));
    const adjustmentLabels = {
      qfq: "前复权 · qfq",
      hfq: "后复权 · hfq",
      adj: "拆股/股息复权 · adj",
      split: "拆股复权 · split",
      none: "不复权 · none",
    };
    const latestKnownCnDate = latestKnownProjectDate();
    for (const dataset of datasets) {
      const card = document.createElement("article");
      card.className = "history-dataset-card";
      card.dataset.symbol = dataset.symbol;
      const checkedThrough = dataset.networkCheckedThrough ?? dataset.to;
      const behindLatestClose = dataset.market === "cn" && latestKnownCnDate && (
        !dataset.networkCheckedThrough || dataset.networkCheckedThrough < latestKnownCnDate
      );
      const automaticSyncing = projectFillSymbols.get(dataset.symbol) === currentEpoch();
      card.dataset.freshness = automaticSyncing ? "syncing" : behindLatestClose ? "stale" : "snapshot";
      card.setAttribute("aria-busy", automaticSyncing ? "true" : "false");

      const heading = document.createElement("header");
      const identity = document.createElement("div");
      identity.className = "history-dataset-identity";
      identity.append(
        textElement("b", dataset.name ?? dataset.symbol),
        textElement("span", dataset.name ? dataset.symbol : dataset.csvPath),
      );
      const badges = document.createElement("div");
      badges.className = "history-dataset-badges";
      badges.append(
        textElement("em", adjustmentLabels[dataset.adjust] ?? dataset.adjust),
        textElement(
          "strong",
          automaticSyncing
            ? `自动补齐中 · 至 ${latestKnownCnDate.slice(5).replace("-", "/")}`
            : behindLatestClose
            ? `待自动核对至 ${latestKnownCnDate.slice(5).replace("-", "/")}`
            : dataset.market === "cn" && latestKnownCnDate
              ? `已核对至 ${checkedThrough.slice(5).replace("-", "/")}`
              : "项目快照",
          "history-dataset-freshness",
        ),
      );
      heading.append(identity, badges);

      const facts = document.createElement("dl");
      const fact = (label, value) => {
        const row = document.createElement("div");
        row.append(textElement("dt", label), textElement("dd", value));
        return row;
      };
      facts.append(
        fact("区间", `${dataset.from} → ${dataset.to}`),
        ...(dataset.market === "cn" && dataset.networkCheckedThrough && checkedThrough !== dataset.to
          ? [fact("网络核对", `${checkedThrough} · 最新 K 线 ${dataset.to}`)]
          : []),
        fact("K 线", `${dataset.bars.toLocaleString()} 根`),
        fact("来源", sourceLabels.get(dataset.source) ?? dataset.source),
        fact("最近同步", new Intl.DateTimeFormat("zh-CN", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(dataset.syncedAt))),
      );

      const footer = document.createElement("footer");
      const loadButton = textElement("button", "载入回测");
      loadButton.type = "button";
      loadButton.dataset.historyLoad = dataset.csvPath;
      const updateButton = textElement(
        "button",
        behindLatestClose
          ? `立即更新到 ${latestKnownCnDate.slice(5).replace("-", "/")}`
          : dataset.market === "cn" ? "重新核验最新日" : "更新到今日",
      );
      updateButton.type = "button";
      updateButton.dataset.historyUpdate = dataset.symbol;
      updateButton.disabled = automaticSyncing;
      footer.append(loadButton, updateButton);

      card.append(heading, facts, footer);
      elements.list.append(card);
    }
  }

  async function load() {
    if (loading) return;
    const epoch = currentEpoch();
    let autofillTarget = null;
    loading = true;
    elements.refresh.disabled = true;
    try {
      await restoreSourcePreferences(epoch);
      await restoreHistorySummary();
      if (epoch !== currentEpoch()) return;
      // Panel storage can be scoped to the current conversation, while the
      // actual history library lives in the Panel App's shared local-data
      // directory. Always reconcile with that directory on load so a new
      // conversation does not mistake a missing UI cache for a missing
      // library. Status mode is read-only and never contacts a market source.
      await refreshHistorySummaryFromLocal();
      if (epoch !== currentEpoch()) return;
      if (
        historySummary &&
        ["close", "previous-close"].includes(historySummary.sessionPhase) &&
        historyAutofillNeeded(historySummary, historySummary.marketDate, now())
      ) {
        autofillTarget = Object.freeze({
          marketDate: historySummary.marketDate,
          sessionPhase: historySummary.sessionPhase,
        });
      }
      const directory = await hostCall("workspace.list", { path: DATA_DIRECTORY });
      if (epoch !== currentEpoch()) return;
      const entries = Array.isArray(directory?.entries) ? directory.entries : [];
      const csvPaths = new Set(
        entries
          .filter((entry) => entry?.kind === "file" && String(entry.path).endsWith(".csv"))
          .map((entry) => String(entry.path)),
      );
      const metaPaths = entries
        .filter((entry) => entry?.kind === "file" && String(entry.path).endsWith(META_SUFFIX))
        .map((entry) => String(entry.path))
        .sort();
      const next = [];
      let skipped = 0;
      for (const path of metaPaths) {
        try {
          const file = await hostCall("workspace.readText", { path });
          if (epoch !== currentEpoch()) return;
          let candidate;
          try {
            candidate = JSON.parse(file.content);
          } catch {
            skipped += 1;
            continue;
          }
          // data/market also contains portfolio-valuation sidecars. Those are
          // valid inputs for another module and must not be reported as broken
          // historical datasets.
          if (candidate?.format !== "codeshell.quant-dataset") continue;
          next.push(parseHistoryDatasetMeta(file.content, path, csvPaths));
        } catch {
          skipped += 1;
        }
      }
      skippedDatasets = skipped;
      datasets = next.sort((left, right) =>
        `${left.market}:${left.symbol}`.localeCompare(`${right.market}:${right.symbol}`),
      );
      render();
    } catch (error) {
      if (epoch !== currentEpoch()) return;
      datasets = [];
      skippedDatasets = 0;
      render();
      setState(error instanceof Error ? error.message : "历史数据目录读取失败", "error");
    } finally {
      if (epoch === currentEpoch()) {
        loading = false;
        elements.refresh.disabled = false;
        // History maintenance must not depend on the user leaving the app on
        // the Today tab. A saved Research/Watch tab still starts the same
        // reviewed local incremental runner after status reconciliation.
        void (async () => {
          if (autofillTarget) {
            await autoFillThrough(autofillTarget.marketDate, autofillTarget.sessionPhase);
          }
          await autoFillProjectDatasets(latestKnownProjectDate());
        })();
      }
    }
  }

  async function existingDatasetFiles(request) {
    const listing = await hostCall("workspace.list", { path: DATA_DIRECTORY });
    const entries = Array.isArray(listing?.entries) ? listing.entries : [];
    const metaPath = request.csvPath.replace(/\.csv$/u, META_SUFFIX);
    const csvEntry = entries.find((entry) => entry?.kind === "file" && entry.path === request.csvPath) ?? null;
    const metaEntry = entries.find((entry) => entry?.kind === "file" && entry.path === metaPath) ?? null;
    if (Boolean(csvEntry) !== Boolean(metaEntry)) {
      throw new Error("现有单股数据不完整；请先检查 CSV 与元数据文件，再重新导出");
    }
    if (!csvEntry) return { csv: null, meta: null, parsed: null };
    const [csv, meta] = await Promise.all([
      hostCall("workspace.readText", { path: request.csvPath }),
      hostCall("workspace.readText", { path: metaPath }),
    ]);
    const parsed = parseHistoryDatasetMeta(meta.content, metaPath, new Set([request.csvPath]));
    if (parsed.adjust !== request.adjust) {
      throw new Error(`${request.symbol} 已使用 ${parsed.adjust} 口径；为避免污染回测，不会覆盖为 ${request.adjust}`);
    }
    return { csv, meta, parsed };
  }

  async function writeVerifiedProjectFile(path, content, existing) {
    const written = await hostCall("workspace.writeText", {
      path,
      content,
      expectedModifiedAt: existing?.modifiedAt ?? null,
      ...(existing?.revision ? { expectedRevision: existing.revision } : {}),
    });
    const reread = await hostCall("workspace.readText", { path });
    if (reread?.content !== content) throw new Error(`${path} 写入后校验失败`);
    return written;
  }

  async function writeVerifiedProjectBundle(request, bundle, existing) {
    const metaPath = request.csvPath.replace(/\.csv$/u, META_SUFFIX);
    const writtenMeta = await writeVerifiedProjectFile(metaPath, bundle.metaText, existing.meta);
    try {
      await writeVerifiedProjectFile(request.csvPath, bundle.csv, existing.csv);
    } catch (error) {
      // Updating an existing pair is recoverable: if the CSV loses a revision
      // race after the sidecar was written, restore the prior sidecar with the
      // revision returned by our own write. This keeps the old CSV/meta pair
      // loadable and lets the next startup retry cleanly.
      if (existing.meta?.content) {
        try {
          await writeVerifiedProjectFile(metaPath, existing.meta.content, writtenMeta);
        } catch {
          throw new Error(`${request.symbol} CSV 写入失败，且元数据回滚失败；请检查项目文件冲突`);
        }
      }
      throw error;
    }
  }

  async function submit(requestInput, behavior = {}) {
    const automaticProject = behavior.automaticProject === true;
    if (contextState().trusted !== true) {
      if (!automaticProject) setState("请先信任当前工作区，再导出单股回测数据", "error");
      return Object.freeze({ status: "skipped", reason: "workspace-untrusted" });
    }
    if (historyInitializing || historyStatusInFlight || singleSyncInFlight) {
      if (!automaticProject) setState("历史数据正在更新，请等待当前任务完成", "error");
      return Object.freeze({ status: "skipped", reason: "history-busy" });
    }
    let request;
    try {
      request = normalizeHistoryRequest(requestInput);
    } catch (error) {
      if (!automaticProject) setState(error instanceof Error ? error.message : "单股回测数据请求无效", "error");
      return Object.freeze({ status: "failed", reason: "request-invalid" });
    }
    const epoch = currentEpoch();
    const displayText = `导出独立回测数据：${request.symbol} · ${request.from} → ${request.to}`;
    if (automaticProject) projectFillSymbols.set(request.symbol, epoch);
    elements.submit.disabled = true;
    singleSyncInFlight = true;
    setState(
      automaticProject
        ? `正在自动补齐 ${request.symbol} 到 ${request.to}；直接下载，不启动 Agent。`
        : `正在直接下载：${displayText}`,
      "active",
    );
    render();
    let processId = null;
    try {
      const existing = await existingDatasetFiles(request);
      const effectiveRequest = request.source === AUTO_DATA_SOURCE_ID && existing.parsed
        ? { ...request, source: existing.parsed.source }
        : request;
      const runtime = await ensureHistoryRuntime();
      const started = await hostCall("process.spawn", {
        executableHandle: runtime.executableHandle,
        directoryHandle: runtime.directoryHandle,
        args: historyDataRuntimeArgs(runtime.name, effectiveRequest),
      });
      if (typeof started?.processId !== "string") throw new Error("单股回测数据程序未能启动");
      processId = started.processId;
      singleSyncProcessId = processId;
      const record = await waitForHistoryExit(processId);
      if (record.exit?.code !== 0) throw new Error(historyProcessError(record.stderr));
      const bundle = parseHistorySyncBundle(record.stdout, effectiveRequest);
      if (epoch !== currentEpoch()) return;
      await writeVerifiedProjectBundle(request, bundle, existing);
      if (epoch !== currentEpoch()) return;
      setState(
        automaticProject
          ? `${bundle.meta.name ?? bundle.meta.symbol} 已自动核对至 ${bundle.meta.networkCheckedThrough ?? bundle.meta.to}，共 ${bundle.meta.bars.toLocaleString("zh-CN")} 根日 K。`
          : `已直接更新 ${bundle.meta.bars.toLocaleString("zh-CN")} 根日 K，并载入独立回测。`,
        "active",
      );
      if (!automaticProject) notify(`${bundle.meta.name ?? bundle.meta.symbol} 单股回测数据已更新`);
      if (behavior.reloadAfter !== false) await load();
      if (epoch === currentEpoch() && behavior.loadDataset !== false) await onLoadDataset(request.csvPath);
      return Object.freeze({ status: "updated", meta: bundle.meta });
    } catch (error) {
      if (epoch !== currentEpoch()) return Object.freeze({ status: "skipped", reason: "workspace-changed" });
      const message = error instanceof Error ? error.message : "单股回测数据导出失败";
      setState(automaticProject ? `${request.symbol} 自动补齐失败：${message}` : message, "error");
      return Object.freeze({ status: "failed", reason: message });
    } finally {
      if (processId) historyProcessRecords.delete(processId);
      if (singleSyncProcessId === processId) singleSyncProcessId = null;
      singleSyncInFlight = false;
      if (automaticProject && projectFillSymbols.get(request.symbol) === epoch) {
        projectFillSymbols.delete(request.symbol);
      }
      if (epoch === currentEpoch()) {
        elements.submit.disabled = contextState().trusted !== true;
        render();
      }
    }
  }

  async function autoFillProjectDatasets(targetDate = latestKnownProjectDate()) {
    if (!isoDate(String(targetDate ?? "")) || contextState().trusted !== true) return null;
    if (automaticProjectFillInFlight) return automaticProjectFillInFlight;
    if (historyInitializing || historyStatusInFlight || singleSyncInFlight) return null;
    const stale = datasets.filter((dataset) =>
      dataset.market === "cn" &&
      (!dataset.networkCheckedThrough || dataset.networkCheckedThrough < targetDate) &&
      !automaticProjectFillAttempts.has(`${dataset.symbol}:${targetDate}`)
    );
    if (!stale.length) return null;
    const epoch = currentEpoch();
    const task = (async () => {
      let updated = 0;
      let failed = 0;
      for (const dataset of stale) {
        if (epoch !== currentEpoch()) break;
        const attemptKey = `${dataset.symbol}:${targetDate}`;
        automaticProjectFillAttempts.add(attemptKey);
        const outcome = await submit({
          market: dataset.market,
          source: dataset.source,
          symbol: dataset.symbol,
          adjust: dataset.adjust,
          from: dataset.from,
          to: targetDate,
        }, {
          automaticProject: true,
          reloadAfter: false,
          loadDataset: false,
        });
        if (outcome?.status === "updated") updated += 1;
        else if (outcome?.status === "failed") failed += 1;
      }
      if (epoch !== currentEpoch()) return null;
      if (updated > 0) await load();
      if (failed > 0) {
        setState(`项目回测数据自动补齐：完成 ${updated} 份，失败 ${failed} 份；下次打开会继续核对。`, "error");
        notify(`项目回测数据已补齐 ${updated} 份，${failed} 份待下次重试`, "error");
      } else if (updated > 0) {
        setState(`项目回测数据已自动补齐 ${updated} 份至 ${targetDate}；不经 Agent。`, "active");
        notify(`已自动补齐 ${updated} 份 A 股回测数据至 ${targetDate}`);
      }
      return Object.freeze({ targetDate, updated, failed });
    })();
    automaticProjectFillInFlight = task;
    try {
      return await task;
    } finally {
      if (automaticProjectFillInFlight === task) automaticProjectFillInFlight = null;
    }
  }

  elements.market.addEventListener("change", syncMarketFields);
  elements.source.addEventListener("change", () => {
    persistSourcePreference();
    syncAdjustmentFields();
  });
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    let symbol = elements.symbol.value;
    if (elements.market.value !== "us") {
      try {
        const resolved = resolveAShare(symbol);
        symbol = resolved.symbol;
        elements.symbol.value = `${resolved.name ?? ""} ${resolved.symbol}`.trim();
      } catch (error) {
        setState(error instanceof Error ? error.message : "股票名称无法解析", "error");
        return;
      }
    }
    void submit({
      market: elements.market.value,
      source: elements.source.value,
      symbol,
      adjust: elements.adjust.value,
      from: elements.from.value,
      to: elements.to.value,
    });
  });
  elements.refresh.addEventListener("click", () => void load());
  elements.bootstrapScope?.addEventListener("change", renderHistoryBootstrap);
  elements.bootstrapSource?.addEventListener("change", renderHistoryBootstrap);
  elements.bootstrapAction?.addEventListener("click", () => {
    if (historyStatusRecoveryFailed && !historySummary) {
      void refreshHistorySummaryFromLocal().then((summary) => {
        if (summary) void autoFillThrough(summary.marketDate, summary.sessionPhase);
      });
    } else void initializeHistoryLibrary();
  });
  elements.list.addEventListener("click", (event) => {
    const loadButton = event.target.closest("[data-history-load]");
    if (loadButton) {
      void onLoadDataset(loadButton.dataset.historyLoad);
      return;
    }
    const updateButton = event.target.closest("[data-history-update]");
    if (!updateButton) return;
    const dataset = datasets.find((item) => item.symbol === updateButton.dataset.historyUpdate);
    if (!dataset) return;
    void submit({
      market: dataset.market,
      source: dataset.source,
      symbol: dataset.symbol,
      adjust: dataset.adjust,
      from: dataset.from,
      to: dataset.market === "cn"
        ? latestKnownProjectDate() ?? now().toISOString().slice(0, 10)
        : now().toISOString().slice(0, 10),
    });
  });

  elements.to.value = now().toISOString().slice(0, 10);
  syncMarketFields();
  renderHistoryBootstrap();

  return {
    load,
    reset() {
      if (singleSyncProcessId) {
        const abandonedProcessId = singleSyncProcessId;
        void hostCall("process.cancel", { processId: abandonedProcessId }).catch(() => undefined);
        // Keep the pending record until process.exit arrives. Removing it here
        // would make the exit listener create a different record and strand
        // the original wait promise forever. The epoch guard below submit()
        // still prevents the cancelled result from writing into either repo.
        singleSyncProcessId = null;
      }
      singleSyncInFlight = false;
      automaticProjectFillInFlight = null;
      datasets = [];
      skippedDatasets = 0;
      automaticFillAttempts.clear();
      historyStatusRecoveryFailed = false;
      automaticProjectFillAttempts.clear();
      projectFillSymbols.clear();
      render();
      setState("工作区已切换，正在读取历史数据目录。");
    },
    setBusy(disabled) {
      elements.submit.disabled = Boolean(disabled) || singleSyncInFlight;
    },
    refreshHistorySummaryFromLocal,
    autoFillThrough,
    autoFillProjectDatasets,
    dispose() {
      clearHistoryCooldownTimer();
      clearHistoryBackgroundPollTimer();
      unsubscribeHistoryOutput?.();
      unsubscribeHistoryExit?.();
      if (historyProcessId) {
        void hostCall("process.cancel", { processId: historyProcessId }).catch(() => undefined);
      }
      if (singleSyncProcessId) {
        void hostCall("process.cancel", { processId: singleSyncProcessId }).catch(() => undefined);
      }
      historyProcessId = null;
      singleSyncProcessId = null;
    },
    get datasets() {
      return datasets;
    },
  };
}
