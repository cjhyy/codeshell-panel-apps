# 投资工作台 v1 PRD：从「量化实验室」到「投资工作台」

> 状态：**Draft for review** — Round 3 Claude Code 复审已收敛（2026-08-26）；进入实现前须经用户评审<br>
> 产品版本：目标 0.5.0（当前已落地 0.4.1，见 `apps/quant-lab/app/TECHNICAL-PLAN-v1.md`）<br>
> 文档范围：定位、信息架构、六模块逐页 PRD、Host API 边界、数据模型、组合核算、公司行动、资讯架构、笔记复盘、提醒时区、迁移兼容、测试策略、实施分期与验收<br>
> 不包含：视觉稿、实现代码、schemaVersion 2 截图导入的实现细节（仅定边界）

---

## 1. 背景

quant-lab 面板经过 S0–S6 七轮迭代（v0.4.1）已经是一个可信的**策略研究工具**：真实行情同步（腾讯/Yahoo，显式复权口径）、事件化信号、仓位管理、walk-forward 样本外验证、参数扫描、结论横幅、盯盘提醒，`npm run check` 与 `npm run test:ui:quant-lab` 双测试链全绿。

但它回答的问题始终是「这个策略可不可信」，而用户每天真正的问题是：

- 我的持仓现在怎么样了？赚了还是亏了？亏在哪只上？
- 今天两个市场（A 股、美股）有什么与我持仓相关的事？
- 我上次为什么买它？当时的判断兑现了吗？
- 现在最值得看一眼的是什么？

回测引擎解决不了这些问题——它们需要**账本、资讯、笔记**三类新能力，以及一个把它们组织起来的首页。因此本次改版把产品从「量化实验室」重定位为「投资工作台」：量化能力不删一行，整体收进「研究」模块，成为工作台的一个证据工具；工作台的主线变成「今日 → 持仓 → 决策 → 复盘」。

## 2. 定位与核心承诺

### 2.1 定位

**本地优先的个人投资决策工作台**：A 股为主、美股为辅，持仓账本、行情、资讯、研究、笔记全部落在仓库文件里，引擎算数字，agent 只解释。

一句话：帮一个同时持有 A 股和美股的个人投资者，把「看盘、记账、读资讯、做研究、写复盘」收进一个可信的本地面板。

### 2.2 目标用户

单一角色：个人投资者，持仓 5–30 只，A 股为主 + 少量美股，手动记账可接受，重视「数字可信」高于「功能多」。不服务机构、不服务日内交易者。

### 2.3 核心承诺

用户打开面板 5 秒内知道：

1. 现在是什么市场时段，数据新鲜到什么时候（每个数字都带数据时间）；
2. 持仓总体和单只的真实盈亏——亏损与盈利同等醒目；
3. 今天有没有触发的提醒和与持仓相关的资讯；
4. 每个结论的数字来自引擎哪个函数、基于哪份文件、什么口径。

## 3. 目标与非目标

### 3.1 目标

1. 显示名改为「投资工作台」，面板 id 保持 `quant-lab`，已安装用户经「Update from source」无损升级。
2. 六模块：今日 / 持仓 / 关注 / 研究 / 资讯 / 笔记；今日为首页。
3. 持仓手动录入起步；含账户、标的主数据与流水的 `portfolio/transactions.json` 为唯一权威，`portfolio/holdings.json` 只是带指纹的可重建缓存。
4. 组合核算：严格日 TWR 与 MWR（XIRR）并列；只比较同为年化的口径（跨度 ≥365 自然日才年化），差值使用中性名称“收益口径差”；集中度用归一化 HHI；本币价格、收入与汇率损益按恒等式拆分。时间语义唯一：每个自然日 `16:30 Asia/Shanghai` 一个检查点，观测按其“可得瞬间”而非日期字符串进入检查点（第 8.2 节）。
5. 资讯为自动推送信息流：A 股采用经本轮复测可达的东方财富个股与 7×24，美股采用 SEC 官方申报；抓取走零依赖 CLI，定时执行走 M4 专用的 A/US 两个独立 automations，来源失败不影响其余模块。联网只需用户在资讯页做一次性启用（条件写订阅文件 + 按非空市场创建任务），之后不需要任何手动操作。Yahoo RSS 不纳入自动资讯；v1 没有美股“新闻”源，界面明示美股仅覆盖官方申报。M4 不修改 M3 的关注提醒任务。
6. 笔记与持仓/交易/标的关联，决策可复盘，决策失误与亏损持仓同等呈现。
7. 现有量化面板（回测/验证/报告/策略保存）**整体**进入研究模块，功能与测试零回归；关注模块基本沿用现有盯盘。
8. `npm run check` 与 `npm run test:ui:quant-lab` 全程保持绿色。

### 3.2 非目标

- 不做港股（明确决策，标的校验层直接拒绝 `HK` 前缀与 5 位港股代码）。
- 不做实盘下单、不接券商 API、不提供投资建议。
- 不做基金/债券/期权/卖空/融资，v1 资产类型仅 A 股、美股普通股 + CNY/USD 现金。
- 不做截图导入持仓——这需要 manifest `schemaVersion: 2` 声明 panel agent tool，属于 v2（见 14.4）。
- 不做税务申报口径。尤其不得把本产品的移动加权成本当作美股税务成本；美国普通股票税务通常需要 specific identification 或 FIFO，平均成本适用范围有限。
- 不重写回测引擎：`engine.mjs` 已导出 `parseOhlcvCsv` / `runBacktest` / `walkForward` / `parameterSweep` / `researchEvidence` / `evaluateWatchItem` / `rankWatchResults` / `analyzeDataset` / `fingerprintBars`，全部复用。
- 不在面板内直连外部网络：所有抓取沿用现状——零依赖 Node CLI 写仓库文件、面板经 `workspace.readText` 读取（与 `app/tools/fetch-market-data.mjs` 同构）。不虚构 host API。

## 4. 设计原则

1. **引擎算数字，agent 只解释。** 任何呈现的数值必须来自 `engine.mjs` 或新增 `portfolio.mjs` 的结构化输出；agent prompt 一律附引擎证据并声明「不要自行重算」（沿用 `app.js` 中 `submitAgentRequest` 的既有模式）。
2. **先分类，再使用。** 每条规则必须标为“可回测”“可历史复算”或“只能静态审计”。只有定义了完整入场、退出和评价目标的规则才叫可回测；能重放触发点但不能评价预测价值的规则不得冒充回测。
3. **口径显式。** adjust / purpose / fingerprint / stale / source / 数据时间随数据走：CSV 有 sidecar、报价逐标的有 quoteTime、资讯逐源有 lastAttemptAt/lastSuccessAt 且条目有 publishedAt、账本有 transactionsFingerprint。
4. **不给投资建议。** 所有提示只说明触发条件、数值、数据时间与限制；免责声明保留。
5. **亏损与失误同等呈现。** 亏损持仓与盈利持仓同布局同字号，默认按盈亏绝对值排序；决策失误在笔记复盘中与正确决策同等展示，不允许默认折叠负面信息。
6. **两套价格口径永不混用。** 复权价（`data/market/`）只用于研究回测；账本历史估值只用通过 `purpose=portfolio-valuation` 校验的未复权价（`data/market-raw/`）与交易/公司行动事件。实时报价只用于“当前/当日”卡片，不回填历史 TWR。见第 9 节边界表。
7. **无建议动作。** 状态、规则、资讯、研究结论都只能描述证据与限制；禁止出现“买入/卖出/加仓/减仓/投入真钱/小仓位试跑/考虑买入持有”等动作性输出。现有研究页包含这类文案，M0 必须迁移，不能以“零功能改动”为由保留。

## 5. 信息架构与全局框架

### 5.1 六模块结构

```text
今日（首页）
├── 市场时段状态（A 股 / 美股，含数据时间）
├── 持仓速览（总市值 / 当日变动 / TWR·XIRR 摘要）
├── 触发的提醒（来自关注模块规则）
├── 持仓相关资讯 Top N
└── 待复盘笔记

持仓
├── 组合概览（市值 / 成本 / TWR / XIRR / 差值 / HHI / 币种拆分）
├── 持仓明细表（盈亏对称呈现）
├── 交易录入（手动）
├── 交易流水
└── 持仓分析（纯规则结论 + agent 解释入口）

关注（现有盯盘整体迁入，基本不动）
├── 关注列表 + 四种提醒规则
├── 立即检查 / 每日提醒
└── （新增）一键把关注标的加入资讯抓取范围

研究（现有量化面板整体迁入，零改动优先）
├── 数据加载 / 策略 / 执行 / 仓位与信号 / 验证
├── 结论横幅 / 指标 / 图表 / 样本外验证 / 交易记录
└── 保存策略 / 保存报告 / Agent 审查

资讯（自动推送信息流）
├── 持仓与关注标的的个股资讯（按标的分组）
├── 市场快讯（7×24，仅保留与组合相关条目）
└── 源状态与数据时间（stale / 失败原因可见）

笔记
├── 决策记录（买/卖理由，关联交易与标的）
├── 复盘（到期提示，结论 vs 实际结果）
└── 想法（自由笔记，可关联标的）
```

### 5.2 导航与全局框架

- **顶栏**：品牌区（「投资工作台」+ 副标题 INVESTMENT DESK）、六个 tab（今日为默认激活）、Agent 按钮（现有 `#ask-agent` 保留原位）。现有顶栏的 CSV 路径加载器（`#data-path` / `#load-data`）移入研究 tab 顶部——它是研究的数据入口，不是全局入口。
- **实现方式**：单 `index.html` 内六个 `<section data-module>`，tab 切换用 `hidden` 属性 + `aria-selected`，复用现有 chart-tabs 的键盘导航模式（`app.js` 中 `activateChartTab` 的 roving tabindex 实现）。不引入路由库。
- **状态记忆**：当前激活 tab 存入面板 storage（沿用 `scopedStorageKey` 按 workspace 隔离），下次打开回到上次模块。
- **工作区切换**：沿用现有 `workspaceEpoch` 机制——切换 workspace 时清空账本、资讯、笔记的内存态并重新从新仓库读取，正在进行的写操作按 epoch 作废。

### 5.3 manifest 变更

`apps/quant-lab/.codeshell-panel/panel.json`（`schemaVersion` 保持 1）：

```json
{
  "id": "quant-lab",
  "version": "0.5.0",
  "title": { "default": "投资工作台", "en": "Investment Desk", "zh-CN": "投资工作台" }
}
```

M0 没有资讯外链，因此不提前扩权，保留既有 `workspace.read/write`、`storage`、`agent.submitPrompt`、`automations.manage`、`notifications.send`。M4 真正渲染资讯外链时才新增 `external.open`（已核对宿主 `PANEL_APP_PERMISSIONS` 枚举，存在），只用于用户点击资讯标题后通过现有 `hostCall("external.open", { url })` 调 Host method；宿主实现只接受 ≤2048 字符、`https:`、无 userinfo 的 URL，并弹出系统确认框，用户取消时返回 `false`。面板仍无网络权限，抓取继续由零依赖 CLI 完成。本 PRD 引用的其余 Host 方法（`workspace.list/readText/writeText`、`storage.*`、`agent.submitPrompt`、`automations.list/create/update/delete`、`notifications.send`）均已在宿主 `panel-app-bridge` 中核对存在；不使用 `agent.task`、`process`、`credentials.cookies` 等本产品不需要的权限。M4 权限变更必须通过 manifest schema 校验和 Host stub 验收；不得以 `<a target="_blank">` 绕过 Host。

## 6. 模块 PRD

### 6.1 今日（首页）

**职责**：回答「我现在需要看什么」。只做聚合与跳转，自身不产生任何计算。

**首屏结构**（Round 12 最终收敛，自上而下）：

1. **市场时段条**：两枚状态徽章只说明开放/闭市与下一窗口。按用户确认的固定北京时间口径，A 股为工作日 `09:30–15:00`，美股为工作日 `21:30–次日 04:00`；美股窗口按开始日判断，周五窗口可延续到周六 04:00。该展示口径不随美国 DST 改动。v1 不内置交易所节假日日历，因此必须附「固定北京时间常规窗口，未校验交易所节假日」；行情 freshness 独立显示，不能用徽章证明交易所实际开市。
2. **唯一主行动**：只从已经计算完成的 portfolio analysis/rules、`evaluateWatchItem`/`rankWatchResults` 最近结果与数据状态中选择，不调用或重算任何财务/watch 指标。固定优先级（Round 13 收敛）为：未建账本 →「添加持仓」；P0 `warning`（已核实的数据不可信/不一致，如 raw 缺失、账本指纹不符、报价过期）→「同步数据」；真实持久化检查结果有 `triggered === true` 且证据新鲜 →「查看触发」；P0 `unavailable`（依赖未能核查，如专用 quote feed 尚未接入、FX 校验源不可用）→「同步数据」；非 P0 重要持仓 warning →「查看持仓分析」；否则按是否存在最近关注检查稳定选择「查看关注」或「查看研究」。同层按 rule/watch id 稳定排序。区分 warning 与 unavailable 的理由：watch 触发使用自己的研究 CSV 证据，组合侧“未能核查”不应长期压住它；但组合数据一旦被核实有问题，仍必须先处理。被压后的 P0 unavailable 必须继续在“最近变化”摘要中显式出现（`attention` + P0 计数），不得消失。
   - **关注证据新鲜度/过期**：持久化 watch 结果只有在其 bar 日期（`asOf`）不早于“今天（北京日历）之前最近一个工作日”且未被 sidecar 标 `stale` 时才算新鲜；否则视为过期证据——在关注摘要中以“N 条过期”和 `stale:true` 显式保留，但不能成为今日“查看触发”。无 bar 日期的结果永不算新鲜。未内置节假日日历，节假日后会保守地读作过期，文案不得声称“上一交易日”。
3. **最多三项摘要/最近变化**：持仓、关注、数据状态各一项；不复制完整持仓表或 13 条规则。持仓数字与持仓页复用同一 `analyzePortfolio` 对象；关注只消费 storage 中最近一次真实 evaluation。资讯/笔记尚未落地时保留结构化 unavailable，不伪造“今日已抓取/已复盘”。

每个主行动理由固定携带 `id/actual/threshold/source/availableAt/stale/provisional`；缺数时 `actual:null`，不得补 `0`。文案只使用添加/查看/同步/记录等导航或记录动作，不给出买卖建议。

**验收**：

- 打开面板默认进入今日；六个 tab 键盘可达。
- 无任何数据文件（全新仓库）时，今日页每个卡片都显示明确的引导或缺失说明，零 console error。
- 持仓摘要与持仓页复用同一对象；同一 ledger+market input fingerprint 数据 epoch 最多运行一次 `analyzePortfolio`。
- 任一必需报价在其市场一个常规收盘窗口后仍未更新时，当日盈亏必须显示 stale；无交易所节假日日历时文案只能称“最新已知报价”，不得声称精确的“上一交易日”。

### 6.2 持仓

**职责**：账本录入与组合核算。这是本次改版的核心新模块。

**首屏结构**：

