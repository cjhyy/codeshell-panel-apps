import { normalizeStockQuote } from "./stock-screener.mjs";

export const MARKET_PULSE_INDEXES = Object.freeze([
  Object.freeze({ symbol: "sh000001", displaySymbol: "指数 000001", name: "上证指数" }),
  Object.freeze({ symbol: "sz399001", displaySymbol: "指数 399001", name: "深证成指" }),
  Object.freeze({ symbol: "sz399006", displaySymbol: "指数 399006", name: "创业板指" }),
  Object.freeze({ symbol: "sh000300", displaySymbol: "指数 000300", name: "沪深300" }),
]);

const REGIME_LABELS = Object.freeze({
  bullish: "多头排列",
  improving: "趋势修复",
  range: "均线纠缠",
  weakening: "趋势转弱",
  bearish: "空头排列",
});

const SECTOR_NEWS_GROUPS = Object.freeze([
  Object.freeze({
    sectors: /电子|通信|软件|互联网|电脑|半导体|仪器仪表/u,
    terms: ["人工智能", "大模型", "算力", "芯片", "半导体", "光通信", "数据中心", "机器人", "端侧"],
  }),
  Object.freeze({
    sectors: /汽车|电器|电池/u,
    terms: ["新能源汽车", "电动车", "动力电池", "锂电", "智能驾驶", "自动驾驶", "车路云", "充电桩"],
  }),
  Object.freeze({
    sectors: /有色|钢铁|矿物|稀土/u,
    terms: ["有色金属", "黄金", "白银", "铜", "铝", "锂", "稀土", "矿产"],
  }),
  Object.freeze({
    sectors: /金融|银行|保险|证券/u,
    terms: ["金融", "银行", "保险", "券商", "证券", "资本市场"],
  }),
  Object.freeze({
    sectors: /房地产|建筑|建材|水泥|玻璃/u,
    terms: ["房地产", "地产", "住房", "建筑", "基建", "水泥", "玻璃"],
  }),
  Object.freeze({
    sectors: /医药|医疗|生物制药/u,
    terms: ["医药", "医疗", "创新药", "生物医药", "医疗器械", "医保"],
  }),
  Object.freeze({
    sectors: /电力|煤炭|石油|天然气/u,
    terms: ["电力", "煤炭", "石油", "原油", "天然气", "能源", "储能", "光伏", "风电"],
  }),
  Object.freeze({
    sectors: /食品|酿酒|酒店|旅游|商业|家居|服装|纺织/u,
    terms: ["消费", "白酒", "食品", "旅游", "零售", "家居", "服装", "以旧换新"],
  }),
  Object.freeze({
    sectors: /传媒|娱乐|广告/u,
    terms: ["传媒", "游戏", "影视", "电影", "广告", "短剧"],
  }),
  Object.freeze({
    sectors: /船舶|飞机|航天|军工/u,
    terms: ["军工", "国防", "航空", "航天", "船舶", "无人机"],
  }),
  Object.freeze({
    sectors: /农林|牧渔|农药|化肥/u,
    terms: ["农业", "种业", "粮食", "养殖", "生猪", "农药", "化肥"],
  }),
]);

function finiteNumber(value) {
  if (value === "" || value === "-" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value, maximum = 300) {
  return String(value ?? "")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos);/giu, " ")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validInstant(value) {
  if (typeof value !== "string" || value.length > 40) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/u.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , offsetHour = "00", offsetMinute = "00"] = match;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
  if (Number(offsetHour) > 14 || Number(offsetMinute) > 59 || (Number(offsetHour) === 14 && Number(offsetMinute) !== 0)) return false;
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return calendar.toISOString().slice(0, 10) === `${year}-${month}-${day}` && Number.isFinite(Date.parse(value));
}

function calendarGapDays(laterDate, earlierDate) {
  return Math.round(
    (Date.parse(`${laterDate}T00:00:00.000Z`) - Date.parse(`${earlierDate}T00:00:00.000Z`)) /
      86_400_000,
  );
}

