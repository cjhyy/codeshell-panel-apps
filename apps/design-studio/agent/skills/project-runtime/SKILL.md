---
name: project-runtime
description: Inspect, read, audit, create and edit saved CodeShell Design v3 documents, export SVG or HTML, parse PRDs and compare saved designs using the selected Design Studio package without opening the panel.
---

# Project Runtime

Use this runtime for direct Chat or terminal requests against saved project files.
For a request submitted by the Panel with a Panel Trace ID, or an edit to an
unsaved live canvas, use `design-studio:repo-design` and the Panel tools. The CLI
reads disk snapshots and cannot inspect or overwrite an unsaved live transaction.

CodeShell supplies this Skill from the current project's selected Panel package.
Resolve `../../..` from `${CODESHELL_SKILL_DIR}` to that package root; read its
`.codeshell-panel/panel.json` and confirm `id` is `design-studio`. Confirm
`app/tools/design-studio.mjs` is readable. Keep package files read-only. Do not
search other installations, versions, development checkouts or the network for
a replacement. If the Skill directory, matching manifest or CLI is missing,
report `bundled-design-studio-cli-not-found` and stop this operation.

Require Node.js >= 20.10 on PATH. Use the actual current project directory as
`--project`; omitting it uses the working directory, without searching ancestors.
Requests are bounded UTF-8 JSON files, at most 16 MiB, passed as one quoted path:

```sh
node "<package-root>/app/tools/design-studio.mjs" ops
node "<package-root>/app/tools/design-studio.mjs" run inspect \
  --input-file "<request.json>" --project "<current-project>"
```

Read `ops` for the current operation schemas. Every operation prints one JSON
result on stdout. Exit codes: `0` success, `2` invalid arguments/design, `3`
revision conflict, `1` other failures. A successful `validate` command may report
`valid: false`; inspect its audit counts and issue records rather than treating
exit code 0 as a zero-warning design. Never claim an artifact was saved without
an `ok: true` write receipt.

Before `create`, `edit`, or an SVG/HTML export with `output`, use CodeShell's
actual Bash tool to read the Host-injected workspace-write protocol marker:

```sh
printf '%s\n' "${CODESHELL_WORKSPACE_WRITE_PROTOCOL-}"
```

Require exactly `1`. If absent or different, report
`headless-host-upgrade-required` and do not run headless writes. Never export,
set or fabricate this marker. CodeShell 0.9.36 or later coordinates CLI and Host
workspace writes using this protocol. Global version strings, Panel API versions
and package versions cannot replace this probe. Read-only operations remain
available. Independent terminal use does not require this environment marker;
any Host concurrently using that project must still support the shared protocol.

| Operation | Input and result |
| --- | --- |
| `inspect` | `path`; saved primary-file SHA-256 `revision`, canvas, tokens, resources and page catalog. |
| `read` | `path`, optional `page_id` or `node_id`; a complete saved v3 document, page or node subtree. For a node, optional `max_depth` is 0–32. `descendantsTruncated` marks omitted descendants. |
| `validate` | `path`; shared document validation and all-page audit, with counts plus up to 400 issues. |
| `svg` / `frontend` | `path`, optional `page_id`, optional `output`; one saved page's SVG or editable static HTML. Without `output`, content is returned in JSON. |
| `brief` | `path` to a project-local Markdown, MDX or text PRD; structured goals, requirements and acceptance criteria. |
| `compare` | `path`, `actual_path`, optional `page_id` / `actual_page_id`; geometry and style comparison of two saved design pages. This does not measure pixels. |
| `create` | `path`, `document`; create a missing source from a complete Design v3 repository document. |
| `edit` | `path`, `expected_revision`, `document`; save a complete edited Design v3 repository document with compare-and-swap. |

Design paths must be portable relative `designs/*.codesign.json` paths. Export
outputs must be new `designs/*.svg` or `designs/*.html` paths outside
`designs/codesign-data/`; exports never overwrite existing files. Project paths
reject symlinks, hidden segments and traversal. Each project operation reads at
most 64 MiB total, reconstructed designs and request files at most 16 MiB, and
stdout results at most 1 MiB. On `RESULT_TOO_LARGE`, narrow `read` by page/node
and `max_depth`, or export into a new artifact. PRDs are limited to 512 KiB.

Create/edit use the Panel's exact v3 codec, so `document.pages[].children` is
nested, while node `x/y` remains absolute canvas geometry. Start with `read`,
preserve stable page/node IDs and all unaffected content, and construct the
complete edited document. These saves do not run the live editor's `use_design`
operations, undo/rollback or Auto Layout mutation engine: supply already
materialized geometry and validate it. Color values must be consistent with
their intended tokens. Do not create placeholder screens merely to pass audit.
For bounded incremental layout work, live screenshots, HTML capture/import,
Figma exchange, comments, prototypes or resource insertion, use the Panel's
`repo-design` workflow. Static SVG/HTML output does not establish visual fidelity;
inspect the actual artifact when making a visual claim.

Use the exact `revision` returned by the latest saved-file read as
`expected_revision` for `edit`. This is a disk SHA-256, separate from the live
Panel's `stateRevision`. On `REVISION_CONFLICT`, reread, preserve intervening
changes and construct a fresh edit; do not retry the stale document or edit
immutable page/resource objects manually. Saves verify every referenced resource
part's length and SHA-256 before publication. Small documents remain a single
canonical source; large documents and previously indexed designs use the same
verified page index format as the Panel. Immutable page parts are published
first and the primary source commits atomically last. Interrupted saves can
leave unreferenced immutable parts; later saves may reuse identical parts.

Existing companion files are preserved, but a complete-document edit does not
reconcile changed IDs in comments/prototypes or update Figma source mappings.
Retain IDs when those relationships matter and use the Panel for their edits.
The CLI never reads private Host storage. CLI writers serialize operations using
project-root `.design-studio-write.lock`, and all file commits use the Host's
`.codeshell-workspace-write-<sha256(NFC-lowercase-filename)>.lock` in the file's
parent directory. Locks wait up to five seconds and release only their acquired
device/inode; stale locks are never automatically removed. Verify no writer is
active before manually removing a crash-left lock.
