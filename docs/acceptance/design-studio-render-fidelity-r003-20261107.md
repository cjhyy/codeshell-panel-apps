# Design Studio render fidelity — R003 (2026-11-07)

Local task branch `codex/design-studio/render-fidelity-r003-20261107`, base
`c98f2c63959ba1abeed31e80d5aa4563c4b929ec` (R001/R002 included).
Implementation checkpoint: `34ad308d6bc4f588ffd273274dec129ae9b0cf7b`
(23 files, +1192 / −108; app source and necessary tests only).
**Status: BLOCKED — strict visual parity is not achieved.**
This checkpoint is for independent review in the same CC session. It does not
replace CC's review or declare the coordinator's product goal complete.

Evidence root (uncommitted):
`/Users/admin/.codex/worktrees/panels-design-render-fidelity-r003/.tmp/render-fidelity-r003/`.
The base application is an exact `git archive c98f2c63` under `base/`.
Dependencies use an independent `npm ci --cache .tmp/npm-cache`; no symlink,
installed package, Host, other Panel, user design, or coordination ledger is
modified. No push, PR, merge, release, installation or paid/network fixture
collection is performed. Chromium uses private local test contexts; no user
browser tab or credentials are involved.

## Bounded changes

Plain supplied-resource text with a line-box origin uses the existing loaded
DOM FontFace alias raster. Finite offsets, ranges, decoration, multiple/gradient
paints and stroked resource text retain their prior native path. A resource
baseline raster exceeding the existing 16MP scene / 4MP line / 8192px dimension
limits falls back to native with bounded `resourceTextRasterFallbacks` stats.
Optional device variants retain the existing budget and expose fallback stats;
fallback frames are not certified visual passes. Font loads are deduplicated by
family/style/weight, with the union of characters. FontFaceSet identity/status
changes invalidate measurements, glyph images and retained pictures, including
a render without a document edit.

GPU text now samples the actual screen phase at finite positive physical scales,
including fractional pan and fit-view. It does not quantize the camera or edit
saved coordinates. Each text retains one replaceable device variant under the
existing raster budget. World-grid tiles are bypassed when they would resample
screen-phase text. Translation-only instances have distinct internal keys and
world origins; unrelated instances no longer disable the whole scene. Scaled,
rotated and nested instance text retains a scoped master fallback and explicit
stats. Variant metadata is bounded to 10,000 entries. Extreme scaled-instance
master upgrades retain the prior budget-error behavior.

A measured subset of rounded HTML strokes uses one outline ring: even integer
width, uniform radius at least half the width, rectangle/frame/component leaf,
center alignment. Children retain the prior paint order by staying on the old
path. Odd widths, per-corner radii and other cases retain existing output.
The outline hint is accepted only after computed-style geometry validation;
ordinary external shadows and forged/conflicting hints remain covered.
Generated prototype hotspots retain the previous shadow path. The implementation
admits even widths through 100px; direct pixel evidence covers widths 2/4/6,
radius 14 and opaque paints. Translucent paint is covered by roundtrip tests,
not a claim of complete pixel parity across every radius, rotation or position.

GPU boxes have a deliberately narrow presentation-only rule: reconstruct
unrotated absolute CSS paths from independently quantized local offsets, then
snap the four world edges before view transforms. Fill, stroke, image and
ancestor clip use the same presentation box; the document, SVG and radii retain
precise authored values. Flow-dependent/constraint/instance/rotation/inside-border
paths retain originals and report fallback reasons. In the six-page source,
353 nodes are eligible and 46 presentation boxes change (`real-box-eligibility.json`).
These are code-path counts, not visual-pass counts.
The new box UI regressions pass geometry in all three primary matrices;
ellipse pixels remain a strict residual (2x example: raw 2.2883%, filtered
0.4577%, versus 0.1%; `box-green/{matrix}/metrics.json`). The focused functional
test does not certify those pixels. Image contain/cover paths have no separate
new pixel spike and are not independently certified here.

