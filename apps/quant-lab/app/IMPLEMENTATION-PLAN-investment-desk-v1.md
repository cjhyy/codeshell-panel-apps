# 投资工作台 v1 实施计划（M0–M5）

> 权威产品契约：`PRD-investment-desk-v1.md`
> 当前真实基线：quant-lab manifest `0.5.0`，M0/M1/持仓基础页已批准，Round 10 规则待 review；工作区内未提交。
> 目标 manifest 版本：`0.5.0`。PRD 已明确该版本，因此不采用“最小 minor”兜底推断。
> Round 4 范围为 M0。Round 6 完成 M1 财务核心与 M2 纯核算契约；Round 7 修复并批准其核心。
> Round 8 完成 F4 缺 FX 局部降级、未复权 raw 行情/FX 同步 CLI 以及持仓基础页；Round 10 完成
> 独立 P0–P3 纯规则引擎与持仓首屏展示。intraday `data/quotes/latest.json`、ECB 校验文件和后续
> 里程碑仍未完成，不能据此宣称整个 M2/M3 完成。
> Round 9（CC review）修复并批准 Round 8：`analyzePortfolio` 缺 raw 源不再抛 TypeError；检查点/账户层不再输出半真 base
> 值；holdings 新增引擎 `valuation` 总值与 `inputsFingerprint`；store 区分 `cacheStale` 与 base 不可用并拒绝 create 意图下的
> 静默追加；raw CLI 增量合并保旧、Retry-After 有上限；持仓 UI 不再自算总资产。

## 1. 不变式与文件职责

### 1.1 全程不变式

- 面板 id 永远是 `quant-lab`，`schemaVersion` 在 v1 永远是 `1`；安装记录继续按 id 命中。
- `app/engine.mjs` 保持现有导出、参数、数值和事件语义；它只负责量化研究与关注规则，不承接组合账本。
- 研究行情只读 `data/market/` 的复权数据；组合核算只读 `data/market-raw/` 中同时满足 `adjust:"none"` 与 `purpose:"portfolio-valuation"` 的数据。
- 会计数字由纯引擎计算，DOM 只渲染结构化结果；agent prompt 只附引擎证据并明确禁止重算。
- storage 只放轻量 UI 状态：现有 `configuration.<workspace-hash>`、现有 `watchlist.<workspace-hash>`、新增 `activeTab.<workspace-hash>`。账本、资讯和笔记写 workspace 文件。
- 所有 workspace 权威文件写入采用 `workspace.list → readText → validate/replay → writeText(expectedModifiedAt/revision) → readText 核对`；不存在文件用 `expectedModifiedAt:null` 的 create-only 语义。不能复用当前会吞掉任意 read 错误的 `writeRepoText`。
- 新的纯计算文件不得访问 DOM、Host、网络、localStorage 或系统时钟；时间通过参数传入。Host 文件协调层不得计算财务数字。
- 每个任务先新增能在任务前实现上失败的测试，保留失败输出，再写满足该测试的最小实现；不得删除、跳过或放宽已有断言。

### 1.2 目标文件分工

