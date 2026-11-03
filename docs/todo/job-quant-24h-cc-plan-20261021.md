# 求职研究与量化入门：24 小时分阶段方案（CC 设计稿，交 Codex 审核）

本次只做了只读调查，没有改任何文件。下文的路径和行号都来自我直接读过的源码。Job/Quant 两个调查子代理在宿主切换时被中断，没有交回结果，所以文中没有用它们的结论。凡是没核实的地方，都标了 **【待核实】**。

## 0. 结论先行

- **求职**：浏览器版 `app.js` 里已经有不少能直接用的部分：完整 JD 门槛、线索与正式岗位分开存、按 URL 去重，以及公司调研的写入工具。缺口有两个：
  - 这些写入只存在于 `app.js` 里，公开 CLI 用不了。
  - 没有核验状态、变化记录、排除原因、可解释的匹配，也没有日报。
  
  做法是把这两个写入工具抽成纯操作，Panel 和 CLI 共用；然后补上"核验、变化、排除、匹配解释、日报"这几块。
- **量化**：引擎本身的口径是对的（收盘出信号、次日开盘成交，walk-forward 在样本内选参数），但界面只列夏普、Sortino、Calmar 这类术语，看不懂。做法是新增一个白话研究报告模块，CLI 和 UI 共用，再加 3 个新手预设、一键研究和合成数据演示。**引擎不改。**
- **24 小时运行**：要分清两件事。
  - **自主开发审查循环**：由主代理按轮次推进。
  - **行情/岗位观察**：用确定性的 Node 脚本，每次运行一轮就退出，由 macOS launchd 定时触发；带截止时间、单实例锁、逐轮日志、状态文件和停止入口，不调用任何大模型。
  
  装 launchd 之前必须先征得用户同意。观察只能覆盖"启动时刻到 2026-10-22T03:08:05Z"这段，**不足 24 小时，必须如实说明**。

## 1. 现状能力表（已读源码核实）

| 能力 | 现状 | 位置 |
|---|---|---|
| 求职公开 CLI | 有 `ops`、`init`、`run` 三个命令。实际开放的操作 = manifest 声明的工具 ∩ `jobHuntOperations`，目前 4 项。写入走 CAS，冲突重试 1 次，退出码 0/2/3/1 | `apps/job-hunt-hq/app/tools/job-hunt.mjs:26-163`、`app/ops/index.mjs:7-12` |
| Panel 与 CLI 共用操作的现成模式 | `applyJobHuntPanelOperation`，已经用于 candidate/resume 相关写入 | `app.js:13991`、`14256`、`15398`、`15427` |
| 保存岗位 | 只在浏览器里：调用 `normalizeIncomingOpportunity` → `upsertJobDiscovery`，并写 `career-data/jd/jobs/<id>.md`；上限 jobs 80 条、leads 160 条 | `app.js:14268-14387`；辅助函数在 `app.js:1623`（`normalizeJobUrl`，只收 https，去掉 utm 等参数）、`1637`、`1643`、`12739`、`12743`、`13935` |
| 完整 JD 门槛 | `assessJobOpportunity`：正文至少 240 字，必须同时有职责和要求；`listing_only`/`partial` 进线索 | `app/job-opportunities.mjs:47-78、150-228`（纯模块） |
| 更新语义 | 后来的字段直接覆盖，没有变更历史，没有"下架"状态，没有排除原因。`match` 是 0–100 的整数，没有任何解释 | `job-opportunities.mjs:104-126` |
| 公司调研 | `save_job_research`：区分 official/review/interview/news 等来源类型，面经标注 `reported`/`predicted`，`accessed_at` 必填。只在浏览器里 | `app.js:14454+` |
| 快照字段 | 已有 `jobs`、`jobLeads`、`jobResearch`、`discoveryRunReceipts` 等 | `snapshot-codec.mjs:18-43、112-175`，`applyOp` 在 `:243` |
| 定时发现 | 通过 Host 的 `automations.*`，必须在 Panel webview 里操作。字段只有 name/schedule/prompt/timezone/enabled，**没有截止时间**；每次运行都是一次大模型会话 | `discovery-automation.mjs:3-118`；Skill 约定的回执写在 `career-data/discovery/runs/<UTC>-scheduled.json` |
| 来源规则 | 来源优先级：官网 > ATS > 媒体 > 评价 > 聚合；线索不计入目标数量；不绕过登录 | `agent/skills/job-intelligence/{SKILL.md,references/source-quality.md}` |
| 界面入口 | 已有 `view-today`、`view-job-inbox`、`view-research` | `index.html:179、910、1417` |
| 量化公开 CLI | 有 dataset、backtest、parameter-sweep、walk-forward、watch、portfolio、notes 七个命令，全部只读、只读项目内文件（拒绝 `..`、隐藏路径和软链接）。上限：输入 64KB、数据 16MB、10 万根 K 线，计算量和输出量也有上限 | `apps/quant-lab/app/tools/quant-lab.mjs:95-131、209-279、358-497` |
| 回测引擎 | 收盘出信号，次日开盘加滑点成交；买卖双边按同一费率收费；默认满仓且允许零碎股；只做多；期末按收盘价平仓；基准是从第一根收盘开始的买入持有，**不计费用** | `engine.mjs:552-720` |
| 研究层 | `parameterSweep` 按夏普选最优（在传入的全部数据上选）；`walkForward` 在样本内选参数、样本外评分；每一折样本外都从初始资金重新起算；合并 Sharpe 计算；记录未被检验的尾部数据；`researchEvidence` 输出英文风险提示；`generateDemoBars` 生成固定种子的合成行情 | `engine.mjs:722、800-844、849-997、1001、1034-1115` |
| UI 研究 | `renderMetrics` 直接显示术语；`runValidation` 跑 walk-forward，外加一次全样本参数扫描 | `app.js:2726、5611-5654`；报告在 `app.js:3642` |
| 数据侧车 | 抓取器写出 `<SLUG>.csv` 和 `.meta.json`（含 adjust、source、syncedAt），并拒绝混用不同的复权口径或数据源。**公开 CLI 不读这个侧车**，所以研究结果里没有来源和复权口径 | `tools/fetch-market-data.mjs:845-975` |
| A 股选股实验室 | 另一套事件研究口径：25 个冻结形态、T+5/T+20 校准；计佣金和卖出印花税，涨停不能买，跌停最多顺延 3 天 | `a-share-strategy-lab.mjs:1-11、838-897` |
| 打包与版本 | 两个 app 都是原生 `app/` 包，不需要构建。Job Hunt 的 manifest 是 5.0.0，nativeEntries 带 sha256；Quant 的 manifest 是 0.46.2，没有 nativeEntries | `.codeshell-panel/panel.json` |
| CLI 门禁 | `tests/panel-cli-contract.test.mjs`：把包复制到别处，在断网、`PATH=""` 的条件下运行 `ops`，要求输出单行 JSON、项目目录无写入，且 Skill 文件里引用了 CLI 路径 | — |
| 可复用的锁和原子写 | `video-download/app/tools/cli-store.mjs`：`atomicJson`（:110）、`directoryLock`（:171）、`recoverLock`（:139）、心跳 30 秒判失效 | — |
| 本机 | `/bin/launchctl`、`/opt/homebrew/bin/{codex,claude,node}` 都在；PATH 上没有 `codeshell`。`~/Library/LaunchAgents` 和 Host 仓库我没有权限读 | — |
| 已安装版本（主代理核实） | Job Hunt 已装 4.2.1，四项操作可用。Quant 全局装的是 0.46.1，**没有 CLI**，而且当前项目没有绑定 Quant | — |