## Measurement contract

Primary text and shape thresholds are unchanged. New fill geometry reports
bbox, centroid and, for rotated leaves, second-moment direction. Stroke coverage
uses 32 center-contour normal rays with at least 16 corresponding visible rays;
small rings split opposing edges at the authored medial axis. Missing,
occluded or ambiguous evidence remains unavailable, never zero error.

A shape may use the coordinator-approved device `[1,2,1]/4` separable AA
secondary test only after complete primary geometry passes. Raw pixel statistics
and `raw-pass` versus `qualified-aa-pass` remain separate. Text is never blurred,
and containers with text descendants are ineligible for shape AA. Pixel channel,
3x3 search, mismatch ratio and cluster thresholds remain unchanged. Independent
1-device-pixel shift and 0.5px width controls must fail geometry; 2px shifts must
also fail the filtered pixel gate. SVG text pixel diagnostics and half-zoom
rules remain explicitly identified.
`shape-review-negative-final.json` independently records 24 ring controls over
radii 1.6/2.7/5.4/12 and widths 1/2: all reference/actual contours are measurable
with 32 matched rays, all 1px shifts / 0.5px width changes / 2px shifts fail
geometry, and all eight 2px shifts fail the AA secondary gate as well.

A supplementary conservative audit applies the missing rotated-fill bbox
edge gate (0.5 device px) to both frozen reports. It keeps original reports and
PNGs immutable, revokes AA qualification after any bbox failure, and restores
the original raw pixel gate. `strict-audited-report.json` is the final counted
receipt; its source-report path and SHA retain full/raw provenance. A newly
identified bbox failure without isolation is explicitly unresolved, not a
confirmed defect or an accepted pass.

Isolation preserves target descendants, opaque occlusion, clipping, opacity,
transforms and layout. Containers are labeled visible composite fill, not
independent fill-leaf evidence. Full-scene/raw measurements, isolated images,
unique `(page,node,route,matrix)` selection and any derived tiled composites
remain reviewable. The real source's 474 non-text/no-stroke nodes comprise 241
painted rectangle/ellipse leaves, 62 painted frames and 171 transparent frames;
474 is not a count of visible fill leaves.

The new DPR2/zoom1 matrix delivers an actual trusted wheel event with
`deltaX=3.25`, then captures without correcting away its phase. Chromium CDP's
DPR scaling is compensated at input delivery and the actual DOM event and view
are recorded. Real fit-view is clicked in the normal editor layout and its
unrounded transform and GUI screenshots are diagnostic evidence. Actual
selection/hit-test and overlay bounds are checked at the fractional view.

## Spikes and limits

`font-red/metrics.json` and `font-green/metrics.json` cover 132 Inter rows:
400/600/700 × every integer size 11–32px × DPR1/2. Native has 39 geometry and
132 pixel failures (maximum mismatch 2.96717%, cluster 233, centroid 1.329801px).
Alias raster has zero geometry/pixel failures and zero raw channel error in
this aligned spike. All 44 size/DPR groups respond to the weight axis, so the
axis was not simply missing. At 32px/DPR2, native masses for 400/600/700 are
5891.835 / 8399.643 / 9616.686; HTML/raster are 6915.867 / 9417.114 / 10613.204.
This spike is separate from the actual editor/four-route matrix.

`transform-red/` versus `transform-instance/` cover ordinary text, a component
master and its translated instance at DPR2/zoom1 with fractional pan, DPR1/66%,
and DPR1/zoom2. All nine baseline rows fail pixels. All nine candidate rows have zero symmetric mismatch/cluster
and pass strict geometry; maximum centroid magnitude is below 0.01px. These
are focused renderer screenshots; actual fit-view GUI evidence is separate.
The instance spike compares GPU with HTML, not all four export routes. An
actual editor regression also selects a detached cross-page instance after a
trusted DPR2 fractional wheel event and checks its overlay against the same
unchanged view transform. Full four-route instance parity is not claimed.

