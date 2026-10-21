import { BACKTEST_ENGINE_RELEASE, analyzeDataset, fingerprintBars, generateDemoBars, researchEvidence, runBacktest, walkForward } from "./engine.mjs";

export const RESEARCH_WORK_LIMIT = 20_000_000;
export const RESEARCH_PRESETS = Object.freeze([
  { id: "trend-sma", title: "SMA 趋势", description: "快均线高于慢均线时持有；实验规则，不承诺收益。", strategy: { type: "sma-cross", fast: 20, slow: 60 }, ranges: { fast: [10, 20, 30], slow: [50, 60, 90] } },
  { id: "rsi-reversion", title: "RSI 回归", description: "超卖买入、超买卖出；下跌趋势可能持续亏损。", strategy: { type: "rsi-reversion", period: 14, oversold: 30, overbought: 70 }, ranges: { oversold: [25, 30], overbought: [65, 70] } },
  { id: "breakout-channel", title: "通道突破", description: "突破前期最高价买入、跌破前期最低价卖出；可能反复假突破。", strategy: { type: "breakout", lookback: 55 }, ranges: { lookback: [20, 40, 55] } },
]);
const fail = (code, message) => Object.assign(new Error(message), { code });
const md = value => String(value ?? "未知").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]).replace(/([\\`*_[\]{}|#!])/g, "\\$1");
const amount = value => Number.isFinite(value) ? value.toFixed(2) : "未知";
const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "未知";

export function researchPreset(id, market = "cn") {
  const preset = RESEARCH_PRESETS.find(item => item.id === id);
  if (!preset || !["cn", "us"].includes(market)) throw fail("INVALID_INPUT", "未知预设或 market（cn/us）");
  return { configuration: { strategy: { ...preset.strategy }, initialCapital: 100000, feeBps: market === "cn" ? 5.5 : 1, slippageBps: market === "cn" ? 10 : 5, stopLossPct: 0, maxHoldingDays: 0, riskFreeRate: 0, sizer: { type: "all-in" }, signalMode: "state" }, ranges: structuredClone(preset.ranges) };
}

/** Only a missing file is optional; callers must propagate read/security errors. */
export function parseResearchMetadata(text, bars) {
  let meta;
  try { meta = JSON.parse(text); } catch { throw fail("INVALID_INPUT", "数据侧车不是有效 JSON"); }
  if (!meta || typeof meta !== "object" || Array.isArray(meta) || meta.format !== "codeshell.quant-dataset" || typeof meta.fingerprint !== "string") throw fail("INVALID_INPUT", "数据侧车格式无效");
  for (const field of ["source", "adjust", "syncedAt", "name", "symbol", "currency", "provider"])
    if (meta[field] !== undefined && (typeof meta[field] !== "string" || meta[field].length > 2000)) throw fail("INVALID_INPUT", `数据侧车 ${field} 无效`);
  if (meta.syncedAt && !Number.isFinite(Date.parse(meta.syncedAt))) throw fail("INVALID_INPUT", "数据侧车 syncedAt 不是有效时间");
  return { ...meta, stale: meta.fingerprint !== fingerprintBars(bars) };
}

function ruleDescription(configuration) {
  const s = configuration.strategy;
  const rules = s.type === "sma-cross" ? { buy: `最近 ${s.fast} 根的平均收盘价高于最近 ${s.slow} 根的平均收盘价`, sell: `最近 ${s.fast} 根的平均收盘价低于或等于最近 ${s.slow} 根的平均收盘价` }
    : s.type === "rsi-reversion" ? { buy: `RSI（衡量最近涨跌力度、周期 ${s.period} 根，采用 Wilder 平滑）低于 ${s.oversold}`, sell: `RSI 高于 ${s.overbought}` }
    : { buy: `收盘价超过此前 ${s.lookback} 根最高价（不含当根）`, sell: `收盘价跌破此前 ${s.lookback} 根最低价（不含当根）` };
  const mode = configuration.signalMode === "edge" ? "仅条件刚出现的边沿信号" : "条件持续成立的状态信号";
  return { buy: `${rules.buy}时，按${mode}在下一根开盘买入。`, sell: `${rules.sell}时，按${mode}在下一根开盘卖出。${configuration.maxHoldingDays > 0 ? `持有达到 ${configuration.maxHoldingDays} 根也在开盘卖出。` : ""}${configuration.stopLossPct > 0 ? `已持仓后按入场成交价下跌 ${configuration.stopLossPct}% 检查当根最低价，取开盘与止损价较低者并扣滑点。` : "未启用止损。"}期末剩余持仓按末根收盘强平并扣滑点及费用。`, timing: "收盘信号、下一根开盘成交；允许零碎股，单向做多；入场当天不检查止损。" };
}

function actualDrawdown(equity) {
  let peak = equity[0], worst = { pct: 0, amount: 0, peakValue: peak.value, troughValue: peak.value, peakDate: peak.date, troughDate: peak.date };
  for (const point of equity) {
    if (point.value >= peak.value) peak = point;
    const pct = peak.value > 0 ? point.value / peak.value - 1 : 0;
    if (pct < worst.pct) worst = { pct, amount: peak.value - point.value, peakValue: peak.value, troughValue: point.value, peakDate: peak.date, troughDate: point.date };
  }
  return worst;
}

export function buildResearchReport({ bars, preset, configuration, ranges, market = "cn", options = {}, metadata = null, path = null, synthetic = false } = {}) {
  if (Boolean(preset) === Boolean(configuration)) throw fail("INVALID_INPUT", "preset 与 configuration 必须且只能提供一个");
  if (preset && ranges) throw fail("INVALID_INPUT", "预设已包含 ranges，不能同时覆盖 ranges");
  if (preset) ({ configuration, ranges } = researchPreset(preset, market));
  ranges ??= Object.fromEntries(Object.entries(configuration.strategy).filter(([key]) => key !== "type").map(([key, value]) => [key, [value]]));
  bars ??= synthetic ? generateDemoBars(520) : null;
  if (!Array.isArray(bars) || !bars.length || bars.length > 100000) throw fail("INVALID_INPUT", "需要 1–100000 根行情");
  const inSampleBars = options.inSampleBars ?? 504, outOfSampleBars = options.outOfSampleBars ?? 126;
  if (!Number.isInteger(inSampleBars) || inSampleBars < 30 || inSampleBars > 100000 || !Number.isInteger(outOfSampleBars) || outOfSampleBars < 10 || outOfSampleBars > 100000 || (options.warmupBars !== undefined && (!Number.isInteger(options.warmupBars) || options.warmupBars < 0 || options.warmupBars > 100000))) throw fail("INVALID_INPUT", "无效的样本内/外或预热长度");
  const combinations = Object.values(ranges).reduce((n, values) => n * (Array.isArray(values) ? values.length : 0), 1);
  if (!Object.keys(ranges).length || combinations < 1 || combinations > 4096) throw fail("INVALID_INPUT", "ranges 需要 1–4096 组参数");
  const allowedFields = { "sma-cross": ["fast", "slow"], "rsi-reversion": ["period", "oversold", "overbought"], breakout: ["lookback"] }[configuration.strategy.type];
  if (!allowedFields || Object.keys(ranges).some(key => !allowedFields.includes(key)) || Object.values(ranges).some(values => values.length > 64 || values.some(value => !Number.isFinite(value)))) throw fail("INVALID_INPUT", "ranges 与策略类型不一致或含无效数字");
  const folds = Math.max(0, Math.floor((bars.length - inSampleBars) / outOfSampleBars));
  // Conservative upper bound includes the full run, each training grid and each
  // scored fold plus at most the entire training window as indicator warm-up.
  const work = bars.length + folds * (combinations * inSampleBars + inSampleBars + outOfSampleBars);
  if (work > RESEARCH_WORK_LIMIT) throw fail("WORK_LIMIT", "研究计算量超限，请减少数据/参数网格或样本长度");
  const result = runBacktest(bars, configuration);
  const walk = folds ? walkForward(bars, configuration, ranges, options) : null;
  const evidence = researchEvidence(result, { walkForward: walk });
  const fee = configuration.feeBps / 10000, slip = configuration.slippageBps / 10000;
  const costs = result.trades.reduce((total, trade) => {
    const entry = trade.shares * trade.entryPrice, exit = trade.shares * trade.exitPrice;
    total.feesPaid += (entry + exit) * fee;
    total.slippageCost += entry * slip / (1 + slip) + exit * slip / (1 - slip);
    return total;
  }, { feesPaid: 0, slippageCost: 0 });
  if (!Number.isFinite(costs.feesPaid) || !Number.isFinite(costs.slippageCost)) throw fail("INVALID_INPUT", "模型成本金额超出可表示范围");
  const sizing = configuration.sizer?.type === "fixed-fraction" ? `每次投入可用现金的 ${configuration.sizer.pct}%` : configuration.sizer?.type === "volatility-target" ? `按历史波动调整仓位，目标年波动 ${configuration.sizer.annual}%，最高现金比例 ${(configuration.sizer.maxLeverage ?? 1) * 100}%` : "每次投入全部可用现金";
  const metaKnown = metadata?.format === "codeshell.quant-dataset" && metadata?.fingerprint === fingerprintBars(bars) && !metadata.stale;
  const data = { path, synthetic, bars: bars.length, from: bars[0].date, to: bars.at(-1).date, fingerprint: fingerprintBars(bars), source: synthetic ? "系统合成演示（非真实行情）" : metaKnown ? metadata.source || metadata.provider || "未知" : "未知", adjust: synthetic ? "不适用（合成数据）" : metaKnown ? metadata.adjust || "未知" : "未知", syncedAt: synthetic ? "不适用（离线生成）" : metaKnown ? metadata.syncedAt || "未知" : "未知", warnings: analyzeDataset(bars).warnings.map(item => item.message) };
  if (!synthetic && !metaKnown) data.warnings.push(metadata ? "侧车与 CSV 指纹不一致，来源/复权/同步时间未采用" : "缺少侧车，来源/复权/同步时间未知");
  const outOfSample = { ran: Boolean(walk), status: !walk ? "insufficient_data" : walk.usableFolds ? "completed" : "no_usable_folds", neededBars: inSampleBars + outOfSampleBars, usableFolds: walk?.usableFolds ?? 0, failedFolds: walk?.failedFolds ?? 0, folds: walk?.folds ?? [], meanFoldReturn: walk?.usableFolds ? walk.folds.filter(item => item.ok).reduce((n, item) => n + item.outOfSampleReturn, 0) / walk.usableFolds : null, beatBenchmarkRate: walk?.beatBenchmarkRate ?? null, pooledOutOfSampleSharpe: walk?.pooledOutOfSampleSharpe ?? null, degradation: walk?.degradation ?? null, untestedTailBars: walk?.untestedTailBars ?? bars.length, testedThrough: walk?.testedThrough ?? null, note: "各折重新从初始本金开始；折均收益是算术平均，不是连续账户或复利实盘；仅训练段选参数，未用全样本最优参数冒充样本外。" };
  const limitations = ["下一根开盘按固定滑点成交；费用在买卖两侧按成交额收取，是研究假设，不是已核实的实时税率。", "允许零碎股；未建模 100 股手数、涨跌停无法成交、最低佣金、买卖费率不对称、流动性与市场冲击。", "入场当天不检查止损；已有仓位才检查当根最低价，日线无法还原盘中路径。", "期末按收盘价并扣滑点及费用强平。", "买入持有基准从首根收盘开始，未扣费，与策略的成交/成本口径不同。", "样本外各折本金重置；未测试尾部不包含在样本外结论中。", "参数搜索存在选择偏差，没有多重检验校正；本报告主结果使用指定规则，不使用全样本最优参数。", "复权取决于绑定侧车；缺少侧车即未知。指纹仅发现数据变化，不能证明来源。", "未建模退市、幸存者偏差及完整公司行动。"];
  if (data.adjust === "none") limitations.push("该数据声明未复权；分红/拆股等公司行动可能扭曲收益与信号。");
  if (synthetic) limitations.unshift("本报告使用合成演示数据，非真实行情、非真实绩效。");
  const concerns = [];
  if (result.trades.length < 30) concerns.push({ code: "few_trades", text: `仅 ${result.trades.length} 笔平仓交易，不足以形成稳定统计判断。` });
  if (!walk) concerns.push({ code: "oos_not_run", text: `样本外没跑：需要至少 ${inSampleBars + outOfSampleBars} 根，当前 ${bars.length} 根。` });
  if (walk?.failedFolds) concerns.push({ code: "failed_folds", text: `${walk.failedFolds} 折失败，不能将其当作成功验证。` });
  if (walk?.untestedTailBars) concerns.push({ code: "untested_tail", text: `最近 ${walk.untestedTailBars} 根未进入样本外评分。` });
  if (result.metrics.totalReturn <= result.metrics.benchmarkReturn) concerns.push({ code: "under_benchmark", text: "策略总收益未超过未扣费的买入持有基准。" });
  if (walk?.degradation > 0.5) concerns.push({ code: "degradation", text: "样本外 Sharpe 比训练段均值下降较多，参数可能过拟合。" });
  if (synthetic || data.source === "未知" || data.adjust === "未知") concerns.push({ code: "data_limits", text: "演示或来源/复权未知，不能据此作现实投资结论。" });
  const report = { format: "codeshell.quant-research-report", version: 1, engine: BACKTEST_ENGINE_RELEASE, preset: preset || null, configuration, ranges, options: { inSampleBars, outOfSampleBars, ...(options.warmupBars !== undefined ? { warmupBars: options.warmupBars } : {}) }, verdict: { tier: concerns.length || !walk?.usableFolds ? "insufficient_evidence" : "worth_more_research", reasons: concerns.map(item => item.text) }, rules: ruleDescription(configuration), money: { initialCapital: configuration.initialCapital, sizing: `${sizing}；允许零碎股，不借款。`, ...costs, feeBps: configuration.feeBps, slippageBps: configuration.slippageBps, costBasis: "按每笔实际 shares×成交价还原双边费用；滑点以入场价/(1+s)、出场价/(1-s)还原未滑点参考价，金额在引擎假设内准确；不是现实总成本。", feeAssumption: preset ? (market === "cn" ? "双边各 5.5bps，滑点各 10bps，纯研究假设；不宣称当前税费。" : "双边各 1bps，滑点各 5bps，纯研究假设。") : "用户显式指定双边同费率研究假设。" }, outcome: { finalEquity: result.metrics.finalEquity, pnl: result.metrics.finalEquity - configuration.initialCapital, totalReturn: result.metrics.totalReturn, maxDrawdown: actualDrawdown(result.equity), trades: result.trades.length, winRate: result.metrics.winRate, worstTrade: result.trades.length ? result.trades.reduce((a, b) => a.pnl < b.pnl ? a : b) : null }, benchmark: { kind: "buy-and-hold", return: result.metrics.benchmarkReturn, finalEquity: result.benchmark.at(-1).value, note: "首根收盘买入并持有到末根收盘，未扣费用/滑点；与策略成交和成本口径不同。" }, outOfSample, sweep: { ran: false, note: "未做全样本最优参数筛选；样本外每折仅在其训练段扫描。" }, data, limitations, concerns, evidence, whyNotFuture: "这是有限历史数据上的规则实验。行情结构、成本和可成交性会变化，参数选择和数据偏差可能夸大结果；历史盈利及样本外表现均不能保证未来收益。", work: { barEvaluationsUpperBound: work, limit: RESEARCH_WORK_LIMIT } };
  report.markdown = researchReportMarkdown(report);
  return report;
}

export function researchReportMarkdown(r) {
  const d = r.outcome.maxDrawdown;
  return ["# 量化白话研究报告", r.data.synthetic ? "**合成演示 · 非真实行情 · 非真实绩效**" : "历史行情规则实验；非收益预测。", `数据：${md(r.data.path || "演示")} · ${r.data.bars} 根 · ${r.data.from} → ${r.data.to}`, `来源：${md(r.data.source)}；复权：${md(r.data.adjust)}；同步：${md(r.data.syncedAt)}；指纹：${md(r.data.fingerprint)}`, "\n## 规则何时买卖", r.rules.buy, r.rules.sell, r.rules.timing, "\n## 本金、仓位与盈亏", `本金 ${amount(r.money.initialCapital)}；${r.money.sizing}`, `期末 ${amount(r.outcome.finalEquity)}；盈亏 ${amount(r.outcome.pnl)}（${percent(r.outcome.totalReturn)}）；${r.outcome.trades} 笔平仓交易。金额与输入价格使用相同币种。`, `最差回撤 ${percent(d.pct)}：从 ${d.peakDate} 的 ${amount(d.peakValue)} 降到 ${d.troughDate} 的 ${amount(d.troughValue)}，实际峰谷损失 ${amount(d.amount)}。`, `双边费用 ${r.money.feeBps}bps；滑点每侧 ${r.money.slippageBps}bps；模型费用 ${amount(r.money.feesPaid)}，模型滑点成本 ${amount(r.money.slippageCost)}。`, r.money.feeAssumption, r.money.costBasis, "\n## 同期买入持有", `收益 ${percent(r.benchmark.return)}，期末 ${amount(r.benchmark.finalEquity)}。${r.benchmark.note}`, "\n## 样本外验证", r.outOfSample.ran ? `已运行；有效 ${r.outOfSample.usableFolds} 折、失败 ${r.outOfSample.failedFolds} 折；各折平均收益 ${percent(r.outOfSample.meanFoldReturn)}；胜基准比例 ${percent(r.outOfSample.beatBenchmarkRate)}；未测尾部 ${r.outOfSample.untestedTailBars} 根。` : `没跑：样本不足，需要 ${r.outOfSample.neededBars} 根，当前 ${r.data.bars} 根。`, r.outOfSample.note, r.sweep.note, "\n## 资料问题与限制", ...r.data.warnings.map(item => `- ${md(item)}`), ...r.concerns.map(item => `- ${item.text}`), ...r.limitations.map(item => `- ${item}`), "\n## 为什么不代表未来收益", r.whyNotFuture, `引擎 ${r.engine.version}；研究结论：${r.verdict.tier === "insufficient_evidence" ? "证据不足" : "仅值得继续研究"}。`].join("\n");
}