1. **组合概览卡**：总权益、证券市值、现金、总成本、已实现/未实现收益、净收入、累计 TWR、年化 TWR、XIRR、收益口径差（`XIRR − 年化 TWR`）、归一化 HHI、币种与汇率贡献。差值只描述两种收益口径的数值差，禁止解释为“择时贡献”或给出优劣判断；任何不可计算项显示结构化原因（如 `short-period`、`no-root`、`missing-raw-data`），不显示 0 或 NaN。历史序列最后若干检查点若尚未被同步确认，标“暂定”（第 8.2 节 `provisional`）。
2. **持仓明细表**：代码、名称（以 instruments 主数据为准，缺失才用行情 meta 的 name 作非权威显示回退，最终回退代码）、数量、移动加权成本、现价（带 quoteTime）、市值、盈亏额、盈亏率、权重。**默认按盈亏绝对值降序**——最大的亏损和最大的盈利同样排在最前。亏损行不弱化、不折叠。
3. **交易录入表单**：先选账户，再选第 7.1 节事件类型；金额、数量、价格、费用一律输入十进制字符串。表单按类型显示字段并在写入前调用与引擎同源的严格校验，派生字段不由用户填写。
4. **交易流水**：`<details>` 折叠（沿用 v0.4.1 的信息密度处理），按日期倒序，每条可关联跳转到笔记。
5. **持仓分析卡**：第 10 节规则的输出，按优先级排序；底部「让 Agent 解释」按钮走 `agent.submitPrompt`，prompt 附 `portfolio.mjs` 的结构化证据。

**数据流**：读完整 `transactions.json` → 校验整份原始文本与全部引用 → 在内存追加并完整重放 → 以读取到的 `modifiedAt`/`revision` 调 `workspace.writeText` → 重新读取并核对 → 派生 `holdings.json` → 渲染。现有 `writeRepoText` 会把任意读取异常当成“文件不存在”，新路径不得复用这一错误分支。宿主事实（已核对 `panel-app-bridge`）：`workspace.readText` 对不存在的文件抛出的是原始 `ENOENT` 消息字符串，面板拿不到结构化错误码，因此**禁止解析错误文案判断文件是否存在**；正确做法是先用 `workspace.list`（`workspace.read` 权限，目录不存在时返回空 `entries`）列出父目录判定文件是否存在：不存在 → 以 `expectedModifiedAt: null` 走宿主的 create-only 写入（文件已出现时宿主以 “workspace file changed since it was opened” 拒绝，不会覆盖）；存在但 `readText` 失败（过大 >480 KiB、非 UTF-8、符号链接等） → 中止并显示原因，不写任何文件。任何非法条目都使账本核算整体不可用并列出错误，不能“隔离后继续算”造成静默漏账；写前派生失败时不得写任何文件。

**验收**：

- 录入「买 100 股 → 再买 100 股（不同价）→ 卖 50 股」后，成本与已实现盈亏与第 8.1 节公式手算值逐位一致（validate.mjs golden 断言）。
- 卖出数量超过当前持仓被拒绝并给出当前可卖数量。
- 港股代码（如 `00700`、`HK.700`）被标的校验拒绝并说明「暂不支持港股」。
- transactions.json 被外部改动后（modifiedAt 变化），面板下次写入触发冲突检查而非静默覆盖。
- holdings.json 的 `transactionsFingerprint` 与 transactions.json 实际指纹不符时，面板自动重放派生而不是信任旧快照。

### 6.3 关注

**职责**：沿用 v0.4.0 盯盘（Spec 1），**基本不动**。

**迁入内容**：现有 watchlist card 整体（添加/删除、四种规则、策略快照、立即检查、每日提醒 automation、按接近度排序）。storage key（`scopedStorageKey("watchlist", …)`）保持不变；数据需做一次只增不删的 canonicalization：`600519`、`sh600519` 统一为 `SH600519`，美股统一大写。若多个旧条目归一到同一代码，保留第一条 id 与全部不重复规则，发生字段冲突时不覆盖、显示迁移冲突要求用户确认。迁移成功后原子写回 storage；失败则继续展示原值并禁止重建 automation。

**仅有的两处新增**：

1. 关注标的自动纳入资讯抓取范围（第 11.4 节的 symbol 清单 = 持仓 ∪ 关注）。
2. 每日提醒的 automation 升级为双市场窗口版（第 13.2 节）；用户已创建的旧版「Quant Lab · 每日盯盘」不自动删除。面板检测到旧名前缀时显示“升级为分市场提醒”，按第 14.2 节为有标的的市场逐项创建并用 `automations.list` 验证；新旧先并存，只有用户二次确认才删除旧项。任一市场失败时另一市场的已验证新任务和旧任务都保留。

**验收**：现有 e2e 中全部盯盘断言（添加/删除、阈值显隐、非法输入、缺数据文案、触发排序、automation 创建删除、prompt 约束）在新 tab 布局下不改语义地通过。

### 6.4 研究

**职责**：现有量化面板整体迁入；计算和交互零回归，但先修正文案边界。

**迁入内容**：数据加载器、STRATEGY / EXECUTION / SIZING & SIGNAL / VALIDATION 控件、结论横幅、六指标卡、图表（权益/价格/回撤）、样本外验证面板、交易记录、保存策略（`quant/strategies/`）、保存报告（`quant/reports/`）、Agent 审查对话框。DOM id 保持，既有选择器与事件语义不变。M0 必须把现有“不建议使用”“考虑买入持有”“投入真钱”“小仓位试跑”等动作性结论文案改为只陈述样本、指标、限制与证据等级，并补 e2e 负面词断言。

**与工作台的三条连接**（只加不改）：

1. 持仓明细行提供「在研究中打开」：跳转研究 tab 并把 `data/market/<SYM>.csv` 填入 `#data-path` 触发加载——研究用复权数据，与账本估值用的 `data/market-raw/` 是两份文件，跳转时若复权 CSV 未同步，按现有缺文件报错文案提示先同步。
2. 关注模块的「策略买入信号」规则继续引用研究面板当前策略（现有 `currentStrategy()` 快照机制不变）。
3. 研究报告保存后，笔记模块可引用报告路径（第 12 节）。

**验收**：`npm run test:ui:quant-lab` 现有全链路（加载 CSV → 回测 → 改仓位 → 样本外验证 → 参数失效 → 保存报告/策略 → 提交 Agent → 零 console error）在 tab 结构下全部通过；`scripts/validate.mjs` 引擎断言不改一行仍然全绿。

### 6.5 资讯

**职责**：自动推送信息流——把「与我的组合相关的新信息」送到面板，并诚实标注来源、时间与缺失。完整架构见第 11 节，此处只定页面。

**覆盖差异必须明示**：A 股 = 东方财富个股新闻 + 7×24 快讯（财经媒体，二级）；美股 = SEC EDGAR 官方申报元数据（一级，但不是新闻）。v1 没有美股新闻源，页面美股分组标题固定带「仅申报」标签，源状态条不得暗示两市场覆盖等价。

**首屏结构**：

0. **启用卡（未启用时唯一内容）**：自动推送依赖联网，而联网必须由用户一次性显式启用。卡片列出三源、各源条款/隐私披露（第 11.2 节）、外发字段（canonical symbol / CIK / 用户填写的 SEC 联络信息）、A/US 两项 M4 专用 automation 的 cron 与 full-permission/session/在线依赖说明；用户勾选来源并点「启用自动资讯」后，面板以 create-only/条件写协议写入 `data/news/subscriptions.json`，再只为非空市场创建或升级专用任务。一市场失败保留另一市场成功项与订阅文件并逐项显示/重试，不回滚或误报成功项；不得修改 M3 watch 任务。启用后此卡消失；源状态 `not-enabled` 与 stale 是两种不同状态。
1. **源状态条**：每个数据源一枚徽章（东方财富个股 / 东方财富 7×24 / SEC EDGAR），分别显示 `not-enabled`/`configuration-required`/`ok`/`error`、`lastAttemptAt`、`lastSuccessAt`、连续失败数与最近错误。失败尝试不得刷新成功时间或掩盖 stale。
2. **按标的分组的信息**：持仓标的在前（按持仓权重排序），关注标的在后；每条用 DOM `textContent` 放标题、来源、`publishedAt`，不接收或渲染来源 HTML/摘要。点击时仅对硬编码允许域的 HTTPS URL 调 `external.open`，由 Host 确认。
3. **市场快讯**：只显示 7×24 流中 `stockList` 确定命中订阅标的的条目；v1 不保留、不显示任何未关联头条（与第 11.6 节一致，避免“热榜”变成隐性推荐）。
4. **手动刷新按钮**（补充手段，不是主路径）：走 `agent.submitPrompt` 请求 agent 执行固定 CLI，并设置非敏感 `displayText`。Host 接受请求只表示“已请求”，不表示 CLI 已运行；页面记录 `requestedAt` 与请求前文件指纹，只有重新读到指纹变化且 source `lastAttemptAt >= requestedAt` 才显示“已完成”，否则显示等待/失败/会话忙。宿主在会话忙时抛出 “the target session is busy”，必须作为显式状态处理而非通用错误。

**验收**：

- 未启用时只显示启用卡；启用流程任一步失败时 subscriptions 文件与 automation 均不残留半成品。
- feed.json 缺失但已启用时页面显示「尚未抓取，等待定时任务或点击刷新」，不报错，也不伪造“无新闻”。
- 美股分组带「仅申报」标签；SEC 条目显示 form 类型与 filing 日期而非“新闻”。
- 任一 source 的 `lastSuccessAt` 超过 12 小时显示 stale，超过 72 小时显示错误横幅；最近一次 attempt 失败即使旧条目仍在也必须可见。
- 同一 `Art_Code` / URL 的条目在界面上只出现一次（去重断言）。
- 资讯标题含 `<script>` 等内容时以文本呈现（XSS e2e 断言）。

### 6.6 笔记

**Round 16/17 实现状态（2026-08-26，诚实缩约）**：已交付的 v1 笔记为 `portfolio/journal.json`
（`format:"codeshell.journal"` / `version:1`）纯文本笔记 + instrument/transaction/news(+fingerprint)/
rule(+evidenceAsOf) 四类稳定关联、orphan/changed 解析、事实时间线与条件写/冲突保留草稿。本节下文的
决策/复盘/想法类型、`expectation`/`reviewAt`/`outcome`、account×instrument 区间经济结果、`reportPath`
与 P3 六分类计数**均未实现**；相关 P3 规则保持 `unavailable · decision-outcome-schema-not-implemented`，
不以全 0 冒充。instrument/transaction 关联没有证据版本（fingerprint），只能区分 current/orphan。

**职责**：把「当时为什么这么做」写下来，并在之后强制对照结果。

**首屏结构**：

1. **待复盘**：`reviewAt` 到期且无 `outcome` 的决策置顶。每条展示预期原文 + 引擎算出的 account×instrument 区间经济结果：`期末市值 + 区间净卖出所得 + 税后分红 − 期初市值 − 区间净买入成本`，按公司行动后的真实数量、未复权价与同日可用 FX 计算，并列金额、position XIRR（唯一根时）和数据截至日期。它是关联标的在该账户的区间结果，不能归因给某条散文决策或某个移动平均“lot”；用户自行填写 outcome。
2. **决策记录列表**：按时间倒序，兑现与未兑现同等呈现——列表带「未兑现率」汇总数字，不允许筛选器默认隐藏未兑现项。
3. **新建笔记表单**：类型（决策/复盘/想法）、正文、关联标的（多选，来自持仓+关注）、关联交易（可选，从流水选）、关联研究报告路径（可选）、预期（决策类必填：一句话 + 复盘日期 reviewAt，默认建仓后 30 天）。
4. 交易录入表单提供「同时写决策笔记」勾选（默认勾选），把记账与记录理由合成一步。

**验收**：

- 决策笔记不填预期与 reviewAt 无法保存（这是可复盘性要求，不把散文决策称为可回测策略）。
- 复盘视图中的区间经济结果来自引擎并带数据日期，e2e 用未复权 CSV、流水和 FX 的独立手算常量逐字段核对。
- 删除笔记需确认；journal.json 写入采用 6.2 的严格 list → read → validate → conditional write → reread 流程，不复用会误判 read error 的旧 helper。

## 7. 数据模型

所有新文件落在 workspace 仓库（与 `data/market/`、`quant/` 同级），JSON、UTF-8、带 `format` 与 `version` 字段。账本是会计事实，必须整份严格校验：任一未知类型、断裂引用、重复 id 或金额不守恒都会令依赖该账本的数字整体不可用并列出定位；不得跳过坏条目继续核算。资讯等非会计列表可以逐条隔离，但必须显示隔离计数。

### 7.1 portfolio/transactions.json（唯一权威）

```json
{
  "format": "codeshell.portfolio-transactions",
  "version": 1,
  "baseCurrency": "CNY",
  "accounts": [
    { "id": "cn-main", "name": "A股主账户", "broker": "manual", "currencies": ["CNY"] },
    { "id": "us-main", "name": "美股账户", "broker": "manual", "currencies": ["USD", "CNY"] }
  ],
  "instruments": [
    { "id": "xshg-600519", "type": "stock", "market": "cn", "currency": "CNY", "symbol": "SH600519", "name": "贵州茅台", "aliases": [] },
    { "id": "xnas-aapl", "type": "stock", "market": "us", "currency": "USD", "symbol": "AAPL", "name": "Apple Inc.", "aliases": [] }
  ],
  "transactions": [
    { "id": "t1", "type": "cash-in", "accountId": "cn-main", "currency": "CNY", "amount": "300000.00", "valuationDate": "2026-01-10", "timing": "begin", "createdAt": "2026-01-10T09:00:00+08:00" },
    { "id": "t2", "type": "buy", "accountId": "cn-main", "instrumentId": "xshg-600519", "tradeDate": "2026-03-02", "quantity": "100", "price": "1450.00", "commission": "5.00", "tax": "0.00", "otherFees": "2.25", "createdAt": "2026-03-02T14:35:00+08:00" },
    { "id": "t3", "type": "dividend", "accountId": "cn-main", "instrumentId": "xshg-600519", "exDate": "2026-06-19", "payDate": "2026-06-26", "gross": "3000.00", "withholding": "255.00", "net": "2745.00", "createdAt": "2026-06-26T16:00:00+08:00" }
  ]
}
```

`instrumentId` 是身份，`symbol` 只是可变显示/行情映射；更名、换代码后追加旧 symbol 到 `aliases`，历史流水不改。所有金额、数量、价格、比例均为规范十进制字符串，禁止 JSON 浮点作为权威；货币金额按 ISO minor unit 舍入，证券数量/比例保留输入精度，现金与成本核算用整数 minor units/精确十进制，只有最终比率可用浮点。

**数值精度规则（唯一）**：录入金额（amount/price×quantity/费用/gross/net）必须已是 minor unit 精度（CNY/USD 两位小数），否则拒绝；`avgCost` 与 `costBasis` 以精确十进制保存不舍入（示例 `1450.0725`）；处置成本 = `数量 × avgCost` 精确计算后按 ROUND_HALF_EVEN 舍到 minor unit 再入已实现损益；估值 `V_d`、基准币折算（本币金额 × FX）与归因金额在引擎内部全程精确十进制不舍入，只在展示与写入 `holdings.json` 时按 minor unit ROUND_HALF_EVEN；比率（`r_d`、TWR、XIRR、权重、HHI）用双精度浮点，golden 断言容差 `1e-9`。

**日期字段的日历语义（唯一）**：

