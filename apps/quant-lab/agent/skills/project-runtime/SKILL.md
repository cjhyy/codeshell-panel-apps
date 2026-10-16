---
name: project-runtime
description: Locate and run the Investment Desk CLI and programs from the Panel package selected by the current project. Use for local CSV diagnosis, backtests, parameter sweeps, walk-forward validation, watch checks, holdings, journal reading, market data, news synchronization, and market pulse tasks without opening the Panel.
---

# Project Runtime

Use the current task's input, output paths and data rules. This skill locates the
programs; it does not authorize additional network sources, credentials or actions.

CodeShell supplies this skill from the current project's selected Panel package.
The exact skill directory is `${CODESHELL_SKILL_DIR}`. Resolve `../../..` from
that directory to obtain the package root; do not change the working directory
away from the current project. All relative data paths belong to that project.

| Task program | Path relative to this package root |
| --- | --- |
| Local research, holdings, and journal CLI | `app/tools/quant-lab.mjs` |
| Market data synchronization | `app/tools/fetch-market-data.mjs` |
| Portfolio market-data synchronization | `app/tools/fetch-portfolio-data.mjs` |
| News synchronization | `app/tools/fetch-news.mjs` |
| Market pulse | `app/tools/build-market-pulse.mjs` |
| A-share stock detail | `app/tools/fetch-a-share-stock.mjs` |
| US stock detail | `app/tools/fetch-us-stock.mjs` |
| Holding quotes | `app/tools/fetch-holding-quotes.mjs` |
| A-share selection snapshot | `app/tools/build-a-share-selection.mjs` |
| A-share screen | `app/tools/screen-a-shares.mjs` |
| A-share historical-data initialization | `app/tools/initialize-a-share-history.mjs` |
| Watch rule evaluation | `app/engine.mjs` |
| News validation and notification bookkeeping | `app/news-feed.mjs` |

Read the package's `.codeshell-panel/panel.json` and confirm `id` is `quant-lab`.
Check the requested program is readable. Pass its resolved path as one properly
quoted Node argument, with only the task's specified arguments. Use the same root
for imported calculation modules. Keep package files read-only.

Do not search the global installation registry, another version, a checkout, or
the network for a replacement. If the skill, manifest or requested program is
unavailable, report the task's `bundled-*-tool-not-found` / `unavailable` result
and stop that operation. Do not generate a replacement result or notify a trigger.

## Headless local CLI

Run the selected package's `app/tools/quant-lab.mjs` with Node 20+. Start with
`ops` to read its command list, exact JSON input schemas, and limits. `--help`
returns the same JSON. Each command emits exactly one JSON value on stdout:
`{ok:true,command,package,result}` or `{ok:false,error:{code,message}}`.
Exit status is 0 for success, 2 for rejected arguments, input, paths, missing
project files, or excessive work, and 1 for package/runtime/output failures.

Pass `--project <project-directory>` when the task's project differs from cwd.
Pass one JSON object on stdin or `--input-file <project-relative.json>`; do not
pass both. Data and input-file paths are relative to the selected project.
Absolute paths, parent traversal, hidden path components, and symlinks are
rejected. Input JSON is limited to 64 KiB, CSV/ledger files to 16 MiB, and CSVs
to 100,000 bars. Search work and JSON output are bounded too.

| Command | Input JSON |
| --- | --- |
| `dataset` (aliases `analyze`, `dataset/analyze`) | `{"csv":"data/prices.csv"}` |
| `backtest` | `{"csv":"data/prices.csv","configuration":{...},"includeSeries":false}` |
| `parameter-sweep` | `{"csv":"data/prices.csv","configuration":{...},"ranges":{"fast":[10,20],"slow":[40,60]},"options":{"minimumTrades":1}}` |
| `walk-forward` | Same CSV/configuration/ranges, with optional `options` containing `inSampleBars`, `outOfSampleBars`, `warmupBars` |
| `watch` | `{"csv":"data/prices.csv","item":{"symbol":"SH600519","rule":{"type":"price-below","price":1500}}}` |
| `portfolio` (aliases `holdings`, `portfolio/holdings`) | `{}` reads `portfolio/transactions.json`; optional `ledger` selects another project-relative ledger |
| `notes` | `{}` reads `portfolio/journal.json`; optional `path` selects a journal and optional `ledger` resolves transaction/instrument links |

For example, a backtest configuration is:

```json
{"strategy":{"type":"sma-cross","fast":20,"slow":50},"initialCapital":100000,"feeBps":5,"slippageBps":2,"stopLossPct":8}
```

Use task-supplied capital, fees, slippage and stop-loss assumptions; the example
does not choose them for the user. Strategies are `sma-cross` (`fast`, `slow`),
`rsi-reversion` (`period`, `oversold`, `overbought`), and `breakout` (`lookback`).
Sweeps may supply missing strategy parameters through their ranges. Invalid
combinations remain failed rows in the engine's report. Optional configuration
fields are `maxHoldingDays`, `sizer`, `signalMode`, and `riskFreeRate`; read `ops`
for their accepted forms. Backtests omit bars, equity, benchmark, and indicator
series by default; set `includeSeries:true` to include them within the output
limit. The output retains the engine release, dataset fingerprint, and warnings.

All commands in this CLI are foreground, read-only calculations. They do not
fetch prices, send notifications, create workers, or write ledgers, journals,
strategy files, or Host storage. Holdings are derived from the authoritative
ledger with no current quotes, so unavailable valuations remain unavailable.
Journal link status depends on the context supplied; omitted news/rules cannot
establish whether those references remain current. Use the existing collectors
only when the task authorizes their data sources and writes. Their persisted
local snapshots and Host task records remain separate protocols.
