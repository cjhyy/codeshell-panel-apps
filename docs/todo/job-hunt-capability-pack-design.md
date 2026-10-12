# Job Hunt HQ 能力包：脱离面板运行（简历样板）

> 状态：Job Hunt HQ v4.2.1 已正式发布，修复 CLI 别名入口；首次版本 v4.2.0 与 CodeShell v0.9.36 的发布记录保留在下文，P1 / P2 与共用写入锁验收完成。Desktop 已安装 0.9.36，启动等待系统钥匙串授权；实际 Desktop Bash / 模型对话及本机 Panel 升级尚未验收。日期：2026-10-13。<br>
> 首次 Panel 实现已通过 PR #77 合入 `main`；本次补丁与发布证据维护分支为 `codex/job-hunt-hq/headless-release-evidence`。配套 CodeShell Host 0.9.36 提供共用文件写入锁。<br>
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

这组 gate 使用本次已发布 v0.9.36 的 Host 实现。Desktop 已经官方 updater 安装为
0.9.36，但新进程启动等待系统钥匙串授权，实际 Desktop Bash / 模型对话尚未验收。
尚未完成真实已安装 Desktop 的升级后端到端场景、TUI 模型对话及招聘网站认证；
全局 TUI 已升级并验证版本，但这些安装和模型路由集成检查不能由版本输出或存储 gate 替代。

## 5. 分期

| 期 | 范围 | 本次状态 |
| --- | --- | --- |
| P1 | codec、四个 op、Node workspace 适配、CLI、四个 handler、操作和存储一致性测试 | 4.2.0 与 4.2.1 入口补丁均已发布；4.2.1 的 146 个应用测试、真实 Host 共用锁 gate 通过 |
| P2 | project-runtime、workflow 路由、manifest 4.2.0 → 4.2.1、外部修改场景检查 | 首次 4.2.0 已发布，4.2.1 继承原功能；真实 Bash 能力标记与四 worker gate 通过，Desktop 0.9.36 启动等待系统钥匙串授权，本机 Panel 升级与实际对话验收未完成 |
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
`app/`、`agent/` 等包文件。已重新下载发布副本，确认以下校验值，目录与归档的 payload
digest 一致；多 Panel 仓库的全局 Latest 仍为 `quant-lab-v0.45.2`：

```text
release ZIP SHA-256: bbb92846077879bff258e4b4527754ad575932f3e57f17611ad761af66752a98
packageDigest: bb7b49ad27e9f861735592f35c7816f8af631e7247e10c4134adc94fa22eb1b1
job-hunt CLI SHA-256: 41148353564d6921ac46fff7a677d4a9098cce128a05170a0db24c1961279b34
```

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

### 7.2 本机安装与当前阻塞

| 项目 | 已核实状态 |
| --- | --- |
| 全局 TUI | 已升级到 `0.9.36`，`--version` 已验证 |
| Desktop | 官方 updater 已安装 `0.9.36`，plist 已确认；新进程启动等待系统钥匙串授权，实际 Desktop Bash / 模型对话尚未验收 |
| 本机 Job Hunt HQ | 仍为 `4.1.1`、5 个 Skill；升级目标为已发布的 `4.2.1`，尚未安装 |

升级目标 4.2.1 继承 4.2.0 的 16 个 Tool、6 个 Skill，相对 4.1.2 开发基线
未增加 Host 权限；4.2.1 补丁也没有新增权限。
本机 4.1.1 升级需在生产安装器中最终确认 `process`、`resources`、
`credentials.connections` 三项新增权限，这些来自已合入的 4.1.2 基线。
确认与安装尚未完成，安装后还需核对所选包版本、digest 和项目绑定回执；不能通过
复制文件或修改 `installed.json` 代替安装流程。

Desktop 安装后已通过 `codesign --verify --deep --strict`，内置 Node `24.21.0` 的
空 PATH 执行通过；`app.asar`、主可执行文件和 managed Node 的哈希与官方 ZIP 一致。
完整目录比对的 729 个文件、14 个符号链接一致，仅 node-pty 辅助 Python 文件的权限
由 `0775` 收紧为 `0755`。

新进程采样确认主线程同步等待 `SecKeychainFindGenericPassword`，SecurityAgent 进程已出现；
采样不能证明系统提示当前可见，仍需用户检查并完成钥匙串授权。CUA 明确禁止控制
SecurityAgent，已请用户接手系统提示，目前尚未收到回复；没有修改钥匙串或凭据。
完成系统授权后，仍需在实际 Desktop
Bash 中验证协议标记为 `1` 并完成运行验收；安装完整性通过不能替代这些检查。

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
真实 Desktop / TUI 模型对话、实际所选 Panel 的安装和 Skill 路由仍待验收，不据公开发布
或隔离合成检查宣称本机端到端使用已经完成。本机求职快照、项目绑定及包 pin 已核对
与升级前一致。

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
`reviewToken` 替代。这项纯内容核验不增加下述组合验收或本机使用验收的范围。

| 4.2.1 检查 / 发布证据 | 当前结果 |
| --- | --- |
| `node --test tests/apps/job-hunt-hq/headless-ops.test.mjs` | 14 个测试通过，含别名入口与异步导入回归 |
| 正式 npm Host `0.9.36` 的四 worker 存储 / runtime gate | 全部通过；Server / Core / Web / Link / Coding 五包均核实为正式 `0.9.36`，临时 npm HOME、禁用 install scripts、独立依赖布局；日志 `/tmp/job-hunt-4.2.1-host-storage.log` |
| 完整 `npm run check` | 共 2,005 个测试：2,001 通过、4 跳过、0 失败 |
| Job Hunt HQ suite | 146 / 146 通过 |
| [main CI 38289290440](https://github.com/cjhyy/codeshell-panel-apps/actions/runs/38289290440) | 检查的代码 SHA 与正式提交一致；适用的 Package Offline 与 PDF 检查已成功，发布时快照为 6 / 7 job 成功，仅无关 Video UI 仍在运行，不记为全量 CI 完成 |
| 正式新 ZIP + 全局已安装 Core 0.9.36 组合及别名入口验收 | 通过；正式 ZIP SHA-256、审阅标识 `reviewToken` 和 CLI 哈希与上列发布值一致，物理路径与符号链接目录别名的 `ops` 都返回严格单行 JSON，`ok` 为真且四操作列表深比较一致，`symlinkCLIEntryVerified: true` |

正式组合验收通过真实 Core Bash 完成 `ops`、`init` 和四个操作，协议标记从输入 `0`
变为 Host 注入的 `1`；候选人、简历、私有决策问答与 source / session 正确落盘，
QA 不改公开简历，只读操作不写快照。10 次禁网预加载均使用临时 HOME，网络调用为 0；
owned child 全部关闭后清理临时现场。create-only 回执为
`/Users/admin/Downloads/codeshell-0.9.36-job-hunt-4.2.1/published-runtime-acceptance.json`。

4.2.1 已完成正式发布与隔离合成数据组合验收，本机 Panel 尚未安装。组合验收未读取
真实个人项目、settings 或 credentials，未执行安装或修改 binding；实际个人项目的
Skill 路由、Panel 安装及 Desktop / TUI 模型对话仍未验收，边界按第 7.2 节记录。
