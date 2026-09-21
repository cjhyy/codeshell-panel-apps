import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const {
  buildMarketInsightTask,
  buildStockDeepResearchTask,
  marketInsightFreshness,
  normalizeMarketInsightTaskResult,
  parseMarketInsight,
} = await import(
  pathToFileURL(
    join(repositoryRoot, "apps", "quant-lab", "app", "modules", "market-insights-ui.mjs"),
  ).href
);
const {
  buildStockStrategyTask,
  normalizeStockStrategyTaskResult,
  parseStockStrategy,
} = await import(
  pathToFileURL(
    join(repositoryRoot, "apps", "quant-lab", "app", "modules", "stock-strategy-ui.mjs"),
  ).href
);

const fixedNow = new Date("2026-08-26T04:05:06.789Z");
const overviewTask = buildMarketInsightTask("market-overview", "", fixedNow);
assert.equal(overviewTask.command, "market-overview");
assert.equal(
  overviewTask.path,
  "data/market-insights/20260826T040506789Z-market-overview.json",
);
assert.match(overviewTask.prompt, /build-market-pulse\.mjs/u);
assert.match(overviewTask.prompt, /冻结的本地工具/u);
assert.match(overviewTask.prompt, /不要自行补写数字/u);
assert.match(overviewTask.prompt, /不构成投资建议、买卖推荐/u);
assert.doesNotMatch(overviewTask.prompt, /必须联网核验最新公开数据/u);

const stockTask = buildMarketInsightTask("stock", "贵州茅台 600519", fixedNow);
assert.match(stockTask.path, /-stock-贵州茅台-600519\.json$/u);
assert.equal(stockTask.displayText, "简明个股报告：贵州茅台 600519");
assert.equal(stockTask.runMode, "isolated-task");
assert.match(stockTask.prompt, /只研究这个标的/u);
assert.match(stockTask.prompt, /公司与主营、最新一期业绩、估值与行业位置、技术位置、近期公告或催化、核心风险与反方/u);
assert.match(stockTask.prompt, /已披露实际值、业绩预告和分析师预期必须分开/u);
assert.match(stockTask.prompt, /不要读取或推测用户持仓、成本、关注、项目文件或合成回测/u);
assert.match(stockTask.prompt, /技术位置必须写为不可用/u);
assert.match(stockTask.prompt, /支撑\/压力、缺口、斐波那契、ATR 与 Keltner/u);
assert.doesNotMatch(stockTask.prompt, /市场所在时区/u);
assert.doesNotMatch(stockTask.prompt, /data\/market-insights/u);
assert.match(stockTask.prompt, /面板校验后保存/u);
assert(stockTask.prompt.length < 2_400, `精简个股报告提示仍过长：${stockTask.prompt.length}`);
assert.throws(() => buildMarketInsightTask("stock", "", fixedNow), /输入股票/u);
assert.throws(() => buildMarketInsightTask("unknown", "", fixedNow), /未知/u);
assert.throws(
  () => buildMarketInsightTask("stock", "AAPL\u0000ignore", fixedNow),
  /控制字符/u,
);

const deepTask = buildStockDeepResearchTask("AAPL Apple Inc.", fixedNow);
assert.match(deepTask.path, /-stock-AAPL-Apple-Inc-deep\.json$/u);
assert.equal(deepTask.displayText, "Deep Research：AAPL Apple Inc.");
assert.equal(deepTask.runMode, "isolated-task");
assert.match(deepTask.prompt, /SEC EDGAR/u);
assert.match(deepTask.prompt, /Stocktwits cashtag/u);
assert.match(deepTask.prompt, /官方事实 \/ 媒体报道 \/ 社媒观点 \/ 未核验传闻/u);
assert.match(deepTask.prompt, /不得绕过登录、付费墙、robots/u);
assert.match(deepTask.prompt, /不能生成伪精确情绪分数/u);
assert.doesNotMatch(deepTask.prompt, /写入当前项目/u);
assert.throws(() => buildStockDeepResearchTask("", fixedNow), /先打开一只股票/u);