- 标的事件（`buy`/`sell` 的 `tradeDate`，`dividend` 的 `exDate`/`payDate`，`split`/`stock-dividend`/`reorganization` 的 `effectiveDate`）填写**该标的市场的本地交易日**：A 股为上海日期，美股为纽约日期（与券商成交单一致）。它们经第 8.2 节的映射进入上海检查点：A 股日期 `d` → 检查点 `d`；美股日期 `t` → 检查点 `t+1`。`createdAt` 只记录录入时刻，不参与核算。
- 账户事件（`cash-in`/`cash-out`/`position-in`/`position-out` 的 `valuationDate`，`fx-conversion`/`cash-transfer`/`position-transfer` 的 `effectiveDate`）直接填写**上海检查点日期**（自然日，可为周末），在该日 16:30 Asia/Shanghai 检查点生效；外部流再由 `timing ∈ {begin,end}` 决定落在该检查点的期初还是期末。
- 美股 `tradeDate` 不得直接当作上海日期：纽约 2026-03-05 成交在上海是 03-06 凌晨，对应检查点 2026-03-06。

**类型与必填字段**：

| type | 必填 | 语义 |
|---|---|---|
| `buy` / `sell` | accountId, instrumentId, tradeDate, quantity, price, commission, tax, otherFees | 内部成交。引擎派生净额；买入费用进入成本，卖出费用/税减少处置所得 |
| `cash-in` / `cash-out` | accountId, currency, amount, valuationDate, timing | 组合边界外现金流；`timing ∈ {begin,end}` 是严格日 TWR 必填，不得猜测盘中时点 |
| `position-in` / `position-out` | accountId, instrumentId, quantity, valuationDate, timing, fairValueBase, costBasisLocal, costBasisBase | 组合边界外证券转入/转出；基准币公平价值进入 TWR/XIRR，两套成本用于后续损益与 FX 归因 |
| `dividend` | accountId, instrumentId, exDate, payDate, gross, withholding, net | 税后分红；必须 `gross − withholding = net`。除息日确认净应收，支付日应收转现金，避免未复权价格除息与现金到账错位 |
| `dividend-tax-adjustment` | accountId, dividendTransactionId, effectiveDate, currency, amount | 分红到账后券商才补扣的税；减少现金与该分红净收入，不改成本，也不是组合外部流 |
| `split` / `stock-dividend` | accountId, instrumentId, effectiveDate, factor | 拆并股、A 股送转统一为数量因子；零现金，单位成本反向调整，总成本不变 |
| `fx-conversion` | accountId, effectiveDate, fromCurrency, fromAmount, toCurrency, toAmount, feeCurrency, fee | 同一账户内部换汇，非外部流；两端金额与费用必须守恒且保留实际成交汇率 |
| `cash-transfer` | fromAccountId, toAccountId, effectiveDate, currency, amount | 账户间现金转移；组合层非外部流，来源与目标必须成对 |
| `position-transfer` | fromAccountId, toAccountId, effectiveDate, instrumentId, quantity, carriedCostBasisLocal, carriedCostBasisBase | 账户间证券转移并携带两套成本；组合层非外部流 |
| `reorganization` | accountId, effectiveDate, fromInstrumentId, toInstrumentId?, shareFactor, cashConsideration, basisAllocationToNew | 合并、换股、退市现金清算。全股票换股 allocation=1，纯现金清算/退市 allocation=0；混合交易必须录券商给出的成本分配，缺失就拒绝核算 |

**校验规则**（`portfolio.mjs` 的 `parseTransactions` 实施，任一非法项都拒绝整份账本核算并报告）：

- `id` 全局唯一；所有 trade/effective/valuation/ex/pay 日期字段都用真实日历校验（复用 fetch-market-data.mjs 的 `isoDate` 逻辑：拒绝 2026-02-31 这类被 `Date.parse` 顺延的日期）。
- accountId / instrumentId 与成对转移引用必须存在；账户、标的、流水 id 全局唯一。标的 `market ∈ {cn,us}`、`currency ∈ {CNY,USD}`；A 股 canonical symbol 为 `SH|SZ` + 6 位，美股为大写 `^[A-Z][A-Z0-9.-]{0,9}$`，拒绝港股形态。
- 同一检查点内的事件按固定顺序重放：先公司行动（split/stock-dividend/reorganization），再 buy/sell/dividend/dividend-tax-adjustment/fx-conversion/transfers，同类事件再按 `createdAt`、再按 id 稳定排序；任一卖出/转出不得超过该账户当时数量。buy/sell 没有成交时刻，一律按“日期字段的日历语义”映射到检查点（A 股 `d`→`d`，美股 `t`→`t+1`），并与同一检查点可得的该市场 bar 配对；公司行动同样按其市场 effectiveDate 映射；v1 不模拟结算日应收应付。
- 现金可为负以暴露漏录，但一旦出现负现金，依赖完整外部资本的 TWR/XIRR 标为不可用；持仓数量与基于已录交易的盈亏仍可显示并加“账本不完整”。
- 佣金、税费与分红扣税只录券商实际发生额；引擎不按 A/美市场或持有期猜税率。`dividend-tax-adjustment` 必须引用既有 dividend，累计扣税不得使该笔净收入违反 `gross − allWithholding = currentNet`。
- v1 不支持做空、融资、基金/债券/期权、spin-off、rights issue、return of capital。未知事件绝不映射成 dividend/split；显示“公司行动未建模”，从该 effectiveDate 起严格收益指标不可用，直到用户补齐可表达事件。

### 7.2 portfolio/holdings.json（派生快照，可随时重建）

```json
{
  "format": "codeshell.portfolio-holdings",
  "version": 1,
  "derivedAt": "2026-08-26T09:30:00+08:00",
  "transactionsFingerprint": "fnv1a32:8a1b2c3d",
  "baseCurrency": "CNY",
  "availability": {
    "local": { "status": "complete" },
    "base": { "status": "complete" }
  },
  "cashByAccount": { "cn-main": { "CNY": "157737.75" }, "us-main": { "USD": "0.00" } },
  "positionsByAccount": [
    {
      "accountId": "cn-main",
      "instrumentId": "xshg-600519",
      "quantity": "100",
      "avgCostLocal": "1450.0725",
      "costBasisLocal": "145007.25",
      "costBasisBase": "145007.25",
      "realizedPnlLocal": "0.00",
      "realizedPnlBase": "0.00",
      "netIncomeLocal": "2745.00",
      "netIncomeBase": "2745.00",
      "firstBuyDate": "2026-03-02"
    }
  ],
  "aggregateByInstrument": []
}
```

- `transactionsFingerprint` 直接对成功读取的 transactions.json 原始文本调用现有 `fingerprintText`，避免不同 JSON canonicalization 产生歧义。FNV-1a 只做缓存漂移检测，不是防篡改或安全完整性证明。
- 面板每次读 holdings.json 都先核对指纹；不符即静默重放派生（transactions 是权威，holdings 只是缓存）。手动录入永远写 transactions，任何代码路径都不得直接改 holdings。
- 快照还带 `inputsFingerprint`（对派生输入 checkpointFx/endingDate/endingPrices 的稳定 JSON 取 FNV-1a）与可选
  `valuation:{ endingDate, totalBase, unavailable? }`。`unrealizedPnl*`、`availability.base` 与 `valuation` 随行情/FX 变化而
  不需账本改动，因此读侧必须同时核对 `transactionsFingerprint` 与 `inputsFingerprint`，任一不符即重放派生。`totalBase`
  是引擎按 `endingDate` 检查点可得价格/FX 算出的 `V_d`（含现金与未付应收；可为负），UI 只展示不重算；`totalBase` 为
  `null` 时必须带 `unavailable:{code,reason}`（`missing-fx` / `missing-raw-data`），有总值时不得同时带 unavailable，也不得与
  `availability.base.status:"unavailable"` 并存；头寸级 `baseUnavailable` 标记与顶层 `base.status:"complete"` 并存亦为 schema 错误。
- 缺历史 FX 不是账本不变量错误。此时 `availability.local.status` 仍为 `complete`，`availability.base`
  为 `{ "status":"unavailable", "reason":"missing-fx" }`；受影响头寸的 `avgCostBase` /
  `costBasisBase` / `realizedPnlBase` / `netIncomeBase` / `unrealizedPnlBase` 为 `null`，且必须同时带
  `baseUnavailable:{"code":"missing-fx","reason":"missing-fx"}`。本币字段不得置零或丢失；缺失该标记的
  `null` 仍属 schema 错误。

### 7.3 data/quotes/latest.json（报价快照，CLI 产出）

```json
{
  "format": "codeshell.quotes",
  "version": 1,
  "fetchedAt": "2026-08-26T10:05:12+08:00",
  "quotes": {
    "SH600519": {
      "name": "贵州茅台", "currency": "CNY", "price": 1304.00,
      "prevClose": 1304.66, "quoteTime": "2026-08-25T16:14:38+08:00",
      "source": "tencent-qt"
    },
    "AAPL": {
      "name": "Apple Inc.", "currency": "USD", "price": 309.47,
      "prevClose": 308.90, "quoteTime": "2026-08-25T15:45:12-04:00",
      "source": "yahoo-chart", "delayed": true
    },
    "USDCNY": {
      "currency": "CNY", "price": 6.7084, "prevClose": 6.7426,
      "quoteTime": "2026-08-25T21:59:00+00:00", "source": "yahoo-chart"
    }
  },
  "failures": [
    { "symbol": "USDCNY", "attemptedAt": "2026-08-26T10:05:12+08:00", "errorCode": "HTTP_429", "retryAfterSeconds": 60, "keptPrevious": true }
  ]
}
```

由新 CLI `app/tools/fetch-quotes.mjs` 产出，**源族与 v0.4.1 研究同步器完全相同**（A 股腾讯 `qt.gtimg.cn` 实时快照 GBK；美股与汇率 Yahoo chart，复用 `fetch-market-data.mjs` 现有 `fetchUs`/名称查询的 `range=1d` 请求代码），不引入任何需要 API key 的第三方源。**汇率源决策（用户已确认，Round 3 恢复）**：`USDCNY` 的核算权威源是 Yahoo chart `CNY=X`（文件名映射为 `USDCNY`，因为 `=` 不在 CLI 文件名白名单内）；ECB 参考汇率只作**校验源**（第 7.6 节），任何情况下不得替代 Yahoo 进入核算。Yahoo 美股 quote 为延迟报价，`delayed:true`，UI 必须写“延迟”；A 股腾讯为实时快照。

限流与失败语义（单一）：CLI 对 Yahoo 串行、≤1 req/s，429 时读取 `Retry-After`（缺省 60s）只重试一次；仍失败或任何非 2xx → 该 symbol 进入 `failures`，`latest.json` 中保留上一份成功 quote 及其原 `quoteTime`（`keptPrevious:true`），面板据 `quoteTime` 年龄显示 stale。**禁止在失败时静默切换到 ECB 或其他源**；stale 是唯一降级。单标的失败不阻塞其余标的；任何 quote 只用于当前/当日显示，不得回填历史 TWR。

CLI 只从面板经用户确认写入的 `data/quotes/subscriptions.json` 读取 `{version:1, enabledSources:["tencent-qt","yahoo-chart"], symbols:[...]}`，该文件与资讯 subscriptions 一样不得含账户/数量/成本。“联网 opt-in”的唯一机制是用户显式动作：手动点“同步/刷新”或在资讯页启用卡中创建 automation（第 6.5 节）；面板永不在没有这两种动作的情况下发起抓取。source 未启用（`not-enabled`）、限流（`HTTP_429`）、endpoint 失败（其他 HTTP/网络码）是三种不同状态，界面分别显示。

### 7.4 data/news/（资讯订阅、缓存、feed 与通知账本）

- `subscriptions.json`：`format:"codeshell.news-subscriptions"` / `version:1`，仅含 `enabledSources`、canonical `{symbol,market,origins}`、用户知情填写的 `secContact` 与 `updatedAt`。不含账户、数量、成本或笔记。
- `cache.json`：`format:"codeshell.news-cache"` / `version:1`，按 source 保存 `status/lastAttemptAt/lastSuccessAt/consecutiveFailures/errorCode/stale/items` 与 fingerprint。一源失败保留其旧 items、原 success 时间并只把该源标 stale；其他源继续。
- `feed.json`：`format:"codeshell.news-feed"` / `version:1`，顶层 `cacheFingerprint` 绑定派生它的 `cache.json` 代数（Round 15）：cache/feed 只能逐文件 rename，崩溃可能留下撕裂对，读侧用 `newsFeedMatchesCache` 判定，CLI 不把异代 feed 当“新增”基线。最多 500 张稳定排序的卡片。每卡严格含 `id/sourceId/url/title/source/market/symbol/association/kind/form/publishedAt/fetchedAt/availableAt/sourceTier/stale/fingerprint/occurrences`；主卡按官方层级优先、同层按新事实时间选择，全部来源留在 occurrences。同标题不同 symbol 永不聚合。
- `notified.json`：`format:"codeshell.news-notified"` / `version:1`，持久保存 `itemId+fingerprint/source/market/symbol/notifiedAt/state/attempts`（Round 15）。幂等键 `itemId:fingerprint`；投递协议为「筛选 → 条件写 `pending`(attempts+1) 并 reread → `notifications.send` → 条件写 `sent`」。候选必须同时满足用户订阅、`confirmed`、新鲜、未 stale 且账本中没有 `sent` 或 `attempts≥3` 的记录；`pending` 未达上限会在下次加载重试（有界 at-least-once，最多 3 次），写失败零通知（fail closed）。send 失败的条目不会被误标已通知；sent 写失败也只会在上限内重复。缺 `state/attempts` 的旧账本整体拒读，不猜测。后台定时会话没有通知通道，也不得改写账本。

四种 schema 均拒绝未知字段、错误 format/version、超限文本、坏 id/URL/source/market/symbol/时间/fingerprint。`id` 规则：东方财富个股 `em:<Art_Code>`，7×24 `em724:<code>:<symbol>`，SEC `sec:<CIK>:<accession-number>`；先在同一标的内按 source stable id 与规范化 HTTPS URL 去重，再按规范标题 + 6 小时时窗做确定性事件聚类。纯标题猜测最多是 `weak`，不得通知；抓取器本身不以标题猜标的。

CLI 必须使用互斥锁；持锁后重新读取 → 合并去重 → 各文件在同目录写临时文件 → fsync/原子 rename。这里只承诺单文件原子替换，不伪称 `cache.json` 与 `feed.json` 跨文件事务；两者 fingerprint 不一致或 Host 条件写冲突时冻结并要求重读。

### 7.5 portfolio/journal.json（笔记）

```json
{
  "format": "codeshell.journal",
  "version": 1,
  "entries": [
    {
      "id": "j-20260302-001",
      "type": "decision",
      "createdAt": "2026-03-02T14:40:00+08:00",
      "symbols": ["SH600519"],
      "transactionIds": ["t2"],
      "reportPath": null,
      "text": "白酒动销数据回暖，估值处于五年低位，建仓 100 股。",
      "expectation": "6 个月内股价回到 1600 以上",
      "reviewAt": "2026-09-02",
      "outcome": null,
      "reviewText": null
    }
  ]
}
```

`type ∈ {decision, review, idea}`；`decision` 必填 `expectation` 与 `reviewAt`；`outcome ∈ {met, partial, missed, undecidable, null}`。`reportPath` 可指向 `quant/reports/` 下已保存的研究报告，读取时校验路径前缀（复用 `isSafeCsvPath` 的路径安全思路，限定 `quant/reports/` 与 `quant/strategies/`）。

### 7.6 行情文件（沿用现状，新增一个目录）

