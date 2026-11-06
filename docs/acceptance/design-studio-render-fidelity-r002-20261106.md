# Design Studio render fidelity — R002 (2026-11-06)

Base: `3ca2f92d95e18f1039d647e0edd36f902f851eb5`; task branch:
`codex/design-studio/render-fidelity-r002-20261106`.
Tested implementation commit: `008521ab62e0a2f625013e0ba800d8ef519f7ffe` (22 files, +1182/-213).
The following report commit changes documentation only.

This is a local, reviewable checkpoint for the same CC session that blocked
R001. It does not replace CC's independent review. The shared coordination
ledger, R001 evidence, private design, Host, other Panels, dependencies and
lockfile are unchanged. There is no push, PR, merge, publication or installation.

**Visual disposition:** the six-page primary real-text gate passes after full
four-route isolation. Full visual acceptance remains **blocked**, with 262
real stroke failures, 396 fully covered but unavailable stroke probes, and 14
synthetic failures. This is not a claim that R002 meets every requested gate
or that all styles match. The same CC session must adjudicate the residuals.

## Evidence custody and reproducibility

All paths below are relative to the uncommitted evidence root:
`/Users/admin/.codex/worktrees/panels-design-render-fidelity-r002/.tmp/render-fidelity-r002/`.
The frozen R001 application is an archive of the exact base commit at
`base/apps/design-studio/app`, not a copy of another checkout's working files.
New baseline measurements use the R002 harness. Old R001 tiled failure counts
are not used as unique-node before/after results.

Environment: Darwin arm64, Node v25.8.1, Chromium 148.0.7778.96; independent
`npm ci`, with no node_modules symlink. The matrix uses actual CanvasKit
WebGL2/SwiftShader, not a claim about physical GPU performance. Focused GPU
cache tests use the platform's Metal backend. Browsers have dedicated private
contexts, synthetic Host data and intercepted local requests. No credentials,
user tabs or real-network fidelity collector are used. PingFangSC-Regular is
loaded from the installed local font and verified, not skipped. The Inter
spike and synthetic variants use the package's exact font bytes; the real
design has no Inter nodes, and its unused Inter probe is not counted as a
missing font.

The six-page design is read only from
`/Users/admin/.codex/worktrees/codeshell-cross-platform-design-20261106/designs/codeshell-web-refined.backup.json`.
Its SHA-256 remains
`91d877f8dbb28dce4c698b850c0db7455be2471c9d052f5cdf138c35f47dfc24`.
There are 807 nodes, including 232 text and 101 legacy stroked nodes. No
authored coordinates, offsets, serialization format or normalization rules
are changed. `environment.json` also records the lockfile digest and resolved
dependency directory.

## Unique attribution and strict gates

One result is one `(page, node, route, matrix)`, including the HTML reference
self-comparison. Full coverage is selected before partial coverage, with a
fixed clearance ranking independent of measured error. Original tiled records,
PNGs and raw unique selection remain in each report. The final attribution
uses complete isolated coverage where required. Full coverage does not imply
that a probe is measurable or that it passes.

Isolation preserves layout placeholders, target paint, necessary ancestor
fills, opacity, clipping, rotation, layout and border widths. It suppresses
other paint consistently in the actual GPU/browser editor and SVG/HTML exports.
The original design is never written. DOM world-bbox checks verify that target
and ancestor positions/sizes are unchanged; they do not independently prove
computed clip/opacity/transform semantics. The clone contract and unit tests
cover preservation of those fields.

Oversized isolated targets use the same viewport/DPR/zoom and a derived pixel
stitch from complete raw tiles. Every output pixel has one source owner; there
is no interpolation, blending or manufactured gap fill. The report identifies
these as `isolation-full-composite`, never as single screenshots, and includes
source/output SHA-256, copy regions, coverage and overlap differences. Missing
coverage, nonintegral offsets and budget overflow have explicit reason codes.
The preliminary candidate's 80 derived route images were independently
reconstructed byte-for-byte from source tiles: 25,544,480 output pixels,
100% coverage and zero overlap differences (`report-harness-audit.json`).