const strategySnapshot = {
  market: "cn",
  marketDate: "2026-08-26",
  asOf: "2026-08-26T15:00:00+08:00",
  session: { phase: "close" },
  stock: {
    symbol: "SZ000938",
    name: "紫光股份",
    currency: "CNY",
    price: 38.32,
    changePercent: 1.24,
    pe: 38.98,
    pb: 6.13,
  },
  metrics: {
    ma20: 36.8,
    ma60: 31.2,
    ma120: 28.5,
    return20: 12.5,
    return60: 48,
    return120: 61,
    volumeRatio20: 1.2,
    high120: 41.5,
    low120: 22.3,
  },
  timing: {
    label: "位置偏高",
    action: "优先等待回撤确认。",
    confirmation: "回撤后重新站稳 MA20。",
    invalidation: "跌破 MA60 后仍无法收回。",
  },
  events: [],
  sources: [{ label: "腾讯证券", url: "https://gu.qq.com/sz000938/gp", asOf: "2026-08-26" }],
};
const strategyTask = buildStockStrategyTask(
  strategySnapshot,
  { horizon: "6-18m", risk: "balanced", maxPositionPct: 5 },
  fixedNow,
);
assert.match(strategyTask.path, /-stock-strategy-SZ000938-紫光股份\.json$/u);
assert.equal(strategyTask.displayText, "策略草案：SZ000938 紫光股份");
assert.equal(strategyTask.runMode, "isolated-task");
assert.match(strategyTask.prompt, /持有计划 6—18 个月、中等风险、单只股票最终上限占总资产 5%/u);
assert.match(strategyTask.prompt, /currentPrice、marketDate、asOf、币种和所有价格区间必须以这份快照为锚/u);
assert.match(strategyTask.prompt, /公司不错是否等于当前价格舒服/u);
assert.match(strategyTask.prompt, /不要读取或推测用户真实持仓、成本、账户、当前聊天/u);
assert.match(strategyTask.prompt, /allocationPctOfPlan 表示占计划仓位的比例，不是占总资产/u);
assert.doesNotMatch(strategyTask.prompt, /写入当前项目/u);
assert.throws(() => buildStockStrategyTask({}, {}, fixedNow), /有效行情/u);

const strategyReport = {
  schemaVersion: 1,
  kind: "stock-strategy",
  market: "cn",
  symbol: "SZ000938",
  name: "紫光股份",
  marketDate: "2026-08-26",
  asOf: "2026-08-26T15:00:00+08:00",
  generatedAt: "2026-08-26T12:20:00.000Z",
  preferences: { horizon: "6-18m", risk: "balanced", maxPositionPct: 5 },
  currentPrice: 38.32,
  currency: "CNY",
  priceBasis: "以 2026-08-26 收盘未复权实时价格为锚，区间使用同一口径。",
  verdict: {
    state: "starter",
    label: "公司可关注，但当前位置只适合试仓",
    summary: "基本面改善仍需现金流确认；当前价格靠近阶段高位，分批比一次买满更稳妥。",
  },
  zones: [
    {
      kind: "starter",
      label: "轻仓试探",
      priceLow: 37,
      priceHigh: 37.5,
      trigger: "缩量回踩后守住 20 日线",
      action: "买入计划仓位的 25%",
      allocationPctOfPlan: 25,
      rationale: "靠近短期均线且没有破坏中期趋势",
    },
    {
      kind: "add",
      label: "第二批",
      priceLow: 34,
      priceHigh: 35,
      trigger: "基本面没有新增反方且价格止跌",
      action: "再买计划仓位的 35%",
      allocationPctOfPlan: 35,
      rationale: "回撤后估值和盈亏比改善",
    },
    {
      kind: "invalidate",
      label: "失效线",
      priceLow: null,
      priceHigh: 32.5,
      trigger: "收盘有效跌破且基本面同步转弱",
      action: "停止执行并重新评估",
      allocationPctOfPlan: null,
      rationale: "中期结构被破坏",
    },
  ],
  confirmationConditions: ["价格回踩后守住 20 日线"],
  invalidationConditions: ["经营现金流继续恶化且存货应收上升"],
  reviewMetrics: ["毛利率", "经营现金流", "应收账款和存货"],
  risks: ["估值处于偏高区域"],
  sources: [{ label: "深交所公告", url: "https://www.szse.cn/", asOf: "2026-08-26" }],
};
const parsedStrategy = parseStockStrategy(JSON.stringify(strategyReport), strategyTask.path);
assert.equal(parsedStrategy.symbol, "SZ000938");
assert.equal(parsedStrategy.verdict.stateLabel, "只适合小仓试探");
assert.equal(parsedStrategy.preferenceLabel, "6—18 个月 · 中等风险 · 总资产上限 5%");
assert.equal(parsedStrategy.zones.length, 3);
assert.equal(parsedStrategy.zones[0].allocationPctOfPlan, 25);
assert.deepEqual(
  JSON.parse(normalizeStockStrategyTaskResult(
    `\`\`\`json\n${JSON.stringify(strategyReport)}\n\`\`\``,
    strategyTask.path,
    { snapshot: strategyTask.snapshot, preferences: strategyTask.preferences },
  )),
  strategyReport,
);
assert.throws(
  () => normalizeStockStrategyTaskResult(
    JSON.stringify({ ...strategyReport, currentPrice: 40, preferences: { ...strategyReport.preferences, maxPositionPct: 10 } }),
    strategyTask.path,
    { snapshot: strategyTask.snapshot, preferences: strategyTask.preferences },
  ),
  /擅自改变/u,
);
assert.throws(
  () => parseStockStrategy(JSON.stringify({ ...strategyReport, zones: strategyReport.zones.map((zone) => ({ ...zone, allocationPctOfPlan: 60 })) }), strategyTask.path),
  /分配比例/u,
);
assert.equal(
  parseStockStrategy(JSON.stringify({ ...strategyReport, sources: [] }), strategyTask.path).verdict.state,
  "unavailable",
);