**代码阅读中发现的不一致（需要 Codex 写测试确认）**：

- `methodology.md:31-34` 说"当天早上开的仓用止损价成交"。
- 但 `engine.mjs:621-657` 只对 bar 开始时已持有的仓位检查止损，**入场当天不检查止损**。

建议本轮只修正文档，并在报告的"限制"一节写明。不改引擎，以免破坏 `validate.mjs` 里已固定的结果。

**参考资料**：本会话无法打开 ai-job-scout 的页面（WebFetch 没有授权），所以只按任务里给出的原则借鉴：候选人证据 → 官网/ATS 核验 → 公司调研 → 有证据的排序。没有逐条比对原文；也不能断言用户说的就是这个项目。

## 2. 产品结果与范围

**交付（用户可见）**

1. **求职**
   - 公开 CLI 可以保存岗位、核验仍在招、记录排除原因、保存公司调研、生成日报。
   - Panel 的"今天"页显示同一份日报；岗位卡片显示核验徽章、排除原因和匹配解释。
   - 候选人资料缺失时显示"资料不足，无法个性化"，不给分。
2. **量化**
   - 新增 `research`、`presets` 两个 CLI 命令，输出白话报告（Markdown + JSON）。
   - UI 增加"白话研究报告"卡片、新手预设和一键研究按钮；原有的高级参数保留，默认折叠。
   - 有可离线复现的合成数据演示，并明确标注"非真实行情"。
3. **观察运行器**：两个 app 都有 `observe`，支持 plan / tick / status / stop / launchd 子命令，有截止时间、锁、日志、退避、预算和最终摘要。

**不做**

- 不自动投递，不联系招聘方或任何第三方。
- 不接实盘，不下单。
- 不生成岗位。
- 不猜测身份、技能、薪资、签证或贡献。
- 不绕过登录、验证码或 robots。
- 不改 Host，不手动修改 Host 的私有文件。
- 不让 launchd 在无人值守时启动会写代码的 agent，除非用户另行明确授权（见 §5.3）。

**需要联网或权限的部分**

| 动作 | 联网 | 权限/前提 |
|---|---|---|
| `ops`、`run`、`digest`、`research`、`presets`、`observe status/plan` | 否 | 无 |
| `job-hunt.mjs verify`（核验已保存的 URL） | 是，只访问 https 公网 | Host Bash 是否允许联网 **【待核实】** |
| `discover-ats`（读用户提供的 ATS 看板） | 是 | 看板必须由用户提供 |
| BOSS、LinkedIn 等需要登录的站点 | 需要浏览器会话 | 只能走 Panel 的定时发现或人工操作；CLI 遇到时标记 `login_required` |
| 行情抓取 `fetch-market-data.mjs` | 是 | Tushare 等数据源需要 token，未配置的数据源自动跳过 |
| 安装 launchd | 否 | 用户明确同意，并写入 `~/Library/LaunchAgents` |
| 安装、选包、绑定项目 | — | 只能通过 Host 的正式界面或 API |

