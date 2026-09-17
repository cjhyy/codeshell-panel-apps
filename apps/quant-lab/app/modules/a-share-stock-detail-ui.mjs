import { displayedAShareSessionPhase } from "./a-share-session.mjs";

const SNAPSHOT_SCHEMA_VERSION = 1;
const SNAPSHOT_KINDS = Object.freeze({
  cn: "a-share-stock-detail-snapshot",
  us: "us-stock-detail-snapshot",
});
const MAX_SNAPSHOT_BYTES = 1_500_000;
const MAX_PROCESS_OUTPUT_CHARS = 2_000_000;
const PROCESS_TIMEOUT_MS = 35_000;

const NODE_LAUNCHER = [
  'import { join } from "node:path";',
  'import { pathToFileURL } from "node:url";',
  'const home = process.env.HOME || process.env.USERPROFILE;',
  'if (!home) throw new Error("user-home-unavailable");',
  'const [market = "cn", mode = "refresh-volatile", query = ""] = process.argv.slice(-3);',
  'const toolName = market === "us" ? "fetch-us-stock.mjs" : "fetch-a-share-stock.mjs";',
  'const tool = join(home, ".code-shell", "panel-apps", "quant-lab", "app", "tools", toolName);',
  'const module = await import(pathToFileURL(tool).href);',
  'const args = mode === "read-local" ? ["--query", query, "--stdout", "--read-local"] : mode === "refresh-local" ? ["--query", query, "--stdout", "--persist-local"] : ["--query", query, "--stdout"];',
  'try { await module.runCli(args); } catch (error) { process.stderr.write(JSON.stringify({ ok: false, errorCode: error?.code ?? error?.cause?.code ?? "STOCK_DETAIL_ERROR", message: error instanceof Error ? error.message : "stock detail failed" }) + "\\n"); process.exitCode = 1; }',
].join("\n");

const RUNTIME_SPECS = Object.freeze([
  Object.freeze({ name: "node", label: "Node.js" }),
  Object.freeze({ name: "nodejs", label: "Node.js" }),
  Object.freeze({ name: "bun", label: "Bun" }),
]);

export function stockDetailRuntimeArgs(name, queryInput, mode = "refresh-volatile", marketInput = "cn") {
  const query = cleanText(queryInput, 80);
  const market = marketInput === "us" ? "us" : marketInput === "cn" ? "cn" : "";
  if (!query) throw new Error("请输入股票名称或代码");
  if (!market) throw new Error("个股市场不受支持");
  if (!new Set(["refresh-volatile", "refresh-local", "read-local"]).has(mode)) throw new Error("个股本地模式不受支持");
  if (mode === "read-local" && market === "cn" && !/^(?:SH|SZ)\d{6}$/u.test(query)) throw new Error("读取本地个股数据需要股票代码");
  if (mode === "read-local" && market === "us" && !/^[A-Z][A-Z0-9.-]{0,14}$/u.test(query)) throw new Error("读取本地美股数据需要股票代码");
  if (name === "node" || name === "nodejs") {
    return Object.freeze(["--input-type=module", "--eval", NODE_LAUNCHER, market, mode, query]);
  }
  if (name === "bun") return Object.freeze(["--eval", NODE_LAUNCHER, market, mode, query]);
  throw new Error("个股行情运行时不受支持");
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
  const allowed = ["qq.com", "eastmoney.com", "sina.com.cn", "csrc.gov.cn", "pbc.gov.cn", "yahoo.com", "sec.gov"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  if (url.protocol !== "https:" || !allowed || url.username || url.password) throw new Error(`${label}链接来源无效`);
  return url.toString();
}

function parseStock(value, market) {
  const symbol = cleanText(value?.symbol, 16);
  const code = cleanText(value?.code, 16);
  const name = cleanText(value?.name, 80);
  const board = market === "us"
    ? value?.board === "us" ? "us" : null
    : ["main", "star", "chinext"].includes(value?.board) ? value.board : null;
  const validIdentity = market === "us"
    ? /^[A-Z][A-Z0-9.-]{0,14}$/u.test(symbol) && code === symbol
    : /^(?:SH|SZ)\d{6}$/u.test(symbol) && code === symbol.slice(2);
  if (!validIdentity || !name || !board) throw new Error("个股身份无效");
  const nullableMarketField = { nullable: market === "us" };
  return Object.freeze({
    market,
    symbol,
    code,
    name,
    board,
    currency: market === "us" ? cleanText(value.currency, 8) || "USD" : "CNY",
    exchange: cleanText(value.exchange, 40),
    sector: cleanText(value.sector, 60),
    industry: cleanText(value.industry, 80),
    price: finiteNumber(value.price, 0.01, 1_000_000, "最新价"),
    open: finiteNumber(value.open, 0.01, 1_000_000, "开盘价"),
    high: finiteNumber(value.high, 0.01, 1_000_000, "最高价"),
    low: finiteNumber(value.low, 0.01, 1_000_000, "最低价"),
    previousClose: finiteNumber(value.previousClose, 0.01, 1_000_000, "昨收价"),
    change: finiteNumber(value.change, -1_000_000, 1_000_000, "涨跌额"),
    changePercent: finiteNumber(value.changePercent, market === "us" ? -100 : -30, market === "us" ? 1_000 : 30, "涨跌幅"),
    volume: integer(value.volume, 0, 1e15, "成交量"),
    amount: finiteNumber(value.amount, 0, 1e18, "成交额", nullableMarketField),
    turnover: finiteNumber(value.turnover, 0, 1_000, "换手率", nullableMarketField),
    pe: finiteNumber(value.pe, -1e7, 1e7, "市盈率", { nullable: true }),
    pb: finiteNumber(value.pb, -1e7, 1e7, "市净率", { nullable: true }),
    totalMarketCap: finiteNumber(value.totalMarketCap, 0, 1e18, "总市值", { nullable: true }),
    floatMarketCap: finiteNumber(value.floatMarketCap, 0, 1e18, "流通市值", { nullable: true }),
  });
}

function parseBar(value, marketDate) {
  const date = cleanText(value?.date, 10);
  if (!validDate(date) || date > marketDate) throw new Error("历史行情日期无效");
  const open = finiteNumber(value.open, 0.01, 1_000_000, "历史开盘价");
  const high = finiteNumber(value.high, 0.01, 1_000_000, "历史最高价");
  const low = finiteNumber(value.low, 0.01, 1_000_000, "历史最低价");
  const close = finiteNumber(value.close, 0.01, 1_000_000, "历史收盘价");
  if (high < Math.max(open, close) || low > Math.min(open, close)) throw new Error("历史行情价格冲突");
  return Object.freeze({ date, open, high, low, close, volume: integer(value.volume, 0, 1e15, "历史成交量") });
}

function metric(value, label) {
  return finiteNumber(value, -1e7, 1e7, label, { nullable: true });
}

function parseMetrics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("趋势指标结构无效");
  return Object.freeze({
    ma20: metric(value.ma20, "MA20"),
    ma60: metric(value.ma60, "MA60"),
    ma120: metric(value.ma120, "MA120"),
    return20: metric(value.return20, "20日收益"),
    return60: metric(value.return60, "60日收益"),
    return120: metric(value.return120, "120日收益"),
    volumeRatio20: metric(value.volumeRatio20, "20日量比"),
    extension20: metric(value.extension20, "20日均线偏离"),
    volatility20: metric(value.volatility20, "20日波动"),
    high120: metric(value.high120, "120日高点"),
    low120: metric(value.low120, "120日低点"),
    distanceHigh120: metric(value.distanceHigh120, "120日高点距离"),
    historyBars: integer(value.historyBars, 0, 180, "历史行情数量"),
    lastBarDate: value.lastBarDate === "" || validDate(value.lastBarDate) ? value.lastBarDate : (() => { throw new Error("末根行情日期无效"); })(),
  });
}

