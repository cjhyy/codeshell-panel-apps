# Quant Lab v1 技术方案：从"玩具回测器"到"可信研究工作台"

状态：S0–S6 完成（v0.4.1）。信息层级重排 + 盯盘已落地；选股（Spec 2）待做
基线：`b1f9f78`，quant-lab 版本 `0.1.0`（自 `da7748e` 建仓起未迭代）

## 1. 产品目标

把 Quant Lab 从"能算出一个数字"变成"算出的数字可以被相信"。

一句话定位：**本地优先的策略研究工作台，用 agent 承担研究员的解释与证伪工作，而不是再造一个回测引擎。**

不做的事：不做实盘交易、不做撮合/订单路由、不做多因子选股全家桶、不与 VectorBT 比向量化性能。

## 2. 现状证据

结论先行：**引擎不坏，产品不成立。**

实跑验证（`generateDemoBars(520)` + SMA 10/30）：

```
bars: 520  trades: 5
sharpe 3.66 / maxDD -8.8% / calmar 7.40 / profitFactor 11.6
```

引擎、指标、费用滑点、次日开盘成交、止损全部正常工作。3068 行代码中 `engine.mjs` 621 行质量高于多数同类玩具项目。

真正的阻塞项，按严重度：

| # | 问题 | 证据 | 后果 |
|---|---|---|---|
| P0 | **无数据入口** | 唯一来源是 `app.js:657` 的 `workspace.readText`；workspace 内 0 个 CSV | 只能跑 `generateDemoBars()` 的合成随机数，上面那个 3.66 Sharpe 无任何意义 |
| P0 | **未安装** | `~/.code-shell/panel-apps/installed.json` 仅含 design-studio / job-hunt-hq / video-download | 面板里根本看不到入口 |
| P1 | **信号是状态非事件** | `engine.mjs:205` `strategySignals` 中 `enter: fast > slow` 持续为真 | 无法表达"金叉当日买入"，回测语义与业界惯例不一致 |
| P1 | **全仓 all-in + 单标的** | `runBacktest` 每次进场投入全部 cash，无仓位管理 | 无法做组合、无法控制风险敞口 |
| P2 | **单点参数无显著性** | 无 walk-forward、无参数敏感性 | 无法区分"策略有效"与"过拟合" |
| P2 | **Sharpe 无风险利率写死 0** | `engine.mjs:281` `meanDaily / volatility * sqrt(252)` | 高利率环境下系统性高估 |

需要澄清的一点：`app/research/methodology.md` 已经把执行假设、指标定义、数据质量校验写得相当严谨（次日开盘成交、Wilder RSI 平滑、通道排除当前 bar、fingerprint 漂移检测、明确列出未建模的流动性/借券/税费）。**方法论层不是从零开始，缺的是数据层与检验层。**

## 3. 对标结论

| 项目 | 值得借鉴 | 不适合照搬 |
|---|---|---|
| **VectorBT** | 指标体系最完整（Sortino/Omega/tail ratio）；参数网格 + 热力图是其核心卖点，正是我们 P2 的解法 | 向量化架构依赖 numpy 生态，JS 端无对应物 |
| **Backtrader** | 事件驱动的 `next()` 循环、Broker/Sizer/Strategy 三层切分；Sizer 抽象直接解我们的 all-in 问题 | 体量过大，且已停止维护 |
| **QuantConnect / Lean** | 工程化组织：数据、算法、风控分离；样本外与实盘一致性保证 | C# + 云端基建，量级不匹配 |
| **zipline / PyAlgoTrade** | 复权处理与幸存者偏差的处理惯例 | 已基本停更 |
| **AKShare / Tushare / yfinance** | 数据接入事实标准，免费且社区成熟 | Tushare 高频接口需积分 |

**核心判断：回测引擎这一层我们打不过 VectorBT，也不该打。** 差异化在于 VectorBT 们没有的东西 —— agent 就在旁边。manifest 里已声明的 `agent.submitPrompt` 权限是这个产品唯一的护城河。

## 4. 架构

三层切分，与现状的差异用 `+` 标注：

```
数据层  + DataSource（同步/缓存/复权）  →  仓库 CSV
                                            ↓
引擎层    engine.mjs（保留）
        + Sizer（仓位）  + 事件化信号  + Walk-forward
                                            ↓
研究层  + 参数敏感性  + 样本外报告
        + Agent 研究闭环（解释/证伪/生成变体）
```

