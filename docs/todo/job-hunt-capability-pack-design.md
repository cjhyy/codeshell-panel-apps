# Job Hunt HQ 能力包：脱离面板运行（简历样板）

> 状态：v4.2.0 实现版；P1 / P2 已完成离线和候选 Host 存储验收。日期：2026-10-13。<br>
> 实现仓库：`codeshell-panel-apps`，分支 `codex/job-hunt-hq/headless-ops`。本方案不改 CodeShell Host。<br>
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

运行前置条件为 **PATH 中存在 Node.js 20.10 或更高版本**；使用当前项目选中的安装包，不依赖开发
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

这些约束复用既有数据协议。CLI peers 共同遵守写锁，但 Host 不参与；Host / CLI 的版本
检查和原子替换之间仍有竞争窗口，见下文风险与限制。

### 3.4 Skills 与 manifest

- 新增 `agent/skills/project-runtime/SKILL.md`。从 `${CODESHELL_SKILL_DIR}/../../..`
  定位当前项目选中的包，校验 manifest ID `job-hunt-hq`，读取并运行其中的 CLI。
  找不到所选包或脚本时返回 `bundled-job-hunt-cli-not-found`，不回退到源码目录或另一版本。
- `job-hunt-workflow` 首先分辨发起方：面板 Trace 走 Panel；直接 Chat / TUI 的四个支持
  操作走 CLI。其余操作明确提示需要打开面板，不能宣称已无界面保存。
- resume-writing 写回遵循 workflow 选定路径；初始化参考同步说明 CLI `init`。
- manifest 升为 `4.2.0`，新增第六个 Skill 和 `nativeEntries.job-hunt`，保留 16 个 Tool。
  原生入口的 SHA-256 随 CLI 最终字节同步，并由现有包校验验证。

## 4. 验证

本版已通过的检查覆盖：

- 四个纯操作的输入校验、候选人合并、简历层级与证据、归档和 QA 状态。
- Tool / CLI 共用操作的一致性：使用固定时间和 ID 的同一输入比较返回结果及写入数据。
- CLI 初始化和已有文件保留、错误码、分片读写、revision 冲突后的有限重试。
- 路径越界、隐藏路径和符号链接拒绝；项目根目录被替换时停止访问；损坏或字段类型
  错误的快照不被当作新项目覆盖；部分初始化可补齐模板。
- 面板外部修改同步及未保存编辑冲突，复用并扩展现有页面 / 浏览器测试。
- Skills frontmatter 和参数路由，以及 manifest / 原生入口哈希的安装包校验。

2026-10-13 最终检查：

| 命令 / 检查 | 结果 |
| --- | --- |
| `npm run check -- --suite job-hunt-hq` | 源码类型检查、提交构建库存检查通过；142 个测试通过，0 失败 |
| `node scripts/validate.mjs` | 全部应用包与既有烟测通过；Job Hunt HQ 72 个安装包文件通过 |
| `npm run typecheck` | 通过 |
| `npm run build:check -- --app job-hunt-hq` | 通过；Job Hunt HQ 沿用无需生成构建的安装包布局 |
| 新增 `headless-ops.test.mjs` / `headless-parity.test.mjs` | 13 / 13 通过，已纳入上述 Job Hunt HQ suite |
| `npm run test:host-storage -- /Users/admin/.codex/worktrees/job-hunt-headless-host/packages/server` | 候选 Host `139477f`（v0.9.36）四个 worker 全部通过 |
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

这组 gate 使用候选 Host `139477f`（v0.9.36），并非正在运行的 Desktop 0.9.35。
尚未运行真实已安装 Desktop 的升级后端到端场景、TUI 模型对话及招聘网站认证；
这些安装和模型路由集成检查不能由离线测试或候选 Host 存储 gate 替代。

## 5. 分期