## 3. 逐阶段实现路径

时间线：现在约 03:15Z，截止 2026-10-22T03:08:05Z。

### P0 · Codex 审核本方案（约 1 小时）
- 确认或否决本文的每个决策点，尤其是 §7 列出的待确认项。
- 在 `docs/todo/job-quant-24h-20261021.md` 里记录审核结论。

### P1 · 最低可见闭环（约 6 小时）→ CC 第一次验收

**J1. 两个岗位写入工具抽成共用操作**

- 新建 `apps/job-hunt-hq/app/ops/jobs.mjs`，把下面这些从 `app.js` 原样迁出为纯函数，签名统一为 `(snapshot, args, ctx) → {snapshot, result, changed}`：
  - `normalizeJobUrl`、`jobDedupeKey`、`jobMetadataKey`、`normalizeIncomingOpportunity`
  - `formalJdPath`、`formalJdMarkdown`
  - `save_job_opportunities`、`save_job_research` 的规范化和合并逻辑
- 写 JD 文件：用 `ctx.scope.call("workspace.writeText", …)`，与 `applyOp` 的写锁一致。**【待核实】** JD 文件与快照之间的写入顺序：写失败时要么回滚，要么保证重写一次是幂等的。
- `app.js:14268` 和 `14454` 改为调用 `applyJobHuntPanelOperation`，与 `save_candidate_context` 同一模式；`uid`、`now` 由 ctx 注入。
- 在 `ops/index.mjs` 注册这两个操作。manifest 里的 schema 不变，迁移前后行为一致。

**J2. 只读日报 `get_job_research_digest`**

- 新纯模块 `app/job-digest-model.mjs`。
- 注册为只读操作；manifest 增加对应工具，`readOnly: true`。
- CLI 增加子命令 `digest`，它是 `run get_job_research_digest` 的简写，加 `--write` 时写入 `career-data/reports/job-digest-<YYYY-MM-DD>.{md,json}`（走 workspace 写协议，新文件 `expectedModifiedAt: null`，覆盖时用读到的 mtime）。

**J3. 界面与文档**

- `view-today` 增加"岗位日报"卡片，读取同一个模块的输出。
- 更新 `agent/skills/project-runtime/SKILL.md`：目前写的"仅 4 项操作"改成新的操作清单，并说明哪些仍然需要 Panel。

**Q1. 白话研究报告模块**

- 新纯模块 `apps/quant-lab/app/research-report.mjs`，浏览器和 Node 都能导入，只调用 `runBacktest`、`walkForward`、`parameterSweep`、`drawdownEpisodes`、`researchEvidence`、`analyzeDataset`、`fingerprintBars`。
- 费用和滑点金额由成交记录推算，不改引擎：
  - 买入费用 = shares × entryPrice × fee
  - 卖出费用 = shares × exitPrice × fee
  - 滑点成本：买入 ≈ shares × entryPrice × s/(1+s)，卖出 ≈ shares × exitPrice × s/(1−s)
  - 测试要求：各笔 pnl 之和 = finalEquity − initialCapital。
- `researchEvidence` 增加一个附加字段 `concernDetails: [{code, params}]`，原有的 `concerns` 字符串保持不变，供报告翻成中文。

**Q2. CLI 新命令 `presets`、`research`**

- `presets` 和 `research` 都是只读命令。
- `research` 可选读取同目录的 `<csv 去掉 .csv>.meta.json`，用 `readProjectFile` 读，上限 64KB；读不到或格式坏都标记"来源未知"，不报错退出。
- `ops` 的返回里列出这两个新命令。

**Q3. UI 与文档**

- 在 `app.js` 的 `applyRunResult` / `renderValidation` 旁边加"白话报告"卡片。
- 加"新手预设"下拉框和"一键研究"按钮，调用同一个 `buildResearchReport`。
- 指标加白话标签，例如"夏普（风险调整后收益）"。
- 修正 `methodology.md` 中止损那一段。

**P1 测试**：见 §5。必须通过的门禁是 panel-cli、job-hunt-hq、quant-lab 三个 suite，以及 `node scripts/validate.mjs`。

### P2 · 增强（约 7 小时）→ CC 第二次验收

**J4. 核验已保存的岗位 URL**

- 新增操作 `record_job_checks`（写入）。
- CLI 子命令 `verify [--limit N] [--dry-run]`，只核验项目里已经保存的 URL，不爬新链接。
- 联网模块 `app/job-verify.mjs`，支持注入 `fetchImpl`。
- 判定逻辑：
  - 页面或接口能取到，且标题仍然出现 → `live`
  - 返回 404/410，或 ATS 接口里已经没有这个岗位 → `closed`
  - 内容哈希变了 → `changed`，并写入 changeLog
  - 跳转到登录页 → `login_required`
