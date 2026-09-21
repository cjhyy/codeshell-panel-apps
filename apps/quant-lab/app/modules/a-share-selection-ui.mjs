import {
  aShareResolutionMessage,
  canonicalAShareSymbol,
  parseAShareStockDirectory,
  resolveAShareStock,
} from "./a-share-instruments.mjs";
import { chinaMarketClock, displayedAShareSessionPhase } from "./a-share-session.mjs";
import { parseMarketEnvironment } from "../market-environment.mjs";
import { parseSelectionResearchEvidence, renderSelectionResearchEvidence } from "./selection-evidence-ui.mjs";
import { SELECTION_SCAN_LIMITS } from "../selection-scan-contract.mjs";

const SNAPSHOT_SCHEMA_VERSION = 1;
const SNAPSHOT_KIND = "a-share-selection-snapshot";
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
const MAX_PROCESS_OUTPUT_CHARS = 4 * 1024 * 1024;
const PROCESS_TIMEOUT_MS = 150_000;
const REFRESH_MS = 30 * 60 * 1_000;
const STORAGE_VERSION = 2;
const CONTINUATION_DELAY_MS = 5_000;
const SOURCE_RETRY_MS = 15 * 60 * 1_000;
const SECTOR_PAGE_SIZE = 20;

const NODE_LAUNCHER = [
  'import { join } from "node:path";',
  'import { pathToFileURL } from "node:url";',
  'const home = process.env.HOME || process.env.USERPROFILE;',
  'if (!home) throw new Error("user-home-unavailable");',
  'const tool = join(home, ".code-shell", "panel-apps", "quant-lab", "app", "tools", "build-a-share-selection.mjs");',
  'const module = await import(pathToFileURL(tool).href);',
  'const [mode = "refresh-volatile", scope = "global", encodedWatch = "%7B%7D", dataSources = ""] = process.argv.slice(-4);',
  'const args = mode === "read-local" ? ["--stdout", "--read-local", "--cache-scope", scope] : ["refresh-local", "continue-local"].includes(mode) ? ["--stdout", "--persist-local", "--cache-scope", scope, "--watch", encodedWatch] : ["--stdout", "--watch", encodedWatch];',
  'if (dataSources) args.push("--data-sources", dataSources);',
  'if (["continue-local", "continue-volatile"].includes(mode)) args.push("--continue-scan");',
  'try { await module.runCli(args); } catch (error) { process.stderr.write(JSON.stringify({ ok: false, errorCode: error?.code ?? error?.cause?.code ?? "SELECTION_ERROR", message: error instanceof Error ? error.message : "selection snapshot failed" }) + "\\n"); process.exitCode = 1; }',
].join("\n");

const RUNTIME_SPECS = Object.freeze([
  Object.freeze({ name: "node", label: "Node.js" }),
  Object.freeze({ name: "nodejs", label: "Node.js" }),
  Object.freeze({ name: "bun", label: "Bun" }),
]);

export function selectionRuntimeArgs(name, encodedWatch, cacheScope = "global", mode = "refresh-volatile", dataSources = "") {
  if (!/^(?:global|[0-9a-f]{16})$/u.test(cacheScope)) throw new Error("选股本地缓存范围无效");
  if (!new Set(["refresh-volatile", "refresh-local", "continue-volatile", "continue-local", "read-local"]).has(mode)) {
    throw new Error("选股本地模式不受支持");
  }
  if (name === "node" || name === "nodejs") {
    return Object.freeze(["--input-type=module", "--eval", NODE_LAUNCHER, mode, cacheScope, encodedWatch, dataSources]);
  }
  if (name === "bun") return Object.freeze(["--eval", NODE_LAUNCHER, mode, cacheScope, encodedWatch, dataSources]);
  throw new Error("选股运行时不受支持");
}

function cleanText(value, maximum = 300) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, maximum)
    : "";
}

function finiteNumber(value, minimum, maximum, label, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`${label}无效`);
  return number;
}

function integer(value, minimum, maximum, label) {
  const number = finiteNumber(value, minimum, maximum, label);
  if (!Number.isInteger(number)) throw new Error(`${label}不是整数`);
  return number;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validInstant(value) {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function safeUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label}链接无效`);
  }
  const allowed = ["eastmoney.com", "sina.com.cn", "qq.com"].some(
    (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
  );
  if (url.protocol !== "https:" || !allowed || url.username || url.password) throw new Error(`${label}链接来源无效`);
  return url.toString();
}

function parseEvent(item, label) {
  const kind = ["news", "announcement"].includes(item?.kind) ? item.kind : null;
  const importance = ["context", "risk", "operating", "routine"].includes(item?.importance)
    ? item.importance
    : null;
  const id = cleanText(item?.id, 100);
  const title = cleanText(item?.title, 240);
  const publishedAt = cleanText(item?.publishedAt, 40);
  if (!kind || !importance || !id || !title || !validInstant(publishedAt)) throw new Error(`${label}事件无效`);
  return Object.freeze({
    id,
    kind,
    importance,
    label: cleanText(item?.label, 40) || (kind === "announcement" ? "公司公告" : "行业新闻"),
    title,
    publishedAt,
    url: safeUrl(item?.url, label),
  });
}

function parseEvents(value, maximum, label) {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label}事件列表无效`);
  const seen = new Set();
  return Object.freeze(value.map((item) => parseEvent(item, label)).filter((item) => {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) throw new Error(`${label}事件重复`);
    seen.add(key);
    return true;
  }));
}

function parseMetricsTextArray(value, maximum, label) {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label}结构无效`);
  return Object.freeze(value.map((item) => cleanText(item, 240)).filter(Boolean));
}

function waitingReasonCategory(value) {
  if (/量比|量能/u.test(value)) return "volume";
  if (/当日已涨|追高/u.test(value)) return "chase";
  if (/KDJ\s*J\s*值/u.test(value)) return "kdj";
  if (/最大成交量/u.test(value)) return "largest-volume";
  if (/公告/u.test(value)) return "announcement";
  if (/市盈率|市净率|估值/u.test(value)) return "valuation";
  return value;
}

export function waitingReasonLines(candidate) {
  const risks = Array.isArray(candidate?.risks) ? candidate.risks : [];
  const fallback = cleanText(candidate?.setup?.trigger, 240);
  const seen = new Set();
  const reasons = [];
  for (const value of [...risks, fallback]) {
    const reason = cleanText(value, 240);
    if (!reason) continue;
    const category = waitingReasonCategory(reason);
    if (seen.has(category)) continue;
    seen.add(category);
    reasons.push(reason);
    if (reasons.length === 3) break;
  }
  return Object.freeze(reasons);
}

function parsePatternEvidence(value, label) {
  if (value == null) {
    return Object.freeze({
      version: 1,
      available: false,
      score: null,
      status: "unavailable",
      label: "旧快照未计算形态证据",
      position: "等待刷新",
      jValue: null,
      volumeRatio20: null,
      maxDrawdown25: null,
      keyCandleDate: "",
      components: Object.freeze([]),
      risks: Object.freeze([]),
      disclosure: "形态观察分不是上涨概率。",
    });
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1) {
    throw new Error(`${label}形态证据无效`);
  }
  const available = value.available === true;
  const status = ["ready", "watch", "repair", "weak", "risk", "unavailable"].includes(value.status)
    ? value.status
    : null;
  if (!status || (available && status === "unavailable") || (!available && status !== "unavailable")) {
    throw new Error(`${label}形态状态无效`);
  }
  const components = Array.isArray(value.components) ? value.components : [];
  if (components.length > 4 || (available && components.length !== 4)) throw new Error(`${label}形态分项无效`);
  const componentIds = new Set();
  const parsedComponents = components.map((item) => {
    const id = cleanText(item?.id, 20);
    if (!new Set(["trend", "kdj", "volume", "shape"]).has(id) || componentIds.has(id)) {
      throw new Error(`${label}形态分项重复或无效`);
    }
    componentIds.add(id);
    return Object.freeze({
      id,
      label: cleanText(item?.label, 30),
      score: finiteNumber(item?.score, 0, 100, `${label}${id}形态分`),
      summary: cleanText(item?.summary, 240),
    });
  });
  return Object.freeze({
    version: 1,
    available,
    score: finiteNumber(value.score, 0, 100, `${label}形态观察分`, { nullable: true }),
    status,
    label: cleanText(value.label, 50),
    position: cleanText(value.position, 50),
    jValue: finiteNumber(value.jValue, -1_000, 1_000, `${label}J值`, { nullable: true }),
    volumeRatio20: finiteNumber(value.volumeRatio20, 0, 10_000, `${label}20日量比`, { nullable: true }),
    maxDrawdown25: finiteNumber(value.maxDrawdown25, 0, 100, `${label}25日回撤`, { nullable: true }),
    keyCandleDate: value.keyCandleDate === "" || validDate(value.keyCandleDate) ? value.keyCandleDate : "",
    components: Object.freeze(parsedComponents),
    risks: parseMetricsTextArray(value.risks ?? [], 3, `${label}形态风险`),
    disclosure: cleanText(value.disclosure, 240) || "形态观察分不是上涨概率。",
  });
}

function parseSetup(value, name, state) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const status = ["confirmed", "waiting", "blocked", "intraday"].includes(source.status)
    ? source.status
    : state === "opportunity"
      ? "confirmed"
      : state === "waiting"
        ? "waiting"
        : "blocked";
  const fallbackLabel = state === "opportunity" ? "趋势条件" : state === "waiting" ? "等待条件" : "趋势修复";
  return Object.freeze({
    id: /^[a-z][a-z0-9-]{1,40}$/u.test(cleanText(source.id, 42)) ? cleanText(source.id, 42) : "legacy-trend",
    label: cleanText(source.label, 40) || fallbackLabel,
    status,
    trigger: cleanText(source.trigger, 300) || "按趋势、位置、量能与追高条件重新核验",
  });
}

function unavailableDeviation() {
  return Object.freeze({
    available: false,
    benchmarkSymbol: "",
    benchmarkName: "",
    state: "unavailable",
    label: "待补齐",
    leadingWindowDays: null,
    windows: Object.freeze([]),
    reason: "基准指数日线待补齐",
    disclosure: "近似口径不等于交易所认定。",
  });
}

function parseAbnormalDeviation(value, label) {
  if (value == null) return unavailableDeviation();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}异动偏离无效`);
  const benchmarkSymbol = cleanText(value.benchmarkSymbol, 16);
  const benchmarkName = cleanText(value.benchmarkName, 30);
  if (!["SH000001", "SZ399001", "SZ399006"].includes(benchmarkSymbol) || !benchmarkName) {
    throw new Error(`${label}异动基准无效`);
  }
  const available = value.available === true;
  const state = ["triggered", "edge", "watch", "normal", "unavailable"].includes(value.state) ? value.state : null;
  if (!state || available === (state === "unavailable")) throw new Error(`${label}异动状态无效`);
  const windows = Array.isArray(value.windows) ? value.windows.map((item) => {
    const days = integer(item?.days, 3, 30, `${label}异动窗口`);
    if (![3, 10, 30].includes(days) || !validDate(item?.from) || !validDate(item?.through) || item.from >= item.through) {
      throw new Error(`${label}异动窗口无效`);
    }
    const rowState = ["triggered", "edge", "watch", "normal"].includes(item?.state) ? item.state : null;
    if (!rowState || !["up", "down"].includes(item?.direction)) throw new Error(`${label}异动窗口状态无效`);
    return Object.freeze({
      days,
      from: item.from,
      through: item.through,
      stockReturn: finiteNumber(item.stockReturn, -100, 100_000, `${label}个股累计涨跌`),
      benchmarkReturn: finiteNumber(item.benchmarkReturn, -100, 100_000, `${label}基准累计涨跌`),
      deviation: finiteNumber(item.deviation, -100_000, 100_000, `${label}累计偏离`),
      threshold: finiteNumber(item.threshold, 1, 1_000, `${label}异动阈值`),
      closeness: finiteNumber(item.closeness, 0, 100_000, `${label}异动接近度`),
      direction: item.direction,
      state: rowState,
    });
  }) : [];
  if (available && (windows.length !== 3 || new Set(windows.map((item) => item.days)).size !== 3)) {
    throw new Error(`${label}异动窗口不完整`);
  }
  if (!available && windows.length) throw new Error(`${label}异动未就绪时不应有窗口`);
  const leadingWindowDays = available && [3, 10, 30].includes(value.leadingWindowDays) ? value.leadingWindowDays : null;
  if (available && !leadingWindowDays) throw new Error(`${label}异动主窗口无效`);
  return Object.freeze({
    available,
    benchmarkSymbol,
    benchmarkName,
    state,
    label: cleanText(value.label, 30),
    leadingWindowDays,
    windows: Object.freeze(windows),
    reason: cleanText(value.reason, 160),
    disclosure: cleanText(value.disclosure, 240),
  });
}

function deviationDisplay(value) {
  if (!value?.available) return "偏离 —";
  const leading = value.windows.find((item) => item.days === value.leadingWindowDays) ?? value.windows[0];
  return `${leading.days}日 ${formatPercent(leading.deviation)} · ${value.label}`;
}

function parseCandidate(item, sector) {
  const symbol = cleanText(item?.symbol, 16);
  const name = cleanText(item?.name, 40);
  const state = ["opportunity", "waiting", "risk", "unavailable"].includes(item?.state) ? item.state : null;
  if (!/^(?:SH|SZ)\d{6}$/u.test(symbol) || !name || !state) throw new Error("候选个股结构无效");
  const metrics = item?.metrics;
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) throw new Error(`${name}指标无效`);
  return Object.freeze({
    symbol,
    name,
    sectorId: sector.id,
    sectorName: sector.name,
    rank: integer(item?.rank, 1, SELECTION_SCAN_LIMITS.membersPerSector, `${name}排名`),
    relativeScore: finiteNumber(item?.relativeScore, 0, 100, `${name}相对分`),
    state,
    stateLabel: cleanText(item?.stateLabel, 30),
    setup: parseSetup(item?.setup, name, state),
    price: finiteNumber(item?.price, 0.01, 1_000_000, `${name}价格`),
    changePercent: finiteNumber(item?.changePercent, -30, 30, `${name}涨跌幅`),
    amount: finiteNumber(item?.amount, 0, 1e17, `${name}成交额`),
    turnover: finiteNumber(item?.turnover, 0, 1_000, `${name}换手率`),
    pe: finiteNumber(item?.pe, -1e6, 1e6, `${name}市盈率`, { nullable: true }),
    pb: finiteNumber(item?.pb, -1e6, 1e6, `${name}市净率`, { nullable: true }),
    lastBarDate: validDate(item?.lastBarDate) ? item.lastBarDate : "",
    metrics: Object.freeze({
      ma20: finiteNumber(metrics.ma20, 0.01, 1_000_000, `${name} MA20`),
      ma60: finiteNumber(metrics.ma60, 0.01, 1_000_000, `${name} MA60`),
      return20: finiteNumber(metrics.return20, -100, 10_000, `${name} 20日收益`),
      return60: finiteNumber(metrics.return60, -100, 10_000, `${name} 60日收益`),
      volumeRatio: finiteNumber(metrics.volumeRatio, 0, 10_000, `${name}量比`),
      distanceHigh60: finiteNumber(metrics.distanceHigh60, -100, 100, `${name}高点距离`),
      extension20: finiteNumber(metrics.extension20, -100, 10_000, `${name}均线偏离`),
      distancePriorHigh20: finiteNumber(metrics.distancePriorHigh20, -100, 100, `${name}20日高点距离`, { nullable: true }),
      distancePriorHigh60: finiteNumber(metrics.distancePriorHigh60, -100, 100, `${name}60日高点距离`, { nullable: true }),
      range10: finiteNumber(metrics.range10, 0, 10_000, `${name}10日振幅`, { nullable: true }),
      recentLow5Distance20: finiteNumber(metrics.recentLow5Distance20, -100, 10_000, `${name}回踩距离`, { nullable: true }),
      volume3Ratio20: finiteNumber(metrics.volume3Ratio20, 0, 10_000, `${name}缩量比`, { nullable: true }),
    }),
    patternEvidence: parsePatternEvidence(item?.patternEvidence, name),
    abnormalDeviation: parseAbnormalDeviation(item?.abnormalDeviation, name),
    support: parseMetricsTextArray(item?.support, 4, `${name}支持证据`),
    risks: parseMetricsTextArray(item?.risks, 4, `${name}风险`),
    invalidation: cleanText(item?.invalidation, 240),
    events: parseEvents(item?.events, 4, name),
  });
}

function parseSectorScan(value, label) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !["pending", "partial", "complete", "failed"].includes(value.state)) throw new Error(`${label}扫描状态无效`);
  const memberCount = integer(value.memberCount, 0, SELECTION_SCAN_LIMITS.membersPerSector, `${label}扫描成分数`);
  const eligibleCount = integer(value.eligibleCount, 0, memberCount, `${label}可评估成分数`);
  const historyAvailable = integer(value.historyAvailable, 0, eligibleCount, `${label}已核对历史数`);
  const historyPending = integer(value.historyPending, 0, eligibleCount, `${label}待核对历史数`);
  const historyFailed = integer(value.historyFailed, 0, eligibleCount, `${label}失败历史数`);
  if (historyAvailable + historyPending + historyFailed !== eligibleCount ||
      (value.state === "complete" && (historyPending !== 0 || historyFailed !== 0)) ||
      (value.state === "pending" && (memberCount !== 0 || eligibleCount !== 0))) throw new Error(`${label}扫描计数冲突`);
  return Object.freeze({ state: value.state, memberCount, eligibleCount, historyAvailable, historyPending, historyFailed, reason: cleanText(value.reason, 300) });
}

export function parseSelectionScanProgress(value, sectors, generatedAt) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 ||
      value.scope !== "all-industries" || !["running", "complete", "partial"].includes(value.state) ||
      typeof value.hasMore !== "boolean" || !validInstant(value.updatedAt) ||
      Date.parse(value.updatedAt) > Date.parse(generatedAt) + 60_000) throw new Error("全行业扫描进度结构无效");
  const totalSectors = integer(value.totalSectors, 0, SELECTION_SCAN_LIMITS.sectors, "扫描行业总数");
  const completedSectors = integer(value.completedSectors, 0, totalSectors, "已完成行业数");
  const pendingSectors = integer(value.pendingSectors, 0, totalSectors, "未完成行业数");
  const failedSectors = integer(value.failedSectors, 0, totalSectors, "失败行业数");
  const nextRetryAt = value.nextRetryAt == null ? null : cleanText(value.nextRetryAt, 40);
  if (nextRetryAt != null && (!validInstant(nextRetryAt) || !value.hasMore)) throw new Error("扫描自动重试时点无效");
  let batch = null;
  if (value.batch != null) {
    if (!value.batch || typeof value.batch !== "object" || Array.isArray(value.batch) || value.batch.version !== 1) throw new Error("本批扫描计数无效");
    batch = { version: 1, ...Object.fromEntries(["memberRequests", "memberCompleted", "historyRequests", "historyAdded", "historyRejected", "announcementRequests", "announcementChecked"]
      .map((key) => [key, integer(value.batch[key] ?? (key.startsWith("announcement") ? 0 : NaN), 0,
        key.startsWith("member") ? 8 : key.startsWith("history") ? 24 : 20, "本批扫描计数")])) };
    if (batch.memberCompleted > batch.memberRequests || batch.historyAdded + batch.historyRejected > batch.historyRequests || batch.announcementChecked > batch.announcementRequests) throw new Error("本批扫描计数冲突");
    batch = Object.freeze(batch);
  }
  const hasAnnouncements = ["announcementRequested", "announcementAvailable", "announcementPending", "announcementFailed"].some((key) => value[key] != null);
  const announcements = hasAnnouncements ? Object.fromEntries(["announcementRequested", "announcementAvailable", "announcementPending", "announcementFailed"]
    .map((key) => [key, integer(value[key], 0, SELECTION_SCAN_LIMITS.stocks, "公告核验数")])) : {};
  if (hasAnnouncements && announcements.announcementAvailable + announcements.announcementPending + announcements.announcementFailed !== announcements.announcementRequested) {
    throw new Error("公告核验进度计数冲突");
  }
  const fullyComplete = completedSectors === totalSectors && !value.hasMore && !(announcements.announcementPending || announcements.announcementFailed);
  if (totalSectors !== sectors.length || completedSectors + pendingSectors + failedSectors !== totalSectors ||
      sectors.some((sector) => !sector.scan) ||
      completedSectors !== sectors.filter((sector) => sector.scan.state === "complete").length ||
      pendingSectors !== sectors.filter((sector) => ["pending", "partial"].includes(sector.scan.state)).length ||
      failedSectors !== sectors.filter((sector) => sector.scan.state === "failed").length ||
      (value.state === "complete" && !fullyComplete) ||
      (value.state === "running") !== value.hasMore) {
    throw new Error("全行业扫描进度与板块计数冲突");
  }
  return Object.freeze({ version: 1, scope: "all-industries", state: value.state, totalSectors, completedSectors, pendingSectors, failedSectors, hasMore: value.hasMore, nextRetryAt, batch, updatedAt: value.updatedAt, ...announcements });
}

function parseSelectionSummary(value, sectors) {
  if (value == null) return null;
  const states = ["data-unavailable", "scanning", "market-blocked", "ready", "no-confirmation"];
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 || !states.includes(value.state)) throw new Error("选股覆盖结论结构无效");
  const sectorCount = integer(value.sectorCount, 0, SELECTION_SCAN_LIMITS.sectors, "选股行业数");
  if (sectorCount !== sectors.length) throw new Error("选股结论行业数冲突");
  return Object.freeze({ version: 1, state: value.state, reason: cleanText(value.reason, 500), sectorCount,
    rankedSectors: integer(value.rankedSectors, 0, sectorCount, "已排名行业数"),
    partialSectors: integer(value.partialSectors, 0, sectorCount, "部分行业数"),
    analyzedStocks: integer(value.analyzedStocks, 0, SELECTION_SCAN_LIMITS.stocks, "已分析股票数"),
    observedStocks: integer(value.observedStocks, 0, SELECTION_SCAN_LIMITS.stocks, "可观察股票数"),
    confirmedStocks: integer(value.confirmedStocks, 0, SELECTION_SCAN_LIMITS.stocks, "通过确认股票数"),
  });
}