| 路径 | 口径 | 用途 | 产出 |
|---|---|---|---|
| `data/market/<SYM>.csv` + `.meta.json` | 复权（cn 默认 qfq，us 默认 adj） | 研究回测、关注规则 | 现有 fetch-market-data.mjs，不改 |
| `data/market-raw/<SYM>.csv` + `.meta.json` | 未复权，sidecar 必须同时有 `adjust:"none"`、`purpose:"portfolio-valuation"` | 账本历史估值、笔记区间经济结果 | 新账本同步模式 `fetch-market-data.mjs --portfolio-valuation --symbol <SYM>`：A 股腾讯 `day`（none）；美股 Yahoo chart `adjust=none`（复用现有 `fetchUs`）；也允许用户导入同契约 CSV。固定输出目录 `data/market-raw/`，该模式忽略/拒绝 `--out-dir` 与 `--adjust` |
| `data/market-raw/USDCNY.csv` + `.meta.json` | Yahoo chart `CNY=X` 日频收盘（**核算权威源，用户已确认**）、`purpose:"portfolio-valuation"`、`source:"yahoo-chart"` | TWR/币种拆分/基准币成本的历史汇率 | `fetch-quotes.mjs --fx-history`；增量追加，失败不改旧行 |
| `data/market-raw/USDCNY-ECB.csv` + `.meta.json` | ECB EUR 参考汇率交叉 `USDCNY = CNY/EUR ÷ USD/EUR`、`purpose:"fx-verification"`、`source:"ecb-exr"` | **仅校验**：与 Yahoo 同日期值比对，触发第 10 节 `fx-source-divergence` 静态审计；任何引擎路径不得把它读入估值 | `fetch-quotes.mjs --fx-verify`；随美股收盘后 automation 执行 |

**FX 行日期语义（实现必须遵守）**：`USDCNY.csv` 的 `date` 列 = 该日频 bar 在来源交易时区（Yahoo chart `meta.exchangeTimezoneName`，`CNY=X` 为 `Europe/London`）的日历日期，**不能**沿用 `fetch-market-data.mjs` 现有的 `toISOString().slice(0,10)` UTC 日期换算——伦敦夏令时下 00:00 London 的 bar 时间戳是前一日 23:00Z，按 UTC 会把整列日期提前一天。validate.mjs 断言：时间戳 `2026-07-01T23:00:00Z` + `Europe/London` 必须产出 `2026-07-02`；`2026-01-15T00:00:00Z` + `Europe/London` 产出 `2026-01-15`。美股 bar 沿用现有换算（纽约日期与 UTC 日期一致）。日期 `f` 的 FX 观测可得瞬间定义为 `f+1 00:00Z`（该 UTC 日结束），见第 8.2 节。

**单一推荐：保留 `data/market-raw/`。** 研究 qfq/adj 会在后来发生分红、拆股等事件后追溯缩放历史价格；把它乘以当时真实数量，再另记分红/拆股，会污染历史净值并双重计算。严格 TWR 因而必须用当日未复权收盘 × 当时数量，再由账本事件改变现金/数量。

现有 `fetch-market-data.mjs --out-dir ... --adjust none` 不足以保证隔离：`--force` 仍可能把错误口径写进任意目录。M2 必须新增固定的 portfolio-valuation 模式并在**读写两端**校验目录前缀、purpose、adjust、symbol、market、source 与 CSV fingerprint；raw 目录出现 qfq/adj、research 目录出现 purpose=portfolio-valuation 都拒绝加载并报告具体文件。不得自动搬运或猜测口径。

## 8. 组合核算公式与边界

全部实现于新文件 `app/portfolio.mjs`（纯函数、无 DOM、无网络，validate.mjs 可直接 import 断言），导出：`parseTransactions`、`deriveHoldings`、`portfolioValueSeries`、`timeWeightedReturn`、`xirr`、`concentrationHHI`、`currencyAttribution`、`analyzePortfolio`。

### 8.1 成本口径：移动加权平均（单一选择）

**决策：A 股与美股统一采用移动加权平均，不做 FIFO。**

理由：

1. 本产品目标是跨 A/美股的一致经济收益视图，不是税务 lot 选择。移动加权在每个“账户 × 标的”上只有一个可解释成本，部分卖出后状态简单、容易与手算 golden 对照。
2. 对美国普通股票，把平均成本当成默认税务口径是错误的；IRS 对普通股票通常要求 specific identification，否则用 FIFO，平均成本主要适用于合资格基金等。界面必须明确“非税务成本”。
3. 原始流水永久保留，因此将来可新增只读 FIFO/specific-lot 税务参考视图；不能承诺“零迁移”，因为历史导入仍可能缺 broker lot 标识。

公式（按时间序重放）：

- 买入总成本 = `quantity × price + commission + tax + otherFees`；新成本 = 旧成本 + 买入总成本，`avgCost = costBasis / quantity`。
- 卖出处置成本 = 卖出数量 × 卖前 avgCost；净所得 = `quantity × price − commission − tax − otherFees`；已实现收益 += 净所得 − 处置成本。剩余 avgCost 不变；清仓时剩余数量与成本都必须精确归零。
- USD 头寸同时维护本币与基准币移动成本；部分卖出按卖前数量比例处置两套 basis，剩余两套平均成本都不变。任何账户/标的聚合只在账户级结果算完后求和，不能先把不同币种/汇率的平均成本混在一起。
- 未实现收益 = 当前本地市值 − 剩余本地成本；净收入单列分红及后续扣税；总经济损益 = 已实现 + 未实现 + 净收入。分红不摊薄成本。
- split/stock-dividend：数量乘 factor，成本总额不变，单位成本除 factor；fractional cash 与 reorganization 按第 7.1 节事件单独处理。
- reorganization：`oldBasis × basisAllocationToNew` 携带到新标的，余下 basis 与 cash consideration 计算已实现损益；纯现金退市 allocation=0（cash 可为 0，形成全部剩余成本的已实现损失），全股票换股 allocation=1。现金与新股数量/成本任一信息缺失就不核算，不能自动假设卖出价为 0 或忽略旧仓。

### 8.2 TWR（时间加权收益率）

**时间语义（唯一，不可再解释）**

- 检查点：每个自然日 `d`（含周末、节假日）一个检查点，瞬间为 `d 16:30:00 Asia/Shanghai`（中国无夏令时，等于 `d 08:30:00Z`，全年唯一）。检查点只是估值标签，引擎不需要“现在时刻”即可复算历史；“上海 16:30”因此足以无歧义实现，前提是可得性按下面的瞬间而不是按日期字符串判断。
- 观测可得瞬间 `availableAt` 与进入检查点的推论（实现可用 IANA 时区计算瞬间，也可直接用推论表；两者必须一致，测试同时断言一个 EST 日期与一个 EDT 日期）：

| 观测 | `availableAt` | 进入的首个检查点 | 正常 age |
|---|---|---|---|
| A 股未复权 bar，日期 `d` | `d 15:00 Asia/Shanghai` | `d` | 0 |
| 美股未复权 bar，日期 `t`（纽约交易日） | `t 16:00 America/New_York`（EDT = `t+1 04:00`、EST = `t+1 05:00` 上海） | `t+1`（冬夏令时均如此） | 1 |
| FX 日频 bar（Yahoo `CNY=X`），日期 `f` | `f+1 00:00Z`（该 UTC 日结束） | `f+1` | 1 |
| ECB 校验值，日期 `f` | 约 `f 16:00 Europe/Berlin` | `f+1`（只与 Yahoo 同日期比对，不入估值） | — |

- 选择规则：每个检查点对每个标的/FX 取 `availableAt ≤ 检查点瞬间` 的**最新**观测；`priceAgeCalendarDays` / `fxAgeCalendarDays` = 检查点日期 − 观测日期。周末、常规休市与停牌都只表现为“无新观测 → forward-fill、age 递增”，引擎不区分停牌与节假日，UI 只能称“最新已知价格”。age **>10** 自然日（即 ≥11）从第一个超限检查点起严格 TWR 不可用，不能继续近似；age = 10 仍可用。疑似公司行动未录入也从事件检查点起阻断。不得让未来观测回填，也不得按日期字符串 join。
- 暂定检查点：某检查点使用的任一文件其 sidecar `syncedAt` 早于该检查点瞬间时，该检查点标 `provisional:true`（同步尚未确认当天是否真的没有新 bar）；序列尾部的暂定检查点在下一次同步后重算。golden fixture 的 `syncedAt` 晚于全部检查点，因此全为 final。
- 非同步收盘效应：同一检查点里 A 股用当日收盘、美股与 FX 用前一交易日收盘。UI 悬停必须披露，不得把它称作“同一时刻市值”。

**估值与子期**

- `V_d = Σ_i quantity_i(d) × eligibleRawClose_i(d) × eligibleFx(d) + Σ cash(d) × eligibleFx(d) + Σ dividendReceivables(d) × eligibleFx(d)`，CNY 项 FX = 1。事件按第 7.1 节映射进入检查点后再估值：进入检查点 `d` 的买卖改变该检查点的数量与现金，并与同一检查点可得的该市场 bar 配对。
- 外部流：组合边界外流入记正、流出记负，跨币种外部流用该检查点的 `eligibleFx` 换成 CNY；按 `timing` 聚合为期初 `CF^B_d` 与期末 `CF^E_d`：`r_d = (V_d − CF^E_d) / (V_{d-1} + CF^B_d) − 1`。`timing` 缺失是账本校验错误（整份拒绝）；不得偷换成现金流日近似或 Modified Dietz。
- 买卖、费用、分红、换汇、账户间转移和公司行动均在组合边界内，不是外部流。分红在 exDate 映射的检查点形成税后应收、payDate 映射的检查点转现金，使未复权价除息和现金到账不制造假损失。外部证券转入/转出按边界公平价值进入 CF。
- 累计 TWR = `Π_d(1+r_d)−1`。年化 TWR = `(1+累计TWR)^(365/跨度)−1`，跨度 = 末检查点日期 − 首检查点日期（自然日）；**跨度 <365 时年化 TWR 与收益口径差均返回 `unavailable(short-period)`**，不对不足一年的区间年化。首个检查点必须有显式外部现金/证券流（`V_0 = 0`，`r_1 = V_1/CF^B_1 − 1`）；仅有买入并产生负现金时，持仓和损益可算但 TWR 不可用。任一 `V_{d-1}+CF^B_d <= 0` 或 `V_d−CF^E_d < 0` 时从该日不可用。无外部流且无新观测的日子 `r_d = 0`，链式乘积对它们不敏感。
- 完整可手算样例见第 8.7 节 golden 场景 G1，它是 validate.mjs 第 17.1 节第 2 组的权威 fixture。

### 8.3 MWR / XIRR

- 组合 XIRR 只使用投资者视角的外部流（cash/position-in 为负，out 为正，金额为其检查点 `eligibleFx` 折算的 CNY，日期为 `valuationDate` 检查点日期，忽略 begin/end）以及估值终日组合净值 `V_end`（正，与终日 `end` 外部流同日聚合）。组合内买卖、费用、分红、换汇与账户转移不能再作为 XIRR 流，否则终值中的现金/资产会被双重计算。单标的 XIRR 才使用该标的买卖净现金、分红和期末市值。
- 同日流先聚合，终日 NAV 必须为正；求 `Σ CF_j / (1+r)^((d_j−d_0)/365) = 0`，采用 Excel 兼容的 365 天；至少需要一正一负现金流和正日期跨度。令 `x=log1p(r)`，在明确支持域 `x∈[log(10^-12), log(1+10^6)]`（即 `−1+10^-12 ≤ r ≤ 10^6`）做确定性自适应扫描，并检查导数驻点以捕获不变号的重根；所有候选用 Brent/二分/驻点残差验证到缩放 NPV `≤10^-10`。零根、多个根、超出支持域迹象和数值不收敛分别返回 `no-root`、`multiple-roots`、`out-of-range`、`non-convergent`；不得挑一个看似合理的值，禁止固定上限 10 或仅靠单初值牛顿法。
- XIRR 是年化口径，只与年化 TWR 比较：`收益口径差 = XIRR − 年化TWR`；跨度 <365 天时年化 TWR 不可用，口径差同样 `unavailable(short-period)`，XIRR 仍显示但标注“年化口径，期限不足一年”。它不是纯“择时贡献”，还受现金流规模、路径和两种度量定义影响；规则与 UI 不做因果或优劣判断。

### 8.4 集中度：归一化 HHI

`H = Σ w_i²`（w 为正证券市值在“已投资证券总市值”中的权重，**不含现金**）；归一化 `H* = (H − 1/n) / (1 − 1/n)`。n=1 定义为 1，n=0 或证券总市值 <=0 为 N/A。按 instrumentId 聚合，负市值/做空已被 v1 拒绝。不同股票若属于同一发行人仍会低估发行人集中度，UI 必须注明“按标的，不按发行人”。阈值只是描述性分箱，不贴“好/坏”。

### 8.5 多币种拆分

基准币 CNY。引擎为每个 USD 账户/标的同时保留本币成本与基准币成本：买入按该交易生效检查点的 `eligibleFx`（Yahoo `CNY=X` 前一日期 bar）折算；外部 position-in 使用用户提供且经校验的 base cost；账户转移携带两套成本。缺相应历史 FX 时本地成本/P&L仍可显示，但基准币 P&L 和归因不可用。对处置或期末剩余头寸，令本币价值/净所得为 `L_1`、对应本币成本为 `B_L`、当前/处置汇率为 `F_1`、对应基准币历史成本为 `B_C`：本地价格贡献 = `(L_1−B_L)×F_1`，汇率贡献 = `B_L×F_1−B_C`，二者严格等于基准币损益 `L_1×F_1−B_C`。价格与汇率交叉项固定归入本地价格贡献（因使用 F_1），悬停明确。

其余项的唯一定义：

- **净收入**：税后分红在 exDate 检查点按该检查点 `eligibleFx` 折算入账（`netIncomeBase`），此后应收/现金的汇率变动归入现金汇率贡献；`dividend-tax-adjustment` 按其 effectiveDate 检查点 FX 折算冲减。
- **现金汇率贡献**：`期末 USD 现金与应收的基准币价值 − Σ(USD 现金/应收各流入流出在其生效检查点 eligibleFx 的基准币值)`；换汇的 USD 端按当时 `eligibleFx` 计为流出。
- **换汇价差**：每笔 `fx-conversion` 记 `toAmount(基准币) − fromAmount × eligibleFx`（含费用），单列，不并入现金汇率贡献；它是用户实际成交汇率与参考汇率之差，不是外部流。
- **恒等式（validate 断言）**：`V_end − Σ外部流(基准币) = Σ标的本地价格贡献 + Σ标的汇率贡献 + 净收入 + 现金汇率贡献 + 换汇价差`，逐位相等（第 8.7 节 G1 给出全部数字）。

跨币种外部流在其 valuationDate/timing 检查点用同一 `eligibleFx` 换为 CNY 后进入 TWR/XIRR。不得用 `Σ权重×收益率` 近似金额归因。

### 8.6 数值边界汇总

| 情形 | 行为 |
|---|---|
| 持仓为空 | 概览显示引导，不显示 0% 之类的伪数字 |
| 总权益为零/负或现金为负 | 显示可证明的余额/持仓；TWR、XIRR、权重与 HHI 按各自前置条件返回不可用原因 |
| XIRR 无根/多根/不收敛 | 显示不可用与结构化原因，不显示任意根 |
| 未复权行情/公司行动缺失 | 从第一个受影响检查点起 TWR 不可用，列出标的、日期与同步/补录入口 |
| 价格/汇率缺当日 | 仅向前填充已可得前值并显示 age；超过 10 个自然日阻断严格指标 |
| 报价 stale | 当日盈亏置灰 + 数据时间标注 |
| 跨度 <365 自然日 | 年化 TWR 与收益口径差 `unavailable(short-period)`；累计 TWR 与 XIRR 照常 |