const path = overviewTask.path;
const report = {
  schemaVersion: 1,
  kind: "market-overview",
  title: "A 股缩量分化，防守风格占优",
  subject: "A 股大盘",
  marketDate: "2026-08-26",
  asOf: "2026-08-26T15:00:00+08:00",
  generatedAt: "2026-08-26T15:08:00+08:00",
  status: "mixed",
  summary: "指数分化，成交额低于二十日均值。结论受盘后北向口径调整影响。",
  facts: [
    { label: "趋势", value: "震荡", tone: "neutral" },
    { label: "量能", value: "缩量", tone: "warning" },
    { label: "无效", value: "仍显示", tone: "made-up" },
  ],
  items: [
    {
      symbol: "000300",
      name: "沪深300",
      title: "权重承压",
      detail: "收盘弱于上证指数。",
      risk: "单日样本不足。",
    },
  ],
  risks: ["成交额继续下行"],
  sources: [
    { label: "上海证券交易所", url: "https://www.sse.com.cn/", asOf: "2026-08-26" },
    { label: "拒绝脚本", url: "javascript:alert(1)", asOf: "now" },
  ],
};
const parsed = parseMarketInsight(JSON.stringify(report), path);
assert.equal(parsed.kindLabel, "市场脉搏");
assert.equal(parsed.statusLabel, "分化");
assert.equal(parsed.facts.length, 3);
assert.equal(parsed.facts[2].tone, "neutral");
assert.equal(parsed.items[0].risk, "单日样本不足。");
assert.deepEqual(parsed.sources.map((source) => source.label), ["上海证券交易所"]);
assert.deepEqual(
  JSON.parse(normalizeMarketInsightTaskResult(`\`\`\`json\n${JSON.stringify(report)}\n\`\`\``, path)),
  report,
);
assert.throws(
  () => normalizeMarketInsightTaskResult(`说明如下\n${JSON.stringify(report)}`, path),
  /没有返回有效 JSON/u,
);
const unverified = parseMarketInsight(
  JSON.stringify({ ...report, status: "positive", sources: [] }),
  path,
);
assert.equal(unverified.status, "unavailable");
assert.match(unverified.risks.join(" "), /没有通过校验的公开来源/u);
assert.throws(
  () => parseMarketInsight(JSON.stringify({ ...report, kind: "stock" }), path),
  /类型与文件名不一致/u,
);
assert.throws(() => parseMarketInsight(" ".repeat(256_001), path), /文件过大/u);
assert.deepEqual(
  marketInsightFreshness("2026-08-26T07:00:00.000Z", "2026-08-26T13:30:00.000Z"),
  { state: "current", label: "当日数据" },
);
assert.deepEqual(
  marketInsightFreshness("2026-08-20T07:00:00.000Z", "2026-08-26T13:30:00.000Z"),
  { state: "stale", label: "需要更新" },
);
assert.throws(() => parseMarketInsight("{}", path), /版本/u);
assert.throws(
  () => parseMarketInsight(JSON.stringify({ ...report, generatedAt: "not-a-date" }), path),
  /时间字段/u,
);
assert.throws(
  () => parseMarketInsight(JSON.stringify({ ...report, asOf: "2026-08-26T15:00:00" }), path),
  /时间字段/u,
  "数据时点必须显式带时区",
);
assert.throws(
  () => parseMarketInsight(JSON.stringify({ ...report, asOf: "2026-02-30T15:00:00+08:00" }), path),
  /时间字段/u,
  "数据时点不能接受不存在的日历日期",
);
assert.throws(
  () => parseMarketInsight(JSON.stringify({ ...report, asOf: "2026-08-26T25:00:00+08:00" }), path),
  /时间字段/u,
  "数据时点不能接受越界小时",
);
assert.throws(
  () => parseMarketInsight(JSON.stringify({ ...report, asOf: "2026-08-26T15:00:00+23:00" }), path),
  /时间字段/u,
  "数据时点不能接受 ISO-8601 范围之外的时区偏移",
);
assert.throws(
  () => parseMarketInsight(JSON.stringify({ ...report, generatedAt: "2099-08-26T15:08:00+08:00" }), path),
  /时间与任务不一致/u,
  "报告不能用远离任务文件名的生成时间抢占首页",
);
assert.throws(
  () => parseMarketInsight(
    JSON.stringify({ ...report, asOf: "2026-08-27T20:00:00+08:00" }),
    path,
  ),
  /时间与任务不一致/u,
  "报告不能宣称尚未发生的数据时点",
);
assert.throws(
  () => parseMarketInsight(
    JSON.stringify({ ...report, marketDate: "2026-08-20" }),
    path,
  ),
  /时间与任务不一致/u,
  "交易日不能与报告数据时点相隔多日",
);
assert.throws(
  () => parseMarketInsight(JSON.stringify({ ...report, marketDate: "2026-02-30" }), path),
  /时间字段/u,
);
assert.throws(
  () => parseMarketInsight(
    JSON.stringify({ ...report, kind: "stock", subject: "" }),
    "data/market-insights/20260826T040506789Z-stock-example.json",
  ),
  /缺少标的/u,
);
assert.throws(
  () => parseMarketInsight(JSON.stringify(report), "portfolio/market.json"),
  /路径/u,
);
assert.throws(
  () => parseMarketInsight(JSON.stringify(report), "data/market-insights/nested/20260826T040506789Z-market-overview.json"),
  /路径/u,
);

