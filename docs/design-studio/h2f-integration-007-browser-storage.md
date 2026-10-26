# H2F-INTEGRATION-007 — complete browser saves exceed localStorage capacity

Status: candidate source and formal regressions frozen on 2026-10-22. The
coordinator also verified the original IANA input through the standard browser
UI, explicit Save and reload. This worktree is not merged or installed in the
CodeShell host.

## Reproduction and cause

The original `frozen.colors.studio.json` imports 151 nodes and includes the
original Noto/IBM font bytes and full Figma source attachment. In a fresh private
Chromium origin, saving an empty document succeeded. Importing this input then
failed on the seventh 350 KiB source-attachment part with a real
`QuotaExceededError`. No quota filler was used. The existing localStorage keys
already occupied 5,080,769 key/value UTF-16 code units; the next write would
require 5,439,367. Smaller parts cannot remove this total-capacity limit.

The old primary document remained empty. After a complete backup was downloaded,
reloading that private test page reopened zero nodes, although the unsaved live
canvas had 151. The old backend also stored content and mtime in separate
`setItem` calls and generated revisions from `Date.now()`. Independent red
regressions demonstrated content replacement before an mtime failure and two
same-clock writers both accepting one expected revision.

The preserved local ignored evidence includes
`browser-storage-quota-audit.red.tap` (0 pass / 1 fail),
`browser-storage-quota-audit.original-red-from-tap.json`, and
`browser-storage-atomic-cas.red.tap` (0 pass / 2 fail) in html2figma's
`artifacts/fidelity-iana-2026-10-22/`. The latter runs a frozen extraction of the
old production functions, retained as this candidate's
`artifacts/font-capability-proof/browser-store.legacy-production.js`.

A later, explicitly labelled reproduction is retained in html2figma's
`artifacts/fidelity-storage-2026-10-22/legacy-quota-reproduction-20261022T051643Z-9cba8fb1/`.
It uses a new dedicated profile, the exact preserved old backend, and a frozen
UI shell with its new IDB transaction/capability paths disabled. Its README
documents that reconstruction boundary and links the original unchanged red
TAP; it does not claim to recover the overwritten historical JSON. The new run
again fails on source part 7, records all 37 writes and both genuine quota
errors, retains the old principal, and reopens zero nodes. Detailed JSON,
failure TAP, complete backup, source/runner hashes and entry parameters are
separately retained in that unique directory. No candidate business files or
existing evidence were changed by the reproduction.

## Implementation and transaction boundary

[`browser-store.mjs`](../../apps/design-studio/app/browser-store.mjs) implements
the browser workspace and recovery storage with IndexedDB. `app.js` uses it
only when `window.codeshellPanel.call` is absent. A present Host bridge retains
its original calls, capabilities and error semantics; a Host failure never
falls back to browser storage. The UI identifies browser saves as browser local
storage and explicitly says that they have not written to CodeShell or a real
repository.

Each file record contains content, modified time and an unpredictable revision.
An IndexedDB `readwrite` transaction checks observed revisions and writes the
new record together. Recovery `getSnapshot` / `compareAndSet` uses the same
transaction boundary. Concurrent new clients cannot both commit a write based
on the same prior revision, even when their clocks agree.

For an explicit browser Save, existing persistence helpers stage page/resource
parts, source-binding parts and mutable source indexes through an in-memory
batch. The principal file is staged last. One transaction then checks all
observed records and publishes all staged files together, retaining prior
versions in a separate history store. A failed or aborted transaction leaves
the old principal and its referenced attachments intact. No browser success
receipt or saved baseline is published before transaction completion. The
batch has a 128 MiB text-unit budget; it is not an unlimited-memory promise.

Old localStorage entries are never removed or rewritten. A legal old file with
no mtime remains readable. Legacy content plus its exact mtime string is
fingerprinted, retained as provenance, and checked before and after commit.
An old client's changed content, changed mtime, deletion, or later creation of
the same key produces an explicit legacy conflict rather than silently hiding
it behind the IndexedDB copy. When a legacy change crosses the commit boundary,
the result is explicitly unconfirmed and both versions, including prior IDB
history, remain available. Every subsequent read continues detecting the
conflict. **IndexedDB cannot atomically lock an old localStorage writer.** These
checks detect coexistence conflicts; they do not claim a cross-backend atomic
lock or automatic reconciliation.

No document schema, source JSON, font bytes, coordinates or imported node
properties are changed by the storage backend. No existing user keys or
failure tabs were cleared. History cleanup, eviction protection and migration
conflict resolution remain separate capabilities.

## Formal regression

[`browser-store.test.mjs`](../../tests/apps/design-studio/browser-store.test.mjs)
runs actual browser IndexedDB transactions and covers 11 cases: atomic
content/mtime/revision writes; same-clock two-client CAS; source-index/principal
quota and abort rollback; legal missing-mtime legacy adoption; changed,
deleted, newly created and mtime-only legacy values; changes before and across
commit; and recovery snapshot/CAS contention.

[`browser-store-ui.test.mjs`](../../tests/apps/design-studio/browser-store-ui.test.mjs)
imports a versioned fixture composed of seven real bundled fonts. Complete
source plus resources naturally exceed 5 MiB; the test saves and reloads through
the actual app, then deeply compares the document, resources and attachments.
A Host control throws on Host writes and makes any IndexedDB access fail: it
observes the Host error with zero browser-database accesses. An optional private
IANA case uses the unchanged original wrapper and all original font assets.