### 8.7 Golden 场景 G1（权威 fixture，全部数字可手算）

G1 是第 17.1 节第 1–3 组的权威 fixture；价格与汇率均为合成值（不是真实行情），符号只为复用现有 symbol 校验。区间 2026-03-05（周四）至 2026-03-17（周二），横跨美国夏令时切换（2026-03-08）：03-05/03-06 为 EST，03-09 起为 EDT，映射结果不变。所有 sidecar `syncedAt = 2026-03-18T09:00:00+08:00`，因此全部检查点为 final。

**账户与标的**：`baseCurrency = CNY`；`cn-main`（CNY）、`us-main`（USD, CNY）；`xshg-600519` = SH600519（cn, CNY）、`xnas-aapl` = AAPL（us, USD）。

**流水（按 id 顺序录入）**：

| id | type | 关键字段 | 备注 |
|---|---|---|---|
| t1 | cash-in | cn-main, CNY, amount 100000.00, valuationDate 2026-03-05, timing begin | 期初外部流 |
| t2 | cash-in | us-main, USD, amount 10000.00, valuationDate 2026-03-05, timing begin | 期初外部流，跨币种 |
| t3 | buy | cn-main, SH600519, tradeDate 2026-03-05, qty 500, price 100.00, commission 5.00, tax 0.00, otherFees 1.00 | 成本 50006.00，avgCost 100.012 |
| t4 | buy | us-main, AAPL, tradeDate 2026-03-05（纽约周四）, qty 20, price 150.00, commission 1.00, tax 0.00, otherFees 0.00, createdAt 2026-03-06T03:12:00+08:00 | **跨北京午夜**：成交在上海 03-06 凌晨，进入检查点 03-06 |
| t5 | dividend | us-main, AAPL, exDate 2026-03-09, payDate 2026-03-12, gross 5.00, withholding 1.00, net 4.00 | ex → 检查点 03-10 应收；pay → 检查点 03-13 现金 |
| t6 | fx-conversion | us-main, effectiveDate 2026-03-10, USD 1000.00 → CNY 7150.00, feeCurrency USD, fee 0.00 | 实际成交 7.15，参考 FX 7.20 → 换汇价差 −50.00 |
| t7 | sell | cn-main, SH600519, tradeDate 2026-03-11, qty 200, price 99.00, commission 5.00, tax 9.90, otherFees 1.00 | 净所得 19784.10，处置成本 20002.40，已实现 −218.30 |
| t8 | split | us-main, AAPL, effectiveDate 2026-03-12, factor 2 | 纽约 03-12 起按新股数交易 → 检查点 03-13 |
| t9 | cash-out | cn-main, CNY, amount 20000.00, valuationDate 2026-03-16, timing end | 期末外部流 |
| t10 | cash-out | us-main, USD, amount 2000.00, valuationDate 2026-03-17, timing end | 末日期末外部流，跨币种 |

**未复权收盘（`data/market-raw/`）**：

| 日期 | SH600519（上海日） | AAPL（纽约日） | USDCNY（Yahoo `CNY=X`，日期 f） |
|---|---|---|---|
| 03-04 | — | — | 7.0000 |
| 03-05 | 101.00 | 152.00 | 7.0500 |
| 03-06 | 102.00 | 155.00 | 7.1000 |
| 03-09 | **无 bar（停牌）** | 154.75（除息 0.25） | 7.2000 |
| 03-10 | 98.00 | 156.00 | 7.1500 |
| 03-11 | 99.00 | 158.00 | 7.1000 |
| 03-12 | 99.50 | 80.00（2:1 拆股后） | 7.0500 |
| 03-13 | 101.00 | 81.00 | 7.0000 |
| 03-16 | 100.00 | 82.00 | 6.9500 |
| 03-17 | 100.50 | （03-17 bar 要到检查点 03-18 才可得，不用） | — |

**逐检查点：使用的观测与生效事件**（age = 检查点日期 − 观测日期）：

| 检查点 | 周 | A 股 bar（age） | 美股 bar（age） | FX 日期（age）= 值 | 该检查点生效事件 |
|---|---|---|---|---|---|
| 03-05 | 四 | 03-05（0） | 无持仓 | 03-04（1）= 7.0000 | t1、t2 begin；t3 |
| 03-06 | 五 | 03-06（0） | 03-05（1） | 03-05（1）= 7.0500 | t4 |
| 03-07 | 六 | 03-06（1） | 03-06（1） | 03-06（1）= 7.1000 | — |
| 03-08 | 日 | 03-06（2） | 03-06（2） | 03-06（2）= 7.1000 | — |
| 03-09 | 一 | 03-06（3，停牌） | 03-06（3，纽约周一尚未收盘） | 03-06（3）= 7.1000 | — |
| 03-10 | 二 | 03-10（0） | 03-09（1） | 03-09（1）= 7.2000 | t5 应收 4.00；t6 |
| 03-11 | 三 | 03-11（0） | 03-10（1） | 03-10（1）= 7.1500 | t7 |
| 03-12 | 四 | 03-12（0） | 03-11（1） | 03-11（1）= 7.1000 | — |
| 03-13 | 五 | 03-13（0） | 03-12（1） | 03-12（1）= 7.0500 | t8（先）；t5 应收转现金 |
| 03-14 | 六 | 03-13（1） | 03-13（1） | 03-13（1）= 7.0000 | — |
| 03-15 | 日 | 03-13（2） | 03-13（2） | 03-13（2）= 7.0000 | — |
| 03-16 | 一 | 03-16（0） | 03-13（3） | 03-13（3）= 7.0000 | t9 end |
| 03-17 | 二 | 03-17（0） | 03-16（1） | 03-16（1）= 6.9500 | t10 end |

**逐检查点估值与子期收益**（金额精确十进制，CNY；`r_d` 双精度，容差 1e-9）：

| 检查点 | cn 现金 | SH 市值 | us USD 现金 | AAPL USD 市值 | USD 应收 | USD 合计 × FX | us CNY 现金 | `V_d` | `CF^B_d` | `CF^E_d` | `r_d` |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 03-05 | 49994.00 | 50500.00 | 10000.00 | 0 | 0 | 70000.00 | 0 | 170494.00 | 170000.00 | 0 | 0.0029058824 |
| 03-06 | 49994.00 | 51000.00 | 6999.00 | 3040.00 | 0 | 70774.95 | 0 | 171768.95 | 0 | 0 | 0.0074779758 |
| 03-07 | 49994.00 | 51000.00 | 6999.00 | 3100.00 | 0 | 71702.90 | 0 | 172696.90 | 0 | 0 | 0.0054023151 |
| 03-08 | 49994.00 | 51000.00 | 6999.00 | 3100.00 | 0 | 71702.90 | 0 | 172696.90 | 0 | 0 | 0 |
| 03-09 | 49994.00 | 51000.00 | 6999.00 | 3100.00 | 0 | 71702.90 | 0 | 172696.90 | 0 | 0 | 0 |
| 03-10 | 49994.00 | 49000.00 | 5999.00 | 3095.00 | 4.00 | 65505.60 | 7150.00 | 171649.60 | 0 | 0 | −0.0060643822 |
| 03-11 | 69778.10 | 29700.00 | 5999.00 | 3120.00 | 4.00 | 65229.45 | 7150.00 | 171857.55 | 0 | 0 | 0.0012114797 |
| 03-12 | 69778.10 | 29850.00 | 5999.00 | 3160.00 | 4.00 | 65057.30 | 7150.00 | 171835.40 | 0 | 0 | −0.0001288858 |
| 03-13 | 69778.10 | 30300.00 | 6003.00 | 3200.00 | 0 | 64881.15 | 7150.00 | 172109.25 | 0 | 0 | 0.0015936763 |
| 03-14 | 69778.10 | 30300.00 | 6003.00 | 3240.00 | 0 | 64701.00 | 7150.00 | 171929.10 | 0 | 0 | −0.0010467189 |
| 03-15 | 69778.10 | 30300.00 | 6003.00 | 3240.00 | 0 | 64701.00 | 7150.00 | 171929.10 | 0 | 0 | 0 |
| 03-16 | 49778.10 | 30000.00 | 6003.00 | 3240.00 | 0 | 64701.00 | 7150.00 | 151629.10 | 0 | −20000.00 | −0.0017449053 |
| 03-17 | 49778.10 | 30150.00 | 4003.00 | 3280.00 | 0 | 50616.85 | 7150.00 | 137694.95 | 0 | −13900.00 | −0.0002252206 |

手算校验点：`r_03-05 = 170494/170000 − 1`；`r_03-16 = (151629.10 + 20000)/171929.10 − 1`；`r_03-17 = (137694.95 + 13900)/151629.10 − 1`（USD 2000 × 6.95 = 13900）。

**期望输出**：

- 累计 TWR = `Π(1+r_d) − 1 = 0.0093555623`；闭式核对：`171629.10/170000 × 151594.95/151629.10 − 1`。
- 年化 TWR 与收益口径差 = `unavailable(short-period)`（跨度 12 天）。仅供公式单测的强制年化值：`(1.0093555623)^(365/12) − 1 = 0.3274265340`。
- XIRR 现金流（投资者视角、CNY、日期 = 检查点日期）：03-05 `−170000.00`；03-16 `+20000.00`；03-17 `+13900.00 + 137694.95 = +151594.95`。唯一根 `XIRR = 0.3321943242`（`Σ CF_j/(1+r)^((d_j−d_0)/365)`，d_0 = 03-05，天数 11 与 12）。
- 期末持仓（`deriveHoldings`）：cn-main 现金 CNY 49778.10；SH600519 qty 300、costBasisLocal 30003.60、avgCostLocal 100.012、realizedPnlLocal −218.30、unrealized +146.40；us-main 现金 USD 4003.00 + CNY 7150.00；AAPL qty 40、costBasisLocal 3001.00、avgCostLocal 75.025、costBasisBase 21157.05、netIncomeLocal 4.00（gross 5.00 / withholding 1.00）、netIncomeBase 28.80（4.00 × 7.20）、unrealized local 279.00。
- 归因恒等式（第 8.5 节，CNY）：`V_end − Σ外部流 = 137694.95 − (170000 − 20000 − 13900) = 1594.95` = SH 本地价格贡献 `−71.90`（−218.30 + 146.40）+ AAPL 本地价格贡献 `1939.05`（279 × 6.95）+ AAPL 汇率贡献 `−300.10`（3001 × 6.95 − 21157.05）+ 净收入 `28.80` + 现金汇率贡献 `49.10`（27820.85 − (70000 − 21157.05 − 7200 + 28.80 − 13900)）+ 换汇价差 `−50.00`（7150 − 1000 × 7.20）。六项之和 1594.95，逐位相等。
- 归一化 HHI（03-17，按 CNY 市值 SH 30150.00 与 AAPL 3280 × 6.95 = 22796.00，合计 52946.00，现金不计）：`w_SH = 0.5694481169`、`w_AAPL = 0.4305518831`，`H = 0.5096460819`，`H* = (H − 1/2)/(1 − 1/2) = 0.0192921638`（n = 2，容差 1e-9）。
- 笔记区间经济结果（AAPL, us-main, 03-06 → 03-17，区间含起点检查点的买入）：`3280.00 + 0 + 4.00 − 0 − 3001.00 = 283.00 USD`；position XIRR（USD 流：03-06 −3001、03-13 +4、03-17 +3280）唯一根 `18.91713526`（容差 1e-6；超过 1000% 属正常展示，标注期限 11 天）。

**不变量（validate 逐条断言）**：

1. 03-07/03-08/03-09/03-15 无新观测无外部流 → `r_d = 0`，链式乘积不受周末与停牌影响。
2. 03-10：AAPL 除息日组合 USD 价值 `3095 + 4 = 3099` 对比前一检查点 `3100`，差额恰为扣税 1.00；分红不进入 `CF`。
3. 03-13：拆股与新口径价格同边界配对，AAPL USD 市值 3160 → 3200（+1.27%），无 +100% 假跳变；应收 4.00 转现金不改变 USD 合计。
4. 03-10：换汇后 USD 合计 × FX + CNY 现金 = `65505.60 + 7150.00`，相对未换汇少 50.00，全部体现在 `r_d` 与换汇价差。
5. 03-05 与 03-17 的跨币种外部流均按同检查点 `eligibleFx` 折算，`V` 与 `CF` 使用同一汇率，纯现金流入当日不产生汇率收益。
6. 美股 03-05（EST）与 03-09（EDT）的 bar 都在 `t+1` 检查点首次进入，IANA 计算与推论表一致。

**负向变体（各一条断言）**：

- **N1 漏录 split**：删除 t8 → 03-13 检查点 AAPL 未复权价 80/158 − 1 = −49.37%（≥35%）触发 `suspected-missing-corporate-action`（AAPL，2026-03-12），严格 TWR 自 03-13 起 `unavailable`；持仓仍显示 qty 20 并带阻断说明。
- **N2 缺 timing**：t1 删除 `timing` → `parseTransactions` 拒绝整份账本，错误定位 `t1.timing`；不得输出任何 TWR。
- **N3 timing 语义**：t2 改为 `end` → `r_03-05 = (170494 − 70000)/(0 + 100000) − 1 = 0.00494`，其余 `r_d` 不变，累计 TWR = `0.0114027613`；证明 begin/end 必须显式。
- **N4 口径混淆**：AAPL sidecar 改为 `adjust:"adj"` 或 `purpose` 缺失 → `missing-raw-data` 列出 `data/market-raw/AAPL.csv`，TWR 自 03-06 起不可用，本地成本/已实现照常显示。
- **N5 汇率年龄边界**：USDCNY 文件截断到 03-06 → 03-16 检查点 `fxAgeCalendarDays = 10` 仍可用，03-17 = 11 → 自 03-17 起 `unavailable(fx-age-exceeded)`。

## 9. 公司行动与两套口径边界

**原则：价格复权用于研究回测；真实持仓账本以交易/公司行动现金流与数量变化为权威。两者由目录与 sidecar 语义双重隔离。**

| 事项 | 研究口径（data/market/，复权价） | 账本口径（transactions + data/market-raw/，真实价） |
|---|---|---|
| 分红 | 取决于研究 sidecar 的 adjust 语义；研究引擎不得再加同一分红 | `dividend`：exDate 税后应收、payDate 转现金；组合层内部事件，不作为外部 XIRR/TWR 流，不调成本 |
| 拆股 | 已折入复权价格 | `split` 交易：数量与成本按 factor 调整，零现金流 |
| 送转 | 已折入复权价格 | `stock-dividend`：数量增加、成本摊薄，零现金流 |
| 合并/退市 | 研究数据按供应商 sidecar 解释 | `reorganization`：新股、现金对价和成本分配守恒；信息不足即阻断，不伪装成卖出 |
| 历史市值 | 禁止使用（复权价 × 数量无意义） | rawClose × 当时数量；拆股日前后由 split 交易保证数量连续 |
| 回测收益 | runBacktest 输出（总回报口径） | 禁止使用（回测是假设性推演，不是账本） |

**双重计算的两个具体禁区**（验收测试各覆盖一条）：

1. 分红不得既出现在账本收入、又通过复权价混入市值；账本用未复权价，分红只形成一次应收/现金收入，组合收益率通过净值变化体现而不把它再列为外部流。
2. 拆股不得既调数量、又因用了复权价而再被价格折算一次——`data/market-raw/`（adjust=none）保证价格是当日真实成交价，数量调整完全由 `split` 交易承担。

**公司行动与未复权价的同边界配对（实现规则）**：