| 文件 | 唯一职责 |
|---|---|
| `.codeshell-panel/panel.json` | 安装身份、显示元数据与最小 Host 权限。 |
| `app/index.html` | 六模块语义结构、表单与可访问名称；不保存状态、不做计算。 |
| `app/style.css` | 现有克制终端视觉、六模块响应式布局、状态与焦点样式。 |
| `app/app.js` | 顶层装配、Host 调用、workspace epoch、模块路由，以及既有研究/关注控制器；不新增财务公式、资讯解析或 journal 校验。 |
| `app/engine.mjs` | 既有量化研究/关注纯引擎，v1 不改写。 |
| `app/portfolio.mjs`（M1 新增） | 账本严格解析、精确金额重放、估值序列、TWR/XIRR/HHI/归因与组合数值证据的纯函数。 |
| `app/portfolio-rules.mjs`（Round 10 新增） | 13 条 P0–P3 判定、冻结阈值、验证等级、缺数局部化与稳定排序；无 DOM/Host/Agent。 |
| `app/portfolio-store.mjs`（M1 新增） | transactions/holdings 的 Host list/read/conditional-write/reread 协议与 workspace epoch 防串库。 |
| `app/market-contract.mjs`（M1 新增） | quote、raw CSV sidecar、可得瞬间、stale/provisional 的纯契约校验；不抓取。 |
| `app/modules/holdings-ui.mjs`（M1 新增） | 持仓表单、流水与组合结果的 DOM 渲染；只消费 `portfolio.mjs` 输出。 |
| `app/today-model.mjs`（M3 新增） | 今日唯一主行动、最多三项摘要与固定北京时间市场时钟纯聚合；不重复计算。 |
| `app/modules/news-ui.mjs`（M4 新增） | 资讯启用/源状态/分组/安全外链 UI；所有外部字符串用 `textContent`。 |
| `app/news-feed.mjs`（M4 新增） | subscriptions/feed/cache/notified 的严格纯校验、去重聚类、关联、源 stale、通知筛选与允许域判断。 |
| `app/modules/alerts-ui.mjs`（M3 新增） | A/美两个独立 automation 的创建/list 验证/逐市场失败与重试、并存展示及旧任务二次确认删除；不评估规则。 |
| `app/modules/notes-ui.mjs`（M5 新增） | 笔记表单、列表、复盘和关联跳转。 |
| `app/journal.mjs`（M5 新增） | journal 严格解析、决策必填校验、区间结果输入契约。 |
| `app/journal-store.mjs`（M5 新增） | journal 的 Host 冲突安全读写。 |
| `app/tools/fetch-market-data.mjs` | 研究行情同步；M2 只增固定 portfolio-valuation 模式，不改变现有模式。 |
| `app/tools/fetch-portfolio-data.mjs`（Round 8 新增） | 组合估值的腾讯/Yahoo 未复权日线与 Yahoo `CNY=X`；固定写 `data/market-raw/`。 |
| `app/tools/fetch-quotes.mjs`（M1 新增） | 腾讯/Yahoo quote 与订阅读取、限流、保旧值/stale；不计算组合收益。 |
| `app/tools/fetch-news.mjs`（M4 新增） | 三源 GET、关联、去重、锁和原子替换；不解释标题。 |
| `scripts/validate.mjs` | 纯引擎、schema、fixture、CLI 离线契约与语法检查。 |
| `scripts/quant-lab-ui.mjs` | 真实 DOM + Host stub 的浏览器端到端契约，覆盖迁移、无障碍、冲突与降级。 |

既有约 2200 行 `app.js` 不做与 M0 无关的大重构。M0 只加入模块路由与 storage 迁移这种顶层装配；从 M1 起，新增业务规则必须进入上述纯模块或模块 UI 文件。

## 2. M0：壳与无损迁移（本轮执行）

### M0-T1 manifest 与静态六模块契约

- 精确文件：`.codeshell-panel/panel.json`、`app/index.html`、`scripts/validate.mjs`、`scripts/quant-lab-ui.mjs`。
- 接口/DOM：
  - manifest `{id:"quant-lab", version:"0.5.0", schemaVersion:1, title.default:"投资工作台", title.en:"Investment Desk", title["zh-CN"]:"投资工作台"}`；M0 不新增权限，`external.open` 延后到真正渲染资讯外链的 M4。
  - 六个 `role="tab"` 按 `today, holdings, watch, research, news, notes` 固定排序，对应六个 `role="tabpanel"`；每个 panel 恰有一个 `h1`。
- 先失败测试：
  - `validate.mjs` 静态断言版本、显示名、id/schema、精确新增权限、六个唯一模块与禁用动作词。
  - UI 断言导航文本顺序为“今日 / 持仓 / 关注 / 研究 / 资讯 / 笔记”，默认只有今日可见。
- 最小实现：调整 manifest；在单页内包裹六个 section，把研究和关注现有 DOM 节点移动到各自 section，保持所有既有 id 唯一且不改事件选择器。
- 运行命令：`npm run check`；`npm run test:ui:quant-lab`。
- 验收：Host schema 校验通过；默认今日；研究/关注原节点各只有一份；无重复 id；未引入网络权限或 schema v2。

### M0-T2 模块路由、键盘与 activeTab

- 精确文件：`app/app.js`、`app/style.css`、`scripts/quant-lab-ui.mjs`。
- 接口：
  - `activateModule(moduleId, { focusTarget = "tab", persist = true } = {})` 只接受六个固定 id，设置 `hidden`、`aria-selected`、`aria-current="page"` 与 roving `tabIndex`。
  - `activeModuleStorageKey(workspaceRoot)` 返回 `scopedStorageKey("activeTab", workspaceRoot)`。
  - ArrowLeft/ArrowRight/Home/End 在六 tab 内循环/跳首尾；鼠标切换后焦点保留在激活 tab，跨模块 CTA 切换后焦点落到目标 `h1`。
- 先失败测试：默认 today；点击与键盘切换的 visible panel、焦点、`aria-selected`/`aria-current`；用户切换后 storage 写入；已有合法 activeTab 可恢复，缺失/非法值只在内存回退 today。
- 最小实现：在 `app.js` 顶层装配中加入小型 tab controller；workspace 切换复用 epoch，先恢复新 workspace 的 activeTab 再呈现。
- 运行命令：`npm run test:ui:quant-lab`。
- 验收：六 tab 键盘完整可达；切换无 console error；不改 `configuration` key/值；不写缺失或非法 activeTab，只有明确用户切换才持久化。

