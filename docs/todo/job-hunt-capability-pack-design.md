# Job Hunt HQ 能力包：脱离面板运行（简历样板）

> 状态：Job Hunt HQ v4.2.1 已正式发布；生产安装、实际所选 Skill / CLI 与正式 Desktop 自然 Chat 四操作验收均已通过，面板未自动打开，真实求职快照未改变。Desktop 0.9.37 完成安装与能力可见性验收，本机随后更新为 0.9.40，最终 Chat 回执记录该当前版本。日期：2026-10-13。<br>
> 首次 Panel 实现已通过 PR #77 合入 `main`；既有发布与隔离证据保留，当前生产安装验收维护分支为 `codex/job-hunt-hq/installed-runtime-acceptance`。配套 Host 从 0.9.36 起提供共用文件写入锁，后续正式 Desktop 的能力可见性与自然调用证据见第 7.6 节。<br>
> 本文从 `codeshell/docs/todo/` 迁入，基于 Job Hunt HQ v4.1.2 更新。下文应用路径相对于 `apps/job-hunt-hq/`。

## 0. 本版范围

Panel 是能力包，同时提供可视化工作台；Chat、UI、CLI 是调用入口。继续使用现有
`job-hunt-panel.json`、分片、备份和外部修改检测，不另建数据格式或存储服务。

本版抽取简历样板所需的四个操作：

| 操作 | 用途 | CLI |
| --- | --- | --- |
| `get_job_search_context` | 分页、按 scope / ID 读取上下文 | 已纳入本版 |
| `save_candidate_context` | 保存已核验的候选人事实和来源索引 | 已纳入本版 |
| `save_resume_qa_answer` | 回答已有简历的私有问答 | 已纳入本版 |
| `save_resume_draft` | 保存带证据的 Base / JD 简历 | 已纳入本版 |

这四个操作中有一个只读、三个写入。现有共 16 个 Tool，其中 15 个写入；其余 12 个
Tool 留在页面中，继续通过 Panel 调用，迁移放到 P3。`complete_execution_trace` 也在
这 12 个中，直接 Chat / TUI 的 CLI 任务不创建或结束 Panel Trace。

“决策”沿用现有私有简历问答的 `candidate_questions[].category: "decision"`。
第一版不增加独立实体或第 17 个 Tool，等样板使用后再评估。

## 1. 验收行为

1. 用户直接在 Chat 发起候选人整理、问答回答或简历保存时，通过安装包内 CLI 写入，
   面板不会弹出。回答问答要使用已有 `resume_id` / `question_id`；没有简历时先保存草稿。
2. 同一 CLI 能在 TUI / 终端调用，不依赖 DOM 或打开页面。
3. 面板提交的 prompt 带 `Panel Trace ID` / `trace_id` 时继续走 Panel Tool，保留现有
   Trace、草稿、回滚和任务结束流程。
4. 面板已打开且无未保存编辑时，检测到 CLI 更新后自动重新读取；有编辑时提示冲突并停止覆盖。
5. 同一快照、参数、时钟和 ID 上下文经过 Tool 操作层或 CLI 后，业务数据和结果一致。
   存储代际、创建时间和来源等由运行上下文决定，不用真实运行生成的随机文件名判断一致性。
6. Skill 在实际 CodeShell Bash 中读取 Host 注入的 `CODESHELL_WORKSPACE_WRITE_PROTOCOL`，
   仅值为 `1` 时允许无界面初始化或写入；缺少或不同则报告需要升级 Host 并停止写入。
   只读操作不受此能力前置限制。独立终端 CLI 不要求此标记，但同时使用项目的 Host
   必须支持共用锁协议（CodeShell ≥0.9.36）。

## 2. 复用的现有能力

| 能力 | 现有实现 |
| --- | --- |
| 权威数据 | `job-hunt-panel.json`，大字段拆到 `career-data/panel-shards/<gen>/` |
| 分片提交 | `snapshot-storage.mjs` 先只新建分片，再对主文件做 revision / modifiedAt 条件写入 |
| 备份与恢复 | `snapshot-backup.mjs`、`snapshot-restore.mjs` 等现有模块 |
| 外部修改检测 | 页面轮询 revision，干净时重新读取，存在未保存编辑时标记冲突 |
| 业务模型 | `resume-model.mjs`、`interview-bank-model.mjs`、`job-search-context-model.mjs` 等纯模块 |
| 包内 CLI 先例 | quant-lab 的 `project-runtime` Skill 用 `CODESHELL_SKILL_DIR` 定位选定包并运行其中的 Node 工具 |

本版补上原本写在 `app.js` handler 中的操作抽取。既有 Tool 名称和参数 schema 不变，
技能数量由 5 个变为 6 个，仍在 8 个上限内。

## 3. 实现结构

```text
Chat（面板发起，带 trace_id）── Panel Tool ── app.js 薄 handler ──┐
Chat（直接发起）── project-runtime Skill ── Node CLI ───────────┤
TUI / 终端 ─────────────────────────────── Node CLI ───────────┤
                                                             ▼
                        app/ops/*.mjs   共享纯操作
                       (snapshot, args, ctx) → { snapshot, result }
                                                             │
                        app/snapshot-codec.mjs   快照投影 / 归一化
                        app/snapshot-storage.mjs 现有分片提交协议
                           ├─ 页面：workspace.* 由 Host 执行
                           └─ CLI：app/tools/node-workspace-scope.mjs
                                                             ▼
                        job-hunt-panel.json + career-data/panel-shards/**
```

