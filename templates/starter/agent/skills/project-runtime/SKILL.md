---
name: project-runtime
description: Run the selected Starter Panel package's local context and counter CLI without opening its webview.
---

# Starter Runtime

Resolve `../../..` from `${CODESHELL_SKILL_DIR}` to the current project's selected
package. Verify `.codeshell-panel/panel.json` has `id: "starter-panel"` and
`app/tools/starter.mjs` is readable. If unavailable, report
`bundled-starter-cli-not-found`. Keep the current project as the working directory,
and use the resolved CLI path as one quoted Node argument. Keep the package read-only.

```sh
node "<package>/app/tools/starter.mjs" ops
node "<package>/app/tools/starter.mjs" context --project "<current-project>"
node "<package>/app/tools/starter.mjs" counter --input-file "<request.json>"
```

Counter input is `{"value":0,"amount":1}`; `amount` defaults to 1. This evaluates
the same operation as the panel's button. The result is not saved, and does not
change an open panel's count. Context reads local directory metadata; it does not
claim Host trust, permissions, account access or a remote workspace mapping.

The CLI writes one JSON envelope to stdout (`ok` and `result` or `error`). A
nonzero exit code means failure. Input is limited to 16 KiB. Do not search another
installed version, a development checkout or the network for a replacement.