function parseFinancials(value, generatedAt, market) {
  if (value == null) return Object.freeze({
    version: 1,
    available: false,
    periods: Object.freeze([]),
    disclosure: market === "us"
      ? "美股结构化财务摘要尚未接入；公司研究仍会通过来源核验财报事实。"
      : "这份本地快照尚未包含公开财务摘要；刷新个股数据后自动补齐。",
  });
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 || !Array.isArray(value.periods) || value.periods.length > 8) {
    throw new Error("财务摘要版本无效");
  }
  const cutoff = new Date(Date.parse(generatedAt) + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  const seen = new Set();
  const periods = Object.freeze(value.periods.map((row) => {
    const reportDate = cleanText(row?.reportDate, 10);
    const noticeDate = cleanText(row?.noticeDate, 10);
    if (!validDate(reportDate) || !validDate(noticeDate) || reportDate > noticeDate || noticeDate > cutoff || seen.has(reportDate)) {
      throw new Error("财务摘要报告期或公告日无效");
    }
    seen.add(reportDate);
    const number = (field, minimum, maximum, label) => finiteNumber(row?.[field], minimum, maximum, label, { nullable: true });
    return Object.freeze({
      reportDate,
      noticeDate,
      reportName: cleanText(row.reportName, 30) || reportDate,
      currency: cleanText(row.currency, 8) || "CNY",
      revenue: number("revenue", 0, 1e16, "营业收入"),
      revenueYoY: number("revenueYoY", -100, 100_000, "营业收入同比"),
      netProfit: number("netProfit", -1e16, 1e16, "归母净利润"),
      netProfitYoY: number("netProfitYoY", -100_000, 100_000, "归母净利润同比"),
      deductedProfit: number("deductedProfit", -1e16, 1e16, "扣非净利润"),
      deductedProfitYoY: number("deductedProfitYoY", -100_000, 100_000, "扣非净利润同比"),
      eps: number("eps", -1e6, 1e6, "每股收益"),
      roe: number("roe", -1_000, 1_000, "加权 ROE"),
      grossMargin: number("grossMargin", -1_000, 1_000, "销售毛利率"),
      netMargin: number("netMargin", -1_000, 1_000, "销售净利率"),
      debtRatio: number("debtRatio", 0, 1_000, "资产负债率"),
      currentRatio: number("currentRatio", 0, 10_000, "流动比率"),
      quickRatio: number("quickRatio", 0, 10_000, "速动比率"),
      operatingCashPerShare: number("operatingCashPerShare", -1e6, 1e6, "每股经营现金流"),
      cashRevenueRatio: number("cashRevenueRatio", -100_000, 100_000, "经营现金流收入比"),
    });
  }));
  if (value.available !== (periods.length > 0)) throw new Error("财务摘要可用状态冲突");
  return Object.freeze({
    version: 1,
    available: value.available,
    periods,
    disclosure: cleanText(value.disclosure, 300),
  });
}

function parseTiming(value) {
  const state = ["watch", "extended", "risk", "unavailable"].includes(value?.state) ? value.state : null;
  const label = cleanText(value?.label, 40);
  const action = cleanText(value?.action, 300);
  const confirmation = cleanText(value?.confirmation, 300);
  const invalidation = cleanText(value?.invalidation, 300);
  if (!state || !label || !action || !confirmation || !invalidation) throw new Error("时机条件结构无效");
  return Object.freeze({ state, label, action, confirmation, invalidation });
}

function parseStockLevels(value) {
  if (value == null) {
    return Object.freeze({
      version: 1,
      available: false,
      atr: null,
      atrPercent: null,
      keltner: null,
      zones: Object.freeze([]),
      gaps: Object.freeze([]),
      fibonacci: Object.freeze([]),
      layers: Object.freeze([]),
      disclosure: "这份历史快照尚未包含关键价位；刷新个股数据后自动补齐。",
    });
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1) {
    throw new Error("关键价位版本无效");
  }
  const available = value.available === true;
  const parsePrice = (input, label, { nullable = false } = {}) => finiteNumber(input, 0.0001, 1_000_000, label, { nullable });
  if (!Array.isArray(value.zones) || value.zones.length > 8) throw new Error("关键价位列表无效");
  const ids = new Set();
  const zones = value.zones.map((item) => {
    const id = cleanText(item?.id, 30);
    const kind = ["support", "resistance"].includes(item?.kind) ? item.kind : null;
    if (!/^(?:support|resistance)-\d+$/u.test(id) || !kind || ids.has(id) || !Array.isArray(item.sources) || item.sources.length > 12) {
      throw new Error("关键价位条目无效或重复");
    }
    ids.add(id);
    const reviewSource = item?.review && typeof item.review === "object" && !Array.isArray(item.review)
      ? item.review
      : null;
    let review = null;
    if (reviewSource) {
      const status = ["holding", "breached"].includes(reviewSource.status) ? reviewSource.status : null;
      const lastTouch = reviewSource.lastTouch == null ? null : validDate(reviewSource.lastTouch) ? reviewSource.lastTouch : null;
      const barsSinceTouch = reviewSource.barsSinceTouch == null
        ? null
        : integer(reviewSource.barsSinceTouch, 0, 60, "关键价位距触达天数");
      if (!status || (reviewSource.lastTouch != null && !lastTouch) || (lastTouch == null) !== (barsSinceTouch == null)) {
        throw new Error("关键价位历史回看无效");
      }
      review = Object.freeze({
        windowBars: integer(reviewSource.windowBars, 1, 60, "关键价位回看窗口"),
        touches: integer(reviewSource.touches, 0, 60, "关键价位触达次数"),
        crosses: integer(reviewSource.crosses, 0, 60, "关键价位穿越次数"),
        lastTouch,
        barsSinceTouch,
        status,
      });
    }
    return Object.freeze({
      id,
      kind,
      label: cleanText(item.label, 100),
      price: parsePrice(item.price, "关键价位"),
      distancePercent: finiteNumber(item.distancePercent, -1_000, 1_000, "关键价位距离"),
      strength: integer(item.strength, 1, 5, "关键价位强度"),
      sources: Object.freeze(item.sources.map((source) => cleanText(source, 60)).filter(Boolean)),
      evidence: cleanText(item.evidence, 180),
      review,
    });
  });
  if (!Array.isArray(value.gaps) || value.gaps.length > 5) throw new Error("缺口列表无效");
  const gaps = value.gaps.map((item) => {
    const direction = ["up", "down"].includes(item?.direction) ? item.direction : null;
    const lower = parsePrice(item?.lower, "缺口下沿");
    const upper = parsePrice(item?.upper, "缺口上沿");
    if (!direction || upper <= lower || !validDate(item?.date)) throw new Error("缺口条目无效");
    return Object.freeze({
      direction,
      label: cleanText(item.label, 40),
      lower,
      upper,
      date: item.date,
      distancePercent: finiteNumber(item.distancePercent, -1_000, 1_000, "缺口距离"),
    });
  });
  if (!Array.isArray(value.fibonacci) || value.fibonacci.length > 5) throw new Error("斐波那契列表无效");
  const fibonacci = value.fibonacci.map((item) => Object.freeze({
    ratio: finiteNumber(item?.ratio, 0, 1, "斐波那契比例"),
    label: cleanText(item?.label, 20),
    price: parsePrice(item?.price, "斐波那契价位"),
    distancePercent: finiteNumber(item?.distancePercent, -1_000, 1_000, "斐波那契距离"),
  }));
  let keltner = null;
  if (value.keltner != null) {
    const lower = parsePrice(value.keltner.lower, "Keltner 下轨");
    const middle = parsePrice(value.keltner.middle, "Keltner 中轨");
    const upper = parsePrice(value.keltner.upper, "Keltner 上轨");
    if (!(lower < middle && middle < upper)) throw new Error("Keltner 通道结构无效");
    keltner = Object.freeze({
      period: integer(value.keltner.period, 2, 250, "Keltner 周期"),
      multiplier: finiteNumber(value.keltner.multiplier, 0.1, 10, "Keltner 倍数"),
      lower,
      middle,
      upper,
    });
  }
  if (available && (!Number.isFinite(Number(value.atr)) || !keltner)) throw new Error("关键价位计算不完整");
  if (!available && (value.atr != null || zones.length || gaps.length || fibonacci.length || keltner)) throw new Error("不可用关键价位包含计算结果");
  const layerNames = Object.freeze({
    sr: "压力支撑", pivot: "枢轴点", extreme: "前高前低", boll: "布林带", keltner: "Keltner",
    atr: "ATR通道", gap: "缺口位", fib: "斐波那契", round: "整数关口",
  });
  const parseLayerLine = (item, path) => {
    const id = cleanText(item?.id, 50);
    const kind = ["support", "resistance", "neutral"].includes(item?.kind) ? item.kind : null;
    if (!/^[a-z0-9-]+$/u.test(id) || !kind) throw new Error(`${path}条目无效`);
    return Object.freeze({
      id,
      label: cleanText(item.label, 60),
      price: parsePrice(item.price, `${path}价格`),
      kind,
      strength: integer(item.strength, 1, 5, `${path}强度`),
    });
  };
  let layers;
  if (Array.isArray(value.layers)) {
    if (value.layers.length > 9) throw new Error("关键价位图层过多");
    const layerIds = new Set();
    layers = value.layers.map((layer) => {
      const id = cleanText(layer?.id, 20);
      if (!Object.hasOwn(layerNames, id) || layerIds.has(id) || !Array.isArray(layer.lines) || layer.lines.length > 12) {
        throw new Error("关键价位图层无效或重复");
      }
      layerIds.add(id);
      const lines = layer.lines.map((item) => parseLayerLine(item, layerNames[id]));
      if ((layer.available === true) !== (lines.length > 0)) throw new Error("关键价位图层可用状态冲突");
      return Object.freeze({ id, label: layerNames[id], available: lines.length > 0, lines: Object.freeze(lines) });
    });
  } else {
    const legacy = {
      sr: zones.map((item) => ({ id: item.id, label: item.label, price: item.price, kind: item.kind, strength: item.strength })),
      keltner: keltner ? [
        { id: "keltner-20-upper", label: "短期上轨", price: keltner.upper, kind: "resistance", strength: 2 },
        { id: "keltner-20-lower", label: "短期下轨", price: keltner.lower, kind: "support", strength: 2 },
      ] : [],
      gap: gaps.flatMap((item, index) => [
        { id: `gap-${index + 1}-lower`, label: `${item.label}下沿`, price: item.lower, kind: item.distancePercent < 0 ? "support" : "resistance", strength: 2 },
        { id: `gap-${index + 1}-upper`, label: `${item.label}上沿`, price: item.upper, kind: item.distancePercent < 0 ? "support" : "resistance", strength: 2 },
      ]),
      fib: fibonacci.map((item, index) => ({ id: `fib-${index + 1}`, label: `Fib ${item.label}`, price: item.price, kind: item.distancePercent < 0 ? "support" : "resistance", strength: 1 })),
    };
    layers = Object.entries(layerNames).map(([id, label]) => {
      const lines = Object.freeze((legacy[id] ?? []).map((item) => Object.freeze(item)));
      return Object.freeze({ id, label, available: lines.length > 0, lines });
    });
  }
  return Object.freeze({
    version: 1,
    available,
    atr: parsePrice(value.atr, "ATR", { nullable: true }),
    atrPercent: finiteNumber(value.atrPercent, 0, 1_000, "ATR 比例", { nullable: true }),
    keltner,
    zones: Object.freeze(zones),
    gaps: Object.freeze(gaps),
    fibonacci: Object.freeze(fibonacci),
    layers: Object.freeze(layers),
    disclosure: cleanText(value.disclosure, 300),
  });
}