### 4.1 数据层（已实现，S1 ✅）

**实现偏离原计划**：原设计走 `agent.submitPrompt` 让 agent 跑 Python(AKShare/yfinance)。实测发现本机无 Python 量化库、且不必装 —— 两个市场都能用 **Node 原生 fetch 零依赖**直接拿到,遂改为独立 CLI `app/tools/fetch-market-data.mjs`。这样数据同步不依赖 agent 在场,可脚本化、可 CI、可复现。

| 市场 | 数据源 | 复权 | 实测 |
|---|---|---|---|
| A 股 | Tencent `web.ifzq.gtimg.cn` | qfq / hfq / none | SH600519 1611 bars ✅ |
| 美股 | Yahoo `query1.finance.yahoo.com` | adj / none | AAPL 1669 bars ✅ |

被否决的源:AKShare/Tushare(需装 Python 栈)、东方财富 `push2his`(本机连接失败 `code:000`)、Sina `hq.sinajs.cn`(仅实时快照无历史)。

落地要点:

- 输出 `data/market/<SYMBOL>.csv`,表头 `date,open,high,low,close,volume`,与 methodology 既有契约一致
- 同名 `<SYMBOL>.meta.json` 记录 `adjust` / `source` / `bars` / `fingerprint`
- **复权基准冲突拒绝覆盖**:已存在 `adjust=adj` 的数据集,再用 `adjust=none` 写入会直接报错,需显式 `--force`。混用复权口径是回测最隐蔽的错误来源
- **Tencent 单次响应硬上限 640 根**(与 count 参数无关,已实测),故按窗口向前分页;修复前请求 2020 起只返回 2024 起的 640 根
- Yahoo 的 adjclose 按 `adjclose/close` 比例缩放整条 OHLC,而非只调 close —— 否则会破坏 `high >= close` 不变量
- A 股成交量从"手"换算为"股"(×100)
- 节假日/停牌的 null bar 直接丢弃,不做插值;丢弃计数写入 meta

### 4.2 引擎层（改造）

**信号事件化**：`strategySignals` 返回值增加边沿检测，区分 `enter`（状态）与 `enterSignal`（`!prev && curr` 上升沿）。保留状态语义向后兼容,新增事件语义作为默认。

**Sizer 抽象**（借鉴 Backtrader）：
```js
sizer: { type: "all-in" }                    // 现状,保留为默认
sizer: { type: "fixed-fraction", pct: 20 }   // 固定比例
sizer: { type: "volatility-target", annual: 15 }  // 波动率目标
```

**Sharpe 补风险无风险利率**：`(meanDaily - rfDaily) / vol * sqrt(252)`，`riskFreeRate` 进 execution 配置，默认 0 保持现有结果可复现。

### 4.3 研究层（新增，差异化）

- **参数敏感性热力图**：SMA fast × slow 网格扫描,输出 Sharpe 矩阵。单点参数的 3.66 说明不了任何问题,邻域是否稳定才是
- **Walk-forward**：滚动切分 in-sample 调参 / out-of-sample 验证,报告必须同时给出两个 Sharpe
- **Agent 研究闭环**：回测结果 → agent 读取 → 解释最大回撤区间发生了什么、指出过拟合迹象、生成策略变体做对照。这是 VectorBT 做不到的部分

## 5. 数据契约

`*.quant.json` 在现有 v1 schema 上加字段,升 v2 并保持 v1 可读：

```json
{
  "format": "codeshell.quant-strategy",
  "version": 2,
  "dataset": "data/market/600519.csv",
  "datasetMeta": {
    "adjust": "qfq",
    "source": "akshare",
    "syncedAt": "2026-08-25"
  },
  "sizer": { "type": "fixed-fraction", "pct": 20 },
  "execution": {
    "initialCapital": 100000,
    "feeBps": 5, "slippageBps": 2, "stopLossPct": 8,
    "riskFreeRate": 0.02
  },
  "validation": {
    "mode": "walk-forward",
    "inSampleBars": 504, "outOfSampleBars": 126
  }
}
```

