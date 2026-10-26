# H2F-INTEGRATION-009 — reject incomplete browser conversion reports

Status: candidate source and formal regressions frozen on 2026-10-22. This is
an import admission repair, not proof of native text-layout or generated-glyph
visual fidelity. Existing 007/008 behavior and frozen preview snapshots are
unchanged. No merge, installation or publication occurred.

## Trigger and required result

html2figma may identify browser text paint for which native layout/generated
glyph observation is incomplete. Its root `conversionReport` can therefore be
`{version:1,ready:false,partial:true,errors:[...],warnings:[]}`. Previously the
candidate ignored this field, imported the nodes, and could present the result
as a complete editable design. Malformed reports and reports inside child
nodes were also ignored, and a wrapper report was dropped during normalization.

The new [`conversion-report.mjs`](../../apps/design-studio/app/conversion-report.mjs)
validates optional reports before normalization, asset preparation, measurement
or document application. An incomplete report throws `CONVERSION_INCOMPLETE`
and explains that native text layout or generated-glyph observations are
missing. A malformed or wrongly placed report throws
`CONVERSION_REPORT_INVALID`. Report-free legacy input retains its existing
behavior. The input object is never changed.

## Report and root boundaries

A report has exactly `version`, `ready`, `partial`, `errors`, `warnings`;
version is 1, readiness values are booleans, and `partial === !ready`. Both
diagnostic collections must be dense arrays. Each diagnostic admits only
`code`, `message`, optional `sourceOffset`, `sourcePath`, `nodeId`; code/message
and present nodeId are nonempty strings, offset/path entries are nonnegative
safe integers. Accessor-backed report fields, unknown fields and invalid types
are refused. `ready:false`, `partial:true`, or any errors refuse the entire
import; `ready:true` requires `partial:false` and empty errors. Valid warnings
are retained in their original report without changing readiness.

Owners follow the bridge's supported **design-root boundaries**, not arbitrary
JSON depth:

- A direct plugin/REST root may carry a report.
- Each root in a raw array may independently carry its own report.
- `{nodes:[roots],conversionReport?}` admits an optional envelope report plus
  each root report. A single incomplete root refuses the whole batch, even
  under a ready envelope.
- REST `document` wrappers and selected-node `nodes` maps admit their actual
  document roots and supported envelope reports.
- Descendants under `children` and unrelated metadata/assets cannot introduce
  report owners. A ready parent cannot authorize such a nested report.

Each root's report stays on its original source node. A wrapper report stays
on the source envelope; `figma-assets.mjs` now retains that new optional field
through preparation. Reports are not merged or promoted over a different
root's proof. Repeated normalization validates the same root boundaries and
preserves distinct envelope/root diagnostics.

Observed generated hyphens remain independent TEXT nodes. Their original
`sharedPluginData.generatedText` JSON string retains the raw UTF16 offset,
full raw `sourceText`, exact observed text (including empty string), observation
kind and optional sourcePath in the source binding. The guard does not splice
glyph text into the original Text, synthesize a missing glyph, or claim that
the report itself proves pixels. Existing character/geometry/font conversion
rules remain independent.

## Red, green and regression

[`html2figma-conversion-report.test.mjs`](../../tests/apps/design-studio/html2figma-conversion-report.test.mjs)
first ran against the unchanged candidate: **6 failures / 1 passing legacy
control**. It demonstrates ignored incomplete/malformed/nested reports and
lost wrapper proof. With the guard, all seven cases pass: direct synchronous
import and async preparation, zero asset/font work before refusal, array
all-or-nothing admission, distinct proof retention, REST boundaries, strict
fields, legacy compatibility, input immutability, and independent/empty glyph
Text preservation. A separate implementation-review red also caught empty
diagnostic strings before alignment with the producer's strict contract; it is
not counted as a preexisting converter defect.