### 3.1 共享操作层和编解码

`app/ops/` 汇总四个操作；校验、候选人合并、简历归档、证据检查和 QA 更新在操作层完成。
操作层不访问 DOM、`window`、页面 `state` 或 `node:*`，依赖由上下文注入的时间、来源、
Session / Trace 信息。`snapshot-codec.mjs` 提供页面和 CLI 共用的归一化与写入投影。

页面调用相同操作后，仍执行原有 persist、render 和 Host 保存流程；CLI 读入当前快照、
运行操作，再通过既有分片读写协议提交。读操作不写快照。既有其余 handler 不作迁移。

### 3.2 CLI

运行前置条件为 **PATH 中存在 Node.js 20.10 或更高版本**；初始化和写入还要求
**运行中的 CodeShell Host 0.9.36 或更高版本**。使用当前项目选中的安装包，不依赖开发
仓库的 `node_modules`。本版 CLI 只使用 Node 内置模块和包内业务模块。

```sh
node "<package-root>/app/tools/job-hunt.mjs" ops
node "<package-root>/app/tools/job-hunt.mjs" init --project "<project-dir>"
node "<package-root>/app/tools/job-hunt.mjs" run <operation> \
  --input-file "<request.json>" [--project "<project-dir>"] \
  [--session "<session-id>"] [--trace "<trace-id>"]
```

- `ops` 输出本版支持的四个操作及其精确参数 schema；CLI 和 Tool 沿用 manifest 中的名字与字段。
- 显式 `--project` 只使用指定目录，不向上寻找其他项目。未指定时，从当前目录向上寻找
  最近的 `job-hunt-panel.json`。没有快照时用 `init` 初始化指定项目。
- `init` 通过共享 codec 只新建缺失快照、`CODESHELL.md` 和候选人资料模板，保留已有
  内容；中断后可再次执行以补齐缺失模板，损坏快照不会被当作新项目替换。它不扫描
  或推断候选人事实；资料识别和已有项目指令整理仍由 workflow 的初始化模块完成。
- `run` 的输入是一个 JSON 文件，内容必须满足对应 Tool 的 schema。
- stdout 只输出一行 JSON：`{ok:true,result}` 或 `{ok:false,error:{code,message}}`。
  退出码：`0` 成功，`2` 参数失败，`3` revision 冲突，`1` 其他失败。
- 简历保存和 QA 更新在当前简历上写 `source: "cli"` 及传入的 Session ID，归档版本
  保留来源；候选人公开画像变化会更新受影响的已有简历版本。传入 Trace 时更新匹配的
  `workflowRuns` 条目，不伪造会话 ID。独立候选人保存若没有已有简历或匹配 Trace，
  本版没有单独的持久来源记录，不新增实体。
- 条件写入冲突时最多重新读取并重跑纯操作一次，再次冲突返回 `REVISION_CONFLICT`
  和退出码 `3`。不会重复提交旧快照，不进行无限重试。

### 3.3 Node workspace 适配

`app/tools/node-workspace-scope.mjs` 用 Node fs 实现现有存储模块需要的 `workspace.*`：

- 项目内相对路径校验，拒绝越界、隐藏路径和符号链接。
- `expectedModifiedAt: null` 只允许新建，已有文件不能被覆盖。
- 写入前比较内容 revision 和 modifiedAt；不匹配时拒绝。
- 临时文件与原子 rename 避免读到部分主文件；分片只新建。
- revision 使用文件内容哈希，各端使用自己读取的 revision 做自己的条件写入，不能交换口径。
- CLI writer 通过项目根目录的 `.job-hunt-write.lock` 目录互斥，最长等待五秒；超时返回
  `REVISION_CONFLICT`。异常退出可能留下锁，必须核实没有活跃 CLI writer 后手动清理，
  不能仅凭超时自动删除锁。`init` 同样受此锁保护。
- Host 0.9.36 与 CLI 还对每次文件提交使用同一把跨进程锁：目标文件父目录下
  `.codeshell-workspace-write-${sha256(filename.normalize("NFC").toLowerCase())}.lock`。
  `mkdir` 获取锁，权限为 `0700`，以异步等待最多五秒；在锁内检查 revision 并原子
  替换。释放前核对目录 device / inode，避免删除已被替换的锁；不自动清理崩溃锁。

这些约束复用既有数据协议，并让兼容 Host 与 CLI 的 revision 检查和原子替换共同处于
文件锁内。旧 Host 不参与此协议，因此不支持与本版 CLI 并发写入；不能把新 CLI 的
锁单独当作旧 Host 已受保护。真实进程联合验收已确认兼容 Host / CLI 在最终 revision
检查与 rename 之间互斥，旧的并发覆盖窗口已在参与协议的 writer 范围内关闭。

### 3.4 Skills 与 manifest

- 新增 `agent/skills/project-runtime/SKILL.md`。从 `${CODESHELL_SKILL_DIR}/../../..`
  定位当前项目选中的包，校验 manifest ID `job-hunt-hq`，读取并运行其中的 CLI。
  找不到所选包或脚本时返回 `bundled-job-hunt-cli-not-found`，不回退到源码目录或另一版本。