function percent(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${round(value, digits).toFixed(digits)}%`;
}

function formatAmount(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000_000) return `${round(value / 1_000_000_000_000, 2)} 万亿`;
  return `${round(value / 100_000_000, 1).toLocaleString("zh-CN")} 亿`;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function normalizeQuoteInput(value) {
  if (
    value?.symbol &&
    /^(?:SH|SZ)\d{6}$/u.test(value.symbol) &&
    typeof value.name === "string" &&
    ["main", "star", "chinext"].includes(value.board) &&
    Number.isFinite(value.changePercent) &&
    Number.isFinite(value.amount) &&
    value.amount >= 0
  ) {
    return value;
  }
  return normalizeStockQuote(value);
}

export function calculateMarketBreadth(quotesInput) {
  const quotes = (Array.isArray(quotesInput) ? quotesInput : []).map(normalizeQuoteInput).filter(Boolean);
  if (quotes.length < 100) throw new Error("market breadth requires at least 100 valid quotes");
  let up = 0;
  let down = 0;
  let flat = 0;
  let limitUp = 0;
  let limitDown = 0;
  let aboveFive = 0;
  let belowFive = 0;
  let amount = 0;
  const changes = [];
  for (const quote of quotes) {
    const change = quote.changePercent;
    if (change > 0.005) up += 1;
    else if (change < -0.005) down += 1;
    else flat += 1;
    const threshold = /(?:ST|退)/iu.test(quote.name)
      ? 4.8
      : ["star", "chinext"].includes(quote.board)
        ? 19.5
        : 9.5;
    if (change >= threshold) limitUp += 1;
    if (change <= -threshold) limitDown += 1;
    if (change >= 5) aboveFive += 1;
    if (change <= -5) belowFive += 1;
    amount += quote.amount;
    changes.push(change);
  }
  return Object.freeze({
    total: quotes.length,
    up,
    down,
    flat,
    limitUp,
    limitDown,
    aboveFive,
    belowFive,
    amount,
    medianChange: median(changes),
    netBreadth: (up - down) / quotes.length,
  });
}

export function parseSinaIndustryPayload(textInput) {
  const text = String(textInput ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("industry payload is not an object");
  let payload;
  try {
    payload = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("industry payload is not valid JSON");
  }
  const rows = [];
  for (const raw of Object.values(payload && typeof payload === "object" ? payload : {})) {
    const fields = String(raw).split(",");
    const [id, rawName, rawCount, , , rawChange, rawVolume, rawAmount, leaderSymbol, rawLeaderChange, rawLeaderPrice, , rawLeaderName] = fields;
    const name = cleanText(rawName, 40);
    const count = finiteNumber(rawCount);
    const changePercent = finiteNumber(rawChange);
    const volume = finiteNumber(rawVolume);
    const amount = finiteNumber(rawAmount);
    const leaderChangePercent = finiteNumber(rawLeaderChange);
    const leaderPrice = finiteNumber(rawLeaderPrice);
    if (!/^new_[A-Za-z0-9]+$/u.test(id) || !name || !Number.isInteger(count) || count < 1) continue;
    if (changePercent == null || volume == null || amount == null || volume < 0 || amount < 0) continue;
    rows.push(Object.freeze({
      id,
      name,
      count,
      changePercent,
      volume,
      amount,
      leaderSymbol: /^(?:sh|sz)\d{6}$/u.test(leaderSymbol) ? leaderSymbol.toUpperCase() : "",
      leaderName: cleanText(rawLeaderName, 40),
      leaderChangePercent,
      leaderPrice,
    }));
  }
  if (rows.length < 20) throw new Error(`industry coverage too low: ${rows.length}`);
  return rows.sort((left, right) => right.changePercent - left.changePercent || left.id.localeCompare(right.id));
}

export function parseSinaIndexQuotes(textInput) {
  const text = String(textInput ?? "");
  const quotes = new Map();
  for (const match of text.matchAll(/var\s+hq_str_([a-z]{2}\d{6})="([^"]*)";/gu)) {
    const symbol = match[1];
    const fields = match[2].split(",");
    const name = cleanText(fields[0], 40);
    const open = finiteNumber(fields[1]);
    const previousClose = finiteNumber(fields[2]);
    const price = finiteNumber(fields[3]);
    const high = finiteNumber(fields[4]);
    const low = finiteNumber(fields[5]);
    const volume = finiteNumber(fields[8]);
    const amount = finiteNumber(fields[9]);
    const marketDate = fields[30];
    const time = fields[31];
    if (!name || [open, previousClose, price, high, low, volume, amount].some((value) => value == null)) continue;
    const asOf = `${marketDate}T${time}+08:00`;
    if (!validDate(marketDate) || !validInstant(asOf) || price <= 0 || previousClose <= 0) continue;
    quotes.set(symbol, Object.freeze({
      symbol,
      name,
      open,
      previousClose,
      price,
      high,
      low,
      volume,
      amount,
      changePercent: (price / previousClose - 1) * 100,
      marketDate,
      asOf,
    }));
  }
  return quotes;
}

export function parseSinaKline(payload) {
  const rows = payload?.result?.data;
  if (!Array.isArray(rows)) throw new Error("index history payload has no data array");
  const bars = rows.flatMap((row) => {
    const date = cleanText(row?.day, 10);
    const open = finiteNumber(row?.open);
    const high = finiteNumber(row?.high);
    const low = finiteNumber(row?.low);
    const close = finiteNumber(row?.close);
    const volume = finiteNumber(row?.volume);
    if (!validDate(date) || [open, high, low, close, volume].some((value) => value == null)) return [];
    if (Math.min(open, high, low, close) <= 0 || volume < 0 || high < Math.max(open, close) || low > Math.min(open, close)) return [];
    return [{ date, open, high, low, close, volume }];
  });
  const byDate = new Map(bars.map((bar) => [bar.date, bar]));
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function analyzeIndexTrend(quote, barsInput) {
  if (
    !quote ||
    !validDate(quote.marketDate) ||
    !validInstant(quote.asOf) ||
    quote.asOf.slice(0, 10) !== quote.marketDate
  ) {
    throw new Error("valid live index quote required");
  }
  const historyBars = (Array.isArray(barsInput) ? barsInput : [])
    .filter((bar) => validDate(bar?.date) && bar.date <= quote.marketDate && Number.isFinite(bar.close) && bar.close > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  const lastHistory = historyBars.at(-1);
  if (!lastHistory || calendarGapDays(quote.marketDate, lastHistory.date) > 10) {
    throw new Error(`${quote.name} history is stale`);
  }
  const byDate = new Map(historyBars.map((bar) => [bar.date, { ...bar }]));
  byDate.set(quote.marketDate, {
    date: quote.marketDate,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    close: quote.price,
    volume: quote.volume,
  });
  const bars = [...byDate.values()]
    .filter((bar) => validDate(bar.date) && bar.date <= quote.marketDate && Number.isFinite(bar.close) && bar.close > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  if (bars.length < 121) throw new Error(`${quote.name} history has only ${bars.length} valid bars`);
  const current = bars.at(-1);
  const closes = bars.map((bar) => bar.close);
  const ma20 = mean(closes.slice(-20));
  const ma60 = mean(closes.slice(-60));
  const ma120 = mean(closes.slice(-120));
  let regime = "range";
  if (current.close > ma20 && ma20 > ma60 && ma60 > ma120) regime = "bullish";
  else if (current.close < ma20 && ma20 < ma60 && ma60 < ma120) regime = "bearish";
  else if (current.close > ma20 && ma20 > ma60) regime = "improving";
  else if (current.close < ma20 && ma20 < ma60) regime = "weakening";
  const highLookback = Math.min(250, bars.length);
  const high250 = Math.max(...bars.slice(-highLookback).map((bar) => bar.high ?? bar.close));
  return Object.freeze({
    symbol: quote.symbol,
    name: quote.name,
    marketDate: quote.marketDate,
    asOf: quote.asOf,
    lastBarDate: current.date,
    close: current.close,
    changePercent: quote.changePercent,
    ma20,
    ma60,
    ma120,
    return20: (current.close / bars.at(-21).close - 1) * 100,
    return60: (current.close / bars.at(-61).close - 1) * 100,
    return120: (current.close / bars.at(-121).close - 1) * 100,
    drawdown250: (current.close / high250 - 1) * 100,
    highLookback,
    regime,
    regimeLabel: REGIME_LABELS[regime],
  });
}

export function parseEastmoneyMarketNews(payload, fetchedAtInput) {
  const fetchedAt = new Date(fetchedAtInput);
  if (!Number.isFinite(fetchedAt.getTime())) throw new Error("valid fetchedAt required");
  const rows = payload?.data?.fastNewsList ?? payload?.data?.list;
  if (!Array.isArray(rows)) throw new Error("market news payload has no list");
  return rows.slice(0, 100).flatMap((row) => {
    const code = cleanText(row?.code ?? row?.id, 80);
    const title = cleanText(row?.title ?? row?.Title, 240);
    const summary = cleanText(row?.summary ?? row?.Summary, 600);
    const rawTime = cleanText(row?.showTime ?? row?.ShowTime ?? row?.date, 32);
    const sourceInstant = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(rawTime)
      ? `${rawTime.replace(" ", "T")}+08:00`
      : "";
    const publishedAt = validInstant(sourceInstant) ? new Date(sourceInstant).toISOString() : null;
    if (!code || !title || !publishedAt) return [];
    return [{
      id: code,
      title,
      summary,
      publishedAt,
      fetchedAt: fetchedAt.toISOString(),
      url: `https://finance.eastmoney.com/a/${encodeURIComponent(code)}.html`,
      source: "eastmoney-724",
      sourceLabel: "东方财富 7×24",
      sourceTier: 2,
      official: false,
    }];
  });
}