`shape-box-spike/report.json` has 324 measured rectangle/ellipse/rounded-clip
rows over absolute/nested/flex layout and DPR1/2 × CSS scale1/2. The observed
rule is rounding CSS world edges after local 1/64px layout quantization, before
DPR/view scale. Nested `.35 + .15` and direct `.5` have different phases. This
rejects blind rounding of authored world coordinates. Negative local offsets
were measured; fractional negative world origins remain an explicit fallback.

`shape-spike/recomputed-report.json` retains the outline/shadow/pseudo-element
comparison and raw images. The even 4px outline passes all six scale/clip cases;
odd offsets quantize incorrectly, while the pseudo-element clips its ring.
`shape-green-verified/rounded-ring/report.json` covers 18 accepted 2/4/6px leaf
combinations with zero symmetric mismatch/cluster and zero measured
radius/stroke deltas. Mean channel error is not always zero, so this is not a
byte-equality claim.

Finite-offset text without source HTML/provenance retains the known 8–12px
browser-origin mismatch; no node.y compensation or serialization migration is applied.
Offline Node SVG without measured font context, typography ranges, stroked
text and inline editing retain their separately documented limitations.

## Frozen baseline recovery

The six-matrix / six-page baseline finished every capture in 45m58s. Its final
single-string `JSON.stringify` exceeded Node's string limit, so the original
capture command exited 1. No captured PNG or per-capture metric is replaced.
`baseline-real-final/recovered-report.json` is an explicitly derived recovery
from 2,718 saved metrics: 58 full-scene records, 2,532 isolation records and 128
raw isolation tiles. Source receipt hashes and exact recovery commands are in
`baseline-recovery-command-receipt.json`. The candidate writer streams top-level
array entries to avoid this aggregation limit without changing measurements.

The recovery cannot reconstruct the original aggregate font-availability probe;
that field remains unavailable. It does not borrow a candidate or synthetic
probe to assert zero omissions. The input and serialized fixture hashes are
recomputed from the immutable input and frozen base and labeled derived.

Recovered strict4 coverage is 10,176 unique, all full, with 3,712 text and 6,464
shape rows. The conservative audit reports 2,505 gate failures, 1,820 geometry
failures, 304 unavailable rows and 113 AA-qualified rows. Each route has 2,544
rows; GPU/browser/SVG/HTML gate failures are 1,308 / 76 / 1,045 / 76. All 76
browser and HTML failures coincide with unavailable same-color containers;
they are not measured browser-versus-itself pixel differences. There are 172
rotated-bbox audit rows without isolation, explicitly unresolved.

The input's 101 legacy stroke targets are 49 rectangles plus 52 frames; raw and
normalized nodes both omit `strokeAlign` and `strokeSides`. The 52 are not an
explicit-stroke population. Frame target pixels include preserved descendants,
so their pixel failures cannot all be attributed to the stroke. The subset
receipt `baseline-real-final/source-subset-summary-derived.json` records this
distinction and separates geometry from raw and AA-qualified pixel failures.

## Functional validation

All three required commands passed on the implementation checkpoint's exact
source. `source-manifest-green-verified.json` verifies 343 source/test file
hashes against the final validation; `.tmp` remains uncommitted.
The final read-only recheck in `final-custody-and-visual-assertion.json` confirms
all343 hashes still match, the real source and package-lock hashes are unchanged,
and node_modules is not a symlink. No source changed after the green commands.

| Exact command | Exit | Reported result | Wall time | Log under evidence root |
| --- | --- | --- | --- | --- |
| `npm test -- --suite design-studio` | 0 | 1445 tests; 1440 pass, 0 fail, 5 skip | 456.915s | `design-suite-green-final.log` |
| `npm run check` | 0 | Published Host contract, types/builds and offline suites; reported summaries total 4043 tests, 4034 pass, 0 fail, 9 skip | 655.676s | `check-green-final.log` |
| `npm run validate` | 0 | Repository/package validation | 2.774s | `validate-green-final.log` |