`adjust` 字段缺失时报告必须打醒目警告 —— 这正是 methodology 里"If raw data is used, document that limitation"的机器可执行版本。

## 6. 实施顺序

| 阶段 | 内容 | 验收 |
|---|---|---|
| **S0** ✅ | 安装 quant-lab 到面板 | 已注册进 installed.json，四个 App registry 校验通过 |
| **S1** ✅ | 数据同步（Tencent/Yahoo → CSV + meta，零依赖） | 已达成：SH600519 / AAPL 真实回测跑通 |
| **S2** ✅ | 信号事件化 + Sizer + 无风险利率 | 已达成，v1 配置逐位复现 |
| **S3** ✅ | 参数扫描 + walk-forward | 已达成，输出 IS/OOS 双 Sharpe 与退化度 |
| **S4** ✅ | Agent 证据包 | 已达成，引擎算数字、agent 只解释 |
| **S5** ✅ | UI 接线 | 已达成，Sizer/信号模式/无风险利率/样本外验证全部可视化 |

S1 之前的任何指标都不可信 —— 这是硬门槛,不是排序偏好。

## 7. 验收指标

- 真实行情（非 demo）回测可完整跑通,且 CSV 带显式复权标记
- 同一 `*.quant.json` 两次运行结果逐位一致（沿用现有 fingerprint 机制）
- 报告同时呈现样本内/样本外表现,单给样本内视为不合格
- 参数邻域 Sharpe 方差纳入报告,单点值不再单独展示

## 8. 非目标

- 不做实盘下单、不接券商
- 不追求向量化性能
- 不做分钟级/tick 级（现有 methodology 的日线假设不成立）
- 不做多标的组合优化（v2 再议）
- 不提供投资建议 —— README 现有免责声明保留

## 9. 风险

- **数据源不稳定**：AKShare 依赖网页接口,易失效。缓解:失败降级到已缓存 CSV,不静默回退到 demo 数据
- **合成数据误导**：`generateDemoBars` 产出的高 Sharpe 会让人误判。缓解:demo 模式必须有持续可见的 DEMO 角标(`app.js:301` 已有,需强化)
- **agent 幻觉**：研究结论由 agent 生成,可能编造。缓解:所有数字必须来自引擎结构化输出,agent 只做解释不做计算


## 10. S1 实测结果

真实数据经面板自有引擎（SMA 20/50，fee 5bps，slippage 5bps）跑通：

| 标的 | bars | 区间 | trades | 策略收益 | 买入持有 | Sharpe | maxDD |
|---|---|---|---|---|---|---|---|
| SH600519 | 1611 | 2020-01-02..2026-08-25 | 19 | +66.5% | +49.8% | 0.50 | -44.0% |
| AAPL | 1669 | 2020-01-02..2026-08-24 | 20 | +122.7% | +329.4% | 0.69 | -28.5% |

这组数字的意义不在于策略好坏，而在于**它们终于是真实的**：Sharpe 落回 0.5~0.7 的常识区间，AAPL 上 SMA 择时大幅跑输买入持有（-207pp）——这正是趋势策略在强趋势标的上的典型表现。对比 demo 合成数据给出的 Sharpe 3.66，可见第 9 节"合成数据误导"风险是实在的。

数据质量审计：SH600519 报 1 条 `calendar-gap`（最大 11 天），核对为春节假期，属正确数据而非缺陷；AAPL 零警告。

已验证的失败路径：复权口径冲突拒写、Yahoo 404 未知代码、A 股代码位数校验、非法 `--adjust` 组合、缺失 `--symbol`。


## 11. v0.2.0 交付

### 新增 API（`app/engine.mjs`）

| 导出 | 用途 |
|---|---|
| `parameterGrid` / `parameterSweep` | 参数网格与邻域稳定性（mean/sd/min/max） |
| `walkForward` | 滚动样本外验证，warm-up 前缀 + pooled OOS Sharpe |
| `drawdownEpisodes` | 最深 N 段回撤的起止日期 |
| `researchEvidence` | 汇总证据 + 自动生成 concerns |

`runBacktest` 新增三个可选配置，**全部默认关闭以保持 v1 行为逐位一致**（已由测试断言）：

