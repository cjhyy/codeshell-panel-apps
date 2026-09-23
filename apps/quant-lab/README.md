# 投资工作台 Panel App

0.46.1：持仓主界面按组合概览、收益走势、持仓明细排列；原持仓分析移至页面底部的“数据检查详情”，默认收起，数据异常时显示简短提醒并可点击查看。每笔持仓增加人民币市值和占持仓市值比例（不含现金；估值不完整时不显示占比），盘中随报价更新。长期关注容量由 20 只提高到 100 只；历史与公告继续使用 24/20 只单批预算续扫，满额添加会明确提示。

`v0.44.6` 将此前本机使用的完整股票面板正式发布到 GitHub：包含 A 股选股与个股研究、全行业扫描、关注数据自动更新、缺失历史分批补齐和可解释进度；历史研究默认收起。保留 `v0.5.1` 的统一下拉框，并在暂停、失败或无新增结果时说明实际状态。GitHub 安装路径仍为 `apps/quant-lab`。

自动更新修复（2026-09-12）：重点关注在可见页面按绝对到期时间更新，跨交易日和收盘后自动复核；运行中新增关注不会丢失更新请求。历史库可恢复股票池变化前的合法补齐记录，不再因旧记录数量大于今日股票池而显示“未初始化”；快照检查日期与实际日线覆盖分开。临时失败按持久化退避自动重试，每轮最多 3 次，限流触发来源级冷却；人工重试或新交易日可重新开放。续批复用经过时点校验的行情和行业目录，行业接口失败保留已知目录。选股区分数据缺失、扫描中、市场条件阻挡与没有确认股，并保留观察和过滤原因；公告核验覆盖完整技术就绪池，重点关注优先获取历史和公告。

选股增强（2026-09-12）：收盘确认要求当交易日日线、统一追高闸门和逐股公告可用性；候选与等待池新增“核验完整性”。可选的独立 Python 环境使用 stockstats 补充波动/动量指标，使用 efinance 补充当前财务截面，失败保留基础结果。easy_tdx 原公开入口当前无法访问，接口保持未验证。财务披露时点、现金流质量与完整策略回放仍待补齐，不把新增指标当作策略有效性证明。安装与审计说明见仓库 `docs/quant-lab-selection-audit-2026-09-12.md`，依赖见 `scripts/requirements-selection.txt`。

全行业扫描（同日更新）：今日选股取消热门行业预筛、最多 12 个研究行业和每行业前 12 只的采样限制，按当前数据源的完整行业目录分页取得成员，再对通过风险与流动性门槛的成分复用或补齐日线。“优先研究”继续随市场环境控制展示数量；“全部板块”支持名称搜索、排序、分页和未入选原因，扫描中也能打开尚未完成的板块。每批最多获取 8 个行业成员、补 24 只缺失历史及核验 20 只公告，这些是单批预算，不是总覆盖上限。页面可见时自动续批，可暂停后继续；关闭面板也保留已完成数据，临时失败会按退避自动重试；达到单轮上限后可手动重试。未完成板块不参与推荐，当前优先结果明确按已完成板块暂排。行业范围来自新浪第三方分类，不代表已经接入全部概念、地域或通达信自定义板块。旧版记录中的 40/12 只行业样本说明已由本流程替代；历史策略诊断仍是独立、最多 120 只有完整历史的稳定样本，不能当作全选股流程回测。

投资工作台（稳定 id：`quant-lab`）是一个独立的 CodeShell Desktop Panel App，定位为
本地优先的个人投资决策工作台。它与 Agent Plugin 系统相互独立。

当前 `0.44.6` 已有七模块外壳、无损迁移、A 股选股工作台、A 股/美股独立个股页、组合账本核心与持仓基础页：顶层固定为
**选股 / 个股 / 持仓 / 关注 / 研究 / 资讯 / 笔记**，默认进入选股。「持仓」可 create-only
建立账本、手动录入 A 股/美股买卖，并从未复权 raw 缓存展示数量、移动均价、
现价和本币盈亏。缺行情或 FX 时只将受影响字段标为 `unavailable`，不阻断查看账本或
录入合法交易。页面底部默认收起的“数据检查详情”保留 13 条 P0–P3 纯规则：每条同时展示条件、actual、
threshold、数据时点、验证等级和缺数原因（多原因时按冻结优先级给主原因并保留全部 `reasons`）；
P0 置顶但不阻断其他静态项，盈利/亏损/持平贡献采用同一结构，归一化 HHI 连续展示、0.25/0.50
只是产品启发式描述分箱（非行业标准、不贴好坏），Agent 入口只外发去账户标识后的结构化
evidence（JSON 标记为数据、非指令），并明确禁止重算和动作建议。规则分为 6 条 `static-audit`
与 7 条 `historically-recomputable`、0 条 `backtestable`，没有把组合截面规则冒充策略回测。

行情首页不再以录入持仓或运行“大盘诊断”为前置条件：打开首页即自动读取 A 股主要指数、
上涨/下跌/平盘家数、两市成交额、涨跌停近似、强弱板块、涨跌幅排行、成交活跃榜、快讯、
最近交易日龙虎榜与盘中关注池。盘中每 3 分钟、休市每 15 分钟自动刷新，页面隐藏或切到其他模块时停止。
刷新失败会保留上一份通过校验的快照，并明确显示最近收盘、部分来源降级或数据时点，不用旧数据伪装实时。
无账本时仍可使用全部首页行情，并可按任意 A 股代码或名称先查看实时行情、历史趋势、估值、市值与公告新闻。顶部四个入口只在当前页定位，不触发 Agent；
已保存研究、自动留档、指数数据、龙虎榜研究和候选扫描统一进入“研究复盘”里的研究中心。“已有研究结果”默认收起，手动展开后查看并核对日期；重新读取不会自动展开，历史文件仍保留。
已有结果与下一步研究明确分层；每个入口都会说明是直接看数据，还是会新建 Agent 任务。
它们继续使用带明确鲜度、来源、事实/推断分离和缺数禁止估算约束的确定性工具，Agent 不能自行补数、挑股票、改阈值或改写结果。

## 股票名称统一输入（v0.15.0）

选股快照现在同时携带经校验的沪深 A 股“代码—名称”目录。顶部个股搜索、长期关注、规则提醒、持仓录入、历史行情与笔记标的过滤共用同一份名称联想。
用户可输入“宁德时代”、“300750”或“SZ300750”；提交前会统一解析为 `SZ300750`。同名或模糊名称对应多只股票时必须选择候选，不会静默猜测；美股入口继续使用 ticker。

## 独立个股页（v0.18.0）

个股行情、趋势、时机、公告新闻和公司研究报告已从选股首页迁入顶层“个股”页。选股候选、榜单、长期关注和“/”快捷搜索统一进入个股页；
选股首页只保留清晰的个股入口，不再被展开的单股详情打断。输入名称或代码后，固定的本地只读工具先解析股票身份，读取腾讯实时行情与近 180 个交易日前复权日线，
展示最新价、涨跌、开高低、成交额、换手率、PE/PB、总/流通市值、20/60/120 日趋势、量比和距 120 日高点。
名称目录尚未生成时，可通过受限的腾讯 A 股联想源按名称解析，不要求用户退回六位代码。

详情同时给出“进入观察区 / 位置偏高 / 等待趋势修复 / 历史数据不足”四种条件状态，并列出确认条件与失效条件；它们是冻结量价规则，
不是个性化买卖建议。近期东方财富公司公告和精确匹配的个股新闻显示原始来源。加入长期关注和设置提醒位于时机卡；显眼的“生成个股研究报告”则单独位于行情概览下方。
只有用户明确点击该按钮时才调用 Agent。最新个股详情与每日快照按股票代码保存在 Panel App 本地数据目录，刷新失败保留上一份有效结果。
个股报告和 Deep Research 都通过临时的独立 Task 运行，不继承当前聊天记录，也不会把研究过程追加到当前 session。普通报告只获得股票标识、五项精简研究要求以及 16K 的独立任务上限；Deep Research 使用单独的 32K 上限。两类任务都只允许联网搜索和读取，最终 JSON 由面板校验后写入唯一结果路径，再直接显示在当前股票下方；任务本身不能读取或修改持仓、关注、笔记、历史行情或项目文件。

`v0.21.0` 将个股页改为先结论、再证据的浏览顺序：首屏直接汇总趋势方向、相对 MA20 的位置、20/60 日表现、距 120 日高点、量比/换手和行情阶段；
历史图可切换 20/60/120/180 日并同时显示收盘价、MA20 与 MA60。时机结论、趋势位置、公告新闻和深度诊断有独立定位入口，风险事件优先显示；搜索仍只读取确定性数据，不会因为点击股票、指数或板块自动运行 Agent。

`v0.22.1` 补齐个股页长期关注状态回写：点击后按钮会依次显示「正在加入」和「已长期关注」，成功后锁定；重新进入已经关注的股票时，也会直接从长期关注名单恢复已关注状态。

`v0.23.0` 把推荐股的主操作改为「了解公司」，并在个股页新增独立的「看懂这家公司」研究入口。报告会强制分开交易所已披露业绩、业绩预告和分析师预期，关键数字必须带报告期、披露日和直接来源，缺数不估算。按钮会明确显示生成中、重试或可更新状态，已保存的报告依然会直接回显。

`v0.23.1` 为个股历史趋势图增加鼠标与触摸定位：沿图移动时显示交易日、当日涨跌、开高低收、成交量、MA20 和 MA60，并用竖向游标与价格点对准当前日期；移出图表后自动隐藏。