Stroke geometry uses four edges and three positions per edge. The nearest
continuous coverage segment excludes same-color internal rules. An
`html-pixel-snap` label requires fractional device edges, complete matching
12-probe evidence, GPU–SVG <=0.1 and GPU–HTML <=1 device px. It always carries
`pass:false`. `truefail` includes all gate-failing rows, including this label;
`unclassifiedFail` is only a subset, not the total remaining failures. Pixel
failures are never waived by the label.

The inherited descender-text centroid exception was removed. Every text now
uses the <=0.75px centroid gate, including callers supplying the obsolete
`centroid:false` option. The new ±0.8px injection first failed, then passed
with the correction; `.75` remains the boundary. All-text audits of the
preserved R001 baseline and preliminary candidate confirm that the old
exception hid no measured failure: the baseline's 178 over-limit final rows
already had gate failures and isolation, and the candidate had none.
`all-centroid-audit-final-baseline.json` binds this check to the raw report
and measurement hashes. The baseline report is preserved, not rewritten.

The final real capture explicitly isolates all 232 text nodes in all four
routes and matrices, in addition to failing/unavailable shapes. This also
provides isolated candidate measurements for the baseline's failed text.

## Bounded implementation

### Measured text origins and integer-scale GPU coverage

The Blink spike covers y phases 0/.25/.5/.75, sizes 11/13/15, line heights
1.2/1.6, system/PingFang/Inter, DPR1/2 and CSS scale1/2. The extended six-line
matrix includes 20.8px leading and negative origins. All 1,944 independently
measured DOM baselines match the shared rule: truncate CSS origin to 1/64px,
round used line height to 1/64px before accumulation, then round the paint
baseline in CSS space before device transforms. Naively rounding the raw sum
misses the sixth line at 20.8px; its maximum measured centroid error is
4.2771 device px. The retained chosen-rule ink residuals reach 0.3673px
centroid and 2px top edge under CSS scale2, within the unchanged geometry
limits; this is not a claim that every CJK pixel is identical.

`textLineBoxBaselineY` is shared by measured SVG, GPU raster and native
paragraph paths. Local GPU pictures retain the authored world phase without
modifying node.y. Typography runs retain their existing separate behavior.
Finite offsets retain the previous hanging origin and raw line advance.
Derived paint bounds apply the same snap when consuming logical ink receipts,
so page bounds do not crop a newly snapped multiline extent. The receipts
themselves are not rewritten.

Device-phase rasterization now supports integer `zoom * DPR` with integer
device pan. It rasterizes at that exact scale, aligns the image destination
to the device grid and uses nearest sampling for no-offset device variants,
avoiding interpolation of the old 2x master. Finite-offset text keeps its
historical >1x master output. Rotations, instances and fractional device pans
retain existing fallback behavior. The unchanged per-line and scene budgets
are checked after phase padding; optional allocation failures retain the
master and expose `device-line-raster-budget` or `device-scene-raster-budget`
statistics, including when no picture rebuild occurs. A 3x variant does not
first allocate an unnecessary 4x master.

Font styles are explicitly requested before awaiting font readiness. Browser
measurement no longer caches fallback font boxes or line-box offsets under
font-independent keys: an explicit FontFace.load()/add() need not emit a
loadingdone event. The browser late-font regression changes from stale
baseline 14 / offset 4.40625 to loaded baseline 15 / offset 4.59375. It does not change
imported coordinates or broaden layout invalidation.

Evidence: `spike-verified/`, `spike/`, `spike-cache-red/`,
`spike-cache-green/`, `spike-multiline/`, `origin-and-gpu-final.log`,
`gpu-phase-red.log`, `gpu-phase-green-attempt.log`, and
`paint-bounds-red.log` / `paint-bounds-green.log`.

### Horizontal center-origin follow-up

The first full R002 candidate left one real text node failing pixels in the
three primary matrices: `android-panels-96`, “GitHub 仓库地址”, 13px/500,
124px centered box. Geometry passed; maximum connected mismatch clusters
were 10/11/11 against the limit of 6. HTML and browser agreed. SVG geometry passed; its CSS2x capture retained a
pixel diagnostic (cluster 11).