### M0-T3 watchlist 无损、幂等迁移

- 精确文件：`app/app.js`、`app/index.html`、`scripts/quant-lab-ui.mjs`。
- 接口：
  - `canonicalWatchSymbol(value)`：`6|9` 开头六位数或 `sh` 前缀 → `SHxxxxxx`；`0|2|3` 开头或 `sz` 前缀 → `SZxxxxxx`；其余合法美股代码转大写；无法判定时返回结构化冲突而不删除原项。
  - `migrateWatchlistStorage(value)` 返回 `{ value, changed, conflicts }`；`value` 展开保留原对象未知字段，写入 `watchlistMigrationVersion:1`，保留第一条记录/id，同一 canonical symbol 的不同 rule 全部保留；同 rule 且其余字段完全相同才去重（无损），字段不同的两条**都保留**并记录 `duplicate-rule-conflict`，由用户删除其一解决；`watchlistMigrationConflicts` 每次重算，不残留旧冲突。任何迁移都不得丢弃用户条目。
- 先失败测试：预置 `sh600519`/小写美股与未知 envelope 字段；断言 canonical symbol、第一条 id、全部不同规则、未知字段保留、版本标记、再次运行结果逐字等价；字段冲突两条都进入 storage 且关注页可见、automation 被阻断、删除其一后无需重载即解除；storage.set 失败时原值仍显示且 automation 按钮被阻断（独立浏览器上下文 + 按 key 拒绝的 Host stub）。
- 最小实现：初始化与 workspace 切换读取原 `watchlist.<hash>`，在内存迁移；仅当成功写入才启用 automation 管理。冲突状态在关注页显式展示，禁止静默合并或丢弃冲突条目；`saveWatchlist` 与 `addWatchItem` 复用同一 canonicalization，用户编辑即重算冲突。
- 运行命令：`npm run test:ui:quant-lab`。
- 验收：迁移可重入；不清任何未知 storage key；不改研究配置；失败不丢关注条目；已安装状态因 id 不变而保留。

### M0-T4 诚实空壳与现有能力零回归

- 精确文件：`app/index.html`、`app/style.css`、`app/app.js`、`scripts/quant-lab-ui.mjs`。
- 接口/行为：
  - 今日 `#today-primary-action`：watchlist 非空显示“查看关注”并跳 watch；否则显示“添加持仓”并只跳 holdings。
  - 持仓、资讯、笔记各只有一个可执行下一步；正文固定声明对应 M1/M4/M5 尚未实现，不创建文件、不显示金额、不弹成功 toast。
  - 研究 data loader、回测、验证、保存与 Agent DOM id 不变；关注添加/删除/立即检查/automation DOM id 不变。
- 先失败测试：今日两种确定性 CTA；三个阶段空状态均无收益数字且只有一个 next action；切研究后完整旧 e2e 原样运行；切关注后旧添加、阈值、错误、排序、automation、删除断言原样运行；全程 console/pageerror 为空。
- 最小实现：只移动现有 DOM，增加诚实空态与跳转监听；修正研究结论中的“不建议使用/考虑买入持有/投入真钱/小仓位试跑”为证据等级和限制描述。
- 运行命令：`npm run test:ui:quant-lab`。
- 验收：没有 holdings/transactions/news/journal 写入；没有 TWR/XIRR/HHI；没有伪收益、伪抓取、伪保存成功；旧研究和关注链路全部可用。

### M0-T5 响应式、文档与回归门禁

- 精确文件：`app/style.css`、`apps/quant-lab/README.md`、`scripts/quant-lab-ui.mjs`。
- 先失败测试：320px viewport 下 `document.documentElement.scrollWidth <= window.innerWidth`，六导航可见、可点击、焦点环不被裁切；静态断言 README 不声称账本/资讯/笔记已完成。
- 最小实现：桌面顶栏用品牌/六 tab/Agent 三栏；窄屏将六 tab 放到完整第二行的六等分网格，不依赖横向滚动；保留现有色彩、边框和 mono 数据语言。
- 运行命令：`npm run check`；`npm run test:ui:quant-lab`；`git diff --check`。
- 验收：320px 最小宽度不产生关键导航横向溢出；README 只描述新定位、六模块、研究入口与 M0 范围；无通用彩色卡片或动画。

## 3. M1：账本核心与报价（G1 固定契约从本期生效）

### M1-T1 G1 fixture 与十进制基础

**Round 6 状态：已完成。** G1 三份独立 fixture、严格 schema、BigInt 确定十进制、ROUND_HALF_EVEN、全部 v1 事件重放与固定导出已接入 `npm run check`；期望值均为 PRD 手抄常量。核心 checkpoint 明细按任意账户/标的生成，不依赖 G1 id。

