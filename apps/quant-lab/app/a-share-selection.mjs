import { calculateMarketBreadth, associateSectorNews } from "./market-pulse.mjs";
import { analyzeStockHistory } from "./stock-screener.mjs";
import {
  A_SHARE_STRATEGY_SPECS,
  aShareAssetType,
  buildFactorDiagnostics,
  buildPredictionLedger,
  calibrateStrategyHistories,
  compareStrategyEvidence,
  matchStrategySetups,
} from "./a-share-strategy-lab.mjs";
import { buildMarketEnvironment, buildMarketMainlines } from "./market-environment.mjs";
import { abnormalBenchmarkFor, calculateAbnormalDeviation } from "./a-share-abnormal-deviation.mjs";
import { SELECTION_SCAN_LIMITS } from "./selection-scan-contract.mjs";

export const A_SHARE_SELECTION_SCHEMA_VERSION = 1;

const MAX_SECTORS = SELECTION_SCAN_LIMITS.sectors;
const MAX_WATCHED_SECTORS = SELECTION_SCAN_LIMITS.watchedSectors;
const MAX_DIAGNOSTIC_STOCKS = 120;
const MAX_CANDIDATES_PER_SECTOR = 2;
const MAX_REPRESENTATIVES_PER_SECTOR = 3;
const MAX_TIMING_QUEUE_PER_SECTOR = 3;
const MAX_WATCH_STOCKS = 20;
const TECHNOLOGY_HOTSPOT_WINDOW_HOURS = 48;
const MAX_TECHNOLOGY_HOTSPOTS = 4;
const MAX_TECHNOLOGY_SECTORS = 3;
const MAX_TECHNOLOGY_STOCKS = 5;

const TECHNOLOGY_TOPICS = Object.freeze([
  Object.freeze({
    id: "ai-compute",
    label: "AI 与算力",
    keywords: Object.freeze(["人工智能", "大模型", "生成式AI", "AI芯片", "算力", "GPU", "服务器", "数据中心", "光模块", "液冷"]),
    sectors: Object.freeze(["人工智能", "软件", "互联网", "计算机", "通信", "光通信", "电子", "服务器", "数据中心"]),
  }),
  Object.freeze({
    id: "semiconductor",
    label: "半导体",
    keywords: Object.freeze(["半导体", "芯片", "集成电路", "光刻", "存储", "封测", "晶圆", "EDA"]),
    sectors: Object.freeze(["半导体", "集成电路", "电子元件", "电子器件", "电子"]),
  }),
  Object.freeze({
    id: "robotics",
    label: "机器人与智能制造",
    keywords: Object.freeze(["人形机器人", "机器人", "工业自动化", "机器视觉", "减速器", "智能制造", "数控机床"]),
    sectors: Object.freeze(["机器人", "自动化", "机械设备", "专用设备", "通用设备", "仪器仪表"]),
  }),
  Object.freeze({
    id: "space-low-altitude",
    label: "商业航天与低空经济",
    keywords: Object.freeze(["商业航天", "卫星互联网", "卫星", "低空经济", "无人机", "eVTOL", "飞行汽车"]),
    sectors: Object.freeze(["航空航天", "航天航空", "卫星", "军工", "无人机", "通信设备"]),
  }),
  Object.freeze({
    id: "smart-devices",
    label: "智能终端",
    keywords: Object.freeze(["AI手机", "消费电子", "智能眼镜", "折叠屏", "鸿蒙", "XR", "AR眼镜", "苹果产业链"]),
    sectors: Object.freeze(["消费电子", "电子元件", "电子器件", "通信设备", "软件"]),
  }),
  Object.freeze({
    id: "energy-tech",
    label: "新能源技术",
    keywords: Object.freeze(["固态电池", "储能", "钙钛矿", "氢能", "充电桩", "动力电池", "光伏技术"]),
    sectors: Object.freeze(["电力设备", "电池", "光伏", "新能源", "储能", "化学制品"]),
  }),
]);

