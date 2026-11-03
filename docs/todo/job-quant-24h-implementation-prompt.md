# Codex 实现任务（CC 方案已由主代理审核）

你是实现者 Codex。用户请求把求职和投资面板做成可直接使用的CLI/产品流程，求职借鉴AI job research，投资量化需要看得懂，指定CC出方案→Codex审核→Codex实现→CC验收，授权持续24小时。请完成实现和有意义验证，不停在建议或只交文档。

## 工作区与约束

- 这是独占业务worktree，分支 `codex/panel-shared/job-quant-24h-20261021`，已从最新origin/main c7eeee3建立；不要换分支或创建第二个实现worker。
- 先读 `AGENTS.md`、`CODESHELL.md`、`CONTRIBUTING.md`；这是npm仓库。node_modules已npm ci成功。
- 读 `docs/todo/job-quant-24h-cc-plan-20261021.md` 和 `docs/todo/job-quant-24h-codex-review-20261021.md`。审核文档优先于原CC方案。本文件规定本次实现范围。
- 仅编辑求职/投资apps、相关tests/scripts/shared及本任务文档；不改Host、不动个人求职快照/真实账本、不改其他面板逻辑。
- 当前主代理正修复跨turn后台等待可靠性，属另一个Host worktree，与你的业务工作完全独立。
- 现有CLI相关基线28/28，求职完整suite356/356，投资完整命令exit0（Node228/228），不要重跑无关全仓审计。
- 已安装求职4.2.1有CLI，安装投资0.46.1没有；源码分别5.0.0/0.46.2。实现完成后本地候选版可升求职5.1.0/投资0.47.0并更新受影响nativeEntry哈希（已有脚本优先）。不要推送/发release/安装到用户Host/写LaunchAgents，主代理验收后交付。

## 必须完成的产品闭环

### 求职

1. 把浏览器 `app.js` 里的 `save_job_opportunities` 和 `save_job_research` 关键域操作抽到 `app/ops/jobs.mjs` 等纯共享模块，通过 `applyJobHuntPanelOperation` 模式使Panel与公开 `app/tools/job-hunt.mjs` 复用。保持既有manifest输入/去重/完整JD门槛/线索分离/JD文件行为兼容。更新ops注册、公开Runtime Skill与README。不要把内部job-hunt-cli适配器作为主入口。
2. 新增只读 `get_job_research_digest` 操作（CLI可通过run调用，无须为了命令糖重写参数系统），输出中文Markdown和结构化结果：岗位/线索/公司调研概览、来源和获取时间、核验状态、变化/排除信息（现有数据无信息则明确未知）、有证据的复核顺序、资料不足/未知约束、下一步。只展示真正有数据的事实。
3. 新增纯证据对照/匹配解释模块：只用明确已确认的候选人资料；JD要求和候选人来源分别引用原句及实体ID。未确认事实不参与，资料为空显示无法个性化、缺口可见，不产生新匹配百分比。旧Agent match如展示明确未核验。已有结构不足先输出可核验的证据列表/未知，不假造语义理解。
4. Panel“今日”加入可读岗位研究概览/日报入口，并在岗位研究视图展示来源、证据对照或缺资料提示，复用同一模型。处理新字段规范化/分片/后续保存的往返，确保不会丢失。
5. 更新job-intelligence/Runtime Skill中直接Chat的工作流：Agent读取真实官网/ATS/浏览器内容，保留URL和核验时间，再用新CLI保存并生成digest。HTTP200不等于在招。研究与投递独立。本次不必新写通用fetch爬虫；网络验证仍走现有Agent/浏览器，清楚描述CLI只负责结构化读写与报告，绝不能宣称已实现不存在的verify命令。既有核验信息不足时默认unverified。

### 量化

1. 新增浏览器/Node共享的 `research-report.mjs`：复用现有runBacktest、walkForward、researchEvidence等，生成中文白话报告JSON+Markdown。内容必须包括：规则何时买卖、本金与仓位、期末金额/盈亏、最差回撤及真实峰谷金额/日期、交易笔数、费用/滑点假设和可准确还原的成本或明确估算、同期买入持有基准口径、样本外验证状态与限制、数据时间/来源/复权/指纹、为什么不代表未来收益。
2. 新增离线只读公开命令 `presets` 与 `research`。research支持真实项目内csv与 `demo:true` 互斥；少量新手预设（SMA趋势、RSI回归、突破）与显式configuration互斥；用既有输入/数据/计算量/输出上限和路径策略。可返回包含markdown的单行JSON，stdout契约不变。demo必须清晰标合成行情，不能冒充真实绩效。
3. 默认使用透明的研究费用假设，别引入未经核实的实时税率。报告明确：下一根开盘成交、零碎股、未建模涨跌停/手数等、基准未扣费、入场当天未检查止损、期末强平。样本外数据不足明确没跑；各折本金重置不能写成复利。不能用全样本最优参数冒充样本外。
4. UI研究区新增醒目的新手预设/一键生成白话报告入口及报告卡片，复用共享模块，可保留高级参数。需要真实按钮交互测试，而非只有静态文案。修改影响研究结果时报告必须更新，切换项目不可残留旧结果。
5. optional sidecar metadata安全读取：缺文件显示来源未知；坏数据/软链接/越权不静默吞掉。修正已核实的methodology止损描述，保持引擎行为和固定golden不变。

### 观察与24h准备（完成两个产品闭环后实施）

实现最小确定性观察能力，优先在各自公开CLI/共享模块里提供 `observe plan/tick/status/stop` 或等价结构化操作，避免为命令设计扩散到很多入口。要求项目自有文件、版本化plan、绝对截止2026-10-22T03:08:05Z、单实例锁、日志、最多轮次/失败退避、停止标记、单轮运行后退出（不能sleep长循环）。可只重读用户已有JD/CSV生成digest/report，清楚说明没有自动抓取的能力；不能装成实时监控。观察不代替自主开发。

实现预算紧张时必须先完成并验证两个产品闭环，明确报告观察层尚未完成项，不留半套不可用入口。本次不安装OS定时器，主代理会从稳定候选包接续安排有截止的调度与独立CC验收。

## 验证与收束

- 有意义单测：Job操作Panel/CLI parity、证据引用原句/未确认资料/空资料、坏快照与并发边界；Quant数字对引擎、合成标记、样本外不足、互斥输入、路径及计算量；CLI独立拷贝不依赖开发node_modules；关键新UI真实按钮交互（可用已有Playwright fixtures）。观察若实现则注入时钟测截止/重叠/停止/失败上限，无需真等24h。
- 更新现有suite目录，运行 `npm test -- --suite panel-cli`、`npm test -- --suite job-hunt-hq`、`npm run test:quant-lab`、`node scripts/validate.mjs`，有改动则同步哈希/共享模块并检查。日志保存本任务validation目录。
- 先读git diff与status，只负责自己变更；可git commit如sandbox允许，若git公用目录写入受限，保留已验证改动由主代理提交，不请求bypass。
- 最终回复写清实现文件、用户使用方式、实际测试结果、未完成项、安装/调度未执行；不要声称CC已验收或24h已跑完。
- 请持续工作到上述范围完整可用，避免只做一半就返回。不要把重复跑基线当实现进展。