The interrupted first suite log and two subsequent failed runs remain in the
evidence root. The two resolved assertions expected the previous rounded dual
shadow markup and previous resource-font native/raster counters. Their revised
tests retain shadow/geometry/glyph checks; no pixel or geometry threshold changed.
The focused CanvasKit smoke rerun passed 3 tests with 1 optional skip before the
final full green commands. These functional results do not establish visual parity.

The exact candidate invocation, executed after the three green commands and the
implementation commit, is:

```sh
node --max-old-space-size=8192 .tmp/render-fidelity-r003/run-candidate-final-prepared.mjs 34ad308d6bc4f588ffd273274dec129ae9b0cf7b .tmp/render-fidelity-r003/final-validation-green-state.json
```

`candidate-final-command-receipt.json` records every underlying capture/audit/
comparison command, environment, timestamp, exit, log SHA and source inventory.
Synthetic uses all 3 original fixture pages; real uses all 6 input pages. Both
capture all six matrices, with the original three plus fractional pan as strict
and half/actual-fit as explicitly diagnostic. Capture mode `diagnostic` permits
collecting failing visual evidence; exit 0 means capture success, never acceptance.
GUI autosave/ENOENT banners can appear because this read-only fake Host rejects
`workspace.writeText`; these screenshots do not certify Host persistence. All
editor chrome remains visible in GUI receipts, and the real input hash is checked.

The wrapper above exited **1**, after the real capture child exited 0 and saved
all six matrices/six pages, because one isolation route failed. It was not
retried. In `dpr2-zoom1-fractionalpan`, `android-chat-102`, isolation-1, browser
capture asserted `actual GPU/browser transforms must be identical`:
GPU panX 28.750001907348633 versus browser 28.75, panY −638, zoom1.
The difference is 0.000001907348633 CSS px (0.000003814697266 device px), above
the harness's 1e−6 equality guard. Both routes received trusted DOM deltaX3.25;
the recorded deltas are 3.249998092651367 and 3.25. No corrective alignment or
tolerance change was applied. Its browser isolation PNG is absent; that row
remains unavailable even though an earlier full-scene receipt supplies the
unique key. `candidate-real-final/route-errors-derived.json` retains the exact
failure identity; the exact views are in
`candidate-real-final/dpr2-zoom1-fractionalpan-android-chat-isolation-android-chat-102/metrics.json`.
A route error is separate from the geometry/pixel gate count.

All six follow-up commands in `candidate-real-postprocess-after-stop.json`
exited 0: rotated-bbox audit, unique summary, source-subset classification,
recovered-base hash/key comparison, audited-base comparison and fractional
comparison. They read the preserved captures offline; no browser or capture was
rerun. The exact bounded invocation was:

```sh
node .tmp/render-fidelity-r003/postprocess-real-after-capture-stop.mjs
```

The final explicit visual assertion exited **1**, as required for these results:

```sh
node .tmp/render-fidelity-r003/assert-strict-visual.mjs .tmp/render-fidelity-r003/candidate-synthetic-final/summary.json .tmp/render-fidelity-r003/candidate-real-final/summary.json > .tmp/render-fidelity-r003/strict-visual-final.log 2>&1
```

Its synthetic result is 752 unique / 36 gate failures / 16 unavailable; real is
10,176 unique / 2,036 gate failures / 305 unavailable / 1 route error. Both have
zero missing or partial selected rows, zero candidate font omissions and zero
text-blur violations. Zero missing coverage does not turn an unavailable row
or failed route into a pass.

## Six-page candidate result