export function parseSinaFinanceRoll(payload, fetchedAtInput) {
  const fetchedAt = new Date(fetchedAtInput);
  if (!Number.isFinite(fetchedAt.getTime())) throw new Error("valid fetchedAt required");
  const rows = payload?.result?.data;
  if (!Array.isArray(rows)) throw new Error("Sina finance roll payload has no list");
  return rows.slice(0, 100).flatMap((row) => {
    const sourceId = cleanText(row?.docid ?? row?.oid, 100);
    const title = cleanText(row?.title, 240);
    const summary = cleanText(row?.intro ?? row?.summary, 600);
    const timestamp = Number(row?.ctime ?? row?.intime);
    const publishedAt = Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1_000).toISOString() : null;
    const publisher = cleanText(row?.media_name, 60);
    let url;
    try {
      const parsed = new URL(row?.url);
      if (parsed.protocol !== "https:" || parsed.hostname !== "finance.sina.com.cn" || parsed.username || parsed.password) return [];
      url = parsed.toString();
    } catch {
      return [];
    }
    if (!sourceId || !title || !validInstant(publishedAt)) return [];
    return [{
      id: `sina:${sourceId}`,
      title,
      summary,
      publishedAt,
      fetchedAt: fetchedAt.toISOString(),
      url,
      source: "sina-finance",
      sourceLabel: publisher ? `${publisher} · 新浪聚合` : "新浪财经滚动",
      sourceTier: 2,
      official: false,
    }];
  });
}

