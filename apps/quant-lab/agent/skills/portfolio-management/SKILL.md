---
name: portfolio-management
description: Record user-confirmed holdings in the Investment Desk portfolio panel from screenshots or local records. Use for 加入持仓、录入持仓、导入持仓 and checking whether saved holdings actually appear; read existing state before updates. Does not place trades or provide investment advice.
---

# Portfolio management

The panel reads `portfolio/transactions.json` in the selected investment workspace and derives
`portfolio/holdings.json`. A standalone file under `data/holdings/` is evidence, not panel admission.

Use `Panel` to discover `panel-app:quant-lab` and its tools. Call `get_portfolio_context` before any
import. The current tool supports opening holdings for Shanghai/Shenzhen A-share accounts with no
existing transactions. Existing accounts with flows need reconciliation using actual trades; do not
create another account just to bypass this check. For other markets, report the unsupported scope.

## Source to ledger

- Extract only user-confirmed positions: canonical SH/SZ symbol, name, actual quantity, total cost and
  snapshot market value. Keep watchlists and funds' underlying holdings out of the user's account.
- `costBasis` is total cost, not per-share cost. If deriving it from value minus displayed P&L, state
  that calculation and retain the screenshot/file reference. Use decimal strings; unknown is not zero.
- `source.marketDate` is the actual source date, or `null` if absent. `valuationDate` is the source date
  when known. If unknown, use a recording date the user has specified or accepted as the opening
  baseline; ask only if no such date exists. Never invent a historical buy date or treat the screenshot
  quote as live. Preserve the unknown date in the source.
- Use the user's account label. Broker may explicitly be “unknown”; never infer it from a generic UI.
  Credit-account available funds are not necessarily cash balance or net assets. The importer records
  positions only; it does not infer cash or liabilities from that number.

Call `import_portfolio_snapshot` with `mode: "preview"`, the exact `expectedFingerprint` from the
context (`null` only for a missing ledger), and the source/account/positions. Review the resulting
positions and warnings. For an authorized request to add holdings, proceed to `mode: "commit"` with
the same input; no additional confirmation is needed unless essential source information is missing.
A read-only analysis request authorizes preview only.

A successful commit returns `committed: true`. `already-imported` is an idempotent success: never
submit again under another account or source reference. A revision conflict means reread and review
new state; do not automatically overwrite it. If `cacheStale` or `panelVerified: false` is returned,
report “ledger saved; panel refresh not verified” and refresh/read back instead of importing again.
Only say “added to the panel” after the tool reports `panelVerified: true`.

If the tools are unavailable, report that the panel integration needs an update. Do not create a
custom JSON file and call that completion. Keep original screenshots and existing ledgers intact.
