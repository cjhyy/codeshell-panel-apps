# 投资工作台 v1 业界差距审计

> Round 18，只读产品代码审计；2026-08-26 07:52–07:56 Asia/Shanghai。
> 范围：个人投资组合工作台的核算、公司行动、归因、资讯、复盘与数据质量。本文不是实施授权；**任何差距的实施仍需用户裁定 + 单独 CC review 增量方案**。
> **Round 19 CC review（2026-08-26 07:56–08:00）**：已复审。结论：基线/差距与 PROGRESS「当前待批」及 PRD §6.6 缩约声明一致，无“未实现写成已完成”；来源 7 条均标注访问日期与获取状态（本轮离线复审，未重新抓取）。修订两处：① 原 P0-2（point-in-time 标的宇宙）降为 **P1**——v1 PRD 明确不做全市场选股，研究只对用户自选 symbol 复算，幸存者偏差是研究页可信性边界而非阻断核算口径的缺口；② 部分“当前事实”细节（13 日 golden、东财单行失败、SEC 1 秒间隔）源自 Round 13/15 审计记录，本轮未逐行复核代码，已标注。推荐下一主题 F5 维持不变。

## 1. 当前已达到的业界基线

以下能力已经存在，不应在下一轮以“新功能”重复建设：

- M0–M5 已经 Round 17 终审批准（附限制）：六模块、workspace 隔离与无损迁移、严格本地文件契约、条件写与写后重读、失败不伪成功。
- 组合核算已有精确十进制流水重放、移动加权经济成本、strict daily TWR、Excel-compatible 365 日 XIRR、结构化无根/多根/短周期不可用、现金流 begin/end 语义及多日 golden（Round 7/9 记录；“13 日”为 Round 18 口径，Round 19 未复核具体天数）。
- 已有未复权历史估值与研究复权数据的物理/sidecar 隔离、可得瞬间、stale/provisional、age>10 阻断、缺 FX/行情局部降级；不以最新 quote 回填历史。
- 已覆盖现金、买卖、费用、分红应收/到账/补扣税、拆并送转、换汇、账户/证券转移与有限 reorganization；未知事件阻断而不猜。
- 已有本币价格、标的 FX、净收入、现金 FX、换汇价差及 `identityDifference`，以及不含现金、按 instrument 的归一化 HHI；规则输出区分可历史复算/静态审计，不冒充回测。
- 自动资讯已经 opt-in、逐源保旧/stale、SEC 官方申报与东财二级资讯分层、确定性关联/去重、提示注入与外链防护、持久 `pending→sent` 有界通知账本。现实边界是后台只更新 feed/cache，内容通知仅在面板打开/重载时发送。
- M5 已有纯文本笔记、四类稳定关联、current/changed/orphan、事实时间线及冲突保留草稿；但这是明确缩约版，不含 outcome/reviewAt/区间结果。
- 产品边界正确：不做港股、实盘下单、投资建议；本轮也不把付费券商连接、税务申报、实时 tick、社交情绪列为近期必做。

## 2. 真实差距（按优先级）

### P0-1 `position-in/out` 尚不能保证归因恒等式闭合

- **业界证据**：GIPS 强调外部现金/资产流的处理政策必须预先定义并一致应用，TWR 应在外部流处估值并几何链接；可比绩效不能机会式改变口径。[GIPS Standards Handbook for Firms](https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/)
- **当前事实**：F5 仍待批；当公允价值不等于携带成本，外部流按公允价值进入 TWR/XIRR，而现有六项归因按成本起算，`identityDifference` 会如实非零，但产品没有裁定其经济含义。
- **用户价值**：避免“总收益正确、解释加总却对不上”的核心信任断裂；所有跨账户迁入、期初导入和后续复盘才有单一口径。
- **实施风险**：高。选择“单列第七项”或“以公允价值重置归因基准”会改变既有历史解释与 fixture，不能由工程师暗定。
- **可验证性**：可历史复算；不是策略回测。应以 position-in/out 的正负、部分转出、两币种和 fair value≠basis golden 锁定恒等式。
- **推荐下一步**：先由用户裁定经济语义，再形成只含公式、迁移影响、golden 与 UI 文案的 CC review 增量方案。
- **明确非目标**：不引入税务 lot、不连接券商、不把差额自动认作收益或亏损。