- `signalMode: "state" | "edge"` —— edge 为上升沿触发，即"金叉当日买入"
- `sizer` —— `all-in`（默认）/ `fixed-fraction` / `volatility-target`
- `riskFreeRate` —— Sharpe 改用超额收益，默认 0

### 关键实现约束

- **不做杠杆**：`volatility-target` 的 `maxLeverage` 上限为 1。引擎无融资模型，允许 >1 会产出无法兑现的收益
- **仓位用信号 bar 计算**（`index - 1`），避免用当日数据决策造成前视偏差
- **参数扫描不因单点非法而中断**：`fast >= slow` 等组合记为 `ok:false` 而非 throw
- **证据包只做汇总不做计算**:所有数字来自引擎,agent 仅负责解释

### 实测:过拟合被成功识别

SH600519 全栈跑(edge + 80% 仓位 + rf 2%):

```
ret 54.0% vs B&H 49.8% | sharpe 0.37
walk-forward IS 0.23 -> OOS -0.57 (degradation 0.81)
concerns: 仅 19 笔交易统计不显著 / Sharpe 样本外下滑 0.81，存在过拟合
```

样本内 0.23 到样本外 -0.57 —— 若只看单次回测的 54% 收益会误判为有效策略。这正是 S3 存在的理由。

### 测试

`scripts/validate.mjs` 新增 4 组断言:v1 回归(逐位一致)、sizer/signalMode/riskFreeRate 契约、walk-forward 与参数扫描、证据包。含 6 条 `assert.throws` 覆盖非法输入。

### 未覆盖

- 面板 UI 未接 walk-forward/扫描入口,新能力目前仅 engine API 可用(UI 属 S5)
- 未做多标的组合
- `data/market/` 行情数据未入库,需各自同步


## 12. Codex review 修复（v0.2.1）

十项问题全部修复，每项均有可复现证据。

### High

**#1 复权口径静默降级** —— `qfq` 请求在缺失时回退 `node.day`，会把未复权价标记成已复权。改为拒绝并报错。修复后立即暴露了真实 bug:分页最后一次请求空区间只返回 `day`,导致整条链路失败 —— 这正是该防护的价值。

**#2 sidecar 与 CSV 未绑定** —— 两处缺陷:(a) fetcher 哈希整个 CSV(含表头),`fingerprintBars` 哈希纯数据行,注释却声称一致。实测 `2231466f` vs `a30f2db1`,**完全不匹配**。已改为复用同一算法,现已实测一致。(b) 面板无条件信任 sidecar。现校验 `format` + `fingerprint`,不匹配则标记 `stale` 并在提示中声明口径不可信。另:写入顺序改为先 sidecar 后 CSV,元信息不可解析时不再当作"无历史数据"绕过冲突检查。

**#3 walk-forward OOS 缺少 warm-up** —— OOS 切片不含指标预热期,样本内选出的参数在样本外因"bars 不足"失败。实测 IS=100/OOS=50 + SMA 5/49:**4 折全废,usableFolds=0,而汇总不报任何异常**。已改为前置 warm-up 前缀(仅取 OOS 之前的数据,不引入未来信息),评分时剔除前缀。修复后 4 折全部可用。

**#4 零交易参数赢得扫描** —— 不交易 → 净值平坦 → Sharpe 0,反而击败真实交易但亏损的候选。实测 0 笔交易(Sharpe 0.00)胜过 2 笔交易(Sharpe -1.18)。已加 `minimumTrades`(默认 1),零交易组合仍可报告但不参与竞选。

### Medium

**#5 OOS Sharpe 实为均值的比率** —— 比率的算术平均 ≠ 合并序列的 Sharpe。已改为 pooled 计算并重命名(`meanOutOfSampleFoldSharpe` / `pooledOutOfSampleSharpe`)。实测差异显著:2.131 vs 2.624。

**#6 波动率目标吞掉 edge 信号** —— 预热不足返回 0 仓位,edge 模式下该信号永不再触发。实测 all-in 2 笔 vs vol-target **0 笔**。已区分"不可用"(null)与"零仓位",且零波动时钳制到 `maxLeverage` 而非除零。修复后两者均为 2 笔。

**#7 分页丢失起始日** —— `nextCursor === from` 时提前退出。已放宽边界,并在 40 页上限触发时打印未获取区间。