function finiteNumber(value) {
  if (value == null || typeof value === "boolean" || (typeof value === "string" && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function cleanText(value, maximum = 240) {
  return String(value ?? "")
    .replace(/<[^>]*>/gu, " ")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const instant = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
}

function validInstant(value) {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function mean(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentileRanks(rows, getter, keyGetter = (row) => row.id ?? row.symbol) {
  const sorted = rows
    .map((row) => ({ row, key: keyGetter(row), value: getter(row) }))
    .filter((item) => item.key && Number.isFinite(item.value))
    .sort((left, right) => left.value - right.value || left.key.localeCompare(right.key));
  const ranks = new Map();
  if (sorted.length === 1) {
    ranks.set(sorted[0].key, 50);
    return ranks;
  }
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value) end += 1;
    const rank = (((start + end - 1) / 2) / Math.max(1, sorted.length - 1)) * 100;
    for (let index = start; index < end; index += 1) ranks.set(sorted[index].key, rank);
    start = end;
  }
  return ranks;
}

function percent(value, digits = 1) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatAmount(value) {
  if (!Number.isFinite(value)) return "—";
  return `${round(value / 100_000_000, 1).toLocaleString("zh-CN")} 亿`;
}

function technologyTopicMatches(newsInput, generatedAt, windowHours = TECHNOLOGY_HOTSPOT_WINDOW_HOURS) {
  const cutoff = Date.parse(generatedAt) - windowHours * 60 * 60 * 1_000;
  return TECHNOLOGY_TOPICS.map((topic) => {
    const news = (Array.isArray(newsInput) ? newsInput : []).flatMap((item) => {
      const publishedAt = Date.parse(item?.publishedAt);
      if (!Number.isFinite(publishedAt) || publishedAt < cutoff || publishedAt > Date.parse(generatedAt) + 60 * 60 * 1_000) return [];
      const text = cleanText(`${item?.title ?? ""} ${item?.summary ?? ""}`, 600).toLowerCase();
      const matchedKeywords = topic.keywords.filter((keyword) => text.includes(keyword.toLowerCase()));
      return matchedKeywords.length ? [{ item, matchedKeywords }] : [];
    }).sort((left, right) => Date.parse(right.item.publishedAt) - Date.parse(left.item.publishedAt));
    const matchedKeywords = [...new Set(news.flatMap((item) => item.matchedKeywords))];
    return { topic, news, matchedKeywords };
  }).filter((item) => item.news.length > 0);
}

function topicMatchesIndustry(topic, industry) {
  const name = cleanText(industry?.name, 40).toLowerCase();
  return Boolean(name && topic.sectors.some((keyword) => name.includes(keyword.toLowerCase())));
}

export function selectTechnologyIndustryPool(industriesInput, newsInput, generatedAt, limit = MAX_TECHNOLOGY_SECTORS) {
  const industries = (Array.isArray(industriesInput) ? industriesInput : [])
    .filter((item) => /^new_[A-Za-z0-9]+$/u.test(item?.id) && item?.name && Number.isFinite(item.changePercent));
  const topicMatches = technologyTopicMatches(newsInput, generatedAt);
  if (!industries.length || !topicMatches.length) return Object.freeze([]);
  const amountRanks = percentileRanks(industries, (item) => Math.log10(Math.max(1, item.amount)));
  const rows = industries.flatMap((industry) => {
    const topics = topicMatches.filter(({ topic }) => topicMatchesIndustry(topic, industry));
    if (!topics.length) return [];
    const newsCount = new Set(topics.flatMap((item) => item.news.map(({ item }) => item.id))).size;
    return [{
      ...industry,
      technologyTopicIds: topics.map(({ topic }) => topic.id),
      technologyDiscoveryScore: round(
        Math.min(100, newsCount * 30) * 0.65 +
        (amountRanks.get(industry.id) ?? 0) * 0.25 +
        clamp(50 + industry.changePercent * 5, 0, 100) * 0.1,
        2,
      ),
    }];
  }).sort((left, right) =>
    right.technologyDiscoveryScore - left.technologyDiscoveryScore ||
    right.amount - left.amount ||
    left.id.localeCompare(right.id),
  );
  return Object.freeze(rows.slice(0, clamp(Number(limit) || MAX_TECHNOLOGY_SECTORS, 1, MAX_TECHNOLOGY_SECTORS)).map((item) => Object.freeze(item)));
}

function marketRegime(breadth) {
  if (breadth.netBreadth <= -0.22 && breadth.limitDown >= Math.max(8, breadth.limitUp * 1.2)) {
    return {
      state: "retreat",
      label: "退潮",
      reason: `市场净宽度 ${percent(breadth.netBreadth * 100)}，跌停近似 ${breadth.limitDown} 家；允许今日没有推荐。`,
      candidateLimit: 0,
    };
  }
  if (breadth.netBreadth <= -0.08) {
    return {
      state: "weak",
      label: "弱势",
      reason: `下跌家数占优，市场净宽度 ${percent(breadth.netBreadth * 100)}；只保留证据最完整的方向。`,
      candidateLimit: 1,
    };
  }
  if (breadth.netBreadth >= 0.18) {
    return {
      state: "strong",
      label: "强势",
      reason: `上涨覆盖较广，市场净宽度 ${percent(breadth.netBreadth * 100)}；仍需执行追高和拥挤过滤。`,
      candidateLimit: 3,
    };
  }
  return {
    state: "rotation",
    label: "轮动",
    reason: `上涨 ${breadth.up} 家、下跌 ${breadth.down} 家；优先选择有持续性而非单日冲高的板块。`,
    candidateLimit: 3,
  };
}

function normalizeWatch(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const sectors = [];
  const seenSectors = new Set();
  for (const item of Array.isArray(source.sectors) ? source.sectors : []) {
    const id = cleanText(item?.id, 50);
    const name = cleanText(item?.name, 40);
    if (!/^new_[A-Za-z0-9]+$/u.test(id) || !name || seenSectors.has(id)) continue;
    seenSectors.add(id);
    sectors.push({ id, name });
    if (sectors.length >= MAX_WATCHED_SECTORS) break;
  }
  const stocks = [];
  const seenStocks = new Set();
  for (const item of Array.isArray(source.stocks) ? source.stocks : []) {
    const symbol = cleanText(item?.symbol, 16).toUpperCase();
    const name = cleanText(item?.name, 40);
    if (!/^(?:SH|SZ)\d{6}$/u.test(symbol) || seenStocks.has(symbol)) continue;
    seenStocks.add(symbol);
    stocks.push({ symbol, name });
    if (stocks.length >= MAX_WATCH_STOCKS) break;
  }
  return Object.freeze({ sectors: Object.freeze(sectors), stocks: Object.freeze(stocks) });
}

function newsEvent(item, label = "行业新闻") {
  return {
    id: cleanText(item?.id, 100),
    kind: "news",
    label,
    title: cleanText(item?.title, 240),
    publishedAt: item?.publishedAt,
    url: item?.url,
    importance: "context",
  };
}

export function classifyAnnouncement(titleInput) {
  const title = cleanText(titleInput, 240);
  if (/立案|处罚|警示|风险|亏损|减持|质押|诉讼|终止|退市|异常|冻结|违约/u.test(title)) {
    return Object.freeze({ importance: "risk", label: "风险披露" });
  }
  if (/业绩|订单|中标|回购|增持|分红|重大合同|并购|重组|投资|产能/u.test(title)) {
    return Object.freeze({ importance: "operating", label: "经营事件" });
  }
  return Object.freeze({ importance: "routine", label: "公司公告" });
}

export function parseEastmoneyAnnouncements(payload, symbolInput, fetchedAtInput) {
  const symbol = cleanText(symbolInput, 16).toUpperCase();
  const fetchedAt = new Date(fetchedAtInput);
  if (!/^(?:SH|SZ)\d{6}$/u.test(symbol) || !Number.isFinite(fetchedAt.getTime())) {
    throw new Error("announcement parser requires a valid A-share symbol and fetchedAt");
  }
  const rows = payload?.data?.list;
  if (!Array.isArray(rows)) throw new Error("announcement payload has no list");
  const seen = new Set();
  return rows.flatMap((row) => {
    const id = cleanText(row?.art_code, 80);
    const title = cleanText(row?.title_ch ?? row?.title, 240);
    const rawDate = cleanText(row?.notice_date ?? row?.display_time, 32).slice(0, 19);
    const sourceDate = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(rawDate)
      ? `${rawDate.replace(" ", "T")}+08:00`
      : /^\d{4}-\d{2}-\d{2}$/u.test(rawDate)
        ? `${rawDate}T00:00:00+08:00`
        : "";
    const publishedAt = Number.isFinite(Date.parse(sourceDate)) ? new Date(sourceDate).toISOString() : "";
    const code = symbol.slice(2);
    if (!id || !title || !publishedAt || seen.has(id)) return [];
    if (Date.parse(publishedAt) > fetchedAt.getTime() + 36 * 60 * 60 * 1_000) return [];
    seen.add(id);
    const classification = classifyAnnouncement(title);
    return [{
      id,
      kind: "announcement",
      label: classification.label,
      title,
      publishedAt,
      url: `https://data.eastmoney.com/notices/detail/${code}/${encodeURIComponent(id)}.html`,
      importance: classification.importance,
    }];
  }).slice(0, 8);
}

export function selectIndustryResearchPool(industriesInput, newsInput, generatedAt, watchInput = {}, limit = 6) {
  const industries = (Array.isArray(industriesInput) ? industriesInput : [])
    .filter((item) => /^new_[A-Za-z0-9]+$/u.test(item?.id) && item?.name && Number.isFinite(item.changePercent));
  const watch = normalizeWatch(watchInput);
  if (industries.length === 0) return Object.freeze([]);
  const newsMap = associateSectorNews(industries, newsInput, generatedAt, 36);
  const changeRanks = percentileRanks(industries, (item) => item.changePercent);
  const amountRanks = percentileRanks(industries, (item) => Math.log10(Math.max(1, item.amount)));
  const scored = industries.map((industry) => ({
    ...industry,
    discoveryScore: round(
      (changeRanks.get(industry.id) ?? 0) * 0.55 +
        (amountRanks.get(industry.id) ?? 0) * 0.3 +
        Math.min(100, (newsMap.get(industry.id)?.matches.length ?? 0) * 25) * 0.15,
      2,
    ),
  })).sort((left, right) => right.discoveryScore - left.discoveryScore || left.id.localeCompare(right.id));
  const picked = scored.slice(0, clamp(Number(limit) || 6, 3, 10));
  for (const watched of watch.sectors) {
    const match = industries.find((item) => item.id === watched.id);
    if (match && !picked.some((item) => item.id === match.id)) picked.push({ ...match, discoveryScore: null });
  }
  return Object.freeze(picked.slice(0, MAX_WATCHED_SECTORS).map((item) => Object.freeze(item)));
}

function stockTiming(row, environment = null) {
  if (!row) {
    return {
      state: "unavailable",
      label: "数据不足",
      setup: {
        id: "data-unavailable",
        label: "数据不足",
        status: "blocked",
        trigger: "取得至少 61 个有效交易日及当前行情后重新判断",
      },
      pending: ["缺少足够的复权历史或当前行情"],
    };
  }
  if (row.historyAgeCalendarDays !== 0) {
    return {
      state: "unavailable",
      label: "等待最新日线",
      setup: {
        id: "history-stale",
        label: "等待日线更新",
        status: "blocked",
        trigger: "取得与当前行情交易日一致的日线后重新判断",
      },
      pending: [`日线仅更新至 ${row.lastBarDate}，不能用旧形态确认当前时机`],
    };
  }
  const setupOptions = {
    board: row.board,
    relativeScore: row.relativeScore ?? 50,
    assetType: aShareAssetType(row.symbol),
  };
  const setupMatches = matchStrategySetups(row, {
    ...setupOptions,
    environmentState: environment?.state ?? null,
    phaseState: environment?.phase?.state ?? null,
  });
  const rawSetupMatches = environment ? matchStrategySetups(row, setupOptions) : setupMatches;
  const environmentBlocked = rawSetupMatches.some((item) => item.status === "confirmed") &&
    !setupMatches.some((item) => item.status === "confirmed");
  const chaseThreshold = row.board === "main" ? 5.5 : 10;
  const hardBlocks = [];
  if (row.close <= row.ma60) hardBlocks.push(`收盘需重新站上 MA60 ${round(row.ma60)}`);
  if (row.ma20 <= row.ma60) hardBlocks.push("MA20 尚未站上 MA60");
  if (row.return60 < 3) hardBlocks.push(`60 日收益 ${percent(row.return60)}，长期趋势不足`);
  if (row.return20 <= -8) hardBlocks.push(`20 日收益 ${percent(row.return20)}，短期趋势明显转弱`);
  if (row.changePercent <= -5) hardBlocks.push(`当日下跌 ${percent(row.changePercent)}，需先观察止跌`);
  if (hardBlocks.length) {
    const reversalWatch = setupMatches.find((item) => {
      const spec = A_SHARE_STRATEGY_SPECS.find((candidate) => candidate.id === item.id);
      return item.status === "watch" && spec?.category === "reversal";
    });
    if (reversalWatch) {
      const spec = A_SHARE_STRATEGY_SPECS.find((item) => item.id === reversalWatch.id);
      return {
        state: "waiting",
        label: "反转观察",
        setup: {
          id: reversalWatch.id,
          label: spec?.label ?? "反转观察",
          status: "waiting",
          trigger: `${spec?.description ?? "短期止跌信号出现"} 仍需等待趋势修复确认。`,
        },
        pending: hardBlocks.slice(0, 3),
      };
    }
    return {
      state: "risk",
      label: "趋势未通过",
      setup: {
        id: "trend-repair",
        label: "趋势修复",
        status: "blocked",
        trigger: `先恢复价格 > MA20 > MA60，并保持 60 日收益不低于 +3.0%`,
      },
      pending: hardBlocks.slice(0, 3),
    };
  }

  const confirmedSetup = setupMatches.find((item) => item.status === "confirmed");
  const watchSetup = setupMatches.find((item) => item.status === "watch");
  const patternBlocksConfirmation = row.patternEvidence?.available && (
    row.patternEvidence.jValue >= 80 ||
    row.patternEvidence.status === "risk" ||
    row.patternEvidence.risks.some((item) => item.includes("最大成交量出现在阴线"))
  );
  if (
    confirmedSetup && !patternBlocksConfirmation && row.turnover <= 12 &&
    row.changePercent < chaseThreshold && row.extension20 <= 10 &&
    !(row.pe != null && row.pe <= 0) && !(row.pb != null && row.pb > 15)
  ) {
    const spec = A_SHARE_STRATEGY_SPECS.find((item) => item.id === confirmedSetup.id);
    return {
      state: "opportunity",
      label: "时机确认",
      setup: {
        id: confirmedSetup.id,
        label: spec?.label ?? "具名策略",
        status: "confirmed",
        trigger: spec?.description ?? "趋势、位置、量能与追高过滤同时通过",
      },
      pending: [],
    };
  }

  const breakoutCeiling = row.board === "main" ? 5.5 : 10;
  const breakoutWatch = row.distancePriorHigh20 >= -5 || row.volumeRatio >= 1.1;
  const watchSpec = watchSetup && A_SHARE_STRATEGY_SPECS.find((item) => item.id === watchSetup.id);
  const setup = environmentBlocked
    ? {
      id: "market-environment",
      label: "等待市场条件",
      status: "waiting",
      trigger: `个股技术形态已出现，但当前市场为${environment?.label ?? environment?.state ?? "未知"}${environment?.phase?.state && environment.phase.state !== "unavailable" ? `、阶段为${environment.phase.label ?? environment.phase.state}` : ""}，尚未通过该形态适用的市场条件`,
    }
    : watchSpec
    ? {
      id: watchSpec.id,
      label: `等待${watchSpec.label}`,
      status: "waiting",
      trigger: watchSpec.description,
    }
    : breakoutWatch
    ? {
      id: "volume-breakout",
      label: "等待放量突破",
      status: "waiting",
      trigger: `收盘距 60 日高点不低于 -2.5%，量比不低于 1.20，涨幅在 +0.5% 至 ${breakoutCeiling.toFixed(1)}% 之间`,
    }
    : {
      id: "trend-pullback",
      label: "等待趋势回踩",
      status: "waiting",
      trigger: `收盘保持 MA20 上方、距离 MA20 为 0–5%，量比不低于 0.80，且不追高`,
    };
  const pending = [];
  if (environmentBlocked) pending.push(setup.trigger);
  if (row.patternEvidence?.available && row.patternEvidence.jValue >= 80) {
    pending.push(`KDJ J 值 ${round(row.patternEvidence.jValue, 1)} 处于高位，等待回到 80 以下再确认`);
  }
  if (row.patternEvidence?.risks.some((item) => item.includes("最大成交量出现在阴线"))) {
    pending.push("近 20 日最大成交量为阴线，等待量价风险释放或得到公告事实解释");
  }
  if (row.patternEvidence?.status === "risk") {
    pending.push(`四维形态风险偏高：${row.patternEvidence.risks[0] ?? "等待趋势、量能与价格位置重新改善"}`);
  }
  if (row.close < row.ma20) pending.push(`收盘重新站上 MA20 ${round(row.ma20)}`);
  if (row.return20 <= 0) pending.push(`20 日收益需由 ${percent(row.return20)} 转正`);
  if (row.changePercent >= chaseThreshold) pending.push(`当日已涨 ${percent(row.changePercent)}，等待追高风险释放`);
  if (row.extension20 > (breakoutWatch ? 8 : 5)) pending.push(`距离 MA20 ${percent(row.extension20)}，等待回到观察区`);
  if (row.volumeRatio < (breakoutWatch ? 1.2 : 0.8)) pending.push(`量比 ${round(row.volumeRatio, 2)}，等待量能确认`);
  if (breakoutWatch && row.distanceHigh60 < -2.5) pending.push(`距 60 日高点 ${percent(row.distanceHigh60)}，尚未形成突破`);
  if (row.turnover > 12) pending.push(`换手 ${percent(row.turnover)}，等待拥挤度下降`);
  if (row.pe != null && row.pe <= 0) pending.push("市盈率非正，等待盈利质量核验");
  if (row.pb != null && row.pb > 15) pending.push(`市净率 ${round(row.pb, 2)}，等待估值风险核验`);
  if (pending.length === 0) pending.push("条件接近但未形成完整收盘组合，等待下一交易日重新核验");
  return { state: "waiting", label: "等待买点", setup, pending: pending.slice(0, 3) };
}

function stockRisks(row, timing = stockTiming(row)) {
  const risks = [...timing.pending];
  const chaseThreshold = row.board === "main" ? 7.5 : 15;
  if (row.changePercent >= chaseThreshold) risks.push(`当日已涨 ${percent(row.changePercent)}，触发追高过滤`);
  if (row.extension20 > 12) risks.push(`高于 MA20 ${percent(row.extension20)}，偏离较大`);
  if (row.volumeRatio < 0.8) risks.push(`量比 ${round(row.volumeRatio, 2)}，尚未确认`);
  if (row.turnover > 12) risks.push(`换手 ${percent(row.turnover)}，拥挤度偏高`);
  if (row.pe != null && row.pe <= 0) risks.push("市盈率非正，需核验盈利质量");
  if (row.pb != null && row.pb > 10) risks.push(`市净率 ${round(row.pb, 2)}，估值敏感`);
  for (const risk of row.patternEvidence?.risks ?? []) risks.push(risk);
  if (risks.length === 0) risks.push("仍需核验公告、估值与行业反方证据");
  return [...new Set(risks)].slice(0, 3);
}

function stockSupport(row, rank, total) {
  const support = [
    `板块高流动性样本中综合排名 ${rank}/${total}`,
    ...(row.patternEvidence?.available
      ? [`四维形态证据 ${round(row.patternEvidence.score, 1)}/100 · ${row.patternEvidence.label}（不是上涨概率）`]
      : []),
    `20 / 60 日收益 ${percent(row.return20)} / ${percent(row.return60)}`,
    `成交额 ${formatAmount(row.amount)} · 量比 ${round(row.volumeRatio, 2)}`,
  ];
  if (row.close > row.ma20 && row.ma20 > row.ma60) support.push("价格 > MA20 > MA60");
  return support.slice(0, 4);
}

function stockScoreRows(rows) {
  const ranks = {
    return20: percentileRanks(rows, (row) => row.return20, (row) => row.symbol),
    return60: percentileRanks(rows, (row) => row.return60, (row) => row.symbol),
    volume: percentileRanks(rows, (row) => clamp(row.volumeRatio, 0, 4), (row) => row.symbol),
    liquidity: percentileRanks(rows, (row) => Math.log10(Math.max(1, row.amount)), (row) => row.symbol),
    nearHigh: percentileRanks(rows, (row) => row.distanceHigh60, (row) => row.symbol),
  };
  return rows.map((row) => {
    const penalty = (row.extension20 > 12 ? 8 : 0) + (row.changePercent >= (row.board === "main" ? 7.5 : 15) ? 15 : 0);
    const score =
      (ranks.return20.get(row.symbol) ?? 0) * 0.22 +
      (ranks.return60.get(row.symbol) ?? 0) * 0.22 +
      (ranks.volume.get(row.symbol) ?? 0) * 0.12 +
      (ranks.liquidity.get(row.symbol) ?? 0) * 0.18 +
      (ranks.nearHigh.get(row.symbol) ?? 0) * 0.11 +
      (row.patternEvidence?.available ? row.patternEvidence.score : 50) * 0.15 - penalty;
    return { ...row, relativeScore: round(clamp(score, 0, 100), 1) };
  }).sort((left, right) => right.relativeScore - left.relativeScore || left.symbol.localeCompare(right.symbol));
}

function exactStockNews(row, newsInput) {
  const code = row.symbol.slice(2);
  return (Array.isArray(newsInput) ? newsInput : [])
    .filter((item) => `${item?.title ?? ""} ${item?.summary ?? ""}`.includes(row.name) || `${item?.title ?? ""}`.includes(code))
    .map((item) => newsEvent(item, "个股新闻"));
}

function mergedEvents(announcements, stockNews) {
  const events = [...(announcements ?? []), ...(stockNews ?? [])]
    .filter((item) => item?.title && validInstant(item?.publishedAt) && /^https:\/\//u.test(item?.url ?? ""))
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt) || left.id.localeCompare(right.id));
  const seen = new Set();
  return events.filter((item) => {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}

function sectorStage(metrics, industry) {
  if (metrics.sampleSize < 3) return { stage: "unavailable", label: "样本不足" };
  if (industry.changePercent >= 5 || metrics.extension20Median >= 12) return { stage: "crowded", label: "拥挤" };
  if (metrics.above20Ratio < 0.35 && metrics.return20Median < 0) return { stage: "retreat", label: "退潮" };
  if (metrics.trendRatio >= 0.65 && metrics.return20Median >= 3) return { stage: "advancing", label: "主升" };
  if (metrics.above20Ratio >= 0.6 && metrics.return20Median > 0) return { stage: "expansion", label: "扩散" };
  if (metrics.return20Median > 0) return { stage: "emerging", label: "萌芽" };
  return { stage: "repair", label: "修复" };
}

function sectorMetrics(industry, analyzedRows) {
  const rows = analyzedRows.filter(Boolean);
  const limitRows = rows.filter((row) => row.limitUpToday === true);
  const touchedRows = rows.filter((row) => row.touchedLimitToday === true);
  const promotionPool = rows.filter((row) => row.previousLimitUpStreak > 0);
  const promoted = rows.filter((row) => row.promotedToday === true);
  const maxBoards = Math.max(0, ...limitRows.map((row) => row.consecutiveLimitUps ?? 0));
  const rungs = new Set(limitRows.map((row) => row.consecutiveLimitUps).filter((value) => value >= 2));
  return {
    sampleSize: rows.length,
    constituentCount: Number.isInteger(industry.count) && industry.count > 0 ? industry.count : null,
    memberCoverage: industry.count > 0 ? round(rows.length / industry.count, 4) : null,
    changePercent: round(industry.changePercent),
    amount: Number.isFinite(industry.amount) ? industry.amount : null,
    return20Median: round(median(rows.map((row) => row.return20))),
    return60Median: round(median(rows.map((row) => row.return60))),
    extension20Median: round(median(rows.map((row) => row.extension20))),
    above20Ratio: rows.length ? round(rows.filter((row) => row.close > row.ma20).length / rows.length, 4) : null,
    trendRatio: rows.length ? round(rows.filter((row) => row.ma20 > row.ma60).length / rows.length, 4) : null,
    limitUpCount: limitRows.length,
    firstBoardCount: limitRows.filter((row) => row.consecutiveLimitUps === 1).length,
    ge2Count: limitRows.filter((row) => row.consecutiveLimitUps >= 2).length,
    maxBoards,
    rungsFilled: rungs.size,
    ladderCompleteness: maxBoards >= 3 ? round(rungs.size / (maxBoards - 1), 4) : 0,
    promotionPool: promotionPool.length,
    promotionRate: promotionPool.length ? round(promoted.length / promotionPool.length, 4) : null,
    sealRate: touchedRows.length ? round(limitRows.length / touchedRows.length, 4) : null,
  };
}

function sectorScoreRows(rows) {
  const return20Ranks = percentileRanks(rows, (row) => row.metrics.return20Median);
  const return60Ranks = percentileRanks(rows, (row) => row.metrics.return60Median);
  const amountRanks = percentileRanks(rows, (row) => Math.log10(Math.max(1, row.metrics.amount)));
  const currentRanks = percentileRanks(rows, (row) => row.metrics.changePercent);
  return rows.map((row) => {
    const crowdingPenalty = row.stage === "crowded" ? 12 : row.stage === "retreat" ? 18 : 0;
    const score =
      (return20Ranks.get(row.id) ?? 0) * 0.25 +
      (return60Ranks.get(row.id) ?? 0) * 0.15 +
      (row.metrics.above20Ratio ?? 0) * 100 * 0.2 +
      (row.metrics.trendRatio ?? 0) * 100 * 0.15 +
      (amountRanks.get(row.id) ?? 0) * 0.1 +
      Math.min(100, row.catalysts.length * 35) * 0.1 +
      (currentRanks.get(row.id) ?? 0) * 0.05 - crowdingPenalty;
    return { ...row, relativeScore: round(clamp(score, 0, 100), 1) };
  }).sort((left, right) => right.relativeScore - left.relativeScore || left.id.localeCompare(right.id));
}

function buildLimitLadder(sectors, analyzedBySector, provisional) {
  const sectorById = new Map(sectors.map((sector) => [sector.id, sector]));
  const rowsBySymbol = new Map();
  for (const [sectorId, rows] of analyzedBySector.entries()) {
    const sector = sectorById.get(sectorId);
    if (!sector) continue;
    for (const row of rows.filter(Boolean)) {
      if (!row.limitUpToday && !row.touchedLimitToday) continue;
      const existing = rowsBySymbol.get(row.symbol);
      if (existing && existing.sector.relativeScore >= sector.relativeScore) continue;
      rowsBySymbol.set(row.symbol, { row, sector });
    }
  }
  const toEntry = ({ row, sector }) => Object.freeze({
    symbol: row.symbol,
    name: row.name,
    sectorId: sector.id,
    sectorName: sector.name,
    boards: row.consecutiveLimitUps ?? 0,
    previousBoards: row.previousLimitUpStreak ?? 0,
    promoted: row.promotedToday === true,
    sealed: row.limitUpToday === true,
    touched: row.touchedLimitToday === true,
    price: round(row.price),
    changePercent: round(row.changePercent),
    amount: row.amount,
  });
  const all = [...rowsBySymbol.values()].map(toEntry);
  const sealed = all
    .filter((item) => item.sealed)
    .sort((left, right) => right.boards - left.boards || right.amount - left.amount || left.symbol.localeCompare(right.symbol));
  const broken = all
    .filter((item) => item.touched && !item.sealed)
    .sort((left, right) => right.previousBoards - left.previousBoards || right.amount - left.amount || left.symbol.localeCompare(right.symbol));
  const tiers = [...new Set(sealed.map((item) => item.boards))]
    .sort((left, right) => right - left)
    .map((boards) => Object.freeze({
      boards,
      label: boards === 1 ? "首板" : `${boards} 连板`,
      // Keep the complete evidence behind the sealed count. The UI may limit
      // visible cards, but dropping members here makes a larger tier fail its
      // exact count check and discards known stocks from the snapshot.
      stocks: Object.freeze(sealed.filter((item) => item.boards === boards)),
    }));
  const promotionPool = all.filter((item) => item.previousBoards > 0).length;
  const promoted = sealed.filter((item) => item.promoted).length;
  return Object.freeze({
    version: 1,
    provisional: provisional === true,
    sampleSize: new Set([...analyzedBySector.values()].flatMap((rows) => rows.filter(Boolean).map((row) => row.symbol))).size,
    sealed: sealed.length,
    broken: broken.length,
    maxBoards: sealed[0]?.boards ?? 0,
    promotionPool,
    promotionRate: promotionPool ? round(promoted / promotionPool, 4) : null,
    tiers: Object.freeze(tiers),
    brokenStocks: Object.freeze(broken.slice(0, 12)),
    disclosure: "只覆盖本轮行业研究取得的高流动性成分样本，不是全市场涨停家数；盘中封板与炸板状态会变化，收盘后重新核验。",
  });
}

function announcementDataTiming(timing, available) {
  if (available || !["opportunity", "waiting"].includes(timing.state)) return timing;
  return {
    state: "waiting",
    label: "等待公告数据",
    setup: {
      id: "announcement-data-pending",
      label: "等待公告数据",
      status: "waiting",
      trigger: "成功取得该股票的近期公告后重新核验，未取得公告不能视为没有风险公告",
    },
    pending: ["该股票公告数据尚未成功取得，公告风险核验未完成", ...timing.pending].slice(0, 3),
  };
}

function buildCandidate(
  row,
  sector,
  rank,
  total,
  announcements,
  news,
  provisional = false,
  { respectSectorGate = false, eventBlocked = false, timingResult = null, environment = null } = {},
) {
  const stockTimingResult = announcementDataTiming(
    timingResult ?? stockTiming(row, environment),
    announcements.has(row.symbol),
  );
  const sectorGateOpen = sector.scan?.state === "complete" && ["advancing", "expansion"].includes(sector.stage);
  let timing = (respectSectorGate || sector.scan?.state !== "complete") && stockTimingResult.state === "opportunity" && !sectorGateOpen
    ? {
      state: "waiting",
      label: "等待板块确认",
      setup: {
        id: "sector-confirmation",
        label: sector.scan?.state === "complete" ? "等待板块扩散" : "等待板块数据",
        status: "waiting",
        trigger: sector.scan?.state === "complete"
          ? `所属板块当前为${sector.stageLabel}，等待进入扩散或主升后再核验个股时机`
          : "所属板块的成分与历史尚未完整取得，等待板块数据完成后重新核验个股时机",
      },
      pending: [sector.scan?.state === "complete"
        ? `所属板块当前为${sector.stageLabel}，板块闸门尚未打开`
        : "所属板块数据尚未完整，当前仅保留个股观察"],
    }
    : stockTimingResult;
  if (respectSectorGate && eventBlocked && stockTimingResult.state !== "risk") {
    timing = {
      state: "waiting",
      label: "等待公告核验",
      setup: {
        id: "announcement-risk-review",
        label: "公告风险核验",
        status: "waiting",
        trigger: "近期存在减持、监管、诉讼、业绩预警或其他风险公告，完成事实核验前不进入确认区",
      },
      pending: ["近期风险公告尚未完成影响核验"],
    };
  }
  const setup = provisional && timing.state === "opportunity"
    ? { ...timing.setup, status: "intraday", label: `${timing.setup.label} · 待收盘` }
    : timing.setup;
  return {
    symbol: row.symbol,
    name: row.name,
    sectorId: sector.id,
    sectorName: sector.name,
    rank,
    relativeScore: row.relativeScore,
    state: timing.state,
    stateLabel: provisional && timing.state === "opportunity" ? "盘中触发" : timing.label,
    setup,
    price: round(row.price),
    changePercent: round(row.changePercent),
    amount: row.amount,
    turnover: round(row.turnover),
    pe: round(row.pe),
    pb: round(row.pb),
    lastBarDate: row.lastBarDate,
    metrics: {
      ma20: round(row.ma20),
      ma60: round(row.ma60),
      return20: round(row.return20),
      return60: round(row.return60),
      volumeRatio: round(row.volumeRatio),
      distanceHigh60: round(row.distanceHigh60),
      extension20: round(row.extension20),
      distancePriorHigh20: round(row.distancePriorHigh20),
      distancePriorHigh60: round(row.distancePriorHigh60),
      range10: round(row.range10),
      recentLow5Distance20: round(row.recentLow5Distance20),
      volume3Ratio20: round(row.volume3Ratio20),
    },
    patternEvidence: row.patternEvidence,
    abnormalDeviation: row.abnormalDeviation,
    support: stockSupport(row, rank, total),
    risks: stockRisks(row, timing),
    invalidation: `收盘跌破 MA60 ${round(row.ma60)}，或连续弱于所属板块时重新核验`,
    events: mergedEvents(announcements.get(row.symbol), exactStockNews(row, news)),
  };
}

function buildWatchStock(quote, history, input) {
  const analyzed = quote && history
    ? analyzeStockHistory(quote, history, { marketDate: input.marketDate, provisional: input.provisional === true })
    : null;
  const row = analyzed ? {
    ...analyzed,
    abnormalDeviation: calculateAbnormalDeviation({
      symbol: analyzed.symbol,
      board: analyzed.board,
      stockBars: history,
      benchmarkBars: input.benchmarkHistories.get(abnormalBenchmarkFor(analyzed.symbol, analyzed.board)),
    }),
  } : null;
  if (!row) {
    return {
      symbol: input.symbol,
      name: input.name || quote?.name || input.symbol,
      state: "unavailable",
      stateLabel: "数据不足",
      reason: "当前快照没有取得足够的复权历史，未生成时机判断。",
      events: quote ? mergedEvents(input.announcements.get(input.symbol), exactStockNews(quote, input.news)) : [],
    };
  }
  const timing = announcementDataTiming(stockTiming(row, input.environment), input.announcements.has(row.symbol));
  const reason = timing.state === "opportunity"
    ? `${timing.setup.label}已触发：${timing.setup.trigger}。仍需核验公告与基本面反方证据。`
    : timing.state === "risk"
      ? `趋势条件未通过：${timing.pending.join("；")}。`
      : `${timing.setup.label}：${timing.pending.join("；")}。`;
  return {
    symbol: row.symbol,
    name: input.name || row.name,
    state: timing.state,
    stateLabel: input.provisional && timing.state === "opportunity" ? "盘中触发" : timing.label,
    setup: input.provisional && timing.state === "opportunity"
      ? { ...timing.setup, status: "intraday", label: `${timing.setup.label} · 待收盘` }
      : timing.setup,
    reason,
    price: round(row.price),
    changePercent: round(row.changePercent),
    metrics: {
      ma20: round(row.ma20),
      ma60: round(row.ma60),
      return20: round(row.return20),
      return60: round(row.return60),
      volumeRatio: round(row.volumeRatio),
    },
    patternEvidence: row.patternEvidence,
    abnormalDeviation: row.abnormalDeviation,
    invalidation: `收盘跌破 MA60 ${round(row.ma60)} 或原关注逻辑被公告事实推翻`,
    events: mergedEvents(input.announcements.get(row.symbol), exactStockNews(row, input.news)),
  };
}

export function buildTechnologyHotspots(newsInput, sectorsInput, generatedAt) {
  const topicMatches = technologyTopicMatches(newsInput, generatedAt);
  const sectors = Array.isArray(sectorsInput) ? sectorsInput : [];
  const topics = topicMatches.map(({ topic, news, matchedKeywords }) => {
    const matchedSectors = sectors
      .filter((sector) => topicMatchesIndustry(topic, sector))
      .sort((left, right) => right.relativeScore - left.relativeScore || left.id.localeCompare(right.id))
      .slice(0, MAX_TECHNOLOGY_SECTORS);
    const stocks = [];
    const stockSymbols = new Set();
    for (const sector of matchedSectors) {
      const rows = [...sector.representatives, ...sector.candidates, ...sector.timingQueue]
        .sort((left, right) => right.relativeScore - left.relativeScore || left.symbol.localeCompare(right.symbol));
      for (const candidate of rows) {
        if (stockSymbols.has(candidate.symbol)) continue;
        stockSymbols.add(candidate.symbol);
        stocks.push({
          symbol: candidate.symbol,
          name: candidate.name,
          sectorId: sector.id,
          sectorName: sector.name,
          state: candidate.state,
          stateLabel: candidate.stateLabel,
          price: candidate.price,
          changePercent: candidate.changePercent,
          relativeScore: candidate.relativeScore,
          metrics: {
            return20: candidate.metrics.return20,
            return60: candidate.metrics.return60,
            extension20: candidate.metrics.extension20,
            volumeRatio: candidate.metrics.volumeRatio,
          },
          matchBasis: `属于“${sector.name}”高流动性样本；行业关联不等于公司受益已证实`,
        });
        if (stocks.length >= MAX_TECHNOLOGY_STOCKS) break;
      }
      if (stocks.length >= MAX_TECHNOLOGY_STOCKS) break;
    }
    const latestAt = news[0]?.item?.publishedAt ?? generatedAt;
    const recencyHours = Math.max(0, (Date.parse(generatedAt) - Date.parse(latestAt)) / (60 * 60 * 1_000));
    const heatScore = round(clamp(
      Math.min(60, news.length * 20) + matchedSectors.length * 10 + Math.max(0, 20 - recencyHours / 2),
      0,
      100,
    ), 1);
    return {
      id: topic.id,
      label: topic.label,
      heatScore,
      newsCount: news.length,
      latestAt,
      keywords: matchedKeywords.slice(0, 6),
      news: news.slice(0, 3).map(({ item }) => newsEvent(item, "热点线索")),
      sectors: matchedSectors.map((sector) => ({
        id: sector.id,
        name: sector.name,
        stage: sector.stage,
        stageLabel: sector.stageLabel,
        changePercent: sector.metrics.changePercent,
        return20Median: sector.metrics.return20Median,
        matchBasis: `科技主题词与行业名称“${sector.name}”匹配`,
      })),
      stocks,
    };
  }).sort((left, right) =>
    right.heatScore - left.heatScore ||
    Date.parse(right.latestAt) - Date.parse(left.latestAt) ||
    left.id.localeCompare(right.id),
  ).slice(0, MAX_TECHNOLOGY_HOTSPOTS);
  return Object.freeze({
    windowHours: TECHNOLOGY_HOTSPOT_WINDOW_HOURS,
    generatedAt,
    topicCount: topics.length,
    topics: Object.freeze(topics.map((topic) => Object.freeze(topic))),
    disclaimer: "热点来自近 48 小时公开资讯关键词；股票仅按关联行业的高流动性样本匹配，不代表事件因果、公司真实受益或买入建议。",
  });
}

function mainlineSnapshotRow(snapshot) {
  if (
    snapshot?.kind !== "a-share-selection-snapshot" ||
    !validDate(snapshot.marketDate) ||
    !Array.isArray(snapshot.market?.mainlines)
  ) return null;
  const candidate = snapshot.market.mainlines.find((item) => item?.role === "mainline") ?? snapshot.market.mainlines[0];
  const id = cleanText(candidate?.id, 50);
  const name = cleanText(candidate?.name, 40);
  const score = finiteNumber(candidate?.score);
  if (!/^new_[A-Za-z0-9]+$/u.test(id) || !name || score == null || score < 0 || score > 100) return null;
  const method = candidate?.method === "sample-ladder" ? "sample-ladder" : "trend-relative";
  return {
    date: snapshot.marketDate,
    sectorId: id,
    sectorName: name,
    score: round(score, 1),
    method,
    methodLabel: method === "sample-ladder" ? "样本梯队＋趋势" : "趋势相对强度",
    sessionPhase: ["intraday", "close", "previous-close"].includes(snapshot.session?.phase)
      ? snapshot.session.phase
      : "close",
  };
}

function buildMainlineHistory(reviewSnapshots, currentSnapshot) {
  const byDate = new Map();
  for (const snapshot of Array.isArray(reviewSnapshots) ? reviewSnapshots : []) {
    const row = mainlineSnapshotRow(snapshot);
    if (!row) continue;
    const existing = byDate.get(row.date);
    const rank = (phase) => phase === "close" ? 3 : phase === "intraday" ? 2 : 1;
    if (!existing || rank(row.sessionPhase) >= rank(existing.sessionPhase)) byDate.set(row.date, row);
  }
  const current = mainlineSnapshotRow(currentSnapshot);
  if (current) byDate.set(current.date, current);
  const rows = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(-12);
  let duration = 0;
  let priorSectorId = null;
  return Object.freeze(rows.map((row) => {
    duration = row.sectorId === priorSectorId ? duration + 1 : 1;
    priorSectorId = row.sectorId;
    return Object.freeze({ ...row, duration });
  }));
}

function rotationSnapshotRow(snapshot) {
  if (
    snapshot?.kind !== "a-share-selection-snapshot" ||
    !validDate(snapshot.marketDate) ||
    !Array.isArray(snapshot.sectors)
  ) return null;
  const sectors = snapshot.sectors.map((item) => {
    if (item?.scan && item.scan.state !== "complete") return null;
    const id = cleanText(item?.id, 50);
    const name = cleanText(item?.name, 40);
    const score = finiteNumber(item?.relativeScore);
    const stage = cleanText(item?.stage, 20);
    const stageLabel = cleanText(item?.stageLabel, 30);
    if (!/^new_[A-Za-z0-9]+$/u.test(id) || !name || score == null || score < 0 || score > 100 || !stage) return null;
    return { id, name, score: round(score, 1), stage, stageLabel };
  }).filter(Boolean).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  if (!sectors.length) return null;
  return {
    date: snapshot.marketDate,
    sessionPhase: ["intraday", "close", "previous-close"].includes(snapshot.session?.phase) ? snapshot.session.phase : "close",
    sectors,
  };
}

function buildSectorRotation(reviewSnapshots, currentSnapshot) {
  const byDate = new Map();
  const phaseRank = (phase) => phase === "close" ? 3 : phase === "intraday" ? 2 : 1;
  for (const snapshot of Array.isArray(reviewSnapshots) ? reviewSnapshots : []) {
    const row = rotationSnapshotRow(snapshot);
    if (!row) continue;
    const existing = byDate.get(row.date);
    if (!existing || phaseRank(row.sessionPhase) >= phaseRank(existing.sessionPhase)) byDate.set(row.date, row);
  }
  const current = rotationSnapshotRow(currentSnapshot);
  if (current) byDate.set(current.date, current);
  const days = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(-7);
  const aggregates = new Map();
  for (const day of days) {
    day.sectors.forEach((sector, index) => {
      const aggregate = aggregates.get(sector.id) ?? { id: sector.id, name: sector.name, scores: [], latestScore: null, bestRank: 100 };
      aggregate.name = sector.name;
      aggregate.scores.push(sector.score);
      aggregate.latestScore = sector.score;
      aggregate.bestRank = Math.min(aggregate.bestRank, index + 1);
      aggregates.set(sector.id, aggregate);
    });
  }
  const latestIds = new Set(days.at(-1)?.sectors.map((item) => item.id) ?? []);
  const selected = [...aggregates.values()].sort((left, right) =>
    Number(latestIds.has(right.id)) - Number(latestIds.has(left.id)) ||
    (right.latestScore ?? 0) - (left.latestScore ?? 0) ||
    mean(right.scores) - mean(left.scores) ||
    left.id.localeCompare(right.id),
  ).slice(0, 6);
  const rows = selected.map((sector) => {
    const cells = days.map((day) => {
      const index = day.sectors.findIndex((item) => item.id === sector.id);
      const item = index >= 0 ? day.sectors[index] : null;
      return item
        ? Object.freeze({ available: true, score: item.score, rank: index + 1, stage: item.stage, stageLabel: item.stageLabel })
        : Object.freeze({ available: false, score: null, rank: null, stage: "unavailable", stageLabel: "未覆盖" });
    });
    const available = cells.filter((cell) => cell.available);
    const delta = available.length >= 2 ? round(available.at(-1).score - available[0].score, 1) : null;
    return Object.freeze({
      id: sector.id,
      name: sector.name,
      delta,
      trend: delta == null ? "insufficient" : delta >= 5 ? "rising" : delta <= -5 ? "falling" : "stable",
      cells: Object.freeze(cells),
    });
  });
  return Object.freeze({
    version: 1,
    dates: Object.freeze(days.map((day) => day.date)),
    rows: Object.freeze(rows),
    methodology: "每个交易日只使用当日保存快照里的行业分数与阶段，不用今天的行业成员回填历史；空白表示当日未进入研究行业样本。",
  });
}

function validSectorDirectory(input, label) {
  const byId = new Map();
  for (const item of Array.isArray(input) ? input : []) {
    if (!/^new_[A-Za-z0-9]+$/u.test(item?.id) || !cleanText(item?.name, 40)) continue;
    byId.set(item.id, { ...item, name: cleanText(item.name, 40) });
    if (byId.size > MAX_SECTORS) throw new Error(`${label} exceeds the ${MAX_SECTORS} industry safety bound`);
  }
  return [...byId.values()];
}

function sectorScanState(value, members, analyzed, explicit) {
  if (!explicit) {
    return Object.freeze({
      state: analyzed.length === members.length ? "complete" : "partial",
      memberCount: members.length,
      eligibleCount: members.length,
      historyAvailable: analyzed.length,
      historyPending: 0,
      historyFailed: members.length - analyzed.length,
      reason: "旧版输入已完成本轮提供的行业样本分析",
    });
  }
  const scan = value ?? { state: "pending", memberCount: 0, eligibleCount: 0, historyAvailable: 0, historyPending: 0, historyFailed: 0 };
  if (!["pending", "partial", "complete", "failed"].includes(scan.state)) throw new Error("invalid industry scan state");
  for (const field of ["memberCount", "eligibleCount", "historyAvailable", "historyPending", "historyFailed"]) {
    if (!Number.isInteger(scan[field]) || scan[field] < 0 || scan[field] > SELECTION_SCAN_LIMITS.membersPerSector) {
      throw new Error(`invalid industry scan ${field}`);
    }
  }
  if (scan.historyAvailable + scan.historyPending + scan.historyFailed !== scan.eligibleCount || scan.eligibleCount > scan.memberCount ||
      (scan.state === "complete" && (scan.historyPending > 0 || scan.historyFailed > 0)) ||
      (scan.state === "pending" && (scan.memberCount > 0 || scan.eligibleCount > 0))) {
    throw new Error("industry scan counts conflict");
  }
  return Object.freeze({
    state: scan.state,
    memberCount: scan.memberCount,
    eligibleCount: scan.eligibleCount,
    historyAvailable: scan.historyAvailable,
    historyPending: scan.historyPending,
    historyFailed: scan.historyFailed,
    reason: cleanText(scan.reason, 240),
  });
}

function sectorSelectionReason(sector, recommended, candidateLimit) {
  if (sector.scan.state === "pending") return sector.scan.memberCount === 0 ? "待取得行业成员，尚未参与排名" : "等待行业历史，尚未参与排名";
  if (sector.scan.state === "failed") return `行业数据获取失败，尚未参与排名${sector.scan.reason ? `：${sector.scan.reason}` : ""}`;
  if (sector.scan.state === "partial") return sector.scan.historyPending > 0
    ? `历史未完成（待取得 ${sector.scan.historyPending} 只），当前仅保留个股观察`
    : "部分历史获取失败，当前仅保留个股观察";
  if (candidateLimit === 0) return "当前市场环境的优先研究额度为 0";
  if (sector.stage === "crowded") return "板块拥挤，未进入优先研究";
  if (sector.stage === "retreat") return "板块退潮，未进入优先研究";
  if (sector.metrics.sampleSize < 3) return "有效历史样本不足 3 只，未进入优先研究";
  if (!["advancing", "expansion", "emerging"].includes(sector.stage)) return "板块尚在修复，等待趋势扩散";
  return recommended
    ? `完整行业综合排名第 ${sector.rank}，进入当前优先研究范围`
    : `分数未进入当前可优先研究行业的前 ${candidateLimit} 名`;
}

function snapshotScanProgress(value, sectors, generatedAt, scanCoverage = {}) {
  const totalSectors = sectors.length;
  const completedSectors = sectors.filter((sector) => sector.scan.state === "complete").length;
  const failedSectors = sectors.filter((sector) => sector.scan.state === "failed").length;
  const pendingSectors = totalSectors - completedSectors - failedSectors;
  let batch;
  if (Object.hasOwn(value ?? {}, "batch")) {
    const input = value.batch;
    if (!input || typeof input !== "object" || Array.isArray(input) || input.version !== 1) {
      throw new Error("invalid all-industry scan batch");
    }
    batch = { version: 1 };
    const bounds = {
      memberRequests: SELECTION_SCAN_LIMITS.sectorBatchSize,
      memberCompleted: SELECTION_SCAN_LIMITS.sectorBatchSize,
      historyRequests: SELECTION_SCAN_LIMITS.historyNetworkBatchSize,
      historyAdded: SELECTION_SCAN_LIMITS.historyNetworkBatchSize,
      historyRejected: SELECTION_SCAN_LIMITS.historyNetworkBatchSize,
      announcementRequests: SELECTION_SCAN_LIMITS.announcementBatchSize,
      announcementChecked: SELECTION_SCAN_LIMITS.announcementBatchSize,
    };
    for (const [field, maximum] of Object.entries(bounds)) {
      if (!Number.isInteger(input[field]) || input[field] < 0 || input[field] > maximum) {
        throw new Error(`invalid all-industry scan batch ${field}`);
      }
      batch[field] = input[field];
    }
    if (batch.memberCompleted > batch.memberRequests ||
        batch.historyAdded + batch.historyRejected > batch.historyRequests ||
        batch.announcementChecked > batch.announcementRequests) {
      throw new Error("all-industry scan batch counts conflict");
    }
    Object.freeze(batch);
  }
  const announcementFields = ["announcementRequested", "announcementAvailable", "announcementPending", "announcementFailed"];
  const announcements = {};
  if (announcementFields.some((field) => Object.hasOwn(value ?? {}, field))) {
    for (const field of announcementFields) {
      if (!Number.isInteger(value[field]) || value[field] < 0 || value[field] > SELECTION_SCAN_LIMITS.stocks) {
        throw new Error(`invalid all-industry scan ${field}`);
      }
      announcements[field] = value[field];
    }
    if (announcements.announcementAvailable + announcements.announcementPending + announcements.announcementFailed !== announcements.announcementRequested) {
      throw new Error("all-industry announcement scan counts conflict");
    }
  }
  const hasMore = value?.hasMore ?? (scanCoverage.historyPending > 0 || sectors.some((sector) => sector.scan.state === "pending" || sector.scan.historyPending > 0));
  const hasRetryAt = Object.hasOwn(value ?? {}, "nextRetryAt");
  if (hasRetryAt && value.nextRetryAt !== null && (!validInstant(value.nextRetryAt) || !hasMore)) {
    throw new Error("invalid all-industry scan nextRetryAt");
  }
  const complete = completedSectors === totalSectors && !hasMore &&
    !(announcements.announcementFailed > 0) && !(announcements.announcementPending > 0) &&
    !(scanCoverage.historyFailed > 0) && !(scanCoverage.historyPending > 0);
  if (value) {
    if (value.version !== 1 || value.scope !== "all-industries" || !["running", "complete", "partial"].includes(value.state) || typeof value.hasMore !== "boolean" || !validInstant(value.updatedAt)) {
      throw new Error("invalid all-industry scan progress");
    }
    if (value.totalSectors !== totalSectors || value.completedSectors !== completedSectors || value.pendingSectors !== pendingSectors || value.failedSectors !== failedSectors) {
      throw new Error("all-industry scan progress counts conflict");
    }
    if ((value.state === "complete" && !complete) || (value.state === "running") !== hasMore) {
      throw new Error("all-industry scan progress state conflicts");
    }
  }
  return Object.freeze({
    version: 1,
    scope: "all-industries",
    state: value?.state ?? (hasMore ? "running" : complete ? "complete" : "partial"),
    totalSectors,
    completedSectors,
    pendingSectors,
    failedSectors,
    hasMore,
    ...(batch ? { batch } : {}),
    ...(hasRetryAt ? { nextRetryAt: value.nextRetryAt } : {}),
    ...announcements,
    updatedAt: value?.updatedAt ?? generatedAt,
  });
}

function selectionSummary({ sectors, environment, analyzedSymbols, observedSymbols, confirmedSymbols, watchStocks, sourceErrors }) {
  const sectorCount = sectors.length;
  const rankedSectors = sectors.filter((sector) => sector.scan.state === "complete").length;
  const partialSectors = sectors.filter((sector) => sector.scan.state === "partial").length;
  const pendingSectors = sectors.filter((sector) => sector.scan.state === "pending" || sector.scan.historyPending > 0).length;
  const sectorAnalyzedStocks = analyzedSymbols.size;
  const analyzed = new Set(analyzedSymbols);
  const observed = new Set(observedSymbols);
  for (const stock of watchStocks) {
    if (stock.metrics) analyzed.add(stock.symbol);
    if (["waiting", "opportunity"].includes(stock.state)) observed.add(stock.symbol);
  }
  let state;
  let reason;
  if (sectorCount === 0) {
    state = "data-unavailable";
    const failed = sourceErrors?.some((item) => item?.source === "industries");
    reason = failed ? "行业数据源获取失败，尚不能生成行业选股结果。" : "尚未取得行业目录，不能把空结果解释为没有合适股票。";
    if (analyzed.size) reason += ` 已取得的 ${analyzed.size} 只自选或复盘个股仍可查看。`;
    if (environment.candidateLimit === 0) reason += ` 同时当前市场为${environment.label}，优先研究额度为 0。`;
  } else if (sectorAnalyzedStocks === 0) {
    state = pendingSectors ? "scanning" : "data-unavailable";
    reason = pendingSectors ? "正在取得行业成员和股票历史，尚无足够数据执行选股判断。" : "行业目录已取得，但股票历史数据尚不可用，不能生成确认结果。";
  } else if (environment.candidateLimit === 0) {
    state = "market-blocked";
    reason = `已分析 ${sectorAnalyzedStocks} 只行业股票；当前市场为${environment.label}，优先研究额度为 0，继续保留技术观察和过滤原因。`;
  } else if (rankedSectors === 0) {
    state = pendingSectors ? "scanning" : "data-unavailable";
    reason = `已分析 ${sectorAnalyzedStocks} 只股票，但尚无行业完成全部数据核验，当前仅保留观察结果。`;
  } else if (confirmedSymbols.size > 0) {
    state = "ready";
    reason = `已核验 ${rankedSectors} 个完整行业，${confirmedSymbols.size} 只股票通过当前技术、行业和公告条件；列表按展示上限呈现。`;
  } else {
    state = pendingSectors ? "scanning" : "no-confirmation";
    reason = `已分析 ${sectorAnalyzedStocks} 只股票，当前没有同时通过技术、行业、市场及公告条件的确认结果；观察池与各项过滤数量仍可查看。`;
  }
  return Object.freeze({
    version: 1, state, reason, sectorCount, rankedSectors, partialSectors,
    analyzedStocks: analyzed.size, observedStocks: observed.size, confirmedStocks: confirmedSymbols.size,
  });
}

export function buildAShareSelectionSnapshot(input) {
  const { marketDate, asOf, generatedAt } = input ?? {};
  if (!validDate(marketDate) || !validInstant(asOf) || !validInstant(generatedAt)) {
    throw new Error("selection snapshot requires valid marketDate, asOf and generatedAt");
  }
  if (asOf.slice(0, 10) !== marketDate || Date.parse(asOf) > Date.parse(generatedAt) + 60 * 60 * 1_000) {
    throw new Error("selection snapshot time fields conflict");
  }
  const quotes = Array.isArray(input.quotes) ? input.quotes : [];
  const suppliedIndustries = validSectorDirectory(input.industries, "industry input");
  const suppliedDirectory = validSectorDirectory(Array.isArray(input.sectorDirectory) ? input.sectorDirectory : suppliedIndustries, "industry directory");
  const sectorDirectoryInput = validSectorDirectory([...suppliedDirectory, ...suppliedIndustries], "combined industry directory");
  const hasSectorScan = input.sectorScan != null;
  const industries = hasSectorScan ? sectorDirectoryInput : suppliedIndustries;
  const sectorScanMap = input.sectorScan instanceof Map ? input.sectorScan : new Map(Object.entries(input.sectorScan ?? {}));
  const memberMap = input.industryMembers instanceof Map
    ? input.industryMembers
    : new Map(Object.entries(input.industryMembers ?? {}));
  const historyMap = input.histories instanceof Map ? input.histories : new Map(Object.entries(input.histories ?? {}));
  const benchmarkHistoryMap = input.benchmarkHistories instanceof Map
    ? input.benchmarkHistories
    : new Map(Object.entries(input.benchmarkHistories ?? {}));
  const announcementMap = input.announcements instanceof Map
    ? input.announcements
    : new Map(Object.entries(input.announcements ?? {}));
  const watch = normalizeWatch(input.watch);
  const breadth = calculateMarketBreadth(quotes);
  const baseEnvironment = buildMarketEnvironment({
    quotes,
    marketDate,
    generatedAt,
    provisional: input.provisional === true,
    historySnapshots: input.marketHistory,
  });
  const news = Array.isArray(input.news) ? input.news : [];
  const sectorNews = associateSectorNews(industries, news, generatedAt, 36);
  const watchedSectorIds = new Set(watch.sectors.map((item) => item.id));
  const analyzedBySector = new Map();
  const provisional = input.provisional === true;
  const rawSectors = [];
  const analyzedBySymbol = new Map();
  for (const industry of industries) {
    const members = memberMap.get(industry.id) ?? [];
    if (members.length > SELECTION_SCAN_LIMITS.membersPerSector) throw new Error("industry members exceed the safety bound");
    const analyzed = members.flatMap((quote) => {
      if (analyzedBySymbol.has(quote.symbol)) return analyzedBySymbol.get(quote.symbol) ?? [];
      const storedHistory = historyMap.get(quote.symbol);
      const history = Array.isArray(storedHistory) ? storedHistory.slice(-180) : storedHistory;
      const row = analyzeStockHistory(quote, history, { marketDate, provisional });
      if (!row) { analyzedBySymbol.set(quote.symbol, null); return []; }
      const benchmarkSymbol = abnormalBenchmarkFor(row.symbol, row.board);
      const result = {
        ...row,
        abnormalDeviation: calculateAbnormalDeviation({
          symbol: row.symbol,
          board: row.board,
          stockBars: history,
          benchmarkBars: benchmarkHistoryMap.get(benchmarkSymbol),
        }),
      };
      analyzedBySymbol.set(quote.symbol, result);
      return [result];
    });
    analyzedBySector.set(industry.id, analyzed);
    const scan = sectorScanState(sectorScanMap.get(industry.id), members, analyzed, hasSectorScan);
    const metrics = sectorMetrics({ ...industry, count: industry.count > 0 ? industry.count : scan.memberCount }, analyzed);
    const stage = sectorStage(metrics, industry);
    const catalysts = (sectorNews.get(industry.id)?.matches ?? []).slice(0, 3).map((item) => newsEvent(item));
    rawSectors.push({
      id: industry.id,
      name: industry.name,
      scan,
      watched: watchedSectorIds.has(industry.id),
      stage: stage.stage,
      stageLabel: stage.label,
      metrics,
      catalysts,
      evidence: [
        `高流动性样本涨停 ${metrics.limitUpCount} · 最高 ${metrics.maxBoards} 板 · 二板以上 ${metrics.ge2Count}`,
        `高流动性样本 20 / 60 日中位收益 ${percent(metrics.return20Median)} / ${percent(metrics.return60Median)}`,
        `站上 MA20 ${metrics.above20Ratio == null ? "—" : percent(metrics.above20Ratio * 100, 0)} · MA20>MA60 ${metrics.trendRatio == null ? "—" : percent(metrics.trendRatio * 100, 0)}`,
        catalysts.length ? `${catalysts.length} 条近 36 小时行业新闻匹配` : "近 36 小时未匹配到行业关键词新闻",
      ],
      risks: [
        metrics.sampleSize < 3 ? "历史样本不足，板块状态已降级" : "板块趋势来自高流动性成分样本，不是官方行业指数",
        stage.stage === "crowded" ? "短期涨幅或均线偏离较大，避免追高" : "新闻关键词匹配不证明价格上涨由事件导致",
      ],
    });
  }
  const completeSectors = sectorScoreRows(rawSectors.filter((sector) => sector.scan.state === "complete"))
    .map((sector, index) => ({ ...sector, rank: index + 1 }));
  const scoredSectors = [
    ...completeSectors,
    ...rawSectors.filter((sector) => sector.scan.state !== "complete")
      .map((sector) => ({ ...sector, relativeScore: 0, rank: null }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  ];
  const recommended = scoredSectors
    .filter((sector) => sector.scan.state === "complete" && ["advancing", "expansion", "emerging"].includes(sector.stage) && sector.metrics.sampleSize >= 3)
    .slice(0, baseEnvironment.candidateLimit);
  const recommendedIds = new Set(recommended.map((item) => item.id));
  const analyzedSymbols = new Set();
  const observedSymbols = new Set();
  const confirmedAllSymbols = new Set();
  const announcementRequests = new Set();
  const sectors = scoredSectors.map((sector) => {
    const rankedRows = stockScoreRows(analyzedBySector.get(sector.id) ?? []);
    const timingRows = rankedRows.map((row, index) => ({
      row,
      rank: index + 1,
      timing: stockTiming(row, baseEnvironment),
      technicalTiming: stockTiming(row),
      announcementAvailable: announcementMap.has(row.symbol),
      eventBlocked: (announcementMap.get(row.symbol) ?? []).some((item) => item.importance === "risk"),
    }));
    const sectorGateOpen = sector.scan.state === "complete" && ["advancing", "expansion"].includes(sector.stage);
    const representativeRows = timingRows.slice(0, MAX_REPRESENTATIVES_PER_SECTOR);
    const confirmationEligible = provisional || !sectorGateOpen
      ? []
      : timingRows
        .filter((item) => item.timing.state === "opportunity" && item.announcementAvailable && !item.eventBlocked);
    const confirmedRows = confirmationEligible.slice(0, MAX_CANDIDATES_PER_SECTOR);
    const confirmedSymbols = new Set(confirmedRows.map((item) => item.row.symbol));
    const queueRows = timingRows
      .filter((item) => item.timing.state !== "risk" && !confirmedSymbols.has(item.row.symbol))
      // The preliminary scan fetches announcements for representatives and this
      // queue. Keep technically ready stocks visible so missing data can resolve.
      .sort((left, right) =>
        Number(!right.announcementAvailable && right.timing.state === "opportunity") -
        Number(!left.announcementAvailable && left.timing.state === "opportunity") || left.rank - right.rank,
      )
      .slice(0, MAX_TIMING_QUEUE_PER_SECTOR);
    for (const item of timingRows) {
      analyzedSymbols.add(item.row.symbol);
      if (["waiting", "opportunity"].includes(item.timing.state)) observedSymbols.add(item.row.symbol);
      if (item.timing.state === "opportunity") announcementRequests.add(item.row.symbol);
    }
    for (const item of [...representativeRows, ...queueRows]) announcementRequests.add(item.row.symbol);
    for (const item of confirmationEligible) confirmedAllSymbols.add(item.row.symbol);
    const gateCounts = Object.freeze({
      analyzed: timingRows.length,
      historyUnavailable: Math.max(0, (memberMap.get(sector.id)?.length ?? 0) - timingRows.length) + timingRows.filter((item) => item.timing.state === "unavailable").length,
      trendBlocked: timingRows.filter((item) => item.technicalTiming.state === "risk").length,
      strategyWaiting: timingRows.filter((item) => item.technicalTiming.state === "waiting").length,
      technicalReady: timingRows.filter((item) => item.technicalTiming.state === "opportunity").length,
      marketBlocked: timingRows.filter((item) => item.technicalTiming.state === "opportunity" && item.timing.state !== "opportunity").length,
      announcementPending: timingRows.filter((item) => item.technicalTiming.state === "opportunity" && !item.announcementAvailable).length,
      announcementRisk: timingRows.filter((item) => item.technicalTiming.state === "opportunity" && item.eventBlocked).length,
      sectorBlocked: sectorGateOpen ? 0 : timingRows.filter((item) => item.technicalTiming.state === "opportunity").length,
      confirmed: confirmationEligible.length,
    });
    const toCandidate = ({ row, rank, eventBlocked, timing }, respectSectorGate = false) =>
      buildCandidate(
        row,
        sector,
        rank,
        rankedRows.length,
        announcementMap,
        news,
        provisional,
        { respectSectorGate, eventBlocked, timingResult: timing, environment: baseEnvironment },
      );
    return {
      ...sector,
      recommended: recommendedIds.has(sector.id),
      recommendationLabel: recommendedIds.has(sector.id) ? "优先研究" : sector.watched ? "长期关注" : "观察",
      selectionReason: sectorSelectionReason(sector, recommendedIds.has(sector.id), baseEnvironment.candidateLimit),
      gateCounts,
      representatives: representativeRows.map((item) => toCandidate(item)),
      timingQueue: queueRows.map((item) => toCandidate(item, true)),
      candidates: confirmedRows.map((item) => toCandidate(item, true)),
      poolCounts: {
        representatives: representativeRows.length,
        waiting: queueRows.length,
        confirmed: confirmedRows.length,
        excluded: timingRows.filter((item) => item.timing.state === "risk").length,
      },
    };
  });
  const quoteMap = new Map(quotes.map((quote) => [quote.symbol, quote]));
  const researchHistories = input.omitDiagnostics === true ? [] : [...historyMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([symbol, bars]) => {
    const quote = quoteMap.get(symbol);
    return quote && Array.isArray(bars) && bars.length >= 81 && bars.at(-1)?.date === marketDate
      ? [{ symbol, board: quote.board, bars: bars.slice(-180) }] : [];
  }).slice(0, MAX_DIAGNOSTIC_STOCKS);
  const diagnosticsDisclosure = `校准样本最多 ${MAX_DIAGNOSTIC_STOCKS} 只，不等同全市场；按股票代码稳定排序选择当交易日历史完整的标的，不改变本轮选股范围。${input.omitDiagnostics === true ? "本次预扫描未计算历史研究指标。" : ""}`;
  const diagnosticsSample = Object.freeze({
    maximumStocks: MAX_DIAGNOSTIC_STOCKS,
    symbols: Object.freeze(researchHistories.map((item) => item.symbol)),
    omitted: input.omitDiagnostics === true,
  });
  const calibrated = calibrateStrategyHistories(researchHistories);
  const strategyLab = Object.freeze({ ...calibrated, sample: diagnosticsSample, disclosure: `${calibrated.disclosure} ${diagnosticsDisclosure}` });
  const strategyEvidenceChanges = compareStrategyEvidence(input.reviewSnapshots, strategyLab, marketDate);
  const diagnosed = buildFactorDiagnostics(researchHistories);
  const factorLab = Object.freeze({ ...diagnosed, sample: diagnosticsSample, disclosure: `${diagnosed.disclosure} ${diagnosticsDisclosure}` });
  const predictions = buildPredictionLedger(sectors, strategyLab, marketDate);
  const technologyHotspots = buildTechnologyHotspots(news, sectors, generatedAt);
  const watchStocks = watch.stocks.map((item) => buildWatchStock(quoteMap.get(item.symbol), historyMap.get(item.symbol), {
    ...item,
    marketDate,
    provisional,
    announcements: announcementMap,
    news,
    environment: baseEnvironment,
    benchmarkHistories: benchmarkHistoryMap,
  }));
  const sourceStatus = {
    quotes: input.sourceStatus?.quotes === true,
    industries: input.sourceStatus?.industries === true,
    histories: input.sourceStatus?.histories === true,
    announcements: input.sourceStatus?.announcements === true,
    news: input.sourceStatus?.news === true,
  };
  const scanCoverageInput = input.scanCoverage ?? {};
  const scanCoverage = {
    quoteUniverse: Number.isInteger(scanCoverageInput.quoteUniverse)
      ? scanCoverageInput.quoteUniverse
      : quotes.length,
    researchSectors: Number.isInteger(scanCoverageInput.researchSectors)
      ? scanCoverageInput.researchSectors
      : industries.length,
    sectorMembers: Number.isInteger(scanCoverageInput.sectorMembers)
      ? scanCoverageInput.sectorMembers
      : historyMap.size,
    historyRequested: Number.isInteger(scanCoverageInput.historyRequested)
      ? scanCoverageInput.historyRequested
      : historyMap.size,
    historyAvailable: Number.isInteger(scanCoverageInput.historyAvailable)
      ? scanCoverageInput.historyAvailable
      : historyMap.size,
    historyCacheHits: Number.isInteger(scanCoverageInput.historyCacheHits)
      ? scanCoverageInput.historyCacheHits
      : 0,
    historyNetworkLoads: Number.isInteger(scanCoverageInput.historyNetworkLoads)
      ? scanCoverageInput.historyNetworkLoads
      : historyMap.size,
    historyFailed: Number.isInteger(scanCoverageInput.historyFailed)
      ? scanCoverageInput.historyFailed
      : 0,
    ...(hasSectorScan || Number.isInteger(scanCoverageInput.historyPending) ? {
      historyPending: Number.isInteger(scanCoverageInput.historyPending) ? scanCoverageInput.historyPending : 0,
    } : {}),
  };
  const stockDirectory = [];
  const stockSymbols = new Set();
  for (const item of quotes) {
    const symbol = cleanText(item?.symbol, 16).toUpperCase();
    const name = cleanText(item?.name, 40);
    if (!/^(?:SH|SZ)\d{6}$/u.test(symbol) || !name || stockSymbols.has(symbol)) continue;
    stockSymbols.add(symbol);
    stockDirectory.push({ symbol, name });
    if (stockDirectory.length > SELECTION_SCAN_LIMITS.stocks) throw new Error("stock directory exceeds the safety bound");
  }
  const session = {
    phase: provisional ? "intraday" : input.previousClose === true ? "previous-close" : "close",
    provisional,
    previousClose: input.previousClose === true,
  };
  const mainlines = buildMarketMainlines(sectors.filter((sector) => sector.scan.state === "complete"));
  const limitLadder = buildLimitLadder(sectors, analyzedBySector, provisional);
  const currentReviewSnapshot = {
    kind: "a-share-selection-snapshot",
    marketDate,
    session,
    market: { mainlines },
    sectors,
  };
  const mainlineHistory = buildMainlineHistory(input.reviewSnapshots, currentReviewSnapshot);
  const rotationMatrix = buildSectorRotation(input.reviewSnapshots, currentReviewSnapshot);
  const summary = selectionSummary({
    sectors, environment: baseEnvironment, analyzedSymbols, observedSymbols, confirmedSymbols: confirmedAllSymbols,
    watchStocks, sourceErrors: input.sourceErrors,
  });
  return Object.freeze({
    schemaVersion: A_SHARE_SELECTION_SCHEMA_VERSION,
    kind: "a-share-selection-snapshot",
    marketDate,
    asOf,
    generatedAt,
    session,
    market: {
      ...baseEnvironment,
      mainlines,
      limitLadder,
      rotationMatrix,
      mainlineHistory,
      mainlineHistoryMethodology: "只使用当日已保存选股快照中的首要主线；不以今天的行业成员回填历史。",
      breadth: {
        total: breadth.total,
        up: breadth.up,
        down: breadth.down,
        flat: breadth.flat,
        netBreadth: round(breadth.netBreadth, 4),
        limitUp: breadth.limitUp,
        limitDown: breadth.limitDown,
        amount: breadth.amount,
      },
    },
    scanCoverage,
    ...(hasSectorScan ? { scanProgress: snapshotScanProgress(input.scanProgress, sectors, generatedAt, scanCoverage) } : {}),
    sectorDirectory: sectorDirectoryInput
      .map((item) => ({ id: item.id, name: cleanText(item.name, 40) })),
    stockDirectory,
    sectors,
    selectionSummary: summary,
    ...(input.omitDiagnostics === true ? { announcementRequests: Object.freeze([...announcementRequests].sort()) } : {}),
    technologyHotspots,
    factorLab,
    strategyLab,
    strategyEvidenceChanges,
    predictions,
    predictionReview: input.predictionReview ?? {
      records: [],
      summary: {
        saved: 0,
        evaluated5: 0,
        positiveRate5: null,
        medianNetReturn5: null,
        evaluated20: 0,
        positiveRate20: null,
        medianNetReturn20: null,
      },
    },
    watch: {
      sectors: watch.sectors,
      stocks: watchStocks,
    },
    exclusions: {
      unavailableSectorSamples: sectors.filter((item) => item.stage === "unavailable").length,
      crowdedSectors: sectors.filter((item) => item.stage === "crowded").length,
      retreatSectors: sectors.filter((item) => item.stage === "retreat").length,
      noCandidateSectors: sectors.filter((item) => item.candidates.length === 0).length,
    },
    sourceStatus,
    ...(input.industryProvider ? { industryProvider: input.industryProvider } : {}),
    sourceErrors: Array.isArray(input.sourceErrors) ? input.sourceErrors.slice(0, 20) : [],
    elapsedMs: Number.isFinite(input.elapsedMs) ? Math.max(0, Math.round(input.elapsedMs)) : 0,
    sources: [
      ...(input.industryProvider ? [
        { label: "行情快照 · 沪深 A 股", url: "https://gu.qq.com/", asOf },
        ...(input.industryProvider.id.startsWith("json-") ? [] : [{ label: `${input.industryProvider.label} · 行业分类与成分`, url: input.industryProvider.url, asOf }]),
      ] : [{ label: "新浪财经 · 沪深 A 股与行业成分", url: "https://vip.stock.finance.sina.com.cn/mkt/", asOf }]),
      { label: "腾讯证券 · 个股前复权日线", url: "https://gu.qq.com/", asOf: marketDate },
      ...(sourceStatus.news ? [{ label: "东方财富 · 7×24 财经快讯", url: "https://finance.eastmoney.com/", asOf: generatedAt }] : []),
      ...(sourceStatus.announcements ? [{ label: "东方财富 · 上市公司公告", url: "https://data.eastmoney.com/notices/", asOf: generatedAt }] : []),
    ],
    disclaimer: "板块代表股不等于可买；时机确认也只是技术条件核验，仍须独立检查基本面、公告与个人风险预算，不构成个性化买卖、仓位或收益建议。",
  });
}

export const A_SHARE_SELECTION_LIMITS = Object.freeze({
  sectors: MAX_SECTORS,
  candidatesPerSector: MAX_CANDIDATES_PER_SECTOR,
  representativesPerSector: MAX_REPRESENTATIVES_PER_SECTOR,
  timingQueuePerSector: MAX_TIMING_QUEUE_PER_SECTOR,
  watchStocks: MAX_WATCH_STOCKS,
});