| 期 | 范围 | 本次状态 |
| --- | --- | --- |
| P1 | codec、四个 op、Node workspace 适配、CLI、四个 handler、操作和存储一致性测试 | 已实现，离线及候选 Host 存储 gate 通过 |
| P2 | project-runtime、workflow 路由、manifest 4.2.0、外部修改场景检查 | 已实现，离线及候选 Host 存储 gate 通过；live Desktop 升级与模型对话未运行 |
| P3 | 其余 12 个 Tool 迁移；discovery 收据改为直接 CLI 写入 | 后续，不属于本版 |
| P4（可选） | 若需要结构化 Tool 无页面执行，向 Host 提 nativeEntry 通用能力 | 未启动；另起 Host 分支 |

## 6. 风险与限制

- **并发提交窗口：** revision 检查通过到 rename 之间，另一个 Host writer 仍可能写入。
  CLI peers 已用写锁串行化，不能据此保证 Host / CLI 严格串行提交；彻底消除需要共同遵循的锁或 Host 原子 CAS。
  不把“有备份”当作不会丢数据的保证。
- **崩溃锁：** CLI 意外退出后可能保留 `.job-hunt-write.lock`，后续写入会在五秒后报
  冲突。须确认原 writer 已停止再手动移除；本版不自动抢占或过期清理。
- **来源差异：** Tool 与 CLI 的来源字段本来就不同。一致性测试固定上下文比较业务行为，
  另行检查 CLI 的 `source` / Session 记录，不承诺不同运行时的原始 JSON 字节相同。
- **候选人来源记录：** 简历和匹配 Trace 保留执行来源；无已有简历且无 Trace 的独立
  候选人保存只更新候选人数据，不产生额外审计记录。
- **未迁移操作：** discovery、JD intake、面试和跟进等 12 个 Tool 仍依赖面板。技能必须
  明确路由，不能生成不存在的 CLI 子命令。
- **原生入口哈希：** Job Hunt HQ 无 `panel.build.json`，手工更新入口后必须同步 manifest hash；
  依赖模块和包整体仍通过既有安装包库存 / preflight 检查。

## 7. 发布与安装准备（尚未发布）

2026-10-13 曾对干净代码提交 `a05c9ff3691457406ee8438ff80573691739e9e7` 的
`apps/job-hunt-hq/` 子树生成 ZIP 并通过已发布 Core 0.9.11 的只读安装预检。
当时 ZIP 与应用目录的 payload digest 完全一致；以下为该历史预检的记录，后续 Skill
补充 Node 前置条件已改变包内容，正式发布必须重新预检并记录新 digest：

```text
historical packageDigest (a05c9ff): 939117f4fb8d3b95dea44aed0da8db483695c60969957513a62bd79015661c1c
job-hunt CLI sha256: 41148353564d6921ac46fff7a677d4a9098cce128a05170a0db24c1961279b34
```

预检确认包为 `job-hunt-hq` 4.2.0、16 个 Tool、6 个 Skill，且相对 4.1.2 开发基线未增加
Host 权限。本机旧安装实际为 4.1.1、5 个 Skill；与旧安装相比，升级请求的新增权限是
`process`、`resources`、`credentials.connections`，这些来自已合入的 4.1.2 基线。
正式安装须通过生产安装器预览并核对这三项权限，保留版本、digest 和项目绑定回执。
不能通过复制文件或修改 `installed.json` 代替安装流程。

仓库没有自动发布 workflow；既有 Job Hunt HQ 发布采用 `job-hunt-hq-v<version>` tag 和
`job-hunt-hq-<version>.zip` asset。ZIP 根目录直接包含 `.codeshell-panel/`、`app/` 和
`agent/` 等包文件。正式 4.2.0 应从已合入并通过检查的提交生成，使用 tag
`job-hunt-hq-v4.2.0` 与 asset `job-hunt-hq-4.2.0.zip`，保留一次生成的原件并核对发布后
下载的 SHA-256 与包 payload digest；多 Panel 仓库发布时保留现有全局 Latest 标记。
本次临时预检包不代表已经完成 tag、Release、正式 asset 或本机安装。
