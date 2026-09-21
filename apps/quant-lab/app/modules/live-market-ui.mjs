import { liveQuoteNumber } from "../live-quote-contract.mjs";
import { parseMarketInsight } from "./market-insights-ui.mjs";
import { chinaMarketClock, displayedAShareSessionPhase } from "./a-share-session.mjs";

const SNAPSHOT_SCHEMA_VERSION = 1;
const SNAPSHOT_KIND = "live-market-snapshot";
const MAX_SNAPSHOT_BYTES = 768_000;
const MAX_PROCESS_OUTPUT_CHARS = 1_000_000;
const PROCESS_TIMEOUT_MS = 45_000;
const OPEN_REFRESH_MS = 3 * 60 * 1_000;
const CLOSED_REFRESH_MS = 15 * 60 * 1_000;
const SOURCE_STATUS_KEYS = Object.freeze([
  "breadth",
  "indexQuotes",
  "industries",
  "indexHistory",
  "news",
  "dragonTiger",
]);
const INDEX_SPECS = new Map([
  ["指数 000001", "上证指数"],
  ["指数 399001", "深证成指"],
  ["指数 399006", "创业板指"],
  ["指数 000300", "沪深300"],
]);

const NODE_LAUNCHER = [
  'import { join } from "node:path";',
  'import { pathToFileURL } from "node:url";',
  'const home = process.env.HOME || process.env.USERPROFILE;',
  'if (!home) throw new Error("user-home-unavailable");',
  'const tool = join(home, ".code-shell", "panel-apps", "quant-lab", "app", "tools", "build-market-pulse.mjs");',
  'const module = await import(pathToFileURL(tool).href);',
  'const mode = process.argv.at(-1) || "refresh-volatile";',
  'const args = mode === "read-local" ? ["--stdout", "--read-local", "--persist-panel-data"] : mode === "refresh-local" ? ["--stdout", "--persist-panel-data"] : ["--stdout"];',
  'try { await module.runCli(args); } catch (error) { process.stderr.write(JSON.stringify({ ok: false, errorCode: error?.code ?? error?.cause?.code ?? "MARKET_PULSE_ERROR", message: error instanceof Error ? error.message : "market pulse failed", sourceFailures: error?.sourceFailures }) + "\\n"); process.exitCode = 1; }',
].join("\n");

const LIVE_RUNTIME_SPECS = Object.freeze([
  Object.freeze({ name: "node", label: "Node.js" }),
  Object.freeze({ name: "nodejs", label: "Node.js" }),
  Object.freeze({ name: "bun", label: "Bun" }),
]);

export function liveMarketRuntimeArgs(name, mode = "refresh-volatile") {
  if (!new Set(["refresh-volatile", "refresh-local", "read-local"]).has(mode)) {
    throw new Error("行情本地模式不受支持");
  }
  if (name === "node" || name === "nodejs") {
    return Object.freeze(["--input-type=module", "--eval", NODE_LAUNCHER, mode]);
  }
  if (name === "bun") return Object.freeze(["--eval", NODE_LAUNCHER, mode]);
  throw new Error("行情运行时不受支持");
}

function cleanText(value, maximum = 300) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, maximum)
    : "";
}

function finiteNumber(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`${label}无效`);
  }
  return number;
}

function integer(value, minimum, maximum, label) {
  const number = finiteNumber(value, minimum, maximum, label);
  if (!Number.isInteger(number)) throw new Error(`${label}不是整数`);
  return number;
}

function reportPathForGeneratedAt(generatedAt) {
  const instant = new Date(generatedAt);
  if (!Number.isFinite(instant.getTime())) throw new Error("实时行情生成时间无效");
  const stamp = instant.toISOString().replace(/[-:.]/gu, "");
  return `data/market-insights/${stamp}-market-overview.json`;
}

function parseBreadth(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("市场宽度结构无效");
  }
  const total = integer(value.total, 100, 20_000, "行情覆盖");
  const up = integer(value.up, 0, total, "上涨家数");
  const down = integer(value.down, 0, total, "下跌家数");
  const flat = integer(value.flat, 0, total, "平盘家数");
  if (up + down + flat !== total) throw new Error("涨跌家数与行情覆盖不一致");
  return Object.freeze({
    total,
    up,
    down,
    flat,
    limitUp: integer(value.limitUp, 0, total, "涨停近似家数"),
    limitDown: integer(value.limitDown, 0, total, "跌停近似家数"),
    aboveFive: integer(value.aboveFive, 0, total, "涨幅超 5% 家数"),
    belowFive: integer(value.belowFive, 0, total, "跌幅超 5% 家数"),
    amount: finiteNumber(value.amount, 0, 1e17, "两市成交额"),
    medianChange: finiteNumber(value.medianChange, -100, 100, "涨跌中位数"),
    netBreadth: finiteNumber(value.netBreadth, -1, 1, "市场净宽度"),
  });
}

function parseIndexes(value, marketDate) {
  if (!Array.isArray(value) || value.length > INDEX_SPECS.size) throw new Error("指数行情结构无效");
  const seen = new Set();
  return Object.freeze(value.map((item) => {
    const symbol = cleanText(item?.symbol, 20);
    const expectedName = INDEX_SPECS.get(symbol);
    if (!expectedName || seen.has(symbol)) throw new Error("指数代码无效或重复");
    seen.add(symbol);
    const name = cleanText(item?.name, 30);
    if (name !== expectedName) throw new Error("指数名称与代码不一致");
    const asOf = cleanText(item?.asOf, 40);
    if (!Number.isFinite(Date.parse(asOf)) || asOf.slice(0, 10) !== marketDate) {
      throw new Error("指数行情时点无效");
    }
    return Object.freeze({
      symbol,
      name,
      price: finiteNumber(item?.price, 1, 1_000_000, `${name}点位`),
      changePercent: liveQuoteNumber(item?.changePercent, "changePercent", `${name}涨跌幅`),
      amount: finiteNumber(item?.amount, 0, 1e17, `${name}成交额`),
      asOf,
    });
  }));
}

function parseSectors(value) {
  if (!Array.isArray(value) || value.length > 5) throw new Error("行业板块结构无效");
  const seen = new Set();
  return Object.freeze(value.map((item) => {
    const id = cleanText(item?.id, 50);
    const name = cleanText(item?.name, 40);
    if (!/^new_[A-Za-z0-9]+$/u.test(id) || !name || seen.has(id)) throw new Error("行业板块标识无效");
    seen.add(id);
    const direction = ["leading", "lagging"].includes(item?.direction) ? item.direction : null;
    if (!direction) throw new Error("行业板块方向无效");
    return Object.freeze({
      id,
      name,
      direction,
      changePercent: liveQuoteNumber(item?.changePercent, "changePercent", `${name}涨跌幅`),
      amount: finiteNumber(item?.amount, 0, 1e17, `${name}成交额`),
      leaderSymbol: /^(?:SH|SZ)\d{6}$/u.test(item?.leaderSymbol) ? item.leaderSymbol : "",
      leaderName: cleanText(item?.leaderName, 40),
      leaderChangePercent: item?.leaderChangePercent == null
        ? null
        : finiteNumber(item.leaderChangePercent, -30, 30, `${name}领涨股涨跌幅`),
    });
  }));
}

function parseSourceStatus(value) {
  return Object.freeze(Object.fromEntries(SOURCE_STATUS_KEYS.map((key) => [key, value?.[key] === true])));
}

function parseLiveQuoteRows(value, { details = false, warnings = [] } = {}) {
  if (!Array.isArray(value) || value.length > 8) throw new Error("股票排行结构无效");
  const seen = new Set();
  return Object.freeze(value.flatMap((item) => {
    try {
      const symbol = cleanText(item?.symbol, 16);
      const name = cleanText(item?.name, 40);
      if (!/^(?:SH|SZ)\d{6}$/u.test(symbol) || !name || seen.has(symbol)) throw new Error("股票排行标的无效或重复");
      seen.add(symbol);
      const board = ["main", "star", "chinext"].includes(item?.board) ? item.board : null;
      if (!board) throw new Error("股票排行板块无效");
      return Object.freeze({
        symbol,
        name,
        board,
        price: finiteNumber(item?.price, 0.01, 1_000_000, `${name}价格`),
        changePercent: liveQuoteNumber(item?.changePercent, "changePercent", `${name}涨跌幅`),
        amount: finiteNumber(item?.amount, 0, 1e17, `${name}成交额`),
        turnover: finiteNumber(item?.turnover, 0, 1_000, `${name}换手率`),
        ...(details ? {
          reason: cleanText(item?.reason, 200),
          risk: cleanText(item?.risk, 200),
        } : {}),
      });
    } catch (error) {
      warnings.push(`排行条目已隔离：${cleanText(error.message, 100)}`);
      return [];
    }
  }));
}