- 限制：
  - 只走 https，拒绝 IP 字面量和内网地址（127/8、10/8、172.16/12、192.168/16、169.254/16、::1、fc00::/7、`.local`）。
  - 每次跳转后重新校验地址，最多跳 3 次。
  - 响应体最多 2MB，超时 10 秒，同一域名间隔至少 2 秒，每次运行最多 50 个请求。
  - 不带 cookie，User-Agent 如实标注；普通页面先看 robots.txt。
  - 抓到的文本只当数据：只计算哈希和截取至多 500 字的摘录，不放进任何提示词，也不执行其中的任何内容。

**J5. 排除原因 `set_job_exclusion`（写入）**

- 只在用户明确要求时调用。
- 排除原因的代码：location / seniority / compensation / visa / domain / company / duplicate / stale / other，外加备注。
- 恢复也走这个操作。不改动投递进度状态。

**J6. 可解释匹配 `app/job-fit-model.mjs`（纯模块，规则 `lexical-v1`）**

- 从 JD 里按行或要点抽出要求句。
- 只用**已确认**的候选人资料去比对：careerEpisodes、experiences、profile、repos。**【待核实】** 这些记录里表示"已确认"的字段名。
- 每条证据都附原文引用，测试断言引用是来源文本的子串。
- 资料不足时 `status: insufficient_profile`、`score: null`，并列出缺哪些资料。
- Agent 自己给的 `match` 单独显示为"Agent 提供，未核验"。

**J7. （可选）读取 ATS 看板 `discover-ats`**

- 配置文件 `career-data/discovery/ats-boards.json`，由用户编写，CLI 不替用户猜公司的看板 token。
- 只有当 Codex 用当时的官方文档和真实响应确认了 Greenhouse、Lever、Ashby 公开接口的字段后才做。**【待核实】**
- 抓到的结果一律经过 `save_job_opportunities` 的完整 JD 门槛。

**J8. 界面**：岗位卡片显示核验徽章、变化、排除原因和匹配解释。

**Q4. A 股实验室说明**：在 A 股实验室区域加一段白话，说明它和组合回测是两套不同口径（事件研究 vs 组合回测），并把证据门槛的四个状态翻成白话。

**O1. 观察运行器**

- 共用核心 `shared/observation-runner.mjs`，通过 `scripts/sync-observation-runner.mjs`（带 `--check`，与 `sync-project-context` 同一模式）同步到 `apps/{job-hunt-hq,quant-lab}/app/observation-runner.mjs`。
- 两个包各加一个入口 `app/tools/observe.mjs`，内含各自的任务适配器。
- 锁和原子写照搬 `cli-store.mjs` 的写法。

### P3 · 发布、安装与启动观察（约 2 小时，需要用户确认）

**发布**

- 版本号：Job Hunt 升到 **5.1.0**，Quant 升到 **0.47.0**；更新 Job Hunt manifest 里 nativeEntries 的 sha256。
- 运行门禁后合并到 main。
- 安装源只用 main 的合并提交或 release 资产里的 `apps/<id>`，不从 worktree 安装。

**安装（用户在 Host 正式界面操作，或主代理用 Host 正式 API）**

- 安装或升级两个包，并在当前项目里选中或绑定 Quant。
- 这一步做不到时，阻塞项写成："Quant CLI 不可用：已安装 0.46.1 没有 CLI，且项目未绑定"。

**启动观察**

1. 运行 `observe plan` 生成计划；行情代码和 ATS 看板由用户提供或确认。
2. 运行 `observe launchd --print`，把将要写入的 plist 给用户看。
3. 用户同意后运行 `--install`。
4. 立即手动跑一次 `tick` 做冒烟检查。

### P4 · CC 验收

在三个时点做：P1 结束后、P2 结束后、截止时间之后（见 §6）。

## 4. 关键 schema 与命令示例

### 4.1 求职

```sh
PKG="<从 ${CODESHELL_SKILL_DIR}/../../.. 解析出的选中包>"
node "$PKG/app/tools/job-hunt.mjs" ops                                  # 离线，单行 JSON
node "$PKG/app/tools/job-hunt.mjs" run save_job_opportunities --input-file req/jobs.json --project .
node "$PKG/app/tools/job-hunt.mjs" verify --project . --dry-run         # 列出将要发出的请求，不联网
node "$PKG/app/tools/job-hunt.mjs" verify --project . --limit 20
node "$PKG/app/tools/job-hunt.mjs" digest --project . --write
```

`record_job_checks` 的输入（最多 50 条）：

```json
{"checks":[{"target":{"kind":"job","id":"agent-job-…"},
  "checked_at":"2026-10-21T08:00:00Z","method":"page-fetch|ats-api|browser-visible|user-reported",
  "checked_url":"https://…","outcome":"live|closed|changed|unreachable|blocked|login_required",
  "http_status":200,"title_seen":"…","content_sha256":"…","evidence_excerpt":"≤500字，原文","notes":"≤1000"}]}
```

岗位记录新增的可选字段。现有字段不变；Panel 的 `normalizeJobApplication` 和 schema 文件 `formats/*.schema.json` 必须保留这些字段（**【待核实】** 它们是否使用 `additionalProperties`）：