`v0.24.0` 统一「关注」页的信息归属：从推荐板块、候选股或个股页加入的长期关注板块/个股，现在统一显示在顶层「关注」页首屏；原有规则列表明确改名为「价格与技术提醒」。两类数据仍分开保存：前者是研究跟踪对象，后者是带触发条件的提醒，不再因界面分散而看不到。

`v0.25.0` 对标 KHunter 的数据更新透明度，补齐实时行情状态轨：持续显示北京时间、盘中或收盘数据基线、下一次刷新倒计时、六类数据源覆盖和本轮指数/宽度/板块/快讯变化。刷新过程使用不伪造百分比的采集校验态，旧快照继续显示；刷新失败、辅助源降级和页面离开后的暂停状态均有独立反馈。盘中每 3 分钟、休市每 15 分钟的原刷新策略保持不变。

`v0.26.0` 在「研究 → 历史数据中心」新增面板级 A 股历史基础库。用户明确点击后，可初始化 120 只高流动性基础样本，或扩展到 300 只，统一保存近三年前复权日线；初始化显示真实完成数、更新/复用/失败数量和本地占用，中途停止后下次续跑。后续更新先拉取重叠窗口，复权基准未变化时只合并增量，发生除权导致历史基准变化时重建该股票的完整三年窗口。基础库保存在 Panel App 私有本地目录，不写入项目、不进入 Git；个股页和板块选股会优先复用，缺失或超过鲜度门槛时才回退联网取数。

`v0.27.0` 借鉴 `a-share-quant-selector` 将技术形态拆为双线趋势、KDJ、量能结构和价格形态四个可解释维度，但不复制其少量成功案例库或把形态相似度当作买入结论。候选股现在显示四个分项、位置、关键放量阳线、最大阴量风险和形态观察分；该分数只占板块内研究排序的 15%，不能绕过市场/板块闸门、公告风险、流动性、估值异常和追高过滤，也明确不是上涨概率。原有五类具名策略及带次日开盘、费用、滑点、涨跌停约束的历史回放继续独立运行。

`v0.28.0` 为 A 股历史基础库增加初始化来源选择：腾讯行情可免配置使用，Tushare Pro 读取项目环境中的 `TUSHARE_TOKEN`。来源会写入面板本地清单并在后续增量更新中锁定，旧版未记录来源的基础库按腾讯前复权安全迁移，避免不同数据口径混写。