function parseSectorGateCounts(value, label) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}过滤统计无效`);
  return Object.freeze(Object.fromEntries(["analyzed", "historyUnavailable", "trendBlocked", "strategyWaiting", "technicalReady", "announcementPending", "announcementRisk", "sectorBlocked", "marketBlocked", "confirmed"]
    .map((key) => [key, integer(value[key], 0, SELECTION_SCAN_LIMITS.membersPerSector, `${label}${key}过滤数`)])));
}

function parseSector(item) {
  const id = cleanText(item?.id, 50);
  const name = cleanText(item?.name, 40);
  const stage = ["unavailable", "crowded", "retreat", "advancing", "expansion", "emerging", "repair"].includes(item?.stage)
    ? item.stage
    : null;
  if (!/^new_[A-Za-z0-9]+$/u.test(id) || !name || !stage) throw new Error("推荐板块结构无效");
  const metrics = item?.metrics;
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) throw new Error(`${name}板块指标无效`);
  const scan = parseSectorScan(item.scan, name);
  const rank = item.rank == null ? null : integer(item.rank, 1, SELECTION_SCAN_LIMITS.sectors, `${name}板块排名`);
  if (scan && ((scan.state === "complete") !== (rank !== null) || (scan.state !== "complete" && item.recommended === true))) {
    throw new Error(`${name}未完成扫描不能参与完整排名或推荐`);
  }
  const sector = {
    id,
    name,
    scan,
    rank,
    selectionReason: cleanText(item.selectionReason, 300),
    gateCounts: parseSectorGateCounts(item.gateCounts, name),
    watched: item?.watched === true,
    recommended: item?.recommended === true,
    recommendationLabel: cleanText(item?.recommendationLabel, 30),
    stage,
    stageLabel: cleanText(item?.stageLabel, 30),
    relativeScore: finiteNumber(item?.relativeScore, 0, 100, `${name}相对分`),
    metrics: Object.freeze({
      sampleSize: integer(metrics.sampleSize, 0, SELECTION_SCAN_LIMITS.membersPerSector, `${name}样本量`),
      constituentCount: scan && scan.state !== "complete" && metrics.constituentCount == null ? null : integer(metrics.constituentCount, 1, SELECTION_SCAN_LIMITS.membersPerSector, `${name}成分数`),
      memberCoverage: finiteNumber(metrics.memberCoverage, 0, 1, `${name}成分覆盖`, { nullable: true }),
      changePercent: finiteNumber(metrics.changePercent, -30, 30, `${name}涨跌幅`, { nullable: Boolean(scan && scan.state !== "complete") }),
      amount: finiteNumber(metrics.amount, 0, 1e18, `${name}成交额`, { nullable: Boolean(scan && scan.state !== "complete") }),
      return20Median: finiteNumber(metrics.return20Median, -100, 10_000, `${name}20日收益`, { nullable: true }),
      return60Median: finiteNumber(metrics.return60Median, -100, 10_000, `${name}60日收益`, { nullable: true }),
      extension20Median: finiteNumber(metrics.extension20Median, -100, 10_000, `${name}偏离`, { nullable: true }),
      above20Ratio: finiteNumber(metrics.above20Ratio, 0, 1, `${name}宽度`, { nullable: true }),
      trendRatio: finiteNumber(metrics.trendRatio, 0, 1, `${name}趋势覆盖`, { nullable: true }),
      limitUpCount: metrics.limitUpCount == null ? 0 : integer(metrics.limitUpCount, 0, SELECTION_SCAN_LIMITS.membersPerSector, `${name}样本涨停数`),
      firstBoardCount: metrics.firstBoardCount == null ? 0 : integer(metrics.firstBoardCount, 0, SELECTION_SCAN_LIMITS.membersPerSector, `${name}样本首板数`),
      ge2Count: metrics.ge2Count == null ? 0 : integer(metrics.ge2Count, 0, SELECTION_SCAN_LIMITS.membersPerSector, `${name}样本二板数`),
      maxBoards: metrics.maxBoards == null ? 0 : integer(metrics.maxBoards, 0, 100, `${name}样本最高板`),
      rungsFilled: metrics.rungsFilled == null ? 0 : integer(metrics.rungsFilled, 0, 100, `${name}样本梯队档数`),
      ladderCompleteness: metrics.ladderCompleteness == null
        ? 0
        : finiteNumber(metrics.ladderCompleteness, 0, 1, `${name}样本梯队完整度`),
      promotionPool: metrics.promotionPool == null ? 0 : integer(metrics.promotionPool, 0, SELECTION_SCAN_LIMITS.membersPerSector, `${name}样本晋级池`),
      promotionRate: finiteNumber(metrics.promotionRate, 0, 1, `${name}样本晋级率`, { nullable: true }),
      sealRate: finiteNumber(metrics.sealRate, 0, 1, `${name}样本封板率`, { nullable: true }),
    }),
    catalysts: parseEvents(item?.catalysts, 3, name),
    evidence: parseMetricsTextArray(item?.evidence, 4, `${name}证据`),
    risks: parseMetricsTextArray(item?.risks, 4, `${name}风险`),
    representatives: [],
    timingQueue: [],
    candidates: [],
    poolCounts: null,
  };
  if (!Array.isArray(item?.candidates) || item.candidates.length > 2) throw new Error(`${name}候选列表无效`);
  const legacyCandidates = item.candidates.map((candidate) => parseCandidate(candidate, sector));
  const layered = Array.isArray(item?.representatives) || Array.isArray(item?.timingQueue);
  if (layered) {
    if (!Array.isArray(item?.representatives) || item.representatives.length > 3) {
      throw new Error(`${name}代表股列表无效`);
    }
    if (!Array.isArray(item?.timingQueue) || item.timingQueue.length > 3) {
      throw new Error(`${name}等待时机列表无效`);
    }
    sector.representatives = Object.freeze(item.representatives.map((candidate) => parseCandidate(candidate, sector)));
    sector.timingQueue = Object.freeze(item.timingQueue.map((candidate) => parseCandidate(candidate, sector)));
    sector.candidates = Object.freeze(legacyCandidates);
    if (sector.candidates.some((candidate) => candidate.state !== "opportunity")) {
      throw new Error(`${name}时机确认列表包含未确认个股`);
    }
  } else {
    sector.representatives = Object.freeze(legacyCandidates.slice(0, 3));
    sector.timingQueue = Object.freeze(legacyCandidates.filter((candidate) => candidate.state === "waiting").slice(0, 3));
    sector.candidates = Object.freeze(legacyCandidates.filter((candidate) => candidate.state === "opportunity"));
  }
  const counts = item?.poolCounts && typeof item.poolCounts === "object" && !Array.isArray(item.poolCounts)
    ? item.poolCounts
    : {
      representatives: sector.representatives.length,
      waiting: sector.timingQueue.length,
      confirmed: sector.candidates.length,
      excluded: 0,
    };
  sector.poolCounts = Object.freeze({
    representatives: integer(counts.representatives, 0, SELECTION_SCAN_LIMITS.membersPerSector, `${name}代表股数量`),
    waiting: integer(counts.waiting, 0, SELECTION_SCAN_LIMITS.membersPerSector, `${name}等待数量`),
    confirmed: integer(counts.confirmed, 0, SELECTION_SCAN_LIMITS.membersPerSector, `${name}确认数量`),
    excluded: integer(counts.excluded, 0, SELECTION_SCAN_LIMITS.membersPerSector, `${name}排除数量`),
  });
  if (scan && scan.state !== "complete" && sector.candidates.length) throw new Error(`${name}未完成扫描不能生成确认候选`);
  return Object.freeze(sector);
}

function emptyTechnologyHotspots(generatedAt) {
  return Object.freeze({
    windowHours: 48,
    generatedAt,
    topicCount: 0,
    topics: Object.freeze([]),
    disclaimer: "热点来自公开资讯关键词；行业关联不代表公司真实受益或买入建议。",
  });
}

function parseTechnologyHotspots(value, sectors, snapshotGeneratedAt) {
  if (value == null) return emptyTechnologyHotspots(snapshotGeneratedAt);
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.topics) || value.topics.length > 4) {
    throw new Error("科技热点结构无效");
  }
  const generatedAt = cleanText(value.generatedAt, 40);
  if (!validInstant(generatedAt) || generatedAt !== snapshotGeneratedAt) throw new Error("科技热点时点无效");
  const sectorMap = new Map(sectors.map((sector) => [sector.id, sector]));
  const topicIds = new Set();
  const topics = value.topics.map((item) => {
    const id = cleanText(item?.id, 50);
    const label = cleanText(item?.label, 50);
    if (!/^[a-z][a-z0-9-]{1,48}$/u.test(id) || !label || topicIds.has(id)) throw new Error("科技热点主题无效或重复");
    topicIds.add(id);
    const news = parseEvents(item?.news, 3, `${label}热点`);
    if (news.some((event) => event.kind !== "news")) throw new Error(`${label}热点资讯类型无效`);
    const keywords = parseMetricsTextArray(item?.keywords, 6, `${label}关键词`);
    if (!keywords.length || !news.length) throw new Error(`${label}热点证据不足`);
    if (!Array.isArray(item?.sectors) || item.sectors.length > 3) throw new Error(`${label}关联行业无效`);
    const sectorIds = new Set();
    const matchedSectors = item.sectors.map((sectorItem) => {
      const sector = sectorMap.get(cleanText(sectorItem?.id, 50));
      if (!sector || sector.name !== cleanText(sectorItem?.name, 40) || sectorIds.has(sector.id)) {
        throw new Error(`${label}关联行业不存在或重复`);
      }
      sectorIds.add(sector.id);
      return Object.freeze({
        id: sector.id,
        name: sector.name,
        stage: sector.stage,
        stageLabel: sector.stageLabel,
        changePercent: sector.metrics.changePercent,
        return20Median: sector.metrics.return20Median,
        matchBasis: cleanText(sectorItem?.matchBasis, 160),
      });
    });
    if (!Array.isArray(item?.stocks) || item.stocks.length > 5) throw new Error(`${label}匹配股票无效`);
    const stockSymbols = new Set();
    const stocks = item.stocks.map((stockItem) => {
      const symbol = cleanText(stockItem?.symbol, 16);
      const sector = sectorMap.get(cleanText(stockItem?.sectorId, 50));
      const candidates = sector ? [...sector.representatives, ...sector.candidates, ...sector.timingQueue] : [];
      const candidate = candidates.find((row) => row.symbol === symbol);
      if (!candidate || !sectorIds.has(sector.id) || stockSymbols.has(symbol)) throw new Error(`${label}匹配股票不存在或重复`);
      stockSymbols.add(symbol);
      return Object.freeze({
        symbol: candidate.symbol,
        name: candidate.name,
        sectorId: sector.id,
        sectorName: sector.name,
        state: candidate.state,
        stateLabel: candidate.stateLabel,
        price: candidate.price,
        changePercent: candidate.changePercent,
        relativeScore: candidate.relativeScore,
        metrics: Object.freeze({
          return20: candidate.metrics.return20,
          return60: candidate.metrics.return60,
          extension20: candidate.metrics.extension20,
          volumeRatio: candidate.metrics.volumeRatio,
        }),
        matchBasis: cleanText(stockItem?.matchBasis, 200),
      });
    });
    const latestAt = cleanText(item?.latestAt, 40);
    const newestNewsAt = Math.max(...news.map((event) => Date.parse(event.publishedAt)));
    if (!validInstant(latestAt) || Date.parse(latestAt) !== newestNewsAt) throw new Error(`${label}热点最新时点冲突`);
    return Object.freeze({
      id,
      label,
      heatScore: finiteNumber(item?.heatScore, 0, 100, `${label}线索强度`),
      newsCount: integer(item?.newsCount, news.length, 1_000, `${label}资讯数量`),
      latestAt,
      keywords,
      news,
      sectors: Object.freeze(matchedSectors),
      stocks: Object.freeze(stocks),
    });
  });
  if (integer(value.topicCount, 0, 4, "科技热点数量") !== topics.length) throw new Error("科技热点数量冲突");
  return Object.freeze({
    windowHours: integer(value.windowHours, 1, 168, "科技热点窗口"),
    generatedAt,
    topicCount: topics.length,
    topics: Object.freeze(topics),
    disclaimer: cleanText(value.disclaimer, 300) || "行业关联不代表公司真实受益或买入建议。",
  });
}

function parseWatchStock(item) {
  const symbol = cleanText(item?.symbol, 16);
  const name = cleanText(item?.name, 40);
  const state = ["opportunity", "waiting", "risk", "unavailable"].includes(item?.state) ? item.state : null;
  if (!/^(?:SH|SZ)\d{6}$/u.test(symbol) || !name || !state) throw new Error("关注个股结构无效");
  const metrics = item?.metrics && typeof item.metrics === "object" && !Array.isArray(item.metrics)
    ? Object.freeze({
      ma20: finiteNumber(item.metrics.ma20, 0.01, 1_000_000, `${name} MA20`),
      ma60: finiteNumber(item.metrics.ma60, 0.01, 1_000_000, `${name} MA60`),
      return20: finiteNumber(item.metrics.return20, -100, 10_000, `${name}20日收益`),
      return60: finiteNumber(item.metrics.return60, -100, 10_000, `${name}60日收益`),
      volumeRatio: finiteNumber(item.metrics.volumeRatio, 0, 10_000, `${name}量比`),
    })
    : null;
  return Object.freeze({
    symbol,
    name,
    state,
    stateLabel: cleanText(item?.stateLabel, 30),
    reason: cleanText(item?.reason, 300),
    price: finiteNumber(item?.price, 0.01, 1_000_000, `${name}价格`, { nullable: true }),
    changePercent: finiteNumber(item?.changePercent, -30, 30, `${name}涨跌幅`, { nullable: true }),
    metrics,
    patternEvidence: parsePatternEvidence(item?.patternEvidence, name),
    abnormalDeviation: parseAbnormalDeviation(item?.abnormalDeviation, name),
    invalidation: cleanText(item?.invalidation, 240),
    events: parseEvents(item?.events, 4, name),
  });
}

function parseStrategyOutcome(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}回测结构无效`);
  return Object.freeze({
    evaluated: integer(value.evaluated, 0, 100_000, `${label}有效样本`),
    unfilled: integer(value.unfilled, 0, 100_000, `${label}未成交样本`),
    medianNetReturn: finiteNumber(value.medianNetReturn, -100, 100_000, `${label}收益中位数`, { nullable: true }),
    positiveRate: finiteNumber(value.positiveRate, 0, 1, `${label}正收益比例`, { nullable: true }),
    medianMaxAdverse: finiteNumber(value.medianMaxAdverse, -100, 0, `${label}不利波动`, { nullable: true }),
  });
}

function parseStrategyLab(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze({ version: 2, assumptions: Object.freeze({ note: "暂无历史校准" }), evidenceSummary: Object.freeze({ candidate: 0, watch: 0, caution: 0, accumulating: 0 }), strategies: Object.freeze([]), disclosure: "暂无历史校准" });
  }
  if (![1, 2].includes(value.version) || !Array.isArray(value.strategies) || value.strategies.length > 30) {
    throw new Error("策略校准结构无效");
  }
  const assumptions = value.assumptions && typeof value.assumptions === "object" && !Array.isArray(value.assumptions)
    ? Object.freeze({
      version: cleanText(value.assumptions.version, 20),
      signalAt: cleanText(value.assumptions.signalAt, 30),
      entryAt: cleanText(value.assumptions.entryAt, 30),
      buyCommissionRate: finiteNumber(value.assumptions.buyCommissionRate, 0, 0.1, "买入佣金"),
      sellCommissionRate: finiteNumber(value.assumptions.sellCommissionRate, 0, 0.1, "卖出佣金"),
      stampDutyRate: finiteNumber(value.assumptions.stampDutyRate, 0, 0.1, "印花税"),
      slippageRate: finiteNumber(value.assumptions.slippageRate, 0, 0.1, "滑点"),
      maximumExitDelayBars: integer(value.assumptions.maximumExitDelayBars, 0, 20, "跌停顺延"),
      note: cleanText(value.assumptions.note, 300),
    })
    : Object.freeze({ note: "交易约束不可用" });
  const ids = new Set();
  const strategies = value.strategies.map((item) => {
    const id = cleanText(item?.id, 50);
    if (!/^[a-z][a-z0-9-]{1,40}$/u.test(id) || ids.has(id)) throw new Error("策略标识无效或重复");
    ids.add(id);
    const category = ["trend", "breakout", "reversal", "volume", "limit", "pullback", "etf"].includes(item?.category)
      ? item.category
      : "trend";
    const assetTypes = Array.isArray(item?.assetTypes) ? item.assetTypes : ["stock"];
    const marketStates = Array.isArray(item?.marketStates) ? item.marketStates : [];
    const phaseStates = Array.isArray(item?.phaseStates) ? item.phaseStates : [];
    if (
      assetTypes.length > 2 || assetTypes.some((entry) => !["stock", "etf"].includes(entry)) ||
      marketStates.length > 5 || marketStates.some((entry) => !["strong", "lean_strong", "range", "lean_weak", "weak"].includes(entry)) ||
      phaseStates.length > 6 || phaseStates.some((entry) => !["ice", "ignite", "rally", "climax", "ebb", "repair"].includes(entry))
    ) throw new Error(`${id}适用环境无效`);
    const t5 = parseStrategyOutcome(item?.t5, `${id} T+5`);
    const t20 = parseStrategyOutcome(item?.t20, `${id} T+20`);
    const evidenceState = ["candidate", "watch", "caution", "accumulating"].includes(item?.evidence?.state)
      ? item.evidence.state
      : "accumulating";
    const fallbackEvidenceLabel = value.version === 1 ? "旧快照待刷新" : "积累样本";
    return Object.freeze({
      id,
      label: cleanText(item?.label, 40),
      description: cleanText(item?.description, 300),
      category,
      categoryLabel: cleanText(item?.categoryLabel, 20),
      timeframe: cleanText(item?.timeframe, 20),
      ruleVersion: cleanText(item?.ruleVersion, 20),
      revisedAt: cleanText(item?.revisedAt, 10),
      ruleStatus: item?.ruleStatus === "frozen" ? "frozen" : "legacy",
      ruleSummary: cleanText(item?.ruleSummary, 300),
      assetTypes: Object.freeze(assetTypes),
      marketStates: Object.freeze(marketStates),
      phaseStates: Object.freeze(phaseStates),
      signals: integer(item?.signals, 0, 100_000, `${id}信号数`),
      stocks: integer(item?.stocks, 0, 10_000, `${id}股票数`),
      t5,
      t20,
      evidence: Object.freeze({
        version: cleanText(item?.evidence?.version, 20) || "legacy",
        state: evidenceState,
        label: cleanText(item?.evidence?.label, 30) || fallbackEvidenceLabel,
        reason: cleanText(item?.evidence?.reason, 300) || "刷新今日选股后按当前证据门重新分级。",
      }),
    });
  });
  const evidenceSummary = Object.freeze(Object.fromEntries(
    ["candidate", "watch", "caution", "accumulating"].map((state) => [state, strategies.filter((item) => item.evidence.state === state).length]),
  ));
  return Object.freeze({
    version: value.version,
    assumptions,
    evidenceSummary,
    strategies: Object.freeze(strategies),
    disclosure: cleanText(value.disclosure, 500),
  });
}

function parseStrategyEvidenceChanges(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze({
      version: 1,
      fromMarketDate: null,
      toMarketDate: null,
      summary: Object.freeze({ upgraded: 0, downgraded: 0, unchanged: 0, new: 0, ruleChanged: 0 }),
      changes: Object.freeze([]),
      disclosure: "尚无跨日策略证据比较。",
    });
  }
  if (value.version !== 1 || !Array.isArray(value.changes) || value.changes.length > 30) {
    throw new Error("策略证据变化结构无效");
  }
  const fromMarketDate = value.fromMarketDate == null ? null : cleanText(value.fromMarketDate, 10);
  const toMarketDate = value.toMarketDate == null ? null : cleanText(value.toMarketDate, 10);
  if ((fromMarketDate && !validDate(fromMarketDate)) || (toMarketDate && !validDate(toMarketDate)) || (fromMarketDate && toMarketDate && fromMarketDate >= toMarketDate)) {
    throw new Error("策略证据变化日期无效");
  }
  const ids = new Set();
  const states = new Set(["candidate", "watch", "caution", "accumulating"]);
  const kinds = new Set(["upgraded", "downgraded", "unchanged", "new", "rule-changed"]);
  const changes = value.changes.map((item) => {
    const strategyId = cleanText(item?.strategyId, 50);
    const kind = kinds.has(item?.kind) ? item.kind : null;
    const fromState = item?.fromState == null ? null : states.has(item.fromState) ? item.fromState : null;
    const toState = states.has(item?.toState) ? item.toState : null;
    const delta = (field) => {
      const number = Number(item?.[field]);
      if (!Number.isInteger(number) || number < -100_000 || number > 100_000) throw new Error(`${strategyId}${field}无效`);
      return number;
    };
    if (!/^[a-z][a-z0-9-]{1,40}$/u.test(strategyId) || ids.has(strategyId) || !kind || !toState || (kind !== "new" && !fromState)) {
      throw new Error("策略证据变化条目无效或重复");
    }
    ids.add(strategyId);
    return Object.freeze({
      strategyId,
      label: cleanText(item?.label, 40),
      kind,
      fromState,
      toState,
      fromRuleVersion: cleanText(item?.fromRuleVersion, 20),
      toRuleVersion: cleanText(item?.toRuleVersion, 20),
      deltaSignals: delta("deltaSignals"),
      deltaStocks: delta("deltaStocks"),
      deltaT5: delta("deltaT5"),
      deltaT20: delta("deltaT20"),
      reason: cleanText(item?.reason, 300),
    });
  });
  const summary = Object.freeze({
    upgraded: changes.filter((item) => item.kind === "upgraded").length,
    downgraded: changes.filter((item) => item.kind === "downgraded").length,
    unchanged: changes.filter((item) => item.kind === "unchanged").length,
    new: changes.filter((item) => item.kind === "new").length,
    ruleChanged: changes.filter((item) => item.kind === "rule-changed").length,
  });
  for (const [key, count] of Object.entries(summary)) {
    if (value.summary?.[key] != null && Number(value.summary[key]) !== count) throw new Error("策略证据变化汇总冲突");
  }
  return Object.freeze({
    version: 1,
    fromMarketDate,
    toMarketDate,
    summary,
    changes: Object.freeze(changes),
    disclosure: cleanText(value.disclosure, 400),
  });
}

function parseFactorLab(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze({ version: 1, horizon: 5, lookbackDays: 120, minimumCrossSection: 5, stocks: 0, factors: Object.freeze([]), correlations: Object.freeze([]), redundancy: Object.freeze({ pairs: 0, summary: "暂无相关性样本" }), combinations: Object.freeze({ version: 1, testedPairs: 0, skippedRedundant: 0, trainThrough: null, validateFrom: null, candidates: Object.freeze([]), disclosure: "暂无组合样本" }), disclosure: "暂无因子体检" });
  }
  if (value.version !== 1 || !Array.isArray(value.factors) || value.factors.length > 12) {
    throw new Error("因子体检结构无效");
  }
  const ids = new Set();
  const factors = value.factors.map((item) => {
    const id = cleanText(item?.id, 50);
    const state = ["supported", "opposite", "weak", "insufficient"].includes(item?.state) ? item.state : null;
    if (!/^[A-Za-z][A-Za-z0-9]{1,40}$/u.test(id) || ids.has(id) || !state) throw new Error("因子体检条目无效或重复");
    ids.add(id);
    const stabilitySource = item?.stability && typeof item.stability === "object" && !Array.isArray(item.stability)
      ? item.stability
      : { state: "insufficient", windows: [] };
    const stabilityState = ["stable", "weakening", "reversing", "mixed", "insufficient"].includes(stabilitySource.state)
      ? stabilitySource.state
      : null;
    const stabilityWindows = Array.isArray(stabilitySource.windows) ? stabilitySource.windows : [];
    if (!stabilityState || stabilityWindows.length > 4) throw new Error(`${id}滚动稳定性无效`);
    const parsedStabilityWindows = stabilityWindows.map((window, index) => {
      const from = cleanText(window?.from, 10);
      const to = cleanText(window?.to, 10);
      if (!validDate(from) || !validDate(to) || from > to) throw new Error(`${id}滚动窗口 ${index + 1} 日期无效`);
      return Object.freeze({
        from,
        to,
        days: integer(window?.days, 1, 252, `${id}滚动窗口天数`),
        ic: finiteNumber(window?.ic, -1, 1, `${id}滚动IC`, { nullable: true }),
        spread: finiteNumber(window?.spread, -1_000, 1_000, `${id}滚动分组差`, { nullable: true }),
      });
    });
    return Object.freeze({
      id,
      label: cleanText(item?.label, 40),
      description: cleanText(item?.description, 300),
      horizon: integer(item?.horizon, 2, 20, `${id}持有期`),
      days: integer(item?.days, 0, 252, `${id}截面天数`),
      observations: integer(item?.observations, 0, 5_000_000, `${id}观察数`),
      icMean: finiteNumber(item?.icMean, -1, 1, `${id} IC`, { nullable: true }),
      icStd: finiteNumber(item?.icStd, 0, 2, `${id} IC波动`, { nullable: true }),
      icIr: finiteNumber(item?.icIr, -Number.MAX_VALUE, Number.MAX_VALUE, `${id} ICIR`, { nullable: true }),
      positiveIcRate: finiteNumber(item?.positiveIcRate, 0, 1, `${id} IC正值比例`, { nullable: true }),
      longShortMedian: finiteNumber(item?.longShortMedian, -1_000, 1_000, `${id}分组差`, { nullable: true }),
      stability: Object.freeze({ state: stabilityState, windows: Object.freeze(parsedStabilityWindows) }),
      state,
    });
  });
  const factorIds = new Set(factors.map((item) => item.id));
  const pairIds = new Set();
  const correlations = (Array.isArray(value.correlations) ? value.correlations : []).map((item) => {
    const leftId = cleanText(item?.leftId, 50);
    const rightId = cleanText(item?.rightId, 50);
    const pairId = `${leftId}:${rightId}`;
    const state = ["redundant", "related", "distinct", "insufficient"].includes(item?.state) ? item.state : null;
    if (!factorIds.has(leftId) || !factorIds.has(rightId) || leftId === rightId || pairIds.has(pairId) || !state) throw new Error("因子相关性条目无效或重复");
    pairIds.add(pairId);
    return Object.freeze({
      leftId,
      leftLabel: cleanText(item?.leftLabel, 40),
      rightId,
      rightLabel: cleanText(item?.rightLabel, 40),
      days: integer(item?.days, 0, 252, `${pairId}相关天数`),
      coefficient: finiteNumber(item?.coefficient, -1, 1, `${pairId}相关系数`, { nullable: true }),
      sameSignRate: finiteNumber(item?.sameSignRate, 0, 1, `${pairId}同号率`, { nullable: true }),
      state,
    });
  });
  if (correlations.length > 66) throw new Error("因子相关性条目过多");
  const redundantPairs = correlations.filter((item) => item.state === "redundant").length;
  const redundancyPairs = value.redundancy?.pairs == null ? redundantPairs : integer(value.redundancy.pairs, 0, 66, "重复因子组数");
  if (redundancyPairs !== redundantPairs) throw new Error("重复因子组数冲突");
  const combinationSource = value.combinations && typeof value.combinations === "object" && !Array.isArray(value.combinations)
    ? value.combinations
    : { version: 1, testedPairs: 0, skippedRedundant: 0, trainThrough: null, validateFrom: null, candidates: [] };
  if (combinationSource.version !== 1 || !Array.isArray(combinationSource.candidates) || combinationSource.candidates.length > 15) {
    throw new Error("双因子候选结构无效");
  }
  const combinationIds = new Set();
  const combinations = combinationSource.candidates.map((item) => {
    const leftId = cleanText(item?.leftId, 50);
    const rightId = cleanText(item?.rightId, 50);
    const id = `${leftId}+${rightId}`;
    const state = ["supported", "watch", "unstable", "insufficient"].includes(item?.state) ? item.state : null;
    if (!factorIds.has(leftId) || !factorIds.has(rightId) || leftId === rightId || combinationIds.has(id) || !state) {
      throw new Error("双因子候选条目无效或重复");
    }
    combinationIds.add(id);
    return Object.freeze({
      id,
      leftId,
      leftLabel: cleanText(item?.leftLabel, 40),
      leftDirection: item?.leftDirection === -1 ? -1 : 1,
      rightId,
      rightLabel: cleanText(item?.rightLabel, 40),
      rightDirection: item?.rightDirection === -1 ? -1 : 1,
      trainDays: integer(item?.trainDays, 0, 252, `${id}训练天数`),
      validationDays: integer(item?.validationDays, 0, 252, `${id}验证天数`),
      trainIc: finiteNumber(item?.trainIc, -1, 1, `${id}训练IC`, { nullable: true }),
      validationIc: finiteNumber(item?.validationIc, -1, 1, `${id}验证IC`, { nullable: true }),
      trainSpread: finiteNumber(item?.trainSpread, -1_000, 1_000, `${id}训练分组差`, { nullable: true }),
      validationSpread: finiteNumber(item?.validationSpread, -1_000, 1_000, `${id}验证分组差`, { nullable: true }),
      state,
    });
  });
  const trainThrough = combinationSource.trainThrough == null ? null : cleanText(combinationSource.trainThrough, 10);
  const validateFrom = combinationSource.validateFrom == null ? null : cleanText(combinationSource.validateFrom, 10);
  if ((trainThrough != null && !validDate(trainThrough)) || (validateFrom != null && !validDate(validateFrom))) {
    throw new Error("双因子训练或验证日期无效");
  }
  return Object.freeze({
    version: 1,
    horizon: integer(value.horizon, 2, 20, "因子持有期"),
    lookbackDays: integer(value.lookbackDays, 20, 252, "因子回看期"),
    minimumCrossSection: integer(value.minimumCrossSection, 3, 100, "因子最小截面"),
    stocks: integer(value.stocks, 0, 10_000, "因子股票数"),
    factors: Object.freeze(factors),
    correlations: Object.freeze(correlations),
    redundancy: Object.freeze({
      pairs: redundancyPairs,
      summary: cleanText(value.redundancy?.summary, 300) || (redundantPairs ? `发现 ${redundantPairs} 组稳定高相关因子。` : "未发现稳定高相关因子。"),
    }),
    combinations: Object.freeze({
      version: 1,
      testedPairs: integer(combinationSource.testedPairs, 0, 66, "双因子测试组数"),
      skippedRedundant: integer(combinationSource.skippedRedundant, 0, 66, "双因子去重组数"),
      trainThrough,
      validateFrom,
      candidates: Object.freeze(combinations),
      disclosure: cleanText(combinationSource.disclosure, 500) || "双因子组合只作样本外研究候选。",
    }),
    disclosure: cleanText(value.disclosure, 600),
  });
}

