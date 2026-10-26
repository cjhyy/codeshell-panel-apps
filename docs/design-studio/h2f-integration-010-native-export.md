# H2F-INTEGRATION-010 — complete production native-export envelopes

Status: source v3 frozen on 2026-10-22 in
`codex/design-studio/html2figma-import-fidelity`. **Unmerged, uninstalled and
unpublished.** Source admission, actual browser save and native/pixel acceptance
are separate receipts. Existing 007/008/009 behavior and frozen snapshots are
not replaced by this case.

## Trigger and expected behavior

The real production exporter emits `{nodes:[...],exportReport}` with SDK local
and absolute transforms and bounds. The old raw-plugin admission path rejected
that array because native nodes have relativeTransform/absoluteBoundingBox;
accepting it by deleting those fields would change geometry semantics.

The immutable [production fixture](../../tests/fixtures/design-studio-html2figma-json/native-production-export.v1.json)
is **5743 bytes**, SHA-256
`2f67d578a5c51c87d787ee71294c8f7565848cbd8d38a7f00df8ea3be5266739`.
It contains FRAME `106:6433` and red RECTANGLE `106:6434`: root 160×80,
clipsContent false, render width 200; child local `(140,20,60,30)`, 40px right
overflow. Import must keep both nodes editable, the original source/report and
the 160px layout width, without a hand patch or expanding the frame to render
bounds.

## Implementation and strict boundaries

- [native-export-report.mjs](../../apps/design-studio/app/native-export-report.mjs)
  validates the exact report fields, dense diagnostics, integer count/resource
  ledger, complete status, matching selected/serialized counts and unique,
  nonempty source IDs. Errors, partial/unsupported/incomplete resources and
  contradictory ledgers refuse the import before canonical mutation.
- [figma-bridge.mjs](../../apps/design-studio/app/figma-bridge.mjs) admits only the
  report-backed native branch, preserving source transforms and adding size
  only when missing. Positive local sizes, rigid local/world matrices, local
  x/y translation and existing size must agree. Null absoluteBoundingBox is
  allowed with complete native local geometry. Scale/shear/reflection remain
  unsupported. Selected roots under an unexported rotated parent use actual
  absoluteTransform for placement without rewriting retained relativeTransform.
- [figma-assets.mjs](../../apps/design-studio/app/figma-assets.mjs) checks and
  retains the full report through prepare and repeated source normalization.
  Nodes-array and retained nodes-object paths share the native guard. Existing
  report-free REST/raw-plugin contracts, including old size normalization, stay
  distinct. A report-free native array or mixed-format subtree is not admitted.

The producer report is not a cryptographic authenticity proof or blanket
native-fidelity promise. Existing receiver JSON/resource/text budgets remain;
a producer ledger cannot authorize bytes above the receiver budget. The source
is semantically retained in a normalized nodes-object envelope, not as the
original pretty-printed JSON bytes. Unsupported fields may remain in source
binding without becoming editable canonical capabilities.

## Stable red and formal green

The new [formal file](../../tests/apps/design-studio/html2figma-native-export.test.mjs)
is registered in `tests/suites.mjs`. Initial 7 cases had 4 failures and 3 passing
controls. Review added a selected-root world-rotation case, retained-object
geometry bypass and non-rigid rejection (22 pass / 3 fail before repair).
Four further tampered-input negatives cover references with zero resources,
orphan byte ledger, zero-size descendants and duplicate native IDs. These are
integrity tests, not four new observed native conversion failures.

Final targeted verification: **29 new + 89 related existing = 118/118 passed**.
A separate, unchanged independent set passed **9/9** (2 geometry, 4 integrity,
3 real-fixture preservation), with **318 original-field comparison points**
across normalize twice and standard prepare. Old red runners, app bytes, source
hashes and logs remain preserved; no assertions or original fixture were
weakened. The independent run verified stable candidate module/fixture bytes.

```sh
node --test tests/apps/design-studio/html2figma-native-export.test.mjs
node scripts/check.mjs --tests-only --suite design-studio
node scripts/validate.mjs
```

## Actual saved receipts, not completed reopen acceptance

The coordinator used standard UI import, Save and portable backup on two
immutable previews. Geometry-v2 / 4186 saved **8570B**, SHA-256
`fb2b91f14f55241f748a82fdb4e970d4077771e71fbb76a2613967d0ed295529`.
Independent direct backup audit passed **83 checks**, including **154 original
source leaf values**, exact report/subtree, baseline equal to document,
bijective source/design mapping and descriptor hash. Root remains
`(1060,0,160,80)` with clipContent false; child `(1200,20,60,30)` retains 40px
right overflow. Source render width 200 never replaces layout width 160.