`v0.29.0` 借鉴 [KHunter](https://github.com/ling-0729/KHunter) 的数据源优先级、可用性检查与失败后切换思路，以及 [a-share-quant-selector](https://github.com/Dzy-HW-XD/a-share-quant-selector) 的腾讯直连、AKShare 备用和本地缓存分层，但重新实现为零依赖的 Node 适配器。A 股现在支持腾讯行情、东方财富和 Tushare Pro；自动模式按腾讯 → 东方财富 → 已配置付费源降级并记录失败原因，初始化基础库会先探测所选来源再固定整库口径。参考仓库的模拟行情降级没有采用，任何真实来源失败都会明确停止或标记失败。

`v0.29.1` 将原本藏在「研究」页的历史库入口提升到选股首页首屏。点击「去初始化历史库」会打开研究页并直接定位到数据源、120 / 300 只范围和初始化按钮，不会绕过用户选择自动开始下载。

`v0.29.2` 修复新上市股票个股页丢失已有历史的问题。腾讯没有前复权序列、但能返回上市以来未复权日线时，个股浏览会明确标注“新股短历史 · 未复权”并显示真实走势；不足 60 个交易日时不生成趋势买卖时机。严格选股、基础库和回测仍只使用满足门槛的前复权历史。

`v0.29.3` 提升个股页公司研究报告的阅读字号与行距。报告标题、状态、摘要、事实、分节正文、风险和来源均独立放大，不改变行情卡片及其他页面的信息密度。

`v0.29.4` 修复旧版桌面 Host 初始化历史基础库时报 `unsupported known directory` 的兼容问题。初始化会优先写入面板私有数据目录；Host 尚未提供该目录时，自动回退到本机下载目录的 `a-share-history` 文件夹并在状态中明确披露，不再让原始远程调用异常中断初始化。

`v0.30.0` 对齐 KHunter 从数据到研究的主流程，在选股首页新增驾驶舱，统一展示历史库覆盖、最新行情日、研究候选和长期跟踪，并将数据准备、市场更新、执行选股、关注跟踪串成固定四步。主按钮会按状态从“去初始化历史库”切换为“用历史库执行今日选股”；历史初始化完成页也可直接进入选股。若基础库的更新时间晚于当前选股快照，驾驶舱会明确提示重新执行，不再让用户猜初始化后如何使用。

`v0.31.0` 将 A 股新闻从单一快讯流拆为三类角色：东方财富 7×24 提供即时快讯，新浪财经滚动提供独立财经文章与媒体聚合，中国证监会与中国人民银行官网提供官方政策原文；首页按来源轮换展示，避免最新八条再次被单一来源占满。同题事件按标题和时点合并并显示独立来源数与官方标记。关注个股的自动资讯另接入巨潮资讯官方公告 PDF，官方披露优先于二级报道；旧订阅会显示一次“启用巨潮官方公告”升级入口，用户确认后同步更新后台任务。来源失败时各自降级，已有快照继续保留。

`v0.32.0` 在独立个股页加入 A 股 / 美股切换。美股支持公司名称或 ticker 搜索，读取 Yahoo Finance 最新行情与最多 180 个交易日的股息拆股复权趋势，并把通过校验的快照保存在 Panel App 本地数据目录；SEC EDGAR 作为公司申报的官方入口。行情查询与 Agent 研究完全分离，只有用户点击 “Deep Research · 新闻与社媒” 才联网研究。Deep Research 强制把官方披露、媒体报道、公开社媒观点和未核验传闻分层，优先 SEC/公司 IR，社媒仅用于梳理多空论点与待核验争议，不能直接成为事实或买卖结论。

`v0.33.0` 将 A 股历史基础库从“核心 120 / 扩展 300”扩展为第三档“全部在市 A 股”。全市场范围不再套用流动性、ST 或市值预筛，按运行时核验到的完整沪深有效股票目录逐只保存近三年前复权日线；首次通常需要 350–700 MB，并可能持续 30–120 分钟。每只股票写入后立即落盘，用户可停止，下一次运行会复用已完成数据并继续补齐；单只新股短历史或数据源失败只记为未就绪，不会丢弃其他已完成股票。全量基础库用于复用历史数据，今日选股仍会独立应用风险、流动性与趋势门槛，不会把全部股票直接当成推荐结果。

`v0.33.1` 修复已有 300 只历史库时范围选择器被状态重绘强制改回“扩展 300”的问题。摘要恢复时只同步一次当前范围，此后用户可以稳定选择核心 120、扩展 300 或全市场；已有历史库只扩展、不自动删除，因此选择更小范围不会清理已经落盘的数据。

`v0.34.0` 将等待池从一条容易误解的策略标题改为“为什么还在等待”，逐只编号列出最多三个真实未通过原因，并按量能、追高、KDJ、大成交量阴线、公告与估值类别去掉重复表述。历史数据中心同步加入全市场首次全量、日常增量与复权重建三步说明；部分完成时按钮明确显示“继续补齐全市场”，已经写入的股票继续复用。

`v0.34.1` 修复个股页加入 A 股 / 美股切换后搜索框仍沿用两列网格的问题。宽面板现在把市场、名称或 ticker、查看数据保持在同一行；窄面板继续将主按钮单独换行，避免控件被压扁。

`v0.34.2` 继续收紧截图中“最近诊断”的长名称布局：最近股票统一将代码放在前面，三个入口在可用宽度内等分并省略超长公司名，不再生成显眼的横向滚动条；完整标题仍保留在悬停说明中。

`v0.34.3` 修复搜索控件的通用子元素选择器误伤“最近诊断”区域的问题：最近诊断不再继承搜索框的网格、边框和窄屏换行规则；A 股 / 美股选择器同步使用明确的工作台配色、箭头和键盘焦点样式。

`v0.34.4` 从选股首页移除“建立我的投资记录”行动卡。持仓账本和交易录入继续保留在顶层“持仓”页，首页只聚焦行情、选股和摘要。

`v0.34.5` 修复全市场历史库遇到数据源限流后仍扫完数千只股票、导致大量记为失败的问题。现在使用更保守的请求节奏，HTTP/超时会自动退避重试；连续失败达到阈值后安全暂停，保留已下载的股票供下次续跑。界面同步将“待补齐”与“本轮失败”分开显示。

`v0.34.6` 收拢历史数据中心的用户路径：A 股基础库作为选股主流程保持展开；单股日线改名为“导出单只股票到当前项目”并默认收进高级区。页面明确说明单股导出是独立回测、美股或特殊复权口径才需要的可选功能，不再让人误以为初始化后还必须二次保存。

`v0.34.7` 修复 A 股基础库卡片的弹性布局未换行问题。状态格、初始化控件和三步增量说明现在分行排列，不再将第二、第三步推到卡片外并被裁掉；UI 回归同步校验该卡片不得横向溢出。

`v0.34.8` 补齐高级单股导出默认收起后的跳转链路。演示回测提示中的“选择已保存数据”会先展开高级区，再滚动到项目数据集并聚焦第一个“载入回测”按钮；无数据时则聚焦单股代码输入框。

`v0.34.9` 修复全市场历史库的续跑按钮判断。已选“全市场”且尚未补齐时，按钮现在显示“继续补齐全市场”，不再因全市场范围的无穷上限发生比较错误而显示“扩展到 300 只”。回归新增 468/5207、待补齐 4739、数据源暂停场景。

`v0.35.0` 把今日选股的实际扫描口径直接展示出来：全市场实时行情用于判断市场宽度，技术条件只核对研究板块中的高流动性成分样本。结果页会列出行情覆盖、研究板块、历史请求、缓存命中、联网补充与缺失数量，并明确说明当前不是对 5200 多只股票逐股技术打分，避免把“历史库已有 468 只”误读成“468 只都进入本轮候选”。

`v0.35.1` 自动识别旧版全市场下载留下的批量限流记录。像 468/5207 这类旧状态不再同时显示“失败 4739”，而是显示“468 已保存、4739 待补齐、等待数据源恢复”；现有 468 份日线原样保留，无需删除或重新初始化。

`v0.36.0` 将历史基础库改为数据源友好的慢速初始化。全市场严格单路串行，联网请求至少间隔约 3 秒，每 200 次主动休息 1 分钟；遇到 HTTP 限流或超时会依次等待 30 秒、2 分钟、5 分钟，仍未恢复就立即安全暂停。任务允许最长运行 12 小时，已完成股票逐只落盘，可随时停止和断点续跑。

`v0.36.1` 将今日选股的扫描口径从状态长句拆成三步数字卡：先显示全市场实时行情覆盖，再显示真正进入历史条件核对的板块样本，最后分开显示“确认”和“等待”。页面直接说明第一步不是对 5000 多只股票逐股技术打分，减少对历史库进度和候选范围的混淆。

`v0.36.2` 为数小时的历史库任务增加周期性进度清单：基础库每 5 只、扩展库每 25 只、全市场每 100 只原子保存一次 manifest。即使 CodeShell、电脑或任务中途退出，界面也能恢复到最近检查点；已逐只写入的日线仍会在下次运行时继续复用。

`v0.36.3` 为运行中的历史库任务增加可读进度：同时显示完成百分比、已更新、已复用、失败数，以及根据当前实际速度估算的剩余小时和分钟。完成不足 5 只时不做不稳定估算，主动休息和数据源退避也会自然反映到后续剩余时间。

`v0.36.4` 为数小时的全市场任务增加跨窗口运行锁。刷新页面、关闭后重开或同时打开另一窗口时，历史数据中心会识别仍在运行的后台初始化，禁用重复启动并明确提示可以离开本页；任务退出后自动释放，超过最长运行时限或进程已不存在的旧锁会自动清理。

`v0.36.5` 修复中断任务“文件已写入、覆盖数仍停在旧清单”的问题。状态检查只扫描面板本地目录，不联网；发现有效日线已落盘但未登记时，会原子补回清单并重新计算覆盖、容量和日期。旧版批量限流的失败数同时归零为待补齐，避免再次显示 468 已保存、4739 失败。

`v0.36.6` 修复全市场任务接近尾声时可能被面板输出上限误停的问题。数千条进度信息改为流式解析、仅保留 64 KB 诊断尾部；最终清单使用独立的 8 MB 上限，因此 5200 多只股票的进度和完整结果可以同时通过，同时仍会拒绝异常超长输出。

`v0.36.7` 把“上市时间不足、有效日线少于 60 根”从网络/任务失败中拆出，单独显示为“历史不足 60 日（新股等，后续自动补）”。旧版清单也会按错误码自动迁移，因此新股不会再被误解为限流或初始化故障，真正的请求失败仍单独保留。

`v0.36.8` 将历史根数检查提前到落盘前：数据源返回空数组、1–2 根或其他不足 60 根的结果时，统一记为暂不可用，不写入无法研究的短文件；覆盖了刚上市尚无足够交易日的新股，也避免底层格式校验把它们误报成普通抓取失败。

`v0.36.9` 为腾讯日线的“无节点/无 K 线”响应补上明确的 `SOURCE_EMPTY` 分类，并在历史库中统一转成“暂不可用”。因此已有股票偶发空响应和新股尚无数据都不会被误报为网络失败；调整口径字段异常仍保留为真实数据形状错误，不会被掩盖。

`v0.36.10` 将腾讯“仅返回普通日线、没有所请求前复权日线”的响应单独标记为调整口径暂不可用。系统继续拒绝把普通价格冒充前复权价格，但工作台不再把这类个股误报为程序或网络失败；真正的 JSON/字段结构损坏仍保留为失败。

`v0.36.11` 将实时盘面已取回的完整沪深 A 股行情同步保存为每日私有日档，不增加任何行情请求。盘中刷新原子覆盖当日盘中档，收盘生成独立最终档，跨交易日自动新建；轻量盘面快照仍单独保留，写入失败时继续使用上一份已验证快照。工作日 10:10 / 15:10 的现有市场播报也会同步落盘；旧任务即使仍保存原命令，只要执行新版已安装工具就会启用私人日档。

`v0.36.12` 为每日行情日档补齐跨平台私人目录解析和已安装工具的向后兼容：新版定时命令显式要求私人落盘，旧版已创建的无参数播报命令在运行新版工具时也自动保存；开发目录中的普通测试运行不会误写用户私人数据。

`v0.36.13` 继续加强全市场历史库的限流保护：HTTP 限流会优先遵循数据源返回的等待时间，普通断网或连接重置也纳入退避重试；连续尝试仍失败后，根据范围进入 10–30 分钟本地冷却。冷却时间会写入进度清单，重开工作台仍生效；按钮会显示最早续跑时间，期间不会再发起历史请求。续跑顺序同时改为先补未完成和过旧股票，再更新已覆盖股票，避免每天先刷新数千份旧缓存、却迟迟无法推进最后的覆盖缺口。

`v0.36.14` 统一历史价格的可审计口径：每只股票明确记录数据源、A 股、日线、前复权和口径版本，日常增量会核对整个重叠窗口的开高低收与成交量；成片的前复权价格变化才重建受影响股票，单根价格或成交量修订直接合并，避免额外请求三年数据，也不把不同来源混写。盘中当天尚未收盘的临时 K 线不进入确认历史，盘中重复初始化会复用上一收盘日，避免无意义地请求全部股票。历史数据中心同步显示确认日期、重叠校验数量、零散修订和口径差异；完整实时盘面继续随刷新写入工作台私人日档，不需要 Codex 定时任务。

`v0.37.0` 将 A 股历史基础库升级为“原始价格＋复权因子＋本地派生研究价”：长期落盘未复权 OHLCV、逐日复权因子、原始来源、因子来源、生成方法和口径版本，读取时自行生成统一前复权序列，不再把供应商给出的前复权价格直接当作唯一事实。腾讯与东方财富目前以同源未复权/前复权比例推导可审计因子，Tushare 使用官方 `adj_factor`；后续可以在不改研究层的情况下替换因子来源。增量更新会按重叠日期重定标因子并重算研究序列，旧版前复权文件保持可用且只在用户下次运行初始化或增量更新时逐只迁移，不会一次性重抓全市场，也不会额外建立 Codex 定时任务。

`v0.37.1` 将研究页的 A 股量化选股与单股独立回测彻底拆开：历史区明确标为“量化选股基础库”，并直接说明不需要导出任何单只股票；项目数据数量、单股数据源和导出表单全部收进默认折叠的可选回测工具。下方合成策略实验台同步标明不属于今日选股流程，按钮、任务名称、状态和通知统一改为“独立回测数据”，避免用户把单股导出误解成使用量化选股的前置步骤。

`v0.37.2` 将普通个股报告与 Deep Research 从当前 session 提交改为临时独立 Task。任务不继承聊天历史，只允许联网搜索与读取；普通报告使用更小的 16K 上下文和五项精简结构，Deep Research 单独使用 32K。Task 只返回 JSON，由面板完成结构、来源、时间和路径校验后保存，因此研究任务不能读取或修改项目中的持仓、关注、笔记或行情文件。

`v0.37.3` 在今日选股增加独立的“追踪科技热点”入口：同一份已校验快照按近 48 小时公开资讯识别 AI 算力、半导体、机器人、商业航天/低空、智能终端与新能源技术主题，再以行业名称匹配行业样本和代表股。展开按钮不会额外发起网络请求；刷新时最多补充 3 个科技行业，并继续优先读取本地历史缓存。热点区保留资讯原文入口并明确展示匹配链路，不把单日涨幅当热点，也不把行业关联表述为公司确定受益或买入建议。

`v0.37.4` 将 15:00–15:10 明确区分为“收盘结算中”：交易虽已结束，但公开源的最终成交、成交额和日线仍可能在汇总，因此继续保留最后盘中快照且不生成收盘确认；15:10 后若完整快照仍未通过校验，则显示“等待完整收盘”而不是“盘中”。结算期改为每 3 分钟重试，取得完整收盘后恢复收盘模式；临时网络错误、超时、服务异常和请求频率限制均翻译为可读中文，后台运行器也只输出结构化错误，不再把 `[TypeError: fetch failed] {` 等原始错误片段展示到页面。

`v0.37.5` 修复新对话打开面板时误报历史库“尚未初始化”：历史文件继续保存在投资工作台共享的本机私有目录，页面启动会优先执行一次只读状态核对，不再依赖当前对话独有的状态缓存；核对期间显示“检查中”，已有的 468 / 5207 等断点进度会自动恢复。该核对不会联网、不会继续下载，也不会增加行情数据源的限流压力。

`v0.38.0` 在个股页新增用户主动触发的「这只不错 · 制定策略」。用户先选择持有计划、风险偏好和单股总资产上限，独立任务再以当前已校验行情为唯一价格锚，联网核验基本面、估值和风险，输出等待、试仓、分批、突破确认、暂停与失效条件。计划仓位与总资产仓位明确分开，所有分配合计经过校验；结果以独立结构化草案保存和回显，不携带当前聊天记录、不读取真实账户，也不会自动下单。

`v0.38.1` 将「帮我选股票」提升为所有页面顶部始终可见的主入口。它会根据当前状态自动显示“正在检查数据 / 开始选股 / 查看今日选股”：首次使用只带到必要的数据准备，历史库可用但结果过期时一键执行，已有当日结果时直接回到候选区且不重复联网。即使工作台上次停在个股、持仓或研究页，也不再需要寻找选股驾驶舱。

`v0.39.0` 将默认收起的“研究记录与 Agent 工具”改为进入“研究复盘”后直接可见的研究中心。首屏先展示已有结果与历史记录，下一层再按盘面、指数、资金异动和候选扫描选择研究问题；直接数据入口与会创建独立 Agent 任务的入口分别标明，任务结果仍统一回到已有研究区域，自动留档保持为用户主动开启。

`v0.39.1` 在面板侧增加统一的 Host 调用调度：后台恢复在 10 秒窗口内主动留出交互余量，写入、Agent 和自动化操作优先进入预留额度；意外撞到 Host 限流时等待窗口后自动重试一次，最终失败也转换为可操作的中文提示。Node 运行时与面板数据目录探测会在当前面板内合并并缓存；个股策略和每日留档状态改为进入对应功能后再读取。研究记录启动恢复只读取最近 8 份结果并额外保留最近 3 份个股报告，不再对最多 100 个文件逐一发起调用。

`v0.39.2` 移除研究复盘中重复的 Agent 候选扫描入口。该卡片现在直接复用选股页由本地固定程序生成的同一份结果；查看、生成和重新执行都不会提交对话或独立 Agent 任务，也不会消耗模型额度。旧的候选研究文件仍可在历史记录中读取，但不会再被当成新的选股执行路径。

`v0.40.0` 将 Panel manifest 升级到 schema v2，并内置只读的 `investment-research` Skill。简明个股报告、Deep Research 与条件策略草案现在都会显式加载同一个受审核方法：先核验证券身份和数据时点，再按官方披露优先级区分事实、预期、媒体解释与社媒观点，同时强制寻找反方证据、催化和可证伪条件。该 Skill 参考 GitHub 上 Anthropic Financial Services、zhaobu/investment-skills 与 Veblin/invest-skills 的开放方法，但独立改写为零外部脚本、零付费连接器、只使用任务已获准的联网读取能力；不会替代面板固定程序的数值计算，也不会获得持仓、笔记、项目文件或交易权限。

`v0.41.0` 在资讯页内置“公开社媒雷达”。用户输入股票或公司并选择 24 小时、7 天或 30 天窗口后，独立任务复用现有 Web Search，分别查找 Stocktwits、X、Reddit、小红书、微博、雪球、股吧与公开视频平台的公开索引。面板只保存通过平台域名校验的去重原帖链接，并展示样本数、活跃平台、样本立场、主要分歧和逐平台覆盖状态；未索引、访问受限与来源不可用分别标注，不会把搜索样本推算为全网声量、曝光量或平台总体情绪。结果写入当前项目的 `data/social-radar/latest.json`，任务不读取当前聊天、持仓、账户或笔记。

`v0.42.0` 重排核心页面的信息层级：宽屏使用固定左侧页面导航，窄面板继续使用紧凑顶部导航；“今日机会”首屏先展示选股结果，再展示数据准备与大盘背景。优先研究股改为整行结果布局，单只候选不再留下大块空白。个股研究报告改为白底单列阅读面，状态说明、事实摘要、正文、风险与来源按阅读顺序展开，减少大面积灰底和并排长文。

`v0.42.1` 强化“当前重点”的视觉层级：今日机会主卡增加明确标识与顶部强调线，首个候选结果提前到筛选范围和市场环境之前，并提高结果标题、数量和候选行的对比度。筛选过程、数据驾驶舱和大盘背景统一降为支持信息，避免所有卡片看起来同等重要。

`v0.43.0` 将选股首页的三个入口进一步拆成各自独立的工作区：「选股结果」不再同时铺开完整大盘首页，已完成的选股驾驶舱自动退居后台；「市场看板」把主要指数、市场五档强弱、六阶段情绪和主线识别提到首屏，再接行情宽度、排行、快讯、龙虎榜和异动；「研究复盘」不再混入选股流程。入口改为紧凑的当前视图导航，减少首屏解释卡和重复信息对当前任务的干扰。
市场环境首屏同时展开最高连板、首板、二板以上、晋级率、封板率和梯队完整度，实时明细区不再重复四个指数卡。独立「研究」页新增可筛选的 25 套 A 股策略库，按 7 类展示适用标的、市场强弱、情绪阶段和执行周期；默认只展示 6 套，避免再次形成卡片墙，展开全部或切换类别都不会调用 Agent。
当研究板块样本中出现涨停时，主线识别不再只按板块涨幅和趋势排序：先对样本涨停数、最高连板、已占梯队档位和二板以上宽度做截面排名，并按 35% / 25% / 25% / 15% 合成梯队分，再以 60% 梯队分 + 40% 趋势相对强度生成当日主线分。卡片明确标出“样本梯队＋趋势”和样本/成分覆盖；没有梯队信号时自动降级为趋势相对强度，不把最多 40 只高流动性样本冒充板块全量或历史真实成分。
个股关键价位地图同步补齐九类可切换图层：压力支撑、枢轴点、前高前低、布林带、多周期 Keltner、ATR 通道、未回补缺口、斐波那契和整数关口。默认只显示最近压力支撑，用户明确打开其他图层后才叠加到趋势图；旧版快照会保留已有四类图层并将缺少的类别标为不可用，刷新后自动取得完整结构。
历史数据更新也改成闭环：实时盘面拿到完整收盘或下一交易日的“最近收盘”后，会先用私人日档补入连续缺口；若像 09/01、09/02 这类日期没有留下日档，或复权连续性检查发现断点，则自动启动固定本地程序增量联网补齐，不需要 Agent，也不再等用户进入研究页手动点更新。可选的单股独立回测导出同样改为直接本地下载，完成后经正文、元数据、指纹和工作区写回校验自动载入策略实验台；整个流程不会提交 Agent 请求。

`v0.43.1` 将日常自动补齐与用户主动的整库维护分开。自动模式先更新“已有数据但落后最新交易日”的股票，再快速复用已到最新日的记录，最后重试尚未覆盖的新股或异常股票；后台不会顺带执行耗时的旧格式迁移。每个市场日期完成一次联网核验后会记录检查日期，即使仍有停牌、上市不足或来源暂不可用的个股，也不会每五分钟重复扫描全市场；下一个完整交易日会自动重新开放补齐。状态读取只返回日期分布等紧凑摘要，不再通过页面桥接传输五千多条逐股记录。研究报告过期后会明确提示用最新行情重新生成，不静默改写旧结论；策略复盘新增次日收盘观察和高开样本的追高风险，长期关注新增股票/板块/需注意筛选，回测导出索引直接显示收益、回撤、Sortino 与交易数。

`v0.44.1` 修复自动补齐的跨页签、可见性与并发竞态：即使上次停留在研究、关注或其他页面，应用启动后仍会核对本地历史库并按需启动固定的增量程序；若面板在隐藏状态启动并于新一天恢复可见，会额外执行一次当日行情日期探测，但不会把隐藏的市场页开启为周期轮询。应用持续可见但停在非行情页时，也会在工作日 15:12 进行一次轻量收盘探测；当日行情仍处于临时状态时每 15 分钟复核，17:00 后停止，周末不安排定时探测。行情刷新与状态读取同时发生时共享同一份状态结果，只有真正启动补齐才占用当日防重复窗口，限流冷却到期后在应用保持打开时自动续跑。顶部驾驶舱优先显示“已核对至哪一天”，后台补齐时会置顶显示进度，由其他窗口启动的任务完成后也会自动刷新为最终状态；新股、短历史、停牌或来源暂不可用数量降为次级说明，并与真正网络失败分开。历史页同时展示最近五个收盘快照的实际股票数，用来直接核对 09/01、09/02 这类日期是否已留存，并明确停牌日不伪造 K 线。单股独立回测数据导出完全脱离当前 Agent 会话的忙闲状态，只保留工作区信任、历史任务互斥与写后校验；已导出的 A 股项目 CSV 会在基础库核对后按原数据源与复权口径顺序自动补齐，并显示“自动补齐中 / 已核对至”，无需再次点按钮。元数据额外记录供应商实际核对到的日期，停牌时即使最新 K 线较早也不会无限重试；每次回测结果继续保存当时的数据截止日和指纹，保持历史结果可追溯。研究复盘新增“自定义条件筛选”，可用最多四条字段、运算符和阈值按 AND/OR 筛当前板块研究池，条件按工作区保存，命中结果可直接打开个股或导出 CSV；它不改写内置策略，也明确不冒充全市场扫描或历史验证。策略库首层新增“当前环境适配”，把 25 套总规则、市场强弱与情绪阶段双重适配、通过历史观察门三层分开显示。长期关注新增用户可控的“重点”层级，重点板块和个股固定排在普通关注前，并与系统计算的机会、风险、数据不足状态分开表达；从当前候选加入时会立即复用已校验指标，切换重点不会重新请求行情，分组标题同时汇总平均涨跌与上涨/下跌家数。

`v0.44.2` 修复“只有 0 只有效沪深行情”导致今日选股整体刷新失败的单数据源问题。全市场行情现在保留完整性门槛并自动换源：新浪列表返回空数组、结构漂移或连接失败后，使用最近一份已校验的实时快照（或历史库清单）作为股票池，分批读取腾讯实时行情；首次使用尚无本地清单时，再用东方财富枚举全市场。任何来源都必须同时通过不少于 4000 只、且不低于本地股票池 85% 的覆盖校验；未达标仍会保留上一份正确快照，不会把部分行情当作全市场。

`v0.44.3` 修复 A 股独立个股页在开盘撮合付近偶发的“腾讯个股行情字段不完整或相互冲突”。价格与当日高低价暂时不同步时，工具不再因一帧瞬时数据直接结束，而是以 250/500 毫秒间隔最多重取三次；只有连续三次未通过完整性校验才会保留旧快照并给出明确错误。本机运行程序同时改为输出结构化错误，不再把 `Error:` 栈信息直接显示在界面上。

`v0.44.4` 收敛界面中重复的 CSV 操作：今日选股顶部、自定义条件筛选和长期关注不再显示导出按钮，分别聚焦于生成当日结果、直接查看命中股与执行提醒。只保留两类有明确复用目的的数据出口：历史数据中心的独立回测数据，以及回测页的结果明细。回测按钮同时改名为“导出回测明细”，避免主要页面到处出现“结果 CSV”。

`v0.44.5` 修复当日选股已经生成、界面却因“次日不利波动无效”继续保留昨日收盘的问题。当次日整天最低价仍高于信号收盘价时，不利波动按定义应为 `0`，不再记为正收益；T+5/T+20 执行结果使用同一口径。解析层同时兼容上一版已落盘的正数值并归一为 `0`，无需删除快照重来。所有 A 股界面的交易阶段也改为相对当前日期判断：上一交易日的 `close` 一律显示“最近收盘”，只有与今日同日的完整快照才显示“收盘”。

2026-09-14 选股续批修复：进度显示本批行业成员请求、日线成功/失败和公告核验数量，以及等待原因与下次重试时刻；已有结果保持稳定，连续两批没有新增数据或处理进展时暂停自动续跑。来源连续限流也受全局三轮预算约束，不再换一个行业继续无限重试。实时日线请求可取得目标日最新一根，盘中股票与指数统一使用已收盘历史；旧版日期过期失败允许一次升级恢复。首页可先查看未完成行业中的已核验观察股，确认规则保持独立。同步修复轮动排名仍限于 12 和涨停梯队明细截断造成整份新快照被拒的问题。已有研究结果默认收起，展开后查看保存日期及过期提示。

## 本地行情与选股快照（v0.16.0）

实时行情和选股快照不再只停留在页面内存。当 CodeShell Panel API v11 可用时，工具会在 Host 分配的、按 app id 隔离的
`panel-app-data/quant-lab` 本地目录中原子更新 `latest.json`，并按交易日与盘中/收盘阶段保留历史快照。启动时先恢复上次通过校验的本地结果，再后台联网刷新。
这些数据不使用 256 KiB 的 Panel Storage，不写入当前项目，不会进入 Git，面板升级后也会保留。旧版 Host 会自动降级为仅当前会话，不影响行情刷新。

`v0.18.1` 进一步拆开实时态与复盘态：盘中行情仍按原周期自动刷新；恢复到的收盘选股快照不会在进入页面时被立即覆盖，只有用户明确点击刷新才生成新复盘。
长期关注名单和最后查看的板块保存在轻量配置中，板块趋势、候选、公告与新闻则继续进入本地每日快照。刷新期间始终保留上一份通过校验的内容。

`v0.20.0` 会从本地历史快照恢复过去的预测记录，在后续交易日按当时已保存的标的和规则复盘 T+5 / T+20；当前信号、策略历史分布和已到期结果分开显示。
统计不足时明确标为“样本不足”，不会生成虚假的上涨概率。历史行情扩大到每个板块最多 12 只高流动性样本，快照、预测和复盘继续写入 Host 分配的面板私有本地目录。

`v0.21.0` 新增独立的「今日优先研究股」层：它从主升、扩散或萌芽板块的时机确认/等待池中，继续过滤位置过热、追涨、极端换手、异常估值和风险公告，给出最多 5 只研究顺序。
研究优先度只用于排序，不是上涨概率，也不等于买入；盘中结果必须等待收盘重新确认，因此严格的「时机确认」仍然可以为 0 只。

## 市场发现首页（v0.14.0）

选股首屏改为更适合普通投资者阅读的浅色卡片首页，信息顺序固定为「主要指数 → 市场快讯 → 热门板块 → 今日主线 → 板块内个股」。
指数点击只展开确定性行情与趋势详情，不再自动发起 Agent 诊断；热门板块可定位到选股工作台中的同一行业，今日主线由选股快照中排名最高且通过市场、趋势、宽度和拥挤过滤的板块生成，
同步展示阶段、当日涨跌、20 日趋势、板块宽度、相对强度和新闻证据。没有通过门槛的主题时明确显示“今日无优先主题”，不会用涨幅榜补位。

产品结构借鉴 EasyTDX 的行业/概念板块、成分股、个股归属和历史扫描研究链，但当前版本没有把 EasyTDX 作为运行依赖，也不假装已经取得概念板块或个股归属数据；
页面只展示现有公开源取得并通过结构校验的指数、行业、个股、公告与新闻。全局导航、选股、个股、持仓、关注、研究、资讯和笔记同步统一为浅色卡片体系。

四维形态证据的方法结构参考 [`Dzy-HW-XD/a-share-quant-selector`](https://github.com/Dzy-HW-XD/a-share-quant-selector) 的双线位置、KDJ、量能和价格形态拆分。当前实现为独立重写，不运行该项目、不使用其人工成功案例或固定相似度阈值；形态分只参与受限排序，不能替代现有板块、公告、估值、流动性和交易约束校验。

`v0.22.0` 将过长的选股首页拆为三个互不重复请求数据的分区：「今日机会」只保留大盘主线、研究优先股、市场闸门和可按需展开的完整选股漏斗；
「实时行情」集中放置交易时钟、指数、宽度、板块温度、排行、快讯、龙虎榜和收盘异动；「研究复盘」集中放置策略校准、预测到期复盘、已保存研究与 Agent 工具；长期关注统一进入顶层「关注」页。
分区切换不会刷新或清空已取得的行情、选股和板块状态；从实时板块进入选股时会自动回到「今日机会」并展开对应板块漏斗。

## A 股选股工作台（v0.13.0）

首页现在先判断市场闸门（强势 / 轮动 / 弱势 / 退潮），再用板块高流动性成分样本的
20/60 日收益、MA20/MA60 覆盖、板块宽度、成交额、拥挤度与近 36 小时新闻进行当日相对排序。
弱势时自动缩减候选，退潮时可以返回 0 个板块，不为了填满页面强行推荐。

`v0.19.0` 将板块内个股拆成三层：最多 3 只「板块代表股」只说明相对强弱与流动性；最多 3 只「等待买点」明确还缺位置、量能、追高或拥挤条件；
最多 2 只「时机确认」必须在完整收盘上通过趋势和冻结策略形态。等待状态不再进入确认候选，盘中触发也只进入等待区；允许时机确认始终为 0 只。

`v0.20.0` 在趋势回踩和放量突破之外，新增「平台突破」「强势缩量整理」「60 日强势新高」三类具名形态，并继续先经过板块阶段、位置、量能、流动性、估值异常和风险公告硬门槛。
历史校准按信号日收盘生成、次日开盘成交，计入双边佣金、卖出印花税、滑点、T+1、涨停无法买入和跌停延迟退出；展示 T+5 / T+20 净收益中位数、正收益比例和最大不利波动，不把回测分布包装成概率。
每只股票显示策略名、触发条件、尚缺条件、支持证据、反方风险、
东方财富公司公告和可精确匹配的个股/行业新闻；这仍是技术时机观察，不代表基本面已通过或适合用户买入。

指数、板块、成分与个股形成连续浏览链：指数只展开市场详情；板块详情展示 1/20/60 日表现、均线宽度、趋势样本、证据、风险、催化和三层成分股；所有股票动作统一进入独立个股页，只有用户明确点击“公告新闻诊断”才会调用 Agent。

`v0.21.0` 让首页热门板块和下方实时板块都成为可点击入口。首次点击只展开实时涨跌、成交额、相对强弱、行情阶段和领涨股，不改变选股结果，也不运行诊断；用户明确点击「进入板块选股」后，才把同一行业加入研究范围并打开板块选股漏斗。

用户可从系统推荐直接加入长期关注，也可手动添加板块和沪深 A 股名称或代码。关注池按工作区隔离保存，每次刷新都会重新核验长期趋势、
公告和新闻；来源失败时显式降级，不把缺数据解释为“没有风险”或“没有热点”。页面可见时每 30 分钟重新生成一次。

工作台会按行情快照阶段自动切换内容。盘中模式展示实时强弱、板块扩散、盘中排行和量价观察，所有盘中触发都进入“等待收盘”，不会进入时机确认；
收盘后模式使用完整日线，切换为收盘板块强弱、收盘异动复核、公告/新闻核验和次日研究计划。休市时则明确显示最近完整收盘，不把旧快照冒充当日盘中数据。

诊断已经降级为可选的“盘面解读与留档”：自动行情负责显示事实，只有需要复盘记录时才运行 Agent。
0.12.0 会把每次市场研究保存为 `data/market-insights/*.json`：收起的研究区自动恢复最新结论，展示事实、
风险、数据时点与经 Host 确认后打开的 HTTPS 来源，并区分当日、较早和需要更新的数据。Agent
任务结束后会自动重新读取结果；龙虎榜、异动、事件与候选卡可直接打开已保存结果，研究区的对应操作
负责重新生成。个股诊断会保留最近标的入口，打开历史结论不会重复联网。缺少合格来源、类型与
文件名不一致、无效日期或异常大文件都会 fail closed，不会进入仪表盘。

## 每日 A 股市场脉搏（Spec 1 首版）

0.12.1 继续保持行情层和分析层分离。自动行情通过经安装审核的 `process` 权限运行已安装快照内的固定
`build-market-pulse.mjs --stdout`，只向页面返回经过结构校验的 JSON，不写工作区、不使用 shell、
不接受股票代码或其他用户输入，也不会获得 Tushare/Alpha Vantage/Massive 密钥环境变量。Host
第一次运行当前安装版本的 Node.js 可执行文件时仍会要求用户确认；确认按 app id、安装 revision 和
解析后的可执行文件路径限定。运行超时、输出过大、字段冲突、未来时点或涨跌家数不守恒都会拒绝更新。
若桌面 Host 的图形启动环境找不到 `node/nodejs`，会继续查找并使用 Bun 执行同一份固定工具。应用更新后旧会话
未重载新权限时，界面明确要求完全退出并重开 CodeShell，不再误报为“未安装 Node.js”。

自动快照使用新浪沪深行情/指数/行业、腾讯行情时点与东方财富快讯的多源组合。这里的“实时”指页面
可见时自动更新的准实时公开行情，不是交易所逐笔或 Level-2；新浪、腾讯与东方财富接口无 SLA，
因此页面始终显示行情时点和来源。需要供应商密钥的五来源适配器仍属于研究页的历史数据中心。

底层市场脉搏工具会读取当前沪深 A 股有效行情，复算上涨/下跌家数、
成交额、中位涨跌和按板块常见价格限制近似得到的涨跌停家数；同时读取上证指数、深证成指、
创业板指和沪深 300 的 250 日行情，以 20/60/120 日均线、20/60/120 日收益和距 250 日高点判断
长期阶段。行业层使用新浪第三方行业分类的成分平均涨跌快照，明确不是交易所行业指数或资金流向。

东方财富 7×24 快讯只在 24 小时窗口内按冻结关键词与页面展示的强弱板块关联。报告会展示匹配到的
标题，但不会从新闻条数推断情绪、利好利空或价格因果；新闻源失败时显示不可用，不把缺数据说成
“没有热点”。板块、新闻或单个指数历史失败可显式降级，核心沪深行情覆盖不足则失败且保留旧报告。
盘中报告固定标为未完成快照，并要求 15:10 后重跑；若运行日没有取得新的交易日快照，则明确标为
「最近收盘」，提示核验周末、节假日或数据源延迟，不把旧行情冒充当天行情。

用户可在行情首页明确开启独立留档任务 `投资工作台 · A股市场脉搏`，工作日北京时间 10:10 与 15:10
各保存一次项目快报；它不负责页面行情刷新。关闭任务不会删除历史报告。任务依赖当前设备、会话和网络可用，创建或更新后
会再次读取 Host 状态校验，不会只凭按钮点击假定成功。手动运行等价于：

```bash
node "$HOME/.code-shell/panel-apps/quant-lab/app/tools/build-market-pulse.mjs" \
  --out data/market-insights/<STAMP>-market-overview.json
```

## 今日 A 股候选（Spec 2 首版）

候选扫描分两阶段且口径冻结为 `cn-trend-volume-v1`：先读取当前沪深 A 股行情快照，排除
ST/退市风险名、低价、低成交额、低流通市值和极端换手；再按流动性预排序，对最多 120 只节流读取
120 日腾讯前复权日线，计算 20/60 日趋势、距 60 日高点、量比、换手、成交额与 20 日波动。
只有同时通过均线、趋势、量能、追高和延伸度门槛的标的参与相对排名，默认展示前 10 只。

每份报告固定披露当前股票池、基础门槛后数量、历史覆盖、证据通过数量、实际指标、风险和一个
高分但被门槛排除的反例。行情覆盖低于 80% 时工具失败且不写替代结果；盘中运行会标为初筛并
强制提示收盘后重跑。股票池只包含当前在市标的，没有 point-in-time 历史成分与退市链，因此
相对排名不能证明历史绝对收益。新浪/腾讯接口免 key 但未文档化、无 SLA；候选只用于继续核验，
不构成买卖推荐、仓位建议或收益承诺。

旧版候选快报的兼容工具仍可手动运行，但面板选股入口不再通过 Agent 代跑它：

```bash
node "$HOME/.code-shell/panel-apps/quant-lab/app/tools/screen-a-shares.mjs" \
  --out data/market-insights/<STAMP>-candidates.json \
  --top 10 \
  --history-limit 120
```

原 M3 决策聚合下沉到行情页的「我的工作区」：仍只有一个实心主行动与最多三项摘要，不复制持仓表或规则清单。
主行动固定按“无账本 → P0 数据阻断 → 真实关注触发 → 重要持仓规则 → 关注/研究”选择；同层按
稳定 id 排序。理由保留 `id/actual/threshold/source/availableAt/stale/provisional`，缺数不补零。
持仓与今日复用同一份已计算 analysis，同一 transactions+market input fingerprint 数据 epoch 最多
运行一次组合分析。市场条按用户确认固定北京时间显示 A 股工作日 09:30–15:00、美股工作日
21:30–次日 04:00（周五延续至周六 04:00）；这只是常规窗口说明，未校验交易所节假日，也不证明
行情新鲜。

intraday `data/quotes/latest.json` 与 ECB FX 校验文件尚未接入，因此 `stale-quotes`、
`fx-source-divergence` 仍诚实显示对应 unavailable/neutral。M5 已接入独立笔记文件与关联时间线，
但当前笔记 schema 不含用户 outcome/reviewAt，因此 P3 决策结果/到期复盘规则继续显示
`unavailable · decision-outcome-schema-not-implemented`，不会用六类全 0 冒充真实事实。

自动资讯 M4 已完成。用户必须在资讯页明确 opt-in；未启用时面板零联网、零资讯 automation。
启用后项目仅保存 canonical symbol、来源选择和用户知情填写的 SEC User-Agent 联络信息，不保存
账户、数量、成本或笔记。A 股只用东方财富个股与 7×24（未文档化二级资讯、无 SLA），美股只用
SEC EDGAR 官方申报元数据（不是一般新闻）；Yahoo RSS、港股及其他来源不在自动资讯范围。
来源逐个失败并保留旧缓存/stale，页面不会把缺数据说成“无新闻”。

## 笔记与复盘（M5 可用闭环）

笔记唯一权威文件为 `portfolio/journal.json`，严格使用 `format:"codeshell.journal"` / `version:1`。
每条包含稳定 `id`、`createdAt/updatedAt`、纯文本 `title/body`、tags、revision、fingerprint 与多关联
links。links 只保存稳定引用：`instrument(symbol+market)`、`transactionId`、
`newsItemId+fingerprint`、`ruleId+evidenceAsOf`，不复制会漂移的持仓或盈亏数字。

持仓、流水、资讯与规则卡均可“记录笔记”，跳到统一表单预填关联，只有用户点击确认才写入。
保存采用 `workspace.list → read → strict validate → expectedModifiedAt/revision write → reread`；文件突然
出现、workspace epoch 改变或 revision 冲突时冻结写入并保留表单 draft；冲突后自动重新读取文件基线并刷新列表，用户核对后再次确认才写入（Round 17）。480 KiB 上限、非法 JSON、
unknown 字段、坏 link 或 fingerprint 均 fail closed。删除只删除笔记，不级联关联对象；对象消失显示
`orphan`，资讯 fingerprint 或规则 evidenceAsOf 变化显示 `changed`。

复盘时间线按 occurredAt/createdAt 倒序，同时间以 type/id 稳定排序，陈列当时记录、当前关联状态、
source/time。盈利与亏损交易使用同一结构与排序规则；系统不自动评分，也不从盈亏推断正确/错误。
正文不执行 HTML、Markdown 或链接，外部资讯标题以 `external/untrusted` 纯文本显示。M5 不包含截图
导入/schemaVersion 2，也未触碰待批的 F5 position-in 归因口径。

研究模块加载仓库 OHLCV CSV，运行确定性的 long-only 回测、比较 buy-and-hold、审计
数据质量，并把策略规格和 Markdown 报告保存回仓库。

Install it from **Extensions → Panel Apps → From GitHub** using:

- Repository: `https://github.com/cjhyy/codeshell-panel-apps`
- Branch or tag: `main`
- App subdirectory: `apps/quant-lab`

For local development, choose **From folder** and select this directory. The
dedicated installer reviews its Host permissions and records it in the Panel
App registry; it does not install Skills, MCP servers, Agents, Commands, or
Hooks.

After editing locally or pushing new commits, use **Update from source** on the
installed 投资工作台 card to review and apply the new snapshot. Because the id
remains `quant-lab`, existing installations continue to match the same app.

This is a research tool, not investment advice. The backtest includes explicit
fees, slippage, next-bar execution, and stop-loss assumptions, but it does not
model every real-market constraint.

## Market data

The 研究 module now starts with a 历史数据中心. It scans the project-backed
`data/market/` library, shows the stored symbol/range/bar count/source/adjustment basis, and
can load any valid dataset into the existing backtest engine with one click. The save/update
form runs the bundled zero-dependency sync tool directly in the reviewed local process surface,
validates its metadata and fingerprint, writes the result to the project, and loads it into the
backtest engine without creating an Agent request. Completed data remains reusable in later tasks
and app launches.

Current source tiers:

| Source | Coverage | Adjustment | State |
| --- | --- | --- | --- |
| Tencent quote/kline | A-share daily bars | `qfq` / `hfq` / `none` | connected, no key, undocumented/no SLA |
| Yahoo Chart | US equity daily bars | split/dividend `adj` / `none` | connected, no key, undocumented/rate-limited |
| Tushare Pro | A-share daily history | raw + adjustment factors / `qfq` / `hfq` | selectable; `TUSHARE_TOKEN` and sufficient points required |
| Alpha Vantage | A-share and US equity daily history | raw + adjusted daily | selectable; `ALPHAVANTAGE_API_KEY`, full adjusted history can require a paid plan |
| Massive | US aggregate bars | split-adjusted or raw | selectable; `MASSIVE_API_KEY` required |

All five sources are implemented behind one provider contract. The embedded direct-export form
shows the no-key providers that can run inside the restricted local process; credentialed adapters
remain available to the manual CLI. `auto` starts with the compatible no-key provider. An existing
dataset is pinned to its recorded provider on update; the tool refuses to mix vendors or adjustment
bases under one CSV. Provider failures never replace the old file.

Credentials used by the manual CLI are read only from its process environment. They are never
included in panel storage, command-line output metadata or source-failure logs. The
preferred path is **CodeShell → Credentials → Token**: save the key and expose it under one of the
environment-variable names above. A machine-local project configuration can alternatively use
`<project>/.code-shell/settings.local.json` with an `env` object and must not be committed.
`--list-sources` reports only booleans for credential readiness, never the values.

The same data can be fetched manually (Node 18+, no Python or pip required):

```bash
# A-shares (Tencent), front-adjusted by default
node app/tools/fetch-market-data.mjs --symbol 600519 --from 2020-01-01

# US equities (Yahoo), split/dividend-adjusted by default
node app/tools/fetch-market-data.mjs --symbol AAPL --from 2020-01-01

# Explicit credentialed providers (the secret stays in the process environment)
node app/tools/fetch-market-data.mjs --source tushare-pro --symbol 600519 --adjust qfq --from 2020-01-01
node app/tools/fetch-market-data.mjs --source alpha-vantage --symbol AAPL --adjust adj --from 2020-01-01
node app/tools/fetch-market-data.mjs --source massive --symbol AAPL --adjust split --from 2020-01-01

# Show supported markets, adjustment bases and credential readiness
node app/tools/fetch-market-data.mjs --list-sources
```

Files land in `data/market/<SYMBOL>.csv` with a `<SYMBOL>.meta.json` sidecar
recording the adjustment basis, source, row count and fingerprint.

**Adjustment basis matters.** `qfq` (front-adjusted), `hfq` (back-adjusted) and
`none` produce materially different prices for the same stock, and a backtest
that mixes them is silently wrong. The tool records the basis in the sidecar and
refuses to overwrite an existing dataset that used a different one unless you
pass `--force`. Use `--adjust none` only when you intend raw prices, and say so
in the report.

Run `node app/tools/fetch-market-data.mjs --help` for all options.

Portfolio valuation uses a physically separate, unadjusted cache:

```bash
# Daily raw A-share, US equity, and authoritative Yahoo CNY=X FX history
node app/tools/fetch-portfolio-data.mjs --symbol SH600519,AAPL,USDCNY --from 2026-01-01
```

This command writes only `data/market-raw/<SYMBOL>.csv` and its `.meta.json`
sidecar. The sidecar pins `purpose: "portfolio-valuation"`, `adjust: "none"`,
source, fingerprint, `syncedAt`, and the `marketDate`/`availableAt` contract.
It refuses mixed contracts and never writes `data/market/`. Use `--dry-run` to
verify sources without changing the workspace. A `--from/--to` window merges
into the existing cache (fetched bars replace that window; bars outside it are
kept), so an incremental sync never truncates history. When a source fails the
old CSV and `syncedAt` are kept and the sidecar is marked `stale`.

## 自动资讯与 SEC 申报

资讯页启用卡会条件写入 `data/news/subscriptions.json`，并只为实际有订阅标的的市场建立两个
独立任务：`投资工作台 · A股自动资讯` 与 `投资工作台 · 美股SEC申报`。这些是 M4 专用任务；
不会修改 M3 的 `投资工作台 · A股窗口` / `投资工作台 · 美股开盘后` 关注提醒。任务由 Host
强制以 `full` permission 运行、绑定当前 session，并依赖设备在线与外部网络；市场为空不建，
单边失败不会回滚另一边，prompt/schedule 漂移与空市场遗留任务会分别显示 drift/orphan。

bundle 内零依赖 CLI 也可由用户主动运行：

```bash
node app/tools/fetch-news.mjs \
  --subscriptions data/news/subscriptions.json \
  --feed data/news/feed.json \
  --cache data/news/cache.json \
  --market all
```

CLI 只做 allowlisted HTTPS GET；SEC 串行且 ≤1 req/s，联络信息不从环境变量读取。输出为严格
versioned schema，远端 HTML 只转纯文本，标题/脚本/Markdown 永远作为 untrusted data，不进入
automation prompt。`feed.json` 最多 500 卡；`cache.json` 按来源保留失败前数据与原
`lastSuccessAt`。面板打开后只对订阅、`confirmed`、新鲜且账本中未 `sent` 的条目生成事实通知；会先条件写入
`data/news/notified.json`（`pending`，attempts+1），发送后再写 `sent`。账本写失败则零通知；send 失败
保持 `pending` 并在下次加载有界重试（最多 3 次），不依赖 session 记忆。定时任务本身不发送系统通知。

资讯外链是 manifest 中唯一新增的 M4 权限 `external.open`。面板在调用前再次检查固定 HTTPS
hostname allowlist，Host 还会弹出确认；不使用 `window.open`。自动化和手动刷新都不得输出或执行
远端标题中的指令，不做情绪、利好利空、买卖或仓位判断。

## 研究 workflow

1. **Sync data** — `node app/tools/fetch-market-data.mjs --symbol AAPL --from 2020-01-01`
2. **Load** — type the CSV path into the repo field and press 加载
3. **Configure** — strategy, execution costs, position sizing, signal mode
4. **Backtest** — 运行回测 gives in-sample metrics
5. **Validate** — 运行样本外验证 rolls a walk-forward across the sample and
   reports in-sample versus pooled out-of-sample Sharpe

Step 5 is the one that matters. A single backtest reports how one parameter set
behaved on data it was chosen against; only the out-of-sample figures indicate
whether anything generalizes. The panel refuses to hide that distinction: saved
reports state explicitly when validation was never run.

## Position sizing

- **满仓 (all-in)** — commits all available cash, the v1 behaviour
- **固定比例 (fixed-fraction)** — a constant share of cash per entry
- **波动率目标 (volatility-target)** — scales exposure down as realized
  volatility rises; never above 1x, since the engine has no borrowing model

## Signal modes

- **持续持有 (state)** — long whenever the condition holds
- **交叉当日 (edge)** — enters only on the crossing bar. After a stop-out, state
  mode re-enters while the condition still holds; edge mode waits for a new
  crossing.

## Tests

```bash
npm run check                # engine, portfolio, P0-P3 rules and research contracts
npm run test:ui:quant-lab    # browser end-to-end through the real DOM
```

## 关注与每日提醒

Track symbols and record when a configured rule is triggered.

Four alert rules:

- **策略买入信号** — fires on the same entry edge the backtester trades on
- **RSI 超卖** — RSI(14) at or below 30
- **回撤到位** — price is N% below its 252-day high
- **跌破价格** — a price you set

Alerts reuse the research engine's indicator and event semantics, but an
isolated threshold/trigger is not a complete strategy: it can be historically
recomputed, yet must not be labelled backtestable without entry, exit, costs
and an evaluation target. Only a complete strategy goes through walk-forward.

**立即检查** evaluates every entry against the CSV on disk. **开启分市场提醒** creates only the
markets that currently have watch symbols, as two independent Host jobs:

- A 股：`投资工作台 · A股窗口`，`10 10,15 * * 1-5`（北京时间工作日 10:10 开盘后 / 15:10 收盘后）。
- 美股：`投资工作台 · 美股开盘后`，`35 22 * * 1-5`（北京时间工作日 22:35；一个 Host cron 无法无空跑地表达跨午夜的第二个时点，收盘后同步留待单独任务）。

Both jobs explicitly use `Asia/Shanghai`, reuse `fetch-market-data.mjs` and the existing
`evaluateWatchItem` / `rankWatchResults` contract, and notify only when a persisted engine result
has `triggered === true`. Their prompts are market-separated and forbid estimates, invented numbers,
and action advice. The prompt addresses the bundled fetcher at its real POSIX install location,
`$HOME/.code-shell/panel-apps/quant-lab/app/tools/fetch-market-data.mjs`; the Host does not expand a
`<panel>` placeholder. If that file is missing or unreadable, the run records
`bundled-fetch-tool-not-found / unavailable` and sends no trigger notification instead of guessing a
path or value. The fetch step never passes `--force`: it reuses the `adjust` recorded in the symbol's
existing `.meta.json` and reports `adjust-basis-conflict / unavailable` instead of rewriting your research
data basis. `signal-entry` rules ship their strategy snapshot so the engine can evaluate them. Prompts are
bounded by the Host's 20000-character limit; an oversized market shows `prompt-too-long` and no task is
created. Enabling, retrying, and closing are idempotent per market; one market's failure does not roll
back or misreport the other. If a market's watch symbols change, its task shows "关注列表已变化" with an
update action; if they are all removed the task is shown as orphaned and can still be closed.

CodeShell runs Panel-created automations with `full` permission, bound to the current session. A deleted
session, sleeping/offline device, or notification quota can prevent delivery; task completion alone does
not prove a data source succeeded. The panel does not request credentials. If an old
`Quant Lab · 每日盯盘` task exists, the panel creates and verifies the required new market jobs first,
keeps old and new side by side, then removes the old job only after a separate confirmation.

Entries are stored per workspace. A symbol with no synced CSV reports which
file is missing rather than failing silently. Alerts state what triggered and
at what value; they are not investment advice.


## 0.44.7：行情容错与持仓入库

行情异动与排行使用共享的数值契约，不把普通交易日涨跌幅限制当成数据传输边界。
异常条目单独隔离并显示原因，基础行情/报告校验仍保持严格；不再把格式错误统一显示为连接失败。
数据源受限时不立即重复请求，优先复用已取得的股票名单请求腾讯批量行情，并每半小时进入一次
全市场名单发现窗口；源失败仍按原顺序回退，所有源失败时保留逐源错误。页面对受限源降低刷新频率。

`portfolio-management` Skill 通过 `get_portfolio_context` 和 `import_portfolio_snapshot` 完成持仓入库。
导入分 preview/commit 两种模式，支持沪深 A 股空账户的期初持仓，按账本指纹与文件版本防冲突；
同一导入重复调用不增加数量。全部证券一次写入权威账本，再更新可重建缓存并核验页面。
`position-in` 可携带 `source` 来源元数据（kind/reference/marketDate/importId），未附来源的旧账本仍兼容。
截图日期未知时必须保留 null，并明确建账日期；可用资金、信用负债、未知成交史不会被推断或补零。
既有账户的持仓调整、其他市场和真实券商交易不属于本次导入工具范围。

### 0.44.8

持仓读取、截图导入和交易保存后，自动把仍有数量的沪深 A 股加入长期关注。跨账户去重，保留手动关注、重点设置与已清仓股票的关注记录；新增项标注“持仓自动关注”。关注达到 20 只上限或保存失败时明确提示，不替换已有关注。

### 0.44.9

修复历史库恢复遗漏序列后未同步价格分类计数的问题；已有不一致计数会在状态读取时按记录重建。状态读取失败不再提示未初始化。选股显示具体的数据源与错误码，并区分任务中断和数据源失败。

### 0.44.10

持仓自动关注、关注变更触发的刷新沿用服务端重试预算，避免误用手动重试重置行业源冷却。行业源受限时集中显示受影响行业数与本批实际请求数。常规自动刷新继续沿用已保存进度；仅显式手动刷新允许重新开启已耗尽的核验。

### 0.45.0 — 统一数据源入口

顶部「数据源」提供能力目录、行业路由、来源状态，以及历史日线/凭证配置入口。行业支持新浪、东方财富二级行业（按官网现行 s:4 分类）、自动回退与标准 JSON HTTPS 接口。实时行情和历史库沿用既有采集与复权配置，本次自定义标准接口仅适配行业分类及成分；未宣称任意供应商 API 无需适配即可使用。

行业目录、成分、扫描重试与快照按来源隔离。成分名单当天缓存，盘中使用当前行情；JSON 分类最多保留 7 天，数据时间必须显式提供。自动切换不映射或合并不同分类，保留原股票/板块关注记录。配置按当前工作区保存，不包含密钥；自定义来源仅接受公开 HTTPS JSON，不跟随重定向，拒绝带密钥 URL、私网目标和超过大小上限的响应。密钥接入继续使用已有凭证入口。

升级时复用当天已核验的旧版新浪成分缓存。目录暂时缺少成分总数时使用已核验的成员数；行业实时指标缺失时保留个股分析、暂停行业完整排名，避免降级快照导致整页校验失败。

标准 JSON 格式：
```json
{ "schemaVersion": 1, "asOf": "2026-09-21T00:00:00Z", "industries": [{ "id": "machinery", "name": "机械设备", "symbols": ["SH603298"] }] }
```

行业 `id` 为 1–20 位字母数字、最多 256 类，每类最多 2000 只沪深 A 股；日期必须是有效 ISO 时间且不超前。新增能力可扩展 `data-source-config.mjs` 能力目录及 `industry-providers.mjs` 相应标准适配器。东方财富适配依据官网行情中心现行请求参数（https://quote.eastmoney.com/center/static/build/index.js），没有安装 Python/AKShare 运行依赖。

### 0.45.1 — 个股研究跨休市日写回

修复周一个股研究引用上一周五完整交易日时，被“交易日与信息截止日最多相差一天”的市场快报规则拒绝保存。个股报告的参考交易日允许向前引用 14 个自然日，覆盖周末与连续休市；仍拒绝未来信息时点、过远参考日期和与任务不符的生成时间。报告保留真实的参考交易日和信息截止时点，不改写为当天。时间错误会指明具体字段；研究面板不再把所有失败都提示为“尚未写回，可以重新生成”。

### 0.46.0 — 每日收益与收益率曲线

- 持仓页新增每日收益、当日收益率与累计收益率曲线，可查看近 1 月、近 3 月及全部账本期间，支持点选曲线日期与每日明细。
- 每日净收益为当日组合估值减前日估值，再扣除当日外部资金/持仓流入流出；收益率按原有日初/日末资金口径逐日复合。费用、已实现损益、分红通过账本与组合价值体现。
- 快照导入首日作为收益基准，不把导入前的浮盈算作首日收益。缺少前日估值、汇率或有效资金记录时留空，累计曲线不跨越数据缺口。
- 缺失或跨日的历史行情自动补齐，也可手动刷新；行情来源与未复权口径复用持仓数据工具，校验后按文件版本写回行情目录，不改交易账本。最新完整报价更新当日暂估值。
- 日历统一沿用北京时间组合日终规则，美股收盘按原有可用时点进入后续组合日期；曲线范围仅改变显示窗口，累计起点仍为建账日。

### 0.45.3 — 持仓行情与浮动盈亏

- 按实际持仓查询 A 股/美股最新报价，首页与持仓页可见时自动更新现价、持仓盈亏、收益率及总资产；盘中约 15 秒、休市约 5 分钟，失败后退避重试。
- 盈亏复用原有十进制账本计算，包含成本中的交易费用；表示尚未卖出部分的浮动盈亏，不等同于当日收益。跨币种合计需要可用汇率。
- 每只股票显示报价来源与实际时间，来源失败保留上次价格并提示；报价不会写入交易账本或历史行情，也不会重复运行历史收益分析。
- 切换项目后丢弃旧请求结果，隐藏页面暂停轮询。沿用现有本机只读行情运行权限，无新增权限。

### 0.45.2 — 主线整合发布

将 0.44.7–0.45.1 的持仓入库、行情容错、历史恢复、数据源入口及跨休市日报告修复整合到公开 main，保留主线统一下拉框与完整回归。此版本增加两个声明式持仓工具及 portfolio-management Skill，Host 权限列表保持不变；更新时仍由 CodeShell 展示完整包审阅。

本次整合还修复首页持仓、关注与数据状态入口无法点击的问题，补齐空状态跳转与键盘焦点。选股切换页面或隐藏窗口时保留当前有限批次完成并保存，只停止后续排程；返回后接续，手动暂停和工作区切换仍可取消。


### 未发布：数据源配置的跨设备保存

支持版本校验的 Host 上，数据源配置使用项目存储快照和条件保存。两台设备同时编辑时，
旧页面不能覆盖先保存的配置；页面保留填写内容，提供 JSON 备份和明确放弃当前修改后
读取最新配置的操作。读取失败不会清空冲突草稿；关闭后再次打开配置对话框也不会丢失
当前填写内容。请求响应丢失时先核对保存结果，不自动重发无法确认的写入。

仍使用原配置 key 和 JSON 格式。旧 Host 保留 get/set 兼容，并显示不支持版本校验的
提示，不能据此承诺旧 Host 的多设备防覆盖。此增量只覆盖数据源配置，回测参数、关注
记录、研究草稿和其他存储仍须分别迁移和验收。下载的草稿备份是用户文件，尚无直接导入入口。

Host 请求队列按项目切换代次隔离：未发出的旧请求拒绝执行，旧响应不交给新项目，
程序／目录发现缓存也不跨项目复用。已发到 Host 的任务仍依照 Host 的生命周期处理，
这不是通用任务取消或跨主机迁移。

验证：`npm run test:quant-lab`、`npm run test:ui:quant-lab`、
`npm run test:ui:quant-lab-storage`、`npm run validate`。最后一项 UI 脚本使用真实
Panel 标记和控制器、两个独立 Chromium 上下文及受控存储契约；不是物理手机或真实
行情服务商验收。主仓库另提供 `scripts/smoke-quant-project-setting.mjs`，使用实际
Node Host 存储验证磁盘记录、项目隔离、服务重建、响应丢失与撤销权限。