- Skill 在无界面初始化或写入前，通过真实 Bash 读取
  `CODESHELL_WORKSPACE_WRITE_PROTOCOL`，仅值为 `1` 时放行；否则报告
  `headless-host-upgrade-required` 并停止写入。该业务无关的能力标记由 Core 注入前台 /
  后台 Bash，项目环境不能覆盖，Skill 不得导出或伪造它。当前 Host 的 manifest v1 / v2 都是严格
  schema，没有 `minHostVersion` 等兼容版本字段，也没有对应安装 gate；因此仅在合法
  manifest description 中说明要求，由 Skill 执行前检查，不能添加未知字段或从
  Panel API 14 推断支持。全局 `code-shell --version` 也不能证明当前 Host 支持协议。
  独立终端 CLI 不强制环境标记；若项目同时由 Host 使用，须确保该 Host ≥0.9.36。
- `job-hunt-workflow` 首先分辨发起方：面板 Trace 走 Panel；直接 Chat / TUI 的四个支持
  操作走 CLI。其余操作明确提示需要打开面板，不能宣称已无界面保存。
- resume-writing 写回遵循 workflow 选定路径；初始化参考同步说明 CLI `init`。
- 首次 `4.2.0` 新增第六个 Skill 和 `nativeEntries.job-hunt`，保留 16 个 Tool；当前发布
  manifest 为 `4.2.1`，仅随 CLI 入口补丁更新版本和入口哈希，Tool、Skill 与权限不变。
  原生入口的 SHA-256 随 CLI 最终字节同步，并由现有包校验验证。

## 4. 验证

首次 4.2.0 已通过的检查覆盖如下；4.2.1 补丁的增量检查单独记录在第 7.3 节：

- 四个纯操作的输入校验、候选人合并、简历层级与证据、归档和 QA 状态。
- Tool / CLI 共用操作的一致性：使用固定时间和 ID 的同一输入比较返回结果及写入数据。
- CLI 初始化和已有文件保留、错误码、分片读写、revision 冲突后的有限重试。
- 路径越界、隐藏路径和符号链接拒绝；项目根目录被替换时停止访问；损坏或字段类型
  错误的快照不被当作新项目覆盖；部分初始化可补齐模板。
- 面板外部修改同步及未保存编辑冲突，复用并扩展现有页面 / 浏览器测试。
- Skills frontmatter 和参数路由，以及 manifest / 原生入口哈希的安装包校验。
- 独立 Host / Node 进程在最终 CAS 与 rename 临界窗口的双向互斥，CLI 重新读取并重放后
  保留双方数据，以及实际 Bash 中不可被项目环境覆盖的写入协议标记。

2026-10-13 首次 4.2.0 的最终代码检查与发布 CI（历史发布证据）。Panel 合入提交为
`3f80db2c6130c69e5ade873f0f0aebb9593b1631`；Host 合入提交为
`323a997afb830a4a82d6ac1e3196965b8293cac9`，对应发布与校验见第 7 节：

| 命令 / 检查 | 结果 |
| --- | --- |
| `npm run check -- --suite job-hunt-hq` | 源码类型检查、提交构建库存检查通过；144 个测试通过，0 失败 |
| 全仓 `npm run check` | 1,999 个测试通过、4 个跳过、0 失败 |
| `node scripts/validate.mjs` | 全部应用包与既有烟测通过；Job Hunt HQ 72 个安装包文件通过 |
| `npm run typecheck` | 通过 |
| `npm run build:check -- --app job-hunt-hq` | 通过；Job Hunt HQ 沿用无需生成构建的安装包布局 |
| 新增 `headless-ops.test.mjs` / `headless-parity.test.mjs` | 15 / 15 通过，含共用文件锁回归，已纳入上述 Job Hunt HQ suite |
| `npm run test:host-storage -- /Users/admin/.codex/worktrees/job-hunt-headless-host/packages/server` | 包含最终共用锁的候选 Host v0.9.36，四个 worker 全部通过 |
| Host 组合定向测试 | 59 个测试、325 个断言通过：44 个锁测试 + 3 个 TUI 测试 + 1 个 remote 测试 + 9 个 Bash 测试 + 2 个 architecture budget 测试 |
| Host 类型检查 | 通过 |
| Host lint | 退出码 0；105 个既有 warning |
| Host package release smoke | 九个发布 tarball、47 个 typed entry 通过；退出码 0 |
| Host export contract | 4 个测试、148 个断言通过 |
| `project-runtime` Skill frontmatter / naming 校验 | 通过 |
| 与基线深比较 manifest `agent.tools` | 16 个 Tool 名称和参数 schema 完全不变 |
| 原生入口 SHA-256、安装包 preflight、`git diff --check` | 通过 |

新增测试既比较固定时间 / ID 下的纯操作结果，也在实际浏览器加载页面并调用注册的
Panel Tool，对照独立 Node CLI 的直接快照和分片快照结果；并检查干净面板自动读取与
有未保存修改时的冲突保留。使用临时项目和测试 Host workspace 适配，不接触个人数据。

候选 Host 的真实 Core / Server gate 已覆盖：4.2.0 安装 review、保留项目所选包的 Skill
路径插值、Bash 前台执行四个操作及 `init`、Server 直接 / 分片存储、Host 在 CLI 更新后
拒绝旧 revision，以及 CLI 在 Host 更新后拒绝旧 revision。新增 catalog 不覆盖旧项目
pin；损坏的新包会失败，不回退到其他版本。测试使用临时 HOME / 项目与 Node 子进程
网络隔离，没有读取凭据、调用模型或创建 Panel 实例。

