# Design Studio polish branch integration

Reviewed source: `codex/design-studio-polish` at
`ec7d220c98716d02c6405e8173cc0bd07b30612d`, based on `096042423b3c4586cee46fb4d122268b6ab91331`.
Modern integration base: `origin/main` at `58e5515`.

`git cherry origin/main codex/design-studio-polish` identifies `0960424` as patch
equivalent (the responsive/fidelity work was squashed into `f466ccd`), while
`ec7d220` remains unique. The old direct-text/comment state names never occur in
the modern main history (`git log origin/main -S 'inlineTextEdit = null'` and
`-S elementCommentTarget`), so there is no evidence of an intentional later
reversal. This integration is a normal two-parent merge that ports the valid
missing behavior onto modern persistence and context handling.

All ten files in `git diff ec7d220^ ec7d220 --name-only` were reviewed:

| Old changed file | Integration decision and evidence |
| --- | --- |
| `apps/design-studio/.codeshell-panel/panel.json` | Its only delta was the old release version `0.18.0 → 0.19.0`. Keep the current `0.18.1`, current permissions and current declared tools. No release was requested here. |
| `apps/design-studio/README.md` | Restore documentation of canvas text editing, shared select behavior, visual layout controls and layer comments; document the newer scoped recovery/concurrency behavior. Retain all modern recovery, delivery, touch and capability documentation. |
| `apps/design-studio/app/app.js` | Port inline editing, complete imported text source handling, one-entry undo, stable target/breadcrumb context, comment and selected-target Agent handoff, layout direction/alignment/distribution guidance, PRD display text, and SVG inspector/layer icons. Reuse modern workspace/document/page guards, save queue, recovery snapshots and Agent capability discovery. Replace the old private select implementation with existing shared `panel-select.js`. Do not restore the old preview mock that pretended Agent submission succeeded. |
| `apps/design-studio/app/index.html` | Add inline text input, comment tool/action/dialog, targeted Agent context, layout status/direction/nine-point alignment/distribution, advanced controls and shortcut documentation. Retain current drawers, file tools, backups and semantics. Use a modal comment editor so the complete form remains reachable on narrow touch screens instead of the old stage-positioned popup. |
| `apps/design-studio/app/style.css` | Add scoped overlay, icon, layout and comment styles with 44px layout targets and narrow-screen overflow coverage. Retain current theme tokens, touch cancellation layout and shared select styles. The old custom select stylesheet is superseded by the repository's shared controls. |
| `apps/job-hunt-hq/app/app.js` | Modern `submitSessionTask` already sends `displayText` from each task's instruction and records `submitted/running`; resume generation/revision, job discovery, interview-set generation, workflows and company research use it. The old Session-only mock interview has been replaced by durable panel interview sessions. One still-missing valid delta remained: the Session instruction success toast incorrectly said “已完成”. Correct it to “已发送” and verify real main UI with an acknowledged `agent.submitPrompt` plus the user's display text. |
| `apps/quant-lab/app/app.js` | The old one-line displayText addition is already covered by modern module-aware `submitAgentRequest`, which sends the prompt plus `Agent 协助：${MODULE_LABELS[activeModule] ?? "投资研究"}` and retains its project epoch check. Keep the current module context and caption. |
| `package.json` | The only delta was the old root release version `0.18.0 → 0.19.0`. Keep current root `0.18.0`, current dependencies and commands. |
| `package-lock.json` | The only two deltas repeated that old root version. Keep the current lockfile and dependency graph. |
| `scripts/validate.mjs` | Keep current `0.18.1` Design contract and shared select checks instead of old `0.19.0`/`initializeCustomSelects` markers. Current validation checks all static queried DOM IDs. The stronger real-browser regressions for text, alignment and comments are registered in `tests/suites.mjs`, so normal Design and full offline CI gates exercise the port. |

The merge also retains the current root README: its responsive/fidelity conflict
comes from the already-covered parent `0960424`, not an additional tip delta.

## Verification

- `node --test tests/apps/design-studio/polish-ui.test.mjs`: complete source text,
  commit/cancel/undo, save buffer capture, scoped draft backup on same-cwd project
  replacement, stable comment context, delayed save/submit receipts, replacement
  comment and Agent drafts, indexed save metadata, lazy page transitions,
  edits during save, text creation/Enter, visual layout and locks, mobile
  reachability and shared select reuse. Its 14 real-browser tests are included
  in both the default suite catalog and the dedicated Design Studio CI gate.
- `node --test --test-name-pattern='Session instruction' tests/apps/job-hunt-hq/draft-ui.test.mjs`:
  acknowledged submission never claims completed work and keeps exact user text.
- `npm test -- --suite design-studio`: existing recovery, backup, late context,
  document replacement, touch cancellation and new editor interactions.
- `npm run check`: source types, committed build output, package validation and
  all default offline suites, including the new Design and Job regressions.

The tests use isolated in-memory Host bridges, browser-generated input and local
fixture documents. They do not validate a real installed Host or paid Agent run.