- 精确文件：新增的确定性 G1 fixtures 上线前已移至仓库级 `test-fixtures/quant-lab/`，避免 From-folder 递归安装测试数据；运行代码仍为 `app/portfolio.mjs`，测试入口为 `scripts/quant-lab-portfolio.mjs`，根 `package.json` 接入检查链。
- 固定接口：
  - `parseTransactions(sourceText)` → `{ ledger, fingerprint }`，失败抛 `PortfolioValidationError`，其 `.issues` 为稳定数组 `{path, code, message}`。
  - `decimal(value, path)` → 不导出；内部用带符号 `BigInt minor/scale` 结构，禁止把权威金额转 Number。
  - `deriveHoldings(ledger, { checkpointFx })` → `{ cashByAccount, positionsByAccount, aggregateByInstrument, warnings }`。
- 先失败测试：把 PRD §8.7 G1 流水冻结为文本 fixture，直接断言期末现金、数量、两套 basis、avgCost、已实现、未实现输入、净收入；期望常量只来自 PRD，不调用待测代码生成。另覆盖部分卖出 ROUND_HALF_EVEN、超卖、坏日期、重复/断裂 id、港股、未知事件与 JSON number 金额。
- 最小实现：先支持并严格校验全部 v1 事件类型，再按固定检查点事件顺序重放；任一 issue 阻断整份输出。
- 运行命令：`npm run check`。
- 验收：G1 成为不可改名、不可由实现重算期望值的 M1 golden；M0 与 engine 旧断言仍绿。

### M1-T2 安全账本存储与 holdings 缓存

**Round 8 状态：协议层与基础 UI 已接线。** `portfolio-store.mjs` 覆盖 list→read、create-only、modifiedAt/revision、reread、epoch、指纹重建与 holdings 缓存非原子降级；`holdings-ui.mjs` 只通过 Host adapter 读写，法币流水已提交而 cache 降级时明确返回 `committed:true` / `cacheStale:true`，不诱导重试。

**Round 9 修正：** `cacheStale` 只描述 holdings.json（读/写失败），base 缺 FX 由 `snapshot.availability` 表达；快照增加 `inputsFingerprint`，`loadHoldingsSnapshot` 对 transactions 与 inputs 双指纹核对；`draft.initialLedger`（create 意图）遇到文件已存在时抛 `PortfolioStoreConflictError`，不追加进用户没见过的账本。

- Round 6 实际文件：新增 `app/portfolio-store.mjs`，在 `scripts/quant-lab-portfolio.mjs` 用 Host stub 覆盖协议；计划中的 `app/modules/holdings-ui.mjs`、`app/app.js`、`app/index.html` 与 UI 测试接线未做。
- 固定接口：
  - `readWorkspaceJson(hostCall, path, epochToken)` → `{ exists, content, modifiedAt, revision }`；先 list 父目录，存在后 read，任何 read 异常原样上抛。
  - `appendTransaction(hostCall, draft, { expectedEpoch, currentEpoch })` → 写前整本解析/重放，conditional write 后 reread 并核对 fingerprint。
  - `deriveHoldingsSnapshot(sourceText, inputs, derivedAt)` → 可序列化 holdings，`transactionsFingerprint` 对原始 sourceText 计算。
- 先失败测试：不存在文件走 create-only；存在但 >480 KiB/非 UTF-8/符号链接错误不写；modifiedAt/revision 冲突不覆盖；写后内容不符报错；workspace epoch 变化取消；holdings 指纹不符重建。
- 最小实现：Host IO 与纯引擎分开；UI 只在安全写完整成功后显示交易。
- 运行命令：`npm run check`；`npm run test:ui:quant-lab`。
- 验收：transactions 唯一权威；holdings 可删可重建；无半写和跨 workspace 写。

### M1-T3 quotes CLI 与持仓页基础展示

**Round 8 状态：未复权日线/FX 与持仓基础页已完成。** 按本轮明确范围，首页最新已知价格直接消费
`data/market-raw/`，CLI 为 `app/tools/fetch-portfolio-data.mjs`；原计划的 intraday
`data/quotes/latest.json` / subscriptions 尚未实现。持仓页已支持手动 A/美股买卖、流水、本币持仓与 raw 来源/
adjust/fingerprint/stale/provisional/availableAt；缺行情/FX 只局部 `unavailable`。
Round 9：持仓页“总资产”改为直接展示引擎 `snapshot.valuation.totalBase`（含 `unavailable.code`），模块内不再有浮点财务计算；
e2e 新增 sidecar 指纹不匹配（`raw-contract-conflict` → 现价/总资产 unavailable，绝不显示错价）与 “权威已提交、holdings 缓存写失败”
独立上下文场景；`readRawCache` 导出供契约测试。

