import { canonicalAShareSymbol } from "./a-share-instruments.mjs";

const MAX_STOCKS = 20;
const INDICATORS = Object.freeze({
  rsi14: [0, 100],
  atr14: [0, 1_000_000],
  atrPercent: [0, 10_000],
  macd: [-1_000_000, 1_000_000],
  macdSignal: [-1_000_000, 1_000_000],
  adx14: [0, 100],
});
const FINANCIALS = Object.freeze(["pe", "pb", "roe", "netProfitMargin", "revenueYoY", "profitYoY"]);

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value, maximum = 240) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, maximum)
    : "";
}

function date(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function instant(value) {
  return typeof value === "string" && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    date(value.slice(0, 10)) && Number.isFinite(Date.parse(value)) ? value : null;
}

function number(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
}

function emptyTechnical(reason = "未补充 stockstats 指标") {
  return Object.freeze({
    available: false, asOf: null, adjustment: "qfq", barCount: 0, calculation: Object.freeze({}),
    ...Object.fromEntries(Object.keys(INDICATORS).map((key) => [key, null])), reason,
  });
}

function emptyFundamentals(reason = "未补充 efinance 财务快照") {
  return Object.freeze({
    available: false, observedAt: null, reportDate: null, disclosureDate: null,
    ...Object.fromEntries(FINANCIALS.map((key) => [key, null])), reason,
  });
}

function emptyQuote(reason = "未补充行情交叉检查") {
  return Object.freeze({ available: false, asOf: null, price: null, adjustment: "none", reason });
}

function provider(value, label) {
  if (!record(value) || typeof value.available !== "boolean") {
    return Object.freeze({ available: false, version: null, reason: `${label} 未补充或依赖缺失` });
  }
  return Object.freeze({
    available: value.available && value.supported !== false,
    ...(typeof value.supported === "boolean" ? { supported: value.supported } : {}),
    version: text(value.version, 40) || null,
    reason: text(value.reason) || (value.supported === false ? `${label} 当前版本或接口未受支持` : value.available ? "" : `${label} 不可用`),
  });
}

function parseTechnical(value, context) {
  if (!record(value) || value.available !== true) {
    const asOf = date(value?.asOf);
    const barCount = number(value?.barCount, 0, 10_000);
    return Object.freeze({ ...emptyTechnical(text(value?.reason) || undefined),
      asOf: asOf && (!context.marketDate || asOf <= context.marketDate) ? asOf : null,
      barCount: Number.isInteger(barCount) ? barCount : 0,
    });
  }
  const asOf = date(value.asOf);
  const barCount = number(value.barCount, 120, 10_000);
  const indicators = Object.fromEntries(Object.entries(INDICATORS).map(([key, limits]) => [key, number(value[key], ...limits)]));
  if (!asOf || (context.marketDate && asOf > context.marketDate) || value.adjustment !== "qfq" ||
      !Number.isInteger(barCount) || Object.values(indicators).some((item) => item === null)) {
    return emptyTechnical("技术指标字段或时点无效，等待重新补充");
  }
  if (context.provisional !== true && context.marketDate && asOf !== context.marketDate) {
    return Object.freeze({ ...emptyTechnical("指标未覆盖本次收盘，等待当日 K 线"), asOf, barCount });
  }
  const calculation = Object.freeze(Object.fromEntries(["rsi", "atr", "macd", "adx"]
    .filter((key) => text(value.calculation?.[key]))
    .map((key) => [key, text(value.calculation[key])])));
  return Object.freeze({ available: true, asOf, adjustment: "qfq", barCount, calculation, ...indicators, reason: text(value.reason) });
}

function parseFundamentals(value, context) {
  if (!record(value) || value.available !== true) return emptyFundamentals(text(value?.reason) || undefined);
  const observedAt = instant(value.observedAt);
  const metrics = Object.fromEntries(FINANCIALS.map((key) => [key, number(value[key], -1_000_000, 1_000_000)]));
  const invalidMetric = FINANCIALS.some((key) => value[key] != null && metrics[key] === null);
  if (!observedAt || (context.generatedAt && Date.parse(observedAt) > Date.parse(context.generatedAt) + 60_000) ||
      value.reportDate != null || value.disclosureDate != null || invalidMetric ||
      Object.values(metrics).every((item) => item === null)) {
    return emptyFundamentals("财务快照字段或抓取时点无效，等待重新补充");
  }
  return Object.freeze({
    available: true, observedAt, reportDate: null, disclosureDate: null,
    ...metrics, reason: text(value.reason),
  });
}

function parseQuote(value, context) {
  if (!record(value) || value.available !== true) return emptyQuote(text(value?.reason) || undefined);
  const asOf = instant(value.asOf) || date(value.asOf);
  const price = number(value.price, 0.01, 1_000_000);
  if (!asOf || price === null || value.adjustment !== "none" ||
      (context.generatedAt && Date.parse(asOf) > Date.parse(context.generatedAt) + 60_000)) {
    return emptyQuote("行情交叉检查字段或时点无效");
  }
  return Object.freeze({ available: true, asOf, price, adjustment: "none", reason: text(value.reason) });
}

function unavailable(reason, providers = {}) {
  return Object.freeze({
    version: 1, status: "unavailable", reason,
    providers: Object.freeze({
      stockstats: provider(providers.stockstats, "stockstats"),
      efinance: provider(providers.efinance, "efinance"),
      easyTdx: provider(providers.easyTdx, "easy_tdx"),
    }),
    stocks: Object.freeze([]),
  });
}

// Optional enrichment must never make the base selection snapshot unreadable.
// This parser is shared by the browser and Node; importing it has no DOM effects.
export function parseSelectionResearchEvidence(value, { marketDate, generatedAt, provisional = false } = {}) {
  if (value == null) return unavailable("这份快照尚未补充核验证据");
  if (!record(value) || value.version !== 1 || !["ready", "partial", "unavailable"].includes(value.status) ||
      !Array.isArray(value.stocks) || value.stocks.length > MAX_STOCKS) {
    return unavailable("核验证据结构无效，基础选股仍可查看");
  }
  const providers = Object.freeze({
    stockstats: provider(value.providers?.stockstats, "stockstats"),
    efinance: provider(value.providers?.efinance, "efinance"),
    easyTdx: provider(value.providers?.easyTdx, "easy_tdx"),
  });
  const context = { marketDate: date(marketDate), generatedAt: instant(generatedAt), provisional };
  const symbols = new Set();
  let invalidRows = 0;
  const stocks = [];
  for (const item of value.stocks) {
    const symbol = text(item?.symbol, 16);
    if (!record(item) || canonicalAShareSymbol(symbol) !== symbol || symbols.has(symbol)) {
      invalidRows += 1;
      continue;
    }
    symbols.add(symbol);
    stocks.push(Object.freeze({
      symbol,
      technical: providers.stockstats.available ? parseTechnical(item.technical, context) : emptyTechnical(providers.stockstats.reason),
      fundamentals: providers.efinance.available ? parseFundamentals(item.fundamentals, context) : emptyFundamentals(providers.efinance.reason),
      quoteCheck: parseQuote(item.quoteCheck, context),
    }));
  }
  const anyAvailable = stocks.some((item) => item.technical.available || item.fundamentals.available || item.quoteCheck.available);
  const complete = !invalidRows && stocks.length > 0 && stocks.every((item) =>
    item.technical.available && item.fundamentals.available && item.quoteCheck.available);
  return Object.freeze({
    version: 1,
    status: !anyAvailable ? "unavailable" : complete && value.status === "ready" ? "ready" : "partial",
    reason: invalidRows ? "部分股票核验证据格式无效或重复，已忽略" : text(value.reason) || (!anyAvailable ? "本次未取得可用核验证据" : ""),
    providers,
    stocks: Object.freeze(stocks),
  });
}

function metric(value, digits = 1, suffix = "") {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)}${suffix}` : "—";
}

function reasonText(value, fallback = "未补充") {
  const reason = text(value);
  const known = {
    UPSTREAM_API_UNVERIFIED: "easy_tdx 上游接口当前未验证，暂不接入",
    PACKAGE_NOT_INSTALLED: "可选依赖未安装，本次未补充",
    VERSION_UNSUPPORTED: "当前依赖版本尚未受支持",
    PACKAGE_VERSION_UNSUPPORTED: "当前依赖版本尚未受支持",
    PACKAGE_VERSION_UNVERIFIED: "当前依赖版本尚未验证，暂不补充",
    INDICATOR_WARMUP_REQUIRED: "历史 K 线不足 120 根，指标仍需预热",
    INDICATOR_NONFINITE: "技术指标计算未产生有效数值",
    INDICATOR_ERROR: "技术指标计算失败，等待重新补充",
    QFQ_HISTORY_REQUIRED: "缺少前复权日线，无法计算可比指标",
    HISTORY_MISSING: "缺少历史 K 线，等待补充",
    CLOSED_HISTORY_MISSING: "缺少完整收盘 K 线",
    LAST_BAR_ZERO_VOLUME: "末根 K 线无有效成交量，暂不补充指标",
    HISTORY_DATE_ORDER_OR_CUTOFF: "历史 K 线日期或截止时点无效",
    HISTORY_OHLCV_INVALID: "历史 K 线价格或成交量无效",
    PROVIDER_UNAVAILABLE: "可选数据源暂不可用",
    PROVIDER_NO_RESULT: "本次数据源未返回可用结果",
    PROVIDER_PROCESS_ERROR: "补充数据处理失败，等待重新补充",
    PROVIDER_PROCESS_UNAVAILABLE: "补充数据环境不可用",
    PROVIDER_TIMEOUT: "补充数据超时，基础选股仍可查看",
    INSUFFICIENT_BARS: "历史 K 线不足 120 根，指标仍需预热",
    INSUFFICIENT_HISTORY: "历史 K 线不足，指标仍需预热",
    STALE_HISTORY: "历史 K 线未更新至本次交易日",
    HISTORY_STALE: "历史 K 线未更新至本次交易日",
    REQUEST_FAILED: "数据源请求失败，等待重新补充",
    TIMEOUT: "补充数据超时，基础选股仍可查看",
    QUOTE_UNAVAILABLE: "未取得可对照行情",
    FUNDAMENTALS_UNAVAILABLE: "未取得当前财务快照",
  };
  for (const [code, label] of Object.entries(known)) {
    if (reason.includes(code)) return label;
  }
  return reason || fallback;
}

function clock(value) {
  if (!instant(value)) return value || "时间未提供";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export function selectionResearchEvidenceRows(candidate, researchEvidence, { marketDate, provisional = false } = {}) {
  const evidence = researchEvidence?.stocks?.find((item) => item.symbol === candidate.symbol);
  const technical = evidence?.technical ?? emptyTechnical(researchEvidence?.providers?.stockstats?.reason || researchEvidence?.reason);
  const financial = evidence?.fundamentals ?? emptyFundamentals(researchEvidence?.providers?.efinance?.reason);
  const quote = evidence?.quoteCheck ?? emptyQuote(researchEvidence?.providers?.easyTdx?.reason);
  const currentBar = date(candidate.lastBarDate) === marketDate;
  const technicalLabel = technical.available ? "已补充" : "待补齐";
  const barLabel = currentBar ? provisional ? "盘中 K 线" : "当日收盘 K 线" : `K 线 ${date(candidate.lastBarDate) || "日期未提供"}`;
  return Object.freeze([
    Object.freeze({
      label: "K 线 / 波动动量 · stockstats", state: technical.available && (currentBar || provisional) ? "available" : "missing",
      status: technicalLabel,
      detail: `${barLabel}；${technical.available ? `指标 ${technical.asOf} · 前复权 · ${technical.barCount} 根` : reasonText(technical.reason)}`,
      metrics: `RSI14 ${metric(technical.rsi14)} · ATR ${metric(technical.atrPercent, 2, "%")} · 趋势强度 ${metric(technical.adx14)}${technical.calculation?.adx ? "（DX14 · α=1/14 · adjust=True）" : ""}`,
    }),
    Object.freeze({
      label: "财务快照 · efinance", state: financial.available ? "partial" : "missing",
      status: financial.available ? "仅当前截面" : "待补齐",
      detail: financial.available
        ? `ROE ${metric(financial.roe, 2, "%")} · 净利率 ${metric(financial.netProfitMargin, 2, "%")} · 抓取 ${clock(financial.observedAt)}（北京时间）`
        : reasonText(financial.reason),
      metrics: "",
    }),
    Object.freeze({
      label: "财务披露时点 / 现金流", state: "missing", status: "仍缺证据",
      detail: "报告期、实际披露日、经营现金流与利润匹配尚未核验；当前财务截面不能用于历史时点筛选。", metrics: "",
    }),
    Object.freeze({
      label: "行情交叉检查", state: quote.available ? "partial" : "missing",
      status: quote.available ? "已取得对照价" : "未核验",
      detail: quote.available
        ? `对照价 ${metric(quote.price, 2)} · 不复权 · ${clock(quote.asOf)}；需核对时点，未据此判定一致。`
        : reasonText(quote.reason),
      metrics: "",
    }),
  ]);
}

export function renderSelectionResearchEvidence(candidate, researchEvidence, { element, marketDate, provisional, compact = false }) {
  const section = element(compact ? "details" : "section", "selection-research-evidence");
  section.dataset.compact = String(compact);
  const heading = element(compact ? "summary" : "header", "");
  heading.append(element("b", "", compact ? "展开核验 · 核验完整性" : "核验完整性"));
  if (!compact) heading.append(element("span", "", "技术与财务仍需分别核验"));
  const rows = element("div", "selection-research-evidence-rows");
  for (const item of selectionResearchEvidenceRows(candidate, researchEvidence, { marketDate, provisional })) {
    const row = element("div", "selection-research-evidence-row");
    row.dataset.state = item.state;
    row.append(element("b", "", item.label), element("span", "selection-research-evidence-status", item.status), element("p", "", item.detail));
    if (item.metrics) row.append(element("small", "", item.metrics));
    rows.append(row);
  }
  section.append(heading, rows, element("p", "selection-research-evidence-note", "补充指标不改变现有排名；这还不是完整的基本面筛选。"));
  if (researchEvidence?.providers?.easyTdx?.available === false) {
    section.append(element("p", "selection-research-evidence-note", `easy_tdx：${reasonText(researchEvidence.providers.easyTdx.reason)}`));
  }
  return section;
}