```json
"firstSeenAt":"…","lastSeenAt":"…","sourceKind":"official|ats|board|aggregator|referral|file",
"verification":{"state":"verified_live|unverified|closed|unreachable|login_required|changed_pending_review",
  "lastCheckedAt":"…","lastLiveAt":"…","method":"…","checkedUrl":"…","contentSha256":"…","history":[≤20]},
"changeLog":[{"at":"…","fields":["salary","description"],"via":"verify|save"}],
"exclusion":{"reasonCode":"location","note":"…","decidedAt":"…","source":"user"}
```

`get_job_research_digest` 的输入是 `{since?, now?, limit?: 1..50, format?: "json"|"markdown"}`。输出：

```json
{"generatedAt":"…","window":{"since":"…"},
 "counts":{"formal":12,"verifiedLive":5,"unverified":4,"closed":2,"loginRequired":1,"leads":9,"new":3,"changed":1,"excluded":2},
 "profile":{"status":"insufficient_profile|ok","missing":["技能证据","期望地点","薪资期望","工作许可"]},
 "ranked":[{"jobId":"…","company":"…","title":"…","url":"…","verification":{…},
   "fit":{"status":"scored|insufficient_profile|no_requirements_extracted","method":"lexical-v1",
     "score":null,"requirements":[{"text":"JD 原句","state":"evidenced|not_found|constraint_unknown",
       "evidence":[{"kind":"careerEpisode","id":"…","quote":"原文"}]}],
     "constraints":[{"kind":"location","job":"上海","candidate":null,"state":"unknown"}],
     "agentMatch":{"value":72,"label":"Agent 提供，未核验"}},
   "rankKeys":["verified_live","fit:null","publishedAt:2026-10-18"]}],
 "changes":[…],"excluded":[{"jobId":"…","reasonCode":"…","note":"…"}],
 "research":{"covered":3,"missing":9},"limitedSources":["boss: login_required"],
 "disclaimer":"仅为研究整理；未投递、未联系任何人；线索不计为岗位"}
```

排序规则：

1. 已核验在招的排在前面。
2. 再按匹配分排序；没有分数的排在后面，并注明原因。
3. 再按发布时间。
4. 最后按 `firstSeenAt`。

每条记录都给出 `rankKeys`，说明它为什么排在这里。

Markdown 日报分 8 节：

1. 概览
2. 资料完整度
3. 建议复核顺序及依据
4. 变化
5. 排除和规则筛除提示（规则只做提示，不落库）
6. 公司调研覆盖情况
7. 受限来源与下一步
8. 声明

### 4.2 量化

```sh
QPKG="<选中的 quant-lab 包>"
node "$QPKG/app/tools/quant-lab.mjs" presets
echo '{"demo":true,"preset":"trend-sma","format":"markdown"}' | node "$QPKG/app/tools/quant-lab.mjs" research
echo '{"csv":"data/market/SH600519.csv","preset":"trend-sma","market":"cn"}' | node "$QPKG/app/tools/quant-lab.mjs" research --project .
```

`research` 的输入规则：

- `csv` 和 `demo:true` 必须且只能给一个。
- `preset` 和 `configuration`（可带 `ranges`）必须且只能给一个。
- 可选字段：`market: cn|us`、`options:{inSampleBars,outOfSampleBars}`、`format: json|markdown`。
- 这些跨字段规则由代码校验，计算量仍受 `WORK_LIMIT` 限制。

预设（参数由 Codex 审核时确认）：

| id | 规则 | 样本外参数网格 | 费用/滑点（bps） |
|---|---|---|---|
| `trend-sma` | 20/60 日均线：快线在上时持有 | fast [10,20,30] × slow [50,60,90] | cn 5.5/10，us 1/5 |
| `breakout-channel` | 收盘突破前 55 日最高价买入，跌破前 55 日最低价卖出 | lookback [20,40,55] | 同上 |
| `rsi-reversion` | RSI14 低于 30 买入，高于 70 卖出 | oversold [25,30] × overbought [65,70] | 同上 |

- A 股 5.5bps 的来源：`A_SHARE_STRATEGY_ASSUMPTIONS` 中佣金买卖各 3bps、卖出印花税 5bps，一买一卖合计 11bps，摊成双边各 5.5bps。报告里要写明"印花税按双边平均近似"。
- 预设默认：`stopLossPct: 0`（避开上面提到的止损口径不一致）、满仓、本金 100,000。

报告 JSON 结构（`format: codeshell.quant-research-report v1`）：