Strict-v3 / 4187 uses `app-snapshot-strict-v3-20261022T092438282226Z`;
all **141** files match its manifest (SHA-256
`2f8039c330f8a243fbed8254e0d9bcbabfcb79229b89fb6f1ba96eb935e3f870`),
and the three 010 modules match frozen source. Its saved backup is **8579B**,
SHA-256 `f948ffa120d242f85e9dac3abae4e1ee40224b40bd1f96a33dc823ebfb065cac`.
The complete v2/v3 backups differ only in the save target path;
document/resources/attachments are deep equal. Both carry the same **5801B**
figma-binding attachment, SHA-256
`81755158e6aee94997fe663e8b58b59280fb5f51272154b25c3189ca1f38cbb2`.

The v3 actual AX receipt shows 2 nodes, browser-local Saved, CanvasKit WebGL2,
0 blockers / 0 errors / 1 warning. Reopen from a 0-node page encountered native
confirm / tool timeout and remains **pending**. No final ready reopened backup
is claimed. Old 4184/1173 data was not changed. Browser save is not installed
Host acceptance; GPU status is not pixel equality, and no new native Figma
round-trip was performed by this audit.

The separate [formal UI regression](../../tests/apps/design-studio/html2figma-native-export-ui.test.mjs)
then passed **2/2** in fresh private Chromium contexts. It uploads the exact
5743B file, checks 2 editable / 0 skipped nodes and the report warning, creates
an independent target, saves through the real IndexedDB backend and directly
checks both the principal record and complete source attachment. It uses the
normal New Document action to reach 0 nodes, accepts only that test blank's
expected discard-confirm dialog, selects the saved file from the normal file
list and waits for ready / 2 nodes / clean state. Saved and reopened complete
backups are byte exact: **8565B**, SHA-256
`27ac2f45ca81e403ca95f4e4009cf4a16d1e1dda909ba93f740cdd6c75b2a706`.
Opening does not rewrite the saved principal revision, mtime or content. The
second case rejects a partial exportReport while preserving metadata/state
revision, complete backup bytes and existing IndexedDB files. Both cases have
no page errors or external requests, and the original fixture stays unchanged.

```sh
node --test --test-concurrency=1 tests/apps/design-studio/html2figma-native-export-ui.test.mjs
```

The formal file is registered once in the exclusive UI catalog. Its own direct
execution is recorded separately from the failed all-suite command below; it
does **not** turn the earlier IAB native-confirm/tool-timeout attempt into a
successful reopen receipt. Existing user origins and profiles were untouched.

## Final gate status and evidence

The final requested command ran once: its first batch reports
**1045 total / 1041 pass / 3 fail / 1 skip**, exit 1. Two failures are the
already retained generated UI adapter and installable HTML-plugin bundle
mismatches against current upstream source. The third is
`negative-main-gap.test.mjs:94`: Chromium `Page.captureScreenshot` failed
before the pixel Buffer comparison. It is an unresolved execution failure,
not measured evidence of a layout difference. The command exits after this
batch, so its later exclusive GPU/UI group did not run. Earlier intermediate
1038 / 1035 pass / 2 fail / 1 skip remains historical evidence.

`node scripts/validate.mjs` still ran independently and passed (exit 0).
All **654** app/scripts/tests files were byte-stable before/after both commands.
No rebuild, vendor regeneration, install, source/test change or commit was
performed to hide a failure. The entire candidate is not a fully green gate
or a 010-only release: prior font/007/008/009 work is still part of it.

The companion html2figma repository keeps immutable evidence under
`artifacts/fidelity-native-export-envelope-2026-10-22/`: baseline/red,
geometry-review-red/green, `strict-green-20261022T092041068509Z`,
`independent-saved-audit-2026-10-22T09-24-52.213+00-00`, both actual save
folders and `candidate-final-gate-2026-10-22T09-29-56.109+00-00` (exact logs,
source inventories, commands and v2/v3/snapshot audit). Independent 9-case
red/green is separately frozen under `fidelity-native-contracts-2026-10-22/`.
The new direct formal UI log, downloaded before/after backups and refusal
receipt are in `native-export-ui-formal-2026-10-22T09-37-00.829+00-00`.
See the [cross-repository evidence report](/Users/admin/Documents/个人学习/代码学习/html2figma/docs/design-workbench-native-export-evidence-2026-10-22.md) for exact paths and
acceptance limits.