**#8 报告丢失复权口径** —— `strategySpec` 增加 `datasetMeta`,`reportMarkdown` 输出复权基准与来源。

**#9 尾部数据静默丢弃** —— 新增 `untestedTailBars` / `testedThrough`,并生成 concern。实测 AAPL 报告"最近 31 根未验证"。

**#10 日期与文件名校验不足** —— `2026-02-31` 这类非法日期会被 `Date.parse` 顺延;美股代码直接用于路径拼接可越界。已改为真实日历校验 + 文件名白名单。

### 测试缺口

- **v1 回归形同虚设**:原测试用"隐式默认 vs 显式默认"对比,同一份新代码,一起回归也能通过。已改为从 `git show HEAD` 取真实 v0.1.0 输出并硬编码(trades=2, finalEquity=156927.753986, sharpe=3.330226)。
- **sizer 断言不纯**:原对比混入了不同的 slippage/stopLoss。已改为仅变更 sizer。
- **app.js 从不被解析**:验证器只 import engine,app.js 语法错误可静默上线 —— 本轮开发中确实发生过一次重复 import。已加 `node --check`,并注入语法错误验证该检查真能拦截。

修复后 `npm run check` 全绿。


## 13. Codex 二轮 review 修复（v0.2.2）

一轮修复引入了新缺陷,二轮复查发现 5 项,全部修复。

**High —— warm-up 前缀会用"未来选出的参数"在过去交易。** 一轮为解决 warm-up 饥饿,把前缀数据一并送进 `runBacktest`,但前缀里也会开仓 —— 那笔仓位用的是样本内结束后才选出的参数。实测第一折评分窗口从 `2023-05-23` 开始,持仓却在 `2023-04-11` 建立。

值得记录的是:我自己的泄漏测试没抓到它。我测的是"改动尾部数据结果是否变化",而这个泄漏在**前缀**,方向相反。已在引擎层加 `tradingFromIndex`:前缀只算指标不下单,净值维持初始资金。修复后建仓日期正好落在 `2023-05-23`。

**Medium —— 默认 warm-up 仍不够长。** 默认取 `min(inSample, outOfSample)`,当 OOS 很短时仍不足。实测 IS=100/OOS=10 + SMA 2/50 全折失败。已改为按参数网格中最长 lookback 计算,修复后 19 折可用。

**Medium —— 跨折交易重复计数。** 已随 High 项一并解决:前缀不再产生交易,计数改为直接取全部成交。

**Low —— 字符串型 riskFreeRate 在 pooled Sharpe 中字符串拼接。** `"0.03"` 使 `1 + rate` 变成 `"10.03"`,pooled Sharpe 从 3.25 变成 -13.25。已在 `walkForward` 入口 `Number()` 强制转换。

**Low —— 合法 JSON 但非对象绕过覆盖保护。** sidecar 为 `null` / `false` / 数组时被当作"无历史数据"。已改为一律视作不可读。

### 新增回归测试

针对本轮每项缺陷都加了断言,其中最关键的一条是逐折校验"**任何成交的建仓日不得早于评分窗口起点**",并验证 warm-up 段净值恒等于初始资金 —— 这是一轮泄漏测试缺失的那个方向。


## 14. S5：UI 接线（v0.3.0）

此前 S2–S4 的能力只有 engine API 可调，面板界面看不到任何新东西。本轮补齐。

### 新增控件

- **SIZING & SIGNAL**：信号模式（状态/事件）、仓位（满仓/固定比例/波动率目标）、无风险利率
- **VALIDATION**：样本内/样本外长度 + 「运行样本外验证」按钮

### 样本外验证面板

五个核心指标（样本内 Sharpe / 样本外 Sharpe / 退化 / 跑赢基准 / 有效折数）+ 逐折明细表 + 自动结论。结论直接引用引擎生成的 concerns，不做二次计算。

### 关键实现细节

- **验证结果会失效**：切换数据集、策略、任何参数都会清空已显示的折数据。否则面板会用旧配置的验证结论描述新配置。
- **HTML 转义用专门函数**：`markdownPlainText` 虽然转义了 `<`/`>`/`&`（安全），但同时会给 markdown 标点加反斜杠，直接塞进 `innerHTML` 会显示成乱码。新增 `escapeHtml`。
- **退化的红绿判断**：退化 = IS − OOS，负值表示样本外反而更好，不该标红。只有 > 0.5 才是警告。（首版写错，截图复核时发现。）
- **扫描前让出主线程**：`setTimeout(0)` 让禁用态先绘制，否则参数网格会卡住 UI 且按钮看起来没响应。