```json
{"verdict":{"tier":"not_supported|insufficient_evidence|worth_more_research","reasons":["…"]},
 "rules":{"buy":"当…后下一交易日开盘买入","sell":"…","timing":"收盘计算、次日开盘成交，含滑点"},
 "money":{"initialCapital":100000,"sizing":"每次投入全部现金，允许零碎股（未按 100 股取整）",
   "feesPaid":1234.5,"slippageCost":2100.0,"feeBps":5.5,"slippageBps":10},
 "outcome":{"finalEquity":…,"pnl":…,"totalReturn":…,"maxDrawdown":{"pct":…,"amount":…,"peakDate":"…","troughDate":"…"},
   "trades":…,"winRate":…,"worstTrade":{…}},
 "benchmark":{"kind":"buy-and-hold","return":…,"note":"从首根收盘起算，不计费用"},
 "outOfSample":{"ran":true,"folds":…,"pooledReturn":…,"beatBenchmarkRate":…,"degradation":…,"untestedTailBars":…,
   "note":"每折从初始资金重新计算，不复利"},
 "sweep":{"scope":"full-sample","note":"在全部数据上挑最优，结果偏乐观，不能代表样本外"},
 "data":{"path":"…","bars":…,"from":"…","to":"…","fingerprint":"fnv1a32:…","source":"…|未知","adjust":"qfq|…|未知",
   "syncedAt":"…|未知","warnings":[…],"synthetic":false},
 "limitations":["…"],"concerns":[{"code":"…","text":"中文"}],
 "whyNotFuture":"…","engine":{"version":"…"}}
```

`limitations` 至少要包括以下几条，全部来自代码核实：

- 不按 100 股取整，不建模涨跌停无法成交、最低佣金、买卖费率不对称和流动性。
- 入场当天不检查止损。
- 基准不计费用。
- 期末按收盘价平仓。
- 参数扫描是样本内结果；没有多重检验校正。
- 复权口径取决于侧车文件；没有侧车就是"未知"。
- 指纹只用来发现数据变化，不能证明数据来源。

### 4.3 观察运行器

```sh
node "$PKG/app/tools/observe.mjs" plan    --project . --run jobs-obs-20261021 --deadline 2026-10-22T03:08:05Z --interval 180
node "$QPKG/app/tools/observe.mjs" plan   --project . --run quant-obs-20261021 --symbols SH600519,AAPL --interval 60 --deadline 2026-10-22T03:08:05Z
node "$QPKG/app/tools/observe.mjs" tick   --project . --run quant-obs-20261021      # 跑一轮就退出，不 sleep
node "$QPKG/app/tools/observe.mjs" status --project . --run quant-obs-20261021      # 只读
node "$QPKG/app/tools/observe.mjs" stop   --project . --run quant-obs-20261021      # 写停止标记 + bootout + 删除 plist
node "$QPKG/app/tools/observe.mjs" launchd --project . --run quant-obs-20261021 --print   # 只打印 plist 和命令
node "$QPKG/app/tools/observe.mjs" launchd --project . --run quant-obs-20261021 --install # 用户确认后才执行
```

计划文件 `observations/<runId>/plan.json`。目录名不以点开头，因为 Quant 的路径规则拒绝隐藏路径：

```json
{"format":"codeshell.observation-plan","version":1,"runId":"quant-obs-20261021","app":"quant-lab",
 "package":{"version":"0.47.0","toolPath":"/abs/…/app/tools/observe.mjs","toolSha256":"…"},
 "createdAt":"…","deadline":"2026-10-22T03:08:05Z","intervalMinutes":60,"maxTicks":30,
 "limits":{"requestsPerTick":20,"requestsTotal":400,"maxConsecutiveFailures":3,"backoffBaseMinutes":30,"backoffMaxMinutes":180},
 "tasks":{"symbols":["SH600519"],"watchRules":[…],"researchPreset":"trend-sma"}}
```

运行时生成的文件：

- `state.json`：status 取值 `scheduled|running|idle|backing_off|expired|stopped|failed|package_changed`，另有 ticks、lastTickAt、nextEligibleAt、consecutiveFailures、requestsUsed、lastError。
- `ticks/<UTC>.json`：每轮一份。
- `log.ndjson`：超过 5MB 轮转。
- `tick.lock/owner.json`
- `stop-requested`
- `final.md`：截止后第一轮生成。

**每一轮 tick 的流程**

1. 加锁。锁的持有进程还活着就跳过本轮，记为 `skipped:overlap`；持有进程已死就回收锁。
2. 有停止标记，或已过截止时间 → 状态改为 `stopped`/`expired`，写 `final.md`，用校验过的 label 执行 `launchctl bootout gui/<uid>/<label>`，然后退出。
3. 包路径或哈希变了 → `package_changed`，不做任何操作。
4. 还在退避期内 → 跳过。
5. 执行任务，过程中计入请求预算。
6. 原子写入 tick 记录和状态，释放锁。
7. 失败 → 按指数退避；连续失败达到上限 → `failed`，之后每轮都不再执行。

**两个 app 的任务**

- **Quant**：只有当最后一根 K 线早于预期交易日时，才调用 `fetch-market-data.mjs` 做增量更新。它会拒绝混用数据源或复权口径；失败照实记录。然后运行 `evaluateWatchItem` 和研究摘要。
- **Jobs**：运行 `verify`（有限额）和 `digest --write`。`discover-ats` 只在用户配置了看板时运行。

**必须写进最终摘要的事实**

- 24 小时内日线最多新增 1–2 根，所以这只是观察日志，**不是策略验证**。
- 实际观察的时长是从启动到截止，不满 24 小时。

**plist 要求**