- `split`/`stock-dividend`/`reorganization` 的 `effectiveDate` 定义为**首个按新股数交易的本地交易日**（美股 = split ex-date，A 股 = 除权日）。该日期的未复权 bar 已经是新股数口径的价格；它与数量因子经同一映射（A 股 `d`→`d`，美股 `t`→`t+1`）进入**同一个**上海检查点，并在该检查点内先于买卖重放。因此检查点 `c−1` 用旧数量 × 旧口径价，检查点 `c` 用新数量 × 新口径价，两者之间不出现虚假跳变（G1：03-12 检查点 20 × 158 = 3,160 USD，03-13 检查点 40 × 80 = 3,200 USD，`r` 只反映 +1.27% 的真实变动）。
- 若数量与价格错位一个检查点（例如把美股 split 直接按上海日期生效），会出现 40 × 158 = 6,320 的 +100% 假收益；validate 必须有这条负测试。
- 用户漏录 split 时，`suspected-missing-corporate-action`（单日 |Δ| ≥35%）从该检查点阻断严格收益；G1 去掉 t8 后 80/158−1 = −49.37% 必须触发。
- 分红现金进入资产的时点：exDate 映射检查点 → `dividendReceivables` 增加税后 `net`（同一检查点 bar 已除息，组合价值只减少扣税）；payDate 映射检查点 → 应收转现金。两步都在组合边界内，任何一步都不改变 `CF^B/CF^E`。
- 研究目录的 qfq/adj 价格永远不得进入账本估值：`portfolio.mjs` 读取任何 CSV 前校验 sidecar `purpose === "portfolio-valuation"` 且 `adjust === "none"`，不符即返回 `missing-raw-data` 并列出文件，而不是回退到研究数据。

**用户责任与工具辅助**：v1 公司行动靠手动录入。引擎可静态审计「未复权价单日绝对跳变 ≥35% 且附近无公司行动事件」，只输出“疑似漏录，严格收益已暂停”；这个启发式不能证明公司行动，更不是可回测预测规则。SEC corporate-action/filing 信息只能辅助定位，不能自动改账。

## 10. 持仓分析规则与优先级

纯规则、纯引擎：`analyzePortfolio` 先输出财务数值证据，独立
`evaluatePortfolioRules(analysis, context)` 再输出稳定排序的结构化结论数组；阈值集中在导出的
只读 `PORTFOLIO_RULE_THRESHOLDS`，UI 不复制公式或比较。每条结论包含：规则 id、分类、条件、
actual、threshold、输入指纹、数据时间、对称基线和限制。agent 只在用户点击「让 Agent 解释」
时基于这份结构化输出做解释，不得重算或补动作建议。规则按优先级分层：

**P0 数据可信度（先于一切结论）**

- `stale-quotes`：任一 source 的 quoteTime 超过其常规收盘 freshness 窗口；不用全局 fetchedAt 掩盖单标的旧价。
- `ledger-fingerprint-mismatch`：holdings 与 transactions 指纹不符（自动触发重放，同时展示发生过）。
- `missing-raw-data`：任一持仓缺 `data/market-raw/` 行情（给出同步命令）。
- `suspected-missing-corporate-action`：未复权价单日绝对跳变 ≥35% 且附近无公司行动事件；只作静态审计并阻断受影响收益。
- `fx-source-divergence`：同一日期 Yahoo `USDCNY` 与 ECB 校验值相对偏差 >1%（`|yahoo − ecb| / ecb`）；只提示“参考汇率源分歧，核算仍按 Yahoo”，不切换源、不阻断。校验文件缺失时该规则不触发也不报错。
- `provisional-checkpoints`：序列尾部存在 `provisional:true` 的检查点数；提示等待同步确认。

**P1 风险结构**

- `concentration-band`：连续展示归一化 HHI `H*`（0 = 等权，1 = 全押）、原值 `H` 与 n，并给出
  描述性分箱：`H* < 0.25` 为 lower、`0.25 <= H* < 0.50` 为 middle、`H* >= 0.50` 为 higher。
  **0.25/0.50 是产品启发式分箱，不是行业标准**（`PORTFOLIO_RULE_THRESHOLDS["concentration-band"].basis
  = "product-heuristic"`）；分箱只作描述，不贴好坏，因此该规则状态恒为 neutral、不进入 warning；
  同时显示“按标的、不按发行人”限制，不只在 higher 时出现。
- `position-weight-extremes`：最大与最小正权重并列展示，不给目标权重。

**P2 收益结构（亏损与失误同等呈现）**

- `pnl-contributors`：全部盈利、亏损与持平标的按绝对贡献统一排序，分别给合计；不能只列一侧或只折叠负面。
- `return-method-gap`：展示 XIRR、年化 TWR 与中性“收益口径差”；绝不命名 timing alpha/drag。
- `decision-outcomes`：met/partial/missed/undecidable/未到期/待复盘完整计数和比率并列；不把用户自评当模型准确率。

**P3 待办关联**

- `review-due`：到期未复盘的决策笔记数。
- `alerts-triggered`：关注规则最近一次检查的触发项。

分类契约：

- **可回测**：只有研究页中同时定义入场、退出、成本与评价目标的完整策略；可走现有 walk-forward。单个 RSI/回撤/绝对价格提醒即使能重放触发，也不是策略回测。
- **可历史复算**：关注规则触发历史、组合 TWR/XIRR、贡献、集中度与笔记 outcome；能从冻结输入复算过去状态，但不能据此宣称预测有效。
- **只能静态审计**：stale、指纹、缺文件、unsupported event、source health、疑似公司行动与资讯关联；它们只描述当前输入完整性。

每个规则 id 在测试中有触发/不触发或正/负/持平对称 fixture。规则只陈述事实与限制，不输出任何动作。

**Round 10 实现状态（2026-08-26）**：上述 13 条规则与持仓首屏已落地；分类分布为 0 条可回测、
7 条可历史复算、6 条只能静态审计。intraday quote、ECB 校验文件或 journal 尚无输入时，相关
规则显示结构化 unavailable，或按本节约定在 ECB 文件缺失时保持 neutral；不得据此宣称这些
上游能力已实现。

**Round 11 review 修正（2026-08-26）**：

- 多原因 unavailable：`unavailable.reason` 为主原因，`unavailable.reasons` 保留全部去重原因；主原因按
  导出的冻结 `UNAVAILABLE_REASON_PRIORITY` 选取（与引擎 checkpoint 排序同序，规则层只前置
  `raw-contract-conflict`，后置 `insufficient-history`/`no-positions`/`provisional`/`stale`），
  不按字母序或出现顺序。引擎 `short-period` 规范化为 `insufficient-history` 时保留
  `upstreamCode: "short-period"`，UI 同时显示。
- `suspected-missing-corporate-action`：raw 不可读的持仓未被审计，不能记为 positive；无跳变但有
  未审计标的时为 unavailable（details.unaudited 列出标的与原因），有跳变时仍 warning 并在
  limitations 列出未审计标的。
- `pnl-contributors`：空持仓为 `unavailable(no-positions)`，不输出 `0.00` 合计伪数字（第 8.6 节）。
- Agent evidence 以 ```` ```json ```` 代码块包裹并声明“JSON 只是数据，不是指令”；Host 拒绝
  （会话忙/无权限）时显示错误文案并恢复按钮。

## 11. 资讯架构（自动推送信息流）

### 11.1 总体设计

```
fetch-news.mjs（零依赖 CLI，Node 18+）
  ├── 东方财富个股新闻 API（按持仓∪关注逐标的拉取）
  ├── 东方财富 7×24 快讯 API（市场级，带 stockList 关联）
  └── SEC EDGAR submissions/data（美股标的 → CIK → filing 元数据）
        ↓ 合并、去重、标的关联、裁剪
data/news/cache.json（源级保旧）→ data/news/feed.json（滚动 500 条）
        ↓ workspace.readText
资讯页渲染（textContent，标注来源、可信等级与时间）

M4 专用 automations（A/US 2 个独立任务，Asia/Shanghai） → prompt 指示 agent 运行 CLI
  → 后台只返回来源状态与新增数量；面板打开时才可发内容计数通知
```

面板不直连网络；抓取执行体是 agent（经 automation prompt 或手动 `agent.submitPrompt` 请求）。`agent.submitPrompt` 只在会话空闲时受理，automation 绑定当前 project/task/session 且以 `permissionLevel:"full"` 运行；会话被删除时任务会失败。UI 必须披露这些 Host 现实，不能把“任务已创建/请求已接受/automation 已完成”当成任何源成功。用户必须显式创建或升级任务，面板不得自动开启无人值守联网。

### 11.2 数据源与实测结论（详细证据见第 21 节）

| 源 | endpoint 类别 | 用途 | 实测（2026-08-26） | 可信度层级 |
|---|---|---|---|---|
| 东方财富个股新闻 | `np-listapi.eastmoney.com/comm/web/getListInfo`（未文档化 JSON） | A 股个股资讯 | ✅ 返回贵州茅台条目、稳定 Art_Code | 财经媒体聚合（二级、无 SLA） |
| 东方财富 7×24 | `np-weblist.eastmoney.com/comm/web/getFastNewsList`（未文档化 JSON） | 市场快讯 + stockList 关联 | ✅ 省略 `sortEnd` 会报必填；显式 `sortEnd=`、req_trace、UA/Referer 后返回条目 | 财经媒体快讯（二级、无 SLA） |
| SEC EDGAR | `data.sec.gov/submissions/CIK##########.json` + 官方 ticker→CIK 映射 | 美股/在美申报主体的 8-K、10-Q、10-K、6-K、20-F、DEF 14A 等 filing 元数据 | ✅ 描述性 User-Agent 下返回 AAPL/Apple recent filings | 官方一级 |
| Yahoo Finance RSS | 个股 RSS | 曾考虑的美股资讯 | ❌ 本轮 RSS 404；条款限制未经许可的自动采集 | **不纳入自动资讯源**（chart 行情/汇率见第 7.3 节，属用户确认的独立决策） |
| 新浪财经（roll / 7×24） | `feed.mix.sina.com.cn`、`zhibo.sina.com.cn` | 曾考虑的备选 | ❌ 本机 SSL_ERROR_SYSCALL，连接被重置 | **不纳入** |
| 财联社电报 | `www.cls.cn/nodeapi/telegraphList` | 曾考虑的备选 | ❌ 返回 HTML 页面（接口需签名参数） | **不纳入** |

**单一方案**：A 股用东方财富个股 + 7×24，美股用 SEC official filing metadata，Yahoo RSS 自动资讯源移除（Yahoo chart 作为行情/汇率源是另一决策，见第 7.3 节）。SEC 是官方披露但不是一般新闻；界面模块因此称“资讯与申报”，美股分组固定标“仅申报”，不能暗示覆盖所有美股新闻。“自动推送”的判定标准：用户完成一次性启用后，两市场都由 automation 按第 13.2 节时点无人工介入地更新——A 股每个工作日 4 次、美股每个纽约交易日开盘后与收盘后各 1 次；两市场的失败/stale 语义相同（第 11.7 节），只是覆盖内容类型不同。东方财富接口未文档化且站点条款没有给予本产品稳定 API/SLA 承诺：仅在用户显式 opt-in 后用于个人本地、低频、只存标题/时间/链接/标的，不抓摘要/正文、不再分发；条款、robots 或响应结构变化即停用，不绕过签名、登录、验证码或限制。SEC 按官方 fair-access 要求配置含应用名和联系邮箱的 User-Agent，本产品内部限速 ≤1 req/s、串行缓存 ticker→CIK，远低于官方上限；只存 filing 元数据和官方链接，不镜像全文。

### 11.3 抓取调度

- **定时**：M4 使用两个专用、逐市场独立的 automation，不修改第 13.2 节 M3 watch 任务。A 股工作日 10:10/15:10；美股周二至周六 06:35（北京时间、收盘后）；不承诺交易所节假日命中。市场为空不建，部分失败隔离，字段漂移可更新，清单清空后的孤儿任务仍可见并可关闭。
- **手动**：资讯页刷新按钮 → `agent.submitPrompt`。
- CLI 幂等：重复运行只增量合并；无新条目时 items 不变，但每个 source 的 attempt/success 状态独立更新。请求 timeout 10s、响应体上限 2 MiB、每源页数与条目数有硬上限、总并发 ≤2；429 尊重 `Retry-After`，本次不立即重试，5xx 最多一次带 jitter 的重试。

### 11.4 标的关联

- 个股源天然关联（按 symbol 逐个请求，A 股映射 `SH600519 → mTypeAndCode=1.600519`、`SZ000001 → 0.000001`，前缀映射规则与 `cnPrefixed` 的交易所推断一致）。
- 7×24 源用接口自带 `stockList` 字段做确定性关联（实测该字段存在）；**不用正则解析新闻正文来猜标的**。
- 抓取范围 = 持仓 ∪ 关注的 canonical instrument symbol。CLI 通过仓库中的 `data/news/subscriptions.json` 读取 `{version:1, enabledSources:["eastmoney-stock","eastmoney-724","sec-edgar"], symbols:[...], secContact:"AppName contact@example.com"}`；文件不得含数量、成本、账户或笔记；每个源都在启用卡中独立勾选，未勾选即 `not-enabled`。清单变更（持仓/关注增删）后面板在用户确认下用冲突检查重写 symbols；automation prompt 只运行固定命令，不嵌入持仓详情或外部标题，清单更新也无需重建任务。SEC fair-access 要求可识别 User-Agent：`secContact` 由用户在启用卡中填写（启用卡明示“将写入仓库文件并随每次 SEC 请求发送”），CLI 仅以它构造 User-Agent；缺失或空白时该源返回 `configuration-required`，其值不写 inbox/log。**不依赖环境变量**——automation 触发的 agent shell 环境不可控，环境变量方案不可验证。
- SEC 只对能由官方映射解析到 CIK 的 instrument 抓取；映射失败显示 `unsupported-symbol`，不猜 CIK。申报用官方 accession number 关联标的。

### 11.5 去重与聚类

- 去重键：`em:<Art_Code>`、`sec:<CIK>:<accession>`；然后按规范化 HTTPS URL 去重。只删除硬编码的 utm 等跟踪参数，不删除未知 query，不把 http 自动升级后盲目信任。
- 聚类 v1 只做**按标的分组**（确定性）；标题相似度聚类依赖对散文的模糊匹配，不符合确定性原则，列为非目标。

### 11.6 噪声治理

1. 只拉组合相关标的的个股新闻（源头限流）。
2. 7×24 只保留 `stockList` 确定命中订阅标的的条目；v1 不保留未关联头条，避免把“市场热榜”变成隐性推荐。
3. 收件箱滚动上限 500 条。
4. SEC forms 只保留固定 allowlist；不做 LLM 情绪/重要性排序，按 publishedAt 倒序。
5. `notifications.send` 是 panel Host API，后台 agent 不能直接调用。automation 只在会话结果中报告“各源状态 + 新增 confirmed 条数”，由 CodeShell 提供通用任务完成/失败通知。内容通知仅在面板活跃、重新读取 feed 并先成功条件写入 `notified.json` 后发送；候选只按订阅、关联强度、新鲜度和持久去重判断，不做情绪/重要性判断。文案仅陈述标题、来源、时间、关联标的和覆盖限制；弱关联/未关联不通知。每次最多 5 条，账本写失败零发送；通知权限关闭、面板未打开或 CodeShell 未运行时不保证通知。

### 11.7 stale 与失败降级