### 浏览器 e2e

新增 `scripts/quant-lab-ui.mjs`（`npm run test:ui:quant-lab`），用 Playwright 真实加载 index.html，走完整链路：加载 CSV → 回测 → 改仓位验证结果确实变化 → 样本外验证 → 改参数验证结果失效 → 保存报告 → 保存策略 → 提交 Agent。断言覆盖报告含样本外章节、spec 含 datasetMeta、prompt 含 walkForward 证据，并检查零 console error。

支持 `QUANT_LAB_CSV` 用真实行情跑，`QUANT_LAB_SHOT` 截图。

### 真实数据验收（AAPL 1669 根）

```
总收益 +152.4% vs 买入持有 +329.4% | Sharpe 0.79 | 最大回撤 -27.0%
样本外验证：38/38 折有效
  样本内 Sharpe 1.48 -> 样本外 0.40（退化 1.09）
  仅 29% 的样本外区间跑赢买入持有
```

38 折逐折明细显示选中参数在 `fast 5/slow 30` 与 `fast 20/slow 100` 之间反复横跳 —— 参数不稳定本身就是过拟合的直接证据。工具现在会主动告诉你策略不行。


## 15. S6：信息层级重排 + 盯盘（v0.4.0）

### 15.1 为什么先修界面

用户反馈"看了量化,还感觉不明确"。复核截图后确认问题不是样式,是**信息层级搞反了**:

- 最大最醒目的数字 `+152.4%` 是**样本内**结果,而样本外 Sharpe 只有 0.40 —— 界面把最不可信的数字放得最大
- 没有一句话结论,看完一屏不知道"所以能不能用"
- 38 行折表占 2/3 屏幕,但真正的信息只有"参数在横跳"这一句
- "退化 1.09"、"Calmar"、"PF" 全是行话,无解释

修复:

| 改动 | 说明 |
|---|---|
| **结论横幅** | 顶部一句话判定(不建议使用/存疑/通过验证/未验证)+ 具体理由 + 建议动作 |
| **样本内标记** | 总收益旁强制显示「样本内」角标,数字不再无限定词呈现 |
| **样本外前置** | 验证面板中样本外 Sharpe 排第一,样本内降为对照 |
| **参数稳定性** | 新增指标,自动计算各折选参的变动率(AAPL 实测 73% → 判定"不稳定") |
| **折表折叠** | 38 行收进 `<details>`,默认只看摘要 |
| **术语悬停** | 六个核心指标 + 五个验证指标全部加 `title` 解释 |

结论横幅的判定逻辑是**纯规则**:数满足几条失败条件(样本外 Sharpe ≤ 0、跑赢基准 < 50%、退化 > 0.5、参数变动 > 60%),≥2 条判"不建议使用",1 条判"存疑"。所有理由都引用引擎算出的具体数值,不做主观描述。

### 15.2 盯盘(Spec 1)

四种提醒规则,全部复用回测的信号逻辑:

- `signal-entry` —— 与回测同一个 `enterSignal` 上升沿
- `rsi-oversold` / `drawdown-from-high` / `price-below`

**关键设计:提醒规则必须可回测。** 用与回测同一套 `strategySignals`,意味着任何提醒规则都能拿去跑 walk-forward,验证它历史上到底准不准。一个无法回测的提醒规则等于无法信任。

其他要点:

- **排序按接近度** —— 触发的排最前,未触发的按"离触发还差多少"排。实测茅台距 252 日高点 -14.6%(阈值 -15%)排在 AAPL -8.7% 前面
- **缺数据不算崩溃** —— 未同步的标的显示"缺少 data/market/XXX.csv,请先同步",而不是整批失败
- **策略快照** —— 添加信号提醒时冻结当前策略参数,之后改面板设置不影响已建提醒
- **每日自动化** —— 通过 `automations.manage` 注册工作日 18:30 任务,prompt 里明确要求"所有数值必须来自 CSV 或引擎计算,不要估算",且只在触发时提醒