The final counts use `strictAuditedUnique.strict` from
`candidate-real-final/summary.json` and the recovered baseline's
`recovered-comprehensive-summary.json`. Each route has 2,544 unique/full rows
over DPR1/z1, DPR2/z1, DPR1/z2 and DPR2/z1 after trusted deltaX3.25.
Counts below are baseline → candidate; raw pixels include the retained SVG text
diagnostic. AA counts are qualified passes, never raw passes.

| Route | Unique/full | Gate fail | Geometry fail | Raw pixel fail | Qualified AA | Unavailable |
| --- | --- | --- | --- | --- | --- | --- |
| GPU | 2544 → 2544 | 1308 → 839 | 845 → 670 | 1265 → 814 | 53 → 87 | 76 → 76 |
| Browser | 2544 → 2544 | 76 → 76 | 76 → 76 | 0 → 0 | 0 → 0 | 76 → 77 |
| SVG | 2544 → 2544 | 1045 → 1045 | 823 → 823 | 993 → 993 | 60 → 60 | 76 → 76 |
| HTML | 2544 → 2544 | 76 → 76 | 76 → 76 | 0 → 0 | 0 → 0 | 76 → 76 |
| Total | 10176 → 10176 | 2505 → 2036 | 1820 → 1645 | 2258 → 1807 | 113 → 147 | 304 → 305 |

Candidate qualified-or-raw pixel failures are GPU727 / browser0 / SVG933 /
HTML0, total1660. All 2,036 gate failures are shape rows. All 3,712 strict text
rows have measured geometry, zero geometry/gate failures and zero unavailable;
one SVG text raw-pixel diagnostic remains. This is newly measured candidate
evidence, not reuse of R002's aligned text result.

Fractional matrix alone has 636 unique/full rows per route. GPU gate failures
are 524 → 220, browser19 → 19, SVG273 → 273 and HTML19 → 19. GPU fractional
text has 232 rows: gate/raw-pixel failures **212 → 0**, geometry/unavailable0.
The other three routes' 232 text rows each have zero geometry/raw-pixel failures
in both runs. The extra browser unavailable is the route error above, outside
text. `fractional-final-comparison.json` retains all route and text counts.

Raw full-scene tile measurements are separately retained, before isolation:
each route has 2,544 unique rows, 2,465 full and 79 partial, both runs. Their
baseline → candidate gate/raw-pixel counts are GPU1331/1312 → 842/873,
browser106/0 → 106/0, SVG1060/1027 → 1060/1027, HTML106/0 → 106/0.
These raw tile counts are not substituted for the full selected-isolation
counts above. Source raw metrics, raw PNGs and both original reports remain
unchanged by the conservative audit.

The strict source subsets are counted over all four routes/four matrices.
The complete per-route receipts are the two
`source-subset-summary-derived.json` files.

| Source subset | Unique | Gate fail | Geometry fail | Raw pixel fail | Qualified AA | Unavailable |
| --- | --- | --- | --- | --- | --- | --- |
| 49 legacy rectangle strokes | 784 | 328 → 264 | 320 → 256 | 360 → 323 | 32 → 59 | 0 → 0 |
| 52 legacy frame strokes | 832 | 289 → 260 | 0 → 0 | 289 → 260 | 0 → 0 | 0 → 1 |
| 241 fill leaves, including 77 rotated | 3856 | 1218 → 1104 | 1182 → 1077 | 1155 → 1047 | 81 → 78 | 0 → 0 |
| 62 filled containers | 992 | 458 → 408 | 318 → 312 | 241 → 176 | 0 → 10 | 304 → 304 |

GPU alone: rectangle strokes are196 unique, gate164 → 100, geometry160 → 96,
raw180 → 143, AA16 → 43; frame strokes208 unique, gate/raw152 → 123;
fill leaves964 unique, gate614 → 500, geometry599 → 494, raw584 → 476,
AA37 → 34. Browser/HTML measured pixels remain zero failures; SVG values are
unchanged. Frame composite pixels include descendants and cannot all be called
stroke defects. The 171 transparent frames have no own painted fill to measure.
The explicit/side-stroke source subset is empty.