- 精确文件：新增 `app/market-contract.mjs`、`app/tools/fetch-quotes.mjs`；修改 `app/modules/holdings-ui.mjs`、`scripts/validate.mjs`、`scripts/quant-lab-ui.mjs`。
- 固定接口：
  - `parseQuotes(sourceText)` → `{ fetchedAt, quotes, failures }`，逐 symbol 校验 source/currency/price/quoteTime。
  - CLI `node app/tools/fetch-quotes.mjs [--subscriptions data/quotes/subscriptions.json] [--fx-history] [--fx-verify]`；M1 只实现默认 latest quote，两个历史开关在 M2 同文件一次性加入，M1 遇到它们明确以 exit code 2 拒绝。
- 先失败测试：腾讯/Yahoo 脱敏 fixture、串行 ≤1 req/s、Retry-After 一次重试、单 symbol 失败保留旧 quoteTime、not-enabled/429/error 区分、A 股实时与 Yahoo delayed 字段。
- 最小实现：零依赖 GET、subscriptions 白名单、2 MiB cap、原子写 latest；持仓页展示数量/成本和“最新已知报价”，不计算 M2 收益率。
- 运行命令：`npm run check`；`npm run test:ui:quant-lab`。
- 验收：G1 账本核心与坏账本测试全绿；报价失败不伪造刷新；不进入 TWR/XIRR。

## 4. M2：核算完备、raw 行情与公司行动

### M2-T1 可得瞬间与 raw 文件隔离

**Round 8 状态：纯读取/时间契约与 portfolio raw CLI 写侧已完成。** EST/EDT、FX t+1、London 来源日期、forward-fill、age/provisional、精确 `data/market-raw/<symbol>.csv` 路径与 sidecar adjust/purpose 拒混均有确定测试；新 CLI 以腾讯提供 A 股 raw none，Yahoo 提供美股 raw none 与权威 `CNY=X`→`USDCNY`。ECB 校验源与 intraday quote 仍未实现。

- Round 6 实际文件：新增 `app/market-contract.mjs`，扩展 `app/portfolio.mjs` 与 `scripts/quant-lab-portfolio.mjs`；计划中的两个 fetch CLI 写侧和原 `scripts/validate.mjs` 接线未做。
- 固定接口：
  - `firstEligibleCheckpoint({ market, observationDate })`：CN 返回同日，US/FX 返回次日。
  - `selectObservation(checkpointDate, observations, syncedAt)` → `{ observation, ageCalendarDays, provisional }`。
  - fetcher 新模式 `--portfolio-valuation --symbol <SYM>` 固定写 `data/market-raw/`，拒绝 `--out-dir`/非 none adjust；quotes 的 `--fx-history` 写 Yahoo `USDCNY`，`--fx-verify` 写 ECB 校验文件。
- 先失败测试：EST/EDT 都 t+1、跨北京午夜、周末/停牌 forward-fill、age 10/11、London 夏令时 FX 日期、sidecar adjust/purpose/symbol/source/fingerprint 任一错即拒绝。
- 最小实现：按 PRD 推论表选择，不按字符串 join；读写双侧都校验目录与 sidecar。
- 运行命令：`npm run check`。
- 验收：研究 qfq/adj 绝不进入组合；未来观测不回填；provisional 可复算。

### M2-T2 G1 每日估值、strict TWR 与 XIRR

**Round 6 状态：纯核算已完成。** G1 13 日、N1–N5、strict begin/end、short-period 与 XIRR 唯一根/无根/多根/near −1/out-of-range/non-convergent 均已固定测试。

- Round 6 实际文件：扩展 `app/portfolio.mjs`、G1 fixture 与 `scripts/quant-lab-portfolio.mjs`。
- 固定导出：
  - `portfolioValueSeries(ledger, marketInputs)` → 13 日 `{date,value,beginFlow,endFlow,return,provisional,observations}`。
  - `timeWeightedReturn(series)` → `{ cumulative, annualized }` 或 `{ unavailable:{code,fromDate,details} }`。
  - `xirr(cashFlows)` → `{ value }` 或 `{ unavailable:{code,details} }`。
- 先失败测试：逐位锁定 G1 13 检查点和 `0.0093555623`、`short-period`、`0.3321943242`；N1–N5 全部固定；另测解析根、无根、多根、重根、接近 -1、>1000%、越界与不收敛。
- 最小实现：begin/end 严格公式；XIRR 在 log1p 域做确定性扫描、驻点检查与二分/Brent 残差验证。
- 运行命令：`npm run check`。
- 验收：不使用 Dietz/现金流日近似；多根不任选；G1 PRD 常量全部通过。