- `Label`：`ai.codeshell.panel.<app>.<runId>`，runId 必须匹配 `^[a-z0-9-]{1,48}$`。
- `ProgramArguments`：安装时的 `process.execPath` 和工具的绝对路径。
- `StartInterval` = interval × 60，`RunAtLoad` 为 true。
- 不设 `KeepAlive`；`ProcessType` 设为 Background；stdout/stderr 写到 observations 目录。
- 生成 plist 时做 XML 转义。
- 如果包路径的上层有 `.git` 或位于 `.codex/worktrees`，安装直接拒绝；测试用 `--allow-dev-path` 例外。

## 5. 24 小时运行：两件事分开

### 5.1 行情/岗位观察（launchd）

- 全程不调用大模型，费用只有网络请求，且有预算上限。
- 截止后自动停止并卸载 launchd；`stop` 是手动停止入口；`status` 和 Panel 状态卡读同一份 `state.json`。

**风险**：项目在 `~/Documents` 下，launchd 启动的 node 可能被 macOS 隐私保护（TCC）拦截，读不到项目。**【待核实】**

- 冒烟检查：安装后立即用 `launchctl kickstart` 触发一轮，检查 `ticks/` 里有没有新记录。
- 如果被拦截，有两个选择，都需要用户决定：
  - 给 node 授予"完全磁盘访问"；
  - 把观察用的项目放到不受保护的目录。

### 5.2 Host `automations.*`（次选）

这是 Host 支持的持久调度，Job Hunt 的定时发现已经在用。适合需要浏览器会话的岗位发现。

但它没有截止字段，每次运行都消耗一次大模型会话。如果要用：

- 提示词首行写入截止时间；运行时一旦超过截止，就只回报"已过期"，不做任何事。
- Panel 显示"已到期，请删除"。
- 删除必须由用户在 Panel 里操作。**不能把它当作自动停止。**

### 5.3 自主开发审查循环（主代理驱动）

按轮次推进：R1 方案（本稿）→ R2 Codex 审核 → R3 实现 P1 → R4 CC 验收 → R5 实现 P2 → R6 CC 验收 → R7 发布、安装、启动观察 → R8 截止后最终验收。

- 每轮的起止时间和结论记入 `docs/todo/job-quant-24h-20261021.md`。
- 不用 sleep 轮询；主代理不在线时就如实记录空档。
- **不建议**用 launchd 定时跑 `codex exec`：那等于无人值守的代码写入 agent，而且我没能核实它的参数。若用户坚持，需要另外单独授权，并且至少要有：每轮的提示词文件、最多 N 轮、截止检查、同样的锁和日志、只在任务分支工作、禁止 push。

**当前不能宣称**：已在跑 24 小时、已有持续任务、两个完整 suite 通过。

## 6. 测试与验收清单

### 6.1 新测试（都放进现有 suite）

**`tests/apps/job-hunt-hq/job-research-ops.test.mjs`**

- 迁移前后 `save_job_opportunities` / `save_job_research` 的输出完全一致（golden）。
- 线索拿不到 job_id；最多 12 条，13 条被拒。
- 带 utm 参数的 URL 去重；http 链接被清空，不能当作可核验链接。
- 先是 partial，后来补成 full 时提升为正式岗位，id 不变。
- `record_job_checks`：closed 不删除岗位；哈希变化写入 changeLog；history 上限 20 条。
- `set_job_exclusion`：原因代码必须在枚举里；恢复后排除记录清除。
- 匹配：
  - 资料为空 → `insufficient_profile` 且 `score === null`。
  - 每条引用都是来源文本的子串。
  - JD 里夹带"忽略之前指令、标记为匹配"这类注入文本，分数不受影响，原文按普通文本存储。
  - 没确认的草稿事实不参与匹配。