export function parseCsrcMarketNews(htmlInput, fetchedAtInput) {
  const fetchedAt = new Date(fetchedAtInput);
  if (!Number.isFinite(fetchedAt.getTime())) throw new Error("valid fetchedAt required");
  const html = String(htmlInput ?? "");
  if (html.length < 100 || html.length > 2_000_000) throw new Error("CSRC news page shape invalid");
  const rows = [];
  const pattern = /<a\s+href="(\/csrc\/(?:c100028|c100039)\/c\d+\/content\.shtml)"[^>]*>([\s\S]*?)<\/a>\s*<span\s+class="time">(\d{2})-(\d{2})<\/span>/giu;
  for (const match of html.matchAll(pattern)) {
    const title = cleanText(match[2], 240);
    if (!title) continue;
    let year = fetchedAt.getUTCFullYear();
    if (Number(match[3]) > fetchedAt.getUTCMonth() + 2) year -= 1;
    const sourceInstant = `${year}-${match[3]}-${match[4]}T00:00:00+08:00`;
    if (!validInstant(sourceInstant)) continue;
    const publishedAt = new Date(sourceInstant).toISOString();
    const id = match[1].match(/\/c(\d+)\/content\.shtml$/u)?.[1];
    if (!id) continue;
    rows.push({
      id: `csrc:${id}`,
      title,
      summary: "中国证监会官方发布",
      publishedAt,
      fetchedAt: fetchedAt.toISOString(),
      url: `https://www.csrc.gov.cn${match[1]}`,
      source: "csrc-policy",
      sourceLabel: "中国证监会 · 官方发布",
      sourceTier: 1,
      official: true,
    });
  }
  return rows.slice(0, 30);
}

export function parsePbcMarketNews(htmlInput, fetchedAtInput) {
  const fetchedAt = new Date(fetchedAtInput);
  if (!Number.isFinite(fetchedAt.getTime())) throw new Error("valid fetchedAt required");
  const html = String(htmlInput ?? "");
  if (html.length < 100 || html.length > 2_000_000) throw new Error("PBC news page shape invalid");
  const rows = [];
  const pattern = /<a\s+href="(\/goutongjiaoliu\/113456\/113469\/\d+\/index\.html)"[^>]*\stitle="([^"]+)"[^>]*>[\s\S]*?<\/a>[\s\S]*?<span\s+class="hui12">(\d{4}-\d{2}-\d{2})<\/span>/giu;
  for (const match of html.matchAll(pattern)) {
    const title = cleanText(match[2], 240);
    const sourceInstant = `${match[3]}T00:00:00+08:00`;
    if (!title || !validInstant(sourceInstant)) continue;
    const id = match[1].match(/\/(\d+)\/index\.html$/u)?.[1];
    if (!id) continue;
    rows.push({
      id: `pbc:${id}`,
      title,
      summary: "中国人民银行官方发布",
      publishedAt: new Date(sourceInstant).toISOString(),
      fetchedAt: fetchedAt.toISOString(),
      url: `https://www.pbc.gov.cn${match[1]}`,
      source: "pbc-policy",
      sourceLabel: "中国人民银行 · 官方发布",
      sourceTier: 1,
      official: true,
    });
  }
  return rows.slice(0, 30);
}