### M2-T3 HHI、币种归因与公司行动阻断

**Round 10 状态：纯核算与持仓规则 UI 已完成。** G1 HHI 与六项归因恒等式、分红/拆送转/reorganization/后补税/账户转移已覆盖；`portfolio-rules.mjs` 在 `analyzePortfolio` 数值证据之上完成 P0–P3 判定，UI 不二次计算。intraday quote 与 ECB 校验输入仍未实现，其规则按契约显示 unavailable/neutral。

- Round 6 实际文件：扩展 `app/portfolio.mjs` 与 `scripts/quant-lab-portfolio.mjs`；当轮未做的 holdings UI/规则接线已分别在 Round 8/10 完成。
- 固定导出：
  - `concentrationHHI(positionValues)` → `{ raw, normalized, count }` 或 unavailable。
  - `currencyAttribution(ledgerState, endingValues)` → 六项金额与 `identityDifference`。
  - `analyzePortfolio(inputs)` → TWR/XIRR/HHI/exposure/归因/检查点数值证据。
  - `evaluatePortfolioRules(analysis, context)` → 按优先级、severity、symbol/account、rule id 稳定排序的 13 条 P0–P3 结构化规则。
- 先失败测试：G1 `H*=0.0192921638` 与六项 = `1594.95`；n=0/1/均配/现金排除；分红和 split 只计一次；错位 split +100% 与漏录 -49.37% 阻断；三类 reorganization、送转、后补税和账户转移。
- 最小实现：复用 M1 重放状态，不在 UI 重算；所有不可用给稳定 code。
- 运行命令：`npm run check`；`npm run test:ui:quant-lab`。
- 验收：持仓概览与明细来自同一输出；负面/正面同布局；完整通过 PRD 17.1 第 2、3、5 组。

## 5. M3：今日、规则与提醒升级

### M3-T1 今日唯一主行动同源聚合

- 精确文件：新增 `app/today-model.mjs`；修改 `app/index.html`、`app/app.js`、`app/style.css`、`app/modules/holdings-ui.mjs`、`scripts/quant-lab-today.mjs`、`scripts/quant-lab-ui.mjs`。
- 固定接口：`buildTodayModel({ portfolio, watchResults, dataStatus, marketStatus, newsSummary, reviewDue })`；所有参数来自各模块现有结构化输出；`marketStatusAt(instant)` 只处理固定北京时间窗口。
- 先失败测试：五条主行动分支、同层 id tie-break、缺数不伪零、冻结输入与 analyze trap；A 股边界、美股 21:30–次日 04:00 跨午夜/周末、EDT/EST 不漂移；UI 唯一 CTA、一跳真实 target 并 focus、最多三项摘要与 XSS/320px。
- 最小实现：固定优先级聚合和跳转，不复制财务/规则算法；holdings controller 以 transactions+inputs fingerprint memo `analyzePortfolio`，同一数据 epoch 给持仓/规则/今日复用。
- 运行命令：`npm run test:ui:quant-lab`。
- 验收：打开 5 秒内看到真实状态；不把常规时段当节假日事实；不出现伪数字。

### M3-T2 P0–P3 规则与 Agent 证据

**Round 10 状态：已完成。** 13 个 PRD rule id 全部输出；6 条 `static-audit`、7 条
`historically-recomputable`、0 条 `backtestable`。每条含 condition/actual/threshold/asOf/
inputFingerprint/source/availableAt/stale/provisional/limitations；缺数只影响依赖规则。持仓页 P0
置顶并同屏展示正负贡献；窄屏 Agent 入口只提交去账户标识的结构化 evidence。intraday quote、
ECB verification 与 journal 输入未接入时分别显示真实 unavailable/neutral，不伪造已完成上游能力。

**Round 11 review（Claude Code，2026-08-26）：FIXED_AND_APPROVED。** 修正：多原因 unavailable 按
冻结 `UNAVAILABLE_REASON_PRIORITY` 取主原因并保留 `reasons`（原实现取字母序首项，会把
`raw-contract-conflict` 吞进 `missing-raw-data`）；HHI 0.25/0.50 标为产品启发式、规则恒 neutral；
公司行动审计对 raw 不可读标的不再给 positive；空持仓 `pnl-contributors` 为 `no-positions`；UI 展示
全部原因与 upstreamCode；Agent prompt 以 json 代码块标记数据边界并覆盖 Host 拒绝态；新增 5000
持仓规则层 smoke。