manifest 新增 `automations.manage` 和 `notifications.send` 权限。

### 15.3 测试

engine 层新增盯盘断言(4 种规则 + 4 条 throws + 排序 + **提醒与回测在最后一根 K 线上必须一致**)。浏览器 e2e 扩展到覆盖:添加/删除、阈值字段显隐、非法输入拒绝、缺数据报错文案、触发排序、自动化创建与删除、prompt 含标的与约束、结论横幅有判定和动作。

### 15.4 后续:选股(Spec 2)

已实测数据成本:批量报价 200 只/2.4 秒(全市场约 1 分钟),日线历史 2.2 秒/只(8 并发下全市场约 25 分钟,沪深300 约 1.4 分钟)。技术可行。

**但必须先解决幸存者偏差**:腾讯接口只返回当前在交易的股票,用今天的名单回测历史会自动排除退市/ST 标的,导致回测系统性偏高且无法从结果中察觉。解决需要 point-in-time 成分股名单,现有免费源不提供。

因此选股功能的诚实定位是:**可做"今天筛出候选",但历史回测的绝对收益不可信,只有相对排序有参考价值**。这条限制须像复权口径一样写死进报告。


## 16. v0.4.1：股票名称 + 降低信息密度

### 股票名称

此前全流程只有代码没有名称 —— `SH600519` 对人的信息量远低于「贵州茅台」。CSV、meta、界面三处都没有。

修复:`fetch-market-data.mjs` 同步时一并抓取名称写入 sidecar 的 `name` 字段。A 股走腾讯实时报价接口(**GBK 编码,必须显式 `TextDecoder("gbk")` 解码**,否则名称全是乱码),美股走 Yahoo 的 `longName`。抓取失败不影响价格数据,只是退回显示代码。

界面两处使用:标题区显示名称、代码降为副标题;关注列表每行显示名称 + 小号代码。

实测:`贵州茅台` / `Apple Inc.` 均正确解析。

### 信息密度

用户反馈"数据太多"。逐笔交易记录(8 列 × N 行)和次级指标是参考材料不是结论,已收进 `<details>`。配合此前折叠的 38 折明细,首屏从"三张大表"变成"结论 + 关键指标 + 图 + 关注列表"。

### 测试

e2e 新增:标题区显示名称、代码保留为副标题、关注列表显示名称 + 代码。其中 sidecar 的 fingerprint **用引擎真实计算**而非硬编码 —— 面板只信任指纹匹配的 sidecar,写死假值只会走到 stale 分支,测不到名称路径。


## 17. M4：自动资讯与官方申报（v0.5.0 / Round 14）

M4 新增严格纯模块 `news-feed.mjs`、零依赖 `fetch-news.mjs` 与资讯页控制器。项目文件固定为
`data/news/subscriptions.json`、`cache.json`、`feed.json`、`notified.json`；四者都有 format/version、
未知字段、大小、时间、URL、fingerprint 与数量上限校验。CLI 只承诺单文件临时文件 + fsync + rename，
不把 cache/feed 两次 rename 伪称为跨文件事务；面板写订阅/通知账本走 Host create-only/条件写 + reread。

去重先在同一 symbol 内按 source id / URL，再按规范标题 + 6 小时时窗聚类。同标题不同公司不会合并；
主卡优先 SEC 官方层级、同层取更新事实，全部来源保留在 occurrences。东财个股请求 symbol 与 7×24
`stockList`、SEC ticker→CIK/accession 都是 confirmed；标题猜测最多 weak，禁止自动通知。远端 HTML
转纯文本，外部字符串只进 `textContent`，automation prompt 不含标题；外链在 app allowlist 后才调用
Host `external.open`。

自动化使用两个 M4 专用任务（A 股 10:10/15:10；美股 SEC 周二至周六 06:35，均
Asia/Shanghai），不修改 M3 watch 任务。市场为空不建，单边失败保留另一边，drift 可更新，orphan
可关闭。Host 强制 full、绑定 session；UI 披露设备在线与网络依赖。通知只按订阅/confirmed/新鲜度/
持久 ledger 筛选，账本写后核对成功才发送事实文案；写失败零通知。