function marketNewsKey(value) {
  return cleanText(value, 300)
    .toLocaleLowerCase("zh-CN")
    .replace(/(?:快讯|最新|突发|独家)/gu, "")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function marketNewsSimilar(left, right) {
  const a = marketNewsKey(left);
  const b = marketNewsKey(right);
  if (!a || !b) return false;
  if (a === b || (Math.min(a.length, b.length) >= 10 && (a.includes(b) || b.includes(a)))) return true;
  const pairs = (value) => new Set(Array.from({ length: Math.max(0, value.length - 1) }, (_unused, index) => value.slice(index, index + 2)));
  const aPairs = pairs(a);
  const bPairs = pairs(b);
  if (!aPairs.size || !bPairs.size) return false;
  const overlap = [...aPairs].filter((pair) => bPairs.has(pair)).length;
  return overlap / (aPairs.size + bPairs.size - overlap) >= 0.62;
}

function marketNewsHash(value) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function mergeMarketNews(itemsInput) {
  const items = (Array.isArray(itemsInput) ? itemsInput : [])
    .filter((item) => item?.id && item?.title && validInstant(item?.publishedAt))
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt) || left.id.localeCompare(right.id));
  const clusters = [];
  for (const item of items) {
    const cluster = clusters.find((candidate) => (
      Math.abs(Date.parse(candidate[0].publishedAt) - Date.parse(item.publishedAt)) <= 12 * 60 * 60 * 1_000 &&
      marketNewsSimilar(candidate[0].title, item.title)
    ));
    if (cluster) cluster.push(item);
    else clusters.push([item]);
  }
  return clusters.map((group) => {
    const ordered = [...group].sort((left, right) => (
      (left.sourceTier ?? 3) - (right.sourceTier ?? 3) ||
      Date.parse(right.publishedAt) - Date.parse(left.publishedAt) ||
      right.title.length - left.title.length
    ));
    const primary = ordered[0];
    const sources = [...new Map(ordered.map((item) => [item.source, {
      source: item.source,
      label: item.sourceLabel,
      url: item.url,
      official: item.official === true,
    }])).values()];
    return Object.freeze({
      ...primary,
      id: `market-news:${marketNewsHash(`${marketNewsKey(primary.title)}:${Math.floor(Date.parse(primary.publishedAt) / (12 * 60 * 60 * 1_000))}`)}`,
      summary: ordered.map((item) => item.summary).filter(Boolean).join(" ").slice(0, 900),
      sourceCount: sources.length,
      official: sources.some((source) => source.official),
      sources: Object.freeze(sources.map(Object.freeze)),
    });
  }).sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
}

function aliasesForSector(name) {
  const aliases = new Set();
  const base = name.replace(/(?:行业|制造|设备|服务|制品|器械)$/u, "");
  if (base.length >= 2) aliases.add(base);
  for (const group of SECTOR_NEWS_GROUPS) {
    if (group.sectors.test(name)) for (const term of group.terms) aliases.add(term);
  }
  return [...aliases];
}

export function associateSectorNews(industriesInput, newsInput, asOfInput, maximumAgeHours = 24) {
  const asOf = Date.parse(asOfInput);
  if (!Number.isFinite(asOf)) throw new Error("valid asOf required");
  const minimum = asOf - maximumAgeHours * 60 * 60 * 1_000;
  const news = (Array.isArray(newsInput) ? newsInput : []).filter((item) => {
    const published = Date.parse(item?.publishedAt);
    return Number.isFinite(published) && published >= minimum && published <= asOf + 5 * 60 * 1_000;
  });
  const result = new Map();
  for (const sector of Array.isArray(industriesInput) ? industriesInput : []) {
    const aliases = aliasesForSector(sector.name);
    const matches = news
      .filter((item) => {
        const haystack = `${item.title} ${item.summary}`.toLocaleLowerCase("zh-CN");
        return aliases.some((alias) => haystack.includes(alias.toLocaleLowerCase("zh-CN")));
      })
      .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt) || left.id.localeCompare(right.id));
    result.set(sector.id, Object.freeze({ aliases: Object.freeze(aliases), matches: Object.freeze(matches) }));
  }
  return result;
}

function trendTone(trend) {
  if (["bullish", "improving"].includes(trend.regime)) return "positive";
  if (["bearish", "weakening"].includes(trend.regime)) return "warning";
  return "neutral";
}