function parseLimitLadderStock(value, label) {
  const symbol = cleanText(value?.symbol, 16);
  const sectorId = cleanText(value?.sectorId, 50);
  if (!/^(?:SH|SZ)\d{6}$/u.test(symbol) || !/^new_[A-Za-z0-9]+$/u.test(sectorId)) {
    throw new Error(`${label}股票无效`);
  }
  return Object.freeze({
    symbol,
    name: cleanText(value?.name, 40),
    sectorId,
    sectorName: cleanText(value?.sectorName, 40),
    boards: integer(value?.boards, 0, 20, `${label}连板数`),
    previousBoards: integer(value?.previousBoards, 0, 20, `${label}前序连板`),
    promoted: value?.promoted === true,
    sealed: value?.sealed === true,
    touched: value?.touched === true,
    price: finiteNumber(value?.price, 0.01, 1_000_000, `${label}价格`),
    changePercent: finiteNumber(value?.changePercent, -100, 1_000, `${label}涨跌幅`),
    amount: finiteNumber(value?.amount, 0, 1e18, `${label}成交额`),
  });
}

function parseLimitLadder(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze({ version: 1, provisional: false, sampleSize: 0, sealed: 0, broken: 0, maxBoards: 0, promotionPool: 0, promotionRate: null, tiers: Object.freeze([]), brokenStocks: Object.freeze([]), disclosure: "暂无连板样本" });
  }
  if (value.version !== 1 || !Array.isArray(value.tiers) || value.tiers.length > 20 || !Array.isArray(value.brokenStocks) || value.brokenStocks.length > 12) {
    throw new Error("连板梯队结构无效");
  }
  const seen = new Set();
  const seenStocks = new Set();
  let totalTierStocks = 0;
  const tiers = value.tiers.map((tier) => {
    const boards = integer(tier?.boards, 1, 20, "梯队连板数");
    if (seen.has(boards) || !Array.isArray(tier?.stocks) || tier.stocks.length > SELECTION_SCAN_LIMITS.stocks) throw new Error("连板梯队重复或股票过多");
    totalTierStocks += tier.stocks.length;
    if (totalTierStocks > SELECTION_SCAN_LIMITS.stocks) throw new Error("连板梯队股票总数过多");
    seen.add(boards);
    const stocks = tier.stocks.map((item) => parseLimitLadderStock(item, `${boards}板`));
    if (stocks.some((item) => !item.sealed || !item.touched || item.boards !== boards)) throw new Error("连板梯队股票状态冲突");
    for (const stock of stocks) {
      if (seenStocks.has(stock.symbol)) throw new Error("连板梯队股票重复");
      seenStocks.add(stock.symbol);
    }
    return Object.freeze({ boards, label: cleanText(tier?.label, 30), stocks: Object.freeze(stocks) });
  });
  const brokenStocks = value.brokenStocks.map((item) => parseLimitLadderStock(item, "炸板"));
  if (brokenStocks.some((item) => item.sealed || !item.touched || item.boards !== 0)) throw new Error("炸板股票状态冲突");
  for (const stock of brokenStocks) {
    if (seenStocks.has(stock.symbol)) throw new Error("连板梯队或炸板股票重复");
    seenStocks.add(stock.symbol);
  }
  const sampleSize = integer(value.sampleSize, 0, SELECTION_SCAN_LIMITS.stocks, "连板样本数");
  const sealed = integer(value.sealed, 0, SELECTION_SCAN_LIMITS.stocks, "样本封板数");
  const broken = integer(value.broken, 0, SELECTION_SCAN_LIMITS.stocks, "样本炸板数");
  const promotionPool = integer(value.promotionPool, 0, sampleSize, "晋级池");
  const maxBoards = integer(value.maxBoards, 0, 20, "最高连板");
  const tierSealed = tiers.reduce((sum, tier) => sum + tier.stocks.length, 0);
  if (sealed !== tierSealed || sealed + broken > sampleSize || broken < brokenStocks.length || maxBoards !== (tiers[0]?.boards ?? 0)) {
    throw new Error("连板梯队数量冲突");
  }
  return Object.freeze({
    version: 1,
    provisional: value.provisional === true,
    sampleSize,
    sealed,
    broken,
    maxBoards,
    promotionPool,
    promotionRate: finiteNumber(value.promotionRate, 0, 1, "晋级率", { nullable: true }),
    tiers: Object.freeze(tiers),
    brokenStocks: Object.freeze(brokenStocks),
    disclosure: cleanText(value.disclosure, 500),
  });
}

function parseSectorRotation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze({ version: 1, dates: Object.freeze([]), rows: Object.freeze([]), methodology: "暂无行业轮动历史" });
  }
  if (value.version !== 1 || !Array.isArray(value.dates) || value.dates.length > 7 || !Array.isArray(value.rows) || value.rows.length > 6) {
    throw new Error("行业轮动矩阵结构无效");
  }
  const dates = value.dates.map((date) => {
    if (!validDate(date)) throw new Error("行业轮动日期无效");
    return date;
  });
  if (new Set(dates).size !== dates.length || dates.some((date, index) => index > 0 && date <= dates[index - 1])) {
    throw new Error("行业轮动日期重复或乱序");
  }
  const ids = new Set();
  const rows = value.rows.map((item) => {
    const id = cleanText(item?.id, 50);
    const name = cleanText(item?.name, 40);
    if (!/^new_[A-Za-z0-9]+$/u.test(id) || !name || ids.has(id) || !Array.isArray(item.cells) || item.cells.length !== dates.length) {
      throw new Error("行业轮动条目无效或重复");
    }
    ids.add(id);
    const trend = ["rising", "falling", "stable", "insufficient"].includes(item.trend) ? item.trend : null;
    if (!trend) throw new Error("行业轮动趋势无效");
    const cells = item.cells.map((cell) => {
      const available = cell?.available === true;
      if (!available) return Object.freeze({ available: false, score: null, rank: null, stage: "unavailable", stageLabel: "未覆盖" });
      return Object.freeze({
        available: true,
        score: finiteNumber(cell.score, 0, 100, `${name}轮动分数`),
        rank: integer(cell.rank, 1, SELECTION_SCAN_LIMITS.sectors, `${name}轮动排名`),
        stage: cleanText(cell.stage, 20),
        stageLabel: cleanText(cell.stageLabel, 30),
      });
    });
    return Object.freeze({
      id,
      name,
      delta: finiteNumber(item.delta, -100, 100, `${name}轮动变化`, { nullable: true }),
      trend,
      cells: Object.freeze(cells),
    });
  });
  return Object.freeze({
    version: 1,
    dates: Object.freeze(dates),
    rows: Object.freeze(rows),
    methodology: cleanText(value.methodology, 400),
  });
}

function parsePredictions(value) {
  if (!Array.isArray(value) || value.length > 20) throw new Error("预测快照列表无效");
  const ids = new Set();
  return Object.freeze(value.map((item) => {
    const id = cleanText(item?.id, 120);
    const symbol = cleanText(item?.symbol, 16);
    const marketDate = cleanText(item?.marketDate, 10);
    const pool = ["confirmed", "waiting"].includes(item?.pool) ? item.pool : null;
    const bias = ["positive", "neutral", "caution", "insufficient"].includes(item?.bias) ? item.bias : null;
    if (!id || ids.has(id) || !/^(?:SH|SZ)\d{6}$/u.test(symbol) || !validDate(marketDate) || !pool || !bias) {
      throw new Error("预测快照条目无效或重复");
    }
    ids.add(id);
    const calibration = item?.calibration;
    if (!calibration || typeof calibration !== "object" || Array.isArray(calibration)) throw new Error("预测校准无效");
    return Object.freeze({
      id,
      marketDate,
      symbol,
      name: cleanText(item?.name, 40),
      sectorId: cleanText(item?.sectorId, 50),
      sectorName: cleanText(item?.sectorName, 40),
      pool,
      setupId: cleanText(item?.setupId, 50),
      setupLabel: cleanText(item?.setupLabel, 40),
      signalClose: finiteNumber(item?.signalClose, 0.01, 1_000_000, "预测信号价"),
      bias,
      calibration: Object.freeze({
        sampleSize5: integer(calibration.sampleSize5, 0, 100_000, "T+5预测样本"),
        medianNetReturn5: finiteNumber(calibration.medianNetReturn5, -100, 100_000, "T+5预测中位数", { nullable: true }),
        positiveRate5: finiteNumber(calibration.positiveRate5, 0, 1, "T+5预测正收益比例", { nullable: true }),
        sampleSize20: integer(calibration.sampleSize20, 0, 100_000, "T+20预测样本"),
        medianNetReturn20: finiteNumber(calibration.medianNetReturn20, -100, 100_000, "T+20预测中位数", { nullable: true }),
        positiveRate20: finiteNumber(calibration.positiveRate20, 0, 1, "T+20预测正收益比例", { nullable: true }),
      }),
      statement: cleanText(item?.statement, 400),
    });
  }));
}

function parseReviewOutcome(value, label) {
  const state = ["evaluated", "pending", "unfilled"].includes(value?.state) ? value.state : null;
  if (!state) throw new Error(`${label}复盘状态无效`);
  const maxAdverse = finiteNumber(value.maxAdverse, -100, 100_000, `${label}不利波动`, { nullable: true });
  return Object.freeze({
    state,
    entryDate: value.entryDate == null ? "" : validDate(value.entryDate) ? value.entryDate : "",
    exitDate: value.exitDate == null ? "" : validDate(value.exitDate) ? value.exitDate : "",
    returnNet: finiteNumber(value.returnNet, -100, 100_000, `${label}复盘收益`, { nullable: true }),
    maxAdverse: maxAdverse == null ? null : Math.min(0, maxAdverse),
    delayedExitBars: value.delayedExitBars == null ? 0 : integer(value.delayedExitBars, 0, 20, `${label}顺延天数`),
    reason: cleanText(value.reason, 80),
  });
}

function parseNextSessionOutcome(value) {
  const state = ["evaluated", "pending"].includes(value?.state) ? value.state : null;
  if (!state) throw new Error("次日表现状态无效");
  const maxAdverse = finiteNumber(value.maxAdverse, -100, 100_000, "次日不利波动", { nullable: true });
  return Object.freeze({
    state,
    date: value.date == null ? "" : validDate(value.date) ? value.date : "",
    openGap: finiteNumber(value.openGap, -100, 1_000, "次日开盘缺口", { nullable: true }),
    closeReturn: finiteNumber(value.closeReturn, -100, 100_000, "次日收盘表现", { nullable: true }),
    intradayReturn: finiteNumber(value.intradayReturn, -100, 100_000, "次日开盘至收盘表现", { nullable: true }),
    maxAdverse: maxAdverse == null ? null : Math.min(0, maxAdverse),
  });
}

function parsePredictionReview(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze({ records: Object.freeze([]), summary: Object.freeze({ saved: 0, evaluated1: 0, evaluated5: 0, evaluated20: 0, chaseRisk: false }) });
  }
  if (!Array.isArray(value.records) || value.records.length > 60) throw new Error("预测复盘记录无效");
  const records = value.records.map((item) => Object.freeze({
    predictionId: cleanText(item?.predictionId, 120),
    marketDate: validDate(item?.marketDate) ? item.marketDate : "",
    symbol: /^(?:SH|SZ)\d{6}$/u.test(item?.symbol) ? item.symbol : "",
    name: cleanText(item?.name, 40),
    setupId: cleanText(item?.setupId, 50),
    setupLabel: cleanText(item?.setupLabel, 40),
    h1: parseNextSessionOutcome(item?.h1 ?? { state: "pending" }),
    h5: parseReviewOutcome(item?.h5, "T+5"),
    h20: parseReviewOutcome(item?.h20, "T+20"),
  }));
  const summary = value.summary ?? {};
  return Object.freeze({
    records: Object.freeze(records),
    summary: Object.freeze({
      saved: integer(summary.saved, 0, 100_000, "保存预测数"),
      evaluated1: summary.evaluated1 == null ? 0 : integer(summary.evaluated1, 0, 100_000, "次日已复盘数"),
      positiveRate1: finiteNumber(summary.positiveRate1, 0, 1, "次日正收益比例", { nullable: true }),
      medianCloseReturn1: finiteNumber(summary.medianCloseReturn1, -100, 100_000, "次日收盘表现", { nullable: true }),
      highOpenEvaluated1: summary.highOpenEvaluated1 == null ? 0 : integer(summary.highOpenEvaluated1, 0, 100_000, "高开复盘数"),
      highOpenMedianIntradayReturn1: finiteNumber(summary.highOpenMedianIntradayReturn1, -100, 100_000, "高开后日内表现", { nullable: true }),
      chaseRisk: summary.chaseRisk === true,
      evaluated5: integer(summary.evaluated5, 0, 100_000, "T+5已复盘数"),
      positiveRate5: finiteNumber(summary.positiveRate5, 0, 1, "T+5复盘正收益比例", { nullable: true }),
      medianNetReturn5: finiteNumber(summary.medianNetReturn5, -100, 100_000, "T+5复盘收益", { nullable: true }),
      evaluated20: integer(summary.evaluated20, 0, 100_000, "T+20已复盘数"),
      positiveRate20: finiteNumber(summary.positiveRate20, 0, 1, "T+20复盘正收益比例", { nullable: true }),
      medianNetReturn20: finiteNumber(summary.medianNetReturn20, -100, 100_000, "T+20复盘收益", { nullable: true }),
    }),
  });
}

