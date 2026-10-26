# H2F-INTEGRATION-005 — page sidebar retains an obsolete layer count

Status: candidate source fixed; formal browser regression red → green; actual
IANA sidebar replacement acceptance passed on 2026-10-22. The original failure
tab remains intact. This candidate is not merged or installed in the CodeShell
host.

## Trigger and cause

The IANA import was replaced from an 81-node version by a 151-node version.
The complete backup and binding still contained all 151 nodes and 38 text nodes,
but the page sidebar retained its previous `81` badge. Both versions used page
ID `figma-page-selection` and name `Figma Selection`.

`app.js:renderPages()` cached rendered rows using only the active page ID and
each page's ID/name. Replacing or editing nodes without changing page identity
left that signature unchanged, so the badge was never refreshed. It also read
the page descriptor's cached count before a loaded node array.

The repair computes one read-only count per row and includes it in both the
render signature and badge: the active document's current node array, another
loaded page's node array, or an unloaded page's descriptor count. It neither
updates document content nor recalculates geometry, text, fonts or resources.

## Formal regression

[`sidebar-page-count-ui.test.mjs`](../../tests/apps/design-studio/sidebar-page-count-ui.test.mjs)
opens the actual app source in a private Chromium context with an isolated
origin and local host adapter. It imports two minimal raw plugin JSON inputs
through the Figma file dialog and its real replace action. Both inputs retain
the same page identity and name; one has two layers and the other five.

Every assertion independently reads public document metadata and actual layer
count before comparing the rendered sidebar badge. The regression covers:

- replacement `2 → 5`, undo `5 → 2`, redo `2 → 5`;
- ordinary duplicate `2 → 3`, delete `3 → 2`, clear `2 → 0`, undo `0 → 2`, redo
  `2 → 0`;
- preservation of the imported shape's name and source geometry.

The test is included in `tests/suites.mjs` with the other exclusive UI tests.

```sh
DESIGN_STUDIO_QA_DIR=artifacts/h2f-integration-005/green \
  node --test --test-concurrency=1 \
  tests/apps/design-studio/sidebar-page-count-ui.test.mjs
```

Observed before the source repair: **0 pass, 2 fail**. Replacement metadata and
actual layers were both `5`, while the badge remained `2`. Ordinary duplicate
metadata and actual layers were both `3`, while the badge remained `2`.

Observed after the source repair: **2 pass, 0 fail**. All replacement/edit
transitions above show matching document and sidebar counts, with no page
errors. Related Figma workflow, editing and sidebar tests also pass together:

```sh
node --test --test-concurrency=1 \
  tests/apps/design-studio/sidebar-page-count-ui.test.mjs \
  tests/apps/design-studio/figma-workflow-ui.test.mjs \
  tests/apps/design-studio/polish-ui.test.mjs
# 28 pass, 0 fail
```

Local ignored evidence is retained under `artifacts/h2f-integration-005/`:
`red.tap`, `red/replacement.json`, `red/ordinary-edits.json`, `green.tap`,
`green/replacement.json`, `green/ordinary-edits.json` and `related-ui.tap`.
`harness-route-failure.tap` records an initial private test-route correction;
it is not counted as a converter or sidebar defect.

## Actual IANA acceptance and remaining boundaries

On 2026-10-22 the coordinator started a separate candidate preview:

```sh
npm run preview -- --app design-studio --port 4176
# http://127.0.0.1:4176/
```

The preview completed successfully and reported that this native app does not
require a build step. In a new in-app browser tab (tab 12), the initial restored
two-node document was fully backed up and saved as an independent copy before
continuing. The normal Figma import dialog then imported the 81-node IANA input
and used the undoable replace action to import the 151-node colors input.
Page ID/name remained `figma-page-selection` / `Figma Selection`, and the
rendered sidebar badge changed from **81 to 151**. The imported model retained
**151 nodes and 38 text nodes**. Replacement undo/redo is separately covered by
the formal minimal regression above.

The html2figma checkout retains the real acceptance evidence under
`artifacts/fidelity-iana-2026-10-22/`:

- `sidebar-count-verification-20261022.json` records the 81/151 badges, model
  counts, evidence hashes and structural comparisons;
- `studio.count-fix.before81.jpg` and `studio.count-fix.colors151.jpg` show the
  actual sidebar before and after replacement;
- `studio.count-fix.colors.complete-backup.json` is the new complete backup.
  Compared with the original `studio.colors.complete-backup.json`, its pages,
  resource descriptors, resource payloads and source attachments are all deeply
  equal. The serialized backup files have different hashes, so the evidence
  asserts these content fields rather than whole-file byte equality.

The original failure tab (tab 11, `localhost:4174`) was not reloaded, and its
complete backup remains available. Browser storage quota still prevented
confirmed persistence of the final import; its complete backup was retained.
Font fidelity, GPU range-font support and native Figma acceptance remain
unresolved and separate. This UI count repair does not establish storage quota
recovery or whole-page visual equivalence.