function marketStatus(trends, breadth) {
  if (trends.length < 2) return "unavailable";
  const strong = trends.filter((trend) => trend.regime === "bullish").length;
  const weak = trends.filter((trend) => trend.regime === "bearish").length;
  if (strong >= 3 && breadth.netBreadth >= 0.1) return "positive";
  if (weak >= 3 && breadth.netBreadth <= -0.1) return "caution";
  return "mixed";
}

function reportSources({ asOf, hasIndexQuotes, hasIndustry, news, trends }) {
  const sources = [
    {
      label: "新浪行情中心 · 沪深 A 股快照",
      url: "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=1&num=100&sort=symbol&asc=1&node=hs_a&symbol=&_s_r_a=page",
      asOf,
    },
  ];
  if (hasIndexQuotes) {
    sources.push({
      label: "新浪财经 · 主要指数行情",
      url: "https://hq.sinajs.cn/list=sh000001,sz399001,sz399006,sh000300",
      asOf,
    });
  }
  for (const trend of trends) {
    sources.push({
      label: `新浪财经 · ${trend.name}日线`,
      url: `https://quotes.sina.cn/cn/api/openapi.php/CN_MarketDataService.getKLineData?symbol=${trend.symbol}&scale=240&ma=no&datalen=250`,
      asOf: trend.lastBarDate,
    });
  }
  if (hasIndustry) {
    sources.push({
      label: "新浪财经 · 行业板块快照",
      url: "https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php",
      asOf,
    });
  }
  const newsSources = new Set(news.map((item) => item.source));
  if (newsSources.has("eastmoney-724")) {
    sources.push({
      label: "东方财富 · 7×24 财经快讯",
      url: "https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_news_col&fastColumn=102&sortEnd=&pageSize=50",
      asOf,
    });
  }
  if (newsSources.has("sina-finance")) {
    sources.push({
      label: "新浪财经 · 财经滚动（媒体聚合）",
      url: "https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&num=50&page=1",
      asOf,
    });
  }
  if (newsSources.has("csrc-policy")) {
    sources.push({
      label: "中国证监会 · 要闻与政策解读（官方）",
      url: "https://www.csrc.gov.cn/csrc/xwfb/index.shtml",
      asOf,
    });
  }
  if (newsSources.has("pbc-policy")) {
    sources.push({
      label: "中国人民银行 · 沟通交流（官方）",
      url: "https://www.pbc.gov.cn/goutongjiaoliu/113456/113469/index.html",
      asOf,
    });
  }
  return sources.slice(0, 12);
}