The bounded horizontal probe has 40 cases/520 comparisons plus 24 boundary
cases/408 comparisons. The DOM rounds text advance upward to 1/64px, truncates
the authored origin toward zero to 1/64px, and truncates positive centering
space to that grid. Simple rounding, native Canvas center alignment, or
flooring the complete world position are not equivalent. At x=-88.499,
flooring the complete origin introduces a new cluster 16 failure. The measured
origin-plus-positive-offset rule has zero metric mismatch/cluster/geometry
delta in all 12 nonoverflow boundary cases. Overflow screenshots are partly
clipped and are diagnostic only; their DOM geometry exposes pre-existing
HTML versus SVG/Canvas overflow alignment differences.

The fix is restricted to no-offset raster center alignment with positive
space. Native paragraphs, finite offsets, right alignment and overflow retain
their existing behavior. World X phase participates in cache invalidation.
Raw probe evidence and exact commands are in `horizontal-origin-receipt.md`,
`horizontal-phase/`, `horizontal-typography/` and `horizontal-boundary/`.

## Outer shadows and HTML export → capture

R002 corrects the HTML outer-shadow mask to include the visible stroke outset: legacy/center strokes add half their width, outside strokes add their full width, and inside/transparent strokes add zero. The change applies to scalar shadows and outer `shadowStack` layers; inner stack layers and text-shadow syntax remain unchanged. The document codec/schema, supported stack admission and serialized values are unchanged. Center/outside stroke + stack combinations remain outside the codec's existing supported contract; direct-export string coverage does not claim to admit them as valid documents.

The roundtrip defect was reproduced before production edits. A rectangle with a legacy 4px red stroke exported as its two generated half-width shadows, then captured as `stroke: transparent`, `strokeWidth: 0` and a phantom red scalar shadow with x/y/blur all zero. Capture now recognizes only a finite generated-paint hint backed by measured computed CSS: a matching outer/inset pair with equal color/alpha/spread, zero offset/blur, bounded width, a supported surface node type, and no conflicting border/outline. The hint contains no arbitrary document JSON or geometry. Ordinary external shadows, unmarked matching pairs, forged or mismatched hints, oversized pairs and conflicting border/outline retain ordinary CSS capture behavior.

Evidence root: `/Users/admin/.codex/worktrees/panels-design-render-fidelity-r002/.tmp/render-fidelity-r002/shadow-roundtrip/`. Raw PNG/JSON/log artifacts remain local and are not committed.

| Actual command | Result | Evidence |
|---|---|---|
| `node --test --test-name-pattern='outer CSS shadow' tests/apps/design-studio/shadow-roundtrip.test.mjs` before production edit | 1 fail: required legacy spread 2px was absent | `red-shadow.log` |
| `DESIGN_SHADOW_EVIDENCE_DIR=.tmp/render-fidelity-r002/shadow-roundtrip/red node --test tests/apps/design-studio/shadow-roundtrip.test.mjs` before production edit and before adding geometry test | 1 pass / 2 fail: missing outset and confirmed stroke→shadow pollution | `red-capture.log`, `red/roundtrip.json`, `red/legacy-plain.png` |
| `DESIGN_SHADOW_EVIDENCE_DIR=.tmp/render-fidelity-r002/shadow-roundtrip/red node --test --test-name-pattern='exterior matches' tests/apps/design-studio/shadow-roundtrip.test.mjs` | 1 failed test; all eight geometry rows retained before asserting | `red-geometry.log`, `red/shadow-geometry.json` |
| `DESIGN_SHADOW_EVIDENCE_DIR=.tmp/render-fidelity-r002/shadow-roundtrip/green node --test tests/apps/design-studio/shadow-roundtrip.test.mjs` | 4 pass / 0 fail | `green.log`, `green/roundtrip.json`, `green/shadow-geometry.json` |
| `DESIGN_SHADOW_EVIDENCE_DIR=.tmp/render-fidelity-r002/shadow-roundtrip/green node --test tests/apps/design-studio/shadow-roundtrip.test.mjs tests/apps/design-studio/legacy-stroke-renderer.test.mjs tests/apps/design-studio/shadow-stack.test.mjs tests/apps/design-studio/frontend-export.test.mjs` | 19 pass / 0 fail | `related.log` |
| `npm run test:fidelity:delivery -- --output .tmp/render-fidelity-r002/shadow-roundtrip/delivery-before` | Exit 0 | `delivery-before.log`, `delivery-before/report.json` and all generated artifacts |
| `npm run test:fidelity:delivery -- --output .tmp/render-fidelity-r002/shadow-roundtrip/delivery-after` | Exit 0 | `delivery-after.log`, `delivery-after/report.json` and all generated artifacts |