[`html2figma-conversion-report-ui.test.mjs`](../../tests/apps/design-studio/html2figma-conversion-report-ui.test.mjs)
uses the actual source app's standard file dialog in independent Chromium
contexts. It starts with an existing document, rejects an incomplete batch or
nested report, verifies Apply remains disabled and the complete metadata
(including state revision) is unchanged, then imports a corrected two-root
package successfully. Both cases pass. These are formal isolated browser
tests; actual user UI/native Figma acceptance remains with the coordinator.

The two files are registered in `tests/suites.mjs`; UI is exclusive. Final
related verification passes **127 tests, 0 failures, 1 optional private-IANA
skip (128 total)**:

```sh
node --test --test-concurrency=1 \
  tests/apps/design-studio/html2figma-conversion-report.test.mjs \
  tests/apps/design-studio/html2figma-conversion-report-ui.test.mjs \
  tests/apps/design-studio/figma-bridge.test.mjs \
  tests/apps/design-studio/figma-assets.test.mjs \
  tests/apps/design-studio/html2figma-json.test.mjs \
  tests/apps/design-studio/html2figma-range-budget.test.mjs \
  tests/apps/design-studio/figma-binding.test.mjs \
  tests/apps/design-studio/prepare-figma-cli.test.mjs \
  tests/apps/design-studio/figma-workflow-ui.test.mjs \
  tests/apps/design-studio/browser-store.test.mjs \
  tests/apps/design-studio/browser-store-ui.test.mjs
```

Syntax and diff whitespace checks pass. Ignored evidence is under
`artifacts/h2f-integration-009-20261022T055153Z-f629bc55/`: before source bytes and
hashes, original red test/log, first green log, strict-string review red,
`related.final.green.tap`, and the final file-hash manifest/incremental patch.

## Generated package boundary

The native app loads these source modules directly. The prior generated-package
sync remains preserved history. At the initial 009 source freeze, the new guard
made its embedded V3 UI adapter stale again; that read-only `--check` failure
remains in `generated-status.readonly.stale.log`.

The coordinator then separately authorized an [official generated-package
synchronization](../../artifacts/generated-plugin-sync-009-2026-10-22T05-56-29-520Z-df586271/README.md).
Old complete bytes and input hashes were archived before the official
generate/check sequence. Current `--check` passes and 163 existing
plugin/v3/UI/native-text contracts pass. Only the V3 adapter slot changed;
PAINT/GRID/SPACING/TEXT and all slot-external content are unchanged. This is
the entire unpublished candidate context, including previous 007/008/font
work and 009, not an isolated 009 plugin or actual native acceptance. Browser
storage remains an app-source feature. Existing snapshots and historical
evidence were not replaced.


## 2026-10-26 integration follow-up — linear preflight work

During integration, an independent bounded child reproduced a real availability
regression before the existing whole-source budget. A 60,000-level inert
`metadata.next` chain plus otherwise valid FRAME/nativeNotes takes roughly
540,275 bytes of JSON, below the unchanged 16 MiB input limit. Main `8e8917f` rejects
its existing serialization/owned-data budget normally; the candidate's new
report guard copied the entire ancestor path at each level and had not returned
after a 4-second child deadline. The child used 96 MiB old-space, a 5-second CPU
limit and disabled core dumps. An 8-level control remains accepted in both.

The repair uses linked paths during the report scan. Only actual report owners
materialize a short lookup key; a path longer than every supported owner cannot
own a report. Existing envelope/root ownership stays path based, so an object
aliased at a legal root and beneath metadata is still rejected at the latter.
No input byte, node, structural-depth or existing report threshold was lowered,
and serialization still returns the original rejection for the deep source.

[`conversion-report-budget.test.mjs`](../../tests/apps/design-studio/conversion-report-budget.test.mjs)
constructs the deep fixture in a memory-capped, deadline-bounded Node child. It
checks the existing refusal, a deep nested-report refusal, an 8-level native
control and a 256-level legacy metadata acceptance control, plus root/metadata
alias ordering. This is an availability/admission regression, not a native
layout or pixel-fidelity receipt. The original controlled red, unchanged
baseline control, diagnostic-only variant and production green remain separately
under `artifacts/design-studio-draft-integration-20261026/conversion-report-budget-review/`.
