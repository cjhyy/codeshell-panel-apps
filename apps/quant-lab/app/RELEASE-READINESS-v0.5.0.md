# 投资工作台 v0.5.0 上线准备

日期：2026-08-26
结论：**代码与隔离安装验收通过；真实 CodeShell Desktop 安装/升级仍须用户在 UI 中确认。**

## 1. 发布身份与权限

- manifest：`schemaVersion: 1`、`id: "quant-lab"`、`version: "0.5.0"`。
- 显示名：`title.default` / `title.zh-CN` 均为「投资工作台」，英文为 `Investment Desk`。
- 10 项 Host 权限：`context.session`、`context.workspace`、`workspace.info`、
  `workspace.read`、`workspace.write`、`external.open`、`storage`、
  `agent.submitPrompt`、`automations.manage`、`notifications.send`。
- `external.open` 只服务东财/SEC allowlist HTTPS 外链；App 先校验 hostname，Host 再显示确认框。
- schemaVersion 2、截图导入、Panel Agent tool 均未加入。

## 2. RED → GREEN：holdings 固定时钟

根因是 `createHoldingsController` 已支持 `now` 参数，但 `app.js` 实例化时没有传入，导致今日、
资讯和笔记使用 `window.__quantLabNow`，持仓却回退到真实 `new Date()`。

- RED：先加入真实 DOM 场景，固定 raw bar 为 `2026-08-25`，分别注入
  `2026-09-04`（age 10）与 `2026-09-05`（age 11）。旧实现于 age 11 实际返回
  `positive`，期望 `warning`，`npm run test:ui:quant-lab` exit 1。
- 最小修复：`createHoldingsController({ now: currentInstant })`；生产无 override 时仍使用真实时钟。
- GREEN：age 10 规则 `positive`；age 11 `warning · price-age-exceeded`；完整 UI 套件 exit 0。
- 防连带回归：核心测试继续覆盖 FX age 10/11、`fx-age-exceeded`、provisional；Today/watch
  继续覆盖工作日 freshness、周末边界、stale sidecar 与错误结果不得冒充新鲜触发。
- 提交后门禁还暴露了测试 fixture 自身的时钟错位：套件统一到 `2026-08-26` 后，资讯仍固定
  `2026-08-24`，真实 12 小时 notification freshness 令候选为 0，UI 在等待 2 次通知时 RED 超时。
  只把资讯 fixture 对齐同一固定测试时钟；未修改生产 freshness、通知选择或 stale 阈值。复跑 UI GREEN。

## 3. 安装与升级事实

只读核对的真实实现位于 CodeShell 的 `packages/core/src/panel-apps/installer.ts`、
`registry.ts`、`paths.ts` 与 Desktop `panel-app-install-service.ts` / `panel-app-bridge.ts`。

- From-folder 与 Update-from-source 没有 manifest 文件白名单：installer 对整个 app source tree
  做有界递归审阅（扩展名、大小、深度、symlink、agent-plugin 内容），计算 SHA-256 review token，
  递归复制到 staging，复审复制后的 digest，再以目录 rename 原子替换并更新独立 registry。
- Update-from-source 重新打开原 source、重新展示 manifest/权限并要求新的 review token；id 变化会拒绝。
- registry 位于隔离 HOME 的 `.code-shell/panel-apps/installed.json`，目录权限实测 `0700`、文件 `0600`。
- Panel storage 不在安装目录；namespace 只由稳定 `appId + projectPath` 计算，不含 app version。
- Update 替换 app 安装快照，但保留 registry 的 `installedAt` 与 source，更新 `lastUpdated`。

隔离 HOME 实测了一个 0.4.1 fixture（稳定 id、9 项旧权限）安装，再从同一 source record 更新：

- 更新后 `id=quant-lab`、`displayName=投资工作台`、`version=0.5.0`、`schemaVersion=1`、10 权限；
- `installedAt` 保持旧值，Panel storage sentinel 字节不变；
- 最终安装树 29 个文件：28 个 source 文件 + installer 生成的 `.cs-panel-app-meta.json`；
- `app/modules/` 与 3 个 `app/tools/` 全部存在；
- 6 个纯测试 fixture 已移到仓库级 `test-fixtures/quant-lab/`，不进入安装树；
- `.loop/` 不在 app source root，也未进入安装树。

现有 0.4.1 二进制从未形成可还原的 Git commit，因此上述安装快照不是历史二进制逐字节复刻。
迁移数据契约另由真实 DOM 旧 storage fixture 验证：旧 watchlist canonicalization 保留第一 id、
不同 rule、冲突条目与未知字段；研究 config 未知字段、未知 future key、active tab 均按 workspace 保留，
reload 后不重复改写。

## 4. 上线验收矩阵