The new browser tests use independent Chromium contexts and intercepted fixture module requests; unknown requests abort. Delivery uses the local repository fixture. `test:fidelity:real` was not run, and no account or live external service was used.

Eight unique scalar-shadow comparisons cover legacy/center/outside/inside × DPR1/2. They compare isolated HTML and SVG exterior ink with the unchanged centroid ≤1 device px and peak-alpha ratio within ±10% thresholds:

| Alignment | DPR | Before centroid | After centroid | Before peak-alpha ratio | After peak-alpha ratio |
|---|---:|---:|---:|---:|---:|
| legacy | 1 | 0.860247 | 0.289193 | 1.078431 | 1.000000 |
| center | 1 | 0.860247 | 0.289193 | 1.078431 | 1.000000 |
| outside | 1 | 1.483986 | 0.296863 | 1.195652 | 1.000000 |
| inside | 1 | 0.281486 | 0.281486 | 1.000000 | 1.000000 |
| legacy | 2 | 1.110585 | 0.265337 | 1.096154 | 1.017857 |
| center | 2 | 1.110585 | 0.265337 | 1.096154 | 1.017857 |
| outside | 2 | 2.442565 | 0.278104 | 1.212766 | 1.017857 |
| inside | 2 | 0.252568 | 0.252568 | 1.017857 | 1.017857 |

Failing unique rows decrease **4/8 → 0/8**; maximum centroid decreases **2.442565 → 0.296863 device px**. Four generated roundtrip combinations (legacy/center × absent/present scalar shadow) preserve the stroke and the authored shadow, with source serialization unchanged. Seven ordinary/forged/conflicting hint cases preserve their measured external-CSS meaning. Full image paths follow `red|green/scalar-<legacy|center|outside|inside>-dpr<1|2>-<html|svg>.png`; capture PNGs follow `red|green/<legacy|center>-<plain|shadow>.png`.

The implementation subagent actually inspected `red/scalar-outside-dpr2-html.png`, `green/scalar-outside-dpr2-html.png`, `green/scalar-outside-dpr2-svg.png`, and `green/legacy-shadow.png`; the corrected outside shadow visibly extends to the SVG mask. This observation covers those images only, not the global GPU text acceptance.

Offline delivery continues to satisfy its existing broad gate, but is **not a full semantic roundtrip pass**. Pixel metrics remain unchanged: similarity 0.987582, changedPixelRatio24 0.027715 and mean absolute channel error 3.166533. Stable-ID coverage remains 1 and maximum geometry delta remains 14.33. Unexpected nodes decrease **19 → 1**, roundtrip nodes **210 → 192** from 191 source nodes, and style differences **723 → 669**. The remaining one unexpected node and 669 style differences are disclosed, not suppressed. Generated HTML grows 101036 → 101794 bytes due to the bounded hints.

The six-page real backup contains no scalar `node.shadow` nodes. Therefore these shadow improvements are proven by synthetic fixtures and the offline delivery fixture, not by a shadow-bearing node from the user's real document. The dedicated eight-row shadow raster matrix uses opaque square surfaces; it does not establish transparent-fill, translucent-stroke, rounded-corner shadow or arbitrary multi-layer CSS capture parity. Thick rounded-stroke seams remain the separately declared deferred item. The recognition fix is intentionally scoped to rectangle/frame/component centered strokes; external arbitrary CSS and other node-type stroke roundtrips are not claimed newly solved.

## Acceptance limits and residual scope

Thresholds are unchanged: text top/bottom <=1 device px at scale 1, <=2 at
scale >=2; centroid <=0.75; left <=1, center/right <=1.5. Stroke scan centroid
and width <=0.35; child edge <=0.5. Symmetric 3x3/channel 24 pixels require
shape mismatch <=0.1%, text <=0.5%, and maximum connected cluster <=6.
Injected 1px/2px metric regressions must fail the corresponding strict gates.
SVG text pixels are diagnostic by CC's allowance; SVG geometry remains strict.
All half-zoom results are diagnostic and retain their raw failures.