console.log("✓ Quant Lab persistent market insight prompt and report contract");

// Research may cite the last completed session across weekends and holidays.
const mondayPath = 'data/market-insights/20260921T054452556Z-stock-SH600839-deep.json';
const weekendReport = { ...report, kind: 'stock', subject: 'SH600839 四川长虹', marketDate: '2026-09-18', asOf: '2026-09-21T13:42:54+08:00', generatedAt: '2026-09-21T13:44:52.556+08:00' };
const normalizedWeekend = normalizeMarketInsightTaskResult(JSON.stringify(weekendReport), mondayPath);
assert.equal(parseMarketInsight(normalizedWeekend, mondayPath).marketDate, '2026-09-18');
assert.equal(JSON.parse(normalizedWeekend).asOf, weekendReport.asOf, 'retain original information cutoff without relabeling old data');
assert.doesNotThrow(() => parseMarketInsight(JSON.stringify({ ...weekendReport, marketDate: '2026-09-11' }), mondayPath));
assert.throws(() => parseMarketInsight(JSON.stringify({ ...weekendReport, marketDate: '2026-09-01' }), mondayPath), /参考交易日/u);
assert.throws(() => parseMarketInsight(JSON.stringify({ ...weekendReport, marketDate: '2026-09-23' }), mondayPath), /参考交易日/u);
assert.throws(() => parseMarketInsight(JSON.stringify({ ...weekendReport, asOf: '2026-09-22T13:42:54+08:00' }), mondayPath), /信息截止时间晚于/u);
assert.throws(() => parseMarketInsight(JSON.stringify({ ...weekendReport, generatedAt: '2026-09-24T13:44:52+08:00' }), mondayPath), /超过 48 小时/u);
console.log('✓ Company report weekend/holiday reference dates and future-date guards');