export function buildMarketPulseReport({
  quotes,
  industries = [],
  indexQuotes,
  indexHistories,
  news = [],
  marketDate,
  asOf,
  generatedAt,
  provisional = false,
  previousClose = false,
  marketHistory = [],
  sourceStatus = {},
}) {
  if (!validDate(marketDate) || !validInstant(asOf) || !validInstant(generatedAt)) {
    throw new Error("market pulse requires valid date and timezone-qualified instants");
  }
  if (Date.parse(asOf) > Date.parse(generatedAt) + 60 * 60 * 1_000) {
    throw new Error("market pulse asOf cannot be after generatedAt");
  }
  if (asOf.slice(0, 10) !== marketDate) {
    throw new Error("market pulse marketDate must match asOf local date");
  }
  if (provisional && previousClose) {
    throw new Error("market pulse cannot be both provisional and previous-close");
  }
  const breadth = calculateMarketBreadth(quotes);
  const quoteMap = indexQuotes instanceof Map ? indexQuotes : new Map(Object.entries(indexQuotes ?? {}));
  const historyMap = indexHistories instanceof Map ? indexHistories : new Map(Object.entries(indexHistories ?? {}));
  const trends = [];
  for (const spec of MARKET_PULSE_INDEXES) {
    const quote = quoteMap.get(spec.symbol);
    const bars = historyMap.get(spec.symbol);
    if (!quote || !Array.isArray(bars)) continue;
    try {
      trends.push({ ...analyzeIndexTrend(quote, bars), displaySymbol: spec.displaySymbol });
    } catch {
      // A stale or malformed index history is omitted instead of being
      // interpolated. The report's coverage risk makes the omission visible.
    }
  }
  const validIndustries = Array.isArray(industries)
    ? industries.filter((item) => item && Number.isFinite(item.changePercent)).slice().sort((left, right) => right.changePercent - left.changePercent)
    : [];
  const selectedSectors = [...validIndustries.slice(0, 3), ...validIndustries.slice(-2)].filter(
    (sector, index, array) => array.findIndex((item) => item.id === sector.id) === index,
  );
  const sectorNews = associateSectorNews(selectedSectors, news, asOf);
  const strong = trends.filter((trend) => trend.regime === "bullish").length;
  const weak = trends.filter((trend) => trend.regime === "bearish").length;
  const below120 = trends.filter((trend) => trend.close < trend.ma120).length;
  const averageDrawdown = trends.length ? mean(trends.map((trend) => trend.drawdown250)) : null;
  const status = marketStatus(trends, breadth);
  const environment = buildMarketEnvironment({
    quotes,
    marketDate,
    generatedAt,
    provisional,
    historySnapshots: marketHistory,
    indexTrends: trends,
  });
  const topSector = validIndustries[0] ?? null;
  const bottomSector = validIndustries.at(-1) ?? null;
  const linkedSectors = selectedSectors.filter((sector) => (sectorNews.get(sector.id)?.matches.length ?? 0) > 0).length;
  const phase = provisional ? "盘中累计" : previousClose ? "最近收盘" : "收盘";
  const summaryParts = [
    `${phase}快照：上涨 ${breadth.up} 家、下跌 ${breadth.down} 家，中位涨跌 ${percent(breadth.medianChange)}。`,
    trends.length
      ? `${trends.length} 个宽基中 ${strong} 个为多头排列、${weak} 个为空头排列，长期判断同时参考 20/60/120 日均线。`
      : "宽基历史本次不可用，长期趋势无法判断。",
  ];
  if (topSector && bottomSector) {
    summaryParts.push(`行业成分平均涨跌由 ${topSector.name} ${percent(topSector.changePercent)} 领涨，${bottomSector.name} ${percent(bottomSector.changePercent)} 居后。`);
  }
  if (news.length > 0 && selectedSectors.length > 0) {
    summaryParts.push(`近 24 小时新闻只作为催化线索：本页 ${selectedSectors.length} 个强弱板块中 ${linkedSectors} 个有关键词匹配，未据此判断利好或利空。`);
  }
  if (provisional) summaryParts.push("盘中价格、成交额和板块排序尚未定稿，收盘后应重新生成。");
  if (previousClose) summaryParts.push(`当前运行日没有取得新交易日快照，展示的是 ${marketDate} 最近收盘；可能处于周末、节假日或数据源延迟。`);

  const facts = [
    {
      label: "市场环境",
      value: `${environment.label} ${environment.score} 分 · ${environment.phase.label}${environment.phase.available ? `第 ${environment.phase.duration} 日` : ""}`,
      tone: ["strong", "lean_strong"].includes(environment.state) ? "positive" : ["lean_weak", "weak"].includes(environment.state) ? "warning" : "neutral",
    },
    {
      label: "趋势",
      value: trends.length ? `${strong}/${trends.length} 多头 · ${weak}/${trends.length} 空头` : "宽基历史不可用",
      tone: strong >= 3 ? "positive" : weak >= 3 ? "warning" : "neutral",
    },
    {
      label: "量能",
      value: `两市 ${formatAmount(breadth.amount)}（${phase}）`,
      tone: provisional ? "warning" : "neutral",
    },
    {
      label: "情绪",
      value: `全市场 ${breadth.total} · 涨 ${breadth.up} / 跌 ${breadth.down} / 平 ${breadth.flat} · 中位 ${percent(breadth.medianChange)}`,
      tone: breadth.netBreadth >= 0.15 ? "positive" : breadth.netBreadth <= -0.15 ? "negative" : "neutral",
    },
    {
      label: "风险",
      value: `${below120} 个宽基低于 MA120 · 跌停近似 ${breadth.limitDown} 家`,
      tone: below120 >= 3 || breadth.limitDown >= 20 ? "warning" : "neutral",
    },
    {
      label: "涨跌停",
      value: `涨停近似 ${breadth.limitUp} / 跌停近似 ${breadth.limitDown}`,
      tone: breadth.limitUp > breadth.limitDown * 2 ? "positive" : breadth.limitDown > breadth.limitUp ? "warning" : "neutral",
    },
  ];
  if (topSector && bottomSector) {
    facts.push({
      label: "板块",
      value: `${topSector.name} ${percent(topSector.changePercent)} / ${bottomSector.name} ${percent(bottomSector.changePercent)}`,
      tone: "neutral",
    });
  }
  if (Number.isFinite(averageDrawdown)) {
    facts.push({ label: "长期位置", value: `宽基平均距各自可用历史高点 ${percent(averageDrawdown)}`, tone: averageDrawdown <= -15 ? "warning" : "neutral" });
  }
  facts.push({
    label: "新闻热点",
    value: selectedSectors.length === 0
      ? "行业板块不可用，无法关联"
      : news.length
        ? `${linkedSectors}/${selectedSectors.length} 个强弱板块有 24h 匹配`
        : "新闻源本次不可用",
    tone: news.length && selectedSectors.length ? "neutral" : "warning",
  });

  const indexItems = trends.map((trend) => ({
    symbol: trend.displaySymbol,
    name: trend.name,
    title: `${trend.regimeLabel} · 当日 ${percent(trend.changePercent)}`,
    detail: `点位 ${round(trend.close, 2).toLocaleString("zh-CN")}；MA20 ${round(trend.ma20, 2)} / MA60 ${round(trend.ma60, 2)} / MA120 ${round(trend.ma120, 2)}；20/60/120 日 ${percent(trend.return20)} / ${percent(trend.return60)} / ${percent(trend.return120)}。`,
    risk: `距近 ${trend.highLookback} 个交易日高点 ${percent(trend.drawdown250)}；${provisional ? "今日为未完成盘中 bar" : `日线截至 ${trend.lastBarDate}`}。`,
  }));
  const sectorItems = selectedSectors.map((sector, index) => {
    const matches = sectorNews.get(sector.id)?.matches ?? [];
    const isLeader = index < Math.min(3, validIndustries.length);
    const headline = matches[0]?.title;
    return {
      symbol: "",
      name: sector.name,
      title: `${isLeader ? "领涨" : "居后"}板块 · ${percent(sector.changePercent)}`,
      detail: `行业成分 ${sector.count} 只，成交额 ${formatAmount(sector.amount)}${sector.leaderName ? `；领涨股 ${sector.leaderName} ${percent(sector.leaderChangePercent)}` : ""}${headline ? `；24h 新闻匹配 ${matches.length} 条：${headline}` : "；24h 未匹配到同板块关键词新闻"}。`,
      risk: headline
        ? "新闻标题仅是时间上接近的催化线索，未证明板块涨跌由其导致，也未判断利好或利空。"
        : "单日板块强弱没有新闻解释时，不应自行补写因果；行业分类和成分也可能调整。",
    };
  });
  const risks = [provisional
    ? "当前为盘中累计快照，价格、成交额、涨跌家数与行业排名会继续变化；15:10 后应重新生成。"
    : previousClose
      ? `当前运行日没有取得新交易日快照，沿用 ${marketDate} 最近收盘；需核验是否休市或数据源延迟。`
      : "收盘快照仍是单日截面；长期趋势来自宽基指数历史，不代表每只成分股趋势。"];
  if (!news.length || sourceStatus.news === false) risks.push("多源财经资讯本次均不可用或无合格记录，页面没有把缺新闻解释为没有催化。");
  else if (selectedSectors.length === 0) risks.push("新闻源本次可用，但行业板块不可用，报告没有把新闻标题强行关联到板块。");
  else risks.push("新闻热点使用近 24 小时关键词匹配，只展示标题关联；同词出现不证明事件、行业与价格之间存在因果关系。");
  if (sourceStatus.industries === false || validIndustries.length === 0) risks.push("新浪行业板块源本次不可用，报告未展示或估算领涨、居后板块。");
  else risks.push("新浪行业板块是第三方行业分类的成分平均涨跌快照，不是交易所行业指数，也不是资金流向指标。");
  if (sourceStatus.indexQuotes === false) risks.push("主要指数实时行情本次不可用，报告未估算宽基趋势与长期位置。");
  if (trends.length < MARKET_PULSE_INDEXES.length) risks.push(`仅 ${trends.length}/${MARKET_PULSE_INDEXES.length} 个宽基具有合格历史，缺失指数没有被估算。`);
  risks.push("涨跌停家数按股票名称与主板/创业板/科创板常见阈值近似计算，未逐只核验上市首日、停牌复牌或特殊交易限制。");
  risks.push("未接入 point-in-time 行业成分，当前板块排序不能用于无偏历史回测。");

  return {
    schemaVersion: 1,
    kind: "market-overview",
    title: `${marketDate} A 股市场脉搏${provisional ? "（盘中）" : previousClose ? "（最近收盘）" : ""}`,
    subject: "A股大盘",
    marketDate,
    asOf,
    generatedAt,
    status,
    environment,
    summary: summaryParts.join(""),
    facts: facts.slice(0, 8),
    items: [...indexItems, ...sectorItems].slice(0, 10),
    risks: risks.slice(0, 6),
    sources: reportSources({
      asOf,
      hasIndexQuotes: quoteMap.size > 0 && sourceStatus.indexQuotes !== false,
      hasIndustry: validIndustries.length > 0,
      news: sourceStatus.news === false ? [] : news,
      trends,
    }),
  };
}
import { buildMarketEnvironment } from "./market-environment.mjs";