最终共用锁 gate 还在 Host 的最终 CAS → rename 之间暂停：独立 Node writer 实际遇到
锁 `EEXIST` 并等待，Host 放行后成功提交，Node 在锁内重新检查并返回
`REVISION_CONFLICT`。反向场景只允许 Node 成功，Host 拒绝旧 revision。
安装包 CLI 先读取旧主文件再等待 Host 锁时，会在冲突后重新读取并重跑操作；最终
Host summary、CLI `qa-scope` 和已有 `qa-decision` 全部保留。真实 BashTool 即便收到
`ctx.shellEnv` 试图设置协议标记为 `0`，子进程仍得到 Host 注入的 `1`。
锁释放同时失败时保留原操作错误与释放错误；测试还实际终止持锁子进程，确认它没有
提交主文件，且先等进程关闭再清理测试项目，避免把未完成 writer 当成已安全停止。

这组历史 gate 使用已发布 v0.9.36 的 Host 实现；隔离环境的原始结论与限制仍按下文保留。
后续已在正式 Desktop 0.9.37 安装生产 Panel 4.2.1，并核对当前个人项目所选 Skill / CLI；
自然 Chat 的 ToolSearch → Skill → Bash `ops`，以及同一 Chat 的合成项目初始化、
三写一读均已通过，面板开关前 / 中 / 后均为 `0`。验收期间本机随后更新为 0.9.40，
最终回执记录该当前版本，不把所有自然写入都固定归为 0.9.37；详见第 7.6 节。
真实全局 TUI 的隔离脚本化对话与 Desktop 隔离存储链路已通过，见第 7.4 / 7.5 节；
这些证据确认执行链路，不评估真实 provider 的回答质量。
招聘网站认证及其余 12 个 Tool 的迁移不属于本期四个简历操作的验收范围，留在 P3。

## 5. 分期

| 期 | 范围 | 本次状态 |
| --- | --- | --- |
| P1 | codec、四个 op、Node workspace 适配、CLI、四个 handler、操作和存储一致性测试 | 4.2.0 与 4.2.1 入口补丁均已发布；4.2.1 的 146 个应用测试、真实 Host 共用锁 gate 通过 |
| P2 | project-runtime、workflow 路由、manifest 4.2.0 → 4.2.1、外部修改场景检查 | 已发布并完成生产安装、实际所选 Skill / CLI、隔离 TUI / Desktop 与正式 Desktop 自然 Chat 四操作验收；版本与历史边界见第 7 节 |
| P3 | 其余 12 个 Tool 迁移；discovery 收据改为直接 CLI 写入 | 后续，不属于本版 |
| P4（可选） | 若需要结构化 Tool 无页面执行，向 Host 提 nativeEntry 通用能力 | 未启动；另起 Host 分支 |

## 6. 风险与限制

- **Host 兼容边界：** 只有遵守共用文件锁的 Host 0.9.36 及以上才支持并发无界面写入。
  旧 Host 不受该锁保护；Skill 缺少实际 Bash 协议标记时停止写入，安装器当前不会强制
  这个要求。独立终端使用者仍需确保没有不兼容 Host 同时写同一项目。
  任意直接改文件、绕开 Host / CLI 协议的第三方 writer 仍不参与互斥。
- **崩溃锁：** writer 意外退出后可能保留项目 CLI 锁或共用文件锁，后续写入会在五秒后
  报冲突。须确认原 writer 已停止再手动移除；本版不自动抢占或过期清理。
- **来源差异：** Tool 与 CLI 的来源字段本来就不同。一致性测试固定上下文比较业务行为，
  另行检查 CLI 的 `source` / Session 记录，不承诺不同运行时的原始 JSON 字节相同。
- **候选人来源记录：** 简历和匹配 Trace 保留执行来源；无已有简历且无 Trace 的独立
  候选人保存只更新候选人数据，不产生额外审计记录。
- **未迁移操作：** discovery、JD intake、面试和跟进等 12 个 Tool 仍依赖面板。技能必须
  明确路由，不能生成不存在的 CLI 子命令。
- **原生入口哈希：** Job Hunt HQ 无 `panel.build.json`，手工更新入口后必须同步 manifest hash；
  依赖模块和包整体仍通过既有安装包库存 / preflight 检查。

## 7. 正式发布与本机安装状态

### 7.1 首次 4.2.0 与 Host 0.9.36 发布（历史记录）