Round 15（Claude Code review/fixer）：账本记录新增 `state: pending|sent` 与 `attempts`，幂等键
`itemId:fingerprint`；面板协议为 claim pending → send → mark sent，send 失败保持 pending 并在下次
加载重试（上限 3 次），不会把未送达误标为已通知；automation prompt 不再要求定时 agent 通知或改写账本
（core 定时会话没有通知工具）。`feed.json` 新增 `cacheFingerprint` 绑定 cache 代数，`fetch-news.mjs`
用 `newsFeedMatchesCache` 判定撕裂对并在 summary 输出 `previousFeedTorn`。URL allowlist 拒绝非默认
端口；7×24 行的 http 文章链接与个股一致，只重建精确 `finance.eastmoney.com/a/*.html` HTTPS 路由。

### 2026-08-26 06:52–06:54 Asia/Shanghai 只读源 smoke

- curl：东财个股 HTTP 200 / `application/json;charset=UTF-8` / 752 bytes（pageSize=2）；实测字段为
  `Art_ShowTime/Art_Code/Art_Title/Art_Url`，源仍返回 `http://finance.eastmoney.com/a/...`，adapter 只对
  精确 allowlisted `/a/<id>.html` 路由重建 HTTPS，不做通用盲升。
- curl：东财 7×24 HTTP 200 / JSON / 2346 bytes（pageSize=2，显式 `sortEnd=`）；实测 `stockList`
  是 `"0.002169"` 这类字符串数组，不是固定对象，adapter 只接受 `0|1 + 六位代码`。本次以
  SH600519 过滤得到 0 条明确关联，诚实保留为成功空结果，不推断“无新闻”。
- curl：SEC Apple submissions HTTP 200 / `application/json` / 164439 bytes，使用描述性 User-Agent。
- 随后以内存 `runNewsFetch`（未写 workspace data 文件）跑 SH600519 + AAPL：eastmoney-stock ok/20、
  eastmoney-724 ok/0 confirmed、sec-edgar ok/20，feed 40；只证明该时点响应与 parser 契约，不代表 SLA。

离线门禁覆盖三源 fixture、每源失败保旧、429/timeout/body cap/bad JSON/redirect/lock、schema/path/URL、
confirmed/weak/unlinked、不同 symbol 隔离、通知 ledger fail-closed。真实浏览器 e2e 覆盖启用、A/US
partial/drift/orphan、M3 任务不变、stale/partial、XSS/提示注入、外链、过滤、320px 和 console clean。
今日页本轮未接“新资讯 N 条”，避免改变已批准的 P0/真实 watch 优先级。

## 18. M5：笔记与复盘（v0.5.0 / Round 16–17）

- 文件：`app/notes.mjs`（schema/fingerprint/link 解析/时间线/事实计数，浏览器与 CLI 共用，大小用
  `TextEncoder` 校 480 KiB）、`app/notes-store.mjs`（`workspace.list → readText → 严格解析 → 条件写
  `expectedModifiedAt` + `expectedRevision` → reread 核对`；create-only、list→write race、revision、
  文件突然出现、workspace epoch 均 fail closed 并回传 draft）、`app/modules/notes-ui.mjs`（DOM 全
  `textContent`，保存 in-flight guard，冲突后重读基线保留草稿）。
- 权威路径固定 `portfolio/journal.json`，与 `transactions.json`/`holdings.json` 同目录但互不读写；
  `format:"codeshell.journal"`、`version:1`，unknown 字段/重复 id/非严格 ISO/非法 JSON 拒读。
- 关联只存稳定 id 与证据版本：instrument(symbol+market)、transactionId、newsItemId+fingerprint、
  ruleId+evidenceAsOf；解析结果 current/changed/orphan，不级联删除。instrument/transaction 无证据版本。
- 诚实缩约：无 outcome/reviewAt/positionReviewResult；P3 决策结果规则保持
  `unavailable · decision-outcome-schema-not-implemented`。截图导入/schemaVersion 2/F5 未触碰。
- 门禁：`scripts/quant-lab-notes.mjs`（schema/link/timeline/store：create、update、delete、create race、
  外部改写冲突、过期 revision、epoch 作废）+ `scripts/quant-lab-ui.mjs` M5 段（四类入口预填、XSS、
  编辑、冲突保留草稿并重读后再次保存成功、删除回链计数、320px、零 console）。