`NO_FLAT_EDGE` is eliminated by contour sampling, but unavailable has not met
the target0. In strict matrices, 304 unavailable are same-color containers and
one is the failed browser route. Diagnostic half/fit rows additionally retain
8 geometry-probe and 86 contour visibility/unbounded-ink unavailable rows plus
152 same-color rows. Rotated audit assesses1848 rows over six matrices, changes
782 and revokes88 AA qualifications. Its165 newly identified bbox failures
without isolation remain unresolved; 50 are strict fill-leaf rows (GPU30,
SVG20), unchanged from baseline. They are counted conservatively as failures,
not asserted to be isolated confirmed defects.

Actual fit-view remains diagnostic: 2,544 unique/full rows, geometry464 → 360,
raw pixel880 → 515, qualified-or-raw pixel800 → 429, unavailable191 → 169,
diagnostic failures903 → 545. Candidate fit text has232 rows per route:
GPU5 geometry /2 raw-pixel diagnostic failures, SVG5 /49, browser and HTML0 /0.
These fit receipts have no per-node isolation. The GPU pixel cases are
`android-chat-5` and `android-panels-5` (1.1640%, cluster9); geometry cases are
`android-chat-103`, `android-chat-46`, `android-panels-33`, `web-chat-190`,
`web-panels-193`, with measured edge deltas up to10px. Attribution remains open;
the aligned/fractional strict result does not certify all arbitrary scales.
Half-zoom remains diagnostic too: geometry308 → 274, raw655 → 307,
unavailable79 → 77; all candidate half-zoom text rows have zero geometry/raw
pixel failures.

Recovered baseline and candidate input SHA, serialized SHA and all15,264
six-matrix unique keys match (`baseline-key-hash-comparison-derived.json` and
`baseline-strict-comparison-derived.json`, both exit0). The immutable real
input SHA is `91d877f8dbb28dce4c698b850c0db7455be2471c9d052f5cdf138c35f47dfc24`;
serialized SHA is `f3d53ff00df3a919c91b3f66b9b126e6af674cd2d91a5387e7077b5866a5b98c`.
The original baseline aggregate font probe remains unavailable, as above.

## Synthetic candidate result

All six matrices and three fixture pages were captured successfully. Original
and audited unique keys match the frozen baseline. For the four strict matrices,
each route has 188 unique/full rows (752 total). The strict gate-failure counts
are GPU 55 → 15, browser 0 → 0, SVG 22 → 21 and HTML 0 → 0. Candidate raw pixel
failures are GPU 28 / browser 0 / SVG 29 / HTML 0; AA qualification is GPU 1 and
all other routes 0. Unavailable remains 4 per route, not an accepted pass.

`default-inter` and `inter-bytes` have zero geometry and pixel failures across
all four routes and all six matrices: 48 rows, including the 32 strict rows.
This includes the actual default Inter 600/32px/1.15 case and the trusted
fractional-pan challenge. `critical-inter-and-text-residuals.json` retains every
raw statistic. The seven remaining strict text failures are all GPU:

- `ranges-plain`: all four strict matrices; mismatch 1.9828% at DPR1/z1,
  1.0940% at scale2 and 1.1754% after fractional pan; the latter three also have
  centroidY about −0.798 / −0.788px, exceeding 0.75px.
- `stroke-text`: the three scale2 strict matrices; cluster 19 / 19 / 18 exceeds
  6. These are retained native-path limitations, not relaxed text passes.

Original R002 finite-offset golden controls: 12/12 GPU crop hashes and SVG
strings unchanged (`r002-finite12-comparison-derived.json`). The complete
synthetic fixture hash differs from R002 because R003 adds default Inter; it is
not used to excuse a golden change. Frozen R003 baseline versus candidate also
passes all 18 controls over the extended six matrices.

## GUI images actually inspected