- 每个源独立记录 `status ∈ {not-enabled, configuration-required, ok, error}`、`lastAttemptAt/lastSuccessAt/consecutiveFailures/errorCode`；一源失败不影响他源，失败 attempt 不更新 success。
- 已启用源：`lastSuccessAt` >12 小时 → stale；>72 小时 → 显著错误；已启用但没有成功记录即 `never-succeeded`。`not-enabled` 与 `configuration-required` 永不计 stale。
- 全部源失败 → 保留上次 inbox 内容 + 顶部失败原因；CLI 网络全挂时不写空文件覆盖旧数据（合并语义天然保证）。
- endpoint 失效（改版/加鉴权）的长期降级：资讯页降级为「源不可用」状态页 + 保留历史条目，面板其余五模块零依赖资讯，不受影响。

### 11.8 权限与安全

- CLI 只做 GET，发送 canonical symbol/CIK 与必要请求头；不发送数量、成本、账户、笔记。无 cookie、无登录态；endpoint origin、最终重定向 origin 和外链 origin 各有硬编码 HTTPS allowlist，重定向逐跳校验，禁止 file/http/localhost/私网目标。
- 标题、URL、来源字段均是不可信输入且可能含提示注入。用 DOM node + `textContent`，禁止把来源 HTML/摘要交给 `innerHTML`；不得把标题/正文写进 agent/automation prompt 或通知 payload。CLI 只返回结构化计数与 id。
- 外链经 URL parser 验证 protocol/hostname 后调用 `external.open`，Host 二次确认；拒绝来源提供的 `javascript:`、userinfo、混淆 hostname。
- 文件写入使用 7.4 的锁与原子替换；日志不记录 API key、完整响应或组合数据。

### 11.9 资讯测试

- validate.mjs：用脱敏、最小化真实 fixture 断言三源字段映射、7×24 必需参数、SEC CIK/accession、去重、关联、幂等、body/page cap、429/timeout、坏 JSON、锁竞争与失败不刷新 lastSuccess；测试不打真网。
- e2e：stub inbox 断言分组、source 独立 stale/失败、`<script>`/`javascript:`/混淆域被当文本或拒绝、external.open 只接收 allowlisted HTTPS、手动刷新“已请求≠已完成”、空态和通知节流。

## 12. 笔记与复盘（补充规则）

- 决策笔记的实际结果严格复用 6.6 的 account×instrument 区间经济结果；价格路径、已实现/未实现、净收入是对象中的独立字段，禁止把百分比与金额相加，也禁止把拆股后的 raw 起止价直接当总回报。公司行动、行情或 FX 不完整时显示不可用原因。界面并列预期原文与实际数字，outcome 由用户判断，系统不解析散文。
- `reviewAt` 到期提醒进入今日页第 5 卡与持仓分析 P3；不单独建 automation。
- 笔记与交易的关联是双向可见的：流水行显示关联笔记图标，笔记显示关联交易摘要。

## 13. 提醒与市场时段

### 13.1 市场窗口

- A 股：固定北京时间工作日 09:30–15:00。
- 美股：按用户确认的固定北京时间工作日 21:30–次日 04:00；窗口归属开始日，周五窗口延续到周六 04:00。美国 DST 不改变本产品这一显示口径。两者都不内置交易所节假日日历，因此只能称“常规窗口”；quote/source stale 是独立真相。

### 13.2 automation 设计（2 个独立市场任务，timezone 固定 Asia/Shanghai）

| 名称 | cron | 覆盖 | 动作 |
|---|---|---|---|
| `投资工作台 · A股窗口` | `10 10,15 * * 1-5` | 北京 10:10（开盘后，盘中未完成 bar）/ 15:10（收盘后，完整日 bar） | 只处理 A 股关注标的，复用既有 `fetch-market-data.mjs` 与 watch 引擎；只在触发时通知 |
| `投资工作台 · 美股开盘后` | `35 22 * * 1-5` | 北京 22:35（EDT 为纽约 10:35、EST 为 09:35，两季都在开盘后） | 只处理美股关注标的，复用同一 fetch/watch 契约；只在触发时通知 |

时点决策（Round 13）：每市场“至少两个、不是每小时”。A 股原四时点（10/11/14/15）会对同一未变化触发重复通知四次并四倍抓取，收敛为开盘后 + 收盘后两点。美股窗口跨北京午夜，Host cron 是单一 5 字段表达式，无法在一个任务里同时表达“周一至五 22:35”与“周二至六 04:05”而不在周一凌晨/周六晚产生窗口外空跑；收盘后时点又随 DST 在 04:00/05:00 之间漂移。因此美股在“两个任务”约束下保留唯一稳健的开盘后时点，收盘后 raw/FX 同步留待 M4 单独任务决策。prompt 要求同一 rule id 在同一 asOf 已通知过时只报告 unchanged。

- cron 错开只能降低碰撞，不能替代 7.4 的互斥锁。
- prompt 逐市场包含 canonical symbol 与既有 watch rule JSON（`signal-entry` 必须附带其 strategy 快照，否则 `evaluateWatchItem` 无法执行），明确调用 `evaluateWatchItem`/`rankWatchResults`，不复制触发计算；bundled fetcher 使用 CodeShell 安装器的真实 POSIX 路径 `$HOME/.code-shell/panel-apps/quant-lab/app/tools/fetch-market-data.mjs`（安装器对 GitHub 与本地文件夹安装都整目录复制到该处），不得写 Host 不会替换的 `<panel>` 模板；`$HOME` 只由 shell 展开，路径检查必须用 shell `test -r`，可用 `installed.json` 核对，仍缺失时记录 `bundled-fetch-tool-not-found / unavailable`，禁止猜测其他路径、估算或发送触发通知。抓取禁止 `--force`：先读 `data/market/<symbol>.meta.json` 的 `adjust` 原样传 `--adjust`，基准冲突记录 `adjust-basis-conflict / unavailable`，不得改写用户研究数据基准。prompt 长度受 Host 20000 字符上限约束：超限时面板按市场给出结构化 `prompt-too-long` 错误、不调用 Host。所有数值只能来自 CSV/引擎，禁止估算、补零、建议，只在 `triggered === true` 时通知。A/美分组互不混入；市场为空不创建对应任务。automation 以 full permission 运行并绑定当前 session，UI 必须披露会话删除/设备休眠/通知配额，不自动请求凭证。
- 开启、重试、关闭均先 `automations.list` 按精确名称识别，已有同名任务只在字段漂移时 `update`，因此可重入且不重复创建。一市场创建/删除失败只标该市场，不回滚或误报另一市场。关注列表变化后已开启任务显示“关注列表已变化”并提供“更新”；某市场关注清空后其任务显示为孤儿任务、仍可关闭，不得读作“无任务”。
- 每次 agent 最终输出固定为 source status/new-count/failed-count；内容级通知遵循 11.6，不能在后台假设可调用 panel Host API。
- 旧任务「Quant Lab · 每日盯盘」迁移见 6.3；旧任务只按精确旧命名形态 `Quant Lab · 每日盯盘（N 个标的）` 识别，仅共享前缀的用户任务不是迁移候选；确认按钮前必须逐字列出将被移除的任务名。Host 没有 `automations.get`，创建后验证必须再次调用真实 `automations.list`。

### 13.3 时区实现规则

- 所有 automation 显式传 `timezone: "Asia/Shanghai"`（现有代码取浏览器时区兜底 Asia/Shanghai，改为显式固定——盘中窗口语义不应随用户设备时区漂移）。
- 面板内展示时间一律带日期与时区语境（quoteTime 原样保留来源时区的 ISO 串，展示时转本地并悬停显示原始值）。
- 测试必须覆盖 A 股边界、美股跨北京午夜、周末，以及一个 EDT 日期和一个 EST 日期；两季都必须保持用户确认的固定 `21:30–04:00`。

## 14. 迁移与兼容

### 14.1 保持不变

- 面板 id `quant-lab`、安装记录（installed.json）、「Update from source」升级路径。
- 面板 storage：研究配置 key（`scopedStorageKey("configuration", …)`）名称、结构和按 workspace 隔离方式不变；activeTab 是新 key，默认 `today`。storage 总容量受 Host 256 KiB 限制，账本/资讯/笔记绝不放 storage。
- `data/market/`、`quant/strategies/`、`quant/reports/` 的路径与格式；`*.quant.json` 契约（`formats/quant-strategy-v1.schema.json`）不动。
- engine.mjs 全部导出的签名与行为（validate.mjs 现有断言即回归保障）。

### 14.2 显式迁移点

1. panel.json：保留 id `quant-lab`，version 0.4.1 → 0.5.0，显示名改「投资工作台」；M0 不新增权限，`external.open` 到 M4 外链落地时再加。已安装记录仍按 id 命中，用户通过 Update from source 审阅更新；验收需对既有安装做真实升级而非只测新装。
2. watchlist storage 做 6.3 的确定性 canonicalization；config 原样读取。迁移加 `watchlistMigrationVersion:1` 标记且可重入，冲突不丢规则。
3. 新增 `activeTab`，缺失/非法值都回退 `today`；不同 workspace 互不影响。
4. 盯盘 automation 不自动删改。用户点升级后，对有标的的市场创建两个独立任务并逐项 `list` 验证；一市场失败不删除另一市场成功项。界面展示新旧并存，且只有全部所需新任务验证后用户二次确认才删除旧任务，避免提醒空窗。
5. 三个资讯源仍由资讯页启用卡单独 opt-in（第 6.5 节）；M3 双市场关注提醒不得因旧盯盘已启用而自动同意资讯源。M4 新增精确命名的 A/US 两个专用任务，所有 create/update/delete 只匹配这两个名称，M3 任务保持原样。

### 14.3 新文件目录首次创建

`portfolio/`、`data/market-raw/`、`data/quotes/`、`data/news/` 均按需创建（面板写文件时 host 负责路径创建，CLI 用现有 `mkdir recursive` 模式）；不做安装期初始化脚本。

### 14.4 schemaVersion 2 边界（截图导入，v2）

`schemaVersion:2` 只提供声明 panel agent tools/skills 的能力，不等于 Host 自动获得屏幕截图或任意写账权限。v2 的固定边界是：用户主动把券商截图附给 agent → agent tool 只能返回符合第 7.1 节的**候选草稿**与逐字段 confidence/来源框 → 引擎整份校验并展示原图对照 → 用户逐笔确认 → panel 以 `expectedModifiedAt` 冲突检查写入。agent/tool 不直接写 transactions/holdings，不从 panel 画面或剪贴板静默抓取，不因 OCR 低置信度猜标的、数量、方向或费用。manifest 升级、tool input/output schema 与权限另做 v2 安全评审；v1 不实现也不预留误导入口。

## 15. 错误与 stale 总则

| 数据 | 新鲜度判定 | stale 表现 |
|---|---|---|
| 报价 quotes/latest.json | 每标的 quoteTime 超过该市场常规窗口 | 当日盈亏置灰 + 「最新已知报价截至…」 |
| 复权/未复权 CSV | sidecar fingerprint、adjust、purpose、symbol、market 任一不符 | 拒绝进入对应引擎并列出冲突字段 |
| 资讯 cache/feed.json | 每源 lastSuccessAt >12h / >72h | 源级 stale / 显著错误；lastAttempt 失败并列，旧条目保留 |
| holdings.json | transactionsFingerprint 不符 | 自动重放派生 + P0 提示 |
| 历史价格/汇率 | 检查点时仅有前值 | age 计数；>10 自然日阻断受影响严格指标 |

错误处理三原则：(1) 缺文件是引导不是崩溃；(2) 会计账本任一坏条目阻断整份核算，资讯坏条目可隔离但显示计数；两者都不清空文件；(3) 每个不可用状态给出安全下一步，但不把“买/卖”等投资动作当修复。

## 16. 隐私与安全

1. **数据本地化**：持仓、流水、笔记落 workspace；选择联网时只有 canonical symbol/CIK 发给允许源。用户主动请求 Agent 解释时才发送最小结构化证据，默认移除账户名、备注、笔记正文与原始资讯。README 必须披露自动化运行权限、会话依赖、外发字段和关闭方式。
2. **XSS/提示注入**：资讯、笔记、备注、外部 name 全部用 `textContent`/DOM 属性安全赋值；禁止来源 HTML 与字符串拼接 innerHTML。外部内容不得进入 prompt/通知；Agent 解释证据只包含引擎数值、规则 id 和可信本地标签。
3. **路径安全**：所有面板写路径限定白名单前缀（`portfolio/`、`quant/`、`data/`）；CSV/引用路径复用 `isSafeCsvPath`；CLI 文件名白名单沿用 `^[A-Z0-9][A-Z0-9._-]{0,31}$`。
4. **写冲突**：全部 panel 写操作先成功读取并取得 expectedModifiedAt/revision，再写、再读核对，并受 workspaceEpoch 约束。现有 `writeRepoText` 把所有 read 错误当 not-found 的行为不能用于账本；只有 Host 明确 not-found 才可 create。CLI 写走锁 + 同目录原子替换，不能与 panel 写同一权威文件。
5. **凭证**：v1 不使用任何 API key 或登录凭证（腾讯、Yahoo chart、东方财富、SEC、ECB 均为匿名 GET）；唯一的用户提供字段是 SEC `secContact`，它按 SEC 要求随请求发送，用户在启用卡知情后写入仓库文件。所有源都禁用 cookie/登录态。README 须披露：Yahoo chart 为用户确认的行情/汇率源，其条款限制自动采集，本产品只做低频、个人本地、串行请求并在 429 时退化为 stale。
6. **免责声明**：现有 disclaimer 保留并扩展至账本与资讯：「记账与资讯聚合工具，数字仅供参考，不构成投资建议」。

## 17. 测试策略

### 17.1 validate.mjs（`npm run check`）新增断言组

1. **账本核算 golden**：以第 8.7 节 G1 为主 fixture（两账户、两币种、两买一部分卖、佣金/印花税/其他费、换汇、分红 ex/pay、拆股、期初/期末外部流），另补账户转移、后补扣税、送转与三类 reorganization 的小型 fixture，逐位断言数量、现金、移动成本、已实现/未实现、净收入与总损益；期望值由 PRD 中的手算常量提供，禁止新引擎自我对照。
2. **严格 TWR/XIRR**：G1 逐日 13 个检查点的 `V_d`、`CF^B/CF^E`、`r_d`、累计 TWR、`short-period`、XIRR 全部断言；G1 的五个负向变体（N1–N5）各一条。另补：同日多流、零/负权益、in-kind flow、age=10 与 age=11 边界、EST 与 EDT 日期的 `availableAt` 计算与推论表一致、FX 日期时区换算（第 7.6 节）。XIRR 覆盖解析解、无根、多根、接近 −1 和大于 1000% 的根，并与 Excel-compatible 365 日口径比对。
3. **HHI/归因**：n=0 N/A、n=1→1、均配→0、现金不入权重、非正证券市值 N/A；G1 期末断言第 8.5 节恒等式六项之和 = 1,594.95，部分卖出与期末 USD 头寸都断言“本地贡献 + 汇率贡献 = 基准币损益”，分红/现金 FX/换汇价差单列。
4. **校验与原子性**：非法日期、重复/断裂 id、未知事件、超卖、港股、浮点权威字段、负现金、坏 JSON、read 非 not-found 失败、write 冲突、写后核对与 fingerprint 重放；坏账本必须整体阻断而不是隔离继续算。
5. **公司行动与口径禁区**：分红应收/到账只计一次且不是组合外部流；拆股前后 rawClose×quantity 连续；qfq/adj 写入 raw、purpose/fingerprint/symbol 不符全部拒绝；unsupported action 从 effectiveDate 阻断。
6. **资讯 CLI**：fixture 驱动的解析/去重/合并/关联断言（11.9）。
7. **语法检查**：`node --check` 覆盖新增 `portfolio.mjs`、`fetch-quotes.mjs`、`fetch-news.mjs`（沿用现有机制）。