The new files are included in the exclusive UI group in `tests/suites.mjs`.
Existing connection, Figma workflow, review-comment and viewport tests now
observe persisted data through the browser backend rather than inspecting
localStorage's old implementation. The existing quota/retry workflow injects
the quota error at an actual IndexedDB object-store write and retains its
backup, retry, reopen and unrelated-user-data assertions.

```sh
node --test --test-concurrency=1 \
  tests/apps/design-studio/browser-store.test.mjs \
  tests/apps/design-studio/browser-store-ui.test.mjs \
  tests/apps/design-studio/connection-ui.test.mjs \
  tests/apps/design-studio/figma-workflow-ui.test.mjs \
  tests/apps/design-studio/review-comments-ui.test.mjs \
  tests/apps/design-studio/viewport-performance.test.mjs \
  tests/apps/design-studio/recovery-ui.test.mjs
# 77 pass, 0 fail, 1 optional private-IANA skip (78 total)

IANA_FONT_ASSETS_DIR=/absolute/path/to/fidelity-iana-2026-10-22/assets \
BROWSER_STORAGE_EVIDENCE_DIR=artifacts/browser-storage \
  node --test --test-concurrency=1 \
  tests/apps/design-studio/browser-store-ui.test.mjs
# 3 pass, 0 fail, 0 skip with the local original IANA assets
```

Candidate ignored logs are in `artifacts/font-capability-proof/`:
`browser-store.unit.tap` (11/11), `browser-store.ui.tap` (3/3 with IANA), and
`browser-store.related.green.tap` (77 pass / 1 skip). The first control run,
`browser-store.old-controls.tap`, records the three obsolete direct-LS
observations before their backend-aware updates; it is not counted as a new
product regression. Private IANA data is not committed with the tests.

## Actual IANA UI acceptance

The coordinator copied a stable app snapshot and opened it at
`http://127.0.0.1:4182/` in a new in-app browser tab. Standard file import of the
unchanged `frozen.colors.studio.json`, explicit Save, complete backup, reload
and another complete backup succeeded. The UI reported browser local
opened/saved, the canvas retained 151 nodes with CanvasKit WebGL2, and no quota
error occurred.

The before/after backups are byte-identical: 6,327,828 bytes, SHA-256
`a1195ea8012108ce4d061da96bd7b20de86937d40417586a925771ed3de74547`.
Their pages, resource descriptors, payloads and source attachments are also
deeply equal. Pages and resource descriptors/payloads match the prior GPU
backup. Whole source-attachment equality with the prior GPU backup is not
claimed because destination metadata differs.

The html2figma checkout retains this actual acceptance under
`artifacts/fidelity-storage-2026-10-22/`:

- `iana-actual-save-reopen.20261022.json` records the comparisons and hashes;
- `iana.saved-before-reload.complete-backup.json` and
  `iana.reopened.complete-backup.json` contain the complete saved design;
- `iana.saved-before-reload.jpg` and `iana.reopened.jpg` show the actual UI;
- `app-snapshot-idb-v1.manifest.json` identifies the exact served app snapshot.

The frozen candidate business files equal the verified snapshot byte for byte:

| File | SHA-256 |
| --- | --- |
| `app.js` | `de109c1c3747e240e3e9ae802c11d9e7156e230127ca2ad96a4b476e2b9fb50e` |
| `browser-store.mjs` | `a45ba678ce69e69babc048a33aa343005af86710de9e44597e880477b8910ce1` |

The old 4177 failure tab and its localStorage were not changed. This proves
browser fallback save/reopen for the original large input. It does not prove
native Host storage acceptance, immunity to browser eviction, durable storage
permission, or full visual equivalence. This native app serves its source
directly; no dist build was performed for this repair.


## 2026-10-26 integration with autosave and the compact workspace

The candidate is now combined with the current infinite-canvas, file-switch and
800ms autosave source. Saves retain the current automatic-save document/path
scope checks through the IDB batch commit. Tests use the actual compact toolbar;
opening More is required before Save, backup or Figma import actions. Their
content, reopen, quota, conflict and Host isolation assertions are unchanged.

A new real-UI case exposed an integration defect: a competing legacy write at
IDB transaction completion correctly produced an uncertain publication error,
but the app's publication sequence did not advance. The import transaction then
restored the old empty live canvas even though the new principal had committed.
The frozen before app reproduces zero layers instead of the exact two-node HTML
viewport/source structure. The corrected app retains that live structure and its
visible layer list, preserves the previous IDB version in history and the exact
competing localStorage value, and reports `保存状态待核对` without adopting a saved
baseline. A separate IndexedDB case proves that a scope guard firing after
completion is also marked uncertain, since its candidate bytes have committed.

Accepted RED inputs, original source, SHA, failure logs and GREEN evidence are in
`artifacts/design-studio-draft-integration-20261026/browser-publication-unknown/`.
Its README distinguishes preliminary fixture/oracle controls from product failures.
The store/UI group is 15 pass / 1 optional IANA skip; the original private IANA
case was then enabled separately and passed with all 151 nodes, font bytes and
source attachments retained. Related sidebar, connection, autosave, file-switch,
review and viewport UI is 38/38. Final combined-commit gates remain required.