This round does not claim full typography or inline-editor parity. Known
remaining areas include native Inter weight, thick rounded dual-shadow seams,
finite-offset HTML gating without layoutBaselineSource, Node's unmeasured SVG
central fallback, overflow alignment, and layout.mjs's existing weak caches
that can require invalidation after late font replacement. The font-measurer
cache fix does not claim to solve that separate layout behavior. The same
resource-fingerprint GPU state also has an unverified dynamic-font boundary:
new CSS styles or programmatic FontFace.load()/add() after initial creation do
not have a FontFaceSet epoch that invalidates its family, metric, glyph and
picture caches. Normal owned font-resource loading awaits the face and changes
the resource fingerprint, rebuilding the state; the late-font regression in
this round verifies the browser measurer, not arbitrary hot replacement in an
existing GPU state. This code-review finding is not a reproduced GPU failure,
but prevents claiming that every fallback-cache persistence path is solved.
CC must decide whether that broader font-state lifecycle belongs in this round.

## Final synthetic matrix

All 672 `(page,node,route,matrix)` keys match the new frozen-R001 baseline.
Both sides have full coverage, zero partial/unavailable/font omissions. Strict
unique failures decrease **38 → 14**; there are no newly failing unique keys.
The 204 diagnostic rows include half zoom and variant controls explicitly
outside the primary route gate; 60 retain diagnostic failures. Those controls
are not silently declared visually accepted.

`candidate-lines-strict-final/report.json`: all three primary matrices,
15 nodes × 4 routes × 3 matrices = **180 full unique, zero failures**, with no
diagnostics, unavailable or partial rows. Strict command exits 0.

`candidate-geometry-strict-final/report.json`: **192 full unique, 6 failures**,
zero primary geometry violations. All six are the known `radius` dual-shadow
stroke seam (GPU/SVG × three matrices): mismatch 0.323206% at 1x and 0.210084%
at 2x, with cluster 10 at 2x. The strict command exits **1**. Thus the requested
full geometry strict-green criterion remains unmet even though its geometric
measurements pass; this needs CC's decision under the explicitly deferred
rounded-stroke scope.

The other eight primary synthetic failures are GPU variants: `inter-bytes`
and `ranges-plain` at each primary matrix (six rows), plus `stroke-text` at
Retina/CSS2x (two rows). Native Inter/range centroid residuals reach
0.808410/0.797835 device px at 2x. The stroked-text cluster improves 75 → 19 but
still exceeds 6; this additional existing glyph-stroke pixel residual is not
claimed solved or covered by an Inter waiver. Full raw measurements remain in
`candidate-synthetic-final/report.json` and adjacent isolated PNGs.

`finite-compatibility-final.json` proves **12/12** finite-offset controls have
byte-identical SVG strings and identical actual GPU crop SHA-256 values between
3ca2f92d and R002. The serialized synthetic fixture hash also matches exactly.
Finite compatibility is independent of the remaining visual failures.

## Final six-page real results

`real-text-acceptance-final.json` independently asserts all **2784** primary
text rows (232 nodes × three matrices × four routes) are unique, full,
isolated and measurable. GPU and browser each have **696/696** rows with zero
geometry or pixel failures; their maximum symmetric mismatch ratio and cluster
are both **0**. GPU maximum absolute vertical centroid error is **0.013592
device px**. SVG has zero geometry failures; one retained pixel diagnostic is
`android-panels-96` at CSS2x, cluster 11, with all bbox edge deltas 0 and centroidY
0.001334. HTML is a self-comparison. Browser is an actual editor capture sharing the
frontend renderer with HTML; neither adds independent source nodes.

The same-harness frozen R001 baseline has **503** primary text failures:
GPU 407 (82 geometry, 405 pixel, overlapping) and SVG 96 geometry. R002 has
**0**. These are unique isolated attribution results, not old duplicate tile
counts. The candidate deliberately isolates every text target, including
baseline failures that already passed the candidate's raw tile.

Each table cell below uses the final unique attribution. The failing-row
column includes htmlsnap; no classified row is counted as a pass.