### 17.2 e2e（`npm run test:ui:quant-lab`）扩展

- 现有研究/盯盘断言在 tab 结构下全部保留（6.3、6.4 的验收）。
- 新增：六 tab 导航与键盘可达；旧 watchlist 三种代码形式无损归一；录入交易全流程（含文件不存在时经 `workspace.list` 判定后 create-only 写入、存在但读失败时中止）；今日/持仓数字同源；每标的/每源 stale 与 `not-enabled`；资讯启用卡一步写订阅 + 建 automation 与失败回滚；资讯 XSS/URL/提示注入/空态；复盘对称结果；工作区切换清内存。
- Host stub 覆盖 read/write 的 not-found 与其他异常、modifiedAt 冲突、external.open allowlist、agent busy/accepted-but-not-complete、notifications 权限/节流；M4 automations stub 断言 A/US 两任务、空市场、部分失败、drift/orphan、timezone、prompt ≤20000、full/session/在线依赖，并锁定 M3 任务不变。
- 无建议文案契约：研究结论、分析规则、系统通知和 Agent prompt 不得生成第 4.7 节动作词；交易类型标签与用户原文不在禁词断言范围。正/负/持平 fixture 必须在同一布局呈现。

### 17.3 真实数据验收（发布前手动，记录进 TECHNICAL-PLAN）

用冻结的 SH600519 + AAPL 未复权 CSV、Yahoo `CNY=X` 汇率（附同期 ECB 校验值）和含分红/拆股/跨币种外部流的脱敏样例跑全链路。每日净值、累计/年化 TWR、唯一根 XIRR 与独立表格逐日核对（误差 <0.01pp）；同时人工验证多根与缺行情明确不可用、未复权/复权互换必失败。记录输入 fingerprint、工具版本、日期和截图，避免“用实时数据验收”不可复现。

## 18. 实施分期与验收

串行六期，每期结束两条测试链必须全绿才进下期。

| 期 | 内容 | 验收标准 |
|---|---|---|
| **M0 壳与迁移** | 六 tab；研究/关注迁入；动作性文案清理；manifest 名称/版本（不提前扩权）；activeTab 与 watchlist 迁移 | 两条测试契约全绿；旧安装 Update from source、旧 config/watchlist/automation 先建后删均人工验证 |
| **M1 账本核心** | portfolio.mjs 严格解析/重放/精确金额；多账户/标的/全部 v1 事件；list→read→write→reread 安全写；holdings 缓存；fetch-quotes.mjs（腾讯/Yahoo chart）与 stale 降级 | 17.1 第 1、4 组全绿（含 G1 期末持仓/现金/成本/已实现）；坏账本整体阻断；部分卖出/费用/转移/reorganization golden 全过 |
| **M2 核算完备** | strict daily TWR、XIRR、HHI、损益与 FX 归因；`--portfolio-valuation` raw 模式；`--fx-history`（Yahoo `CNY=X`）与 `--fx-verify`（ECB 校验）；公司行动阻断 | 17.1 第 2、3、5 组全绿（G1 全部检查点与 N1–N5）；17.3 冻结真实数据核对；目录混淆负测全过 |
| **M3 今日与提醒** | 今日唯一主行动 + 最多三项摘要；固定北京时间双市场徽章；两个独立关注 automation 与旧任务迁移；持仓分析规则 P0–P3 | 6.1 验收全过；automation stub 断言；规则每条有触发/不触发成对测试 |
| **M4 资讯** | 新增 external.open；news-feed.mjs / fetch-news.mjs；subscriptions/cache/feed/notified 契约；资讯页含启用卡；A/US 专用任务；噪声治理与降级 | 6.5 验收全过；17.1 第 6 组与 11.9 e2e 全绿；真实源只读 smoke 记录 |
| **M5 笔记与收尾** | journal 契约与三类笔记；复盘流；交易-笔记联动；README/methodology 更新；发布清单 | 6.6 验收全过；第 19 节清单逐项勾销 |

依赖门禁：M1 先于 M2，M2 先于依赖组合数字的 M3/M5，M0 的权限/迁移先于 M4 automation。某期未满足验收就不进入下一期；不能删掉币种归因、公司行动阻断或失败状态后仍宣称同一 v1 核算成立。若必须缩版，只能另起版本并同步修改目标与验收。

## 19. 发布清单

- [ ] panel.json：version 0.5.0、title 投资工作台、schemaVersion 1；M0 未扩权，M4 新增 external.open 时其用途与 Host 确认已复核。
- [ ] `npm run check` 与 `npm run test:ui:quant-lab` 全绿（CI 输出留档）。
- [ ] README.md 重写：六模块、移动加权非税务口径、严格 TWR/XIRR 与 16:30 检查点语义、两套价格、源许可/脆弱性/隐私（含 Yahoo chart 为用户确认源、429 → stale）、自动化 full permission/session 限制、固定北京时间提醒窗口、免责声明。
- [ ] `app/research/methodology.md` 增补「组合核算方法」章节（TWR/XIRR/HHI/币种公式与边界，与第 8 节一致）。
- [ ] 17.3 真实数据验收记录写入 TECHNICAL-PLAN。
- [ ] 手动验证：From folder 安装 → Update from source 升级 → 旧配置/关注列表/已存策略与报告全部可用。
- [ ] 旧盯盘 automation 迁移路径人工走查。
- [ ] 无占位符或多选分叉残留（全文检索复查）。

## 20. 已决策事项

**Round 3 收敛后的单一决策**（Round 3 变更：第 6、12、16、19 条修订，新增第 20–23 条）：

1. 显示名「投资工作台」，id 保持 `quant-lab`。
2. A 股为主 + 美股；不做港股。
3. 六模块：今日/持仓/关注/研究/资讯/笔记；今日为首页；量化整体进研究；关注基本不动。
4. 手动录入起步；transactions 是唯一权威，holdings 仅缓存；截图导入遵守 14.4 的候选草稿/人工确认边界。
5. 资讯首版为自动推送信息流。
6. strict daily TWR 与 XIRR 并列，只比较年化口径（跨度 ≥365 天）且差值中性；HHI 排除现金；金额归因满足恒等式；汇率与美股 bar 按可得瞬间对齐（日期 `t` → 上海检查点 `t+1`）。今日/提醒显示按用户确认固定北京时间：A 股 09:30–15:00，美股 21:30–次日 04:00，DST 不改显示口径；这不改变底层 bar 的纽约收盘可得时刻。
7. 引擎算数字、agent 只解释；规则分“可回测/可历史复算/静态审计”；所有模块无建议动作且正负对称。
8. 价格复权用于研究回测，账本以交易/公司行动为权威，两套口径边界明确。

9. 成本口径统一移动加权平均，FIFO 明确不做（理由见 8.1）；现金分红不摊薄成本。
10. 多账户/稳定 instrumentId/现金与证券外部流/费用税/分红应收/拆并送转/换汇转移/reorganization 都由严格流水表达；未知事件阻断而不猜。
11. 账本历史估值只用带 purpose 的 `data/market-raw/`，当前 quote 不回填历史；研究复权目录在读写两端隔离。
12. 自动资讯源为东方财富个股 + 7×24（低频、二级）和 SEC EDGAR（官方一级，仅申报）；Yahoo RSS/Sina/CLS 不纳入资讯。三源在资讯页启用卡中一次性勾选启用，之后完全自动。
13. 抓取走 CLI + 用户显式创建的 automation/agent；面板不联网，但新增 external.open 用于 Host 确认后的 HTTPS 外链。
14. M3 关注提醒保持 A/美两个任务；M4 自动资讯另建 A/US 两个精确命名的专用任务。两类任务不互改，资讯市场为空不建，单边失败隔离。
15. 归一化 HHI（(H−1/n)/(1−1/n)），n=1 定义为 1；权重不含现金。
16. 汇率文件键固定为 USDCNY，核算权威源为用户确认的 Yahoo chart `CNY=X`（日期 `f` 的 bar 于检查点 `f+1` 可得）；ECB 交叉汇率只写 `USDCNY-ECB.csv` 作校验，失败时 Yahoo 保持 stale，绝不静默换源。
17. 三个 cron 选覆盖 EDT/EST 的稳健时点；页面实际市场状态由 IANA 时区计算，节假日限制显式显示。
18. 资讯聚类 v1 仅按标的分组；不做散文相似度匹配。
19. 目标版本 0.5.0；manifest schemaVersion 保持 1（`external.open` 为宿主已有权限）；截图导入等 agent tool 到 v2 再安全评审，且只产候选草稿、强制人工逐笔确认。
20. 时间语义唯一：每个自然日 16:30 Asia/Shanghai 一个检查点；A 股 bar `d`→`d`，美股 bar/FX `t`→`t+1`；标的事件日期填市场本地交易日，账户事件日期填上海检查点日期；age >10 阻断。
21. 数值精度唯一：录入金额 minor unit；成本精确十进制；处置成本 ROUND_HALF_EVEN；估值内部不舍入；比率浮点、容差 1e-9。
22. 美股/汇率当前 quote 与 raw 历史统一用 Yahoo chart（与研究同步器同源族），A 股用腾讯；v1 无任何 API key。
23. 面板文件存在性判定用 `workspace.list`，不解析 readText 错误文案；新建走宿主 create-only 语义。

## 21. 外部依据与联网复核

验证日期：**2026-08-26 Asia/Shanghai**。本轮只做 GET/文档读取，无网络写、登录或绕过限制；可达性是一次观察，不等于许可或 SLA。

### 21.1 本机端点证据

| 源 | 本轮事实 | v1 结论 |
|---|---|---|
| 东方财富个股 | HTTP 200、`code:1`，返回贵州茅台条目、Art_Code、时间与链接 | 启用卡勾选的二级源；低频、标题元数据、源级失败降级 |
| 东方财富 7×24 | 不传 `sortEnd` 返回 `Required String parameter 'sortEnd' is not present`；显式空 `sortEnd` + req_trace + UA/Referer 后成功并含 stockList | 固定参数契约写 fixture；结构变化立即停用，不逆向绕过 |
| SEC `data.sec.gov/submissions/CIK0000320193.json` | 描述性 User-Agent 下成功，返回 Apple Inc./AAPL recent filing forms/dates | 官方一级源；按 accession 去重，≤1 req/s，缓存映射 |
| Yahoo RSS/chart | Round 1：`CNY=X` chart 成功（6.7084）、AAPL chart 成功；Round 2：AAPL RSS HTTP 404 HTML、`CNY=X` chart HTTP 429 | RSS 移出资讯源。chart 保留为**用户确认**的行情/汇率核算源（第 7.3 节）：429 是限流不是不可用，处理为串行 ≤1 req/s、尊重 `Retry-After`、失败保留旧值并显示 stale；不静默换源 |
| ECB Data API | `EXR/D.USD+CHF+CNY.EUR.SP00.A` CSV 成功，数据到 2026-08-25 | 只作 `USDCNY-ECB.csv` 校验源（`fx-source-divergence`），不进入估值 |
| 新浪 / 财联社 | 新浪 TLS 失败；财联社返回需签名的页面而非开放 JSON | 不纳入，不做逆向签名或回退抓 HTML |

Round 14 实施复测（2026-08-26 06:52–06:54 Asia/Shanghai，只读、无文件写）：三个 endpoint 均 HTTP 200 JSON。东财个股 pageSize=2 为 752 bytes，真实字段名为 `Art_ShowTime/Art_Code/Art_Title/Art_Url` 且文章 URL 仍是 http；adapter 只对精确 allowlisted `/a/<id>.html` 路由重建 HTTPS，不做通用升级。东财 7×24 pageSize=2 为 2346 bytes，`stockList` 实际是 `"0.002169"` 形式的字符串数组；只接受 `0|1 + 六位代码`，以 SH600519 过滤本次为 0 个 confirmed，不能据此声称“无新闻”。SEC Apple submissions 为 164439 bytes。内存 dry smoke（SH600519+AAPL）得到东财个股 ok/20、7×24 ok/0 confirmed、SEC ok/20、feed 40；只证明该时点响应结构与 parser 可用，不代表 SLA。

### 21.2 只采纳的业界原则

- [GIPS Standards Handbook](https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/) 要求组合在外部现金流处估值并以几何方式链接子期收益，收入不是外部流，实际交易费用应计入。v1 将其落地为每日 begin/end 外部流契约、内部事件排除和费用入账；当 timing 缺失时拒绝伪造 strict TWR。产品不宣称 GIPS 合规。
- [IRS Publication 550](https://www.irs.gov/publications/p550) 说明普通股票无法充分识别时通常按 FIFO，平均成本主要适用于合资格基金/DRIP；拆股应在新增总股数上重分原成本，公司重组可能需要发行方给出的成本分配。v1 因而把移动加权限定为经济收益视图，并要求 split 总成本守恒、reorganization 显式 basis allocation；不作美国税务结论。
- [Portfolio Performance 的 split 记录说明](https://help.portfolio-performance.info/en/how-to/recording-stock-split/) 明示其内建做法会追溯改写历史数量，虽能保持估值连续，却会让历史持股数量不再真实。v1 选择相反且更适合本产品审计原则的做法：保留当时真实数量与未复权价格，以日期化公司行动改变数量；这也是不能拿研究 qfq/adj 直接乘历史数量的实证理由。
- [SEC fair-access 指引](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data) 与 [SEC filing APIs](https://www.sec.gov/search-filings) 支持机器读取但要求公平访问和可识别 User-Agent。v1 用官方元数据、内部 ≤1 req/s、缓存 CIK，不抓全文，也不把申报解读成建议。
- [ECB reference-rate 使用政策](https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html) 允许在注明来源的前提下复用参考汇率；[ECB 汇率页面](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html) 明确其为参考而非交易用途。v1 只用它做与 Yahoo 同日期值的分歧校验，保留来源/日期，禁止把任何参考率称为券商成交汇率。
- [Yahoo Terms](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html) 限制未经明确许可的自动化采集。资讯 RSS 因 404 与条款不进入自动源。chart 行情/汇率是用户在 Round 1 明确确认的决策（“汇率源 Yahoo CNY=X，实测可用”），Round 3 按用户决策保留为核算权威源，并把条款风险与 429 处理方式写入 README 与启用卡；若未来 Yahoo 持续不可达，产品表现为 stale/不可用，而不是自动换源。
- Alpha Vantage 在 Round 2 曾作为美股日终 quote 候选，Round 3 因“v1 不引入任何 API key、与研究同步器同源族”而**不采纳**；[官方文档](https://www.alphavantage.co/documentation/)留作日后评估参考。

### 21.3 未采纳与降级

不因“免费公开可访问”推导可长期抓取，不把媒体源升级成公告级，不抓全文，不做情绪分类，不把 SEC filing 自动转换为公司行动，不让旧数据在失败后看起来刚刚刷新。任一源失效时只保留旧条目并显示该源 `lastSuccessAt`/错误；其余五模块和账本历史不依赖资讯源。

---

*本文档已完成 Round 1 起草、Round 2 Codex 技术/产品/财务/联网源审查、Round 3 Claude Code 独立复审收敛。状态为 Draft for review：设计完成后须经用户评审，评审通过前不进入功能实现；实现从第 18 节 M0 开始。*