function parseEvent(value) {
  const kind = ["announcement", "news"].includes(value?.kind) ? value.kind : null;
  const importance = ["context", "risk", "operating", "routine"].includes(value?.importance) ? value.importance : null;
  const id = cleanText(value?.id, 100);
  const label = cleanText(value?.label, 40);
  const title = cleanText(value?.title, 240);
  const publishedAt = cleanText(value?.publishedAt, 40);
  if (!kind || !importance || !id || !label || !title || !validInstant(publishedAt)) throw new Error("个股事件无效");
  return Object.freeze({ kind, importance, id, label, title, publishedAt, url: safeUrl(value.url, "个股事件") });
}

export function parseAShareStockDetailSnapshot(textInput) {
  const source = String(textInput ?? "").trim();
  if (!source) throw new Error("个股行情没有返回数据");
  if (new TextEncoder().encode(source).length > MAX_SNAPSHOT_BYTES) throw new Error("个股行情返回过大");
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("个股行情不是有效 JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("个股行情结构无效");
  const market = value.kind === SNAPSHOT_KINDS.us || value.market === "us" ? "us" : value.kind === SNAPSHOT_KINDS.cn ? "cn" : "";
  if (value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION || !market || value.kind !== SNAPSHOT_KINDS[market]) throw new Error("个股行情版本不受支持");
  const marketDate = cleanText(value.marketDate, 10);
  const asOf = cleanText(value.asOf, 40);
  const generatedAt = cleanText(value.generatedAt, 40);
  if (!validDate(marketDate) || !validInstant(asOf) || !validInstant(generatedAt) || asOf.slice(0, 10) !== marketDate) {
    throw new Error("个股行情时点无效");
  }
  const phase = ["intraday", "close", "previous-close"].includes(value.session?.phase) ? value.session.phase : null;
  const provisional = value.session?.provisional === true;
  const previousClose = value.session?.previousClose === true;
  if (!phase || (phase === "intraday") !== provisional || (phase === "previous-close") !== previousClose || (provisional && previousClose)) {
    throw new Error("个股行情交易阶段冲突");
  }
  const stock = parseStock(value.stock, market);
  if (!Array.isArray(value.bars) || value.bars.length > 180) throw new Error("历史行情数量无效");
  const bars = Object.freeze(value.bars.map((item) => parseBar(item, marketDate)));
  for (let index = 1; index < bars.length; index += 1) {
    if (bars[index - 1].date >= bars[index].date) throw new Error("历史行情日期重复或乱序");
  }
  const metrics = parseMetrics(value.metrics);
  if (metrics.historyBars !== bars.length || (bars.length && metrics.lastBarDate !== bars.at(-1).date)) {
    throw new Error("趋势指标与历史行情不一致");
  }
  if (!Array.isArray(value.events) || value.events.length > 8) throw new Error("个股事件数量无效");
  const events = Object.freeze(value.events.map(parseEvent));
  const sourceStatus = Object.freeze(Object.fromEntries(
    ["quote", "history", "announcements", "news", "financials"].map((key) => [key, value.sourceStatus?.[key] === true]),
  ));
  const historyAdjust = value.historyAdjust === "none"
    ? "none"
    : value.historyAdjust === "adj" && market === "us"
      ? "adj"
      : value.historyAdjust === "qfq" || (value.historyAdjust == null && sourceStatus.history && market === "cn")
      ? "qfq"
      : null;
  if (!sourceStatus.quote || sourceStatus.history !== (bars.length > 0) || (sourceStatus.history && !historyAdjust)) {
    throw new Error("个股数据来源状态冲突");
  }
  if (!Array.isArray(value.sources) || value.sources.length > 8) throw new Error("个股来源列表无效");
  const sources = Object.freeze(value.sources.map((item) => ({
    label: cleanText(item?.label, 100),
    url: safeUrl(item?.url, "个股数据来源"),
    asOf: cleanText(item?.asOf, 40),
  })));
  return Object.freeze({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    kind: SNAPSHOT_KINDS[market],
    market,
    marketDate,
    asOf,
    generatedAt,
    session: Object.freeze({ phase, provisional, previousClose }),
    stock,
    metrics,
    timing: parseTiming(value.timing),
    levels: parseStockLevels(value.levels),
    financials: parseFinancials(value.financials, generatedAt, market),
    bars,
    events,
    historyAdjust,
    sourceStatus,
    sources,
    disclaimer: cleanText(value.disclaimer, 300),
  });
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function svgElement(tag, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function formatPercent(value) {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatAmount(value, market = "cn") {
  if (value == null) return "—";
  if (market === "us") {
    if (value >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
    if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    return `$${value.toLocaleString("en-US")}`;
  }
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)} 万亿`;
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)} 亿`;
  return `${(value / 10_000).toFixed(1)} 万`;
}

function formatVolume(value, market = "cn") {
  if (value == null) return "—";
  if (market === "us") {
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B 股`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M 股`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K 股`;
  }
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)} 亿股`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)} 万股`;
  return `${value} 股`;
}

function formatClock(value, market = "cn") {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: market === "us" ? "America/New_York" : "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function errorMessage(stderr) {
  const lines = String(stderr).trim().split(/\r?\n/u).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      const message = cleanText(parsed?.message, 300);
      if (message) return message;
    } catch {
      // Continue to a plain text fallback.
    }
  }
  return cleanText(lines.find((line) => /(?:Error|Exception):\s*\S/iu.test(line)) ?? lines[0], 300) || "个股行情读取失败";
}

function expectedSymbol(queryInput, market = "cn") {
  if (market === "us") {
    const raw = cleanText(queryInput, 80);
    const query = raw.toUpperCase();
    return raw === query && /^[A-Z][A-Z0-9.-]{0,14}$/u.test(query) ? query : "";
  }
  const match = /(?:(SH|SZ)\s*)?(\d{6})/iu.exec(cleanText(queryInput, 80));
  if (!match) return "";
  const inferred = /^[69]/u.test(match[2]) ? "SH" : /^[023]/u.test(match[2]) ? "SZ" : "";
  if (!inferred || (match[1] && match[1].toUpperCase() !== inferred)) return "";
  return `${inferred}${match[2]}`;
}

export function createAShareStockDetailController({
  hostCall,
  onHostEvent,
  now = () => new Date(),
  onResolved = () => undefined,
  onDiagnose = () => undefined,
  onDeepResearch = () => undefined,
  onFollow = () => undefined,
  isFollowed = () => false,
  onAlert = () => undefined,
  elements,
}) {
  let snapshot = null;
  let loading = false;
  let runtime = null;
  let activeProcessId = null;
  let generation = 0;
  let chartRange = 60;
  let activeFinancialReportDate = null;
  let followPending = false;
  let activeMarket = "cn";
  const activeLevelLayers = new Set(["sr"]);
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
    if (finalizedProcessIds.size > 32) finalizedProcessIds.delete(finalizedProcessIds.values().next().value);
  }

  const unsubscribeOutput = onHostEvent?.("process.output", (payload) => {
    const processId = typeof payload?.processId === "string" ? payload.processId : "";
    if (!processId || finalizedProcessIds.has(processId) || (processId !== activeProcessId && !processRecords.has(processId)) || !["stdout", "stderr"].includes(payload?.stream) || typeof payload?.text !== "string") return;
    const record = recordFor(processId);
    record[payload.stream] += payload.text;
    if (record.stdout.length + record.stderr.length > MAX_PROCESS_OUTPUT_CHARS) {
      record.stderr += "\n个股行情输出超过安全上限";
      void hostCall("process.cancel", { processId }).catch(() => undefined);
    }
  });
  const unsubscribeExit = onHostEvent?.("process.exit", (payload) => {
    const processId = typeof payload?.processId === "string" ? payload.processId : "";
    if (!processId || finalizedProcessIds.has(processId) || (processId !== activeProcessId && !processRecords.has(processId))) return;
    const record = recordFor(processId);
    record.exit = { code: payload?.code, signal: payload?.signal };
    record.resolve?.(record);
  });

  async function ensureRuntime() {
    if (runtime) return runtime;
    if (typeof onHostEvent !== "function") throw new Error("个股行情需在 CodeShell 投资工作台内运行");
    let selected = null;
    for (const spec of RUNTIME_SPECS) {
      const executable = await hostCall("process.find", { name: spec.name }).catch(() => null);
      if (executable?.available && typeof executable.handle === "string") {
        selected = { executable, spec };
        break;
      }
    }
    if (!selected) throw new Error("未发现 Node.js 或 Bun，无法运行本机只读个股行情程序");
    let directory;
    let persistent = false;
    try {
      directory = await hostCall("filesystem.getKnownDirectory", { name: "app-data" });
      persistent = true;
    } catch {
      directory = await hostCall("filesystem.getKnownDirectory", { name: "downloads" });
    }
    if (typeof directory?.handle !== "string") throw new Error("无法取得受限的个股行情运行目录");
    runtime = { executableHandle: selected.executable.handle, directoryHandle: directory.handle, name: selected.spec.name, persistent };
    return runtime;
  }

  function waitForExit(processId) {
    const record = recordFor(processId);
    if (record.exit) return Promise.resolve(record);
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        record.resolve = null;
        void hostCall("process.cancel", { processId }).catch(() => undefined);
        reject(new Error("个股行情读取超时，已停止本次任务"));
      }, PROCESS_TIMEOUT_MS);
      record.resolve = (next) => {
        window.clearTimeout(timeout);
        record.resolve = null;
        resolve(next);
      };
    });
  }

  async function fetchSnapshot(query, mode = "refresh", market = activeMarket) {
    const handles = await ensureRuntime();
    if (mode === "read-local" && !handles.persistent) throw new Error("当前 CodeShell 不支持面板本地数据目录");
    const runtimeMode = mode === "read-local" ? "read-local" : handles.persistent ? "refresh-local" : "refresh-volatile";
    const started = await hostCall("process.spawn", {
      executableHandle: handles.executableHandle,
      directoryHandle: handles.directoryHandle,
      args: stockDetailRuntimeArgs(handles.name, query, runtimeMode, market),
    });
    if (typeof started?.processId !== "string") throw new Error("个股行情程序未能启动");
    const processId = started.processId;
    activeProcessId = processId;
    let record;
    try {
      record = await waitForExit(processId);
    } finally {
      if (activeProcessId === processId) activeProcessId = null;
      finalizeProcess(processId);
    }
    if (record.exit?.code !== 0) throw new Error(errorMessage(record.stderr));
    const parsed = parseAShareStockDetailSnapshot(record.stdout);
    const expected = expectedSymbol(query, market);
    if (expected && parsed.stock.symbol !== expected) throw new Error("个股行情代码与搜索标的不一致");
    return parsed;
  }

  function visibleLevelLines() {
    if (!snapshot?.levels?.available) return [];
    const price = snapshot.stock.price;
    return snapshot.levels.layers
      .filter((layer) => layer.available && activeLevelLayers.has(layer.id))
      .flatMap((layer) => layer.id === "sr" ? layer.lines.slice(0, 4) : layer.lines)
      .sort((left, right) => Math.abs(left.price / price - 1) - Math.abs(right.price / price - 1))
      .slice(0, 18);
  }

  function renderChart() {
    elements.chart.replaceChildren();
    const allBars = snapshot?.bars ?? [];
    const startIndex = Math.max(0, allBars.length - chartRange);
    const bars = allBars.slice(startIndex);
    if (bars.length < 2) {
      elements.chart.append(element("p", "stock-detail-chart-empty", "历史行情源本次不可用"));
      return;
    }
    const width = 720;
    const height = 250;
    const pad = { left: 14, right: 70, top: 18, bottom: 30 };
    const averageSeries = (period) => allBars.map((item, index) => {
      if (index + 1 < period) return null;
      return allBars.slice(index + 1 - period, index + 1).reduce((sum, row) => sum + row.close, 0) / period;
    }).slice(startIndex);
    const ma20 = averageSeries(20);
    const ma60 = averageSeries(60);
    const closes = bars.map((item) => item.close);
    const levelLines = visibleLevelLines();
    const visibleLevels = levelLines.map((item) => item.price);
    const values = [...closes, ...ma20.filter(Number.isFinite), ...ma60.filter(Number.isFinite), ...visibleLevels];
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const range = Math.max(0.01, maximum - minimum);
    const point = (item, index) => ({
      x: pad.left + (index / Math.max(1, bars.length - 1)) * (width - pad.left - pad.right),
      y: pad.top + ((maximum - item.close) / range) * (height - pad.top - pad.bottom),
    });
    const svg = svgElement("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `${snapshot.stock.name}近 ${bars.length} 个交易日收盘趋势` });
    for (const ratio of [0, 0.5, 1]) {
      const y = pad.top + ratio * (height - pad.top - pad.bottom);
      svg.append(svgElement("line", { x1: pad.left, x2: width - pad.right, y1: y, y2: y, class: "stock-detail-grid-line" }));
      const label = svgElement("text", { x: width - pad.right + 10, y: y + 4, class: "stock-detail-chart-label" });
      label.textContent = (maximum - ratio * range).toFixed(2);
      svg.append(label);
    }
    const points = bars.map((item, index) => point(item, index));
    const linePath = points.map((item, index) => `${index ? "L" : "M"}${item.x.toFixed(2)},${item.y.toFixed(2)}`).join(" ");
    const areaPath = `${linePath} L${points.at(-1).x.toFixed(2)},${height - pad.bottom} L${points[0].x.toFixed(2)},${height - pad.bottom} Z`;
    svg.append(svgElement("path", { d: areaPath, class: "stock-detail-chart-area" }));
    svg.append(svgElement("path", { d: linePath, class: "stock-detail-chart-line" }));
    const movingPath = (values) => values
      .map((value, index) => Number.isFinite(value) ? { ...point({ close: value }, index), value } : null)
      .filter(Boolean)
      .map((item, index) => `${index ? "L" : "M"}${item.x.toFixed(2)},${item.y.toFixed(2)}`)
      .join(" ");
    const ma20Path = movingPath(ma20);
    const ma60Path = movingPath(ma60);
    if (ma20Path) svg.append(svgElement("path", { d: ma20Path, class: "stock-detail-chart-average is-ma20" }));
    if (ma60Path) svg.append(svgElement("path", { d: ma60Path, class: "stock-detail-chart-average is-ma60" }));
    if (snapshot.levels.available) {
      for (const level of levelLines) {
        const y = point({ close: level.price }, 0).y;
        svg.append(svgElement("line", {
          x1: pad.left,
          x2: width - pad.right,
          y1: y,
          y2: y,
          class: `stock-detail-level-line is-${level.kind}`,
        }));
        const label = svgElement("text", { x: width - pad.right - 4, y: y - 4, "text-anchor": "end", class: `stock-detail-level-label is-${level.kind}` });
        label.textContent = `${level.label} ${level.price.toFixed(2)}`;
        svg.append(label);
      }
    }
    for (const [x, labelText, anchor] of [
      [pad.left, bars[0].date.slice(5), "start"],
      [(width - pad.right + pad.left) / 2, bars[Math.floor(bars.length / 2)].date.slice(5), "middle"],
      [width - pad.right, bars.at(-1).date.slice(5), "end"],
    ]) {
      const label = svgElement("text", { x, y: height - 6, "text-anchor": anchor, class: "stock-detail-chart-label" });
      label.textContent = labelText;
      svg.append(label);
    }
    const cursorLine = svgElement("line", {
      x1: pad.left,
      x2: pad.left,
      y1: pad.top,
      y2: height - pad.bottom,
      class: "stock-detail-chart-cursor",
      visibility: "hidden",
    });
    const cursorPoint = svgElement("circle", {
      cx: pad.left,
      cy: pad.top,
      r: 4,
      class: "stock-detail-chart-cursor-point",
      visibility: "hidden",
    });
    const hitArea = svgElement("rect", {
      x: pad.left,
      y: pad.top,
      width: width - pad.left - pad.right,
      height: height - pad.top - pad.bottom,
      class: "stock-detail-chart-hit-area",
      fill: "transparent",
    });
    svg.append(cursorLine, cursorPoint, hitArea);
    const legend = element("div", "stock-detail-chart-legend");
    legend.append(
      element("span", "is-price", "收盘价"),
      element("span", "is-ma20", "MA20"),
      element("span", "is-ma60", "MA60"),
      element("span", "is-support", "支撑"),
      element("span", "is-resistance", "压力"),
      element("span", "is-neutral", "中性参照"),
    );
    const tooltip = element("div", "stock-detail-chart-tooltip");
    tooltip.hidden = true;
    tooltip.setAttribute("role", "status");
    const tooltipDate = element("strong", "", "");
    const tooltipChange = element("span", "stock-detail-chart-tooltip-change", "");
    const tooltipValues = element("dl", "", "");
    const fields = new Map();
    for (const label of ["收盘", "开盘", "最高", "最低", "成交量", "MA20", "MA60"]) {
      const row = element("div", "", "");
      const value = element("dd", "", "—");
      row.append(element("dt", "", label), value);
      tooltipValues.append(row);
      fields.set(label, value);
    }
    tooltip.append(tooltipDate, tooltipChange, tooltipValues);
    elements.chart.append(svg, legend, tooltip);

    function hideTooltip() {
      cursorLine.setAttribute("visibility", "hidden");
      cursorPoint.setAttribute("visibility", "hidden");
      tooltip.hidden = true;
      delete elements.chart.dataset.hoverIndex;
    }

    function showTooltip(index) {
      const boundedIndex = Math.max(0, Math.min(bars.length - 1, index));
      const bar = bars[boundedIndex];
      const plotPoint = points[boundedIndex];
      const previousClose = allBars[startIndex + boundedIndex - 1]?.close ?? null;
      const changePercent = previousClose == null
        ? null
        : ((bar.close / previousClose) - 1) * 100;
      cursorLine.setAttribute("x1", plotPoint.x);
      cursorLine.setAttribute("x2", plotPoint.x);
      cursorLine.setAttribute("visibility", "visible");
      cursorPoint.setAttribute("cx", plotPoint.x);
      cursorPoint.setAttribute("cy", plotPoint.y);
      cursorPoint.setAttribute("visibility", "visible");
      tooltipDate.textContent = `交易日 ${bar.date}`;
      tooltipChange.textContent = `当日涨跌 ${formatPercent(changePercent)}`;
      tooltipChange.dataset.tone = changePercent > 0 ? "up" : changePercent < 0 ? "down" : "flat";
      fields.get("收盘").textContent = bar.close.toFixed(2);
      fields.get("开盘").textContent = bar.open.toFixed(2);
      fields.get("最高").textContent = bar.high.toFixed(2);
      fields.get("最低").textContent = bar.low.toFixed(2);
      fields.get("成交量").textContent = formatVolume(bar.volume, snapshot.market);
      fields.get("MA20").textContent = Number.isFinite(ma20[boundedIndex]) ? ma20[boundedIndex].toFixed(2) : "—";
      fields.get("MA60").textContent = Number.isFinite(ma60[boundedIndex]) ? ma60[boundedIndex].toFixed(2) : "—";
      elements.chart.dataset.hoverIndex = String(boundedIndex);
      tooltip.hidden = false;
      const svgRect = svg.getBoundingClientRect();
      const chartRect = elements.chart.getBoundingClientRect();
      const pointLeft = (svgRect.left - chartRect.left) + (plotPoint.x / width) * svgRect.width;
      const pointTop = (svgRect.top - chartRect.top) + (plotPoint.y / height) * svgRect.height;
      const proposedLeft = pointLeft > chartRect.width / 2
        ? pointLeft - tooltip.offsetWidth - 12
        : pointLeft + 12;
      tooltip.style.left = `${Math.max(8, Math.min(chartRect.width - tooltip.offsetWidth - 8, proposedLeft))}px`;
      tooltip.style.top = `${Math.max(8, Math.min(svgRect.height - tooltip.offsetHeight - 8, pointTop - tooltip.offsetHeight / 2))}px`;
    }

    function indexFromPointer(event) {
      const rect = svg.getBoundingClientRect();
      const viewBoxX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * width;
      const ratio = (viewBoxX - pad.left) / (width - pad.left - pad.right);
      return Math.round(Math.max(0, Math.min(1, ratio)) * (bars.length - 1));
    }

    hitArea.addEventListener("pointermove", (event) => showTooltip(indexFromPointer(event)));
    hitArea.addEventListener("pointerdown", (event) => showTooltip(indexFromPointer(event)));
    hitArea.addEventListener("pointerleave", hideTooltip);
  }

  function renderOverview() {
    elements.highlights.replaceChildren();
    if (!snapshot) {
      elements.overview.dataset.state = "unavailable";
      elements.overviewTitle.textContent = "等待个股数据";
      elements.overviewSummary.textContent = "会先说明趋势、位置和当前最需要验证的条件，再展开行情与事件。";
      return;
    }
    const { stock, metrics, timing, session } = snapshot;
    const displayPhase = snapshot.market === "cn" ? displayedAShareSessionPhase(snapshot, now()) : session.phase;
    const trend = metrics.ma20 != null && metrics.ma60 != null && stock.price > metrics.ma20 && metrics.ma20 > metrics.ma60
      ? "中期趋势向上"
      : metrics.ma20 != null && stock.price < metrics.ma20
        ? "价格位于 MA20 下方"
        : "趋势仍在修复";
    const position = metrics.extension20 == null
      ? "位置数据不足"
      : metrics.extension20 > 8
        ? `高于 MA20 ${formatPercent(metrics.extension20)}，位置偏热`
        : metrics.extension20 < -3
          ? `低于 MA20 ${Math.abs(metrics.extension20).toFixed(2)}%`
          : `距 MA20 ${formatPercent(metrics.extension20)}，处于观察区附近`;
    const riskEvents = snapshot.events.filter((event) => event.importance === "risk").length;
    elements.overview.dataset.state = timing.state;
    elements.overviewTitle.textContent = `${timing.label} · ${trend}`;
    elements.overviewSummary.textContent = `${position}；${timing.action}${riskEvents ? ` 当前有 ${riskEvents} 条风险事件需优先核验。` : ""}`;
    for (const [label, value, tone] of [
      ["20 日", formatPercent(metrics.return20), (metrics.return20 ?? 0) >= 0 ? "up" : "down"],
      ["60 日", formatPercent(metrics.return60), (metrics.return60 ?? 0) >= 0 ? "up" : "down"],
      ["距 120 日高点", formatPercent(metrics.distanceHigh120), "neutral"],
      ["量比 / 换手", `${metrics.volumeRatio20 == null ? "—" : metrics.volumeRatio20.toFixed(2)} / ${formatPercent(stock.turnover)}`, "neutral"],
      ["阶段", displayPhase === "intraday" ? "盘中变化中" : displayPhase === "close" ? "完整收盘" : "最近收盘", "neutral"],
    ]) {
      const row = element("div", "");
      row.dataset.tone = tone;
      row.append(element("dt", "", label), element("dd", "", value));
      elements.highlights.append(row);
    }
  }

  function renderMetrics() {
    elements.metrics.replaceChildren();
    if (!snapshot) return;
    const { stock, metrics } = snapshot;
    for (const [label, value, tone] of [
      ["今开", stock.open.toFixed(2)],
      ["最高", stock.high.toFixed(2), "up"],
      ["最低", stock.low.toFixed(2), "down"],
      ["昨收", stock.previousClose.toFixed(2)],
      ["成交额", formatAmount(stock.amount, snapshot.market)],
      ["换手率", formatPercent(stock.turnover)],
      ["总市值", formatAmount(stock.totalMarketCap, snapshot.market)],
      ["流通市值", formatAmount(stock.floatMarketCap, snapshot.market)],
      ["PE / PB", `${stock.pe == null ? "—" : stock.pe.toFixed(2)} / ${stock.pb == null ? "—" : stock.pb.toFixed(2)}`],
      ["MA20 / MA60", `${metrics.ma20 == null ? "—" : metrics.ma20.toFixed(2)} / ${metrics.ma60 == null ? "—" : metrics.ma60.toFixed(2)}`],
      ["20 / 60 日", `${formatPercent(metrics.return20)} / ${formatPercent(metrics.return60)}`],
      ["距 120 日高点", formatPercent(metrics.distanceHigh120)],
    ]) {
      const row = element("div", "stock-detail-metric");
      if (tone) row.dataset.tone = tone;
      row.append(element("dt", "", label), element("dd", "", value));
      elements.metrics.append(row);
    }
  }

  function renderFinancials() {
    if (!elements.financials) return;
    elements.financialKpis.replaceChildren();
    elements.financialDimensions.replaceChildren();
    elements.financialAnomaliesList?.replaceChildren();
    elements.financialHistory.replaceChildren();
    const financials = snapshot?.financials;
    const periods = financials?.periods ?? [];
    const latest = periods.find((period) => period.reportDate === activeFinancialReportDate) ?? periods[0] ?? null;
    activeFinancialReportDate = latest?.reportDate ?? null;
    elements.financials.dataset.state = latest ? "ready" : "unavailable";
    elements.financialMeta.textContent = latest
      ? `${latest.reportName} · 公告 ${latest.noticeDate.slice(5).replace("-", "/")}`
      : snapshot?.market === "us" ? "美股财务待接入" : "本轮未取得摘要";
    elements.financialDisclosure.textContent = financials?.disclosure ?? "等待财务数据。";
    if (!latest) {
      if (elements.financialAnomalies) elements.financialAnomalies.hidden = true;
      elements.financialKpis.append(element("p", "stock-financial-empty", financials?.disclosure ?? "等待财务数据。"));
      return;
    }
    if (elements.financialAnomalies) elements.financialAnomalies.hidden = false;
    const amount = (value) => value == null ? "—" : `${(value / 100_000_000).toFixed(Math.abs(value) >= 100_000_000_000 ? 0 : 1)} 亿`;
    const signedPercent = (value) => value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
    const ratio = (value) => value == null ? "—" : `${value.toFixed(1)}%`;
    for (const [label, value, delta, tone] of [
      ["营业收入", amount(latest.revenue), signedPercent(latest.revenueYoY), (latest.revenueYoY ?? 0) >= 0 ? "up" : "down"],
      ["归母净利润", amount(latest.netProfit), signedPercent(latest.netProfitYoY), (latest.netProfitYoY ?? 0) >= 0 ? "up" : "down"],
      ["基本每股收益", latest.eps == null ? "—" : latest.eps.toFixed(2), "元 / 股", (latest.eps ?? 0) >= 0 ? "up" : "down"],
      ["加权 ROE", ratio(latest.roe), "累计口径", (latest.roe ?? 0) >= 0 ? "up" : "down"],
    ]) {
      const card = element("article", "stock-financial-kpi");
      card.dataset.tone = tone;
      card.append(element("span", "", label), element("strong", "", value), element("small", "", delta));
      elements.financialKpis.append(card);
    }
    const growthState = latest.revenueYoY == null || latest.netProfitYoY == null
      ? "数据不完整"
      : latest.revenueYoY >= 0 && latest.netProfitYoY >= 0
        ? "营收利润双增"
        : latest.revenueYoY < 0 && latest.netProfitYoY < 0
          ? "营收利润双降"
          : "增长出现分化";
    const growthTone = growthState === "营收利润双增" ? "up" : growthState === "营收利润双降" ? "down" : "warning";
    const cashTone = (latest.operatingCashPerShare ?? 0) < 0 || (latest.cashRevenueRatio ?? 0) < 0 ? "down" : "neutral";
    const debtTone = (latest.debtRatio ?? 0) > 75 || (latest.currentRatio != null && latest.currentRatio < 0.8) ? "warning" : "neutral";
    for (const [label, state, detail, tone] of [
      ["成长", growthState, `营收 ${signedPercent(latest.revenueYoY)} · 净利 ${signedPercent(latest.netProfitYoY)}`, growthTone],
      ["盈利", `毛利 ${ratio(latest.grossMargin)}`, `净利率 ${ratio(latest.netMargin)} · ROE ${ratio(latest.roe)}`, "neutral"],
      ["现金", `每股经营现金 ${latest.operatingCashPerShare == null ? "—" : latest.operatingCashPerShare.toFixed(2)}`, `经营现金 / 收入 ${ratio(latest.cashRevenueRatio)}`, cashTone],
      ["偿债", `负债率 ${ratio(latest.debtRatio)}`, `流动比率 ${latest.currentRatio == null ? "—" : latest.currentRatio.toFixed(2)} · 速动 ${latest.quickRatio == null ? "—" : latest.quickRatio.toFixed(2)}`, debtTone],
    ]) {
      const card = element("article", "stock-financial-dimension");
      card.dataset.tone = tone;
      card.append(element("span", "", label), element("b", "", state), element("small", "", detail));
      elements.financialDimensions.append(card);
    }
    const anomalies = [];
    if (latest.netProfit != null && latest.netProfit < 0) {
      anomalies.push(["亏损", "归母净利润为负，需核对亏损来源、持续性和非经常性项目。", "risk"]);
    }
    if (latest.revenueYoY != null && latest.netProfitYoY != null && latest.netProfitYoY < latest.revenueYoY - 10) {
      anomalies.push(["增收不增利", `净利润增速比营收低 ${(latest.revenueYoY - latest.netProfitYoY).toFixed(1)} 个百分点，需核对毛利率、费用或减值变化。`, "warning"]);
    }
    if (latest.netProfit != null && latest.netProfit > 0 && latest.operatingCashPerShare != null && latest.operatingCashPerShare < 0) {
      anomalies.push(["现金背离", "利润为正但每股经营现金流为负，需核对应收、存货和回款节奏。", "risk"]);
    }
    if (latest.debtRatio != null && latest.debtRatio > 75) {
      anomalies.push(["负债偏高", `资产负债率 ${latest.debtRatio.toFixed(1)}%，需结合行业属性和有息负债期限核对。`, "warning"]);
    }
    if (latest.currentRatio != null && latest.currentRatio < 0.8) {
      anomalies.push(["短债覆盖", `流动比率 ${latest.currentRatio.toFixed(2)}，短期偿债缓冲偏薄。`, "warning"]);
    }
    if (latest.netProfit != null && latest.deductedProfit != null && Math.abs(latest.netProfit) > 0 &&
      Math.abs(latest.netProfit - latest.deductedProfit) / Math.abs(latest.netProfit) > 0.2) {
      anomalies.push(["扣非差异", "归母净利润与扣非净利润差异超过 20%，需核对非经常性损益。", "warning"]);
    }
    if (!anomalies.length) {
      anomalies.push(["未触发阈值", "本期未触发内置异常阈值；这不是财务安全结论，仍需结合附注、行业和现金流原文核验。", "neutral"]);
    }
    for (const [label, detail, tone] of anomalies) {
      const row = element("li", "");
      row.dataset.tone = tone;
      row.append(element("b", "", label), element("span", "", detail));
      elements.financialAnomaliesList?.append(row);
    }
    const table = element("div", "stock-financial-history-table");
    const header = element("div", "stock-financial-history-row is-head");
    for (const label of ["报告期", "营收同比", "净利同比", "ROE", "负债率"]) header.append(element("span", "", label));
    table.append(header);
    for (const period of periods.slice(0, 6)) {
      const row = element("button", "stock-financial-history-row");
      row.type = "button";
      row.dataset.financialReportDate = period.reportDate;
      row.setAttribute("aria-pressed", String(period.reportDate === latest.reportDate));
      row.title = `切换到 ${period.reportName} 指标`;
      for (const [value, tone] of [
        [period.reportName, "neutral"],
        [signedPercent(period.revenueYoY), (period.revenueYoY ?? 0) >= 0 ? "up" : "down"],
        [signedPercent(period.netProfitYoY), (period.netProfitYoY ?? 0) >= 0 ? "up" : "down"],
        [ratio(period.roe), "neutral"],
        [ratio(period.debtRatio), "neutral"],
      ]) {
        const cell = element("span", "", value);
        cell.dataset.tone = tone;
        row.append(cell);
      }
      table.append(row);
    }
    elements.financialHistory.append(table);
  }

  function renderLevels() {
    elements.levelFilters?.replaceChildren();
    elements.levelsList?.replaceChildren();
    elements.levelsMeta?.replaceChildren();
    if (!snapshot || !elements.levels) return;
    const levels = snapshot.levels;
    elements.levels.dataset.state = levels.available ? "ready" : "unavailable";
    elements.levelsDisclosure.textContent = levels.disclosure;
    if (!levels.available) {
      elements.levelsList.append(element("p", "stock-detail-levels-empty", levels.disclosure));
      return;
    }
    const availableLayers = levels.layers.filter((layer) => layer.available);
    if (!availableLayers.some((layer) => activeLevelLayers.has(layer.id)) && availableLayers.length) {
      activeLevelLayers.add(availableLayers[0].id);
    }
    for (const layer of levels.layers) {
      const button = element("button", "stock-detail-level-filter");
      button.type = "button";
      button.dataset.levelLayer = layer.id;
      button.disabled = !layer.available;
      button.setAttribute("aria-pressed", String(layer.available && activeLevelLayers.has(layer.id)));
      button.append(element("span", "", layer.label), element("small", "", layer.available ? `${layer.lines.length}` : "—"));
      button.addEventListener("click", () => {
        if (activeLevelLayers.has(layer.id)) activeLevelLayers.delete(layer.id);
        else activeLevelLayers.add(layer.id);
        renderLevels();
        renderChart();
      });
      elements.levelFilters.append(button);
    }
    for (const zone of levels.zones) {
      const row = element("article", "stock-detail-level-zone");
      row.dataset.kind = zone.kind;
      row.append(
        element("span", "", zone.kind === "support" ? "支撑" : "压力"),
        element("b", "", zone.price.toFixed(2)),
        element("strong", "", `${zone.distancePercent > 0 ? "+" : ""}${zone.distancePercent.toFixed(2)}%`),
        element("p", "", zone.label),
        element("small", "", `${"●".repeat(zone.strength)}${"○".repeat(5 - zone.strength)} · ${zone.evidence}`),
      );
      if (zone.review) {
        const status = zone.kind === "support"
          ? zone.review.status === "holding" ? "仍在上方" : "已收盘跌破"
          : zone.review.status === "holding" ? "仍在下方" : "已收盘突破";
        const latest = zone.review.lastTouch
          ? `最近 ${zone.review.lastTouch.slice(5).replace("-", "/")}${zone.review.barsSinceTouch ? ` · ${zone.review.barsSinceTouch} 日前` : " · 当日"}`
          : "窗口内未触达";
        row.append(element(
          "small",
          "stock-detail-level-review",
          `${zone.review.windowBars} 日描述回看 · ${zone.review.touches} 次触达 · ${zone.review.crosses} 次收盘穿越 · ${latest} · ${status}`,
        ));
      }
      elements.levelsList.append(row);
    }
    if (!levels.zones.length) elements.levelsList.append(element("p", "stock-detail-levels-empty", "当前没有形成足够清晰的支撑/压力共振区。"));
    const nearestSupport = levels.zones.find((item) => item.kind === "support");
    const nearestResistance = levels.zones.find((item) => item.kind === "resistance");
    for (const [label, value] of [
      ["ATR(14)", `${levels.atr.toFixed(2)} · ${levels.atrPercent.toFixed(2)}%`],
      ["Keltner(20,2)", `${levels.keltner.lower.toFixed(2)} — ${levels.keltner.upper.toFixed(2)}`],
      ["最近支撑", nearestSupport?.price.toFixed(2) ?? "—"],
      ["最近压力", nearestResistance?.price.toFixed(2) ?? "—"],
      ["未回补缺口", `${levels.gaps.length} 个`],
      ["120日斐波那契", levels.fibonacci.map((item) => `${item.label} ${item.price.toFixed(2)}`).join(" · ") || "—"],
    ]) {
      const row = element("div", "");
      row.append(element("dt", "", label), element("dd", "", value));
      elements.levelsMeta.append(row);
    }
  }

  function renderEvents() {
    elements.events.replaceChildren();
    if (!snapshot) return;
    const ordered = [...snapshot.events].sort((left, right) =>
      Number(right.importance === "risk") - Number(left.importance === "risk") ||
      Date.parse(right.publishedAt) - Date.parse(left.publishedAt),
    );
    for (const event of ordered) {
      const button = element("button", "stock-detail-event");
      button.type = "button";
      button.dataset.stockEventUrl = event.url;
      button.dataset.importance = event.importance;
      button.append(
        element("span", "", event.label),
        element("b", "", event.title),
        element("time", "", formatClock(event.publishedAt, snapshot.market)),
      );
      elements.events.append(button);
    }
    if (snapshot.events.length === 0) {
      elements.events.append(element("p", "stock-detail-empty", "本次未匹配到个股公告或新闻；不能据此判断没有事件。"));
    }
  }

  function renderFollowState() {
    const symbol = snapshot?.stock.symbol ?? "";
    const unsupported = snapshot?.market === "us";
    const followed = Boolean(symbol && isFollowed(symbol));
    elements.follow.hidden = unsupported;
    elements.follow.disabled = unsupported || !symbol || followPending || followed;
    elements.follow.setAttribute("aria-pressed", String(followed));
    if (followPending) {
      elements.follow.textContent = "正在加入…";
      elements.follow.dataset.state = "pending";
    } else if (followed) {
      elements.follow.textContent = "✓ 已长期关注";
      elements.follow.dataset.state = "followed";
    } else {
      elements.follow.textContent = "加入长期关注";
      delete elements.follow.dataset.state;
    }
  }

  function render() {
    elements.root.hidden = !loading && !snapshot;
    elements.empty.hidden = loading || Boolean(snapshot);
    elements.root.dataset.state = loading ? "loading" : snapshot ? "ready" : "empty";
    elements.submit.disabled = loading;
    elements.submit.textContent = loading ? "正在读取…" : "查看数据";
    if (!snapshot) {
      if (elements.marketEyebrow) elements.marketEyebrow.textContent = activeMarket === "us" ? "US STOCK DATA" : "A-SHARE STOCK DATA";
      delete elements.diagnose.dataset.stockSubject;
      if (elements.deepResearch) delete elements.deepResearch.dataset.stockSubject;
      elements.name.textContent = loading ? "正在读取个股行情" : "个股行情";
      elements.symbol.textContent = "行情、趋势与事件会显示在这里";
      elements.price.textContent = "—";
      elements.change.textContent = "—";
      elements.metrics.replaceChildren();
      renderLevels();
      renderOverview();
      elements.timing.dataset.state = "unavailable";
      elements.timingState.textContent = "等待数据";
      elements.timingAction.textContent = "正在核对股票身份、实时行情和历史趋势。";
      elements.confirmation.textContent = "—";
      elements.invalidation.textContent = "—";
      elements.events.replaceChildren();
      renderFinancials();
      renderFollowState();
      renderChart();
      return;
    }
    const { stock, session, timing } = snapshot;
    const displayPhase = snapshot.market === "cn" ? displayedAShareSessionPhase(snapshot, now()) : session.phase;
    if (elements.marketEyebrow) elements.marketEyebrow.textContent = snapshot.market === "us" ? "US STOCK DATA" : "A-SHARE STOCK DATA";
    elements.name.textContent = stock.name;
    elements.symbol.textContent = `${stock.symbol}${stock.exchange ? ` · ${stock.exchange}` : ""} · ${displayPhase === "intraday" ? "盘中" : displayPhase === "close" ? "收盘" : "最近收盘"} · ${formatClock(snapshot.asOf, snapshot.market)}`;
    elements.price.textContent = stock.price.toFixed(2);
    elements.change.textContent = `${stock.change > 0 ? "+" : ""}${stock.change.toFixed(2)} · ${formatPercent(stock.changePercent)}`;
    elements.change.dataset.tone = stock.changePercent > 0 ? "up" : stock.changePercent < 0 ? "down" : "flat";
    elements.timing.dataset.state = timing.state;
    elements.timingState.textContent = timing.label;
    elements.timingAction.textContent = timing.action;
    elements.confirmation.textContent = timing.confirmation;
    elements.invalidation.textContent = timing.invalidation;
    elements.diagnose.dataset.stockSubject = `${stock.symbol} ${stock.name}`;
    if (elements.deepResearch) elements.deepResearch.dataset.stockSubject = `${stock.symbol} ${stock.name}`;
    elements.follow.dataset.stockSymbol = stock.symbol;
    elements.follow.dataset.stockName = stock.name;
    elements.alert.dataset.stockSubject = `${stock.symbol} ${stock.name}`;
    const historyLabel = !snapshot.sourceStatus.history
      ? "历史源降级"
      : snapshot.historyAdjust === "none"
        ? `新股短历史 ${snapshot.bars.length} 个交易日 · 未复权`
        : snapshot.historyAdjust === "adj"
          ? `${snapshot.bars.length} 个交易日 · 股息拆股复权`
          : `${snapshot.bars.length} 个交易日 · 前复权`;
    elements.freshness.textContent = `${snapshot.marketDate} ${formatClock(snapshot.asOf, snapshot.market)} · ${historyLabel} · ${snapshot.events.length} 条公告/新闻`;
    document.querySelector("#stock-detail-chart-title").textContent = `近 ${Math.min(chartRange, snapshot.bars.length)} 个交易日`;
    renderOverview();
    renderMetrics();
    renderFinancials();
    renderLevels();
    renderChart();
    renderEvents();
    renderFollowState();
  }

  async function search(queryInput, knownSymbol = "", marketInput = "cn") {
    const query = cleanText(queryInput, 80);
    if (!query || loading) return snapshot;
    activeMarket = marketInput === "us" ? "us" : "cn";
    const searchGeneration = ++generation;
    loading = true;
    elements.status.dataset.tone = "active";
    elements.status.textContent = "正在核对股票身份，并读取实时行情、历史趋势、公告和新闻…";
    render();
    try {
      const handles = await ensureRuntime();
      if (knownSymbol && handles.persistent) {
        const cached = await fetchSnapshot(knownSymbol, "read-local", activeMarket).catch(() => null);
        if (cached && searchGeneration === generation) {
          if (snapshot?.stock?.symbol !== cached.stock.symbol) activeFinancialReportDate = null;
          snapshot = cached;
          onResolved(cached);
          elements.status.dataset.tone = "warning";
          elements.status.textContent = `已载入 ${cached.marketDate} 本地快照，正在刷新最新行情…`;
          render();
        }
      }
      const next = await fetchSnapshot(query, "refresh", activeMarket);
      if (searchGeneration !== generation) return snapshot;
      if (Date.parse(next.asOf) - now().getTime() > 60 * 60 * 1_000) throw new Error("个股行情时点晚于当前时间");
      if (snapshot?.stock?.symbol !== next.stock.symbol) activeFinancialReportDate = null;
      snapshot = next;
      onResolved(next);
      const localPersistence = (await ensureRuntime()).persistent;
      const requiredSources = next.market === "cn"
        ? ["history", "announcements", "news", "financials"]
        : ["history", "announcements", "news"];
      const degraded = requiredSources.some((source) => next.sourceStatus[source] !== true);
      const shortHistory = next.sourceStatus.history && next.bars.length < 60;
      elements.status.dataset.tone = degraded || shortHistory ? "warning" : "active";
      elements.status.textContent = [
        `${next.stock.name}行情已更新：${next.marketDate} ${formatClock(next.asOf, next.market)}。`,
        degraded
          ? "部分历史、公告、新闻或财务摘要源本次降级，缺失项不会补写。"
          : shortHistory
            ? `已展示上市以来 ${next.bars.length} 个交易日行情；不足 60 日，暂不生成趋势买卖时机。`
            : "实时行情、历史趋势、公告和新闻均已通过结构校验。",
        localPersistence ? "本次快照已保存到 CodeShell 本地数据目录。" : "当前 CodeShell 仅保留本次会话快照。",
      ].join("");
      return next;
    } catch (error) {
      if (searchGeneration !== generation) return snapshot;
      const message = error instanceof Error ? error.message : "个股行情读取失败";
      elements.status.dataset.tone = snapshot ? "warning" : "error";
      elements.status.textContent = snapshot
        ? `最新行情刷新失败：${message}。已保留上一份通过校验的个股快照。`
        : `${message}。请检查名称或代码后重试。`;
      return snapshot;
    } finally {
      if (searchGeneration === generation) {
        loading = false;
        render();
      }
    }
  }

  elements.close.addEventListener("click", () => {
    generation += 1;
    if (activeProcessId) void hostCall("process.cancel", { processId: activeProcessId }).catch(() => undefined);
    activeProcessId = null;
    loading = false;
    snapshot = null;
    activeFinancialReportDate = null;
    render();
  });
  elements.diagnose.addEventListener("click", () => {
    if (elements.diagnose.dataset.stockSubject) onDiagnose(elements.diagnose.dataset.stockSubject);
  });
  elements.deepResearch?.addEventListener("click", () => {
    if (elements.deepResearch.dataset.stockSubject) onDeepResearch(elements.deepResearch.dataset.stockSubject);
  });
  elements.follow.addEventListener("click", async () => {
    const symbol = elements.follow.dataset.stockSymbol;
    if (!symbol || followPending || isFollowed(symbol)) return;
    followPending = true;
    renderFollowState();
    try {
      await onFollow(symbol, elements.follow.dataset.stockName ?? "");
    } finally {
      followPending = false;
      renderFollowState();
    }
  });
  elements.alert.addEventListener("click", () => {
    if (elements.alert.dataset.stockSubject) onAlert(elements.alert.dataset.stockSubject);
  });
  elements.root.addEventListener("click", (event) => {
    const financialPeriod = event.target.closest("[data-financial-report-date]");
    if (financialPeriod) {
      activeFinancialReportDate = financialPeriod.dataset.financialReportDate;
      renderFinancials();
      return;
    }
    const range = event.target.closest("[data-stock-chart-range]");
    if (range) {
      chartRange = Number(range.dataset.stockChartRange);
      for (const button of elements.root.querySelectorAll("[data-stock-chart-range]")) {
        button.setAttribute("aria-pressed", String(button === range));
      }
      if (snapshot) document.querySelector("#stock-detail-chart-title").textContent = `近 ${Math.min(chartRange, snapshot.bars.length)} 个交易日`;
      renderChart();
      return;
    }
    const jump = event.target.closest("[data-stock-detail-jump]");
    if (!jump) return;
    const target = document.getElementById(jump.dataset.stockDetailJump);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  elements.events.addEventListener("click", (event) => {
    const button = event.target.closest("[data-stock-event-url]");
    if (!button) return;
    void hostCall("external.open", { url: button.dataset.stockEventUrl }).catch(() => undefined);
  });
  render();

  return {
    search,
    reset() {
      generation += 1;
      if (activeProcessId) void hostCall("process.cancel", { processId: activeProcessId }).catch(() => undefined);
      activeProcessId = null;
      snapshot = null;
      loading = false;
      runtime = null;
      chartRange = 60;
      activeFinancialReportDate = null;
      activeMarket = "cn";
      followPending = false;
      for (const button of elements.root.querySelectorAll("[data-stock-chart-range]")) {
        button.setAttribute("aria-pressed", String(button.dataset.stockChartRange === "60"));
      }
      render();
    },
    dispose() {
      generation += 1;
      unsubscribeOutput?.();
      unsubscribeExit?.();
    },
    get snapshot() {
      return snapshot;
    },
  };
}