| Matrix | Unique / full | Candidate isolated | R001 → R002 failing rows | Unavailable | htmlsnap (still fail) | Diagnostic-failing rows |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| DPR1 / zoom1 | 1332 / 1332 | 1272 | 99 → 98 | 88 | 22 | 0 |
| DPR2 / zoom1 | 1332 / 1332 | 1256 | 329 → 82 | 60 | 56 | 0 |
| DPR1 / zoom2 | 1332 / 1332 | 1268 | 337 → 82 | 60 | 56 | 1 SVG text |
| DPR1 / zoom0.5 | 1332 / 1332 | 1332 | 0 → 0 (diagnostic) | 188 | 0 | 307 |
| Total | **5328 / 5328** | **5128** | **765 → 262** | **396** | **134** | **308** |

All 262 remaining primary failures are stroke shapes: GPU 131 and SVG 131;
browser/HTML 0. Of these, 134 have htmlsnap classification and 128 do not. All 134
classified rows still have pixel failures, so the classification does not
justify excluding them from the residual total. The final same-key comparison
is `real-comparison-final.json`; detailed counts are in `real-summary-final.json`.

These rows belong to 49 distinct source nodes, all transparent-fill rectangles
with 1px legacy strokes, zero rotation and radii from 1.6 to 7.2px. They cannot
all be attributed to the separately deferred thick rounded-stroke seam.
The 134 classified rows have both geometry and pixel failures; another 36
unclassified rows have complete measurable geometry that passes but fail
pixels. The remaining 92 unclassified rows lack complete flat-edge probes
and also fail pixels (22 retain a failure on a measurable subset of edges).
Thus **92 rows overlap the 262 failures and 396 unavailable rows**; those
headline counts must not be added as disjoint failures.

Representative isolated GPU results below have matching four-route PNGs in
`candidate-real-final/{matrix}-{page}-isolation-{node}/`. This is a measured
classification, not a claim that one root cause explains every shape.

| Node / matrix | Available geometry | Pixel result |
| --- | --- | --- |
| `android-chat-6` / `dpr1-zoom1` | 12 probes; maximum centroid 0.001531, width 0.003063; passes | 4/936 mismatch pixels (0.427350%), cluster 1; fails ratio |
| `web-panels-146` / `dpr1-zoom1` | 12 probes; maximum centroid 0.180399, width 0.009255; passes | 96/1024 (9.375%), cluster 96; fails |
| `android-chat-92` / `dpr2-zoom1` | 5.4px circular rectangle; no flat probe, unavailable | 34/1936 (1.756198%), cluster 5; fails ratio |
| `android-chat-53` / `dpr2-zoom1` | Only six side probes; incomplete, centroid reaches 0.811748 | 88/3132 (2.809706%), cluster 30; fails |

All 396 unavailable rows are fully isolated stroke shapes, with both
`STROKE_NO_FLAT_EDGE` and `HTML_REFERENCE_STROKE_UNAVAILABLE`. They represent
99 node×matrix targets across 47 distinct nodes, not 792 separate failures.
Small rounded icons/capsules have no adequate flat edge for the specified
four-edge scan. This is a measurement limitation with complete reviewable
pixels, not missing capture, zero error, or permission to claim a pass.
There are **0 partial, 0 missing, 0 font omissions** and no route errors.

The candidate preserves 7192 raw tiled measurements and 44 ordinary four-route
captures, then performs 1282 isolated captures. Twenty oversized targets use 40
raw tile captures and 80 derived route PNGs. Final full coverage comprises 5048
single-image isolated rows, 80 derived-composite rows and 200 complete raw rows.
The raw unique selection has 525 failures, 480 unavailable and 168 partial;
final attribution has 262, 396 and 0. This within-candidate difference is removal
of contamination and improved coverage, **not renderer improvement**. Only
the frozen-R001→R002 paired results above describe code improvement.

Half zoom remains 1332 diagnostic rows with 307 failures; SVG text adds one
primary-matrix pixel diagnostic. Complete raw values and PNGs are preserved.
No threshold was loosened to obtain the real-text result.