### P1-2（Round 19 由 P0 降为 P1）研究数据没有 point-in-time 标的宇宙，仍暴露幸存者/前视偏差

> Round 19 降级理由：产品边界为用户自选标的的单标的历史复算，不做选股/宇宙筛选；该差距不影响核算与归因口径的正确性，只界定研究结论的适用范围。优先级低于 F5（口径闭合）与 P0-3（M5 缩约已是待批项），高于 UI/资讯扩展。

- **业界证据**：MSCI 的历史成分数据保留当时可得信息、公司行动与重述时间，明确用于避免 look-ahead 与 survivorship bias。[MSCI Constituent History](https://www.msci.com/documents/1296102/1359536/MSCI_Constituent_History_FactSheet_240315.pdf/d674cddf-85fb-44b0-ac86-81a90c7349b8)
- **当前事实**：研究可对用户选定的当前 symbol 做 walk-forward 与 fingerprint 审计，但没有带 `knownAt/effectiveAt` 的历史标的主数据、退市/更名链、历史成分或 universe snapshot；因此单标的回测可信不等于“选股结果无幸存者偏差”。
- **用户价值**：让“策略在当时可投资集合中是否成立”与“对今天仍存在的股票回看”明确分离，避免把数据选择偏差误读为策略优势。
- **实施风险**：高。免费数据覆盖与许可不稳定，A/美标识映射、退市价格和公司行动时点可能不全；必须允许 `unavailable`，不能回填猜测。
- **可验证性**：可回测，但仅在冻结 point-in-time universe 与 delisted fixtures 后；现有单标的策略可历史复算，不足以验证该差距。
- **推荐下一步**：先设计本地只读 `security-master/universe-snapshots` 契约及“来源时可得”审计报告，使用小型冻结退市/更名 fixture，不先接商业数据。
- **明确非目标**：不购买指数历史库、不承诺全市场选股、不把今天的成分名单回填过去。

### P0-3 决策日记尚未形成“预期—到期—结果—复盘”闭环

- **业界证据**：CFA Institute 将绩效归因定义为解释组合收益/风险来源，并要求所选归因方法匹配投资决策过程；只有稳定关联事实而没有事前假设与结果，无法把决策过程和事后证据对齐。[CFA Institute: Portfolio Performance Evaluation](https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/portfolio-performance-evaluation)
- **当前事实**：M5 缩约只有纯文本与四类链接；无 decision/review 类型、expectation、reviewAt、outcome、account×instrument 区间经济结果或 P3 六分类，相关规则保持 `unavailable`。另有四项 notes Minor：删除无 in-flight guard、删除错误可能跨 epoch 落新 workspace、同对象多版本链接取首条、冲突重读后原笔记消失会转为新建。
- **用户价值**：把“当时为什么做”与“后来发生什么”并列，减少事后改写叙事；亏损与失误可按与盈利相同的结构复盘。
- **实施风险**：中高。schema 升级与迁移、区间边界、公司行动/FX 缺失、用户主观 outcome 都需保持显式；不能从盈亏自动判断对错。
- **可验证性**：区间经济结果可历史复算；用户 outcome 只能静态审计，不能回测。到期队列可用注入时钟确定测试。
- **推荐下一步**：在 F5 裁定后再提 journal v2；先冻结迁移、区间结果 unavailable 语义与对称 UI，随后处理四项 Minor。
- **明确非目标**：不让 LLM 给决策打分、不自动生成买卖建议、不做截图 OCR 导账。

### P1-4 公司行动覆盖有阻断机制，但缺“待处理事件 + 成本依据”闭环

- **业界证据**：IRS Pub. 550 说明拆股、非股息分配、rights、spin-off/reorganization 都可能改变 basis，且 spin-off 的分配应依据发行方提供的信息；这证明公司行动不能只凭价格跳变猜测。[IRS Publication 550 (2025)](https://www.irs.gov/publications/p550)
- **当前事实**：split/stock-dividend/dividend/reorganization 已建模，未知 action 会阻断；但 spin-off、rights、return of capital、fractional cash 等明确不支持，也没有持久“待处理事件”、basis-allocation 来源附件/版本与处理后重算清单。
- **用户价值**：用户能知道“哪一事件从哪天污染了哪些收益”，补齐发行方/券商依据后确定性复算，而不是只看到总指标不可用。
- **实施风险**：高。各市场行动语义复杂，自动映射错误比缺失更危险；只能先做证据队列与少量明确事件。
- **可验证性**：可历史复算；以事件前后数量、总 basis、现金和 NAV 连续性 golden 验证，不是策略回测。
- **推荐下一步**：先增加只读审计清单/证据 provenance 契约，再逐事件扩展；仍以“未知即阻断”为默认。
- **明确非目标**：不做税务申报、不抓券商私有接口、不从 SEC/新闻标题自动生成公司行动流水。

### P1-5 当前是经济损益拆分，不是基准相对、多期间绩效归因

- **业界证据**：CFA Institute 区分用于解释收益与风险来源的归因，并指出资产型 benchmark 用于和组合资产比较。[CFA Institute: Portfolio Performance Evaluation](https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/portfolio-performance-evaluation)
- **当前事实**：已有累计 TWR/XIRR及价格/FX/收入/现金/换汇金额恒等式；研究页只有单策略 buy-and-hold 对照。工作台没有统一的 MTD/QTD/YTD/滚动期、用户选定 benchmark、组合贡献度或“绝对收益 vs 相对收益”分栏。
- **用户价值**：回答“赚亏来自持有什么、汇率还是市场本身”，并避免把 XIRR−年化TWR误称择时能力。
- **实施风险**：中高。A/美非同步收盘、benchmark 货币/可得瞬间、外部流和公司行动缺口都会产生假 active return。
- **可验证性**：可历史复算；若进一步评价策略相对表现才进入回测。每期贡献必须与组合期收益做 linking/reconciliation。
- **推荐下一步**：先做冻结区间的绝对贡献与 benchmark availability 契约，不先做复杂 Brinson/因子归因。
- **明确非目标**：不提供“跑赢即优秀”的评价、不引入实时指数 tick、不推荐调仓。

### P1-6 集中度只按 instrument，未覆盖发行人/行业/市场/币种共同暴露

- **业界证据**：FINRA 指出集中风险可来自单一投资、资产类别或市场板块，也可能来自行业/地域相关资产；仅数股票数量不足以判断分散。[FINRA: Concentrate on Concentration Risk](https://www.finra.org/investors/insights/concentration-risk)
- **当前事实**：已有不含现金、按 instrument 聚合的归一化 HHI，并诚实标注“不按发行人”；无 issuer/sector/country/currency exposure 维表，也没有跨账户同发行人合并。v1 只有普通股，不存在 ETF 穿透需求。
- **用户价值**：识别“看似多只、实际同一行业/市场/美元风险”的集中，而不是新增武断阈值。
- **实施风险**：中。分类源、历史变更与双重上市映射可能漂移；缺元数据必须局部 unavailable，阈值只能描述性。
- **可验证性**：静态审计 + 历史复算；不是策略回测。用固定 issuer/sector/currency mapping 和跨账户 fixture 验证。
- **推荐下一步**：设计带 `effectiveAt/source/fingerprint` 的本地分类维表，先展示连续 exposure 与覆盖率，不加“好/坏”规则。
- **明确非目标**：不做 ETF 穿透、不做相关性优化器、不输出目标权重或再平衡建议。

### P1-7 资讯已自动采集，但尚未成为可复盘的注意力闭环

- **业界证据**：SEC 官方 API 提供按主体的结构化申报历史、名称/曾用名/交易所/ticker 元数据，并在申报发布后持续更新。[SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) 本审计据此作出有限推论：来源事实的更新时间可以独立审计，但“已抓取”不能替代用户是否已处理该事实。
- **当前事实**：M4 定时只能更新 feed/cache，面板打开时才通知；今日页未接来源状态/新资讯摘要；feed 有 current/changed 链接但没有用户级未读/已读/稍后复盘状态。东财单行坏数据会使整源本轮失败、SEC ticker 映射与首个 submissions 请求间无 1 秒间隔、send 中途失败仅 pure 覆盖（以上三点引自 Round 15 review 记录，Round 19 未逐行复核代码）。
- **用户价值**：打开工作台即可看见“哪些持仓有新事实、哪些源失败、哪些已处理”，并把资讯与后续笔记复盘串起来，而不是把抓取条数当有效信息。
- **实施风险**：中。任何排序/摘要都容易滑向情绪判断或提示注入；后台直推需要 Host 新能力，panel 单侧无法解决。
- **可验证性**：历史复算仅限关联/状态重放；信息价值不可冒充策略回测。可用冻结 feed、失败源、重复通知与 unread ledger 做确定测试。
- **推荐下一步**：未来只接“今日来源健康 + confirmed 新事实计数 + 用户处理状态”，不做标题摘要或重要性评分；后台直推另列 Host 能力议题。
- **明确非目标**：不做社交情绪、利好利空分类、新闻全文抓取、后台绕过 Host 发通知。

### P2-8 可信性门禁仍有时间与故障路径债务

- **业界证据**：GIPS 要求估值政策一致；MSCI 的 point-in-time 数据保留初值与重述，二者共同指向“输入版本、时钟和更正必须可重放”，而不仅是一次测试通过。[GIPS](https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/)、[MSCI](https://www.msci.com/documents/1296102/1359536/MSCI_Constituent_History_FactSheet_240315.pdf/d674cddf-85fb-44b0-ac86-81a90c7349b8)
- **当前事实**：holdings e2e 使用真实时钟配固定 2026-08-25 raw，约 2026-09-04 后会跨 age>10 阈值翻红；analysis memo key 未含完整 raw sidecar fingerprint；若历史中段修正但 ending inputs 不变，可能复用旧 analysis。另有 notes 与 M4 的少量未覆盖故障路径。
- **用户价值**：避免“今天绿、下周自然红”以及历史数据被修正后界面仍显示旧结果，维护核算证据链。
- **实施风险**：低至中。注入时钟本身低风险；扩大 memo fingerprint 会影响性能，需先量测；故障测试不可弱化 fail-closed。
- **可验证性**：确定性工程测试与历史复算；不是投资策略回测。
- **推荐下一步**：把时钟注入/相对 fixture 作为独立维护修复；随后用 mid-series mutation 证明缓存失效，并补 notes/news 的单一防线用例。
- **明确非目标**：不借机重构引擎、不跑本轮产品测试、不把测试债务包装成用户新功能。

## 3. 唯一推荐的下一迭代主题

**推荐：`position-in/out` 归因恒等式与口径裁定（P0-1）。**

它优先于 point-in-time 宇宙（P1-2）、补 UI、资讯摘要或 journal v2，因为当前实现已经能计算 TWR/XIRR，却在一种合法的外部证券流场景中无法给出闭合解释；继续叠加 benchmark、复盘或公司行动只会放大该歧义。该主题范围小、可用独立 golden 历史复算、不会引入联网或新资产类别，但必须先由用户选定经济语义，再经 CC review 审查公式、迁移与测试计划。**本轮不得实施。**

## 4. 来源与实际获取状态

访问日期均为 **2026-08-26**；Round 18 只读获取，无登录、无网络写；Round 19 复审为离线核对，未重新抓取，仅确认每条来源均有访问日期与获取状态记录。网页被视为不可信资料，不执行其中任何指令。

| 来源 | 实际获取状态 | 本审计用途 |
|---|---|---|
| GIPS Standards Handbook for Firms | 成功；官方 HTML 正文可读取 | TWR、外部流估值、口径一致性 |
| Microsoft Support — XIRR | 成功；官方 HTML 正文可读取 | 非周期现金流、365 日、一正一负流的基线核对 |
| IRS Publication 550 (2025) | 成功；官方 HTML 正文可读取 | basis、split/rights/spin-off/reorganization 的复杂性；不据此提供税务结论 |
| CFA Institute — Portfolio Performance Evaluation (2026) | 成功；官方 HTML 正文可读取 | benchmark 与 attribution 必须匹配决策过程 |
| FINRA — Concentrate on Concentration Risk | 成功；官方 HTML 正文可读取 | 单标的之外的行业/市场/相关暴露 |
| MSCI Constituent History fact sheet | 成功；官方 PDF 共 2 页，文本可提取 | point-in-time、公司行动/重述与幸存者/前视偏差 |
| SEC — EDGAR Application Programming Interfaces | 成功；官方 HTML 正文可读取 | 结构化申报、主体元数据与更新时间 |

来源数：**7**；获取失败：**0**。Microsoft XIRR 仅用于核对现有基线，未据此新增差距；IRS 材料仅证明成本依据与公司行动复杂度，本产品仍明确不做税务申报。