| 区域 | 验收场景与证据 | 状态 |
| --- | --- | --- |
| 外壳 | 默认今日；今日/持仓/关注/研究/资讯/笔记顺序、单一 h1、tab roving focus、CTA focus | 自动通过 |
| 持仓账本 | create-only 建账；双击防重；手工录入 A 股/美股；条件写与 holdings cache 核对 | 自动通过 |
| raw / FX | stub 同步器与 raw contract；本币数量/成本/现价/盈亏；缺 FX 时 base unavailable；补入合法 USDCNY 后 refresh 恢复 base | 自动通过 |
| 时点 | price age 10 可用、11 阻断；FX age；provisional；纽约 availableAt 与北京时间展示隔离 | 自动通过 |
| P0–P3 | 13 条规则、冻结原因优先级、HHI 说明、盈利/亏损同构、P0 与其他静态项并存 | 自动通过 |
| Agent 证据 | 去账户 id 的结构化 evidence；JSON 标为数据；禁止重算、买卖、加减仓建议；busy 可恢复 | 自动通过 |
| 关注 | v0.4.1 storage 无损迁移、冲突保留、立即检查、排序、A/美独立提醒、drift/orphan/失败重试 | 自动通过 |
| 研究 | repo CSV → 原回测 → sizer/signal → walk-forward/参数扫描 → 报告/spec → Agent evidence | 自动通过 |
| 自动资讯 | 显式 opt-in；东财个股/7×24、SEC 离线 fixture；source stale/partial；M3 任务不被 M4 改写 | 自动通过 |
| 通知/外链 | notified `pending → send → sent`，写账本失败零通知；weak/stale 不通知；HTTPS allowlist 后调用 `external.open` | 自动通过 |
| 笔记 | create/update/delete；交易/资讯/规则/标的 link；orphan/changed DOM；冲突保留 draft，第二次确认保存成功 | 自动通过 |
| 项目隔离 | 真实 `context.changed`：reset 四 controller、递增 epoch、清旧 bars/watch/notes、载入第二项目 scoped config | 自动通过 |
| 响应与错误 | 320 px 无横向溢出、键盘可达、所有场景 `console.error` / `pageerror` 为空 | 自动通过 |
| Desktop 安装 | 在真实 Extensions UI 点击 From folder、审阅权限并应用到用户 registry | 需手工 |
| 真实升级 | 对用户现存 0.4.1 卡片点击 Update from source，确认 permission delta 与原 storage | 需手工 |
| OS 外链确认 | 点击一条 SEC/东财链接并在真实 Electron/系统浏览器确认框选择 Open/Cancel | 需手工 |
| 后台运行 | 在线设备等待 A/美 automation 实际触发，核对任务、feed/cache 与面板打开后的通知 | 需手工 |
| 修改真实 registry | 自动化刻意不写真实 `~/.code-shell/panel-apps` / `installed.json` | 不适用（安全禁止） |
| push/tag/release | 本轮只允许本地 commit | 不适用（范围外） |

## 5. 命令证据

| 命令 | 结果 |
| --- | --- |
| `npm run check` | 提交前、实现提交后均 exit 0；quant-lab 28 package files；engine/portfolio/rules/raw/today/news/notes 全绿 |
| `npm run test:ui:quant-lab` | 固定时钟资讯 fixture RED 后修正；明确 `quant_lab_ui_exit=0`；真实 DOM/Playwright/Host stub、320 px、console/pageerror clean |
| CodeShell installer/registry/permission tests | Bun 22 pass / 0 fail |
| 隔离 HOME 0.4.1 → 0.5.0 | exit 0；source/storage/installedAt 保留；29 installed files；fixtures/.loop 排除 |
| `git diff --check` / staged check | exit 0；另移除两处文档行尾空白后才允许提交 |
| 敏感/临时文件审计 | 无业务 data、凭证、绝对本机路径、临时/锁文件；邮箱仅 `contact@example.com` 占位 |

readiness 文档提交后再次运行 `npm run check`、`npm run test:ui:quant-lab` 与 `git diff --check`；
最终结果与 docs commit hash 见交付回报。

## 6. 已知限制（不阻断 v0.5.0）

- F5 position-in/out 归因仍待产品裁定。
- M5 不含完整 outcome / `reviewAt` schema；对应 P3 保持诚实 unavailable。
- 后台资讯任务只更新 feed/cache；Panel 打开时才执行持久账本通知协议。
- 截图导入与 schemaVersion 2 未实现。
- 市场状态条是固定常规窗口，不校验交易所节假日；intraday quote/ECB divergence 尚未接入。
- 东财是未文档化二级源、无 SLA；SEC 这里只表示官方申报元数据，不是一般新闻。

## 7. 手工验收步骤

1. 在 CodeShell Desktop 的 Extensions → Panel Apps 选择 From folder，指向 `apps/quant-lab`。
2. 核对稳定 id、0.5.0、投资工作台、schemaVersion 1 与上述 10 项权限；只在用户决定后安装。
3. 对真实 0.4.1 安装选择 Update from source，确认新增权限只有 `external.open`，应用后检查研究配置、
   关注项/冲突提示、active tab 与未知字段仍在。
4. 打开六模块各一次；点击一条 SEC/东财外链，分别验证 Host Open/Cancel。
5. 在在线测试项目显式启用自动资讯与 A/美提醒；等待一次调度，检查任务实际运行、source 状态、
   `pending → sent` 与面板重开去重。SEC contact 使用用户自行确认的普通联络信息，不使用凭证。

## 8. 本地提交

- 提交前基线：`b1f9f78`（工作区此前包含未提交 v0.4.1 与 M0–M5）。
- v0.5.0 完整实现提交：`f7e8257`（历史未提交基线与 M0–M5 交织，未使用 reset/stash 强拆）。
- 固定时钟资讯 fixture 提交：`67c6b2e`。
- readiness 证据提交：本文件的本地 docs commit；其 hash 及完整列表见交付回报。
- push / merge / tag / release：否。