- 精确文件：扩展 `app/portfolio.mjs`、`app/modules/holdings-ui.mjs`、`app/app.js`、两条测试脚本。
- 先失败测试：每个规则 id 均有触发/不触发或正/负/持平成对 fixture；prompt 只有引擎 JSON、无账户名/笔记/资讯标题、无动作建议。
- 最小实现：引擎返回 `{id,category,priority,values,inputFingerprint,asOf,baseline,limitations}`；UI 稳定排序；agent 只解释。
- 运行命令：`npm run check`；`npm run test:ui:quant-lab`。
- 验收：分类名称严格为可回测/可历史复算/静态审计；agent 不补数值或动作。

### M3-T3 双市场 automation 与旧任务先建后删

- 精确文件：修改 `app/app.js`，新增 `app/modules/alerts-ui.mjs`；修改 UI 测试。
- 固定接口：`buildDeskAutomations(watchlist)` 只为非空市场返回 PRD §13.2 两个精确 name/cron/timezone/prompt；真实 Host 契约只用 `automations.list/create/update/delete`，创建后再次 list 验证（不存在 `get`）。
- 先失败测试：两个 cron、`Asia/Shanghai`、市场 prompt 分组、prompt 无 Host 不支持的 `<panel>` 占位符，调用 `quant-lab:project-runtime` 定位项目选定包的程序、bundled 工具缺失时明确 unavailable/禁止估算，full permission/session/配额披露、幂等、单边失败不回滚、逐市场重试与关闭、旧任务永不先删且二次确认后才删、空市场不建。
- 最小实现：只升级用户明确点击的任务；一市场失败不误报另一市场；只消费 storage 中真实 watch evaluation，不把 automation 完成伪装成今日触发；不因旧盯盘已启用而自动开启资讯。
- 运行命令：`npm run test:ui:quant-lab`。
- 验收：提醒无空窗；设备时区不影响 cron；后台结果不冒充源成功。

## 6. M4：自动资讯

### M4-T1 feed/cache/subscriptions/notified 纯契约与抓取 CLI

- 精确文件：新增 `app/news-feed.mjs`、`app/tools/fetch-news.mjs`、三源脱敏 fixtures、`scripts/quant-lab-news.mjs`；修改根测试脚本。
- 固定接口：
  - `parseNewsSubscriptions(text)` → enabledSources/symbols/secContact。
  - `mergeNewsCache(previous, attempts, subscriptions, now)` + `buildNewsFeed(...)` → 500 条确定性卡片和逐源状态。
  - `selectNotificationCandidates(...)` / `appendNotificationLedger(...)` → confirmed、新鲜、订阅内且持久去重。
  - CLI `node app/tools/fetch-news.mjs --subscriptions data/news/subscriptions.json --feed data/news/feed.json --cache data/news/cache.json --market all|cn|us`。
- 先失败测试：东财个股 Art_Code、7×24 必传 sortEnd/stockList、SEC CIK/accession/forms；stable id + URL 去重、同标题不同 symbol 隔离、source-tier 主卡与全部 occurrences、confirmed/weak/unlinked、幂等、500 cap、body cap、429、坏 JSON、失败不刷新 lastSuccess、通知账本 fail-closed。
- 最小实现：GET/redirect allowlist、串行（满足总并发 ≤2）、SEC ≤1 req/s、锁后重读、单文件同目录临时文件+fsync+rename；不存摘要正文。面板文件写按 Host 条件写与 reread，CLI 原子能力只承诺单文件，不伪造跨文件事务。
- 运行命令：`npm run check`。
- 验收：任一源失败不清旧 cache/feed；未关联 7×24 不落盘；CLI 输出不含 secContact/标题正文日志。

### M4-T2 启用事务与资讯 UI 安全

- 精确文件：新增 `app/modules/news-ui.mjs`；修改 `.codeshell-panel/panel.json`、`app/index.html`、`app/app.js`、`app/style.css`、`scripts/quant-lab-ui.mjs`；本任务才新增 `external.open` 权限。
- 固定接口：启用流程条件写 `data/news/subscriptions.json`，并为非空市场建立 A/US 两个 M4 专用 automation；不修改 M3 watch 任务。一市场失败保留另一市场成功项并可逐项重试。
- 先失败测试：未启用唯一启用卡；create-only 冲突；A/US/空市场/partial failure/drift/orphan；not-enabled/configuration-required/stale/error 分离；美股“仅申报”；XSS/提示注入文本；混淆域/javascript 拒绝；external.open 只接收硬编码 HTTPS；busy/accepted-not-complete；通知账本先写后发与写失败零通知。
- 最小实现：DOM createElement/textContent；URL 双层校验；手动刷新用指纹+lastAttemptAt 判完成。
- 运行命令：`npm run test:ui:quant-lab`。
- 验收：启用后自动、未启用零联网；无标题进入 prompt/通知；M4 页面所有 6.5 验收通过。

