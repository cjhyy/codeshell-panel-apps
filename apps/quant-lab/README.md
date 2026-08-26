# 投资工作台 Panel App

投资工作台（稳定 id：`quant-lab`）是一个独立的 CodeShell Desktop Panel App，定位为
本地优先的个人投资决策工作台。它与 Agent Plugin 系统相互独立。

当前 `0.5.0` 已有六模块外壳、无损迁移、组合账本核心与持仓基础页：顶层固定为
**今日 / 持仓 / 关注 / 研究 / 资讯 / 笔记**，默认进入今日。「持仓」可 create-only
建立账本、手动录入 A 股/美股买卖，并从未复权 raw 缓存展示数量、移动均价、
现价和本币盈亏。缺行情或 FX 时只将受影响字段标为 `unavailable`，不阻断查看账本或
录入合法交易。持仓首屏现已接入 13 条 P0–P3 纯规则：每条同时展示条件、actual、
threshold、数据时点、验证等级和缺数原因（多原因时按冻结优先级给主原因并保留全部 `reasons`）；
P0 置顶但不阻断其他静态项，盈利/亏损/持平贡献采用同一结构，归一化 HHI 连续展示、0.25/0.50
只是产品启发式描述分箱（非行业标准、不贴好坏），Agent 入口只外发去账户标识后的结构化
evidence（JSON 标记为数据、非指令），并明确禁止重算和动作建议。规则分为 6 条 `static-audit`
与 7 条 `historically-recomputable`、0 条 `backtestable`，没有把组合截面规则冒充策略回测。

今日页已完成 M3 的决策聚合：首屏只有一个实心主行动与最多三项摘要，不复制持仓表或规则清单。
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

The 研究 module reads OHLCV CSVs from the repository. Fetch them with the bundled
zero-dependency sync tool (Node 18+, no Python or pip required):

```bash
# A-shares (Tencent), front-adjusted by default
node app/tools/fetch-market-data.mjs --symbol 600519 --from 2020-01-01

# US equities (Yahoo), split/dividend-adjusted by default
node app/tools/fetch-market-data.mjs --symbol AAPL --from 2020-01-01
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