## 2026-10-26 integration correction — native container/world agreement

Independent review froze a contradictory packet from the same two-node fixture:
only child `absoluteTransform[0][2]` changed from 1200 to 1700, while parent
absolute x1060, child local x140 and child bounds x1200 stayed unchanged.
Normalization, synchronous import and asynchronous preparation accepted it;
the canonical child stayed x1200 while the retained source claimed x1700.
The original input and observed result remain in
`peer-native-world-contradiction.{input,observed}.json` under the integration
artifact directory. This is an admission defect, not an observed native layout
change or permission to repair the coordinates.

The receiver now rejects a disagreement with
`NATIVE_EXPORT_TRANSFORM_INCONSISTENT` when an exported known container proves
its child's local-to-world relationship. FRAME, COMPONENT and INSTANCE create
a container anchor; Group/Boolean operations retain the previous anchor.
Unknown container semantics stop that inference. Each selected root keeps its
own absolute anchor because its external container may not be exported.
This follows Figma's [container-parent transform semantics](https://developers.figma.com/docs/plugins/api/properties/nodes-relativetransform/),
which explicitly skip Group/Boolean parents.

The comparison retains the existing fixed 0.001 matrix epsilon, rather than a
coordinate-relative tolerance. Exact float32 round-to-nearest output is also
accepted; the synthetic far-coordinate control demonstrates this without
claiming that every SDK implementation has that precision. Arbitrary nearby
translations still refuse. No coordinate or matrix is rewritten. Render bounds
are not layout geometry: Figma distinguishes [ordinary and rendered bounds](https://developers.figma.com/docs/plugins/api/node-properties/),
and the existing overflow/stroke fixture must keep its 160px layout frame.
This focused check does not infer arbitrary vector paint bounds or native pixels.

The existing native-export regression file adds four public-entry refusal cases,
retained-object and deep-descendant controls, Group/Boolean skipping, a new Frame
beneath a Group, selected Group outside-container behavior, counter-rotation at
negative infinite coordinates, outside-stroke/render overflow and null bounds
plus a float32 control. The initial run had 7 failing refusal cases and 36
passing controls; after the guard the full file passes 43/43. Original production
fixture bytes and all preexisting assertions remain unchanged. Frozen pre-source,
RED, GREEN and related regression logs are under
`artifacts/design-studio-draft-integration-20261026/native-transform-consistency/`.

## 2026-10-26 integration correction — native Group projection

The transform admission controls exposed a separate projection defect. In a
valid Frame → 90° Group → child packet, the SDK child matrix also contains that
90° rotation because its container is the Frame. Canonical geometry composes
every immediate parent, so copying the SDK child rotation produced a second
90° turn. The frozen input should paint at x1170/y20 with a 30×60 extent;
`transformedNodeBoundsInTree(nodes, child)` instead measured x1155/y35 and 60×30.
The corrected independent observation is `observed.v2.json`; the earlier
`observed.json` used the helper arguments in the wrong order and remains only
a harness diagnostic.

For report-backed native imports, the receiver now derives a temporary direct
parent matrix as `inverse(parent.absoluteTransform) × child.absoluteTransform`.
Each selected root independently uses its actual absolute transform. The
temporary geometry view uses measured width/height and does not substitute a
bounding-box center. The SDK relative/absolute matrices, null or non-null bounds,
report and all original source observations remain unchanged in the binding.
REST and raw-plugin projection rules are unchanged. This is an automatic
conversion correction; no canonical node is manually repaired afterward.

Five focused cases first failed and now pass: full-tree and selected-Group
imports with ordinary or null bounds, plus an observation-only bounding extent
that must not replace matrix-and-size layout. The Group cases cover raw and
retained packets, exact transformed extents, save/reopen, report/matrix/bounds
retention and an empty source patch after reopening. The existing far/negative,
counter-rotation, render-overflow, binding and ordinary JSON cases remain in the
related CPU group: **170/170** pass across eleven files. These are geometry and
persistence assertions, not a new native Figma pixel comparison. Frozen source,
RED/GREEN logs, input and independent observation remain under
`artifacts/design-studio-draft-integration-20261026/native-group-projection/`.
