# 求职 / 量化 24h：实现候选回执

分支 `codex/panel-shared/job-quant-24h-20261021`。候选版本 Job Hunt HQ **5.1.0**，Quant Lab **0.47.0**。仅业务 apps、相关测试/scripts/shared 和本任务文档有变更；未改变 Quant 引擎或其 golden。未接触个人求职快照/账本、Host、其他面板业务。

## 已实现及入口

- 求职 `app/ops/jobs.mjs` 抽取岗位标准化/分流与公司调研；Panel 通过 `applyJobHuntPanelOperation`，公开 `app/tools/job-hunt.mjs` 通过相同 ops。完整 JD 先写不可变内容地址附件，再 CAS 提交快照；只读日报在 ops 注册 CLI schema，保持 manifest 16 个工具上限。
- `job-research-digest.mjs` 生成中文 Markdown + 结构化日报，只有当前确认的经历/QA 原句进入证据对照，保留实体 ID/字段。空资料、未知约束、来源、获取时间、核验回执、变化/排除未知均可见；无新匹配百分比。证据/公司来源/变化有展示预算和省略计数。今日日报、可见“岗位研究”导航和研究视图复用同一模型。
- Quant `app/research-report.mjs` 复用 runBacktest/walkForward/researchEvidence，准确还原引擎假设内费用/滑点、实际峰谷金额/日期、基准和 OOS 口径。三个新手预设和显式配置互斥；项目 CSV / 合成 demo 互斥。CLI 单行 JSON 中包含 Markdown；UI 首屏是五张白话卡片，完整来源/公式/限制折叠展开，参数/数据/项目变化清理旧报告。
- 两个公开 CLI 的 `observe` 只重读已有 JD/CSV，JSON action 为 plan/tick/status/stop；单轮后退出。`shared/observation-runner.mjs` 为唯一源码，两个 installable copy 由同步脚本校验。版本化计划、固定绝对截止 2026-10-22T03:08:05Z、单实例锁、死进程安全回收、日志、轮次/失败上限、退避、停止标记、回执恢复、终态时间与 final.md 均已实现并注入时钟测试。没有自动抓取、实时监控或 OS 调度安装。
- Runtime Skill、job-intelligence、README 已更新。CLI 不提供 verify/discover-ats；网络核验仍由实际 Agent/浏览器读取官方/ATS原文完成。HTTP200不等于在招；不充分回执默认 unverified。

在当前项目选择的包中运行（勿猜另一安装版本）：

```sh
node "<Job包>/app/tools/job-hunt.mjs" ops
node "<Job包>/app/tools/job-hunt.mjs" run save_job_opportunities --project "<项目>" --input-file "jobs.json"
node "<Job包>/app/tools/job-hunt.mjs" run save_job_research --project "<项目>" --input-file "company.json"
node "<Job包>/app/tools/job-hunt.mjs" run get_job_research_digest --project "<项目>" --input-file "digest.json"
node "<Quant包>/app/tools/quant-lab.mjs" presets
node "<Quant包>/app/tools/quant-lab.mjs" research --project "<项目>" --input-file "research.json"
```

`digest.json` 可为 `{"limit":10}`；`research.json` 为 `{"demo":true,"preset":"trend-sma"}` 或 `{"csv":"data/market/AAPL.csv","preset":"trend-sma","market":"us"}`。首次求职空项目用 init；Host Chat 写入仍须按 Runtime Skill 检查真实 workspace-write protocol。

观察请求例如 `{"action":"plan","runId":"jobs-existing","task":{"limit":10},"maxTicks":24}`，调用 Job 的 `observe --project <项目> --input-file request.json`。Quant 同命令但 task 为 `{"csv":"data/market/AAPL.csv","preset":"trend-sma"}`。后续请求只传具体 action 和 runId。status 只读，stop 写停止标记，记录独立保存于项目 `observations/<runId>/`。

## 真实验证及证据边界

| 检查 | 实际结果 | 日志 / 收据 |
| --- | --- | --- |
| 当前核心域、公开CLI（含独立拷包）、观察测试 | **43/43，exit0** | product-domain-final.log / .receipt.json |
| 线索晋级仍保留核验/排除字段的末次回归 | **8/8，exit0** | job-promotion-last-change.log |
| 末次 validate（含晋级修复） | **exit0** | validate-last-change.log |
| 最后报告文案与侧车时间验证变更 | **12/12，exit0** | quant-report-last-change.log |
| npm test -- --suite panel-cli | **6/6，exit0** | panel-cli-final.log / .receipt.json |
| node scripts/validate.mjs | **exit0，固定引擎检查不变** | validate-final.log / .receipt.json |
| shared copy、project context、native hashes | **全部通过** | sync-observation-runner.log / sync-project-context.log / native-hashes.log |
| 主代理外层完整求职 suite | **374/374，exit0** | parent-job-final.log / .receipt.json |
| 主代理外层完整 Quant suite | **233/233，exit0；16个流程脚本通过** | parent-quant-final.log / .receipt.json |
| 主代理外层真实浏览器 parity | **10/10，exit0** | parent-parity-rerun.log / .receipt.json |
| 主代理外层量化按钮交互 | **exit0** | parent-quant-ui-final.log / .receipt.json |

当前受限实现进程重新运行了两个完整 suite 和量化 UI，分别 exit1：Job 375项中291通过/84环境失败，Quant 233项中223通过/10环境失败；原因是本地 listen EPERM / Chromium MachPort Permission denied。对应本地 `job-hunt-hq-final`、`quant-lab-final`、`quant-ui-final` 日志和收据保留，未隐藏或改为 skip。CUA 也未获 Chrome 控制权限，未绕过沙箱。

上表外层通过结果来自主代理写入的独立真实日志，不是实现者本沙箱成功启动了浏览器，也不是 CC 验收。完整外层套件之后又增加了观察终态时长/校验、报告文字/非法 syncedAt 验证、公司摘要展示、线索晋级保留核验/排除字段及更强的 CLI→Panel 后续往返断言；观察与报告对应单测已重跑通过，最后增加的浏览器断言仍应由外层在最终候选上复跑。需要完整最终版本复测时，保留本文件并更新真实收据，不能把历史结果冒充最新哈希结果。

`candidate-sha256.json` 固定候选核心文件；`demo-research.json` / .md 是公开 CLI 实际输出，明确为合成行情。其他 parent-* 文件属于主代理独立复核，未由实现者修改。

## 交付状态 / 待接续

- 已读 diff/status，git diff --check 通过。工作区保留变更供主代理提交；未尝试突破只读的公用 Git 目录。初始方案、审核、提示和主代理复核文档均保留。
- 未 push、release、安装到用户 Host、绑定 Quant、写 LaunchAgents 或建立 OS 定时器；没有启动真实个人项目观察，未声称已经运行满24小时。
- 本候选具备产品与最小观察闭环；仍待主代理最终版本外层复测、独立 CC 验收、稳定包交付及之后的安装/有截止调度。无通用网络爬虫、ATS发现或自动网页verify能力。

主代理最后修订：可复用observe默认每份计划创建后24小时截止，并允许更早时间；当前任务控制器仍固定原截止。日报同时截取legacy长字段和展示范围内历史，原快照不变。新测试与收据以00-parent-receipts.json latestFinalChanges为准。