**Round 14 状态（Codex，2026-08-26）：IMPLEMENTED / AWAITING CC REVIEW。** 最新用户指令覆盖旧版“与 M3 合并/三任务/失败全回滚”描述：M4 使用两个专用市场任务，部分失败隔离，通知去重落 `data/news/notified.json`。今日页本轮未接资讯摘要，继续只消费 M0–M3 的持久输入，不抢真实 watch/P0 优先级。

**Round 15 状态（Claude Code，2026-08-26）：见 `.loop/quant-lab-investment-desk/PROGRESS.md` Round 15。** 修复：通知账本 delivery state（pending/sent/attempts，有界重试）、automation prompt 去掉不可执行的“agent 通知”、feed `cacheFingerprint` 绑定 cache 代数、URL 非默认端口拒绝、7×24 http 文章链接重建。

## 7. M5：笔记、复盘与发布收尾

**Round 16 实际缩约（用户指令覆盖旧 journal/outcome 计划）：** 已以 `notes.mjs`、`notes-store.mjs`
和 `modules/notes-ui.mjs` 完成稳定关联笔记闭环；文件路径仍是 `portfolio/journal.json`。当前 schema
只含纯文本记录与 instrument/transaction/news/rule 证据链接，不含 outcome/reviewAt，因此不接旧
P3 六分类，不实现 `positionReviewResult`，也不触碰待批 F5。截图导入/schemaVersion 2 继续不做。

### M5-T1 journal 契约与冲突安全存储

- 精确文件：新增 `app/journal.mjs`、`app/journal-store.mjs`；修改 `scripts/validate.mjs`、UI 测试。
- 固定接口：
  - `parseJournal(text, ledgerIndex)` → `{ entries }` 或稳定 issues。
  - `validateJournalEntry(draft, ledgerIndex)`；decision 强制 expectation/reviewAt。
  - `positionReviewResult({ accountId, instrumentId, from, to, ledger, marketInputs })` → 金额、position XIRR、数据日期或 unavailable。
- 先失败测试：缺 expectation/reviewAt、断裂 transaction/report path、坏日期、重复 id、删除确认、冲突/读失败不写；G1 AAPL 结果 `283.00 USD` 与 XIRR `18.91713526`。
- 最小实现：复盘金额复用 portfolio 引擎状态；journal store 复用但不绕过严格 Host 写协议。
- 运行命令：`npm run check`；`npm run test:ui:quant-lab`。
- 验收：散文不由系统判对错；outcome 由用户填；失败不清 journal。

### M5-T2 笔记 UI、双向关联与对称复盘

- 精确文件：新增 `app/modules/notes-ui.mjs`；修改 `app/index.html`、`app/app.js`、`app/style.css`、UI 测试。
- 先失败测试：三类笔记保存；到期置顶；met/partial/missed/undecidable/未到期/待复盘完整计数；流水↔笔记双向跳转；未兑现默认不隐藏；workspace 切换清内存。
- 最小实现：DOM 只渲染 journal/portfolio 输出；交易表单“同时写决策笔记”作为一次用户确认中的两个 conditional write，任一失败显示未完成项且不声称原子跨文件。
- 运行命令：`npm run test:ui:quant-lab`。
- 验收：亏损与失误不弱化；关联报告路径只允许 `quant/reports/` 或 `quant/strategies/`。

### M5-T3 文档、真实冻结样本与发布门禁

- 精确文件：`apps/quant-lab/README.md`、`app/research/methodology.md`、`app/TECHNICAL-PLAN-v1.md`、两条测试脚本。
- 先失败测试：README 必须包含移动加权非税务、16:30 检查点、两套价格、Yahoo/429→stale、automation full/session、固定北京时间提醒窗口、外发字段和关闭方式；methodology 公式与结构化 unavailable code 静态校验。
- 最小实现：完成文档；用冻结 SH600519/AAPL/USDCNY/ECB 脱敏样本逐日独立核对并把输入 fingerprint、工具版本、日期、误差写入 TECHNICAL-PLAN。
- 运行命令：`npm run check`；`npm run test:ui:quant-lab`；`git diff --check`。
- 验收：PRD §19 发布清单逐项有证据；From folder/Update from source、旧配置/关注/策略/报告与旧 automation 迁移人工走查通过；全仓无占位符或未实现入口。

## 8. 每个里程碑的统一停止条件

每个 M0–M5 只有同时满足以下条件才可进入下一期：新增测试先红后绿、已有断言未弱化、`npm run check` 退出 0、`npm run test:ui:quant-lab` 退出 0、`git diff --check` 退出 0、无 console/page error、无重复 DOM id、无新假数据/投资动作建议/XSS 字符串插入。任一条件失败就停在当前里程碑记录根因，不通过删断言、改期望为实现输出或提前进入后续模块规避。