export function parseAShareSelectionSnapshot(text) {
  const source = String(text ?? "").trim();
  if (!source) throw new Error("选股程序没有返回数据");
  if (new TextEncoder().encode(source).length > MAX_SNAPSHOT_BYTES) throw new Error("选股数据超过安全上限");
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("选股数据不是有效 JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("选股数据结构无效");
  if (value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION || value.kind !== SNAPSHOT_KIND) throw new Error("选股数据版本不受支持");
  const marketDate = cleanText(value.marketDate, 10);
  const asOf = cleanText(value.asOf, 40);
  const generatedAt = cleanText(value.generatedAt, 40);
  if (!validDate(marketDate) || !validInstant(asOf) || !validInstant(generatedAt)) throw new Error("选股数据时点无效");
  if (asOf.slice(0, 10) !== marketDate || Date.parse(asOf) > Date.parse(generatedAt) + 60 * 60 * 1_000) {
    throw new Error("选股数据时点冲突");
  }
  const market = value.market;
  const legacyEnvironment = market?.version == null && market && typeof market === "object"
    ? (() => {
        const stateMap = {
          strong: ["strong", "强势", 70],
          rotation: ["range", "震荡", 50],
          weak: ["lean_weak", "偏弱", 38],
          retreat: ["weak", "弱势", 25],
        };
        const [state, label, score] = stateMap[market.state] ?? stateMap.rotation;
        return {
          version: 1,
          state,
          label,
          score,
          reason: cleanText(market.reason, 240) || "这是一份旧版市场快照；刷新后会补齐五档强弱依据。",
          candidateLimit: Number.isInteger(market.candidateLimit) ? market.candidateLimit : 2,
          confidence: "low",
          dimensions: [
            { id: "profit", label: "赚钱效应", value: score, evidence: "旧版快照，待刷新补齐" },
            { id: "speculation", label: "投机热度", value: score, evidence: "旧版快照，待刷新补齐" },
            { id: "resilience", label: "抗跌能力", value: score, evidence: "旧版快照，待刷新补齐" },
            { id: "trend", label: "趋势状态", value: score, evidence: "旧版快照，待刷新补齐" },
          ],
          phase: {
            state: "unavailable",
            label: "样本积累中",
            available: false,
            duration: 0,
            confidence: "low",
            pendingLabel: "",
            reason: "历史快照没有连续市场阶段；下次刷新后自动补齐。",
            metrics: {},
            timeline: [],
          },
          mainlines: [],
          historyDays: 0,
          methodology: "旧版快照兼容展示；刷新后启用五档强弱、六阶段与主线识别。",
        };
      })()
    : market;
  const environment = parseMarketEnvironment(legacyEnvironment);
  if (!market?.breadth) throw new Error("市场环境结构无效");
  const breadthTotal = integer(market.breadth.total, 100, 20_000, "行情覆盖");
  const breadth = Object.freeze({
    total: breadthTotal,
    up: integer(market.breadth.up, 0, breadthTotal, "上涨家数"),
    down: integer(market.breadth.down, 0, breadthTotal, "下跌家数"),
    flat: integer(market.breadth.flat, 0, breadthTotal, "平盘家数"),
    netBreadth: finiteNumber(market.breadth.netBreadth, -1, 1, "市场宽度"),
    limitUp: integer(market.breadth.limitUp, 0, breadthTotal, "涨停近似"),
    limitDown: integer(market.breadth.limitDown, 0, breadthTotal, "跌停近似"),
    amount: finiteNumber(market.breadth.amount, 0, 1e18, "市场成交额"),
  });
  if (breadth.up + breadth.down + breadth.flat !== breadth.total) throw new Error("涨跌家数与行情覆盖不一致");
  let scanCoverage = null;
  if (value.scanCoverage != null) {
    if (typeof value.scanCoverage !== "object" || Array.isArray(value.scanCoverage)) {
      throw new Error("选股扫描范围无效");
    }
    const historyRequested = integer(value.scanCoverage.historyRequested, 0, SELECTION_SCAN_LIMITS.stocks, "历史请求数");
    const historyAvailable = integer(value.scanCoverage.historyAvailable, 0, historyRequested, "有效历史数");
    const historyCacheHits = integer(value.scanCoverage.historyCacheHits, 0, historyAvailable, "历史缓存命中");
    const historyNetworkLoads = integer(value.scanCoverage.historyNetworkLoads, 0, historyAvailable, "历史联网补充");
    const historyFailed = integer(value.scanCoverage.historyFailed, 0, historyRequested, "历史缺失数");
    const historyPending = value.scanCoverage.historyPending == null ? 0 : integer(value.scanCoverage.historyPending, 0, historyRequested, "待扫描历史数");
    const sectorMembers = integer(value.scanCoverage.sectorMembers, 0, historyRequested, "板块样本数");
    if (
      integer(value.scanCoverage.quoteUniverse, 100, 20_000, "实时行情范围") !== breadthTotal ||
      historyCacheHits + historyNetworkLoads !== historyAvailable ||
      historyAvailable + historyFailed + historyPending !== historyRequested
    ) throw new Error("选股扫描范围数量冲突");
    scanCoverage = Object.freeze({
      quoteUniverse: breadthTotal,
      researchSectors: integer(value.scanCoverage.researchSectors, 0, SELECTION_SCAN_LIMITS.sectors, "研究板块数"),
      sectorMembers,
      historyRequested,
      historyAvailable,
      historyCacheHits,
      historyNetworkLoads,
      historyFailed,
      historyPending,
    });
  }
  if (!Array.isArray(value.sectors) || value.sectors.length > SELECTION_SCAN_LIMITS.sectors) throw new Error("推荐板块列表无效");
  const sectors = Object.freeze(value.sectors.map(parseSector));
  const sectorIds = new Set();
  for (const sector of sectors) {
    if (sectorIds.has(sector.id)) throw new Error("推荐板块重复");
    sectorIds.add(sector.id);
  }
  const scanProgress = parseSelectionScanProgress(value.scanProgress, sectors, generatedAt);
  if (scanProgress) {
    if (scanProgress.state === "complete" && scanCoverage && (scanCoverage.historyPending || scanCoverage.historyFailed)) {
      throw new Error("全行业扫描已完成状态与全局历史缺失冲突");
    }
    const ranks = sectors.filter((sector) => sector.scan.state === "complete").map((sector) => sector.rank).sort((a, b) => a - b);
    if (ranks.some((rank, index) => rank !== index + 1)) throw new Error("全行业完整排名重复或不连续");
  }
  const technologyHotspots = parseTechnologyHotspots(value.technologyHotspots, sectors, generatedAt);
  if (!Array.isArray(value.sectorDirectory) || value.sectorDirectory.length > SELECTION_SCAN_LIMITS.sectors) throw new Error("板块目录无效");
  const sectorDirectory = Object.freeze(value.sectorDirectory.map((item) => {
    const id = cleanText(item?.id, 50);
    const name = cleanText(item?.name, 40);
    if (!/^new_[A-Za-z0-9]+$/u.test(id) || !name) throw new Error("板块目录条目无效");
    return Object.freeze({ id, name });
  }));
  const stockDirectory = parseAShareStockDirectory(value.stockDirectory);
  const watchSectors = Array.isArray(value.watch?.sectors) ? value.watch.sectors.map((item) => {
    const id = cleanText(item?.id, 50);
    const name = cleanText(item?.name, 40);
    if (!/^new_[A-Za-z0-9]+$/u.test(id) || !name) throw new Error("关注板块条目无效");
    return Object.freeze({ id, name });
  }) : [];
  if (watchSectors.length > 12) throw new Error("关注板块过多");
  if (!Array.isArray(value.watch?.stocks) || value.watch.stocks.length > 20) throw new Error("关注个股列表无效");
  const sourceStatusKeys = ["quotes", "industries", "histories", "announcements", "news"];
  const sourceStatus = Object.freeze(Object.fromEntries(sourceStatusKeys.map((key) => [key, value.sourceStatus?.[key] === true])));
  const sources = Array.isArray(value.sources) ? value.sources.slice(0, 8).map((item) => ({
    label: cleanText(item?.label, 100),
    url: safeUrl(item?.url, "数据来源"),
    asOf: cleanText(item?.asOf, 40),
  })) : [];
  const phase = ["intraday", "close", "previous-close"].includes(value.session?.phase)
    ? value.session.phase
    : null;
  const provisional = value.session?.provisional === true;
  const previousClose = value.session?.previousClose === true;
  if (!phase || (phase === "intraday") !== provisional || (phase === "previous-close") !== previousClose || (provisional && previousClose)) {
    throw new Error("选股交易阶段冲突");
  }
  if (!provisional && sectors.some((sector) => sector.candidates.some((candidate) => candidate.lastBarDate !== marketDate))) {
    throw new Error("收盘确认候选缺少当日 K 线，请刷新选股快照");
  }
  return Object.freeze({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    kind: SNAPSHOT_KIND,
    marketDate,
    asOf,
    generatedAt,
    session: Object.freeze({
      phase,
      provisional,
      previousClose,
    }),
    market: Object.freeze({
      ...environment,
      breadth,
      limitLadder: parseLimitLadder(value.market?.limitLadder),
      rotationMatrix: parseSectorRotation(value.market?.rotationMatrix),
    }),
    scanCoverage,
    scanProgress,
    selectionSummary: parseSelectionSummary(value.selectionSummary, sectors),
    sectorDirectory,
    stockDirectory,
    sectors,
    researchEvidence: parseSelectionResearchEvidence(value.researchEvidence, { marketDate, generatedAt, provisional }),
    technologyHotspots,
    factorLab: parseFactorLab(value.factorLab),
    strategyLab: parseStrategyLab(value.strategyLab),
    strategyEvidenceChanges: parseStrategyEvidenceChanges(value.strategyEvidenceChanges),
    predictions: parsePredictions(Array.isArray(value.predictions) ? value.predictions : []),
    predictionReview: parsePredictionReview(value.predictionReview),
    watch: Object.freeze({
      sectors: Object.freeze(watchSectors),
      stocks: Object.freeze(value.watch.stocks.map(parseWatchStock)),
    }),
    exclusions: value.exclusions && typeof value.exclusions === "object" ? Object.freeze({
      unavailableSectorSamples: integer(value.exclusions.unavailableSectorSamples, 0, SELECTION_SCAN_LIMITS.sectors, "样本不足板块"),
      crowdedSectors: integer(value.exclusions.crowdedSectors, 0, SELECTION_SCAN_LIMITS.sectors, "拥挤板块"),
      retreatSectors: integer(value.exclusions.retreatSectors, 0, SELECTION_SCAN_LIMITS.sectors, "退潮板块"),
      noCandidateSectors: integer(value.exclusions.noCandidateSectors, 0, SELECTION_SCAN_LIMITS.sectors, "无候选板块"),
    }) : Object.freeze({}),
    sourceStatus,
    industryProvider: value.industryProvider ? Object.freeze({ id: cleanText(value.industryProvider.id, 40), label: cleanText(value.industryProvider.label, 60), fallback: value.industryProvider.fallback === true }) : null,
    sourceErrors: Object.freeze((Array.isArray(value.sourceErrors) ? value.sourceErrors : [])
      .slice(0, 100).map((error) => Object.freeze({
        source: cleanText(error?.source, 80), errorCode: cleanText(error?.errorCode, 100),
        message: cleanText(error?.message, 300),
      })).filter((error) => error.source || error.message)),
    sources: Object.freeze(sources),
    disclaimer: cleanText(value.disclaimer, 300),
    elapsedMs: integer(value.elapsedMs, 0, 180_000, "选股耗时"),
  });
}

function canonicalStock(value) {
  return canonicalAShareSymbol(cleanText(value, 24));
}

export function parseSelectionWatchStorage(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const sectors = [];
  const sectorIds = new Set();
  for (const item of Array.isArray(source.sectors) ? source.sectors : []) {
    const id = cleanText(item?.id, 50);
    const name = cleanText(item?.name, 40);
    if (!/^new_[A-Za-z0-9]+$/u.test(id) || !name || sectorIds.has(id)) continue;
    sectorIds.add(id);
    sectors.push({ id, name, ...(item?.priority === "focus" ? { priority: "focus" } : {}) });
    if (sectors.length >= 12) break;
  }
  const stocks = [];
  const stockSymbols = new Set();
  for (const item of Array.isArray(source.stocks) ? source.stocks : []) {
    const symbol = canonicalStock(item?.symbol);
    if (!symbol || stockSymbols.has(symbol)) continue;
    stockSymbols.add(symbol);
    stocks.push({
      symbol,
      name: cleanText(item?.name, 40),
      ...(item?.source === "portfolio" ? { source: "portfolio" } : {}),
      ...(item?.priority === "focus" ? { priority: "focus" } : {}),
    });
    if (stocks.length >= 20) break;
  }
  const selectedSectorId = /^new_[A-Za-z0-9]+$/u.test(cleanText(source.selectedSectorId, 50))
    ? cleanText(source.selectedSectorId, 50)
    : null;
  return Object.freeze({
    version: STORAGE_VERSION,
    sectors: Object.freeze(sectors),
    stocks: Object.freeze(stocks),
    selectedSectorId,
  });
}

// Merge actual positive holdings; never remove or replace a user's existing watch.
export function mergePortfolioWatch(value, ledger, holdings) {
  const current = parseSelectionWatchStorage(value);
  const held = new Set((holdings?.positionsByAccount ?? [])
    .filter((position) => Number(position.quantity) > 0)
    .map((position) => position.instrumentId));
  const stocks = [...current.stocks];
  const seen = new Set(stocks.map((stock) => stock.symbol));
  const skipped = [];
  for (const instrument of ledger?.instruments ?? []) {
    if (!held.has(instrument.id) || instrument.market !== "cn") continue;
    const symbol = canonicalStock(instrument.symbol);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    if (stocks.length >= 20) { skipped.push(symbol); continue; }
    stocks.push({ symbol, name: instrument.name, source: "portfolio" });
  }
  return { value: parseSelectionWatchStorage({ ...current, stocks }),
    added: stocks.length - current.stocks.length, skipped };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function selectionSectorPage(sectors, { view = "priority", query = "", sort = "composite", page = 0 } = {}) {
  const search = cleanText(query, 80).toLocaleLowerCase("zh-CN");
  const rows = sectors.filter((sector) => (view === "all" || sector.recommended) &&
    (!search || sector.name.toLocaleLowerCase("zh-CN").includes(search) || sector.id.toLowerCase().includes(search)));
  const stateOrder = { complete: 0, partial: 1, pending: 2, failed: 3 };
  const compareRank = (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || b.relativeScore - a.relativeScore || a.id.localeCompare(b.id);
  if (view === "all") rows.sort(sort === "change"
    ? (a, b) => (b.metrics.changePercent ?? -Infinity) - (a.metrics.changePercent ?? -Infinity) || compareRank(a, b)
    : sort === "progress"
      ? (a, b) => (stateOrder[a.scan?.state] ?? 4) - (stateOrder[b.scan?.state] ?? 4) || compareRank(a, b)
      : compareRank);
  const pages = Math.max(1, Math.ceil(rows.length / SECTOR_PAGE_SIZE));
  const currentPage = Math.min(pages - 1, Math.max(0, Number.isInteger(page) ? page : 0));
  return Object.freeze({ total: rows.length, page: currentPage, pages,
    rows: Object.freeze(rows.slice(currentPage * SECTOR_PAGE_SIZE, (currentPage + 1) * SECTOR_PAGE_SIZE)) });
}

function scanStateLabel(scan) {
  return { pending: "待扫描", partial: "部分完成", complete: "已完成", failed: "失败" }[scan?.state] || "旧快照";
}

function scanRetryExplanation(snapshot) {
  const reasons = [...new Set((snapshot?.sectors ?? [])
    .filter((sector) => ["partial", "failed"].includes(sector.scan?.state)
      || (sector.scan?.state === "pending" && /失败|限流|超时|中断|不可用|HTTP[_ ]?\d{3}|SOURCE_HTTP|ETIMEDOUT|ECONNRESET|TIMEOUT/iu.test(sector.scan.reason ?? "")))
    .map((sector) => sector.scan.reason).filter(Boolean))].slice(0, 3);
  return reasons.map((reason) => reason
    .replace(/(?:HTTP[_ ]?|SOURCE_HTTP[_ ]?)(429|456|403)\b/giu, "数据源限流（$1），等待恢复")
    .replace(/HISTORY_DATE_STALE/gu, "日线尚未更新到本次核验日期")
    .replace(/HISTORY_SHORT/gu, "历史长度不足")
    .replace(/HISTORY_(?:FAILED|ERROR)/gu, "历史来源暂不可用")
    .replace(/SOURCE_HTTP\b/gu, "数据源暂不可用")
    .replace(/(?:ETIMEDOUT|ECONNRESET|TIMEOUT)/gu, "连接超时或中断"))
    .join("；") || (snapshot?.sourceStatus?.industries === false ? "行业来源暂不可用" : "");
}

function scanBatchDelta(previous, next) {
  const prior = previous?.scanCoverage ?? {};
  const current = next?.scanCoverage ?? {};
  const before = previous?.scanProgress ?? {};
  const after = next?.scanProgress ?? {};
  const delta = {
    histories: Math.max(0, (current.historyAvailable ?? 0) - (prior.historyAvailable ?? 0)),
    announcements: Math.max(0, (after.announcementAvailable ?? 0) - (before.announcementAvailable ?? 0)),
    sectors: Math.max(0, (after.completedSectors ?? 0) - (before.completedSectors ?? 0)),
    members: Math.max(0, (current.sectorMembers ?? 0) - (prior.sectorMembers ?? 0)),
  };
  const processed = (value) => (value?.sectors ?? []).filter((sector) => sector.scan && sector.scan.state !== "pending").length;
  const progressed = Object.values(delta).some((value) => value > 0)
    || processed(next) > processed(previous)
    || (current.historyFailed ?? 0) > (prior.historyFailed ?? 0)
    || (after.announcementFailed ?? 0) > (before.announcementFailed ?? 0)
    || (current.historyPending ?? 0) < (prior.historyPending ?? 0)
    || (after.announcementPending ?? 0) < (before.announcementPending ?? 0)
    || Boolean(after.batch && (after.batch.memberCompleted || after.batch.historyRequests || after.batch.announcementChecked));
  return { ...delta, progressed, elapsedMs: next.elapsedMs };
}

function selectionResultsFingerprint(value) {
  if (!value) return "";
  // Collection timestamps and cache accounting alone do not change the cards.
  return JSON.stringify(value, (key, item) => ["generatedAt", "updatedAt", "observedAt", "elapsedMs", "historyCacheHits", "historyNetworkLoads", "nextRetryAt", "batch"].includes(key) ? undefined : item);
}

function chinaClockInstant(date, minutes) {
  return Date.parse(`${date}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00+08:00`);
}

function nextOpeningAt(now) {
  const clock = chinaMarketClock(now);
  for (let offset = 0; offset < 8; offset += 1) {
    const day = new Date(`${clock.date}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + offset);
    if ([0, 6].includes(day.getUTCDay())) continue;
    const at = chinaClockInstant(day.toISOString().slice(0, 10), 9 * 60 + 35);
    if (at > now.getTime()) return at;
  }
  return now.getTime() + 24 * 60 * 60 * 1_000;
}

// Absolute deadlines prevent repeated Host visibility/context events from
// indefinitely restarting the refresh interval. The provider verifies actual
// trading days; this weekday clock only schedules bounded probes.
export function selectionFreshnessRefreshAt(snapshot, nowInput = new Date(), lastAttemptAt = null) {
  const now = new Date(nowInput);
  const clock = chinaMarketClock(now);
  const attempted = Number.isFinite(lastAttemptAt) ? lastAttemptAt : 0;
  const generated = Number.isFinite(Date.parse(snapshot?.generatedAt)) ? Date.parse(snapshot.generatedAt) : 0;
  const observed = Math.max(generated, attempted);
  if (!snapshot) return observed ? Math.max(now.getTime(), observed + SOURCE_RETRY_MS) : now.getTime();
  // Old versions saved source failures as finished, empty scans. Probe those
  // once into the current retry contract, including outside trading sessions.
  const legacySourceFailure = snapshot.selectionSummary == null
    && snapshot.sourceStatus?.industries === false
    && snapshot.sectors?.length === 0
    && snapshot.scanProgress?.state === "partial"
    && snapshot.scanProgress.hasMore === false
    && snapshot.scanProgress.nextRetryAt == null;
  if (legacySourceFailure) return Math.max(now.getTime(), observed + SOURCE_RETRY_MS);
  const closeProbe = chinaClockInstant(clock.date, 15 * 60 + 12);
  const openProbe = nextOpeningAt(now);
  if (!clock.weekday) return openProbe;
  const minutes = clock.minutes;
  const needsClose = snapshot.marketDate !== clock.date || snapshot.session?.provisional === true;
  if (minutes >= 15 * 60 + 12 && minutes < 17 * 60 && needsClose) {
    const due = observed < closeProbe ? now.getTime() : Math.max(now.getTime(), observed + SOURCE_RETRY_MS);
    return due < chinaClockInstant(clock.date, 17 * 60) ? due : openProbe;
  }
  if (minutes >= 15 * 60 && minutes < 15 * 60 + 12) return closeProbe;
  if (minutes >= 11 * 60 + 30 && minutes < 13 * 60) return chinaClockInstant(clock.date, 13 * 60);
  if (clock.open && minutes < 15 * 60) {
    const due = Math.max(now.getTime(), observed + REFRESH_MS);
    if (minutes < 11 * 60 + 30 && due > chinaClockInstant(clock.date, 11 * 60 + 30)) return chinaClockInstant(clock.date, 13 * 60);
    return Math.min(due, closeProbe);
  }
  return openProbe;
}

function csvCell(value) {
  if (value == null) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRow(values) {
  return values.map(csvCell).join(",");
}

function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatAmount(value) {
  if (!Number.isFinite(value)) return "—";
  return `${(value / 100_000_000).toFixed(value >= 10_000_000_000 ? 0 : 1)} 亿`;
}

function formatClock(value, withDate = false) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    ...(withDate ? { month: "2-digit", day: "2-digit" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function selectionProcessError(stderr, exit = {}) {
  const lines = String(stderr).trim().split(/\r?\n/u).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      const message = cleanText(parsed?.message, 300);
      const signal = `${cleanText(parsed?.errorCode, 80)} ${message}`;
      if (/403|429|456|rate.?limit|too many requests|请求频率|限流/iu.test(signal)) return "选股数据源触发频率限制，请稍后再试";
      if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|UND_ERR|network|socket|TLS/iu.test(signal)) return "选股数据源暂时连接失败，请稍后重试";
      if (/timeout|ETIMEDOUT|超时/iu.test(signal)) return "选股数据源响应超时，请稍后重试";
      if (message) return message;
    } catch {
      // Fall through to a plain text line.
    }
  }
  const fallback = cleanText(lines.find((line) => /(?:Error|Exception):\s*\S/iu.test(line)) ?? lines[0], 300);
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|UND_ERR|network|socket|TLS/iu.test(fallback)) {
    return "选股数据源暂时连接失败，请稍后重试";
  }
  if (fallback) return fallback;
  if (exit.signal) return `选股任务已中断（${cleanText(exit.signal, 30)}），请重新打开面板后重试`;
  return `选股程序异常退出（退出码 ${Number.isInteger(exit.code) ? exit.code : "未知"}），未收到具体错误，请重试`;
}

function eventRow(event) {
  const button = element("button", "selection-event");
  button.type = "button";
  button.dataset.selectionUrl = event.url;
  button.dataset.importance = event.importance;
  button.append(
    element("span", "selection-event-kind", event.label),
    element("b", "", event.title),
    element("time", "", formatClock(event.publishedAt, true)),
  );
  return button;
}

export function createAShareSelectionController({
  hostCall,
  onHostEvent,
  storageKey,
  dataSources = () => null,
  currentEpoch,
  now = () => new Date(),
  notify = () => undefined,
  onDiagnose = () => undefined,
  onStockDirectory = () => undefined,
  onUpdate = () => undefined,
  elements,
}) {
  let snapshot = null;
  let watch = parseSelectionWatchStorage(null);
  let loading = false;
  let active = false;
  let backgroundWatchActive = false;
  let restored = false;
  let selectedSectorId = null;
  let sectorView = "priority";
  let sectorQuery = "";
  let sectorSort = "composite";
  let sectorPage = 0;
  let scanPaused = false;
  let scanContinuing = false;
  let lastAttemptAt = null;
  let continuationRetryAt = null;
  let continuationErrorReason = "";
  let noProgressBatches = 0;
  let automaticPauseReason = "";
  let lastBatch = null;
  let nextBatchAt = null;
  let watchRefreshPending = false;
  let watchFilter = "all";
  let technologyVisible = false;
  let runtime = null;
  let timer = null;
  let activeProcessId = null;
  let generation = 0;
  const processRecords = new Map();
  const finalizedProcessIds = new Set();

  function recordFor(processId) {
    const existing = processRecords.get(processId);
    if (existing) return existing;
    const created = { stdout: "", stderr: "", exit: null, resolve: null };
    processRecords.set(processId, created);
    return created;
  }

  function finalizeProcess(processId) {
    processRecords.delete(processId);
    finalizedProcessIds.add(processId);
    if (finalizedProcessIds.size > 64) finalizedProcessIds.delete(finalizedProcessIds.values().next().value);
  }

  const unsubscribeOutput = onHostEvent?.("process.output", (payload) => {
    const processId = typeof payload?.processId === "string" ? payload.processId : "";
    if (!processId || finalizedProcessIds.has(processId) || !["stdout", "stderr"].includes(payload?.stream) || typeof payload?.text !== "string") return;
    const record = recordFor(processId);
    record[payload.stream] += payload.text;
    if (record.stdout.length + record.stderr.length > MAX_PROCESS_OUTPUT_CHARS) {
      record.stderr += "\n选股输出超过安全上限";
      void hostCall("process.cancel", { processId }).catch(() => undefined);
    }
  });
  const unsubscribeExit = onHostEvent?.("process.exit", (payload) => {
    const processId = typeof payload?.processId === "string" ? payload.processId : "";
    if (!processId || finalizedProcessIds.has(processId)) return;
    const record = recordFor(processId);
    record.exit = { code: payload?.code, signal: payload?.signal };
    record.resolve?.(record);
  });

  function clearTimer() {
    if (timer != null) window.clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    clearTimer();
    if (!canMaintain() || document.visibilityState === "hidden" || loading || scanPaused || !restored) return;
    if (watchRefreshPending) {
      timer = window.setTimeout(() => { timer = null; void refresh({ watchChanged: true }).catch(() => undefined); }, 0);
      return;
    }
    if (active && runtime?.persistent && snapshot?.scanProgress?.hasMore) {
      if (nextBatchAt == null) nextBatchAt = now().getTime() + CONTINUATION_DELAY_MS;
      const dueAt = Math.max(automaticRetryAt(), nextBatchAt);
      const delay = Math.max(0, dueAt - now().getTime());
      timer = window.setTimeout(() => {
        timer = null;
        if (active && document.visibilityState !== "hidden" && !scanPaused) void refresh({ continuation: true });
      }, Math.min(delay, 2_147_483_647));
      return;
    }
    const dueAt = Math.max(selectionFreshnessRefreshAt(snapshot, now(), lastAttemptAt), automaticRetryAt());
    timer = window.setTimeout(() => {
      timer = null;
      if (canMaintain() && document.visibilityState !== "hidden" && !scanPaused) void refresh();
    }, Math.min(Math.max(0, dueAt - now().getTime()), 2_147_483_647));
  }

  function canMaintain() {
    return active || (backgroundWatchActive && (watch.stocks.length > 0 || watch.sectors.length > 0));
  }

  function freshnessNeedsRefresh() {
    if (snapshot?.scanProgress?.hasMore && automaticRetryAt() > now().getTime()) return false;
    return watchRefreshPending || selectionFreshnessRefreshAt(snapshot, now(), lastAttemptAt) <= now().getTime();
  }

  function automaticRetryAt() {
    const serverRetryAt = Date.parse(snapshot?.scanProgress?.nextRetryAt ?? "");
    return Math.max(Number.isFinite(serverRetryAt) ? serverRetryAt : 0, continuationRetryAt ?? 0);
  }

  function currentDisplayPhase() {
    return displayedAShareSessionPhase(snapshot, now());
  }

  function hasUnfinishedClose() {
    return ["intraday", "settling", "close-pending"].includes(currentDisplayPhase());
  }

  function encodedWatch() {
    const priorityFirst = (items) => [...items].sort((a, b) => Number(b.priority === "focus") - Number(a.priority === "focus"));
    return encodeURIComponent(JSON.stringify({ sectors: priorityFirst(watch.sectors), stocks: priorityFirst(watch.stocks) }));
  }

  function cacheScope() {
    const match = /\.([0-9a-f]{16})$/u.exec(storageKey());
    return match?.[1] ?? "global";
  }

  async function ensureRuntime() {
    if (runtime) return runtime;
    if (typeof onHostEvent !== "function") throw new Error("今日选股需在 CodeShell 投资工作台内运行");
    let selected = null;
    for (const spec of RUNTIME_SPECS) {
      const executable = await hostCall("process.find", { name: spec.name }).catch(() => null);
      if (executable?.available && typeof executable.handle === "string") {
        selected = { executable, spec };
        break;
      }
    }
    if (!selected) throw new Error("未发现 Node.js 或 Bun，无法运行本机只读选股程序");
    let directory = null;
    let persistent = false;
    try {
      directory = await hostCall("filesystem.getKnownDirectory", { name: "app-data" });
      persistent = true;
    } catch {
      directory = await hostCall("filesystem.getKnownDirectory", { name: "downloads" });
    }
    if (typeof directory?.handle !== "string") throw new Error("无法取得受限的选股运行目录");
    runtime = {
      executableHandle: selected.executable.handle,
      directoryHandle: directory.handle,
      name: selected.spec.name,
      persistent,
    };
    return runtime;
  }

  function waitForExit(processId) {
    const record = recordFor(processId);
    if (record.exit) return Promise.resolve(record);
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        record.resolve = null;
        void hostCall("process.cancel", { processId }).catch(() => undefined);
        reject(new Error("今日选股刷新超时，已停止本次任务"));
      }, PROCESS_TIMEOUT_MS);
      record.resolve = (next) => {
        window.clearTimeout(timeout);
        record.resolve = null;
        resolve(next);
      };
    });
  }

  async function fetchSnapshot(mode = "refresh", { continuation = false } = {}) {
    const fetchGeneration = generation;
    const handles = await ensureRuntime();
    if (fetchGeneration !== generation) throw new Error("扫描已暂停");
    if (mode === "read-local" && !handles.persistent) throw new Error("当前 CodeShell 不支持面板本地数据目录");
    const runtimeMode = mode === "read-local"
      ? "read-local"
      : handles.persistent
        ? continuation ? "continue-local" : "refresh-local"
        : "refresh-volatile";
    const started = await hostCall("process.spawn", {
      executableHandle: handles.executableHandle,
      directoryHandle: handles.directoryHandle,
      args: selectionRuntimeArgs(handles.name, encodedWatch(), cacheScope(), runtimeMode, dataSources() ? encodeURIComponent(JSON.stringify(dataSources())) : ""),
    });
    if (typeof started?.processId !== "string") throw new Error("选股程序未能启动");
    const processId = started.processId;
    if (fetchGeneration !== generation) {
      void hostCall("process.cancel", { processId }).catch(() => undefined);
      finalizeProcess(processId);
      throw new Error("扫描已暂停");
    }
    activeProcessId = processId;
    let record;
    try {
      record = await waitForExit(processId);
    } finally {
      if (activeProcessId === processId) activeProcessId = null;
      finalizeProcess(processId);
    }
    if (record.exit?.code !== 0) throw new Error(selectionProcessError(record.stderr, record.exit));
    return parseAShareSelectionSnapshot(record.stdout);
  }

  function sessionMode() {
    const displayPhase = displayedAShareSessionPhase(snapshot, now());
    if (["settling", "close-pending"].includes(displayPhase)) {
      const settling = displayPhase === "settling";
      return {
        phase: displayPhase,
        eyebrow: settling ? "CLOSE SETTLEMENT · WAIT & VERIFY" : "CLOSE SNAPSHOT PENDING · WAIT & VERIFY",
        title: settling ? "今日选股结果 · 收盘结算中" : "今日选股结果 · 等待完整收盘",
        summary: "保留最后盘中快照 → 等待完整收盘 → 再确认板块与个股时机",
        sectorTitle: "收盘前最后主题",
        sectorSummary: "当前仍是最后盘中样本；完整收盘快照通过校验前不生成收盘确认。",
        watchTitle: "我的收盘待确认",
        watchSummary: settling ? "15:00–15:10 汇总最终成交，15:10 后自动重验。" : "完整收盘快照尚未通过校验，可稍后手动重试。",
        refresh: "重试收盘数据",
      };
    }
    if (displayPhase === "intraday") {
      return {
        phase: "intraday",
        eyebrow: "INTRADAY · WATCH & VERIFY",
        title: "今日盘中选股",
        summary: "实时强弱 → 板块扩散 → 盘中触发 → 公告新闻 → 等待收盘确认",
        sectorTitle: "盘中强势主题",
        sectorSummary: "看扩散和持续性；盘中涨幅不等于收盘确认。",
        watchTitle: "我的盘中关注",
        watchSummary: "只看状态变化；机会标签需在收盘后重新核验。",
        refresh: "刷新盘中观察",
      };
    }
    if (displayPhase === "previous-close") {
      return {
        phase: "previous-close",
        eyebrow: "OFF HOURS · LAST CLOSE",
        title: "最近收盘选股结果",
        summary: "最近收盘 → 板块代表股 → 等待买点 → 时机确认 → 下一交易日重验",
        sectorTitle: "最近收盘主题",
        sectorSummary: "当前不是交易时段，以最近完整收盘作为研究基线。",
        watchTitle: "我的长期关注",
        watchSummary: "整理原因、失效条件和下一交易日需要验证的变化。",
        refresh: "读取最近收盘",
      };
    }
    return {
      phase: "close",
      eyebrow: "AFTER CLOSE · REVIEW & PLAN",
      title: "今日选股结果",
      summary: "完整收盘 → 板块代表股 → 等待买点 → 时机确认 → 公告新闻核验",
      sectorTitle: "收盘确认主题",
      sectorSummary: "用完整日线核验持续性、拥挤度与新闻证据。",
      watchTitle: "我的长期关注",
      watchSummary: "按收盘状态复核趋势、风险与失效条件。",
      refresh: "生成收盘复盘",
    };
  }

  function renderSessionMode() {
    if (!snapshot) return;
    const mode = sessionMode();
    elements.root.dataset.session = mode.phase;
    elements.modeEyebrow.textContent = mode.eyebrow;
    elements.title.textContent = mode.title;
    elements.workbenchSummary.textContent = mode.summary;
    elements.sectorTitle.textContent = mode.sectorTitle;
    elements.sectorSummary.textContent = mode.sectorSummary;
    elements.watchTitle.textContent = mode.watchTitle;
    elements.watchSummary.textContent = mode.watchSummary;
    elements.refresh.textContent = loading && !scanContinuing ? "正在生成…" : mode.refresh;
  }

  function renderLimitLadder() {
    if (!elements.limitLadder) return;
    const ladder = snapshot?.market?.limitLadder;
    const hasRows = Boolean(ladder?.tiers?.length || ladder?.brokenStocks?.length);
    elements.limitLadder.dataset.state = hasRows ? "ready" : "empty";
    elements.limitLadderSummary.textContent = ladder
      ? `${ladder.sampleSize} 只样本 · ${ladder.provisional ? "盘中变化中" : "收盘口径"}`
      : "等待选股快照";
    const metricRows = ladder ? [
      ["最高板", ladder.maxBoards ? `${ladder.maxBoards} 板` : "0"],
      ["样本封板", `${ladder.sealed} 只`],
      ["样本炸板", `${ladder.broken} 只`],
      ["晋级率", ladder.promotionRate == null ? "—" : `${Math.round(ladder.promotionRate * 100)}%`],
    ] : [["最高板", "—"], ["样本封板", "—"], ["样本炸板", "—"], ["晋级率", "—"]];
    elements.limitLadderMetrics.replaceChildren(...metricRows.map(([label, value]) => {
      const row = element("div", "");
      row.append(element("dt", "", label), element("dd", "", value));
      return row;
    }));
    elements.limitLadderTiers.replaceChildren();
    for (const tier of ladder?.tiers ?? []) {
      const group = element("article", "market-limit-tier");
      group.dataset.boards = String(tier.boards);
      const head = element("header", "");
      head.append(element("strong", "", tier.label), element("span", "", `${tier.stocks.length} 只${tier.stocks.length > 12 ? " · 展示前 12 只" : ""}`));
      const list = element("div", "");
      for (const stock of tier.stocks.slice(0, 12)) {
        const button = element("button", "market-limit-stock");
        button.type = "button";
        button.dataset.selectionDiagnose = `${stock.symbol} ${stock.name}`;
        const identity = element("span", "");
        identity.append(element("b", "", stock.name), element("small", "", `${stock.symbol} · ${stock.sectorName}`));
        button.append(identity, element("strong", "", formatPercent(stock.changePercent)));
        list.append(button);
      }
      group.append(head, list);
      elements.limitLadderTiers.append(group);
    }
    if (!ladder?.tiers?.length) elements.limitLadderTiers.append(element("p", "", "本轮行业样本没有封板股票。"));
    elements.limitLadderBroken.replaceChildren();
    for (const stock of ladder?.brokenStocks ?? []) {
      const button = element("button", "");
      button.type = "button";
      button.dataset.selectionDiagnose = `${stock.symbol} ${stock.name}`;
      const copy = element("span", "");
      copy.append(element("b", "", stock.name), element("small", "", `${stock.sectorName} · 前序 ${stock.previousBoards} 板`));
      button.append(copy, element("strong", "", formatPercent(stock.changePercent)));
      elements.limitLadderBroken.append(button);
    }
    if (!ladder?.brokenStocks?.length) elements.limitLadderBroken.append(element("p", "", "本轮样本没有触板未封记录。"));
    elements.limitLadderDisclosure.textContent = ladder?.disclosure || "样本梯队不等于全市场涨停统计。";
  }

  function renderSectorRotation() {
    if (!elements.rotation) return;
    const rotation = snapshot?.market?.rotationMatrix;
    const dates = rotation?.dates ?? [];
    const rows = rotation?.rows ?? [];
    elements.rotation.dataset.state = dates.length >= 2 && rows.length ? "ready" : "empty";
    elements.rotationSummary.textContent = dates.length
      ? `${dates.length} 个交易日 · ${rows.length} 个行业`
      : "等待历史快照";
    elements.rotationGrid.replaceChildren();
    if (!dates.length || !rows.length) {
      elements.rotationGrid.append(element("p", "market-sector-rotation-empty", "连续保存至少 2 个收盘快照后，这里显示行业强弱迁移。"));
      elements.rotationDisclosure.textContent = rotation?.methodology || "轮动历史只使用当日已保存行业快照。";
      return;
    }
    const table = element("div", "market-sector-rotation-table");
    table.style.setProperty("--rotation-days", String(dates.length));
    const head = element("div", "market-sector-rotation-row is-head");
    head.append(element("span", "", "行业 / 趋势"));
    for (const date of dates) head.append(element("span", "", date.slice(5).replace("-", "/")));
    table.append(head);
    const trendLabel = { rising: "升温", falling: "降温", stable: "横盘", insufficient: "样本少" };
    for (const item of rows) {
      const row = element("button", "market-sector-rotation-row");
      row.type = "button";
      row.dataset.sectorId = item.id;
      const identity = element("span", "market-sector-rotation-name");
      identity.dataset.trend = item.trend;
      identity.append(
        element("b", "", item.name),
        element("small", "", `${trendLabel[item.trend]}${item.delta == null ? "" : ` ${item.delta > 0 ? "+" : ""}${item.delta.toFixed(1)}`}`),
      );
      row.append(identity);
      for (const cell of item.cells) {
        const node = element("span", "market-sector-rotation-cell");
        node.dataset.level = !cell.available ? "missing" : cell.score >= 70 ? "hot" : cell.score >= 58 ? "warm" : cell.score >= 45 ? "range" : "cool";
        node.title = cell.available ? `${cell.stageLabel} · 第 ${cell.rank} 名 · ${cell.score.toFixed(1)} 分` : "当日未进入研究行业样本";
        node.append(
          element("b", "", cell.available ? cell.score.toFixed(0) : "—"),
          element("small", "", cell.available ? cell.stageLabel : "未覆盖"),
        );
        row.append(node);
      }
      table.append(row);
    }
    elements.rotationGrid.append(table);
    elements.rotationDisclosure.textContent = rotation.methodology;
  }

  function displayedSignal(state, fallback) {
    if (["intraday", "settling", "close-pending"].includes(displayedAShareSessionPhase(snapshot, now()))) {
      return {
        opportunity: "盘中偏强",
        waiting: "等待收盘",
        risk: "盘中转弱",
        unavailable: "数据不足",
      }[state] ?? fallback;
    }
    if (snapshot?.session.phase === "previous-close") {
      return {
        opportunity: "最近收盘确认",
        waiting: "继续观察",
        risk: "风险升高",
        unavailable: "数据不足",
      }[state] ?? fallback;
    }
    return fallback;
  }

  function renderMarket() {
    if (!snapshot) {
      elements.marketState.textContent = "读取中";
      elements.marketReason.textContent = "选股快照就绪后给出今天是否适合继续选股。";
      elements.marketBreadth.textContent = "—";
      elements.marketLimits.textContent = "—";
      elements.marketLimit.textContent = "—";
      if (elements.environmentCard) {
        elements.environmentCard.dataset.state = "loading";
        elements.environmentStrength.textContent = "读取中";
        elements.environmentScore.textContent = "—";
        elements.environmentPhase.textContent = "样本积累中";
        elements.environmentPhaseReason.textContent = "正在核对市场历史与情绪梯队。";
        elements.environmentDimensions.replaceChildren();
        elements.environmentTimeline.replaceChildren();
        elements.environmentMainlines.replaceChildren(element("p", "market-environment-empty", "正在识别市场主线…"));
        elements.environmentMainlineHistory?.replaceChildren();
      }
      renderLimitLadder();
      renderSectorRotation();
      return;
    }
    elements.marketState.textContent = `${snapshot.market.label} · ${snapshot.market.score}`;
    elements.marketState.dataset.state = snapshot.market.state;
    const displayPhase = currentDisplayPhase();
    elements.marketReason.textContent = displayPhase === "settling"
      ? `${snapshot.market.reason} 交易已结束但最终成交仍在汇总，15:10 后再计算完整收盘。`
      : displayPhase === "close-pending"
        ? `${snapshot.market.reason} 当前仍是最后盘中快照，等待完整收盘数据。`
        : displayPhase === "intraday"
          ? `${snapshot.market.reason} 当前排名尚未定型，收盘后会重新计算。`
      : displayPhase === "previous-close"
        ? `${snapshot.market.reason} 当前使用最近完整收盘。`
        : `${snapshot.market.reason} 已使用完整收盘重新核验。`;
    const breadth = snapshot.market.breadth;
    elements.marketBreadth.textContent = `${breadth.up.toLocaleString("zh-CN")} / ${breadth.down.toLocaleString("zh-CN")}`;
    elements.marketLimits.textContent = `${breadth.limitUp} / ${breadth.limitDown}`;
    elements.marketLimit.textContent = snapshot.market.candidateLimit === 0 ? "0 · 今日可空" : `${snapshot.market.candidateLimit} 个板块`;
    if (!elements.environmentCard) return;
    const environment = snapshot.market;
    elements.environmentCard.dataset.state = environment.state;
    elements.environmentStrength.textContent = environment.label;
    elements.environmentStrength.dataset.state = environment.state;
    elements.environmentScore.textContent = `${environment.score} / 100`;
    elements.environmentReason.textContent = environment.reason;
    elements.environmentPhase.textContent = environment.phase.available
      ? `${environment.phase.label} · 第 ${environment.phase.duration} 日`
      : environment.phase.label;
    elements.environmentPhase.dataset.state = environment.phase.state;
    elements.environmentPhaseReason.textContent = environment.phase.reason;
    const phaseMetrics = environment.phase.metrics ?? {};
    const metricRows = environment.phase.available ? [
      ["高度", `${phaseMetrics.maxConsecutive ?? 0}板`],
      ["首板", `${phaseMetrics.firstBoard ?? 0}只`],
      ["二板+", `${phaseMetrics.ge2Count ?? 0}只`],
      ["晋级", Number.isFinite(phaseMetrics.promotionRate) ? `${Math.round(phaseMetrics.promotionRate * 100)}%` : "—"],
      ["封板", Number.isFinite(phaseMetrics.sealRate) ? `${Math.round(phaseMetrics.sealRate * 100)}%` : "—"],
      ["梯队", Number.isFinite(phaseMetrics.ladderCompleteness) ? `${Math.round(phaseMetrics.ladderCompleteness * 100)}%` : "—"],
    ] : [];
    elements.environmentPhaseMetrics.replaceChildren(...metricRows.map(([label, value]) => {
      const row = element("div");
      row.append(element("dt", "", label), element("dd", "", value));
      return row;
    }));
    elements.environmentPhaseMetrics.hidden = metricRows.length === 0;
    elements.environmentDimensions.replaceChildren(...environment.dimensions.map((dimension) => {
      const row = element("article", "market-environment-dimension");
      row.dataset.level = dimension.value >= 67 ? "strong" : dimension.value < 44 ? "weak" : "range";
      const header = element("header");
      header.append(element("span", "", dimension.label), element("strong", "", String(dimension.value)));
      const meter = element("i", "market-environment-meter");
      meter.style.setProperty("--score", `${dimension.value}%`);
      row.append(header, meter, element("small", "", dimension.evidence));
      return row;
    }));
    elements.environmentTimeline.replaceChildren(...environment.phase.timeline.map((item) => {
      const chip = element("span", "market-environment-timeline-item");
      chip.dataset.state = item.state;
      chip.title = item.date;
      chip.textContent = item.label;
      return chip;
    }));
    if (!environment.phase.timeline.length) {
      elements.environmentTimeline.append(element("span", "market-environment-timeline-empty", `${environment.historyDays} 个市场日`));
    }
    elements.environmentMainlines.replaceChildren(...environment.mainlines.map((item) => {
      const row = element("button", "market-environment-mainline");
      row.type = "button";
      row.dataset.sectorId = item.id;
      row.dataset.role = item.role;
      row.append(
        element("span", "", item.roleLabel),
        element("b", "", item.name),
        element("strong", "", String(Math.round(item.score))),
        element("small", "", `${item.stageLabel} · ${item.methodLabel} · ${item.evidence[0] || item.risk}`),
      );
      return row;
    }));
    if (!environment.mainlines.length) {
      elements.environmentMainlines.append(element("p", "market-environment-empty", "当前没有通过样本门槛的主线板块。"));
    }
    if (elements.environmentMainlineHistory) {
      const history = environment.mainlineHistory ?? [];
      elements.environmentMainlineHistory.hidden = history.length < 2;
      elements.environmentMainlineHistory.replaceChildren();
      if (history.length >= 2) {
        elements.environmentMainlineHistory.append(element("span", "", "主线轨迹"));
        for (const item of history) {
          const chip = element("span", "market-environment-mainline-history-item");
          chip.dataset.state = item.duration > 1 ? "continuing" : "rotated";
          chip.title = `${item.date} · ${item.methodLabel} · ${item.score} 分`;
          chip.append(
            element("i", "", item.date.slice(5).replace("-", "/")),
            element("b", "", item.sectorName),
            element("em", "", item.duration > 1 ? `${item.duration}日` : "切换"),
          );
          elements.environmentMainlineHistory.append(chip);
        }
      }
    }
    renderLimitLadder();
    renderSectorRotation();
  }

  function renderTechnologyHotspots() {
    elements.technologyPanel.hidden = !technologyVisible;
    elements.technologyAction.setAttribute("aria-expanded", String(technologyVisible));
    elements.technologyAction.textContent = technologyVisible ? "收起科技热点" : "追踪科技热点";
    if (!technologyVisible) return;
    const hotspots = snapshot?.technologyHotspots;
    const topics = hotspots?.topics ?? [];
    elements.technologyList.replaceChildren();
    elements.technologyCount.textContent = `${topics.length} 个主题`;
    elements.technologySummary.textContent = hotspots
      ? `近 ${hotspots.windowHours} 小时公开资讯 → 科技主题词 → 关联行业 → 行业内高流动性代表股`
      : "正在等待本轮公开资讯与行业样本。";
    elements.technologyDisclaimer.textContent = hotspots?.disclaimer || "热点只用于缩小研究范围；行业关联不代表公司真实受益，也不是买入建议。";
    if (!snapshot) {
      elements.technologyList.append(element("p", "selection-empty", "正在生成包含科技热点的选股快照…"));
      return;
    }
    if (!topics.length) {
      elements.technologyList.append(element(
        "p",
        "selection-empty",
        `近 ${hotspots.windowHours} 小时没有同时通过来源校验与科技主题词匹配的公开资讯；系统不会用涨幅榜补成热点。`,
      ));
      return;
    }
    for (const topic of topics) {
      const card = element("article", "technology-hotspot-card");
      const header = element("header", "technology-hotspot-card-head");
      const heading = element("div", "");
      heading.append(
        element("span", "", `${topic.newsCount} 条资讯 · 最新 ${formatClock(topic.latestAt, true)}`),
        element("h4", "", topic.label),
      );
      header.append(heading, element("strong", "", `线索强度 ${topic.heatScore.toFixed(0)}`));
      const keywords = element("div", "technology-hotspot-keywords");
      for (const keyword of topic.keywords) keywords.append(element("span", "", keyword));
      const evidence = element("section", "technology-hotspot-evidence");
      evidence.append(element("h5", "", "资讯证据"));
      for (const news of topic.news) evidence.append(eventRow(news));
      const sectors = element("section", "technology-hotspot-sectors");
      sectors.append(element("h5", "", "匹配行业"));
      if (topic.sectors.length) {
        const sectorList = element("div", "");
        for (const sector of topic.sectors) {
          const item = element("button", "technology-hotspot-sector");
          item.type = "button";
          item.dataset.selectionSector = sector.id;
          item.title = sector.matchBasis;
          item.append(
            element("b", "", sector.name),
            element("span", "", `${sector.stageLabel} · 当日 ${formatPercent(sector.changePercent)} · 20 日 ${formatPercent(sector.return20Median)}`),
          );
          sectorList.append(item);
        }
        sectors.append(sectorList);
      } else {
        sectors.append(element("p", "selection-event-empty", "资讯主题已识别，但本轮行业样本没有可靠匹配，暂不列股票。"));
      }
      const stocks = element("section", "technology-hotspot-stocks");
      stocks.append(element("h5", "", "相关股票 · 行业样本匹配"));
      if (topic.stocks.length) {
        const stockList = element("div", "");
        for (const stock of topic.stocks) {
          const item = element("article", "technology-hotspot-stock");
          const identity = element("div", "");
          identity.append(element("b", "", stock.name), element("span", "", `${stock.symbol} · ${stock.sectorName}`));
          const metrics = element("div", "technology-hotspot-stock-metrics");
          metrics.append(
            element("span", "", `当日 ${formatPercent(stock.changePercent)}`),
            element("span", "", `20日 ${formatPercent(stock.metrics.return20)}`),
            element("span", "", `距MA20 ${formatPercent(stock.metrics.extension20)}`),
            element("span", "", `量比 ${stock.metrics.volumeRatio.toFixed(2)}`),
          );
          const action = element("button", "", "查看个股");
          action.type = "button";
          action.dataset.selectionDiagnose = `${stock.symbol} ${stock.name}`;
          item.append(identity, metrics, element("small", "", stock.matchBasis), action);
          stockList.append(item);
        }
        stocks.append(stockList);
      } else {
        stocks.append(element("p", "selection-event-empty", "当前没有取得足够历史的关联行业代表股，不用涨幅榜替代。"));
      }
      card.append(header, keywords, evidence, sectors, stocks);
      elements.technologyList.append(card);
    }
  }

  function recommendedSectors() {
    return snapshot?.sectors.filter((sector) => sector.recommended) ?? [];
  }

  function selectedSector() {
    return snapshot?.sectors.find((sector) => sector.id === selectedSectorId) ?? null;
  }

  function revealFunnel() {
    if (elements.funnelDetails) elements.funnelDetails.open = true;
  }

  function researchPicks() {
    if (!snapshot) return [];
    const rows = snapshot.sectors
      .filter((sector) => ["advancing", "expansion", "emerging"].includes(sector.stage) && (!snapshot.scanProgress || sector.recommended))
      .flatMap((sector) => uniqueStocks([...sector.candidates, ...sector.timingQueue]).map((candidate) => ({ sector, candidate })))
      .filter(({ candidate }) => {
        const chase = candidate.changePercent >= (candidate.symbol.startsWith("SZ3") || candidate.symbol.startsWith("SH68") ? 15 : 7.5);
        return candidate.state !== "risk" &&
          candidate.setup.id !== "announcement-risk-review" &&
          !candidate.events.some((event) => event.importance === "risk") &&
          candidate.patternEvidence.status !== "risk" &&
          (candidate.patternEvidence.jValue == null || candidate.patternEvidence.jValue < 80) &&
          !candidate.patternEvidence.risks.some((item) => item.includes("最大成交量出现在阴线")) &&
          candidate.turnover <= 12 &&
          (candidate.pe == null || candidate.pe > 0) &&
          (candidate.pb == null || candidate.pb <= 15) &&
          !chase &&
          candidate.metrics.return60 >= 3;
      })
      .map(({ sector, candidate }) => {
        const extension = candidate.metrics.extension20;
        const strict = extension >= -3 && extension <= 8 &&
          candidate.metrics.return20 > 0 && candidate.metrics.volumeRatio >= 0.75 &&
          (!candidate.patternEvidence.available || candidate.patternEvidence.score >= 55);
        const readiness = Math.max(0, Math.min(100,
          candidate.relativeScore +
          (sector.recommended ? 10 : 0) +
          (extension >= -3 && extension <= 6 ? 16 : Math.max(-18, 8 - Math.abs(extension - 3) * 2)) +
          (candidate.metrics.volumeRatio >= 0.8 ? 6 : -6) +
          (candidate.metrics.return20 > 0 ? 5 : -8) -
          (candidate.patternEvidence.available ? (50 - candidate.patternEvidence.score) * 0.18 : 0) -
          candidate.risks.length * 2,
        ));
        return { sector, candidate, strict, readiness: Math.round(readiness) };
      })
      .filter(({ candidate }) => candidate.metrics.extension20 >= -5 && candidate.metrics.extension20 <= 12)
      .sort((left, right) =>
        Number(right.strict) - Number(left.strict) ||
        right.readiness - left.readiness ||
        left.candidate.symbol.localeCompare(right.candidate.symbol),
      );
    const symbols = new Set();
    return rows.filter(({ candidate }) => {
      if (symbols.has(candidate.symbol)) return false;
      symbols.add(candidate.symbol);
      return true;
    }).slice(0, 5);
  }

  function renderPicks() {
    elements.picksList.replaceChildren();
    elements.picksTableBody?.replaceChildren();
    const picks = researchPicks();
    elements.picksCount.textContent = `${picks.length} 只`;
    elements.picksSummary.textContent = hasUnfinishedClose()
      ? "当前仍按最后盘中快照展示研究顺序；完整收盘数据通过校验后重新确认。"
      : "从优先板块中挑选位置、趋势、量能和公告风险更适合继续研究的股票，并与严格时机确认分开。";
    if (!picks.length) {
      if (elements.picksCompare) {
        elements.picksCompare.hidden = true;
        elements.picksCompare.open = false;
      }
      elements.picksList.append(element("p", "selection-empty", snapshot
        ? snapshot.selectionSummary?.reason || (snapshot.sourceStatus.industries === false ? "行业数据源暂不可用，尚未完成板块与个股扫描；这不是已扫描后的 0 只确认。" : "当前没有股票同时通过趋势、位置、估值异常、追高和公告风险过滤；等待条件改善，不用高位股填满推荐。")
        : "正在计算板块内研究优先级…"));
      const observations = uniqueStocks((snapshot?.sectors ?? []).flatMap((sector) => sector.timingQueue)
        .concat((snapshot?.sectors ?? []).flatMap((sector) => sector.representatives)))
        .filter((candidate) => candidate.state === "waiting" && candidate.lastBarDate);
      if (snapshot?.scanProgress?.completedSectors === 0 && observations.length) {
        const preview = element("section", "selection-observation-preview");
        preview.append(element("h4", "", "已取得数据 · 继续观察"), element("p", "",
          `完整行业尚为 0；先展示当前快照中的 ${Math.min(6, observations.length)} 只观察股。${snapshot.selectionSummary?.observedStocks ? `全池共 ${snapshot.selectionSummary.observedStocks} 只处于观察状态，快照保留部分明细。` : ""}行业成分、个股条件和公告仍需逐项核验。`));
        for (const candidate of observations.slice(0, 6)) {
          const row = renderStockRow(candidate, "observation");
          const sector = snapshot.sectors.find((item) => item.id === candidate.sectorId);
          row.append(element("p", "selection-observation-condition", `行业待满足：${sector?.selectionReason || sector?.scan?.reason || "等待完整行业成分核验"}`));
          preview.append(row);
        }
        elements.picksList.append(preview);
      }
      if (snapshot?.sectors.length) {
        const actions = element("div", "selection-pick-actions");
        const openAll = element("button", "", snapshot.selectionSummary?.observedStocks > 0 ? "查看观察池 · 全部板块" : "查看全部板块");
        openAll.type = "button";
        openAll.addEventListener("click", () => {
          revealFunnel();
          sectorQuery = "";
          if (elements.sectorSearch) elements.sectorSearch.value = "";
          const observedSector = snapshot.sectors.find((sector) => sector.timingQueue.length || sector.representatives.length);
          rememberSelectedSector(observedSector?.id ?? snapshot.sectors[0].id);
          switchSectorView("all");
          renderCandidates();
          elements.funnelDetails?.scrollIntoView?.({ behavior: "smooth", block: "start" });
        });
        actions.append(openAll);
        elements.picksList.append(actions);
      }
      return;
    }
    if (elements.picksCompare) elements.picksCompare.hidden = false;
    for (const [index, { sector, candidate, strict, readiness }] of picks.entries()) {
      if (elements.picksTableBody) {
        const row = element("tr", "");
        const stockCell = element("td", "selection-pick-table-identity");
        const stock = element("button", "", "");
        stock.type = "button";
        stock.dataset.selectionDiagnose = `${candidate.symbol} ${candidate.name}`;
        stock.append(
          element("b", "", candidate.name),
          element("small", "", `${String(index + 1).padStart(2, "0")} · ${candidate.symbol} · ${sector.name}`),
        );
        stockCell.append(stock);
        const values = [
          [strict ? "优先核验" : "观察优先", strict ? "near" : "watch"],
          [formatPercent(candidate.changePercent), candidate.changePercent >= 0 ? "positive" : "negative"],
          [formatPercent(candidate.metrics.return20), candidate.metrics.return20 >= 0 ? "positive" : "negative"],
          [formatPercent(candidate.metrics.return60), candidate.metrics.return60 >= 0 ? "positive" : "negative"],
          [deviationDisplay(candidate.abnormalDeviation), ["triggered", "edge"].includes(candidate.abnormalDeviation.state) ? "watch" : "neutral"],
          [formatPercent(candidate.metrics.extension20), Math.abs(candidate.metrics.extension20) <= 8 ? "neutral" : "watch"],
          [candidate.metrics.volumeRatio.toFixed(2), candidate.metrics.volumeRatio >= 0.75 ? "neutral" : "watch"],
          [candidate.patternEvidence.available ? candidate.patternEvidence.score.toFixed(0) : "—", "neutral"],
          [`${readiness}/100`, strict ? "near" : "neutral"],
          [candidate.risks[0] ?? candidate.setup.trigger, "risk"],
        ];
        row.append(stockCell);
        for (const [value, tone] of values) {
          const cell = element("td", "", value);
          cell.dataset.tone = tone;
          row.append(cell);
        }
        elements.picksTableBody.append(row);
      }
      const card = element("article", "selection-pick-card");
      card.dataset.level = strict ? "near" : "watch";
      const header = element("header", "");
      const identity = element("div", "");
      identity.append(
        element("i", "", String(index + 1).padStart(2, "0")),
        element("span", "", `${sector.name} · ${candidate.symbol}`),
        element("h4", "", candidate.name),
      );
      header.append(identity, element("strong", "", strict ? "优先核验" : "观察优先"));
      const metrics = element("dl", "selection-pick-metrics");
      for (const [label, value] of [
        ["当日", formatPercent(candidate.changePercent)],
        ["20 / 60 日", `${formatPercent(candidate.metrics.return20)} / ${formatPercent(candidate.metrics.return60)}`],
        ["异动偏离", deviationDisplay(candidate.abnormalDeviation)],
        ["距 MA20", formatPercent(candidate.metrics.extension20)],
        ["量比", candidate.metrics.volumeRatio.toFixed(2)],
      ]) {
        const row = element("div", "");
        row.append(element("dt", "", label), element("dd", "", value));
        metrics.append(row);
      }
      const reason = element("p", "selection-pick-reason", `${candidate.setup.label} · ${candidate.support[1] ?? candidate.setup.trigger}`);
      const pattern = element(
        "p",
        "selection-pick-pattern",
        candidate.patternEvidence.available
          ? `四维形态 ${candidate.patternEvidence.score.toFixed(0)}/100 · ${candidate.patternEvidence.position} · 非上涨概率`
          : "四维形态证据等待长期历史补齐",
      );
      const next = element("p", "selection-pick-next");
      next.append(
        element("span", "", "下一步核验"),
        element("b", "", candidate.risks[0] ?? candidate.setup.trigger),
        element("small", "", `研究优先度 ${readiness}/100 · 不是上涨概率`),
      );
      const actions = element("div", "selection-pick-actions");
      const follow = element("button", "", watch.stocks.some((item) => item.symbol === candidate.symbol) ? "已关注" : "加入关注");
      follow.type = "button";
      follow.dataset.selectionFollowStock = candidate.symbol;
      follow.dataset.selectionStockName = candidate.name;
      follow.disabled = watch.stocks.some((item) => item.symbol === candidate.symbol);
      const open = element("button", "selection-primary-action", "了解公司");
      open.type = "button";
      open.dataset.selectionDiagnose = `${candidate.symbol} ${candidate.name}`;
      actions.append(follow, open);
      card.append(header, metrics, reason, pattern, next, actions);
      elements.picksList.append(card);
    }
  }

  function renderFocus() {
    const sector = recommendedSectors()[0] ?? snapshot?.sectors.find((item) => item.watched) ?? null;
    if (!sector) {
      elements.focusStage.textContent = snapshot ? "今日无优先主题" : "等待评估";
      elements.focusChange.textContent = "—";
      delete elements.focusChange.dataset.tone;
      elements.focusName.textContent = snapshot ? "保留现金与观察清单" : "正在计算主线";
      elements.focusSummary.textContent = snapshot
        ? "没有板块同时通过市场、趋势、宽度和拥挤过滤，不为了填满页面强行推荐。"
        : "会结合 20 / 60 日趋势、板块宽度、拥挤度与新闻证据。";
      elements.focusNews.textContent = snapshot
        ? "本轮没有形成可验证的主线证据"
        : "等待板块新闻与成分股证据…";
      elements.focusAction.disabled = true;
      delete elements.focusAction.dataset.focusSector;
      return;
    }
    elements.focusStage.textContent = [sector.recommendationLabel, sector.stageLabel].filter(Boolean).join(" · ");
    elements.focusChange.textContent = formatPercent(sector.metrics.changePercent);
    elements.focusChange.dataset.tone = sector.metrics.changePercent > 0
      ? "up"
      : sector.metrics.changePercent < 0
        ? "down"
        : "flat";
    elements.focusName.textContent = sector.name;
    elements.focusSummary.textContent = [
      `20 日 ${formatPercent(sector.metrics.return20Median)}`,
      `板块宽度 ${sector.metrics.above20Ratio == null ? "—" : formatPercent(sector.metrics.above20Ratio * 100, 0)}`,
      `相对强度 ${sector.relativeScore.toFixed(1)}`,
    ].join(" · ");
    elements.focusNews.textContent = sector.catalysts[0]?.title ?? "未匹配近 36 小时行业新闻，不能据此判断没有催化";
    elements.focusAction.disabled = false;
    elements.focusAction.dataset.focusSector = sector.id;
  }

  function renderSectors() {
    elements.sectorList.replaceChildren();
    const listing = selectionSectorPage(snapshot?.sectors ?? [], { view: sectorView, query: sectorView === "all" ? sectorQuery : "", sort: sectorSort, page: sectorPage });
    sectorPage = listing.page;
    const sectors = listing.rows;
    elements.sectorCount.textContent = `${listing.total} 个`;
    elements.sectorViewPriority?.setAttribute("aria-pressed", String(sectorView === "priority"));
    elements.sectorViewAll?.setAttribute("aria-pressed", String(sectorView === "all"));
    if (elements.sectorFilters) elements.sectorFilters.hidden = sectorView !== "all";
    if (elements.sectorPagination) elements.sectorPagination.hidden = sectorView !== "all" || listing.pages <= 1;
    if (elements.sectorPageLabel) elements.sectorPageLabel.textContent = `第 ${listing.page + 1} / ${listing.pages} 页 · 共 ${listing.total} 个`;
    if (elements.sectorPrevious) elements.sectorPrevious.disabled = listing.page === 0;
    if (elements.sectorNext) elements.sectorNext.disabled = listing.page + 1 >= listing.pages;
    if (sectorView === "all") {
      elements.sectorTitle.textContent = "全部行业板块";
      elements.sectorSummary.textContent = "完整排名只纳入已完成行业；未扫描板块也可打开查看原因。每页 20 个只限制展示，不限制后台扫描。";
    } else if (snapshot?.scanProgress?.hasMore) {
      elements.sectorSummary.textContent = "当前已完成板块中的暂定排序；全部行业扫描结束后会重新比较，优先研究数量仍受市场环境约束。";
    }
    if (sectors.length === 0) {
      elements.sectorList.append(element("p", "selection-empty", snapshot
        ? sectorView === "all" && sectorQuery ? "没有匹配名称的板块，请调整搜索。" : snapshot.selectionSummary?.reason || (snapshot.sourceStatus.industries === false ? "行业数据源中断，目录和成分尚未完成扫描。已取得的数据保留，等待数据源恢复。" : "今日没有同时通过市场、持续性和拥挤过滤的板块；系统不会为了填满页面降低标准。")
        : "正在计算板块趋势与新闻催化…"));
      return;
    }
    for (const [index, sector] of sectors.entries()) {
      const button = element("button", "selection-sector-item");
      button.type = "button";
      button.dataset.selectionSector = sector.id;
      button.setAttribute("aria-pressed", String(sector.id === selectedSectorId));
      const heading = element("span", "selection-sector-heading");
      heading.append(
        element("i", "", sectorView === "all" ? sector.rank == null ? "—" : String(sector.rank).padStart(2, "0") : String(index + 1).padStart(2, "0")),
        element("b", "", sector.name),
        element("em", `selection-stage is-${sector.stage}`, sectorView === "all" ? scanStateLabel(sector.scan) : sector.stageLabel),
      );
      const metrics = element("span", "selection-sector-metrics");
      metrics.append(
        element("span", "", sectorView === "all" ? `当日 ${formatPercent(sector.metrics.changePercent)}` : `20日 ${formatPercent(sector.metrics.return20Median)}`),
        element("span", "", `宽度 ${sector.metrics.above20Ratio == null ? "—" : formatPercent(sector.metrics.above20Ratio * 100, 0)}`),
        element("span", "", sector.scan && sector.scan.state !== "complete" ? "时机 —" : `时机 ${hasUnfinishedClose() ? 0 : sector.poolCounts.confirmed}`),
      );
      const catalyst = sectorView === "all"
        ? `${sector.recommended ? "优先研究" : "非优先研究"} · ${sector.selectionReason || sector.scan?.reason || "旧快照未提供全行业推荐原因"}`
        : sector.catalysts[0]?.title ?? "未匹配到近 36 小时行业新闻";
      button.append(heading, metrics, element("small", sectorView === "all" ? "selection-sector-reason" : "", catalyst));
      elements.sectorList.append(button);
    }
  }

  function renderCandidate(candidate) {
    const article = element("article", "selection-candidate");
    article.dataset.state = candidate.state;
    const header = element("header", "selection-candidate-head");
    const identity = element("div", "");
    identity.append(element("h4", "", candidate.name), element("span", "", `${candidate.symbol} · 板块第 ${candidate.rank}`));
    header.append(
      identity,
      element("strong", `selection-signal is-${candidate.state}`, displayedSignal(candidate.state, candidate.stateLabel)),
    );
    const setup = element("div", "selection-setup-strip");
    setup.dataset.status = candidate.setup.status;
    setup.append(
      element("span", "", "策略"),
      element("b", "", candidate.setup.label),
      element("p", "", candidate.setup.trigger),
    );
    const metrics = element("dl", "selection-stock-metrics");
    for (const [label, value] of [
      ["最新", candidate.price.toFixed(2)],
      ["当日", formatPercent(candidate.changePercent)],
      ["20 / 60 日", `${formatPercent(candidate.metrics.return20)} / ${formatPercent(candidate.metrics.return60)}`],
      ["异动偏离", deviationDisplay(candidate.abnormalDeviation)],
      ["量比", candidate.metrics.volumeRatio.toFixed(2)],
      ["换手", formatPercent(candidate.turnover)],
      ["PE / PB", `${candidate.pe == null ? "—" : candidate.pe.toFixed(1)} / ${candidate.pb == null ? "—" : candidate.pb.toFixed(1)}`],
    ]) {
      const row = element("div", "");
      row.append(element("dt", "", label), element("dd", "", value));
      metrics.append(row);
    }
    const pattern = element("section", "selection-pattern-evidence");
    pattern.dataset.status = candidate.patternEvidence.status;
    const patternHeader = element("header", "");
    const patternHeading = element("div", "");
    patternHeading.append(
      element("span", "", "四维形态证据 · 非上涨概率"),
      element("b", "", candidate.patternEvidence.label),
    );
    patternHeader.append(
      patternHeading,
      element("strong", "", candidate.patternEvidence.available ? `${candidate.patternEvidence.score.toFixed(0)}/100` : "待补齐"),
    );
    const patternGrid = element("div", "selection-pattern-grid");
    for (const component of candidate.patternEvidence.components) {
      const item = element("article", "");
      item.title = component.summary;
      item.append(
        element("span", "", component.label),
        element("b", "", component.score.toFixed(0)),
        element("small", "", component.summary),
      );
      patternGrid.append(item);
    }
    pattern.append(patternHeader, patternGrid);
    if (candidate.patternEvidence.risks.length) {
      pattern.append(element("p", "", `需核验：${candidate.patternEvidence.risks[0]}`));
    }
    const evidence = element("div", "selection-evidence-grid");
    const support = element("section", "selection-evidence-column");
    support.append(element("h5", "", "支持证据"));
    const supportList = element("ul", "");
    for (const item of candidate.support) supportList.append(element("li", "", item));
    support.append(supportList);
    const risks = element("section", "selection-evidence-column is-risk");
    risks.append(element("h5", "", "反方与风险"));
    const riskList = element("ul", "");
    for (const item of candidate.risks) riskList.append(element("li", "", item));
    risks.append(riskList);
    evidence.append(support, risks);
    const events = element("div", "selection-event-list");
    if (candidate.events.length) {
      events.append(element("h5", "", hasUnfinishedClose() ? "收盘前公告与新闻" : "公告与新闻"));
      for (const event of candidate.events) events.append(eventRow(event));
    } else {
      events.append(element("p", "selection-event-empty", "本次未取得可匹配公告或个股新闻；不能据此判断没有事件。"));
    }
    const footer = element("footer", "selection-candidate-footer");
    footer.append(element("p", "", `失效条件：${candidate.invalidation}`));
    const actions = element("div", "");
    const follow = element("button", "", watch.stocks.some((item) => item.symbol === candidate.symbol) ? "已关注" : "加入关注");
    follow.type = "button";
    follow.dataset.selectionFollowStock = candidate.symbol;
    follow.dataset.selectionStockName = candidate.name;
    follow.disabled = watch.stocks.some((item) => item.symbol === candidate.symbol);
    const diagnose = element("button", "selection-primary-action", "打开个股");
    diagnose.type = "button";
    diagnose.dataset.selectionDiagnose = `${candidate.symbol} ${candidate.name}`;
    actions.append(follow, diagnose);
    footer.append(actions);
    article.append(header, setup, metrics, pattern,
      renderSelectionResearchEvidence(candidate, snapshot?.researchEvidence, {
        element, marketDate: snapshot?.marketDate, provisional: snapshot?.session.provisional,
      }),
      evidence, events, footer);
    return article;
  }

  function renderStockRow(candidate, kind) {
    const article = element("article", "selection-stock-row");
    article.dataset.state = candidate.state;
    article.dataset.kind = kind;
    const identity = element("div", "selection-stock-row-identity");
    identity.append(
      element("b", "", candidate.name),
      element("span", "", kind === "observation" ? `${candidate.symbol} · ${candidate.sectorName} · 日线 ${candidate.lastBarDate}` : `${candidate.symbol} · 板块第 ${candidate.rank}`),
    );
    const status = element(
      "strong",
      `selection-signal is-${candidate.state}`,
      kind === "observation" ? "继续观察" : kind === "representative" ? "仅代表股" : displayedSignal(candidate.state, candidate.stateLabel),
    );
    const metrics = element("div", "selection-stock-row-metrics");
    metrics.append(
      element("span", "", `当日 ${formatPercent(candidate.changePercent)}`),
      element("span", "", `20日 ${formatPercent(candidate.metrics.return20)}`),
      element("span", "", deviationDisplay(candidate.abnormalDeviation)),
      element("span", "", `距MA20 ${formatPercent(candidate.metrics.extension20)}`),
      element("span", "", `量比 ${candidate.metrics.volumeRatio.toFixed(2)}`),
      element("span", "", candidate.patternEvidence.available ? `形态 ${candidate.patternEvidence.score.toFixed(0)}` : "形态 —"),
    );
    const waiting = ["waiting", "observation"].includes(kind);
    const explanation = waiting
      ? element("section", "selection-stock-row-reasons")
      : element("p", "selection-stock-row-reason");
    if (waiting) {
      const reasonHeading = element("div", "selection-stock-row-reasons-heading");
      reasonHeading.append(
        element("b", "", "为什么还在等待"),
        element("span", "", `观察策略：${candidate.setup.label}`),
      );
      const reasonList = element("ol", "");
      for (const [index, reason] of waitingReasonLines(candidate).entries()) {
        const item = element("li", "");
        item.append(
          element("i", "", `原因 ${index + 1}`),
          element("span", "", reason),
        );
        reasonList.append(item);
      }
      explanation.append(reasonHeading, reasonList);
    } else {
      explanation.append(
        element("b", "", candidate.setup.label),
        document.createTextNode(` · ${candidate.setup.trigger}`),
      );
    }
    const actions = element("div", "selection-stock-row-actions");
    const follow = element("button", "", watch.stocks.some((item) => item.symbol === candidate.symbol) ? "已关注" : "关注");
    follow.type = "button";
    follow.dataset.selectionFollowStock = candidate.symbol;
    follow.dataset.selectionStockName = candidate.name;
    follow.disabled = watch.stocks.some((item) => item.symbol === candidate.symbol);
    const open = element("button", "selection-primary-action", "了解公司");
    open.type = "button";
    open.dataset.selectionDiagnose = `${candidate.symbol} ${candidate.name}`;
    actions.append(follow, open);
    article.append(identity, status, metrics, explanation, actions,
      renderSelectionResearchEvidence(candidate, snapshot?.researchEvidence, {
        element, marketDate: snapshot?.marketDate, provisional: snapshot?.session.provisional, compact: true,
      }));
    return article;
  }

  function uniqueStocks(items) {
    const symbols = new Set();
    return items.filter((item) => {
      if (symbols.has(item.symbol)) return false;
      symbols.add(item.symbol);
      return true;
    });
  }

  function sectorPools(sector) {
    const confirmed = hasUnfinishedClose() ? [] : sector.candidates;
    const waiting = hasUnfinishedClose()
      ? uniqueStocks([...sector.timingQueue, ...sector.candidates])
      : sector.timingQueue;
    return { representatives: sector.representatives, waiting, confirmed };
  }

  function appendPoolGroup({ step, title, summary, items, empty, renderItem }) {
    const section = element("section", "selection-pool-group");
    const header = element("header", "selection-pool-head");
    const heading = element("div", "");
    heading.append(element("span", "", step), element("h4", "", title));
    header.append(heading, element("small", "", `${items.length} 只`));
    section.append(header, element("p", "selection-pool-description", summary));
    const list = element("div", "selection-pool-list");
    if (items.length === 0) list.append(element("p", "selection-empty", empty));
    else for (const item of items) list.append(renderItem(item));
    section.append(list);
    elements.candidateList.append(section);
  }

  function renderSectorDetail(sector) {
    const detail = element("article", "selection-sector-detail");
    const breadcrumb = element("div", "selection-sector-breadcrumb");
    breadcrumb.append(
      element("span", "", "A股市场"),
      element("i", "", "›"),
      element("span", "", sector.name),
      element("i", "", "›"),
      element("b", "", "成分与策略"),
      element("i", "", "›"),
      element("span", "", "个股详情"),
    );
    const heading = element("header", "");
    const title = element("div", "");
    title.append(element("h4", "", `${sector.name}板块详情`), element("p", "", `${sector.recommendationLabel} · ${sector.stageLabel} · ${sector.scan && sector.scan.state !== "complete" ? "完整排名 —" : `相对强度 ${sector.relativeScore.toFixed(1)}`}`));
    heading.append(title, element("strong", `selection-stage is-${sector.stage}`, sector.stageLabel));
    const metrics = element("dl", "selection-sector-detail-metrics");
    for (const [label, value] of [
      ["当日", formatPercent(sector.metrics.changePercent)],
      ["20日中位", formatPercent(sector.metrics.return20Median)],
      ["样本涨停", `${sector.metrics.limitUpCount} 只`],
      ["最高连板", `${sector.metrics.maxBoards} 板`],
      ["梯队完整", formatPercent(sector.metrics.ladderCompleteness * 100, 0)],
      ["样本 / 成分", `${sector.metrics.sampleSize} / ${sector.metrics.constituentCount ?? "—"}`],
    ]) {
      const row = element("div", "");
      row.append(element("dt", "", label), element("dd", "", value));
      metrics.append(row);
    }
    const evidence = element("div", "selection-sector-detail-evidence");
    const support = element("section", "");
    support.append(element("h5", "", "板块证据"));
    for (const item of sector.evidence) support.append(element("p", "", item));
    const risks = element("section", "");
    risks.append(element("h5", "", "板块反方"));
    for (const item of sector.risks) risks.append(element("p", "", item));
    evidence.append(support, risks);
    const catalysts = element("div", "selection-sector-catalysts");
    if (sector.catalysts.length) {
      catalysts.append(element("h5", "", "公告与新闻线索"));
      for (const event of sector.catalysts) catalysts.append(eventRow(event));
    } else {
      catalysts.append(element("p", "selection-event-empty", "近 36 小时未匹配到板块新闻；不能据此判断没有催化。"));
    }
    detail.append(breadcrumb, heading, metrics, evidence, catalysts);
    if (sector.scan) {
      detail.append(element("p", "selection-sector-scan-detail", `${scanStateLabel(sector.scan)} · ${sector.scan.reason || sector.selectionReason}；已核对 ${sector.scan.historyAvailable} / ${sector.scan.eligibleCount} 只，待扫描 ${sector.scan.historyPending} 只，失败 ${sector.scan.historyFailed} 只。${snapshot?.scanProgress?.hasMore ? scanPaused ? "扫描已暂停，可继续剩余批次。" : "剩余批次将在本页继续补齐。" : sector.scan.state !== "complete" ? "本轮已尝试完毕，可手动刷新重试失败项。" : ""}`));
    }
    if (sector.gateCounts) {
      const gates = sector.gateCounts;
      detail.append(element("p", "selection-sector-scan-detail", `全成分过滤：已分析 ${gates.analyzed} · 历史不足 ${gates.historyUnavailable} · 趋势未过 ${gates.trendBlocked} · 策略等待 ${gates.strategyWaiting} · 技术就绪 ${gates.technicalReady} · 市场条件未过 ${gates.marketBlocked} · 公告待核验 ${gates.announcementPending} · 公告风险 ${gates.announcementRisk} · 板块条件未过 ${gates.sectorBlocked} · 全池确认 ${gates.confirmed}。过滤原因可能重叠，展示卡片数量不等于全池数量。`));
    }
    return detail;
  }

  function renderCandidates() {
    elements.candidateList.replaceChildren();
    const sector = selectedSector();
    if (!sector) {
      elements.candidateTitle.textContent = "板块内个股";
      elements.candidateSummary.textContent = snapshot?.market.candidateLimit === 0
        ? "当前市场闸门为退潮，系统没有强行生成股票候选。"
        : "选择左侧板块后查看候选、公告和新闻证据。";
      elements.followSector.hidden = true;
      elements.candidateList.append(element("p", "selection-empty", "当前没有可展示的板块成分与时机数据。"));
      return;
    }
    elements.candidateTitle.textContent = `板块内个股 · ${sector.name}`;
    const pools = sectorPools(sector);
    const unfinished = hasUnfinishedClose();
    const displayPhase = currentDisplayPhase();
    const intraday = displayPhase === "intraday";
    elements.candidateSummary.textContent = unfinished
      ? intraday
        ? `${pools.waiting.length} 只盘中触发或等待 · 0 只收盘确认 · 收盘前不确认长期时机`
        : `${pools.waiting.length} 只收盘前触发或等待 · 0 只收盘确认 · 完整收盘前不确认长期时机`
      : displayPhase === "previous-close"
        ? `${pools.representatives.length} 只代表股 · ${pools.waiting.length} 只等待时机 · ${pools.confirmed.length} 只最近收盘确认 · 开盘后重验`
        : `${pools.representatives.length} 只代表股 · ${pools.waiting.length} 只等待时机 · ${pools.confirmed.length} 只收盘时机确认 · 用于次日研究计划`;
    elements.candidateSummary.textContent += "；确认仅指量价条件，财报与现金流尚待核验。";
    elements.followSector.hidden = false;
    const alreadyFollowed = watch.sectors.some((item) => item.id === sector.id);
    elements.followSector.disabled = alreadyFollowed;
    elements.followSector.textContent = alreadyFollowed ? "已关注板块" : "关注此板块";
    elements.candidateList.append(renderSectorDetail(sector));
    const funnel = element("div", "selection-pool-summary");
    for (const [label, value, tone] of [
      ["高流动性样本", sector.metrics.sampleSize, "neutral"],
      ["板块代表股", pools.representatives.length, "neutral"],
      [unfinished ? intraday ? "盘中待确认" : "收盘前待确认" : "等待买点", pools.waiting.length, "waiting"],
      [unfinished ? "收盘确认" : "时机确认", pools.confirmed.length, "confirmed"],
    ]) {
      const item = element("div", "");
      item.dataset.tone = tone;
      item.append(element("span", "", label), element("strong", "", String(value)));
      funnel.append(item);
    }
    elements.candidateList.append(funnel);
    appendPoolGroup({
      step: "01",
      title: "板块代表股",
      summary: "只说明它们在板块样本中较强或较活跃，不代表当前可以买。",
      items: pools.representatives,
      empty: "当前没有取得足够的板块成分历史，无法生成代表股。",
      renderItem: (candidate) => renderStockRow(candidate, "representative"),
    });
    appendPoolGroup({
      step: "02",
      title: unfinished ? intraday ? "盘中触发 · 等待收盘" : "收盘前触发 · 等待完整收盘" : "等待买点",
      summary: unfinished
        ? intraday
          ? "盘中条件随价格和成交量变化，只记录触发，不进入确认区；每只股票列出最多 3 个真实未通过原因。"
          : "当前仍是最后盘中条件，只记录触发，不进入确认区；每只股票列出最多 3 个真实未通过原因。"
        : "趋势尚可，但条件还没有同时满足；每只股票按原因 1 / 2 / 3 列出真正卡住它的项目。",
      items: pools.waiting,
      empty: unfinished
        ? intraday ? "当前没有盘中触发或接近触发的个股。" : "当前没有收盘前触发或接近触发的个股。"
        : "当前没有接近策略触发的等待个股。",
      renderItem: (candidate) => renderStockRow(candidate, "waiting"),
    });
    appendPoolGroup({
      step: "03",
      title: unfinished ? "收盘时机确认" : "时机确认",
      summary: unfinished
        ? "完整收盘快照通过校验前始终保持为 0。"
        : "通过趋势、策略形态、量能、位置和追高过滤，仍须核验公告与基本面。",
      items: pools.confirmed,
      empty: unfinished
        ? intraday ? "等待收盘后重新计算；盘中不生成确认候选。" : "等待完整收盘后重新计算；最后盘中数据不生成确认候选。"
        : "该板块当前为 0 只。没有满足条件时，系统不会用强势代表股补位。",
      renderItem: renderCandidate,
    });
  }

  function renderStrategyLab() {
    const lab = snapshot?.strategyLab;
    const evidenceChanges = snapshot?.strategyEvidenceChanges;
    const factorLab = snapshot?.factorLab;
    const factors = factorLab?.factors ?? [];
    const strategies = lab?.strategies ?? [];
    const predictions = snapshot?.predictions ?? [];
    const review = snapshot?.predictionReview ?? { records: [], summary: {} };
    elements.strategyList.replaceChildren();
    elements.strategyChangesList?.replaceChildren();
    elements.predictionList.replaceChildren();
    elements.reviewList.replaceChildren();
    elements.reviewSummary.replaceChildren();
    elements.factorList.replaceChildren();
    elements.factorCorrelationList?.replaceChildren();
    elements.factorCombinationsList?.replaceChildren();
    elements.factorCount.textContent = factors.length ? `${factors.length} 项` : "0 项";
    elements.factorMeta.textContent = factorLab?.stocks
      ? `${factorLab.stocks} 只 · ${factorLab.lookbackDays} 日窗口 · T+${factorLab.horizon}`
      : "等待历史截面";
    for (const factor of factors) {
      const item = element("article", "selection-factor-card");
      item.dataset.state = factor.state;
      const head = element("header", "");
      const identity = element("div", "");
      identity.append(element("b", "", factor.label), element("small", "", factor.description));
      const stateLabel = factor.state === "supported"
        ? "方向支持"
        : factor.state === "opposite"
          ? "方向相反"
          : factor.state === "weak"
            ? "方向不稳"
            : "样本不足";
      head.append(identity, element("strong", "", stateLabel));
      const metrics = element("dl", "");
      for (const [label, value] of [
        ["Rank IC", factor.icMean == null ? "—" : factor.icMean.toFixed(3)],
        ["ICIR", factor.icIr == null ? "—" : factor.icIr.toFixed(2)],
        ["IC为正", factor.positiveIcRate == null ? "—" : `${(factor.positiveIcRate * 100).toFixed(0)}%`],
        ["多空组差", formatPercent(factor.longShortMedian)],
        ["有效截面", `${factor.days} 日`],
        ["观察值", factor.observations.toLocaleString("zh-CN")],
      ]) {
        const row = element("div", "");
        row.append(element("dt", "", label), element("dd", "", value));
        metrics.append(row);
      }
      const stability = element("section", "selection-factor-stability");
      stability.dataset.state = factor.stability.state;
      const stabilityLabels = {
        stable: "方向稳定",
        weakening: "近期衰减",
        reversing: "近期反转",
        mixed: "分段不稳",
        insufficient: "样本不足",
      };
      const stabilityHead = element("header", "");
      stabilityHead.append(
        element("span", "", "滚动稳定性"),
        element("strong", "", stabilityLabels[factor.stability.state] ?? "待核对"),
      );
      stability.append(stabilityHead);
      const windows = element("div", "selection-factor-windows");
      for (const window of factor.stability.windows) {
        const period = element("span", "");
        period.dataset.tone = window.ic == null ? "empty" : window.ic > 0 ? "positive" : window.ic < 0 ? "negative" : "neutral";
        period.append(
          element("small", "", `${window.from.slice(5).replace("-", "/")}–${window.to.slice(5).replace("-", "/")}`),
          element("b", "", `IC ${window.ic == null ? "—" : window.ic.toFixed(2)}`),
        );
        windows.append(period);
      }
      if (!factor.stability.windows.length) windows.append(element("p", "", "至少 20 个有效截面后显示分段稳定性。"));
      stability.append(windows);
      item.append(head, metrics, stability);
      elements.factorList.append(item);
    }
    if (!factors.length) elements.factorList.append(element("p", "selection-empty", "历史截面不足，暂不输出 Rank IC。"));
    const correlations = factorLab?.correlations ?? [];
    const topCorrelations = correlations
      .filter((item) => item.coefficient != null)
      .slice()
      .sort((left, right) => Math.abs(right.coefficient) - Math.abs(left.coefficient))
      .slice(0, 6);
    if (elements.factorCorrelationSummary) {
      elements.factorCorrelationSummary.textContent = factorLab?.redundancy?.pairs
        ? `${factorLab.redundancy.pairs} 组需去重`
        : topCorrelations.length
          ? "暂无稳定重复"
          : "等待截面样本";
    }
    for (const pair of topCorrelations) {
      const row = element("article", "selection-factor-correlation-row");
      row.dataset.state = pair.state;
      const identity = element("span", "");
      identity.append(element("b", "", `${pair.leftLabel} × ${pair.rightLabel}`), element("small", "", `${pair.days} 个截面 · 同号率 ${pair.sameSignRate == null ? "—" : `${(pair.sameSignRate * 100).toFixed(0)}%`}`));
      const stateLabel = pair.state === "redundant" ? "建议去重" : pair.state === "related" ? "相关" : pair.state === "distinct" ? "区分度尚可" : "样本不足";
      row.append(identity, element("strong", "", `ρ ${pair.coefficient >= 0 ? "+" : ""}${pair.coefficient.toFixed(2)}`), element("i", "", stateLabel));
      elements.factorCorrelationList?.append(row);
    }
    if (elements.factorCorrelationList && !topCorrelations.length) {
      elements.factorCorrelationList.append(element("p", "selection-empty", "至少 20 个有效截面后判断重复因子。"));
    }
    const combinations = factorLab?.combinations;
    const combinationRows = combinations?.candidates ?? [];
    if (elements.factorCombinationsPeriod) {
      elements.factorCombinationsPeriod.textContent = combinations?.trainThrough && combinations?.validateFrom
        ? `训练至 ${combinations.trainThrough} · 验证自 ${combinations.validateFrom}`
        : "前段定方向 · 后段独立复核";
    }
    if (elements.factorCombinationsSummary) {
      const supported = combinationRows.filter((item) => item.state === "supported").length;
      elements.factorCombinationsSummary.textContent = combinationRows.length
        ? `通过 ${supported} · 测试 ${combinations.testedPairs} · 去重 ${combinations.skippedRedundant}`
        : "等待截面样本";
    }
    for (const item of combinationRows) {
      const row = element("article", "selection-factor-combination-row");
      row.dataset.state = item.state;
      const identity = element("span", "");
      const direction = (value) => value > 0 ? "正向" : "反向";
      identity.append(
        element("b", "", `${item.leftLabel} × ${item.rightLabel}`),
        element("small", "", `${direction(item.leftDirection)} / ${direction(item.rightDirection)} · 训练 ${item.trainDays} 日 / 验证 ${item.validationDays} 日`),
      );
      const label = item.state === "supported" ? "样本外通过" : item.state === "watch" ? "继续观察" : item.state === "unstable" ? "样本外失效" : "样本不足";
      row.append(
        identity,
        element("strong", "", `IC ${item.trainIc == null ? "—" : item.trainIc.toFixed(2)} → ${item.validationIc == null ? "—" : item.validationIc.toFixed(2)}`),
        element("span", "", `组差 ${formatPercent(item.validationSpread)}`),
        element("i", "", label),
      );
      elements.factorCombinationsList?.append(row);
    }
    if (elements.factorCombinationsList && !combinationRows.length) {
      elements.factorCombinationsList.append(element("p", "selection-empty", "至少 28 个有效截面后开始受控双因子组合。"));
    }
    elements.factorDisclosure.textContent = factorLab?.disclosure || "因子统计仅作研究诊断，不代表策略已上线。";
    elements.strategyCount.textContent = `${strategies.length} 套`;
    if (elements.strategyChangesSummary) {
      const summary = evidenceChanges?.summary;
      elements.strategyChangesSummary.textContent = evidenceChanges?.fromMarketDate
        ? `${evidenceChanges.fromMarketDate} → ${evidenceChanges.toMarketDate} · 升 ${summary.upgraded} / 降 ${summary.downgraded} / 规则变化 ${summary.ruleChanged}`
        : "等待第二个交易日快照";
    }
    const evidenceStateLabels = { candidate: "研究候选", watch: "进入观察", caution: "证据警示", accumulating: "积累样本" };
    const changeLabels = { upgraded: "等级上调", downgraded: "等级下调", unchanged: "等级不变", new: "新增策略", "rule-changed": "规则换版" };
    const changeRank = { "rule-changed": 5, downgraded: 4, upgraded: 3, new: 2, unchanged: 1 };
    const visibleChanges = [...(evidenceChanges?.changes ?? [])]
      .filter((item) => item.kind !== "unchanged" || item.deltaT5 || item.deltaT20 || item.deltaStocks)
      .sort((left, right) => changeRank[right.kind] - changeRank[left.kind]
        || Math.abs(right.deltaT5) + Math.abs(right.deltaT20) - Math.abs(left.deltaT5) - Math.abs(left.deltaT20))
      .slice(0, 6);
    for (const change of visibleChanges) {
      const row = element("article", "selection-strategy-change-row");
      row.dataset.kind = change.kind;
      const identity = element("span", "");
      identity.append(element("b", "", change.label), element("small", "", change.strategyId));
      const states = element("span", "");
      states.append(
        element("b", "", change.fromState ? evidenceStateLabels[change.fromState] : "首次出现"),
        element("i", "", "→"),
        element("b", "", evidenceStateLabels[change.toState]),
      );
      const deltas = element("span", "");
      const signed = (value) => value > 0 ? `+${value}` : String(value);
      deltas.append(
        element("b", "", `T+5 ${signed(change.deltaT5)} · T+20 ${signed(change.deltaT20)}`),
        element("small", "", `信号 ${signed(change.deltaSignals)} · 股票 ${signed(change.deltaStocks)}`),
      );
      row.append(identity, states, deltas, element("strong", "", changeLabels[change.kind]), element("p", "", change.reason));
      elements.strategyChangesList?.append(row);
    }
    if (elements.strategyChangesList && !visibleChanges.length) {
      elements.strategyChangesList.append(element(
        "p",
        "selection-empty",
        evidenceChanges?.disclosure || "下一次完整收盘运行后，显示升级、降级及样本变化原因。",
      ));
    }
    elements.predictionCount.textContent = `${predictions.length} 条`;
    elements.reviewCount.textContent = `${review.records.length} 条`;
    elements.labSummary.textContent = snapshot
      ? `${strategies.length} 套冻结策略 · ${predictions.length} 条今日条件快照 · ${review.summary.evaluated5 ?? 0} 条已完成 T+5 复盘`
      : "用历史同策略样本回答过去表现，保存今日判断后再用真实结果复盘。";
    elements.labAssumptions.textContent = lab?.assumptions?.note
      ? "T+1 · 费用 · 滑点 · 涨跌停"
      : "等待交易约束";
    elements.labAssumptions.title = lab?.assumptions?.note ?? "";
    elements.labDisclosure.textContent = lab?.disclosure || "历史统计不等于未来收益，样本不足时不输出概率。";

    const strategyGroups = new Map();
    for (const strategy of strategies) {
      const groupKey = strategy.category || "trend";
      let group = strategyGroups.get(groupKey);
      if (!group) {
        const details = element("details", "selection-strategy-group");
        details.open = strategyGroups.size === 0;
        const summary = element("summary", "");
        const label = element("span", "");
        label.append(element("b", "", strategy.categoryLabel || "策略"), element("small", "", "查看条件与历史校准"));
        const count = element("strong", "", "0 套");
        summary.append(label, count);
        const body = element("div", "selection-strategy-group-list");
        details.append(summary, body);
        group = { details, body, count, size: 0 };
        strategyGroups.set(groupKey, group);
      }
      const card = element("article", "selection-strategy-card");
      card.dataset.state = strategy.evidence.state;
      const header = element("header", "");
      const title = element("div", "");
      title.append(
        element("b", "", strategy.label),
        element("span", "", `${strategy.categoryLabel || "策略"} · ${strategy.timeframe || "波段"} · ${strategy.assetTypes.includes("etf") ? "股票 / ETF" : "股票"}`),
        element("small", "", strategy.id),
      );
      header.append(title, element("strong", "", strategy.evidence.label));
      const results = element("dl", "");
      for (const [label, value] of [
        ["信号 / 股票", `${strategy.signals} / ${strategy.stocks}`],
        ["T+5净收益中位", formatPercent(strategy.t5.medianNetReturn)],
        ["T+5正收益比例", strategy.t5.positiveRate == null ? "—" : formatPercent(strategy.t5.positiveRate * 100, 0)],
        ["T+20净收益中位", formatPercent(strategy.t20.medianNetReturn)],
        ["T+20正收益比例", strategy.t20.positiveRate == null ? "—" : formatPercent(strategy.t20.positiveRate * 100, 0)],
        ["T+20不利波动", formatPercent(strategy.t20.medianMaxAdverse)],
      ]) {
        const row = element("div", "");
        row.append(element("dt", "", label), element("dd", "", value));
        results.append(row);
      }
      card.append(header, element("p", "", strategy.description), element("p", "selection-strategy-evidence", strategy.evidence.reason), results);
      group.body.append(card);
      group.size += 1;
      group.count.textContent = `${group.size} 套`;
    }
    elements.strategyList.append(...[...strategyGroups.values()].map((group) => group.details));
    if (!strategies.length) elements.strategyList.append(element("p", "selection-empty", "本次没有足够历史生成策略校准。"));

    for (const prediction of predictions.slice(0, 8)) {
      const card = element("article", "selection-prediction-card");
      card.dataset.bias = prediction.bias;
      const header = element("header", "");
      const identity = element("div", "");
      identity.append(element("b", "", prediction.name), element("span", "", `${prediction.symbol} · ${prediction.sectorName}`));
      header.append(identity, element("strong", "", prediction.pool === "confirmed" ? "时机确认" : "等待条件"));
      const result = element("div", "selection-prediction-result");
      result.append(
        element("b", "", prediction.setupLabel),
        element("span", "", `T+5 样本 ${prediction.calibration.sampleSize5}`),
        element("span", "", `中位 ${formatPercent(prediction.calibration.medianNetReturn5)}`),
      );
      const action = element("button", "", "了解公司");
      action.type = "button";
      action.dataset.selectionDiagnose = `${prediction.symbol} ${prediction.name}`;
      card.append(header, result, element("p", "", prediction.statement), action);
      elements.predictionList.append(card);
    }
    if (!predictions.length) elements.predictionList.append(element("p", "selection-empty", "今日没有可保存的时机或等待条件；允许为 0 条。"));

    const summary = review.summary;
    for (const [label, value] of [
      ["已保存", summary.saved ?? 0],
      ["次日收盘中位", formatPercent(summary.medianCloseReturn1)],
      ["T+5已复盘", summary.evaluated5 ?? 0],
      ["T+5中位", formatPercent(summary.medianNetReturn5)],
      ["T+20已复盘", summary.evaluated20 ?? 0],
      ["高开≥5%回看", summary.highOpenEvaluated1
        ? `${summary.chaseRisk ? "追高风险 · " : ""}${summary.highOpenEvaluated1} 次 · 日内 ${formatPercent(summary.highOpenMedianIntradayReturn1)}`
        : "暂无样本"],
    ]) {
      const item = element("div", "");
      if (label === "高开≥5%回看") item.dataset.state = summary.chaseRisk ? "risk" : "neutral";
      item.append(element("span", "", label), element("strong", "", String(value)));
      elements.reviewSummary.append(item);
    }
    for (const record of review.records.slice(0, 8)) {
      const row = element("article", "selection-review-row");
      const identity = element("div", "");
      identity.append(element("b", "", record.name), element("span", "", `${record.marketDate} · ${record.setupLabel}`));
      const values = element("div", "");
      values.append(
        element("span", "", `次日收盘 ${record.h1.state === "evaluated" ? `${formatPercent(record.h1.closeReturn)}${record.h1.openGap == null ? "" : `（开盘 ${formatPercent(record.h1.openGap)}）`}` : "待到期"}`),
        element("span", "", `T+5 ${record.h5.state === "evaluated" ? formatPercent(record.h5.returnNet) : record.h5.state === "unfilled" ? "未成交" : "待到期"}`),
        element("span", "", `T+20 ${record.h20.state === "evaluated" ? formatPercent(record.h20.returnNet) : record.h20.state === "unfilled" ? "未成交" : "待到期"}`),
      );
      row.append(identity, values);
      elements.reviewList.append(row);
    }
    if (!review.records.length) elements.reviewList.append(element("p", "selection-empty", "本地日快照积累后，会自动复核次日 / T+5 / T+20，不补写历史结果。"));
  }

  function renderSectorDirectory() {
    const previous = elements.watchSector.value;
    elements.watchSector.replaceChildren(element("option", "", "选择一个行业板块"));
    elements.watchSector.firstElementChild.value = "";
    for (const sector of snapshot?.sectorDirectory ?? []) {
      const option = element("option", "", sector.name);
      option.value = sector.id;
      option.dataset.name = sector.name;
      option.disabled = watch.sectors.some((item) => item.id === sector.id);
      elements.watchSector.append(option);
    }
    if ([...elements.watchSector.options].some((option) => option.value === previous && !option.disabled)) {
      elements.watchSector.value = previous;
    }
  }

  function watchStatus(state) {
    const labels = {
      opportunity: "时机确认",
      waiting: "等待",
      risk: "风险升高",
      unavailable: "数据不足",
    };
    return labels[state] ?? "等待";
  }

  function renderWatch() {
    elements.watchList.replaceChildren();
    elements.watchSummary.textContent = snapshot
      ? `行情截至 ${snapshot.marketDate} ${formatClock(snapshot.asOf)}；本地数据更新于 ${formatClock(snapshot.generatedAt, true)}。${scanPaused ? "全量扫描已暂停，可继续扫描更新。" : "可见时按交易时段检查更新，重点关注优先读取；休市保留最近收盘。"}`
      : "正在读取本地关注数据；缺失值会保留为空，等待数据源核验。";
    const focusCount = [...watch.sectors, ...watch.stocks].filter((item) => item.priority === "focus").length;
    elements.watchCount.textContent = `${watch.sectors.length + watch.stocks.length} 项 · ${focusCount} 重点`;
    const sectorSnapshots = new Map((snapshot?.sectors ?? []).map((item) => [item.id, item]));
    const stockSnapshots = new Map((snapshot?.watch?.stocks ?? []).map((item) => [item.symbol, item]));
    for (const sector of snapshot?.sectors ?? []) {
      for (const candidate of [...sector.representatives, ...sector.candidates, ...sector.timingQueue]) {
        if (!stockSnapshots.has(candidate.symbol)) stockSnapshots.set(candidate.symbol, candidate);
      }
    }
    const sectorRows = watch.sectors.map((sector) => {
      const live = sectorSnapshots.get(sector.id);
      const state = !live ? "unavailable" : live.stage === "retreat" ? "risk" : ["advancing", "expansion"].includes(live.stage) ? "opportunity" : "waiting";
      return {
        kind: "sector",
        value: sector,
        live,
        state,
        priority: sector.priority === "focus" ? "focus" : "normal",
        changePercent: live?.metrics?.changePercent ?? null,
      };
    });
    const stockRows = watch.stocks.map((stock) => ({
      kind: "stock",
      value: stock,
      live: stockSnapshots.get(stock.symbol),
      state: stockSnapshots.get(stock.symbol)?.state ?? "unavailable",
      priority: stock.priority === "focus" ? "focus" : "normal",
      changePercent: stockSnapshots.get(stock.symbol)?.changePercent ?? null,
    }));
    const rows = [...sectorRows, ...stockRows];
    const needsAttention = (row) => ["opportunity", "risk"].includes(row.state);
    const visible = rows.filter((row) => watchFilter === "all"
      || row.kind === watchFilter
      || (watchFilter === "focus" && row.priority === "focus")
      || (watchFilter === "attention" && needsAttention(row)));
    if (elements.watchFilters) {
      const counts = {
        all: rows.length,
        focus: rows.filter((row) => row.priority === "focus").length,
        attention: rows.filter(needsAttention).length,
        stock: stockRows.length,
        sector: sectorRows.length,
      };
      for (const button of elements.watchFilters.querySelectorAll("[data-selection-watch-filter]")) {
        button.setAttribute("aria-pressed", String(button.dataset.selectionWatchFilter === watchFilter));
        const count = button.querySelector("span");
        if (count) count.textContent = String(counts[button.dataset.selectionWatchFilter] ?? 0);
      }
    }
    const ordered = [...visible].sort((left, right) => {
      const priorityDifference = Number(right.priority === "focus") - Number(left.priority === "focus");
      if (priorityDifference) return priorityDifference;
      const attentionDifference = Number(needsAttention(right)) - Number(needsAttention(left));
      if (attentionDifference) return attentionDifference;
      return left.kind.localeCompare(right.kind);
    });
    let renderedPriority = null;
    for (const row of ordered) {
      if (["all", "stock", "sector"].includes(watchFilter) && row.priority !== renderedPriority) {
        const groupRows = ordered.filter((item) => item.priority === row.priority);
        const groupChanges = groupRows.map((item) => item.changePercent).filter(Number.isFinite);
        const averageChange = groupChanges.length
          ? groupChanges.reduce((sum, value) => sum + value, 0) / groupChanges.length
          : null;
        const advancing = groupChanges.filter((value) => value > 0).length;
        const declining = groupChanges.filter((value) => value < 0).length;
        const group = element("div", "selection-watch-group-label");
        group.dataset.priority = row.priority;
        group.append(
          element("b", "", row.priority === "focus" ? "重点关注" : "普通关注"),
          element("span", "", groupChanges.length
            ? `${groupRows.length} 项 · 平均 ${formatPercent(averageChange)} · 上涨 ${advancing} / 下跌 ${declining}`
            : `${groupRows.length} 项 · 等待行情`),
        );
        elements.watchList.append(group);
        renderedPriority = row.priority;
      }
      if (row.kind === "sector") {
        const { value: sector, live, state, priority } = row;
        const item = element("article", "selection-watch-item");
        item.dataset.state = state;
        item.dataset.priority = priority;
        const header = element("header", "");
        const identity = element("div", "");
        identity.append(element("span", "", priority === "focus" ? "重点板块" : "关注板块"), element("b", "", sector.name));
        header.append(identity, element("strong", `selection-signal is-${state}`, displayedSignal(state, watchStatus(state))));
        const reason = live
          ? `${live.stageLabel} · 20 日 ${formatPercent(live.metrics.return20Median)} · 板块宽度 ${live.metrics.above20Ratio == null ? "—" : formatPercent(live.metrics.above20Ratio * 100, 0)}`
          : "本次未取得板块成分或历史，状态不做估算。";
        const metrics = element("dl", "selection-watch-metrics");
        if (live) {
          for (const [label, value] of [
            ["今日", formatPercent(live.metrics.changePercent)],
            ["20 日", formatPercent(live.metrics.return20Median)],
            ["宽度", live.metrics.above20Ratio == null ? "—" : formatPercent(live.metrics.above20Ratio * 100, 0)],
          ]) {
            const metric = element("div", "");
            metric.append(element("dt", "", label), element("dd", "", value));
            metrics.append(metric);
          }
        }
        const remove = element("button", "selection-watch-remove", "移除");
        remove.type = "button";
        remove.dataset.selectionRemoveSector = sector.id;
        const actions = element("div", "selection-watch-actions");
        const prioritize = element("button", "selection-watch-priority", priority === "focus" ? "取消重点" : "设为重点");
        prioritize.type = "button";
        prioritize.dataset.selectionPrioritySector = sector.id;
        prioritize.setAttribute("aria-pressed", String(priority === "focus"));
        actions.append(prioritize, remove);
        item.append(header);
        if (live) item.append(metrics);
        item.append(element("p", "", reason), actions);
        elements.watchList.append(item);
        continue;
      }
      const { value: stock, live, state, priority } = row;
      const item = element("article", "selection-watch-item");
      item.dataset.state = state;
      item.dataset.priority = priority;
      const header = element("header", "");
      const identity = element("div", "");
      identity.append(element("span", "", stock.source === "portfolio" ? "持仓自动关注" : priority === "focus" ? "重点个股" : "关注个股"), element("b", "", live?.name || stock.name || stock.symbol), element("small", "", stock.symbol));
      header.append(
        identity,
        element("strong", `selection-signal is-${state}`, displayedSignal(state, live?.stateLabel || watchStatus(state))),
      );
      const actions = element("div", "selection-watch-actions");
      const prioritize = element("button", "selection-watch-priority", priority === "focus" ? "取消重点" : "设为重点");
      prioritize.type = "button";
      prioritize.dataset.selectionPriorityStock = stock.symbol;
      prioritize.setAttribute("aria-pressed", String(priority === "focus"));
      const diagnose = element("button", "", "查看数据");
      diagnose.type = "button";
      diagnose.dataset.selectionDiagnose = `${stock.symbol} ${live?.name || stock.name || ""}`.trim();
      const remove = element("button", "selection-watch-remove", "移除");
      remove.type = "button";
      remove.dataset.selectionRemoveStock = stock.symbol;
      actions.append(prioritize, diagnose, remove);
      const patternSummary = live?.patternEvidence?.available
        ? ` · 四维形态 ${live.patternEvidence.score.toFixed(0)}/100（${live.patternEvidence.label}，非上涨概率）`
        : "";
      const liveReason = live?.reason || (live?.setup
        ? `${live.setup.label}：${live.setup.trigger}。`
        : "等待下一次刷新读取个股复权历史。");
      const metrics = element("dl", "selection-watch-metrics");
      if (live?.metrics) {
        for (const [label, value] of [
          ["现价", live.price == null ? "—" : live.price.toFixed(2)],
          ["今日", formatPercent(live.changePercent)],
          ["20 日", formatPercent(live.metrics.return20)],
          ["量比", live.metrics.volumeRatio == null ? "—" : live.metrics.volumeRatio.toFixed(2)],
        ]) {
          const metric = element("div", "");
          metric.append(element("dt", "", label), element("dd", "", value));
          metrics.append(metric);
        }
      }
      item.append(header);
      if (live?.metrics) item.append(metrics);
      item.append(element("p", "", `${liveReason}${patternSummary}`));
      if (priority === "focus" && live?.invalidation) {
        item.append(element("small", "selection-watch-invalidation", `失效条件：${live.invalidation}`));
      }
      item.append(actions);
      if (live?.events?.length) {
        const event = live.events[0];
        const eventButton = eventRow(event);
        eventButton.classList.add("is-compact");
        item.append(eventButton);
      }
      elements.watchList.append(item);
    }
    if (!rows.length) {
      elements.watchList.append(element("p", "selection-empty", "还没有长期关注项。可从推荐板块或候选个股直接加入，也可手动添加。"));
    } else if (!visible.length) {
      elements.watchList.append(element("p", "selection-empty", watchFilter === "attention"
        ? "当前没有需要处理的机会或风险状态。"
        : watchFilter === "focus"
          ? "还没有重点关注项。可在任一关注卡片上选择“设为重点”。"
          : "这个分类下还没有关注项。"));
    }
    renderSectorDirectory();
  }

  function renderSources() {
    elements.sources.replaceChildren();
    if (snapshot?.industryProvider) elements.sources.append(element("p", "selection-source-warning", `行业分类：${snapshot.industryProvider.label}${snapshot.industryProvider.fallback ? "（备用源已启用）" : ""}；不同来源的行业与成分独立保存。`));
    const failures = snapshot?.sourceErrors ?? [];
    const names = { industries: "行业目录", "industry-members": "行业成分", histories: "历史行情", announcements: "公司公告", news: "新闻" };
    const seenFailures = new Set();
    for (const failure of failures) {
      const key = `${failure.source}:${failure.errorCode}`;
      if (seenFailures.has(key)) continue;
      seenFailures.add(key);
      const restricted = /403|429|456|RATE.?LIMIT/iu.test(failure.errorCode);
      elements.sources.append(element("p", "selection-source-warning",
        `${names[failure.source] ?? failure.source}：${restricted ? "数据源访问受限，等待冷却后重试" : failure.message || "暂不可用"}（${failure.errorCode || "未提供错误码"}）`));
    }
    for (const source of snapshot?.sources ?? []) {
      const button = element("button", "", source.label.split(" · ").at(-1));
      button.type = "button";
      button.dataset.selectionUrl = source.url;
      button.title = `${source.label} · ${source.asOf}`;
      elements.sources.append(button);
    }
  }

  function renderScanCoverage() {
    const coverage = snapshot?.scanCoverage ?? null;
    const progress = snapshot?.scanProgress;
    if (elements.scanToggle) {
      elements.scanToggle.hidden = !progress?.hasMore && !loading;
      elements.scanToggle.disabled = !loading && !runtime?.persistent;
      elements.scanToggle.textContent = scanPaused ? "继续扫描" : "暂停扫描";
      elements.scanToggle.setAttribute("aria-pressed", String(scanPaused));
    }
    if (elements.scanProgress) {
      elements.scanProgress.hidden = !progress;
      elements.scanProgress.textContent = progress ? scanProgressText() : "";
      elements.scanProgress.dataset.state = scanPaused ? "paused" : loading && scanContinuing ? "scanning" : automaticRetryAt() > now().getTime() ? "waiting" : progress?.hasMore ? "scheduled" : "complete";
      if (progress?.hasMore && (!loading || scanContinuing)) {
        elements.status.dataset.tone = scanPaused || automaticRetryAt() > now().getTime() ? "warning" : "active";
        elements.status.textContent = scanProgressText();
      }
    }
    elements.scanCoverage.hidden = !coverage;
    if (!coverage) return;
    const confirmed = snapshot.sectors.reduce((sum, item) => sum + item.candidates.length, 0);
    const waiting = snapshot.sectors.reduce((sum, item) => sum + item.timingQueue.length, 0);
    elements.scanMarket.textContent = `${coverage.quoteUniverse.toLocaleString("zh-CN")} 只`;
    elements.scanMarketNote.textContent = "实时行情覆盖 · 判断涨跌宽度";
    elements.scanSamples.textContent = `${coverage.historyAvailable} / ${coverage.historyRequested} 只`;
    elements.scanSamplesNote.textContent = progress
      ? `${progress.completedSectors}/${progress.totalSectors} 个行业已完成 · 历史待核验 ${coverage.historyPending} · 失败 ${coverage.historyFailed}`
      : `${coverage.researchSectors} 个研究板块 · 缺失 ${coverage.historyFailed} 只`;
    elements.scanResults.textContent = `${confirmed} 确认 · ${waiting} 等待`;
    elements.scanResultsNote.textContent = `缓存 ${coverage.historyCacheHits} · 联网补充 ${coverage.historyNetworkLoads}`;
  }

  function scanProgressText() {
    const progress = snapshot?.scanProgress;
    if (!progress) return "";
    const coverage = snapshot.scanCoverage;
    const partial = snapshot.sectors.filter((sector) => sector.scan?.state === "partial").length;
    const counts = [progress.totalSectors === 0 ? "行业目录尚未取得，行业扫描未完成"
      : `全部 ${progress.totalSectors} 个行业 · 已完成 ${progress.completedSectors} · 部分完成 ${partial} · 未完成 ${progress.pendingSectors} · 失败 ${progress.failedSectors}`,
    coverage ? `历史 ${coverage.historyAvailable}/${coverage.historyRequested} 已核验（待核验 ${coverage.historyPending}，失败 ${coverage.historyFailed}）` : "",
    progress.announcementRequested != null ? `公告 ${progress.announcementAvailable}/${progress.announcementRequested}（待核验 ${progress.announcementPending}，失败 ${progress.announcementFailed}）` : ""].filter(Boolean).join("；");
    const batch = progress.batch;
    const delta = lastBatch ? `净增可用历史 ${lastBatch.histories}、已核验公告 ${lastBatch.announcements}、完整行业 ${lastBatch.sectors}${lastBatch.members ? `，新增成分 ${lastBatch.members}` : ""}` : "";
    const work = batch ? `上批：请求 ${batch.memberRequests} 个行业成员、完成 ${batch.memberCompleted} 个；检查历史 ${batch.historyRequests}、补齐 ${batch.historyAdded}、暂未取得 ${batch.historyRejected}；公告检查 ${batch.announcementRequests}、完成 ${batch.announcementChecked}` : lastBatch ? "上批" : "";
    const last = work ? `${work}${delta ? `；${delta}` : ""}，耗时 ${((lastBatch?.elapsedMs ?? snapshot.elapsedMs) / 1_000).toFixed(1)} 秒。` : "";
    const reason = scanRetryExplanation(snapshot);
    const reasonText = reason ? `待核验原因：${reason}。` : "";
    let activity;
    if (!progress.hasMore) activity = progress.state === "partial" ? "本轮自动核验已结束，仍有缺失；手动刷新可重新核验失败项。" : "本轮扫描已完成。";
    else if (!runtime?.persistent) activity = "当前版本不支持跨批次本地续扫，请使用支持本地数据目录的 CodeShell。";
    else if (scanPaused) activity = automaticPauseReason || "已暂停，进度已保留；点击继续扫描接续剩余项。";
    else if (loading && scanContinuing) activity = "本批正在核验剩余项，完成后更新计数；已有结果继续可查看。";
    else if (automaticRetryAt() > now().getTime()) activity = `${continuationErrorReason ? `上批执行失败：${continuationErrorReason}；` : "数据源冷却中，"}将于 ${formatClock(new Date(automaticRetryAt()).toISOString(), true)} 自动重试；等待期间不发起续批请求。`;
    else if (!active || document.visibilityState === "hidden") activity = "自动续批已停止；回到本页后接续剩余项。";
    else activity = `下批 ${formatClock(new Date(nextBatchAt ?? now().getTime() + CONTINUATION_DELAY_MS).toISOString(), true)} 开始（5 秒间隔）；可随时暂停。`;
    const industryRefusal = snapshot.sourceErrors?.find((error) =>
      /^industries(?::|$)|^industry-members$/.test(error.source) && /403|429|456|THROTTL/iu.test(error.errorCode));
    const sharedWait = industryRefusal
      ? `行业数据源统一受限（${industryRefusal.errorCode}），${progress.pendingSectors + progress.failedSectors} 个行业受影响；本批实际请求 ${batch?.memberRequests ?? 0} 个行业，并非逐个反复重试。`
      : "";
    return `${sharedWait}${counts}。${last}${reasonText}${activity}`;
  }

  function selectionExportCsv() {
    if (!snapshot) throw new Error("还没有可导出的选股快照");
    const priorityBySymbol = new Map(researchPicks().map((item) => [item.candidate.symbol, item]));
    const columns = [
      "market_date", "as_of", "phase", "pool", "sector", "symbol", "name", "state", "price",
      "change_pct", "return20_pct", "return60_pct", "deviation_window_days", "deviation_pct",
      "deviation_closeness_pct", "deviation_state", "ma20_distance_pct", "volume_ratio", "turnover_pct",
      "pattern_score", "research_priority", "setup", "risk", "invalidation",
    ];
    const rows = [csvRow(columns)];
    for (const sector of snapshot.sectors) {
      for (const [pool, candidates] of [["confirmed", sector.candidates], ["waiting", sector.timingQueue]]) {
        for (const candidate of candidates) {
          const priority = priorityBySymbol.get(candidate.symbol);
          const deviation = candidate.abnormalDeviation.available
            ? candidate.abnormalDeviation.windows.find((item) => item.days === candidate.abnormalDeviation.leadingWindowDays)
            : null;
          rows.push(csvRow([
            snapshot.marketDate,
            snapshot.asOf,
            snapshot.session.phase,
            priority ? "priority" : pool,
            sector.name,
            candidate.symbol,
            candidate.name,
            candidate.stateLabel,
            candidate.price,
            candidate.changePercent,
            candidate.metrics.return20,
            candidate.metrics.return60,
            deviation?.days ?? "",
            deviation?.deviation ?? "",
            deviation?.closeness ?? "",
            candidate.abnormalDeviation.state,
            candidate.metrics.extension20,
            candidate.metrics.volumeRatio,
            candidate.turnover,
            candidate.patternEvidence.available ? candidate.patternEvidence.score : null,
            priority?.readiness ?? null,
            candidate.setup.label,
            candidate.risks[0] ?? "",
            candidate.invalidation,
          ]));
        }
      }
    }
    return `\uFEFF${rows.join("\n")}\n`;
  }

  async function exportSelection() {
    if (!snapshot || elements.export?.disabled) return;
    const epoch = currentEpoch();
    elements.export.disabled = true;
    try {
      const stamp = new Date(snapshot.generatedAt).toISOString().replace(/[^0-9]/gu, "").slice(0, 14);
      const path = `data/selection-exports/${snapshot.marketDate}-${snapshot.session.phase}-${stamp}.csv`;
      let expected = { expectedModifiedAt: null };
      try {
        const existing = await hostCall("workspace.readText", { path });
        expected = typeof existing?.revision === "string"
          ? { expectedRevision: existing.revision }
          : { expectedModifiedAt: existing?.modifiedAt ?? null };
      } catch {
        // A new export must remain create-only.
      }
      await hostCall("workspace.writeText", { path, content: selectionExportCsv(), ...expected });
      if (epoch !== currentEpoch()) return;
      notify(`今日选股结果已直接导出到 ${path}`);
    } catch (error) {
      if (epoch === currentEpoch()) notify(error instanceof Error ? error.message : "选股结果导出失败", "error");
    } finally {
      if (epoch === currentEpoch()) elements.export.disabled = loading || !snapshot;
    }
  }

  function renderActivity() {
    const blocking = loading && !scanContinuing;
    elements.root.setAttribute("aria-busy", String(blocking));
    elements.refresh.disabled = loading;
    if (elements.export) elements.export.disabled = blocking || !snapshot;
    elements.technologyAction.disabled = blocking;
    elements.root.dataset.state = blocking ? "loading" : snapshot ? "ready" : elements.status.dataset.tone === "error" ? "error" : "empty";
    elements.root.dataset.scanState = scanPaused ? "paused" : scanContinuing ? "scanning" : "idle";
    if (snapshot) elements.refresh.textContent = blocking ? "正在生成…" : sessionMode().refresh;
    renderScanCoverage();
  }

  function render() {
    renderActivity();
    const displayPhase = displayedAShareSessionPhase(snapshot, now());
    const phaseLabel = displayPhase === "settling"
      ? "收盘结算中 · 最后盘中数据"
      : displayPhase === "close-pending"
        ? "等待完整收盘 · 最后盘中数据"
        : displayPhase === "intraday"
          ? "盘中"
          : displayPhase === "previous-close"
            ? "最近收盘"
            : "收盘";
    elements.freshness.textContent = snapshot ? `${snapshot.marketDate} ${formatClock(snapshot.asOf)} · ${phaseLabel}` : "等待首份选股快照";
    elements.disclaimer.textContent = snapshot?.disclaimer || "代表股不等于可买；时机确认仍需核验基本面、公告与个人风险预算，结果可以为 0 只。";
    renderSessionMode();
    renderMarket();
    renderTechnologyHotspots();
    if (snapshot) {
      const recommended = recommendedSectors();
      if (!selectedSectorId || !snapshot.sectors.some((item) => item.id === selectedSectorId)) {
        selectedSectorId = recommended[0]?.id ?? researchPicks()[0]?.sector.id ?? snapshot.sectors.find((item) => item.watched)?.id ?? null;
      }
    } else {
      selectedSectorId = null;
    }
    renderFocus();
    renderPicks();
    renderSectors();
    renderCandidates();
    renderStrategyLab();
    renderWatch();
    renderSources();
  }

  async function saveWatch() {
    await hostCall("storage.set", { key: storageKey(), value: watch });
  }

  function rememberSelectedSector(id) {
    selectedSectorId = id;
    watch = parseSelectionWatchStorage({ ...watch, selectedSectorId: id });
    void saveWatch().catch(() => undefined);
  }

  async function updateWatch(next, message, { refreshSnapshot = true } = {}) {
    watch = parseSelectionWatchStorage(next);
    await saveWatch().catch(() => undefined);
    render();
    onUpdate(snapshot);
    notify(message);
    if (refreshSnapshot) {
      watchRefreshPending = true;
      if (!loading) void refresh({ watchChanged: true }).catch(() => undefined);
    } else schedule();
  }

  async function refresh({ manual = false, continuation = false, watchChanged = false } = {}) {
    if (loading) return snapshot;
    if (continuation && (!active || document.visibilityState === "hidden" || scanPaused || !runtime?.persistent || !snapshot?.scanProgress?.hasMore)) return snapshot;
    if (manual) {
      scanPaused = false;
      automaticPauseReason = "";
      noProgressBatches = 0;
    }
    if (!manual && !watchChanged && (scanPaused || !canMaintain() || document.visibilityState === "hidden")) return snapshot;
    if (!manual && !watchChanged && snapshot?.scanProgress?.hasMore && automaticRetryAt() > now().getTime()) {
      schedule();
      renderScanCoverage();
      return snapshot;
    }
    clearTimer();
    const loadGeneration = generation;
    const loadEpoch = currentEpoch();
    loading = true;
    scanContinuing = continuation;
    lastAttemptAt = now().getTime();
    continuationRetryAt = null;
    continuationErrorReason = "";
    nextBatchAt = null;
    watchRefreshPending = false;
    elements.status.dataset.tone = "active";
    const currentDisplayPhase = displayedAShareSessionPhase(snapshot, now());
    elements.status.textContent = continuation
      ? scanProgressText()
      : ["settling", "close-pending"].includes(currentDisplayPhase)
      ? "正在重试完整收盘数据；最后盘中快照会保留到新数据通过校验。"
      : currentDisplayPhase === "intraday"
        ? "正在刷新盘中强弱、板块扩散、公告和新闻；旧快照会保留到新数据通过校验。"
      : snapshot
        ? "正在用完整收盘刷新趋势、板块内个股、公告和新闻。"
        : "正在读取公开行情、复权历史、公司公告和财经新闻。";
    if (continuation) renderActivity();
    else render();
    let resultsChanged = !continuation;
    let accepted = false;
    try {
      const next = await fetchSnapshot("refresh", { continuation: continuation || !manual });
      if (loadGeneration !== generation || loadEpoch !== currentEpoch()) return snapshot;
      if (Date.parse(next.asOf) - now().getTime() > 60 * 60 * 1_000) throw new Error("选股行情时点晚于当前时间");
      const previous = snapshot;
      resultsChanged = !continuation || selectionResultsFingerprint(previous) !== selectionResultsFingerprint(next);
      const sameScan = previous?.marketDate === next.marketDate && previous?.session.phase === next.session.phase;
      lastBatch = previous && sameScan ? scanBatchDelta(previous, next) : null;
      if (!sameScan) noProgressBatches = 0;
      if (continuation && lastBatch) {
        noProgressBatches = lastBatch.progressed ? 0 : noProgressBatches + 1;
      }
      snapshot = next;
      accepted = true;
      if (continuation && next.scanProgress?.hasMore && noProgressBatches >= 2 && automaticRetryAt() <= now().getTime()) {
        scanPaused = true;
        automaticPauseReason = "连续 2 批未取得新增数据或处理进展，已暂停自动续批，避免重复请求。现有结果保留；可点击继续扫描再次核验。";
      }
      if (resultsChanged) onStockDirectory(next.stockDirectory);
      const localPersistence = (await ensureRuntime()).persistent;
      const degraded = Object.values(next.sourceStatus).some((available) => !available);
      elements.status.dataset.tone = degraded ? "warning" : "active";
      const nextDisplayPhase = displayedAShareSessionPhase(next, now());
      const phaseMessage = nextDisplayPhase === "settling"
        ? "交易已结束，15:00–15:10 为收盘数据汇总期；当前仍按最后盘中快照展示，不生成收盘确认。"
        : nextDisplayPhase === "close-pending"
          ? "尚未取得通过校验的完整收盘快照；当前保留最后盘中结果，不生成收盘确认。"
          : nextDisplayPhase === "intraday"
            ? "当前是盘中未完成快照，只记录触发与等待状态，收盘后才生成时机确认。"
            : nextDisplayPhase === "previous-close"
              ? `当前使用 ${next.marketDate} 最近完整收盘，用于准备下一交易日。`
              : "当前为完整收盘复盘，可用于整理次日研究计划。";
      elements.status.textContent = [
        next.selectionSummary?.reason ? `${next.selectionSummary.reason}。` : "",
        `${next.scanProgress ? `全部 ${next.scanProgress.totalSectors} 个行业，已完成 ${next.scanProgress.completedSectors} 个` : `已完成 ${next.sectors.length} 个主题方向`}、${next.sectors.reduce((sum, item) => sum + item.candidates.length, 0)} 只时机确认、${next.sectors.reduce((sum, item) => sum + item.timingQueue.length, 0)} 只等待时机，本批耗时 ${(next.elapsedMs / 1_000).toFixed(1)} 秒。`,
        next.market.candidateLimit === 0 ? "当前市场闸门允许 0 推荐。" : `系统给出 ${recommendedSectors().length} 个优先研究板块。`,
        phaseMessage,
        degraded ? "部分公告、新闻或历史源已降级，缺失数据未计入确认。" : "行情、历史、公告与新闻均已通过结构校验。",
        localPersistence
          ? "快照已保存到 CodeShell 本地数据目录，并按交易日保留复盘记录。"
          : "当前 CodeShell 版本仅保留本次会话快照。",
      ].join("");
      return next;
    } catch (error) {
      if (loadGeneration !== generation || loadEpoch !== currentEpoch()) return snapshot;
      const message = error instanceof Error ? error.message : "今日选股刷新失败";
      if (continuation) {
        continuationRetryAt = now().getTime() + SOURCE_RETRY_MS;
        continuationErrorReason = message;
      }
      elements.status.dataset.tone = snapshot ? "warning" : "error";
      elements.status.textContent = snapshot
        ? `本次刷新失败：${message}。已保留上一份通过校验的选股快照。`
        : `${message}。可点「生成今日选股」重试。`;
      if (continuation) elements.status.textContent += "自动续批将在 15 分钟后重试，也可手动立即重试。";
      if (manual) throw error;
      return snapshot;
    } finally {
      if (loadGeneration === generation && loadEpoch === currentEpoch()) {
        loading = false;
        scanContinuing = false;
        if (resultsChanged) render();
        else renderActivity();
        if (accepted && resultsChanged) onUpdate(snapshot);
        schedule();
      }
    }
  }

  function pauseScan({ userInitiated = true } = {}) {
    if (userInitiated) scanPaused = true;
    generation += 1;
    clearTimer();
    if (activeProcessId) {
      const processId = activeProcessId;
      void hostCall("process.cancel", { processId }).catch(() => undefined);
      const record = processRecords.get(processId);
      if (record && !record.exit) {
        record.exit = { code: null, signal: "cancelled" };
        record.resolve?.(record);
      }
    }
    activeProcessId = null;
    loading = false;
    scanContinuing = false;
    elements.status.dataset.tone = "warning";
    elements.status.textContent = userInitiated
      ? "扫描已暂停，已通过校验的快照保留；继续扫描会从本地进度接续。"
      : "已停止自动续批，已通过校验的快照保留。回到本页后继续剩余进度。";
    render();
  }

  function resumeScan() {
    scanPaused = false;
    automaticPauseReason = "";
    noProgressBatches = 0;
    nextBatchAt = null;
    render();
    if (snapshot?.scanProgress?.hasMore && runtime?.persistent) return refresh({ continuation: true });
    schedule();
    return Promise.resolve(snapshot);
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      clearTimer();
      // Keep the bounded in-flight batch alive so its validated snapshot can
      // be saved. Visibility only controls whether another batch is scheduled.
    } else if (canMaintain() && !loading && restored) {
      if (!scanPaused && freshnessNeedsRefresh()) void refresh();
      else schedule();
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  elements.scanToggle?.addEventListener("click", () => {
    if (scanPaused) void resumeScan();
    else pauseScan();
  });
  const switchSectorView = (view) => {
    sectorView = view;
    sectorPage = 0;
    renderSessionMode();
    renderSectors();
  };
  elements.sectorViewPriority?.addEventListener("click", () => switchSectorView("priority"));
  elements.sectorViewAll?.addEventListener("click", () => switchSectorView("all"));
  elements.sectorSearch?.addEventListener("input", () => {
    sectorQuery = elements.sectorSearch.value;
    sectorPage = 0;
    renderSectors();
  });
  elements.sectorSort?.addEventListener("change", () => {
    sectorSort = elements.sectorSort.value;
    sectorPage = 0;
    renderSectors();
  });
  elements.sectorPrevious?.addEventListener("click", () => { sectorPage -= 1; renderSectors(); });
  elements.sectorNext?.addEventListener("click", () => { sectorPage += 1; renderSectors(); });

  elements.refresh.addEventListener("click", () => void refresh({ manual: true }).catch((error) => {
    notify(error instanceof Error ? error.message : "今日选股刷新失败", "error");
  }));
  elements.export?.addEventListener("click", () => void exportSelection());
  elements.technologyAction.addEventListener("click", () => {
    technologyVisible = !technologyVisible;
    renderTechnologyHotspots();
    if (technologyVisible && !snapshot && !loading) {
      void refresh({ manual: true }).catch((error) => {
        notify(error instanceof Error ? error.message : "科技热点刷新失败", "error");
      });
    }
  });
  elements.sectorList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-selection-sector]");
    if (!button || !snapshot?.sectors.some((item) => item.id === button.dataset.selectionSector)) return;
    rememberSelectedSector(button.dataset.selectionSector);
    renderSectors();
    renderCandidates();
  });
  elements.environmentMainlines?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sector-id]");
    const id = button?.dataset.sectorId;
    if (!id || !snapshot?.sectors.some((item) => item.id === id)) return;
    revealFunnel();
    rememberSelectedSector(id);
    renderSectors();
    renderCandidates();
    elements.funnelDetails?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  elements.rotationGrid?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sector-id]");
    const id = button?.dataset.sectorId;
    if (!id || !snapshot?.sectors.some((item) => item.id === id)) return;
    revealFunnel();
    rememberSelectedSector(id);
    renderSectors();
    renderCandidates();
    elements.funnelDetails?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  elements.focusAction.addEventListener("click", () => {
    const id = elements.focusAction.dataset.focusSector;
    if (!id || !snapshot?.sectors.some((item) => item.id === id)) return;
    revealFunnel();
    rememberSelectedSector(id);
    renderSectors();
    renderCandidates();
    elements.root.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  elements.followSector.addEventListener("click", () => {
    const sector = selectedSector();
    if (!sector || watch.sectors.some((item) => item.id === sector.id)) return;
    void updateWatch({ ...watch, sectors: [...watch.sectors, { id: sector.id, name: sector.name }] }, `已长期关注 ${sector.name}`);
  });
  elements.watchSectorAdd.addEventListener("click", () => {
    const id = elements.watchSector.value;
    const option = [...elements.watchSector.options].find((item) => item.value === id);
    const name = cleanText(option?.dataset.name ?? option?.textContent, 40);
    if (!/^new_[A-Za-z0-9]+$/u.test(id) || !name) return notify("请先选择一个板块", "error");
    if (watch.sectors.some((item) => item.id === id)) return notify("该板块已在长期关注中", "error");
    void updateWatch({ ...watch, sectors: [...watch.sectors, { id, name }] }, `已长期关注 ${name}`);
  });
  elements.watchStockAdd.addEventListener("click", () => {
    const resolved = resolveAShareStock(elements.watchStock.value, snapshot?.stockDirectory ?? []);
    if (!resolved.ok) return notify(aShareResolutionMessage(resolved), "error");
    const { symbol, name } = resolved;
    if (watch.stocks.some((item) => item.symbol === symbol)) return notify("该个股已在长期关注中", "error");
    elements.watchStock.value = "";
    void updateWatch({ ...watch, stocks: [...watch.stocks, { symbol, name }] }, `已长期关注 ${name || symbol}`);
  });
  elements.watchStock.addEventListener("keydown", (event) => {
    if (event.key === "Enter") elements.watchStockAdd.click();
  });
  elements.watchFilters?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-selection-watch-filter]");
    if (!button || !["all", "focus", "attention", "stock", "sector"].includes(button.dataset.selectionWatchFilter)) return;
    watchFilter = button.dataset.selectionWatchFilter;
    renderWatch();
  });

  function handleContentClick(event) {
    const diagnose = event.target.closest("[data-selection-diagnose]");
    if (diagnose) return onDiagnose(diagnose.dataset.selectionDiagnose);
    const follow = event.target.closest("[data-selection-follow-stock]");
    if (follow) {
      const symbol = canonicalStock(follow.dataset.selectionFollowStock);
      const name = cleanText(follow.dataset.selectionStockName, 40);
      if (!symbol || watch.stocks.some((item) => item.symbol === symbol)) return;
      void updateWatch({ ...watch, stocks: [...watch.stocks, { symbol, name }] }, `已长期关注 ${name || symbol}`);
      return;
    }
    const prioritySector = event.target.closest("[data-selection-priority-sector]");
    if (prioritySector) {
      const id = prioritySector.dataset.selectionPrioritySector;
      void updateWatch({
        ...watch,
        sectors: watch.sectors.map((item) => item.id === id
          ? { ...item, priority: item.priority === "focus" ? "normal" : "focus" }
          : item),
      }, prioritySector.getAttribute("aria-pressed") === "true" ? "已取消重点板块" : "已设为重点板块", { refreshSnapshot: false });
      return;
    }
    const priorityStock = event.target.closest("[data-selection-priority-stock]");
    if (priorityStock) {
      const symbol = canonicalStock(priorityStock.dataset.selectionPriorityStock);
      void updateWatch({
        ...watch,
        stocks: watch.stocks.map((item) => item.symbol === symbol
          ? { ...item, priority: item.priority === "focus" ? "normal" : "focus" }
          : item),
      }, priorityStock.getAttribute("aria-pressed") === "true" ? "已取消重点个股" : "已设为重点个股", { refreshSnapshot: false });
      return;
    }
    const removeSector = event.target.closest("[data-selection-remove-sector]");
    if (removeSector) {
      void updateWatch(
        { ...watch, sectors: watch.sectors.filter((item) => item.id !== removeSector.dataset.selectionRemoveSector) },
        "已移除关注板块",
      );
      return;
    }
    const removeStock = event.target.closest("[data-selection-remove-stock]");
    if (removeStock) {
      void updateWatch(
        { ...watch, stocks: watch.stocks.filter((item) => item.symbol !== removeStock.dataset.selectionRemoveStock) },
        "已移除关注个股",
      );
      return;
    }
    const urlButton = event.target.closest("[data-selection-url]");
    if (urlButton) {
      void hostCall("external.open", { url: urlButton.dataset.selectionUrl }).catch((error) => {
        notify(error instanceof Error ? error.message : "外部来源无法打开", "error");
      });
    }
  }

  elements.candidateList.addEventListener("click", handleContentClick);
  elements.picksList.addEventListener("click", handleContentClick);
  elements.picksTableBody?.addEventListener("click", handleContentClick);
  elements.technologyList.addEventListener("click", (event) => {
    const sectorButton = event.target.closest("[data-selection-sector]");
    if (sectorButton && snapshot?.sectors.some((item) => item.id === sectorButton.dataset.selectionSector)) {
      revealFunnel();
      rememberSelectedSector(sectorButton.dataset.selectionSector);
      renderSectors();
      renderCandidates();
      elements.funnelDetails?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    handleContentClick(event);
  });
  elements.predictionList.addEventListener("click", handleContentClick);
  elements.watchList.addEventListener("click", handleContentClick);
  elements.sources.addEventListener("click", handleContentClick);
  render();

  return {
    async load() {
      const loadGeneration = generation, loadEpoch = currentEpoch();
      const saved = await hostCall("storage.get", { key: storageKey() }).catch(() => null);
      if (loadGeneration !== generation || loadEpoch !== currentEpoch()) return watch;
      watch = parseSelectionWatchStorage(saved);
      selectedSectorId = watch.selectedSectorId;
      render();
      onUpdate(snapshot);
      const cached = await fetchSnapshot("read-local").catch(() => null);
      if (loadGeneration !== generation || loadEpoch !== currentEpoch()) return watch;
      if (cached) {
        snapshot = cached;
        onStockDirectory(cached.stockDirectory);
        onUpdate(cached);
        elements.status.dataset.tone = "warning";
        const cachedDisplayPhase = displayedAShareSessionPhase(cached, now());
        elements.status.textContent = cachedDisplayPhase === "settling"
          ? `已恢复 ${cached.marketDate} 最后盘中快照；15:00–15:10 为收盘数据汇总期，当前不生成收盘确认；15:12 自动核验完整收盘。`
          : cachedDisplayPhase === "close-pending"
            ? `已恢复 ${cached.marketDate} 最后盘中快照；完整收盘数据尚未通过校验，可稍后重试。`
            : cachedDisplayPhase === "intraday"
              ? `已恢复 ${cached.marketDate} 盘中快照；盘中数据会按刷新周期继续更新，旧内容保留到新数据通过校验。`
              : `已恢复 ${cached.marketDate} 收盘复盘；页面重开不会自动覆盖，可按需点击刷新。`;
        render();
      }
      restored = true;
      schedule();
      return watch;
    },
    refresh,
    pauseScan,
    resumeScan,
    selectSector(id) {
      if (!snapshot?.sectors.some((item) => item.id === id)) return false;
      revealFunnel();
      rememberSelectedSector(id);
      renderSectors();
      renderCandidates();
      return true;
    },
    async focusSector(id, name = "") {
      if (!/^new_[A-Za-z0-9]+$/u.test(id)) return false;
      if (snapshot?.sectors.some((item) => item.id === id)) {
        revealFunnel();
        rememberSelectedSector(id);
        renderSectors();
        renderCandidates();
        return true;
      }
      const directoryName = snapshot?.sectorDirectory.find((item) => item.id === id)?.name ?? cleanText(name, 40);
      if (!directoryName) return false;
      if (!watch.sectors.some((item) => item.id === id)) {
        watch = parseSelectionWatchStorage({ ...watch, sectors: [...watch.sectors, { id, name: directoryName }], selectedSectorId: id });
        await saveWatch().catch(() => undefined);
      }
      selectedSectorId = id;
      elements.status.dataset.tone = "active";
      elements.status.textContent = `正在读取 ${directoryName} 的成分历史、趋势位置和公告风险…`;
      renderWatch();
      await refresh({ watchChanged: true }).catch(() => undefined);
      if (!snapshot?.sectors.some((item) => item.id === id)) return false;
      revealFunnel();
      rememberSelectedSector(id);
      renderSectors();
      renderCandidates();
      return true;
    },
    async syncPortfolio(ledger, holdings) {
      const merged = mergePortfolioWatch(watch, ledger, holdings);
      if (!merged.added) return merged;
      const previous = watch;
      const operationGeneration = generation;
      watch = merged.value;
      try {
        await saveWatch();
      } catch (error) {
        if (generation === operationGeneration && watch === merged.value) watch = previous;
        throw error;
      }
      if (generation !== operationGeneration) return merged;
      render();
      onUpdate(snapshot);
      watchRefreshPending = true;
      schedule();
      return merged;
    },
    async followStock(symbolInput, nameInput = "") {
      const symbol = canonicalStock(symbolInput);
      const name = cleanText(nameInput, 40);
      if (!symbol) {
        notify("这不是有效的沪深 A 股代码", "error");
        return false;
      }
      if (watch.stocks.some((item) => item.symbol === symbol)) {
        notify(`${name || symbol} 已在长期关注中`);
        return false;
      }
      await updateWatch({ ...watch, stocks: [...watch.stocks, { symbol, name }] }, `已长期关注 ${name || symbol}`);
      return true;
    },
    start() {
      active = true;
      restored = true;
      if (document.visibilityState === "hidden") return Promise.resolve(snapshot);
      if (!snapshot) return refresh();
      if (!scanPaused && freshnessNeedsRefresh()) return refresh();
      schedule();
      return Promise.resolve(snapshot);
    },
    setActive(next, { backgroundWatch = false } = {}) {
      active = Boolean(next);
      backgroundWatchActive = Boolean(backgroundWatch);
      if (!active) {
        clearTimer();
      }
      if (!canMaintain() || document.visibilityState === "hidden" || !restored) clearTimer();
      else if (!loading && !scanPaused && freshnessNeedsRefresh()) void refresh();
      else if (!loading) schedule();
    },
    reset() {
      generation += 1;
      clearTimer();
      if (activeProcessId) void hostCall("process.cancel", { processId: activeProcessId }).catch(() => undefined);
      activeProcessId = null;
      snapshot = null;
      onStockDirectory([]);
      onUpdate(null);
      selectedSectorId = null;
      sectorView = "priority";
      sectorQuery = "";
      sectorSort = "composite";
      sectorPage = 0;
      scanPaused = false;
      scanContinuing = false;
      lastAttemptAt = null;
      continuationRetryAt = null;
      continuationErrorReason = "";
      noProgressBatches = 0;
      automaticPauseReason = "";
      lastBatch = null;
      nextBatchAt = null;
      watchRefreshPending = false;
      if (elements.sectorSearch) elements.sectorSearch.value = "";
      if (elements.sectorSort) elements.sectorSort.value = "composite";
      watchFilter = "all";
      technologyVisible = false;
      loading = false;
      restored = false;
      runtime = null;
      watch = parseSelectionWatchStorage(null);
      elements.status.dataset.tone = "active";
      elements.status.textContent = "工作区已切换，正在读取新的长期关注与选股数据。";
      render();
    },
    dispose() {
      generation += 1;
      clearTimer();
      if (activeProcessId) void hostCall("process.cancel", { processId: activeProcessId }).catch(() => undefined);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unsubscribeOutput?.();
      unsubscribeExit?.();
    },
    get snapshot() {
      return snapshot;
    },
    get watch() {
      return watch;
    },
    isFollowingStock(symbolInput) {
      const symbol = canonicalStock(symbolInput);
      return Boolean(symbol && watch.stocks.some((item) => item.symbol === symbol));
    },
  };
}

export const A_SHARE_SELECTION_REFRESH_MS = REFRESH_MS;