The root agent opened these original PNGs with `view_image`; conclusions are
limited to the visible regions. Harness candidate GUIs have a sibling
`gpu-editor-gui.metadata.json` with their actual transform; the instance fixture
uses `report.json`. Initial baseline
`*-editor-gui.png` images were taken before matrix alignment and are not proof
of their filename's zoom; the separate `*-actual-fit-gui.png` images are valid
fit-button evidence.

| Opened GUI under evidence root | Verified view |
| --- | --- |
| `candidate-real-final/dpr2-zoom1-web-chat-0/gpu-editor-gui.png` | DPR2, zoom1, pan44/44, normal stage1069×919; toolbar100% |
| `candidate-real-final/dpr1-zoom2-web-chat-0/gpu-editor-gui.png` | DPR1, zoom2, pan56/56, normal stage1069×919; toolbar200% |
| `candidate-real-final/dpr2-zoom1-fractionalpan-web-chat-0/gpu-editor-gui.png` | DPR2, zoom1, pan40.75/44 after trusted DOM deltaX3.25 from44; no corrective alignment |
| `candidate-real-final/dpr1-fit-view-web-chat-gpu-actual-fit-gui.png` | Actual fit button; zoom0.65625, pan62/131.375, stage1069×919, toolbar66% |
| `candidate-real-final/dpr1-fit-view-web-chat-browser-actual-fit-gui.png` | Same actual fit transform and normal browser workbench; independently opened |
| `candidate-synthetic-final/dpr2-zoom1-variants-0/gpu-editor-gui.png` | DPR2, zoom1, default Inter and resource Inter visible |
| `design-suite-verified-instance/dpr2-fractional-instance-gui.png` | DPR2, zoom0.84500003, trusted wheel3.25, panX62→58.75, selected-instance overlay delta0 |

The root also opened `font-red/dpr2-w600-gpu.png`,
`font-green/dpr2-w600-gpu.png`, focused `transform-instance` DPR2 and 66% GPU
images, and the baseline real fit GUI (`dpr1-fit-view-web-chat-gpu-actual-fit-gui.png`,
zoom0.65625, pan62/131.375). `root-visual-inspection.md` records these observations.

## Items for the same CC review session

- Strict shape pixels, geometry failures and unavailable measurements remain
  blockers; no functionally green test result overrides them. The route counts
  above distinguish raw, AA-qualified and unavailable rows.
- The fractional browser isolation error needs a CC decision on the harness's
  camera-equality guard or a future targeted attribution run. This checkpoint
  retains the1e−6 guard and failed receipt; it does not round away the phase.
- Actual-fit text diagnostics still include five GPU geometry and two pixel
  cases without isolation. CC must distinguish measurement attribution from
  remaining renderer defects before broad arbitrary-scale acceptance.
- Same-color filled containers have no independent foreground ink under their
  preserved backdrop. Their unavailable result needs a measurement-scope
  decision; recoloring or removing descendants to manufacture contrast is not
  used here.
- Rotated fill bbox failures first found by the conservative post-audit may
  lack isolation. Those rows require additional attribution before calling
  them confirmed defects, and are excluded from accepted AA counts now.
- Real-page fractional/fit interaction receipts have no top-level text target
  and explicitly report `NO_TOP_LEVEL_TEXT_INTERACTION_TARGET`. Synthetic
  top-level text and the actual editor's detached-instance regression cover
  camera/overlay behavior; they do not certify nested real-page text hit testing
  or full four-route instance parity.
- Precise SVG shape boxes are retained. Fractional geometry/pixel differences
  remain visible failures; this checkpoint does not silently recategorize them
  as an allowed SVG exception.
- Remaining odd-width / child-bearing rounded shadow seams, ellipse AA and
  unverified image-fit paths need separate evidence before extending the
  narrow fixes. Finite-offset/noSourceHTML positioning (T5) is deferred to
  preserve this round's Critical and review-fix budget.