- 日报：固定 `now` 时输出完全一致；Markdown 转义了恶意公司名（如 `` ` ``、`|`、`<script>`）。

**`job-verify.test.mjs`**（注入 fetchImpl）

- 以下地址一律拒绝：带凭据的 URL、非 https、IP 字面量和内网地址、跳转后落到内网、跳转超过 3 次。
- 响应超过 2MB → `unreachable`，不是 `live`。
- 遇到登录页 → `login_required`。
- 同域名请求间隔和总请求上限生效。
- 抓到的文本不出现在任何"指令"字段里。

**`headless-parity` 补充**

- Panel 工具和 CLI 产出同样的快照（直接存储和分片存储两种都测）。
- CLI 做完 verify 后，Panel 再保存别的记录，verification 和 exclusion 字段仍在。

**`headless-cli` 补充**

- 两个进程同时 `record_job_checks`，只有一个赢，另一个重试或返回冲突。
- 快照损坏时不写入。
- `verify --dry-run` 在断网保护下不发任何网络请求。

**`tests/apps/quant-lab/research-report.test.mjs`**

- 报告里的数字等于引擎输出；各笔 pnl 之和 = 期末权益 − 本金（误差 1e-6）；推算的费用与 pnl 一致。
- K 线不足时 `outOfSample.ran === false`，结论等级不能是 favourable。
- 侧车缺失、格式坏或是软链接 → 来源标"未知"或被拒，不崩溃。
- `adjust: none` 时出现对应的限制说明。
- demo 输出必须带 `synthetic: true` 和"非真实行情"字样。
- 用户给的 configuration 和 preset 同时出现被拒。
- 超过 `WORK_LIMIT` 返回退出码 2。
- `validate.mjs` 里固定的引擎结果不变。

**`quant-lab headless-cli` 补充**：`research`、`presets` 都只输出单行 JSON，且不写项目文件。

**`tests/observation-runner.test.mjs`**（注入时钟，不 sleep）

- 过了截止时间 → 不做任何事，状态 `expired`，生成 `final.md`。
- 锁被活进程持有 → 跳过；锁的持有进程已死 → 回收。
- 两个 tick 并发 → 只有一个执行。
- 有停止标记 → 不执行。
- 退避间隔正确；达到 maxTicks 后停止；连续失败后 `failed`。
- 原子写入拒绝软链接目录；计划路径穿越被拒。
- plist 做了 XML 转义，非法 label 被拒；worktree 路径拒绝安装。
- `--print` 不写任何文件。

**`panel-cli` 门禁**

- 两个包的 `ops` 仍然离线、单行输出、不写文件。
- Skill 文件引用了 CLI 路径。
- 如果把 `observe.mjs` 声明为公开入口，就把它加进门禁列表。

### 6.2 Codex 提交前必须跑

```sh
npm test -- --suite panel-cli
npm test -- --suite job-hunt-hq
npm test -- --suite quant-lab
node scripts/validate.mjs
node scripts/sync-project-context.mjs --check && node scripts/sync-observation-runner.mjs --check
```

- 有 Chromium 时补跑 `npm run test:ui:quant-lab`；跑不了就写明跳过。
- 有已构建的 Host 时，可选再跑 `npm run test:host-storage`。

### 6.3 CC 独立验收

不以 Codex 的自报为准，逐项检查：

1. 读实际 diff：
   - 没有改 Host，没有手改 `job-hunt-panel.json`。
   - 引擎的计算行为没变；`researchEvidence` 只多了一个附加字段。
   - 安装源不在 worktree。
2. 在本地重新跑上面的门禁，看真实输出。
3. 把包复制到临时目录，在空项目里跑 `ops` 和 `research {"demo":true}`，并检查：
   - 报告里有买卖规则、金额、费用、回撤及其日期、基准、样本外、数据来源、限制和"为什么不能当未来收益"。
   - 输出带合成数据标注。
4. 在测试 fixture 项目里依次跑 `run save_job_opportunities`、`verify`（注入 fixture 响应）、`digest`，并检查：
   - 每个正式岗位都有 URL、fetchedAt、核验记录。
   - 资料为空的项目显示"无法个性化"。
   - 没有任何生成出来的岗位。
5. 安装后：
   - 通过项目里选中的包所对应的 Skill 路径跑 `ops`，确认版本号和新增的操作。
   - Quant 未绑定时记为阻塞，不算通过。
6. 观察：
   - `launchctl print gui/$UID/<label>`、`state.json`、`ticks/` 的数量与经过的时间、间隔相符。
   - 截止后状态为 `expired`/`stopped`，launchd 已卸载，有 `final.md`。
   - 抽查 tick 记录里的数据日期和来源。
7. 在 todo 文档里如实写出：哪些通过，哪些跳过，哪些阻塞。

## 7. 风险与待确认项

1. **【待核实】安装与绑定**：Quant 已安装的版本没有 CLI，当前项目也没绑定，这是量化 CLI 闭环的硬阻塞，只能由用户在 Host 正式界面里处理。Job Hunt 从 4.2.1 升到 5.x 会带上 main 上其他尚未发布的改动，需要做一次升级回归。
2. **【待核实】快照 schema**：`formats/job-hunt-panel-v2.schema.json`、分片 schema 和 `normalizeJobApplication` 是否会丢掉新字段。如果会，就必须改 schema 和规范化逻辑，并加 parity 测试。
3. **【待核实】联网**：Host Bash 和 launchd 环境下能否联网，以及 macOS 隐私保护是否拦截 `~/Documents`。
4. **【待核实】ATS 接口**：Greenhouse/Lever/Ashby 公开接口的字段和使用条款，以 Codex 查到的官方文档和真实响应为准。确认不了就不做 `discover-ats`，只做核验已保存 URL。
5. **【待核实】止损口径**：文档和代码不一致。本轮只改文档并写进报告限制；改引擎需要另立任务，因为会改变已固定的结果。
6. **字面匹配的局限**：`lexical-v1` 只比字面，同义词会漏判，所以只作为"证据对照"展示，不作为推荐结论。
7. **观察时长**：截止时间沿用 2026-10-22T03:08:05Z，实际观察时长等于启动到截止，不满 24 小时。要观察满 24 小时，需要用户同意新的截止时间。
8. **参考项目**：ai-job-scout 是否就是用户说的项目还没确认，主代理已在询问；本方案没有逐条比对原文。
9. **完整 suite 状态**：两个完整 suite 在宿主切换时没拿到最终结果，目前仍不能宣称通过；以 Codex 重跑和 CC 复跑为准。
10. **需要用户授权的动作**：安装 launchd、Host 的 automations、安装或绑定包、以及任何无人值守的 agent 循环，都要先征得用户同意。投递、联系第三方、实盘一律不做。