Final report SHA-256:
`20d2410ce2609a41fbf43ad9f437982298d4cc802eb526eafa5a2abfbf82ac52`.
`composite-audit-final.json` independently rebuilds all 80 derived route images
(25,544,480 pixels) byte-for-byte from raw sources, with zero overlapping-pixel
differences. `evidence-png-inventory-final.json` records all 8,208 final PNGs
and their SHA-256 values (58,794,740 bytes). `real-regressions-final.json`
reports no newly failing primary unique keys or newly unavailable rows.
`all-centroid-audit-final.json` applies the strict centroid rule independently
of historical text-content exemptions. The private source hash was checked
again after capture and audit and remains unchanged. The final isolation union
covers 1282/1282 required targets; all 4845 target/ancestor DOM bbox checks have
zero coordinate/size delta (the semantic-field limitation above still applies).


## Final repository verification

All production source and generated files were frozen before the final matrix
and repository checks. Final completion was 2026-11-07 00:09:36 Singapore time
(2026-11-06 16:09:36 UTC).

| Actual command | Exit | Result | Log |
| --- | ---: | --- | --- |
| `npm test -- --suite design-studio` | 0 | 1419 tests: 1414 pass, 0 fail, 5 skip; 466.376s | `design-suite-final.log` |
| `npm run check` | 0 | Published Host contract, source/build checks and offline suites pass; reported summaries total 4017 tests: 4008 pass, 0 fail, 9 skipped tests plus 2 skipped optional suites; 678.997s | `check-final.log` |
| `npm run validate` | 0 | All Panel manifests/installable layouts and smoke checks pass; 3.185s | `validate-final.log` |

The five Design Studio skips are the optional prepared official Grida encoder
and four unrelated private portable/IANA fixtures. The actual six-page R002
matrix, PingFang tests, baseline-origin spike, center-cache regression and
shadow roundtrip all ran. `final-validation-summary.json` records every skip
event, command, completion time and log hash. The full offline check has four
additional skipped tests and two optional real-model suites (Audio8/Qwen);
Node reports skipped suites separately from its skipped-test count. These passing functional/repository
checks do not override the separate strict visual failures described above.

`source-manifest-after-validation.json` matches all 336 entries in
`source-manifest-final-v2.json`; the shared digest is
`7a7279c597df0a96bcb69d39dd97ffbefeba0ff6a7637545921f1c16ea4e2b1b`.
The private input and lockfile hashes were checked again after validation and
are unchanged. `git diff --check` passes. Evidence remains uncommitted.

## Commands and evidence navigation

For the final validation batch, exact sequential commands, environment
overrides, start/finish UTC times, exit codes and log SHA-256 values are in
`final-validation-state.json`; the
local replay driver is `final-validation.mjs`. Diagnostic capture exit 0 means
capture completed, not visual acceptance. The geometry strict exit 1 is retained
in that state and its log. Essential commands, run from this worktree:

```sh
npm ci
node scripts/build-design-studio-figma-plugin.mjs
node scripts/build-design-studio-html-plugin.mjs
node --test tests/apps/design-studio/render-fidelity-attribution.test.mjs tests/apps/design-studio/render-fidelity-metrics.test.mjs
node --test --test-concurrency=1 tests/apps/design-studio/canvaskit-cache.test.mjs
DESIGN_TEXT_ORIGIN_EVIDENCE=.tmp/render-fidelity-r002/spike-verified node --test --test-concurrency=1 tests/apps/design-studio/text-line-box-origin-ui.test.mjs
DESIGN_FIDELITY_APP_DIR=.tmp/render-fidelity-r002/base/apps/design-studio/app DESIGN_FIDELITY_MODE=diagnostic DESIGN_FIDELITY_EVIDENCE=.tmp/render-fidelity-r002/baseline-synthetic node --test --test-concurrency=1 tests/apps/design-studio/render-fidelity-ui.test.mjs
DESIGN_FIDELITY_MODE=diagnostic DESIGN_FIDELITY_EVIDENCE=.tmp/render-fidelity-r002/candidate-synthetic-final node --test --test-concurrency=1 tests/apps/design-studio/render-fidelity-ui.test.mjs
node tests/apps/design-studio/render-fidelity-compare.mjs .tmp/render-fidelity-r002/baseline-synthetic/report.json .tmp/render-fidelity-r002/candidate-synthetic-final/report.json .tmp/render-fidelity-r002/finite-compatibility-final.json
DESIGN_FIDELITY_PAGES=lines DESIGN_FIDELITY_MATRIX=dpr1-zoom1,dpr2-zoom1,dpr1-zoom2 DESIGN_FIDELITY_EVIDENCE=.tmp/render-fidelity-r002/candidate-lines-strict-final node --test --test-concurrency=1 tests/apps/design-studio/render-fidelity-ui.test.mjs
DESIGN_FIDELITY_PAGES=geometry DESIGN_FIDELITY_MATRIX=dpr1-zoom1,dpr2-zoom1,dpr1-zoom2 DESIGN_FIDELITY_EVIDENCE=.tmp/render-fidelity-r002/candidate-geometry-strict-final node --test --test-concurrency=1 tests/apps/design-studio/render-fidelity-ui.test.mjs
DESIGN_FIDELITY_APP_DIR=.tmp/render-fidelity-r002/base/apps/design-studio/app DESIGN_FIDELITY_REAL_FIXTURE=/Users/admin/.codex/worktrees/codeshell-cross-platform-design-20261106/designs/codeshell-web-refined.backup.json DESIGN_FIDELITY_MODE=diagnostic DESIGN_FIDELITY_EVIDENCE=.tmp/render-fidelity-r002/baseline-real node --test --test-concurrency=1 tests/apps/design-studio/render-fidelity-ui.test.mjs
DESIGN_FIDELITY_REAL_FIXTURE=/Users/admin/.codex/worktrees/codeshell-cross-platform-design-20261106/designs/codeshell-web-refined.backup.json DESIGN_FIDELITY_ISOLATE_TEXT=1 DESIGN_FIDELITY_MODE=diagnostic DESIGN_FIDELITY_EVIDENCE=.tmp/render-fidelity-r002/candidate-real-final node --test --test-concurrency=1 tests/apps/design-studio/render-fidelity-ui.test.mjs
npm test -- --suite design-studio
npm run check
npm run validate
```

Final suite/check runs set distinct `DESIGN_TEXT_ORIGIN_EVIDENCE`,
`DESIGN_CENTER_TEXT_EVIDENCE` and `DESIGN_SHADOW_EVIDENCE_DIR` paths, preserving
prior red/green evidence. Initial negative-X center probes used inconsistent
GPU workspace/HTML background colors; those negative-X screenshots are
explicitly invalid as complete pixel evidence. The positive real label was on
white in both routes and remains valid. The final tests use the same white
background, with evidence under `suite-final-center/` and `check-final-center/`.
No production change was needed for this fixture correction. The corrected
15 center cases pass with zero symmetric mismatch/cluster and zero geometry
failures, including negative fractional and integer-move cache cases. Maximum
absolute centroid X/Y is 0.017071/0.000704 device px. Raw channel error remains
nonzero (maximum mean 0.051316), so this is not a byte-equality claim. See
`center-raster-suite-final-summary.json`.

`source-manifest-final-v2.json` records hashes of 336 application/test files
used by final checks. Compared with the first manifest, only the center-test
background fixture differs; all production source and generated plugin bytes
are unchanged. Generated plugin bundles are synchronized for the repository
build checks; no installed package is updated.

Final four-route captures use
`candidate-real-final/{matrix}-{page}-{tile}/{gpu,browser,svg,html}.png`.
Isolated captures use
`candidate-real-final/{matrix}-{page}-isolation-{node}/{gpu,browser,svg,html}.png`,
or explicitly named `derived-composite-{route}.png` with raw `tile-N/` sources.
Every directory has its measurements and source provenance. Baseline paths
use `baseline-real/` with the same naming convention.

Normal editor context is preserved as `gpu-editor-gui.png` and
`browser-editor-gui.png` in each first-tile directory. Those GUI views can show
66% auto-fit versus 100%; they are not the aligned pixel-gate inputs. The four
plain route PNGs are the captures with matching measured transforms.

Actual image inspection is logged in `inspection.md`. It includes final
GPU/HTML pairs for all six pages (Retina chat pages, CSS2x panel pages), the
corrected isolated real center label, the actual web-chat GPU/browser GUI,
and the failing synthetic radius/stroked-text crops. Text placement appears
aligned in those representative views; icon strokes and rounded seams remain
visibly different. This is representative inspection, not visual approval of
every tile/zoom or a claim that all styles match.