Panel [PR #77](https://github.com/cjhyy/codeshell-panel-apps/pull/77) 已合入 `main`，
merge commit 为 `3f80db2c6130c69e5ade873f0f0aebb9593b1631`。
[最终 CI 38282894843](https://github.com/cjhyy/codeshell-panel-apps/actions/runs/38282894843)
的 7 个 job 全部成功；检查 head `d4116ee` 与 merge commit 的 tree 一致。
[Job Hunt HQ v4.2.0 Release](https://github.com/cjhyy/codeshell-panel-apps/releases/tag/job-hunt-hq-v4.2.0)
及 tag `job-hunt-hq-v4.2.0` 已公开。

正式 [job-hunt-hq-4.2.0.zip](https://github.com/cjhyy/codeshell-panel-apps/releases/download/job-hunt-hq-v4.2.0/job-hunt-hq-4.2.0.zip)
从干净合入提交的 `apps/job-hunt-hq/` 子树生成，ZIP 根目录直接包含 `.codeshell-panel/`、
`app/`、`agent/` 等包文件。已重新下载发布副本，确认以下校验值，目录与归档的
`reviewToken` 一致；多 Panel 仓库的全局 Latest 仍为 `quant-lab-v0.45.2`：

```text
release ZIP SHA-256: bbb92846077879bff258e4b4527754ad575932f3e57f17611ad761af66752a98
reviewToken: bb7b49ad27e9f861735592f35c7816f8af631e7247e10c4134adc94fa22eb1b1
packageDigest: 3575117cc3b4283d18ba8969e5ff81603beeb947f9ad205c177faa37dfe3a189
job-hunt CLI SHA-256: 41148353564d6921ac46fff7a677d4a9098cce128a05170a0db24c1961279b34
```

旧预检曾将 `reviewToken` 误标为 `packageDigest`，历史回执保留。正式 Core 0.9.36
现已在临时 HOME 对旧正式 ZIP 独立执行 preview → reviewed install →
`resolvePanelAppPackage`，确认上述两个独立标识、CLI 哈希及 16 个 Tool / 6 个 Skill。
该过程禁用全部网络，owned worker 关闭后才清理临时目录，未改变生产安装、项目绑定、
Tag 或 ZIP；create-only 回执为
`/Users/admin/Downloads/codeshell-0.9.36-job-hunt-4.2.1/historical-4.2.0-package-identity.json`。
4.2.0 Release 说明本来没有这些哈希字段，无需修改。

配套 Host [PR #150](https://github.com/cjhyy/codeshell/pull/150) 已合入，merge commit 为
`323a997afb830a4a82d6ac1e3196965b8293cac9`。
[Host CI 38283365059](https://github.com/cjhyy/codeshell/actions/runs/38283365059) 的
12 个 job 全部成功；[v0.9.36 发布 CI 38284400031](https://github.com/cjhyy/codeshell/actions/runs/38284400031)
的 7 个 job 全部成功，覆盖三个操作系统的原生安装包、九个 tarball 烟测及九个 npm 包发布。
[CodeShell v0.9.36 Release](https://github.com/cjhyy/codeshell/releases/tag/v0.9.36) 已公开，
九个 npm 包的公共 exact-version 与 `latest` 均已确认是 `0.9.36`。

历史上 `a05c9ff` 曾通过 Core 0.9.11 的临时包预检；其后 Skill 与共用文件锁均有补强。
该历史预检不代表正式包；首次 4.2.0 发布身份以上述 merge commit 和校验值为准。
这些 4.2.0 校验值不用于标识当前 4.2.1 发布包。

### 7.2 本机当前状态（生产安装已完成）

| 项目 | 已核实状态 |
| --- | --- |
| 全局 TUI | 已升级到 `0.9.36`，`--version` 已验证；真实 PTY / Ink 的隔离脚本化对话验收通过，见第 7.4 节 |
| Desktop | `0.9.37` 完成生产安装与能力可见性验收；本机随后更新为 `0.9.40`，正式客户端自然 Chat 的初始化与四操作验收通过，面板未自动打开 |
| 本机 Job Hunt HQ | 已在真实 `codeshell` 项目完成 `4.1.1` → `4.2.1` 安装，16 个 Tool、6 个 Skill；项目 pin 为第 7.3 节的 `packageDigest: 789642…` |

已安装的 4.2.1 继承 4.2.0 的 16 个 Tool、6 个 Skill，相对 4.1.2 开发基线
未增加 Host 权限；4.2.1 补丁也没有新增权限。
用户已明确确认本机旧 4.1.1 升级新增的 `process`、`resources`、
`credentials.connections` 三项权限；这些来自已合入的 4.1.2 基线。
随后通过正式 Desktop 0.9.37 的生产安装审阅完成更新：过期 preview 先被拒绝，重新
审阅后安装成功，版本与项目 pin 已核对。没有复制 registry 或手工改写 pin。
`production-install-review-staged.json` 保留此前未点击最终按钮的历史阶段，当前完成
回执为 `production-installation-acceptance.json`，实际所选 Skill / CLI 的证据见第 7.6 节。

此前 Desktop 0.9.36 安装时已通过 `codesign --verify --deep --strict`，内置 Node `24.21.0` 的
空 PATH 执行通过；`app.asar`、主可执行文件和 managed Node 的哈希与官方 ZIP 一致。
完整目录比对的 729 个文件、14 个符号链接一致，仅 node-pty 辅助 Python 文件的权限
由 `0775` 收紧为 `0755`。

启动阶段曾采样到主线程同步等待 `SecKeychainFindGenericPassword`，并观察到
SecurityAgent 进程；采样不能证明当时系统提示可见。CUA 明确禁止控制 SecurityAgent，
当时已请用户检查系统提示，没有修改钥匙串或凭据。当前 Desktop 已可交互启动，
此前阻塞已解除。这些是 0.9.36 安装阶段的历史记录，不能代替后续正式客户端的实际运行
验收；本轮所选安装包和真实 Chat 证据见第 7.6 节。

首次发布后，正式 public Core `0.9.36` 与下载的正式 Panel ZIP `4.2.0` 的隔离合成
数据验收已通过（历史 4.2.0 证据）：
真实 Core Bash 依次完成 `ops`、`init` 和四个操作，实际协议标记 `1` 覆盖输入的 `0`，
候选人、简历、私有决策问答、source / session 均正确；回答问答未改变公开简历，
有界读取未改写快照。8 次禁网预加载均使用临时 HOME，没有网络调用；所有 owned worker
关闭后才清理成功现场。回执为本机发布证据目录中的 `published-runtime-acceptance.json`。

该验收使用物理路径启动 CLI，与 Skill 解析出的真实安装路径一致；首次临时 runner
使用 macOS `/tmp` 符号链接别名时，CLI 入口检查未命中，未执行操作。改为 `realpath`
后，包代码和严格断言均未改变即通过。该次发现的别名入口静默退出问题已在 4.2.1
发布版修复，增量回归见第 7.3 节；历史 4.2.0 包仍有此问题。
本次生产安装前另存当前基线 `before-install-current.json`：当时 Job Hunt HQ 为 4.1.1，
求职快照 SHA-256 与原始基线一致，
项目 bindings 一致；用户或其他任务已将 Video Studio pin 从 0.7.2 更新为 0.7.3。
安装前的 `local-state-current.json` 也确认了该基线。生产安装后的快照 SHA-256 仍为
`406cf05b30ff077ae8e2a573d59385c53a6fb6e70bb2ca22b3df13bcab82abc9`，bindings 与
其余三个 Panel pin 均未改变；不能把既有 Video Studio 外部变化归因于本次升级。

### 7.3 4.2.1 CLI 入口补丁（已发布）

本补丁将 CLI 主入口判定改为比较 `process.argv[1]` 与当前模块的物理路径，修复
macOS `/tmp` → `/private/tmp` 等符号链接别名导致脚本静默退出、没有执行命令的问题。
默认 Node 启动和 `--preserve-symlinks-main` 均可通过目录别名运行；作为模块异步导入时，
调用方 argv 为正常其他入口、缺失、不存在路径或含 NUL 的非法路径，均不得执行 CLI main。

4.2.1 继承首次版本的四个无面板操作、数据格式、共用写入锁和 Skill 路由；其余 12 个
操作继续依赖 Panel。16 个 Tool 的名称与参数、6 个 Skill、Host 权限均不变，Host 前置
仍为 CodeShell ≥0.9.36，Node 前置仍为 ≥20.10。

代码提交 `754315421cd4169dc67443c467026af728493687` 已通过干净 primary checkout
快进合入 `main` 并推送；annotated tag `job-hunt-hq-v4.2.1` 解析到同一提交。
[Job Hunt HQ v4.2.1 Release](https://github.com/cjhyy/codeshell-panel-apps/releases/tag/job-hunt-hq-v4.2.1)
与正式 [job-hunt-hq-4.2.1.zip](https://github.com/cjhyy/codeshell-panel-apps/releases/download/job-hunt-hq-v4.2.1/job-hunt-hq-4.2.1.zip)
已公开。正式 Core 0.9.36 只读 preflight 确认目录与 ZIP 的审阅标识 `reviewToken` 一致；
重新下载的 asset SHA-256、GitHub digest 和 size 均一致。全局 Latest 继续保留
`quant-lab-v0.45.2`。发布校验值如下，CLI 哈希已同步到 manifest：

```text
release ZIP SHA-256: 6029f005ea4ff9194879e81549e590cf3344c51ef218ff4bd9c4ff1f0179af1e
reviewToken: f2e610ff4f91dae46d124384363fa99060d0d6e685371a08a018fb652815c69e
packageDigest: 78964236094b7cfb36e4c2f9e96411daa0aca812b57bb9d3cab0352d6407080b
job-hunt CLI SHA-256: 0e85a9a18dc93e966ffae05d0f69da499a8358a31c023664442454cb5c35cf4e
```

`reviewToken` 保留上述 preflight 的源内容审阅身份；项目版本绑定使用 `packageDigest`。
后者按正式 ZIP 与固定 `75431542` 的相同文件内容独立重算，包含 Core 的
`codeshell-panel-package-v1\0` 域、排序后的文件路径、字节长度和原文，不能用
`reviewToken` 替代。

另已用正式 Core 0.9.36 在临时 HOME 对正式 ZIP 运行 preview →
`installReviewedLocalPanelApp` → `resolvePanelAppPackage`，严格确认上述 `reviewToken`
与 `packageDigest` 独立，实际保留包的 CLI 哈希、16 个 Tool、6 个 Skill 均一致。
该补充安装验收的 create-only 回执为发布证据目录中的
`corrective-published-package-identity.json`，不代表生产 Panel 已升级。

GitHub Release 说明中原先误把审阅标识标成 package digest，现已分别列出并更正。
更正后通过 `gh` 重新读取正文，与本地 `release-notes-corrected.md` 完全一致，回执为
`release-notes-correction.json`；Tag 与 ZIP 均未改变。原错标历史回执保留，预检脚本
`release-preflight.mjs` 已改为输出 `reviewToken` 字段，原脚本保存在 `.original` 副本中。

| 4.2.1 检查 / 发布证据 | 当前结果 |
| --- | --- |
| `node --test tests/apps/job-hunt-hq/headless-ops.test.mjs` | 14 个测试通过，含别名入口与异步导入回归 |
| 正式 npm Host `0.9.36` 的四 worker 存储 / runtime gate | 全部通过；Server / Core / Web / Link / Coding 五包均核实为正式 `0.9.36`，临时 npm HOME、禁用 install scripts、独立依赖布局；日志 `/tmp/job-hunt-4.2.1-host-storage.log` |
| 完整 `npm run check` | 共 2,005 个测试：2,001 通过、4 跳过、0 失败 |
| Job Hunt HQ suite | 146 / 146 通过 |
| [main CI 38289290440](https://github.com/cjhyy/codeshell-panel-apps/actions/runs/38289290440) | 检查的代码 SHA 与正式提交一致，最终 7 / 7 job 全部成功，含 Package Offline、PDF 与 Video UI；最终快照回执 `panel-ci-final.json` |
| 正式新 ZIP + 全局已安装 Core 0.9.36 组合及别名入口验收 | 通过；正式 ZIP SHA-256、审阅标识 `reviewToken` 和 CLI 哈希与上列发布值一致，物理路径与符号链接目录别名的 `ops` 都返回严格单行 JSON，`ok` 为真且四操作列表深比较一致，`symlinkCLIEntryVerified: true` |
| 正式 Core 临时 HOME 的独立 reviewed 安装与保留包解析 | 通过；`reviewToken`、`packageDigest` 与上列值分别一致，CLI 哈希及 16 个 Tool / 6 个 Skill 一致 |

正式组合验收通过真实 Core Bash 完成 `ops`、`init` 和四个操作，协议标记从输入 `0`
变为 Host 注入的 `1`；候选人、简历、私有决策问答与 source / session 正确落盘，
QA 不改公开简历，只读操作不写快照。10 次禁网预加载均使用临时 HOME，网络调用为 0；
owned child 全部关闭后清理临时现场。create-only 回执为
`/Users/admin/Downloads/codeshell-0.9.36-job-hunt-4.2.1/published-runtime-acceptance.json`。

上述为 4.2.1 正式发布、隔离合成数据组合验收与临时 HOME 的独立 Core 安装验收。
原 runtime 组合验收未读取真实个人项目、settings 或 credentials，未执行安装或修改
binding；补充 Core 安装只发生于临时 HOME。后续生产安装和实际所选 Skill / CLI 已另行
通过，见第 7.6 节；不扩大这些历史隔离验收本身的范围。

### 7.4 真实 TUI 的隔离脚本化对话验收（已通过）

使用真实全局 meta / Core / TUI 0.9.36 与官方 ZIP 4.2.1，在私有 HOME 中完成 reviewed
安装并绑定 `packageDigest: 78964236094b7cfb36e4c2f9e96411daa0aca812b57bb9d3cab0352d6407080b`。
真实 PTY / Ink 的 `/skills` 显示 Panel App 的 `project-runtime`，该步骤没有模型请求。
随后全部 24 个请求都由精确 loopback 地址上的脚本化 fixture 响应，包含 11 个主步骤
请求和 13 个辅助请求，没有使用真实外部 provider。

实际执行链 ToolSearch → Skill 选定安装包路径 → Bash 已通过；Host 注入的协议值 `1`
覆盖项目尝试设置的 `0`，`ops`、`init` 与四个操作均成功。候选人、简历和 source /
session 正确持久化，私有决策问答未进入公开 Markdown。TUI 正常 `/exit`，退出码为 0；
9 次 guard 预加载均在隔离环境中，全部 owned CLI 等待关闭后才删除 scratch。

稳定验收脚本与回执分别为发布证据目录中的 `isolated-tui-acceptance.mjs` 与
`isolated-tui-acceptance.json`。前两次 fixture 尝试因 PTY 发送时点和问答最少三项校验
失败，已归档到 `isolated-tui-fixture-attempts.json`，均确认 owned process 关闭后清理。

该验收覆盖真实 TUI 和 Core 的安装包选择、Skill 展开与 Bash 工具路由，使用合成项目
及脚本化响应；不证明真实个人项目的包选择、真实 provider 的回答质量或生产 Panel
升级完成。生产状态仍按第 7.2 节记录。

### 7.5 官方 Desktop 字节的隔离存储链路验收（已通过）

在临时 wrapper 容器中加载与官方安装一致的 executable / `app.asar` 原字节，在
Main 运行前设置私有 native HOME、userData 和 CodeShell 状态，预装 native / JS guard
及 mock Keychain。12 项负探通过；native allowlist 只允许指定的官方 managed Node
版本探测或带 guard 的 agent worker，其余子进程和网络尝试被拒绝并记录。该方式
使用官方二进制字节，但不等于正式签名容器直接启动、真实个人项目或真实 Keychain 验收。
本轮 `mainNativeSpawns: []`，worker / cork / permit 仅预装机制，并未实际执行；
不据此宣称 Desktop Bash 或 agent worker 的执行已通过验收。

真实 Main IPC 对正式 ZIP 完成审阅、安装和项目绑定，所选包为 4.2.1，
`packageDigest` 为 `78964236094b7cfb36e4c2f9e96411daa0aca812b57bb9d3cab0352d6407080b`。
四项检查通过：

1. 实际 sandbox guest 的 Node / `require` 不可用。
2. Main 注册的 Tool 能读写合成数据；实际 UI 创建 Trace，随后手动 dispatch 并完成。
   自然 Panel-origin prompt 提交因 synthetic session 不存在而返回 `ENOENT`，因此
   `panelOriginPromptSubmissionAccepted: false`、`naturalModelRouteVerified: false`；
   本项不证明模型自然路由。
3. 外部 CLI 更新后，干净面板通过实际 focus 事件触发 Host `workspace.readText` 并重新读取。
4. 将自有合成项目目录临时设为 `0500`，真实 UI 输入触发 autosave `EACCES`，本地草稿
   保留；恢复 `0700` 后外部 CLI 提交获胜，focus 检查提示冲突并拒绝覆盖外部内容。
   这是实际 I/O 故障下的 dirty draft 场景，未证明普通手动未保存 idle 状态。

最终回执为
`/Users/admin/Downloads/codeshell-0.9.36-job-hunt-4.2.1/isolated-desktop-storage-acceptance.json`。
Electron 退出码为 0，owned CLI 与 Main 子进程均已关闭。独立复核后将 46 份精简证据
保存在 `isolated-desktop-preserved-evidence/`，再清理九个自有临时目录；前后进程检查
均无匹配。复核与清理回执分别为 `isolated-desktop-final-independent-audit.json` 和
`isolated-desktop-cleanup-receipt.json`，未改动生产安装、绑定、个人数据或其他会话。

早期探测的边界另由 `isolated-desktop-first-probe-correction.json` 和
`isolated-desktop-historical-probes-correction.json` 更正，原回执及精简现场证据保留。
首探缺少 Main 前 guard 回执，实际 native HOME 仍为真实 HOME，在安装前的隔离断言
失败后停止；后续早期探测的 native subprocess 约束也不完整，曾观察到登录 shell、
远程 git 和 Codex app-server 子进程。早期是否读取真实凭据、个人数据或 shell 配置，
以及是否发生网络访问，均不能确证为零；最终通过不能消除这些历史未知状态，也不能
把早期曾标为成功的回执视为完整隔离通过。

本节进行时生产 Panel 仍为 4.1.1；后续生产升级、所选 Skill / CLI 及真实直接 Chat 证据
见第 7.6 节。本节隔离安装与手动 Tool / Trace 检查的历史限制仍保留，不据后续直接
Chat 证据宣称这里失败的 Panel-origin 自然路由已被验证。

### 7.6 生产安装、实际所选 Skill / CLI 与正式 Desktop 自然 Chat（已通过）

用户明确确认新增权限后，通过正式 Desktop 0.9.37 的安装 UI，将真实 `codeshell`
项目 Job Hunt HQ 从 4.1.1 更新到 4.2.1，项目 pin 为
`78964236094b7cfb36e4c2f9e96411daa0aca812b57bb9d3cab0352d6407080b`。
求职快照、其余 Panel pin 和 bindings 未改变，生产安装回执为
`/Users/admin/Downloads/codeshell-0.9.36-job-hunt-4.2.1/production-installation-acceptance.json`。

随后用真实 HOME 对实际 `codeshell` 项目执行只读 `scanSkills` 和 Skill 展开，确认
`job-hunt-hq:project-runtime` 来自项目所选的保留包，包版本为 4.2.1、digest 与上述 pin
一致，CLI 哈希为 `0e85a9a18dc93e966ffae05d0f69da499a8358a31c023664442454cb5c35cf4e`，
仍为 16 个 Tool、6 个 Skill，保留包 payload 由 Core 验证。
真实全局 Core 0.9.36 的 Bash 在临时合成项目完成 `init` 与四个操作，协议标记为 `1`，
覆盖输入的 `0`；候选人、简历、私有决策问答及 source / session 正确，QA 保留公开
简历，只读操作不写快照。回执为
`/Users/admin/Downloads/codeshell-0.9.37-panel-capabilities/installed-job-hunt-4.2.1-acceptance.json`。

此 scan 确实读取真实用户与项目设置，不能宣称零敏感配置读取；只读约束针对实际项目，
写入发生在临时合成项目。worker 环境经清理并使用 Node API 网络 guard，该 guard
不是操作系统隔离。此项没有调用模型或 Panel API，也没有再次安装或修改绑定。

最初在正式 Desktop 0.9.37 的新 Chat 中，自然执行 ToolSearch `select:Skill,Bash` →
Skill `job-hunt-hq:project-runtime` → Bash 调用上述已安装 CLI 的 `ops`，模型显示四个
支持操作。同一 Chat 的后续请求继续使用真实 Bash，观察到协议标记 `1`，依次完成
`init`、`save_candidate_context`、`save_resume_draft`、`save_resume_qa_answer` 和
`get_job_search_context`，全部业务写入针对合成验收项目，现场作为证据保留。

独立检查合成快照确认候选人、简历和私有决策答案正确，简历 `source: "cli"`、
`sessionId: "desktop-installed-acceptance"` 持久化，共三项 QA；回答后公开 Markdown
与回答前完全一致。真实求职快照仍为第 7.2 节的 SHA-256。UI 最终为 idle，面板开关
before / during / after 均为 `0`，未观察到自动打开面板。

初次 `init` 多传 `--session` 被 CLI 拒绝，模型按命令契约去掉后成功；提取简历 ID 时
误猜字段，随后在合成快照中改用 `resume.versionId` 并继续成功。这两次恢复未修改 CLI
或业务代码。

验收期间其他操作将本机正式 Desktop 从 0.9.37 更新为 0.9.40；最终回执记录
`currentInstalledDesktopVersion: "0.9.40"`。0.9.37 是最初安装和能力可见性现场的版本，
不能把所有后续自然写入都固定归为 0.9.37。最终回执为
`/Users/admin/Downloads/codeshell-0.9.37-panel-capabilities/actual-desktop-chat-acceptance.json`。

同一真实 Chat 的 transcript 元数据另存于 `actual-desktop-chat-transcript-receipt.json`：
共 127 个事件、19 次 Tool 调用和 19 条 Tool 结果，两次 `run_result` 的 reason 均为
`completed`。回执确认自然调用且没有手动 Tool 分派；原 transcript 未复制到仓库，
本文不公开真实 session ID 或私有会话路径。

本次真实模型使用既有生产配置、正常上下文和 provider，实际 Bash 标记为未隔离；
不宣称 OS 沙箱、零网络或零敏感配置读取。写入范围由精确 CLI 目标和独立快照检查
确认，验收未使用真实个人求职数据作为合成业务输入。该自然直接 Chat 验收补充了
真实使用证据，不删除第 7.5 节历史隔离探测及 Panel-origin 路由未验证的限制。