function parseRankings(value, warnings) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("行情排行结构无效");
  return Object.freeze({
    gainers: parseLiveQuoteRows(value.gainers, { warnings }),
    losers: parseLiveQuoteRows(value.losers, { warnings }),
    active: parseLiveQuoteRows(value.active, { warnings }),
  });
}

function parseAnomalyBoard(value, warnings = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze({ version: 1, sessionId: "unavailable", sessionLabel: "等待快照", marketMedian: null, items: Object.freeze([]), counts: Object.freeze({}), methodology: "暂无异动分型" });
  }
  const sessionIds = ["auction", "open", "intraday", "close"];
  const types = ["gap-up", "opening-reversal", "intraday-surge", "intraday-dive", "large-amplitude", "market-deviation"];
  if (value.version !== 1 || !sessionIds.includes(value.sessionId) || !Array.isArray(value.items) || value.items.length > 10) {
    throw new Error("异动分型结构无效");
  }
  const seen = new Set();
  const items = value.items.flatMap((item) => {
    try {
      const symbol = cleanText(item?.symbol, 16);
      const name = cleanText(item?.name, 40);
      if (!/^(?:SH|SZ)\d{6}$/u.test(symbol) || !name || seen.has(symbol) || !types.includes(item?.type) || !["up", "down"].includes(item?.direction)) {
        throw new Error("异动分型条目无效或重复");
      }
      seen.add(symbol);
      return Object.freeze({
        symbol,
        name,
        board: ["main", "star", "chinext"].includes(item?.board) ? item.board : "main",
        price: finiteNumber(item?.price, 0.01, 1_000_000, `${name}异动价格`),
        changePercent: liveQuoteNumber(item?.changePercent, "changePercent", `${name}异动涨跌幅`),
        amount: finiteNumber(item?.amount, 0, 1e17, `${name}异动成交额`),
        turnover: finiteNumber(item?.turnover, 0, 1_000, `${name}异动换手率`),
        sessionId: sessionIds.includes(item?.sessionId) ? item.sessionId : value.sessionId,
        sessionLabel: cleanText(item?.sessionLabel, 30),
        type: item.type,
        typeLabel: cleanText(item?.typeLabel, 30),
        direction: item.direction,
        severity: liveQuoteNumber(item?.severity, "severity", `${name}异动强度`),
        reason: cleanText(item?.reason, 240),
        risk: cleanText(item?.risk, 240),
        metrics: Object.freeze({
          gap: liveQuoteNumber(item?.metrics?.gap, "gap", `${name}高开幅度`),
          fromOpen: liveQuoteNumber(item?.metrics?.fromOpen, "fromOpen", `${name}开盘后变化`),
          amplitude: liveQuoteNumber(item?.metrics?.amplitude, "amplitude", `${name}振幅`),
          relativeToMedian: liveQuoteNumber(item?.metrics?.relativeToMedian, "relativeToMedian", `${name}相对偏离`),
        }),
      });
    } catch (error) {
      warnings.push(`异动条目已隔离：${cleanText(error.message, 100)}`);
      return [];
    }
  });
  const counts = {};
  for (const type of types) {
    const expected = items.filter((item) => item.type === type).length;
    if (items.length === value.items.length && value.counts?.[type] != null && value.counts[type] !== expected) {
      warnings.push("异动分类数量不一致，已按有效条目重算");
    }
    if (expected) counts[type] = expected;
  }
  return Object.freeze({
    version: 1,
    sessionId: value.sessionId,
    sessionLabel: cleanText(value.sessionLabel, 30),
    marketMedian: liveQuoteNumber(value.marketMedian, "changePercent", "异动市场中位数"),
    items: Object.freeze(items),
    counts: Object.freeze(counts),
    methodology: cleanText(value.methodology, 400),
  });
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseDragonTiger(value, snapshotMarketDate) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("龙虎榜结构无效");
  const marketDate = value.marketDate == null ? null : cleanText(value.marketDate, 10);
  if (marketDate != null && (!validDate(marketDate) || marketDate > snapshotMarketDate)) throw new Error("龙虎榜交易日无效");
  if (!Array.isArray(value.entries) || value.entries.length > 10) throw new Error("龙虎榜条目无效");
  if (value.entries.length > 0 && !marketDate) throw new Error("龙虎榜缺少交易日");
  const seen = new Set();
  const entries = value.entries.map((item) => {
    const symbol = cleanText(item?.symbol, 16);
    const name = cleanText(item?.name, 40);
    const direction = ["buy", "sell"].includes(item?.direction) ? item.direction : null;
    if (!/^(?:SH|SZ)\d{6}$/u.test(symbol) || !name || !direction || seen.has(symbol)) {
      throw new Error("龙虎榜标的无效或重复");
    }
    seen.add(symbol);
    const netBuyAmount = finiteNumber(item?.netBuyAmount, -1e14, 1e14, `${name}榜单净额`);
    if ((direction === "buy" && netBuyAmount <= 0) || (direction === "sell" && netBuyAmount >= 0)) {
      throw new Error("龙虎榜方向与净额冲突");
    }
    if (cleanText(item?.marketDate, 10) !== marketDate) throw new Error("龙虎榜条目交易日不一致");
    return Object.freeze({
      symbol,
      name,
      direction,
      marketDate,
      close: finiteNumber(item?.close, 0.01, 1_000_000, `${name}收盘价`),
      changePercent: finiteNumber(item?.changePercent, -30, 30, `${name}榜单涨跌幅`),
      amount: finiteNumber(item?.amount, 0, 1e17, `${name}榜单成交额`),
      netBuyAmount,
      netRatio: finiteNumber(item?.netRatio, -1_000, 1_000, `${name}榜单净额占比`),
      explanation: cleanText(item?.explanation, 160),
    });
  });
  return Object.freeze({ marketDate, entries: Object.freeze(entries) });
}

function parseHeadlines(value, generatedAt) {
  if (!Array.isArray(value) || value.length > 8) throw new Error("盘中快讯结构无效");
  const seen = new Set();
  return Object.freeze(value.map((item) => {
    const id = cleanText(item?.id, 80);
    const title = cleanText(item?.title, 240);
    const publishedAt = cleanText(item?.publishedAt, 40);
    const source = ["eastmoney-724", "sina-finance", "csrc-policy", "pbc-policy"].includes(item?.source) ? item.source : "eastmoney-724";
    const sourceLabel = cleanText(item?.sourceLabel, 80) || (source === "csrc-policy" ? "中国证监会 · 官方发布" : source === "pbc-policy" ? "中国人民银行 · 官方发布" : source === "sina-finance" ? "新浪财经滚动" : "东方财富 7×24");
    const sourceCount = item?.sourceCount == null ? 1 : integer(item.sourceCount, 1, 4, "盘中快讯来源数");
    let url;
    try {
      url = new URL(item?.url);
    } catch {
      throw new Error("盘中快讯链接无效");
    }
    if (
      !id || !title || seen.has(id) || !Number.isFinite(Date.parse(publishedAt)) ||
      Date.parse(publishedAt) > Date.parse(generatedAt) + 5 * 60 * 1_000 ||
      url.protocol !== "https:" ||
      !["eastmoney.com", "sina.com.cn", "csrc.gov.cn", "pbc.gov.cn"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)) ||
      url.username || url.password
    ) throw new Error("盘中快讯条目无效");
    seen.add(id);
    return Object.freeze({
      id,
      title,
      publishedAt,
      url: url.toString(),
      source,
      sourceLabel,
      sourceCount,
      official: item?.official === true,
    });
  }));
}

export function parseLiveMarketSnapshot(text) {
  const source = String(text ?? "").trim();
  if (!source) throw new Error("实时行情没有返回数据");
  if (new TextEncoder().encode(source).length > MAX_SNAPSHOT_BYTES) throw new Error("实时行情返回过大");
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("实时行情不是有效 JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("实时行情结构无效");
  if (value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION || value.kind !== SNAPSHOT_KIND) {
    throw new Error("实时行情版本不受支持");
  }
  const report = parseMarketInsight(
    JSON.stringify(value.report),
    reportPathForGeneratedAt(value.report?.generatedAt),
  );
  if (
    report.marketDate !== value.marketDate ||
    report.asOf !== value.asOf ||
    report.generatedAt !== value.generatedAt
  ) {
    throw new Error("实时行情与盘面报告时点不一致");
  }
  const phase = ["intraday", "close", "previous-close"].includes(value.session?.phase)
    ? value.session.phase
    : null;
  if (!phase) throw new Error("实时行情交易阶段无效");
  const provisional = value.session?.provisional === true;
  const previousClose = value.session?.previousClose === true;
  if ((phase === "intraday") !== provisional || (phase === "previous-close") !== previousClose || (provisional && previousClose)) {
    throw new Error("实时行情交易阶段冲突");
  }
  const warnings = [];
  let anomalyBoard;
  try {
    anomalyBoard = parseAnomalyBoard(value.anomalyBoard, warnings);
  } catch (error) {
    warnings.push(`异动分型暂不可用：${cleanText(error.message, 100)}`);
    anomalyBoard = parseAnomalyBoard(null);
  }
  return Object.freeze({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    kind: SNAPSHOT_KIND,
    marketDate: report.marketDate,
    asOf: report.asOf,
    generatedAt: report.generatedAt,
    session: Object.freeze({ phase, provisional, previousClose }),
    breadth: parseBreadth(value.breadth),
    indexes: parseIndexes(value.indexes, report.marketDate),
    sectors: parseSectors(value.sectors),
    rankings: parseRankings(value.rankings, warnings),
    attention: parseLiveQuoteRows(value.attention, { details: true, warnings }),
    anomalyBoard,
    dragonTiger: parseDragonTiger(value.dragonTiger, report.marketDate),
    headlines: parseHeadlines(value.headlines, report.generatedAt),
    sourceStatus: parseSourceStatus(value.sourceStatus),
    validationWarnings: Object.freeze(warnings),
    sourceErrors: Object.freeze(Object.fromEntries(SOURCE_STATUS_KEYS.filter((key) => value.sourceErrors?.[key]).map((key) => [key, friendlyMarketFailure(value.sourceErrors[key].message, value.sourceErrors[key].errorCode)]))),
    elapsedMs: integer(value.elapsedMs, 0, 120_000, "实时行情耗时"),
    report,
  });
}

function formatPercent(value) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatAmount(value) {
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)} 万亿`;
  return `${(value / 100_000_000).toFixed(1)} 亿`;
}

function formatClock(value, withDate = false) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    ...(withDate ? { month: "2-digit", day: "2-digit" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function friendlyMarketFailure(messageInput, errorCode = "") {
  const message = cleanText(messageInput, 300)
    .replace(/^\[(?:TypeError|Error):\s*/iu, "")
    .replace(/\]\s*\{?$/u, "")
    .trim();
  const signal = `${errorCode} ${message}`;
  if (/429|456|403|rate.?limit|too many requests|请求频率|限流/iu.test(signal)) {
    return "公开行情数据源触发频率限制，请稍后再试";
  }
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|UND_ERR|network|socket|TLS/iu.test(signal)) {
    return "公开行情数据源暂时连接失败，请稍后重试";
  }
  if (/SOURCE_TIMEOUT|ETIMEDOUT|timeout|超时/iu.test(signal)) {
    return "公开行情数据源响应超时，请稍后重试";
  }
  if (/HTTP\s*5\d\d|SOURCE_HTTP.*5\d\d/iu.test(signal)) {
    return "公开行情数据源服务暂时异常，请稍后重试";
  }
  return message || "公开行情刷新失败";
}

export function liveMarketErrorMessage(stderr) {
  const lines = String(stderr).trim().split(/\r?\n/u).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      const message = cleanText(parsed?.message, 300);
      if (message) return friendlyMarketFailure(message, cleanText(parsed?.errorCode, 80));
    } catch {
      // Continue to a plain-text fallback.
    }
  }
  const namedError = lines.find((line) => /(?:Error|Exception):\s*\S/iu.test(line));
  return friendlyMarketFailure(namedError ?? lines[0]);
}

function snapshotDelta(previous, next) {
  if (!previous) {
    return Object.freeze({ first: true, breadth: false, indexes: new Set(), sectors: new Set(), headlines: 0 });
  }
  const previousIndexes = new Map(previous.indexes.map((item) => [item.symbol, item]));
  const indexes = new Set(next.indexes.filter((item) => {
    const before = previousIndexes.get(item.symbol);
    return !before || before.price !== item.price || before.changePercent !== item.changePercent;
  }).map((item) => item.symbol));
  const previousSectors = new Map(previous.sectors.map((item) => [item.id, item]));
  const sectors = new Set(next.sectors.filter((item) => {
    const before = previousSectors.get(item.id);
    return !before || before.changePercent !== item.changePercent || before.leaderSymbol !== item.leaderSymbol;
  }).map((item) => item.id));
  const breadth = ["up", "down", "flat", "amount", "medianChange"].some(
    (key) => previous.breadth[key] !== next.breadth[key],
  );
  const previousHeadlines = new Set(previous.headlines.map((item) => `${item.url}\n${item.title}`));
  const headlines = next.headlines.filter((item) => !previousHeadlines.has(`${item.url}\n${item.title}`)).length;
  return Object.freeze({ first: false, breadth, indexes, sectors, headlines });
}

function deltaLabel(change) {
  if (!change || change.first) return "首份快照";
  const parts = [];
  if (change.indexes.size) parts.push(`指数 ${change.indexes.size}`);
  if (change.sectors.size) parts.push(`板块 ${change.sectors.size}`);
  if (change.breadth) parts.push("宽度变化");
  if (change.headlines) parts.push(`新快讯 ${change.headlines}`);
  return parts.length ? parts.join(" · ") : "本轮无结构变化";
}

function freshnessLabel(snapshot, instant) {
  if (!snapshot) return "等待首份快照";
  const displayPhase = displayedAShareSessionPhase(snapshot, instant);
  if (displayPhase === "settling") return "收盘结算中 · 保留最后盘中数据";
  if (displayPhase === "close-pending") return "等待完整收盘 · 保留最后盘中数据";
  if (snapshot.session.phase !== "intraday") {
    return `${snapshot.marketDate} 收盘基线`;
  }
  const ageMs = Math.max(0, instant.getTime() - Date.parse(snapshot.asOf));
  if (ageMs < 10_000) return "行情刚刚更新";
  if (ageMs < 60_000) return `行情 ${Math.floor(ageMs / 1_000)} 秒前`;
  if (ageMs < 60 * 60_000) return `行情 ${Math.floor(ageMs / 60_000)} 分钟前`;
  return `行情 ${formatClock(snapshot.asOf, true)}`;
}

export function createLiveMarketController({
  hostCall,
  onHostEvent,
  elements,
  now = () => new Date(),
  onUpdate = () => undefined,
  onIndex = () => undefined,
  onStock = () => undefined,
  onSector = () => undefined,
}) {
  let snapshot = null;
  let loading = false;
  let active = false;
  let timer = null;
  let uiTimer = null;
  let nextRefreshAt = null;
  let refreshDelayMs = null;
  let lastDelta = null;
  let lastRefreshFailed = false;
  let runtime = null;
  let activeProcessId = null;
  let generation = 0;
  let selectedRanking = "gainers";
  let retryDelayMs = 0;
  let selectedIndexSymbol = null;
  let selectedSectorId = null;
  const processRecords = new Map();
  const finalizedProcessIds = new Set();

  function finalizeProcess(processId) {
    processRecords.delete(processId);
    finalizedProcessIds.add(processId);
    if (finalizedProcessIds.size > 64) finalizedProcessIds.delete(finalizedProcessIds.values().next().value);
  }

  function recordFor(processId) {
    const existing = processRecords.get(processId);
    if (existing) return existing;
    const created = { stdout: "", stderr: "", exit: null, resolve: null };
    processRecords.set(processId, created);
    return created;
  }

  const unsubscribeOutput = onHostEvent?.("process.output", (payload) => {
    const processId = typeof payload?.processId === "string" ? payload.processId : "";
    if (!processId || finalizedProcessIds.has(processId) || !["stdout", "stderr"].includes(payload?.stream) || typeof payload?.text !== "string") return;
    const record = recordFor(processId);
    record[payload.stream] += payload.text;
    if (record.stdout.length + record.stderr.length > MAX_PROCESS_OUTPUT_CHARS) {
      record.stderr += "\n实时行情输出超过安全上限";
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

  function clearRefreshTimer() {
    if (timer != null) window.clearTimeout(timer);
    timer = null;
    nextRefreshAt = null;
    refreshDelayMs = null;
  }

  function clearUiTimer() {
    if (uiTimer != null) window.clearInterval(uiTimer);
    uiTimer = null;
  }

  function scheduleRefresh() {
    clearRefreshTimer();
    if (!active) {
      renderRealtime();
      return;
    }
    const instant = now();
    const clock = chinaMarketClock(instant);
    const displayPhase = displayedAShareSessionPhase(snapshot, instant);
    const delay = Math.max(retryDelayMs, clock.open || displayPhase === "settling" ? OPEN_REFRESH_MS : CLOSED_REFRESH_MS);
    refreshDelayMs = delay;
    nextRefreshAt = now().getTime() + delay;
    timer = window.setTimeout(() => void load(), delay);
    renderRealtime();
  }

  function renderRealtime() {
    if (!elements.realtime) return;
    const instant = now();
    const displayPhase = displayedAShareSessionPhase(snapshot, instant);
    const availableSources = snapshot
      ? SOURCE_STATUS_KEYS.filter((key) => snapshot.sourceStatus[key]).length
      : 0;
    const degraded = snapshot && (availableSources < SOURCE_STATUS_KEYS.length || snapshot.validationWarnings.length > 0);
    const state = loading
      ? snapshot ? "refreshing" : "connecting"
      : !snapshot
        ? elements.status.dataset.tone === "error" ? "error" : "waiting"
        : lastRefreshFailed || degraded
          ? "warning"
          : "ready";
    elements.realtime.dataset.state = state;
    elements.clock.textContent = formatClock(instant);
    elements.coverage.textContent = `${availableSources} / ${SOURCE_STATUS_KEYS.length}`;
    elements.delta.textContent = deltaLabel(lastDelta);
    elements.age.textContent = freshnessLabel(snapshot, instant);
    if (state === "connecting") {
      elements.connection.textContent = "正在连接公开行情";
      elements.countdown.textContent = "首份快照读取中";
    } else if (state === "refreshing") {
      elements.connection.textContent = "正在采集并校验";
      elements.countdown.textContent = "旧快照继续显示";
    } else if (state === "error") {
      elements.connection.textContent = "行情刷新失败";
      elements.countdown.textContent = "可手动重试";
    } else if (state === "waiting") {
      elements.connection.textContent = "等待行情连接";
      elements.countdown.textContent = "准备更新";
    } else if (!active) {
      elements.connection.textContent = degraded ? "行情可用 · 辅助源降级" : "行情快照已就绪";
      elements.countdown.textContent = "返回本页后续更";
    } else if (lastRefreshFailed) {
      elements.connection.textContent = "刷新失败 · 已保留旧快照";
    } else if (degraded) {
      elements.connection.textContent = "行情可用 · 辅助源降级";
    } else {
      elements.connection.textContent = displayPhase === "settling"
        ? "收盘数据结算中"
        : displayPhase === "close-pending"
          ? "等待完整收盘快照"
          : displayPhase === "intraday"
            ? "盘中更新正常"
            : "收盘更新正常";
    }
    if (["ready", "warning"].includes(state) && active) {
      const remainingMs = Math.max(0, (nextRefreshAt ?? instant.getTime()) - instant.getTime());
      const minutes = Math.floor(remainingMs / 60_000);
      const seconds = Math.floor((remainingMs % 60_000) / 1_000);
      elements.countdown.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")} 后刷新`;
      const ratio = refreshDelayMs ? Math.min(1, Math.max(0, 1 - remainingMs / refreshDelayMs)) : 0;
      elements.progress.style.width = `${(ratio * 100).toFixed(2)}%`;
    } else {
      elements.progress.style.width = "0%";
    }
  }

  function startUiTimer() {
    clearUiTimer();
    renderRealtime();
    if (!active) return;
    uiTimer = window.setInterval(renderRealtime, 1_000);
  }

  function instrumentSubject(item) {
    return `${item.symbol} ${item.name}`.slice(0, 80);
  }

  function renderRanking() {
    for (const button of elements.rankingTabs.querySelectorAll("[data-ranking]")) {
      const selected = button.dataset.ranking === selectedRanking;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    elements.rankingList.replaceChildren();
    const rows = snapshot?.rankings?.[selectedRanking] ?? [];
    for (const [index, item] of rows.entries()) {
      const button = element("button", "market-ranking-row");
      button.type = "button";
      button.dataset.liveInstrument = instrumentSubject(item);
      button.dataset.tone = item.changePercent > 0 ? "up" : item.changePercent < 0 ? "down" : "flat";
      const identity = element("span", "market-ranking-identity");
      identity.append(
        element("i", "", String(index + 1).padStart(2, "0")),
        element("b", "", item.name),
        element("small", "", item.symbol),
      );
      button.append(
        identity,
        element("span", "market-ranking-price", item.price.toLocaleString("zh-CN", { maximumFractionDigits: 2 })),
        element("strong", "market-ranking-change", formatPercent(item.changePercent)),
        element("span", "market-ranking-amount", formatAmount(item.amount)),
      );
      elements.rankingList.append(button);
    }
    if (rows.length === 0) elements.rankingList.append(element("p", "market-terminal-empty", "本次没有可显示的排行数据"));
  }

  function renderSessionContent(displayPhase) {
    if (["settling", "close-pending"].includes(displayPhase)) {
      const settling = displayPhase === "settling";
      elements.eyebrow.textContent = settling ? "CLOSE SETTLEMENT · A SHARE" : "CLOSE SNAPSHOT PENDING · A SHARE";
      elements.title.textContent = settling ? "A 股收盘结算中" : "A 股等待收盘快照";
      elements.refresh.textContent = "重试收盘数据";
      elements.sectorsTitle.textContent = "收盘前最后板块温度";
      elements.rankingsTitle.textContent = "收盘前最后排行";
      elements.headlinesEyebrow.textContent = "CLOSE TRANSITION NEWS";
      elements.headlinesTitle.textContent = "收盘过渡期要闻";
      elements.attentionEyebrow.textContent = "CLOSE PENDING";
      elements.attentionTitle.textContent = "收盘前线索 · 待确认";
      elements.attentionSummary.textContent = settling
        ? "交易已结束，数据源仍在汇总最终成交；15:10 后取得完整收盘快照再确认趋势。"
        : "尚未取得通过校验的完整收盘快照，暂时保留最后一份盘中数据。";
      elements.homeAttentionTitle.textContent = "收盘待确认";
      elements.homeAttentionSummary.textContent = settling ? "最终成交汇总中 · 15:10 后确认" : "旧盘中快照 · 等待刷新";
      return;
    }
    if (displayPhase === "intraday") {
      elements.eyebrow.textContent = "INTRADAY MARKET · A SHARE";
      elements.title.textContent = "A 股盘中观察";
      elements.refresh.textContent = "刷新盘中";
      elements.sectorsTitle.textContent = "盘中板块温度";
      elements.rankingsTitle.textContent = "盘中排行";
      elements.headlinesEyebrow.textContent = "INTRADAY TAPE";
      elements.headlinesTitle.textContent = "盘中多源要闻";
      elements.attentionEyebrow.textContent = "INTRADAY WATCH";
      elements.attentionTitle.textContent = "盘中关注";
      elements.attentionSummary.textContent = "看成交活跃、温和走强且未触及价格上限的盘中线索；收盘前不确认趋势。";
      elements.homeAttentionTitle.textContent = "盘中关注";
      elements.homeAttentionSummary.textContent = "活跃 · 非涨停 · 待收盘";
      return;
    }
    if (displayPhase === "previous-close") {
      elements.eyebrow.textContent = "LAST CLOSE · A SHARE";
      elements.title.textContent = "A 股最近收盘概览";
      elements.refresh.textContent = "读取最近收盘";
      elements.sectorsTitle.textContent = "最近收盘板块";
      elements.rankingsTitle.textContent = "最近收盘排行";
      elements.headlinesEyebrow.textContent = "OFF-HOURS NEWS";
      elements.headlinesTitle.textContent = "休市多源要闻";
      elements.attentionEyebrow.textContent = "LAST CLOSE REVIEW";
      elements.attentionTitle.textContent = "最近收盘异动";
      elements.attentionSummary.textContent = "用最近完整收盘的量价线索准备下一交易日，并结合休市公告与新闻。";
      elements.homeAttentionTitle.textContent = "收盘异动";
      elements.homeAttentionSummary.textContent = "最近收盘 · 公告 · 待验证";
      return;
    }
    elements.eyebrow.textContent = "AFTER CLOSE · A SHARE";
    elements.title.textContent = "A 股收盘复盘";
    elements.refresh.textContent = "刷新收盘";
    elements.sectorsTitle.textContent = "收盘板块强弱";
    elements.rankingsTitle.textContent = "收盘排行";
    elements.headlinesEyebrow.textContent = "AFTER-CLOSE NEWS";
    elements.headlinesTitle.textContent = "收盘后多源要闻";
    elements.attentionEyebrow.textContent = "CLOSE REVIEW";
    elements.attentionTitle.textContent = "收盘异动复核";
    elements.attentionSummary.textContent = "复核全日成交、涨跌幅与换手的完整结果，再结合趋势、公告和基本面。";
    elements.homeAttentionTitle.textContent = "收盘异动";
    elements.homeAttentionSummary.textContent = "全日量价 · 公告 · 次日计划";
  }

  function renderOverview() {
    elements.overviewRoot.dataset.state = loading ? "loading" : snapshot ? "ready" : "empty";
    elements.overviewIndexes.replaceChildren();
    elements.overviewSectors.replaceChildren();
    if (!snapshot) {
      selectedSectorId = null;
      if (elements.overviewSectorDetail) elements.overviewSectorDetail.hidden = true;
      elements.overviewSession.textContent = loading ? "正在读取行情" : "等待行情";
      elements.overviewIndexes.append(
        ...Array.from({ length: 4 }, () => element("div", "market-home-skeleton")),
      );
      elements.overviewSectors.append(element("p", "", "正在扫描板块…"));
      elements.overviewNews.disabled = true;
      delete elements.overviewNews.dataset.liveHeadlineUrl;
      elements.overviewNews.replaceChildren(
        element("span", "", "快讯"),
        element("b", "", "正在读取多源市场要闻…"),
        element("i", "", "—"),
      );
      return;
    }
    const displayPhase = displayedAShareSessionPhase(snapshot, now());
    const phaseLabel = displayPhase === "settling"
      ? "收盘结算中"
      : displayPhase === "close-pending"
        ? "等待收盘快照"
        : displayPhase === "intraday"
          ? "盘中实时"
          : displayPhase === "previous-close"
            ? "最近收盘"
            : "当日收盘";
    elements.overviewSession.textContent = `${phaseLabel} · ${snapshot.marketDate} ${formatClock(snapshot.asOf)}`;
    for (const index of snapshot.indexes) {
      const button = element("button", "market-home-index");
      button.type = "button";
      button.dataset.liveIndexSymbol = index.symbol;
      button.setAttribute("aria-pressed", String(index.symbol === selectedIndexSymbol));
      button.dataset.tone = index.changePercent > 0 ? "up" : index.changePercent < 0 ? "down" : "flat";
      if (lastDelta?.indexes.has(index.symbol)) button.dataset.changed = "true";
      button.append(
        element("span", "", index.name),
        element("b", "", index.price.toLocaleString("zh-CN", { maximumFractionDigits: 2 })),
        element("strong", "", formatPercent(index.changePercent)),
        element("i", "", "详情 →"),
      );
      elements.overviewIndexes.append(button);
    }
    if (snapshot.indexes.length === 0) {
      elements.overviewIndexes.append(element("p", "market-home-unavailable", "指数源本次不可用"));
    }
    const headline = snapshot.headlines[0];
    elements.overviewNews.replaceChildren(
      element("span", "", headline ? "热议" : "快讯"),
      element("b", "", headline?.title ?? "快讯源本次不可用，不能据此判断没有热点"),
      element("i", "", headline ? "→" : "—"),
    );
    elements.overviewNews.disabled = !headline;
    if (headline) elements.overviewNews.dataset.liveHeadlineUrl = headline.url;
    else delete elements.overviewNews.dataset.liveHeadlineUrl;
    for (const [index, sector] of snapshot.sectors.entries()) {
      const button = element("button", "market-home-sector");
      button.type = "button";
      button.dataset.overviewSector = sector.id;
      button.dataset.direction = sector.direction;
      button.setAttribute("aria-pressed", String(sector.id === selectedSectorId));
      if (lastDelta?.sectors.has(sector.id)) button.dataset.changed = "true";
      button.append(
        element("i", "", String(index + 1).padStart(2, "0")),
        element("b", "", sector.name),
        element("strong", "", formatPercent(sector.changePercent)),
        element("small", "", sector.leaderName ? `领涨 ${sector.leaderName}` : sector.direction === "leading" ? "强势" : "偏弱"),
      );
      elements.overviewSectors.append(button);
    }
    if (snapshot.sectors.length === 0) {
      elements.overviewSectors.append(element("p", "", "板块源本次不可用"));
    }
    renderIndexDetail();
    renderSectorDetail();
  }

  function renderSectorDetail() {
    if (!elements.overviewSectorDetail) return;
    const sector = snapshot?.sectors.find((item) => item.id === selectedSectorId) ?? null;
    if (!sector) {
      elements.overviewSectorDetail.hidden = true;
      return;
    }
    elements.overviewSectorDetail.hidden = false;
    const displayPhase = displayedAShareSessionPhase(snapshot, now());
    elements.overviewSectorDetailName.textContent = sector.name;
    elements.overviewSectorDetailStats.replaceChildren();
    for (const [label, value] of [
      ["实时涨跌", formatPercent(sector.changePercent)],
      ["成交额", formatAmount(sector.amount)],
      ["当前强弱", sector.direction === "leading" ? "领涨板块" : "相对居后"],
      ["行情阶段", displayPhase === "settling" ? "收盘结算中" : displayPhase === "close-pending" ? "等待完整收盘" : displayPhase === "intraday" ? "盘中变化中" : displayPhase === "close" ? "完整收盘" : "最近收盘"],
    ]) {
      const row = element("div", "");
      row.append(element("dt", "", label), element("dd", "", value));
      elements.overviewSectorDetailStats.append(row);
    }
    elements.overviewSectorDetailLeader.textContent = sector.leaderName
      ? `${sector.leaderName}${sector.leaderChangePercent == null ? "" : ` · ${formatPercent(sector.leaderChangePercent)}`}`
      : "本次未取得领涨股";
    elements.overviewSectorDetailNote.textContent = ["settling", "close-pending"].includes(displayPhase)
      ? "当前仍是最后盘中板块数据，完整收盘快照通过校验前不当作收盘结果。"
      : displayPhase === "intraday"
        ? "板块成分平均涨跌和领涨股会随盘中行情变化；进入选股可看趋势、位置和风险过滤。"
        : "当前为收盘板块强弱；进入选股可查看成分趋势、位置与公告风险。";
    elements.overviewSectorDetailStock.disabled = !sector.leaderSymbol;
    elements.overviewSectorDetailStock.dataset.liveSectorStock = sector.leaderSymbol
      ? `${sector.leaderSymbol} ${sector.leaderName}`
      : "";
    elements.overviewSectorDetailSelection.dataset.liveSectorSelection = sector.id;
  }

  function renderIndexDetail() {
    if (!elements.overviewIndexDetail) return;
    const index = snapshot?.indexes.find((item) => item.symbol === selectedIndexSymbol) ?? null;
    if (!index) {
      elements.overviewIndexDetail.hidden = true;
      return;
    }
    const reportItem = snapshot.report.items.find((item) =>
      item.symbol === index.symbol || item.symbol === index.symbol.replace("指数 ", "") || item.name === index.name,
    ) ?? null;
    elements.overviewIndexDetail.hidden = false;
    elements.overviewIndexDetailName.textContent = index.name;
    elements.overviewIndexDetailStats.replaceChildren();
    for (const [label, value] of [
      ["当前点位", index.price.toLocaleString("zh-CN", { maximumFractionDigits: 2 })],
      ["当日涨跌", formatPercent(index.changePercent)],
      ["成交额", formatAmount(index.amount)],
      ["数据时点", formatClock(index.asOf)],
    ]) {
      const row = element("div", "");
      row.append(element("span", "", label), element("strong", "", value));
      elements.overviewIndexDetailStats.append(row);
    }
    elements.overviewIndexDetailTrend.textContent = reportItem
      ? `${reportItem.title}。${reportItem.detail}`
      : "指数历史本次不可用，只展示当前点位与成交信息。";
    elements.overviewIndexDetailRisk.textContent = reportItem?.risk ?? "没有合格历史时不估算均线、阶段或长期位置。";
  }

  function selectIndex(symbol) {
    if (!snapshot?.indexes.some((item) => item.symbol === symbol)) return false;
    selectedIndexSymbol = symbol;
    renderOverview();
    elements.overviewIndexDetail?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    onIndex(snapshot.indexes.find((item) => item.symbol === symbol));
    return true;
  }

  function selectSector(id) {
    if (!snapshot?.sectors.some((item) => item.id === id)) return false;
    selectedSectorId = id;
    render();
    elements.overviewSectorDetail?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return true;
  }

  function render() {
    renderOverview();
    elements.root.setAttribute("aria-busy", String(loading));
    elements.refresh.disabled = loading;
    if (!snapshot) {
      elements.root.dataset.state = loading ? "loading" : elements.status.dataset.tone === "error" ? "error" : "empty";
      elements.badge.textContent = loading ? "正在连接" : "等待行情";
      elements.refresh.textContent = loading ? "连接中…" : "立即刷新";
      delete elements.badge.dataset.phase;
      elements.indexes.replaceChildren(
        ...Array.from({ length: 4 }, () => element("div", "live-market-skeleton")),
      );
      for (const output of [elements.up, elements.down, elements.flat, elements.amount, elements.limits, elements.median]) {
        output.textContent = "—";
        delete output.dataset.tone;
      }
      elements.sectors.replaceChildren();
      elements.sources.replaceChildren();
      elements.time.textContent = "行情时点待获取";
      elements.summary.textContent = "行情就绪后，这里直接显示两句盘面摘要。";
      renderRanking();
      elements.headlines.replaceChildren(element("p", "market-terminal-empty", "正在读取财经快讯…"));
      elements.headlinesTime.textContent = "快讯 / 资讯 / 官方";
      elements.dragonTiger.replaceChildren(element("p", "market-terminal-empty", "正在读取最新榜单…"));
      elements.dragonTigerDate.textContent = "最近完整交易日";
      elements.attention.replaceChildren(element("p", "market-terminal-empty", "正在生成盘中关注线索…"));
      if (elements.anomalyBoard) {
        elements.anomalyBoard.dataset.state = "empty";
        elements.anomalySummary.textContent = "等待行情";
        elements.anomalyTypes.replaceChildren();
        elements.anomalyList.replaceChildren(element("p", "market-terminal-empty", "正在按交易时段识别异动…"));
      }
      renderRealtime();
      return;
    }
    const { breadth } = snapshot;
    const displayPhase = displayedAShareSessionPhase(snapshot, now());
    elements.root.dataset.state = loading ? "refreshing" : elements.status.dataset.tone === "warning" ? "warning" : "ready";
    elements.badge.textContent = loading
      ? "正在刷新"
      : displayPhase === "settling"
        ? "收盘结算中"
        : displayPhase === "close-pending"
          ? "等待收盘"
          : displayPhase === "intraday"
            ? "盘中 · 自动刷新"
            : displayPhase === "previous-close"
              ? "最近收盘"
              : "收盘 · 自动更新";
    elements.badge.dataset.phase = displayPhase;
    renderSessionContent(displayPhase);
    if (loading) elements.refresh.textContent = "刷新中…";
    const summarySentences = snapshot.report.summary.match(/[^。！？]+[。！？]?/gu) ?? [snapshot.report.summary];
    elements.summary.textContent = summarySentences.slice(0, 2).join("");
    elements.indexes.replaceChildren();
    for (const index of snapshot.indexes) {
      const button = element("button", "live-market-index");
      button.type = "button";
      button.dataset.liveIndexSymbol = index.symbol;
      button.setAttribute("aria-pressed", String(index.symbol === selectedIndexSymbol));
      button.dataset.tone = index.changePercent > 0 ? "up" : index.changePercent < 0 ? "down" : "flat";
      if (lastDelta?.indexes.has(index.symbol)) button.dataset.changed = "true";
      button.setAttribute("aria-label", `查看 ${index.name}详情`);
      const heading = element("span", "live-market-index-name", index.name);
      heading.append(element("small", "", index.symbol.replace("指数 ", "")));
      button.append(
        heading,
        element("b", "live-market-index-price", index.price.toLocaleString("zh-CN", { maximumFractionDigits: 2 })),
        element("i", "live-market-index-change", formatPercent(index.changePercent)),
      );
      elements.indexes.append(button);
    }
    if (snapshot.indexes.length === 0) {
      elements.indexes.append(element("p", "live-market-unavailable", "主要指数源本次不可用；市场宽度仍按已取得的全市场快照展示。"));
    }
    elements.up.textContent = breadth.up.toLocaleString("zh-CN");
    elements.down.textContent = breadth.down.toLocaleString("zh-CN");
    elements.flat.textContent = breadth.flat.toLocaleString("zh-CN");
    elements.amount.textContent = formatAmount(breadth.amount);
    elements.limits.textContent = `${breadth.limitUp} / ${breadth.limitDown}`;
    elements.median.textContent = formatPercent(breadth.medianChange);
    for (const output of [elements.up, elements.down, elements.flat, elements.amount, elements.limits, elements.median]) {
      if (lastDelta?.breadth) output.parentElement.dataset.changed = "true";
      else delete output.parentElement.dataset.changed;
    }
    elements.up.dataset.tone = "up";
    elements.down.dataset.tone = "down";
    elements.median.dataset.tone = breadth.medianChange > 0 ? "up" : breadth.medianChange < 0 ? "down" : "flat";

    elements.sectors.replaceChildren();
    for (const sector of snapshot.sectors) {
      const row = element("button", "live-market-sector");
      row.type = "button";
      row.dataset.liveSector = sector.id;
      row.dataset.direction = sector.direction;
      row.setAttribute("aria-pressed", String(sector.id === selectedSectorId));
      if (lastDelta?.sectors.has(sector.id)) row.dataset.changed = "true";
      row.append(
        element("span", "", sector.direction === "leading" ? "领涨" : "居后"),
        element("b", "", sector.name),
        element("i", "", formatPercent(sector.changePercent)),
        element("small", "", sector.leaderName ? `领涨股 ${sector.leaderName}` : "查看详情"),
        element("em", "", "→"),
      );
      row.title = sector.leaderName
        ? `领涨股 ${sector.leaderName}${sector.leaderChangePercent == null ? "" : ` ${formatPercent(sector.leaderChangePercent)}`}`
        : "板块成分平均涨跌";
      elements.sectors.append(row);
    }
    if (snapshot.sectors.length === 0) elements.sectors.append(element("span", "live-market-unavailable", "板块源本次不可用"));

    renderRanking();

    elements.headlines.replaceChildren();
    for (const headline of snapshot.headlines) {
      const button = element("button", "live-headline-row");
      button.type = "button";
      button.dataset.liveHeadlineUrl = headline.url;
      const copy = element("span", "live-headline-copy");
      copy.append(
        element("b", "", headline.title),
        element("small", "", `${headline.sourceLabel} · ${headline.sourceCount > 1 ? `${headline.sourceCount} 个独立来源` : "单一来源"}${headline.official ? " · 官方原文" : ""}`),
      );
      button.append(
        element("time", "", formatClock(headline.publishedAt)),
        copy,
      );
      elements.headlines.append(button);
    }
    if (snapshot.headlines.length === 0) {
      elements.headlines.append(element("p", "market-terminal-empty", "快讯源本次不可用，不能据此判断没有热点"));
    }
    elements.headlinesTime.textContent = snapshot.headlines.length ? `${snapshot.headlines.length} 条 · 快讯 / 资讯 / 官方` : "来源降级";

    elements.dragonTiger.replaceChildren();
    for (const item of snapshot.dragonTiger.entries) {
      const button = element("button", "dragon-tiger-row");
      button.type = "button";
      button.dataset.liveInstrument = instrumentSubject(item);
      button.dataset.direction = item.direction;
      const identity = element("span", "dragon-tiger-identity");
      identity.append(element("b", "", item.name), element("small", "", item.symbol));
      const net = element("strong", "", `${item.netBuyAmount > 0 ? "+" : ""}${formatAmount(item.netBuyAmount)}`);
      const detail = element("span", "dragon-tiger-detail", item.explanation || "上榜原因未提供");
      button.append(identity, net, detail, element("i", "", formatPercent(item.changePercent)));
      elements.dragonTiger.append(button);
    }
    if (snapshot.dragonTiger.entries.length === 0) {
      elements.dragonTiger.append(element("p", "market-terminal-empty", "龙虎榜源本次不可用，保留其他实时行情"));
    }
    elements.dragonTigerDate.textContent = snapshot.dragonTiger.marketDate ?? "最近完整交易日";

    elements.attention.replaceChildren();
    for (const item of snapshot.attention.slice(0, 6)) {
      const article = element("article", "live-attention-item");
      article.dataset.tone = item.changePercent >= 0 ? "up" : "down";
      const heading = element("header", "");
      const identity = element("span", "");
      identity.append(element("b", "", item.name), element("small", "", item.symbol));
      heading.append(identity, element("strong", "", formatPercent(item.changePercent)));
      const action = element("button", "", "查看数据");
      action.type = "button";
      action.dataset.liveInstrument = instrumentSubject(item);
      article.append(heading, element("p", "", item.reason), element("small", "", item.risk), action);
      elements.attention.append(article);
    }
    if (snapshot.attention.length === 0) {
      elements.attention.append(element("p", "market-terminal-empty", "当前没有同时通过流动性、涨幅、换手与非涨停门槛的标的"));
    }

    if (elements.anomalyBoard) {
      const anomaly = snapshot.anomalyBoard;
      const labels = {
        "gap-up": "高开偏离",
        "opening-reversal": "低开修复",
        "intraday-surge": "盘中拉升",
        "intraday-dive": "盘中跳水",
        "large-amplitude": "宽幅震荡",
        "market-deviation": "相对偏离",
      };
      elements.anomalyBoard.dataset.state = anomaly.items.length ? "ready" : "empty";
      elements.anomalyTitle.textContent = `${anomaly.sessionLabel || "当前时段"}异动分型`;
      elements.anomalySummary.textContent = `${anomaly.items.length} 只 · 市场中位 ${Number.isFinite(anomaly.marketMedian) ? formatPercent(anomaly.marketMedian) : "—"}`;
      elements.anomalyTypes.replaceChildren();
      for (const [type, count] of Object.entries(anomaly.counts)) {
        const chip = element("span", "", `${labels[type] ?? type} ${count}`);
        chip.dataset.type = type;
        elements.anomalyTypes.append(chip);
      }
      elements.anomalyList.replaceChildren();
      for (const item of anomaly.items.slice(0, 6)) {
        const button = element("button", "live-anomaly-item");
        button.type = "button";
        button.dataset.liveInstrument = instrumentSubject(item);
        button.dataset.direction = item.direction;
        const identity = element("span", "");
        identity.append(element("b", "", item.name), element("small", "", `${item.symbol} · ${item.typeLabel}`));
        button.append(identity, element("p", "", item.reason), element("strong", "", formatPercent(item.changePercent)), element("i", "", "→"));
        button.title = item.risk;
        elements.anomalyList.append(button);
      }
      if (!anomaly.items.length) elements.anomalyList.append(element("p", "market-terminal-empty", "当前快照没有达到分型阈值的异动。"));
      elements.anomalyDisclosure.textContent = anomaly.methodology;
    }

    elements.sources.replaceChildren();
    const sources = snapshot.report.sources.filter((source, index, values) =>
      values.findIndex((candidate) => new URL(candidate.url).hostname === new URL(source.url).hostname) === index,
    );
    for (const source of sources) {
      const button = element("button", "live-market-source", source.label.split(" · ")[0]);
      button.type = "button";
      button.dataset.liveSourceUrl = source.url;
      button.title = source.label;
      elements.sources.append(button);
    }
    const refreshLabel = displayPhase === "settling"
      ? "结算期每 3 分钟"
      : displayPhase === "close-pending"
        ? "等待收盘每 15 分钟"
        : displayPhase === "intraday"
          ? "盘中每 3 分钟"
          : "收盘后每 15 分钟";
    elements.time.textContent = `行情 ${snapshot.marketDate} ${formatClock(snapshot.asOf)} · 本机刷新 ${formatClock(snapshot.generatedAt)} · ${refreshLabel}`;
    renderRealtime();
  }

  async function ensureRuntime() {
    if (runtime) return runtime;
    if (typeof onHostEvent !== "function") throw new Error("实时行情需在 CodeShell 投资工作台内运行");
    let selected = null;
    for (const spec of LIVE_RUNTIME_SPECS) {
      let executable;
      try {
        executable = await hostCall("process.find", { name: spec.name });
      } catch {
        throw new Error(
          "当前 CodeShell 会话尚未加载新版行情运行权限，请完全退出并重新打开 CodeShell",
        );
      }
      if (executable?.available && typeof executable.handle === "string") {
        selected = { executable, spec };
        break;
      }
    }
    if (!selected) {
      throw new Error(
        "当前 CodeShell 会话未发现 Node.js 或 Bun。若刚完成应用更新，请完全退出并重新打开 CodeShell",
      );
    }
    let directory = null;
    let persistent = false;
    try {
      directory = await hostCall("filesystem.getKnownDirectory", { name: "app-data" });
      persistent = true;
    } catch {
      directory = await hostCall("filesystem.getKnownDirectory", { name: "downloads" });
    }
    if (typeof directory?.handle !== "string") throw new Error("无法取得受限的行情运行目录");
    runtime = {
      executableHandle: selected.executable.handle,
      directoryHandle: directory.handle,
      name: selected.spec.name,
      label: selected.spec.label,
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
        reject(new Error("实时行情刷新超时，已停止本次任务"));
      }, PROCESS_TIMEOUT_MS);
      record.resolve = (next) => {
        window.clearTimeout(timeout);
        record.resolve = null;
        resolve(next);
      };
    });
  }

  async function fetchSnapshot(mode = "refresh") {
    const handles = await ensureRuntime();
    if (mode === "read-local" && !handles.persistent) throw new Error("当前 CodeShell 不支持面板本地数据目录");
    const runtimeMode = mode === "read-local"
      ? "read-local"
      : handles.persistent
        ? "refresh-local"
        : "refresh-volatile";
    const started = await hostCall("process.spawn", {
      executableHandle: handles.executableHandle,
      directoryHandle: handles.directoryHandle,
      args: liveMarketRuntimeArgs(handles.name, runtimeMode),
    });
    if (typeof started?.processId !== "string") throw new Error("行情程序未能启动");
    const processId = started.processId;
    activeProcessId = processId;
    let record;
    try {
      record = await waitForExit(processId);
    } finally {
      if (activeProcessId === processId) activeProcessId = null;
      finalizeProcess(processId);
    }
    if (record.exit?.code !== 0) throw new Error(liveMarketErrorMessage(record.stderr));
    return parseLiveMarketSnapshot(record.stdout);
  }

  async function load({ manual = false } = {}) {
    if (loading) return snapshot;
    const loadGeneration = generation;
    clearRefreshTimer();
    loading = true;
    elements.status.dataset.tone = "active";
    elements.status.textContent = snapshot
      ? "正在刷新公开行情；现有数据会保留到新快照通过校验。"
      : "正在连接公开行情；首次使用会请你确认一次本机只读行情程序。";
    render();
    try {
      if (!snapshot) {
        const cached = await fetchSnapshot("read-local").catch(() => null);
        if (cached && loadGeneration === generation) {
          lastDelta = snapshotDelta(snapshot, cached);
          snapshot = cached;
          lastRefreshFailed = false;
          elements.status.dataset.tone = "warning";
          elements.status.textContent = `已载入 ${cached.marketDate} 本地行情快照，正在后台核验最新数据。`;
          onUpdate(cached, { source: "cache" });
          render();
        }
      }
      const next = await fetchSnapshot();
      if (loadGeneration !== generation) return snapshot;
      const futureMs = Date.parse(next.asOf) - now().getTime();
      if (futureMs > 60 * 60 * 1_000) throw new Error("行情时点晚于当前时间，已拒绝显示");
      lastDelta = snapshotDelta(snapshot, next);
      snapshot = next;
      retryDelayMs = Object.values(next.sourceErrors).some((message) => /频率限制/u.test(message)) ? CLOSED_REFRESH_MS : 0;
      lastRefreshFailed = false;
      const localPersistence = (await ensureRuntime()).persistent;
      const degraded = Object.values(next.sourceStatus).some((available) => !available) || next.validationWarnings.length > 0;
      const nextDisplayPhase = displayedAShareSessionPhase(next, now());
      elements.status.dataset.tone = degraded ? "warning" : "active";
      elements.status.textContent = [
        `已自动读取 ${next.breadth.total.toLocaleString("zh-CN")} 只沪深股票，耗时 ${(next.elapsedMs / 1_000).toFixed(1)} 秒。`,
        nextDisplayPhase === "settling"
          ? "交易已结束，15:00–15:10 为收盘数据汇总期；当前保留最后盘中快照，暂不冒充完整收盘。"
          : nextDisplayPhase === "close-pending"
            ? "已过收盘汇总期，但尚未取得完整收盘快照；页面暂时保留最后盘中数据。"
            : nextDisplayPhase === "intraday"
              ? "当前为盘中累计，价格、成交额与板块排名会继续变化。"
              : nextDisplayPhase === "previous-close"
                ? `当前显示 ${next.marketDate} 最近收盘，可能处于休市时段。`
                : "当前为当日收盘快照。",
        degraded ? `部分数据已降级：${[...new Set([...Object.values(next.sourceErrors), ...next.validationWarnings])].join("；") || "辅助数据源本次不可用"}。` : "公开行情采集与数据校验已完成。",
        localPersistence
          ? `快照已保存到 CodeShell 本地数据目录，并同步留存 ${next.breadth.total.toLocaleString("zh-CN")} 只股票的当日行情。`
          : "当前 CodeShell 版本仅保留本次会话快照。",
      ].join("");
      onUpdate(next, { source: "network" });
      return next;
    } catch (error) {
      if (loadGeneration !== generation) return snapshot;
      const message = friendlyMarketFailure(error instanceof Error ? error.message : "公开行情刷新失败");
      lastRefreshFailed = true;
      retryDelayMs = /频率限制/u.test(message) ? CLOSED_REFRESH_MS : Math.min(CLOSED_REFRESH_MS, Math.max(OPEN_REFRESH_MS, retryDelayMs * 2));
      elements.status.dataset.tone = snapshot ? "warning" : "error";
      elements.status.textContent = snapshot
        ? `本次刷新失败：${message}。已保留上一次通过校验的行情。`
        : `${message}。可点「立即刷新」重试；大盘行情不需要运行诊断任务。`;
      if (manual) throw error;
      return snapshot;
    } finally {
      if (loadGeneration === generation) {
        loading = false;
        render();
        scheduleRefresh();
      }
    }
  }

  elements.refresh.addEventListener("click", () => void load({ manual: true }).catch(() => undefined));
  elements.rankingTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-ranking]");
    if (!button || !["gainers", "losers", "active"].includes(button.dataset.ranking)) return;
    selectedRanking = button.dataset.ranking;
    renderRanking();
  });
  elements.rankingList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-live-instrument]");
    if (button) onStock(button.dataset.liveInstrument);
  });
  elements.indexes.addEventListener("click", (event) => {
    const button = event.target.closest("[data-live-index-symbol]");
    if (button) selectIndex(button.dataset.liveIndexSymbol);
  });
  elements.overviewIndexes.addEventListener("click", (event) => {
    const button = event.target.closest("[data-live-index-symbol]");
    if (button) selectIndex(button.dataset.liveIndexSymbol);
  });
  elements.overviewIndexDetailClose?.addEventListener("click", () => {
    selectedIndexSymbol = null;
    renderOverview();
  });
  elements.overviewSectors.addEventListener("click", (event) => {
    const button = event.target.closest("[data-overview-sector]");
    if (button) selectSector(button.dataset.overviewSector);
  });
  elements.sectors.addEventListener("click", (event) => {
    const button = event.target.closest("[data-live-sector]");
    if (button) selectSector(button.dataset.liveSector);
  });
  elements.overviewSectorDetailClose?.addEventListener("click", () => {
    selectedSectorId = null;
    render();
  });
  elements.overviewSectorDetailStock?.addEventListener("click", () => {
    const subject = elements.overviewSectorDetailStock.dataset.liveSectorStock;
    if (subject) onStock(subject);
  });
  elements.overviewSectorDetailSelection?.addEventListener("click", () => {
    const id = elements.overviewSectorDetailSelection.dataset.liveSectorSelection;
    const sector = snapshot?.sectors.find((item) => item.id === id);
    if (sector) onSector(sector.id, sector);
  });
  elements.sources.addEventListener("click", (event) => {
    const button = event.target.closest("[data-live-source-url]");
    if (!button) return;
    void hostCall("external.open", { url: button.dataset.liveSourceUrl }).catch((error) => {
      elements.status.dataset.tone = "error";
      elements.status.textContent = error instanceof Error ? error.message : "行情来源无法打开";
      render();
    });
  });
  elements.headlines.addEventListener("click", (event) => {
    const button = event.target.closest("[data-live-headline-url]");
    if (!button) return;
    void hostCall("external.open", { url: button.dataset.liveHeadlineUrl }).catch((error) => {
      elements.status.dataset.tone = "error";
      elements.status.textContent = error instanceof Error ? error.message : "快讯来源无法打开";
      render();
    });
  });
  elements.overviewNews.addEventListener("click", () => {
    const url = elements.overviewNews.dataset.liveHeadlineUrl;
    if (!url) return;
    void hostCall("external.open", { url }).catch((error) => {
      elements.status.dataset.tone = "error";
      elements.status.textContent = error instanceof Error ? error.message : "快讯来源无法打开";
      render();
    });
  });
  for (const container of [elements.dragonTiger, elements.attention, elements.anomalyList].filter(Boolean)) {
    container.addEventListener("click", (event) => {
      const button = event.target.closest("[data-live-instrument]");
      if (button) onStock(button.dataset.liveInstrument);
    });
  }

  render();
  return {
    selectIndex,
    load,
    start() {
      active = true;
      startUiTimer();
      if (!snapshot) return load();
      scheduleRefresh();
      return Promise.resolve(snapshot);
    },
    // One-shot freshness probe for app restore/visibility transitions. Unlike
    // start(), this does not opt a hidden Market module into periodic polling;
    // load() observes active=false and stops after the verified snapshot.
    refreshOnce() {
      return load();
    },
    setActive(next) {
      active = Boolean(next);
      if (!active) {
        clearRefreshTimer();
        clearUiTimer();
        renderRealtime();
      } else {
        startUiTimer();
        if (!loading && !snapshot) void load();
        else if (!loading) scheduleRefresh();
      }
    },
    reset() {
      generation += 1;
      clearRefreshTimer();
      if (activeProcessId) {
        void hostCall("process.cancel", { processId: activeProcessId }).catch(() => undefined);
      }
      activeProcessId = null;
      snapshot = null;
      onUpdate(null, { source: "reset" });
      selectedSectorId = null;
      lastDelta = null;
      lastRefreshFailed = false;
      loading = false;
      elements.status.dataset.tone = "active";
      elements.status.textContent = "工作区已切换，正在重新连接公开行情。";
      render();
    },
    dispose() {
      generation += 1;
      clearRefreshTimer();
      clearUiTimer();
      unsubscribeOutput?.();
      unsubscribeExit?.();
    },
    get snapshot() {
      return snapshot;
    },
  };
}

export const LIVE_MARKET_REFRESH_POLICY = Object.freeze({
  openMs: OPEN_REFRESH_MS,
  closedMs: CLOSED_REFRESH_MS,
});
